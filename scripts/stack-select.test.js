'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { computeClosure } = require('./stack-select.js');
const graph = require('../meta/stack-graph.json');

test('--check always names its verdict, clean or not', () => {
    // A clean check printed NOTHING at all, and silence is the one result a caller cannot tell
    // from a call that never ran - the guided walks report the prerequisite verdict to the user,
    // and an empty tool result left them narrating 'no blockers' from the exit code alone.
    const fs = require('node:fs');
    const os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
    const sel = path.join(dir, 'raw.json');
    fs.writeFileSync(sel, JSON.stringify({ skills: ['csharp'], rules: [], agents: [], mcps: [], plugins: [], hooks: [] }));
    const r = spawnSync(process.execPath, [path.join(__dirname, 'stack-select.js'), '--selection', sel, '--check'], { encoding: 'utf8' });
    assert.match(r.stdout, /^prereqs: (ok|BLOCKED) - \d+ blocker\(s\), \d+ warning\(s\)$/m, 'the verdict line is always printed');
    assert.strictEqual(r.status === 0, /prereqs: ok/.test(r.stdout), 'the exit code and the line agree');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('an agent pulls its declared skills and plugins; body mentions pull nothing', () => {
    const c = computeClosure(graph, { agents: ['aspnet-solution-designer'] });
    for (const s of ['csharp-design-patterns', 'dotnet-web-backend', 'dotnet-testing'])
    {
        assert.ok(c.skills.includes(s), `expected skill ${s} pulled by aspnet-solution-designer's frontmatter`);
    }
    assert.match(c.reasons['dotnet-web-backend'], /aspnet-solution-designer/);
    // The dotnet ROUTER is deliberately not preloaded by the designers any more (a router beside its
    // own leaves cost ~15k chars per dispatch); it reaches the install through the C# stack seeds.
    assert.ok(!c.skills.includes('dotnet'), 'the dotnet router is no longer an agent edge');
    // aspnet-implementer preloads its operative stack skills via skills: frontmatter (the
    // prose-instructed loads fired in 0 of 5 seats in one measured session while every
    // frontmatter preload landed). A per-task surface pick it merely NAMES in the body is no
    // edge at all - naming a skill must never reach an install decision - and a body-sourced
    // agent still locks nothing.
    const impl = computeClosure(graph, { agents: ['aspnet-implementer'] });
    for (const s of ['csharp', 'dotnet-web-backend', 'dotnet-web-error-handling', 'dotnet-data-access', 'dotnet-testing'])
    {
        assert.ok(impl.skills.includes(s), `the frontmatter preload '${s}' is a hard edge`);
    }
    assert.strictEqual(graph.agents['aspnet-implementer'].suggests, undefined, 'the suggests edge is removed from the graph');
    assert.ok(!impl.skills.includes('dotnet-minimal-api'), 'a per-task surface pick named in the body is not pulled');
    // The minimal-code plugin was dropped from the stack in 0.2.74 (a standing contradiction with
    // the house no-marker rule, 0 invocations in 115 sessions, and its ladder already inline in 34
    // agent bodies), so the seat's discipline paragraph is now its only home and pulls no plugin.
    assert.deepStrictEqual(impl.plugins, [], 'the implementer carries its discipline inline and pulls no plugin');
    const resolver = computeClosure(graph, { agents: ['dotnet-build-error-resolver'] });
    assert.deepStrictEqual(resolver.skills, [], 'a body-sourced agent locks no skills');
});

test('a rule pulls its skills', () => {
    const c = computeClosure(graph, { rules: ['csharp-conventions'] });
    assert.ok(c.skills.includes('csharp'));
    assert.match(c.reasons['csharp'], /csharp-conventions/);
});

test('a kept rule makes its mcp required; the capabilities skill locks none', () => {
    const c = computeClosure(graph, { rules: ['baseline-navigation'] });
    assert.ok(c.mcps.includes('serena'), 'baseline-navigation genuinely depends on serena');
    // The routing-map mentions in project-agent-capabilities are subject matter, not needs -
    // picking it must never lock the whole MCP baseline into an install.
    const cap = computeClosure(graph, { skills: ['project-agent-capabilities'] });
    assert.deepStrictEqual(cap.mcps, [], 'the capabilities skill pulls no MCPs');
});

// memory is locked the SAME way serena is: baseline-memory.md names the server in backticks, the
// graph picks up the body mention as a rule -> mcp edge, and recommendations.json's `always` set
// keeps the rule (so the closure of every install requires the mcp) while `general` drops it - a
// server cannot be both offered-not-seeded and locked at once.
test('memory is locked like serena - baseline-memory pulls it in, general no longer offers it', () => {
    const c = computeClosure(graph, { rules: ['baseline-memory'] });
    assert.ok(c.mcps.includes('memory'), 'baseline-memory genuinely depends on the memory mcp');
    const recommendations = require('../meta/recommendations.json');
    assert.ok((recommendations.always.rules || []).includes('baseline-memory'), 'baseline-memory is an always-on rule');
    assert.ok((recommendations.always.mcps || []).includes('memory'), 'memory is locked into every install');
    assert.ok(!((recommendations.general || {}).mcps || []).includes('memory'), 'memory left the general (addable) list');
});

test('hooks are leaf picks: kept as-is, emitted, and checked against the catalog', () => {
    const c = computeClosure(graph, { hooks: ['guard-catastrophic-rm'] });
    assert.deepStrictEqual(c.hooks, ['guard-catastrophic-rm'], 'a picked hook survives the closure untouched');
    const { emitSelectionFile, findUnknownNames } = require('./stack-select.js');
    assert.ok(emitSelectionFile(c).includes('hook guard-catastrophic-rm'), 'the hook reaches the emitted selection');
    const unknown = findUnknownNames(graph, { hooks: ['guard-catastrophic-rm', 'no-such-hook'] });
    assert.deepStrictEqual(unknown, [{ category: 'hook', name: 'no-such-hook' }], 'an unknown hook is flagged');
});

test('a hooks layer ANSWERED with no pick emits the explicit none line; an unanswered one emits nothing', () => {
    const { emitSelectionFile } = require('./stack-select.js');
    const c = computeClosure(graph, { hooks: [] });
    // Without a hook line the installer reads 'every hook' - the pre-hooks-layer default - so a
    // walk whose user picked None must say so, or every hook runs.
    assert.ok(/^hook none$/m.test(emitSelectionFile(c, { hooksAnswered: true })), 'None at the hooks layer is written down');
    // validate and configure emit from a disk inventory, which on the plugin route carries no hook
    // files at all - that must stay 'not answered', never 'switch all thirteen off'.
    assert.ok(!/^hook /m.test(emitSelectionFile(c)), 'no flag, no hook line');
    const picked = computeClosure(graph, { hooks: ['guard-catastrophic-rm'] });
    assert.ok(!/^hook none$/m.test(emitSelectionFile(picked, { hooksAnswered: true })), 'a real pick never carries the none line');
});

test('--hooks-answered reaches the emitted file through the CLI', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-answered-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify({ hooks: [] }));
        const emit = (extra) => { const out = path.join(dir, 'sel.txt'); execFileSync(process.execPath, [path.join(__dirname, 'stack-select.js'), '--selection', path.join(dir, 'raw.json'), '--emit', out, ...extra], { encoding: 'utf8' }); return fs.readFileSync(out, 'utf8'); };
        assert.ok(/^hook none$/m.test(emit(['--hooks-answered'])));
        assert.ok(!/^hook /m.test(emit([])));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('raw.mcps are direct picks the closure keeps and emits', () => {
    const c = computeClosure(graph, { mcps: ['playwright'] });
    assert.ok(c.mcps.includes('playwright'), 'a directly chosen mcp survives the closure');
    assert.strictEqual(c.reasons['playwright'], undefined, 'a direct mcp pick is not a closure add');
    const { emitSelectionFile } = require('./stack-select.js');
    assert.ok(emitSelectionFile(c).includes('mcp playwright'), 'the direct mcp reaches the emitted selection');
});

test('user-chosen items carry no reason; only closure-added ones do', () => {
    const c = computeClosure(graph, { skills: ['csharp'] });
    assert.ok(c.skills.includes('csharp'));
    assert.strictEqual(c.reasons['csharp'], undefined, 'a directly chosen item is not a closure add');
});

test('empty selection yields empty closure', () => {
    const c = computeClosure(graph, {});
    assert.deepStrictEqual(c, { skills: [], agents: [], rules: [], mcps: [], plugins: [], hooks: [], reasons: {} });
});

test('a non-array raw field does not char-split into bogus items', () => {
    const c = computeClosure(graph, { skills: 'csharp' });   // scalar, not an array
    assert.deepStrictEqual(c.skills, [], 'a scalar skills field yields no skills, not per-character entries');
    assert.ok(!c.skills.includes('c') && !c.skills.includes('s'), 'no single-character bogus skills');
});

// An installed name a new release no longer ships (retired or renamed upstream) must be
// reported and excluded, not silently passed through to per-file installer failures -
// the update/configure skills key their retirement handling on the `unknown:` lines.
const { findUnknownNames, dropUnknownNames } = require('./stack-select.js');

test('unknown selection names are detected per category and dropped', () => {
    const raw = { skills: ['csharp', 'totally-retired-skill'], agents: ['no-such-agent'], rules: [], mcps: ['serena', 'no-such-mcp'], plugins: [] };
    const unknown = findUnknownNames(graph, raw);
    assert.deepStrictEqual(unknown, [
        { category: 'skill', name: 'totally-retired-skill' },
        { category: 'agent', name: 'no-such-agent' },
        { category: 'mcp', name: 'no-such-mcp' },
    ]);
    const filtered = dropUnknownNames(raw, unknown);
    assert.deepStrictEqual(filtered.skills, ['csharp']);
    assert.deepStrictEqual(filtered.agents, []);
    assert.deepStrictEqual(filtered.mcps, ['serena']);
    assert.ok(!computeClosure(graph, filtered).skills.includes('totally-retired-skill'));
});

test('CLI: an unknown name prints an unknown: line and never reaches the emitted selection', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacksel-'));
    const rawFile = path.join(dir, 'raw.json');
    const emitFile = path.join(dir, 'sel.txt');
    fs.writeFileSync(rawFile, JSON.stringify({ skills: ['csharp', 'totally-retired-skill'], agents: [], rules: [], plugins: [] }));
    try
    {
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json'), '--emit', emitFile], { encoding: 'utf8' });
        assert.match(out, /unknown: skill 'totally-retired-skill'/, 'the retirement is named on stdout');
        const emitted = fs.readFileSync(emitFile, 'utf8');
        assert.ok(emitted.includes('skill csharp'), 'known names still emit');
        assert.ok(!emitted.includes('totally-retired-skill'), 'the unknown name is excluded from the emitted selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const { evaluatePrereqs } = require('./stack-select.js');

const fullEnv = { bins: { node: true, npx: true, git: true, claude: true, uvx: true, dotnet: true, 'csharp-ls': true }, envs: { CONTEXT7_API_KEY: true } };
const emptyEnv = { bins: {}, envs: {} };

test('phase-1 hard prereqs are blockers when the binary is absent', () => {
    const r = evaluatePrereqs({ skills: [], mcps: [], plugins: [] }, emptyEnv, {});
    const needs = r.blockers.map(b => b.need).join(' ');
    for (const label of ['Node.js', 'git', 'Claude Code CLI', 'uv (uvx)'])
    {
        assert.ok(needs.includes(label), `expected hard blocker ${label}`);
    }
    assert.strictEqual(r.ok, false);
});

test('playwright keeping msedge warns when Edge is not installed; the other engines never ask for it', () => {
    // msedge is the one kept engine that uses a browser the machine must already carry and that
    // no default install has everywhere; firefox/webkit are downloaded by the installer itself.
    const sel = { skills: [], mcps: ['playwright'], plugins: [] };
    const bins = { node: true, npx: true, git: true, claude: true, uvx: true };
    const edge = r => r.warnings.some(w => /Microsoft Edge/.test(w.need));
    assert.ok(edge(evaluatePrereqs(sel, { bins, envs: {} }, { playwrightBrowsers: ['chrome', 'msedge'] })), 'msedge kept without Edge warns');
    assert.ok(!evaluatePrereqs(sel, { bins, envs: {} }, { playwrightBrowsers: ['msedge'] }).blockers.length, '... and never blocks');
    assert.ok(!edge(evaluatePrereqs(sel, { bins: { ...bins, msedge: true }, envs: {} }, { playwrightBrowsers: ['msedge'] })), 'Edge present is clean');
    for (const other of [undefined, [], ['chrome'], ['firefox', 'webkit']])
        assert.ok(!edge(evaluatePrereqs(sel, { bins, envs: {} }, { playwrightBrowsers: other })), `${JSON.stringify(other)} never asks for Edge`);
    assert.ok(!edge(evaluatePrereqs({ skills: [], mcps: [], plugins: [] }, { bins, envs: {} }, { playwrightBrowsers: ['msedge'] })), 'no playwright selected, no Edge warning');
});

test('installed playwright-<engine> servers read back as the one manifest entry', () => {
    const { normalizeInventory } = require('./stack-select.js');
    const inv = normalizeInventory({ mcps: ['serena', 'playwright-chrome', { name: 'playwright-firefox' }, 'playwright', 'playwright-extra'] });
    assert.deepStrictEqual(inv.mcps, ['serena', 'playwright', 'playwright-extra'], 'engine servers collapse to playwright; a non-engine name is left alone');
});

test('a .NET skill without the dotnet SDK is a blocker', () => {
    const r = evaluatePrereqs({ skills: ['dotnet-web-backend'], mcps: [], plugins: [] }, { bins: { node: true, npx: true, git: true, claude: true, uvx: true }, envs: {} }, {});
    assert.ok(r.blockers.some(b => /\.NET SDK/.test(b.need)), 'dotnet SDK blocker for a dotnet-* skill');
});

test('full env with no risky selection is clean', () => {
    const r = evaluatePrereqs({ skills: ['csharp'], mcps: [], plugins: [] }, fullEnv, {});
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.blockers, []);
});

test('computeClosure follows an agent->agent chain and terminates on a cycle', () => {
    const g = {
        skills: { s1: { mcps: [], plugins: [] }, s2: { mcps: [], plugins: [] } },
        agents: {
            a1: { skills: ['s1'], skillsSource: 'x', agents: ['a2'], mcps: [], plugins: [] },
            a2: { skills: ['s2'], skillsSource: 'x', agents: ['a1'], mcps: [], plugins: [] }, // cycle back to a1
        },
        rules: {}, catalog: { mcps: [], plugins: [] },
    };
    const c = computeClosure(g, { agents: ['a1'] });
    assert.ok(c.agents.includes('a2'), 'a1 pulls a2');
    assert.ok(c.skills.includes('s1') && c.skills.includes('s2'), 'skills pulled through the agent chain');
    // if this test returns at all, the cycle terminated
});

const { emitSelectionFile } = require('./stack-select.js');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

test('emitSelectionFile produces Component B selection lines', () => {
    const text = emitSelectionFile({ skills: ['csharp'], agents: ['aspnet-implementer'], rules: ['csharp-conventions'], mcps: ['serena'], plugins: ['csharp-lsp'] });
    const lines = text.trim().split('\n');
    assert.ok(lines.includes('skill csharp'));
    assert.ok(lines.includes('agent aspnet-implementer'));
    assert.ok(lines.includes('mcp serena'));
    assert.ok(lines.includes('plugin csharp-lsp'));
    assert.ok(lines.includes('rule csharp-conventions'));
});

test('CLI prints a clean error and exits 1 on a missing selection file', () => {
    const r = require('node:child_process').spawnSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', '/no/such/raw.json'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /cannot read selection/);
    assert.ok(!/at Object\.|at Module\./.test(r.stderr), 'no raw stack trace');
});

// The configure skill's cascade: dropping an item offers what it alone pulled
// in (orphans), while anything a kept item still needs stays locked.
const { findOrphans } = require('./stack-select.js');

// r1 -> a1 -> s1 -> m1; r2 -> s1; s2 is a free-standing direct pick.
const orphanGraph = {
    skills: { s1: { mcps: ['m1'], plugins: [] }, s2: { mcps: [], plugins: [] } },
    agents: { a1: { skills: ['s1'], skillsSource: 'x', agents: [], mcps: [], plugins: [] } },
    rules: {
        r1: { skills: [], agents: ['a1'], mcps: [], plugins: [] },
        r2: { skills: ['s1'], agents: [], mcps: [], plugins: [] },
    },
    catalog: { mcps: ['m1'], plugins: [] },
};
const orphanInstalled = computeClosure(orphanGraph, { rules: ['r1', 'r2'], skills: ['s2'] });

test('a dropped rule orphans only what nothing kept still needs', () => {
    const remaining = { ...orphanInstalled, rules: ['r2'] };
    const orphans = findOrphans(orphanGraph, remaining, { rules: ['r1'] });
    assert.deepStrictEqual(orphans.map(o => `${o.category} ${o.name}`), ['agent a1'], 'a1 was only r1\'s; s1 and m1 stay - r2 still needs them');
    assert.match(orphans[0].why, /required by rule r1/);
});

test('dropping every dependent cascades transitively; direct picks never orphan', () => {
    const remaining = { ...orphanInstalled, rules: [] };
    const names = findOrphans(orphanGraph, remaining, { rules: ['r1', 'r2'] }).map(o => `${o.category} ${o.name}`).sort();
    assert.deepStrictEqual(names, ['agent a1', 'mcp m1', 'skill s1'], 'the whole chain orphans in one pass');
    assert.ok(!names.includes('skill s2'), 'the direct pick s2 is untouched');
});

// The presentation table is emitted by the tool so alignment never depends on a
// markdown renderer - every row must share the exact separator positions.
const { emitTable } = require('./stack-select.js');

test('emitTable emits a perfectly aligned, fully labeled layer table', () => {
    const table = emitTable(orphanGraph, 'skills', { raw: { rules: ['r2'], skills: ['s2'] } });
    const lines = table.trimEnd().split('\n');
    const pos = l => JSON.stringify([...l].flatMap((c, i) => (c === '|' ? [i] : [])));
    for (const l of lines.slice(2, -2)) assert.strictEqual(pos(l), pos(lines[0]), `separators shear on: ${l}`);
    // the trailing footer names the row count so a truncated display is self-evident
    assert.strictEqual(lines[lines.length - 1], `total: ${lines.length - 4} skills - if fewer rows are visible above, the render was truncated: re-paste it verbatim`, 'row-count footer');
    assert.match(lines[0], /# \| skill/, 'header names the layer singular');
    assert.match(table, /1 \| s1 +\| required +\| rule r2/, 's1 is closure-locked with its reason');
    assert.match(table, /2 \| s2 +\| added +\| -/, 's2 is a bare direct pick');
    const cfg = emitTable(orphanGraph, 'skills', { raw: { rules: ['r2'] }, installed: { skills: ['s1'] } });
    assert.match(cfg, /installed/, 'configure mode swaps the column');
    assert.match(cfg, /1 \| s1 +\| yes +\| rule r2/, 'installed + still-required');
    assert.strictEqual(emitTable(orphanGraph, 'nope', {}), null, 'unknown layer returns null');
});

// No row may ever be labeled `suggested`: an agent naming a skill must not put it into an
// install. The walk offered `dotnet-aspire` to a devops project with no Aspire and
// `angular-security` to a WinForms one - a need is proven by the evidence scan against the
// project's own manifests, or seeded per stack, never inferred from a body.
const recommendations = require('../meta/recommendations.json');

test('an install-time need is proven, never suggested by an agent naming a skill', () => {
    const raw = {
        rules: ['csharp-conventions', 'dotnet-repair-agents', 'typescript-conventions', 'angular-conventions', 'angular-styling-conventions', 'angular-repair-agents'],
        agents: ['aspnet-solution-designer', 'aspnet-implementer', 'aspnet-verifier', 'dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'web-angular-solution-designer', 'web-angular-implementer', 'web-angular-verifier', 'ng-build-error-resolver', 'angular-test-resolver', 'code-style-analyzer'],
    };
    const table = emitTable(graph, 'skills', { raw, recs: recommendations, stacks: ['aspnet', 'web-angular'] });
    const rowOf = name => table.split('\n').find(l => new RegExp(`\\| ${name} `).test(l)) || '';

    assert.doesNotMatch(table, /suggested/, 'the suggested status is gone from every layer table');
    // the full catalog is still shown - a skill nothing selected is a plain addable row
    for (const s of ['dotnet-wpf', 'database-conventions', 'ionic', 'dotnet-minimal-api', 'dotnet-project-setup'])
    {
        assert.ok(rowOf(s), `${s} still appears in the full-catalog table`);
    }

    // and the real seeds still label their rows
    assert.match(rowOf('csharp'), /required/, 'a closure lock still reads required');
    assert.match(rowOf('angular-security'), /stack:web-angular/, 'a stack seed still reads as its stack');
});

// The evidence layer: gaps between what the scanner found and what is installed.
// missing = actionable add; unevidenced = advisory only (locked decision - never a removal).
const { findEvidenceGaps } = require('./stack-select.js');
const evidenceCatalog = require('../meta/evidence.json');

test('findEvidenceGaps: missing vs unevidenced vs uncatalogued', () => {
    const foundMap = { skills: { 'dotnet-grpc': 'Grpc.AspNetCore in src/Api.csproj' }, mcps: {}, plugins: {} };
    const installed = { skills: ['dotnet-messaging', 'csharp'], mcps: [], plugins: [] };
    const gaps = findEvidenceGaps(evidenceCatalog, foundMap, installed);
    assert.deepStrictEqual(gaps.missing, [{ category: 'skill', name: 'dotnet-grpc', signal: 'Grpc.AspNetCore in src/Api.csproj' }], 'evidence found + not installed = missing');
    const unev = gaps.unevidenced.map(u => `${u.category} ${u.name}`);
    assert.deepStrictEqual(unev, ['skill dotnet-messaging'], 'installed + catalog-listed + no signal = advisory');
    assert.ok(!unev.includes('skill csharp'), 'no catalog entry -> never unevidenced');
    assert.ok(!gaps.missing.some(m => m.name === 'playwright') && !unev.includes('mcp playwright'), 'not installed + not found = nothing');
});

test('findJudgment: overlap only when both installed, dormant only when installed', () => {
    const { findJudgment } = require('./stack-select.js');
    const judgment = {
        overlaps: [{ items: ['mcp:playwright', 'skill:browser-extension'], shared: 'drive a browser', gaps: { 'mcp:playwright': 'automation + screenshots', 'skill:browser-extension': 'live debug of an open tab' } }],
        occasionBound: { 'skill:capacitor-release': 'release-time - store submission' },
    };
    const both = findJudgment(judgment, { mcps: ['playwright'], skills: ['capacitor-release', 'browser-extension'] });
    assert.ok(both.some(l => l.startsWith('overlap: mcp playwright + skill browser-extension - shared: drive a browser')), 'overlap line for an installed pair');
    assert.ok(both.some(l => /gap skill browser-extension: live debug of an open tab/.test(l)), 'each side\'s unique gap rides the line');
    assert.ok(both.some(l => l === 'dormant: skill capacitor-release - release-time - store submission'), 'dormant line for an installed occasion-bound item');
    const one = findJudgment(judgment, { mcps: ['playwright'], skills: [] });
    assert.deepStrictEqual(one, [], 'no overlap with one side absent, no dormant when not installed');
});

test('emitTable: evidence label is pre-selected, below required, above recommended', () => {
    const evidence = { skills: { 'dotnet-web-backend': 'FAKE-SIGNAL', 'dotnet-grpc': 'Grpc.AspNetCore in src/Api.csproj', 'project-solve-cross-task': 'FAKE-SIGNAL-2' } };
    const recs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'recommendations.json'), 'utf8'));
    const table = emitTable(graph, 'skills', { raw: { agents: ['aspnet-solution-designer'] }, recs, stacks: ['aspnet'], evidence });
    const rowOf = name => table.split('\n').find(l => new RegExp(`\\| ${name} `).test(l)) || '';
    assert.match(rowOf('dotnet-web-backend'), /required/, 'a closure lock beats evidence');
    assert.doesNotMatch(rowOf('dotnet-web-backend'), /FAKE-SIGNAL/, 'the lock reason wins the why column');
    assert.match(rowOf('dotnet-grpc'), /evidence +\| Grpc\.AspNetCore in src\/Api\.csproj/, 'evidence row carries its signal');
    assert.match(rowOf('project-solve-cross-task'), /evidence/, 'evidence beats the recommended seed label');
    // configure's installed mode keeps yes/- states; the signal informs the why column
    const cfg = emitTable(graph, 'skills', { raw: {}, installed: { skills: ['csharp'] }, evidence });
    const cfgRow = name => cfg.split('\n').find(l => new RegExp(`\\| ${name} `).test(l)) || '';
    assert.match(cfgRow('dotnet-grpc'), /\| - +\| Grpc\.AspNetCore in src\/Api\.csproj/, 'not-installed row shows the evidence as its why');
});

test('CLI --evidence-gaps prints both directions and dedupes vs stack-missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-evgaps-'));
    try
    {
        const foundFile = path.join(dir, 'found.json');
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(foundFile, JSON.stringify({ found: { skills: { 'dotnet-data-access': 'Npgsql in src/Api.csproj', 'dotnet-grpc': 'Grpc.AspNetCore in src/Api.csproj', 'dotnet-messaging': 'MassTransit in src/Api.csproj' }, mcps: {}, plugins: {} } }));
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: [], skills: ['dotnet-messaging', 'dotnet-openapi'], mcps: [], plugins: [], hooks: [] }));
        const catalogPath = path.join(__dirname, '..', 'meta', 'evidence.json');
        const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
        const base = ['--evidence-gaps', '--found', foundFile, '--catalog', catalogPath, '--installed', invFile, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json')];
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), ...base, '--recs', recsPath, '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.match(out, /^evidence-missing: skill dotnet-grpc - Grpc\.AspNetCore in src\/Api\.csproj, not installed$/m);
        assert.ok(!/evidence-missing: skill dotnet-data-access/.test(out), 'deduped - aspnet stack-missing already lists it');
        assert.ok(!/evidence-missing: skill dotnet-messaging/.test(out), 'installed - not missing');
        assert.match(out, /^no-evidence: skill dotnet-openapi - installed, no signal found \(advisory\)$/m);
        const noDedupe = execFileSync('node', [path.join(__dirname, 'stack-select.js'), ...base], { encoding: 'utf8' });
        assert.match(noDedupe, /evidence-missing: skill dotnet-data-access/, 'without --recs the line stays');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The advisory tier must never overstate droppability: a no-evidence item the kept closure
// still requires names its holders, so 'your call' and 'closure-locked' can't diverge again
// (the angular-material-at-0.1.15 wording defect).
test('no-evidence lines name their closure holders', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-held-'));
    try
    {
        const foundFile = path.join(dir, 'found.json');
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(foundFile, JSON.stringify({ found: { skills: {}, mcps: {}, plugins: {} } }));
        // dotnet-data-access is catalog-listed and hard-held by aspnet-verifier's frontmatter
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: ['aspnet-verifier'], skills: ['dotnet-data-access', 'dotnet-performance'], mcps: [], plugins: [], hooks: [] }));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--evidence-gaps', '--found', foundFile, '--catalog', path.join(__dirname, '..', 'meta', 'evidence.json'), '--installed', invFile, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json')], { encoding: 'utf8' });
        assert.match(out, /^no-evidence: skill dotnet-data-access - installed, no signal found \(advisory; held by agent aspnet-verifier\)$/m, 'a closure-held item names its holder');
        assert.match(out, /^no-evidence: skill dotnet-performance - installed, no signal found \(advisory\)$/m, 'an unheld item keeps the plain advisory');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('every evidence-catalog name resolves in the graph', () => {
    const skillKeys = new Set(Object.keys(graph.skills));
    for (const s of Object.keys(evidenceCatalog.skills || {})) assert.ok(skillKeys.has(s), `evidence skill '${s}' not in graph`);
    const mcpCatalog = new Set(graph.catalog.mcps);
    for (const m of Object.keys(evidenceCatalog.mcps || {})) assert.ok(mcpCatalog.has(m), `evidence mcp '${m}' not in catalog`);
    const pluginCatalog = new Set(graph.catalog.plugins);
    for (const p of Object.keys(evidenceCatalog.plugins || {})) assert.ok(pluginCatalog.has(p), `evidence plugin '${p}' not in catalog`);
});

// The inverse cascade: dropping a locked item honestly means dropping everything
// that still requires it - the configure flow turns a flat refusal into a consent-drop.
const { findDependents } = require('./stack-select.js');

test('findDependents names every kept rule/agent whose closure reaches the item', () => {
    const remaining = { ...orphanInstalled };
    const deps = findDependents(orphanGraph, remaining, 'skills', 's1').map(d => `${d.category} ${d.name}`).sort();
    assert.deepStrictEqual(deps, ['agent a1', 'rule r1', 'rule r2'], 'r2 directly, a1 directly, r1 via a1 - all transitive holders');
    assert.deepStrictEqual(findDependents(orphanGraph, remaining, 'skills', 's2'), [], 'a direct pick nothing needs has no dependents');
    const mcpDeps = findDependents(orphanGraph, remaining, 'mcps', 'm1').map(d => `${d.category} ${d.name}`).sort();
    assert.deepStrictEqual(mcpDeps, ['agent a1', 'rule r1', 'rule r2', 'skill s1'], 'an mcp counts its holding skills too');
});

test('CLI: --dependents prints the consent-drop list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-deps-'));
    try
    {
        const graphFile = path.join(dir, 'graph.json');
        const rawFile = path.join(dir, 'raw.json');
        fs.writeFileSync(graphFile, JSON.stringify(orphanGraph));
        fs.writeFileSync(rawFile, JSON.stringify(orphanInstalled));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', graphFile, '--dependents', 'skill:s1'], { encoding: 'utf8' });
        assert.match(out, /^dependent: rule r2 - requires skill s1$/m);
        assert.match(out, /^dependent: agent a1 - requires skill s1$/m);
        assert.ok(!/dependent: .* s2/.test(out), 's2 has no dependents and appears nowhere');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: required lines carry the category, --dropped prints the orphan lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-orphan-'));
    try
    {
        const graphFile = path.join(dir, 'graph.json');
        const rawFile = path.join(dir, 'raw.json');
        const droppedFile = path.join(dir, 'dropped.json');
        fs.writeFileSync(graphFile, JSON.stringify(orphanGraph));
        fs.writeFileSync(rawFile, JSON.stringify({ ...orphanInstalled, rules: ['r2'] }));
        fs.writeFileSync(droppedFile, JSON.stringify({ rules: ['r1'] }));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', graphFile, '--dropped', droppedFile], { encoding: 'utf8' });
        assert.match(out, /^orphan: agent a1 - required by rule r1 \(dropped\)/m, 'the orphan is named with its category and why');
        assert.ok(!/orphan: (skill s1|mcp m1)/.test(out), 'still-needed items are not offered as orphans');

        const reqRaw = path.join(dir, 'req.json');
        fs.writeFileSync(reqRaw, JSON.stringify({ rules: ['r1'] }));
        const reqOut = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', reqRaw, '--graph', graphFile], { encoding: 'utf8' });
        assert.match(reqOut, /^required: agent a1 - required by rule r1$/m, 'required lines are category-tagged');
        assert.match(reqOut, /^required: skill s1 - required by agent a1$/m);
        assert.match(reqOut, /^required: mcp m1 - required by skill s1$/m);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI closure -> emitted file -> installer --print-plan agrees', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
    const rawFile = path.join(dir, 'raw.json');
    const selFile = path.join(dir, 'selection.txt');
    fs.writeFileSync(rawFile, JSON.stringify({ agents: ['aspnet-solution-designer'] }));
    try
    {
        execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--emit', selFile], { encoding: 'utf8' });
        const emitted = fs.readFileSync(selFile, 'utf8');
        // aspnet-solution-designer's frontmatter pulls dotnet-web-backend - the emitted file must list it
        assert.ok(emitted.split('\n').includes('skill dotnet-web-backend'));

        const seed = path.join(__dirname, 'install', 'alfred-code.js');
        const root = path.join(__dirname, '..');
        const plan = execFileSync('node', [seed, 'install', '--scope', 'project', '--selection', selFile, '--source', root, '--print-plan'], { encoding: 'utf8' });
        const planSkills = (plan.match(/^plan skills:(.*)$/m) || [,''])[1].trim().split(/\s+/);
        assert.ok(planSkills.includes('dotnet-web-backend'), 'installer plan reflects the closed selection');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The validate command's core: given the detected project stacks and the installed
// inventory, flag every installed artifact whose ENTIRE owning stack is absent. Shared
// items (an owner is present), non-stack deliberate extras, and always-baseline items survive.
const { findStackRedundant, findStackMissing } = require('./stack-select.js');

test('findStackRedundant flags whole-stack-absent installs, keeps shared/extra/baseline', () => {
    const installed = {
        rules: ['baseline-navigation', 'csharp-conventions', 'wpf-conventions'],
        agents: ['architecture-analyzer', 'aspnet-implementer', 'dotnet-build-error-resolver', 'wpf-implementer', 'wpf-solution-designer'],
        skills: ['csharp', 'dotnet-web-backend', 'dotnet-wpf'],
        mcps: ['serena', 'my-own-server'],
        plugins: ['csharp-lsp'],
        hooks: ['guard-catastrophic-rm'],
    };
    const redundant = findStackRedundant(graph, recommendations, installed, ['aspnet']);
    const flagged = redundant.map(r => `${r.category} ${r.name}`).sort();
    assert.deepStrictEqual(flagged, [
        'agent wpf-implementer',
        'agent wpf-solution-designer',
        'rule wpf-conventions',
        'skill dotnet-wpf',
    ], 'only wpf-owned installs are redundant when only aspnet is detected');
    const names = new Set(redundant.map(r => r.name));
    assert.ok(!names.has('dotnet-build-error-resolver'), 'a shared aspnet+wpf item survives - aspnet is present');
    assert.ok(!names.has('csharp-conventions'), 'a rule owned by aspnet too survives');
    assert.ok(!names.has('my-own-server'), 'a non-stack-owned deliberate extra is never redundant');
    assert.ok(!names.has('baseline-navigation'), 'an always-baseline item is never redundant');
    assert.strictEqual(redundant.find(r => r.name === 'wpf-conventions').ownedBy, 'wpf', 'the reason names the owning stack');
});

// The curated general list: skills that are cross-stack by nature but happen to be pulled
// only by narrow closures (a wpf designer preloading the GoF skill, the data designer
// preloading dotnet-migrate). Listed in recommendations.json `general`; never flagged
// redundant - a false positive on a destructive command is worse than missed cleanup.
test('a general-listed skill is never redundant even when its only owner is absent', () => {
    const installed = {
        rules: [],
        agents: [],
        skills: ['csharp-design-patterns', 'dotnet-migrate', 'dotnet-hosted-services', 'dotnet-data-access', 'project-related-context', 'dotnet-wpf'],
        mcps: [], plugins: [], hooks: [],
    };
    const redundant = findStackRedundant(graph, recommendations, installed, ['aspnet']);
    const names = new Set(redundant.map(r => r.name));
    for (const s of ['csharp-design-patterns', 'dotnet-migrate', 'dotnet-hosted-services', 'dotnet-data-access', 'project-related-context'])
    {
        assert.ok(!names.has(s), `${s} is general - never redundant`);
    }
    assert.ok(names.has('dotnet-wpf'), 'a genuinely stack-specific skill is still flagged');
});

test('every general-list name resolves in the graph', () => {
    const skillKeys = new Set(Object.keys(graph.skills));
    for (const s of (recommendations.general || {}).skills || [])
    {
        assert.ok(skillKeys.has(s), `general skill '${s}' not in graph`);
    }
    assert.ok(((recommendations.general || {}).skills || []).length >= 1, 'the curated general set is present');
});

test('findStackMissing flags the detected stacks + baseline closure that is not installed', () => {
    // a partial aspnet install - some of its vertical and the baseline are absent
    const installed = {
        rules: ['csharp-conventions'],
        agents: ['aspnet-implementer'],
        skills: ['csharp'],
        mcps: ['serena'],
        plugins: [],
        hooks: [],
    };
    const missing = findStackMissing(graph, recommendations, installed, ['aspnet']);
    const names = new Set(missing.map(m => `${m.category} ${m.name}`));
    assert.ok(names.has('plugin csharp-lsp'), 'the aspnet LSP plugin is missing');
    assert.ok(names.has('agent aspnet-verifier'), 'the aspnet vertical is incomplete');
    assert.ok(names.has('skill dotnet-web-backend'), 'the aspnet web hub is missing');
    assert.ok([...names].some(n => n.startsWith('rule baseline-')), 'missing always-baseline rules surface');
    assert.ok(!names.has('agent aspnet-implementer'), 'an installed item is never missing');
    assert.ok(!names.has('skill csharp'), 'an installed skill is never missing');
    assert.ok(![...names].some(n => n.includes('wpf')), 'undetected-stack items are NOT proposed as missing');
    assert.strictEqual(missing.find(m => m.name === 'csharp-lsp').neededBy, 'aspnet', 'the reason names who needs it');
    assert.strictEqual(missing.find(m => m.name === 'baseline-security').neededBy, 'baseline', 'baseline items are attributed to baseline');
});

test('CLI --missing prints per-category missing lines from an installed inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-missing-'));
    try
    {
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: ['aspnet-implementer'], skills: ['csharp'], mcps: [], plugins: [], hooks: [] }));
        const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--missing', '--installed', invFile, '--recs', recsPath, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json'), '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.match(out, /^missing: plugin csharp-lsp - needed by aspnet, not installed$/m);
        assert.ok(!/missing: agent aspnet-implementer/.test(out), 'an installed agent is not missing');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: plugins written as {name,scope} - the shape validate step 1 mandates - read as installed', () => {
    // validate carries each plugin's scope into the inventory (an uninstall is scope-addressed),
    // but every --installed consumer compared the raw entries against bare names, so each object
    // matched nothing: --missing reported every installed plugin missing and --redundant never
    // saw one (measured on a live validate run, worked around by re-writing plain names).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-plugin-scope-'));
    try
    {
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: [], skills: [], mcps: [], plugins: [{ name: 'csharp-lsp', scope: 'project' }, { name: 'typescript-lsp', scope: 'project' }], hooks: [] }));
        const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
        const graphPath = path.join(__dirname, '..', 'meta', 'stack-graph.json');
        const run = mode => execFileSync('node', [path.join(__dirname, 'stack-select.js'), mode, '--installed', invFile, '--recs', recsPath, '--graph', graphPath, '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.ok(!/missing: plugin csharp-lsp/.test(run('--missing')), 'a scoped installed plugin is not missing');
        assert.match(run('--redundant'), /plugin typescript-lsp/, 'a scoped installed plugin is seen by the redundant pass');
        // A DISABLED plugin is a third state (validate.md step 1): never proposed as an install.
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: [], skills: [], mcps: [], hooks: [], plugins: [],
            plugins_disabled: [{ name: 'csharp-lsp', scope: 'project' }, 'superpowers'] }));
        const missing = run('--missing');
        assert.ok(!/missing: plugin csharp-lsp/.test(missing), 'a disabled stack plugin is not missing');
        assert.ok(!/missing: plugin superpowers/.test(missing), 'a disabled baseline plugin is not missing');
        fs.writeFileSync(invFile, JSON.stringify({ rules: [], agents: [], skills: [], mcps: [], hooks: [], plugins: [], plugins_disabled: ['superpowers'] }));
        assert.match(run('--missing'), /missing: plugin csharp-lsp/, 'an absent plugin still is');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: a --selection built from that inventory keeps its {name,scope} plugins (validate step 11)', () => {
    // validate copies the step-1 inventory into final.json and emits from it; the --selection read
    // never normalized, so every plugin printed `unknown: plugin '[object Object]'` and was dropped
    // from selection.txt (measured on a temp project 2026-09-15).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sel-scope-'));
    try
    {
        const sel = path.join(dir, 'final.json');
        const emit = path.join(dir, 'selection.txt');
        const dropped = path.join(dir, 'dropped.json');
        fs.writeFileSync(sel, JSON.stringify({ rules: [], agents: [], skills: [], mcps: [{ name: 'serena' }, 'context7'], hooks: [],
            plugins: [{ name: 'superpowers', scope: 'project' }, { name: 'csharp-lsp', scope: 'user' }] }));
        fs.writeFileSync(dropped, JSON.stringify({ plugins: [{ name: 'typescript-lsp', scope: 'project' }] }));
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', sel, '--emit', emit, '--dropped', dropped,
            '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json')], { encoding: 'utf8' });
        assert.ok(!/\[object Object\]/.test(out), `no object reads as a name:\n${out}`);
        const txt = fs.readFileSync(emit, 'utf8');
        assert.match(txt, /^plugin superpowers$/m, 'a scoped plugin stays selected');
        assert.match(txt, /^plugin csharp-lsp$/m, 'every scoped plugin stays selected');
        assert.match(txt, /^mcp serena$/m, 'an object mcp entry stays selected');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI --redundant prints per-category redundant lines from an installed inventory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-redundant-'));
    try
    {
        const invFile = path.join(dir, 'installed.json');
        fs.writeFileSync(invFile, JSON.stringify({ rules: ['wpf-conventions'], agents: ['wpf-implementer'], skills: ['dotnet-wpf', 'csharp'], mcps: [], plugins: [], hooks: [] }));
        const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
        const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--redundant', '--installed', invFile, '--recs', recsPath, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json'), '--stacks', 'aspnet'], { encoding: 'utf8' });
        assert.match(out, /^redundant: rule wpf-conventions - owned by wpf, not detected$/m);
        assert.match(out, /^redundant: skill dotnet-wpf - owned by wpf, not detected$/m);
        assert.ok(!/redundant: skill csharp\b/.test(out), 'csharp is aspnet-owned and aspnet is detected - not redundant');
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('onPath resolves a real binary without a shell and rejects a nonexistent one', () => {
    const { onPath } = require('./stack-select.js');
    assert.strictEqual(onPath('node'), true, 'node runs this test suite, so it must be on PATH');
    assert.strictEqual(onPath('no-such-binary-alfred-code-test'), false);
});

test('detectEnvironment probes bins via the PATH walk (no /bin/bash dependency)', () => {
    const { detectEnvironment } = require('./stack-select.js');
    const { bins } = detectEnvironment();
    assert.strictEqual(bins.node, true, 'all-false bins is the old /bin/bash-on-Windows failure signature');
    assert.strictEqual(bins.git, true);
});

// The guided walks live or die on these renders: a layer table that fails to render is
// what pushes the model into the prose-summary fallback the commands ban. Every layer
// must produce its full catalog with a row count matching the total footer, in both the
// setup shape (--recs/--stacks) and the configure shape (--installed).
test('every layer table renders its full catalog with a matching total footer, in setup and configure shapes', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tables-'));
    try
    {
        const rawFile = path.join(dir, 'raw.json');
        const invFile = path.join(dir, 'inv.json');
        fs.writeFileSync(rawFile, '{}');
        fs.writeFileSync(invFile, JSON.stringify({ skills: ['csharp'], agents: [], rules: [], mcps: [], plugins: [], hooks: [] }));
        const script = path.join(__dirname, 'stack-select.js');
        const graphPath = path.join(__dirname, '..', 'meta', 'stack-graph.json');
        const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
        const shapes = {
            setup: ['--recs', recsPath, '--stacks', 'aspnet'],
            configure: ['--installed', invFile],
        };
        for (const layer of ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins'])
        {
            for (const [shapeName, shapeArgs] of Object.entries(shapes))
            {
                const out = execFileSync('node', [script, '--selection', rawFile, '--graph', graphPath, '--table', layer, ...shapeArgs], { encoding: 'utf8' });
                const footer = out.match(new RegExp(`^total: (\\d+) ${layer}`, 'm'));
                assert.ok(footer, `${shapeName} ${layer}: total footer present`);
                const n = Number(footer[1]);
                assert.ok(n > 0, `${shapeName} ${layer}: catalog is not empty`);
                const rows = out.split('\n').filter(l => /^\s*\d+ \|/.test(l)).length;
                assert.strictEqual(rows, n, `${shapeName} ${layer}: visible rows match the footer count`);
            }
        }
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a table still renders when --found and --dropped name missing files (advisory inputs warn, never kill the render)', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-soft-'));
    try
    {
        const rawFile = path.join(dir, 'raw.json');
        const invFile = path.join(dir, 'inv.json');
        fs.writeFileSync(rawFile, '{}');
        fs.writeFileSync(invFile, JSON.stringify({ skills: [], agents: [], rules: [], mcps: [], plugins: [], hooks: [] }));
        const r = spawnSync('node', [
            path.join(__dirname, 'stack-select.js'), '--selection', rawFile,
            '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json'),
            '--table', 'skills', '--installed', invFile,
            '--dropped', path.join(dir, 'no-such-dropped.json'),
            '--found', path.join(dir, 'no-such-found.json'),
        ], { encoding: 'utf8' });
        assert.strictEqual(r.status, 0, `table render must survive missing advisory files (stderr: ${r.stderr})`);
        assert.match(r.stdout, /^total: \d+ skills/m, 'the table still carries its footer');
        assert.match(r.stderr, /warning - cannot read --dropped/);
        assert.match(r.stderr, /warning - cannot read --found/);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// The remote context7 registration sends `${CONTEXT7_API_KEY:-}` - an unset key is the keyless
// free tier, not an error, and `claude mcp list` stops warning for the `:-` form - so the
// prerequisite check is the one place a missing key still shows.
test('context7 selected without a key warns, never blocks; with the key, clean', () => {
    const bins = { node: true, npx: true, git: true, claude: true, uvx: true };
    const sel = { skills: [], mcps: ['context7'], plugins: [] };
    const r = evaluatePrereqs(sel, { bins, envs: {} }, {});
    assert.ok(r.warnings.some(w => /context7 API key/.test(w.need)), 'warns without a key');
    assert.ok(!r.blockers.some(b => /context7/i.test(b.need)), 'never a blocker - unset is the keyless free tier');
    const keyed = evaluatePrereqs(sel, { bins, envs: { CONTEXT7_API_KEY: true } }, {});
    assert.ok(!keyed.warnings.some(w => /context7/i.test(w.need)), 'a set key satisfies it');
    const none = evaluatePrereqs({ skills: [], mcps: [], plugins: [] }, { bins, envs: {} }, {});
    assert.ok(!none.warnings.some(w => /context7/i.test(w.need)), 'context7 not selected - no warning');
});

// A --space install keeps its account under ~/.claude-<space>; the model's shell rarely carries
// CLAUDE_CONFIG_DIR, so the check must be told which account file to read.
// Measured 2026-09-15: macOS installs a browser as an app, never on PATH, so a machine WITH one was
// told to install it. Edge is the one browser a kept playwright engine still needs from the machine.
test('browserCandidates: Edge is probed at its app install locations on every platform', () => {
    const { browserCandidates } = require('./stack-select.js');
    const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' };
    assert.ok(browserCandidates('msedge', 'darwin', env).includes('/Applications/Microsoft Edge.app'), 'macOS Edge app');
    assert.ok(browserCandidates('msedge', 'win32', env).some((c) => /msedge\.exe$/.test(c)), 'Windows Edge exe');
    assert.deepStrictEqual(browserCandidates('msedge', 'linux', env), [], 'Linux relies on PATH');
    assert.deepStrictEqual(browserCandidates('chrome', 'darwin', env), [], 'no other browser is probed - nothing reads it since 2.0.0');
});

test('detectEnvironment reads the account settings.json env from --config-dir (a --space account)', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { detectEnvironment } = require('./stack-select.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacksel-acct-'));
    const saved = process.env.CONTEXT7_API_KEY;
    delete process.env.CONTEXT7_API_KEY;
    try
    {
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { CONTEXT7_API_KEY: 'ctx7-test' } }));
        assert.strictEqual(detectEnvironment({ configDir: dir }).envs.CONTEXT7_API_KEY, true, 'read from the given account dir');
        assert.strictEqual(detectEnvironment({ configDir: path.join(dir, 'no-such-account') }).envs.CONTEXT7_API_KEY, false, 'a missing account file reads as unset');
    }
    finally
    {
        if (saved !== undefined) process.env.CONTEXT7_API_KEY = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// 'angular' is the display name; the stack key is 'web-angular'. A mistyped --stacks value used
// to seed nothing silently (every web-angular row rendered '-' with no hint).
test('CLI: an unknown --stacks name is named on stderr and the table still renders in full', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacksel-stacks-'));
    const rawFile = path.join(dir, 'raw.json');
    fs.writeFileSync(rawFile, JSON.stringify({ skills: [], agents: [], rules: [], plugins: [] }));
    try
    {
        const args = [path.join(__dirname, 'stack-select.js'), '--selection', rawFile, '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json'), '--table', 'rules', '--recs', path.join(__dirname, '..', 'meta', 'recommendations.json')];
        const bad = spawnSync('node', [...args, '--stacks', 'angular'], { encoding: 'utf8' });
        assert.strictEqual(bad.status, 0, bad.stderr);
        assert.match(bad.stderr, /unknown-stack 'angular'/, 'the unknown key is named');
        assert.match(bad.stdout, /^total: \d+ rules/m, 'the table still renders with its footer');
        const good = spawnSync('node', [...args, '--stacks', 'web-angular'], { encoding: 'utf8' });
        assert.ok(!/unknown-stack/.test(good.stderr), 'a real key is silent');
        assert.match(good.stdout, /\| angular-conventions\s+\| stack:web-angular/, 'the real key seeds its rows');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// superpowers is installed beside the core on every run, so the walk must not present it as
// something to pick or drop.
test('a plugin the core entry depends on gets its own row status, in both table modes', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deprow-'));
    const sel = path.join(dir, 'raw.json');
    const inv = path.join(dir, 'inv.json');
    fs.writeFileSync(sel, JSON.stringify({ skills: [], rules: ['baseline-navigation'], agents: [], mcps: [], plugins: [], hooks: [] }));
    fs.writeFileSync(inv, JSON.stringify({ plugins: ['superpowers'], skills: [], agents: [], rules: [], mcps: [], hooks: [] }));
    const script = path.join(__dirname, 'stack-select.js');
    const graphPath = path.join(__dirname, '..', 'meta', 'stack-graph.json');

    const selected = execFileSync('node', [script, '--selection', sel, '--graph', graphPath, '--table', 'plugins'], { encoding: 'utf8' });
    const row = selected.split('\n').find(l => l.includes('superpowers'));
    assert.ok(/\bdependency\b/.test(row), `the row must say dependency, got: ${row}`);
    assert.ok(/cannot be dropped/.test(row), `the row must say it cannot be dropped, got: ${row}`);
    assert.ok(!/required by/.test(row), 'it must not read like a pick the closure happens to force');

    const installedOut = execFileSync('node', [script, '--selection', sel, '--graph', graphPath, '--table', 'plugins', '--installed', inv], { encoding: 'utf8' });
    const irow = installedOut.split('\n').find(l => l.includes('superpowers'));
    assert.ok(/\byes\b/.test(irow), `installed mode keeps its own state column, got: ${irow}`);
    assert.ok(/carried by alfred-code@envoydev/.test(irow), `installed mode still says where it came from, got: ${irow}`);
    fs.rmSync(dir, { recursive: true, force: true });
});

// R27: claude-hud is required like superpowers - a `dependency` row, never a pick - and no plugin is an
// always-baseline SEED any more: the optional four are suggested on evidence instead.
test('claude-hud gets the dependency row too, and no plugin is seeded into every install', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deprow-hud-'));
    const sel = path.join(dir, 'raw.json');
    fs.writeFileSync(sel, JSON.stringify({ skills: [], rules: [], agents: [], mcps: [], plugins: [], hooks: [] }));
    const recsPath = path.join(__dirname, '..', 'meta', 'recommendations.json');
    const out = execFileSync('node', [path.join(__dirname, 'stack-select.js'), '--selection', sel, '--table', 'plugins', '--recs', recsPath,
        '--graph', path.join(__dirname, '..', 'meta', 'stack-graph.json')], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    const rowOf = (name) => out.split('\n').find((l) => l.split('|')[1] && l.split('|')[1].trim() === name) || '';
    assert.match(rowOf('claude-hud'), /\|\s*dependency\s*\|.*cannot be dropped/, `claude-hud row: ${rowOf('claude-hud')}`);
    for (const name of ['security-guidance', 'claude-md-management', 'csharp-lsp', 'typescript-lsp'])
        assert.match(rowOf(name), /\|\s*-\s*\|/, `${name} is optional - no evidence, no stack, not selected: ${rowOf(name)}`);
    const recs = require('../meta/recommendations.json');
    assert.deepStrictEqual(recs.always.plugins || [], [], 'no plugin is an always-baseline seed');
});

test('superpowers is no longer a SEED, and the baseline closure still reaches it', () => {
    const recs = require('../meta/recommendations.json');
    assert.ok(!(recs.always.plugins || []).includes('superpowers'),
        'the installer does not seed it any more - the core plugin\'s dependency installs it');
    const closure = computeClosure(graph, recs.always);
    assert.ok((closure.plugins || []).includes('superpowers'),
        'it must still be reachable, or validate would stop reporting it absent on a broken install');
});

test('the recommended hook set is the whole catalog - a walk that takes it switches nothing off', () => {
    const recs = require('../meta/recommendations.json');
    const missing = (graph.catalog.hooks || []).filter(h => !(recs.always.hooks || []).includes(h));
    assert.deepEqual(missing, [],
        'a catalog hook the recommendation leaves out lands in ALFRED_CODE_HOOKS_OFF on every default setup');
});

// Phase 8 T4: the installer's read-back lists what the user switched off as `left_out` - a seat
// denied, an item of a parked entry. That is on disk, never MISSING: validate proposing it every run
// would re-enable what the user turned off.
test('findStackMissing: a left_out item is switched off here, never missing', () => {
    const installed = { rules: ['csharp-conventions'], agents: ['aspnet-implementer'], skills: ['csharp'], mcps: ['serena'], plugins: [], hooks: [],
        left_out: ['agent aspnet-verifier', 'skill dotnet-web-backend'] };
    const names = new Set(findStackMissing(graph, recommendations, installed, ['aspnet']).map(m => `${m.category} ${m.name}`));
    assert.ok(!names.has('agent aspnet-verifier'), 'a denied seat is not proposed back');
    assert.ok(!names.has('skill dotnet-web-backend'), 'a parked entry item is not proposed back');
    assert.ok(names.has('plugin csharp-lsp'), 'everything else still is');
});

test('findStackMissing: a parked MCP entry is that server switched off here, never missing', () => {
    const installed = { rules: [], agents: [], skills: [], mcps: ['serena'], plugins: [], hooks: [], plugins_disabled: ['playwright-chrome'] };
    const names = new Set(findStackMissing(graph, recommendations, installed, ['web-angular']).map(m => `${m.category} ${m.name}`));
    assert.ok(!names.has('mcp playwright'), 'the parked engine entry folds onto its catalog row');
});
