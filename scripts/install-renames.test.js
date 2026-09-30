'use strict';
// THE RENAME MIGRATION (Task 22) - the project-* skills and the two failure diagnosers shipped under
// their old names through v1.3.0, and 2.0.0 gives them grouped alfred-* names. An older install
// names them the old way in four places: the stamp's picks, a copy on disk, a seat deny (plus a
// `skillOverrides` key), and a selection line. Each is carried across through the ONE table,
// meta/stack-manifest.json `renamed`, so no pick and no switch-off is lost, and the old copy goes
// with the retired list. This file is one of the homes allowed to spell the old names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { loadManifest } = require('./install/manifest.js');
const selection = require('./install/selection.js');
const { hashItem } = require('./install/library.js');
const { writeSettings, readBackSettings } = require('./install/settings.js');

const ROOT = path.join(__dirname, '..');
const RENAMED = loadManifest(ROOT).renamed;
const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const OLD_KEY = 'claude-stack'; // legacy-name
const HASH = 'a'.repeat(64);

const write = (repo, rel, text = 'x\n') =>
{
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
};
const skill = (name) => `---\nname: ${name}\ndescription: "Use when testing."\n---\n\nbody\n`;
const renamedLines = (out) => String(out).split('\n').filter((l) => /^==> renamed: /.test(l));

// The installed state, read back after a run: the new stamp's picks and library lines, the copies
// on disk, and the settings file.
function inspect(repo)
{
    const claude = path.join(repo, '.claude');
    const read = (rel) => { try { return fs.readFileSync(path.join(claude, rel), 'utf8'); } catch { return ''; } };
    const stamp = read('alfred-code.stamp');
    const line = (key) => ((new RegExp(`^${key}: (.*)$`, 'm').exec(stamp) || [])[1] || '').split(',').filter(Boolean);
    const list = (dir) => { try { return fs.readdirSync(path.join(claude, dir)).sort(); } catch { return []; } };
    let settings = {};
    try { settings = JSON.parse(read('settings.json')); } catch { settings = {}; }
    return {
        pickedSkills: line('picked-skills'), pickedAgents: line('picked-agents'),
        librarySkills: line('library-skills').map((e) => e.split('=')[0]),
        skills: list('skills'), agents: list('agents'), settings,
        oldStamp: fs.existsSync(path.join(claude, 'claude-stack.stamp')), // legacy-name
    };
}

// ---------- the table ----------

test('the renamed map: every old name is retired, every new name ships, and no name is both', () =>
{
    const m = loadManifest(ROOT);
    const skills = new Set(m.catalogs.skills.map((e) => e.split('|').pop()));
    const agents = new Set(m.agents.map((f) => f.replace(/\.md$/, '')));
    assert.strictEqual(Object.keys(RENAMED.skills).length, 26, 'the 23 project-* skills plus the three 2.1.0 renames');
    assert.strictEqual(Object.keys(RENAMED.agents).length, 2, 'the two failure diagnosers');
    for (const [from, to] of Object.entries(RENAMED.skills))
    {
        assert.ok(m.retired.skills.includes(from), `${from} is retired, so its copy is pruned`);
        assert.ok(skills.has(to) && !skills.has(from), `${from} -> ${to}: the new name ships, the old does not`);
    }
    for (const [from, to] of Object.entries(RENAMED.agents))
    {
        assert.ok(m.retired.agents.includes(`${from}.md`), `${from} is retired`);
        assert.ok(agents.has(to) && !agents.has(from), `${from} -> ${to}`);
    }
    // M2: a new name is never retired - every run would prune the copy it just carried across.
    for (const to of Object.values(RENAMED.skills)) assert.ok(!m.retired.skills.includes(to), `${to} is a rename target and retired too`);
    for (const to of Object.values(RENAMED.agents)) assert.ok(!m.retired.agents.includes(`${to}.md`), `${to} is a rename target and retired too`);
});

// 2.1.0: three more skills take alfred-habits-* names, and plugin-authoring leaves the shipped catalog
// (it is retired, not renamed - this repo keeps its own copy in .claude/skills).
const V21 = { 'alfred-capture-claude-md': 'alfred-habits-adjust-claude-md', 'create-ticket': 'alfred-habits-create-ticket', 'explain-code-tutor': 'alfred-habits-explain-code' };

test('2.1.0 renames: each old skill maps to its new name, is retired, and plugin-authoring is retired and no longer ships', () =>
{
    const m = loadManifest(ROOT);
    const skills = new Set(m.catalogs.skills.map((e) => e.split('|').pop()));
    for (const [from, to] of Object.entries(V21))
    {
        assert.strictEqual(RENAMED.skills[from], to, `renamed.skills ${from}`);
        assert.ok(m.retired.skills.includes(from), `${from} is retired`);
        assert.ok(skills.has(to) && !skills.has(from), `${to} ships, ${from} does not`);
        assert.ok(fs.existsSync(path.join(ROOT, 'stack', 'skills', to, 'SKILL.md')) && !fs.existsSync(path.join(ROOT, 'stack', 'skills', from)), `${to} is on disk under its new name only`);
    }
    assert.ok(m.retired.skills.includes('plugin-authoring') && !skills.has('plugin-authoring'), 'plugin-authoring is retired and not in the catalog');
    assert.ok(!fs.existsSync(path.join(ROOT, 'stack', 'skills', 'plugin-authoring')), 'plugin-authoring is not under stack/skills');
    assert.deepStrictEqual(selection.renamePicked({ skills: ['create-ticket@alfred-code', 'explain-code-tutor', 'alfred-capture-claude-md@alfred-code'], agents: [] }, { renamed: RENAMED, log: () => {}, said: new Set() }),
        { skills: ['alfred-habits-create-ticket@alfred-code', 'alfred-habits-explain-code', 'alfred-habits-adjust-claude-md@alfred-code'], agents: [] }, 'a pick keeps its home and takes the new name');
});

// ---------- the read-side helpers ----------

test('renameLines: an old skill or seat line reads under its new name, one line per rename per run', () =>
{
    const logs = [];
    const said = new Set();
    const opts = { renamed: RENAMED, log: (m) => logs.push(m), said };
    const out = selection.renameLines(['skill project-solve-task', 'agent ci-failure-diagnoser', 'rule markdown-docs', 'skill my-own-skill', 'hook none'], opts);
    assert.deepStrictEqual(out, ['skill alfred-task-solve', 'agent alfred-issue-diagnoser-ci', 'rule markdown-docs', 'skill my-own-skill', 'hook none']);
    selection.renameLines(['skill project-solve-task'], opts);
    assert.deepStrictEqual(logs, [
        'renamed: skill project-solve-task -> alfred-task-solve',
        'renamed: agent ci-failure-diagnoser -> alfred-issue-diagnoser-ci',
    ], 'the second sighting of a rename says nothing');
    // A rule line reads only by the table's own `rules` part (2.1.6: baseline-git -> alfred-git), a hook never
    // is renamed, and an MCP line only by its own `mcps` part (the 2.0.0 role names) - never under a skill's.
    assert.deepStrictEqual(selection.renameLines(['rule baseline-git', 'rule baseline-project-run-book', 'hook baseline-git'], opts), ['rule alfred-git', 'rule baseline-project-run-book', 'hook baseline-git']);
    assert.deepStrictEqual(selection.renameLines(['rule project-solve-task', 'mcp project-solve-task'], opts), ['rule project-solve-task', 'mcp project-solve-task']);
    assert.deepStrictEqual(selection.renameLines(['mcp serena', 'skill serena'], opts), ['mcp navigation', 'skill serena']);
});

test('renamePicked: a stamp pick keeps its home and takes the new name; no picks stays null', () =>
{
    const opts = { renamed: RENAMED, log: () => {}, said: new Set() };
    assert.strictEqual(selection.renamePicked(null, opts), null, 'a stamp that never recorded picks is not one that recorded none');
    assert.deepStrictEqual(selection.renamePicked({ skills: [`project-verify-code@${OLD_KEY}`, 'project-related-context', 'csharp'], agents: ['runtime-failure-diagnoser@alfred-code'] }, opts),
        { skills: [`alfred-task-verify-code@${OLD_KEY}`, 'alfred-capture-related-projects', 'csharp'], agents: ['alfred-issue-diagnoser-runtime@alfred-code'] });
});

test('renameDeny: a stack seat deny reads under the new seat, under any stack spelling; a foreign one is not touched', () =>
{
    const settings = { env: { MY_OWN_KEY: '1' }, permissions: { deny: [
        'Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`,
        'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
    ] } };
    const before = JSON.stringify(settings);
    const out = selection.renameDeny(settings, { renamed: RENAMED, log: () => {}, said: new Set() });
    assert.deepStrictEqual(out.permissions.deny, [
        'Agent(alfred-code:alfred-issue-diagnoser-ci)', `Agent(${OLD_KEY}:alfred-issue-diagnoser-runtime)`,
        'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
    ]);
    assert.strictEqual(JSON.stringify(settings), before, 'the read is a view - the file is re-spelled by the writer');
    assert.deepStrictEqual(selection.renameDeny({}, { renamed: RENAMED }), {}, 'no deny list is nothing to rename');
});

// ---------- the names the stack wrote into the project's own files (I2, R128) ----------

// The v1.3.0 template's lines that name an old command, verbatim, plus two generated-rule bodies.
const V13_CLAUDE_MD = [
    '   /project-architecture-analyzer, /project-code-style-analyzer, /project-related-context ONLY',
    '   /project-agent-capabilities LAST, so its generated inventory reflects the final install. All but',
    '   /project-architecture-analyzer are slash-only: the user types them - a model Skill call is refused.',
    '   .claude/rules/alfred-project-agent-capabilities.md (user-run /project-agent-capabilities; if',
    '| `.claude/rules/alfred-git.md` | commits, branches, PRs, push discipline - the checkpoint protocol itself is the `project-commit-checkpoint` skill |',
    '| `.claude/rules/alfred-project-related-context.md` (GENERATED, OPTIONAL - only where the project has sibling repos; user-run /project-related-context with their paths/URLs) | sibling-repo awareness |',
    '',
].join('\n');
const V13_CLAUDE_MD_NOW = [
    '   /alfred-capture-architecture, /alfred-capture-code-style, /alfred-capture-related-projects ONLY',
    '   /alfred-capture-agent-capabilities LAST, so its generated inventory reflects the final install. All but',
    '   /alfred-capture-architecture are slash-only: the user types them - a model Skill call is refused.',
    '   .claude/rules/alfred-project-agent-capabilities.md (user-run /alfred-capture-agent-capabilities; if',
    '| `.claude/rules/alfred-git.md` | commits, branches, PRs, push discipline - the checkpoint protocol itself is the `alfred-habits-commit-checkpoint` skill |',
    '| `.claude/rules/alfred-project-related-context.md` (GENERATED, OPTIONAL - only where the project has sibling repos; user-run /alfred-capture-related-projects with their paths/URLs) | sibling-repo awareness |',
    '',
].join('\n');
const CAPABILITIES_RULE = '# Agent capabilities\n\nGenerated by /project-agent-capabilities.\n\n- `ci-failure-diagnoser` - a red CI run; `runtime-failure-diagnoser` - a crash.\n- `alfred-code:project-architecture-quality-loop` loops the capture.\n';
const LONGER = 'Keep alfred-project-related-context.md, my-project-solve-task-notes, project-solve-task-v2 and xci-failure-diagnoser as they are.\n';

test('respellRenamed (I2): every old name the stack wrote into CLAUDE.md and a generated rule is re-spelled as a whole token, one line per file, and a second run changes nothing', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-docs-'));
    try
    {
        const files = {
            'CLAUDE.md': LONGER,
            '.claude/CLAUDE.md': V13_CLAUDE_MD,
            '.claude/rules/alfred-project-agent-capabilities.md': CAPABILITIES_RULE,
            '.claude/rules/alfred-project-architecture.md': 'Nothing old here - alfred-capture-architecture writes it.\n',
            '.claude/rules/my-own-rule.md': 'My notes on /project-solve-task stay mine.\n',
            '.claude/rules/project-code-style.md': '---\npaths: ["**/*.ts"]\n---\nthe project-code-style-analyzer skill owns this rule\n',
        };
        for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
        const logs = [];
        const run = () => selection.respellRenamed({ projectRoot: dir, renamed: RENAMED, log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
        assert.strictEqual(read('.claude/CLAUDE.md'), V13_CLAUDE_MD_NOW, 'the 1.3.0 template text reads under the new names; the rule FILE names stay');
        assert.strictEqual(read('.claude/rules/alfred-project-agent-capabilities.md'),
            '# Agent capabilities\n\nGenerated by /alfred-capture-agent-capabilities.\n\n- `alfred-issue-diagnoser-ci` - a red CI run; `alfred-issue-diagnoser-runtime` - a crash.\n- `alfred-code:alfred-loop-architecture-quality` loops the capture.\n',
            'a seat name and a plugin-prefixed name are re-spelled too');
        assert.strictEqual(read('CLAUDE.md'), LONGER, 'an old name inside a longer name is never touched');
        assert.strictEqual(read('.claude/rules/my-own-rule.md'), files['.claude/rules/my-own-rule.md'], 'a rule the stack did not generate is not the stack\'s to re-spell');
        assert.strictEqual(read('.claude/rules/alfred-project-architecture.md'), files['.claude/rules/alfred-project-architecture.md']);
        assert.match(read('.claude/rules/project-code-style.md'), /the alfred-capture-code-style skill owns this rule/, 'the generated code-style rule is the stack\'s too');
        assert.deepStrictEqual(logs, [
            '  renamed: .claude/CLAUDE.md - 8 old skill or seat name(s) re-spelled to the new names',
            '  renamed: .claude/rules/alfred-project-agent-capabilities.md - 4 old skill or seat name(s) re-spelled to the new names',
            '  renamed: .claude/rules/project-code-style.md - 1 old skill or seat name(s) re-spelled to the new names',
        ], 'one line per file that changed, with its count; a file with no hit says nothing');
        const after = Object.keys(files).map(read);
        logs.length = 0;
        run();
        assert.deepStrictEqual(Object.keys(files).map(read), after, 'a second run changes nothing');
        assert.deepStrictEqual(logs, [], 'and says nothing');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respellRenamed (I2): the longest old name wins, and a shorter one inside it is never re-spelled on its own', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-docs-'));
    try
    {
        write(dir, 'CLAUDE.md', 'Run /old-loop, then /old-loop-deep.\n');
        const renamed = { skills: { 'old-loop': 'new-loop', 'old-loop-deep': 'new-deep' }, agents: {} };
        selection.respellRenamed({ projectRoot: dir, renamed, log: () => {}, note: (m) => assert.fail(m) });
        assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'Run /new-loop, then /new-deep.\n');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The 2.0.0 MCP rename: a generated rule names the servers the capture saw - their tool spellings (the
// plugin form, or the bare one a copy-route registration answers) and each routing row's server. Those
// follow the rename like a skill name does, so no seat is pointed at a tool that no longer resolves. The
// spellings are built, never typed: lint 54 and 59 read this file.
const pluginTool = (n, t) => `mcp__plugin_${n}_${n}__${t}`;
const bareTool = (n, t) => `mcp_${'_'}${n}__${t}`;
test('respellRenamed: a generated rule\'s old MCP tool spellings and routing keys follow the 2.0.0 rename, and a second run changes nothing', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-docs-'));
    try
    {
        const before = [
            '## MCP routing',
            `- \`serena\` - first call: \`ToolSearch select:${pluginTool('serena', 'find_symbol')},${pluginTool('serena', 'get_symbols_overview')}\``,
            `- \`context7\` - first call: \`ToolSearch select:${pluginTool('context7', 'query-docs')}\``,
            `- \`playwright-firefox\` - registered: \`${bareTool('playwright-firefox', 'browser_snapshot')}\``,
            `- \`memory\` - \`${pluginTool('memory', 'memory_search')}\`, and my own \`serena-notes\` stay`,
            '',
        ].join('\n');
        const after = [
            '## MCP routing',
            `- \`navigation\` - first call: \`ToolSearch select:${pluginTool('navigation', 'find_symbol')},${pluginTool('navigation', 'get_symbols_overview')}\``,
            `- \`documentation\` - first call: \`ToolSearch select:${pluginTool('documentation', 'query-docs')}\``,
            `- \`browser-firefox\` - registered: \`${bareTool('browser-firefox', 'browser_snapshot')}\``,
            `- \`memory\` - \`${pluginTool('memory', 'memory_search')}\`, and my own \`serena-notes\` stay`,
            '',
        ].join('\n');
        write(dir, '.claude/rules/alfred-project-agent-capabilities.md', before);
        const logs = [];
        const run = () => selection.respellRenamed({ projectRoot: dir, renamed: RENAMED, log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const read = () => fs.readFileSync(path.join(dir, '.claude/rules/alfred-project-agent-capabilities.md'), 'utf8');
        assert.strictEqual(read(), after);
        assert.deepStrictEqual(logs, ['  renamed: .claude/rules/alfred-project-agent-capabilities.md - 7 old MCP tool or server name(s) re-spelled to the new names']);
        logs.length = 0;
        run();
        assert.strictEqual(read(), after, 'a second run changes nothing');
        assert.deepStrictEqual(logs, []);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M46: before one server per engine the browser was ONE registration, `playwright`, and a generated rule written then
// spells its tools under that one bare name; the rename table maps only the per-engine names, so that spelling was never
// re-spelled. It follows to the first engine this project keeps (chrome when it keeps none).
test('M46 respellRenamed: the single pre-per-engine browser spelling follows to the first kept engine', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-pw-'));
    try
    {
        const rule = '.claude/rules/alfred-project-agent-capabilities.md';
        write(dir, rule, `- browser - \`${bareTool('playwright', 'browser_navigate')}\`, \`${bareTool('playwright', 'browser_snapshot')}\`\n`);
        const logs = [];
        selection.respellRenamed({ projectRoot: dir, renamed: RENAMED, engines: ['firefox', 'chrome'], log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        const text = fs.readFileSync(path.join(dir, rule), 'utf8');
        assert.strictEqual(text, `- browser - \`${bareTool('browser-firefox', 'browser_navigate')}\`, \`${bareTool('browser-firefox', 'browser_snapshot')}\`\n`);
        write(dir, rule, `\`${bareTool('playwright', 'browser_click')}\`\n`);
        selection.respellRenamed({ projectRoot: dir, renamed: RENAMED, log: () => {}, note: (m) => assert.fail(m) });
        assert.strictEqual(fs.readFileSync(path.join(dir, rule), 'utf8'), `\`${bareTool('browser-chrome', 'browser_click')}\`\n`, 'no kept engine: chrome');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('respellRenamed (I2): no CLAUDE.md and no rules folder is nothing to do', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-docs-'));
    try { assert.strictEqual(selection.respellRenamed({ projectRoot: dir, renamed: RENAMED, log: (m) => assert.fail(m), note: (m) => assert.fail(m) }), 0); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the writer ----------

test('settings writer: a renamed seat deny is re-spelled in the file, a skillOverrides key moves to the new name, the user\'s own entries stay', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({
            env: { MY_OWN_KEY: 'mine' },
            skillOverrides: { 'project-related-context': 'off', 'my-own-skill': 'name-only' },
            permissions: { deny: [
                'Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`,
                'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
            ] },
        }, null, 2));
        const logs = [];
        const run = () => writeSettings({ file, renamed: RENAMED, liveEntries: [], log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(data.permissions.deny.slice().sort(), [
            'Agent(alfred-code:alfred-issue-diagnoser-ci)', 'Agent(alfred-code:alfred-issue-diagnoser-runtime)',
            'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)',
        ].sort());
        assert.deepStrictEqual(data.skillOverrides, { 'alfred-capture-related-projects': 'off', 'my-own-skill': 'name-only' });
        assert.strictEqual(data.env.MY_OWN_KEY, 'mine', "the user's own settings key survives");
        assert.ok(logs.some((m) => /ci-failure-diagnoser\).*alfred-issue-diagnoser-ci/.test(m)), logs.join('\n'));
        assert.ok(logs.some((m) => /skillOverrides project-related-context .*alfred-capture-related-projects/.test(m)), logs.join('\n'));
        const again = JSON.stringify(data);
        const second = run();
        assert.strictEqual(second.written, false, 'a second run changes nothing');
        assert.strictEqual(fs.readFileSync(file, 'utf8').trim(), JSON.stringify(JSON.parse(again), null, 2));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settings writer: a skillOverrides value already set under the new name wins over the old key', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        fs.writeFileSync(file, JSON.stringify({ skillOverrides: { 'project-first-look': 'off', 'alfred-capture-first-look': 'on' } }));
        writeSettings({ file, renamed: RENAMED, log: () => {}, note: (m) => assert.fail(m) });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).skillOverrides, { 'alfred-capture-first-look': 'on' });
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settings writer: a personal skillOverrides switch-off in settings.local.json follows the rename there, and nothing moves to the shared file', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        const localFile = path.join(dir, 'settings.local.json');
        fs.writeFileSync(file, JSON.stringify({ env: {} }));
        fs.writeFileSync(localFile, JSON.stringify({ skillOverrides: { 'project-quality-loop': 'off', 'my-own-skill': 'off' }, MY_LOCAL_KEY: 1 }));
        const logs = [];
        const run = () => writeSettings({ file, localFile, renamed: RENAMED, log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
        assert.deepStrictEqual(local.skillOverrides, { 'my-own-skill': 'off', 'alfred-loop-quality': 'off' });
        assert.strictEqual(local.MY_LOCAL_KEY, 1, "the user's own local key survives");
        assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).skillOverrides, undefined, 'a personal switch-off stays personal');
        assert.ok(logs.some((m) => /settings\.local\.json: skillOverrides project-quality-loop re-keyed alfred-loop-quality/.test(m)), logs.join('\n'));
        const before = fs.readFileSync(localFile, 'utf8');
        run();
        assert.strictEqual(fs.readFileSync(localFile, 'utf8'), before, 'a second run changes nothing');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// I1 (fix round 1): a seat the user switched off for themselves - a deny in settings.local.json - is
// re-spelled where it is, never moved into the shared file, and the read-back sees it off.
const LOCAL_DENY = [`Agent(${OLD_KEY}:ci-failure-diagnoser)`, 'Agent(alfred-code:runtime-failure-diagnoser)', 'Bash(my-own:*)'];
test('settings writer (I1): a seat deny in settings.local.json is re-spelled there, and the shared file gains none of it', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        const file = path.join(dir, 'settings.json');
        const localFile = path.join(dir, 'settings.local.json');
        fs.writeFileSync(file, JSON.stringify({ env: { MY_OWN_KEY: 'mine' } }));
        fs.writeFileSync(localFile, JSON.stringify({ permissions: { deny: LOCAL_DENY }, MY_LOCAL_KEY: 1 }));
        const logs = [];
        // The read-back sees both seats off, so the run's agent off-list names them under the new name.
        const agentDeny = ['Agent(alfred-code:alfred-issue-diagnoser-ci)', 'Agent(alfred-code:alfred-issue-diagnoser-runtime)'];
        const run = () => writeSettings({ file, localFile, renamed: RENAMED, liveEntries: [], agentDeny, log: (m) => logs.push(m), note: (m) => assert.fail(m) });
        run();
        const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
        assert.deepStrictEqual(local.permissions.deny.slice().sort(), [...agentDeny, 'Bash(my-own:*)'].sort(), local.permissions.deny.join('\n'));
        assert.strictEqual(local.MY_LOCAL_KEY, 1);
        const shared = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(!((shared.permissions || {}).deny || []).some((d) => /diagnoser/.test(d)), `a personal switch-off moved into the shared file: ${JSON.stringify(shared.permissions)}`);
        assert.strictEqual(shared.env.MY_OWN_KEY, 'mine');
        assert.ok(logs.some((m) => /^ {2}settings\.local\.json: .*ci-failure-diagnoser\).*alfred-issue-diagnoser-ci/.test(m)), logs.join('\n'));
        const before = [fs.readFileSync(file, 'utf8'), fs.readFileSync(localFile, 'utf8')];
        run();
        assert.deepStrictEqual([fs.readFileSync(file, 'utf8'), fs.readFileSync(localFile, 'utf8')], before, 'a second run changes nothing');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readBackSettings (I1): at project and user scope a stack seat deny in settings.local.json is read, and nothing else of that file\'s deny list is', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-settings-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'] } }));
        fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ permissions: { deny: LOCAL_DENY } }));
        for (const scope of ['project', 'user'])
        {
            const deny = readBackSettings(dir, scope).permissions.deny;
            assert.deepStrictEqual(deny.slice().sort(), ['Read(.env)', ...LOCAL_DENY.slice(0, 2)].sort(), `${scope}: ${deny.join(' ')}`);
            assert.deepStrictEqual(readBackSettings(dir, scope, { sharedOnly: true }).permissions.deny, ['Read(.env)'], `${scope}: sharedOnly stays the shared file alone`);
        }
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- end to end, one case per migration shape ----------

// Shape 1: a 1.3.0 install on the plugin route - the 1.x core under the old key, a stamp whose picks
// name the old core skills and seat plus a library pick, and that library pick's copy on disk.
const V13_LISTING = JSON.stringify([OLD_KEY, 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@${OLD_KEY}`, version: '1.3.0', scope: 'project', enabled: true })));
function v13Plugin(repo)
{
    write(repo, '.claude/rules/alfred-interaction.md');
    write(repo, '.claude/skills/project-related-context/SKILL.md', skill('project-related-context'));
    write(repo, '.claude/claude-stack.stamp', [ // legacy-name
        'version: 1.3.0', 'sha: 0000000',
        `picked-skills: project-solve-task@${OLD_KEY},project-commit-checkpoint@${OLD_KEY},project-related-context,markdown-style@${OLD_KEY}`,
        `picked-agents: ci-failure-diagnoser@${OLD_KEY},security-auditor@${OLD_KEY}`,
        `library-skills: project-related-context=${HASH}`, '',
    ].join('\n'));
    write(repo, '.claude/settings.json', JSON.stringify({ env: { MY_OWN_KEY: 'mine' } }, null, 2));
}

test('seed update --installed-only over a 1.3.0 stamp: every old pick is carried under its new name, the old copy is gone, one line per rename, and a re-run is quiet', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', {
        plugins: V13_LISTING, args: ['--installed-only'], prepare: v13Plugin, each: inspect,
    });
    const [first, second] = steps;
    // A skill is a copy since 2.1.0 - its pick has no plugin home.
    assert.ok(first.pickedSkills.includes('alfred-task-solve'), first.pickedSkills.join(','));
    assert.ok(first.pickedSkills.includes('alfred-habits-commit-checkpoint'), first.pickedSkills.join(','));
    assert.ok(first.pickedSkills.includes('alfred-capture-related-projects'), `the library pick is carried: ${first.pickedSkills.join(',')}`);
    assert.ok(first.pickedAgents.includes('alfred-issue-diagnoser-ci@alfred-code'), first.pickedAgents.join(','));
    const old = new Set([...Object.keys(RENAMED.skills), ...Object.keys(RENAMED.agents)]);
    const named = (list) => list.map((e) => e.split('@')[0]).filter((n) => old.has(n));
    assert.deepStrictEqual(named([...first.pickedSkills, ...first.pickedAgents, ...first.librarySkills]), [], 'the new stamp names no old item');
    assert.ok(first.skills.includes('alfred-capture-related-projects'), `the library copy arrives under its new name: ${first.skills.join(' ')}`);
    assert.ok(!first.skills.includes('project-related-context'), 'the old copy is pruned');
    assert.deepStrictEqual(first.librarySkills.filter((n) => n.startsWith('alfred-capture-related')), ['alfred-capture-related-projects']);
    assert.strictEqual(first.settings.env.MY_OWN_KEY, 'mine', "the user's own settings key survives");
    assert.strictEqual(first.oldStamp, false);
    const lines = renamedLines(outs[0]);
    for (const [kind, from, to] of [['skill', 'project-solve-task', 'alfred-task-solve'], ['skill', 'project-commit-checkpoint', 'alfred-habits-commit-checkpoint'],
        ['skill', 'project-related-context', 'alfred-capture-related-projects'], ['agent', 'ci-failure-diagnoser', 'alfred-issue-diagnoser-ci']])
        assert.strictEqual(lines.filter((l) => l === `==> renamed: ${kind} ${from} -> ${to}`).length, 1, `${from}: exactly one line\n${lines.join('\n')}`);
    assert.strictEqual(lines.length, new Set(lines).size, 'no rename is said twice');
    assert.deepStrictEqual(renamedLines(outs[1]), [], 'the re-run has nothing left to rename');
    assert.deepStrictEqual([second.pickedSkills, second.pickedAgents, second.skills, second.agents], [first.pickedSkills, first.pickedAgents, first.skills, first.agents], 'the re-run changes nothing');
});

// Shape 2: a seat the user switched off under its old name - the 2.0.0 core spelling and the 1.x one
// - stays off under its new name, and a skillOverrides switch-off follows its skill.
test('seed update --installed-only: a seat denied under its old name stays denied under the new one, and nothing else of the user\'s moves', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        write(repo, '.claude/skills/project-related-context/SKILL.md', skill('project-related-context'));
        write(repo, '.claude/alfred-code.stamp', 'version: 1.3.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code,project-related-context\npicked-agents: security-auditor@alfred-code\n');
        write(repo, '.claude/settings.json', JSON.stringify({
            env: { MY_OWN_KEY: 'mine' },
            skillOverrides: { 'project-related-context': 'off' },
            permissions: { deny: ['Agent(alfred-code:ci-failure-diagnoser)', `Agent(${OLD_KEY}:runtime-failure-diagnoser)`, 'Agent(someone-else:ci-failure-diagnoser)', 'Bash(rm -rf:*)'] },
        }, null, 2));
    };
    const { result: r, out } = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only'], prepare, inspect });
    const deny = r.settings.permissions.deny;
    assert.ok(deny.includes('Agent(alfred-code:alfred-issue-diagnoser-ci)') && deny.includes('Agent(alfred-code:alfred-issue-diagnoser-runtime)'), deny.join('\n'));
    assert.ok(!deny.some((d) => /^Agent\((alfred-code|claude-stack)[a-z0-9-]*:(ci|runtime)-failure-diagnoser\)$/.test(d)), `no stack deny keeps an old seat name:\n${deny.join('\n')}`); // legacy-name
    assert.ok(deny.includes('Agent(someone-else:ci-failure-diagnoser)') && deny.includes('Bash(rm -rf:*)'), "the user's own entries stay");
    assert.ok(!r.pickedAgents.some((e) => /diagnoser/.test(e)), `a denied seat is no pick: ${r.pickedAgents.join(',')}`);
    assert.deepStrictEqual(r.settings.skillOverrides, { 'alfred-capture-related-projects': 'off' }, 'the skill switch-off follows the skill');
    assert.ok(r.skills.includes('alfred-capture-related-projects') && !r.skills.includes('project-related-context'), r.skills.join(' '));
    assert.strictEqual(r.settings.env.MY_OWN_KEY, 'mine');
    assert.ok(renamedLines(out).includes('==> renamed: agent ci-failure-diagnoser -> alfred-issue-diagnoser-ci'), out);
});

// I1 / R126 at every scope: a seat the user denied for themselves in settings.local.json stays off
// under its new name, in that file, and a re-run changes nothing.
for (const scope of ['project', 'user', 'local'])
{
    test(`seed update --installed-only --scope ${scope} (I1): a seat denied in settings.local.json stays off there under its new name, and a re-run is quiet`, POSIX_ONLY, () =>
    {
        const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope, enabled: true })));
        const shared = JSON.stringify({ env: { MY_OWN_KEY: 'mine' } }, null, 2);
        const prepare = (repo) =>
        {
            write(repo, '.claude/rules/alfred-interaction.md');
            write(repo, '.claude/alfred-code.stamp', 'version: 1.3.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code\npicked-agents: security-auditor@alfred-code\n');
            write(repo, '.claude/settings.json', shared);
            write(repo, '.claude/settings.local.json', JSON.stringify({ permissions: { deny: LOCAL_DENY }, MY_LOCAL_KEY: 1 }, null, 2));
        };
        const each = (repo) =>
        {
            const raw = (name) => fs.readFileSync(path.join(repo, '.claude', name), 'utf8');
            return { ...inspect(repo), sharedRaw: raw('settings.json'), localRaw: raw('settings.local.json'), local: JSON.parse(raw('settings.local.json')) };
        };
        const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', { plugins: listing, args: ['--installed-only', '--scope', scope], prepare, each });
        const [first, second] = steps;
        const deny = first.local.permissions.deny;
        assert.ok(deny.includes('Agent(alfred-code:alfred-issue-diagnoser-ci)') && deny.includes('Agent(alfred-code:alfred-issue-diagnoser-runtime)'), `${scope}: ${deny.join(' | ')}\n${outs[0]}`);
        assert.ok(!deny.some((d) => /:(ci|runtime)-failure-diagnoser\)$/.test(d)), `${scope}: an old seat spelling is left in settings.local.json: ${deny.join(' | ')}`);
        assert.ok(deny.includes('Bash(my-own:*)') && first.local.MY_LOCAL_KEY === 1, `${scope}: the user's own local entries stay`);
        if (scope === 'local') assert.strictEqual(first.sharedRaw, shared, 'a local-scope run never writes the shared file');
        else assert.ok(!((first.settings.permissions || {}).deny || []).some((d) => /diagnoser/.test(d)), `${scope}: a personal switch-off moved into settings.json: ${first.sharedRaw}`);
        assert.strictEqual(first.settings.env.MY_OWN_KEY, 'mine');
        assert.ok(!first.pickedAgents.some((e) => /diagnoser/.test(e)), `${scope}: a denied seat is no pick: ${first.pickedAgents.join(',')}`);
        assert.deepStrictEqual([second.sharedRaw, second.localRaw], [first.sharedRaw, first.localRaw], `${scope}: the re-run changes neither file`);
        assert.deepStrictEqual(renamedLines(outs[1]), [], `${scope}: the re-run has nothing left to rename`);
    });
}

// I2 end to end: a 1.3.0 project's seeded CLAUDE.md and a generated rule read under the new names
// after its first 2.0.0 update, and the next update touches neither.
test('seed update --installed-only (I2): the 1.3.0-seeded CLAUDE.md and a generated rule name the new commands, one line per file, and a re-run is quiet', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        v13Plugin(repo);
        write(repo, '.claude/CLAUDE.md', V13_CLAUDE_MD);
        write(repo, '.claude/rules/alfred-project-agent-capabilities.md', CAPABILITIES_RULE);
    };
    const each = (repo) => ({ claudeMd: fs.readFileSync(path.join(repo, '.claude', 'CLAUDE.md'), 'utf8'), rule: fs.readFileSync(path.join(repo, '.claude', 'rules', 'alfred-project-agent-capabilities.md'), 'utf8') });
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', { plugins: V13_LISTING, args: ['--installed-only'], prepare, each });
    assert.strictEqual(steps[0].claudeMd, V13_CLAUDE_MD_NOW, outs[0]);
    assert.match(steps[0].rule, /Generated by \/alfred-capture-agent-capabilities\./);
    const lines = (out) => String(out).split('\n').filter((l) => /^==> {3}renamed: \S+ - \d+ old skill or seat name/.test(l));
    assert.deepStrictEqual(lines(outs[0]), [
        '==>   renamed: .claude/CLAUDE.md - 8 old skill or seat name(s) re-spelled to the new names',
        '==>   renamed: .claude/rules/alfred-project-agent-capabilities.md - 4 old skill or seat name(s) re-spelled to the new names',
    ], outs[0]);
    assert.deepStrictEqual(steps[1], steps[0], 'the re-run changes neither file');
    assert.deepStrictEqual(lines(outs[1]), [], 'and prints no line');
});

// M1: at local scope the shared settings.json is a file the run never writes - an old seat name only
// it holds is no rename this run made, so it gets a note on every run, never a `renamed:` line.
test('seed update --installed-only --scope local (M1): an old seat deny only settings.json holds is noted, never reported as renamed, and the seat stays off', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'local', enabled: true })));
    const shared = JSON.stringify({ permissions: { deny: [`Agent(${OLD_KEY}:ci-failure-diagnoser)`] } }, null, 2);
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        write(repo, '.claude/alfred-code.stamp', 'version: 2.0.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code\npicked-agents: security-auditor@alfred-code\n');
        write(repo, '.claude/settings.json', shared);
    };
    const each = (repo) => ({
        sharedRaw: fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'),
        local: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')),
    });
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', { plugins: listing, args: ['--installed-only', '--scope', 'local'], prepare, each });
    for (const [i, out] of outs.entries())
    {
        assert.deepStrictEqual(renamedLines(out), [], `run ${i + 1}: nothing this run wrote was renamed\n${out}`);
        assert.match(out, new RegExp(`settings\\.json still names Agent\\(${OLD_KEY}:ci-failure-diagnoser\\) - read as alfred-issue-diagnoser-ci`), `run ${i + 1}`);
        assert.strictEqual(steps[i].sharedRaw, shared, 'a local-scope run never writes the shared file');
        assert.ok(steps[i].local.permissions.deny.includes('Agent(alfred-code:alfred-issue-diagnoser-ci)'), `run ${i + 1}: the seat stays off for this user: ${JSON.stringify(steps[i].local.permissions)}`);
    }
});

// Shape 3: the full copy route - every skill and seat is a project copy under its old name.
test('seed update --installed-only on the copy route: the old copies become new copies and none is left behind', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        for (const n of ['project-solve-task', 'project-verify-code', 'markdown-style']) write(repo, `.claude/skills/${n}/SKILL.md`, skill(n));
        for (const n of ['ci-failure-diagnoser', 'security-auditor']) write(repo, `.claude/agents/${n}.md`, `---\nname: ${n}\n---\n`);
        write(repo, '.claude/claude-stack.stamp', 'version: 1.3.0\nsha: 0000000\nhooks-route: copy\n'); // legacy-name
    };
    const { result: r, out } = seedRun('update', 'skill markdown-style\n', { env: COPY_ROUTE, args: ['--installed-only'], prepare, inspect });
    for (const n of ['alfred-task-solve', 'alfred-task-verify-code', 'markdown-style']) assert.ok(r.skills.includes(n), `${n} is copied: ${r.skills.join(' ')}`);
    assert.ok(r.agents.includes('alfred-issue-diagnoser-ci.md') && r.agents.includes('security-auditor.md'), r.agents.join(' '));
    assert.ok(!r.skills.includes('project-solve-task') && !r.skills.includes('project-verify-code'), `an old skill copy survived: ${r.skills.join(' ')}`);
    assert.ok(!r.agents.includes('ci-failure-diagnoser.md'), `an old seat copy survived: ${r.agents.join(' ')}`);
    const names = (list) => list.map((e) => e.split('@')[0]);
    assert.ok(names(r.pickedSkills).includes('alfred-task-solve') && names(r.pickedAgents).includes('alfred-issue-diagnoser-ci'), `${r.pickedSkills} | ${r.pickedAgents}`);
    assert.ok(!names(r.pickedSkills).includes('project-solve-task') && !names(r.pickedAgents).includes('ci-failure-diagnoser'), 'the stamp names no old item');
    assert.strictEqual(renamedLines(out).length, 3, renamedLines(out).join('\n'));
});

test('seed update --installed-only over a 2.0.0 copy install: the three renamed skills arrive under their new names, the old copies go, and a re-run changes nothing', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        for (const n of Object.keys(V21)) write(repo, `.claude/skills/${n}/SKILL.md`, skill(n));
        write(repo, '.claude/alfred-code.stamp', ['version: 2.0.0', 'sha: 0000000', 'hooks-route: copy', `picked-skills: ${Object.keys(V21).join(',')}`, ''].join('\n'));
    };
    const { steps, outs } = seedRun(['update', 'update'], '', { env: COPY_ROUTE, args: ['--installed-only'], prepare, each: inspect });
    const [first, second] = steps;
    for (const [from, to] of Object.entries(V21))
    {
        assert.ok(first.skills.includes(to), `${to} is copied: ${first.skills.join(' ')}`);
        assert.ok(!first.skills.includes(from), `${from} is pruned: ${first.skills.join(' ')}`);
        assert.ok(first.pickedSkills.map((e) => e.split('@')[0]).includes(to), `the stamp picks ${to}: ${first.pickedSkills.join(',')}`);
        assert.ok(!first.pickedSkills.map((e) => e.split('@')[0]).includes(from), `the stamp names no ${from}`);
        assert.strictEqual(renamedLines(outs[0]).filter((l) => l === `==> renamed: skill ${from} -> ${to}`).length, 1, renamedLines(outs[0]).join('\n'));
    }
    assert.deepStrictEqual(renamedLines(outs[1]), []);
    assert.deepStrictEqual([second.pickedSkills, second.skills], [first.pickedSkills, first.skills], 'the re-run changes nothing');
});

test('seed update --installed-only: a seat deny and a skillOverrides key under an old 2.1.0 skill name follow it to the new name', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        write(repo, '.claude/alfred-code.stamp', 'version: 2.0.0\nsha: 0000000\nhooks-route: copy\n');
        write(repo, '.claude/skills/create-ticket/SKILL.md', skill('create-ticket'));
        write(repo, '.claude/settings.json', JSON.stringify({ skillOverrides: { 'explain-code-tutor': 'off' }, env: { MY_OWN_KEY: 'mine' } }, null, 2));
    };
    const { result: r } = seedRun('update', '', { env: COPY_ROUTE, args: ['--installed-only'], prepare, inspect });
    assert.strictEqual((r.settings.skillOverrides || {})['alfred-habits-explain-code'], 'off', JSON.stringify(r.settings.skillOverrides));
    assert.ok(!('explain-code-tutor' in (r.settings.skillOverrides || {})), JSON.stringify(r.settings.skillOverrides));
    assert.strictEqual(r.settings.env.MY_OWN_KEY, 'mine');
});

test('seed update: a retired skill name whose copy is git-tracked is kept and named, an untracked one is pruned', POSIX_ONLY, () =>
{
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        write(repo, '.claude/skills/plugin-authoring/SKILL.md', skill('plugin-authoring'));
        // the ledger names the copy too: a second route prunes what the last run wrote and this release no longer ships
        write(repo, '.claude/alfred-code.stamp', `version: 2.0.0\nsha: 0000000\nhooks-route: copy\nmanaged-files: skills/plugin-authoring=${hashItem(path.join(repo, '.claude/skills/plugin-authoring'))}\n`);
        write(repo, '.claude/skills/create-ticket/SKILL.md', skill('create-ticket'));
        execFileSync('git', ['add', '-f', '.claude/skills/plugin-authoring/SKILL.md'], { cwd: repo });
    };
    const { steps, outs } = seedRun(['update', 'update'], '', { env: COPY_ROUTE, args: ['--installed-only'], prepare, each: inspect });
    assert.ok(steps[0].skills.includes('plugin-authoring'), `the tracked copy is kept: ${steps[0].skills.join(' ')}`);
    assert.ok(!steps[0].skills.includes('create-ticket'), 'the untracked retired copy is pruned');
    assert.match(outs[0], /skill kept \(retired upstream, tracked in git\): plugin-authoring/, outs[0]);
    assert.ok(steps[1].skills.includes('plugin-authoring'), 'a re-run keeps it too');
    assert.doesNotMatch(outs[0], /plugin-authoring removed/, 'the ledger route keeps it as well');
    assert.match(outs[0], /skills\/plugin-authoring: kept - .*git tracks it here/, 'and names it');
});

// Shape 4 (2.1.0 Task 3): a legacy copy-route install that never wrote a stamp - old-name copies, the stack's
// hooks copied and wired, an old seat, a rule, the 1.x env key - and beside them a project's own skill. The
// state is `legacy-unstamped`, update's to take: its picks come off disk under their new names, the old
// copies go, the stamp is written, and the project's own skill is neither touched nor recorded.
function unstampedLegacy(repo)
{
    for (const n of ['project-solve-task', 'project-commit-checkpoint', 'project-related-context', 'markdown-style']) write(repo, `.claude/skills/${n}/SKILL.md`, skill(n));
    // M3: a generic catalog name carrying the stack's own heading (its shipped name and description) is the
    // stack's copy; `markdown-style` above, in words of its own, is the project's (a legacy tree cannot tell).
    write(repo, '.claude/skills/typescript/SKILL.md', fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'typescript', 'SKILL.md'), 'utf8').replace(/\n---\n[\s\S]*$/, '\n---\nan older body\n'));
    write(repo, '.claude/skills/my-own-helper/SKILL.md', skill('my-own-helper'));
    for (const n of ['guard-catastrophic-rm', 'guard-read-whole-file', 'hook-prelude']) write(repo, `.claude/hooks/${n}.js`, '// old\n');
    write(repo, '.claude/agents/ci-failure-diagnoser.md', '---\nname: ci-failure-diagnoser\n---\n');
    write(repo, '.claude/rules/alfred-interaction.md');
    write(repo, '.claude/settings.json', JSON.stringify({
        env: { CLAUDE_STACK_DOCS_PATH: '.claude/docs', MY_OWN_KEY: 'mine' }, // legacy-name
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-catastrophic-rm.js"' }] },
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'node my-own-check.js' }] }] },
    }, null, 2));
}
test('seed update --installed-only over an UNSTAMPED legacy install: picks under their new names, old copies gone, the project\'s own skill untouched, and a re-run is quiet', POSIX_ONLY, () =>
{
    const stampLayer = require('./install/stamp.js');
    const before = { state: null };
    // The first run installs the core and the locked three, so the re-run's listing names them - with no
    // listing at all the read is blind, and a blind read carries the stamp's picks verbatim at the end.
    const listed = JSON.stringify(['alfred-code', 'navigation', 'documentation', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.1.0', scope: 'project', enabled: true })));
    const { steps, outs } = seedRun(['update', 'update'], '', {
        args: ['--installed-only'],
        prepare: (repo) => { unstampedLegacy(repo); before.state = stampLayer.installState(repo, { CLAUDE_CONFIG_DIR: path.join(repo, 'no-account') }); },
        each: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), listed);
            return { ...inspect(repo), mine: fs.readFileSync(path.join(repo, '.claude', 'skills', 'my-own-helper', 'SKILL.md'), 'utf8'),
                markdownStyle: fs.readFileSync(path.join(repo, '.claude', 'skills', 'markdown-style', 'SKILL.md'), 'utf8'),
                state: stampLayer.installState(repo, { CLAUDE_CONFIG_DIR: path.join(repo, 'no-account') }) };
        },
    });
    assert.strictEqual(before.state, 'legacy-unstamped');
    const [first, second] = steps;
    assert.strictEqual(first.state, 'installed', 'the update wrote the stamp');
    const names = (list) => list.map((e) => e.split('@')[0]);
    for (const n of ['alfred-task-solve', 'alfred-habits-commit-checkpoint', 'alfred-capture-related-projects', 'typescript'])
        assert.ok(names(first.pickedSkills).includes(n), `${n} is a pick: ${first.pickedSkills.join(',')}`);
    // M3: the generic name in words of its own is never taken over: not a pick, not rewritten, not recorded.
    assert.ok(![...first.pickedSkills, ...first.librarySkills].some((e) => /^markdown-style\b/.test(e)), `markdown-style is recorded: ${first.pickedSkills.join(',')}`);
    assert.strictEqual(first.markdownStyle, skill('markdown-style'), 'the project\'s own markdown-style is not rewritten');
    assert.match(outs[0], /skill kept[^\n]*markdown-style/, outs[0]);
    assert.ok(names(first.pickedAgents).includes('alfred-issue-diagnoser-ci'), first.pickedAgents.join(','));
    const old = new Set([...Object.keys(RENAMED.skills), ...Object.keys(RENAMED.agents)]);
    assert.deepStrictEqual([...first.skills, ...first.agents.map((f) => f.replace(/\.md$/, ''))].filter((n) => old.has(n)), [], 'every old copy is pruned');
    assert.ok(first.skills.includes('my-own-helper'), `the project's own skill stays: ${first.skills.join(' ')}`);
    assert.strictEqual(first.mine, skill('my-own-helper'), 'and is not rewritten');
    assert.ok(![...first.pickedSkills, ...first.librarySkills].some((e) => /my-own-helper/.test(e)), 'nor recorded as a stack pick');
    // The 1.x key held the old default, the stack's own seed, over no docs at all - so it takes the new default.
    assert.strictEqual(first.settings.env.ALFRED_CODE_DOCS_PATH, '.alfred/docs', 'an empty old root is re-pointed');
    assert.match(outs[0], /docs root: \.claude\/docs holds nothing - re-pointed to \.alfred\/docs/);
    assert.ok(!Object.keys(first.settings.env).some((k) => k.startsWith('CLAUDE_STACK_')), JSON.stringify(first.settings.env)); // legacy-name
    assert.strictEqual(first.settings.env.MY_OWN_KEY, 'mine');
    const wired = JSON.stringify(first.settings.hooks || {});
    assert.ok(!wired.includes('.claude/hooks/guard-'), `the old copy's wiring goes with its file: ${wired}`);
    assert.ok(wired.includes('node my-own-check.js'), `the project's own hook stays wired: ${wired}`);
    assert.strictEqual(renamedLines(outs[0]).length, 4, renamedLines(outs[0]).join('\n'));
    assert.deepStrictEqual(renamedLines(outs[1]), [], 'the re-run has nothing left to rename');
    assert.deepStrictEqual([second.pickedSkills, second.pickedAgents, second.skills, second.agents, second.settings], [first.pickedSkills, first.pickedAgents, first.skills, first.agents, first.settings], 'the re-run changes nothing');
});

// A project's own skill alone is no install to update: --installed-only refuses it as it refuses an empty tree.
test('seed update --installed-only: a project holding only its own skills is not installed', POSIX_ONLY, () =>
{
    const { code, err, result } = seedRun('update', '', {
        args: ['--installed-only'], failOk: true,
        prepare: (repo) => { for (const n of ['my-own-helper', 'another-one']) write(repo, `.claude/skills/${n}/SKILL.md`, skill(n)); },
        inspect: (repo) => ({ stamp: fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')), skills: fs.readdirSync(path.join(repo, '.claude', 'skills')).sort() }),
    });
    assert.strictEqual(code, 1, err);
    assert.match(err, /--installed-only found nothing installed/);
    assert.deepStrictEqual(result, { stamp: false, skills: ['another-one', 'my-own-helper'] });
});

// A selection line - a walk's file or an --add / --drop - naming an old item names the new one.
test('seed install --selection and update --add: a line naming an old item installs the new one', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun('install', 'skill markdown-style\nskill project-related-context\nagent ci-failure-diagnoser\nrule markdown-docs\n', { inspect });
    assert.ok(r.pickedSkills.includes('alfred-capture-related-projects') && r.skills.includes('alfred-capture-related-projects'), `${r.pickedSkills} | ${r.skills}`);
    assert.ok(r.pickedAgents.includes('alfred-issue-diagnoser-ci@alfred-code'), r.pickedAgents.join(','));
    assert.ok(renamedLines(out).includes('==> renamed: skill project-related-context -> alfred-capture-related-projects'), out);

    const listing = JSON.stringify([{ id: 'alfred-code@envoydev', version: '2.0.0', scope: 'project', enabled: true }]);
    const prepare = (repo) =>
    {
        write(repo, '.claude/rules/alfred-interaction.md');
        write(repo, '.claude/alfred-code.stamp', 'version: 2.0.0\nsha: 0000000\npicked-skills: markdown-style@alfred-code\npicked-agents: security-auditor@alfred-code\n');
    };
    const add = seedRun('update', 'skill markdown-style\n', { plugins: listing, args: ['--installed-only', '--add', 'skill project-stack-usage-analyzer'], prepare, inspect });
    assert.ok(add.result.skills.includes('alfred-capture-stack-usage'), add.result.skills.join(' '));
    assert.ok(!add.out.includes('names nothing this release ships'), 'an old name is carried, never reported as unknown');

    // M3: a --drop naming the old item drops the new one - its copy, its pick, a seat's switch-off.
    const drop = seedRun(['install', 'update'], 'skill markdown-style\nskill alfred-capture-related-projects\nagent alfred-issue-diagnoser-ci\nrule markdown-docs\n', {
        plugins: listing, args: [[], ['--installed-only', '--drop', 'skill project-related-context', '--drop', 'agent ci-failure-diagnoser']], each: inspect,
    });
    const [before, after] = drop.steps;
    assert.ok(before.skills.includes('alfred-capture-related-projects') && before.pickedAgents.includes('alfred-issue-diagnoser-ci@alfred-code'), 'the install carries both');
    assert.ok(!after.skills.includes('alfred-capture-related-projects') && !after.pickedSkills.includes('alfred-capture-related-projects'), `the dropped copy and pick are gone: ${after.skills} | ${after.pickedSkills}`);
    assert.ok(!after.pickedAgents.some((e) => /diagnoser/.test(e)), after.pickedAgents.join(','));
    assert.ok(after.settings.permissions.deny.includes('Agent(alfred-code:alfred-issue-diagnoser-ci)'), `the dropped core seat is denied under its new name\n${drop.outs[1]}`);
});

// ---------- the old names stay in their homes ----------

// No surface may name an old identifier: a cite resolves to nothing, a preload loads nothing, and a
// dispatch of an old seat finds no agent. The old names are allowed only where they are the record
// of the rename - the manifest's retired lists and renamed map, this migration test, the history
// docs, and update.md's upgrade table, each row of which must be the map's own pair. The names come
// from the map, so this scan cannot drift from it; the manifest itself is the positive control.
test('no surface names an old skill or seat outside the rename\'s own homes', () =>
{
    const pairs = { ...RENAMED.skills, ...RENAMED.agents };
    const old = new RegExp(`(?<![A-Za-z0-9_-])(${Object.keys(pairs).join('|')})(?![A-Za-z0-9_-])`, 'g');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    assert.ok(old.test(JSON.stringify(manifest.renamed)) && old.test(JSON.stringify(manifest.retired)), 'positive control: the scan sees the map and the retired lists');
    old.lastIndex = 0;
    const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', '.serena', '.superpowers', '.memory-mcp', '.playwright', '.idea']);
    const hits = [];
    const tableRows = [];
    const scanFile = (full) =>
    {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        if (/^docs\/[^/]*-evidence\.md$/.test(rel) || rel === 'scripts/install-renames.test.js') return;
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) return;
        let text = buf.toString('utf8');
        if (rel === 'meta/stack-manifest.json') { const m = JSON.parse(text); delete m.retired; delete m.renamed; text = JSON.stringify(m, null, 2); }
        text.split('\n').forEach((line, i) =>
        {
            const found = line.match(old);
            if (!found) return;
            const row = /^\| (?:seat )?`\/?([a-z0-9-]+)` \| (?:seat )?`\/?([a-z0-9-]+)` \|$/.exec(line);
            if (rel === 'setup-plugin/commands/update.md' && row && pairs[row[1]] === row[2]) { tableRows.push(row[1]); return; }
            hits.push(`${rel}:${i + 1}: ${found.join(', ')}`);
        });
    };
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
            else scanFile(path.join(dir, e.name));
        }
    };
    // M4: in a git work tree of its own, the TRACKED files - an untracked or ignored file is no
    // surface the repo ships. An export (no work tree, or one whose top is elsewhere) walks the disk.
    let tracked = null;
    try
    {
        const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
        if (fs.realpathSync(git('rev-parse', '--show-toplevel').trim()) === fs.realpathSync(ROOT)) tracked = git('ls-files', '-z').split('\0').filter(Boolean);
    }
    catch { tracked = null; }
    if (tracked) for (const rel of tracked) { const full = path.join(ROOT, rel); if (fs.existsSync(full) && fs.statSync(full).isFile()) scanFile(full); }
    else walk(ROOT);
    assert.deepStrictEqual(hits, [], 'an old name is back outside its homes');
    assert.deepStrictEqual(tableRows.sort(), Object.keys(pairs).sort(), 'update.md\'s upgrade table names every rename, each as the map\'s own pair');
});

// C3 (R133 b): at local scope settings.json is never written, so an old-keyed skillOverrides there was
// neither re-keyed nor reported - the switch-off silently stopped applying. The deny half's shape: the
// new key goes into settings.local.json with the same value, and one line names the shared entry.
test('settings writer: at local scope an old skillOverrides key in settings.json is set under the new name in settings.local.json, with a line (C3)', () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renames-c3-'));
    try
    {
        const sharedFile = path.join(dir, 'settings.json');
        const localFile = path.join(dir, 'settings.local.json');
        const shared = { skillOverrides: { 'project-quality-loop': 'off', 'project-first-look': 'off', 'my-own-skill': 'off' } };
        fs.writeFileSync(sharedFile, JSON.stringify(shared));
        fs.writeFileSync(localFile, JSON.stringify({ skillOverrides: { 'alfred-capture-first-look': 'on' } }));
        const logs = [];
        const opts = { file: localFile, renamed: RENAMED, inheritedOverrides: shared.skillOverrides, note: (m) => assert.fail(m) };
        writeSettings({ ...opts, log: (m) => logs.push(m) });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).skillOverrides, { 'alfred-capture-first-look': 'on', 'alfred-loop-quality': 'off' }, 'the user\'s switch-off stopped applying');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(sharedFile, 'utf8')), shared, 'settings.json is never written at local scope');
        const text = logs.join('\n');
        assert.match(text, /settings\.local\.json: settings\.json still names skillOverrides project-quality-loop - set as alfred-loop-quality in settings\.local\.json; a local-scope run never writes settings\.json, a project-scope update re-keys it/);
        assert.doesNotMatch(text, /project-first-look/, 'a new name the local file already sets wins, silently');
        const before = fs.readFileSync(localFile, 'utf8');
        const again = [];
        writeSettings({ ...opts, log: (m) => again.push(m) });
        assert.strictEqual(fs.readFileSync(localFile, 'utf8'), before, 'a re-run writes nothing');
        assert.doesNotMatch(again.join('\n'), /still names skillOverrides/, 'a re-run says nothing');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('seed: a local-scope update carries settings.json\'s old skillOverrides key into settings.local.json under the new name (C3)', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', 'skill markdown-style\n', {
        args: ['--scope', 'local'],
        prepare: (repo) =>
        {
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { 'project-quality-loop': 'off' } }));
        },
        inspect: (repo) => ({
            shared: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
            local: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.local.json'), 'utf8')),
        }),
    });
    assert.deepStrictEqual(result.local.skillOverrides, { 'alfred-loop-quality': 'off' });
    assert.deepStrictEqual(result.shared, { skillOverrides: { 'project-quality-loop': 'off' } }, 'a local-scope run never writes settings.json');
    assert.match(out, /settings\.local\.json: settings\.json still names skillOverrides project-quality-loop - set as alfred-loop-quality in settings\.local\.json/, out);
});
