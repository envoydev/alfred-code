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

const SC = 'ALFRED_CODE_SCORING';
const OFF = 'ALFRED_CODE_HOOKS_OFF';

test('settings-env: a joined child\'s copies leave its settings and its HOOKS_OFF loses the members\' part entries', () =>
{
    const file = settingsFile({ env: { [SC]: '1', ALFRED_CODE_HISTORY: '5', [OFF]: 'guard-ungated-commit:push,docs-session:gate' } });
    const { data } = write(file, { docsVersioning: { seed: 'git' }, childEnv: { ignored: [], copies: [SC], hooksOffDrop: ['guard-ungated-commit:push'] } });
    assert.ok(!Object.hasOwn(data.env, SC), 'the copy stayed');
    assert.strictEqual(data.env.ALFRED_CODE_HISTORY, '5', 'a key the plan does not name stays');
    assert.strictEqual(data.env[OFF], 'docs-session:gate');
});

test('settings-env: a joined child seeds no chained key - only DOCS_VERSIONING, the hook switch-offs and its ignore env keys', () =>
{
    const file = settingsFile({});
    const { data } = write(file, { docsVersioning: { seed: 'git' }, childEnv: { ignored: ['ALFRED_CODE_HISTORY'], copies: [], hooksOffDrop: [] } });
    assert.ok(!Object.hasOwn(data.env, SC), 'a chained key was seeded over the chain');
    assert.strictEqual(data.env.ALFRED_CODE_HISTORY, '3', 'an ignore env key takes the catalog default');
    assert.strictEqual(data.env.ALFRED_CODE_DOCS_VERSIONING, 'git');
    assert.ok(Object.hasOwn(data.env, OFF) && !Object.hasOwn(data.env, 'ALFRED_CODE_DATA_PATH'), JSON.stringify(data.env));
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

// E-batch B-m6: memory-session.js retired in 2.10.1 and its host traps moved into preferences-session.js as the `host` part.
// A stored `memory-session` switch-off is re-spelled to that part, from the manifest's own map.
test('B-m6: a stored memory-session switch-off maps to preferences-session:host', () =>
{
    const renamedHooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed.hooks;
    const a = envPass({ ALFRED_CODE_HOOKS_OFF: 'instrument-tool-usage,memory-session' }, { renamedHooks });
    assert.strictEqual(a.env.ALFRED_CODE_HOOKS_OFF, 'instrument-tool-usage,preferences-session:host');
    const overlay = { ALFRED_CODE_HOOKS_OFF: 'Memory-Session.js' };
    envPass({}, { renamedHooks, overlay });
    assert.strictEqual(overlay.ALFRED_CODE_HOOKS_OFF, 'preferences-session:host', 'the local overlay too');
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
// read-back uses, env key by key and deny combined. At project and user scope it is settings.json alone since mode v2
// stage 2 - the inherited view (N6) and R98's docs root; the read-back that sees the stack's rows passes 'local'.
test('readBackSettings: settings.json alone at project and user scope, the full overlay at local scope', () =>
{
    const dir = path.join(TMP, `readback-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const sharedHooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'shared' }] }] };
    const shared = {
        env: { ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared' },
        permissions: { deny: ['Agent(alfred-code:a)'], allow: ['Bash(ls:*)'] }, hooks: sharedHooks,
    };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(shared));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
        env: { BOTH: 'local', LOCAL_ONLY: '1', ALFRED_CODE_HOOKS_OFF: 'guard-answer' },
        permissions: { deny: ['Agent(alfred-code:b)', 'Agent(alfred-code:a)'] }, hooks: { PreToolUse: [] },
    }));
    for (const scope of ['project', 'user']) assert.deepStrictEqual(readBackSettings(dir, scope), shared, `${scope}: settings.json alone`);
    const merged = readBackSettings(dir, 'local');
    assert.deepStrictEqual(merged.env, {
        ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'local', LOCAL_ONLY: '1',
    });
    assert.deepStrictEqual(merged.permissions.deny, ['Agent(alfred-code:a)', 'Agent(alfred-code:b)']);
    assert.deepStrictEqual(merged.permissions.allow, ['Bash(ls:*)']);
    // A local key wins even when it is the empty list - Claude Code reads it the same way.
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: '' } }));
    assert.strictEqual(readBackSettings(dir, 'local').env.ALFRED_CODE_HOOKS_OFF, '');
    // Fail-soft: garbage in either file reads as empty, never a throw.
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    assert.deepStrictEqual(readBackSettings(dir, 'project'), {});
    assert.strictEqual(readBackSettings(dir, 'local').env.ALFRED_CODE_HOOKS_OFF, '');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '[1]');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '0' } }));
    assert.deepStrictEqual(readBackSettings(dir, 'local').env, { ALFRED_CODE_PUSH_GATE: '0' }, 'a malformed local file adds nothing');
    fs.rmSync(path.join(dir, 'settings.local.json'));
    assert.deepStrictEqual(readBackSettings(dir, 'user'), { env: { ALFRED_CODE_PUSH_GATE: '0' } }, 'no local file: the shared file as it is');
});

// R99, rewritten for mode v2 stage 2 (writeSettings' `localFile` is gone): at every scope the run writes
// settings.local.json itself, so an answered hooks layer, a decision, a migration AND every seed land there, and the shared
// settings.json beside it is left as it is. A malformed local file is refused and left as it is (the installer's gate,
// settings.localUnusable, stops every row before this call).
test('settings-writer: the answer, a decision, a reseed, a rename and the seeds land in settings.local.json, and settings.json is left (mode v2 stage 2, was R99)', () =>
{
    const p = pair({ env: { TEAM: 'y' } }, {
        env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000', ALFRED_CODE_DOCS_VERSIONING: 'local', ALFRED_CODE_CORRECTION_NUDGE_MODE: 'inject', MY_OWN: 'x' },
        permissions: { allow: ['Bash(ls)'] },
    });
    const sharedBefore = fs.readFileSync(p.sharedFile, 'utf8');
    const logs = [];
    const opts = {
        file: p.localFile, sharedFile: p.sharedFile, catalog: CATALOG, migrations: { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ['ALFRED_CODE_CORRECTION_NUDGE_MODE', 'ALFRED_CODE_CORRECTION_NUDGE']] },
        hooksOff: ['guard-answer', 'guard-secret-value'], hooksAnswered: true, docsVersioning: { value: 'git', seed: 'git' },
    };
    writeSettings({ ...opts, log: (m) => logs.push(m) });
    const local = p.local();
    assert.deepStrictEqual([local.env.ALFRED_CODE_HOOKS_OFF, local.env.ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, local.env.ALFRED_CODE_DOCS_VERSIONING,
        local.env.ALFRED_CODE_CORRECTION_NUDGE, local.env.MY_OWN], ['guard-answer,guard-secret-value', '180000', 'git', 'inject', 'x'],
    'the answer, the decision, the reseed and the rename land in the local file');
    assert.ok(!Object.hasOwn(local.env, 'ALFRED_CODE_CORRECTION_NUDGE_MODE'));
    assert.strictEqual(local.env.ALFRED_CODE_HISTORY, '3', 'a seed lands in the local file too');
    assert.deepStrictEqual(local.permissions.allow, ['Bash(ls)'], 'the user\'s own allow stays');
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), sharedBefore, 'settings.json is not written');
    const text = logs.join('\n');
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_HOOKS_OFF = guard-answer,guard-secret-value/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_CONTEXT_WINDOW_FOR_200K reset to 180000/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_CORRECTION_NUDGE_MODE renamed to ALFRED_CODE_CORRECTION_NUDGE/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_HISTORY seeded/);
    assert.doesNotMatch(text, /^ {2}settings\.json/m, 'nothing is said of settings.json');

    // Idempotent: a second run writes neither file.
    const before = [fs.readFileSync(p.sharedFile, 'utf8'), fs.readFileSync(p.localFile, 'utf8')];
    assert.strictEqual(writeSettings(opts).written, false);
    assert.deepStrictEqual([fs.readFileSync(p.sharedFile, 'utf8'), fs.readFileSync(p.localFile, 'utf8')], before);

    // A malformed local file is refused, named, and left as it is; settings.json takes no write either.
    fs.writeFileSync(p.localFile, '{ nope');
    const notes = [];
    assert.strictEqual(writeSettings({ ...opts, note: (m) => notes.push(m) }).refused, true);
    assert.match(notes.join('\n'), /settings\.local\.json is not valid JSON/);
    assert.strictEqual(fs.readFileSync(p.localFile, 'utf8'), '{ nope', 'a malformed local file is left untouched');
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), sharedBefore);
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

// R78 / R96, mode v2 stage 2 (Task 6): a local install moved to project or user scope keeps every row in settings.local.json,
// the stack's file at every scope, and settings.json is never read or written. Only a stack VARIABLE is judged - at project
// scope one in this file is the machine's override (Ruling 12): a seed the stack wrote goes (N2: any seed it shipped, an
// older spelling too), any other value stays, logged once by its length only (N3).
test('leaveLocalScope: variable seeds leave, a value the user set stays, every other row stays and settings.json is never touched (R78, R96, N2, N3)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const cmd = hookCommand('guard-catastrophic-rm.js').command;
    const team = JSON.stringify({ env: { ALFRED_CODE_CORRECTION_NUDGE: 'inject', TEAM: 'y' }, permissions: { deny: ['Read(secret)'] } });
    fs.writeFileSync(path.join(dir, 'settings.json'), team);
    const rest = {
        permissions: { allow: ['Bash(ls)'], deny: ['Agent(alfred-code:evidence-gatherer)', 'Read(.env)', 'Bash(rm:*)'] },
        enabledMcpjsonServers: ['serena', 'mine'],
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }] },
        attribution: { commit: '', pr: '' }, worktree: { baseRef: 'head' }, autoMemoryEnabled: false,
    };
    const kept = {
        ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_HOOKS_OFF: 'guard-answer',
        ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/other-repo', ALFRED_CODE_MEMORY_DB: '/elsewhere/.memory-mcp/memory.db', MY_OWN: 'x',
        ALFRED_CODE_TURN_CHECK: 0, ALFRED_CODE_SCORING_OUTPUTS: 'tok3n',
    };
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ...kept,
        ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '150000', ALFRED_CODE_SCORER_LEVEL: '80' }, ...rest }));
    const seeds = { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log', ALFRED_CODE_TURN_CHECK: '0',
        ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: ['180000', '150000'], ALFRED_CODE_SCORING_LEVEL: '80', ALFRED_CODE_SCORING_OUTPUTS: 'designer-plan' };
    const opts = { claudeDir: dir, seeds, renames: [['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_SCORING_LEVEL']] };
    const logs = [];
    assert.strictEqual(leaveLocalScope({ ...opts, log: (m) => logs.push(m) }).moved, true);
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.deepStrictEqual(local, { env: kept, ...rest }, 'only the variable seeds left; every other row stays');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), team, 'settings.json changed');
    const text = logs.join('\n');
    assert.match(text, /settings\.local\.json: ALFRED_CODE_TURN_CHECK stays here \(your value, 1 chars\) - it applies over \.variables/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_SCORING_OUTPUTS stays here \(your value, 5 chars\)/);
    assert.doesNotMatch(text, /HOOKS_OFF|PUSH_GATE|MEMORY_DB|ALLOW_WRITE|tok3n|guard-answer/, 'a non-variable key or a kept value reached the log');
    assert.match(text, /^  settings\.local\.json: 4 stack variables removed - each held the stack's own seed, so \.variables' value or its seed applies from here on: ALFRED_CODE_INSTRUMENT, ALFRED_CODE_CORRECTION_NUDGE, ALFRED_CODE_CONTEXT_WINDOW_FOR_200K, ALFRED_CODE_SCORER_LEVEL$/m);

    // Idempotent: a second move finds nothing and writes nothing.
    const before = fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8');
    assert.strictEqual(leaveLocalScope({ ...opts, log: () => {} }).moved, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), before);
});

// Mode v2 stage 2 (Task 6): a 3.10.0 local install's .variables spells the scoring keys by their old names - an old-name
// seed the stack wrote is still its seed, never lifted into the local file as the user's override.
test('leaveLocalScope: an old-name seed in .variables is the stack\'s and stays there; an old-name value of the user\'s is lifted', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{}');
    const variablesFile = path.join(path.dirname(dir), '.alfred', '.variables');
    fs.mkdirSync(path.dirname(variablesFile), { recursive: true });
    fs.writeFileSync(variablesFile, 'ALFRED_CODE_SCORER_LEVEL=80\nALFRED_CODE_SCORER_ROUNDS=9\n');
    leaveLocalScope({ claudeDir: dir, variablesFile, seeds: { ALFRED_CODE_SCORING_LEVEL: '80', ALFRED_CODE_SCORING_ROUNDS: '3' },
        renames: [['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_SCORING_LEVEL'], ['ALFRED_CODE_SCORER_ROUNDS', 'ALFRED_CODE_SCORING_ROUNDS']],
        ledgerVariables: { ALFRED_CODE_SCORER_LEVEL: valueHash('80'), ALFRED_CODE_SCORER_ROUNDS: valueHash('3') } });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')), { env: { ALFRED_CODE_SCORER_ROUNDS: '9' } });
    assert.strictEqual(fs.readFileSync(variablesFile, 'utf8').trim(), 'ALFRED_CODE_SCORER_LEVEL=80');
});

// Mode v2 stage 2 (Task 6): settings.json is not read, so a malformed one stops nothing; a malformed local file moves nothing.
test('leaveLocalScope: no local file or a malformed one moves nothing; a malformed settings.json is not read (R78)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    assert.strictEqual(leaveLocalScope({ claudeDir: dir }).moved, false, 'no local file');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{ nope');
    const notes = [];
    assert.strictEqual(leaveLocalScope({ claudeDir: dir, note: (m) => notes.push(m) }).moved, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), '{ nope', 'a malformed local file is left untouched');
    assert.strictEqual(notes.length, 1, notes.join('\n'));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_INSTRUMENT: '0' } }));
    fs.writeFileSync(path.join(dir, 'settings.json'), '[1]');
    assert.strictEqual(leaveLocalScope({ claudeDir: dir, seeds: { ALFRED_CODE_INSTRUMENT: '0' }, note: (m) => notes.push(m) }).moved, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')), {});
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '[1]');
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

// C6 (R101 N7, a stack key the local file held still seeded into settings.json) is deleted: mode v2 stage 2 removed the
// two-file write - no run seeds settings.json, and a seed is absent-only against the one file the run writes.

// C4 (R133 N1), rewritten for mode v2 stage 2: `--add agent X` for a seat denied in settings.local.json takes it out of
// that file - the run's own now - with a line; a deny in settings.json is the team's and is left.
test('settings-writer: an allowed seat leaves settings.local.json\'s deny list, with a line, and settings.json is left (C4, mode v2 stage 2)', () =>
{
    const seat = 'Agent(alfred-code:evidence-gatherer)';
    const p = pair({ permissions: { deny: ['Read(secret)'] } }, { permissions: { deny: [seat, 'Bash(rm:*)'], allow: ['Bash(ls)'] } });
    const sharedBefore = fs.readFileSync(p.sharedFile, 'utf8');
    const logs = [];
    const opts = { file: p.localFile, sharedFile: p.sharedFile, catalog: CATALOG, migrations: MIGRATIONS, agentAllow: [seat] };
    writeSettings({ ...opts, log: (m) => logs.push(m) });
    assert.deepStrictEqual(p.local().permissions.deny, ['Bash(rm:*)'], 'the local deny no longer keeps the seat off');
    assert.deepStrictEqual(p.local().permissions.allow, ['Bash(ls)']);
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), sharedBefore);
    assert.match(logs.join('\n'), /settings\.local\.json: agent allowed again Agent\(alfred-code:evidence-gatherer\)/);
    // A re-run writes nothing.
    const before = fs.readFileSync(p.localFile, 'utf8');
    assert.strictEqual(writeSettings(opts).written, false);
    assert.strictEqual(fs.readFileSync(p.localFile, 'utf8'), before);
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

// Review finding 5 (an unreadable settings.local.json beside the written settings.json keeps its ledgered deny rows) is
// deleted: mode v2 stage 2 removed the second file. The local file is the run's own now; an unusable one stops every
// settings row at the installer's gate (settings.localUnusable), and the stamp then keeps the last run's rows as recorded.

// 'leaveLocalScope: the ledger's moved denies follow them into settings.json...' (review finding 1, refileDeny) is deleted:
// mode v2 stage 2, Task 6 - a move off local carries no deny row into settings.json, so no ledger row follows one.

test('settings-ledger: a key the run writes into settings.local.json is managed there, the user\'s local key is not (R10, mode v2 stage 2)', () =>
{
    const p = pair({}, { env: { ALFRED_CODE_HOOKS_OFF: 'guard-x', ALFRED_CODE_PUSH_GATE: '0' } });
    const { result } = write(p.localFile, { sharedFile: p.sharedFile, hooksOff: ['guard-y'], hooksAnswered: true, ledger: { prior: noLedger, releaseHooks: [] } });
    assert.strictEqual(result.managed.env['settings.local.json'].ALFRED_CODE_HOOKS_OFF, valueHash('guard-y'), 'the answered hooks layer is the stack\'s, in the local file');
    assert.ok(!Object.hasOwn(result.managed.env['settings.local.json'], 'ALFRED_CODE_PUSH_GATE'), 'the user\'s own local value is not managed');
    assert.strictEqual(result.managed.env['settings.json'], undefined, 'nothing is managed in settings.json');
    const local = p.local().env;
    assert.deepStrictEqual([local.ALFRED_CODE_HOOKS_OFF, local.ALFRED_CODE_PUSH_GATE], ['guard-y', '0'], 'the user\'s own local value still applies, unmanaged');
});

test('leaveLocalScope: with a ledger, the ledger decides - a local key at a seed the stack never wrote stays, one it wrote goes (R96 over R10)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_TURN_CHECK: '0', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'inject' } }));
    const seeds = { ALFRED_CODE_TURN_CHECK: '0', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_CORRECTION_NUDGE: 'log' };
    const ledgerEnv = { ALFRED_CODE_INSTRUMENT: valueHash('0'), ALFRED_CODE_CORRECTION_NUDGE: valueHash('log') };
    const logs = [];
    leaveLocalScope({ claudeDir: dir, seeds, ledgerEnv, log: (m) => logs.push(m) });
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.deepStrictEqual(local.env, { ALFRED_CODE_TURN_CHECK: '0', ALFRED_CODE_CORRECTION_NUDGE: 'inject' },
        'TURN_CHECK is at the seed but the stack never wrote it here - the user set it; CORRECTION_NUDGE was edited since');
    assert.match(logs.join('\n'), /1 stack variable removed - each held the stack's own seed.*: ALFRED_CODE_INSTRUMENT$/m);
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

// Rewritten for mode v2 stage 2 (Ruling 10): the local file is the run's own, and a variable it held is this machine's
// override - the --memory answer lands in it, never in .variables, and settings.json is not written.
test('settings-writer: --memory lands in settings.local.json when that file holds the key (Ruling 10)', () =>
{
    const p = pair({ env: {} }, { env: { ALFRED_CODE_MEMORY: 'default' } });
    const variablesFile = ownVars(p);
    const sharedBefore = fs.readFileSync(p.sharedFile, 'utf8');
    write(p.localFile, { keepOwn: true, variablesFile, sharedFile: p.sharedFile, memory: { value: 'custom' } });
    assert.strictEqual(p.local().env.ALFRED_CODE_MEMORY, 'custom', 'the override holds the answer');
    assert.doesNotMatch(fs.existsSync(variablesFile) ? fs.readFileSync(variablesFile, 'utf8') : '', /^ALFRED_CODE_MEMORY=custom$/m, '.variables never takes it');
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), sharedBefore, 'settings.json is not written');
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

// 'an unreadable settings.local.json is left as it is; the switch-off follows settings.json's custom' is deleted: mode v2
// stage 2 removed the second file - the switch-off is written in the run's own file (the local one), and an unusable local
// file stops every settings row at the installer's gate (settings.localUnusable). settings.json's custom read beneath the
// local file is the inheritedEnv case of 'custom memory writes autoMemoryEnabled false into the run's own file'.

// 'leaveLocalScope: a ledgered switch-off moves with the stack's rows, an unledgered one stays' is deleted: mode v2 stage 2,
// Task 6 - the switch-off is a row of the stack's file at every scope, so a move off local leaves it where it is.

// Final review I1: a custom choice held in settings.local.json is the user's own, so the switch-off goes there - the
// committed settings.json would switch every teammate's memory off with their mode still default.
// Rewritten for mode v2 stage 2: the run writes settings.local.json, so the switch-off goes there - the shared
// settings.json beside it is never written.
test('settings-writer: a custom held in settings.local.json switches memory off there, never in the team settings.json', () =>
{
    const p = pair({ env: {} }, { env: { ALFRED_CODE_MEMORY: 'custom' } });
    const sharedBefore = fs.readFileSync(p.sharedFile, 'utf8');
    const first = write(p.localFile, { sharedFile: p.sharedFile });
    assert.strictEqual(p.local().autoMemoryEnabled, false, first.logs.join('\n'));
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), sharedBefore, 'settings.json is not written');
    assert.strictEqual(first.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH);
    assert.ok(!Object.hasOwn(first.result.managed.settings, 'settings.json'));
    assert.ok(first.logs.includes(MEM_WRITTEN('settings.local.json')), first.logs.join('\n'));
    const before = fs.readFileSync(p.localFile, 'utf8');
    const again = write(p.localFile, { sharedFile: p.sharedFile, ledger: priorOf(first.result) });
    assert.strictEqual(fs.readFileSync(p.localFile, 'utf8'), before, 'a re-run leaves it');
    assert.strictEqual(again.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH, 'and keeps the row');
    assert.ok(!again.logs.some((m) => m.includes('autoMemoryEnabled')), again.logs.join(' | '));
});

// Rewritten for mode v2 stage 2: the stack's ledgered switch-off in settings.json leaves it with the move (moveToLocal),
// and the run writes it in settings.local.json beside the custom choice there.
test('settings-writer: the stack\'s switch-off left in settings.json goes once settings.local.json holds the custom choice', () =>
{
    const p = pair({ env: { ALFRED_CODE_MEMORY: 'default' }, autoMemoryEnabled: false }, { env: { ALFRED_CODE_MEMORY: 'custom' } });
    const ledger = { env: {}, deny: [], hooks: [], settings: { 'settings.json': { autoMemoryEnabled: MEM_HASH } } };
    moveToLocal({ claudeDir: p.dir, ledger });
    const next = write(p.localFile, { sharedFile: p.sharedFile, ledger: { prior: ledger } });
    assert.ok(!Object.hasOwn(p.shared(), 'autoMemoryEnabled'), 'the team file no longer carries it');
    assert.strictEqual(p.local().autoMemoryEnabled, false);
    assert.strictEqual(next.result.managed.settings['settings.local.json'].autoMemoryEnabled, MEM_HASH);
    assert.ok(!Object.hasOwn(next.result.managed.settings['settings.json'] || {}, 'autoMemoryEnabled'));
});

// Fix-pass review I1 ('a personal answer in settings.local.json keeps the team's switch-off while settings.json says custom')
// is deleted: Ruling 13 of mode v2 stage 2 decides the switch-off from the merged view, the override first, in the one
// file the run writes - a native-memory override keeps it out (the tail's 'custom memory writes its switch-off in the one
// file; a native-memory override keeps it out'), and settings.json is never written.

// Mode v2 stage 2 (Task 6): the custom choice is the user's override and stays; its switch-off is the stack's row in its
// own file and stays beside it, unsaid.
test('leaveLocalScope: a custom choice that stays local keeps its switch-off beside it', () =>
{
    const dir = path.join(TMP, `leave-mem-custom-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false }));
    const logs = [];
    leaveLocalScope({ claudeDir: dir, seeds: { ALFRED_CODE_MEMORY: 'default' }, log: (m) => logs.push(m) });
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.strictEqual(local.env.ALFRED_CODE_MEMORY, 'custom', logs.join('\n'));
    assert.strictEqual(local.autoMemoryEnabled, false, `the switch-off left the choice: ${logs.join(' | ')}`);
    assert.ok(!logs.some((m) => m.includes('autoMemoryEnabled')), logs.join(' | '));
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
        leaveLocalScope({ claudeDir: dir, seeds: { ALFRED_CODE_MEMORY: 'default' }, log: (m) => logs.push(m) });
        assert.ok(!logs.some((m) => m.includes('autoMemoryEnabled stays here')), `${value}: ${logs.join(' | ')}`);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')).autoMemoryEnabled, value, 'and leaves it');
    }
});

// The scoring's four rows are seeded by the absent-only loop like every catalog row: on, level 80, designer plan files
// only, 3 runs per attempt (B1 of the 2026-11-03 usage audit: scored plan files won 14 of 15 pairs, inline plans lost
// 3 of 3 - docs/habits-scorer-evidence.md) - and a value the user already set is never written over.
const SCORING_KEYS = ['', '_LEVEL', '_OUTPUTS', '_ROUNDS'].map((s) => `ALFRED_CODE_SCORING${s}`);
test('settings-writer: the scoring rows are seeded on, level 80, designer plans only, 3 runs; a user value is kept', () =>
{
    const { data, logs } = write(settingsFile({}));
    assert.deepStrictEqual(SCORING_KEYS.map((k) => data.env[k]), ['1', '80', 'designer-plan', '3']);
    assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORING seeded (1)'), logs.join('\n'));
    assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORING_OUTPUTS seeded (designer-plan)'), logs.join('\n'));
    const mine = { ALFRED_CODE_SCORING: '1', ALFRED_CODE_SCORING_LEVEL: '95', ALFRED_CODE_SCORING_OUTPUTS: 'root-cause', ALFRED_CODE_SCORING_ROUNDS: '5' };
    assert.deepStrictEqual(SCORING_KEYS.map((k) => write(settingsFile({ env: mine })).data.env[k]), ['1', '95', 'root-cause', '5']);
});

// An install that holds the OLD seed (`0`, all outputs) moves to the new one on update - the two `clear_settings_env`
// reseeds of meta/migrations.json, gated by the ledger: only a value the stack wrote there moves. A value the user
// set (no ledger row at it) stays, `0` and `root-cause` alike; with no ledger at all the value alone decides.
const REAL_MIGRATIONS = envMigrations(require('../meta/migrations.json'));
const SC_PAIR = (data) => [data.env.ALFRED_CODE_SCORING, data.env.ALFRED_CODE_SCORING_OUTPUTS];
test('settings-writer: an install on the stack\'s old scoring seed (0, all outputs) is reset to 1 / designer-plan; a hand-set value stays', () =>
{
    const old = { ALFRED_CODE_SCORING: '0', ALFRED_CODE_SCORING_OUTPUTS: '' };
    const rows = (scoring, outputs) => ({ env: { 'settings.json': { ...(scoring ? { ALFRED_CODE_SCORING: valueHash(scoring) } : {}), ...(outputs !== undefined ? { ALFRED_CODE_SCORING_OUTPUTS: valueHash(outputs) } : {}), ALFRED_CODE_HISTORY: valueHash('3') } }, deny: [], hooks: [] });
    for (const prior of [rows('0', ''), null])
    {
        const file = settingsFile({ env: old });
        const { data, logs, result } = write(file, { migrations: REAL_MIGRATIONS, ledger: { prior, releaseHooks: [] } });
        assert.deepStrictEqual(SC_PAIR(data), ['1', 'designer-plan'], `ledger ${Boolean(prior)}`);
        assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORING reset to 1 (the old stack seed 0)'), logs.join('\n'));
        assert.ok(logs.includes('  settings.json env: ALFRED_CODE_SCORING_OUTPUTS reset to designer-plan (the old stack seed empty)'), logs.join('\n'));
        const env = result.managed.env['settings.json'];
        assert.deepStrictEqual([env.ALFRED_CODE_SCORING, env.ALFRED_CODE_SCORING_OUTPUTS], [valueHash('1'), valueHash('designer-plan')], 'the new values are the stack\'s');
        // a re-run is a no-op
        const before = fs.readFileSync(file, 'utf8');
        const again = write(file, { migrations: REAL_MIGRATIONS, ledger: { prior: { env: result.managed.env, deny: [], hooks: [] }, releaseHooks: [] } });
        assert.strictEqual(fs.readFileSync(file, 'utf8'), before, `ledger ${Boolean(prior)}: the second run changed the file`);
        assert.ok(!again.logs.some((m) => /SCORING/.test(m)), again.logs.join('\n'));
    }
    // The user's own: a 0 or root-cause typed over the new seed (the ledger holds 1 / designer-plan), or after the key left
    // the ledger (no row) - never moved, never claimed.
    for (const [label, prior, env] of [
        ['typed over the new seed', rows('1', 'designer-plan'), { ALFRED_CODE_SCORING: '0', ALFRED_CODE_SCORING_OUTPUTS: 'root-cause' }],
        ['no ledger row for the key', rows(null, undefined), old],
        ['root-cause over the old seed', rows('0', ''), { ALFRED_CODE_SCORING: '1', ALFRED_CODE_SCORING_OUTPUTS: 'root-cause' }],
    ])
    {
        const { data, logs } = write(settingsFile({ env }), { migrations: REAL_MIGRATIONS, ledger: { prior, releaseHooks: [] } });
        assert.deepStrictEqual(SC_PAIR(data), [env.ALFRED_CODE_SCORING, env.ALFRED_CODE_SCORING_OUTPUTS], `${label}: ${logs.join(' | ')}`);
        assert.ok(!logs.some((m) => /SCORING(_OUTPUTS)? reset/.test(m)), label);
    }
});
// Since 3.0.0 the values sit in .variables and their ledger rows under `.variables`: the reseed reads both there.
test('settings-writer: the scoring reseed moves the old seed where .variables holds it, gated by the .variables ledger rows', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_HOOKS_OFF: '' } });
    const varsAt = path.join(path.dirname(path.dirname(file)), '.alfred', '.variables');
    fs.mkdirSync(path.dirname(varsAt), { recursive: true });
    for (const [label, held, want] of [
        ['the stack wrote 0 / empty', { ALFRED_CODE_SCORING: valueHash('0'), ALFRED_CODE_SCORING_OUTPUTS: valueHash('') }, ['1', 'designer-plan']],
        ['the user typed 0 / empty over 1 / designer-plan', { ALFRED_CODE_SCORING: valueHash('1'), ALFRED_CODE_SCORING_OUTPUTS: valueHash('designer-plan') }, ['0', '']],
    ])
    {
        fs.writeFileSync(varsAt, 'ALFRED_CODE_SCORING=0\nALFRED_CODE_SCORING_OUTPUTS=\n');
        const prior = { env: { 'settings.json': { ALFRED_CODE_HOOKS_OFF: valueHash('') }, '.variables': held }, deny: [], hooks: [] };
        const { logs } = write(file, { migrations: REAL_MIGRATIONS, variablesFile: varsAt, ledger: { prior, releaseHooks: [] } });
        const values = require('./install/variables.js').read(varsAt).values;
        assert.deepStrictEqual([values.ALFRED_CODE_SCORING, values.ALFRED_CODE_SCORING_OUTPUTS], want, `${label}: ${logs.filter((m) => /SCORING/.test(m)).join(' | ')}`);
        // the reseed line names the file the value lands in - .variables, never the settings file the pass reads it through
        const reset = logs.filter((m) => / reset to /.test(m));
        if (want[0] === '1')
            assert.deepStrictEqual(reset, ['  .variables env: ALFRED_CODE_SCORING reset to 1 (the old stack seed 0)',
                '  .variables env: ALFRED_CODE_SCORING_OUTPUTS reset to designer-plan (the old stack seed empty)'], logs.join('\n'));
        else assert.deepStrictEqual(reset, [], label);
    }
});
// Complexity stage 1 B9: ALFRED_CODE_FORGE_WATCH is retired with no when_value, and since 3.0.0 the seed
// sits in .variables, so the env pass reads a retired key there too and the line leaves, named after its file.
test('stage 1 B9: a retired key in .variables leaves it, named, and other lines stay', () =>
{
    const file = settingsFile({ env: { ALFRED_CODE_HOOKS_OFF: '' } });
    const varsAt = path.join(path.dirname(path.dirname(file)), '.alfred', '.variables');
    fs.mkdirSync(path.dirname(varsAt), { recursive: true });
    fs.writeFileSync(varsAt, 'ALFRED_CODE_FORGE_WATCH=all\nALFRED_CODE_SCORING=1\n');
    const { data, logs } = write(file, { migrations: REAL_MIGRATIONS, variablesFile: varsAt, ledger: { prior: null, releaseHooks: [] } });
    const values = require('./install/variables.js').read(varsAt).values;
    assert.ok(!Object.hasOwn(values, 'ALFRED_CODE_FORGE_WATCH'), logs.join('\n'));
    assert.strictEqual(values.ALFRED_CODE_SCORING, '1');
    assert.ok(logs.includes('  .variables env: ALFRED_CODE_FORGE_WATCH removed (retired - nothing reads it)'), logs.join('\n'));
    assert.ok(!logs.some((m) => /FORGE_WATCH/.test(m) && /\bmoved\b/.test(m)), logs.join('\n'));
    assert.ok(!Object.hasOwn((data && data.env) || {}, 'ALFRED_CODE_FORGE_WATCH'));
});
test('the scoring catalog rows: seed 1 and designer-plan; the old seeds are reseeds, not former_defaults', () =>
{
    const row = (k) => CATALOG.find((r) => r.key === k);
    assert.strictEqual(row('ALFRED_CODE_SCORING').default, '1');
    assert.strictEqual(row('ALFRED_CODE_SCORING').former_defaults, undefined, 'a former default is never rewritten - these are');
    assert.strictEqual(row('ALFRED_CODE_SCORING_OUTPUTS').default, 'designer-plan');
    assert.strictEqual(row('ALFRED_CODE_SCORING_OUTPUTS').former_defaults, undefined);
    assert.ok(REAL_MIGRATIONS.reseed.some(([k, bad, to]) => k === 'ALFRED_CODE_SCORING' && bad === '0' && to === '1'));
    assert.ok(REAL_MIGRATIONS.reseed.some(([k, bad, to]) => k === 'ALFRED_CODE_SCORING_OUTPUTS' && bad === '' && to === 'designer-plan'));
    assert.match(row('ALFRED_CODE_SCORING').what, /`1` \(the seed\)/);
    assert.doesNotMatch(row('ALFRED_CODE_SCORING').what, /`0` \(the seed\)/);
    assert.match(row('ALFRED_CODE_SCORING_OUTPUTS').what, /`designer-plan` \(the seed\)/);
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

// R070 (burn-down 2026-11-04): a non-array value at the array's key was replaced by the stack's list.
test('R070: a non-array permissions.deny is left byte-identical and named', () =>
{
    for (const value of ['Edit(//x/**)', { rule: 'Edit(//x/**)' }, 7])
    {
        const file = path.join(memberDir(), 'settings.local.json');
        const text = `${JSON.stringify({ permissions: { deny: value, allow: ['Read'] } }, null, 2)}\n`;
        fs.writeFileSync(file, text);
        const prior = { [`permissions.deny[${vh('Edit(//old/**)')}]`]: vh('Edit(//old/**)') };
        const got = sync(file, ['Edit(//ws/.alfred/docs/**)'], prior, 'permissions.deny');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), text, `${JSON.stringify(value)}: byte-identical`);
        assert.strictEqual(got.changed, false);
        assert.strictEqual(got.refused, true);
        assert.deepStrictEqual(got.rows, prior, 'the prior rows are kept as recorded');
        assert.deepStrictEqual(got.notes, ['settings.local.json: permissions.deny is not a list - left as it is']);
    }
});

// Final review I2: R070's refusal covered syncMembers only - the main writer threw on a string or object deny
// ('deny.push is not a function', the install aborted) and replaced a null one with the stack's list.
test('R070: the main writer leaves a permissions or permissions.deny that is not an object / a list as it is, names it, keeps its rows', () =>
{
    const cases = [{ deny: 'Read(./.env)' }, { deny: { rule: 'x' } }, { deny: null }, { deny: 7 }, 'all', null, ['Read']]
        .map((perms) => ({ permissions: perms, model: 'm' }));
    for (const initial of cases)
    {
        const file = settingsFile(initial);
        const text = fs.readFileSync(file, 'utf8');
        const prior = { deny: [{ file: 'settings.json', entry: 'Read(./.env)' }, { file: 'settings.json', entry: 'Agent(alfred-code:old-seat)' }] };
        let got;
        assert.doesNotThrow(() => { got = write(file, { denySpecs: ['Read(./.env)'], retiredDeny: ['Read(./old)'], agentDeny: ['Agent(alfred-code:security-auditor)'], agentAllow: ['Agent(alfred-code:old-seat)'], ledger: { prior, releaseHooks: [] } }); }, JSON.stringify(initial));
        assert.deepStrictEqual(got.data.permissions, initial.permissions, `${JSON.stringify(initial.permissions)}: left as it is`);
        assert.ok(got.notes.some((n) => /^settings\.json: permissions(\.deny)? is not (a list|an object) - left as it is/.test(n)), `${JSON.stringify(initial.permissions)}: named - ${got.notes.join(' | ')}`);
        assert.ok(!got.logs.some((l) => /agent denied|agent allowed again|dropped retired deny/.test(l)), `${JSON.stringify(initial.permissions)}: no deny line claims a write - ${got.logs.join(' | ')}`);
        assert.deepStrictEqual(got.result.managed.deny.filter((d) => d.file === 'settings.json'), prior.deny, 'the prior rows are kept as recorded');
        const again = write(file, { denySpecs: ['Read(./.env)'], ledger: { prior, releaseHooks: [] } });
        assert.strictEqual(again.result.written, false, `${JSON.stringify(initial.permissions)}: a second run writes nothing`);
        assert.ok(text.length > 0);
    }
    // An absent permissions, or one with no deny key, still gets the stack's list (the allow case).
    for (const initial of [{ model: 'm' }, { permissions: { allow: ['Read'] } }])
    {
        const got = write(settingsFile(initial), { denySpecs: ['Read(./.env)'] });
        assert.deepStrictEqual(got.data.permissions.deny, ['Read(./.env)'], JSON.stringify(initial));
    }
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

test('until 4.0.0: a stored scorer part is re-spelled, also when the walk answered the hooks layer', () =>
{
    const renamedHooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed.hooks;
    const a = envPass({ ALFRED_CODE_HOOKS_OFF: 'history-session,guard-answer:scorer,Guard-Stop-Contract:Scorer' }, { renamedHooks });
    assert.strictEqual(a.env.ALFRED_CODE_HOOKS_OFF, 'history-session,guard-answer:scoring,guard-stop-contract:scoring');
    const overlay = { ALFRED_CODE_HOOKS_OFF: 'guard-answer:scorer' };
    envPass({}, { renamedHooks, overlay });
    assert.strictEqual(overlay.ALFRED_CODE_HOOKS_OFF, 'guard-answer:scoring', 'the local overlay too');
    const b = envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-a,guard-answer:scorer' }, { renamedHooks, hooksAnswered: true, hooksOff: ['guard-b'] });
    assert.strictEqual(b.env.ALFRED_CODE_HOOKS_OFF, 'guard-b,guard-answer:scoring', 'the kept part arrives under its new name');
});

test('until 4.0.0: a stored scorer part spelled with .js is re-spelled on both branches (review M1)', () =>
{
    const renamedHooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed.hooks;
    const a = envPass({ ALFRED_CODE_HOOKS_OFF: 'history-session,guard-answer.js:scorer,Guard-Stop-Contract.JS:Scorer' }, { renamedHooks });
    assert.strictEqual(a.env.ALFRED_CODE_HOOKS_OFF, 'history-session,guard-answer:scoring,guard-stop-contract:scoring');
    const b = envPass({ ALFRED_CODE_HOOKS_OFF: 'guard-a,guard-answer.js:scorer' }, { renamedHooks, hooksAnswered: true, hooksOff: ['guard-b'] });
    assert.strictEqual(b.env.ALFRED_CODE_HOOKS_OFF, 'guard-b,guard-answer:scoring');
});

// 3.12: since mode v2 stage 2 the run writes settings.local.json, so a part an older install left in settings.json's
// off-list was renamed in no file (the rename matrix, 2026-11-13: a 3.10.0 project kept guard-answer:scorer there).
test('until 4.0.0: a renamed hook part in settings.json\'s off-list is re-spelled while the run writes settings.local.json', () =>
{
    const renamed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed;
    const p = pair({ env: { ALFRED_CODE_HOOKS_OFF: 'history-session,guard-answer:scorer' } }, {});
    const logs = [];
    writeSettings({ file: p.localFile, sharedFile: p.sharedFile, catalog: CATALOG, migrations: MIGRATIONS, renamed, log: (m) => logs.push(m) });
    assert.strictEqual(p.shared().env.ALFRED_CODE_HOOKS_OFF, 'history-session,guard-answer:scoring', logs.join('\n'));
    assert.ok(logs.some((l) => /settings\.json env: ALFRED_CODE_HOOKS_OFF = history-session,guard-answer:scoring \(a renamed hook re-spelled\)/.test(l)), logs.join('\n'));
    const again = fs.readFileSync(p.sharedFile, 'utf8');
    writeSettings({ file: p.localFile, sharedFile: p.sharedFile, catalog: CATALOG, migrations: MIGRATIONS, renamed, log: () => {} });
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), again, 'a second run changes nothing');
});

// Mode v2 stage 2, Task 2: the local file must be usable before any settings row is written to it.
const { localUnusable } = require('./install/settings.js');
test('localUnusable: absent, empty and a JSON object are usable; garbage, a list and a folder are not', () =>
{
    const p = pair();
    assert.strictEqual(localUnusable(p.localFile), '');
    fs.writeFileSync(p.localFile, '');
    assert.strictEqual(localUnusable(p.localFile), '');
    fs.writeFileSync(p.localFile, '{"env":{}}');
    assert.strictEqual(localUnusable(p.localFile), '');
    fs.writeFileSync(p.localFile, '{ not json');
    assert.strictEqual(localUnusable(p.localFile), 'not valid JSON');
    fs.writeFileSync(p.localFile, '[]');
    assert.strictEqual(localUnusable(p.localFile), 'not valid JSON');
    fs.rmSync(p.localFile);
    fs.mkdirSync(p.localFile);
    assert.strictEqual(localUnusable(p.localFile), 'not writable');
});

test('localUnusable: a file git tracks is the repository\'s', () =>
{
    const { execFileSync } = require('node:child_process');
    const p = pair();
    const repo = path.dirname(p.dir);
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, stdio: 'pipe' });
    git('init', '-q');
    fs.writeFileSync(p.localFile, '{}');
    git('add', '-f', '--', p.localFile);
    assert.strictEqual(localUnusable(p.localFile), 'tracked by git - git rm --cached it');
    git('rm', '-q', '--cached', '--', p.localFile);
    assert.strictEqual(localUnusable(p.localFile), '');
});

test('localUnusable: a read-only file, and a read-only folder with no file, are not writable',
    { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
    {
        const p = pair(undefined, {});
        try
        {
            fs.chmodSync(p.localFile, 0o444);
            assert.strictEqual(localUnusable(p.localFile), 'not writable');
        }
        finally { fs.chmodSync(p.localFile, 0o644); }
        fs.rmSync(p.localFile);
        try
        {
            fs.chmodSync(p.dir, 0o555);
            assert.strictEqual(localUnusable(p.localFile), 'not writable');
        }
        finally { fs.chmodSync(p.dir, 0o755); }
    });

// Mode v2 stage 2, Task 3: the move - the rows the last run ledgered in settings.json leave it once.
const { moveToLocal } = require('./install/settings.js');
const MOVE_SHARED = () => ({ enabledPlugins: { 'alfred-code@envoydev': true }, env: { MY_OWN: '1', ALFRED_CODE_HOOKS_OFF: 'guard-answer' },
    permissions: { allow: ['Bash(ls)'], deny: ['Read(.env)', 'Agent(alfred-code:evidence-gatherer)', 'Read(mine)'] },
    attribution: { commit: '' }, worktree: { baseRef: 'origin/main' } });
const MOVE_LEDGER = () => ({
    env: { 'settings.json': { ALFRED_CODE_HOOKS_OFF: valueHash('guard-answer') } },
    deny: [{ file: 'settings.json', entry: 'Read(.env)' }, { file: 'settings.json', entry: 'Agent(alfred-code:evidence-gatherer)' }],
    hooks: [],
    settings: { 'settings.json': { 'attribution.commit': valueHash(JSON.stringify('')), 'worktree.baseRef': valueHash(JSON.stringify('head')) } },
});
test('moveToLocal: the ledgered rows leave settings.json, the user\'s rows and a changed row stay, the env keys at their hash come back', () =>
{
    const p = pair(MOVE_SHARED());
    const ledger = MOVE_LEDGER();
    const logs = [];
    const carried = moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'], log: (m) => logs.push(m) });
    assert.deepStrictEqual(carried, { ALFRED_CODE_HOOKS_OFF: 'guard-answer' });
    assert.deepStrictEqual(p.shared(), { enabledPlugins: { 'alfred-code@envoydev': true }, env: { MY_OWN: '1' },
        permissions: { allow: ['Bash(ls)'], deny: ['Read(mine)'] }, worktree: { baseRef: 'origin/main' } });
    assert.strictEqual(p.local(), undefined, 'the move writes nothing to the local file');
    assert.ok(logs.some((l) => l.includes('settings.json: worktree.baseRef stays - changed since the stack wrote it')), logs.join('\n'));
    assert.ok(logs.some((l) => l.includes('settings: 4 rows moved from settings.json to settings.local.json - teammates and cloud sessions no longer get them')), logs.join('\n'));
    assert.strictEqual(ledger.env['settings.json'], undefined);
    assert.strictEqual(ledger.env['settings.local.json'].ALFRED_CODE_HOOKS_OFF, valueHash('guard-answer'));
    assert.deepStrictEqual([ledger.deny, ledger.hooks, (ledger.settings || {})['settings.json']], [[], [], undefined]);
});

test('moveToLocal: a settings.json left with nothing is left as {}', () =>
{
    const p = pair({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer' }, permissions: { deny: ['Read(.env)', 'Agent(alfred-code:evidence-gatherer)'] }, attribution: { commit: '' } });
    const ledger = MOVE_LEDGER();
    delete ledger.settings['settings.json']['worktree.baseRef'];
    moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'] });
    assert.deepStrictEqual(p.shared(), {});
});

test('moveToLocal: a second call moves nothing and says nothing', () =>
{
    const p = pair(MOVE_SHARED());
    const ledger = MOVE_LEDGER();
    moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'] });
    const bytes = fs.readFileSync(p.sharedFile, 'utf8');
    const logs = [];
    assert.deepStrictEqual(moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'], log: (m) => logs.push(m) }), {});
    assert.deepStrictEqual(logs, []);
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), bytes);
});

test('moveToLocal: a ledgered ALFRED_CODE_DOCS_PATH stays, with its row', () =>
{
    const p = pair({ ...MOVE_SHARED(), env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer', ALFRED_CODE_DOCS_PATH: 'docs/x' } });
    const ledger = MOVE_LEDGER();
    ledger.env['settings.json'].ALFRED_CODE_DOCS_PATH = valueHash('docs/x');
    const carried = moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'] });
    assert.strictEqual(p.shared().env.ALFRED_CODE_DOCS_PATH, 'docs/x');
    assert.deepStrictEqual(ledger.env['settings.json'], { ALFRED_CODE_DOCS_PATH: valueHash('docs/x') });
    assert.ok(!Object.hasOwn(carried, 'ALFRED_CODE_DOCS_PATH'));
});

test('moveToLocal: an env key changed since the stack wrote it stays and is named', () =>
{
    const p = pair({ ...MOVE_SHARED(), env: { ALFRED_CODE_HOOKS_OFF: 'other' } });
    const ledger = MOVE_LEDGER();
    const logs = [];
    const carried = moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'], log: (m) => logs.push(m) });
    assert.deepStrictEqual(carried, {});
    assert.strictEqual(p.shared().env.ALFRED_CODE_HOOKS_OFF, 'other');
    assert.ok(logs.some((l) => l.includes('settings.json: env.ALFRED_CODE_HOOKS_OFF stays - changed since the stack wrote it')), logs.join('\n'));
    assert.strictEqual(ledger.env['settings.json'], undefined);
    assert.ok(!Object.hasOwn(ledger.env['settings.local.json'] || {}, 'ALFRED_CODE_HOOKS_OFF'));
});

test('moveToLocal: a settings.json that does not parse is untouched and its rows stay in the ledger', () =>
{
    const p = pair();
    fs.writeFileSync(p.sharedFile, '{nope');
    const ledger = MOVE_LEDGER();
    const notes = [];
    assert.deepStrictEqual(moveToLocal({ claudeDir: p.dir, ledger, shippedDeny: ['Read(.env)'], note: (m) => notes.push(m) }), {});
    assert.strictEqual(fs.readFileSync(p.sharedFile, 'utf8'), '{nope');
    assert.deepStrictEqual(ledger, MOVE_LEDGER());
    assert.strictEqual(notes.length, 1, notes.join('\n'));
});

test('moveToLocal: a hook wiring at its ledger id leaves, one changed by hand stays', () =>
{
    const cmd = (f) => hookCommand(f).command;
    const changed = `${cmd('guard-b.js')} --mine`;
    const p = pair({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd('guard-a.js'), timeout: 10 }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: changed, timeout: 10 }] }] } });
    const ledger = { env: {}, deny: [], settings: {},
        hooks: [{ file: 'settings.json', hook: 'guard-a.js', id: idOf('PreToolUse', 'Bash', 'guard-a.js') }, { file: 'settings.json', hook: 'guard-b.js', id: idOf('PreToolUse', 'Bash', 'guard-b.js') }] };
    moveToLocal({ claudeDir: p.dir, ledger });
    assert.deepStrictEqual(p.shared().hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: changed, timeout: 10 }] }] });
    assert.deepStrictEqual(ledger.hooks, []);
});

// Mode v2 stage 2, Task 4: one file at every scope - at project and user scope a variable the local file held is this
// machine's own override (Rulings 10, 12, 13, 14).
const ownVars = (p, text) =>
{
    const variablesFile = path.join(path.dirname(p.dir), '.alfred', '.variables');
    fs.mkdirSync(path.dirname(variablesFile), { recursive: true });
    if (text !== undefined) fs.writeFileSync(variablesFile, text);
    return variablesFile;
};
const VAR_KEYS = require('../stack/hooks/layout.js').VARIABLE_KEYS;

test('settings-writer: with keepOwn a variable the file held stays there, in its place, unledgered, and .variables is unchanged', () =>
{
    const p = pair(undefined, { env: { FIRST: 'a', ALFRED_CODE_HISTORY: '7', LAST: 'z' } });
    const variablesFile = ownVars(p, 'ALFRED_CODE_HISTORY=1\n');
    const run = () => write(p.localFile, { keepOwn: true, variablesFile, sharedFile: p.sharedFile });
    const first = run();
    assert.deepStrictEqual(Object.keys(first.data.env).slice(0, 3), ['FIRST', 'ALFRED_CODE_HISTORY', 'LAST']);
    assert.strictEqual(first.data.env.ALFRED_CODE_HISTORY, '7');
    assert.match(fs.readFileSync(variablesFile, 'utf8'), /^ALFRED_CODE_HISTORY=1$/m);
    assert.strictEqual(((first.result.managed.env || {})['settings.local.json'] || {}).ALFRED_CODE_HISTORY, undefined);
    const bytes = fs.readFileSync(p.localFile, 'utf8');
    run();
    assert.strictEqual(fs.readFileSync(p.localFile, 'utf8'), bytes, 'a re-run changes no byte');
});

test('settings-writer: with keepOwn an override equal to the team\'s value stays', () =>
{
    const p = pair(undefined, { env: { ALFRED_CODE_HISTORY: '7' } });
    const variablesFile = ownVars(p, 'ALFRED_CODE_HISTORY=7\n');
    for (let i = 0; i < 2; i++) write(p.localFile, { keepOwn: true, variablesFile });
    assert.strictEqual(p.local().env.ALFRED_CODE_HISTORY, '7');
});

test('settings-writer: a rename reaches an override, and the new name never reaches .variables', () =>
{
    const p = pair(undefined, { env: { ALFRED_CODE_SCORER_LEVEL: '85' } });
    const variablesFile = ownVars(p);
    const migrations = { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_SCORING_LEVEL']] };
    write(p.localFile, { keepOwn: true, variablesFile, migrations });
    assert.strictEqual(p.local().env.ALFRED_CODE_SCORING_LEVEL, '85');
    assert.ok(!Object.hasOwn(p.local().env, 'ALFRED_CODE_SCORER_LEVEL'));
    assert.doesNotMatch(fs.existsSync(variablesFile) ? fs.readFileSync(variablesFile, 'utf8') : '', /=85$/m);
});

test('settings-writer: a flag\'s decision for a key the override holds lands in the override', () =>
{
    const p = pair(undefined, { env: { ALFRED_CODE_MEMORY: 'default' } });
    const variablesFile = ownVars(p);
    const r = write(p.localFile, { keepOwn: true, variablesFile, memory: { value: 'custom' } });
    assert.strictEqual(p.local().env.ALFRED_CODE_MEMORY, 'custom');
    assert.ok(r.logs.some((l) => l.includes('variables: ALFRED_CODE_MEMORY set in .claude/settings.local.json (it overrides .variables here)')), r.logs.join('\n'));
});

test('settings-writer: --auto-compact on leaves the mode file\'s own 0 as typed and writes 1 into .variables (mode commands v2)', () =>
{
    const p = pair(undefined, { env: { ALFRED_CODE_AUTO_COMPACT: '0' } });
    const variablesFile = ownVars(p);
    write(p.localFile, { keepOwn: true, variablesFile, autoCompact: { value: '1' } });
    assert.strictEqual(p.local().env.ALFRED_CODE_AUTO_COMPACT, '0', 'the mode file is writeModes\'s (modes.js refresh)');
    assert.match(fs.readFileSync(variablesFile, 'utf8'), /^ALFRED_CODE_AUTO_COMPACT=1$/m);
});

test('settings-writer: carried keys land in the env and keep their ledger row; a key the file holds wins', () =>
{
    const hash = valueHash('guard-answer');
    const ledger = { prior: { env: { 'settings.local.json': { ALFRED_CODE_HOOKS_OFF: hash } } } };
    const p = pair(undefined, {});
    const r = write(p.localFile, { keepOwn: true, carried: { ALFRED_CODE_HOOKS_OFF: 'guard-answer' }, ledger });
    assert.strictEqual(r.data.env.ALFRED_CODE_HOOKS_OFF, 'guard-answer');
    assert.strictEqual(r.result.managed.env['settings.local.json'].ALFRED_CODE_HOOKS_OFF, hash);
    const q = pair(undefined, { env: { ALFRED_CODE_HOOKS_OFF: 'mine' } });
    const s = write(q.localFile, { keepOwn: true, carried: { ALFRED_CODE_HOOKS_OFF: 'guard-answer' }, ledger });
    assert.strictEqual(s.data.env.ALFRED_CODE_HOOKS_OFF, 'mine');
});

// AC10 (Task 5 group C): the stack's old-name row the move carries must not land over the new name the user typed in
// settings.json - the rename would write it to .variables, which outranks settings.json.
test('settings-writer: a carried key whose renamed spelling settings.json holds is not carried, and its line says so', () =>
{
    const p = pair(undefined, {});
    const variablesFile = ownVars(p);
    const migrations = { ...MIGRATIONS, renames: [...MIGRATIONS.renames, ['ALFRED_CODE_SCORER_LEVEL', 'ALFRED_CODE_SCORING_LEVEL']] };
    const r = write(p.localFile, { keepOwn: true, variablesFile, migrations, carried: { ALFRED_CODE_SCORER_LEVEL: '80' },
        inheritedEnv: { ALFRED_CODE_SCORING_LEVEL: '95' } });
    assert.ok(!/SCOR(ER|ING)_LEVEL=80/.test(fs.existsSync(variablesFile) ? fs.readFileSync(variablesFile, 'utf8') : ''), 'the old seed reached .variables');
    assert.ok(!Object.hasOwn((r.data || {}).env || {}, 'ALFRED_CODE_SCORING_LEVEL') && !Object.hasOwn((r.data || {}).env || {}, 'ALFRED_CODE_SCORER_LEVEL'));
    assert.ok(r.logs.some((l) => l.includes('ALFRED_CODE_SCORER_LEVEL not carried - settings.json holds ALFRED_CODE_SCORING_LEVEL')), r.logs.join('\n'));
});

// AC17 (Task 5 group C): a hooks answer keeps the stored part entries of the list that applies - the one beneath when this
// file holds none - and writes no copy that would shadow it with the same value or with an empty list.
test('settings-writer: an answered hooks layer keeps the part entries settings.json holds and writes no shadowing copy', () =>
{
    const p = pair(undefined, {});
    const r = write(p.localFile, { keepOwn: true, hooksAnswered: true, hooksOff: [], inheritedEnv: { ALFRED_CODE_HOOKS_OFF: 'docs-session:gate' } });
    assert.ok(!Object.hasOwn((r.data || {}).env || {}, 'ALFRED_CODE_HOOKS_OFF'), JSON.stringify(r.data));
    const q = pair(undefined, {});
    const s = write(q.localFile, { keepOwn: true, hooksAnswered: true, hooksOff: ['guard-a'], inheritedEnv: { ALFRED_CODE_HOOKS_OFF: 'docs-session:gate' } });
    assert.deepStrictEqual(s.data.env.ALFRED_CODE_HOOKS_OFF.split(',').sort(), ['docs-session:gate', 'guard-a']);
});

test('settings-writer: custom memory writes its switch-off in the one file; a native-memory override keeps it out', () =>
{
    const p = pair(undefined, {});
    const r = write(p.localFile, { keepOwn: true, variablesFile: ownVars(p, 'ALFRED_CODE_MEMORY=custom\n') });
    assert.strictEqual(r.data.autoMemoryEnabled, false);
    assert.strictEqual(r.result.managed.settings['settings.local.json'].autoMemoryEnabled, valueHash(JSON.stringify(false)));
    const q = pair(undefined, { env: { ALFRED_CODE_MEMORY: 'default' } });
    const s = write(q.localFile, { keepOwn: true, variablesFile: ownVars(q, 'ALFRED_CODE_MEMORY=custom\n') });
    assert.ok(!Object.hasOwn(s.data, 'autoMemoryEnabled'), JSON.stringify(s.data));
});

test('settings-writer: with keepOwn a .variables that cannot be written leaves no un-held variable in the file',
    { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
    {
        const p = pair(undefined, { env: { ALFRED_CODE_HISTORY: '7' } });
        const variablesFile = ownVars(p);
        let r;
        try
        {
            fs.chmodSync(path.dirname(variablesFile), 0o555);
            r = write(p.localFile, { keepOwn: true, variablesFile });
        }
        finally { fs.chmodSync(path.dirname(variablesFile), 0o755); }
        assert.deepStrictEqual(Object.keys(r.data.env).filter((k) => VAR_KEYS.includes(k)), ['ALFRED_CODE_HISTORY'], JSON.stringify(r.data.env));
        assert.ok(r.logs.some((l) => l.includes('is not writable - nothing moved;')), r.logs.join('\n'));
        write(p.localFile, { keepOwn: true, variablesFile });
        assert.ok(fs.existsSync(variablesFile) && fs.readFileSync(variablesFile, 'utf8').trim(), 'the next run seeds .variables');
    });

// Final review finding 1: a decision the move carried out of settings.json is not lost when .variables cannot be written
// on that run - it stays in the local file with its ledger row, so 'nothing moved' is true.
test('settings-writer: with keepOwn a carried decision stays in the local file, ledgered, when .variables cannot be written',
    { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
    {
        const hash = valueHash('custom');
        const ledger = { prior: { env: { 'settings.local.json': { ALFRED_CODE_MEMORY: hash } } } };
        const p = pair(undefined, {});
        const variablesFile = ownVars(p);
        let r;
        try
        {
            fs.chmodSync(path.dirname(variablesFile), 0o555);
            r = write(p.localFile, { keepOwn: true, variablesFile, carried: { ALFRED_CODE_MEMORY: 'custom' }, ledger });
        }
        finally { fs.chmodSync(path.dirname(variablesFile), 0o755); }
        assert.strictEqual(r.data.env.ALFRED_CODE_MEMORY, 'custom', JSON.stringify(r.data.env));
        assert.strictEqual(r.result.managed.env['settings.local.json'].ALFRED_CODE_MEMORY, hash);
    });

// Final review finding 2: a seed the stack wrote in the local file (an ignored or unwritable .variables) is the stack's row,
// not this machine's override - once .variables can be written it moves there; a value the user chose stays.
test('settings-writer: with keepOwn a stack seed at its local ledger row moves to .variables; a chosen value stays', () =>
{
    const ledger = { prior: { env: { 'settings.local.json': { ALFRED_CODE_TURN_CHECK: valueHash('0'), ALFRED_CODE_HISTORY: valueHash('7') } } } };
    const p = pair(undefined, { env: { ALFRED_CODE_TURN_CHECK: '0', ALFRED_CODE_HISTORY: '7' } });
    const variablesFile = ownVars(p);
    const r = write(p.localFile, { keepOwn: true, variablesFile, ledger });
    const vars = fs.existsSync(variablesFile) ? fs.readFileSync(variablesFile, 'utf8') : '';
    assert.match(vars, /^ALFRED_CODE_TURN_CHECK=0$/m);
    assert.ok(!Object.hasOwn(r.data.env, 'ALFRED_CODE_TURN_CHECK'), JSON.stringify(r.data.env));
    assert.strictEqual(r.data.env.ALFRED_CODE_HISTORY, '7');
    assert.doesNotMatch(vars, /^ALFRED_CODE_HISTORY=7$/m);
});

test('settings-writer: the stale-row pass re-keys a renamed skillOverrides key in settings.json where it sits and adds nothing', () =>
{
    const renamed = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).renamed;
    const old = Object.keys(renamed.skills).find((k) => renamed.skills[k] === 'loop-code-quality');
    const p = pair({ env: { MINE: '1' }, skillOverrides: { [old]: 'off' } }, {});
    const r = write(p.localFile, { keepOwn: true, sharedFile: p.sharedFile, renamed });
    assert.deepStrictEqual(p.shared(), { env: { MINE: '1' }, skillOverrides: { 'loop-code-quality': 'off' } });
    assert.ok(r.logs.some((l) => l.includes('settings.json: the stack\'s stale rows removed (the stack writes settings.local.json)')), r.logs.join('\n'));
});

// Task 5's stops (A, B and the seat spelling): what the stale-row pass on settings.json still takes at project and user scope -
// a docs key the docs step cleared, a retired server's approval, a renamed seat's deny - and leaves at local scope.
test('settings-writer: at project scope the stale-row pass drops a cleared docs key and a retired approval, and re-spells a renamed seat\'s deny', () =>
{
    const renamed = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).renamed;
    const [oldSeat, newSeat] = Object.entries(renamed.agents)[0];
    const shared = { env: { ALFRED_CODE_DOCS_PATH: 'docs-x', MINE: '1' }, enabledMcpjsonServers: ['alfred-memory', 'mine'],
        permissions: { deny: [`Agent(alfred-code:${oldSeat})`, 'Read(mine)'] } };
    const opts = (p, keepOwn) => ({ keepOwn, sharedFile: p.sharedFile, renamed, mcpOff: ['alfred-memory'], docsPath: { remove: true, why: 'the docs moved' } });
    const p = pair(shared, {});
    const r = write(p.localFile, opts(p, true));
    assert.deepStrictEqual(p.shared(), { env: { MINE: '1' }, enabledMcpjsonServers: ['mine'],
        permissions: { deny: [`Agent(alfred-code:${newSeat})`, 'Read(mine)'] } });
    assert.ok(r.logs.some((l) => l.includes('settings.json env: ALFRED_CODE_DOCS_PATH \'docs-x\' removed (the docs moved)')), r.logs.join('\n'));
    const q = pair(shared, {});
    const bytes = fs.readFileSync(q.sharedFile, 'utf8');
    write(q.localFile, opts(q, false));
    assert.strictEqual(fs.readFileSync(q.sharedFile, 'utf8'), bytes, 'a local-scope run leaves the team file as it was');
});
