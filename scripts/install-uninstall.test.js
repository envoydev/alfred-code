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
const { execFileSync } = require('node:child_process');
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
    put(path.join(claudeDir, 'rules', 'alfred-git.md'), 'stack rule');
    put(path.join(claudeDir, 'rules', 'edited.md'), 'stack rule');
    put(path.join(claudeDir, 'hooks', 'docs.js'), 'engine');
    put(path.join(claudeDir, 'agents', 'seat.md'), 'seat');
    const library = { skills: { csharp: hashItem(path.join(claudeDir, 'skills', 'csharp')) }, agents: {},
        rules: { 'alfred-git': hashItem(path.join(claudeDir, 'rules', 'alfred-git.md')), edited: hashItem(path.join(claudeDir, 'rules', 'edited.md')) } };
    const files = { 'hooks/docs.js': hashItem(path.join(claudeDir, 'hooks', 'docs.js')), 'agents/seat.md': hashItem(path.join(claudeDir, 'agents', 'seat.md')) };
    fs.writeFileSync(path.join(claudeDir, 'rules', 'edited.md'), 'edited by hand');
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), library, files, log: (m) => logs.push(m) });
    assert.ok(!fs.existsSync(path.join(claudeDir, 'skills', 'csharp')));
    assert.ok(fs.existsSync(path.join(claudeDir, 'skills', 'mine', 'SKILL.md')), 'the user\'s own skill stays');
    assert.ok(!fs.existsSync(path.join(claudeDir, 'rules', 'alfred-git.md')));
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
        { name: 'alfred-navigation', marketplace: 'envoydev', scope: 'project', version: '2.0.0', enabled: true },
        { name: 'browser-chrome', marketplace: 'envoydev', scope: 'user', version: '2.0.0', enabled: true },
        { name: 'csharp-lsp', marketplace: 'claude-plugins-official', scope: 'project', version: '1.0.0', enabled: true },
    ];
    const calls = [];
    // The CLI refuses a dependency first while its dependent is installed.
    const cli = (argv) => { calls.push(argv.join(' ')); return !(argv[2] === 'alfred-navigation@envoydev' && !calls.some((c) => c.startsWith('plugin uninstall alfred-code@'))); };
    const logs = [];
    uninstall.removePlugins({ rows, market: 'envoydev', scope: 'project', thirdParty: ['csharp-lsp@claude-plugins-official'], cli, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'));
    assert.ok(calls.includes('plugin uninstall alfred-navigation@envoydev --scope project -y'));
    assert.ok(!calls.some((c) => /browser-chrome|csharp-lsp/.test(c)), calls.join('\n'));
    const text = logs.join('\n');
    assert.doesNotMatch(text, /NOTE/, 'a dependency refused first is retried once its dependent is gone');
    assert.match(text, /browser-chrome@envoydev is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall browser-chrome@envoydev --scope user/);
    assert.match(text, /csharp-lsp@claude-plugins-official .*not removed.*claude plugin uninstall csharp-lsp@claude-plugins-official --scope project/);

    const userCalls = [];
    uninstall.removePlugins({ rows: rows.map((r) => ({ ...r, scope: 'user' })), market: 'envoydev', scope: 'user', cli: (a) => { userCalls.push(a); return true; }, log: () => {} });
    assert.deepStrictEqual(userCalls, [], 'a user-scope install is never uninstalled from here');
});

// End to end through the Node seed and a recording `claude`: install on the default plugin route, the
// user adds their own hook, server and key, then uninstall.
const LISTING = JSON.stringify([
    { id: 'alfred-code@envoydev', scope: 'project', version: '2.0.0', enabled: true },
    { id: 'alfred-navigation@envoydev', scope: 'project', version: '2.0.0', enabled: true },
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
    assert.ok(calls.includes('plugin uninstall alfred-navigation@envoydev --scope project -y'), calls.join('\n'));
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

// X1 (matrix 2.1.4 re-run, observation 1): at PROJECT scope the --installed-only read-back took every .mcp.json name
// as a pick, so a server of the user's own under a stack name (`macos-desktop` running `node my-desktop.js`) was
// overwritten with the stack's entry on the next update, recorded in managed-mcp and pulled in the desktop skill.
// Only the names the prior stamp's managed-mcp ledger records at project scope are picks; a stamp with no ledger (a
// pre-ledger install) keeps reading every name, as it did.
const PROJECT_COPY = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' };
const mcpjsonOf = (repo) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {}; } catch { return {}; } };
const projectState = (repo) => ({
    entry: mcpjsonOf(repo)['macos-desktop'] || null,
    skill: fs.existsSync(path.join(repo, '.claude', 'skills', 'desktop-automation')),
    stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
});
test('X1 seed update --installed-only (full copy route, project scope): the user\'s own .mcp.json server under a stack name is never adopted', POSIX_ONLY, () =>
{
    const own = { command: 'node', args: ['my-desktop.js'] };
    const { steps, outs } = seedRun(['install', 'update'], 'rule markdown-docs\n', {
        env: PROJECT_COPY, args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                const data = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
                data.mcpServers['macos-desktop'] = own;
                fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(data, null, 2));
            }
            return projectState(repo);
        },
    });
    const after = steps[1];
    assert.deepStrictEqual(after.entry, own, `the user's server was rewritten:\n${outs[1]}`);
    assert.strictEqual(after.skill, false, `its skill was copied in as if picked:\n${outs[1]}`);
    assert.doesNotMatch(after.stamp, /macos-desktop/, `it reached the stamp:\n${after.stamp}`);
});

test('X1 seed update --installed-only (full copy route, project scope): a server the stack registered is still read back - with a ledger and without one', POSIX_ONLY, () =>
{
    for (const preLedger of [false, true])
    {
        const { steps, outs } = seedRun(['install', 'update'], 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n', {
            env: PROJECT_COPY, args: [[], ['--installed-only']],
            each: (repo, i) =>
            {
                const file = path.join(repo, '.claude', 'alfred-code.stamp');
                if (i === 0 && preLedger) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^managed-/.test(l)).join('\n'));
                return projectState(repo);
            },
        });
        assert.ok(steps[0].entry && steps[0].skill, `the install itself (preLedger=${preLedger}):\n${outs[0]}`);
        assert.ok(steps[1].entry, `the update dropped macos-desktop (preLedger=${preLedger}):\n${outs[1]}`);
        assert.strictEqual(steps[1].skill, true, `the update dropped its skill (preLedger=${preLedger}):\n${outs[1]}`);
        assert.match(steps[1].stamp, /^managed-mcp:.*\bmacos-desktop=/m, `the ledger records it again (preLedger=${preLedger})`);
    }
});

// X1, the browser-engine half (review 2.1.5 plugin, MATERIAL 3): the engines .mcp.json registers were read back with no
// ledger gate, so a user's own `browser-firefox` was overwritten with the stack's npx entry, entered managed-mcp (so
// uninstall would delete it) and grew the stamp's browser-engines. An engine is read back only when the prior stamp's
// managed-mcp ledger records its browser-<e> / playwright-<e> name; the stamp's browser-engines stays the record.
const engineState = (repo) => ({
    firefox: mcpjsonOf(repo)['browser-firefox'] || null,
    stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
});
const stampLine = (stamp, key) => (stamp.split('\n').find((l) => l.startsWith(`${key}:`)) || '').slice(key.length + 1).trim();
test('X1 seed update --installed-only (full copy route): the user\'s own browser-<engine> in .mcp.json is never taken as a kept engine - project and user scope', POSIX_ONLY, () =>
{
    const own = { command: 'node', args: ['my-ff.js'] };
    for (const scope of ['project', 'user'])
    {
        const { steps, outs } = seedRun(['install', 'update', 'update'], 'rule markdown-docs\nmcp browser\n', {
            env: PROJECT_COPY, args: [['--scope', scope, '--browsers', 'chrome'], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only']],
            each: (repo, i) =>
            {
                if (i === 0)
                {
                    const data = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
                    data.mcpServers['browser-firefox'] = own;
                    fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(data, null, 2));
                }
                return engineState(repo);
            },
        });
        for (const i of [1, 2])
        {
            assert.deepStrictEqual(steps[i].firefox, own, `${scope}, update ${i}: the user's server was rewritten:\n${outs[i]}`);
            assert.doesNotMatch(stampLine(steps[i].stamp, 'managed-mcp'), /browser-firefox/, `${scope}, update ${i}: it entered the ledger`);
            assert.strictEqual(stampLine(steps[i].stamp, 'browser-engines'), 'chrome', `${scope}, update ${i}: browser-engines grew`);
        }
    }
});

test('X1 seed update --installed-only (full copy route): an engine the stack registered is still read back from .mcp.json - ledgered, or on a pre-ledger stamp', POSIX_ONLY, () =>
{
    for (const preLedger of [false, true])
    {
        const { steps, outs } = seedRun(['install', 'update'], 'rule markdown-docs\nmcp browser\n', {
            env: PROJECT_COPY, args: [['--browsers', 'chrome,firefox'], ['--installed-only']],
            each: (repo, i) =>
            {
                // Only .mcp.json and the ledger can answer: the stamp's own browser lines are taken away.
                const file = path.join(repo, '.claude', 'alfred-code.stamp');
                const drop = preLedger ? /^(browser-(engines|enabled)|managed-[a-z]+):/ : /^browser-(engines|enabled):/;
                if (i === 0) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !drop.test(l)).join('\n'));
                return engineState(repo);
            },
        });
        assert.ok(steps[0].firefox, `the install registered firefox (preLedger=${preLedger}):\n${outs[0]}`);
        assert.ok(steps[1].firefox, `the update dropped firefox (preLedger=${preLedger}):\n${outs[1]}`);
        assert.strictEqual(stampLine(steps[1].stamp, 'browser-engines'), 'chrome,firefox', `preLedger=${preLedger}\n${outs[1]}`);
        assert.match(stampLine(steps[1].stamp, 'managed-mcp'), /\bbrowser-firefox=/, `preLedger=${preLedger}`);
    }
});

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
    assert.deepStrictEqual(steps[0], ['alfred-documentation', 'alfred-memory', 'alfred-navigation'], outs[0]);
    for (const name of ['alfred-navigation', 'alfred-documentation', 'alfred-memory']) assert.ok(calls.includes(`mcp remove ${name} -s local`), calls.join('\n'));
    assert.deepStrictEqual(result, ['mine'], outs[1]);
    assert.match(outs[1], /mcp removed: alfred-navigation \(local scope\)/);
});

// Matrix 3d (2.1.4): at local scope the copy route registers in the account's projects[<root>].mcpServers, and the
// --installed-only read-back read .mcp.json alone - so the first update dropped macos-desktop from the set and
// re-spelled the copied desktop skill (and evidence-gatherer's grant) to the plugin tools, while the local
// registration stayed live and nothing served the new spelling.
test('seed update --installed-only (full copy route, local scope): a local-scope registration is read back as a pick', POSIX_ONLY, () =>
{
    const skill = (repo) => fs.readFileSync(path.join(repo, '.claude', 'skills', 'desktop-automation', 'SKILL.md'), 'utf8');
    const { steps, outs } = seedRun(['install', 'update'], 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n', {
        tools: { claude: RECORDING_CLAUDE },
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' },
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo) => ({ servers: localServers(accountOf(repo)), plugin: /mcp__plugin_macos-desktop_/.test(skill(repo)) }),
    });
    assert.ok(steps[0].servers.includes('macos-desktop') && !steps[0].plugin, `the install itself: ${JSON.stringify(steps[0])}\n${outs[0]}`);
    assert.ok(steps[1].servers.includes('macos-desktop'), `the update dropped it: ${JSON.stringify(steps[1])}\n${outs[1]}`);
    assert.strictEqual(steps[1].plugin, false, `the copied skill was re-spelled to the plugin tools:\n${outs[1]}`);
});

// Matrix re-run: the read-back above must not adopt a server of the user's own that merely carries a stack name -
// only what the stamp's managed-mcp ledger says the stack registered at that scope is a pick.
test('seed update --installed-only (full copy route, local scope): the user\'s own local server under a stack name is never adopted', POSIX_ONLY, () =>
{
    const own = { command: 'node', args: ['my-desktop.js'] };
    const { steps, outs } = seedRun(['install', 'update'], 'rule markdown-docs\n', {
        tools: { claude: RECORDING_CLAUDE },
        env: { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' },
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const account = accountOf(repo);
            if (i === 0)
            {
                Object.values(account.projects)[0].mcpServers['macos-desktop'] = own;
                fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), JSON.stringify(account));
            }
            return {
                entry: Object.values(accountOf(repo).projects || {})[0].mcpServers['macos-desktop'],
                skill: fs.existsSync(path.join(repo, '.claude', 'skills', 'desktop-automation')),
                stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
            };
        },
    });
    const after = steps[1];
    assert.deepStrictEqual(after.entry, own, `the user's server was rewritten:\n${outs[1]}`);
    assert.strictEqual(after.skill, false, `its skill was copied in as if picked:\n${outs[1]}`);
    assert.doesNotMatch(after.stamp, /macos-desktop/, `it reached the stamp:\n${after.stamp}`);
});

// Matrix 2.1.5 F1 (case 7e): the claude CLI replaces a corrupt account .claude.json at its first plugin or mcp call
// and keeps the old one under backups/ (measured on 2.1.284; `--version` leaves it alone). The read-back ran after
// that call, so it read a fresh, empty file: every local registration read as absent, macos-desktop left the set,
// its skill and evidence-gatherer's grant were re-spelled to plugin tools nothing serves on this route, and the
// ledger lost its row - so the next update, with a good file again, still left it out. This stub replaces a corrupt
// file the way the CLI does - the call that meets it prints the CLI's notice and none of its own answer (measured:
// `plugin list --json` printed no listing), a 0-byte file included - rewrites an array or a scalar as an object in
// place with no backup (measured on 2.1.284: `[1,2]` became `{"0":1,"1":2,...}`), and otherwise answers as the
// recording stub.
const REPLACING_STUB = path.join(TMP, 'replacing-stub.js');
put(REPLACING_STUB, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
if (['plugin', 'mcp'].includes(process.argv[2]))
{
    try
    {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) fs.writeFileSync(file, JSON.stringify({ ...Object(data) }));
    }
    catch (err)
    {
        if (err.code !== 'ENOENT')
        {
            const dir = path.join(path.dirname(file), 'backups');
            fs.mkdirSync(dir, { recursive: true });
            // The CLI keeps every corrupted copy it makes, but none for content it already backed up (measured on 2.1.284).
            const body = fs.readFileSync(file, 'utf8');
            const seen = fs.readdirSync(dir).some((n) => n.startsWith('.claude.json.corrupted.') && fs.readFileSync(path.join(dir, n), 'utf8') === body);
            if (seen) fs.rmSync(file); else fs.renameSync(file, path.join(dir, '.claude.json.corrupted.' + Date.now()));
            fs.writeFileSync(file, '{}');
            process.stderr.write('Claude configuration file at ' + file + ' is corrupted\\nThe corrupted file has already been backed up.\\n');
            process.exit(1);
        }
    }
}
`);
const REPLACING_CLAUDE = [`printf '%s\\n' "$*" >> "$CLAUDE_STUB_LOG"`, `"${process.execPath}" "${REPLACING_STUB}" "$1" || exit 1`,
    ...RECORDING_CLAUDE.split('\n').slice(1)].join('\n');
const COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_PLATFORM: 'darwin' };
const DESKTOP_SEL = 'rule markdown-docs\nskill desktop-automation\nagent evidence-gatherer\nmcp macos-desktop\n';
const desktopState = (repo) =>
{
    const read = (...p) => fs.readFileSync(path.join(repo, '.claude', ...p), 'utf8');
    return {
        servers: localServers(accountOf(repo)),
        respelled: /mcp__plugin_macos-desktop_/.test(read('skills', 'desktop-automation', 'SKILL.md')) || /mcp__plugin_macos-desktop_/.test(read('agents', 'evidence-gatherer.md')),
        ledger: (/^managed-mcp: (.*)$/m.exec(read('alfred-code.stamp')) || [])[1] || '',
    };
};

// What every command runs before the installer (source-protocol.md's `claude plugin marketplace update`): a claude call
// that meets the corrupt file first - by the time the installer reads it, it is a fresh, valid one (review 2.1.6 B1).
const snippetCall = (repo) =>
{
    try { execFileSync(process.execPath, [REPLACING_STUB, 'plugin'], { env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(path.dirname(repo), 'acct') }, stdio: 'ignore' }); }
    catch { /* the CLI's own exit 1 on a replaced file */ }
};
// The install a minute before: the stamp's `installed:` second is what a later backup is newer than.
const backdate = (repo) =>
{
    const file = path.join(repo, '.claude', 'alfred-code.stamp');
    const then = new Date(Date.now() - 60000);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^installed: .*$/m, `installed: ${then.toISOString().replace(/\.\d{3}Z$/, 'Z')}`)
        .replace(/^installed-ms: .*$/m, `installed-ms: ${then.getTime()}`));
};
const F1_LINE = /!! mcp: \S*\.claude\.json /;
// The F1 contract on every corrupt shape and route: both updates keep macos-desktop, its bare spelling and its ledger row,
// and the first says the account file once, before its first registration; the second, over a good file, says nothing.
const assertF1 = (steps, outs, label) =>
{
    for (const i of [1, 2])
    {
        assert.ok(steps[i].servers.includes('macos-desktop'), `${label}: update ${i} dropped macos-desktop: ${JSON.stringify(steps[i])}\n${outs[i]}`);
        assert.strictEqual(steps[i].respelled, false, `${label}: update ${i} re-spelled the desktop skill or seat to plugin tools:\n${outs[i]}`);
        assert.match(steps[i].ledger, /local:macos-desktop=/, `${label}: update ${i} lost the ledger row: ${steps[i].ledger}`);
    }
    const said = outs[1].split('\n').filter((l) => F1_LINE.test(l));
    assert.strictEqual(said.length, 1, `${label}: the account file is said once:\n${outs[1]}`);
    assert.ok(outs[1].indexOf(said[0]) < outs[1].indexOf('mcp [local]:'), `${label}: the line comes before the first registration:\n${outs[1]}`);
    assert.doesNotMatch(outs[2], F1_LINE, `${label}: a good file says nothing:\n${outs[2]}`);
    return said[0];
};
const f1Case = (corrupt) => seedRun(['install', 'update', 'update'], DESKTOP_SEL, {
    tools: { claude: REPLACING_CLAUDE },
    env: COPY_ROUTE,
    args: [['--scope', 'local'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
    each: (repo, i) =>
    {
        const state = desktopState(repo);
        if (i === 0) corrupt(repo, path.join(path.dirname(repo), 'acct', '.claude.json'));
        return state;
    },
});

test('seed update --installed-only (full copy route, local scope): an account file the CLI replaces as corrupt keeps the recorded registrations, said once before any call', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], DESKTOP_SEL, {
        tools: { claude: REPLACING_CLAUDE },
        env: COPY_ROUTE,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const state = desktopState(repo);
            if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), '{"projects": { "x": [1,2, garbage');
            return state;
        },
    });
    assert.ok(steps[0].servers.includes('macos-desktop') && !steps[0].respelled, `the install itself: ${JSON.stringify(steps[0])}\n${outs[0]}`);
    for (const i of [1, 2])
    {
        assert.ok(steps[i].servers.includes('macos-desktop'), `update ${i} dropped macos-desktop: ${JSON.stringify(steps[i])}\n${outs[i]}`);
        assert.strictEqual(steps[i].respelled, false, `update ${i} re-spelled the desktop skill or seat to plugin tools:\n${outs[i]}`);
        assert.match(steps[i].ledger, /local:macos-desktop=/, `update ${i} lost the ledger row: ${steps[i].ledger}`);
    }
    assert.doesNotMatch(outs[1], /adopting mcp alfred-navigation - always shipped by this release and absent here/, outs[1]);
    const said = outs[1].split('\n').filter((l) => /\.claude\.json could not be read/.test(l));
    assert.strictEqual(said.length, 1, `the unreadable account file is said once:\n${outs[1]}`);
    assert.match(said[0], /!! .*backups/, said[0]);
    assert.ok(outs[1].indexOf(said[0]) < outs[1].indexOf('mcp [local]:'), `the line comes before the first registration:\n${outs[1]}`);
    assert.doesNotMatch(outs[2], /\.claude\.json could not be read/, `a readable file says nothing:\n${outs[2]}`);
});

// Review 2.1.6 B1: every command runs a claude call before the installer (the source step's marketplace update), and that
// call replaces the corrupt file - so the installer read a fresh, valid one and the loss came back in full. The run decides
// from the stamp instead: the file unreadable now, a corrupted backup the CLI wrote after the stamp's own second, or the
// ledger recording registrations at the scope that the file holds none of. A 0-byte file (the usual torn write) is corrupt
// to the CLI too; an array it rewrites in place with no backup, so only the ledger can tell.
test('seed update --installed-only (full copy route, local scope): F1 holds when a claude call replaced the corrupt file before the installer ran', POSIX_ONLY, () =>
{
    const { steps, outs } = f1Case((repo, file) => { fs.writeFileSync(file, '{"projects": { "x": [1,2, garbage'); snippetCall(repo); backdate(repo); });
    const line = assertF1(steps, outs, 'snippet first');
    assert.match(line, /backups\/\.claude\.json\.corrupted\.\d+/, `it names the backup: ${line}`);
});

test('seed update --installed-only (full copy route, local scope): F1 holds over a 0-byte account file and over a JSON array', POSIX_ONLY, () =>
{
    const empty = f1Case((repo, file) => fs.writeFileSync(file, ''));
    assert.match(assertF1(empty.steps, empty.outs, '0-byte'), /backups\/\.claude\.json\.corrupted\.\d+/);
    const array = f1Case((repo, file) => fs.writeFileSync(file, '[1,2]'));
    assertF1(array.steps, array.outs, 'array');
    // A corruption the CLI already backed up (the same bytes) gets no new backup - measured on 2.1.284 - so the recovery
    // call proves nothing, and the rewritten file with no entry for the project carries it.
    const again = f1Case((repo, file) =>
    {
        fs.mkdirSync(path.join(path.dirname(file), 'backups'), { recursive: true });
        fs.writeFileSync(path.join(path.dirname(file), 'backups', `.claude.json.corrupted.${Date.now() - 86400000}`), '{"x": garbage');
        fs.writeFileSync(file, '{"x": garbage');
    });
    assert.match(assertF1(again.steps, again.outs, 'already backed up'), /holds no entry for this project/);
});

// Review 2.1.6 m4: the recovery call is taken as a replacement only when the CLI left a NEW corrupted backup. A torn read
// (another session mid-write) is whole again by then: the run reads it again and goes on as it finds it, and says nothing.
// A first install has no stamp to take registrations from, and says so.
test('seed update --installed-only (full copy route, local scope): an account file whole again by the recovery call is read again, and no replacement is claimed', POSIX_ONLY, () =>
{
    const torn = [`printf '%s\\n' "$*" >> "$CLAUDE_STUB_LOG"`,
        'if [ "$1" = "plugin" ] && [ "$2" = "marketplace" ] && [ -f "$CLAUDE_CONFIG_DIR/whole.json" ]; then mv "$CLAUDE_CONFIG_DIR/whole.json" "$CLAUDE_CONFIG_DIR/.claude.json"; fi',
        ...RECORDING_CLAUDE.split('\n').slice(1)].join('\n');
    const { steps, outs } = seedRun(['install', 'update'], DESKTOP_SEL, {
        tools: { claude: torn }, env: COPY_ROUTE,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const acct = path.join(path.dirname(repo), 'acct');
            if (i === 0) { fs.copyFileSync(path.join(acct, '.claude.json'), path.join(acct, 'whole.json')); fs.writeFileSync(path.join(acct, '.claude.json'), '{"projects": { "x"'); }
            return desktopState(repo);
        },
    });
    assert.doesNotMatch(outs[1], F1_LINE, `a replacement that never happened was claimed:\n${outs[1]}`);
    assert.ok(steps[1].servers.includes('macos-desktop') && !steps[1].respelled, `${JSON.stringify(steps[1])}\n${outs[1]}`);
    assert.match(steps[1].ledger, /local:macos-desktop=/);
});

test('seed install (full copy route, local scope): a first install over a corrupt account file says it has no stamp to take registrations from', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', DESKTOP_SEL, {
        tools: { claude: REPLACING_CLAUDE }, env: COPY_ROUTE, args: ['--scope', 'local'],
        prepare: (repo, work) => { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', '.claude.json'), '{"projects": { "x": [1,2, garbage'); },
        inspect: (repo) => desktopState(repo),
    });
    const said = out.split('\n').filter((l) => F1_LINE.test(l));
    assert.strictEqual(said.length, 1, out);
    assert.doesNotMatch(said[0], /as its stamp records/, said[0]);
    assert.match(said[0], /no stamp/, said[0]);
    assert.ok(result.servers.includes('macos-desktop'), `${JSON.stringify(result)}\n${out}`);
});

// Review 2.1.6 m3: uninstall over an unreadable account file refused before F1 (its plugin listing met the corrupt file);
// the recovery call made it run, and the stack's local registrations were left in the CLI's backup with the stamp gone.
// It refuses again, naming the backup - and on the command route too, where the source step replaced the file first.
test('uninstall over a corrupt account file refuses before any change and names the backup - direct, and after a claude call replaced it', POSIX_ONLY, () =>
{
    for (const snippet of [false, true])
    {
        const { code, err, calls, result, steps } = seedRun(['install', 'uninstall'], DESKTOP_SEL, {
            tools: { claude: REPLACING_CLAUDE }, env: COPY_ROUTE, failOk: true,
            args: [['--scope', 'local'], []],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), '{"projects": { "x": [1,2, garbage');
                if (snippet) { snippetCall(repo); backdate(repo); }
                return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            },
            inspect: (repo) => fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')),
        });
        assert.strictEqual(code, 1, `snippet=${snippet}: ${err}`);
        assert.strictEqual(result, true, `snippet=${snippet}: the stamp was removed`);
        assert.match(err, /backups\/\.claude\.json\.corrupted\.\d+/, `snippet=${snippet}: the refusal names the backup:\n${err}`);
        assert.ok(!calls.slice(steps[0]).some((c) => /^(mcp remove|plugin uninstall)/.test(c)), `snippet=${snippet}: ${calls.slice(steps[0]).join('\n')}`);
    }
});

// Review 2.1.6 m5: F1 and F2 at once on the command route - the replaced account file held the memory registration and the
// unreadable settings file hides the level, so no memory server runs here: the summary says so, never 'kept'.
test('seed update --installed-only (full copy route, local scope): a replaced account file with an unreadable settings.local.json says the memory registration is gone', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'update'], 'rule alfred-memory\nmcp navigation\nmcp documentation\nmcp memory\n', {
        tools: { claude: REPLACING_CLAUDE }, env: COPY_ROUTE,
        args: [['--scope', 'local', '--memory-level', 'project'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            if (i !== 0) return;
            fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), '{ "env": { "A": 1, } garbage');
            fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), '{"projects": { "x": [1,2, garbage');
            snippetCall(repo);
            backdate(repo);
        },
    });
    assert.doesNotMatch(outs[1], /memory=kept/, outs[1]);
    assert.match(outs[1], /memory=unregistered/, outs[1]);
});

// Review 2.1.6 re-verify N1: uninstall refused on a newer backup alone, so a user who put the account file back, as the
// CLI's own notice tells them to, was refused every time. It refuses only while the file holds none of the recorded
// registrations - once they are back it runs - and the refusal names the update as the other way out.
test('uninstall runs once the account file is put back after the CLI replaced it, and its refusal names the way out', POSIX_ONLY, () =>
{
    for (const restored of [true, false])
    {
        const { code, err, calls, result, steps } = seedRun(['install', 'uninstall'], DESKTOP_SEL, {
            tools: { claude: REPLACING_CLAUDE }, env: COPY_ROUTE, failOk: true,
            args: [['--scope', 'local'], []],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const file = path.join(path.dirname(repo), 'acct', '.claude.json');
                const whole = fs.readFileSync(file, 'utf8');
                fs.writeFileSync(file, '{"projects": { "x": [1,2, garbage');
                snippetCall(repo);
                backdate(repo);
                if (restored) fs.writeFileSync(file, whole);
                return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            },
            inspect: (repo) => fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')),
        });
        const removes = calls.slice(steps[0]).filter((c) => /^mcp remove /.test(c));
        if (restored)
        {
            assert.strictEqual(code, 0, `restored: ${err}`);
            assert.strictEqual(result, false, 'restored: the stamp stays');
            assert.strictEqual(removes.length, 4, removes.join('\n'));
        }
        else
        {
            assert.strictEqual(code, 1, err);
            assert.match(err, /\/alfred-code:update/, `the refusal names the update as a way out:\n${err}`);
        }
    }
});

// Review 2.1.6 re-verify N3: signal (c) read the user's own removal of every stack registration as a lost file and put
// them all back, the opt-in macos-desktop included. A file the CLI recovered or rewrote has no entry for the project;
// a hand removal leaves it. Only the first is taken as a loss, and the line says which it saw.
test('seed update --installed-only (full copy route, local scope): the user\'s removal of every registration stands; a file with no entry for the project is a loss', POSIX_ONLY, () =>
{
    const removal = f1Case((repo, file) =>
    {
        const account = JSON.parse(fs.readFileSync(file, 'utf8'));
        account.firstStartTime = '2026-01-01T00:00:00Z';
        for (const p of Object.values(account.projects)) p.mcpServers = {};
        fs.writeFileSync(file, JSON.stringify(account));
    });
    assert.doesNotMatch(removal.outs[1], F1_LINE, `a hand removal read as a lost file:\n${removal.outs[1]}`);
    assert.ok(!removal.steps[1].servers.includes('macos-desktop'), `the removed opt-in server came back: ${JSON.stringify(removal.steps[1])}`);
    const moved = f1Case((repo, file) =>
    {
        const account = JSON.parse(fs.readFileSync(file, 'utf8'));
        account.firstStartTime = '2026-01-01T00:00:00Z';
        account.projects = {};
        fs.writeFileSync(file, JSON.stringify(account));
    });
    const line = assertF1(moved.steps, moved.outs, 'no project entry');
    assert.match(line, /holds no entry for this project/, line);
    // A deleted account file holds no entry either.
    const gone = f1Case((repo, file) => fs.rmSync(file));
    assert.match(assertF1(gone.steps, gone.outs, 'no account file'), /does not exist/);
});

// Review 2.1.6 re-verify (aMoved / bMoved and its observation, the every-issue ruling): a project folder moved - or
// copied - to a new place keeps its settings and stamp, while the account's local entry stays under the OLD path.
// (a) The stack's registrations come back under the new path, macos-desktop included (no entry for this project: N3's
// signal). (b) The memory key the stack wrote names the OLD folder's database and read as `custom`; where the ledger shows
// the stack wrote that value it is this project's own project level, re-pointed to this folder's database (the file
// moved or was copied with the folder), in both the move and the copy - a path the user set stays `custom`.
const movedCase = ({ copy = false, userPath = false } = {}) => seedRun(['install', 'update'], `${DESKTOP_SEL}mcp alfred-memory\n`, {
    tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
    args: [['--scope', 'local', '--memory-level', 'project'], ['--installed-only', '--scope', 'local']],
    each: (repo, i) =>
    {
        if (i !== 0) return null;
        const acct = path.join(path.dirname(repo), 'acct', '.claude.json');
        const old = path.join(path.dirname(repo), 'old-place');
        const account = JSON.parse(fs.readFileSync(acct, 'utf8'));
        account.projects = { [old]: Object.values(account.projects)[0] };
        fs.writeFileSync(acct, JSON.stringify(account));
        const oldDb = path.join(old, '.alfred', '.alfred-memory', 'memory.db');
        const local = path.join(repo, '.claude', 'settings.local.json');
        const data = JSON.parse(fs.readFileSync(local, 'utf8'));
        data.env.ALFRED_CODE_MEMORY_DB = oldDb;
        fs.writeFileSync(local, JSON.stringify(data, null, 2));
        const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
        const { valueHash } = require('./install/stamp.js');
        if (!userPath) fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/(settings\.local\.json:ALFRED_CODE_MEMORY_DB=)[0-9a-f]{64}/, `$1${valueHash(oldDb)}`));
        fs.mkdirSync(path.join(repo, '.alfred', '.alfred-memory'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.alfred', '.alfred-memory', 'memory.db'), 'moved');
        if (copy) { fs.mkdirSync(path.dirname(oldDb), { recursive: true }); fs.writeFileSync(oldDb, 'the old folder'); }
        return { oldDb, before: fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length, db: fs.realpathSync(path.join(repo, '.alfred', '.alfred-memory', 'memory.db')) };
    },
    inspect: (repo) => desktopState(repo),
});

test('seed update --installed-only (full copy route, local scope): a moved or copied project folder gets its registrations back and its own project-level memory', POSIX_ONLY, () =>
{
    for (const copy of [false, true])
    {
        const { steps, outs, calls, result } = movedCase({ copy });
        const { before, db } = steps[0];
        const memoryAdds = calls.slice(before).filter((c) => c.startsWith('mcp add --scope local alfred-memory '));
        assert.ok(result.servers.includes('macos-desktop'), `copy=${copy}: macos-desktop not back: ${JSON.stringify(result)}\n${outs[1]}`);
        assert.match(outs[1], /holds no entry for this project/, `copy=${copy}`);
        assert.match(outs[1], /memory=project/, `copy=${copy}: ${outs[1]}`);
        assert.strictEqual(memoryAdds.length, 1, memoryAdds.join('\n'));
        assert.ok(memoryAdds[0].includes(`MCP_MEMORY_SQLITE_PATH=${db}`), `copy=${copy}: not re-pointed to this folder's database:\n${memoryAdds[0]}`);
        assert.match(outs[1], /another folder/, `copy=${copy}: the re-point is said`);
    }
    // A project-level path the user set by hand (the ledger does not record it) is theirs - kept byte for byte.
    const own = movedCase({ userPath: true });
    assert.match(own.outs[1], /memory=custom/, own.outs[1]);
    assert.ok(own.calls.slice(own.steps[0].before).some((c) => c.startsWith('mcp add --scope local alfred-memory ') && c.includes(`MCP_MEMORY_SQLITE_PATH=${own.steps[0].oldDb}`)));
});

// Review 2.1.6 (the user's ruling) and re-verify 2 R1: an install an earlier release broke - the stack's registration
// still in the account file, its ledger row lost when that release read a replaced file - is taken back only when every
// one of these holds: the stamp is from a release that could lose rows (no `installed-ms:` line - this release writes
// it, so a later configure drop is never undone); the CLI's corrupted backup is newer than the project's own set-up (its
// `initialised:` time - a backup from before, from another folder's corruption, arms nothing); the registration is the
// stack's own package (its identity) AND carries the stack's marks; and the stamp still records the server's skill.
const STACK_DESKTOP = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'], env: { ANONYMIZED_TELEMETRY: 'false' } };
const OTHER_DESKTOP = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'my-desktop-tool==1.0', 'my-desktop-tool'], env: { ANONYMIZED_TELEMETRY: 'false' } };
const DAY = 86400000;
const brokenByEarlierRelease = ({ backup = 'after', olderRelease = true, entry = STACK_DESKTOP, pending = false } = {}) => seedRun(['install', 'update'], DESKTOP_SEL, {
    tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
    args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
    each: (repo, i) =>
    {
        if (i === 0)
        {
            const acct = path.join(path.dirname(repo), 'acct');
            const account = accountOf(repo);
            Object.values(account.projects)[0].mcpServers['macos-desktop'] = entry;
            fs.writeFileSync(path.join(acct, '.claude.json'), JSON.stringify(account));
            const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
            let text = fs.readFileSync(stamp, 'utf8').replace(/^(managed-mcp: )(.*)$/m,
                (line, head, rows) => head + rows.split(',').filter((r) => !r.startsWith('local:macos-desktop=')).join(','));
            // Set up two days ago; a release before this one writes no installed-ms: line.
            // A stamp init never dated (`pending` - measured: a v2.1.5 install's, at local and user scope) is dated by its own
            // file's birth: the stamp is rewritten in place, so that is the first install.
            text = text.replace(/^initialised: .*$/m, pending ? 'initialised: pending' : `initialised: ${new Date(Date.now() - 2 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
            if (olderRelease) text = text.replace(/^installed-ms: .*\n/m, '');
            fs.writeFileSync(stamp, text);
            const at = { after: pending ? Date.now() : Date.now() - DAY, before: Date.now() - 3 * DAY }[backup];
            if (at) { fs.mkdirSync(path.join(acct, 'backups'), { recursive: true }); fs.writeFileSync(path.join(acct, 'backups', `.claude.json.corrupted.${at}`), 'garbage'); }
        }
        return { ...desktopState(repo), entry: accountOf(repo).projects && Object.values(accountOf(repo).projects)[0].mcpServers['macos-desktop'] };
    },
});
const NAMED = /mcp macos-desktop: .*the stack's own .*\/alfred-code:configure/;
test('seed update --installed-only (full copy route, local scope): a registration an earlier release left out of the ledger is taken back only on every sign together', POSIX_ONLY, () =>
{
    const { steps, outs } = brokenByEarlierRelease();
    assert.doesNotMatch(steps[0].ledger, /macos-desktop/, 'the fixture: the earlier run lost the row');
    assert.ok(steps[1].servers.includes('macos-desktop'), `${JSON.stringify(steps[1])}\n${outs[1]}`);
    assert.strictEqual(steps[1].respelled, false, `the skill or seat still names plugin tools:\n${outs[1]}`);
    assert.match(steps[1].ledger, /local:macos-desktop=/, `the ledger row is not back: ${steps[1].ledger}`);
    assert.match(outs[1], /taking back mcp macos-desktop/, outs[1]);
    const undated = brokenByEarlierRelease({ pending: true });
    assert.match(undated.outs[1], /taking back mcp macos-desktop/, `a pending stamp, dated by its own file's birth:\n${undated.outs[1]}`);
    assert.doesNotMatch(brokenByEarlierRelease({ pending: true, backup: 'before' }).outs[1], /taking back mcp macos-desktop/, 'a backup older than a pending stamp\'s file');
    // Each sign missing on its own: nothing adopted, the entry left exactly as it is.
    for (const [label, opts, named] of [['this release\'s stamp', { olderRelease: false }, true], ['a backup from before the set-up', { backup: 'before' }, true],
        ['no backup', { backup: 'none' }, true], ['another package with the marks', { entry: OTHER_DESKTOP }, false],
        // Re-verify 3 S1, tRmReadd: the user's own server with the stack's package and marks plus an env key of their own is
        // no exact stack shape - the lost row had exactly the release template's.
        ['the stack\'s package and marks plus an env key of the user\'s own (tRmReadd)', { entry: { ...STACK_DESKTOP, env: { ...STACK_DESKTOP.env, MACOS_MCP_SKIP_PERMISSION_CHECK: '1' } } }, false],
        ['the stack\'s package and marks plus a flag of the user\'s own', { entry: { ...STACK_DESKTOP, args: [...STACK_DESKTOP.args, '--verbose'] } }, false]])
    {
        const r = brokenByEarlierRelease(opts);
        assert.doesNotMatch(r.outs[1], /taking back mcp macos-desktop/, `${label}: taken back:\n${r.outs[1]}`);
        assert.doesNotMatch(r.steps[1].ledger, /macos-desktop/, `${label}: ledgered`);
        assert.deepStrictEqual(r.steps[1].entry, opts.entry || STACK_DESKTOP, `${label}: the entry was rewritten`);
        if (named) assert.match(r.outs[1], NAMED, `${label}: not named:\n${r.outs[1]}`);
        else assert.doesNotMatch(r.outs[1], NAMED, `${label}: another package named as the stack's own`);
    }
});

// Re-verify 2 R1, tSameStale: a configure drop in this release, a corruption episode from before, then the user's own
// MacOS-MCP under the name carrying the stack's flags - the next update never undoes the drop.
test('seed update --installed-only (full copy route, local scope): a configure drop stays dropped when the user registers their own server with the stack\'s flags', POSIX_ONLY, () =>
{
    const own = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--exclude-newer', '2026-09-01T00:00:00Z', '--from', 'macos-mcp==0.4.5', 'macos-mcp', 'serve', '--my-flag'], env: { ANONYMIZED_TELEMETRY: 'false', MY_OWN: '1' } };
    const { steps, outs } = seedRun(['install', 'update', 'update'], DESKTOP_SEL, {
        tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local', '--drop', 'mcp macos-desktop'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const acct = path.join(path.dirname(repo), 'acct');
            if (i === 0) { fs.mkdirSync(path.join(acct, 'backups'), { recursive: true }); fs.writeFileSync(path.join(acct, 'backups', `.claude.json.corrupted.${Date.now()}`), 'garbage'); }
            if (i === 1)
            {
                const account = accountOf(repo);
                Object.values(account.projects)[0].mcpServers['macos-desktop'] = own;
                fs.writeFileSync(path.join(acct, '.claude.json'), JSON.stringify(account));
            }
            return { ...desktopState(repo), entry: Object.values(accountOf(repo).projects)[0].mcpServers['macos-desktop'] };
        },
    });
    assert.doesNotMatch(outs[2], /taking back mcp macos-desktop/, outs[2]);
    assert.deepStrictEqual(steps[2].entry, own, `the user's server was rewritten:\n${outs[2]}`);
    assert.doesNotMatch(steps[2].ledger, /macos-desktop/);
});

// Re-verify 3 S1, tDropDown: a configure drop on this release, the user's own macos-desktop (their own cut-off and an env
// key), then one older-release run that rewrites the stamp without `installed-ms:` (a downgrade) and a CLI replacement of
// the account file - every sign of the take-back but the exact shape. The drop stays: the entry is theirs.
test('seed update --installed-only (full copy route, local scope): a downgrade run after a drop does not re-arm the take-back over the user\'s own server', POSIX_ONLY, () =>
{
    const own = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--exclude-newer', '2026-09-01T00:00:00Z', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'], env: { ANONYMIZED_TELEMETRY: 'false', MACOS_MCP_LOG_LEVEL: 'debug' } };
    const { steps, outs } = seedRun(['install', 'update', 'update'], DESKTOP_SEL, {
        tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local', '--drop', 'mcp macos-desktop'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            const acct = path.join(path.dirname(repo), 'acct');
            if (i === 1)
            {
                const account = accountOf(repo);
                Object.values(account.projects)[0].mcpServers['macos-desktop'] = own;
                fs.writeFileSync(path.join(acct, '.claude.json'), JSON.stringify(account));
                // The downgrade: an older release's stamp, no installed-ms: line; set up two days ago.
                const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
                fs.writeFileSync(stamp, fs.readFileSync(stamp, 'utf8').replace(/^installed-ms: .*\n/m, '')
                    .replace(/^initialised: .*$/m, `initialised: ${new Date(Date.now() - 2 * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z')}`));
                fs.mkdirSync(path.join(acct, 'backups'), { recursive: true });
                fs.writeFileSync(path.join(acct, 'backups', `.claude.json.corrupted.${Date.now() - DAY}`), 'garbage');
            }
            return { ...desktopState(repo), entry: Object.values(accountOf(repo).projects)[0].mcpServers['macos-desktop'] };
        },
    });
    assert.doesNotMatch(steps[1].ledger, /macos-desktop/, `the fixture: the drop removed the row\n${outs[1]}`);
    assert.doesNotMatch(outs[2], /taking back mcp macos-desktop/, outs[2]);
    assert.deepStrictEqual(steps[2].entry, own, `the user's server was rewritten:\n${outs[2]}`);
    assert.doesNotMatch(steps[2].ledger, /macos-desktop/);
});

// Review 2.1.6 re-verify N4 and the user's ruling: signal (b) compares in milliseconds. The source step's replacement
// lands in the second the last stamp was written, and one server is put back by hand, so (c) does not hold - (b) alone
// must take the ledger, or macos-desktop is dropped.
test('seed update --installed-only (full copy route, local scope): a replacement within the stamp\'s own second is caught by (b) alone', POSIX_ONLY, () =>
{
    const { steps, outs } = f1Case((repo, file) =>
    {
        fs.writeFileSync(file, '{"projects": { "x": [1,2, garbage');
        snippetCall(repo);
        const fresh = JSON.parse(fs.readFileSync(file, 'utf8'));
        fresh.projects = { [fs.realpathSync(repo)]: { mcpServers: { navigation: { command: 'stub', args: [] } } } };
        fs.writeFileSync(file, JSON.stringify(fresh));
    });
    const line = assertF1(steps, outs, '(b) alone');
    assert.match(line, /was replaced since the last run/, line);
});

// Review 2.1.6 B2: F1's first fix also took back any local registration of the stack's own SHAPE under a catalog name the
// ledger did not list - and the shape is the package name only, so a server the user added with the same upstream was
// adopted, rewritten to the stack's entry and ledgered (so uninstall would delete it), or removed as a dropped engine.
// That repair is gone: only what the ledger records at a scope is a pick there (X1); configure is the way back for an
// install an earlier release broke.
const ownServerCase = (sel, own) => seedRun(['install', 'update', 'update'], sel, {
    tools: { claude: RECORDING_CLAUDE },
    env: COPY_ROUTE,
    args: [['--scope', 'local'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
    each: (repo, i) =>
    {
        const file = path.join(path.dirname(repo), 'acct', '.claude.json');
        if (i === 0)
        {
            const account = accountOf(repo);
            Object.assign(Object.values(account.projects)[0].mcpServers, own);
            fs.writeFileSync(file, JSON.stringify(account));
            // With the take-back of an earlier release's loss live (a corrupted backup says the CLI once replaced the file):
            // a server of the user's own carries none of the stack's marks, so it still stays theirs.
            fs.mkdirSync(path.join(path.dirname(file), 'backups'), { recursive: true });
            fs.writeFileSync(path.join(path.dirname(file), 'backups', `.claude.json.corrupted.${Date.now() - 86400000}`), 'garbage');
            return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
        }
        const read = (p) => { try { return fs.readFileSync(path.join(repo, '.claude', p), 'utf8'); } catch { return ''; } };
        return { servers: Object.values(accountOf(repo).projects)[0].mcpServers, stamp: read('alfred-code.stamp'), skill: read('skills/desktop-automation/SKILL.md') };
    },
});

test('seed update --installed-only (full copy route, local scope): the user\'s own macos-mcp under macos-desktop is never adopted, rewritten or ledgered', POSIX_ONLY, () =>
{
    const own = { 'macos-desktop': { type: 'stdio', command: 'uvx', args: ['macos-mcp', 'serve', '--my-flag'], env: { MY_OWN: '1' } } };
    const { steps, calls, outs } = ownServerCase('rule markdown-docs\n', own);
    for (const i of [1, 2])
    {
        assert.deepStrictEqual(steps[i].servers['macos-desktop'], own['macos-desktop'], `update ${i} rewrote the user's server:\n${outs[i]}`);
        assert.doesNotMatch(stampLine(steps[i].stamp, 'managed-mcp'), /macos-desktop/, `update ${i} ledgered it`);
        assert.strictEqual(steps[i].skill, '', `update ${i} copied the desktop skill in as if picked:\n${outs[i]}`);
    }
    assert.ok(!calls.slice(steps[0]).some((c) => /^mcp (add|remove) .*macos-desktop/.test(c)), calls.slice(steps[0]).join('\n'));
});

// Re-verify 3 S4 (oNewPlain, oNewMarks, tBrowserOffNew): at local scope an engine the stamp keeps installed but left off
// is not registered, and an earlier registration of it is removed - but only the one the ledger records there at its hash.
// The user's own server under the name - plain, or with the stack's marks, even in its exact shape - is kept and named.
const ledgerOf = (repo) => stampLine(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'), 'managed-mcp');
const OWN_FIREFOX = {
    plain: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--browser', 'firefox', '--user-data-dir', '/home/me/ff'], env: {} },
    marks: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'firefox', '--user-data-dir', '${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox', '--output-dir', '${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox/output', '--no-webmcp', '--isolated'], env: {} },
    exact: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'firefox', '--user-data-dir', '${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox', '--output-dir', '${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox/output', '--no-webmcp'], env: {} },
};
test('seed update --installed-only (full copy route, local scope): an engine left off keeps the user\'s own registration under its name', POSIX_ONLY, () =>
{
    for (const [label, own] of Object.entries(OWN_FIREFOX))
    {
        const { steps, calls, outs } = seedRun(['install', 'update', 'update'], 'rule markdown-docs\nmcp browser\n', {
            tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
            args: [['--scope', 'local', '--browsers', 'chrome,firefox', '--browser-enabled', 'chrome'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
            each: (repo, i) =>
            {
                const file = path.join(path.dirname(repo), 'acct', '.claude.json');
                if (i === 0)
                {
                    const account = accountOf(repo);
                    Object.values(account.projects)[0].mcpServers['browser-firefox'] = own;
                    fs.writeFileSync(file, JSON.stringify(account));
                    return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
                }
                return { entry: Object.values(accountOf(repo).projects)[0].mcpServers['browser-firefox'], ledger: ledgerOf(repo) };
            },
        });
        for (const i of [1, 2])
        {
            assert.deepStrictEqual(steps[i].entry, own, `${label}: update ${i} removed or rewrote the user's server:\n${outs[i]}`);
            assert.doesNotMatch(steps[i].ledger, /browser-firefox/, `${label}: update ${i} ledgered it`);
            assert.match(outs[i], /mcp browser-firefox: .*claude mcp remove browser-firefox -s local/, `${label}: update ${i} did not name it:\n${outs[i]}`);
            assert.doesNotMatch(outs[i], /mcp removed: browser-firefox/, `${label}: update ${i}`);
        }
        assert.ok(!calls.slice(steps[0]).some((c) => /^mcp (add|remove) .*browser-firefox/.test(c)), `${label}:\n${calls.slice(steps[0]).join('\n')}`);
    }
});

// ... and the engine the stack itself registered, then left off, still goes: the ledger records it at its hash.
test('seed update --installed-only (full copy route, local scope): an engine switched off removes the registration the ledger records', POSIX_ONLY, () =>
{
    const { steps, calls, outs } = seedRun(['install', 'update'], 'rule markdown-docs\nmcp browser\n', {
        tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
        args: [['--scope', 'local', '--browsers', 'chrome,firefox', '--browser-enabled', 'chrome,firefox'], ['--installed-only', '--scope', 'local', '--browser-enabled', 'chrome']],
        each: (repo, i) => (i === 0 ? calls0(repo) : { servers: localServers(accountOf(repo)), ledger: ledgerOf(repo) }),
    });
    function calls0(repo) { return { n: fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length, ledger: ledgerOf(repo) }; }
    assert.match(steps[0].ledger, /local:browser-firefox=/, 'the fixture: the install ledgered firefox');
    assert.ok(calls.slice(steps[0].n).includes('mcp remove browser-firefox -s local'), `${calls.slice(steps[0].n).join('\n')}\n${outs[1]}`);
    assert.ok(!steps[1].servers.includes('browser-firefox'), outs[1]);
    assert.doesNotMatch(steps[1].ledger, /browser-firefox/);
});

// Re-verify 3 S7 (xOwnFresh): a FRESH local-scope install - no stamp, so no ledger - picking a server whose name the user
// already registered at local scope keeps theirs: it is not the release template's exact shape. Named once with its
// command, never re-registered, verified or ledgered.
test('seed install (full copy route, local scope): a fresh install keeps the user\'s own server under a picked name', POSIX_ONLY, () =>
{
    const own = { type: 'stdio', command: 'uvx', args: ['--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'], env: { MY_OWN: '1' } };
    const { steps, calls, outs } = seedRun(['install', 'update'], DESKTOP_SEL, {
        tools: { claude: RECORDING_CLAUDE }, env: COPY_ROUTE,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local']],
        prepare: (repo, work) =>
        {
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', '.claude.json'), JSON.stringify({ projects: { [fs.realpathSync(repo)]: { mcpServers: { 'macos-desktop': own } } } }));
        },
        each: (repo) => ({ entry: Object.values(accountOf(repo).projects)[0].mcpServers['macos-desktop'], ledger: desktopState(repo).ledger }),
    });
    for (const i of [0, 1])
    {
        assert.deepStrictEqual(steps[i].entry, own, `run ${i} rewrote the user's server:\n${outs[i]}`);
        assert.doesNotMatch(steps[i].ledger, /macos-desktop/, `run ${i} ledgered it`);
        // The install names it; the update's read-back takes no pick the ledger does not record (X1), so it is left unsaid.
        if (i === 0) assert.match(outs[i], /!! mcp macos-desktop: .*claude mcp remove macos-desktop -s local/, `run ${i} did not name it:\n${outs[i]}`);
        assert.doesNotMatch(outs[i], /mcp repaired: macos-desktop|shape drifted/, `run ${i}`);
    }
    assert.ok(!calls.some((c) => /^mcp (add|remove) .*macos-desktop/.test(c)), calls.join('\n'));
});

test('seed update --installed-only (full copy route, local scope): the user\'s own Playwright under browser-firefox is never taken as a kept engine', POSIX_ONLY, () =>
{
    const own = { 'browser-firefox': { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--browser', 'firefox', '--isolated'], env: { MY_PROFILE: 'work' } } };
    const { steps, calls, outs } = ownServerCase('rule markdown-docs\n', own);
    for (const i of [1, 2])
    {
        assert.deepStrictEqual(steps[i].servers['browser-firefox'], own['browser-firefox'], `update ${i} rewrote or removed the user's server:\n${outs[i]}`);
        assert.ok(!steps[i].servers['browser-chrome'], `update ${i} registered a browser the install never picked:\n${outs[i]}`);
        assert.doesNotMatch(stampLine(steps[i].stamp, 'managed-mcp'), /browser-/, `update ${i} ledgered it`);
        assert.strictEqual(stampLine(steps[i].stamp, 'browser-engines'), '', `update ${i}: browser-engines grew`);
    }
    assert.ok(!calls.slice(steps[0]).some((c) => /^mcp (add|remove) .*browser-/.test(c)), calls.slice(steps[0]).join('\n'));
});

// The same recovery on the plugin route (the temp-project matrix, 2.1.6): the run's first `plugin list --json` met the
// corrupt file and answered with the CLI's notice, so the read-back found no stack entry - it adopted the locked servers
// as 'absent here' and left macos-desktop out of that run's set. The recovery is met by a call whose answer is not read.
test('seed update --installed-only (plugin route): the call that meets a corrupt account file is not one the read-back reads', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory', 'macos-desktop']
        .map((n) => ({ id: `${n}@envoydev`, scope: 'project', version: '2.1.5', enabled: true })));
    // The first update adopts what the install's selection left out; the second is the settled read-back the third,
    // over the corrupt file, must equal.
    const { outs } = seedRun(['install', 'update', 'update', 'update'], 'rule markdown-docs\nskill desktop-automation\nmcp macos-desktop\n', {
        plugins: listing,
        tools: { claude: REPLACING_CLAUDE },
        env: { ALFRED_CODE_PLATFORM: 'darwin' },
        args: [['--scope', 'project'], ['--installed-only'], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 2) return null;
            fs.mkdirSync(path.join(path.dirname(repo), 'acct'), { recursive: true });
            fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), '{"projects": { "x": [1,2, garbage');
            return null;
        },
    });
    const count = (out) => (/mcps=(\d+)/.exec(out) || [])[1];
    const lines = (out) => out.split('\n').filter((l) => /installed-only: (adopting|required)|installed\/refreshed this run/.test(l)).map((l) => l.replace(/memory=.*$/, '')).sort();
    assert.deepStrictEqual(lines(outs[3]), lines(outs[2]), `the corrupt account file changed what the read-back found:\n${outs[3]}`);
    assert.strictEqual(count(outs[3]), count(outs[2]), outs[3]);
    assert.match(outs[3], /\.claude\.json could not be read/);
});

// Review 2.1.6 M2 (pre-existing): on the copy route a configure drop of a non-browser server (`--drop 'mcp <name>'`) took it
// out of the set but left its registration and ledger row, so the next update read it back as a pick and switched it on again
// with no line. The drop removes the stack's own registration at its registration scope - the account's local row, or
// .mcp.json at project scope and at user scope on the full copy route (C10) - and the ledger row and the approval go with it.
// A server of the user's own under the name is kept. This stub answers a project-scope add or remove in .mcp.json, as the CLI
// does, and every other scope as the account stub above.
const PROJECT_MCP_STUB = path.join(TMP, 'mcp-stub-project.js');
put(PROJECT_MCP_STUB, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [verb, ...rest] = process.argv.slice(3);
const at = rest.findIndex((w) => w === '-s' || w === '--scope');
if (at < 0 || rest[at + 1] !== 'project') { require(${JSON.stringify(MCP_STUB)}); return; }
const file = path.join(process.cwd(), '.mcp.json');
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
const servers = (data.mcpServers ||= {});
if (verb === 'remove')
{
    if (!servers[rest[0]]) { process.stderr.write('No MCP server named ' + rest[0] + ' found in .mcp.json\\n'); process.exit(1); }
    delete servers[rest[0]];
}
else if (verb === 'add')
{
    let name = null;
    const words = [];
    for (let i = 0; i < rest.length; i++)
    {
        if (name === null && ['--transport', '--scope', '-s', '--header', '-e', '--env'].includes(rest[i])) { i++; continue; }
        if (name === null) name = rest[i]; else words.push(rest[i]);
    }
    servers[name] = { command: 'stub', args: words };
}
else process.exit(1);
fs.writeFileSync(file, JSON.stringify(data, null, 2));
`);
const DROP_CLAUDE = RECORDING_CLAUDE.replace(MCP_STUB, PROJECT_MCP_STUB);
const dropState = (repo) =>
{
    const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return ''; } };
    const settingsJson = (() => { try { return JSON.parse(read('.claude/settings.json')); } catch { return {}; } })();
    return {
        local: (Object.values(accountOf(repo).projects || {})[0] || { mcpServers: {} }).mcpServers?.['macos-desktop'] || null,
        mcpjson: mcpjsonOf(repo)['macos-desktop'] || null,
        enabled: settingsJson.enabledMcpjsonServers || [],
        ledger: stampLine(read('.claude/alfred-code.stamp'), 'managed-mcp'),
        calls: read('../claude-calls.log').split('\n').filter(Boolean).length,
    };
};

test('M2 seed update --installed-only --drop (full copy route): a dropped non-browser server leaves its registration, the ledger and the approval, and the next update does not bring it back - local, project and user scope', POSIX_ONLY, () =>
{
    for (const scope of ['local', 'project', 'user'])
    {
        const { steps, outs, calls } = seedRun(['install', 'update', 'update'], DESKTOP_SEL, {
            tools: { claude: DROP_CLAUDE }, env: COPY_ROUTE,
            args: [['--scope', scope], ['--installed-only', '--scope', scope, '--drop', 'mcp macos-desktop'], ['--installed-only', '--scope', scope]],
            each: (repo) => dropState(repo),
        });
        const where = scope === 'local' ? 'local' : 'mcpjson';
        assert.ok(steps[0][where] && /macos-desktop/.test(steps[0].ledger), `${scope}: the install registered and ledgered it:\n${outs[0]}`);
        for (const i of [1, 2])
        {
            assert.strictEqual(steps[i][where], null, `${scope}, update ${i}: macos-desktop is still registered:\n${outs[i]}`);
            assert.doesNotMatch(steps[i].ledger, /macos-desktop/, `${scope}, update ${i}: still in the ledger`);
            assert.ok(!steps[i].enabled.includes('macos-desktop'), `${scope}, update ${i}: still approved`);
        }
        assert.match(outs[1], /mcp removed: macos-desktop/, outs[1]);
        assert.ok(!calls.slice(steps[1].calls).some((c) => /^mcp add .*macos-desktop/.test(c)), `${scope}: the next update registered it again`);
        assert.doesNotMatch(outs[2], /(adopting|required|mcp \[\w+\]:).*macos-desktop/, `${scope}: the next update read it back:\n${outs[2]}`);
        assert.strictEqual((/mcps=(\d+)/.exec(outs[2]) || [])[1], (/mcps=(\d+)/.exec(outs[1]) || [])[1], `${scope}: the server count moved`);
    }
});

test('M2 seed update --installed-only --drop (full copy route): a drop over the user\'s own server under the name removes nothing - local and project scope', POSIX_ONLY, () =>
{
    const own = { type: 'stdio', command: 'uvx', args: ['macos-mcp', 'serve', '--my-flag'], env: { MY_OWN: '1' } };
    for (const scope of ['local', 'project'])
    {
        const { steps, outs, calls } = seedRun(['install', 'update'], 'rule markdown-docs\n', {
            tools: { claude: DROP_CLAUDE }, env: COPY_ROUTE,
            args: [['--scope', scope], ['--installed-only', '--scope', scope, '--drop', 'mcp macos-desktop']],
            each: (repo, i) =>
            {
                if (i === 0 && scope === 'local')
                {
                    const account = accountOf(repo);
                    Object.values(account.projects)[0].mcpServers['macos-desktop'] = own;
                    fs.writeFileSync(path.join(path.dirname(repo), 'acct', '.claude.json'), JSON.stringify(account));
                }
                if (i === 0 && scope === 'project')
                {
                    const data = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
                    data.mcpServers['macos-desktop'] = own;
                    fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(data, null, 2));
                }
                return dropState(repo);
            },
        });
        const where = scope === 'local' ? 'local' : 'mcpjson';
        assert.deepStrictEqual(steps[1][where], own, `${scope}: the user's server was removed or rewritten:\n${outs[1]}`);
        assert.ok(!calls.some((c) => /^mcp remove macos-desktop/.test(c)), `${scope}: ${calls.join('\n')}`);
    }
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

// M4: the kept-data line read ALFRED_CODE_DATA_PATH after the settings pass had removed it, so a custom root was
// named as the default .alfred/ - the folder the user would then look in is the wrong one.
test('uninstall: the kept data root is the one in effect - a custom root named, never the default', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', { args: [['--scope', 'project', '--data-path', '.data'], []] });
    assert.match(outs[1], /kept, yours or your data: .* - \.data\/, or a 2\.0\.0/, outs[1]);
});
