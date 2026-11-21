#!/usr/bin/env node
// Payload suite for stack/hooks/guard-data-class.js: a JSON payload on stdin through the real file. Runs with `npm test`.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { realLong } = require('./test-paths');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-data-class.js');
const BIG = 200 * 1024;
const SESSION = 'suite';
const made = [];
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (dir, ...argv) => assert.equal(spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...argv], { cwd: dir, encoding: 'utf8' }).status, 0);
function project(files = {}) {
  const dir = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'data-class-')));
  made.push(dir);
  git(dir, 'init', '-q');
  put(dir, '.claude/alfred-code.stamp', 'installed');
  for (const [name, content] of Object.entries(files)) put(dir, name, content);
  return dir;
}
function put(dir, name, content) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}
function run(dir, payload, env = {}) {
  const full = { tool_input: {}, session_id: SESSION, cwd: dir, ...payload };
  const base = { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env };
  delete base.CLAUDE_CODE_ENTRYPOINT;
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(full), encoding: 'utf8', cwd: dir, env: base });
}
const read = (dir, file, extra = {}) => run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, file) }, ...extra });
const search = (dir, query, env) => run(dir, { tool_name: 'WebSearch', tool_input: { query } }, env);
const decision = (r) => JSON.parse(r.stdout).hookSpecificOutput;
const silent = (r) => assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
const ledger = (dir) => {
  const file = path.join(dir, '.alfred', 'statistics', 'hook-blocks', `${SESSION}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
const csvProject = () => project({ 'data/orders.csv': Buffer.alloc(BIG, 'a'), 'data/prices.xlsx': Buffer.alloc(BIG, 'a'), 'docs/contract.pdf': 'pdf' });
const codeProject = () => {
  const dir = project({
    'src/pricing.js': 'export function applyDiscount(price) { return price; }\nconst clampPercent = (p) => p;\n',
    'src/pages.js': 'export async function getServerSideProps() { return {}; }\n',
    'src/config.js': 'const maxRetries = 3;\n',
  });
  git(dir, 'add', '.');
  return dir;
};

test('an untracked 200 KB csv asks, and the reason names the size and the clear list', () => {
  const r = read(csvProject(), 'data/orders.csv');
  assert.equal(r.status, 0);
  const out = decision(r);
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'ask');
  assert.ok(out.permissionDecisionReason.includes('200 KB .csv'));
  assert.ok(out.permissionDecisionReason.includes('.alfred/.sensitive-paths'));
});

test('dontAsk and an unattended run deny without naming the list, bypassPermissions and no mode ask', () => {
  const dir = csvProject();
  for (const r of [read(dir, 'data/orders.csv', { permission_mode: 'dontAsk' }), run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'data/orders.csv') } }, { ALFRED_CODE_UNATTENDED: '1' })]) {
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes('Blocked: Read of'));
    assert.ok(!r.stderr.includes('.sensitive-paths'));
  }
  for (const mode of ['bypassPermissions', 'default', 'auto', 'plan', 'acceptEdits']) assert.equal(decision(read(dir, 'data/orders.csv', { permission_mode: mode })).permissionDecision, 'ask', mode);
});

test('a cleared line, a part off and the whole hook off keep a read silent', () => {
  const dir = csvProject();
  put(dir, '.alfred/.sensitive-paths', '!data/**\n');
  silent(read(dir, 'data/orders.csv'));
  const other = csvProject();
  const payload = { tool_name: 'Read', tool_input: { file_path: path.join(other, 'data/orders.csv') } };
  for (const off of ['guard-data-class:dumps', 'guard-data-class']) silent(run(other, payload, { ALFRED_CODE_HOOKS_OFF: off }));
});

test('an untracked xlsx gets one ask from route 2, the documents part off leaves the dump ask', () => {
  const dir = csvProject();
  const both = decision(read(dir, 'data/prices.xlsx')).permissionDecisionReason;
  assert.ok(both.includes('business document') && both.includes('200 KB .xlsx'));
  const file = path.join(dir, 'data/prices.xlsx');
  const dumpOnly = run(dir, { tool_name: 'Read', tool_input: { file_path: file } }, { ALFRED_CODE_HOOKS_OFF: 'guard-data-class:documents' });
  const reason = decision(dumpOnly).permissionDecisionReason;
  assert.ok(reason.includes('data dump') && reason.includes('200 KB .xlsx') && !reason.includes('business document'));
});

test('an untracked pdf asks and a tracked one passes', () => {
  const dir = csvProject();
  assert.ok(decision(read(dir, 'docs/contract.pdf')).permissionDecisionReason.includes('an untracked .pdf'));
  git(dir, 'add', 'docs/contract.pdf');
  git(dir, 'commit', '-qm', 'add');
  silent(read(dir, 'docs/contract.pdf'));
});

test('a listed document asks with the list in its reason and denies without it', () => {
  const dir = project({ 'clients/a.txt': 'plain' });
  put(dir, '.alfred/.sensitive-paths', 'clients/**\n');
  assert.ok(decision(read(dir, 'clients/a.txt')).permissionDecisionReason.includes('listed in .alfred/.sensitive-paths'));
  const denied = read(dir, 'clients/a.txt', { permission_mode: 'dontAsk' });
  assert.ok(denied.stderr.includes('listed as sensitive') && !denied.stderr.includes('.sensitive-paths'));
});

test('a tracked large csv passes, a tracked prod csv still asks, 20 emails ask with counts only', () => {
  const emails = Array.from({ length: 25 }, (_, i) => 'person' + i + '@acme-mail.io').join('\n');
  const dir = project({ 'big.csv': Buffer.alloc(BIG, 'a'), 'prod-users.csv': 'a', 'people.csv': emails });
  git(dir, 'add', 'big.csv', 'prod-users.csv');
  silent(read(dir, 'big.csv'));
  assert.ok(decision(read(dir, 'prod-users.csv')).permissionDecisionReason.includes("name says 'prod'"));
  const reason = decision(read(dir, 'people.csv')).permissionDecisionReason;
  assert.ok(reason.includes('25 personal-data values: 25 emails'));
  assert.ok(!reason.includes('acme-mail.io') && !fs.readFileSync(path.join(dir, '.alfred/statistics/hook-blocks', SESSION + '.jsonl'), 'utf8').includes('acme-mail.io'));
});

test('a folder, a missing file, a Cursor payload and garbage input stay silent', () => {
  const dir = csvProject();
  fs.mkdirSync(path.join(dir, 'x.csv'));
  silent(read(dir, 'x.csv'));
  silent(read(dir, 'data/none.csv'));
  silent(read(dir, 'data/orders.csv', { cursor_version: '1.0.0' }));
  const bad = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  silent(bad);
});

test('a query naming project code is denied with the tokens to remove, a public one passes', () => {
  const dir = codeProject();
  const path1 = search(dir, 'why does applyDiscount in src/pricing.js round wrong');
  assert.equal(path1.status, 2);
  assert.ok(path1.stderr.includes('Remove: src/pricing.js, applyDiscount.'));
  const arrow = search(dir, 'clampPercent returns NaN');
  assert.equal(arrow.status, 2);
  assert.ok(arrow.stderr.includes('clampPercent'));
  silent(search(dir, 'getServerSideProps redirect not working'));
  silent(search(dir, 'node 22 fs.rmSync maxRetries'));
  silent(run(dir, { tool_name: 'WebSearch', tool_input: { query: 'why does applyDiscount round wrong' } }, { ALFRED_CODE_HOOKS_OFF: 'guard-data-class:egress' }));
});

test('a WebFetch path is never judged, its query string is', () => {
  const dir = codeProject();
  silent(run(dir, { tool_name: 'WebFetch', tool_input: { url: 'https://github.com/o/r/blob/main/src/pricing.js', prompt: 'src/pricing.js' } }));
  const r = run(dir, { tool_name: 'WebFetch', tool_input: { url: 'https://www.google.com/search?q=src/pricing.js+bug' } });
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('Remove: src/pricing.js.'));
});

test('a documentation server query with code is denied and another server is not judged', () => {
  const dir = project();
  const input = { query: 'const a = () => { return 1; };\nconst b = () => { return 2; };' };
  const r = run(dir, { tool_name: 'mcp__context7__query-docs', tool_input: input }); // mcp-fixture
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('2 code lines'));
  silent(run(dir, { tool_name: 'mcp__serena__search_for_pattern', tool_input: input })); // mcp-fixture
  assert.equal(run(dir, { tool_name: 'mcp__docs__query-docs', tool_input: input }, { ALFRED_CODE_EGRESS_SERVERS: 'docs' }).status, 2); // mcp-fixture
});

test('a git that outlasts the deadline passes the query and writes one egress-unjudged row', { skip: process.platform === 'win32' }, () => {
  const dir = codeProject();
  const fake = path.join(dir, '..', 'fake-git-' + path.basename(dir));
  made.push(fake);
  put(fake, 'git', '#!/bin/sh\nexec sleep 2\n');
  fs.chmodSync(path.join(fake, 'git'), 0o755);
  const env = { PATH: fake + path.delimiter + process.env.PATH, ALFRED_CODE_EGRESS_DEADLINE_MS: '500' };
  silent(search(dir, 'why does applyDiscount round wrong', env));
  const rows = ledger(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.branch, 'egress-unjudged');
  assert.equal(rows[0].detail.base, 'WebSearch');
  assert.ok(rows[0].detail.counts.elapsedMs >= 400);
});

test('each verdict writes one ledger row with branch, mode, a basename and counts, never a value or a query', () => {
  const dir = project({ 'data/orders.csv': Buffer.alloc(BIG, 'a'), 'src/pricing.js': 'export function applyDiscount(price) {}\n' });
  git(dir, 'add', 'src/pricing.js');
  read(dir, 'data/orders.csv');
  read(dir, 'data/orders.csv', { permission_mode: 'dontAsk' });
  search(dir, 'why does applyDiscount in src/pricing.js round wrong');
  const rows = ledger(dir);
  assert.deepEqual(rows.map((r) => [r.reason, r.detail.mode, r.detail.base]), [['data-class dump-size', 'ask', 'orders.csv'], ['data-class dump-size', 'deny', 'orders.csv'], ['data-class egress', 'deny', 'WebSearch']]);
  assert.deepEqual(rows[0].detail.counts, { bytes: BIG });
  assert.deepEqual(rows[2].detail.counts, { paths: 1, names: 1, codeLines: 0 });
  for (const key of ['ts', 'hook', 'event', 'tool', 'agent', 'tool_use_id']) assert.ok(key in rows[0], key);
  const text = JSON.stringify(rows);
  for (const leak of ['applyDiscount', 'pricing.js', 'round wrong', dir]) assert.ok(!text.includes(leak), leak);
});

test('a repo never set up stands the hook down, a set-up one does not', () => {
  const dir = csvProject();
  const env = { CLAUDE_PLUGIN_ROOT: path.join(dir, 'plugin-root') };
  assert.equal(decision(run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'data/orders.csv') } }, env)).permissionDecision, 'ask');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  silent(run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'data/orders.csv') } }, env));
});

function outside(files = {}) {
  const dir = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'data-class-out-')));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) put(dir, name, content);
  return dir;
}

test('a listed folder that is a symlink out of the project still asks (B2 reads the lexical path)', { skip: process.platform === 'win32' }, () => {
  const dir = project();
  const target = outside({ 'prices.txt': 'plain' });
  fs.symlinkSync(target, path.join(dir, 'clients'), 'dir');
  put(dir, '.alfred/.sensitive-paths', 'clients/**\n');
  assert.ok(decision(read(dir, 'clients/prices.txt')).permissionDecisionReason.includes('listed in .alfred/.sensitive-paths'));
  put(dir, '.alfred/.sensitive-paths', 'clients/**\n!clients/**\n');
  silent(read(dir, 'clients/prices.txt'));
});

test('an absolute data root holds the list that is read, and the ask names that file', () => {
  const dir = csvProject();
  const data = outside({ '.sensitive-paths': '!data/**\n' });
  const env = { ALFRED_CODE_DATA_PATH: data };
  const payload = { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'data/orders.csv') } };
  silent(run(dir, payload, env));
  put(data, '.sensitive-paths', 'docs/**\n');
  const reason = decision(run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'docs/contract.pdf') } }, env)).permissionDecisionReason;
  assert.ok(reason.includes(path.join(data, '.sensitive-paths')), reason);
  assert.ok(!reason.includes(' .alfred/.sensitive-paths'));
  const denied = run(dir, { ...payload, permission_mode: 'dontAsk', tool_input: { file_path: path.join(dir, 'docs/contract.pdf') } }, env);
  assert.ok(!denied.stderr.includes('.sensitive-paths'));
});

test('a file outside the project asks without the clear-line sentence', () => {
  const dir = project();
  const away = outside({ 'orders.csv': Buffer.alloc(BIG, 'a') });
  const reason = decision(run(dir, { tool_name: 'Read', tool_input: { file_path: path.join(away, 'orders.csv') } })).permissionDecisionReason;
  assert.ok(reason.includes('200 KB .csv'));
  assert.ok(!reason.includes('clears it') && !reason.includes('.sensitive-paths'));
});

test('a session started in a subfolder judges the whole repo for names and paths', () => {
  const dir = codeProject();
  put(dir, 'docs/readme.md', 'notes');
  const cwd = path.join(dir, 'docs');
  const named = run(dir, { tool_name: 'WebSearch', cwd, tool_input: { query: 'why does applyDiscount round wrong' } });
  assert.equal(named.status, 2);
  assert.ok(named.stderr.includes('Remove: applyDiscount.'));
  const pathed = run(dir, { tool_name: 'WebSearch', cwd, tool_input: { query: 'bug in src/pricing.js today' } });
  assert.equal(pathed.status, 2);
  assert.ok(pathed.stderr.includes('Remove: src/pricing.js.'));
});

test('timing: p50 and max of 20 WebSearch runs', () => {
  const dir = codeProject();
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = process.hrtime.bigint();
    search(dir, 'why does applyDiscount in src/pricing.js round wrong');
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`# WebSearch runs: p50 ${Math.round(times[10])} ms, max ${Math.round(times[19])} ms`);
});
