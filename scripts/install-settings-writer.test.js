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

const { writeSettings, applyEnv, hookCommand, HOOK_TIMEOUT, readMergedSettings } = require('./install/settings.js');
const { envMigrations } = require('./install/env-migrations.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-settings-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const CATALOG = require('../meta/environment.json').env;
const MIGRATIONS = {
    renames: [['CLAUDE_DOCS_PATH', 'ALFRED_CODE_DOCS_PATH']],
    retired: [['CLAUDE_STACK_FRESH_SESSION_PCT', null], ['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', '40']],
    reseed: [['ALFRED_CODE_FRESH_SESSION_DEFAULT', '250000', '180000']],
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

test('settings-writer: the instrument hook is env-gated so it costs nothing when off', () =>
{
    assert.match(hookCommand('instrument-tool-usage.js', '').command, /^\[ "\$ALFRED_CODE_INSTRUMENT" != "1" \] \|\| /);
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

test('settings-writer: enabledMcpjsonServers gains what we register and loses what we unregistered', () =>
{
    const file = settingsFile({ enabledMcpjsonServers: ['serena', 'context7', 'theirs'] });
    const { data } = write(file, { mcpNames: ['playwright-chrome'], mcpOff: ['serena', 'context7'] });
    assert.deepStrictEqual(data.enabledMcpjsonServers, ['theirs', 'playwright-chrome'],
        'a leftover entry names a .mcp.json server that no longer exists - dead config that reads like a knob');
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
    const { env } = envPass({ CLAUDE_DOCS_PATH: 'docs/mine' });
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'docs/mine',
        'the seed ran first and wrote the default over the user\'s value');
    assert.ok(!('CLAUDE_DOCS_PATH' in env), 'the old key survived the rename');
});

test('settings-env: a rename never overwrites a value already set under the NEW name', () =>
{
    const { env } = envPass({ CLAUDE_DOCS_PATH: 'old', ALFRED_CODE_DOCS_PATH: 'new' });
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'new');
    assert.ok(!('CLAUDE_DOCS_PATH' in env));
});

test('settings-env: a RETIRED key is dropped, and a conditional one only at its old seed', () =>
{
    const dropped = envPass({ CLAUDE_STACK_FRESH_SESSION_PCT: '40' }).env;
    assert.ok(!('CLAUDE_STACK_FRESH_SESSION_PCT' in dropped));

    const atSeed = envPass({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' }).env;
    assert.ok(!('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' in atSeed), 'the stack\'s own old seed was kept');

    const theirs = envPass({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '75' }).env;
    assert.strictEqual(theirs.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '75',
        'a value the user set by hand was removed - the stack does not own that key');
});

test('settings-env: a BAD SEED is corrected only while it still holds that seed', () =>
{
    assert.strictEqual(envPass({ ALFRED_CODE_FRESH_SESSION_DEFAULT: '250000' }).env.ALFRED_CODE_FRESH_SESSION_DEFAULT, '180000');
    assert.strictEqual(envPass({ ALFRED_CODE_FRESH_SESSION_DEFAULT: '120000' }).env.ALFRED_CODE_FRESH_SESSION_DEFAULT, '120000',
        'a tuned value was reset to the stack\'s number');
});

test('settings-env: the SEEDS come from the catalog, absent-only, and never touch a set value', () =>
{
    const { env } = envPass({ ALFRED_CODE_INSTRUMENT: '1' });
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, '1', 'an absent-only seed overwrote a deliberate value');
    for (const row of CATALOG)
        if (!row.written && row.key !== 'ALFRED_CODE_DOCS_VERSIONING')
            assert.ok(row.key in env, `the catalog key ${row.key} was not seeded`);
});

test('settings-env: the WRITTEN key overwrites, because it tracks this run\'s choice', () =>
{
    const { env } = envPass({ ALFRED_CODE_MEMORY_DB: '/old/memory.db' }, { memoryDb: '/new/memory.db' });
    assert.strictEqual(env.ALFRED_CODE_MEMORY_DB, '/new/memory.db', 'a level change did not land - the launcher keeps the old db');
});

test('settings-env: the retired sentry auth key goes under either spelling, and the SENTRY_* keys stay', () =>
{
    const migrations = envMigrations(require('../meta/migrations.json'));
    for (const key of ['ALFRED_CODE_SENTRY_AUTH', 'CLAUDE_STACK_SENTRY_AUTH']) // legacy-name
    {
        const env = { [key]: 'token', SENTRY_SLUG: 'acme', SENTRY_ACCESS_TOKEN: 'kept' };
        applyEnv(env, { catalog: CATALOG, migrations, log: () => {} });
        assert.ok(!('ALFRED_CODE_SENTRY_AUTH' in env) && !(key in env), `${key} outlived the 2.0.0 cut`);
        assert.strictEqual(env.SENTRY_SLUG, 'acme');
        assert.strictEqual(env.SENTRY_ACCESS_TOKEN, 'kept');
    }
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
        agentDeny: ['Agent(alfred-code:evidence-gatherer)', 'Agent(claude-stack-aspnet:aspnet-verifier)'],
    });
    assert.ok(data.permissions.deny.includes('Agent(alfred-code:evidence-gatherer)'));
    assert.ok(data.permissions.deny.includes('Agent(claude-stack-aspnet:aspnet-verifier)'));
    assert.ok(data.permissions.deny.includes('Agent(my-own-seat)'), "the project's own Agent rule was dropped");
    assert.ok(data.permissions.deny.includes('Read(./private)'), "the project's own Read rule was dropped");
    assert.ok(data.permissions.deny.includes('Read(./.env)'), 'the secret blocks still land beside them');
});

test('settings-writer: a retired entry seat deny is re-spelled to the core, so the seat stays off; the rest is untouched', () =>
{
    const file = settingsFile({ permissions: { deny: ['Agent(claude-stack-angular:angular-test-resolver)', 'Agent(alfred-code:security-auditor)', 'Agent(my-own-seat)', 'Read(./.env)'] } });
    const { data, logs } = write(file, { retiredEntries: ['claude-stack-angular'], liveEntries: [], agentDeny: ['Agent(alfred-code:security-auditor)'] });
    assert.deepStrictEqual(data.permissions.deny.slice().sort(), ['Agent(alfred-code:angular-test-resolver)', 'Agent(alfred-code:security-auditor)', 'Agent(my-own-seat)', 'Read(./.env)']);
    assert.ok(logs.some((m) => /angular-test-resolver/.test(m) && /retired/.test(m)), logs.join('\n'));
    const again = write(file, { retiredEntries: ['claude-stack-angular'], liveEntries: [], agentDeny: ['Agent(alfred-code:security-auditor)'] });
    assert.strictEqual(again.result.written, false, 'a second run changes nothing');
});

// Claude Code matches a seat's deny by its exact home spelling, so while the retired entry is still
// installed (kept at another scope, a refused uninstall, a blind listing, an install run) the seat
// loads under the OLD name - dropping that spelling would switch the user's seat back on.
test('settings-writer: a retired entry still installed keeps the user\'s deny spelling beside the core one', () =>
{
    const file = settingsFile({ permissions: { deny: ['Agent(claude-stack-aspnet:aspnet-verifier)'] } });
    const live = write(file, { retiredEntries: ['claude-stack-aspnet'], liveEntries: ['claude-stack-aspnet'], agentDeny: ['Agent(alfred-code:security-auditor)'] });
    assert.ok(live.data.permissions.deny.includes('Agent(claude-stack-aspnet:aspnet-verifier)'), live.data.permissions.deny.join(','));
    assert.ok(live.data.permissions.deny.includes('Agent(alfred-code:aspnet-verifier)'), live.data.permissions.deny.join(','));
    const unknown = write(settingsFile({ permissions: { deny: ['Agent(claude-stack-aspnet:aspnet-verifier)'] } }), { retiredEntries: ['claude-stack-aspnet'] });
    assert.ok(unknown.data.permissions.deny.includes('Agent(claude-stack-aspnet:aspnet-verifier)'), 'a caller that cannot say keeps it');
    const gone = write(file, { retiredEntries: ['claude-stack-aspnet'], liveEntries: [], agentDeny: ['Agent(alfred-code:security-auditor)'] });
    assert.deepStrictEqual(gone.data.permissions.deny.filter((d) => /aspnet-verifier/.test(d)), ['Agent(alfred-code:aspnet-verifier)'], 'once the entry is gone only the core spelling stays');
});

test('settings-writer: a seat the selection now KEEPS has its deny cleared', () =>
{
    // The failure this prevents: a user adds a seat back through configure, the install enables its
    // plugin, and a stale deny from the previous run silently drops the seat they just asked for.
    const file = settingsFile({ permissions: { deny: ['Agent(claude-stack-aspnet:aspnet-verifier)', 'Agent(my-own-seat)'] } });
    const { data, logs } = write(file, { agentAllow: ['Agent(claude-stack-aspnet:aspnet-verifier)'] });
    assert.ok(!data.permissions.deny.includes('Agent(claude-stack-aspnet:aspnet-verifier)'));
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
    const file = settingsFile({ permissions: { deny: ['Agent(claude-stack-old:security-auditor)', 'Agent(claude-stack-old:evidence-gatherer)', 'Agent(my-own:security-auditor)'] } });
    const { data } = write(file, {
        agentDeny: ['Agent(alfred-code:security-auditor)'],
        agentAllow: ['Agent(alfred-code:evidence-gatherer)'],
    });
    assert.deepStrictEqual(data.permissions.deny, ['Agent(my-own:security-auditor)', 'Agent(alfred-code:security-auditor)']);
});

// 2.0.0 renamed the core. A 1.x seat deny `Agent(claude-stack:<seat>)` still blocks the renamed seat // legacy-name
// (docs/rebrand-evidence.md S6), but the settings stay in ONE spelling (ruling R7): the old core is
// the retired home whose new spelling is the core, one more row of the retired-entry re-spell.
const OLD_CORE = 'claude-stack'; // legacy-name

test('settings-writer: a 1.x core seat deny is re-spelled to the new core, and a hand-written foreign home is left alone', () =>
{
    const file = settingsFile({ permissions: { deny: [`Agent(${OLD_CORE}:seat-a)`, 'Agent(other:seat-a)', 'Read(./.env)'] } });
    const { data, logs } = write(file);
    assert.deepStrictEqual(data.permissions.deny.slice().sort(), ['Agent(alfred-code:seat-a)', 'Agent(other:seat-a)', 'Read(./.env)']);
    assert.ok(logs.some((m) => m.includes(`Agent(${OLD_CORE}:seat-a)`) && m.includes('Agent(alfred-code:seat-a)')), logs.join('\n'));
    assert.strictEqual(write(file).result.written, false, 'a second run changes nothing');
});

test('settings-writer: while the listing still shows the 1.x core (a rename no session has taken yet), both spellings stay', () =>
{
    const file = settingsFile({ permissions: { deny: [`Agent(${OLD_CORE}:seat-a)`] } });
    const pending = write(file, { liveEntries: [OLD_CORE] });
    assert.deepStrictEqual(pending.data.permissions.deny.slice().sort(), ['Agent(alfred-code:seat-a)', `Agent(${OLD_CORE}:seat-a)`]);
    const renamed = write(file, { liveEntries: [] });
    assert.deepStrictEqual(renamed.data.permissions.deny, ['Agent(alfred-code:seat-a)']);
});

test('settings-writer: a 1.x seat deny the selection now KEEPS is cleared under either spelling', () =>
{
    const file = settingsFile({ permissions: { deny: [`Agent(${OLD_CORE}:seat-a)`, `Agent(${OLD_CORE}:seat-b)`] } });
    const { data } = write(file, { agentDeny: ['Agent(alfred-code:seat-b)'], agentAllow: ['Agent(alfred-code:seat-a)'] });
    assert.deepStrictEqual(data.permissions.deny, ['Agent(alfred-code:seat-b)']);
});

// T16 (R29): a `local`-scope run writes settings.local.json, never settings.json - a reader that
// needs the EFFECTIVE state (--installed-only's read-back) has to see both.
test('readMergedSettings: local extends/overrides the shared file - the shape a local-scope install actually runs with', () =>
{
    const dir = path.join(TMP, `merge-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        env: { ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_HOOKS_OFF: '' },
        permissions: { deny: ['Read(.env)'] },
        enabledMcpjsonServers: ['memory'],
        skillOverrides: { csharp: 'off' },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }] }] },
    }));
    const merged = readMergedSettings(dir);
    // Nothing local yet - the merge is just the shared file.
    assert.deepStrictEqual(merged.env, { ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_HOOKS_OFF: '' });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
        env: { ALFRED_CODE_HOOKS_OFF: 'guard-a' },
        permissions: { deny: ['Read(.env.local)'] },
        enabledMcpjsonServers: ['serena'],
        skillOverrides: { csharp: 'name-only' },
        hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'b' }] }] },
    }));
    const both = readMergedSettings(dir);
    // env: local's value wins per key, the project's own untouched keys survive.
    assert.deepStrictEqual(both.env, { ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_HOOKS_OFF: 'guard-a' });
    // permissions.deny and enabledMcpjsonServers: UNION, not replace.
    assert.deepStrictEqual(both.permissions.deny.sort(), ['Read(.env)', 'Read(.env.local)']);
    assert.deepStrictEqual(both.enabledMcpjsonServers.sort(), ['memory', 'serena']);
    // skillOverrides: local wins per key.
    assert.deepStrictEqual(both.skillOverrides, { csharp: 'name-only' });
    // hooks: each event's OWN entries union, project's kept.
    assert.strictEqual(both.hooks.PreToolUse.length, 2);
});

test('readMergedSettings: no local file at all reads exactly like settings.json alone, and a malformed local file is skipped, not a crash', () =>
{
    const dir = path.join(TMP, `merge-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { A: '1' } }));
    assert.deepStrictEqual(readMergedSettings(dir).env, { A: '1' });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{ not json');
    assert.deepStrictEqual(readMergedSettings(dir).env, { A: '1' }, 'a local file that does not parse is skipped, never a crash');
});
