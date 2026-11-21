#!/usr/bin/env node
// Final-review suite for the pure judges of stack/hooks/guard-data-class.js. Runs with `npm test` (node --test).
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { realLong } = require('./test-paths');

const judges = require(path.join('..', 'stack', 'hooks', 'guard-data-class.js'));
const { piiCounts, dumpVerdict, documentVerdict, codeLines, globMatch, pathState, parseSensitivePaths, relativizeTokens, judgeCall } = judges;

const lines = (values) => values.join('\n');

function luhnComplete(prefix) {
  for (let check = 0; check < 10; check++) {
    const digits = prefix + check;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return digits;
  }
  throw new Error('no check digit');
}

test('D3: 300 epoch-ms values in a log are no cards and no dump', () => {
  const stamps = Array.from({ length: 300 }, (_, i) => String(1700000000000 + i * 7919));
  assert.equal(piiCounts(lines(stamps)).cards, 0);
  assert.equal(dumpVerdict({ base: 'app.log', ext: '.log', bytes: 5000, tracked: false, head: lines(stamps) }), null);
});

test('D3: an all-zero spaced run is no card, a Luhn number opening with 2 to 6 is', () => {
  assert.equal(piiCounts('0000 0000 0000 0000').cards, 0);
  for (const first of ['2', '3', '4', '5', '6']) assert.equal(piiCounts('card ' + luhnComplete(first + '12345678901234') + ' ok').cards, 1, first);
  for (const first of ['0', '1', '7', '8', '9']) assert.equal(piiCounts('card ' + luhnComplete(first + '12345678901234') + ' ok').cards, 0, first);
});

test('E1: an absolute path inside a root becomes repo-relative, one outside is dropped', () => {
  assert.deepEqual(relativizeTokens(['/r/src/a.js', '/elsewhere/b.js', 'src/c.js'], ['/r']).tokens, ['src/a.js', 'src/c.js']);
  assert.deepEqual(relativizeTokens(['/r/src/a.js'], ['/x', '/r']).tokens, ['src/a.js']);
  assert.deepEqual(relativizeTokens(['/r'], ['/r']).tokens, []);
  assert.deepEqual(relativizeTokens(['/rr/a.js'], ['/r']).tokens, []);
  assert.deepEqual(relativizeTokens(['/r/src/a.js'], []).tokens, []);
});

test('E1: a Windows absolute path is read with win32 rules on every OS', () => {
  assert.deepEqual(relativizeTokens(['C:\\proj\\src\\a.js'], ['C:\\proj']).tokens, ['src/a.js']);
  assert.deepEqual(relativizeTokens(['C:/proj/src/a.js', 'c:\\PROJ\\lib\\b.ts'], ['C:\\proj']).tokens, ['src/a.js', 'lib/b.ts']);
  assert.deepEqual(relativizeTokens(['D:\\proj\\src\\a.js', 'C:\\other\\a.js'], ['C:\\proj']).tokens, []);
  assert.deepEqual(relativizeTokens(['C:\\proj\\src\\a.js'], ['/r']).tokens, []);
  assert.deepEqual(relativizeTokens(['src\\a.js'], ['C:\\proj']).tokens, ['src\\a.js']);
});

test('E1: the spelling of a mapped token is kept so the brief can drop it', () => {
  assert.deepEqual(relativizeTokens(['/r/src/a.js'], ['/r']).aliases, [{ token: '/r/src/a.js', rel: 'src/a.js' }]);
});

test('E3: spaced-out code keeps its count, as it did before the review', () => {
  const guards = 'if (user === null) {\n  return\n}\nitems.forEach((item) => {\n  run(item)\n})';
  const arrows = 'const add = (a, b) => a + b\nconst sub = (a, b) => a - b\nconst mul = (a, b) => a * b';
  const props = 'public int Id { get; set; }\npublic string Name { get; set; }\npublic int Age { get; set; }';
  assert.equal(codeLines(guards), 4);
  assert.equal(codeLines(arrows), 3);
  assert.equal(codeLines(props), 3);
});

test('documentVerdict: an untracked .key is no business document', () => {
  assert.equal(documentVerdict({ ext: '.key', tracked: false, listed: false }), null);
  assert.equal(documentVerdict({ ext: '.pptx', tracked: false, listed: false }).branch, 'document-untracked');
});

test('globMatch: a glob with no slash matches the basename at any depth, one with a slash stays anchored', () => {
  assert.equal(globMatch('*.csv', 'x.csv'), true);
  assert.equal(globMatch('*.csv', 'a/b/x.csv'), true);
  assert.equal(globMatch('prices.xlsx', 'deep/er/prices.xlsx'), true);
  assert.equal(globMatch('prices.xlsx', 'deep/xprices.xlsx'), false);
  assert.equal(globMatch('data/*.csv', 'data/a.csv'), true);
  assert.equal(globMatch('data/*.csv', 'x/data/a.csv'), false);
  assert.equal(globMatch('data/*.csv', 'data/sub/a.csv'), false);
});

test('pathState: a bare glob lists and clears at any depth', () => {
  const lists = parseSensitivePaths('*.csv\n!keep.csv');
  assert.equal(pathState('a/b/x.csv', lists), 'listed');
  assert.equal(pathState('a/b/keep.csv', lists), 'cleared');
  assert.equal(pathState('a/b/x.txt', lists), null);
});

test('judgeCall asks who answers only when a Read verdict needs the choice, never on a query', () => {
  const dir = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'data-class-lazy-')));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'orders.csv'), Buffer.alloc(200 * 1024, 'a'));
    fs.writeFileSync(path.join(dir, 'notes.js'), 'x');
    let asked = 0;
    const prelude = { partOff: () => false, unattended: () => (asked++, false) };
    const ctx = (payload) => ({ prelude, root: dir, payload: { cwd: dir, ...payload } });
    assert.equal(judgeCall(ctx({ tool_name: 'WebSearch', tool_input: { query: 'node 22 fs.rmSync recursive' } })), null);
    assert.equal(judgeCall(ctx({ tool_name: 'Read', tool_input: { file_path: path.join(dir, 'notes.js') } })), null);
    assert.equal(asked, 0);
    assert.equal(judgeCall(ctx({ tool_name: 'Read', tool_input: { file_path: path.join(dir, 'orders.csv') } })).mode, 'ask');
    assert.equal(asked, 1);
    prelude.unattended = () => true;
    assert.equal(judgeCall(ctx({ tool_name: 'Read', tool_input: { file_path: path.join(dir, 'orders.csv') } })).mode, 'deny');
    assert.equal(judgeCall(ctx({ permission_mode: 'dontAsk', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'orders.csv') } })).mode, 'deny');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
