'use strict';
// Task 5 of the agents route switch: `--seats-route plugin|copy` writes ALFRED_CODE_SKILLS_VIA_PLUGIN into the project's
// settings.local.json at every scope, ledgers it in managed-env, and the key outlives later updates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger } = require('./install/stamp.js');

const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
const SELECTION = 'skill csharp\nagent evidence-gatherer\n';
const LOCAL_FILE = 'settings.local.json';
const NO_ROUTE_ENV = { [KEY]: undefined };

const claudeFile = (repo, name) => path.join(repo, '.claude', name);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const localEnv = (repo) => readJson(claudeFile(repo, LOCAL_FILE)).env || {};
const ledgerKeys = (repo) => Object.keys((readLedger(claudeFile(repo, 'alfred-code.stamp')).env || {})[LOCAL_FILE] || {});
const seen = (repo) => ({ value: localEnv(repo)[KEY], ledgered: ledgerKeys(repo).includes(KEY) });

test('install-seats-route: --seats-route copy at local, project and user scope writes the key false into settings.local.json and a managed-env row', POSIX_ONLY, () =>
{
    for (const scope of ['local', 'project', 'user'])
    {
        const accountSettings = (repo) => path.join(repo, '..', 'acct', 'settings.json');
        const { result } = seedRun('install', SELECTION, {
            env: NO_ROUTE_ENV, args: ['--scope', scope, '--seats-route', 'copy'],
            inspect: (repo) => ({ ...seen(repo), account: fs.existsSync(accountSettings(repo)) ? (readJson(accountSettings(repo)).env || {})[KEY] : undefined,
                shared: fs.existsSync(claudeFile(repo, 'settings.json')) ? (readJson(claudeFile(repo, 'settings.json')).env || {})[KEY] : undefined }),
        });
        assert.deepEqual(result, { value: 'false', ledgered: true, account: undefined, shared: undefined }, `scope ${scope}`);
    }
});

test('install-seats-route: the route key and its row survive three plain updates', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [['--scope', 'project', '--seats-route', 'copy'], ['--scope', 'project'], ['--scope', 'project'], ['--scope', 'project']],
        each: (repo) => seen(repo),
    });
    for (const [i, step] of steps.entries()) assert.deepEqual(step, { value: 'false', ledgered: true }, `after run ${i + 1}`);
});

test('install-seats-route: --seats-route plugin writes true and never removes the key', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [['--scope', 'project', '--seats-route', 'copy'], ['--scope', 'project', '--seats-route', 'plugin'], ['--scope', 'project']],
        each: (repo) => seen(repo),
    });
    assert.deepEqual(steps[0], { value: 'false', ledgered: true });
    assert.deepEqual(steps[1], { value: 'true', ledgered: true }, 'plugin is written, not removed');
    assert.deepEqual(steps[2], { value: 'true', ledgered: true }, 'a plain update leaves it');
});

test('install-seats-route: --seats-route copy over a garbage settings.local.json is refused with its line and changes no route', POSIX_ONLY, () =>
{
    const GARBAGE = '{ not json';
    const { out, result } = seedRun('install', SELECTION, {
        env: NO_ROUTE_ENV, args: ['--scope', 'project', '--seats-route', 'copy'],
        prepare: (repo) => { fs.mkdirSync(claudeFile(repo, ''), { recursive: true }); fs.writeFileSync(claudeFile(repo, LOCAL_FILE), GARBAGE); },
        inspect: (repo) => ({ local: fs.readFileSync(claudeFile(repo, LOCAL_FILE), 'utf8'), agents: fs.existsSync(claudeFile(repo, 'agents')) }),
    });
    assert.ok(out.includes('!! seats route: .claude/settings.local.json is not valid JSON - not switched'), out);
    assert.equal(result.local, GARBAGE, 'the file is untouched');
    assert.equal(result.agents, false, 'the run took the plugin route, no seat copied');
});
