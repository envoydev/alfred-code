'use strict';
// Audit 2026-10-30, Tier 4 seat H: the A/B-only candidates for the agents, the .NET preloads and the done-close judge.
// Each test names the finding it pins, so a regression reads as the audit line it reopens
// (.alfred/docs/audits/2026-10-30/agents.md, skills-dotnet.md, hooks.md). A candidate is made and proven here; whether it
// helps is the billed A/B its commit body names.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

// SKD-04: three .NET preloads ride 6-17 seat dispatches whole. Two cited blocks move out of the always-injected bodies:
// dotnet-testing's FluentAssertions licensing parenthetical (library-routing.md:41-42 already holds it, so it is deleted)
// and dotnet-hosted-services' Channels section (now references/channels.md, named at its step). csharp's opening line is
// the body's routing to its references plus the project-config clause shared-rules pins to the skill's own opening, so it
// stays.
test('SKD-04: the testing licensing line lives only in library-routing.md, named at the bump step', () =>
{
    const body = squash(read('stack/skills/dotnet-testing/SKILL.md'));
    assert.doesNotMatch(body, /paid for commercial use|AwesomeAssertions|licensing decision/);
    assert.match(body, /\*\*FluentAssertions 7\.x\*\* assertions \(7\.1\+ on xUnit v3\)/, 'the SKD-02 version floor stays in the body - 7.0 does not run on xUnit v3');
    assert.match(body, /When the project has already picked, is picking now or is bumping one of them a major, the alternatives and the reason for each are `references\/library-routing\.md`/);
    const routing = squash(read('stack/skills/dotnet-testing/references/library-routing.md'));
    assert.match(routing, /v8\+ is free only for open-source and non-commercial use and needs a paid license for commercial projects/);
    assert.match(routing, /\*\*AwesomeAssertions\*\* \| Apache-2\.0 community fork/);
});

test('SKD-04: the Channels block moves to dotnet-hosted-services/references/channels.md, named at its step', () =>
{
    const body = squash(read('stack/skills/dotnet-hosted-services/SKILL.md'));
    assert.doesNotMatch(body, /BoundedChannelOptions|ReadAllAsync|Do not build a durability story/);
    assert.match(body, /## Queue-backed work with Channels When one part of the app produces work that a background worker consumes in the same process, read `references\/channels\.md` before writing the queue/);
    const ref = read('stack/skills/dotnet-hosted-services/references/channels.md');
    assert.match(ref, /^# Queue-backed work with Channels$/m);
    for (const kept of ['Channel.CreateBounded<WorkItem>(', 'await foreach (var item in _channel.Reader.ReadAllAsync(stoppingToken))', 'Prefer a **bounded** channel', 'Do not build a durability story on top of an in-memory channel.'])
        assert.ok(ref.includes(kept), `the reference keeps: ${kept}`);
});

test('SKD-04: csharp keeps its opening line - the project-config clause is pinned to the skill\'s own opening', () =>
{
    const head = squash(read('stack/skills/csharp/SKILL.md').split('## When to use')[0]);
    assert.ok(head.includes('PROJECT-CODE-PREFERENCES.md` are higher priority'));
    assert.match(JSON.parse(read('meta/shared-rules.json')).rules['project-config-outranks-conventions']._note, /says so in its own opening so a seat that loaded only that skill still knows/);
});

// AG-15: the designers' opus/xhigh pin rests on 'design mistakes are the most expensive to unwind', an assertion; the
// reasoners' owed A/B was on record and the designers' was not. The candidate records it beside theirs - no pin moves.
test('AG-15: the designers\' owed sonnet/xhigh A/B is recorded beside the reasoners\'', () =>
{
    const routing = squash(read('stack/skills/task-solve-cross/references/model-routing.md'));
    const para = routing.slice(routing.indexOf('The house pins land'), routing.indexOf('One caveat on the Escalate-when column'));
    assert.match(para, /no A\/B against a sonnet pin/, 'the reasoners\' line stays');
    assert.match(para, /The designers' opus\/xhigh pin is asserted the same way and owes the same A\/B: one sonnet\/xhigh designer arm against the opus\/xhigh pin on the same trio task/);
    assert.match(para, /the verifier's punch-list findings traced to the design/, 'the arm names its metric');
    const catalog = squash(read('.claude/rules/repo-catalog.md'));
    assert.match(catalog, /the A\/B the designer and reasoner pins still lack/);
    for (const seat of fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => f.endsWith('-solution-designer.md')))
        assert.match(read(`stack/agents/${seat}`), /^model: opus$/m, `${seat}: the candidate moves no pin`);
});

// AG-07: the implementers' external-API docs check restates alfred-quality-gates.md's outside-world line in six unmanaged,
// drifted copies (four implementers had none). The candidate pins one wording in shared-rules.json and brings all ten to
// it; the navigation parenthetical (a restatement of alfred-navigation.md's tool order) is cut to the rule pointer.
const SEATS = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
const IMPLEMENTERS = SEATS.filter((s) => s.endsWith('-implementer'));
const DOCS_CHECK = 'is resolved against its current docs through the documentation tools your start line orders before you write against it, never from recall - unreachable, say it is unverified';

test('AG-07: one registered docs-check wording, carried by all ten implementers', () =>
{
    assert.strictEqual(IMPLEMENTERS.length, 10);
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['implementer-external-api-docs-check'];
    assert.ok(entry, 'the registry entry');
    assert.strictEqual(entry.owner.file, 'stack/rules/alfred-quality-gates.md');
    assert.ok(squash(read(entry.owner.file)).includes(entry.owner.marker), 'the owner marker is the rule\'s own line');
    assert.deepStrictEqual(entry.sites.map((s) => s.file).sort(), IMPLEMENTERS.map((s) => `stack/agents/${s}.md`).sort());
    for (const site of entry.sites) assert.strictEqual(site.marker, DOCS_CHECK, site.file);
    for (const s of IMPLEMENTERS)
    {
        const body = squash(read(`stack/agents/${s}.md`));
        assert.strictEqual(body.split(DOCS_CHECK).length - 1, 1, `${s}: the line once`);
        assert.doesNotMatch(body, /never recalled - a recalled tag|resolve its signatures against the library's current docs \(|is resolved against the (library's )?current docs through/, `${s}: a drifted copy left`);
    }
});

test('AG-07: no seat restates the navigation tool order; each still points at the navigation rule', () =>
{
    const PAREN = /\(`LSP` - `workspaceSymbol` for a symbol, `findReferences` for its callers, `documentSymbol` for a file's outline - then a scoped grep, reported as name-matched\)|\(`LSP` `workspaceSymbol`, `findReferences`, then a scoped grep\)/;
    for (const s of SEATS)
    {
        const body = squash(read(`stack/agents/${s}.md`));
        assert.doesNotMatch(body, PAREN, `${s}: the parenthetical`);
        if (/the navigation tools your start line orders/.test(body)) assert.match(body, /`\.claude\/rules\/alfred-navigation\.md`/, `${s}: the pointer`);
    }
});

// AG-03: the 30 trio seats preload 12k-60k chars of skill bodies on every dispatch - a plan audit and a findings-plan run
// included. The candidate is the install-safe split: a seat keeps a preload where it is that skill's only install route in
// the stack that hosts it, or a process skill (habits-*, task-design); every other code-skill preload leaves `skills:` and
// the body loads it through the Skill tool in ONE directive at the step that writes or judges code. The pins this moved
// held 'prose-instructed loads fired in 0 of 5 seats' - the measurement the billed A/B re-tests.
const AG03 = {
    'aspnet-implementer': { moved: ['csharp', 'dotnet-testing', 'dotnet-web-error-handling'], kept: ['dotnet-data-access', 'dotnet-web-backend', 'habits-done-gate', 'habits-test-first'] },
    'aspnet-solution-designer': { moved: ['csharp-design-patterns', 'dotnet-testing'], kept: ['dotnet-web-backend', 'task-design'] },
    'aspnet-verifier': { moved: ['csharp', 'dotnet-testing'], kept: ['dotnet-code-quality', 'dotnet-data-access', 'dotnet-web-backend', 'habits-done-gate'] },
    'browser-extension-implementer': { moved: ['javascript', 'typescript'], kept: ['browser-extension', 'habits-done-gate', 'habits-test-first'] },
    'browser-extension-solution-designer': { moved: ['ts-js-testing'], kept: ['browser-extension', 'task-design'] },
    'browser-extension-verifier': { moved: ['javascript', 'ts-js-testing', 'typescript'], kept: ['browser-extension', 'habits-done-gate'] },
    'console-implementer': { moved: ['csharp', 'dotnet-testing'], kept: ['dotnet-hosted-services', 'habits-done-gate', 'habits-test-first'] },
    'console-solution-designer': { moved: ['csharp-design-patterns', 'dotnet-testing'], kept: ['dotnet-hosted-services', 'task-design'] },
    'console-verifier': { moved: ['csharp', 'dotnet-testing'], kept: ['dotnet-code-quality', 'dotnet-hosted-services', 'habits-done-gate'] },
    'data-implementer': { moved: ['database-conventions'], kept: ['csharp', 'dotnet-data-access', 'dotnet-testing', 'habits-done-gate', 'habits-test-first'] },
    'data-solution-designer': { moved: ['database-conventions', 'dotnet-migrate'], kept: ['task-design'] },
    'data-verifier': { moved: ['database-conventions', 'dotnet-migrate'], kept: ['dotnet-testing', 'habits-done-gate'] },
    'devops-implementer': { moved: ['devops'], kept: ['habits-done-gate'] },
    'devops-solution-designer': { moved: ['devops'], kept: ['task-design'] },
    'devops-verifier': { moved: ['devops'], kept: ['habits-done-gate'] },
    'ionic-angular-implementer': { moved: ['angular-conventions', 'javascript', 'typescript'], kept: ['ionic', 'habits-done-gate', 'habits-test-first'] },
    'ionic-angular-solution-designer': { moved: ['angular-conventions', 'angular-testing'], kept: ['ionic', 'task-design'] },
    'ionic-angular-verifier': { moved: ['angular-conventions', 'angular-testing', 'javascript', 'typescript'], kept: ['ionic', 'habits-done-gate'] },
    'web-angular-implementer': { moved: ['angular-conventions', 'javascript', 'typescript'], kept: ['habits-done-gate', 'habits-test-first'] },
    'web-angular-solution-designer': { moved: ['angular-conventions', 'angular-testing'], kept: ['task-design'] },
    'web-angular-verifier': { moved: ['angular-conventions', 'angular-testing', 'javascript', 'typescript'], kept: ['habits-done-gate'] },
    'windows-service-implementer': { moved: ['csharp', 'dotnet-testing'], kept: ['dotnet-hosted-services', 'dotnet-windows-service', 'habits-done-gate', 'habits-test-first'] },
    'windows-service-solution-designer': { moved: ['csharp-design-patterns', 'dotnet-testing'], kept: ['dotnet-hosted-services', 'dotnet-windows-service', 'task-design'] },
    'windows-service-verifier': { moved: ['csharp', 'dotnet-testing'], kept: ['dotnet-code-quality', 'dotnet-hosted-services', 'dotnet-windows-service', 'habits-done-gate'] },
    'winforms-implementer': { moved: ['csharp', 'dotnet-testing', 'dotnet-winforms'], kept: ['habits-done-gate', 'habits-test-first'] },
    'winforms-solution-designer': { moved: ['csharp-design-patterns', 'dotnet-testing', 'dotnet-winforms'], kept: ['task-design'] },
    'winforms-verifier': { moved: ['csharp', 'dotnet-testing', 'dotnet-winforms'], kept: ['dotnet-code-quality', 'habits-done-gate'] },
    'wpf-implementer': { moved: ['csharp', 'dotnet-testing', 'dotnet-wpf'], kept: ['habits-done-gate', 'habits-test-first'] },
    'wpf-solution-designer': { moved: ['csharp-design-patterns', 'dotnet-testing', 'dotnet-wpf'], kept: ['task-design'] },
    'wpf-verifier': { moved: ['csharp', 'dotnet-testing', 'dotnet-wpf'], kept: ['dotnet-code-quality', 'habits-done-gate'] },
};
const TRIO = SEATS.filter((s) => /-(solution-designer|implementer|verifier)$/.test(s));
const frontmatterSkills = (s) =>
{
    const fm = read(`stack/agents/${s}.md`).match(/^---\n([\s\S]*?)\n---\n/)[1];
    const list = fm.match(/^skills:[ \t]*\n((?:[ \t]*-[ \t]*\S.*\n?)+)/m);
    return list ? list[1].split('\n').map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim()).filter(Boolean) : [];
};

test('AG-03: each trio seat preloads only its only-route and process skills', () =>
{
    assert.deepStrictEqual(TRIO.slice().sort(), Object.keys(AG03).sort(), 'the 30 trio seats');
    const graph = JSON.parse(read('meta/stack-graph.json'));
    for (const [seat, { moved, kept }] of Object.entries(AG03))
    {
        assert.deepStrictEqual(frontmatterSkills(seat).slice().sort(), kept.slice().sort(), `${seat}: skills:`);
        assert.deepStrictEqual(graph.agents[seat].skills.slice().sort(), kept.slice().sort(), `${seat}: the graph edge`);
        for (const s of moved) assert.ok(!graph.agents[seat].skills.includes(s), `${seat}: ${s} left the preloads`);
    }
});

test('AG-03: ONE Skill-tool load directive per seat, at the step that writes or judges code, naming every moved skill', () =>
{
    for (const [seat, { moved }] of Object.entries(AG03))
    {
        const text = read(`stack/agents/${seat}.md`);
        const body = text.slice(text.indexOf('\n---\n', 4) + 5);
        const directives = body.split('\n').filter((l) => /through the Skill tool - (they are|it is) not preloaded: /.test(l));
        assert.strictEqual(directives.length, 1, `${seat}: one directive`);
        const [line] = directives;
        assert.match(line, /^\d\. Before (the first code edit|judging the code|judging the fit|setting the test strategy), load (these|this) through the Skill tool - (they are|it is) not preloaded: /, `${seat}: a numbered step opens with it`);
        const section = body.slice(0, body.indexOf(line)).split('\n').filter((l) => /^## /.test(l)).pop();
        assert.match(section, /^## (Loop|Checks|Method) \(bounded\)$/, `${seat}: the directive sits in the steps`);
        const named = line.replace(/^\d\. /, '').split(/\. (?=[A-Z])/)[0];
        for (const s of moved) assert.ok(named.includes(`\`${s}\` (`), `${seat}: the directive names ${s} with what it covers`);
        // no sentence still says a moved skill is preloaded
        for (const sentence of squash(body).split(/(?<=[.;])\s+/))
        {
            if (!/\bpreloaded\b/.test(sentence) || /not preloaded/.test(sentence)) continue;
            for (const s of moved) assert.ok(!sentence.includes(`\`${s}\``), `${seat}: '${sentence.slice(0, 120)}' still calls ${s} preloaded`);
        }
    }
});

test('AG-03: nothing drops out of a stack\'s install - every stack closes the same skill set with the moved preloads put back', () =>
{
    const { computeClosure, withAlways } = require('./stack-select.js');
    const graph = JSON.parse(read('meta/stack-graph.json'));
    const recs = JSON.parse(read('meta/recommendations.json'));
    const before = JSON.parse(JSON.stringify(graph));
    for (const [seat, { moved }] of Object.entries(AG03)) before.agents[seat].skills = [...new Set([...before.agents[seat].skills, ...moved])];
    const hosting = Object.entries(recs.stacks).filter(([, seed]) => (seed.agents || []).some((a) => AG03[a]));
    assert.strictEqual(hosting.length, 10, 'the 10 trio stacks');
    for (const [tag, seed] of Object.entries(recs.stacks))
    {
        assert.deepStrictEqual(computeClosure(graph, seed).skills, computeClosure(before, seed).skills, `${tag}: the stack's own closure`);
        assert.deepStrictEqual(computeClosure(graph, withAlways(seed, recs.always)).skills, computeClosure(before, withAlways(seed, recs.always)).skills, `${tag}: the install closure`);
    }
    for (const [tag, seed] of hosting)
        for (const seat of seed.agents.filter((a) => AG03[a]))
            for (const s of AG03[seat].moved) assert.ok(computeClosure(graph, seed).skills.includes(s), `${tag}: ${s} (moved off ${seat}) still installs`);
});
