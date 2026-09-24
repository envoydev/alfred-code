'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRELUDE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const { hookDisabled, yieldToCopiedTwin, aliasYieldsToCore, standDown } = require(PRELUDE);
const { spawnSync } = require('node:child_process');
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
const coreCommand = (file) => Object.values(coreEntry().hooks).flat().flatMap((g) => g.hooks).map((h) => h.command).find((c) => c.includes(`/stack/hooks/${file}`));
function fire(file, env)
{
    const rel = coreCommand(file).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)[1];
    const clean = { PATH: process.env.PATH, HOME: env.CLAUDE_CONFIG_DIR || os.tmpdir(), ...env };
    return spawnSync(process.execPath, [path.join(__dirname, '..', rel)], {
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
