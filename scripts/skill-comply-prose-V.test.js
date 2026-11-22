'use strict';
// Group V of the 2026-11-21 prose A/B round 2 - ruling A1, the protocol wins: a verifier names the E2E or device run
// its gate would need on a literal `deferred_runs:` line and the main session runs it once after the verifier returns.
// The prose pins, and the offline proof that each step of the fixture 'verifier-e2e-deferred' passes a trace that keeps
// it and fails one that breaks it, before any billed run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const VERIFIERS = ['browser-extension', 'web-angular', 'ionic-angular'].map((stack) => `stack/agents/${stack}-verifier.md`);
const PROTOCOL = 'stack/skills/task-solve-cross/references/domain-trio-protocol.md';
const VENDORED_IN = ['loop-code-quality', 'loop-architecture-quality', 'loop-test-coverage-quality', 'task-build-from-scratch'];
const OUTPUT_PROTOCOL = 'stack/skills/task-solve-cross/references/agent-output-protocol.md';
const FIXTURE = 'verifier-e2e-deferred';
const AGENT_DESCRIPTION_CAP = 300;
const RUNS_AN_E2E = /\b(?:rerun|run|serve|drive)s?\b[^.\n]*\b(?:E2E|device E2E|ng serve|ionic serve)\b/i;
const DEFERRED_LINE = 'a literal `deferred_runs:` line';

// A sentence that names the `deferred_runs:` line is where a verifier is told what to do with an E2E run, so it is
// the one place the words 'run' and 'E2E' may share a sentence.
function sentencesOutsideDeferredRuns(text)
{
    return text.split('\n').flatMap((line) => line.split(/(?<=[.!?])\s+/)).filter((sentence) => !sentence.includes('deferred_runs'));
}

test('A1: no verifier runs, serves or drives an E2E or device suite', () =>
{
    for (const file of VERIFIERS)
    {
        const offending = sentencesOutsideDeferredRuns(read(file)).filter((sentence) => RUNS_AN_E2E.test(sentence));
        assert.deepStrictEqual(offending, [], `${file} tells the seat to run, serve or drive an E2E or device suite outside a deferred_runs sentence`);
    }
    const browser = flat(read(VERIFIERS[0]));
    assert.ok(browser.includes('It does not run the workspace\'s Playwright persistent-context E2E suite'), 'the browser verifier says it runs none');
    assert.ok(browser.includes('a real browser surfaces'), 'and keeps the why: what only a real browser shows');
    assert.ok(browser.includes('UNVERIFIED until it has run') && browser.includes('report the live-behavior checks as UNVERIFIED with the reason'), 'and the UNVERIFIED fallback');
    const web = flat(read(VERIFIERS[1]));
    assert.ok(web.includes('It does not serve the app or run the workspace\'s E2E runner'), 'the web verifier says it serves and runs none');
    assert.ok(web.includes('a real browser is the proof'), 'and keeps the why');
    assert.ok(web.includes('UNVERIFIED until it has run') && web.includes('else report the interaction and a11y paths as UNVERIFIED with the reason'), 'and the UNVERIFIED fallback');
    const ionic = flat(read(VERIFIERS[2]));
    assert.ok(ionic.includes('It does not serve the web build or run an E2E suite'), 'the ionic verifier says it serves and runs none');
    assert.ok(ionic.includes('a mocked bridge greens falsely'), 'and keeps the why');
    assert.ok(ionic.includes('UNVERIFIED until it has run') && ionic.includes('a gate that cannot drive the native path says so'), 'and the UNVERIFIED fallback');
});

test('A1: each verifier lists the deferred_runs line beside left_running and keeps its description in the cap', () =>
{
    for (const file of VERIFIERS)
    {
        const text = read(file);
        const lines = text.split('\n');
        const at = lines.findIndex((l) => l.startsWith('- a literal `left_running:` line'));
        assert.ok(at >= 0, `${file} lists left_running`);
        assert.strictEqual(lines[at + 1], '- a literal `deferred_runs:` line - `none`, or each E2E or device run the main session owes after this gate (the command and what it proves)', `${file} lists deferred_runs right after it`);
        const description = text.match(/^description: "(.*)"$/m)[1];
        assert.ok(description.length <= AGENT_DESCRIPTION_CAP, `${file} description is ${description.length} chars`);
    }
    for (const file of [VERIFIERS[0], VERIFIERS[2]])
        assert.match(read(file).match(/^description: "(.*)"$/m)[1], /defers the (?:device )?E2E/, `${file} description says the seat defers the E2E run`);
});

test('A1: no verifier names a run it no longer starts as a blocker or a left_running example', () =>
{
    const ionic = read(VERIFIERS[2]);
    const blocker = ionic.split('\n').find((line) => line.startsWith('If you cannot run the gate at all'));
    assert.ok(blocker, 'the ionic verifier keeps its blocker clause');
    assert.doesNotMatch(blocker, /device harness/, 'the ionic seat runs no device harness, so it is no blocker: check 1 says UNVERIFIED plus a deferred_runs entry');
    assert.match(blocker, /BLOCKED_BY_TESTS when the tests cannot run/);
    for (const file of VERIFIERS)
    {
        const line = read(file).split('\n').find((l) => l.startsWith('- a literal `left_running:` line'));
        assert.ok(line, `${file} lists left_running`);
        assert.doesNotMatch(line, /dev server|served build|browser context|device or container session|app run/, `${file}: left_running names something the seat no longer starts`);
    }
    const browser = flat(read(VERIFIERS[0]));
    assert.ok(browser.includes('put the setup in that entry, so the main session that runs the suite sees it: build to a stable dist first; the suite needs an absolute path and a dynamically resolved extension ID'), 'the browser setup notes go into the deferred_runs entry');
});

test('A1: the protocol and the output block name deferred_runs', () =>
{
    const protocol = flat(read(PROTOCOL));
    assert.ok(protocol.includes('never delegated into a seat, the verifier included. A verifier names each such run its gate would need on a literal `deferred_runs:` line - the command and what it proves - and the main session runs them once after the verifier returns.'));
    for (const dir of VENDORED_IN) assert.strictEqual(read(`stack/skills/${dir}/references/domain-trio-protocol.md`), read(PROTOCOL), `${dir} carries a byte-equal copy`);
    const output = read(OUTPUT_PROTOCOL).split('\n');
    const at = output.findIndex((l) => l.startsWith('left_running: '));
    assert.ok(at >= 0);
    assert.strictEqual(output[at + 1], 'deferred_runs: <each slow run the gate owes the main session - command + what it proves | none>      # the verifiers whose gates name an E2E or device suite', 'the verifier output block lists it after left_running');
    const registry = JSON.parse(read('meta/shared-rules.json')).rules['verifier-deferred-runs'];
    for (const file of VERIFIERS) assert.ok(flat(read(file)).includes(DEFERRED_LINE), `${file} carries the registered marker`);
    assert.strictEqual(registry.owner.file, PROTOCOL);
    assert.deepStrictEqual(registry.sites.map((site) => site.file), VERIFIERS);
});

// The user's ruling of 2026-11-21 on A1's integration half: the data verifier's Testcontainers run stays in its seat;
// only the E2E and device suites move to the main session.
test('A1 integration half: a verifier keeps its own integration suite in the seat', () =>
{
    const protocol = flat(read(PROTOCOL));
    assert.ok(protocol.includes('A verifier\'s own integration suite - the Testcontainers run its gate names - is the exception and stays in its seat: only the E2E and device suites move to the main session.'));
    for (const dir of VENDORED_IN) assert.strictEqual(read(`stack/skills/${dir}/references/domain-trio-protocol.md`), read(PROTOCOL), `${dir} carries a byte-equal copy`);
    assert.match(flat(read('stack/agents/data-verifier.md')), /Testcontainers/, 'the data verifier still runs its suite in the seat');
});

// --- the offline proof: every step passes a trace that keeps it and fails one that breaks it ----------------------

let seq = 0;
const row = (message) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', ...message } });
const mainTool = (name, input) => row({ content: [{ type: 'tool_use', id: `t${seq}`, name, input }] });
const mainSay = (text) => row({ content: [{ type: 'text', text }] });
const seatRow = (r) => ({ ...r, parent_tool_use_id: 'toolu_seat' });
const seatTool = (name, input) => seatRow(mainTool(name, input));
const seatSay = (text) => seatRow(mainSay(text));
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const DISPATCH = { subagent_type: 'alfred-code:browser-extension-verifier', prompt: 'Verify .alfred/docs/work/briefs/verify-badge.md' };
const DEFERRED = 'deferred_runs: npm run test:e2e - loads dist/ unpacked and reads the badge with 1000 tabs open (proves the 999+ cap in a real browser)';
const REPORT = (lines) => ['checked prior notes: none', 'findings: high T1 src/badge.js:formatBadge - no cap above 999, test/badge.test.js asserts 999+ for 1000', ...lines,
    'status: PUNCH_LIST', 'contract_version: none'].join('\n');

// The seat's rows in the order a verifier works: orient, rerun the build and the unit suite, report.
function seatRun({ bash = [], report = REPORT(['left_running: none', DEFERRED]), main = [] } = {})
{
    return jsonl([mainTool('Agent', DISPATCH), seatTool('Read', { file_path: '.alfred/docs/work/briefs/verify-badge.md' }),
        seatTool('Bash', { command: 'git log --oneline -3 && git diff HEAD~1 --stat' }),
        seatTool('Bash', { command: 'npm run build' }), seatTool('Bash', { command: 'npm test' }),
        ...bash.map((command) => seatTool('Bash', { command })), seatSay(report), ...main]);
}

test('group V fixture: each step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (run) => sc.grade(fx, run, { level: 'plain' });
    const pass = grade(seatRun());
    assert.deepStrictEqual(failing(pass), []);
    assert.strictEqual(pass.graded, 5);

    // no-e2e-in-seat: the seat runs the E2E suite itself, in any spelling the matcher names
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['npm run test:e2e'] }))), ['no-e2e-in-seat']);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['node e2e/run.mjs'] }))), ['no-e2e-in-seat']);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['npx playwright test'] }))), ['no-e2e-in-seat']);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['pnpm test:e2e'] }))), ['no-e2e-in-seat']);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['yarn run test:e2e'] }))), ['no-e2e-in-seat']);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['cd ext && node ./e2e/run.mjs'] }))), ['no-e2e-in-seat']);
    // a Read of the runner is no run, and the unit suite in the same call set is no E2E
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['cat package.json'] }))), []);
    // smoke fix 3: a cat, ls or grep that only names the runner or the script is no run
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['cat e2e/run.mjs'] }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['ls e2e && cat e2e/run.mjs | head -20'] }))), []);
    assert.deepStrictEqual(failing(grade(seatRun({ bash: ['grep -n test:e2e package.json'] }))), []);

    // deferred-line: the report names no deferred run, or names one that is not the e2e suite
    assert.deepStrictEqual(failing(grade(seatRun({ report: REPORT(['left_running: none']) }))), ['deferred-line']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: REPORT(['left_running: none', 'deferred_runs: none']) }))), ['deferred-line']);

    // the main session echoing the line is not the seat saying it (run.trace seat reads the seat's rows alone)
    const echo = seatRun({ report: REPORT(['left_running: none']), main: [mainSay(DEFERRED)] });
    assert.deepStrictEqual(failing(grade(echo)), ['deferred-line']);

    // guards: no unit rerun, a green verdict with no defect, a report with no status line
    const noRerun = jsonl([mainTool('Agent', DISPATCH), seatTool('Bash', { command: 'git log --oneline -3' }), seatSay(REPORT(['left_running: none', DEFERRED]))]);
    assert.deepStrictEqual(failing(grade(noRerun)), ['tests-rerun']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: ['left_running: none', DEFERRED, 'status: SIGNED_OFF'].join('\n') }))), ['defect-found']);
    assert.deepStrictEqual(failing(grade(seatRun({ report: ['findings: T1 src/badge.js - 999+ never capped', 'left_running: none', DEFERRED].join('\n') }))), ['defect-found', 'report-delivered']);
});

test('V: verifier-e2e-deferred is a listed fixture over the browser-extension seat', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    assert.strictEqual(fx.run.trace, 'seat');
    assert.strictEqual(fx.run.model, 'haiku');
    assert.strictEqual(fx.run.max_turns, 15);
    assert.deepStrictEqual(fx.run.stacks, ['browser-extension']);
    assert.deepStrictEqual(fx.run.selection.agents, ['browser-extension-verifier']);
    assert.deepStrictEqual(fx.run.allowed_tools, ['Read', 'Glob', 'Grep', 'Bash', 'Agent']);
    for (const level of ['explicit', 'plain', 'adverse']) assert.match(fx.prompts[level], /verify-badge\.md/, `${level} names the brief`);
    assert.match(fx.prompts.explicit, /Gate the landed badge change/);
    assert.match(fx.prompts.adverse, /, quickly\./);
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['no-e2e-in-seat', 'deferred-line', 'tests-rerun', 'defect-found', 'report-delivered']);
    const scaffold = read(`meta/skill-comply/${FIXTURE}/scaffold.sh`);
    assert.ok(scaffold.includes('setTimeout(resolve, 150000)') && scaffold.includes('3 passed (2.5m)'), 'the fake E2E runner waits 150 seconds and prints its summary');
    assert.ok(scaffold.indexOf("git commit -q -m 'baseline'") < scaffold.indexOf("git commit -q -m 'feat(badge): cap the badge text'"), 'the landed commit follows the baseline');
    assert.ok(scaffold.includes('"test:e2e": "node e2e/run.mjs"'));
});
