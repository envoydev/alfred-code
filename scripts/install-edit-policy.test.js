'use strict';
// One edit policy for a skill or seat copy, copy-route half: a run refreshes a picked copy the project edited,
// names the overwrite, and keeps the record of a copy it did not rewrite (the carry invariant).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger, readLibrary } = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');

const COPY_ROUTE = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const SKILL = 'csharp';
const SEAT_A = 'evidence-gatherer';
const SEAT_B = 'code-quality-analyzer';
const BOTH = `skill ${SKILL}\nagent ${SEAT_A}\nagent ${SEAT_B}\n`;
const ONLY_A = `skill ${SKILL}\nagent ${SEAT_A}\n`;
const EDIT = '\nhand-edited line\n';
const overwriteLine = (kind, name) => `  overwriting a hand-edited copy: ${kind} ${name}`;
const OVERWRITE_ANY = /overwriting a hand-edited copy:/;

const skillFile = (repo) => path.join(repo, '.claude', 'skills', SKILL, 'SKILL.md');
const seatFile = (repo, seat) => path.join(repo, '.claude', 'agents', seat, `${seat}.md`);
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const ledgerRow = (repo, row) => readLedger(stampOf(repo)).files[row];
const append = (file, text = EDIT) => fs.appendFileSync(file, text);
const setSelection = (repo, text) => fs.writeFileSync(path.join(repo, '..', 'sel.txt'), text);

function runs(actions, selection, { args, each, env = COPY_ROUTE, inspect, plugins, prepare } = {})
{
    return seedRun(actions, selection, { args: args || actions.map(() => ['--scope', 'project']), env, each, inspect, ...(plugins ? { plugins } : {}), ...(prepare ? { prepare } : {}) });
}

test('copy route: an edited picked skill is refreshed and the run names the overwrite', POSIX_ONLY, () =>
{
    let fresh;
    const { outs, result } = runs(['install', 'update'], BOTH, {
        each: (repo, i) => { if (i === 0) { fresh = fs.readFileSync(skillFile(repo), 'utf8'); append(skillFile(repo)); } },
        inspect: (repo) => fs.readFileSync(skillFile(repo), 'utf8'),
    });
    assert.ok(outs[1].includes(overwriteLine('skill', SKILL)), outs[1]);
    assert.equal(result, fresh, 'the copy is the stack\'s again');
});

test('copy route: an unedited copy is refreshed with no overwrite line', POSIX_ONLY, () =>
{
    const { outs } = runs(['install', 'update'], BOTH);
    assert.doesNotMatch(outs[1], OVERWRITE_ANY);
});

test('copy route: an edited picked seat is refreshed and named', POSIX_ONLY, () =>
{
    let fresh;
    const { outs, result } = runs(['install', 'update'], BOTH, {
        each: (repo, i) => { if (i === 0) { fresh = fs.readFileSync(seatFile(repo, SEAT_A), 'utf8'); append(seatFile(repo, SEAT_A)); } },
        inspect: (repo) => fs.readFileSync(seatFile(repo, SEAT_A), 'utf8'),
    });
    assert.ok(outs[1].includes(overwriteLine('agent', SEAT_A)), outs[1]);
    assert.equal(result, fresh);
    assert.ok(!outs[1].includes(overwriteLine('agent', SEAT_B)), 'the untouched seat is not named');
});

test('copy route: an edited seat unpicked in the same run keeps its record', POSIX_ONLY, () =>
{
    const row = `agents/${SEAT_B}.md`;
    let before;
    let edited;
    const seen = [];
    runs(['install', 'update', 'update'], BOTH, {
        each: (repo, i) =>
        {
            if (i === 0)
            {
                before = ledgerRow(repo, row);
                append(seatFile(repo, SEAT_B));
                edited = fs.readFileSync(seatFile(repo, SEAT_B), 'utf8');
                setSelection(repo, ONLY_A);
            }
            else seen.push({ file: fs.readFileSync(seatFile(repo, SEAT_B), 'utf8'), row: ledgerRow(repo, row), rowA: ledgerRow(repo, `agents/${SEAT_A}.md`) });
        },
    });
    assert.ok(before, 'the install recorded the seat');
    for (const run of seen)
    {
        assert.equal(run.file, edited, 'the unpicked, edited seat is left as the project has it');
        assert.equal(run.row, before, 'its row still holds the hash recorded before the edit');
        assert.ok(run.rowA, 'the picked seat keeps its row');
    }
    assert.equal(seen.length, 2);
});

test('copy route: a stamp with no managed-files line refreshes with no line', POSIX_ONLY, () =>
{
    let fresh;
    const { outs, result } = runs(['install', 'update'], BOTH, {
        each: (repo, i) =>
        {
            if (i !== 0) return;
            fresh = fs.readFileSync(skillFile(repo), 'utf8');
            append(skillFile(repo));
            const lines = fs.readFileSync(stampOf(repo), 'utf8').split('\n').filter((l) => !l.startsWith('managed-files:'));
            fs.writeFileSync(stampOf(repo), lines.join('\n'));
        },
        inspect: (repo) => fs.readFileSync(skillFile(repo), 'utf8'),
    });
    assert.doesNotMatch(outs[1], OVERWRITE_ANY);
    assert.equal(result, fresh, 'the copy is refreshed as before');
});

test('copy route: --keep-pins restores a hand-set model pin after the refresh', POSIX_ONLY, () =>
{
    const { outs, result } = runs(['install', 'update'], BOTH, {
        args: [['--scope', 'project'], ['--scope', 'project', '--keep-pins']],
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const file = seatFile(repo, SEAT_A);
            const text = fs.readFileSync(file, 'utf8');
            assert.match(text, /^model: sonnet$/m);
            fs.writeFileSync(file, text.replace(/^model: sonnet$/m, 'model: haiku'));
        },
        inspect: (repo) => fs.readFileSync(seatFile(repo, SEAT_A), 'utf8'),
    });
    assert.ok(outs[1].includes(overwriteLine('agent', SEAT_A)), outs[1]);
    assert.match(result, /^model: haiku$/m);
});

test('copy route: the stamp row of a refreshed copy is the hash of the refreshed file', POSIX_ONLY, () =>
{
    const { result } = runs(['install', 'update'], BOTH, {
        each: (repo, i) => { if (i === 0) append(seatFile(repo, SEAT_A)); },
        inspect: (repo) => ({ row: ledgerRow(repo, `agents/${SEAT_A}.md`), now: hashItem(seatFile(repo, SEAT_A)) }),
    });
    assert.equal(result.row, result.now);
});

// Plugin-route half, the retired prune and a project's own seat file.

const PLUGIN_ROUTE = {};const LISTING = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
    .map((name) => ({ id: `${name}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
const SEAT_CORE = 'aspnet-implementer';
const SOURCE_AGENTS = path.join(__dirname, '..', 'stack', 'agents');
const stampText = (repo) => fs.readFileSync(stampOf(repo), 'utf8');
const setStampLine = (repo, key, value) =>
{
    const text = stampText(repo);
    const line = `${key}: ${value}`;
    fs.writeFileSync(stampOf(repo), new RegExp(`^${key}:.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}:.*$`, 'm'), line) : `${text.replace(/\n*$/, '\n')}${line}\n`);
};
const addToLine = (repo, key, row) =>
{
    const have = (new RegExp(`^${key}: ?(.*)$`, 'm').exec(stampText(repo)) || [])[1] || '';
    setStampLine(repo, key, [have, row].filter(Boolean).join(','));
};
// A seat copy an older release left: the stack's text in `.claude/agents`, its hash on the line the test names.
function plantSeat(repo, seat, key)
{
    fs.mkdirSync(path.dirname(seatFile(repo, seat)), { recursive: true });
    fs.copyFileSync(path.join(SOURCE_AGENTS, `${seat}.md`), seatFile(repo, seat));
    const row = key === 'managed-files' ? `agents/${seat}.md=${hashItem(seatFile(repo, seat))}` : `${seat}=${hashItem(seatFile(repo, seat))}`;
    addToLine(repo, key, row);
}
const library = (repo) => readLibrary(stampOf(repo));

test('plugin route: an edited library skill and seat, then unpicked, are kept and named, and kept by a second update', POSIX_ONLY, () =>
{
    let before;
    const seen = [];
    const { outs } = runs(['install', 'update', 'update'], `skill ${SKILL}\nskill markdown-style\n`, {
        env: PLUGIN_ROUTE, plugins: LISTING,
        each: (repo, i) =>
        {
            if (i === 0)
            {
                plantSeat(repo, SEAT_CORE, 'library-agents');
                before = { skill: library(repo).skills[SKILL], seat: library(repo).agents[SEAT_CORE] };
                append(skillFile(repo));
                append(seatFile(repo, SEAT_CORE));
                setSelection(repo, 'skill markdown-style\n');
            }
            else seen.push({ lib: library(repo), skill: fs.existsSync(skillFile(repo)), seat: fs.existsSync(seatFile(repo, SEAT_CORE)) });
        },
        inspect: () => null,
    });
    for (const [i, run] of seen.entries())
    {
        assert.ok(run.skill && run.seat, `run ${i + 1}: both edited copies stay`);
        assert.equal(run.lib.skills[SKILL], before.skill, 'the skill keeps the hash recorded before the edit');
        assert.equal(run.lib.agents[SEAT_CORE], before.seat, 'the seat keeps the hash recorded before the edit');
    }
    assert.ok(outs[1].includes(`  skill kept: ${SKILL} - edited in the project since the stack copied it, so it is yours - delete it to drop it`), outs[1]);
    assert.match(outs[1], new RegExp(`agent kept: ${SEAT_CORE}\\.md - edited in the project`));
    assert.ok(outs[2].includes(`  skill kept: ${SKILL} - edited in the project since the stack copied it, so it is yours - delete it to drop it`), outs[2]);
});

test('plugin route: an edited core seat recorded only in managed-files is kept by keptSeats', POSIX_ONLY, () =>
{
    let row;
    const { outs, result } = runs(['install', 'update'], 'skill markdown-style\n', {
        env: PLUGIN_ROUTE, plugins: LISTING,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            plantSeat(repo, SEAT_CORE, 'managed-files');
            row = ledgerRow(repo, `agents/${SEAT_CORE}.md`);
            append(seatFile(repo, SEAT_CORE));
        },
        inspect: (repo) => ({ exists: fs.existsSync(seatFile(repo, SEAT_CORE)), lib: library(repo).agents[SEAT_CORE] }),
    });
    assert.match(outs[1], new RegExp(`agent kept: ${SEAT_CORE}\\.md - edited in the project`), outs[1]);
    assert.equal(result.exists, true);
    assert.equal(result.lib, row, 'the recorded hash is carried');
});

test('a stamp with no managed-files line: a core-seat copy with no record is refreshed on the copy route, as today', POSIX_ONLY, () =>
{
    const { outs, result } = runs(['install', 'update'], BOTH, {
        each: (repo, i) =>
        {
            if (i !== 0) return;
            fs.writeFileSync(seatFile(repo, SEAT_B), 'a seat of the project\'s own\n');
            const lines = stampText(repo).split('\n').filter((l) => !l.startsWith('managed-files:') && !l.startsWith('library-agents:'));
            fs.writeFileSync(stampOf(repo), lines.join('\n'));
        },
        inspect: (repo) => fs.readFileSync(seatFile(repo, SEAT_B), 'utf8'),
    });
    assert.doesNotMatch(outs[1], /!! agent kept/);
    assert.notEqual(result, 'a seat of the project\'s own\n', 'the copy is refreshed as before');
});

test('plugin route after the copy route: an edited picked library skill is refreshed with the overwrite line', POSIX_ONLY, () =>
{
    const { outs, result } = runs(['install', 'update'], BOTH, {
        env: [COPY_ROUTE, PLUGIN_ROUTE], plugins: LISTING,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            setStampLine(repo, 'library-skills', '');
            assert.ok(ledgerRow(repo, `skills/${SKILL}`), 'the copy route recorded the skill in managed-files');
            append(skillFile(repo));
        },
        inspect: (repo) => fs.readFileSync(skillFile(repo), 'utf8'),
    });
    assert.ok(outs[1].includes(overwriteLine('skill', SKILL)), outs[1]);
    assert.doesNotMatch(outs[1], /taking over a copy the stamp did not record/);
    assert.doesNotMatch(result, /hand-edited line/);
});

const OWN_TEXT = '---\nname: evidence-gatherer\ndescription: the project\'s own seat\n---\nmy own text\n';
const OWN_LINE = `  !! agent kept: ${SEAT_A}.md - a project seat of that name the stamp does not record, so it is yours; the stack's ${SEAT_A} is not installed here - rename or remove yours to take it`;

for (const order of [['copy', 'plugin'], ['plugin', 'copy']])
{
    test(`a project's own seat named like a core seat is kept and named on both routes and on a route change: ${order.join(' then ')}`, POSIX_ONLY, () =>
    {
        const routes = [order[0], order[0], order[1], order[1]];
        const { outs, steps } = runs(['install', 'update', 'update', 'update'], ONLY_A, {
            env: routes.map((r) => (r === 'copy' ? COPY_ROUTE : PLUGIN_ROUTE)), plugins: LISTING,
            prepare: (repo) => { fs.mkdirSync(path.dirname(seatFile(repo, SEAT_A)), { recursive: true }); fs.writeFileSync(seatFile(repo, SEAT_A), OWN_TEXT); },
            each: (repo) => ({ bytes: fs.existsSync(seatFile(repo, SEAT_A)) ? fs.readFileSync(seatFile(repo, SEAT_A), 'utf8') : null, row: ledgerRow(repo, `agents/${SEAT_A}.md`) || null, lib: library(repo).agents[SEAT_A] || null }),
        });
        for (const [i, route] of routes.entries())
        {
            assert.ok(outs[i].includes(OWN_LINE), `run ${i + 1} (${route}):\n${outs[i]}`);
            assert.equal(steps[i].bytes, OWN_TEXT, `run ${i + 1}: the file is as the project wrote it`);
            assert.deepEqual([steps[i].row, steps[i].lib], [null, null], `run ${i + 1}: no record names it`);
        }
    });
}

// Names the manifest's `retired` lists carry today; a skill and a seat are edited, a second pair is left as the stack wrote it.
const RETIRED = { skillEdited: 'frontend', skillPlain: 'mobile', seatEdited: 'angular-implementer', seatPlain: 'angular-verifier' };
function plantRetired(repo, route)
{
    const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
    for (const n of [RETIRED.skillEdited, RETIRED.skillPlain]) write(`.claude/skills/${n}/SKILL.md`, `---\nname: ${n}\ndescription: old\n---\n`);
    for (const n of [RETIRED.seatEdited, RETIRED.seatPlain]) write(`.claude/agents/${n}.md`, `---\nname: ${n}\n---\nold\n`);
    const skills = [RETIRED.skillEdited, RETIRED.skillPlain].map((n) => [n, hashItem(path.join(repo, '.claude', 'skills', n))]);
    const seats = [RETIRED.seatEdited, RETIRED.seatPlain].map((n) => [n, hashItem(path.join(repo, '.claude', 'agents', `${n}.md`))]);
    const lines = route === 'copy'
        ? ['hooks-route: copy', `managed-files: ${[...skills.map(([n, h]) => `skills/${n}=${h}`), ...seats.map(([n, h]) => `agents/${n}.md=${h}`)].join(',')}`]
        : ['hooks-route: plugin', 'seats-route: plugin', `library-skills: ${skills.map(([n, h]) => `${n}=${h}`).join(',')}`, `library-agents: ${seats.map(([n, h]) => `${n}=${h}`).join(',')}`];
    write('.claude/alfred-code.stamp', `version: 2.0.0\nsha: 0000000\n${lines.join('\n')}\n`);
    fs.appendFileSync(path.join(repo, '.claude', 'skills', RETIRED.skillEdited, 'SKILL.md'), EDIT);
    fs.appendFileSync(path.join(repo, '.claude', 'agents', `${RETIRED.seatEdited}.md`), EDIT);
    return { skill: skills[0][1], seat: seats[0][1] };
}

test('retired: an edited skill and seat are kept on both routes and by a second update; unedited ones are pruned', POSIX_ONLY, () =>
{
    for (const route of ['copy', 'plugin'])
    {
        let recorded;
        const { outs, steps } = seedRun(['update', 'update'], '', {
            env: route === 'copy' ? COPY_ROUTE : PLUGIN_ROUTE, plugins: LISTING, args: ['--installed-only'],
            prepare: (repo) => { recorded = plantRetired(repo, route); },
            each: (repo) =>
            {
                const has = (rel) => fs.existsSync(path.join(repo, '.claude', rel));
                return { skill: has(`skills/${RETIRED.skillEdited}`), seat: has(`agents/${RETIRED.seatEdited}.md`), skillPlain: has(`skills/${RETIRED.skillPlain}`), seatPlain: has(`agents/${RETIRED.seatPlain}.md`),
                    row: route === 'copy' ? [ledgerRow(repo, `skills/${RETIRED.skillEdited}`), ledgerRow(repo, `agents/${RETIRED.seatEdited}.md`)] : [library(repo).skills[RETIRED.skillEdited], library(repo).agents[RETIRED.seatEdited]] };
            },
        });
        for (const [i, run] of steps.entries())
        {
            assert.deepEqual({ ...run, row: null }, { skill: true, seat: true, skillPlain: false, seatPlain: false, row: null }, `${route} run ${i + 1}:\n${outs[i]}`);
            assert.deepEqual(run.row, [recorded.skill, recorded.seat], `${route} run ${i + 1}: the recorded hashes are carried`);
        }
        assert.ok(outs[0].includes(`!! skill kept: ${RETIRED.skillEdited} - retired upstream, but edited since the stack wrote it`), outs[0]);
        assert.ok(outs[0].includes(`!! agent kept: ${RETIRED.seatEdited}.md - retired upstream, but edited since the stack wrote it`), outs[0]);
    }
});

// A workspace member's copy of a seat its top holds ('linked from above'): the run never rewrites it, so a hand edit stays and its record with it.
const wsLib = require('./install/workspace.js');
const rt = require('./install/runtime.js');

const MEMBER = 'api';
const memberStamp = (ws) => stampOf(path.join(ws, MEMBER));
const memberSeat = (ws) => seatFile(path.join(ws, MEMBER), SEAT_A);const rowsOf = (ws) => ((fs.existsSync(memberStamp(ws)) && readLedger(memberStamp(ws))) || {}).files || {};

// Top and member, both on the copy route; the member's link to the top's seat becomes its own edited copy, recorded on one line only.
function memberRuns(recordOn)
{
    let recorded;
    const join = (ws, work) =>
    {
        rt.execCommand('git', ['init', '-q', path.join(ws, MEMBER)]);
        const env = { CLAUDE_CONFIG_DIR: path.join(work, 'acct') };
        assert.ok(wsLib.writeWorkspace(path.join(ws, MEMBER), (m) => wsLib.setParent(m, '..'), { env }).ok);
        assert.ok(wsLib.writeWorkspace(ws, (m) => wsLib.addChild(m, MEMBER), { env }).ok);
    };
    const ownEditedCopy = (ws) =>
    {
        const text = fs.readFileSync(memberSeat(ws), 'utf8');
        fs.unlinkSync(path.dirname(memberSeat(ws)));   // the link to the top's seat folder
        fs.mkdirSync(path.dirname(memberSeat(ws)));
        fs.writeFileSync(memberSeat(ws), text);
        recorded = hashItem(memberSeat(ws));
        const rows = Object.entries(rowsOf(ws)).filter(([row]) => row !== `agents/${SEAT_A}.md`).map(([row, hash]) => `${row}=${hash}`);
        const lines = fs.readFileSync(memberStamp(ws), 'utf8').split('\n').filter((l) => !/^(links|managed-files|library-agents):/.test(l));
        const library = recordOn === 'library';
        const files = `managed-files: ${[...rows, ...(library ? [] : [`agents/${SEAT_A}.md=${recorded}`])].join(',')}`;
        fs.writeFileSync(memberStamp(ws), [...lines, files, library ? `library-agents: ${SEAT_A}=${recorded}` : ''].filter(Boolean).join('\n') + '\n');
        append(memberSeat(ws));
    };
    const plan = [{ at: '', act: 'install' }, { at: MEMBER, act: 'install', before: join }, { at: MEMBER, act: 'update', before: ownEditedCopy }, { at: MEMBER, act: 'update' }];
    const out = seedRun(plan.map((s) => s.act), '', {
        plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]),
        cwds: plan.map((s) => path.join('ws', s.at)),
        env: plan.map(() => ({ ...COPY_ROUTE, ALFRED_CODE_WORKSPACE: '1' })),
        args: plan.map((s, i) => (repo, work) =>
        {
            if (s.before) s.before(path.join(work, 'ws'), work);
            const selection = path.join(work, `sel-${i}.txt`);
            fs.writeFileSync(selection, 'skill javascript\nrule alfred-security\nagent evidence-gatherer\n');
            return s.act === 'install' ? ['--selection', selection, '--scope', 'local'] : ['--installed-only', '--scope', 'local'];
        }),
        prepare: (repo, work) => fs.mkdirSync(path.join(work, 'ws'), { recursive: true }),
        each: (repo) => { const ws = path.join(path.dirname(repo), 'ws'); return { text: fs.existsSync(memberSeat(ws)) ? fs.readFileSync(memberSeat(ws), 'utf8') : null, row: rowsOf(ws)[`agents/${SEAT_A}.md`] || null, lib: fs.existsSync(memberStamp(ws)) ? (library(path.join(ws, MEMBER)).agents[SEAT_A] || null) : null }; },
    });
    return { ...out, recorded };
}

test('a workspace member\'s edited copy recorded only on the library line is kept by pruneAway', POSIX_ONLY, () =>
{
    const { outs, steps } = memberRuns('library');
    for (const i of [2, 3]) assert.ok(steps[i].text && steps[i].text.endsWith(EDIT), `run ${i + 1}: the member's edited copy stays:\n${outs[i]}`);
    assert.match(outs[2], new RegExp(`!! agent kept: ${SEAT_A}\\.md - linked from above, but edited here`), outs[2]);
});

test('copy route: a member\'s away seat copy the run did not rewrite keeps its recorded row, not the edited hash', POSIX_ONLY, () =>
{
    for (const recordOn of ['library', 'managed-files'])
    {
        const { steps, recorded } = memberRuns(recordOn);
        for (const i of [2, 3]) assert.equal(steps[i].row, recorded, `${recordOn} run ${i + 1}: the row is the recorded hash`);
    }
});
