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
