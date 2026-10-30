'use strict';
// Audit 2026-10-30, track T5 (agents + rules): each test names the finding it holds, so a regression reads as the
// audit line it reopens (.alfred/docs/audits/2026-10-30/agents.md, rules.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const agent = (seat) => squash(read(`stack/agents/${seat}.md`));
const descriptionOf = (seat) => (read(`stack/agents/${seat}.md`).match(/^description:\s*"(.*)"\s*$/m) || [])[1] || '';

// AG-01: Microsoft documents RequerySuggested as holding its handlers weakly
// (learn.microsoft.com/en-us/dotnet/api/system.windows.input.commandmanager.requerysuggested), so the trap is a handler
// nothing holds - collected, CanExecute stops re-querying - never a strong handler 'pinning the viewmodel'.
test('AG-01: the WPF pair names the RequerySuggested trap the right way round', () =>
{
    const verifier = agent('wpf-verifier');
    const implementer = agent('wpf-implementer');
    assert.doesNotMatch(verifier, /pins the viewmodel for the app's life/);
    assert.doesNotMatch(verifier, /CollectionChanged\/RequerySuggested subscriptions/);
    assert.match(verifier, /`CommandManager\.RequerySuggested` handler nothing holds\*\* - the static event keeps its handlers as weak references/);
    assert.doesNotMatch(implementer, /\(or `CommandManager\.RequerySuggested`\) subscription never detached/);
    assert.match(implementer, /its `RequerySuggested` holds a handler only weakly, so one you subscribe yourself lives in a field/);
});

// AG-04: the extension implementer writes Vitest fake-chrome tests to a bar its two siblings preload; a load line (not a
// preload - that is a cost change for an A/B) puts the testing skill in front of the first test edit. The browser-extension
// stack seeds `ts-js-testing` (meta/recommendations.json), so naming it is safe (lint 25/26 stay green).
test('AG-04: browser-extension-implementer loads ts-js-testing before the first test edit', () =>
{
    assert.match(agent('browser-extension-implementer'), /Load `ts-js-testing` through the Skill tool before the first test edit/);
    const recs = JSON.parse(read('meta/recommendations.json'));
    assert.ok(recs.stacks['browser-extension'].skills.includes('ts-js-testing'), 'the stack seeds it');
    const head = read('stack/agents/browser-extension-implementer.md').split('\n---')[0];
    assert.doesNotMatch(head, /- ts-js-testing/, 'a load line, not a preload');
});

// AG-05: the preloaded issue-signatures-ci recipe is forge-neutral (`gh`, `glab`, the tool the `Forge:` line names); the
// diagnoser told its gatherers 'via gh', so a GitLab project got the wrong CLI.
test('AG-05: issue-diagnoser-ci and its gatherer pull logs through the forge tool, not via gh', () =>
{
    for (const seat of ['issue-diagnoser-ci', 'evidence-gatherer']) assert.doesNotMatch(agent(seat), /via gh\b|the `gh` log pull/, seat);
    assert.match(agent('issue-diagnoser-ci'), /pull this run's log through the forge tool the session's `Forge:` line names/);
    assert.ok(descriptionOf('issue-diagnoser-ci').length <= 300);
});

// AG-08: review-security can be switched off per project (skillOverrides), so the auditor's drop pass names its absent path.
test('AG-08: security-auditor says what to do when not-a-finding.md is absent', () =>
{
    assert.match(agent('security-auditor'), /not-a-finding\.md` and drop what it lists; .* Absent \(the project switched `review-security` off\): skip the drop pass and say `not-a-finding: unavailable`/);
});

// AG-10: since audit 2026-10-20 A-T1 the read-only seat gate (READ_ONLY_SEAT matches `*-analyzer`) denies a literal write
// target outside the temp dirs; only a run-time-expanded one passes.
test('AG-10: related-project-analyzer states the guard gap that is real', () =>
{
    const text = agent('related-project-analyzer');
    assert.match(text, /a target the shell expands at run time passes every guard/);
    assert.match(read('stack/hooks/shell-guards.js'), /\[a-z\]\[\\w-\]\*-analyzer/, 'the gate still covers the analyzers');
});

// AG-11: the LSP is already the first rank of the navigation sentence; 'or the LSP' after it was a server-era remnant.
test('AG-11: dotnet-build-error-resolver names the LSP once in its navigation line', () =>
{
    assert.doesNotMatch(agent('dotnet-build-error-resolver'), /reported as name-matched\) or the LSP/);
});

// AG-12: the three analyzers hold no handoff instruction, so 'write any handoff note first' was vacuous there; the pinned
// handback clause (verifier-memory-before-report) stays.
test('AG-12: the three analyzers drop the vacuous handoff-note clause and keep the handback clause', () =>
{
    for (const seat of ['code-style-analyzer', 'test-coverage-analyzer', 'related-project-analyzer'])
    {
        const text = agent(seat);
        assert.doesNotMatch(text, /write any handoff note first/, seat);
        assert.doesNotMatch(text, /handoff\.js (put|list)/, `${seat}: still no handoff bus, so no note to write`);
        assert.match(text, /Your report IS the deliverable - deliver the report as your final hand-off - through SubagentHandback when your tools include it, else as your last message; nothing after it/, seat);
    }
});

// AG-13: every sibling gatherer bounds its return in tokens; code-style-analyzer fans out one dispatch per language.
test('AG-13: code-style-analyzer bounds its return by lines and tokens', () =>
{
    assert.match(agent('code-style-analyzer'), /120 lines and ~1\.5k tokens at most in total/);
});
