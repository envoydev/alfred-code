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
    assert.ok(Array.isArray(core.commands) && core.commands.length === 6, 'the guided commands ship from the core - setup and init among them');
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

// Task 18a: setup is the walk (the selection and the install) and init the one-time bootstrap the
// user types in the session after setup's restart. Two jobs, two bodies - never one pointing at the other.
const cmdBody = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');
// Task 18b: setup (FRESH) and configure (DELTA) run ONE walk text, so the layer rules live there.
const walkBody = () => fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'walk.md'), 'utf8');
const STATE_READ = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\/stamp\.js" state \./;

test('setup is the walk and init the bootstrap - both manual-only, neither a pointer to the other', () => {
    const setup = cmdBody('setup');
    const init = cmdBody('init');
    for (const [name, body] of [['setup', setup], ['init', init]])
        assert.match(body, /^---\n[\s\S]*?^disable-model-invocation: true$[\s\S]*?^---$/m, `${name} stays manual-only`);
    assert.match(setup, /^## 11\. Install$/m, 'the walk lives in setup');
    assert.ok(!/^## \d+\. Install$/m.test(init), 'init never installs');
    assert.ok(!/commands\/(init|setup)\.md/.test(setup + init), 'neither reads the other as its instructions');
    // Over an existing install setup routes to configure, over a 1.x global one to update; with
    // none, init routes to setup. Both read the install the way the hooks do - the stamp state.
    assert.match(setup, STATE_READ);
    assert.match(init, STATE_READ);
    assert.match(flat(setup), /`installed` or `initialised` -> stop and route to `\/alfred-code:configure`/);
    assert.match(flat(setup), /`legacy-global` \(a 1\.x global install whose stamp still sits in the account dir\) -> stop and route to `\/alfred-code:update`/);
    assert.match(flat(init), /\*\*Nothing installed\*\* - `not-installed`: stop and name `\/alfred-code:setup`/);
    assert.match(flat(init), /`legacy-global` \(a 1\.x global install whose stamp still sits in the account dir\): stop the same way on `\/alfred-code:update`/);
    assert.match(flat(init), /\*\*Setup ran in THIS session\*\* - stop: name the restart/);
});

// setup shows what the project needs, and why, BEFORE the walk: validate's two checks in their
// fresh-install mode (no --installed), plus the evidence scan's labels in the tables.
test('setup: the suggestions are validate\'s checks in fresh-install mode, pasted with their reasons', () => {
    const setup = cmdBody('setup');
    const at = setup.indexOf('### 3a. Suggestions');
    assert.ok(at > setup.indexOf('## 3. Project analysis') && at < setup.indexOf('## The walk'), 'the suggestions close step 3, before the walk');
    const block = setup.slice(at, setup.indexOf('## The walk'));
    assert.match(block, /stack-select\.js" --missing --recs "\$TMP\/repo\/meta\/recommendations\.json" --stacks <confirmed,csv>/);
    assert.match(block, /stack-select\.js" --evidence-gaps --found "\$TMP\/found\.json" --catalog "\$TMP\/repo\/meta\/evidence\.json"/);
    const call = block.split('\n').find((l) => l.includes('stack-select.js" --missing'));
    assert.ok(call && !/--installed/.test(call), 'fresh-install mode: no inventory to diff against');
    assert.match(flat(block), /each already carries its reason/);
    assert.match(flat(block), /ONE `baseline: <n> item\(s\)` count line/, 'M1: the baseline is a count, not 59 rows');
    // M1: 3a names what the walk pre-selects - and, since R109, no plugin the stack stopped offering.
    assert.match(flat(block), /The walk pre-selects every row printed here \(`stack:<name>`, `evidence`, `required`\)\./);
    assert.doesNotMatch(flat(block) + flat(walkBody()), /superpowers/);
    assert.match(setup, /--found "\$TMP\/found\.json"/, 'the tables still carry the scan\'s evidence labels');
});

test('setup: no memory level, the init prerequisites deferred, and a close that ends on the restart and init', () => {
    const setup = cmdBody('setup');
    const install = setup.slice(setup.indexOf('## 11. Install'), setup.indexOf('## Post-check'));
    assert.match(install, /install\/alfred-code\.js" install --source "\$TMP\/repo" --scope <scope>/);
    assert.ok(!/--memory-level/.test(install.split('\n').find((l) => l.includes('- **Any OS:**'))), 'the level is init\'s question');
    assert.match(setup, /--check --defer-init/, 'uv and csharp-ls are init\'s to install, never setup\'s blockers');
    const close = setup.slice(setup.indexOf('## Post-check'));
    assert.match(flat(close), /\*\*Restart, then `\/alfred-code:init`\*\*/);
    assert.match(flat(close), /Nothing is pending on this run - these are yours to run when you choose\./);
    assert.ok(!/## \d+\. CLAUDE\.md/.test(setup) && /## 6\. CLAUDE\.md/.test(cmdBody('init')), 'the CLAUDE.md fill moved to init');
});

// R77: the ENABLE question pre-selects the LIVE state (plan-out) over an install - never the
// stamp's own line - and every installed engine only on a first install. Setup never meets a stamp
// any more (a 1.x global one routes to update first), so the live read is the DELTA walk's.
test('the walk: the playwright ENABLE pre-selection reads plan-out\'s live state in DELTA (R77)', () => {
    const walk = walkBody();
    const mcps = flat(walk.slice(walk.indexOf('## MCPs'), walk.indexOf('## Plugins')));
    assert.match(mcps, /DELTA pre-selects from the LIVE install, never by hand: `jq -c '\.playwright' "\$TMP\/installed\.json"`/);
    assert.match(mcps, /Never pre-select from the stamp's own `playwright-enabled:` line/);
    assert.match(mcps, /pre-selected: `enabled` plus any newly added one in DELTA, every one in FRESH/);
    assert.match(mcps, /18\.7k characters of schema/, 'the per-session cost stays named (R67)');
    // M2: picking a Playwright-built engine installs it in THIS run - the ask says so; init only reports.
    assert.match(mcps, /Picking one IS installing it, and the question says so in one line: the install downloads a picked `firefox` \/ `webkit`/);
    assert.match(mcps, /`\/alfred-code:init` reports one that is not there/);
    assert.match(flat(cmdBody('setup')), /references\/walk\.md` before step 4 and run it in \*\*FRESH\*\*/);
    assert.match(flat(cmdBody('configure')), /references\/walk\.md` before step 3 and run it in \*\*DELTA\*\*/);
    assert.match(cmdBody('configure'), /--installed-only --print-plan --plan-out "\$TMP\/installed\.json"/, 'the DELTA walk reads the plan configure wrote');
});

test('init: the bootstrap order - read, plan, one machine ask, memory, captures inline, CLAUDE.md; no sentry', () => {
    const init = cmdBody('init');
    // M6: a fresh uv lands off the shell's PATH - step 4's import needs uvx, so it gets the prefix too.
    assert.match(flat(init), /EVERY later command of this run carries that directory first - `PATH="<dir>:\$PATH" <command>` - step 3's `after uv` commands and step 4's `memory\.js init` alike/);
    // The hook count, stated once per table: the manifest ships seventeen.
    assert.match(flat(walkBody()), /Recommended \(FRESH\) = all seventeen:.*\*\*None\*\* names all seventeen/);
    const order = ['## 1. Read the install', '## 2. The plan', '## 3. Machine installs - ONE ask', '## 4. Memory', '## 5. Captures', '## 6. CLAUDE.md'].map((h) => init.indexOf(h));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `the six steps in order: ${order}`);
    assert.match(init, /install\/alfred-code\.js" update --source "\$TMP\/repo" --installed-only --print-plan --plan-out "\$TMP\/installed\.json"/);
    assert.match(init, /scripts\/init-plan\.js" --installed "\$TMP\/installed\.json" --root \./);
    assert.match(init, /scripts\/install\/memory\.js" init --project-root \. --level <answer>/);
    assert.match(flat(init), /ONE AskUserQuestion, multi-select, one option per `missing`/);
    // Task 24: claude-hud's status line + compact layout rides that same ask - no ask of its own.
    assert.match(flat(init), /`claude-hud status line \+ compact layout` is one of those lines: its command \(`hud-statusline\.js`\)/);
    assert.match(flat(init), /A `skip` line is not an option either/);
    // Fix round 1 (I-3, M-3): a stale line is a `refresh` option, backed up first; the keys the row adds are named.
    assert.match(flat(init), /one option per `missing` \/ `missing after uv` \/ `refresh` line/);
    assert.match(flat(init), /`# adds <n> claude-hud keys: <names>`/);
    assert.match(flat(init), /settings\.json\.bak\.<time>/);
    assert.match(flat(init), /follow it inline, start to finish - never a Skill call/);
    // The four captures, in the brief's order, are the SCRIPT's table - the body cites the script.
    const { CAPTURES } = require('./init-plan.js');
    assert.deepStrictEqual(CAPTURES.map((c) => c.skill), ['alfred-capture-related-projects', 'alfred-capture-architecture', 'alfred-capture-code-style', 'alfred-capture-agent-capabilities']);
    assert.deepStrictEqual(CAPTURES.map((c) => c.seat), ['related-project-analyzer', 'architecture-analyzer', 'code-style-analyzer', null]);
    assert.ok(!/sentry/i.test(init), 'no sentry step (R28)');
    assert.ok(!/allowed-tools/.test(init.split('---')[1]), 'no command carries allowed-tools');
});

// The router's three states, each read from a file rather than inferred.
test('the router: nothing installed -> setup, installed but never initialised -> init, initialised -> no bootstrap', () => {
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    assert.match(router, /\*\*Installed\*\* = an install record in this repo or its git top level: `alfred-code\.stamp`, the 1\.x `claude-stack\.stamp`, or a copied `hooks\/docs\.js`/); // legacy-name
    // R90 N1: a 1.x global install is routed to update, which moves it into the project.
    assert.match(router, /`legacy-global`/);
    assert.match(router, /Legacy global -> `\/alfred-code:update`, whatever the ask/);
    assert.ok(!/project mode only/.test(router), 'validate runs at every scope');
    // I1: the state is ONE script read - the stamp's `initialised:` line only init writes - never the
    // memory switch alone, which an update or the user's own settings could flip.
    assert.match(router, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\/stamp\.js" state \./);
    assert.match(router, /\*\*Initialised\*\* = the stamp's `initialised:` line holds a date/);
    assert.match(router, /`initialised: pending`/);
    assert.match(router, /a stamp from before that line counts as initialised when `autoMemoryEnabled: false`/);
    assert.match(router, /Not installed -> `\/alfred-code:setup`/);
    assert.match(router, /Installed, never initialised -> `\/alfred-code:init`/);
    assert.match(router, /Initialised -> no bootstrap/);
    // The same record list the hook gate and init read - one definition of 'set up'.
    const { INSTALL_RECORDS } = require('../stack/hooks/hook-prelude.js');
    assert.deepStrictEqual(INSTALL_RECORDS.map((r) => r.join('/')), ['alfred-code.stamp', 'claude-stack.stamp', 'hooks/docs.js']); // legacy-name
});

// `claude plugin eval` has no offline mode, so the checks it would run before billing are run here:
// every case parses, every grader compiles, and the two routing cases grade the command the body names.
test('the plugin evals pass their offline checks, and the routing graders match the bodies they grade', () => {
    const dir = path.join(PLUGIN_DIR, 'evals');
    const cases = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'results').map((e) => e.name);
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    const front = (text) => (/^---\n([\s\S]*?)\n---\n/.exec(text) || [])[1];
    for (const name of cases)
    {
        assert.ok(readme.includes(`\`${name}\``), `the README table names ${name}`);
        const prompt = fs.readFileSync(path.join(dir, name, 'prompt.md'), 'utf8');
        assert.match(front(prompt) || '', /^max_turns: \d+$/m, `${name}/prompt.md has max_turns`);
        assert.ok(prompt.split(/\n---\n/).slice(1).join('').trim(), `${name}/prompt.md has a user turn`);
        const graders = fs.readdirSync(path.join(dir, name, 'graders')).filter((f) => f.endsWith('.md'));
        assert.ok(graders.length, `${name} has graders`);
        for (const g of graders)
        {
            const fm = front(fs.readFileSync(path.join(dir, name, 'graders', g), 'utf8'));
            assert.ok(fm, `${name}/${g} has frontmatter`);
            const type = (/^type: (\S+)$/m.exec(fm) || [])[1];
            assert.ok(['regex', 'llm', 'tool_used'].includes(type), `${name}/${g}: type ${type}`);
            if (type === 'tool_used') assert.match(fm, /^tool: \S+$/m, `${name}/${g}: tool_used names its tool`);
            if (type !== 'regex') continue;
            assert.match(fm, /^target: (last_message|files)$/m, `${name}/${g}: a target the CLI accepts`);
            const pattern = JSON.parse((/^pattern: (".*")$/m.exec(fm) || [])[1]);
            assert.doesNotThrow(() => new RegExp(pattern), `${name}/${g}: the pattern compiles`);
        }
    }
    const pattern = (c, g) => JSON.parse(/^pattern: (".*")$/m.exec(fs.readFileSync(path.join(dir, c, 'graders', g), 'utf8'))[1]);
    assert.strictEqual(pattern('status-no-install', 'routes-to-setup.md'), '/alfred-code:setup');
    assert.match(flat(cmdBody('status')), /`not-installed` -> say so and route to `\/alfred-code:setup`/);
    assert.strictEqual(pattern('router-hands-back-one-command', 'names-the-command.md'), '/alfred-code:setup');
    assert.match(flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8')), /Not installed -> `\/alfred-code:setup`/);
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
    // a walk-row note never outlives its opt-in item
    for (const [layer, notes] of Object.entries((recs.general || {}).notes || {}))
        for (const name of Object.keys(notes))
            assert.ok(((recs.general || {})[layer] || []).includes(name), `general.notes.${layer}.${name} names no general ${layer} item`);
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
    assert.ok((recs.always.skills || []).includes('alfred-task-solve-cross'), 'always seeds the orchestrator');
});

// A capture skill fans out its own read-only seat, and the graph cannot express that edge
// (skills carry only mcp/plugin edges by design) - so the pairing lives in the seeds and nothing
// but this test keeps it honest. A seeded capture skill without its seat installs a flow that
// has no one to dispatch (how code-style-analyzer went unseeded).
test('every always-seeded capture skill seeds the seat it fans out', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const PAIRS = {
        'alfred-capture-architecture': 'architecture-analyzer',
        'alfred-capture-architecture-quality': 'architecture-analyzer',
        'alfred-capture-code-quality': 'code-quality-analyzer',
        'alfred-capture-code-style': 'code-style-analyzer',
        'alfred-capture-test-coverage': 'test-coverage-analyzer',
        'alfred-capture-related-projects': 'related-project-analyzer',
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
    assert.ok(!(recs.always.skills || []).includes('alfred-capture-related-projects'), 'always must not seed the skill');
    assert.ok(!(recs.always.agents || []).includes('related-project-analyzer'), 'always must not seed the seat');
    assert.ok((recs.general.skills || []).includes('alfred-capture-related-projects'), 'general carries the skill');
    assert.ok((recs.general.agents || []).includes('related-project-analyzer'), 'general carries the seat');
    for (const sel of Object.values(recs.stacks))
    {
        assert.ok(!(sel.skills || []).includes('alfred-capture-related-projects'), 'no stack seeds the skill');
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
    // The table command lives in the ONE walk text both walks read (Task 18b).
    const body = walkBody();
    const tableCmds = body.split('\n').filter(l => l.includes('--table <layer>'));
    assert.ok(tableCmds.length >= 2, 'the walk prescribes the table command for FRESH and DELTA');
    for (const line of tableCmds)
    {
        assert.ok(!/--table <layer>[^`]*>\s*"?\$TMP/.test(line), `the walk must not redirect the table into a file: ${line.trim().slice(0, 120)}`);
    }
    assert.match(body, /total: N <layer>/, 'the walk carries the footer self-check');
    for (const name of ['setup', 'configure'])
    {
        const cmd = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/walk\.md/, `${name} runs the shared walk`);
        assert.ok(!cmd.split('\n').some((l) => l.includes('--table <layer>')), `${name} restates no table command of its own`);
    }
});

// A plugin's own defaults are not this stack's recommendation, and the stack must not force one:
// the ASK belongs to the plugins layer's own turn (that is where the user is deciding about
// plugins), the APPLY to the install step - the plugin has to be on disk first. Same shape as the
// environment choices, asked up front and merged once the installer has run. Both halves are found
// by NAME and tied together by the apply subsection's own number: the ladders renumber whenever a
// step is inserted, and what this pins is where the two halves sit, not what they are numbered.
test('both walks ask the plugin-settings question in the plugins layer and apply it after install', () => {
    // The ASK is the shared walk's Plugins layer; everything before its 'After the installer'
    // paragraph is the layer turn, which must not write.
    const walk = walkBody();
    const walkLayer = walk.slice(walk.indexOf('## Plugins'));
    const ask = walkLayer.slice(0, walkLayer.indexOf('After the installer'));
    assert.ok(ask.length > 0 && ask.length < walkLayer.length, 'the walk names the after-install apply');
    assert.match(ask, /Plugin settings - part of this layer's turn/, 'the walk asks inside the plugins layer');
    assert.match(ask, /plugin-settings\.js/, 'the walk reports with the tool, never a hand edit');
    assert.match(ask, /meta\/plugin-settings\.json/, 'the walk reads the snapshot catalog');
    assert.match(ask, /Apply recommended/, 'the walk offers apply');
    assert.match(ask, /Apply and replace differing/, 'the walk offers replace');
    assert.match(ask, /\*\*Skip\*\*/, 'the walk offers skip');
    assert.ok(!/--apply/.test(ask), 'the walk does not write before the plugin is installed');
    for (const name of ['setup', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        const pluginsAt = body.search(/^## \d+\. Plugins$/m);
        assert.ok(pluginsAt >= 0, `${name} has a numbered plugins layer`);
        const rest = body.slice(pluginsAt + 1);
        const nextHeading = rest.search(/^## /m);
        const layer = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
        assert.match(layer, /walk\.md's Plugins layer, the plugin-settings ask included/, `${name} points its plugins step at the walk`);
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
    for (const name of ['setup', 'init', 'update', 'configure', 'validate'])
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
    for (const file of ['commands/setup.md', 'commands/init.md', 'commands/update.md', 'commands/configure.md', 'commands/validate.md', 'references/source-protocol.md'])
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

// R95 (Task 18b fix round 1): the review measured a loop in a git worktree of an installed checkout -
// the state read named the main checkout's install, every reader after it read the worktree's empty
// `.claude`, so update named setup and setup named update. Every gate now reads the worktree state and
// stops on ONE line naming the checkout to run its own command from; none goes on to a reader.
test('every command gate and the router stop in a worktree of an installed checkout, naming the main checkout (R95)', () =>
{
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    assert.match(router, /`worktree-of-installed <main>`/);
    assert.match(router, /Worktree of an installed checkout -> no command here: 'This is a git worktree of <main>, which holds the install - run \/alfred-code:<the command the ask needs> from there'/);
    for (const name of ['setup', 'init', 'update', 'configure', 'validate', 'status'])
    {
        const body = flat(cmdBody(name));
        assert.match(body, /node "(\$\{CLAUDE_PLUGIN_ROOT\}|\$TMP\/repo)\/scripts\/install\/stamp\.js" state \./, `${name} reads the state`);
        const line = new RegExp(`\`worktree-of-installed <main>\` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:${name} from there' and stop`);
        assert.match(body, line, `${name} stops in a worktree with its own command named`);
    }
    // M5: validate's scope comes from the same script, which reads either stamp name - never a grep.
    const validate = cmdBody('validate');
    assert.match(flat(validate), /`<scope>` below is `node "\$TMP\/repo\/scripts\/install\/stamp\.js" scope \.`/);
    assert.ok(!/grep -m1 '\^scope:'/.test(validate), 'no grep of one stamp name');
    // The installer refuses the same tree, so a gate skipped by hand cannot restart the loop either.
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'install', 'alfred-code.js'), 'utf8'), /this is a git worktree of \$\{worktreeOf\}, which holds the install - run the installer from there/);
});

// Task 18b fix round 2. N5: 'Installed' no longer counts a worktree's main checkout - that tree prints
// its own state, defined in the next bullet. R99: at every scope the stack keys settings.local.json
// holds apply over settings.json, so status reads them that way, and configure reports a key the move
// kept by its length (N3), never its value.
test('router, status and configure read the local stack keys at every scope, and a worktree is its own state (N5, R99, N3)', () =>
{
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    const installed = (/- \*\*Installed\*\* = ([^]*?)- \*\*Worktree/.exec(router) || [])[1] || '';
    assert.ok(installed, 'the Installed definition is there');
    assert.ok(!/worktree/i.test(installed), `Installed still counts a worktree's main checkout: ${installed}`);
    const status = flat(cmdBody('status'));
    assert.match(status, /at EVERY scope a stack key `settings\.local\.json` holds applies over `settings\.json`/);
    assert.match(status, /\*\*Environment\*\* - the install's knobs, one row each, from the STACK VIEW/);
    assert.match(status, /`ALFRED_CODE_HOOKS_OFF` read from the stack view/);
    const configure = flat(cmdBody('configure'));
    assert.match(configure, /`<key> stays here \(your value, <n> chars\)/);
    assert.ok(!/your value <v>/.test(configure), 'configure still reports a kept value');
});

// Task 18b: status runs the RUNNING plugin's own scripts (no snapshot), finds the install by the
// stamp state, and reports health from the CLI's own error fields, usage, and credentials by presence.
test('status: read-only from the running plugin - stamp state, health columns, usage, presence only', () =>
{
    const status = cmdBody('status');
    const f = flat(status);
    assert.match(status, STATE_READ, 'status finds the install by the stamp state');
    assert.ok(!/\$TMP\/repo/.test(status), 'status resolves no snapshot - every script is the running plugin\'s');
    assert.ok(!/global mode|project mode/i.test(status), 'status has no global mode');
    assert.match(f, /Never test for `\.claude\/skills` or `\.claude\/agents`: a plugin-route install can have neither/);
    assert.match(f, /`legacy-global` -> a 1\.x global install whose stamp still sits in the account dir: say so and route to `\/alfred-code:update`/);
    assert.match(status, /"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/library-check\.js" --project \. --source "\$\{CLAUDE_PLUGIN_ROOT\}" --json/);
    assert.match(f, /When `invalid` is above 0, one more line: `invalid: <n> stamp name\(s\) are not valid item names/);
    assert.match(f, /`health` is `ok` when the row's `errors` list is empty or absent, else the `type` of each `errorDetails` entry/);
    assert.match(f, /The `health` column is ONE `claude mcp list` call/);
    assert.match(status, /scripts\/analyze-usage\.js" "\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/projects\/\$\(pwd \| sed 's\/\[\^a-zA-Z0-9\]\/-\/g'\)" --inventory \.claude/);
    assert.match(status, /stack\/hooks\/guard-secret-value\.js" --presence /);
    for (const row of ['stack version \\(stamp\\)', 'running plugin', 'scope', 'docs root', 'initialised'])
        assert.match(status, new RegExp(`^\\| ${row} \\|`, 'm'), `the general table has its ${row} row`);
    // The transcript folder is named the way the memory import names it - one encoding, two readers.
    const sedClass = /sed 's\/(\[\^a-zA-Z0-9\])\/-\/g'/.exec(status)[1];
    const { slugify } = require('./memory-import.js');
    for (const sample of ['/Users/x/My Repo', 'C:\\work\\app.v2', '/tmp/a_b-c'])
        assert.strictEqual(sample.replace(new RegExp(sedClass, 'g'), '-'), slugify(sample), `status and the memory import name ${sample}'s transcript folder alike`);
    // validate reports the same invalid line.
    assert.match(flat(cmdBody('validate')), /An `invalid: N stamp name\(s\) \.\.\.` line is a finding too/);
});

test('the guided walks hold the layer order, the step banners, and the cascade machinery', () => {
    for (const name of ['setup', 'configure', 'validate'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /rules -> agents -> skills -> hooks -> MCPs -> plugins/, `${name} walks the layers in dependency order`);
        assert.match(body, /\[step \d+\/\d+ - /, `${name} announces every step with the n/total banner`);
    }
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--dropped/, 'configure drives the drop cascade through stack-select --dropped');
    assert.match(configure, /orphan:/, 'configure consumes the orphan: lines');
    // The shared walk text carries the same machinery for both modes.
    const walk = flat(walkBody());
    assert.match(walk, /rules -> agents -> skills -> hooks -> MCPs -> plugins/, 'the walk holds the layer order');
    assert.match(walk, /DELTA: `node stack-select\.js --selection raw\.json --dropped dropped\.json`/, 'the DELTA walk drives the drop cascade');
    assert.match(walk, /An `orphan: <category> <name> - <why> \(dropped\); nothing kept still needs it` line/, 'the DELTA walk consumes the orphan: lines');
    assert.match(walk, /a layer turn missing the fenced table is invalid/, 'the table-before-question rule rides the walk');
});

// The install-time twin of validate's judgment gate: a typed add that conflicts with the
// project's stated conventions gets a quote-gated, non-blocking warning at the prereq step.
test('setup and configure carry the brownfield convention-conflict warning gate', () => {
    for (const name of ['setup', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /Convention-conflict warnings/, `${name} has the conflict-warning gate`);
        assert.match(body, /No citable conflict, no\s+warning/, `${name} keeps the citation gate`);
        assert.match(body, /never blocks/, `${name} keeps the warning non-blocking`);
    }
});

test('validate reconciles both ways (--redundant + --missing), walks layers, runs at every scope', () => {
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8');
    assert.match(body, /--redundant/, 'validate drives the remove side through stack-select --redundant');
    assert.match(body, /--missing/, 'validate drives the add side through stack-select --missing');
    assert.match(body, /\[step \d+\/\d+ - /, 'validate announces every step with the n/total banner');
    // Task 18b: every scope keeps its install in the project, so validate refuses none of them.
    assert.ok(!/project mode only/i.test(body), 'validate runs at every scope');
    assert.match(flat(body), /\*\*Every scope\.\*\* A project, user or local install keeps its stamp, its library copies and its settings in the project's `\.claude\/`/);
    assert.match(flat(body), /Find the install with `node "\$TMP\/repo\/scripts\/install\/stamp\.js" state \.`/);
    assert.match(body, /install\/alfred-code\.js" update --source "\$TMP\/repo" --scope <scope> --installed-only --print-plan --plan-out/, 'validate reads the install back at its own scope');
    assert.match(body, /install\/alfred-code\.js" update --source "\$TMP\/repo" --scope <scope> --installed-only \[--add/, 'validate applies the accepted adds and removes via the seed, over the read-back, at its own scope');
    assert.ok(!/--scope project --installed-only/.test(body), 'no apply pinned to project scope');
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
    for (const name of ['setup', 'init', 'update', 'configure'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/source-protocol\.md/, `${name} cites the shared source-protocol.md via the plugin root`);
    }
    const router = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8');
    assert.match(router.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1], /name:\s*alfred-code/, 'router skill named like the plugin -> displays bare /alfred-code');
    for (const name of ['setup', 'init', 'update', 'configure', 'validate', 'status'])
    {
        assert.match(router, new RegExp('/alfred-code:' + name), `/alfred-code routes to /alfred-code:${name}`);
    }
});

test('the walk and status REPORT the derivation - they never restate what the installer writes', () => {
    // Phase 8 R1: four prose descriptions of one pipeline is how a route change reached three of them
    // and not the fourth. init shows the derived off-state before installing; status takes the
    // stack's share of the floor, seats included, from the same script.
    const read = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
    assert.match(read('setup'), /scripts\/derive-state\.js" --selection "\$TMP\/selection\.txt" --source "\$TMP\/repo"/);
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

test('configure emits hook none when its Hooks area was walked, and update finds a 1.x global install through the preflight', () =>
{
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--emit "\$TMP\/selection\.txt" --check \[--hooks-answered\]/);
    // R51 / I8: the preflight reads the account's 1.x stamp itself - update has no global mode.
    const update = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8'));
    assert.ok(!/Global mode:/.test(update), 'update has no global mode left');
    assert.match(update, /A `--space` install passes `--config-dir ~\/\.claude-<space>`, so a 1\.x global stamp is looked for in that account/);
    assert.match(update, /A `legacy-stamp: <file> - a 1\.x global install; \.\.\.` line means the baseline is the account's 1\.x stamp: say once that this update moves it into the project/);
    assert.match(update, /`settings\.local\.json` laid over `settings\.json` at local scope/);
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

// A 1.x install's FIRST 2.0.0 run is driven by the 1.x update command's own body (v1.3.0), which no
// release can edit. It reports from ONE grep of the installer log - the pattern below, frozen as it
// shipped - and pastes verbatim every `warn:` line `update-preflight.js --log` prints: one per `!!` line
// of the log, from the snapshot the run installs from (this repo's script). A line only the 2.0.0 grep
// carries is never seen on that run, so each line a user must act on carries the `!!` marker both read.
const GREP_1X = /installed\/refreshed this run|mcp repaired:|plugin [A-Za-z0-9_.-]+:|plugin pruned|installed-only: (required|adopting|keeping|adding|dropping|every hook)|names nothing this release ships|was dropped from this install|settings\.json env:|docs (migration|domain)|memory:|memory import:|autoMemoryEnabled|=set \(|=absent|serena project index|!!|overwriting a hand-edited copy/;
const OLD_KEY = 'claude-stack'; // legacy-name
const COPY_ENV = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };

// What each update body shows of one installer log: `first` - the 1.x body's grep and the `warn:` lines
// the preflight prints over the log; `current` - the lines update.md's own grep keeps.
function reportOf(out)
{
    const os = require('node:os');
    const { execFileSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-report-'));
    try
    {
        const log = path.join(dir, 'install.log');
        fs.writeFileSync(log, out);
        const warn = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update-preflight.js'), '--log', log], { encoding: 'utf8' })
            .split('\n').filter((l) => l.startsWith('warn: ')).map((l) => l.slice('warn: '.length));
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8');
        const current = new RegExp(body.match(/grep -aE '([^']+)' "\$TMP\/install\.log"/)[1]);
        const lines = out.split('\n');
        return { lines, first: { grep: lines.filter((l) => GREP_1X.test(l)), warn }, current: lines.filter((l) => current.test(l)) };
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// The line of `out` carrying `text` reaches the user through both bodies - the 1.x one's grep AND its
// pasted `warn:` lines - with the wording after the marker unchanged (`start` is the line's own first
// words when `text` is only its tail). `firstRun: false` is a line the 1.x body cannot meet, checked
// against the current grep alone.
function assertSurfaced(report, text, { firstRun = true, start = text } = {})
{
    const line = report.lines.find((l) => l.includes(text));
    assert.ok(line, `no log line carries '${text}':\n${report.lines.join('\n')}`);
    assert.ok(report.current.includes(line), `update.md's grep drops: ${line}`);
    if (!firstRun) return;
    const marked = line.indexOf('!! ') > -1 ? line.slice(line.indexOf('!! ') + 3).trimEnd() : '';
    assert.ok(marked.startsWith(start) && marked.endsWith(text), `not marked for the 1.x body, or reworded after the marker: ${line}`);
    assert.ok(report.first.grep.includes(line), `the 1.x body's grep drops: ${line}`);
    assert.ok(report.first.warn.includes(line.trim()), `update-preflight --log does not forward: ${line}\nwarn: ${report.first.warn.join('\nwarn: ')}`);
}

// A-I2 / A-I3 / A-I4 (re-review): the three migration lines print on the first 2.0.0 run of a 1.x global
// install - the run the 1.x body drives, passing a model-judged --scope.
test('update: a 1.x install\'s first 2.0.0 run shows the migration lines through the 1.x body\'s own filters (A-I2, A-I3, A-I4)', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const { out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        args: ['--scope', 'project'],
        plugins: JSON.stringify([OLD_KEY, `${OLD_KEY}-hooks`, 'context7-local'].map((n) => ({ id: `${n}@${OLD_KEY}`, version: '1.3.0', scope: 'user', enabled: true }))),
        prepare: (repo, work) =>
        {
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', `${OLD_KEY}.stamp`), 'sha: abc\nversion: 1.3.0\nscope: global\n');
            fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'docs.js'), '');
        },
    });
    const report = reportOf(out);
    assertSurfaced(report, 'context7-local removed - if you ran /mcp disable context7 for it, run /mcp enable context7');
    assertSurfaced(report, 'core moved to alfred-code at user scope - other projects on this account keep their 1.x seat denies until each runs /alfred-code:update');
    assertSurfaced(report, 'claude-hud has no status line yet - run /alfred-code:init to set it up');
});

// N1 (re-review): C10's stale user-scope registration (the line carrying the command to run), A-M2's kept
// and unreadable lines and C11's here-only switch-off reach neither body without a marker. C12's move
// off local scope cannot meet the 1.x body: 1.x wrote no local scope (its --scope took project or
// global), and the move fires only on a stamp that says local - so the current grep alone carries it.
test('update: the stale-registration, kept, unreadable and here-only lines reach both update bodies; the local move reaches the current one (N1)', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const P = require('./install/plugins.js');
    const account = (work, text) => { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', '.claude.json'), text); };
    const serena = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--from', 'serena-agent@1.6.0', 'serena', 'start-mcp-server', '--project-from-cwd'], env: {} };
    const stale = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV, args: ['--scope', 'user', '--memory-level', 'project'],
        prepare: (repo, work) => account(work, JSON.stringify({ mcpServers: { serena, memory: { type: 'stdio', command: 'node', args: ['my-memory.js'], env: {} } } })),
    }).out;
    const unreadable = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV, args: ['--scope', 'user', '--memory-level', 'project'],
        prepare: (repo, work) => account(work, '{not json'),
    }).out;
    const logs = [];
    const row = (scope, enabled = true) => ({ name: 'playwright-chrome', marketplace: 'envoydev', version: '2.0.0', scope, enabled });
    P.engineStandDown({ rows: [row('user')], market: 'envoydev', scope: 'user', engines: ['chrome'], hereOnly: true, isOn: () => undefined, cli: () => true, log: (m) => logs.push(m) });
    P.moveLocalRows({ plugins: ['serena@envoydev'], rows: [{ ...row('local'), name: 'serena' }], scope: 'project', cli: () => true, log: (m) => logs.push(m) });
    const report = reportOf([stale, unreadable, ...logs.map((m) => `==> ${m}`)].join('\n'));
    assertSurfaced(report, 'mcp: serena still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run /alfred-code:update: claude mcp remove serena -s user');
    assertSurfaced(report, 'mcp memory: the user-scope registration is not the stack\'s (another server under the same name) - kept; if it should go: claude mcp remove memory -s user');
    assertSurfaced(report, '.claude.json could not be read - no user-scope registration was removed; fix the file and re-run', { start: 'mcp: /' });
    assertSurfaced(report, 'plugin disabled [project]: playwright-chrome@envoydev (the copy route registers it in .mcp.json; this project only - the user-scope install stays on for every other project)');
    assertSurfaced(report, 'plugin moved [local -> project]: serena@envoydev', { firstRun: false });
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

// R109: superpowers left every stack selection surface. It belongs to another marketplace, so this is
// no retirement - the seed tests (install-plugins.test.js) pin that no run touches an installed copy.
test('superpowers is on no stack selection surface', () => {
    const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const manifest = JSON.parse(read('meta/stack-manifest.json'));
    assert.ok(!manifest.plugins.some((p) => /^superpowers@/.test(p.id)), 'the manifest plugin catalog');
    for (const rel of ['meta/recommendations.json', 'meta/evidence.json'])
        assert.doesNotMatch(read(rel), /superpowers/, rel);
    assert.ok(!JSON.parse(read('meta/stack-graph.json')).catalog.plugins.includes('superpowers'), 'the graph catalog');
    for (const f of fs.readdirSync(path.join(PLUGIN_DIR, 'commands')).map((c) => `setup-plugin/commands/${c}`).concat('setup-plugin/references/walk.md'))
        assert.doesNotMatch(read(f), /`superpowers`/, f);
    const html = read('docs/alfred-code.html');
    assert.doesNotMatch(html, /pluginOrder = \[[^\]]*superpowers/, 'the HTML plugin order');
    assert.doesNotMatch(html, /"superpowers":\s*\{/, 'the HTML plugin card');
    assert.doesNotMatch(html, /\["superpowers:/, 'the HTML skill rows');
});

// F4 re-review N2: C10 (registrationScope, mcp.js) removed the --scope user full-copy-route refusal
// on `--memory-level project` - configure.md must not tell the model to hide that row any more, and
// the HTML catalog must not repeat the same stale claim.
test('N2: configure.md and the HTML catalog no longer claim --memory-level project is refused at --scope user', () => {
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.doesNotMatch(configure, /drop the `project` row/, 'configure.md must not tell the walk to hide the project level');
    assert.doesNotMatch(configure, /the installer\s*\nrefuses it there/, 'configure.md must not claim a user-scope refusal');
    assert.match(configure, /project.*is safe there too/s, 'configure.md must say the project level is safe at every scope');

    const html = fs.readFileSync(path.join(ROOT, 'docs', 'alfred-code.html'), 'utf8');
    assert.doesNotMatch(html, /only the full copy route refuses it at user scope/, 'the HTML memory row must not repeat the stale refusal claim');
});

// F4 re-review N9: hudStatusLineMissing (plugins.js) fires whenever claude-hud is installed - this
// run OR already - and the account has no statusLine, not only on a fresh install this run.
test('N9: update.md states the claude-hud status-line line prints on every run, not only when installed this run', () => {
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'update.md'), 'utf8');
    assert.doesNotMatch(body, /When claude-hud is installed this run and the account has no/, 'update.md must not narrow the trigger to a fresh install this run');
    assert.match(body, /claude-hud is installed - this run or already/, 'update.md must say the line fires on every run while claude-hud is installed and statusLine is missing');
});
