'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { planFor, applyTargets, report, leaves, atPath, setLeaf, main } = require('./plugin-settings.js');
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-settings.json'), 'utf8'));

// Every case's dir lives under ONE root, removed when the file's tests end.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-settings-'));
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
let seq = 0;
function tmp()
{
    const dir = path.join(ROOT, `case-${seq++}`);
    fs.mkdirSync(dir);
    return dir;
}
const baks = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('settings.json.bak.')).sort();

const ENTRY = {
    targets: [
        { file: 'plugins/x/config.json', settings: { display: { a: true, b: true }, top: 1 } },
        { file: 'settings.json', requires_path: 'statusLine', settings: { statusLine: { refreshInterval: 5 } } },
    ],
};

test('leaves flattens to dotted keys; atPath/setLeaf address them', () => {
    assert.deepStrictEqual(leaves({ a: { b: 1 }, c: [1, 2] }), [['a.b', 1], ['c', [1, 2]]]);
    assert.strictEqual(atPath({ a: { b: 2 } }, 'a.b'), 2);
    assert.strictEqual(atPath({ a: {} }, 'a.b.c'), undefined, 'a missing path is undefined, never a throw');
    const doc = {};
    setLeaf(doc, 'a.b.c', true);
    assert.deepStrictEqual(doc, { a: { b: { c: true } } });
});

test('a missing target file is planned as create-and-add; requires_path gates the other', () => {
    const dir = tmp();
    const plan = planFor(ENTRY, dir);
    assert.strictEqual(plan[0].exists, false);
    assert.deepStrictEqual(plan[0].rows.map(r => r.status), ['missing', 'missing', 'missing']);
    // the statusLine block belongs to the plugin's own setup - never invented here
    assert.match(plan[1].skipped, /no `statusLine`/);
    assert.strictEqual(applyTargets(plan, false).written, 1, 'only the un-gated target is written');
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'the gated file is not created');
});

test('apply is ADD-ONLY: a value the user already chose is kept and reported, not overwritten', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'plugins', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins', 'x', 'config.json'), JSON.stringify({ display: { a: false, mine: 'keep' }, other: 1 }));
    applyTargets(planFor(ENTRY, dir), false);

    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'x', 'config.json'), 'utf8'));
    assert.strictEqual(doc.display.a, false, 'the differing value survives an apply');
    assert.strictEqual(doc.display.b, true, 'the missing one is added');
    assert.strictEqual(doc.display.mine, 'keep', 'a key outside the catalog is never touched');
    assert.strictEqual(doc.other, 1);

    // --replace is the explicit opt-in
    applyTargets(planFor(ENTRY, dir), true);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'plugins', 'x', 'config.json'), 'utf8')).display.a, true);
});

test('a gated target with the block present is patched in place', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'hud' }, model: 'opus' }));
    applyTargets(planFor(ENTRY, dir), false);

    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.deepStrictEqual(doc.statusLine, { type: 'command', command: 'hud', refreshInterval: 5 });
    assert.strictEqual(doc.model, 'opus', 'the rest of settings.json is untouched');
});

test('the claude-hud row carries the Compact preset of 0.8.0: lineLayout compact, showSeparators false, each with a why', () => {
    const hud = CATALOG.plugins['claude-hud'];
    const config = hud.targets[0];
    // commands/configure.md's layout table: Compact = lineLayout "compact", showSeparators false.
    assert.strictEqual(config.settings.lineLayout, 'compact');
    assert.strictEqual(config.settings.showSeparators, false);
    assert.match(hud.verified, /commands\/configure\.md/, 'the preset is cited where it was read');
    assert.match(hud.verified, /mergeConfig/, 'and the keys where the plugin reads them');
    // dist/config.js migrateConfig: a legacy `layout` key is migrated only while `lineLayout` is absent,
    // so adding lineLayout would silently override that older choice.
    assert.deepStrictEqual(config.chosen_by, { lineLayout: 'layout', showSeparators: 'layout' });
});

test('a layout the user already chose is kept: an expanded lineLayout, or the legacy layout key', () => {
    const hud = CATALOG.plugins['claude-hud'];
    const onlyConfig = { targets: [hud.targets[0]] };
    const file = (dir) => path.join(dir, 'plugins', 'claude-hud', 'config.json');
    const seed = (doc) => { const dir = tmp(); fs.mkdirSync(path.dirname(file(dir)), { recursive: true }); fs.writeFileSync(file(dir), JSON.stringify(doc)); return dir; };

    const expanded = seed({ lineLayout: 'expanded' });
    const rows = planFor(onlyConfig, expanded)[0].rows;
    assert.strictEqual(rows.find((r) => r.key === 'lineLayout').status, 'differs');
    applyTargets(planFor(onlyConfig, expanded), false);
    assert.strictEqual(JSON.parse(fs.readFileSync(file(expanded), 'utf8')).lineLayout, 'expanded');

    const legacy = seed({ layout: 'separators' });
    const plan = planFor(onlyConfig, legacy);
    for (const key of ['lineLayout', 'showSeparators'])
    {
        const row = plan[0].rows.find((r) => r.key === key);
        assert.strictEqual(row.status, 'differs', `${key}: the legacy layout counts as chosen`);
        assert.strictEqual(row.via, 'layout');
    }
    applyTargets(plan, false);
    const doc = JSON.parse(fs.readFileSync(file(legacy), 'utf8'));
    assert.ok(!('lineLayout' in doc) && !('showSeparators' in doc), 'neither key is added over the legacy choice');
    assert.strictEqual(doc.layout, 'separators');
    assert.strictEqual(doc.display.showCost, true, 'the rest of the row still lands');
    assert.match(report(['claude-hud'], { 'claude-hud': plan }, {}).text, /differs\s+lineLayout -> "compact" \(now: layout "separators"\)/);
});

test('an unreadable target file is skipped and left as it is, never overwritten', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'plugins', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins', 'x', 'config.json'), '{ broken');
    const plan = planFor(ENTRY, dir);
    assert.match(plan[0].skipped, /plugins\/x\/config\.json is not valid JSON - left as it is/);
    applyTargets(plan, true);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'plugins', 'x', 'config.json'), 'utf8'), '{ broken');
});

test('the shipped catalog only recommends keys the plugin actually reads', () => {
    // Not a guess: every row names the version and file its keys were read from, and the guided
    // substep offers exactly these - a key the plugin does not read is a silent no-op.
    const hud = CATALOG.plugins['claude-hud'];
    assert.ok(hud, 'claude-hud has a row');
    assert.match(hud.verified, /claude-hud \d+\.\d+\.\d+/, 'the row names the verified version');
    assert.strictEqual(hud.scope, 'account');
    const files = hud.targets.map(t => t.file);
    assert.deepStrictEqual(files, ['plugins/claude-hud/config.json', 'settings.json']);
    assert.strictEqual(hud.targets[1].requires_path, 'statusLine', 'the settings.json patch is gated');
    for (const t of hud.targets)
    {
        for (const group of Object.keys(t.settings)) assert.ok(t.why[group], `${t.file}: the '${group}' group carries a why`);
    }
});

test('a file that breaks between plan and apply is left as it is', () => {
    const dir = tmp();
    const file = path.join(dir, 'plugins', 'x', 'config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ display: { a: false } }));
    const plan = planFor(ENTRY, dir);
    assert.ok(!plan[0].skipped && plan[0].rows.some((r) => r.status === 'missing'), 'planned while the file was fine');
    fs.writeFileSync(file, '{ broken');
    assert.strictEqual(applyTargets(plan, true).written, 0);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('the account settings.json is copied to settings.json.bak.<time> before it is patched, once per run - never when it is not written', () => {
    const dir = tmp();
    const file = path.join(dir, 'settings.json');
    const before = JSON.stringify({ statusLine: { type: 'command', command: 'hud' } });
    fs.writeFileSync(file, before);
    const applied = applyTargets(planFor(ENTRY, dir), false, { now: new Date(2026, 0, 2, 3, 4, 5) });
    assert.strictEqual(applied.backup, `${file}.bak.20260102-030405`);
    assert.strictEqual(fs.readFileSync(applied.backup, 'utf8'), before);
    assert.match(report(['x'], { x: planFor(ENTRY, dir) }, { applied }).text, new RegExp(`\\nbackup: ${applied.backup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    // A re-run: nothing to write, nothing copied.
    assert.strictEqual(applyTargets(planFor(ENTRY, dir), false, { now: new Date(2026, 0, 2, 3, 9, 0) }).backup, null);
    assert.deepStrictEqual(baks(dir), ['settings.json.bak.20260102-030405']);
    // A run that already copied it (hud-statusline.js, before its statusLine write) copies nothing more.
    fs.writeFileSync(file, before);
    assert.strictEqual(applyTargets(planFor(ENTRY, dir), false, { done: true }).backup, null);
    assert.deepStrictEqual(baks(dir), ['settings.json.bak.20260102-030405']);
});

test('a backup that cannot be made throws before ANY target is written', () => {
    const dir = tmp();
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'hud' } }));
    const copy = () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
    assert.throws(() => applyTargets(planFor(ENTRY, dir), false, { copy }), (e) => e.backup === true && /could not back up .*settings\.json \(EACCES\)/.test(e.message));
    assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'x', 'config.json')), 'the earlier target is not written either');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine.refreshInterval, undefined);
});

test('CLI --apply: the account settings.json is backed up before the patch and the report names the copy', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'hud' } }));
    const lines = [];
    const log = console.log;
    console.log = (s) => lines.push(String(s));
    let code;
    try { code = main(['--config-dir', dir, '--plugin', 'claude-hud', '--apply']); }
    finally { console.log = log; }
    assert.strictEqual(code, 0);
    assert.strictEqual(baks(dir).length, 1);
    assert.match(lines.join('\n'), /\nbackup: .*settings\.json\.bak\.\d{8}-\d{6}$/);
});

// R134, the I-4 class: a --config-dir that names no directory exits 2 - never a fallback to ~/.claude,
// never a relative dir made of the next flag.
const SCRIPT = path.join(__dirname, 'plugin-settings.js');
for (const [name, args] of [
    ['--config-dir with no value', () => ['--plugin', 'claude-hud', '--apply', '--config-dir']],
    ['--config-dir with an empty value', () => ['--config-dir', '', '--plugin', 'claude-hud', '--apply']],
    ['the --config-dir=<dir> form', (dir) => [`--config-dir=${dir}`, '--plugin', 'claude-hud', '--apply']],
    ['--config-dir followed by another flag', () => ['--config-dir', '--apply', '--plugin', 'claude-hud']],
])
{
    test(`CLI: ${name} exits 2 and writes nothing`, () => {
        const home = tmp();
        const cwd = tmp();
        const target = tmp();
        const r = require('node:child_process').spawnSync(process.execPath, [SCRIPT, ...args(target)], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
        assert.strictEqual(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /^plugin-settings: --config-dir needs a directory, as --config-dir <dir> - nothing written$/m);
        for (const dir of [home, cwd, target]) assert.deepStrictEqual(fs.readdirSync(dir), [], `${dir} stays empty`);
    });
}

// C16 (R135 N-3): an argument the script does not know, a value flag with no value, or a flag given
// twice is refused with ONE line and exit 2 - never read as absent, which applies to ~/.claude or to
// every catalog row.
for (const [name, args, msg] of [
    ['a misspelt --configdir', (dir) => ['--configdir', dir, '--plugin', 'claude-hud', '--apply'], "unknown argument '--configdir'"],
    ['a stray positional', (dir) => ['--config-dir', dir, 'claude-hud', '--apply'], "unknown argument 'claude-hud'"],
    ['the --plugin=<name> form', (dir) => ['--config-dir', dir, '--plugin=claude-hud', '--apply'], "unknown argument '--plugin=claude-hud'"],
    ['--plugin with no value', (dir) => ['--config-dir', dir, '--apply', '--plugin'], '--plugin needs a value'],
    ['--installed followed by another flag', (dir) => ['--config-dir', dir, '--installed', '--apply'], '--installed needs a value'],
    ['--config-dir given twice', (dir) => ['--config-dir', dir, '--config-dir', dir, '--apply'], '--config-dir is given twice'],
])
{
    test(`CLI: ${name} exits 2 with one line and writes nothing`, () => {
        const home = tmp();
        const cwd = tmp();
        const target = tmp();
        const r = require('node:child_process').spawnSync(process.execPath, [SCRIPT, ...args(target)], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
        assert.strictEqual(r.status, 2, r.stdout + r.stderr);
        assert.strictEqual(r.stderr, `plugin-settings: ${msg} - nothing written\n`);
        assert.strictEqual(r.stdout, '');
        for (const dir of [home, cwd, target]) assert.deepStrictEqual(fs.readdirSync(dir), [], `${dir} stays empty`);
    });
}

test('CLI: every flag the walks pass still parses', () => {
    const dir = tmp();
    const lines = [];
    const log = console.log;
    console.log = (s) => lines.push(String(s));
    let code;
    try { code = main(['--catalog', path.join(__dirname, '..', 'meta', 'plugin-settings.json'), '--config-dir', dir, '--installed', 'claude-hud', '--check', '--replace']); }
    finally { console.log = log; }
    assert.strictEqual(code, 0, lines.join('\n'));
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'no --apply, nothing written');
});
