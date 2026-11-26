'use strict';
// The keyed rows of a settings file (install/settings-keys.js): the stack's keys of `skillOverrides`, ledgered one row a key.
// Real files in a temp folder; no installer run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const keys = require('./install/settings-keys.js');
const settings = require('./install/settings.js');
const stamp = require('./install/stamp.js');
const { createReport } = require('./install/report.js');
const { realLong } = require('./test-paths.js');

const OBJECT = 'skillOverrides';
const OFF = 'off';
const ON = 'on';
const sandbox = () => realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-keys-')));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sync = (file, want, prior = {}, extra = {}) => keys.syncKeys({ file, objectPath: OBJECT, want, prior, ...extra });
const rowOf = (key) => keys.keyRow(OBJECT, key);
const offHash = stamp.valueHash(JSON.stringify(OFF));
const onHash = stamp.valueHash(JSON.stringify(ON));

function inSandbox(body)
{
    const dir = sandbox();
    try { return body(dir, path.join(dir, 'settings.local.json')); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('syncKeys adds a wanted key, ledgers it at the hash of "off", and creates the file', () => inSandbox((dir, file) =>
{
    const got = sync(file, { 'api:npm': OFF });
    assert.deepStrictEqual(read(file), { skillOverrides: { 'api:npm': OFF } });
    assert.deepStrictEqual(got.rows, { [rowOf('api:npm')]: offHash });
    assert.ok(got.changed && got.created);
}));

test('syncKeys leaves a key of the user\'s that has no row, and claims no row for it', () => inSandbox((dir, file) =>
{
    fs.writeFileSync(file, JSON.stringify({ skillOverrides: { 'api:npm': 'on', other: 'off' } }));
    const got = sync(file, { 'api:npm': OFF });
    assert.deepStrictEqual(read(file).skillOverrides, { 'api:npm': 'on', other: 'off' });
    assert.deepStrictEqual(got.rows, {});
    assert.strictEqual(got.changed, false);
}));

test('syncKeys removes its own key once it is no longer wanted, and the emptied object with it', () => inSandbox((dir, file) =>
{
    const first = sync(file, { 'api:npm': OFF });
    const report = createReport();
    const got = sync(file, {}, first.rows, { report });
    assert.deepStrictEqual(read(file), {}, 'the object left with its last key');
    assert.deepStrictEqual(got.rows, {});
    assert.ok(got.changed);
    assert.deepStrictEqual(report.names('removed'), ['skillOverrides api:npm']);
}));

test('syncKeys keeps the user\'s other keys when it removes its own, and the object stays', () => inSandbox((dir, file) =>
{
    fs.writeFileSync(file, JSON.stringify({ skillOverrides: { mine: 'off' }, other: 1 }));
    const first = sync(file, { 'api:npm': OFF }, {});
    sync(file, {}, first.rows);
    assert.deepStrictEqual(read(file), { skillOverrides: { mine: 'off' }, other: 1 });
}));

test('syncKeys keeps a key the user set to "on" and drops its row, wanted or not', () => inSandbox((dir, file) =>
{
    for (const wanted of [{}, { 'api:npm': OFF }])
    {
        const first = sync(file, { 'api:npm': OFF });
        const data = read(file);
        data.skillOverrides['api:npm'] = 'on';
        fs.writeFileSync(file, JSON.stringify(data));
        const got = sync(file, wanted, first.rows);
        assert.strictEqual(read(file).skillOverrides['api:npm'], 'on');
        assert.deepStrictEqual(got.rows, {}, 'the row is dropped: the value is the user\'s now');
        fs.rmSync(file);
    }
}));

test('syncKeys rewrites a key it owns when the wanted value changes, and the row follows', () => inSandbox((dir, file) =>
{
    const first = sync(file, { 'api:npm': OFF });
    const toOn = sync(file, { 'api:npm': ON }, first.rows);
    assert.strictEqual(read(file).skillOverrides['api:npm'], ON);
    assert.deepStrictEqual(toOn.rows, { [rowOf('api:npm')]: onHash });
    assert.ok(toOn.changed);
    const back = sync(file, { 'api:npm': OFF }, toOn.rows);
    assert.strictEqual(read(file).skillOverrides['api:npm'], OFF);
    assert.deepStrictEqual(back.rows, { [rowOf('api:npm')]: offHash });
    const bytes = fs.readFileSync(file);
    assert.strictEqual(sync(file, { 'api:npm': OFF }, back.rows).changed, false, 'a second run with the same want writes nothing');
    assert.ok(fs.readFileSync(file).equals(bytes));
}));

test('syncKeys leaves a key whose value the user changed, and drops its row, though the wanted value differs', () => inSandbox((dir, file) =>
{
    const first = sync(file, { 'api:npm': OFF });
    const data = read(file);
    data.skillOverrides['api:npm'] = ON;
    fs.writeFileSync(file, JSON.stringify(data));
    const before = fs.readFileSync(file);
    const got = sync(file, { 'api:npm': OFF }, first.rows);
    assert.ok(fs.readFileSync(file).equals(before), 'the file is untouched');
    assert.deepStrictEqual(got.rows, {}, 'the row is dropped');
}));

test('syncKeys lets a row whose key is gone just leave, and writes nothing', () => inSandbox((dir, file) =>
{
    const first = sync(file, { 'api:npm': OFF });
    fs.writeFileSync(file, '{}\n');
    const before = fs.readFileSync(file);
    const got = sync(file, {}, first.rows);
    assert.deepStrictEqual(got.rows, {});
    assert.ok(fs.readFileSync(file).equals(before), 'the file is byte for byte as it was');
}));

test('syncKeys is idempotent: a second run with the same want changes nothing and keeps the rows', () => inSandbox((dir, file) =>
{
    const first = sync(file, { 'api:npm': OFF, 'web:npm': OFF });
    const bytes = fs.readFileSync(file);
    const second = sync(file, { 'api:npm': OFF, 'web:npm': OFF }, first.rows);
    assert.strictEqual(second.changed, false);
    assert.deepStrictEqual(second.rows, first.rows);
    assert.ok(fs.readFileSync(file).equals(bytes));
}));

test('syncKeys refuses a skillOverrides that is no object, a file that is not JSON, and keeps the rows as recorded', () => inSandbox((dir, file) =>
{
    const notes = [];
    const prior = { [rowOf('api:npm')]: offHash };
    fs.writeFileSync(file, '{"skillOverrides": ["x"]}');
    const listed = sync(file, { 'api:npm': OFF }, prior, { note: (m) => notes.push(m) });
    assert.ok(listed.refused);
    assert.deepStrictEqual(listed.rows, prior);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"skillOverrides": ["x"]}');
    fs.writeFileSync(file, '{ not json');
    const garbage = sync(file, { 'api:npm': OFF }, prior, { note: (m) => notes.push(m) });
    assert.ok(garbage.refused);
    assert.deepStrictEqual(garbage.rows, prior);
    assert.strictEqual(notes.length, 2, notes.join('\n'));
    assert.match(notes[0], /skillOverrides is not an object/);
}));

test('syncKeys keeps the file\'s BOM, line ends and indent', () => inSandbox((dir, file) =>
{
    fs.writeFileSync(file, '\uFEFF{\r\n    "other": 1\r\n}\r\n');
    sync(file, { 'api:npm': OFF });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '\uFEFF{\r\n    "other": 1,\r\n    "skillOverrides": {\r\n        "api:npm": "off"\r\n    }\r\n}\r\n');
}));

test('a key row survives the stamp ledger: readLedger reads it and settingsLine writes it back as it was', () => inSandbox((dir) =>
{
    const row = rowOf('api:npm');
    const stampFile = path.join(dir, 'alfred-code.stamp');
    fs.writeFileSync(stampFile, `managed-env: \nmanaged-settings: settings.local.json:${row}=${offHash}\n`);
    const ledger = stamp.readLedger(stampFile);
    assert.deepStrictEqual(ledger.settings, { 'settings.local.json': { [row]: offHash } });
    assert.strictEqual(stamp.settingsLine(ledger.settings), `settings.local.json:${row}=${offHash}`);
}));

test('carryMemberRows carries a key row while its key holds the stack\'s value, and drops it once the file or the value changed', () => inSandbox((claudeDir) =>
{
    const file = path.join(claudeDir, 'settings.local.json');
    const rows = sync(file, { 'api:npm': OFF }).rows;
    const priorSettings = { 'settings.local.json': rows };
    assert.deepStrictEqual(settings.carryMemberRows({ claudeDir, priorSettings }), { 'settings.local.json': rows });
    fs.writeFileSync(file, JSON.stringify({ skillOverrides: { 'api:npm': 'on' } }));
    assert.deepStrictEqual(settings.carryMemberRows({ claudeDir, priorSettings }), {});
    fs.writeFileSync(file, '{ not json');
    assert.deepStrictEqual(settings.carryMemberRows({ claudeDir, priorSettings }), { 'settings.local.json': rows }, 'a file that cannot be read keeps what the ledger named');
}));

test('uninstall takes its own key out, keeps one the user changed, and removes the emptied object', () => inSandbox((claudeDir) =>
{
    const file = path.join(claudeDir, 'settings.local.json');
    const rows = sync(file, { 'api:npm': OFF, 'web:npm': OFF }).rows;
    const data = read(file);
    data.skillOverrides['web:npm'] = 'on';
    data.other = 1;
    fs.writeFileSync(file, JSON.stringify(data));
    const lines = [];
    const removed = settings.removeManagedSettings({ claudeDir, ledger: { settings: { 'settings.local.json': rows } }, log: (m) => lines.push(m) });
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual(read(file), { skillOverrides: { 'web:npm': 'on' }, other: 1 });
    assert.ok(lines.some((m) => /skillOverrides\{[0-9a-f]{64}\} kept - changed since the stack wrote it/.test(m)), lines.join('\n'));
    fs.writeFileSync(file, JSON.stringify({ skillOverrides: { 'api:npm': OFF }, other: 1 }));
    settings.removeManagedSettings({ claudeDir, ledger: { settings: { 'settings.local.json': { [rowOf('api:npm')]: offHash } } } });
    assert.deepStrictEqual(read(file), { other: 1 }, 'the emptied object left with its key');
}));

test('the root\'s refresh of a project below re-renders that project\'s ledger line with its key row as it was', () => inSandbox((root) =>
{
    const wsLib = require('./install/workspace.js');
    const { putWorkspace } = require('./workspace-fixture.js');
    const mid = path.join(root, 'mid');
    const row = rowOf('grand:npm');
    for (const dir of [root, mid]) fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'seats-route: plugin\nown-picks: \n');
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'rules', 'alfred-awareness.md'), '# awareness\n');   // a generated rule: the child gets an exclude row for it
    fs.writeFileSync(path.join(mid, '.claude', 'alfred-code.stamp'), `seats-route: plugin\nmanaged-env: \nmanaged-settings: settings.local.json:${row}=${offHash}\n`);
    fs.writeFileSync(path.join(mid, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'grand:npm': OFF } }));
    putWorkspace(root, { children: ['mid'], includedChildren: ['mid'], includeAsked: ['mid'] });
    putWorkspace(mid, { parent: '..' });
    const got = wsLib.refreshBelow({ projectRoot: root, env: { CLAUDE_CONFIG_DIR: path.join(root, 'acct'), ALFRED_CODE_WORKSPACE: '1' } });
    assert.deepStrictEqual(got.refreshed, ['mid'], JSON.stringify(got));
    const ledger = stamp.readLedger(path.join(mid, '.claude', 'alfred-code.stamp')).settings['settings.local.json'];
    assert.strictEqual(ledger[row], offHash, 'the key row is carried');
    assert.ok(Object.keys(ledger).some((name) => name.startsWith('claudeMdExcludes[')), 'beside the exclude rows the refresh wrote');
    assert.deepStrictEqual(read(path.join(mid, '.claude', 'settings.local.json')).skillOverrides, { 'grand:npm': OFF });
}));
