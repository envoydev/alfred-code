'use strict';
// One edit policy for a skill or seat copy, copy-route half: a run refreshes a picked copy the project edited,
// names the overwrite, and keeps the record of a copy it did not rewrite (the carry invariant).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger } = require('./install/stamp.js');
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
const seatFile = (repo, seat) => path.join(repo, '.claude', 'agents', `${seat}.md`);
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const ledgerRow = (repo, row) => readLedger(stampOf(repo)).files[row];
const append = (file, text = EDIT) => fs.appendFileSync(file, text);
const setSelection = (repo, text) => fs.writeFileSync(path.join(repo, '..', 'sel.txt'), text);

function runs(actions, selection, { args, each, env = COPY_ROUTE, inspect } = {})
{
    return seedRun(actions, selection, { args: args || actions.map(() => ['--scope', 'project']), env, each, inspect });
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
