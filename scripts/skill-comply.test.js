'use strict';
// skill-comply: the GRADE mode on synthetic transcripts (one compliant, one skipping a step, one
// doing steps out of order, per shipped expectation where it matters), the expectation-file check,
// and the REPLAY plan - printed, parsed by bash, never run against a real `claude`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'skill-comply.js');
const sc = require('./skill-comply.js');

const POSIX_ONLY = { skip: process.platform === 'win32' && 'the replay plan is a POSIX shell script' };
// Built by concatenation: the registration route's bare spelling is banned as a literal (lint 54).
const BARE = (server, tool) => ['mcp', server, tool].join('__');

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const denied = (row) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: row.message.content[0].id, is_error: true, content: 'blocked' }] } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const expectOf = (skill) => sc.loadExpectation(skill).data;
const verdicts = (r) => Object.fromEntries(r.steps.map((s) => [s.id, s.verdict]));
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

function tmp(prefix)
{
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- the commit checkpoint ------------------------------------------------------------------------

const PROMPT = 'Commit the session expiry change.';
const RECEIPT_PATH = '/work/project/.claude/docs/flow/COMMIT-GATE';
const RECEIPT = [
    'VERIFIED project-verify-code over the session expiry diff, security half inline',
    `authorized: "${PROMPT}"`,
    'head: 1a2b3c4',
    'spec: 4 files - git add -N . && git diff HEAD, the whole change set',
    'live-probe: npm test - 2 passed',
    'security: auth ok, secrets ok, injection n/a, data-access n/a',
    '',
].join('\n');
const COMMIT = 'git add -A && git commit -q -F - <<\'EOF\'\nfeat(auth): idle sessions expire\nEOF';

function checkpointRun({ format = true, receiptFirst = true, receipt = RECEIPT, editAfterFormat = false } = {})
{
    const rows = [user(PROMPT), tool('Bash', { command: 'git status --short' })];
    if (format) rows.push(tool('Bash', { command: 'npm run format' }));
    if (editAfterFormat) rows.push(tool('Edit', { file_path: '/work/project/src/auth/session.js', old_string: 'a', new_string: 'b' }));
    rows.push(tool('Skill', { skill: 'project-verify-code' }));
    rows.push(tool('Bash', { command: 'git add -N . && git diff HEAD; git reset -q' }));
    rows.push(tool('Bash', { command: 'npm test' }));
    rows.push(say('Security review: auth ok, secrets ok, injection n/a, data-access n/a.'));
    if (!receiptFirst)
    {
        const blocked = tool('Bash', { command: COMMIT });
        rows.push(blocked, denied(blocked));
    }
    rows.push(tool('Write', { file_path: RECEIPT_PATH, content: receipt }));
    rows.push(tool('Bash', { command: COMMIT }));
    rows.push(tool('Bash', { command: 'rm -f .claude/docs/flow/COMMIT-GATE' }));
    rows.push(say('Committed as feat(auth): idle sessions expire.'));
    return jsonl(rows);
}

test('a compliant commit-checkpoint trace follows every step', () =>
{
    const r = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun(), { level: 'plain' });
    assert.deepStrictEqual(failing(r), []);
    assert.strictEqual(r.passed, r.graded);
    assert.strictEqual(r.graded, 9);
});

test('skipping the formatter fails that step and only that step', () =>
{
    const r = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun({ format: false }));
    assert.deepStrictEqual(failing(r), ['formatter-fresh']);
    assert.match(r.steps[0].results[0].explanation, /no Bash .*\(called at nowhere\)/);
});

test('a formatter run BEFORE the last source edit is stale, not fresh', () =>
{
    const r = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun({ editAfterFormat: true }));
    assert.deepStrictEqual(failing(r), ['formatter-fresh']);
});

test('committing before the receipt is written is out of order, even when the commit lands later', () =>
{
    const r = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun({ receiptFirst: false }));
    assert.deepStrictEqual(failing(r), ['receipt-before-commit']);
    const why = r.steps.find((s) => s.id === 'receipt-before-commit').results[0].explanation;
    assert.match(why, /does NOT precede/);
    // the clear is judged against the LAST commit, so the late one still counts as cleared
    assert.strictEqual(verdicts(r)['receipt-cleared'], 'PASS');
});

test('a WAIVED receipt the user never asked for, and a paraphrased authorized line, both fail', () =>
{
    const waived = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun({ receipt: `WAIVED - "${PROMPT}"\n` }), { level: 'plain' });
    assert.ok(failing(waived).includes('no-self-waiver'));
    assert.ok(failing(waived).includes('receipt-five-lines'));

    const paraphrase = RECEIPT.replace(`"${PROMPT}"`, '"the user asked me to commit the change"');
    const r = sc.grade(expectOf('project-commit-checkpoint'), checkpointRun({ receipt: paraphrase }), { level: 'plain' });
    assert.deepStrictEqual(failing(r), ['authorized-quotes-user']);
    assert.match(r.steps.find((s) => s.id === 'authorized-quotes-user').results[0].explanation, /a paraphrase, not a quote/);
});

test('words found only in a harness-written row (a loaded skill body) are not the user\'s', () =>
{
    const template = 'the user\'s words asking for THIS commit, verbatim';
    const meta = { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: `authorized: "<${template}>"` }] } };
    const run = checkpointRun({ receipt: RECEIPT.replace(`"${PROMPT}"`, `"${template}"`) });
    const r = sc.grade(expectOf('project-commit-checkpoint'), JSON.stringify(meta) + '\n' + run);
    assert.deepStrictEqual(failing(r), ['authorized-quotes-user']);
});

test('a receipt written inside the commit command is not its own call', () =>
{
    const rows = [user(PROMPT), tool('Bash', { command: 'npm run format' }), tool('Skill', { skill: 'project-verify-code' }),
        tool('Bash', { command: 'git add -N . && git diff HEAD; git reset -q' }),
        tool('Bash', { command: `printf '%s' "$R" > .claude/docs/flow/COMMIT-GATE && ${COMMIT}` }),
        tool('Bash', { command: 'rm -f .claude/docs/flow/COMMIT-GATE' })];
    const r = sc.grade(expectOf('project-commit-checkpoint'), jsonl(rows));
    assert.ok(failing(r).includes('receipt-before-commit'));
});

test('a verifier seat satisfies the review step the same as the in-session skill', () =>
{
    const run = checkpointRun().replace('"name":"Skill","input":{"skill":"project-verify-code"}',
        '"name":"Agent","input":{"subagent_type":"claude-stack-web-angular:web-angular-verifier","prompt":"review"}');
    const r = sc.grade(expectOf('project-commit-checkpoint'), run, { level: 'plain' });
    assert.strictEqual(verdicts(r)['review-runs'], 'PASS');
});

// --- solve-task: the size line and the first stop -------------------------------------------------

function solveRun({ sizeFirst = true, size = 'standard', resume = 'mcp__plugin_serena_serena__list_memories', approve = false } = {})
{
    const sizeRow = say(`Size: ${size} - request validation is input parsing, on the floor whatever the file count.`);
    const rows = [user('<command-name>/project-solve-task</command-name>\n<command-args>Add request validation to the create-order handler</command-args>')];
    if (resume) rows.push(tool(resume, {}));
    if (sizeFirst) rows.push(sizeRow);
    rows.push(tool('Skill', { skill: 'project-solution-design' }));
    if (!sizeFirst) rows.push(sizeRow);
    rows.push(tool('Read', { file_path: '/work/project/src/orders.js' }));
    rows.push(tool('Write', { file_path: '/work/project/.claude/docs/superpowers/plans/order-validation.md', content: `# Order validation\n\n${approve ? 'Approved: 2026-09-23 - mode session\n' : ''}## Tasks\n` }));
    rows.push(say('**Result:** design written - .claude/docs/superpowers/plans/order-validation.md\n**Progress:** 1 of 6 steps\n**Leftovers:** none'));
    rows.push(tool('AskUserQuestion', { questions: [{ question: 'The design is written - run the plan audit next?', options: [{ label: 'Run the audit (Recommended)' }, { label: 'Changes first' }] }] }));
    return jsonl(rows);
}

test('a compliant solve-task first leg follows every step', () =>
{
    const r = sc.grade(expectOf('project-solve-task'), solveRun());
    assert.deepStrictEqual(failing(r), []);
    assert.strictEqual(r.graded, 9);
});

test('the size line after the design step is out of order', () =>
{
    const r = sc.grade(expectOf('project-solve-task'), solveRun({ sizeFirst: false }));
    assert.deepStrictEqual(failing(r), ['size-first']);
});

test('an input-parsing task sized small breaks the floor', () =>
{
    const r = sc.grade(expectOf('project-solve-task'), solveRun({ size: 'small' }));
    assert.deepStrictEqual(failing(r), ['size-floor']);
});

test('skipping the resume check fails it; a self-written Approved stamp fails no-self-approval', () =>
{
    assert.deepStrictEqual(failing(sc.grade(expectOf('project-solve-task'), solveRun({ resume: null }))), ['resume-first']);
    assert.deepStrictEqual(failing(sc.grade(expectOf('project-solve-task'), solveRun({ approve: true }))), ['no-self-approval']);
});

test('an MCP tool counts in both spellings: the plugin route and the registration route', () =>
{
    assert.strictEqual(sc.canonical('mcp__plugin_serena_serena__list_memories'), BARE('serena', 'list_memories'));
    assert.strictEqual(sc.canonical('mcp__plugin_playwright-chrome_playwright-chrome__browser_navigate'), BARE('playwright-chrome', 'browser_navigate'));
    assert.strictEqual(sc.canonical('Read'), 'Read');
    const r = sc.grade(expectOf('project-solve-task'), solveRun({ resume: BARE('serena', 'list_memories') }));
    assert.strictEqual(verdicts(r)['resume-first'], 'PASS');
});

// --- the convention skill -------------------------------------------------------------------------

function csharpRun({ loadFirst = true, testing = true, namespaced = false } = {})
{
    const skill = (n) => tool('Skill', { skill: namespaced ? `claude-stack-dotnet:${n}` : n });
    const rows = [user('OrderService.Total ignores the discount - fix it and add a test for it.'),
        tool('Read', { file_path: '/work/project/src/Orders/OrderService.cs' })];
    if (loadFirst) rows.push(skill('csharp'), say('Loaded csharp for the .cs edit.'));
    rows.push(tool('Edit', { file_path: '/work/project/src/Orders/OrderService.cs', old_string: 'return subtotal;', new_string: 'return subtotal * (1 - discountPercent / 100m);' }));
    if (!loadFirst) rows.push(skill('csharp'), say('Loaded csharp late.'));
    rows.push(tool('Read', { file_path: '/work/project/tests/Orders.Tests/OrderServiceTests.cs' }));
    if (testing) rows.push(skill('dotnet-testing'));
    rows.push(tool('Edit', { file_path: '/work/project/tests/Orders.Tests/OrderServiceTests.cs', old_string: '}', new_string: '[Fact] ... }' }));
    return jsonl(rows);
}

test('csharp: loaded before the first .cs write, testing before the test write; the llm step is SKIP', () =>
{
    const r = sc.grade(expectOf('csharp'), csharpRun());
    assert.deepStrictEqual(failing(r), []);
    assert.strictEqual(r.graded, 3);
    assert.strictEqual(r.skipped, 1);
    assert.strictEqual(verdicts(r)['conventions-applied'], 'SKIP');
    assert.match(r.steps[3].results[0].explanation, /out of scope offline/);
});

test('csharp: a plugin-namespaced skill name matches; an edit before the load and a missing testing load fail', () =>
{
    assert.deepStrictEqual(failing(sc.grade(expectOf('csharp'), csharpRun({ namespaced: true }))), []);
    assert.deepStrictEqual(failing(sc.grade(expectOf('csharp'), csharpRun({ loadFirst: false }))), ['csharp-before-edit']);
    assert.deepStrictEqual(failing(sc.grade(expectOf('csharp'), csharpRun({ testing: false }))), ['testing-before-test-edit']);
});

// --- the root-cause loop ----------------------------------------------------------------------------
// R72's owed A/B: a run that reaches a FAILURE and a fix before any stop, so 'one hypothesis per
// change' and 'verification quoted before done' are graded on what the run did, not on a gate.

const RC_ROOT = '/work/project/src/money.js';
const RC_SYMPTOM = '/work/project/src/cart.js';
// `rejected` adds a write that errored ('String to replace not found', a hook deny) and so changed
// nothing: 'retry' before its own retry, 'early' before the repro, 'symptom' as a guard in cart.js.
function rootCauseRun({ repro = true, hypothesis = true, cause = 'The total is 200 instead of 130000 because toCents calls parseFloat, which stops at the comma in 1,299.00.',
    target = RC_ROOT, twoChanges = false, rerun = true, quoted = true, weaken = false, rebaseline = false, rejected = null } = {})
{
    const rows = [user('npm test is failing on the cart total - fix it.')];
    const reject = (file) => { const e = tool('Edit', { file_path: file, old_string: 'parseFloat(price )', new_string: 'x' }); rows.push(e, denied(e)); };
    if (rejected === 'early') reject(RC_ROOT);
    if (repro) rows.push(tool('Bash', { command: 'npm test' }));
    rows.push(tool('Read', { file_path: RC_SYMPTOM }), tool('Read', { file_path: RC_ROOT }));
    if (hypothesis) rows.push(say(cause));
    if (rejected === 'retry') reject(target);
    if (rejected === 'symptom') reject(RC_SYMPTOM);
    rows.push(tool('Edit', { file_path: target, old_string: 'parseFloat(price)', new_string: "parseFloat(String(price).replace(/,/g, ''))" }));
    if (twoChanges) rows.push(tool('Edit', { file_path: target, old_string: 'Math.round(', new_string: 'Math.trunc(' }));
    if (weaken) rows.push(tool('Edit', { file_path: '/work/project/test/cart.test.js', old_string: "test('a thousand-priced", new_string: "test.skip('a thousand-priced" }));
    if (rebaseline) rows.push(tool('Edit', { file_path: '/work/project/test/cart.test.js', old_string: '}]), 130000);', new_string: '}]), 200);' }));
    if (rerun) rows.push(tool('Bash', { command: 'node --test test/cart.test.js' }));
    rows.push(say(quoted ? 'Fixed in toCents, where the comma was dropped. `npm test`: ℹ tests 3, ℹ pass 3, ℹ fail 0.' : 'Fixed in toCents - the tests are green now.'));
    return jsonl(rows);
}

test('root-cause: a run that reproduces, states its hypothesis, fixes at the root and quotes the green run follows every step', () =>
{
    const r = sc.grade(expectOf('project-root-cause'), rootCauseRun());
    assert.deepStrictEqual(failing(r), []);
    assert.strictEqual(r.graded, 6);
});

test('root-cause: each skipped part of the loop fails its own step', () =>
{
    const exp = expectOf('project-root-cause');
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ repro: false }))), ['reproduce-first']);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ hypothesis: false }))), ['one-hypothesis-per-change']);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ twoChanges: true }))), ['one-hypothesis-per-change']);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ target: RC_SYMPTOM }))), ['fix-at-root']);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ weaken: true }))), ['no-weakened-test']);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ rebaseline: true }))), ['no-weakened-test'], 'rewriting the 130000 expectation re-baselines the test');
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ quoted: false }))), ['verification-quoted']);
    // no run after the only change: that change was never checked, and the close verified nothing
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ rerun: false }))), ['one-hypothesis-per-change', 'verified-after-last-change']);
});

test('root-cause: a write that errored changed nothing - its retry is the same change, not a second one', () =>
{
    const exp = expectOf('project-root-cause');
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ rejected: 'retry' }))), []);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ rejected: 'early' }))), [], 'a rejected write before the repro is no source write yet');
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ rejected: 'symptom' }))), [], 'a rejected guard in cart.js is no symptom fix');
});

test('root-cause: the cause stated in the shapes a run really uses counts; narration does not', () =>
{
    const exp = expectOf('project-root-cause');
    for (const cause of [
        'The bug is in toCents: parseFloat stops at the comma in 1,299.00.',
        'Root cause: toCents hands 1,299.00 to parseFloat, which reads only 1.',
        'The issue is the comma - parseFloat returns 1 for 1,299.00.',
        'The problem is upstream of cartTotal, in toCents.',
    ])
        assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ cause }))), [], cause);
    assert.deepStrictEqual(failing(sc.grade(exp, rootCauseRun({ cause: 'Let me look at the money helper next.' }))), ['one-hypothesis-per-change']);
});

test('compare: a step failing on both arms is INCONCLUSIVE, never not-worse; the ship rule holds only on a clean sheet', () =>
{
    const exp = expectOf('project-root-cause');
    const g = (o) => sc.grade(exp, rootCauseRun(o), { level: 'plain' });
    const key = 'project-root-cause/plain';
    const outcome = (c, step) => c.rows.find((r) => r.step === step).outcome;

    const blind = sc.compareArms({ [key]: g({ hypothesis: false }) }, { [key]: g({ hypothesis: false }) });
    assert.strictEqual(outcome(blind, 'one-hypothesis-per-change'), 'INCONCLUSIVE');
    assert.strictEqual(outcome(blind, 'reproduce-first'), 'same');
    assert.strictEqual(blind.verdict, 'NOT PROVEN');

    const worse = sc.compareArms({ [key]: g({}) }, { [key]: g({ quoted: false }) });
    assert.strictEqual(outcome(worse, 'verification-quoted'), 'WORSE');
    assert.strictEqual(worse.verdict, 'NOT MET');

    const better = sc.compareArms({ [key]: g({ repro: false }) }, { [key]: g({}) });
    assert.strictEqual(outcome(better, 'reproduce-first'), 'better');
    assert.strictEqual(better.verdict, 'HOLDS');

    const missing = sc.compareArms({ [key]: g({}) }, { [key]: null });
    assert.ok(missing.rows.every((r) => r.outcome === 'NOT RUN'));
    assert.strictEqual(missing.verdict, 'NOT PROVEN');
});

test('compare CLI: grades both arms\' transcripts with this tree\'s expectation and exits 1 unless the rule holds', () =>
{
    const dir = tmp('skill-comply-ab-');
    try
    {
        const put = (arm, level, text) =>
        {
            const d = path.join(dir, arm, 'project-root-cause', level);
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(path.join(d, 'transcript.jsonl'), text);
        };
        put('before', 'plain', rootCauseRun({ hypothesis: false }));
        put('after', 'plain', rootCauseRun({ hypothesis: false }));
        const args = ['compare', path.join(dir, 'before'), path.join(dir, 'after'), '--skill', 'project-root-cause'];
        const r = cli([...args, '--level', 'plain']);
        assert.strictEqual(r.code, 1, r.out + r.err);
        assert.match(r.out, /project-root-cause plain one-hypothesis-per-change: before FAIL, after FAIL -> INCONCLUSIVE/);
        assert.match(r.out, /^ship rule: NOT PROVEN - 0 worse, 1 inconclusive, 0 not run$/m);
        const all = cli(args);
        assert.match(all.out, /project-root-cause explicit reproduce-first: before -, after - -> NOT RUN/);
        put('after', 'plain', rootCauseRun());
        const ok = cli([...args, '--level', 'plain']);
        assert.strictEqual(ok.code, 0, ok.out + ok.err);
        assert.match(ok.out, /^ship rule: HOLDS/m);
        assert.strictEqual(cli(['compare', path.join(dir, 'before')]).code, 2);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('x_each: every call needs its own preceding and following event, and a call never made fails', () =>
{
    const exp = {
        skill: 't', prompts: {}, matchers: {},
        steps: [{ id: 's', graders: [{ type: 'x_each', tool: 'Edit', preceded_by: { tool: '@text', text_match: 'because' }, followed_by: 'Bash' }] }],
    };
    const run = (...rows) => sc.grade(exp, jsonl(rows)).steps[0];
    const edit = () => tool('Edit', { file_path: 'a.js' });
    assert.strictEqual(run(say('x because y'), edit(), tool('Bash', { command: 't' }), say('z because w'), edit(), tool('Bash', { command: 't' })).verdict, 'PASS');
    const second = run(say('x because y'), edit(), tool('Bash', { command: 't' }), edit(), tool('Bash', { command: 't' }));
    assert.strictEqual(second.verdict, 'FAIL');
    assert.match(second.results[0].explanation, /@3 has no @text \/because\/ since the one before/);
    assert.match(run(say('x because y'), edit(), edit(), tool('Bash', { command: 't' })).results[0].explanation, /@1 has no Bash before the next/);
    assert.match(run(tool('Bash', { command: 't' })).results[0].explanation, /Edit never called/);
    // a call that errored changed nothing: it is no call of the set, but a red run still follows one
    const failed = edit();
    assert.strictEqual(run(say('x because y'), failed, denied(failed), edit(), tool('Bash', { command: 't' })).verdict, 'PASS');
    const red = tool('Bash', { command: 't' });
    assert.strictEqual(run(say('x because y'), edit(), red, denied(red)).verdict, 'PASS');
});

test('a matcher marked succeeded skips a call that errored or was denied; an unmarked one still counts it', () =>
{
    const e = tool('Edit', { file_path: 'a.js' });
    const [ev] = sc.parseTranscript(jsonl([e, denied(e)])).events;
    assert.strictEqual(sc.matches(ev, { tool: 'Edit' }), true, 'a denied commit still counts in tool_order');
    assert.strictEqual(sc.matches(ev, { tool: 'Edit', succeeded: true }), false);
    assert.strictEqual(sc.matches(ev, { any: [{ tool: 'Edit' }], succeeded: true }), false);
    const [ok] = sc.parseTranscript(jsonl([tool('Edit', { file_path: 'a.js' })])).events;
    assert.strictEqual(sc.matches(ok, { any: [{ tool: 'Edit' }], succeeded: true }), true);
});

// --- the transcript reader ------------------------------------------------------------------------

test('the reader counts a streamed tool_use once, skips sidechain lines, and counts unreadable lines', () =>
{
    const call = tool('Bash', { command: 'npm run format' });
    const side = { ...tool('Bash', { command: 'git commit -m x' }), isSidechain: true };
    const text = [JSON.stringify(call), JSON.stringify(call), JSON.stringify(side), '{not json', '42', ''].join('\n');
    const run = sc.parseTranscript(text);
    assert.strictEqual(run.events.length, 1);
    assert.strictEqual(run.bad, 2);
});

test('stream-json shape: the result line is the last message when no text block came', () =>
{
    const run = sc.parseTranscript(jsonl([tool('Read', { file_path: 'a' }), { type: 'result', subtype: 'success', result: 'done' }]));
    assert.strictEqual(run.lastMessage, 'done');
});

test('the regex grader follows the eval semantics; a target it cannot read is SKIP, not FAIL', () =>
{
    const exp = { skill: 'x', steps: [
        { id: 'said', graders: [{ type: 'regex', pattern: 'Committed', target: 'last_message' }] },
        { id: 'quiet', graders: [{ type: 'regex', pattern: 'secret', match: 'not_contains' }] },
        { id: 'files', graders: [{ type: 'regex', pattern: 'x', target: 'files' }] },
        { id: 'made', graders: [{ type: 'file_exists', path: 'x' }] },
    ] };
    const r = sc.grade(exp, checkpointRun());
    assert.deepStrictEqual(verdicts(r), { said: 'PASS', quiet: 'PASS', files: 'SKIP', made: 'SKIP' });
});

// --- the CLI --------------------------------------------------------------------------------------

function cli(args, opts = {})
{
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
    return { code: r.status, out: r.stdout, err: r.stderr };
}

test('grade CLI: a report per step, --json, and an empty or missing transcript is an error, not a grade', () =>
{
    const dir = tmp('skill-comply-');
    try
    {
        const t = path.join(dir, 't.jsonl');
        fs.writeFileSync(t, checkpointRun({ format: false }));
        const text = cli(['grade', 'project-commit-checkpoint', t, '--level', 'plain']);
        assert.strictEqual(text.code, 0, text.err);
        assert.match(text.out, /project-commit-checkpoint \(level plain\) - 8 of 9 graded steps followed/);
        assert.match(text.out, /^ {2}FAIL {2}formatter-fresh/m);
        const json = JSON.parse(cli(['grade', 'project-commit-checkpoint', t, '--json']).out);
        assert.strictEqual(json.passed, 8);

        fs.writeFileSync(t, '');
        const empty = cli(['grade', 'project-commit-checkpoint', t]);
        assert.strictEqual(empty.code, 1);
        assert.match(empty.err, /a failed or empty run, not a grade/);
        assert.strictEqual(cli(['grade', 'project-commit-checkpoint', path.join(dir, 'absent.jsonl')]).code, 1);
        assert.strictEqual(cli(['grade', 'no-such-skill', t]).code, 1);
        assert.strictEqual(cli(['grade', 'csharp', t, '--level', 'loud']).code, 2);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check: every shipped expectation is valid and its quotes are still in the skill', () =>
{
    assert.deepStrictEqual(sc.listSkills(), ['csharp', 'project-commit-checkpoint', 'project-root-cause', 'project-solve-task']);
    const r = cli(['check']);
    assert.strictEqual(r.code, 0, r.out + r.err);
});

test('check: a quote the skill no longer says, a broken regex and an unknown grader are each named', () =>
{
    const dir = tmp('skill-comply-');
    try
    {
        const exp = expectOf('csharp');
        exp.steps[0].quote = 'a sentence the rule never said';
        exp.steps[1].graders[0].before.text_match = '([unclosed';
        exp.steps[2].graders[0].type = 'vibes';
        exp.run.selection.skills.push('no-such-skill');
        exp.run.stacks = ['cobol'];
        exp.steps[3].graders.push({ type: 'x_each', tool: 'Edit' });
        exp.steps[3].graders.push({ type: 'tool_used', tool: 'Edit', succeeded: 'yes' });
        const file = path.join(dir, 'expect.json');
        fs.writeFileSync(file, JSON.stringify(exp));
        const problems = sc.checkExpectation(sc.loadExpectation(file));
        const text = problems.join('\n');
        assert.match(text, /csharp-before-edit: its quote is no longer in stack\/rules\/csharp-conventions\.md/);
        assert.match(text, /does not compile/);
        assert.match(text, /unknown type 'vibes'/);
        assert.match(text, /selection skills 'no-such-skill' is not in this release/);
        assert.match(text, /scaffold\.sh is missing/);
        assert.match(text, /run\.stacks 'cobol' is not a stack/);
        assert.match(text, /x_each needs preceded_by or followed_by/);
        assert.match(text, /'succeeded' must be true or false/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('replay refuses to start without --dry-run or --live', () =>
{
    const r = cli(['replay']);
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /billed nested sessions - pass --dry-run/);
    // a typo is refused, never read as a boolean that silently changes nothing
    const typo = cli(['replay', '--dry-rn']);
    assert.strictEqual(typo.code, 2);
    assert.match(typo.err, /unknown flag --dry-rn/);
});

test('replay --dry-run prints one runnable plan and creates nothing', POSIX_ONLY, () =>
{
    const dir = tmp('skill-comply-');
    const out = path.join(dir, 'run');
    try
    {
        const r = cli(['replay', '--dry-run', '--out', out, '--model', 'claude-sonnet-4-5', '--max-budget-usd', '1.5']);
        assert.strictEqual(r.code, 0, r.err);
        assert.ok(!fs.existsSync(out), 'a dry run writes nothing');
        const lines = r.out.split('\n');
        const billed = lines.filter((l, i) => lines[i - 1] === '# billed: one nested model session');
        assert.strictEqual(billed.length, 12);
        assert.match(r.out, /4 skill\(s\) x 3 level\(s\) = 12 billed nested session\(s\), each capped at --max-budget-usd 1\.5/);
        assert.match(lines.slice(3).find((l) => !l.startsWith('#') && l !== 'set -e'), /clean-export\.js/, 'the source is exported first when none is handed in');
        for (const b of billed)
        {
            assert.match(b, / -p --output-format stream-json --verbose --max-turns \d+ --permission-mode dontAsk --setting-sources user,project,local /);
            assert.match(b, /env -u SENTRY_SLUG -u SENTRY_ACCESS_TOKEN -u CONTEXT7_API_KEY -u ALFRED_CODE_DOCS_PATH /);
            assert.match(b, /--max-budget-usd 1\.5 --model=claude-sonnet-4-5 > /);
            assert.ok(b.includes(`CLAUDE_CONFIG_DIR=${path.join(out, 'config')}`));
        }
        assert.ok(billed.some((b) => b.includes(BARE('serena', 'list_memories'))), 'the copy route allows the bare spelling');
        const installs = lines.filter((l) => l.includes('alfred-code.js install'));
        assert.strictEqual(installs.length, 12);
        for (const i of installs) assert.match(i, /env -i PATH="\$PATH" .* ALFRED_CODE_SKILLS_VIA_PLUGIN=false ALFRED_CODE_HOOKS_VIA_PLUGIN=false ALFRED_CODE_MCPS_VIA_PLUGIN=false node /);
        // bash parses the whole plan without running any of it
        const script = path.join(dir, 'plan.sh');
        fs.writeFileSync(script, r.out);
        execFileSync('bash', ['-n', script]);

        const one = cli(['replay', '--dry-run', '--skill', 'csharp', '--level', 'plain', '--source', path.join(__dirname, '..'), '--out', out]);
        assert.strictEqual(one.code, 0, one.err);
        assert.doesNotMatch(one.out, /clean-export/);
        // the project gets what an init walk installs: the locked always-on set and the stack's seeds too
        const sel = JSON.parse(one.out.match(/^printf '%s\\n' '(\{.*\})' > /m)[1]);
        for (const r of ['baseline-interaction', 'baseline-navigation', 'csharp-conventions', 'dotnet-repair-agents']) assert.ok(sel.rules.includes(r), r);
        for (const m of ['serena', 'context7', 'memory']) assert.ok(sel.mcps.includes(m), m);
        assert.ok(sel.skills.includes('csharp') && sel.skills.includes('dotnet-testing'));
        assert.strictEqual((one.out.match(/^# billed/mg) || []).length, 1);
        assert.strictEqual(cli(['replay', '--dry-run', '--level', 'loud']).code, 2);
        assert.strictEqual(cli(['replay', '--dry-run', '--source', dir]).code, 1);
        assert.strictEqual(cli(['replay', '--dry-run', '--max-budget-usd', '0']).code, 2);

        // An A/B arm: --source names ANOTHER release, and the project gets what an init walk of THAT
        // release installs - its own recommendations, never this tree's (R72: the before arm carries no
        // project-root-cause, the after arm does).
        const other = path.join(dir, 'other');
        fs.mkdirSync(path.join(other, 'scripts', 'install'), { recursive: true });
        fs.mkdirSync(path.join(other, 'meta'));
        fs.writeFileSync(path.join(other, 'scripts', 'install', 'alfred-code.js'), '');
        fs.writeFileSync(path.join(other, 'meta', 'recommendations.json'), JSON.stringify({ always: { skills: ['from-the-source'], rules: ['baseline-interaction'] }, stacks: {} }));
        const arm = cli(['replay', '--dry-run', '--skill', 'project-root-cause', '--level', 'plain', '--source', other, '--out', out]);
        assert.strictEqual(arm.code, 0, arm.err);
        const armSel = JSON.parse(arm.out.match(/^printf '%s\\n' '(\{.*\})' > /m)[1]);
        assert.ok(armSel.skills.includes('from-the-source'), `the source's own always set: ${armSel.skills}`);
        assert.ok(!armSel.skills.includes('project-root-cause'), 'never this tree\'s recommendations');
        assert.ok(armSel.skills.includes('javascript'), 'the fixture\'s own selection still rides along');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The --live path end to end against a STUB claude, handed by absolute path, so no step can reach a
// real session: the real installer runs on the copy route in a throwaway project, the scaffold
// commits its baseline, the stub answers the billed step with a canned compliant transcript, and
// the grade lands.
test('replay --live against a stub claude installs, scaffolds, records and grades', POSIX_ONLY, () =>
{
    const dir = tmp('skill-comply-live-');
    try
    {
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        const canned = path.join(dir, 'canned.jsonl');
        fs.writeFileSync(canned, csharpRun());
        const stub = path.join(bin, 'claude');
        fs.writeFileSync(stub, ['#!/bin/sh', 'if [ "$1" = "-p" ]; then cat > /dev/null; cat "$SKILL_COMPLY_CANNED"; exit 0; fi',
            'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then echo "[]"; fi', 'exit 0', ''].join('\n'), { mode: 0o755 });
        for (const t of ['uvx', 'npx']) fs.writeFileSync(path.join(bin, t), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, SKILL_COMPLY_CANNED: canned };
        for (const k of Object.keys(env)) if (k.startsWith('ALFRED_CODE_') || ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY'].includes(k)) delete env[k];
        const out = path.join(dir, 'run');
        const r = cli(['replay', '--live', '--skill', 'csharp', '--level', 'plain', '--source', path.join(__dirname, '..'), '--out', out, '--claude', stub], { env });
        assert.strictEqual(r.code, 0, r.err.slice(-3000));
        assert.match(r.out, /csharp \(level plain\) - 3 of 3 graded steps followed, 1 skipped offline/);
        const proj = path.join(out, 'csharp', 'plain', 'project');
        assert.ok(fs.existsSync(path.join(proj, '.claude', 'skills', 'csharp', 'SKILL.md')), 'the copy route copied the skill under test');
        assert.ok(fs.existsSync(path.join(proj, '.claude', 'rules', 'csharp-conventions.md')), 'and the rule carrying its load contract');
        assert.strictEqual(execFileSync('git', ['-C', proj, 'log', '--format=%s'], { encoding: 'utf8' }).trim(), 'baseline');
        assert.strictEqual(execFileSync('git', ['-C', proj, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
        assert.strictEqual(fs.readFileSync(path.join(out, 'csharp', 'plain', 'transcript.jsonl'), 'utf8'), fs.readFileSync(canned, 'utf8'));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
