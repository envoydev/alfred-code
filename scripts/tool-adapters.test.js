'use strict';
// The adapter table: meta/tool-adapters.json (hand-edited) is built into the copy the capture skill and the hooks read,
// each type's pinned version and tool list folded in from meta/mcp-tools.json; lint check 66 fails a stale copy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, drift, META, SHIPPED } = require('./tool-adapters.js');

const readMeta = () => JSON.parse(fs.readFileSync(META, 'utf8'));

test('build folds each type\'s pinned version and tools', () =>
{
    const t = build();
    assert.strictEqual(t.types.serena.version, '2.1.0');
    assert.ok(t.types.serena.tools.includes('find_symbol'));
    assert.strictEqual(t.types.context7.version, null);
    assert.deepStrictEqual(t.types.context7.tools, ['query-docs', 'resolve-library-id']);
    assert.deepStrictEqual(t.jobs.navigation.default, ['serena', 'LSP', 'Grep']);
    assert.strictEqual(t.generatedBy, 'tool-adapters');
    assert.strictEqual(t.note, undefined, 'the built copy drops the hand-edit note');
});

test('build refuses a job or edit tool the pinned server does not have', () =>
{
    const meta = readMeta();
    meta.types.serena.jobs.navigation.push('find_symbol_v9');
    assert.throws(() => build({ meta }), /serena: find_symbol_v9 is not a tool of alfred-navigation at 2\.1\.0/);
    const edit = readMeta();
    edit.types.playwright.edit.push('browser_teleport');
    assert.throws(() => build({ meta: edit }), /playwright: browser_teleport is not a tool of browser at /);
});

// The stack's navigation server is started with its own context, which switches eighteen of the pin's tools off - the
// writers no hook sees and every memory tool (the user's ruling of 2026-10-13: navigation only). The table holds what
// that server serves, so a doc can never rank a tool it does not have, and the start line never names one.
test('a type with a context serves its pin less the context\'s excluded_tools', () =>
{
    const t = build();
    for (const tool of ['write_memory', 'read_memory', 'list_memories', 'edit_memory', 'rename_memory', 'delete_memory', 'replace_content', 'create_text_file'])
        assert.ok(!t.types.serena.tools.includes(tool), tool);
    assert.ok(t.types.serena.tools.includes('rename_symbol'));
    assert.strictEqual(t.types.serena.context, undefined, 'the built copy carries the served list, not the context path');
    const meta = readMeta();
    meta.types.serena.edit.push('write_memory');
    assert.throws(() => build({ meta }), /serena: write_memory is not a tool of alfred-navigation at 2\.1\.0 as stack\/mcp\/navigation-context\.yml serves it/);
    const gone = readMeta();
    gone.types.serena.context = 'stack/mcp/absent.yml';
    assert.throws(() => build({ meta: gone }), /serena: context 'stack\/mcp\/absent\.yml' cannot be read/);
});

// The install removes the memory tools the stack never calls and Playwright's browser_run_code_unsafe from every
// session's context (MEMORY_TOOLS_USED, BROWSER_TOOLS_OFF), so the table never offers a rank no session can call.
test('a type serves its pin less the tools the install denies', () =>
{
    const { MEMORY_TOOLS_USED } = require('./install/alfred-code.js');
    const t = build();
    assert.deepStrictEqual(t.types['memory-service'].tools, [...MEMORY_TOOLS_USED].sort());
    assert.ok(!t.types.playwright.tools.includes('browser_run_code_unsafe'));
    assert.ok(t.types.playwright.tools.includes('browser_navigate'));
    const meta = readMeta();
    meta.types['memory-service'].jobs.memory.push('memory_health');
    assert.throws(() => build({ meta }), /memory-service: memory_health is not a tool of alfred-memory at 12\.1\.1 as the install serves it/);
});

test('build refuses a default naming neither a type nor a built-in', () =>
{
    const meta = readMeta();
    meta.jobs.navigation.default = ['jetbrains', 'Grep'];
    assert.throws(() => build({ meta }), /navigation: default 'jetbrains' is neither a type nor a built-in/);
});

test('build refuses a type whose pin is not in meta/mcp-tools.json', () =>
{
    const meta = readMeta();
    meta.types.playwright.pin = 'nope';
    assert.throws(() => build({ meta }), /playwright: pin 'nope' has no row in meta\/mcp-tools\.json/);
});

test('build refuses a type job that is not a job', () =>
{
    const meta = readMeta();
    meta.types.serena.jobs.refactoring = ['rename_symbol'];
    assert.throws(() => build({ meta }), /serena: job 'refactoring' is not in jobs/);
});

test('drift is empty for the committed copy and names a stale one', () =>
{
    assert.deepStrictEqual(drift(), []);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-adapters-'));
    try
    {
        const file = path.join(dir, 'tool-adapters.json');
        const stale = build();
        stale.types.serena.version = '1.0.0';
        fs.writeFileSync(file, `${JSON.stringify(stale, null, 2)}\n`);
        assert.deepStrictEqual(drift({ file }), ['stack/skills/capture-preferences/scripts/tool-adapters.json is not what meta/tool-adapters.json builds - run npm run tool-adapters']);
        assert.deepStrictEqual(drift({ file: path.join(dir, 'absent.json') }), ['stack/skills/capture-preferences/scripts/tool-adapters.json is missing - run npm run tool-adapters']);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.ok(SHIPPED.endsWith(path.join('stack', 'skills', 'capture-preferences', 'scripts', 'tool-adapters.json')));
});
