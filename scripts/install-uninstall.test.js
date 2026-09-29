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
        { name: 'csharp-lsp', marketplace: 'claude-plugins-official', scope: 'project', version: '1.0.0', enabled: true },
    ];
    const calls = [];
    // The CLI refuses a dependency first while its dependent is installed.
    const cli = (argv) => { calls.push(argv.join(' ')); return !(argv[2] === 'navigation@envoydev' && !calls.some((c) => c.startsWith('plugin uninstall alfred-code@'))); };
    const logs = [];
    uninstall.removePlugins({ rows, market: 'envoydev', scope: 'project', thirdParty: ['csharp-lsp@claude-plugins-official'], cli, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'));
    assert.ok(calls.includes('plugin uninstall navigation@envoydev --scope project -y'));
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
    assert.deepStrictEqual(steps[0], ['documentation', 'memory', 'navigation'], outs[0]);
    for (const name of ['navigation', 'documentation', 'memory']) assert.ok(calls.includes(`mcp remove ${name} -s local`), calls.join('\n'));
    assert.deepStrictEqual(result, ['mine'], outs[1]);
    assert.match(outs[1], /mcp removed: navigation \(local scope\)/);
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
