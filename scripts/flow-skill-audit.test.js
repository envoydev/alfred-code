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
