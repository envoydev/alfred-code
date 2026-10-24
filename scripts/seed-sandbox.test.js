'use strict';
// The sandbox is hermetic by default. Until 2.0.0 the seed's pin lookups asked npm (`npm view <pkg>
// version`) and PyPI (curl) for a version on every run, and a sandbox that left those two to the
// machine's own tools sent every installer test to registry.npmjs.org and pypi.org; since R35 the seed
// asks neither, and since 2.10.1 it makes no outward package call at all - the browser download left with the server.
// The proof is a PATH-level sentinel: recording stubs placed on the PATH the sandbox inherits, BEHIND
// its own bin - a call that gets past the sandbox's stubs lands in the sentinel's record instead of
// on the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';

// Runs `fn` with a recording npm and curl first on process.env.PATH (which the sandbox appends after
// its own bin), and returns what reached them.
function withSentinel(fn)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-sentinel-'));
    const record = path.join(dir, 'reached.log');
    for (const tool of ['npm', 'curl', 'npx'])
        fs.writeFileSync(path.join(dir, tool), `#!/bin/sh\nprintf '${tool} %s\\n' "$*" >> '${record}'\nexit 1\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = dir + path.delimiter + saved;
    try
    {
        const result = fn();
        const reached = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean) : [];
        return { result, reached };
    }
    finally
    {
        process.env.PATH = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('sandbox: a run with no stubs of its own reaches neither npm nor curl on the machine', POSIX_ONLY, () =>
{
    for (const action of ['install', 'update'])
    {
        const { reached } = withSentinel(() => seedRun(action, SELECTION));
        assert.deepStrictEqual(reached, [], `${action}: a registry lookup got past the sandbox - it would have gone to the network`);
    }
});

// An old selection naming the browser and the old engine flag: until 2.10.1 the seed downloaded the engine through npx.
// Now nothing reaches a package tool - and a call the test itself makes does reach the sentinel, so an empty record is
// the seed's silence, not a sentinel that sees nothing.
const PW_SELECTION = `${SELECTION}mcp browser\n`;
const PW_ARGS = ['--playwright-browsers', 'firefox'];

test('sandbox: with the sandbox stubs removed, the seed reaches no package tool - not even for an old browser pick', POSIX_ONLY, () =>
{
    const prepare = (repo) => { for (const t of ['npm', 'curl', 'npx']) fs.rmSync(path.join(path.dirname(repo), 'bin', t), { force: true }); };
    const { reached } = withSentinel(() =>
    {
        seedRun('install', PW_SELECTION, { args: PW_ARGS, prepare });
        require('node:child_process').spawnSync('npx', ['sentinel-check'], { env: process.env, stdio: 'ignore' });
    });
    assert.deepStrictEqual(reached, ['npx sentinel-check'], `the seed called a package tool: ${JSON.stringify(reached)}`);
});

test('sandbox: a test that needs a working tool still passes its own stub over the default', POSIX_ONLY, () =>
{
    const { result, reached } = withSentinel(() => seedRun('install', SELECTION, {
        tools: { claude: 'printf \'%s\\n\' "$*" >> "$HOME/own-claude.log"; if [ "$1" = plugin ] && [ "$2" = list ]; then echo "[]"; fi; exit 0' },
        inspect: (repo) =>
        {
            const log = path.join(path.dirname(repo), 'own-claude.log');
            return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
        },
    }));
    assert.ok(result.result.some((l) => l.startsWith('plugin list')), `the test's own claude stub answered the listing: ${JSON.stringify(result.result)}`);
    assert.deepStrictEqual(reached, [], 'nothing got past the sandbox');
});
