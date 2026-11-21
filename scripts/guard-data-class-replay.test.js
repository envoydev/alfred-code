#!/usr/bin/env node
// Suite for scripts/guard-data-class-replay.js: a synthetic transcript with a known answer, so it needs no session data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { realLong } = require('./test-paths');

const SCRIPT = path.join(__dirname, 'guard-data-class-replay.js');
const PRIVATE_NAME = 'applyDiscount';
const CSV_BYTES = 200 * 1024;

const made = [];
function tempDir(prefix) {
  const dir = realLong(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function gitIn(dir, ...argv) {
  const r = spawnSync('git', argv, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function repoWith(file, text) {
  const dir = tempDir('replay-repo-');
  gitIn(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, file), text);
  gitIn(dir, 'add', file);
  return dir;
}

const toolRow = (id, name, input, cwd) => ({ type: 'assistant', cwd, message: { content: [{ type: 'tool_use', id, name, input }] } });

function replay(rows, ...extra) {
  return replayWith({}, rows, ...extra);
}

function replayWith(env, rows, ...extra) {
  const root = tempDir('replay-root-');
  fs.mkdirSync(path.join(root, 'project'));
  fs.writeFileSync(path.join(root, 'project', 'session.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: r.status, out: r.stdout, report: r.status === 0 ? JSON.parse(r.stdout) : null, err: r.stderr };
}

function fixtureRows() {
  const data = tempDir('replay-data-');
  const csv = path.join(data, 'sales.csv');
  fs.writeFileSync(csv, 'a,b\n'.repeat(CSV_BYTES / 4));
  const appRepo = repoWith('cart.js', `function ${PRIVATE_NAME}(total) {\n  return total;\n}\n`);
  const nextRepo = repoWith('page.js', 'export async function getServerSideProps() {}\n');
  return [
    toolRow('t1', 'Read', { file_path: csv }, data),
    toolRow('t2', 'WebSearch', { query: `${PRIVATE_NAME} rounding` }, appRepo),
    toolRow('t3', 'WebSearch', { query: 'node fs.rmSync maxRetries' }, appRepo),
    toolRow('t4', 'WebSearch', { query: 'getServerSideProps redirect' }, nextRepo),
  ];
}

test('replay counts a data dump read as an ask and a project name in a query as a deny', () => {
  const samples = path.join(tempDir('replay-out-'), 'samples.txt');
  const { status, report, out } = replay(fixtureRows(), '--samples', samples);
  assert.equal(status, 0);
  assert.equal(report.transcripts, 1);
  assert.equal(report.reads, 1);
  assert.equal(report.asks['dump-size'], 1);
  assert.equal(report.queries.WebSearch, 3);
  assert.equal(report.denies, 1);
  assert.equal(report.judgedWithRepo, 3);
  assert.equal(report.judgedShapeOnly, 0);
  assert.equal(report.unjudged, 0);
  assert.ok(!out.includes(PRIVATE_NAME), 'stdout carries no query text');
  assert.match(fs.readFileSync(samples, 'utf8'), new RegExp(PRIVATE_NAME));
});

test('replay judges a query by shape alone when the recorded folder is gone', () => {
  const gone = path.join(os.tmpdir(), 'replay-gone-' + process.pid);
  const { report } = replay([toolRow('g1', 'WebSearch', { query: `${PRIVATE_NAME} rounding` }, gone)]);
  assert.equal(report.judgedShapeOnly, 1);
  assert.equal(report.judgedWithRepo, 0);
  assert.equal(report.denies, 0);
});

test('replay counts a repeated tool call once and skips a line that does not parse', () => {
  const rows = fixtureRows().slice(0, 1);
  const root = tempDir('replay-root-');
  const file = path.join(root, 'session.jsonl');
  fs.writeFileSync(file, [JSON.stringify(rows[0]), '{"tool_use": broken', JSON.stringify(rows[0])].join('\n') + '\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).reads, 1);
});

test('replay counts a Read of a missing file and gives it no verdict', () => {
  const { report } = replay([toolRow('m1', 'Read', { file_path: path.join(os.tmpdir(), 'replay-missing.csv') }, os.tmpdir())]);
  assert.equal(report.reads, 1);
  assert.equal(Object.values(report.asks).reduce((a, b) => a + b, 0), 0);
});

const queryTotal = (report) => Object.values(report.queries).reduce((a, b) => a + b, 0);
const coverageTotal = (report) => report.judgedWithRepo + report.judgedShapeOnly + report.unjudged + report.noText;
const posixOnly = process.platform === 'win32' ? { skip: 'needs a POSIX shell script as git' } : {};

test('replay skips an unreadable transcript, counts it and prints no path', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
  const root = tempDir('replay-root-');
  const lockedFile = path.join(root, 'locked.jsonl');
  fs.writeFileSync(path.join(root, 'open.jsonl'), JSON.stringify(toolRow('u1', 'Read', { file_path: path.join(root, 'none.csv') }, root)) + '\n');
  fs.writeFileSync(lockedFile, '{}\n');
  fs.chmodSync(lockedFile, 0o000);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  fs.chmodSync(lockedFile, 0o600);
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.unreadable, 1);
  assert.equal(report.reads, 1);
  assert.equal(report.transcripts, 2);
  assert.ok(!r.stderr.includes(root) && !r.stdout.includes(root), 'no path is printed');
});

test('replay partitions the coverage counts over every query', () => {
  const gone = path.join(os.tmpdir(), 'replay-gone-' + process.pid);
  const rows = fixtureRows().concat([
    toolRow('p1', 'WebFetch', { url: 'https://docs.example.com/page' }, gone),
    toolRow('p2', 'WebSearch', { query: 'plain question' }, gone),
    toolRow('p3', 'WebFetch', { url: 'https://docs.example.com/search?q=rounding' }, gone),
  ]);
  const { report } = replay(rows);
  assert.equal(report.noText, 1);
  assert.equal(report.judgedShapeOnly, 2);
  assert.equal(coverageTotal(report), queryTotal(report));
});

test('replay counts a missing git as shape-only, in no other bucket', () => {
  const appRepo = repoWith('cart.js', `function ${PRIVATE_NAME}(total) {}\n`);
  const noGit = tempDir('replay-nogit-');
  const { report } = replayWith({ PATH: noGit }, [toolRow('n1', 'WebSearch', { query: `${PRIVATE_NAME} rounding` }, appRepo)]);
  assert.equal(report.judgedShapeOnly, 1);
  assert.equal(report.judgedWithRepo, 0);
  assert.equal(report.unjudged, 0);
  assert.equal(coverageTotal(report), queryTotal(report));
});

test('replay counts a git call that fails as unjudged only', posixOnly, () => {
  const appRepo = repoWith('cart.js', `function ${PRIVATE_NAME}(total) {}\n`);
  const fakeGit = tempDir('replay-fakegit-');
  fs.writeFileSync(path.join(fakeGit, 'git'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
  const { report } = replayWith({ PATH: fakeGit }, [toolRow('f1', 'WebSearch', { query: `${PRIVATE_NAME} rounding` }, appRepo)]);
  assert.equal(report.unjudged, 1);
  assert.equal(report.judgedWithRepo, 0);
  assert.equal(report.judgedShapeOnly, 0);
  assert.equal(coverageTotal(report), queryTotal(report));
});
