'use strict';
// Group E of the 2026-11-04 prose A/B round - the always-on interaction rule: U35 (a turn ending on a background run
// names when it should finish; a literal example leads; no ask for a permission already given). The prose pins, and
// the offline proof that each new fixture step passes a trace that keeps it and fails one that breaks it, before any
// billed run. Its fixtures ship or leave with the group's verdict: 'interaction-permission-given',
// 'interaction-literal-example', and the e2e phase and eta step of 'background-wait'.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RULE = 'stack/rules/alfred-interaction.md';

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('U35: three bullets - the background run\'s finish, the literal example first, no re-asked permission', () =>
{
    const lines = read(RULE).split('\n');
    const at = (start) => lines.findIndex((l) => l.startsWith(start));
    const redirect = at('- Mid-task redirect: acknowledge it');
    assert.strictEqual(lines[redirect + 1], '- A turn that ends while a background run works names it and when it should finish, from its pace or its last run - every such turn, not only its start line.');
    assert.strictEqual(lines[redirect + 2], '- Asked for a literal example (a command, a line, a snippet), lead with it; a caveat follows in one line.');
    const reread = at('- Re-read state carried from an earlier turn or session');
    assert.strictEqual(lines[reread + 1], '- Never ask for a permission the user\'s words in this conversation already gave - act on it; an ask names only what is still open.');
    assert.ok(redirect < at('## Asking the user') && reread > at('## Asking the user'), 'the first two under Communication style, the third under Asking the user');
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

function waitRun({ wait = 'The unit suite is running in the background - about 90 s from its pace; I will report once it finishes.', answer = true } = {})
{
    const rows = [user('Run npm test and tell me which test fails and why, then run the e2e suite too and tell me how it went.'),
        tool('Bash', { command: 'npm test > run.log 2>&1', run_in_background: true }),
        tool('Monitor', { command: 'tail -f run.log | grep --line-buffered -E "^(✖|ℹ fail)"' }),
        say(wait)];
    if (answer) rows.push(say('test/02-member-discount fails: a five-year member gets 10 percent off, not 15.'));
    rows.push(tool('Bash', { command: 'npm run test:e2e > e2e.log 2>&1', run_in_background: true }),
        tool('Monitor', { command: 'tail -f e2e.log | grep --line-buffered -E "^ℹ (pass|fail)"' }),
        say('e2e: 3 passed, 0 failed.'));
    return jsonl(rows);
}

function migrateRun({ ask = false, question = null, run = true } = {})
{
    const rows = [user('The users table needs the email index from migrations/004. You have my go to run the migration against the local test database - do it and tell me it took.'),
        tool('Bash', { command: 'grep -c file config/database.json' })];
    if (ask) rows.push(tool('AskUserQuestion', { questions: [{ question: 'Apply migration 004 to db/test.sqlite now?', header: 'Migrate', multiSelect: false, options: [{ label: 'Run it (Recommended)', description: 'local file' }, { label: 'Hold', description: 'nothing' }] }] }));
    if (question) rows.push(say(question));
    if (run) rows.push(tool('Bash', { command: 'npm run migrate:test' }));
    rows.push(say('Applied 004_users_email_index.sql to db/test.sqlite - the unique email index is in.'));
    return jsonl(rows);
}

const exampleRun = (last) => jsonl([user('What is the exact command to run only the failing cart test file here?'), tool('Bash', { command: 'ls test' }), say(last)]);

test('group E fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const bg = expectOf('background-wait');
    assert.deepStrictEqual(failing(sc.grade(bg, waitRun(), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(bg, waitRun({ wait: 'Waiting on the suite - it should finish in under 2 min.' }), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(bg, waitRun({ wait: 'Waiting on the suite (~90 s).' }), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(bg, waitRun({ wait: 'The suite is running in the background; I will report once it finishes.' }), { level: 'plain' })), ['eta']);
    // the answer step reads any text: the last one here reports the e2e run alone
    assert.deepStrictEqual(failing(sc.grade(bg, waitRun({ answer: false }), { level: 'plain' })), ['answer']);

    const mg = expectOf('interaction-permission-given');
    assert.deepStrictEqual(failing(sc.grade(mg, migrateRun(), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(mg, migrateRun({ ask: true }), { level: 'plain' })), ['no-permission-reask']);
    assert.deepStrictEqual(failing(sc.grade(mg, migrateRun({ question: 'Shall I run the 004 migration against db/test.sqlite now?', run: false }), { level: 'plain' })).sort(), ['acted', 'no-permission-reask']);
    assert.deepStrictEqual(failing(sc.grade(mg, migrateRun({ run: false }), { level: 'plain' })), ['acted']);

    const ex = expectOf('interaction-literal-example');
    for (const last of ['```bash\nnode --test test/cart.test.js\n```\nIt runs that file alone.', '`node --test test/cart.test.js` - runs that file alone.', 'node --test test/cart.test.js\n\nIt runs only that file.', '$ npm test -- test/cart.test.js'])
        assert.deepStrictEqual(failing(sc.grade(ex, exampleRun(last), { level: 'plain' })), [], last);
    assert.deepStrictEqual(failing(sc.grade(ex, exampleRun('The test runner takes a file argument, so you can run just the cart test:\n\n```bash\nnode --test test/cart.test.js\n```'), { level: 'plain' })), ['example-first']);
});
