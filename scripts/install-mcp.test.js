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

for (const [route, env] of [['plugin', {}], ['copy', COPY_ENV]])
{
    test(`seed update (${route} route): a 1.x install's cut registration goes with its add-back line, and leaves the trust list`, POSIX_ONLY, () =>
    {
        const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\n', {
            env, prepare: withStamp('1.3.0'),
            inspect: (repo) => JSON.parse(fs.readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')).enabledMcpjsonServers,
        });
        for (const name of ['angular-cli', 'chrome-devtools', 'appium-mcp', 'sentry', 'context7-local'])
            assert.ok(calls.includes(`mcp remove ${name} -s project`), `${name}:\n${calls.filter((c) => /^mcp /.test(c)).join('\n')}`);
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
