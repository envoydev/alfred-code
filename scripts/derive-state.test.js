'use strict';
// THE ONE DERIVATION - Phase 8, T0.
//
// Three commands and the installer used to decide four times what a selection installs: the walk
// described it in prose, the seed computed it again in code, and a route change reached three of
// them and not the fourth. `derive-state.js` is the single answer, and this file is its contract.
//
// The assertions that matter are the AGREEMENT ones: the derivation may not disagree with the two
// engines that already own their half - `stack-select.js` owns the closure, `selection-plugins.js`
// owns the placement. A derivation that computed its own plugin set would be the fifth copy.
//
// The OFF lists are the other half, and they have one rule each that is easy to get subtly wrong:
//   - a seat is a library COPY (the core carries none), so no seat is denied or allowed by a row: an
//     unpicked seat has no copy, and the installer only removes the `Agent(alfred-code:<seat>)` rows an
//     older install wrote.
//   - a hook is off when the release SHIPS it and this selection did not pick it, whole catalog,
//     because the core carries every one whatever the project picked.
//   - a skill is a project COPY (2.1.0), so a skill the selection did not pick is simply not
//     copied - no plugin carries one it could not drop.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deriveState, denySpec, agentHomes } = require('./derive-state.js');
const { placement } = require('./plugin-placement.js');
const { pluginsFor, readSelection, itemsOf } = require('./selection-plugins.js');
const { loadManifest } = require('./install/manifest.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-state-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function selectionFile(lines)
{
    const p = path.join(TMP, `sel-${seq++}.txt`);
    fs.writeFileSync(p, `${lines.join('\n')}\n`);
    return p;
}

// A real selection, closed by the engine that owns closure - never a hand-typed list, which is how
// a fixture stops describing what an install actually picks.
function realSelection()
{
    const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
    const seed = recs.stacks.aspnet;
    const always = recs.always;
    const raw = {
        skills: [...(always.skills || []), ...(seed.skills || [])],
        agents: [...(always.agents || []), ...(seed.agents || [])],
        rules: [...(always.rules || []), ...(seed.rules || [])],
        mcps: [...(always.mcps || []), ...(seed.mcps || [])],
        hooks: [...(always.hooks || [])],
    };
    const rawFile = path.join(TMP, `raw-${seq++}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(raw));
    const emitted = path.join(TMP, `emit-${seq++}.txt`);
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [
        path.join(ROOT, 'scripts', 'stack-select.js'),
        '--selection', rawFile, '--graph', path.join(ROOT, 'meta', 'stack-graph.json'), '--emit', emitted,
    ], { encoding: 'utf8' });
    return emitted;
}

const derive = (file) => deriveState({ selection: file, sourceDir: ROOT });

test('derive-state: the seven keys, every one of them present', () =>
{
    const got = derive(realSelection());
    for (const key of ['plugins', 'skills', 'agents', 'rules', 'hooks', 'mcps', 'env'])
        assert.ok(Object.hasOwn(got, key), `no ${key} in the derived state`);
});

test('derive-state: the plugin set is selection-plugins, not a second opinion', () =>
{
    const file = realSelection();
    const got = derive(file);
    const want = pluginsFor(readSelection(file)).plugins.map((p) => `${p}@envoydev`);
    assert.deepStrictEqual(got.plugins, want);
});

test('derive-state: the library items are the ones no plugin carries, and they are the copy list', () =>
{
    const file = realSelection();
    const got = derive(file);
    const want = pluginsFor(readSelection(file)).copy;
    assert.deepStrictEqual(got.skills.library, want.skills);
    assert.deepStrictEqual(got.agents.library, want.agents);
});

test('derive-state: no seat is denied - the core carries none, and every picked seat is a library copy', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    assert.deepStrictEqual(itemsOf(got.plugins.map((p) => p.split('@')[0])).agents, [], 'no enabled plugin carries a seat');
    assert.deepStrictEqual([got.agents.off, got.agents.deny, got.agents.allow], [[], [], []], 'so no seat has a row to write');
    assert.deepStrictEqual(got.agents.on, [...picked.agents].sort());
    assert.deepStrictEqual(got.agents.library, [...picked.agents].sort(), 'each picked seat is copied');
});

test('derive-state: the deny spelling a cleanup reads is the SCOPED identifier the spike measured', () =>
{
    // S3 measured the SCOPED spelling: `permissions.deny: ["Agent(spike:seat-bare)"]` dropped the
    // seat from the listing. No release writes one now; update takes out the rows an older install left.
    assert.strictEqual(denySpec('aspnet-verifier', 'alfred-code-aspnet'), 'Agent(alfred-code-aspnet:aspnet-verifier)');
    assert.deepStrictEqual(derive(realSelection()).agents.deny, []);
});

test('derive-state: the hooks off-list is the whole shipped catalog minus what was picked', () =>
{
    const file = realSelection();
    const got = derive(file);
    const shipped = new Set(loadManifest(ROOT).catalogs.hooks.map((row) => row.split('::')[0].replace(/\.js$/, '')));
    assert.ok(shipped.size >= 13, `the hooks catalog reads ${shipped.size} rows`);
    for (const name of got.hooks.off) assert.ok(shipped.has(name), `${name} is switched off but the release does not ship it`);
    assert.deepStrictEqual(
        [...shipped].filter((h) => !got.hooks.on.includes(h)).sort(),
        [...got.hooks.off].sort(),
        'on + off must be the whole catalog, or a hook is neither wired nor named',
    );
    assert.strictEqual(got.env.ALFRED_CODE_HOOKS_OFF, got.hooks.off.join(','));
});

test('derive-state: rules and MCP servers pass through as picked - they are copied and registered by name', () =>
{
    // Both lists are SORTED, and the fixture is written so that file order, reverse order and
    // sorted order are three different sequences - a two-name fixture read the same forwards and
    // backwards and let an unsorted list pass.
    const file = selectionFile([
        'skill csharp', 'agent security-auditor', 'rule csharp-conventions', 'rule alfred-security',
        'mcp alfred-documentation', 'mcp alfred-navigation', 'mcp chrome-control', 'hook guard-secret-value',
    ]);
    const got = derive(file);
    assert.deepStrictEqual(got.rules.copy, ['alfred-security', 'csharp-conventions']);
    assert.deepStrictEqual(got.mcps, ['alfred-documentation', 'alfred-navigation', 'chrome-control']);
    assert.deepStrictEqual([...got.hooks.on].sort(), ['guard-secret-value', ...require('./install/selection.js').LOCKED_HOOKS].sort(), 'the locked hooks ride the answer');
});

test('derive-state: an empty selection installs the core and denies nothing - no seat rides it', () =>
{
    const got = derive(selectionFile(['rule alfred-security']));
    assert.deepStrictEqual(got.plugins, ['alfred-code@envoydev'], 'the core is always enabled');
    const core = itemsOf(['alfred-code']);
    assert.deepStrictEqual([got.agents.off, got.agents.deny, core.agents], [[], [], []], 'the core carries no seat, so none is denied');
    assert.strictEqual(placement().library.agents.length, 45, 'every seat is a library copy');
    assert.deepStrictEqual(got.agents.on, []);
    assert.deepStrictEqual([core.skills, got.skills.library], [[], []], 'no skill rides the core, and none was picked to copy');
});

test('derive-state: a selection file that does not exist fails loudly, never as an empty install', () =>
{
    assert.throws(() => derive(path.join(TMP, 'no-such-selection.txt')), /cannot read/);
});

test('derive-state: the CLI prints the same object it returns', () =>
{
    const file = realSelection();
    const { execFileSync } = require('node:child_process');
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', file], { encoding: 'utf8' });
    const { routes, written, ...state } = JSON.parse(out);
    assert.deepStrictEqual(state, derive(file));
    assert.ok(routes && written, 'plus the routes it ran under and what they write');
});

// N6 (re-review): Claude Code puts settings.local.json's env into every process it starts, so setup's
// derivation took a personal route switch as the run's own while the installer (C5) follows settings.json
// at project and user scope - the `written` block then described an install the installer never makes.
// The CLI reads the routes the installer's way, from the project `--root` names at the `--scope` given.
test('derive-state: the CLI reads the routes the installer\'s way - a personal switch in settings.local.json yields to settings.json (N6)', () =>
{
    const file = realSelection();
    const { execFileSync } = require('node:child_process');
    const project = fs.mkdtempSync(path.join(TMP, 'routes-'));
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ env: {} }));
    const env = { ...process.env, ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const routesOf = (extra, { local = true } = {}) =>
    {
        const localFile = path.join(project, '.claude', 'settings.local.json');
        if (local) fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' } }));
        else fs.rmSync(localFile, { force: true });
        return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', file, ...extra], { cwd: project, env, encoding: 'utf8' })).routes;
    };
    assert.strictEqual(routesOf([]).skills, true, 'a personal switch decided the committed route (cwd, default project scope)');
    assert.strictEqual(routesOf(['--root', project, '--scope', 'user']).skills, true, 'user scope writes the shared file too');
    assert.strictEqual(routesOf(['--root', project, '--scope', 'local']).skills, false, 'at local scope the local file is the install\'s own');
    assert.strictEqual(routesOf(['--root', project], { local: false }).skills, false, 'a shell export the local file does not hold stands');
});

// THE INVERSE - what `update --installed-only` reads back. On the plugin routes `.claude/` holds
// only the extras, so a disk read found no seat and no hook: measured on the Phase 8 matrix, one
// update wrote all thirteen hooks into ALFRED_CODE_HOOKS_OFF, denied the eight core seats, and
// refreshed only the hooks and core entries while every stack and MCP plugin stayed a release
// behind. Each surface is read from the state its own route writes instead.
const { readInstalled } = require('./derive-state.js');
const ALL_ROUTES = { skills: true, hooks: true };
const fromText = (lines) => deriveState({ selectionText: lines.join('\n'), sourceDir: ROOT });

function narrowed({ dropAgent, dropHook })
{
    const text = fs.readFileSync(realSelection(), 'utf8').split('\n')
        .filter((l) => l.trim() !== `agent ${dropAgent}` && l.trim() !== `hook ${dropHook}`);
    return fromText(text);
}

function listingOf(state)
{
    return [...state.plugins.map((p) => p.split('@')[0]), 'claude-hud'];
}

test('readInstalled: an install read back derives the SAME off-state it was written from', () =>
{
    const before = narrowed({ dropAgent: 'security-auditor', dropHook: 'communication-reminder' });
    const lines = readInstalled({
        plugins: listingOf(before), deny: ['Agent(alfred-code:security-auditor)'],
        hooksOff: before.env.ALFRED_CODE_HOOKS_OFF, routes: ALL_ROUTES, sourceDir: ROOT,
    });
    const after = fromText(lines);
    assert.ok(!lines.includes('agent security-auditor'), 'a seat a plugin-route install had switched off is not read back');
    assert.deepStrictEqual(after.hooks.off, before.hooks.off, 'a hook the user switched off stays off');
    assert.deepStrictEqual(after.plugins.filter((p) => p.startsWith('alfred-code')), before.plugins.filter((p) => p.startsWith('alfred-code')),
        'every stack entry the project enabled is still in the set the update refreshes');
    assert.ok(!before.agents.on.includes('security-auditor'), 'the fixture really dropped a seat');
    assert.ok(before.hooks.off.includes('communication-reminder'), 'the fixture really dropped a hook');
});

test('readInstalled: a hook HOOKS_OFF does not name is on - a new release hook is adopted', () =>
{
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: 'communication-reminder', routes: ALL_ROUTES, sourceDir: ROOT });
    const hooks = lines.filter((l) => l.startsWith('hook ')).map((l) => l.slice(5));
    assert.ok(!hooks.includes('communication-reminder'));
    assert.ok(hooks.includes('docs-session') && hooks.includes('preferences-session'));
    const shipped = new Set(require('../meta/stack-manifest.json').hooks.map((h) => h.file.replace(/\.js$/, '')));
    assert.strictEqual(hooks.length, shipped.size - 1, 'every shipped hook but the one HOOKS_OFF names');
});

test('readInstalled: each surface reads back only while its own route is on', () =>
{
    const plugins = ['alfred-code', 'navigation'];
    assert.deepStrictEqual(readInstalled({ plugins, hooksOff: '', routes: {}, sourceDir: ROOT }), [],
        'the full copy route reads the disk alone');
    // The hooks ride the core (2.0.0): without it the hooks on disk decide, and so they do on the
    // hooks copy route with the core on for the skills.
    const noCore = readInstalled({ plugins: ['navigation'], hooksOff: '', routes: ALL_ROUTES, sourceDir: ROOT });
    assert.ok(!noCore.some((l) => l.startsWith('hook ')), 'no core enabled: the hooks on disk decide');
    const hooksCopied = readInstalled({ plugins: ['alfred-code'], hooksOff: '', routes: { skills: true, mcps: true }, sourceDir: ROOT });
    assert.ok(!hooksCopied.some((l) => l.startsWith('hook ')), 'the hooks copy route: the core carries them, the wired copies decide');
    assert.ok(readInstalled({ plugins: ['alfred-code'], hooksOff: '', routes: { hooks: true }, sourceDir: ROOT }).includes('hook docs-session'), 'the core carries the hooks');
    const skillsOnly = readInstalled({ plugins, hooksOff: '', routes: { skills: true }, sourceDir: ROOT });
    assert.ok(skillsOnly.every((l) => /^(skill|agent) /.test(l)) && skillsOnly.length > 0);
});

test('readInstalled: an MCP entry an older release shipped folds back onto nothing - the stack ships no server since 2.10.1', () =>
{
    const lines = readInstalled({
        plugins: ['alfred-navigation', 'alfred-documentation', 'context7-local', 'firefox-control', 'webkit-control', 'claude-hud'],
        routes: { mcps: true }, sourceDir: ROOT,
    });
    assert.deepStrictEqual(lines, []);
});

test('readInstalled: a denied seat is not read back, whatever plugin carries it', () =>
{
    const lines = readInstalled({
        plugins: ['alfred-code'],
        deny: ['Agent(alfred-code:evidence-gatherer)', 'Read(./.env)'],
        routes: { skills: true }, sourceDir: ROOT,
    });
    assert.ok(!lines.includes('agent evidence-gatherer'));
    assert.ok(lines.includes('agent security-auditor'));
});

test('readInstalled: HOOKS_OFF matches the way the hooks read it - `.js`, case and space ignored', () =>
{
    // The frozen shell twin writes `communication-reminder.js`; the prelude honours it. A read-back
    // that missed it would switch the user's hook back on at the next node update.
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: ' Guard-Answer.js ,guard-secret', routes: { hooks: true }, sourceDir: ROOT });
    assert.ok(!lines.includes('hook communication-reminder'));
    assert.ok(lines.includes('hook guard-secret-value'), 'a prefix never matches, as in the prelude');
});

test('readInstalled: a seat denied under ANY stack entry\'s spelling stays off after it moves home', () =>
{
    const lines = readInstalled({ plugins: ['alfred-code'], deny: ['Agent(alfred-code-old-home:security-auditor)'], routes: { skills: true }, sourceDir: ROOT });
    assert.ok(!lines.includes('agent security-auditor'));
});

test('writable: a surface the read-back found no evidence of writes nothing back', () =>
{
    const { writable } = require('./derive-state.js');
    const state = derive(realSelection());
    const none = writable(state, { routes: ALL_ROUTES, answered: { hooks: false, agents: false } });
    assert.deepStrictEqual(none, { hooksOff: [], hooksAnswered: false, agentDeny: [], agentAllow: [] });
    const both = writable(state, { routes: ALL_ROUTES, answered: { hooks: true, agents: true } });
    assert.strictEqual(both.hooksAnswered, true);
    assert.deepStrictEqual(both.agentAllow, state.agents.allow);
    const copy = writable(state, { routes: {}, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual([copy.hooksOff, copy.agentDeny, copy.agentAllow], [[], [], []], 'the full copy route writes no off-state');
});

// The hooks ride the core (2.0.0), and the core is on whenever ANY plugin route is. On the hooks copy
// route the picked hooks are copied and wired - the core's copies of those stand down for their
// twins - but an UNPICKED hook has no twin, so only ALFRED_CODE_HOOKS_OFF can keep the core's copy
// quiet. Before the fold no plugin carried it on that route, and it did not run at all.
test('writable: the hooks copy route with the core on still names the unpicked hooks off', () =>
{
    const { writable } = require('./derive-state.js');
    const state = narrowed({ dropAgent: 'security-auditor', dropHook: 'communication-reminder' });
    assert.ok(state.hooks.off.includes('communication-reminder'), 'fixture: a hook left unpicked');
    const hooksCopied = writable(state, { routes: { hooks: false, skills: true }, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual(hooksCopied.hooksOff, state.hooks.off, 'the core carries the unpicked hook - HOOKS_OFF is its only off-switch');
    const fullCopy = writable(state, { routes: { hooks: false, skills: false }, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual(fullCopy.hooksOff, [], 'no core on the full copy route - absence is off');
});

// Review M3: on that route the off-list is the complement of what the run WIRES, whatever the
// read-back answered - a pre-11b copy-route install never wrote it, and a run with no selection to
// derive from (a bare install) still wires a known set. The core must not fire what the project dropped.
test('writable: on the hooks copy route with the core on, every shipped hook the run does not wire is named off', () =>
{
    const { writable } = require('./derive-state.js');
    const shipped = ['guard-a', 'guard-b', 'guard-c'];
    const core = { hooks: false, skills: true, mcps: true };
    const none = writable(null, { routes: core, answered: { hooks: false, agents: false }, wired: [], shipped });
    assert.deepStrictEqual([none.hooksOff, none.hooksAnswered], [shipped, true], 'nothing wired: every hook off, and written with no evidence read');
    const some = writable(null, { routes: core, answered: { hooks: false, agents: true }, wired: ['guard-b'], shipped });
    assert.deepStrictEqual(some.hooksOff, ['guard-a', 'guard-c']);
    assert.deepStrictEqual(writable(null, { routes: core, wired: shipped, shipped }).hooksOff, [], 'every hook wired: each core copy stands down for its twin');
    const full = writable(null, { routes: {}, wired: [], shipped });
    assert.deepStrictEqual([full.hooksOff, full.hooksAnswered], [[], false], 'no core on the full copy route');
    const state = narrowed({ dropAgent: 'security-auditor', dropHook: 'communication-reminder' });
    assert.deepStrictEqual(writable(state, { routes: ALL_ROUTES, wired: [], shipped }).hooksOff, state.hooks.off, 'the plugin route reads the selection, never the copies');
});

// THE FLOOR - status's plugin line counted skill and command descriptions and left the SEATS out,
// though every enabled seat's description rides the Agent tool's listing on every message. A seat
// `permissions.deny` switches off costs nothing (spike S3), and a `disable-model-invocation` skill's
// description is not in context at all ('Control who invokes a skill', code.claude.com/docs/en/skills).
const { floor } = require('./derive-state.js');
const { descriptionChars } = require('./plugin-placement.js');
const FLOOR_ENTRIES = ['alfred-code'];

test('floor: the model-invocable skills plus the seats not denied, from the stack\'s own entries', () =>
{
    // The core carries no seat and no skill - each is a project copy, counted from the project's folders.
    const carried = itemsOf(FLOOR_ENTRIES, { placement: placement() });
    const all = floor({ plugins: FLOOR_ENTRIES });
    assert.deepStrictEqual([carried.skills, carried.agents], [[], []], 'the core carries neither');
    assert.deepStrictEqual([all.skills.count, all.agents.count], [0, 0], 'with no skills or agents dir, nothing counts');
    const dir = fs.mkdtempSync(path.join(TMP, 'floor-agents-'));
    fs.mkdirSync(path.join(dir, 'security-auditor'));
    fs.copyFileSync(path.join(ROOT, 'stack', 'agents', 'security-auditor.md'), path.join(dir, 'security-auditor', 'security-auditor.md'));
    fs.copyFileSync(path.join(ROOT, 'stack', 'agents', 'evidence-gatherer.md'), path.join(dir, 'evidence-gatherer.md'));
    fs.writeFileSync(path.join(dir, 'my-own.md'), '---\nname: my-own\ndescription: mine\n---\n');
    const copies = floor({ plugins: FLOOR_ENTRIES, agentsDir: dir });
    assert.strictEqual(copies.agents.count, 2, 'a folder copy and a flat one count, the project\'s own seat does not');
    assert.strictEqual(copies.agents.chars, descriptionChars('agent', 'security-auditor') + descriptionChars('agent', 'evidence-gatherer'));
    assert.strictEqual(copies.chars, copies.skills.chars + copies.agents.chars);
});

test('floor: a deny row hides nothing the core carries - it carries no seat', () =>
{
    const stale = floor({ plugins: FLOOR_ENTRIES, deny: ['Agent(alfred-code:security-auditor)'] });
    assert.deepStrictEqual(stale.agents.denied, []);
    assert.strictEqual(stale.agents.chars, floor({ plugins: FLOOR_ENTRIES }).agents.chars);
});

test('floor: a name that is no stack entry counts nothing', () =>
{
    const got = floor({ plugins: ['claude-hud', 'navigation', 'nope'] });
    assert.deepStrictEqual([got.entries, got.chars], [[], 0]);
});

test('floor: the CLI reads the entries and the project settings file', () =>
{
    const settingsFile = path.join(TMP, 'floor-settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ permissions: { deny: ['Agent(alfred-code:security-auditor)'] } }));
    const { execFileSync } = require('node:child_process');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--floor', '--plugins', FLOOR_ENTRIES.join(','), '--settings', settingsFile], { encoding: 'utf8' }));
    assert.deepStrictEqual(out, floor({ plugins: FLOOR_ENTRIES, deny: ['Agent(alfred-code:security-auditor)'] }));
    const bad = path.join(TMP, 'floor-bad.json');
    fs.writeFileSync(bad, '{ nope');
    const noDeny = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--floor', '--plugins', FLOOR_ENTRIES.join(','), '--settings', bad], { encoding: 'utf8' }));
    assert.deepStrictEqual(noDeny.agents.denied, [], 'an unreadable settings file denies nothing');
});

// T2 review: setup reports the derivation BEFORE the install, so the derivation must decide what the
// installer decides - route switches and the no-hook-lines rule included - or the report lies.
test('derive-state: a selection with NO hook lines switches no hook off - every hook runs, as on disk', () =>
{
    const got = derive(selectionFile(['rule alfred-security', 'skill markdown-style']));
    assert.deepStrictEqual(got.hooks.off, []);
    assert.strictEqual(got.env.ALFRED_CODE_HOOKS_OFF, '');
});

test('derive-state: `hook none` - the walk\'s None at the hooks layer - switches every shipped hook off', () =>
{
    const got = derive(selectionFile(['rule alfred-security', 'hook none']));
    assert.strictEqual(got.hooks.answered, true);
    const locked = require('./install/selection.js').LOCKED_HOOKS;
    assert.deepStrictEqual([...got.hooks.on].sort(), [...locked].sort(), 'only the locked hooks stay on (stage 4c)');
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    assert.deepStrictEqual(got.hooks.off, shipped.filter((h) => !locked.includes(h)));
});

test('derive-state CLI: the routes read a ledgered local skills route back, so configure agrees with the installer', () =>
{
    const { execFileSync } = require('node:child_process');
    const { valueHash } = require('./install/stamp.js');
    const { BRAND } = require('./install/brand.js');
    const KEY = 'ALFRED_CODE_SKILLS_VIA_PLUGIN';
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'derive-routes-'));
    try
    {
        fs.mkdirSync(path.join(root, '.claude'));
        fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { [KEY]: 'false' } }));
        const sel = selectionFile(fs.readFileSync(realSelection(), 'utf8').split('\n'));
        const routesOf = () => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', sel, '--root', root],
            { encoding: 'utf8', env: { ...process.env, [KEY]: '', ALFRED_CODE_HOOKS_VIA_PLUGIN: '' } })).routes;
        assert.deepStrictEqual(routesOf(), { hooks: true, skills: true }, 'an unledgered local value is not the stack\'s');
        fs.writeFileSync(path.join(root, '.claude', BRAND.stamp), `managed-env: settings.local.json:${KEY}=${valueHash('false')}\n`);
        assert.deepStrictEqual(routesOf(), { hooks: true, skills: false }, 'a ledgered one holds from a plain shell');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('derive-state CLI: `written` is what THIS route writes - the full copy route writes no off-state', () =>
{
    const { execFileSync } = require('node:child_process');
    const sel = selectionFile(fs.readFileSync(realSelection(), 'utf8').split('\n').filter((l) => l.trim() !== 'agent security-auditor' && l.trim() !== 'hook communication-reminder'));
    const run = (env) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', sel], { encoding: 'utf8', env: { ...process.env, ...env } }));
    const plugin = run({ ALFRED_CODE_SKILLS_VIA_PLUGIN: '', ALFRED_CODE_HOOKS_VIA_PLUGIN: '' });
    assert.deepStrictEqual(plugin.routes, { hooks: true, skills: true });
    assert.deepStrictEqual([plugin.written.agentDeny, plugin.written.agentAllow], [[], []], 'no seat has a row to write: a seat is a copy');
    assert.deepStrictEqual(plugin.written.hooksOff, ['communication-reminder']);
    // The skills route alone keeps the core on, and the core carries every hook (2.0.0): the unpicked hook is still named off.
    const copy = run({ ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' });
    assert.deepStrictEqual([copy.written.agentDeny, copy.written.hooksOff], [[], ['communication-reminder']]);
    // A leftover ALFRED_CODE_MCPS_VIA_PLUGIN names no route since 2.10.1: both copy switches make the full copy route.
    const full = run({ ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'true' });
    assert.deepStrictEqual([full.written.agentDeny, full.written.hooksOff], [[], []]);
});

test('init\'s install phase reports only keys the derivation prints', () =>
{
    // A renamed key would leave the walk quoting a field that no longer exists.
    const init = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'init-install.md'), 'utf8');
    const step = init.slice(init.indexOf('## 10. Install'));
    const cited = [...step.slice(0, step.indexOf('Then run the installer')).matchAll(/`((?:routes|written|plugins|skills|agents|hooks)(?:\.[A-Za-z]+)*)`/g)].map((m) => m[1]);
    assert.ok(cited.length >= 4, `the install phase names the fields it reports, found ${cited.join(',')}`);
    const { execFileSync } = require('node:child_process');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', realSelection()], { encoding: 'utf8' }));
    for (const key of cited)
        assert.notStrictEqual(key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), out), undefined, `the install phase cites ${key}, which the derivation does not print`);
});

test('floor: entries it does not count come back as `skipped`, never silently dropped', () =>
{
    const got = floor({ plugins: ['alfred-code', 'claude-hud', 'alfred-navigation@envoydev'] });
    assert.deepStrictEqual(got.entries, ['alfred-code']);
    assert.deepStrictEqual(got.skipped, ['alfred-navigation', 'claude-hud']);
});

test('floor: skill chars are the model-invocable descriptions, measured independently', () =>
{
    const carried = itemsOf(FLOOR_ENTRIES, { placement: placement() });
    const fm = (s) => fs.readFileSync(path.join(ROOT, 'stack/skills', s, 'SKILL.md'), 'utf8').split(/^---$/m)[1] || '';
    const live = carried.skills.filter((s) => !/^disable-model-invocation:\s*true\s*$/m.test(fm(s)));
    const want = live.reduce((n, s) => n + ((/^description:\s*(.*)$/m.exec(fm(s)) || [, ''])[1]).length, 0);
    assert.strictEqual(floor({ plugins: FLOOR_ENTRIES }).skills.chars, want);
});

test('floor: manual-only is read from the FRONTMATTER - a body line saying so does not count', () =>
{
    const { manualOnlyText } = require('./derive-state.js');
    assert.strictEqual(manualOnlyText('---\nname: a\ndisable-model-invocation: true\n---\nbody'), true);
    assert.strictEqual(manualOnlyText('---\nname: a\n---\n```yaml\ndisable-model-invocation: true\n```'), false);
});

test('floor CLI: every --settings file given counts - deny rules merge across scopes', () =>
{
    const { execFileSync } = require('node:child_process');
    const a = path.join(TMP, 'floor-a.json'); const b = path.join(TMP, 'floor-b.json');
    fs.writeFileSync(a, JSON.stringify({ skillOverrides: { csharp: 'off' } }));
    fs.writeFileSync(b, JSON.stringify({ skillOverrides: { 'markdown-style': 'off' }, permissions: { deny: ['Read(.env)'] } }));
    const dir = fs.mkdtempSync(path.join(TMP, 'floor-cli-'));
    for (const s of ['csharp', 'markdown-style', 'habits-done-gate']) fs.cpSync(path.join(ROOT, 'stack', 'skills', s), path.join(dir, 'skills', s), { recursive: true });
    const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--floor', '--plugins', 'alfred-code', '--skills-dir', path.join(dir, 'skills'), '--settings', a, '--settings', b, '--settings', path.join(TMP, 'absent.json')], { encoding: 'utf8' }));
    assert.strictEqual(out.skills.count, 1, 'both settings files hide a copy: only the third counts');
});

// T3 - update as a two-way reconcile. What LEFT upstream is the RETIRED lists; what is NEW is read
// here, against THIS install: an item riding an entry the project already enables ARRIVES with the
// refresh, anything else is an OFFER the user takes or leaves, and the user's own off-state wins.
const { stampCarried, classifyNew } = require('./derive-state.js');

test('stampCarried: a seat an entry still enabled here carried comes back as a pick - seats are library copies now', () =>
{
    const stamp = { skills: ['task-solve-cross@alfred-code-old'], agents: ['security-auditor@alfred-code-old'] };
    assert.deepStrictEqual(stampCarried({ stamp, enabled: ['alfred-code-old'], routes: ALL_ROUTES }), ['agent security-auditor']);
});

// 2.1.0 moved every core skill into the project: a 2.0.x stamp homes each `@alfred-code`, and the core is
// still enabled - a pick the release moved, carried as one.
test('stampCarried (2.1.0): a skill the core carried, library now, is carried as a pick', () =>
{
    const stamp = { skills: ['task-solve-cross@alfred-code', 'csharp'], agents: ['security-auditor@alfred-code', 'aspnet-implementer'] };
    assert.deepStrictEqual(stampCarried({ stamp, enabled: ['alfred-code'], routes: ALL_ROUTES }), ['skill task-solve-cross']);
    assert.deepStrictEqual(stampCarried({ stamp, enabled: [], routes: ALL_ROUTES }), [], 'no core enabled - nothing to carry it across');
});

test('stampCarried: no move, an uninstalled or parked old home, a parked core, a denied seat, a library item - nothing', () =>
{
    const moved = { skills: ['task-solve-cross@alfred-code-old'], agents: ['security-auditor@alfred-code-old'] };
    assert.deepStrictEqual(stampCarried({ stamp: { agents: ['security-auditor@alfred-code'] }, enabled: ['alfred-code'], routes: ALL_ROUTES }), [], 'the same home - readInstalled already has it');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: [], routes: ALL_ROUTES }), [], 'the user uninstalled the old home');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: [], parked: ['alfred-code-old'], routes: ALL_ROUTES }), [], 'the user parked the old home');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['alfred-code-old'], parked: ['alfred-code'], routes: ALL_ROUTES }), ['agent security-auditor'], 'a parked core holds no seat now: the pick is carried, the skill (homed in the core) is not');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['alfred-code-old'], deny: ['Agent(alfred-code-x:security-auditor)'], routes: ALL_ROUTES }), [], 'a seat denied under any spelling');
    assert.deepStrictEqual(stampCarried({ stamp: { skills: ['angular-material', 'task-solve-cross'] }, enabled: ['alfred-code-old'], routes: ALL_ROUTES }), [], 'a library copy, and a plain name with no stamped home');
    assert.deepStrictEqual(stampCarried({ stamp: { skills: ['dotnet-web-backend@alfred-code-old'] }, enabled: ['alfred-code-old'], routes: ALL_ROUTES }), [], 'a library item has no home to move into');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['alfred-code-old'], routes: { skills: false } }), []);
});

// R78: a stamp is a file on disk a hand or a bad merge can change, and a carried name becomes a
// selection line the library layer joins into a path. The shared validator (stamp.js validItemName)
// gates it, the same check every other stamp reader runs: a name that fails it is never carried.
test('stampCarried: a stamped name that is no item name - traversal, a separator, a space - is never carried (R78)', () =>
{
    const home = 'alfred-code'; // the core: a library skill homed there is carried as a pick (2.1.0)
    const bad = ['../../etc', 'a/b', '..', 'x y', 'Upper', ''];
    const stamp = { skills: [...bad.map((n) => `${n}@${home}`), `dotnet-web-backend@${home}`], agents: bad.map((n) => `${n}@${home}`) };
    assert.deepStrictEqual(stampCarried({ stamp, enabled: [home], routes: ALL_ROUTES }), ['skill dotnet-web-backend']);
});

test('readInstalled: every hook switched off reads back as `hook none`, not as unanswered', () =>
{
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: shipped.join(','), routes: { hooks: true }, sourceDir: ROOT });
    assert.deepStrictEqual(lines, ['hook none'], 'the locked hooks are no pick (stage 4c), so every other hook off is the None');
});

// The always closure arrives on its own (2.1.0): the always skills and seats, and what the always rules
// require - `markdown-docs` pulling `markdown-style` here.
const ALWAYS_BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8')).always;
test('classifyNew: an always-closure item arrives, a stack item is offered, the user\'s off-state wins', () =>
{
    const added = [
        { category: 'skill', name: 'markdown-style' }, { category: 'skill', name: 'dotnet-web-backend' },
        { category: 'agent', name: 'evidence-gatherer' }, { category: 'agent', name: 'code-style-analyzer' },
        { category: 'rule', name: 'alfred-security' }, { category: 'rule', name: 'sql-conventions' },
        { category: 'hook', name: 'docs-session' }, { category: 'hook', name: 'communication-reminder' },
        { category: 'skill', name: 'angular-material' }, { category: 'rule', name: 'markdown-docs' },
    ];
    const rows = classifyNew({
        added, plugins: ['alfred-code'], deny: ['Agent(alfred-code:code-style-analyzer)'],
        hooksOff: 'communication-reminder', routes: ALL_ROUTES, always: ALWAYS_BASE, sourceDir: ROOT,
    });
    const by = Object.fromEntries(rows.map((r) => [`${r.category} ${r.name}`, r]));
    assert.strictEqual(by['skill markdown-style'].verdict, 'arrives');
    assert.deepStrictEqual([by['skill dotnet-web-backend'].verdict, by['skill dotnet-web-backend'].entry, by['skill dotnet-web-backend'].recommend], ['offer', null, 'leave'], 'library - copied only on a yes');
    assert.strictEqual(by['agent evidence-gatherer'].verdict, 'offer', 'a seat is a copy: nothing carries it in');
    assert.strictEqual(by['agent code-style-analyzer'].verdict, 'off');
    assert.strictEqual(by['rule alfred-security'].verdict, 'arrives', 'the locked baseline is adopted');
    assert.deepStrictEqual([by['rule sql-conventions'].verdict, by['rule sql-conventions'].recommend], ['offer', 'leave'], 'its closure copies library items - no free take');
    assert.ok(by['rule sql-conventions'].copies.length > 0, 'and it names them');
    assert.deepStrictEqual(by['rule sql-conventions'].enables, [], 'the core is enabled, so a yes switches no entry on');
    assert.deepStrictEqual([by['hook docs-session'].verdict, by['hook docs-session'].entry], ['arrives', 'alfred-code'], 'the hooks ride the core');
    assert.strictEqual(by['hook communication-reminder'].verdict, 'off');
    assert.deepStrictEqual([by['skill angular-material'].verdict, by['skill angular-material'].entry], ['offer', null], 'a library item is copied only on a yes');
    assert.strictEqual(by['rule markdown-docs'].verdict, 'arrives', 'an always rule is adopted - and markdown-style with it, as its closure');
});

test('classifyNew: a library item the project already copied costs nothing, so the rule that pulls it is the free take', () =>
{
    const bare = classifyNew({ added: [{ category: 'rule', name: 'sql-conventions' }], plugins: ['alfred-code'], routes: ALL_ROUTES, sourceDir: ROOT })[0];
    const copied = { skills: bare.copies.filter((c) => c.startsWith('skill ')).map((c) => c.slice(6)), agents: bare.copies.filter((c) => c.startsWith('agent ')).map((c) => c.slice(6)) };
    const row = classifyNew({ added: [{ category: 'rule', name: 'sql-conventions' }], plugins: ['alfred-code'], routes: ALL_ROUTES, copied, sourceDir: ROOT })[0];
    assert.deepStrictEqual([row.copies, row.recommend], [[], 'take']);
});

test('classifyNew: on the copy routes a skill or seat is copied only on a yes, and a hook arrives only into an install that has hooks', () =>
{
    const added = [{ category: 'skill', name: 'markdown-style' }, { category: 'agent', name: 'evidence-gatherer' }, { category: 'hook', name: 'docs-session' }];
    const withHooks = classifyNew({ added, plugins: ['alfred-code'], routes: {}, hasHooks: true, sourceDir: ROOT });
    // An always-closure skill is copied on every route (2.1.0); a seat is copied only on a yes here.
    assert.deepStrictEqual(withHooks.map((r) => r.verdict), ['arrives', 'offer', 'arrives']);
    const noHooks = classifyNew({ added, plugins: [], routes: {}, hasHooks: false, sourceDir: ROOT });
    assert.strictEqual(noHooks[2].verdict, 'offer');
});

test('classifyNew: a name this release does not carry is no new item', () =>
{
    assert.deepStrictEqual(classifyNew({ added: [{ category: 'skill', name: 'no-such-skill' }, { category: 'hook', name: 'hook-prelude' }], routes: ALL_ROUTES, sourceDir: ROOT }), []);
});

test('classifyNew: a hook on the plugin route arrives even with the core absent from the listing - the installer enables it regardless', () =>
{
    const rows = classifyNew({ added: [{ category: 'hook', name: 'docs-session' }], plugins: ['alfred-code'], routes: ALL_ROUTES, sourceDir: ROOT });
    assert.strictEqual(rows[0].verdict, 'arrives');
    const unread = classifyNew({ added: [{ category: 'hook', name: 'docs-session' }], plugins: null, routes: ALL_ROUTES, sourceDir: ROOT });
    assert.strictEqual(unread[0].verdict, 'arrives', 'HOOKS_OFF is in settings - no listing needed');
});

test('classifyNew: the walk\'s None held - a hook a release adds after every hook was switched off stays off', () =>
{
    const rows = classifyNew({ added: [{ category: 'hook', name: 'docs-session' }], plugins: ['alfred-code'], noneBefore: true, routes: ALL_ROUTES, sourceDir: ROOT });
    assert.strictEqual(rows[0].verdict, 'off');
});

test('classifyNew: a rename is carried when its old copy is on disk, and an old name switched off is flagged', () =>
{
    const rows = classifyNew({
        added: [
            { category: 'rule', name: 'sql-conventions', from: 'old-sql', oldOnDisk: true },
            { category: 'rule', name: 'typescript-conventions', from: 'old-ts', oldOnDisk: false },
            { category: 'agent', name: 'evidence-gatherer', from: 'old-gatherer' },
            { category: 'hook', name: 'docs-session', from: 'old-docs' },
        ],
        plugins: ['alfred-code'], deny: ['Agent(alfred-code:old-gatherer)'], hooksOff: 'old-docs', routes: ALL_ROUTES, always: ALWAYS_BASE, sourceDir: ROOT,
    });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.deepStrictEqual([by['sql-conventions'].verdict, by['sql-conventions'].from], ['renamed', 'old-sql']);
    assert.strictEqual(by['typescript-conventions'].verdict, 'offer', 'never installed here - a plain offer');
    assert.deepStrictEqual([by['evidence-gatherer'].verdict, by['evidence-gatherer'].wasOff], ['off', true], 'a deny row left on the old name keeps the new one off; the report says the old one was off');
    assert.deepStrictEqual([by['docs-session'].verdict, by['docs-session'].wasOff], ['arrives', true]);
});

// T4: the walk's closed selection against the read-back inventory, as the --add / --drop the
// installer takes - so configure and validate apply through --installed-only, never --selection.
const { delta } = require('./derive-state.js');

test('delta: what the walk added and dropped against the inventory, one line each', () =>
{
    const installed = { skills: ['csharp', 'dotnet'], agents: ['evidence-gatherer'], rules: ['alfred-security'], hooks: ['docs-session', 'guard-read-whole-file'], mcps: ['alfred-navigation'], plugins: [{ name: 'claude-hud', scope: 'user' }] };
    const selectionText = ['skill csharp', 'skill markdown-style', 'agent evidence-gatherer', 'rule alfred-security', 'rule sql-conventions', 'hook docs-session', 'mcp alfred-navigation', 'plugin claude-hud'].join('\n');
    assert.deepStrictEqual(delta({ installed, selectionText }), {
        add: ['skill markdown-style', 'rule sql-conventions'],
        drop: ['skill dotnet', 'hook guard-read-whole-file'],
        keptOff: [], keepParked: [],
    });
});

test('delta: a selection naming no hook at all drops every installed hook - the walk answered None', () =>
{
    const got = delta({ installed: { hooks: ['docs-session'], rules: ['alfred-security'] }, selectionText: 'rule alfred-security\nhook none\n' });
    assert.deepStrictEqual(got.drop, ['hook docs-session']);
    assert.deepStrictEqual(got.add, [], '`hook none` is no item to add');
});

test('delta: a selection with no hook line at all keeps every hook - that layer was never answered', () =>
{
    const got = delta({ installed: { hooks: ['docs-session'], rules: ['a'] }, selectionText: 'rule a\n' });
    assert.deepStrictEqual(got, { add: [], drop: [], keptOff: [], keepParked: [] });
});

test('delta CLI: prints add/drop lines, or none', () =>
{
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'delta-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'inv.json'), JSON.stringify({ skills: ['csharp'], rules: ['a'] }));
        fs.writeFileSync(path.join(dir, 'sel.txt'), 'skill markdown-style\nrule a\n');
        const run = () => spawnSync(process.execPath, [path.join(__dirname, 'derive-state.js'), '--delta', '--installed', path.join(dir, 'inv.json'), '--selection', path.join(dir, 'sel.txt')], { encoding: 'utf8' });
        assert.strictEqual(run().stdout, 'add skill markdown-style\ndrop skill csharp\n');
        fs.writeFileSync(path.join(dir, 'sel.txt'), 'skill csharp\nrule a\n');
        assert.strictEqual(run().stdout, 'none\n');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// T4 review: the walk's closure knows nothing about the off-state, so a seat the user denied, an
// item of a parked entry or a parked catalog plugin that the closure merely re-requires must not
// turn into an --add - only the walk's own pick turns it back on.
test('delta: a switched-off item the closure re-requires is kept off unless the walk picked it', () =>
{
    const installed = { agents: ['evidence-gatherer'], plugins: [], left_out: ['agent dotnet-build-error-resolver'], parked_plugins: ['claude-hud'] };
    const selectionText = 'agent evidence-gatherer\nagent dotnet-build-error-resolver\nplugin claude-hud\n';
    assert.deepStrictEqual(delta({ installed, selectionText }), {
        add: [], drop: [], keptOff: ['agent dotnet-build-error-resolver', 'plugin claude-hud'], keepParked: ['plugin claude-hud'],
    });
    const picked = { agents: ['evidence-gatherer', 'dotnet-build-error-resolver'], plugins: [{ name: 'claude-hud', scope: 'user' }] };
    assert.deepStrictEqual(delta({ installed, selectionText, picked }), {
        add: ['agent dotnet-build-error-resolver', 'plugin claude-hud'], drop: [], keptOff: [], keepParked: [],
    });
});

test('delta CLI: kept-off and keep-parked lines follow the verdict, which stays none', () =>
{
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'delta-'));
    try
    {
        fs.writeFileSync(path.join(dir, 'inv.json'), JSON.stringify({ agents: ['a'], left_out: ['agent b'], parked_plugins: ['claude-hud'] }));
        fs.writeFileSync(path.join(dir, 'sel.txt'), 'agent a\nagent b\n');
        const r = spawnSync(process.execPath, [path.join(__dirname, 'derive-state.js'), '--delta', '--installed', path.join(dir, 'inv.json'), '--selection', path.join(dir, 'sel.txt')], { encoding: 'utf8' });
        assert.strictEqual(r.stdout, 'none\nkept-off agent b\nkeep-parked plugin claude-hud\n');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Task 3 (library route): a library seat is copied, and picking it writes the core allow that clears a
// deny an earlier run wrote.
test('a picked library seat is a copy and writes no row', () =>
{
    const state = fromText(['agent angular-test-resolver', 'agent evidence-gatherer']);
    assert.ok(state.agents.on.includes('angular-test-resolver'));
    assert.deepStrictEqual(state.agents.library, ['angular-test-resolver', 'evidence-gatherer']);
    assert.deepStrictEqual([state.agents.allow, state.agents.deny], [[], []], 'the installer clears a deny row an older install left, whatever this lists');
});

// A skill a server brought (the graph's `mcps` block) arrived with that server and was no pick of its own. The stack
// ships no server since 2.10.1, so the block is empty and desktop-automation - for a desktop server the user registered -
// is offered like any other skill.
test('classifyNew: no server brings a skill since 2.10.1 - desktop-automation is offered like any other', () =>
{
    const rows = classifyNew({ added: [{ category: 'skill', name: 'desktop-automation' }, { category: 'skill', name: 'angular-material' }], plugins: ['alfred-code'], routes: ALL_ROUTES, sourceDir: ROOT });
    assert.deepStrictEqual(rows.map((r) => r.name), ['desktop-automation', 'angular-material']);
});

// ---------------------------------------------------------------------------------------------
// 2.1.0: every skill is a project copy, every seat rides the core, and a seat the selection did not
// pick is denied. A 2.0.x install was written under the OTHER placement - its core carried the always
// closure and every stack seat was a library copy - so its read-back must go by what ITS core carried.
const { formerCore } = require('./plugin-placement.js');
const ALWAYS = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8')).always;

test('deriveState: every picked skill and every picked seat is a copy, and nothing is denied', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    assert.deepStrictEqual(got.skills.carried, [], 'no plugin carries a skill');
    assert.deepStrictEqual(got.skills.library, [...picked.skills].sort(), 'every picked skill is copied');
    assert.ok(!Object.hasOwn(got.skills, 'undroppable'), 'nothing is carried unpicked, so nothing is reported undroppable');
    assert.deepStrictEqual([got.agents.off, got.agents.deny], [[], []], 'an unpicked seat has no copy: no row');
    assert.deepStrictEqual(got.agents.library, [...picked.agents].sort(), 'every picked seat is copied');
});

test('readInstalled (2.1.0 BLOCKER): a 2.0.x install reads its core as the always closure, never as all 44 seats', () =>
{
    const former = formerCore();
    const lines = readInstalled({ plugins: ['alfred-code', 'navigation'], deny: ['Agent(alfred-code:code-style-analyzer)'], routes: { skills: true }, core: 'former', sourceDir: ROOT });
    for (const s of former.skills) assert.ok(lines.includes(`skill ${s}`), `the always skill ${s} the 2.0.x core carried is read back`);
    for (const a of former.agents.filter((x) => x !== 'code-style-analyzer')) assert.ok(lines.includes(`agent ${a}`), `the 2.0.x core seat ${a}`);
    assert.ok(!lines.includes('agent code-style-analyzer'), 'a denied seat stays off');
    assert.ok(!lines.includes('agent aspnet-implementer'), 'a stack seat was a library copy - its disk copy says whether it was picked');
    assert.strictEqual(lines.filter((l) => l.startsWith('agent ')).length, former.agents.length - 1);
});

test('readInstalled (2.1.0): the seats the core carries are read back only as the last install knew them', () =>
{
    const lines = readInstalled({
        plugins: ['alfred-code'], deny: ['Agent(alfred-code:aspnet-verifier)'], routes: { skills: true }, core: 'current', sourceDir: ROOT,
        picks: new Set(['agent aspnet-implementer', 'agent security-auditor', 'agent aspnet-verifier']), managedSeats: ['aspnet-verifier', 'web-angular-implementer'],
    });
    assert.ok(lines.includes('agent aspnet-implementer') && lines.includes('agent security-auditor'), 'picked and not denied');
    assert.ok(!lines.includes('agent aspnet-verifier'), 'picked once, denied since - off');
    assert.ok(lines.includes('agent web-angular-implementer'), 'the stack denied it and the deny is gone - the user allowed it by hand');
    assert.ok(!lines.includes('agent dotnet-console-implementer'), 'neither picked nor denied by the last install - a seat this release added, offered, never on by itself');
    assert.ok(!lines.some((l) => l.startsWith('skill ')), 'the core carries no skill');
    const ungated = readInstalled({ plugins: ['alfred-code'], deny: [], routes: { skills: true }, core: 'current', sourceDir: ROOT });
    assert.strictEqual(ungated.filter((l) => l.startsWith('agent ')).length, 45, 'with no picks to go by, every seat the core carries and nothing denies');
});

test('readInstalled (2.1.0): a last run that copied the seats reads no item off the core', () =>
{
    const lines = readInstalled({ plugins: ['alfred-code'], routes: { skills: true, hooks: true }, core: 'none', sourceDir: ROOT });
    assert.ok(!lines.some((l) => /^(skill|agent) /.test(l)), lines.join(','));
    assert.ok(lines.includes('hook docs-session'), 'the hooks still ride the core');
});

test('classifyNew (2.1.0): an always skill arrives, every seat is offered, a seat with a deny row left stays off', () =>
{
    const added = [
        { category: 'skill', name: 'habits-done-gate' }, { category: 'skill', name: 'dotnet-web-backend' },
        { category: 'agent', name: 'aspnet-implementer' }, { category: 'agent', name: 'evidence-gatherer' }, { category: 'agent', name: 'code-style-analyzer' },
    ];
    const rows = classifyNew({ added, plugins: ['alfred-code'], deny: ['Agent(alfred-code:code-style-analyzer)'], routes: ALL_ROUTES, always: ALWAYS, sourceDir: ROOT });
    const by = Object.fromEntries(rows.map((r) => [`${r.category} ${r.name}`, r]));
    assert.deepStrictEqual([by['skill habits-done-gate'].verdict, by['skill habits-done-gate'].entry], ['arrives', null], 'a locked skill is copied into every install');
    assert.deepStrictEqual([by['skill dotnet-web-backend'].verdict, by['skill dotnet-web-backend'].entry], ['offer', null]);
    assert.deepStrictEqual([by['agent aspnet-implementer'].verdict, by['agent aspnet-implementer'].entry, by['agent aspnet-implementer'].recommend], ['offer', null, 'leave'],
        'no entry carries a seat: taking it copies it, and its skills');
    assert.ok(by['agent aspnet-implementer'].copies.includes('skill csharp'), 'the preloads a yes copies are named');
    assert.deepStrictEqual([by['agent evidence-gatherer'].verdict, by['agent evidence-gatherer'].entry], ['offer', null], 'an always seat is offered too: an update adopts no seat');
    assert.strictEqual(by['agent code-style-analyzer'].verdict, 'off', 'a deny row an older install left still names it: it stays off');
});

test('writable (2.1.0): the seat off-state is written whenever the core loads the seats - the skills copy route with the core on included', () =>
{
    const { writable } = require('./derive-state.js');
    const state = narrowed({ dropAgent: 'security-auditor', dropHook: 'communication-reminder' });
    const both = { hooks: true, agents: true };
    assert.deepStrictEqual(writable(state, { routes: ALL_ROUTES, answered: both }).agentDeny, state.agents.deny);
    const mixed = writable(state, { routes: { skills: false, hooks: true, mcps: true }, answered: both });
    const everySeat = require('./plugin-placement.js').placement().plugins['alfred-code'].agents.map((a) => `Agent(alfred-code:${a})`);
    assert.deepStrictEqual([mixed.agentDeny, mixed.agentAllow], [everySeat, []], 'the core lists every seat on this route too - every one is denied, so a copied seat lists once');
    assert.deepStrictEqual(writable(state, { routes: {}, answered: both }).agentDeny, [], 'no core on the full copy route - absence is off');
    assert.ok(!Object.hasOwn(mixed, 'undroppable'));
});

test('floor (2.1.0): the project\'s skill copies count - a manual-only, overridden or foreign one does not', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'floor-skills-'));
    for (const s of ['habits-done-gate', 'task-solve', 'csharp', 'markdown-style'])
        fs.cpSync(path.join(ROOT, 'stack', 'skills', s), path.join(dir, s), { recursive: true });
    fs.mkdirSync(path.join(dir, 'my-own-skill'));
    fs.writeFileSync(path.join(dir, 'my-own-skill', 'SKILL.md'), '---\nname: my-own-skill\ndescription: mine\n---\n');
    const got = floor({ plugins: ['alfred-code'], skillsDir: dir, overrides: { csharp: 'off', 'markdown-style': 'name-only' } });
    assert.deepStrictEqual([got.skills.count, got.skills.chars], [1, descriptionChars('skill', 'habits-done-gate')], 'task-solve is manual-only');
    assert.strictEqual(got.agents.count, 0, 'the core carries no seat');
    const settingsFile = path.join(TMP, 'floor-overrides.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ skillOverrides: { csharp: 'off', 'markdown-style': 'name-only' }, permissions: { deny: ['Read(.env)'] } }));
    const { execFileSync } = require('node:child_process');
    const cli = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--floor', '--plugins', 'alfred-code', '--skills-dir', dir, '--settings', settingsFile], { encoding: 'utf8' }));
    assert.deepStrictEqual([cli.skills.count, cli.agents.count, cli.agents.denied], [1, 0, []]);
});

// F18 (the 2026-10-28 workspace run): a child's preview derived from its own selection only, so the seats and hooks the
// root hands it read as denied and off - the walk reported 'agents: 0 on' for a child that inherits a dozen.
const { inheritedSelection } = require('./derive-state.js');
const HOOKS5 = ['guard-protected-force-push', 'guard-catastrophic-rm', 'guard-read-whole-file', 'guard-secret-value', 'guard-unapproved-dispatch'];
const SEATS3 = ['architecture-analyzer', 'code-quality-analyzer', 'evidence-gatherer'];
const PARENT_PLAN = { hooks: HOOKS5, agents: SEATS3, skills: [], rules: [] };

test('F18: inheritedSelection adds the parent lines a child lacks, an ignore left out, and drops hook none', () =>
{
    const lines = inheritedSelection('hook none\nskill a', PARENT_PLAN, []).split('\n');
    for (const h of HOOKS5) assert.ok(lines.includes(`hook ${h}`), h);
    for (const s of SEATS3) assert.ok(lines.includes(`agent ${s}`), s);
    assert.ok(lines.includes('skill a'));
    assert.ok(!lines.includes('hook none'));
    const ignored = inheritedSelection('hook none\nskill a', PARENT_PLAN, [{ category: 'hook', name: HOOKS5[0] }]).split('\n');
    assert.ok(!ignored.includes(`hook ${HOOKS5[0]}`));
    assert.ok(ignored.includes(`hook ${HOOKS5[1]}`));
    const noHooks = inheritedSelection('hook none\nskill a', { agents: SEATS3 }, []).split('\n');
    assert.ok(noHooks.includes('hook none'), 'hook none stays when no hook line is added');
});

test('F18: a child preview shows the inherited seats on and the inherited hooks on', () =>
{
    const state = fromText(inheritedSelection('hook none\nskill javascript', PARENT_PLAN, []).split('\n'));
    for (const s of SEATS3) assert.ok(state.agents.on.includes(s), s);
    for (const s of SEATS3) assert.ok(!state.agents.deny.includes(`Agent(alfred-code:${s})`), s);
    for (const h of HOOKS5) assert.ok(state.hooks.on.includes(h), h);
});

test('F18: a missing or garbage --inherited is one error line and exit 1', () =>
{
    const { spawnSync } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'inherited-'));
    try
    {
        const sel = path.join(dir, 'sel.txt');
        fs.writeFileSync(sel, 'hook none\nskill javascript\n');
        const bad = path.join(dir, 'bad.json');
        fs.writeFileSync(bad, '{ not json');
        const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'derive-state.js'), '--selection', sel, '--source', ROOT, ...a], { encoding: 'utf8' });
        for (const [file, why] of [[path.join(dir, 'none.json'), 'not found'], [bad, 'does not parse']])
        {
            const r = cli('--inherited', file);
            assert.strictEqual(r.status, 1, r.stdout);
            assert.deepStrictEqual(r.stderr.trim().split('\n'), [`derive-state: --inherited ${file} - ${why}`]);
        }
        const plan = path.join(dir, 'parent.json');
        fs.writeFileSync(plan, JSON.stringify(PARENT_PLAN));
        const ign = path.join(dir, 'ignores.txt');
        fs.writeFileSync(ign, `hook ${HOOKS5[0]}\n`);
        const ok = cli('--inherited', plan, '--ignores', ign);
        assert.strictEqual(ok.status, 0, ok.stderr);
        const state = JSON.parse(ok.stdout);
        assert.ok(state.hooks.on.includes(HOOKS5[1]) && !state.hooks.on.includes(HOOKS5[0]), JSON.stringify(state.hooks.on));
        assert.strictEqual(cli('--inherited', plan, '--ignores', path.join(dir, 'gone.txt')).status, 0, 'a missing ignores file is none');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Workspace stage 4c, Task 4: the rule loader is locked on, so the off-list naming it makes no off row and no gap in the floor.
test('derive-state: rules-session named in the off-list is not an off row', () =>
{
    const row = (name) => classifyNew({ added: [{ category: 'hook', name }], plugins: ['alfred-code'], hooksOff: 'rules-session,communication-reminder', routes: ALL_ROUTES, sourceDir: ROOT })[0];
    assert.strictEqual(row('rules-session').verdict, 'arrives', 'the loader is no off row');
    assert.strictEqual(row('communication-reminder').verdict, 'off', 'every other hook still follows the list');
});
