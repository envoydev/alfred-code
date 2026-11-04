'use strict';
// Memory P3 (Risk 5): Claude Code's own memory writes its lessons into <docs root>/memory under docs mode. No hook that
// sees a Write may hold that write, ask about it or record it as a docs edit: every manifest row whose matcher takes
// Write is run on a PreToolUse Write of a memory file, then the matching PostToolUse.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const HOOKS = path.join(REPO, 'stack', 'hooks');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO, 'meta', 'stack-manifest.json'), 'utf8'));
const MEMORY_FILE = '.alfred/docs/memory/feedback.md';

// The hook files a Write reaches: a row's matcher taking `Write`, on the PreToolUse / PostToolUse route (no `@<event>:`).
const writeHooks = () => [...new Set(MANIFEST.hooks
    .filter((h) => typeof h.matcher === 'string' && !h.matcher.includes('@'))
    .filter((h) => { try { return new RegExp(h.matcher).test('Write'); } catch { return false; } })
    .map((h) => h.file))];

// An installed-shape project on docs mode: an install record, the docs root with a watched domain and the preferences
// docs (so the first-edit holds are live), the stack's autoMemoryDirectory row and a memory index already there.
function project()
{
    const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memory-docs-hooks-')));
    const root = path.join(top, 'repo');
    const write = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    fs.mkdirSync(root);
    spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: root });
    write('.gitignore', '.alfred/state/\n.alfred/statistics/\n.claude/settings.local.json\n');
    write('src/app.ts', 'export const x = 1;\n');
    write('.claude/alfred-code.stamp', 'version: 3.7.1\nscope: project\n');
    write('.claude/settings.json', JSON.stringify({ enabledPlugins: {} }));
    write('.alfred/.variables', 'ALFRED_CODE_MEMORY=docs\n');
    write('.claude/settings.local.json', JSON.stringify({ autoMemoryDirectory: path.join(root, '.alfred', 'docs', 'memory') }));
    write('.alfred/docs/architecture/watch.json', JSON.stringify({ 'src/': ['ARCHITECTURE#layers'] }));
    write('.alfred/docs/architecture/ARCHITECTURE.md', '# Architecture\n\n## Layers\n<!-- id: layers -->\nThe app is one layer.\n');
    write('.alfred/docs/preferences/watch.json', '{}\n');
    write('.alfred/docs/preferences/PERSONAL-CODE-PREFERENCES.md', '# Personal code preferences\n\nUpdated: 2026-11-04\n\n## C1 - Small functions\n<!-- id: c1 -->\n- Rule: keep a function under forty lines.\n');
    write('.alfred/docs/memory/MEMORY.md', '# Memory\n');
    return { top, root, config: path.join(top, 'acct'), tmp: path.join(top, 'tmp'), rm: () => fs.rmSync(top, { recursive: true, force: true }) };
}

function run(p, file, payload)
{
    fs.mkdirSync(p.tmp, { recursive: true });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: p.root, CLAUDE_CONFIG_DIR: p.config, TMPDIR: p.tmp, TEMP: p.tmp, TMP: p.tmp };
    return spawnSync(process.execPath, [path.join(HOOKS, file)], { cwd: p.root, encoding: 'utf8', env, input: JSON.stringify({ cwd: p.root, ...payload }), timeout: 30000 });
}

// What a hook's answer says: a deny or an ask on PreToolUse, a block on any event.
function verdict(stdout)
{
    let out = {};
    try { out = JSON.parse(stdout || '{}'); } catch { out = {}; }
    const hso = out.hookSpecificOutput || {};
    return { decision: hso.permissionDecision || null, block: out.decision === 'block' };
}

// Every docs-session row and per-session record the run left, as text.
function recordsOf(p)
{
    const texts = [];
    const walk = (dir) =>
    {
        let names = [];
        try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of names)
        {
            const abs = path.join(dir, e.name);
            if (e.isDirectory()) walk(abs);
            else if (/\.(jsonl?|txt)$/.test(e.name) || /^docs-session-/.test(e.name)) texts.push({ file: abs, text: fs.readFileSync(abs, 'utf8') });
        }
    };
    walk(path.join(p.root, '.alfred', 'state'));
    walk(path.join(p.root, '.alfred', 'statistics'));
    walk(p.tmp);
    return texts;
}

test('no edit hook holds or records a write into <docs-path>/memory', () =>
{
    const files = writeHooks();
    assert.ok(files.includes('docs-session.js') && files.includes('preferences-session.js'), `the docs hooks are among them: ${files.join(', ')}`);
    for (const file of files)
    {
        const p = project();
        try
        {
            const session = `memory-docs-${process.pid}-${file.replace(/\W/g, '')}`;
            const target = path.join(p.root, ...MEMORY_FILE.split('/'));
            const content = '---\nname: feedback\ndescription: a lesson\n---\nKeep functions short.\n';
            const input = { file_path: target, content };
            const pre = run(p, file, { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Write', tool_input: input });
            assert.strictEqual(pre.status, 0, `${file} PreToolUse exit ${pre.status}: ${pre.stderr}`);
            const v = verdict(pre.stdout);
            assert.ok(v.decision !== 'deny' && v.decision !== 'ask' && !v.block, `${file} PreToolUse held the memory write: ${pre.stdout}`);
            fs.writeFileSync(target, content);
            const post = run(p, file, { hook_event_name: 'PostToolUse', session_id: session, tool_name: 'Write', tool_input: input, tool_response: { type: 'create', filePath: target, content } });
            assert.strictEqual(post.status, 0, `${file} PostToolUse exit ${post.status}: ${post.stderr}`);
            assert.ok(!verdict(post.stdout).block, `${file} PostToolUse blocked: ${post.stdout}`);
            for (const { file: rec, text } of recordsOf(p))
            {
                assert.doesNotMatch(text, /"event":"(?:first-edit|hold|seat-hold)"/, `${file}: a docs-session hold or first-edit row in ${rec}`);
                if (/^docs-session-/.test(path.basename(rec)))
                {
                    let state = {};
                    try { state = JSON.parse(text); } catch { state = {}; }
                    assert.ok(!state.edits, `${file}: docs-session counted the memory write as an edit (${rec}: ${text.slice(0, 200)})`);
                }
            }
        }
        finally { p.rm(); }
    }
});
