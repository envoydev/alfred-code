// scripts/preferences-session.test.js - the preferences hook, driven through stdin payloads in throwaway git repos: the
// first edit and the first git write of each actor wait until the preferences docs were read, and the hold hands them over.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint never decides a case - the hold is made unattended too
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const HOOK = path.join(HOOKS, 'preferences-session.js');
const PREFS = '.alfred/docs/preferences';

const PERSONAL = '# Personal code preferences\n\nUpdated: 2026-10-21\n\n## C1 - No static helper classes\n<!-- id: c1 -->\n- Rule: put behaviour on the type that owns the data, never in a static helper class.\n- Scope: every language\n';
const ARCHITECTURE = '# Architecture preferences\n\nUpdated: 2026-10-21\n\n## A1 - Handlers stay thin\n<!-- id: a1 -->\n- Rule: a handler validates, calls one service and maps the result.\n';
const PROJECT = '# Project code preferences\n\nCaptured: develop@abc1234, 2026-10-21\n\n## Project type\n<!-- id: project-type -->\nAn Angular front end over an ASP.NET API.\n\n'
    + '## TypeScript\n<!-- id: typescript -->\n<!-- covers: src/**.ts -->\nSingle quotes, two-space indent, standalone components.\n\n'
    + '## C#\n<!-- id: c-sharp -->\n<!-- covers: api/**.cs -->\nFile-scoped namespaces, records for DTOs.\n';
const GIT = '# Git preferences\n\nUpdated: 2026-10-21\n\n## G1 - Branch names\n<!-- id: g1 -->\n- Rule: name a branch feature/<ticket>.\n\n'
    + '## G2 - Ask before any commit or push\n<!-- id: g2 -->\n<!-- locked: consent -->\n- Rule: Do NOT commit or push until the user explicitly says to.\n\n'
    + '## G3 - Keep history recoverable\n<!-- id: g3 -->\n<!-- locked: safety -->\n- Rule: prefer --force-with-lease.\n';

let n = 0;
const sid = () => `prefs-test-${process.pid}-${++n}`;

function project({ docs = { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE, 'PROJECT-CODE-PREFERENCES.md': PROJECT, 'GIT-PREFERENCES.md': GIT }, watch = true } = {})
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-hook-')));
    const write = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    write('.gitignore', '.alfred/\n');
    write('src/app.ts', 'export const x = 1;\n');
    for (const [name, text] of Object.entries(docs)) write(path.join(PREFS, name), text);
    if (watch && Object.keys(docs).length) write(path.join(PREFS, 'watch.json'), '{}\n');
    const env = (extra) => ({ ...process.env, CLAUDE_PROJECT_DIR: root, ...extra });
    const hook = (payload, extra = {}, file = HOOK) => spawnSync(process.execPath, [file], { cwd: root, input: typeof payload === 'string' ? payload : JSON.stringify({ cwd: root, ...payload }), encoding: 'utf8', env: env(extra) });
    return {
        root, write, hook,
        read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
        exists: (rel) => fs.existsSync(path.join(root, rel)),
        rm: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}
const pre = (tool, input, session, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: session, tool_name: tool, tool_input: input, ...extra });
const edit = (file, session, extra) => pre('Edit', { file_path: file, old_string: 'x', new_string: 'y' }, session, extra);
const bash = (command, session, extra) => pre('Bash', { command }, session, extra);
const out = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput || {}; } catch { return {}; } };
const denied = (r) => out(r).permissionDecision === 'deny';
const reason = (r) => String(out(r).permissionDecisionReason || '');

test('the first edit waits for the code docs and hands them over inline; the retry passes and a row is written', () =>
{
    const p = project();
    try
    {
        const s = sid();
        const held = p.hook(edit('src/app.ts', s));
        assert.strictEqual(held.status, 0, held.stderr);
        assert.ok(denied(held), held.stdout);
        const text = reason(held);
        assert.match(text, /put behaviour on the type that owns the data/, 'the personal doc, whole');
        assert.match(text, /a handler validates, calls one service/, 'the architecture doc, whole');
        assert.match(text, /Single quotes, two-space indent/, 'the project section covering the target');
        assert.match(text, /An Angular front end over an ASP\.NET API/, 'the cover-less project section');
        assert.doesNotMatch(text, /File-scoped namespaces/, 'another language\'s section is not pasted');
        assert.match(text, /PROJECT-CODE-PREFERENCES\.md \('C#'\)/, 'it is named instead');
        assert.doesNotMatch(text, /<!--/, 'comment lines stay out');
        assert.doesNotMatch(text, /Do NOT commit or push/, 'the git doc waits for a git write');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'the retry goes through');
        assert.ok(!denied(p.hook(edit('src/other.ts', s))), 'and every later edit of the actor');
        const rows = p.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').map((l) => JSON.parse(l));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].hook, 'preferences-session.js');
        assert.strictEqual(rows[0].kind, 'code');
        const state = JSON.parse(p.read(`.alfred/state/sessions/preferences-${s}-main.json`));
        assert.deepStrictEqual(Object.keys(state).sort(), ['ARCHITECTURE', 'PERSONAL-CODE', 'PROJECT-CODE#project-type', 'PROJECT-CODE#typescript'], 'the C# section waits for a C# edit');
    }
    finally { p.rm(); }
});

test('with the docs engine copied and the domain switched on, an unpasted section is named by its show line', () =>
{
    const p = project();
    try
    {
        p.write('.claude/hooks/docs.js', '// stub\n');
        const text = reason(p.hook(edit('src/app.ts', sid())));
        assert.match(text, /node \.claude\/hooks\/docs\.js show PROJECT-CODE-PREFERENCES#c-sharp/);
    }
    finally { p.rm(); }
});

test('each actor is held on its own: a seat\'s first edit waits even after the main session read the docs', () =>
{
    const p = project();
    try
    {
        const s = sid();
        assert.ok(denied(p.hook(edit('src/app.ts', s))));
        assert.ok(!denied(p.hook(edit('src/app.ts', s))));
        const seat = p.hook(edit('src/app.ts', s, { agent_id: 'agent-7', agent_type: 'alfred-code:web-angular-implementer' }));
        assert.ok(denied(seat), 'the seat has read nothing yet');
        assert.ok(!denied(p.hook(edit('src/app.ts', s, { agent_id: 'agent-7' }))), 'and its own retry passes');
        assert.ok(denied(p.hook(edit('src/app.ts', s, { agent_id: 'agent-8' }))), 'a second seat is its own actor');
    }
    finally { p.rm(); }
});

test('with no personal doc a compaction clears the record and says nothing; another session start keeps it and says nothing', () =>
{
    const p = project();
    try
    {
        const s = sid();
        p.hook(edit('src/app.ts', s));
        const start = p.hook({ hook_event_name: 'SessionStart', session_id: s, source: 'resume' });
        assert.strictEqual(start.stdout, '', 'nothing is pushed at a session start');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'a resume keeps what was read');
        const compact = p.hook({ hook_event_name: 'SessionStart', session_id: s, source: 'compact' });
        assert.strictEqual(compact.status, 0, compact.stderr);
        assert.strictEqual(compact.stdout, '');
        assert.ok(!p.exists(`.alfred/state/sessions/preferences-${s}-main.json`), 'the record is gone');
        assert.ok(denied(p.hook(edit('src/app.ts', s))), 'the summary dropped the docs, so the next edit waits again');
    }
    finally { p.rm(); }
});

test('the first git write waits for the git doc, its locked entries first, read live from the doc', () =>
{
    const p = project();
    try
    {
        const s = sid();
        const held = p.hook(bash('git add -A && git commit -m "x"', s));
        assert.ok(denied(held), held.stdout);
        const text = reason(held);
        const locked = text.indexOf('Do NOT commit or push');
        const safety = text.indexOf('force-with-lease');
        const branch = text.indexOf('name a branch feature/<ticket>');
        assert.ok(locked > 0 && safety > 0 && branch > 0, text);
        assert.ok(locked < branch && safety < branch, 'every locked entry is listed before the others');
        assert.match(text, /Locked/);
        assert.doesNotMatch(text, /put behaviour on the type/, 'the code docs wait for an edit');
        assert.ok(!denied(p.hook(bash('git commit -m "x"', s))), 'the retry goes through');
        assert.strictEqual(JSON.parse(p.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim()).kind, 'git');
        p.write(`${PREFS}/GIT-PREFERENCES.md`, GIT.replace('name a branch feature/<ticket>', 'name a branch topic/<ticket>'));
        const again = reason(p.hook(bash('git push', sid())));
        assert.match(again, /name a branch topic\/<ticket>/, 'a new session reads the doc as it is now');
        assert.doesNotMatch(again, /feature\/<ticket>/);
    }
    finally { p.rm(); }
});

test('a branch or tag made, a gh merge and a git write behind a wrapper count; read-only git and other commands pass', () =>
{
    const p = project();
    try
    {
        for (const cmd of ['git checkout -b feature/x', 'git switch -c feature/x', 'git branch feature/x', 'git tag v1', 'git branch -D old', 'gh pr merge 12 --squash', 'cd src && git stash', 'timeout 60 git push'])
            assert.ok(denied(p.hook(bash(cmd, sid()))), cmd);
        for (const cmd of ['git status', 'git log --oneline -5', 'git diff HEAD --stat', 'git branch -a', 'git branch --show-current', 'git stash list', 'git tag -l', 'ls -la', 'npm test', 'echo "git commit"'])
            assert.ok(!denied(p.hook(bash(cmd, sid()))), cmd);
    }
    finally { p.rm(); }
});

test('exempt targets pass: outside the project, the hooks\' state and statistics, the preferences folder, .claude and .git; a plan waits', () =>
{
    const p = project();
    try
    {
        for (const file of [path.join(os.tmpdir(), 'scratch-note.md'), '.alfred/state/sessions/x.json', '.alfred/statistics/x.jsonl', `${PREFS}/PERSONAL-CODE-PREFERENCES.md`, '.claude/settings.json', '.git/info/exclude'])
            assert.ok(!denied(p.hook(edit(file, sid()))), file);
        assert.ok(denied(p.hook(edit('.alfred/docs/work/plans/refunds.md', sid()))), 'a design plan is a read trigger');
        assert.ok(denied(p.hook(edit(path.join(p.root, 'src', 'app.ts'), sid()))), 'an absolute path inside the project');
    }
    finally { p.rm(); }
});

test('a shell write to a source file is an edit; one outside the project is not', () =>
{
    const p = project();
    try
    {
        assert.ok(denied(p.hook(bash("sed -i '' 's/1/2/' src/app.ts", sid()))));
        assert.match(reason(p.hook(bash('echo y > src/new.ts', sid()))), /Single quotes, two-space indent/, 'the target picks the covering section');
        assert.ok(!denied(p.hook(bash(`echo y > ${path.join(os.tmpdir(), 'x.txt')}`, sid()))));
        const both = reason(p.hook(bash('echo y > src/a.ts && git commit -am x', sid())));
        assert.match(both, /Do NOT commit or push/);
        assert.match(both, /put behaviour on the type/, 'one command, both holds, one denial');
    }
    finally { p.rm(); }
});

test('reading a doc first marks it: a Read, a cat and a docs.js show each count, for that doc alone', () =>
{
    const p = project();
    try
    {
        const s = sid();
        p.hook(pre('Read', { file_path: path.join(p.root, PREFS, 'GIT-PREFERENCES.md') }, s));
        assert.ok(!denied(p.hook(bash('git commit -m x', s))), 'the git doc was read');
        const t = sid();
        p.hook(bash(`cat ${PREFS}/PERSONAL-CODE-PREFERENCES.md`, t));
        p.hook(bash('node .claude/hooks/docs.js show ARCHITECTURE-PREFERENCES#a1', t));
        const held = reason(p.hook(edit('src/app.ts', t)));
        assert.match(held, /Single quotes/, 'the project doc was not read');
        assert.doesNotMatch(held, /put behaviour on the type/, 'the personal doc is not handed over twice');
        assert.doesNotMatch(held, /a handler validates/, 'nor the architecture doc');
        const u = sid();
        for (const f of ['PERSONAL-CODE-PREFERENCES.md', 'ARCHITECTURE-PREFERENCES.md', 'PROJECT-CODE-PREFERENCES.md']) p.hook(pre('Read', { file_path: `${PREFS}/${f}` }, u));
        assert.ok(!denied(p.hook(edit('src/app.ts', u))), 'all three read: no hold');
        assert.ok(!p.exists(`.alfred/statistics/hook-blocks/${u}.jsonl`));
    }
    finally { p.rm(); }
});

test('docs that do not exist are not waited for; none at all is no hold', () =>
{
    const none = project({ docs: {} });
    try
    {
        assert.ok(!denied(none.hook(edit('src/app.ts', sid()))));
        assert.ok(!denied(none.hook(bash('git commit -m x', sid()))));
    }
    finally { none.rm(); }
    const one = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL } });
    try
    {
        const text = reason(one.hook(edit('src/app.ts', sid())));
        assert.match(text, /put behaviour on the type/);
        assert.doesNotMatch(text, /PROJECT-CODE|ARCHITECTURE-PREFERENCES/);
        assert.ok(!denied(one.hook(bash('git push', sid()))), 'no git doc, no git hold');
    }
    finally { one.rm(); }
});

test('it fails open: a garbage payload, a garbage record, a doc that is a folder, a doc with no sections', () =>
{
    const p = project();
    try
    {
        const bad = p.hook('{not json');
        assert.strictEqual(bad.status, 0);
        assert.strictEqual(bad.stdout, '');
        const s = sid();
        p.write(`.alfred/state/sessions/preferences-${s}-main.json`, '{garbage');
        const held = p.hook(edit('src/app.ts', s));
        assert.strictEqual(held.status, 0, held.stderr);
        assert.ok(denied(held), 'a record it cannot read is no record');
        assert.ok(JSON.parse(p.read(`.alfred/state/sessions/preferences-${s}-main.json`))['PERSONAL-CODE'], 'and it is written whole again');
    }
    finally { p.rm(); }
    const odd = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': 'just some words the user wrote, no headings\n' } });
    try
    {
        fs.mkdirSync(path.join(odd.root, PREFS, 'GIT-PREFERENCES.md'));
        assert.ok(!denied(odd.hook(bash('git commit -m x', sid()))), 'a folder named like the doc is no doc');
        assert.match(reason(odd.hook(edit('src/app.ts', sid()))), /just some words the user wrote/, 'a doc with no sections is handed over as written');
    }
    finally { odd.rm(); }
});

test('a Cursor payload and the hooks off-list stand it down', () =>
{
    const p = project();
    try
    {
        assert.strictEqual(p.hook(edit('src/app.ts', sid(), { cursor_version: '1.7.0' })).stdout, '');
        assert.strictEqual(p.hook(edit('src/app.ts', sid()), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '');
    }
    finally { p.rm(); }
});

test('the hand-over stays inside its cap on a huge project doc and names what it left out', () =>
{
    const big = '# Project code preferences\n\n## TypeScript\n<!-- id: typescript -->\n<!-- covers: src/**.ts -->\n' + 'Prefer readonly fields over mutable ones. '.repeat(600) + '\n\n'
        + Array.from({ length: 40 }, (_, i) => `## Lang ${i}\n<!-- id: lang-${i} -->\n<!-- covers: l${i}/**.x -->\n${'word '.repeat(200)}\n`).join('\n');
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'PROJECT-CODE-PREFERENCES.md': big } });
    try
    {
        const text = reason(p.hook(edit('src/app.ts', sid())));
        assert.ok(text.length < 8500, `${text.length} chars`);
        assert.match(text, /put behaviour on the type/, 'the user\'s own doc comes first');
        assert.match(text, /Prefer readonly fields/, 'the covering section is pasted as far as it fits');
        assert.match(text, /more chars/, 'and its cut is said');
        assert.match(text, /PROJECT-CODE-PREFERENCES\.md \('Lang 3'\)/, 'the others are named');
    }
    finally { p.rm(); }
});

test('through the dispatchers: the file guards and the shell guards carry its hold', () =>
{
    const p = project();
    try
    {
        const viaFiles = p.hook(edit('src/app.ts', sid()), {}, path.join(HOOKS, 'file-guards.js'));
        assert.match(viaFiles.stdout, /put behaviour on the type/, viaFiles.stdout + viaFiles.stderr);
        const viaShell = p.hook(bash('git tag v2', sid()), {}, path.join(HOOKS, 'shell-guards.js'));
        assert.match(viaShell.stdout + viaShell.stderr, /Do NOT commit or push/);
    }
    finally { p.rm(); }
});

// 2026-10-21, the user's ruling: PERSONAL-PREFERENCES.md - how the user wants the assistant to work - is loaded at every
// session start and is back after each compaction: the hook pushes it on SessionStart, whatever the source.
const PERSONAL_PREFS = '# Personal preferences\n\nUpdated: 2026-10-21\n\n## P1 - Short answers\n<!-- id: p1 -->\n- Rule: lead with the verdict, at most two bullets.\n- Scope: every answer\n';
const start = (session, source) => ({ hook_event_name: 'SessionStart', session_id: session, source });
const pushed = (r) => (out(r).hookEventName === 'SessionStart' ? String(out(r).additionalContext || '') : '');

test('the personal doc is pushed at every session start - startup, resume, clear and compact - comment lines dropped', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'GIT-PREFERENCES.md': GIT } });
    try
    {
        const s = sid();
        p.hook(edit('src/app.ts', s));
        for (const source of ['startup', 'resume', 'clear', 'compact'])
        {
            const r = p.hook(start(s, source));
            assert.strictEqual(r.status, 0, r.stderr);
            const text = pushed(r);
            assert.match(text, /lead with the verdict, at most two bullets/, source);
            assert.match(text, /\.alfred\/docs\/preferences\/PERSONAL-PREFERENCES\.md/, `${source}: it names its file`);
            assert.match(text, /every session start and after each compaction/, source);
            assert.doesNotMatch(text, /<!--/, `${source}: the id lines are left out`);
            assert.doesNotMatch(text, /static helper class|feature\/<ticket>/, `${source}: the code and git docs wait for their holds`);
        }
        assert.ok(!p.exists(`.alfred/state/sessions/preferences-${s}-main.json`), 'the compact start still deletes the read record');
    }
    finally { p.rm(); }
});

test('no personal doc, an empty one, one with no entry or one that is a folder pushes nothing', () =>
{
    for (const docs of [{ 'PERSONAL-CODE-PREFERENCES.md': PERSONAL }, { 'PERSONAL-PREFERENCES.md': '' }, { 'PERSONAL-PREFERENCES.md': '# Personal preferences\n\nUpdated: 2026-10-21\n' }, {}])
    {
        const p = project({ docs });
        try
        {
            if (!Object.keys(docs).length) fs.mkdirSync(path.join(p.root, PREFS, 'PERSONAL-PREFERENCES.md'), { recursive: true });
            for (const source of ['startup', 'compact']) assert.strictEqual(p.hook(start(sid(), source)).stdout, '', `${JSON.stringify(docs)} ${source}`);
        }
        finally { p.rm(); }
    }
});

test('a personal doc past its cap is cut at a line, naming the file to read for the rest', () =>
{
    const long = `${PERSONAL_PREFS}\n${Array.from({ length: 120 }, (_, i) => `## P${i + 2} - Entry ${i + 2}\n- Rule: ${'word '.repeat(8)}${i}`).join('\n\n')}\n`;
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': long } });
    try
    {
        const text = pushed(p.hook(start(sid(), 'startup')));
        assert.ok(text.length < 4000, `pushed ${text.length} chars`);
        assert.match(text, /lead with the verdict/, 'it keeps the head');
        assert.match(text, /cut at \d+ of \d+ chars - Read \.alfred\/docs\/preferences\/PERSONAL-PREFERENCES\.md for the rest/);
    }
    finally { p.rm(); }
});

test('the hooks off-list and a Cursor payload stand the push down', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS } });
    try
    {
        assert.strictEqual(p.hook(start(sid(), 'startup'), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '');
        assert.strictEqual(p.hook({ ...start(sid(), 'startup'), cursor_version: '1.7.0' }).stdout, '');
        assert.strictEqual(p.hook('not json').stdout, '');
    }
    finally { p.rm(); }
});

// ---- audit 2026-10-21 (preferences.md PF rows, loading.md G rows): the edge cases, test-first ---------------------
const { spawn } = require('node:child_process');
const SEED = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'git-seed.md'), 'utf8').replace('__TODAY__', '2026-10-21');
const SECRET = 'hunter2-very-secret';
const all = (r) => `${r.stdout}${r.stderr}`;
const start2 = (session, source, extra = {}) => ({ hook_event_name: 'SessionStart', session_id: session, source, ...extra });
const record = (s, actor = 'main') => `.alfred/state/sessions/preferences-${s}-${actor}.json`;
const commit = (root) =>
{
    for (const args of [['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']]) spawnSync('git', args, { cwd: root, encoding: 'utf8' });
};
function hookAsync(p, payload)
{
    return new Promise((resolve) =>
    {
        const child = spawn(process.execPath, [HOOK], { cwd: p.root, env: { ...process.env, CLAUDE_PROJECT_DIR: p.root } });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.on('close', (status) => resolve({ status, stdout, stderr: '' }));
        child.stdin.end(JSON.stringify({ cwd: p.root, ...payload }));
    });
}

test('PF-1: a preferences doc that is a link is never followed - no secret reaches a push, a code hold or a git hold', (t) =>
{
    const p = project({ docs: {} });
    try
    {
        p.write('.alfred/.sensitive-data', `DB_PASSWORD=${SECRET}\n## Leak\n- Rule: ${SECRET}\n`);
        const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-out-')), 'notes.md');
        fs.writeFileSync(outside, `## Outside\n- Rule: ${SECRET}\n`);
        fs.mkdirSync(path.join(p.root, PREFS), { recursive: true });
        const names = ['PERSONAL-PREFERENCES.md', 'PERSONAL-CODE-PREFERENCES.md', 'ARCHITECTURE-PREFERENCES.md', 'PROJECT-CODE-PREFERENCES.md', 'GIT-PREFERENCES.md'];
        try { names.forEach((n, i) => fs.symlinkSync(i % 2 ? outside : path.join(p.root, '.alfred', '.sensitive-data'), path.join(p.root, PREFS, n))); }
        catch { t.skip('no symlinks on this host'); return; }
        const s = sid();
        for (const r of [p.hook(start2(s, 'startup')), p.hook(edit('src/app.ts', s), {}, path.join(HOOKS, 'file-guards.js')), p.hook(bash('git add -A', s), {}, path.join(HOOKS, 'shell-guards.js'))])
            assert.doesNotMatch(all(r), new RegExp(SECRET), all(r));
        fs.rmSync(path.dirname(outside), { recursive: true, force: true });
    }
    finally { p.rm(); }
});

test('PF-2: a record that cannot be written falls back to the temp dir; with neither, the call passes with a one-line note', () =>
{
    const p = project();
    try
    {
        p.write('.alfred/state/sessions', 'a file where the folder goes');
        const s = sid();
        assert.ok(denied(p.hook(edit('src/app.ts', s))), 'the first edit is held');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'the retry passes - no deny loop');
        const blocked = path.join(p.root, 'not-a-dir');
        fs.writeFileSync(blocked, 'x');
        const u = sid();
        const r = p.hook(edit('src/app.ts', u), { TMPDIR: path.join(blocked, 'tmp'), TMP: path.join(blocked, 'tmp'), TEMP: path.join(blocked, 'tmp') });
        assert.ok(!denied(r), 'nowhere to record: fail open');
        assert.match(String(out(r).additionalContext || ''), /PERSONAL-CODE-PREFERENCES\.md/, 'and the note names the docs to read');
    }
    finally { p.rm(); }
});

test('PF-3: one command that edits and commits shares ONE room - git first, the code docs in what is left, under 10,000', () =>
{
    const fill = (prefix, n) => Array.from({ length: n }, (_, i) => `## ${prefix}${i + 1} - Entry ${i + 1}\n<!-- id: ${prefix.toLowerCase()}${i + 1} -->\n- Rule: ${'keep the code plain and readable here '.repeat(4)}${i}\n`).join('\n');
    const personal = `# Personal code preferences\n\nUpdated: 2026-10-21\n\n${fill('C', 14)}`;
    const arch = `# Architecture preferences\n\nUpdated: 2026-10-21\n\n${fill('A', 14)}`;
    const git = `${SEED}\n${fill('G', 8).replace(/## G(\d+)/g, (m, d) => `## G${Number(d) + 8}`).replace(/id: g(\d+)/g, (m, d) => `id: g${Number(d) + 8}`)}`;
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': personal, 'ARCHITECTURE-PREFERENCES.md': arch, 'PROJECT-CODE-PREFERENCES.md': PROJECT, 'GIT-PREFERENCES.md': git } });
    try
    {
        const s = sid();
        const r = p.hook(bash('echo y > src/a.ts && git commit -am x', s), {}, path.join(HOOKS, 'shell-guards.js'));
        const text = all(r);
        assert.ok(r.stdout.length < 10000, `stdout ${r.stdout.length}`);
        assert.match(text, /Do NOT commit or push until the user explicitly says to/);
        assert.match(text, /PERSONAL-CODE-PREFERENCES\.md/);
        assert.ok(text.indexOf('Do NOT commit') < text.indexOf('PERSONAL-CODE-PREFERENCES'), 'the git doc first');
        for (let k = 0; k < 3 && denied(p.hook(edit('src/app.ts', s))); k += 1) { /* what did not fit comes at the next edit */ }
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'and the holds end: no doc is handed over forever');
    }
    finally { p.rm(); }
});

test('PF-4: the Locked block is the seed\'s - an edited locked entry is handed over as the house line, an unknown key is a plain entry', () =>
{
    const edited = SEED.replace(/- Rule: Do NOT commit or push until[^\n]*/, '- Rule: commit when the task is done.')
        .replace(/## G4 - Keep history recoverable[\s\S]*?(?=## G5)/, '')
        + '\n## G9 - My own lock\n<!-- id: g9 -->\n<!-- locked: mine -->\n- Rule: mine-rule-text.\n';
    const p = project({ docs: { 'GIT-PREFERENCES.md': edited } });
    try
    {
        const text = reason(p.hook(bash('git commit -m x', sid())));
        const lockedAt = text.indexOf('Locked');
        const othersAt = text.indexOf('The other entries');
        assert.ok(lockedAt >= 0 && othersAt > lockedAt, text);
        const locked = text.slice(lockedAt, othersAt);
        assert.match(locked, /Do NOT commit or push until the user explicitly says to/, 'the seed\'s consent line, not the edit');
        assert.doesNotMatch(locked, /commit when the task is done/);
        assert.match(locked, /force-with-lease/, 'a locked entry removed from the doc is still handed over');
        assert.doesNotMatch(locked, /mine-rule-text/, 'an unknown locked key is no house line');
        assert.match(text.slice(othersAt), /mine-rule-text/);
        assert.match(text, /G1[^\n]*(differs|edited)[^\n]*house line/i, 'the edit is named');
    }
    finally { p.rm(); }
});

test('PF-4: with no seed beside the hook (a copy route without the skill), only the house keys are locked', () =>
{
    const p = project({ docs: { 'GIT-PREFERENCES.md': `${GIT}\n## G9 - Mine\n<!-- id: g9 -->\n<!-- locked: mine -->\n- Rule: mine-rule-text.\n` } });
    try
    {
        const dir = path.join(p.root, '.claude', 'hooks');
        fs.mkdirSync(dir, { recursive: true });
        for (const f of ['preferences-session.js', 'layout.js', 'shell-writes.js', 'hook-prelude.js']) fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
        const text = reason(p.hook(bash('git commit -m x', sid()), {}, path.join(dir, 'preferences-session.js')));
        const othersAt = text.indexOf('The other entries');
        assert.ok(othersAt > text.indexOf('Do NOT commit or push'), text);
        assert.ok(text.indexOf('mine-rule-text') > othersAt, 'an unknown key is a plain entry');
    }
    finally { p.rm(); }
});

test('PF-5: a capture\'s writes under the docs root pass; a plan still waits and so does code', () =>
{
    const p = project();
    try
    {
        for (const f of ['.alfred/docs/architecture/ARCHITECTURE.md', '.alfred/docs/awareness/project.md', '.alfred/docs/quality/report.md', '.alfred/docs/ORIENTATION.md', '.alfred/.sensitive-data'])
            assert.ok(!denied(p.hook(pre('Write', { file_path: f, content: 'x' }, sid()))), f);
        assert.ok(denied(p.hook(pre('Write', { file_path: '.alfred/docs/work/plans/p.md', content: 'x' }, sid()))));
        assert.ok(denied(p.hook(pre('Write', { file_path: '.alfred/docs/plans/old.md', content: 'x' }, sid()))), 'the pre-2.8.0 plans folder too');
        assert.ok(denied(p.hook(pre('Write', { file_path: 'src/a.ts', content: 'x' }, sid()))));
    }
    finally { p.rm(); }
});

test('PF-6: the navigation server\'s rename and safe delete are edits', () =>
{
    const p = project();
    try
    {
        for (const tool of ['mcp__plugin_alfred-navigation_alfred-navigation__rename_symbol', 'mcp__alfred-navigation__safe_delete_symbol']) // mcp-fixture: the copy route spells it bare
        {
            const r = p.hook(pre(tool, { name_path: 'x', relative_path: 'src/app.ts', new_name: 'y' }, sid()));
            assert.ok(denied(r), tool);
            assert.match(reason(r), /Single quotes/, `${tool}: the target picks its section`);
        }
    }
    finally { p.rm(); }
});

test('PF-7 / G1: a seat in .claude/worktrees is held like the project, and a linked worktree reads the main checkout\'s docs', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'PROJECT-CODE-PREFERENCES.md': PROJECT } });
    const wt = `${p.root}-wt`;
    try
    {
        commit(p.root);
        const inner = path.join(p.root, '.claude', 'worktrees', 'agent-1');
        spawnSync('git', ['worktree', 'add', '-q', inner], { cwd: p.root });
        const s = sid();
        const seat = p.hook({ ...edit(path.join(inner, 'src', 'app.ts'), s, { agent_id: 'agent-1' }), cwd: inner });
        assert.ok(denied(seat), 'a seat\'s worktree edit is a project edit');
        assert.match(reason(seat), /Single quotes/, 'its target maps back to src/app.ts');
        assert.ok(denied(p.hook({ ...bash('echo y > src/b.ts', s, { agent_id: 'agent-2' }), cwd: inner })), 'a shell write from the worktree too');
        assert.ok(!denied(p.hook({ ...edit(path.join(inner, '.claude', 'settings.json'), s, { agent_id: 'agent-3' }), cwd: inner })), 'the worktree\'s own .claude stays exempt');
        spawnSync('git', ['worktree', 'add', '-q', wt], { cwd: p.root });
        const env = { CLAUDE_PROJECT_DIR: wt };
        assert.match(pushed(p.hook({ ...start2(sid(), 'startup'), cwd: wt }, env)), /lead with the verdict/, 'the push finds the main checkout\'s docs');
        assert.ok(denied(p.hook({ ...edit('src/app.ts', sid()), cwd: wt }, env)), 'and so does the hold');
    }
    finally { spawnSync('git', ['worktree', 'prune'], { cwd: p.root }); fs.rmSync(wt, { recursive: true, force: true }); p.rm(); }
});

test('Q-1: a sibling worktree holding only the tracked git doc reads the personal docs git keeps out from the main checkout', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'GIT-PREFERENCES.md': GIT } });
    const wt = `${p.root}-wt`;
    try
    {
        p.write('.gitignore', '/.alfred/*\n!/.alfred/docs/\n/.alfred/docs/preferences/PERSONAL-PREFERENCES.md\n/.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md\n');
        commit(p.root);
        spawnSync('git', ['worktree', 'add', '-q', wt], { cwd: p.root });
        assert.ok(fs.existsSync(path.join(wt, PREFS, 'GIT-PREFERENCES.md')) && !fs.existsSync(path.join(wt, PREFS, 'PERSONAL-PREFERENCES.md')), 'the fixture: git carries the git doc alone');
        const env = { CLAUDE_PROJECT_DIR: wt };
        assert.match(pushed(p.hook({ ...start2(sid(), 'startup'), cwd: wt }, env)), /lead with the verdict/, 'the push falls back to the main checkout\'s personal doc');
        const held = p.hook({ ...edit('src/app.ts', sid()), cwd: wt }, env);
        assert.ok(denied(held), held.stdout);
        assert.match(reason(held), /put behaviour on the type that owns the data/, 'the personal code doc from the main checkout');
        p.write(path.join('..', path.basename(wt), PREFS, 'PERSONAL-PREFERENCES.md'), PERSONAL_PREFS.replace('lead with the verdict', 'answer in one line'));
        assert.match(pushed(p.hook({ ...start2(sid(), 'startup'), cwd: wt }, env)), /answer in one line/, 'the worktree\'s own copy wins');
    }
    finally { spawnSync('git', ['worktree', 'prune'], { cwd: p.root }); fs.rmSync(wt, { recursive: true, force: true }); p.rm(); }
});

test('PF-9: parallel actors each keep their own record - every one is held exactly once', async () =>
{
    const p = project();
    try
    {
        const s = sid();
        const actors = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
        const first = await Promise.all(actors.map((a) => hookAsync(p, edit('src/app.ts', s, { agent_id: a }))));
        first.forEach((r, i) => assert.ok(denied(r), `${actors[i]} first`));
        for (const a of actors) assert.ok(!denied(p.hook(edit('src/app.ts', s, { agent_id: a }))), `${a} is not held twice`);
    }
    finally { p.rm(); }
});

test('PF-10: a session started in a subfolder finds the project\'s docs', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'PROJECT-CODE-PREFERENCES.md': PROJECT } });
    try
    {
        const sub = path.join(p.root, 'src');
        const env = { CLAUDE_PROJECT_DIR: sub };
        assert.match(pushed(p.hook({ ...start2(sid(), 'startup'), cwd: sub }, env)), /lead with the verdict/);
        const r = p.hook({ ...edit('app.ts', sid()), cwd: sub }, env);
        assert.ok(denied(r));
        assert.match(reason(r), /Single quotes/, 'the target is src/app.ts of the project');
        assert.ok(!fs.existsSync(path.join(sub, '.alfred')), 'nothing is written under the subfolder');
    }
    finally { p.rm(); }
});

test('PF-11 / G14: the push strips block and inline comments, keeps fenced text, pushes prose with no entry, refuses binary, cuts a long line', () =>
{
    const cases = [
        { doc: '# Personal preferences\n\nUpdated: 2026-10-21\n\n<!--\nhidden-example\n-->\n## P1 - Short\n- Rule: be short. <!-- inline-note -->\n', has: [/be short\./], not: [/hidden-example/, /inline-note/, /<!--/] },
        { doc: '# Personal preferences\n\nUpdated: 2026-10-21\n\n## P1 - Shape\n- Rule: like this:\n\n```\n<!-- id: kept-in-fence -->\n## not-an-entry\n```\n', has: [/kept-in-fence/, /## not-an-entry/] },
        { doc: '# Personal preferences\n\nUpdated: 2026-10-21\n\nAlways answer in Ukrainian.\n', has: [/Always answer in Ukrainian/] },
        { doc: `# Personal preferences\n\n## P1 - x\n- Rule: ${'word '.repeat(1200)}\n`, has: [/word word/], long: true },
        { doc: '# Personal preferences\n\n## P1 - x\n- Rule: a\u0000b\n', empty: true },
    ];
    for (const c of cases)
    {
        const p = project({ docs: { 'PERSONAL-PREFERENCES.md': c.doc } });
        try
        {
            const text = pushed(p.hook(start2(sid(), 'startup')));
            if (c.empty) { assert.strictEqual(text, '', 'a binary doc pushes nothing'); continue; }
            for (const re of c.has) assert.match(text, re, JSON.stringify(c.doc.slice(0, 80)));
            for (const re of c.not || []) assert.doesNotMatch(text, re);
            if (c.long) assert.ok(text.length > 2500 && text.length < 4000, `long line pushed ${text.length}`);
        }
        finally { p.rm(); }
    }
});

test('PF-12 / G3: clear and compact clear the main record; a seat\'s own compaction clears only that seat and pushes nothing', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL } });
    try
    {
        const s = sid();
        p.hook(edit('src/app.ts', s));
        p.hook(edit('src/app.ts', s, { agent_id: 'agent-1' }));
        p.hook(start2(s, 'resume'));
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'resume keeps the record');
        const seatStart = p.hook(start2(s, 'compact', { agent_id: 'agent-1', agent_type: 'alfred-code:web-angular-implementer' }));
        assert.strictEqual(seatStart.stdout, '', 'the personal doc is the main session\'s');
        assert.ok(!p.exists(record(s, 'agent-1')), 'the seat\'s record goes');
        assert.ok(p.exists(record(s, 'main')), 'the main record stays');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'so main is not handed the docs again');
        assert.ok(denied(p.hook(edit('src/app.ts', s, { agent_id: 'agent-1' }))), 'the seat is');
        p.hook(start2(s, 'clear'));
        assert.ok(denied(p.hook(edit('src/app.ts', s))), '/clear dropped the docs: held again');
    }
    finally { p.rm(); }
});

test('PF-13: a release and a worktree branch are git writes', () =>
{
    const p = project();
    try
    {
        for (const cmd of ['gh release create v1.0.0 --notes x', 'gh release delete v1 -y', 'gh release edit v1 --draft=false', 'git worktree add -b feat ../wt', 'git worktree add -B feat ../wt'])
            assert.ok(denied(p.hook(bash(cmd, sid()))), cmd);
        for (const cmd of ['gh release view v1', 'gh release list', 'git worktree list'])
            assert.ok(!denied(p.hook(bash(cmd, sid()))), cmd);
    }
    finally { p.rm(); }
});

test('H-Q1: only a whole read marks a doc - a ranged Read, head, grep -c, a name in an echo and a docs.js toc do not', () =>
{
    const p = project({ docs: { 'GIT-PREFERENCES.md': GIT } });
    try
    {
        const doc = `${PREFS}/GIT-PREFERENCES.md`;
        for (const peek of [pre('Read', { file_path: doc, limit: 3 }, null), pre('Read', { file_path: doc, offset: 5 }, null), bash(`head -n 2 ${doc}`, null), bash(`grep -c Rule ${doc}`, null),
            bash('echo GIT-PREFERENCES.md && cat README.md', null), bash('node .claude/hooks/docs.js show GIT-PREFERENCES', null), bash(`cat ${doc} | head -3`, null)])
        {
            const s = sid();
            p.hook({ ...peek, session_id: s });
            assert.ok(denied(p.hook(bash('git commit -m x', s))), JSON.stringify(peek.tool_input));
        }
        for (const whole of [pre('Read', { file_path: doc }, null), pre('Read', { file_path: doc, offset: 1, limit: 2000 }, null), bash(`cat ${doc}`, null), bash(`cd ${PREFS} && cat GIT-PREFERENCES.md`, null)])
        {
            const s = sid();
            p.hook({ ...whole, session_id: s });
            assert.ok(!denied(p.hook(bash('git commit -m x', s))), JSON.stringify(whole.tool_input));
        }
    }
    finally { p.rm(); }
});

test('G6: a second language\'s project section is handed over at its first edit', () =>
{
    const p = project();
    try
    {
        const s = sid();
        assert.ok(denied(p.hook(edit('src/app.ts', s))));
        assert.ok(!denied(p.hook(edit('src/app.ts', s))));
        const cs = p.hook(edit('api/Orders.cs', s));
        assert.ok(denied(cs), 'the C# section was never handed over');
        assert.match(reason(cs), /File-scoped namespaces/);
        assert.doesNotMatch(reason(cs), /put behaviour on the type|Single quotes/, 'what was handed stays handed');
        assert.ok(!denied(p.hook(edit('api/Orders.cs', s))));
        assert.ok(!denied(p.hook(edit('README.md', s))), 'a file no section covers waits for nothing more');
    }
    finally { p.rm(); }
});

test('G5: a solution designer is handed the code docs at its start; other seats are not', () =>
{
    const p = project();
    try
    {
        const sub = (type) => ({ hook_event_name: 'SubagentStart', session_id: sid(), agent_id: 'agent-9', agent_type: type });
        const r = p.hook(sub('alfred-code:aspnet-solution-designer'));
        assert.strictEqual(out(r).hookEventName, 'SubagentStart', r.stdout);
        const text = String(out(r).additionalContext || '');
        assert.match(text, /put behaviour on the type/);
        assert.match(text, /a handler validates/);
        assert.match(text, /Single quotes|File-scoped namespaces/);
        assert.ok(text.length < 9000, `${text.length}`);
        for (const type of ['general-purpose', 'alfred-code:web-angular-implementer', 'Explore'])
            assert.strictEqual(p.hook(sub(type)).stdout, '', type);
        assert.strictEqual(p.hook(sub('alfred-code:aspnet-solution-designer'), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '');
    }
    finally { p.rm(); }
});
