'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRELUDE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const { hookDisabled, yieldToCopiedTwin, aliasYieldsToCore, standDown, neverSetUp } = require(PRELUDE);
const { spawnSync, execFileSync } = require('node:child_process');
const { coreEntry } = require('./build-marketplace.js');

function project(settings)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    if (settings !== null) fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), settings);
    return dir;
}

const wiring = (file) => JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"$CLAUDE_PROJECT_DIR/.claude/hooks/${file}"`, timeout: 10 }] }] },
});

test('ALFRED_CODE_HOOKS_OFF names hooks exactly, with or without the .js suffix', () => {
    const env = { ALFRED_CODE_HOOKS_OFF: 'guard-secret-value, docs-session.js' };
    assert.strictEqual(hookDisabled('guard-secret-value', env), true);
    assert.strictEqual(hookDisabled('guard-secret-value.js', env), true);
    assert.strictEqual(hookDisabled('docs-session', env), true);
    assert.strictEqual(hookDisabled('GUARD-SECRET-VALUE', env), true, 'case is not a way to miss');
    assert.strictEqual(hookDisabled('guard-secret', env), false, 'a prefix is NOT a match');
    assert.strictEqual(hookDisabled('guard-secret-value-extra', env), false);
    assert.strictEqual(hookDisabled('guard-stop-contract', env), false);
});

test('an empty, absent or junk ALFRED_CODE_HOOKS_OFF disables nothing', () => {
    for (const value of [undefined, '', '   ', ',', ' , , '])
        assert.strictEqual(hookDisabled('guard-secret-value', { ALFRED_CODE_HOOKS_OFF: value }), false,
            `value ${JSON.stringify(value)} must disable nothing`);
});

test('a COPIED hook never yields - only the plugin copy steps aside', () => {
    const dir = project(wiring('guard-secret-value.js'));
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir }), false,
        'no CLAUDE_PLUGIN_ROOT means this IS the copied hook');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the plugin copy yields when the project still wires its own twin, and only then', () => {
    const dir = project(wiring('guard-secret-value.js'));
    const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/somewhere/plugin' };
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', env), true);
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value', env), true, 'the suffix is optional');
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', env), false,
        'a different hook being wired is not this hook being wired');
    fs.rmSync(dir, { recursive: true, force: true });
});

// M4 (Task 16 review, R54): a LOCAL-scope copy-route install wires its hooks in settings.local.json -
// a plugin copy beside it that read settings.json alone fired every guard twice.
test('the plugin copy yields to a twin wired in settings.local.json too (M4)', () => {
    const dir = project(JSON.stringify({ env: {} }));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), wiring('guard-secret-value.js'));
    const env = { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/somewhere/plugin' };
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', env), true);
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', env), false);
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{ not json');
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', env), false, 'a malformed local file fails open');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('an unquoted legacy wiring counts too - both spellings shipped', () => {
    const dir = project(JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js' }] }] },
    }));
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/p' }), true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('a hook wired from somewhere else is not a twin', () => {
    const dir = project(JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: '/Users/someone/own-hooks/guard-stop-contract.js' }] }] },
    }));
    assert.strictEqual(yieldToCopiedTwin('guard-stop-contract.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: '/p' }), false,
        'the user may run their own copy of a same-named hook, and the plugin must not go silent for it');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('both gates FAIL OPEN - a missing, empty or malformed settings file yields nothing and throws nothing', () => {
    const plugin = '/somewhere/plugin';
    for (const body of [null, '', '{', '{"hooks": null}', '[]', 'null'])
    {
        const dir = project(body);
        assert.doesNotThrow(() => yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: plugin }),
            `body ${JSON.stringify(body)} must not throw`);
        assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: plugin }), false,
            `body ${JSON.stringify(body)} must not silence the plugin hook`);
        fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(yieldToCopiedTwin('guard-secret-value.js', { CLAUDE_PLUGIN_ROOT: plugin }), false,
        'no project dir at all is not a reason to go silent');
});

// GATE 5 - the hook profile. The core's `hook_profile` userConfig reaches every plugin hook as
// CLAUDE_PLUGIN_OPTION_HOOK_PROFILE; the project's csv still wins over it.
const PROFILE = 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE';
const EVERY_HOOK = ['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push', 'guard-read-whole-file', 'guard-ungated-commit',
    'guard-stop-contract', 'guard-cross-project-write', 'docs-session', 'history-session', 'check-turn-build', 'monitor-session'];

test('profile minimal keeps only the rm, secret and force-push guards; every other hook stands down', () => {
    const { PROTECTIVE } = require(PRELUDE);
    for (const hook of EVERY_HOOK)
        assert.strictEqual(standDown(hook, { [PROFILE]: 'minimal' }, ['node', 'x.js']), !PROTECTIVE.has(hook), hook);
    assert.strictEqual(standDown('guard-catastrophic-rm.js', { [PROFILE]: ' Minimal ' }, ['node', 'x.js']), false, 'case, space and the suffix are read like the csv');
    assert.strictEqual(standDown('docs-session', { [PROFILE]: ' Minimal ' }, ['node', 'x.js']), true);
    assert.strictEqual(standDown('guard-read-whole-file', { [PROFILE]: 'minimal' }, ['node', 'guard-read-whole-file.js', '--flag']), false, 'a CLI is never gated');
});

test('profile standard, absent, empty or unknown changes nothing - today\'s set', () => {
    for (const value of [undefined, '', 'standard', 'STANDARD', 'maximal', 'off', '0'])
        for (const hook of EVERY_HOOK)
            assert.strictEqual(standDown(hook, { [PROFILE]: value }, ['node', 'x.js']), false, `${hook} under ${JSON.stringify(value)}`);
});

test('profile strict turns the seeded-off Stop build check on, and nothing else changes', () => {
    const { switchOn } = require(PRELUDE);
    assert.strictEqual(switchOn('TURN_CHECK', { [PROFILE]: 'strict', ALFRED_CODE_TURN_CHECK: '0' }), true, 'the seeded 0 is overridden');
    assert.strictEqual(switchOn('TURN_CHECK', { [PROFILE]: 'strict' }), true);
    assert.strictEqual(switchOn('TURN_CHECK', { ALFRED_CODE_TURN_CHECK: '0' }), false, 'standard reads the setting');
    assert.strictEqual(switchOn('TURN_CHECK', { ALFRED_CODE_TURN_CHECK: '1' }), true);
    assert.strictEqual(switchOn('TURN_CHECK', { CLAUDE_STACK_TURN_CHECK: '1' }), true, 'the 1.x spelling answers through envOf'); // legacy-name
    assert.strictEqual(switchOn('TURN_CHECK', { [PROFILE]: 'minimal', ALFRED_CODE_TURN_CHECK: '0' }), false);
    assert.strictEqual(switchOn('INSTRUMENT', { [PROFILE]: 'strict', ALFRED_CODE_INSTRUMENT: '0' }), false, 'instrumentation is measurement, not a check - strict leaves it');
    for (const hook of EVERY_HOOK) assert.strictEqual(standDown(hook, { [PROFILE]: 'strict' }, ['node', 'x.js']), false, hook);
});

test('the project csv still wins over every profile', () => {
    assert.strictEqual(standDown('check-turn-build', { [PROFILE]: 'strict', ALFRED_CODE_HOOKS_OFF: 'check-turn-build' }, ['node', 'x.js']), true, 'strict cannot turn a csv-off hook back on');
    assert.strictEqual(standDown('guard-catastrophic-rm', { [PROFILE]: 'minimal', ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' }, ['node', 'x.js']), true, 'minimal keeps no guard the csv switched off');
    assert.strictEqual(standDown('guard-secret-value', { [PROFILE]: 'minimal', ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' }, ['node', 'x.js']), false);
    assert.strictEqual(standDown('docs-session', { [PROFILE]: 'standard', ALFRED_CODE_HOOKS_OFF: 'docs-session' }, ['node', 'x.js']), true);
});

test('the profile the prelude reads is the userConfig key the core entry declares, with the same three options', () => {
    const { HOOK_PROFILES } = require(PRELUDE);
    const field = coreEntry().userConfig && coreEntry().userConfig.hook_profile;
    assert.ok(field, 'the core entry declares hook_profile');
    assert.deepStrictEqual(field.options, HOOK_PROFILES);
    assert.strictEqual(field.default, 'standard');
    assert.strictEqual(field.type, 'string');
    assert.strictEqual(`CLAUDE_PLUGIN_OPTION_${'hook_profile'.toUpperCase()}`, PROFILE, 'the docs export <KEY> uppercased');
});

test('the prelude reads process.env when no env is handed in', () => {
    const before = process.env.ALFRED_CODE_HOOKS_OFF;
    process.env.ALFRED_CODE_HOOKS_OFF = 'guard-answer-length';
    try { assert.strictEqual(hookDisabled('guard-answer-length'), true); }
    finally { if (before === undefined) delete process.env.ALFRED_CODE_HOOKS_OFF; else process.env.ALFRED_CODE_HOOKS_OFF = before; }
});

// guard-secret-value.js is also the sanctioned CLI for reading a credential's PRESENCE, and
// docs.js / memory.js are run by path from 22 shared bodies. Switching a guard off must not take
// its CLI away - a hook invocation never carries an argument, so a leading flag means CLI.
test('a --flag invocation is never gated, however the env reads', () => {
    const env = { ALFRED_CODE_HOOKS_OFF: 'guard-secret-value', CLAUDE_PLUGIN_ROOT: '/p', CLAUDE_PROJECT_DIR: '/x' };
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js', '--presence', '/tmp/f']), false);
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js', '--redacted-env']), false);
    assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js']), true, 'the hook route is still gated');
});

// GATE 3 - the 1.x alias. 2.0.0 lists `claude-stack` as the 2.0.0 core under its old name (S20), so // legacy-name
// a 1.x core left at user scope refreshes into a second copy of every hook (S21). Seen from a project
// the seed already moved onto `alfred-code`, both would fire (S23) - the alias's copy steps aside.
const ALIAS_ROOT = path.join('/cfg', 'plugins', 'cache', 'claude-stack', 'claude-stack', '2.0.0'); // legacy-name
const CORE_ROOT = path.join('/cfg', 'plugins', 'cache', 'claude-stack', 'alfred-code', '2.0.0'); // legacy-name

// `core` installs plugins the way the CLI records them: a row in `<config>/plugins/installed_plugins.json`
// and a cache directory at its installPath. A bare id is a project-scope install for this repo.
function scopes({ project, local, account, core = [] } = {})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-alias-'));
    const repo = path.join(dir, 'repo');
    const acct = path.join(dir, 'acct');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    // A project the stack was set up in - the never-set-up gate is its own case below.
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
    fs.mkdirSync(acct);
    const put = (file, body) => { if (body !== undefined) fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body)); };
    put(path.join(repo, '.claude', 'settings.json'), project);
    put(path.join(repo, '.claude', 'settings.local.json'), local);
    put(path.join(acct, 'settings.json'), account);
    const s = { dir, repo, acct, env: (root = ALIAS_ROOT) => ({ CLAUDE_PLUGIN_ROOT: root, CLAUDE_PROJECT_DIR: repo, CLAUDE_CONFIG_DIR: acct }) };
    for (const spec of core) install(s, typeof spec === 'string' ? { id: spec } : spec);
    return s;
}
function install(s, { id, scope = 'project', projectPath = s.repo, dir = true })
{
    const [name, market] = id.split('@');
    const installPath = path.join(s.acct, 'plugins', 'cache', market, name, '2.0.0');
    if (dir) fs.mkdirSync(installPath, { recursive: true });
    const file = path.join(s.acct, 'plugins', 'installed_plugins.json');
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 2, plugins: {} };
    (data.plugins[id] ||= []).push({ scope, ...(scope === 'user' ? {} : { projectPath }), installPath, version: '2.0.0' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
}
const on = (id, value = true) => ({ enabledPlugins: { [id]: value } });
const CORE = 'alfred-code@envoydev';

// A real hook, run the way the entry launches it: the file the core's command names, under a plugin
// root. guard-protected-force-push denies (exit 2) a force-push to main.
const dispatcher = require('../stack/hooks/shell-guards.js');
function coreCommand(file)
{
    const all = Object.values(coreEntry().hooks).flat().flatMap((g) => g.hooks).map((h) => h.command);
    const own = all.find((c) => c.includes(`/stack/hooks/${file}`));
    if (own) return own;
    // A shell guard with no launch of its own runs inside the dispatcher: fire it there, alone.
    const name = file.replace(/\.js$/, '');
    const via = dispatcher.GUARDS.includes(name) && all.find((c) => c.includes(`/stack/hooks/${dispatcher.SELF}.js`));
    return via ? `${via} ${name}` : undefined;
}
function fire(file, env)
{
    const command = coreCommand(file);
    const rel = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)[1];
    const args = command.split('"').pop().trim().split(/\s+/).filter(Boolean);
    const clean = { PATH: process.env.PATH, HOME: env.CLAUDE_CONFIG_DIR || os.tmpdir(), ...env };
    return spawnSync(process.execPath, [path.join(__dirname, '..', rel), ...args], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, session_id: 's' }), env: clean, encoding: 'utf8',
    });
}

test('the alias yields when the project, its local file or the account enables an installed alfred-code', () => {
    for (const where of ['project', 'local', 'account'])
    {
        const s = scopes({ [where]: on(CORE), core: [CORE] });
        assert.strictEqual(aliasYieldsToCore(s.env()), true, `alfred-code enabled in the ${where} settings`);
        assert.strictEqual(standDown('guard-secret-value', s.env(), ['node', 'x.js']), true, 'standDown carries the gate');
        fs.rmSync(s.dir, { recursive: true, force: true });
    }
    const key = scopes({ project: on('alfred-code@claude-stack'), core: ['alfred-code@claude-stack'] }); // legacy-name - a 1.x account keeps its key
    assert.strictEqual(aliasYieldsToCore(key.env()), true, 'any marketplace key counts');
    fs.rmSync(key.dir, { recursive: true, force: true });
});

test('the alias runs when alfred-code is absent, switched off, or switched off by a higher scope', () => {
    const none = scopes({ project: on('claude-stack@claude-stack') }); // legacy-name
    assert.strictEqual(aliasYieldsToCore(none.env()), false, 'only the alias enabled: it is the one carrying the guards');
    fs.rmSync(none.dir, { recursive: true, force: true });
    const off = scopes({ project: on(CORE, false), core: [CORE] });
    assert.strictEqual(aliasYieldsToCore(off.env()), false, 'enabled: false is not enabled, installed or not');
    fs.rmSync(off.dir, { recursive: true, force: true });
    const over = scopes({ account: on(CORE), local: on(CORE, false), core: [CORE] });
    assert.strictEqual(aliasYieldsToCore(over.env()), false, 'the local file wins over the account');
    fs.rmSync(over.dir, { recursive: true, force: true });
    const prefix = scopes({ project: on('alfred-code-hooks@envoydev'), core: ['alfred-code-hooks@envoydev'] });
    assert.strictEqual(aliasYieldsToCore(prefix.env()), false, 'another plugin whose name starts alfred-code is not the core');
    fs.rmSync(prefix.dir, { recursive: true, force: true });
});

// Review I1: a committed settings file can name `alfred-code@envoydev` for a teammate whose core never
// loads - no marketplace, a declined trust prompt. Yielding on the key alone left that session with
// no guard at all, the one outcome the gate exists to prevent.
test('the alias runs while the named core cannot load - enabled but never installed, its cache gone, another project or key', () => {
    const named = scopes({ project: on(CORE) });
    assert.strictEqual(aliasYieldsToCore(named.env()), false, 'the settings key alone, no core installed anywhere');
    const denied = fire('guard-protected-force-push.js', named.env());
    assert.strictEqual(denied.status, 2, `the alias still denies: ${denied.stderr}`);
    fs.rmSync(named.dir, { recursive: true, force: true });
    for (const [spec, why] of [
        [{ id: CORE, dir: false }, 'an installed row whose cache directory is gone'],
        [{ id: CORE, projectPath: path.join(os.tmpdir(), 'another-project') }, 'installed for another project only'],
        [{ id: 'alfred-code@other' }, 'installed under another marketplace key than the one enabled'],
    ])
    {
        const s = scopes({ project: on(CORE), core: [spec] });
        assert.strictEqual(aliasYieldsToCore(s.env()), false, why);
        fs.rmSync(s.dir, { recursive: true, force: true });
    }
});

test('the alias yields to a core installed at user scope, or for this project by its real path', () => {
    const user = scopes({ account: on(CORE), core: [{ id: CORE, scope: 'user' }] });
    assert.strictEqual(aliasYieldsToCore(user.env()), true, 'a user-scope core loads in every project');
    fs.rmSync(user.dir, { recursive: true, force: true });
    const real = scopes({ project: on(CORE) });
    install(real, { id: CORE, projectPath: fs.realpathSync(real.repo) });
    assert.strictEqual(aliasYieldsToCore(real.env()), true, 'the row records the real path, the env may not');
    fs.rmSync(real.dir, { recursive: true, force: true });
    const local = scopes({ local: on(CORE), core: [{ id: CORE, scope: 'local' }] });
    assert.strictEqual(aliasYieldsToCore(local.env()), true, 'a local-scope core for this project');
    fs.rmSync(local.dir, { recursive: true, force: true });
});

test('an unreadable installed_plugins.json runs the alias', () => {
    for (const body of ['{', 'null', '[]', '{"plugins": 7}', '{"plugins": {"alfred-code@envoydev": 7}}'])
    {
        const s = scopes({ project: on(CORE) });
        fs.mkdirSync(path.join(s.acct, 'plugins', 'cache', 'envoydev', 'alfred-code', '2.0.0'), { recursive: true });
        fs.writeFileSync(path.join(s.acct, 'plugins', 'installed_plugins.json'), body);
        assert.doesNotThrow(() => aliasYieldsToCore(s.env()));
        assert.strictEqual(aliasYieldsToCore(s.env()), false, `installed_plugins.json body ${body}`);
        fs.rmSync(s.dir, { recursive: true, force: true });
    }
    const dirAsFile = scopes({ project: on(CORE) });
    fs.mkdirSync(path.join(dirAsFile.acct, 'plugins', 'installed_plugins.json'), { recursive: true });
    assert.strictEqual(aliasYieldsToCore(dirAsFile.env()), false, 'a directory in place of the file');
    fs.rmSync(dirAsFile.dir, { recursive: true, force: true });
});

// Review M4: the prelude runs from `.claude/hooks/` with no `scripts/install/` beside it, so it retypes
// both names - this is what keeps them the installer's.
test('the two plugin names the prelude retypes are the ones brand.js owns', () => {
    const { BRAND, LEGACY } = require('./install/brand.js');
    const prelude = require(PRELUDE);
    assert.strictEqual(prelude.CORE_PLUGIN, BRAND.core);
    assert.strictEqual(prelude.ALIAS_PLUGIN, LEGACY.core);
});

// Review M2: a hook's header points at the prelude's, so a new gate cannot leave seventeen stale lists.
test('every hook points at the prelude header for its gates instead of listing them', () => {
    const dir = path.dirname(PRELUDE);
    assert.ok((fs.readFileSync(PRELUDE, 'utf8').match(/^\/\/ GATE \d+ - /gm) || []).length >= 3, 'the prelude header lists the gates');
    const hooks = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && fs.readFileSync(path.join(dir, f), 'utf8').includes('STACK HOOK GATES'));
    assert.ok(hooks.length >= 17, `every wired hook carries the marker: ${hooks.length}`);
    for (const file of hooks)
    {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.match(text, /STACK HOOK GATES - they live in hook-prelude\.js, whose header lists them/, file);
        assert.doesNotMatch(text, /both live in hook-prelude|migration window|ALFRED_CODE_HOOKS_OFF/, `${file} lists the gates itself`);
    }
});

test('only a hook launched from the alias root yields - the core, a copied hook and a Windows path are read right', () => {
    const s = scopes({ project: on(CORE), core: [CORE] });
    assert.strictEqual(aliasYieldsToCore(s.env(CORE_ROOT)), false, 'the core itself never yields - its marketplace key may be claude-stack'); // legacy-name
    assert.strictEqual(aliasYieldsToCore({ ...s.env(), CLAUDE_PLUGIN_ROOT: undefined }), false, 'no plugin root is a copied hook');
    assert.strictEqual(aliasYieldsToCore(s.env(ALIAS_ROOT + path.sep)), true, 'a trailing separator is the same root');
    assert.strictEqual(aliasYieldsToCore(s.env('C:\\Users\\u\\.claude\\plugins\\cache\\k\\claude-stack\\2.0.0')), true, 'a Windows root'); // legacy-name
    fs.rmSync(s.dir, { recursive: true, force: true });
});

test('the alias gate FAILS OPEN - a junk or unreadable settings file, or no project dir, runs the hook', () => {
    for (const junk of ['{', 'null', '[]', '{"enabledPlugins": 7}'])
    {
        const s = scopes({ account: on(CORE), project: junk, core: [{ id: CORE, scope: 'user' }] });
        assert.doesNotThrow(() => aliasYieldsToCore(s.env()));
        const expected = junk === '{' ? false : true;
        assert.strictEqual(aliasYieldsToCore(s.env()), expected, `project body ${junk}: ${expected ? 'no enabledPlugins to read, the account decides' : 'unparseable - run'}`);
        fs.rmSync(s.dir, { recursive: true, force: true });
    }
    const dirAsFile = scopes({ account: on(CORE), core: [{ id: CORE, scope: 'user' }] });
    fs.mkdirSync(path.join(dirAsFile.env().CLAUDE_PROJECT_DIR, '.claude', 'settings.json'));
    assert.strictEqual(aliasYieldsToCore(dirAsFile.env()), false, 'a settings file that cannot be read - run');
    fs.rmSync(dirAsFile.dir, { recursive: true, force: true });
    assert.strictEqual(aliasYieldsToCore({ CLAUDE_PLUGIN_ROOT: ALIAS_ROOT }), false, 'no project dir - run');
});

test('a hook run from the alias root exits silently while alfred-code is enabled, and denies without it', () => {
    const s = scopes({ project: on(CORE), core: [CORE] });
    const quiet = fire('guard-protected-force-push.js', s.env());
    assert.strictEqual(quiet.status, 0, quiet.stderr);
    assert.strictEqual(quiet.stdout + quiet.stderr, '', 'nothing printed');
    fs.rmSync(s.dir, { recursive: true, force: true });
    const alone = scopes({});
    assert.strictEqual(fire('guard-protected-force-push.js', alone.env()).status, 2, 'the alias alone carries the guard');
    fs.rmSync(alone.dir, { recursive: true, force: true });
});

// Seam S4 (final review A-I1, C13): an update that took the wrong scope leaves the 1.x alias enabled and
// installed at USER scope beside `alfred-code` enabled and installed at PROJECT scope (under the 1.x
// marketplace key), and a 1.x project moved to local scope can leave the old hooks alias on too. Only the
// alias gate keeps a guard from firing twice there - every hook the alias carries stands down, the core's
// copy is the one guard, and a project the split never reached still has the alias as its guard.
test('the split state - the alias at user scope, the core at project scope, the old hooks alias on - runs each hook once (S4)', () => {
    const ALIAS = 'claude-stack@claude-stack'; // legacy-name
    const HOOKS_ALIAS = 'claude-stack-hooks@claude-stack'; // legacy-name
    const CORE_OLD_KEY = 'alfred-code@claude-stack'; // legacy-name - the core installed under the 1.x marketplace key
    const s = scopes({ account: on(ALIAS), project: { enabledPlugins: { [CORE_OLD_KEY]: true, [HOOKS_ALIAS]: true } },
        core: [{ id: ALIAS, scope: 'user' }, { id: CORE_OLD_KEY, scope: 'project' }, { id: HOOKS_ALIAS, scope: 'project' }] });
    const hooks = [...new Set(Object.values(coreEntry().hooks).flat().flatMap((g) => g.hooks)
        .map((h) => (h.command.match(/\/stack\/hooks\/([\w-]+)\.js/) || [])[1]).filter(Boolean)
        .flatMap((h) => (h === dispatcher.SELF ? [h, ...dispatcher.GUARDS] : [h])))];
    assert.ok(hooks.length >= 17, `every stack hook the core wires: ${hooks.join(', ')}`);
    for (const hook of hooks)
    {
        assert.strictEqual(standDown(hook, s.env(ALIAS_ROOT), ['node', 'x.js']), true, `${hook}: the alias copy stands down`);
        assert.strictEqual(standDown(hook, s.env(CORE_ROOT), ['node', 'x.js']), false, `${hook}: the core copy runs`);
    }
    const alias = fire('guard-protected-force-push.js', s.env(ALIAS_ROOT));
    assert.strictEqual(alias.status, 0, alias.stderr);
    assert.strictEqual(alias.stdout + alias.stderr, '', 'the alias copy says nothing');
    assert.strictEqual(fire('guard-protected-force-push.js', s.env(CORE_ROOT)).status, 2, 'the core copy is the one denial');
    const market = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
    const hooksAlias = market.plugins.find((p) => p.name === HOOKS_ALIAS.split('@')[0]);
    assert.ok(hooksAlias && !hooksAlias.hooks, 'the old hooks alias carries no hooks, so nothing launches from its root');
    fs.rmSync(s.dir, { recursive: true, force: true });
    const untouched = scopes({ account: on(ALIAS), core: [{ id: ALIAS, scope: 'user' }] });
    assert.strictEqual(fire('guard-protected-force-push.js', untouched.env(ALIAS_ROOT)).status, 2, 'a project the split never reached keeps the alias as its guard');
    fs.rmSync(untouched.dir, { recursive: true, force: true });
});

// The copy route (ALFRED_CODE_HOOKS_VIA_PLUGIN=false) keeps copying and wiring the hooks while the
// core, on for the skills, now carries them too - both would fire (S15). The core's copy stands down
// through the existing migration-window gate.
test('a core-carried hook stands down while the project wires its copied twin (the copy route)', () => {
    const s = scopes({ project: wiring('guard-protected-force-push.js') });
    const twin = fire('guard-protected-force-push.js', s.env(CORE_ROOT));
    assert.strictEqual(twin.status, 0, twin.stderr);
    assert.strictEqual(twin.stdout + twin.stderr, '', 'the core copy says nothing - the project copy is the one that denies');
    fs.rmSync(s.dir, { recursive: true, force: true });
    const plugin = scopes({});
    assert.strictEqual(fire('guard-protected-force-push.js', plugin.env(CORE_ROOT)).status, 2, 'the plugin route: the core copy is the guard');
    fs.rmSync(plugin.dir, { recursive: true, force: true });
});

// GATE 4 - a project never set up. A user-scope core enables every hook in EVERY repo the user
// opens; one with no install record gets nothing written and nothing enforced (R54, Task 16 review
// M8). A copied hook (no plugin root) is set up by definition - the project wired it.
test('a plugin-launched hook stands down in a project with no install record, and only there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-unset-'));
    const env = { CLAUDE_PLUGIN_ROOT: '/cfg/plugins/cache/envoydev/alfred-code/2.0.0', CLAUDE_PROJECT_DIR: dir };
    try
    {
        assert.strictEqual(neverSetUp(env), true, 'no .claude at all');
        assert.strictEqual(standDown('history-session', env, ['node', 'x.js']), true, 'standDown carries the gate');
        fs.mkdirSync(path.join(dir, '.claude', 'docs'), { recursive: true });
        assert.strictEqual(neverSetUp(env), true, 'a .claude/ of the user\'s own is no install record');
        for (const record of [['alfred-code.stamp'], ['claude-stack.stamp'], ['hooks', 'docs.js']]) // legacy-name - a 1.x stamp is a record too
        {
            const file = path.join(dir, '.claude', ...record);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, '');
            assert.strictEqual(neverSetUp(env), false, `${record.join('/')} marks the project set up`);
            assert.strictEqual(standDown('history-session', env, ['node', 'x.js']), false);
            fs.rmSync(file);
        }
        assert.strictEqual(neverSetUp({ CLAUDE_PROJECT_DIR: dir }), false, 'a copied hook is set up by definition');
        assert.strictEqual(neverSetUp({ CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT }), false, 'no project dir - run');
        assert.strictEqual(standDown('guard-secret-value', env, ['node', 'guard-secret-value.js', '--presence', '/tmp/f']), false, 'a CLI is never gated');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C1 (Task 18a review): the stamp is machine-local and `.claude/` is ignored, so a `git worktree add`
// checkout - Claude Code's own `.claude/worktrees/<n>` included - carries no record of its own. Its
// `.git` FILE names the main checkout, whose record counts; a session opened in a subdirectory walks
// up to its top level first. Read from files alone - a hook never spawns git here.
const UNSET_ROOT = '/cfg/plugins/cache/envoydev/alfred-code/2.0.0';
function repoWithWorktree({ stamp = true } = {})
{
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-wt-')));
    const main = path.join(base, 'main');
    fs.mkdirSync(main);
    fs.writeFileSync(path.join(base, 'gitconfig'), '');
    const gitEnv = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
    const git = (...a) => execFileSync('git', a, { cwd: main, env: gitEnv, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(main, '.gitignore'), '.claude/\n');
    git('add', '.gitignore');
    git('-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'start');
    if (stamp)
    {
        fs.mkdirSync(path.join(main, '.claude'));
        fs.writeFileSync(path.join(main, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
    }
    const wt = path.join(base, 'wt');
    git('worktree', 'add', '-q', '-b', 'wt', wt);
    return { base, main, wt, git };
}
const unsetEnv = (dir) => ({ CLAUDE_PLUGIN_ROOT: UNSET_ROOT, CLAUDE_PROJECT_DIR: dir });
const HOOK_FILE = (file) => path.join(__dirname, '..', 'stack', 'hooks', file);
function fireIn(file, dir, toolInput, toolName = 'Bash')
{
    return spawnSync(process.execPath, [HOOK_FILE(file)], {
        input: JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }),
        env: { PATH: process.env.PATH, HOME: path.join(os.tmpdir(), 'prelude-no-home'), ...unsetEnv(dir) }, encoding: 'utf8',
    });
}

test('a git worktree of a set-up repo is set up - its guards stay on under a user-scope core (C1)', () => {
    const { base, main, wt, git } = repoWithWorktree();
    try
    {
        assert.ok(fs.statSync(path.join(wt, '.git')).isFile() && !fs.existsSync(path.join(wt, '.claude')), 'a worktree: a .git FILE, no record of its own');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), false, 'the main checkout\'s stamp counts');
        const deep = path.join(wt, 'src', 'deep');
        fs.mkdirSync(deep, { recursive: true });
        assert.strictEqual(neverSetUp(unsetEnv(deep)), false, 'a subdirectory launch walks up to the worktree, then to the main checkout');
        const inner = path.join(main, '.claude', 'worktrees', 'feat');
        git('worktree', 'add', '-q', '-b', 'feat', inner);
        assert.strictEqual(neverSetUp(unsetEnv(inner)), false, 'Claude Code\'s own .claude/worktrees/<n> checkout');
        assert.strictEqual(standDown('guard-unapproved-dispatch', unsetEnv(wt), ['node', 'x.js']), false);
        // End to end, the way the core launches them: a protective guard and an ordinary one both deny.
        const rm = fireIn('guard-catastrophic-rm.js', wt, { command: 'rm -rf ~' });
        assert.strictEqual(rm.status, 2, `rm -rf ~ in the worktree must be blocked: ${rm.stdout}${rm.stderr}`);
        const dispatch = fireIn('guard-unapproved-dispatch.js', wt, { subagent_type: 'aspnet-implementer', prompt: 'x' }, 'Agent');
        assert.strictEqual(dispatch.status, 2, `an unapproved implementer in the worktree must be blocked: ${dispatch.stderr}`);
    }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a worktree of a repo never set up is not set up either, and a .git file that names nothing fails to the project alone (C1)', () => {
    const { base, wt } = repoWithWorktree({ stamp: false });
    try
    {
        assert.strictEqual(neverSetUp(unsetEnv(wt)), true, 'no record in the worktree or the main checkout');
        assert.strictEqual(standDown('guard-unapproved-dispatch', unsetEnv(wt), ['node', 'x.js']), true);
        // A worktree whose gitdir lost its commondir (older git, hand-made) still reaches <main>/.git/worktrees/<n>/../..
        const gitdir = fs.readFileSync(path.join(wt, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)[1].trim();
        fs.rmSync(path.join(gitdir, 'commondir'));
        fs.mkdirSync(path.join(base, 'main', '.claude'));
        fs.writeFileSync(path.join(base, 'main', '.claude', 'alfred-code.stamp'), '');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), false, 'the worktrees/<n> layout names the main checkout');
        // Junk in the .git file: only the project's own .claude/ is read, and it has no record.
        fs.writeFileSync(path.join(wt, '.git'), 'not a gitdir line\n');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), true);
        fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /nowhere/at/all\n');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), true);
    }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// R86 (the coordinator's ruling on Task 18a): three guards stop what cannot be undone - a recursive
// rm of an unrecoverable target, a credential value read into the transcript, a force-push over a
// protected branch - and in a repo never set up a user-scope core is the only guard it has. They stay
// live there and skip their block row, so R54 still holds: nothing is written. Every other hook
// stands down. ALFRED_CODE_HOOKS_OFF still switches any of the three off.
test('in a repo never set up the three protective guards stay live and write nothing; every other hook stands down (R86)', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-r86-')));
    const env = unsetEnv(dir);
    try
    {
        assert.deepStrictEqual([...require(PRELUDE).PROTECTIVE].sort(), ['guard-catastrophic-rm', 'guard-protected-force-push', 'guard-secret-value']);
        for (const hook of ['guard-catastrophic-rm', 'guard-secret-value.js', 'guard-protected-force-push'])
            assert.strictEqual(standDown(hook, env, ['node', 'x.js']), false, `${hook} stays live`);
        for (const hook of ['guard-ungated-commit', 'guard-cross-project-write', 'guard-fresh-session-start', 'history-session', 'docs-session'])
            assert.strictEqual(standDown(hook, env, ['node', 'x.js']), true, `${hook} stands down`);
        assert.strictEqual(standDown('guard-catastrophic-rm', { ...env, ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' }, ['node', 'x.js']), true, 'the csv still wins');

        const rm = fireIn('guard-catastrophic-rm.js', dir, { command: 'rm -rf ~' });
        assert.strictEqual(rm.status, 2, `rm -rf ~ blocked: ${rm.stderr}`);
        const push = fireIn('guard-protected-force-push.js', dir, { command: 'git push --force origin main' });
        assert.strictEqual(push.status, 2, `a force-push to main blocked: ${push.stderr}`);
        fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: 'x0'.repeat(20) } }));
        const secret = fireIn('guard-secret-value.js', dir, { file_path: path.join(dir, 'config.json') }, 'Read');
        assert.strictEqual(secret.status, 2, `a credential file read blocked: ${secret.stderr}`);
        assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'three blocks, no block row - nothing written into a repo never set up');

        // Positive control: once set up, the same block writes its row.
        fs.mkdirSync(path.join(dir, '.claude'));
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), '');
        assert.strictEqual(fireIn('guard-catastrophic-rm.js', dir, { command: 'rm -rf ~' }).status, 2);
        assert.ok(fs.existsSync(path.join(dir, '.claude', 'docs', 'hook-blocks', 's.jsonl')), 'a set-up repo records the block');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
