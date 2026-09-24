'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'setup-plugin');

test('marketplace.json is valid and every entry shares the repo root', () => {
    const mp = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.strictEqual(mp.name, 'envoydev');
    assert.ok(Array.isArray(mp.plugins) && mp.plugins.length >= 1);
    // From Phase 3 every entry is GENERATED over the shared root, the core included - it used to
    // ship from ./setup-plugin, whose own plugin.json was its manifest, but its skills and agents
    // live under stack/, outside that folder.
    const core = mp.plugins.find(x => x.name === 'alfred-code');
    assert.ok(core, 'the core entry must survive every generator run');
    assert.ok(Array.isArray(core.commands) && core.commands.length === 6, 'the guided walks ship from the core - init and its setup alias among them');
    assert.ok(core.commands.includes('./setup-plugin/commands/init.md') && core.commands.includes('./setup-plugin/commands/setup.md'));
    for (const p of mp.plugins)
    {
        assert.strictEqual(p.source, './', `${p.name} shares the repo root as its source`);
        assert.strictEqual(p.strict, false, `${p.name} carries no plugin.json of its own`);
        assert.ok(typeof p.description === 'string' && p.description.trim() !== '');
        for (const rel of [...(p.commands || []), ...(p.skills || []), ...(p.agents || [])])
            assert.ok(fs.existsSync(path.join(ROOT, rel)), `${p.name} lists a path that does not exist: ${rel}`);
    }
    assert.strictEqual(mp.plugins.find(x => x.name === 'alfred-code-hooks'), undefined, 'no hooks entry - the hooks ride the core');
    assert.ok(JSON.stringify(core.hooks).includes('stack/hooks/guard-secret-value.js'), 'the core declares the stack hooks INLINE, so nothing sits at the shared root');
});

test('plugin.json is valid, the six commands are listed, and the router skill exists', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(pj.name, 'alfred-code');
    assert.ok(typeof pj.version === 'string' && pj.version.trim() !== '');
    assert.ok(typeof pj.description === 'string' && pj.description.trim() !== '');
    // Plugin COMMANDS display namespaced-only (/alfred-code:setup); plugin SKILLS display bare -
    // so the workers must be commands and the router a skill named exactly like the plugin
    // (bare /alfred-code, no /alfred-code:alfred-code stutter). Empirically proven layout.
    assert.deepStrictEqual(pj.commands, ['./commands/init.md', './commands/setup.md', './commands/update.md', './commands/configure.md', './commands/validate.md', './commands/status.md']);
    for (const name of ['init', 'setup', 'update', 'configure', 'validate', 'status'])
    {
        assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`)), `the /alfred-code:${name} command exists`);
    }
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md')), 'the /alfred-code router skill exists');
    assert.ok(!fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'alfred-code.md')), 'no router COMMAND - a command named like the plugin displays as the /alfred-code:alfred-code stutter');
});

test('init is the walk and setup its thin alias - both manual-only, the alias naming init', () => {
    // Phase 8 R3: a new name, not a new walk. The alias keeps /alfred-code:setup working for one
    // release; a copy of the walk under two names would drift the first time either is edited.
    const read = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
    const init = read('init');
    const alias = read('setup');
    for (const [name, body] of [['init', init], ['setup', alias]])
        assert.match(body, /^---\n[\s\S]*?^disable-model-invocation: true$[\s\S]*?^---$/m, `${name} stays manual-only`);
    assert.match(alias, /\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/commands\/init\.md/, 'the alias reads the walk from the installed layout');
    assert.ok(alias.split('\n').length < 20, `the alias is a pointer, not a second walk (${alias.split('\n').length} lines)`);
    assert.match(init, /^## 11\. Install$/m, 'the walk itself lives in init');
});

test('no tracked plugin file leaks an email address', () => {
    for (const rel of ['.claude-plugin/marketplace.json', 'setup-plugin/.claude-plugin/plugin.json'])
    {
        const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/@envoydev|@main/g, '')), `${rel} must not contain an email`);
    }
});

const { computeClosure } = require('./stack-select.js');
const graph = require('../meta/stack-graph.json');

const RECS = path.join(ROOT, 'meta', 'recommendations.json');

test('every recommendation name resolves in the dependency graph', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const agentKeys = new Set(Object.keys(graph.agents));
    const ruleKeys = new Set(Object.keys(graph.rules));
    const skillKeys = new Set(Object.keys(graph.skills));
    const seeds = [recs.always, recs.general, ...Object.values(recs.stacks)];
    for (const seed of seeds)
    {
        for (const a of seed.agents || []) assert.ok(agentKeys.has(a), `recommendation agent '${a}' not in graph`);
        for (const r of seed.rules || []) assert.ok(ruleKeys.has(r), `recommendation rule '${r}' not in graph`);
        for (const s of seed.skills || []) assert.ok(skillKeys.has(s), `recommendation skill '${s}' not in graph`);
        const pluginCatalog = new Set(graph.catalog.plugins);
        for (const p of seed.plugins || []) assert.ok(pluginCatalog.has(p), `recommendation plugin '${p}' not in catalog`);
        const mcpCatalog = new Set(graph.catalog.mcps);
        for (const m of seed.mcps || []) assert.ok(mcpCatalog.has(m), `recommendation mcp '${m}' not in catalog`);
        const hookCatalog = new Set(graph.catalog.hooks);
        for (const h of seed.hooks || []) assert.ok(hookCatalog.has(h), `recommendation hook '${h}' not in catalog`);
    }
});

test('the aspnet seed installs the csharp LSP plugin', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const closed = computeClosure(graph, { agents: recs.stacks.aspnet.agents, rules: recs.stacks.aspnet.rules, plugins: recs.stacks.aspnet.plugins });
    assert.ok(closed.plugins.includes('csharp-lsp'), 'aspnet installs csharp-lsp');
});

test('the aspnet seed closes to its .NET vertical', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const seed = recs.stacks['aspnet'];
    assert.ok(seed, 'an aspnet stack recommendation exists');
    const closed = computeClosure(graph, { agents: [...(recs.always.agents || []), ...(seed.agents || [])], rules: [...(recs.always.rules || []), ...(seed.rules || [])] });
    assert.ok(closed.skills.includes('csharp'), 'aspnet closure pulls csharp');
    assert.ok(closed.skills.includes('dotnet-web-backend'), 'aspnet closure pulls the web hub');
});

test('the always block seeds the cross-cutting agents and baseline rules', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    for (const r of ['baseline-interaction', 'baseline-security', 'baseline-git'])
    {
        assert.ok((recs.always.rules || []).includes(r), `always seeds ${r}`);
    }
    // the entry-point orchestrator installs everywhere - previously only the four
    // repair-rule stacks pulled it, so a mobile/data/devops-only install shipped without
    // the skill that drives its own trio.
    assert.ok((recs.always.skills || []).includes('project-solve-cross-task'), 'always seeds the orchestrator');
});

// A capture skill fans out its own read-only seat, and the graph cannot express that edge
// (skills carry only mcp/plugin edges by design) - so the pairing lives in the seeds and nothing
// but this test keeps it honest. A seeded capture skill without its seat installs a flow that
// has no one to dispatch (how code-style-analyzer went unseeded).
test('every always-seeded capture skill seeds the seat it fans out', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const PAIRS = {
        'project-architecture-analyzer': 'architecture-analyzer',
        'project-code-style-analyzer': 'code-style-analyzer',
        'project-test-coverage-analyzer': 'test-coverage-analyzer',
        'project-related-context': 'related-project-analyzer',
    };
    for (const [skill, seat] of Object.entries(PAIRS))
    {
        for (const bucket of ['always', 'general'])
        {
            if (!((recs[bucket] || {}).skills || []).includes(skill)) continue;
            assert.ok(((recs[bucket] || {}).agents || []).includes(seat), `${bucket} seeds ${skill} without ${seat}`);
        }
    }
});

// Sibling repos are a property of the PROJECT, not of a stack or of the baseline - a standalone
// repo has none, and no manifest signal can prove otherwise. So the related-context pair is
// opt-in: it sits in `general` (addable in any walk, never flagged redundant, never reported
// missing) instead of `always`, which would install it for everyone and have validate re-add it.
test('the related-context capture is optional, never an always-baseline seed', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    assert.ok(!(recs.always.skills || []).includes('project-related-context'), 'always must not seed the skill');
    assert.ok(!(recs.always.agents || []).includes('related-project-analyzer'), 'always must not seed the seat');
    assert.ok((recs.general.skills || []).includes('project-related-context'), 'general carries the skill');
    assert.ok((recs.general.agents || []).includes('related-project-analyzer'), 'general carries the seat');
    for (const sel of Object.values(recs.stacks))
    {
        assert.ok(!(sel.skills || []).includes('project-related-context'), 'no stack seeds the skill');
        assert.ok(!(sel.agents || []).includes('related-project-analyzer'), 'no stack seeds the seat');
    }
});

// An always-baseline artifact installs into EVERY project, so it must be stack-neutral. A browser
// driver in a WinForms install is the same defect as an Angular skill there: the need has to be
// proven (a stack whose surface always has a browser, or the project's own manifests) - it is
// never assumed. playwright sat in `always.mcps` and shipped to every console/WPF/data install.
// MEASURED (a real 0.2.47 setup run on a WPF/WinForms project): every layer table was rendered
// into `$TMP/table.txt` by a redirect and then never shown - the redirect empties the tool result,
// so pasting it needed a read-back step the prescribed command never contained, and all six layer
// questions were asked with no catalog on screen. The table must come back in the tool result.
test('the layer table is never redirected to a file - the tool result is what gets pasted', () => {
    for (const name of ['init', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        const tableCmds = body.split('\n').filter(l => l.includes('--table <layer>'));
        assert.ok(tableCmds.length, `${name} prescribes the table command`);
        for (const line of tableCmds)
        {
            assert.ok(!/--table <layer>[^`]*>\s*"?\$TMP/.test(line), `${name} must not redirect the table into a file: ${line.trim().slice(0, 120)}`);
        }
        assert.match(body, /total: N <layer>/, `${name} carries the footer self-check`);
    }
});

// A plugin's own defaults are not this stack's recommendation, and the stack must not force one:
// the ASK belongs to the plugins layer's own turn (that is where the user is deciding about
// plugins), the APPLY to the install step - the plugin has to be on disk first. Same shape as the
// environment choices, asked up front and merged once the installer has run. Both halves are found
// by NAME and tied together by the apply subsection's own number: the ladders renumber whenever a
// step is inserted, and what this pins is where the two halves sit, not what they are numbered.
test('both walks ask the plugin-settings question in the plugins layer and apply it after install', () => {
    for (const name of ['init', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        const pluginsAt = body.search(/^## \d+\. Plugins$/m);
        assert.ok(pluginsAt >= 0, `${name} has a numbered plugins layer`);
        const rest = body.slice(pluginsAt + 1);
        const nextHeading = rest.search(/^## /m);
        const layer = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
        assert.match(layer, /Plugin settings - part of this layer's turn/, `${name} asks inside the plugins layer`);
        assert.match(layer, /plugin-settings\.js/, `${name} reports with the tool, never a hand edit`);
        assert.match(layer, /meta\/plugin-settings\.json/, `${name} reads the snapshot catalog`);
        assert.match(layer, /Apply recommended/, `${name} offers apply`);
        assert.match(layer, /Apply and replace differing/, `${name} offers replace`);
        assert.match(layer, /\*\*Skip\*\*/, `${name} offers skip`);
        assert.ok(!/--apply/.test(layer), `${name} does not write before the plugin is installed`);

        const applyHeading = body.match(/^### (\d+)a\. Plugin settings.*$/m);
        assert.ok(applyHeading, `${name} carries the plugin-settings apply subsection`);
        assert.ok(body.indexOf(applyHeading[0]) > pluginsAt, `${name} applies after the plugins layer`);
        // the subsection rides the step that runs the installer - that is why the plugin is on disk
        assert.match(body, new RegExp(`^## ${applyHeading[1]}\\. (Install|Update)`, 'm'),
            `${name} hangs ${applyHeading[1]}a off its installer step`);
        const apply = body.slice(body.indexOf(applyHeading[0]));
        assert.match(apply, /--apply/, `${name} applies the answer at the install step`);
        assert.match(apply, /--replace/, `${name} carries the overwrite answer through`);
    }
});

test('the always MCP baseline is stack-neutral - the browser is seeded or proven, and no cut server comes back', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'evidence.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    // memory joined serena and context7 as a locked server (baseline-memory.md names it, the same
    // way baseline-navigation locks serena in) - the shared-memory-mcp feature made it required.
    assert.deepStrictEqual([...(recs.always.mcps || [])].sort(), ['context7', 'memory', 'serena'], 'only the three rules lock in');
    assert.ok(!(recs.always.mcps || []).includes('playwright'), 'playwright must not install into every project');
    assert.ok(!((recs.general || {}).mcps || []).includes('memory'), 'memory left the general (addable, never seeded) list once it locked in');

    // 2.0.0 cut five servers: no seed, no evidence row and no addable list may bring one back.
    const cut = manifest.retired.mcps;
    assert.deepStrictEqual([...cut].sort(), ['angular-cli', 'appium-mcp', 'chrome-devtools', 'context7-local', 'sentry']);
    for (const server of cut)
    {
        const seededBy = Object.entries(recs.stacks).filter(([, sel]) => (sel.mcps || []).includes(server)).map(([st]) => st);
        assert.deepStrictEqual(seededBy, [], `${server} left the stack in 2.0.0, yet a stack seeds it`);
        assert.ok(!(evidence.mcps || {})[server], `${server} left the stack in 2.0.0, yet evidence proves it`);
        assert.ok(!((recs.general || {}).mcps || []).includes(server), `${server} left the stack in 2.0.0, yet it is addable`);
        assert.ok(!manifest.mcps.some((r) => r.name === server), `${server} is still in the catalog`);
    }

    // two proven routes into a project: a stack whose surface always has a browser, or the packages
    const seeded = Object.entries(recs.stacks).filter(([, sel]) => (sel.mcps || []).includes('playwright')).map(([st]) => st).sort();
    assert.deepStrictEqual(seeded, ['browser-extension', 'ionic-angular', 'web-angular']);
    assert.ok((evidence.mcps || {}).playwright, 'and an evidence signal for any other stack that actually uses it');
});

test('every shipped plugin is suggested somewhere - validate cannot flag what nothing suggests', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    // active:false rows are the plugins every install carries beside the core (claude-hud; superpowers
    // is an optional pick since R72) - never a pick, so never part of the selectable catalog a
    // suggestion has to reach.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    const shipped = manifest.plugins.filter((r) => r.active !== false).map((r) => r.id.split('@')[0]).sort();
    assert.ok(shipped.length >= 4, 'the manifest lists the shipped plugins');

    // findStackMissing sources are the always baseline plus each DETECTED stack, both run through
    // the closure - so a plugin no seed reaches is invisible to validate's ADD side on every
    // install. Measured: three of the seven sat outside every seed, one of them the commit-time
    // security gate, and a validate run reported nothing missing while it was not installed.
    const reachable = new Set(computeClosure(graph, recs.always).plugins || []);
    for (const sel of Object.values(recs.stacks)) for (const p of computeClosure(graph, sel).plugins || []) reachable.add(p);

    // The `general` list is the DELIBERATE third route, the same treatment the memory MCP got at
    // zero measured use: offered in the plugins table, never pre-selected, and never flagged
    // missing OR redundant by validate (stack-select.js skips a general name in both directions).
    // So a general plugin is not invisible by accident - it is a decision, and it has to be in
    // this list to be one.
    const general = new Set((recs.general || {}).plugins || []);
    for (const name of general) assert.ok(shipped.includes(name), `${name} is on the general list but the installer does not ship it`);
    // R27: the optional plugins are suggested on EVIDENCE - each one carries a meta/evidence.json row,
    // which validate's --evidence-gaps pass reads as MISSING when the scan matched and it is absent.
    // An evidence row pre-selects and flags, so a plugin carrying one leaves the general list, whose
    // contract is the opposite (claude-md-management left it for its tracked-CLAUDE.md row).
    const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'evidence.json'), 'utf8')).plugins || {};
    for (const name of Object.keys(evidence)) assert.ok(!general.has(name), `${name} has an evidence row and sits on the never-pre-selected general list`);
    for (const name of ['security-guidance', 'claude-md-management', 'csharp-lsp', 'typescript-lsp'])
        assert.ok(shipped.includes(name) && evidence[name], `${name} is an optional pick with no evidence row`);
    for (const name of shipped) assert.ok(reachable.has(name) || general.has(name) || evidence[name], `${name} is reachable from a seed closure, suggested on evidence, or deliberately on the general opt-in list`);
});

test('every C# vertical closure carries the dotnet router its csharp baseline routes through', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    for (const st of ['aspnet', 'wpf', 'console'])
    {
        const closed = computeClosure(graph, recs.stacks[st]);
        assert.ok(closed.skills.includes('dotnet'), `${st} closure pulls the dotnet router`);
        assert.ok(closed.skills.includes('csharp'), `${st} closure pulls csharp`);
    }
});

test('the typescript pseudo-stack seeds the TS rule and LSP plugin for plain TS/Node repos', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const ts = recs.stacks.typescript;
    assert.ok(ts, 'a typescript stack recommendation exists');
    assert.ok((ts.rules || []).includes('typescript-conventions'), 'seeds the conventions rule');
    assert.ok((ts.plugins || []).includes('typescript-lsp'), 'seeds the LSP plugin');
    assert.ok(computeClosure(graph, ts).skills.includes('typescript'), 'the closure pulls the typescript skill via the rule');
});

test('a single-stack (aspnet) recommendation does not pull cross-stack skills', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const closed = computeClosure(graph, { agents: [...(recs.always.agents||[]), ...recs.stacks.aspnet.agents], rules: [...(recs.always.rules||[]), ...recs.stacks.aspnet.rules], plugins: recs.stacks.aspnet.plugins });
    // dotnet-wpf is left out of this list on purpose: it still reaches an aspnet
    // closure via the shared dotnet-build-error-resolver / dotnet-test-failure-resolver
    // (both part of aspnet's own seed, mentioning dotnet-wpf for mixed-solution build
    // errors) - a separate, pre-existing edge this always-roster trim does not touch.
    for (const cross of ['angular-security', 'ionic', 'ionic-security'])
    {
        assert.ok(!closed.skills.includes(cross), `aspnet setup must not pull ${cross}`);
    }
    assert.ok(closed.skills.includes('csharp') && closed.skills.includes('dotnet-web-backend'), 'still pulls its own vertical');
});

for (const name of ['init', 'setup', 'update', 'configure', 'validate', 'status'])
{
    test(`the ${name} command exists with valid manual-only frontmatter`, () => {
        const cmd = path.join(PLUGIN_DIR, 'commands', `${name}.md`);
        assert.ok(fs.existsSync(cmd), 'command file exists');
        const fm = fs.readFileSync(cmd, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        assert.ok(fm, 'has frontmatter');
        assert.match(fm[1], /description:\s*\S/, 'has a description (shown in the / picker)');
        assert.match(fm[1], /disable-model-invocation:\s*true/, 'manual-only');
    });
}

// Phase 7, T5: the installer is ONE node command on every OS. From 2.0.0 ALFRED_CODE_SEED=shell is
// refused (D1, below): a body still typing the twin as its default installs from a script nobody
// edits any more; one that drops the switch's line strands the user who set it without a word.
// The rule is pinned as `seed-route-selection` in meta/shared-rules.json.
test('every command that runs the installer runs the SEED, and names the shell switch', () => {
    for (const name of ['init', 'update', 'configure', 'validate'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /node "\$TMP\/repo\/scripts\/install\/alfred-code\.js" (install|update)/,
            `${name} does not run the Node seed`);
        assert.match(body, /ALFRED_CODE_SEED=shell/, `${name} does not name the shell switch`);
        assert.ok(!/- Unix: `bash "\$TMP\/repo\/scripts\/os\/alfred-code\.sh"/.test(body),
            `${name} still offers the twin as a first-class route`);
    }
    // status runs no installer at all, so it names neither.
    const status = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'status.md'), 'utf8');
    assert.ok(!/alfred-code\.(sh|ps1)|install\/alfred-code\.js/.test(status), 'status must stay read-only');
});

// D1: from 2.0.0 the shell seed is refused. The frozen twin hardcodes the 1.x names a 2.0.0
// registration cannot resolve, so a body that still RUNS it on `seed=shell` installs a broken
// release. Every body names the refusal line the seed itself prints, and runs no twin.
const D1 = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED / CLAUDE_STACK_SEED to use the Node installer'; // legacy-name
test('D1: on seed=shell every command body prints the refusal and runs no twin', () => {
    for (const file of ['commands/init.md', 'commands/update.md', 'commands/configure.md', 'commands/validate.md', 'references/source-protocol.md'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
        assert.ok(body.includes(D1), `${file} does not print the D1 refusal`);
        assert.ok(!/(bash|pwsh -File) "\$TMP\/repo\/scripts\/os\/claude-stack\.(sh|ps1)"/.test(body), `${file} still runs the frozen twin`); // legacy-name
    }
});

// A 1.x install keeps its marketplace key (`claude-stack`) for the whole 2.x line, so a body that // legacy-name
// READS the user's install never spells a stack entry `@envoydev`: it names the key the core is
// listed under - the resolve line's `key=`.
test('the command bodies read stack entries under the key the core is listed under, never a literal @envoydev', () => {
    const files = ['references/source-protocol.md', ...fs.readdirSync(path.join(PLUGIN_DIR, 'commands')).map((f) => `commands/${f}`)];
    for (const file of files)
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
        assert.ok(!/@envoydev\b/.test(body), `${file} spells a stack entry @envoydev: ${(/.{0,60}@envoydev.{0,20}/.exec(body) || [''])[0]}`);
    }
    const protocol = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'source-protocol.md'), 'utf8');
    assert.match(protocol, /key=\$\{KEY:-\?\}/, 'the bash resolve line names the key');
});

// A 1.x install's stamp keeps its old name until its first 2.0.0 update, so a manual read names both.
test('status and configure name the 1.x stamp beside alfred-code.stamp', () => {
    for (const name of ['status', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.ok(body.includes('claude-stack.stamp'), `${name} names only alfred-code.stamp`); // legacy-name
    }
});

test('the guided walks hold the layer order, the step banners, and the cascade machinery', () => {
    for (const name of ['init', 'configure', 'validate'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /rules -> agents -> skills -> hooks -> MCPs -> plugins/, `${name} walks the layers in dependency order`);
        assert.match(body, /\[step \d+\/\d+ - /, `${name} announces every step with the n/total banner`);
    }
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--dropped/, 'configure drives the drop cascade through stack-select --dropped');
    assert.match(configure, /orphan:/, 'configure consumes the orphan: lines');
});

// The install-time twin of validate's judgment gate: a typed add that conflicts with the
// project's stated conventions gets a quote-gated, non-blocking warning at the prereq step.
test('setup and configure carry the brownfield convention-conflict warning gate', () => {
    for (const name of ['init', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /Convention-conflict warnings/, `${name} has the conflict-warning gate`);
        assert.match(body, /No citable conflict, no\s+warning/, `${name} keeps the citation gate`);
        assert.match(body, /never blocks/, `${name} keeps the warning non-blocking`);
    }
});

test('validate reconciles both ways (--redundant + --missing), walks layers, is project-mode-only', () => {
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8');
    assert.match(body, /--redundant/, 'validate drives the remove side through stack-select --redundant');
    assert.match(body, /--missing/, 'validate drives the add side through stack-select --missing');
    assert.match(body, /\[step \d+\/\d+ - /, 'validate announces every step with the n/total banner');
    assert.match(body, /project mode only/i, 'validate refuses outside a project');
    assert.match(body, /install\/alfred-code\.js" update --source "\$TMP\/repo" --scope project --installed-only \[--add/, 'validate applies the accepted adds and removes via the seed, over the read-back');
    assert.match(body, /ALFRED_CODE_SEED=shell/, '... and still names the shell switch it refuses');
    // the judgment step: two gates (code-corroborated non-use, verbatim doc conflict), never
    // mixed with signal tiers
    assert.match(body, /JUDGMENT-DROP/, 'the judgment step exists with its labeled verdict');
    assert.match(body, /No gate evidence, no proposal/, 'judgment proposals are gate-evidence-gated');
    assert.match(body, /corroborate non-use in the code/, 'the advisory list is the judgment step\'s first input');
    assert.match(body, /read code and manifests,\s+not conventions/, 'no project docs skips only the doc path, not the corroboration path');
    // the data-driven judgment candidates: overlap/dormant lines + precomputed version conflicts
    assert.match(body, /JUDGMENT-ADD/, 'the corroborated-need gate exists');
    assert.match(body, /--judgment/, 'validate computes the judgment lines through the tool');
    assert.match(body, /`overlap:`/, 'overlap candidates come from the tool output');
    assert.match(body, /`dormant:`/, 'dormant advisories come from the tool output');
});

// `${CLAUDE_PLUGIN_ROOT}` is expanded into a body at injection time, to the root of the entry's
// SOURCE - and since Phase 3 every entry is sourced from the repo root, which is what the plugin cache
// holds (measured on an isolated install: no references/ or commands/ at its root). A body citing
// `${CLAUDE_PLUGIN_ROOT}/references/...` pointed at the old ./setup-plugin root, and a test pinning
// that spelling kept it dead through the move. So every concrete path a shipped body cites through
// the placeholder is resolved here against the layout the cache actually has.
test('every path a shipped body cites through ${CLAUDE_PLUGIN_ROOT} exists in the installed layout', () => {
    const mkt = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    for (const entry of mkt.plugins) assert.strictEqual(entry.source, './', `${entry.name} is not sourced from the repo root - resolve its paths against its own source`);
    const bodies = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'evals') walk(p); }
            else if (e.name.endsWith('.md')) bodies.push(p);
        }
    };
    walk(PLUGIN_DIR);
    walk(path.join(ROOT, 'stack'));
    let cited = 0;
    for (const file of bodies)
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+\.[a-z]+)/g))
        {
            cited++;
            assert.ok(fs.existsSync(path.join(ROOT, m[1])), `${path.relative(ROOT, file)} cites \${CLAUDE_PLUGIN_ROOT}/${m[1]}, which the installed plugin does not have`);
        }
    assert.ok(cited >= 10, `expected the walks' protocol citations, found ${cited}`);
});

test('every command holds to the shared one-download protocol and the router skill names them all', () => {
    for (const name of ['init', 'update', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/source-protocol\.md/, `${name} cites the shared source-protocol.md via the plugin root`);
    }
    const router = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8');
    assert.match(router.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1], /name:\s*alfred-code/, 'router skill named like the plugin -> displays bare /alfred-code');
    for (const name of ['init', 'update', 'configure'])
    {
        assert.match(router, new RegExp('/alfred-code:' + name), `/alfred-code routes to /alfred-code:${name}`);
    }
});

test('the walk and status REPORT the derivation - they never restate what the installer writes', () => {
    // Phase 8 R1: four prose descriptions of one pipeline is how a route change reached three of them
    // and not the fourth. init shows the derived off-state before installing; status takes the
    // stack's share of the floor, seats included, from the same script.
    const read = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
    assert.match(read('init'), /scripts\/derive-state\.js" --selection "\$TMP\/selection\.txt" --source "\$TMP\/repo"/);
    assert.match(read('status'), /scripts\/derive-state\.js" --floor --plugins /);
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'derive-state.js')), 'the script both cite ships in the snapshot');
});

// Phase 8 T3: update asks from the derivation's new-item verdicts and takes a yes as --add; its
// pruning path never rebuilds the selection from a disk inventory, which on the plugin routes
// holds only the extras and would switch every carried seat off.
test('update: new items come from the preflight\'s new: lines and a yes becomes --add', () =>
{
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8');
    assert.match(body, /`new: <category> <name><TAB><verdict>/);
    assert.match(body, /--installed-only \[--add "<category> <name>"\]\.\.\./);
    assert.ok(!/FYI `added` items/.test(body), 'the FYI-only adoption is gone');
    const step4 = body.slice(body.indexOf('## 4. Pruning path'), body.indexOf('## 5. Prune'));
    assert.match(step4, /run the installer exactly as in step 3 - its `--add` already carries every `renamed`/);
    assert.match(step4, /Never rebuild the\nselection from a disk inventory/);
    assert.ok(!/run the twin as in step 3/.test(step4), 'the dead shell-route reconstruction sentence survived');
});

// Phase 8 T4: configure and validate read the install through the installer's own read-back and
// apply as --add / --drop over it - a hand inventory re-enabled every seat the user switched off,
// and a --selection apply rebuilds the install from a disk that holds only the extras.
test('configure and validate inventory through --print-plan --plan-out and apply through the delta', () =>
{
    for (const name of ['configure', 'validate'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /--installed-only --print-plan --plan-out "\$TMP\/installed\.json"/, `${name} inventories through the read-back`);
        assert.match(body, /plan answered:\s+hooks=<yes\|no>\s+agents=<yes\|no>/, `${name} reads the answered line`);
        assert.match(body, /derive-state\.js" --delta --installed "\$TMP\/installed\.json"|derive-state\.js"\n--delta --installed "\$TMP\/installed\.json"/, `${name} builds the --add / --drop delta`);
        assert.match(body, /Never\s+`--selection`\s+on this seed/, `${name} never applies a whole selection on the Node seed`);
        assert.match(body, /stays loaded/, `${name} reports a skill a kept entry still carries`);
        assert.match(body, /not applied/, `${name} reports a drop something kept requires`);
        assert.match(body, /--picked "\$TMP\/(raw|final)\.json"/, `${name} tells the delta what the walk picked`);
        assert.match(body, /kept-off/, `${name} reports what stays switched off`);
        assert.match(body, /keep-parked/, `${name} keeps a parked plugin parked`);
        assert.match(body, /\| tee "\$TMP\/install\.log"/, `${name} captures the run it greps`);
        assert.ok(!/plugin-scan\.js/.test(body), `${name} no longer hand-filters the listing`);
    }
});

test('configure emits hook none when its Hooks area was walked, and update reads a global install\'s settings from the project', () =>
{
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--emit "\$TMP\/selection\.txt" --check \[--hooks-answered\]/);
    const update = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8');
    assert.match(update, /Global mode: `--root <account dir> --settings \.claude\/settings\.json`/);
});

// A hand-edited library copy is overwritten by the next installer run - never silently: validate
// reports the drift BEFORE its own apply writes anything, and every report filter over the run log
// carries the overwrite line (the log itself is deleted with $TMP).
test('a hand-edited library copy is reported before an apply overwrites it, and the overwrite is shown', () =>
{
    const read = (n) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', n), 'utf8');
    const validate = read('validate.md');
    const step1 = validate.slice(validate.indexOf('## 1. Find the install'), validate.indexOf('## 2. Detect'));
    assert.match(step1, /library-check\.js" --project \. --source "\$TMP\/repo"/, 'validate checks the copies at inventory time');
    for (const [name, body] of [['update.md', read('update.md')], ['validate.md', validate], ['configure.md', read('configure.md')]])
    {
        const filters = body.split('\n').filter((l) => /grep -a?E '[^']*' "\$TMP\/install\.log"/.test(l));
        assert.ok(filters.length > 0, `${name} has a report filter`);
        assert.ok(filters.some((l) => /overwriting a hand-edited copy/.test(l)), `${name}: no report filter shows the overwrite`);
    }
});

// update.md's ONE post-install grep is all the close-out ever reads of the installer log, so every
// retirement line the installer writes - the removal, its add-back line, and a row KEPT at another
// scope or parked, each with the uninstall command the user runs - must pass that pattern. The lines
// come from a real seed run, so a reworded log line or a narrowed pattern turns this red.
test('update: the post-install grep passes every retirement line the installer writes', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8');
    const m = body.match(/grep -aE '([^']+)' "\$TMP\/install\.log"/);
    assert.ok(m, 'update.md carries no post-install grep');
    const pattern = new RegExp(m[1]);
    const listing = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '1.3.0', scope: 'project', enabled: true },
        { id: 'sentry@envoydev', version: '1.3.0', scope: 'project', enabled: true },
        { id: 'angular-cli@envoydev', version: '1.3.0', scope: 'user', enabled: true },
        { id: 'claude-stack-aspnet@envoydev', version: '1.3.0', scope: 'project', enabled: false }, // legacy-name
    ]);
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'source: test\nversion: 1.3.0\n');
        fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: { 'angular-cli': { type: 'stdio', command: 'npx', args: ['-y', '@angular/cli', 'mcp'], env: {} } } }, null, 2)}\n`);
    };
    const { out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { plugins: listing, prepare });
    const kinds = {
        'plugin removal': /plugin pruned \(retired upstream\)/,
        'registration removal': /mcp pruned: /,
        'add-back line': /add it back: claude mcp add /,
        'kept at another scope': /is installed at user scope, not this run's - kept/,
        'kept parked': /is parked here - kept/,
    };
    for (const [kind, re] of Object.entries(kinds))
    {
        const lines = out.split('\n').filter((l) => re.test(l));
        assert.ok(lines.length > 0, `the seed run wrote no ${kind} line - the fixture or the log wording moved:\n${out}`);
        for (const line of lines) assert.match(line, pattern, `update.md's grep drops the ${kind} line`);
    }
});

// The way back from the 2.0.0 cut is printed text the user runs as-is, at whatever scope the install
// has. A retired-plugins row's add-back is substituted per run; a migration's `then` is not, so one
// naming a project scope names the global install's user scope beside it. A local-mode context7 user
// who ran the old `/mcp disable context7` line is told how to switch the hosted one back on.
test('the 2.0.0 add-back lines fit every install scope', () =>
{
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    for (const row of rows.filter((r) => r.retiredIn === '2.0.0'))
        assert.match(row.addBack || '', /--scope <scope>/, `${row.name}'s add-back is not substituted per scope`);
    assert.match(rows.find((r) => r.name === 'context7-local').why, /\/mcp enable context7\b/);
    const migrations = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'migrations.json'), 'utf8')).migrations;
    for (const m of migrations.filter((x) => /claude mcp add /.test(x.then || '') && /--scope project\b/.test(x.then)))
        assert.match(m.then, /--scope user\b/, `${m.id}'s add-back names only the project scope - a global install registers at user scope`);
});
