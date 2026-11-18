'use strict';
// Configure's unpick (`update --installed-only --drop '<kind> <name>'`) deletes only a copy the stack still owns: a skill or
// seat copy edited since its record, or a project's own seat file, is kept and named, and its record survives the run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger, readLibrary } = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');

const SKILL = 'csharp';
const OTHER_SKILL = 'markdown-style';
const SEAT = 'evidence-gatherer';
const SELECTION = `skill ${SKILL}\nskill ${OTHER_SKILL}\nagent ${SEAT}\n`;
const EDIT = '\nhand-edited line\n';
const SCOPE = ['--scope', 'project'];
const INSTALLED = [...SCOPE, '--installed-only'];
const DROP_BOTH = [...INSTALLED, '--drop', `skill ${SKILL}`, '--drop', `agent ${SEAT}`];
const ROUTES = {
    copy: { env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' }, plugins: undefined },
    plugin: { env: {}, plugins: JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
        .map((name) => ({ id: `${name}@envoydev`, version: '2.0.0', scope: 'project', enabled: true }))) },
};
const SOURCE_AGENTS = path.join(__dirname, '..', 'stack', 'agents');

const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const skillFile = (repo) => path.join(repo, '.claude', 'skills', SKILL, 'SKILL.md');
const seatFile = (repo) => path.join(repo, '.claude', 'agents', `${SEAT}.md`);
const append = (file) => fs.appendFileSync(file, EDIT);
const keptSkillLine = `  skill kept: ${SKILL} - edited in the project since the stack copied it, so it is yours - delete it to drop it`;
const keptSeatLine = `  agent kept: ${SEAT}.md - edited in the project since the stack copied it, so it is yours`;
const KEPT_ONLY = `skill ${OTHER_SKILL}\n`;

// What the stamp records for the two copies, on either line.
function recordsOf(repo)
{
    const library = readLibrary(stampOf(repo)) || {};
    const rows = readLedger(stampOf(repo)).files || {};
    return { skill: (library.skills || {})[SKILL] || rows[`skills/${SKILL}`] || null, seat: (library.agents || {})[SEAT] || rows[`agents/${SEAT}.md`] || null };
}
const stateOf = (repo) => ({
    skill: fs.existsSync(skillFile(repo)) ? fs.readFileSync(skillFile(repo), 'utf8') : null,
    seat: fs.existsSync(seatFile(repo)) ? fs.readFileSync(seatFile(repo), 'utf8') : null,
    records: recordsOf(repo),
});

// The plugin route copies no seat of its own: lay an older release's library copy down so the drop has one to meet.
function plantSeat(repo)
{
    fs.mkdirSync(path.dirname(seatFile(repo)), { recursive: true });
    fs.copyFileSync(path.join(SOURCE_AGENTS, `${SEAT}.md`), seatFile(repo));
    const text = fs.readFileSync(stampOf(repo), 'utf8').replace(/\n*$/, '\n');
    const line = `library-agents: ${SEAT}=${hashItem(seatFile(repo))}`;
    fs.writeFileSync(stampOf(repo), /^library-agents:/m.test(text) ? text.replace(/^library-agents:.*$/m, line) : `${text}${line}\n`);
}

function dropRun(route, { edit })
{
    const { env, plugins } = ROUTES[route];
    let before;
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env, args: [SCOPE, DROP_BOTH, SCOPE], ...(plugins ? { plugins } : {}),
        each: (repo, i) =>
        {
            if (i === 1) fs.writeFileSync(path.join(repo, '..', 'sel.txt'), KEPT_ONLY);
            if (i === 0)
            {
                if (route === 'plugin') plantSeat(repo);
                if (edit) { append(skillFile(repo)); append(seatFile(repo)); }
                before = stateOf(repo);
            }
            return stateOf(repo);
        },
    });
    return { outs, steps, before };
}

for (const route of Object.keys(ROUTES))
{
    test(`drop-keep, ${route} route: an edited skill and seat copy dropped through configure are kept, named, and keep their record`, POSIX_ONLY, () =>
    {
        const { outs, steps, before } = dropRun(route, { edit: true });
        assert.ok(outs[1].includes(keptSkillLine), outs[1]);
        assert.ok(outs[1].includes(keptSeatLine), outs[1]);
        assert.doesNotMatch(outs[1], /(skill|agent) removed \(dropped\)/);
        for (const [i, step] of steps.slice(1).entries())
        {
            assert.equal(step.skill, before.skill, `run ${i + 2}: the skill copy is unchanged`);
            assert.equal(step.seat, before.seat, `run ${i + 2}: the seat copy is unchanged`);
            assert.deepEqual(step.records, before.records, `run ${i + 2}: both records survive in the stamp`);
        }
        assert.ok(before.records.skill && before.records.seat, 'the records exist');
    });

    test(`drop-keep, ${route} route: an unedited copy dropped the same way is still removed`, POSIX_ONLY, () =>
    {
        const { outs, steps } = dropRun(route, { edit: false });
        assert.ok(outs[1].includes(`  skill removed (dropped): ${SKILL}`), outs[1]);
        assert.ok(outs[1].includes(`  agent removed (dropped): ${SEAT}`), outs[1]);
        assert.equal(steps[1].skill, null);
        assert.equal(steps[1].seat, null);
    });

    test(`drop-keep, ${route} route: a project's own seat file named like a core seat is kept when dropped`, POSIX_ONLY, () =>
    {
        const { env, plugins } = ROUTES[route];
        const OWN = '---\nname: evidence-gatherer\ndescription: mine\n---\nmy own seat\n';
        const { out, result } = seedRun(['install', 'update'], `skill ${SKILL}\n`, {
            env, args: [SCOPE, DROP_BOTH], ...(plugins ? { plugins } : {}),
            each: (repo, i) => { if (i === 0) { fs.mkdirSync(path.dirname(seatFile(repo)), { recursive: true }); fs.writeFileSync(seatFile(repo), OWN); } },
            inspect: (repo) => (fs.existsSync(seatFile(repo)) ? fs.readFileSync(seatFile(repo), 'utf8') : null),
        });
        assert.equal(result, OWN, 'the own seat file is untouched');
        assert.match(out, new RegExp(`!! agent kept: ${SEAT}\\.md - a project seat of that name the stamp does not record`));
        assert.doesNotMatch(out, /agent removed \(dropped\)/);
    });
}
