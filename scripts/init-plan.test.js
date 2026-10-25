'use strict';
// init-plan.js - what /alfred-code:init does in THIS project, stated by a script so the command
// never infers it: the machine-level installs the kept plugins need (probed, each with its exact
// command), then the captures whose skill AND seat the install lists, in the fixed order. The stack ships no MCP server
// since 2.10.1, so no uv, Python, browser, index or model is on the list.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { plan, render } = require('./init-plan.js');

const SCRIPT = path.join(__dirname, 'init-plan.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'init-plan-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function project({ settings } = {})
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    if (settings) fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify(settings));
    return root;
}
const INV = (over = {}) => ({
    skills: ['capture-architecture', 'capture-project-code-style', 'capture-awareness'],
    agents: ['related-project-analyzer', 'architecture-analyzer', 'code-style-analyzer'],
    plugins: [{ name: 'alfred-code', scope: 'project' }, { name: 'csharp-lsp', scope: 'project' }],
    left_out: [],
    ...over,
});
const ACCT = path.join(TMP, 'acct');   // never the real account's settings
const E = (extra = {}) => ({ CLAUDE_CONFIG_DIR: ACCT, HOME: path.join(TMP, 'home'), ...extra });
const NONE = { has: () => false, file: () => false };
const lineOf = (lines, re) => lines.find((l) => re.test(l)) || '';

test('machine: nothing installed - the kept language servers, then the hud; no server item on any OS', () =>
{
    const root = project();
    for (const platform of ['darwin', 'linux', 'win32'])
    {
        const lines = render(plan({ inv: INV(), root, platform, env: E(), probe: NONE }));
        assert.match(lineOf(lines, /^machine: csharp-ls /), /^machine: csharp-ls - blocked: needs the \.NET 10 SDK \(dotnet\) first/);
        const order = lines.filter((l) => l.startsWith('machine:')).map((l) => l.split(' - ')[0]);
        assert.deepStrictEqual(order, ['machine: csharp-ls', 'machine: claude-hud status line + compact layout'], platform);
        assert.ok(!lines.some((l) => /^machine: (uv|python|playwright|serena|memory)/.test(l)), `${platform}: ${lines.join('\n')}`);
    }
});

// Task 24: claude-hud arrives configured - one item INSIDE the machine ask, never an ask of its own.
test('machine: the claude-hud item - skip without it, missing with its one command, present once applied, never over a foreign line', () =>
{
    const root = project();
    const HUD = /^machine: claude-hud status line \+ compact layout /;
    const acct = path.join(TMP, `hud-acct-${seq++}`);
    const env = E({ CLAUDE_CONFIG_DIR: acct });
    // The platform the CLI child below runs on, so the parent reads the line that child writes.
    const hudLine = () => lineOf(render(plan({ inv: INV(), root, env, probe: NONE })), HUD);

    fs.mkdirSync(acct, { recursive: true });
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - skip: claude-hud is not installed for this project or this account');

    const cached = path.join(acct, 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.8.0');
    fs.mkdirSync(path.join(cached, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(cached, 'dist', 'index.js'), '');
    fs.writeFileSync(path.join(acct, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'user', installPath: cached, version: '0.8.0' }] } }));
    const missing = render(plan({ inv: INV(), root, env, probe: NONE }));
    const command = `node "${path.join(__dirname, 'hud-statusline.js')}" --config-dir "${acct}" --project "${root}"`;
    // The keys the row adds ride the command as a shell comment: named in the ask, inert when run.
    assert.strictEqual(lineOf(missing, HUD),
        `machine: claude-hud status line + compact layout - missing: ${command} # adds 13 claude-hud keys: lineLayout, showSeparators, display (8), gitStatus (2), statusLine.refreshInterval`);
    assert.match(missing[missing.length - 1], /^init-plan: 1 to install, 1 blocked, /, 'counted with the other missing items - one ask');

    // Applied: nothing left to do.
    const r = spawnSync(process.execPath, [path.join(__dirname, 'hud-statusline.js'), '--config-dir', acct], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(TMP, 'home') } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - present');

    // A claude-hud line of an older shape: refresh, so the ask shows an existing line will change.
    const settings0 = path.join(acct, 'settings.json');
    const doc = JSON.parse(fs.readFileSync(settings0, 'utf8'));
    doc.statusLine = { type: 'command', command: 'node ~/.claude/plugins/cache/claude-hud/claude-hud/0.5.0/dist/index.js', refreshInterval: 5 };
    fs.writeFileSync(settings0, JSON.stringify(doc));
    const refresh = render(plan({ inv: INV(), root, env, probe: NONE }));
    assert.strictEqual(lineOf(refresh, HUD), `machine: claude-hud status line + compact layout - refresh: ${command}`);
    assert.match(refresh[refresh.length - 1], /^init-plan: 1 to install, 1 blocked, /, 'a refresh is one of the ask\'s options');

    // A status line the user owns, with the hud keys already in: not an option, one line naming the way over.
    const settings = path.join(acct, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'echo mine' } }));
    assert.strictEqual(hudLine(),
        'machine: claude-hud status line + compact layout - skip: the account statusLine is not claude-hud\'s (source: custom) - kept; /claude-hud:setup replaces it');

    // Malformed account settings: blocked with its fix, nothing to pick.
    fs.writeFileSync(settings, '{ nope');
    assert.match(hudLine(), /^machine: claude-hud status line \+ compact layout - blocked: .*settings\.json is not valid JSON - fix it, then run \/alfred-code:init again$/);

    // Switched off by the user: their off wins, one line.
    fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'claude-hud@claude-hud': false } }));
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - skip: claude-hud is switched off in this account');
});

// 2.2.0: claude-hud installed for this project alone (a project- or local-scope row naming it, no user-scope row) takes
// its status line in the project's settings.local.json - the command names this machine's node - never the account's,
// which every other project reads. A row of ANOTHER project serves nothing here.
test('machine: a project-scope claude-hud gets its status line in this project\'s settings.local.json, never the account\'s', () =>
{
    const root = project();
    const acct = path.join(TMP, `hud-proj-${seq++}`);
    const env = E({ CLAUDE_CONFIG_DIR: acct });
    const HUD = /^machine: claude-hud status line \+ compact layout /;
    const hudLine = () => lineOf(render(plan({ inv: INV(), root, env, probe: NONE })), HUD);
    const cached = path.join(acct, 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.8.0');
    fs.mkdirSync(path.join(cached, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(cached, 'dist', 'index.js'), '');
    const rows = (projectPath) => fs.writeFileSync(path.join(acct, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'project', projectPath, installPath: cached, version: '0.8.0' }] } }));
    rows(path.join(TMP, 'another-project'));
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - skip: claude-hud is not installed for this project or this account', 'another project\'s row serves nothing here');
    rows(root);
    assert.match(hudLine(), / - missing: node .* --project /);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'hud-statusline.js'), '--config-dir', acct, '--project', root], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(TMP, 'home') } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /statusLine written - .*in the project \(\.claude\/settings\.local\.json\)/);
    const local = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.local.json'), 'utf8'));
    assert.match(local.statusLine.command, /claude-hud/);
    assert.strictEqual(local.statusLine.refreshInterval, 5, 'the row\'s refresh interval lands beside the line it belongs to');
    const account = (() => { try { return JSON.parse(fs.readFileSync(path.join(acct, 'settings.json'), 'utf8')); } catch { return {}; } })();
    assert.strictEqual(account.statusLine, undefined, 'the account status line is every project\'s - never written for one project\'s claude-hud');
    assert.ok(fs.existsSync(path.join(acct, 'plugins', 'claude-hud', 'config.json')), 'claude-hud\'s own config stays account-wide');
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - present');
    // Switched off for this project: their off wins.
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'claude-hud@claude-hud': false } }));
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - skip: claude-hud is switched off for this project');
});

test('machine: the claude-hud item reads the account a second CLAUDE_CONFIG_DIR names, never ~/.claude', () =>
{
    const root = project();
    const home = path.join(TMP, `space-home-${seq++}`);
    fs.mkdirSync(path.join(home, '.claude-work'), { recursive: true });
    const env = { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude-work') };
    const lines = render(plan({ inv: INV(), root, platform: 'linux', env, probe: NONE }));
    assert.strictEqual(lineOf(lines, /claude-hud/), 'machine: claude-hud status line + compact layout - skip: claude-hud is not installed for this project or this account');
    const cached = path.join(home, '.claude-work', 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.8.0', 'dist');
    fs.mkdirSync(cached, { recursive: true });
    fs.writeFileSync(path.join(cached, 'index.js'), '');
    fs.writeFileSync(path.join(home, '.claude-work', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'user' }] } }));
    const again = render(plan({ inv: INV(), root, platform: 'linux', env, probe: NONE }));
    assert.match(lineOf(again, /claude-hud/), new RegExp(`--config-dir "${path.join(home, '.claude-work').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" --project "[^"]+" # adds 13 claude-hud keys: `));
});

test('machine: everything present is reported present, and csharp-ls is asked only when csharp-lsp is kept', () =>
{
    const root = project();
    const probe = { has: () => true };
    const lines = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe }));
    assert.ok(lines.includes('machine: csharp-ls - present'), lines.join('\n'));
    assert.match(lines[lines.length - 1], /^init-plan: 0 to install, 0 blocked, /);
    const noLsp = render(plan({ inv: INV({ plugins: [{ name: 'alfred-code', scope: 'project' }] }), root, platform: 'linux', env: E(), probe }));
    assert.ok(!noLsp.some((l) => /csharp-ls/.test(l)));
    const dotnetOnly = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe: { ...probe, has: (b) => b !== 'csharp-ls' }, }));
    assert.strictEqual(lineOf(dotnetOnly, /^machine: csharp-ls /), 'machine: csharp-ls - missing: dotnet tool install --global csharp-ls');
});

// Audit 2026-10-20b (plugins): typescript-lsp is an empty package naming `typescript-language-server`, which nothing
// installed. The line pins TypeScript 6 - 7 ships no tsserver.js, the file the server reads from the TypeScript beside it.
test('machine: typescript-language-server is asked only when typescript-lsp is kept, with the TypeScript 6 its server reads', () =>
{
    const root = project();
    const ts = INV({ plugins: [{ name: 'alfred-code', scope: 'project' }, { name: 'typescript-lsp', scope: 'project' }] });
    const missing = render(plan({ inv: ts, root, platform: 'linux', env: E(), probe: NONE }));
    assert.strictEqual(lineOf(missing, /^machine: typescript-language-server /),
        'machine: typescript-language-server - missing: npm install -g typescript-language-server typescript@6');
    assert.ok(!missing.some((l) => /csharp-ls/.test(l)), 'csharp-ls stays csharp-lsp\'s');
    const present = render(plan({ inv: ts, root, platform: 'linux', env: E(), probe: { ...NONE, has: (b) => b === 'typescript-language-server' } }));
    assert.ok(present.includes('machine: typescript-language-server - present'), present.join('\n'));
    const none = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe: NONE }));
    assert.ok(!none.some((l) => /typescript-language-server/.test(l)), 'not asked when typescript-lsp is not kept');
    // Install order: the two language servers together, before the hud.
    const both = render(plan({ inv: INV({ plugins: [...INV().plugins, { name: 'typescript-lsp', scope: 'project' }] }), root, platform: 'linux', env: E(), probe: NONE }));
    const order = both.filter((l) => l.startsWith('machine:')).map((l) => l.split(' - ')[0]);
    assert.deepStrictEqual(order, ['machine: csharp-ls', 'machine: typescript-language-server', 'machine: claude-hud status line + compact layout']);
});

test('a plan path is project-relative inside, absolute outside, and forward-slashed on one drive or two', () =>
{
    const { shownPath } = require('./init-plan.js');
    const w = path.win32;
    assert.strictEqual(shownPath('C:\\t\\proj', 'C:\\t\\proj\\notes\\ai\\A.md', w), 'notes/ai/A.md');
    // one drive - a real Windows machine: this printed C:\a\repo\... before
    assert.strictEqual(shownPath('C:\\t\\proj', 'C:\\a\\repo\\stack\\x\\SKILL.md', w), 'C:/a/repo/stack/x/SKILL.md');
    // two drives - the CI runner: relative() answers an absolute path
    assert.strictEqual(shownPath('C:\\t\\proj', 'D:\\a\\repo\\stack\\x\\SKILL.md', w), 'D:/a/repo/stack/x/SKILL.md');
    assert.strictEqual(shownPath('/t/proj', '/a/repo/stack/x/SKILL.md', path.posix), '/a/repo/stack/x/SKILL.md');
    assert.strictEqual(shownPath('/t/proj', '/t/proj/.claude/skills/x/SKILL.md', path.posix), '.claude/skills/x/SKILL.md');
});

test('captures: the fixed order; run, done and skip each say why; the library copy wins over the plugin\'s', () =>
{
    const root = project({ settings: { env: { ALFRED_CODE_DOCS_PATH: 'notes/ai' } } });
    fs.mkdirSync(path.join(root, 'notes', 'ai', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'ai', 'architecture', 'ARCHITECTURE.md'), '# map\n');
    const inv = INV({ left_out: ['agent code-style-analyzer'] });
    const captures = () => render(plan({ inv, root, platform: 'linux', env: E(), probe: NONE, pluginRoot: path.join(__dirname, '..') }))
        .filter((l) => l.startsWith('capture:'));
    const lines = captures();
    assert.deepStrictEqual(lines.map((l) => l.split(' - ')[0]), ['capture: capture-architecture', 'capture: capture-project-code-style', 'capture: capture-awareness']);
    assert.strictEqual(lines[0], 'capture: capture-architecture - done: notes/ai/architecture/ARCHITECTURE.md exists');
    assert.strictEqual(lines[1], 'capture: capture-project-code-style - skip: its seat code-style-analyzer is switched off');
    // A path outside the project is printed with forward slashes on every OS: init reads it through Bash, where a
    // backslash is an escape (windows-2025 CI printed `D:/a/...` against a native-separator expectation).
    const libPath = (skill) => path.join(__dirname, '..', 'stack', 'skills', skill, 'SKILL.md').split(path.sep).join('/');
    // The awareness capture has no seat: it reads the repo and asks in the main session.
    assert.strictEqual(lines[2], `capture: capture-awareness - run: read ${libPath('capture-awareness')}`);
    // A library copy wins over the plugin's; an awareness doc on disk is no 'done' - each part decides from disk.
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'capture-awareness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'capture-awareness', 'SKILL.md'), '---\nname: x\n---\n');
    fs.mkdirSync(path.join(root, 'notes', 'ai', 'awareness'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'ai', 'awareness', 'PROJECT-AWARENESS.md'), '# run book\n');
    assert.strictEqual(captures()[2], 'capture: capture-awareness - run: read .claude/skills/capture-awareness/SKILL.md');

    const bare = render(plan({ inv: INV({ skills: ['capture-awareness'], agents: [] }), root, platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(bare[0], 'capture: capture-architecture - skip: the skill is not installed');
    assert.strictEqual(bare[1], 'capture: capture-project-code-style - skip: the skill is not installed');
    assert.strictEqual(bare[2], 'capture: capture-awareness - run: read .claude/skills/capture-awareness/SKILL.md', 'no seat to need');
    const noSeat = render(plan({ inv: INV({ agents: [] }), root: project(), platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(noSeat[1], 'capture: capture-project-code-style - skip: its seat code-style-analyzer is not installed');
});

// End to end through the CLI, on a stubbed PATH: the real probes, the real pins file.
test('CLI: probes the machine on PATH, reads the plan-out file, refuses a missing or malformed one', { skip: process.platform === 'win32' && 'shell stubs' }, () =>
{
    const root = project();
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    stub('uv', 'echo "uv 0.9.0"');
    stub('dotnet', 'exit 0');
    const inv = path.join(root, 'installed.json');
    fs.writeFileSync(inv, JSON.stringify(INV()));
    const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root };
    const r = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.ok(!lines.some((l) => /^machine: (uv|python)/.test(l)), `a uv on PATH is no item: ${r.stdout}`);
    assert.ok(lines.includes('machine: csharp-ls - missing: dotnet tool install --global csharp-ls'), r.stdout);
    assert.match(lines[lines.length - 1], /^init-plan: 1 to install, 0 blocked, 3 captures to run$/);

    const missing = spawnSync(process.execPath, [SCRIPT, '--installed', path.join(root, 'nope.json'), '--root', root], { env, encoding: 'utf8' });
    assert.strictEqual(missing.status, 2);
    assert.match(missing.stderr, /init-plan: cannot read .*nope\.json/);
    fs.writeFileSync(inv, '{ nope');
    const bad = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env, encoding: 'utf8' });
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /init-plan: cannot read /);
});

// R89 (R83 b): the capture outputs are looked for under the docs root the install's scope resolves - at
// local scope settings.local.json over settings.json - or a capture already written under a
// personal docs path reads as never run, and init runs it again.
test('captures: at local scope the docs root is the personal file\'s, at project scope the shared one (R89)', () =>
{
    const root = project({ settings: { env: { ALFRED_CODE_DOCS_PATH: 'docs/shared' } } });
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/mine' } }));
    fs.mkdirSync(path.join(root, 'docs', 'mine', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'mine', 'architecture', 'ARCHITECTURE.md'), '# map\n');
    const line = () => render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe: NONE }))
        .find((l) => l.startsWith('capture: capture-architecture'));
    const stamp = (scope) => fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `source: x\nscope: ${scope}\n`);
    stamp('local');
    assert.strictEqual(line(), 'capture: capture-architecture - done: docs/mine/architecture/ARCHITECTURE.md exists');
    stamp('project');
    assert.match(line(), /^capture: capture-architecture - run: /, 'project scope never reads the personal file');
});

// The home that prints the post-install capture order to a reader must follow the order this script runs
// (the shared-rules pin covers only the 'agent-capabilities LAST' clause, which is how the template drifted).
test('capture order: setup-plugin/references/post-install.md names the captures in CAPTURES order', () =>
{
    const { CAPTURES } = require('./init-plan.js');
    const names = CAPTURES.map((c) => c.skill);
    const text = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'references', 'post-install.md'), 'utf8');
    const firstSeen = [];
    for (const m of text.matchAll(/\/(capture-[a-z-]+)/g)) if (names.includes(m[1]) && !firstSeen.includes(m[1])) firstSeen.push(m[1]);
    assert.deepStrictEqual(firstSeen, names);
});

// The user's ruling of 2026-10-21: the template's `## Rules` section went - its GENERATED rows were the second home of
// the capture order, and the order lives in post-install.md alone, so the template cannot drift from it again.
test('capture order: the template prints no post-install order', () =>
{
    const flat = fs.readFileSync(path.join(__dirname, '..', 'stack', 'AGENTS.template.md'), 'utf8').replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /post-install order/);
});

// --- unattended (ALFRED_CODE_UNATTENDED=1) ---------------------------------------------------------
// Nobody answers: init takes each ask's recommended option unless it is destructive or needs a person,
// and says so in one `unattended:` line per ask. The asks init itself owns are decided HERE, so the
// command never judges them; init.md defines the rule for the asks a capture reaches.
const { unattended, isUnattended, DESTRUCTIVE_MACHINE } = require('./init-plan.js');

test('unattended: the switch is ALFRED_CODE_UNATTENDED=1 and nothing else', () =>
{
    assert.strictEqual(isUnattended({ ALFRED_CODE_UNATTENDED: '1' }), true);
    for (const v of [undefined, '', '0', 'true', 'yes']) assert.strictEqual(isUnattended({ ALFRED_CODE_UNATTENDED: v }), false, String(v));
});

test('unattended: each of init\'s own asks gets one line - additive installs taken, a refresh skipped as destructive', () =>
{
    const p = { machine: [
        { what: 'csharp-ls', state: 'missing', detail: 'dotnet tool install --global csharp-ls' },
        { what: 'typescript-language-server', state: 'missing', detail: 'npm install -g typescript-language-server typescript@6' },
        { what: 'csharp-ls', state: 'blocked', detail: 'needs .NET' },
        { what: 'claude-hud status line + compact layout', state: 'refresh', detail: 'node hud ...' },
    ], captures: [{ skill: 'capture-architecture', state: 'run', detail: 'read y' }, { skill: 'capture-awareness', state: 'run', detail: 'read x' }] };
    assert.deepStrictEqual(DESTRUCTIVE_MACHINE, ['refresh']);
    assert.deepStrictEqual(unattended(p), [
        'unattended: machine installs -> install csharp-ls, typescript-language-server',
        'unattended: machine installs -> skip claude-hud status line + compact layout (a refresh replaces the account\'s existing status line - destructive)',
        'unattended: Memory for this project? -> Native, Claude\'s default place (Recommended)',
        'unattended: Navigation in files? -> Agent decides, the stack\'s order (Recommended)',
        'unattended: AGENTS.md -> fill it in (Recommended)',
    ], 'the sibling ask is the awareness capture\'s own, answered inline by init.md\'s rule (its Recommended option is None)');
});

test('unattended: nothing to install - no line for an ask that never fires', () =>
{
    const lines = unattended({ machine: [{ what: 'csharp-ls', state: 'present', detail: '' }], captures: [{ skill: 'capture-architecture', state: 'done', detail: 'x exists' }] });
    assert.deepStrictEqual(lines, ['unattended: Memory for this project? -> Native, Claude\'s default place (Recommended)', 'unattended: Navigation in files? -> Agent decides, the stack\'s order (Recommended)', 'unattended: AGENTS.md -> fill it in (Recommended)'], 'the step-4 asks always fire');
});

test('unattended: the CLI prints the mode on --mode, and the decisions after the plan only when the switch is on', { skip: process.platform === 'win32' && 'shell stubs' }, () =>
{
    const root = project();
    const inv = path.join(root, 'installed.json');
    fs.writeFileSync(inv, JSON.stringify(INV({ plugins: [] })));
    const env = (on) => ({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, CLAUDE_CONFIG_DIR: ACCT, ...(on ? { ALFRED_CODE_UNATTENDED: '1' } : {}) });
    assert.strictEqual(spawnSync(process.execPath, [SCRIPT, '--mode'], { env: env(true), encoding: 'utf8' }).stdout, 'unattended: on\n');
    assert.strictEqual(spawnSync(process.execPath, [SCRIPT, '--mode'], { env: env(false), encoding: 'utf8' }).stdout, 'unattended: off\n');
    const on = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env: env(true), encoding: 'utf8' }).stdout.trim().split('\n');
    const off = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env: env(false), encoding: 'utf8' }).stdout.trim().split('\n');
    assert.ok(!off.some((l) => l.startsWith('unattended:')), 'attended: the plan alone');
    assert.deepStrictEqual(on.slice(0, off.length), off, 'the plan lines are unchanged');
    assert.ok(on.slice(off.length).every((l) => l.startsWith('unattended: ')) && on.length > off.length);
});

test('unattended: init\'s bootstrap phase defines destructive and the rule every other ask follows, and names the code\'s own classification', () =>
{
    const body = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'references', 'init-bootstrap.md'), 'utf8');
    const section = body.slice(body.indexOf('## Unattended'), body.indexOf('\n## ', body.indexOf('## Unattended') + 3));
    assert.ok(body.includes('## Unattended'), 'the section exists');
    assert.match(section, /\*\*Destructive\*\* means/);
    assert.match(section, /`unattended: <question> -> <choice>`/);
    assert.match(section, /never AskUserQuestion/i);
    for (const state of DESTRUCTIVE_MACHINE) assert.ok(section.includes(`\`${state}\``), `the section names the ${state} machine line`);
    assert.match(section, /never the Read tool/);
});

test('unattended: update\'s preflight says it too, so update answers its own asks by the same rule', () =>
{
    const root = project();
    const snap = path.join(__dirname, '..');
    const run = (extra) => spawnSync(process.execPath, [path.join(__dirname, 'update-preflight.js'), '--snapshot', snap, '--root', root, '--fixture', path.join(root, 'none.json')],
        { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: ACCT, ...extra } }).stdout;
    assert.match(run({ ALFRED_CODE_UNATTENDED: '1' }), /^unattended: on$/m);
    assert.doesNotMatch(run({}), /^unattended:/m);
    const body = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'references', 'update-walk.md'), 'utf8');
    assert.match(body, /`unattended: on`[^\n]*\n?[^\n]*init-bootstrap\.md/, 'update-walk.md (the update walk, audit 2026-10-20 C15) reads the line and points at the one rule');
});

test('unattended: a mode already chosen gets no line - step 4 asks only while it is the stack\'s default', () =>
{
    const base = { machine: [], captures: [] };
    const lines = (extra) => unattended({ ...base, ...extra }).filter((l) => /Memory|Navigation/.test(l));
    assert.deepStrictEqual(lines({ memory: 'custom', ownNavigation: true }), []);
    assert.deepStrictEqual(lines({ memory: 'custom' }), ['unattended: Navigation in files? -> Agent decides, the stack\'s order (Recommended)']);
    assert.deepStrictEqual(lines({ ownNavigation: true }), ['unattended: Memory for this project? -> Native, Claude\'s default place (Recommended)']);
    // The CLI reads both from the project: a custom memory env and an own navigation entry.
    const root = project();
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' } }));
    const doc = path.join(root, '.alfred', 'docs', 'preferences', 'TOOLS-PREFERENCES.md');
    fs.mkdirSync(path.dirname(doc), { recursive: true });
    fs.writeFileSync(doc, '# Tools preferences\n\nUpdated: 2026-10-24\n\n## T1 - Code navigation\n<!-- id: t1 -->\n- Job: navigation\n- Order: Grep\n');
    const inv = path.join(root, 'installed.json');
    fs.writeFileSync(inv, JSON.stringify(INV({ plugins: [] })));
    const out = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: ACCT, ALFRED_CODE_UNATTENDED: '1', ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' }, encoding: 'utf8' }).stdout;
    assert.ok(!/unattended: (Memory|Navigation)/.test(out), out);
    assert.match(out, /unattended: AGENTS\.md -> fill it in \(Recommended\)/);
});

// D5 (workspace layering): a joined child with a CLAUDE.md above it is asked once to load both instruction files.
test('init-plan prints instructions-both: ask before its last line, and unattended prints unattended: instructions-both -> load', () =>
{
    const { unattended } = require('./init-plan.js');
    const top = fs.mkdtempSync(path.join(TMP, 'd5-'));
    const ws = path.join(top, 'ws');
    const api = path.join(ws, 'api');
    for (const [dir, file] of [[ws, 'child api\n'], [api, 'parent ..\n']])
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), file);
    }
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), '# team\n');
    const env = E({ CLAUDE_CONFIG_DIR: path.join(top, 'acct') });
    const planned = plan({ inv: INV(), root: fs.realpathSync(api), env, probe: NONE });
    const lines = render(planned);
    assert.strictEqual(lines[lines.length - 2], 'instructions-both: ask', lines.join('\n'));
    assert.match(lines[lines.length - 1], /^init-plan: /);
    assert.ok(unattended(planned).includes('unattended: instructions-both -> load'));
    const standalone = render(plan({ inv: INV(), root: project(), env, probe: NONE }));
    assert.ok(!standalone.some((l) => l.startsWith('instructions-both')), 'a standalone project is never asked');
    assert.ok(!unattended(plan({ inv: INV(), root: project(), env, probe: NONE })).some((l) => l.includes('instructions-both')));
});

