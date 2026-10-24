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

// --instructions-at root: the seed sits at the project root, and an unedited one goes like the .claude/ one - on the
// user's 'remove' answer (2026-10-23); an edited one, a root AGENTS.md beside a .claude/ seed, and any other root file stay.
test('removeManagedFiles: an unedited root seed goes on remove, an edited one stays, and the .claude/ seed is the row while it is there', () =>
{
    const project = path.join(TMP, `f-${seq++}`);
    const claudeDir = path.join(project, '.claude');
    put(path.join(project, 'AGENTS.md'), '# seed\n');
    put(path.join(project, 'README.md'), '# seed\n');
    const files = { 'AGENTS.md': hashItem(path.join(project, 'AGENTS.md')), 'README.md': hashItem(path.join(project, 'README.md')) };
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files, seed: 'remove', log: (m) => logs.push(m) });
    assert.ok(!fs.existsSync(path.join(project, 'AGENTS.md')), `the unedited root seed goes: ${logs.join(' | ')}`);
    assert.ok(fs.existsSync(path.join(project, 'README.md')), 'no other root file is ever removed');

    put(path.join(project, 'AGENTS.md'), '# seed, filled in\n');
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files: { 'AGENTS.md': files['AGENTS.md'] }, seed: 'remove', log: () => {} });
    assert.strictEqual(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8'), '# seed, filled in\n', 'an edited root seed is the project\'s');

    put(path.join(project, 'AGENTS.md'), '# seed\n');
    put(path.join(claudeDir, 'AGENTS.md'), '# the .claude seed, edited\n');
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files: { 'AGENTS.md': files['AGENTS.md'] }, seed: 'remove', log: () => {} });
    assert.ok(fs.existsSync(path.join(project, 'AGENTS.md')) && fs.existsSync(path.join(claudeDir, 'AGENTS.md')), 'with a .claude/AGENTS.md there, the root one is not the row');
});

// The user's ask of 2026-10-23: the seed is the one file an uninstall asks about. With no answer it stays, and the line
// names the flag; a 'keep' answer says so; seedPlan is the read-only preview /alfred-code:uninstall asks from.
test('removeManagedFiles: an unedited seed stays without a remove answer, said with the flag; seedPlan previews it', () =>
{
    const project = path.join(TMP, `f-${seq++}`);
    const claudeDir = path.join(project, '.claude');
    const seed = path.join(claudeDir, 'AGENTS.md');
    put(seed, '# seed\n');
    const files = { 'AGENTS.md': hashItem(seed) };
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files }), [{ rel: '.claude/AGENTS.md', state: 'unedited' }]);
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files, log: (m) => logs.push(m) });
    assert.ok(fs.existsSync(seed), 'no answer: the seed stays');
    assert.match(logs.join('\n'), /\.claude\/AGENTS\.md: kept - .*--instructions-seed remove/);
    const kept = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files, seed: 'keep', log: (m) => kept.push(m) });
    assert.ok(fs.existsSync(seed));
    assert.match(kept.join('\n'), /\.claude\/AGENTS\.md: kept on your answer/);

    fs.writeFileSync(seed, '# seed, filled in\n');
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files }), [{ rel: '.claude/AGENTS.md', state: 'edited' }]);
    fs.rmSync(seed);
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files }), [], 'no file at the row');
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files: {} }), [], 'no row');
    put(path.join(project, 'CLAUDE.md'), '# seed\n');
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files: { 'AGENTS.md': hashItem(path.join(project, 'CLAUDE.md')) }, instructionsKind: 'claude' }),
        [{ rel: 'CLAUDE.md', state: 'unedited' }], 'a root seed under the CLAUDE.md answer');
});

// Review 2026-10-23: a 2.1.6 install recorded its seed under a `CLAUDE.md` row (.claude/CLAUDE.md). It is the
// instruction file all the same: previewed, and removed only on the remove answer - one reading for both.
test('removeManagedFiles: a 2.1.6 seed under its CLAUDE.md row is previewed and asked about like the AGENTS.md one', () =>
{
    const project = path.join(TMP, `f-${seq++}`);
    const claudeDir = path.join(project, '.claude');
    const seed = path.join(claudeDir, 'CLAUDE.md');
    put(seed, '# seed\n');
    const files = { 'CLAUDE.md': hashItem(seed) };
    assert.deepStrictEqual(uninstall.seedPlan({ projectRoot: project, files }), [{ rel: '.claude/CLAUDE.md', state: 'unedited' }]);
    const logs = [];
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files, log: (m) => logs.push(m) });
    assert.ok(fs.existsSync(seed), `no answer: the 2.1.6 seed stays: ${logs.join(' | ')}`);
    assert.match(logs.join('\n'), /\.claude\/CLAUDE\.md: kept - .*--instructions-seed remove/);
    uninstall.removeManagedFiles({ claudeDir, skillsDir: path.join(claudeDir, 'skills'), files, seed: 'remove', log: () => {} });
    assert.ok(!fs.existsSync(seed), 'remove: it goes');
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
        { name: 'chrome-control', marketplace: 'envoydev', scope: 'user', version: '2.0.0', enabled: true },
        { name: 'csharp-lsp', marketplace: 'claude-plugins-official', scope: 'project', version: '1.0.0', enabled: true },
    ];
    const calls = [];
    // The CLI refuses a dependency first while its dependent is installed.
    const cli = (argv) => { calls.push(argv.join(' ')); return !(argv[2] === 'alfred-navigation@envoydev' && !calls.some((c) => c.startsWith('plugin uninstall alfred-code@'))); };
    const logs = [];
    uninstall.removePlugins({ rows, market: 'envoydev', scope: 'project', thirdParty: ['csharp-lsp@claude-plugins-official'], cli, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.ok(calls.includes('plugin uninstall alfred-code@envoydev --scope project -y'));
    assert.ok(calls.includes('plugin uninstall alfred-navigation@envoydev --scope project -y'));
    assert.ok(!calls.some((c) => /chrome-control|csharp-lsp/.test(c)), calls.join('\n'));
    const text = logs.join('\n');
    assert.doesNotMatch(text, /NOTE/, 'a dependency refused first is retried once its dependent is gone');
    assert.match(text, /chrome-control@envoydev is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall chrome-control@envoydev --scope user/);
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
        args: [[], ['--instructions-seed', 'remove']],
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

// The preview and the answer through the real installer: `uninstall.js seed` names the unedited seed, and an uninstall
// given no answer keeps it while everything else goes (the user's ask of 2026-10-23).
test('uninstall: the seed preview names the unedited seed, and with no answer the seed alone stays', POSIX_ONLY, () =>
{
    const script = path.join(__dirname, 'install', 'uninstall.js');
    const { result, outs, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        plugins: LISTING,
        each: (repo, i) => (i === 0 ? execFileSync(process.execPath, [script, 'seed', repo], { encoding: 'utf8' }) : null),
        inspect: (repo) => ({
            claude: fs.existsSync(path.join(repo, '.claude')) ? fs.readdirSync(path.join(repo, '.claude')).sort() : [],
            after: execFileSync(process.execPath, [script, 'seed', repo], { encoding: 'utf8' }),
        }),
    });
    assert.strictEqual(steps[0], 'instructions-seed: .claude/AGENTS.md unedited\n');
    assert.ok(result.claude.includes('AGENTS.md'), `the seed stays: ${result.claude}`);
    assert.ok(!result.claude.includes('alfred-code.stamp'), 'the rest of the uninstall ran');
    assert.match(outs[1], /\.claude\/AGENTS\.md: kept - .*--instructions-seed remove/);
    assert.strictEqual(result.after, 'instructions-seed: none\n', 'no stamp left: nothing to preview');
});

// A project the stack never touched before: nothing already there is adopted (no stamp = nothing
// managed yet), so the user's own deny entry and attribution key survive the round trip even at the
// value the stack would have written; with nothing else of theirs, every stack file goes.
test('uninstall: what the project held before the first install is never the stack\'s, even at the stack\'s own value (R10)', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        plugins: LISTING,
        args: [[], ['--instructions-seed', 'remove']],
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

// AN EARLIER RELEASE'S REGISTRATIONS. Up to 2.10.0 the MCP copy route registered the stack's servers at local and user
// scope in the ACCOUNT file and recorded each in the stamp's `managed-mcp:` ledger (`<scope>:<name>=<hash>`). No server
// ships since 2.10.1, but an install that never ran the update since still holds them: uninstall removes a local one the
// ledger records at its hash, keeps one changed since and the user's own, and prints a user-scope one's remove command.
// The stub below keeps `claude mcp remove` in the account file the way the CLI does (local: the project's own row, user:
// the top level).
const MCP_STUB = path.join(TMP, 'mcp-stub.js');
put(MCP_STUB, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
const [verb, ...rest] = process.argv.slice(3);
const holder = (scope) => (scope === 'user' ? data : ((data.projects ||= {})[process.cwd()] ||= {}));
if (verb === 'remove')
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
const accountFileOf = (repo) => path.join(path.dirname(repo), 'acct', '.claude.json');
const accountOf = (repo) => { try { return JSON.parse(fs.readFileSync(accountFileOf(repo), 'utf8')); } catch { return {}; } };
const localServers = (account) => Object.values(account.projects || {}).map((p) => Object.keys(p.mcpServers || {})).flat().sort();
const { entryHash } = require('./install/stamp.js');
const SERVER = (name) => ({ type: 'stdio', command: 'node', args: ['-e', `/* ${name} */`] });
// Lays an earlier release's registrations over the install the seed just made: `ledgered` the stack wrote (in the account
// file and the ledger, `changed` edited since), `own` the user's (the account file alone).
function olderRegistrations(repo, { scope = 'local', ledgered = [], changed = [], own = [] })
{
    const account = accountOf(repo);
    const holder = scope === 'user' ? account : ((account.projects ||= {})[fs.realpathSync(repo)] ||= {});
    const servers = (holder.mcpServers ||= {});
    const rows = [];
    for (const name of [...ledgered, ...changed])
    {
        servers[name] = SERVER(name);
        rows.push(`${scope}:${name}=${entryHash(SERVER(name))}`);
        if (changed.includes(name)) servers[name] = { ...SERVER(name), args: ['mine.js'] };
    }
    for (const name of own) servers[name] = { command: 'node', args: [`${name}.js`] };
    fs.mkdirSync(path.dirname(accountFileOf(repo)), { recursive: true });
    fs.writeFileSync(accountFileOf(repo), JSON.stringify(account, null, 2));
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    fs.writeFileSync(stampFile, fs.readFileSync(stampFile, 'utf8').replace(/^managed-mcp:.*$/m, `managed-mcp: ${rows.join(',')}`));
}

test('uninstall removes an earlier release\'s local-scope registrations the ledger records, and keeps one changed since and the user\'s own', POSIX_ONLY, () =>
{
    const { calls, result, outs, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        tools: { claude: RECORDING_CLAUDE },
        args: [['--scope', 'local'], []],
        each: (repo, i) =>
        {
            if (i === 0) olderRegistrations(repo, { ledgered: ['alfred-navigation', 'alfred-memory'], changed: ['alfred-documentation'], own: ['mine'] });
            return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
        },
        inspect: (repo) => ({ servers: localServers(accountOf(repo)), stamp: fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')) }),
    });
    const removes = calls.slice(steps[0]).filter((c) => /^mcp remove /.test(c)).sort();
    assert.deepStrictEqual(removes, ['mcp remove alfred-memory -s local', 'mcp remove alfred-navigation -s local'], outs[1]);
    assert.deepStrictEqual(result.servers, ['alfred-documentation', 'mine'], outs[1]);
    assert.match(outs[1], /mcp removed: alfred-navigation \(local scope\)/);
    assert.match(outs[1], /mcp alfred-documentation: kept - the local-scope registration changed since the stack registered it/, outs[1]);
    assert.strictEqual(result.stamp, false, outs[1]);
});

test('uninstall prints an earlier release\'s user-scope registrations\' remove commands and never runs them', POSIX_ONLY, () =>
{
    const { calls, result, outs, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        tools: { claude: RECORDING_CLAUDE },
        args: [['--scope', 'user'], []],
        each: (repo, i) =>
        {
            if (i === 0) olderRegistrations(repo, { scope: 'user', ledgered: ['chrome-control'] });
            return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
        },
        inspect: (repo) => Object.keys(accountOf(repo).mcpServers || {}).sort(),
    });
    assert.deepStrictEqual(calls.slice(steps[0]).filter((c) => c.startsWith('mcp remove')), [], calls.join('\n'));
    assert.deepStrictEqual(result, ['chrome-control'], outs[1]);
    assert.match(outs[1], /chrome-control is registered at user scope.*claude mcp remove chrome-control -s user/);
});

// The CLI replaces an account file it cannot parse at its first call, keeping the old one as
// `backups/.claude.json.corrupted.<ms>` (measured on 2.1.284). This stub does the same - the call that meets it prints the
// CLI's notice and none of its own answer - and otherwise answers as the recording stub.
const REPLACING_STUB = path.join(TMP, 'replacing-stub.js');
put(REPLACING_STUB, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
if (['plugin', 'mcp'].includes(process.argv[2]))
{
    try { JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err)
    {
        if (err.code !== 'ENOENT')
        {
            const dir = path.join(path.dirname(file), 'backups');
            fs.mkdirSync(dir, { recursive: true });
            fs.renameSync(file, path.join(dir, '.claude.json.corrupted.' + Date.now()));
            fs.writeFileSync(file, '{}');
            process.stderr.write('Claude configuration file at ' + file + ' is corrupted\\nThe corrupted file has already been backed up.\\n');
            process.exit(1);
        }
    }
}
`);
const REPLACING_CLAUDE = [`printf '%s\\n' "$*" >> "$CLAUDE_STUB_LOG"`, `"${process.execPath}" "${REPLACING_STUB}" "$1" || exit 1`,
    ...RECORDING_CLAUDE.split('\n').slice(1)].join('\n');
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

// Review 2.1.6 m3 and re-verify N1: an account file the CLI replaced moved the recorded registrations into its backup, so
// removing nothing and deleting the stamp would leave them with no record. Uninstall refuses before any change, naming the
// backup and the update as the way out - the file unreadable at its start, or replaced since the stamp by a call before it
// - and runs once a whole copy is put back.
test('uninstall over a replaced account file refuses before any change and names the backup; a copy put back lets it run', POSIX_ONLY, () =>
{
    for (const [label, snippet, restored] of [['unreadable at its start', false, false], ['replaced by an earlier call', true, false], ['put back', true, true]])
    {
        const { code, err, calls, result, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
            tools: { claude: REPLACING_CLAUDE }, failOk: true,
            args: [['--scope', 'local'], []],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                olderRegistrations(repo, { ledgered: ['alfred-navigation', 'alfred-memory'] });
                const whole = fs.readFileSync(accountFileOf(repo), 'utf8');
                fs.writeFileSync(accountFileOf(repo), '{"projects": { "x": [1,2, garbage');
                if (snippet) { snippetCall(repo); backdate(repo); }
                if (restored) fs.writeFileSync(accountFileOf(repo), whole);
                return fs.readFileSync(path.join(path.dirname(repo), 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length;
            },
            inspect: (repo) => fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')),
        });
        const after = calls.slice(steps[0]);
        if (restored)
        {
            assert.strictEqual(code, 0, `${label}: ${err}`);
            assert.strictEqual(after.filter((c) => /^mcp remove /.test(c)).length, 2, after.join('\n'));
            assert.strictEqual(result, false, `${label}: the stamp stays`);
            continue;
        }
        assert.strictEqual(code, 1, `${label}: ${err}`);
        assert.strictEqual(result, true, `${label}: the stamp was removed`);
        assert.match(err, /backups\/\.claude\.json\.corrupted\.\d+/, `${label}: the refusal names the backup:\n${err}`);
        assert.match(err, /\/alfred-code:update/, `${label}: the refusal names the update as a way out:\n${err}`);
        // 2.10.1: no update registers a server, so the way out is the update forgetting what the file no longer holds.
        assert.doesNotMatch(err, /registers them again/, `${label}: ${err}`);
        assert.match(err, /\/alfred-code:update, which drops the record of the registrations it no longer holds/, `${label}: ${err}`);
        assert.ok(!after.some((c) => /^(mcp remove|plugin uninstall)/.test(c)), `${label}: ${after.join('\n')}`);
    }
});

// M4: the kept-data line read ALFRED_CODE_DATA_PATH after the settings pass had removed it, so a custom root was
// named as the default .alfred/ - the folder the user would then look in is the wrong one.
test('uninstall: the kept data root is the one in effect - a custom root named, never the default', POSIX_ONLY, () =>
{
    const { outs } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', { args: [['--scope', 'project', '--data-path', '.data'], []] });
    assert.match(outs[1], /kept, yours or your data: .*the data root \.data\/ - /, outs[1]);
    assert.doesNotMatch(outs[1], /navigation index|browser profiles|memory database/, 'the kept line names no server data');
});

// The stack switched Claude's own memory off for its memory server until 2.10.1 (init's import). An uninstall over an
// install that never updated past it takes that switch-off back - the run's own settings file only - and one set since
// is the user's: kept, and said.
test('uninstall lifts the memory switch-off a pre-2.10.1 stack wrote, and keeps one set after it', POSIX_ONLY, () =>
{
    for (const [version, after] of [['2.10.0', undefined], ['2.10.1', false]])
    {
        const { outs, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
            args: [['--scope', 'project'], []],
            each: (repo, i) =>
            {
                const settings = path.join(repo, '.claude', 'settings.json');
                if (i === 0)
                {
                    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
                    fs.writeFileSync(stampFile, fs.readFileSync(stampFile, 'utf8').replace(/^version: .*$/m, `version: ${version}`));
                    const data = JSON.parse(fs.readFileSync(settings, 'utf8'));
                    fs.writeFileSync(settings, JSON.stringify({ ...data, autoMemoryEnabled: false, mine: 1 }, null, 2));
                }
                return fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : null;
            },
        });
        assert.strictEqual(steps[1].autoMemoryEnabled, after, `${version}\n${outs[1]}`);
        assert.strictEqual(steps[1].mine, 1, `${version}: the user's own key went`);
        if (after === undefined) assert.match(outs[1], /settings\.json: autoMemoryEnabled: false removed - /, outs[1]);
        else assert.match(outs[1], /autoMemoryEnabled: false stays in settings\.json - yours/, outs[1]);
    }
});

// Custom memory (spec P2) wrote the switch-off ledgered, so uninstall takes it back and names nothing as the user's.
test('uninstall takes a ledgered switch-off back and names none as yours', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'uninstall'], 'rule markdown-docs\n', {
        args: [['--scope', 'project', '--memory', 'custom'], []],
        each: (repo, i) =>
        {
            const settings = path.join(repo, '.claude', 'settings.json');
            const data = fs.existsSync(settings) ? JSON.parse(fs.readFileSync(settings, 'utf8')) : null;
            if (i === 0) fs.writeFileSync(settings, JSON.stringify({ ...data, mine: 1 }, null, 2));
            return data;
        },
    });
    assert.strictEqual(steps[0].autoMemoryEnabled, false, outs[0]);
    assert.match(outs[0], /settings\.json: autoMemoryEnabled: false written - /, outs[0]);
    assert.strictEqual(steps[1].autoMemoryEnabled, undefined, outs[1]);
    assert.doesNotMatch(outs[1], /autoMemoryEnabled: false stays/, outs[1]);
    assert.match(outs[1], /attribution \/ worktree \/ auto-compact \/ memory keys removed/, outs[1]);
});

// Review Focus 5: a settings file the run cannot read was not written, so its ledger row stands as recorded.
test('an update over an unreadable settings file keeps the switch-off\'s ledger row', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], 'rule markdown-docs\n', {
        args: [['--scope', 'project', '--memory', 'custom'], ['--installed-only', '--scope', 'project'], ['--installed-only', '--scope', 'project']],
        each: (repo, i) =>
        {
            const settings = path.join(repo, '.claude', 'settings.json');
            const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
            if (i === 0) { const text = fs.readFileSync(settings, 'utf8'); fs.writeFileSync(settings, '{ not json'); fs.writeFileSync(`${settings}.good`, text); }
            if (i === 1) fs.renameSync(`${settings}.good`, settings);
            return { row: /^managed-settings: .*settings\.json:autoMemoryEnabled=/m.test(stamp), off: i === 2 ? JSON.parse(fs.readFileSync(settings, 'utf8')).autoMemoryEnabled : null };
        },
    });
    assert.deepStrictEqual(steps.map((s) => s.row), [true, true, true], outs.join('\n---\n'));
    assert.strictEqual(steps[2].off, false, 'the restored file still holds the stack\'s switch-off');
});

// Final review I1, end to end: a local-scope custom install moved to project scope keeps the choice and its switch-off
// in settings.local.json; the committed settings.json never switches the team's memory off.
test('a local custom install moved to project scope keeps memory off in settings.local.json alone', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], 'rule markdown-docs\n', {
        args: [['--scope', 'local', '--memory', 'custom'], ['--installed-only', '--scope', 'project'], ['--installed-only', '--scope', 'project']],
        each: (repo) =>
        {
            const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude', n), 'utf8')); } catch { return null; } };
            return { shared: read('settings.json'), local: read('settings.local.json'), stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8') };
        },
    });
    for (const i of [1, 2])
    {
        assert.ok(!steps[i].shared || !Object.hasOwn(steps[i].shared, 'autoMemoryEnabled'), `step ${i}: ${JSON.stringify(steps[i].shared)}\n${outs[i]}`);
        assert.strictEqual(steps[i].local && steps[i].local.autoMemoryEnabled, false, `step ${i}: ${JSON.stringify(steps[i].local)}\n${outs[i]}`);
        assert.strictEqual(steps[i].local.env.ALFRED_CODE_MEMORY, 'custom');
        assert.match(steps[i].stamp, /settings\.local\.json:autoMemoryEnabled=/, steps[i].stamp);
    }
    assert.ok(!/autoMemoryEnabled/.test(outs[2]), `the second update said: ${outs[2]}`);
});
