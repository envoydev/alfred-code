'use strict';
// The seats' generated tool lines (scripts/seat-tools.js, 2026-10-14): each server granted whole, the tools a seat
// must not hold removed, so the listing every session pays for carries one name per server while each seat holds
// exactly what it held. Measured live before the change: a whole-server grant is listed verbatim, `disallowedTools`
// is not listed, and a removed tool is not available to the seat.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const st = require('./seat-tools.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-tools-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const PINS = {
    'alfred-memory': { tools: ['memory_store', 'memory_search', 'memory_list', 'memory_delete'] },
    browser: { tools: ['browser_navigate', 'browser_click', 'browser_run_code_unsafe'] },
};
const MEM = 'mcp__plugin_alfred-memory_alfred-memory';
const CHROME = 'mcp__plugin_chrome-control_chrome-control';

test('a server named tool by tool is granted whole and every other pinned tool removed; built-ins keep their place', () =>
{
    const out = st.generate('s', ['alfred-memory:memory_store', 'alfred-memory:memory_search', 'Read', 'alfred-memory:memory_list', 'Bash'], PINS);
    assert.deepStrictEqual(out.errors, []);
    assert.strictEqual(out.tools, `${MEM}, Read, Bash`);
    assert.strictEqual(out.disallowed, `${MEM}__memory_delete`);
    assert.deepStrictEqual([...st.effectiveTools(out.tools, out.disallowed, PINS)].sort(),
        ['Bash', 'Read', `${MEM}__memory_list`, `${MEM}__memory_search`, `${MEM}__memory_store`].sort(), 'exactly the named tools');
});

test('a whole server (*) keeps a later pin\'s tools, minus the ones it removes; an engine reads the browser list', () =>
{
    const out = st.generate('s', ['chrome-control:*', 'chrome-control:!browser_run_code_unsafe', 'Read'], PINS);
    assert.strictEqual(out.tools, `${CHROME}, Read`);
    assert.strictEqual(out.disallowed, `${CHROME}__browser_run_code_unsafe`);
    const later = { ...PINS, browser: { tools: [...PINS.browser.tools, 'browser_new'] } };
    assert.ok(st.effectiveTools(out.tools, out.disallowed, later).has(`${CHROME}__browser_new`), '* takes the new tool');
    const named = st.generate('s', ['alfred-memory:memory_store'], { ...PINS, 'alfred-memory': { tools: [...PINS['alfred-memory'].tools, 'memory_wipe'] } });
    assert.match(named.disallowed, /memory_wipe/, 'a server named tool by tool never gains a tool a pin adds');
});

test('what the intent cannot say is refused, never guessed', () =>
{
    const errs = (tokens, pins = PINS) => st.generate('s', tokens, pins).errors.join(' | ');
    assert.match(errs(['alfred-memory:nope']), /no tool 'nope' at its pin/);
    assert.match(errs(['alfred-memory:*', 'alfred-memory:memory_store']), /granted whole \(\*\) and tool by tool/);
    assert.match(errs(['alfred-memory:!memory_delete']), /needs alfred-memory:\* beside it/);
    assert.match(errs(['windows-control:Snapshot']), /no pinned tool list/);
});

test('effectiveTools reads every grant shape Claude Code takes: a tool, the server, its wildcard, then the removals', () =>
{
    const set = st.effectiveTools(`Read, ${MEM}__memory_store, ${CHROME}__*`, `${CHROME}__browser_click`, PINS);
    assert.deepStrictEqual([...set].sort(), ['Read', `${MEM}__memory_store`, `${CHROME}__browser_navigate`, `${CHROME}__browser_run_code_unsafe`].sort());
    assert.ok(st.effectiveTools('mcp__plugin_other_other', '', PINS).has('mcp__plugin_other_other'), 'a server with no pin stays as written'); // mcp-fixture
});

test('rewrite puts disallowedTools right after tools, drops it when empty, and keeps the file\'s line endings', () =>
{
    const text = '---\r\nname: s\r\ntools: Read\r\ndisallowedTools: old\r\nmodel: sonnet\r\n---\r\nbody\r\n';
    assert.strictEqual(st.rewrite(text, { tools: `${MEM}, Read`, disallowed: `${MEM}__memory_delete` }),
        `---\r\nname: s\r\ntools: ${MEM}, Read\r\ndisallowedTools: ${MEM}__memory_delete\r\nmodel: sonnet\r\n---\r\nbody\r\n`);
    assert.strictEqual(st.rewrite(text, { tools: 'Read', disallowed: '' }), '---\r\nname: s\r\ntools: Read\r\nmodel: sonnet\r\n---\r\nbody\r\n');
    assert.throws(() => st.rewrite('no frontmatter', { tools: 'Read', disallowed: '' }), /no frontmatter/);
});

test('drift: a hand edit, a seat with no row and a row with no seat are findings; --write clears them', () =>
{
    const dir = fs.mkdtempSync(path.join(TMP, 'agents-'));
    fs.writeFileSync(path.join(dir, 'a.md'), '---\nname: a\ntools: Read\n---\nbody\n');
    fs.writeFileSync(path.join(dir, 'b.md'), '---\nname: b\ntools: Read\n---\nbody\n');
    const intent = { a: ['alfred-memory:memory_store', 'Read'], gone: ['Read'] };
    const found = st.drift({ intent, pins: PINS, dir }).join('\n');
    assert.match(found, /a\.md: its tools: \/ disallowedTools: lines differ/);
    assert.match(found, /b\.md has no row/);
    assert.match(found, /names 'gone', which has no/);
    st.writeAll({ intent: { a: intent.a }, pins: PINS, dir });
    assert.strictEqual(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'),
        `---\nname: a\ntools: ${MEM}, Read\ndisallowedTools: ${MEM}__memory_search, ${MEM}__memory_list, ${MEM}__memory_delete\n---\nbody\n`, 'the removals in the pin\'s order');
    assert.deepStrictEqual(st.drift({ intent: { a: intent.a, b: ['Read'] }, pins: PINS, dir }), []);
});

// The user's ruling of 2026-10-24: the stack depends on no MCP server, so every shipped row is built-in tools only and
// no seat lists a removal. The generator keeps its server shapes (the fixtures above) for the day a seat holds one again.
test('the shipped seats match their rows, and every seat holds built-in tools only', () =>
{
    assert.deepStrictEqual(st.drift(), []);
    const dir = path.join(__dirname, '..', 'stack', 'agents');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')))
    {
        const { tools, disallowed } = st.linesOf(fs.readFileSync(path.join(dir, f), 'utf8'));
        assert.ok(tools && !/mcp__/.test(tools), `${f}: ${tools}`);
        assert.ok(!disallowed, `${f}: no removals`);
    }
});

test('the lint checks and the copy route read a whole-server grant', () =>
{
    const lint = require('./lint-mcp-tools.js');
    const file = (text) => [{ file: 'stack/agents/x.md', text }];
    const entries = [{ name: 'alfred-memory', mcpServers: { 'alfred-memory': {} } }];
    assert.deepStrictEqual(lint.lintStaleMcpToolNames({ files: file(`tools: ${MEM}, Read`), entries }), [], 'check 59: a shipped server');
    assert.strictEqual(lint.lintStaleMcpToolNames({ files: file('tools: mcp__plugin_navigation_navigation, Read'), entries }).length, 1, 'check 59: a stale one'); // mcp-fixture
    assert.deepStrictEqual(lint.lintStaleMcpToolNames({ files: file(`see ${MEM}.`), entries }), [], 'a sentence\'s period is not the server\'s');
    const bare = ['mcp', 'alfred-memory'].join('__');
    assert.strictEqual(lint.lintMcpToolNames({ files: file(`tools: ${bare}, Read`), names: ['alfred-memory'] }).length, 1, 'check 54: the bare grant resolves to nothing');
    assert.deepStrictEqual(lint.lintMcpToolNames({ files: file(`${bare}-other`), names: ['alfred-memory'] }), [], 'a longer name is not the grant');
    const mcp = require('./install/mcp.js');
    const copied = mcp.respellToolNames(`tools: ${MEM}, ${CHROME}, Read\ndisallowedTools: ${CHROME}__browser_run_code_unsafe\n`, ['chrome-control']);
    const chromeBare = ['mcp', 'chrome-control'].join('__');
    assert.strictEqual(copied, `tools: ${MEM}, ${chromeBare}, Read\ndisallowedTools: ${chromeBare}__browser_run_code_unsafe\n`, 'only the registered server takes the bare spelling, grant and removal alike');
    assert.deepStrictEqual(mcp.bareServersIn(copied), ['chrome-control']);
});

// audit 2026-10-14 AG06: a server a seat names tool by tool is granted WHOLE minus the pinned list's other tools, so on
// the installer's unpinned fallback a newer server's added tools would reach that seat. Every such server must carry a
// release pin; the exact-name grants before ec2f0027 were immune, this keeps the whole-server shape as tight.
function unpinnedNamedServers(intent, pins)
{
    const out = new Set();
    for (const [seat, tokens] of Object.entries(intent))
        for (const raw of tokens)
        {
            const token = String(raw).trim();
            const at = token.indexOf(':');
            if (at < 0) continue;
            const tool = token.slice(at + 1);
            if (tool === '*' || tool.startsWith('!')) continue;
            const role = st.roleOf(token.slice(0, at));
            const row = pins[role];
            if (!row || typeof row.version !== 'string' || !/^[0-9]/.test(row.version)) out.add(`${role} (${seat})`);
        }
    return [...out];
}

test('every server a seat names tool by tool carries a release pin, so the unpinned fallback widens no seat', () =>
{
    const intent = JSON.parse(fs.readFileSync(st.INTENT_FILE, 'utf8')).seats;
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-pins.json'), 'utf8')).pins;
    assert.deepStrictEqual(unpinnedNamedServers(intent, pins), []);
    // the shipped rows name no server (2026-10-24), so the guard is held on a row that does
    const named = { a: ['alfred-memory:memory_store', 'Read'] };
    assert.deepStrictEqual(unpinnedNamedServers(named, pins), []);
    const nulled = { ...pins, 'alfred-memory': { ...pins['alfred-memory'], version: null } };
    assert.ok(unpinnedNamedServers(named, nulled).some((r) => r.startsWith('alfred-memory ')), 'red with one pin nulled');
});
