'use strict';
const test = require('node:test');
// No inherited stack env, entrypoint or project dir (hook-test-env.js): the hook cases below spawn the real hook.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { realLong } = require('./test-paths');

const LOADER = path.join(__dirname, '..', 'stack', 'hooks', 'rules-summary.js');
const loader = () => require(LOADER);
const SESSION = 'sess-1';

// A throwaway home holding the workspace; the walk stops below it. The env has no stack variable in it.
function fixture()
{
    const home = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-summary-')));
    return { home, env: { HOME: home, USERPROFILE: home }, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}
// `always` rules with no frontmatter and `scoped` rules with a `paths:` list, under <folder>/.claude/rules.
function rules(folder, always, scoped)
{
    const dir = path.join(folder, '.claude', 'rules');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < always; i++) fs.writeFileSync(path.join(dir, `always-${i}.md`), `# Always ${i}\n\nBe plain.\n`);
    for (let i = 0; i < scoped; i++) fs.writeFileSync(path.join(dir, `scoped-${i}.md`), `---\npaths:\n  - "**/*.cs"\n---\n\n# Scoped ${i}\n\nBe plain.\n`);
}
const LINE_HEAD = 'Native rules, full text in context - follow them: ';

test('summaryLine counts each level above and at the session folder', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        const child = path.join(root, 'api');
        rules(root, 8, 11);
        rules(child, 1, 0);
        assert.strictEqual(loader().summaryLine(child, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path) + api (1 always-on, 0 by path)`);
    }
    finally { done(); }
});

test('a touched child joins the line with its total', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 8, 11);
        rules(path.join(root, 'api'), 1, 0);
        fs.mkdirSync(path.join(root, 'api', 'src'), { recursive: true });
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path)`, 'no touch yet');
        loader().noteTouch(root, SESSION, path.join(root, 'api', 'src', 'a.cs'), env);
        loader().noteTouch(root, SESSION, path.join(root, 'api', 'src', 'b.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env), [path.join(root, 'api')]);
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (8 always-on, 11 by path) + api (1)`);
        assert.deepStrictEqual(loader().touchedOf(root, 'other-session', env), [], 'the record is per session');
    }
    finally { done(); }
});

test('a file of the project root or of a folder with no rules is no touch', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 1, 0);
        fs.mkdirSync(path.join(root, 'plain'), { recursive: true });
        loader().noteTouch(root, SESSION, path.join(root, 'top.cs'), env);
        loader().noteTouch(root, SESSION, path.join(root, 'plain', 'x.cs'), env);
        loader().noteTouch(root, SESSION, path.join(home, 'elsewhere', 'y.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env), []);
    }
    finally { done(); }
});

test('a rule claudeMdExcludes keeps out is not counted', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 3, 2);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ claudeMdExcludes: ['**/.claude/rules/always-0.md'] }));
        fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ claudeMdExcludes: ['**/.claude/rules/scoped-*.md'] }));
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (2 always-on, 0 by path)`);
        assert.deepStrictEqual(loader().levelsOf(root, env).map((l) => [l.name, l.always, l.scoped]), [['ws-root', 2, 0]]);
    }
    finally { done(); }
});

test('no rule anywhere gives no line', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'rules', 'notes.txt'), 'not a rule');
        assert.strictEqual(loader().summaryLine(root, SESSION, env), '');
        assert.strictEqual(loader().summaryLine(path.join(home, 'missing'), SESSION, env), '');
    }
    finally { done(); }
});

test('a garbage settings file or a garbage touch record changes nothing', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 1, 1);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{ not json');
        const state = path.join(root, '.alfred', 'state', 'sessions');
        fs.mkdirSync(state, { recursive: true });
        fs.writeFileSync(path.join(state, `rules-touched-${SESSION}.json`), 'garbage');
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (1 always-on, 1 by path)`);
    }
    finally { done(); }
});

test('a project reached through a symlink records the touched child', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const real = path.join(home, 'ws-real');
        rules(real, 1, 0);
        rules(path.join(real, 'api'), 2, 0);
        fs.mkdirSync(path.join(real, 'api', 'src'), { recursive: true });
        const link = path.join(home, 'ws-link');
        fs.symlinkSync(real, link, 'dir');
        loader().noteTouch(link, SESSION, path.join(link, 'api', 'src', 'a.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(link, SESSION, env).map(realLong), [realLong(path.join(real, 'api'))]);
        assert.strictEqual(loader().summaryLine(link, SESSION, env), `${LINE_HEAD}ws-real (1 always-on, 0 by path) + api (2)`);
    }
    finally { done(); }
});

test('a file that does not exist yet still records its child through the nearest existing folder', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        rules(root, 1, 0);
        rules(path.join(root, 'api'), 1, 0);
        loader().noteTouch(root, SESSION, path.join(root, 'api', 'new', 'deep', 'a.cs'), env);
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env).map(realLong), [realLong(path.join(root, 'api'))]);
    }
    finally { done(); }
});

test('a root\'s claudeMdExcludes does not apply to a session started in the child', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const root = path.join(home, 'ws-root');
        const child = path.join(root, 'api');
        rules(root, 3, 0);
        rules(child, 1, 0);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ claudeMdExcludes: ['**/ws-root/.claude/rules/always-0.md'] }));
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (2 always-on, 0 by path)`, 'the session folder\'s own settings apply');
        assert.strictEqual(loader().summaryLine(child, SESSION, env), `${LINE_HEAD}ws-root (3 always-on, 0 by path) + api (1 always-on, 0 by path)`);
    }
    finally { done(); }
});

test('isBelow: a path counts only strictly below the project, on one drive (win32 spellings too)', () =>
{
    const { isBelow } = loader();
    assert.strictEqual(isBelow('/p/proj', '/p/proj/api'), true);
    assert.strictEqual(isBelow('/p/proj', '/p/proj'), false, 'the project itself');
    assert.strictEqual(isBelow('/p/proj', '/p/other'), false);
    assert.strictEqual(isBelow('/p/proj', '/p/proj-x'), false, 'a sibling sharing a prefix');
    assert.strictEqual(isBelow('/p/proj', '/p/proj/..cache'), true, 'a name starting with two dots is no parent step');
    assert.strictEqual(isBelow('C:\\proj', 'C:\\proj\\api', path.win32), true);
    assert.strictEqual(isBelow('C:\\proj', 'C:\\proj', path.win32), false);
    assert.strictEqual(isBelow('C:\\proj', 'D:\\proj\\api', path.win32), false, 'a file on another drive');
    assert.strictEqual(isBelow('C:\\proj', 'C:\\other\\api', path.win32), false);
});

// ---- the edit-time reminder (card 'Layered native rules', Task 5) ------------------------------------------------
const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'rules-session.js');
const RULE_BODY = (text) => (paths) => `---\npaths:\n${paths.map((g) => `  - "${g}"`).join('\n')}\n---\n\n# Heading\n\n${text}\n`;
function writeRule(folder, name, text)
{
    fs.mkdirSync(path.join(folder, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'rules', `${name}.md`), text);
}
// A root with a `**/*.cs` rule, a child `api` with a `/src/**` rule and its own alfred-awareness rule.
function workspace(home)
{
    const root = path.join(home, 'ws-root');
    const child = path.join(root, 'api');
    writeRule(root, 'cs-style', RULE_BODY('Write C# in the house style. More words follow.')(['**/*.cs']));
    writeRule(root, 'always-on', '# Always\n\nBe plain.\n');
    writeRule(child, 'api-src', RULE_BODY('Keep the api source small. Second sentence.')(['/src/**']));
    writeRule(child, 'alfred-awareness', '# Awareness\n\nThe api folder is its own project.\n');
    fs.mkdirSync(path.join(child, 'src'), { recursive: true });
    return { root, child, file: path.join(child, 'src', 'a.cs') };
}

test('an edit gets the key line of each matching path rule, walked up from the file', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        const text = loader().editReminder(file, root, env);
        const lines = text.split('\n');
        assert.strictEqual(lines[0], 'Rules for api/src/a.cs (key lines - the full text is in context):');
        assert.deepStrictEqual(lines.filter((l) => /^- (cs-style|api-src):/.test(l)),
            ['- cs-style: Write C# in the house style.', '- api-src: Keep the api source small.'], 'the root rule first, then the child rule; the pathless rule is no line');
        assert.strictEqual(loader().editReminder(path.join(root, 'api', 'notes.txt'), root, env), '', 'no glob matches: nothing');
    }
    finally { done(); }
});

test('a file under a child names that child\'s awareness', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        assert.ok(loader().editReminder(file, root, env).split('\n').includes('- api\'s alfred-awareness wins for this file.'));
        const own = path.join(root, 'top.cs');
        assert.ok(!/awareness/.test(loader().editReminder(own, root, env)), 'a file of the project itself names no child');
        assert.ok(loader().editReminder(own, root, env).includes('- cs-style:'));
    }
    finally { done(); }
});

test('the second edit of the same file sends nothing, and a new actor or session hears it again', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        const first = loader().editNote(root, SESSION, 'main', file, env);
        assert.match(first, /^Rules for api\/src\/a\.cs/);
        assert.strictEqual(loader().editNote(root, SESSION, 'main', file, env), '');
        assert.strictEqual(loader().editNote(root, SESSION, 'agent-7', file, env), first, 'the record is per actor');
        assert.strictEqual(loader().editNote(root, 'sess-2', 'main', file, env), first, 'and per session');
        assert.strictEqual(loader().editNote(root, SESSION, 'main', path.join(root, 'api', 'src', 'b.cs'), env).split('\n')[0],
            'Rules for api/src/b.cs (key lines - the full text is in context):', 'another file is its own entry');
        assert.ok(fs.existsSync(path.join(root, '.alfred', 'state', 'sessions', 'rules-edit-sess-1-main.json')));
    }
    finally { done(); }
});

test('an excluded rule is no line, and a garbage edit record changes nothing', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ claudeMdExcludes: ['**/ws-root/.claude/rules/cs-style.md'] }));
        assert.ok(!loader().editReminder(file, root, env).includes('cs-style'));
        const state = path.join(root, '.alfred', 'state', 'sessions');
        fs.mkdirSync(state, { recursive: true });
        fs.writeFileSync(path.join(state, 'rules-edit-sess-1-main.json'), 'garbage');
        assert.match(loader().editNote(root, SESSION, 'main', file, env), /api-src/);
    }
    finally { done(); }
});

function hook(root, home, payload)
{
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: SESSION, cwd: root, hook_event_name: 'PreToolUse', ...payload }),
        encoding: 'utf8', cwd: root, env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: root } });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
}

// B16 (session audit 2026-11-27, S15): the plugin's own state under .alfred/ is no project file - no path rule attaches to it.
test('B16: an Edit of a file under .alfred/ attaches no path rule, while the same kind of file in the project still does', () =>
{
    const { home, done } = fixture();
    try
    {
        const { root } = workspace(home);
        writeRule(root, 'md-style', RULE_BODY('Write docs in plain words. More words follow.')(['**/*.md']));
        const edit = (file) => hook(root, home, { tool_name: 'Edit', tool_input: { file_path: file } });
        assert.match(JSON.parse(edit(path.join(root, 'notes', 'readme.md'))).hookSpecificOutput.additionalContext, /- md-style: Write docs in plain words\./, 'a project doc gets its rule');
        assert.strictEqual(edit(path.join(root, '.alfred', 'state', 'sessions', 'scoring', 'x.draft.md')), '', 'a state file gets none');
        assert.match(JSON.parse(edit(path.join(root, '.alfred', 'docs', 'guide.md'))).hookSpecificOutput.additionalContext, /md-style/, 'the docs root holds the user\'s own docs: its rules still attach');
        assert.strictEqual(hook(root, home, { tool_name: 'Write', tool_input: { file_path: '.alfred/state/approvals/NOTES.md' } }), '', 'a relative state path gets none');
        assert.match(JSON.parse(edit(path.join(root, '.alfred-old', 'z.md'))).hookSpecificOutput.additionalContext, /md-style/, 'a folder that only starts with .alfred is a project path');
        assert.match(JSON.parse(edit(`${root}/.alfred/../notes/other.md`)).hookSpecificOutput.additionalContext, /md-style/, 'a path that climbs out of .alfred/ is a project path');
    }
    finally { done(); }
});

test('a Read records the touch and prints nothing; the first Edit prints the reminder once', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const { root, child, file } = workspace(home);
        assert.strictEqual(hook(root, home, { tool_name: 'Read', tool_input: { file_path: file } }), '');
        assert.deepStrictEqual(loader().touchedOf(root, SESSION, env), [child], 'the touch is recorded');
        assert.strictEqual(loader().summaryLine(root, SESSION, env), `${LINE_HEAD}ws-root (1 always-on, 1 by path) + api (2)`);
        const out = JSON.parse(hook(root, home, { tool_name: 'Edit', tool_input: { file_path: file } })).hookSpecificOutput;
        assert.strictEqual(out.hookEventName, 'PreToolUse');
        assert.match(out.additionalContext, /^Rules for api\/src\/a\.cs \(key lines - the full text is in context\):\n- cs-style: /);
        assert.strictEqual(hook(root, home, { tool_name: 'Edit', tool_input: { file_path: file } }), '', 'the second edit of the file: nothing');
        assert.strictEqual(hook(root, home, { tool_name: 'Write', tool_input: { file_path: 'api/src/a.cs' } }), '', 'a relative path is the same file');
        assert.strictEqual(hook(root, home, { tool_name: 'Edit', tool_input: { file_path: file }, cursor_version: '2.1.0' }), '', 'a Cursor payload: nothing');
        assert.strictEqual(hook(root, home, { tool_name: 'Edit', tool_input: {} }), '', 'no file: nothing');
    }
    finally { done(); }
});

test('a sibling project\'s file gets no reminder, and a file of the session folder still hears the levels above it', () =>
{
    const { home, env, done } = fixture();
    try
    {
        const top = path.join(home, 'top');
        const proj = path.join(top, 'proj');
        const other = path.join(top, 'other');
        writeRule(top, 'cs-style', RULE_BODY('Write C# in the house style. More.')(['**/*.cs']));
        writeRule(other, 'other-src', RULE_BODY('Other project only. More.')(['**/*.cs']));
        fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
        fs.mkdirSync(path.join(other, 'src'), { recursive: true });
        assert.strictEqual(loader().editReminder(path.join(other, 'src', 'a.cs'), proj, env), '', 'a file outside the session folder');
        assert.strictEqual(loader().editNote(proj, SESSION, 'main', path.join(other, 'src', 'a.cs'), env), '');
        assert.strictEqual(loader().editReminder(path.join(proj, 'src', 'a.cs'), proj, env),
            'Rules for src/a.cs (key lines - the full text is in context):\n- cs-style: Write C# in the house style.', 'a file of the session folder: the level above counts');
    }
    finally { done(); }
});

test('a seat payload gets its own record: the main actor\'s sent reminder does not suppress it', () =>
{
    const { home, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        const edit = { tool_name: 'Edit', tool_input: { file_path: file } };
        assert.notStrictEqual(hook(root, home, edit), '');
        assert.strictEqual(hook(root, home, edit), '', 'the main actor heard it');
        assert.notStrictEqual(hook(root, home, { ...edit, agent_id: 'agent-a1' }), '', 'a seat hears it once');
        assert.strictEqual(hook(root, home, { ...edit, agent_id: 'agent-a1' }), '');
        const state = path.join(root, '.alfred', 'state', 'sessions');
        assert.deepStrictEqual(fs.readdirSync(state).filter((f) => f.startsWith('rules-edit-')).sort(), ['rules-edit-sess-1-agent-a1.json', 'rules-edit-sess-1-main.json']);
    }
    finally { done(); }
});

test('a write sweeps the hook\'s own session files past 7 days, and no others', () =>
{
    const { home, done } = fixture();
    try
    {
        const { root, file } = workspace(home);
        const state = path.join(root, '.alfred', 'state', 'sessions');
        fs.mkdirSync(state, { recursive: true });
        const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
        const make = (name, when) => { fs.writeFileSync(path.join(state, name), '[]'); fs.utimesSync(path.join(state, name), when, when); };
        for (const name of ['rules-edit-old-main.json', 'rules-touched-old.json', 'other-old.json']) make(name, old);
        make('rules-edit-fresh-main.json', new Date());
        hook(root, home, { tool_name: 'Edit', tool_input: { file_path: file } });
        assert.deepStrictEqual(fs.readdirSync(state).filter((f) => !f.startsWith('.alfred-sweep')).sort(),
            ['other-old.json', 'rules-edit-fresh-main.json', 'rules-edit-sess-1-main.json', 'rules-touched-sess-1.json'],
            'the old edit record goes, the old touch record goes after the touch write, the foreign file stays');
    }
    finally { done(); }
});
