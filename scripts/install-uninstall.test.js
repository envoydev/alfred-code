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

test('removePlugins: the stack\'s rows at project or local scope are uninstalled, dependents first; user-scope rows are printed, never run (R10, ruling)', () =>
{
    const rows = [
        { name: 'alfred-code', marketplace: 'envoydev', scope: 'project', version: '2.0.0', enabled: true },
        { name: 'serena', marketplace: 'envoydev', scope: 'project', version: '2.0.0', enabled: true },
        { name: 'playwright-chrome', marketplace: 'envoydev', scope: 'user', version: '2.0.0', enabled: true },
        { name: 'claude-md-management', marketplace: 'claude-plugins-official', scope: 'project', version: '1.0.0', enabled: true },
    ];
    const calls = [];
    // The CLI refuses a dependency first while its dependent is installed.
    const cli = (argv) => { calls.push(argv.join(' ')); return !(argv[2] === 'serena@envoydev' && !calls.some((c) => c.startsWith('plugin uninstall alfred-code@'))); };
    const logs = [];
    uninstall.removePlugins({ rows, market: 'envoydev', scope: 'project', thirdParty: ['claude-md-management@claude-plugins-official'], cli, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'));
    assert.ok(calls.includes('plugin uninstall serena@envoydev --scope project -y'));
    assert.ok(!calls.some((c) => /playwright-chrome|claude-md-management/.test(c)), calls.join('\n'));
    const text = logs.join('\n');
    assert.doesNotMatch(text, /NOTE/, 'a dependency refused first is retried once its dependent is gone');
    assert.match(text, /playwright-chrome@envoydev is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall playwright-chrome@envoydev --scope user/);
    assert.match(text, /claude-md-management@claude-plugins-official .*not removed.*claude plugin uninstall claude-md-management@claude-plugins-official --scope project/);

    const userCalls = [];
    uninstall.removePlugins({ rows: rows.map((r) => ({ ...r, scope: 'user' })), market: 'envoydev', scope: 'user', cli: (a) => { userCalls.push(a); return true; }, log: () => {} });
    assert.deepStrictEqual(userCalls, [], 'a user-scope install is never uninstalled from here');
});

// End to end through the Node seed and a recording `claude`: install on the default plugin route, the
// user adds their own hook, server and key, then uninstall.
const LISTING = JSON.stringify([
    { id: 'alfred-code@envoydev', scope: 'project', version: '2.0.0', enabled: true },
    { id: 'serena@envoydev', scope: 'project', version: '2.0.0', enabled: true },
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
    assert.ok(calls.includes('plugin uninstall serena@envoydev --scope project -y'), calls.join('\n'));
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
