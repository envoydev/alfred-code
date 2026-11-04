'use strict';
// Group C of the 2026-11-04 prose A/B round - issue-diagnoser: U33 (4b's execution verdict rides the close ask's
// question as its Execution: line). The prose pin, and the offline proof that each new fixture step passes a trace
// that keeps it and fails one that breaks it, before any billed run. Its fixture ships or leaves with the group's
// verdict: 'issue-diagnoser-plan-close'.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const SKILL = 'stack/skills/issue-diagnoser/SKILL.md';
// The ask blocks of a markdown text: each one's lines, trimmed.
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)]
    .map((m) => m[1].split('\n').map((l) => l.trim()).filter(Boolean));

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('U33: 4b\'s execution verdict rides the close ask\'s question as its Execution: line', () =>
{
    const text = read(SKILL);
    const skill = flat(text);
    assert.ok(skill.includes('and rides the close ask\'s question as its `Execution:` line, never written into the findings file'));
    assert.ok(!skill.includes('stated beside the close\'s ask'), 'the old sentence left');
    const close = asks(text).find((lines) => lines[0].startsWith('The fix is planned in'));
    assert.ok(close, 'the 4b close template');
    assert.strictEqual(close[0], 'The fix is planned in <findings path>. <the strategy\'s verdict line, which opens `Execution:`>. Build it from that file with your own /task-solve command.');
    // the strategy's verdict line opens with its own label, so the template never writes it twice
    assert.match(read('stack/skills/habits-execution-strategy/SKILL.md'), /^Execution: route </m);
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

const FINDINGS = '/work/project/.alfred/docs/work/diagnoses/cart-total.md';
const VERDICT = 'Execution: route direct - mode serial - model session - one line in toCents; parallel keeps quality: no - one unit';
const TASKS = '## Tasks\n\n### Task 1 - strip the thousands separator in toCents\n\n- files: src/money.js (modify)\n- test: a 1,299.00 price is 129900 cents';
// The cards written through Bash, the 2026-11-04 smoke's shape on both arms: a heredoc append, or a script that writes
// the file. A Bash that only reads the heading writes no cards.
const CARDS_BY_BASH = {
    heredoc: `cat >> .alfred/docs/work/diagnoses/cart-total.md <<'EOF'\n\n${TASKS}\nEOF`,
    python: `python3 - <<'PY'\np = '.alfred/docs/work/diagnoses/cart-total.md'\ns = open(p).read().replace('Outcome: <pending>', '''Outcome: 4b - plan tasks\n\n${TASKS}''')\nopen(p, 'w').write(s)\nPY`,
    grep: "grep -n '^## Tasks' .alfred/docs/work/diagnoses/cart-total.md",
};
function diagnoseRun({ strategy = true, cards = true, close = 'ask', code = false, bold = false, doubled = false, early = false } = {})
{
    const verdict = bold ? VERDICT.replace('Execution:', '**Execution:**') : doubled ? VERDICT.replace('Execution:', 'Execution: Execution:') : VERDICT;
    const rows = [user('<command-name>/issue-diagnoser</command-name>\n<command-args>.alfred/docs/work/diagnoses/cart-total.md - plan the fix as tasks</command-args>'),
        tool('Bash', { command: 'node .claude/hooks/handoff.js list cart-total/diagnosis/cursor' }), tool('Read', { file_path: FINDINGS })];
    if (strategy) rows.push(tool('Skill', { skill: 'habits-execution-strategy' }));
    if (early) rows.push(say(verdict));
    if (CARDS_BY_BASH[cards]) rows.push(tool('Bash', { command: CARDS_BY_BASH[cards] }));
    else if (cards) rows.push(tool('Edit', { file_path: FINDINGS, old_string: 'Outcome: <pending>', new_string: `Outcome: 4b - plan tasks\n\n${TASKS}` }));
    if (code) rows.push(tool('Edit', { file_path: '/work/project/src/money.js', old_string: 'parseFloat(price)', new_string: 'parseFloat(String(price).replace(/,/g, \'\'))' }));
    rows.push(tool('Bash', { command: 'node .claude/hooks/handoff.js purge cart-total' }));
    const question = `The fix is planned in .alfred/docs/work/diagnoses/cart-total.md. ${verdict}. Build it from that file with your own /task-solve command.`;
    const options = [{ label: 'Build it here: /task-solve .alfred/docs/work/diagnoses/cart-total.md (Recommended)', description: 'the file is the whole input' },
        { label: 'Stop here', description: 'the findings file keeps the cause and the tasks' }];
    if (close === 'ask') rows.push(tool('AskUserQuestion', { questions: [{ question, header: 'Next', multiSelect: false, options }] }));
    if (close === 'beside') rows.push(say(`Planned - one card.\n\n${verdict}`),
        tool('AskUserQuestion', { questions: [{ question: 'The fix is planned in .alfred/docs/work/diagnoses/cart-total.md. Build it from that file with your own /task-solve command.', header: 'Next', multiSelect: false, options }] }));
    if (close === 'none') rows.push(tool('AskUserQuestion', { questions: [{ question: 'The fix is planned in .alfred/docs/work/diagnoses/cart-total.md. Build it from that file with your own /task-solve command.', header: 'Next', multiSelect: false, options }] }));
    return jsonl(rows);
}

test('group C fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const fx = expectOf('issue-diagnoser-plan-close');
    // the after arm's shape (in the question), the before arm's (its own text line beside the ask), bold and a doubled label all pass
    for (const opts of [{}, { close: 'beside' }, { bold: true }, { doubled: true }])
        assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun(opts))), [], JSON.stringify(opts));
    // no Execution line at the close, or one only before the cards were written
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ close: 'none' }))), ['close-execution']);
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ close: 'none', early: true }))), ['close-execution']);
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ strategy: false }))), ['strategy-loaded']);
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ code: true }))), ['no-code']);
    // a run that stops before the cards fails both card steps (the evidence file reads that apart)
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ cards: false }))).sort(), ['close-execution', 'strategy-loaded', 'tasks-written']);
    // the cards written through Bash count; a Bash that only reads the heading is no write
    for (const cards of ['heredoc', 'python'])
        assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ cards }))), [], cards);
    assert.deepStrictEqual(failing(sc.grade(fx, diagnoseRun({ cards: 'grep' }))).sort(), ['close-execution', 'strategy-loaded', 'tasks-written']);
});
