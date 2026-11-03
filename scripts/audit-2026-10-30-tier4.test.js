'use strict';
// Audit 2026-10-30, Tier 4 candidates: each test pins one A/B-only candidate's text. The A/B that decides whether it
// helps runs later; a red A/B reverts that id's commit alone, together with its test here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const description = (skill) =>
{
    const m = /^description: "(.*)"$/m.exec(read('stack', 'skills', skill, 'SKILL.md'));
    assert.ok(m, `${skill} has a one-line quoted description`);
    return m[1];
};

test('RU-09: all ten FIRST-action rules carry the compaction clause once, pinned beside the receipt; csharp keeps no own copy', () =>
{
    const squash = (s) => s.replace(/\s+/g, ' ');
    const CLAUSE = 'the receipt is what makes the load happen. A compaction ends the already-in-context skip - a loaded skill outlives one only within a shared budget.';
    const pins = JSON.parse(read('meta', 'shared-rules.json')).rules;
    const homes = (pin) => [pin.owner, ...pin.sites];
    const files = homes(pins['convention-rule-first-action']).map((h) => h.file).sort();
    assert.strictEqual(files.length, 10);
    assert.deepStrictEqual(homes(pins['convention-rule-load-receipt']).map((h) => h.file).sort(), files);
    for (const h of homes(pins['convention-rule-load-receipt']))
        assert.ok(CLAUSE.startsWith(h.marker) && h.marker.includes('A compaction ends the already-in-context skip'), `${h.file}: the pinned marker carries the clause`);
    for (const f of files)
    {
        const text = squash(read(f));
        assert.ok(text.includes(CLAUSE), `${f} carries the clause`);
        assert.strictEqual(text.split('A compaction ends the already-in-context skip').length, 2, `${f} carries it once`);
    }
    const cs = squash(read('stack', 'rules', 'csharp-conventions.md'));
    assert.ok(!cs.includes('the exemption ends at the next compaction'), 'csharp drops its own longer copy');
    assert.ok(cs.includes('Skip the load only when it is already in context this session'), 'the skip itself stays');
});

test('RU-05: moving the data root leaves the always-on docs-root rule for configure\'s data-root step', () =>
{
    const squash = (s) => s.replace(/\s+/g, ' ');
    const rule = read('stack', 'rules', 'alfred-docs-root.md');
    assert.doesNotMatch(rule, /data-root question/, 'the always-on rule no longer carries the move');
    assert.doesNotMatch(rule, /a hand edit to `ALFRED_CODE_DATA_PATH`/);
    // the parts the row would cut that other pins hold stay: the domain list (M97, R5, code-quality) and the ledger line
    assert.match(rule, /EVERY doc the assistant creates/);
    assert.match(rule, /a cleanup keeps them, or its ask names that loss/);
    const configure = squash(read('setup-plugin', 'commands', 'configure.md'));
    const step = configure.slice(configure.indexOf('The DATA ROOT (`ALFRED_CODE_DATA_PATH`)'), configure.indexOf('Claude Code\'s own `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`'));
    assert.ok(step.includes('A hand edit to `ALFRED_CODE_DATA_PATH` instead moves the docs at the next `/alfred-code:update`.'), step.slice(-600));
});

// RU-05 (round 2): the domain line keeps the rule, the capture domains by name and the ad-hoc homes; the paths a capture
// writes inside its domain are the capture skill's to state (moved pins: audit-2026-10-20b R5, code-quality's two, rule-prose
// F11b's awareness list). The structural-doc route stays: F11b's billed probe saw the list send sessions past the capture.
test('RU-05: alfred-docs-root:7 lists the capture domains by name and the ad-hoc homes, the skills keep their own paths', () =>
{
    const { injectedRuleText } = require('./always-on-surface.js');
    const line = injectedRuleText(read('stack', 'rules', 'alfred-docs-root.md')).split('\n').find((l) => /EVERY doc the assistant creates/.test(l));
    assert.ok(line, 'the domain line stays');
    assert.ok(line.includes('lives under ONE root, each capture in the domain folder its skill names (`preferences/`, `awareness/`, `quality/`; '
        + 'a structural doc such as the module boundaries goes into the architecture map as a section through `/capture-awareness architecture`), and the rest in their homes: '), line);
    for (const home of ['ADRs with no home (`decisions/`)', 'ticket drafts (`tickets/`)', 'the explainer\'s saved walkthroughs (`explanations/`)',
        '`plans/`, `specs/`, diagnosis findings in `diagnoses/`, and `cross-project-tasks/` - every doc for another repo, task cards included',
        'A doc outside the root, or outside its domain folder, is invisible to every capture, status and prune step and to the next session.'])
        assert.ok(line.includes(home), `the ad-hoc home stays: '${home}'`);
    for (const gone of ['the install\'s inventory', 'the run book', 'the sibling repos', 'its resources', 'COVERAGE-QUALITY', 'coverage-raw', 'ASSESSMENT', '`loops/`', 'git preferences'])
        assert.ok(!line.includes(gone), `left for the capture skill: '${gone}'`);
    assert.ok(line.length <= 800, `the line is ${line.length} chars (1,191 before)`);
    // each name the line dropped is fixed by the skill that writes it
    assert.match(read('stack', 'skills', 'capture-awareness', 'SKILL.md'), /\| `<docs-path>\/awareness\/RELATED-PROJECTS-AWARENESS\.md` \| the sibling repos and their seams \|/);
    assert.match(description('capture-awareness'), /module boundaries/);
    const quality = read('stack', 'skills', 'capture-quality', 'SKILL.md');
    for (const p of ['`<docs-path>/quality/ARCHITECTURE-ASSESSMENT.md`', '`<docs-path>/quality/CODE-ASSESSMENT.md`', '`<docs-path>/quality/COVERAGE-QUALITY.md`, `<docs-path>/quality/coverage-raw/`'])
        assert.ok(quality.includes(p), `capture-quality names ${p}`);
    assert.match(read('stack', 'rules', 'alfred-preferences.md'), /preferences\//, 'the preferences docs keep their always-on pointer');
});
