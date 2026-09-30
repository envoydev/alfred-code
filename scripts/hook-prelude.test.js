'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
const SUITE = require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRELUDE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const { hookDisabled, yieldToCopiedTwin, aliasYieldsToCore, standDown, neverSetUp, checkoutsOf, cursorHost, cursorStandDown, PROTECTIVE: PROTECTIVE_SET } = require(PRELUDE);
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
const EVERY_HOOK = ['guard-catastrophic-rm', 'guard-secret-value', 'guard-protected-force-push', 'guard-desktop-exec', 'guard-read-whole-file', 'guard-ungated-commit',
    'guard-stop-contract', 'guard-cross-project-write', 'docs-session', 'history-session', 'check-turn-build', 'monitor-session'];

test('profile minimal keeps only the rm, secret, force-push and desktop exec guards; every other hook stands down', () => {
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
    // Review finding 2: no `options` picker (an older CLI cannot load a plugin declaring one) - the
    // description names the three values the prelude knows instead.
    assert.ok(!Object.hasOwn(field, 'options'));
    for (const value of HOOK_PROFILES) assert.match(field.description, new RegExp(`\\b${value}\\b`));
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

// Review M2: a hook's header points at the prelude's, so a new gate cannot leave one stale list per hook.
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
        fs.mkdirSync(path.join(dir, '.alfred', 'docs'), { recursive: true });
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
        // Junk in the .git file: only the project's own .claude/ is read, and it has no record. Removed
        // before each write: Git for Windows marks it Hidden, and a Hidden file refuses an overwrite (EPERM).
        const rewrite = (text) => { fs.rmSync(path.join(wt, '.git'), { force: true }); fs.writeFileSync(path.join(wt, '.git'), text); };
        rewrite('not a gitdir line\n');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), true);
        rewrite('gitdir: /nowhere/at/all\n');
        assert.strictEqual(neverSetUp(unsetEnv(wt)), true);
    }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// R86 (the coordinator's ruling on Task 18a): three guards stop what cannot be undone - a recursive
// rm of an unrecoverable target, a credential value read into the transcript, a force-push over a
// protected branch - and in a repo never set up a user-scope core is the only guard it has. They stay
// live there and skip their block row, so R54 still holds: nothing is written. Every other hook
// stands down. ALFRED_CODE_HOOKS_OFF still switches any of them off. The desktop exec gate joined them
// (final review IM2): its macOS Shell is a shell the other three never see.
test('in a repo never set up the protective guards stay live and write nothing; every other hook stands down (R86)', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-r86-')));
    const env = unsetEnv(dir);
    try
    {
        assert.deepStrictEqual([...require(PRELUDE).PROTECTIVE].sort(), ['guard-catastrophic-rm', 'guard-desktop-exec', 'guard-protected-force-push', 'guard-secret-value']);
        for (const hook of ['guard-catastrophic-rm', 'guard-secret-value.js', 'guard-protected-force-push', 'guard-desktop-exec'])
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
        // Final review IM2: the desktop Shell is a shell no shell guard sees - `rm -rf ~` ran there while Bash's was blocked.
        const shell = fireIn('guard-desktop-exec.js', dir, { command: 'rm -rf ~' }, 'mcp__plugin_macos-desktop_macos-desktop__Shell');
        assert.strictEqual(shell.status, 2, `the macOS desktop Shell blocked: ${shell.stderr}`);
        assert.ok(!fs.existsSync(path.join(dir, '.claude')) && !fs.existsSync(path.join(dir, '.alfred')), 'four blocks, no block row - nothing written into a repo never set up');

        // Positive control: once set up, the same block writes its row.
        fs.mkdirSync(path.join(dir, '.claude'));
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), '');
        assert.strictEqual(fireIn('guard-catastrophic-rm.js', dir, { command: 'rm -rf ~' }).status, 2);
        assert.ok(fs.existsSync(path.join(dir, '.alfred', 'docs', 'hook-blocks', 's.jsonl')), 'a set-up repo records the block');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M9: under a user-scope core a repo never set up lists every seat the core carries, so an implementer
// can be dispatched there too - and the dispatch guard stood down with every other non-protective hook,
// leaving that dispatch with no approval gate. The implementer check stays live there, for the core's own
// spelling only (a bare `*-implementer` in a repo the stack never touched is not its seat), writing no
// block row (R54); the rest of the guard - the generic-seat and symbol rules - still stands down.
test('M9 in a repo never set up the dispatch guard still gates an alfred-code implementer, and writes nothing', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-m9-')));
    try
    {
        const implementer = fireIn('guard-unapproved-dispatch.js', dir, { subagent_type: 'alfred-code:aspnet-implementer', prompt: 'build it' }, 'Agent');
        assert.strictEqual(implementer.status, 2, `an unapproved core implementer must be blocked: ${implementer.stderr}`);
        assert.match(implementer.stderr, /without an approval gate/);
        for (const input of [
            { subagent_type: 'aspnet-implementer', prompt: 'x' },                       // not the core's spelling: the project's own
            { subagent_type: 'alfred-code:aspnet-verifier', prompt: 'x' },               // a verifier was never gated
            { subagent_type: 'Explore', prompt: 'who calls OrderService.Place?' },       // the symbol rule stands down
            { subagent_type: 'general-purpose', prompt: 'x' },
        ])
        {
            const r = fireIn('guard-unapproved-dispatch.js', dir, input, 'Agent');
            assert.strictEqual(r.status, 0, `${input.subagent_type}: ${r.stderr}`);
            assert.strictEqual(r.stdout, '', `${input.subagent_type}: nothing rewritten in a repo never set up`);
        }
        assert.ok(!fs.existsSync(path.join(dir, '.alfred')), 'a block, and no block row - nothing written into a repo never set up');

        // The flow's approval opens it, as anywhere.
        fs.mkdirSync(path.join(dir, '.alfred', 'docs', 'flow'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'flow', 'APPROVAL'), 'APPROVED plan-1 - "go"\n');
        assert.strictEqual(fireIn('guard-unapproved-dispatch.js', dir, { subagent_type: 'alfred-code:aspnet-implementer', prompt: 'x' }, 'Agent').status, 0);
        // The csv opt-out still wins.
        fs.rmSync(path.join(dir, '.alfred'), { recursive: true });
        const off = spawnSync(process.execPath, [HOOK_FILE('guard-unapproved-dispatch.js')], {
            input: JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'alfred-code:aspnet-implementer', prompt: 'x' } }),
            env: { PATH: process.env.PATH, HOME: path.join(os.tmpdir(), 'prelude-no-home'), ...unsetEnv(dir), ALFRED_CODE_HOOKS_OFF: 'guard-unapproved-dispatch' }, encoding: 'utf8',
        });
        assert.strictEqual(off.status, 0, off.stderr);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// GATE 6 - a Cursor host. Cursor loads Claude hooks by default and turns a Stop block into an unbounded
// automatic follow-up, so under a Cursor PAYLOAD only the protective guards run. Judged from the
// payload alone: a `claude` session inside Cursor's terminal inherits Cursor's variables and keeps every hook.
// Each non-protective hook makes the call itself, after parsing its own payload (no stdin is read by the prelude).
const HOOKS_DIR = path.join(__dirname, '..', 'stack', 'hooks');

test('cursorHost reads the payload only: cursor_version or a camelCase event name', () => {
    assert.strictEqual(cursorHost({ cursor_version: '2.1.0', hook_event_name: 'Stop' }), true);
    assert.strictEqual(cursorHost({ hook_event_name: 'preToolUse' }), true);
    assert.strictEqual(cursorHost({ hook_event_name: 'stop' }), true);
    for (const claude of [{ hook_event_name: 'Stop' }, { hook_event_name: 'PreToolUse', tool_name: 'Bash' }, {}, null, undefined, 'x', [], { cursor_version: '' }, { cursor_version: 3 }])
        assert.strictEqual(cursorHost(claude), false, JSON.stringify(claude));
});

test('cursorStandDown: a Cursor payload stands a non-protective hook down and never a protective one or a CLI', () => {
    const input = { cursor_version: '2.1.0', hook_event_name: 'stop' };
    for (const hook of ['guard-stop-contract', 'guard-answer-length', 'docs-session', 'guard-fresh-session-start', 'memory-session'])
        assert.strictEqual(cursorStandDown(input, `/p/${hook}.js`), true, hook);
    for (const hook of PROTECTIVE_SET) assert.strictEqual(cursorStandDown(input, `/p/${hook}.js`), false, hook);
    assert.strictEqual(cursorStandDown(input, '/p/guard-stop-contract.js', ['node', 'x.js', '--flag']), false, 'a CLI is never gated');
});

test('cursorStandDown: a Claude payload (Cursor variables set, or not) and a malformed one run every hook', () => {
    process.env.CURSOR_VERSION = '2.1.0';
    try
    {
        for (const input of [{ hook_event_name: 'Stop' }, {}, null, 'garbage', 42, [], { hook_event_name: 7 }, undefined])
            assert.strictEqual(cursorStandDown(input, '/p/guard-stop-contract.js'), false, JSON.stringify(input));
    }
    finally { delete process.env.CURSOR_VERSION; }
});

test('every non-protective hook file carries the cursorStandDown call, so a new hook cannot forget it', () => {
    // The files are the ones the core entry actually LAUNCHES (2.1.5 M4): selecting them by their own
    // `standDown('` call let a hook that skipped the prelude entirely - the setup plugin's two - pass.
    const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'plugin-entries.json'), 'utf8'));
    const core = entries.entries.find((p) => p.name === 'alfred-code');
    const launched = new Set();
    for (const blocks of Object.values(core.hooks || {}))
        for (const b of blocks) for (const h of b.hooks) for (const m of String(h.command).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.js)/g)) launched.add(m[1]);
    const files = [...launched];
    assert.ok(files.includes('setup-plugin/hooks/guard-layer-table.js') && files.includes('setup-plugin/hooks/library-stamp.js'), files.join(', '));
    assert.ok(files.length >= 15, `found ${files.length} launched hooks`);
    const dispatched = [...require(path.join(HOOKS_DIR, 'shell-guards.js')).GUARDS, ...require(path.join(HOOKS_DIR, 'file-guards.js')).NAMES].map((g) => `stack/hooks/${g}.js`);
    for (const f of [...new Set([...files, ...dispatched])])
    {
        const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
        const name = path.basename(f, '.js');
        if (name === 'shell-guards' || name === 'file-guards') continue;   // a dispatcher runs each guard's own gates in-process
        const has = /cursorStandDown\(\w+, __filename\)/.test(src);
        assert.strictEqual(has, !PROTECTIVE_SET.has(name), `${f}: cursorStandDown ${has ? 'present' : 'missing'}`);
        assert.ok(/standDown\('/.test(src), `${f}: runs the prelude's standDown gate`);
    }
});

test('the layer-table gate runs the prelude gates and leaves a block row where the repo is set up (2.1.5 M4)', () => {
    const hook = path.join(__dirname, '..', 'setup-plugin', 'hooks', 'guard-layer-table.js');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'layer-gate-')));
    try
    {
        // A transcript whose latest decision table ran and was never pasted: the ask is denied.
        const tp = path.join(root, 't.jsonl');
        const row = (o) => JSON.stringify(o);
        fs.writeFileSync(tp, [
            row({ type: 'user', message: { role: 'user', content: '/alfred-code:configure' } }),
            row({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'tb', name: 'Bash', input: { command: 'node stack-select.js --table skills' } }] } }),
            row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'a | b\ntotal: 3 skills' }] } }),
            row({ type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'pasted below' }, { type: 'tool_use', id: 'ask', name: 'AskUserQuestion', input: {} }] } }),
        ].join('\n') + '\n');
        const ask = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'ask', session_id: 'lg', transcript_path: tp, cwd: root };
        // Launched as the plugin launches it: CLAUDE_PLUGIN_ROOT set, which is what GATE 4's neverSetUp reads.
        const env = { PATH: process.env.PATH, HOME: root, CLAUDE_CONFIG_DIR: path.join(root, 'cfg'), CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..'), ALFRED_CODE_LAYER_GATE_WAIT_MS: '0' };
        const run = (extra = {}, input = ask) => spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extra } });
        const ledger = path.join(root, '.alfred', 'docs', 'hook-blocks', 'lg.jsonl');
        assert.strictEqual(run().status, 2, 'a never-set-up repo keeps the gate - it serves setup');
        assert.ok(!fs.existsSync(path.join(root, '.alfred')), 'and is written nothing (R54)');
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'version: 2.1.5\n');
        assert.strictEqual(run().status, 2);
        const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepStrictEqual([rows.length, rows[0].hook, rows[0].mode], [1, 'guard-layer-table.js', undefined], 'one block row, counted as a block');
        assert.strictEqual(run({ ALFRED_CODE_HOOKS_OFF: 'guard-layer-table' }).status, 0, 'the csv names it');
        assert.strictEqual(run({ CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }).status, 0, 'minimal keeps only the protective guards');
        assert.strictEqual(run({}, { ...ask, cursor_version: '2.1.0', hook_event_name: 'preToolUse' }).status, 0, 'a Cursor payload stands it down');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function runHook(file, payload, extra)
{
    return spawnSync(process.execPath, [path.join(HOOKS_DIR, file)], {
        input: payload, encoding: 'utf8', env: { ...process.env, ...extra, CLAUDE_PROJECT_DIR: SUITE.project },
    });
}

test('as a process: a Cursor payload is left alone by a non-protective hook, silently; a Claude one is judged', () => {
    const question = 'Which of these two options do you prefer, and should I proceed now?';
    const cursor = runHook('guard-stop-contract.js', JSON.stringify({ cursor_version: '2.1.0', hook_event_name: 'stop', last_assistant_message: question }), {});
    assert.strictEqual(cursor.status, 0);
    assert.strictEqual(cursor.stdout + cursor.stderr, '', 'stood down silently');
    const claude = runHook('guard-stop-contract.js', JSON.stringify({ hook_event_name: 'Stop', session_id: 'cs', last_assistant_message: question }), { CURSOR_VERSION: '2.1.0' });
    assert.strictEqual(claude.status, 2, claude.stderr);
});

test('as a process: the rm guard still blocks rm -rf ~ under a Cursor payload, and the dispatcher stands the rest down', () => {
    const payload = JSON.stringify({ cursor_version: '2.1.0', hook_event_name: 'preToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf ~' } });
    const r = runHook('shell-guards.js', payload, {});
    assert.strictEqual(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /catastrophic/);
    assert.doesNotMatch(r.stderr, /outside this session's project/, 'the non-protective cross-project guard stood down');
});

test('as a process: memory-session with a stdin that never closes still exits within its bound', () => {
    const { spawn } = require('node:child_process');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(HOOKS_DIR, 'memory-session.js')], { env: { ...process.env, CLAUDE_PROJECT_DIR: SUITE.project }, stdio: ['pipe', 'pipe', 'pipe'] });
        const started = Date.now();
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('memory-session hung past 6s on an open stdin')); }, 6000);
        child.on('exit', () => { clearTimeout(timer); assert.ok(Date.now() - started < 6000); resolve(); });
        // stdin is left open: never ended, never written
    });
});

test('every hook suite takes the containment helper, and no suite hands a hook the temp root as its project (2.1.5 M5)', () => {
    // hook-prelude.test.js's runHook spawned hooks with CLAUDE_PROJECT_DIR = os.tmpdir(), so every run appended
    // block rows under $TMPDIR/<docs-path>/hook-blocks; guard-commit-gate.test.js inherited the runner's
    // ALFRED_CODE_DOCS_PATH and failed 8 cases inside a session. The helper's own after-hook fails a suite that
    // writes there; this pins that every suite that spawns a hook carries it.
    // The suites are DISCOVERED, never listed (a hand-kept list let a new hook suite through - the 2.1.5 hooks review):
    // a test file that spawns a child process and either names a hook in the spawn call itself (a hooks directory, a
    // HOOKS-style name, a hook entry file) or feeds a hook's stdin payload (`input: JSON.stringify(`) while naming a
    // hooks directory or an entry. The entries are the manifest's wired files, the two dispatchers and the plugin's own
    // hooks. A suite that only loads an engine (docs-versioning-rule's `node -e require(docs.js)`) is no hook suite. The
    // rule reads source text, so a suite reaching a hook only through a name built at run time slips past it - the
    // controls below hold one suite of each shape it must find.
    const { loadManifest } = require('./install/manifest.js');
    const entries = new Set(loadManifest(path.join(__dirname, '..')).catalogs.hooks.map((r) => r.split('::')[0]));
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'setup-plugin', 'hooks'))) if (f.endsWith('.js')) entries.add(f);
    for (const f of ['shell-guards.js', 'file-guards.js']) entries.add(f);
    const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const entryName = new RegExp(`['"\`](?:${[...entries].map((e) => esc(e.replace(/\.js$/, ''))).join('|')})(?:\\.js)?['"\`]`);
    const hookWord = /(?<![-\w])(?:hooks?|HOOKS?\w*)(?![-\w])/;
    const hooksDir = /['"](?:stack|setup-plugin|\.claude)['"],\s*['"]hooks['"]|(?:stack|setup-plugin|\.claude)\/hooks\b/;
    const spawnCall = /\b(?:spawnSync|spawn|execFileSync|execSync|fork)\((.*)$/;
    const discovered = fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')).filter((n) =>
    {
        const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
        const calls = src.split('\n').map((l) => (l.match(spawnCall) || [])[1]).filter((a) => a !== undefined);
        return calls.some((a) => hookWord.test(a) || hooksDir.test(a) || entryName.test(a))
            || (calls.length > 0 && /input:\s*JSON\.stringify\(/.test(src) && (hooksDir.test(src) || entryName.test(src)));
    }).map((n) => n.replace(/\.test\.js$/, ''));
    for (const control of ['guard-hooks', 'shell-guards', 'check-turn-build', 'hooks-entry', 'install-plugins'])
        assert.ok(discovered.includes(control), `the discovery finds ${control}.test.js (found: ${discovered.join(', ')})`);
    for (const s of discovered)
        assert.match(fs.readFileSync(path.join(__dirname, `${s}.test.js`), 'utf8'), /require\('\.\/hook-test-env'\)\.isolateHookSuite\(\)/, `${s}.test.js spawns a hook and takes no helper`);
    for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.js')))
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, f), 'utf8'), /CLAUDE_PROJECT_DIR:\s*os\.tmpdir\(\)/, `${f} hands a hook the temp root as its project`);
    const env = require('./hook-test-env');
    assert.deepStrictEqual(Object.keys(env.scrubbed({ ALFRED_CODE_DOCS_PATH: 'x', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', CLAUDE_PROJECT_DIR: '/p', PATH: '/bin' })), ['PATH'],
        'a runner\'s stack key, entrypoint and project dir never reach a hook');
    assert.ok(!('ALFRED_CODE_DOCS_PATH' in process.env) && !('CLAUDE_CODE_ENTRYPOINT' in process.env), 'and this suite runs without them');
});

// Seam review m3: memory.js's projectRootOf finds an install record in ANY folder between the launch directory and the
// git top, so a monorepo package with its own install is set up - and checkoutsOf, which fed only the launch directory
// and the top, called it never set up. A git repo AT the home directory is no project top for either reader.
test('a record in a folder between the launch directory and the git top counts as set up (seam m3)', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-mid-')));
    try
    {
        fs.mkdirSync(path.join(base, '.git'));
        const pkg = path.join(base, 'packages', 'app');
        const deep = path.join(pkg, 'src', 'deep');
        fs.mkdirSync(deep, { recursive: true });
        assert.strictEqual(neverSetUp(unsetEnv(deep)), true, 'no record anywhere');
        fs.mkdirSync(path.join(pkg, '.claude'));
        fs.writeFileSync(path.join(pkg, '.claude', 'alfred-code.stamp'), 'version: 2.1.6\n');
        assert.strictEqual(neverSetUp(unsetEnv(deep)), false, 'the package between the launch dir and the top holds the record');
        assert.ok(checkoutsOf(deep).includes(pkg), 'checkoutsOf names it');
    }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a git repo at the home directory is no top for checkoutsOf (seam m3)', () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-home-')));
    const saved = process.env.HOME;
    try
    {
        process.env.HOME = home;
        fs.mkdirSync(path.join(home, '.git'));
        const project = path.join(home, 'work', 'proj');
        fs.mkdirSync(project, { recursive: true });
        assert.ok(!checkoutsOf(project).includes(home), 'the home directory is never a checkout');
        assert.deepStrictEqual(checkoutsOf(project), [project], 'a project below a home repo stands on its own');
    }
    finally { process.env.HOME = saved; fs.rmSync(home, { recursive: true, force: true }); }
});
