'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// F4 item 4: two UNRELATED checks each carried a '// 27.' header - the real check 27 (the removed
// `suggests:` edge, rationale at ~:559, call site 'No install edge from a name...') and the
// environment-catalog check (~:2076, meta/environment.json vs the Node seed), which is its own
// check and must carry its own number. CLAUDE.md then had to hedge with 'not check 27' rather than
// name the real one. This pins both: check 27 stays the suggests-edge check, and the
// environment-catalog check carries the next unused id (58 - checks 1-57 are all spoken for,
// including the historical gap at 17, which a retired check leaves unreused).
test('lint-skills.js: the environment-catalog check and the suggests-edge check no longer share the id 27', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lint-skills.js'), 'utf8');
    const envCatalogHeader = /\/\/ (\d+)\. The environment catalog \(meta\/environment\.json\) against what the Node seed actually/.exec(src);
    assert.ok(envCatalogHeader, 'the environment-catalog check header must still be findable by its own text');
    assert.strictEqual(envCatalogHeader[1], '58', 'the environment-catalog check must carry the next unused id, not 27');

    const suggestsRationale = /\/\/ (\d+)\. No artifact may put a skill into a project's install by NAMING it\./.exec(src);
    const suggestsCallSite = /\/\/ (\d+)\. No install edge from a name: the removed `suggests:` frontmatter must not return\./.exec(src);
    assert.ok(suggestsRationale && suggestsCallSite, 'the suggests-edge check must keep both its rationale and call-site headers');
    assert.strictEqual(suggestsRationale[1], '27');
    assert.strictEqual(suggestsCallSite[1], '27');
});

// F4 re-review N3: CLAUDE.md's Install-stamp row lists who reads a 1.x account-dir stamp, written
// before F1/F2 merged - it omitted stamp.js's own `scope` command (installScope falls back to
// legacyGlobalStamp, A-I1, stamp.js:409/431-434) and the library-stamp.js SessionStart hook (B-I1,
// setup-plugin/hooks/library-stamp.js:39-41).
test('N3: CLAUDE.md names stamp.js scope and library-stamp.js among the 1.x account-dir stamp readers', () => {
    const claudeMd = require('./claude-docs.js').readClaudeDocs();
    const readerLine = /A 1\.x account-dir stamp is read by[^|]*\|/.exec(claudeMd);
    assert.ok(readerLine, 'the Install stamp row must still name its stamp readers');
    assert.match(readerLine[0], /stamp\.js scope/, 'stamp.js scope must be named - it falls back to the legacy account stamp');
    assert.match(readerLine[0], /library-stamp\.js/, 'the library-stamp.js SessionStart hook must be named');
});

// F4 re-review N8: README.md's 'Writes, in the account dir' row must name the account writes every
// `claude plugin install` makes (the plugin cache + installed_plugins.json, at every scope - measured
// repeatedly in docs/rebrand-evidence.md) and the MCP copy route's ~/.claude.json write at user/local
// scope (mcp.js:505-506, alfred-code.js:522), or the 'nothing else is written' sentence below it lies.
test('N8: the install footprint names installed_plugins.json/the plugin cache and .claude.json among the account-dir writes', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'docs', 'install-footprint.md'), 'utf8');
    const acctRow = /## In your account\n[^]*?\n## /.exec(readme);
    assert.ok(acctRow, 'the account-dir writes section must still exist');
    assert.match(acctRow[0], /installed_plugins\.json/, 'the plugin-install bookkeeping file must be named');
    assert.match(acctRow[0], /plugins\/cache/, 'the plugin cache directory must be named');
    assert.match(acctRow[0], /~\/\.claude\.json/, 'the MCP copy route\'s user/local-scope account file must be named');
    assert.match(acctRow[0], /Nothing is written outside the project and the account-dir writes named above/, 'the closing claim must still close this section');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), /\(docs\/install-footprint\.md\)/, 'the README links the footprint');
});

// F4 re-review M-F4-1: the instrument hook is a plain node launch that exits at its switch check (its
// own header, instrument-tool-usage.js), yet the catalog row the walks print to the user still said a
// shell test - the claim item 5 removed everywhere else.
test('M-F4-1: meta/environment.json describes ALFRED_CODE_INSTRUMENT=0 as a node start, never a shell test', () => {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8')).env;
    const row = rows.find((r) => r.key === 'ALFRED_CODE_INSTRUMENT');
    assert.ok(row, 'the instrument row must still exist');
    assert.doesNotMatch(row.what, /shell/, row.what);
    assert.match(row.what, /node start per call/, row.what);
});

// F4 re-review M-F4-2: since C8 every scope writes ALFRED_CODE_MEMORY_DB into settings.local.json, and the
// hook engine reads that file first - its comments still said the key lands in settings.json (the account
// file for a global install), and that only a local-scope install writes the local file.
test('M-F4-2: stack/hooks/memory.js describes the memory path as settings.local.json\'s at every scope', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'memory.js'), 'utf8');
    const block = src.slice(src.indexOf('function memoryEnvPath'), src.indexOf('for (const file of files)', src.indexOf('function settingsDbState')));
    assert.doesNotMatch(block, /in the project's\s*\/\/\s*settings\.json|the only file a local-scope/, 'a pre-C8 layout is still described');
    assert.match(block, /settings\.local\.json at every(\s*\/\/)?\s+scope/, 'the header names the file every scope writes');
});

// F4 re-review M-F4-3: the preload clause is its own sentence, never folded into the MCP-route one. Since
// 2.1.0 a seat's preloads are bare in the source, so CLAUDE.md says the full copy route's re-spell has
// nothing left to do.
test('M-F4-3: CLAUDE.md keeps the preload clause out of the MCP copy-route sentence', () => {
    const claudeMd = require('./claude-docs.js').readClaudeDocs();
    const sentence = /`ALFRED_CODE_MCPS_VIA_PLUGIN=false` restores the 0\.2\.x registration route[^]*?half-fixed\)\./.exec(claudeMd);
    assert.ok(sentence, 'the MCP copy-route sentence must still exist');
    assert.doesNotMatch(sentence[0], /preload/, 'the preload clause still rides the MCP-route sentence');
    assert.match(claudeMd, /`skills:` preloads are bare in the source since 2\.1\.0/, 'the preload spelling names its own rule');
});

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
        mcps: new Set(['playwright']),
        plugins: new Set(),
    };

    const clean = {
        _comment: 'x',
        skills: { 'dotnet-performance': { packages: ['BenchmarkDotNet'], content: [{ glob: 'Program.cs', regex: 'x', label: 'x wiring' }] } },
        mcps: { playwright: { packages: ['@playwright/'] } },
        plugins: {},
    };
    assert.deepStrictEqual(lintEvidenceCatalog(clean, rosters), []);

    const bad = {
        rules: { 'alfred-git': {} },   // the scan reads only skills/mcps/plugins
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

test('lintEvidenceCatalog flags a signal kind the scanner does not read - a typo never matches', () => {
    const { lintEvidenceCatalog } = require('./lint-skills.js');
    const { SIGNAL_KINDS } = require('./scan-evidence.js');
    // `tracked` left with its one row (claude-md-management, retired in 2.0.0): a kind no row reads is dead code.
    assert.deepStrictEqual([...SIGNAL_KINDS].sort(), ['content', 'csprojContent', 'files', 'packages']);
    const rosters = { skills: new Set(), mcps: new Set(), plugins: new Set(['typescript-lsp', 'csharp-lsp']) };
    const every = { plugins: { 'csharp-lsp': Object.fromEntries(SIGNAL_KINDS.map((k) => [k, /content/i.test(k) ? [{ glob: 'a', regex: 'b', label: 'c' }] : ['x']])) } };
    assert.deepStrictEqual(lintEvidenceCatalog(every, rosters), [], 'every kind the scanner reads passes');
    const typo = { plugins: { 'typescript-lsp': { tracked: ['tsconfig.json'] }, 'csharp-lsp': { file: ['*.csproj'], _note: 'x' } } };
    const findings = lintEvidenceCatalog(typo, rosters);
    assert.strictEqual(findings.length, 2, findings.join('\n'));
    assert.ok(findings.some(f => f.includes("plugin 'typescript-lsp' has unknown signal kind 'tracked'")), findings.join('\n'));
    assert.ok(findings.some(f => f.includes("plugin 'csharp-lsp' has unknown signal kind 'file'")), findings.join('\n'));
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
        mcps: new Set(['playwright', 'serena']),
        plugins: new Set(),
    };
    const clean = {
        _comment: 'x',
        overlaps: [{ items: ['mcp:playwright', 'mcp:serena'], shared: 'read the page structure', gaps: { 'mcp:playwright': 'a', 'mcp:serena': 'b' } }],
        versionConflicts: [{ item: 'mcp:serena', package: '@angular/core', below: '17', conflict: 'newer-major guidance', survives: 'docs lookups' }],
        occasionBound: { 'skill:capacitor-release': 'release-time', 'agent:security-auditor': 'audit-time' },
    };
    assert.deepStrictEqual(lintJudgmentCatalog(clean, rosters), []);

    const bad = {
        overlaps: [{ items: ['mcp:playwright', 'mcp:serenaa'], shared: '', gaps: { 'mcp:playwright': 'a' } }],
        versionConflicts: [{ item: 'skill:nope', package: '@angular/core', below: 'seventeen', conflict: 'x', survives: 'y' }],
        occasionBound: { 'skill:capacitor-release': '  ' },
    };
    const findings = lintJudgmentCatalog(bad, rosters);
    assert.ok(findings.some(f => f.includes("'mcp:serenaa'")), 'unknown ref flagged');
    assert.ok(findings.some(f => f.includes('no gap')), 'overlap item without its gap flagged');
    assert.ok(findings.some(f => f.includes('shared')), 'empty shared flagged');
    assert.ok(findings.some(f => f.includes("'skill:nope'")), 'unknown versionConflicts item flagged');
    assert.ok(findings.some(f => f.includes("below 'seventeen'")), 'non-integer threshold flagged');
    assert.ok(findings.some(f => f.includes('empty cadence')), 'blank occasionBound cadence flagged');
});

test('optionalSkills is every skill no seed closure reaches', () => {
    const { optionalSkills } = require('./lint-skills.js');
    const recs = {
        always: { skills: ['alfred-task-solve'], agents: ['security-auditor'] },
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
    const dirs = new Set(['alfred-task-solve', 'dotnet-architecture', 'csharp', 'dotnet-testing', 'dotnet-architecture-tests', 'postgres']);
    const optional = optionalSkills(recs, graph, dirs);

    // seeded directly, or pulled through a seeded agent -> always installed
    for (const reached of ['alfred-task-solve', 'dotnet-architecture', 'csharp', 'dotnet-testing'])
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
    const file = path.join(paths.SKILLS_DIR, 'alfred-capture-agent-capabilities', 'SKILL.md');
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
        always: { skills: ['alfred-loop-architecture-quality'] },
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
    const absent = absentAgentsFor(closures, 'skills', 'alfred-loop-architecture-quality', seats);
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

    // the golden form (alfred-quality-gates.md's until R72 folded the gate in) - the name, then the clause
    const golden = 'satisfy `superpowers:verification-before-completion` - build + relevant tests run, output quoted - before any done word.\n';
    assert.deepStrictEqual(lintPluginCites('rules/alfred-quality-gates.md', golden, plugins), []);
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
    const preload = '---\nname: alfred-issue-diagnoser-ci\ntools: Read\nskills:\n  - superpowers:systematic-debugging\n  - alfred-issue-signatures-ci\n---\n\nYou are a diagnostician.\n';
    assert.deepStrictEqual(lintPluginCites('agents/alfred-issue-diagnoser-ci.md', preload, plugins), []);
    // ... and the BODY of that same seat is still scanned
    assert.strictEqual(lintPluginCites('agents/x.md', preload.replace('You are a diagnostician.', 'Run `superpowers:systematic-debugging` and report.'), plugins).length, 1);
    // the description stays in scope - it is shipped prose a router reads, not a registration
    const inDesc = '---\nname: x\ndescription: Use for a red build. Follow `superpowers:systematic-debugging` and report.\nskills:\n  - superpowers:systematic-debugging\n---\n\nbody\n';
    assert.strictEqual(lintPluginCites('agents/x.md', inDesc, plugins).length, 1);
});

// R72: superpowers is an optional pick, so nothing the stack ships may rest on one of its skills -
// each one it leaned on has a house home now (the done gate, the plan format, the test-first line,
// the clarify gate, alfred-habits-root-cause). History keeps its words; the optional plugin row names the
// plugin, never a skill of it. A `<docs-path>/superpowers/plans/` PATH is the stack's own folder.
test('no shipped text cites a superpowers skill - by qualified name or in prose', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const history = new Set(['meta/migrations.json', 'meta/retired-entries.json', 'meta/retired-plugins.json']);
    const cite = /superpowers:[a-z]/;
    const prose = /superpowers['’]?s? +(systematic-debugging|brainstorm\w*|writing-plans|verification|verify|test-driven|tdd|plan-format|dispatch\w*|subagent-driven|executing-plans)/i;
    const hits = [];
    const walk = (rel) =>
    {
        for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }))
        {
            const r = `${rel}/${e.name}`;
            if (e.isDirectory()) { walk(r); continue; }
            if (history.has(r) || !/\.(md|json|js|ya?ml)$/.test(e.name)) continue;
            fs.readFileSync(path.join(root, r), 'utf8').split('\n').forEach((line, i) =>
            {
                if (cite.test(line) || prose.test(line)) hits.push(`${r}:${i + 1}: ${line.trim().slice(0, 120)}`);
            });
        }
    };
    for (const dir of ['stack', 'setup-plugin', 'meta']) walk(dir);
    assert.deepStrictEqual(hits, [], 'a shipped cite of a superpowers skill');
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

    const clean = 'tools: Read, Grep, Glob, LSP, Skill, mcp__plugin_alfred-navigation_alfred-navigation__find_symbol, mcp__plugin_browser-chrome_browser-chrome__*, mcp__github\n';
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
    const plugins = new Set(['superpowers', 'typescript-lsp', 'csharp-lsp']);

    const flagged = lintPluginCites('skills/x/references/capability-reuse.md', 'Wire the `csharp-lsp` plugin in.\n', plugins);
    assert.strictEqual(flagged.length, 1, flagged.join('\n'));
    assert.match(flagged[0], /names the plugin `csharp-lsp` BARE/);

    // The same content clause that clears a `plugin:skill` cite clears a bare one, either side.
    assert.deepStrictEqual(lintPluginCites('f.md', 'Wire `csharp-lsp` - inline Roslyn diagnostics as each edit lands - into the seat.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'Use `typescript-lsp` (the TypeScript server\'s diagnostics on each edit) here.\n', plugins), []);
    assert.deepStrictEqual(lintPluginCites('f.md', 'A type error is paid for by every seat - catch it on the edit with `typescript-lsp`.\n', plugins), []);

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
    assert.deepStrictEqual(MEMORY_TOOLS, ['mcp__plugin_alfred-memory_alfred-memory__memory_store', 'mcp__plugin_alfred-memory_alfred-memory__memory_search', 'mcp__plugin_alfred-memory_alfred-memory__memory_list']);

    // A fixture agent with serena tools but no memory tools - the new check reports it by file.
    const noMemory = 'tools: mcp__plugin_alfred-navigation_alfred-navigation__find_symbol, mcp__plugin_alfred-navigation_alfred-navigation__write_memory, mcp__plugin_alfred-navigation_alfred-navigation__read_memory, mcp__plugin_alfred-navigation_alfred-navigation__list_memories, LSP, Read, Edit, Skill, Bash, Grep, Glob\n';
    const found = lintAgentMemoryTools('agents/fixture.md', noMemory);
    assert.strictEqual(found.length, 1, found.join('\n'));
    assert.match(found[0], /agents\/fixture\.md/);
    assert.match(found[0], /mcp__plugin_alfred-memory_alfred-memory__memory_store/);
    assert.match(found[0], /mcp__plugin_alfred-memory_alfred-memory__memory_search/);
    assert.match(found[0], /mcp__plugin_alfred-memory_alfred-memory__memory_list/);

    // The granted allowlist is clean.
    const granted = 'tools: mcp__plugin_alfred-navigation_alfred-navigation__find_symbol, mcp__plugin_alfred-navigation_alfred-navigation__write_memory, mcp__plugin_alfred-navigation_alfred-navigation__read_memory, mcp__plugin_alfred-navigation_alfred-navigation__list_memories, mcp__plugin_alfred-memory_alfred-memory__memory_store, mcp__plugin_alfred-memory_alfred-memory__memory_search, mcp__plugin_alfred-memory_alfred-memory__memory_list, LSP, Read, Edit, Skill, Bash, Grep, Glob\n';
    assert.deepStrictEqual(lintAgentMemoryTools('agents/fixture.md', granted), []);

    // Partial grant still fails, naming only what is missing.
    const partial = 'tools: Read, Grep, Glob, Bash, mcp__plugin_alfred-memory_alfred-memory__memory_store\n';
    const partialFound = lintAgentMemoryTools('agents/partial.md', partial);
    assert.strictEqual(partialFound.length, 1, partialFound.join('\n'));
    assert.ok(!partialFound[0].includes('mcp__plugin_alfred-memory_alfred-memory__memory_store,'), 'the already-granted tool is not listed as missing');
    assert.match(partialFound[0], /mcp__plugin_alfred-memory_alfred-memory__memory_search/);
    assert.match(partialFound[0], /mcp__plugin_alfred-memory_alfred-memory__memory_list/);

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
    lost.plugins['alfred-code'].agents = lost.plugins['alfred-code'].agents.filter(a => a !== 'angular-test-resolver');
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

// M21: the plugin reference's standard layout auto-loads more default locations than check 46 listed: `bin/` (on
// the Bash PATH of every entry), `output-styles/`, `workflows/`, `themes/`, and a root SKILL.md (a single-skill
// plugin) - code.claude.com/docs/en/plugins-reference, 'Path behavior rules'. Nothing sits there today.
test('M21 check 46 reserves the default bin, output-styles, workflows and themes folders and a root SKILL.md', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { lintRepoRootReserved, RESERVED_ROOT_NAMES } = require('./lint-skills.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rootlint46-'));
    try
    {
        for (const name of ['bin', 'output-styles', 'workflows', 'themes', 'SKILL.md'])
        {
            assert.ok(RESERVED_ROOT_NAMES.includes(name), `${name} is reserved`);
            const full = path.join(tmp, name);
            if (name.endsWith('.md')) fs.writeFileSync(full, '---\nname: x\n---\n'); else fs.mkdirSync(full);
            assert.ok(lintRepoRootReserved(tmp).some((f) => f.includes(`\`${name}\``)), `a root ${name} is a finding`);
        }
        assert.deepStrictEqual(lintRepoRootReserved(), [], 'this repo root is clean');
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
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
    const drifted = build.hooksBlock(wirings.map(w => (w.file === 'guard-unapproved-dispatch.js' && w.matcher === 'Task|Agent'
        ? { ...w, matcher: 'Task|Agent|Glob' } : w)));
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

    // 2.2.0: no companion at all (claude-hud became a pick) is clean while the manifest parks nothing either.
    write([{ id: 'other@n' }]);
    assert.deepStrictEqual(lintCoreDependencies(manifestFile, []), []);
    write([{ id: 'other@n', active: false }]);
    assert.match(lintCoreDependencies(manifestFile, [])[0], /manifest parks \[other\]/, 'a parked row with no companion is a finding');

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

test('hiddenChars keeps a joiner or direction mark a script needs, and flags the rest of the class wherever it sits', () => {
    // A README emoji built with a ZWJ, or a Persian word with its ZWNJ, was flagged 'write it as an
    // escape', which Markdown and JSON prose cannot do (the 2026-09-26 hooks review).
    const { hiddenChars } = require('./lint-skills.js');
    const at = (text, file = 'x.md') => hiddenChars(text, file).map((h) => `${h.line}:${h.hex}`);
    const ZWJ = '\u200D';
    const ZWNJ = '\u200C';
    assert.deepStrictEqual(at(`dev \u{1F468}${ZWJ}\u{1F4BB} here\n`), [], 'a ZWJ emoji sequence is text');
    assert.deepStrictEqual(at(`\u{1F3F3}\uFE0F${ZWJ}\u{1F308}\n`), [], 'a ZWJ after a variation selector too');
    assert.deepStrictEqual(at(`\u{1F469}\u{1F3FD}${ZWJ}\u{1F4BB}\n`), [], 'and after a skin tone');
    assert.deepStrictEqual(at(`می${ZWNJ}خواهم\n`, 'fa.json'), [], 'a Persian ZWNJ between letters is text');
    assert.deepStrictEqual(at(`שלום\u200F ok\n`), [], 'an RLM beside a Hebrew letter is text');
    assert.deepStrictEqual(at(`a${ZWJ}b\n`), ['1:200D'], 'a ZWJ between ASCII letters is hidden');
    assert.deepStrictEqual(at(`1${ZWJ}2 #${ZWJ}#\n`), ['1:200D', '1:200D'], 'ASCII digits and # are no emoji part');
    assert.deepStrictEqual(at(`\u{1F468}${ZWJ}a\n`), ['1:200D'], 'an emoji on one side only is no sequence');
    assert.deepStrictEqual(at(`\u{1F468}${ZWNJ}\u{1F4BB}\n`), ['1:200C'], 'a ZWNJ between emoji is hidden');
    assert.deepStrictEqual(at('x\u200Ey\n'), ['1:200E'], 'a mark between ASCII letters is hidden');
    assert.deepStrictEqual(at('م\u202Eم\n'), ['1:202E'], 'an override is hidden even between Arabic letters');
    assert.deepStrictEqual(at('é\u200Bé\n'), ['1:200B'], 'a zero-width space is hidden between any letters');
    assert.deepStrictEqual(at(`\u{1F468}${ZWJ}${ZWJ}\u{1F4BB}\n`), ['1:200D', '1:200D'], 'a hidden character never vouches for its neighbour');
    assert.deepStrictEqual(at(`\u{1F3F4}${ZWJ}\u{E0067}\n`), ['1:200D', '1:E0067'], 'nor does a tag character');
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
    // 2.0.0 retired two third-party picks; a skill still pointing at their hooks or commands points at nothing.
    const cut = lintRetiredNames([{ file: 'stack/skills/a/SKILL.md', text: 'pairs with the runtime security-guidance plugin\nkeep it current with claude-md-management\n' }]);
    assert.deepStrictEqual(cut.map((f) => f.replace(/ names .*/, '')), ['stack/skills/a/SKILL.md:1', 'stack/skills/a/SKILL.md:2'], cut.join('\n'));
    assert.match(cut[0], /security-guidance.*\/security-review/, 'the finding names what took its place');
    assert.match(cut[1], /claude-md-management.*AGENTS\.md skill/, 'the finding names what took its place');
    assert.ok(stackTextFiles().length > 100, 'the walk reaches the shipped tree');
    assert.deepStrictEqual(lintRetiredNames(stackTextFiles()), [], 'no retired plugin name is left under stack/');
});

// Check 57. The 1.x spellings are built from these two, so no fixture line below spells one out.
const OLD = 'claude-stack'; // legacy-name
const OLD_ENV = 'CLAUDE_STACK_'; // legacy-name

test('check 57: a 1.x name outside the legacy readers is a finding, named file:line', () => {
    const { lintLegacyNames } = require('./lint-skills.js');
    const of = (file, text) => lintLegacyNames([{ file, text }], { retiredEntries: [`${OLD}-wpf`, `${OLD}-aspnet`, `${OLD}-aspnet-data`] });
    const skill = of('stack/skills/x/SKILL.md', `intro\nrun /${OLD}:update first\n`);
    assert.strictEqual(skill.length, 1, 'one line, one finding');
    assert.match(skill[0], /^stack\/skills\/x\/SKILL\.md:2 /, 'the finding names file:line');
    assert.match(skill[0], /legacy-name/, 'the finding names the way out');
    assert.strictEqual(of('stack/hooks/h.js', `const v = env.${OLD_ENV}MONITOR;\n`).length, 1, 'the env prefix is a 1.x name too');
    assert.strictEqual(of('stack/hooks/h.js', `a ${OLD}\nb ${OLD_ENV}X\nc\n`).length, 2, 'every line is its own finding');
    assert.deepStrictEqual(of('README.md', 'the Cursor twin is cursor-stack\n'), [], 'cursor-stack never matches');
    assert.strictEqual(of('docs/notes.md', `${OLD}\n`).length, 1, 'a docs file that is not evidence is checked');
    assert.strictEqual(of('scripts/install/brand.js', `const X = '${OLD}';\n`).length, 1, 'brand.js outside its LEGACY block is checked');
});

test('check 57: every allowed shape passes - evidence, history files, the retired entries and the marker', () => {
    const { lintLegacyNames } = require('./lint-skills.js');
    const retiredEntries = [`${OLD}-wpf`, `${OLD}-aspnet`, `${OLD}-aspnet-data`];
    const of = (file, text) => lintLegacyNames([{ file, text }], { retiredEntries });
    for (const file of ['docs/rebrand-evidence.md', 'docs/plugin-migration-evidence.md', 'meta/migrations.json', 'meta/retired-entries.json'])
        assert.deepStrictEqual(of(file, `${OLD} and ${OLD_ENV}X\n`), [], `${file} is allowed whole`);
    // brand.js LEGACY and the manifest's retired block carry no allowance of their own: every LEGACY
    // line is marked, and the retired lists hold no 1.x name.
    const brand = `'use strict';\nconst LEGACY = {\n    core: '${OLD}', // legacy-name\n    stamp: '${OLD}.stamp',\n};\n`;
    assert.deepStrictEqual(of('scripts/install/brand.js', brand).map((f) => f.split(' ')[0]), ['scripts/install/brand.js:4'], 'an unmarked LEGACY line is a finding');
    const manifest = `{\n  "retired": {\n    "plugins": [\n      "${OLD}-old"\n    ]\n  }\n}\n`;
    assert.deepStrictEqual(of('meta/stack-manifest.json', manifest).map((f) => f.split(' ')[0]), ['meta/stack-manifest.json:4'], 'the retired block is checked like any other');
    assert.deepStrictEqual(of('scripts/x.test.js', `const home = '${OLD}-wpf';\nconst deny = 'Agent(${OLD}-aspnet-data:seat)';\n`), [], 'a retired per-stack entry name is allowed wherever it appears');
    assert.strictEqual(of('scripts/x.test.js', `const id = '${OLD}-wpf@${OLD}';\n`).length, 1, 'the key beside a retired entry name is still the 1.x key');
    assert.strictEqual(of('scripts/x.test.js', `const id = '${OLD}-wpfx';\n`).length, 1, 'a longer name is not a retired entry');
    assert.deepStrictEqual(of('stack/hooks/h.js', `const old = env.${OLD_ENV}X; // legacy-name\n`), [], 'a marked code line');
    assert.deepStrictEqual(of('CLAUDE.md', `the 1.x \`${OLD}.stamp\` <!-- legacy-name -->\n`), [], 'a marked markdown line');
    assert.deepStrictEqual(of('.github/workflows/w.yml', `cp a ${OLD}.zip # legacy-name - the 1.x fallback\n`), [], 'a marked shell / yaml line');
    assert.deepStrictEqual(of('setup-plugin/references/p.md', `x ${OLD} # a probe; legacy-name: the 1.x cache dir\n`), [], 'the marker with a colon after it');
});

test('check 57: the marker is a whole word in a comment - a line merely containing the letters is checked', () => {
    const { lintLegacyNames } = require('./lint-skills.js');
    const of = (file, text) => lintLegacyNames([{ file, text }], { retiredEntries: [] });
    assert.strictEqual(of('scripts/x.js', `const a = 'my-legacy-names-list ${OLD}';\n`).length, 1, 'a longer word is not the marker');
    assert.strictEqual(of('scripts/x.js', `const a = '${OLD}'; // legacy-names\n`).length, 1, 'a plural in a comment is not the marker');
    assert.strictEqual(of('scripts/x.js', `const a = '${OLD}'; // old-legacy-name\n`).length, 1, 'a prefixed word is not the marker');
    assert.strictEqual(of('scripts/x.js', `const a = 'legacy-name ${OLD}';\n`).length, 1, 'the word outside a comment is not the marker');
});

test('check 57: in the marketplace only the generated plugins[] passes - name, owner and metadata are checked', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { lintLegacyNames } = require('./lint-skills.js');
    const of = (text) => lintLegacyNames([{ file: '.claude-plugin/marketplace.json', text }], { retiredEntries: [] }).map((f) => f.split(' ')[0]);
    const market = [
        '{',
        '  "name": "envoydev",',
        '  "owner": {',
        `    "url": "https://github.com/envoydev/${OLD}"`,
        '  },',
        '  "metadata": {',
        `    "description": "installed via the ${OLD} plugin",`,
        '    "version": "2.0.0"',
        '  },',
        '  "plugins": [',
        '    {',
        `      "name": "${OLD}",`,
        `      "description": "[RETIRED] ] ${OLD} - brackets in a string do not end the list"`,
        '    },',
        `    { "name": "${OLD}-hooks" }`,
        '  ]',
        '}',
        '',
    ].join('\n');
    assert.deepStrictEqual(of(market), ['.claude-plugin/marketplace.json:4', '.claude-plugin/marketplace.json:7'], 'owner.url and metadata.description are findings, every plugins[] line passes');
    // The live file: the plugins[] entries check 49 generates pass, and a 1.x name in the hand-edited
    // metadata is caught.
    const live = fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8');
    assert.deepStrictEqual(of(live), [], 'the committed marketplace is clean');
    const bumped = JSON.parse(live);
    bumped.metadata.description = `installed via the ${OLD} plugin`;
    bumped.owner.url = `https://github.com/envoydev/${OLD}`;
    assert.strictEqual(of(`${JSON.stringify(bumped, null, 2)}\n`).length, 2, 'a hand edit to metadata.description or owner.url is a finding');
});

test('check 57: the walk reads tracked text files, and the live tree carries no unmarked 1.x name', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { lintLegacyNames, repoTextFiles } = require('./lint-skills.js');
    // A tree with no .git (the clean export the gate runs in) is walked: node_modules and binary
    // files are skipped, a text file is read.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint57-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'a.md'), `${OLD}\n`);
        fs.mkdirSync(path.join(dir, 'node_modules'));
        fs.writeFileSync(path.join(dir, 'node_modules', 'b.js'), `${OLD}\n`);
        fs.writeFileSync(path.join(dir, 'c.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(OLD)]));
        const files = repoTextFiles(dir);
        assert.deepStrictEqual(files.map((f) => f.file), ['a.md'], 'only the text file outside node_modules');
        assert.strictEqual(lintLegacyNames(files, { retiredEntries: [] }).length, 1);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }

    const live = repoTextFiles();
    assert.ok(live.length > 300, `the walk reaches the tree (${live.length} files)`);
    assert.deepStrictEqual(lintLegacyNames(live), [], 'every 1.x spelling left is a marked legacy reader or an allowed history file');
});

// Check 27. Task 12 rewrote lintEnvironmentCatalog from a twin-diff to a seed-literal-name diff
// (settings.js's `written:true` rows plus the two special-cased decision keys), and shipped it with
// no committed regression test (review, Minor: "a future edit to this function has nothing pinning
// its negative-case behavior"). Pin every mismatch shape the function actually checks, plus one
// clean pass, the way check 51's test does.
test('check 58: lintEnvironmentCatalog catches catalog/seed/command/migration drift, and a clean set passes', () => {
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

// M31 (check 54): the bare registration spelling of a server the stack RENAMED or RETIRED resolves to nothing too,
// and the check built its pattern from today's names only - the old serena spelling passed it. The fixture lines below
// carry the marker the check skips, which is what a deliberate old spelling in a test does.
test('M31 check 54 flags a renamed or retired server\'s bare spelling, and skips a marked fixture line', () => {
    const { lintMcpToolNames } = require('./lint-skills.js');
    for (const text of ['x mcp__serena__find_symbol y\n', 'mcp__context7__query-docs\n', 'mcp__playwright__browser_navigate\n', // mcp-fixture
        'mcp__playwright-chrome__browser_snapshot\n', 'mcp__sentry__find_issues\n', 'mcp__alfred-navigation__find_symbol\n']) // mcp-fixture
    {
        const hit = lintMcpToolNames({ files: [{ file: 'stack/agents/a.md', text }] });
        assert.strictEqual(hit.length, 1, `${text.trim()}: ${JSON.stringify(hit)}`);
        assert.match(hit[0], /stack\/agents\/a\.md:1 /);
    }
    assert.deepStrictEqual(lintMcpToolNames({ files: [{ file: 'scripts/t.test.js', text: 'mcp__serena__find_symbol // mcp-fixture\n' }] }), [], 'a marked fixture line passes'); // mcp-fixture
    assert.deepStrictEqual(lintMcpToolNames(), [], 'the live tree carries none');
});

// M35 (check 59): the renamed MCP aliases stay LISTED for installs not yet updated, and the nine seats the 1.x core
// alias carries grant their old spellings for that window - on a seat's `tools:` / `disallowedTools:` line only.
// Anywhere else an alias spelling is the stale one check 59 exists for.
test('M35 check 59 lets a seat\'s grant line name a listed alias, and nothing else', () => {
    const { lintStaleMcpToolNames } = require('./lint-skills.js');
    const entries = [{ name: 'alfred-navigation', mcpServers: { 'alfred-navigation': {} } }];
    const aliases = [{ name: 'serena', mcpServers: { serena: {} } }];
    const grant = 'tools: mcp__plugin_alfred-navigation_alfred-navigation__find_symbol, mcp__plugin_serena_serena__find_symbol\n'; // mcp-fixture
    assert.deepStrictEqual(lintStaleMcpToolNames({ entries, aliases, files: [{ file: 'stack/agents/a.md', text: grant }] }), []);
    assert.strictEqual(lintStaleMcpToolNames({ entries, aliases, files: [{ file: 'stack/agents/a.md', text: 'Call `mcp__plugin_serena_serena__find_symbol`.\n' }] }).length, 1, 'a body line'); // mcp-fixture
    assert.strictEqual(lintStaleMcpToolNames({ entries, aliases, files: [{ file: 'stack/skills/x/SKILL.md', text: grant }] }).length, 1, 'a skill'); // mcp-fixture
    assert.strictEqual(lintStaleMcpToolNames({ entries, aliases: [], files: [{ file: 'stack/agents/a.md', text: grant }] }).length, 1, 'an id no alias lists');
});

// M31 (check 62): a pin bump that renames or drops a tool ships a silent drop - check 59 reads only the plugin and
// server part of a spelling. meta/mcp-tools.json records each pinned server's tool names (refresh-mcp-pins.js
// --write), and a shipped plugin spelling whose TOOL is not listed there is a finding; an alias spelling is judged
// by its successor's list, and a wildcard names no tool.
test('M31 check 62 flags a plugin tool spelling whose tool the pinned server does not have', () => {
    const { lintMcpToolsAtPin } = require('./lint-mcp-tools.js');
    const tools = { servers: { 'alfred-memory': { version: '1', tools: ['memory_store', 'memory_search'] }, browser: { version: '1', tools: ['browser_navigate'] }, 'alfred-navigation': { version: '1', tools: ['find_symbol'] } } };
    const ok = 'mcp__plugin_alfred-memory_alfred-memory__memory_store, mcp__plugin_browser-webkit_browser-webkit__browser_navigate, mcp__plugin_browser-chrome_browser-chrome__*\n';
    assert.deepStrictEqual(lintMcpToolsAtPin({ tools, files: [{ file: 'stack/a.md', text: ok }] }), []);
    const bad = lintMcpToolsAtPin({ tools, files: [{ file: 'stack/b.md', text: 'x\nmcp__plugin_alfred-memory_alfred-memory__retrieve_memory\n' }] }); // mcp-fixture
    assert.strictEqual(bad.length, 1);
    assert.match(bad[0], /stack\/b\.md:2 .*retrieve_memory.*memory/);
    const alias = lintMcpToolsAtPin({ tools, files: [{ file: 'stack/c.md', text: 'mcp__plugin_serena_serena__find_symbol mcp__plugin_serena_serena__nope\n' }] }); // mcp-fixture
    assert.strictEqual(alias.length, 1, 'an alias spelling is judged by its successor\'s list');
    assert.deepStrictEqual(lintMcpToolsAtPin({ tools, files: [{ file: 'scripts/t.js', text: 'mcp__plugin_alfred-memory_alfred-memory__nope // mcp-fixture\n' }] }), [], 'a marked fixture line passes');
    assert.deepStrictEqual(lintMcpToolsAtPin(), [], 'every shipped spelling names a tool its pinned server has');
});

// Check 59. A renamed MCP server leaves its old plugin spelling behind in every `tools:` allowlist and
// `ToolSearch select:` line - a spelling check 54 cannot see, since it only bans the BARE form. The
// stale spellings below are fixtures, so each line carries the marker the check skips.
test('lintStaleMcpToolNames flags a plugin tool spelling no shipped server answers, and the live tree carries none', () => {
    const { lintStaleMcpToolNames } = require('./lint-skills.js');
    const entries = [
        { name: 'alfred-memory', mcpServers: { 'alfred-memory': {} } },
        { name: 'browser-chrome', mcpServers: { 'browser-chrome': {} } },
    ];
    const clean = 'tools: mcp__plugin_alfred-memory_alfred-memory__memory_store, mcp__plugin_browser-chrome_browser-chrome__browser_navigate\n'; // mcp-fixture
    assert.deepStrictEqual(lintStaleMcpToolNames({ entries, files: [{ file: 'stack/agents/a.md', text: clean }] }), [], 'shipped spellings pass');
    const stale = 'line one\ntools: mcp__plugin_gone_gone__find_symbol\n'; // mcp-fixture
    const hit = lintStaleMcpToolNames({ entries, files: [{ file: 'stack/agents/b.md', text: stale }] });
    assert.strictEqual(hit.length, 1, 'one stale spelling, one finding');
    assert.match(hit[0], /stack\/agents\/b\.md:2 .*mcp__plugin_gone_gone__.*'gone'/, 'the finding names file:line, the spelling and the plugin'); // mcp-fixture
    const wrongServer = 'mcp__plugin_alfred-memory_other__x\n'; // mcp-fixture
    assert.match(lintStaleMcpToolNames({ entries, files: [{ file: 'meta/x.json', text: wrongServer }] })[0], /'alfred-memory' carries no server 'other'/, 'a server the plugin does not declare');
    const marked = 'mcp__plugin_gone_gone__x // mcp-fixture\n'; // mcp-fixture
    assert.deepStrictEqual(lintStaleMcpToolNames({ entries, files: [{ file: 'scripts/t.test.js', text: marked }] }), [], 'a marked fixture line passes');
    assert.deepStrictEqual(lintStaleMcpToolNames(), [], 'no stale plugin tool spelling under stack/, setup-plugin/, meta/ or scripts/');
});

// Check 60. The inventory page is ONE inline script building every table; a string that does not parse
// (an unescaped double quote in a row) leaves the page blank in the browser, and no other check reads
// the script as code. The check runs `node --check` over each inline script and names the page line.
test('lintPageScripts flags an inline page script node --check refuses, and the live inventory page parses', () => {
    const { lintPageScripts } = require('./lint-skills.js');
    const page = (body) => `<!doctype html>\n<html><body>\n<p>x</p>\n<script>\n${body}\n</script>\n<script src="https://cdn.example.invalid/x.js"></script>\n</body></html>\n`;
    assert.deepStrictEqual(lintPageScripts({ file: 'docs/p.html', html: page('const rows = [\n  ["a", "fine"],\n];') }), [], 'a script that parses passes');
    const broken = lintPageScripts({ file: 'docs/p.html', html: page('const rows = [\n  ["a", "says "quoted" words"],\n];') });
    assert.strictEqual(broken.length, 1, broken.join('\n'));
    assert.match(broken[0], /docs\/p\.html:6 .*node --check.*SyntaxError/, 'the finding names the page line, the tool and the error');
    assert.deepStrictEqual(lintPageScripts({ file: 'docs/p.html', html: '<html><body>no script</body></html>' }), [], 'no inline script, nothing to check');
    assert.deepStrictEqual(lintPageScripts(), [], 'docs/alfred-code.html: its script parses');
});

// Pilot 2 (2026-09-27): the dispatcher's agent listing carried 13.5k chars of descriptions for 30 seats
// in every session's first call. A description is the 'Use when...' sentence plus its 'Do NOT use' clause;
// anything longer belongs in the agent's own body, which only a dispatched seat pays for.
test('an agent description is capped at 300 chars', () =>
{
    const { lintAgentDescription } = require('./lint-skills.js');
    assert.deepStrictEqual(lintAgentDescription('agents/a.md', 'x'.repeat(299)), [], 'one under');
    assert.deepStrictEqual(lintAgentDescription('agents/a.md', 'x'.repeat(300)), [], 'at the cap');
    const over = lintAgentDescription('agents/a.md', 'x'.repeat(301));
    assert.strictEqual(over.length, 1, 'one over');
    assert.match(over[0], /agents\/a\.md description is 301 chars \(> 300\)/);
    assert.deepStrictEqual(lintAgentDescription('agents/a.md', undefined), [], 'no description is check 1\'s finding, not this one');
});

// 2.1.5 M55: the 300-char shape is a 'Use when...' sentence plus its 'Do NOT use' clause, the rest in ONE
// `## Scope` section - code-style-analyzer had no clause, test-coverage-analyzer two Scope headings,
// dotnet-test-failure-resolver none.
test('an agent keeps the 15b shape: a Do NOT use / Not for clause and exactly one ## Scope', () =>
{
    const { lintAgentShape } = require('./lint-skills.js');
    const scope = '## Scope\n\nUse when x.\n\n## Conventions\n- y\n';
    assert.deepStrictEqual(lintAgentShape('agents/a.md', 'Use when x. Do NOT use for y.', scope), [], 'the shape');
    assert.deepStrictEqual(lintAgentShape('agents/a.md', 'Use when x. Not for y.', scope), [], "'Not for' is the other form");
    const noClause = lintAgentShape('agents/a.md', 'Use when x; the capture is its caller.', scope);
    assert.strictEqual(noClause.length, 1);
    assert.match(noClause[0], /agents\/a\.md description has no 'Do NOT use' or 'Not for' clause/);
    const none = lintAgentShape('agents/a.md', 'Use when x. Do NOT use for y.', '## Conventions\n- y\n');
    assert.match(none[0], /agents\/a\.md has 0 '## Scope' sections \(want exactly 1\)/);
    const two = lintAgentShape('agents/a.md', 'Use when x. Do NOT use for y.', `${scope}\n## Scope\n- inputs\n`);
    assert.match(two[0], /has 2 '## Scope' sections/);
    assert.deepStrictEqual(lintAgentShape('agents/a.md', 'Use when x. Do NOT use for y.', '### Scope\n## Scope notes\n'), [
        "agents/a.md has 0 '## Scope' sections (want exactly 1) - the 'Use when...' paragraph and what the 300-char description left out live there",
    ], 'only an exact H2 counts');
    assert.deepStrictEqual(lintAgentShape('agents/a.md', undefined, scope), [], 'no description is check 1\'s finding');
});

// 2.1.5 M57: the inventory page showed architecture-analyzer as 'sonnet · low' for two weeks after its
// frontmatter moved to medium - nothing compared the page's pin badges with the seats.
test('the inventory page shows every seat at its frontmatter pin', () =>
{
    const { lintHtmlSeatPins } = require('./lint-skills.js');
    const pins = new Map([['a-seat', { model: 'sonnet', effort: 'medium' }], ['b-seat', { model: 'opus', effort: 'xhigh' }]]);
    const badge = (seat, model, text) => `<span class="agent x">${seat}<span class="role">r</span><span class="mdl ${model}">${text}</span></span>`;
    const row = (seat, pinned) => `["${seat}", "subagent", "k", "home", "url", "Does a thing. Pinned ${pinned}. More."],`;
    const good = [badge('a-seat', 'sonnet', 'sonnet · medium'), badge('b-seat', 'opus', 'opus · xhigh'), row('a-seat', 'sonnet/medium')].join('\n');
    assert.deepStrictEqual(lintHtmlSeatPins(good, pins), []);
    const stale = lintHtmlSeatPins([badge('a-seat', 'sonnet', 'sonnet · low'), badge('b-seat', 'opus', 'opus · xhigh')].join('\n'), pins);
    assert.strictEqual(stale.length, 1);
    assert.match(stale[0], /badge for 'a-seat' reads 'sonnet · low' but its frontmatter pins sonnet · medium/);
    assert.match(lintHtmlSeatPins(badge('b-seat', 'sonnet', 'opus · xhigh'), pins)[0], /class 'mdl sonnet'/, 'the tier class follows the model');
    assert.match(lintHtmlSeatPins(row('a-seat', 'sonnet/low'), pins)[0], /row for 'a-seat' says 'Pinned sonnet\/low' but its frontmatter pins sonnet\/medium/);
    assert.match(lintHtmlSeatPins(badge('ghost', 'sonnet', 'sonnet · low'), pins)[0], /names 'ghost', which is no seat/);
    assert.deepStrictEqual(lintHtmlSeatPins(), [], 'docs/alfred-code.html: every badge and row at its pin');
});

// 2.1.6 M59: a seat's turn cap is frontmatter too, so the row that states the pin states the cap, and 60b holds
// both ways - a cap the row does not show, a row cap the frontmatter does not set, and a changed number.
test('the inventory row states a seat\'s maxTurns cap exactly when the frontmatter sets one', () =>
{
    const { lintHtmlSeatPins } = require('./lint-skills.js');
    const pins = new Map([['a-seat', { model: 'sonnet', effort: 'medium', maxTurns: 250 }], ['b-seat', { model: 'opus', effort: 'xhigh' }]]);
    const row = (seat, pinned) => `["${seat}", "subagent", "k", "home", "url", "Does a thing. Pinned ${pinned}. More."],`;
    assert.deepStrictEqual(lintHtmlSeatPins([row('a-seat', 'sonnet/medium, max 250 turns'), row('b-seat', 'opus/xhigh')].join('\n'), pins), []);
    assert.match(lintHtmlSeatPins(row('a-seat', 'sonnet/medium'), pins)[0], /row for 'a-seat' shows no turn cap but its frontmatter sets maxTurns: 250/);
    assert.match(lintHtmlSeatPins(row('a-seat', 'sonnet/medium, max 200 turns'), pins)[0], /row for 'a-seat' says 'max 200 turns' but its frontmatter sets maxTurns: 250/);
    assert.match(lintHtmlSeatPins(row('b-seat', 'opus/xhigh, max 100 turns'), pins)[0], /row for 'b-seat' says 'max 100 turns' but its frontmatter sets no maxTurns/);
});

// 2.1.6 M59 (AG M15's check): a seat with a `## Loop` section runs until a gate turns green, so its prose bound
// ('5 cycles', '3 attempts') gets a runaway backstop the runtime enforces - a positive integer maxTurns.
test('a loop seat carries a positive integer maxTurns (15d)', () =>
{
    const { lintAgentTurnCap } = require('./lint-skills.js');
    const loop = '## Scope\n\nx\n\n## Loop (bounded)\n1. build\n';
    assert.deepStrictEqual(lintAgentTurnCap('agents/a.md', { maxTurns: 250 }, loop), [], 'a loop seat with its cap');
    assert.deepStrictEqual(lintAgentTurnCap('agents/a.md', {}, '## Scope\n\nx\n## Method (bounded)\n'), [], 'no Loop section, no cap needed');
    assert.deepStrictEqual(lintAgentTurnCap('agents/a.md', { maxTurns: 100 }, '## Scope\n'), [], 'a cap on a seat with no loop is allowed');
    const missing = lintAgentTurnCap('agents/a.md', {}, loop);
    assert.strictEqual(missing.length, 1);
    assert.match(missing[0], /agents\/a\.md has a '## Loop' section but no maxTurns/);
    for (const bad of [0, -5, 12.5, '250', null])
        assert.match(lintAgentTurnCap('agents/a.md', { maxTurns: bad }, loop)[0], /agents\/a\.md maxTurns must be a positive integer/, String(bad));
    assert.deepStrictEqual(lintAgentTurnCap('agents/a.md', {}, '### Loop\n## Loop notes\n'), [], 'only an exact `## Loop` H2 counts');
});

// 2.1.2 (live check F3, 2026-09-29): a 200K-window session logged 'Skill listing over budget: 39 skills,
// 19901 chars > 8000' - the listing budget is 1% of the context window, so Claude Code dropped the
// descriptions that carry the trigger words. A skill description (plus any `when_to_use`, which the listing
// appends to it) is capped at 160 chars; the rest lives in the skill body.
test('a skill description plus its when_to_use is capped at 160 chars', () =>
{
    const { lintSkillDescription, SKILL_DESC_LIMIT } = require('./lint-skills.js');
    assert.strictEqual(SKILL_DESC_LIMIT, 160);
    assert.deepStrictEqual(lintSkillDescription('skills/a/SKILL.md', 'x'.repeat(159)), [], 'one under');
    assert.deepStrictEqual(lintSkillDescription('skills/a/SKILL.md', 'x'.repeat(160)), [], 'at the cap');
    const over = lintSkillDescription('skills/a/SKILL.md', 'x'.repeat(161));
    assert.strictEqual(over.length, 1, 'one over');
    assert.match(over[0], /skills\/a\/SKILL\.md description is 161 chars \(> 160\)/);
    assert.match(over[0], /## When to use/, 'the finding says where the rest goes');
    assert.deepStrictEqual(lintSkillDescription('skills/a/SKILL.md', 'x'.repeat(100), 'y'.repeat(60)), [], 'description + when_to_use at the cap');
    const both = lintSkillDescription('skills/a/SKILL.md', 'x'.repeat(100), 'y'.repeat(61));
    assert.strictEqual(both.length, 1, 'the listing appends when_to_use, so the pair is what is capped');
    assert.match(both[0], /description \+ when_to_use is 161 chars \(> 160\)/);
    assert.deepStrictEqual(lintSkillDescription('skills/a/SKILL.md', undefined), [], 'no description is check 1\'s finding, not this one');
});

// Review A, M7: the 300-char cut dropped the seat to use instead from three 'Do NOT use' clauses; where the cap has
// room, the alternative is named.
test('a capped agent description still names the seat to use instead', () =>
{
    const yaml = require('js-yaml');
    const desc = (seat) => String(yaml.load(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(__dirname, '..', 'stack', 'agents', `${seat}.md`), 'utf8'))[1]).description);
    for (const [seat, alternative] of [
        ['console-solution-designer', 'windows-service-solution-designer'],
        ['devops-solution-designer', 'alfred-issue-diagnoser-ci'],
        ['data-implementer', 'aspnet-implementer'],
    ])
    {
        const d = desc(seat);
        assert.ok(d.slice(d.indexOf('Do NOT use')).includes(alternative), `${seat}: its Do NOT use clause names ${alternative}`);
        assert.ok(d.length <= 300, `${seat}: ${d.length} chars`);
    }
});

// Check 19 holds BOTH non-default invocation states of the HTML house rows to their frontmatter: "manual" =
// disable-model-invocation, "model-only" = user-invocable false (2.1.6 M128 part 3 - review-216-ab MINOR 3: the
// legend had no word for a skill with no / entry).
test('check 19: the house rows\' "manual" and "model-only" flags match the frontmatter, both ways', () => {
    const { lintInvocationFlags } = require('./lint-skills.js');
    const skills = { manual: new Set(['alfred-task-solve']), modelOnly: new Set(['typescript']) };
    assert.deepStrictEqual(lintInvocationFlags(skills, { houseManual: new Set(['alfred-task-solve']), houseModelOnly: new Set(['typescript']) }), []);
    const missing = lintInvocationFlags(skills, { houseManual: new Set(['alfred-task-solve']), houseModelOnly: new Set() });
    assert.strictEqual(missing.length, 1);
    assert.match(missing[0], /'typescript' misses the "model-only" invocation flag \(its SKILL\.md sets user-invocable: false\)/);
    const stale = lintInvocationFlags(skills, { houseManual: new Set(['alfred-task-solve']), houseModelOnly: new Set(['typescript', 'npm']) });
    assert.strictEqual(stale.length, 1);
    assert.match(stale[0], /marks 'npm' model-only but its SKILL\.md does not set user-invocable: false/);
    assert.strictEqual(lintInvocationFlags(skills, { houseManual: new Set(), houseModelOnly: new Set(['typescript']) }).length, 1, 'the manual half still holds');
});

test('check 19: the live HTML legend names the model-only state and the four flagged rows carry it', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'alfred-code.html'), 'utf8');
    assert.match(html, /model-only = fires on its description, no \/-command \(user-invocable: false\)/);
    const house = html.split('const house = {')[1].split('};')[0];
    const flagged = [...house.matchAll(/\["([a-z0-9-]+)",[^\n]*"model-only"\]/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(flagged, ['dotnet-winforms', 'dotnet-wpf', 'javascript', 'typescript']);
});
