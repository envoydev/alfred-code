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
        env: { BOTH: 'local', LOCAL_ONLY: '1', ALFRED_CODE_HOOKS_OFF: 'guard-answer-length', CLAUDE_STACK_INSTRUMENT: '1' }, // legacy-name
        permissions: { deny: ['Agent(alfred-code:b)', 'Agent(alfred-code:a)'] }, hooks: { PreToolUse: [] },
    }));
    for (const scope of ['project', 'user'])
    {
        const r = readBackSettings(dir, scope);
        assert.deepStrictEqual(r.env, {
            ALFRED_CODE_HOOKS_OFF: 'guard-answer-length', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared',
            CLAUDE_STACK_INSTRUMENT: '1', // legacy-name
        }, `${scope}: the stack keys the local file holds win, nothing else of it is read`);
        assert.deepStrictEqual(r.permissions.deny, ['Agent(alfred-code:a)'], `${scope}: deny is the shared file's`);
        assert.deepStrictEqual(r.hooks, sharedHooks, `${scope}: hooks are the shared file's`);
        assert.deepStrictEqual(readBackSettings(dir, scope, { sharedOnly: true }).env,
            { ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'shared' }, `${scope}: sharedOnly reads settings.json alone`);
    }
    const merged = readBackSettings(dir, 'local');
    assert.deepStrictEqual(merged.env, {
        ALFRED_CODE_HOOKS_OFF: 'guard-answer-length', ALFRED_CODE_PUSH_GATE: '1', SHARED_ONLY: '1', BOTH: 'local', LOCAL_ONLY: '1',
        CLAUDE_STACK_INSTRUMENT: '1', // legacy-name
    });
    assert.deepStrictEqual(merged.permissions.deny, ['Agent(alfred-code:a)', 'Agent(alfred-code:b)']);
    assert.deepStrictEqual(merged.permissions.allow, ['Bash(ls:*)']);
    // A local key wins even when it is the empty list - Claude Code reads it the same way.
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: '' } }));
    assert.strictEqual(readBackSettings(dir, 'local').env.ALFRED_CODE_HOOKS_OFF, '');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } }));
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
        env: { ALFRED_CODE_HOOKS_OFF: 'guard-answer-length', ALFRED_CODE_FRESH_SESSION_DEFAULT: '250000', ALFRED_CODE_DOCS_VERSIONING: 'local', CLAUDE_STACK_MONITOR: 'inject', MY_OWN: 'x' }, // legacy-name
        permissions: { allow: ['Bash(ls)'] },
    }));
    const logs = [];
    const opts = {
        file: sharedFile, localFile, catalog: CATALOG, migrations: { ...MIGRATIONS, prefixRenames: [['CLAUDE_STACK_', 'ALFRED_CODE_']] }, // legacy-name
        hooksOff: ['guard-answer-length', 'guard-secret-value'], hooksAnswered: true, docsVersioning: { value: 'git', seed: 'git' },
    };
    writeSettings({ ...opts, log: (m) => logs.push(m) });
    const shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    assert.deepStrictEqual(local.env, {
        ALFRED_CODE_HOOKS_OFF: 'guard-answer-length,guard-secret-value', ALFRED_CODE_FRESH_SESSION_DEFAULT: '180000',
        ALFRED_CODE_DOCS_VERSIONING: 'git', ALFRED_CODE_MONITOR: 'inject', MY_OWN: 'x',
    }, 'the answer, the decision, the reseed and the rename land where the key applies');
    assert.deepStrictEqual(local.permissions, { allow: ['Bash(ls)'] }, 'nothing else of the local file is touched');
    for (const key of ['ALFRED_CODE_HOOKS_OFF', 'ALFRED_CODE_FRESH_SESSION_DEFAULT', 'ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_MONITOR'])
        assert.ok(!(key in shared.env), `${key} reached settings.json, where the local value shadows it`);
    assert.strictEqual(shared.env.ALFRED_CODE_PUSH_GATE, '1', 'a key the local file lacks is seeded in settings.json as before');
    assert.strictEqual(shared.env.TEAM, 'y');
    const text = logs.join('\n');
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_HOOKS_OFF = guard-answer-length,guard-secret-value/);
    assert.match(text, /settings\.local\.json env: ALFRED_CODE_FRESH_SESSION_DEFAULT reset to 180000/);
    assert.match(text, /settings\.local\.json env: CLAUDE_STACK_MONITOR renamed to ALFRED_CODE_MONITOR/); // legacy-name
    assert.match(text, /settings\.json env: ALFRED_CODE_PUSH_GATE seeded/);

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
    assert.strictEqual(JSON.parse(fs.readFileSync(sharedFile, 'utf8')).env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-length,guard-secret-value');
});

// N6 (Task 16b): at local scope settings.json still applies beneath the file this run writes, so a key
// it holds is PRESENT for every absent-only seed - the catalog seeds, the docs-versioning seed and the
// unanswered ALFRED_CODE_HOOKS_OFF seed. A local default would hide it. What the run DECIDES (an
// answered hooks layer, --docs-versioning, the memory db) still lands in the local file.
test('settings-env: an inherited key counts as present for every absent-only seed, never for a decision (N6)', () =>
{
    const inherited = {
        ALFRED_CODE_DOCS_PATH: 'docs/gen', ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_HISTORY: '0', ALFRED_CODE_TURN_CHECK: '1',
        ALFRED_CODE_DOCS_VERSIONING: 'local', ALFRED_CODE_HOOKS_OFF: 'guard-answer-length',
    };
    const { env } = envPass({}, { inherited, docsVersioning: { seed: 'git' } });
    for (const key of Object.keys(inherited)) assert.ok(!(key in env), `N6: ${key} was seeded over the inherited '${inherited[key]}'`);
    assert.strictEqual(env.ALFRED_CODE_INSTRUMENT, '0', 'a key the inherited view lacks is still seeded');

    // A legacy spelling there is the same key: renamed on read, so the new spelling is not seeded over it.
    const legacy = envPass({}, { inherited: { CLAUDE_STACK_PUSH_GATE: '0', CLAUDE_DOCS_PATH: 'docs/old' }, migrations: { ...MIGRATIONS, prefixRenames: [['CLAUDE_STACK_', 'ALFRED_CODE_']] } }).env; // legacy-name
    assert.ok(!('ALFRED_CODE_PUSH_GATE' in legacy) && !('ALFRED_CODE_DOCS_PATH' in legacy), JSON.stringify(legacy));

    // Decisions still write the local file.
    const decided = envPass({}, { inherited, hooksOff: ['check-turn-build'], hooksAnswered: true, docsVersioning: { value: 'git' }, memoryDb: '/db' }).env;
    assert.strictEqual(decided.ALFRED_CODE_HOOKS_OFF, 'check-turn-build');
    assert.strictEqual(decided.ALFRED_CODE_DOCS_VERSIONING, 'git');
    assert.strictEqual(decided.ALFRED_CODE_MEMORY_DB, '/db');

    // A malformed inherited view (not an object) is no view: every seed lands, as before.
    for (const bad of [null, 'x', ['a']])
        assert.strictEqual(envPass({}, { inherited: bad }).env.ALFRED_CODE_PUSH_GATE, '1');
});

test('settings-writer: writeSettings passes inheritedEnv through - the local file never shadows the shared value (N6)', () =>
{
    const dir = path.join(TMP, `inherit-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const shared = { env: { ALFRED_CODE_DOCS_PATH: 'docs/gen', ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_HOOKS_OFF: 'guard-answer-length' } };
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(shared));
    writeSettings({ file: path.join(dir, 'settings.local.json'), catalog: CATALOG, migrations: MIGRATIONS, inheritedEnv: shared.env, docsVersioning: { seed: 'git' } });
    const env = readBackSettings(dir, 'local').env;
    assert.strictEqual(env.ALFRED_CODE_DOCS_PATH, 'docs/gen');
    assert.strictEqual(env.ALFRED_CODE_PUSH_GATE, '0');
    assert.strictEqual(env.ALFRED_CODE_HOOKS_OFF, 'guard-answer-length');
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
// stays in settings.local.json, untouched, logged once with the value that now applies.
test('leaveLocalScope: seed-valued stack keys leave, a value the user set stays local, seat denies move (R78, R96)', () =>
{
    const dir = path.join(TMP, `leave-${seq++}`, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    const cmd = hookCommand('guard-catastrophic-rm.js').command;
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_MONITOR: 'inject', TEAM: 'y' }, permissions: { deny: ['Read(secret)'] } }));
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
        env: {
            ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_HOOKS_OFF: 'guard-answer-length',
            ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/other-repo', ALFRED_CODE_API_TOKEN: 'abc123',
            ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_MONITOR: 'log', ALFRED_CODE_TURN_CHECK: 0,
            ALFRED_CODE_MEMORY_DB: '/elsewhere/.memory-mcp/memory.db', MY_OWN: 'x',
        },
        permissions: { allow: ['Bash(ls)'], deny: ['Agent(alfred-code:evidence-gatherer)', 'Read(.env)', 'Bash(rm:*)'] },
        enabledMcpjsonServers: ['serena', 'mine'],
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: cmd }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
        autoMemoryEnabled: false,
    }));
    const seeds = { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_HOOKS_OFF: '', ALFRED_CODE_INSTRUMENT: '0', ALFRED_CODE_MONITOR: 'log', ALFRED_CODE_TURN_CHECK: '0' };
    const opts = { claudeDir: dir, hookFiles: ['guard-catastrophic-rm.js'], mcpNames: ['serena'], denySpecs: ['Read(.env)'], seeds, written: ['ALFRED_CODE_MEMORY_DB'] };
    const logs = [];
    const out = leaveLocalScope({ ...opts, log: (m) => logs.push(m) });
    assert.strictEqual(out.moved, true);
    const local = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    const shared = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.deepStrictEqual(local.env, {
        ALFRED_CODE_PUSH_GATE: '0', ALFRED_CODE_DOCS_PATH: 'docs/mine', ALFRED_CODE_HOOKS_OFF: 'guard-answer-length',
        ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '/elsewhere/other-repo', ALFRED_CODE_API_TOKEN: 'abc123', ALFRED_CODE_TURN_CHECK: 0, MY_OWN: 'x',
    }, 'a value the user set stays local, untouched; a seed-valued key and a written key leave');
    assert.deepStrictEqual(shared.env, { ALFRED_CODE_PUSH_GATE: '1', ALFRED_CODE_MONITOR: 'inject', TEAM: 'y' }, 'no env key ever moves into settings.json');
    assert.deepStrictEqual(local.permissions, { allow: ['Bash(ls)'], deny: ['Bash(rm:*)'] });
    assert.deepStrictEqual(local.enabledMcpjsonServers, ['mine']);
    assert.deepStrictEqual(local.hooks, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] });
    assert.strictEqual(local.autoMemoryEnabled, false, 'a key the stack does not own by name is left alone');
    assert.deepStrictEqual(shared.permissions.deny, ['Read(secret)', 'Agent(alfred-code:evidence-gatherer)', 'Read(.env)']);
    const text = logs.join('\n');
    // Each kept key is logged once, with the value that now applies - the local one.
    assert.match(text, /settings\.local\.json: ALFRED_CODE_HOOKS_OFF stays here - your value 'guard-answer-length' applies over settings\.json/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_PUSH_GATE stays here - your value '0' applies over settings\.json \('1'\)/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_ALLOW_WRITE_OUTSIDE stays here - your value '\/elsewhere\/other-repo' applies/);
    assert.strictEqual((text.match(/ALFRED_CODE_HOOKS_OFF/g) || []).length, 1, 'logged once');
    // A removed key names what applies from here on.
    assert.match(text, /settings\.local\.json: ALFRED_CODE_MONITOR removed - the stack's own seed \('log'\); settings\.json's 'inject' applies/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_INSTRUMENT removed - the stack's own seed \('0'\); settings\.json gets the same seed/);
    assert.match(text, /settings\.local\.json: ALFRED_CODE_MEMORY_DB removed - the stack writes it every run, to settings\.json from here on/);
    // A credential-shaped key is named by its length, never its value.
    assert.match(text, /ALFRED_CODE_API_TOKEN stays here - your value \(set, 6 chars\) applies/);
    assert.ok(!/abc123/.test(text), 'a credential value reached the log');

    // Idempotent: a second move finds nothing to carry and writes nothing.
    const before = fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8');
    const again = [];
    assert.strictEqual(leaveLocalScope({ ...opts, log: (m) => again.push(m) }).moved, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'), before);
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
