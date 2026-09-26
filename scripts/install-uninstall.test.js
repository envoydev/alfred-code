'use strict';
// R10 UNINSTALL - `alfred-code.js uninstall` removes exactly what the ledger says the stack manages in
// this project, and nothing else: the library copies and every other copy whose hash still matches, the
// env keys whose value still matches, the deny entries and hook wirings it wrote, its .mcp.json entries,
// the stamp. The user's own key, hook and server stay, and so does anything edited since the stack wrote
// it. Plugin rows go at project and local scope; a user-scope row serves every project on the account,
// so its commands are printed, never run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const uninstall = require('./install/uninstall.js');
const { hashItem } = require('./install/library.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-uninstall-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
const put = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };

test('removeManagedFiles: a copy whose hash still matches goes, an edited one and the user\'s own stay; emptied folders go (R10)', () =>
{
    const claudeDir = path.join(TMP, `f-${seq++}`, '.claude');
    put(path.join(claudeDir, 'skills', 'csharp', 'SKILL.md'), 'stack');
    put(path.join(claudeDir, 'skills', 'mine', 'SKILL.md'), 'mine');
    put(path.join(claudeDir, 'rules', 'baseline-git.md'), 'stack rule');
    put(path.join(claudeDir, 'rules', 'edited.md'), 'stack rule');
    put(path.join(claudeDir, 'hooks', 'docs.js'), 'engine');
    put(path.join(claudeDir, 'agents', 'seat.md'), 'seat');
    const library = { skills: { csharp: hashItem(path.join(claudeDir, 'skills', 'csharp')) }, agents: {},
        rules: { 'baseline-git': hashItem(path.join(claudeDir, 'rules', 'baseline-git.md')), edited: hashItem(path.join(claudeDir, 'rules', 'edited.md')) } };
    const files = { 'hooks/docs.js': hashItem(path.join(claudeDir, 'hooks', 'docs.js')), 'agents/seat.md': hashItem(path.join(claudeDir, 'agents', 'seat.md')) };
    fs.writeFileSync(path.join(claudeDir, 'rules', 'edited.md'), 'edited by hand');
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), library, files, log: (m) => logs.push(m) });
    assert.ok(!fs.existsSync(path.join(claudeDir, 'skills', 'csharp')));
    assert.ok(fs.existsSync(path.join(claudeDir, 'skills', 'mine', 'SKILL.md')), 'the user\'s own skill stays');
    assert.ok(!fs.existsSync(path.join(claudeDir, 'rules', 'baseline-git.md')));
    assert.strictEqual(fs.readFileSync(path.join(claudeDir, 'rules', 'edited.md'), 'utf8'), 'edited by hand');
    assert.ok(!fs.existsSync(path.join(claudeDir, 'hooks')), 'an emptied folder goes');
    assert.ok(!fs.existsSync(path.join(claudeDir, 'agents')));
    assert.match(logs.join('\n'), /rule edited: kept - changed since the stack wrote it, so it is yours/);
});

// Review finding 14: the CommonJS marker scopes every .js in .claude/hooks - the user's own CommonJS hooks
// too - so it stays while the folder holds anything the uninstall did not remove.
test('removeManagedFiles: the hooks CommonJS marker stays while a hook of the user\'s is left beside it', () =>
{
    const claudeDir = path.join(TMP, `f-${seq++}`, '.claude');
    put(path.join(claudeDir, 'hooks', 'docs.js'), 'engine');
    put(path.join(claudeDir, 'hooks', 'my-hook.js'), 'module.exports = 1;');
    put(path.join(claudeDir, 'hooks', 'package.json'), '{ "type": "commonjs" }\n');
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files: { 'hooks/docs.js': hashItem(path.join(claudeDir, 'hooks', 'docs.js')) }, log: (m) => logs.push(m) });
    assert.deepStrictEqual(fs.readdirSync(path.join(claudeDir, 'hooks')).sort(), ['my-hook.js', 'package.json'], logs.join('\n'));
    assert.match(logs.join('\n'), /hooks marker kept: package\.json/);
    fs.rmSync(path.join(claudeDir, 'hooks', 'my-hook.js'));
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), log: () => {} });
    assert.ok(!fs.existsSync(path.join(claudeDir, 'hooks')), 'with nothing else left the marker goes, and the folder with it');
});

// Review finding 4: a stamp is project text, so a library name is a path segment only - a traversal
// name at a matching hash never reaches the removal, whether it came through readLibrary or not.
test('removeManagedFiles: a library name that leaves its .claude folder is never removed, even at a matching hash', () =>
{
    const base = path.join(TMP, `f-${seq++}`);
    const claudeDir = path.join(base, 'repo', '.claude');
    const outside = path.join(base, 'repo', 'src');
    put(path.join(outside, 'index.js'), 'the project\'s own code');
    put(path.join(claudeDir, 'rules', 'x.md'), 'rule');
    const library = { skills: { '../../src': hashItem(outside) }, agents: { '../../src/index': hashItem(path.join(outside, 'index.js')) }, rules: { x: hashItem(path.join(claudeDir, 'rules', 'x.md')) } };
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), library, log: () => {} });
    assert.ok(fs.existsSync(path.join(outside, 'index.js')), 'the directory outside .claude survives');
    assert.ok(!fs.existsSync(path.join(claudeDir, 'rules', 'x.md')), 'a valid name still goes');
});

test('removePlugins: the stack\'s rows at project or local scope are uninstalled, dependents first; user-scope rows are printed, never run (R10, ruling)', () =>
{
    const rows = [
        { name: 'alfred-code', marketplace: 'envoydev', scope: 'project', version: '2.0.0', enabled: true },
        { name: 'navigation', marketplace: 'envoydev', scope: 'project', version: '2.0.0', enabled: true },
        { name: 'browser-chrome', marketplace: 'envoydev', scope: 'user', version: '2.0.0', enabled: true },
        { name: 'claude-md-management', marketplace: 'claude-plugins-official', scope: 'project', version: '1.0.0', enabled: true },
    ];
    const calls = [];
    // The CLI refuses a dependency first while its dependent is installed.
    const cli = (argv) => { calls.push(argv.join(' ')); return !(argv[2] === 'navigation@envoydev' && !calls.some((c) => c.startsWith('plugin uninstall alfred-code@'))); };
    const logs = [];
    uninstall.removePlugins({ rows, market: 'envoydev', scope: 'project', thirdParty: ['claude-md-management@claude-plugins-official'], cli, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'));
    assert.ok(calls.includes('plugin uninstall navigation@envoydev --scope project -y'));
    assert.ok(!calls.some((c) => /browser-chrome|claude-md-management/.test(c)), calls.join('\n'));
    const text = logs.join('\n');
    assert.doesNotMatch(text, /NOTE/, 'a dependency refused first is retried once its dependent is gone');
    assert.match(text, /browser-chrome@envoydev is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall browser-chrome@envoydev --scope user/);
    assert.match(text, /claude-md-management@claude-plugins-official .*not removed.*claude plugin uninstall claude-md-management@claude-plugins-official --scope project/);

    const userCalls = [];
    uninstall.removePlugins({ rows: rows.map((r) => ({ ...r, scope: 'user' })), market: 'envoydev', scope: 'user', cli: (a) => { userCalls.push(a); return true; }, log: () => {} });
    assert.deepStrictEqual(userCalls, [], 'a user-scope install is never uninstalled from here');
});

// End to end through the Node seed and a recording `claude`: install on the default plugin route, the
// user adds their own hook, server and key, then uninstall.
const LISTING = JSON.stringify([
    { id: 'alfred-code@envoydev', scope: 'project', version: '2.0.0', enabled: true },
    { id: 'navigation@envoydev', scope: 'project', version: '2.0.0', enabled: true },
]);
const USER_HOOK = { type: 'command', command: 'node my-hook.js', timeout: 5 };

test('uninstall: every stack file and managed entry goes, the user\'s own hook, server and key stay (R10)', POSIX_ONLY, () =>
{
    const { calls, result, outs } = seedRun(['install', 'uninstall'], 'skill csharp\nrule markdown-docs\n', {
        plugins: LISTING,
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const settings = path.join(repo, '.claude', 'settings.json');
            const data = JSON.parse(fs.readFileSync(settings, 'utf8'));
            data.env.MY_KEY = 'mine';
            data.env.ALFRED_CODE_PUSH_GATE = '0';
            data.hooks = { Stop: [{ hooks: [USER_HOOK] }] };
            fs.writeFileSync(settings, JSON.stringify(data, null, 2));
            fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'node', args: ['srv.js'] } } }));
            return fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
        },
        inspect: (repo) =>
        {
            const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort() : []);
            return {
                claude: list(path.join(repo, '.claude')),
                settings: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
                mcp: JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')),
            };
        },
    });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'), calls.join('\n'));
    assert.ok(calls.includes('plugin uninstall navigation@envoydev --scope project -y'), calls.join('\n'));
    assert.deepStrictEqual(result.settings.env, { MY_KEY: 'mine', ALFRED_CODE_PUSH_GATE: '0' }, 'the user\'s key and a value they changed stay; every seed the stack wrote goes');
    assert.deepStrictEqual(result.settings.hooks, { Stop: [{ hooks: [USER_HOOK] }] });
    assert.deepStrictEqual(result.mcp, { mcpServers: { mine: { command: 'node', args: ['srv.js'] } } });
    assert.deepStrictEqual(Object.keys(result.settings).filter((k) => k !== 'enabledPlugins').sort(), ['env', 'hooks'], 'no attribution key, no empty list the stack wrote');
    assert.deepStrictEqual(result.claude, ['settings.json'], `stack files left: ${result.claude}`);
    assert.match(outs[1], /stamp removed/);
});

// A project the stack never touched before: nothing already there is adopted (no stamp = nothing
// managed yet), so the user's own deny entry and attribution key survive the round trip even at the
// value the stack would have written; with nothing else of theirs, every stack file goes.
test('uninstall: what the project held before the first install is never the stack\'s, even at the stack\'s own value (R10)', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        plugins: LISTING,
        prepare: (repo) => put(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'] }, attribution: { commit: '' } })),
        inspect: (repo) => ({
            files: fs.readdirSync(path.join(repo, '.claude')).sort(),
            settings: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
        }),
    });
    const { enabledPlugins, ...rest } = result.settings;
    assert.deepStrictEqual(rest, { permissions: { deny: ['Read(.env)'] }, attribution: { commit: '' } });
    assert.ok(!enabledPlugins || Object.keys(enabledPlugins).length, 'an emptied enabledPlugins goes; what is left is the plugin CLI\'s own rows, which the stub does not remove');
    assert.deepStrictEqual(result.files, ['settings.json']);
});

test('uninstall: a stamp from before the ledger is refused with the route to take, and nothing is touched (R10 ruling)', POSIX_ONLY, () =>
{
    const { code, err, result } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        failOk: true,
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
            fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').split('\n').filter((l) => !l.startsWith('managed-')).join('\n'));
        },
        inspect: (repo) => ({ stamp: fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')), rule: fs.existsSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md')) }),
    });
    assert.strictEqual(code, 1);
    assert.match(err, /predates the install ledger.*run \/alfred-code:update once .*then uninstall/);
    assert.deepStrictEqual(result, { stamp: true, rule: true });
});

test('uninstall: nothing installed is refused before anything runs', POSIX_ONLY, () =>
{
    const { code, err, calls } = seedRun('uninstall', '', { failOk: true });
    assert.strictEqual(code, 1);
    assert.match(err, /no alfred-code install here/);
    assert.deepStrictEqual(calls, []);
});

// Review finding 1: the ledger claims an entry in the FILE it was recorded for. A local-scope install
// records its secret-file denies in settings.local.json; a move back to project scope carries them into
// settings.json - but the ones the team's settings.json already held were never the stack's there, so
// uninstall leaves them.
test('uninstall after a move off local scope keeps the deny entries settings.json held before the move', POSIX_ONLY, () =>
{
    const { result, outs } = seedRun(['install', 'update', 'uninstall'], 'rule markdown-docs\n', {
        args: [['--scope', 'local'], ['--scope', 'project'], []],
        prepare: (repo) => put(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)', 'Read(*.pem)', 'Bash(rm -rf:*)'] } })),
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
    });
    assert.deepStrictEqual(result.permissions, { deny: ['Read(.env)', 'Read(*.pem)', 'Bash(rm -rf:*)'] }, outs[2]);
});

// Review finding 6: the first update of a pre-ledger install has no ledger to read, so a secret-file
// deny already in settings.json may be the team's - never claimed, so uninstall leaves it.
test('uninstall after the first update of a pre-ledger install keeps a secret-file deny the team held', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'update', 'uninstall'], 'rule markdown-docs\n', {
        prepare: (repo) => put(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'] } })),
        each: (repo, i) =>
        {
            if (i !== 0) return;
            const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
            fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').split('\n').filter((l) => !l.startsWith('managed-')).join('\n'));
        },
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')),
    });
    assert.ok(result.permissions.deny.includes('Read(.env)'), JSON.stringify(result.permissions));
});

// Review finding 3: a plugin listing that is not JSON is no empty list - uninstall refuses before any
// change, so the stamp still lists what a retry must remove.
test('uninstall with an unreadable plugin listing refuses before any change', POSIX_ONLY, () =>
{
    const { code, err, calls, result } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        plugins: LISTING, failOk: true,
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), 'Error: not logged in'); },
        inspect: (repo) => ({ stamp: fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')), rule: fs.existsSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md')) }),
    });
    assert.strictEqual(code, 1);
    assert.match(err, /claude plugin list --json.*run uninstall again/);
    assert.ok(!calls.some((c) => c.startsWith('plugin uninstall')), calls.join('\n'));
    assert.deepStrictEqual(result, { stamp: true, rule: true });
});

// Review finding 5: an update the settings file refused (it did not parse) wrote nothing there, so the
// ledger keeps that file's entries as the last run recorded them - once the file is fixed, uninstall
// still knows every key the stack wrote.
test('uninstall after an update over a malformed settings.json still removes every stack key', POSIX_ONLY, () =>
{
    let good = '';
    const { result, outs } = seedRun(['install', 'update', 'update', 'uninstall'], 'rule markdown-docs\n', {
        failOk: true,
        each: (repo, i) =>
        {
            const file = path.join(repo, '.claude', 'settings.json');
            if (i === 0) { good = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, '{ broken'); }
            if (i === 1) fs.writeFileSync(file, good);
        },
        inspect: (repo) =>
        {
            const file = path.join(repo, '.claude', 'settings.json');
            return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        },
    });
    assert.deepStrictEqual(Object.keys(result.env || {}).filter((k) => k.startsWith('ALFRED_CODE_')), [], outs[3]);
    assert.ok(!result.attribution && !result.worktree, JSON.stringify(result));
});

// Review finding 7: on the MCP copy route a local- or user-scope registration lives in the ACCOUNT file,
// not .mcp.json. The stub below keeps `claude mcp add` / `remove` there the way the CLI does (local: the
// project's own row, user: the top level), so the ledger reads back what was registered.
const MCP_STUB = path.join(TMP, 'mcp-stub.js');
put(MCP_STUB, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
const [verb, ...rest] = process.argv.slice(3);
const holder = (scope) => (scope === 'user' ? data : ((data.projects ||= {})[process.cwd()] ||= {}));
if (verb === 'add')
{
    let scope = 'local';
    let name = null;
    const words = [];
    for (let i = 0; i < rest.length; i++)
    {
        if (name === null && ['--transport', '--scope', '-s', '--header', '-e', '--env'].includes(rest[i])) { if (rest[i] === '--scope' || rest[i] === '-s') scope = rest[i + 1]; i++; continue; }
        if (name === null) name = rest[i]; else words.push(rest[i]);
    }
    (holder(scope).mcpServers ||= {})[name] = { command: 'stub', args: words };
}
else if (verb === 'remove')
{
    const scope = rest[rest.indexOf('-s') + 1];
    const servers = holder(scope).mcpServers || {};
    if (!servers[rest[0]]) { process.stderr.write('No MCP server named ' + rest[0] + '\\n'); process.exit(1); }
    delete servers[rest[0]];
}
else process.exit(1);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(data, null, 2));
`);
const RECORDING_CLAUDE = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
    'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; fi',
    `if [ "$1" = "mcp" ]; then exec "${process.execPath}" "${MCP_STUB}" "$@"; fi`, 'exit 0'].join('\n');
const accountOf = (repo) => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), 'utf8')); } catch { return {}; } };
const localServers = (account) => Object.values(account.projects || {}).map((p) => Object.keys(p.mcpServers || {})).flat().sort();

test('uninstall removes the copy route\'s own local-scope registrations and keeps the user\'s', POSIX_ONLY, () =>
{
    const { calls, steps, result, outs } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        tools: { claude: RECORDING_CLAUDE },
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        args: [['--scope', 'local'], []],
        each: (repo, i) =>
        {
            const account = accountOf(repo);
            const held = localServers(account);
            if (i === 0)
            {
                Object.values(account.projects)[0].mcpServers.mine = { command: 'node', args: ['mine.js'] };
                fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), JSON.stringify(account));
            }
            return held;
        },
        inspect: (repo) => localServers(accountOf(repo)),
    });
    assert.deepStrictEqual(steps[0], ['documentation', 'memory', 'navigation'], outs[0]);
    for (const name of ['navigation', 'documentation', 'memory']) assert.ok(calls.includes(`mcp remove ${name} -s local`), calls.join('\n'));
    assert.deepStrictEqual(result, ['mine'], outs[1]);
    assert.match(outs[1], /mcp removed: navigation \(local scope\)/);
});

test('uninstall prints the user-scope registrations\' remove commands and never runs them', POSIX_ONLY, () =>
{
    const { calls, result, outs } = seedRun(['install', 'uninstall'], 'rule markdown-docs\nmcp browser\n', {
        tools: { claude: RECORDING_CLAUDE },
        env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
        args: [['--scope', 'user', '--playwright-browsers', 'chrome'], []],
        inspect: (repo) => Object.keys(accountOf(repo).mcpServers || {}).sort(),
    });
    const uninstallCalls = calls.slice(calls.lastIndexOf('plugin list --json'));
    assert.ok(!uninstallCalls.some((c) => c.startsWith('mcp remove')), uninstallCalls.join('\n'));
    assert.deepStrictEqual(result, ['browser-chrome'], outs[0]);
    assert.match(outs[1], /browser-chrome is registered at user scope.*claude mcp remove browser-chrome -s user/);
});
