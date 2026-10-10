'use strict';
// The usage audit of 2026-10-10 (48 sessions, collection since 2.2.0) - the flow and habit skills' half (apply seat
// T4). Each block names its cluster and the finding ids it holds (`<session8>#<n>`), so a later edit that brings the
// defect back goes red here. The enforcing halves (hooks, the analyzer) are pinned by their own tests.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const skill = (name) => flat(read(`stack/skills/${name}/SKILL.md`));
// Every `ask` block of a text, as { question, options: [label] }.
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => (l.match(/^- '(.*)' - /) || l.match(/^- '(.*)'\s*$/))[1]) };
});

// ---- C19: the plan gate holds scope ------------------------------------------------------------------------------
test('C19 fbfc2de4#1: an item outside Asked passes only on a user ask or a whole read of the cited reference', () => {
    const t = skill('task-verify-plan');
    assert.match(t, /An item outside `Asked:`/);
    assert.match(t, /read the cited reference WHOLE - the full function, list or component, never the cited range/);
    assert.match(t, /under AUTO it is dropped and listed in the stop's `Result:` line, never kept on the plan's own justification/);
});

test('C19 6ed392a5#1 c6142301#1: a cited spec row or card is scope - every clause and Verify bullet maps to a test', () => {
    const t = skill('task-verify-plan');
    assert.match(t, /A cited source is scope too/);
    assert.match(t, /every Verify or Done-when bullet of a cited card maps to a task and its `test:` clause; an unmapped clause is a MAJOR finding/);
    assert.match(skill('task-design'), /every clause of a cited row and every Verify or Done-when bullet of a cited card maps to a task's `test:`/);
    assert.match(skill('habits-clarify'), /hold the user's words against EVERY clause of it \(the defect it describes and the fix it names\)/);
    assert.match(skill('task-solve'), /each Verify or Done-when bullet of a card the ask cited, demonstrated by a run this session/);
});

test('C19 db6c1ae1#1: an unasked user-visible behaviour change is its own ask, recorded on the ledger line', () => {
    assert.match(skill('task-design'), /One call is never the design's: a change to a behaviour the user can see that the `Asked:` line does not name/);
    assert.match(skill('task-design'), /`asked: <the answer>`; under AUTO the behaviour stays as it was/);
    assert.match(skill('task-verify-plan'), /passes only with the user's answer on the entry \(`asked: <the answer>`\); without it, a MAJOR `judgment` finding/);
    assert.match(skill('habits-plan-writing'), /- asked: <the user's answer>/);
});

test('C19 6ed392a5#6 f6c591fa#2: a docs.js where listing is not a read, and the merged ask quotes the block', () => {
    assert.match(skill('task-verify-plan'), /A `docs\.js where` listing is a pointer, not a read/);
    assert.match(skill('task-design'), /A `docs\.js where` call only lists sections: read the ones it names/);
    const solve = read('stack/skills/task-solve/SKILL.md');
    assert.match(flat(solve), /the audit's eight-field block printed as stamped into the plan - never the bare verdict/);
    const merged = asks(solve).find((a) => /^Full spec/.test(a.question));
    assert.ok(merged, 'the merged-path ask exists');
    assert.match(merged.question, /<the Passes: line>/, 'the merged ask carries the Passes record, not only the verdict');
});

test('C19 a1fa1b2b#2 b35afe70#2 69dbed46#6: the plan stamp is the whole eight-field block, with one fixes-applied form', () => {
    const t = skill('task-verify-plan');
    assert.match(t, /the whole eight-field block above, under the header, never the `Gated:` line alone/);
    assert.doesNotMatch(t, /stamp the verdict into it - one line/);
    assert.match(t, /Gated: passed \| passed - <N> fixes applied \| <N> gaps listed - <date>/);
    assert.match(skill('habits-plan-writing'), /The plan review's eight-field block, its `Gated: <verdict>` line last/);
    assert.match(skill('task-solve'), /`passed - <N> fixes applied` for the non-judgment fixes it landed in this step, each named in the stop's `Result:` line/);
});

test('C19 0498718d#3 db6c1ae1#5: the gate inherits the design mode, and a clean pass folds its stop into the approval ask', () => {
    const t = skill('task-solve');
    assert.match(t, /run `task-verify-plan` over the plan file in the mode step 1 ran - no mode ask/);
    assert.match(t, /except on a pass with no open item, where step 3's approval ask is this stop too/);
});

test('C19 f24eb967#10 + C30 84eedb4b#2: the audit holds the named skills to the cards\' files and the final gate to the affected set', () => {
    const t = skill('task-verify-plan');
    assert.match(t, /Hold the skills the line names against the files the cards touch/);
    assert.match(t, /a hand-picked project list is a MAJOR finding/);
});

// ---- C20: the solve flow's close and cycle contract ----------------------------------------------------------------
const solveText = () => read('stack/skills/task-solve/SKILL.md');
const mech = () => flat(read('stack/skills/task-solve/references/step-mechanics.md'));

test('C20 a1fa1b2b#5 e6a68237#7 f24eb967#8: a sibling hand-off is printed as one paste-ready block beside the card', () => {
    assert.match(mech(), /prints it beside the card as ONE fenced markdown block ready to paste into the sibling's session - first line `Open in: <the sibling's root>`/);
    assert.match(flat(read('stack/skills/capture-related-projects/references/sibling-handoff.md')), /ONE fenced markdown block, ready to paste there, its first line `Open in: <the sibling's root>`/);
    assert.match(skill('task-solve'), /printed as a paste-ready block, by the step mechanics' hand-off rules/);
});

test('C20 69dbed46#4: the generated related-context rule says where a card addressed to this repo sits', () => {
    assert.match(flat(read('stack/skills/capture-related-projects/references/artifact-shapes.md')), /A task card addressed to THIS repo is written in the SIBLING's tree, under its own docs root's `cross-project-tasks\/<this repo>\.md` - search there before calling a named card absent/);
});

test('C20 close receipts (390aebcb#8 3ce6b036#2 49cb4b82#6 a1fa1b2b#3 f24eb967#9 e499fc94#5 a6a24815#4 3b53e0e8#3): they ride the Result field', () => {
    const t = skill('task-solve');
    assert.match(t, /The close stop's `Result:` line carries the receipts - `Completed <date>, memories purged: <names\|none>`/);
    assert.doesNotMatch(t, /print one line with it - `Completed - the next scope starts a NEW plan file, not this one`/);
    assert.match(t, /it rides the first stop's `Result:`, `Spec:` beside it/);
    assert.match(t, /this stop's `Result:` line carries `mechanics: read` as the receipt/);
});

test('C20 a6a24815#2: the step-4 stop opens on the gate\'s own verdict line, never a fixed "The build is green"', () => {
    const review = asks(solveText()).find((a) => a.options.some((o) => /^task-verify-code in-session/.test(o)));
    assert.ok(review, 'the reviewer ask exists');
    assert.match(review.question, /^<The gate's verdict line, quoted>\./);
    assert.doesNotMatch(solveText(), /The build is green\. Review it/);
    assert.match(skill('task-solve'), /a red the run root-caused outside the diff is quoted red, its cause named, never called green/);
});

test('C20 a6a24815#3 + C09 e6a68237#5: the close puts the diff and the next scope in two questions, the next one recommending a fresh session', () => {
    const all = asks(solveText());
    const diff = all.find((a) => a.options.includes('Hold - review the diff first (Recommended)'));
    assert.deepStrictEqual(diff.options, ['Hold - review the diff first (Recommended)', 'Commit now'], 'no third fork beside the diff');
    const next = all.find((a) => /^Next: /.test(a.question));
    assert.ok(next, 'the next-scope question is its own template');
    assert.match(next.question, /It opens a NEW cycle in a NEW plan file\./);
    assert.strictEqual(next.options[0], 'Start it in a fresh session (Recommended)');
    assert.match(skill('task-solve'), /A deferred item or follow-up is a SECOND question in the same AskUserQuestion call/);
});

test('C20 adaa2ef3#8 bda299a8#8 ab61627f#6 4f1c2ebb#4: the resume block is printed above the ask, names where it runs, and a paste into a full chat is sent back', () => {
    const t = skill('task-solve');
    assert.match(t, /the paste-ready resume block - first line `Open in: <the project root>`, then `\/clear, then paste:` and the `\/task-solve` line naming the plan file - is printed ABOVE the ask, so taking it needs no reply turn/);
    assert.match(t, /A resume paste that lands in a chat still holding the earlier cycle's conversation \(no `\/clear` between\) is answered with one line - `\/clear first, then paste it again`/);
});

test('C20 68da4b6b#4 c5000cb1#5 a1fa1b2b#3: the plan\'s Resume line is the one cursor, no cycle note to keep fresh', () => {
    const t = skill('task-solve');
    assert.match(t, /its `Resume:` line is the one cursor \(current step, chosen modes, next task\), rewritten at EVERY stop and task tick/);
    assert.doesNotMatch(t, /`write_memory` named `<feature>\/cycle`/);
    assert.match(skill('habits-plan-writing'), /Inside the solve flow it is the one cursor and leads with the step and the modes/);
});

test('C20 8f44a003#6: the small row names its reviewer and its done gate', () => {
    assert.match(solveText(), /\| small \| [^\n]*\| plan inline -> build -> `task-verify-code` inline, no ask -> `habits-done-gate` -> close\. One stop, the close \|/);
});

test('C20 84eedb4b#5 9a4ef375#4 fbfc2de4#6: new scope after Completed is a new plan file or an ungated: line, never appended', () => {
    assert.match(skill('task-solve'), /New scope arriving in-chat after `Completed:` is a NEW cycle in a NEW plan file \(a stamped file is a record, never appended to\) - re-enter step 1, or state in one `ungated: <why>` line/);
});

test('C20 ca65b406#5: a reply for another session is drafted after the commit / publish answer', () => {
    assert.match(mech(), /A reply drafted for another session waits for the commit \/ publish answer, so every id it quotes is final/);
});

// ---- C09: the stops the build and AUTO owe ---------------------------------------------------------------------------
test('C09 05c925e9#1: a mid-build compaction is a build-time stop with its own ask', () => {
    const compacted = asks(solveText()).find((a) => /^Context compacted during task <N>/.test(a.question));
    assert.ok(compacted, 'the compaction stop is a template');
    assert.strictEqual(compacted.options[0], 'Resume in a fresh session (Recommended)');
    assert.match(skill('task-solve'), /The harness compacting the context mid-build is a stop too \(under AUTO, one line, then continue\)/);
});

test('C09 f450ea64#3 f450ea64#5: AUTO starts after one fresh-session ask, and its close lists the deviations', () => {
    const t = skill('task-solve');
    assert.match(t, /A session past the trigger, or one that already closed a cycle, first puts ONE ask - the fresh-session resume recommended - and AUTO starts after its answer/);
    assert.match(t, /`Deviations: <each Decisions entry that departs from the Asked: words, one apiece \| none>`/);
});

// ---- C26 / C21 / C17 / C30 / C03 halves that live in the solve flow ------------------------------------------------
test('C26 516e653d#6: a multi-select question marks one option or asks each item alone', () => {
    assert.match(skill('task-solve'), /A multi-select question marks one option too - or asks each judgment item as its own yes\/no question; every option marked reads as a blanket approval/);
});

test('C21 f450ea64#8 e499fc94#3 + C03 e499fc94#4: agents-mode seats dispatch with no isolation, no model override, and the card\'s docs anchors', () => {
    const m = mech();
    assert.match(m, /\*\*No isolation\.\*\* Dispatch into the shared tree, never a separate worktree/);
    assert.match(m, /\*\*No `model:` override\.\*\* The seat's frontmatter pin is its model/);
    assert.match(m, /sets the ORDER of the dispatches, never the seat type or its model/);
    assert.match(m, /\*\*The card's docs anchors ride the brief\*\*/);
    assert.match(skill('task-solve'), /the approval stamp first, the contract version and the card's docs anchors in every brief, no isolation, no `model:` override/);
});

test('C21 7491ab75#2 0498718d#16: task-design offers a read fan-out at its mode ask and names its seats\' model', () => {
    const t = skill('task-design');
    assert.match(t, /'Research fan-out: <N> read-only seats, design here'/);
    assert.match(t, /on the model the dispatch names \(Sonnet for search and classification - a seat type with no pin runs on the session's model\)/);
    assert.match(t, /nothing is dispatched that the answer did not pick/);
});

test('C17 f450ea64#1 + C30 f6c591fa#5: the conformance stamp names the pass that cleared the fix delta, and the stop carries the review fields', () => {
    assert.match(skill('task-solve'), /Stamp `Conformance: <verdict> - <reviewer>, <the pass that cleared the last fix delta>`; the stop's `Result:` carries the review's named fields as it emitted them/);
});

// ---- C18 (BLOCKER): the checkpoint checks the format of what the commit takes in, and publish reads CI ------------
const checkpoint = () => read('stack/skills/habits-commit-checkpoint/SKILL.md');

test('C18 e6a68237#1 (skill half): the format CHECK runs over every staged path and its verdict is the receipt\'s format: line', () => {
    const t = flat(checkpoint());
    assert.match(t, /The formatter half is never skipped, and it must be FRESH/, 'the skill-comply quote stays');
    assert.match(t, /run the project's own format CHECK - the command CI runs \(a `format:check` script, the workflow's format step\), else the formatter's check mode - over EVERY staged path, inherited files included/);
    // The pinned cross-track contract: T3's guard refuses a COMMIT receipt with no format: line or one without `clean`.
    const block = (checkpoint().match(/```\nVERIFIED <what was reviewed, one phrase>\n([\s\S]*?)```/) || [])[1] || '';
    assert.match(block, /^format: <the format CHECK command run> - clean over <N> staged files$/m);
    assert.match(t, /`format: none configured - clean over <N> staged files, nothing to check`/);
    assert.match(t, /The checkpoint ends by writing its receipt: `<docs-path>\/flow\/COMMIT-GATE`, five lines/, 'the skill-comply quote stays');
    assert.match(flat(read('stack/skills/task-verify-code/references/commit-gate-receipt.md')), /`format: <the format CHECK command run> - clean over <N> staged files`/);
});

test('C18 bba03dad#1 e6a68237#2: publish arms one background CI watch on the pushed sha and the close carries its verdict', () => {
    const t = flat(checkpoint());
    assert.match(t, /\*\*Watch CI once\.\*\*/);
    assert.match(t, /`gh run watch <id> --exit-status` as a background task, never a foreground sleep loop/);
    assert.match(t, /`CI: pending - watching run <id>` when the turn ends first/);
    assert.match(t, /A red the receipt's `live-probe:` records on a check CI also runs is named in the question/);
});

test('C18 349e4825#4: typed words for THIS publish skip the publish ask', () => {
    assert.match(flat(checkpoint()), /Words the user already typed for THIS publish skip the ask - they are the `authorized:` line/);
});

test('C18 229e2715#6 390aebcb#7: the security half stays inline in an explicit-only flow, and covers the spec: set by count', () => {
    const t = flat(checkpoint());
    assert.match(t, /Inside a flow whose dispatch is explicit-only \(the solve flows\) it runs inline unless the stop that led here offered the seat and the user picked it/);
    assert.match(t, /The review's file list is the set `spec:` counts - hold the two against each other before the verdict - and the `security:` line ends `- over <N> files`, that count/);
});

test('C18 batch receipts (the pinned T3 contract): one receipt covers a reviewed batch while every later commit stays inside its review', () => {
    assert.match(flat(checkpoint()), /One receipt covers a reviewed batch: a later commit passes on it while its `head:` is an ancestor of HEAD and every commit since touches only files its review covered/);
});

test('C18 / C30: the measured stories sit in the evidence appendix, not the run-time body', () => {
    const e = flat(read('stack/skills/habits-commit-checkpoint/references/evidence.md'));
    for (const s of [/29\.5 h/, /answered in 6 s/, /\$1\.14/, /covered 4 files/, /five runs/]) assert.match(e, s);
});

// ---- C30 (receipt half) + C08: review fields reach the receipt, and the gates run the format check -----------------
test('C30 349e4825#5 a3d497f8#8: the commit receipt carries the review\'s Findings field', () => {
    const block = (checkpoint().match(/```\nVERIFIED <what was reviewed, one phrase>\n([\s\S]*?)```/) || [])[1] || '';
    assert.match(block, /^findings: <the review's Findings field, copied - a count by severity, or none>$/m);
    assert.match(flat(read('stack/skills/task-verify-code/references/commit-gate-receipt.md')), /`findings: <this review's Findings field, copied>`/);
});

// ---- C21 (strategy half) / C30 (build half) / C27 / C22 / C02 / C24 / C16 / C20 size floor ------------------------
test('C21 bba03dad#10 0498718d#16 f450ea64#8 349e4825#6: a pinless seat type gets a named model, worktrees need committed contracts', () => {
    const t = skill('habits-execution-strategy');
    assert.match(t, /\*\*A seat type with no pin\*\* \(a general-purpose or explore subagent\) runs on the session's model unless the dispatch names one/);
    assert.match(t, /Name its model in the verdict: the lighter one for read-only search, inventory and classification/);
    assert.match(t, /only when every contract they build on is COMMITTED: a worktree branches from HEAD/);
    assert.match(t, /This skill loaded and no `Execution:` line after it/);
});

test('C30 84eedb4b#2 adaa2ef3#6 758ce661#5: the build gates run the Build set and the affected suite, and the task gate carries its rule', () => {
    const t = skill('task-implement');
    assert.match(t, /the plan header's `Build:` command set where it has one, scoped to the touched projects and never a subset of it/);
    assert.match(t, /run the full suite once - the workspace's affected set \(`nx affected -t test lint build` in an Nx workspace\), else every touched project plus the projects that depend on it, never a hand-picked list - quoting the command in the report and in any verifier brief/);
    assert.doesNotMatch(t, /loaded before the first task closes/);
    assert.match(t, /the per-task completion gate is `habits-done-gate`'s rule, carried here so no load stands between it and the tick/);
    assert.match(read('stack/skills/habits-plan-writing/SKILL.md'), /^Build: <the gate commands as the project runs them/m);
});

test('C27 516e653d#5: the usage report quotes the measured cold floor, never a fixed ~20k', () => {
    const t = skill('capture-usage-report');
    assert.doesNotMatch(t, /produces from ~20k\./);
    assert.match(t, /quote the floor the stop hook measured for this install, or say it is unmeasured, never a fixed figure/);
});

test('C22 3b53e0e8#6 4f1c2ebb#6 758ce661#6 (skill half): a spec touch loads angular-testing in the same action', () => {
    assert.match(skill('angular-conventions'), /\*\*Writing, changing or reviewing a `\*\.spec\.ts` file: call the Skill tool for `angular-testing` in the same action, or state it is already loaded this session\*\*/);
});

test('C02 adaa2ef3#5: the nx skill fires on running targets and says how to filter their output', () => {
    const d = (read('stack/skills/nx/SKILL.md').match(/^description:\s*"(.*)"\s*$/m) || [])[1];
    assert.match(d, /running nx test\/lint\/build/);
    assert.ok(d.length <= 160, `${d.length} chars`);
    assert.match(skill('nx'), /strip the codes first \(`sed 's\/\\x1b\\\[\[0-9;\]\*m\/\/g'`\) and grep with `-a`/);
});

test('C24 65abb00a#4 65abb00a#5 f10cb06a#3 f10cb06a#4 + C16 65abb00a#2: the AGENTS.md improve ask is a marked template, verified fixes join it', () => {
    const text = read('stack/skills/habits-adjust-agents-md/SKILL.md');
    const t = flat(text);
    const ask = asks(text)[0];
    assert.ok(ask, 'step 5.4 is an ask template');
    assert.strictEqual(ask.options[0], 'Apply the additions and verified fixes (Recommended)');
    assert.match(t, /\*\*a verified fix\*\* - a stale path whose new target this run confirmed on disk/);
    // 65abb00a#1: the check now prints the Rules drift itself (scripts/agents-md-check.js `rule` rows, both directions).
    assert.match(t, /a named rule with no file and a rule file the list does not name are both `rule` rows/);
    // f10cb06a#2: a row the user keeps for good is silenced by the check's own marker, written on their word.
    assert.match(t, /end it with `<!-- agents-md-check: keep -->` - the check then raises no row on it/);
    assert.match(t, /Every `\.env\*` file, `\.env\.example` included, sits behind the install's secret-file read deny/);
    assert.doesNotMatch(t, /env var NAMES a test reads \(`\.env\.example`/);
    assert.match(t, /Before the write, `git ls-files <file>`: an untracked target \(git-ignored, or never added\) has no diff to review and no history to restore/);
    const { ASK_FLOW_TEMPLATES } = require('./lint-skills.js');
    assert.strictEqual(ASK_FLOW_TEMPLATES['habits-adjust-agents-md'], 1, 'pinned, so the ask cannot drop back to prose');
});

test('C16 7fae0c39#5 (skill half): a red over a run that never compiled is a sign the cycle was skipped', () => {
    assert.match(skill('habits-test-first'), /A 'red' claimed over a run that never compiled or ran - 'Test suite failed to run', a compiler error, zero tests executed/);
});

test('C20 458953b8#4: the Size line never goes below the full-spec check\'s size floor', () => {
    assert.match(skill('task-solve'), /never below the `size floor:` the full-spec check prints \(run it first, on every size\)/);
    assert.match(flat(read('stack/skills/task-solve/references/full-spec.md')), /its `size floor:` line is the lowest size the `Size:` line may state/);
});

test('C08 a6a24815#5: the done gate and the in-chat review run the project\'s format check', () => {
    assert.match(skill('habits-done-gate'), /plus the project's format check where it has one \(a `format:check` script, the CI workflow's format step\)/);
    assert.match(skill('habits-done-gate'), /build \+ relevant tests run after the last edit, output quoted/, 'the skill-comply quote stays');
    assert.match(skill('task-verify-code'), /Rerun `build`, the suite and the project's format check \(where it has one - the step CI runs\)/);
});
