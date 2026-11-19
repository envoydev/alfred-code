// scripts/docs-session-roots.test.js - which checkout another session's recorded writes belong to.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { otherSessionWrites, pathsUnder } = require('../stack/hooks/docs-session.js');

const rootKeyOf = (dir) => { const key = path.resolve(dir).split(path.sep).join('/'); return process.platform === 'win32' ? key.toLowerCase() : key; };

test('pathsUnder keeps the paths under the checkout, spelled from it, and folds case only when asked', () => {
  assert.deepStrictEqual(pathsUnder(['child/src/Api.cs', 'childish/a.cs', 'other/b.cs'], 'child', false), ['src/Api.cs']);
  assert.deepStrictEqual(pathsUnder(['Child/src/Api.cs'], 'child', true), ['src/Api.cs']);
  assert.deepStrictEqual(pathsUnder(['Child/src/Api.cs'], 'child', false), []);
});

// 2026-11-17, two recorded sessions: a session rooted at the workspace folder above a checkout edited a file in it, and a
// session rooted at that checkout was asked 'you changed <file>' at its Stop - the claim matched only an identical root.
test('a write another session recorded from a folder above this checkout is that session\'s, spelled from this checkout', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-roots-'));
  const checkout = path.join(workspace, 'child');
  const claimFile = path.join(os.tmpdir(), `docs-session-roots-${process.pid}--main.session.json`);
  try {
    fs.writeFileSync(claimFile, JSON.stringify({ root: rootKeyOf(workspace), wrote: ['child/src/Api.cs', 'other/src/Web.cs', 'childish/a.cs'] }));
    const claimed = otherSessionWrites(`docs-roots-mine-${process.pid}`, checkout, Date.now() / 1000 - 60);
    assert.ok(claimed.has('src/Api.cs'), 'the parent-rooted write under this checkout is claimed');
    assert.ok(!claimed.has('src/Web.cs') && !claimed.has('a.cs'), 'a sibling checkout and a name sharing only a prefix claim nothing');
  } finally {
    fs.rmSync(claimFile, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
