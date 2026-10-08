// The 2.1.5 audit Minors, rules package (merged.md M62, M64-M69, M71-M73): each case pins one rule's
// prose fix - a seat told to do what its tools cannot, a hint that arrives too late to help, repo
// trivia shipped to every project, an attach contract that differs rule to rule, a rationale that can
// never reach the run it describes, subset and generic lines in the always-on set, first actions with
// no order, a generated rule restating a baseline, and glob gaps.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectedRuleText, frontmatterOf } = require('./always-on-surface.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (text) => text.replace(/\s+/g, ' ');
const rule = (name) => read(`stack/rules/${name}.md`);
const injected = (name) => squash(injectedRuleText(rule(name)));
const registry = () => JSON.parse(read('meta/shared-rules.json')).rules;
const homes = (entry) => [entry.owner, ...(entry.sites || [])];
const pathsOf = (name) => JSON.parse(/^paths:\s*(\[.*\])\s*$/m.exec(frontmatterOf(rule(name)))[1]);

// ------------------------------------------------------------------ M62

test('M62: both repair routers give a read-only seat its action - report the red, name the resolver', () =>
{
    const line = 'A read-only seat (a verifier, a designer, a reviewer, an analyzer) has no Edit to loop with: it reports the red and names the resolver';
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
        assert.ok(squash(rule(name)).includes(line), `${name}.md`);
    const entry = registry()['repair-router-delegation-protocol'];
    for (const home of homes(entry))
        assert.ok(squash(home.marker).includes('it reports the red and names the resolver'), `the pinned marker covers the new sentence in ${home.file}`);
});

// ------------------------------------------------------------------ M64

test('M64: the C# depth hint lives in the always-on navigation rule, beside the overview call it governs', () =>
{
    const nav = injected('alfred-navigation');
    assert.match(nav, /`get_symbols_overview` takes ONE file, never a directory[^.]*on C# pass `depth: 2`/, 'the overview bullet carries the C# depth');
    assert.match(nav, /nested-type members need 3; a top-level-statements file returns `\{\}` at any depth/, 'the move kept the two edge facts the C# rule carried');
    assert.ok(!injected('csharp-conventions').includes('depth: 2'), 'the path rule no longer carries a hint only a file-tool touch delivers');
    assert.strictEqual(registry()['serena-csharp-overview-depth'].owner.file, 'stack/rules/alfred-navigation.md');
});

// ------------------------------------------------------------------ M65

test('M65: skill-authoring.md ships no restated description cap and no repo trivia', () =>
{
    const text = squash(rule('skill-authoring'));
    assert.ok(!text.includes('160 characters'), 'the skill it loads owns the cap');
    assert.ok(!text.includes('lint check 15c'), 'a consuming project has no lint check 15c');
    assert.ok(!text.includes('Alfred Code repo'), 'no repo trivia');
});

// ------------------------------------------------------------------ M66

test('M66: every FIRST-action rule carries the whole attach contract, and both halves are pinned in the same files', () =>
{
    const reg = registry();
    const first = homes(reg['convention-rule-first-action']).map((h) => h.file).sort();
    const receipt = homes(reg['convention-rule-load-receipt']).map((h) => h.file).sort();
    assert.deepStrictEqual(receipt, first, 'the load receipt is pinned wherever the first action is');
    assert.strictEqual(first.length, 11, 'nine convention rules, markdown-docs and skill-authoring');
    for (const file of first)
    {
        const text = squash(read(file));
        assert.ok(text.includes('the FIRST action after this rule attaches is'), `${file}: the pinned first action`);
        assert.ok(/(?:before the NEXT (?:edit|write|touch)[^.]*lands)/.test(text), `${file}: before the next edit`);
        assert.ok(text.includes('a path-scoped rule attaches ON the touch'), `${file}: why the load is owed after the attach`);
        assert.ok(/already in context/.test(text), `${file}: the in-context exemption`);
        assert.ok(text.includes('the receipt is what makes the load happen'), `${file}: the receipt`);
    }
});

// ------------------------------------------------------------------ M67

test('M67: the shell-no-attach rationale is a maintainer comment in the path rules, and stays live only where a shell run reads it', () =>
{
    for (const name of ['csharp-conventions', 'markdown-docs', 'skill-authoring'])
    {
        const live = injected(name);
        assert.ok(!/through the shell|first shell write/.test(live), `${name}.md: the injected text still explains the shell route: ${live}`);
        assert.match(squash(rule(name)), /<!--[^>]*shell[^>]*guard-read-whole-file\.js[^>]*-->/, `${name}.md keeps the rationale as a comment`);
    }
    assert.ok(injected('alfred-navigation').includes('path-scoped rules do not attach on the shell route'), 'the always-on copy reaches the shell run and stays');
});

// ------------------------------------------------------------------ M68

test('M68: the browser-only screenshot line leaves the always-on navigation rule, the browser row keeps the discipline', () =>
{
    const nav = injected('alfred-navigation');
    assert.ok(!/screenshot/i.test(nav), 'the browser row owns screenshot readback');
    const row = read('stack/skills/capture-agent-capabilities/references/generated-rule-template.md').split('\n').find((l) => l.startsWith('- `browser` - '));
    assert.ok(row && row.includes('never the iteration loop'), 'the browser row carries the mid-loop rule');
    assert.ok(nav.includes('Git Bash'), 'the Windows line stays: a per-OS rule copy would differ between teammates');
});

// ------------------------------------------------------------------ M69

test('M69: the quality gates drop the generic simplicity line and name Monitor as the wait tool', () =>
{
    const gates = injected('alfred-quality-gates');
    assert.ok(!gates.includes('Keep it simple') && !gates.includes('speculative'), 'a generic line with no measured miss');
    assert.ok(gates.includes('Comments: none by default; a why only when the code cannot say it'), 'the implementer bar cites this comments line by name');
    assert.ok(!gates.includes('the wait tool is deferred'), 'the tool is named');
    assert.ok(gates.includes('`ToolSearch select:Monitor`'), 'the load line names Monitor');
});

// ------------------------------------------------------------------ M71

test('M71: several FIRST actions due at once load together', () =>
{
    const text = injected('alfred-interaction');
    assert.match(text, /Several FIRST actions due at once[^.]*load in the same call/);
});

// ------------------------------------------------------------------ M72

test('M72: the generated architecture rule carries only its trigger - where the docs live is the baselines\'', () =>
{
    const shapes = read('stack/skills/capture-architecture/references/doc-shapes.md');
    const at = shapes.indexOf('## .claude/rules/alfred-project-architecture.md');
    const block = /```markdown\n([\s\S]*?)```/.exec(shapes.slice(at))[1];
    const body = squash(injectedRuleText(block)).trim();
    assert.ok(!body.includes('<docs-path>'), `the body restates the root the navigation baseline names: ${body}`);
    assert.ok(body.includes('before a structural change'), body);
    assert.ok(!squash(read('stack/skills/capture-architecture/SKILL.md')).includes('with `<docs-path>` baked to the LITERAL resolved root'), 'step 6 no longer bakes a path');
});

// ------------------------------------------------------------------ M73

test('M73: the devops rule attaches on every delivery surface its skill claims', () =>
{
    const paths = pathsOf('devops-conventions');
    for (const glob of ['**/.github/actions/**/action.yml', '**/.github/actions/**/action.yaml', '**/azure-pipelines*.yml',
        '**/azure-pipelines*.yaml', '**/.gitlab-ci.yml', '**/.env.example', '**/.env.template', '**/*.env.example', '**/*.env.template'])
        assert.ok(paths.includes(glob), `devops-conventions.md paths: ${glob}`);
    const graph = JSON.parse(read('meta/stack-graph.json'));
    assert.ok(JSON.stringify(graph).includes('**/azure-pipelines*.yml'), 'the graph was regenerated');
});

// 2.1.6 review A1: the repair routers dispatch the resolvers from the main session, so they route a capped
// resolver's status-less return too (the sentence is pinned as seat-statusless-return).
test('the repair routers route a status-less resolver return as a seat death', () =>
{
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
    {
        const text = squash(rule(name));
        assert.match(text, /A return with no closing status line - a seat stopped at its `maxTurns` \(Claude Code marks the output partial from 2\.1\.246\) or killed mid-task - is never DONE and never resumed as-is/, name);
        assert.ok(homes(registry()['seat-statusless-return'] || { owner: {} }).some((h) => h.file === `stack/rules/${name}.md`), `${name}: a pinned home`);
    }
});

// ------------------------------------------------------------------ 2026-10-08 audit (rules.md F3-F16, hooks.md #14)
// Each case names the report row it holds, so a regression reads as the audit line it reopens.

test('rules F3: the AGENTS template restates none of the seven always-on rules - each loads itself every session', () =>
{
    const text = read('stack/AGENTS.template.md');
    const rulesSection = text.slice(text.indexOf('\n## Rules'));
    for (const name of ['interaction', 'quality-gates', 'security', 'git', 'navigation', 'docs-root', 'memory'])
        assert.ok(!rulesSection.includes(`| \`.claude/rules/alfred-${name}.md\` |`), `alfred-${name}.md has a template row`);
    for (const generated of ['alfred-project-agent-capabilities', 'alfred-project-architecture', 'alfred-project-related-context', 'alfred-project-run-book', 'project-code-style'])
        assert.ok(rulesSection.includes(`| \`.claude/rules/${generated}.md\` (GENERATED`), `${generated}.md keeps its GENERATED row`);
});

test('hooks #14: an ask with no options to name still goes through the tool - the stop contract blocks a prose question', () =>
{
    const text = injected('alfred-interaction');
    assert.ok(!text.includes('free-form prose only when no options can be named'), 'the prose carve-out the hook blocks');
    assert.ok(text.includes('with no options to name, the tool still carries it - the likeliest answers as options, the rest via Other'));
});

test('rules F4: background output is polled from one home, the quality gates', () =>
{
    assert.ok(!/Monitor/.test(injected('alfred-navigation')), 'the navigation copy is folded away');
    assert.match(injected('alfred-quality-gates'), /Poll it through `Monitor` or its new lines, never a whole-log re-read\./);
});

test('rules F5 + F16: the navigation rule says one thing per line, in plain words', () =>
{
    const nav = injected('alfred-navigation');
    assert.ok(!nav.includes("A language serena's"), 'the ungrammatical fused line');
    assert.match(nav, /- A language the navigation server's `project\.yml` \(`<data root>\/serena\/`\) does not list takes the fallback from its first call\. -/);
    assert.match(nav, /- A large JSON \/ YAML \/ lock \/ fixture file is queried/);
    assert.ok(!nav.includes('check the tool list before an edit call'), 'F16');
    assert.ok(nav.includes('confirm an edit tool is in the tool list before calling it'), 'F16');
});

test('rules F6: the compaction section carries the name the docs give it', () =>
{
    assert.match(rule('alfred-navigation'), /^## Compact Instructions$/m);
    assert.doesNotMatch(rule('alfred-navigation'), /^## Compaction$/m);
});

test('rules F7 + skills habits-code-comments: the inline-comment floor admits the upstream-issue link and is pinned to the comments skill', () =>
{
    const gates = injected('alfred-quality-gates');
    assert.ok(gates.includes('Never a ticket id (a public upstream issue on a workaround excepted), change narration, commented-out code or an unasked `TODO`'));
    const entry = registry()['inline-comment-never-list'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/skills/habits-code-comments/SKILL.md');
    assert.ok(homes(entry).some((h) => h.file === 'stack/rules/alfred-quality-gates.md'));
});

test('rules F8: the execution-strategy trigger list is pinned in the rule and the skill it routes to', () =>
{
    const entry = registry()['execution-strategy-trigger-list'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-interaction.md');
    assert.ok(homes(entry).some((h) => h.file === 'stack/skills/habits-execution-strategy/SKILL.md'));
});

test('rules F9: the simplification-ceiling line sits with the comment rules and is pinned with the implementers\' copies', () =>
{
    assert.ok(!injected('alfred-interaction').includes('deliberate simplification'), 'moved out of Formatting and privacy');
    const gates = injected('alfred-quality-gates');
    const comments = gates.indexOf('Comments: none by default');
    const ceiling = gates.indexOf('No code comment flagging a deliberate simplification');
    assert.ok(comments >= 0 && ceiling > comments, 'right after the comments line');
    assert.ok(homes(registry()['implementer-ceilings-row']).some((h) => h.file === 'stack/rules/alfred-quality-gates.md'));
});

test('rules F10: an in-session pick on a broken build starts at the root-cause habit, in both routers', () =>
{
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
    {
        const text = squash(rule(name));
        assert.ok(text.includes('resolver recommended; an in-session pick starts at the `habits-root-cause` Skill call)'), name);
        assert.ok(text.includes('offer the resolver through AskUserQuestion'), `${name}: the pinned ask stays`);
    }
    const graph = JSON.parse(read('meta/stack-graph.json'));
    for (const name of ['dotnet-repair-agents', 'angular-repair-agents'])
        assert.ok((graph.rules[name].skills || []).includes('habits-root-cause'), `${name}: the graph pulls the named skill`);
});

test('rules F11: the docs root exempts instruction files and drops capture-internal trivia', () =>
{
    const line = read('stack/rules/alfred-docs-root.md').split('\n').find((l) => /EVERY doc the assistant creates/.test(l)) || '';
    assert.ok(line.includes('EVERY doc the assistant creates - an instruction file (AGENTS.md, a rule, a skill) excepted - lives under ONE root'));
    assert.ok(!line.includes('watch.json'));
});

test('rules F12 + F13: the commit header and the memory verify clause are each stated once', () =>
{
    const vcs = injected('alfred-git');
    assert.strictEqual((vcs.match(/Conventional[- ]Commits/g) || []).length, 1, vcs);
    assert.match(vcs, /\*\*Header\*\* - one line, one of two shapes: the ticket id \(`PROJ-142`\) or a Conventional-Commits subject/);
    const memory = injected('alfred-memory');
    assert.strictEqual((memory.match(/verified before use/g) || []).length, 1, memory);
});
