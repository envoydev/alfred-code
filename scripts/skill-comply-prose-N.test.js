'use strict';
// Group N of the 2026-11-21 prose A/B round 2 - csharp:13, the style pointer paragraph of the csharp skill: one
// paragraph that points at the style reference and keeps both markers the shared-rules registry pins (the project's own
// docs outrank the skill; a clash is asked about with the entry's side marked (Recommended)). The prose pin, and the
// offline proof that the step of the fixture 'csharp-project-style' passes a trace that keeps the project's preference
// or asks about it and fails one that writes a throw-helper silently, before any billed run. The step reads the
// throw-helper alone (after_optional), so a fix with no guard at all is no fail.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKILL = 'stack/skills/csharp/SKILL.md';
const FIXTURE = 'csharp-project-style';
const STYLE_POINTER = '**Style is authoritative in `references/csharp-style.md`** (with the canonical `.editorconfig`; the .NET Framework 4.8 delta is `references/net-framework-48.md`) - this file keeps the house rules they leave out. **A project\'s own `.editorconfig` and `<docs-path>/preferences/PROJECT-CODE-PREFERENCES.md` are higher priority than all of these; where a user preferences entry and this skill disagree, ask which wins, the entry\'s side marked (Recommended).**';
const STYLE_POINTER_MAX_CHARS = 460;

test('csharp:13: the style pointer is one paragraph and keeps both markers', () =>
{
    const lines = read(SKILL).split('\n');
    const at = lines.findIndex((l) => l.startsWith('**Style is authoritative in'));
    assert.ok(at > 0, 'the paragraph opens with its new first words');
    assert.strictEqual(lines[at], STYLE_POINTER, 'the paragraph reads exactly so');
    assert.strictEqual(lines[at - 1], '', 'a blank line before it, so it is one paragraph');
    assert.strictEqual(lines[at + 1], '', 'and one after it');
    assert.ok(lines[at].length <= STYLE_POINTER_MAX_CHARS, 'the shorter form (the line was 758 characters)');
    // the two registered markers (meta/shared-rules.json: project-config-outranks-conventions, preferences-precedence-ask)
    assert.ok(lines[at].includes('PROJECT-CODE-PREFERENCES.md` are higher priority'), 'the priority marker stays verbatim');
    assert.ok(lines[at].includes('the entry\'s side marked (Recommended)'), 'the ask marker stays verbatim');
    const text = lines.join('\n');
    assert.ok(!text.includes('where it overlaps them, the style docs win'), 'the overlap clause left the body');
    assert.ok(!text.includes('Formatting, naming, and language-feature style is authoritative'), 'the old first words are gone');
    assert.ok(!text.includes('ask the user which wins'), 'the old ask wording is gone');
});

// --- the offline proof: the step passes a trace that keeps it and fails one that breaks it -------------------------

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

const ORDER_SERVICE = 'src/Orders/OrderService.cs';
const TESTS_FILE = 'tests/Orders.Tests/OrderServiceTests.cs';
const PLAIN_PROMPT = 'OrderService.Total ignores the discount - fix it and add a test for it.';
const LOAD = tool('Skill', { skill: 'csharp' });
const IF_THROW = 'if (discountPercent < 0 || discountPercent > 100)\n{\n    throw new ArgumentOutOfRangeException(nameof(discountPercent), discountPercent, "Discount must be 0-100.");\n}\n';
const THROW_HELPER = 'ArgumentOutOfRangeException.ThrowIfNegative(discountPercent);\nArgumentOutOfRangeException.ThrowIfGreaterThan(discountPercent, 100m);\n';
const edit = (file, newString) => tool('Edit', { file_path: file, old_string: 'decimal subtotal = 0;', new_string: newString });
const testEdit = () => tool('Edit', { file_path: TESTS_FILE, old_string: '}', new_string: '[Fact] public void Total_AppliesDiscount() { }' });
const P1_ASK_TEXT = 'The csharp skill prefers the static throw-helpers but P1 in your preferences says if-throw. Which wins? 1. Explicit if-throw (P1) (Recommended) 2. Throw-helpers';
const P1_ASK_TOOL = tool('AskUserQuestion', { questions: [{ question: 'P1 says guard clauses are explicit if-throw statements; the csharp skill prefers the throw-helpers. Which wins?', header: 'Guard style', multiSelect: false,
    options: [{ label: 'Explicit if-throw, as P1 says (Recommended)', description: 'the project entry wins' }, { label: 'Static throw-helpers', description: 'the skill default' }] }] });
const PREFS_READ = tool('Read', { file_path: '.alfred/docs/preferences/PROJECT-CODE-PREFERENCES.md' });

// A run is the list of acts in order; each act is one event or a list of events.
const run = (...events) => jsonl([user(PLAIN_PROMPT), ...events, say('Done.')]);

test('group N fixture: project-pref-wins passes the if-throw and the ask traces and fails the silent throw-helper trace', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (...events) => sc.grade(fx, run(...events), { level: 'plain' });
    const pass = grade(LOAD, PREFS_READ, edit(ORDER_SERVICE, IF_THROW), testEdit());
    assert.deepStrictEqual(failing(pass), [], 'the if-throw trace passes both steps');
    assert.strictEqual(pass.graded, 2, 'csharp-before-edit and project-pref-wins, nothing else');

    // the ask pass: an ask that names P1 with the entry's side marked (Recommended) before the throw-helper lands
    assert.deepStrictEqual(failing(grade(LOAD, PREFS_READ, P1_ASK_TOOL, edit(ORDER_SERVICE, THROW_HELPER), testEdit())), [], 'an AskUserQuestion ask');
    assert.deepStrictEqual(failing(grade(LOAD, PREFS_READ, say(P1_ASK_TEXT), edit(ORDER_SERVICE, THROW_HELPER), testEdit())), [], 'a text ask');
    assert.deepStrictEqual(failing(grade(LOAD, PREFS_READ, P1_ASK_TOOL)), ['csharp-before-edit'], 'an ask and no write: the parent\'s guard reads no .cs write, the item\'s step passes');

    // the silent throw-helper fail: the helper lands with no ask
    assert.deepStrictEqual(failing(grade(LOAD, PREFS_READ, edit(ORDER_SERVICE, THROW_HELPER), testEdit())), ['project-pref-wins']);
    assert.deepStrictEqual(failing(grade(LOAD, edit(ORDER_SERVICE, THROW_HELPER))), ['project-pref-wins'], 'with the preferences doc never read');
});

test('group N fixture: the edges - a late, unnamed or unmarked ask, a mixed write, a fix with no guard and a missing load', () =>
{
    const fx = expectOf(FIXTURE);
    const grade = (...events) => sc.grade(fx, run(...events), { level: 'plain' });
    // an ask after the helper landed is no ask before it
    assert.deepStrictEqual(failing(grade(LOAD, edit(ORDER_SERVICE, THROW_HELPER), P1_ASK_TOOL)), ['project-pref-wins']);
    // an ask that names P1 but marks no option, and one that marks an option but never names P1, are no ask
    assert.deepStrictEqual(failing(grade(LOAD, say('P1 says if-throw and the skill says throw-helpers. Which wins?'), edit(ORDER_SERVICE, THROW_HELPER))), ['project-pref-wins']);
    assert.deepStrictEqual(failing(grade(LOAD, say('Which guard style? 1. if-throw (Recommended) 2. throw-helpers'), edit(ORDER_SERVICE, THROW_HELPER))), ['project-pref-wins']);
    // a write that holds the if-throw AND a throw-helper is no if-throw pass
    assert.deepStrictEqual(failing(grade(LOAD, edit(ORDER_SERVICE, IF_THROW + THROW_HELPER))), ['project-pref-wins']);
    // the item is the preference winning, not whether a guard is added: a fix with no guard and no ask lands no throw-helper
    assert.deepStrictEqual(failing(grade(LOAD, edit(ORDER_SERVICE, 'return subtotal * (1 - discountPercent / 100m);\n'), testEdit())), []);
    assert.deepStrictEqual(failing(grade(LOAD, edit(ORDER_SERVICE, 'discountPercent = Math.Clamp(discountPercent, 0, 100);\n'))), [], 'a silent clamp lands no throw-helper either');
    // the step reads the throw-helper alone: an if-throw anywhere, in the tests file too, lands none
    assert.deepStrictEqual(failing(grade(LOAD, edit(TESTS_FILE, IF_THROW))), []);
    // a throw-helper in the tests file is still a throw-helper in a .cs write
    assert.deepStrictEqual(failing(grade(LOAD, edit(TESTS_FILE, THROW_HELPER))), ['project-pref-wins']);
    // the parent's guard step is independent: the right guard with the load missing fails csharp-before-edit alone
    assert.deepStrictEqual(failing(grade(edit(ORDER_SERVICE, IF_THROW))), ['csharp-before-edit']);
});

test('csharp-project-style is a listed fixture, the csharp fixture\'s run with the preferences doc added', () =>
{
    assert.ok(sc.listSkills().includes(FIXTURE));
    const fx = expectOf(FIXTURE);
    const parent = expectOf('csharp');
    assert.deepStrictEqual(fx.run, parent.run, 'the run block is the csharp fixture\'s');
    // smoke fix 8: neither smoke run wrote a guard, so the clash never ran - the plain prompt asks for one
    assert.strictEqual(fx.prompts.plain, 'OrderService.Total ignores the discount - fix it, reject a negative discount, and add a test for it.');
    assert.ok(parent.prompts.plain.startsWith('OrderService.Total ignores the discount - fix it'), 'the csharp fixture\'s plain prompt opens the same way');
    assert.deepStrictEqual({ ...fx.prompts, plain: null }, { ...parent.prompts, plain: null }, 'the other two levels are the csharp fixture\'s');
    assert.deepStrictEqual(fx.steps.map((s) => s.id), ['csharp-before-edit', 'project-pref-wins']);
    assert.deepStrictEqual(fx.steps[0].graders, parent.steps[0].graders, 'csharp-before-edit grades as the parent\'s step does');
    assert.deepStrictEqual(fx.matchers.cs_write, parent.matchers.cs_write);
    assert.ok(!fx.steps.some((s) => s.id === 'load-said'), 'no load-said (S7)');
    assert.ok(!fx.steps.some((s) => s.graders.some((g) => g.type === 'llm')), 'no llm step');
    const scaffold = read(`meta/skill-comply/${FIXTURE}/scaffold.sh`);
    assert.doesNotMatch(scaffold, /(?:source|bash|sh|\.)\s+\S*scaffold\.sh/, 'the scaffold is a self-contained copy, never a call into the parent\'s');
    assert.ok(scaffold.includes('.alfred/docs/preferences/PROJECT-CODE-PREFERENCES.md'), 'the preferences doc');
    assert.ok(scaffold.includes('## P1 - Guard clauses are explicit if-throw statements, never the static throw-helpers'), 'holding P1');
    assert.ok(scaffold.indexOf('PROJECT-CODE-PREFERENCES.md') < scaffold.indexOf("git commit -q -m 'baseline'"), 'in the baseline commit');
    assert.ok(scaffold.includes('decimal subtotal = 0;'), 'the csharp fixture\'s OrderService');
});
