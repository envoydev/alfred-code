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

// `tools` keeps the tool-order start line on: off, the hook's every other push is tested as it was before the line came.
// `host` keeps the host's shell lines on: off, a push does not depend on the $SHELL or the OS the suite runs on, even where a
// case names its own off-list.
// The account config is a folder of the test's own, so this machine's enabled plugins never reach the line.
function project({ docs = { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE, 'PROJECT-CODE-PREFERENCES.md': PROJECT, 'GIT-PREFERENCES.md': GIT }, watch = true, tools = false, host = false } = {})
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-hook-')));
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-config-'));
    const write = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    write('.gitignore', '.alfred/\n');
    write('src/app.ts', 'export const x = 1;\n');
    write('.claude/settings.json', JSON.stringify({ enabledPlugins: { 'alfred-navigation@envoydev': true, 'alfred-documentation@envoydev': true, 'alfred-memory@envoydev': true } }));
    for (const [name, text] of Object.entries(docs)) write(path.join(PREFS, name), text);
    if (watch && Object.keys(docs).length) write(path.join(PREFS, 'watch.json'), '{}\n');
    const env = (extra = {}) =>
    {
        const off = ['ALFRED_CODE_HOOKS_OFF' in extra ? extra.ALFRED_CODE_HOOKS_OFF : (tools ? '' : 'preferences-session:tools'), host ? '' : 'preferences-session:host'].filter(Boolean).join(',');
        return { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_CONFIG_DIR: config, ...extra, ...(off ? { ALFRED_CODE_HOOKS_OFF: off } : {}) };
    };
    const hook = (payload, extra = {}, file = HOOK) => spawnSync(process.execPath, [file], { cwd: root, input: typeof payload === 'string' ? payload : JSON.stringify({ cwd: root, ...payload }), encoding: 'utf8', env: env(extra) });
    return {
        root, write, hook,
        read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
        exists: (rel) => fs.existsSync(path.join(root, rel)),
        rm: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(config, { recursive: true, force: true }); },
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
        const notPasted = (/Not pasted here[^\n]*/.exec(text) || [''])[0];
        assert.doesNotMatch(notPasted, /TypeScript|Project type/, 'a pasted section is never also named as not pasted');
        assert.doesNotMatch(text, /<!--/, 'comment lines stay out');
        assert.doesNotMatch(text, /Do NOT commit or push/, 'the git doc waits for a git write');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))), 'the retry goes through');
        assert.ok(!denied(p.hook(edit('src/other.ts', s))), 'and every later edit of the actor');
        const rows = p.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').map((l) => JSON.parse(l));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].hook, 'preferences-session.js');
        assert.strictEqual(rows[0].kind, 'code');
        const state = JSON.parse(p.read(`.alfred/state/sessions/preferences-${s}-main.json`));
        assert.deepStrictEqual(Object.keys(state).sort(), ['ARCHITECTURE#a1', 'PERSONAL-CODE#c1', 'PROJECT-CODE#project-type', 'PROJECT-CODE#typescript'], 'the C# section waits for a C# edit');
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
        assert.ok(JSON.parse(p.read(`.alfred/state/sessions/preferences-${s}-main.json`))['PERSONAL-CODE#c1'], 'and it is written whole again');
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

// ---- the hand-over is capped, never the user's docs (the user's ruling of 2026-10-22) -------------------------------
const entry = (id, title, body) => `## ${id.toUpperCase()} - ${title}\n<!-- id: ${id} -->\n${body}\n`;
const codeDoc = (...entries) => `# Personal code preferences\n\nUpdated: 2026-10-22\n\n${entries.join('\n')}`;

test('the hand-over leaves out each entry\'s Check: line and keeps its Why:', () =>
{
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(entry('c1', 'No static classes', '- Rule: model behaviour as instances behind an interface.\n- Scope: every language\n- Why: testable without touching callers.\n- Check: regex `static class` in `src/**/*.cs`')) } });
    try
    {
        const text = reason(p.hook(edit('src/app.ts', sid())));
        assert.match(text, /model behaviour as instances/);
        assert.match(text, /testable without touching callers/, 'the Why: stays');
        assert.doesNotMatch(text, /Check:/, 'the Check: is the script\'s data, never pasted');
    }
    finally { p.rm(); }
});

test('an entry whose Scope: globs miss the edited file is named, and handed over at the first edit they reach', () =>
{
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(
        entry('c1', 'Records for DTOs', '- Rule: a DTO is a record.\n- Scope: api/**/*.cs'),
        entry('c2', 'Readonly fields', '- Rule: prefer readonly fields.\n- Scope: *.ts'),
        entry('c3', 'Small units', '- Rule: one reason to change per unit.\n- Scope: every language, Node.js'),
        entry('c4', 'No barrels inside a feature', '- Rule: import a sibling file directly.'),
    ) } });
    try
    {
        const s = sid();
        const ts = reason(p.hook(edit('src/app.ts', s)));
        assert.match(ts, /prefer readonly fields/, 'a bare *.ts reaches a file in any folder');
        assert.match(ts, /one reason to change per unit/, 'a plain-area Scope: is handed over for every edit');
        assert.match(ts, /import a sibling file directly/, 'and so is an entry with no Scope:');
        assert.doesNotMatch(ts, /a DTO is a record/, 'the C# entry is not pasted for a TypeScript edit');
        assert.match(ts, /C1 - Records for DTOs/, 'it is named instead');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))));
        const cs = p.hook(edit('api/Orders/Order.cs', s));
        assert.ok(denied(cs), 'the first C# edit waits for the C# entry');
        assert.match(reason(cs), /a DTO is a record/);
        assert.doesNotMatch(reason(cs), /prefer readonly fields/, 'what was handed stays handed');
        assert.ok(!denied(p.hook(edit('api/Orders/Order.cs', s))));
        assert.match(reason(p.hook(edit('api/Program.cs', sid()))), /a DTO is a record/, 'api/**/*.cs reaches a file straight under api/');
    }
    finally { p.rm(); }
});

test('docs past one room are handed over in parts: each retry brings the next part, and the docs after them wait', () =>
{
    // 14 entries of about 830 chars - some 11,700 chars, past what one denial holds.
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        const s = sid();
        const texts = [];
        for (let r = p.hook(edit('src/app.ts', s)); denied(r); r = p.hook(edit('src/app.ts', s)))
        {
            texts.push(reason(r));
            assert.ok(texts.length < 5, 'the holds end');
        }
        assert.strictEqual(texts.length, 2, texts.map((t) => t.length).join(', '));
        for (const t of texts) assert.ok(t.length < 9000, `${t.length} chars`);
        assert.match(texts[0], /retry/i, 'the first part says the next one comes with the retry');
        assert.doesNotMatch(texts[0], /a handler validates/, 'the architecture doc waits behind the personal one');
        assert.match(texts[1], /a handler validates/);
        const seen = new Set(texts.flatMap((t) => [...t.matchAll(/rule number (\d+) /g)].map((m) => Number(m[1]))));
        assert.deepStrictEqual([...seen].sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1), 'every entry handed over once');

        const t = sid();
        assert.ok(denied(p.hook(edit('src/app.ts', t))));
        p.hook(pre('Read', { file_path: path.join(p.root, PREFS, 'PERSONAL-CODE-PREFERENCES.md') }, t));
        const next = reason(p.hook(edit('src/app.ts', t)));
        assert.match(next, /a handler validates/, 'a whole Read ends the parts; the doc behind it comes next');
        assert.doesNotMatch(next, /rule number/);
        assert.ok(!denied(p.hook(edit('src/app.ts', t))));

        const push = String(out(p.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_id: 'agent-9', agent_type: 'alfred-code:aspnet-solution-designer' })).additionalContext || '');
        assert.ok(push.length < 9000, `${push.length}`);
        assert.match(push, /rule number 1 /);
        assert.match(push, /C14 - Entry 14/, 'what did not fit is listed');
        assert.match(push, /first Read or symbol lookup hands them over/, 'and comes with the seat\'s first Read');
    }
    finally { p.rm(); }
});

test('an entry too long for any room is cut once, naming the file, and the next hold moves on', () =>
{
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(entry('c1', 'Huge', `- Rule: ${'a very long rule text. '.repeat(450)}`)), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        const s = sid();
        const first = reason(p.hook(edit('src/app.ts', s)));
        assert.match(first, /more chars: Read \S*PERSONAL-CODE-PREFERENCES\.md/);
        const second = p.hook(edit('src/app.ts', s));
        assert.ok(denied(second), 'the architecture doc had no room left');
        assert.match(reason(second), /a handler validates/);
        assert.doesNotMatch(reason(second), /a very long rule/, 'the cut entry is not handed over again');
        assert.ok(!denied(p.hook(edit('src/app.ts', s))));
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
        .replace(/## G3 - Never lose work[\s\S]*?(?=## G4)/, '')
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

test('a forge write on any transport is a git write: other CLIs and MCP servers, by concept', () =>
{
    const p = project();
    const mcpCall = (tool, input, s) => ({ ...bash('true', s), tool_name: tool, tool_input: input });
    try
    {
        for (const cmd of ['glab mr create --fill', 'glab mr merge 4', 'tea releases create --tag v1', 'az repos pr update --id 3 --status completed'])
            assert.ok(denied(p.hook(bash(cmd, sid()))), cmd);
        for (const [tool, input] of [['mcp__gitlab__create_merge_request', { title: 't' }], ['mcp__ado__repo_pull_request_write', { action: 'update', autoComplete: true }], ['mcp__github__push_files', { branch: 'main', files: [] }], ['mcp__gitlab__create_release', { tag_name: 'v1' }]])
            assert.ok(denied(p.hook(mcpCall(tool, input, sid()))), tool);
        for (const [tool, input] of [['mcp__gitlab__get_merge_request', { merge_request_iid: 4 }], ['mcp__github__pull_request_read', { method: 'get_diff' }], ['mcp__fs__write_file', { path: 'a', content: 'b' }], ['mcp__github__add_issue_comment', { body: 'x' }]])
            assert.ok(!denied(p.hook(mcpCall(tool, input, sid()))), tool);
        for (const cmd of ['glab mr view 4', 'glab ci status --live', 'echo glab mr merge 4'])
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

test('G5: a solution designer and a verifier are handed the code docs at their start; other seats are not', () =>
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
        const v = String(out(p.hook(sub('alfred-code:aspnet-verifier'))).additionalContext || '');
        assert.match(v, /put behaviour on the type/, 'a verifier is handed them too');
        assert.match(v, /a handler validates/);
        assert.strictEqual(p.hook(sub('web-angular-verifier')).stdout, '', 'bare, with no stamp recording the copy: no seat of the stack\'s');
        p.write('.claude/alfred-code.stamp', 'seats-route: copy\nlibrary-agents: web-angular-verifier=0a1b\n');
        assert.match(String(out(p.hook(sub('web-angular-verifier'))).additionalContext || ''), /a handler validates/, 'bare too, where the stamp records the copy');
        for (const type of ['general-purpose', 'alfred-code:web-angular-implementer', 'Explore', 'agent-sdk-dev:agent-sdk-verifier-py', 'other:code-verifier', 'other:aspnet-solution-designer'])
            assert.strictEqual(p.hook(sub(type)).stdout, '', `${type}: only the stack's own seats, bare or alfred-code:`);
        assert.strictEqual(p.hook(sub('alfred-code:aspnet-solution-designer'), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '');
    }
    finally { p.rm(); }
});

test('the finding seats - the code-quality analyzer, the security auditor, the integration reviewer - are judges too; the other read-only seats are not', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const small = project();
    const big = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        for (const q of [small, big]) q.write('.claude/alfred-code.stamp', 'library-agents: code-quality-analyzer=1,integration-reviewer=2\n');
        const sub = (type, s = sid()) => ({ hook_event_name: 'SubagentStart', session_id: s, agent_id: 'agent-f1', agent_type: type });
        for (const type of ['alfred-code:code-quality-analyzer', 'code-quality-analyzer', 'alfred-code:security-auditor', 'alfred-code:integration-reviewer', 'integration-reviewer'])
        {
            assert.match(String(out(small.hook(sub(type))).additionalContext || ''), /a handler validates/, `${type}: handed at its start`);
            const s = sid();
            assert.match(String(out(big.hook(sub(type, s))).additionalContext || ''), /Not pasted yet/, `${type}: the rest named`);
            const r = big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s, { agent_id: 'f1', agent_type: type }));
            assert.ok(denied(r), `${type}: its first Read brings the next part`);
            assert.match(reason(r), /now make the read again/);
        }
        for (const type of ['alfred-code:code-style-analyzer', 'alfred-code:test-coverage-analyzer', 'alfred-code:issue-diagnoser-ci', 'alfred-code:evidence-gatherer', 'other:code-quality-analyzer-lite', 'someplugin:security-auditor', 'other:integration-reviewer', 'other:code-quality-analyzer'])
            assert.strictEqual(small.hook(sub(type)).stdout, '', type);
        // Another plugin's seat under one of these names is not the stack's: no push, and its Reads are never held.
        for (const type of ['someplugin:security-auditor', 'other:aspnet-verifier'])
        {
            const s = sid();
            assert.strictEqual(big.hook(sub(type, s)).stdout, '', type);
            assert.ok(!denied(big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s, { agent_id: 'f1', agent_type: type }))), `${type}: its Read passes`);
        }
    }
    finally { small.rm(); big.rm(); }
});

test('a designer or verifier whose docs fit one room is never held on a Read; nor is any other actor', () =>
{
    const p = project();
    try
    {
        const s = sid();
        const read = (file, extra) => pre('Read', { file_path: path.join(p.root, file) }, s, extra);
        for (const [id, type] of [['x1', 'alfred-code:aspnet-solution-designer'], ['x2', 'alfred-code:aspnet-verifier']])
        {
            assert.match(String(out(p.hook({ hook_event_name: 'SubagentStart', session_id: s, agent_id: id, agent_type: type })).additionalContext || ''), /a handler validates/);
            assert.ok(!denied(p.hook(read('src/app.ts', { agent_id: id, agent_type: type }))), `${type}: everything came with the start`);
        }
        assert.ok(!denied(p.hook(read('src/app.ts'))), 'the main session');
        assert.ok(!denied(p.hook(read('src/app.ts', { agent_id: 'x3', agent_type: 'alfred-code:aspnet-implementer' }))), 'an implementer - its edits are held instead');
    }
    finally { p.rm(); }
});

test('docs past one room reach a designer or verifier in parts: its first Reads are held, each handing over the next part', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        p.write('.claude/alfred-code.stamp', 'library-agents: aspnet-verifier=1\n');
        for (const [startId, toolId, type] of [['agent-d1', 'd1', 'alfred-code:aspnet-solution-designer'], ['v1', 'v1', 'aspnet-verifier']])
        {
            const s = sid();
            const push = String(out(p.hook({ hook_event_name: 'SubagentStart', session_id: s, agent_id: startId, agent_type: type })).additionalContext || '');
            const texts = [push];
            const read = (file) => pre('Read', { file_path: path.join(p.root, file) }, s, { agent_id: toolId, agent_type: type });
            assert.ok(!denied(p.hook(read(`${PREFS}/GIT-PREFERENCES.md`))), `${type}: a read of a preferences doc is never held`);
            let r = p.hook(read('src/app.ts'));
            assert.ok(denied(r), `${type}: the first Read after a start that could not hold everything waits`);
            for (; denied(r); r = p.hook(read('src/app.ts')))
            {
                texts.push(reason(r));
                assert.ok(texts.length < 6, 'the holds end');
            }
            for (const t of texts) assert.ok(t.length < 9000, `${t.length} chars`);
            assert.match(texts[1], /now make the read again/, 'the denial says to read again');
            const seen = texts.flatMap((t) => [...t.matchAll(/rule number (\d+) /g)].map((m) => Number(m[1])));
            assert.deepStrictEqual(seen.slice().sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1), `${type}: every entry handed over exactly once`);
            assert.ok(texts.some((t) => /a handler validates/.test(t)), 'and the doc behind them');
            assert.ok(!denied(p.hook(read('src/other.ts'))), 'every later Read passes');
            const rows = p.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').map((l) => JSON.parse(l));
            assert.ok(rows.every((x) => x.kind === 'read'), JSON.stringify(rows));
        }

        const t = sid();
        assert.ok(denied(p.hook(pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, t, { agent_id: 'v2', agent_type: 'alfred-code:aspnet-verifier' }))), 'a verifier whose start never ran is handed the docs at its first Read');
    }
    finally { p.rm(); }
});

test('a navigation lookup is a read: a designer\'s or verifier\'s first symbol lookup is held like its first Read', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        const lookups = [
            ['mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', { name_path_pattern: 'x', include_body: true }], // mcp-fixture
            ['mcp__alfred-navigation__get_symbols_overview', { relative_path: 'src/app.ts' }], // mcp-fixture: the copy route spells the server bare
            ['mcp__plugin_alfred-navigation_alfred-navigation__find_referencing_symbols', { name_path: 'x', relative_path: 'src/app.ts' }], // mcp-fixture
            ['mcp__plugin_alfred-navigation_alfred-navigation__find_declaration', { name_path: 'x' }], // mcp-fixture
            ['mcp__plugin_alfred-navigation_alfred-navigation__find_implementations', { name_path: 'x' }], // mcp-fixture
        ];
        for (const [tool, input] of lookups)
        {
            const s = sid();
            const who = { agent_id: 'v1', agent_type: 'alfred-code:aspnet-verifier' };
            p.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who });
            const r = p.hook(pre(tool, input, s, who));
            assert.ok(denied(r), `${tool}: held`);
            assert.match(reason(r), /rule number 14 /, `${tool}: it hands over the next part`);
            assert.ok(!denied(p.hook(pre(tool, input, s, { agent_id: 'i1', agent_type: 'alfred-code:aspnet-implementer' }))), `${tool}: an implementer's lookup is not`);
            assert.ok(!denied(p.hook(pre(tool, input, s))), `${tool}: nor the main session's`);
        }
        const s = sid();
        const who = { agent_id: 'd1', agent_type: 'alfred-code:aspnet-solution-designer' };
        p.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who });
        const nav = lookups[0];
        let holds = 0;
        for (let r = p.hook(pre(nav[0], nav[1], s, who)); denied(r); r = p.hook(pre(nav[0], nav[1], s, who))) assert.ok(++holds < 5, 'the holds end');
        assert.ok(holds >= 1);
        assert.ok(!denied(p.hook(pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, s, who))), 'what a lookup handed over a Read does not ask for again');
    }
    finally { p.rm(); }
});

// 2026-10-22, the user's ruling 'Hold both, steer off Grep': a Grep or an LSP call reads code as a Read does, so a judge that
// greps instead of locating no longer skips the parts its start could not hold - and a held Grep says to locate instead.
test('a Grep or an LSP call is a read: a judge\'s first one is held like its first Read, and a held Grep steers to the navigation server', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    const STEER = /^Locate a symbol through the navigation tools your start line orders \(LSP first\) - Grep is for a literal you already located\.$/m;
    try
    {
        const calls = [
            ['Grep', { pattern: 'Order', path: path.join(p.root, 'src') }],
            ['Grep', { pattern: 'Order', glob: '*.ts' }],
            ['Grep', { pattern: 'Order', path: 'src' }],
            ['LSP', { operation: 'findReferences', filePath: path.join(p.root, 'src/app.ts'), line: 1, character: 14 }],
            ['LSP', { operation: 'workspaceSymbol', filePath: 'src/app.ts', line: 1, character: 1, query: 'x' }],
        ];
        for (const [tool, input] of calls)
        {
            const s = sid();
            const who = { agent_id: 'v1', agent_type: 'alfred-code:aspnet-verifier' };
            p.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who });
            const label = `${tool} ${JSON.stringify(input)}`;
            assert.ok(!denied(p.hook(pre(tool, { ...input, path: path.join(p.root, PREFS), filePath: path.join(p.root, PREFS, 'PERSONAL-CODE-PREFERENCES.md') }, s, who))), `${label}: one on the preferences folder passes`);
            const r = p.hook(pre(tool, input, s, who));
            assert.ok(denied(r), `${label}: held`);
            assert.match(reason(r), /rule number 14 /, `${label}: it hands over the next part`);
            assert.match(reason(r), /now make the read again/);
            if (tool === 'Grep') assert.match(reason(r), STEER, 'a held Grep steers to the navigation server');
            else assert.doesNotMatch(reason(r), STEER, 'an LSP call is already the right tool');
            let holds = 1;
            for (let q = p.hook(pre(tool, input, s, who)); denied(q); q = p.hook(pre(tool, input, s, who))) assert.ok(++holds < 6, 'the holds end');
            assert.ok(!denied(p.hook(pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, s, who))), `${label}: what it handed over a Read does not ask for again`);
            assert.ok(!denied(p.hook(pre(tool, input, s, { agent_id: 'i1', agent_type: 'alfred-code:aspnet-implementer' }))), `${label}: an implementer's is not held`);
            assert.ok(!denied(p.hook(pre(tool, input, s))), `${label}: nor the main session's`);
            assert.ok(!denied(p.hook(pre(tool, input, s, { agent_id: 'o1', agent_type: 'other:aspnet-verifier' }))), `${label}: nor another plugin's seat`);
        }
        const s = sid();
        const who = { agent_id: 'q1', agent_type: 'alfred-code:code-quality-analyzer' };
        p.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who });
        const viaFiles = p.hook(pre('Grep', { pattern: 'Order' }, s, who), {}, path.join(HOOKS, 'file-guards.js'));
        assert.ok(denied(viaFiles) && STEER.test(reason(viaFiles)), `the file guards carry the Grep hold: ${viaFiles.stdout}`);
    }
    finally { p.rm(); }
});

// 2026-10-22, the user's 'close' of the four design limits. A bare seat name is the copy route's spelling, so it is the
// stack's own seat only where the install stamp records that copy - a project's own `security-auditor` is not.
test('a bare seat name is the stack\'s own only where the install stamp records its copy; alfred-code: always is', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        const sub = (type, s) => p.hook({ hook_event_name: 'SubagentStart', session_id: s, agent_id: 'b1', agent_type: type });
        const read = (type, s) => p.hook(pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, s, { agent_id: 'b1', agent_type: type }));
        const pushedTo = (type) => { const s = sid(); const r = sub(type, s); return { push: r.stdout !== '', held: denied(read(type, s)) }; };
        assert.deepStrictEqual(pushedTo('security-auditor'), { push: false, held: false }, 'no stamp: a project\'s own agent');
        assert.deepStrictEqual(pushedTo('alfred-code:security-auditor'), { push: true, held: true }, 'the plugin spelling needs no stamp');
        p.write('.claude/alfred-code.stamp', 'seats-route: plugin\nlibrary-agents: \n');
        assert.deepStrictEqual(pushedTo('security-auditor'), { push: false, held: false }, 'a plugin-route stamp copies no seat');
        p.write('.claude/alfred-code.stamp', 'seats-route: copy\nlibrary-agents: aspnet-verifier=ab12,security-auditor=cd34\n');
        assert.deepStrictEqual(pushedTo('security-auditor'), { push: true, held: true }, 'a recorded copy');
        assert.deepStrictEqual(pushedTo('aspnet-verifier'), { push: true, held: true });
        assert.deepStrictEqual(pushedTo('wpf-verifier'), { push: false, held: false }, 'a copy the stamp does not record');
        p.write('.claude/alfred-code.stamp', '\u0000garbage\nlibrary-agents');
        assert.deepStrictEqual(pushedTo('security-auditor'), { push: false, held: false }, 'a garbage stamp records nothing, and nothing crashes');
    }
    finally { p.rm(); }
});

// A judge's shell read of code reads as its Read does, so it brings the next part too; the docs.js show it is told to
// run for the rest, a read of the docs themselves and every other command pass.
test('a judge\'s first shell read of code is held like its first Read; the docs, docs.js and other commands pass', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    const STEER = /^Locate a symbol through the navigation tools your start line orders \(LSP first\) - Grep is for a literal you already located\.$/m;
    try
    {
        const who = { agent_id: 's1', agent_type: 'alfred-code:aspnet-verifier' };
        const fresh = () => { const s = sid(); p.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who }); return s; };
        let s = fresh();
        for (const command of ['node .claude/hooks/docs.js show PERSONAL-CODE-PREFERENCES#c14', 'ls src', 'git status', 'wc -l src/app.ts', 'git log | rg Order', 'rg Order < notes.txt', 'git diff | grep -n Order', 'grep -n Order', 'echo src/app.ts', `head -5 ${PREFS}/ARCHITECTURE-PREFERENCES.md`, 'ls src/*.ts', 'git log | Select-String Order', `find ${PREFS} -name '*.md' -exec cat {} +`, 'cat $UNSET/app.ts'])
            assert.ok(!denied(p.hook(bash(command, s, who))), `${command}: passes`);
        for (const [command, steer] of [['cat src/app.ts', false], ['grep -n Order src/app.ts', true], ["sed -n '1,5p' src/app.ts | head -3", false], ['rg -n x src', true], ['rg Order', true], ['grep -rn Order', true], ['cat a.txt | grep -R Order', true], ['egrep --recursive Order', true], ['F=src/app.ts; cat $F', false], ['cat src/*.ts', false], ['rg -n Order src/**/*.ts', true], ["find src -name '*.ts' -exec cat {} +", false], ['find . -exec grep -n Order {} ;', true], ['git ls-files | xargs grep -n Order', true], ['Get-ChildItem -Recurse *.ts | Select-String Order', true], ['Select-String -Path src/*.ts -Pattern Order', true]])
        {
            s = fresh();
            const r = p.hook(bash(command, s, who));
            assert.ok(denied(r), `${command}: held`);
            assert.match(reason(r), /rule number 14 /, `${command}: the next part`);
            assert.match(reason(r), /now make the read again/);
            assert.strictEqual(STEER.test(reason(r)), steer, `${command}: the steer line only on a grep`);
            let holds = 1;
            for (let q = p.hook(bash(command, s, who)); denied(q); q = p.hook(bash(command, s, who))) assert.ok(++holds < 6, 'the holds end');
            assert.ok(!denied(p.hook(pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, s, who))), `${command}: a later Read asks nothing again`);
            for (const other of [{ agent_id: 'i1', agent_type: 'alfred-code:aspnet-implementer' }, {}, { agent_id: 'o1', agent_type: 'other:aspnet-verifier' }])
                assert.ok(!denied(p.hook(bash(command, sid(), other))), `${command}: ${other.agent_type || 'the main session'} is never held`);
        }
        s = fresh();
        assert.ok(!denied(p.hook(bash(`cat ${PREFS}/PERSONAL-CODE-PREFERENCES.md ${PREFS}/ARCHITECTURE-PREFERENCES.md`, s, who))), 'a whole read of the docs passes');
        assert.ok(!denied(p.hook(bash('cat src/app.ts', s, who))), 'and marks it, so the code read after asks nothing');
        const viaShell = p.hook(bash('cat src/app.ts', fresh(), who), {}, path.join(HOOKS, 'shell-guards.js'));
        assert.match(viaShell.stdout, /rule number 14 /, `the shell guards carry the hold: ${viaShell.stdout}`);
    }
    finally { p.rm(); }
});

// The main session reviewing without an edit never met the edit hold: its first review skill waits for the code docs
// (the user's answer 'Hold its first review skill').
test('the main session\'s first review skill waits for the code docs, in parts; other skills and every seat pass', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const big = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    const small = project();
    try
    {
        const skill = (q, name, s, extra) => q.hook(pre('Skill', { skill: name }, s, extra));
        // the stack's own reviews (2026-10-22, the user's ruling 'use ours'), and the built-ins a user may still type
        for (const name of ['review-code', 'review-security', '/review-code', 'code-review', 'security-review', 'capture-code-quality', 'capture-architecture-quality', 'loop-code-quality', 'loop-architecture-quality', '/code-review'])
        {
            const s = sid();
            const r = skill(small, name, s);
            assert.ok(denied(r), `${name}: held`);
            assert.match(reason(r), /^Before this review, read the user's code preferences/, name);
            assert.match(reason(r), /put behaviour on the type/);
            assert.match(reason(r), /a handler validates/);
            assert.match(reason(r), /now start the review again/);
            assert.ok(!denied(skill(small, name, s)), `${name}: the retry passes`);
            assert.ok(!denied(skill(small, 'loop-code-quality', s)), `${name}: and every later review skill`);
        }
        const s = sid();
        const texts = [];
        for (let r = skill(big, 'capture-code-quality', s); denied(r); r = skill(big, 'capture-code-quality', s)) { texts.push(reason(r)); assert.ok(texts.length < 6, 'the holds end'); }
        const seen = texts.flatMap((t) => [...t.matchAll(/rule number (\d+) /g)].map((m) => Number(m[1])));
        assert.deepStrictEqual(seen.sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1), 'every entry once, in parts');
        assert.match(texts[0], /now start the review again for the next part/);
        for (const name of ['javascript', 'superpowers:requesting-code-review', 'other:code-review', 'capture-preferences'])
            assert.ok(!denied(skill(small, name, sid())), `${name}: no review skill`);
        assert.ok(!denied(skill(small, 'code-review', sid(), { agent_id: 'v1', agent_type: 'alfred-code:aspnet-verifier' })), 'a seat\'s skill call: its start already handed them');
        const read = sid();
        small.hook(bash(`cat ${PREFS}/PERSONAL-CODE-PREFERENCES.md ${PREFS}/ARCHITECTURE-PREFERENCES.md ${PREFS}/PROJECT-CODE-PREFERENCES.md`, read));
        assert.ok(!denied(skill(small, 'code-review', read)), 'docs read whole already: nothing held');
        assert.ok(denied(skill(small, 'code-review', sid())), 'a fresh session is held again');
        assert.strictEqual(small.hook(pre('Skill', { skill: 'code-review' }, sid()), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '', 'the off-list stands it down');
    }
    finally { big.rm(); small.rm(); }
});

// The architecture seat judged nothing, so its briefs listed the entries by hand (the user's answer 'Hook pushes the arch
// doc'): inside an architecture quality run its start hands it the architecture entries alone - never the code docs -
// and its first reads the rest. The map capture dispatches the same seat to describe the code as it is, so outside such
// a run it gets nothing.
const typed = (command, session) => ({ hook_event_name: 'UserPromptExpansion', session_id: session, expansion_type: 'slash_command', command_name: command, command_args: '', prompt: `/${command}` });
test('architecture-analyzer is handed the architecture entries alone in an architecture quality run; past one room its first reads bring the rest', () =>
{
    const longA = (i) => entry(`a${i}`, `Arch ${i}`, `- Rule: arch rule number ${i} ${'stays put. '.repeat(70)}`);
    const small = project();
    const big = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': PERSONAL, 'ARCHITECTURE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => longA(i + 1))).replace('# Code preferences', '# Architecture preferences') } });
    try
    {
        const who = { agent_id: 'a1', agent_type: 'alfred-code:architecture-analyzer' };
        const qualityRun = (q) => { const s = sid(); q.hook(typed('capture-architecture-quality', s)); return s; };
        const push = String(out(small.hook({ hook_event_name: 'SubagentStart', session_id: qualityRun(small), ...who })).additionalContext || '');
        assert.match(push, /The user's architecture preferences/);
        assert.match(push, /a handler validates/);
        assert.doesNotMatch(push, /put behaviour on the type|Single quotes|File-scoped namespaces/, 'no code doc');
        assert.match(push, /report each place the code departs from one as a smell naming its id/);
        const s = qualityRun(big);
        const first = String(out(big.hook({ hook_event_name: 'SubagentStart', session_id: s, ...who })).additionalContext || '');
        assert.match(first, /Not pasted yet/);
        const texts = [first];
        let r = big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s, who));
        assert.ok(denied(r), 'its first Read brings the next part');
        for (; denied(r); r = big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s, who))) { texts.push(reason(r)); assert.ok(texts.length < 6, 'the holds end'); }
        const seen = texts.flatMap((t) => [...t.matchAll(/arch rule number (\d+) /g)].map((m) => Number(m[1])));
        assert.deepStrictEqual(seen.sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1), 'every architecture entry once');
        assert.ok(!texts.some((t) => /put behaviour on the type/.test(t)), 'the code doc never');
        const start = (session, extra = who) => big.hook({ hook_event_name: 'SubagentStart', session_id: session, ...extra });
        assert.strictEqual(start(qualityRun(big), { agent_id: 'x', agent_type: 'other:architecture-analyzer' }).stdout, '', 'another plugin\'s analyzer gets nothing');
        assert.strictEqual(start(qualityRun(big), { agent_id: 'x', agent_type: 'architecture-analyzer' }).stdout, '', 'bare with no stamp: nothing');
        // Outside a quality run - none, the map capture typed or called, a scoping pass - nothing, and no read is held.
        const quiet = (s, label) => {
            assert.strictEqual(start(s).stdout, '', `${label}: no push`);
            assert.ok(!denied(big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s, who))), `${label}: no held read`);
        };
        quiet(sid(), 'no run');
        let m = sid(); big.hook(typed('capture-architecture', m)); quiet(m, 'the typed map capture');
        m = qualityRun(big); big.hook(pre('Skill', { skill: 'capture-architecture' }, m)); quiet(m, 'the map capture called after a quality run');
        m = qualityRun(big); big.hook(typed('task-solve-cross', m)); quiet(m, 'a solve run');
        m = sid(); big.hook(pre('Skill', { skill: 'capture-architecture' }, m)); big.hook(pre('Skill', { skill: 'javascript' }, m));
        quiet(m, 'a skill that is no run leaves the map run on');
        m = sid(); big.hook(pre('Skill', { skill: 'loop-architecture-quality' }, m));
        assert.match(String(out(start(m)).additionalContext || ''), /arch rule number 1 /, 'the loop called is a quality run');
        // A compaction keeps the run: the next analyzer is still handed the doc.
        m = qualityRun(big); big.hook({ hook_event_name: 'SessionStart', session_id: m, source: 'compact' });
        assert.match(String(out(start(m)).additionalContext || ''), /arch rule number 1 /, 'the run survives a compaction');
        m = qualityRun(big); big.hook({ hook_event_name: 'SessionStart', session_id: m, source: 'clear' });
        assert.strictEqual(start(m).stdout, '', 'a /clear ends it');
    }
    finally { small.rm(); big.rm(); }
});

// A typed review emits no Skill call (code.claude.com/docs/en/hooks: typing /name bypasses PreToolUse; UserPromptExpansion
// fires): its expansion is handed the code docs, and past one room the main session's first reads bring the rest.
test('a typed review is handed the code docs at its expansion; past one room the main session\'s first reads bring the rest', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const big = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    const small = project();
    try
    {
        for (const command of ['review-code', 'review-security', 'code-review', 'security-review', 'capture-code-quality', 'loop-architecture-quality'])
        {
            const s = sid();
            const r = small.hook(typed(command, s));
            assert.strictEqual(out(r).hookEventName, 'UserPromptExpansion', command);
            assert.match(String(out(r).additionalContext || ''), /put behaviour on the type[\s\S]*a handler validates/, `${command}: both of the user's docs`);
            assert.ok(!denied(small.hook(pre('Read', { file_path: path.join(small.root, 'src/app.ts') }, s))), `${command}: all of it fit, so no read waits`);
            assert.strictEqual(small.hook(typed(command, s)).stdout, '', `${command}: typed again, nothing more`);
        }
        for (const command of ['capture-architecture', 'task-solve', 'javascript', 'superpowers:requesting-code-review', 'other:code-review', 'other:review-code'])
            assert.strictEqual(small.hook(typed(command, sid())).stdout, '', `${command}: no review`);
        assert.strictEqual(small.hook({ ...typed('code-review', sid()), agent_id: 'v1', agent_type: 'alfred-code:aspnet-verifier' }).stdout, '', 'never inside a seat');
        const s = sid();
        const texts = [String(out(big.hook(typed('code-review', s))).additionalContext || '')];
        assert.match(texts[0], /Not pasted yet/);
        let r = big.hook(pre('Grep', { pattern: 'Order', path: path.join(big.root, 'src') }, s));
        assert.ok(denied(r), 'its first read brings the next part');
        assert.match(reason(r), /^Locate a symbol through the navigation tools your start line orders/m, 'a Grep earns the steer');
        for (; denied(r); r = big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, s))) { texts.push(reason(r)); assert.ok(texts.length < 7, 'the holds end'); }
        const seen = texts.flatMap((t) => [...t.matchAll(/rule number (\d+) /g)].map((m) => Number(m[1])));
        assert.deepStrictEqual(seen.sort((a, b) => a - b), Array.from({ length: 14 }, (_, i) => i + 1), 'every entry once');
        const other = sid();
        big.hook(typed('capture-architecture', other));
        assert.ok(!denied(big.hook(pre('Read', { file_path: path.join(big.root, 'src/app.ts') }, other))), 'outside a review run the main session reads freely');
        assert.strictEqual(small.hook(typed('code-review', sid()), { ALFRED_CODE_HOOKS_OFF: 'preferences-session' }).stdout, '', 'the off-list stands it down');
    }
    finally { big.rm(); small.rm(); }
});

// A run is the last one started, so it outlived its turn: the run ends at the user's next typed turn - any but the run's
// own command row (the user's answer 'Transcript check at the hold'). Read only where it matters: an architecture
// analyzer's start, and a reviewing main session's held read.
const row = (o) => `${JSON.stringify(o)}\n`;
const human = (text) => row({ type: 'user', message: { role: 'user', content: text } });
test('a run ends at the user\'s next typed turn: the analyzer and a reviewing main session stop being handed the docs', () =>
{
    const long = (i) => entry(`c${i}`, `Entry ${i}`, `- Rule: rule number ${i} ${'stays put. '.repeat(70)}\n- Scope: every language`);
    const p = project({ docs: { 'PERSONAL-CODE-PREFERENCES.md': codeDoc(...Array.from({ length: 14 }, (_, i) => long(i + 1))), 'ARCHITECTURE-PREFERENCES.md': ARCHITECTURE } });
    try
    {
        const T = path.join(p.root, 'transcript.jsonl');
        fs.writeFileSync(T, human('hello'));
        let seat = 0;
        const analyzer = (s) => /a handler validates/.test(String(out(p.hook({ hook_event_name: 'SubagentStart', session_id: s, transcript_path: T, agent_id: `a${++seat}`, agent_type: 'alfred-code:architecture-analyzer' })).additionalContext || ''));
        let s = sid();
        p.hook({ ...typed('capture-architecture-quality', s), transcript_path: T });
        fs.appendFileSync(T, human('<command-message>capture-architecture-quality is running</command-message>\n<command-name>/capture-architecture-quality</command-name>'));
        fs.appendFileSync(T, row({ type: 'user', isMeta: true, message: { role: 'user', content: 'Base directory for this skill: ...' } }));
        fs.appendFileSync(T, row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Dispatching.' }] } }));
        fs.appendFileSync(T, row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }] } }));
        fs.appendFileSync(T, human('<task-notification>agent finished</task-notification>'));
        fs.appendFileSync(T, row({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } }));
        fs.appendFileSync(T, '{garbage line\n');
        assert.ok(analyzer(s), 'its own command row, a skill body, tool results, a notification and a summary keep the run');
        // An Esc writes a user row of its own with no isMeta (measured in real transcripts), a `!` shell command and a
        // seat's hand-back frame are the harness's too: none is the user typing a new turn.
        fs.appendFileSync(T, row({ type: 'user', interruptedMessageId: 'm1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }));
        fs.appendFileSync(T, human([{ type: 'text', text: '[Request interrupted by user for tool use]' }]));
        fs.appendFileSync(T, human('<bash-input>git status</bash-input>'));
        fs.appendFileSync(T, human('<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>'));
        fs.appendFileSync(T, human('Another Claude session sent a message:\n<agent-message>report</agent-message>'));
        assert.ok(analyzer(s), 'an interrupt, a ! shell command and a hand-back frame keep the run');
        // A reply that only says go on is no new turn (the user's answer 'Keep go-on replies').
        for (const word of ['continue', '  Go on. ', 'proceed!', 'carry on', 'resume', 'keep going', 'yes', 'OK', 'okay']) fs.appendFileSync(T, human(word));
        fs.appendFileSync(T, human([{ type: 'text', text: 'Continue' }]));
        assert.ok(analyzer(s), 'a go-on reply keeps the run');
        fs.appendFileSync(T, human('continue with the login bug'));
        assert.ok(!analyzer(s), 'a typed turn ends it, a go-on word opening it included');
        p.hook({ ...pre('Skill', { skill: 'capture-architecture-quality' }, s), transcript_path: T });
        assert.ok(analyzer(s), 'a run called again starts again');
        fs.appendFileSync(T, human([{ type: 'text', text: 'and the next thing' }]));
        assert.ok(!analyzer(s), 'a typed turn as text blocks ends it too');
        s = sid();
        p.hook({ ...typed('capture-architecture-quality', s), transcript_path: path.join(p.root, 'gone.jsonl') });
        assert.ok(analyzer(s), 'a transcript that cannot be read keeps the run');
        // The reviewing main session: held while the review is the turn, free once a typed turn ended it.
        const read = (q) => p.hook({ ...pre('Read', { file_path: path.join(p.root, 'src/app.ts') }, q), transcript_path: T });
        s = sid();
        p.hook({ ...typed('code-review', s), transcript_path: T });
        assert.ok(denied(read(s)), 'the review\'s first read brings the next part');
        fs.appendFileSync(T, human('thanks, now something else'));
        assert.ok(!denied(read(s)), 'after a typed turn the main session reads freely');
        assert.ok(!denied(read(s)), 'and stays free');
        // A call another hook refused never ran (review 2026-10-23): its run ends at the refused result, so the analyzer is
        // handed nothing for it - while this hook's own refusal, which hands a review the docs and says to start it again,
        // keeps the run and the reads it holds.
        const call = (skill, q, id) => p.hook({ ...pre('Skill', { skill }, q, { tool_use_id: id }), transcript_path: T });
        const result = (id, error) => fs.appendFileSync(T, row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, ...(error ? { is_error: true } : {}), content: error ? 'PreToolUse:Skill hook error: denied' : 'Launching skill' }] } }));
        s = sid();
        let n = 0;
        for (; n < 20 && denied(call('capture-architecture-quality', s, `ca${n}`)); n++) result(`ca${n}`, true);   // its own hand-over
        assert.ok(n > 0 && n < 20, `the code docs came in ${n} parts, then the call passed this hook`);
        result(`ca${n}`, true);
        assert.ok(!analyzer(s), 'a run whose call another hook refused hands the analyzer nothing');
        assert.ok(!denied(call('capture-architecture-quality', s, 'cb')), 'called again');
        result('cb', false);
        assert.ok(analyzer(s), 'and run, it does');
        s = sid();
        assert.ok(denied(call('review-code', s, 'rv1')), 'the first review call is refused to hand the docs over');
        result('rv1', true);
        assert.ok(denied(read(s)), 'that refusal is this hook\'s own: the next read still brings the next part');
    }
    finally { p.rm(); }
});

// ---- tool preferences, phase 1: the tool-order start line ----------------------------------------------------------
const NAV_LOAD = 'Load: ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__find_symbol,'; // mcp-fixture
const seatStart = (type, extra = {}) => ({ hook_event_name: 'SubagentStart', session_id: sid(), agent_id: 'agent-t1', agent_type: type, ...extra });
const seatText = (r) => String(out(r).additionalContext || '');
const suggested = (p) => p.exists('.alfred/state/tool-preferences/suggested');

// The personal doc leads: the tools line is the part a capped hook output can lose (the final review, I2).
test('the main session start carries the personal doc, then the tools line', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS }, tools: true });
    try
    {
        const r = p.hook(start(sid(), 'startup'));
        assert.strictEqual(r.status, 0, r.stderr);
        const text = pushed(r);
        assert.ok(text.includes('\n\nTool order - the stack\'s defaults (no TOOLS-PREFERENCES.md)'), text);
        assert.ok(text.includes(NAV_LOAD), text);
        assert.ok(text.includes('mcp__plugin_alfred-memory_alfred-memory__memory_store'), 'the memory load line rides here now'); // mcp-fixture
        assert.ok(text.indexOf('lead with the verdict') < text.indexOf('Tool order'), 'the personal doc comes first');
        assert.match(text, /lead with the verdict/);
    }
    finally { p.rm(); }
});

test('the suggestion is sent once per project, and never once a doc exists', () =>
{
    const p = project({ docs: {}, tools: true });
    try
    {
        const first = pushed(p.hook(start(sid(), 'startup')));
        assert.ok(first.endsWith('\nThe user can rank their own with /capture-preferences tools.'), first);
        assert.ok(suggested(p), 'the marker is written');
        for (const source of ['startup', 'compact'])
        {
            const again = pushed(p.hook(start(sid(), source)));
            assert.match(again, /^Tool order/, source);
            assert.ok(!again.includes('/capture-preferences'), source);
        }
    }
    finally { p.rm(); }
    const q = project({ docs: { 'TOOLS-PREFERENCES.md': '# Tools preferences\n\nUpdated: 2026-10-24\n\n## T1 - Code navigation\n<!-- id: t1 -->\n- Job: navigation\n- Order: LSP > Grep\n' }, tools: true });
    try
    {
        const text = pushed(q.hook(start(sid(), 'startup')));
        assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md/);
        assert.ok(text.includes('- navigation (locate symbols, callers and types before reading or editing code): LSP > Grep.'), text);
        assert.ok(!text.includes('/capture-preferences'));
        assert.ok(!suggested(q));
    }
    finally { q.rm(); }
});

test('an unwritable state folder still prints the line', () =>
{
    const p = project({ docs: {}, tools: true });
    try
    {
        p.write('blocked', 'a file where the data root would be\n');
        const r = p.hook(start(sid(), 'startup'), { ALFRED_CODE_DATA_PATH: 'blocked' });
        assert.strictEqual(r.status, 0, r.stderr);
        const text = pushed(r);
        assert.match(text, /^Tool order/);
        assert.ok(text.endsWith('/capture-preferences tools.'), 'the suggestion prints with no marker to keep');
    }
    finally { p.rm(); }
});

test('every seat start carries its tools line; a judge also gets its code docs', () =>
{
    const p = project({ tools: true });
    try
    {
        const v = seatText(p.hook(seatStart('alfred-code:aspnet-verifier')));
        assert.ok(v.includes('Tool order - the stack\'s defaults'), v);
        assert.ok(!v.includes('ToolSearch'), 'a stack seat calls what its tools grant');
        // built-in tools only since 2026-10-24: the LSP and grep navigate, WebFetch reads a library's docs
        assert.match(v, /- navigation \([^)]*\): LSP > Grep\./, v);
        assert.match(v, /- documentation \([^)]*\): WebFetch\./, v);
        assert.match(v, /put behaviour on the type/, 'the judge is still handed the code docs');
        assert.ok(v.indexOf('put behaviour') < v.indexOf('Tool order'), 'the code docs come first');
        const e = seatText(p.hook(seatStart('alfred-code:evidence-gatherer')));
        assert.match(e, /^Tool order/);
        assert.doesNotMatch(e, /put behaviour on the type/, 'a gatherer gets the tools line only');
        assert.ok(!e.includes('- documentation'), 'its tools grant no documentation rank');
        p.write('.claude/agents/my-seat.md', '---\nname: my-seat\ntools: Grep, Read\n---\nbody\n');
        const own = seatText(p.hook(seatStart('my-seat')));
        assert.ok(own.includes('- navigation (locate symbols, callers and types before reading or editing code): Grep.'), `a project seat reads its own file: ${own}`);
    }
    finally { p.rm(); }
});

test('a built-in seat gets the main session\'s line without the suggestion; the guide seats get none', () =>
{
    const p = project({ docs: {}, tools: true });
    try
    {
        const text = seatText(p.hook(seatStart('general-purpose')));
        assert.ok(text.includes('Load: ToolSearch select:'), text);
        assert.ok(!text.includes('/capture-preferences'), text);
        assert.ok(!suggested(p), 'a seat never spends the suggestion');
        assert.ok(seatText(p.hook(seatStart('other-plugin:helper'))).includes(NAV_LOAD), 'another plugin\'s seat');
        for (const type of ['claude-code-guide', 'statusline-setup']) assert.strictEqual(p.hook(seatStart(type)).stdout, '', type);
    }
    finally { p.rm(); }
});

test('a seat\'s own compaction re-sends its tools line', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS }, tools: true });
    try
    {
        const text = pushed(p.hook({ ...start(sid(), 'compact'), agent_id: 'agent-t4', agent_type: 'alfred-code:evidence-gatherer' }));
        assert.match(text, /^Tool order/);
        assert.ok(!text.includes('lead with the verdict'), 'the personal doc stays the main session\'s');
        assert.ok(!text.includes('/capture-preferences'));
        assert.strictEqual(p.hook({ ...start(sid(), 'compact'), agent_id: 'agent-t4' }).stdout, '', 'no agent type: nothing to resolve');
    }
    finally { p.rm(); }
});

test('preferences-session:tools switches the line off and nothing else', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL }, tools: true });
    try
    {
        const off = { ALFRED_CODE_HOOKS_OFF: 'preferences-session:tools' };
        const text = pushed(p.hook(start(sid(), 'startup'), off));
        assert.match(text, /^The user's personal preferences/);
        assert.ok(!suggested(p), 'nor is the suggestion spent');
        const v = seatText(p.hook(seatStart('alfred-code:aspnet-verifier'), off));
        assert.match(v, /^The user's code preferences/);
        assert.strictEqual(p.hook(seatStart('alfred-code:evidence-gatherer'), off).stdout, '');
    }
    finally { p.rm(); }
});

test('a missing tools.js leaves every other push as it was', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL }, tools: true });
    const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-lone-'));
    try
    {
        // the hook with no ../skills beside it: an install whose capture-preferences copy is gone
        const file = path.join(lone, 'hooks', 'preferences-session.js');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(HOOK, file);
        const r = p.hook(start(sid(), 'startup'), {}, file);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(pushed(r), /^The user's personal preferences/);
        assert.match(seatText(p.hook(seatStart('alfred-code:aspnet-verifier'), {}, file)), /^The user's code preferences/);
    }
    finally { p.rm(); fs.rmSync(lone, { recursive: true, force: true }); }
});

// ---- the host's shell traps (audit 2026-10-14 RU13; from the retired memory-session.js, 2026-10-24) -----------------
// The always-on navigation rule carried the Windows Git Bash line into every macOS / Linux session and the zsh lines into
// every bash one. The hook appends only this host's own, keyed on process.platform and $SHELL, at every session and seat
// start. Each case below mocks one host.
const { hostLines } = require(HOOK);
const WIN_LINE = /^- On Windows \(Git Bash\): pass a `\/tmp\/x` path to native `node` through `cygpath -w`/m;
const ZSH_LINE = /^- zsh aborts the WHOLE command on an unmatched bare path glob/m;
const SPLIT_LINE = /^- zsh never word-splits `\$VAR`/m;

test('RU13: win32 gets the Windows line, a zsh $SHELL the zsh lines, bash neither', () =>
{
    const text = (platform, shell) => hostLines(platform, shell).join('\n');
    assert.deepStrictEqual(hostLines('linux', '/bin/bash'), [], 'bash on Linux: nothing');
    assert.deepStrictEqual(hostLines('darwin', '/usr/local/bin/bash'), [], 'bash on macOS: nothing');
    assert.deepStrictEqual(hostLines('darwin', ''), [], 'no $SHELL: nothing');
    for (const zsh of ['/bin/zsh', '/usr/local/bin/zsh', 'zsh'])
    {
        const t = text('darwin', zsh);
        assert.match(t, /^Shell commands on this host:$/m, zsh);
        assert.match(t, ZSH_LINE, zsh);
        assert.match(t, SPLIT_LINE, zsh);
        assert.doesNotMatch(t, WIN_LINE, `${zsh}: no Windows line off win32`);
    }
    for (const bash of ['C:\\Program Files\\Git\\usr\\bin\\bash.exe', '/usr/bin/bash', ''])
    {
        const t = text('win32', bash);
        assert.match(t, WIN_LINE, `win32 ${bash}`);
        assert.doesNotMatch(t, ZSH_LINE, `win32 ${bash}: no zsh line`);
    }
    assert.match(text('win32', '/usr/bin/zsh'), ZSH_LINE, 'a zsh on win32 gets both');
    assert.strictEqual(hostLines('win32', 'C:\\msys64\\usr\\bin\\zsh.exe').length, 4, 'the header, the Windows line, the two zsh lines');
});

// Each host drives the real entry: $SHELL through the env, process.platform through a preload that sets it before the hook runs.
function driveHost(p, payload, { shell, platform, off = 'preferences-session:tools' })
{
    const pre = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-platform-'));
    const config = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-host-config-'));
    try
    {
        fs.writeFileSync(path.join(pre, 'platform.js'), `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });\n`);
        const r = spawnSync(process.execPath, ['-r', path.join(pre, 'platform.js'), HOOK], {
            cwd: p.root, encoding: 'utf8', input: JSON.stringify({ cwd: p.root, ...payload }),
            env: { ...process.env, SHELL: shell, CLAUDE_PROJECT_DIR: p.root, CLAUDE_CONFIG_DIR: config, ALFRED_CODE_HOOKS_OFF: off },
        });
        assert.strictEqual(r.status, 0, r.stderr);
        return r.stdout ? String(JSON.parse(r.stdout).hookSpecificOutput.additionalContext || '') : '';
    }
    finally { fs.rmSync(pre, { recursive: true, force: true }); fs.rmSync(config, { recursive: true, force: true }); }
}

test('RU13: a zsh host\'s session and seat starts end on the zsh lines, a bash host\'s on none', () =>
{
    const p = project({ docs: { 'PERSONAL-PREFERENCES.md': PERSONAL_PREFS, 'PERSONAL-CODE-PREFERENCES.md': PERSONAL } });
    try
    {
        const cases = [['a main start', start(sid(), 'startup'), /^The user's personal preferences/],
            ['a judge\'s start', seatStart('alfred-code:aspnet-verifier'), /^The user's code preferences/],
            ['a seat\'s own compaction', { ...start(sid(), 'compact'), agent_id: 'agent-h1', agent_type: 'alfred-code:evidence-gatherer' }, /^Shell commands/]];
        for (const [label, payload, opens] of cases)
        {
            const zsh = driveHost(p, payload, { shell: '/bin/zsh', platform: 'darwin' });
            assert.match(zsh, opens, `${label}: the push it had comes first`);
            assert.match(zsh, /(^|\n\n)Shell commands on this host:\n- zsh aborts/, `${label}: the host block closes the push`);
            assert.match(zsh, /word-splits .*array\.$/, `${label}: and ends it`);
            assert.doesNotMatch(zsh, WIN_LINE, `${label}: no Windows line on macOS`);
            const bash = driveHost(p, payload, { shell: '/bin/bash', platform: 'linux' });
            assert.doesNotMatch(bash, /Shell commands on this host|zsh|cygpath/, `${label}: a bash host gets neither`);
        }
        const off = driveHost(p, start(sid(), 'startup'), { shell: '/bin/zsh', platform: 'darwin', off: 'preferences-session:tools,preferences-session:host' });
        assert.match(off, /^The user's personal preferences/, 'preferences-session:host drops the lines');
        assert.doesNotMatch(off, /Shell commands on this host/, 'and nothing else');
    }
    finally { p.rm(); }
});

test('RU13: a win32 host\'s session and seat starts end on the Windows line, with no zsh line under Git Bash', () =>
{
    const p = project({ docs: {} });
    try
    {
        for (const payload of [start(sid(), 'startup'), seatStart('alfred-code:evidence-gatherer'), seatStart('claude-code-guide')])
        {
            const win = driveHost(p, payload, { shell: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe', platform: 'win32' });
            assert.match(win, /^Shell commands on this host:\n- On Windows \(Git Bash\)/, payload.agent_type || payload.hook_event_name);
            assert.match(win, /`MSYS2_ARG_CONV_EXCL='\*'`/, payload.hook_event_name);
            assert.doesNotMatch(win, ZSH_LINE, `${payload.hook_event_name}: Git Bash is no zsh`);
        }
    }
    finally { p.rm(); }
});
