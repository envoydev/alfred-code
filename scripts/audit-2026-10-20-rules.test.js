'use strict';
// Stack audit 2026-10-20, the rules track (rows numbered as the rules audit numbers them). One file for the track's
// prose pins, so the parallel apply branches never collide in a shared test file; the analyzer's budget count is
// pinned in analyze-usage.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectedRuleText } = require('./always-on-surface.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const injected = (name) => flat(injectedRuleText(read(`stack/rules/${name}.md`)));

// Row 1: 'is done, not handed to the user' read as an order to commit, tear down or hit a production target without
// the ask alfred-git, alfred-quality-gates:41 and :42 require. The step is never an instruction to the user; a gated
// one is offered.
test('row 1: a step the tools can do is never handed over as an instruction - done, or offered where a rule gates it', () =>
{
    const rule = injected('alfred-interaction');
    assert.ok(!rule.includes('is done, not handed to the user'), 'the unconditional form is gone');
    assert.match(rule, /is never handed to the user as an instruction - check the tools you hold before you ask, then do it, or offer it where a rule gates it \(a commit, a teardown, a production target\)/);
    // the gates it defers to still say what it defers to
    assert.match(injected('alfred-git'), /Do NOT commit or push until the user explicitly says to/);
    assert.match(injected('alfred-quality-gates'), /Tear down only AFTER the answer/);
    assert.match(injected('alfred-quality-gates'), /a production match waits for the user's ask/);
});

// Row 2 + ruling S9: the budget exemption covers a baseline rule's mandated close line (security's carve-out, the
// teardown list), and 'step by step' lifts the budget like the other depth words.
test('row 2 + S9: the budget spares a baseline close line, and step by step lifts it', () =>
{
    const rule = injected('alfred-interaction');
    assert.match(rule, /never trim a field a skill's report contract or a baseline rule's close line requires, or a self-correction disclosure\./);
    assert.match(rule, /Only the user's own message lifts it \('in detail', 'walk me through', 'step by step', 'write a plan', the same ask in any language\); 'explain' does not\./);
});

// Row 3: three pros and three cons per candidate in prose blew the budget; a table is exempt.
test('row 3: candidates compare in a table', () =>
{
    const rule = injected('alfred-interaction');
    assert.match(rule, /Choosing between candidates: a table of at most 3 pros and 3 cons each, then recommend one with the reason\./);
});

// Row 5: two first actions for ambiguity - the habits-clarify pointer owns it.
test('row 5: ambiguity has one first action', () =>
{
    const rule = injected('alfred-interaction');
    assert.ok(!rule.includes('one clarifying question first'), 'the second first action is gone');
    assert.match(rule, /Ambiguous \*goal\* - the FIRST action is the `habits-clarify` Skill call/);
});

// Rows 6 + 7 + 15: one home per memory line, no pointer that says nothing, and the shell section's place recorded in
// a comment the injection strips.
test('rows 6, 7, 15: the handoff line has one home, the no-op pointer and the docs-root coupling are gone', () =>
{
    const nav = injected('alfred-navigation');
    const mem = injected('alfred-memory');
    assert.ok(!/memory tools are off/.test(nav), 'navigation no longer repeats the memory rule');
    assert.ok(mem.includes("A seat's handoff note - what one agent leaves the next within a run - lives here too, never in the navigation server (its memory tools are off)"), 'memory owns it');
    assert.ok(!nav.includes("The traps of this host's own shell"), 'the no-op pointer');
    assert.ok(!mem.includes('alfred-docs-root.md'), 'memory names no other rule file for the root');
    assert.match(mem, /^# Shared memory Project truth lives in the docs domains; memory holds what they do not/);
    const raw = read('stack/rules/alfred-navigation.md');
    assert.match(raw, /## Shell commands\n\n<!-- Kept in this file, not split into a rule of its own:[^\n]*-->\n/);
    assert.ok(!nav.includes('Kept in this file'), 'the comment is stripped before injection');
    assert.match(nav, /## Shell commands - A splice/);
});

// Row 14: where the docs live is the docs-root baseline's; the navigation rule names no docs location.
test('row 14: the template and capture-architecture point at the docs-root baseline for the docs location', () =>
{
    const nav = injected('alfred-navigation');
    assert.ok(!/__DOCS_ROOT__|ALFRED_CODE_DOCS_PATH/.test(nav), 'the navigation rule names no docs root');
    assert.match(injected('alfred-docs-root'), /This install's root: `__DOCS_ROOT__`/);
    const row = read('stack/AGENTS.template.md').split('\n').find((l) => l.startsWith('| `.claude/rules/alfred-architecture.md`'));
    assert.ok(row && row.includes("where they live is the docs-root baseline's"), row);
    const skill = flat(read('stack/skills/capture-architecture/SKILL.md'));
    assert.ok(skill.includes("where the docs live and how to read them by section are the docs-root baseline's"));
    assert.ok(!/navigation baseline's/.test(row + skill), 'no stale pointer left in either');
});

// The audit skill's own principles carry lint 33's real cap.
test('the rules audit skill states lint 33 at its 80,000-char cap', () =>
{
    const p = read('.claude/skills/repo-audit-rules/references/principles.md');
    assert.ok(p.includes('at 80,000 chars'), 'the current cap');
    assert.ok(!p.includes('70,000'), 'the old cap');
    assert.match(read('scripts/lint-skills.js'), /const ALWAYS_ON_MAX = 80000;/, 'the lint holds the same cap');
});

// Row 4 (registry half): the rule owns the budget; the hook and the analyzer restate its number.
test('row 4: the answer-budget entry names the rule as owner and the analyzer as a site', () =>
{
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['answer-budget'];
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-interaction.md');
    assert.deepStrictEqual(entry.sites.map((s) => s.file).sort(), ['scripts/analyze-usage.js', 'stack/hooks/guard-answer.js']);
    assert.match(entry._note, /The rule is canonical/);
});
