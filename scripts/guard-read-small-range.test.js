#!/usr/bin/env node
// Behavior tests for B9 of the session-audit fixes in guard-read-whole-file.js: a range of 40 lines or fewer passes the
// cumulative range cap, and a harness tool-result file is not a whole-file read of project code. Both directions are
// pinned: the 41st line and an ordinary project file with no range still meet the guard as before.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { legacyBlock } = require('./hook-test-env');

const READ = path.join(__dirname, '..', 'stack', 'hooks', 'guard-read-whole-file.js');
const { realLong } = require('./test-paths');
const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-small-range-')));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
process.env.ALFRED_CODE_DOCS_PATH = path.join(TMP, 'ledger');
const ROOT = process.env.CLAUDE_PROJECT_DIR;

const run = (payload, env) => legacyBlock(spawnSync(process.execPath, [READ], { input: JSON.stringify(payload), encoding: 'utf8', cwd: ROOT, env: { ...process.env, ...env } }));
const linesOf = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n';
const sid = () => `sr-${Math.random().toString(36).slice(2)}`;
const readAt = (file, offset, limit, session_id) => run({ tool_name: 'Read', tool_input: { file_path: file, offset, limit }, session_id });
const shellAt = (command, session_id) => run({ tool_name: 'Bash', tool_input: { command }, session_id, cwd: ROOT });
const fileOf = (name, lineCount) => { const f = path.join(fs.mkdtempSync(path.join(TMP, 'f-')), name); fs.writeFileSync(f, linesOf(lineCount)); return f; };

test('a Read range of 40 lines passes the range cap past 60% of the file, and 41 lines still meets it', () => {
  const f = fileOf('OrderService.ts', 500);
  const s = sid();
  assert.equal(readAt(f, 1, 300, s).status, 0, 'a first range of 60% fills the cap');
  assert.equal(readAt(f, 301, 40, s).status, 0, 'a 40-line range past the cap passes');
  const s41 = sid();
  assert.equal(readAt(f, 1, 300, s41).status, 0);
  assert.equal(readAt(f, 301, 41, s41).status, 2, 'a 41-line range past the cap is still capped');
});

test('a shell span of 40 lines passes the range cap on a 427-line file, and 41 lines still meets it', () => {
  const f = fileOf('Large.ts', 427);
  const s = sid();
  assert.equal(shellAt(`sed -n 1,250p ${f}`, s).status, 0, 'the first span (59%)');
  assert.equal(shellAt(`sed -n 293,300p ${f}`, s).status, 0, 'an 8-line span past the cap passes');
  assert.equal(shellAt(`sed -n 261,300p ${f}`, s).status, 0, 'a 40-line span passes');
  const s41 = sid();
  assert.equal(shellAt(`sed -n 1,250p ${f}`, s41).status, 0);
  assert.equal(shellAt(`sed -n 260,300p ${f}`, s41).status, 2, 'a 41-line span past the cap is capped');
});

test('a 300-line range of a 427-line file and a Read with no range keep the cap and the whole-file guard', () => {
  const f = fileOf('Large.ts', 427);
  assert.equal(readAt(f, 1, 300, sid()).status, 2, '300 of 427 lines is 70%');
  assert.equal(run({ tool_name: 'Read', tool_input: { file_path: f }, session_id: sid() }).status, 2, 'an ordinary file read whole');
});

test('a Read of a harness tool-result file passes whole, and the same file in a project still blocks', () => {
  const config = fs.mkdtempSync(path.join(TMP, 'config-'));
  const dir = path.join(config, 'projects', '-Users-x-acme-app', 'session-1', 'tool-results');
  fs.mkdirSync(dir, { recursive: true });
  const big = 'x'.repeat(100) + '\n';
  const env = { CLAUDE_CONFIG_DIR: config };
  const spill = path.join(dir, 'b07kh384x.txt'); fs.writeFileSync(spill, big.repeat(1000));
  const source = path.join(dir, 'dump.js'); fs.writeFileSync(source, linesOf(500));
  const control = path.join(fs.mkdtempSync(path.join(TMP, 'f-')), 'b07kh384x.txt'); fs.writeFileSync(control, big.repeat(1000));
  const whole = (file_path) => run({ tool_name: 'Read', tool_input: { file_path }, session_id: sid() }, env).status;
  assert.equal(whole(spill), 0, 'a spilled tool result read whole');
  assert.equal(whole(source), 0, 'a gated extension under tool-results too');
  assert.equal(whole(control), 2, 'the same bytes in a project folder are the whole-file read the guard blocks');
  const elsewhere = path.join(config, 'other', 'acme-app', 'session-1', 'tool-results'); fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, 'a.txt'), big.repeat(1000));
  assert.equal(whole(path.join(elsewhere, 'a.txt')), 2, 'a tool-results folder outside projects/<project>/<session>/ is not the harness one');
  assert.equal(whole(`${dir}/../../../../other/acme-app/session-1/tool-results/a.txt`), 2, 'a raw dot-dot path out of the harness folder is judged by where it lands');
  if (process.platform !== 'win32') {
    const link = path.join(dir, 'link.txt'); fs.symlinkSync(control, link);
    assert.equal(whole(link), 2, 'a link from tool-results out to a project file is judged by its target');
  }
});

test('a Read of a session task output file passes whole', () => {
  const dir = path.join(TMP, 'claude-501', '-Users-x-acme-app', 'session-1', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const big = 'x'.repeat(100) + '\n';
  const out = path.join(dir, 'a003606dfd219cd71.output'); fs.writeFileSync(out, big.repeat(1000));
  const notOutput = path.join(dir, 'notes.txt'); fs.writeFileSync(notOutput, big.repeat(1000));
  const whole = (file_path) => run({ tool_name: 'Read', tool_input: { file_path }, session_id: sid() }).status;
  assert.equal(whole(out), 0, 'a task output file');
  assert.equal(whole(notOutput), 2, 'another file in the same folder is not one');
});
