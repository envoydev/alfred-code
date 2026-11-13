'use strict';
// stack/hooks/mode-settings.js - the mode file's trust test (localTrust) and its one git call (localGitStatus).
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const M = require('../stack/hooks/mode-settings.js');

const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mode-settings-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const GIT = spawnSync('git', ['--version']).status === 0;
let seq = 0;
const tree = () => { const d = path.join(TMP, `t${seq++}`); fs.mkdirSync(d, { recursive: true }); return d; };
// A repository as gitTopOf reads one: a `.git` folder holding HEAD.
const repo = () => { const d = tree(); fs.mkdirSync(path.join(d, '.git')); fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'ref: refs/heads/main\n'); return d; };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'none.gitconfig'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd, args) => spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
const gitInit = () => { const d = tree(); git(d, ['init', '-q']); return d; };
const linkedClaude = (base) => { const real = tree(); fs.symlinkSync(real, path.join(base, '.claude'), 'dir'); return base; };
const nestedGitClaude = (base) => { fs.mkdirSync(path.join(base, '.claude', '.git'), { recursive: true }); return base; };
const withEnv = (vars, fn) =>
{
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return fn(); }
    finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const withPath = (value, fn) => withEnv({ PATH: value }, fn);

const file = (root) => path.join(root, '.claude', 'settings.local.json');
const never = () => { throw new Error('git was asked'); };

test('no repository: own, and git is never asked - file absent, .claude absent', () => assert.strictEqual(M.localTrust(file(tree()), never), 'own'));
test('in a repository: 0 tracked, 1 own, 128 and null unknown', () =>
{
    const root = repo();
    for (const [status, want] of [[0, 'tracked'], [1, 'own'], [128, 'unknown'], [null, 'unknown']]) assert.strictEqual(M.localTrust(file(root), () => status), want, String(status));
});
test('a tracked file deleted from disk is still tracked', () => assert.strictEqual(M.localTrust(file(repo()), () => 0), 'tracked'));
test('.claude a link, or holding .git: unknown, inside a repository and outside one', { skip: process.platform === 'win32' }, () =>
{
    for (const make of [linkedClaude, nestedGitClaude]) for (const base of [repo(), tree()]) assert.strictEqual(M.localTrust(file(make(base)), () => 1), 'unknown');
});
test('the real git: an untracked file in a real repository is own, a committed one tracked', { skip: !GIT }, () =>
{
    const root = gitInit();
    write(file(root), '{}');
    assert.strictEqual(M.localTrust(file(root)), 'own');
    git(root, ['add', '-f', '.claude/settings.local.json']);
    git(root, ['commit', '-qm', 'x']);
    assert.strictEqual(M.localTrust(file(root)), 'tracked');
});
test('git off PATH inside a repository: localGitStatus is null', () => assert.strictEqual(withPath('', () => M.localGitStatus(file(repo()))), null));
test('an inherited GIT_DIR does not point the call elsewhere', { skip: !GIT }, () =>
{
    const root = gitInit();
    write(file(root), '{}');
    assert.strictEqual(withEnv({ GIT_DIR: path.join(tree(), 'nowhere') }, () => M.localTrust(file(root))), 'own');
});
