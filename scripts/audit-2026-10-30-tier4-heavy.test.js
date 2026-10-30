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

