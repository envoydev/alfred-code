'use strict';
// Group A of the 2026-11-04 prose A/B round - task-solve: CAP-1 (the full-spec definition moved to its reference),
// U31 (the approve template's fresh-session row) and U34 (an empty request is asked for). The prose pins, and the
// offline proof that each new fixture step passes a trace that keeps it and fails one that breaks it, before any
// billed run. Its fixtures ship or leave with the group's verdict: 'task-solve-approve-fresh', 'task-solve-empty'.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const body = (text) => String(text).replace(/^---\n[\s\S]*?\n---\n/, '');
const SKILL = 'stack/skills/task-solve/SKILL.md';
const FULL_SPEC = 'stack/skills/task-solve/references/full-spec.md';
// The ask blocks of a markdown text: each one's lines, trimmed.
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)]
    .map((m) => m[1].split('\n').map((l) => l.trim()).filter(Boolean));

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const command = (args) => user(`<command-name>/task-solve</command-name>\n<command-message>task-solve</command-message>\n<command-args>${args}</command-args>`);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('CAP-1: the full-spec definition lives in references/full-spec.md and SKILL.md states only the check and its line', () =>
{
    const skill = flat(read(SKILL));
    assert.ok(skill.includes('On `standard`, the same check decides this step - `references/full-spec.md` holds what a FULL spec names and how to run `scripts/spec-check.js`; any doubt keeps every gate below. State its verdict in one line, `Spec: <full|not full> - <path> - <its reason>`.'));
    assert.ok(!skill.includes('A FULL spec names the surface'), 'the definition left SKILL.md');
    const ref = read(FULL_SPEC);
    const names = ref.indexOf('\n## What a full spec names\n');
    assert.ok(names > 0 && names < ref.indexOf('\n## The check\'s lookup\n'), 'the definition opens the reference, before the lookup');
    assert.ok(flat(ref).includes('A FULL spec names the surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests or acceptance criteria). A request that misses any item, spans more than one stack, or touches an auth, secret or payment path (access, visibility, ownership and personal data count) keeps every gate, and so does any doubt. `scripts/spec-check.js` reads the request for all five.'));
    assert.ok(body(read(SKILL)).length < 17700, 'the body stays under its cap');
});

test('U31: the approve template carries the fresh-session row', () =>
{
    const text = read(SKILL);
    const approve = asks(text).find((lines) => lines[0].startsWith('The plan is gated.'));
    assert.ok(approve, 'the step-3 approve template');
    assert.strictEqual(approve[approve.length - 1], "- 'Resume in a fresh session' - required past the fresh-session trigger above");
    assert.ok(flat(text).includes('The mark moves to the seats option when the mode-fit rule picks it for THIS plan, and to the fresh option where the resume rule above marks it.'));
});

test('U34: an empty request is asked for, nothing runs', () =>
{
    const text = flat(read(SKILL));
    const at = text.indexOf('**On invocation, resume before starting:**');
    const u34 = text.indexOf('Invoked with no request and no plan to resume, the one reply is an ask for the task - nothing runs before its answer.');
    assert.ok(at >= 0 && u34 > at && u34 - at < 1200, 'the sentence closes the On invocation paragraph');
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

// task-solve's first leg up to its first stop, as the fixture's compliant run would leave it. Print mode has no
// AskUserQuestion, so the stop also comes as text (stop: 'text'); 'split' is the clarify-shaped marked ask and the
// field report as two texts, neither one a stop.
function solveRun({ spec = true, stop = 'tool' } = {})
{
    const rows = [command('Add request validation to the create-order handler'),
        tool('Bash', { command: 'node .claude/hooks/handoff.js left order-validation' }),
        say('Size: standard - request validation is input parsing, on the floor whatever the file count.')];
    if (spec) rows.push(say('**Spec:** not full - gated - the request names no tests'));
    rows.push(tool('Skill', { skill: 'task-design' }));
    if (stop === 'split') rows.push(say('One fork before the plan: what does a bad body answer?\n\n1. \'A 400 with one error per field (Recommended)\' - what the handler\'s callers parse\n2. \'A 400 with the first error only\' - less to build'));
    rows.push(tool('Write', { file_path: '/work/project/.alfred/docs/work/plans/order-validation.md', content: '# Order validation\n\n## Tasks\n' }));
    const fields = '**Result:** design written - .alfred/docs/work/plans/order-validation.md\n**Progress:** 1 of 6 steps\n**Leftovers:** none';
    if (stop === 'tool') rows.push(say(fields),
        tool('AskUserQuestion', { questions: [{ question: 'The design is written - run the plan audit next?', header: 'Next step', options: [{ label: 'Run the audit (Recommended)', description: 'step 2' }, { label: 'Changes first', description: 'edit the plan' }], multiSelect: false }] }));
    else if (stop === 'text') rows.push(say(`${fields}\n\nThe design is written - run the plan audit next?\n\n1. 'Run the audit (Recommended)' - step 2\n2. 'Changes first' - edit the plan`));
    else rows.push(say(fields));
    return jsonl(rows);
}

const APPROVE = { label: 'Approve - build in this session', description: 'one task, one module' };
const SEATS = { label: 'Approve - dispatch the agent seats', description: 'one card' };
const NOT_YET = { label: 'Not yet - changes needed', description: 'edit the plan' };
const FRESH = { label: 'Resume in a fresh session', description: 'pays back in about 36 messages' };
const marked = (o) => ({ ...o, label: `${o.label} (Recommended)` });
const approveAsk = (options) => tool('AskUserQuestion', { questions: [{ question: 'The plan is gated. Build it in this session: one task in one module.', header: 'Approval', options, multiSelect: false }] });

// The approve stop resumed from the gated plan, the mechanics read first.
function approveRun({ options = [marked(FRESH), APPROVE, SEATS, NOT_YET], mechanics = true, asText = false, stamp = false } = {})
{
    const rows = [command('.alfred/docs/work/plans/order-validation.md'),
        tool('Bash', { command: 'node .claude/hooks/handoff.js left order-validation' }),
        tool('Read', { file_path: '/work/project/.alfred/docs/work/plans/order-validation.md' })];
    if (mechanics) rows.push(tool('Read', { file_path: '/work/project/.claude/skills/task-solve/references/step-mechanics.md' }));
    rows.push(tool('Skill', { skill: 'habits-execution-strategy' }),
        say('Execution: session - one task in one module.\n\n**Result:** plan gated - .alfred/docs/work/plans/order-validation.md - mechanics: read\n**Progress:** 3 of 6 steps\n**Leftovers:** none'));
    if (stamp) rows.push(tool('Edit', { file_path: '/work/project/.alfred/docs/work/plans/order-validation.md', old_string: 'Gated:', new_string: 'Approved: 2026-11-04 - mode session\nGated:' }));
    if (asText) rows.push(say(`The plan is gated. Build it in this session: one task in one module.\n\n${options.map((o, i) => `${i + 1}. '${o.label}' - ${o.description}`).join('\n')}`));
    else rows.push(approveAsk(options));
    return jsonl(rows);
}

// The bare command: a look for a plan to resume, then the ask for the task - the tool call, a text question, or a text
// request with no question mark (the 2026-11-04 smoke's after arm: 'I need the task ... Describe it ...').
function emptyRun({ ask = 'tool', write = false, skill = null } = {})
{
    const rows = [command(''), tool('Bash', { command: 'node .claude/hooks/handoff.js list' }),
        tool('Glob', { pattern: '.alfred/docs/work/plans/*.md' }), tool('Skill', { skill: 'habits-clarify' })];
    if (skill) rows.push(tool('Skill', { skill }));
    if (write) rows.push(tool('Write', { file_path: '/work/project/.alfred/docs/work/plans/untitled.md', content: '# Plan\n' }));
    if (ask === 'tool') rows.push(tool('AskUserQuestion', { questions: [{ question: 'Which task should this cycle solve - a feature, a bug or a change?', header: 'Task', options: [{ label: 'A bug in the order handler', description: 'name the symptom' }, { label: 'A new feature', description: 'name the surface' }], multiSelect: false }] }));
    else if (ask === 'text') rows.push(say('No plan to resume here. What task should this cycle solve?'));
    else if (ask === 'imperative') rows.push(say('No plan file exists to resume, and no task came with the command. I need the task before anything runs. Describe it in a sentence or two.'));
    else rows.push(say('No plan to resume here, and no request was given.'));
    return jsonl(rows);
}

test('group A fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    // spec-line, on the task-solve fixture
    assert.deepStrictEqual(failing(sc.grade(expectOf('task-solve'), solveRun())), []);
    assert.deepStrictEqual(failing(sc.grade(expectOf('task-solve'), solveRun({ spec: false }))), ['spec-line']);

    // stop-after-design: the stop as text (print mode) passes; a marked ask with no Result: field (clarify's shape)
    // and a field report with no options, each its own text, are no stop
    assert.deepStrictEqual(failing(sc.grade(expectOf('task-solve'), solveRun({ stop: 'text' }))), []);
    assert.deepStrictEqual(failing(sc.grade(expectOf('task-solve'), solveRun({ stop: 'split' }))), ['stop-after-design']);

    // fresh-option and fresh-marked-first, as the tool call and as plain-text options
    const fresh = expectOf('task-solve-approve-fresh');
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun())), []);
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ asText: true }))), []);
    // the row last and unmarked, the in-session option marked: the option is there, the mark is not on it
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ options: [marked(APPROVE), SEATS, NOT_YET, FRESH] }))), ['fresh-marked-first']);
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ options: [marked(APPROVE), SEATS, NOT_YET, FRESH], asText: true }))), ['fresh-marked-first']);
    // marked, but listed after an approve option: not first
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ options: [APPROVE, marked(FRESH), SEATS, NOT_YET] }))), ['fresh-marked-first']);
    // no fresh row at all: fresh-marked-first presupposes the row, so it fails beside fresh-option
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ options: [marked(APPROVE), SEATS, NOT_YET] }))), ['fresh-option', 'fresh-marked-first']);
    // the two guards
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ mechanics: false }))), ['mechanics-read']);
    assert.deepStrictEqual(failing(sc.grade(fresh, approveRun({ stamp: true }))), ['no-self-approval']);

    // asks-for-task and nothing-runs
    const empty = expectOf('task-solve-empty');
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun())), []);
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun({ ask: 'text' }))), []);
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun({ ask: 'imperative' }))), []);
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun({ ask: 'none' }))), ['asks-for-task']);
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun({ write: true }))), ['nothing-runs']);
    assert.deepStrictEqual(failing(sc.grade(empty, emptyRun({ skill: 'task-design' }))), ['nothing-runs']);
});
