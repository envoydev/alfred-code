'use strict';
// A project's own skill under a catalog name gets no copy-route row, and a switch to the plugin route never overwrites it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { readLedger } = require('./install/stamp.js');
const { hashItem } = require('./install/library.js');

const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
const SKILL = 'csharp';
const OWN_TEXT = '---\nname: csharp\ndescription: my own notes\n---\nthe project\'s own words\n';
const SCOPE = ['--scope', 'project'];
const LISTING = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
    .map((name) => ({ id: `${name}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
const KEPT_LINE = `!! skill kept: ${SKILL} - a project skill of that name the stamp does not record, so it is yours`;

const ownFile = (repo) => path.join(repo, '.claude', 'skills', SKILL, 'SKILL.md');
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const layOwn = (repo) => { fs.mkdirSync(path.dirname(ownFile(repo)), { recursive: true }); fs.writeFileSync(ownFile(repo), OWN_TEXT); };
const rowOf = (repo) => (readLedger(stampOf(repo)).files || {})[`skills/${SKILL}`];
const layRow = (repo) =>
{
    const text = fs.readFileSync(stampOf(repo), 'utf8');
    const row = `skills/${SKILL}=${hashItem(path.dirname(ownFile(repo)))}`;
    fs.writeFileSync(stampOf(repo), /^managed-files:/m.test(text) ? text.replace(/^managed-files:(.*)$/m, (_, rest) => `managed-files:${rest.trim() ? `${rest},` : ' '}${row}`) : `${text.replace(/\n*$/, '\n')}managed-files: ${row}\n`);
};

test('a project\'s own skill named like a pick is kept on the copy route and gets no managed-files row', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', `skill ${SKILL}\n`, {
        env: { [KEY]: 'false' }, args: SCOPE, prepare: layOwn,
        inspect: (repo) => ({ text: fs.readFileSync(ownFile(repo), 'utf8'), row: rowOf(repo) }),
    });
    assert.ok(out.includes(KEPT_LINE), out);
    assert.equal(result.text, OWN_TEXT);
    assert.equal(result.row, undefined, 'no row records the project\'s file as the stack\'s');
});

test('a switch to the plugin route leaves a project\'s own skill byte-identical and names it again', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update'], `skill ${SKILL}\n`, {
        env: { [KEY]: undefined }, plugins: LISTING, args: [[...SCOPE, '--seats-route', 'copy'], [...SCOPE, '--seats-route', 'plugin']], prepare: layOwn,
        inspect: (repo) => fs.readFileSync(ownFile(repo), 'utf8'),
    });
    assert.equal(result, OWN_TEXT);
    assert.ok(outs[1].includes(KEPT_LINE), outs[1]);
    assert.doesNotMatch(outs[1], /overwriting a hand-edited copy: skill csharp/);
});

test('a managed-files row an earlier build wrote for a project\'s own skill is no record: the switch leaves the file and drops the row', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update', 'update'], `skill ${SKILL}\n`, {
        env: { [KEY]: undefined }, plugins: LISTING,
        args: [[...SCOPE, '--seats-route', 'copy'], [...SCOPE, '--seats-route', 'plugin'], SCOPE], prepare: layOwn,
        each: (repo, i) => { if (i === 0) layRow(repo); },
        inspect: (repo) => ({ text: fs.readFileSync(ownFile(repo), 'utf8'), row: rowOf(repo) }),
    });
    assert.equal(result.text, OWN_TEXT);
    assert.equal(result.row, undefined);
});
