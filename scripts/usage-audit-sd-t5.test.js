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

// ---- SD07: a library skill the user names that this project does not carry -----------------------------------------
// The stamped usage policy is the one always-on text every project's capabilities rule carries.
const policyBlock = () => {
    const lines = read('stack/skills/capture-agent-capabilities/SKILL.md').split('\n');
    const at = lines.findIndex((l) => l.startsWith('## Usage policy (fixed'));
    let end = at + 2;
    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
    return flat(lines.slice(at + 2, end).join('\n'));
};
// ---- SD16: the security review reads the full change set without moving the index ------------------------------------
test('SD16 42951e5b#3: the review read is git diff HEAD plus each untracked file against /dev/null - never add -N or reset', () => {
    const t = flat(read('stack/rules/alfred-security.md'));
    assert.match(t, /`git diff HEAD`, plus `git diff --no-index -- \/dev\/null <file>` for each file `git ls-files -o --exclude-standard` lists, each named, never a loop \(the secret guard masks only a named dump\)/);
    assert.match(t, /never `git add -N` or `git reset` for it \(a mixed reset mid-merge drops MERGE_HEAD\)/);
    assert.doesNotMatch(t, /git add -N \. && git diff HEAD; git reset -q/, 'no rule prescribes the reset recipe');
    for (const f of fs.readdirSync(path.join(ROOT, 'stack', 'rules'))) assert.doesNotMatch(read(`stack/rules/${f}`), /git add -N \.[^`]*git reset/, `${f} prescribes add -N + reset`);
});

test('SD07 2ca8e8ee#10 42951e5b#6 fdce35ae#8: a named skill not installed here is offered through configure, never borrowed', () => {
    const p = policyBlock();
    assert.match(p, /A skill the user names that is not installed here \(`Unknown skill`\): say so and offer `\/alfred-code:configure` to add it - never load another project's or a plugin cache's copy/);
});
