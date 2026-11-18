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

const EACH_SCOPE_FILE = 'settings.json';
const OTHER_ENV = { MY_OWN_SETTING: 'kept' };
const accountSettingsFile = (work) => path.join(work, 'acct', EACH_SCOPE_FILE);
const sharedSettingsFile = (repo) => claudeFile(repo, EACH_SCOPE_FILE);
const layOutSettingsWithEnv = (repo, work) =>
{
    fs.mkdirSync(path.dirname(accountSettingsFile(work)), { recursive: true });
    fs.mkdirSync(claudeFile(repo, ''), { recursive: true });
    fs.writeFileSync(accountSettingsFile(work), JSON.stringify({ env: { ...OTHER_ENV, ACCOUNT_ONLY: '1' } }, null, 2));
    fs.writeFileSync(sharedSettingsFile(repo), JSON.stringify({ env: { ...OTHER_ENV, SHARED_ONLY: '1' } }, null, 2));
};

test('install-seats-route: --seats-route copy at local, project and user scope writes the key false into settings.local.json and a managed-env row, and touches neither the account nor the shared settings.json', POSIX_ONLY, () =>
{
    for (const scope of ['local', 'project', 'user'])
    {
        let before = null;
        const { result } = seedRun('install', SELECTION, {
            env: NO_ROUTE_ENV, args: ['--scope', scope, '--seats-route', 'copy'],
            prepare: (repo, work) =>
            {
                layOutSettingsWithEnv(repo, work);
                before = { account: fs.readFileSync(accountSettingsFile(work), 'utf8'), shared: fs.readFileSync(sharedSettingsFile(repo), 'utf8') };
            },
            inspect: (repo) => ({ ...seen(repo), account: fs.readFileSync(accountSettingsFile(path.dirname(repo)), 'utf8'), shared: fs.readFileSync(sharedSettingsFile(repo), 'utf8') }),
        });
        assert.deepEqual({ value: result.value, ledgered: result.ledgered }, { value: 'false', ledgered: true }, `scope ${scope}`);
        assert.equal(result.account, before.account, `scope ${scope}: the account settings.json is byte-identical`);
        assert.equal(result.shared, before.shared, `scope ${scope}: the shared settings.json is byte-identical`);
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

const SEATS_LINE = /^==> seats: .*$/m;
const COPY_SEATS = '==> seats: copy route - 1 picked in .claude/agents';

test('install-seats-route: after --seats-route copy, three plain updates stay on the copy route', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], SELECTION, {
        env: NO_ROUTE_ENV, args: [['--scope', 'project', '--seats-route', 'copy'], ['--scope', 'project'], ['--scope', 'project'], ['--scope', 'project']],
        each: (repo) => ({ ...seen(repo), seats: fs.existsSync(claudeFile(repo, 'agents')) ? fs.readdirSync(claudeFile(repo, 'agents')).sort() : [] }),
    });
    for (const [i, step] of steps.entries())
    {
        assert.equal((outs[i].match(SEATS_LINE) || [])[0], COPY_SEATS, `run ${i + 1}: the seats line names the copy route`);
        assert.deepEqual(step, { value: 'false', ledgered: true, seats: ['evidence-gatherer.md'] }, `after run ${i + 1}`);
    }
});

test('install-seats-route: a ledgered false holds against a session that still carries the old value in its env', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], SELECTION, {
        env: [NO_ROUTE_ENV, { [KEY]: 'true' }], args: [['--scope', 'project', '--seats-route', 'copy'], ['--scope', 'project']],
    });
    assert.equal((outs[1].match(SEATS_LINE) || [])[0], COPY_SEATS, outs[1]);
});

test('install-seats-route: a hand-set value with no flag stays and gets no managed-env row', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, {
        env: NO_ROUTE_ENV, args: ['--scope', 'project'],
        prepare: (repo) => { fs.mkdirSync(claudeFile(repo, ''), { recursive: true }); fs.writeFileSync(claudeFile(repo, LOCAL_FILE), JSON.stringify({ env: { [KEY]: 'false' } })); },
        inspect: (repo) => seen(repo),
    });
    assert.deepEqual(result, { value: 'false', ledgered: false });
    assert.match(out, /on from the alfred-code plugin/, 'an unledgered local value is not the stack\'s, so the run takes the plugin route');
});

test('install-seats-route: a hand-set value with the flag is overwritten and ledgered', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', SELECTION, {
        env: NO_ROUTE_ENV, args: ['--scope', 'project', '--seats-route', 'copy'],
        prepare: (repo) => { fs.mkdirSync(claudeFile(repo, ''), { recursive: true }); fs.writeFileSync(claudeFile(repo, LOCAL_FILE), JSON.stringify({ env: { [KEY]: 'true' } })); },
        inspect: (repo) => seen(repo),
    });
    assert.deepEqual(result, { value: 'false', ledgered: true });
});

test('install-seats-route: --seats-route copy beside a settings.json that sets the key changes nothing and names the file', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SELECTION, {
        env: NO_ROUTE_ENV, args: ['--scope', 'project', '--seats-route', 'copy'],
        prepare: (repo) => { fs.mkdirSync(claudeFile(repo, ''), { recursive: true }); fs.writeFileSync(claudeFile(repo, 'settings.json'), JSON.stringify({ env: { [KEY]: 'true' } })); },
        inspect: (repo) => seen(repo),
    });
    assert.ok(out.includes(`!! seats route: settings.json sets ${KEY}=true for everyone - change it there`), out);
    assert.deepEqual(result, { value: undefined, ledgered: false });
});
