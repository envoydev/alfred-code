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
const TRIO_COPIES = [TRIO_OWNER, ...['loop-architecture-quality', 'loop-quality', 'loop-test-coverage', 'task-build-from-scratch']
    .map((s) => `stack/skills/${s}/references/domain-trio-protocol.md`)];

// ---- BLOCKER 1 (C1, D4): the vendored trio fan-out obeys the 3-at-once cap -------------------------------------
test('BLOCKER 1: every trio protocol copy fans out up to 3 at once, never "expose all of it"', () => {
    for (const file of TRIO_COPIES) {
        const text = flat(read(file));
        assert.doesNotMatch(text, /all in parallel, from the main session/, `${file}: the uncapped fan-out is gone`);
        assert.doesNotMatch(text, /your job is to expose all of it/, `${file}: the uncapped fan-out is gone`);
        assert.match(text, /up to 3 at once \(more only on the user's ask\), queueing the rest as seats return/, `${file}: the cap`);
        assert.match(text, /Fan out every task the designer marked independent, not a token two\./, `${file}: still fans out every independent task`);
    }
    for (const file of TRIO_COPIES.slice(1)) assert.strictEqual(read(file), read(TRIO_OWNER), `${file} is a verbatim copy of the owner`);
});

test('D4: the fan-out cap is one registered rule across its five phrasings', () => {
    const entry = shared()['fan-out-cap'];
    assert.ok(entry, 'fan-out-cap is registered');
    assert.strictEqual(entry.owner.file, 'stack/skills/task-solve-cross/references/execution-modes.md');
    const files = copiesOf(entry);
    for (const f of [...TRIO_COPIES, 'stack/skills/task-solve/references/step-mechanics.md', 'stack/skills/task-implement/SKILL.md', 'stack/skills/loop-test-coverage/SKILL.md'])
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
const LOOPS = ['loop-architecture-quality', 'loop-quality', 'loop-test-coverage'];
const BLOCKED_RETRY = "is the gate working, not a fault: put the choice through AskUserQuestion - 'Resume in a fresh session (Recommended)', ending this turn with the RESUME BLOCK / 'Continue here' - and on 'continue', re-issue the same Skill call: the answered offer lets it through until the context grows 1.5x past it";

// C5, D5, MATERIAL loop-architecture-quality:27 / loop-quality:33: guard-fresh-session-start re-arms on 1.5x growth
// (scripts/guard-hooks.test.js 'the size offer is answerable - the retry passes'), so a loop retries an answered block.
test('C5: a loop re-issues a capture call the fresh-session guard blocked, never reads the capture\'s SKILL.md instead', () => {
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /Never retry a blocked call/, `${name}: the line the hook contradicts is gone`);
        assert.doesNotMatch(text, /blocks EACH Skill call independently/, `${name}: the offer is per session, not per call`);
        assert.doesNotMatch(text, /protocol in-session by reading its `SKILL\.md`/, `${name}: no read into another skill's folder on a block`);
        assert.ok(text.includes(BLOCKED_RETRY), `${name}: the one registered retry sentence`);
    }
    const entry = shared()['loop-blocked-capture-retry'];
    assert.ok(entry, 'registered');
    assert.deepStrictEqual(copiesOf(entry).sort(), LOOPS.map((n) => `stack/skills/${n}/SKILL.md`).sort());
    assert.deepStrictEqual(registryFindings('loop-blocked-capture-retry'), []);
});

// C6, D6, MATERIAL loop-*:63/67/55: the close's commit ask is the flows' template - Hold recommended, a commit runs the checkpoint.
test('C6: every loop close recommends Hold and routes a picked commit through the commit checkpoint', () => {
    const ask = "AskUserQuestion - 'Hold - review the diff first (Recommended)' / 'Commit now', which runs `habits-commit-checkpoint` whole - never a prose 'your call' bullet";
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.doesNotMatch(text, /\(commit now \/ hold\)/, `${name}: the unmarked, commit-first ask is gone`);
        assert.ok(text.includes(ask), `${name}: the marked ask`);
    }
    for (const name of ['loop-architecture-quality', 'loop-quality']) {
        const mech = flat(read(`stack/skills/${name}/references/loop-mechanics.md`));
        assert.doesNotMatch(mech, /commit now \/ hold/, `${name}/loop-mechanics.md: the report rules name the same ask`);
        assert.match(mech, /'Hold - review the diff first \(Recommended\)' \/ 'Commit now'/);
    }
    assert.doesNotMatch(shared()['loop-close-commit-ask']._note, /commit now \/ hold/, 'the registry note describes the new shape');
    assert.deepStrictEqual(registryFindings('loop-close-commit-ask'), []);
});

// MATERIAL loop-*:19/40/49, :19/44/53, :17/30/33: the mode, plan-approval and structural asks each mark one option.
test('loops: the mode, plan-approval and structural asks each mark exactly one option first', () => {
    for (const name of LOOPS) {
        const text = flat(skill(name));
        assert.match(text, /ask ONE question before ANALYZE/, `${name}: the mode-ask-at-start marker stays`);
        assert.match(text, /one option marked `\(Recommended\)` and listed first, the one the `habits-execution-strategy` verdict picks/, `${name}: the mode ask's mark`);
        assert.doesNotMatch(text, /approve-and-build vs changes-needed/, `${name}: the unmarked approval ask is gone`);
        assert.match(text, /'Approve and build \(Recommended\)' \/ 'Changes needed'/, `${name}: the approval ask's mark`);
        assert.doesNotMatch(text, /apply \(routes as substantial\) vs decline vs defer/, `${name}: the unmarked structural ask is gone`);
        assert.match(text, /'Defer \(Recommended\)' \/ 'Apply - routes as substantial' \/ 'Decline'/, `${name}: the structural ask's mark`);
    }
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR loop-architecture-quality:51, loop-quality:55: an INLINE answer never dispatches a resolver seat.
test('loops: a red routes to a resolver seat only in DELEGATED mode', () => {
    for (const name of ['loop-architecture-quality', 'loop-quality']) {
        const text = flat(skill(name));
        assert.match(text, /a red routes, in DELEGATED mode, to the matching build- or test-failure resolver seat where the project installed one/, name);
        assert.match(text, /INLINE, or with no matching seat installed, fix the red in-session/, name);
        assert.match(text, /green across the round/, `${name}: the loop-green-across-round marker stays`);
    }
    assert.deepStrictEqual(registryFindings('loop-green-across-round'), []);
});

// MINOR loop-architecture-quality:9, loop-test-coverage:9: no see-also into a sibling loop.
test('loops: the opening paragraph carries no see-also into a sibling loop', () => {
    assert.doesNotMatch(flat(skill('loop-architecture-quality')), /the code-focused counterpart is `loop-quality`/);
    assert.doesNotMatch(flat(skill('loop-test-coverage')), /exactly like `loop-architecture-quality` for architecture/);
});

// MINOR loop-quality:23: each staged-mode companion is named with the step that reads it.
test('loop-quality: each staged companion is named with the step that reads it', () => {
    const text = flat(skill('loop-quality'));
    for (const piece of [/`references\/rules\.md` \(before the first stage's first pass\)/, /`references\/stage-close\.md` \(at each stage STOP or pause, and on resume\)/,
        /`references\/delegated-mode\.md` \(DELEGATED only, before the first dispatch\)/, /`references\/worked-example\.md` \(optional/, /`references\/bootstrap\.md` \(a missing or empty loops folder\)/])
        assert.match(text, piece);
    assert.doesNotMatch(text, /each Read at the step of `staged-mode\.md` that names it/);
});

// MINOR loop-test-coverage:28 (D3): no per-stack runner list in the generic loop; :66: the resume block is a template.
test('loop-test-coverage: the runner default is the house testing skill\'s, and the resume block is a fenced template', () => {
    const text = skill('loop-test-coverage');
    assert.doesNotMatch(flat(text), /plain JS\/TS: Vitest; \.NET: xUnit/);
    assert.match(flat(text), /propose the runner the stack's house testing skill records as its default \(absent one, the framework's own documented default, cited\)/);
    const block = (text.match(/```text\n\s*(RESUME - loop-test-coverage[\s\S]*?)```/) || [])[1] || '';
    assert.ok(block, 'a fenced RESUME BLOCK');
    for (const field of ['Invocation:', 'rounds consumed', 'Read first:', '## Resume', 'Remaining weak points, tier order']) assert.ok(block.includes(field), `the block carries ${field}`);
});

// ---- the single-chat twins, the greenfield build and the upgrade flow ----------------------------------------
// MATERIAL task-implement:60 (invocation map): a shared contract is a marked ask that names the manual-only flow to the USER.
test('task-implement: a surfaced shared contract is ONE marked ask naming /task-solve-cross as the user\'s command', () => {
    const text = flat(skill('task-implement'));
    assert.doesNotMatch(text, /stop - that is `task-solve-cross` territory/, 'the bare stop is gone');
    assert.match(text, /stop the task and put it through ONE AskUserQuestion - 'Hand it to the cross-domain flow \(Recommended\)' \(name `\/task-solve-cross` as the user's command; this build stops here\) \/ 'Keep it in this plan as a scoped change' \/ 'Stop the build'/);
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
    assert.match(text, /ask ONE question before building, via AskUserQuestion - this chat, or the implementer seats\? - one option marked `\(Recommended\)` and listed first, the one the `habits-execution-strategy` verdict picks/);
    assert.match(text, /ONE approval AskUserQuestion before task 1 - 'Approve - build task 1 \(Recommended\)' \/ 'Changes needed'/);
    assert.match(text, /after the FIFTH red run of one task's gate the next act is ONE AskUserQuestion - 'Keep fixing inline' \/ 'Hand it to a resolver seat' \/ 'Stop', one marked `\(Recommended\)` and listed first: 'Keep fixing inline' when the last red run changed, else the resolver seat \(or 'Stop' where the project installed none\) - never a sixth run/);
    assert.match(text, /ONE AskUserQuestion - 'Stop and report \(Recommended\)' \/ 'Continue inline' \/ 'Resolver seat' \/ 'Revert' - before any further run or edit/);
    assert.match(text, /'Leave it for later \(Recommended\)' \/ 'Add it to the plan'/);
    assert.match(text, /'Defer \(Recommended\)' \/ 'Fix now, ad hoc' \/ 'Open a new cycle'/);
    assert.match(text, /the reviewer through ONE AskUserQuestion unless a calling flow already chose it - 'task-verify-code in-session \(Recommended\)' \([^)]*\) \/ 'The `<stack>-verifier` seat'/);
    assert.doesNotMatch(text, /your choice of reviewer:/, 'no unasked reviewer pick');
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR task-implement:66: the ceilings procedure is a close-time reference; the rule stays in the body.
test('task-implement: Known ceilings keeps its rule in the body and its docs.js procedure in a reference', () => {
    const b = flat(skill('task-implement'));
    assert.match(b, /File every deliberate simplification this build made as a `where \| limit \| revisit when` row - never a code comment - before the close: Read `references\/known-ceilings\.md`/);
    assert.doesNotMatch(b, /docs\.js show architecture/, 'the procedure left the body');
    const ref = flat(read('stack/skills/task-implement/references/known-ceilings.md'));
    assert.match(ref, /docs\.js set architecture\/ARCHITECTURE\.md#known-ceilings --expect <that hash>/);
    assert.ok(copiesOf(shared()['known-ceilings-filing']).includes('stack/skills/task-implement/references/known-ceilings.md'));
    assert.deepStrictEqual(registryFindings('known-ceilings-filing'), []);
});

// MATERIAL task-build-from-scratch:23 + MINOR :29, :31: the pick, the mode and each slice's plan are marked asks.
test('task-build-from-scratch: the architecture pick, the mode ask and each slice\'s plan approval mark one option', () => {
    const text = flat(skill('task-build-from-scratch'));
    assert.match(text, /one option per architecture, its stack and one-line tradeoff as the description, exactly one marked `\(Recommended\)` and listed first with the reason that decides it/);
    assert.match(text, /ask ONE question before the first slice, via AskUserQuestion - build in the current session, or dispatch the stack seats\? - one option marked `\(Recommended\)` per the `habits-execution-strategy` verdict - then hold the answer/);
    assert.match(text, /Each slice's designer plan goes through ONE AskUserQuestion before its first implementer - 'Approve and build \(Recommended\)' \/ 'Changes needed' - and the stamp below quotes the answer\./);
    assert.deepStrictEqual(registryFindings('mode-ask-at-start'), []);
});

// MINOR task-design:12, :86, write-and-hand-off.md:18, evidence.md:14.
test('task-design: a marked mode ask, the mode left to the build step, a flow-aware hand-off and no stale evidence row', () => {
    const text = flat(skill('task-design'));
    assert.match(text, /ask ONE question before designing, via AskUserQuestion - this chat, or the designer seat\? - one option marked `\(Recommended\)` and listed first: this chat, unless the user asked for isolation - and hold the answer/);
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
    assert.match(text, /stop and put it through ONE AskUserQuestion - 'Re-plan from this stage \(Recommended\)' \/ 'Roll back to the last stage's rollback point' \/ 'Stop here' - never push through or skip a stage gate\./);
});
