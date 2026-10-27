'use strict';
// The order each actor is told at its start: the tools doc's ranks - or the adapter table's defaults - resolved against
// what this machine reaches (the enabled stack plugins, the project's registrations, the inventory) and, for a seat,
// against what its tools grant. A rank that cannot be reached is named once and left out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const TOOLS = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts', 'tools.js');
const tools = require(TOOLS);

// The data root and docs root are read from the process env as the hooks read them; this machine's own must not leak in.
delete process.env.ALFRED_CODE_DATA_PATH;
delete process.env.ALFRED_CODE_DOCS_PATH;

const NAV = 'mcp__plugin_alfred-navigation_alfred-navigation__'; // mcp-fixture
const MEMORY_LINE = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list'; // mcp-fixture
const DOC_REL = '.alfred/docs/preferences/TOOLS-PREFERENCES.md';
const STACK = { 'alfred-navigation@envoydev': true, 'alfred-documentation@envoydev': true, 'alfred-memory@envoydev': true };

function sandbox()
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-order-')));
    const root = path.join(work, 'repo');
    const config = path.join(work, 'config');
    fs.mkdirSync(config, { recursive: true });
    const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
    write(path.join(root, '.claude', 'settings.json'), { enabledPlugins: STACK });
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
    // A session that exported the stack's own keys would steer the memory mode and the data root (fix-pass review).
    delete env.ALFRED_CODE_MEMORY;
    delete env.ALFRED_CODE_DATA_PATH;
    const s = {
        work, root, config, env, write,
        doc: (lines) => write(path.join(root, DOC_REL), ['# Tools preferences', '', 'Updated: 2026-10-24', '', ...lines, ''].join('\n')),
        inventory: (servers) => write(path.join(root, '.alfred', 'state', 'tools-inventory.json'), { version: 1, captured: '2026-10-24', servers }),
        line: (extra = {}) => tools.toolsLine({ projectRoot: root, env, seat: null, suggest: false, ...extra }),
        done: () => fs.rmSync(work, { recursive: true, force: true }),
    };
    return s;
}
const server = (prefix, type, names, extra = {}) => ({ [prefix]: { name: prefix.slice(5, -2), prefix, scope: 'user', type, version: null, registration: null, listed: 'exchange',
    tools: Object.fromEntries(names.map((n) => [n, { readOnly: true, destructive: null, target: null }])), ...extra } });
const JETBRAINS = server('mcp__jetbrains__', 'own:jetbrains', ['find_usages', 'get_symbol_info', 'execute_terminal_command']);
const NAV_ENTRY = ['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: own:jetbrains find_usages > serena find_symbol > LSP > Grep'];

test('no doc: the defaults, each with its load line', () =>
{
    const s = sandbox();
    try
    {
        const text = s.line();
        assert.match(text, /^Tool order - the stack's defaults \(no TOOLS-PREFERENCES\.md\)/);
        assert.ok(text.includes(`- navigation (locate symbols, callers and types before reading or editing code): serena find_symbol, find_referencing_symbols, get_symbols_overview > LSP > Grep. Load: ToolSearch select:${NAV}find_symbol,${NAV}find_referencing_symbols,${NAV}get_symbols_overview`), text);
        assert.ok(text.includes('- documentation (check a library\'s API or version before using it): context7 resolve-library-id, query-docs > WebFetch. Load: ToolSearch select:mcp__plugin_alfred-documentation_alfred-documentation__resolve-library-id,'), text); // mcp-fixture
        assert.ok(text.includes(MEMORY_LINE), text);
        assert.ok(!text.includes('Skipped here'), text);
        assert.ok(text.length <= 1200, `${text.length} chars`);
    }
    finally { s.done(); }
});

test('the suggestion rides only when asked, and never to a seat', () =>
{
    const s = sandbox();
    try
    {
        assert.ok(s.line({ suggest: true }).endsWith('\nThe user can rank their own with /capture-preferences tools.'));
        assert.ok(!s.line({ suggest: false }).includes('/capture-preferences'));
        const other = s.line({ seat: 'other', suggest: true });
        assert.ok(!other.includes('/capture-preferences'), other);
        assert.ok(other.includes(MEMORY_LINE), 'a built-in seat loads its MCP tools as the main session does');
    }
    finally { s.done(); }
});

test('a ranked own server comes first with its own names; the jobs the doc leaves out keep the defaults', () =>
{
    const s = sandbox();
    try
    {
        s.doc(NAV_ENTRY);
        s.inventory(JETBRAINS);
        const text = s.line();
        assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md \(the stack's defaults for the jobs it leaves out\): /);
        assert.ok(text.includes(`- navigation (locate symbols, callers and types before reading or editing code): own:jetbrains find_usages > serena find_symbol > LSP > Grep. Load: ToolSearch select:mcp__jetbrains__find_usages,${NAV}find_symbol,LSP\n`), text);
        assert.ok(text.includes(MEMORY_LINE), 'the memory default stays');
        assert.ok(text.includes('- documentation ('), 'the documentation default stays');
    }
    finally { s.done(); }
});

test('a doc that ranks every default job states no defaults', () =>
{
    const s = sandbox();
    try
    {
        s.doc([...NAV_ENTRY, '', '## T2 - Docs', '<!-- id: t2 -->', '- Job: documentation', '- Order: WebFetch', '', '## T3 - Memory', '<!-- id: t3 -->', '- Job: memory', '- Order: memory-service memory_search']);
        s.inventory(JETBRAINS);
        const text = s.line();
        assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md: /);
        assert.ok(text.includes('- documentation (check a library\'s API or version before using it): WebFetch. Load: ToolSearch select:WebFetch\n'), text);
        assert.ok(text.includes('- memory (store and search what this project learned): memory-service memory_search. Load: ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_search'), text); // mcp-fixture
    }
    finally { s.done(); }
});

test('own rank with no inventory entry is skipped and named', () =>
{
    const s = sandbox();
    try
    {
        s.doc(NAV_ENTRY);
        const text = s.line();
        assert.ok(text.includes(': serena find_symbol > LSP > Grep. Load: '), text);
        assert.ok(text.includes('\nSkipped here: own:jetbrains (no inventory entry here).'), text);
    }
    finally { s.done(); }
});

test('a stack seat is told only what its tools grant, with no load clause', () =>
{
    const s = sandbox();
    try
    {
        s.doc(NAV_ENTRY);
        s.inventory(JETBRAINS);
        const fm = '---\nname: x\ntools: mcp__plugin_alfred-navigation_alfred-navigation, LSP, Read, Grep\n---\n'; // mcp-fixture
        const text = s.line({ seat: { frontmatter: fm }, suggest: true });
        assert.ok(!text.includes('ToolSearch'), text);
        assert.ok(!text.includes('/capture-preferences'), text);
        assert.match(text, /- navigation .*: serena find_symbol > LSP > Grep\./);
        assert.ok(text.includes('own:jetbrains (not in your tools)'), text);
        assert.ok(!text.includes('documentation'), 'a job with no reachable rank is left out');
        assert.ok(!text.includes('memory'), text);
        assert.ok(text.endsWith('\nCall them directly - your tools grant them.'), text);
        assert.ok(text.length <= 700, `${text.length} chars`);
    }
    finally { s.done(); }
});

test('a seat with no tools line reaches what the main session does and loads it', () =>
{
    const s = sandbox();
    try
    {
        const text = s.line({ seat: { frontmatter: '---\nname: x\nmodel: sonnet\n---\n' } });
        assert.ok(text.includes(MEMORY_LINE), text);
        assert.ok(!text.includes('Call them directly'), text);
    }
    finally { s.done(); }
});

test('disallowedTools narrows a rank; an emptied default rank is left out silently', () =>
{
    const s = sandbox();
    try
    {
        let fm = `---\ntools: mcp__plugin_alfred-navigation_alfred-navigation, LSP, Grep\ndisallowedTools: ${NAV}find_referencing_symbols\n---\n`; // mcp-fixture
        let text = s.line({ seat: { frontmatter: fm } });
        assert.ok(text.includes(': serena find_symbol, get_symbols_overview > LSP > Grep.'), text);
        fm = `---\ntools: mcp__plugin_alfred-navigation_alfred-navigation, LSP, Grep\ndisallowedTools: ${NAV}find_symbol, ${NAV}find_referencing_symbols, ${NAV}get_symbols_overview, LSP\n---\n`; // mcp-fixture
        text = s.line({ seat: { frontmatter: fm } });
        assert.ok(text.includes(': Grep.'), text);
        assert.ok(!text.includes('Skipped here'), `a default rank the seat's tools do not grant is no news to it\n${text}`);
        fm = `---\ntools:\n  - ${NAV}find_symbol\n  - Grep\n---\n`;
        text = s.line({ seat: { frontmatter: fm } });
        assert.ok(text.includes(': serena find_symbol > Grep.'), `a YAML list grant: ${text}`);
    }
    finally { s.done(); }
});

test('a denied ranked tool is skipped for a seat, kept for the main session', () =>
{
    const s = sandbox();
    try
    {
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: own:jetbrains find_usages > serena find_symbol, find_referencing_symbols > Grep', '',
            '## T4 - Not for agents', '<!-- id: t4 -->', '- Job: deny', '- Deny: own:jetbrains, serena find_symbol', '- Why: the IDE stays with the main session']);
        s.inventory(JETBRAINS);
        const main = s.line();
        assert.ok(main.includes(': own:jetbrains find_usages > serena find_symbol, find_referencing_symbols > Grep.'), main);
        const seat = s.line({ seat: 'other' });
        assert.ok(seat.includes(': serena find_referencing_symbols > Grep.'), seat);
        assert.ok(seat.includes('Skipped here: own:jetbrains (denied to agents).'), seat);
    }
    finally { s.done(); }
});

test('a malformed doc names its problems and never states the defaults', () =>
{
    const s = sandbox();
    try
    {
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: jetbrains find_usages > serena find_symbol > LSP', '',
            '## T2 - Browser', '<!-- id: t2 -->', '- Job: browser', '- Order: chrome x', '',
            '## T3 - Database', '<!-- id: t3 -->', '- Job: database', '',
            '## T5 - Shell', '<!-- id: t5 -->', '- Job: shell', '- Order: own:sh run, > Bash', '',
            '## Untitled', '- Job: other', '- Order: Grep']);
        const text = s.line();
        assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md: /);
        assert.ok(!text.includes('stack\'s defaults'), text);
        assert.ok(!text.includes('- memory'), 'no default fills a malformed doc');
        assert.ok(text.includes(': serena find_symbol > LSP.'), 'the entries that resolve are stated');
        assert.strictEqual((text.match(/^Doc problem: /gm) || []).length, 3, text);
        assert.ok(text.includes('\nDoc problem: T1: jetbrains is neither a known type nor own:<label>\n'), text);
        assert.ok(text.includes('\n... and 2 more - run tools.js lint'), text);
        const seat = s.line({ seat: 'other' });
        assert.ok(!seat.includes('Doc problem'), 'a seat cannot fix the doc');
    }
    finally { s.done(); }
});

test('a plugin server whose plugin was switched off is not reached; a project registration of a known type is', () =>
{
    const s = sandbox();
    try
    {
        s.write(path.join(s.root, '.claude', 'settings.local.json'), { enabledPlugins: { 'alfred-navigation@envoydev': false, 'alfred-documentation@envoydev': false } });
        s.write(path.join(s.root, '.mcp.json'), { mcpServers: { docs: { type: 'http', url: 'https://mcp.context7.com/mcp' } } });
        s.inventory({ ...server('mcp__gone__', 'own:gone', ['a'], { scope: 'project' }), ...server('mcp__plugin_jb_idea__', 'own:idea', ['b'], { scope: 'plugin', plugin: 'jb' }) }); // mcp-fixture
        const main = tools.mainReach({ projectRoot: s.root, env: s.env, inventory: tools.readInventory(s.root) });
        assert.ok(!main.servers.has('serena'));
        assert.strictEqual(main.servers.get('context7').prefix, 'mcp__docs__'); // mcp-fixture
        assert.ok(!main.servers.has('own:gone'), 'a project server .mcp.json no longer holds');
        assert.ok(!main.servers.has('own:idea'), 'a plugin server whose plugin is not enabled');
        const text = s.line();
        assert.ok(text.includes(': LSP > Grep.'), text);
        assert.ok(!text.includes('Skipped here'), `an absent default type is the normal state since 2.10.1\n${text}`);
        assert.ok(text.includes('Load: ToolSearch select:mcp__docs__resolve-library-id,mcp__docs__query-docs'), text); // mcp-fixture
    }
    finally { s.done(); }
});

test('a ranked tool the server no longer has is skipped and named', () =>
{
    const s = sandbox();
    try
    {
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: own:jetbrains find_usages, find_old > LSP']);
        s.inventory(JETBRAINS);
        const text = s.line();
        assert.ok(text.includes(': LSP.'), text);
        assert.ok(text.includes('Skipped here: own:jetbrains find_old (gone from mcp__jetbrains__).'), text);
    }
    finally { s.done(); }
});

test('a doc that is a link is never read', { skip: process.platform === 'win32' && 'a symlink needs elevation' }, () =>
{
    const s = sandbox();
    try
    {
        const target = path.join(s.work, 'elsewhere.md');
        fs.writeFileSync(target, ['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: Grep', '- Purpose: SECRET'].join('\n'));
        fs.mkdirSync(path.dirname(path.join(s.root, DOC_REL)), { recursive: true });
        fs.symlinkSync(target, path.join(s.root, DOC_REL));
        const text = s.line();
        assert.ok(!text.includes('SECRET'), text);
        assert.match(text, /^Tool order - the stack's defaults/);
    }
    finally { s.done(); }
});

test('toolsLine never throws', () =>
{
    assert.strictEqual(tools.toolsLine({ projectRoot: null, env: {}, seat: null, suggest: false }), '');
});

test('validateRows', () =>
{
    const s = sandbox();
    try
    {
        assert.deepStrictEqual(tools.validateRows(s.root, s.env), [], 'a clean project prints nothing');
        s.doc([...NAV_ENTRY, '', '## T2 - Browser', '<!-- id: t2 -->', '- Job: browser', '- Order: playwright browser_navigate']);
        const jira = { command: 'npx', args: ['-y', 'jira-mcp@1.0.0'] };
        s.write(path.join(s.root, '.mcp.json'), { mcpServers: { jira } });
        const hash = tools.registrationHash(jira);
        s.inventory(server('mcp__jira__', 'own:jira', ['search'], { scope: 'project', registration: hash }));
        assert.deepStrictEqual(tools.validateRows(s.root, s.env), [
            '!! tools: T1 ranks own:jetbrains, which has no inventory entry on this machine - run /capture-preferences tools',
            '!! tools: T2 ranks playwright, which this machine does not reach - add the server or change the rank through /capture-preferences tools']);
        s.write(path.join(s.root, '.mcp.json'), { mcpServers: { jira: { ...jira, args: ['-y', 'jira-mcp@2.0.0'] } } });
        assert.ok(tools.validateRows(s.root, s.env).includes('!! tools: mcp__jira__ changed since the inventory was taken - run /alfred-code:update or /capture-preferences tools'));
        s.write(path.join(s.root, '.alfred', 'state', 'tools-inventory.json'), 'garbage{');
        assert.strictEqual(tools.validateRows(s.root, s.env)[0], '!! tools: tools-inventory.json is not valid JSON - re-run /capture-preferences tools');
    }
    finally { s.done(); }
});

test('the order and validate commands', () =>
{
    const s = sandbox();
    try
    {
        const run = (...args) => spawnSync(process.execPath, [TOOLS, ...args, '--project', s.root], { encoding: 'utf8', env: { ...s.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        let r = run('order');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^Tool order - the stack's defaults/);
        const seat = path.join(s.work, 'seat.md');
        fs.writeFileSync(seat, '---\nname: x\ntools: Grep\n---\nbody\n');
        r = run('order', '--seat', seat);
        assert.ok(r.stdout.includes('- navigation (locate symbols, callers and types before reading or editing code): Grep.'), r.stdout);
        r = run('validate');
        assert.strictEqual(r.status, 0);
        assert.strictEqual(r.stdout, '');
        s.doc(NAV_ENTRY);
        r = run('validate');
        assert.match(r.stdout, /^!! tools: T1 ranks own:jetbrains/);
    }
    finally { s.done(); }
});

// A doc that holds no entry - an empty file, or text that is not the shape - is broken, not a doc ranking nothing: read as
// valid it would fill every job with the defaults the user may have meant to outrank (matrix M6).
test('an empty or entry-less doc names its problem and states no default', () =>
{
    for (const body of ['', 'garbage{{ not a doc\n'])
    {
        const s = sandbox();
        try
        {
            s.write(path.join(s.root, '.alfred', 'docs', 'preferences', 'TOOLS-PREFERENCES.md'), body);
            const text = s.line();
            assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md: /, JSON.stringify(body));
            assert.ok(!/^- /m.test(text), `no job is stated: ${text}`);
            assert.ok(text.includes('\nDoc problem: TOOLS-PREFERENCES.md holds no `## T<n>` entry - rank a job through /capture-preferences tools, or remove the file for the stack\'s defaults'), text);
        }
        finally { s.done(); }
    }
});

// A fact true of this machine (its server lacks a ranked tool) or of this release (the pin dropped one) is no shape
// problem: the rank is skipped and named, and the doc keeps the defaults for the jobs it leaves out (the final review, I3).
test('a ranked tool this machine or this pin lacks skips its rank, never the defaults', () =>
{
    const s = sandbox();
    try
    {
        s.inventory(server('mcp__jb__', 'own:jb', ['find_usages']));
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: own:jb find_usages, get_symbol_info > serena find_symbol_v9 > LSP > Grep']);
        const text = s.line();
        assert.match(text, /^Tool order - the user's, from \.alfred\/docs\/preferences\/TOOLS-PREFERENCES\.md \(the stack's defaults for the jobs it leaves out\): /, text);
        assert.ok(text.includes('- navigation (locate symbols, callers and types before reading or editing code): LSP > Grep.'), text);
        assert.ok(text.includes(MEMORY_LINE), 'the memory default stays');
        assert.ok(text.includes('- documentation ('), 'the documentation default stays');
        assert.ok(/Skipped here: [^\n]*own:jb get_symbol_info \(gone from mcp__jb__\)/.test(text), text);
        assert.ok(/Skipped here: [^\n]*serena find_symbol_v9 \(gone from /.test(text), text);
        assert.ok(!text.includes('Doc problem'), text);
        assert.ok(tools.lintToolsDoc(fs.readFileSync(path.join(s.root, DOC_REL), 'utf8'), { inventory: tools.readInventory(s.root) }).problems.length === 2, 'lint still names both');
    }
    finally { s.done(); }
});

// The line rides every start beside the personal push, inside one hook output Claude Code caps: an over-cap doc states
// nothing but its problem, and a long valid order loses its Load clauses, then its tail, before it passes the line's own
// cap (the final review, I2).
test('an over-cap doc states no entry', () =>
{
    const s = sandbox();
    try
    {
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: serena find_symbol > LSP > Grep', `- Purpose: ${'x'.repeat(3100)}`]);
        const text = s.line();
        assert.ok(/\nDoc problem: TOOLS-PREFERENCES\.md is \d+ chars - the cap is 3000/.test(text), text.slice(0, 300));
        assert.ok(!/^- /m.test(text), 'no entry is stated');
        assert.ok(text.length < 400, `${text.length} chars`);
    }
    finally { s.done(); }
});

test('a long valid order drops its Load clauses to stay under the line cap', () =>
{
    const s = sandbox();
    try
    {
        const names = (n) => Array.from({ length: 10 }, (_, i) => `a_rather_long_tool_name_${n}_${String(i).padStart(2, '0')}`);
        const jobs = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
        s.inventory(Object.assign({}, ...jobs.map((j) => server(`mcp__${j}__`, `own:${j}`, names(j)))));
        s.doc(jobs.flatMap((j, i) => [`## T${i + 1} - ${j}`, `<!-- id: t${i + 1} -->`, `- Job: ${j}`, `- Order: own:${j} ${names(j).join(', ')}`, '']));
        assert.deepStrictEqual(tools.lintToolsDoc(fs.readFileSync(path.join(s.root, DOC_REL), 'utf8'), { inventory: tools.readInventory(s.root) }).problems, [], 'the doc is valid');
        const text = s.line();
        assert.ok(text.length <= tools.TOOLS_LINE_CAP, `${text.length} chars`);
        for (const j of jobs) assert.ok(text.includes(`\n- ${j}: own:${j} a_rather_long_tool_name_${j}_00`), j);
        assert.ok(!text.includes('Load: ToolSearch'), 'the Load clauses go first');
        assert.ok(text.includes('\nLoad clauses cut for size: load a rank\'s tools with ToolSearch by name before its first call.'), text.slice(-300));
    }
    finally { s.done(); }
});

test('a line still over the cap keeps its head and says where the rest is', () =>
{
    const rank = (i) => ({ label: `own:s${i} ${'t'.repeat(400)}`, names: [] });
    const jobs = Array.from({ length: 20 }, (_, i) => ({ job: `job${i}`, purpose: '', ranks: [rank(i)], skipped: [], isDefault: false }));
    const text = tools.startLine({ jobs, docRel: 'TOOLS-PREFERENCES.md', load: true });
    assert.ok(text.length <= tools.TOOLS_LINE_CAP, `${text.length} chars`);
    assert.ok(text.startsWith('Tool order - the user\'s, from TOOLS-PREFERENCES.md: '), text.slice(0, 80));
    assert.ok(text.endsWith(`\n... cut at ${tools.TOOLS_LINE_CAP} chars - run tools.js order for the whole order`), text.slice(-120));
});

// Task 11 of the no-MCP plan (2026-10-24): the stack ships no server, so a known type absent from the machine is the
// normal state. A DEFAULT rank the actor cannot reach is left out silently - the line named two or three servers the user
// never had at every main and seat start; a rank the user's doc chose is still named when it cannot be served.
test('no server registered: the defaults name no absent server, at the main start and a stack seat\'s', () =>
{
    const s = sandbox();
    try
    {
        s.write(path.join(s.root, '.claude', 'settings.json'), { enabledPlugins: {} });
        const seat = { frontmatter: fs.readFileSync(path.join(__dirname, '..', 'stack', 'agents', 'aspnet-verifier.md'), 'utf8') };
        for (const text of [s.line(), s.line({ seat })])
        {
            assert.ok(text.includes(': LSP > Grep.'), text);
            assert.ok(text.includes('- documentation (check a library\'s API or version before using it): WebFetch.'), text);
            assert.ok(!text.includes('Skipped here'), text);
            assert.ok(!/serena|context7|memory-service/.test(text), text);
        }
        s.doc([...NAV_ENTRY.slice(0, 3), '- Order: serena find_symbol > LSP > Grep']);
        assert.ok(s.line().includes('Skipped here: serena (not on this machine).'), 'a rank the user chose is still named');
    }
    finally { s.done(); }
});

// The final review of 2026-10-24 (B2): LSP and WebFetch are deferred tools in Claude Code (2.1.310 lists both behind
// ToolSearch), and the navigation rule points at the order's select line - a default line without one left the rule text
// and no way to load the tool.
test('a deferred built-in rank carries its own load clause at the main start; a seat whose tools grant it is not told to load it', () =>
{
    const s = sandbox();
    try
    {
        s.write(path.join(s.root, '.claude', 'settings.json'), { enabledPlugins: {} });
        const main = s.line();
        assert.ok(main.includes(': LSP > Grep. Load: ToolSearch select:LSP\n'), main);
        assert.ok(main.includes(': WebFetch. Load: ToolSearch select:WebFetch'), main);
        const seat = s.line({ seat: { frontmatter: fs.readFileSync(path.join(__dirname, '..', 'stack', 'agents', 'aspnet-verifier.md'), 'utf8') } });
        assert.ok(seat.includes(': LSP > Grep.'), seat);
        assert.ok(!seat.includes('Load:') && !seat.includes('Call them directly'), seat);
    }
    finally { s.done(); }
});

test('the record\'s servers under their original names: the main session ranks them by type, a built-ins-only seat is not told of them', () =>
{
    const s = sandbox();
    try
    {
        const record = require('../stack/mcp/original-mcps.json').mcpServers;
        s.write(path.join(s.root, '.claude', 'settings.json'), { enabledPlugins: {} });
        s.write(path.join(s.root, '.mcp.json'), { mcpServers: { serena: record.serena, context7: record.context7 } });
        const main = s.line();
        assert.ok(main.includes(`: serena find_symbol, find_referencing_symbols, get_symbols_overview > LSP > Grep. Load: ToolSearch select:${'mcp__serena__'}find_symbol,`), main); // mcp-fixture
        assert.ok(main.includes(`: context7 resolve-library-id, query-docs > WebFetch. Load: ToolSearch select:${'mcp__context7__'}resolve-library-id,`), main); // mcp-fixture
        assert.ok(!main.includes('Skipped here'), main);
        const seat = s.line({ seat: { frontmatter: fs.readFileSync(path.join(__dirname, '..', 'stack', 'agents', 'aspnet-verifier.md'), 'utf8') } });
        assert.ok(seat.includes(': LSP > Grep.') && !/serena|context7|Skipped here/.test(seat), seat);
    }
    finally { s.done(); }
});

// The stack's order fills in a job whose own ranks reach nothing (spec N1, N3): a seat keeps the job's line, the main
// session is told the stack's order stands in and why.
const SERENA_ONLY = ['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: serena find_symbol'];
const NO_PLUGINS = (s) => s.write(path.join(s.root, '.claude', 'settings.json'), { enabledPlugins: {} });
const FILL_NAV = 'Filled in: navigation - your ranks reach nothing here, so the stack\'s order stands in; fix them with /capture-preferences tools.';

test('a seat whose tools reach none of the user\'s navigation ranks is told the stack\'s order for it', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.doc(SERENA_ONLY);
        const text = s.line({ seat: { frontmatter: '---\ntools: LSP, Read, Grep\n---\n' } });
        assert.ok(text.includes(': LSP > Grep.'), text);
        assert.ok(!text.includes('Skipped here') && !text.includes('Filled in'), text);
    }
    finally { s.done(); }
});

test('the main session is told the stack\'s order stands in when the user\'s navigation ranks reach nothing', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.doc(SERENA_ONLY);
        const main = s.line();
        assert.ok(main.includes(': LSP > Grep. Load: ToolSearch select:LSP\n'), main);
        assert.ok(main.includes('Skipped here: serena (not on this machine)'), main);
        assert.ok(main.split('\n').includes(FILL_NAV), main);
    }
    finally { s.done(); }
});

test('a user\'s navigation entry ranking a server and a built-in: the main session is told both, a seat the built-in', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.write(path.join(s.root, '.mcp.json'), { mcpServers: { serena: require('../stack/mcp/original-mcps.json').mcpServers.serena } });
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: serena find_symbol > Grep']);
        const main = s.line();
        assert.ok(main.includes(': serena find_symbol > Grep.'), main);
        const seat = s.line({ seat: { frontmatter: '---\ntools: LSP, Read, Grep\n---\n' } });
        assert.ok(seat.includes(': Grep.') && !seat.includes('Filled in'), seat);
    }
    finally { s.done(); }
});

test('the fill-in holds for every job with stack defaults: documentation', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.doc(['## T2 - Library docs', '<!-- id: t2 -->', '- Job: documentation', '- Order: own:docs fetch_docs']);
        const main = s.line();
        assert.ok(main.includes(': WebFetch.'), main);
        assert.ok(main.includes('own:docs (no inventory entry here)'), main);
        assert.ok(main.includes('Filled in: documentation - '), main);
    }
    finally { s.done(); }
});

test('jobOrder: the ranks one job resolves to, whose they are and whether the stack\'s order stood in', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        assert.deepStrictEqual(tools.jobOrder({ projectRoot: s.root, env: s.env, job: 'navigation' }), { ranks: ['LSP', 'Grep'], own: false, fellBack: false, docRel: null });
        s.doc(SERENA_ONLY);
        assert.deepStrictEqual(tools.jobOrder({ projectRoot: s.root, env: s.env, job: 'navigation' }), { ranks: ['LSP', 'Grep'], own: true, fellBack: true, docRel: DOC_REL });
    }
    finally { s.done(); }
});

// LSP only where a language server covers the project (spec N2): the install-time check's file, read at the start.
const NO_LSP = (s) => s.write(path.join(s.root, '.alfred', 'state', 'lsp-coverage.json'), { version: 1, checked: '2026-10-24', servers: [], covered: [], missing: [] });

test('no language server covers the project: the default navigation order starts at the grep, silently', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        NO_LSP(s);
        const main = s.line();
        assert.ok(main.includes('): Grep.\n'), main);
        assert.ok(!main.includes('Skipped here') && !main.includes('LSP'), main);
    }
    finally { s.done(); }
});

test('a user\'s LSP rank no language server covers is named', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        NO_LSP(s);
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: LSP > Grep']);
        const main = s.line();
        assert.ok(main.includes('Skipped here: LSP (no language server covers this project)'), main);
        assert.ok(main.includes('): Grep.'), main);
        assert.ok(tools.validateRows(s.root, s.env).includes("!! tools: T1 ranks LSP, but no language server covers this project's files - install the language's *-lsp plugin and its server, then /alfred-code:update checks again, or change the rank through /capture-preferences tools"));
    }
    finally { s.done(); }
});

// Final review I3: a check that could not settle (an empty project, a capped walk) keeps LSP in the order.
test('a coverage file that is not settled keeps LSP in the order', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.write(path.join(s.root, '.alfred', 'state', 'lsp-coverage.json'), { version: 1, checked: '2026-10-24', servers: [], covered: [], missing: [], settled: false, why: 'empty' });
        const main = s.line();
        assert.ok(main.includes('LSP > Grep') && !main.includes('Skipped here'), main);
    }
    finally { s.done(); }
});

test('no coverage file, or one with a covering server, keeps LSP as today', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        const before = s.line();
        assert.ok(before.includes(': LSP > Grep. Load: ToolSearch select:LSP\n'), before);
        s.write(path.join(s.root, '.alfred', 'state', 'lsp-coverage.json'), { version: 1, checked: '2026-10-24', servers: [{ plugin: 'typescript-lsp', command: 'typescript-language-server', onPath: true, exts: ['.ts'] }], covered: ['.ts'], missing: [] });
        assert.strictEqual(s.line(), before);
        assert.deepStrictEqual(tools.validateRows(s.root, s.env), []);
    }
    finally { s.done(); }
});

// What navigation each actor gets, said plainly for init, configure and status (spec N1-N3); the memory lines lead.
const navLine = (s) => tools.modeLines({ projectRoot: s.root, env: s.env }).find((l) => l.startsWith('navigation: '));
const MEM_DEFAULT = "memory: default - Claude Code's own memory, at its default place";
test('modes: the stack\'s order, then the lsp line', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        assert.deepStrictEqual(tools.modeLines({ projectRoot: s.root, env: s.env }), [MEM_DEFAULT, "navigation: the stack's order - LSP > Grep", 'lsp: not checked yet - the next update or /alfred-code:init checks it']);
    }
    finally { s.done(); }
});

test('modes: a user\'s server rank is the main session\'s alone', () =>
{
    const s = sandbox();
    try
    {
        s.doc(['## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation', '- Order: serena find_symbol > Grep']);
        assert.strictEqual(navLine(s), `navigation: yours, from ${DOC_REL} - main session: serena find_symbol > Grep; agents: Grep`);
    }
    finally { s.done(); }
});

test('modes: a ranking that reaches nothing says the stack\'s order stands in', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.doc(SERENA_ONLY);
        assert.strictEqual(navLine(s), `navigation: yours, from ${DOC_REL}, reaches nothing here - the stack's order stands in: LSP > Grep`);
    }
    finally { s.done(); }
});

test('modes: a server rank only the main session reaches leaves the agents on the stack\'s order, said so', () =>
{
    const s = sandbox();
    try
    {
        s.doc(SERENA_ONLY);
        assert.strictEqual(navLine(s), `navigation: yours, from ${DOC_REL} - main session: serena find_symbol; agents: LSP > Grep (the stack's order)`);
    }
    finally { s.done(); }
});

test('the modes command prints the lines and --lsp refreshes the file', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        const run = (...args) => spawnSync(process.execPath, [TOOLS, ...args, '--project', s.root], { encoding: 'utf8', env: { ...s.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        const file = path.join(s.root, '.alfred', 'state', 'lsp-coverage.json');
        let r = run('modes');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout, `${MEM_DEFAULT}\nnavigation: the stack's order - LSP > Grep\nlsp: not checked yet - the next update or /alfred-code:init checks it\n`);
        assert.ok(!fs.existsSync(file), 'without --lsp nothing is written');
        r = run('modes', '--lsp');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.ok(fs.existsSync(file), 'the check ran');
        assert.match(r.stdout.split('\n')[2], /^lsp: (none covers|covers |not settled - the project holds no files yet)/);
    }
    finally { s.done(); }
});

test('modes: a doc with problems states no navigation order, and the line says why', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.write(path.join(s.root, DOC_REL), 'garbage\n');
        assert.strictEqual(navLine(s), `navigation: none stated - ${DOC_REL} has problems the start line names; fix them with /capture-preferences tools`);
        s.doc(['## T1 - Docs', '<!-- id: t1 -->', '- Job: documentation', '- Order: WebFetch']);
        assert.strictEqual(navLine(s), "navigation: the stack's order - LSP > Grep", 'a valid doc that ranks no navigation keeps the defaults for it');
    }
    finally { s.done(); }
});

// The memory mode (spec P2): ALFRED_CODE_MEMORY default or custom, and Claude's own memory switch in effect here.
const MEM_TOOLS = 'memory-service memory_store, memory_search, memory_list';
const settingsAt = (s, value, name = 'settings.json') => s.write(path.join(s.root, '.claude', name), value);

test('modes: memory default, custom with a rank, custom with none', () =>
{
    const s = sandbox();
    try
    {
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[0], "memory: default - Claude Code's own memory, at its default place");
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[0], `memory: custom - ${MEM_TOOLS}; Claude's own memory is off`);
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' } });
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[0], `memory: custom - ${MEM_TOOLS}; Claude's own memory is still on (autoMemoryEnabled is not false here)`, 'before the update writes the switch-off');
        settingsAt(s, { enabledPlugins: {}, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        const lines = tools.modeLines({ projectRoot: s.root, env: s.env });
        assert.strictEqual(lines[0], 'memory: custom - no memory tool is reachable here, so nothing is stored; rank one with /capture-preferences tools');
        assert.match(lines[1], /^navigation: /, 'then navigation, then lsp');
        assert.match(lines[2], /^lsp: /);
    }
    finally { s.done(); }
});

test('modes: under default, the switch-off in effect is named, a shadowed one is not', () =>
{
    const s = sandbox();
    try
    {
        settingsAt(s, { enabledPlugins: STACK, autoMemoryEnabled: false });
        const lines = tools.modeLines({ projectRoot: s.root, env: s.env });
        assert.deepStrictEqual(lines.slice(0, 2), ["memory: default - Claude Code's own memory, at its default place", 'memory: autoMemoryEnabled is false in .claude/settings.json - yours; native memory stays off until you remove it']);
        settingsAt(s, { autoMemoryEnabled: true }, 'settings.local.json');
        assert.deepStrictEqual(tools.memoryOffIn({ projectRoot: s.root, env: s.env }), [], 'settings.local.json outranks settings.json');
        fs.rmSync(path.join(s.root, '.claude', 'settings.local.json'));
        settingsAt(s, { enabledPlugins: STACK });
        s.write(path.join(s.config, 'settings.json'), { autoMemoryEnabled: false });
        assert.deepStrictEqual(tools.memoryOffIn({ projectRoot: s.root, env: s.env }), [path.join(s.config, 'settings.json')], 'the account file, shown in full outside the home folder');
        assert.deepStrictEqual(tools.memoryOffIn({ projectRoot: s.root, env: { ...s.env, CLAUDE_CONFIG_DIR: '' }, home: s.work }), [], 'no account file under that home');
    }
    finally { s.done(); }
});

// T12c (AC22): the mode is one of the stack's variables, read through the loader - the project's .variables included.
test('configure\'s memory area reports custom from .variables', () =>
{
    const s = sandbox();
    try
    {
        const vars = (text) => s.write(path.join(s.root, '.alfred', '.variables'), text);
        vars('ALFRED_CODE_MEMORY=custom\n');
        settingsAt(s, { enabledPlugins: STACK, autoMemoryEnabled: false });
        assert.strictEqual(tools.memoryMode({ projectRoot: s.root, env: s.env }), 'custom');
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[0], `memory: custom - ${MEM_TOOLS}; Claude's own memory is off`);
        // The team's custom in .variables keeps its switch-off for a developer whose settings.local.json answers default.
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'default' } }, 'settings.local.json');
        const lines = tools.modeLines({ projectRoot: s.root, env: s.env });
        assert.match(lines[1], /^memory: autoMemoryEnabled is false in \.claude\/settings\.json - the team's custom memory switch-off/, lines.join('\n'));
    }
    finally { s.done(); }
});

test('memoryMode reads Custom and bogus as default', () =>
{
    const s = sandbox();
    try
    {
        const mode = () => tools.memoryMode({ projectRoot: s.root, env: s.env });
        assert.strictEqual(mode(), 'default');
        for (const v of ['Custom', 'bogus', '', 'docs']) { settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: v } }); assert.strictEqual(mode(), 'default', v); }
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' } });
        assert.strictEqual(mode(), 'custom');
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'default' } }, 'settings.local.json');
        assert.strictEqual(mode(), 'default', 'settings.local.json first');
        fs.rmSync(path.join(s.root, '.claude', 'settings.local.json'));
        settingsAt(s, { enabledPlugins: STACK });
        assert.strictEqual(tools.memoryMode({ projectRoot: s.root, env: { ...s.env, ALFRED_CODE_MEMORY: 'custom' } }), 'custom', 'then the process env');
        settingsAt(s, '{ not json');
        assert.strictEqual(tools.memoryMode({ projectRoot: s.root, env: s.env }), 'default', 'a garbage file reads as unset');
    }
    finally { s.done(); }
});

test('validate names custom memory with no reachable rank, and a switch-off under native', () =>
{
    const s = sandbox();
    try
    {
        settingsAt(s, { enabledPlugins: {}, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        assert.ok(tools.validateRows(s.root, s.env).includes('!! memory: ALFRED_CODE_MEMORY is custom, but the tool order ranks no memory tool this machine reaches - rank one with /capture-preferences tools, or switch to native in /alfred-code:configure'), tools.validateRows(s.root, s.env).join('\n'));
        settingsAt(s, { enabledPlugins: {}, autoMemoryEnabled: false });
        const rows = tools.validateRows(s.root, s.env);
        assert.ok(rows.includes("!! memory: native memory is chosen, but autoMemoryEnabled is false in .claude/settings.json - Claude's own memory stays off until you remove it"), rows.join('\n'));
        assert.ok(!rows.some((r) => r.includes('is custom')), rows.join('\n'));
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        assert.deepStrictEqual(tools.validateRows(s.root, s.env).filter((r) => r.startsWith('!! memory')), [], 'custom with a reachable rank is fine');
    }
    finally { s.done(); }
});

// Final review C1: init and configure ask 'custom memory?' before the installer writes the mode, so the check that falls
// back to native must preview custom's lines - the mode on disk still reads default then.
test('modes: --memory custom previews the custom lines while the mode on disk is still default', () =>
{
    const s = sandbox();
    try
    {
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env, memory: 'custom' })[0], `memory: custom (preview) - ${MEM_TOOLS}; Claude's own memory goes off`);
        NO_PLUGINS(s);
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env, memory: 'custom' })[0], 'memory: custom (preview) - no memory tool is reachable here, so nothing would be stored; rank one with /capture-preferences tools');
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[0], MEM_DEFAULT, 'without the preview the mode on disk is said');
        const r = spawnSync(process.execPath, [TOOLS, 'modes', '--memory', 'custom', '--project', s.root], { encoding: 'utf8', env: { ...s.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        assert.match(r.stdout, /^memory: custom \(preview\) - no memory tool is reachable here/, r.stdout + r.stderr);
        settingsAt(s, { enabledPlugins: {}, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env, memory: 'custom' })[0], 'memory: custom - no memory tool is reachable here, so nothing is stored; rank one with /capture-preferences tools', 'the mode already custom is no preview');
    }
    finally { s.done(); }
});

// Final review M4: a data root the check cannot write to is one line in init's step 4, never a stack trace and no lines.
test('modes --lsp and lsp over an unwritable data root: one line, the modes lines after it, exit 0', () =>
{
    const s = sandbox();
    try
    {
        NO_PLUGINS(s);
        s.write(path.join(s.root, '.alfred', 'state'), 'a file where the folder goes');
        const run = (...args) => spawnSync(process.execPath, [TOOLS, ...args, '--project', s.root], { encoding: 'utf8', env: { ...s.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        const r = run('modes', '--lsp');
        assert.strictEqual(r.status, 0, r.stderr);
        const lines = r.stdout.trim().split('\n');
        assert.match(lines[0], /^!! lsp: the language-server check could not write lsp-coverage\.json \([A-Z]+\) - the last result stands; the next run checks again$/, r.stdout);
        assert.strictEqual(lines[1], MEM_DEFAULT, r.stdout);
        assert.strictEqual(r.stderr, '');
        const l = run('lsp', '--changed-only');
        assert.strictEqual(l.status, 0, l.stderr);
        assert.match(l.stdout, /^!! lsp: the language-server check could not write lsp-coverage\.json/);
    }
    finally { s.done(); }
});

// Final review M5: the user's own true in a project file stands under custom - every update keeps it - so validate names it.
// One in the account file is outranked by the switch-off the next update writes into the project's file: no row.
test('validate names custom memory beside the user\'s own autoMemoryEnabled true in a project file', () =>
{
    const s = sandbox();
    try
    {
        const own = (rows) => rows.filter((r) => r.includes('autoMemoryEnabled is true'));
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: true });
        assert.deepStrictEqual(own(tools.validateRows(s.root, s.env)), ["!! memory: ALFRED_CODE_MEMORY is custom, but autoMemoryEnabled is true in .claude/settings.json - Claude's own memory stays on beside your memory tool; remove the key from .claude/settings.json and /alfred-code:update switches it off"]);
        // Fix-pass review m3: the choice in settings.local.json - the next update's switch-off there outranks settings.json's true.
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'custom' } }, 'settings.local.json');
        assert.deepStrictEqual(own(tools.validateRows(s.root, s.env)), ["!! memory: ALFRED_CODE_MEMORY is custom, but autoMemoryEnabled is true in .claude/settings.json - Claude's own memory stays on beside your memory tool until /alfred-code:update writes the switch-off into .claude/settings.local.json"]);
        // The true in settings.local.json outranks the switch-off written into settings.json: it stays until taken out.
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' } });
        settingsAt(s, { autoMemoryEnabled: true }, 'settings.local.json');
        assert.deepStrictEqual(own(tools.validateRows(s.root, s.env)), ["!! memory: ALFRED_CODE_MEMORY is custom, but autoMemoryEnabled is true in .claude/settings.local.json - Claude's own memory stays on beside your memory tool; remove the key from .claude/settings.local.json and /alfred-code:update switches it off"]);
        fs.rmSync(path.join(s.root, '.claude', 'settings.local.json'));
        settingsAt(s, { enabledPlugins: STACK, env: { ALFRED_CODE_MEMORY: 'custom' } });
        s.write(path.join(s.config, 'settings.json'), { autoMemoryEnabled: true });
        assert.deepStrictEqual(own(tools.validateRows(s.root, s.env)), [], 'the account file\'s true');
        settingsAt(s, { enabledPlugins: STACK, autoMemoryEnabled: true });
        assert.deepStrictEqual(own(tools.validateRows(s.root, s.env)), [], 'native memory with true is fine');
    }
    finally { s.done(); }
});

// Final review M6: a switch-off the stamp records as the stack's (custom memory's, the mode hand-edited back to default
// before the next update) is not the user's - it is named as the stack's, which that update removes.
test('a switch-off the stamp records as the stack\'s is named as custom memory\'s, not yours', () =>
{
    const s = sandbox();
    try
    {
        const hash = require('node:crypto').createHash('sha256').update('false').digest('hex');
        const stamp = (file) => s.write(path.join(s.root, '.claude', 'alfred-code.stamp'), `commit: x\nmanaged-settings: ${file}:attribution.commit=abc,${file}:autoMemoryEnabled=${hash}\n`);
        settingsAt(s, { enabledPlugins: {}, autoMemoryEnabled: false });
        stamp('settings.json');
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[1], "memory: autoMemoryEnabled is false in .claude/settings.json - custom memory's switch-off, which the next /alfred-code:update removes");
        assert.ok(tools.validateRows(s.root, s.env).includes("!! memory: native memory is chosen, but custom memory's switch-off is still in .claude/settings.json - run /alfred-code:update to remove it"));
        stamp('settings.local.json');
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[1], 'memory: autoMemoryEnabled is false in .claude/settings.json - yours; native memory stays off until you remove it', 'a row for the other file is not this one');
    }
    finally { s.done(); }
});

// A developer answering default in settings.local.json under a team on custom: every update keeps the team's switch-off in
// settings.json, so 'the next update removes it' would be wrong - the lines name the developer's own way out.
test('the team\'s custom switch-off under a personal default names settings.local.json as the way out', () =>
{
    const s = sandbox();
    try
    {
        const hash = require('node:crypto').createHash('sha256').update('false').digest('hex');
        s.write(path.join(s.root, '.claude', 'alfred-code.stamp'), `commit: x\nversion: 2.10.1\nscope: project\nmanaged-settings: settings.json:autoMemoryEnabled=${hash}\n`);
        settingsAt(s, { enabledPlugins: {}, env: { ALFRED_CODE_MEMORY: 'custom' }, autoMemoryEnabled: false });
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'default' } }, 'settings.local.json');
        assert.strictEqual(tools.memoryMode({ projectRoot: s.root, env: s.env }), 'default');
        assert.strictEqual(tools.modeLines({ projectRoot: s.root, env: s.env })[1], "memory: autoMemoryEnabled is false in .claude/settings.json - the team's custom memory switch-off, which every update keeps; set autoMemoryEnabled: true in .claude/settings.local.json to turn it on for you");
        const rows = tools.validateRows(s.root, s.env).filter((r) => r.startsWith('!! memory:'));
        assert.deepStrictEqual(rows, ["!! memory: native memory is chosen in .claude/settings.local.json, but the team's .claude/settings.json is on custom memory and its switch-off keeps Claude's own memory off for you - set autoMemoryEnabled: true in .claude/settings.local.json, or remove ALFRED_CODE_MEMORY there to follow the team"]);
        // The way out taken: the local true outranks it, and nothing is named.
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'default' }, autoMemoryEnabled: true }, 'settings.local.json');
        assert.deepStrictEqual(tools.validateRows(s.root, s.env).filter((r) => r.startsWith('!! memory:')), []);
        // The team back on default: the ledgered false is the stack's again, which the next update removes.
        settingsAt(s, { env: { ALFRED_CODE_MEMORY: 'default' } }, 'settings.local.json');
        settingsAt(s, { enabledPlugins: {}, env: { ALFRED_CODE_MEMORY: 'default' }, autoMemoryEnabled: false });
        assert.match(tools.modeLines({ projectRoot: s.root, env: s.env })[1], /custom memory's switch-off, which the next \/alfred-code:update removes$/);
    }
    finally { s.done(); }
});

// Fix-pass review m5: an install from before 2.10.1 never ledgered the old memory server's switch-off, and the first update
// past it lifts the false from the run's own file - so it is the stack's too, never 'yours'. A 2.10.1 stamp's is the user's.
test('a pre-2.10.1 stamp\'s switch-off in the run\'s own file is named as the old memory server\'s', () =>
{
    const s = sandbox();
    try
    {
        const stamp = (version, scope) => s.write(path.join(s.root, '.claude', 'alfred-code.stamp'), `commit: x\nversion: ${version}\nscope: ${scope}\n`);
        const line = () => tools.modeLines({ projectRoot: s.root, env: s.env })[1];
        settingsAt(s, { enabledPlugins: {}, autoMemoryEnabled: false });
        stamp('2.10.0', 'project');
        assert.strictEqual(line(), "memory: autoMemoryEnabled is false in .claude/settings.json - the old memory server's switch-off, which the next /alfred-code:update removes");
        assert.ok(tools.validateRows(s.root, s.env).includes("!! memory: native memory is chosen, but the old memory server's switch-off is still in .claude/settings.json - run /alfred-code:update to remove it"));
        stamp('2.9.4', 'project');
        assert.match(line(), /the old memory server's switch-off/, 'any release before it');
        for (const [version, scope, why] of [['2.10.1', 'project', 'the retirement release itself'], ['2.11.0', 'project', 'a later one'], ['2.10.0', 'local', 'the lift reads settings.local.json at local scope']])
        {
            stamp(version, scope);
            assert.strictEqual(line(), 'memory: autoMemoryEnabled is false in .claude/settings.json - yours; native memory stays off until you remove it', why);
        }
    }
    finally { s.done(); }
});

// Release 3, T4 (R3): a child reads its workspace root's TOOLS-PREFERENCES.md where it has none; no capture verb does.
function wsTools({ childFile = 'parent ..\n' } = {})
{
    // .native: Windows CI's temp is an 8.3 name (RUNNER~1) and the readers report the long one.
    const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-ws-')));
    const put = (rel, text) => { const f = path.join(work, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    put('ws/.claude/alfred-code.stamp', 'sha: x\n'); put('ws/.alfred/workspace', 'child api\n');
    put('ws/api/.claude/alfred-code.stamp', 'sha: x\n'); put('ws/api/.alfred/workspace', childFile);
    put('ws/api/.claude/settings.json', JSON.stringify({ enabledPlugins: STACK }));
    put(`ws/${DOC_REL}`, ['# Tools preferences', '', 'Updated: 2026-10-24', '', '## T7 - Code navigation', '<!-- id: t7 -->', '- Job: navigation', '- Order: LSP > Grep', ''].join('\n'));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(work, 'config') };
    delete env.ALFRED_CODE_MEMORY; delete env.ALFRED_CODE_DATA_PATH; delete env.ALFRED_CODE_WORKSPACE;
    return { work, api: path.join(work, 'ws', 'api'), rootDoc: path.join(work, 'ws', ...DOC_REL.split('/')), env, put, done: () => fs.rmSync(work, { recursive: true, force: true }) };
}

test('the tools order reads the root\'s TOOLS-PREFERENCES.md when the child has none; ignore doc gives it none', () =>
{
    const s = wsTools();
    const ig = wsTools({ childFile: 'parent ..\nignore doc TOOLS-PREFERENCES.md\n' });
    try
    {
        assert.strictEqual(tools.orderFor({ projectRoot: s.api, env: s.env }).doc?.abs, s.rootDoc);
        assert.strictEqual(tools.suggestOnce(s.api), false, 'an inherited doc is a doc: no suggestion');
        assert.strictEqual(tools.orderFor({ projectRoot: ig.api, env: ig.env }).doc, null);
        assert.strictEqual(tools.orderFor({ projectRoot: s.api, env: { ...s.env, ALFRED_CODE_WORKSPACE: '0' } }).doc, null, 'the kill switch reads only the child\'s own');
    }
    finally { s.done(); ig.done(); }
});

test('capture lint, validate and tools.js next never read an ancestor\'s doc - next numbers from the child\'s own', () =>
{
    const s = wsTools();
    try
    {
        assert.strictEqual(tools.readToolsDoc(s.api), null, 'the default list is the child\'s own');
        const next = spawnSync(process.execPath, [TOOLS, 'next', '--project', s.api], { cwd: s.api, env: s.env, encoding: 'utf8' });
        assert.match(next.stdout, /^Next: T1$/m, next.stdout + next.stderr);
        const lint = spawnSync(process.execPath, [TOOLS, 'lint', '--project', s.api], { cwd: s.api, env: s.env, encoding: 'utf8' });
        assert.doesNotMatch(lint.stdout + lint.stderr, /T7/);
    }
    finally { s.done(); }
});
