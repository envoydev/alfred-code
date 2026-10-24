'use strict';
// THE UPDATE OVER AN OLDER INSTALL - 2.10.1 ships no MCP server (the user's ruling of 2026-10-24, spec N4), so the first
// update past it takes out what an earlier release left: the server plugins at the scopes the stack put them, a copy-route
// registration of the stack's own shape (the user's own kept), the deniedMcpServers rows it wrote, Claude's own memory switch-off
// and the server keys - and says ONCE how to add each server back (stack/mcp/original-mcps.json) and where its data stayed.
// Each case installs from this tree, plants what a 2.10.0 install held, then updates; a re-run changes nothing and says nothing.
const test = require('node:test');

const assert = require('node:assert');

const fs = require('node:fs');

const path = require('node:path');

const mcp = require('./install/mcp.js');

const { entryHash } = require('./install/stamp.js');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SHIPPED = require('../stack/mcp/shipped-mcps.json');

const RECORD = require('../stack/mcp/original-mcps.json').mcpServers;

const SELECTION = 'skill markdown-style\nrule markdown-docs\n';

const jsonAt = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const settingsOf = (repo, name = 'settings.json') => jsonAt(path.join(repo, '.claude', name)) || {};
const putJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };
const editSettings = (repo, name, edit) => { const file = path.join(repo, '.claude', name); const data = jsonAt(file) || {}; edit(data); putJson(file, data); };

// A row exactly as 2.10.0's copy route registered it, from the record of how it shipped (stack/mcp/shipped-mcps.json).
const TOKENS = { SERENA_HOME: '.alfred/serena/home', ROOT_BOOT: SHIPPED.rootBoot, UV_PYTHON: '3.13', UV_EXCLUDE_FLAG: '--exclude-newer',
    UV_EXCLUDE_NEWER: '2026-10-20T23:59:59Z', SERENA_PIN: '@2.1.0', SERENA_CONTEXT: '.claude/navigation-context.yml', SERENA_PROJECT_FLAG: '--project-from-cwd',
    SERENA_PROJECT_DIR: '', MEMORY_BACKEND: 'sqlite_vec', MEMORY_DB_PATH: '~/.alfred-memory/memory.db', MEMORY_PIN: '==12.1.1', PW_PIN: '@0.0.83' };
const shippedRow = (name) =>
{
    const engine = (/^(chrome|msedge|firefox|webkit)-control$/.exec(name) || [])[1];
    const args = engine ? mcp.pwArgsFor(SHIPPED.copy.browser.args, engine) : SHIPPED.copy[name].args;
    const tokens = engine ? { ...TOKENS, [`BROWSER_DIR_${engine.toUpperCase()}`]: `.alfred/${engine}-control` } : TOKENS;
    return mcp.wantFor(mcp.expectShape({ name, args, remotes: SHIPPED.remotes, tokens }));
};

// The plugin listing the recording CLI answers with - a project or local row names this project by its real path.
const listing = (work, repo, rows) => fs.writeFileSync(path.join(work, 'plugins.json'), JSON.stringify(rows.map(([id, scope]) =>
    ({ id, version: '2.10.0', scope, enabled: true, ...(scope === 'user' ? {} : { projectPath: fs.realpathSync(repo) }) }))));

// The stamp a 2.10.0 install left: its version, and the ledger and record lines it wrote.
const olderStamp = (repo, { version = '2.10.0', lines = {} } = {}) =>
{
    const file = path.join(repo, '.claude', 'alfred-code.stamp');
    let text = fs.readFileSync(file, 'utf8').replace(/^version: .*$/m, `version: ${version}`);
    for (const [key, value] of Object.entries(lines))
        text = new RegExp(`^${key}:`, 'm').test(text) ? text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`) : `${text.replace(/\n?$/, '\n')}${key}: ${value}\n`;
    fs.writeFileSync(file, text);
};

// The account's own registrations (the account stub's file): top level at user scope, the project's entry at local.
const accountFile = (repo) => path.join(path.dirname(repo), 'acct', '.claude.json');
const register = (repo, scope, servers) =>
{
    const data = jsonAt(accountFile(repo)) || {};
    const holder = scope === 'user' ? data : ((data.projects ||= {})[fs.realpathSync(repo)] ||= {});
    holder.mcpServers = { ...(holder.mcpServers || {}), ...servers };
    putJson(accountFile(repo), data);
};
const registered = (repo, scope) =>
{
    const data = jsonAt(accountFile(repo)) || {};
    return Object.keys((scope === 'user' ? data : ((data.projects || {})[fs.realpathSync(repo)] || {})).mcpServers || {}).sort();
};

const callsSince = (calls, from) => calls.slice(from);
const callCount = (repo) => { const log = path.join(path.dirname(repo), 'claude-calls.log'); return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0; };
const blockLines = (out) => out.split('\n').filter((l) => /mcp servers: |add it back: claude mcp add-json|mcp data: /.test(l));
const HEADER = /==> +mcp servers: the stack ships none since 2\.10\.1 - removed here: /g;

const SERVER_IDS = ['alfred-navigation', 'alfred-documentation', 'alfred-memory', 'chrome-control'];

test('update over a 2.10.0 plugin-route install: every server plugin goes at its scope, and ONE block names the record, each add-back line once and the data left in place', POSIX_ONLY, () =>
{
    const { calls, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        args: [[], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            const work = path.dirname(repo);
            if (i === 0)
            {
                // The 2.2.0 ids beside today's (navigation@ carried the same server), and an engine a user-scope run installed.
                listing(work, repo, [['alfred-code@envoydev', 'project'], ...SERVER_IDS.map((n) => [`${n}@envoydev`, 'project']),
                    ['navigation@envoydev', 'project'], ['firefox-control@envoydev', 'user']]);
                olderStamp(repo);
                fs.mkdirSync(path.join(repo, '.alfred', 'serena', 'cache'), { recursive: true });
                fs.mkdirSync(path.join(repo, '.alfred', 'chrome-control', 'Default'), { recursive: true });
                putJson(path.join(work, '.alfred-memory', 'memory.db'), {});
                editSettings(repo, 'settings.local.json', (d) => { (d.env ||= {}).ALFRED_CODE_MEMORY_DB = '~/.alfred-memory/memory.db'; });
            }
            // The CLI took the project rows out; only the user-scope engine is left for the re-run to see.
            if (i === 1) listing(work, repo, [['alfred-code@envoydev', 'project'], ['firefox-control@envoydev', 'user']]);
            return { calls: callCount(repo), local: settingsOf(repo, 'settings.local.json') };
        },
    });
    const update = callsSince(calls, steps[0].calls).slice(0, steps[1].calls - steps[0].calls);
    const uninstalls = update.filter((c) => /^plugin uninstall /.test(c)).sort();
    assert.deepStrictEqual(uninstalls, [...SERVER_IDS, 'navigation'].map((n) => `plugin uninstall ${n}@envoydev --scope project -y`).sort(), outs[1]);
    assert.match(outs[1], /firefox-control@envoydev is installed at user scope, not this run's - kept/, 'the user row serves every other project');
    // ONE block: the header once, each add-back line once (navigation@ and alfred-navigation share serena's), after the header.
    assert.strictEqual((outs[1].match(HEADER) || []).length, 1, blockLines(outs[1]).join('\n'));
    assert.match(outs[1], /mcp servers: .*stack\/mcp\/original-mcps\.json \(https:\/\/github\.com\/envoydev\/alfred-code\/blob\/main\/stack\/mcp\/original-mcps\.json\)/);
    const backs = outs[1].split('\n').filter((l) => /add it back: claude mcp add-json/.test(l));
    assert.deepStrictEqual(backs.map((l) => /add-json --scope (\S+) (\S+) /.exec(l).slice(1).join(' ')).sort(),
        ['project context7', 'project memory', 'project playwright-chrome', 'project serena'], backs.join('\n'));
    const lines = outs[1].split('\n');
    const header = lines.findIndex((l) => HEADER.test(l) || /mcp servers: the stack ships none/.test(l));
    assert.ok(lines.every((l, i) => !/add it back: claude mcp add-json/.test(l) || i > header), 'an add-back line printed outside the block');
    for (const back of backs)
    {
        const [, name, json] = /add-json --scope project (\S+) '(.+)'$/.exec(back);
        assert.deepStrictEqual(JSON.parse(json), RECORD[name], `${name}: the line is the record's entry`);
    }
    assert.match(outs[1], /mcp data: kept where it was - .*\.alfred\/serena\/.*\.alfred\/chrome-control\/.*~\/\.alfred-memory\/memory\.db/, blockLines(outs[1]).join('\n'));
    assert.strictEqual((steps[1].local.env || {}).ALFRED_CODE_MEMORY_DB, undefined, 'the database path stayed in settings.local.json');
    // The re-run: nothing left to take out, so no uninstall and no block.
    const again = callsSince(calls, steps[1].calls);
    assert.deepStrictEqual(again.filter((c) => /^plugin uninstall /.test(c)), [], outs[2]);
    assert.deepStrictEqual(blockLines(outs[2]), [], outs[2]);
});

test('update leaves no empty env in settings.local.json once the database path goes, and no file a 2.10.0 install made for it alone', POSIX_ONLY, () =>
{
    const cases = [
        ['alone', {}, null],
        ['beside a key of the user\'s', { mine: 1 }, { mine: 1 }],
        ['beside an env value of the user\'s', { env: { MY_VAR: 'x' } }, { env: { MY_VAR: 'x' } }],
    ];
    for (const scope of ['project', 'user'])
        for (const [what, before, after] of cases)
        {
            const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
                args: [['--scope', scope], ['--installed-only', '--scope', scope], ['--installed-only', '--scope', scope]],
                each: (repo, i) =>
                {
                    const file = path.join(repo, '.claude', 'settings.local.json');
                    if (i === 0)
                    {
                        olderStamp(repo);
                        putJson(file, { ...before, env: { ...(before.env || {}), ALFRED_CODE_MEMORY_DB: '~/.alfred-memory/memory.db' } });
                    }
                    return { local: fs.existsSync(file) ? jsonAt(file) : null };
                },
            });
            assert.deepStrictEqual(steps[1].local, after, `${scope}, ${what}\n${outs[1]}`);
            if (!after) assert.match(outs[1], /settings\.local\.json removed - it held nothing but the stack's entries/, outs[1]);
            assert.deepStrictEqual(steps[2].local, after, `${scope}, ${what}: the re-run changed it\n${outs[2]}`);
            assert.doesNotMatch(outs[2], /settings\.local\.json/, outs[2]);
        }
});

test('update lifts Claude\'s own memory switch-off where a pre-2.10.1 stack wrote it - the run\'s own settings file only - and never after', POSIX_ONLY, () =>
{
    for (const scope of ['project', 'local'])
    {
        const own = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const other = scope === 'local' ? 'settings.json' : 'settings.local.json';
        const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
            args: [['--scope', scope], ['--installed-only', '--scope', scope], ['--installed-only', '--scope', scope]],
            each: (repo, i) =>
            {
                if (i === 0)
                {
                    olderStamp(repo);
                    editSettings(repo, own, (d) => { d.autoMemoryEnabled = false; d.mine = 1; });
                    editSettings(repo, other, (d) => { d.autoMemoryEnabled = false; });
                }
                const read = { own: settingsOf(repo, own), other: settingsOf(repo, other) };
                // After the lift, the user switches it off again on a 2.10.1 stamp: theirs from now on.
                if (i === 1) { olderStamp(repo, { version: '2.10.1' }); editSettings(repo, own, (d) => { d.autoMemoryEnabled = false; }); }
                return read;
            },
        });
        assert.strictEqual(steps[1].own.autoMemoryEnabled, undefined, `${scope}: the switch-off stayed\n${outs[1]}`);
        assert.strictEqual(steps[1].own.mine, 1, `${scope}: another key of the file went with it`);
        assert.match(outs[1], new RegExp(`${own.replace('.', '\\.')}: autoMemoryEnabled: false removed - `), outs[1]);
        assert.strictEqual(steps[1].other.autoMemoryEnabled, false, `${scope}: the file this scope never writes was edited`);
        assert.strictEqual(steps[2].own.autoMemoryEnabled, false, `${scope}: a switch-off set after the release was taken\n${outs[2]}`);
        assert.doesNotMatch(outs[2], /autoMemoryEnabled/, outs[2]);
    }
});

test('update lifts the deniedMcpServers rows an earlier release wrote, and keeps one while a broader registration of the name is still there', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        account: true,
        args: [[], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                olderStamp(repo, { lines: { 'mcp-denied': 'project:alfred-navigation,project:chrome-control' } });
                editSettings(repo, 'settings.json', (d) => { d.deniedMcpServers = [{ serverName: 'alfred-navigation' }, { serverName: 'chrome-control' }, { serverName: 'mine' }]; });
                register(repo, 'user', { 'chrome-control': shippedRow('chrome-control') });
            }
            return { denied: settingsOf(repo).deniedMcpServers, stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8') };
        },
    });
    assert.deepStrictEqual(steps[1].denied, [{ serverName: 'chrome-control' }, { serverName: 'mine' }], outs[1]);
    assert.match(outs[1], /settings\.json: deniedMcpServers - alfred-navigation \(the stack ships no MCP server since 2\.10\.1\)/, outs[1]);
    assert.match(outs[1], /deniedMcpServers keeps chrome-control - a user-scope registration of it is still there/, outs[1]);
    assert.match(steps[1].stamp, /^mcp-denied: project:chrome-control$/m, 'the kept row lost its record, so no later run lifts it');
    assert.deepStrictEqual(steps[2].denied, steps[1].denied, outs[2]);
});

test('update at local scope removes only the registrations the stack vouches for - the ledger at its hash, else the exact shipped shape - and a user\'s add-back stays, unnamed, now and after', POSIX_ONLY, () =>
{
    const userServe = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent', 'serena', 'start-mcp-server'], env: {} };
    const { calls, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        account: true,
        args: [['--scope', 'local'], ['--installed-only', '--scope', 'local'], ['--installed-only', '--scope', 'local']],
        each: (repo, i) =>
        {
            if (i === 0)
            {
                const changed = { ...shippedRow('alfred-memory'), args: ['mine.js'] };
                register(repo, 'local', {
                    'alfred-navigation': shippedRow('alfred-navigation'), 'alfred-memory': changed, 'chrome-control': shippedRow('chrome-control'),
                    // The package the stack ran, not its shape: the identity alone is no proof.
                    'alfred-documentation': { type: 'http', url: SHIPPED.remotes['alfred-documentation'].url },
                    'webkit-control': userServe,
                    // A 2.0.0 name an install never updated past would hold, in the shape its successor shipped.
                    navigation: shippedRow('alfred-navigation'),
                    serena: RECORD.serena,
                });
                olderStamp(repo, { lines: { 'managed-mcp': [`local:alfred-navigation=${entryHash(shippedRow('alfred-navigation'))}`, `local:alfred-memory=${entryHash(shippedRow('alfred-memory'))}`].join(',') } });
            }
            if (i === 1) olderStamp(repo, { version: '2.10.1' });
            return { calls: callCount(repo), servers: registered(repo, 'local') };
        },
    });
    const removes = callsSince(calls, steps[0].calls).slice(0, steps[1].calls - steps[0].calls).filter((c) => /^mcp remove /.test(c)).sort();
    assert.deepStrictEqual(removes, ['mcp remove alfred-navigation -s local', 'mcp remove chrome-control -s local', 'mcp remove navigation -s local'], outs[1]);
    assert.deepStrictEqual(steps[1].servers, ['alfred-documentation', 'alfred-memory', 'serena', 'webkit-control'], outs[1]);
    assert.match(outs[1], /mcp alfred-memory: kept - the local-scope registration changed since the stack registered it/, outs[1]);
    assert.match(outs[1], /mcp alfred-documentation: the local-scope registration is not the stack's/, outs[1]);
    assert.doesNotMatch(outs[1], /mcp serena:/, 'the add-back name is the user\'s - never named as a leftover');
    assert.doesNotMatch(outs[1], /add it back: claude mcp add-json --scope local serena /, 'the add-back of a name already registered here');
    assert.match(outs[1], /add it back: claude mcp add-json --scope local playwright-chrome /, outs[1]);
    // After the release, nothing under any of the names is touched or named again.
    assert.deepStrictEqual(callsSince(calls, steps[1].calls).filter((c) => /^mcp remove /.test(c)), [], outs[2]);
    assert.deepStrictEqual(steps[2].servers, steps[1].servers);
    assert.doesNotMatch(outs[2], /mcp (alfred-memory|alfred-documentation|webkit-control|serena):/, outs[2]);
});

test('update at project scope: the stack\'s .mcp.json rows go, a .mcp.json left with nothing goes too, and a user\'s add-back there keeps its approval', POSIX_ONLY, () =>
{
    for (const withOwn of [false, true])
    {
        const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
            account: true,
            args: [[], ['--installed-only'], ['--installed-only']],
            each: (repo, i) =>
            {
                const mcpJson = path.join(repo, '.mcp.json');
                if (i === 0)
                {
                    const servers = { 'alfred-navigation': shippedRow('alfred-navigation'), 'alfred-memory': shippedRow('alfred-memory'), ...(withOwn ? { serena: RECORD.serena } : {}) };
                    putJson(mcpJson, { mcpServers: servers });
                    editSettings(repo, 'settings.json', (d) => { d.enabledMcpjsonServers = Object.keys(servers); });
                    olderStamp(repo, { lines: { 'managed-mcp': ['alfred-navigation', 'alfred-memory'].map((n) => `${n}=${entryHash(shippedRow(n))}`).join(',') } });
                }
                return { mcp: fs.existsSync(mcpJson) ? Object.keys(jsonAt(mcpJson).mcpServers || {}) : null, approved: settingsOf(repo).enabledMcpjsonServers };
            },
        });
        if (withOwn)
        {
            assert.deepStrictEqual(steps[1].mcp, ['serena'], outs[1]);
            assert.deepStrictEqual(steps[1].approved, ['serena'], 'the user\'s add-back lost its approval');
            assert.doesNotMatch(outs[1], /add it back: claude mcp add-json --scope project serena /, outs[1]);
            assert.deepStrictEqual(steps[2], steps[1], outs[2]);
        }
        else
        {
            assert.strictEqual(steps[1].mcp, null, `a .mcp.json holding nothing stayed\n${outs[1]}`);
            assert.match(outs[1], /\.mcp\.json removed - it held nothing but the stack's registrations/, outs[1]);
            assert.strictEqual(steps[1].approved, undefined, outs[1]);
        }
    }
});

test('update drops a retired server plugin\'s enabledPlugins key from the project\'s settings when no install of it reaches this project', POSIX_ONLY, () =>
{
    for (const blind of [false, true])
    {
        const { outs, steps } = seedRun(['install', 'update'], SELECTION, {
            args: [[], ['--installed-only']],
            each: (repo, i) =>
            {
                const work = path.dirname(repo);
                if (i === 0)
                {
                    // A teammate committed the keys; this machine holds only the core.
                    if (blind) fs.writeFileSync(path.join(work, 'plugins.json'), 'not json');
                    else listing(work, repo, [['alfred-code@envoydev', 'project'], ['alfred-memory@envoydev', 'user']]);
                    olderStamp(repo);
                    editSettings(repo, 'settings.json', (d) => { d.enabledPlugins = { ...(d.enabledPlugins || {}), 'alfred-navigation@envoydev': true, 'alfred-memory@envoydev': true, 'theirs@x': true }; });
                }
                return settingsOf(repo).enabledPlugins || {};
            },
        });
        if (blind)
        {
            assert.strictEqual(steps[1]['alfred-navigation@envoydev'], true, `an unreadable listing is no proof nothing reaches this project\n${outs[1]}`);
            continue;
        }
        assert.strictEqual(steps[1]['alfred-navigation@envoydev'], undefined, outs[1]);
        assert.match(outs[1], /settings\.json: enabledPlugins entry alfred-navigation@envoydev removed - the stack retired that plugin in 2\.10\.1 and no install of it reaches this project/, outs[1]);
        assert.strictEqual(steps[1]['alfred-memory@envoydev'], true, 'a user-scope install still reaches this project - the update at that scope takes it');
        assert.strictEqual(steps[1]['theirs@x'], true);
    }
});
