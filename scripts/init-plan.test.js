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
    skills: ['project-related-context', 'project-architecture-analyzer', 'project-code-style-analyzer', 'project-agent-capabilities'],
    agents: ['related-project-analyzer', 'architecture-analyzer', 'code-style-analyzer'],
    mcps: ['serena', 'context7', 'memory', 'playwright'],
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
        `machine: playwright firefox - missing: npx -y -p @playwright/mcp@${PINS.playwright.version} playwright install firefox`);
    assert.ok(!lines.some((l) => /playwright chrome/.test(l)), 'chrome runs the installed browser - nothing to download');
    assert.strictEqual(lineOf(lines, /^machine: serena index /),
        `machine: serena index - missing after uv: SERENA_HOME=.serena/home uvx --python 3.13 --from serena-agent@${PINS.serena.version} serena project index`);
    // Order is install order: uv, python, csharp-ls, the engines, the index.
    const order = lines.filter((l) => l.startsWith('machine:')).map((l) => l.split(' - ')[0]);
    assert.deepStrictEqual(order, ['machine: uv', 'machine: python 3.13', 'machine: csharp-ls', 'machine: playwright firefox', 'machine: serena index']);
});

test('machine: everything present is reported present, and csharp-ls is asked only when csharp-lsp is kept', () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, '.serena', 'cache', 'typescript'), { recursive: true });
    const probe = { has: () => true, pythonFound: () => true, dir: () => true };
    const lines = render(plan({ inv: INV(), root, platform: 'linux', env: E(), probe }));
    for (const what of ['uv', 'python 3.13', 'csharp-ls', 'playwright firefox', 'serena index'])
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
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'project-related-context'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'project-related-context', 'SKILL.md'), '---\nname: x\n---\n');
    const inv = INV({ left_out: ['agent code-style-analyzer'] });
    const lines = render(plan({ inv, root, platform: 'linux', env: E(), probe: NONE, pluginRoot: path.join(__dirname, '..') }))
        .filter((l) => l.startsWith('capture:'));
    assert.deepStrictEqual(lines.map((l) => l.split(' - ')[0]), [
        'capture: project-related-context', 'capture: project-architecture-analyzer',
        'capture: project-code-style-analyzer', 'capture: project-agent-capabilities',
    ]);
    assert.strictEqual(lines[0], 'capture: project-related-context - run: read .claude/skills/project-related-context/SKILL.md');
    assert.strictEqual(lines[1], 'capture: project-architecture-analyzer - done: notes/ai/architecture/ARCHITECTURE.md exists');
    assert.strictEqual(lines[2], 'capture: project-code-style-analyzer - skip: its seat code-style-analyzer is switched off');
    assert.strictEqual(lines[3], `capture: project-agent-capabilities - run: read ${path.join(__dirname, '..', 'stack', 'skills', 'project-agent-capabilities', 'SKILL.md')}`);

    const bare = render(plan({ inv: INV({ skills: ['project-agent-capabilities'], agents: [] }), root, platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(bare[0], 'capture: project-related-context - skip: the skill is not installed');
    assert.strictEqual(bare[1], 'capture: project-architecture-analyzer - skip: the skill is not installed');
    const noSeat = render(plan({ inv: INV({ agents: [] }), root: project(), platform: 'linux', env: E(), probe: NONE }))
        .filter((l) => l.startsWith('capture:'));
    assert.strictEqual(noSeat[2], 'capture: project-code-style-analyzer - skip: its seat code-style-analyzer is not installed');
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
    fs.writeFileSync(inv, JSON.stringify(INV()));
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
