'use strict';
// THE SELECTION OF THE NODE SEED - Phase 7, T4b.
//
// The filter is what stands between a walk's answers and a project's files, and its safety property
// is an intersection: a name the manifest does not carry can never be installed, so a user-authored
// skill or rule is safe by construction. The adoption rules are the other half - what an UPDATE
// pulls in that the target never asked for, and what it deliberately does not.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sel = require('./install/selection.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-selection-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const LISTS = {
    skills: ['aspnet|project-aspnet', 'web|project-angular'],
    plugins: ['claude-hud@claude-plugins-official', 'security-guidance@claude-plugins-official'],
    mcps: ['serena|-- uvx serena', 'playwright|-- npx pw'],
    agents: ['ng-implementer.md::sonnet', 'security-auditor.md::opus'],
    rules: ['baseline-security.md::x', 'markdown-docs.md::y'],
    hooks: ['guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'docs-session.js::SessionStart'],
};

let seq = 0;
function target({ skills = [], agents = [], rules = [], hooks = [] } = {})
{
    const claudeDir = path.join(TMP, `t-${seq++}`, '.claude');
    for (const s of skills)
    {
        fs.mkdirSync(path.join(claudeDir, 'skills', s), { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'skills', s, 'SKILL.md'), '# s\n');
    }
    const put = (dir, names, ext) =>
    {
        if (!names.length) return;
        fs.mkdirSync(path.join(claudeDir, dir), { recursive: true });
        for (const n of names) fs.writeFileSync(path.join(claudeDir, dir, `${n}${ext}`), '# x\n');
    };
    put('agents', agents, '.md');
    put('rules', rules, '.md');
    put('hooks', hooks, '.js');
    return claudeDir;
}

// --- the filter -----------------------------------------------------------

test('filter: only the named entries survive, and the manifest is the ceiling', () =>
{
    // 'skill project-invented' is not a manifest name, so it can never be installed - which is what
    // keeps a project's own skill folder safe from this filter.
    const picked = sel.parseSelection('skill project-aspnet\nplugin claude-hud\nmcp serena\nagent ng-implementer\nrule baseline-security\nhook docs-session\nskill project-invented\n');
    const out = sel.applySelection(LISTS, picked);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
    assert.deepStrictEqual(out.plugins, ['claude-hud@claude-plugins-official']);
    assert.deepStrictEqual(out.mcps, ['serena|-- uvx serena']);
    assert.deepStrictEqual(out.agents, ['ng-implementer.md::sonnet']);
    assert.deepStrictEqual(out.rules, ['baseline-security.md::x']);
    assert.deepStrictEqual(out.hooks, ['docs-session.js::SessionStart']);
});

test('filter: a selection with NO hook lines keeps every hook', () =>
{
    // Hooks joined the walk later, so a file written before that layer must keep its
    // install-everything behaviour.
    const out = sel.applySelection(LISTS, sel.parseSelection('skill project-aspnet\n'));
    assert.deepStrictEqual(out.hooks, LISTS.hooks);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
});

test('filter: comments, blank lines and stray whitespace are not names', () =>
{
    const picked = sel.parseSelection('# a walk wrote this\n\n  skill project-aspnet  \n#skill project-angular\n');
    const out = sel.applySelection(LISTS, picked);
    assert.deepStrictEqual(out.skills, ['aspnet|project-aspnet']);
});

test('filter: a hook wired twice is kept or dropped as ONE name', () =>
{
    const out = sel.applySelection(LISTS, sel.parseSelection('hook guard-read-whole-file\n'));
    assert.deepStrictEqual(out.hooks, ['guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash']);
});

test('plan: the dry run prints six lines and counts a twice-wired hook once', () =>
{
    const lines = sel.renderPlan(LISTS);
    assert.strictEqual(lines.length, 6);
    assert.strictEqual(lines[0], 'plan skills: project-aspnet project-angular');
    assert.strictEqual(lines[5], 'plan hooks: guard-read-whole-file docs-session');
    assert.strictEqual(sel.renderPlan({}).join('\n').split('\n')[0], 'plan skills:');
});

// --- deriving from the target --------------------------------------------

test('derive: skills, agents, rules and hooks are read off disk', () =>
{
    const dir = target({ skills: ['project-aspnet'], agents: ['ng-implementer'], rules: ['baseline-security'], hooks: ['docs-session'] });
    const lines = sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] });
    for (const want of ['skill project-aspnet', 'agent ng-implementer', 'rule baseline-security', 'hook docs-session'])
        assert.ok(lines.includes(want), `${want} missing from ${lines.join(', ')}`);
});

test('derive: generated project-owned files and the engine modules are NOT items', () =>
{
    // The captures rewrite baseline-project-* and project-code-style; docs.js / memory.js are
    // engines and hook-prelude.js the shared gate module - none of them is a hook.
    const dir = target({
        rules: ['baseline-security', 'baseline-project-agent-capabilities', 'project-code-style'],
        hooks: ['docs-session', 'docs', 'memory', 'hook-prelude', 'fresh-session'],
    });
    const lines = sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] });
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('rule ')), ['rule baseline-security']);
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('hook ')), ['hook docs-session']);
});

test('derive: a skill folder without a SKILL.md is not a skill', () =>
{
    const dir = target({ skills: ['project-aspnet'] });
    fs.mkdirSync(path.join(dir, 'skills', 'half-written'), { recursive: true });
    assert.deepStrictEqual(sel.deriveFromDisk({ claudeDir: dir, knownPlugins: [] }).filter((l) => l.startsWith('skill ')),
        ['skill project-aspnet']);
});

test('derive: the four playwright engines collapse back to the ONE manifest entry', () =>
{
    const lines = sel.deriveFromDisk({
        claudeDir: target({ skills: ['x'] }),
        mcpServers: ['serena', 'playwright-chrome', 'playwright-firefox', 'my-own'],
        knownPlugins: [],
    });
    assert.deepStrictEqual(lines.filter((l) => l.startsWith('mcp ')), ['mcp serena', 'mcp playwright', 'mcp my-own']);
});

test('derive: only KNOWN plugins are taken from the listing, and none listed is none picked', () =>
{
    const dir = target({ skills: ['x'] });
    const known = ['claude-hud@claude-plugins-official', 'security-guidance@claude-plugins-official'];
    const got = sel.deriveFromDisk({ claudeDir: dir, plugins: ['claude-hud@x', 'someone-elses@y'], knownPlugins: known });
    assert.deepStrictEqual(got.filter((l) => l.startsWith('plugin ')), ['plugin claude-hud']);
    // update INSTALLS an absent plugin, so a manifest-set fallback put all five on a project whose
    // user picked none - a listing that names none of them, or one that could not be read.
    for (const plugins of [[], ['alfred-code@envoydev']])
        assert.deepStrictEqual(sel.deriveFromDisk({ claudeDir: dir, plugins, knownPlugins: known }).filter((l) => l.startsWith('plugin ')), [], JSON.stringify(plugins));
});

test('derive: the nothing-installed guard reads the FILE layers only', () =>
{
    // A machine-level plugin listing, or a shared .mcp.json, is no evidence that THIS target has an
    // install - a bare `any lines` test could never fail, because the plugin fallback always adds some.
    assert.strictEqual(sel.hasInstall(['plugin claude-hud', 'mcp serena']), false);
    assert.strictEqual(sel.hasInstall(['plugin claude-hud', 'rule baseline-security']), true);
});

// --- adoption -------------------------------------------------------------

test('adopt-hooks: every shipped hook reaches an install that HAS hooks', () =>
{
    // A hook the release added is invisible to a disk scan - measured: the commit gate reached zero
    // of three consuming projects.
    const logs = [];
    const out = sel.adoptHooks({
        lines: ['hook docs-session'],
        catalog: ['docs-session.js::SessionStart', 'guard-ungated-commit.js::Bash'],
        shippedBefore: [], log: (m) => logs.push(m),
    });
    assert.ok(out.includes('hook guard-ungated-commit'), out.join(', '));
    assert.ok(logs.some((m) => /adopting hook guard-ungated-commit/.test(m)), logs.join(' | '));
});

test('adopt-hooks: a hook the PREVIOUS stamp shipped and disk no longer has stays out', () =>
{
    const logs = [];
    const out = sel.adoptHooks({
        lines: ['hook docs-session'],
        catalog: ['docs-session.js::SessionStart', 'guard-answer-length.js::Stop'],
        shippedBefore: ['docs-session', 'guard-answer-length'], log: (m) => logs.push(m),
    });
    assert.ok(!out.includes('hook guard-answer-length'), 'a deliberate drop was re-adopted');
    assert.ok(logs.some((m) => /was dropped from this install/.test(m)), logs.join(' | '));
});

test('adopt-hooks: an install with NO hooks adopts none', () =>
{
    assert.deepStrictEqual(sel.adoptHooks({ lines: ['rule baseline-security'], catalog: ['docs-session.js::SessionStart'] }),
        ['rule baseline-security']);
});

test('adopt-always: the locked baseline is adopted with NO drop exception', () =>
{
    // A stamp that named the shipped list once read as a drop of everything, and the memory rule
    // never arrived - so the always set ignores the stamp entirely.
    const logs = [];
    const out = sel.adoptAlways({
        lines: ['rule markdown-docs', 'mcp serena'],
        always: { rules: ['baseline-security', 'baseline-memory'], mcps: ['serena', 'memory'] },
        log: (m) => logs.push(m),
    });
    assert.ok(out.includes('rule baseline-memory') && out.includes('mcp memory'), out.join(', '));
    assert.strictEqual(logs.filter((m) => /adopting/.test(m)).length, 3);
});

test('adopt-always: a layer this install does not carry at all stays absent', () =>
{
    const out = sel.adoptAlways({
        lines: ['rule markdown-docs'],
        always: { rules: ['baseline-security'], mcps: ['serena', 'memory'] },
    });
    assert.ok(!out.some((l) => l.startsWith('mcp ')), 'servers were adopted into an install that registers none');
});

// THE --installed-only READ-BACK, whole (Phase 8 T1). On the plugin routes `.claude/` holds only the
// extras, so the seats, hooks and MCP entries are read back from the state those routes write - and
// NOTHING is written back for a surface the run found no evidence of: a failed `claude plugin list`
// once turned into all thirteen hooks switched off and the eight core seats denied, for good.
const ROOT_DIR = path.join(__dirname, '..');
const { loadManifest } = require('./install/manifest.js');
const MANIFEST = loadManifest(ROOT_DIR);
const ALL = { skills: true, hooks: true, mcps: true };
const row = (id, extra = {}) => ({ name: id.split('@')[0], marketplace: id.split('@')[1] || '', scope: 'project', version: '1', enabled: true, ...extra });

function readBackCase({ listing = [], settings = {}, routes = ALL, hooks = [], stampPicked, stampHooks = [], lastHooksRoute = null, marketplace } = {})
{
    const claudeDir = target({ rules: ['baseline-security'], hooks });
    return sel.readBack({
        claudeDir, mcpServers: [], listing, settings, routes, manifest: MANIFEST, sourceDir: ROOT_DIR,
        stampHooks, lastHooksRoute, always: {}, stampPicked, marketplace,
    });
}

// The hooks ride the core (2.0.0, 'Fold into core'): the core's row is what says the hooks arrive
// through a plugin - there is no hooks entry to list.
test('read-back: a healthy listing reads seats, hooks and MCP entries back, and answers both surfaces', () =>
{
    const r = readBackCase({
        listing: [row('alfred-code@envoydev'), row('claude-stack-aspnet@envoydev'), row('serena@envoydev')],
        settings: { permissions: { deny: ['Agent(alfred-code:security-auditor)'] }, env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } },
    });
    assert.ok(r.lines.includes('agent evidence-gatherer') && !r.lines.includes('agent security-auditor'));
    assert.ok(r.lines.includes('hook docs-session') && !r.lines.includes('hook guard-answer-length'));
    assert.ok(r.lines.includes('mcp serena'));
    assert.deepStrictEqual(r.answered, { hooks: true, agents: true });
});

test('read-back: an EMPTY listing (the CLI failed) answers neither surface - nothing is switched off', () =>
{
    const r = readBackCase({ listing: [] });
    assert.ok(r.installed, 'the rules on disk still prove an install');
    assert.deepStrictEqual(r.answered, { hooks: false, agents: false });
    assert.ok(!r.lines.some((l) => /^(agent|hook) /.test(l)));
});

test('read-back: a plugin-route install with nothing on disk is still an install - its own project entries prove it', () =>
{
    // Every pick carried by an entry and no rule copied (a hand selection) left `.claude/` empty of
    // skills, seats, rules and hooks, and the update refused with 'found nothing installed'.
    const bare = (listing) => sel.readBack({
        claudeDir: target({}), mcpServers: [], listing, settings: {}, routes: ALL, manifest: MANIFEST, sourceDir: ROOT_DIR, always: {},
    });
    const project = bare([row('alfred-code@envoydev'), row('claude-stack-csharp@envoydev')]);
    assert.ok(project.installed, 'the project-scoped entries were not read as an install');
    assert.ok(project.lines.includes('skill csharp') && project.lines.some((l) => l.startsWith('hook ')), project.lines.join(', '));
    assert.ok(bare([row('alfred-code@envoydev', { scope: 'local' })]).installed, 'a local-scope entry is this project too');
    // An ACCOUNT-scope entry is every project's - reading it as this one's would install into a
    // project the stack never touched.
    assert.strictEqual(bare([row('alfred-code@envoydev', { scope: 'user' })]).installed, false);
    assert.strictEqual(bare([row('claude-stack-csharp@envoydev', { enabled: false })]).installed, false, 'a parked entry is no install'); // legacy-name
    // The core is locked on: its listing flag can read false for a moved project-scope core that runs (S22).
    assert.strictEqual(bare([row('alfred-code@envoydev', { enabled: false })]).installed, true, 'a listed core is an install whatever its flag');
    assert.strictEqual(bare([row('alfred-code@other-market')]).installed, false, 'another marketplace is not ours');
});

test('read-back: copied hooks on disk still answer the hooks surface without the core listed', () =>
{
    const r = readBackCase({ listing: [], hooks: ['guard-read-whole-file'] });
    assert.strictEqual(r.answered.hooks, true);
});

test('read-back: a PARKED entry reads back nothing - a disabled browser stays disabled', () =>
{
    const r = readBackCase({ listing: [
        row('alfred-code@envoydev', { enabled: false }),
        row('playwright-firefox@envoydev', { enabled: false }), row('playwright-webkit@envoydev'),
    ] });
    assert.strictEqual(r.answered.hooks, true, 'the core carrying the hooks is locked on - HOOKS_OFF is the hook state, not its listing flag (S22)');
    assert.deepStrictEqual(r.engines, ['webkit']);
});

test('read-back: the core reads as enabled whatever the listing flag says (S22) - only an item\'s own off-switch holds', () =>
{
    const core = require('./plugin-placement.js').placement().plugins['alfred-code'];
    const seat = 'code-style-analyzer';
    assert.ok(core.agents.includes(seat) && core.skills.includes('markdown-style'), 'fixture: the core carries both');
    const stale = { enabled: false };
    const r = readBackCase({
        listing: [row('alfred-code@envoydev', stale)],
        settings: { permissions: { deny: [`Agent(alfred-code:${seat})`] }, env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } },
    });
    assert.deepStrictEqual(r.parked, [], 'the core is not parked by its flag');
    assert.deepStrictEqual(r.answered, { hooks: true, agents: true });
    assert.ok(r.lines.includes('skill markdown-style'), r.lines.join(', '));
    assert.ok(!r.lines.includes(`agent ${seat}`), 'the denied seat stays off');
    assert.ok(r.lines.includes('hook docs-session') && !r.lines.includes('hook guard-answer-length'), 'HOOKS_OFF still holds');
    assert.deepStrictEqual(sel.leftOut({ parked: r.parked, deny: r.deny }), [`agent ${seat}`], 'only the denied seat is left out - no core item for the flag');
    const inv = sel.planInventory({ lists: {}, listing: [row('alfred-code@envoydev', stale), row('claude-hud@claude-hud', stale)], answered: r.answered, pluginCatalog: ['claude-hud'] });
    assert.deepStrictEqual(inv.plugins_disabled, ['claude-hud'], 'validate shows no DISABLED row for the core');
});

test('read-back: another marketplace\'s same-named plugin is never read as a stack pick', () =>
{
    const r = readBackCase({ listing: [row('alfred-code@envoydev'), row('sentry@claude-plugins-official', { scope: 'user' }), row('playwright@claude-plugins-official')] });
    assert.ok(!r.lines.includes('mcp sentry') && !r.lines.includes('mcp playwright'), r.lines.filter((l) => l.startsWith('mcp ')).join(','));
});


test('read-back: a malformed deny or env block reads as absent, never aborts the update', () =>
{
    const r = readBackCase({ listing: [row('alfred-code@envoydev')], settings: { permissions: { deny: { oops: 1 } }, env: 'x' } });
    assert.ok(r.lines.includes('agent security-auditor'));
});

test('read-back: a skill the last install carried survives the release that retired its entry, as a pick', () =>
{
    const stampPicked = { skills: ['dotnet-web-backend@claude-stack-aspnet'], agents: [] };
    const moved = readBackCase({ listing: [row('alfred-code@envoydev'), row('claude-stack-aspnet@envoydev')], stampPicked });
    assert.ok(moved.lines.includes('skill dotnet-web-backend') && moved.closeFrom.includes('skill dotnet-web-backend'));
    const gone = readBackCase({ listing: [row('alfred-code@envoydev')], stampPicked });
    assert.ok(!gone.lines.includes('skill dotnet-web-backend'), 'its old home is uninstalled here - the user removed it');
    const parked = readBackCase({ listing: [row('alfred-code@envoydev'), row('claude-stack-aspnet@envoydev', { enabled: false })], stampPicked });
    assert.ok(!parked.lines.includes('skill dotnet-web-backend'), 'the user parked its entry');
    const blind = readBackCase({ listing: [], stampPicked });
    assert.ok(!blind.lines.includes('skill dotnet-web-backend'), 'no listing, no evidence of what is parked - the stamp is not read');
});

test('read-back: an enabled retired entry turns its stamp PICKS into picks, never what it merely carried', () =>
{
    const listing = [row('alfred-code@envoydev'), row('claude-stack-angular@envoydev')];
    const stampPicked = { skills: ['angular-conventions@claude-stack-angular', 'angular-testing@claude-stack-angular'], agents: [] };
    const r = readBackCase({ listing, stampPicked });
    assert.ok(r.closeFrom.includes('skill angular-conventions') && r.closeFrom.includes('skill angular-testing'), r.closeFrom.join(','));
    assert.ok(!r.closeFrom.includes('skill angular-styling'), 'carried by the entry, never picked');
    // The selection itself is what the library copies: an unpicked item the entry carried stays out of
    // it, not only out of the closure's input (the temp-project matrix copied it).
    assert.ok(r.lines.includes('skill angular-conventions') && !r.lines.includes('skill angular-styling'), r.lines.filter((l) => /angular/.test(l)).join(','));
    const legacy = readBackCase({ listing, stampPicked: null });
    for (const s of ['angular-conventions', 'angular-security', 'angular-styling', 'angular-testing'])
        assert.ok(legacy.closeFrom.includes(`skill ${s}`) && legacy.lines.includes(`skill ${s}`), `a stamp without picks adopts ${s}`);
    const parked = readBackCase({ listing: [row('alfred-code@envoydev'), row('claude-stack-angular@envoydev', { enabled: false })], stampPicked });
    assert.ok(!parked.closeFrom.some((l) => /^skill angular-/.test(l)), 'a parked retired entry carries nothing');
});

test('read-back: a stamp with no picked lines (an older install) takes what the enabled entries carry as picked', () =>
{
    const listing = [row('alfred-code@envoydev'), row('claude-stack-aspnet@envoydev')];
    const legacy = readBackCase({ listing, stampPicked: null, settings: { permissions: { deny: ['Agent(alfred-code:security-auditor)'] } } });
    assert.ok(legacy.closeFrom.includes('skill dotnet-web-backend') && legacy.closeFrom.includes('agent aspnet-implementer'), 'carried by an enabled entry');
    assert.ok(!legacy.closeFrom.includes('agent security-auditor'), 'a denied seat is no pick');
    const current = readBackCase({ listing, stampPicked: { skills: [], agents: [] } });
    assert.ok(!current.closeFrom.includes('skill dotnet-web-backend'), 'a stamp that recorded its picks is the answer, even an empty one');
    const blind = readBackCase({ listing: [], stampPicked: null });
    assert.ok(!blind.closeFrom.some((l) => /^(skill|agent) /.test(l)), 'no listing - nothing to adopt');
});

test('addLines: --add unions well-formed lines once, and logs each', () =>
{
    const logs = [];
    const out = sel.addLines(['rule baseline-security'], ['rule sql-conventions', 'rule baseline-security'], (m) => logs.push(m));
    assert.deepStrictEqual(out, ['rule baseline-security', 'rule sql-conventions']);
    assert.strictEqual(logs.length, 1);
    assert.match(logs[0], /adding rule sql-conventions/);
});

// The read-back CLOSED through the graph, as the frozen twin does - found missing from the Node seed
// in Phase 8 T3: a dependency a new release introduced, or one an --add pulls in, never arrived. The
// closure runs over what the user PICKED (disk, the stamp's picked lines, --add), never over what an
// entry merely carries: closing those would re-add an MCP the walk let the user drop.
const GRAPH = require('../meta/stack-graph.json');
const { computeClosure } = require('./stack-select.js');

test('closeLines: a picked rule pulls in what it requires, logged as required', () =>
{
    const logs = [];
    const out = sel.closeLines(['rule dotnet-repair-agents'], { from: ['rule dotnet-repair-agents'], graph: GRAPH, log: (m) => logs.push(m) });
    const want = computeClosure(GRAPH, { rules: ['dotnet-repair-agents'] }).agents;
    assert.ok(want.length > 0, 'the fixture rule requires seats');
    for (const a of want) assert.ok(out.includes(`agent ${a}`), `missing agent ${a}`);
    assert.ok(logs.some((l) => /^installed-only: required: agent /.test(l)), logs.join('\n'));
});

test('closeLines: a skill an entry merely CARRIES pulls in nothing, and hook lines pass through untouched', () =>
{
    const needy = Object.keys(GRAPH.skills).find((s) => computeClosure(GRAPH, { skills: [s] }).mcps.length > 0);
    assert.ok(needy, 'the graph has a skill that needs an MCP');
    const lines = [`skill ${needy}`, 'hook none', 'skill my-own-skill'];
    const out = sel.closeLines(lines, { from: ['hook none', 'skill my-own-skill'], graph: GRAPH });
    assert.deepStrictEqual(out, lines, 'no closure over a carried-only skill; the user\'s own item and hook none survive');
});

test('closeLines: no graph is a logged no-op, never a crash', () =>
{
    const logs = [];
    assert.deepStrictEqual(sel.closeLines(['rule x'], { from: ['rule x'], graph: null, log: (m) => logs.push(m) }), ['rule x']);
    assert.match(logs[0], /closure skipped/);
});

test('read-back: closeFrom is the picked set - disk and the stamp - never the carried-only items', () =>
{
    const r = readBackCase({ listing: [row('alfred-code@envoydev')], stampPicked: { skills: ['markdown-style'], agents: [] } });
    assert.ok(r.closeFrom.includes('rule baseline-security'), 'disk');
    assert.ok(r.closeFrom.includes('skill markdown-style'), 'the stamp');
    assert.ok(r.lines.includes('agent evidence-gatherer') && !r.closeFrom.includes('agent evidence-gatherer'), 'carried only');
});

test('closeLines: a requirement never switches back on a parked entry or a denied seat - it is left out and said so', () =>
{
    const logs = [];
    const out = sel.closeLines(['rule csharp-conventions'], { from: ['rule csharp-conventions'], graph: GRAPH, parked: ['claude-stack-csharp'], log: (m) => logs.push(m) });
    assert.ok(!out.includes('skill csharp'), 'the parked entry\'s skill stayed out');
    assert.ok(logs.some((l) => /required: skill csharp .*left out, its entry claude-stack-csharp is parked here/.test(l)), logs.join('\n'));
    const seats = computeClosure(GRAPH, { rules: ['dotnet-repair-agents'] }).agents;
    const denyLogs = [];
    const out2 = sel.closeLines(['rule dotnet-repair-agents'], { from: ['rule dotnet-repair-agents'], graph: GRAPH, deny: [`Agent(claude-stack-dotnet:${seats[0]})`], log: (m) => denyLogs.push(m) });
    assert.ok(!out2.includes(`agent ${seats[0]}`), 'the denied seat stayed out');
    assert.ok(denyLogs.some((l) => /left out, switched off in permissions.deny/.test(l)));
});

test('read-back: after the walk\'s None, a hook a new release adds stays off too', () =>
{
    const shipped = [...new Set(MANIFEST.catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const before = shipped.slice(1);   // the last release shipped all but the first
    const r = readBackCase({ listing: [row('alfred-code@envoydev')], settings: { env: { ALFRED_CODE_HOOKS_OFF: before.join(',') } }, stampHooks: before });
    assert.deepStrictEqual(r.lines.filter((l) => l.startsWith('hook ')), ['hook none']);
    const some = readBackCase({ listing: [row('alfred-code@envoydev')], settings: { env: { ALFRED_CODE_HOOKS_OFF: before.slice(1).join(',') } }, stampHooks: before });
    assert.ok(some.lines.includes(`hook ${shipped[0]}`), 'only a full None holds - a partial switch-off lets a new hook arrive');
    // A 1.x settings file still spells the switch-off CLAUDE_STACK_HOOKS_OFF: the same None. // legacy-name
    const old = readBackCase({ listing: [row('alfred-code@envoydev')], settings: { env: { CLAUDE_STACK_HOOKS_OFF: before.join(',') } }, stampHooks: before }); // legacy-name
    assert.deepStrictEqual(old.lines.filter((l) => l.startsWith('hook ')), ['hook none'], 'the 1.x spelling of the None');
});

// Review M3: a copy-route install whose user dropped EVERY hook has none on disk, and the read-back
// took that for 'every hook' - the update copied and wired all of them back (measured at b825638 too).
// Ruling R55: only the stamp's `hooks-route: copy` says the None was a choice. A leftover prelude is no
// evidence - a 1.x plugin-route stint, or one before 2.0.0 pruned it, leaves it behind.
test('read-back: a copy-route install that kept no hook reads back `hook none` only when its stamp says the copy route ran last', () =>
{
    const shipped = [...new Set(MANIFEST.catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const core = row('alfred-code@envoydev');
    const hookLines = (r) => r.lines.filter((l) => l.startsWith('hook '));
    for (const routes of [{ hooks: false, skills: true, mcps: true }, { hooks: false, skills: false, mcps: false }])
    {
        const r = readBackCase({ listing: [core], routes, hooks: ['hook-prelude'], stampHooks: shipped, lastHooksRoute: 'copy' });
        assert.deepStrictEqual(hookLines(r), ['hook none'], JSON.stringify(routes));
        assert.strictEqual(r.answered.hooks, true);
        const newer = readBackCase({ listing: [core], routes, stampHooks: shipped.slice(1), lastHooksRoute: 'copy' });
        assert.deepStrictEqual(hookLines(newer), ['hook none'], 'a hook this release added stays off with the rest');
    }
    const copy = { hooks: false, skills: true, mcps: true };
    for (const lastHooksRoute of [null, 'plugin'])
    {
        const bare = readBackCase({ listing: [core], routes: copy, hooks: ['hook-prelude', 'fresh-session'], stampHooks: shipped, lastHooksRoute });
        assert.deepStrictEqual(hookLines(bare), [], `${lastHooksRoute}: a leftover prelude is no None - nothing stored, every hook stays on`);
        const stored = readBackCase({ listing: [core], routes: copy, hooks: ['hook-prelude'], stampHooks: shipped, lastHooksRoute,
            settings: { env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } } });
        assert.deepStrictEqual(hookLines(stored).sort(), shipped.filter((h) => h !== 'guard-answer-length').map((h) => `hook ${h}`).sort(),
            `${lastHooksRoute}: the stored off list is kept`);
    }
    const plugin = readBackCase({ listing: [core], hooks: ['hook-prelude'], stampHooks: shipped, lastHooksRoute: 'copy' });
    assert.ok(!plugin.lines.includes('hook none'), 'the plugin route reads its hooks from the core and ALFRED_CODE_HOOKS_OFF');
});

// A flip from the plugin route to the copies leaves no hook on disk and the off-state in
// ALFRED_CODE_HOOKS_OFF - read back as the plugin route reads it, or every hook is copied and the
// run writes the value empty.
test('read-back: a flip to the hooks copy route carries the plugin route\'s ALFRED_CODE_HOOKS_OFF across', () =>
{
    const shipped = [...new Set(MANIFEST.catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const copy = { hooks: false, skills: true, mcps: true };
    const off = shipped.slice(0, 2);
    const r = readBackCase({ listing: [row('alfred-code@envoydev')], routes: copy, stampHooks: shipped, settings: { env: { ALFRED_CODE_HOOKS_OFF: off.join(',') } } });
    assert.deepStrictEqual(r.lines.filter((l) => l.startsWith('hook ')).sort(), shipped.slice(2).map((h) => `hook ${h}`).sort());
    assert.strictEqual(r.answered.hooks, true);
    const all = readBackCase({ listing: [row('alfred-code@envoydev')], routes: copy, stampHooks: shipped, settings: { env: { ALFRED_CODE_HOOKS_OFF: shipped.join(',') } } });
    assert.deepStrictEqual(all.lines.filter((l) => l.startsWith('hook ')), ['hook none'], 'every hook named off is a None');
    const unset = readBackCase({ listing: [row('alfred-code@envoydev')], routes: copy, stampHooks: shipped, settings: { env: { ALFRED_CODE_HOOKS_OFF: '' } } });
    assert.ok(!unset.lines.some((l) => l.startsWith('hook ')), 'nothing named off: every hook, as before');
});

test('closeLines: what a LEFT-OUT item requires is not pulled in either', () =>
{
    const rule = GRAPH.rules['csharp-conventions'];
    assert.ok(!rule.mcps.includes('context7'), 'the fixture rule does not need context7 itself');
    const out = sel.closeLines(['rule csharp-conventions'], { from: ['rule csharp-conventions'], graph: GRAPH, parked: ['claude-stack-csharp'] });
    assert.ok(!out.includes('skill csharp'));
    assert.ok(!out.includes('mcp context7'), 'context7 came in only through the parked skill');
});

test('dropLines: --drop removes a line and keeps the hooks answer - dropping the last hook is `hook none`', () =>
{
    const logs = [];
    assert.deepStrictEqual(sel.dropLines(['agent a', 'hook h1', 'rule r'], ['agent a'], (m) => logs.push(m)), ['hook h1', 'rule r']);
    assert.match(logs[0], /dropping agent a - named by --drop/);
    assert.deepStrictEqual(sel.dropLines(['hook h1', 'rule r'], ['hook h1']), ['rule r', 'hook none']);
    assert.deepStrictEqual(sel.dropLines(['rule r'], ['hook h1']), ['rule r'], 'no hook lines to begin with - nothing to answer');
});

// Phase 8 T4: configure and validate read the install through the installer's OWN read-back
// (`--print-plan --plan-out`), never by hand - a hand inventory unioned what the entries carry
// without subtracting the denied seats, so every configure run switched them back on.
test('planInventory: the inventory JSON - names per category, playwright folded, plugins with scope, parked ones apart', () =>
{
    const inv = sel.planInventory({
        lists: {
            skills: ['a|csharp'], agents: ['evidence-gatherer.md'], rules: ['baseline-security.md'],
            hooks: ['guard-read-whole-file.js::Read', 'guard-read-whole-file.js::Bash', 'docs-session.js'],
            mcps: ['playwright-chrome|x', 'playwright-firefox|y', 'serena|z'], plugins: ['claude-hud@claude-plugins-official', 'csharp-lsp@claude-plugins-official'],
        },
        listing: [row('claude-hud@claude-plugins-official', { scope: 'user' }), row('csharp-lsp@claude-plugins-official', { enabled: false }), row('claude-stack-devops@envoydev', { enabled: false }), row('superpowers@claude-plugins-official', { scope: 'user' })],
        answered: { hooks: true, agents: false },
        pluginCatalog: ['superpowers', 'claude-hud', 'csharp-lsp'],
        leftOut: ['agent security-auditor'],
    });
    assert.deepStrictEqual(inv.skills, ['csharp']);
    assert.deepStrictEqual(inv.hooks, ['guard-read-whole-file', 'docs-session']);
    assert.deepStrictEqual(inv.mcps, ['playwright', 'serena']);
    assert.deepStrictEqual(inv.plugins, [{ name: 'claude-hud', scope: 'user' }, { name: 'superpowers', scope: 'user' }],
        'an enabled catalog plugin the selection never lists (the core\'s dependency) is installed all the same');
    assert.deepStrictEqual(inv.parked_plugins, ['csharp-lsp'], 'only CATALOG plugins parked here - the read-back would enable them');
    assert.deepStrictEqual(inv.left_out, ['agent security-auditor']);
    assert.deepStrictEqual(inv.plugins_disabled, ['csharp-lsp', 'claude-stack-devops'], 'a parked stack entry is the same third state');
    assert.deepStrictEqual(inv.answered, { hooks: true, agents: false });
});

// T4: a --drop that takes a stack entry out of the plugin set must DISABLE that entry, or the
// dropped skill keeps loading through it. Only what the drop itself removed, dependents first.
test('droppedEntries: what the drop took out of the set, folded onto the listing, dependents first', () =>
{
    const listing = [
        row('claude-stack-aspnet@envoydev'), row('claude-stack-csharp@envoydev'),
        row('claude-stack-devops@envoydev'), row('playwright-chrome@envoydev'),
        row('playwright-firefox@envoydev', { enabled: false }),
    ];
    const deps = { 'claude-stack-aspnet': ['claude-stack-csharp'], 'claude-stack-csharp': ['alfred-code'] };
    const got = sel.droppedEntries({
        before: ['alfred-code', 'claude-stack-aspnet', 'claude-stack-csharp', 'playwright', 'claude-stack-devops'],
        after: ['alfred-code', 'claude-stack-devops'],
        listing, deps, marketplace: 'envoydev',
    });
    assert.deepStrictEqual(got.map((r) => r.name), ['claude-stack-aspnet', 'claude-stack-csharp', 'playwright-chrome'],
        'aspnet before the csharp it depends on; the parked firefox browser is not touched; devops stays');
});

test('leftOut: every item a parked entry carries, and every stack seat the deny list names', () =>
{
    const got = sel.leftOut({ parked: ['claude-stack-devops'], deny: ['Agent(alfred-code:evidence-gatherer)', 'Agent(my-own-seat)', 'Bash(curl:*)'] });
    assert.deepStrictEqual(got.sort(), ['agent devops-implementer', 'agent devops-solution-designer', 'agent devops-verifier', 'agent evidence-gatherer', 'skill devops'].sort());
});

test('droppedEntries: the core and the locked servers are never queued', () =>
{
    const listing = ['alfred-code', 'serena', 'context7', 'memory', 'playwright-chrome'].map((n) => row(`${n}@envoydev`));
    const got = sel.droppedEntries({ before: ['alfred-code', 'serena', 'context7', 'memory', 'playwright'], after: [], listing, deps: {}, marketplace: 'envoydev' });
    assert.deepStrictEqual(got.map((r) => r.name), ['playwright-chrome'], 'only the droppable browser server');
});

test('deriveFromDisk: a global install reads its skills from the account dir, the rest from the project', () =>
{
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dfd-'));
    try
    {
        const proj = path.join(root, 'proj', '.claude'); const acct = path.join(root, 'acct', 'skills');
        fs.mkdirSync(path.join(proj, 'rules'), { recursive: true }); fs.writeFileSync(path.join(proj, 'rules', 'baseline-git.md'), 'x');
        fs.mkdirSync(path.join(acct, 'csharp'), { recursive: true }); fs.writeFileSync(path.join(acct, 'csharp', 'SKILL.md'), 'x');
        const lines = sel.deriveFromDisk({ claudeDir: proj, skillsDir: acct });
        assert.ok(lines.includes('skill csharp') && lines.includes('rule baseline-git'), lines.join(','));
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// 2.0.0: a 1.x install keeps its marketplace KEY `claude-stack`, its listing may still name the core // legacy-name
// and the hooks id by their 1.x names (the catalog refreshed, no session since - evidence S9), and
// its stamp homes a core pick `@claude-stack`. The seed hands readBack the key it resolved; the rows // legacy-name
// under it are the same install, and the picks carry through the first 2.0.0 update.
const OLD = 'claude-stack'; // legacy-name

test('read-back: a 1.x install - the old key, the core still named claude-stack - is the same install, and its stamp picks are kept', () => // legacy-name
{
    const stampPicked = { skills: [`project-solve-cross-task@${OLD}`], agents: [`security-auditor@${OLD}`] };
    // A 1.x settings file carries the 1.x key name until this update's env pass renames it.
    const settings = { permissions: { deny: [`Agent(${OLD}:code-style-analyzer)`] }, env: { CLAUDE_STACK_HOOKS_OFF: 'guard-answer-length' } }; // legacy-name
    const renamed = { ...settings, env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } };
    const now = readBackCase({ listing: [row('alfred-code@envoydev'), row('serena@envoydev')], stampPicked, settings: renamed });
    for (const listing of [
        [row(`${OLD}@${OLD}`), row(`${OLD}-hooks@${OLD}`), row(`serena@${OLD}`)],
        [row(`alfred-code@${OLD}`), row(`serena@${OLD}`)],
        [row(`${OLD}@${OLD}`), row(`serena@${OLD}`)],
    ])
    {
        const r = readBackCase({ listing, stampPicked, settings, marketplace: OLD });
        assert.deepStrictEqual(r.answered, { hooks: true, agents: true }, listing[0].name);
        assert.ok(r.lines.includes('agent evidence-gatherer') && !r.lines.includes('agent code-style-analyzer'), 'the core seats, the 1.x deny honoured');
        assert.ok(r.lines.includes('hook docs-session') && !r.lines.includes('hook guard-answer-length'));
        assert.ok(r.closeFrom.includes('skill project-solve-cross-task') && r.closeFrom.includes('agent security-auditor'), 'the 1.x stamp picks are kept');
        assert.strictEqual(r.blind, false);
        assert.deepStrictEqual(r.lines.slice().sort(), now.lines.slice().sort(), 'the same read-back as the renamed install');
    }
});
