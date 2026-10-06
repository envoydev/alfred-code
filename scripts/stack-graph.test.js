'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildStackGraph, pluginFromToken } = require('./stack-graph.js');

const graph = buildStackGraph();

test('agent skill edges come from the declared skills: frontmatter', () => {
    const a = graph.agents['aspnet-solution-designer'];
    assert.ok(a, 'aspnet-solution-designer must be in the graph');
    assert.strictEqual(a.skillsSource, 'frontmatter');
    for (const s of ['csharp-design-patterns', 'dotnet-web-backend', 'dotnet-testing', 'task-design'])
    {
        assert.ok(a.skills.includes(s), `expected agent->skill edge to ${s}`);
    }
});

test('rule skill edges resolve from the rule body', () => {
    const r = graph.rules['csharp-conventions'];
    assert.ok(r, 'csharp-conventions must be in the graph');
    assert.ok(r.skills.includes('csharp'), 'csharp-conventions -> csharp');
    assert.deepStrictEqual(r.paths, ['**/*.cs']);
});

test('body-mentioned skills are no edge at all - naming a skill never reaches an install', () => {
    // security-auditor names `habits-done-gate` in its body and preloads nothing (the resolvers,
    // this test's example until R106, preload habits-root-cause now).
    const r = graph.agents['security-auditor'];
    assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'stack', 'agents', 'security-auditor.md'), 'utf8'), /`habits-done-gate`/);
    assert.strictEqual(r.skillsSource, 'body');
    assert.deepStrictEqual(r.skills, [], 'no skills: frontmatter -> no hard skill edges');
    // the removed `suggests:` mechanism: it put dotnet-aspire on a project with no Aspire
    assert.strictEqual(r.suggests, undefined, 'no suggestion edge is emitted');
    assert.strictEqual(graph.agents['data-implementer'].suggests, undefined, 'not for the data seat either');
    for (const node of Object.values(graph.agents)) assert.ok(!('suggests' in node), 'no agent node carries suggests');
});

test('every edge target exists in a catalog (no dangling references)', () => {
    const skills = new Set(Object.keys(graph.skills));
    const agents = new Set(Object.keys(graph.agents));
    const mcps = new Set(graph.catalog.mcps);
    const plugins = new Set(graph.catalog.plugins);
    for (const [name, node] of Object.entries(graph.agents))
    {
        for (const s of node.skills) assert.ok(skills.has(s), `${name} -> unknown skill ${s}`);
        for (const a of node.agents) assert.ok(agents.has(a), `${name} -> unknown agent ${a}`);
        for (const m of node.mcps) assert.ok(mcps.has(m), `${name} -> unknown mcp ${m}`);
        for (const p of node.plugins) assert.ok(plugins.has(p), `${name} -> unknown plugin ${p}`);
    }
});

test('an agent never lists itself as an agent edge', () => {
    for (const [name, node] of Object.entries(graph.agents))
    {
        assert.ok(!node.agents.includes(name), `${name} lists itself`);
    }
});

const { serialize, readCommitted } = require('./stack-graph.js');

test('the committed stack-graph.json is in sync with a fresh build', () => {
    assert.strictEqual(readCommitted(), serialize(buildStackGraph()),
        'run `node scripts/stack-graph.js --write` and commit the result');
});

test('capture-agent-capabilities documents every MCP without pulling a single edge (doc-mention exception)', () => {
    // Its body backticks all 8 servers as the routing map it stamps into the generated
    // rule - treating those as dependencies used to lock the whole MCP baseline into any
    // install that picked it. The graph builder strips the edges for doc-mention skills.
    const s = graph.skills['capture-agent-capabilities'];
    assert.ok(s, 'capture-agent-capabilities must be in the graph');
    assert.deepStrictEqual(s.mcps, [], 'no skill->mcp edges - the mentions are subject matter, not needs');
    assert.deepStrictEqual(s.plugins, [], 'no skill->plugin edges either');
});

test('the hook catalog carries the installer HOOKS block basenames', () => {
    assert.deepStrictEqual(graph.catalog.hooks,
        ['check-turn-build', 'docs-session', 'guard-answer-length', 'guard-catastrophic-rm', 'guard-config-protection', 'guard-cross-project-write', 'guard-desktop-exec', 'guard-fresh-session-start', 'guard-protected-force-push', 'guard-read-whole-file', 'guard-secret-value', 'guard-stop-contract', 'guard-unapproved-dispatch', 'guard-ungated-commit', 'history-session', 'instrument-tool-usage', 'memory-session', 'monitor-session'],
        'catalog.hooks mirrors HOOKS=( ... ) sans .js, sorted');
});

test('a namespaced plugin:skill token resolves to its plugin, a house or unknown one to none', () => {
    const plugins = new Set(['superpowers', 'csharp-lsp']);
    assert.strictEqual(pluginFromToken('superpowers:systematic-debugging', plugins), 'superpowers');
    assert.strictEqual(pluginFromToken('csharp-lsp', plugins), 'csharp-lsp');
    assert.strictEqual(pluginFromToken('alfred-code:habits-root-cause', plugins), null);
    assert.strictEqual(pluginFromToken('habits-root-cause', plugins), null);
});

// R72: the root-cause method is a house skill now. Both diagnoser seats preload it - a preload is a
// hard edge, so the closure of every install that keeps either seat carries it - and no rule, skill
// or seat keeps an edge to superpowers, which is what lets it be an optional pick.
test('both diagnosers preload the house root-cause skill, and nothing cites superpowers', () => {
    for (const seat of ['issue-diagnoser-ci', 'issue-diagnoser-runtime'])
    {
        const a = graph.agents[seat];
        assert.ok(a, `${seat} must be in the graph`);
        assert.ok(a.skills.includes('habits-root-cause'), `${seat} preloads habits-root-cause (frontmatter skills:)`);
    }
    for (const kind of ['rules', 'skills', 'agents'])
        for (const [name, node] of Object.entries(graph[kind]))
            assert.ok(!(node.plugins || []).includes('superpowers'), `${kind} ${name} still has an edge to superpowers`);
});

// The seats cite the root-cause loop BY NUMBER - diagnosers 'its steps 1-5', resolvers 'its steps
// 1-5 plus the one fix of step 6' - so a step inserted, dropped or reordered silently re-points every
// cite. This pins the numbering to what the cites mean: 1-5 find and test the cause without the fix,
// 6 is the fix, 7 is the stop.
test('the root-cause loop keeps the step numbers its seats cite', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const body = fs.readFileSync(path.join(root, 'stack', 'skills', 'habits-root-cause', 'SKILL.md'), 'utf8');
    const loop = body.slice(body.indexOf('## The loop'), body.indexOf('## Where a seat'));
    const steps = [...loop.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => [Number(m[1]), m[2]]);
    assert.deepStrictEqual(steps.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7], 'seven numbered steps, in order');
    const title = (n) => steps[n - 1][1];
    assert.match(title(1), /^Read the whole failure/);
    assert.match(title(2), /^Make it fail on demand/);
    assert.match(title(3), /^Localize/);
    assert.match(title(4), /^Compare with a case that works/);
    assert.match(title(5), /^One hypothesis, one change/);
    assert.match(title(6), /^Fix at the root/);
    assert.match(title(7), /stop\.$/);
    assert.match(body, /runs steps 1-5, adds no instrumentation/, 'the diagnoser scope line');
    assert.match(body, /runs steps 1-5, the one fix of step 6 without its failing test, and step 7/, 'the resolver scope line');
    const agent = (n) => fs.readFileSync(path.join(root, 'stack', 'agents', `${n}.md`), 'utf8');
    for (const seat of ['dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'angular-test-resolver'])
    {
        assert.match(agent(seat), /`habits-root-cause`[^\n]*its steps 1-5 plus the one fix of step 6/, `${seat} cites steps 1-5 and step 6`);
        // step 7 is the whole stop: a fix that left the failure red counts, not only one that moved it
        assert.match(agent(seat), /Its step 7 holds too: if 3 fixes each leave the failure red or surface a new one elsewhere/, `${seat} carries the widened step 7`);
    }
    for (const seat of ['issue-diagnoser-ci', 'issue-diagnoser-runtime'])
        assert.match(agent(seat), /`habits-root-cause`[^\n]*steps 1-5/, `${seat} cites steps 1-5`);
});

// The core's cross-marketplace companions travel in the catalog, so the walk can say 'carried with
// the core plugin' instead of 'required by skill x' - which reads like a pick.
// 2.2.0: none - claude-hud became an optional pick (the user's ruling of 2026-10-06).
test('the catalog names the plugins every install carries beside the core - none since 2.2.0 - and superpowers is not one', () => {
    const { CORE_DEP_PLUGINS } = require('./install/plugins.js');
    assert.ok(Array.isArray(graph.catalog.dependencyPlugins), 'catalog.dependencyPlugins is generated');
    assert.deepStrictEqual(graph.catalog.dependencyPlugins, CORE_DEP_PLUGINS.map((s) => s.split('@')[0]).sort());
    assert.deepStrictEqual(graph.catalog.dependencyPlugins, []);
    assert.ok(graph.catalog.plugins.includes('claude-hud'), 'claude-hud is a catalog pick');
    assert.ok(!graph.catalog.dependencyPlugins.includes('superpowers'), 'superpowers is no companion');
    // R109: nor a pick - it left the plugin catalog in 2.0.0, so the walk never offers it.
    assert.ok(!graph.catalog.plugins.includes('superpowers'), 'superpowers is no catalog plugin');
});

// The browser server's catalog name is also an ordinary word a body backticks for its own reasons -
// the WebExtension `browser` namespace, Angular's `main`->`browser` builder rename. Read as an edge,
// each would pull the droppable browser server into every install carrying that item; the browser is
// proven by a stack seed or evidence instead, never by a mention.
test('a backticked `browser` is no MCP edge - the word is too common to prove a need', () => {
    for (const kind of ['skills', 'agents', 'rules'])
        for (const [name, node] of Object.entries(graph[kind]))
            assert.ok(!(node.mcps || []).includes('browser'), `${kind} ${name} pulls the browser server by a mention`);
    assert.ok(graph.catalog.mcps.includes('browser'), 'the browser server stays in the catalog');
    assert.ok(graph.rules['alfred-navigation'].mcps.includes('alfred-navigation'), 'a role name that is no common word still makes its edge');
});
