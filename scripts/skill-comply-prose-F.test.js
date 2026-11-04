'use strict';
// Group F of the 2026-11-04 prose A/B round - the always-on preferences rule: U19b (a correction to an entry is named
// back as /capture-preferences, never kept in memory alone) and U19c (list the branches before naming a new one). The
// prose pins, and the offline proof that each new fixture step passes a trace that keeps it and fails one that breaks
// it, before any billed run. Its fixtures ship or leave with the group's verdict: 'preferences-git-correction',
// 'preferences-branch-pattern' (and the _shared/git-prefs-repo.sh both source).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RULE = 'stack/rules/alfred-preferences.md';

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('U19b: a correction to an entry is named back too, never kept in memory alone', () =>
{
    const line = read(RULE).split('\n').find((l) => l.startsWith('- A personal, code, architecture or git preference the user states in chat'));
    assert.ok(line.endsWith('only the preferences docs reach every session. A correction to an entry is the same: follow it now and name the command back - never keep it in memory alone, where the doc keeps the stale entry.'));
});

test('U19c: list the branches before naming a new one, after the read-the-docs bullet', () =>
{
    const lines = read(RULE).split('\n');
    const docs = lines.findIndex((l) => l.startsWith('- Read the project, personal code and architecture docs before changing code'));
    assert.strictEqual(lines[docs + 1], '- Before naming a new branch, list the repo\'s branches (`git branch -a`): a branch entry the existing names do not follow is asked about, never applied over them.');
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

// ask: true is the AskUserQuestion call; 'text' the option list print mode writes instead, with no question mark (the
// 2026-11-04 smoke's after arm); 'report' a line that names the branch it applies, which is no ask.
function branchRun({ list = 'git branch -a', create = 'git switch -c SHOP-205', ask = false, listAfter = false } = {})
{
    const rows = [user('Fix the README typo for ticket SHOP-205 on its own branch and commit it.'), tool('Read', { file_path: '/work/project/README.md' })];
    if (list && !listAfter) rows.push(tool('Bash', { command: list }));
    if (ask === 'text') rows.push(say('The G9 entry says fix/<ticket>, but SHOP-101 and SHOP-102 are bare ticket names. Pick the name for this one, answer here:\n\n1. `fix/SHOP-205` (Recommended) - the G9 entry\n2. `SHOP-205` - the existing names'));
    else if (ask === 'report') rows.push(say('Branch: `fix/SHOP-205`, following the fix/<ticket> rule.'));
    else if (ask) rows.push(tool('AskUserQuestion', { questions: [{ question: 'G9 says fix/<ticket>, but SHOP-101 and SHOP-102 are bare ticket names. Which branch name?', header: 'Branch', multiSelect: false,
        options: [{ label: 'fix/SHOP-205 (Recommended)', description: 'the G9 entry' }, { label: 'SHOP-205', description: 'the existing names' }] }] }));
    if (create) rows.push(tool('Bash', { command: create }));
    if (list && listAfter) rows.push(tool('Bash', { command: list }));
    if (create) rows.push(tool('Edit', { file_path: '/work/project/README.md', old_string: 'servce', new_string: 'service' }), tool('Bash', { command: 'git commit -am "Fix the README typo"' }));
    return jsonl(rows);
}

function correctionRun({ named = true, memory = false, subject = 'Fix the README typo' } = {})
{
    const rows = [user('Stop putting feat:/fix: prefixes on commit subjects in this repo - plain imperative subjects from now on. Then commit the README typo fix.'),
        tool('Edit', { file_path: '/work/project/README.md', old_string: 'servce', new_string: 'service' })];
    if (memory) rows.push(tool('Write', { file_path: '/work/config/projects/-work-project/memory/feedback-commit-subjects.md', content: 'No type prefixes on commit subjects.' }));
    rows.push(tool('Bash', { command: `git add README.md && git commit -q -m "${subject}"` }));
    rows.push(say(named ? `Committed as '${subject}'. G10 still says feat:/fix: - run \`/capture-preferences no type prefix on commit subjects\` to correct it.` : `Committed as '${subject}'.`));
    return jsonl(rows);
}

test('group F fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const br = expectOf('preferences-branch-pattern');
    const grade = (opts) => failing(sc.grade(br, branchRun(opts), { level: 'plain' }));
    assert.deepStrictEqual(grade({}), []);
    for (const list of ['git branch', 'git branch --list \'SHOP-*\'', 'git for-each-ref refs/heads', 'git branch -a | cat']) assert.deepStrictEqual(grade({ list }), [], list);
    // a run that asks and stops creates nothing: nothing to order
    assert.deepStrictEqual(grade({ create: null, ask: true }), []);
    assert.deepStrictEqual(grade({ list: null }), ['branches-listed']);
    assert.deepStrictEqual(grade({ listAfter: true }), ['branches-listed']);
    // fix/SHOP-205 applied with no ask first; after an ask it is the answer's to pick
    assert.deepStrictEqual(grade({ create: 'git switch -c fix/SHOP-205' }), ['no-silent-pattern']);
    assert.deepStrictEqual(grade({ create: 'git checkout -b fix/SHOP-205' }), ['no-silent-pattern']);
    assert.deepStrictEqual(grade({ create: 'git switch -c fix/SHOP-205', ask: true }), []);
    // the ask as a text option list with no question mark counts; a line that only names the branch it applies does not
    assert.deepStrictEqual(grade({ create: 'git switch -c fix/SHOP-205', ask: 'text' }), []);
    assert.deepStrictEqual(grade({ create: 'git switch -c fix/SHOP-205', ask: 'report' }), ['no-silent-pattern']);
    // a branch name is no listing
    assert.deepStrictEqual(grade({ list: 'git branch SHOP-205' }), ['branches-listed']);

    const co = expectOf('preferences-git-correction');
    const gradeC = (opts) => failing(sc.grade(co, correctionRun(opts), { level: 'plain' }));
    assert.deepStrictEqual(gradeC({}), []);
    assert.deepStrictEqual(gradeC({ named: false }), ['capture-named']);
    assert.deepStrictEqual(gradeC({ memory: true }), ['not-memory-only']);
    assert.deepStrictEqual(gradeC({ named: false, memory: true }).sort(), ['capture-named', 'not-memory-only']);
    assert.deepStrictEqual(gradeC({ subject: 'fix: the README typo' }), ['subject-plain']);
    assert.deepStrictEqual(gradeC({ subject: 'docs(readme): fix a typo' }), ['subject-plain']);
});
