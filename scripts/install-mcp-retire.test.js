'use strict';
// THE RETIRE PATH - the stack ships no MCP server since 2.10.1 (the user's ruling of 2026-10-24), so what is left of the MCP
// layer is reading what an older release registered and taking out only the stack's own: the argv and shape rules a
// registration is matched with (identityOf, exactStack), the account file and its backups, the .mcp.json ledger and key
// order, and the update runs that prune a 2.10.0 row while keeping the user's own beside it.
const test = require('node:test');

const assert = require('node:assert');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const mcp = require('./install/mcp.js');
// How 2.10.0 shipped each server - the shapes the retire path reads an older install's registrations against.
const SHIPPED = require('../stack/mcp/shipped-mcps.json');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-mcp-retire-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;

const mcpFile = (servers) =>
{
    const file = path.join(TMP, `mcp-${seq++}.json`);
    if (servers !== undefined) fs.writeFileSync(file, typeof servers === 'string' ? servers : `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
    return file;
};

// --- the argv rules -------------------------------------------------------

test('mcp-argv: a placeholder resolving to a path WITH A SPACE stays ONE argument', () =>
{
    // The word is split first and the token resolved inside it - the other order turned
    // '/Users/Jane Doe/.memory-mcp/memory.db' into two arguments and the server never started.
    const argv = mcp.mcpArgv('-e MCP_MEMORY_SQLITE_PATH=@MEMORY_DB_PATH@ -- uvx memory',
        { MEMORY_DB_PATH: '/Users/Jane Doe/.memory-mcp/memory.db' });
    assert.deepStrictEqual(argv, ['-e', 'MCP_MEMORY_SQLITE_PATH=/Users/Jane Doe/.memory-mcp/memory.db', '--', 'uvx', 'memory']);
});

test('mcp-argv: a bare * is passed literally, never glob-expanded', () =>
{
    assert.deepStrictEqual(mcp.mcpArgv('-- npx -y pkg --match *'), ['--', 'npx', '-y', 'pkg', '--match', '*']);
});

// --- the servers 2.0.0 cut (R26, R32) -------------------------------------------------------------
// The manifest's `retired.mcps` keeps naming the five, so a copy-route registration of one is pruned.
// Only by the FIRST update past the retirement, though: the prune prints the line that adds the server
// back, and from then on a registration under that name is the user's own.
const RETIRED_ROWS = [{ name: 'angular-cli', retiredIn: '2.0.0', addBack: 'claude mcp add --scope <scope> angular-cli -- npx -y @angular/cli mcp' }];

test('retired servers: pruned while the last install predates the retirement, never after', () =>
{
    const { compareVersions } = require('./install/source.js');
    const due = (lastVersion) => mcp.dueRetired({ names: ['angular-cli', 'old-server'], rows: RETIRED_ROWS, lastVersion, compare: compareVersions });
    assert.deepStrictEqual(due('1.3.0'), ['angular-cli', 'old-server'], 'a 1.x install still carries the stack\'s registration');
    assert.deepStrictEqual(due('1.10.0'), ['angular-cli', 'old-server'], 'compared as versions, not strings');
    assert.deepStrictEqual(due(''), ['old-server'], 'no stamp: the stack never registered it - a server added by hand stays');
    assert.deepStrictEqual(due('2.0.0'), ['old-server'], 'at the retiring release it is the user\'s');
    assert.deepStrictEqual(due('2.1.0'), ['old-server'], 'and after it');
});

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const COPY_ENV = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };

// The account's own MCP registrations: `<CLAUDE_CONFIG_DIR>/.claude.json` - top-level `mcpServers` at
// user scope, `projects[<root>].mcpServers` at local scope. The sandbox's account dir is `<work>/acct`.
const accountMcp = (work, servers, projects = {}) =>
{
    fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
    fs.writeFileSync(path.join(work, 'acct', '.claude.json'), JSON.stringify({ mcpServers: servers, projects }, null, 2));
};

const STACK_SERENA = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--from', 'serena-agent@1.6.0', 'serena', 'start-mcp-server', '--project-from-cwd'], env: {} };

const STACK_PW = (e) => ({ type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.80', '--browser', e], env: {} });

// The plugin listing a 2.2.0-2.10.0 install left: the core and the three servers it shipped as plugins.
const STACK_ROWS = (key, over = {}) => ['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory']
    .map((n) => ({ id: `${n}@${key}`, version: '2.0.0', scope: 'project', enabled: true, ...(over[n] || {}) }));
const STOOD = ['alfred-code', 'alfred-navigation', 'alfred-documentation', 'alfred-memory'];
const USER_ROWS = () => STACK_ROWS('envoydev', Object.fromEntries(STOOD.map((n) => [n, { scope: 'user' }])));
const pwProject = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 2.0.0\ncontrol-engines: chrome,firefox,webkit\ncontrol-enabled: chrome,firefox\n');
};

const jsonAt = (repo, rel) => { try { return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8')); } catch { return {}; } };

// R124 (Task 8a concern m): enabledMcpjsonServers pre-approves the .mcp.json servers THIS run registered,
// and nothing else - never the locked three on a route where they ride the plugins, never an engine it
// names in disabledMcpjsonServers, and nothing at local or user scope, where no server lands in .mcp.json.
// A name the user put there is theirs.
const trusted = (repo, file = 'settings.json') => jsonAt(repo, `.claude/${file}`).enabledMcpjsonServers;
const stepCalls = (repo) =>
{
    const log = path.join(path.dirname(repo), 'claude-calls.log');
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    fs.writeFileSync(log, '');
    return calls;
};

// F7 (R22g, F1 G): C10 put the user-scope full copy route's servers in THIS project's .mcp.json, but a
// user-scope run leaving that route pruned only at user scope - the project kept serena, memory,
// context7 and the engine, so the next session loaded the bare context7 beside the plugin's and chrome
// twice. A user-scope run that registers elsewhere prunes them from .mcp.json as a project-scope run
// does: a name the file does not hold costs no call, a hand-added server stays, and so does its approval.
// This CLI does to .mcp.json what `claude mcp remove <name> -s project` does - the recording stub writes
// nothing - so the case reads the file the run leaves.
const REMOVE_FROM_MCPJSON = 'const fs=require("fs");const n=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(".mcp.json","utf8"))}catch{}'
    + 'if(!d.mcpServers||!d.mcpServers[n]){console.error("No MCP server named "+n+" found in .mcp.json");process.exit(1)}'
    + 'delete d.mcpServers[n];fs.writeFileSync(".mcp.json",JSON.stringify(d,null,2)+"\\n")';

const MCPJSON_CLI = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
    'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi',
    `if [ "$1" = "mcp" ] && [ "$2" = "remove" ] && [ "$4" = "-s" ] && [ "$5" = "project" ]; then exec "${process.execPath}" -e '${REMOVE_FROM_MCPJSON}' "$3"; fi`,
    'exit 0'].join('\n');

const LEFT_BY_C10 = ['alfred-documentation', 'alfred-memory', 'alfred-navigation', 'chrome-control'];
// A project-scope row exactly as 2.10.0's copy route wrote it, from the record of how it shipped (stack/mcp/shipped-mcps.json).
const SHIPPED_TOKENS = { SERENA_HOME: '.alfred/serena/home', ROOT_BOOT: SHIPPED.rootBoot, UV_PYTHON: '3.13', UV_EXCLUDE_FLAG: '--exclude-newer',
    UV_EXCLUDE_NEWER: '2026-10-20T23:59:59Z', SERENA_PIN: '@2.1.0', SERENA_CONTEXT: '.claude/navigation-context.yml', SERENA_PROJECT_FLAG: '--project-from-cwd',
    SERENA_PROJECT_DIR: '', MEMORY_BACKEND: 'sqlite_vec', MEMORY_DB_PATH: '~/.alfred-memory/memory.db', MEMORY_PIN: '==12.1.1', PW_PIN: '@0.0.83' };
const shippedRow = (name) =>
{
    const engine = (/^(chrome|msedge|firefox|webkit)-control$/.exec(name) || [])[1];
    const args = engine ? mcp.pwArgsFor(SHIPPED.copy.browser.args, engine) : SHIPPED.copy[name].args;
    const tokens = engine ? { ...SHIPPED_TOKENS, [`BROWSER_DIR_${engine.toUpperCase()}`]: `.alfred/${engine}-control` } : SHIPPED_TOKENS;
    return mcp.wantFor(mcp.expectShape({ name, args, remotes: SHIPPED.remotes, tokens }));
};

// After the full copy route's run, the user adds a server of their own to .mcp.json and approves it.
const handAdded = (repo) =>
{
    const file = path.join(repo, '.mcp.json');
    const data = jsonAt(repo, '.mcp.json');
    data.mcpServers = { ...(data.mcpServers || {}), mine: { type: 'stdio', command: 'node', args: ['my-server.js'], env: {} } };
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    const settingsFile = path.join(repo, '.claude', 'settings.json');
    const settingsData = jsonAt(repo, '.claude/settings.json');
    settingsData.enabledMcpjsonServers = [...(settingsData.enabledMcpjsonServers || []), 'mine'];
    fs.writeFileSync(settingsFile, `${JSON.stringify(settingsData, null, 2)}\n`);
};

const userCallsOf = (calls) => calls.filter((c) => /^mcp (add|remove) .*(--scope user|-s user)/.test(c));

const projectRemovesOf = (calls) => calls.filter((c) => /^mcp remove .* -s project$/.test(c));

// A user-scope full copy route (C10) put the stack's servers in THIS project's .mcp.json. The release that ships none prunes
// every one of them there - with no ledger, by the shipped shape (exactStack) - keeps the user's own beside them with its
// approval, calls nothing at user scope, and a re-run removes nothing.
test('seed update --scope user: the stack servers C10 left in this project\'s .mcp.json are pruned, a hand-added one kept, nothing called at user scope (F7, R22g)', POSIX_ONLY, () =>
{
    const rows = [...USER_ROWS(), { id: 'chrome-control@envoydev', version: '2.0.0', scope: 'user', enabled: true }];
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(rows), tools: { claude: MCPJSON_CLI },
        args: [['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only']],
        prepare: (repo) =>
        {
            pwProject(repo);
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: Object.fromEntries(LEFT_BY_C10.map((n) => [n, shippedRow(n)])) }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: [...LEFT_BY_C10] }, null, 2)}\n`);
            handAdded(repo);
        },
        each: (repo) => ({ calls: stepCalls(repo), mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}).sort(), trusted: trusted(repo) }),
    });
    const [first, again] = steps;
    assert.deepStrictEqual(first.mcp, ['mine'], `stack servers left in this project's .mcp.json:\n${first.calls.join('\n')}\n${outs[0]}`);
    assert.deepStrictEqual(projectRemovesOf(first.calls).sort(), LEFT_BY_C10.map((n) => `mcp remove ${n} -s project`), 'a name .mcp.json does not hold cost a call, or one it holds was not removed');
    for (const name of LEFT_BY_C10) assert.match(outs[0], new RegExp(`mcp pruned: ${name}\\n`), outs[0]);
    assert.deepStrictEqual(first.trusted, ['mine'], 'the hand-added server lost its approval, or a stack name kept one');
    for (const [i, step] of steps.entries()) assert.deepStrictEqual(userCallsOf(step.calls), [], `step ${i} called at user scope:\n${outs[i]}`);
    assert.deepStrictEqual(projectRemovesOf(again.calls), [], `the re-run removed again:\n${outs[1]}`);
    assert.deepStrictEqual(again.mcp, ['mine']);
});

// F7 ruling: that prune never removes the user's own server. A stack name in .mcp.json goes only when the
// registration is the stack's own shape (mcp.identityOf); another under the name is kept, with its
// approval, and named once with its remove command - A-M2's rule, not the project scope's by-name one.
test('seed update --scope user: the prune of this project\'s .mcp.json keeps the user\'s own server under a stack name and names it once (F7 ruling)', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(USER_ROWS()), tools: { claude: MCPJSON_CLI },
        args: ['--scope', 'user'],
        prepare: (repo) =>
        {
            pwProject(repo);
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: {
                'alfred-navigation': { type: 'stdio', command: 'node', args: ['my-serena.js'], env: {} },
                'alfred-documentation': { type: 'http', url: SHIPPED.remotes['alfred-documentation'].url, headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' } },
            } }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['alfred-navigation', 'alfred-documentation'] }, null, 2)}\n`);
        },
        inspect: (repo) => ({ mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}), trusted: trusted(repo) }),
    });
    assert.deepStrictEqual(projectRemovesOf(calls), ['mcp remove alfred-documentation -s project'], `${projectRemovesOf(calls).join('\n')}\n${out}`);
    assert.deepStrictEqual(result.mcp, ['alfred-navigation'], 'the user\'s own navigation went, or the stack\'s documentation stayed');
    assert.strictEqual((out.match(/==> +mcp alfred-navigation: the project-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove alfred-navigation -s project/g) || []).length, 1, out);
    assert.deepStrictEqual(result.trusted, ['alfred-navigation'], 'the kept server lost its approval, or the pruned one kept it');
    assert.deepStrictEqual(userCallsOf(calls), [], out);
});

// I-F7-1 (re-review of F7): no user-scope run writes a bare `playwright` into the project's .mcp.json, and
// its identity is the package name only - so the README shape `npx @playwright/mcp@latest` a user (or a
// team, in a committed file) registered there reads as the stack's. The prune must leave it alone.
test('seed update --scope user: the prune of this project\'s .mcp.json never removes a bare playwright - no user-scope run writes one there (I-F7-1)', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(USER_ROWS()), tools: { claude: MCPJSON_CLI },
        args: ['--scope', 'user'],
        prepare: (repo) =>
        {
            pwProject(repo);
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: {
                playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
            } }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['playwright'] }, null, 2)}\n`);
        },
        inspect: (repo) => ({ mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}), trusted: trusted(repo) }),
    });
    assert.deepStrictEqual(projectRemovesOf(calls), [], `${projectRemovesOf(calls).join('\n')}\n${out}`);
    assert.deepStrictEqual(result.mcp, ['playwright'], 'the user\'s own playwright was removed from the project .mcp.json');
    assert.deepStrictEqual(result.trusted, ['playwright'], 'the user\'s own playwright lost its approval');
    assert.deepStrictEqual(userCallsOf(calls), [], out);
});

// A-M2 (final review A): at user scope every run removed each stack name from the account's own
// registrations - a server of the user's own under the same name went with them. Only a registration of
// the stack's own shape (the package it launches, or the url it calls) is removed; another is kept and
// named once, and a name the account does not register costs no call.
test('seed update --scope user (plugin route): only a stack-shaped user-scope registration is removed, the user\'s own under the same name is kept and named once (A-M2)', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(USER_ROWS()),
        args: ['--scope', 'user'],
        prepare: (repo, work) =>
        {
            pwProject(repo);
            accountMcp(work, { 'alfred-navigation': STACK_SERENA, 'webkit-control': STACK_PW('webkit'), 'alfred-documentation': { type: 'http', url: 'https://docs.example.test/mcp' } });
        },
    });
    const removes = calls.filter((c) => /^mcp remove /.test(c));
    assert.deepStrictEqual(removes.sort(), ['mcp remove alfred-navigation -s user', 'mcp remove webkit-control -s user'], `${removes.join('\n')}\n${out}`);
    assert.strictEqual((out.match(/mcp alfred-documentation: the user-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove alfred-documentation -s user/g) || []).length, 1, out);
    assert.doesNotMatch(out, /docs\.example\.test/, 'a registration of the user\'s own is never printed');
});

// A-M3 (final review A): the first update past a retirement removed any registration under a retired name -
// one the user added by hand with the add-back line, which the stack never wrote, included. Only the
// shape the stack wrote goes.
test('seed update: a retired name is pruned only where the registration is the stack\'s own shape (A-M3)', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')),
        inspect: (repo) => trusted(repo),
        prepare: (repo) =>
        {
            pwProject(repo);
            fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 1.3.0\n');
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ enabledMcpjsonServers: ['sentry', 'angular-cli', 'mine'] }));
            fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: {
                'angular-cli': { type: 'stdio', command: 'npx', args: ['-y', '@angular/cli', 'mcp'], env: {} },
                sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
                'chrome-devtools': { type: 'stdio', command: 'node', args: ['./my-devtools.js'], env: {} },
            } }));
        },
    });
    const removes = calls.filter((c) => /^mcp remove (angular-cli|sentry|chrome-devtools|appium-mcp|context7-local) /.test(c));
    assert.deepStrictEqual(removes, ['mcp remove angular-cli -s project'], `${removes.join('\n')}\n${out}`);
    for (const name of ['sentry', 'chrome-devtools'])
        assert.strictEqual((out.match(new RegExp(`mcp ${name}: the project-scope registration is not the stack's`, 'g')) || []).length, 1, out);
    assert.match(out, /mcp pruned: angular-cli\n==> +add it back: claude mcp add --scope project angular-cli/, out);
    assert.deepStrictEqual([...(result || [])].sort(), ['mine', 'sentry'], 'the kept server lost its approval, or the pruned one kept it');
});

// A-M2 / A-M3: which server a registration runs - the package or the url - read through the pin, the
// extras, a manifest placeholder, a trailing slash and the Windows `cmd /c` wrapper.
test('identityOf / stackIdentities: a registration is the stack\'s by the package it launches or the url it calls, never by its pin or wrapper', () =>
{
    const id = mcp.identityOf;
    assert.strictEqual(id({ command: 'uvx', args: ['--python', '3.13', '--with', 'numpy', '--from', 'mcp-memory-service[sqlite]==10.1.0', 'memory', 'server'] }), 'stdio:mcp-memory-service');
    assert.strictEqual(id({ command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@0.0.82', '--browser', 'chrome'] }), 'stdio:@playwright/mcp');
    assert.strictEqual(id({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@0.9.0'] }), 'stdio:chrome-devtools-mcp');
    assert.strictEqual(id({ type: 'http', url: 'https://mcp.context7.com/mcp/' }), 'http:https://mcp.context7.com/mcp');
    assert.strictEqual(id({ command: 'node', args: ['./my-server.js'] }), 'stdio:./my-server.js');
    assert.strictEqual(id(null), '');
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    const ids = mcp.stackIdentities({ retiredRows: rows });
    assert.ok(ids['alfred-navigation'].has('stdio:serena-agent'), [...ids['alfred-navigation']].join(','));
    assert.ok(ids['webkit-control'].has('stdio:@playwright/mcp') && ids.playwright.has('stdio:@playwright/mcp'));
    assert.deepStrictEqual([...ids['alfred-documentation']].sort(), ['http:https://mcp.context7.com/mcp']);
    assert.deepStrictEqual([...ids.context7].sort(), ['stdio:@upstash/context7-mcp'], 'the 1.x local transport under the old name');
    assert.deepStrictEqual([...ids.sentry], ['http:https://mcp.sentry.dev/mcp/${SENTRY_SLUG}'], 'the add-back url is the user\'s, never the stack\'s');
    // Every retired server names what the stack registered, or its prune could never tell its own from the user's -
    // `browser` excepted: a selection token, never a registration name (T5 ruling).
    const { loadManifest } = require('./install/manifest.js');
    for (const name of loadManifest(path.join(__dirname, '..')).retired.mcps.filter((n) => n !== 'browser'))
        assert.ok(ids[name] && ids[name].size, `${name}: no registration row in meta/retired-plugins.json`);
    assert.strictEqual(ids.browser, undefined, 'browser is no registration name');
});

// Plugins audit (2026-09-26): Claude Code connects to a server ONCE, from the highest source - local,
// project, user, then plugins - and matches a plugin server against those by ENDPOINT. Measured on
// 2.1.282 through the session's init row: a user- or project-scope registration of the context7 url,
// under `documentation` or any other name, left the context7 plugin out of the session, so every
// `mcp__plugin_alfred-documentation_alfred-documentation__` spelling the stack ships resolved nothing. A stdio server matches on (mcp-fixture)
// command AND args, which a launcher-started plugin never shares - a same-NAMED one runs beside it.
// Review 2.1.6 B1: the account file is whole only as an object - the CLI replaces a 0-byte one as corrupt and rewrites an
// array in place (measured on 2.1.284), so either reads as unreadable there; .mcp.json keeps its old reading.
test('registrationsAt: a 0-byte or non-object ACCOUNT file is unreadable; an empty .mcp.json still reads as none', () =>
{
    for (const body of ['', '  \n', '[1,2]', '7', 'null'])
    {
        const file = mcpFile(body);
        assert.strictEqual(mcp.registrationsAt({ scope: 'local', accountFile: file, projectRoot: '/p' }).state, 'unreadable', JSON.stringify(body));
        assert.strictEqual(mcp.registrationsAt({ scope: 'user', accountFile: file, projectRoot: '/p' }).state, 'unreadable', JSON.stringify(body));
    }
    assert.deepStrictEqual(mcp.registrationsAt({ scope: 'project', mcpFile: mcpFile(''), projectRoot: '/p' }).state, 'read');
    assert.strictEqual(mcp.registrationsAt({ scope: 'user', accountFile: mcpFile('{}'), projectRoot: '/p' }).state, 'read');
});

// Review 2.1.6 B1: whether the stack's registrations left the account file, decided from the stamp - each reason alone.
// Re-verify: (b) compares in milliseconds where the stamp records them (an older stamp keeps whole seconds), and (c)
// fires only where the file shows it was rewritten - no entry for this project (a recovered file, a moved folder) or a
// fresh file (no firstStartTime, or one after the stamp) - never over the user's own removal of every registration.
test('accountLoss: unreadable now, a corrupted backup after the stamp, or none of the recorded registrations held in a rewritten file', () =>
{
    const at = Date.parse('2026-09-29T10:00:05.700Z');
    const precise = { ms: at, precise: true };
    const second = { ms: Date.parse('2026-09-29T10:00:05Z'), precise: false };
    const backup = (ms) => ({ file: `/c/backups/.claude.json.corrupted.${ms}`, ms });
    const recorded = { 'alfred-navigation': 'h1', 'macos-control': 'h2' };
    const held = { 'alfred-navigation': {} };
    assert.deepStrictEqual(mcp.accountLoss({ unreadable: true, stamped: precise, recorded, held }), { lost: true, why: 'unreadable', backup: '' });
    // (b) in milliseconds: 100 ms after the stamp was written is a later replacement; the run's own, 1 ms before, is not.
    assert.deepStrictEqual(mcp.accountLoss({ backups: [backup(at + 100)], stamped: precise, recorded, held }),
        { lost: true, why: 'replaced', backup: `/c/backups/.claude.json.corrupted.${at + 100}` });
    assert.strictEqual(mcp.accountLoss({ backups: [backup(at - 1)], stamped: precise, recorded, held }).lost, false);
    // An older stamp keeps whole seconds: only a backup from the next second on counts.
    assert.strictEqual(mcp.accountLoss({ backups: [backup(at + 100)], stamped: second, recorded, held }).lost, false);
    assert.strictEqual(mcp.accountLoss({ backups: [backup(second.ms + 1000)], stamped: second, recorded, held }).why, 'replaced');
    // (c): none held, and the file rewritten - no entry for this project, or a fresh file.
    assert.strictEqual(mcp.accountLoss({ stamped: precise, recorded, held: {}, entry: false }).why, 'emptied');
    assert.strictEqual(mcp.accountLoss({ stamped: precise, recorded, held: {}, entry: true, started: '' }).why, 'emptied', 'no firstStartTime: a fresh file');
    assert.strictEqual(mcp.accountLoss({ stamped: precise, recorded, held: {}, entry: true, started: '2026-09-29T10:00:09Z' }).why, 'emptied', 'started after the stamp');
    // ... never the user's own removal: the project entry still there, the account as old as it was.
    assert.strictEqual(mcp.accountLoss({ stamped: precise, recorded, held: {}, entry: true, started: '2026-01-01T00:00:00Z' }).lost, false);
    assert.strictEqual(mcp.accountLoss({ stamped: precise, recorded: {}, held: {}, entry: false }).lost, false, 'nothing recorded is nothing lost');
    assert.strictEqual(mcp.accountLoss({ backups: [backup(at + 9000)], recorded, held }).why, '', 'no stamp, no later backup');
});

test('registrationsAt: the account file says whether it holds this project\'s entry and when it was first started', () =>
{
    const root = path.join(TMP, `proj-${seq++}`);
    fs.mkdirSync(root);
    const file = mcpFile(JSON.stringify({ firstStartTime: '2026-01-01T00:00:00Z', projects: { [root]: { allowedTools: [] } } }));
    assert.deepStrictEqual(mcp.registrationsAt({ scope: 'local', accountFile: file, projectRoot: root }), { state: 'read', servers: {}, file, entry: true, started: '2026-01-01T00:00:00Z' });
    const fresh = mcpFile('{"opusProMigrationComplete": true}');
    assert.deepStrictEqual(mcp.registrationsAt({ scope: 'local', accountFile: fresh, projectRoot: root }), { state: 'read', servers: {}, file: fresh, entry: false, started: '' });
});

// Re-verify 3 S1 / S4 / S7: a registration the ledger does not vouch for is the stack's only in the release template's EXACT
// shape - the same words and env keys, the pin, the --exclude-newer date and the paths the only free parts. The user's own
// server with the stack's package and marks usually adds a flag or an env key (tRmReadd: MACOS_MCP_SKIP_PERMISSION_CHECK).
test('exactStack: the release template\'s words and env keys, free only where a token sits; the anchor and an older release\'s path prefix are no difference', () =>
{
    const catalog = ['alfred-navigation|-e SERENA_HOME=@SERENA_HOME@ -- node -e @ROOT_BOOT@ -- checkout uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from serena-agent@SERENA_PIN@ serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false @SERENA_PROJECT_FLAG@ @SERENA_PROJECT_DIR@',
        'browser|-- node -e @ROOT_BOOT@ -- checkout npx -y @playwright/mcp@PW_PIN@ --user-data-dir @BROWSER_DIR@ --output-dir @BROWSER_DIR@/output --no-webmcp',
        'macos-control|-e ANONYMIZED_TELEMETRY=false -- uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from macos-mcp@MACOS_CONTROL_PIN@ macos-mcp serve',
        'alfred-documentation|@HTTP@'];
    const remotes = SHIPPED.remotes;
    const exact = (name, entry) => mcp.exactStack(name, entry, { catalog, remotes });
    const mac = (args, env = { ANONYMIZED_TELEMETRY: 'false' }) => ({ type: 'stdio', command: 'uvx', args, env });
    const macArgs = ['--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'];
    assert.strictEqual(exact('macos-control', mac(macArgs)), true);
    assert.strictEqual(exact('macos-control', mac(['--python', '3.14', '--exclude-newer', '2026-10-30T00:00:00Z', '--from', 'macos-mcp==0.5.0', 'macos-mcp', 'serve'])), true, 'a pin, a date and the python are free');
    assert.strictEqual(exact('macos-control', mac(['--python', '3.13', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), true, 'no cut-off (the user set UV_EXCLUDE_NEWER=false)');
    assert.strictEqual(exact('macos-control', mac(macArgs, { ANONYMIZED_TELEMETRY: 'false', MACOS_MCP_SKIP_PERMISSION_CHECK: '1' })), false, 'tRmReadd: an env key of the user\'s own');
    assert.strictEqual(exact('macos-control', mac(macArgs, {})), false, 'an env key of the stack\'s missing');
    assert.strictEqual(exact('macos-control', mac(macArgs, { ANONYMIZED_TELEMETRY: 'true' })), false, 'a literal env value changed');
    assert.strictEqual(exact('macos-control', mac([...macArgs, '--verbose'])), false, 'a flag of the user\'s own');
    assert.strictEqual(exact('macos-control', mac(['--python', '3.13', '--with', 'extra', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), false, 'no token soaks up an added flag pair');
    assert.strictEqual(exact('macos-control', mac(['--python', '3.13', '--exclude-newer', '7 days', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), false, 'a cut-off that is no date');
    assert.strictEqual(exact('macos-control', { command: 'cmd', args: ['/c', 'uvx', ...macArgs], env: { ANONYMIZED_TELEMETRY: 'false' } }), true, 'the Windows cmd /c wrapper');
    const boot = SHIPPED.rootBoot;
    const pw = (engine, dir, extra = []) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'npx', '-y', '@playwright/mcp@0.0.83', '--browser', engine, '--user-data-dir', dir, '--output-dir', `${dir}/output`, '--no-webmcp', ...extra], env: {} });
    assert.strictEqual(exact('firefox-control', pw('firefox', '.alfred/firefox-control')), true, 'this release\'s anchored row');
    const old = pw('firefox', '${CLAUDE_PROJECT_DIR:-.}/.alfred/firefox-control');
    old.command = 'npx'; old.args = old.args.slice(5);
    assert.strictEqual(exact('firefox-control', old), true, 'v2.1.5\'s unanchored row with its path prefix');
    assert.strictEqual(exact('firefox-control', pw('firefox', '.playwright/firefox')), true, 'a 2.0.0 profile not moved yet');
    assert.strictEqual(exact('firefox-control', pw('firefox', '/home/me/profiles/ff')), false, 'oNewPlain: a profile of the user\'s own');
    assert.strictEqual(exact('firefox-control', pw('firefox', '.alfred/firefox-control', ['--isolated'])), false, 'oNewMarks: the stack\'s marks plus a flag');
    assert.strictEqual(exact('firefox-control', pw('chrome', '.alfred/chrome-control')), false, 'another engine under the name');
    assert.strictEqual(exact('firefox-control', { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--browser', 'firefox', '--isolated'] }), false);
    const nav = (tail) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'serena-agent==1.7.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', ...tail], env: { SERENA_HOME: '.alfred/serena/home' } });
    assert.strictEqual(exact('alfred-navigation', nav(['--project-from-cwd'])), true);
    assert.strictEqual(exact('alfred-navigation', nav(['--project', '.'])), true);
    assert.strictEqual(exact('alfred-navigation', nav([])), false, 'the project flag is no optional word');
    assert.strictEqual(exact('alfred-documentation', { type: 'http', url: 'https://mcp.context7.com/mcp/', headers: { 'Context7-API-Key': '${CONTEXT7_API_KEY:-}' } }), true);
    assert.strictEqual(exact('alfred-documentation', { type: 'http', url: 'https://mcp.context7.com/mcp', headers: { 'Context7-API-Key': 'abc', 'X-Own': '1' } }), false);
    assert.strictEqual(exact('alfred-documentation', { type: 'http', url: 'https://example.com/mcp' }), false);
    assert.strictEqual(exact('unknown', mac(macArgs)), false, 'a name no catalog row serves');
    const win = ['windows-control|-e WINDOWS_MCP_EXCLUDE_TOOLS=@WINDOWS_CONTROL_EXCLUDE@ -e WINDOWS_MCP_TOOLS= -e ANONYMIZED_TELEMETRY=false -- uvx --python @UV_PYTHON@ --from windows-mcp@WINDOWS_CONTROL_PIN@ windows-mcp serve'];
    const winEntry = (env) => ({ command: 'uvx', args: ['--python', '3.13', '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve'], env: { WINDOWS_MCP_TOOLS: '', ANONYMIZED_TELEMETRY: 'false', ...env } });
    assert.strictEqual(mcp.exactStack('windows-control', winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: '' }), { catalog: win }), true, 'a token env value resolved to nothing (none)');
    assert.strictEqual(mcp.exactStack('windows-control', winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: 'PowerShell,Registry,Process' }), { catalog: win }), true);
    assert.strictEqual(mcp.exactStack('windows-control', { ...winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: '' }), env: { WINDOWS_MCP_TOOLS: 'Click', ANONYMIZED_TELEMETRY: 'false', WINDOWS_MCP_EXCLUDE_TOOLS: '' } }, { catalog: win }), false, 'a literal empty env value set');
    assert.strictEqual(exact('macos-control', null), false);
    // The anchor is the launcher, never the server: identityOf reads the command after it.
    assert.strictEqual(mcp.identityOf(pw('firefox', '.alfred/firefox-control')), 'stdio:@playwright/mcp');
    assert.strictEqual(mcp.identityOf(nav([])), 'stdio:serena-agent');
});

// Re-verify 4 T5: exactStack vouched for a profile outside the project (another project's, the user's own folder that
// happens to end browser/<engine>) and for anchor code of the user's own that merely names runAtRoot - and a vouched row
// is removed and re-registered in the stack's shape. Vouching needs the project's own profile (relative, or absolute
// under the project) and this release's ROOT_BOOT (or one an earlier release registered); identityOf stays loose.
test('exactStack: an engine profile must be this project\'s own, and an anchored row must run the stack\'s own ROOT_BOOT (re-verify 4 T5)', () =>
{
    const catalog = ['browser|-- node -e @ROOT_BOOT@ -- checkout npx -y @playwright/mcp@PW_PIN@ --user-data-dir @BROWSER_DIR@ --output-dir @BROWSER_DIR@/output --no-webmcp',
        'alfred-navigation|-e SERENA_HOME=@SERENA_HOME@ -- node -e @ROOT_BOOT@ -- checkout uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from serena-agent@SERENA_PIN@ serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false @SERENA_PROJECT_FLAG@ @SERENA_PROJECT_DIR@'];
    const projectRoot = path.resolve('/work/proj');
    const boot = SHIPPED.rootBoot;
    const pw = (dir, code = boot) => ({ type: 'stdio', command: 'node', args: ['-e', code, '--', 'checkout', 'npx', '-y', '@playwright/mcp@0.0.83', '--browser', 'firefox', '--user-data-dir', dir, '--output-dir', `${dir}/output`, '--no-webmcp'], env: {} });
    const exact = (name, entry) => mcp.exactStack(name, entry, { catalog, projectRoot });
    assert.strictEqual(exact('firefox-control', pw('.alfred/firefox-control')), true, 'relative: the project\'s own');
    assert.strictEqual(exact('firefox-control', pw(path.join(projectRoot, '.alfred', 'firefox-control'))), true, 'absolute under the project');
    assert.strictEqual(exact('firefox-control', pw('${CLAUDE_PROJECT_DIR:-.}/.alfred/firefox-control')), true, 'v2.1.5\'s project-dir prefix');
    assert.strictEqual(exact('firefox-control', pw('/Users/me/profiles/firefox-control')), false, 'a folder of the user\'s own ending firefox-control');
    assert.strictEqual(exact('firefox-control', pw(path.resolve('/work/other/.alfred/firefox-control'))), false, 'another project\'s profile');
    assert.strictEqual(exact('firefox-control', pw(path.resolve('/work/proj-two/.alfred/firefox-control'))), false, 'a sibling sharing the name\'s prefix');
    assert.strictEqual(exact('firefox-control', pw('../other/.alfred/firefox-control')), false, 'a relative path leaving the project');
    const own = "require('/home/me/mine.js').runAtRoot(process.argv.slice(1))";
    assert.strictEqual(exact('firefox-control', pw('.alfred/firefox-control', own)), false, 'anchor code of the user\'s own naming runAtRoot');
    assert.strictEqual(mcp.identityOf(pw('.alfred/firefox-control', own)), 'stdio:@playwright/mcp', 'identity still reads the server after any anchor');
    const nav = (code) => ({ type: 'stdio', command: 'node', args: ['-e', code, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'serena-agent==1.7.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', '--project-from-cwd'], env: { SERENA_HOME: '.alfred/serena/home' } });
    assert.strictEqual(exact('alfred-navigation', nav(boot)), true);
    assert.strictEqual(exact('alfred-navigation', nav(own)), false, 'navigation under code of the user\'s own');
    assert.strictEqual(mcp.exactStack('alfred-navigation', nav(own), { catalog, boots: [own] }), true, 'a listed earlier release\'s code');
});

// Audit 2026-10-14 PL1: the copy route registers serena with its usage ping off (-e SERENA_USAGE_REPORTING=false), and a
// registration an earlier release wrote - no such key - is still the stack's (ADDED_ENV_KEYS), so an update repairs it
// instead of holding it as the user's own.
test('PL1: a navigation row with SERENA_USAGE_REPORTING=false, and the pre-fix shape without it, are the stack\'s', () =>
{
    const catalog = [`alfred-navigation|${SHIPPED.copy['alfred-navigation'].args}`];
    const boot = SHIPPED.rootBoot;
    const nav = (env) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'serena-agent@1.7.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', '--project-from-cwd'], env });
    const exact = (env) => mcp.exactStack('alfred-navigation', nav(env), { catalog });
    assert.strictEqual(exact({ SERENA_HOME: '.alfred/serena/home', SERENA_USAGE_REPORTING: 'false' }), true, 'this release\'s shape');
    assert.strictEqual(exact({ SERENA_HOME: '.alfred/serena/home' }), true, 'the pre-fix shape an earlier release registered');
    assert.strictEqual(exact({ SERENA_HOME: '.alfred/serena/home', SERENA_USAGE_REPORTING: 'true' }), false, 'the ping switched back on is the user\'s');
    assert.strictEqual(exact({ SERENA_USAGE_REPORTING: 'false' }), false, 'a key the template always had is still required');
    assert.strictEqual(exact({ SERENA_HOME: '.alfred/serena/home', SERENA_USAGE_REPORTING: 'false', SERENA_LOG_LEVEL: 'debug' }), false, 'an env key of the user\'s own');
    // PL4: mobile-control's npm cut-off, added the same way - a 2.4.0 registration without it is still the stack's.
    const mob = SHIPPED.copy['mobile-control'];
    const mobile = (env) => mcp.exactStack('mobile-control', { type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'npx', '-y', 'appium-mcp@1.97.1'],
        env: { NO_UI: 'true', ALLOW_REMOTE_APP_URLS: 'false', REMOTE_SERVER_URL_ALLOW_REGEX: 'x', SCREENSHOTS_DIR: '.alfred/mobile-control/screenshots', PAGE_SOURCES_DIR: '.alfred/mobile-control/page-sources', ...env } },
    { catalog: [`mobile-control|${mob.args}`] });
    assert.strictEqual(mobile({ npm_config_before: '2026-10-13T23:59:59Z' }), true, 'this release\'s shape');
    assert.strictEqual(mobile({}), true, 'the 2.4.0 shape, before the cut-off');
    assert.strictEqual(mobile({ npm_config_before: '' }), true, 'a release with no day recorded registers it empty');
});

// Audit 2026-10-14 PL10: serena 2.0.0's config template sets agent_interface REPL, where the context's exclusions do not
// apply and serena_repl edits files unseen; both routes pin `--agent-interface tools`. A registration an earlier release
// wrote without the pair is still the stack's (ADDED_ARG_WORDS), so update rewrites it; another interface is the user's.
test('PL10: a navigation row with --agent-interface tools, and the pre-2.0.0 shape without it, are the stack\'s', () =>
{
    const row = SHIPPED.copy['alfred-navigation'];
    assert.match(row.args, / --agent-interface tools"?$/, 'the copy-route template carried the pair');
    const catalog = [`alfred-navigation|${row.args}`];
    const boot = SHIPPED.rootBoot;
    const nav = (tail) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-10-14T23:59:59Z', '--from', 'serena-agent@2.0.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', '--project-from-cwd', ...tail],
        env: { SERENA_HOME: '.alfred/serena/home', SERENA_USAGE_REPORTING: 'false' } });
    const exact = (tail) => mcp.exactStack('alfred-navigation', nav(tail), { catalog });
    assert.strictEqual(exact(['--agent-interface', 'tools']), true, 'this release\'s shape');
    assert.strictEqual(exact([]), true, 'the shape an earlier release registered');
    assert.strictEqual(exact(['--agent-interface', 'REPL']), false, 'another interface is the user\'s choice');
    assert.strictEqual(exact(['--agent-interface', 'tools', '--mode', 'planning']), false, 'a word of the user\'s own');
});

test('accountBackups: the CLI\'s corrupted copies and its last good ones, oldest first, from every folder named once', () =>
{
    const dir = path.join(TMP, `backups-${seq++}`);
    fs.mkdirSync(dir);
    for (const n of ['.claude.json.corrupted.300', '.claude.json.corrupted.100', '.claude.json.backup.200', 'notes.txt']) fs.writeFileSync(path.join(dir, n), '');
    assert.deepStrictEqual(mcp.accountBackups([dir, dir, path.join(TMP, 'absent')]).map((b) => b.ms), [100, 300]);
    assert.deepStrictEqual(mcp.accountBackups([dir], 'good').map((b) => path.basename(b.file)), ['.claude.json.backup.200']);
});

// A-M2: an account file the run cannot read is no list of registrations - nothing is removed at user
// scope, and the run says so once.
test('seed update --scope user: an unreadable account .claude.json removes nothing and is said once (A-M2)', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(USER_ROWS()),
        args: ['--scope', 'user'],
        prepare: (repo, work) =>
        {
            pwProject(repo);
            fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
            fs.writeFileSync(path.join(work, 'acct', '.claude.json'), '{not json');
        },
    });
    assert.deepStrictEqual(calls.filter((c) => /^mcp remove /.test(c)), [], out);
    assert.strictEqual((out.match(/\.claude\.json could not be read - no user-scope registration was removed/g) || []).length, 1, out);
});

// C17 ((i), Task 8a): the copy route copied each skill and seat with the plugin spelling, then re-spelled
// it in place - so every run rewrote the same files and logged 're-spelled in N file(s)'. A copy is now
// written as the text it holds (rendered at copy time) and only when that differs, so a re-run writes
// nothing and says nothing.
// B seam (final review B): on the FULL copy route no core plugin serves `alfred-code:<skill>`, so a seat's
// preload in that spelling loaded nothing - the copy route installed the skill bare. The copied seat
// preloads the bare name; the plugin route keeps the shipped text.
test('seed install + re-run (full copy route): copies hold no server and bare preloads from the first write, and a re-run rewrites nothing (C17, B seam)', POSIX_ONLY, () =>
{
    const seat = path.join('.claude', 'agents', 'angular-test-resolver.md');
    // The walk's closure brings a seat's preloaded skills along; a raw selection names them.
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nskill habits-root-cause\nskill habits-done-gate\nrule markdown-docs\nagent angular-test-resolver\n', {
        env: COPY_ENV,
        args: [[], ['--installed-only']],
        each: (repo) =>
        {
            const skills = path.join(repo, '.claude', 'skills');
            const stat = (rel) => fs.statSync(path.join(repo, rel)).mtimeMs;
            const skillFiles = fs.readdirSync(skills, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(skills, f)).isFile());
            return {
                seat: fs.readFileSync(path.join(repo, seat), 'utf8'),
                mtimes: Object.fromEntries([seat, ...skillFiles.map((f) => path.join('.claude', 'skills', f))].map((f) => [f, stat(f)])),
                preloaded: fs.existsSync(path.join(skills, 'habits-root-cause', 'SKILL.md')),
            };
        },
    });
    for (const [i, out] of outs.entries()) assert.doesNotMatch(out, /MCP tool names re-spelled/, `step ${i} re-spelled copies it had just written:\n${out}`);
    const front = steps[0].seat.split('\n---')[0];
    assert.match(front, /^ {2}- habits-root-cause$/m, front);
    assert.doesNotMatch(front, /alfred-code:/, 'a preload still names the core plugin');
    // 2026-10-24: the seat holds built-in tools only, so the copy names no server in either spelling
    const tokens = (key) => ((front.split('\n').find((l) => l.startsWith(`${key}:`)) || '').slice(key.length + 1)).split(',').map((t) => t.trim()).filter(Boolean);
    assert.ok(tokens('tools').length && !tokens('tools').some((t) => t.startsWith('mcp__')), `the tools list names no server:\n${front}`);
    assert.deepStrictEqual(tokens('disallowedTools'), [], 'no removals');
    assert.ok(steps[0].preloaded, 'the preloaded skill is not installed as a copy');
    const touched = Object.keys(steps[0].mtimes).filter((f) => steps[1].mtimes[f] !== steps[0].mtimes[f]);
    assert.deepStrictEqual(touched, [], `a re-run rewrote unchanged copies:\n${outs[1]}`);
});

// 2.1.0: every seat rides the core and every skill is a copy - a fresh selection copies its skills,
// copies no seat, and denies each seat it did not pick, so a seat whose preloads were not copied never
// reaches a dispatch; the stamp records how the seats came (`seats-route: plugin`).
test('seed install (plugin route): the skills are copied, no seat is, and every seat the selection did not pick is denied', POSIX_ONLY, () =>
{
    const { computeClosure } = require('./stack-select.js');
    const graph = require('../meta/stack-graph.json');
    const closed = computeClosure(graph, { skills: ['markdown-style'], rules: ['markdown-docs'], agents: ['angular-test-resolver'] });
    const selection = [...closed.skills.map((x) => `skill ${x}`), ...closed.rules.map((x) => `rule ${x}`), ...closed.agents.map((x) => `agent ${x}`)].join('\n') + '\n';
    const { result } = seedRun('install', selection, {
        inspect: (repo) => ({
            skills: fs.readdirSync(path.join(repo, '.claude', 'skills')).sort(),
            agents: fs.existsSync(path.join(repo, '.claude', 'agents')) ? fs.readdirSync(path.join(repo, '.claude', 'agents')) : [],
            deny: JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).permissions.deny,
            stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
        }),
    });
    assert.deepStrictEqual(result.skills, [...closed.skills].sort(), 'every picked skill, the seat\'s preloads included, is a copy');
    assert.deepStrictEqual(result.agents, [], 'no seat is copied - the core carries them');
    const seats = Object.keys(graph.agents);
    const denied = result.deny.filter((d) => d.startsWith('Agent('));
    assert.deepStrictEqual(denied.sort(), seats.filter((a) => a !== 'angular-test-resolver').map((a) => `Agent(alfred-code:${a})`).sort(), 'a deny per seat not picked, none for the one picked');
    assert.match(result.stamp, /^seats-route: plugin$/m);
    assert.match(result.stamp, /^picked-agents: angular-test-resolver@alfred-code$/m);
    assert.match(result.stamp, /^picked-skills: (?!.*@)/m, 'a skill has no plugin home - plain names');
    assert.match(result.stamp, /^library-agents: $/m);
});

// --- R10 THE LEDGER -----------------------------------------------------------------------------
// The .mcp.json entries a run MANAGES: registered by it now, recorded by the last run and unchanged
// since, or - no ledger yet - of a stack name and the stack's own shape. Uninstall removes exactly those.
const { entryHash } = require('./install/stamp.js');

test('mcp ledger: managed is what the run wrote, what the ledger recorded unchanged, or the stack\'s shape with no ledger (R10)', () =>
{
    const serena = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent@1.7.0', 'serena'] };
    const mine = { type: 'stdio', command: 'node', args: ['mine.js'] };
    const edited = { type: 'stdio', command: 'uvx', args: ['--from', 'serena-agent@9', 'serena'] };
    const servers = { 'alfred-navigation': serena, mine, 'alfred-memory': edited };
    const adopt = (name) => name !== 'mine';
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: null, written: [], adopt }), { 'alfred-navigation': entryHash(serena), 'alfred-memory': entryHash(edited) }, 'no ledger: the stack-shaped names are adopted');
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: { 'alfred-navigation': entryHash(serena), 'alfred-memory': entryHash({ other: 1 }) }, written: [], adopt }),
        { 'alfred-navigation': entryHash(serena) }, 'a ledger: recorded and unchanged only - an edited entry is the user\'s');
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: {}, written: ['alfred-memory'], adopt }), { 'alfred-memory': entryHash(edited) }, 'registered this run');
    assert.strictEqual(entryHash({ a: 1, b: [2, { d: 1, c: 2 }] }), entryHash({ b: [2, { c: 2, d: 1 }], a: 1 }), 'key order never changes the hash');
});

test('mcp ledger: removeManaged takes a recorded unchanged entry, keeps an edited or unlisted one, and the file goes only when nothing is left (R10)', () =>
{
    const serena = { command: 'uvx', args: ['serena'] };
    const file = mcpFile({ 'alfred-navigation': serena, 'alfred-memory': { command: 'uvx', args: ['memory', 'edited'] }, mine: { command: 'node', args: ['mine.js'] } });
    const logs = [];
    const out = mcp.removeManagedMcp({ mcpFile: file, managed: { 'alfred-navigation': entryHash(serena), 'alfred-memory': entryHash({ command: 'uvx', args: ['alfred-memory'] }) }, log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.removed, ['alfred-navigation']);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers).sort(), ['alfred-memory', 'mine']);
    assert.match(logs.join('\n'), /mcp alfred-memory: kept - changed since the stack registered it, so it is yours/);
    const only = mcpFile({ 'alfred-navigation': serena });
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: only, managed: { 'alfred-navigation': entryHash(serena) } }).removed, ['alfred-navigation']);
    assert.ok(!fs.existsSync(only), 'a .mcp.json holding nothing but the stack\'s entries goes with them');
    const garbage = path.join(TMP, `garbage-${Date.now()}.json`);
    fs.writeFileSync(garbage, '{nope');
    const notes = [];
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: garbage, managed: { 'alfred-navigation': 'x' }, note: (m) => notes.push(m) }).removed, []);
    assert.strictEqual(fs.readFileSync(garbage, 'utf8'), '{nope', 'an unreadable file is left untouched');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0], /not valid JSON/);
    // Re-verify 3 S9: one that cannot be read at all says so by its code.
    const folder = path.join(TMP, `folder-${Date.now()}.json`);
    fs.mkdirSync(folder);
    const said = [];
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: folder, managed: { 'alfred-navigation': 'x' }, note: (m) => said.push(m) }).removed, []);
    assert.match(said.join('\n'), /^\.mcp\.json could not be read \(EISDIR\) - left untouched/);
});

// --- the 2.0.0 rename (navigation, documentation, browser) ----------------------------------------
// An older install names the servers serena, context7 and playwright-<engine> (2.3.x: browser-<engine>). The
// manifest's `renamed.mcps` is the one table, each engine's old names a row of their own.
const RENAMED = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).renamed.mcps;

test('rename: an old MCP name reads as its new one, an engine by its own row, anything else as it is', () =>
{
    assert.deepStrictEqual(RENAMED, { serena: 'alfred-navigation', context7: 'alfred-documentation', playwright: 'browser',
        navigation: 'alfred-navigation', documentation: 'alfred-documentation', memory: 'alfred-memory',
        'windows-desktop': 'windows-control', 'macos-desktop': 'macos-control',
        ...Object.fromEntries(mcp.PW_ENGINES.flatMap((e) => [[`playwright-${e}`, `${e}-control`], [`browser-${e}`, `${e}-control`]])) },
        'each old name maps straight to today\'s');
    const cur = (n) => mcp.currentMcp(n, RENAMED);
    assert.strictEqual(cur('serena'), 'alfred-navigation');
    assert.strictEqual(cur('context7'), 'alfred-documentation');
    assert.strictEqual(cur('playwright'), 'browser');
    assert.strictEqual(cur('playwright-firefox'), 'firefox-control');
    for (const e of mcp.PW_ENGINES) assert.strictEqual(cur(`browser-${e}`), `${e}-control`, `${e}: the engines' 2026-10-13 names`);
    for (const role of ['navigation', 'documentation', 'memory']) assert.strictEqual(cur(role), `alfred-${role}`, role);
    for (const os of ['windows', 'macos']) assert.strictEqual(cur(`${os}-desktop`), `${os}-control`, `${os}: the desktop servers' 2026-10-13 names`);
    for (const same of ['alfred-navigation', 'chrome-control', 'alfred-memory', 'context7-local', 'playwright-extra', 'browser-extra', 'mine'])
        assert.strictEqual(cur(same), same, same);
    assert.deepStrictEqual(mcp.renamedFrom(RENAMED).sort(), ['browser-chrome', 'browser-firefox', 'browser-msedge', 'browser-webkit', 'context7', 'documentation', 'macos-desktop', 'memory', 'navigation',
        'playwright-chrome', 'playwright-firefox', 'playwright-msedge', 'playwright-webkit', 'serena', 'windows-desktop'],
        'the plugin and server names an older install can hold - the bare 1.x `playwright` is its own legacy name, not one of these');
    assert.deepStrictEqual(mcp.renamedFrom({}), []);
});

test('rename: every old name is retired beside the authored ones, each once', () =>
{
    const legacy = mcp.renamedFrom(RENAMED);
    const retired = mcp.retiredMcps({ authored: ['old-server', legacy[0]], legacy });
    for (const name of legacy) assert.ok(retired.includes(name), `${name} not retired: ${retired.join(',')}`);
    assert.strictEqual(retired.filter((n) => n === legacy[0]).length, 1, 'a name both authored and legacy is listed once');
    assert.deepStrictEqual(mcp.retiredMcps({ authored: ['old-server'] }), ['old-server'], 'no legacy list, no change');
});

test('rename: an old name is the stack\'s by its successor\'s shape - the package it launches or the url it calls', () =>
{
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    const ids = mcp.stackIdentities({ retiredRows: rows, renamed: RENAMED });
    assert.ok(ids.serena.has('stdio:serena-agent'), [...(ids.serena || [])].join(','));
    assert.deepStrictEqual([...ids.context7].sort(), ['http:https://mcp.context7.com/mcp', 'stdio:@upstash/context7-mcp']);
    for (const e of mcp.PW_ENGINES) for (const old of [`playwright-${e}`, `browser-${e}`]) assert.ok(ids[old].has('stdio:@playwright/mcp'), old);
    // A registration the user made under an old name, of another server, is not the stack's.
    assert.ok(!ids.serena.has(mcp.identityOf({ command: 'node', args: ['my-serena.js'] })));
});

// The copy route over an install made before the 2.0.0 rename: its .mcp.json registers the servers
// under their old names, and enabledMcpjsonServers / disabledMcpjsonServers name them. Each old
// registration of the stack's own shape goes and its successor is registered; the approval lists
// follow; the user's own server under an old name, and under a name of their own, are kept.
// Re-verify 3 follow-up: on the copy route at project scope an update re-registers every server - `claude mcp remove`,
// then `add`, which appends the name - so the first update after an install rewrote the tracked .mcp.json in a new key
// order with the same content. A run keeps the file's own order (a new entry last) and, when the content is what it
// was, its exact bytes.
test('keepMcpOrder: the file keeps its key order and formatting, a new entry goes last, and unchanged content keeps its bytes', () =>
{
    const file = path.join(TMP, 'order', '.mcp.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = { mcpServers: { a: { command: 'x', env: { K: '1' }, args: ['1'] }, mine: { command: 'm' }, b: { command: 'y' } }, other: true };
    const raw = `${JSON.stringify(before, null, 4)}\n`;
    fs.writeFileSync(file, raw);
    const snap = mcp.snapshotMcp(file);
    // The CLI's remove + add moved every name to the end, in its own formatting, and one entry is new.
    fs.writeFileSync(file, `${JSON.stringify({ other: true, mcpServers: { mine: { command: 'm' }, b: { command: 'y' }, a: { command: 'x', args: ['2'], env: { K: '1' } }, c: { command: 'z' } } }, null, 2)}\n`);
    assert.strictEqual(mcp.keepMcpOrder({ mcpFile: file, before: snap }), 'reordered');
    const got = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(Object.keys(JSON.parse(got)), ['mcpServers', 'other']);
    assert.deepStrictEqual(Object.keys(JSON.parse(got).mcpServers), ['a', 'mine', 'b', 'c'], 'a new entry goes last');
    assert.deepStrictEqual(Object.keys(JSON.parse(got).mcpServers.a), ['command', 'env', 'args'], 'an entry keeps its own key order');
    assert.deepStrictEqual(JSON.parse(got).mcpServers.a.args, ['2'], 'the new content is kept');
    assert.match(got, /^\{\n {4}"mcpServers"/, 'the file keeps its own indent');
    // The same content as before, reordered and reformatted: the original bytes come back.
    fs.writeFileSync(file, raw);
    const again = mcp.snapshotMcp(file);
    fs.writeFileSync(file, JSON.stringify({ other: true, mcpServers: { b: { command: 'y' }, mine: { command: 'm' }, a: { args: ['1'], env: { K: '1' }, command: 'x' } } }));
    assert.strictEqual(mcp.keepMcpOrder({ mcpFile: file, before: again }), 'restored');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), raw);
    // Nothing to keep: no file before, or one that is not JSON now.
    assert.strictEqual(mcp.keepMcpOrder({ mcpFile: file, before: null }), 'none');
    fs.writeFileSync(file, '{ nope');
    assert.strictEqual(mcp.keepMcpOrder({ mcpFile: file, before: again }), 'none');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ nope');
});

// Re-verify 4 T4 (crlfNew, bomYes, bomNo, crlfCli): the installer loads stack-select.js for its closure, and that module
// replaced the process-wide fs.readFileSync with one turning CRLF into LF - so the snapshot of a CRLF file had no CR, and a
// CRLF .mcp.json came back LF. The indent pattern missed a file starting with a BOM, and the CLI's `mcp add` / `remove`
// drop every top-level key but mcpServers, which the order pass never put back. 24 variants - line ends, a BOM, the indent,
// unchanged or changed content - each holding two top-level keys of the user's own around mcpServers, with stack-select.js
// loaded first, as in the installer.
test('keepMcpOrder: a CRLF or BOM file keeps its line ends, BOM and indent, and the top-level keys the CLI dropped come back in place - with stack-select.js loaded first (re-verify 4 T4)', () =>
{
    require('./stack-select.js');
    const dir = path.join(TMP, 'order-t4');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const eol of ['\n', '\r\n'])
        for (const bom of ['', '\uFEFF'])
            for (const indent of [2, 4, '\t'])
                for (const changed of [false, true])
                {
                    n += 1;
                    const file = path.join(dir, `${n}.mcp.json`);
                    const before = { '//': 'the team\'s note', mcpServers: { a: { command: 'x', args: ['1'] }, mine: { command: 'm' } }, '//2': { keep: true } };
                    const raw = `${bom}${JSON.stringify(before, null, indent).replace(/\n/g, eol)}${eol}`;
                    fs.writeFileSync(file, raw);
                    const snap = mcp.snapshotMcp(file);
                    // What the claude CLI writes back: mcpServers alone, LF, two spaces, no BOM, the names it touched moved last.
                    const servers = changed ? { mine: { command: 'm' }, a: { command: 'x', args: ['2'] } } : { mine: { command: 'm' }, a: { command: 'x', args: ['1'] } };
                    fs.writeFileSync(file, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
                    const said = `${JSON.stringify(eol)} bom=${Boolean(bom)} indent=${JSON.stringify(indent)} changed=${changed}`;
                    assert.strictEqual(mcp.keepMcpOrder({ mcpFile: file, before: snap }), changed ? 'reordered' : 'restored', said);
                    const got = fs.readFileSync(file).toString('utf8');
                    if (!changed) { assert.strictEqual(got, raw, `${said}: the bytes it had`); continue; }
                    const want = { ...before, mcpServers: { a: { command: 'x', args: ['2'] }, mine: { command: 'm' } } };
                    assert.strictEqual(got, `${bom}${JSON.stringify(want, null, indent).replace(/\n/g, eol)}${eol}`, said);
                }
    assert.strictEqual(n, 24);
});

// The prune takes the stack's row out of a tracked .mcp.json and gives the rest back as the file had it: the user's entries
// in their order, the indent, CRLF line ends and a top-level key the CLI drops - and a re-run leaves the bytes alone (a BOM is
// keepMcpOrder's own case above: the CLI stub here parses the file bare).
test('seed update (project scope): pruning the stack\'s row keeps the user\'s entries, their order and the file\'s formatting; a re-run keeps its bytes', POSIX_ONLY, () =>
{
    const bytes = (repo) => fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8');
    const own = (cmd) => ({ type: 'stdio', command: cmd, args: [], env: {} });
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')), tools: { claude: MCPJSON_CLI }, args: ['--installed-only', '--scope', 'project'],
        prepare: (repo) =>
        {
            pwProject(repo);
            const data = { note: 'team servers', mcpServers: { zeta: own('zeta-server'), 'alfred-navigation': shippedRow('alfred-navigation'), alpha: own('alpha-server') } };
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify(data, null, '\t').replace(/\n/g, '\r\n')}\r\n`);
        },
        each: (repo) => bytes(repo),
    });
    const want = `${JSON.stringify({ note: 'team servers', mcpServers: { zeta: own('zeta-server'), alpha: own('alpha-server') } }, null, '\t').replace(/\n/g, '\r\n')}\r\n`;
    assert.strictEqual(steps[0], want, `the prune reshaped the file:\n${outs[0]}`);
    assert.match(outs[0], /mcp pruned: alfred-navigation\n/, outs[0]);
    assert.strictEqual(steps[1], steps[0], `the re-run rewrote .mcp.json:\n${outs[1]}`);
});
