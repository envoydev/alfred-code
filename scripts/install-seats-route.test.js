'use strict';
// Task 5 of the agents route switch: `--seats-route plugin|copy` writes ALFRED_CODE_SKILLS_VIA_PLUGIN into the project's
// settings.local.json at every scope, ledgers it in managed-env, and the key outlives later updates.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger, readLibrary } = require('./install/stamp.js');
const { placement, CORE } = require('./plugin-placement.js');
const rt = require('./install/runtime.js');
const { putWorkspace } = require('./workspace-fixture.js');

const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
const SELECTION = 'skill csharp\nagent evidence-gatherer\n';
const LOCAL_FILE = 'settings.local.json';
const NO_ROUTE_ENV = { [KEY]: undefined };

const claudeFile = (repo, name) => path.join(repo, '.claude', name);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const localEnv = (repo) => readJson(claudeFile(repo, LOCAL_FILE)).env || {};
const ledgerKeys = (repo) => Object.keys((readLedger(claudeFile(repo, 'alfred-code.stamp')).env || {})[LOCAL_FILE] || {});
const localEnvOf = (repo) => (fs.existsSync(claudeFile(repo, LOCAL_FILE)) ? localEnv(repo) : {});
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
const COPY_SEATS = '==> seats: copy route - 1 picked in .claude/agents - /alfred-code:configure (Environment) moves them back into the plugin';

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

// The switch itself: no detection code, only the deny and the records each run writes on its own route's line.
const LISTING = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
    .map((name) => ({ id: `${name}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
const CORE_SEATS = placement().plugins[CORE].agents;
const SEAT = 'aspnet-implementer';
const SWITCH_SKILL = 'csharp';
const PICKED = `skill markdown-style\nskill ${SWITCH_SKILL}\nagent ${SEAT}\n`;
const EDIT = '\nhand-edited line\n';
const PROJECT = ['--scope', 'project'];
const ROUTE = { copy: [...PROJECT, '--seats-route', 'copy'], plugin: [...PROJECT, '--seats-route', 'plugin'], plain: PROJECT };
const seatPath = (repo) => claudeFile(repo, path.join('agents', `${SEAT}.md`));
const skillPath = (repo) => claudeFile(repo, path.join('skills', SWITCH_SKILL, 'SKILL.md'));
const stampPath = (repo) => claudeFile(repo, 'alfred-code.stamp');
const seatRecord = (repo) => readLedger(stampPath(repo)).files[`agents/${SEAT}.md`] || readLibrary(stampPath(repo)).agents[SEAT] || null;
const seatDeny = (repo) => ((readJson(claudeFile(repo, LOCAL_FILE)).permissions || {}).deny || []).filter((d) => d.startsWith('Agent(')).sort();
const spelled = (seats) => seats.map((a) => `Agent(${CORE}:${a})`).sort();
const switchRun = (actions, selection, args, each, extra = {}) => seedRun(actions, selection, { plugins: LISTING, env: NO_ROUTE_ENV, args, each, ...extra });

test('the switch to copy and back keeps an edited core seat', POSIX_ONLY, () =>
{
    let recorded;
    let edited;
    const seen = [];
    switchRun(['install', 'update', 'update', 'update', 'update'], PICKED,
        [ROUTE.plugin, ROUTE.copy, ROUTE.plugin, ROUTE.plain, ROUTE.plain], (repo, i) =>
        {
            if (i === 1) { recorded = seatRecord(repo); fs.appendFileSync(seatPath(repo), EDIT); edited = fs.readFileSync(seatPath(repo), 'utf8'); }
            if (i > 1) seen.push({ text: fs.existsSync(seatPath(repo)) && fs.readFileSync(seatPath(repo), 'utf8'), record: seatRecord(repo) });
        });
    assert.ok(recorded, 'the copy route recorded the seat');
    assert.equal(seen.length, 3);
    for (const [i, run] of seen.entries()) assert.deepEqual(run, { text: edited, record: recorded }, `after run ${i + 3}`);
});

test('an edited core seat unpicked on the plugin route survives a switch to copy and back', POSIX_ONLY, () =>
{
    let recorded;
    let edited;
    const seen = [];
    const { outs } = switchRun(['install', 'update', 'update', 'update'], PICKED, [ROUTE.copy, ROUTE.plugin, ROUTE.copy, ROUTE.plugin], (repo, i) =>
    {
        if (i === 0)
        {
            recorded = seatRecord(repo);
            fs.appendFileSync(seatPath(repo), EDIT);
            edited = fs.readFileSync(seatPath(repo), 'utf8');
            fs.writeFileSync(path.join(repo, '..', 'sel.txt'), `skill markdown-style\nskill ${SWITCH_SKILL}\n`);
        }
        else seen.push({ text: fs.existsSync(seatPath(repo)) && fs.readFileSync(seatPath(repo), 'utf8'), record: seatRecord(repo) });
    });
    assert.ok(recorded, 'the copy route recorded the seat');
    for (const [i, run] of seen.entries()) assert.deepEqual(run, { text: edited, record: recorded }, `after run ${i + 2}`);
    assert.match(outs[1], new RegExp(`agent kept: ${SEAT}\\.md - edited in the project since the stack copied it`), 'the unpick on the plugin route names the kept seat');
});

test('the switch writes the deny rows for every core seat, and the switch back writes the unpicked seats\' rows again', POSIX_ONLY, () =>
{
    const { steps } = switchRun(['install', 'update', 'update'], PICKED, [ROUTE.plugin, ROUTE.copy, ROUTE.plugin], seatDeny);
    const [plugin, copy, back] = steps;
    assert.deepEqual(plugin, spelled(CORE_SEATS.filter((a) => a !== SEAT)), 'the plugin route denies the unpicked seats');
    assert.deepEqual(copy, spelled(CORE_SEATS), 'the copy route denies every core seat, the copied one included');
    assert.deepEqual(back, plugin, 'back: the picked seat is allowed again and the unpicked rows are there');
});

test('to copy and back with an edited picked library skill: the switch back refreshes it with the overwrite line', POSIX_ONLY, () =>
{
    let fresh;
    const { outs, result } = switchRun(['install', 'update', 'update'], PICKED, [ROUTE.plugin, ROUTE.copy, ROUTE.plugin], (repo, i) =>
    {
        if (i === 0) fresh = fs.readFileSync(skillPath(repo), 'utf8');
        if (i === 1) fs.appendFileSync(skillPath(repo), EDIT);
    }, { inspect: (repo) => fs.readFileSync(skillPath(repo), 'utf8') });
    assert.ok(outs[2].includes(`  overwriting a hand-edited copy: skill ${SWITCH_SKILL}`), outs[2]);
    assert.equal(result, fresh, 'the switch back refreshes the skill to the stack text');
});

const ROSTER_FILE = path.join('.alfred', 'docs', 'awareness', 'AGENTS-AWARENESS.md');
const UNPICKED_SEAT = 'evidence-gatherer';
const ROSTER_HEAD = '# This project\'s capabilities\n\n## Orchestration skills\n\n## Subagent seats\n';
const rosterPath = (repo) => path.join(repo, ROSTER_FILE);
const layOutRoster = (repo, seats) =>
{
    fs.mkdirSync(path.dirname(rosterPath(repo)), { recursive: true });
    fs.writeFileSync(rosterPath(repo), `${ROSTER_HEAD}${seats.join(', ')}\n\n## MCP routing\n`);
};
const rosterSeats = (repo) =>
{
    const lines = fs.readFileSync(rosterPath(repo), 'utf8').split('\n');
    return lines[lines.indexOf('## Subagent seats') + 1].split(', ');
};

test('after the switch to copy the roster names every copied seat bare, and after the switch back namespaced', POSIX_ONLY, () =>
{
    const { steps } = switchRun(['install', 'update', 'update', 'update'], PICKED, [ROUTE.plugin, ROUTE.copy, ROUTE.plugin, ROUTE.plain],
        (repo, i) =>
        {
            if (i === 0) layOutRoster(repo, [`${CORE}:${SEAT}`, `${CORE}:${UNPICKED_SEAT}`]);
            return i === 0 ? null : { roster: rosterSeats(repo), copied: fs.existsSync(seatPath(repo)) };
        });
    const namespaced = [`${CORE}:${SEAT}`, `${CORE}:${UNPICKED_SEAT}`];
    assert.deepEqual(steps[1], { roster: [SEAT, `${CORE}:${UNPICKED_SEAT}`], copied: true }, 'copy: the copied seat is bare, the unpicked one stays namespaced');
    assert.deepEqual(steps[2], { roster: namespaced, copied: false }, 'plugin again: every seat is namespaced');
    assert.deepEqual(steps[3], { roster: namespaced, copied: false }, 'a plain update changes nothing');
});

// A workspace: the top's deny leaves a member-held seat out and a store record follows the route, so a switch of one project
// would list that seat twice - the flag is refused on the top and on a member, and nothing changes.
const WORKSPACE_REFUSAL = "!! seats route: a workspace's seats route is its top's and members' together - not switched here";
const MEMBER = 'api';
const WORKSPACE_ENV = { ...NO_ROUTE_ENV, ALFRED_CODE_WORKSPACE: '1' };
const TIME_LINE = /^installed(-ms)?: .*$/gm;
const layOutWorkspace = (repo) =>
{
    const member = path.join(repo, MEMBER);
    fs.mkdirSync(member);
    rt.execCommand('git', ['init', '-q', member]);
    putWorkspace(repo, { children: [MEMBER] });
    putWorkspace(member, { parent: '..' });
};
// Every file under the top with its size and hash, `.git/` left out and the stamps' two run times blanked.
function hashTree(dir)
{
    const rows = [];
    const walk = (folder) =>
    {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const file = path.join(folder, entry.name);
            if (entry.name === '.git') continue;
            if (entry.isDirectory()) { walk(file); continue; }
            if (entry.isSymbolicLink()) { rows.push(`${path.relative(dir, file)} -> ${fs.readlinkSync(file)}`); continue; }
            const body = entry.name === 'alfred-code.stamp' ? Buffer.from(fs.readFileSync(file, 'utf8').replace(TIME_LINE, '')) : fs.readFileSync(file);
            rows.push(`${path.relative(dir, file)} ${body.length} ${crypto.createHash('sha256').update(body).digest('hex')}`);
        }
    };
    walk(dir);
    return rows.join('\n');
}

test('install-seats-route: --seats-route on a workspace top or member prints the refusal and changes no file', POSIX_ONLY, () =>
{
    const flagged = [...PROJECT, '--seats-route', 'copy'];
    const { outs, steps } = seedRun(['install', 'install', 'update', 'update', 'update', 'update'], SELECTION, {
        env: WORKSPACE_ENV, prepare: layOutWorkspace, each: (repo) => hashTree(repo),
        cwds: ['repo', `repo/${MEMBER}`, 'repo', `repo/${MEMBER}`, 'repo', `repo/${MEMBER}`],
        args: [PROJECT, PROJECT, PROJECT, PROJECT, flagged, flagged],
    });
    assert.ok(!outs.slice(0, 4).some((o) => o.includes(WORKSPACE_REFUSAL)), 'no refusal without the flag');
    assert.ok(outs[4].includes(WORKSPACE_REFUSAL), `top: ${outs[4]}`);
    assert.ok(outs[5].includes(WORKSPACE_REFUSAL), `member: ${outs[5]}`);
    assert.equal(steps[4], steps[3], 'the flag on the top changed a file');
    assert.equal(steps[5], steps[3], 'the flag on the member changed a file');
});

test('install-seats-route: a standalone project (no record, no links) takes --seats-route and is not refused', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', SELECTION, {
        env: WORKSPACE_ENV, args: [...PROJECT, '--seats-route', 'copy'], inspect: (repo) => seen(repo),
    });
    assert.ok(!out.includes(WORKSPACE_REFUSAL), out);
    assert.deepEqual(result, { value: 'false', ledgered: true });
});

test('install-seats-route: a first install of a joined child with --seats-route is refused like a later run', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'install'], SELECTION, {
        env: WORKSPACE_ENV, prepare: layOutWorkspace, cwds: ['repo', `repo/${MEMBER}`],
        args: [PROJECT, [...PROJECT, '--seats-route', 'copy']],
        each: (repo, i) => (i === 1 ? localEnvOf(path.join(repo, MEMBER)) : null),
    });
    assert.ok(outs[1].includes(WORKSPACE_REFUSAL), outs[1]);
    assert.equal(steps[1][KEY], undefined, 'no route key written');
});

test('the switch back leaves the ledger\'s managed-deny as the plugin run wrote it, and a hand-written seat deny row survives the round trip', POSIX_ONLY, () =>
{
    const HAND_ROW = `Agent(${CORE}:${UNPICKED_SEAT})`;
    const denyOf = (repo) => readLedger(stampPath(repo)).deny;
    const { steps } = switchRun(['install', 'update', 'update'], PICKED, [ROUTE.plugin, ROUTE.copy, ROUTE.plugin],
        (repo, i) => ({ ledger: [...denyOf(repo)].sort(), file: seatDeny(repo).includes(HAND_ROW) }),
        { prepare: (repo) => { fs.mkdirSync(claudeFile(repo, ''), { recursive: true }); fs.writeFileSync(claudeFile(repo, LOCAL_FILE), JSON.stringify({ permissions: { deny: [HAND_ROW] } })); } });
    assert.deepEqual(steps[2].ledger, steps[0].ledger, 'the same managed-deny entries after the round trip');
    for (const [i, step] of steps.entries()) assert.ok(step.file, `the hand-written row is still in the file after run ${i + 1}`);
});
