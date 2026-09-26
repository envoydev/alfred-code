'use strict';
// init-plan.js - what /alfred-code:init does in THIS project, stated by a script so the command
// never infers it: the machine-level installs the kept MCPs need (probed, each with its exact
// command), then the captures whose skill AND seat the install lists, in the fixed order.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { plan, render } = require('./init-plan.js');

const SCRIPT = path.join(__dirname, 'init-plan.js');
const PINS = require('../meta/mcp-pins.json').pins;
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
    skills: ['alfred-capture-related-projects', 'alfred-capture-architecture', 'alfred-capture-code-style', 'alfred-capture-agent-capabilities'],
    agents: ['related-project-analyzer', 'architecture-analyzer', 'code-style-analyzer'],
    mcps: ['navigation', 'documentation', 'memory', 'playwright'],
    plugins: [{ name: 'alfred-code', scope: 'project' }, { name: 'csharp-lsp', scope: 'project' }],
    left_out: [],
    playwright: { installed: ['chrome', 'firefox'], enabled: ['chrome'] },
    ...over,
});
const ACCT = path.join(TMP, 'acct');   // never the real account's settings (the Python override is read there)
const E = (extra = {}) => ({ CLAUDE_CONFIG_DIR: ACCT, HOME: path.join(TMP, 'home'), ...extra });
const NONE = { has: () => false, pythonFound: () => false, dir: () => false, file: () => false };
const lineOf = (lines, re) => lines.find((l) => re.test(l)) || '';

test('machine: nothing installed - uv first, the rest after it, each with its exact command', () =>
{
    const root = project();
    const lines = render(plan({ inv: INV(), root, platform: 'darwin', env: E(), probe: NONE }));
    assert.match(lineOf(lines, /^machine: uv /), /^machine: uv - missing: curl -LsSf https:\/\/astral\.sh\/uv\/install\.sh \| sh$/);
    assert.match(lineOf(lines, /^machine: python /), /^machine: python 3\.13 - missing after uv: uv python install 3\.13$/);
    assert.match(lineOf(lines, /^machine: csharp-ls /), /^machine: csharp-ls - blocked: needs the \.NET 10 SDK \(dotnet\) first/);
    assert.strictEqual(lineOf(lines, /^machine: playwright firefox /),
        `machine: playwright firefox - missing: npx -y -p @playwright/mcp@${PINS.browser.version} playwright install firefox`);
    // M2: chrome downloads nothing - it runs the machine's Google Chrome - so a picked one that is not
    // there is reported, with the fix the user makes (probed like stack-select probes msedge).
    assert.strictEqual(lineOf(lines, /^machine: playwright chrome /),
        'machine: playwright chrome - blocked: needs Google Chrome - install it, or drop chrome from the playwright browsers (/alfred-code:configure)');
    assert.strictEqual(lineOf(lines, /^machine: serena index /),
        `machine: serena index - missing after uv: SERENA_HOME=.serena/home uvx --python 3.13 --from serena-agent@${PINS.navigation.version} serena project index`);
    // Order is install order: uv, python, csharp-ls, the engines, the index - then the account's hud.
    const order = lines.filter((l) => l.startsWith('machine:')).map((l) => l.split(' - ')[0]);
    assert.deepStrictEqual(order, ['machine: uv', 'machine: python 3.13', 'machine: csharp-ls', 'machine: playwright chrome', 'machine: playwright firefox', 'machine: serena index',
        'machine: claude-hud status line + compact layout']);
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
    assert.strictEqual(hudLine(), 'machine: claude-hud status line + compact layout - skip: claude-hud is not installed in this account');

    const cached = path.join(acct, 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.8.0');
    fs.mkdirSync(path.join(cached, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(cached, 'dist', 'index.js'), '');
    fs.writeFileSync(path.join(acct, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'user', installPath: cached, version: '0.8.0' }] } }));
    const missing = render(plan({ inv: INV(), root, env, probe: NONE }));
    const command = `node "${path.join(__dirname, 'hud-statusline.js')}" --config-dir "${acct}"`;
    // The keys the row adds ride the command as a shell comment: named in the ask, inert when run.
    assert.strictEqual(lineOf(missing, HUD),
        `machine: claude-hud status line + compact layout - missing: ${command} # adds 13 claude-hud keys: lineLayout, showSeparators, display (8), gitStatus (2), statusLine.refreshInterval`);
    assert.match(missing[missing.length - 1], /^init-plan: 5 to install, /, 'counted with the other missing items - one ask');

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
    assert.match(refresh[refresh.length - 1], /^init-plan: 5 to install, /, 'a refresh is one of the ask\'s options');

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

test('machine: the claude-hud item reads the account --space names when CLAUDE_CONFIG_DIR is unset', () =>
{
    const root = project();
    const home = path.join(TMP, `space-home-${seq++}`);
    fs.mkdirSync(path.join(home, '.claude-work'), { recursive: true });
    const lines = render(plan({ inv: INV(), root, platform: 'linux', env: { HOME: home }, probe: NONE, space: 'work' }));
    assert.strictEqual(lineOf(lines, /claude-hud/), 'machine: claude-hud status line + compact layout - skip: claude-hud is not installed in this account');
    const cached = path.join(home, '.claude-work', 'plugins', 'cache', 'claude-hud', 'claude-hud', '0.8.0', 'dist');
    fs.mkdirSync(cached, { recursive: true });
    fs.writeFileSync(path.join(cached, 'index.js'), '');
    fs.writeFileSync(path.join(home, '.claude-work', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'user' }] } }));
    const again = render(plan({ inv: INV(), root, platform: 'linux', env: { HOME: home }, probe: NONE, space: 'work' }));
    assert.match(lineOf(again, /claude-hud/), new RegExp(`--config-dir "${path.join(home, '.claude-work').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" # adds 13 claude-hud keys: `));
});

test('machine: everything present is reported present, and csharp-ls is asked only when csharp-lsp is kept', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, '.serena', 'cache', 'typescript'), { recursive: true });
    const probe = { has: () => true, pythonFound: () => true, dir: () => true };
    const lines = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe }));
    for (const what of ['uv', 'python 3.13', 'csharp-ls', 'playwright chrome', 'playwright firefox', 'serena index'])
        assert.ok(lines.includes(`machine: ${what} - present`), `${what}: ${lines.join('\n')}`);
    assert.match(lines[lines.length - 1], /^init-plan: 0 to install, 0 blocked, /);
    const noLsp = render(plan({ inv: INV({ plugins: [{ name: 'alfred-code', scope: 'project' }] }), root, platform: 'linux', env: E(), probe }));
    assert.ok(!noLsp.some((l) => /csharp-ls/.test(l)));
    const dotnetOnly = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe: { ...probe, has: (b) => b !== 'csharp-ls' }, }));
    assert.strictEqual(lineOf(dotnetOnly, /^machine: csharp-ls /), 'machine: csharp-ls - missing: dotnet tool install --global csharp-ls');
});

test('machine: Windows spellings - the PowerShell uv installer, the pinned x64 Python on ARM, a native SERENA_HOME', () =>
{
    const root = project();
    const lines = render(plan({ inv: INV(), root, platform: 'win32', arch: 'arm64', env: E({ PROCESSOR_ARCHITECTURE: 'ARM64' }), probe: NONE }));
    assert.match(lineOf(lines, /^machine: uv /), /powershell -ExecutionPolicy ByPass -c "irm https:\/\/astral\.sh\/uv\/install\.ps1 \| iex"$/);
    assert.match(lineOf(lines, /^machine: python /), /uv python install cpython-3\.13-windows-x86_64-none$/);
    assert.match(lineOf(lines, /^machine: serena index /), /\$env:SERENA_HOME='\.serena\\home'; uvx --python cpython-3\.13-windows-x86_64-none --from serena-agent@/);
});

test('machine: a picked chrome or msedge is found on PATH or at its app install location, and reported when missing (M2)', () =>
{
    const root = project();
    const { browserCandidates } = require('./stack-select.js');
    assert.ok(browserCandidates('chrome', 'darwin', {}).includes('/Applications/Google Chrome.app'));
    assert.ok(browserCandidates('chrome', 'linux', {}).includes('/opt/google/chrome/chrome'));
    assert.ok(browserCandidates('chrome', 'win32', { ProgramFiles: 'C:\\Program Files' }).includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
    const inv = INV({ playwright: { installed: ['chrome', 'msedge'], enabled: ['chrome'] } });
    const at = (file) => ({ ...NONE, file: (p) => p === file });
    const mac = render(plan({ inv, root, platform: 'darwin', env: E(), probe: at('/Applications/Google Chrome.app') }));
    assert.ok(mac.includes('machine: playwright chrome - present'), mac.join('\n'));
    assert.strictEqual(lineOf(mac, /^machine: playwright msedge /),
        'machine: playwright msedge - blocked: needs Microsoft Edge - install it, or drop msedge from the playwright browsers (/alfred-code:configure)');
    const noLsp = { ...inv, plugins: [{ name: 'alfred-code', scope: 'project' }] };
    const onPath = render(plan({ inv: noLsp, root, platform: 'linux', env: E(), probe: { ...NONE, has: (b) => b === 'google-chrome' || b === 'microsoft-edge' } }));
    assert.ok(onPath.includes('machine: playwright chrome - present') && onPath.includes('machine: playwright msedge - present'), onPath.join('\n'));
    assert.match(onPath[onPath.length - 1], /, 0 blocked, /, 'present browsers block nothing');
});

test('machine: no playwright kept, no engine lines; the engine is found under PLAYWRIGHT_BROWSERS_PATH', () =>
{
    const root = project();
    const none = render(plan({ inv: INV({ playwright: { installed: [], enabled: [] } }), root, platform: 'linux', env: E(), probe: NONE }));
    assert.ok(!none.some((l) => /playwright/.test(l)));
    const cache = path.join(root, 'pw');
    fs.mkdirSync(path.join(cache, 'webkit-2140'), { recursive: true });
    const { dir } = require('./init-plan.js').probes;
    const lines = render(plan({ inv: INV({ playwright: { installed: ['webkit', 'firefox'], enabled: [] } }), root, platform: 'linux',
        env: E({ PLAYWRIGHT_BROWSERS_PATH: cache }), probe: { ...NONE, dir } }));
    assert.ok(lines.includes('machine: playwright webkit - present'), lines.join('\n'));
    assert.match(lineOf(lines, /playwright firefox/), / - missing: /);
});

test('captures: the fixed order; run, done and skip each say why; the library copy wins over the plugin\'s', () =>
{
    const root = project({ settings: { env: { ALFRED_CODE_DOCS_PATH: 'notes/ai' } } });
    fs.mkdirSync(path.join(root, 'notes', 'ai', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'ai', 'architecture', 'ARCHITECTURE.md'), '# map\n');
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'alfred-capture-related-projects'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'alfred-capture-related-projects', 'SKILL.md'), '---\nname: x\n---\n');
    const inv = INV({ left_out: ['agent code-style-analyzer'] });
    const lines = render(plan({ inv, root, platform: 'linux', env: E(), probe: NONE, pluginRoot: path.join(__dirname, '..') }))
        .filter((l) => l.startsWith('capture:'));
    assert.deepStrictEqual(lines.map((l) => l.split(' - ')[0]), [
        'capture: alfred-capture-related-projects', 'capture: alfred-capture-architecture',
        'capture: alfred-capture-code-style', 'capture: alfred-capture-agent-capabilities',
    ]);
    assert.strictEqual(lines[0], 'capture: alfred-capture-related-projects - run: read .claude/skills/alfred-capture-related-projects/SKILL.md');
    assert.strictEqual(lines[1], 'capture: alfred-capture-architecture - done: notes/ai/architecture/ARCHITECTURE.md exists');
    assert.strictEqual(lines[2], 'capture: alfred-capture-code-style - skip: its seat code-style-analyzer is switched off');
    assert.strictEqual(lines[3], `capture: alfred-capture-agent-capabilities - run: read ${path.join(__dirname, '..', 'stack', 'skills', 'alfred-capture-agent-capabilities', 'SKILL.md')}`);

    const bare = render(plan({ inv: INV({ skills: ['alfred-capture-agent-capabilities'], agents: [] }), root, platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(bare[0], 'capture: alfred-capture-related-projects - skip: the skill is not installed');
    assert.strictEqual(bare[1], 'capture: alfred-capture-architecture - skip: the skill is not installed');
    const noSeat = render(plan({ inv: INV({ agents: [] }), root: project(), platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(noSeat[2], 'capture: alfred-capture-code-style - skip: its seat code-style-analyzer is not installed');
});

// End to end through the CLI, on a stubbed PATH: the real probes, the real pins file.
test('CLI: probes the machine on PATH, reads the plan-out file, refuses a missing or malformed one', { skip: process.platform === 'win32' && 'shell stubs' }, () =>
{
    const root = project();
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
    stub('uv', 'if [ "$1" = "python" ] && [ "$2" = "find" ]; then echo "error: No interpreter found" >&2; exit 2; fi\necho "uv 0.9.0"');
    stub('dotnet', 'exit 0');
    const inv = path.join(root, 'installed.json');
    fs.writeFileSync(inv, JSON.stringify(INV({ playwright: { installed: ['firefox'], enabled: [] } })));   // chrome's probe reads this machine's apps
    const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'pw') };
    const r = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n');
    assert.ok(lines.includes('machine: uv - present'), r.stdout);
    assert.ok(lines.includes('machine: python 3.13 - missing: uv python install 3.13'), 'uv present, so no after-uv');
    assert.ok(lines.includes('machine: csharp-ls - missing: dotnet tool install --global csharp-ls'));
    assert.match(lines[lines.length - 1], /^init-plan: 4 to install, 0 blocked, 4 captures to run$/);

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
        .find((l) => l.startsWith('capture: alfred-capture-architecture'));
    const stamp = (scope) => fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `source: x\nscope: ${scope}\n`);
    stamp('local');
    assert.strictEqual(line(), 'capture: alfred-capture-architecture - done: docs/mine/architecture/ARCHITECTURE.md exists');
    stamp('project');
    assert.match(line(), /^capture: alfred-capture-architecture - run: /, 'project scope never reads the personal file');
});

// R134, the I-4 class: a --space that names no profile exits 2 - never the default account's plan.
for (const [name, args] of [
    ['--space with no value', ['--space']],
    ['--space with an empty value', ['--space', '']],
    ['the --space=<name> form', ['--space=work']],
])
{
    test(`CLI: ${name} exits 2 with no plan`, () =>
    {
        const root = project();
        const inv = path.join(root, 'installed.json');
        fs.writeFileSync(inv, JSON.stringify(INV()));
        const home = path.join(TMP, `cli-home-${seq++}`);
        fs.mkdirSync(home);
        const r = spawnSync(process.execPath, [SCRIPT, '--installed', inv, '--root', root, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
        assert.strictEqual(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /^init-plan: --space needs a profile name, as --space <name>$/m);
        assert.strictEqual(r.stdout, '');
    });
}

// Both homes that print the post-install capture order to a reader must follow the order this script runs
// (the shared-rules pin covers only the 'agent-capabilities LAST' clause, which is how the template drifted).
for (const rel of ['stack/CLAUDE.template.md', 'setup-plugin/references/post-install.md'])
{
    test(`capture order: ${rel} names the captures in CAPTURES order`, () =>
    {
        const { CAPTURES } = require('./init-plan.js');
        const names = CAPTURES.map((c) => c.skill);
        const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        const firstSeen = [];
        for (const m of text.matchAll(/\/(alfred-capture-[a-z-]+)/g)) if (names.includes(m[1]) && !firstSeen.includes(m[1])) firstSeen.push(m[1]);
        assert.deepStrictEqual(firstSeen, names);
    });
}
