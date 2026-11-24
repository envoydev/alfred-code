'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { tsServerState } = require('./ts-server/find.js');

// A fake file system: `names` maps a package.json path to its package name, `files` lists the files that exist,
// `links` maps a bin to the file it points at, `typescript` maps a package dir to the typescript entry it resolves.
function seams({ names = {}, files = [], links = {}, typescript = {} })
{
    return {
        realpath: (p) => links[p] || p,
        readName: (p) => names[p] || '',
        exists: (p) => files.includes(p),
        resolveFrom: (name, dir) => (name === 'typescript' ? typescript[dir] || '' : ''),
    };
}

const prefix = path.join('/', 'u', 'nvm', 'v26', 'lib', 'node_modules');
const server = path.join(prefix, 'typescript-language-server');
const bin = path.join('/', 'u', 'nvm', 'v26', 'bin', 'typescript-language-server');
const macLayout = (tsserver) => seams({
    names: { [path.join(server, 'package.json')]: 'typescript-language-server' },
    links: { [bin]: path.join(server, 'lib', 'cli.mjs') },
    typescript: { [server]: path.join(prefix, 'typescript', 'lib', 'typescript.js') },
    files: tsserver ? [path.join(prefix, 'typescript', 'lib', 'tsserver.js')] : [],
});

test('the server reads a TypeScript with tsserver.js beside it: ok', () =>
{
    assert.strictEqual(tsServerState(bin, macLayout(true)), 'ok');
});

test('a global TypeScript 7 has no tsserver.js, so the server cannot start: missing', () =>
{
    assert.strictEqual(tsServerState(bin, macLayout(false)), 'missing');
});

test('no TypeScript resolves from the server at all: missing', () =>
{
    const s = macLayout(true);
    assert.strictEqual(tsServerState(bin, { ...s, resolveFrom: () => '' }), 'missing');
});

test("npm's Windows shim sits in the prefix with the package below it in node_modules", () =>
{
    const winPrefix = path.join('/', 'npm');
    const shim = path.join(winPrefix, 'typescript-language-server.cmd');
    const pkg = path.join(winPrefix, 'node_modules', 'typescript-language-server');
    const s = seams({
        names: { [path.join(pkg, 'package.json')]: 'typescript-language-server' },
        typescript: { [pkg]: path.join(winPrefix, 'node_modules', 'typescript', 'lib', 'typescript.js') },
        files: [path.join(winPrefix, 'node_modules', 'typescript', 'lib', 'tsserver.js')],
    });
    assert.strictEqual(tsServerState(shim, s), 'ok');
});

test('a server whose package cannot be found is unknown, never a false missing', () =>
{
    assert.strictEqual(tsServerState(path.join('/', 'opt', 'bin', 'typescript-language-server'), seams({})), 'unknown');
    assert.strictEqual(tsServerState('', seams({})), 'unknown');
});
