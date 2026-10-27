'use strict';
// THE SETTINGS.JSON WRITER OF THE NODE SEED - Phase 7, T2.
//
// `scripts/installer-settings.test.js` drives the shell twins against real projects and proves the
// same rules end to end; this is the unit counterpart, so a rule change fails in milliseconds.
//
// The rules are the shell's, unchanged. The three that cost the most when they were wrong:
//   - a settings.json that does not parse is LEFT UNTOUCHED, because falling back to {} replaces
//     the project's whole file with just the stack's entries;
//   - a hook file wired on two tools is TWO entries, keyed on (matcher, command) - keying on the
//     command alone dropped the second, and no install ever carried the Bash matcher;
//   - the env pass RENAMES before it SEEDS, because seeding first writes a default over the value
//     the user had set under the old name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeSettings, applyEnv, hookCommand, HOOK_TIMEOUT, settingsTarget, readBackSettings, leaveLocalScope } = require('./install/settings.js');
const { envMigrations } = require('./install/env-migrations.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-settings-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const CATALOG = require('../meta/environment.json').env;
const MIGRATIONS = {
    renames: [['ALFRED_CODE_DOCS_DIR', 'ALFRED_CODE_DOCS_PATH']],
    retired: [['ALFRED_CODE_FRESH_SESSION_PCT', null], ['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', '40']],
    reseed: [['ALFRED_CODE_CONTEXT_WINDOW_FOR_200K', '150000', '180000']],
};

let seq = 0;
function settingsFile(initial)
{
    const dir = path.join(TMP, `s-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'settings.json');
    if (initial !== undefined) fs.writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial, null, 2));
    return file;
}

function write(file, opts = {})
{
    const logs = [];
    const notes = [];
    const result = writeSettings({
        file, catalog: CATALOG, migrations: MIGRATIONS,
        log: (m) => logs.push(m), note: (m) => notes.push(m), ...opts,
    });
    // A refused write leaves whatever was there, which by definition may not parse - reading it
    // back as JSON here would fail the test for the behaviour it is asserting.
    let data = null;
    if (fs.existsSync(file)) { try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = null; } }
    return { result, logs, notes, data };
}

const HOOK = (file, matcher, args) => ({ file, matcher, args });

test('settings-writer: a file that does not parse is LEFT UNTOUCHED', () =>
{
    const file = settingsFile('{ not json');
    const { result, notes } = write(file, { hookSpecs: [HOOK('guard-a.js', 'Bash')] });
    assert.strictEqual(result.refused, true);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json',
        'the unparseable file was rewritten - the project lost its permissions and statusLine');
    assert.match(notes[0], /not valid JSON/);
});

// The 2026-10-16 matrix: a hooks block of the wrong shape threw half-way through the write ('Cannot read properties of
// null', 'entries.splice is not a function') and a list wired nothing, silently. It is the user's to fix, like bad JSON.
test('settings-writer: a hooks block Claude Code cannot read is LEFT UNTOUCHED and named where it breaks', () =>
{
    for (const [hooks, where] of [
        [[], 'hooks is not an object'],
        [{ Stop: 'nope' }, 'hooks.Stop is not a list'],
        [{ PostToolUse: [null] }, 'hooks.PostToolUse[0] is not an object'],
        [{ Stop: [{ hooks: 'x' }] }, 'hooks.Stop[0].hooks is not a list'],
        [{ Stop: [{ hooks: [{ type: 'command', command: 'echo a' }, null] }] }, 'hooks.Stop[0].hooks[1] is not an object'],
    ])
    {
        const text = JSON.stringify({ model: 'mine', hooks });
        const file = settingsFile(text);
        const { result, notes } = write(file, { hookSpecs: [HOOK('history-session.js', '@Stop')] });
        assert.strictEqual(result.refused, true, where);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), text, where);
        assert.strictEqual(notes[0], `settings.json hooks block is not the shape Claude Code reads (${where}) - left untouched; fix it and re-run`);
    }
    // An absent or null block is no block, and a group with no `hooks` key an empty one: the stack's row is written beside it.
    for (const hooks of [undefined, null, { Stop: [{ matcher: '' }] }])
    {
        const { result, data } = write(settingsFile({ hooks }), { hookSpecs: [HOOK('history-session.js', '@Stop')] });
        assert.notStrictEqual(result.refused, true, JSON.stringify(hooks));
        assert.ok(data.hooks.Stop.some((g) => (g.hooks || []).some((h) => /history-session\.js/.test(h.command))), JSON.stringify(hooks));
    }
});

// Re-verify 3 S9: a file that cannot be READ is said so with its error code - never 'not valid JSON', which sends the user
// looking for a syntax error in a file that may be fine.
test('settings-writer: a file that cannot be read is LEFT UNTOUCHED and named by its read error, not as bad JSON', () =>
{
    const file = settingsFile();
    fs.mkdirSync(file);
    const { result, notes } = write(file, { hookSpecs: [HOOK('guard-a.js', 'Bash')] });
    assert.strictEqual(result.refused, true);
    assert.ok(fs.statSync(file).isDirectory());
    assert.match(notes[0], /^settings\.json could not be read \(EISDIR\) - left untouched/, notes[0]);
    assert.doesNotMatch(notes[0], /not valid JSON/);
});

// The release matrix of 2026-10-20: an EMPTY file was refused here as bad JSON ('fix it and re-run') while the memory
// step of the same run wrote into it - it holds nothing to lose, so both read it as no settings yet.
test('settings-writer: an empty or whitespace-only file is no settings yet - written, never refused', () =>
{
    for (const body of ['', '  \n'])
    {
        const { result, notes, data } = write(settingsFile(body), { hookSpecs: [HOOK('guard-a.js', 'Bash')] });
        assert.notStrictEqual(result.refused, true, JSON.stringify(body));
        assert.deepStrictEqual(notes.filter((n) => /not valid JSON|left untouched/.test(n)), [], JSON.stringify(body));
        assert.ok(JSON.stringify(data.hooks || {}).includes('guard-a.js'), JSON.stringify(body));
    }
});

test('settings-writer: a top level that is not an object is refused the same way', () =>
{
    const file = settingsFile('[1, 2]');
    const { result, notes } = write(file);
    assert.strictEqual(result.refused, true);
    assert.match(notes[0], /not an object/);
});

test('settings-writer: the project\'s own keys survive a write', () =>
{
    const file = settingsFile({ statusLine: { type: 'command', command: 'mine' }, permissions: { deny: ['Read(./private)'] } });
    const { data } = write(file, { denySpecs: ['Read(./.env)'] });
    assert.deepStrictEqual(data.statusLine, { type: 'command', command: 'mine' });
    assert.ok(data.permissions.deny.includes('Read(./private)'), 'the project\'s own deny entry was dropped');
    assert.ok(data.permissions.deny.includes('Read(./.env)'));
});

test('settings-writer: a hook wired on TWO tools is two entries', () =>
{
    const file = settingsFile({});
    const { data } = write(file, { hookSpecs: [HOOK('guard-read-whole-file.js', 'Read'), HOOK('guard-read-whole-file.js', 'Bash')] });
    const matchers = data.hooks.PreToolUse.map((e) => e.matcher).sort();
    assert.deepStrictEqual(matchers, ['Bash', 'Read'],
        'keying on the command alone dropped the second matcher - no install would carry it');
});

test('settings-writer: every wiring carries the timeout, because the default is 600s', () =>
{
    const file = settingsFile({});
    const { data } = write(file, { hookSpecs: [HOOK('a.js', 'Bash'), HOOK('b.js', '@Stop')] });
    const all = Object.values(data.hooks).flat().flatMap((e) => e.hooks);
    assert.ok(all.length >= 2);
    for (const h of all) assert.strictEqual(h.timeout, HOOK_TIMEOUT, 'a bare wiring would freeze a session for ten minutes');
});

test('settings-writer: the 60s exception is the build check\'s Stop wiring alone, not its PostToolUse append', () =>
{
    const file = settingsFile({ hooks: { PostToolUse: [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/check-turn-build.js"', timeout: 60 }] }] } });
    const { data } = write(file, { hookSpecs: [HOOK('check-turn-build.js', '@PostToolUse:Write|Edit|MultiEdit'), HOOK('check-turn-build.js', '@Stop')] });
    assert.strictEqual(data.hooks.Stop.flatMap((e) => e.hooks)[0].timeout, 60, 'the build itself gets its minute');
    assert.strictEqual(data.hooks.PostToolUse.flatMap((e) => e.hooks)[0].timeout, HOOK_TIMEOUT, 'a path append that stalls is killed at 10s, and an old 60 is corrected');
});

// The user's ruling of 2026-10-16: the turn check rides history-session's Stop process on the copy route too, and that
// wiring takes the check's minute; with history-session not picked the check keeps its own Stop row.
test('settings-writer: the build check folds into history-session\'s Stop wiring, or keeps its own without it', () =>
{
    const both = write(settingsFile({}), { hookSpecs: [HOOK('history-session.js', '@SessionStart'), HOOK('history-session.js', '@Stop'), HOOK('check-turn-build.js', '@Stop')] }).data;
    const stop = both.hooks.Stop.flatMap((e) => e.hooks);
    assert.deepStrictEqual(stop.map((h) => h.command), ['"$CLAUDE_PROJECT_DIR/.claude/hooks/history-session.js"'], 'one Stop process');
    assert.strictEqual(stop[0].timeout, 60, 'the check it carries gets its minute');
    assert.strictEqual(both.hooks.SessionStart.flatMap((e) => e.hooks)[0].timeout, HOOK_TIMEOUT, 'history\'s start keeps 10');
    const alone = write(settingsFile({}), { hookSpecs: [HOOK('check-turn-build.js', '@Stop')] }).data;
    assert.deepStrictEqual(alone.hooks.Stop.flatMap((e) => e.hooks).map((h) => [h.command, h.timeout]), [['"$CLAUDE_PROJECT_DIR/.claude/hooks/check-turn-build.js"', 60]]);
});

test('settings-writer: the command placeholder is QUOTED, so a path with a space survives', () =>
{
    assert.strictEqual(hookCommand('a.js', '').command, '"$CLAUDE_PROJECT_DIR/.claude/hooks/a.js"');
    assert.strictEqual(hookCommand('a.js', '--flag').command, '"$CLAUDE_PROJECT_DIR/.claude/hooks/a.js" --flag');
});

test('settings-writer: an older install\'s UNQUOTED entry is migrated in place, not duplicated', () =>
{
    const file = settingsFile({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/a.js' }] }] } });
    const { data } = write(file, { hookSpecs: [HOOK('a.js', 'Bash')] });
    const entries = data.hooks.PreToolUse.flatMap((e) => e.hooks);
    assert.strictEqual(entries.length, 1, 'the update left two entries for one hook');
    assert.strictEqual(entries[0].command, '"$CLAUDE_PROJECT_DIR/.claude/hooks/a.js"');
    assert.strictEqual(entries[0].timeout, HOOK_TIMEOUT, 'the bare entry kept the 600s default');
});

test('settings-writer: the instrument hook is wired ungated, and the gated text an earlier copy route wired migrates in place', () =>
{
    const spec = hookCommand('instrument-tool-usage.js', '');
    assert.strictEqual(spec.command, '"$CLAUDE_PROJECT_DIR/.claude/hooks/instrument-tool-usage.js"');
    assert.ok(spec.older.includes(`[ "$ALFRED_CODE_INSTRUMENT" != "1" ] || ${spec.command}`), JSON.stringify(spec.older));
    assert.deepStrictEqual(hookCommand('a.js', '').older, [], 'only the instrumentation hook had a gate');
});

test('settings-writer: a RETIRED hook is unwired from EVERY event, not just PreToolUse', () =>
{
    const file = settingsFile({ hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/gone.js"' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/gone.js"' }] }],
    } });
    const { data } = write(file, { retiredHooks: ['gone.js'] });
    assert.deepStrictEqual(data.hooks, {}, 'a retired hook kept spawning a command whose file is gone');
});

test('settings-writer: a hook the user DE-SELECTED keeps its entries - that is configure\'s job', () =>
{
    const file = settingsFile({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/theirs.js"' }] }] } });
    const { data } = write(file, { hookSpecs: [HOOK('ours.js', 'Bash')] });
    const commands = data.hooks.PreToolUse.flatMap((e) => e.hooks).map((h) => h.command);
    assert.ok(commands.some((c) => c.includes('theirs.js')), 'an unselected hook was unwired by a plain run');
});

test('settings-writer: an @Event matcher wires a lifecycle event, with its own matcher key when given', () =>
{
    const file = settingsFile({});
    const { data } = write(file, { hookSpecs: [HOOK('stop.js', '@Stop'), HOOK('fresh.js', '@SessionStart:compact')] });
    assert.strictEqual(data.hooks.Stop.length, 1);
    assert.strictEqual(data.hooks.Stop[0].matcher, undefined, 'Stop has no matcher key');
    assert.strictEqual(data.hooks.SessionStart[0].matcher, 'compact',
        'without the matcher the entry fires on every session start');
});

// Audit 2026-10-08 row 28: the tool-usage log is a side effect only, so it runs async - the call never waits on its spawn.
test('settings-writer: the instrument hook alone is wired async, an older blocking entry is backfilled, and a re-run changes nothing', () =>
{
    const inst = hookCommand('instrument-tool-usage.js', '').command;
    const file = settingsFile({ hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: inst, timeout: 10 }] }] } });
    const specs = [HOOK('instrument-tool-usage.js', '.*'), HOOK('a.js', 'Bash')];
    const { data } = write(file, { hookSpecs: specs });
    const hooks = data.hooks.PreToolUse.flatMap((e) => e.hooks);
    assert.strictEqual(hooks.filter((h) => h.command === inst).length, 1, 'one entry, not a second beside the old one');
    assert.strictEqual(hooks.find((h) => h.command === inst).async, true, 'the older blocking entry is backfilled');
    assert.ok(!('async' in hooks.find((h) => h.command !== inst)), 'a guard is never async - it must be able to block');
    const fresh = write(settingsFile({}), { hookSpecs: specs }).data.hooks.PreToolUse.flatMap((e) => e.hooks);
    assert.strictEqual(fresh.find((h) => h.command === inst).async, true, 'a fresh install wires it async');
    const before = fs.readFileSync(file, 'utf8');
    assert.strictEqual(write(file, { hookSpecs: specs }).result.written, false, 'a re-run changes nothing');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('settings-writer: the write is IDEMPOTENT - a second run changes nothing', () =>
{
    const file = settingsFile({});
    const specs = [HOOK('a.js', 'Bash'), HOOK('b.js', '@Stop')];
    write(file, { hookSpecs: specs, denySpecs: ['Read(./.env)'], mcpNames: ['serena'] });
    const first = fs.readFileSync(file, 'utf8');
    const { result } = write(file, { hookSpecs: specs, denySpecs: ['Read(./.env)'], mcpNames: ['serena'] });
    assert.strictEqual(result.written, false, 'a no-change run rewrote the file');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), first);
});

// The stack registers no MCP server since 2.10.1: the names an earlier release pre-approved leave, the user's own stay, and
// a list this run empties goes - no list is ever created.
test('settings-writer: enabledMcpjsonServers loses the names an earlier release registered and keeps the user\'s own', () =>
{
    const file = settingsFile({ enabledMcpjsonServers: ['serena', 'context7', 'theirs'] });
    const { data } = write(file, { mcpOff: ['serena', 'context7'] });
    assert.deepStrictEqual(data.enabledMcpjsonServers, ['theirs'],
        'a leftover entry names a .mcp.json server that no longer exists - dead config that reads like a knob');
    assert.strictEqual(write(settingsFile({ enabledMcpjsonServers: ['serena'] }), { mcpOff: ['serena'] }).data.enabledMcpjsonServers, undefined, 'a list this run emptied stays behind');
    assert.strictEqual(write(settingsFile({}), { mcpOff: ['serena'] }).data.enabledMcpjsonServers, undefined, 'a list was created');
    assert.deepStrictEqual(write(settingsFile({ enabledMcpjsonServers: [] }), { mcpOff: ['serena'] }).data.enabledMcpjsonServers, [], 'the user\'s own empty list was removed');
});

// Every release before 2.10.1 created enabledMcpjsonServers on each write, an empty list on the plugin route (temp-project
// matrix 2026-10-24: an update over v2.10.0 left `[]` behind). On the first update past the servers' retirement an empty
// one is the stack's and goes, as uninstall takes it; disabledMcpjsonServers was never created empty, so its empty list
// stays the user's.
test('settings-writer: the first update past the retirement drops the empty enabledMcpjsonServers an earlier release created', () =>
{
    const lines = [];
    const gone = write(settingsFile({ enabledMcpjsonServers: [], disabledMcpjsonServers: [] }), { mcpOff: ['serena'], dropEmptyApprovals: true, log: (l) => lines.push(l) });
    assert.strictEqual(gone.data.enabledMcpjsonServers, undefined, 'the empty list the stack created stayed');
    assert.deepStrictEqual(gone.data.disabledMcpjsonServers, [], 'an empty disabled list is the user\'s');
    assert.ok(lines.some((l) => /dropped the empty enabledMcpjsonServers list an earlier release created/.test(l)), lines.join('\n'));
    assert.deepStrictEqual(write(settingsFile({ enabledMcpjsonServers: ['theirs'] }), { mcpOff: ['serena'], dropEmptyApprovals: true }).data.enabledMcpjsonServers, ['theirs']);
});

// An engine an earlier release registered but left off was named in disabledMcpjsonServers beside its registration; the
// registration goes with the retirement, so its entry does too - the same rule as the approval list.
test('settings-writer: disabledMcpjsonServers loses the names an earlier release registered and keeps the user\'s own', () =>
{
    const { data } = write(settingsFile({ disabledMcpjsonServers: ['firefox-control', 'theirs'] }), { mcpOff: ['firefox-control'] });
    assert.deepStrictEqual(data.disabledMcpjsonServers, ['theirs']);
    assert.strictEqual(write(settingsFile({ disabledMcpjsonServers: ['firefox-control'] }), { mcpOff: ['firefox-control'] }).data.disabledMcpjsonServers, undefined, 'a list this run emptied stays behind');
    assert.strictEqual(write(settingsFile({}), { mcpOff: ['firefox-control'] }).data.disabledMcpjsonServers, undefined, 'a list was created');
});

test('settings-writer: a retired deny entry goes, and only that exact string', () =>
{
    const file = settingsFile({ permissions: { deny: ['Read(./old-secret)', 'Read(./mine)'] } });
    const { data } = write(file, { retiredDeny: ['Read(./old-secret)'] });
    assert.deepStrictEqual(data.permissions.deny, ['Read(./mine)']);
});

// ------------------------------------------------------------------ the env pass, in order

const envPass = (env, opts = {}) =>
{
    const logs = [];
    applyEnv(env, { catalog: CATALOG, migrations: MIGRATIONS, log: (m) => logs.push(m), ...opts });
    return { env, logs };
};

test('settings-env: a RENAME carries the value before any seed can overwrite it', () =>
{
    const { env } = envPass({ ALFRED_CODE_DOCS_DIR: 'docs/mine' });
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'docs/mine',
        'the seed ran first and wrote the default over the user\'s value');
    assert.ok(!('ALFRED_CODE_DOCS_DIR' in env), 'the old key survived the rename');
});

test('settings-env: a rename never overwrites a value already set under the NEW name', () =>
{
    const { env } = envPass({ ALFRED_CODE_DOCS_DIR: 'old', ALFRED_CODE_DOCS_PATH: 'new' });
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'new');
    assert.ok(!('ALFRED_CODE_DOCS_DIR' in env));
});

test('settings-env: a RETIRED key is dropped, and a conditional one only at its old seed', () =>
{
    const dropped = envPass({ ALFRED_CODE_FRESH_SESSION_PCT: '40' }).env;
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_PCT' in dropped));

    const atSeed = envPass({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' }).env;
    assert.ok(!('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' in atSeed), 'the stack\'s own old seed was kept');

    const theirs = envPass({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '75' }).env;
    assert.strictEqual(theirs.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '75',
        'a value the user set by hand was removed - the stack does not own that key');
});

test('settings-env: a BAD SEED is corrected only while it still holds that seed', () =>
{
    assert.strictEqual(envPass({ ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000' }).env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, '180000');
    assert.strictEqual(envPass({ ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '120000' }).env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, '120000',
        'a tuned value was reset to the stack\'s number');
});

// 2026-10-16 matrix: a value the user typed equal to an old seed was reset on EVERY update - the reseed now asks the ledger.
test('settings-env: a BAD SEED the user typed is theirs - the ledger decides, under the key\'s old name too', () =>
{
    const K = 'ALFRED_CODE_CONTEXT_WINDOW_FOR_200K';
    const OLD = 'ALFRED_CODE_FRESH_SESSION_200K';
    const migrations = { ...MIGRATIONS, renames: [...MIGRATIONS.renames, [OLD, K]] };
    const run = (env, prior) => { const file = settingsFile({ env }); write(file, { migrations, ledger: { prior, releaseHooks: [] } }); return JSON.parse(fs.readFileSync(file, 'utf8')).env; };
    const ledgered = (rows) => ({ env: { 'settings.json': rows }, deny: [], hooks: [] });
    assert.strictEqual(run({ [K]: '150000' }, ledgered({ [K]: valueHash('180000') }))[K], '150000', 'the stack wrote 180000, the user set 150000: kept');
    assert.strictEqual(run({ [K]: '150000' }, ledgered({ [K]: valueHash('150000') }))[K], '180000', 'the stack wrote 150000: reset');
    assert.strictEqual(run({ [K]: '150000' }, ledgered({ MY: 'x' }))[K], '150000', 'a key the ledger never recorded is the user\'s');
    assert.strictEqual(run({ [K]: '150000' }, null)[K], '180000', 'no ledger (an older stamp): the value match alone');
    const renamed = run({ [OLD]: '150000' }, ledgered({ [OLD]: valueHash('150000') }));
    assert.deepStrictEqual([renamed[K], OLD in renamed], ['180000', false], 'renamed this run: the old name\'s row says the stack wrote it');
    const typed = run({ [OLD]: '150000' }, ledgered({ [OLD]: valueHash('120000') }));
    assert.deepStrictEqual([typed[K], OLD in typed], ['150000', false], '... and a typed value under the old name moves and is kept');
});

test('settings-env: the SEEDS come from the catalog, absent-only, and never touch a set value', () =>
{
    const { env } = envPass({ ALFRED_CODE_INSTRUMENT: '1' });
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, '1', 'an absent-only seed overwrote a deliberate value');
    for (const row of CATALOG)
        if (!row.written && row.seed !== false && row.key !== 'ALFRED_CODE_DOCS_VERSIONING')
            assert.ok(row.key in env, `the catalog key ${row.key} was not seeded`);
});

test('settings-env: a seed:false row is never written', () =>
{
    const rows = CATALOG.filter((r) => r.seed === false);
    assert.ok(rows.some((r) => r.key === 'ALFRED_CODE_WORKSPACE'), 'the catalog carries the never-written row');
    const dir = path.join(TMP, `seedless-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: {} }));
    writeSettings({ file: path.join(dir, 'settings.json'), catalog: CATALOG, migrations: MIGRATIONS, docsVersioning: { seed: 'git' } });
    writeSettings({ file: path.join(dir, 'settings.local.json'), catalog: CATALOG, migrations: MIGRATIONS, inheritedEnv: {}, docsVersioning: { seed: 'git' } });
    for (const name of fs.readdirSync(dir))
        for (const row of rows)
            assert.ok(!fs.readFileSync(path.join(dir, name), 'utf8').includes(row.key), `${row.key} was written into ${name}`);
    // A value the user set at the catalog default is theirs: with no ledger, the default is no evidence the stack wrote it.
    const own = path.join(TMP, `seedless-${seq++}`, '.claude');
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '1' } }));
    const { result } = write(path.join(own, 'settings.json'), { docsVersioning: { seed: 'git' } });
    assert.ok(!Object.hasOwn(result.managed.env['settings.json'] || {}, 'ALFRED_CODE_WORKSPACE'), 'the ledger claimed a value the user set');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(own, 'settings.json'), 'utf8')).env.ALFRED_CODE_WORKSPACE, '1', 'the user\'s value stays');
});

// ------------------------------------------------------------------ a joined child (workspace roles and variables, D5)

const SC = 'ALFRED_CODE_SCORER';
const OFF = 'ALFRED_CODE_HOOKS_OFF';

test('settings-env: a joined child\'s copies leave its settings and its HOOKS_OFF loses the members\' part entries', () =>
{
    const file = settingsFile({ env: { [SC]: '1', ALFRED_CODE_HISTORY: '5', [OFF]: 'guard-ungated-commit:push,docs-session:gate' } });
    const { data } = write(file, { docsVersioning: { seed: 'git' }, childEnv: { ignored: [], copies: [SC], hooksOffDrop: ['guard-ungated-commit:push'] } });
    assert.ok(!Object.hasOwn(data.env, SC), 'the copy stayed');
    assert.strictEqual(data.env.ALFRED_CODE_HISTORY, '5', 'a key the plan does not name stays');
    assert.strictEqual(data.env[OFF], 'docs-session:gate');
});

test('settings-env: a joined child seeds no chained key - only DOCS_VERSIONING, the settings keys and its ignore env keys', () =>
{
    const file = settingsFile({});
    const { data } = write(file, { docsVersioning: { seed: 'git' }, childEnv: { ignored: ['ALFRED_CODE_HISTORY'], copies: [], hooksOffDrop: [] } });
    assert.ok(!Object.hasOwn(data.env, SC), 'a chained key was seeded over the chain');
    assert.strictEqual(data.env.ALFRED_CODE_HISTORY, '3', 'an ignore env key takes the catalog default');
    assert.strictEqual(data.env.ALFRED_CODE_DOCS_VERSIONING, 'git');
    assert.ok(Object.hasOwn(data.env, 'ALFRED_CODE_DATA_PATH') && Object.hasOwn(data.env, OFF), JSON.stringify(data.env));
});

test('settings-env: the retired sentry auth key goes, and the SENTRY_* keys stay', () =>
{
    const migrations = envMigrations(require('../meta/migrations.json'));
    const env = { ALFRED_CODE_SENTRY_AUTH: 'token', SENTRY_SLUG: 'acme', SENTRY_ACCESS_TOKEN: 'kept' };
    applyEnv(env, { catalog: CATALOG, migrations, log: () => {} });
    assert.ok(!('ALFRED_CODE_SENTRY_AUTH' in env), 'ALFRED_CODE_SENTRY_AUTH outlived the 2.0.0 cut');
    assert.strictEqual(env.SENTRY_SLUG, 'acme');
    assert.strictEqual(env.SENTRY_ACCESS_TOKEN, 'kept');
});

test('settings-env: docs versioning - the FLAG writes over a value, the seed only fills an absence', () =>
{
    assert.strictEqual(envPass({ ALFRED_CODE_DOCS_VERSIONING: 'git' }, { docsVersioning: { value: 'local' } })
        .env.ALFRED_CODE_DOCS_VERSIONING, 'local');
    assert.strictEqual(envPass({ ALFRED_CODE_DOCS_VERSIONING: 'git' }, { docsVersioning: { seed: 'local' } })
        .env.ALFRED_CODE_DOCS_VERSIONING, 'git', 'the absent-only seed overwrote a project\'s decision');
    assert.strictEqual(envPass({}, { docsVersioning: { seed: 'local' } })
        .env.ALFRED_CODE_DOCS_VERSIONING, 'local');
});

test('settings-env: HOOKS_OFF is absent-only UNLESS a walk answered the layer this run', () =>
{
    assert.strictEqual(envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-a' }).env.ALFRED_CODE_HOOKS_OFF, 'guard-a',
        'a plain run wiped the answer the user gave at install time');
    assert.strictEqual(envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-a' },
        { hooksAnswered: true, hooksOff: ['guard-b', 'guard-c'] }).env.ALFRED_CODE_HOOKS_OFF, 'guard-b,guard-c');
    assert.strictEqual(envPass({}, { hooksAnswered: true, hooksOff: [] }).env.ALFRED_CODE_HOOKS_OFF, '',
        'answering "keep every hook" must write the empty value, not skip the key');
});

// 2026-10-20: guard-answer-length became guard-answer. Left as stored, the prelude no longer matched the old name and a
// hook the user switched off ran again under the new one - the stored list is re-spelled, a walk's answer still wins.
test('settings-env: a renamed hook in a stored HOOKS_OFF is re-spelled, in the overlay too, and nothing else moves', () =>
{
    const renamedHooks = { 'guard-answer-length': 'guard-answer' };
    const a = envPass({ ALFRED_CODE_HOOKS_OFF: 'instrument-tool-usage, Guard-Answer-Length.js' }, { renamedHooks });
    assert.strictEqual(a.env.ALFRED_CODE_HOOKS_OFF, 'instrument-tool-usage,guard-answer');
    assert.ok(a.logs.some((m) => /re-spelled/.test(m)), a.logs.join(' | '));
    const overlay = { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' };
    envPass({}, { renamedHooks, overlay });
    assert.strictEqual(overlay.ALFRED_CODE_HOOKS_OFF, 'guard-answer', 'the local overlay holds the user\'s off');
    const b = envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-answer-lengthy,guard-a' }, { renamedHooks });
    assert.strictEqual(b.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-lengthy,guard-a', 'a near name is no match');
    assert.ok(!b.logs.some((m) => /re-spelled/.test(m)), 'an unchanged list logs nothing');
    assert.strictEqual(envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' }, { renamedHooks, hooksAnswered: true, hooksOff: ['guard-b'] })
        .env.ALFRED_CODE_HOOKS_OFF, 'guard-b', 'a walk that answered the layer still wins');
});

// ---- the agent off-list (Phase 8, T1) --------------------------------------------------------
// Spike S3 measured a denied seat costing -434 tokens less per session, which makes this the
// largest per-item trim the stack has. It writes into the SAME `permissions.deny` array as the
// secret-file blocks, so the two must not fight: a re-added seat clears only its own entry, and the
// project's own rules are never touched by either.

test('settings-writer: a dropped seat is denied, and the project keeps its own deny rules', () =>
{
    const file = settingsFile({ permissions: { deny: ['Agent(my-own-seat)', 'Read(./private)'] } });
    const { data } = write(file, {
        denySpecs: ['Read(./.env)'],
        agentDeny: ['Agent(alfred-code:evidence-gatherer)', 'Agent(alfred-code-aspnet:aspnet-verifier)'],
    });
    assert.ok(data.permissions.deny.includes('Agent(alfred-code:evidence-gatherer)'));
    assert.ok(data.permissions.deny.includes('Agent(alfred-code-aspnet:aspnet-verifier)'));
    assert.ok(data.permissions.deny.includes('Agent(my-own-seat)'), "the project's own Agent rule was dropped");
    assert.ok(data.permissions.deny.includes('Read(./private)'), "the project's own Read rule was dropped");
    assert.ok(data.permissions.deny.includes('Read(./.env)'), 'the secret blocks still land beside them');
});

test('settings-writer: a seat the selection now KEEPS has its deny cleared', () =>
{
    // The failure this prevents: a user adds a seat back through configure, the install enables its
    // plugin, and a stale deny from the previous run silently drops the seat they just asked for.
    const file = settingsFile({ permissions: { deny: ['Agent(alfred-code-aspnet:aspnet-verifier)', 'Agent(my-own-seat)'] } });
    const { data, logs } = write(file, { agentAllow: ['Agent(alfred-code-aspnet:aspnet-verifier)'] });
    assert.ok(!data.permissions.deny.includes('Agent(alfred-code-aspnet:aspnet-verifier)'));
    assert.ok(data.permissions.deny.includes('Agent(my-own-seat)'), 'clearing one entry cleared another');
    assert.ok(logs.some((m) => /aspnet-verifier/.test(m)), 'a silent clear is unauditable');
});

test('settings-writer: deny and allow for the same seat is a KEPT seat - the allow wins', () =>
{
    // Both lists come from one derivation, so this can only happen through a caller bug or a
    // hand-edited selection. Resolving it toward the seat WORKING is the safe direction: the other
    // way silently disables a seat the run just installed.
    const file = settingsFile({});
    const { data } = write(file, {
        agentDeny: ['Agent(alfred-code:evidence-gatherer)'],
        agentAllow: ['Agent(alfred-code:evidence-gatherer)'],
    });
    assert.deepStrictEqual(data.permissions.deny, []);
});

test('settings-writer: no agent lists means the deny array is left exactly as it was', () =>
{
    // A run holding no selection passes no agent lists, so it may not rewrite the seat state a user
    // chose - the same rule ALFRED_CODE_HOOKS_OFF follows.
    const file = settingsFile({ permissions: { deny: ['Agent(alfred-code:evidence-gatherer)'] } });
    const { data } = write(file, { denySpecs: ['Read(./.env)'] });
    assert.deepStrictEqual(data.permissions.deny, ['Agent(alfred-code:evidence-gatherer)', 'Read(./.env)']);
});

test('settings-writer: a seat that moved home loses its OLD stack spelling, whichever way it goes', () =>
{
    // The deny names the carrying plugin; a release that moves the seat changes the spelling. The
    // old entry then addresses nothing and would sit in the file forever.
    const file = settingsFile({ permissions: { deny: ['Agent(alfred-code-old:security-auditor)', 'Agent(alfred-code-old:evidence-gatherer)', 'Agent(my-own:security-auditor)'] } });
    const { data } = write(file, {
        agentDeny: ['Agent(alfred-code:security-auditor)'],
        agentAllow: ['Agent(alfred-code:evidence-gatherer)'],
    });
    assert.deepStrictEqual(data.permissions.deny, ['Agent(my-own:security-auditor)', 'Agent(alfred-code:security-auditor)']);
});

// I1/I2 (R47, fix round 1): settingsTarget is the one place that decides which file a run WRITES.
test('settingsTarget: local scope targets settings.local.json, every other scope targets settings.json', () =>
{
    const dir = path.join(TMP, `target-${seq++}`, '.claude');
    assert.strictEqual(settingsTarget(dir, 'local'), path.join(dir, 'settings.local.json'));
    assert.strictEqual(settingsTarget(dir, 'project'), path.join(dir, 'settings.json'));
    assert.strictEqual(settingsTarget(dir, 'user'), path.join(dir, 'settings.json'));
    // An unresolved/empty scope is never 'local' by accident - it lands on the shared file.
    assert.strictEqual(settingsTarget(dir, ''), path.join(dir, 'settings.json'));
});

// N5 (fix round 5): at local scope settings.local.json is laid over settings.json for the two keys the
// read-back uses, `env` and `deny`. R99 (Task 18b fix round 2): at project and user scope too, the stack
// keys settings.local.json holds are laid over settings.json, key by key - Claude Code applies them
// there, so a read-back blind to them showed a hook the user switched off as on. Only the stack's own
// env keys: every other entry (deny, hooks, a non-stack key) is the shared file's. `sharedOnly` is the
// shared file alone, for the readers that must not see the local file (the N6 inherited view, R98's
// docs root).
test('readBackSettings: local over shared for the stack keys at every scope, the full overlay at local scope (R99)', () =>
{
    const dir = path.join(TMP, `readback-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const sharedHooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'shared' }] }] };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        env: { ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared' },
        permissions: { deny: ['Agent(alfred-code:a)'], allow: ['Bash(ls:*)'] }, hooks: sharedHooks,
    }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
        env: { BOTH: 'local', LOCAL_ONLY: '1', ALFRED_CODE_HOOKS_OFF: 'guard-answer' },
        permissions: { deny: ['Agent(alfred-code:b)', 'Agent(alfred-code:a)'] }, hooks: { PreToolUse: [] },
    }));
    for (const scope of ['project', 'user'])
    {
        const r = readBackSettings(dir, scope);
        assert.deepStrictEqual(r.env, {
            ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared',
        }, `${scope}: the stack keys the local file holds win, nothing else of it is read`);
        assert.deepStrictEqual(r.permissions.deny, ['Agent(alfred-code:a)', 'Agent(alfred-code:b)'], `${scope}: deny is the shared file's plus the stack seat denies the local file holds (Task 22 I1)`);
        assert.deepStrictEqual(r.hooks, sharedHooks, `${scope}: hooks are the shared file's`);
        assert.deepStrictEqual(readBackSettings(dir, scope, { sharedOnly: true }).env,
            { ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared' }, `${scope}: sharedOnly reads settings.json alone`);
    }
    const merged = readBackSettings(dir, 'local');
    assert.deepStrictEqual(merged.env, {
        ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'local', LOCAL_ONLY: '1',
    });
    assert.deepStrictEqual(merged.permissions.deny, ['Agent(alfred-code:a)', 'Agent(alfred-code:b)']);
    assert.deepStrictEqual(merged.permissions.allow, ['Bash(ls:*)']);
    // A local key wins even when it is the empty list - Claude Code reads it the same way.
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: '' } }));
    assert.strictEqual(readBackSettings(dir, 'local').env.ALFRED_CODE_HOOKS_OFF, '');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer' } }));
    assert.strictEqual(readBackSettings(dir, 'project').env.ALFRED_CODE_HOOKS_OFF, '', 'the same at project scope');
    // Fail-soft: garbage in either file reads as empty, never a throw.
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    assert.deepStrictEqual(readBackSettings(dir, 'project'), { env: { ALFRED_CODE_HOOKS_OFF: '' } });
    assert.deepStrictEqual(readBackSettings(dir, 'project', { sharedOnly: true }), {});
    assert.strictEqual(readBackSettings(dir, 'local').env.ALFRED_CODE_HOOKS_OFF, '');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '[1]');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '0' } }));
    assert.deepStrictEqual(readBackSettings(dir, 'project'), { env: { ALFRED_CODE_PUSH_GATE: '0' } }, 'a malformed local file adds nothing');
    fs.rmSync(path.join(dir, 'settings.local.json'));
    assert.deepStrictEqual(readBackSettings(dir, 'user'), { env: { ALFRED_CODE_PUSH_GATE: '0' } }, 'no local file: the shared file as it is');
});

// R99 (Task 18b fix round 2): at project and user scope a stack key settings.local.json holds is the
// one Claude Code applies, so the run writes it THERE - an answered hooks layer, a decision, a
// migration - never into settings.json, where it would be shadowed and look applied. A key the local
// file lacks lands in settings.json as before, and a key it holds is never seeded into settings.json.
test('settings-writer: at project scope a write to a stack key settings.local.json holds goes to the local file (R99)', () =>
{
    const dir = path.join(TMP, `overlay-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const sharedFile = path.join(dir, 'settings.json');
    const localFile = path.join(dir, 'settings.local.json');
    fs.writeFileSync(sharedFile, JSON.stringify({ env: { TEAM: 'y' } }));
    fs.writeFileSync(localFile, JSON.stringify({
        env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000', ALFRED_CODE_DOCS_VERSIONING: 'local', ALFRED_CODE_CORRECTION_NUDGE_MODE: 'inject', MY_OWN: 'x' },
        permissions: { allow: ['Bash(ls)'] },
    }));
    const logs = [];
    const opts = {
        file: sharedFile, localFile, catalog: CATALOG, migrations: { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ['ALFRED_CODE_CORRECTION_NUDGE_MODE', 'ALFRED_CODE_CORRECTION_NUDGE']] },
        hooksOff: ['guard-answer', 'guard-secret-value'], hooksAnswered: true, docsVersioning: { value: 'git', seed: 'git' },
    };
    writeSettings({ ...opts, log: (m) => logs.push(m) });
    const shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    assert.deepStrictEqual(local.env, {
        ALFRED_CODE_HOOKS_OFF: 'guard-answer,guard-secret-value', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000',
        ALFRED_CODE_DOCS_VERSIONING: 'git', ALFRED_CODE_CORRECTION_NUDGE: 'inject', MY_OWN: 'x',
    }, 'the answer, the decision, the reseed and the rename land where the key applies');
    assert.deepStrictEqual(local.permissions, { allow: ['Bash(ls)'] }, 'nothing else of the local file is touched');
    for (const key of ['ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_DOCS_VERSIONING'])
        assert.ok(!(key in shared.env), `the decision on ${key} reached settings.json, where the local value shadows it`);
    // C6 (R101 N7): a SEED is absent-only against settings.json itself - what every teammate reads.
    assert.strictEqual(shared.env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, '180000');
    assert.strictEqual(shared.env.ALFRED_CODE_CORRECTION_NUDGE, 'log');
    assert.strictEqual(shared.env.ALFRED_CODE_HISTORY, '3', 'a key the local file lacks is seeded in settings.json as before');
    assert.strictEqual(shared.env.TEAM, 'y');
    const text = logs.join('\n');
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_HOOKS_OFF = guard-answer,guard-secret-value/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_CONTEXT_WINDOW_FOR_200K reset to 180000/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_CORRECTION_NUDGE_MODE renamed to ALFRED_CODE_CORRECTION_NUDGE/);
    assert.match(text, /settings\.json env: ALFRED_CODE_HISTORY seeded/);

    // Idempotent: a second run writes neither file.
    const before = [fs.readFileSync(sharedFile, 'utf8'), fs.readFileSync(localFile, 'utf8')];
    assert.strictEqual(writeSettings(opts).written, false);
    assert.deepStrictEqual([fs.readFileSync(sharedFile, 'utf8'), fs.readFileSync(localFile, 'utf8')], before);

    // A malformed local file is no overlay: named once, and settings.json takes the writes.
    fs.writeFileSync(localFile, '{ nope');
    const notes = [];
    writeSettings({ ...opts, note: (m) => notes.push(m) });
    assert.match(notes.join('\n'), /settings\.local\.json is not valid JSON/);
    assert.strictEqual(fs.readFileSync(localFile, 'utf8'), '{ nope', 'a malformed local file is left untouched');
    assert.strictEqual(JSON.parse(fs.readFileSync(sharedFile, 'utf8')).env.ALFRED_CODE_HOOKS_OFF, 'guard-answer,guard-secret-value');
});

// N6 (Task 16b): at local scope settings.json still applies beneath the file this run writes, so a key
// it holds is PRESENT for every absent-only seed - the catalog seeds, the docs-versioning seed and the
// unanswered ALFRED_CODE_HOOKS_OFF seed. A local default would hide it. What the run DECIDES (an
// answered hooks layer, --docs-versioning) still lands in the local file.
test('settings-env: an inherited key counts as present for every absent-only seed, never for a decision (N6)', () =>
{
    const inherited = {
        ALFRED_CODE_DOCS_PATH: 'docs/gen', ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_HISTORY: '0', ALFRED_CODE_TURN_CHECK: '1',
        ALFRED_CODE_DOCS_VERSIONING: 'local', ALFRED_CODE_HOOKS_OFF: 'guard-answer',
    };
    const { env } = envPass({}, { inherited, docsVersioning: { seed: 'git' } });
    for (const key of Object.keys(inherited)) assert.ok(!(key in env), `N6: ${key} was seeded over the inherited '${inherited[key]}'`);
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, '0', 'a key the inherited view lacks is still seeded');

    // A renamed spelling there is the same key: renamed on read, so the new spelling is not seeded over it.
    const renamed = envPass({}, { inherited: { ALFRED_CODE_GATE_PUSH: '0', ALFRED_CODE_DOCS_DIR: 'docs/old' }, migrations: { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ['ALFRED_CODE_GATE_PUSH', 'ALFRED_CODE_PUSH_GATE']] } }).env;
    assert.ok(!('ALFRED_CODE_PUSH_GATE' in renamed) && !('ALFRED_CODE_DOCS_PATH' in renamed), JSON.stringify(renamed));

    // Decisions still write the local file.
    const decided = envPass({}, { inherited, hooksOff: ['check-turn-build'], hooksAnswered: true, docsVersioning: { value: 'git' } }).env;
    assert.strictEqual(decided.ALFRED_CODE_HOOKS_OFF, 'check-turn-build');
    assert.strictEqual(decided.ALFRED_CODE_DOCS_VERSIONING, 'git');

    // A malformed inherited view (not an object) is no view: every seed lands, as before.
    for (const bad of [null, 'x', ['a']])
        assert.strictEqual(envPass({}, { inherited: bad }).env.ALFRED_CODE_HISTORY, '3');
});

test('settings-writer: writeSettings passes inheritedEnv through - the local file never shadows the shared value (N6)', () =>
{
    const dir = path.join(TMP, `inherit-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const shared = { env: { ALFRED_CODE_DOCS_PATH: 'docs/gen', ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_HOOKS_OFF: 'guard-answer' } };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(shared));
    writeSettings({ file: path.join(dir, 'settings.local.json'), catalog: CATALOG, migrations: MIGRATIONS, inheritedEnv: shared.env, docsVersioning: { seed: 'git' } });
    const env = readBackSettings(dir, 'local').env;
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'docs/gen');
    assert.strictEqual(env.ALFRED_CODE_PUSH_GATE, '0');
    assert.strictEqual(env.ALFRED_CODE_HOOKS_OFF, 'guard-answer');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), shared, 'settings.json was written');
});

// R54 M6: a local-scope run writes settings.local.json, so a log line saying `settings.json` named a
// file the run never touched. Every line names the file it wrote.
test('settings-writer: every log line names the file the run writes (M6)', () =>
{
    const dir = path.join(TMP, `label-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const logs = [];
    writeSettings({
        file: path.join(dir, 'settings.local.json'), catalog: CATALOG, migrations: MIGRATIONS,
        agentDeny: ['Agent(alfred-code:evidence-gatherer)'], memoryDb: '/db', log: (m) => logs.push(m),
    });
    assert.ok(logs.length > 3, logs.join('\n'));
    assert.deepStrictEqual(logs.filter((l) => /settings\.json/.test(l)), [], 'a line names settings.json at local scope');
    assert.ok(logs.every((l) => /settings\.local\.json/.test(l)), logs.join('\n'));
    // The shared file keeps its own name.
    const shared = [];
    writeSettings({ file: path.join(dir, 'settings.json'), catalog: CATALOG, migrations: MIGRATIONS, log: (m) => shared.push(m) });
    assert.ok(shared.length && shared.every((l) => /settings\.json/.test(l)), shared.join('\n'));
    // A malformed local file is named as itself too.
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{ nope');
    const notes = [];
    writeSettings({ file: path.join(dir, 'settings.local.json'), catalog: CATALOG, note: (m) => notes.push(m) });
    assert.match(notes.join('\n'), /^settings\.local\.json is not valid JSON/);
});

// R78 (Task 16 round 5) and R96 (Task 18b fix round 1): a local install moved to project or user
// scope. The stack's seat denies move into settings.json; its env keys NEVER do - settings.json is the
// committed file, and a value the user set locally is personal. A local key still holding the stack's
// own seed (or a key the stack writes every run) is the stack's stale copy and goes; any other value
// stays in settings.local.json, untouched, logged once.
// Fix round 2: N2 - ANY seed the stack shipped counts (a seed can hold a list: the current one and each
// value a reseed migration names), or a seed a later release changed survives the move as 'your
// value'. N3 - a kept value is logged by its length only, whatever the key's name: a value is the
// user's, and it can carry a credential under a key that does not look like one.
test('leaveLocalScope: seed-valued stack keys leave, a value the user set stays local, seat denies move (R78, R96, N2, N3)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const cmd = hookCommand('guard-catastrophic-rm.js').command;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_CORRECTION_NUDGE: 'inject', TEAM: 'y' }, permissions: { deny: ['Read(secret)'] } }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
        env: {
            ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_HOOKS_OFF: 'guard-answer',
            ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/other-repo', ALFRED_CODE_API_TOKEN: 'abc123',
            ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log', ALFRED_CODE_TURN_CHECK: 0,
            ALFRED_CODE_MEMORY_DB: '/elsewhere/.memory-mcp/memory.db', MY_OWN: 'x',
            ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000', ALFRED_CODE_REPO_URL: 'https://user:tok3n@host/fork',
        },
        permissions: { allow: ['Bash(ls)'], deny: ['Agent(alfred-code:evidence-gatherer)', 'Read(.env)', 'Bash(rm:*)'] },
        enabledMcpjsonServers: ['serena', 'mine'],
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
        autoMemoryEnabled: false,
    }));
    const seeds = { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log', ALFRED_CODE_TURN_CHECK: '0',
        ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: ['180000', '150000'] };
    const opts = { claudeDir: dir, hookFiles: ['guard-catastrophic-rm.js'], mcpNames: ['serena'], denySpecs: ['Read(.env)'], seeds, written: ['ALFRED_CODE_MEMORY_DB'] };
    const logs = [];
    const out = leaveLocalScope({ ...opts, log: (m) => logs.push(m) });
    assert.strictEqual(out.moved, true);
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    const shared = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.deepStrictEqual(local.env, {
        ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_HOOKS_OFF: 'guard-answer',
        ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/other-repo', ALFRED_CODE_API_TOKEN: 'abc123', ALFRED_CODE_TURN_CHECK: 0, MY_OWN: 'x',
        ALFRED_CODE_REPO_URL: 'https://user:tok3n@host/fork', ALFRED_CODE_MEMORY_DB: '/elsewhere/.memory-mcp/memory.db',
    }, 'a value the user set stays local, untouched; a seed-valued key (an older shipped seed too) leaves; the machine\'s memory path stays (C8)');
    assert.deepStrictEqual(shared.env, { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_CORRECTION_NUDGE: 'inject', TEAM: 'y' }, 'no env key ever moves into settings.json');
    assert.deepStrictEqual(local.permissions, { allow: ['Bash(ls)'], deny: ['Bash(rm:*)'] });
    assert.deepStrictEqual(local.enabledMcpjsonServers, ['mine']);
    assert.deepStrictEqual(local.hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] });
    assert.strictEqual(local.autoMemoryEnabled, false, 'a key the stack does not own by name is left alone');
    assert.deepStrictEqual(shared.permissions.deny, ['Read(secret)', 'Agent(alfred-code:evidence-gatherer)', 'Read(.env)']);
    const text = logs.join('\n');
    // Each kept key is logged once, by its length only - the local value applies.
    assert.match(text, /settings\.local\.json: ALFRED_CODE_HOOKS_OFF stays here \(your value, 12 chars\) - it applies over settings\.json/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_PUSH_GATE stays here \(your value, 1 chars\) - it applies over settings\.json/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_ALLOW_WRITE_OUTSIDE stays here \(your value, 21 chars\)/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_API_TOKEN stays here \(your value, 6 chars\)/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_REPO_URL stays here \(your value, 28 chars\)/);
    assert.strictEqual((text.match(/ALFRED_CODE_HOOKS_OFF/g) || []).length, 1, 'logged once');
    for (const value of ['guard-answer', '/elsewhere/other-repo', 'abc123', 'tok3n', 'docs/mine'])
        assert.ok(!text.includes(value), `a kept value reached the log: ${value}`);
    // C18 (R98): the removed seeds are ONE line - a count and the keys - never a line per key.
    assert.match(text, /^  settings\.local\.json: 3 stack env keys removed - each held the stack's own seed, so settings\.json's value or its seed applies from here on: ALFRED_CODE_INSTRUMENT, ALFRED_CODE_CORRECTION_NUDGE, ALFRED_CODE_CONTEXT_WINDOW_FOR_200K$/m);
    assert.strictEqual(logs.filter((l) => / removed/.test(l)).length, 1, logs.join('\n'));
    // C8: the memory path lives in settings.local.json at every scope, so the move leaves it silently.
    assert.doesNotMatch(text, /MEMORY_DB/);

    // Idempotent: a second move finds nothing to carry and writes nothing.
    const before = fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8');
    const again = [];
    assert.strictEqual(leaveLocalScope({ ...opts, log: (m) => again.push(m) }).moved, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), before);
});

// Matrix OBS-A (2.0.0): after a local -> project move the stack's own attribution block stayed in
// settings.local.json, where it overrides a value the team later sets in settings.json.
test('leaveLocalScope: the stack\'s attribution and worktree seeds leave the local file, the user\'s own values stay', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const put = (local) => { fs.writeFileSync(path.join(dir, 'settings.json'), '{}'); fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify(local)); };
    const localNow = () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    put({ attribution: { commit: '', pr: '', sessionUrl: false }, worktree: { baseRef: 'head' }, MINE: 1 });
    const logs = [];
    leaveLocalScope({ claudeDir: dir, log: (m) => logs.push(m) });
    assert.deepStrictEqual(localNow(), { MINE: 1 }, 'no ledger: the seed values are the stack\'s');
    assert.match(logs.join('\n'), /settings seeds removed - [^\n]*: attribution\.commit, attribution\.pr, attribution\.sessionUrl, worktree\.baseRef$/m);

    put({ attribution: { commit: 'Team X', pr: '' }, worktree: { baseRef: 'fresh', bgIsolation: 'none' } });
    leaveLocalScope({ claudeDir: dir, log: () => {} });
    assert.deepStrictEqual(localNow(), { attribution: { commit: 'Team X' }, worktree: { baseRef: 'fresh', bgIsolation: 'none' } }, 'a value the user set stays');

    put({ attribution: { commit: '', pr: '' } });
    leaveLocalScope({ claudeDir: dir, ledgerSettings: { 'attribution.pr': valueHash('""') }, log: () => {} });
    assert.deepStrictEqual(localNow(), { attribution: { commit: '' } }, 'with a ledger only what it lists goes - the user typed commit');
});

test('leaveLocalScope: no local file, a malformed one, or a malformed settings.json moves nothing (R78)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    assert.strictEqual(leaveLocalScope({ claudeDir: dir }).moved, false, 'no local file');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{ nope');
    const notes = [];
    assert.strictEqual(leaveLocalScope({ claudeDir: dir, note: (m) => notes.push(m) }).moved, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), '{ nope', 'a malformed local file is left untouched');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '0' } }));
    fs.writeFileSync(path.join(dir, 'settings.json'), '[1]');
    assert.strictEqual(leaveLocalScope({ claudeDir: dir, note: (m) => notes.push(m) }).moved, false);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')), { env: { ALFRED_CODE_PUSH_GATE: '0' } }, 'nothing leaves a file that cannot receive it');
    assert.strictEqual(notes.length, 2, notes.join('\n'));
});

// Task 8a concern 2: the rename pass logged 'renamed' for every old key it removed, also when the new
// key already held a value (which wins) or the old one was empty (nothing moves) - the log now says
// what actually happened to each.
test('settings-writer env: the rename log says renamed only when the value moved', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_CORRECTION_NUDGE_MODE: 'log', ALFRED_CODE_CORRECTION_NUDGE: 'inject', ALFRED_CODE_GATE_PUSH: '', ALFRED_CODE_ASK_ROTATE: '0' } });
    const renames = [['ALFRED_CODE_CORRECTION_NUDGE_MODE', 'ALFRED_CODE_CORRECTION_NUDGE'], ['ALFRED_CODE_GATE_PUSH', 'ALFRED_CODE_PUSH_GATE'], ['ALFRED_CODE_ASK_ROTATE', 'ALFRED_CODE_ROTATE_ASK']];
    const { logs, data } = write(file, { migrations: { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ...renames] } });
    const text = logs.join('\n');
    assert.strictEqual(data.env.ALFRED_CODE_CORRECTION_NUDGE, 'inject', 'the new key wins');
    assert.strictEqual(data.env.ALFRED_CODE_ROTATE_ASK, '0');
    assert.match(text, /settings\.json env: ALFRED_CODE_ASK_ROTATE renamed to ALFRED_CODE_ROTATE_ASK/);
    assert.doesNotMatch(text, /ALFRED_CODE_CORRECTION_NUDGE_MODE renamed/);
    assert.match(text, /settings\.json env: ALFRED_CODE_CORRECTION_NUDGE_MODE dropped - ALFRED_CODE_CORRECTION_NUDGE is already set and wins/);
    assert.doesNotMatch(text, /ALFRED_CODE_GATE_PUSH renamed/);
    assert.match(text, /settings\.json env: ALFRED_CODE_GATE_PUSH dropped - it was empty/);
});

// Two settings files in one .claude dir, for the project-scope cases below.
function pair(shared, local)
{
    const dir = path.join(TMP, `pair-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const sharedFile = path.join(dir, 'settings.json');
    const localFile = path.join(dir, 'settings.local.json');
    if (shared !== undefined) fs.writeFileSync(sharedFile, JSON.stringify(shared));
    if (local !== undefined) fs.writeFileSync(localFile, JSON.stringify(local));
    const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined);
    return { dir, sharedFile, localFile, shared: () => read(sharedFile), local: () => read(localFile) };
}

// C6 (R101 N7): a stack key the runner's settings.local.json holds is still SEEDED into the committed
// settings.json - absent-only against settings.json itself. The shadowed seed costs the runner nothing
// and is what every teammate reads; before, the committed file depended on who ran the install.
test('settings-writer: at project scope a key settings.local.json holds is still seeded into settings.json, and the local value is untouched (C6)', () =>
{
    const p = pair({ env: { TEAM: 'y' } }, { env: { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '200000', ALFRED_CODE_CORRECTION_NUDGE: 'inject', ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_DOCS_VERSIONING: 'local' } });
    const logs = [];
    writeSettings({ file: p.sharedFile, localFile: p.localFile, catalog: CATALOG, migrations: MIGRATIONS, docsVersioning: { seed: 'git' }, log: (m) => logs.push(m) });
    const shared = p.shared().env;
    assert.strictEqual(shared.ALFRED_CODE_CONTEXT_WINDOW_DEFAULT, '180000', 'the committed file lacks the seed because the runner holds a personal value');
    assert.strictEqual(shared.ALFRED_CODE_CORRECTION_NUDGE, 'log');
    assert.strictEqual(shared.ALFRED_CODE_HOOKS_OFF, '', 'the unanswered HOOKS_OFF seed');
    assert.strictEqual(shared.ALFRED_CODE_DOCS_VERSIONING, 'git', 'the docs-versioning seed');
    assert.deepStrictEqual(p.local().env, { ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '200000', ALFRED_CODE_CORRECTION_NUDGE: 'inject', ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_DOCS_VERSIONING: 'local' });
    assert.match(logs.join('\n'), /settings\.json env: ALFRED_CODE_CORRECTION_NUDGE seeded \(log\)/);
    // Idempotent.
    const before = [fs.readFileSync(p.sharedFile, 'utf8'), fs.readFileSync(p.localFile, 'utf8')];
    assert.strictEqual(writeSettings({ file: p.sharedFile, localFile: p.localFile, catalog: CATALOG, migrations: MIGRATIONS, docsVersioning: { seed: 'git' } }).written, false);
    assert.deepStrictEqual([fs.readFileSync(p.sharedFile, 'utf8'), fs.readFileSync(p.localFile, 'utf8')], before);
});

// C4 (R133 N1): at project or user scope `--add agent X` for a seat denied ONLY in settings.local.json
// took nothing and said nothing - the local deny applies over the shared file. The allow drops it there.
test('settings-writer: an allowed seat leaves settings.local.json\'s deny list too, with a line (C4)', () =>
{
    const seat = 'Agent(alfred-code:evidence-gatherer)';
    const p = pair({ permissions: { deny: ['Read(secret)'] } }, { permissions: { deny: [seat, 'Bash(rm:*)'], allow: ['Bash(ls)'] } });
    const logs = [];
    writeSettings({ file: p.sharedFile, localFile: p.localFile, catalog: CATALOG, migrations: MIGRATIONS, agentAllow: [seat], log: (m) => logs.push(m) });
    assert.deepStrictEqual(p.local().permissions, { deny: ['Bash(rm:*)'], allow: ['Bash(ls)'] }, 'the local deny still keeps the seat off');
    assert.deepStrictEqual(p.shared().permissions.deny, ['Read(secret)']);
    assert.match(logs.join('\n'), /settings\.local\.json: agent allowed again Agent\(alfred-code:evidence-gatherer\)/);
    // A list the drop empties goes, and a re-run writes nothing.
    const q = pair({}, { permissions: { deny: [seat] } });
    writeSettings({ file: q.sharedFile, localFile: q.localFile, catalog: CATALOG, migrations: MIGRATIONS, agentAllow: [seat] });
    assert.deepStrictEqual(q.local(), {});
    const before = fs.readFileSync(q.localFile, 'utf8');
    writeSettings({ file: q.sharedFile, localFile: q.localFile, catalog: CATALOG, migrations: MIGRATIONS, agentAllow: [seat] });
    assert.strictEqual(fs.readFileSync(q.localFile, 'utf8'), before);
});

// alfred-git forbids AI attribution in commits and PRs; the `attribution` setting enforces it (code.claude.com
// settings reference: `commit` / `pr` strings, empty hides; `sessionUrl` false omits the session link).
test('settings-writer: attribution is seeded off, key by key, never over a value the project set', () =>
{
    const fresh = write(settingsFile({}), { attribution: {} }).data;
    assert.deepStrictEqual(fresh.attribution, { commit: '', pr: '', sessionUrl: false });

    const mine = write(settingsFile({ attribution: { commit: 'Signed-off-by: me' } }), { attribution: {} }).data;
    assert.deepStrictEqual(mine.attribution, { commit: 'Signed-off-by: me', pr: '', sessionUrl: false });

    const odd = write(settingsFile({ attribution: 'x' }), { attribution: {} }).data;
    assert.strictEqual(odd.attribution, 'x', 'a value that is not an object is the user\'s - left as-is');
});

test('settings-writer: attribution at local scope never hides a settings.json value', () =>
{
    const { data } = write(settingsFile({}), { attribution: { inherited: { pr: 'team line' } } });
    assert.deepStrictEqual(data.attribution, { commit: '', sessionUrl: false });
});

test('settings-writer: attribution seeding is idempotent, and absent when not asked for', () =>
{
    const file = settingsFile({});
    write(file, { attribution: {} });
    const before = fs.readFileSync(file, 'utf8');
    const again = write(file, { attribution: {} });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.ok(!again.logs.some((m) => /attribution/.test(m)), again.logs.join(' | '));
    assert.strictEqual(write(settingsFile({}), {}).data.attribution, undefined);
});

// R6: a seat dispatched with isolation 'worktree' branches from the remote default branch unless
// `worktree.baseRef` is "head" (code.claude.com/docs/en/worktrees) - the stack seeds "head", add-only.
test('settings-writer: worktree.baseRef is seeded "head", never over a value the project set, other worktree keys kept', () =>
{
    const fresh = write(settingsFile({}), { worktreeBase: {} });
    assert.deepStrictEqual(fresh.data.worktree, { baseRef: 'head' });
    assert.ok(fresh.logs.some((m) => /worktree\.baseRef head/.test(m)), fresh.logs.join(' | '));

    assert.deepStrictEqual(write(settingsFile({ worktree: { baseRef: 'fresh' } }), { worktreeBase: {} }).data.worktree, { baseRef: 'fresh' }, 'the project chose fresh');
    assert.deepStrictEqual(write(settingsFile({ worktree: { bgIsolation: 'none' } }), { worktreeBase: {} }).data.worktree, { bgIsolation: 'none', baseRef: 'head' });
    assert.strictEqual(write(settingsFile({ worktree: 'x' }), { worktreeBase: {} }).data.worktree, 'x', 'a value that is not an object is the user\'s - left as-is');
    assert.deepStrictEqual(write(settingsFile({ worktree: ['head'] }), { worktreeBase: {} }).data.worktree, ['head']);
});

test('settings-writer: worktree.baseRef at local scope never hides a settings.json value; idempotent; absent when not asked for', () =>
{
    assert.strictEqual(write(settingsFile({}), { worktreeBase: { inherited: { baseRef: 'fresh' } } }).data.worktree, undefined, 'settings.json holds the choice');
    assert.deepStrictEqual(write(settingsFile({}), { worktreeBase: { inherited: { bgIsolation: 'none' } } }).data.worktree, { baseRef: 'head' });
    const file = settingsFile({});
    write(file, { worktreeBase: {} });
    const before = fs.readFileSync(file, 'utf8');
    const again = write(file, { worktreeBase: {} });
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.ok(!again.logs.some((m) => /worktree/.test(m)), again.logs.join(' | '));
    assert.strictEqual(write(settingsFile({}), {}).data.worktree, undefined);
});

// --- R10 THE LEDGER -----------------------------------------------------------------------------
// The run records what it MANAGES: each env key it wrote (a hash of the value, per file), each deny
// entry, each hook wiring. What a prior run recorded and this release no longer writes goes; a value
// changed since it was written is the user's - kept, logged once, and out of the ledger from then on.
// A stamp with no ledger (an older release) is adopted by the values the stack itself shipped.
const { valueHash } = require('./install/stamp.js');
const idOf = (event, matcher, file, args) => valueHash(`${event}\u0000${matcher}\u0000${hookCommand(file, args).command}`);
const noLedger = { env: {}, deny: [], hooks: [] };

test('settings-ledger: a fresh write records the keys it seeded, the deny entries it added and the hooks it wired (R10)', () =>
{
    const file = settingsFile();
    const { result } = write(file, {
        hookSpecs: [HOOK('guard-a.js', 'Bash'), HOOK('guard-a.js', '@Stop')], denySpecs: ['Read(.env)'],
        ledger: { prior: null, releaseHooks: ['guard-a.js::Bash::', 'guard-a.js::@Stop::'] },
    });
    const env = result.managed.env['settings.json'];
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, valueHash('0'));
    assert.strictEqual(env.ALFRED_CODE_HOOKS_OFF, valueHash(''));
    assert.deepStrictEqual(result.managed.deny, [{ file: 'settings.json', entry: 'Read(.env)' }]);
    assert.deepStrictEqual(result.managed.hooks.map((h) => [h.hook, h.id]).sort(),
        [['guard-a.js', idOf('PreToolUse', 'Bash', 'guard-a.js')], ['guard-a.js', idOf('Stop', '', 'guard-a.js')]].sort());
});

test('settings-ledger: the user\'s own key, deny entry and hook are never managed - with a ledger, an unlisted value stays theirs (R10)', () =>
{
    const file = settingsFile({
        env: { ALFRED_CODE_INSTRUMENT: '0', MY_KEY: 'x' },
        permissions: { deny: ['Read(.env)', 'Bash(rm:*)'] },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node mine.js' }] }] },
    });
    const { result, data } = write(file, { denySpecs: ['Read(.env)'], ledger: { prior: noLedger, releaseHooks: [] } });
    const env = result.managed.env['settings.json'];
    assert.ok(!('ALFRED_CODE_INSTRUMENT' in env), 'it was there before the stack wrote anything, at the same value');
    assert.ok(!('MY_KEY' in env));
    assert.strictEqual(env.ALFRED_CODE_HISTORY, valueHash('3'), 'a key seeded this run is the stack\'s');
    assert.deepStrictEqual(result.managed.deny, [], 'an entry already there is the project\'s');
    assert.deepStrictEqual(result.managed.hooks, []);
    assert.deepStrictEqual(data.hooks.Stop, [{ hooks: [{ type: 'command', command: 'node mine.js' }] }]);
});

test('settings-ledger: a managed value changed since it was written is the user\'s - kept, logged once, out of the ledger (R10)', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_INSTRUMENT: '1' } });
    const prior = { env: { 'settings.json': { ALFRED_CODE_INSTRUMENT: valueHash('0') } }, deny: [], hooks: [] };
    const { result, data, logs } = write(file, { ledger: { prior, releaseHooks: [] } });
    assert.strictEqual(data.env.ALFRED_CODE_INSTRUMENT, '1');
    assert.ok(!('ALFRED_CODE_INSTRUMENT' in result.managed.env['settings.json']));
    assert.match(logs.join('\n'), /settings\.json env: ALFRED_CODE_INSTRUMENT changed since the stack wrote it - yours from here on, kept \(1 chars\)/);
    const again = write(file, { ledger: { prior: { ...noLedger, env: result.managed.env }, releaseHooks: [] } });
    assert.doesNotMatch(again.logs.join('\n'), /ALFRED_CODE_INSTRUMENT/, 'said once: the next run no longer lists it');
});

test('settings-ledger: what the prior run wrote and this release no longer writes goes; an edited value stays (R10)', () =>
{
    const old = hookCommand('old-hook.js').command;
    const file = settingsFile({
        env: { ALFRED_CODE_GONE: 'a', ALFRED_CODE_EDITED: 'b-edited', MY_KEY: 'x' },
        permissions: { deny: ['Read(*.old)', 'Bash(rm:*)'] },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: old, timeout: 10 }] }, { hooks: [{ type: 'command', command: 'node mine.js' }] }] },
    });
    const prior = {
        env: { 'settings.json': { ALFRED_CODE_GONE: valueHash('a'), ALFRED_CODE_EDITED: valueHash('b'), MY_KEY: valueHash('x') } },
        // Bash(rm:*) is no entry the stack ever shipped: a stamp is project text, so its ledger never
        // names a deny rule of the user's for removal.
        deny: [{ file: 'settings.json', entry: 'Read(*.old)' }, { file: 'settings.json', entry: 'Bash(rm:*)' }],
        hooks: [{ file: 'settings.json', hook: 'old-hook.js', id: idOf('Stop', '', 'old-hook.js') }],
    };
    const { data, logs, result } = write(file, { denySpecs: ['Read(.env)'], ledger: { prior, releaseHooks: [], shippedDeny: ['Read(.env)', 'Read(*.old)'] } });
    assert.ok(!('ALFRED_CODE_GONE' in data.env), 'a managed key the catalog no longer ships goes');
    assert.strictEqual(data.env.ALFRED_CODE_EDITED, 'b-edited', 'an edited one stays');
    assert.strictEqual(data.env.MY_KEY, 'x');
    assert.deepStrictEqual(data.permissions.deny, ['Bash(rm:*)', 'Read(.env)']);
    assert.deepStrictEqual(data.hooks.Stop, [{ hooks: [{ type: 'command', command: 'node mine.js' }] }]);
    const text = logs.join('\n');
    assert.match(text, /settings\.json env: ALFRED_CODE_GONE removed - the stack wrote it and this release no longer does/);
    assert.match(text, /settings\.json env: ALFRED_CODE_EDITED kept - changed since the stack wrote it, so it is yours \(8 chars\)/);
    assert.match(text, /settings\.json: deny Read\(\*\.old\) removed - the stack wrote it and this release no longer does/);
    assert.match(text, /settings\.json: hook wiring old-hook\.js \(Stop\) removed - the stack wired it and this release no longer does/);
    assert.ok(!('ALFRED_CODE_EDITED' in result.managed.env['settings.json']));
});

test('settings-ledger: a stamp with no ledger adopts what the stack itself shipped, and nothing else (R10 fallback)', () =>
{
    const cmd = hookCommand('guard-a.js').command;
    const file = settingsFile({
        env: { ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000', MY_KEY: 'x' },
        permissions: { deny: ['Read(.env)', 'Agent(alfred-code:angular-verifier)', 'Bash(rm:*)'] },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd, timeout: 10 }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'node mine.js' }] }] },
    });
    const { result } = write(file, {
        hookSpecs: [HOOK('guard-a.js', 'Bash')], denySpecs: ['Read(.env)'],
        ledger: { prior: null, releaseHooks: ['guard-a.js::Bash::'] },
    });
    const env = result.managed.env['settings.json'];
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, valueHash('0'), 'at the catalog seed: the stack\'s');
    assert.ok(!('ALFRED_CODE_PUSH_GATE' in env), 'a value the stack never shipped is the user\'s');
    assert.strictEqual(env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, valueHash('180000'), 'reseeded this run: written by the stack');
    assert.ok(!('MY_KEY' in env));
    // Review finding 6: with no ledger a secret-file deny already there may be the team's, so it is never
    // claimed - a leftover after uninstall is harmless, a removed one is not. A stack seat still is.
    assert.deepStrictEqual(result.managed.deny.map((d) => d.entry).sort(), ['Agent(alfred-code:angular-verifier)']);
    assert.deepStrictEqual(result.managed.hooks.map((h) => h.id), [idOf('PreToolUse', 'Bash', 'guard-a.js')]);
});

// Review finding 1: a ledger entry claims the entry in the file it was recorded for, never the same
// string another file already held.
test('settings-ledger: a deny the ledger recorded in settings.local.json never claims the same entry settings.json held', () =>
{
    const file = settingsFile({ permissions: { deny: ['Read(.env)'] } });
    const prior = { ...noLedger, deny: [{ file: 'settings.local.json', entry: 'Read(.env)' }] };
    const { result } = write(file, { denySpecs: ['Read(.env)'], ledger: { prior, releaseHooks: [] } });
    assert.deepStrictEqual(result.managed.deny, []);
});

// Review finding 5: a settings.local.json the run could not read was not written, so the deny rows the
// last run recorded there stand unchanged.
test('settings-ledger: an unreadable settings.local.json keeps the deny rows the ledger recorded there', () =>
{
    const file = settingsFile({});
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, '{ broken');
    const row = { file: 'settings.local.json', entry: 'Agent(alfred-code:angular-verifier)' };
    const { result } = write(file, { localFile, ledger: { prior: { ...noLedger, deny: [row] }, releaseHooks: [] } });
    assert.deepStrictEqual(result.managed.deny.filter((d) => d.file === 'settings.local.json'), [row]);
});

test('leaveLocalScope: the ledger\'s moved denies follow them into settings.json only where settings.json did not hold them before', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)', 'Bash(rm:*)'] } }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ permissions: { deny: ['Read(.env)', 'Read(.env.*)', 'Read(*.key)'] } }));
    const ledgerDeny = [
        { file: 'settings.local.json', entry: 'Read(.env)' }, { file: 'settings.local.json', entry: 'Read(.env.*)' },
        { file: 'settings.json', entry: 'Agent(alfred-code:angular-verifier)' },
    ];
    const moved = leaveLocalScope({ claudeDir: dir, denySpecs: ['Read(.env)', 'Read(.env.*)', 'Read(*.key)'], ledgerDeny });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).permissions.deny, ['Read(.env)', 'Bash(rm:*)', 'Read(.env.*)', 'Read(*.key)']);
    assert.deepStrictEqual(moved.ledgerDeny, [
        { file: 'settings.json', entry: 'Agent(alfred-code:angular-verifier)' }, { file: 'settings.json', entry: 'Read(.env.*)' },
    ], 'Read(.env) was the team\'s in settings.json before the move; Read(*.key) was never the ledger\'s');
});

test('settings-ledger: at project scope a key the run writes into settings.local.json is managed there, the user\'s local key is not (R10, R99)', () =>
{
    const file = settingsFile({});
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-x', ALFRED_CODE_PUSH_GATE: '0' } }));
    const { result } = write(file, { localFile, hooksOff: ['guard-y'], hooksAnswered: true, ledger: { prior: noLedger, releaseHooks: [] } });
    assert.deepStrictEqual(result.managed.env['settings.local.json'], { ALFRED_CODE_HOOKS_OFF: valueHash('guard-y') }, 'the answered hooks layer goes back to the local file that held it');
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8')).env;
    assert.deepStrictEqual([local.ALFRED_CODE_HOOKS_OFF, local.ALFRED_CODE_PUSH_GATE], ['guard-y', '0'], 'R99: the user\'s own local value still applies, unmanaged');
});

test('leaveLocalScope: with a ledger, the ledger decides - a local key at a seed the stack never wrote stays, one it wrote goes (R96 over R10)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'inject' } }));
    const seeds = { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log' };
    const ledgerEnv = { ALFRED_CODE_INSTRUMENT: valueHash('0'), ALFRED_CODE_CORRECTION_NUDGE: valueHash('log') };
    const logs = [];
    leaveLocalScope({ claudeDir: dir, seeds, ledgerEnv, log: (m) => logs.push(m) });
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.deepStrictEqual(local.env, { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_CORRECTION_NUDGE: 'inject' },
        'PUSH_GATE is at the seed but the stack never wrote it here - the user set it; MONITOR was edited since');
    assert.match(logs.join('\n'), /1 stack env key removed - each held the stack's own seed.*: ALFRED_CODE_INSTRUMENT$/m);
});

// Uninstall's settings half: exactly what the ledger lists, at the value it recorded - never the user's
// own key, deny entry or hook; a file left holding nothing goes, one that cannot be read is untouched.
const { removeManagedSettings } = require('./install/settings.js');
test('removeManagedSettings: the managed keys, denies and wirings go; the user\'s own and an edited value stay (R10 uninstall)', () =>
{
    const dir = path.join(TMP, `rm-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const cmd = hookCommand('guard-a.js').command;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        env: { ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_PUSH_GATE: '0', MY_KEY: 'x' },
        permissions: { deny: ['Read(.env)', 'Bash(rm:*)'], allow: ['Bash(ls)'] },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd, timeout: 10 }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'node mine.js' }] }] },
        enabledMcpjsonServers: ['serena', 'mine'],
    }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/m.db' } }));
    const ledger = {
        env: { 'settings.json': { ALFRED_CODE_INSTRUMENT: valueHash('0'), ALFRED_CODE_PUSH_GATE: valueHash('1'), MY_KEY: valueHash('x') }, 'settings.local.json': { ALFRED_CODE_MEMORY_DB: valueHash('/m.db') } },
        deny: [{ file: 'settings.json', entry: 'Read(.env)' }, { file: 'settings.json', entry: 'Bash(rm:*)' }],
        // The user's own wiring, listed by a stamp that is project text: never the stack's to unwire.
        hooks: [{ file: 'settings.json', hook: 'guard-a.js', id: idOf('PreToolUse', 'Bash', 'guard-a.js') }, { file: 'settings.json', hook: 'mine.js', id: valueHash('PreToolUse\u0000Bash\u0000node mine.js') }],
    };
    const logs = [];
    removeManagedSettings({ claudeDir: dir, ledger, shippedDeny: ['Read(.env)'], mcpRemoved: ['serena'], log: (m) => logs.push(m) });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), {
        env: { ALFRED_CODE_PUSH_GATE: '0', MY_KEY: 'x' },
        permissions: { deny: ['Bash(rm:*)'], allow: ['Bash(ls)'] },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node mine.js' }] }] },
        enabledMcpjsonServers: ['mine'],
    });
    assert.ok(!fs.existsSync(path.join(dir, 'settings.local.json')), 'a settings file left empty goes');
    assert.match(logs.join('\n'), /settings\.json env: ALFRED_CODE_PUSH_GATE kept - changed since the stack wrote it, so it is yours \(1 chars\)/);
    const notes = [];
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{nope');
    removeManagedSettings({ claudeDir: dir, ledger, note: (m) => notes.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), '{nope');
    assert.strictEqual(notes.length, 1, notes.join('\n'));
});

// Review finding 8: at user scope uninstall leaves the user-scope core loaded (its row is printed, never
// removed), so the seats denied here and the hooks named off keep the user's switch-offs holding.
test('removeManagedSettings: at user scope the seat denies and ALFRED_CODE_HOOKS_OFF stay, said in one line', () =>
{
    const dir = path.join(TMP, `rm-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const seat = 'Agent(alfred-code:angular-verifier)';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-x', ALFRED_CODE_INSTRUMENT: '0' }, permissions: { deny: [seat, 'Read(.env)'] } }));
    const ledger = {
        env: { 'settings.json': { ALFRED_CODE_HOOKS_OFF: valueHash('guard-x'), ALFRED_CODE_INSTRUMENT: valueHash('0') } },
        deny: [{ file: 'settings.json', entry: seat }, { file: 'settings.json', entry: 'Read(.env)' }],
    };
    const logs = [];
    removeManagedSettings({ claudeDir: dir, ledger, shippedDeny: ['Read(.env)'], scope: 'user', log: (m) => logs.push(m) });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { env: { ALFRED_CODE_HOOKS_OFF: 'guard-x' }, permissions: { deny: [seat] } });
    assert.strictEqual(logs.filter((l) => /user-scope core stays loaded/.test(l)).length, 1, logs.join('\n'));
});

// Review finding 12: the empty-list tidy-up runs only in a file the ledger names - a file the install
// never wrote is not the stack's to tidy, let alone delete.
test('removeManagedSettings: an empty enabledPlugins in a file the ledger never names is left as it is', () =>
{
    const dir = path.join(TMP, `rm-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_INSTRUMENT: '0' }, enabledPlugins: {} }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{"enabledPlugins":{}}');
    removeManagedSettings({ claudeDir: dir, ledger: { env: { 'settings.json': { ALFRED_CODE_INSTRUMENT: valueHash('0') } } } });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), '{"enabledPlugins":{}}');
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'the file the ledger names is tidied and goes once empty');
});

// The `attribution` keys the seed writes are the stack's too: seeded this run, or listed by the prior
// ledger at the value written - never a key the project had before the stack wrote anything. With no
// ledger at all (an older stamp) a key at the seed value is adopted, the env fallback's rule.
test('settings-ledger: the attribution keys the run seeds are managed, the project\'s own are not (R10)', () =>
{
    const fresh = write(settingsFile({ attribution: { commit: '' } }), { attribution: {}, ledger: { prior: { ...noLedger, settings: {} }, releaseHooks: [] } });
    assert.deepStrictEqual(fresh.result.managed.settings, { 'settings.json': { 'attribution.pr': valueHash('""'), 'attribution.sessionUrl': valueHash('false') } },
        'commit was the project\'s before the stack wrote anything, at the same value');
    const listed = { ...noLedger, settings: { 'settings.json': { 'attribution.commit': valueHash('""'), 'attribution.pr': valueHash('""') } } };
    const edited = write(settingsFile({ attribution: { commit: '', pr: 'mine', sessionUrl: false } }), { attribution: {}, ledger: { prior: listed, releaseHooks: [] } });
    assert.deepStrictEqual(edited.result.managed.settings, { 'settings.json': { 'attribution.commit': valueHash('""') } }, 'pr was edited since; sessionUrl was never listed');
    const fallback = write(settingsFile({ attribution: { commit: '', pr: 'mine' } }), { attribution: {}, ledger: { prior: null, releaseHooks: [] } });
    assert.deepStrictEqual(fallback.result.managed.settings, { 'settings.json': { 'attribution.commit': valueHash('""'), 'attribution.sessionUrl': valueHash('false') } });
});

test('settings-ledger: worktree.baseRef is managed when this run seeded it or the ledger listed it, never the project\'s own', () =>
{
    const seeded = write(settingsFile({}), { worktreeBase: {}, ledger: { prior: null, releaseHooks: [] } });
    assert.strictEqual(seeded.result.managed.settings['settings.json']['worktree.baseRef'], valueHash('"head"'));
    const own = write(settingsFile({ worktree: { baseRef: 'head' } }), { worktreeBase: {}, ledger: { prior: null, releaseHooks: [] } });
    assert.ok(!('worktree.baseRef' in ((own.result.managed.settings || {})['settings.json'] || {})), 'the project set it before the stack wrote anything');
    const listed = { ...noLedger, settings: { 'settings.json': { 'worktree.baseRef': valueHash('"head"') } } };
    const again = write(settingsFile({ worktree: { baseRef: 'head' } }), { worktreeBase: {}, ledger: { prior: listed, releaseHooks: [] } });
    assert.strictEqual(again.result.managed.settings['settings.json']['worktree.baseRef'], valueHash('"head"'), 'listed at the value written');
});

test('removeManagedSettings: the attribution keys it seeded go, an edited one stays, and the empty lists the stack and the plugin CLI leave go with them (R10 uninstall)', () =>
{
    const dir = path.join(TMP, `rm-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        env: { ALFRED_CODE_INSTRUMENT: '0' }, attribution: { commit: '', pr: 'mine', sessionUrl: false }, enabledMcpjsonServers: [], enabledPlugins: {},
    }));
    const ledger = {
        env: { 'settings.json': { ALFRED_CODE_INSTRUMENT: valueHash('0') } },
        settings: { 'settings.json': { 'attribution.commit': valueHash('""'), 'attribution.pr': valueHash('""'), 'attribution.sessionUrl': valueHash('false') } },
    };
    const logs = [];
    removeManagedSettings({ claudeDir: dir, ledger, log: (m) => logs.push(m) });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { attribution: { pr: 'mine' } });
    assert.match(logs.join('\n'), /settings\.json: attribution\.pr kept - changed since the stack wrote it, so it is yours/);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ attribution: { commit: '', pr: '', sessionUrl: false }, enabledMcpjsonServers: [], enabledPlugins: {} }));
    removeManagedSettings({ claudeDir: dir, ledger, log: () => {} });
    assert.ok(!fs.existsSync(path.join(dir, 'settings.json')), 'a file left holding nothing but the stack\'s entries goes');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ enabledMcpjsonServers: ['mine'], enabledPlugins: { 'x@y': true } }));
    removeManagedSettings({ claudeDir: dir, ledger, log: () => {} });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), { enabledMcpjsonServers: ['mine'], enabledPlugins: { 'x@y': true } }, 'a list that names something is never touched');
});

// A local-scope run writes settings.local.json, but a copy-route install's stack wiring and its
// renamed or retired env keys sit in settings.json: left there, every Bash call ran a hook file the plugin route had pruned.
// The stack's own stale rows leave settings.json; a hook the user wrote stays.
test('settings-writer: a local-scope run removes the stack\'s stale wiring and env keys from settings.json, never the user\'s own', () =>
{
    const dir = path.join(TMP, `sharedprune-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const shared = path.join(dir, 'settings.json');
    const mine = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/scripts/my-hook.js"', timeout: 5 };
    fs.writeFileSync(shared, JSON.stringify({
        env: { ALFRED_CODE_DOCS_DIR: '.claude/docs', MY_KEY: '1', ALFRED_CODE_FRESH_SESSION_PCT: '50' },
        hooks: {
            PreToolUse: [
                { matcher: 'Bash', hooks: [hookCommandEntry('guard-catastrophic-rm.js'), mine] },
                { matcher: 'Read', hooks: [hookCommandEntry('guard-read-whole-file.js')] },
            ],
            Stop: [{ hooks: [hookCommandEntry('guard-stop-contract.js')] }],
        },
    }, null, 2));
    const local = path.join(dir, 'settings.local.json');
    writeSettings({
        file: local, sharedFile: shared, catalog: CATALOG, migrations: MIGRATIONS,
        retiredHooks: ['guard-catastrophic-rm.js', 'guard-read-whole-file.js', 'guard-stop-contract.js'], log: () => {},
    });
    const after = JSON.parse(fs.readFileSync(shared, 'utf8'));
    const cmds = JSON.stringify(after.hooks);
    assert.ok(!/\.claude\/hooks\//.test(cmds), `stack wiring left in settings.json: ${cmds}`);
    assert.ok(cmds.includes('my-hook.js'), 'the user\'s own hook was removed');
    assert.strictEqual(after.hooks.PreToolUse.length, 1);
    assert.strictEqual(after.env.MY_KEY, '1');
    assert.ok(!('ALFRED_CODE_DOCS_DIR' in after.env), 'the renamed docs key stayed');
    assert.strictEqual(after.env.ALFRED_CODE_DOCS_PATH, '.claude/docs');
    assert.ok(!('ALFRED_CODE_FRESH_SESSION_PCT' in after.env), 'the retired key stayed');
    // Idempotent, and a missing or malformed shared file is left alone.
    const bytes = fs.readFileSync(shared, 'utf8');
    writeSettings({ file: local, sharedFile: shared, catalog: CATALOG, migrations: MIGRATIONS, retiredHooks: ['guard-stop-contract.js'], log: () => {} });
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), bytes);
    fs.writeFileSync(shared, '{not json');
    writeSettings({ file: local, sharedFile: shared, catalog: CATALOG, migrations: MIGRATIONS, log: () => {}, note: () => {} });
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), '{not json');
    writeSettings({ file: local, sharedFile: path.join(dir, 'absent.json'), catalog: CATALOG, migrations: MIGRATIONS, log: () => {} });
    assert.ok(!fs.existsSync(path.join(dir, 'absent.json')));
});

function hookCommandEntry(file)
{
    return { type: 'command', command: hookCommand(file, '').command, timeout: HOOK_TIMEOUT };
}

test('settings-writer: --memory custom writes ALFRED_CODE_MEMORY over the value there, logged', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'default' } });
    const { data, logs } = write(file, { memory: { value: 'custom' } });
    assert.strictEqual(data.env.ALFRED_CODE_MEMORY, 'custom');
    assert.ok(logs.some((m) => m.includes("env: ALFRED_CODE_MEMORY 'default' -> 'custom' (--memory)")), logs.join('\n'));
    const again = write(file, { memory: { value: 'custom' } });
    assert.ok(again.logs.some((m) => m.includes("env: ALFRED_CODE_MEMORY 'custom' -> 'custom' (--memory, unchanged)")), again.logs.join('\n'));
});

test('settings-writer: with no --memory the absent-only seed writes default, and a value there is kept', () =>
{
    const { data, logs } = write(settingsFile({}));
    assert.strictEqual(data.env.ALFRED_CODE_MEMORY, 'default');
    assert.ok(logs.includes('  settings.json env: ALFRED_CODE_MEMORY seeded (default)'), logs.join('\n'));
    assert.strictEqual(write(settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } })).data.env.ALFRED_CODE_MEMORY, 'custom');
});

test('settings-writer: --memory lands in settings.local.json when that file holds the key', () =>
{
    const file = settingsFile({ env: {} });
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'default' } }));
    const { data } = write(file, { localFile, memory: { value: 'custom' } });
    assert.strictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).env.ALFRED_CODE_MEMORY, 'custom', 'the overlay wins the merge, so the answer goes there');
    assert.strictEqual(data.env.ALFRED_CODE_MEMORY, 'default', 'settings.json keeps the seed beneath it, as every stack key');
});

// CUSTOM MEMORY (spec P2): ALFRED_CODE_MEMORY=custom switches Claude's own memory off in the run's own file, ledgered, so a
// switch back or an uninstall takes it back; a value the user set is theirs, kept and named.
const MEM_HASH = require('./install/stamp.js').valueHash(JSON.stringify(false));
const MEM_WRITTEN = (f) => `  ${f}: autoMemoryEnabled: false written - ALFRED_CODE_MEMORY is custom, so Claude's own memory is off and your ranked memory tool holds the lessons`;
const MEM_REMOVED = (f) => `  ${f}: autoMemoryEnabled: false removed - ALFRED_CODE_MEMORY is no longer custom, so Claude's own memory is back on`;
const MEM_TRUE_KEPT = (f) => `  ${f}: autoMemoryEnabled: true kept - yours; custom memory needs it off, so Claude's own memory stays on beside your memory tool`;
const MEM_FALSE_KEPT = (f) => `  ${f}: autoMemoryEnabled: false kept - yours; native memory needs it on, so Claude's own memory stays off until you remove it`;
const priorOf = (result) => ({ prior: { env: result.managed.env, settings: result.managed.settings } });

test('settings-writer: custom memory writes autoMemoryEnabled false into the run\'s own file, ledgered', () =>
{
    const shared = write(settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } }));
    assert.strictEqual(shared.data.autoMemoryEnabled, false);
    assert.strictEqual(shared.result.managed.settings['settings.json'].autoMemoryEnabled, MEM_HASH);
    assert.ok(shared.logs.includes(MEM_WRITTEN('settings.json')), shared.logs.join('\n'));
    const flag = write(settingsFile({}), { memory: { value: 'custom' } });
    assert.strictEqual(flag.data.autoMemoryEnabled, false, 'the --memory answer is read as this run leaves it');
    const local = path.join(path.dirname(settingsFile()), 'settings.local.json');
    const inherited = write(local, { inheritedEnv: { ALFRED_CODE_MEMORY: 'custom' } });
    assert.strictEqual(inherited.data.autoMemoryEnabled, false, 'a local-scope run reads settings.json\'s value beneath it');
    assert.strictEqual(inherited.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH);
    const again = write(local, { inheritedEnv: { ALFRED_CODE_MEMORY: 'custom' }, ledger: priorOf(inherited.result) });
    assert.strictEqual(again.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH, 'a re-run keeps the row');
    assert.ok(!again.logs.some((m) => m.includes('autoMemoryEnabled')), `a re-run said: ${again.logs.join(' | ')}`);
});

test('settings-writer: back to default removes a ledgered switch-off still at its value', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' }, mine: 1 });
    const first = write(file);
    const back = write(file, { memory: { value: 'default' }, ledger: priorOf(first.result) });
    assert.ok(!Object.hasOwn(back.data, 'autoMemoryEnabled'));
    assert.strictEqual(back.data.mine, 1);
    assert.ok(back.logs.includes(MEM_REMOVED('settings.json')), back.logs.join('\n'));
    assert.ok(!Object.hasOwn((back.result.managed.settings['settings.json'] || {}), 'autoMemoryEnabled'));
});

test('settings-writer: a switch-off the user set is never ledgered, and stays under default with its line', () =>
{
    const file = settingsFile({ autoMemoryEnabled: false });
    const custom = write(file, { memory: { value: 'custom' } });
    assert.strictEqual(custom.data.autoMemoryEnabled, false);
    assert.ok(!Object.hasOwn((custom.result.managed.settings['settings.json'] || {}), 'autoMemoryEnabled'), 'the user\'s own false is not adopted');
    assert.ok(!custom.logs.some((m) => m.includes('autoMemoryEnabled')), custom.logs.join('\n'));
    const back = write(file, { memory: { value: 'default' }, ledger: priorOf(custom.result) });
    assert.strictEqual(back.data.autoMemoryEnabled, false);
    assert.ok(back.logs.includes(MEM_FALSE_KEPT('settings.json')), back.logs.join('\n'));
});

test('settings-writer: the user\'s own true under custom is kept and named on the run that answers, not after', () =>
{
    const file = settingsFile({ autoMemoryEnabled: true });
    const { data, logs, result } = write(file, { memory: { value: 'custom' } });
    assert.strictEqual(data.autoMemoryEnabled, true);
    assert.ok(logs.includes(MEM_TRUE_KEPT('settings.json')), logs.join('\n'));
    assert.ok(!Object.hasOwn((result.managed.settings['settings.json'] || {}), 'autoMemoryEnabled'));
    const again = write(file, { ledger: priorOf(result) });
    assert.strictEqual(again.data.autoMemoryEnabled, true);
    assert.ok(!again.logs.some((m) => m.includes('autoMemoryEnabled')), `a re-run said: ${again.logs.join(' | ')}`);
});

test('settings-writer: a ledgered switch-off the user changed to true is theirs: the row leaves the ledger, the value stays', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } });
    const first = write(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...data, autoMemoryEnabled: true }, null, 2));
    const next = write(file, { ledger: priorOf(first.result) });
    assert.strictEqual(next.data.autoMemoryEnabled, true);
    assert.ok(next.logs.includes(MEM_TRUE_KEPT('settings.json')), next.logs.join('\n'));
    assert.ok(!Object.hasOwn((next.result.managed.settings['settings.json'] || {}), 'autoMemoryEnabled'));
});

// Review Focus 5: nothing is written, and the run says why (final review M9 - the note was not asserted).
test('settings-writer: an unreadable settings file under custom writes nothing, and says why', () =>
{
    const file = settingsFile('{ not json');
    const { result, notes } = write(file, { memory: { value: 'custom' } });
    assert.strictEqual(result.refused, true);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
    assert.match(notes[0] || '', /not valid JSON/, notes.join('\n'));
});

// A malformed settings.local.json is no overlay - Claude Code cannot read it either - so the switch-off follows the choice
// settings.json holds, and the local file is left byte for byte.
test('settings-writer: an unreadable settings.local.json is left as it is; the switch-off follows settings.json\'s custom', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } });
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, '{ "env": { "ALFRED_CODE_MEMORY": "custom" ');
    const { data, notes, result } = write(file, { localFile });
    assert.strictEqual(fs.readFileSync(localFile, 'utf8'), '{ "env": { "ALFRED_CODE_MEMORY": "custom" ');
    assert.strictEqual(data.autoMemoryEnabled, false);
    assert.strictEqual(result.managed.settings['settings.json'].autoMemoryEnabled, MEM_HASH);
    assert.ok(!Object.hasOwn(result.managed.settings, 'settings.local.json'));
    assert.ok(notes.some((n) => /not valid JSON/.test(n)), notes.join('\n'));
});

test('leaveLocalScope: a ledgered switch-off moves with the stack\'s rows, an unledgered one stays', () =>
{
    for (const [ledgerSettings, gone] of [[{ autoMemoryEnabled: MEM_HASH }, true], [{}, false]])
    {
        const dir = path.join(TMP, `leave-mem-${seq++}`, '.claude');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: {} }));
        fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ autoMemoryEnabled: false, mine: 1 }));
        const logs = [];
        leaveLocalScope({ claudeDir: dir, ledgerSettings, log: (m) => logs.push(m) });
        const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
        assert.strictEqual(Object.hasOwn(local, 'autoMemoryEnabled'), !gone, logs.join('\n'));
        // Final review M9: the other half - the move never carries the switch-off into the committed file.
        assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')), 'autoMemoryEnabled'), 'settings.json gets no switch-off');
        if (gone) assert.ok(logs.some((m) => /settings seeds removed .*autoMemoryEnabled/.test(m)), logs.join('\n'));
        else assert.ok(!logs.some((m) => m.includes('autoMemoryEnabled')), `a key the stack does not own by name is left alone, unsaid: ${logs.join(' | ')}`);
    }
});

// Final review I1: a custom choice held in settings.local.json is the user's own, so the switch-off goes there - the
// committed settings.json would switch every teammate's memory off with their mode still default.
test('settings-writer: a custom held in settings.local.json switches memory off there, never in the team settings.json', () =>
{
    const file = settingsFile({ env: {} });
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' } }));
    const first = write(file, { localFile });
    const local = () => JSON.parse(fs.readFileSync(localFile, 'utf8'));
    assert.strictEqual(local().autoMemoryEnabled, false, first.logs.join('\n'));
    assert.ok(!Object.hasOwn(first.data, 'autoMemoryEnabled'), JSON.stringify(first.data));
    assert.strictEqual(first.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH);
    assert.ok(first.logs.includes(MEM_WRITTEN('settings.local.json')), first.logs.join('\n'));
    const before = fs.readFileSync(localFile, 'utf8');
    const again = write(file, { localFile, ledger: priorOf(first.result) });
    assert.strictEqual(fs.readFileSync(localFile, 'utf8'), before, 'a re-run leaves it');
    assert.strictEqual(again.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH, 'and keeps the row');
    assert.ok(!again.logs.some((m) => m.includes('autoMemoryEnabled')), again.logs.join(' | '));
});

test('settings-writer: the stack\'s switch-off left in settings.json goes once settings.local.json holds the custom choice', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } });
    const first = write(file);
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' } }));
    const shared = JSON.parse(fs.readFileSync(file, 'utf8'));
    shared.env.ALFRED_CODE_MEMORY = 'default';
    fs.writeFileSync(file, JSON.stringify(shared));
    const next = write(file, { localFile, ledger: priorOf(first.result) });
    assert.ok(!Object.hasOwn(next.data, 'autoMemoryEnabled'), 'the team file no longer carries it');
    assert.strictEqual(JSON.parse(fs.readFileSync(localFile, 'utf8')).autoMemoryEnabled, false);
    assert.ok(!Object.hasOwn(next.result.managed.settings['settings.json'] || {}, 'autoMemoryEnabled'));
});

// Fix-pass review I1: one developer's settings.local.json answer never strips the team's switch-off from settings.json
// while that file's own env still says custom - teammates' runs would write it straight back.
test('settings-writer: a personal answer in settings.local.json keeps the team\'s switch-off while settings.json says custom', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_MEMORY: 'custom' } });
    const first = write(file);
    const localFile = path.join(path.dirname(file), 'settings.local.json');
    for (const mine of ['default', 'custom'])
    {
        fs.writeFileSync(localFile, JSON.stringify({ env: { ALFRED_CODE_MEMORY: mine } }));
        const next = write(file, { localFile, ledger: priorOf(first.result), memory: { value: mine } });
        assert.strictEqual(next.data.autoMemoryEnabled, false, `${mine}: ${next.logs.join(' | ')}`);
        assert.strictEqual(next.result.managed.settings['settings.json'].autoMemoryEnabled, MEM_HASH, `${mine}: the team's row stays ledgered`);
        assert.ok(!next.logs.some((m) => m.includes('settings.json: autoMemoryEnabled: false removed')), next.logs.join(' | '));
        const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
        if (mine === 'custom') assert.strictEqual(local.autoMemoryEnabled, false, 'the personal custom gets its own switch-off beside it');
        else
        {
            assert.ok(!Object.hasOwn(local, 'autoMemoryEnabled'), JSON.stringify(local));
            assert.ok(next.logs.includes("  settings.json: autoMemoryEnabled: false kept - ALFRED_CODE_MEMORY is custom there for the team; settings.local.json's default leaves Claude's own memory off for you until settings.local.json sets autoMemoryEnabled: true"), next.logs.join('\n'));
            // Said on the run that answers, never on every run after it.
            const quiet = write(file, { localFile, ledger: priorOf(next.result) });
            assert.strictEqual(quiet.data.autoMemoryEnabled, false);
            assert.ok(!quiet.logs.some((m) => m.includes('autoMemoryEnabled')), quiet.logs.join(' | '));
        }
    }
});

test('leaveLocalScope: a custom choice that stays local keeps its switch-off beside it', () =>
{
    const dir = path.join(TMP, `leave-mem-custom-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: {} }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false }));
    const logs = [];
    leaveLocalScope({ claudeDir: dir, seeds: { ALFRED_CODE_MEMORY: 'default' }, ledgerSettings: { autoMemoryEnabled: MEM_HASH }, log: (m) => logs.push(m) });
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.strictEqual(local.env.ALFRED_CODE_MEMORY, 'custom', logs.join('\n'));
    assert.strictEqual(local.autoMemoryEnabled, false, `the switch-off travels with the choice: ${logs.join(' | ')}`);
    assert.ok(logs.some((m) => m.includes('autoMemoryEnabled stays here')), logs.join(' | '));
});

// Fix-pass review m2: the stays line speaks for the stack's ledgered false alone - a true, or a false the user set, is theirs.
test('leaveLocalScope: a custom choice beside the user\'s own autoMemoryEnabled says nothing about it', () =>
{
    for (const value of [true, false])
    {
        const dir = path.join(TMP, `leave-mem-own-${seq++}`, '.claude');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: {} }));
        fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: value }));
        const logs = [];
        leaveLocalScope({ claudeDir: dir, seeds: { ALFRED_CODE_MEMORY: 'default' }, ledgerSettings: value ? { autoMemoryEnabled: MEM_HASH } : {}, log: (m) => logs.push(m) });
        assert.ok(!logs.some((m) => m.includes('autoMemoryEnabled stays here')), `${value}: ${logs.join(' | ')}`);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')).autoMemoryEnabled, value, 'and leaves it');
    }
});

// The scorer's four rows are seeded by the absent-only loop like every catalog row: off, level 80, every automatic
// output (an empty list), 3 runs per attempt - and a value the user already set is never written over.
const SCORER_KEYS = ['', '_LEVEL', '_OUTPUTS', '_ROUNDS'].map((s) => `ALFRED_CODE_SCORER${s}`);
test('settings-writer: the scorer rows are seeded off, level 80, all outputs, 3 runs; a user value is kept', () =>
{
    const { data, logs } = write(settingsFile({}));
    assert.deepStrictEqual(SCORER_KEYS.map((k) => data.env[k]), ['0', '80', '', '3']);
    assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORER seeded (0)'), logs.join('\n'));
    assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORER_OUTPUTS seeded (empty)'), logs.join('\n'));
    const mine = { ALFRED_CODE_SCORER: '1', ALFRED_CODE_SCORER_LEVEL: '95', ALFRED_CODE_SCORER_OUTPUTS: 'root-cause', ALFRED_CODE_SCORER_ROUNDS: '5' };
    assert.deepStrictEqual(SCORER_KEYS.map((k) => write(settingsFile({ env: mine })).data.env[k]), ['1', '95', 'root-cause', '5']);
});
// The scope picks the FILE (settingsTarget), never the writer, so the per-scope result - project and user in
// settings.json, local in settings.local.json - is read in the temp-project matrix.

// ------------------------------------------------------------------ workspace layering: array members (spec 2.3)

const settingsMod = require('./install/settings.js');
const { valueHash: vh } = require('./install/stamp.js');
const memberDir = () => fs.mkdtempSync(path.join(TMP, 'members-'));
const readFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sync = (file, want, prior = {}, arrayPath = 'claudeMdExcludes') =>
{
    const notes = [];
    const got = settingsMod.syncMembers({ file, arrayPath, want, prior, log: () => {}, note: (m) => notes.push(m) });
    return { ...got, notes };
};

test('syncMembers adds the wanted members and ledgers each by its own hash', () =>
{
    const file = path.join(memberDir(), 'settings.local.json');
    const got = sync(file, ['/ws/.claude/rules/a.md', '/ws/.claude/AGENTS.md']);
    assert.strictEqual(got.created, true);
    assert.strictEqual(got.changed, true);
    assert.deepStrictEqual(readFile(file), { claudeMdExcludes: ['/ws/.claude/rules/a.md', '/ws/.claude/AGENTS.md'] });
    assert.deepStrictEqual(got.rows, {
        [`claudeMdExcludes[${vh('/ws/.claude/rules/a.md')}]`]: vh('/ws/.claude/rules/a.md'),
        [`claudeMdExcludes[${vh('/ws/.claude/AGENTS.md')}]`]: vh('/ws/.claude/AGENTS.md'),
    });
    assert.ok(settingsMod.MEMBER_PATH.test(settingsMod.memberRow('claudeMdExcludes', 'x')));
    const again = sync(file, ['/ws/.claude/rules/a.md', '/ws/.claude/AGENTS.md'], got.rows);
    assert.deepStrictEqual([again.changed, again.created], [false, false], 'a second run changes nothing');
});

test('a member already there with no row is the user\'s: not claimed, not doubled, never removed', () =>
{
    const file = path.join(memberDir(), 'settings.local.json');
    fs.writeFileSync(file, JSON.stringify({ claudeMdExcludes: ['/mine/**'], model: 'x' }, null, 2) + '\n');
    const got = sync(file, ['/mine/**', '/ws/r.md']);
    assert.deepStrictEqual(readFile(file), { claudeMdExcludes: ['/mine/**', '/ws/r.md'], model: 'x' });
    assert.deepStrictEqual(Object.keys(got.rows), [`claudeMdExcludes[${vh('/ws/r.md')}]`]);
    const dropped = sync(file, [], got.rows);
    assert.deepStrictEqual(readFile(file), { claudeMdExcludes: ['/mine/**'], model: 'x' }, 'the user\'s member stays');
    assert.deepStrictEqual(dropped.rows, {});
});

test('a prior row no longer wanted removes its member; a row whose member is gone just leaves', () =>
{
    const file = path.join(memberDir(), 'settings.local.json');
    const first = sync(file, ['/ws/a.md', '/ws/b.md']);
    const data = readFile(file);
    data.claudeMdExcludes = data.claudeMdExcludes.filter((m) => m !== '/ws/b.md');
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    const got = sync(file, ['/ws/c.md'], first.rows);
    assert.deepStrictEqual(readFile(file), { claudeMdExcludes: ['/ws/c.md'] });
    assert.deepStrictEqual(Object.keys(got.rows), [`claudeMdExcludes[${vh('/ws/c.md')}]`]);
});

test('an unreadable file keeps the prior rows and writes nothing', () =>
{
    const file = path.join(memberDir(), 'settings.local.json');
    fs.writeFileSync(file, '{ not json');
    const prior = { [`claudeMdExcludes[${vh('/ws/a.md')}]`]: vh('/ws/a.md') };
    const got = sync(file, ['/ws/b.md'], prior);
    assert.deepStrictEqual([got.refused, got.changed], [true, false]);
    assert.deepStrictEqual(got.rows, prior);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
    assert.strictEqual(got.notes.length, 1);
});

test('the last member removed takes the empty array key with it; permissions keeps its other keys', () =>
{
    const file = path.join(memberDir(), 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ permissions: { deny: ['Read(.env)'] } }, null, 2) + '\n');
    const got = sync(file, ['/ws/docs'], {}, 'permissions.additionalDirectories');
    assert.deepStrictEqual(readFile(file), { permissions: { deny: ['Read(.env)'], additionalDirectories: ['/ws/docs'] } });
    sync(file, [], got.rows, 'permissions.additionalDirectories');
    assert.deepStrictEqual(readFile(file), { permissions: { deny: ['Read(.env)'] } });
    const only = path.join(memberDir(), 'settings.local.json');
    const rows = sync(only, ['/ws/a.md']).rows;
    sync(only, [], rows);
    assert.deepStrictEqual(readFile(only), {});
});

test('removeManagedSettings removes a ledgered member by hash wherever it sits and keeps the user\'s', () =>
{
    const dir = memberDir();
    const file = path.join(dir, 'settings.local.json');
    fs.writeFileSync(file, JSON.stringify({ claudeMdExcludes: ['/mine/**', '/ws/a.md'], model: 'x' }, null, 2) + '\n');
    const ledger = { settings: { 'settings.local.json': { [`claudeMdExcludes[${vh('/ws/a.md')}]`]: vh('/ws/a.md') } } };
    settingsMod.removeManagedSettings({ claudeDir: dir, ledger });
    assert.deepStrictEqual(readFile(file), { claudeMdExcludes: ['/mine/**'], model: 'x' });
});

test('carryMemberRows: the step\'s rows win for settings.local.json; without them a prior row is carried while its member is there', () =>
{
    const dir = memberDir();
    const file = path.join(dir, 'settings.local.json');
    fs.writeFileSync(file, JSON.stringify({ claudeMdExcludes: ['/ws/a.md'] }, null, 2) + '\n');
    const rowA = `claudeMdExcludes[${vh('/ws/a.md')}]`;
    const rowB = `claudeMdExcludes[${vh('/ws/b.md')}]`;
    const prior = { 'settings.local.json': { [rowA]: vh('/ws/a.md'), [rowB]: vh('/ws/b.md'), 'attribution.commit': vh('"x"') } };
    assert.deepStrictEqual(settingsMod.carryMemberRows({ claudeDir: dir, priorSettings: prior }), { 'settings.local.json': { [rowA]: vh('/ws/a.md') } });
    const fresh = { [rowB]: vh('/ws/b.md') };
    assert.deepStrictEqual(settingsMod.carryMemberRows({ claudeDir: dir, priorSettings: prior, workspaceRows: fresh }), { 'settings.local.json': fresh });
    fs.writeFileSync(file, '{ broken');
    assert.deepStrictEqual(settingsMod.carryMemberRows({ claudeDir: dir, priorSettings: prior }), { 'settings.local.json': { [rowA]: vh('/ws/a.md'), [rowB]: vh('/ws/b.md') } }, 'an unreadable file keeps every recorded member row');
});
