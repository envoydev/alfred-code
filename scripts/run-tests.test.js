'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

// A repo stand-in: the runner and the prelude it requires copied in, four passing test files under scripts/ (one
// nested), and a failing one outside it, as a plan's repo copy under docs/ holds one.
function fixture({ tests = ['a', 'b', 'c', 'nested/d'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-'));
  made.push(root);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'stack', 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'run-tests.js'), path.join(root, 'scripts', 'run-tests.js'));
  for (const file of ['hook-prelude.js', 'layout.js']) fs.copyFileSync(path.join(__dirname, '..', 'stack', 'hooks', file), path.join(root, 'stack', 'hooks', file));
  for (const name of tests) {
    const file = path.join(root, 'scripts', `${name}.test.js`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `require('node:test')('${path.basename(name)} ran', () => {});\n`);
  }
  fs.mkdirSync(path.join(root, 'docs', 'copy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'copy', 'old.test.js'), "require('node:test')('old ran', () => { throw new Error('a copy'); });\n");
  return root;
}

// From another folder, as npm would not: the runner must find its own root. NODE_TEST_CONTEXT is dropped, or the
// child would report to this run's parent instead of printing its own summary.
function run(root, ...args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.js'), '--test-reporter=tap', ...args], { cwd: os.tmpdir(), env, encoding: 'utf8' });
  const ran = [...r.stdout.matchAll(/^ok \d+ - (\w+) ran$/gm)].map(m => m[1]).sort();
  return { status: r.status, ran, out: r.stdout + r.stderr };
}

test('runs every test file under scripts/, nested ones included, and none outside it', () => {
  const r = run(fixture());
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.ran, ['a', 'b', 'c', 'd']);
});

test('a shard flag splits the files - it reaches node before the pattern, where node reads it', () => {
  const root = fixture();
  const one = run(root, '--test-shard=1/2');
  const two = run(root, '--test-shard=2/2');
  assert.equal(one.status, 0, one.out);
  assert.equal(two.status, 0, two.out);
  assert.equal(one.ran.length, 2, one.out);
  assert.equal(two.ran.length, 2, two.out);
  assert.deepEqual([...one.ran, ...two.ran].sort(), ['a', 'b', 'c', 'd']);
});

test('a test path given replaces the default pattern', () => {
  const root = fixture();
  assert.deepEqual(run(root, path.join(root, 'scripts', 'b.test.js')).ran, ['b']);
  assert.deepEqual(run(root, 'scripts/nested/*.test.js').ran, ['d']);
});

test('a failing test fails the run', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'scripts', 'e.test.js'), "require('node:test')('e ran', () => { throw new Error('red'); });\n");
  assert.equal(run(root).status, 1);
});

test('no test file under scripts/ fails the run instead of passing on zero tests', () => {
  const r = run(fixture({ tests: [] }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /no test file/);
  assert.deepEqual(r.ran, []);
});
