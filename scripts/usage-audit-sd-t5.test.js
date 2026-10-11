'use strict';
// The usage audit of 2026-10-11 (31 Windows sessions of one consuming project) - apply seat T5: the rules, the AGENTS.md
// template and check, and the capabilities, usage-report and adjust-agents-md skills. Each block names its cluster and
// the finding ids it holds (`<session8>#<n>`), so a later edit that brings the defect back goes red here. The scripts'
// own behaviour is pinned by their own tests (agents-md-check, capabilities-inventory).
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

// ---- SD04: the AGENTS.md improve pass -------------------------------------------------------------------------------
test('SD04 5b9ce9c5#3 6288ad94#8 bca100bd#5: check rows alone still get the ask, with a keep option; the diffs ride the ask; the outline compare is a script row', () => {
    const text = read('stack/skills/habits-adjust-agents-md/SKILL.md');
    const t = flat(text);
    const [mixed, checkOnly] = asks(text);
    assert.ok(checkOnly, 'the check-rows-only ask is a template of its own');
    assert.strictEqual(checkOnly.options[0], 'Skip (Recommended)');
    assert.ok(checkOnly.options.some((o) => /^Keep the lines as written for good$/.test(o)), 'the keep marker is one of its options');
    assert.match(t, /With only check fixes drafted, the ask still runs - its keep option is the one route to the keep marker, so a row is never ruled correct by the run itself/);
    assert.ok(mixed.options.some((o) => /^Apply some/.test(o)));
    assert.match(t, /a check row named 'keep' gets the keep marker/);
    assert.match(t, /again as the `preview` of each option that writes \(the AskUserQuestion option field, single-select only\), so the ask cannot go out without its diffs/);
    assert.match(t, /node "<stack>\/scripts\/agents-md-check\.js" --root \. --outline/);
    assert.match(t, /the report says how many sections lack and how many this run added/);
});
