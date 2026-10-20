'use strict';
// stack/hooks/layout.js - the one home of the 2.8.0 layout: the state, statistics and work paths, the
// pre-2.8.0 ones a reader still falls back to for the 2.x line, and the move map the installer applies.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LAYOUT = path.join(__dirname, '..', 'stack', 'hooks', 'layout.js');
const layout = require(LAYOUT);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-layout-'));
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('dataRoot defaults to .alfred, normalizes the value and reads an empty one as unset', () =>
{
    assert.strictEqual(layout.dataRoot({}), '.alfred');
    assert.strictEqual(layout.dataRoot({ ALFRED_CODE_DATA_PATH: './x\\y/' }), 'x/y');
    assert.strictEqual(layout.dataRoot({ ALFRED_CODE_DATA_PATH: '' }), '.alfred');
});

test('docsRoot defaults to .alfred/docs', () =>
{
    assert.strictEqual(layout.docsRoot({}), '.alfred/docs');
    assert.strictEqual(layout.docsRoot({ ALFRED_CODE_DOCS_PATH: 'docs' }), 'docs');
});

test('flowKind sorts a receipt into approvals and everything else into sessions', () =>
{
    for (const name of ['APPROVAL', 'COMMIT-GATE', 'PUSH-GATE', 'SECRET-READ-ALLOW', 'STAGED-SCAN-ALLOW', 'CROSS-WRITE-ALLOW'])
        assert.strictEqual(layout.flowKind(name), 'approvals', name);
    for (const name of ['turn-check-abc', 'compact-points.json', 'COMPACT-STATE', 'trivial-x', 'untracked-at-start-0a1b2c', 'monitor-1.json'])
        assert.strictEqual(layout.flowKind(name), 'sessions', name);
});

test('statePath and statsPath sit under the data root', () =>
{
    const env = {};
    assert.strictEqual(layout.statePath('/p', 'approvals', 'APPROVAL', env), path.resolve('/p', '.alfred', 'state', 'approvals', 'APPROVAL'));
    assert.strictEqual(layout.statePath('/p', 'history', 's.json', env), path.resolve('/p', '.alfred', 'state', 'history', 's.json'));
    assert.strictEqual(layout.statsPath('/p', ['hook-blocks', 's.jsonl'], env), path.resolve('/p', '.alfred', 'statistics', 'hook-blocks', 's.jsonl'));
});

test('the legacy paths are the pre-2.8.0 ones under the docs root', () =>
{
    const env = {};
    assert.strictEqual(layout.legacyStatePath('/p', 'approvals', 'APPROVAL', env), path.resolve('/p', '.alfred/docs', 'flow', 'APPROVAL'));
    assert.strictEqual(layout.legacyStatePath('/p', 'sessions', 'COMPACT-STATE', env), path.resolve('/p', '.alfred/docs', 'flow', 'COMPACT-STATE'));
    assert.strictEqual(layout.legacyStatePath('/p', 'history', 's.json', env), path.resolve('/p', '.alfred/docs', 'history', 's.json'));
    assert.strictEqual(layout.legacyStatsPath('/p', ['docs-log.jsonl'], env), path.resolve('/p', '.alfred/docs', 'docs-log.jsonl'));
});

test('findState reads the new path first, the legacy one second, and names the new one when neither exists', () =>
{
    const root = tmp();
    const env = {};
    const fresh = layout.statePath(root, 'approvals', 'APPROVAL', env);
    const legacy = layout.legacyStatePath(root, 'approvals', 'APPROVAL', env);
    assert.strictEqual(layout.findState(root, 'approvals', 'APPROVAL', env), fresh, 'neither exists');
    put(legacy);
    assert.strictEqual(layout.findState(root, 'approvals', 'APPROVAL', env), legacy, 'only the legacy one exists');
    put(fresh);
    assert.strictEqual(layout.findState(root, 'approvals', 'APPROVAL', env), fresh, 'both exist');
    fs.rmSync(root, { recursive: true, force: true });
});

test('findStats falls back the same way', () =>
{
    const root = tmp();
    const env = {};
    put(layout.legacyStatsPath(root, ['docs-log.jsonl'], env));
    assert.strictEqual(layout.findStats(root, ['docs-log.jsonl'], env), layout.legacyStatsPath(root, ['docs-log.jsonl'], env));
    fs.rmSync(root, { recursive: true, force: true });
});

test('planDirs lists work/plans first, the legacy plans/ second', () =>
{
    assert.deepStrictEqual(layout.planDirs('/p', {}), [path.resolve('/p', '.alfred/docs', 'work', 'plans'), path.resolve('/p', '.alfred/docs', 'plans')]);
});

test('LAYOUT_MOVES is the spec\'s move map, frozen', () =>
{
    const froms = layout.LAYOUT_MOVES.map((m) => m.from).sort();
    assert.deepStrictEqual(froms, ['.branches', 'cross-project-tasks', 'diagnoses', 'docs-log.jsonl', 'flow', 'history', 'hook-blocks', 'loops', 'plans', 'related-context', 'specs', 'test-coverage', 'tools-usage', 'usage-report']);
    assert.ok(Object.isFrozen(layout.LAYOUT_MOVES));
    const by = Object.fromEntries(layout.LAYOUT_MOVES.map((m) => [m.from, m]));
    assert.strictEqual(by.flow.split, 'flow');
    assert.deepStrictEqual([by.history.base, by.history.to], ['data', 'state/history']);
    assert.deepStrictEqual([by['related-context'].base, by['related-context'].to], ['docs', 'work/cross-project-tasks']);
    assert.deepStrictEqual([by['test-coverage'].base, by['test-coverage'].to], ['docs', 'quality/test-coverage']);
    assert.strictEqual(by['.branches'].removeIfEmpty, true);
});

test('the module loads with nothing beside it', () =>
{
    const dir = tmp();
    fs.copyFileSync(LAYOUT, path.join(dir, 'layout.js'));
    const loaded = require(path.join(dir, 'layout.js'));
    assert.strictEqual(typeof loaded.findState, 'function');
    fs.rmSync(dir, { recursive: true, force: true });
});
