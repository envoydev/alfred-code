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
    const [mixed, checkOnly] = asks(text).filter((a) => !/^Write <file> from the outline/.test(a.question));
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
    const lines = read('stack/skills/capture-agent-awareness/SKILL.md').split('\n');
    const at = lines.findIndex((l) => l.startsWith('## Usage policy (fixed'));
    let end = at + 2;
    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
    return flat(lines.slice(at + 2, end).join('\n'));
};
// ---- SD10: the offer route ------------------------------------------------------------------------------------------
test('SD10 d56562c7#1: an offer to make a change goes through AskUserQuestion; a prose want-me-to close is blocked', () => {
    const t = flat(read('stack/rules/alfred-interaction.md'));
    assert.match(t, /No closing offer to elaborate; an offer to MAKE a change goes through AskUserQuestion - the stop guard blocks a prose 'want me to \.\.\.\?' close\./);
    assert.doesNotMatch(t, /an offer to MAKE a change is fine/);
});

// ---- SD09: the hook ledgers are evidence, never regenerable ---------------------------------------------------------
test('SD09 d9035363#5: a docs cleanup keeps the hook ledgers and flow/ state, or its ask names the loss', () => {
    const t = flat(read('stack/rules/alfred-docs-root.md').replace(/<!--[\s\S]*?-->/g, ''));
    assert.match(t, /The hooks' ledgers \(`tools-usage\/`, `hook-blocks\/`, `history\/`\) are the only record of what ran and what the guards denied, and `flow\/` is live per-session state: a cleanup keeps them, or its ask names that loss - never 'regenerable'\./);
});

// ---- SD16: a run of unknown length is watched on its failure lines, not only for its exit ---------------------------
test('SD16 7f8803eb#5: a suite of unknown length arms Monitor on its failure lines plus a quiet alert; exit-only is for a run whose end is all that matters', () => {
    const t = flat(read('stack/rules/alfred-quality-gates.md'));
    assert.match(t, /One `run_in_background` command whose end is all that matters needs nothing more - its exit re-invokes you; a suite of unknown length \(failures show long before its end\), a condition inside a run or across several arms the `Monitor` tool when you start it - on the failure lines plus an alert when the output goes quiet/);
});

// ---- SD15: a package change in a project file routes to the migration workflow ----------------------------------------
test('SD15 42951e5b#8: the .NET router sends a package change to the migration-workflow skill, by description', () => {
    const t = flat(read('stack/rules/dotnet-repair-agents.md'));
    assert.match(t, /A package change in a project file \(a version bump, central package alignment in `Directory\.Packages\.props`\) is a migration step, not a repair: before its first edit, load the \.NET skill whose description covers updating NuGet packages, where the install has one\./);
    assert.doesNotMatch(t, /`dotnet-migrate`/, 'selected by description - the skill may be absent');
});

// ---- SD13: Windows shell idioms (Git Bash ships no jq; MSYS path conversion; PowerShell from Bash) -----------------
test('SD13 177c5743#3 e90a1845#2 42951e5b#7 7f8803eb#9: JSON through node -e, rev:path with conversion off, PowerShell from a .ps1', () => {
    const nav = flat(read('stack/rules/alfred-navigation.md'));
    assert.match(nav, /queried \(a `node -e` projection - Git for Windows ships no `jq` - or `grep -n`, then a ranged Read\)/);
    assert.match(nav, /prefix a `git show <rev>:<path>` with `MSYS2_ARG_CONV_EXCL='\*'`, or path conversion rewrites it/);
    assert.match(nav, /run PowerShell as a quoted-heredoc \(`<<'EOF'`\) `\.ps1` via `-File "\$\(cygpath -w <file>\)"`, never a double-quoted `-Command` \(Bash expands its `\$_`\)/);
    for (const rel of ['stack/rules', 'stack/skills/capture-usage-report', 'stack/skills/capture-agent-awareness', 'stack/skills/habits-adjust-agents-md'])
    {
        const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.md') ? [`${dir}/${e.name}`] : []));
        for (const f of walk(rel)) assert.doesNotMatch(read(f), /\bjq\s+(-[a-z]+\s+)?'/, `${f} prescribes a jq command`);
    }
    assert.match(flat(read('stack/skills/capture-usage-report/references/run-mechanics.md')), /node, never `jq` - Git for Windows ships none/);
});

// ---- SD16: the security review reads the full change set without moving the index ------------------------------------
test('SD16 42951e5b#3: the review read is git diff HEAD plus each untracked file against /dev/null - never add -N or reset', () => {
    const t = flat(read('stack/rules/alfred-security.md'));
    assert.match(t, /`git diff HEAD`, plus `git diff --no-index -- \/dev\/null <file>` for each file `git ls-files -o --exclude-standard` lists, each named, never a loop \(the secret guard masks only a named dump\)/);
    assert.match(t, /never `git add -N` or `git reset` for it \(a mixed reset mid-merge drops MERGE_HEAD\)/);
    assert.doesNotMatch(t, /git add -N \. && git diff HEAD; git reset -q/, 'no rule prescribes the reset recipe');
    for (const f of fs.readdirSync(path.join(ROOT, 'stack', 'rules'))) assert.doesNotMatch(read(`stack/rules/${f}`), /git add -N \.[^`]*git reset/, `${f} prescribes add -N + reset`);
});

// ---- SD12: the usage audit's batch bound, scope grep and summary ---------------------------------------------------
test('SD12 ae38c08f#3 ae38c08f#6: the batch also closes past the fresh-session trigger, and one gate call after each bundle decides it and writes the summary rows', () => {
    const t = skill('capture-usage-report');
    assert.match(t, /\*\*The batch is BOUNDED - at 12 bundles, or at the first bundle boundary past this install's fresh-session trigger, whichever comes first/);
    assert.doesNotMatch(t, /the biggest scope marked Recommended is what forces compactions/, 'the compaction rationale alone does not cover a 1M window');
    assert.match(t, /`node <snapshot>\/stack\/skills\/capture-usage-report\/scripts\/bundle-gate\.js --done <bundles closed this run> --summary <docs-path>\/usage-report`/);
    assert.ok(fs.existsSync(path.join(ROOT, 'stack/skills/capture-usage-report/scripts/bundle-gate.js')), 'the gate the body names ships in the skill folder');
    assert.match(t, /\*\*Its bundle list is rewritten after EACH bundle, by the gate call that ends step 4\*\*/);
    assert.match(t, /keep the two markers and the rows between them as the gate wrote them, never hand-write those rows/);
    assert.doesNotMatch(t, /Rewrite it after EACH bundle closes, not once at the end of the run/, 'the reminder became the gate call');
});

test('SD12 ae38c08f#4 (skill half): the scope grep allows a plugin prefix and counts the core commands', () => {
    const t = skill('capture-usage-report');
    assert.match(t, /grep -lE '<command-name>\/\?\(\[A-Za-z0-9_-\]\+:\)\?\(<names>\)<\/command-name>\|"skill":"\(\[A-Za-z0-9_-\]\+:\)\?\(<names>\)"'/);
    assert.match(t, /the core's `\/alfred-code:\*` command runs \(setup, update, configure, validate, init\) count as stack runs too/);
    // The pattern the body prints finds both spellings of a JSONL marker.
    const re = /<command-name>\/?([A-Za-z0-9_-]+:)?(configure|task-solve)<\/command-name>|"skill":"([A-Za-z0-9_-]+:)?(configure|task-solve)"/;
    for (const line of ['"content":"<command-name>/alfred-code:configure</command-name>"', '"content":"<command-name>/task-solve</command-name>"', '"input":{"skill":"alfred-code:configure"}', '"input":{"skill":"task-solve"}'])
        assert.match(line, re, line);
    assert.doesNotMatch('"text":"run /task-solve next"', re, 'a bare mention is not a run');
});

test('SD07 2ca8e8ee#10 42951e5b#6 fdce35ae#8: a named skill not installed here is offered through configure, never borrowed', () => {
    const p = policyBlock();
    assert.match(p, /A skill the user names that is not installed here \(`Unknown skill`\): say so and offer `\/alfred-code:configure` to add it - never load another project's or a plugin cache's copy/);
});

test('SD14 ae38c08f#5 (skill half): an error on a call a PreToolUse hook rewrote is read against the rewrite first', () => {
    const d = flat(read('stack/skills/capture-usage-report/references/diagnosis-discipline.md'));
    assert.match(d, /An error on a REWRITTEN call has the rewrite as its first suspect/);
    // The column and the line the discipline names are the analyzer's own words.
    const a = read('scripts/analyze-usage.js');
    assert.match(a, /rpad\('hook-rw', 7\)/);
    assert.match(a, /ran with input a PreToolUse hook REWROTE/);
    assert.match(d, /hook-rw column and the skeleton's 'ran with input a PreToolUse hook REWROTE' line/);
});

// Audit 2026-10-14 SKC13 / SKC14: create mode's unrequested write went out through a prose pointer at step 5's improve
// ask, which marks a different option; it has its own marked template now. The memory docs (2026-10-14) name the
// `/config` Project instructions value that loads CLAUDE.md and AGENTS.md together.
test('SKC14 + SKC13: the create-mode write ask is a marked template, and the both-files setting is named', () => {
    const text = read('stack/skills/habits-adjust-agents-md/SKILL.md');
    const create = asks(text).find((a) => /^Write <file> from the outline above/.test(a.question));
    assert.ok(create, 'the create-mode write ask is a template');
    assert.strictEqual(create.options[0], 'Write it (Recommended)');
    assert.ok(create.options.includes('Skip'));
    assert.doesNotMatch(flat(text), /puts it through the step-5 AskUserQuestion/);
    assert.strictEqual((flat(text).match(/Project instructions to 'claude-md-and-agents-md' in `\/config`/g) || []).length, 2, 'both sites name the setting');
});
