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
//   - an agent is denied only when an ENABLED plugin actually carries it. A seat sitting in a
//     plugin this project never enabled is not loaded at all, so denying it is noise in every
//     session's settings file, and it ages badly: the day that plugin IS enabled, the stale deny
//     silently drops a seat the user just asked for.
//   - a hook is off when the release SHIPS it and this selection did not pick it, whole catalog,
//     because the core carries every one whatever the project picked.
//   - a skill cannot be switched off at all (spike S2: skillOverrides moved 0 tokens on a plugin
//     skill), so a skill the closure carries and the selection did not pick is REPORTED, never
//     silently counted as dropped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

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

test('derive-state: an agent is denied only when an ENABLED plugin carries it', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    const carried = new Set(itemsOf(got.plugins.map((p) => p.split('@')[0])).agents);

    for (const name of got.agents.off)
    {
        assert.ok(carried.has(name), `${name} is denied but no enabled plugin carries it`);
        assert.ok(!picked.agents.has(name), `${name} is denied and picked`);
    }
    for (const name of carried)
        if (!picked.agents.has(name)) assert.ok(got.agents.off.includes(name), `${name} rides an enabled plugin, was not picked, and is not denied`);
    // ... and `on` is what the project actually gets: picked, and carried or copied.
    assert.deepStrictEqual(got.agents.on, [...picked.agents].sort());
});

test('derive-state: the deny spelling is the SCOPED identifier the spike measured', () =>
{
    // S3 measured the SCOPED spelling: `permissions.deny: ["Agent(spike:seat-bare)"]` dropped the
    // seat from the listing and its 1,500-char description from the bill, -434 tokens. The bare
    // form is what the docs give for a project-local subagent ('Agent (subagents)',
    // code.claude.com/docs/en/permissions); for a PLUGIN seat the scoped identifier is the address
    // S1 and S3 both used, and it is the only one this stack has measured.
    assert.strictEqual(denySpec('aspnet-verifier', 'claude-stack-aspnet'), 'Agent(claude-stack-aspnet:aspnet-verifier)');
    const got = derive(realSelection());
    for (const spec of got.agents.deny)
        assert.match(spec, /^Agent\(alfred-code[a-z-]*:[a-z0-9-]+\)$/, `${spec} is not the scoped spelling`);
    assert.strictEqual(got.agents.deny.length, got.agents.off.length, 'every denied seat needs its spec, and only those');
});

test('derive-state: every KEPT seat carries the spec that clears a deny an earlier run wrote', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    const carriedKept = itemsOf(got.plugins.map((p) => p.split('@')[0])).agents.filter((a) => picked.agents.has(a));
    // Built from the placement directly, never from the derivation's own output - an expectation
    // read back out of the thing under test passes whatever the spelling is.
    const homes = agentHomes(placement());
    // A library seat is copied, and its spec is the core spelling a retired entry's deny was
    // re-spelled to - so picking it again clears that deny.
    const library = [...picked.agents].filter((a) => !homes.has(a)).sort();
    assert.deepStrictEqual(got.agents.allow, carriedKept.map((a) => denySpec(a, homes.get(a))).concat(library.map((a) => denySpec(a, 'alfred-code'))));
    // deny and allow are disjoint - one seat cannot be both, or the writer's last-wins rule decides
    // something the derivation should have.
    for (const spec of got.agents.allow) assert.ok(!got.agents.deny.includes(spec), `${spec} is in both lists`);
    assert.strictEqual(got.agents.allow.length + got.agents.off.length,
        itemsOf(got.plugins.map((p) => p.split('@')[0])).agents.length + got.agents.library.length,
        'every seat an enabled plugin carries is either kept or denied, and every library seat is kept');
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

test('derive-state: a skill the closure carries but nobody picked is REPORTED, never dropped', () =>
{
    const file = realSelection();
    const got = derive(file);
    const picked = readSelection(file);
    const carried = itemsOf(got.plugins.map((p) => p.split('@')[0])).skills;
    assert.deepStrictEqual(got.skills.carried, carried);
    assert.deepStrictEqual(got.skills.undroppable, carried.filter((s) => !picked.skills.has(s)));
    // The whole point of R1: there is no off-list for skills, so nothing may claim one.
    assert.ok(!Object.hasOwn(got.skills, 'off'), 'a skill off-list would be a lever that does not exist');
});

test('derive-state: rules and MCP servers pass through as picked - they are copied and registered by name', () =>
{
    // Both lists are SORTED, and the fixture is written so that file order, reverse order and
    // sorted order are three different sequences - a two-name fixture read the same forwards and
    // backwards and let an unsorted list pass.
    const file = selectionFile([
        'skill csharp', 'agent security-auditor', 'rule csharp-conventions', 'rule baseline-security',
        'mcp serena', 'mcp context7', 'mcp playwright-chrome', 'hook guard-secret-value',
    ]);
    const got = derive(file);
    assert.deepStrictEqual(got.rules.copy, ['baseline-security', 'csharp-conventions']);
    assert.deepStrictEqual(got.mcps, ['context7', 'playwright-chrome', 'serena']);
    assert.deepStrictEqual(got.hooks.on, ['guard-secret-value']);
});

test('derive-state: an empty selection installs the core and denies every seat it carries', () =>
{
    const got = derive(selectionFile(['rule baseline-security']));
    assert.deepStrictEqual(got.plugins, ['alfred-code@envoydev'], 'the core is always enabled');
    const core = itemsOf(['alfred-code']);
    assert.deepStrictEqual(got.agents.off, core.agents, 'the core seats ride in either way, so each is denied');
    assert.deepStrictEqual(got.agents.on, []);
    assert.deepStrictEqual(got.skills.undroppable, core.skills, 'and its skills are reported, because nothing can drop them');
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

// THE INVERSE - what `update --installed-only` reads back. On the plugin routes `.claude/` holds
// only the extras, so a disk read found no seat and no hook: measured on the Phase 8 matrix, one
// update wrote all thirteen hooks into ALFRED_CODE_HOOKS_OFF, denied the eight core seats, and
// refreshed only the hooks and core entries while every stack and MCP plugin stayed a release
// behind. Each surface is read from the state its own route writes instead.
const { readInstalled } = require('./derive-state.js');
const ALL_ROUTES = { skills: true, hooks: true, mcps: true };
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
    const before = narrowed({ dropAgent: 'security-auditor', dropHook: 'guard-answer-length' });
    const lines = readInstalled({
        plugins: listingOf(before), deny: before.agents.deny,
        hooksOff: before.env.ALFRED_CODE_HOOKS_OFF, routes: ALL_ROUTES, sourceDir: ROOT,
    });
    const after = fromText(lines);
    assert.deepStrictEqual(after.agents.deny, before.agents.deny, 'a seat the user switched off stays off');
    assert.deepStrictEqual(after.hooks.off, before.hooks.off, 'a hook the user switched off stays off');
    assert.deepStrictEqual(after.plugins.filter((p) => p.startsWith('alfred-code')), before.plugins.filter((p) => p.startsWith('alfred-code')),
        'every stack entry the project enabled is still in the set the update refreshes');
    assert.ok(before.agents.deny.includes('Agent(alfred-code:security-auditor)'), 'the fixture really dropped a carried seat');
    assert.ok(before.hooks.off.includes('guard-answer-length'), 'the fixture really dropped a hook');
});

test('readInstalled: a hook HOOKS_OFF does not name is on - a new release hook is adopted', () =>
{
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: 'guard-answer-length', routes: ALL_ROUTES, sourceDir: ROOT });
    const hooks = lines.filter((l) => l.startsWith('hook ')).map((l) => l.slice(5));
    assert.ok(!hooks.includes('guard-answer-length'));
    assert.ok(hooks.includes('docs-session') && hooks.includes('memory-session'));
    assert.strictEqual(hooks.length, 16);
});

test('readInstalled: each surface reads back only while its own route is on', () =>
{
    const plugins = ['alfred-code', 'claude-stack-aspnet', 'serena'];
    assert.deepStrictEqual(readInstalled({ plugins, hooksOff: '', routes: {}, sourceDir: ROOT }), [],
        'the full copy route reads the disk alone');
    // The hooks ride the core (2.0.0): without it the hooks on disk decide, and so they do on the
    // hooks copy route with the core on for the skills.
    const noCore = readInstalled({ plugins: ['serena'], hooksOff: '', routes: ALL_ROUTES, sourceDir: ROOT });
    assert.ok(!noCore.some((l) => l.startsWith('hook ')), 'no core enabled: the hooks on disk decide');
    const hooksCopied = readInstalled({ plugins: ['alfred-code'], hooksOff: '', routes: { skills: true, mcps: true }, sourceDir: ROOT });
    assert.ok(!hooksCopied.some((l) => l.startsWith('hook ')), 'the hooks copy route: the core carries them, the wired copies decide');
    assert.ok(readInstalled({ plugins: ['alfred-code'], hooksOff: '', routes: { hooks: true }, sourceDir: ROOT }).includes('hook docs-session'), 'the core carries the hooks');
    const skillsOnly = readInstalled({ plugins, hooksOff: '', routes: { skills: true }, sourceDir: ROOT });
    assert.ok(skillsOnly.every((l) => /^(skill|agent) /.test(l)) && skillsOnly.length > 0);
});

test('readInstalled: MCP entries fold back onto the catalog, once each - a cut server is no catalog line', () =>
{
    const lines = readInstalled({
        plugins: ['serena', 'context7', 'context7-local', 'playwright-firefox', 'playwright-webkit', 'claude-hud'],
        routes: { mcps: true }, sourceDir: ROOT,
    });
    assert.deepStrictEqual(lines.sort(), ['mcp context7', 'mcp playwright', 'mcp serena']);
});

test('readInstalled: a denied seat is not read back, whatever plugin carries it', () =>
{
    const lines = readInstalled({
        plugins: ['alfred-code', 'claude-stack-aspnet'],
        deny: ['Agent(alfred-code:evidence-gatherer)', 'Read(./.env)'],
        routes: { skills: true }, sourceDir: ROOT,
    });
    assert.ok(!lines.includes('agent evidence-gatherer'));
    assert.ok(lines.includes('agent security-auditor'));
});

test('readInstalled: HOOKS_OFF matches the way the hooks read it - `.js`, case and space ignored', () =>
{
    // The frozen shell twin writes `guard-answer-length.js`; the prelude honours it. A read-back
    // that missed it would switch the user's hook back on at the next node update.
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: ' Guard-Answer-Length.js ,guard-secret', routes: { hooks: true }, sourceDir: ROOT });
    assert.ok(!lines.includes('hook guard-answer-length'));
    assert.ok(lines.includes('hook guard-secret-value'), 'a prefix never matches, as in the prelude');
});

test('readInstalled: a seat denied under ANY stack entry\'s spelling stays off after it moves home', () =>
{
    const lines = readInstalled({ plugins: ['alfred-code'], deny: ['Agent(claude-stack-old-home:security-auditor)'], routes: { skills: true }, sourceDir: ROOT }); // legacy-name
    assert.ok(!lines.includes('agent security-auditor'));
});

test('writable: a surface the read-back found no evidence of writes nothing back', () =>
{
    const { writable } = require('./derive-state.js');
    const state = derive(realSelection());
    const none = writable(state, { routes: ALL_ROUTES, answered: { hooks: false, agents: false } });
    assert.deepStrictEqual({ ...none, undroppable: undefined }, { hooksOff: [], hooksAnswered: false, agentDeny: [], agentAllow: [], undroppable: undefined });
    const both = writable(state, { routes: ALL_ROUTES, answered: { hooks: true, agents: true } });
    assert.strictEqual(both.hooksAnswered, true);
    assert.deepStrictEqual(both.agentAllow, state.agents.allow);
    const copy = writable(state, { routes: {}, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual([copy.hooksOff, copy.agentDeny, copy.agentAllow, copy.undroppable], [[], [], [], []], 'the copy routes write no off-state and carry nothing unpicked');
    assert.deepStrictEqual(both.undroppable, state.skills.undroppable, 'a plugin carries what the selection did not pick');
});

// The hooks ride the core (2.0.0), and the core is on whenever ANY plugin route is. On the hooks copy
// route the picked hooks are copied and wired - the core's copies of those stand down for their
// twins - but an UNPICKED hook has no twin, so only ALFRED_CODE_HOOKS_OFF can keep the core's copy
// quiet. Before the fold no plugin carried it on that route, and it did not run at all.
test('writable: the hooks copy route with the core on still names the unpicked hooks off', () =>
{
    const { writable } = require('./derive-state.js');
    const state = narrowed({ dropAgent: 'security-auditor', dropHook: 'guard-answer-length' });
    assert.ok(state.hooks.off.includes('guard-answer-length'), 'fixture: a hook left unpicked');
    const hooksCopied = writable(state, { routes: { hooks: false, skills: true, mcps: true }, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual(hooksCopied.hooksOff, state.hooks.off, 'the core carries the unpicked hook - HOOKS_OFF is its only off-switch');
    const hooksOnlyCopy = writable(state, { routes: { hooks: false, skills: false, mcps: true }, answered: { hooks: true, agents: true } });
    assert.deepStrictEqual(hooksOnlyCopy.hooksOff, state.hooks.off, 'the MCP route alone turns the core on too');
    const fullCopy = writable(state, { routes: { hooks: false, skills: false, mcps: false }, answered: { hooks: true, agents: true } });
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
    const state = narrowed({ dropAgent: 'security-auditor', dropHook: 'guard-answer-length' });
    assert.deepStrictEqual(writable(state, { routes: ALL_ROUTES, wired: [], shipped }).hooksOff, state.hooks.off, 'the plugin route reads the selection, never the copies');
});

// THE FLOOR - status's plugin line counted skill and command descriptions and left the SEATS out,
// though every enabled seat's description rides the Agent tool's listing on every message. A seat
// `permissions.deny` switches off costs nothing (spike S3), and a `disable-model-invocation` skill's
// description is not in context at all ('Control who invokes a skill', code.claude.com/docs/en/skills).
const { floor } = require('./derive-state.js');
const { descriptionChars } = require('./plugin-placement.js');
const FLOOR_ENTRIES = ['alfred-code', 'claude-stack-aspnet'];

test('floor: the model-invocable skills plus the seats not denied, from the stack\'s own entries', () =>
{
    const carried = itemsOf(FLOOR_ENTRIES, { placement: placement() });
    const manual = carried.skills.filter((s) => /^disable-model-invocation:\s*true\s*$/m.test(fs.readFileSync(path.join(ROOT, 'stack/skills', s, 'SKILL.md'), 'utf8')));
    assert.ok(manual.length > 0, 'the fixture carries a manual-only skill');
    const all = floor({ plugins: FLOOR_ENTRIES });
    assert.strictEqual(all.skills.count, carried.skills.length - manual.length);
    assert.strictEqual(all.agents.count, carried.agents.length);
    const one = floor({ plugins: FLOOR_ENTRIES.map((p) => `${p}@envoydev`), deny: ['Agent(alfred-code:security-auditor)', 'Read(.env)'] });
    assert.deepStrictEqual(one.agents.denied, ['security-auditor']);
    assert.strictEqual(all.agents.chars - one.agents.chars, descriptionChars('agent', 'security-auditor'));
    assert.strictEqual(one.chars, one.skills.chars + one.agents.chars);
    // A retired entry still enabled here loads its items every session until the update removes it,
    // and its seat is hidden by the deny spelled under that entry.
    const retiredDeny = floor({ plugins: FLOOR_ENTRIES, deny: ['Agent(claude-stack-aspnet:aspnet-implementer)'] });
    assert.deepStrictEqual(retiredDeny.agents.denied, ['aspnet-implementer']);
});

test('floor: only the seat\'s CURRENT home spelling denies it - Claude Code matches that name exactly', () =>
{
    const stale = floor({ plugins: FLOOR_ENTRIES, deny: ['Agent(claude-stack-old-home:security-auditor)'] }); // legacy-name
    assert.deepStrictEqual(stale.agents.denied, [], 'a deny under an entry the seat left hides nothing');
    assert.strictEqual(stale.agents.chars, floor({ plugins: FLOOR_ENTRIES }).agents.chars);
});

test('floor: a name that is no stack entry counts nothing', () =>
{
    const got = floor({ plugins: ['claude-hud', 'serena', 'nope'] });
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
    const got = derive(selectionFile(['rule baseline-security', 'skill markdown-style']));
    assert.deepStrictEqual(got.hooks.off, []);
    assert.strictEqual(got.env.ALFRED_CODE_HOOKS_OFF, '');
});

test('derive-state: `hook none` - the walk\'s None at the hooks layer - switches every shipped hook off', () =>
{
    const got = derive(selectionFile(['rule baseline-security', 'hook none']));
    assert.strictEqual(got.hooks.answered, true);
    assert.deepStrictEqual(got.hooks.on, []);
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    assert.deepStrictEqual(got.hooks.off, shipped);
});

test('derive-state CLI: `written` is what THIS route writes - the full copy route writes no off-state', () =>
{
    const { execFileSync } = require('node:child_process');
    const sel = selectionFile(fs.readFileSync(realSelection(), 'utf8').split('\n').filter((l) => l.trim() !== 'agent security-auditor' && l.trim() !== 'hook guard-answer-length'));
    const run = (env) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', sel], { encoding: 'utf8', env: { ...process.env, ...env } }));
    const plugin = run({ ALFRED_CODE_SKILLS_VIA_PLUGIN: '', ALFRED_CODE_HOOKS_VIA_PLUGIN: '', ALFRED_CODE_MCPS_VIA_PLUGIN: '' });
    assert.deepStrictEqual(plugin.routes, { hooks: true, skills: true, mcps: true });
    assert.deepStrictEqual(plugin.written.agentDeny, ['Agent(alfred-code:security-auditor)']);
    assert.deepStrictEqual(plugin.written.hooksOff, ['guard-answer-length']);
    assert.deepStrictEqual(plugin.written.undroppable, plugin.skills.undroppable);
    // The MCP route alone keeps the core on, and the core carries every hook (2.0.0): the unpicked
    // hook is still named off, while the skill and seat surfaces - copied on this route - write nothing.
    const copy = run({ ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' });
    assert.deepStrictEqual([copy.written.agentDeny, copy.written.hooksOff, copy.written.undroppable], [[], ['guard-answer-length'], []]);
    const full = run({ ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' });
    assert.deepStrictEqual([full.written.agentDeny, full.written.hooksOff, full.written.undroppable], [[], [], []]);
});

test('setup reports only keys the derivation prints', () =>
{
    // A renamed key would leave the walk quoting a field that no longer exists.
    const init = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'commands', 'setup.md'), 'utf8');
    const step = init.slice(init.indexOf('## 11. Install'));
    const cited = [...step.slice(0, step.indexOf('Then run the installer')).matchAll(/`((?:routes|written|plugins|skills|agents|hooks)(?:\.[A-Za-z]+)*)`/g)].map((m) => m[1]);
    assert.ok(cited.length >= 4, `setup names the fields it reports, found ${cited.join(',')}`);
    const { execFileSync } = require('node:child_process');
    const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--selection', realSelection()], { encoding: 'utf8' }));
    for (const key of cited)
        assert.notStrictEqual(key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), out), undefined, `setup cites ${key}, which the derivation does not print`);
});

test('floor: entries it does not count come back as `skipped`, never silently dropped', () =>
{
    const got = floor({ plugins: ['alfred-code', 'claude-hud', 'serena@envoydev'] });
    assert.deepStrictEqual(got.entries, ['alfred-code']);
    assert.deepStrictEqual(got.skipped, ['claude-hud', 'serena']);
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
    fs.writeFileSync(a, JSON.stringify({ permissions: { deny: ['Agent(alfred-code:security-auditor)'] } }));
    fs.writeFileSync(b, JSON.stringify({ permissions: { deny: ['Agent(alfred-code:evidence-gatherer)'] } }));
    const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'derive-state.js'), '--floor', '--plugins', 'alfred-code', '--settings', a, '--settings', b, '--settings', path.join(TMP, 'absent.json')], { encoding: 'utf8' }));
    assert.deepStrictEqual(out.agents.denied.sort(), ['evidence-gatherer', 'security-auditor']);
});

// T3 - update as a two-way reconcile. What LEFT upstream is the RETIRED lists; what is NEW is read
// here, against THIS install: an item riding an entry the project already enables ARRIVES with the
// refresh, anything else is an OFFER the user takes or leaves, and the user's own off-state wins.
const { stampCarried, classifyNew } = require('./derive-state.js');

test('stampCarried: an item MOVED out of an entry still enabled here into the core comes back through the core', () =>
{
    const stamp = { skills: ['alfred-task-solve-cross@claude-stack-old'], agents: ['security-auditor@claude-stack-old'] }; // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp, enabled: ['claude-stack-old'], routes: ALL_ROUTES }), ['skill alfred-task-solve-cross', 'agent security-auditor']); // legacy-name
});

test('stampCarried: no move, an uninstalled or parked old home, a parked core, a denied seat, a library item - nothing', () =>
{
    const moved = { skills: ['alfred-task-solve-cross@claude-stack-old'], agents: ['security-auditor@claude-stack-old'] }; // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: { skills: ['alfred-task-solve-cross@alfred-code'] }, enabled: ['alfred-code'], routes: ALL_ROUTES }), [], 'the same home - readInstalled already has it');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: [], routes: ALL_ROUTES }), [], 'the user uninstalled the old home');
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: [], parked: ['claude-stack-old'], routes: ALL_ROUTES }), [], 'the user parked the old home'); // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['claude-stack-old'], parked: ['alfred-code'], routes: ALL_ROUTES }), [], 'the new home is parked'); // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['claude-stack-old'], deny: ['Agent(claude-stack-x:security-auditor)'], routes: ALL_ROUTES }), ['skill alfred-task-solve-cross'], 'a seat denied under any spelling'); // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: { skills: ['angular-material', 'alfred-task-solve-cross'] }, enabled: ['claude-stack-old'], routes: ALL_ROUTES }), [], 'a library copy, and a plain name with no stamped home'); // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: { skills: ['dotnet-web-backend@claude-stack-old'] }, enabled: ['claude-stack-old'], routes: ALL_ROUTES }), [], 'a library item homed in an entry that is no retired one'); // legacy-name
    assert.deepStrictEqual(stampCarried({ stamp: moved, enabled: ['claude-stack-old'], routes: { skills: false } }), []); // legacy-name
});

// R78: a stamp is a file on disk a hand or a bad merge can change, and a carried name becomes a
// selection line the library layer joins into a path. The shared validator (stamp.js validItemName)
// gates it, the same check every other stamp reader runs: a name that fails it is never carried.
test('stampCarried: a stamped name that is no item name - traversal, a separator, a space - is never carried (R78)', () =>
{
    const home = 'claude-stack-aspnet'; // legacy-name - a per-stack entry retired in 1.3.0
    const bad = ['../../etc', 'a/b', '..', 'x y', 'Upper', ''];
    const stamp = { skills: [...bad.map((n) => `${n}@${home}`), `dotnet-web-backend@${home}`], agents: bad.map((n) => `${n}@${home}`) };
    assert.deepStrictEqual(stampCarried({ stamp, enabled: [home], routes: ALL_ROUTES }), ['skill dotnet-web-backend']);
});

test('readInstalled: every hook switched off reads back as `hook none`, not as unanswered', () =>
{
    const shipped = [...new Set(loadManifest(ROOT).catalogs.hooks.map((r) => r.split('::')[0].replace(/\.js$/, '')))];
    const lines = readInstalled({ plugins: ['alfred-code'], hooksOff: shipped.join(','), routes: { hooks: true }, sourceDir: ROOT });
    assert.deepStrictEqual(lines, ['hook none']);
});

test('classifyNew: a core item arrives, a library item is offered, the user\'s off-state wins', () =>
{
    const added = [
        { category: 'skill', name: 'markdown-style' }, { category: 'skill', name: 'dotnet-web-backend' },
        { category: 'agent', name: 'evidence-gatherer' }, { category: 'agent', name: 'code-style-analyzer' },
        { category: 'rule', name: 'baseline-memory' }, { category: 'rule', name: 'sql-conventions' },
        { category: 'hook', name: 'docs-session' }, { category: 'hook', name: 'guard-answer-length' },
        { category: 'skill', name: 'angular-material' }, { category: 'rule', name: 'markdown-docs' },
    ];
    const rows = classifyNew({
        added, plugins: ['alfred-code'], deny: ['Agent(alfred-code:code-style-analyzer)'],
        hooksOff: 'guard-answer-length', routes: ALL_ROUTES, always: { rules: ['baseline-memory'] }, sourceDir: ROOT,
    });
    const by = Object.fromEntries(rows.map((r) => [`${r.category} ${r.name}`, r]));
    assert.strictEqual(by['skill markdown-style'].verdict, 'arrives');
    assert.deepStrictEqual([by['skill dotnet-web-backend'].verdict, by['skill dotnet-web-backend'].entry, by['skill dotnet-web-backend'].recommend], ['offer', null, 'leave'], 'library - copied only on a yes');
    assert.strictEqual(by['agent evidence-gatherer'].verdict, 'arrives');
    assert.strictEqual(by['agent code-style-analyzer'].verdict, 'off');
    assert.strictEqual(by['rule baseline-memory'].verdict, 'arrives', 'the locked baseline is adopted');
    assert.deepStrictEqual([by['rule sql-conventions'].verdict, by['rule sql-conventions'].recommend], ['offer', 'leave'], 'its closure copies library items - no free take');
    assert.ok(by['rule sql-conventions'].copies.length > 0, 'and it names them');
    assert.deepStrictEqual(by['rule sql-conventions'].enables, [], 'the core is enabled, so a yes switches no entry on');
    assert.deepStrictEqual([by['hook docs-session'].verdict, by['hook docs-session'].entry], ['arrives', 'alfred-code'], 'the hooks ride the core');
    assert.strictEqual(by['hook guard-answer-length'].verdict, 'off');
    assert.deepStrictEqual([by['skill angular-material'].verdict, by['skill angular-material'].entry], ['offer', null], 'a library item is copied only on a yes');
    assert.deepStrictEqual([by['rule markdown-docs'].verdict, by['rule markdown-docs'].recommend, by['rule markdown-docs'].enables, by['rule markdown-docs'].copies], ['offer', 'take', [], []], 'a rule whose closure the core already carries is the free take');
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
    assert.deepStrictEqual(withHooks.map((r) => r.verdict), ['offer', 'offer', 'arrives']);
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
        plugins: ['alfred-code'], deny: ['Agent(alfred-code:old-gatherer)'], hooksOff: 'old-docs', routes: ALL_ROUTES, sourceDir: ROOT,
    });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.deepStrictEqual([by['sql-conventions'].verdict, by['sql-conventions'].from], ['renamed', 'old-sql']);
    assert.strictEqual(by['typescript-conventions'].verdict, 'offer', 'never installed here - a plain offer');
    assert.deepStrictEqual([by['evidence-gatherer'].verdict, by['evidence-gatherer'].wasOff], ['arrives', true], 'the new name comes on; the report must say the old one was off');
    assert.deepStrictEqual([by['docs-session'].verdict, by['docs-session'].wasOff], ['arrives', true]);
});

// T4: the walk's closed selection against the read-back inventory, as the --add / --drop the
// installer takes - so configure and validate apply through --installed-only, never --selection.
const { delta } = require('./derive-state.js');

test('delta: what the walk added and dropped against the inventory, one line each', () =>
{
    const installed = { skills: ['csharp', 'dotnet'], agents: ['evidence-gatherer'], rules: ['baseline-security'], hooks: ['docs-session', 'guard-read-whole-file'], mcps: ['serena'], plugins: [{ name: 'claude-hud', scope: 'user' }] };
    const selectionText = ['skill csharp', 'skill markdown-style', 'agent evidence-gatherer', 'rule baseline-security', 'rule sql-conventions', 'hook docs-session', 'mcp serena', 'plugin claude-hud'].join('\n');
    assert.deepStrictEqual(delta({ installed, selectionText }), {
        add: ['skill markdown-style', 'rule sql-conventions'],
        drop: ['skill dotnet', 'hook guard-read-whole-file'],
        keptOff: [], keepParked: [],
    });
});

test('delta: a selection naming no hook at all drops every installed hook - the walk answered None', () =>
{
    const got = delta({ installed: { hooks: ['docs-session'], rules: ['baseline-security'] }, selectionText: 'rule baseline-security\nhook none\n' });
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

// Task 3 (library route): a per-stack entry 1.2.0 shipped is retired in 1.3.0 and listed for one
// release. While it is still enabled, what it carries is what the project runs today - read back as
// installed, and a stamp pick homed there is carried into the library as a copy.
test('an enabled retired entry reads back its items, a denied seat excluded', () =>
{
    const lines = readInstalled({
        plugins: ['alfred-code', 'claude-stack-angular'],
        deny: ['Agent(claude-stack-angular:ng-build-error-resolver)'],
        routes: { skills: true },
    });
    assert.ok(lines.includes('skill angular-conventions'));
    assert.ok(lines.includes('agent angular-test-resolver'));
    assert.ok(!lines.includes('agent ng-build-error-resolver'));
    assert.strictEqual(lines.length, new Set(lines).size, 'no line twice');
});

test('a stamp pick homed in an enabled retired entry is carried into the library', () =>
{
    const lines = stampCarried({
        stamp: { skills: ['angular-conventions@claude-stack-angular'], agents: ['angular-test-resolver@claude-stack-angular'] },
        enabled: ['alfred-code', 'claude-stack-angular'], parked: [], deny: [], routes: { skills: true },
    });
    assert.deepStrictEqual(lines.sort(), ['agent angular-test-resolver', 'skill angular-conventions']);
    const denied = stampCarried({
        stamp: { skills: [], agents: ['angular-test-resolver@claude-stack-angular'] },
        enabled: ['alfred-code', 'claude-stack-angular'], deny: ['Agent(claude-stack-angular:angular-test-resolver)'], routes: { skills: true },
    });
    assert.deepStrictEqual(denied, [], 'a denied seat stays out');
});

test('a parked retired entry carries nothing across', () =>
{
    const lines = stampCarried({
        stamp: { skills: ['angular-conventions@claude-stack-angular'], agents: [] },
        enabled: ['alfred-code'], parked: ['claude-stack-angular'], deny: [], routes: { skills: true },
    });
    assert.deepStrictEqual(lines, []);
});

test('a picked library seat clears its deny, so a seat switched off in 1.2.0 comes back when picked again', () =>
{
    const state = fromText(['agent angular-test-resolver', 'agent evidence-gatherer']);
    assert.ok(state.agents.library.includes('angular-test-resolver'));
    assert.ok(state.agents.allow.includes('Agent(alfred-code:angular-test-resolver)'), state.agents.allow.join(','));
    assert.ok(!state.agents.deny.includes('Agent(alfred-code:angular-test-resolver)'));
});

// --- 2.0.0: a 1.x install under its old names ------------------------------------------------------
// The core was renamed and the hooks folded into it; a 1.x listing can still carry `claude-stack` / // legacy-name
// `claude-stack-hooks` (the catalog refreshed, no session since - docs/rebrand-evidence.md S9), a // legacy-name
// 1.x stamp homes its core picks `@claude-stack`, and a 1.x seat deny is `Agent(claude-stack:<seat>)`, // legacy-name
// which still blocks the renamed seat (S6). Each reads as the core it is.
const OLD = 'claude-stack'; // legacy-name

test('readInstalled: the core under its 1.x name, beside the 1.x hooks id, reads back as the renamed core', () =>
{
    const now = readInstalled({ plugins: ['alfred-code@envoydev'], deny: ['Agent(alfred-code:security-auditor)'], hooksOff: 'guard-answer-length', routes: ALL_ROUTES, sourceDir: ROOT });
    const old = readInstalled({ plugins: [`${OLD}@${OLD}`, `${OLD}-hooks@${OLD}`], deny: [`Agent(${OLD}:security-auditor)`], hooksOff: 'guard-answer-length', routes: ALL_ROUTES, sourceDir: ROOT });
    assert.ok(now.includes('agent evidence-gatherer') && !now.includes('agent security-auditor'), 'the fixture reads core seats');
    assert.deepStrictEqual(old, now);
});

test('stampCarried: a 1.x stamp homed `@claude-stack` is homed in the core - no move, whichever name the listing uses', () => // legacy-name
{
    const stamp = { skills: [`alfred-task-solve-cross@${OLD}`], agents: [`security-auditor@${OLD}`] };
    assert.deepStrictEqual(stampCarried({ stamp, enabled: [OLD], routes: ALL_ROUTES }), [], 'the old core name is the same entry, not a moved-from one');
    assert.deepStrictEqual(stampCarried({ stamp, enabled: ['alfred-code'], routes: ALL_ROUTES }), []);
});

test('floor: the 1.x core entry counts as the core, and its 1.x seat deny still hides the seat (S6)', () =>
{
    const now = floor({ plugins: ['alfred-code@envoydev'], deny: ['Agent(alfred-code:security-auditor)'] });
    const old = floor({ plugins: [`${OLD}@${OLD}`], deny: [`Agent(${OLD}:security-auditor)`] });
    assert.deepStrictEqual(now.agents.denied, ['security-auditor'], 'the fixture denies a core seat');
    assert.deepStrictEqual(old, now);
});

test('classifyNew: an item the 1.x-named core carries arrives, and a 1.x seat deny keeps it off', () =>
{
    const added = [{ category: 'skill', name: 'markdown-style' }, { category: 'agent', name: 'code-style-analyzer' }, { category: 'hook', name: 'docs-session' }];
    const rows = classifyNew({ added, plugins: [OLD, `${OLD}-hooks`], deny: [`Agent(${OLD}:code-style-analyzer)`], routes: ALL_ROUTES, sourceDir: ROOT });
    const by = Object.fromEntries(rows.map((r) => [`${r.category} ${r.name}`, r.verdict]));
    assert.deepStrictEqual(by, { 'skill markdown-style': 'arrives', 'agent code-style-analyzer': 'off', 'hook docs-session': 'arrives' });
});
