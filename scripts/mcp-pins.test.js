'use strict';
// THE RECOGNITION PINS. The stack ships no MCP server since 2.10.1; meta/mcp-pins.json and meta/mcp-tools.json stay as
// the adapter table's recognition data (spec N7) - each known server's package at a release, and its tool names there -
// refreshed by refresh-mcp-pins.js. Until 2.10.1 they were also the versions the stack launched, which is why no shipped
// launch line may float on `@latest` still holds as a guard.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FLOATING = /[\w@/.-]+@latest\b/;

test('no shipped MCP launch line runs a package on @latest - manifest or generated plugin entries', () =>
{
    const manifest = JSON.parse(read('meta/stack-manifest.json'));
    const floatingRows = manifest.mcps.filter((r) => FLOATING.test(r.args)).map((r) => r.name);
    assert.deepStrictEqual(floatingRows, [], 'meta/stack-manifest.json still launches a floating package');
    const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
    const floatingEntries = marketplace.plugins
        .flatMap((p) => Object.entries(p.mcpServers || {}).map(([name, s]) => [name, (s.args || []).join(' ')]))
        .filter(([, args]) => FLOATING.test(args)).map(([name]) => name);
    assert.deepStrictEqual(floatingEntries, [], 'a generated plugin entry still launches a floating package');
});

// A PyPI refresh takes the newest release the Python each server ran on can install (refresh-mcp-pins.js pythonFor - the
// stack's launchers started every uvx server on it until 2.10.1, so a pin past its floor failed at launch): windows-mcp
// 0.8.6 (2026-09-26) needs Python 3.14 while 0.8.5 runs on 3.12 and up.
test('refresh-mcp-pins: a PyPI pin never moves past what the pinned Python can install', () =>
{
    const { newestFor, admits } = require('./refresh-mcp-pins.js');
    const file = (requires, extra = {}) => [{ requires_python: requires, yanked: false, ...extra }];
    const json = { info: { version: '0.8.6' }, releases: {
        '0.8.4': file('>=3.12'), '0.8.5': file('>=3.12'), '0.8.6': file('>=3.14'),
        '0.9.0rc1': file('>=3.12'), '0.8.7': file('>=3.12', { yanked: true }), '0.8.10': [],
    } };
    assert.strictEqual(newestFor(json, '3.13'), '0.8.5');
    assert.strictEqual(newestFor(json, '3.14'), '0.8.6');
    assert.strictEqual(newestFor({ info: { version: '1.0.0' }, releases: { '1.0.0': file(null) } }, '3.13'), '1.0.0', 'no floor declared admits any Python');
    assert.strictEqual(newestFor({ info: { version: '2.0.0' }, releases: { '2.0.0': file('>=3.14') } }, '3.13'), null, 'nothing installable is no pin, never a pin that fails at launch');
    for (const [spec, ok] of [['>=3.11', true], ['>=3.12,<3.14', true], ['>3.13', false], ['<3.13', false], ['~=3.12', true], ['!=3.13.*', false], ['==3.13.*', true], ['>=3.13.1', false]])
        assert.strictEqual(admits(spec, '3.13'), ok, spec);
});

// M38: a by-hand `serena project index` in the shipped docs once ran the newest serena-agent while the server ran the
// pin. Since 2.10.1 the stack ships no navigation server (the user's ruling of 2026-10-24), so no shipped body indexes
// one at all - an index line that came back would run a server nobody registered.
test('M38 no shipped body runs a serena index command - the stack ships no navigation server', () =>
{
    const sites = [];
    const walk = (dir) =>
    {
        for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const rel = path.join(dir, d.name);
            if (d.isDirectory()) walk(rel);
            else if (/\.md$/.test(d.name)) for (const m of read(rel).matchAll(/uvx\s+--python[^`]*?serena\s+project\s+index/g)) sites.push([rel, m[0].replace(/\s+/g, ' ')]);
        }
    };
    for (const dir of ['setup-plugin', 'stack']) walk(dir);
    assert.deepStrictEqual(sites, []);
});

// The same outside the index line: post-install's pre-warm once ran `uvx --from serena-agent serena --help` (MCP track
// 2026-10-20b). No shipped body launches serena-agent since 2.10.1.
test('no shipped body launches serena-agent - the stack ships no navigation server', () =>
{
    const bad = [];
    const walk = (dir) =>
    {
        for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const rel = path.join(dir, d.name);
            if (d.isDirectory()) walk(rel);
            else if (/\.md$/.test(d.name)) for (const m of read(rel).matchAll(/--from\s+serena-agent\S*/g)) bad.push(`${rel}: ${m[0]}`);
        }
    };
    for (const dir of ['setup-plugin', 'stack']) walk(dir);
    assert.deepEqual(bad, []);
});

// R7: the stack's serena context copies serena-agent's own claude-code.yml at the pin, and a later serena could add
// an editing tool that context would then serve unwatched. The shipped YAML records the upstream file's sha256; the
// refresh keeps the navigation pin where it is until the new release's claude-code.yml hashes the same - i.e. until
// someone re-checks the serena adapter row's `off` list against it and records the new hash on its `upstream` line.
async function refreshRun({ navigation = '9.9.9', context = 'same', recorded = true, lists = {}, pinsRaw = null, committed = {}, argv = ['--write'], npm = {}, audit = () => null } = {})
{
    const os = require('node:os');
    const { main } = require('./refresh-mcp-pins.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-pins-'));
    const pinsFile = path.join(dir, 'mcp-pins.json');
    const toolsFile = path.join(dir, 'mcp-tools.json');
    const adaptersFile = path.join(dir, 'tool-adapters.json');
    if (pinsRaw === null) fs.copyFileSync(path.join(ROOT, 'meta', 'mcp-pins.json'), pinsFile); else fs.writeFileSync(pinsFile, pinsRaw);
    fs.writeFileSync(toolsFile, JSON.stringify({ servers: { "alfred-memory": { version: 'old', tools: ['kept_tool'] }, ...committed } }));
    const upstream = 'name: claude-code\nexcluded_tools: []\n';
    const sha = require('node:crypto').createHash('sha256').update(upstream).digest('hex');
    fs.writeFileSync(adaptersFile, JSON.stringify({ types: { serena: { pin: 'alfred-navigation', ...(recorded ? { upstream: `serena-agent 1.7.0 claude-code.yml sha256 ${sha}` } : {}) } } }));
    const out = [];
    const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'mcp-pins.json'), 'utf8')).pins;
    const listed = [];
    const asked = [];
    const rc = await main(argv, {
        pinsFile, toolsFile, adaptersFile, log: (l) => out.push(l), today: () => '2026-10-01',
        npmLatest: (pkg) => (Object.hasOwn(npm, pkg) ? npm[pkg] : Object.values(current).find((r) => r.package === pkg).version),
        pypiLatest: (pkg, python) => { asked.push([pkg, python]); return pkg === 'serena-agent' ? navigation : Object.values(current).find((r) => r.package === pkg).version; },
        upstreamContext: () => (context === 'same' ? upstream : context),
        listTools: (name) => { listed.push(name); return Object.hasOwn(lists, name) ? lists[name] : null; },
        npmAudit: audit,
    });
    const result = { rc, listed, asked, text: out.join('\n'), pins: JSON.parse(fs.readFileSync(pinsFile, 'utf8')), tools: JSON.parse(fs.readFileSync(toolsFile, 'utf8')) };
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
}

// windows-mcp 0.8.6+ requires Python 3.14: windows-control alone launches on it (the user's ruling of 2026-10-14), so its pin
// is resolved against 3.14 and every other uvx server's against 3.13 - a pin past its server's Python fails at launch.
test('refresh-mcp-pins: each PyPI pin is resolved against the Python its server launches on', async () =>
{
    const r = await refreshRun();
    const asked = Object.fromEntries(r.asked);
    assert.deepStrictEqual(asked, { 'serena-agent': '3.13', 'mcp-memory-service': '3.13', 'windows-mcp': '3.14', 'macos-mcp': '3.13' });
});

test('R7 refresh-mcp-pins: a serena bump whose claude-code context changed is refused until it is re-diffed', async () =>
{
    const was = JSON.parse(read('meta/mcp-pins.json')).pins["alfred-navigation"].version;
    const changed = await refreshRun({ context: 'name: claude-code\nexcluded_tools: []\nnew_tool: yes\n' });
    assert.strictEqual(changed.pins.pins["alfred-navigation"].version, was, 'the navigation pin stays');
    assert.match(changed.text, /alfred-navigation: .* -> 9\.9\.9 REFUSED - serena-agent 9\.9\.9's claude-code\.yml is not the one meta\/tool-adapters\.json's serena row was checked against/);
    assert.strictEqual(changed.rc, 1, 'a refused bump is a failed refresh');
    const none = await refreshRun({ recorded: false });
    assert.strictEqual(none.pins.pins["alfred-navigation"].version, was, 'no recorded hash refuses too');
    assert.match(none.text, /REFUSED - .*records no upstream sha256/);
    const unreadable = await refreshRun({ context: null });
    assert.strictEqual(unreadable.pins.pins["alfred-navigation"].version, was, 'an unreadable upstream context refuses');
    const same = await refreshRun();
    assert.strictEqual(same.pins.pins["alfred-navigation"].version, '9.9.9', 'an unchanged upstream context lets the bump through');
    assert.strictEqual(same.rc, 0);
    assert.strictEqual(same.pins.refreshed, '2026-10-01');
});

test('R7 refresh-mcp-pins: an unreadable pins file does not skip the serena gate, and a new navigation tool is named', async () =>
{
    const changed = await refreshRun({ pinsRaw: '{ not json', context: 'name: claude-code\nexcluded_tools: []\nnew_tool: yes\n' });
    assert.match(changed.text, /alfred-navigation: unpinned -> 9\.9\.9 REFUSED/, 'a bump with no recorded pin went past the gate');
    assert.strictEqual(changed.rc, 1);
    assert.strictEqual(changed.pins.pins["alfred-navigation"].version, null, 'a refused bump with no earlier pin ships unpinned');
    const grown = await refreshRun({ committed: { "alfred-navigation": { version: '1.7.0', tools: ['find_symbol'] } }, lists: { "alfred-navigation": ['find_symbol', 'shiny_editor'] } });
    assert.match(grown.text, /!! alfred-navigation: new tool shiny_editor/);
    assert.doesNotMatch(grown.text, /!! alfred-navigation: new tool find_symbol/);
});

// M31: the refresh records each pinned server's tool names beside the pins (meta/mcp-tools.json), which the adapter
// table reads; a server it cannot list keeps its committed list and is said NOT CHECKED - a refresh on a plane changes nothing.
test('M31 refresh-mcp-pins: --write records each server\'s tool names, and keeps a list it could not read', async () =>
{
    const got = await refreshRun({ lists: { browser: ['browser_navigate', 'browser_click'] } });
    assert.deepStrictEqual(got.tools.servers.browser.tools, ['browser_click', 'browser_navigate'], 'sorted');
    assert.strictEqual(got.tools.servers.browser.version, JSON.parse(read('meta/mcp-pins.json')).pins.browser.version);
    assert.deepStrictEqual(got.tools.servers["alfred-memory"].tools, ['kept_tool'], 'an unlisted server keeps what it had');
    assert.match(got.text, /tools alfred-memory: NOT CHECKED/);
    // PL4: a whole refresh moves every npm row's own day with the shared one; a PyPI row carries none.
    assert.strictEqual(got.pins.pins.browser.refreshed, '2026-10-01');
    assert.strictEqual(got.pins.pins['mobile-control'].refreshed, '2026-10-01');
    assert.ok(!Object.hasOwn(got.pins.pins['alfred-memory'], 'refreshed'), 'a PyPI row takes the shared day');
    const offline = await refreshRun({ npm: { 'appium-mcp': null } });
    assert.strictEqual(offline.pins.pins['mobile-control'].refreshed, JSON.parse(read('meta/mcp-pins.json')).pins['mobile-control'].refreshed, 'a row it could not reach keeps its pin and its day');
});

// 2026-10-13: a server joins the catalog through --only - its own row resolved and listed, every other pin, tool list and
// the uvx cut-off day as committed. A PyPI row is refused there: its pin must not pass the shared cut-off.
test('refresh-mcp-pins --only: the named npm row moves alone; a PyPI row is refused and nothing is written', async () =>
{
    const committed = JSON.parse(read('meta/mcp-pins.json'));
    const got = await refreshRun({ argv: ['--write', '--only', 'mobile-control'], npm: { 'appium-mcp': '9.0.0', '@playwright/mcp': '9.9.9' }, lists: { 'mobile-control': ['appium_screenshot'] } });
    assert.strictEqual(got.rc, 0, got.text);
    assert.strictEqual(got.pins.pins['mobile-control'].version, '9.0.0');
    assert.strictEqual(got.pins.pins.browser.version, committed.pins.browser.version, 'a pin not named stays');
    assert.strictEqual(got.pins.pins['alfred-navigation'].version, committed.pins['alfred-navigation'].version, 'the PyPI bump the registry offers is not taken');
    assert.strictEqual(got.pins.refreshed, committed.refreshed, 'the cut-off day stays');
    assert.strictEqual(got.pins.pins['mobile-control'].refreshed, '2026-10-01', 'PL4: the npm row it resolved records its own day');
    assert.strictEqual(got.pins.pins.browser.refreshed, committed.pins.browser.refreshed, 'a row it kept keeps its day');
    assert.deepStrictEqual(got.listed, ['mobile-control'], 'only the named server is listed');
    assert.deepStrictEqual(got.tools.servers['mobile-control'], { version: '9.0.0', tools: ['appium_screenshot'] });
    assert.deepStrictEqual(got.tools.servers['alfred-memory'].tools, ['kept_tool'], 'another server keeps its list');
    const refused = await refreshRun({ argv: ['--write', '--only', 'alfred-memory'] });
    assert.strictEqual(refused.rc, 1);
    assert.match(refused.text, /--only takes npm rows .* alfred-memory refused/);
    assert.deepStrictEqual(refused.pins, committed, 'nothing was written');
});

test('M31 meta/mcp-tools.json lists every pinned server at its pin', () =>
{
    const pins = JSON.parse(read('meta/mcp-pins.json')).pins;
    const tools = JSON.parse(read('meta/mcp-tools.json')).servers;
    for (const [name, row] of Object.entries(pins))
    {
        assert.ok(tools[name] && tools[name].tools.length, `${name} has a tool list`);
        assert.strictEqual(tools[name].version, row.version, `${name}'s list is for the pinned version`);
    }
    assert.ok(tools["alfred-documentation"] && tools["alfred-documentation"].tools.includes('query-docs'), 'the hosted documentation server is listed');
});

// Audit 2026-10-21 mcps T1-3 (ruling M-A2): appium-mcp 1.97.1 resolves 20 critical npm advisories its upstream pins, and
// no newer release exists. The refresh audits each npm row's tree at its pin and cut-off - report only, never a refusal -
// and --write records the count on the row, where the mobile launcher's prerequisite note reads it.
test('mcps T1-3 refresh-mcp-pins: each npm row is audited at its pin and cut-off, reported, and recorded on --write', async () =>
{
    const asked = [];
    const audit = (pkg, version, before) => { asked.push([pkg, version, before]); return pkg === 'appium-mcp' ? { critical: 20, high: 21, total: 44 } : null; };
    const dry = await refreshRun({ argv: [], audit });
    assert.strictEqual(dry.rc, 0, 'an advisory never fails the refresh');
    assert.match(dry.text, /mobile-control: npm audit appium-mcp@\S+: 20 critical, 21 high of 44 \(report only\)/);
    assert.match(dry.text, /browser: npm audit NOT CHECKED/);
    assert.deepStrictEqual(asked.map(([p]) => p).sort(), ['@playwright/mcp', 'appium-mcp'], 'npm rows only');
    assert.ok(asked.every(([, , before]) => before === '2026-10-01T23:59:59Z'), 'audited at the cut-off the row launches with');
    const wrote = await refreshRun({ audit });
    assert.deepStrictEqual(wrote.pins.pins['mobile-control'].advisories, { checked: '2026-10-01', critical: 20, high: 21, total: 44 });
    assert.ok(!('advisories' in wrote.pins.pins.browser), 'an unchecked row records none');
    // --only another row keeps the recorded count; a row whose audit could not run keeps it while the version holds
    const pinsRaw = JSON.stringify(wrote.pins);
    const other = await refreshRun({ argv: ['--write', '--only', 'browser'], pinsRaw });
    assert.deepStrictEqual(other.pins.pins['mobile-control'].advisories, wrote.pins.pins['mobile-control'].advisories, '--only browser drops mobile\'s count');
    const blind = await refreshRun({ argv: ['--write', '--only', 'mobile-control'], pinsRaw });
    assert.deepStrictEqual(blind.pins.pins['mobile-control'].advisories, wrote.pins.pins['mobile-control'].advisories, 'an unreachable audit keeps the count at the same pin');
    const bumped = await refreshRun({ argv: ['--write', '--only', 'mobile-control'], pinsRaw, npm: { 'appium-mcp': '9.0.0' } });
    assert.ok(!('advisories' in bumped.pins.pins['mobile-control']), 'a new pin with no audit carries no old count');
});
