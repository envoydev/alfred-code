'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { composeProject, composeDown } = require('./compose.js');

const FAKE_DOCKER = path.join(__dirname, '..', 'test', 'fake-docker.js');
const CELL = { run: 'b4-pilot-4', arm: 'ours', task: 'data-02-loans-cursor-feed', rep: 2 };

function scratch(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-compose-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

const rows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('each cell gets its own compose project, the same one every time it is asked', () =>
{
    const name = composeProject(CELL);
    assert.match(name, /^[a-z0-9][a-z0-9_-]*$/, 'a name compose accepts');
    assert.strictEqual(composeProject({ ...CELL }), name, 'a resumed cell tears down what its killed attempt left');
    const others = [{ run: 'b4-pilot-4-flow' }, { arm: 'ecc' }, { task: 'api-03-member-notices' }, { rep: 1 }].map((d) => composeProject({ ...CELL, ...d }));
    assert.strictEqual(new Set([name, ...others]).size, 5, 'no two cells share a project');
});

test('the project name names neither the benchmark nor the arm: the session reads it in docker ps', () =>
{
    const name = composeProject(CELL);
    for (const word of ['ours', 'ecc', 'bare', 'bench', 'pilot', 'data-02']) assert.ok(!name.includes(word), `${name} names ${word}`);
});

test('the teardown takes down exactly the cell\'s project, volumes included, from the dir it is given', (t) =>
{
    const dir = scratch(t);
    const record = path.join(dir, 'docker.jsonl');
    const out = composeDown({ project: 'cell-0123456789ab', env: { PATH: process.env.PATH }, cwd: dir, docker: [process.execPath, FAKE_DOCKER, '--record', record] });
    assert.deepStrictEqual(out, { exit: 0, error: null });
    const [seen] = rows(record);
    assert.deepStrictEqual(seen.argv, ['compose', '-p', 'cell-0123456789ab', 'down', '-v']);
    assert.strictEqual(fs.realpathSync(seen.cwd), fs.realpathSync(dir));
});

test('a teardown that fails, or finds no docker, is recorded and never thrown', (t) =>
{
    const dir = scratch(t);
    const record = path.join(dir, 'docker.jsonl');
    assert.deepStrictEqual(composeDown({ project: 'cell-0123456789ab', env: { PATH: process.env.PATH }, cwd: dir, docker: [process.execPath, FAKE_DOCKER, '--record', record, '--exit', '3'] }), { exit: 3, error: null });
    const missing = composeDown({ project: 'cell-0123456789ab', env: { PATH: process.env.PATH }, cwd: dir, docker: [path.join(dir, 'no-docker-here')] });
    assert.strictEqual(missing.exit, null);
    assert.strictEqual(missing.error, 'ENOENT');
});

test('a name compose would not read as one project is refused before docker runs', (t) =>
{
    const dir = scratch(t);
    const record = path.join(dir, 'docker.jsonl');
    for (const bad of ['', 'Cell-A', '-p', 'a b', 'repo --all', undefined])
    {
        assert.throws(() => composeDown({ project: bad, env: {}, cwd: dir, docker: [process.execPath, FAKE_DOCKER, '--record', record] }), /is not a compose project name/);
    }
    assert.ok(!fs.existsSync(record), 'docker never ran');
});
