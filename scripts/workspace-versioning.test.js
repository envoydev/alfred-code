// Workspace versioning, task 2: ALFRED_CODE_DOCS_VERSIONING reaches a joined child through the one variable loader, and
// only an `ignore env` line (D3) stops it - the join and W1 prunes never remove a child's own value of it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ws = require('./install/workspace.js');
const stampLib = require('./install/stamp.js');
const layout = require('../stack/hooks/layout.js');
const { putWorkspace } = require('./workspace-fixture.js');

const KEY = 'ALFRED_CODE_DOCS_VERSIONING';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-versioning-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ON = { CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };
const hashOf = stampLib.valueHash;

// A root and a joined child, as `workspace.js join` leaves them: the root lists the child, the child names its parent.
const joined = ({ root = `${KEY}=local\n`, child, childStamp = 'sha: x\nmanaged-env: \n' } = {}) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 'j-'));
    const dirs = { root: path.join(top, 'ws'), child: path.join(top, 'ws', 'api') };
    for (const dir of Object.values(dirs))
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
    }
    execFileSync('git', ['init', '-q'], { cwd: dirs.child });
    fs.writeFileSync(path.join(dirs.root, '.claude', 'alfred-code.stamp'), 'sha: x\nmanaged-env: \n');
    fs.writeFileSync(path.join(dirs.child, '.claude', 'alfred-code.stamp'), childStamp);
    putWorkspace(dirs.root, { children: ['api'] });
    putWorkspace(dirs.child, { parent: '..' });
    if (root !== null) fs.writeFileSync(path.join(dirs.root, '.alfred', '.variables'), root);
    if (child !== undefined) fs.writeFileSync(path.join(dirs.child, '.alfred', '.variables'), child);
    return { root: fs.realpathSync.native(dirs.root), child: fs.realpathSync.native(dirs.child) };
};
const varsText = (dir) => fs.readFileSync(path.join(dir, '.alfred', '.variables'), 'utf8');

test('a child reads the root\'s versioning through the loader', () =>
{
    const at = joined();
    assert.strictEqual(layout.variablesOf(at.child, { env: {} }).values[KEY], 'local');
});

test('the layout sets: only the switch is never taken from a member, and the key is never pruned', () =>
{
    assert.deepStrictEqual([...layout.MEMBER_NEVER], ['ALFRED_CODE_WORKSPACE']);
    assert.deepStrictEqual([...layout.CHAIN_PRUNE_NEVER], [KEY]);
});

test('chainValues hands the key on', () =>
{
    const at = joined();
    assert.strictEqual(ws.chainValues(at.child, { env: ON })[KEY], 'local');
    assert.ok(!Object.hasOwn(ws.chainValues(at.child, { env: ON }), 'ALFRED_CODE_WORKSPACE'));
});

test('W1 keeps a typed local equal to the root\'s', () =>
{
    const at = joined({ child: `${KEY}=local\n` });
    const got = ws.pruneChained(at.child, { env: ON, log: () => {} });
    assert.ok(got.own.includes(KEY), JSON.stringify(got));
    assert.ok(!got.dropped.includes(KEY));
    assert.strictEqual(varsText(at.child), `${KEY}=local\n`);
});

test('a join keeps an answered git', () =>
{
    const stamp = `sha: x\nmanaged-env: .variables:${KEY}=${hashOf('git')}\n`;
    const at = joined({ child: `${KEY}=git\n`, childStamp: stamp });
    const got = ws.pruneChained(at.child, { env: ON, log: () => {}, seeds: true });
    assert.ok(got.own.includes(KEY), JSON.stringify(got));
    assert.ok(!got.dropped.includes(KEY));
    assert.strictEqual(varsText(at.child), `${KEY}=git\n`);
    assert.strictEqual(stampLib.readLedger(path.join(at.child, '.claude', 'alfred-code.stamp')).env['.variables'][KEY], hashOf('git'), 'its ledger row stays');
});

test('envPlan never copies or seeds the key', () =>
{
    const planFor = (stampText, settings) =>
    {
        const at = joined({ childStamp: stampText });
        fs.writeFileSync(path.join(at.child, '.claude', 'settings.json'), JSON.stringify({ env: settings }));
        const ledger = stampLib.readLedger(path.join(at.child, '.claude', 'alfred-code.stamp'));
        return ws.envPlan({ workspace: { on: true, members: ws.chain(at.child, { env: ON }).members, ignores: [] }, args: { action: 'update', scope: 'project' },
            projectRoot: at.child, env: ON, claudeDir: path.join(at.child, '.claude'), ledger });
    };
    const rows = `settings.json:${KEY}=${hashOf('local')},settings.json:ALFRED_CODE_HISTORY=${hashOf('5')}`;
    const copies = planFor(`sha: x\nmanaged-env: ${rows}\nown-env: \n`, { [KEY]: 'local' });
    assert.ok(!copies.copies.includes(KEY) && !copies.seeds.includes(KEY), JSON.stringify(copies));
    const seeded = planFor(`sha: x\nmanaged-env: settings.json:${KEY}=${hashOf('git')}\njoin-prune: settings\n`, { [KEY]: 'git' });
    assert.ok(!seeded.copies.includes(KEY) && !seeded.seeds.includes(KEY), JSON.stringify(seeded));
});

test('ignore env stops it', () =>
{
    const at = joined();
    putWorkspace(at.child, { parent: '..', ignore: { env: [KEY] } });
    assert.strictEqual(layout.variablesOf(at.child, { env: {} }).values[KEY], undefined);
    assert.ok(!Object.hasOwn(ws.chainValues(at.child, { env: ON }), KEY));
});

test('keepOnLeave writes the inherited value', () =>
{
    const at = joined();
    const got = ws.keepOnLeave(at.child, { env: ON, log: () => {} });
    assert.ok(got.written.includes(KEY), JSON.stringify(got));
    assert.match(varsText(at.child), new RegExp(`^${KEY}=local$`, 'm'));
});
