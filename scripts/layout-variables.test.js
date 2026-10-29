'use strict';
// layout.js's loader for the stack's variables (workspace roles and variables, D3 / D4): `<data root>/.variables` read
// in one nearest-wins order - settings.local.json, the project's own file, the process env, then each linked member's
// file while the switch is on - and applied once per process, so every envOf copy reads the winner unchanged.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const layout = require('../stack/hooks/layout.js');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'stack', 'hooks');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'layout-vars-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ACCT = path.join(TMP, 'acct');
fs.mkdirSync(ACCT, { recursive: true });
const ON = { CLAUDE_CONFIG_DIR: ACCT, ALFRED_CODE_WORKSPACE: '1' };
const UNSET = { CLAUDE_CONFIG_DIR: ACCT };

// `spec` maps a folder to { stamp, git, ws, data, settings, local, vars } - `ws` its workspace file's text and `vars`
// its .variables text (a string, or a Buffer for an encoding case), both under `data` (default .alfred); `settings` /
// `local` are objects written as .claude/settings.json / settings.local.json (a string is written as it stands).
function tree(spec, base = TMP)
{
    const top = fs.mkdtempSync(path.join(base, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        const claude = path.join(dir, '.claude');
        const json = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
        if (o.stamp) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'sha: x\n'); }
        if (o.settings !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.json'), json(o.settings)); }
        if (o.local !== undefined) { fs.mkdirSync(claude, { recursive: true }); fs.writeFileSync(path.join(claude, 'settings.local.json'), json(o.local)); }
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        if (o.ws !== undefined || o.vars !== undefined) fs.mkdirSync(data, { recursive: true });
        if (o.ws !== undefined) fs.writeFileSync(path.join(data, 'workspace'), o.ws);
        if (o.vars !== undefined) fs.writeFileSync(path.join(data, '.variables'), o.vars);
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
}
// The usual three: ws holds api, api holds tool. `extra` adds to each folder's spec.
const three = (extra = {}) => tree({
    'ws': { stamp: true, ws: 'child api\n', ...(extra.ws || {}) },
    'ws/api': { stamp: true, ws: 'parent ..\nchild tool\n', ...(extra.api || {}) },
    'ws/api/tool': { stamp: true, ws: 'parent ..\n', ...(extra.tool || {}) },
});
const varsOf = (root, env = ON) => layout.variablesOf(root, { env: { ...env } });
const K = (s) => `ALFRED_CODE_${s}`;
const setVars = (root, text) => fs.writeFileSync(path.join(root, '.alfred', '.variables'), text);

test('VARIABLE_KEYS equals the catalog minus DATA_PATH and HOOKS_OFF', () =>
{
    const catalog = require('../meta/environment.json').env.map((r) => r.key).filter((k) => k !== K('DATA_PATH') && k !== K('HOOKS_OFF'));
    assert.deepStrictEqual([...layout.VARIABLE_KEYS].sort(), catalog.sort());
});

test('the order: step 2 over 3 over 4 over 5', () =>
{
    const at = three({ ws: { vars: `${K('SCORER_LEVEL')}=64\n` }, api: { vars: `${K('SCORER_LEVEL')}=62\n`, local: { env: { [K('SCORER_LEVEL')]: '61' } } } });
    const api = at('ws/api');
    const env = { ...ON, [K('SCORER_LEVEL')]: '63' };
    const read = () => { const v = varsOf(api, env); return [v.values[K('SCORER_LEVEL')], v.from[K('SCORER_LEVEL')]]; };
    assert.deepStrictEqual(read(), ['61', 'settings.local.json']);
    fs.rmSync(path.join(api, '.claude', 'settings.local.json'));
    assert.deepStrictEqual(read(), ['62', 'own']);
    setVars(api, '# none\n');
    assert.deepStrictEqual(read(), ['63', 'env']);
    delete env[K('SCORER_LEVEL')];
    assert.deepStrictEqual(read(), ['64', '..']);
    assert.ok(varsOf(api, env).notes.every((n) => !n.includes('SCORER_LEVEL')), 'no note for a plain catalog key');
});

test('a launch 0 freezes: one member read is none', () =>
{
    const at = three({ ws: { vars: `${K('SCORER')}=1\n${K('MEMORY')}=custom\n` } });
    const frozen = varsOf(at('ws/api'), { ...UNSET, [K('WORKSPACE')]: '0' });
    assert.deepStrictEqual(frozen.values, { [K('WORKSPACE')]: '0' });
    assert.strictEqual(varsOf(at('ws/api'), UNSET).values[K('SCORER')], '1', 'unset is on since 3.0.0 (D9)');
    assert.strictEqual(varsOf(at('ws/api'), ON).values[K('SCORER')], '1');
});

test('ignore env K in ws/api stops K from ws for ws/api and ws/api/tool', () =>
{
    const at = three({
        ws: { vars: `${K('SCORER_LEVEL')}=70\n${K('MEMORY')}=custom\n` },
        api: { ws: `parent ..\nchild tool\nignore env ${K('SCORER_LEVEL')}\n` },
    });
    for (const [rel, up] of [['ws/api', '..'], ['ws/api/tool', '../..']])
    {
        const v = varsOf(at(rel));
        assert.strictEqual(v.values[K('SCORER_LEVEL')], undefined, rel);
        assert.deepStrictEqual([v.values[K('MEMORY')], v.from[K('MEMORY')]], ['custom', up], rel);
    }
    assert.strictEqual(varsOf(at('ws')).values[K('SCORER_LEVEL')], '70', 'the root reads its own file');
});

test('DOCS_VERSIONING and WORKSPACE never come from a member', () =>
{
    const at = three({ ws: { vars: `${K('DOCS_VERSIONING')}=local\n${K('WORKSPACE')}=0\n${K('HISTORY')}=7\n` } });
    const v = varsOf(at('ws/api'));
    assert.strictEqual(v.values[K('DOCS_VERSIONING')], undefined);
    assert.deepStrictEqual([v.values[K('WORKSPACE')], v.from[K('WORKSPACE')]], ['1', 'env']);
    assert.strictEqual(v.values[K('HISTORY')], '7', 'the chain was read');
});

test('HOOKS_OFF merges the root\'s guard-ungated-commit:push with the child\'s docs-session, and leaves under ignore env ALFRED_CODE_HOOKS_OFF', () =>
{
    const at = three({
        ws: { settings: { env: { [K('HOOKS_OFF')]: 'guard-ungated-commit:push,guard-answer' } } },
        api: { settings: { env: { [K('HOOKS_OFF')]: 'docs-session' } } },
    });
    const parts = (rel, env = ON) => layout.hooksOffOf(at(rel), { env: { ...env } }).split(',').filter(Boolean).sort();
    assert.deepStrictEqual(parts('ws/api'), ['docs-session', 'guard-ungated-commit:push'], 'a root\'s whole-hook HOOKS_OFF entry does not reach ws/api');
    assert.deepStrictEqual(parts('ws/api/tool'), ['guard-ungated-commit:push'], 'the grandchild takes the root\'s part entry');
    assert.deepStrictEqual(parts('ws/api', { ...UNSET, [K('WORKSPACE')]: '0' }), ['docs-session'], 'the switch off reads the project alone');
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', 'workspace'), `parent ..\nchild tool\nignore env ${K('HOOKS_OFF')}\n`);
    assert.deepStrictEqual(parts('ws/api'), ['docs-session']);
    assert.deepStrictEqual(parts('ws/api/tool'), [], 'a nearer ignore stops the root for the grandchild too');
    fs.writeFileSync(path.join(at('ws/api'), '.claude', 'settings.local.json'), JSON.stringify({ env: { [K('HOOKS_OFF')]: 'forge-session' } }));
    assert.deepStrictEqual(parts('ws/api'), ['forge-session'], 'settings.local.json over settings.json, R99');
});

test('a .variables HOOKS_OFF or DATA_PATH line is not read and is named in notes', () =>
{
    const at = three({ api: { vars: `${K('HOOKS_OFF')}=guard-catastrophic-rm\n${K('DATA_PATH')}=elsewhere\n${K('SCORER')}=1\n` } });
    const v = varsOf(at('ws/api'));
    assert.strictEqual(v.values[K('HOOKS_OFF')], undefined);
    assert.strictEqual(v.values[K('DATA_PATH')], undefined);
    assert.strictEqual(v.values[K('SCORER')], '1');
    assert.ok(v.notes.includes(`!! variables: ${K('HOOKS_OFF')} in .variables is not read - it lives in .claude/settings.json`), v.notes.join('\n'));
    assert.ok(v.notes.includes(`!! variables: ${K('DATA_PATH')} in .variables is not read - only the stack's variables are; a guard switch stays in .claude/settings.json`), v.notes.join('\n'));
    assert.strictEqual(layout.hooksOffOf(at('ws/api'), { env: { ...ON } }), '', 'the file\'s HOOKS_OFF line switches nothing off');
});

test('AC11: no file and a 0-byte file read the process env', () =>
{
    const at = tree({ 'p': { stamp: true } });
    const env = { ...UNSET, [K('HISTORY')]: '4' };
    assert.deepStrictEqual([varsOf(at('p'), env).values[K('HISTORY')], varsOf(at('p'), env).from[K('HISTORY')]], ['4', 'env']);
    fs.mkdirSync(path.join(at('p'), '.alfred'));
    setVars(at('p'), '');
    assert.deepStrictEqual(varsOf(at('p'), env).values, { [K('HISTORY')]: '4' });
    assert.deepStrictEqual(varsOf(at('p'), env).notes, []);
});

test('AC11: a garbage line is kept out and named', () =>
{
    const at = tree({ 'p': { stamp: true, vars: `${K('HISTORY')}=5\nthis is not a pair\n${K('SCORER')}=1\n` } });
    const v = varsOf(at('p'), UNSET);
    assert.deepStrictEqual(v.values, { [K('HISTORY')]: '5', [K('SCORER')]: '1' });
    assert.deepStrictEqual(v.notes, ['!! variables: .variables line 2 is not a KEY=value line - not read']);
    assert.deepStrictEqual(layout.readDotenv(path.join(at('p'), '.alfred', '.variables')).bad, [2]);
});

test('AC11: UTF-16 and BOM files read', () =>
{
    const text = `${K('HISTORY')}=6\r\n${K('MEMORY')}=custom\r\n`;
    for (const vars of [Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), Buffer.from(text, 'utf16le'), `\uFEFF${text}`])
    {
        const at = tree({ 'p': { stamp: true, vars } });
        assert.deepStrictEqual(varsOf(at('p'), UNSET).values, { [K('HISTORY')]: '6', [K('MEMORY')]: 'custom' });
    }
});

test('AC11: a folder named .variables is no file', () =>
{
    const at = tree({ 'p': { stamp: true } });
    fs.mkdirSync(path.join(at('p'), '.alfred', '.variables'), { recursive: true });
    assert.strictEqual(layout.readDotenv(path.join(at('p'), '.alfred', '.variables')), null);
    assert.deepStrictEqual(varsOf(at('p'), { ...UNSET, [K('SCORER')]: '1' }).values, { [K('SCORER')]: '1' });
});

test('applyVariables: a launch HOOKS_OFF with no project settings stands; an account entry stands beside a member\'s part entry', () =>
{
    const lone = tree({ 'p': { stamp: true } });
    const env = { ...UNSET, [K('HOOKS_OFF')]: 'guard-answer' };
    layout.applyVariables(lone('p'), env);
    assert.strictEqual(env[K('HOOKS_OFF')], 'guard-answer');
    const at = three({ ws: { settings: { env: { [K('HOOKS_OFF')]: 'docs-session:block' } } } });
    const account = { ...ON, [K('HOOKS_OFF')]: 'forge-session' };
    assert.deepStrictEqual(layout.applyVariables(at('ws/api'), account), [K('HOOKS_OFF')]);
    assert.strictEqual(account[K('HOOKS_OFF')], 'forge-session,docs-session:block');
});

test('applyVariables sets each winner once per env object, and a second call returns []', () =>
{
    const at = three({ ws: { vars: `${K('SCORER_LEVEL')}=90\n` }, api: { vars: `${K('HISTORY')}=9\n` } });
    const env = { ...ON, [K('HISTORY')]: '1' };
    assert.deepStrictEqual(layout.applyVariables(at('ws/api'), env).sort(), [K('HISTORY'), K('SCORER_LEVEL')]);
    assert.deepStrictEqual([env[K('HISTORY')], env[K('SCORER_LEVEL')]], ['9', '90'], 'the own file wins over the process env');
    setVars(at('ws/api'), `${K('HISTORY')}=2\n`);
    assert.deepStrictEqual(layout.applyVariables(at('ws/api'), env), []);
    assert.strictEqual(env[K('HISTORY')], '9');
});

test('AC11: an unparseable settings.local.json skips step 2', () =>
{
    const at = tree({ 'p': { stamp: true, local: '{ not json', vars: `${K('HISTORY')}=8\n` } });
    assert.deepStrictEqual([varsOf(at('p'), UNSET).values[K('HISTORY')], varsOf(at('p'), UNSET).from[K('HISTORY')]], ['8', 'own']);
});

test('out of a session, step 4 reads what a session lays over its launch env: the project\'s settings.json, then the account\'s', () =>
{
    const acct = path.join(TMP, 'acct-step4');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'settings.json'), JSON.stringify({ env: { [K('HISTORY')]: '2', [K('MEMORY')]: 'custom' } }));
    const at = tree({ 'p': { stamp: true, settings: { env: { [K('HISTORY')]: '3' } } } });
    const v = varsOf(at('p'), { CLAUDE_CONFIG_DIR: acct, [K('HISTORY')]: '1', [K('MEMORY')]: 'default' });
    assert.deepStrictEqual([v.values[K('HISTORY')], v.from[K('HISTORY')], v.values[K('MEMORY')]], ['3', 'env', 'custom']);
});

test('AC13: the prelude loaded in ws/api/tool reads the root\'s SCORER_LEVEL=90', () =>
{
    const at = three({ ws: { vars: `${K('SCORER_LEVEL')}=90\n` } });
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(HOOKS, 'hook-prelude.js'))}); process.stdout.write(String(process.env.${K('SCORER_LEVEL')}))`],
        { encoding: 'utf8', env: { ...process.env, ...ON, CLAUDE_PROJECT_DIR: at('ws/api/tool') } });
    assert.strictEqual(r.stdout, '90', r.stderr);
});

test('Review Focus 1: a hook started in src/ reads the project\'s file', () =>
{
    const at = tree({ 'p': { stamp: true, git: true, vars: `${K('HISTORY')}=7\n` }, 'p/src': {} });
    const env = { ...process.env, ...UNSET };
    delete env.CLAUDE_PROJECT_DIR;
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(HOOKS, 'hook-prelude.js'))}); process.stdout.write(String(process.env.${K('HISTORY')}))`],
        { encoding: 'utf8', cwd: at('p/src'), env });
    assert.strictEqual(r.stdout, '7', r.stderr);
});

test('AC20: chain depth 7, 8 and 9 - the ninth member is not read', () =>
{
    const spec = {};
    let rel = 'd0';
    const rels = [rel];
    for (let i = 1; i <= 9; i++) { rel = `${rel}/d${i}`; rels.push(rel); }
    rels.forEach((r, i) => { spec[r] = { stamp: true, ws: `${i ? 'parent ..\n' : ''}${i < 9 ? `child d${i + 1}\n` : ''}` }; });
    const at = tree(spec);
    const bottom = at(rels[9]);
    const at8 = (depth) => at(rels[9 - depth]);
    for (const [depth, read] of [[7, true], [8, true], [9, false]])
    {
        for (const r of rels) fs.rmSync(path.join(at(r), '.alfred', '.variables'), { force: true });
        setVars(at8(depth), `${K('HISTORY')}=${depth}\n`);
        assert.strictEqual(varsOf(bottom).values[K('HISTORY')], read ? String(depth) : undefined, `depth ${depth}`);
    }
});

test('AC20: values of 0, 1 and 2 characters; a bare ALFRED_CODE_ key is ignored', () =>
{
    const at = tree({ 'p': { stamp: true, vars: `${K('HISTORY')}=\n${K('MEMORY')}=c\n${K('FORGE_WATCH')}=on\nALFRED_CODE_=x\n` } });
    const v = varsOf(at('p'), { ...UNSET, [K('HISTORY')]: '4' });
    assert.deepStrictEqual([v.values[K('HISTORY')], v.from[K('HISTORY')]], ['4', 'env'], 'an empty value is unset, as envOf reads it');
    assert.strictEqual(v.values[K('MEMORY')], 'c');
    assert.strictEqual(v.values[K('FORGE_WATCH')], 'on');
    assert.ok(!Object.hasOwn(v.values, 'ALFRED_CODE_'));
    assert.deepStrictEqual(v.notes, []);
});

test('Review Focus 2: a moved data root', () =>
{
    const at = tree({ 'p': { stamp: true, data: 'tools/data', settings: { env: { [K('DATA_PATH')]: 'tools/data' } }, vars: `${K('HISTORY')}=5\n` } });
    fs.mkdirSync(path.join(at('p'), '.alfred'), { recursive: true });
    setVars(at('p'), `${K('HISTORY')}=9\n`);
    assert.strictEqual(varsOf(at('p'), UNSET).values[K('HISTORY')], '5');
});

test('Review Focus 5: a CRLF file and a project path with a space', () =>
{
    const spaced = fs.mkdtempSync(path.join(TMP, 'with space-'));
    const at = tree({ 'p q': { stamp: true, vars: `${K('HISTORY')}=6\r\n${K('SCORER')}="1"\r\n` } }, spaced);
    assert.deepStrictEqual(varsOf(at('p q'), UNSET).values, { [K('HISTORY')]: '6', [K('SCORER')]: '1' });
});

// ---- Review Focus 6: a guard switch in a .variables file is never read ----------------------------------------------
const GUARD_LINES = (sibling) => `${K('CONFIG_PROTECT')}=0\n${K('PUSH_GATE')}=0\n${K('ALLOW_WRITE_OUTSIDE')}=${sibling}\n`;
const hook = (file, payload, root, env = {}) => spawnSync(process.execPath, [path.join(HOOKS, file)],
    { input: JSON.stringify(payload), encoding: 'utf8', cwd: root, env: { ...process.env, ...ON, CLAUDE_PROJECT_DIR: root, ...env } });
// A clone ahead of its upstream by one commit, so an ungated `git push` publishes something.
function aheadClone(dir)
{
    const bare = `${dir}.git`;
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['clone', '-q', bare, dir], { stdio: 'ignore' });
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
    git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\n'); git('add', '-A'); git('commit', '-qm', 'seed'); git('branch', '-M', 'main'); git('push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'seed\nnext\n'); git('commit', '-qam', 'next');
}

test('Review Focus 6: a guard switch in .variables is not read - own and a member\'s', () =>
{
    const sibling = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'sibling-')));
    for (const where of ['own', 'member'])
    {
        const at = tree({ 'ws': { stamp: true, ws: 'child api\n' } });
        const api = path.join(at('ws'), 'api');
        aheadClone(api);
        const spec = { stamp: true, ws: 'parent ..\n' };
        fs.mkdirSync(path.join(api, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(api, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(path.join(api, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(api, '.alfred', 'workspace'), spec.ws);
        fs.mkdirSync(path.join(at('ws'), '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(where === 'own' ? api : at('ws'), '.alfred', '.variables'), GUARD_LINES(sibling));
        fs.writeFileSync(path.join(api, '.eslintrc.json'), '{ "rules": {} }\n');
        const cfg = hook('guard-config-protection.js', { tool_name: 'Edit', cwd: api, tool_input: { file_path: path.join(api, '.eslintrc.json'), old_string: '{}', new_string: '{ "x": 1 }' } }, api);
        assert.strictEqual(cfg.status, 2, `${where}: the config guard still denies - ${cfg.stderr}`);
        const push = hook('guard-ungated-commit.js', { tool_name: 'Bash', cwd: api, tool_input: { command: 'git push' } }, api);
        assert.strictEqual(push.status, 2, `${where}: the push gate still denies - ${push.stderr}`);
        const cross = hook('guard-cross-project-write.js', { tool_name: 'Write', cwd: api, tool_input: { file_path: path.join(sibling, 'x.txt'), content: 'x' } }, api);
        assert.strictEqual(cross.status, 2, `${where}: the cross-project guard still denies - ${cross.stderr}`);
        const notes = varsOf(api).notes;
        const label = where === 'own' ? '.variables' : '.variables of ..';
        for (const key of ['CONFIG_PROTECT', 'PUSH_GATE', 'ALLOW_WRITE_OUTSIDE'])
            assert.ok(notes.includes(`!! variables: ${K(key)} in ${label} is not read - only the stack's variables are; a guard switch stays in .claude/settings.json`), `${where} ${key}: ${notes.join('\n')}`);
    }
});

test('Review Focus 7: the root\'s push switch-off reaches the child\'s hook', () =>
{
    const at = tree({ 'ws': { stamp: true, ws: 'child api\n', settings: { env: { [K('HOOKS_OFF')]: 'guard-ungated-commit:push' } } } });
    const api = path.join(at('ws'), 'api');
    aheadClone(api);
    fs.mkdirSync(path.join(api, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(api, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    fs.mkdirSync(path.join(api, '.alfred'), { recursive: true });
    fs.writeFileSync(path.join(api, '.alfred', 'workspace'), 'parent ..\n');
    const push = () => hook('guard-ungated-commit.js', { tool_name: 'Bash', cwd: api, tool_input: { command: 'git push' } }, api);
    assert.strictEqual(push().status, 0, 'the root\'s part entry stands the push gate down in the child');
    assert.strictEqual(hook('guard-ungated-commit.js', { tool_name: 'Bash', cwd: api, tool_input: { command: 'git push' } }, api, { ALFRED_CODE_WORKSPACE: '0' }).status, 2, 'frozen, the child stands alone');
    fs.writeFileSync(path.join(api, '.alfred', 'workspace'), `parent ..\nignore env ${K('HOOKS_OFF')}\n`);
    assert.strictEqual(push().status, 2, 'under ignore env ALFRED_CODE_HOOKS_OFF the child is gated');
});

// ---- A10: each reader's fallback is the catalog default -------------------------------------------------------------
// Every catalog row's reader, read with nothing set and with the row's default set: the two must agree. Two rows read
// their fallback from source, the reader being inline in a hook's main block.
test('A10: every catalog row\'s reader resolves its default with no file, no settings key and no launch value', () =>
{
    const prelude = require('../stack/hooks/hook-prelude.js');
    const history = require('../stack/hooks/history.js');
    const cap = require('../stack/hooks/agent-cap.js');
    const fresh = require('../stack/hooks/fresh-session.js');
    const tools = require('../stack/skills/capture-preferences/scripts/tools.js');
    const installDocs = require('./install/docs.js');
    const empty = fs.mkdtempSync(path.join(TMP, 'empty-'));
    const freshAt = (key, env) =>
    {
        const file = require.resolve('../stack/hooks/fresh-session.js');
        const saved = process.env[key];
        if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
        delete require.cache[file];
        try
        {
            const fresh = require(file);
            return { [K('CONTEXT_WINDOW_FOR_1M')]: fresh.FRESH_AT_1M, [K('CONTEXT_WINDOW_FOR_300K')]: fresh.FRESH_AT_300K, [K('CONTEXT_WINDOW_FOR_200K')]: fresh.FRESH_AT_200K,
                [K('CONTEXT_WINDOW_DEFAULT')]: fresh.DEFAULT_AT, [K('AUTO_COMPACT')]: fresh.COMPACT_INSTEAD }[key];
        }
        finally { if (saved === undefined) delete process.env[key]; else process.env[key] = saved; delete require.cache[file]; }
    };
    const source = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const readers = {
        DOCS_VERSIONING: (e) => prelude.envOf(e, 'DOCS_VERSIONING') || installDocs.docsVersioningSeed({ projectRoot: empty, docsPath: '.alfred/docs', git: { tracked: () => false, ignored: () => false } }),
        INSTRUMENT: (e) => prelude.switchOn('INSTRUMENT', e),
        CORRECTION_NUDGE: (e) => prelude.envOf(e, 'CORRECTION_NUDGE') || /envOf\(process\.env, 'CORRECTION_NUDGE'\) \|\| '([^']*)'/.exec(source('stack/hooks/guard-answer.js'))[1],
        TURN_CHECK: (e) => prelude.switchOn('TURN_CHECK', e),
        SCORER: (e) => prelude.switchOn('SCORER', e),
        SCORER_LEVEL: (e) => prelude.scorerLevel(e),
        SCORER_OUTPUTS: (e) => prelude.scorerOutputs(e),
        SCORER_ROUNDS: (e) => prelude.scorerRounds(e),
        HISTORY: (e) => history.historyCount(prelude.envOf(e, 'HISTORY')),
        CONTEXT_WINDOW_FOR_1M: (e) => freshAt(K('CONTEXT_WINDOW_FOR_1M'), e),
        CONTEXT_WINDOW_FOR_300K: (e) => freshAt(K('CONTEXT_WINDOW_FOR_300K'), e),
        CONTEXT_WINDOW_FOR_200K: (e) => freshAt(K('CONTEXT_WINDOW_FOR_200K'), e),
        CONTEXT_WINDOW_DEFAULT: (e) => freshAt(K('CONTEXT_WINDOW_DEFAULT'), e),
        AUTO_COMPACT: (e) => freshAt(K('AUTO_COMPACT'), e),
        MAXIMUM_RUN_AGENTS: (e) => cap.capOf(e),
        MEMORY: (e) => tools.memoryMode({ projectRoot: empty, env: e }),
        FRESH_SESSION_AFTER_HOURS: (e) => prelude.envOf(e, 'FRESH_SESSION_AFTER_HOURS')
            || ['stack/hooks/guard-stop-contract.js', 'stack/hooks/guard-fresh-session-start.js'].map((f) => [...source(f).matchAll(/'FRESH_SESSION_AFTER_HOURS'\)\);\s*(?:const hours = |return )Number\.isNaN\(n\) \|\| n < 0 \? (\d+) : n/g)].map((m) => m[1])).flat().join(','),
        FRESH_SESSION_PAYBACK: (e) => fresh.paybackOf(e),
        FORGE_WATCH: (e) => (/=== 'loud-only' \|\| watchSetting\(env\) === 'publish-only'\) watch = watchSetting\(env\)/.test(source('stack/hooks/forge-session.js'))
            && ['loud-only', 'publish-only'].includes(String(prelude.envOf(e, 'FORGE_WATCH') || '')) ? prelude.envOf(e, 'FORGE_WATCH') : 'all'),
        WORKSPACE: (e) => layout.workspaceOn({ env: e, projectRoot: empty }),
    };
    // The user's ruling of 2026-10-21: an unset tier takes the DEFAULT trigger, never its own seed - so two tiers read
    // 180000 with nothing set while their seeds are 400000 and 280000. D5 seeds both everywhere, so only a vanished parent
    // reaches this fallback, until the next update.
    const BY_RULING = new Set(['CONTEXT_WINDOW_FOR_1M', 'CONTEXT_WINDOW_FOR_300K']);
    const rows = require('../meta/environment.json').env.filter((r) => layout.VARIABLE_KEYS.includes(r.key));
    assert.deepStrictEqual(Object.keys(readers).sort(), rows.map((r) => r.key.slice(K('').length)).sort(), 'one reader per moved row');
    for (const row of rows)
    {
        const suffix = row.key.slice(K('').length);
        const unset = readers[suffix]({ CLAUDE_CONFIG_DIR: ACCT });
        const atDefault = readers[suffix]({ CLAUDE_CONFIG_DIR: ACCT, [row.key]: String(row.default) });
        if (suffix === 'FRESH_SESSION_AFTER_HOURS')
        {
            const each = unset.split(',');
            assert.ok(each.length >= 2 && each.every((v) => v === String(row.default)), `every inline reader falls back to the default: ${unset}`);
            continue;
        }
        if (BY_RULING.has(suffix)) { assert.notDeepStrictEqual(unset, atDefault, `${suffix}: the ruling still holds`); continue; }
        assert.deepStrictEqual(unset, atDefault, `${row.key}: nothing set reads ${JSON.stringify(unset)}, the default reads ${JSON.stringify(atDefault)}`);
    }
});

// T12c: a script that decides what the TEAM's files hold (the docs-versioning seed, the team's memory switch-off) reads
// the project's own files alone - a session's process env carries settings.local.json's values, so 'all' would let a
// personal value answer for the committed file (C7).
test('layers files reads settings.local.json, .variables and settings.json only; team skips settings.local.json too', () =>
{
    const acct = path.join(TMP, 'acct-layers');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'settings.json'), JSON.stringify({ env: { [K('TURN_CHECK')]: '1' } }));
    const at = three({
        ws: { vars: `${K('SCORER_LEVEL')}=64\n` },
        api: { vars: `${K('HISTORY')}=8\n`, settings: { env: { [K('MEMORY')]: 'custom' } }, local: { env: { [K('HISTORY')]: '5', [K('MEMORY')]: 'default' } } },
    });
    const env = { ...ON, CLAUDE_CONFIG_DIR: acct, [K('INSTRUMENT')]: '0' };
    const pick = (v) => [v.values[K('HISTORY')], v.values[K('MEMORY')], v.values[K('SCORER_LEVEL')], v.values[K('TURN_CHECK')], v.values[K('INSTRUMENT')]];
    assert.deepStrictEqual(pick(layout.variablesOf(at('ws/api'), { env: { ...env } })), ['5', 'default', '64', '1', '0'], 'all: every layer and the member');
    assert.deepStrictEqual(pick(layout.variablesOf(at('ws/api'), { env: { ...env }, layers: 'files' })), ['5', 'default', undefined, undefined, undefined], 'files: no member, account or process env');
    assert.deepStrictEqual(pick(layout.variablesOf(at('ws/api'), { env: { ...env }, layers: 'team' })), ['8', 'custom', undefined, undefined, undefined], 'team: settings.local.json skipped');
});

test('a BOM\'d settings.json and settings.local.json are read like any other', () =>
{
    const at = tree({ 'p': { stamp: true, settings: `\uFEFF${JSON.stringify({ env: { [K('TURN_CHECK')]: '1' } })}`, local: `\uFEFF${JSON.stringify({ env: { [K('HISTORY')]: '4' } })}` } });
    const v = varsOf(at('p'), UNSET);
    assert.deepStrictEqual([v.values[K('TURN_CHECK')], v.values[K('HISTORY')]], ['1', '4']);
});
