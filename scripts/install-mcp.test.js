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
const { execFileSync } = require('node:child_process');

const mcp = require('./install/mcp.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-mcp-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ROUTES = (over = {}) => ({ hooks: true, skills: true, mcps: true, ...over });
const COPY = ROUTES({ hooks: false, skills: false, mcps: false });
const CATALOG = ['navigation|-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena', 'documentation|@HTTP@',
    'memory|@HTTP@', 'browser|-- npx -y @playwright/mcp@1.0'];

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
    const remotes = { documentation: mcp.CONTEXT7_REMOTE };
    assert.deepStrictEqual(mcp.registerSpec({ name: 'documentation', args: '@HTTP@', scope: 'project', remotes }),
        ['mcp', 'add', '--transport', 'http', '--scope', 'project', 'documentation',
            'https://mcp.context7.com/mcp', '--header', 'Context7-API-Key: ${CONTEXT7_API_KEY:-}']);
    // A remote with no header: no --header at all, so its browser consent flow stays on.
    const oauth = mcp.registerSpec({ name: 'documentation', args: '@HTTP@', scope: 'project', remotes: { documentation: { url: 'https://x/mcp/a', header: '' } } });
    assert.ok(!oauth.includes('--header'), oauth.join(' '));
});

// --- R7: the locked three ------------------------------------------------

test('R7: on the plugin route the seed registers NOTHING and retires the whole catalog', () =>
{
    const retired = mcp.retiredMcps({ routes: ROUTES(), catalog: CATALOG, authored: ['old-server'] });
    for (const name of ['navigation', 'documentation', 'memory', 'browser', 'old-server'])
        assert.ok(retired.includes(name), `${name} was not retired: ${retired.join(',')}`);
    // The four engine spellings an earlier release wrote are retired by name - they are not catalog rows.
    for (const e of mcp.PW_ENGINES) assert.ok(retired.includes(`browser-${e}`), retired.join(','));
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes: ROUTES(), mcps: CATALOG }), []);
});

test('R7: the MCP route OFF but the core still on - the locked three stay plugin-carried, the picks come back', () =>
{
    // The middle case, and the one the matrix caught: hooks or skills on means the core entry is
    // enabled, and its `dependencies` already carry serena, context7 and memory.
    const routes = ROUTES({ mcps: false });
    const retired = mcp.retiredMcps({ routes, catalog: CATALOG, authored: [] });
    assert.deepStrictEqual(retired.sort(), [...mcp.LOCKED].sort());
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes, mcps: CATALOG }), ['browser']);
});

test('R7: on the FULL copy route the core is never enabled, so all three come back to .mcp.json', () =>
{
    assert.deepStrictEqual(mcp.retiredMcps({ routes: COPY, catalog: CATALOG, authored: ['old-server'] }), ['old-server']);
    assert.deepStrictEqual(mcp.bareNamedMcps({ routes: COPY, mcps: CATALOG }),
        ['navigation', 'documentation', 'memory', 'browser']);
});

test('R7: a locked server installed as a plugin has no shape to verify', () =>
{
    // Writing the shape back would put the entry the prune just removed straight back in the file.
    const routes = ROUTES({ mcps: false });
    const expects = CATALOG
        .map((e) => ({ name: e.split('|')[0], args: e.split('|')[1] }))
        .filter((e) => !(mcp.isLocked(e.name) && mcp.corePluginOn(routes)))
        .map((e) => e.name);
    assert.deepStrictEqual(expects, ['browser']);
});

// --- the project-scope verify pass ---------------------------------------

test('verify-project: a stale registration the CLI silently refused to rewrite is repaired', () =>
{
    const file = mcpFile({ navigation: { type: 'stdio', command: 'uvx', args: ['--from', 'serena@0.0.1', 'serena'], env: {} } });
    const logs = [];
    const out = mcp.verifyProject({
        mcpFile: file,
        expects: [mcp.expectShape({ name: 'navigation', args: '-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena' })],
        log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(out.repaired, ['navigation']);
    const written = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.navigation;
    assert.deepStrictEqual(written, { type: 'stdio', command: 'uvx', args: ['--from', 'serena@1.0', 'serena'], env: { SERENA_HOME: '.serena/home' } });
    assert.ok(logs.some((m) => /mcp repaired: navigation \(was stdio uvx --from serena@0\.0\.1/.test(m)), logs.join(' | '));
});

test('verify-project: an entry already in the manifest shape is left BYTE-IDENTICAL', () =>
{
    const expect = mcp.expectShape({ name: 'documentation', args: '@HTTP@', remotes: { documentation: { url: 'https://mcp.context7.com/mcp', header: 'CONTEXT7_API_KEY: ${CONTEXT7_API_KEY}' } } });
    // Written with the PROJECT's own formatting, not ours: a no-op that rewrote the file would
    // reformat it, and every release would land as a diff in a repo that commits this file.
    const file = mcpFile();
    fs.writeFileSync(file, `${JSON.stringify({ mcpServers: { documentation: mcp.wantFor(expect) } }, null, 4)}\n`);
    const before = fs.readFileSync(file);
    const out = mcp.verifyProject({ mcpFile: file, expects: [expect] });
    assert.deepStrictEqual(out.repaired, []);
    assert.ok(fs.readFileSync(file).equals(before), 'a no-op verify rewrote the file - every release would look like a diff');
});

test('verify-project: a server the project added by hand is never read, compared or written', () =>
{
    const mine = { type: 'stdio', command: 'node', args: ['x.js'] };
    const file = mcpFile({ 'my-own-server': mine, navigation: { type: 'stdio', command: 'old' } });
    mcp.verifyProject({ mcpFile: file, expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx serena' })] });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['my-own-server'], mine);
});

test('verify-project: malformed or unreadable input is REPORTED and changes nothing', () =>
{
    const bad = mcpFile('{ not json');
    const logs = [];
    const out = mcp.verifyProject({ mcpFile: bad, expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx serena' })], log: (m) => logs.push(m) });
    assert.strictEqual(out.read, false);
    assert.deepStrictEqual(out.repaired, []);
    assert.strictEqual(fs.readFileSync(bad, 'utf8'), '{ not json', 'an unparseable file was overwritten');
    assert.ok(logs.some((m) => /not valid JSON/.test(m)), logs.join(' | '));
});

test('verify-project: an absent file is written from scratch, BOM and all handled', () =>
{
    const missing = path.join(TMP, 'none', 'mcp.json');
    fs.mkdirSync(path.dirname(missing), { recursive: true });
    const out = mcp.verifyProject({ mcpFile: missing, expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx serena' })] });
    assert.deepStrictEqual(out.repaired, ['navigation']);
    const bom = mcpFile();
    fs.writeFileSync(bom, `\uFEFF${JSON.stringify({ mcpServers: { navigation: { type: 'stdio', command: 'uvx', args: ['serena'], env: {} } } })}`);
    assert.deepStrictEqual(mcp.verifyProject({ mcpFile: bom, expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx serena' })] }).repaired, []);
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
    const expect = mcp.expectShape({ name: 'navigation', args: '-e SERENA_HOME=.serena/home -- uvx --from serena@1.0 serena' });
    let fixed = false;
    const out = mcp.verifyUser({
        expects: [expect], scope: 'user',
        getShape: () => (fixed ? 'Type: stdio\n Command: uvx\n Args: --from serena@1.0 serena\n' : 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n'),
        reregister: () => { fixed = true; },
    });
    assert.deepStrictEqual(out.repaired, ['navigation']);
});

// Re-verify 3 S2: an anchored row carries its own `-e` and `--` after the command (`node -e <ROOT_BOOT> -- checkout ...`);
// only the leading env pairs and separator are missing from `mcp get`'s lines, so the rest compares as it is.
test('verify-user: a project-anchored registration as `mcp get` prints it is NOT drift', () =>
{
    const boot = require('../stack/hooks/memory.js').ROOT_BOOT;
    const expect = mcp.expectShape({ name: 'navigation', args: '-e SERENA_HOME=.alfred/serena/home -- node -e @ROOT_BOOT@ -- checkout uvx --from serena-agent==1.7.0 serena', tokens: { ROOT_BOOT: boot } });
    const out = mcp.verifyUser({
        expects: [expect], scope: 'local',
        getShape: () => `navigation:\n  Type: stdio\n  Command: node\n  Args: -e ${boot} -- checkout uvx --from serena-agent==1.7.0 serena\n`,
        reregister: () => assert.fail('an anchored registration read as drifted'),
    });
    assert.deepStrictEqual(out.repaired, []);
});

// Re-verify 3 S8: the pass runs at local scope too, and every line names the run's scope.
test('verify-user: a local-scope repair is labelled local scope', () =>
{
    const lines = [];
    let fixed = false;
    const out = mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx --from serena@1.0 serena' })], scope: 'local',
        getShape: () => (fixed ? 'Type: stdio\n Command: uvx\n Args: --from serena@1.0 serena\n' : 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n'),
        reregister: () => { fixed = true; }, log: (l) => lines.push(l),
    });
    assert.deepStrictEqual(out.repaired, ['navigation']);
    assert.deepStrictEqual(lines, ['  mcp shape drifted at local scope: navigation - re-registering', '  mcp repaired: navigation (local scope)']);
    const notes = [];
    mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx --from serena@1.0 serena' })], scope: 'local',
        getShape: () => 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n', reregister: () => {}, note: (m) => notes.push(m),
    });
    assert.match(notes.join('\n'), /current shape at local scope \(claude mcp remove navigation -s local\)/);
});

test('verify-user: a registration the retry cannot fix is REPORTED, never silently accepted', () =>
{
    const notes = [];
    const out = mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx --from serena@1.0 serena' })], scope: 'user',
        getShape: () => 'Type: stdio\n Command: uvx\n Args: --from serena@0.0.1 serena\n',
        reregister: () => {}, note: (m) => notes.push(m),
    });
    assert.deepStrictEqual(out.repaired, []);
    assert.ok(notes.some((m) => /could not be brought to the current shape/.test(m)), notes.join(' | '));
});

test('verify-user: a server the account config does not expose is skipped, not re-registered', () =>
{
    mcp.verifyUser({
        expects: [mcp.expectShape({ name: 'navigation', args: '-- uvx serena' })], scope: 'user',
        getShape: () => '', reregister: () => assert.fail('an unreadable `mcp get` was treated as drift'),
    });
});

// --- playwright and the tool-name down-convert ---------------------------

test('playwright: the engines this run does not keep are dropped, and the plugin route drops none', () =>
{
    // The 1.x single `playwright` and the four names 2.0.0 renamed go whatever the run keeps.
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: COPY, browsers: ['chrome'] }),
        ['playwright', 'playwright-chrome', 'playwright-msedge', 'playwright-firefox', 'playwright-webkit', 'browser-msedge', 'browser-firefox', 'browser-webkit']);
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: ROUTES(), browsers: ['chrome'] }), []);
    assert.deepStrictEqual(mcp.playwrightDrop({ routes: COPY, browsers: [] }), []);
});

test('down-convert: only the servers this run registered BARE are re-spelled', () =>
{
    // The locked three are plugins beside the core on a hooks-only copy route, so their tool names must
    // keep the plugin spelling while the droppable picks are re-spelled.
    const root = path.join(TMP, `dc-${seq++}`);
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a.md'), 'use mcp__plugin_sentry_sentry__find_issues and mcp__plugin_navigation_navigation__find_symbol\n'); // mcp-fixture
    fs.writeFileSync(path.join(root, 'sub', 'b.yml'), 'mcp__plugin_sentry_sentry__find_issues\n'); // mcp-fixture
    const logs = [];
    const n = mcp.downconvertToolNames({ roots: [root], bare: ['sentry'], log: (m) => logs.push(m) });
    assert.strictEqual(n, 1);
    // The expected bare spelling is BUILT, never typed: lint check 54 bans the literal everywhere
    // under scripts/, and the down-converter itself builds it the same way.
    const bareTool = (server, tool) => `mcp__${server}__${tool}`;
    assert.strictEqual(fs.readFileSync(path.join(root, 'a.md'), 'utf8'),
        `use ${bareTool('sentry', 'find_issues')} and mcp__plugin_navigation_navigation__find_symbol\n`);
    assert.match(fs.readFileSync(path.join(root, 'sub', 'b.yml'), 'utf8'), /mcp__plugin_sentry_sentry__/, 'a .yml is not a target extension'); // mcp-fixture
    assert.ok(logs.some((m) => /re-spelled .* in 1 file/.test(m)), logs.join(' | '));
});

test('down-convert: an empty bare list touches nothing', () =>
{
    const root = path.join(TMP, `dc-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.md'), 'mcp__plugin_sentry_sentry__x\n'); // mcp-fixture
    assert.strictEqual(mcp.downconvertToolNames({ roots: [root], bare: [] }), 0);
    assert.match(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), /mcp__plugin_sentry_sentry__x/); // mcp-fixture
});

// --- the playwright expansion --------------------------------------------

test('playwright: the one manifest row becomes one entry per kept engine, each with its own profile', () =>
{
    const row = 'browser|-- npx -y @playwright/mcp@0.0.80 --user-data-dir .playwright';
    const out = mcp.expandPlaywright({ mcps: ['navigation|-- uvx serena', row], browsers: ['chrome', 'firefox'] });
    assert.deepStrictEqual(out.mcps, [
        'navigation|-- uvx serena',
        'browser-chrome|-- npx -y @playwright/mcp@0.0.80 --browser chrome --user-data-dir .playwright/chrome',
        'browser-firefox|-- npx -y @playwright/mcp@0.0.80 --browser firefox --user-data-dir .playwright/firefox',
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
    const mcps = ['navigation|-- uvx serena'];
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
        pins: { browser: { version: '0.0.80', spelling: '@<v>' }, navigation: { version: null }, memory: { version: '1 2' } },
        log: (m) => logs.push(m),
    });
    assert.strictEqual(pins.PW_PIN, '@0.0.80');
    assert.strictEqual(pins.SERENA_PIN, '', 'a null version ships unpinned, as the generator does');
    assert.strictEqual(pins.MEMORY_PIN, '', 'a version no package manager can read is no pin');
    assert.ok(logs.some((m) => /pinned browser@0\.0\.80 \(the release pin\)/.test(m)), logs.join(' | '));
    assert.ok(logs.some((m) => /no release pin for navigation in this source - installing unpinned/.test(m)), logs.join(' | '));
    for (const garbage of [undefined, null, 'x', []])
        assert.strictEqual(mcp.resolvePins({ pins: garbage }).PW_PIN, '', `pins=${JSON.stringify(garbage)}`);
});

// M24: the copy route registers uvx itself, so each uvx row carries the release's dependency cut-off - the pins
// file's refreshed day, its last second UTC - right after the Python pin, the same value the plugin entries pass
// their launchers. A source with no refreshed day registers no cut-off, and no empty argv word either.
test('M24 pins: the copy route\'s uvx rows carry the release cut-off, and none when the pins file names no day', () =>
{
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8'));
    const pins = mcp.resolvePins({ pins: file.pins, refreshed: file.refreshed });
    assert.strictEqual(pins.UV_EXCLUDE_FLAG, '--exclude-newer');
    assert.strictEqual(pins.UV_EXCLUDE_NEWER, `${file.refreshed}T23:59:59Z`);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const tokens = { ...pins, UV_PYTHON: '3.13' };
    for (const row of manifest.mcps.filter((m) => /\buvx\b/.test(m.args)))
    {
        const words = mcp.mcpArgv(row.args, tokens);
        const at = words.indexOf('--python');
        assert.deepStrictEqual(words.slice(at, at + 4), ['--python', '3.13', '--exclude-newer', pins.UV_EXCLUDE_NEWER], `${row.name}: ${words.join(' ')}`);
        const bare = mcp.mcpArgv(row.args, { ...mcp.resolvePins({ pins: file.pins }), UV_PYTHON: '3.13' });
        assert.ok(!bare.includes('--exclude-newer') && !bare.includes(''), `${row.name} with no day: ${JSON.stringify(bare)}`);
    }
    assert.strictEqual(manifest.mcps.filter((m) => /\buvx\b/.test(m.args)).length, 4, 'navigation, memory and the two desktop servers');
});

// An index that publishes no PEP 700 upload time (a private mirror) makes every file unavailable under a cut-off, and
// a baked `--exclude-newer` beats uv's own UV_EXCLUDE_NEWER - so the user's value, read where the stack reads its other
// settings, is what the copy route registers: their date, or no cut-off at all for `false`.
test('M24 pins: a UV_EXCLUDE_NEWER the user set replaces the release cut-off - their value, or none for false - said once', () =>
{
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8'));
    const run = (own) => { const logs = []; return { pins: mcp.resolvePins({ pins: file.pins, refreshed: file.refreshed, own, log: (m) => logs.push(m) }), logs }; };
    const off = run('false');
    assert.deepStrictEqual([off.pins.UV_EXCLUDE_FLAG, off.pins.UV_EXCLUDE_NEWER], ['', '']);
    assert.strictEqual(off.logs.filter((m) => /UV_EXCLUDE_NEWER/.test(m)).length, 1, off.logs.join(' | '));
    assert.match(off.logs.find((m) => /UV_EXCLUDE_NEWER/.test(m)), /UV_EXCLUDE_NEWER=false is set - every uvx server starts with no dependency cut-off/);
    const dated = run('2026-01-15T00:00:00Z');
    assert.deepStrictEqual([dated.pins.UV_EXCLUDE_FLAG, dated.pins.UV_EXCLUDE_NEWER], ['--exclude-newer', '2026-01-15T00:00:00Z']);
    const absent = run('');
    assert.deepStrictEqual([absent.pins.UV_EXCLUDE_FLAG, absent.pins.UV_EXCLUDE_NEWER], ['--exclude-newer', `${file.refreshed}T23:59:59Z`]);
    assert.ok(!absent.logs.some((m) => /UV_EXCLUDE_NEWER/.test(m)), 'no line when the user set nothing');
    // Read the way every other user-set value is: the run's env, then settings.local.json, settings.json, the account.
    const { userExcludeNewer } = require('../stack/mcp/uv-python.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uv-exclude-'));
    try
    {
        fs.mkdirSync(path.join(dir, '.claude'));
        fs.mkdirSync(path.join(dir, 'acct'));
        const acct = { CLAUDE_CONFIG_DIR: path.join(dir, 'acct') };
        fs.writeFileSync(path.join(dir, 'acct', 'settings.json'), JSON.stringify({ env: { UV_EXCLUDE_NEWER: '2026-02-01' } }));
        assert.strictEqual(userExcludeNewer({ env: acct, projectDir: dir }), '2026-02-01', 'the account settings');
        fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env: { UV_EXCLUDE_NEWER: 'false' } }));
        assert.strictEqual(userExcludeNewer({ env: acct, projectDir: dir }), 'false', 'the project settings over the account');
        fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ env: { UV_EXCLUDE_NEWER: '2026-03-01' } }));
        assert.strictEqual(userExcludeNewer({ env: acct, projectDir: dir }), '2026-03-01', 'this machine\'s file over the shared one');
        assert.strictEqual(userExcludeNewer({ env: { ...acct, UV_EXCLUDE_NEWER: ' false ' }, projectDir: dir }), 'false', 'the run\'s own env first');
        assert.strictEqual(userExcludeNewer({ env: {}, projectDir: undefined }), '');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M26: serena 1.7.0's --project-from-cwd finds a project only by `.serena/project.yml` or `.git` walking up (cli.py
// find_project_root), so a project with no `.git` of its own whose serena folder moved under the data root activates an
// ancestor or nothing. The plugin launcher names the cwd there (serena-launch.js projectArgs); the copy route, which
// runs no launcher, registers the same choice - `--project .`, which serena resolves against its cwd, the project.
test('M26 copy route: the navigation row names the project outright where --project-from-cwd cannot find it', () =>
{
    const { copyRouteProject } = require('../stack/mcp/serena-launch.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-project-'));
    try
    {
        assert.deepStrictEqual(copyRouteProject({ projectDir: dir, serenaDir: '.alfred/serena' }), { SERENA_PROJECT_FLAG: '--project', SERENA_PROJECT_DIR: '.' }, 'no .git, the folder moved');
        assert.deepStrictEqual(copyRouteProject({ projectDir: dir, serenaDir: '.serena' }), { SERENA_PROJECT_FLAG: '--project-from-cwd', SERENA_PROJECT_DIR: '' }, 'a 2.0.0 .serena is found from the cwd');
        fs.mkdirSync(path.join(dir, '.git'));
        assert.deepStrictEqual(copyRouteProject({ projectDir: dir, serenaDir: '.alfred/serena' }), { SERENA_PROJECT_FLAG: '--project-from-cwd', SERENA_PROJECT_DIR: '' }, 'a .git is found from the cwd');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const row = manifest.mcps.find((m) => m.name === 'navigation').args;
    const words = (t) => mcp.mcpArgv(row, { UV_PYTHON: '3.13', SERENA_HOME: '.alfred/serena/home', SERENA_CONTEXT: 'claude-code', ...t });
    assert.deepStrictEqual(words({ SERENA_PROJECT_FLAG: '--project', SERENA_PROJECT_DIR: '.' }).slice(-2), ['--project', '.']);
    assert.deepStrictEqual(words({ SERENA_PROJECT_FLAG: '--project-from-cwd', SERENA_PROJECT_DIR: '' }).slice(-1), ['--project-from-cwd']);
});

test('pins: each is spelled as its row says - memory ==<ver> inside the extras brackets, the others @<ver>', () =>
{
    // It sits INSIDE the extras brackets - `mcp-memory-service[sqlite]==<ver>` - where an @ would
    // not parse.
    const rel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins;
    const pins = mcp.resolvePins({ pins: rel });
    assert.strictEqual(pins.MEMORY_PIN, `==${rel.memory.version}`);
    assert.strictEqual(pins.SERENA_PIN, `@${rel.navigation.version}`);
    assert.strictEqual(pins.PW_PIN, `@${rel.browser.version}`);
    assert.strictEqual(pins.MEMORY_BACKEND, 'sqlite_vec');
    // The desktop servers run `uvx --from windows-mcp==<ver>` / `macos-mcp==<ver>` on the copy route.
    assert.strictEqual(pins.WINDOWS_DESKTOP_PIN, `==${rel['windows-desktop'].version}`);
    assert.strictEqual(pins.MACOS_DESKTOP_PIN, `==${rel['macos-desktop'].version}`);
});

// The copy route registers no launcher, so windows-desktop's tool gate reaches Windows-MCP as its own
// WINDOWS_MCP_EXCLUDE_TOOLS, resolved at install time from the same setting the launcher reads.
test('copy route: windows-desktop registers with the release pin and the tool gate as Windows-MCP\'s own env, both desktop servers with telemetry off', () =>
{
    const manifest = require('./install/manifest.js').loadManifest(path.join(__dirname, '..'));
    const row = manifest.catalogs.mcps.find((e) => e.startsWith('windows-desktop|'));
    const mac = manifest.catalogs.mcps.find((e) => e.startsWith('macos-desktop|'));
    assert.ok(row && mac, 'both desktop servers are catalog rows');
    const { copyRouteExclude } = require('../stack/mcp/desktop-launch.js');
    const tokens = { UV_PYTHON: '3.13', WINDOWS_DESKTOP_PIN: '==0.8.5', MACOS_DESKTOP_PIN: '==0.4.6', WINDOWS_DESKTOP_EXCLUDE: copyRouteExclude({ env: {} }),
        UV_EXCLUDE_FLAG: '--exclude-newer', UV_EXCLUDE_NEWER: '2026-09-29T23:59:59Z' };
    const argv = mcp.registerSpec({ name: 'windows-desktop', args: row.slice(row.indexOf('|') + 1), scope: 'project', tokens });
    // I10: FileSystem (write, copy, move, delete) is off on this route too. M41: WINDOWS_MCP_TOOLS (Windows-MCP's
    // --tools, which OVERRIDES --exclude-tools) is registered EMPTY - click reads an empty variable as unset - so
    // one inherited from the shell never lifts the gate.
    assert.deepStrictEqual(argv, ['mcp', 'add', '--scope', 'project', 'windows-desktop', '-e', 'WINDOWS_MCP_EXCLUDE_TOOLS=PowerShell,Registry,Process,FileSystem',
        '-e', 'WINDOWS_MCP_TOOLS=', '-e', 'ANONYMIZED_TELEMETRY=false', '--', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve']);
    assert.deepStrictEqual(mcp.registerSpec({ name: 'macos-desktop', args: mac.slice(mac.indexOf('|') + 1), scope: 'project', tokens }),
        ['mcp', 'add', '--scope', 'project', 'macos-desktop', '-e', 'ANONYMIZED_TELEMETRY=false', '--', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'],
        'the upstream telemetry is off on the copy route too');
    assert.strictEqual(copyRouteExclude({ env: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'none' } }), '', 'none leaves Windows-MCP its own config');
    assert.strictEqual(copyRouteExclude({ env: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'PowerShell' } }), 'PowerShell');
    // M41: the copy route's override is checked like the launcher's - case mended, a list of no real tool is the default.
    assert.strictEqual(copyRouteExclude({ env: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'powershell' } }), 'PowerShell');
    assert.strictEqual(copyRouteExclude({ env: { ALFRED_CODE_WINDOWS_DESKTOP_EXCLUDE: 'bogus' } }), 'PowerShell,Registry,Process,FileSystem');
    assert.strictEqual(mcp.identityOf({ command: 'uvx', args: ['--python', '3.13', '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve'] }), 'stdio:windows-mcp');
});

// Opt-in by design: a server that clicks through the user's own desktop never arrives by default, so the
// desktop rows ship `active: false` - in the catalog, out of a run that names no selection.
test('the desktop servers are shipped but never in the no-selection default', () =>
{
    const manifest = require('./install/manifest.js').loadManifest(path.join(__dirname, '..'));
    const names = (list) => list.map((e) => e.split('|')[0]);
    for (const name of ['windows-desktop', 'macos-desktop'])
    {
        assert.ok(names(manifest.catalogs.mcps).includes(name), `${name} is not in the shipped catalog`);
        assert.ok(!names(manifest.mcps).includes(name), `${name} is in the default list a bare install takes`);
    }
});

// 2.0.0 cut the local npx transport (R32): the manifest ships context7 as the hosted remote row, which
// the copy route registers from `remotes.context7` - no placeholder left to resolve, and no second row.
test('context7 row: the manifest ships the hosted remote only', () =>
{
    const { loadManifest } = require('./install/manifest.js');
    const manifest = loadManifest(path.join(__dirname, '..'));
    assert.deepStrictEqual(manifest.mcps.filter((e) => e.startsWith('documentation')), ['documentation|@HTTP@']);
    assert.ok(!manifest.rows.mcps.some((r) => r.variants), 'no transport variants left on any row');
});

test('documentation remote: the copy route registers the url and header the documentation plugin entry carries', () =>
{
    const entry = require('../.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'documentation');
    const server = entry.mcpServers.documentation;
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
// Re-verify 3 S4 / S7: with no ledger row at a scope, a local- or user-scope registration is the stack's only in the release
// template's exact shape - here a v2.1.5 one, an older pin and no anchor.
const STACK_PW_EXACT = (e) => ({ type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.80', '--browser', e,
    '--user-data-dir', `\${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/${e}`, '--output-dir', `\${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/${e}/output`, '--no-webmcp'], env: {} });

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
    assert.match(logs.join('\n'), /mcp navigation: locked/);
    assert.deepStrictEqual(mcp.withLocked({ mcps: out, catalog: CATALOG }), out, 'idempotent');
    assert.deepStrictEqual(mcp.withLocked({ mcps: [], catalog: [CATALOG[3]] }), [], 'a catalog without them adds nothing');
});

test('seed update --installed-only (full copy route): a plugin-route install whose selection named no server gets the locked three registered (R83 a)', POSIX_ONLY, () =>
{
    const listing = JSON.stringify(['alfred-code', 'navigation', 'documentation', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.0.0', scope: 'project', enabled: true })));
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
    assert.match(result, /^installed-always-mcps: .*\bnavigation\b/m, result);
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
const STACK_ROWS = (key, over = {}) => ['alfred-code', 'navigation', 'documentation', 'memory']
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
            { id: 'documentation@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true },
            { id: 'typescript-lsp@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true }];
        const { calls, out, result } = switchRun(rows);
        const disables = calls.filter((c) => /^plugin disable /.test(c));
        assert.deepStrictEqual([...disables].sort(), ['alfred-code', 'documentation', 'memory', 'navigation'].map((n) => `plugin disable ${n}@${key} --scope project`),
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
    const rows = STACK_ROWS('envoydev', { 'alfred-code': { enabled: false }, navigation: { enabled: false }, documentation: { enabled: false }, memory: { scope: 'user' } });
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
const LEGACY_ROWS = (over = {}) => ['claude-stack', 'claude-stack-hooks', 'navigation', 'documentation', 'memory'] // legacy-name
    .map((n) => ({ id: `${n}@claude-stack`, version: '1.3.0', scope: 'project', enabled: true, ...(over[n] || {}) })); // legacy-name

test('seed update (full copy route): a 1.3.0 plugin-route install switched straight to the copies has its 1.x ids disabled too, under the stack key only (R111)', POSIX_ONLY, () =>
{
    const rows = [...LEGACY_ROWS(),
        { id: 'claude-stack-hooks@a-fork', version: '1.0.0', scope: 'project', enabled: true }, // legacy-name
        { id: 'memory@claude-plugins-official', version: '1.0.0', scope: 'project', enabled: true }];
    const { calls, out, result } = switchRun(rows);
    const disables = calls.filter((c) => /^plugin disable /.test(c));
    assert.deepStrictEqual([...disables].sort(), ['claude-stack', 'claude-stack-hooks', 'documentation', 'memory', 'navigation'] // legacy-name
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
    const rows = LEGACY_ROWS({ 'claude-stack': { enabled: false }, 'claude-stack-hooks': { enabled: false }, navigation: { enabled: false }, documentation: { enabled: false }, memory: { enabled: false } }); // legacy-name
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
        const rows = STACK_ROWS('envoydev', { navigation: { enabled: false, scope } });
        const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\n', {
            plugins: JSON.stringify(rows), tools: { claude: stub },
            args: [['--scope', scope], ['--scope', scope, '--installed-only']],
        });
        assert.ok(calls.includes(`plugin enable navigation@envoydev --scope ${scope}`), `no stale-flag enable ran:\n${calls.join('\n')}`);
        assert.doesNotMatch(out, /!! .*plugin enable/, out);
    });
}

// The listing's own flag is not the word on whether a row runs: it read a running project-scope core
// as off (docs/rebrand-evidence.md S22), and a no-op disable exits 1 (S28). The settings file at the
// row's scope is, when it names the plugin - the same read the playwright engines take.
test('seed update (full copy route): the settings file, not the listing flag, says which stack rows are on (R111)', POSIX_ONLY, () =>
{
    const rows = STACK_ROWS('envoydev', { 'alfred-code': { enabled: false }, navigation: { enabled: true } });
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
            data.enabledPlugins = { ...(data.enabledPlugins || {}), 'alfred-code@envoydev': true, 'navigation@envoydev': false };
            fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
            return null;
        },
    });
    const disables = calls.filter((c) => /^plugin disable /.test(c)).sort();
    assert.deepStrictEqual(disables, ['alfred-code', 'documentation', 'memory'].map((n) => `plugin disable ${n}@envoydev --scope project`), `${disables.join('\n')}\n${out}`);
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
        // 2.1.0: the core carries every seat and no skill - the skills were copies all along.
        const core = require('./plugin-placement.js').placement().plugins['alfred-code'];
        const seat = 'code-style-analyzer';
        assert.ok(core.agents.includes(seat) && core.agents.length === 44 && core.skills.length === 0, 'fixture: the core carries every seat and no skill');
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
        assert.ok(result.skills.includes('markdown-style'), `the picked skill copy stays:\n${out}`);
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
    { id: 'browser-chrome@envoydev', version: '1.0.0', scope: 'project', enabled: true },
    { id: 'browser-firefox@envoydev', version: '1.0.0', scope: 'user', enabled: true },
    { id: 'browser-webkit@envoydev', version: '1.0.0', scope: 'project', enabled: false },
    { id: 'browser-chrome@a-fork', version: '1.0.0', scope: 'project', enabled: true },
];
const pwProject = (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 2.0.0\nbrowser-engines: chrome,firefox,webkit\nbrowser-enabled: chrome,firefox\n');
};
const MCP_COPY_ENV = { ALFRED_CODE_MCPS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };

for (const [route, env] of [['MCP copy route', MCP_COPY_ENV], ['full copy route', COPY_ENV]])
{
    test(`seed update (${route}): a playwright engine registered in .mcp.json has its plugin row at this scope uninstalled first, under the stack key only (R111)`, POSIX_ONLY, () =>
    {
        const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
            plugins: JSON.stringify(PW_ROWS), env, args: ['--playwright-browsers', 'chrome,firefox,webkit'], prepare: pwProject,
            inspect: (repo) => Object.keys(JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8')).mcpServers || {}),
        });
        for (const e of ['chrome', 'firefox', 'webkit']) assert.ok(result.includes(`browser-${e}`), `browser-${e} not registered: ${result.join(',')}\n${out}`);
        const engineMoves = calls.filter((c) => /^plugin (install|uninstall|disable|enable) browser-/.test(c));
        // R116: the row left off goes too - the stamp is then the one record the switch back reads.
        assert.deepStrictEqual(engineMoves, ['chrome', 'webkit'].map((e) => `plugin uninstall browser-${e}@envoydev --scope project -y`), `${engineMoves.join('\n')}\n${out}`);
        const gone = calls.indexOf('plugin uninstall browser-chrome@envoydev --scope project -y');
        assert.ok(calls.findIndex((c) => /^mcp add .*browser-/.test(c)) > gone, `an engine was registered before its plugin went:\n${calls.join('\n')}`);
        assert.match(out, /plugin uninstalled \[project\]: browser-chrome@envoydev \(the copy route registers it in \.mcp\.json/);
        assert.match(out, /browser-firefox@envoydev is enabled at user scope, not this run's - .*claude plugin uninstall browser-firefox@envoydev --scope user/);
        const stackDisables = calls.filter((c) => /^plugin disable (alfred-code|navigation|documentation|memory)@/.test(c));
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
    ...['chrome', 'firefox', 'webkit'].map((e) => ({ id: `browser-${e}@envoydev`, version: '2.0.0', scope: 'project', enabled: e !== 'webkit', ...(over[e] || {}) })),
];
const jsonAt = (repo, rel) => { try { return JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8')); } catch { return {}; } };
const pwState = (repo, settingsFile = 'settings.json') => ({
    stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8').split('\n').filter((l) => /^browser-(engines|enabled):/.test(l)),
    mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}).filter((n) => n.startsWith('browser-')),
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
const engineMovesOf = (calls) => calls.filter((c) => /^plugin (install|uninstall|disable|enable) browser-/.test(c));
const PW_STAMP = ['browser-engines: chrome,firefox,webkit', 'browser-enabled: chrome,firefox'];

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
    assert.deepStrictEqual(toCopy.mcp, ['browser-chrome', 'browser-firefox', 'browser-webkit'], outs[0]);
    assert.deepStrictEqual(toCopy.disabled, ['browser-webkit'], 'the engine left off loads on the copy route');
    // Every stamped engine's row goes, the one left off included: the stamp is then the one record the
    // switch back reads, and a row left installed would override a choice the user made on the copy route.
    assert.deepStrictEqual(engineMovesOf(toCopy.calls), ['chrome', 'firefox', 'webkit'].map((e) => `plugin uninstall browser-${e}@envoydev --scope project -y`), outs[0]);
    assert.deepStrictEqual(back.stamp, PW_STAMP, `the switch back lost the record:\n${outs[1]}`);
    assert.deepStrictEqual(engineMovesOf(back.calls), [
        'plugin install browser-chrome@envoydev --scope project -y',
        'plugin install browser-firefox@envoydev --scope project -y',
        'plugin install browser-webkit@envoydev --scope project -y',
        'plugin disable browser-webkit@envoydev --scope project',
    ], outs[1]);
    assert.ok(back.calls.includes('mcp remove browser-webkit -s project'), back.calls.join('\n'));
    assert.strictEqual(back.disabled, undefined, 'a disabledMcpjsonServers entry for a server no longer registered is dead config');
});

test('seed install (MCP copy route): an engine installed but not enabled is registered and named in disabledMcpjsonServers, and a re-run changes nothing (R116 j)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp browser\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'], ['--installed-only'], ['--installed-only']],
        each: (repo) => pwState(repo),
    });
    const [first, update, again] = steps;
    assert.deepStrictEqual(first.mcp, ['browser-chrome', 'browser-webkit'], outs[0]);
    assert.deepStrictEqual(first.disabled, ['browser-webkit'], outs[0]);
    assert.match(outs[0], /browser: webkit left off - disabledMcpjsonServers keeps it from loading/);
    assert.deepStrictEqual(first.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome']);
    // The first update adopts the locked three (the sandbox listing has no core row) - its own change;
    // the list and the stamp hold from the install on, and the next re-run changes nothing at all.
    assert.deepStrictEqual(update.disabled, first.disabled, outs[1]);
    assert.deepStrictEqual(update.stamp, first.stamp);
    assert.strictEqual(again.settings, update.settings, `the re-run changed settings.json:\n${outs[2]}`);
    assert.deepStrictEqual(again.stamp, first.stamp);
});

test('seed update (MCP copy route): an engine the user enables stays enabled across re-runs, and only an answer that changes it moves the list (R116 j)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nmcp browser\n', {
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
    assert.ok(!(kept.disabled || []).includes('browser-webkit'), `a re-run switched the user's engine back off:\n${outs[1]}`);
    assert.deepStrictEqual(kept.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome,webkit'], 'the stamp keeps the live choice');
    assert.deepStrictEqual(answeredOff.disabled, ['browser-webkit'], outs[2]);
    assert.deepStrictEqual(answeredOff.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome']);
    assert.ok(!(answeredOn.disabled || []).includes('browser-webkit'), outs[3]);
    assert.deepStrictEqual(answeredOn.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome,webkit']);
});

// M1 (R132): the run READS a rejection from settings.json, settings.local.json and the account file,
// but wrote the answer only to its own file - and Claude Code's approval dialog writes a rejection to
// settings.local.json. An enable answer then left the engine rejected while the stamp said enabled,
// and the next run flipped the stamp back. The answer now takes the name out of the local file too; the
// account file is never edited, so an entry there is named with its file instead.
test('seed update (MCP copy route): an enable answer takes the engine out of settings.local.json too, and names the account file that still rejects one (M1)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp browser\n', {
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
                fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), `${JSON.stringify({ disabledMcpjsonServers: ['browser-webkit'], permissions: { allow: ['Bash(ls)'] } }, null, 2)}\n`);
                const acct = jsonAt(path.dirname(account), 'settings.json');
                fs.mkdirSync(path.dirname(account), { recursive: true });
                fs.writeFileSync(account, `${JSON.stringify({ ...acct, disabledMcpjsonServers: ['browser-firefox'] }, null, 2)}\n`);
            }
            return state;
        },
    });
    const [, answered, again] = steps;
    assert.deepStrictEqual(answered.local, undefined, `the local rejection survived the enable answer:\n${outs[1]}`);
    // C8: `env` is the machine's memory path, which settings.local.json holds at every scope.
    assert.deepStrictEqual(answered.localKeys, ['permissions', 'env'], 'the user\'s own local key went');
    assert.ok(!(answered.disabled || []).includes('browser-webkit'), outs[1]);
    assert.match(outs[1], /settings\.local\.json: disabledMcpjsonServers - browser-webkit/);
    assert.match(outs[1], /browser-firefox is still rejected by .*acct\/settings\.json's disabledMcpjsonServers/);
    assert.match(answered.account, /"browser-firefox"/, 'the account file was edited');
    assert.deepStrictEqual(again.stamp, ['browser-engines: chrome,firefox,webkit', 'browser-enabled: chrome,webkit'], `the next run flipped the stamp:\n${outs[2]}`);
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
                fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), `sha: abc\nversion: 2.0.0\nbrowser-engines: chrome,webkit\nbrowser-enabled: ${stampEnabled}\n`);
                const server = (e) => ({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.82', '--browser', e] });
                fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { 'browser-chrome': server('chrome'), 'browser-webkit': server('webkit') } }));
                fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ disabledMcpjsonServers: disabled }));
            },
            inspect: (repo) => JSON.parse(fs.readFileSync(path.join(path.dirname(repo), 'plan.json'), 'utf8')).browser,
        });
        return result;
    };
    assert.deepStrictEqual(planFor(['browser-webkit'], 'chrome,webkit'), { installed: ['chrome', 'webkit'], enabled: ['chrome'] });
    assert.deepStrictEqual(planFor([], 'chrome'), { installed: ['chrome', 'webkit'], enabled: ['chrome', 'webkit'] });
});

// R124 (Task 8a concern l): at local and user scope no settings key reaches a registration - measured,
// disabledMcpjsonServers rejects only .mcp.json servers - so there the registration IS the enable. An
// engine left off is NOT registered (an earlier registration of it is removed), the stamp still records it
// installed-off, its browser is still downloaded, and a later enable answer registers it.
const engineAdds = (calls) => calls.filter((c) => /^mcp add /.test(c)).map((c) => (/\bbrowser-(chrome|msedge|firefox|webkit)\b/.exec(c) || [])[1]).filter(Boolean);
for (const scope of ['user', 'local'])
{
    test(`seed install + update (MCP copy route, ${scope} scope): an engine left off is not registered, the stamp keeps it installed-off, and no /mcp line is printed (R124 l)`, POSIX_ONLY, () =>
    {
        const settingsFile = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nmcp browser\n', {
            env: MCP_COPY_ENV,
            // A-M2 / re-verify 3 S4: a local- or user-scope removal takes only a registration the stack vouches for - with no
            // ledger, the release template's exact shape - so the earlier webkit registration is laid out in the account file.
            prepare: (repo, work) => (scope === 'user' ? accountMcp(work, { 'browser-webkit': STACK_PW_EXACT('webkit') })
                : accountMcp(work, {}, { [fs.realpathSync(repo)]: { mcpServers: { 'browser-webkit': STACK_PW_EXACT('webkit') } } })),
            args: [['--scope', scope, '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'], ['--scope', scope, '--installed-only']],
            each: (repo) => ({ ...pwState(repo, settingsFile), calls: stepCalls(repo) }),
        });
        for (const [i, step] of steps.entries())
        {
            // The recording stub answers `mcp get`, so an install reads every name as configured already
            // and adds none; an update removes and re-adds, so its adds are the whole registration.
            const looked = [...new Set(step.calls.filter((c) => /^mcp get browser-/.test(c)).map((c) => c.split(' ')[2]))];
            assert.deepStrictEqual(i === 0 ? looked : engineAdds(step.calls), i === 0 ? ['browser-chrome'] : ['chrome'],
                `step ${i} registered an engine left off:\n${step.calls.join('\n')}\n${outs[i]}`);
            assert.ok(step.calls.includes(`mcp remove browser-webkit -s ${scope}`), `step ${i} left an earlier webkit registration in place:\n${step.calls.join('\n')}`);
            assert.deepStrictEqual(step.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome'], `step ${i}: ${outs[i]}`);
            assert.strictEqual(step.disabled, undefined, 'no settings key reaches a local- or user-scope registration');
            assert.doesNotMatch(outs[i], /run \/mcp and disable/, `step ${i} named a /mcp switch for an engine it did not register`);
            assert.match(outs[i], new RegExp(`browser: webkit left off - not registered at ${scope} scope`), outs[i]);
            assert.match(outs[i], /browser: downloading the webkit build the server launches/, `step ${i} dropped the browser download`);
        }
    });
}

test('seed update (MCP copy route, user scope): a later enable answer registers the engine left off, and turning it off again removes it (R124 l)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp browser\n', {
        env: MCP_COPY_ENV,
        // A-M2 / re-verify 3 S4: the registrations the account holds, in the stack's exact shape; the stand-in CLI keeps the
        // account file as the real one does, so the ledger each run writes is the one the next reads.
        account: true,
        prepare: (repo, work) => accountMcp(work, { 'browser-chrome': STACK_PW_EXACT('chrome'), 'browser-webkit': STACK_PW_EXACT('webkit') }),
        args: [['--scope', 'user', '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'],
            ['--scope', 'user', '--installed-only', '--playwright-enabled', 'all'], ['--scope', 'user', '--installed-only', '--playwright-enabled', 'chrome']],
        each: (repo) => ({ ...pwState(repo), calls: stepCalls(repo) }),
    });
    const [, on, off] = steps;
    assert.deepStrictEqual(engineAdds(on.calls), ['chrome', 'webkit'], `the enable did not register webkit:\n${on.calls.join('\n')}\n${outs[1]}`);
    assert.deepStrictEqual(on.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome,webkit']);
    assert.deepStrictEqual(engineAdds(off.calls), ['chrome'], outs[2]);
    assert.ok(off.calls.includes('mcp remove browser-webkit -s user'), off.calls.join('\n'));
    assert.deepStrictEqual(off.stamp, ['browser-engines: chrome,webkit', 'browser-enabled: chrome']);
});

// Re-verify 4 T1 (aMcpUser, bMcpUser): the MCP copy route with the core on registers each browser engine at USER scope, so
// its row starts in every project on the account. ROOT_BOOT required the first .claude/hooks/memory.js above the launch
// directory - a file planted above another repo was executed from it - and in a repo never set up the row refused where
// base started it. The row is started as Claude Code would, from each place, with a recording npx.
test('seed install (MCP copy route, user scope): the browser row runs no engine planted above a repo or a folder with no git, and starts in a repo never set up at its top level', POSIX_ONLY, () =>
{
    const { result } = seedRun('install', 'skill markdown-style\nmcp browser\n', {
        env: MCP_COPY_ENV, account: true,
        args: ['--scope', 'user', '--playwright-browsers', 'chrome', '--playwright-enabled', 'chrome'],
        inspect: (repo) =>
        {
            const work = path.dirname(repo);
            const row = JSON.parse(fs.readFileSync(path.join(work, 'acct', '.claude.json'), 'utf8')).mcpServers['browser-chrome'];
            const mark = path.join(work, 'planted-ran');
            const plant = (dir) =>
            {
                fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
                fs.writeFileSync(path.join(dir, '.claude', 'hooks', 'memory.js'), `require('fs').writeFileSync(${JSON.stringify(mark)}, __filename); module.exports = { runAtRoot() {} };\n`);
            };
            const bin = path.join(work, 'anchor-bin');
            const record = path.join(work, 'anchor.json');
            fs.mkdirSync(bin, { recursive: true });
            fs.writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env node\nconst a=process.argv.slice(2);require('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ cwd: process.cwd(), profile: require('path').resolve(a[a.indexOf('--user-data-dir')+1]) }));\n`, { mode: 0o755 });
            const shared = path.join(work, 'shared');
            plant(shared);
            const clone = path.join(shared, 'clone');
            fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
            fs.mkdirSync(path.join(clone, 'sub'));
            const plain = path.join(work, 'shared2', 'plain', 'sub');
            plant(path.join(work, 'shared2'));
            fs.mkdirSync(plain, { recursive: true });
            const fresh = path.join(work, 'fresh');
            fs.mkdirSync(path.join(fresh, '.git'), { recursive: true });
            fs.mkdirSync(path.join(fresh, 'pkg'));
            // Another machine's home, outside every folder above: the walk stops at a home, which must not be what saves it.
            const home = path.join(work, 'elsewhere-home');
            fs.mkdirSync(home);
            const started = [path.join(clone, 'sub'), plain, path.join(fresh, 'pkg')].map((cwd) =>
            {
                fs.rmSync(record, { force: true });
                execFileSync(row.command, row.args, { cwd, env: { PATH: bin + path.delimiter + process.env.PATH, HOME: home, ...(row.env || {}) }, stdio: 'pipe' });
                return JSON.parse(fs.readFileSync(record, 'utf8'));
            });
            return { row, started, ran: fs.existsSync(mark), roots: [clone, plain, fresh].map((d) => fs.realpathSync(d)) };
        },
    });
    assert.strictEqual(result.row.args[0], '-e', `the user-scope row is not anchored: ${JSON.stringify(result.row)}`);
    assert.strictEqual(result.ran, false, 'a planted engine ran');
    assert.deepStrictEqual(result.started.map((s) => s.cwd), result.roots);
    assert.deepStrictEqual(result.started.map((s) => s.profile), result.roots.map((r) => path.join(r, '.alfred', 'browser', 'chrome')));
});

// Re-verify 4 T7 (xOwnNew, s7b): a pick whose name the user's own local- or user-scope registration holds is kept as
// theirs and named - and it stays a pick in the install's record (the stamp's `mcp-held:` line), so the first update after
// the user removes theirs registers the stack's own. Before, the update read the MCP picks back from the ledger alone, which
// never listed it: the server left the install with no line naming it.
for (const scope of ['local', 'user'])
{
    test(`seed install + update (MCP copy route, ${scope} scope): a pick the user's own registration holds stays in the record, and the update after it frees registers the stack's (re-verify 4 T7)`, POSIX_ONLY, () =>
    {
        const OWN = { type: 'stdio', command: 'uvx', args: ['macos-mcp', 'serve', '--my-flag'], env: { MY_OWN: '1' } };
        const acct = (work) => path.join(work, 'acct', '.claude.json');
        const holderOf = (data, repo) => (scope === 'user' ? data : ((data.projects || {})[fs.realpathSync(repo)] || {}));
        const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nmcp macos-desktop\n', {
            env: { ...MCP_COPY_ENV, ALFRED_CODE_PLATFORM: 'darwin' }, account: true,
            prepare: (repo, work) => (scope === 'user' ? accountMcp(work, { 'macos-desktop': OWN })
                : accountMcp(work, {}, { [fs.realpathSync(repo)]: { mcpServers: { 'macos-desktop': OWN } } })),
            args: [['--scope', scope], ['--scope', scope, '--installed-only'], ['--scope', scope, '--installed-only']],
            each: (repo, i) =>
            {
                const work = path.dirname(repo);
                const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
                const data = JSON.parse(fs.readFileSync(acct(work), 'utf8'));
                const step = {
                    reg: (holderOf(data, repo).mcpServers || {})['macos-desktop'],
                    held: (/^mcp-held: *(.*)$/m.exec(stamp) || [])[1] ?? null,
                    ledgered: new RegExp(`\\b${scope}:macos-desktop=`).test((/^managed-mcp:(.*)$/m.exec(stamp) || [])[1] || ''),
                    calls: stepCalls(repo),
                };
                // After the second run the user takes the remove command the line gave them.
                if (i === 1) { delete holderOf(data, repo).mcpServers['macos-desktop']; fs.writeFileSync(acct(work), JSON.stringify(data, null, 2)); }
                return step;
            },
        });
        const [install, heldUpdate, freed] = steps;
        for (const [i, step] of [install, heldUpdate].entries())
        {
            assert.deepStrictEqual(step.reg, OWN, `run ${i} touched the user's own registration:\n${step.calls.join('\n')}\n${outs[i]}`);
            assert.ok(!step.calls.some((c) => /^mcp (add|remove) .*macos-desktop/.test(c)), `run ${i}:\n${step.calls.join('\n')}`);
            assert.strictEqual(step.held, `${scope}:macos-desktop`, `run ${i} left the pick out of the record:\n${outs[i]}`);
            assert.strictEqual(step.ledgered, false, `run ${i} ledgered the user's own registration`);
            const lines = outs[i].split('\n').filter((l) => /mcp macos-desktop: the .*registration is not the one the stack wrote/.test(l));
            assert.strictEqual(lines.length, 1, `run ${i} did not name it in one line:\n${outs[i]}`);
            assert.match(lines[0], new RegExp(`stays a pick in this install's record: once you remove yours \\(claude mcp remove macos-desktop -s ${scope}\\), /alfred-code:update registers the stack's`), lines[0]);
        }
        assert.ok(freed.calls.some((c) => new RegExp(`^mcp add --scope ${scope} macos-desktop `).test(c)), `the update after the name freed did not register the stack's:\n${freed.calls.join('\n')}\n${outs[2]}`);
        assert.notDeepStrictEqual(freed.reg, undefined, outs[2]);
        assert.strictEqual(freed.reg.env.ANONYMIZED_TELEMETRY, 'false', JSON.stringify(freed.reg));
        assert.strictEqual(freed.ledgered, true, outs[2]);
        assert.strictEqual(freed.held, null, 'the held line stays once the stack registered its own');
    });
}

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
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nmcp browser\n', {
        env: MCP_COPY_ENV,
        args: [['--playwright-browsers', 'chrome,firefox,webkit', '--playwright-enabled', 'chrome,firefox'], ['--installed-only']],
        prepare: withTrust('settings.json', ['navigation', 'mine', 'browser-webkit']),
        each: (repo) => ({ trusted: trusted(repo), disabled: pwState(repo).disabled }),
    });
    for (const [i, step] of steps.entries())
    {
        assert.deepStrictEqual(step.trusted, ['mine', 'browser-chrome', 'browser-firefox'], `step ${i}:\n${outs[i]}`);
        assert.deepStrictEqual(step.disabled, ['browser-webkit'], `step ${i}`);
    }
});

test('seed install (full copy route): the locked three are registered in .mcp.json, so enabledMcpjsonServers names them (R124 m)', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', 'skill markdown-style\n', { env: COPY_ENV, inspect: (repo) => trusted(repo) });
    assert.deepStrictEqual([...result].sort(), [...mcp.LOCKED].sort(), out);
});

// Matrix FAIL F-BOM (2.1.6): a `.mcp.json` with a UTF-8 BOM read as EMPTY - three bare JSON.parse calls (the read-back's
// mcpjsonPicks, registeredEngines, stamp.js) had no BOM strip - so every update read one MCP pick short and dropped its
// enabledMcpjsonServers entry. keepMcpOrder (T4) keeps the BOM, so the state no longer healed on the next write.
test('seed update (full copy route): a .mcp.json with a BOM reads like one without - the pick stays, its trust entry stays, a drifted row is still repaired (matrix F-BOM)', POSIX_ONLY, () =>
{
    const BOM = '\uFEFF';
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nmcp macos-desktop\n', {
        env: { ...COPY_ENV, ALFRED_CODE_PLATFORM: 'darwin' }, args: [[], ['--installed-only'], ['--installed-only'], ['--installed-only']],
        each: (repo, i) =>
        {
            const file = path.join(repo, '.mcp.json');
            const raw = fs.readFileSync(file, 'utf8');
            const step = { bom: raw.startsWith(BOM), trusted: trusted(repo) };
            if (i === 0) fs.writeFileSync(file, BOM + raw);
            if (i === 2)
            {
                const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
                data.mcpServers['macos-desktop'].args = ['drifted'];
                fs.writeFileSync(file, BOM + JSON.stringify(data, null, 2));
            }
            return step;
        },
    });
    assert.ok(steps[0].trusted.includes('macos-desktop'), `install:\n${outs[0]}`);
    for (const i of [1, 2, 3])
    {
        assert.strictEqual(steps[i].bom, true, `run ${i}: the BOM is kept`);
        assert.ok(steps[i].trusted.includes('macos-desktop'), `run ${i} dropped the trust entry:\n${outs[i]}`);
        assert.doesNotMatch(outs[i], /dropped enabledMcpjsonServers entry/, `run ${i}:\n${outs[i]}`);
        assert.strictEqual(/mcps=(\d+)/.exec(outs[i])[1], /mcps=(\d+)/.exec(outs[0])[1], `run ${i} read a different MCP list:\n${outs[i]}`);
    }
    assert.match(outs[3], /mcp repaired: macos-desktop/, `the drifted row under a BOM was not repaired:\n${outs[3]}`);
});

// Matrix FAIL F-OWN (2.1.6): the held rule (a pick whose name the user's own registration holds is kept, named with its
// remove line and recorded in `mcp-held:`) covered local and user scope only; at project scope a fresh install overwrote the
// user's own `.mcp.json` row ('mcp repaired: ... was stdio node my-desktop.js'), also on 2.1.5. The row is the user's when the
// ledger does not list the name (no ledger: when it is not the stack's exact shape); a row the ledger lists is the stack's,
// so an edit to it is still repaired (the documented drift repair).
for (const [pick, extra] of [['macos-desktop', []], ['browser-chrome', ['--browsers', 'chrome']]])
{
    test(`seed install + update (full copy route, project scope): the user's own .mcp.json ${pick} row is kept, named and held, and the update after it frees registers the stack's (matrix F-OWN)`, POSIX_ONLY, () =>
    {
        const OWN = { command: 'node', args: ['my-desktop.js'] };
        const MINE = { type: 'stdio', command: 'node', args: ['mine.js'] };
        const rowsOf = (repo) => jsonAt(repo, '.mcp.json').mcpServers || {};
        const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], `skill markdown-style\nmcp ${pick.startsWith('browser') ? 'browser' : pick}\n`, {
            env: { ...COPY_ENV, ALFRED_CODE_PLATFORM: 'darwin' }, args: [extra, ['--installed-only', ...extra], ['--installed-only', ...extra], ['--installed-only', ...extra]],
            prepare: (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { [pick]: OWN, mine: MINE } }, null, 2)),
            each: (repo, i) =>
            {
                const stamp = fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8');
                const step = {
                    row: rowsOf(repo)[pick], mine: rowsOf(repo).mine, trusted: trusted(repo) || [],
                    held: (/^mcp-held: *(.*)$/m.exec(stamp) || [])[1] ?? null,
                    ledgered: new RegExp(`(^|,)${pick}=`).test((/^managed-mcp:(.*)$/m.exec(stamp) || [])[1] || ''),
                };
                // After the second run the user takes the remove command the line gave them.
                if (i === 1) { const data = jsonAt(repo, '.mcp.json'); delete data.mcpServers[pick]; fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify(data, null, 2)); }
                return step;
            },
        });
        const [install, heldUpdate, freed, again] = steps;
        for (const [i, step] of [install, heldUpdate].entries())
        {
            assert.deepStrictEqual(step.row, OWN, `run ${i} touched the user's own row:\n${outs[i]}`);
            assert.deepStrictEqual(step.mine, MINE, `run ${i} touched mine`);
            assert.doesNotMatch(outs[i], new RegExp(`mcp repaired: ${pick}`), `run ${i}:\n${outs[i]}`);
            assert.strictEqual(step.held, `project:${pick}`, `run ${i} left the pick out of the record:\n${outs[i]}`);
            assert.strictEqual(step.ledgered, false, `run ${i} ledgered the user's own row`);
            assert.ok(!step.trusted.includes(pick), `run ${i} pre-approved the user's own row: ${step.trusted}`);
            const lines = outs[i].split('\n').filter((l) => new RegExp(`mcp ${pick}: the project-scope registration is not the one the stack wrote`).test(l));
            assert.strictEqual(lines.length, 1, `run ${i} did not name it in one line:\n${outs[i]}`);
            assert.match(lines[0], new RegExp(`stays a pick in this install's record: once you remove yours \\(claude mcp remove ${pick} -s project\\), /alfred-code:update registers the stack's`), lines[0]);
        }
        assert.ok(freed.row && freed.row.args[0] !== 'my-desktop.js', `the update after the name freed did not register the stack's:\n${outs[2]}`);
        assert.strictEqual(freed.ledgered, true, outs[2]);
        assert.strictEqual(freed.held, null, 'the held line stays once the stack registered its own');
        assert.ok(freed.trusted.includes(pick), `the stack's own row is pre-approved: ${freed.trusted}`);
        // The stack's own row is a ledgered one now: a run over it repairs a drift (nothing held, nothing named).
        assert.deepStrictEqual(again.row, freed.row);
        assert.strictEqual(again.held, null);
    });
}

// The plugin route registers nothing in .mcp.json, so the user's own row under a pick's name is left as it is and named once;
// the pick is carried by its plugin row, so no `mcp-held:` line is needed there.
for (const [pick, extra] of [['macos-desktop', []], ['browser-chrome', ['--browsers', 'chrome']]])
{
    test(`seed install + update (plugin route, project scope): the user's own .mcp.json ${pick} row is kept and named once, never rewritten (matrix F-OWN)`, POSIX_ONLY, () =>
    {
        const OWN = { command: 'node', args: ['my-desktop.js'] };
        const { steps, outs } = seedRun(['install', 'update'], `skill markdown-style\nmcp ${pick.startsWith('browser') ? 'browser' : pick}\n`, {
            env: { ALFRED_CODE_PLATFORM: 'darwin' }, args: [extra, ['--installed-only', ...extra]],
            prepare: (repo) => fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { [pick]: OWN } }, null, 2)),
            each: (repo) => ({ row: jsonAt(repo, '.mcp.json').mcpServers[pick], held: /^mcp-held:/m.test(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8')) }),
        });
        for (const [i, step] of steps.entries())
        {
            assert.deepStrictEqual(step.row, OWN, `run ${i}:\n${outs[i]}`);
            assert.strictEqual(step.held, false, `run ${i}`);
            assert.strictEqual(outs[i].split('\n').filter((l) => new RegExp(`mcp ${pick}: kept - the .mcp.json entry is not the one the stack wrote`).test(l)).length, 1, `run ${i}:\n${outs[i]}`);
        }
    });
}

test('seed update (full copy route, project scope): a ledgered row edited by the user is still repaired, and a row the ledger does not list is the user\'s (matrix F-OWN o3)', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nmcp macos-desktop\n', {
        env: { ...COPY_ENV, ALFRED_CODE_PLATFORM: 'darwin' }, args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            const file = path.join(repo, '.mcp.json');
            const data = jsonAt(repo, '.mcp.json');
            const step = { row: data.mcpServers['macos-desktop'], nav: data.mcpServers.navigation };
            if (i === 0) { data.mcpServers['macos-desktop'].args = ['drifted']; fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
            return step;
        },
    });
    assert.match(outs[1], /mcp repaired: macos-desktop/, outs[1]);
    assert.notDeepStrictEqual(steps[1].row.args, ['drifted']);
    assert.doesNotMatch(outs[1], /macos-desktop: the project-scope registration is not the one the stack wrote/, outs[1]);
});

for (const scope of ['user', 'local'])
{
    test(`seed install (MCP copy route, ${scope} scope): nothing lands in .mcp.json, so enabledMcpjsonServers gains no stack name and loses the ones it held (R124 m)`, POSIX_ONLY, () =>
    {
        const file = scope === 'local' ? 'settings.local.json' : 'settings.json';
        const { result, out } = seedRun('install', 'skill markdown-style\nmcp browser\n', {
            env: MCP_COPY_ENV,
            args: ['--scope', scope, '--playwright-browsers', 'chrome'],
            prepare: withTrust(file, ['navigation', 'mine', 'browser-chrome']),
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
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        env: COPY_ENV,
        args: [['--scope', 'user', '--memory-level', 'project', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only']],
        prepare: (repo, work) => accountMcp(work, { navigation: STACK_SERENA, memory: { type: 'stdio', command: 'node', args: ['my-memory.js'], env: {} } }),
        each: (repo) => ({ calls: stepCalls(repo), mcp: jsonAt(repo, '.mcp.json').mcpServers || {}, trusted: trusted(repo), stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8'), real: fs.realpathSync(repo) }),
    });
    for (const [i, step] of steps.entries())
    {
        const userCalls = step.calls.filter((c) => /^mcp (add|remove) .*(--scope user|-s user)/.test(c));
        assert.deepStrictEqual(userCalls, [], `step ${i} registered at user scope:\n${userCalls.join('\n')}\n${outs[i]}`);
        for (const name of ['navigation', 'memory', 'documentation', 'browser-chrome'])
            assert.ok(step.mcp[name], `step ${i}: ${name} is not in this project's .mcp.json: ${Object.keys(step.mcp).join(',')}\n${outs[i]}`);
        // Project-relative, the server started at its project through ROOT_BOOT: every checkout's own (re-verify 2 R3, 3 S2).
        assert.strictEqual(step.mcp.memory.env.MCP_MEMORY_SQLITE_PATH, '.alfred/.alfred-memory/memory.db', 'the project-level database is this project\'s, whichever checkout reads it');
        for (const name of ['navigation', 'memory', 'documentation', 'browser-chrome']) assert.ok((step.trusted || []).includes(name), `step ${i}: ${name} is not pre-approved`);
        assert.match(step.stamp, /^scope: user$/m);
        assert.match(outs[i], /mcp: navigation still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run \/alfred-code:update: claude mcp remove navigation -s user/, outs[i]);
        assert.doesNotMatch(outs[i], /mcp: [^\n]*memory still registered at user scope/, 'another server under the stack\'s name is not the stack\'s');
    }
    assert.ok(steps[1].calls.some((c) => /^mcp add --scope project navigation /.test(c)), steps[1].calls.join('\n'));
});

// N5 (re-review): on that route the drop loop removes at the scope the route registers at - this project's
// .mcp.json - so an engine an earlier user-scope run registered and this run drops, or a 1.x single
// `playwright`, stayed at user scope with nothing said. Each is named with its command like C10's stale
// names, and never removed (another user-scope install may still load it); a server of the user's own
// under a dropped engine's name gets the kept line instead.
// M-F5-1 (re-review follow-up): `browser-webkit` is not live (this run only keeps chrome), so a foreign
// registration under it is noise, not something the user must act on - its kept line loses the `!!`.
// M-F5-2 (re-review follow-up): `playwright`'s identity is the package name only (mcp.identityOf), which
// cannot tell the stack's 1.x registration apart from the user's own `npx @playwright/mcp` under the same
// bare name - it is never named as the stack's leftover, and the neutral wording is unmarked.
test('seed update --scope user (full copy route): a dropped engine and a legacy playwright still registered at user scope are named with their command, never removed (N5)', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        env: COPY_ENV, args: ['--scope', 'user', '--playwright-browsers', 'chrome'],
        prepare: (repo, work) =>
        {
            pwProject(repo);
            accountMcp(work, { 'browser-webkit': STACK_PW('webkit'), playwright: STACK_PW('chrome'), 'browser-firefox': { type: 'stdio', command: 'node', args: ['my-firefox.js'], env: {} } });
        },
    });
    const still = (name) => (out.match(new RegExp(`!! mcp: ${name} still registered at user scope by an earlier run - every project on this account loads it; once each user-scope install has run /alfred-code:update: claude mcp remove ${name} -s user`, 'g')) || []).length;
    assert.strictEqual(still('browser-webkit'), 1, `browser-webkit:\n${out}`);
    assert.strictEqual(still('playwright'), 0, 'the bare name cannot be told from the user\'s own - it must never claim stack authorship (M-F5-2)');
    assert.strictEqual((out.match(/playwright is registered at user scope - if an earlier stack run added it and no other project uses it: claude mcp remove playwright -s user; if you added it yourself, keep it/g) || []).length, 1, out);
    assert.doesNotMatch(out, /!! playwright is registered at user scope/, 'the ambiguous bare name is never marked (M-F5-2)');
    assert.strictEqual(still('browser-firefox'), 0, 'a server of the user\'s own is not the stack\'s stale registration');
    assert.strictEqual((out.match(/!! mcp browser-firefox: the user-scope registration is not the stack's/g) || []).length, 0, 'a dropped, non-live engine\'s kept line carries no actionable marker (M-F5-1)');
    assert.strictEqual((out.match(/mcp browser-firefox: the user-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove browser-firefox -s user/g) || []).length, 1, 'the kept line itself still logs, unmarked (M-F5-1)');
    assert.deepStrictEqual(calls.filter((c) => /^mcp remove .* -s user$/.test(c)), [], `a user-scope registration was removed:\n${calls.join('\n')}`);
});

// C11 (R137 N1): on that route engineStandDown UNINSTALLED a user-scope playwright engine - every project
// on the account lost it. It is switched off in THIS project only, recorded in the stamp's stood-down
// line, and the switch back enables it there.
test('seed update --scope user (full copy route): a user-scope playwright engine is switched off in this project only, and the switch back enables it (C11)', POSIX_ONLY, () =>
{
    const rows = [...USER_ROWS(), { id: 'browser-chrome@envoydev', version: '2.0.0', scope: 'user', enabled: true }];
    const { steps, outs } = seedRun(['install', 'update', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        plugins: JSON.stringify(rows),
        env: [{}, COPY_ENV, COPY_ENV, {}],
        args: [['--scope', 'user', '--playwright-browsers', 'chrome'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only'], ['--scope', 'user', '--installed-only']],
        each: (repo, i) =>
        {
            const state = { calls: stepCalls(repo), stood: stoodDownLine(repo) };
            if (i === 1) settingsWord(repo, { ...offWord(), 'browser-chrome@envoydev': false });
            return state;
        },
    });
    const [, down, again, back] = steps;
    assert.ok(!down.calls.some((c) => /^plugin uninstall browser-chrome@envoydev --scope user/.test(c)), `the account's engine was uninstalled:\n${down.calls.join('\n')}`);
    assert.ok(down.calls.includes('plugin disable browser-chrome@envoydev --scope project'), `${down.calls.join('\n')}\n${outs[1]}`);
    assert.match(down.stood, /project:browser-chrome@envoydev/, down.stood);
    assert.deepStrictEqual(again.calls.filter((c) => /^plugin (disable|enable|uninstall) /.test(c)), [], `a re-run switched something:\n${outs[2]}`);
    assert.strictEqual(again.stood, down.stood);
    assert.ok(back.calls.includes('plugin enable browser-chrome@envoydev --scope project'), `${back.calls.join('\n')}\n${outs[3]}`);
    assert.ok(!steps.some((st) => st.calls.some((c) => /^plugin (disable|enable|uninstall) browser-chrome@envoydev --scope user/.test(c))), 'the user-scope engine was switched');
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
const LEFT_BY_C10 = ['browser-chrome', 'documentation', 'memory', 'navigation'];
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
    const rows = [...USER_ROWS(), { id: 'browser-chrome@envoydev', version: '2.0.0', scope: 'user', enabled: true }];
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
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
    const { steps, outs } = seedRun(['install', 'update'], 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
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
    assert.deepStrictEqual(adds.map((c) => c.split(' ').slice(0, 5).join(' ')), ['mcp add --scope user browser-chrome'], `${adds.join('\n')}\n${outs[1]}`);
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
                navigation: { type: 'stdio', command: 'node', args: ['my-serena.js'], env: {} },
                documentation: { type: 'http', url: mcp.CONTEXT7_REMOTE.url, headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' } },
            } }, null, 2)}\n`);
            fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['navigation', 'documentation'] }, null, 2)}\n`);
        },
        inspect: (repo) => ({ mcp: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}), trusted: trusted(repo) }),
    });
    assert.deepStrictEqual(projectRemovesOf(calls), ['mcp remove documentation -s project'], `${projectRemovesOf(calls).join('\n')}\n${out}`);
    assert.deepStrictEqual(result.mcp, ['navigation'], 'the user\'s own navigation went, or the stack\'s documentation stayed');
    assert.strictEqual((out.match(/!! mcp navigation: the project-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove navigation -s project/g) || []).length, 1, out);
    assert.deepStrictEqual(result.trusted, ['navigation'], 'the kept server lost its approval, or the pruned one kept it');
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
            accountMcp(work, { navigation: STACK_SERENA, 'browser-webkit': STACK_PW('webkit'), documentation: { type: 'http', url: 'https://docs.example.test/mcp' } });
        },
    });
    const removes = calls.filter((c) => /^mcp remove /.test(c));
    assert.deepStrictEqual(removes.sort(), ['mcp remove browser-webkit -s user', 'mcp remove navigation -s user'], `${removes.join('\n')}\n${out}`);
    assert.strictEqual((out.match(/mcp documentation: the user-scope registration is not the stack's \(another server under the same name\) - kept; if it should go: claude mcp remove documentation -s user/g) || []).length, 1, out);
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
    const ids = mcp.stackIdentities({ catalog, remotes: { documentation: mcp.CONTEXT7_REMOTE }, tokens: { PW_PIN: '@0.0.82' }, retiredRows: rows });
    assert.ok(ids.navigation.has('stdio:serena-agent'), [...ids.navigation].join(','));
    assert.ok(ids['browser-webkit'].has('stdio:@playwright/mcp') && ids.playwright.has('stdio:@playwright/mcp'));
    assert.deepStrictEqual([...ids.documentation].sort(), ['http:https://mcp.context7.com/mcp']);
    assert.deepStrictEqual([...ids.context7].sort(), ['stdio:@upstash/context7-mcp'], 'the 1.x local transport under the old name');
    assert.deepStrictEqual([...ids.sentry], ['http:https://mcp.sentry.dev/mcp/${SENTRY_SLUG}'], 'the add-back url is the user\'s, never the stack\'s');
    // Every retired server names what the stack registered, or its prune could never tell its own from the user's.
    const { loadManifest } = require('./install/manifest.js');
    for (const name of loadManifest(path.join(__dirname, '..')).retired.mcps)
        assert.ok(ids[name] && ids[name].size, `${name}: no registration row in meta/retired-plugins.json`);
});

// Plugins audit (2026-09-26): Claude Code connects to a server ONCE, from the highest source - local,
// project, user, then plugins - and matches a plugin server against those by ENDPOINT. Measured on
// 2.1.282 through the session's init row: a user- or project-scope registration of the context7 url,
// under `documentation` or any other name, left the context7 plugin out of the session, so every
// `mcp__plugin_documentation_documentation__` spelling the stack ships resolved nothing. A stdio server matches on
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
    const recorded = { navigation: 'h1', 'macos-desktop': 'h2' };
    const held = { navigation: {} };
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

// Review 2.1.6 (the user's ruling): an install an earlier release broke - a registration of the stack's still in the
// account file, its ledger row lost - is taken back only on marks nothing but the stack's own registration carries,
// never the package name alone, which the user's own server with the same upstream shares.
test('stackAuthored: the release\'s cut-off with a pinned package, the desktop servers\' telemetry off, an engine\'s profile and --no-webmcp where the stamp lists it', () =>
{
    const uvx = (from, env = {}) => ({ type: 'stdio', command: 'uvx', args: ['--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', from, 'macos-mcp', 'serve'], env });
    assert.strictEqual(mcp.stackAuthored('macos-desktop', uvx('macos-mcp==0.4.6', { ANONYMIZED_TELEMETRY: 'false' })), true);
    assert.strictEqual(mcp.stackAuthored('macos-desktop', uvx('macos-mcp==0.4.6')), false, 'no telemetry mark');
    assert.strictEqual(mcp.stackAuthored('macos-desktop', uvx('macos-mcp', { ANONYMIZED_TELEMETRY: 'false' })), false, 'no pin');
    assert.strictEqual(mcp.stackAuthored('macos-desktop', { type: 'stdio', command: 'uvx', args: ['macos-mcp', 'serve', '--my-flag'], env: { MY_OWN: '1' } }), false, 'the user\'s own');
    assert.strictEqual(mcp.stackAuthored('memory', { command: 'uvx', args: ['--exclude-newer', '2026-09-29T23:59:59Z', '--with', 'numpy', '--from', 'mcp-memory-service[sqlite]==11.14.0', 'memory', 'server'] }), true);
    const pw = (dir, extra = ['--no-webmcp']) => ({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--user-data-dir', dir, ...extra, '--browser', 'firefox'] });
    assert.strictEqual(mcp.stackAuthored('browser-firefox', pw('${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox'), { engines: ['firefox'] }), true);
    assert.strictEqual(mcp.stackAuthored('browser-firefox', pw('${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox'), { engines: ['chrome'] }), false, 'the stamp does not list it');
    assert.strictEqual(mcp.stackAuthored('browser-firefox', pw('${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox', []), { engines: ['firefox'] }), false, 'no --no-webmcp');
    assert.strictEqual(mcp.stackAuthored('browser-firefox', { command: 'npx', args: ['@playwright/mcp@latest', '--browser', 'firefox', '--isolated'] }, { engines: ['firefox'] }), false, 'the user\'s own');
});

// Re-verify 3 S1 / S4 / S7: a registration the ledger does not vouch for is the stack's only in the release template's EXACT
// shape - the same words and env keys, the pin, the --exclude-newer date and the paths the only free parts. The user's own
// server with the stack's package and marks usually adds a flag or an env key (tRmReadd: MACOS_MCP_SKIP_PERMISSION_CHECK).
test('exactStack: the release template\'s words and env keys, free only where a token sits; the anchor and an older release\'s path prefix are no difference', () =>
{
    const catalog = ['navigation|-e SERENA_HOME=@SERENA_HOME@ -- node -e @ROOT_BOOT@ -- checkout uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from serena-agent@SERENA_PIN@ serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false @SERENA_PROJECT_FLAG@ @SERENA_PROJECT_DIR@',
        'browser|-- node -e @ROOT_BOOT@ -- checkout npx -y @playwright/mcp@PW_PIN@ --user-data-dir @BROWSER_DIR@ --output-dir @BROWSER_DIR@/output --no-webmcp',
        'macos-desktop|-e ANONYMIZED_TELEMETRY=false -- uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from macos-mcp@MACOS_DESKTOP_PIN@ macos-mcp serve',
        'documentation|@HTTP@'];
    const remotes = { documentation: mcp.CONTEXT7_REMOTE };
    const exact = (name, entry) => mcp.exactStack(name, entry, { catalog, remotes });
    const mac = (args, env = { ANONYMIZED_TELEMETRY: 'false' }) => ({ type: 'stdio', command: 'uvx', args, env });
    const macArgs = ['--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'];
    assert.strictEqual(exact('macos-desktop', mac(macArgs)), true);
    assert.strictEqual(exact('macos-desktop', mac(['--python', '3.14', '--exclude-newer', '2026-10-30T00:00:00Z', '--from', 'macos-mcp==0.5.0', 'macos-mcp', 'serve'])), true, 'a pin, a date and the python are free');
    assert.strictEqual(exact('macos-desktop', mac(['--python', '3.13', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), true, 'no cut-off (the user set UV_EXCLUDE_NEWER=false)');
    assert.strictEqual(exact('macos-desktop', mac(macArgs, { ANONYMIZED_TELEMETRY: 'false', MACOS_MCP_SKIP_PERMISSION_CHECK: '1' })), false, 'tRmReadd: an env key of the user\'s own');
    assert.strictEqual(exact('macos-desktop', mac(macArgs, {})), false, 'an env key of the stack\'s missing');
    assert.strictEqual(exact('macos-desktop', mac(macArgs, { ANONYMIZED_TELEMETRY: 'true' })), false, 'a literal env value changed');
    assert.strictEqual(exact('macos-desktop', mac([...macArgs, '--verbose'])), false, 'a flag of the user\'s own');
    assert.strictEqual(exact('macos-desktop', mac(['--python', '3.13', '--with', 'extra', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), false, 'no token soaks up an added flag pair');
    assert.strictEqual(exact('macos-desktop', mac(['--python', '3.13', '--exclude-newer', '7 days', '--from', 'macos-mcp==0.4.6', 'macos-mcp', 'serve'])), false, 'a cut-off that is no date');
    assert.strictEqual(exact('macos-desktop', { command: 'cmd', args: ['/c', 'uvx', ...macArgs], env: { ANONYMIZED_TELEMETRY: 'false' } }), true, 'the Windows cmd /c wrapper');
    const boot = require('../stack/hooks/memory.js').ROOT_BOOT;
    const pw = (engine, dir, extra = []) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'npx', '-y', '@playwright/mcp@0.0.83', '--browser', engine, '--user-data-dir', dir, '--output-dir', `${dir}/output`, '--no-webmcp', ...extra], env: {} });
    assert.strictEqual(exact('browser-firefox', pw('firefox', '.alfred/browser/firefox')), true, 'this release\'s anchored row');
    const old = pw('firefox', '${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox');
    old.command = 'npx'; old.args = old.args.slice(5);
    assert.strictEqual(exact('browser-firefox', old), true, 'v2.1.5\'s unanchored row with its path prefix');
    assert.strictEqual(exact('browser-firefox', pw('firefox', '.playwright/firefox')), true, 'a 2.0.0 profile not moved yet');
    assert.strictEqual(exact('browser-firefox', pw('firefox', '/home/me/profiles/ff')), false, 'oNewPlain: a profile of the user\'s own');
    assert.strictEqual(exact('browser-firefox', pw('firefox', '.alfred/browser/firefox', ['--isolated'])), false, 'oNewMarks: the stack\'s marks plus a flag');
    assert.strictEqual(exact('browser-firefox', pw('chrome', '.alfred/browser/chrome')), false, 'another engine under the name');
    assert.strictEqual(exact('browser-firefox', { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--browser', 'firefox', '--isolated'] }), false);
    const nav = (tail) => ({ type: 'stdio', command: 'node', args: ['-e', boot, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'serena-agent==1.7.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', ...tail], env: { SERENA_HOME: '.alfred/serena/home' } });
    assert.strictEqual(exact('navigation', nav(['--project-from-cwd'])), true);
    assert.strictEqual(exact('navigation', nav(['--project', '.'])), true);
    assert.strictEqual(exact('navigation', nav([])), false, 'the project flag is no optional word');
    assert.strictEqual(exact('documentation', { type: 'http', url: 'https://mcp.context7.com/mcp/', headers: { 'Context7-API-Key': '${CONTEXT7_API_KEY:-}' } }), true);
    assert.strictEqual(exact('documentation', { type: 'http', url: 'https://mcp.context7.com/mcp', headers: { 'Context7-API-Key': 'abc', 'X-Own': '1' } }), false);
    assert.strictEqual(exact('documentation', { type: 'http', url: 'https://example.com/mcp' }), false);
    assert.strictEqual(exact('unknown', mac(macArgs)), false, 'a name no catalog row serves');
    const win = ['windows-desktop|-e WINDOWS_MCP_EXCLUDE_TOOLS=@WINDOWS_DESKTOP_EXCLUDE@ -e WINDOWS_MCP_TOOLS= -e ANONYMIZED_TELEMETRY=false -- uvx --python @UV_PYTHON@ --from windows-mcp@WINDOWS_DESKTOP_PIN@ windows-mcp serve'];
    const winEntry = (env) => ({ command: 'uvx', args: ['--python', '3.13', '--from', 'windows-mcp==0.8.5', 'windows-mcp', 'serve'], env: { WINDOWS_MCP_TOOLS: '', ANONYMIZED_TELEMETRY: 'false', ...env } });
    assert.strictEqual(mcp.exactStack('windows-desktop', winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: '' }), { catalog: win }), true, 'a token env value resolved to nothing (none)');
    assert.strictEqual(mcp.exactStack('windows-desktop', winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: 'PowerShell,Registry,Process' }), { catalog: win }), true);
    assert.strictEqual(mcp.exactStack('windows-desktop', { ...winEntry({ WINDOWS_MCP_EXCLUDE_TOOLS: '' }), env: { WINDOWS_MCP_TOOLS: 'Click', ANONYMIZED_TELEMETRY: 'false', WINDOWS_MCP_EXCLUDE_TOOLS: '' } }, { catalog: win }), false, 'a literal empty env value set');
    assert.strictEqual(exact('macos-desktop', null), false);
    // The anchor is the launcher, never the server: identityOf reads the command after it.
    assert.strictEqual(mcp.identityOf(pw('firefox', '.alfred/browser/firefox')), 'stdio:@playwright/mcp');
    assert.strictEqual(mcp.identityOf(nav([])), 'stdio:serena-agent');
});

// Re-verify 4 T5: exactStack vouched for a profile outside the project (another project's, the user's own folder that
// happens to end browser/<engine>) and for anchor code of the user's own that merely names runAtRoot - and a vouched row
// is removed and re-registered in the stack's shape. Vouching needs the project's own profile (relative, or absolute
// under the project) and this release's ROOT_BOOT (or one an earlier release registered); identityOf stays loose.
test('exactStack: an engine profile must be this project\'s own, and an anchored row must run the stack\'s own ROOT_BOOT (re-verify 4 T5)', () =>
{
    const catalog = ['browser|-- node -e @ROOT_BOOT@ -- checkout npx -y @playwright/mcp@PW_PIN@ --user-data-dir @BROWSER_DIR@ --output-dir @BROWSER_DIR@/output --no-webmcp',
        'navigation|-e SERENA_HOME=@SERENA_HOME@ -- node -e @ROOT_BOOT@ -- checkout uvx --python @UV_PYTHON@ @UV_EXCLUDE_FLAG@ @UV_EXCLUDE_NEWER@ --from serena-agent@SERENA_PIN@ serena start-mcp-server --context @SERENA_CONTEXT@ --enable-web-dashboard false @SERENA_PROJECT_FLAG@ @SERENA_PROJECT_DIR@'];
    const projectRoot = path.resolve('/work/proj');
    const boot = require('../stack/hooks/memory.js').ROOT_BOOT;
    const pw = (dir, code = boot) => ({ type: 'stdio', command: 'node', args: ['-e', code, '--', 'checkout', 'npx', '-y', '@playwright/mcp@0.0.83', '--browser', 'firefox', '--user-data-dir', dir, '--output-dir', `${dir}/output`, '--no-webmcp'], env: {} });
    const exact = (name, entry) => mcp.exactStack(name, entry, { catalog, projectRoot });
    assert.strictEqual(exact('browser-firefox', pw('.alfred/browser/firefox')), true, 'relative: the project\'s own');
    assert.strictEqual(exact('browser-firefox', pw(path.join(projectRoot, '.alfred', 'browser', 'firefox'))), true, 'absolute under the project');
    assert.strictEqual(exact('browser-firefox', pw('${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/firefox')), true, 'v2.1.5\'s project-dir prefix');
    assert.strictEqual(exact('browser-firefox', pw('/Users/me/profiles/browser/firefox')), false, 'a folder of the user\'s own ending browser/firefox');
    assert.strictEqual(exact('browser-firefox', pw(path.resolve('/work/other/.alfred/browser/firefox'))), false, 'another project\'s profile');
    assert.strictEqual(exact('browser-firefox', pw(path.resolve('/work/proj-two/.alfred/browser/firefox'))), false, 'a sibling sharing the name\'s prefix');
    assert.strictEqual(exact('browser-firefox', pw('../other/.alfred/browser/firefox')), false, 'a relative path leaving the project');
    const own = "require('/home/me/mine.js').runAtRoot(process.argv.slice(1))";
    assert.strictEqual(exact('browser-firefox', pw('.alfred/browser/firefox', own)), false, 'anchor code of the user\'s own naming runAtRoot');
    assert.strictEqual(mcp.identityOf(pw('.alfred/browser/firefox', own)), 'stdio:@playwright/mcp', 'identity still reads the server after any anchor');
    const nav = (code) => ({ type: 'stdio', command: 'node', args: ['-e', code, '--', 'checkout', 'uvx', '--python', '3.13', '--exclude-newer', '2026-09-29T23:59:59Z', '--from', 'serena-agent==1.7.0', 'serena', 'start-mcp-server', '--context', '.claude/navigation-context.yml', '--enable-web-dashboard', 'false', '--project-from-cwd'], env: { SERENA_HOME: '.alfred/serena/home' } });
    assert.strictEqual(exact('navigation', nav(boot)), true);
    assert.strictEqual(exact('navigation', nav(own)), false, 'navigation under code of the user\'s own');
    assert.strictEqual(mcp.exactStack('navigation', nav(own), { catalog, boots: [own] }), true, 'a listed earlier release\'s code');
});

test('accountBackups: the CLI\'s corrupted copies and its last good ones, oldest first, from every folder named once', () =>
{
    const dir = path.join(TMP, `backups-${seq++}`);
    fs.mkdirSync(dir);
    for (const n of ['.claude.json.corrupted.300', '.claude.json.corrupted.100', '.claude.json.backup.200', 'notes.txt']) fs.writeFileSync(path.join(dir, n), '');
    assert.deepStrictEqual(mcp.accountBackups([dir, dir, path.join(TMP, 'absent')]).map((b) => b.ms), [100, 300]);
    assert.deepStrictEqual(mcp.accountBackups([dir], 'good').map((b) => path.basename(b.file)), ['.claude.json.backup.200']);
});

test('shadowingRegistrations: a registration above the plugins that replaces a plugin server, or runs beside it', () =>
{
    const ctx7 = { type: 'http', url: `${mcp.CONTEXT7_REMOTE.url}/` };
    const rows = mcp.shadowingRegistrations({
        plugins: ['navigation', 'documentation', 'memory'],
        scopes: {
            user: { docs7: ctx7, navigation: STACK_SERENA, mine: { command: 'node', args: ['my-server.js'] }, 'browser-chrome': STACK_PW('chrome') },
            project: { documentation: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] } },
            local: { memory: { type: 'stdio', command: 'uvx', args: ['--from', 'mcp-memory-service[sqlite]==11.0.0', 'memory', 'server'] } },
        },
    });
    assert.deepStrictEqual(rows, [
        { scope: 'local', name: 'memory', plugin: 'memory', kind: 'beside' },
        { scope: 'project', name: 'documentation', plugin: 'documentation', kind: 'beside' },
        { scope: 'user', name: 'docs7', plugin: 'documentation', kind: 'replaces' },
        { scope: 'user', name: 'navigation', plugin: 'navigation', kind: 'beside' },
    ], 'local, project, user in precedence order; a server no carried plugin meets is no row');
    assert.deepStrictEqual(mcp.shadowingRegistrations({ plugins: [], scopes: { user: { docs7: ctx7 } } }), [], 'no plugin carried, nothing shadowed');
    assert.deepStrictEqual(mcp.shadowingRegistrations({ plugins: ['documentation'] }), [], 'no registrations read');
});

// The run at PROJECT scope prunes what it wrote into this project's .mcp.json, and never reads the account's user-
// or local-scope registrations - where context7's own README puts it (`claude mcp add --transport http
// context7 <url>`). Each one that takes a plugin's place is named with its remove command, removed never:
// a user-scope registration serves every project of the account.
test('seed install (plugin route, project scope): a user- or local-scope registration that shadows a stack plugin is named with its remove command, never removed', POSIX_ONLY, () =>
{
    const { calls, out } = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')), tools: { claude: MCPJSON_CLI },
        prepare: (repo, work) =>
        {
            // Keyed by the real path too: the run's project root is the resolved one (/private/var on macOS).
            const local = { mcpServers: { memory: { type: 'stdio', command: 'uvx', args: ['--from', 'mcp-memory-service[sqlite]==11.0.0', 'memory', 'server'] } } };
            accountMcp(work, { docs7: { type: 'http', url: mcp.CONTEXT7_REMOTE.url }, navigation: STACK_SERENA },
                { [repo]: local, [fs.realpathSync(repo)]: local });
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: { documentation: { type: 'http', url: mcp.CONTEXT7_REMOTE.url } } }, null, 2)}\n`);
        },
    });
    const line = (re) => (out.match(re) || []).length;
    assert.strictEqual(line(/!! mcp docs7 \(user scope\) calls the url of the documentation plugin, so Claude Code connects to it instead and the stack's mcp__plugin_documentation_documentation__ tools never load - if nothing else needs it: claude mcp remove docs7 -s user/g), 1, out);
    assert.strictEqual(line(/mcp navigation \(user scope\) starts beside the navigation plugin's own server - two navigation servers in every session here; if nothing else needs it: claude mcp remove navigation -s user/g), 1, out);
    assert.strictEqual(line(/mcp memory \(local scope\) starts beside the memory plugin's own server/g), 1, out);
    // R10: no stamp yet means the stack wrote nothing here, so this project's context7 entry is the user's -
    // kept, not pruned, and named like the account's with its remove command.
    assert.strictEqual(line(/!! mcp documentation \(project scope\) calls the url of the documentation plugin.*claude mcp remove documentation -s project/g), 1, out);
    assert.strictEqual(line(/mcp documentation: kept - the \.mcp\.json entry is not the one the stack wrote/g), 1, out);
    assert.deepStrictEqual(calls.filter((c) => /^mcp remove .* -s (user|local)$/.test(c)), [], 'a project-scope run removed an account registration');
});

// Plugins audit (2026-09-26): every playwright engine runs with a PERSISTENT profile under
// <project>/.playwright/<engine> - the cookies and storage of whatever site a check logged into - and
// the folder only appears once a browser has run, after setup's git-hygiene step looked for it. So a
// kept engine gets the folder's own `.gitignore` (`*`), the way a project-level memory database does;
// an existing one is the user's, left alone.
test('ensurePlaywrightIgnore: a kept engine ignores its profile folder, once, and never touches the user\'s own file', () =>
{
    const root = fs.mkdtempSync(path.join(TMP, 'pw-ignore-'));
    const file = path.join(root, '.playwright', '.gitignore');
    const lines = [];
    assert.strictEqual(mcp.ensurePlaywrightIgnore({ projectRoot: root, engines: [], log: (l) => lines.push(l) }), false);
    assert.ok(!fs.existsSync(path.join(root, '.playwright')), 'no engine kept, yet the folder was made');
    assert.strictEqual(mcp.ensurePlaywrightIgnore({ projectRoot: root, engines: ['chrome'], log: (l) => lines.push(l) }), true);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '*\n');
    assert.strictEqual(lines.filter((l) => /\.playwright\/\.gitignore written/.test(l)).length, 1, lines.join('\n'));
    assert.strictEqual(mcp.ensurePlaywrightIgnore({ projectRoot: root, engines: ['chrome'], log: (l) => lines.push(l) }), false, 'a re-run wrote it again');
    fs.writeFileSync(file, '# mine\nchrome/\n');
    assert.strictEqual(mcp.ensurePlaywrightIgnore({ projectRoot: root, engines: ['firefox'] }), false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '# mine\nchrome/\n', 'the user\'s own file was rewritten');
});

test('seed install: a kept engine\'s profile folder is out of git - the data root ignores it, a 2.0.0 .playwright keeps its own file - and no engine leaves no folder', POSIX_ONLY, () =>
{
    const kept = seedRun('install', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')), args: ['--playwright-browsers', 'chrome'],
        inspect: (repo) => ({ data: fs.readFileSync(path.join(repo, '.alfred', '.gitignore'), 'utf8'), old: fs.existsSync(path.join(repo, '.playwright')) }),
    });
    assert.match(kept.result.data, /^\/\*$/m, kept.out);
    assert.strictEqual(kept.result.old, false, 'nothing at the 2.0.0 place on a fresh install');
    const legacy = seedRun('install', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')), args: ['--playwright-browsers', 'chrome'],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.playwright', 'chrome'), { recursive: true }); fs.writeFileSync(path.join(repo, '.playwright', 'chrome', 'Cookies'), 'c'); },
        inspect: (repo) => { try { return fs.readFileSync(path.join(repo, '.playwright', '.gitignore'), 'utf8'); } catch { return null; } },
    });
    assert.strictEqual(legacy.result, '*\n', legacy.out);
    const none = seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        plugins: JSON.stringify(STACK_ROWS('envoydev')),
        inspect: (repo) => fs.existsSync(path.join(repo, '.playwright')),
    });
    assert.strictEqual(none.result, false, none.out);
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
    ['a stack-shaped registration (the control)', JSON.stringify({ mcpServers: { 'browser-chrome': STACK_PW_EXACT('chrome') } }), true],
])
{
    test(`seed update --scope user (MCP copy route): the verify pass with ${label} re-registers only the stack's own (N4)`, POSIX_ONLY, () =>
    {
        const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
            plugins: JSON.stringify(USER_ROWS()), env: MCP_COPY_ENV, tools: { claude: OWN_SHAPE_CLI },
            args: ['--scope', 'user', '--playwright-browsers', 'chrome'],
            prepare: (repo, work) =>
            {
                pwProject(repo);
                if (account !== null) { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', '.claude.json'), account); }
            },
        });
        const removes = calls.filter((c) => /^mcp remove browser-chrome -s user$/.test(c));
        const skipped = (out.match(/!! mcp browser-chrome: the user-scope registration differs from the stack's shape and is not known to be the stack's own - not re-registered, so nothing of yours is removed; if it should go: claude mcp remove browser-chrome -s user, then re-run/g) || []).length;
        assert.ok(calls.some((c) => /^mcp get browser-chrome$/.test(c)), `the verify pass never read the shape:\n${calls.join('\n')}`);
        if (reregistered)
        {
            assert.ok(removes.length > 0 && /shape drifted at user scope: browser-chrome - re-registering/.test(out), `the stack's own drifted registration was not re-registered:\n${calls.join('\n')}\n${out}`);
            assert.strictEqual(skipped, 0, out);
            return;
        }
        assert.deepStrictEqual(removes, [], `a registration not known to be the stack's was removed:\n${calls.join('\n')}\n${out}`);
        assert.strictEqual(skipped, 1, out);
        assert.doesNotMatch(out, /shape drifted at user scope: browser-chrome|could not be brought to the current shape/, out);
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
    assert.ok(front.includes(['mcp', 'navigation', 'find_symbol'].join('__')), 'the tools list keeps the plugin spelling');
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

// F7 (F1 D, pre-existing since 1.3.0): every engine was re-spelled as `playwright`, a name no run
// registers, so a copied seat kept `mcp__plugin_browser-chrome_browser-chrome__*` while the run
// registered `browser-chrome` bare - the seat lost playwright on the copy route. Each engine the run
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
        const { result, out } = seedRun('install', `skill markdown-style\nrule markdown-docs\nmcp browser\n${SEATS.map((s) => `agent ${s}\n`).join('')}`, {
            env, args: ['--scope', scope, '--playwright-browsers', 'chrome,webkit', '--playwright-enabled', 'chrome'],
            inspect: (repo) => Object.fromEntries(SEATS.map((s) => [s, fs.readFileSync(path.join(repo, '.claude', 'agents', `${s}.md`), 'utf8').split('\n').find((l) => l.startsWith('tools:'))])),
        });
        for (const seat of SEATS)
            for (const engine of mcp.PW_ENGINES)
            {
                const server = `browser-${engine}`;
                const bare = registered.includes(engine);
                assert.ok(result[seat].includes(bare ? bareTools(server) : pluginTools(server)), `${seat}: ${server} is not spelled ${bare ? 'bare' : 'as the plugin'}:\n${result[seat]}\n${out}`);
                assert.ok(!result[seat].includes(bare ? pluginTools(server) : bareTools(server)), `${seat}: ${server} kept the other spelling:\n${result[seat]}`);
            }
    });
}

for (const [scope, named] of [['project', 'browser-chrome browser-webkit'], ['user', 'browser-chrome']])
{
    test(`seed install (MCP copy route, skills on the plugin route, ${scope} scope): the mixed-pair line names the engines registered bare (F7, observation 2)`, POSIX_ONLY, () =>
    {
        const { out } = seedRun('install', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
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
    // The row is the stack's exact shape, taken from a fresh run (matrix F-OWN: with no ledger, any other shape is the user's own).
    let stackRow = null;
    const run = (mcpJson) => seedRun('install', 'skill markdown-style\nrule markdown-docs\n', {
        env: COPY_ENV,
        prepare: (repo, work) =>
        {
            accountMcp(work, { navigation: STACK_SERENA });
            if (mcpJson) fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { navigation: stackRow } }));
        },
        inspect: (repo) => jsonAt(repo, '.mcp.json').mcpServers,
    });
    const fresh = run(false);
    stackRow = fresh.result.navigation;
    assert.ok(fresh.calls.some((c) => /^mcp add --scope project navigation /.test(c)), `${fresh.calls.filter((c) => /^mcp /.test(c)).join('\n')}\n${fresh.out}`);
    assert.doesNotMatch(fresh.out, /mcp navigation already configured/);
    assert.ok(!fresh.calls.some((c) => /^mcp get /.test(c)), 'a project-scope install asked the CLI, which answers from every scope');
    const kept = run(true);
    assert.ok(!kept.calls.some((c) => /^mcp add --scope project navigation /.test(c)), kept.calls.join('\n'));
    assert.match(kept.out, /mcp navigation already configured - skipping/);
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
    const servers = { navigation: serena, mine, memory: edited };
    const adopt = (name) => name !== 'mine';
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: null, written: [], adopt }), { navigation: entryHash(serena), memory: entryHash(edited) }, 'no ledger: the stack-shaped names are adopted');
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: { navigation: entryHash(serena), memory: entryHash({ other: 1 }) }, written: [], adopt }),
        { navigation: entryHash(serena) }, 'a ledger: recorded and unchanged only - an edited entry is the user\'s');
    assert.deepStrictEqual(mcp.managedMcp({ servers, prior: {}, written: ['memory'], adopt }), { memory: entryHash(edited) }, 'registered this run');
    assert.strictEqual(entryHash({ a: 1, b: [2, { d: 1, c: 2 }] }), entryHash({ b: [2, { c: 2, d: 1 }], a: 1 }), 'key order never changes the hash');
});

test('mcp ledger: removeManaged takes a recorded unchanged entry, keeps an edited or unlisted one, and the file goes only when nothing is left (R10)', () =>
{
    const serena = { command: 'uvx', args: ['serena'] };
    const file = mcpFile({ navigation: serena, memory: { command: 'uvx', args: ['memory', 'edited'] }, mine: { command: 'node', args: ['mine.js'] } });
    const logs = [];
    const out = mcp.removeManagedMcp({ mcpFile: file, managed: { navigation: entryHash(serena), memory: entryHash({ command: 'uvx', args: ['memory'] }) }, log: (m) => logs.push(m) });
    assert.deepStrictEqual(out.removed, ['navigation']);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers).sort(), ['memory', 'mine']);
    assert.match(logs.join('\n'), /mcp memory: kept - changed since the stack registered it, so it is yours/);
    const only = mcpFile({ navigation: serena });
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: only, managed: { navigation: entryHash(serena) } }).removed, ['navigation']);
    assert.ok(!fs.existsSync(only), 'a .mcp.json holding nothing but the stack\'s entries goes with them');
    const garbage = path.join(TMP, `garbage-${Date.now()}.json`);
    fs.writeFileSync(garbage, '{nope');
    const notes = [];
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: garbage, managed: { navigation: 'x' }, note: (m) => notes.push(m) }).removed, []);
    assert.strictEqual(fs.readFileSync(garbage, 'utf8'), '{nope', 'an unreadable file is left untouched');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0], /not valid JSON/);
    // Re-verify 3 S9: one that cannot be read at all says so by its code.
    const folder = path.join(TMP, `folder-${Date.now()}.json`);
    fs.mkdirSync(folder);
    const said = [];
    assert.deepStrictEqual(mcp.removeManagedMcp({ mcpFile: folder, managed: { navigation: 'x' }, note: (m) => said.push(m) }).removed, []);
    assert.match(said.join('\n'), /^\.mcp\.json could not be read \(EISDIR\) - left untouched/);
});

// --- the 2.0.0 rename (navigation, documentation, browser) ----------------------------------------
// An older install names the servers serena, context7 and playwright-<engine>. The manifest's
// `renamed.mcps` is the one table; a browser engine is renamed by its prefix.
const RENAMED = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).renamed.mcps;

test('rename: an old MCP name reads as its new one, an engine by its prefix, anything else as it is', () =>
{
    assert.deepStrictEqual(RENAMED, { serena: 'navigation', context7: 'documentation', playwright: 'browser' });
    const cur = (n) => mcp.currentMcp(n, RENAMED);
    assert.strictEqual(cur('serena'), 'navigation');
    assert.strictEqual(cur('context7'), 'documentation');
    assert.strictEqual(cur('playwright'), 'browser');
    assert.strictEqual(cur('playwright-firefox'), 'browser-firefox');
    for (const same of ['navigation', 'browser-chrome', 'memory', 'context7-local', 'playwright-extra', 'mine'])
        assert.strictEqual(cur(same), same, same);
    assert.deepStrictEqual(mcp.renamedFrom(RENAMED).sort(), ['context7', 'playwright-chrome', 'playwright-firefox', 'playwright-msedge', 'playwright-webkit', 'serena'],
        'the plugin and server names an older install can hold - the bare 1.x `playwright` is its own legacy name, not one of these');
    assert.deepStrictEqual(mcp.renamedFrom({}), []);
});

test('rename: every route retires the old names, so an older copy-route registration is pruned', () =>
{
    const legacy = mcp.renamedFrom(RENAMED);
    for (const routes of [ROUTES(), ROUTES({ mcps: false }), COPY])
    {
        const retired = mcp.retiredMcps({ routes, catalog: CATALOG, authored: [], legacy });
        for (const name of legacy) assert.ok(retired.includes(name), `${JSON.stringify(routes)}: ${name} not retired: ${retired.join(',')}`);
    }
    assert.deepStrictEqual(mcp.retiredMcps({ routes: COPY, catalog: CATALOG, authored: ['old-server'] }), ['old-server'], 'no legacy list, no change');
});

test('rename: an old name is the stack\'s by its successor\'s shape - the package it launches or the url it calls', () =>
{
    const catalog = require('./install/manifest.js').loadManifest(path.join(__dirname, '..')).catalogs.mcps;
    const ids = mcp.stackIdentities({ catalog, remotes: { documentation: mcp.CONTEXT7_REMOTE }, tokens: { PW_PIN: '@0.0.82' }, retiredRows: [], renamed: RENAMED });
    assert.ok(ids.serena.has('stdio:serena-agent'), [...(ids.serena || [])].join(','));
    assert.deepStrictEqual([...ids.context7].sort(), ['http:https://mcp.context7.com/mcp', 'stdio:@upstash/context7-mcp']);
    for (const e of mcp.PW_ENGINES) assert.ok(ids[`playwright-${e}`].has('stdio:@playwright/mcp'), e);
    // A registration the user made under an old name, of another server, is not the stack's.
    assert.ok(!ids.serena.has(mcp.identityOf({ command: 'node', args: ['my-serena.js'] })));
});

test('rename: the copy route drops the old engine names whatever it keeps, and clears them from disabledMcpjsonServers', () =>
{
    const dropped = mcp.playwrightDrop({ routes: COPY, browsers: ['chrome'] });
    for (const e of mcp.PW_ENGINES) assert.ok(dropped.includes(`playwright-${e}`), `${e}: ${dropped.join(',')}`);
    assert.ok(!dropped.includes('browser-chrome'), 'the kept engine stays');
    const sw = mcp.mcpjsonSwitch({ routes: COPY, scope: 'project', kept: ['chrome', 'firefox'], enabled: ['chrome'], apply: false, registered: ['chrome', 'firefox'] });
    assert.ok(sw.enable.includes('playwright-firefox'), 'an old name left in disabledMcpjsonServers leaves it');
    assert.deepStrictEqual(sw.disable, [], 'no answer: the list moves only for an engine registered now');
});

// The copy route over an install made before the 2.0.0 rename: its .mcp.json registers the servers
// under their old names, and enabledMcpjsonServers / disabledMcpjsonServers name them. Each old
// registration of the stack's own shape goes and its successor is registered; the approval lists
// follow; the user's own server under an old name, and under a name of their own, are kept.
const OLD_COPY = { serena: STACK_SERENA, context7: { type: 'http', url: 'https://mcp.context7.com/mcp', headers: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY:-}' } },
    'playwright-chrome': STACK_PW('chrome'), 'playwright-firefox': STACK_PW('firefox'), mine: { type: 'stdio', command: 'node', args: ['my-server.js'], env: {} } };
const oldCopyProject = (servers) => (repo) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'rules', 'markdown-docs.md'), '# rule\n');
    fs.writeFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'sha: abc\nversion: 1.3.0\nplaywright-browsers: chrome,firefox\nplaywright-enabled: chrome\n');
    fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
    fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({ enabledMcpjsonServers: ['serena', 'context7', 'playwright-chrome', 'mine'], disabledMcpjsonServers: ['playwright-firefox'] }, null, 2)}\n`);
};
test('seed update (full copy route) over a pre-rename install: the old registrations go, their successors register, the approvals follow, the user\'s own stay', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        tools: { claude: MCPJSON_CLI }, env: COPY_ENV, args: ['--installed-only'],
        prepare: oldCopyProject(OLD_COPY),
        inspect: (repo) => ({ mcp: jsonAt(repo, '.mcp.json').mcpServers || {}, settings: jsonAt(repo, '.claude/settings.json'), stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8') }),
    });
    const removes = calls.filter((c) => /^mcp remove /.test(c));
    for (const old of ['serena', 'context7', 'playwright-chrome', 'playwright-firefox'])
        assert.ok(removes.includes(`mcp remove ${old} -s project`), `${old} was not removed:\n${removes.join('\n')}\n${out}`);
    assert.deepStrictEqual(Object.keys(result.mcp).sort(), ['browser-chrome', 'browser-firefox', 'documentation', 'memory', 'mine', 'navigation'], out);
    assert.deepStrictEqual(result.mcp.mine, OLD_COPY.mine, 'the user\'s own server is untouched');
    assert.deepStrictEqual([...result.settings.enabledMcpjsonServers].sort(), ['browser-chrome', 'documentation', 'memory', 'mine', 'navigation'], 'the approvals follow the rename; the user\'s own stays');
    assert.deepStrictEqual(result.settings.disabledMcpjsonServers, ['browser-firefox'], 'firefox stays off, under its new name');
    assert.match(result.stamp, /^browser-engines: chrome,firefox$/m);
    assert.match(result.stamp, /^browser-enabled: chrome$/m);
});

test('seed update (full copy route): the user\'s own server under an old name is theirs - kept, named once with its remove command', POSIX_ONLY, () =>
{
    const own = { ...OLD_COPY, serena: { type: 'stdio', command: 'node', args: ['my-serena.js'], env: {} } };
    const { calls, out, result } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        tools: { claude: MCPJSON_CLI }, env: COPY_ENV, args: ['--installed-only'],
        prepare: oldCopyProject(own),
        inspect: (repo) => jsonAt(repo, '.mcp.json').mcpServers || {},
    });
    assert.ok(!calls.includes('mcp remove serena -s project'), calls.filter((c) => /^mcp /.test(c)).join('\n'));
    assert.deepStrictEqual(result.serena, own.serena);
    assert.ok(result.navigation, 'the stack\'s server still registers under its new name');
    assert.strictEqual((out.match(/mcp serena: the project-scope registration is not the stack's .*claude mcp remove serena -s project/g) || []).length, 1, out);
});

// A plugin-route install from before the rename, switched onto the FULL copy route: the core is off
// there, so no swap runs - the old ids are stood down like their successors would be (R107, R111),
// and the servers register under the new names.
test('seed update onto the full copy route from a pre-rename plugin install: the old ids are stood down, never swapped', POSIX_ONLY, () =>
{
    const rows = ['alfred-code', 'serena', 'context7', 'memory', 'playwright-chrome'].map((n) => ({ id: `${n}@envoydev`, version: '1.3.0', scope: 'project', enabled: true }));
    const { calls, out } = seedRun('update', 'skill markdown-style\nrule markdown-docs\nmcp browser\n', {
        plugins: JSON.stringify(rows), env: COPY_ENV, args: ['--installed-only'],
        prepare: pwProject,
    });
    const moves = calls.filter((c) => /^plugin (install|uninstall|disable|enable) /.test(c));
    assert.ok(moves.includes('plugin disable serena@envoydev --scope project') && moves.includes('plugin disable context7@envoydev --scope project'), moves.join('\n'));
    assert.ok(moves.includes('plugin uninstall playwright-chrome@envoydev --scope project -y'), moves.join('\n'));
    assert.deepStrictEqual(moves.filter((c) => /^plugin install (navigation|documentation|browser-)/.test(c)), [], 'the copy route installs no successor plugin');
    assert.ok(calls.some((c) => /^mcp add --scope project navigation /.test(c)) && calls.some((c) => /^mcp add .*--scope project documentation /.test(c)), out);
});

// --- 2.1.4 audit, the plugin package (I7, I8, I11, I12) -------------------------------------------

// I7: Claude Code refuses to disable a plugin an enabled one depends on ('Failed to disable plugin
// "new-core@toymkt": new-core is still required by pw.' - measured on 2.1.284). This stub answers a
// disable the way the CLI does, from the dependencies the source's own marketplace declares, so a switch
// onto the full copy route over an enabled desktop row shows whether the core's stand-down is refused.
const DEPS_STUB = path.join(TMP, 'claude-deps-stub.js');
fs.writeFileSync(DEPS_STUB, `'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.CLAUDE_STUB_LOG, argv.join(' ') + '\\n');
if (argv[0] === 'plugin' && argv[1] === 'list') { process.stdout.write(fs.readFileSync(process.env.CLAUDE_STUB_PLUGINS, 'utf8')); process.exit(0); }
if (argv[0] === 'plugin' && argv[1] === 'disable')
{
    const target = argv[2].split('@')[0];
    const mkt = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'))}, 'utf8'));
    const off = new Set(fs.readFileSync(process.env.CLAUDE_STUB_LOG, 'utf8').split('\\n').filter((l) => /^plugin (disable|uninstall) /.test(l)).map((l) => l.split(' ')[2]));
    const rows = JSON.parse(fs.readFileSync(process.env.CLAUDE_STUB_PLUGINS, 'utf8'));
    const needs = rows.filter((r) => r.enabled && r.id !== argv[2] && !off.has(r.id)).filter((r) =>
    {
        const entry = mkt.plugins.find((p) => p.name === r.id.split('@')[0]);
        return entry && (entry.dependencies || []).includes(target);
    });
    if (needs.length) { process.stderr.write('Failed to disable plugin "' + argv[2] + '": ' + target + ' is still required by ' + needs.map((r) => r.id.split('@')[0]).join(', ') + '.\\n'); process.exit(1); }
}
process.exit(0);
`);
const DEPS_CLI = `exec "${process.execPath}" "${DEPS_STUB}" "$@"`;

test('seed update (full copy route): an enabled desktop row another machine committed does not block the core\'s stand-down (I7)', POSIX_ONLY, () =>
{
    // macOS: windows-desktop is left out of this run by the OS gate, so nothing stands it down - its row
    // stays enabled at project scope, as a teammate on Windows committed it.
    const rows = [...STACK_ROWS('envoydev'), { id: 'windows-desktop@envoydev', version: '2.1.3', scope: 'project', enabled: true }];
    const { calls, out } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(rows), tools: { claude: DEPS_CLI },
        env: [{ ALFRED_CODE_PLATFORM: 'darwin' }, { ...COPY_ENV, ALFRED_CODE_PLATFORM: 'darwin' }],
        args: [[], ['--installed-only']],
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
    });
    assert.ok(calls.includes('plugin disable alfred-code@envoydev --scope project'), `${calls.join('\n')}\n${out}`);
    assert.doesNotMatch(out, /plugin disable failed: alfred-code@envoydev/, 'the core\'s disable was refused - an MCP entry still depends on it');
    assert.match(out, /plugin disabled \[project\]: alfred-code@envoydev/);
});

// I8: R111 stood the copy route's playwright engines down, and nothing did the same for a desktop server,
// so a project switched onto the MCP copy route ran the plugin's server AND the .mcp.json registration -
// two UI-automation servers on one desktop. A desktop name the copy route registers now goes the engine way.
const DESKTOP_ROW = (over = {}) => ({ id: 'windows-desktop@envoydev', version: '2.1.3', scope: 'project', enabled: true, ...over });
test('seed update --installed-only (MCP copy route): a windows-desktop plugin row is uninstalled before its .mcp.json registration (I8)', POSIX_ONLY, () =>
{
    const { calls, out, result } = seedRun('update', 'skill markdown-style\n', {
        plugins: JSON.stringify([...STACK_ROWS('envoydev'), DESKTOP_ROW()]),
        env: { ...MCP_COPY_ENV, ALFRED_CODE_PLATFORM: 'win32' }, args: ['--installed-only', '--add', 'mcp windows-desktop'],
        inspect: (repo) => Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}),
    });
    assert.ok(result.includes('windows-desktop'), `windows-desktop not registered: ${result.join(',')}\n${out}`);
    const moves = calls.filter((c) => /^plugin (install|uninstall|disable|enable|update) windows-desktop/.test(c));
    assert.deepStrictEqual(moves, ['plugin uninstall windows-desktop@envoydev --scope project -y'], `${moves.join('\n')}\n${out}`);
    const gone = calls.indexOf('plugin uninstall windows-desktop@envoydev --scope project -y');
    assert.ok(calls.findIndex((c) => /^mcp add .*windows-desktop/.test(c)) > gone, `registered before its plugin row went:\n${calls.join('\n')}`);
    assert.match(out, /plugin uninstalled \[project\]: windows-desktop@envoydev \(the copy route registers it in \.mcp\.json/);
});

test('seed update --scope user (full copy route): a user-scope windows-desktop row is switched off in this project only and recorded as stood down (I8, C11)', POSIX_ONLY, () =>
{
    const rows = ['alfred-code', 'navigation', 'documentation', 'memory'].map((n) => ({ id: `${n}@envoydev`, version: '2.1.3', scope: 'user', enabled: true }))
        .concat(DESKTOP_ROW({ scope: 'user' }));
    const { calls, out, result } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(rows), env: [{ ALFRED_CODE_PLATFORM: 'win32' }, { ...COPY_ENV, ALFRED_CODE_PLATFORM: 'win32' }],
        args: [['--scope', 'user'], ['--installed-only', '--scope', 'user', '--add', 'mcp windows-desktop']],
        // Only the second run's CLI calls are this case's evidence.
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(path.dirname(repo), 'claude-calls.log'), ''); return null; },
        inspect: (repo) => ({ servers: Object.keys(jsonAt(repo, '.mcp.json').mcpServers || {}), stamp: fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8') }),
    });
    assert.ok(result.servers.includes('windows-desktop'), `${result.servers.join(',')}\n${out}`);
    const moves = calls.filter((c) => /^plugin (install|uninstall|disable|enable) windows-desktop/.test(c));
    assert.deepStrictEqual(moves, ['plugin disable windows-desktop@envoydev --scope project'], `the user-scope row serves every other project - never uninstalled:\n${moves.join('\n')}\n${out}`);
    assert.match(result.stamp, /^stood-down:.*project:windows-desktop@envoydev/m, result.stamp);
});

// I11: Playwright MCP 0.0.82 collects and exposes the tools a visited PAGE registers through WebMCP by
// default ('Enabled by default', config.d.ts; `--no-webmcp` opts out - README and `--help` at the pin).
test('seed install (MCP copy route): every browser engine registers with --no-webmcp (I11)', POSIX_ONLY, () =>
{
    const { out, result } = seedRun('install', 'skill markdown-style\nmcp browser\n', {
        env: MCP_COPY_ENV, args: ['--browsers', 'chrome,firefox'],
        inspect: (repo) => jsonAt(repo, '.mcp.json').mcpServers || {},
    });
    for (const e of ['chrome', 'firefox'])
    {
        const server = result[`browser-${e}`];
        assert.ok(server, `browser-${e} not registered:\n${out}`);
        assert.ok(server.args.includes('--no-webmcp'), `browser-${e}: ${server.args.join(' ')}`);
    }
});

// I12: on the full copy route no launcher runs, so the registration itself names the stack's serena
// context - copied into the project's .claude (committed with the .mcp.json that names it) and recorded in
// the ledger, the registration and the verify pass carrying the same flag.
const navContext = () => fs.readFileSync(path.join(__dirname, '..', 'stack', 'mcp', 'navigation-context.yml'), 'utf8');
const navState = (repo) =>
{
    const nav = (jsonAt(repo, '.mcp.json').mcpServers || {}).navigation;
    const file = path.join(repo, '.claude', 'navigation-context.yml');
    return {
        context: nav ? nav.args[nav.args.indexOf('--context') + 1] : null,
        copy: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
        stamp: fs.existsSync(path.join(repo, '.claude', 'alfred-code.stamp')) ? fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8') : '',
    };
};
test('seed install (full copy route): navigation starts on the stack context the run copies into .claude, and a re-run changes nothing (I12)', POSIX_ONLY, () =>
{
    const { out, steps, result } = seedRun(['install', 'install'], 'skill markdown-style\n', {
        env: COPY_ENV,
        each: (repo) => fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'),
        inspect: navState,
    });
    // R6: serena raises FileNotFoundError on a context path that does not resolve (context_mode.py). The row starts through
    // ROOT_BOOT at the checkout (re-verify 3 S3), so the project-relative path resolves there - never a parse-time
    // ${CLAUDE_PROJECT_DIR:-.}, which expanded to the launch directory (S2).
    assert.strictEqual(result.context, '.claude/navigation-context.yml', out);
    assert.strictEqual(result.copy, navContext(), 'the copy is the shipped file, byte for byte');
    assert.match(result.stamp, /^managed-files:.*\bnavigation-context\.yml=/m, 'the ledger records the copy, so uninstall and a route switch can remove it');
    assert.strictEqual(steps[1], steps[0], 'a re-run rewrote .mcp.json');
});

test('seed update (full copy route): a registration still on the upstream claude-code context is repaired to the stack one (I12)', POSIX_ONLY, () =>
{
    const { out, result } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        env: COPY_ENV, args: [[], ['--installed-only']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const data = jsonAt(repo, '.mcp.json');
            const args = data.mcpServers.navigation.args;
            args[args.indexOf('--context') + 1] = 'claude-code';
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify(data, null, 2)}\n`);
            fs.rmSync(path.join(repo, '.claude', 'navigation-context.yml'), { force: true });
            return null;
        },
        inspect: navState,
    });
    assert.strictEqual(result.context, '.claude/navigation-context.yml', out);
    assert.strictEqual(result.copy, navContext(), 'a deleted copy comes back');
});

// M24 behind a mirror: the copy route registers the user's UV_EXCLUDE_NEWER in place of the release cut-off (none for
// `false`), and the verify pass expects that same shape - it never 'repairs' the user's choice back to the release day.
const uvRows = (repo) => Object.fromEntries(['navigation', 'memory'].map((n) =>
{
    const args = ((jsonAt(repo, '.mcp.json').mcpServers || {})[n] || {}).args || [];
    const at = args.indexOf('--exclude-newer');
    return [n, at < 0 ? null : args[at + 1]];
}));
const RELEASE_CUTOFF = `${JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).refreshed}T23:59:59Z`;
test('seed install (full copy route): UV_EXCLUDE_NEWER=false registers no cut-off, a date registers that date, absent the release day - and a re-run changes nothing', POSIX_ONLY, () =>
{
    const off = seedRun(['install', 'install'], 'skill markdown-style\n', {
        env: { ...COPY_ENV, UV_EXCLUDE_NEWER: 'false' },
        each: (repo) => ({ file: fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'), rows: uvRows(repo) }),
    });
    assert.deepStrictEqual(off.steps[0].rows, { navigation: null, memory: null }, off.out);
    assert.strictEqual(off.steps[1].file, off.steps[0].file, 'a re-run rewrote .mcp.json');
    assert.doesNotMatch(off.out, /mcp repaired/, 'the verify pass expects the user\'s shape');
    assert.strictEqual((off.out.match(/UV_EXCLUDE_NEWER=false is set/g) || []).length, 1, off.out);

    // A date in the project's settings.json env - read from the file, not only the shell.
    const dated = seedRun(['install', 'update'], 'skill markdown-style\n', {
        env: COPY_ENV, args: [[], ['--installed-only']],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ env: { UV_EXCLUDE_NEWER: '2026-01-15' } })); },
        each: (repo) => ({ file: fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'), rows: uvRows(repo) }),
    });
    assert.deepStrictEqual(dated.steps[0].rows, { navigation: '2026-01-15', memory: '2026-01-15' }, dated.out);
    assert.strictEqual(dated.steps[1].file, dated.steps[0].file, 'the update rewrote .mcp.json');
    assert.doesNotMatch(dated.out, /mcp repaired/);

    const absent = seedRun('install', 'skill markdown-style\n', { env: { ...COPY_ENV, UV_EXCLUDE_NEWER: undefined }, inspect: uvRows });
    assert.deepStrictEqual(absent.result, { navigation: RELEASE_CUTOFF, memory: RELEASE_CUTOFF }, absent.out);
    assert.doesNotMatch(absent.out, /UV_EXCLUDE_NEWER/);
});

test('seed update (full copy route): a UV_EXCLUDE_NEWER=false set after the install takes the release cut-off off the rows', POSIX_ONLY, () =>
{
    const { out, steps } = seedRun(['install', 'update'], 'skill markdown-style\n', {
        env: [COPY_ENV, { ...COPY_ENV, UV_EXCLUDE_NEWER: 'false' }], args: [[], ['--installed-only']],
        each: (repo) => uvRows(repo),
    });
    assert.deepStrictEqual(steps[0], { navigation: RELEASE_CUTOFF, memory: RELEASE_CUTOFF });
    assert.deepStrictEqual(steps[1], { navigation: null, memory: null }, out);
});

test('seed update (plugin route) after the full copy route: the stack context copy goes with the registration, a changed one stays (I12)', POSIX_ONLY, () =>
{
    const rows = STACK_ROWS('envoydev', { 'alfred-code': { enabled: false }, navigation: { enabled: false }, documentation: { enabled: false }, memory: { enabled: false } });
    const run = (edit) => seedRun(['install', 'update'], 'skill markdown-style\n', {
        plugins: JSON.stringify(rows), env: [COPY_ENV, {}], args: [[], ['--installed-only']],
        each: (repo, i) => { if (i === 0 && edit) fs.appendFileSync(path.join(repo, '.claude', 'navigation-context.yml'), '# mine\n'); return null; },
        inspect: navState,
    });
    const clean = run(false);
    assert.strictEqual(clean.result.copy, null, `the plugin route carries the context in its own tree:\n${clean.out}`);
    const edited = run(true);
    assert.match(edited.result.copy || '', /# mine/, 'an edited copy is the user\'s');
    assert.match(edited.out, /navigation-context\.yml: kept/);
});

test('seed uninstall after the full copy route: the stack serena context goes with the rest of the ledger (I12)', POSIX_ONLY, () =>
{
    const { out, steps } = seedRun(['install', 'uninstall'], 'skill markdown-style\n', {
        env: COPY_ENV,
        each: (repo) => fs.existsSync(path.join(repo, '.claude', 'navigation-context.yml')),
    });
    assert.deepStrictEqual(steps, [true, false], out);
    assert.match(out, /file removed: navigation-context\.yml/);
});

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

test('seed update (full copy route, project scope): .mcp.json keeps its bytes when nothing changed, and the user\'s own entry keeps its place', POSIX_ONLY, () =>
{
    const bytes = (repo) => fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8');
    const { steps, outs } = seedRun(['install', 'update', 'update'], 'rule baseline-memory\nmcp navigation\nmcp documentation\nmcp memory\nmcp browser\n', {
        env: COPY_ENV, account: true,
        args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], ['--installed-only', '--scope', 'project'], ['--installed-only', '--scope', 'project']],
        each: (repo, i) =>
        {
            if (i !== 0) return bytes(repo);
            // The user puts their own server second, by hand.
            const data = JSON.parse(bytes(repo));
            const [first, ...rest] = Object.entries(data.mcpServers);
            data.mcpServers = Object.fromEntries([first, ['mine', { type: 'stdio', command: 'my-server', args: [], env: {} }], ...rest]);
            fs.writeFileSync(path.join(repo, '.mcp.json'), `${JSON.stringify(data, null, 2)}\n`);
            return bytes(repo);
        },
    });
    assert.strictEqual(Object.keys(JSON.parse(steps[0]).mcpServers)[1], 'mine', 'the fixture');
    assert.strictEqual(steps[1], steps[0], `update 1 rewrote .mcp.json:\n${outs[1]}`);
    assert.strictEqual(steps[2], steps[1], 'update 2 rewrote .mcp.json');
});
