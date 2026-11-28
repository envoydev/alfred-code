'use strict';
// scripts/install/node-path.js: the warning for a node that rests on one nvm version folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { nvmPathWarning } = require('./install/node-path.js');

const HOME = '/Users/x';
const VERSIONED = `${HOME}/.nvm/versions/node/v24.11.0/bin/node`;
const CURRENT_BIN = `${HOME}/.nvm/current/bin`;
const call = (over = {}) => nvmPathWarning({
    execPath: VERSIONED,
    pathEnv: `${HOME}/.nvm/versions/node/v24.11.0/bin:/usr/bin`,
    home: HOME,
    platform: 'darwin',
    exists: () => false,
    nvmDir: '',
    realpath: (p) => p,
    ...over,
});

test('node on a versioned nvm folder with no current link on PATH names the removal risk and the fix', () =>
{
    const line = call();
    assert.equal(typeof line, 'string');
    assert.match(line, /one nvm version folder/);
    assert.match(line, /v24\.11\.0/);
    assert.match(line, /every alfred-code hook/);
    assert.match(line, /NVM_SYMLINK_CURRENT=true/);
    assert.match(line, /nvm alias default v24\.11\.0/);
    assert.match(line, /nvm use default/);
    assert.match(line, /~\/\.nvm\/current\/bin/);
    assert.match(line, /~\/\.zprofile/);
});

test('a current link that holds a node and is on PATH gives no line', () =>
{
    const seen = [];
    const line = call({
        pathEnv: `${CURRENT_BIN}:/usr/bin`,
        exists: (p) => { seen.push(p); return p === `${CURRENT_BIN}/node`; },
    });
    assert.equal(line, null);
    assert.deepEqual(seen, [`${CURRENT_BIN}/node`]);
});

test('a dangling current entry on PATH still gives the line', () =>
{
    assert.match(call({ pathEnv: `${CURRENT_BIN}:/usr/bin`, exists: () => false }), /one nvm version folder/);
});

test('a current entry with a trailing slash is still read as the current link', () =>
{
    assert.equal(call({ pathEnv: `${CURRENT_BIN}/:/usr/bin`, exists: (p) => p === `${CURRENT_BIN}/node` }), null);
});

test('a node outside the nvm versions folder gives no line', () =>
{
    assert.equal(call({ execPath: '/opt/homebrew/bin/node' }), null);
    assert.equal(call({ execPath: `${HOME}/.nvm/current/bin/node` }), null);
    assert.equal(call({ execPath: `${HOME}/.nvm/versions/node/node` }), null, 'no version folder between');
    assert.equal(call({ execPath: `/Users/y/.nvm/versions/node/v24.11.0/bin/node` }), null, 'another home');
});

test('win32 gives no line, whatever the path holds', () =>
{
    assert.equal(call({ platform: 'win32' }), null);
});

test('missing or empty inputs give no line and never throw', () =>
{
    assert.equal(call({ execPath: undefined }), null);
    assert.equal(call({ home: '' }), null);
    assert.equal(call({ home: undefined }), null);
    assert.match(call({ pathEnv: undefined }), /one nvm version folder/);
    assert.match(call({ exists: undefined }), /one nvm version folder/);
    assert.match(call({ exists: () => { throw new Error('boom'); }, pathEnv: `${CURRENT_BIN}` }), /one nvm version folder/);
});

const OPT_NVM = '/opt/nvm';
const OPT_EXEC = `${OPT_NVM}/versions/node/v24.11.0/bin/node`;

test('L1-21: a custom NVM_DIR holding the node gets the warning, named with that folder', () =>
{
    const line = call({ execPath: OPT_EXEC, nvmDir: OPT_NVM, pathEnv: `${OPT_NVM}/versions/node/v24.11.0/bin:/usr/bin` });
    assert.match(line, /one nvm version folder \(\/opt\/nvm\/versions\/node\/v24\.11\.0\)/);
    assert.match(line, /\/opt\/nvm\/current\/bin/);
    assert.match(line, /nvm alias default v24\.11\.0/);
});

test('L1-21: a custom NVM_DIR whose current link holds a node on PATH gives no line', () =>
{
    const bin = `${OPT_NVM}/current/bin`;
    assert.equal(call({ execPath: OPT_EXEC, nvmDir: OPT_NVM, pathEnv: `${bin}:/usr/bin`, exists: (p) => p === `${bin}/node` }), null);
});

test('L1-21: a node outside both the default and the custom nvm folder gives no line', () =>
{
    assert.equal(call({ execPath: '/opt/other/versions/node/v24.11.0/bin/node', nvmDir: OPT_NVM }), null);
});

test('L1-21: a symlinked HOME warns when the node path is the real one', () =>
{
    const realOf = (p) => p.replace(/^\/home\/x/, '/data/x');
    const line = call({ home: '/home/x', execPath: '/data/x/.nvm/versions/node/v24.11.0/bin/node', pathEnv: '/home/x/.nvm/versions/node/v24.11.0/bin:/usr/bin', realpath: realOf });
    assert.match(line, /one nvm version folder \(~\/\.nvm\/versions\/node\/v24\.11\.0\)/);
});

test('L1-21: a symlinked HOME with the current link on PATH, spelled either way, gives no line', () =>
{
    const realOf = (p) => p.replace(/^\/home\/x/, '/data/x');
    const execPath = '/data/x/.nvm/versions/node/v24.11.0/bin/node';
    assert.equal(call({ home: '/home/x', execPath, pathEnv: '/home/x/.nvm/current/bin:/usr/bin', realpath: realOf, exists: (p) => p === '/home/x/.nvm/current/bin/node' }), null);
    assert.equal(call({ home: '/home/x', execPath, pathEnv: '/data/x/.nvm/current/bin:/usr/bin', realpath: realOf, exists: (p) => p === '/data/x/.nvm/current/bin/node' }), null);
});

test('L1-21: a realpath that throws leaves the plain comparison', () =>
{
    const throws = () => { throw new Error('ENOENT'); };
    assert.match(call({ realpath: throws }), /one nvm version folder/);
    assert.equal(call({ realpath: throws, execPath: '/opt/homebrew/bin/node' }), null);
});

test('linux reads the same rule as macOS', () =>
{
    assert.match(call({ platform: 'linux', home: '/home/x', execPath: '/home/x/.nvm/versions/node/v22.1.0/bin/node' }), /v22\.1\.0/);
});

// The installer's init and update runs carry the same line. A preload puts node's execPath under the run's throwaway HOME.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const PRELOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'node-path-preload-'));
test.after(() => fs.rmSync(PRELOAD_DIR, { recursive: true, force: true }));
const PRELOAD = path.join(PRELOAD_DIR, 'exec-path.js');
fs.writeFileSync(PRELOAD, "Object.defineProperty(process, 'execPath', { value: `${process.env.HOME}/.nvm/versions/node/v24.11.0/bin/node` });\n");
const NVM_LINE = /node comes from one nvm version folder \(~\/\.nvm\/versions\/node\/v24\.11\.0\)/;

for (const action of ['install', 'update'])
{
    test(`${action} prints the nvm line when node rests on one nvm version folder`, POSIX_ONLY, () =>
    {
        const r = seedRun(action, 'rule markdown-docs\n', { env: { NODE_OPTIONS: `--require=${PRELOAD}` } });
        assert.match(r.out, NVM_LINE);
        assert.equal(r.out.match(/one nvm version folder/g).length, 1, 'said once');
    });
}

test('install prints no nvm line for a node outside the nvm versions folder', POSIX_ONLY, () =>
{
    // NVM_DIR is read since L1-21, so a machine that runs nvm must not hand the run its own folder.
    const r = seedRun('install', 'rule markdown-docs\n', { env: { NVM_DIR: undefined } });
    assert.doesNotMatch(r.out, /nvm version folder/);
});
