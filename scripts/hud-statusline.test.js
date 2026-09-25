'use strict';
// hud-statusline.js - /alfred-code:init's claude-hud item: the ACCOUNT statusLine claude-hud 0.8.0's
// own setup writes for a Node runtime, plus the claude-hud row of meta/plugin-settings.json (the
// Compact layout among it), add-only. Every case runs against a throwaway account dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hud = require('./hud-statusline.js');
const { SHAPES, LAUNCHER, fill, planHud, applyHud, resolveConfigDir } = hud;

const SCRIPT = path.join(__dirname, 'hud-statusline.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-statusline-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
// A throwaway account dir: claude-hud registered and cached at each version, and a settings.json when given.
function account({ versions = ['0.8.0'], registry = true, settings, enabled, config } = {})
{
    const dir = path.join(TMP, `acct-${seq++}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const v of versions)
    {
        const root = path.join(dir, 'plugins', 'cache', 'claude-hud', 'claude-hud', v);
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }\n');
        fs.writeFileSync(path.join(root, 'dist', 'index.js'),
            `export async function main() { console.log('hud ${v} cols=' + process.env.COLUMNS); }\nif (!process.env.HUD_AS_MODULE) await main();\n`);
    }
    if (registry)
    {
        const installPath = path.join(dir, 'plugins', 'cache', 'claude-hud', 'claude-hud', versions[versions.length - 1] || '0.8.0');
        fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'plugins', 'installed_plugins.json'),
            JSON.stringify({ version: 2, plugins: { 'claude-hud@claude-hud': [{ scope: 'user', installPath, version: versions[0] }] } }));
    }
    const doc = settings === undefined && enabled === undefined ? undefined : { ...(settings || {}), ...(enabled === undefined ? {} : { enabledPlugins: { 'claude-hud@claude-hud': enabled } }) };
    if (typeof settings === 'string') fs.writeFileSync(path.join(dir, 'settings.json'), settings);
    else if (doc) fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(doc, null, 2));
    if (config)
    {
        fs.mkdirSync(path.join(dir, 'plugins', 'claude-hud'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'plugins', 'claude-hud', 'config.json'), JSON.stringify(config));
    }
    return dir;
}
const read = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const hudConfig = (dir) => read(dir, path.join('plugins', 'claude-hud', 'config.json'));
const NODE = process.execPath;
const run = (dir, opts = {}) => applyHud(planHud({ configDir: dir, platform: 'darwin', runtime: NODE, ...opts }));

// The exact 0.8.0 text (commands/setup.md:199), pinned here independently of the script's own copy.
const SORT_V_FOR = (rt) => 'cols=${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk \'{print $2}\');; esac; '
    + 'case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); '
    + 'plugin_dir=$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud/*/ 2>/dev/null | sort -V | tail -1); '
    + `exec "${rt}" "\${plugin_dir}dist/index.js"`;

test('macOS / Linux: no statusLine - the 0.8.0 Node shape is written (sort -V glob, COLUMNS exported, exec, no bash -c), then the hud row', () =>
{
    const dir = account({ settings: { model: 'opus' } });
    const res = run(dir);
    const s = read(dir, 'settings.json');
    assert.strictEqual(s.statusLine.type, 'command');
    assert.strictEqual(s.statusLine.command, SORT_V_FOR(NODE), 'byte for byte the setup.md:199 shape, node absolute');
    assert.ok(!/^bash -c/.test(s.statusLine.command) && !/bun|powershell/i.test(s.statusLine.command));
    assert.strictEqual(s.statusLine.refreshInterval, 5, 'the row\'s settings.json target lands once the block exists');
    assert.strictEqual(s.model, 'opus', 'the rest of the account settings is untouched');
    const c = hudConfig(dir);
    assert.strictEqual(c.lineLayout, 'compact');
    assert.strictEqual(c.showSeparators, false);
    assert.strictEqual(c.display.showCost, true, 'the whole claude-hud row, not only the layout');
    assert.ok(res.lines.includes('hud: statusLine written - claude-hud\'s own shape for this platform'), res.lines.join('\n'));
    assert.match(res.lines[res.lines.length - 1], /^hud-statusline: \d+ change\(s\)$/);
    assert.strictEqual(fill(SHAPES.sortV, { RUNTIME_PATH: NODE, SOURCE: 'dist/index.js' }), SORT_V_FOR(NODE));
});

test('a re-run changes nothing: both files byte-identical, the plan reports no change', () =>
{
    const dir = account();
    run(dir);
    const before = [fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), fs.readFileSync(path.join(dir, 'plugins', 'claude-hud', 'config.json'), 'utf8')];
    const plan = planHud({ configDir: dir, platform: 'darwin', runtime: NODE });
    assert.strictEqual(plan.statusLine.state, 'current');
    assert.strictEqual(plan.changes, 0);
    const res = applyHud(plan);
    assert.ok(res.lines.includes('hud: statusLine current - left as it is'));
    assert.match(res.lines[res.lines.length - 1], /^hud-statusline: 0 change\(s\)$/);
    assert.deepStrictEqual([fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), fs.readFileSync(path.join(dir, 'plugins', 'claude-hud', 'config.json'), 'utf8')], before);
});

test('Windows (mocked platform): statusline.mjs under <account>/plugins/claude-hud, run through the absolute cmd.exe - no PowerShell, no Bun', () =>
{
    const dir = account();
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    const cmdExe = 'C:\\Windows\\System32\\cmd.exe';
    const exists = (p) => p === cmdExe || p === nodeExe || fs.existsSync(p);
    const plan = planHud({ configDir: dir, platform: 'win32', runtime: nodeExe, env: { SystemRoot: 'C:\\Windows' }, exists });
    const res = applyHud(plan);
    const wrapper = path.win32.join(dir, 'plugins', 'claude-hud', 'statusline.mjs');
    const s = read(dir, 'settings.json');
    // commands/setup.md:369 + :375-377 - `{CMD_PATH} /d /s /c ""{RUNTIME_PATH}" "{WRAPPER_PATH}""`.
    assert.strictEqual(s.statusLine.command, `${cmdExe} /d /s /c ""${nodeExe}" "${wrapper}""`);
    assert.ok(!/powershell|pwsh|bun|\.ps1/i.test(s.statusLine.command));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'plugins', 'claude-hud', 'statusline.mjs'), 'utf8'), LAUNCHER, 'the setup.md:237-293 launcher, as written');
    assert.ok(res.lines.some((l) => /^hud: launcher written - .*statusline\.mjs$/.test(l)), res.lines.join('\n'));
    // Re-run on the same platform: current, nothing written.
    const again = planHud({ configDir: dir, platform: 'win32', runtime: nodeExe, env: { SystemRoot: 'C:\\Windows' }, exists });
    assert.strictEqual(again.statusLine.state, 'current');
    assert.strictEqual(again.changes, 0);
    // No cmd.exe at SystemRoot: the bare name, setup.md:376's own fallback.
    const bare = planHud({ configDir: account(), platform: 'win32', runtime: nodeExe, env: { SystemRoot: 'D:\\Nowhere' }, exists: (p) => p === nodeExe });
    assert.match(bare.statusLine.command, /^cmd\.exe \/d \/s \/c ""/);
});

test('Windows: a claude-hud line of another shape is stale - the old PowerShell wrapper, the macOS awk form, a missing launcher', () =>
{
    const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
    const exists = (p) => p === nodeExe || fs.existsSync(p);
    const opts = { platform: 'win32', runtime: nodeExe, env: { SystemRoot: 'C:\\Windows' }, exists };
    const ps1 = account({ settings: { statusLine: { type: 'command', command: 'powershell -NoProfile -File C:\\Users\\u\\.claude\\plugins\\claude-hud\\statusline.ps1', refreshInterval: 3 } } });
    assert.strictEqual(planHud({ configDir: ps1, ...opts }).statusLine.state, 'stale');
    applyHud(planHud({ configDir: ps1, ...opts }));
    const s = read(ps1, 'settings.json');
    assert.match(s.statusLine.command, /cmd\.exe \/d \/s \/c ""/);
    assert.strictEqual(s.statusLine.refreshInterval, 3, 'the user\'s own interval survives a refresh');
    const awk = account({ settings: { statusLine: { type: 'command', command: fill(SHAPES.awkNode, { RUNTIME_PATH: nodeExe, SOURCE: 'dist/index.js' }) } } });
    assert.strictEqual(planHud({ configDir: awk, ...opts }).statusLine.state, 'stale', 'setup.md:194 - the awk form breaks on Windows');
    // The cmd.exe line is current only while its launcher is on disk.
    const gone = account();
    applyHud(planHud({ configDir: gone, ...opts }));
    fs.rmSync(path.join(gone, 'plugins', 'claude-hud', 'statusline.mjs'));
    assert.strictEqual(planHud({ configDir: gone, ...opts }).statusLine.state, 'stale');
});

test('a statusLine that is not claude-hud\'s is kept, reported with the /claude-hud:setup line, and given no refresh interval', () =>
{
    const mine = { type: 'command', command: '~/.claude/statusline.sh', padding: 1 };
    const dir = account({ settings: { statusLine: mine } });
    const plan = planHud({ configDir: dir, platform: 'darwin', runtime: NODE });
    assert.strictEqual(plan.statusLine.state, 'foreign');
    assert.strictEqual(plan.statusLine.label, 'statusline script', 'setup.md:478-485 classification');
    const res = applyHud(plan);
    assert.deepStrictEqual(read(dir, 'settings.json').statusLine, mine, 'kept byte for byte - no refreshInterval invented on someone else\'s line');
    const kept = res.lines.find((l) => l.startsWith('hud: statusLine kept'));
    assert.match(kept, /not claude-hud's \(source: statusline script\); \/claude-hud:setup replaces it/);
    assert.ok(!kept.includes('statusline.sh'), 'the command itself is never printed - it may carry a token');
    assert.strictEqual(hudConfig(dir).lineLayout, 'compact', 'the layout still lands - it is the hud\'s own file');
    // The other upstream labels.
    const label = (command) => planHud({ configDir: account({ settings: { statusLine: { type: 'command', command } } }), platform: 'darwin', runtime: NODE }).statusLine.label;
    assert.strictEqual(label('npx ccstatusline'), 'cc-statusline');
    assert.strictEqual(label('claude-pace --x'), 'claude-pace');
    assert.strictEqual(label('echo hi'), 'custom');
});

test('a stale claude-hud line is refreshed, its other keys kept; claude-hud\'s own current shapes are left as they are', () =>
{
    const pinned = account({ settings: { statusLine: { type: 'command', command: 'node ~/.claude/plugins/cache/claude-hud/claude-hud/0.5.0/dist/index.js', refreshInterval: 10, padding: 2 } } });
    const plan = planHud({ configDir: pinned, platform: 'linux', runtime: NODE });
    assert.strictEqual(plan.statusLine.state, 'stale');
    const res = applyHud(plan);
    const s = read(pinned, 'settings.json').statusLine;
    assert.strictEqual(s.command, SORT_V_FOR(NODE));
    assert.strictEqual(s.refreshInterval, 10, 'add-only: the user\'s interval stays');
    assert.strictEqual(s.padding, 2);
    assert.ok(res.lines.includes('hud: statusLine refreshed - the claude-hud line had a stale shape; its other keys kept'));

    // What /claude-hud:setup itself writes on macOS / Linux (setup.md:180 bun, :185 node) is current.
    const bun = path.join(TMP, 'fake-bun');
    fs.writeFileSync(bun, '');
    for (const command of [fill(SHAPES.awkNode, { RUNTIME_PATH: NODE, SOURCE: 'dist/index.js' }), fill(SHAPES.awkBun, { RUNTIME_PATH: bun, SOURCE: 'src/index.ts' })])
    {
        const dir = account({ settings: { statusLine: { type: 'command', command } } });
        const p = planHud({ configDir: dir, platform: 'darwin', runtime: NODE });
        assert.strictEqual(p.statusLine.state, 'current', command.slice(-60));
        applyHud(p);
        assert.strictEqual(read(dir, 'settings.json').statusLine.command, command, 'left as it is');
    }
    // A current shape whose runtime is gone (a node the user uninstalled) cannot run: stale.
    const dead = account({ settings: { statusLine: { type: 'command', command: SORT_V_FOR('/nowhere/bin/node') } } });
    assert.strictEqual(planHud({ configDir: dead, platform: 'darwin', runtime: NODE }).statusLine.state, 'stale');
});

test('claude-hud absent or switched off: one skip line, nothing written', () =>
{
    for (const [dir, why] of [
        [account({ registry: false }), /claude-hud is not installed/],
        [account({ versions: [], registry: true }), /claude-hud is not installed/],
        [account({ enabled: false }), /claude-hud is switched off/],
    ])
    {
        const before = fs.existsSync(path.join(dir, 'settings.json')) ? fs.readFileSync(path.join(dir, 'settings.json'), 'utf8') : null;
        const plan = planHud({ configDir: dir, platform: 'darwin', runtime: NODE });
        assert.strictEqual(plan.install.ok, false);
        const res = applyHud(plan);
        assert.strictEqual(res.lines.length, 1, res.lines.join('\n'));
        assert.match(res.lines[0], /^hud: skipped - /);
        assert.match(res.lines[0], why);
        assert.strictEqual(fs.existsSync(path.join(dir, 'settings.json')) ? fs.readFileSync(path.join(dir, 'settings.json'), 'utf8') : null, before);
        assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'claude-hud', 'config.json')));
    }
});

test('the compact keys merge add-only: a user\'s expanded layout is kept and reported', () =>
{
    const dir = account({ config: { lineLayout: 'expanded', display: { showCost: false } } });
    const res = run(dir);
    const c = hudConfig(dir);
    assert.strictEqual(c.lineLayout, 'expanded');
    assert.strictEqual(c.display.showCost, false);
    assert.strictEqual(c.showSeparators, false, 'the missing key is added');
    assert.ok(res.lines.some((l) => /differs\s+lineLayout -> "compact" \(now: "expanded"\)/.test(l)), res.lines.join('\n'));
});

test('a malformed account settings.json blocks: nothing is written, exit 1 through the CLI', () =>
{
    const dir = account({ settings: '{ "statusLine": ' });
    const plan = planHud({ configDir: dir, platform: 'darwin', runtime: NODE });
    assert.match(plan.error, /settings\.json is not valid JSON/);
    const r = spawnSync(process.execPath, [SCRIPT, '--config-dir', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: TMP } });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^hud: blocked - .*settings\.json is not valid JSON - nothing written/m);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ "statusLine": ');
    assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'claude-hud', 'config.json')));
    // An empty file is an empty object (setup.md:409 reads it as no statusLine).
    const empty = account({ settings: '  \n' });
    run(empty);
    assert.strictEqual(read(empty, 'settings.json').statusLine.type, 'command');
});

test('the account dir: --config-dir, else CLAUDE_CONFIG_DIR, else ~/.claude-<space>, else ~/.claude - the installer\'s rule', () =>
{
    const home = path.join(TMP, 'home');
    assert.strictEqual(resolveConfigDir({ flag: '/x/acct', space: 'work', env: { CLAUDE_CONFIG_DIR: '/y', HOME: home } }), '/x/acct');
    assert.strictEqual(resolveConfigDir({ space: 'work', env: { CLAUDE_CONFIG_DIR: '/y', HOME: home } }), '/y');
    assert.strictEqual(resolveConfigDir({ space: 'work', env: { HOME: home } }), path.join(home, '.claude-work'));
    assert.strictEqual(resolveConfigDir({ env: { HOME: home } }), path.join(home, '.claude'));
    assert.throws(() => resolveConfigDir({ space: '../x', env: { HOME: home } }), /--space/);
});

test('CLI: --space writes into that profile\'s own dir and nowhere else', { skip: process.platform === 'win32' && 'posix shape' }, () =>
{
    const home = path.join(TMP, `home-${seq++}`);
    const profile = path.join(home, '.claude-work');
    fs.mkdirSync(home, { recursive: true });
    fs.cpSync(account(), profile, { recursive: true });
    const r = spawnSync(process.execPath, [SCRIPT, '--space', 'work'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(read(profile, 'settings.json').statusLine.type, 'command');
    assert.ok(!fs.existsSync(path.join(home, '.claude')), 'the default account is never touched');
});

// The written command, EXECUTED: a fake cache with 0.9.0 and 0.10.0 - version order, not string order.
test('the written POSIX command runs: newest version by sort -V, COLUMNS inherited minus 4', { skip: process.platform === 'win32' && 'posix shells' }, () =>
{
    const dir = account({ versions: ['0.9.0', '0.10.0'] });
    run(dir);
    const { command } = read(dir, 'settings.json').statusLine;
    for (const shell of ['/bin/sh', '/bin/bash'].filter((s) => fs.existsSync(s)))
    {
        const r = spawnSync(shell, ['-c', command], { encoding: 'utf8', input: '{}', env: { PATH: process.env.PATH, HOME: TMP, CLAUDE_CONFIG_DIR: dir, COLUMNS: '100' } });
        assert.strictEqual(r.status, 0, `${shell}: ${r.stderr}`);
        assert.strictEqual(r.stdout.trim(), 'hud 0.10.0 cols=96', shell);
    }
});

test('the Windows launcher body runs under node: newest version, main() called, COLUMNS minus 4', () =>
{
    const dir = account({ versions: ['0.9.0', '0.10.0'] });
    const file = path.join(dir, 'statusline.mjs');
    fs.writeFileSync(file, LAUNCHER);
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: TMP, CLAUDE_CONFIG_DIR: dir, COLUMNS: '80', HUD_AS_MODULE: '1' } });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), 'hud 0.10.0 cols=76');
});
