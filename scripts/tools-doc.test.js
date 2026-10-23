'use strict';
// The tools doc (TOOLS-PREFERENCES.md): parsed through the preferences section reader with its own fields, linted
// against the adapter table and this machine's inventory, its next id past the retired ones.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SCRIPTS = path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'scripts');
const TOOLS = path.join(SCRIPTS, 'tools.js');
const { parseToolsDoc, lintToolsDoc, nextToolsId, readAdapters, TOOLS_CAP, TOOLS_FIELD } = require(TOOLS);
const { parseSections } = require(path.join(SCRIPTS, 'preferences.js'));

const EXAMPLE = [
    '# Tools preferences', '', 'Updated: 2026-10-23', '',
    '## T1 - Code navigation', '<!-- id: t1 -->', '- Job: navigation',
    '- Order: own:jetbrains find_usages, get_symbol_info > serena find_symbol, find_referencing_symbols > LSP > Grep',
    '- Purpose: locate symbols, callers and types before reading or editing code', '',
    '## T2 - Library docs', '<!-- id: t2 -->', '- Job: documentation',
    '- Order: own:exa web_search_exa > context7 resolve-library-id, query-docs > WebFetch',
    '- Purpose: check a library\'s API or version before using it; with no source, say it is unverified', '',
    '## T3 - Database', '<!-- id: t3 -->', '- Job: database', '- Order: own:postgres query',
    '- Purpose: read schema and data while debugging; never write', '',
    '## T4 - Not for agents', '<!-- id: t4 -->', '- Job: deny', '- Deny: own:postgres, own:jetbrains execute_terminal_command',
    '- Why: database access and messages stay with the main session', ''].join('\n');
const server = (type, tools) => ({ type, tools: Object.fromEntries(tools.map((t) => [t, { readOnly: null, destructive: null, target: null }])) });
const INVENTORY = { version: 1, captured: '2026-10-23', servers: {
    mcp__jetbrains__: server('own:jetbrains', ['find_usages', 'get_symbol_info', 'execute_terminal_command']),
    mcp__exa__: server('own:exa', ['web_search_exa']),
    mcp__postgres__: server('own:postgres', ['query']),
} };
const adapters = readAdapters();
const lint = (text, inventory = INVENTORY) => lintToolsDoc(text, { adapters, inventory });
const swap = (from, to) => EXAMPLE.replace(from, to);

test('parseToolsDoc reads ranks, purpose and the deny list', () =>
{
    const { entries, problems } = parseToolsDoc(EXAMPLE, adapters);
    assert.deepStrictEqual(parseToolsDoc(EXAMPLE).entries, entries, 'the table is read when none is handed in');
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(entries.map((e) => [e.id, e.job]), [['T1', 'navigation'], ['T2', 'documentation'], ['T3', 'database'], ['T4', 'deny']]);
    assert.deepStrictEqual(entries[0].ranks, [
        { kind: 'server', type: 'own:jetbrains', tools: ['find_usages', 'get_symbol_info'] },
        { kind: 'server', type: 'serena', tools: ['find_symbol', 'find_referencing_symbols'] },
        { kind: 'builtin', name: 'LSP' }, { kind: 'builtin', name: 'Grep' }]);
    assert.strictEqual(entries[0].purpose, 'locate symbols, callers and types before reading or editing code');
    assert.deepStrictEqual(entries[3].deny, [{ type: 'own:postgres', tool: null }, { type: 'own:jetbrains', tool: 'execute_terminal_command' }]);
});

test('lint passes the example with an inventory holding its own types', () =>
{
    // The spec's example ranks postgres for the main session and denies it to agents: lint notes it, nothing more.
    assert.deepStrictEqual(lint(EXAMPLE), { problems: [], notes: ['T3: own:postgres query is also denied - agents skip that rank'] });
});

test('lint: the cap', () =>
{
    const over = EXAMPLE.replace('never write', `never write${'x'.repeat(TOOLS_CAP + 1 - EXAMPLE.length)}`);
    assert.strictEqual(over.length, TOOLS_CAP + 1);
    assert.deepStrictEqual(lint(over).problems, [`TOOLS-PREFERENCES.md is ${TOOLS_CAP + 1} chars - the cap is ${TOOLS_CAP}`]);
    const at = EXAMPLE.replace('never write', `never write${'x'.repeat(TOOLS_CAP - EXAMPLE.length)}`);
    assert.strictEqual(at.length, TOOLS_CAP);
    assert.deepStrictEqual(lint(at).problems, []);
});

test('lint: an unknown type', () =>
{
    assert.deepStrictEqual(lint(swap('own:jetbrains find_usages, get_symbol_info >', 'jetbrains find_usages >')).problems,
        ['T1: jetbrains is neither a known type nor own:<label>']);
});

test('lint: a known type\'s tool its pin lacks', () =>
{
    assert.deepStrictEqual(lint(swap('serena find_symbol,', 'serena find_symbol_v9,')).problems, ['T1: serena find_symbol_v9 is not a tool of serena at 2.1.0']);
});

test('lint: a server rank with no tools, a built-in not listed', () =>
{
    assert.deepStrictEqual(lint(swap('> LSP > Grep', '> serena > Grep')).problems, ['T1: serena names no tool - a server rank is the type and the tools of it that serve the job']);
    assert.deepStrictEqual(lint(swap('> LSP > Grep', '> LSP > Ripgrep')).problems, ['T1: Ripgrep is neither a known type nor own:<label>']);
    assert.deepStrictEqual(lint(swap('> LSP > Grep', '> LSP > Grep two')).problems, ['T1: Grep is a built-in and takes no tools']);
});

test('lint: a job twice, a job with no Order, a deny entry with an Order', () =>
{
    assert.deepStrictEqual(lint(swap('- Job: database', '- Job: navigation')).problems, ['T3: navigation is already T1\'s job']);
    assert.deepStrictEqual(lint(swap('- Order: own:postgres query\n', '')).problems, ['T3: no Order: line']);
    assert.deepStrictEqual(lint(swap('- Job: deny\n', '- Job: deny\n- Order: LSP\n')).problems, ['T4: the deny entry takes Deny:, not Order:']);
    assert.deepStrictEqual(lint(swap('- Job: database\n', '')).problems, ['T3: no Job: line']);
});

test('lint: an entry with no T id, or another doc\'s id', () =>
{
    assert.deepStrictEqual(lint(swap('## T3 - Database', '## Database')).problems, ['`## Database` has no T<n> id']);
    assert.deepStrictEqual(lint(swap('## T3 - Database', '## C3 - Database')).problems, ['C3 is not a T<n> id - this doc\'s entries are T1, T2, ...']);
});

test('own type with no inventory is a note', () =>
{
    const { problems, notes } = lint(EXAMPLE, null);
    assert.deepStrictEqual(problems, []);
    assert.deepStrictEqual(notes, [
        'T1: own:jetbrains has no inventory entry here - run /capture-preferences tools on this machine',
        'T2: own:exa has no inventory entry here - run /capture-preferences tools on this machine',
        'T3: own:postgres has no inventory entry here - run /capture-preferences tools on this machine',
        'T3: own:postgres query is also denied - agents skip that rank']);
});

test('an own tool the inventory lacks is a problem', () =>
{
    assert.deepStrictEqual(lint(swap('own:postgres query', 'own:postgres query, drop_table')).problems, ['T3: own:postgres drop_table is not a tool of own:postgres here']);
});

test('a ranked tool that is also denied is a note', () =>
{
    assert.deepStrictEqual(lint(swap('own:jetbrains execute_terminal_command', 'serena find_symbol')).notes, [
        'T1: serena find_symbol is also denied - agents skip that rank',
        'T3: own:postgres query is also denied - agents skip that rank']);
});

test('a malformed rank is named by its text', () =>
{
    assert.deepStrictEqual(lint(swap('> LSP > Grep', '> LSP > > Grep')).problems, ['T1: rank \'\' is not \'<type> <tool>, ...\' or a built-in']);
    assert.deepStrictEqual(lint(swap('own:postgres query', 'own:postgres qu ery')).problems, ['T3: rank \'own:postgres qu ery\' is not \'<type> <tool>, ...\' or a built-in']);
});

test('nextToolsId skips retired ids', () =>
{
    assert.strictEqual(nextToolsId(EXAMPLE.replace('Updated: 2026-10-23', 'Updated: 2026-10-23\nRetired: T7')), 'T8');
    assert.strictEqual(nextToolsId(EXAMPLE), 'T5');
    assert.strictEqual(nextToolsId(''), 'T1');
});

test('parseSections keeps its default fields', () =>
{
    const text = '## C1 - One\n- Rule: a rule\n- Job: navigation\n';
    assert.deepStrictEqual(parseSections(text)[0].fields, { Rule: 'a rule' });
    assert.deepStrictEqual(parseSections(text, TOOLS_FIELD)[0].fields, { Job: 'navigation' });
});

test('the lint command reads the doc under the docs root', () =>
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-doc-')));
    try
    {
        const run = () => spawnSync(process.execPath, [TOOLS, 'lint', '--project', root], { encoding: 'utf8', env: { ...process.env, ALFRED_CODE_DATA_PATH: '', ALFRED_CODE_DOCS_PATH: '' } });
        let r = run();
        assert.strictEqual(r.status, 0);
        assert.match(r.stdout, /tools: no TOOLS-PREFERENCES\.md - the stack's defaults apply/);
        const doc = path.join(root, '.alfred', 'docs', 'preferences', 'TOOLS-PREFERENCES.md');
        fs.mkdirSync(path.dirname(doc), { recursive: true });
        fs.writeFileSync(doc, EXAMPLE);
        r = run();
        assert.strictEqual(r.status, 0, r.stdout + r.stderr);
        assert.match(r.stdout, /note: T1: own:jetbrains has no inventory entry here/);
        assert.match(r.stdout, /^tools: ok/m);
        fs.writeFileSync(doc, swap('serena find_symbol,', 'serena find_symbol_v9,'));
        r = run();
        assert.strictEqual(r.status, 1);
        assert.match(r.stdout, /T1: serena find_symbol_v9 is not a tool of serena at 2\.1\.0/);
        r = spawnSync(process.execPath, [TOOLS, 'next', '--project', root], { encoding: 'utf8' });
        assert.strictEqual(r.stdout.trim(), 'Next: T5');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The skill's tools area runs these commands by name; a renamed one would leave the flow calling a command that is gone.
test('tools-area.md names every tools.js command it runs, and the CLI accepts each', () =>
{
    const text = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'tools-area.md'), 'utf8');
    for (const cmd of ['inventory', 'lint', 'order', 'next']) assert.ok(text.includes(`tools.js ${cmd}`), cmd);
    assert.strictEqual(spawnSync(process.execPath, [TOOLS, 'nope']).status, 2);
});

test('an empty or entry-less doc fails lint', () =>
{
    const want = 'TOOLS-PREFERENCES.md holds no `## T<n>` entry - rank a job through /capture-preferences tools, or remove the file for the stack\'s defaults';
    for (const body of ['', '\n\n', '# Tools preferences\n\nUpdated: 2026-10-24\n', 'garbage{{ not a doc\n'])
        assert.deepStrictEqual(lintToolsDoc(body).problems, [want], JSON.stringify(body));
});

// The flow writes the ranks tools-area.md shows: every one it spells, a known type's among them, lints clean - a rank the
// lint refuses sends the capture into a fix loop (the final review, Minor 6, re-graded).
test('every rank tools-area.md spells lints, and it shows a known type\'s', () =>
{
    const text = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'capture-preferences', 'references', 'tools-area.md'), 'utf8');
    const known = Object.keys(readAdapters().types);
    const ranks = [...text.matchAll(/`((?:own:[a-z][\w-]*|[a-z][\w-]*) [A-Za-z_][\w-]*(?:, [A-Za-z_][\w-]*)*)`/g)].map((m) => m[1])
        .filter((r) => r.startsWith('own:') || known.includes(r.split(' ')[0]));
    assert.ok(ranks.some((r) => known.includes(r.split(' ')[0])), `a known type's rank: ${ranks.join(' | ')}`);
    for (const rank of ranks)
    {
        const doc = `# Tools preferences\n\nUpdated: 2026-10-24\n\n## T1 - Job\n<!-- id: t1 -->\n- Job: navigation\n- Order: ${rank} > LSP\n`;
        assert.deepStrictEqual(lintToolsDoc(doc).problems, [], rank);
    }
    assert.ok(!/ranked whole is its type alone/.test(text), 'no bare known type');
});
