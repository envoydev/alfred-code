'use strict';
// THE MCP LAYER OF THE NODE SEED - Phase 7, T3.
//
// The twin sandbox tests in mcp-verify.test.js stay: the shell twins are still the DEFAULT route
// until T5 flips it, and they ship for one release after that (R1). These pin the same behaviours
// on the module that replaces them - including R7's four, whose intent carries over unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mcp = require('./install/mcp.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-mcp-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ROUTES = (over = {}) => ({ hooks: true, skills: true, mcps: true, ...over });
const COPY = ROUTES({ hooks: false, skills: false, mcps: false });
const CATALOG = ['serena|-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena', 'context7|@HTTP@',
    'memory|@HTTP@', 'playwright|-- npx -y @playwright/mcp@1.0'];

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

test('register-spec: a hosted server registers http with its header, and an EMPTY header registers none', () =>
{
    const remotes = { context7: mcp.CONTEXT7_REMOTE };
    assert.deepStrictEqual(mcp.registerSpec({ name: 'context7', args: '@HTTP@', scope: 'project', remotes }),
        ['mcp', 'add', '--transport', 'http', '--scope', 'project', 'context7',
            'https://mcp.context7.com/mcp', '--header', 'CONTEXT7_API_KEY: ${CONTEXT7_API_KEY:-}']);
    // A remote with no header: no --header at all, so its browser consent flow stays on.
    const oauth = mcp.registerSpec({ name: 'context7', args: '@HTTP@', scope: 'project', remotes: { context7: { url: 'https://x/mcp/a', header: '' } } });
    assert.ok(!oauth.includes('--header'), oauth.join(' '));
});

// --- R7: the locked three ------------------------------------------------

test('R7: on the plugin route the seed registers NOTHING and retires the whole catalog', () =>
{
    const retired = mcp.retiredMcps({ routes: ROUTES(), catalog: CATALOG, authored: ['old-server'] });
    for (const name of ['serena', 'context7', 'memory', 'playwright', 'old-server'])
        assert.ok(retired.includes(name), `${name} was not retired: ${retired.join(',')}`);
    // The four engine spellings an earlier release wrote are retired by name - they are not catalog rows.
    for (const e of mcp.PW_ENGINES) assert.ok(retired.includes(`playwright-${e}`), retired.join(','));
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes: ROUTES(), mcps: CATALOG }), []);
});

test('R7: the MCP route OFF but the core still on - the locked three stay plugin-carried, the picks come back', () =>
{
    // The middle case, and the one the matrix caught: hooks or skills on means the core entry is
    // enabled, and its `dependencies` already carry serena, context7 and memory.
    const routes = ROUTES({ mcps: false });
    const retired = mcp.retiredMcps({ routes, catalog: CATALOG, authored: [] });
    assert.deepStrictEqual(retired.sort(), [...mcp.LOCKED].sort());
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes, mcps: CATALOG }), ['playwright']);
});

test('R7: on the FULL copy route the core is never enabled, so all three come back to .mcp.json', () =>
{
    assert.deepStrictEqual(mcp.retiredMcps({ routes: COPY, catalog: CATALOG, authored: ['old-server'] }), ['old-server']);
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes: COPY, mcps: CATALOG }),
        ['serena', 'context7', 'memory', 'playwright']);
});

test('R7: a locked server installed as a plugin has no shape to verify', () =>
{
    // Writing the shape back would put the entry the prune just removed straight back in the file.
    const routes = ROUTES({ mcps: false });
    const expects = CATALOG
        .map((e) => ({ name: e.split('|')[0], args: e.split('|')[1] }))
        .filter((e) => !(mcp.isLocked(e.name) && mcp.corePluginOn(routes)))
        .map((e) => e.name);
    assert.deepStrictEqual(expects, ['playwright']);
});

// --- the project-scope verify pass ---------------------------------------

test('verify-project: a stale registration the CLI silently refused to rewrite is repaired', () =>
{
    const file = mcpFile({ serena: { type: 'stdio', command: 'uvx', args: ['--from', 'serena@0.0.1', 'serena'], env: {} } });
    const logs = [];
    const out = mcp.verifyProject({
        mcpFile: file,
        expects: [mcp.expectShape({ name: 'serena', args: '-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena' })],
        log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out.repaired, ['serena']);
    const written = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.serena;
    assert.deepStrictEqual(written, { type: 'stdio', command: 'uvx', args: ['--from', 'serena@1.0', 'serena'], env: { SERENA_HOME: '.serena/home' } });
    assert.ok(logs.some((m) => /mcp repaired: serena \(was stdio uvx --from serena@0\.0\.1/.test(m)), logs.join(' | '));
});

test('verify-project: an entry already in the manifest shape is left BYTE-IDENTICAL', () =>
{
    const expect = mcp.expectShape({ name: 'context7', args: '@HTTP@', remotes: { context7: { url: 'https://mcp.context7.com/mcp', header: 'CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}' } } });
    // Written with the PROJECT's own formatting, not ours: a no-op that rewrote the file would
    // reformat it, and every release would land as a diff in a repo that commits this file.
    const file = mcpFile();
    fs.writeFileSync(file, `${JSON.stringify({ mcpServers: { context7: mcp.wantFor(expect) } }, null, 4)}\n`);
    const before = fs.readFileSync(file);
    const out = mcp.verifyProject({ mcpFile: file, expects: [expect] });
    assert.deepStrictEqual(out.repaired, []);
    assert.ok(fs.readFileSync(file).equals(before), 'a no-op verify rewrote the file - every release would look like a diff');
});

test('verify-project: a server the project added by hand is never read, compared or written', () =>
{
    const mine = { type: 'stdio', command: 'node', args: ['x.js'] };
    const file = mcpFile({ 'my-own-server': mine, serena: { type: 'stdio', command: 'old' } });
    mcp.verifyProject({ mcpFile: file, expects: [mcp.expectShape({ name: 'serena', args: '-- uvx serena' })] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['my-own-server'], mine);
});

test('verify-project: malformed or unreadable input is REPORTED and changes nothing', () =>
{
    const bad = mcpFile('{ not json');
    const logs = [];
    const out = mcp.verifyProject({ mcpFile: bad, expects: [mcp.expectShape({ name: 'serena', args: '-- uvx serena' })], log: (m) => logs.push(m) });
    assert.strictEqual(out.read, false);
    assert.deepStrictEqual(out.repaired, []);
    assert.strictEqual(fs.readFileSync(bad, 'utf8'), '{ not json', 'an unparseable file was overwritten');
    assert.ok(logs.some((m) => /not valid JSON/.test(m)), logs.join(' | '));
});

test('verify-project: an absent file is written from scratch, BOM and all handled', () =>
{
    const missing = path.join(TMP, 'none', 'mcp.json');
    fs.mkdirSync(path.dirname(missing), { recursive: true });
    const out = mcp.verifyProject({ mcpFile: missing, expects: [mcp.expectShape({ name: 'serena', args: '-- uvx serena' })] });
    assert.deepStrictEqual(out.repaired, ['serena']);
    const bom = mcpFile();
    fs.writeFileSync(bom, `\uFEFF${JSON.stringify({ mcpServers: { serena: { type: 'stdio', command: 'uvx', args: ['serena'], env: {} } } })}`);
    assert.deepStrictEqual(mcp.verifyProject({ mcpFile: bom, expects: [mcp.expectShape({ name: 'serena', args: '-- uvx serena' })] }).repaired, []);
});

// --- the user-scope verify pass ------------------------------------------

test('verify-user: a ${VAR:-default} argument printed as ${VAR} by `mcp get` is NOT drift', () =>
{
    // As printed, every playwright server read as drifted on every global run and failed it.
    const expect = mcp.expectShape({ name: 'playwright', args: '-- npx -y @playwright/mcp@1.0 --browser chrome --user-data-dir ${PW_DIR:-/tmp/pw}' });
    const out = mcp.verifyUser({
        expects: [expect], scope: 'user',
        getShape: () => 'Type: stdio\n  Command: npx\n  Args: -y @playwright/mcp@1.0 --browser chrome --user-data-dir ${PW_DIR}\n',
        reregister: () => assert.fail('a normalised match was treated as drift'),
    });
    assert.deepStrictEqual(out.repaired, []);
});

test('verify-user: a drifted registration is re-registered through the CLI and confirmed', () =>
{
    const expect = mcp.expectShape({ name: 'serena', args: '-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena' });
    let fixed = false;
    const out = mcp.verifyUser({
        expects: [expect], scope: 'user',
        getShape: () => (fixed ? 'Type: stdio\n Command: uvx\n Args: --from serena@1.0 serena\n' : 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n'),
        reregister: () => { fixed = true; },
    });
    assert.deepStrictEqual(out.repaired, ['serena']);
});

test('verify-user: a registration the retry cannot fix is REPORTED, never silently accepted', () =>
{
    const notes = [];
    const out = mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'serena', args: '-- uvx --from serena@1.0 serena' })], scope: 'user',
        getShape: () => 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n',
        reregister: () => {}, note: (m) => notes.push(m),
    });
    assert.deepStrictEqual(out.repaired, []);
    assert.ok(notes.some((m) => /could not be brought to the current shape/.test(m)), notes.join(' | '));
});

test('verify-user: a server the account config does not expose is skipped, not re-registered', () =>
{
    mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'serena', args: '-- uvx serena' })], scope: 'user',
        getShape: () => '', reregister: () => assert.fail('an unreadable `mcp get` was treated as drift'),
    });
});

// --- playwright and the tool-name down-convert ---------------------------

test('playwright: the engines this run does not keep are dropped, and the plugin route drops none', () =>
{
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: COPY, browsers: ['chrome'] }),
        ['playwright', 'playwright-msedge', 'playwright-firefox', 'playwright-webkit']);
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: ROUTES(), browsers: ['chrome'] }), []);
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: COPY, browsers: [] }), []);
});

test('down-convert: only the servers this run registered BARE are re-spelled', () =>
{
    // The locked three are plugins beside the core on a hooks-only copy route, so their tool names must
    // keep the plugin spelling while the droppable picks are re-spelled.
    const root = path.join(TMP, `dc-${seq++}`);
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a.md'), 'use mcp__plugin_sentry_sentry__find_issues and mcp__plugin_serena_serena__find_symbol\n');
    fs.writeFileSync(path.join(root, 'sub', 'b.yml'), 'mcp__plugin_sentry_sentry__find_issues\n');
    const logs = [];
    const n = mcp.downconvertToolNames({ roots: [root], bare: ['sentry'], log: (m) => logs.push(m) });
    assert.strictEqual(n, 1);
    // The expected bare spelling is BUILT, never typed: lint check 54 bans the literal everywhere
    // under scripts/, and the down-converter itself builds it the same way.
    const bareTool = (server, tool) => `mcp__${server}__${tool}`;
    assert.strictEqual(fs.readFileSync(path.join(root, 'a.md'), 'utf8'),
        `use ${bareTool('sentry', 'find_issues')} and mcp__plugin_serena_serena__find_symbol\n`);
    assert.match(fs.readFileSync(path.join(root, 'sub', 'b.yml'), 'utf8'), /mcp__plugin_sentry_sentry__/, 'a .yml is not a target extension');
    assert.ok(logs.some((m) => /re-spelled .* in 1 file/.test(m)), logs.join(' | '));
});

test('down-convert: an empty bare list touches nothing', () =>
{
    const root = path.join(TMP, `dc-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.md'), 'mcp__plugin_sentry_sentry__x\n');
    assert.strictEqual(mcp.downconvertToolNames({ roots: [root], bare: [] }), 0);
    assert.match(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), /mcp__plugin_sentry_sentry__x/);
});

// --- the playwright expansion --------------------------------------------

test('playwright: the one manifest row becomes one entry per kept engine, each with its own profile', () =>
{
    const row = 'playwright|-- npx -y @playwright/mcp@0.0.80 --user-data-dir .playwright';
    const out = mcp.expandPlaywright({ mcps: ['serena|-- uvx serena', row], browsers: ['chrome', 'firefox'] });
    assert.deepStrictEqual(out.mcps, [
        'serena|-- uvx serena',
        'playwright-chrome|-- npx -y @playwright/mcp@0.0.80 --browser chrome --user-data-dir .playwright/chrome',
        'playwright-firefox|-- npx -y @playwright/mcp@0.0.80 --browser firefox --user-data-dir .playwright/firefox',
    ]);
});

test('playwright: with no flag the kept set is what is REGISTERED, else chrome', () =>
{
    assert.deepStrictEqual(mcp.playwrightKept({ registered: ['webkit', 'chrome'] }), ['chrome', 'webkit']);
    // The caller unions the stamp's engines into `registered` - an installed engine the user left
    // disabled is still kept.
    assert.deepStrictEqual(mcp.playwrightKept({ registered: ['msedge'] }), ['msedge']);
    assert.deepStrictEqual(mcp.playwrightKept({}), ['chrome']);
    // An explicit set always wins over what is on the machine.
    assert.deepStrictEqual(mcp.playwrightKept({ browsers: ['firefox'], registered: ['chrome'] }), ['firefox']);
});

// --- which engines are ENABLED (R67) -----------------------------------------
// Two choices, both the user's: the engines to install, and which of those to enable. The flag is the
// user's answer; with no answer, an engine keeps the choice the stamp recorded for it, and one it
// recorded nothing for - a new engine, a stamp from before the line - is enabled.

test('playwright enabled: no flag and no record - every kept engine is enabled, and nothing is applied', () =>
{
    const r = mcp.playwrightEnabled({ kept: ['chrome', 'firefox'], flag: null, prior: { browsers: null, enabled: null } });
    assert.deepStrictEqual(r, { enabled: ['chrome', 'firefox'], off: [], apply: false, outside: [] });
    // A stamp that names the engines but predates the enabled line recorded no choice either.
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: ['chrome', 'firefox'], flag: null, prior: { browsers: ['chrome', 'firefox'], enabled: null } }).off, []);
});

test('playwright enabled: no flag - a recorded engine keeps its last choice, a new one is enabled', () =>
{
    const r = mcp.playwrightEnabled({ kept: ['chrome', 'firefox', 'webkit'], flag: null, prior: { browsers: ['chrome', 'firefox'], enabled: ['chrome'] } });
    assert.deepStrictEqual(r, { enabled: ['chrome', 'webkit'], off: ['firefox'], apply: false, outside: [] });
});

test('playwright enabled: the flag is the answer - all, none or a set, always applied; an engine outside the kept set is named', () =>
{
    const prior = { browsers: ['chrome', 'firefox'], enabled: ['chrome'] };
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: ['chrome', 'firefox'], flag: 'all', prior }), { enabled: ['chrome', 'firefox'], off: [], apply: true, outside: [] });
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: ['chrome', 'firefox'], flag: [], prior }), { enabled: [], off: ['chrome', 'firefox'], apply: true, outside: [] });
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: ['chrome', 'firefox'], flag: ['firefox'], prior }), { enabled: ['firefox'], off: ['chrome'], apply: true, outside: [] });
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: ['chrome'], flag: ['chrome', 'webkit'], prior }).outside, ['webkit']);
    // No engine kept (a selection without playwright): nothing to enable, and all or none is no error.
    assert.deepStrictEqual(mcp.playwrightEnabled({ kept: [], flag: 'all', prior }), { enabled: [], off: [], apply: true, outside: [] });
});

// Round 2: configure pre-selects the enable question from the LIVE state - the install scope's
// settings file, which a /plugin toggle writes - so an unchanged answer switches nothing. The stamp's
// last answer only speaks for an engine that file does not name.
test('playwright live: the enabled set is the settings file\'s word, the stamp only where it says nothing', () =>
{
    const prior = { browsers: ['chrome', 'firefox'], enabled: ['chrome', 'firefox'] };
    const live = (e) => ({ chrome: true, firefox: false })[e];
    assert.deepStrictEqual(mcp.playwrightLive({ kept: ['chrome', 'firefox', 'webkit'], prior, live }),
        { installed: ['chrome', 'firefox', 'webkit'], enabled: ['chrome', 'webkit'] }, 'the stamp re-enabled a /plugin switch-off, or a new engine read off');
    assert.deepStrictEqual(mcp.playwrightLive({ kept: ['chrome', 'firefox'], prior: { browsers: ['chrome', 'firefox'], enabled: ['chrome'] }, live: () => undefined }).enabled, ['chrome']);
    assert.deepStrictEqual(mcp.playwrightLive({ kept: [], prior, live }), { installed: [], enabled: [] });
});

test('playwright: a selection without playwright is left exactly as it is', () =>
{
    const mcps = ['serena|-- uvx serena'];
    const out = mcp.expandPlaywright({ mcps, browsers: ['chrome'] });
    assert.deepStrictEqual(out.mcps, mcps);
    assert.deepStrictEqual(out.browsers, []);
});

// --- the runtime pins -----------------------------------------------------

test('pins: the RELEASE pins from meta/mcp-pins.json - a package with no usable row installs unpinned, never aborts', () =>
{
    // R35: the seed asks no registry. The versions are the ones the release committed, the same the
    // generated plugin entries launch, so both routes and the browser download run one server version.
    const logs = [];
    const pins = mcp.resolvePins({
        pins: { playwright: { version: '0.0.80', spelling: '@<v>' }, serena: { version: null }, memory: { version: '1 2' } },
        log: (m) => logs.push(m),
    });
    assert.strictEqual(pins.PW_PIN, '@0.0.80');
    assert.strictEqual(pins.SERENA_PIN, '', 'a null version ships unpinned, as the generator does');
    assert.strictEqual(pins.MEMORY_PIN, '', 'a version no package manager can read is no pin');
    assert.ok(logs.some((m) => /pinned playwright@0\.0\.80 \(the release pin\)/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /no release pin for serena in this source - installing unpinned/.test(m)), logs.join(' | '));
    for (const garbage of [undefined, null, 'x', []])
        assert.strictEqual(mcp.resolvePins({ pins: garbage }).PW_PIN, '', `pins=${JSON.stringify(garbage)}`);
});

test('pins: each is spelled as its row says - memory ==<ver> inside the extras brackets, the others @<ver>', () =>
{
    // It sits INSIDE the extras brackets - `mcp-memory-service[sqlite]==<ver>` - where an @ would
    // not parse.
    const rel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins;
    const pins = mcp.resolvePins({ pins: rel });
    assert.strictEqual(pins.MEMORY_PIN, `==${rel.memory.version}`);
    assert.strictEqual(pins.SERENA_PIN, `@${rel.serena.version}`);
    assert.strictEqual(pins.PW_PIN, `@${rel.playwright.version}`);
    assert.strictEqual(pins.MEMORY_BACKEND, 'sqlite_vec');
});

// 2.0.0 cut the local npx transport (R32): the manifest ships context7 as the hosted remote row, which
// the copy route registers from `remotes.context7` - no placeholder left to resolve, and no second row.
test('context7 row: the manifest ships the hosted remote only', () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const manifest = loadManifest(path.join(__dirname, '..'));
    assert.deepStrictEqual(manifest.mcps.filter((e) => e.startsWith('context7')), ['context7|@HTTP@']);
    assert.ok(!manifest.rows.mcps.some((r) => r.variants), 'no transport variants left on any row');
});

test('context7 remote: the copy route registers the url and header the context7 plugin entry carries', () =>
{
    const entry = require('../.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'context7');
    const server = entry.mcpServers.context7;
    assert.strictEqual(mcp.CONTEXT7_REMOTE.url, server.url);
    const [key, ...value] = mcp.CONTEXT7_REMOTE.header.split(': ');
    assert.deepStrictEqual({ [key]: value.join(': ') }, server.headers, 'an empty header dropped the account key on the copy route');
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
const withStamp = (version) => (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), `source: test\nversion: ${version}\n`);
    fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: { 'angular-cli': { type: 'stdio', command: 'npx', args: ['-y', '@angular/cli', 'mcp'], env: {} } } }, null, 2)}\n`);
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['angular-cli', 'mine'] }, null, 2)}\n`);
};

// The account's own MCP registrations: `<CLAUDE_CONFIG_DIR>/.claude.json` - top-level `mcpServers` at
// user scope, `projects[<root>].mcpServers` at local scope. The sandbox's account dir is `<work>/acct`.
const accountMcp = (work, servers, projects = {}) =>
{
    fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
    fs.writeFileSync(path.join(work, 'acct', '.claude.json'), JSON.stringify({ mcpServers: servers, projects }, null, 2));
};
const STACK_SERENA = { type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--from', 'serena-agent@1.6.0', 'serena', 'start-mcp-server', '--project-from-cwd'], env: {} };
const STACK_PW = (e) => ({ type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.80', '--browser', e], env: {} });

for (const [route, env] of [['plugin', {}], ['copy', COPY_ENV]])
{
    test(`seed update (${route} route): a 1.x install's cut registration goes with its add-back line, and leaves the trust list`, POSIX_ONLY, () =>
    {
        const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
            env, prepare: withStamp('1.3.0'),
            inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).enabledMcpjsonServers,
        });
        // A-M3: only the registration .mcp.json holds is removed - an absent name costs no call.
        const removes = calls.filter((c) => /^mcp remove (angular-cli|chrome-devtools|appium-mcp|sentry|context7-local) /.test(c));
        assert.deepStrictEqual(removes, ['mcp remove angular-cli -s project'], `${calls.filter((c) => /^mcp /.test(c)).join('\n')}`);
        assert.match(out, /mcp pruned: angular-cli\n==>     add it back: claude mcp add --scope project angular-cli -- npx -y @angular\/cli mcp\n/);
        assert.ok(!result.includes('angular-cli') && result.includes('mine'), JSON.stringify(result));
    });

    test(`seed update (${route} route): past the retirement a registration under a cut name is the user's - never removed`, POSIX_ONLY, () =>
    {
        const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
            env, prepare: withStamp('2.0.0'),
            inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).enabledMcpjsonServers,
        });
        for (const name of ['angular-cli', 'chrome-devtools', 'appium-mcp', 'sentry', 'context7-local'])
            assert.ok(!calls.includes(`mcp remove ${name} -s project`), `${name}:\n${calls.filter((c) => /^mcp /.test(c)).join('\n')}`);
        assert.ok(!/add it back/.test(out), out);
        assert.ok(result.includes('angular-cli'), JSON.stringify(result));
    });
}

// R83 a (Task 16b concern a): the locked three are every install's. On a plugin route `pluginSet` adds
// their plugins whatever the selection says; on the FULL copy route the registrations come from the
// live list alone, and a selection or read-back with no `mcp` line left it empty - so a plugin-route
// install switched to the copies registered none of them ('mcps=0', and the notes import skipped
// 'the memory MCP is not part of this install'). Reproduced at 7dd1249 and at v1.3.0 alike.
test('withLocked: every locked catalog entry the list lacks is added, once, and nothing else', () =>
{
    const logs = [];
    const out = mcp.withLocked({ mcps: [CATALOG[3], CATALOG[1]], catalog: CATALOG, log: (m) => logs.push(m) });
    assert.deepStrictEqual(out, [CATALOG[3], CATALOG[1], CATALOG[0], CATALOG[2]]);
    assert.strictEqual(logs.length, 2, logs.join('\n'));
    assert.match(logs.join('\n'), /mcp serena: locked/);
    assert.deepStrictEqual(mcp.withLocked({ mcps: out, catalog: CATALOG }), out, 'idempotent');
    assert.deepStrictEqual(mcp.withLocked({ mcps: [], catalog: [CATALOG[3]] }), [], 'a catalog without them adds nothing');
});

test('seed update --installed-only (full copy route): a plugin-route install whose selection named no server gets the locked three registered (R83 a)', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'serena', 'context7', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
    const { calls, out, result } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: listing,
        env: [{}, COPY_ENV],
        args: [[], ['--installed-only']],
        // Only the second run's CLI calls are this case's evidence.
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
        inspect: (repo) => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'),
    });
    const adds = calls.filter((c) => /^mcp add /.test(c));
    for (const name of mcp.LOCKED) assert.ok(adds.some((c) => c.split(' ').includes(name)), `${name} not registered:\n${adds.join('\n')}\n${out}`);
    assert.doesNotMatch(out, /mcps=0\b/);
    assert.doesNotMatch(out, /the memory MCP is not part of this install/);
    assert.match(result, /^installed-always-mcps: .*\bserena\b/m, result);
});

// M1 (Task 18b fix round 1): R91 on a FRESH install. The full copy route never enables the core, so
// the locked three ride no plugin there - the first install itself must register them in .mcp.json,
// whatever the selection names, and a re-run must leave the file as it was.
test('seed install (full copy route, fresh): a selection naming no server still lands the locked three in .mcp.json, and a re-run changes nothing (R91, M1)', POSIX_ONLY, () =>
{
    const { out, steps, result } = seedRun(['install', 'install'], 'skill markdown-style\n', {
        env: COPY_ENV,
        each: (repo) => fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'),
        inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')),
    });
    const servers = Object.keys(result.mcpServers || {});
    for (const name of mcp.LOCKED) assert.ok(servers.includes(name), `${name} missing from .mcp.json: ${servers.join(',')}\n${out}`);
    assert.deepStrictEqual(servers.filter((n) => !mcp.LOCKED.includes(n)), [], 'nothing but the locked three');
    assert.strictEqual(steps[1], steps[0], 'a re-run rewrote .mcp.json');
});

// R107 (Task 8a concern 1): the locked three come back to .mcp.json only on the FULL copy route,
// 'where the core is never enabled'. A plugin-route install switched to the copies kept the core and
// the three MCP plugins enabled beside the new registrations - serena and memory then ran twice (the
// two routes launch them differently, so Claude Code dedups neither) and the core's skills listed
// twice (measured in the Task 8 matrix, R22). The switch disables the stack's own rows first: the core
// and the locked three, only as `name@<stack key>` and only at the run's scope.
const STACK_ROWS = (key, over = {}) => ['alfred-code', 'serena', 'context7', 'memory']
    .map((n) => ({ id: `${n}@${key}`, version: '2.0.0', scope: 'project', enabled: true, ...(over[n] || {}) }));
const switchRun = (rows) => seedRun(['install', 'update'], 'skill markdown-style\n', {
    plugins: JSON.stringify(rows),
    env: [{}, COPY_ENV],
    args: [[], ['--installed-only']],
    // Only the second run's CLI calls are this case's evidence.
    each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
    inspect: (repo) => Object.keys(JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {}),
});

for (const key of ['envoydev', 'claude-stack']) // legacy-name
{
    test(`seed update (full copy route, key ${key}): a plugin-route install switched to the copies disables the core and the locked three before any registration (R107)`, POSIX_ONLY, () =>
    {
        const rows = [...STACK_ROWS(key),
            { id: 'context7@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
            { id: 'typescript-lsp@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true }];
        const { calls, out, result } = switchRun(rows);
        const disables = calls.filter((c) => /^plugin disable /.test(c));
        assert.deepStrictEqual([...disables].sort(), ['alfred-code', 'context7', 'memory', 'serena'].map((n) => `plugin disable ${n}@${key} --scope project`),
            `only the stack's own rows, at this scope:\n${disables.join('\n')}\n${out}`);
        const lastDisable = calls.map((c) => /^plugin disable /.test(c)).lastIndexOf(true);
        const firstAdd = calls.findIndex((c) => /^mcp add /.test(c));
        assert.ok(firstAdd > lastDisable, `a registration ran before the plugins were off:\n${calls.join('\n')}`);
        assert.match(out, new RegExp(`plugin disabled \\[project\\]: alfred-code@${key}`));
        for (const name of mcp.LOCKED) assert.ok(result.includes(name), `${name} missing from .mcp.json: ${result.join(',')}`);
    });
}

test('seed update (full copy route): a stack row already off is left alone, and one at another scope is named with its command, never disabled (R107)', POSIX_ONLY, () =>
{
    const rows = STACK_ROWS('envoydev', { 'alfred-code': { enabled: false }, serena: { enabled: false }, context7: { enabled: false }, memory: { scope: 'user' } });
    const { calls, out } = switchRun(rows);
    assert.deepStrictEqual(calls.filter((c) => /^plugin disable /.test(c)), [], `a re-run disables nothing:\n${calls.join('\n')}`);
    assert.match(out, /memory@envoydev is enabled at user scope, not this run's - .*claude plugin disable memory@envoydev --scope user/);
});

// R111 (Task 8a concern b): the stand-down named the 2.x core only. A 1.3.0 plugin-route install
// updated straight onto the full copy route never gets the 1.x move (it runs on the plugin route), so
// its 1.x ids - the old core and the old hooks id - stayed enabled at 1.3.0, and a session listed 21
// of the old core's items beside the copies (the R22c probe). They are DISABLED, never uninstalled: a
// later switch back to the plugin route finds the old core's row, and with it the key and scope, and
// runs the 1.x move from there (the switch-back test below).
const LEGACY_ROWS = (over = {}) => ['claude-stack', 'claude-stack-hooks', 'serena', 'context7', 'memory'] // legacy-name
    .map((n) => ({ id: `${n}@claude-stack`, version: '1.3.0', scope: 'project', enabled: true, ...(over[n] || {}) })); // legacy-name

test('seed update (full copy route): a 1.3.0 plugin-route install switched straight to the copies has its 1.x ids disabled too, under the stack key only (R111)', POSIX_ONLY, () =>
{
    const rows = [...LEGACY_ROWS(),
        { id: 'claude-stack-hooks@a-fork', version: '1.0.0', scope: 'project', enabled: true }, // legacy-name
        { id: 'memory@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true }];
    const { calls, out, result } = switchRun(rows);
    const disables = calls.filter((c) => /^plugin disable /.test(c));
    assert.deepStrictEqual([...disables].sort(), ['claude-stack', 'claude-stack-hooks', 'context7', 'memory', 'serena'] // legacy-name
        .map((n) => `plugin disable ${n}@claude-stack --scope project`).sort(), `the stack's own rows only:\n${disables.join('\n')}\n${out}`); // legacy-name
    assert.deepStrictEqual(calls.filter((c) => /^plugin (install|uninstall) (alfred-code|claude-stack)/.test(c)), [], 'disabled, never moved or removed on the copy route'); // legacy-name
    const lastDisable = calls.map((c) => /^plugin disable /.test(c)).lastIndexOf(true);
    assert.ok(calls.findIndex((c) => /^mcp add /.test(c)) > lastDisable, `a registration ran before the plugins were off:\n${calls.join('\n')}`);
    assert.match(out, /plugin disabled \[project\]: claude-stack@claude-stack \(a 1\.x id/); // legacy-name
    // 1.3.0 declares the old hooks id dependent on the old core, and the CLI refuses to disable a plugin an
    // enabled one depends on - measured on 2.1.282, the P111 proof: the dependent goes first.
    assert.ok(disables.indexOf('plugin disable claude-stack-hooks@claude-stack --scope project') < disables.indexOf('plugin disable claude-stack@claude-stack --scope project'), `the old core went before the id that depends on it:\n${disables.join('\n')}`); // legacy-name
    for (const name of mcp.LOCKED) assert.ok(result.includes(name), `${name} missing from .mcp.json: ${result.join(',')}`);
});

test('seed update (plugin route): a copy-route install whose 1.x ids were disabled switches back through the 1.x move (R111)', POSIX_ONLY, () =>
{
    const rows = LEGACY_ROWS({ 'claude-stack': { enabled: false }, 'claude-stack-hooks': { enabled: false }, serena: { enabled: false }, context7: { enabled: false }, memory: { enabled: false } }); // legacy-name
    const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(rows),
        env: [COPY_ENV, {}],
        args: [[], ['--installed-only']],
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
    });
    const moves = calls.filter((c) => /^plugin (install|uninstall|enable) /.test(c));
    const at = (line) => moves.indexOf(line);
    assert.ok(at('plugin install alfred-code@claude-stack --scope project -y') === 0, `the move installs the new core first:\n${moves.join('\n')}\n${out}`); // legacy-name
    assert.ok(at('plugin uninstall claude-stack-hooks@claude-stack --scope project -y') > 0, moves.join('\n')); // legacy-name
    assert.ok(at('plugin uninstall claude-stack@claude-stack --scope project -y') > at('plugin uninstall claude-stack-hooks@claude-stack --scope project -y'), moves.join('\n')); // legacy-name
    for (const name of mcp.LOCKED) assert.ok(moves.includes(`plugin enable ${name}@claude-stack --scope project`), `${name} was not switched back on:\n${moves.join('\n')}`); // legacy-name
});

// R116 matrix re-run: the full copy route disables a 2.x core (R107), and the plugin route never enabled
// the core for its flag - the listing's flag reads a running core as off (S22). So a switch back left
// the core off while the copies it replaces were pruned: the project ran no core at all.
// M9 (R132): the settings file cannot tell the stand-down's off from the user's own /plugin disable, so
// the STAMP records what the stand-down switched off (`stood-down:`, scope and spec), and a switch back
// enables exactly that - at the scope it was written - while the settings file there still says false.
const settingsWord = (repo, word, file = 'settings.json') =>
{
    const at = path.join(repo, '.claude', file);
    const data = jsonAt(repo, `.claude/${file}`);
    data.enabledPlugins = { ...(data.enabledPlugins || {}), ...word };
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, `${JSON.stringify(data, null, 2)}\n`);
};
const stoodDownLine = (repo) => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8').split('\n').find((l) => l.startsWith('stood-down:')) || null;
const STOOD = ['alfred-code', ...mcp.LOCKED];
const offWord = (names = STOOD) => Object.fromEntries(names.map((n) => [`${n}@envoydev`, false]));

test('seed update (plugin route): a switch back enables what the full copy route switched off - the stamp\'s record, never the flag (R116, M9)', POSIX_ONLY, () =>
{
    const run = (word) => seedRun(['install', 'update', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')),
        env: [{}, COPY_ENV, {}],
        args: [[], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), stood: stoodDownLine(repo) };
            // What the CLI's disable wrote (the recording stub writes nothing), or the stale case.
            if (i === 1) settingsWord(repo, word);
            return state;
        },
    });
    const off = run(offWord());
    const [, down, back] = off.steps;
    assert.strictEqual(down.stood, `stood-down: ${STOOD.map((n) => `project:${n}@envoydev`).join(',')}`, off.outs[1]);
    const enables = back.calls.filter((c) => /^plugin enable /.test(c));
    for (const name of STOOD) assert.ok(enables.includes(`plugin enable ${name}@envoydev --scope project`), `${name} stayed off:\n${enables.join('\n')}\n${off.outs[2]}`);
    assert.strictEqual(enables.length, STOOD.length, `an enable ran twice:\n${enables.join('\n')}`);
    assert.strictEqual(back.stood, null, 'the record outlived the switch back');
    const stale = run({ 'alfred-code@envoydev': true });
    assert.ok(!stale.steps[2].calls.includes('plugin enable alfred-code@envoydev --scope project'), `a core the settings name on was enabled:\n${stale.steps[2].calls.join('\n')}`);
});

test('seed update (plugin route): a core the USER switched off in this project stays off - no record, no enable (M9)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')),
        args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), stood: stoodDownLine(repo) };
            if (i === 0) settingsWord(repo, offWord(['alfred-code']));
            return state;
        },
    });
    assert.ok(!steps[1].calls.some((c) => /^plugin enable alfred-code@/.test(c)), `the user's own off was switched back on:\n${steps[1].calls.join('\n')}\n${outs[1]}`);
    assert.strictEqual(steps[1].stood, null);
});

// I2 (R132): at USER scope a row serves every project of the account, while the copies land in this
// project alone - so the stand-down switched the core and the locked three off for every project, and
// the guards a never-set-up repo keeps (R54) with them. Measured on 2.1.282: `claude plugin disable
// <spec> --scope project` over a user-scope install writes THIS project's enabledPlugins false, the
// plugin is off here, and a second project keeps it on. So the stand-down writes there and nowhere
// else, a re-run calls nothing, and the switch back enables it there.
const USER_ROWS = () => STACK_ROWS('envoydev', Object.fromEntries(STOOD.map((n) => [n, { scope: 'user' }])));
test('seed update --scope user (full copy route): the stand-down switches the user-scope rows off in THIS project only, a re-run calls nothing, and the switch back enables them there (I2, M9)', POSIX_ONLY, () =>
{
    // A rule copied here: at user scope an install with nothing on disk reads as no install of THIS project.
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(USER_ROWS()),
        env: [{}, COPY_ENV, COPY_ENV, {}],
        args: [['--scope', 'user'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), stood: stoodDownLine(repo), account: jsonAt(path.join(path.dirname(repo), 'acct'), 'settings.json').enabledPlugins };
            if (i === 1) settingsWord(repo, offWord());
            return state;
        },
    });
    const [, down, again, back] = steps;
    const disables = down.calls.filter((c) => /^plugin disable /.test(c));
    assert.deepStrictEqual([...disables].sort(), STOOD.map((n) => `plugin disable ${n}@envoydev --scope project`).sort(), `${disables.join('\n')}\n${outs[1]}`);
    assert.match(outs[1], /plugin disabled \[project\]: alfred-code@envoydev \(.*this project only/);
    assert.strictEqual(down.stood, `stood-down: ${STOOD.map((n) => `project:${n}@envoydev`).join(',')}`);
    assert.deepStrictEqual(again.calls.filter((c) => /^plugin (disable|enable) /.test(c)), [], `a re-run switched something:\n${outs[2]}`);
    assert.strictEqual(again.stood, down.stood, 'the re-run dropped the record');
    const enables = back.calls.filter((c) => /^plugin enable /.test(c));
    assert.deepStrictEqual([...enables].sort(), STOOD.map((n) => `plugin enable ${n}@envoydev --scope project`).sort(), `${enables.join('\n')}\n${outs[3]}`);
    assert.ok(!steps.some((st) => st.calls.some((c) => /^plugin (disable|enable) .* --scope user/.test(c))), 'a user-scope row was switched');
    assert.strictEqual(back.stood, null);
});

// M3 (R132): a 1.2.0 plugin-route install updated straight onto the full copy route still has its
// per-stack carriers, which declare the old core a dependency - and the CLI refuses to disable a plugin
// an enabled one depends on (P111). The carriers are pruned first, then the stack's rows go off.
test('seed update (full copy route): the retired carriers are pruned BEFORE the stand-down disables the core they depend on (M3)', POSIX_ONLY, () =>
{
    const carrier = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-entries.json'), 'utf8'));
    const name = (Array.isArray(carrier) ? carrier : carrier.entries || carrier.plugins)[0].name;
    const rows = [...LEGACY_ROWS(), { id: `${name}@claude-stack`, version: '1.2.0', scope: 'project', enabled: true }]; // legacy-name
    const { calls, out } = switchRun(rows);
    const prune = calls.indexOf(`plugin uninstall ${name}@claude-stack --scope project -y`); // legacy-name
    const disable = calls.indexOf('plugin disable claude-stack@claude-stack --scope project'); // legacy-name
    assert.ok(prune >= 0, `the carrier was not pruned:\n${calls.join('\n')}\n${out}`);
    assert.ok(disable > prune, `the old core was disabled before the carrier that depends on it went:\n${calls.join('\n')}`);
});

// M4 (R132): an unreadable `claude plugin list --json` reads as no rows, and the stand-down then did
// nothing without a word - the core and the locked three, if enabled, ran beside the registrations.
test('seed update (full copy route): an unreadable plugin listing is one loud line naming the stand-down it could not do, never an empty list acted on (M4)', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\n', {
        env: [{}, COPY_ENV],
        args: [[], ['--installed-only']],
        each: (repo, i) => { if (i === 0) { stepCalls(repo); fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), 'not json'); } return null; },
    });
    const loud = out.split('\n').filter((l) => /!! .*plugin listing could not be read/.test(l));
    assert.strictEqual(loud.length, 1, out);
    assert.match(loud[0], /claude plugin disable alfred-code@envoydev --scope project/);
    assert.deepStrictEqual(calls.filter((c) => /^plugin disable /.test(c)), [], calls.join('\n'));
});

// M8 (R132): a stale listing flag makes the update's enable a no-op, which the CLI refuses. The text is
// MEASURED on 2.1.282 (stderr, exit 1): 'Failed to enable plugin "<spec>": Plugin "<spec>" is already
// enabled at project scope' - and 'at user scope' for a user row. The expect matches both, so the no-op
// prints no failure line.
for (const scope of ['project', 'user'])
{
    test(`seed update: the CLI's measured 'already enabled' answer to a stale-flag enable prints no failure line (${scope} scope, M8)`, POSIX_ONLY, () =>
    {
        const stub = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
            'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi',
            `if [ "$1" = "plugin" ] && [ "$2" = "enable" ]; then printf '%s\\n' "✘ Failed to enable plugin \\"$3\\": Plugin \\"$3\\" is already enabled at ${scope} scope" >&2; exit 1; fi`,
            'exit 0'].join('\n');
        const rows = STACK_ROWS('envoydev', { serena: { enabled: false, scope } });
        const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\n', {
            plugins: JSON.stringify(rows), tools: { claude: stub },
            args: [['--scope', scope], ['--scope', scope, '--installed-only']],
        });
        assert.ok(calls.includes(`plugin enable serena@envoydev --scope ${scope}`), `no stale-flag enable ran:\n${calls.join('\n')}`);
        assert.doesNotMatch(out, /!! .*plugin enable/, out);
    });
}

// The listing's own flag is not the word on whether a row runs: it read a running project-scope core
// as off (docs/rebrand-evidence.md S22), and a no-op disable exits 1 (S28). The settings file at the
// row's scope is, when it names the plugin - the same read the playwright engines take.
test('seed update (full copy route): the settings file, not the listing flag, says which stack rows are on (R111)', POSIX_ONLY, () =>
{
    const rows = STACK_ROWS('envoydev', { 'alfred-code': { enabled: false }, serena: { enabled: true } });
    const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(rows),
        env: [{}, COPY_ENV],
        args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), '');
            const file = path.join(repo, '.claude', 'settings.json');
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            data.enabledPlugins = { ...(data.enabledPlugins || {}), 'alfred-code@envoydev': true, 'serena@envoydev': false };
            fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
            return null;
        },
    });
    const disables = calls.filter((c) => /^plugin disable /.test(c)).sort();
    assert.deepStrictEqual(disables, ['alfred-code', 'context7', 'memory'].map((n) => `plugin disable ${n}@envoydev --scope project`), `${disables.join('\n')}\n${out}`);
});

// R116 matrix re-run (R22): the switch disabled the core, but the full copy route read its skills and
// seats from the DISK, where a plugin-route install holds only the extras - so the core's own skills
// and seats were never copied, and with the core off they loaded nowhere (a switched session listed 8
// skills and no stack seat, a fresh copy-route install 26 skills and 8 seats). What the core carried
// is read back the way the skills route reads it, and copied before it goes off - a denied seat excepted.
for (const [key, rows] of [['envoydev', STACK_ROWS('envoydev')], ['claude-stack', LEGACY_ROWS()]]) // legacy-name
{
    test(`seed update (full copy route, key ${key}): what the enabled core carried is copied before the switch disables it, a denied seat left off (R116)`, POSIX_ONLY, () =>
    {
        const core = require('./plugin-placement.js').placement().plugins['alfred-code'];
        const seat = 'code-style-analyzer';
        assert.ok(core.agents.includes(seat) && core.skills.length > 1, 'fixture: the core carries the seat and more than one skill');
        const names = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
        // Every core seat picked (an unpicked one is denied at install), then one switched off by hand.
        const { out, result } = seedRun(['install', 'update'], `skill markdown-style\n${core.agents.map((a) => `agent ${a}\n`).join('')}`, {
            plugins: JSON.stringify(rows),
            env: [{}, COPY_ENV],
            args: [[], ['--installed-only']],
            each: (repo, i) =>
            {
                if (i !== 0) return null;
                const file = path.join(repo, '.claude', 'settings.json');
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                const perms = data.permissions || {};
                data.permissions = { ...perms, deny: [...(perms.deny || []), `Agent(alfred-code:${seat})`] };
                fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
                return null;
            },
            inspect: (repo) => ({ skills: names(path.join(repo, '.claude', 'skills')), agents: names(path.join(repo, '.claude', 'agents')) }),
        });
        assert.deepStrictEqual(core.skills.filter((s) => !result.skills.includes(s)), [], `core skills not copied:\n${out}`);
        assert.deepStrictEqual(core.agents.filter((a) => a !== seat && !result.agents.includes(`${a}.md`)), [], `core seats not copied:\n${out}`);
        assert.ok(!result.agents.includes(`${seat}.md`), `the seat the user denied came back: ${result.agents.join(',')}`);
    });
}

// What a switch copies becomes the disk the copy route reads its picks from - so the switch records
// it as picked in the same run. Recorded only by the next run, the stamp changed on a re-run that
// changed nothing else (the R22c matrix case, a710c6b).
test('seed update (full copy route): the switch stamps what it copied as picked - a re-run leaves the stamp as it was (R116)', POSIX_ONLY, () =>
{
    const picks = (repo) => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8').split('\n').filter((l) => /^picked-(skills|agents):/.test(l));
    const { steps, out } = seedRun(['install', 'update', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')),
        env: [{}, COPY_ENV, COPY_ENV],
        args: [[], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            // The disables the switch ran, as the CLI writes them - the stub CLI writes nothing.
            if (i === 1)
            {
                const file = path.join(repo, '.claude', 'settings.json');
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                data.enabledPlugins = { ...(data.enabledPlugins || {}), ...Object.fromEntries(['alfred-code', ...mcp.LOCKED].map((n) => [`${n}@envoydev`, false])) };
                fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
            }
            return picks(repo);
        },
    });
    assert.ok(steps[2].some((l) => l.includes('alfred-capture-first-look')), `the copy route reads its copies as picks:\n${steps[2].join('\n')}`);
    assert.deepStrictEqual(steps[2], steps[1], `the re-run rewrote the picks:\n${out}`);
});

// R111 (Task 8a concern c): wherever the copy route registers a playwright engine in .mcp.json, that
// engine's plugin row loaded beside it - the same tools twice. Its row at this scope is UNINSTALLED
// first, under the stack key only: a disabled engine is the user's own off-state, which the plugin
// route never switches back without an answer, while an absent one it installs back in its last
// chosen state (install-plugins.test.js, 'an engine uninstalled by hand comes back').
const PW_ROWS = [
    ...STACK_ROWS('envoydev'),
    { id: 'playwright-chrome@envoydev', version: '1.0.0', scope: 'project', enabled: true },
    { id: 'playwright-firefox@envoydev', version: '1.0.0', scope: 'user', enabled: true },
    { id: 'playwright-webkit@envoydev', version: '1.0.0', scope: 'project', enabled: false },
    { id: 'playwright-chrome@a-fork', version: '1.0.0', scope: 'project', enabled: true },
];
const pwProject = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 2.0.0\nplaywright-browsers: chrome,firefox,webkit\nplaywright-enabled: chrome,firefox\n');
};
const MCP_COPY_ENV = { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };

for (const [route, env] of [['MCP copy route', MCP_COPY_ENV], ['full copy route', COPY_ENV]])
{
    test(`seed update (${route}): a playwright engine registered in .mcp.json has its plugin row at this scope uninstalled first, under the stack key only (R111)`, POSIX_ONLY, () =>
    {
        const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
            plugins: JSON.stringify(PW_ROWS), env, args: ['--playwright-browsers', 'chrome,firefox,webkit'], prepare: pwProject,
            inspect: (repo) => Object.keys(JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {}),
        });
        for (const e of ['chrome', 'firefox', 'webkit']) assert.ok(result.includes(`playwright-${e}`), `playwright-${e} not registered: ${result.join(',')}\n${out}`);
        const engineMoves = calls.filter((c) => /^plugin (install|uninstall|disable|enable) playwright-/.test(c));
        // R116: the row left off goes too - the stamp is then the one record the switch back reads.
        assert.deepStrictEqual(engineMoves, ['chrome', 'webkit'].map((e) => `plugin uninstall playwright-${e}@envoydev --scope project -y`), `${engineMoves.join('\n')}\n${out}`);
        const gone = calls.indexOf('plugin uninstall playwright-chrome@envoydev --scope project -y');
        assert.ok(calls.findIndex((c) => /^mcp add .*playwright-/.test(c)) > gone, `an engine was registered before its plugin went:\n${calls.join('\n')}`);
        assert.match(out, /plugin uninstalled \[project\]: playwright-chrome@envoydev \(the copy route registers it in \.mcp\.json/);
        assert.match(out, /playwright-firefox@envoydev is enabled at user scope, not this run's - .*claude plugin uninstall playwright-firefox@envoydev --scope user/);
        const stackDisables = calls.filter((c) => /^plugin disable (alfred-code|serena|context7|memory)@/.test(c));
        assert.strictEqual(stackDisables.length, route === 'full copy route' ? 4 : 0, `${stackDisables.join('\n')}`);
    });
}

// R116 (Task 8a concern g): an --installed-only switch from the plugin route to the MCP copy route read
// the engines from .mcp.json alone, found none, and wrote the stamp's two playwright lines BLANK - the
// very record a switch back reinstalls the engines from (R111 h). Whenever the live state lacks them,
// the stamp's lines carry over: the switch registers the stamped engines (their plugin rows go first),
// and the switch back installs each in its last chosen state (the P111c -> P111d chain).
// Concern j: an engine installed but not enabled must not load. On the copy route it is registered in
// .mcp.json AND named in disabledMcpjsonServers, which rejects a .mcp.json server in every permission
// mode (code.claude.com/docs/en/mcp, 'Server status'; measured on 2.1.282: 'Rejected (see
// disabledMcpjsonServers in settings)'). The list moves only when the user's enable choice does.
const PW3_ROWS = (over = {}) => [
    ...STACK_ROWS('envoydev'),
    ...['chrome', 'firefox', 'webkit'].map((e) => ({ id: `playwright-${e}@envoydev`, version: '2.0.0', scope: 'project', enabled: e !== 'webkit', ...(over[e] || {}) })),
];
const jsonAt = (repo, rel) => { try { return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8')); } catch { return {}; } };
const pwState = (repo, settingsFile = 'settings.json') => ({
    stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8').split('\n').filter((l) => l.startsWith('playwright-')),
    mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}).filter((n) => n.startsWith('playwright-')),
    disabled: jsonAt(repo, `.claude/${settingsFile}`).disabledMcpjsonServers,
    settings: fs.readFileSync(path.join(repo, '.claude', settingsFile), 'utf8'),
});
// Each step's own CLI calls, and the log emptied for the next.
const stepCalls = (repo) =>
{
    const log = path.join(path.dirname(repo), 'claude-calls.log');
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
    fs.writeFileSync(log, '');
    return calls;
};
const engineMovesOf = (calls) => calls.filter((c) => /^plugin (install|uninstall|disable|enable) playwright-/.test(c));
const PW_STAMP = ['playwright-browsers: chrome,firefox,webkit', 'playwright-enabled: chrome,firefox'];

test('seed update: an --installed-only switch onto the MCP copy route keeps the stamp\'s engine lines, and the switch back installs each as last chosen (R116 g)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['update', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(PW3_ROWS()),
        env: [MCP_COPY_ENV, {}],
        args: ['--installed-only'],
        prepare: pwProject,
        each: (repo, i) =>
        {
            const state = { ...pwState(repo), calls: stepCalls(repo) };
            // The engines the switch uninstalled are gone from the listing the switch back reads.
            if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'plugins.json'), JSON.stringify(STACK_ROWS('envoydev')));
            return state;
        },
    });
    const [toCopy, back] = steps;
    assert.deepStrictEqual(toCopy.stamp, PW_STAMP, `the switch blanked the record:\n${outs[0]}`);
    assert.deepStrictEqual(toCopy.mcp, ['playwright-chrome', 'playwright-firefox', 'playwright-webkit'], outs[0]);
    assert.deepStrictEqual(toCopy.disabled, ['playwright-webkit'], 'the engine left off loads on the copy route');
    // Every stamped engine's row goes, the one left off included: the stamp is then the one record the
    // switch back reads, and a row left installed would override a choice the user made on the copy route.
    assert.deepStrictEqual(engineMovesOf(toCopy.calls), ['chrome', 'firefox', 'webkit'].map((e) => `plugin uninstall playwright-${e}@envoydev --scope project -y`), outs[0]);
    assert.deepStrictEqual(back.stamp, PW_STAMP, `the switch back lost the record:\n${outs[1]}`);
    assert.deepStrictEqual(engineMovesOf(back.calls), [
        'plugin install playwright-chrome@envoydev --scope project -y',
        'plugin install playwright-firefox@envoydev --scope project -y',
        'plugin install playwright-webkit@envoydev --scope project -y',
        'plugin disable playwright-webkit@envoydev --scope project',
    ], outs[1]);
    assert.ok(back.calls.includes('mcp remove playwright-webkit -s project'), back.calls.join('\n'));
    assert.strictEqual(back.disabled, undefined, 'a disabledMcpjsonServers entry for a server no longer registered is dead config');
});

test('seed install (MCP copy route): an engine installed but not enabled is registered and named in disabledMcpjsonServers, and a re-run changes nothing (R116 j)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp playwright\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'], ['--installed-only'], ['--installed-only']],
        each: (repo) => pwState(repo),
    });
    const [first, update, again] = steps;
    assert.deepStrictEqual(first.mcp, ['playwright-chrome', 'playwright-webkit'], outs[0]);
    assert.deepStrictEqual(first.disabled, ['playwright-webkit'], outs[0]);
    assert.match(outs[0], /playwright: webkit left off - disabledMcpjsonServers keeps it from loading/);
    assert.deepStrictEqual(first.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome']);
    // The first update adopts the locked three (the sandbox listing has no core row) - its own change;
    // the list and the stamp hold from the install on, and the next re-run changes nothing at all.
    assert.deepStrictEqual(update.disabled, first.disabled, outs[1]);
    assert.deepStrictEqual(update.stamp, first.stamp);
    assert.strictEqual(again.settings, update.settings, `the re-run changed settings.json:\n${outs[2]}`);
    assert.deepStrictEqual(again.stamp, first.stamp);
});

test('seed update (MCP copy route): an engine the user enables stays enabled across re-runs, and only an answer that changes it moves the list (R116 j)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nmcp playwright\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'], ['--installed-only'],
            ['--installed-only', '--playwright-enabled', 'chrome'], ['--installed-only', '--playwright-enabled', 'all']],
        each: (repo, i) =>
        {
            const state = pwState(repo);
            if (i === 0)
            {
                // The user turns webkit on by hand: its entry leaves the list.
                const file = path.join(repo, '.claude', 'settings.json');
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                data.disabledMcpjsonServers = [];
                fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
            }
            return state;
        },
    });
    const [, kept, answeredOff, answeredOn] = steps;
    assert.ok(!(kept.disabled || []).includes('playwright-webkit'), `a re-run switched the user's engine back off:\n${outs[1]}`);
    assert.deepStrictEqual(kept.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome,webkit'], 'the stamp keeps the live choice');
    assert.deepStrictEqual(answeredOff.disabled, ['playwright-webkit'], outs[2]);
    assert.deepStrictEqual(answeredOff.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome']);
    assert.ok(!(answeredOn.disabled || []).includes('playwright-webkit'), outs[3]);
    assert.deepStrictEqual(answeredOn.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome,webkit']);
});

// M1 (R132): the run READS a rejection from settings.json, settings.local.json and the account file,
// but wrote the answer only to its own file - and Claude Code's approval dialog writes a rejection to
// settings.local.json. An enable answer then left the engine rejected while the stamp said enabled,
// and the next run flipped the stamp back. The answer now takes the name out of the local file too; the
// account file is never edited, so an entry there is named with its file instead.
test('seed update (MCP copy route): an enable answer takes the engine out of settings.local.json too, and names the account file that still rejects one (M1)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp playwright\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,webkit,firefox', '--playwright-enabled', 'chrome'], ['--installed-only', '--playwright-enabled', 'all'], ['--installed-only']],
        each: (repo, i) =>
        {
            const local = jsonAt(repo, '.claude/settings.local.json');
            const account = path.join(path.dirname(repo), 'acct', 'settings.json');
            const state = { ...pwState(repo), local: local.disabledMcpjsonServers, localKeys: Object.keys(local), account: fs.existsSync(account) ? fs.readFileSync(account, 'utf8') : '' };
            if (i === 0)
            {
                // The approval dialog's rejection of webkit, beside a key of the user's own; firefox is
                // rejected in the account file.
                fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), `${JSON.stringify({ disabledMcpjsonServers: ['playwright-webkit'], permissions: { allow: ['Bash(ls)'] } }, null, 2)}\n`);
                const acct = jsonAt(path.dirname(account), 'settings.json');
                fs.mkdirSync(path.dirname(account), { recursive: true });
                fs.writeFileSync(account, `${JSON.stringify({ ...acct, disabledMcpjsonServers: ['playwright-firefox'] }, null, 2)}\n`);
            }
            return state;
        },
    });
    const [, answered, again] = steps;
    assert.deepStrictEqual(answered.local, undefined, `the local rejection survived the enable answer:\n${outs[1]}`);
    // C8: `env` is the machine's memory path, which settings.local.json holds at every scope.
    assert.deepStrictEqual(answered.localKeys, ['permissions', 'env'], 'the user\'s own local key went');
    assert.ok(!(answered.disabled || []).includes('playwright-webkit'), outs[1]);
    assert.match(outs[1], /settings\.local\.json: disabledMcpjsonServers - playwright-webkit/);
    assert.match(outs[1], /playwright-firefox is still rejected by .*acct\/settings\.json's disabledMcpjsonServers/);
    assert.match(answered.account, /"playwright-firefox"/, 'the account file was edited');
    assert.deepStrictEqual(again.stamp, ['playwright-browsers: chrome,firefox,webkit', 'playwright-enabled: chrome,webkit'], `the next run flipped the stamp:\n${outs[2]}`);
});

test('seed update --print-plan (MCP copy route): the walk pre-selects the LIVE on/off - disabledMcpjsonServers, not the stamp (R116 j)', POSIX_ONLY, () =>
{
    const planFor = (disabled, stampEnabled) =>
    {
        const { result } = seedRun('update', 'skill markdown-style\n', {
            env: MCP_COPY_ENV,
            args: (repo, work) => ['--installed-only', '--print-plan', '--plan-out', path.join(work, 'plan.json')],
            prepare: (repo) =>
            {
                fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
                fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
                fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), `sha: abc\nversion: 2.0.0\nplaywright-browsers: chrome,webkit\nplaywright-enabled: ${stampEnabled}\n`);
                const server = (e) => ({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.82', '--browser', e] });
                fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { 'playwright-chrome': server('chrome'), 'playwright-webkit': server('webkit') } }));
                fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ disabledMcpjsonServers: disabled }));
            },
            inspect: (repo) => JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'plan.json'), 'utf8')).playwright,
        });
        return result;
    };
    assert.deepStrictEqual(planFor(['playwright-webkit'], 'chrome,webkit'), { installed: ['chrome', 'webkit'], enabled: ['chrome'] });
    assert.deepStrictEqual(planFor([], 'chrome'), { installed: ['chrome', 'webkit'], enabled: ['chrome', 'webkit'] });
});

// R124 (Task 8a concern l): at local and user scope no settings key reaches a registration - measured,
// disabledMcpjsonServers rejects only .mcp.json servers - so there the registration IS the enable. An
// engine left off is NOT registered (an earlier registration of it is removed), the stamp still records it
// installed-off, its browser is still downloaded, and a later enable answer registers it.
const engineAdds = (calls) => calls.filter((c) => /^mcp add /.test(c)).map((c) => (/\bplaywright-(chrome|msedge|firefox|webkit)\b/.exec(c) || [])[1]).filter(Boolean);
for (const scope of ['user', 'local'])
{
    test(`seed install + update (MCP copy route, ${scope} scope): an engine left off is not registered, the stamp keeps it installed-off, and no /mcp line is printed (R124 l)`, POSIX_ONLY, () =>
    {
        const settingsFile = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nmcp playwright\n', {
            env: MCP_COPY_ENV,
            // A-M2: a user-scope removal takes only a registration of the stack's own shape, so the
            // earlier webkit registration is laid out in the account file.
            prepare: (repo, work) => { if (scope === 'user') accountMcp(work, { 'playwright-webkit': STACK_PW('webkit') }); },
            args: [['--scope', scope, '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'], ['--scope', scope, '--installed-only']],
            each: (repo) => ({ ...pwState(repo, settingsFile), calls: stepCalls(repo) }),
        });
        for (const [i, step] of steps.entries())
        {
            // The recording stub answers `mcp get`, so an install reads every name as configured already
            // and adds none; an update removes and re-adds, so its adds are the whole registration.
            const looked = [...new Set(step.calls.filter((c) => /^mcp get playwright-/.test(c)).map((c) => c.split(' ')[2]))];
            assert.deepStrictEqual(i === 0 ? looked : engineAdds(step.calls), i === 0 ? ['playwright-chrome'] : ['chrome'],
                `step ${i} registered an engine left off:\n${step.calls.join('\n')}\n${outs[i]}`);
            assert.ok(step.calls.includes(`mcp remove playwright-webkit -s ${scope}`), `step ${i} left an earlier webkit registration in place:\n${step.calls.join('\n')}`);
            assert.deepStrictEqual(step.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome'], `step ${i}: ${outs[i]}`);
            assert.strictEqual(step.disabled, undefined, 'no settings key reaches a local- or user-scope registration');
            assert.doesNotMatch(outs[i], /run \/mcp and disable/, `step ${i} named a /mcp switch for an engine it did not register`);
            assert.match(outs[i], new RegExp(`playwright: webkit left off - not registered at ${scope} scope`), outs[i]);
            assert.match(outs[i], /playwright: downloading the webkit build the server launches/, `step ${i} dropped the browser download`);
        }
    });
}

test('seed update (MCP copy route, user scope): a later enable answer registers the engine left off, and turning it off again removes it (R124 l)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp playwright\n', {
        env: MCP_COPY_ENV,
        // A-M2: the registrations the account holds, of the stack's own shape - the stub writes none.
        prepare: (repo, work) => accountMcp(work, { 'playwright-chrome': STACK_PW('chrome'), 'playwright-webkit': STACK_PW('webkit') }),
        args: [['--scope', 'user', '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'],
            ['--scope', 'user', '--installed-only', '--playwright-enabled', 'all'], ['--scope', 'user', '--installed-only', '--playwright-enabled', 'chrome']],
        each: (repo) => ({ ...pwState(repo), calls: stepCalls(repo) }),
    });
    const [, on, off] = steps;
    assert.deepStrictEqual(engineAdds(on.calls), ['chrome', 'webkit'], `the enable did not register webkit:\n${on.calls.join('\n')}\n${outs[1]}`);
    assert.deepStrictEqual(on.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome,webkit']);
    assert.deepStrictEqual(engineAdds(off.calls), ['chrome'], outs[2]);
    assert.ok(off.calls.includes('mcp remove playwright-webkit -s user'), off.calls.join('\n'));
    assert.deepStrictEqual(off.stamp, ['playwright-browsers: chrome,webkit', 'playwright-enabled: chrome']);
});

// R124 (Task 8a concern m): enabledMcpjsonServers pre-approves the .mcp.json servers THIS run registered,
// and nothing else - never the locked three on a route where they ride the plugins, never an engine it
// names in disabledMcpjsonServers, and nothing at local or user scope, where no server lands in .mcp.json.
// A name the user put there is theirs.
const trusted = (repo, file = 'settings.json') => jsonAt(repo, `.claude/${file}`).enabledMcpjsonServers;
const withTrust = (file, list) => (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', file), `${JSON.stringify({ enabledMcpjsonServers: list }, null, 2)}\n`);
};
test('seed install (MCP copy route): enabledMcpjsonServers names only the engines registered and loading - no locked three, no engine left off (R124 m)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nmcp playwright\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,firefox,webkit', '--playwright-enabled', 'chrome,firefox'], ['--installed-only']],
        prepare: withTrust('settings.json', ['serena', 'mine', 'playwright-webkit']),
        each: (repo) => ({ trusted: trusted(repo), disabled: pwState(repo).disabled }),
    });
    for (const [i, step] of steps.entries())
    {
        assert.deepStrictEqual(step.trusted, ['mine', 'playwright-chrome', 'playwright-firefox'], `step ${i}:\n${outs[i]}`);
        assert.deepStrictEqual(step.disabled, ['playwright-webkit'], `step ${i}`);
    }
});

test('seed install (full copy route): the locked three are registered in .mcp.json, so enabledMcpjsonServers names them (R124 m)', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', 'skill markdown-style\n', { env: COPY_ENV, inspect: (repo) => trusted(repo) });
    assert.deepStrictEqual([...result].sort(), [...mcp.LOCKED].sort(), out);
});

for (const scope of ['user', 'local'])
{
    test(`seed install (MCP copy route, ${scope} scope): nothing lands in .mcp.json, so enabledMcpjsonServers gains no stack name and loses the ones it held (R124 m)`, POSIX_ONLY, () =>
    {
        const file = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const { result, out } = seedRun('install', 'skill markdown-style\nmcp playwright\n', {
            env: MCP_COPY_ENV,
            args: ['--scope', scope, '--playwright-browsers', 'chrome'],
            prepare: withTrust(file, ['serena', 'mine', 'playwright-chrome']),
            inspect: (repo) => trusted(repo, file),
        });
        assert.deepStrictEqual(result, ['mine'], out);
    });
}

// C10 (R136 q): on the user-scope FULL copy route the stack's servers were registered with
// `mcp add --scope user`, which reaches every project on the account - another project's context7 tools
// turned bare, and its serena and memory ran twice beside their plugins. They go to THIS project's
// .mcp.json in the project-scope shape, a project-level memory database included (the refusal that
// guarded the user-scope registration has no premise left). A stack registration an earlier run left at
// user scope is named, never removed: another user-scope project still loads it until its own update.
test('seed install + update --scope user (full copy route): every stack server lands in this project\'s .mcp.json, none at user scope (C10)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
        env: COPY_ENV,
        args: [['--scope', 'user', '--memory-level', 'project', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only']],
        prepare: (repo, work) => accountMcp(work, { serena: STACK_SERENA, memory: { type: 'stdio', command: 'node', args: ['my-memory.js'], env: {} } }),
        each: (repo) => ({ calls: stepCalls(repo), mcp: jsonAt(repo, '.mcp.json').mcpServers || {}, trusted: trusted(repo), stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'), real: fs.realpathSync(repo) }),
    });
    for (const [i, step] of steps.entries())
    {
        const userCalls = step.calls.filter((c) => /^mcp (add|remove) .*(--scope user|-s user)/.test(c));
        assert.deepStrictEqual(userCalls, [], `step ${i} registered at user scope:\n${userCalls.join('\n')}\n${outs[i]}`);
        for (const name of ['serena', 'memory', 'context7', 'playwright-chrome'])
            assert.ok(step.mcp[name], `step ${i}: ${name} is not in this project's .mcp.json: ${Object.keys(step.mcp).join(',')}\n${outs[i]}`);
        assert.strictEqual(step.mcp.memory.env.MCP_MEMORY_SQLITE_PATH, path.join(step.real, '.memory-mcp', 'memory.db'), 'the project-level database is this project\'s');
        for (const name of ['serena', 'memory', 'context7', 'playwright-chrome']) assert.ok((step.trusted || []).includes(name), `step ${i}: ${name} is not pre-approved`);
        assert.match(step.stamp, /^scope: user$/m);
        assert.match(outs[i], /mcp: serena still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run \/alfred-code:update: claude mcp remove serena -s user/, outs[i]);
        assert.doesNotMatch(outs[i], /mcp: [^\n]*memory still registered at user scope/, 'another server under the stack\'s name is not the stack\'s');
    }
    assert.ok(steps[1].calls.some((c) => /^mcp add --scope project serena /.test(c)), steps[1].calls.join('\n'));
});

// N5 (re-review): on that route the drop loop removes at the scope the route registers at - this project's
// .mcp.json - so an engine an earlier user-scope run registered and this run drops, or a 1.x single
// `playwright`, stayed at user scope with nothing said. Each is named with its command like C10's stale
// names, and never removed (another user-scope install may still load it); a server of the user's own
// under a dropped engine's name gets the kept line instead.
// M-F5-1 (re-review follow-up): `playwright-webkit` is not live (this run only keeps chrome), so a foreign
// registration under it is noise, not something the user must act on - its kept line loses the `!!`.
// M-F5-2 (re-review follow-up): `playwright`'s identity is the package name only (mcp.identityOf), which
// cannot tell the stack's 1.x registration apart from the user's own `npx @playwright/mcp` under the same
// bare name - it is never named as the stack's leftover, and the neutral wording is unmarked.
test('seed update --scope user (full copy route): a dropped engine and a legacy playwright still registered at user scope are named with their command, never removed (N5)', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
        env: COPY_ENV, args: ['--scope', 'user', '--playwright-browsers', 'chrome'],
        prepare: (repo, work) =>
        {
            pwProject(repo);
            accountMcp(work, { 'playwright-webkit': STACK_PW('webkit'), playwright: STACK_PW('chrome'), 'playwright-firefox': { type: 'stdio', command: 'node', args: ['my-firefox.js'], env: {} } });
        },
    });
    const still = (name) => (out.match(new RegExp(`!! mcp: ${name} still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run /alfred-code:update: claude mcp remove ${name} -s user`, 'g')) || []).length;
    assert.strictEqual(still('playwright-webkit'), 1, `playwright-webkit:\n${out}`);
    assert.strictEqual(still('playwright'), 0, 'the bare name cannot be told from the user\'s own - it must never claim stack authorship (M-F5-2)');
    assert.strictEqual((out.match(/playwright is registered at user scope - if an earlier stack run added it and no other project uses it: claude mcp remove playwright -s user; if you added it yourself, keep it/g) || []).length, 1, out);
    assert.doesNotMatch(out, /!! playwright is registered at user scope/, 'the ambiguous bare name is never marked (M-F5-2)');
    assert.strictEqual(still('playwright-firefox'), 0, 'a server of the user\'s own is not the stack\'s stale registration');
    assert.strictEqual((out.match(/!! mcp playwright-firefox: the user-scope registration is not the stack's/g) || []).length, 0, 'a dropped, non-live engine\'s kept line carries no actionable marker (M-F5-1)');
    assert.strictEqual((out.match(/mcp playwright-firefox: the user-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove playwright-firefox -s user/g) || []).length, 1, 'the kept line itself still logs, unmarked (M-F5-1)');
    assert.deepStrictEqual(calls.filter((c) => /^mcp remove .* -s user$/.test(c)), [], `a user-scope registration was removed:\n${calls.join('\n')}`);
});

// C11 (R137 N1): on that route engineStandDown UNINSTALLED a user-scope playwright engine - every project
// on the account lost it. It is switched off in THIS project only, recorded in the stamp's stood-down
// line, and the switch back enables it there.
test('seed update --scope user (full copy route): a user-scope playwright engine is switched off in this project only, and the switch back enables it (C11)', POSIX_ONLY, () =>
{
    const rows = [...USER_ROWS(), { id: 'playwright-chrome@envoydev', version: '2.0.0', scope: 'user', enabled: true }];
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
        plugins: JSON.stringify(rows),
        env: [{}, COPY_ENV, COPY_ENV, {}],
        args: [['--scope', 'user', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), stood: stoodDownLine(repo) };
            if (i === 1) settingsWord(repo, { ...offWord(), 'playwright-chrome@envoydev': false });
            return state;
        },
    });
    const [, down, again, back] = steps;
    assert.ok(!down.calls.some((c) => /^plugin uninstall playwright-chrome@envoydev --scope user/.test(c)), `the account's engine was uninstalled:\n${down.calls.join('\n')}`);
    assert.ok(down.calls.includes('plugin disable playwright-chrome@envoydev --scope project'), `${down.calls.join('\n')}\n${outs[1]}`);
    assert.match(down.stood, /project:playwright-chrome@envoydev/, down.stood);
    assert.deepStrictEqual(again.calls.filter((c) => /^plugin (disable|enable|uninstall) /.test(c)), [], `a re-run switched something:\n${outs[2]}`);
    assert.strictEqual(again.stood, down.stood);
    assert.ok(back.calls.includes('plugin enable playwright-chrome@envoydev --scope project'), `${back.calls.join('\n')}\n${outs[3]}`);
    assert.ok(!steps.some((st) => st.calls.some((c) => /^plugin (disable|enable|uninstall) playwright-chrome@envoydev --scope user/.test(c))), 'the user-scope engine was switched');
});

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
const LEFT_BY_C10 = ['context7', 'memory', 'playwright-chrome', 'serena'];
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

test('seed update --scope user: the switch back from the full copy route prunes the stack servers C10 put in this project\'s .mcp.json, keeps a hand-added one, and calls nothing at user scope (F7, R22g)', POSIX_ONLY, () =>
{
    const rows = [...USER_ROWS(), { id: 'playwright-chrome@envoydev', version: '2.0.0', scope: 'user', enabled: true }];
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
        plugins: JSON.stringify(rows), tools: { claude: MCPJSON_CLI },
        env: [COPY_ENV, {}, {}],
        args: [['--scope', 'user', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}).sort(), trusted: trusted(repo) };
            if (i === 0) handAdded(repo);
            return state;
        },
    });
    const [copyRoute, back, again] = steps;
    assert.deepStrictEqual(copyRoute.mcp, LEFT_BY_C10, `fixture: the full copy route registered in .mcp.json:\n${outs[0]}`);
    assert.deepStrictEqual(back.mcp, ['mine'], `the switch back left stack servers in this project's .mcp.json:\n${back.calls.join('\n')}\n${outs[1]}`);
    assert.deepStrictEqual(projectRemovesOf(back.calls).sort(), LEFT_BY_C10.map((n) => `mcp remove ${n} -s project`), 'a name .mcp.json does not hold cost a call, or one it holds was not removed');
    for (const name of LEFT_BY_C10) assert.match(outs[1], new RegExp(`mcp pruned: ${name}\\n`), outs[1]);
    assert.deepStrictEqual(back.trusted, ['mine'], 'the hand-added server lost its approval, or a stack name kept one');
    for (const [i, step] of steps.entries()) assert.deepStrictEqual(userCallsOf(step.calls), [], `step ${i} called at user scope:\n${outs[i]}`);
    assert.deepStrictEqual(projectRemovesOf(again.calls), [], `the re-run removed again:\n${outs[2]}`);
    assert.deepStrictEqual(again.mcp, ['mine']);
});

// The same leftovers on the MCP copy route with the core on: the run registers its engine at user scope,
// so the copy C10 put in .mcp.json ran chrome twice, and the locked three ran beside their plugins.
test('seed update --scope user: leaving the full copy route for the MCP copy route prunes what C10 put in this project\'s .mcp.json - the engine registers at user scope once (F7)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
        plugins: JSON.stringify(USER_ROWS()), tools: { claude: MCPJSON_CLI },
        env: [COPY_ENV, MCP_COPY_ENV],
        args: [['--scope', 'user', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}).sort() };
            if (i === 0) handAdded(repo);
            return state;
        },
    });
    const [, mcpCopy] = steps;
    assert.deepStrictEqual(mcpCopy.mcp, ['mine'], `stack servers left in this project's .mcp.json:\n${mcpCopy.calls.join('\n')}\n${outs[1]}`);
    assert.deepStrictEqual(projectRemovesOf(mcpCopy.calls).sort(), LEFT_BY_C10.map((n) => `mcp remove ${n} -s project`), outs[1]);
    const adds = mcpCopy.calls.filter((c) => /^mcp add /.test(c));
    assert.deepStrictEqual(adds.map((c) => c.split(' ').slice(0, 5).join(' ')), ['mcp add --scope user playwright-chrome'], `${adds.join('\n')}\n${outs[1]}`);
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
                serena: { type: 'stdio', command: 'node', args: ['my-serena.js'], env: {} },
                context7: { type: 'http', url: mcp.CONTEXT7_REMOTE.url, headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' } },
            } }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['serena', 'context7'] }, null, 2)}\n`);
        },
        inspect: (repo) => ({ mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}), trusted: trusted(repo) }),
    });
    assert.deepStrictEqual(projectRemovesOf(calls), ['mcp remove context7 -s project'], `${projectRemovesOf(calls).join('\n')}\n${out}`);
    assert.deepStrictEqual(result.mcp, ['serena'], 'the user\'s own serena went, or the stack\'s context7 stayed');
    assert.strictEqual((out.match(/!! mcp serena: the project-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove serena -s project/g) || []).length, 1, out);
    assert.deepStrictEqual(result.trusted, ['serena'], 'the kept server lost its approval, or the pruned one kept it');
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
            accountMcp(work, { serena: STACK_SERENA, 'playwright-webkit': STACK_PW('webkit'), context7: { type: 'http', url: 'https://docs.example.test/mcp' } });
        },
    });
    const removes = calls.filter((c) => /^mcp remove /.test(c));
    assert.deepStrictEqual(removes.sort(), ['mcp remove playwright-webkit -s user', 'mcp remove serena -s user'], `${removes.join('\n')}\n${out}`);
    assert.strictEqual((out.match(/mcp context7: the user-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove context7 -s user/g) || []).length, 1, out);
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
    const catalog = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).catalogs.mcps;
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'retired-plugins.json'), 'utf8')).plugins;
    const ids = mcp.stackIdentities({ catalog, remotes: { context7: mcp.CONTEXT7_REMOTE }, tokens: { PW_PIN: '@0.0.82' }, retiredRows: rows });
    assert.ok(ids.serena.has('stdio:serena-agent'), [...ids.serena].join(','));
    assert.ok(ids['playwright-webkit'].has('stdio:@playwright/mcp') && ids.playwright.has('stdio:@playwright/mcp'));
    assert.deepStrictEqual([...ids.context7].sort(), ['http:https://mcp.context7.com/mcp', 'stdio:@upstash/context7-mcp']);
    assert.deepStrictEqual([...ids.sentry], ['http:https://mcp.sentry.dev/mcp/${SENTRY_SLUG}'], 'the add-back url is the user\'s, never the stack\'s');
    // Every retired server names what the stack registered, or its prune could never tell its own from the user's.
    const { loadManifest } = require('./install/manifest.js');
    for (const name of loadManifest(path.join(__dirname, '..')).retired.mcps)
        assert.ok(ids[name] && ids[name].size, `${name}: no registration row in meta/retired-plugins.json`);
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

// N4 (re-review): the verify pass re-registers a user-scope shape that drifted - `mcp remove`, then add. A
// name the account file does not show as the stack's (unreadable, or absent while the CLI holds one) was
// removed all the same: the user's own server under a stack name went, right after a line saying none
// would. Here `mcp get` answers every name with a shape of the user's own; only a registration the file
// shows as the stack's is re-registered, and the one it cannot is named once, its command beside it.
const OWN_SHAPE_CLI = ['printf \'%s\\n\' "$*" >> "$CLAUDE_STUB_LOG"',
    'if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then cat "$CLAUDE_STUB_PLUGINS"; exit 0; fi',
    'if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then printf \'%s:\\n  Scope: User config\\n  Type: stdio\\n  Command: node\\n  Args: my-own-server.js\\n\' "$3"; fi',
    'exit 0'].join('\n');
for (const [label, account, reregistered] of [
    ['an unreadable account file', '{not json', false],
    ['no account file while the CLI holds a registration', null, false],
    ['a stack-shaped registration (the control)', JSON.stringify({ mcpServers: { 'playwright-chrome': STACK_PW('chrome') } }), true],
])
{
    test(`seed update --scope user (MCP copy route): the verify pass with ${label} re-registers only the stack's own (N4)`, POSIX_ONLY, () =>
    {
        const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
            plugins: JSON.stringify(USER_ROWS()), env: MCP_COPY_ENV, tools: { claude: OWN_SHAPE_CLI },
            args: ['--scope', 'user', '--playwright-browsers', 'chrome'],
            prepare: (repo, work) =>
            {
                pwProject(repo);
                if (account !== null) { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', '.claude.json'), account); }
            },
        });
        const removes = calls.filter((c) => /^mcp remove playwright-chrome -s user$/.test(c));
        const skipped = (out.match(/!! mcp playwright-chrome: the user-scope registration differs from the stack's shape and is not known to be the stack's own - not re-registered, so nothing of yours is removed; if it should go: claude mcp remove playwright-chrome -s user, then re-run/g) || []).length;
        assert.ok(calls.some((c) => /^mcp get playwright-chrome$/.test(c)), `the verify pass never read the shape:\n${calls.join('\n')}`);
        if (reregistered)
        {
            assert.ok(removes.length > 0 && /shape drifted at user scope: playwright-chrome - re-registering/.test(out), `the stack's own drifted registration was not re-registered:\n${calls.join('\n')}\n${out}`);
            assert.strictEqual(skipped, 0, out);
            return;
        }
        assert.deepStrictEqual(removes, [], `a registration not known to be the stack's was removed:\n${calls.join('\n')}\n${out}`);
        assert.strictEqual(skipped, 1, out);
        assert.doesNotMatch(out, /shape drifted at user scope: playwright-chrome|could not be brought to the current shape/, out);
    });
}

// C17 ((i), Task 8a): the copy route copied each skill and seat with the plugin spelling, then re-spelled
// it in place - so every run rewrote the same files and logged 're-spelled in N file(s)'. A copy is now
// written as the text it holds (rendered at copy time) and only when that differs, so a re-run writes
// nothing and says nothing.
// B seam (final review B): on the FULL copy route no core plugin serves `alfred-code:<skill>`, so a seat's
// preload in that spelling loaded nothing - the copy route installed the skill bare. The copied seat
// preloads the bare name; the plugin route keeps the shipped text.
test('seed install + re-run (full copy route): copies hold the registered tool names and bare preloads from the first write, and a re-run rewrites nothing (C17, B seam)', POSIX_ONLY, () =>
{
    const seat = path.join('.claude', 'agents', 'angular-test-resolver.md');
    // The walk's closure brings a seat's preloaded skills along; a raw selection names them.
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nskill alfred-habits-root-cause\nskill alfred-habits-done-gate\nrule markdown-docs\nagent angular-test-resolver\n', {
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
                preloaded: fs.existsSync(path.join(skills, 'alfred-habits-root-cause', 'SKILL.md')),
            };
        },
    });
    for (const [i, out] of outs.entries()) assert.doesNotMatch(out, /MCP tool names re-spelled/, `step ${i} re-spelled copies it had just written:\n${out}`);
    const front = steps[0].seat.split('\n---')[0];
    assert.match(front, /^ {2}- alfred-habits-root-cause$/m, front);
    assert.doesNotMatch(front, /alfred-code:/, 'a preload still names the core plugin');
    // Built, never written out: a bare spelling in a tracked file is lint check 54's finding.
    assert.ok(front.includes(['mcp', 'serena', 'find_symbol'].join('__')), 'the tools list keeps the plugin spelling');
    assert.ok(steps[0].preloaded, 'the preloaded skill is not installed as a copy');
    const touched = Object.keys(steps[0].mtimes).filter((f) => steps[1].mtimes[f] !== steps[0].mtimes[f]);
    assert.deepStrictEqual(touched, [], `a re-run rewrote unchanged copies:\n${outs[1]}`);
});

test('seed install (plugin route): a library seat keeps its shipped alfred-code: preloads (B seam)', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', 'skill markdown-style\nrule markdown-docs\nagent angular-test-resolver\n', {
        inspect: (repo) => fs.readFileSync(path.join(repo, '.claude', 'agents', 'angular-test-resolver.md'), 'utf8'),
    });
    assert.match(result, /^ {2}- alfred-code:alfred-habits-root-cause$/m);
});

// F7 (F1 D, pre-existing since 1.3.0): every engine was re-spelled as `playwright`, a name no run
// registers, so a copied seat kept `mcp__plugin_playwright-chrome_playwright-chrome__*` while the run
// registered `playwright-chrome` bare - the seat lost playwright on the copy route. Each engine the run
// registers bare takes its own bare name; an engine it does not register (not kept, or left off at user
// scope, where the registration is the enable) keeps the plugin spelling. The mixed-pair line names the
// engines for the same reason. Bare spellings are BUILT, never typed (lint check 54).
const bareTools = (server) => ['mcp', server, '*'].join('__');
const pluginTools = (server) => `mcp__plugin_${server}_${server}__*`;
const SEATS = ['evidence-gatherer', 'integration-reviewer'];
for (const [route, env, scope, registered] of [
    ['MCP copy route', MCP_COPY_ENV, 'project', ['chrome', 'webkit']],
    ['MCP copy route', MCP_COPY_ENV, 'user', ['chrome']],
    ['full copy route', COPY_ENV, 'user', ['chrome', 'webkit']],
])
{
    test(`seed install (${route}, ${scope} scope): a copied seat names each engine the run registered bare by its own bare name, and every other engine by its plugin name (F7, F1 D)`, POSIX_ONLY, () =>
    {
        const { result, out } = seedRun('install', `skill markdown-style\nrule markdown-docs\nmcp playwright\n${SEATS.map((s) => `agent ${s}\n`).join('')}`, {
            env, args: ['--scope', scope, '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'],
            inspect: (repo) => Object.fromEntries(SEATS.map((s) => [s, fs.readFileSync(path.join(repo, '.claude', 'agents', `${s}.md`), 'utf8').split('\n').find((l) => l.startsWith('tools:'))])),
        });
        for (const seat of SEATS)
            for (const engine of mcp.PW_ENGINES)
            {
                const server = `playwright-${engine}`;
                const bare = registered.includes(engine);
                assert.ok(result[seat].includes(bare ? bareTools(server) : pluginTools(server)), `${seat}: ${server} is not spelled ${bare ? 'bare' : 'as the plugin'}:\n${result[seat]}\n${out}`);
                assert.ok(!result[seat].includes(bare ? pluginTools(server) : bareTools(server)), `${seat}: ${server} kept the other spelling:\n${result[seat]}`);
            }
    });
}

for (const [scope, named] of [['project', 'playwright-chrome playwright-webkit'], ['user', 'playwright-chrome']])
{
    test(`seed install (MCP copy route, skills on the plugin route, ${scope} scope): the mixed-pair line names the engines registered bare (F7, observation 2)`, POSIX_ONLY, () =>
    {
        const { out } = seedRun('install', 'skill markdown-style\nrule markdown-docs\nmcp playwright\n', {
            env: { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' },
            args: ['--scope', scope, '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'],
        });
        const line = out.split('\n').find((l) => l.includes('registered under their bare names'));
        assert.ok(line, out);
        assert.ok(line.includes(`which name the plugin spelling: ${named} - set ALFRED_CODE_SKILLS_VIA_PLUGIN=false too`), line);
    });
}

// Found in the F1 temp matrix (C10): an install asked `claude mcp get <name>` whether a server was
// registered already, and the CLI answers from EVERY scope - so a user-scope serena from an earlier
// user-scope run read as this project's, the add was skipped as 'already configured', and only the
// verify pass wrote .mcp.json ('repaired (absent)'). At project scope the run reads .mcp.json itself.
test('seed install (full copy route, project registrations): only .mcp.json says a server is configured here - a user-scope one of the same name does not (C10)', POSIX_ONLY, () =>
{
    const run = (mcpJson) => seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV,
        prepare: (repo, work) =>
        {
            accountMcp(work, { serena: STACK_SERENA });
            if (mcpJson) fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { serena: STACK_SERENA } }));
        },
    });
    const fresh = run(false);
    assert.ok(fresh.calls.some((c) => /^mcp add --scope project serena /.test(c)), `${fresh.calls.filter((c) => /^mcp /.test(c)).join('\n')}\n${fresh.out}`);
    assert.doesNotMatch(fresh.out, /mcp serena already configured/);
    assert.ok(!fresh.calls.some((c) => /^mcp get /.test(c)), 'a project-scope install asked the CLI, which answers from every scope');
    const kept = run(true);
    assert.ok(!kept.calls.some((c) => /^mcp add --scope project serena /.test(c)), kept.calls.join('\n'));
    assert.match(kept.out, /mcp serena already configured - skipping/);
});
