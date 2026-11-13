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
        if (/the navigation tools your start line orders/.test(body)) assert.match(body, /the `alfred-navigation\.md` rule/, `${s}: the pointer`);   // stage 4c: rules live in the store
    }
});
