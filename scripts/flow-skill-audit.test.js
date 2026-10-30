'use strict';
// The 2026-10-08 skills audit - the flow, loop and diagnose skills (seat skills-flows). Each block names the
// audit row it holds (skills.md BLOCKER n, a MATERIAL / MINOR row by skill and line, or a duplication /
// contradiction id), so a later edit that brings the defect back goes red here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lintSharedRules, lintAskTemplates } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const skill = (name) => read(`stack/skills/${name}/SKILL.md`);
const shared = () => JSON.parse(read('meta/shared-rules.json')).rules;
const copiesOf = (entry) => [entry.owner, ...(entry.sites || [])].map((c) => c.file);
// The registry findings for the named entries only - the rest of the registry is lint's job.
const registryFindings = (...names) => lintSharedRules({ rules: Object.fromEntries(names.map((n) => [n, shared()[n]])) }, read);

const TRIO_OWNER = 'stack/skills/task-solve-cross/references/domain-trio-protocol.md';
const TRIO_COPIES = [TRIO_OWNER, ...['loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage-quality', 'task-build-from-scratch']
    .map((s) => `stack/skills/${s}/references/domain-trio-protocol.md`)];

// ---- BLOCKER 1 (C1, D4): the vendored trio fan-out obeys the agent cap ------------------------------------------
test('BLOCKER 1: every trio protocol copy fans out up to the agent cap at once, never "expose all of it"', () => {
    for (const file of TRIO_COPIES) {
        const text = flat(read(file));
        assert.doesNotMatch(text, /all in parallel, from the main session/, `${file}: the uncapped fan-out is gone`);
        assert.doesNotMatch(text, /your job is to expose all of it/, `${file}: the uncapped fan-out is gone`);
        assert.match(text, /up to `ALFRED_CODE_MAXIMUM_RUN_AGENTS` at once \(default 5\), queueing the rest as seats return/, `${file}: the cap`);
        assert.match(text, /Fan out every task the designer marked independent, not a token two\./, `${file}: still fans out every independent task`);
    }
    for (const file of TRIO_COPIES.slice(1)) assert.strictEqual(read(file), read(TRIO_OWNER), `${file} is a verbatim copy of the owner`);
});

test('D4: the fan-out cap is one registered rule across its five phrasings', () => {
    const entry = shared()['fan-out-cap'];
    assert.ok(entry, 'fan-out-cap is registered');
    assert.strictEqual(entry.owner.file, 'stack/skills/task-solve-cross/references/execution-modes.md');
    const files = copiesOf(entry);
    for (const f of [...TRIO_COPIES, 'stack/skills/task-solve/references/step-mechanics.md', 'stack/skills/task-implement/SKILL.md', 'stack/skills/loop-test-coverage-quality/SKILL.md'])
        assert.ok(files.includes(f), `${f} is a pinned copy`);
    assert.deepStrictEqual(registryFindings('fan-out-cap'), []);
});

// ---- skills.md task-build-from-scratch MINOR (domain-trio-protocol.md:11): the stuck fix loop is an ask -------
test('trio protocol: two failed fix rounds end in ONE marked ask, never a bare escalation', () => {
    for (const file of TRIO_COPIES) {
        const text = flat(read(file));
        assert.doesNotMatch(text, /stop and escalate to the user/, `${file}: the bare stop is gone`);
        assert.match(text, /two implementer fix rounds maximum\*\*; still failing after that, stop and put it through ONE AskUserQuestion - 'Re-plan the task with the designer \(Recommended\)' \/ 'One more scoped fix round' \/ 'Stop and report BLOCKED'/, `${file}: the escalation ask`);
    }
});

// ---- the three improvement loops ------------------------------------------------------------------------------
const LOOPS = ['loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage-quality'];
const BLOCKED_RETRY = "is the gate working, not a fault - on 'continue', re-issue the same Skill call: the answered offer lets it through until the context grows 1.5x past it";
// The ask templates a skill carries (lint check 61's shape): the question line, then each option's label in order.
const asksIn = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) =>
{
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => l.replace(/^- '(.*)' - .*$/, '$1')) };
});
const askWith = (text, first) => asksIn(text).find((a) => a.options[0] === first);

// C5, D5, MATERIAL loop-architecture-quality:27 / loop-code-quality:33: guard-fresh-session-start re-arms on 1.5x growth
// (scripts/guard-hooks.test.js 'the size offer is answerable - the retry passes'), so a loop retries an answered block.
test('C5: a loop re-issues a capture call the fresh-session guard blocked, never reads the capture\'s SKILL.md instead', () => {
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /Never retry a blocked call/, `${name}: the line the hook contradicts is gone`);
        assert.doesNotMatch(text, /blocks EACH Skill call independently/, `${name}: the offer is per session, not per call`);
        assert.doesNotMatch(text, /protocol in-session by reading its `SKILL\.md`/, `${name}: no read into another skill's folder on a block`);
        assert.ok(text.includes(BLOCKED_RETRY), `${name}: the one registered retry sentence`);
        const fresh = askWith(skill(name), 'Resume in a fresh session (Recommended)');
        assert.ok(fresh && fresh.options.includes('Continue here'), `${name}: the blocked capture's fresh-session ask is a template`);
    }
    const entry = shared()['loop-blocked-capture-retry'];
    assert.ok(entry, 'registered');
    assert.deepStrictEqual(copiesOf(entry).sort(), LOOPS.map((n) => `stack/skills/${n}/SKILL.md`).sort());
    assert.deepStrictEqual(registryFindings('loop-blocked-capture-retry'), []);
});

// C6, D6, MATERIAL loop-*:63/67/55: the close's commit ask is the flows' template - the local commit recommended (the user's
// ruling 2026-10-13), a commit runs the checkpoint.
test('C6: every loop close recommends the local commit and routes it through the commit checkpoint', () => {
    const ask = "the commit decision is the ask below, never a prose 'your call' bullet";
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /\(commit now \/ hold\)/, `${name}: the unmarked, commit-first ask is gone`);
        assert.ok(text.includes(ask), `${name}: the registered sentence`);
        const commit = askWith(skill(name), 'Commit now (Recommended)');
        assert.ok(commit && commit.options[1] === 'Hold - review the diff first', `${name}: the marked ask, a template (audit 2026-10-14 SKF-06)`);
        assert.match(flat(skill(name)), /- 'Commit now \(Recommended\)' - `habits-commit-checkpoint`, whole/, `${name}: a commit runs the checkpoint`);
        assert.ok(askWith(skill(name), 'Tear it down (Recommended)'), `${name}: the tear-down ask is marked too`);
    }
    for (const name of ['loop-architecture-quality', 'loop-code-quality']) {
        const mech = flat(read(`stack/skills/${name}/references/loop-mechanics.md`));
        assert.doesNotMatch(mech, /commit now \/ hold/, `${name}/loop-mechanics.md: the report rules name the same ask`);
        assert.match(mech, /'Commit now \(Recommended\)', which runs `habits-commit-checkpoint` whole \/ 'Hold - review the diff first'/);
    }
    assert.doesNotMatch(shared()['loop-close-commit-ask']._note, /commit now \/ hold/, 'the registry note describes the new shape');
    assert.deepStrictEqual(registryFindings('loop-close-commit-ask'), []);
});

// MATERIAL loop-*:19/40/49, :19/44/53, :17/30/33: the mode, plan-approval and structural asks each mark one option.
test('loops: the mode, plan-approval and structural asks each mark exactly one option first', () => {
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.match(text, /ask ONE question before ANALYZE/, `${name}: the mode-ask-at-start marker stays`);
        assert.match(text, /the mark sits on the mode the `habits-execution-strategy` verdict picks/, `${name}: the mode ask's mark`);
        const raw = skill(name);
        assert.ok(askWith(raw, 'In this session (Recommended)'), `${name}: the mode ask is a template, this session first`);
        assert.doesNotMatch(text, /approve-and-build vs changes-needed/, `${name}: the unmarked approval ask is gone`);
        assert.deepStrictEqual((askWith(raw, 'Approve and build (Recommended)') || {}).options, ['Approve and build (Recommended)', 'Changes needed'], `${name}: the approval ask's mark`);
        assert.doesNotMatch(text, /apply \(routes as substantial\) vs decline vs defer/, `${name}: the unmarked structural ask is gone`);
        assert.deepStrictEqual((askWith(raw, 'Defer (Recommended)') || {}).options, ['Defer (Recommended)', 'Apply - routes as substantial', 'Decline'], `${name}: the structural ask's mark`);
        assert.ok(askWith(raw, 'Retry the stamp (Recommended)'), `${name}: the refused-stamp ask is marked (audit 2026-10-14 SKF-06)`);
    }
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR loop-architecture-quality:51, loop-code-quality:55: an INLINE answer never dispatches a resolver seat.
test('loops: a red routes to a resolver seat only in DELEGATED mode', () => {
    for (const name of ['loop-architecture-quality', 'loop-code-quality']) {
        const text = flat(skill(name));
        assert.match(text, /a red routes, in DELEGATED mode, to the matching build- or test-failure resolver seat where the project installed one/, name);
        assert.match(text, /INLINE, or with no matching seat installed, fix the red in-session/, name);
        assert.match(text, /green across the round/, `${name}: the loop-green-across-round marker stays`);
    }
    assert.deepStrictEqual(registryFindings('loop-green-across-round'), []);
});

// MINOR loop-architecture-quality:9, loop-test-coverage-quality:9: no see-also into a sibling loop.
test('loops: the opening paragraph carries no see-also into a sibling loop', () => {
    assert.doesNotMatch(flat(skill('loop-architecture-quality')), /the code-focused counterpart is `loop-code-quality`/);
    assert.doesNotMatch(flat(skill('loop-test-coverage-quality')), /exactly like `loop-architecture-quality` for architecture/);
});

// MINOR loop-code-quality:23: each staged-mode companion is named with the step that reads it.
test('loop-code-quality: each staged companion is named with the step that reads it', () => {
    const text = flat(skill('loop-code-quality'));
    for (const piece of [/`references\/rules\.md` \(before the first stage's first pass\)/, /`references\/stage-close\.md` \(at each stage STOP or pause, and on resume\)/,
        /`references\/delegated-mode\.md` \(DELEGATED only, before the first dispatch\)/, /`references\/worked-example\.md` \(optional/, /`references\/bootstrap\.md` \(a missing or empty loops folder\)/])
        assert.match(text, piece);
    assert.doesNotMatch(text, /each Read at the step of `staged-mode\.md` that names it/);
});

// MINOR loop-test-coverage-quality:28 (D3): no per-stack runner list in the generic loop; :66: the resume block is a template.
test('loop-test-coverage-quality: the runner default is the house testing skill\'s, and the resume block is a fenced template', () => {
    const text = skill('loop-test-coverage-quality');
    assert.doesNotMatch(flat(text), /plain JS\/TS: Vitest; \.NET: xUnit/);
    assert.match(flat(text), /propose the runner the stack's house testing skill records as its default \(absent one, the framework's own documented default, cited\)/);
    const block = (text.match(/```text\n\s*(RESUME - loop-test-coverage-quality[\s\S]*?)```/) || [])[1] || '';
    assert.ok(block, 'a fenced RESUME BLOCK');
    for (const field of ['Invocation:', 'rounds consumed', 'Read first:', '## Resume', 'Remaining weak points, tier order']) assert.ok(block.includes(field), `the block carries ${field}`);
});

// ---- the single-chat twins, the greenfield build and the upgrade flow ----------------------------------------
// MATERIAL task-implement:60 (invocation map): a shared contract is a marked ask that names the manual-only flow to the USER.
test('task-implement: a surfaced shared contract is ONE marked ask naming /task-solve-cross as the user\'s command', () => {
    const text = flat(skill('task-implement'));
    assert.doesNotMatch(text, /stop - that is `task-solve-cross` territory/, 'the bare stop is gone');
    assert.match(text, /stop the task and put it through ONE ask/);
    assert.deepStrictEqual(askWith(skill('task-implement'), 'Hand it to the cross-domain flow (Recommended)').options,
        ['Hand it to the cross-domain flow (Recommended)', 'Keep it in this plan as a scoped change', 'Stop the build']);
    assert.match(text, /- 'Hand it to the cross-domain flow \(Recommended\)' - you run `\/task-solve-cross`; this build stops here/);
    assert.match(text, /BLOCKED_CONTRACT_CHANGE discipline the dispatched seats follow/);
});

// MATERIAL task-implement:34 (C13): the fifth-red ask offers the resolver seat; no parenthetical says the skill never uses one.
test('C13: task-implement\'s fifth-red ask stands alone, with no see-also into the cross-domain flow', () => {
    const text = flat(skill('task-implement'));
    assert.doesNotMatch(text, /To offload a large, noisy fix loop/);
    assert.doesNotMatch(text, /this single-chat skill stays inline/);
});

// MATERIAL task-implement:21,26,34,35,59 + MINOR :64: every ask marks one option first.
test('task-implement: the mode, approval, fifth-red, FAILED, scope and reviewer asks each mark one option', () => {
    const text = flat(skill('task-implement'));
    const raw = skill('task-implement');
    const opts = (first) => (askWith(raw, first) || {}).options;
    assert.match(text, /ask ONE question before building and hold the answer; a mode the run already picked is inherited, never re-asked\. The mark sits on the mode the `habits-execution-strategy` verdict picks/);
    assert.deepStrictEqual(opts('In this chat (Recommended)'), ['In this chat (Recommended)', 'Dispatch the implementer seats']);
    assert.deepStrictEqual(opts('Approve - build task 1 (Recommended)'), ['Approve - build task 1 (Recommended)', 'Changes needed']);
    assert.match(text, /after the FIFTH red run of one task's gate the next act is ONE ask, never a sixth run - the mark on 'Keep fixing inline' when the last red run changed, else on the resolver seat \(or 'Stop' where the project installed none\), listed first/);
    assert.deepStrictEqual(opts('Keep fixing inline (Recommended)'), ['Keep fixing inline (Recommended)', 'Hand it to a resolver seat', 'Stop']);
    assert.deepStrictEqual(opts('Stop and report (Recommended)'), ['Stop and report (Recommended)', 'Continue inline', 'Resolver seat', 'Revert']);
    assert.match(text, /ends the turn with ONE ask before any further run or edit/);
    assert.deepStrictEqual(opts('Leave it for later (Recommended)'), ['Leave it for later (Recommended)', 'Add it to the plan']);
    assert.deepStrictEqual(opts('Defer (Recommended)'), ['Defer (Recommended)', 'Fix now, ad hoc', 'Open a new cycle']);
    assert.deepStrictEqual(opts('task-verify-code in-session (Recommended)'), ['task-verify-code in-session (Recommended)', 'The <stack>-verifier seat']);
    assert.match(text, /the reviewer through ONE ask unless a calling flow already chose it/);
    assert.deepStrictEqual(opts('Re-design this slice with task-design (Recommended)'), ['Re-design this slice with task-design (Recommended)', 'Continue against the delta', 'Stop the build here']);
    assert.doesNotMatch(text, /your choice of reviewer:/, 'no unasked reviewer pick');
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR task-implement:66: the ceilings procedure is a close-time reference; the rule stays in the body.
test('task-implement: Known ceilings keeps its rule in the body and its docs.js procedure in a reference', () => {
    const b = flat(skill('task-implement'));
    assert.match(b, /File every deliberate simplification this build made as a `where \| limit \| revisit when` row - never a code comment - before the close: Read `references\/known-ceilings\.md`/);
    assert.doesNotMatch(b, /docs\.js show architecture/, 'the procedure left the body');
    const ref = flat(read('stack/skills/task-implement/references/known-ceilings.md'));
    assert.match(ref, /docs\.js set awareness\/ARCHITECTURE-AWARENESS\.md#known-ceilings --expect <that hash>/);
    assert.match(ref, /`architecture\/ARCHITECTURE\.md#known-ceilings`, the legacy home, in an install not yet updated/);
    assert.ok(copiesOf(shared()['known-ceilings-filing']).includes('stack/skills/task-implement/references/known-ceilings.md'));
    assert.deepStrictEqual(registryFindings('known-ceilings-filing'), []);
});

// MATERIAL task-build-from-scratch:23 + MINOR :29, :31: the pick, the mode and each slice's plan are marked asks.
test('task-build-from-scratch: the architecture pick, the mode ask and each slice\'s plan approval mark one option', () => {
    const text = flat(skill('task-build-from-scratch'));
    const raw = skill('task-build-from-scratch');
    assert.match(text, /put the pick through one ask - one option per architecture, a custom direction always available via Other/);
    assert.match(text, /- '<architecture A> \(Recommended\)' - <its stack; the reason that decides it>/);
    assert.match(text, /ask ONE question before the first slice and hold the answer for the run \(an invocation that already names the mode is the answer\) - the mark on the mode the `habits-execution-strategy` verdict picks, listed first/);
    assert.ok(askWith(raw, 'In this session (Recommended)'), 'the mode ask is a template');
    assert.match(text, /Each slice's designer plan goes through ONE ask before its first implementer, and the stamp below quotes the answer:/);
    assert.deepStrictEqual((askWith(raw, 'Approve and build (Recommended)') || {}).options, ['Approve and build (Recommended)', 'Changes needed']);
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR task-design:12, :86, write-and-hand-off.md:18, evidence.md:14.
test('task-design: a marked mode ask, the mode left to the build step, a flow-aware hand-off and no stale evidence row', () => {
    const text = flat(skill('task-design'));
    // audit 2026-10-14 SKF-10: the mode ask moved to a reference read in this chat - the 10 designer seats preload no ask text
    const mode = flat(read('stack/skills/task-design/references/design-mode.md'));
    assert.match(mode, /ask ONE question before designing, via AskUserQuestion - this chat, or the designer seat\? - one option marked `\(Recommended\)` and listed first: this chat, unless the user asked for isolation - and hold the answer/);
    assert.match(text, /In this chat, ask the mode per `references\/design-mode\.md` - read it before designing/);
    assert.match(text, /Inside a designer seat: no ask, no dispatch/);
    assert.doesNotMatch(text, /Research fan-out|AskUserQuestion - this chat, or the designer seat/, 'the ask mechanics left the preloaded body');
    assert.doesNotMatch(text, /belongs to `task-solve`'s mode ask/);
    assert.match(text, /The execution mode is the build step's ask, never the plan's\./);
    const hand = flat(read('stack/skills/task-design/references/write-and-hand-off.md'));
    assert.match(hand, /Inside a calling flow, return to it - its stop owns what runs next\. On its own, name the next steps in the close: gate the plan with `task-verify-plan` before building/);
    assert.doesNotMatch(read('stack/skills/task-design/references/evidence.md'), /Strip the format skill's banner/);
});

// MINOR task-verify-plan:20, :44.
test('task-verify-plan: the upgrade flow is named to the user, and the seat boundary carries no ownership attribution', () => {
    const text = flat(skill('task-verify-plan'));
    assert.doesNotMatch(text, /`task-solve-cross` and its trio protocol own that call/);
    assert.match(text, /\(the inherited-mode dispatch applies only to this skill's own single-chat chain\)/);
    assert.doesNotMatch(text, /the staged upgrade flow \(`task-version-upgrade`\)/);
    assert.match(text, /that is the staged upgrade flow, with a green gate after every stage, not a feature plan - name `\/task-version-upgrade` to the user as their command\./);
});

// MINOR task-version-upgrade:64: a plan contradicted mid-run is a marked ask.
test('task-version-upgrade: a hard stop puts re-plan, roll back or stop through ONE marked ask', () => {
    const text = flat(skill('task-version-upgrade'));
    assert.doesNotMatch(text, /stop and re-plan, never push through/);
    // stack audit 2026-10-20 row 13: the hard stop is an ask template, the re-plan option marked and first
    assert.match(text, /stop and put it through ONE AskUserQuestion, never push through or skip a stage gate: ```ask Stage <N> hit a hard stop: [^`]*- 'Re-plan from this stage \(Recommended\)' - [^`]*- 'Roll back to the last stage's rollback point' - [^`]*- 'Stop here' - /);
});

// ---- the two solve flows and the plan-bound review -------------------------------------------------------------
const body = (text) => String(text).replace(/^---\n[\s\S]*?\n---\n/, '');

// MINOR task-solve/references/step-mechanics.md:40: the dispatch guard reads a pre-session stamp as stale.
test('task-solve: the AUTO stamp ends with the session; a resumed session re-writes it only from that session\'s words', () => {
    const mech = flat(read('stack/skills/task-solve/references/step-mechanics.md'));
    // final review 2026-10-27 I5: the line names which stamp - the hook's session stamp is never deleted
    assert.match(mech, /This hand-written AUTO stamp lives until step 6's close deletes it or the session ends \(the hook's session stamp is never deleted - step 6 deletes its run marker\) - a resumed session re-writes it only from the user's waiver words typed in THAT session, else the next dispatch asks\./);
});

// MINOR task-solve:172: the agents-mode stamp's first line is given, not learned from a bounce.
test('task-solve: the agents-mode approval stamp names its first line', () => {
    // Usage audit 2026-10-10: the agents-mode dispatch rules live in the step mechanics, read at step 3.
    assert.match(flat(read('stack/skills/task-solve/references/step-mechanics.md')), /Write the approval gate file first - first line `APPROVED <contract_version> - "<the step-3 answer, verbatim>"`/);
    assert.deepStrictEqual(registryFindings('approval-gate-stamp'), []);
});

// MINOR task-solve:110-120: the spec-check lookup is a reference, mirroring the cross-task flow's; the body keeps the rule.
test('task-solve: the spec-check lookup lives in references/full-spec.md, the verdict line stays in the body', () => {
    const b = body(skill('task-solve'));
    assert.doesNotMatch(b, /```bash\nSPEC=/, 'the lookup block left the body');
    assert.match(flat(b), /Run it by the lookup in `references\/full-spec\.md`/);
    assert.match(flat(b), /`Spec: <full\|not full> - <path> - <its reason>`/);
    const ref = read('stack/skills/task-solve/references/full-spec.md');
    assert.match(ref, /SPEC=\.claude\/skills\/task-solve\/scripts\/spec-check\.js/);
    assert.ok(copiesOf(shared()['full-spec-script']).includes('stack/skills/task-solve/references/full-spec.md'));
    assert.deepStrictEqual(registryFindings('full-spec-script'), []);
    assert.ok(b.length < 17700, `the move frees room under the 18,000 cap: ${b.length}`);
});

// MATERIAL task-solve-cross/references/issue-investigation.md:93: the fix decision is a marked ask.
test('task-solve-cross: the investigate-and-fix decision is ONE marked ask, the diagnosis route recommended', () => {
    const inv = flat(read('stack/skills/task-solve-cross/references/issue-investigation.md'));
    assert.doesNotMatch(inv, /pass an EXPLICIT fix decision gate/);
    assert.match(inv, /Diagnose, then put the fix decision through ONE AskUserQuestion - the diagnosis's `fix_recommendation\.route` as the option marked `\(Recommended\)`, then 'Diagnosis only - stop here' - never slide silently from diagnosis into implementation\./);
});

// agents.md F09 (C3): CI_PASSING is a status the diagnosis protocol can route.
test('task-solve-cross: the diagnosis vocabulary carries CI_PASSING, the status the CI diagnoser returns', () => {
    const inv = read('stack/skills/task-solve-cross/references/issue-investigation.md');
    assert.match(inv, /^status: DIAGNOSED \| NOT_REPRODUCED \| NEEDS_MORE_EVIDENCE \| LIKELY_FLAKE \| INCONCLUSIVE \| CI_PASSING/m);
    assert.deepStrictEqual(registryFindings('diagnosis-status-vocabulary'), []);
    // The agents seat pins this phrase as a shared-rules marker on the same file (F13), so it stays verbatim.
    assert.match(flat(inv), /is the stack's one sanctioned nested dispatch\./);
});

// Named cites (skills.md 4): the four resolver seats carry the absent path.
test('task-solve-cross: the fix routing names what runs when a resolver seat is not installed', () => {
    assert.match(flat(read('stack/skills/task-solve-cross/references/issue-investigation.md')), /Each resolver above runs where the project installed one; otherwise the fix loop runs in-session\./);
});

// MINOR task-solve-cross:51, :72 + capability-reuse.md:27-30.
test('task-solve-cross: the standard row names its modes, the routing read has a receipt, and the dispatch claim is true', () => {
    const b = body(skill('task-solve-cross'));
    assert.match(b, /\| standard \| anything else in one domain \| a single-stack mode below \(`implementer_only` \/ `domain_trio`\) \|/);
    assert.match(flat(b), /Read it before you pick, then pick the smallest mode, and write `routing policy: read` into the ledger beside the mode answer\./);
    assert.ok(b.length < 18000, `M99 cap holds: ${b.length}`);
    const reuse = flat(read('stack/skills/task-solve-cross/references/capability-reuse.md'));
    assert.doesNotMatch(reuse, /the house dispatch guard denies a run started any other way/);
    assert.doesNotMatch(reuse, /lands on this skill/);
    assert.match(reuse, /the house flows are the entry points for multi-agent work, dispatch is explicit and never automatic, and the dispatch guard blocks an implementer that carries no approval stamp\./);
    assert.deepStrictEqual(registryFindings('size-first-table'), []);
});

// MINOR task-verify-code:60: step 4's two unfielded checks get a receipt.
test('task-verify-code: the output carries a Regression field, and the worked example fills it', () => {
    const text = skill('task-verify-code');
    assert.match(flat(text), /\*\*Six named fields, every run, each with a value\.\*\*/);
    assert.match(text, /^Regression: <callers checked: N, vacuous tests: none \| the test and why>$/m);
    const example = (text.split('## Example')[1] || '').match(/```text\n([\s\S]*?)```/)[1];
    assert.match(example, /^Regression: callers checked: \d+, vacuous tests: none$/m);
    assert.match(shared()['verifier-output-named-fields']._note, /task-verify-code carries six/);
});

// MINOR task-verify-code:74: the receipt shape is read when a commit is next; the no-receipt guard stays in the body.
test('task-verify-code: the COMMIT-GATE receipt moves to a reference, the punch-list guard stays in the body', () => {
    const b = flat(body(skill('task-verify-code')));
    assert.doesNotMatch(b, /`VERIFIED <what was reviewed, one phrase>`/, 'the receipt lines left the body');
    assert.match(b, /When the review is the pre-commit checkpoint \(a commit is the next act\) and the verdict is sound - or sound after fixes that landed and re-verified - Read `references\/commit-gate-receipt\.md` and write the receipt it shapes\. A punch-list with unresolved BLOCKER\/MATERIAL findings writes no receipt\./);
    const ref = flat(read('stack/skills/task-verify-code/references/commit-gate-receipt.md'));
    for (const piece of ['VERIFIED <what was reviewed, one phrase>', 'authorized: "<the user\'s words asking for THIS commit, verbatim>"', '`security:` naming each category checked and its verdict'])
        assert.ok(ref.includes(piece), piece);
    for (const id of ['commit-gate-receipt', 'commit-gate-security-row', 'commit-gate-authorized-line'])
        assert.ok(copiesOf(shared()[id]).includes('stack/skills/task-verify-code/references/commit-gate-receipt.md'), id);
    assert.deepStrictEqual(registryFindings('commit-gate-receipt', 'commit-gate-security-row', 'commit-gate-authorized-line'), []);
});

// ---- the diagnose flow and the two signature catalogues --------------------------------------------------------
// MINOR issue-diagnoser:3, :164, :113/:131/:183, evidence-tiers.md:31.
test('issue-diagnoser: a when-shaped description, cards on the strategy\'s split, stories in the appendix, the paste as a marked ask', () => {
    const desc = (skill('issue-diagnoser').match(/^description:\s*"(.*)"\s*$/m) || [])[1] || '';
    assert.match(desc, /^Use when a failure needs investigating/);
    assert.match(desc, /Not for the fix, which \/task-solve owns\.$/);
    assert.ok(desc.length <= 160, `${desc.length} chars`);
    const b = flat(body(skill('issue-diagnoser')));
    assert.match(b, /Read-only throughout: it never writes the fix\./, 'read-only stays in the body');
    assert.match(b, /Then decompose the minimal change per cause into tasks on that split, each with a contract/);
    for (const story of [/36-call stretch/, /17h15m/, /a listing held the local-runtime catalogue/]) {
        assert.doesNotMatch(b, story, `${story} left the run-time body`);
        assert.match(flat(read('stack/skills/issue-diagnoser/references/evidence.md')), story, `${story} kept in the appendix`);
    }
    const tiers = flat(read('stack/skills/issue-diagnoser/references/evidence-tiers.md'));
    assert.doesNotMatch(tiers, /ask the user to paste the event/);
    assert.match(tiers, /say so in one line and put it through the step-1 stop: 'Paste the event \(Recommended\)' \/ 'Proceed at tier 4 from the code'/);
});

// MATERIAL issue-signatures-ci:55-59 + MINOR :25.
test('issue-signatures-ci: the worked verdict carries its proof line, and the quality gate is stated for any stack', () => {
    const text = skill('issue-signatures-ci');
    assert.match(flat(text), /The four-line verdict it produces:/);
    const verdict = (text.match(/```text\n(signature:[\s\S]*?)```/) || [])[1] || '';
    assert.deepStrictEqual(verdict.split('\n').filter(Boolean).map((l) => l.split(':')[0]), ['signature', 'call', 'route', 'proof']);
    assert.match(verdict, /^proof: after the feed secret is rotated, a re-run of the failed jobs \(`gh run rerun --failed`, `glab ci retry`\) passes with no code change - NOT RUN until then$/m);
    assert.doesNotMatch(flat(text), /The \.NET gate is a build/);
    assert.match(flat(text), /A quality gate is usually a build with warnings promoted to errors plus a formatter check \(`dotnet format --verify-no-changes`, `prettier --check`, `eslint`\)/);
});

// MATERIAL issue-signatures-runtime:44-48 + MINOR gatherer-fan-out.md:33-37.
test('issue-signatures-runtime: the match states its hypothesis and proof, and the never-the-seat rule sits in the body', () => {
    const text = skill('issue-signatures-runtime');
    assert.match(flat(text), /State the match in four lines - the quoted evidence, the signature, the isolation point and the hypothesis it warrants - plus the proof line once the check has run/);
    const block = (text.match(/```text\n(Evidence:[\s\S]*?)```/) || [])[1] || '';
    assert.deepStrictEqual(block.split('\n').filter(Boolean).map((l) => l.split(':')[0]), ['Evidence', 'Signature', 'Isolate', 'Hypothesis', 'Proof']);
    assert.match(block, /^Hypothesis: the singleton job stores the scoped DbContext it resolved at startup$/m);
    const exec = flat(text.split('## Execution modes')[1].split('\n## ')[0]);
    assert.match(exec, /Do NOT dispatch the diagnoser seat from this skill/);
    assert.doesNotMatch(read('stack/skills/issue-signatures-runtime/references/gatherer-fan-out.md'), /## Never the diagnoser seat/);
    assert.deepStrictEqual(registryFindings('catalogue-dispatch-explicit-only'), []);
    for (const c of shared()['catalogue-dispatch-explicit-only'].sites.concat(shared()['catalogue-dispatch-explicit-only'].owner))
        assert.match(c.marker, /Do NOT dispatch the diagnoser seat from this skill/, `${c.file}: the marker covers the never-the-seat sentence`);
});

// MINOR issue-signatures-ci gatherer-fan-out.md (D10): the shared 'The ask' paragraph is one registered rule.
test('D10: the two gatherer fan-out references share one registered ask rule, owned by the runtime copy', () => {
    const entry = shared()['catalogue-gatherer-ask'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/skills/issue-signatures-runtime/references/gatherer-fan-out.md');
    assert.deepStrictEqual(copiesOf(entry).sort(), ['stack/skills/issue-signatures-ci/references/gatherer-fan-out.md', 'stack/skills/issue-signatures-runtime/references/gatherer-fan-out.md']);
    assert.deepStrictEqual(registryFindings('catalogue-gatherer-ask'), []);
});

// MINOR task-verify-code:36 (D3): the in-process probe is the stack's in-memory host test; .NET's is a labelled example.
test('task-verify-code: the in-process probe is stated for any stack, the .NET host named as its example', () => {
    const b = flat(body(skill('task-verify-code')));
    assert.match(b, /For a web API an in-process run through the app's real entry point IS that call - the stack's in-memory host test \(on \.NET a `WebApplicationFactory<Program>` test through the real `Program`/);
});

// ---- audit 2026-10-14 (skills-flows): the no-decision rows ----------------------------------------------------------
const FLOW_SKILLS = ['issue-diagnoser', 'issue-signatures-ci', 'issue-signatures-runtime', 'loop-architecture-quality', 'loop-code-quality',
    'loop-test-coverage-quality', 'task-build-from-scratch', 'task-design', 'task-implement', 'task-solve', 'task-solve-cross', 'task-verify-code',
    'task-verify-plan', 'task-version-upgrade'];
const flowFiles = () => FLOW_SKILLS.flatMap((n) => {
    const dir = path.join(ROOT, 'stack/skills', n);
    const refs = fs.existsSync(path.join(dir, 'references')) ? fs.readdirSync(path.join(dir, 'references')).map((f) => `references/${f}`) : [];
    return ['SKILL.md', ...refs].filter((f) => f.endsWith('.md')).map((f) => `stack/skills/${n}/${f}`);
});
const description = (name) => (skill(name).match(/^description:\s*"(.*)"\s*$/m) || [])[1] || '';
const askBlocks = (text) => [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.slice(1).map((l) => (/^- '(.*)' - /.exec(l) || [])[1]).filter(Boolean) };
});

// SKF-05: 042640ca moved the cursor and handoff notes to alfred-memory; five lines still sent them to the navigation server.
test('SKF-05: no flow skill hands off, purges or deletes a note on the navigation server', () => {
    for (const f of flowFiles())
        assert.doesNotMatch(flat(read(f)), /navigation-server hand-off|navigation server cursor note|purge the navigation-server/, f);
    const close = flat(skill('issue-diagnoser'));
    // 2026-10-24: the cursor is a note on the handoff bus, and the reusable half lands in the findings file the next run greps.
    assert.match(close, /Purge this run's cursor \(`node \.claude\/hooks\/handoff\.js purge <slug>`\); when the cause was proven, first write the signature and its fix into the findings file's `Cause` stamp - the reusable half, which a later diagnosis greps `<docs-path>\/work\/diagnoses\/` for/);
    assert.match(flat(read('stack/skills/loop-code-quality/references/staged-mode.md')), /purge the run's handoff notes fold-first/);
});

// SKF-09 / SKF-15: task-design and task-verify-plan collided at Jaccard 0.278 with neither naming the other's case; the
// cross-task flow's description hid its bug family.
test('SKF-09 + SKF-15: the design and plan-audit descriptions each exclude the other, and the cross flow names its bug family', () => {
    assert.match(description('task-design'), /Not for one-line edits or a plan audit\.$/);
    assert.match(description('task-verify-plan'), /^Use to audit an existing plan or design before code - .*Not plan writing or code review\.$/);
    assert.match(description('task-solve-cross'), /a cross-stack bug/);
    for (const n of ['task-design', 'task-verify-plan', 'task-solve-cross']) assert.ok(description(n).length <= 160, `${n}: ${description(n).length}`);
});

// The 2026-10-17 usage audit: a customer-side bug was fixed before its symptom was ever reproduced; task-design opens such a
// plan with a reproduce task, and step 3's background runs get one start line (task-solve's step mechanics).
test('2026-10-17: a customer-side bug opens with its symptom reproduced; a background run gets one start line', () => {
    // Item 4 (2026-10-25) moved the rule into design-rules.md, which step 4 reads; SKILL.md keeps the pointer.
    assert.match(read('stack/skills/task-design/references/design-rules.md'), /A bug seen only on the customer's side .* opens with a task whose acceptance is the reported symptom reproduced, its exact error text or log row quoted, before any fix task/);
    assert.match(skill('task-design'), /A bug seen only on the customer's side - read `references\/design-rules\.md`/);
    const mech = read('stack/skills/task-solve/references/step-mechanics.md');
    assert.match(mech, /^## Background runs - the one start line$/m);
    assert.match(mech, /ONE wait whose\ncommand ends on the result or a crash/);
    assert.match(mech, /no reply per sample or per poll/);
});

// SKF-11: both closes left a large uncommitted diff with no commit decision, while every sibling flow asks one.
test('SKF-11: the greenfield and upgrade closes put the commit through a marked ask', () => {
    for (const n of ['task-build-from-scratch', 'task-version-upgrade']) {
        const commit = askBlocks(skill(n)).find((a) => a.options.some((o) => /^Commit now/.test(o)));
        assert.ok(commit, `${n}: a commit ask template`);
        assert.deepStrictEqual(commit.options, ['Commit now (Recommended)', 'Hold - review the diff first'], n);
        assert.match(flat(skill(n)), /runs `habits-commit-checkpoint` in full/, n);
    }
    assert.match(skill('task-build-from-scratch'), /^Commit: {4}<the commit `git log -1 --stat` read back \| held - the diff is uncommitted \| no git - the scaffold is not a repository>$/m);
});

// SKF-12: the playbooks are the upgrade's contract, but nothing recorded the read.
test('SKF-12: the upgrade plan opens on a playbooks receipt', () => {
    const t = flat(skill('task-version-upgrade'));
    assert.match(t, /The printed plan's first line is the receipt: `playbooks: read - <the stack section\(s\) applied>`/);
    assert.match(t, /PRINT the staged plan in the chat first - the `playbooks:` line, then every stage/);
});

// SKF-13: the body sent multi-source evidence to the gated flow while its reference dispatched gatherers for it.
test('SKF-13: the runtime catalogue routes multi-source evidence one way - the gatherer fan-out', () => {
    const t = flat(skill('issue-signatures-runtime'));
    assert.match(t, /When the evidence spans more than one source, the gatherer fan-out below handles it/);
    assert.doesNotMatch(t, /that is the gated four-step investigation flow, not a lookup/);
    assert.match(flat(read('stack/skills/issue-signatures-runtime/references/gatherer-fan-out.md')), /the evidence spans two or more independent sources/);
});

// SKF-14: plan_review is the user's approval field; the plan audit's own record is its Passes: line.
test('SKF-14: the loops record the plan audit by its Passes: line', () => {
    for (const n of ['loop-architecture-quality', 'loop-code-quality']) {
        assert.match(flat(skill(n)), /\*\*Gate the plan\*\* - `task-verify-plan`, an actual Skill invocation, recording its `Passes:` line\./, n);
        assert.doesNotMatch(skill(n), /recording `plan_review: approved\|waived`/, n);
    }
    assert.match(skill('task-verify-plan'), /^Passes: {4}risk <v> \| scope <v>/m, 'the field the loops copy exists');
});

// SKF-16: the coverage loop forbade weakened and assertion-free tests with no sweep and no report field behind the rule.
test('SKF-16: the coverage loop vendors the anti-gaming sweep, records its baseline and reports the verdict', () => {
    const t = flat(skill('loop-test-coverage-quality'));
    assert.match(t, /round 1 also records the sweep baseline: HEAD, or on a dirty tree the sha `git stash create` prints/);
    assert.match(t, /Read `references\/anti-gaming-sweep\.md` and run its four commands against the sweep baseline/);
    assert.match(t, /`Anti-gaming: <clean \| what was reverted>`/);
    assert.match(skill('loop-test-coverage-quality'), /^ {2}Sweep baseline: <sha recorded at round 1>/m, 'the RESUME BLOCK carries the baseline');
    const entry = shared()['anti-gaming-sweep-commands'];
    assert.deepStrictEqual(copiesOf(entry), ['stack/skills/loop-code-quality/references/anti-gaming-sweep.md', 'stack/skills/loop-test-coverage-quality/references/anti-gaming-sweep.md']);
    assert.deepStrictEqual(registryFindings('anti-gaming-sweep-commands'), []);
    assert.match(flat(read('stack/skills/loop-test-coverage-quality/references/anti-gaming-sweep.md')), /Any hit is a BLOCKER/);
});

// SKF-04 (the user's ruling, option A): the upgrade carried a legacy `--auto` that 'skips the gate' beside auto-mode, which
// answers every marked ask - so a stage that stayed red re-planned unattended with no cap. One mode now (auto-run since the
// stack-modes spec of 2026-10-27): auto-run answers
// the gate, and the hard-stop ask goes out unmarked under it, so the hook leaves it for the user (lint 61 holds templates
// only, and this ask is prose; scripts/auto-mode.test.js replays both shapes through the hook).
test('SKF-04: the upgrade has one auto mode, and its hard stop waits for the user under it', () => {
    const t = flat(skill('task-version-upgrade'));
    assert.strictEqual((t.match(/--auto\b(?!-)/g) || []).length, 1, 'the only --auto left is the line saying it starts nothing');
    assert.doesNotMatch(t, /--auto-mode/, 'the old flag is gone');
    assert.doesNotMatch(t, /Auto mode (skips|still stops|\(explicitly requested\))|auto mode included|skipping the approval gate/, 'the legacy mode is folded');
    assert.match(t, /\*\*Under auto-run the gate is answered, not skipped - and only when the user turned auto-run on, the hook's contract in context\.\*\*/);
    assert.match(t, /the old `--auto`, 'auto mode' or `auto-mode` wording starts nothing, and the gate stands/);
    assert.match(t, /Hard stops, auto-run included:/);
    assert.match(t, /Under auto-run put the same three options with NO `\(Recommended\)` mark, the question opening 'no option is recommended: a hard stop waits for you under auto-run' - the hook answers only a marked ask, so this one waits\./);
    // the attended ask keeps its mark, and the modes paragraph is untouched
    assert.match(t, /- 'Re-plan from this stage \(Recommended\)' - .* - 'Roll back to the last stage's rollback point' - .* - 'Stop here' - /);
    assert.match(t, /\*\*Modes\.\*\* Mode flags right after the command - `--mode-auto-run-on`/);
});

// ---- stack-modes (spec 2026-10-27 sections 7, 8): the flows read the four mode flags, never an old one ------------
const MODE_FLAG_NAMES = ['--mode-auto-run-on', '--mode-auto-run-off', '--mode-output-scorer-on', '--mode-output-scorer-off'];
test('every flow paragraph names the four mode flags and no old flag (AC10)', () => {
    const files = copiesOf(shared()['auto-mode-contract']);
    assert.strictEqual(files.length, 19, 'the owner and its 18 sites (capture-quality\'s router joined its three parts, 2026-10-29)');
    for (const file of files) {
        const t = read(file);
        for (const flag of MODE_FLAG_NAMES) assert.ok(t.includes(flag), `${file} names ${flag}`);
        assert.doesNotMatch(t, /--auto-mode|--score-(?:on|off)/, `${file} names no old flag`);
    }
    assert.deepStrictEqual(registryFindings('auto-mode-contract', 'no-stops-points-to-auto-mode', 'approval-stamp-auto-carve-out'), []);
});
test('M2: mode-auto-run says auto-run did not start because no hook ran when no contract line is in context (AC11)', () => {
    const t = flat(skill('mode-auto-run'));
    assert.match(t, /no hook ran/);
    assert.match(t, /no `auto-run is ON` contract line is in context[^.]*no hook ran[^.]*stop/i);
    assert.doesNotMatch(t, /--auto-mode/);
});
