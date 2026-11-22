'use strict';
// Group I of the 2026-11-21 prose A/B round 2 - SKF2-11, the two failure-signature catalogues' Execution modes section:
// one paragraph that is the main-session pointer (run the triage here, read the gatherer reference first) and the
// dispatch rule (explicit-only, never the diagnoser seat), with the seat's own copy of the skill skipping it. The prose
// pin, the registry pin, and the offline proof that the steps of the fixture 'issue-signatures-ci-red' pass a trace that
// stays in the main session and fail one that dispatches the diagnoser seat or an unread gatherer fan-out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const CI = 'stack/skills/issue-signatures-ci/SKILL.md';
const RUNTIME = 'stack/skills/issue-signatures-runtime/SKILL.md';
const FIXTURE = 'issue-signatures-ci-red';
const HEADING = '## Execution modes';
const SECTION = 'Loaded in the MAIN session, run the triage HERE and Read `references/gatherer-fan-out.md` before deciding on evidence-gatherers; inside the diagnoser seat, which preloads this file, skip this section. Either way, dispatch is explicit-only house-wide, so the seats never start on your own say-so. Do NOT dispatch the diagnoser seat from this skill - the signatures are already in context, so the seat would only duplicate them.';
const SECTION_OLD_CHARS = { [CI]: 896, [RUNTIME]: 902 };
const SECTION_FLAT_MAX_CHARS = 440;
const SEAT_MARKER = 'inside the diagnoser seat, which preloads this file, skip this section';
const DISPATCH_MARKER = 'dispatch is explicit-only house-wide, so the seats never start on your own say-so. Do NOT dispatch the diagnoser seat from this skill - the signatures are already in context, so the seat would only duplicate them';

const sectionOf = (rel) => read(rel).split(`${HEADING}\n`)[1].split('\n## ')[0];

test('SKF2-11: the Execution modes section is the main-session pointer and the dispatch rule', () =>
{
    for (const file of [CI, RUNTIME])
    {
        const section = sectionOf(file);
        assert.strictEqual(flat(section), SECTION, `${file}: the section reads exactly so`);
        assert.ok(flat(section).length <= SECTION_FLAT_MAX_CHARS, `${file}: shorter than the old ${SECTION_OLD_CHARS[file]} characters`);
        assert.ok(section.endsWith('\n'), `${file}: the paragraph sits between blank lines`);
        assert.strictEqual(section.trim().split(/\n\s*\n/).length, 1, `${file}: one paragraph`);
        const text = flat(read(file));
        for (const gone of ['single-sourced', 'inline and seated forms', 'this section is already satisfied', 'the rest of this section is not read there', 'orchestrated issue flow', 'same gatherer fan-out'])
            assert.ok(!text.includes(gone), `${file}: '${gone}' is gone`);
    }
});

test('SKF2-11: the registry entry catalogue-execution-modes points at the new seat clause and the dispatch rule keeps its marker', () =>
{
    const shared = JSON.parse(read('meta/shared-rules.json')).rules;
    const entry = shared['catalogue-execution-modes'];
    assert.strictEqual(entry.owner.file, RUNTIME, 'owned by the runtime catalogue');
    assert.strictEqual(entry.owner.marker, SEAT_MARKER);
    assert.deepStrictEqual(entry.sites, [{ file: CI, marker: SEAT_MARKER }], 'the CI catalogue is the one site');
    const dispatch = shared['catalogue-dispatch-explicit-only'];
    assert.strictEqual(dispatch.owner.marker, DISPATCH_MARKER, 'the dispatch marker stays verbatim');
    for (const file of [CI, RUNTIME])
    {
        assert.ok(flat(read(file)).includes(SEAT_MARKER), `${file}: the seat marker`);
        assert.ok(flat(read(file)).includes(DISPATCH_MARKER), `${file}: the dispatch marker`);
    }
});

// --- the offline proof: the steps pass a trace that keeps them and fail one that breaks them ------------------------

let seq = 0;
const tool = (name, input, parent) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] }, ...(parent ? { parent_tool_use_id: parent } : {}) });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const PROMPT = 'Load the CI failure signatures skill, then tell me why CI is red on my PR - the failing job\'s log is saved in ci.log.';
const LOAD = tool('Skill', { skill: 'issue-signatures-ci' });
const LOG_READ = tool('Read', { file_path: 'ci.log' });
const FAN_OUT_READ = tool('Read', { file_path: '/work/.claude/skills/issue-signatures-ci/references/gatherer-fan-out.md' });
const GATHERER = tool('Agent', { subagent_type: 'alfred-code:evidence-gatherer', description: 'pull the failed step log', prompt: 'Pull the failed step log of the red job and quote the first error.' });
const DIAGNOSER = tool('Agent', { subagent_type: 'alfred-code:issue-diagnoser-ci', description: 'diagnose the red CI', prompt: 'Diagnose the red CI run.' });
const VERDICT = 'The restore step is red: npm ci hit ERESOLVE. @fixture/chart-kit@2.4.0 wants react ^18 as a peer and the project pins react 19.0.0. Route: fix the manifest pin, not the code.';

const run = (...events) => jsonl([user(PROMPT), ...events, say(VERDICT)]);

test('group I fixture: a main-session triage passes every step, with or without a gatherer fan-out', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (...events) => sc.grade(fx, run(...events), { level: 'explicit' });
    const inline = grade(LOAD, LOG_READ);
    assert.deepStrictEqual(failing(inline), [], 'inline triage: no dispatch at all passes both item steps');
    assert.strictEqual(inline.graded, 3, 'no-seat-dispatch, fan-out-read and signature-named, nothing else');
    assert.deepStrictEqual(failing(grade(LOAD, FAN_OUT_READ, GATHERER, LOG_READ)), [], 'a fan-out after the reference read');
    assert.deepStrictEqual(failing(grade(LOAD, GATHERER, LOG_READ)), ['fan-out-read'], 'a fan-out with the reference never read');
    assert.deepStrictEqual(failing(grade(LOAD, GATHERER, FAN_OUT_READ)), ['fan-out-read'], 'a fan-out before the reference read');
});

test('group I fixture: each step fails only on its own canned fail trace', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (events, last = VERDICT) => sc.grade(fx, jsonl([user(PROMPT), ...events, say(last)]), { level: 'explicit' });
    // no-seat-dispatch: the diagnoser seat started from the skill (a Task spelling too)
    assert.deepStrictEqual(failing(grade([LOAD, DIAGNOSER])), ['no-seat-dispatch']);
    assert.deepStrictEqual(failing(grade([LOAD, tool('Task', { subagent_type: 'issue-diagnoser-runtime', prompt: 'Diagnose.' })])), ['no-seat-dispatch']);
    // an evidence-gatherer is no diagnoser seat
    assert.deepStrictEqual(failing(grade([LOAD, FAN_OUT_READ, GATHERER])), []);
    // signature-named: the verdict names neither the signature nor the peer clash
    assert.deepStrictEqual(failing(grade([LOAD, LOG_READ], 'CI is red because of a dependency problem in the install step.')), ['signature-named']);
    assert.deepStrictEqual(failing(grade([LOAD, LOG_READ], 'The install failed on a peer dependency clash.')), []);
});

test('SKF2-11: issue-signatures-ci-red is a listed explicit-level fixture with the brief\'s run, scaffold and steps', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    assert.deepStrictEqual(fx.run.stacks, ['javascript']);
    assert.deepStrictEqual(fx.run.allowed_tools, ['Read', 'Glob', 'Grep', 'Bash', 'Skill', 'Agent']);
    assert.deepStrictEqual(fx.run.selection.skills, ['issue-signatures-ci', 'habits-root-cause']);
    assert.deepStrictEqual(fx.run.selection.agents, ['issue-diagnoser-ci', 'evidence-gatherer']);
    assert.strictEqual(fx.run.max_turns, 15);
    assert.strictEqual(fx.prompts.explicit, PROMPT);
    assert.ok(fx.prompts.plain && fx.prompts.adverse, 'the check needs all three prompts; the round runs the explicit level only');
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['no-seat-dispatch', 'fan-out-read', 'signature-named']);
    assert.ok(fx.steps.every((s) => s.session === false), 'every step is bound to this fixture');
    assert.ok(!fx.steps.some((s) => s.graders.some((g) => g.type === 'llm')), 'no llm step');
    const scaffold = read(`meta/skill-comply/${FIXTURE}/scaffold.sh`);
    for (const line of ['"react": "^19.0.0"', '"@fixture/chart-kit": "^2.4.0"', 'Run npm ci', 'npm error code ERESOLVE', 'npm error While resolving: @fixture/chart-kit@2.4.0',
        'npm error Found: react@19.0.0', 'npm error peer react@"^18.0.0" from @fixture/chart-kit@2.4.0', 'Error: Process completed with exit code 1.'])
        assert.ok(scaffold.includes(line), `the scaffold holds ${line}`);
    assert.ok(scaffold.includes('ci.log'), 'the saved Actions log');
});
