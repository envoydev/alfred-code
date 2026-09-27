'use strict';
// The sandbox is hermetic by default. Until 2.0.0 the seed's pin lookups asked npm (`npm view <pkg>
// version`) and PyPI (curl) for a version on every run, and a sandbox that left those two to the
// machine's own tools sent every installer test to registry.npmjs.org and pypi.org; since R35 the seed
// asks neither, and its one outward package call is the browser download (npx, at the release pin).
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

// A picked firefox makes the seed download its build through npx - the positive control that the
// sentinel does see what the run calls once the sandbox's own stubs are gone.
const PW_SELECTION = `${SELECTION}mcp browser\n`;
const PW_ARGS = ['--playwright-browsers', 'firefox'];
const PW_PIN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins.browser.version;

test('sandbox: with the sandbox stubs removed, the seed still asks no registry - its one outward call is the pinned browser download', POSIX_ONLY, () =>
{
    // R35: no npm view and no PyPI fetch, while the download in the same run does reach the sentinel -
    // so an empty npm/curl record is the seed's silence, not a sentinel that sees nothing.
    const prepare = (repo) => { for (const t of ['npm', 'curl', 'npx']) fs.rmSync(path.join(path.dirname(repo), 'bin', t), { force: true }); };
    const { reached } = withSentinel(() => seedRun('install', PW_SELECTION, { args: PW_ARGS, prepare }));
    assert.deepStrictEqual(reached.filter((l) => /^(npm|curl) /.test(l)), [], `the seed asked a registry: ${JSON.stringify(reached)}`);
    assert.deepStrictEqual(reached.filter((l) => l.startsWith('npx ')), [`npx -y -p @playwright/mcp@${PW_PIN} playwright install firefox`],
        'the download ran at another version than the release pin, or not at all');
});

test('sandbox: a test that needs a working tool still passes its own stub over the default', POSIX_ONLY, () =>
{
    const { result, reached } = withSentinel(() => seedRun('install', PW_SELECTION, {
        args: PW_ARGS,
        tools: { npx: 'printf \'%s\\n\' "$*" >> "$HOME/own-npx.log"; exit 0' },
        inspect: (repo) =>
        {
            const log = path.join(path.dirname(repo), 'own-npx.log');
            return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
        },
    }));
    assert.deepStrictEqual(result.result, [`-y -p @playwright/mcp@${PW_PIN} playwright install firefox`], 'the test\'s own npx stub answered the download');
    assert.deepStrictEqual(reached, [], 'nothing got past the sandbox');
});
