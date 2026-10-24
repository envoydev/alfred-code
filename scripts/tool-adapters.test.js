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

// Since 2.10.1 the stack starts no serena: the record's add-back line launches it with its own upstream `claude-code`
// context (stack/mcp/original-mcps.json), which turns six tools off - file, shell and pattern search are the harness's
// (serena-agent 2.1.0's claude-code.yml, read and hashed at the v2.1.0 tag on 2026-10-24). The adapter row carries those six
// as `off`, so the table lists what that server serves - memory tools and the plain writers included - and no stack
// context file is read.
test('serena serves its pin less the six tools its upstream claude-code context turns off', () =>
{
    const SIX = ['create_text_file', 'read_file', 'execute_shell_command', 'find_file', 'list_dir', 'search_for_pattern'];
    const meta = readMeta();
    assert.deepStrictEqual(meta.types.serena.off, SIX);
    assert.strictEqual(meta.types.serena.context, undefined, 'no stack context file');
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'stack', 'mcp', 'navigation-context.yml')), 'the stack ships no navigation context');
    assert.ok(/--context","claude-code"/.test(JSON.stringify(require('../stack/mcp/original-mcps.json').mcpServers.serena.args)), 'the record launches the upstream context');
    const t = build();
    for (const tool of SIX) assert.ok(!t.types.serena.tools.includes(tool), tool);
    for (const tool of ['write_memory', 'replace_symbol_body', 'onboarding', 'rename_symbol', 'find_symbol']) assert.ok(t.types.serena.tools.includes(tool), tool);
    assert.strictEqual(t.types.serena.off, undefined, 'the built copy carries the served list, not the off list');
    meta.types.serena.jobs.navigation.push('read_file');
    assert.throws(() => build({ meta }), /serena: read_file is not a tool of alfred-navigation at 2\.1\.0 as its upstream context serves it/);
    const odd = readMeta();
    odd.types.serena.off.push('no_such_tool');
    assert.throws(() => build({ meta: odd }), /serena: off tool no_such_tool is not a tool of alfred-navigation at 2\.1\.0/);
});

// Since 2.10.1 the install denies no server tool (it ships none): a type with no context file serves its whole pin.
test('a type with no context file serves its whole pin', () =>
{
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'mcp-tools.json'), 'utf8')).servers;
    const t = build();
    assert.deepStrictEqual(t.types['memory-service'].tools, [...pins['alfred-memory'].tools].sort());
    assert.ok(t.types.playwright.tools.includes('browser_run_code_unsafe'));
    assert.ok(t.types.playwright.tools.includes('browser_navigate'));
    const meta = readMeta();
    meta.types['memory-service'].jobs.memory.push('memory_nonexistent');
    assert.throws(() => build({ meta }), /memory-service: memory_nonexistent is not a tool of alfred-memory at 12\.1\.1$/);
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
