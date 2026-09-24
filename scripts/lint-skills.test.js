'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('requiring lint-skills does not run the linter and exposes parsers', () => {
    const lint = require('./lint-skills.js');
    assert.strictEqual(typeof lint.manifestFlatSet, 'function');
    assert.strictEqual(typeof lint.manifestSkillMap, 'function');
    assert.strictEqual(typeof lint.manifestFileList, 'function');
    assert.strictEqual(typeof lint.readStackManifest, 'function');
    assert.strictEqual(typeof lint.localSkillDirs, 'function');
    assert.strictEqual(typeof lint.lintEvidenceCatalog, 'function');
    assert.ok(lint.NON_SKILL_TOKENS instanceof Set);
    assert.ok(lint.paths && typeof lint.paths.SKILLS_DIR === 'string');
    // localSkillDirs reads the real skills/ dir - proves the paths resolve.
    assert.ok(lint.localSkillDirs().length > 0);
});

test('lintEvidenceCatalog passes a clean catalog and flags unknown names, unlabeled regex signals, and unknown layers', () => {
    const { lintEvidenceCatalog } = require('./lint-skills.js');
    const rosters = {
        skills: new Set(['dotnet-performance']),
        mcps: new Set(['sentry']),
        plugins: new Set(),
    };

    const clean = {
        _comment: 'x',
        skills: { 'dotnet-performance': { packages: ['BenchmarkDotNet'], content: [{ glob: 'Program.cs', regex: 'x', label: 'x wiring' }] } },
        mcps: { sentry: { packages: ['Sentry.'] } },
        plugins: {},
    };
    assert.deepStrictEqual(lintEvidenceCatalog(clean, rosters), []);

    const bad = {
        rules: { 'baseline-git': {} },   // the scan reads only skills/mcps/plugins
        skills: {
            'dotnet-perf': { packages: ['BenchmarkDotNet'] },   // typo'd name - would silently never match
            'dotnet-performance': { csprojContent: [{ regex: '<X>' }], content: [{ glob: 'a', regex: 'b', label: '  ' }] },
        },
    };
    const findings = lintEvidenceCatalog(bad, rosters);
    assert.strictEqual(findings.length, 4);
    assert.ok(findings.some(f => f.includes("unknown layer 'rules'")));
    assert.ok(findings.some(f => f.includes("skill 'dotnet-perf'")));
    assert.ok(findings.some(f => f.includes('csprojContent signal without a label')));
    assert.ok(findings.some(f => f.includes('content signal without a label')));
});

test('lintPreloadClaims flags body-claimed preloads missing from frontmatter skills:', () => {
    const { lintPreloadClaims } = require('./lint-skills.js');
    const skillDirs = new Set(['typescript', 'angular-conventions', 'ionic', 'angular-styling']);

    // the measured regression shape: body claims four, frontmatter carries one
    const lying = '---\nname: x\nskills:\n  - ionic\n---\n\n- `typescript`, `angular-conventions`, `ionic`, and `angular-styling` are preloaded in frontmatter - the source of truth, not recall.\n';
    const findings = lintPreloadClaims('x.md', lying, skillDirs);
    assert.strictEqual(findings.length, 3);
    assert.ok(findings.every(f => f.includes('is preloaded but the frontmatter')));
    assert.ok(findings.some(f => f.includes('`typescript`')));
    assert.ok(!findings.some(f => f.includes('`ionic`')), 'the declared skill is not flagged');

    // honest file: all named skills declared -> clean
    const honest = lying.replace('skills:\n  - ionic', 'skills:\n  - typescript\n  - angular-conventions\n  - ionic\n  - angular-styling');
    assert.deepStrictEqual(lintPreloadClaims('x.md', honest, skillDirs), []);

    // a non-skill backticked token on the claim line is ignored; no claim line -> clean
    const noClaim = '---\nname: x\nskills:\n  - ionic\n---\n\n- Load `typescript` before the first edit.\n';
    assert.deepStrictEqual(lintPreloadClaims('x.md', noClaim, skillDirs), []);

    // shape A without 'in frontmatter' is still a claim; on-demand loads AFTER the keyword are not
    const bare = '---\nname: x\nskills:\n  - ionic\n---\n\n- `typescript` and `ionic` are preloaded - judge against them directly. Load `angular-styling` on demand.\n';
    const bareFindings = lintPreloadClaims('x.md', bare, skillDirs);
    assert.strictEqual(bareFindings.length, 1);
    assert.ok(bareFindings[0].includes('`typescript`'));

    // shape B ('the preloaded `x` skill') is a claim; namespaced frontmatter entries count as declared
    const shapeB = '---\nname: x\nskills:\n  - superpowers:ionic\n---\n\n- The method is the preloaded `ionic` skill. Also per the preloaded `typescript` hub.\n';
    const bFindings = lintPreloadClaims('x.md', shapeB, skillDirs);
    assert.strictEqual(bFindings.length, 1);
    assert.ok(bFindings[0].includes('`typescript`'));
});

test('lintJudgmentCatalog passes a clean catalog and flags bad refs, missing gaps, bad thresholds', () => {
    const { lintJudgmentCatalog } = require('./lint-skills.js');
    const rosters = {
        skills: new Set(['capacitor-release']),
        agents: new Set(['security-auditor']),
        mcps: new Set(['playwright', 'chrome-devtools', 'angular-cli']),
        plugins: new Set(),
    };
    const clean = {
        _comment: 'x',
        overlaps: [{ items: ['mcp:playwright', 'mcp:chrome-devtools'], shared: 'drive a browser', gaps: { 'mcp:playwright': 'a', 'mcp:chrome-devtools': 'b' } }],
        versionConflicts: [{ item: 'mcp:angular-cli', package: '@angular/core', below: '17', conflict: 'newer-major guidance', survives: 'docs lookups' }],
        occasionBound: { 'skill:capacitor-release': 'release-time', 'agent:security-auditor': 'audit-time' },
    };
    assert.deepStrictEqual(lintJudgmentCatalog(clean, rosters), []);

    const bad = {
        overlaps: [{ items: ['mcp:playwright', 'mcp:chrome-devtool'], shared: '', gaps: { 'mcp:playwright': 'a' } }],
        versionConflicts: [{ item: 'skill:nope', package: '@angular/core', below: 'seventeen', conflict: 'x', survives: 'y' }],
        occasionBound: { 'skill:capacitor-release': '  ' },
    };
    const findings = lintJudgmentCatalog(bad, rosters);
    assert.ok(findings.some(f => f.includes("'mcp:chrome-devtool'")), 'unknown ref flagged');
    assert.ok(findings.some(f => f.includes('no gap')), 'overlap item without its gap flagged');
    assert.ok(findings.some(f => f.includes('shared')), 'empty shared flagged');
    assert.ok(findings.some(f => f.includes("'skill:nope'")), 'unknown versionConflicts item flagged');
    assert.ok(findings.some(f => f.includes("below 'seventeen'")), 'non-integer threshold flagged');
    assert.ok(findings.some(f => f.includes('empty cadence')), 'blank occasionBound cadence flagged');
});

test('optionalSkills is every skill no seed closure reaches', () => {
    const { optionalSkills } = require('./lint-skills.js');
    const recs = {
        always: { skills: ['project-solve-task'], agents: ['security-auditor'] },
        stacks: {
            aspnet: { skills: ['dotnet-architecture'], agents: ['aspnet-implementer'] },
        },
    };
    const graph = {
        agents: {
            'aspnet-implementer': { skills: ['csharp', 'dotnet-testing'] },
            'security-auditor': { skills: [] },
        },
        rules: {},
    };
    const dirs = new Set(['project-solve-task', 'dotnet-architecture', 'csharp', 'dotnet-testing', 'dotnet-architecture-tests', 'postgres']);
    const optional = optionalSkills(recs, graph, dirs);

    // seeded directly, or pulled through a seeded agent -> always installed
    for (const reached of ['project-solve-task', 'dotnet-architecture', 'csharp', 'dotnet-testing'])
    {
        assert.ok(!optional.has(reached), `${reached} is reachable from a seed`);
    }

    // evidence-gated / opt-in only -> an install can lack them
    assert.deepStrictEqual([...optional].sort(), ['dotnet-architecture-tests', 'postgres']);
});

test('absentSkillsFor is the cross-stack case: a skill missing where the citing artifact still ships', () => {
    const { seedClosures, hostStacks, absentSkillsFor } = require('./lint-skills.js');
    const recs = {
        always: { agents: ['security-auditor'], skills: ['docs-as-code'] },
        general: { skills: ['frontend'] },
        stacks: {
            aspnet: { agents: ['aspnet-implementer'] },
            'web-angular': { skills: ['angular-security'], agents: [] },
        },
    };
    const graph = { agents: { 'aspnet-implementer': { skills: ['csharp'] } }, rules: {} };
    const closures = seedClosures(recs, graph);
    const skills = new Set(['csharp', 'angular-security', 'docs-as-code', 'frontend']);

    // an ALWAYS agent ships into every stack, so anything stack-scoped is absent somewhere
    assert.deepStrictEqual([...hostStacks(closures, 'agents', 'security-auditor')].sort(), ['aspnet', 'web-angular']);
    const absent = absentSkillsFor(closures, 'agents', 'security-auditor', skills);
    assert.ok(absent.has('angular-security'), 'the measured shape: a cross-cutting seat naming an Angular skill');
    assert.ok(absent.has('csharp'), 'and the mirror case in the other direction');
    assert.ok(!absent.has('docs-as-code'), 'an always-on skill is present in every stack closure');
    assert.ok(absent.has('frontend'), "the opt-in `general` list seeds no stack, so it is never guaranteed");

    // a stack-scoped seat may name its own stack's skills freely
    const own = absentSkillsFor(closures, 'agents', 'aspnet-implementer', skills);
    assert.ok(!own.has('csharp'), 'its own stack ships csharp');
    assert.ok(own.has('angular-security'), 'but not another stack\'s');

    // 39. An artifact NO seed installs is checked like every other citer, not exempted. It used to
    // return an empty set, which made a citer with no closure the one shape that could name
    // anything; such an artifact can land in ANY project, so only what ships everywhere is
    // guaranteed beside it.
    const optIn = absentSkillsFor(closures, 'agents', 'not-seeded-anywhere', skills);
    assert.ok(optIn.has('csharp') && optIn.has('angular-security') && optIn.has('frontend'),
        'an opt-in citer may not name a stack skill either');
    assert.ok(!optIn.has('docs-as-code'), 'an always-on skill is still guaranteed beside it');
});

test('lintSuggestionEdges blocks the removed `suggests:` frontmatter from coming back', () => {
    const { lintSuggestionEdges } = require('./lint-skills.js');
    // the measured shapes: dotnet-aspire offered to a project with no Aspire, angular-security
    // to a WinForms one - an artifact naming a skill must never reach an install decision
    const withEdge = '---\nname: devops-implementer\nmodel: sonnet\nsuggests:\n  - dotnet-aspire\n---\n\nbody';
    const found = lintSuggestionEdges('agents/devops-implementer.md', withEdge);
    assert.strictEqual(found.length, 1);
    assert.match(found[0], /agents\/devops-implementer\.md declares `suggests:`/);
    assert.match(found[0], /meta\/evidence\.json/, 'the message names the mechanism that replaces it');

    // a clean agent, and the word in prose or in a body line, are not findings
    assert.deepStrictEqual(lintSuggestionEdges('agents/x.md', '---\nname: x\n---\n\nthe log suggests: a stale base'), []);
    assert.deepStrictEqual(lintSuggestionEdges('skills/y/SKILL.md', 'no frontmatter here'), []);
});

test('lintOptionalCites flags a NAMED load of a skill that can be absent; a description passes', () => {
    const { lintOptionalCites } = require('./lint-skills.js');
    const optional = new Set(['dotnet-architecture-tests', 'angular-material']);

    // the measured regression: an unconditional 'add `x`' in a second sentence
    const bare = 'Load the router first. In .NET, add `dotnet-architecture-tests` when judging a boundary.\n';
    const flagged = lintOptionalCites('skills/x/SKILL.md', bare, optional);
    assert.strictEqual(flagged.length, 1);
    assert.match(flagged[0], /skills\/x\/SKILL\.md:1/);
    assert.match(flagged[0], /BY NAME/);

    // A GUARD PHRASE next to the name is no longer the remedy. It made the cite safe to skip,
    // but a project without that skill still learned nothing about what to do instead - and the
    // name is what invites the Skill call in the first place.
    assert.strictEqual(
        lintOptionalCites('f.md', 'Load `dotnet-architecture-tests` only when it is in your skill list.\n', optional).length, 1,
        'naming it and guarding it is still naming it');

    // The remedy: describe what the skill covers, so it is matched from the installed inventory
    // and a seat without it reads what to do anyway.
    assert.deepStrictEqual(
        lintOptionalCites('f.md', 'Load the skill covering architecture fitness tests, if your skill list has one.\n', optional), []);

    // a router-table row under a 'Load' column is a directive too
    const table = '| You are about to... | Load |\n|---|---|\n| build Material UI | `angular-material` |\n';
    assert.strictEqual(lintOptionalCites('f.md', table, optional).length, 1);

    // the header cell only has to END in the word 'load' ('Also load' measured unflagged in 11 rows);
    // 'Payload' is a different word and not a routing column
    const alsoLoad = '| Situation | Also load |\n|---|---|\n| Material UI | `angular-material` |\n';
    assert.strictEqual(lintOptionalCites('f.md', alsoLoad, optional).length, 1, 'an Also-load column is a Load column');
    const payload = '| Field | Payload |\n|---|---|\n| material | `angular-material` |\n';
    assert.deepStrictEqual(lintOptionalCites('f.md', payload, optional), [], 'Payload is not a load column');

    // the flow twins' spelling is a directive; a pointer ('see `x`') and domain prose ('Run migrations') are not
    assert.strictEqual(lintOptionalCites('f.md', 'Re-enter `dotnet-architecture-tests` after the plan changes.\n', optional).length, 1);
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Never bake secrets into the image (see `dotnet-architecture-tests`).\n', optional), []);
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Run migrations before the roll (mechanics in `dotnet-architecture-tests`).\n', optional), []);

    // ... and the one escape: a router hub's explicit Availability callout blankets its table
    const blanketed = '**Availability** - a row whose skill is not installed means the area is absent here.\n' + table;
    assert.deepStrictEqual(lintOptionalCites('f.md', blanketed, optional), []);
    const qualified = '**Availability - required vs optional.** A row not in your skill list means the area is absent.\n' + table;
    assert.deepStrictEqual(lintOptionalCites('f.md', qualified, optional), []);

    // a pointer is not a directive - no load verb in the token's own sentence
    assert.deepStrictEqual(
        lintOptionalCites('f.md', 'Boundary enforcement lives in `dotnet-architecture-tests`.\n', optional), []);

    // The blanket must be DELIBERATE. It used to fire on any line pairing a guard phrase with a
    // common word ('every', 'rows', 'below'), which silenced 13 of 263 files by accident.
    const accidental = 'Every seat reads the docs; a skill not installed is simply absent.\nLoad `angular-material` for Material work.\n';
    assert.strictEqual(lintOptionalCites('f.md', accidental, optional).length, 1);
});

// The usage-policy block ships VERBATIM into every project's generated capabilities rule and is
// never re-fetched, so a project can carry a two-release-old policy with nothing able to notice.
// The stamp is what /alfred-code:validate compares a project's copy against - so it has to be
// true in the source first, and the lint is what keeps it true.
test('check 29: the capabilities usage policy carries a stamp that matches its own block', () =>
{
    const fs = require('node:fs');
    const path = require('node:path');
    const { paths } = require('./lint-skills.js');
    const file = path.join(paths.SKILLS_DIR, 'project-agent-capabilities', 'SKILL.md');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const start = lines.findIndex((l) => l.startsWith('## Usage policy (fixed'));
    assert.ok(start >= 0, 'the stamped block is still where the lint and the skill both look for it');
    const declared = (lines[start + 1].match(/policy-rev:\s*([0-9a-f]{8})/) || [])[1];
    assert.ok(declared, 'the rev line sits directly under the heading, inside the copy target');
    let end = start + 2;
    while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
    const actual = require('crypto').createHash('sha1')
        .update(lines.slice(start + 2, end).join('\n').trim()).digest('hex').slice(0, 8);
    assert.strictEqual(declared, actual, 'the shipped rev is the block\'s own hash - bump it when the policy moves');
    // and validate must look for the same token, or the comparison it prescribes finds nothing
    const val = fs.readFileSync(path.join(paths.ROOT, 'setup-plugin', 'commands', 'validate.md'), 'utf8');
    assert.match(val, /policy-rev: \[0-9a-f\]\*/, 'validate greps for the token this lint maintains');
});

test('check 34: a references/ pointer at a sibling skill must resolve in that sibling; a capability-described one in some skill', () => {
    const { lintReferencePointers } = require('./lint-skills.js');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-refs-'));
    const mk = (d, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, d, rel)), { recursive: true }); fs.writeFileSync(path.join(root, d, rel), body); };
    mk('csharp', 'SKILL.md', '# csharp\n');
    mk('csharp', 'references/concurrency.md', '# c\n');
    mk('dotnet', 'SKILL.md', [
        'own file: `references/own.md`.',
        'good sibling: `csharp` (its `references/concurrency.md`).',
        'dangling sibling: `csharp` (its `references/renamed-away.md`).',
        'described owner, resolves somewhere: the C# skill\'s `references/concurrency.md`.',
        'described owner, nowhere: the C# skill\'s `references/never-existed.md`.',
    ].join('\n'));
    mk('dotnet', 'references/own.md', '# o\n');
    const findings = lintReferencePointers(root, ['csharp', 'dotnet']);
    assert.strictEqual(findings.length, 2, findings.join('\n'));
    assert.match(findings[0], /renamed-away\.md.*csharp.*dangled/);
    assert.match(findings[1], /never-existed\.md.*no skill folder/);
    fs.rmSync(root, { recursive: true, force: true });
});

// 35. The directive shapes that carry no load verb. Each of these was measured passing the
// load-verb scan in the 2026-09-12 audits while routing the reader BY NAME to an absent artifact.
test('check 35: a Companions list, a Points-at line, a routes-to sentence and a route column are directives', () => {
    const { lintOptionalCites } = require('./lint-skills.js');
    const optional = new Set(['dotnet-architecture-tests', 'angular-material', 'dotnet-migrate']);

    // a `Companions:` list in a description - two names, no verb anywhere in the sentence
    const companions = 'Companions: dotnet-migrate (migration mechanics), angular-material (the component library).\n';
    assert.strictEqual(lintOptionalCites('f.md', companions, optional).length, 2);
    assert.strictEqual(lintOptionalCites('f.md', 'Companion skills: dotnet-migrate.\n', optional).length, 1);

    assert.strictEqual(lintOptionalCites('f.md', 'Points at dotnet-migrate and angular-material.\n', optional).length, 2);
    assert.strictEqual(lintOptionalCites('f.md', 'A red routes to dotnet-architecture-tests for the boundary rule.\n', optional).length, 1);
    assert.strictEqual(lintOptionalCites('f.md', 'Migrations route through dotnet-migrate.\n', optional).length, 1);
    assert.strictEqual(lintOptionalCites('f.md', 'That mechanism is dotnet-migrate, which owns the workflow.\n', optional).length, 1);
    assert.strictEqual(lintOptionalCites('f.md', 'The verifier hands off to angular-material for the component review.\n', optional).length, 1);
    assert.strictEqual(lintOptionalCites('f.md', 'The loop dispatches dotnet-architecture-tests on every boundary change.\n', optional).length, 1);

    // a route column is a load column, and the column need not be the last one
    const routeTable = '| Situation | Route |\n|---|---|\n| Material UI | `angular-material` |\n';
    assert.strictEqual(lintOptionalCites('f.md', routeTable, optional).length, 1);
    const firstCol = '| Load | Why |\n|---|---|\n| `angular-material` | Material work |\n';
    assert.strictEqual(lintOptionalCites('f.md', firstCol, optional).length, 1, 'the header cell carries the meaning, not the position');

    // a plain pointer with none of the shapes is still not a directive
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Boundary enforcement lives in dotnet-architecture-tests.\n', optional), []);
    // a single-word roster name is ordinary English unless it is backticked
    const single = new Set(['mobile']);
    assert.deepStrictEqual(lintOptionalCites('f.md', 'Points at mobile work on the device.\n', single), []);
    assert.strictEqual(lintOptionalCites('f.md', 'Points at `mobile` for the shell.\n', single).length, 1);
});

// 36. Seat names follow the skill rule: name a seat only from an artifact installed in every unit
// that installs the seat. The measured shape is an ALWAYS skill routing a red to four per-stack
// resolvers, so every install is missing at least two of them.
test('check 36: an agent name is cited under the same absence rule as a skill name', () => {
    const { lintOptionalCites, optionalAgents, absentAgentsFor, seedClosures } = require('./lint-skills.js');
    const recs = {
        always: { skills: ['project-architecture-quality-loop'] },
        general: { agents: ['related-project-analyzer'] },
        stacks: {
            aspnet: { agents: ['dotnet-build-error-resolver'] },
            'web-angular': { agents: ['ng-build-error-resolver'] },
        },
    };
    const graph = { agents: {}, rules: {} };
    const seats = new Set(['dotnet-build-error-resolver', 'ng-build-error-resolver', 'related-project-analyzer']);

    // the `general` list seeds no stack, so its seat is optional exactly like an opt-in skill
    assert.deepStrictEqual([...optionalAgents(recs, graph, seats)], ['related-project-analyzer']);

    const closures = seedClosures(recs, graph);
    const absent = absentAgentsFor(closures, 'skills', 'project-architecture-quality-loop', seats);
    assert.ok(absent.has('dotnet-build-error-resolver') && absent.has('ng-build-error-resolver'));

    const body = 'A red routes to the matching resolver (dotnet-build-error-resolver / ng-build-error-resolver).\n';
    const found = lintOptionalCites('skills/x/SKILL.md', body, new Set(), { agents: absent });
    assert.strictEqual(found.length, 2);
    assert.match(found[0], /seat can be absent here/, 'the message says seat, not skill');

    // a seat inside the citer's own stack closure passes; another stack's does not
    const own = absentAgentsFor(closures, 'agents', 'dotnet-build-error-resolver', seats);
    assert.ok(!own.has('dotnet-build-error-resolver'), 'its own stack ships it');
    assert.ok(own.has('ng-build-error-resolver'), "but not the other stack's seat");

    // an artifact never names ITSELF into a finding, and a frontmatter preload is a guarantee
    assert.deepStrictEqual(lintOptionalCites('skills/x/SKILL.md', 'Points at dotnet-build-error-resolver.\n', new Set(),
        { agents: absent, self: 'dotnet-build-error-resolver' }), []);
    const preloaded = '---\nname: x\nskills:\n  - dotnet-migrate\n---\n\nLoad dotnet-migrate before the first edit.\n';
    assert.deepStrictEqual(lintOptionalCites('agents/x.md', preloaded, new Set(['dotnet-migrate'])), []);
    // ... and the frontmatter's own keys are a registration, never a directive
    const declaration = '---\nname: x\nskills:\n  - dotnet-migrate\n---\n\nbody\n';
    assert.deepStrictEqual(lintOptionalCites('agents/x.md', declaration, new Set(['dotnet-migrate'])), []);
});

// 37. A plugin-qualified name is a skill the stack does not own and cannot guarantee. Named bare it
// teaches a seat without the plugin nothing at all; the house form pairs it with what it contains.
test('check 37: a plugin-qualified cite carries a content clause, or it is bare', () => {
    const { lintPluginCites } = require('./lint-skills.js');
    const plugins = new Set(['superpowers', 'claude-hud']);

    // the golden form, live in baseline-quality-gates.md - the name, then the clause
    const golden = 'satisfy `superpowers:verification-before-completion` - build + relevant tests run, output quoted - before any done word.\n';
    assert.deepStrictEqual(lintPluginCites('rules/baseline-quality-gates.md', golden, plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Use `superpowers:writing-plans`: the plan format the house writes to.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Localize with `superpowers:systematic-debugging` (one hypothesis at a time, re-run before the next).\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'The loop is one hypothesis at a time - root cause before symptom, and the method is `superpowers:systematic-debugging`.\n', plugins), []);

    // the measured shapes: a name and nothing else
    const bare = lintPluginCites('agents/x.md', '- Follow `superpowers:verification-before-completion` before any done word.\n', plugins);
    assert.strictEqual(bare.length, 1);
    assert.match(bare[0], /agents\/x\.md:1 cites `superpowers:verification-before-completion` BARE/);
    assert.strictEqual(lintPluginCites('f.md', 'Run the method (superpowers:systematic-debugging) first.\n', plugins).length, 1);
    assert.strictEqual(lintPluginCites('f.md', 'the `superpowers:verification-before-completion` gate per task: run it.\n', plugins).length, 1);

    // only real plugin namespaces, and only where the stack has some
    assert.deepStrictEqual(lintPluginCites('f.md', 'status:blocked is not a plugin skill.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Follow `superpowers:writing-plans`.\n', new Set()), []);

    // a frontmatter `skills:` preload is the GUARANTEE shape, not a cite: the skill is injected whole
    // at seat start, a YAML list item cannot carry a content clause, and there is nothing to teach a
    // seat that already holds it. Two seats were permanently red on this line.
    const preload = '---\nname: ci-failure-diagnoser\ntools: Read\nskills:\n  - superpowers:systematic-debugging\n  - project-ci-failure-signatures\n---\n\nYou are a diagnostician.\n';
    assert.deepStrictEqual(lintPluginCites('agents/ci-failure-diagnoser.md', preload, plugins), []);
    // ... and the BODY of that same seat is still scanned
    assert.strictEqual(lintPluginCites('agents/x.md', preload.replace('You are a diagnostician.', 'Run `superpowers:systematic-debugging` and report.'), plugins).length, 1);
    // the description stays in scope - it is shipped prose a router reads, not a registration
    const inDesc = '---\nname: x\ndescription: Use for a red build. Follow `superpowers:systematic-debugging` and report.\nskills:\n  - superpowers:systematic-debugging\n---\n\nbody\n';
    assert.strictEqual(lintPluginCites('agents/x.md', inDesc, plugins).length, 1);
});

// 38. The Availability blanket covers its own section, never the whole file.
test('check 38: an Availability callout blankets its section only', () => {
    const { availabilityCoverage, lintOptionalCites } = require('./lint-skills.js');
    const callout = '**Availability** - a row whose skill is not installed means the area is absent here.';

    // under the file's own `# title` there is no higher heading, so the hub keeps its whole file
    const hub = ['# dotnet (router)', '', callout, '', '## Area', 'row', '## Notes', 'note'];
    assert.deepStrictEqual(availabilityCoverage(hub).filter(Boolean).length, hub.length - 2);

    // under a `##` section it stops at the next `##`
    const scoped = ['# Title', '', '## Routing', callout, 'row', '', '## Elsewhere', 'other'];
    const cov = availabilityCoverage(scoped);
    assert.ok(cov[3] && cov[4] && cov[5], 'its own section is covered');
    assert.ok(!cov[6] && !cov[7], 'the next section of the same level is not');
    assert.ok(!cov[0] && !cov[1] && !cov[2], 'and nothing before the callout is');

    const optional = new Set(['angular-material']);
    const text = ['# Title', '', '## Routing', callout, 'Load `angular-material` for Material work.', '',
        '## Elsewhere', 'Load `angular-material` for Material work.', ''].join('\n');
    const found = lintOptionalCites('f.md', text, optional);
    assert.strictEqual(found.length, 1, 'only the cite outside the blanketed section');
    assert.match(found[0], /f\.md:8/);
});

// 40. Every `tools:` entry resolves to a real tool - a dead grant is silent, so nothing else would
// ever notice it. Names checked against https://code.claude.com/docs/en/tools-reference.
test('check 40: an agent tools: entry must be a real tool name or an mcp__ grant', () => {
    const { lintAgentTools, TOOL_NAMES } = require('./lint-skills.js');
    assert.ok(TOOL_NAMES.has('LSP'), 'LSP is in the tools reference - the audit left this unverified');

    const clean = 'tools: Read, Grep, Glob, LSP, Skill, mcp__plugin_serena_serena__find_symbol, mcp__plugin_playwright-chrome_playwright-chrome__*, mcp__github\n';
    assert.deepStrictEqual(lintAgentTools('agents/x.md', clean), []);
    assert.deepStrictEqual(lintAgentTools('agents/x.md', 'no frontmatter tools line here\n'), []);

    const bad = lintAgentTools('agents/x.md', 'tools: Read, Task, Reed, mcp_serena\n');
    assert.strictEqual(bad.length, 3, bad.join('\n'));
    assert.ok(bad.some(f => f.includes("grants tool 'Task'")), 'a retired spelling is a finding, not an alias');
    assert.ok(bad.some(f => f.includes("grants tool 'Reed'")));
    assert.ok(bad.some(f => f.includes("grants tool 'mcp_serena'")), 'one underscore is not the mcp__ grant shape');
    assert.match(bad[0], /tools-reference/, 'the message names the authority');
});

// 41. A reference over 100 lines opens with a table of contents inside its first 15.
test('check 41: a long reference opens with a table of contents', () => {
    const { lintReferenceContents } = require('./lint-skills.js');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-toc-'));
    const body = (head) => `${head}\n${'line\n'.repeat(120)}`;
    const mk = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, d, rel)), { recursive: true }); fs.writeFileSync(path.join(root, d, rel), text); };
    mk('a', 'references/no-toc.md', body('# Long reference\n\nStraight into the prose.'));
    mk('a', 'references/named-toc.md', body('# Long reference\n\n## Contents\n\n- one\n- two'));
    mk('a', 'references/anchor-toc.md', body('# Long reference\n\n- [One](#one)\n- [Two](#two)'));
    mk('a', 'references/bold-toc.md', body('# Long reference\n\n**Contents**\n\n- one'));
    mk('b', 'references/short.md', `# Short\n${'line\n'.repeat(20)}`);

    const findings = lintReferenceContents(root, ['a', 'b']);
    assert.strictEqual(findings.length, 1, findings.join('\n'));
    assert.match(findings[0], /a\/references\/no-toc\.md: 12[0-9] lines with no table of contents/);
    fs.rmSync(root, { recursive: true, force: true });
});

// 42. An ENUMERATED component array and its directory are two lists that must say the same thing.
test('check 42: the plugin manifest\'s commands array equals the commands directory', () => {
    const { lintPluginComponents } = require('./lint-skills.js');
    const onDisk = { commands: ['setup.md', 'status.md', 'update.md'] };

    const clean = lintPluginComponents({ commands: ['./commands/setup.md', './commands/status.md', './commands/update.md'] }, onDisk);
    assert.deepStrictEqual(clean, [], clean.join('\n'));

    const missing = lintPluginComponents({ commands: ['./commands/setup.md', './commands/status.md', './commands/update.md', './commands/gone.md'] }, onDisk);
    assert.strictEqual(missing.length, 1, missing.join('\n'));
    assert.match(missing[0], /names 'commands\/gone\.md', which is not on disk/);

    const dead = lintPluginComponents({ commands: ['./commands/setup.md', './commands/status.md'] }, onDisk);
    assert.strictEqual(dead.length, 1, dead.join('\n'));
    assert.match(dead[0], /setup-plugin\/commands\/update\.md is not in plugin\.json's `commands` array/);
    assert.match(dead[0], /ships dead in every install/, 'the message says what the cost of the miss is');

    // A field the manifest leaves out is the default directory scan - nothing to reconcile.
    assert.deepStrictEqual(lintPluginComponents({}, onDisk), []);
    // The `./` prefix is the manifest's own spelling, not a difference.
    assert.deepStrictEqual(lintPluginComponents({ commands: ['commands/setup.md', 'commands/status.md', 'commands/update.md'] }, onDisk), []);
});

// 37 (extension). A BARE plugin name is the same class as a bare plugin skill, one level up.
test('check 37: a backticked bare plugin name needs the clause saying what it gives', () => {
    const { lintPluginCites } = require('./lint-skills.js');
    const plugins = new Set(['superpowers', 'claude-md-management', 'csharp-lsp']);

    const flagged = lintPluginCites('skills/x/references/capability-reuse.md', 'Wire the `csharp-lsp` plugin in.\n', plugins);
    assert.strictEqual(flagged.length, 1, flagged.join('\n'));
    assert.match(flagged[0], /names the plugin `csharp-lsp` BARE/);

    // The same content clause that clears a `plugin:skill` cite clears a bare one, either side.
    assert.deepStrictEqual(lintPluginCites('f.md', 'Wire `csharp-lsp` - inline Roslyn diagnostics as each edit lands - into the seat.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Use `claude-md-management` (the audit-and-revise pass over the instruction file) here.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Drift in the instruction file is paid for by every seat - keep it current with `claude-md-management`.\n', plugins), []);

    // Unbackticked prose is not a cite: stack-graph.js reads the backticked token, and the word
    // 'superpowers' is English before it is a plugin.
    assert.deepStrictEqual(lintPluginCites('f.md', 'You have superpowers in this session.\n', plugins), []);
    // A qualified cite is judged once, by the qualified rule, not twice.
    assert.strictEqual(lintPluginCites('f.md', 'Follow `superpowers:writing-plans`.\n', plugins).length, 1);
});

// 28. The verified note must name the plugin its keys were read from, not just any version.
test('check 28: a verified note copied from another plugin is a finding', () => {
    const { lintPluginSettings } = require('./lint-skills.js');
    const roster = new Set(['claude-hud', 'superpowers']);
    const row = (verified) => ({ plugins: { 'claude-hud': { verified, scope: 'account', targets: [{ file: 'plugins/claude-hud/config.json', settings: { display: { a: 1 } }, why: { display: 'x' } }] } } });

    assert.deepStrictEqual(lintPluginSettings(row('claude-hud 0.8.0 - dist/config.js DEFAULT_CONFIG'), roster), []);
    const wrongPlugin = lintPluginSettings(row('superpowers 6.3.0 - dist/config.js'), roster);
    assert.strictEqual(wrongPlugin.length, 1, wrongPlugin.join('\n'));
    assert.match(wrongPlugin[0], /opening with 'claude-hud <version>'/);
    assert.strictEqual(lintPluginSettings(row('0.8.0'), roster).length, 1, 'a bare version does not say which plugin');
});

// 35b. The load verb can come AFTER the name, and only a back-reference makes it a directive.
test('check 35: a trailing load verb with a back-reference is a directive too', () => {
    const { lintOptionalCites } = require('./lint-skills.js');
    const optional = new Set(['dotnet-aspire', 'angular-security']);
    const fires = (t) => lintOptionalCites('x.md', t + '\n', optional).length;

    // The two shapes the 2026-09-12 skills audit measured walking past the scan.
    assert.strictEqual(fires('The boundary rules belong to `dotnet-aspire` - load both alongside this one.'), 1);
    assert.strictEqual(fires('That surface is owned by `angular-security`; reach for it before the edit.'), 1);

    // A pointer is still a pointer: no verb, or a verb whose object is something else.
    assert.strictEqual(fires('Boundary rules live in `dotnet-aspire`.'), 0);
    assert.strictEqual(fires('Mechanics live in `dotnet-aspire`. Load the migration tool first.'), 0,
        'a fresh object in the NEXT sentence is a different artifact, not a back-reference');

    // And the leading form is untouched.
    assert.strictEqual(fires('Load `angular-security` before the edit.'), 1);
});

// 43. Every agent's tools: allowlist must grant the shared memory MCP's store, search and list
// tools - the spec gives every seat search AND save, not just the implementers who already write.
test('check 43: an agent tools: allowlist must grant the shared memory tools', () => {
    const { lintAgentMemoryTools, MEMORY_TOOLS } = require('./lint-skills.js');
    assert.deepStrictEqual(MEMORY_TOOLS, ['mcp__plugin_memory_memory__memory_store', 'mcp__plugin_memory_memory__memory_search', 'mcp__plugin_memory_memory__memory_list']);

    // A fixture agent with serena tools but no memory tools - the new check reports it by file.
    const noMemory = 'tools: mcp__plugin_serena_serena__find_symbol, mcp__plugin_serena_serena__write_memory, mcp__plugin_serena_serena__read_memory, mcp__plugin_serena_serena__list_memories, LSP, Read, Edit, Skill, Bash, Grep, Glob\n';
    const found = lintAgentMemoryTools('agents/fixture.md', noMemory);
    assert.strictEqual(found.length, 1, found.join('\n'));
    assert.match(found[0], /agents\/fixture\.md/);
    assert.match(found[0], /mcp__plugin_memory_memory__memory_store/);
    assert.match(found[0], /mcp__plugin_memory_memory__memory_search/);
    assert.match(found[0], /mcp__plugin_memory_memory__memory_list/);

    // The granted allowlist is clean.
    const granted = 'tools: mcp__plugin_serena_serena__find_symbol, mcp__plugin_serena_serena__write_memory, mcp__plugin_serena_serena__read_memory, mcp__plugin_serena_serena__list_memories, mcp__plugin_memory_memory__memory_store, mcp__plugin_memory_memory__memory_search, mcp__plugin_memory_memory__memory_list, LSP, Read, Edit, Skill, Bash, Grep, Glob\n';
    assert.deepStrictEqual(lintAgentMemoryTools('agents/fixture.md', granted), []);

    // Partial grant still fails, naming only what is missing.
    const partial = 'tools: Read, Grep, Glob, Bash, mcp__plugin_memory_memory__memory_store\n';
    const partialFound = lintAgentMemoryTools('agents/partial.md', partial);
    assert.strictEqual(partialFound.length, 1, partialFound.join('\n'));
    assert.ok(!partialFound[0].includes('mcp__plugin_memory_memory__memory_store,'), 'the already-granted tool is not listed as missing');
    assert.match(partialFound[0], /mcp__plugin_memory_memory__memory_search/);
    assert.match(partialFound[0], /mcp__plugin_memory_memory__memory_list/);

    // No tools: line at all = every tool inherited, memory included - nothing to report.
    assert.deepStrictEqual(lintAgentMemoryTools('agents/fixture.md', 'no frontmatter tools line here\n'), []);
});

test('checks 44 + 45: the real repo passes placement and its entries are current', () => {
    const { lintPluginPlacement } = require('./lint-skills.js');
    assert.deepStrictEqual(lintPluginPlacement(), [],
        'the committed meta/plugin-entries.json must be current');
});

test('check 44: a second plugin, a double home and a lost item are all findings', () => {
    const { lintPluginPlacement } = require('./lint-skills.js');
    const { placement } = require('./plugin-placement.js');

    const second = placement();
    second.plugins['claude-stack-aspnet'] = { skills: [], agents: [], dependencies: [] };
    assert.ok(lintPluginPlacement(second).some(f => /ships plugins other than alfred-code/.test(f)), 'a per-stack plugin is caught');

    const doubled = placement();
    doubled.plugins['alfred-code'].skills.push('dotnet');   // already library
    assert.ok(lintPluginPlacement(doubled).some(f => /skill:dotnet has two homes/.test(f)), 'a duplicated item is caught');

    const lost = placement();
    lost.library.agents = lost.library.agents.filter(a => a !== 'angular-test-resolver');
    assert.ok(lintPluginPlacement(lost).some(f => /agent angular-test-resolver is in no plugin/.test(f)), 'a lost item is caught');
});

test('check 46: the repo root reserves every name a shared-source entry auto-discovers', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');
    const { lintRepoRootReserved, RESERVED_ROOT_NAMES } = require('./lint-skills.js');

    assert.deepStrictEqual(lintRepoRootReserved(), [], 'this repo root is clean');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rootlint-'));
    execFileSync('git', ['-C', tmp, 'init', '-q']);
    assert.deepStrictEqual(lintRepoRootReserved(tmp), [], 'an empty root is clean');

    fs.mkdirSync(path.join(tmp, 'agents'));
    assert.ok(lintRepoRootReserved(tmp).some(f => /`agents`/.test(f)), 'a root agents/ is a finding');

    fs.mkdirSync(path.join(tmp, 'hooks'));
    assert.strictEqual(lintRepoRootReserved(tmp).filter(f => /`hooks`/.test(f)).length, 0,
        'a hooks/ folder with no hooks.json is not auto-discovered');
    fs.writeFileSync(path.join(tmp, 'hooks', 'hooks.json'), '{}');
    assert.ok(lintRepoRootReserved(tmp).some(f => /`hooks`/.test(f)), 'hooks/hooks.json is');

    fs.writeFileSync(path.join(tmp, '.mcp.json'), '{}');
    assert.strictEqual(lintRepoRootReserved(tmp).filter(f => /TRACKED/.test(f)).length, 0,
        'an untracked .mcp.json is this repo\'s own, and fine');
    execFileSync('git', ['-C', tmp, 'add', '.mcp.json']);
    execFileSync('git', ['-C', tmp, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']);
    assert.ok(lintRepoRootReserved(tmp).some(f => /TRACKED `\.mcp\.json`/.test(f)), 'a tracked one is a finding');

    assert.ok(RESERVED_ROOT_NAMES.includes('commands') && RESERVED_ROOT_NAMES.includes('skills'));
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('check 48: the core carries the manifest\'s hook wiring, and every wired hook carries the gate', () => {
    const { lintHooksEntry } = require('./lint-skills.js');
    assert.deepStrictEqual(lintHooksEntry(), [],
        'the committed core entry\'s hooks must match `build-marketplace.js --hooks-entry`');
});

// The fixtures below are the live file with one thing changed, so each finding is that change's.
const liveMarketplace = () => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));

test('check 48: a core missing a stack wiring, or a core with no hooks, is a finding', () => {
    const { lintHooksEntry } = require('./lint-skills.js');
    const lost = liveMarketplace();
    const core = lost.plugins.find((p) => p.name === 'alfred-code');
    core.hooks.Stop = core.hooks.Stop.slice(1);
    assert.ok(lintHooksEntry(lost).some((f) => /core entry's hooks are STALE/.test(f)), 'a dropped Stop hook is caught');
    const none = liveMarketplace();
    none.plugins = none.plugins.filter((p) => p.name !== 'alfred-code');
    assert.ok(lintHooksEntry(none).some((f) => /no `alfred-code` entry/.test(f)), 'no core at all is caught');
});

test('check 49: the two 1.x aliases pass as generated, and a drifted alias, a renames key or a hooks entry fail', () => {
    const { lintMarketplaceEntries } = require('./lint-skills.js');
    const { LEGACY } = require('./install/brand.js');
    assert.deepStrictEqual(lintMarketplaceEntries(liveMarketplace()), [], 'the live file, aliases and all, is clean');

    const drifted = liveMarketplace();
    drifted.plugins.find((p) => p.name === LEGACY.hooks).hooks = { Stop: [] };
    assert.ok(lintMarketplaceEntries(drifted).some((f) => f.includes(`entry ${LEGACY.hooks} does not match the generated one`)), 'an alias edited by hand is drift');

    const missing = liveMarketplace();
    missing.plugins = missing.plugins.filter((p) => p.name !== LEGACY.core);
    assert.ok(lintMarketplaceEntries(missing).some((f) => f.includes(`missing the generated entry ${LEGACY.core}`)), 'a dropped alias strands a 1.x install (S25)');

    const renamed = liveMarketplace();
    renamed.renames = { [LEGACY.core]: 'alfred-code' };
    assert.ok(lintMarketplaceEntries(renamed).some((f) => /`renames` key/.test(f)), 'a renames map is a finding');

    const hooks = liveMarketplace();
    hooks.plugins.push({ name: 'alfred-code-hooks', source: './', description: 'x', hooks: {} });
    assert.ok(lintMarketplaceEntries(hooks).some((f) => /alfred-code-hooks.*folded into the core/.test(f)), 'a hooks entry is a finding');
});

test('check 48: a drifted matcher, a missing file and a missing gate are all findings', () => {
    const build = require('./build-marketplace.js');
    const wirings = build.parseHookWirings();
    const drifted = build.hooksBlock(wirings.map(w => (w.file === 'guard-read-whole-file.js' && w.matcher === 'Read'
        ? { ...w, matcher: 'Read|Glob' } : w)));
    assert.notStrictEqual(JSON.stringify(drifted), JSON.stringify(build.hooksBlock(wirings)),
        'a changed matcher must change the generated block, which is what check 48 compares');

    const ghost = build.hooksBlock([{ file: 'guard-not-here.js', event: 'Stop' }]);
    assert.match(ghost.Stop[0].hooks[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\/guard-not-here\.js"$/,
        'a wiring naming a missing file still generates, so the lint is what catches it');
});

// Check 51. Every route installs the core's cross-marketplace companion itself, so the seed
// (install/plugins.js CORE_DEP_PLUGINS) and the manifest's PARKED (active: false) plugin rows must
// agree - a name added to the seed and not parked in the manifest is a companion the catalog never
// promised; a row parked for no reason the seed acts on installs nothing extra but misleads the walk.
test('check 51: the manifest\'s parked plugins are clean today, and drift in either direction is a finding', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { lintCoreDependencies, paths } = require('./lint-skills.js');
    assert.deepStrictEqual(lintCoreDependencies(), [], 'the shipped manifest already agrees with the seed');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coredep-'));
    const manifestFile = path.join(tmp, 'stack-manifest.json');
    const write = (plugins) => fs.writeFileSync(manifestFile, JSON.stringify({ plugins }));
    const seed = ['superpowers@m'];

    write([{ id: 'superpowers@m', active: false }, { id: 'other@n' }]);
    assert.deepStrictEqual(lintCoreDependencies(manifestFile, seed), [], 'a matching pair is clean');

    write([{ id: 'superpowers@m' }, { id: 'other@n' }]);   // superpowers no longer parked
    assert.match(lintCoreDependencies(manifestFile, seed)[0], /manifest parks \[nothing\]/, 'an un-parked companion is a finding');

    write([{ id: 'superpowers@m', active: false }, { id: 'other@n', active: false }]);
    assert.match(lintCoreDependencies(manifestFile, seed)[0], /manifest parks \[other, superpowers\]/, 'an extra parked row the seed never names is a finding');

    write([{ id: 'other@n', active: false }]);   // the seed names a plugin the manifest never lists
    assert.match(lintCoreDependencies(manifestFile, seed).find((f) => /has no row/.test(f)), /CORE_DEP_PLUGINS names 'superpowers'.*has no row/);

    fs.writeFileSync(manifestFile, 'not json');
    assert.match(lintCoreDependencies(manifestFile, seed)[0], /could not be read/, 'unreadable JSON is a finding, not a crash');

    write([{ id: 'other@n' }]);
    assert.deepStrictEqual(lintCoreDependencies(manifestFile, []),
        ['install/plugins.js CORE_DEP_PLUGINS is empty - the core plugin would lose its cross-marketplace companion.']);

    fs.rmSync(tmp, { recursive: true, force: true });
    assert.ok(paths, 'paths stays exported');
});

// Check 52. Spike S4 proved a plugin bin/ entry lands on PATH on macOS and recorded Windows as NOT
// RUN. The plan's condition is that nothing shipped may depend on one until that check runs.
test('check 52: the repo ships no plugin bin/, and one would be a finding wherever it sits', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { lintNoPluginBin } = require('./lint-skills.js');
    assert.deepStrictEqual(lintNoPluginBin(), [], 'nothing shipped depends on a bin/ entry today');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nobin-'));
    fs.mkdirSync(path.join(tmp, 'stack', 'bin'), { recursive: true });
    assert.match(lintNoPluginBin(tmp)[0], /unproven on Windows/, 'a bin/ under stack is a finding');

    fs.rmSync(path.join(tmp, 'stack', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({ plugins: [{ name: 'x', commands: ['./stack/bin/tool.md'] }] }));
    assert.match(lintNoPluginBin(tmp)[0], /lists .*bin.*under commands/, 'an entry reaching a bin/ path is a finding');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('hiddenChars flags zero-width, bidi, mid-file BOM and tag characters with their line, and keeps a .ps1 BOM', () => {
    const { hiddenChars } = require('./lint-skills.js');
    const at = (text, file = 'x.md') => hiddenChars(text, file).map((h) => `${h.line}:${h.hex}`);
    assert.deepStrictEqual(at('one\ntwo\u200Bthree\n'), ['2:200B'], 'zero-width space');
    assert.deepStrictEqual(at('a\u202Eb\n'), ['1:202E'], 'right-to-left override');
    assert.deepStrictEqual(at('a\nb\nmid\uFEFFfile\n'), ['3:FEFF'], 'a BOM mid-file');
    assert.deepStrictEqual(at('tag \u{E0041} here\n'), ['1:E0041'], 'a tag-block character');
    assert.deepStrictEqual(at('\uFEFFfirst line\n', 'script.ps1'), [], 'a BOM at byte 0 of a .ps1 is PowerShell encoding, kept');
    assert.deepStrictEqual(at('\uFEFFfirst line\n', 'script.js'), ['1:FEFF'], 'a BOM at byte 0 anywhere else is flagged');
    assert.deepStrictEqual(at('plain text with an escape \\u200B written out\n'), [], 'an escape spelled out is not the character');
});

test('lintWorkflows flags script injection, floating third-party actions and a pull_request_target head checkout', () => {
    const { lintWorkflows } = require('./lint-skills.js');
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, 'fixtures', 'workflows');
    const of = (f) => lintWorkflows([{ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') }]);
    const a = of('a-run-injection.yml');
    assert.strictEqual(a.length, 1, 'an event field spliced into run'); assert.match(a[0], /a-run-injection\.yml.*github\.event\.pull_request\.title/);
    assert.deepStrictEqual(of('b-env-passthrough.yml'), [], 'the value through env: is clean');
    const c = of('c-uses.yml');
    assert.strictEqual(c.length, 1, 'only the third-party tag floats'); assert.match(c[0], /some\/action@v3/);
    const d = of('d-pr-target.yml');
    assert.strictEqual(d.length, 1, 'pull_request_target checking out the PR head'); assert.match(d[0], /pull_request_target/);
    assert.deepStrictEqual(lintWorkflows([{ file: 'bad.yml', text: 'jobs: [unclosed' }]).length, 1, 'unparseable YAML is one finding, not a crash');
});

test('lintRetiredNames flags a retired plugin name left in shipped stack text, and the live stack/ carries none', () => {
    const { lintRetiredNames, stackTextFiles } = require('./lint-skills.js');
    const hit = lintRetiredNames([{ file: 'stack/agents/x.md', text: 'one\n- Build lean - the Ponytail full discipline\n' }]);
    assert.strictEqual(hit.length, 1, 'one line, one finding');
    assert.match(hit[0], /stack\/agents\/x\.md:2 .*ponytail.*build lean/i, 'the finding names file:line and the house term');
    assert.deepStrictEqual(lintRetiredNames([{ file: 'stack/agents/y.md', text: '- Build lean: implement the smallest correct version\n' }]), [], 'the house term is clean');
    assert.ok(stackTextFiles().length > 100, 'the walk reaches the shipped tree');
    assert.deepStrictEqual(lintRetiredNames(stackTextFiles()), [], 'no retired plugin name is left under stack/');
});

// Check 27. Task 12 rewrote lintEnvironmentCatalog from a twin-diff to a seed-literal-name diff
// (settings.js's `written:true` rows plus the two special-cased decision keys), and shipped it with
// no committed regression test (review, Minor: "a future edit to this function has nothing pinning
// its negative-case behavior"). Pin every mismatch shape the function actually checks, plus one
// clean pass, the way check 51's test does.
test('check 27: lintEnvironmentCatalog catches catalog/seed/command/migration drift, and a clean set passes', () => {
    const { lintEnvironmentCatalog } = require('./lint-skills.js');

    const commandSrcOk = { init: 'reads meta/environment.json here', configure: 'meta/environment.json', validate: 'meta/environment.json' };
    const baseRows = () => ([
        { key: 'ALFRED_CODE_FOO', default: 'bar', what: 'does foo', written: true },
        { key: 'ALFRED_CODE_DOCS_VERSIONING', default: 'git', what: 'docs versioning' },
        { key: 'ALFRED_CODE_HOOKS_OFF', default: '', what: 'hooks off csv' },
    ]);
    const seedSrcOk = 'ALFRED_CODE_FOO ALFRED_CODE_DOCS_VERSIONING ALFRED_CODE_HOOKS_OFF';
    const migrationsOk = { migrations: [] };

    // Clean pass: consistent catalog, seed, commands and migrations report nothing.
    assert.deepStrictEqual(
        lintEnvironmentCatalog({ env: baseRows() }, seedSrcOk, migrationsOk, commandSrcOk),
        [], 'a fully consistent catalog/seed/migrations/commands set is clean');

    // A guided command that never reads the catalog.
    const badCommandSrc = { ...commandSrcOk, status: 'no catalog mention here' };
    assert.match(
        lintEnvironmentCatalog({ env: baseRows() }, seedSrcOk, migrationsOk, badCommandSrc).find((f) => /^status/.test(f)),
        /status does not read meta\/environment\.json/);

    // `env` is not an array at all.
    assert.deepStrictEqual(
        lintEnvironmentCatalog({ env: 'nope' }, seedSrcOk, migrationsOk, commandSrcOk),
        ['environment.json has no `env` array - the guided commands would read an empty environment layer']);

    // A row with no `key`.
    assert.ok(lintEnvironmentCatalog({ env: [...baseRows(), { default: 'x', what: 'y' }] }, seedSrcOk, migrationsOk, commandSrcOk)
        .includes('environment.json has a row with no `key`'));

    // The same key listed twice.
    assert.ok(lintEnvironmentCatalog({ env: [...baseRows(), { key: 'ALFRED_CODE_FOO', default: 'x', what: 'y' }] }, seedSrcOk, migrationsOk, commandSrcOk)
        .includes('environment.json lists ALFRED_CODE_FOO twice'));

    // No string `default`.
    const noDefault = baseRows().map((r) => (r.key === 'ALFRED_CODE_FOO' ? { key: r.key, what: r.what, written: r.written } : r));
    assert.ok(lintEnvironmentCatalog({ env: noDefault }, seedSrcOk, migrationsOk, commandSrcOk)
        .some((f) => /ALFRED_CODE_FOO has no string `default`/.test(f)));

    // No `what`.
    const noWhat = baseRows().map((r) => (r.key === 'ALFRED_CODE_FOO' ? { key: r.key, default: r.default, written: r.written } : r));
    assert.ok(lintEnvironmentCatalog({ env: noWhat }, seedSrcOk, migrationsOk, commandSrcOk)
        .some((f) => /ALFRED_CODE_FOO has no `what`/.test(f)));

    // written:true but the seed's own source never names the key literally.
    assert.ok(lintEnvironmentCatalog({ env: baseRows() }, 'ALFRED_CODE_DOCS_VERSIONING ALFRED_CODE_HOOKS_OFF', migrationsOk, commandSrcOk)
        .some((f) => /ALFRED_CODE_FOO is marked written, but scripts\/install\/settings\.js never names it literally/.test(f)));

    // A decision key missing from the catalog.
    const noDocsVersioningRow = baseRows().filter((r) => r.key !== 'ALFRED_CODE_DOCS_VERSIONING');
    assert.ok(lintEnvironmentCatalog({ env: noDocsVersioningRow }, seedSrcOk, migrationsOk, commandSrcOk)
        .some((f) => /settings\.js special-cases ALFRED_CODE_DOCS_VERSIONING, which environment\.json does not list/.test(f)));

    // A decision key missing from the seed's own source.
    assert.ok(lintEnvironmentCatalog({ env: baseRows() }, 'ALFRED_CODE_FOO ALFRED_CODE_HOOKS_OFF', migrationsOk, commandSrcOk)
        .some((f) => /ALFRED_CODE_DOCS_VERSIONING is a catalog row, but scripts\/install\/settings\.js does not name it/.test(f)));

    // More than 4 `ask: true` rows blows the AskUserQuestion cap.
    const askRows = ['A', 'B', 'C', 'D', 'E'].map((n) => ({ key: `ALFRED_CODE_${n}`, default: '', what: n, ask: true }))
        .concat([{ key: 'ALFRED_CODE_DOCS_VERSIONING', default: 'git', what: 'x' }, { key: 'ALFRED_CODE_HOOKS_OFF', default: '', what: 'y' }]);
    assert.ok(lintEnvironmentCatalog({ env: askRows }, 'ALFRED_CODE_DOCS_VERSIONING ALFRED_CODE_HOOKS_OFF', migrationsOk, commandSrcOk)
        .some((f) => /asks 5 questions on setup's environment screen/.test(f)));

    // A migration renaming to a key the catalog does not list.
    const migrationsMissing = { migrations: [{ id: 'm1', rename_settings_env: { from: 'OLD_KEY', to: 'ALFRED_CODE_MISSING' } }] };
    assert.ok(lintEnvironmentCatalog({ env: baseRows() }, seedSrcOk, migrationsMissing, commandSrcOk)
        .some((f) => /migrations\.json 'm1' renames OLD_KEY to ALFRED_CODE_MISSING, which environment\.json does not list/.test(f)));

    // A migration landing on a real key whose row disagrees on `renamed_from`.
    const migrationsMismatch = { migrations: [{ id: 'm2', rename_settings_env: { from: 'OLD_FOO', to: 'ALFRED_CODE_FOO' } }] };
    assert.ok(lintEnvironmentCatalog({ env: baseRows() }, seedSrcOk, migrationsMismatch, commandSrcOk)
        .some((f) => /ALFRED_CODE_FOO does not record renamed_from 'OLD_FOO'/.test(f)));
});
