'use strict';
// Rules audit 2026-10-20b (the 2.8.0 delta): where the generated preferences rule met an older always-on clause. One file
// for the track's prose pins, so the parallel apply branches never collide in a shared test file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectedRuleText } = require('./always-on-surface.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const injected = (name) => flat(injectedRuleText(read(`stack/rules/${name}.md`)));

// R1: the git rule keeps its consent and safety lines from GIT-PREFERENCES.md, while the preferences rule claimed to
// outrank 'the house convention and git rules' with a never-list naming neither - a 'force-push freely' preference won
// in one rule and lost in the other. Since 2026-10-21 the git rule is retired: its lines are the seeded doc's `locked`
// entries, and the shipped preferences rule, the capture and its doc shape all say no entry weakens one.
test('R1: the preferences rule and the git seed agree on what a git preference cannot override', () =>
{
    assert.ok(injected('alfred-preferences').includes("They never override security, input validation, error handling or accessibility, never open a hook's gate, and no entry weakens a `locked` one."), 'the rule');
    const shape = flat(read('stack/skills/capture-preferences/references/doc-shape.md'));
    assert.ok(shape.includes("A preference never overrides security, input validation, error handling or accessibility, never opens a hook's gate, and no entry weakens a `locked` one."), 'the doc shape');
    const seed = read('stack/skills/capture-preferences/references/git-seed.md');
    for (const key of ['consent', 'checkpoint', 'safety', 'attribution', 'checks']) assert.ok(seed.includes(`<!-- locked: ${key} -->`), key);
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['git-preferences-carve-out'];
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-preferences.md');
    // the capture's own conflict check restates it beside the doc shape (final review 2026-10-20b S1)
    assert.deepStrictEqual(entry.sites.map((s) => s.file).sort(), ['stack/skills/capture-preferences/SKILL.md', 'stack/skills/capture-preferences/references/doc-shape.md']);
});

// R2: 'Inherited code: its conventions win over these rules' read, beside the preferences rule, as the code's conventions
// beating the user's preferences - the opposite of the preferences rule's own ranking. The interaction line now names
// the house rules, and the preferences rule ranks the user's own docs above the project's code-style doc.
test('R2: inherited conventions beat the house rules, the user\'s preferences beat the code\'s own style', () =>
{
    // audit 2026-10-30 RU-11: the tail 'an entry of the user's preferences docs wins over both' restated the preferences
    // rule's own ranking (below), so the line ends at the house rules.
    assert.match(injected('alfred-interaction'), /Inherited code: its conventions win over these house rules unless broken or unsafe\./);
    assert.doesNotMatch(injected('alfred-interaction'), /preferences docs wins over both/);
    // 2026-10-21: 'personal' names PERSONAL-PREFERENCES.md now, so the ranking says 'personal code'.
    assert.ok(injected('alfred-preferences').includes('in this order: the personal code and architecture docs, the project doc,'), 'the preferences rule ranks the user over the code');
});

// R3: the memory rule said memory holds 'preferences' while 2.8.0 gave code, architecture and git preferences a docs
// domain, and memory's start block never reaches a dispatched seat (memory-session.js: SubagentStart gets the tag and
// tool lines only). Such a preference is stored and handed to the user as the slash-only capture that binds every seat.
test('R3: a code, architecture or git preference is stored and routed to /capture-preferences', () =>
{
    // 2026-10-24: the memory rule retired with the memory server; the nudge moved into the preferences rule.
    const prefs = injected('alfred-preferences');
    assert.ok(prefs.includes('A personal, code, architecture or git preference the user states in chat is named back to them as `/capture-preferences <their words>` to run - only the preferences docs reach every session'), prefs);
    const skill = read('stack/skills/capture-preferences/SKILL.md');
    assert.match(skill, /^disable-model-invocation: true$/m, 'slash-only, so the rule hands it to the user');
    assert.ok(JSON.parse(read('meta/recommendations.json')).always.skills.includes('capture-preferences'), 'every install carries it, so the always-on rule may name it');
});

// R4: the markdown carve-out lists the generated rules by name, and 2.8.0 added alfred-preferences.md (written by the
// capture's script) without adding it there or in the skill's restatement. Since 2026-10-21 the preferences rule ships
// fixed and project-code-style.md is gone; since the 2026-10-29 merge alfred-architecture.md is retired into the map line
// of alfred-awareness.md, so the list is the one rule a capture still writes - the installer still treats the old one as generated.
test('R4: the markdown carve-out names every generated rule and no shipped one', () =>
{
    const names = '(`alfred-awareness.md`)';
    assert.ok(injected('markdown-docs').includes(names), 'the rule');
    assert.ok(flat(read('stack/skills/markdown-style/SKILL.md')).includes(names), 'the skill restatement');
    assert.ok(!/alfred-architecture/.test(injected('markdown-docs')), 'the retired marker is no generated rule a capture writes');
    const { RULE_EXCLUDE } = require('./install/selection.js');
    assert.ok(RULE_EXCLUDE.test('alfred-architecture') && RULE_EXCLUDE.test('alfred-awareness'), 'the installer treats them as generated');
    assert.ok(!RULE_EXCLUDE.test('alfred-preferences'), 'the preferences rule is shipped');
});

// R5: the docs-root rule put the sibling repos in awareness/ in one bullet and 'a doc about it' in
// work/cross-project-tasks/ in the next; the placement registry's own note says every OTHER sibling doc goes there.
test('R5: the sibling orientation doc stays in awareness/, any other sibling doc goes to work/cross-project-tasks/', () =>
{
    const rule = injected('alfred-docs-root');
    // the 2026-10-29 merge widened the awareness entry (the project's facts, its resources, the map); the sibling repos stay in it
    assert.match(rule, /the awareness docs \(`awareness\/` - the install's inventory, [^)]*the run book, [^)]*the sibling repos[^)]*\)/);
    assert.ok(rule.includes('by default any other doc about it, and a change it must make (a task card), lives in `work/cross-project-tasks/`'));
});
