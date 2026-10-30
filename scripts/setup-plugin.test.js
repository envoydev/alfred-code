'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { foreignEntry } = require('./install/plugins.js');

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
    assert.ok(Array.isArray(core.commands) && core.commands.length === 6, 'the guided commands ship from the core - init and uninstall among them');
    assert.ok(core.commands.includes('./setup-plugin/commands/init.md') && !core.commands.includes('./setup-plugin/commands/setup.md'), 'setup merged into init (2026-10-17)');
    // preferred-tools is fetched from its own repo (plugins.js foreignEntry): the marketplace's plugin, not the stack's.
    for (const p of mp.plugins.filter((x) => !foreignEntry(x)))
    {
        assert.strictEqual(p.source, './', `${p.name} shares the repo root as its source`);
        assert.strictEqual(p.strict, false, `${p.name} carries no plugin.json of its own`);
        assert.ok(typeof p.description === 'string' && p.description.trim() !== '');
        for (const rel of [...(p.commands || []), ...(p.skills || []), ...(p.agents || [])])
            assert.ok(fs.existsSync(path.join(ROOT, rel)), `${p.name} lists a path that does not exist: ${rel}`);
    }
    assert.strictEqual(mp.plugins.find(x => x.name === 'alfred-code-hooks'), undefined, 'no hooks entry - the hooks ride the core');
    assert.ok(JSON.stringify(core.hooks).includes('stack/hooks/shell-guards.js') && JSON.stringify(core.hooks).includes('stack/hooks/file-guards.js'), 'the core declares the stack hooks INLINE, so nothing sits at the shared root');
});

test('plugin.json is valid, the six commands are listed, and the router skill exists', () => {
    const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(pj.name, 'alfred-code');
    assert.ok(typeof pj.version === 'string' && pj.version.trim() !== '');
    assert.ok(typeof pj.description === 'string' && pj.description.trim() !== '');
    // Plugin COMMANDS display namespaced-only (/alfred-code:init); plugin SKILLS display bare -
    // so the workers must be commands and the router a skill named exactly like the plugin
    // (bare /alfred-code, no /alfred-code:alfred-code stutter). Empirically proven layout.
    assert.deepStrictEqual(pj.commands, ['./commands/init.md', './commands/update.md', './commands/configure.md', './commands/validate.md', './commands/status.md', './commands/uninstall.md']);
    for (const name of ['init', 'update', 'configure', 'validate', 'status', 'uninstall'])
    {
        assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`)), `the /alfred-code:${name} command exists`);
    }
    assert.ok(!fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'setup.md')), 'no setup command - it merged into init (2026-10-17)');
    assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md')), 'the /alfred-code router skill exists');
    assert.ok(!fs.existsSync(path.join(PLUGIN_DIR, 'commands', 'alfred-code.md')), 'no router COMMAND - a command named like the plugin displays as the /alfred-code:alfred-code stutter');
});

// Task 18a, then 2026-10-17: init is ONE command with two phases - the install (the selection walk and the install,
// ending on a restart) and the one-time bootstrap the user types in the session after it. init.md is the router;
// each phase is its own reference file, read whole by the run that is that phase.
const cmdBody = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
const refBody = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'references', `${name}.md`), 'utf8');
const installBody = () => refBody('init-install');
const bootstrapBody = () => refBody('init-bootstrap');
// What an init run can read: the router plus both phase files.
const initText = () => [cmdBody('init'), installBody(), bootstrapBody()].join('\n');
// Audit 2026-10-20 C15: update.md is a router too - the gate and the order of calls; steps 1-3 live in update-walk.md
// and steps 6-8 in update-close.md, each read in a call the run makes anyway. What an update run can read: all three.
const updateText = () => [cmdBody('update'), refBody('update-walk'), refBody('update-close')].join('\n');
const flat = (text) => text.replace(/\s+/g, ' ');
// Task 18b: the install phase (FRESH) and configure (DELTA) run ONE walk text, so the layer rules live there.
const walkBody = () => fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'walk.md'), 'utf8');
const STATE_READ = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\/stamp\.js" state \./;

test('init is one command with two phases: the router reads the state and loads ONE phase file - manual-only', () => {
    const init = cmdBody('init');
    assert.match(init, /^---\n[\s\S]*?^disable-model-invocation: true$[\s\S]*?^---$/m, 'init stays manual-only');
    assert.match(installBody(), /^## 10\. Install$/m, 'the walk lives in the install phase');
    assert.ok(!/^## \d+\. Install$/m.test(bootstrapBody()), 'the bootstrap never installs');
    assert.ok(!/^## \d+\. /m.test(init), 'the router holds no step of its own');
    // The phase is the install state, read the way the hooks read it - the stamp state.
    assert.match(init, STATE_READ);
    const f = flat(init);
    assert.match(f, /`not-installed` -> the INSTALL phase/);
    assert.match(f, /`installed` or `initialised` -> the BOOTSTRAP phase - unless the install phase ran in THIS session: then stop, name the restart/);
    assert.match(f, /INSTALL -> read `\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/init-install\.md` and `\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/stack-detection\.md` in ONE Bash `cat`/);
    assert.match(f, /BOOTSTRAP -> the same for `\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/init-bootstrap\.md`/);
    assert.match(f, /Read only the file of the phase this run is/);
    assert.ok(!/references\/init-(install|bootstrap)\.md/.test(installBody() + bootstrapBody()), 'neither phase reads the other');
    assert.ok(!/legacy-global/.test(initText()), 'no state for an account-dir install is left');
    assert.ok(!/alfred-code:setup/.test(initText()), 'nothing names the merged command');
});

// setup shows what the project needs, and why, BEFORE the walk: validate's two checks in their
// fresh-install mode (no --installed), plus the evidence scan's labels in the tables.
test('init install phase: the suggestions are validate\'s checks in fresh-install mode, pasted with their reasons', () => {
    const setup = installBody();
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

test('init install phase: no memory level, the bootstrap prerequisites deferred, and a close that ends on the restart and init again', () => {
    const setup = installBody();
    const install = setup.slice(setup.indexOf('## 10. Install'), setup.indexOf('## Post-check'));
    assert.match(install, /install\/alfred-code\.js" install --source "\$TMP\/repo" --scope <scope>/);
    assert.ok(!/--memory-level/.test(install.split('\n').find((l) => l.includes('- **Any OS:**'))), 'the level is init\'s question');
    assert.match(setup, /--check --defer-init/, 'the language servers are init\'s to install, never setup\'s blockers');
    const close = setup.slice(setup.indexOf('## Post-check'));
    assert.match(flat(close), /\*\*Restart, then `\/alfred-code:init` again\*\*/);
    assert.match(flat(close), /Nothing is pending on this run - these are yours to run when you choose\./);
    assert.ok(!/## \d+\. AGENTS\.md/.test(setup) && /## 6\. AGENTS\.md/.test(bootstrapBody()), 'the AGENTS.md fill is the bootstrap phase\'s');
});

// 2.10.1 (spec N5): the stack ships no MCP server, so no walk carries a server layer or a server ask, and no
// command passes a server flag; the FRESH / DELTA modes are unchanged.
test('the walk: no MCP layer, no server ask, no server flag', () => {
    const walk = walkBody();
    assert.ok(!walk.includes('\n## MCPs\n'), 'no MCPs section');
    for (const b of askBlocks(walk)) assert.doesNotMatch(b[0], /browser|Playwright|mobile-control|windows-control|macos-control|memory level/i, b[0]);
    for (const [cmd, body] of [['init install phase', installBody()], ['configure', cmdBody('configure')], ['validate', cmdBody('validate')]])
        assert.doesNotMatch(body, /--browser-enabled|--browsers |--memory-level|--table mcps/, `${cmd} passes no server flag`);
    assert.match(flat(installBody()), /references\/walk\.md` before step 4 and run it in \*\*FRESH\*\*/);
    assert.match(flat(cmdBody('configure')), /references\/walk\.md` AT step 3, never earlier - [^*]*and run it in \*\*DELTA\*\*/);
    assert.match(cmdBody('configure'), /--installed-only --print-plan --plan-out "\$TMP\/installed\.json"/, 'the DELTA walk reads the plan configure wrote');
});

test('init bootstrap phase: the order - read, plan, one machine ask, memory and navigation, captures inline, AGENTS.md; no sentry', () => {
    const init = bootstrapBody();
    // 2.10.1: no server runtime to install and no memory import - the stack ships no MCP server.
    assert.doesNotMatch(init, /\buvx?\b|memory\.js|--level/, 'no uv, no memory step');
    // The hook count, stated once per table: the manifest ships eighteen (forge-session joined 2026-10-23, memory-session
    // retired 2026-10-24).
    assert.match(flat(walkBody()), /Recommended \(FRESH\) = all eighteen:.*\*\*None\*\* names all eighteen/);
    const order = ['## 1. Read the install', '## 2. The plan', '## 3. Machine installs - ONE ask', '## 4. Memory and navigation', '## 5. Captures', '## 6. AGENTS.md'].map((h) => init.indexOf(h));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `the six steps in order: ${order}`);
    // Spec P1 + P2: the step reads tools.js modes, asks the two templates, and applies a changed memory mode in one call.
    assert.match(init, /tools\.js" modes --project \. --lsp/);
    assert.match(init, /install\/alfred-code\.js" update --source "\$TMP\/repo" --installed-only --memory <mode>/);
    // Final review C1: the fall-back check previews custom's lines, since the mode is written only by the call after it,
    // and the ranking run asks the job's question even with one candidate.
    for (const body of [init, cmdBody('configure')])
    {
        assert.match(body, /tools\.js" modes --project \. --memory custom/);
        assert.match(flat(body), /even with one server candidate/);
    }
    assert.match(init, /install\/alfred-code\.js" update --source "\$TMP\/repo" --installed-only --print-plan --plan-out "\$TMP\/installed\.json"/);
    assert.match(init, /scripts\/init-plan\.js" --installed "\$TMP\/installed\.json" --root \./);
    // C-T4-01: no pre-selection exists, so the one ask is a single-select and 'Pick which' opens the multi-select.
    assert.match(flat(init), /Otherwise ONE AskUserQuestion - .*'Install all of them \(Recommended\)' - each line's exact command runs, in plan order - 'Pick which' - the next call is a multi-select/);
    // Task 24: claude-hud's status line + compact layout rides that same ask - no ask of its own.
    assert.match(flat(init), /`claude-hud status line \+ compact layout` is one of those lines: its command \(`hud-statusline\.js`\)/);
    assert.match(flat(init), /A `skip` line is not an option either/);
    // Fix round 1 (I-3, M-3): a stale line is a `refresh` option, backed up first; the keys the row adds are named.
    assert.match(flat(init), /one option per `missing` \/ `refresh` line/);
    assert.match(flat(init), /`# adds <n> claude-hud keys: <names>`/);
    assert.match(flat(init), /settings\.json\.bak\.<time>/);
    assert.match(flat(init), /follow it inline, start to finish - never a Skill call/);
    // The captures, in the brief's order, are the SCRIPT's table - the body cites the script. Since the capture-awareness
    // merge (2026-10-29) they are that skill's five parts, the seat parts first and the inventory last.
    const { CAPTURES } = require('./init-plan.js');
    assert.deepStrictEqual(CAPTURES.map((c) => c.skill), Array(5).fill('capture-awareness'));
    assert.deepStrictEqual(CAPTURES.map((c) => c.topic), ['architecture', 'project-code-style', 'project', 'related-projects', 'agents']);
    assert.deepStrictEqual(CAPTURES.map((c) => c.seat), ['architecture-analyzer', 'code-style-analyzer', null, null, null]);
    assert.ok(!/sentry/i.test(init), 'no sentry step (R28)');
    assert.ok(!/allowed-tools/.test(cmdBody('init').split('---')[1]), 'no command carries allowed-tools');
});

// The router's three states, each read from a file rather than inferred.
test('the router: nothing installed -> init (install phase), installed but never initialised -> init (bootstrap), initialised -> no bootstrap', () => {
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    assert.match(router, /\*\*Installed\*\* = an install record in this repo or its git top level: `alfred-code\.stamp` or a copied `hooks\/docs\.js`/);
    assert.ok(!/legacy-global|Legacy global/.test(router), 'no state for an account-dir install is left');
    assert.ok(!/project mode only/.test(router), 'validate runs at every scope');
    // I1: the state is ONE script read - the stamp's `initialised:` line only init writes - never the
    // memory switch alone, which an update or the user's own settings could flip.
    assert.match(router, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\/stamp\.js" state \./);
    assert.match(router, /\*\*Initialised\*\* = the stamp's `initialised:` line holds a date/);
    assert.match(router, /`initialised: pending`/);
    assert.match(router, /a stamp from\s+before that line reads as never initialised/);
    assert.doesNotMatch(router, /autoMemoryEnabled/, 'the memory switch is no sign of a bootstrap since 2.10.1');
    assert.match(router, /Not installed -> `\/alfred-code:init` \(its install phase/);
    assert.match(router, /Installed, never initialised -> `\/alfred-code:init`/);
    assert.match(router, /Initialised -> no bootstrap/);
    // The same record list the hook gate and init read - one definition of 'set up'.
    const { INSTALL_RECORDS } = require('../stack/hooks/hook-prelude.js');
    assert.deepStrictEqual(INSTALL_RECORDS.map((r) => r.join('/')), ['alfred-code.stamp', 'hooks/docs.js']);
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
    assert.strictEqual(pattern('status-no-install', 'routes-to-init.md'), '/alfred-code:init');
    assert.match(flat(cmdBody('status')), /`not-installed` -> say so and route to `\/alfred-code:init`/);
    assert.strictEqual(pattern('router-hands-back-one-command', 'names-the-command.md'), '/alfred-code:init');
    assert.match(flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8')), /Not installed -> `\/alfred-code:init`/);
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
    for (const r of ['alfred-interaction', 'alfred-security', 'alfred-preferences'])
    {
        assert.ok((recs.always.rules || []).includes(r), `always seeds ${r}`);
    }
    // the entry-point orchestrator installs everywhere - previously only the four
    // repair-rule stacks pulled it, so a mobile/data/devops-only install shipped without
    // the skill that drives its own trio.
    assert.ok((recs.always.skills || []).includes('task-solve-cross'), 'always seeds the orchestrator');
});

// A capture skill fans out its own read-only seat, and the graph cannot express that edge
// (skills carry only mcp/plugin edges by design) - so the pairing lives in the seeds and nothing
// but this test keeps it honest. A seeded capture skill without its seat installs a flow that
// has no one to dispatch (how code-style-analyzer went unseeded).
test('every always-seeded capture skill seeds the seat it fans out', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    // capture-quality and capture-awareness fan out one seat per seat part (2026-10-29); the related part's seat is an
    // opt-in that is never seeded, so it pairs with nothing here
    const PAIRS = {
        'capture-awareness': ['architecture-analyzer', 'code-style-analyzer'],
        'capture-quality': ['architecture-analyzer', 'code-quality-analyzer', 'test-coverage-analyzer'],
    };
    for (const [skill, seats] of Object.entries(PAIRS))
    {
        for (const bucket of ['always', 'general'])
        {
            if (!((recs[bucket] || {}).skills || []).includes(skill)) continue;
            for (const seat of seats) assert.ok(((recs[bucket] || {}).agents || []).includes(seat), `${bucket} seeds ${skill} without ${seat}`);
        }
    }
});

// Sibling repos are a property of the PROJECT, not of a stack or of the baseline - a standalone
// repo has none, and no manifest signal can prove otherwise. So the sibling seat is opt-in: it sits
// in `general` (addable in any walk, never flagged redundant, never reported missing) instead of
// `always`, which would install it for everyone and have validate re-add it. The awareness capture
// itself is always (the user's ruling of 2026-10-16 merged the sibling capture into it), and maps the
// siblings in-session where the seat is absent.
test('the sibling seat is optional, never an always-baseline seed - the always awareness capture works without it', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    assert.ok((recs.always.skills || []).includes('capture-awareness'), 'always seeds the awareness capture');
    assert.ok(!(recs.always.agents || []).includes('related-project-analyzer'), 'always must not seed the seat');
    assert.ok((recs.general.agents || []).includes('related-project-analyzer'), 'general carries the seat');
    for (const sel of Object.values(recs.stacks))
        assert.ok(!(sel.agents || []).includes('related-project-analyzer'), 'no stack seeds the seat');
    const related = flat(fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-awareness', 'references', 'related-projects.md'), 'utf8'));
    assert.match(related, /\*\*INLINE\*\* \(chosen - or forced, no question asked: no dispatch, or that seat is absent - it is an opt-in pick, so a project can carry this capture without it\)/);
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
    for (const [name, cmd] of [['init install phase', installBody()], ['configure', cmdBody('configure')]])
    {
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
    assert.match(ask, /'Skip' - nothing changes/, 'the walk offers skip');
    assert.ok(!/--apply/.test(ask), 'the walk does not write before the plugin is installed');
    for (const [name, body] of [['init install phase', installBody()], ['configure', cmdBody('configure')]])
    {
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

test('no MCP server is seeded, proven or addable - the stack ships none, and every one it shipped is retired', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'evidence.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    // 2.10.1 (N1): no rule, skill, seat or hook needs a server, so none is locked in, seeded or offered.
    assert.deepStrictEqual(manifest.mcps, [], 'the catalog lists no server');
    assert.ok(!Object.hasOwn(recs.always, 'mcps'), 'no server locks in');
    const seededBy = Object.entries(recs.stacks).filter(([, sel]) => Object.hasOwn(sel, 'mcps')).map(([st]) => st);
    assert.deepStrictEqual(seededBy, [], 'no stack seeds a server');
    assert.ok(!Object.hasOwn(recs.general || {}, 'mcps'), 'no server is addable');
    assert.deepStrictEqual(evidence.mcps, {}, 'no evidence proves a server');

    // every name the stack ever shipped stays retired, so update prunes an install that still holds one
    const cut = new Set(manifest.retired.mcps);
    for (const server of ['angular-cli', 'appium-mcp', 'chrome-devtools', 'context7-local', 'sentry', 'alfred-navigation', 'alfred-documentation',
        'alfred-memory', 'browser', 'windows-control', 'macos-control', 'mobile-control', 'chrome-control', 'msedge-control', 'firefox-control', 'webkit-control'])
        assert.ok(cut.has(server), `${server} is not in retired.mcps`); // mcp-fixture
});

test('every shipped plugin is suggested somewhere - validate cannot flag what nothing suggests', () => {
    const recs = JSON.parse(fs.readFileSync(RECS, 'utf8'));
    // active:false rows are plugins every install carries beside the core - none since 2.2.0, when claude-hud
    // became an optional pick (recommendations.json always.plugins) - never a pick, so never part of the
    // selectable catalog a suggestion has to reach.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'));
    const shipped = manifest.plugins.filter((r) => r.active !== false).map((r) => r.id.split('@')[0]).sort();
    assert.deepStrictEqual(shipped, ['claude-hud', 'csharp-lsp', 'typescript-lsp'], 'the manifest lists the shipped plugins - 2.0.0 retired the other two picks');

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
    // contract is the opposite.
    const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'evidence.json'), 'utf8')).plugins || {};
    for (const name of Object.keys(evidence)) assert.ok(!general.has(name), `${name} has an evidence row and sits on the never-pre-selected general list`);
    for (const name of ['csharp-lsp', 'typescript-lsp'])
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

for (const name of ['init', 'update', 'configure', 'validate', 'status', 'uninstall'])
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
    for (const name of ['init', 'update', 'configure', 'validate', 'uninstall'])
    {
        const body = name === 'init' ? initText() : name === 'update' ? updateText() : fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /node "\$TMP\/repo\/scripts\/install\/alfred-code\.js" (install|update|uninstall)/,
            `${name} does not run the Node seed`);
        assert.match(body, /ALFRED_CODE_SEED=shell/, `${name} does not name the shell switch`);
        assert.ok(!/- Unix: `bash "\$TMP\/repo\/scripts\/os\/alfred-code\.sh"/.test(body),
            `${name} still offers the twin as a first-class route`);
    }
    // status runs no installer at all, so it names neither.
    const status = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'status.md'), 'utf8');
    assert.ok(!/alfred-code\.(sh|ps1)|install\/alfred-code\.js/.test(status), 'status must stay read-only');
});

// The tool order: status shows the start line the next session gets, validate prints the inventory's rows - both from the
// capture skill's script, at a path this tree ships.
test('status and validate run tools.js from a path this tree has', () => {
    const status = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'status.md'), 'utf8');
    const validate = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8');
    assert.ok(status.includes('node "${CLAUDE_PLUGIN_ROOT}/stack/skills/capture-preferences/scripts/tools.js" order --project .'), 'status runs tools.js order');
    assert.ok(validate.includes('node "$TMP/repo/stack/skills/capture-preferences/scripts/tools.js" validate --project .'), 'validate runs tools.js validate');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js')));
});

// D1: from 2.0.0 the shell seed is refused. The frozen twin cannot resolve a 2.0.0 registration, so
// a body that still RUNS it on `seed=shell` installs a broken release. Every body names the refusal
// line the seed itself prints, and runs no twin.
const D1 = 'the shell installers were removed in 2.0.0 - unset ALFRED_CODE_SEED to use the Node installer';
test('D1: on seed=shell every command body prints the refusal and runs no twin', () => {
    for (const file of ['references/init-install.md', 'references/init-bootstrap.md', 'references/update-walk.md', 'commands/configure.md', 'commands/validate.md', 'commands/uninstall.md', 'references/source-protocol.md'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
        assert.ok(body.includes(D1), `${file} does not print the D1 refusal`);
        assert.ok(!/(bash|pwsh -File) "\$TMP\/repo\/scripts\/os\//.test(body), `${file} still runs the frozen twin`);
    }
});

// A registered marketplace key is the user's own, so a body that READS the user's install never
// spells a stack entry `@envoydev`: it names the key the core is listed under - the resolve line's
// `key=`. The resolve line's own row filter (`@envoydev$`, the anchored match it derives `key=` from)
// is the one place the key is spelled.
// audit 2026-10-11 (sessions 37d7a42c, 902182d2, 1c66b16d): every downloading command reads the whole protocol first,
// through Bash; a 30,382-byte copy spilled past the Bash tool's output cap to a tool-results file and was read a second
// time (~8.0k result, +13.6k context carried on every later message), and 28,910 bytes fit by ~1.1k with nothing holding
// it there. The PowerShell route moved beside it, read only when bash cannot run; the cap keeps a third of headroom.
const PROTOCOL_CAP = 14000;
test(`source-protocol.md, read whole by every command, stays under ${PROTOCOL_CAP} chars; the PowerShell route lives beside it`, () => {
    const protocol = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'source-protocol.md'), 'utf8');
    assert.ok(protocol.length <= PROTOCOL_CAP, `source-protocol.md is ${protocol.length} chars, over the ${PROTOCOL_CAP} cap - move a branch out, as the PowerShell route was`);
    assert.doesNotMatch(protocol, /```powershell/, 'a PowerShell block belongs in source-protocol-powershell.md');
    assert.match(protocol, /`source-protocol-powershell\.md`/, 'the protocol names where the PowerShell route lives');
    const ps = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'source-protocol-powershell.md'), 'utf8');
    assert.match(ps, /```powershell\n\$TMP = Join-Path/, 'the PowerShell resolve');
    for (const name of ['init', 'update', 'configure', 'validate', 'uninstall'])
        assert.match(flat(cmdBody(name)), /source-protocol\.md`?[^.]*(?:ONE Bash `cat`|one Bash `cat`)/, `${name} reads the protocol in one Bash cat`);
});

test('the command bodies read stack entries under the key the core is listed under, never a literal @envoydev', () => {
    const files = ['references/source-protocol.md', 'references/source-protocol-powershell.md', ...fs.readdirSync(path.join(PLUGIN_DIR, 'commands')).map((f) => `commands/${f}`)];
    for (const file of files)
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, file), 'utf8');
        assert.ok(!/@envoydev\b(?!\$)/.test(body), `${file} spells a stack entry @envoydev: ${(/.{0,60}@envoydev\b(?!\$).{0,20}/.exec(body) || [''])[0]}`);
    }
    const protocol = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'source-protocol.md'), 'utf8');
    assert.match(protocol, /key=\$\{MKT:-\?\}/, 'the bash resolve line names the key (its variable is MKT - a KEY-shaped name is what the secret guard blocks)');
});

// Task 3 (2.1.0): a legacy copy-route install that never wrote a stamp read `not-installed`, so setup took
// the fresh ladder and update sent it back to setup - the same ping-pong. The state is its own now: update
// takes it on its normal path, init asks once (update recommended), every other gate routes it to update.
test('an unstamped legacy install routes to update from every gate; init asks once, update recommended', () =>
{
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    assert.match(router, /prints `not-installed`, `legacy-unstamped`,/);
    assert.match(router, /Legacy unstamped -> `\/alfred-code:update`, whatever the ask/);
    const init = flat(cmdBody('init'));
    assert.match(init, /`legacy-unstamped` \([^)]*\) -> ONE AskUserQuestion/);
    const ask = askBlocks(cmdBody('init')).find((b) => /never wrote a stamp/.test(b[0]));
    assert.ok(ask, 'the legacy ask is a template');
    assert.deepStrictEqual(ask.filter((l) => /^- '/.test(l)).map((l) => /^- '([^']*)'/.exec(l)[1]), ['Update this install (Recommended)', 'Fresh install anyway']);
    assert.match(init, /'Update this install' -> name `\/alfred-code:update` for the USER to type and end the turn/);
    assert.match(init, /'Fresh install anyway' -> the INSTALL phase/);
    assert.match(flat(updateText()), /`legacy-unstamped` [^;]*-> go on: this command is its route/);
    for (const name of ['configure', 'validate', 'status', 'uninstall'])
        assert.match(flat(cmdBody(name)), /`legacy-unstamped`[^`]*`\/alfred-code:update`/, `${name} routes it to update`);
});

// R95 (Task 18b fix round 1): the review measured a loop in a git worktree of an installed checkout -
// the state read named the main checkout's install, every reader after it read the worktree's empty
// `.claude`, so update named setup and setup named update (setup is init's install phase since 2026-10-17). Every gate now reads the worktree state and
// stops on ONE line naming the checkout to run its own command from; none goes on to a reader.
test('every command gate and the router stop in a worktree of an installed checkout, naming the main checkout (R95)', () =>
{
    const router = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8'));
    assert.match(router, /`worktree-of-installed <main>`/);
    assert.match(router, /Worktree of an installed checkout -> no command here: 'This is a git worktree of <main>, which holds the install - run \/alfred-code:<the command the ask needs> from there'/);
    for (const name of ['init', 'update', 'configure', 'validate', 'status', 'uninstall'])
    {
        const body = flat(name === 'update' ? updateText() : cmdBody(name));
        assert.match(body, /node "(\$\{CLAUDE_PLUGIN_ROOT\}|\$TMP\/repo)\/scripts\/install\/stamp\.js" state \./, `${name} reads the state`);
        const line = new RegExp(`\`worktree-of-installed <main>\` -> print exactly 'This is a git worktree of <main>, which holds the install - run /alfred-code:${name} from there' and stop`);
        assert.match(body, line, `${name} stops in a worktree with its own command named`);
    }
    // M5: validate's scope comes from the same script, which reads either stamp name - never a grep.
    const validate = cmdBody('validate');
    assert.match(flat(validate), /Every installer call below carries its scope inline, `--scope "\$\(node "\$TMP\/repo\/scripts\/install\/stamp\.js" scope \.\)"`/);
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
    assert.match(status, /\*\*Environment\*\* - the install's knobs, one row each\. The variables come from ONE `node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/variables\.js" show --root \.`/);
    assert.match(status, /`ALFRED_CODE_DATA_PATH` and `ALFRED_CODE_HOOKS_OFF` come from the\s+STACK VIEW/);
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
    assert.ok(!/legacy-global/.test(f), 'status has no account-dir install state');
    assert.match(status, /"\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/library-check\.js" --project \. --source "\$\{CLAUDE_PLUGIN_ROOT\}" --json/);
    assert.match(f, /When `invalid` is above 0, one more line: `invalid: <n> stamp name\(s\) are not valid item names/);
    assert.match(f, /`health` is `ok` when the row's `errors` list is empty or absent, else the `type` of each `errorDetails` entry/);
    assert.doesNotMatch(status, /claude mcp list/, 'status lists no MCP server since 2.10.1');
    assert.match(status, /scripts\/analyze-usage\.js" --inventory \.claude/);
    assert.match(status, /stack\/hooks\/guard-secret-value\.js" --presence /);
    for (const row of ['stack version \\(stamp\\)', 'running plugin', 'scope', 'docs root', 'initialised'])
        assert.match(status, new RegExp(`^\\| ${row} \\|`, 'm'), `the general table has its ${row} row`);
    // Review finding 10: the transcript folder is derived by the analyzer from its own cwd, by Claude Code's rule - every
    // non-alphanumeric character a dash - and no body builds it with `pwd | sed` (Git Bash's `pwd` is not the native path
    // Claude Code names the folder from).
    const { sessionsDirOf } = require('./analyze-usage.js');
    for (const [sample, slug] of [['/Users/x/My Repo', '-Users-x-My-Repo'], ['C:\\work\\app.v2', 'C--work-app-v2'], ['/tmp/a_b-c', '-tmp-a-b-c']])
        assert.strictEqual(path.basename(sessionsDirOf(sample, '/acct')), slug, `the analyzer names ${sample}'s transcript folder by the rule`);
    for (const body of [status, cmdBody('validate')]) assert.ok(!/pwd \| sed/.test(body), 'no body derives the transcript folder in the shell');
    // validate reports the same invalid line.
    assert.match(flat(cmdBody('validate')), /An `invalid: N stamp name\(s\) \.\.\.` line is a finding too/);
});

test('the guided walks hold the layer order, the step banners, and the cascade machinery', () => {
    for (const [name, body] of [['init install phase', installBody()], ['configure', cmdBody('configure')], ['validate', cmdBody('validate')]])
    {
        assert.match(flat(body), /rules -> agents -> skills -> hooks -> plugins/, `${name} walks the layers in dependency order`);
        assert.match(body, /\[step \d+\/\d+ - /, `${name} announces every step with the n/total banner`);
    }
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--dropped/, 'configure drives the drop cascade through stack-select --dropped');
    assert.match(configure, /orphan:/, 'configure consumes the orphan: lines');
    // The shared walk text carries the same machinery for both modes.
    const walk = flat(walkBody());
    assert.match(walk, /rules -> agents -> skills -> hooks -> plugins/, 'the walk holds the layer order');
    assert.match(walk, /DELTA: `node "\$TMP\/repo\/scripts\/stack-select\.js" --selection "\$TMP\/raw\.json" --dropped "\$TMP\/dropped\.json"`/, 'the DELTA walk drives the drop cascade');
    assert.match(walk, /An `orphan: <category> <name> - <why> \(dropped\); nothing kept still needs it` line/, 'the DELTA walk consumes the orphan: lines');
    assert.match(walk, /a layer turn missing the fenced table is invalid/, 'the table-before-question rule rides the walk');
});

// The install-time twin of validate's judgment gate: a typed add that conflicts with the
// project's stated conventions gets a quote-gated, non-blocking warning at the prereq step.
test('init\'s install phase and configure carry the brownfield convention-conflict warning gate', () => {
    for (const [name, body] of [['init install phase', installBody()], ['configure', cmdBody('configure')]])
    {
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
    // audit 2026-10-11, session 6288ad94: a literal `<scope>` left the value to infer - the run guessed `project`,
    // read `user` back and re-ran the read-back. The stamp's own scope is inline now.
    const SCOPE = '--scope "\\$\\(node "\\$TMP\\/repo\\/scripts\\/install\\/stamp\\.js" scope \\.\\)"';
    assert.match(body, new RegExp(`install\\/alfred-code\\.js" update --source "\\$TMP\\/repo" ${SCOPE} --installed-only --print-plan --plan-out`), 'validate reads the install back at its own scope');
    assert.match(body, new RegExp(`install\\/alfred-code\\.js" update --source "\\$TMP\\/repo" ${SCOPE} --installed-only \\[--add`), 'validate applies the accepted adds and removes via the seed, over the read-back, at its own scope');
    assert.doesNotMatch(body, /--scope <scope>/, 'no scope placeholder is left to infer');
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
    for (const entry of mkt.plugins.filter((x) => !foreignEntry(x))) assert.strictEqual(entry.source, './', `${entry.name} is not sourced from the repo root - resolve its paths against its own source`);
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
    for (const name of ['init', 'update', 'configure', 'uninstall'])
    {
        const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
        assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/source-protocol\.md/, `${name} cites the shared source-protocol.md via the plugin root`);
    }
    const router = fs.readFileSync(path.join(PLUGIN_DIR, 'skills', 'alfred-code', 'SKILL.md'), 'utf8');
    assert.match(router.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1], /name:\s*alfred-code/, 'router skill named like the plugin -> displays bare /alfred-code');
    for (const name of ['init', 'update', 'configure', 'validate', 'status', 'uninstall'])
    {
        assert.match(router, new RegExp('/alfred-code:' + name), `/alfred-code routes to /alfred-code:${name}`);
    }
});

// R10: uninstall runs the seed's own uninstall over the run's snapshot and reports its lines - what went,
// what was kept as the user's, and the commands it only PRINTED (a user-scope row, a third-party pick,
// the marketplace), which the command never runs. A stamp from before the ledger routes to update once.
test('uninstall runs the seed after one confirmation, and never runs a command the seed only printed (R10)', () => {
    const body = flat(cmdBody('uninstall'));
    assert.match(body, /node "\$TMP\/repo\/scripts\/install\/alfred-code\.js" uninstall --source "\$TMP\/repo" \[--instructions-seed remove\|keep\] 2>&1 \| tee "\$TMP\/install\.log"/);
    assert.match(body, /AskUserQuestion/);
    // the user's ask of 2026-10-23: the unedited seed gets its own question in the one confirmation call, from the
    // read-only preview, and the answer travels as the flag
    assert.match(body, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/install\/uninstall\.js" seed \./);
    assert.match(body, /'Delete it \(Recommended\)'.*'Keep the file'.*'Delete it' -> `--instructions-seed remove`.*'Keep the file' -> `--instructions-seed keep`/);
    // one label per answer in the one call: the confirmation's cancel and the seed's keep never read alike (review 2026-10-23)
    assert.doesNotMatch(body, /'Keep it' -> `--instructions-seed keep`/);
    assert.match(body, /predates the install ledger.*\/alfred-code:update/);
    assert.match(body, /never run a printed command/i);
    assert.match(body, /rm -rf "\$TMP" "\$MARK"|Clean up the temp dir/);
});

test('the walk and status REPORT the derivation - they never restate what the installer writes', () => {
    // Phase 8 R1: four prose descriptions of one pipeline is how a route change reached three of them
    // and not the fourth. init shows the derived off-state before installing; status takes the
    // stack's share of the floor, seats included, from the same script.
    const read = (name) => fs.readFileSync(path.join(PLUGIN_DIR, 'commands', `${name}.md`), 'utf8');
    assert.match(installBody(), /scripts\/derive-state\.js" --selection "\$TMP\/selection\.txt" --source "\$TMP\/repo"/);
    assert.match(read('status'), /scripts\/derive-state\.js" --floor --plugins /);
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'derive-state.js')), 'the script both cite ships in the snapshot');
});

// Phase 8 T3: update asks from the derivation's new-item verdicts and takes a yes as --add; its
// pruning path never rebuilds the selection from a disk inventory, which on the plugin routes
// holds only the extras and would switch every carried seat off.
test('update: new items come from the preflight\'s new: lines and a yes becomes --add', () =>
{
    const body = updateText();
    assert.match(body, /`new: <category> <name><TAB><verdict>/);
    assert.match(body, /--installed-only \[--add "<category> <name>"\]\.\.\./);
    assert.ok(!/FYI `added` items/.test(body), 'the FYI-only adoption is gone');
    // Audit 2026-10-20 C15: the pruning path is the slow path's, read only on a non-empty prune list.
    assert.match(flat(body), /\*\*NON-EMPTY\*\* -> read `update-slow-path\.md` and run its step 4/);
    const slow = refBody('update-slow-path');
    const step4 = slow.slice(slow.indexOf('## 4. Pruning path'), slow.indexOf('## 5. Prune'));
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

test('configure emits hook none when its Hooks area was walked, and update has no global mode', () =>
{
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.match(configure, /--emit "\$TMP\/selection\.txt" --check \[--hooks-answered\]/);
    // R51 / I8: the preflight reads the project's stamp only - update has no global mode.
    const update = flat(updateText());
    assert.ok(!/Global mode:/.test(update), 'update has no global mode left');
    assert.ok(!/legacy-stamp:/.test(update), 'no account-stamp baseline line is left to read');
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
    for (const [name, body] of [['update.md', updateText()], ['validate.md', validate], ['configure.md', read('configure.md')]])
    {
        const filters = body.split('\n').filter((l) => /grep -a?E '[^']*' "\$TMP\/install\.log"/.test(l));
        assert.ok(filters.length > 0, `${name} has a report filter`);
        assert.ok(filters.some((l) => /overwriting a hand-edited copy/.test(l)), `${name}: no report filter shows the overwrite`);
    }
});

// update.md's ONE post-install grep is all the close-out ever reads of the installer log, so every
// retirement line the installer writes - the removal, its add-back line, and a row KEPT at another
// scope, with the uninstall command the user runs - must pass that pattern. The lines
// come from a real seed run, so a reworded log line or a narrowed pattern turns this red.
test('update: the post-install grep passes every retirement line the installer writes', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const body = updateText();
    const m = body.match(/grep -aE '([^']+)' "\$TMP\/install\.log"/);
    assert.ok(m, 'update.md carries no post-install grep');
    const pattern = new RegExp(m[1]);
    const listing = JSON.stringify([
        { id: 'alfred-code@envoydev', version: '1.3.0', scope: 'project', enabled: true },
        { id: 'sentry@envoydev', version: '1.3.0', scope: 'project', enabled: true },
        { id: 'angular-cli@envoydev', version: '1.3.0', scope: 'user', enabled: true },
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
    };
    for (const [kind, re] of Object.entries(kinds))
    {
        const lines = out.split('\n').filter((l) => re.test(l));
        assert.ok(lines.length > 0, `the seed run wrote no ${kind} line - the fixture or the log wording moved:\n${out}`);
        for (const line of lines) assert.match(line, pattern, `update.md's grep drops the ${kind} line`);
    }
});

// 2.8.0 (the user's ruling D5, 2026-10-20): update moves an older project's folders onto the current layout and says so.
// Every `layout:` line the installer writes - a move, a clash kept, a .branches/ kept - passes the ONE post-install grep,
// and the close reports them under its LAYOUT line, a kept one on the follow-ups card with the one action it leaves.
test('update: the post-install grep passes every layout: line, and the close reports them as its LAYOUT line', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const body = updateText();
    const pattern = new RegExp(body.match(/grep -aE '([^']+)' "\$TMP\/install\.log"/)[1]);
    const put = (repo, rel) => { const f = path.join(repo, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${rel}\n`); };
    const prepare = (repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'source: test\nversion: 2.7.0\n');
        for (const rel of ['flow/APPROVAL', 'hook-blocks/s.jsonl', 'plans/a.md', 'plans/b.md', '.branches/feature/x.md']) put(repo, `.alfred/docs/${rel}`);
        put(repo, '.alfred/docs/work/plans/b.md');
        for (const rel of ['state/approvals/APPROVAL', 'statistics/hook-blocks/s.jsonl']) put(repo, `.alfred/${rel}`);
    };
    const { out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', { prepare });
    const kinds = {
        move: /layout: \S+ -> \S+ \(\d+ files?\)/, clash: /layout: kept \S+ - \S+ already holds it/, branches: /layout: kept \.branches\/ - it holds doc versions/,
        merged: /layout: merged \S+ into \S+/, removed: /layout: removed \S+ - \S+ is the copy the hooks read/,
    };
    for (const [kind, re] of Object.entries(kinds))
    {
        const lines = out.split('\n').filter((l) => re.test(l));
        assert.ok(lines.length > 0, `the seed run wrote no ${kind} line:\n${out}`);
        for (const line of lines) assert.match(line, pattern, `update's grep drops the ${kind} line`);
    }
    const close = flat(refBody('update-close'));
    assert.match(close, /\*\*LAYOUT\*\* - every `layout:` line the grep caught, verbatim/, 'the close names the LAYOUT line');
    assert.match(close, /'layout: current - nothing moved'/);
    assert.match(close, /a `layout: kept` line goes on the follow-ups card/);
    // docs.js prints three held shapes; 'delete the old' is right for one only - said for `.branches/` it deleted live
    // local-versioning overlays (final review 2026-10-20b).
    assert.match(close, /`layout: kept <old> - <new> already holds it`[^.]*diff the two and delete the old/, 'the clash shape');
    assert.match(close, /`layout: kept \.branches\/ - it holds doc versions, prune them first`: [^`]*`node \.claude\/hooks\/docs\.js prune <branch>`[^`]*never delete it by hand/, 'the branch-versions shape');
    assert.match(close, /`!! layout: <folder> holds raw session copies \.\.\.`: nothing moved; keep the new folder out of git/, 'the raw-copies shape');
    // The hand-set docs-root ask: a multi-select needs 2-4 options, so a root holding ONE stack entry has no 'Some are
    // the team's own' question to build; and an unattended move of a team's folder names the way back (final review
    // 2026-10-20b).
    const walk = flat(refBody('update-walk'));
    assert.match(walk, /With one `moves=` entry there is nothing to pick from: ask it as a yes \/ no - 'Move it \(Recommended\)' or 'It is the team's own'/, 'the one-entry ask');
    assert.match(walk, /`git mv <to>\/<entry> <from>\/<entry>`/, 'the way back after an unattended move');
    const history = flat(refBody('update-history'));
    assert.doesNotMatch(history, /a `layout: kept` line means a file already sat at the new path, so the old one is the user's to diff and delete/, 'the history names each shape');
    assert.match(flat(cmdBody('update')), /moves an older project's folders onto the current layout/, 'update.md says what the run does');
});

// A 1.x install's FIRST 2.0.0 run is driven by the 1.x update command's own body (v1.3.0), which no
// release can edit. It reports from ONE grep of the installer log - the pattern below, frozen as it
// shipped - and pastes verbatim every `warn:` line `update-preflight.js --log` prints: one per `!!` line
// of the log, from the snapshot the run installs from (this repo's script). A line only the 2.0.0 grep
// carries is never seen on that run, so each line a user must act on carries the `!!` marker both read.
const GREP_1X = /installed\/refreshed this run|mcp repaired:|plugin [A-Za-z0-9_.-]+:|plugin pruned|installed-only: (required|adopting|keeping|adding|dropping|every hook)|names nothing this release ships|was dropped from this install|settings\.json env:|docs (migration|domain)|memory:|memory import:|autoMemoryEnabled|=set \(|=absent|serena project index|!!|overwriting a hand-edited copy/;
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
        const body = updateText();
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

// N1 (re-review): A-M2's kept and unreadable lines reached neither body without a marker (C10's stale-registration
// and C11's here-only lines left with the registrations in 2.10.1). C12's move
// off local scope cannot meet the 1.x body: 1.x wrote no local scope (its --scope took project or
// global), and the move fires only on a stamp that says local - so the current grep alone carries it.
test('update: the kept and unreadable lines reach both update bodies; the local move reaches the current one (N1)', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const P = require('./install/plugins.js');
    const account = (work, text) => { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', '.claude.json'), text); };
    const stale = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV, args: ['--scope', 'user'],
        // `navigation`, a name the 2.2.0 rename left behind, is judged on the first run past its successor's retirement
        // (a 2.10.0 stamp): this one is the user's own server.
        prepare: (repo, work) =>
        {
            account(work, JSON.stringify({ mcpServers: { navigation: { type: 'stdio', command: 'node', args: ['my-nav.js'], env: {} } } }));
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 2.10.0\n');
        },
    }).out;
    // An install a 2.10.0 release stamped, so the retired servers are due - the only run that reads the account file for them
    // (a fresh one has nothing to take out, and since the final review's A4 never reaches the line through `browser`).
    const unreadable = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV, args: ['--scope', 'user'],
        prepare: (repo, work) =>
        {
            account(work, '{not json');
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 2.10.0\n');
        },
    }).out;
    const logs = [];
    const row = (scope, enabled = true) => ({ name: 'alfred-code', marketplace: 'envoydev', version: '2.0.0', scope, enabled });
    P.moveLocalRows({ plugins: ['alfred-code@envoydev'], rows: [row('local')], scope: 'project', cli: () => true, log: (m) => logs.push(m) });
    const report = reportOf([stale, unreadable, ...logs.map((m) => `==> ${m}`)].join('\n'));
    // M-F5-1: no name is live since 2.10.1 - the stack wants no server - so the kept line is plain, for update.md's grep alone.
    assertSurfaced(report, 'mcp navigation: the user-scope registration is not the stack\'s (another server under the same name) - kept; if it should go: claude mcp remove navigation -s user', { firstRun: false });
    assertSurfaced(report, '.claude.json could not be read - no user-scope registration was removed; fix the file and re-run', { start: 'mcp: /' });
    assertSurfaced(report, 'plugin moved [local -> project]: alfred-code@envoydev', { firstRun: false });
});

// F7 (observation 1): C8's line naming a settings.local.json this run created and git would commit - a
// machine path in the repo unless the user acts - matched neither the 1.x body's grep (`settings\.json
// env:` only) nor its `warn:` lines, so the advice never showed there. Since 2.10.1 no memory database path
// makes a project install write the file, so a local-scope update - whose own file it is - carries the case.
test('update: a local install\'s update shows the settings.local.json gitignore advice through both update bodies (F7)', { skip: process.platform === 'win32' && 'the seed sandbox is POSIX only' }, () =>
{
    const { seedRun } = require('./seed-sandbox.js');
    const { out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        args: ['--scope', 'local'],
        plugins: JSON.stringify([{ id: 'alfred-code@envoydev', version: '1.3.0', scope: 'local', enabled: true }]),
        prepare: (repo) =>
        {
            fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 1.3.0\nscope: local\n');
            fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'docs.js'), '');
        },
    });
    assertSurfaced(reportOf(out), 'settings.local.json: created for this machine\'s own values - git does not ignore it here; add .claude/settings.local.json to .gitignore');
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

// 2.10.1: the memory level left configure with the memory server, and the HTML catalog keeps no stale refusal claim.
test('N2: configure carries no memory level, and the HTML catalog no user-scope refusal claim', () => {
    assert.doesNotMatch(cmdBody('configure'), /--memory-level|memory level/i, 'configure asks no memory level');
    const html = fs.readFileSync(path.join(ROOT, 'docs', 'alfred-code.html'), 'utf8');
    assert.doesNotMatch(html, /only the full copy route refuses it at user scope/, 'the HTML memory row must not repeat the stale refusal claim');
});

// F4 re-review N9: hudStatusLineMissing (plugins.js) fires whenever claude-hud is installed - this
// run OR already - and the account has no statusLine, not only on a fresh install this run.
test('N9: update.md states the claude-hud status-line line prints on every run, not only when installed this run', () => {
    const body = updateText();
    assert.doesNotMatch(body, /When claude-hud is installed this run and the account has no/, 'update.md must not narrow the trigger to a fresh install this run');
    assert.match(body, /claude-hud is installed - this run or already/, 'update.md must say the line fires on every run while claude-hud is installed and statusLine is missing');
});

// ---- layer asks: every walk layer offers pickable options, never only whole-layer verdicts --------
const { lintAskTemplates, setupAskFiles, SETUP_ASK_TEMPLATES } = require('./lint-skills.js');
const askBlocks = (text) => [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)]
    .map((m) => m[1].split('\n').map((l) => l.trim()).filter(Boolean));
const sectionOf = (text, heading) =>
{
    const at = text.indexOf(`\n## ${heading}\n`);
    assert.ok(at >= 0, `walk.md has a '## ${heading}' section`);
    const next = text.indexOf('\n## ', at + 4);
    return text.slice(at, next < 0 ? undefined : next);
};

test('lint check 61 reads setup-plugin: a template with no recommended option is a finding', () =>
{
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'alfred-ask-'));
    try
    {
        fs.mkdirSync(path.join(tmp, 'setup-plugin', 'references'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'setup-plugin', 'commands'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'setup-plugin', 'references', 'walk.md'), "```ask\nKeep the rows?\n- 'Keep' - why\n- 'Drop' - why\n```\n");
        fs.writeFileSync(path.join(tmp, 'setup-plugin', 'commands', 'init.md'), "```ask\nGo?\n- 'Go (Recommended)' - why\n- 'Stop' - why\n```\n");
        const files = setupAskFiles(tmp);
        assert.deepStrictEqual(files.map((f) => f.file).sort(), ['setup-plugin/commands/init.md', 'setup-plugin/references/walk.md']);
        const findings = lintAskTemplates(files);
        assert.strictEqual(findings.length, 1);
        assert.match(findings[0], /walk\.md.*no option marked '\(Recommended\)'/);
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('every layer ask in walk.md offers 2-4 options with the recommended one first', () =>
{
    const walk = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'walk.md'), 'utf8');
    const blocks = askBlocks(walk);
    assert.strictEqual(blocks.length, SETUP_ASK_TEMPLATES['setup-plugin/references/walk.md'], 'the walk.md template count is pinned');
    for (const b of blocks)
    {
        const opts = b.filter((l) => /^- '/.test(l));
        assert.ok(opts.length >= 2 && opts.length <= 4, `'${b[0].slice(0, 50)}' offers ${opts.length} options - AskUserQuestion takes 2-4`);
        assert.match(opts[0], /\(Recommended\)'/, `'${b[0].slice(0, 50)}' lists the recommended option first`);
        assert.strictEqual(opts.filter((l) => /\(Recommended\)'/.test(l)).length, 1);
    }
    for (const layer of ['Rules', 'Agents', 'Skills', 'Hooks', 'Plugins'])
        assert.ok(askBlocks(sectionOf(walk, layer)).length >= 1, `the ${layer} layer carries its own ask template`);
    assert.match(walk, /one AskUserQuestion call of up to 4 multi-select questions/i, 'the Pick follow-up is one call of up to 4 questions');
});

// F22 (the 2026-10-28 workspace run): the Pick call is dealt by `stack-select.js --deal`, and a DELTA side of exactly one
// row offers no Pick (the deal would have nothing to ask) - its step-1 'Add all 1' / 'Drop all droppable' covers it.
test('a one-row DELTA side offers no Pick, and the Pick step names --deal', () =>
{
    const walk = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'walk.md'), 'utf8'));
    assert.match(walk, /--deal fresh <layer>/, 'the FRESH Pick step runs the deal');
    assert.match(walk, /`--deal add <layer>` or `--deal drop <layer>`/, 'the DELTA Pick runs the deal per side');
    assert.match(walk, /When the table's `counts:` line gives a side exactly 1 row \(1 droppable, or 1 not installed\), that side's question omits its 'Pick rows to add' \/ 'Pick rows to drop' option/);
});

// Group D (the 2026-10-28 workspace run): the templates say what is true in a no-repo root, a local child and a root
// with children - F1, F2, F6, F16, F20, F23.
test('group D wording: the no-repo root, the scope, git hygiene, nothing to offer, the rename, the children note', () =>
{
    const ref = (rel) => fs.readFileSync(path.join(PLUGIN_DIR, ...rel.split('/')), 'utf8');
    const install = ref('references/init-install.md');
    assert.ok(install.includes("- 'Install here (Recommended)' - this directory is the project root, or a workspace root above the projects; move the mark to Stop when this directory sits inside the project you meant"), 'F1');
    assert.ok(install.includes("- 'project (Recommended)' - .claude/settings.json - shared: committed with the repo, or read by every session in this folder"), 'F2');
    for (const rel of ['references/init-install.md', 'references/post-install.md'])
        assert.match(flat(ref(rel)), /no-repo mode[^.]*`git hygiene: skipped - no git repository`, and nothing about `\.claude\/AGENTS\.md`/, `F6 ${rel}`);
    assert.ok(flat(ref('references/walk.md')).includes('No kept plugin with a row, or a report whose last line reads `plugin-settings: nothing to offer`: skip this silently, ask nothing.'), 'F16');
    const place = ref('references/instructions-place.md');
    assert.ok(place.includes("- 'Rename to <other>' - git mv at the root, in .claude/ and in each part that holds one, so history follows; a file already named <other> is never overwritten"), 'F20');
    assert.ok(!place.includes('(web/<have>)'), 'F20 example path gone');
    const configure = ref('commands/configure.md');
    assert.ok(configure.includes("grep -E '^(workspace: parent |role: )'"), 'F23 step 1');
    assert.match(flat(configure), /`role:` line matching `root of \(\\d\+\)`/, 'F23 step 1 names the match');
    const note = 'The <n> project(s) below get this change when /alfred-code:update runs here.';
    const close = "'Nothing is pending on this run - these are yours to run when you choose.'";
    assert.ok(configure.includes(note), 'F23 note');
    assert.ok(configure.indexOf(note) < configure.lastIndexOf(close), 'F23 note sits before the pinned close');
});

// The data-root question (2.1.0) rides the same template shape as the walk's layer asks, so lint 61 holds
// its recommended option - '.alfred (Recommended)' - first in both homes that ask it.
// M12: setup has no data yet, so .alfred is its recommendation; configure reads a live install, and the walk's rule
// is that the current state is the recommended answer - a custom root the user chose is never moved back.
test('the data-root question is one ask template in init\'s install phase and configure - .alfred recommended there, the current root on configure', () =>
{
    for (const [rel, first] of [['references/init-install.md', /^- '\.alfred \(Recommended\)'/], ['commands/configure.md', /^- 'Keep <current> \(Recommended\)'/]])
    {
        const text = fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8');
        const data = askBlocks(text).filter((b) => /keep this project's data/i.test(b[0]));
        assert.strictEqual(data.length, 1, `${rel} carries the data question as one ask template`);
        const opts = data[0].filter((l) => /^- '/.test(l));
        assert.match(opts[0], first, `${rel}: the recommended first option`);
    }
});

test('init\'s install phase and configure name option asks, not typed numbers, for stacks and the add/drop rounds', () =>
{
    const setup = installBody();
    const configure = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    assert.strictEqual(askBlocks(setup).length, SETUP_ASK_TEMPLATES['setup-plugin/references/init-install.md']);
    assert.strictEqual(askBlocks(cmdBody('init')).length, SETUP_ASK_TEMPLATES['setup-plugin/commands/init.md']);
    assert.doesNotMatch(setup, /Recommended \/ All \/ None, or typed numbers/);
    assert.doesNotMatch(configure, /an ADD round and a DROP round/);
    assert.match(configure, /walk\.md's DELTA/);
});

// ------------------------------------------------------------------ audit 2026-10-11 SD06 / SD04 / SD09 (update)

const updateBody = updateText;
const stepOf = (body, from, to) => flat(body.slice(body.indexOf(from), body.indexOf(to)));

// 37d7a42c: step 0 said 'continue either way' and the Never list 'never run on the expensive tier'; the run went on on
// Opus and the user redid it on Sonnet. bca100bd: a measured-in-prose step 0 narrated its own skip. One rule each.
test('update step 0: the tier hint is a stop the Never list agrees with, and the fresh-session ask is the hook note alone', () =>
{
    const body = updateBody();
    // step 0 is the router's (audit 2026-10-20 C15): the only text a refused run reads.
    const router = cmdBody('update');
    const zero = stepOf(router, '## 0. Where to run it', '## The run');
    assert.doesNotMatch(flat(body), /continue either way/, 'the tier hint no longer lets the run go on');
    assert.match(zero, /step 0 is a STOP, not an ask/);
    assert.match(zero, /the turn ends before the snapshot is resolved/);
    assert.match(zero, /A second `\/alfred-code:update` in this session goes ahead/);
    assert.match(zero, /unattended: tier -> run here/, 'an unattended launch never stops on it');
    // The Never list is read only once the gate passed, so it carries no second tier rule to drift from step 0's.
    assert.doesNotMatch(flat(body.slice(body.indexOf('## Do not'))), /expensive tier/, 'the tier rule has one home, step 0');
    assert.doesNotMatch(zero, /cache_read \+ cache_creation|Measure before you ask/, 'no model-side measurement is left');
    assert.match(zero, /the measuring is the hook's, never yours/);
    assert.match(zero, /Without it, step 0 does not exist: never measure, never mention it/);
    // the note step 0 keys on is the hook's own text
    const hook = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
    const quoted = zero.match(/says '([^']+)'/);
    assert.ok(quoted && hook.includes(quoted[1]), `step 0 quotes '${quoted && quoted[1]}', which the hook's note must carry`);
});

// bca100bd: after a docs move the hooks kept writing the OLD root until the restart; the body said the new one.
test('update: the docs move says the hooks keep the old root until the restart', () =>
{
    const body = flat(updateBody());
    assert.doesNotMatch(body, /this session writes the docs under the NEW root/);
    assert.match(body, /until that restart this session's hooks keep writing under the OLD root/);
    // 2.8.0: the hooks write state/ and statistics/; a session started on an older release still writes flow/.
    assert.match(body, /a file under the old root's `state\/` or `statistics\/` - or, from a session that started before 2\.8\.0, its `flow\/` or `hook-blocks\/` - is this session's record and safe to delete/);
});

// b3f8193f: the project's own AGENTS.md was spliced by hand after an ask with no diff. 5b9ce9c5: the compare never ran
// and nothing in the close showed it.
test('update step 6: the own-file re-spell goes through the preflight plan and one ask, and the step closes on a receipt', () =>
{
    const body = updateBody();
    const six = body.slice(body.indexOf('## 6. Reconcile'), body.indexOf('## 7. Post-check'));
    assert.doesNotMatch(flat(six), /leave the names to it/, 'the installer does not re-spell the project\'s own file');
    assert.match(six, /update-preflight\.js" --respell --root \./);
    assert.match(flat(six), /the same call with `--apply` writes those lines alone/);
    const ask = askBlocks(six);
    assert.strictEqual(ask.length, 1, 'one ask template for the re-spell');
    assert.match(ask[0].filter((l) => /^- '/.test(l))[0], /^- 'Re-spell them \(Recommended\)'/);
    assert.match(flat(six), /`agents-md: compare <clean\|N additions> - check <N rows>`/);
    assert.match(flat(body.slice(body.indexOf('## 7. Post-check'))), /step 6's `agents-md:` receipt/);
    const pinned = ['commands/update.md', 'references/update-walk.md', 'references/update-close.md']
        .reduce((n, rel) => n + SETUP_ASK_TEMPLATES[`setup-plugin/${rel}`], 0);
    assert.strictEqual(askBlocks(body).length, pinned, 'update\'s asks are pinned across the router and its two references');
    assert.strictEqual(askBlocks(cmdBody('update')).length, 0, 'a gate-refused run carries no ask template');
});

// ------------------------------------------------------------------ audit 2026-10-11 SD06 / SD10 (validate)

// 6288ad94 / 757a4ac0: a credential rotation the user deferred through the run's own ask was listed as 'Still owed',
// and the stop guard blocked the close. The pinned contract: a `Deferred by you:` line, which the guard never counts.
test('validate: an item the user deferred through this run\'s ask closes on a Deferred by you: line, not as owed', () =>
{
    const body = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8'));
    assert.match(body, /An item the user DEFERRED through an AskUserQuestion answer in this run[^.]*is not owed: list it on ONE line that starts `Deferred by you:` and close with the line above/);
});

// The pinned agents-md contract: validate's ask over the check rows lists its (Recommended) option first, as a template.
// 6288ad94: 'Review' first and unmarked was taken, ~825k on 4 false-positive rows - 'Leave them' takes the mark.
test('validate: the AGENTS.md check rows get one ask template, Leave them recommended and first (6288ad94)', () =>
{
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'validate.md'), 'utf8');
    const ask = askBlocks(body).filter((b) => /^Review the AGENTS\.md check rows/.test(b[0]));
    assert.strictEqual(ask.length, 1, 'one template for the check rows');
    assert.match(ask[0].filter((l) => /^- '/.test(l))[0], /^- 'Leave them \(Recommended\)'/);
    assert.doesNotMatch(flat(body), /NO option marked recommended/);
    assert.strictEqual(askBlocks(body).length, SETUP_ASK_TEMPLATES['setup-plugin/commands/validate.md'], 'validate.md\'s asks are pinned');
});

// Git for Windows ships no jq (SUMMARY premise check): every JSON read a setup text runs is `node -e`.
test('setup texts read JSON with node -e, never jq', () =>
{
    const files = [];
    for (const dir of ['commands', 'references']) for (const f of fs.readdirSync(path.join(PLUGIN_DIR, dir))) if (f.endsWith('.md')) files.push(path.join(dir, f));
    for (const rel of files)
    {
        const text = fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8');
        const runs = text.split('\n').filter((l) => /(^|[`$(|;&]\s*)jq\s+-/.test(l));
        assert.deepStrictEqual(runs, [], `${rel} runs jq`);
    }
});

// ------------------------------------------------------------------ audit 2026-10-11 SD06 (configure step 1)

// a9e06780: step 1 printed none of its blocks, asked an improvised question with the marked stop listed last, and read
// walk.md at the start of a run that stopped at step 1.
test('configure step 1: the inventory comes from the preflight, the close is one of two templates, walk.md waits for step 3', () =>
{
    const body = fs.readFileSync(path.join(PLUGIN_DIR, 'commands', 'configure.md'), 'utf8');
    const one = body.slice(body.indexOf('## 1. Install status'), body.indexOf('## 2. Choose the areas'));
    assert.match(one, /node "\$TMP\/repo\/scripts\/update-preflight\.js" --inventory "\$TMP\/installed\.json"/);
    assert.doesNotMatch(one, /Show the inventory grouped by category, with counts/, 'no hand table');
    const asks = askBlocks(one);
    assert.strictEqual(asks.length, 2, 'one template per case');
    for (const a of asks) assert.match(a[0], /^Adjust the installed selection\?/, 'the question the layer-table gate keys on');
    assert.match(asks[0].filter((l) => /^- '/.test(l))[0], /^- 'Adjust the selection \(Recommended\)'/);
    assert.match(asks[1][0], /No upstream changes/);
    assert.match(asks[1].filter((l) => /^- '/.test(l))[0], /^- 'Stop here \(Recommended\)'/, 'an empty delta: stopping takes the mark, first');
    const gate = fs.readFileSync(path.join(PLUGIN_DIR, 'hooks', 'guard-layer-table.js'), 'utf8');
    assert.match(gate, /const STEP1_ASK = \/\^\\s\*Adjust the installed selection\\\?\/i;/, 'the gate keys on the same question');
    assert.match(flat(body), /walk\.md` AT step 3, never earlier/);
    assert.strictEqual(askBlocks(body).length, SETUP_ASK_TEMPLATES['setup-plugin/commands/configure.md'], 'configure.md\'s asks are pinned');
});

// Audit 2026-10-11 (SD01, session 5f9fec85): configure step 10's settings read went through `jq` (absent on Git for
// Windows, exit 127) and `--presence` (a length, never the mode), and the step's 'account: <mode>' line never appeared.
// Both texts now name ONE reader; it must survive the secret guard's redacted view of a credential-bearing file and
// print `unset` for an absent key or file.
test('init\'s install phase and configure read permissions.defaultMode with the same stdin reader, and it survives the secret guard', { skip: process.platform === 'win32' && 'sh pipeline' }, () => {
    const { spawnSync } = require('node:child_process');
    const os = require('node:os');
    const reader = (rel) => {
        const m = fs.readFileSync(path.join(PLUGIN_DIR, rel), 'utf8').replace(/\s*\n\s*/g, ' ').match(/`(cat "<file>" \| node -e '[^']+')`/);
        assert.ok(m, `${rel} names the stdin reader`);
        return m[1];
    };
    const cmd = reader('commands/configure.md');
    assert.strictEqual(reader('references/init-install.md'), cmd, 'one reader in both texts');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-reader-')));
    try {
        const token = 'sntrys_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
        const f = path.join(dir, 'settings.json');
        const read = () => {
            const command = cmd.replace('<file>', 'settings.json');
            const g = spawnSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-secret-value.js')],
                { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite', cwd: dir }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
            assert.notStrictEqual(g.status, 2, g.stderr);
            let ran = command;
            try { ran = JSON.parse(g.stdout).hookSpecificOutput.updatedInput.command || command; } catch { /* passed as written */ }
            const r = spawnSync('sh', ['-c', ran], { cwd: dir, encoding: 'utf8' });
            assert.ok(!`${r.stdout}${r.stderr}`.includes(token), 'no credential value printed');
            return r.stdout;
        };
        fs.writeFileSync(f, JSON.stringify({ permissions: { defaultMode: 'acceptEdits' }, env: { SENTRY_ACCESS_TOKEN: token } }, null, 2));
        assert.strictEqual(read(), 'acceptEdits\n', 'a credential-bearing file still yields its mode');
        fs.writeFileSync(f, JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: token } }));
        assert.strictEqual(read(), 'unset\n', 'an absent key');
        fs.writeFileSync(f, '{ not json');
        assert.strictEqual(read(), 'unset\n', 'an unreadable file');
        fs.rmSync(f);
        assert.strictEqual(read(), 'unset\n', 'a missing file');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Audit 2026-10-20 C16 / C46: validate reset every pin unasked, cleaned up by a glob zsh aborted on, skipped six
// banners and a rotate ask; configure ran its installer before the placement ask its --scope-of flags come from;
// the protocol rode every message at 17.8k chars and a run picked its temp dir with `ls -dt` past the marker.
test('C16: validate applies with --keep-pins, cleans up by name, prints every banner and asks the rotate row', () => {
    const v = flat(cmdBody('validate'));
    assert.match(v, /--installed-only \[--add '<line>'\]\.\.\. \[--drop '<line>'\]\.\.\. --keep-pins /, 'the apply call keeps pins');
    assert.match(v, /`--keep-pins` always: a reconcile never resets a deliberate local model\/effort pin/);
    assert.match(v, /by name, `rm -rf "\$TMP" "\$MARK"` after the marker block, never a glob/);
    assert.match(v, /a step with nothing to do prints its banner with ONE line saying why/);
    assert.match(v, /skips the ask only when it names THIS credential in THIS file/);
    assert.match(v, /Redirect the delta to `"\$TMP\/delta\.out"`/);
});

test('C46: configure runs its installer only after the placement ask, and names which in the narration line', () => {
    const c = flat(cmdBody('configure'));
    const pre = c.indexOf('**Before the call, the placement answer.**');
    assert.ok(pre > 0, 'the precondition is there');
    assert.ok(pre < c.indexOf('- **Any OS:** `node "$TMP/repo/scripts/install/alfred-code.js" update'), 'and it comes before the installer call');
    assert.match(c, /`placement: answered` \/ `placement: not asked - <why>`/);
});

test('C46: the protocol holds only what every run uses; the why and the rare branches live beside it', () => {
    const protocol = refBody('source-protocol');
    const notes = refBody('source-protocol-notes');
    assert.match(flat(protocol), /`source-protocol-notes\.md` for the why and the rare branches/);
    assert.match(flat(protocol), /`\$TMP` comes from the marker, every call, and from nowhere else\*\* - never an `ls -dt`/);
    assert.match(flat(protocol), /by name, never a glob/);
    for (const branch of ['## Fallbacks - no cache, or the download fails', 'A same-version re-release', 'Old version dirs in the cache'])
        assert.ok(notes.includes(branch) && !protocol.includes(branch), `${branch} is a notes-only branch`);
    assert.doesNotMatch(notes, /```bash/, 'no runnable block moves to the notes - the tests run the protocol\'s own');
});

// Audit 2026-10-20 C15: a 72.5k-char update body loaded whole before its model gate, so a refused run carried it on
// every later message and the re-run carried it twice (e43969a7 ~410k, 24841a36 ~237k); its respell diff was approved
// three times unseen (e31af926); a TRUNCATED compare was never named (a72fdfbc); and '~10k' was 50-70% low (24841a36).
// The residual: a refused run still carried the 35.7k-char body (~9k tokens); update.md is a router now (6.8k body chars
// measured), and each step reference rides a Bash call the run already makes, so it must fit the Bash tool's output
// cap with headroom (a 30,382-byte protocol copy spilled past it, see PROTOCOL_CAP).
const UPDATE_ROUTER_CAP = 10000;
const UPDATE_REF_CAP = 24000;
test(`C15: update is a ${UPDATE_ROUTER_CAP}-char router that opens on its model gate; its steps ride calls the run makes anyway`, () => {
    const router = cmdBody('update');
    assert.ok(router.length <= UPDATE_ROUTER_CAP, `update.md is ${router.length} chars, over ${UPDATE_ROUTER_CAP} - a refused run carries all of it; move a step to update-walk.md or update-close.md`);
    for (const ref of ['update-walk', 'update-close'])
    {
        const text = refBody(ref);
        assert.ok(text.length <= UPDATE_REF_CAP, `${ref}.md is ${text.length} chars, over ${UPDATE_REF_CAP} - its cat would spill past the Bash output cap`);
    }
    const flatRouter = flat(router);
    assert.ok(flatRouter.indexOf('## The run') > flatRouter.indexOf('**When the gate stops the run'), 'the call order comes after the gate');
    assert.match(flatRouter, /ONE call: `node "\$TMP\/repo\/scripts\/install\/stamp\.js" state \. ; cat "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/update-walk\.md"`/, 'the walk rides step 1\'s call');
    assert.match(flatRouter, /step 3's `--log` call with `; cat "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/update-close\.md"` appended/, 'the close rides the --log call');
    assert.match(refBody('update-walk'), /--running "\$\{CLAUDE_PLUGIN_ROOT\}" ; cat "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/update-close\.md"/, 'the walk\'s --log call reads the close');
    const body = updateBody();
    const afterTitle = body.slice(body.indexOf('# Update Alfred Code'));
    assert.match(afterTitle, /^# Update Alfred Code[^\n]*\n\n## 0\. Where to run it\n\n\*\*The model gate comes first - before any tool call and before reading further\.\*\*/, 'the gate is the body\'s first section');
    assert.match(flat(body), /\*\*When the gate stops the run, that line is the turn: no tool call, nothing below is read or summarised, and the turn ends on it\.\*\*/);
    assert.doesNotMatch(body, /~10k|near 10k/, 'no unmeasured walk-size claim');
    assert.match(flat(body), /measured at ~15-17k tokens of tool results in two audited runs/);
    assert.match(body, /node "\$TMP\/repo\/scripts\/update-preflight\.js" --snapshot "\$TMP\/repo" --root \. ; node "\$TMP\/repo\/scripts\/install\/release-notes\.js" --root \./, 'the release notes come from the script, in the preflight call');
    for (const [ref, read] of [['update-slow-path', /`update-slow-path\.md`/], ['update-history', /update-history\.md/]])
    {
        assert.ok(fs.existsSync(path.join(PLUGIN_DIR, 'references', `${ref}.md`)), `${ref}.md exists`);
        assert.match(body, read, `update.md names ${ref}.md`);
    }
    assert.doesNotMatch(body, /\*\*Renamed in 2\.\d\.\d\.\*\*/, 'the release history left the body');
    // every heading of the history file is one the release-notes script reads
    const history = refBody('update-history');
    for (const h of history.match(/^## .*$/gm)) assert.match(h, /^## (?:(?:in|after) \d+\.\d+\.\d+|table) - /, `a heading release-notes.js cannot place: ${h}`);
});

test('C15: the re-spell diff is printed as reply text before its ask, and the ask says so without pointing above', () => {
    const body = updateBody();
    const six = body.slice(body.indexOf('## 6. Reconcile'), body.indexOf('## 7. Post-check'));
    const show = six.indexOf('**Show the diff as reply TEXT**');
    assert.ok(show > six.indexOf('**Print the plan:**') && show < six.indexOf('```ask'), 'print, show, then ask');
    const ask = askBlocks(six)[0];
    assert.doesNotMatch(ask[0], /above/, 'the question points at no diff above');
    assert.match(ask[0], /The diff is in the message before this question/);
});

test('C15: a TRUNCATED compare is named at step 2 and routes the reconcile to configure in step 7', () => {
    const body = flat(updateBody());
    assert.match(body, /1\. \*\*Name the compare signal\*\*/);
    assert.match(body, /\*\*COMPARE\*\* - the signal step 2 named, one line: [^.]*on `TRUNCATED`: 'the compare was capped at 300 files - run \/alfred-code:configure to reconcile what it may have missed', with configure on the suggestion card/);
});

// Audit 2026-10-20 C21 (878f253d): configure's post-check prescribed content but no shape, so the answer-length cap
// held it as a long answer; a table plus fixed labels is the shape the cap leaves alone.
test('C21: configure reports in a fixed shape - one table, then labelled lines', () => {
    const c = cmdBody('configure');
    const post = c.slice(c.indexOf('## Post-check'), c.indexOf('**Git hygiene'));
    assert.match(post, /\| category \| refreshed \| added \| dropped \| kept \(orphan or required\) \|/);
    for (const label of ['AGENTS.md:', 'Deferred by you:', 'Warnings:', 'Restart:']) assert.ok(post.includes(`\`${label}\``), label);
});

// Review 2026-10-23: an unattended update never writes over the user's AGENTS.md answer - ask-local's Recommended option
// does, so that verdict takes the option that changes nothing.
test('update-walk: unattended, ask-local keeps the AGENTS.md answer instead of the Recommended option', () =>
{
    const body = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'update-walk.md'), 'utf8'));
    assert.match(body, /Unattended, take the Recommended option.*except on `update=ask-local`, which takes 'Keep the AGENTS\.md answer'/);
});

// Workspace layering (spec section 3): each new stop is a template whose Recommended option is listed first - lint 61
// holds the counts and the mark; these hold the option each one recommends.
const firstOption = (text, question) =>
{
    const m = text.match(new RegExp(`^[ \\t]*\`\`\`ask[ \\t]*\\n[ \\t]*${question}[^\\n]*\\n[ \\t]*- '([^\\n]*?)' - `, 'm'));
    return m ? m[1] : null;
};
test('setup-plugin: every new ask is a template with one Recommended option, listed first', () =>
{
    const walk = refBody('update-walk');
    assert.strictEqual(firstOption(walk, '<the case\'s question above>'), '<the first ask: label up to its mark> (Recommended)');
    assert.strictEqual(firstOption(walk, 'Load CLAUDE\\.md and AGENTS\\.md both'), 'Load both (Recommended)');
    const cascade = refBody('update-workspace');
    assert.strictEqual(firstOption(cascade, 'Update the <n> project\\(s\\) below this one as well\\? <each project: its rel and its asks'), 'Yes, their questions the recommended way (Recommended)');
    assert.strictEqual(firstOption(cascade, 'Update the <n> project\\(s\\) below this one as well\\? <each project\'s rel>'), 'Yes, update them too (Recommended)');
    assert.strictEqual(firstOption(cascade, 'Join these installed projects'), 'Join as children (Recommended)');
    assert.strictEqual(firstOption(refBody('init-bootstrap'), 'Load CLAUDE\\.md and AGENTS\\.md both'), 'Load both (Recommended)');
    const child = refBody('init-child');
    assert.strictEqual(firstOption(child, 'Where should the stack\'s plugins be enabled in this child'), 'local (Recommended)');
    assert.strictEqual(firstOption(child, 'Ignore these machine-local paths in this clone'), '.git/info/exclude (Recommended)');
    // the child text is read only on the role ask's Child answer, so a standalone install carries none of it
    assert.ok(!/cat "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/init-child\.md"/.test(refBody('init-install')), 'init-install reads init-child.md unasked');
    assert.match(flat(refBody('init-role')), /\*\*Child of `<rel>`\*\* - read `\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/init-child\.md` now/);
});

test('init-child: the local-scope hygiene lines come from git-hygiene.js --local-child, read and applied (AC8)', () =>
{
    const child = refBody('init-child');
    const hy = child.slice(child.indexOf('## Git hygiene at `local` scope'));
    assert.match(hy, /`node "\$TMP\/repo\/scripts\/git-hygiene\.js" --root \. --local-child`/);
    assert.match(hy, /`node "\$TMP\/repo\/scripts\/git-hygiene\.js" --root \. --local-child --apply exclude\|gitignore`/);
    assert.match(hy, /\.prettierignore/);
    assert.match(hy, /no `!\.claude\/AGENTS\.md` re-include/);
});

test('update-workspace.md is cat only behind a workspace line', () =>
{
    const walk = flat(refBody('update-walk'));
    const cats = walk.match(/[^;]*cat "\$TMP\/plan\.txt" "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/update-workspace\.md"/g) || [];
    assert.strictEqual(cats.length, 1, 'one read of update-workspace.md, in step 2\'s call');
    assert.match(cats[0], /^ grep -qE '\^workspace-plan: \(\[2-9\]\|\[0-9\]\{2,\}\) \|\^gone: \|\^rescan: ' "\$TMP\/plan\.txt" && cat /, 'only behind a second project, a gone child or a rescan row');
    assert.match(walk, /node "\$TMP\/repo\/scripts\/workspace\.js" plan --root \. --source "\$TMP\/repo" > "\$TMP\/plan\.txt" ;/);
});

test('the plan and the cascade calls carry the 10-minute budget, and a cascade that outruns it is waited for, never re-run', () =>
{
    const walk = flat(refBody('update-walk'));
    assert.match(walk, /Pass `timeout: 600000` to this call: `plan` reads each parent back/, 'step 2 gives the plan call the budget its read-backs need');
    const cascade = flat(refBody('update-workspace'));
    assert.match(cascade, /ONE call with `timeout: 600000`/);
    assert.match(cascade, /A cascade that outruns it comes back BACKGROUNDED and keeps running: never start it again \(two cascades would update the same children at once\)\. Wait for its completion notice, then go on/);
    const close = flat(refBody('update-close'));
    assert.match(close, /A `cascade\.txt` with no `cascade: done` line is a cascade still running: wait for its completion notice and read it again/);
});

test('validate and configure never offer a seed:false row', () =>
{
    const sentence = /A row with `"seed": false` is never MISSING and never offered: it is set only in the launch environment or by hand \(`ALFRED_CODE_WORKSPACE`\)\./;
    assert.match(flat(cmdBody('validate')), sentence);
    assert.match(flat(cmdBody('configure')), sentence);
});

// The user's ask of 2026-10-28: update asks whether the projects joined below update too; 'only this project' holds them.
test('update asks whether the children update too, and \'only this project\' runs the hold call instead of the cascade', () =>
{
    const cascade = refBody('update-workspace');
    for (const q of ['<each project: its rel and its asks', '<each project\'s rel>'])
    {
        const block = cascade.slice(cascade.indexOf(`as well? ${q}`)).split('```')[0];
        assert.match(block, /\n- 'No, only this project' - nothing below runs; each keeps its own copies and settings until it is updated\n$/, `the last option holds the children (${q})`);
    }
    const flatCascade = flat(cascade);
    assert.match(flatCascade, /a plan whose only rows below are `gone:` asks nothing and runs the cascade, which only removes their lines/);
    // Review 2026-10-28: the No is written at the ask, and the cascade call is ONE line on either answer.
    assert.match(flatCascade, /On 'No, only this project', record it now, in step 2, and write no child's answers: ```bash node "\$TMP\/repo\/scripts\/workspace\.js" answer --file "\$TMP\/answers\.json" --hold ```/);
    assert.strictEqual((cascade.match(/workspace\.js" cascade /g) || []).length, 1, 'one cascade call, the same on either answer');
    assert.ok(!/cascade --root \. --hold/.test(cascade), 'no second call for the hold');
    assert.match(flatCascade, /on 'No, only this project' no child's root: nothing below is written/, 'a held child gets no account-instructions write');
    assert.ok(!/'Answer each project|'Leave them all'/.test(cascade), 'the children\'s own asks are options of the one scope question now');
    const close = flat(refBody('update-close'));
    assert.match(close, /`updated` \/ `unchanged` \/ `failed` \/ `skipped` \/ `gone` \/ `held` \/ `gone-kept`/);
    // Minors of the 2026-10-28 review: a held row did not move, a gone-kept row is only its line, and a row step 2 never
    // printed has no version.
    assert.match(close, /for a `held` row the stamped version alone \(the left side of its `version=` field\), and `-` for a project step 2's plan printed no row for, a `gone` or a newly joined one;/);
    assert.match(close, /A `gone-kept` row is a folder that no longer holds an install: its line stays in this project's file until a cascade runs\./);
    // A side note of 2026-10-28: a hold leaves the folders below as they are, but a core installed for the whole account
    // moves for every project - the ask, the close and the release notes say so instead of 'as it is'.
    assert.match(flat(cascade), /A held child is not frozen whole: its folder is left as it is, but a core plugin installed for the whole account moves for every project, so its sessions run the new hooks and agents beside its older copies until its own update\./);
    assert.match(close, /updates the held projects' - and, where the core is installed for the whole account, that a held project already runs its new hooks and agents beside its older copies\./);
    const notes = flat(refBody('update-history'));
    assert.ok(!/leaves every project below as it is/.test(notes), 'the notes no longer say a hold freezes everything');
    assert.match(notes, /Where the core plugin is installed for your whole account, it still moves for every project/);
    assert.match(flatCascade, /The scope ask and the join ask go in one call, the scope ask first; when step 2's own call has no room for both, they take a call of their own right after\./);
    assert.ok(!/joined below this one as well/.test(cascade), 'a rescan row is not joined yet');
    assert.match(close, /Any `held` row puts ONE line on the follow-ups card: '`\/alfred-code:update` here again, answering yes, updates the held projects'/);
    assert.match(flat(refBody('update-walk')), /With `\$TMP\/plan\.txt` naming a child, run `update-workspace\.md`'s cascade call now - the same call on either answer/);
    // Review 2026-10-28: the slow path ran no cascade at all - it now points at the same call before the close.
    assert.match(flat(refBody('update-slow-path')), /With `\$TMP\/plan\.txt` naming a child, run `update-workspace\.md`'s cascade call now - the same call on either answer\. Then step 6 of `update-close\.md`\./);
    assert.match(flat(cmdBody('update')), /whether the projects joined below update too/);
});

test('update-close reads the cascade rows and runs check-loads only when cascade.txt exists', () =>
{
    const close = flat(refBody('update-close'));
    assert.match(close, /\[ -f "\$TMP\/cascade\.txt" \] && cat "\$TMP\/cascade\.txt"/, 'the rows are read only when the cascade ran');
    assert.match(close, /node "\$TMP\/repo\/scripts\/workspace\.js" check-loads --root <rel>/, 'check-loads per updated child');
    assert.match(close, /`updated` \/ `unchanged` \/ `failed` \/ `skipped` \/ `gone`/);
});

// ALFRED_CODE_MAXIMUM_RUN_AGENTS (2026-10-27): the AskUserQuestion tool takes four questions a call, so configure's
// environment step asks its rows in calls of at most four, as init's screen B does (init-env-more.md holds its second).
test('configure step 8 and init screen B ask the environment rows in calls of at most four', () => {
    assert.match(flat(cmdBody('configure')), /in calls of at most four questions, in catalog order/);
    const install = flat(fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'init-install.md'), 'utf8'));
    assert.match(install, /in calls of at most four in catalog order - the rows past the first four in a second call, from `cat "\$\{CLAUDE_PLUGIN_ROOT\}\/setup-plugin\/references\/init-env-more\.md"`/);
    const more = fs.readFileSync(path.join(PLUGIN_DIR, 'references', 'init-env-more.md'), 'utf8');
    assert.match(more, /^How many of a session's agents may run at once\?$/m);
});

// Workspace roles and variables (T16): the role asks at init and configure, the env steps through variables.js, and no
// body that still places a moved key in a settings env.
test('init reads init-role.md before screen A and its template marks the first option', () =>
{
    const install = refBody('init-install');
    const detect = install.indexOf('workspace.js" role --root . --when init');
    assert.ok(detect >= 0, 'the detection call runs workspace.js role --when init');
    const read = install.indexOf('init-role.md', detect);
    assert.ok(read > detect && read < install.indexOf('**Screen A'), 'init-role.md is read in the same call, before screen A');
    assert.doesNotMatch(install, /workspace\.js" parent --root/, 'the silent parent check is gone');
    const role = refBody('init-role');
    const blocks = askBlocks(role);
    assert.strictEqual(blocks.length, SETUP_ASK_TEMPLATES['setup-plugin/references/init-role.md']);
    assert.strictEqual(blocks.length, 1);
    assert.match(blocks[0][1], /\(Recommended\)/);
    assert.ok(blocks[0].slice(2).every((l) => !/\(Recommended\)/.test(l)), 'only the first option is marked');
    assert.match(role, /before screen A/i);
    assert.match(role, /workspace\.js" role --root \. --answer/);
    assert.match(role, /init-child\.md/);
    assert.match(refBody('init-child'), /workspace\.js" role --root \. --answer child/, 'a child joins through the role verb');
});

test('configure\'s Role templates list Keep (Recommended) first', () =>
{
    const body = cmdBody('configure');
    const blocks = askBlocks(body).filter((b) => /^This project's workspace role/.test(b[0]));
    assert.strictEqual(blocks.length, 3, 'one template per role: standalone, root, child');
    for (const b of blocks) assert.match(b[1], /^- 'Keep \(Recommended\)' - /, b[0]);
    const labels = blocks.map((b) => b.slice(1).map((l) => /^- '([^']*)'/.exec(l)[1]));
    assert.deepStrictEqual(labels, [
        ['Keep (Recommended)', 'Join <rel>', 'Become a root'],
        ['Keep (Recommended)', 'Join <rel>', 'Become standalone'],
        ['Keep (Recommended)', 'Leave and become standalone', 'Leave and become a root'],
    ], 'the labels are the ones workspace.js role prints');
    assert.match(body, /workspace\.js" role --root \. --answer/);
    assert.strictEqual(askBlocks(body).length, SETUP_ASK_TEMPLATES['setup-plugin/commands/configure.md']);
});

test('no body hand-merges a settings env: init and configure set the stack\'s values through variables.js set', () =>
{
    for (const [name, body] of [['init-install', refBody('init-install')], ['configure', cmdBody('configure')], ['validate', cmdBody('validate')]])
    {
        assert.match(body, /scripts\/variables\.js" set --root \./, `${name} names variables.js set`);
        assert.doesNotMatch(body, /a merge on the scope's settings(?: file|\.json) touching ONLY the chosen keys/, `${name} still hand-merges the env`);
    }
    assert.match(cmdBody('status'), /scripts\/variables\.js" show --root \./, 'status reads the values with their sources');
    assert.match(cmdBody('validate'), /scripts\/variables\.js" show --root \./, 'validate reconciles what show reads');
});

test('no body places a moved key in a settings env', () =>
{
    const layout = require('../stack/hooks/layout.js');
    const moved = layout.VARIABLE_KEYS.filter((k) => k !== 'ALFRED_CODE_WORKSPACE').map((k) => new RegExp(`${k}(?![A-Z0-9_])`));
    const hits = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.md'))
                fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) =>
                {
                    // A line naming .variables describes the move itself (the history entry, the way back).
                    if (moved.some((re) => re.test(line)) && /settings(\.local)?\.json|the settings file|settings env/.test(line) && /\benv\b/.test(line) && !/\.variables/.test(line))
                        hits.push(`${path.relative(ROOT, p)}:${i + 1}`);
                });
        }
    };
    for (const top of ['setup-plugin', 'stack']) walk(path.join(ROOT, top));
    assert.deepStrictEqual(hits, []);
});

test('the 3.0.0 history entry opens with the update-together contract and the way back', () =>
{
    const history = refBody('update-history');
    const at = history.indexOf('\n## in 3.0.0 - ');
    assert.ok(at >= 0, 'a section owed below 3.0.0');
    const next = history.indexOf('\n## ', at + 4);
    const entry = history.slice(at, next < 0 ? undefined : next);
    const first = entry.split('\n\n')[1];
    assert.match(first, /update together/i, 'its first paragraph is the team contract');
    assert.match(first, /2\.12\.0 or older reads none of them/);
    assert.match(entry, /settings\.json by hand/, 'the way back');
    for (const key of ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_MAXIMUM_RUN_AGENTS']) assert.ok(entry.includes(key), `${key} named`);
});

test('the capture-quality history entry tells an account-file override to be re-keyed by hand (spec 5.4)', () =>
{
    const history = refBody('update-history');
    const at = history.indexOf('\n## after 3.2.1 - the three quality captures become capture-quality');
    assert.ok(at >= 0, 'the capture-quality section');
    const next = history.indexOf('\n## ', at + 4);
    const entry = history.slice(at, next < 0 ? undefined : next).replace(/\s+/g, ' ');
    assert.match(entry, /`~\/\.claude\/settings\.json`/, 'the account file named');
    assert.match(entry, /by hand/, 'the re-key is the user\'s');
});
