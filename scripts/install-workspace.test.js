'use strict';
// Workspace layering, release 1, the installer half (plan Task 9): a child project under a stamped root installs and
// updates against the root's set - the delta, the excludes, the env pass-down and the own-picks line - and every case
// reads the files the run left. The tree is `work/ws` (a plain folder) with `ws/api` and `ws/web` as git repos and
// `ws/api/tool` as a git repo inside `api`. A child joins through the workspace library (the CLI lands in Task 11).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');
const wsLib = require('./install/workspace.js');
const stampLib = require('./install/stamp.js');
const { seedRun, POSIX_ONLY, releaseExport, skipWithout, plantOlderRoot } = require('./seed-sandbox.js');
const layoutLib = require('../stack/hooks/layout.js');
const variablesLib = require('./install/variables.js');

const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const CLI = path.join(__dirname, 'workspace.js');

const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const X = 'sqlite';   // outside the closure of the root's always rules (markdown-docs pulls markdown-style and docs-as-code)
const OWN = 'npm';
const SC = 'ALFRED_CODE_SCORING';
// [key, the stack's old seed, the value it resets to] - the env pass's reseed list (meta/migrations.json): an update moves
// the stack's own old seeds (U16's idle wait, B1's scoring pair), and every other value an older install holds stays.
const RESEEDS = require('./install/env-migrations.js').envMigrations(require('../meta/migrations.json')).reseed;
const { putWorkspace, readWorkspaceRecord, readWorkspaceValues } = require('./workspace-fixture.js');
const reseeded = (env) => { const out = { ...env }; for (const [k, bad, to] of RESEEDS) if (out[k] === bad) out[k] = to; return out; };

const at = (work, rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
// The workspace is on by default since 3.0.0 (D9); every case here still pins it, so a launch 0 in the caller's env cannot freeze it - the kill-switch cases at 0.
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct'), ALFRED_CODE_WORKSPACE: '1' });
const readOr = (file, fallback = null) => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stampOf = (work, rel) => readOr(path.join(at(work, rel), '.claude', 'alfred-code.stamp'), '');
const lineOf = (text, key) => { const m = new RegExp(`^${key}: ?(.*)$`, 'm').exec(text); return m ? m[1] : null; };
const hasSkill = (work, rel, name) => fs.existsSync(path.join(at(work, rel), '.claude', 'skills', name, 'SKILL.md'));
const envOf = (work, rel, file = 'settings.json') => ((json(path.join(at(work, rel), '.claude', file)) || {}).env || {});
// The stack's variables (D5): a project's own `.variables`, a value set through the CLI's library, and what a project reads.
const varsOf = (work, rel) => ((layoutLib.readDotenv(path.join(at(work, rel), '.alfred', '.variables')) || {}).values || {});
const setVar = (work, rel, values) => assert.deepStrictEqual(variablesLib.set(at(work, rel), Object.entries(values).map(([k, v]) => `${k}=${v}`), { env: acct(work), log: () => {} }).refused, []);
const effectiveOf = (work, rel) => Object.fromEntries(variablesLib.show(at(work, rel), { env: acct(work) }).map((r) => [r.key, r.value]));
const excludesOf = (work, rel) => (json(path.join(at(work, rel), '.claude', 'settings.local.json')) || {}).claudeMdExcludes || [];
// Workspace stage 4c: a moved folder's library rules are sent by the loader and get no row; a generated rule in its
// .claude/rules still does, so these cases plant one and read the rows of what sits natively there.
const { GENERATED_FILES } = require('./install/selection.js');
const plantGen = (work, rel, name = 'alfred-project-awareness') =>
{
    fs.mkdirSync(path.join(at(work, rel), '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(at(work, rel), '.claude', 'rules', `${name}.md`), `# ${name}\n`);
};
const ruleGlobs = (work, rel) => (fs.existsSync(path.join(at(work, rel), '.claude', 'rules')) ? fs.readdirSync(path.join(at(work, rel), '.claude', 'rules')) : [])
    .filter((f) => GENERATED_FILES.has(f.replace(/\.md$/, ''))).map((f) => wsLib.excludeGlobs([path.join(at(work, rel), '.claude', 'rules', f)], process.platform)[0]);
const setEnv = (work, rel, file, values) =>
{
    const f = path.join(at(work, rel), '.claude', file);
    const data = json(f) || {};
    data.env = { ...(data.env || {}), ...values };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
};

function layout(work)
{
    fs.mkdirSync(at(work), { recursive: true });
    for (const rel of ['api', 'web', 'api/tool'])
    {
        fs.mkdirSync(at(work, rel), { recursive: true });
        rt.execCommand('git', ['init', '-q', at(work, rel)]);
    }
}

// What `workspace.js register` writes: the child's parent line and the root's child line.
function join(work, rel, { dataRoot, parent = '.' } = {})
{
    const depth = rel.split('/').length - (parent === '.' ? 0 : parent.split('/').length);
    const up = Array.from({ length: depth }, () => '..').join('/');
    assert.ok(wsLib.writeWorkspace(at(work, rel), (m) => wsLib.setParent(m, up), { env: acct(work), dataRoot }).ok);
    const childRel = parent === '.' ? rel : rel.slice(parent.length + 1);
    assert.ok(wsLib.writeWorkspace(at(work, parent), (m) => wsLib.addChild(m, childRel), { env: acct(work) }).ok);
}
const edit = (work, rel, mutate, dataRoot) => assert.ok(wsLib.writeWorkspace(at(work, rel), mutate, { env: acct(work), dataRoot }).ok);
// The record's own text is the subject: a key the reader does not know, added by hand to workspace.json.
const addKey = (work, rel, key, value) =>
{
    const f = path.join(at(work, rel), '.alfred', 'workspace.json');
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    data[key] = value;
    fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
};

// One sandbox, one step per entry: { at, act, sel, args: [] | (work) => [], env, before(work), after(work) }.
function scenario(steps, { plugins = PLUGINS, prepare = () => {}, account = false, failOk = false } = {})
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins, account, failOk,
        seed: steps.map((s) => s.seed || SEED),
        source: steps.map((s) => s.source || path.join(__dirname, '..')),
        cwds: steps.map((s) => path.join('ws', ...(s.at && s.at !== '.' ? s.at.split('/') : []))),
        env: steps.map((s) => ({ ALFRED_CODE_WORKSPACE: '1', ...(s.env || {}) })),
        args: steps.map((s, i) => (repo, work) =>
        {
            if (s.before) s.before(work);
            const sel = path.join(work, `sel-${i}.txt`);
            fs.writeFileSync(sel, s.sel ?? ROOT_SEL);
            return ['--selection', sel, ...(typeof s.args === 'function' ? s.args(work) : s.args || [])];
        }),
        prepare: (repo, work) => { layout(work); prepare(work); },
        each: (repo, i) => (steps[i].after ? steps[i].after(path.dirname(repo)) : null),
    });
}
const update = (rel, extra = {}) => ({ at: rel, act: 'update', ...extra, args: (work) => ['--installed-only', ...(typeof extra.args === 'function' ? extra.args(work) : extra.args || [])] });
const planStep = (file) => update('.', { args: (work) => ['--print-plan', '--plan-out', path.join(work, file)] });
// A workspace.js verb run as a step: seedRun hands it --source <this tree>, and the verb ignores --selection.
const cli = (verb, extra = {}) => ({ at: '.', seed: CLI, act: verb, ...extra, args: (work) => ['--root', '.', ...(typeof extra.args === 'function' ? extra.args(work) : extra.args || [])] });

// Every file under `dir` with its size and sha256, a stamp read without its two run times.
function treeHash(dir, skip = [])
{
    const rows = [];
    const walk = (d) =>
    {
        for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const p = path.join(d, e.name);
            if (e.name === '.git' || skip.includes(p)) continue;
            if (e.isDirectory()) { walk(p); continue; }
            // A link (a skill or agent in the store, workspace stage 3) is its target, never read as a file.
            if (e.isSymbolicLink()) { rows.push(`${path.relative(dir, p)} -> ${fs.readlinkSync(p)}`); continue; }
            let body = fs.readFileSync(p);
            if (e.name === 'alfred-code.stamp') body = Buffer.from(String(body).replace(/^installed(-ms)?: .*$/gm, ''));
            rows.push(`${path.relative(dir, p)} ${body.length} ${crypto.createHash('sha256').update(body).digest('hex')}`);
        }
    };
    walk(dir);
    return rows.join('\n');
}

test('a child install writes its excludes and keeps the root\'s set (AC1)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); plantGen(work, '.'); } },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => ({
            want: ruleGlobs(work, '.'), excludes: excludesOf(work, 'api'), own: lineOf(stampOf(work, 'api'), 'own-picks'),
            js: hasSkill(work, 'api', 'javascript'), npm: hasSkill(work, 'api', OWN),
        }) },
    ]);
    const got = r.steps[1];
    assert.ok(got.want.length > 0, 'the root holds a generated rule');
    for (const g of got.want) assert.ok(got.excludes.includes(g), `no exclude for ${g}:\n${got.excludes.join('\n')}`);
    assert.strictEqual(got.own, `skill/${OWN}`, r.outs[1]);
    assert.ok(got.js && got.npm);
});

// Mode v2 stage 2, Task 2: a settings.local.json the repository owns gets no workspace row of the stack's.
const gitIn = (work, rel, ...a) => rt.execCommand('git', ['-C', at(work, rel), ...a]);
const LOCAL = (work, rel) => path.join(at(work, rel), '.claude', 'settings.local.json');
test('a child whose settings.local.json git tracks gets no workspace row, keeps its own picks, and gets the rows once the file is untracked', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); plantGen(work, '.'); } },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`,
            before: (work) => { fs.mkdirSync(path.dirname(LOCAL(work, 'api')), { recursive: true }); fs.writeFileSync(LOCAL(work, 'api'), '{}\n'); gitIn(work, 'api', 'add', '-f', '.claude/settings.local.json'); },
            after: (work) => ({ bytes: readOr(LOCAL(work, 'api')), excludes: excludesOf(work, 'api'), rows: ledgerRowsOf(work, 'api', 'claudeMdExcludes'), own: lineOf(stampOf(work, 'api'), 'own-picks') }) },
        update('api', { before: (work) => gitIn(work, 'api', 'rm', '-q', '-f', '--cached','.claude/settings.local.json'),
            after: (work) => ({ want: ruleGlobs(work, '.'), excludes: excludesOf(work, 'api'), rows: ledgerRowsOf(work, 'api', 'claudeMdExcludes') }) }),
    ]);
    const [held, freed] = [r.steps[1], r.steps[2]];
    assert.strictEqual(held.bytes, '{}\n', r.outs[1]);
    assert.deepStrictEqual(held.excludes, []);
    assert.deepStrictEqual(held.rows, []);
    assert.strictEqual(held.own, `skill/${OWN}`);
    assert.ok(r.outs[1].includes('!! settings: .claude/settings.local.json is tracked by git - git rm --cached it'), r.outs[1]);
    assert.ok(freed.want.length > 0, 'the root holds a generated rule');
    for (const g of freed.want) assert.ok(freed.excludes.includes(g), `no exclude for ${g}\n${r.outs[2]}`);
    for (const g of freed.want) assert.ok(freed.rows.includes(require('./install/settings.js').memberRow('claudeMdExcludes', g)), `no ledger row for ${g}`);
});

test('a tracked settings.local.json keeps the workspace rows the last run recorded', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); plantGen(work, '.'); } },
        { at: 'api', after: (work) => { gitIn(work, 'api', 'add', '-f', '.claude/settings.local.json'); return { bytes: readOr(LOCAL(work, 'api')), rows: ledgerRowsOf(work, 'api', 'claudeMdExcludes'), want: ruleGlobs(work, '.') }; } },
        update('api', { before: (work) => plantGen(work, '.', 'alfred-architecture'),
            after: (work) => ({ bytes: readOr(LOCAL(work, 'api')), excludes: excludesOf(work, 'api'), rows: ledgerRowsOf(work, 'api', 'claudeMdExcludes'), want: ruleGlobs(work, '.') }) }),
    ]);
    const [first, after] = [r.steps[1], r.steps[2]];
    assert.ok(first.rows.length > 0, 'setup: the install recorded no exclude row');
    assert.strictEqual(after.bytes, first.bytes, r.outs[2]);
    assert.ok(after.want.length > first.want.length, 'setup: the root gained no second generated rule');
    assert.ok(after.want.some((g) => !after.excludes.includes(g)), 'the new rule\'s glob stays out of a tracked file');
    assert.deepStrictEqual(after.rows, first.rows);
});

test('the root adds X: an update in each child adds X, except one with ignore skill X (AC3)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); edit(work, 'web', (m) => wsLib.addIgnore(m, 'skill', X)); } },
        { at: 'api' },
        { at: 'web' },
        // The first update brings in what the root's always rules require (a fixed point), so the next delta is X alone.
        update('api'),
        update('web'),
        update('.', { args: ['--add', `skill ${X}`] }),
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
        update('web', { after: (work) => hasSkill(work, 'web', X) }),
    ]);
    assert.strictEqual(r.steps[6], true, r.outs[6]);
    assert.match(r.outs[6], /==> {3}workspace: from \.\. - 1 added, 0 dropped/);
    assert.strictEqual(r.steps[7], false, r.outs[7]);
    assert.match(r.outs[7], /==> {3}workspace: from \.\. - 0 added, 0 dropped/);
});

test('the root drops X: the child loses X unless own (AC4)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api' },
        { at: 'web', sel: `${ROOT_SEL}skill ${X}\n`, after: (work) => lineOf(stampOf(work, 'web'), 'own-picks') },
        update('.', { args: ['--add', `skill ${X}`] }),
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
        update('.', { args: ['--drop', `skill ${X}`] }),
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
        update('web', { after: (work) => [hasSkill(work, 'web', X), lineOf(stampOf(work, 'web'), 'own-picks')] }),
    ]);
    assert.strictEqual(r.steps[2], `skill/${X}`, 'X picked where the root lacks it is the child\'s own');
    assert.strictEqual(r.steps[4], true, r.outs[4]);
    assert.strictEqual(r.steps[6], false, r.outs[6]);
    assert.deepStrictEqual(r.steps[7], [true, `skill/${X}`], r.outs[7]);
});

test('a second update changes no file in any project (AC5)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n` },
        update('.'),
        update('api', { after: (work) => treeHash(at(work)) }),
        update('.'),
        update('api', { after: (work) => treeHash(at(work)) }),
    ]);
    assert.strictEqual(r.steps[5], r.steps[3], 'the second update changed a file');
});

test('the user\'s own exclude entry, settings key and .mcp.json server survive install, update and uninstall (AC11)', POSIX_ONLY, () =>
{
    const mine = (work) =>
    {
        const local = json(path.join(at(work, 'api'), '.claude', 'settings.local.json')) || {};
        return {
            own: (local.claudeMdExcludes || []).includes('/my/own/**'), key: local.myKey === 1,
            server: Boolean(((json(path.join(at(work, 'api'), '.mcp.json')) || {}).mcpServers || {}).mine),
            stack: ruleGlobs(work, '.').filter((g) => (local.claudeMdExcludes || []).includes(g)).length,
        };
    };
    const r = scenario([
        { at: '.', after: (work) =>
        {
            join(work, 'api');
            plantGen(work, '.');
            fs.mkdirSync(path.join(at(work, 'api'), '.claude'), { recursive: true });
            fs.writeFileSync(path.join(at(work, 'api'), '.claude', 'settings.local.json'), JSON.stringify({ claudeMdExcludes: ['/my/own/**'], myKey: 1 }));
            fs.writeFileSync(path.join(at(work, 'api'), '.mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'mine' } } }));
        } },
        { at: 'api', after: mine },
        update('api', { after: mine }),
        { at: 'api', act: 'uninstall', after: mine },
    ]);
    for (const i of [1, 2, 3]) assert.ok(r.steps[i].own && r.steps[i].key && r.steps[i].server, `run ${i}: ${JSON.stringify(r.steps[i])}\n${r.outs[i]}`);
    assert.ok(r.steps[1].stack > 0 && r.steps[2].stack > 0);
    assert.strictEqual(r.steps[3].stack, 0, `uninstall left the stack's excludes:\n${r.outs[3]}`);
});

test('env: the root\'s ALFRED_CODE_SCORING=1 reaches a local-scope child through the chain; configure\'s value stays; ignore env seeds the default (D5)', POSIX_ONLY, () =>
{
    const local = ['--scope', 'local'];
    const read = (rel) => (work) => [effectiveOf(work, rel)[SC], varsOf(work, rel)[SC]];
    const r = scenario([
        { at: '.', after: (work) => { setVar(work, '.', { [SC]: '1' }); join(work, 'api'); join(work, 'web'); } },
        { at: 'api', args: local, after: read('api') },
        { at: 'web', args: local, after: (work) => { setVar(work, 'web', { [SC]: '0' }); edit(work, 'api', (m) => wsLib.addIgnore(m, 'env', SC)); } },
        update('web', { args: local, after: read('web') }),
        update('api', { args: local, after: read('api') }),
    ]);
    assert.deepStrictEqual(r.steps[1], ['1', undefined], `read through the chain, never copied: ${r.outs[1]}`);
    assert.deepStrictEqual(r.steps[3], ['0', '0'], r.outs[3]);
    // the ignore env key takes the catalog default (seeded on since B1 of the 2026-11-03 usage audit), not the chain's 1
    const seed = require('../meta/environment.json').env.find((row) => row.key === SC).default;
    assert.deepStrictEqual(r.steps[4], [seed, seed], r.outs[4]);
});

// AC14's env half, Review Focus 7: a 2.12.0 tree with the switch at 1 - the root and a local-scope child installed by that
// release, the child holding the root's values as copies and one key of its own - updated by this tree, root first.
test('a 2.12.0 tree with the switch at 1: own-env keys land in the child\'s file, copies leave its settings, the own-env line goes, HOOKS_OFF keeps only the child\'s entries, every effective value unchanged but the release\'s reseeds, and the parent\'s guard-ungated-commit:push still stands down there (AC14)', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const oldWs = old && require(path.join(old, 'scripts', 'install', 'workspace.js'));
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    // v2.12.0 writes and records the names 3.11.0 renamed: its side of the scenario spells them
    const [OLD_SC, OLD_LEVEL] = ['ALFRED_CODE_SCORER', 'ALFRED_CODE_SCORER_LEVEL'];
    const OFF = 'ALFRED_CODE_HOOKS_OFF';
    const on = (work) => ({ ...acct(work) });
    const api = (work) => ({
        effective: Object.fromEntries(variablesLib.show(at(work, 'api'), { env: on(work) }).map((r) => [r.key, r.value])),
        local: envOf(work, 'api', 'settings.local.json'),
        vars: (layoutLib.readDotenv(path.join(at(work, 'api'), '.alfred', '.variables')) || {}).values || {},
        ownEnv: lineOf(stampOf(work, 'api'), 'own-env'),
        off: layoutLib.hooksOffOf(at(work, 'api'), { env: on(work) }).split(',').filter(Boolean).sort(),
    });
    const local = ['--scope', 'local'];
    const r = scenario([
        { at: '.', ...OLD, after: (work) =>
        {
            setEnv(work, '.', 'settings.json', { [OLD_SC]: '1', [OFF]: 'guard-ungated-commit:push' });
            assert.ok(oldWs.writeWorkspace(at(work, 'api'), (m) => oldWs.setParent(m, '..'), { env: acct(work) }).ok);
            assert.ok(oldWs.writeWorkspace(at(work), (m) => oldWs.addChild(m, 'api'), { env: acct(work) }).ok);
        } },
        { at: 'api', ...OLD, args: local, after: (work) => setEnv(work, 'api', 'settings.local.json', { [OLD_LEVEL]: '95', [OFF]: 'guard-ungated-commit:push,docs-session:gate' }) },
        { at: 'api', ...OLD, act: 'update', args: [...local, '--installed-only'], after: api },
        update('.'),
        update('api', { args: local, after: api }),
    ]);
    const [before, after] = [r.steps[2], r.steps[4]];
    assert.strictEqual(before.local[OLD_SC], '1', `v2.12.0 copied the root's value: ${r.outs[1]}`);
    assert.strictEqual(before.local[OFF], 'guard-ungated-commit:push,docs-session:gate', r.outs[2]);
    assert.ok(before.ownEnv.split(',').includes(OLD_LEVEL), `v2.12.0 recorded the child's own value: ${before.ownEnv}`);
    assert.deepStrictEqual(after.effective, reseeded(before.effective), r.outs[4]);
    // mode commands v2 stage 3: the scoring keys are modes - each stays in the child's own settings.local.json under its new
    // name (the mode file's block), never moved into .variables
    assert.deepStrictEqual([after.local[LEVEL], after.local[SC]], ['95', '1'], `the modes stay in the mode file: ${JSON.stringify(after.local)}\n${r.outs[4]}`);
    assert.ok(!Object.hasOwn(after.vars, LEVEL) && !Object.hasOwn(after.vars, SC), `no mode in .variables: ${JSON.stringify(after.vars)}`);
    // a mode the child's own settings.local.json holds stays there as v2.12.0 left it (mode commands v2: the mode file's block)
    assert.deepStrictEqual(Object.keys(after.local).filter((k) => k.startsWith('ALFRED_CODE_') && k !== OFF && !layoutLib.MODE_KEYS.includes(k)), [], JSON.stringify(after.local));
    assert.strictEqual(after.ownEnv, null, 'the own-env line went');
    assert.strictEqual(after.local[OFF], 'docs-session:gate', 'HOOKS_OFF keeps only the child\'s own entries');
    assert.deepStrictEqual(after.off, ['docs-session:gate', 'guard-ungated-commit:push'], 'the root\'s part entry still reaches the child');
});

// D5's leave (AC15): every value the child read through the chain is written into its own file first, so nothing
// changes; with the parent's stamp gone there is no chain to read, the keys that go to the defaults are named, and the
// next update seeds them as a standalone's.
test('AC15: leaving keeps every effective value; with ws deleted the child is seeded as standalone and names the keys that went to defaults', POSIX_ONLY, () =>
{
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from, ws: readWorkspaceValues(at(work, 'api')) });
    const r = scenario([
        { at: '.', after: (work) => { setVar(work, '.', { [LEVEL]: '90' }); join(work, 'api'); } },
        { at: 'api', after: read },
        cli('role', { at: 'api', args: ['--answer', 'leave:standalone'], after: read }),
    ]);
    const [before, after] = [r.steps[1], r.steps[2]];
    assert.strictEqual(before.effective[LEVEL], '90', r.outs[1]);
    assert.strictEqual(before.from[LEVEL], '..', 'read through the chain before the leave');
    assert.deepStrictEqual(after.effective, before.effective, r.outs[2]);
    assert.strictEqual(after.vars[LEVEL], '90', 'the root\'s value now sits in the child\'s own file');
    assert.ok(!Object.values(after.from).includes('..'), JSON.stringify(after.from));
    assert.deepStrictEqual(after.ws, { role: 'standalone', above: '..' });

    const gone = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => { fs.rmSync(path.join(at(work), '.claude', 'alfred-code.stamp')); return varsOf(work, 'api'); } },
        cli('role', { at: 'api', args: ['--when', 'update'] }),
        cli('role', { at: 'api', args: ['--answer', 'leave:standalone'], after: read }),
        update('api', { after: read }),
    ]);
    const held = Object.keys(gone.steps[1]);
    assert.match(gone.outs[2], /^ask: Become standalone \(Recommended\)\tleave:standalone$/m, gone.outs[2]);
    const named = /^workspace: \.\. is gone - (\d+) values read the stack's defaults here now \(([A-Z0-9_, ]+)\); the next update seeds them$/m.exec(gone.outs[3]);
    assert.ok(named, gone.outs[3]);
    const defaults = named[2].split(', ');
    assert.strictEqual(Number(named[1]), defaults.length);
    assert.ok(defaults.length > 0 && defaults.every((k) => !held.includes(k)), `${held} / ${defaults}`);
    assert.ok(!defaults.includes('ALFRED_CODE_DOCS_VERSIONING') && !defaults.includes('ALFRED_CODE_WORKSPACE'));
    assert.deepStrictEqual(gone.steps[3].ws, { role: 'standalone', above: 'none' });
    const seeded = gone.steps[4].vars;
    const fresh = Object.keys(seeded).filter((k) => !held.includes(k));
    assert.ok(fresh.length > 0 && fresh.every((k) => defaults.includes(k)), `the update seeded the named keys: ${fresh}`);
    assert.ok(!Object.values(gone.steps[4].from).includes('..'));
});

// AC24: a 2.12.0 standalone below a 3.0.0 root joins - at update by the Recommended answer, and through configure - and
// D5's prune leaves it its typed value and DOCS_VERSIONING only; leaving writes the root's value back into its file.
test('AC24: a 2.12.0 standalone joined at update and through configure reads SCORING_LEVEL=90 from ws, keeps its typed CORRECTION_NUDGE=inject, holds no other seeded key, keeps DOCS_VERSIONING; leaving writes SCORING_LEVEL=90 back', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    const NUDGE = 'ALFRED_CODE_CORRECTION_NUDGE';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from, settings: envOf(work, 'api') });
    for (const when of ['update', 'configure'])
    {
        const pick = (work) =>
        {
            const ask = wsLib.roleAsk(at(work, 'api'), { env: acct(work), when });
            const i = when === 'update' ? 0 : ask.options.indexOf('Join ..');
            assert.ok(i >= 0, JSON.stringify(ask));
            if (when === 'update') assert.deepStrictEqual([ask.case, ask.options[0]], ['never', 'Join .. (Recommended)']);
            return ['--answer', ask.answers[i]];
        };
        const r = scenario([
            { at: '.', ...OLD },
            { at: 'api', ...OLD, after: (work) => setEnv(work, 'api', 'settings.json', { [NUDGE]: 'inject' }) },
            update('.', { after: (work) => setVar(work, '.', { [LEVEL]: '90' }) }),
            update('api', { after: read }),
            cli('role', { at: 'api', args: pick, after: read }),
            cli('role', { at: 'api', args: ['--answer', 'leave:standalone'], after: read }),
        ]);
        const [joined, left] = [r.steps[4], r.steps[5]];
        assert.ok(r.steps[3].vars.ALFRED_CODE_DOCS_VERSIONING !== undefined, `${when}: the 2.12.0 seeds moved into the file: ${r.outs[3]}`);
        assert.strictEqual(joined.effective[LEVEL], '90', `${when}: ${r.outs[4]}`);
        assert.strictEqual(joined.from[LEVEL], '..', when);
        // Mode v2 stage 2: a row changed since the stack wrote it stays in settings.json (the move to settings.local.json
        // takes only rows at their ledger hash), so the typed value is kept there, and still read over the chain.
        assert.deepStrictEqual(Object.keys(joined.vars).sort(), ['ALFRED_CODE_DOCS_VERSIONING'], `${when}: ${JSON.stringify(joined.vars)}`);
        assert.strictEqual(joined.settings[NUDGE], 'inject', `${when}: the typed value stays in settings.json`);
        assert.strictEqual(joined.effective[NUDGE], 'inject', `${when}: the typed value is still the one read`);
        // the join's prune reads .variables alone, so the typed value settings.json keeps is not counted there
        assert.match(r.outs[4], /^workspace: \d+ stack seeds and values equal to the workspace's removed from \.alfred\/\.variables \(.*\) - 1 kept as this project's own \(ALFRED_CODE_DOCS_VERSIONING\)$/m, r.outs[4]);
        assert.strictEqual(left.vars[LEVEL], '90', `${when}: leaving wrote the root's value back: ${r.outs[5]}`);
        assert.deepStrictEqual(left.effective, joined.effective, when);
    }
});

// AC24 in the update walk's own order: the role answer runs BEFORE the installer call, so the 2.12.0 seeds are still in
// settings.json when the project joins - the move must drop them as the join's prune would, never carry them in as its own.
test('AC24: answered before the update moves its values, a 2.12.0 standalone still holds only its typed key and DOCS_VERSIONING', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    const NUDGE = 'ALFRED_CODE_CORRECTION_NUDGE';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from, settings: readOr(path.join(at(work, 'api'), '.claude', 'settings.json')), local: envOf(work, 'api', 'settings.local.json'), stamp: stampOf(work, 'api') });
    const r = scenario([
        { at: '.', ...OLD },
        { at: 'api', ...OLD, after: (work) => setEnv(work, 'api', 'settings.json', { [NUDGE]: 'inject' }) },
        update('.', { after: (work) => setVar(work, '.', { [LEVEL]: '90' }) }),
        cli('role', { at: 'api', args: ['--answer', 'join:..'] }),
        update('api', { after: read }),
        update('api', { after: read }),
    ]);
    const [joined, again] = [r.steps[4], r.steps[5]];
    assert.strictEqual(joined.effective[LEVEL], '90', r.outs[4]);
    assert.strictEqual(joined.from[LEVEL], '..');
    // Mode v2 stage 2: the 2.12 seeds at their ledger hash move to settings.local.json, where the prune drops them; the typed
    // value is a row changed since the stack wrote it, so it stays in settings.json and is still the one read.
    assert.deepStrictEqual(Object.keys(joined.vars).sort(), ['ALFRED_CODE_DOCS_VERSIONING'], `${JSON.stringify(joined.vars)}\n${r.outs[4]}`);
    assert.strictEqual(joined.effective[NUDGE], 'inject');
    const left = Object.keys(JSON.parse(joined.settings).env || {}).filter((k) => layoutLib.VARIABLE_KEYS.includes(k));
    assert.deepStrictEqual(left, [NUDGE], 'no stack value left in settings.json, only the typed one');
    assert.deepStrictEqual(Object.keys(joined.local).filter((k) => layoutLib.VARIABLE_KEYS.includes(k)), [], 'no stack value in settings.local.json');
    // the file held the 2.12 name: the prune drops it as written, before the rename pass   // legacy
    assert.match(r.outs[4], /settings\.local\.json env: ALFRED_CODE_SCORER_LEVEL removed - a stack seed, so the workspace's value reaches this project/);   // legacy
    assert.deepStrictEqual(again.vars, joined.vars, `a second update changes nothing: ${r.outs[5]}`);
    assert.ok(!/^join-prune:/m.test(joined.stamp), 'the run consumed the join-prune line');
});

// The spec's Migration: a 2.12.0 child registered while the switch was off (2.12's init joined unasked; no own-env line)
// is a project 'with the switch never set' - its update moves every value into its own .variables, nothing pruned.
test('a 2.12.0 child registered with the switch off keeps every value through the update - no join prune without a join', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    const r = scenario([
        { at: '.', ...OLD },
        { at: 'api', ...OLD, args: ['--auto-compact', 'on'], after: (work) => join(work, 'api') },
        update('.', { after: (work) => setVar(work, '.', { [LEVEL]: '90' }) }),
        update('api', { after: (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), stamp: readOr(path.join(at(work, 'api'), '.claude', 'alfred-code.stamp')) }) }),
    ]);
    const got = r.steps[3];
    assert.ok(!/^own-env:/m.test(got.stamp), 'a dormant 2.12 child has no own-env line');
    assert.strictEqual(got.vars[LEVEL], '80', `its own seed moved, not pruned: ${JSON.stringify(got.vars)}\n${r.outs[3]}`);
    assert.strictEqual(got.vars.ALFRED_CODE_AUTO_COMPACT, '1', 'its init answer moved');
    assert.strictEqual(got.effective[LEVEL], '80');
    assert.ok(!/a stack seed, so the workspace's value reaches this project/.test(r.outs[3]), r.outs[3]);
});

// W1: every run that writes a joined child's .variables drops each value equal to the one the chain hands it, ledger rows
// included. A mode key lives in the mode file since mode v2 stage 3, so the equal key here is a plain variable.
const W1_EQ = 'ALFRED_CODE_MAXIMUM_RUN_AGENTS';
const W1_OWN = 'ALFRED_CODE_HISTORY';
const W1_PRUNED = /equal to the workspace's removed/;
const w1Read = (work) => ({
    vars: varsOf(work, 'api'), text: readOr(path.join(at(work, 'api'), '.alfred', '.variables')), effective: effectiveOf(work, 'api'),
    env: lineOf(stampOf(work, 'api'), 'managed-env') || '', root: varsOf(work, '.'),
});
const w1Join = (work) => { setVar(work, '.', { [W1_EQ]: '7' }); setVar(work, 'api', { [W1_EQ]: '7', [W1_OWN]: '9' }); join(work, 'api'); return w1Read(work); };

test('W1: an update in a joined child drops every value equal to the workspace\'s in that run, rows included, and the re-run changes nothing', POSIX_ONLY, () =>
{
    const r = scenario([{ at: '.' }, { at: 'api', after: w1Join }, update('api', { after: w1Read }), update('api', { after: w1Read })]);
    const [before, first, again] = [r.steps[1], r.steps[2], r.steps[3]];
    assert.ok(Object.keys(before.vars).length > 2, `the standalone child held its seeds: ${before.text}`);
    const equal = Object.keys(first.vars).filter((k) => !layoutLib.MEMBER_NEVER.has(k) && first.root[k] === first.vars[k]);
    assert.deepStrictEqual(equal, [], `no value equal to the root's is left: ${first.text}\n${r.outs[2]}`);
    assert.ok(!Object.hasOwn(first.vars, W1_EQ), first.text);
    assert.strictEqual(first.vars[W1_OWN], '9');
    const rows = [...first.env.matchAll(/\.variables:([A-Z0-9_]+)=/g)].map((m) => m[1]);
    assert.deepStrictEqual(rows.filter((k) => !Object.hasOwn(first.vars, k)), [], `no row for a key the file no longer holds: ${first.env}`);
    assert.deepStrictEqual(first.effective, before.effective, r.outs[2]);
    assert.match(r.outs[2], new RegExp(`^==>\\s+workspace: \\d+ values equal to the workspace's removed from \\.alfred\\/\\.variables \\(.*${W1_EQ}.*\\) - \\d+ kept as this project's own`, 'm'), r.outs[2]);
    assert.deepStrictEqual([again.text, again.env], [first.text, first.env], r.outs[3]);
    assert.ok(!W1_PRUNED.test(r.outs[3]), r.outs[3]);
});

test('W1: nothing is pruned by --print-plan, with the switch at 0 or by an uninstall', POSIX_ONLY, () =>
{
    const tail = [
        update('api', { args: (work) => ['--print-plan', '--plan-out', path.join(work, 'plan.json')], after: w1Read }),
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, after: w1Read }),
        { at: 'api', act: 'uninstall', after: w1Read },
    ];
    tail.forEach((step, i) =>
    {
        const r = scenario([{ at: '.' }, { at: 'api', after: w1Join }, step]);
        if (i < 2) assert.strictEqual(r.steps[2].text, r.steps[1].text, `step ${i}: ${r.outs[2]}`);
        assert.ok(!W1_PRUNED.test(r.outs[2]), `step ${i}: ${r.outs[2]}`);
    });
});

// 3.12: the file is the team's, so a local-scope run never writes it - each equal key is named instead, once per run.
test('W1: a local-scope run leaves a .variables git tracks as it is and names each value equal to the workspace\'s', POSIX_ONLY, () =>
{
    const git = (work, ...a) => rt.execCommand('git', ['-C', at(work, 'api'), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a]);
    const status = (work) => String(git(work, 'status', '--porcelain', '--untracked-files=all') || '');
    const r = scenario([
        { at: '.' },
        { at: 'api', after: (work) => { w1Join(work); git(work, 'add', '-f', '.alfred/.variables'); git(work, 'commit', '-q', '-m', 'own'); return { ...w1Read(work), status: status(work) }; } },
        update('api', { args: ['--scope', 'local'], after: (work) => ({ ...w1Read(work), status: status(work) }) }),
    ]);
    const [before, after] = [r.steps[1], r.steps[2]];
    assert.strictEqual(before.vars[W1_EQ], '7', before.text);
    assert.strictEqual(after.text, before.text, r.outs[2]);
    assert.ok(!/\.variables/.test(after.status), after.status);
    assert.ok(!W1_PRUNED.test(r.outs[2]), r.outs[2]);
    assert.match(r.outs[2], new RegExp(`^==>\\s+workspace: \\d+ values? equal to the workspace's stay in \\.alfred\\/\\.variables \\(.*${W1_EQ}.*\\) - git tracks it, so this run leaves the team's file as it is`, 'm'), r.outs[2]);
    assert.ok(!new RegExp(`stay in .*${W1_OWN}`).test(r.outs[2]), r.outs[2]);
});

test('W1 at local scope: an untracked .variables is trimmed, each key named, and the re-run changes nothing', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', args: ['--scope', 'local'] },
        { at: 'api', args: ['--scope', 'local'], after: w1Join },
        update('api', { after: w1Read }),
        update('api', { after: w1Read }),
    ]);
    const [before, first, again] = [r.steps[1], r.steps[2], r.steps[3]];
    assert.strictEqual(before.vars[W1_EQ], '7', before.text);
    assert.ok(!Object.hasOwn(first.vars, W1_EQ), `${first.text}\n${r.outs[2]}`);
    assert.strictEqual(first.vars[W1_OWN], '9');
    assert.deepStrictEqual(first.effective, before.effective, r.outs[2]);
    assert.match(r.outs[2], new RegExp(`workspace: \\d+ values equal to the workspace's removed from \\.alfred\\/\\.variables \\(.*${W1_EQ}.*\\)`), r.outs[2]);
    assert.deepStrictEqual([again.text, again.env], [first.text, first.env], r.outs[3]);
    assert.ok(!W1_PRUNED.test(r.outs[3]), r.outs[3]);
});

// F10 (the 2026-10-28 workspace run): a child joined BEFORE its install, given the value its workspace already hands it,
// wrote an own copy - frozen against a later change at the root. It writes nothing now; a different answer is its own.
const AC = 'ALFRED_CODE_AUTO_COMPACT';
const childRun = (flagArgs, before = () => {}) => scenario([
    { at: '.', after: (work) => { before(work); join(work, 'api'); } },
    { at: 'api', args: flagArgs, after: (work) => ({ vars: varsOf(work, 'api'), env: envOf(work, 'api'), root: varsOf(work, '.') }) },
]);
const NOT_JOINED = /ignored - this project is not a joined child/;

test('F10: a linked child given the inherited value writes nothing', POSIX_ONLY, () =>
{
    const r = childRun(['--auto-compact', 'on'], (work) => variablesLib.write(path.join(at(work, '.'), '.alfred', '.variables'), { [AC]: '1' }));
    const got = r.steps[1];
    assert.strictEqual(got.root[AC], '1', 'the root holds the value');
    assert.ok(!Object.hasOwn(got.vars, AC), `no own copy in .variables: ${JSON.stringify(got.vars)}\n${r.outs[1]}`);
    assert.ok(!Object.hasOwn(got.env, AC), 'none in settings.json');
    assert.match(r.outs[1], /ALFRED_CODE_AUTO_COMPACT '1' comes from the workspace - nothing written \(the --auto-compact answer equals it\)/);
    assert.doesNotMatch(r.outs[1], NOT_JOINED);
});

test('F10: a linked child given another value writes it as its own', POSIX_ONLY, () =>
{
    const r = childRun(['--auto-compact', 'on']);
    assert.strictEqual(r.steps[1].vars[AC], '1', r.outs[1]);
    assert.doesNotMatch(r.outs[1], /comes from the workspace - nothing written/);
    assert.doesNotMatch(r.outs[1], NOT_JOINED);
});

test('F10: --auto-compact off writes nothing where no member sets the key (mode commands v2: off takes the key out)', POSIX_ONLY, () =>
{
    const r = childRun(['--auto-compact', 'off']);
    const got = r.steps[1];
    assert.ok(!Object.hasOwn(got.root, AC), 'the root holds no value - nothing seeds it');
    assert.ok(!Object.hasOwn(got.vars, AC), `${JSON.stringify(got.vars)}\n${r.outs[1]}`);
    assert.match(r.outs[1], /ALFRED_CODE_AUTO_COMPACT absent, unchanged \(--auto-compact off\)/);
});

test('F10: an unlinked child with a parent line writes its answer', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.' },
        { at: 'api', args: ['--auto-compact', 'on'], before: (work) => edit(work, 'api', (m) => wsLib.setParent(m, '..')), after: (work) => ({ vars: varsOf(work, 'api') }) },
    ]);
    assert.strictEqual(r.steps[1].vars[AC], '1', r.outs[1]);
    assert.doesNotMatch(r.outs[1], /comes from the workspace - nothing written/);
});

test('F10: a linked child given --memory default writes nothing', POSIX_ONLY, () =>
{
    const r = childRun(['--memory', 'default']);
    const got = r.steps[1];
    assert.ok(!Object.hasOwn(got.vars, 'ALFRED_CODE_MEMORY'), `${JSON.stringify(got.vars)}\n${r.outs[1]}`);
    assert.match(r.outs[1], /ALFRED_CODE_MEMORY 'default' comes from the workspace - nothing written \(the --memory answer equals it\)/);
    assert.doesNotMatch(r.outs[1], NOT_JOINED);
});

// D4 step 5 for Claude Code's own settings: a child whose AUTO_COMPACT and MEMORY come from the root writes the rows a
// project holding them itself would - else its hooks run compact / custom memory while Claude Code does neither.
test('a child reading AUTO_COMPACT=1 and MEMORY=custom from its root gets the autoCompactWindow rows and autoMemoryEnabled false', POSIX_ONLY, () =>
{
    // Mode v2 stage 2: the stack's rows sit in settings.local.json at project scope too.
    const settingsOf = (work, rel) => json(path.join(at(work, rel), '.claude', 'settings.local.json')) || {};
    const r = scenario([
        { at: '.', after: (work) => { setVar(work, '.', { ALFRED_CODE_AUTO_COMPACT: '1', ALFRED_CODE_MEMORY: 'custom' }); join(work, 'api'); } },
        { at: 'api', after: (work) => ({ api: settingsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from }) },
        update('api', { after: (work) => ({ api: settingsOf(work, 'api') }) }),
    ]);
    const got = r.steps[1];
    // mode commands v2: the root's 1 is copied into the child's own mode file once, which writes its windows (modes.js refresh)
    assert.deepStrictEqual([got.from.ALFRED_CODE_AUTO_COMPACT, got.from.ALFRED_CODE_MEMORY], ['settings.local.json', '..'], 'the mode in its own file, memory from the root');
    const rows = Object.values(got.api.modelSettings || {}).filter((e) => e && e.autoCompactWindow !== undefined);
    assert.ok(rows.length > 0, `no autoCompactWindow row in the child: ${JSON.stringify(got.api.modelSettings)}\n${r.outs[1]}`);
    assert.strictEqual(got.api.autoMemoryEnabled, false, r.outs[1]);
    assert.deepStrictEqual(r.steps[2].api.modelSettings, got.api.modelSettings, 'an update keeps them');
    assert.strictEqual(r.steps[2].api.autoMemoryEnabled, false);
});

// AC19: on by default, and a launch 0 still freezes - the child reads a chain of one and an install there removes nothing.
test('AC19: a launch 0 in ws/api reads a chain of one and an install there removes nothing', POSIX_ONLY, () =>
{
    const LEVEL = 'ALFRED_CODE_SCORING_LEVEL';
    const files = (work) => ['.', 'api'].flatMap((rel) => ['workspace', '.variables'].map((f) => readOr(path.join(at(work, rel), '.alfred', f))));
    const r = scenario([
        { at: '.', env: { ALFRED_CODE_WORKSPACE: '' }, after: (work) => { setVar(work, '.', { [LEVEL]: '90' }); join(work, 'api'); } },
        { at: 'api', env: { ALFRED_CODE_WORKSPACE: '' }, after: (work) => ({ files: files(work), from: layoutLib.variablesOf(at(work, 'api'), { env: { CLAUDE_CONFIG_DIR: acct(work).CLAUDE_CONFIG_DIR } }).from[LEVEL] }) },
        { at: 'api', env: { ALFRED_CODE_WORKSPACE: '0' }, after: (work) => ({ files: files(work), from: layoutLib.variablesOf(at(work, 'api'), { env: { CLAUDE_CONFIG_DIR: acct(work).CLAUDE_CONFIG_DIR, ALFRED_CODE_WORKSPACE: '0' } }).from[LEVEL] }) },
    ]);
    assert.strictEqual(r.steps[1].from, '..', `unset is on: the child reads the root's value through the chain: ${r.outs[1]}`);
    assert.notStrictEqual(r.steps[2].from, '..', 'a launch 0 reads a chain of one');
    assert.deepStrictEqual(r.steps[2].files, r.steps[1].files, `the workspace files and the .variables files are unchanged: ${r.outs[2]}`);
});

test('a parent read-back that fails adds and drops nothing and prints one !! line', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => lineOf(stampOf(work, 'api'), 'own-picks') },
        update('.', { args: ['--add', `skill ${X}`], after: (work) => fs.writeFileSync(path.join(at(work), '.claude', 'settings.local.json'), '{ not json') }),
        update('api', { after: (work) => [hasSkill(work, 'api', X), lineOf(stampOf(work, 'api'), 'own-picks')] }),
    ]);
    assert.deepStrictEqual(r.steps[3], [false, r.steps[1]], r.outs[3]);
    assert.strictEqual((r.outs[3].match(/!! workspace: the read-back of \.\. failed \(/g) || []).length, 1, r.outs[3]);
    assert.match(r.outs[3], /nothing inherited is added or dropped this run/);
});

test('kill switch: at 0, nothing is added, dropped, re-seeded or removed and the own lines are carried (AC16)', POSIX_ONLY, () =>
{
    const keep = (work) => ({ own: lineOf(stampOf(work, 'api'), 'own-picks'), ex: excludesOf(work, 'api').length, vars: varsOf(work, 'api'), x: hasSkill(work, 'api', X) });
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: keep },
        update('.', { args: ['--add', `skill ${X}`], after: (work) => setVar(work, '.', { [SC]: '1' }) }),
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, after: keep }),
        update('api', { after: (work) => effectiveOf(work, 'api')[SC] }),
    ]);
    assert.ok(r.steps[1].ex > 0);
    assert.deepStrictEqual(Object.keys(r.steps[1].vars), ['ALFRED_CODE_DOCS_VERSIONING'], 'a child seeds no chained key');
    assert.deepStrictEqual(r.steps[3], r.steps[1], r.outs[3]);
    assert.strictEqual(r.steps[4], '1', 'switched back on, the root\'s value reaches the child - nothing seeded at 0 shadows it');
    assert.doesNotMatch(r.outs[3], /workspace: from/);
});

test('the parent stays byte-identical across a child update (AC32)', POSIX_ONLY, () =>
{
    const parentOnly = (work) => treeHash(at(work), [at(work, 'api'), at(work, 'web')]);
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: parentOnly },
        update('api', { after: parentOnly }),
    ]);
    assert.strictEqual(r.steps[2], r.steps[1]);
});

test('a child whose back-reference was deleted inherits nothing, writes nothing into the parent, and keeps its own parent line (AC18)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => edit(work, '.', (m) => wsLib.removeChild(m, 'api')) },
        update('.', { args: ['--add', `skill ${X}`], after: (work) => readWorkspaceRecord(at(work)).text }),
        update('api', { after: (work) => ({ x: hasSkill(work, 'api', X), root: readWorkspaceRecord(at(work)).text, own: readWorkspaceValues(at(work, 'api')) }) }),
    ]);
    assert.strictEqual(r.steps[3].x, false, r.outs[3]);
    assert.strictEqual(r.steps[3].root, r.steps[2], 'the parent\'s workspace file was written');
    assert.strictEqual(r.steps[3].own.parent, '..');
    // the run converted the child's old file before the workspace pass read it, so the note names workspace.json
    assert.match(r.outs[3], /!! workspace: parent \.\. in \.alfred\/workspace\.json ignored - \.\. does not list this folder as a child/);
});

test('a parent print-plan with a failure note, or with an unparseable settings.json, gives parentLines null', POSIX_ONLY, () =>
{
    const state = (work) => [hasSkill(work, 'api', X), effectiveOf(work, 'api')[SC]];
    const r = scenario([
        { at: '.', after: (work) => { setVar(work, '.', { [SC]: '1' }); join(work, 'api'); } },
        { at: 'api', after: state },
        update('.', { args: ['--add', `skill ${X}`] }),
        planStep('good.json'),
        update('api', {
            before: (work) => { const p = json(path.join(work, 'good.json')); fs.writeFileSync(path.join(work, 'failed.json'), JSON.stringify({ ...p, failures: 1 })); },
            args: (work) => ['--parent-plan', path.join(work, 'failed.json')],
            after: (work) => { const s = state(work); fs.writeFileSync(path.join(at(work), '.claude', 'settings.json'), '{ garbage'); return s; },
        }),
        update('api', { after: state }),
    ]);
    assert.deepStrictEqual(r.steps[1], [false, '1'], r.outs[1]);
    assert.deepStrictEqual(r.steps[4], [false, '1'], r.outs[4]);
    assert.match(r.outs[4], /!! workspace: the read-back of \.\. failed \([^)]*1 failure/);
    assert.deepStrictEqual(r.steps[5], [false, '1'], r.outs[5]);
    assert.match(r.outs[5], /!! workspace: the read-back of \.\. failed \([^)]*settings\.json/);
});

test('a parent read-back with no claude on PATH is blind and gives parentLines null', POSIX_ONLY, () =>
{
    const noClaude = { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter) };
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
        update('.', { args: ['--add', `skill ${X}`] }),
        { ...planStep('blind.json'), env: noClaude, after: (work) => json(path.join(work, 'blind.json')).blind },
        update('api', { args: (work) => ['--parent-plan', path.join(work, 'blind.json')], after: (work) => hasSkill(work, 'api', X) }),
    ]);
    assert.strictEqual(r.steps[3], true, r.outs[3]);
    assert.strictEqual(r.steps[4], false, r.outs[4]);
    assert.match(r.outs[4], /!! workspace: the read-back of \.\. failed \([^)]*blind/);
});

test('a child whose own listing is blind adds and drops nothing and keeps its own-picks line byte for byte', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => lineOf(stampOf(work, 'api'), 'own-picks') },
        update('.', { args: ['--add', `skill ${X}`] }),
        { ...planStep('good.json'), after: (work) => fs.writeFileSync(path.join(work, 'plugins.json'), '[]') },
        update('api', { args: (work) => ['--parent-plan', path.join(work, 'good.json')], after: (work) => [hasSkill(work, 'api', X), lineOf(stampOf(work, 'api'), 'own-picks')] }),
    ]);
    assert.deepStrictEqual(r.steps[4], [false, r.steps[1]], r.outs[4]);
    assert.match(r.outs[4], /!! workspace: this project's plugin listing could not be read - nothing inherited is added or dropped this run/);
});

test('a parent with an unknown workspace key still yields parentLines', POSIX_ONLY, () =>
{
    const r = scenario([
        // the file's text is the subject: an unknown key beside the known ones
        { at: '.', after: (work) => { join(work, 'api'); addKey(work, '.', 'frobnicate', 'the tree'); } },
        { at: 'api' },
        update('.', { args: ['--add', `skill ${X}`] }),
        { ...planStep('plan.json'), after: (work) => json(path.join(work, 'plan.json')).failures },
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
    ]);
    assert.strictEqual(r.steps[3], 0, r.outs[3]);
    assert.match(r.outs[3], /!! workspace: \.alfred\/workspace\.json: unknown key 'frobnicate' kept/);
    assert.strictEqual(r.steps[4], true, r.outs[4]);
});

test('a parent none project handed --parent-plan gets nothing, and a plan whose root is another folder is refused', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'web'); edit(work, 'api', (m) => wsLib.setParent(m, 'none')); } },
        { at: 'api' },
        { at: 'web' },
        update('.', { args: ['--add', `skill ${X}`] }),
        planStep('root.json'),
        update('api', { args: (work) => ['--parent-plan', path.join(work, 'root.json')], after: (work) => hasSkill(work, 'api', X) }),
        { ...update('api', { args: (work) => ['--print-plan', '--plan-out', path.join(work, 'api.json')] }) },
        update('web', { args: (work) => ['--parent-plan', path.join(work, 'api.json')], after: (work) => hasSkill(work, 'web', X) }),
    ]);
    assert.strictEqual(r.steps[5], false, r.outs[5]);
    assert.match(r.outs[5], /!! workspace: --parent-plan ignored - this project is not a joined child/);
    assert.strictEqual(r.steps[7], false, r.outs[7]);
    assert.match(r.outs[7], /!! workspace: the read-back of \.\. failed \(the plan is from /);
});

test('an older custom root at the workspace root is carried to .alfred with its workspace file, and the child\'s chain still finds the root', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => void plantOlderRoot(at(work), '.ws-data') },
        update('.', { after: (work) => [readWorkspaceValues(at(work)), fs.existsSync(path.join(at(work), '.ws-data'))] }),
        update('.', { args: ['--add', `skill ${X}`] }),
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
    ]);
    assert.deepStrictEqual((r.steps[2][0] || {}).children, ['api'], r.outs[2]);
    assert.strictEqual(r.steps[2][1], false, 'the emptied older root is gone');
    assert.strictEqual(r.steps[4], true, r.outs[4]);
});

test('a joined child whose older custom root is carried to .alfred while it adds an own pick keeps its chain and records the pick', POSIX_ONLY, () =>
{
    // The move runs before the workspace read: a read at .alfred ahead of it found no chain, carried the own lines
    // unchanged, and the pick was dropped by the next update's delta (the final review, finding 2).
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => void plantOlderRoot(at(work, 'api'), '.kid-data') },
        update('api', { args: ['--add', `skill ${X}`], after: (work) => ({
            own: lineOf(stampOf(work, 'api'), 'own-picks'), file: readWorkspaceValues(at(work, 'api')), old: fs.existsSync(path.join(at(work, 'api'), '.kid-data')),
        }) }),
        update('api', { after: (work) => ({ x: hasSkill(work, 'api', X), js: hasSkill(work, 'api', 'javascript') }) }),
    ]);
    assert.strictEqual((r.steps[2].file || {}).parent, '..', r.outs[2]);
    assert.strictEqual(r.steps[2].old, false, r.outs[2]);
    assert.match(r.steps[2].own || '', new RegExp(`skill/${X}`), r.outs[2]);
    assert.deepStrictEqual(r.steps[3], { x: true, js: true }, r.outs[3]);
});

test('a child\'s --drop of an item its parent holds writes the ignore line, so the next update keeps it out; an --add lifts it (validate, a hand-run update)', POSIX_ONLY, () =>
{
    const ignored = (values) => ((values || {}).ignore || {}).skill || [];
    const wsFile = (work) => readWorkspaceValues(at(work, 'api'));
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n` },
        update('api', { args: ['--drop', 'skill javascript'], after: (work) => ({ file: wsFile(work), js: hasSkill(work, 'api', 'javascript') }) }),
        update('api', { after: (work) => hasSkill(work, 'api', 'javascript') }),
        update('api', { args: ['--print-plan', '--add', 'skill javascript'], after: (work) => wsFile(work) }),
        update('api', { args: ['--add', 'skill javascript'], after: (work) => ({ file: wsFile(work), js: hasSkill(work, 'api', 'javascript'), own: lineOf(stampOf(work, 'api'), 'own-picks') }) }),
    ]);
    assert.ok(ignored(r.steps[2].file).includes('javascript'), r.outs[2]);
    assert.strictEqual(r.steps[2].js, false);
    assert.strictEqual(r.steps[3], false, `the next update brought it back:\n${r.outs[3]}`);
    assert.ok(ignored(r.steps[4]).includes('javascript'), 'a print-plan writes nothing');
    assert.ok(!ignored(r.steps[5].file).includes('javascript'), r.outs[5]);
    assert.strictEqual(r.steps[5].js, true);
    assert.doesNotMatch(r.steps[5].own || '', /skill\/javascript/, 'taken from the parent again, not an own pick');
});

test('a child install with --parent-plan takes the parent\'s set even when its selection left a row out, and never an ignored one', POSIX_ONLY, () =>
{
    // init-child.md keeps every from-root row in raw.json; the installer no longer relies on the model doing so.
    const r = scenario([
        { at: '.', sel: `${ROOT_SEL}skill ${X}\n`, after: (work) => { join(work, 'api'); edit(work, 'api', (m) => wsLib.addIgnore(m, 'skill', X)); } },
        planStep('root.json'),
        { at: 'api', sel: `skill ${OWN}\n`, args: (work) => ['--parent-plan', path.join(work, 'root.json')], after: (work) => ({
            js: hasSkill(work, 'api', 'javascript'), x: hasSkill(work, 'api', X), own: lineOf(stampOf(work, 'api'), 'own-picks'),
        }) },
    ]);
    assert.deepStrictEqual([r.steps[2].js, r.steps[2].x], [true, false], r.outs[2]);
    assert.strictEqual(r.steps[2].own, `skill/${OWN}`);
});

test('a D5 decline, a managed-account row and the own lines survive an update', POSIX_ONLY, () =>
{
    const ROW = `settings.json:${stampLib.ACCOUNT_KEYS[0]}=${'a'.repeat(64)}`;
    const lines = (rel) => (work) => ['instructions-both', 'managed-account', 'own-picks'].map((k) => lineOf(stampOf(work, rel), k));
    const stampFile = (work, rel) => path.join(at(work, rel), '.claude', 'alfred-code.stamp');
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => { stampLib.markLine(stampFile(work, 'api'), 'instructions-both', 'declined'); return lines('api')(work); } },
        { at: 'web', after: (work) => { stampLib.markLine(stampFile(work, 'web'), 'managed-account', ROW); return lines('web')(work); } },
        update('api', { after: lines('api') }),
        update('web', { after: lines('web') }),
    ]);
    assert.strictEqual(r.steps[1][0], 'declined');
    assert.strictEqual(r.steps[2][1], ROW);
    assert.deepStrictEqual(r.steps[3], r.steps[1], r.outs[3]);
    assert.deepStrictEqual(r.steps[4], r.steps[2], r.outs[4]);
});

test('a project-scope child whose settings.local.json the excludes create, with git not ignoring it, gets the !! settings.local.json line once (AC7, AC27)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => excludesOf(work, 'api').length },
    ]);
    assert.ok(r.steps[1] > 0, r.outs[1]);
    assert.strictEqual((r.outs[1].match(/!! settings\.local\.json: created for this machine's own values - git does not ignore it here/g) || []).length, 1, r.outs[1]);
});

test('a child-only update\'s yes (--add) for an item the parent lacks lands in own-picks and survives a root cascade that declined it (AC14)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
        update('api', { args: ['--add', `skill ${X}`], after: (work) => lineOf(stampOf(work, 'api'), 'own-picks') }),
        update('.'),
        update('api', { after: (work) => [hasSkill(work, 'api', X), lineOf(stampOf(work, 'api'), 'own-picks')] }),
    ]);
    assert.strictEqual(r.steps[2], `skill/${X}`, r.outs[2]);
    assert.deepStrictEqual(r.steps[4], [true, `skill/${X}`], r.outs[4]);
});

test('a nested project with parent none still gets the root\'s excludes, and a child also gets an unlinked stamped intermediate folder\'s excludes (AC27)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { edit(work, 'web', (m) => wsLib.setParent(m, 'none')); join(work, 'api/tool'); plantGen(work, '.'); } },
        { at: 'web', after: (work) => ({ want: ruleGlobs(work, '.'), got: excludesOf(work, 'web') }) },
        { at: 'api', after: (work) => plantGen(work, 'api', 'alfred-architecture') },
        { at: 'api/tool', after: (work) => ({ want: [...ruleGlobs(work, '.'), ...ruleGlobs(work, 'api')], got: excludesOf(work, 'api/tool') }) },
    ]);
    for (const i of [1, 3])
    {
        assert.ok(r.steps[i].want.length > 0);
        for (const g of r.steps[i].want) assert.ok(r.steps[i].got.includes(g), `run ${i}: no exclude for ${g}\n${r.outs[i]}`);
    }
});

// ------------------------------------------------------------------ the cascade (plan Task 12)

const tree = (work, rel) => treeHash(path.join(at(work, rel), '.claude')) + treeHash(path.join(at(work, rel), '.alfred'));

test('plan lists the tree top-down with projected add and drop', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); edit(work, 'web', (m) => wsLib.addIgnore(m, 'skill', X)); } },
        { at: 'api' },
        { at: 'web' },
        update('api'),
        update('web'),
        update('.', { args: ['--add', `skill ${X}`] }),
        cli('plan'),
    ]);
    const out = r.outs[6];
    assert.match(out, /^workspace-plan: 3 projects$/m, out);
    const row = (rel) => new RegExp(`^project: ${rel.replace('.', '\\.')}\\tscope=project\\tversion=(\\S+)->\\1\\tadd=([^\\t]+)\\tdrop=(\\S+)$`, 'm').exec(out);
    assert.deepStrictEqual([row('.')?.[2], row('.')?.[3]], ['-', '-'], out);
    assert.deepStrictEqual([row('api')?.[2], row('api')?.[3]], [`skill ${X}`, '-'], out);
    assert.deepStrictEqual([row('web')?.[2], row('web')?.[3]], ['-', '-'], 'an ignored item is no projected add');
    assert.ok(out.indexOf('project: .\t') < out.indexOf('project: api\t') && out.indexOf('project: api\t') < out.indexOf('project: web\t'), out);
});

test('cascade: a failed mid-level parent skips its subtree while the sibling updates (AC6)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api', after: (work) => join(work, 'api/tool', { parent: 'api' }) },
        { at: 'api/tool' },
        { at: 'web' },
        update('api'),
        update('api/tool'),
        update('web'),
        update('.', { args: ['--add', `skill ${X}`], after: (work) =>
        {
            fs.writeFileSync(path.join(at(work, 'api'), '.claude', 'settings.local.json'), '{ not json');
            return tree(work, 'api/tool');
        } }),
        cli('cascade', { after: (work) => ({ tool: tree(work, 'api/tool'), toolX: hasSkill(work, 'api/tool', X), webX: hasSkill(work, 'web', X) }) }),
    ]);
    const out = r.outs[8];
    assert.match(out, /^cascade: api\tfailed$/m, out);
    assert.match(out, /^cascade: api\/tool\tskipped$/m, out);
    assert.match(out, /^cascade: web\tupdated$/m, out);
    assert.match(out, /^cascade: done 1 updated, 1 failed, 1 skipped$/m, out);
    assert.strictEqual(r.steps[8].tool, r.steps[7], 'the skipped child kept every file');
    assert.deepStrictEqual([r.steps[8].toolX, r.steps[8].webX], [false, true]);
});

test('cascade: a deleted child is gone and loses its line (AC6)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api' },
        { at: 'web', after: (work) => fs.rmSync(at(work, 'web'), { recursive: true, force: true }) },
        cli('cascade', { after: (work) => readWorkspaceValues(at(work)) }),
    ]);
    assert.match(r.outs[3], /^cascade: web\tgone$/m, r.outs[3]);
    assert.match(r.outs[3], /^cascade: api\t(updated|unchanged)$/m, r.outs[3]);
    assert.deepStrictEqual(r.steps[3], { children: ['api'] });
});

test('cascade applies one project\'s answer and no other\'s', POSIX_ONLY, () =>
{
    const answers = (work) => path.join(work, 'answers.json');
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api' },
        { at: 'web' },
        cli('cascade', {
            before: (work) => fs.writeFileSync(answers(work), JSON.stringify({ web: ['--add', `skill ${X}`] })),
            args: (work) => ['--answers', answers(work)],
            after: (work) => ({ web: hasSkill(work, 'web', X), api: hasSkill(work, 'api', X) }),
        }),
    ]);
    // api had no entry, so its run got no --add and took nothing more.
    assert.deepStrictEqual(r.steps[3], { web: true, api: false }, r.outs[3]);
});

test('a mid-level parent with an unknown workspace key still cascades', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        // the file's text is the subject: an unknown key beside the known ones
        { at: 'api', after: (work) => { join(work, 'api/tool', { parent: 'api' }); addKey(work, 'api', 'frobnicate', 'x'); } },
        { at: 'api/tool' },
        update('api'),
        update('api/tool'),
        update('.', { args: ['--add', `skill ${X}`] }),
        cli('cascade', { after: (work) => hasSkill(work, 'api/tool', X) }),
    ]);
    assert.match(r.outs[6], /^cascade: api\tupdated$/m, r.outs[6]);
    assert.match(r.outs[6], /^cascade: api\/tool\tupdated$/m, r.outs[6]);
    assert.strictEqual(r.steps[6], true);
});

test('--rescan lists a stamped project with no parent line (AC13)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
        { at: 'web' },
        cli('plan', { args: ['--rescan'] }),
    ]);
    assert.match(r.outs[3], /^rescan: web$/m, r.outs[3]);
    assert.doesNotMatch(r.outs[3], /^rescan: api$/m);
    assert.match(r.outs[3], /^workspace-plan: 2 projects$/m, 'a rescan row is an offer, not a project of the cascade');
});

// ------------------------------------------------------------------ uninstall (plan Task 14)

const KEY = 'instructionFiles';
const accountKey = (work) => (((json(path.join(work, 'acct', 'settings.json')) || {}).pluginConfigs || {})['cc-plugin-agents-md@builtin'] || {}).options?.[KEY];
// D5's yes in each named child, and the account file listing them, as Claude Code keeps it.
function applyAccount(work, rels, accountText)
{
    const roots = rels.flatMap((rel) => ['--root', at(work, rel)]);
    rt.execCommand(process.execPath, [CLI, 'account-instructions', ...roots, '--apply'], { env: { ...process.env, ...acct(work) }, encoding: 'utf8' });
    fs.writeFileSync(path.join(work, 'acct', '.claude.json'), accountText ?? JSON.stringify({ projects: Object.fromEntries(rels.map((rel) => [at(work, rel), {}])) }));
}

test('uninstall at ws: each child keeps every item, its parent line is gone, the grandchild is untouched (AC10)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => join(work, 'api/tool', { parent: 'api' }) },
        { at: 'api/tool' },
        { at: 'web', after: (work) => ({ tool: tree(work, 'api/tool'), vars: readOr(path.join(at(work), '.alfred', '.variables')) }) },
        { at: '.', act: 'uninstall', after: (work) => ({
            apiVars: readOr(path.join(at(work, 'api'), '.alfred', '.variables')),
            api: readWorkspaceValues(at(work, 'api')), web: readWorkspaceValues(at(work, 'web')),
            root: readWorkspaceValues(at(work)), own: lineOf(stampOf(work, 'api'), 'own-picks'),
            skills: [hasSkill(work, 'api', 'javascript'), hasSkill(work, 'api', OWN), hasSkill(work, 'web', 'javascript')],
            tool: tree(work, 'api/tool'), rootStamp: fs.existsSync(path.join(at(work), '.claude', 'alfred-code.stamp')),
        }) },
        update('api', { after: (work) => ({ excludes: excludesOf(work, 'api'), skills: [hasSkill(work, 'api', 'javascript'), hasSkill(work, 'api', OWN)] }) }),
    ]);
    const got = r.steps[4];
    assert.strictEqual(got.rootStamp, false, r.outs[4]);
    assert.deepStrictEqual(got.api, { children: ['tool'] }, r.outs[4]);
    assert.deepStrictEqual(got.web, {});
    assert.ok(!(got.root || {}).children, `the root still lists a child: ${JSON.stringify(got.root)}`);
    assert.strictEqual(got.own, null, 'a released child reads as standalone: every pick its own');
    assert.deepStrictEqual(got.skills, [true, true, true]);
    assert.strictEqual(got.tool, r.steps[3].tool, 'the grandchild kept every file');
    // D5: the root's values reach api through its own file now - its seeds included, read before the settings pass took
    // them (an empty value reads as unset, the default before and after)
    const pairs = (text) => Object.fromEntries((text || '').split('\n').filter((l) => /^ALFRED_CODE_\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2)));
    const rootVars = pairs(r.steps[3].vars);
    assert.ok(Object.keys(rootVars).length, `the root seeded no .variables:\n${r.steps[3].vars}`);
    const apiVars = pairs(got.apiVars);
    for (const [key, value] of Object.entries(rootVars)) if (!layoutLib.MEMBER_NEVER.has(key) && value !== '') assert.strictEqual(apiVars[key], value, `${key} in api after the root's uninstall:\n${got.apiVars}\n${r.outs[4]}`);
    assert.match(r.outs[4], /workspace: released api - /);
    assert.match(r.outs[4], /workspace: released web - /);
    // the next update of a released child removes its stale excludes, and keeps every item
    assert.deepStrictEqual(r.steps[5].excludes, [], r.outs[5]);
    assert.deepStrictEqual(r.steps[5].skills, [true, true]);
});

test('uninstall in a child removes its child line from the parent and its excludes (AC9)', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); fs.writeFileSync(path.join(at(work), 'CLAUDE.md'), '# team\n'); } },
        { at: 'api' },
        { at: 'web', after: (work) => { applyAccount(work, ['api', 'web']); return [accountKey(work), excludesOf(work, 'api').length]; } },
        { at: 'api', act: 'uninstall', after: (work) => ({ root: readWorkspaceValues(at(work)), excludes: excludesOf(work, 'api'), key: accountKey(work), parent: readWorkspaceValues(at(work, 'api')) }) },
        { at: 'web', act: 'uninstall', after: (work) => ({ root: readWorkspaceValues(at(work)), key: accountKey(work) }) },
    ]);
    assert.deepStrictEqual(r.steps[2], ['claude-md-and-agents-md', r.steps[2][1]]);
    assert.ok(r.steps[2][1] > 0, 'the child held excludes before');
    const first = r.steps[3];
    assert.deepStrictEqual(first.root, { children: ['web'] }, r.outs[3]);
    assert.deepStrictEqual(first.excludes, [], r.outs[3]);
    assert.ok(!(first.parent || {}).parent, r.outs[3]);
    assert.strictEqual(first.key, 'claude-md-and-agents-md', 'another child still records the key');
    assert.match(r.outs[3], /instructionFiles key kept - 1 other project still records it: .*\/ws\/web/, r.outs[3]);
    assert.deepStrictEqual(r.steps[4].root, {}, r.outs[4]);
    assert.strictEqual(r.steps[4].key, undefined, r.outs[4]);
    assert.match(r.outs[4], /instructionFiles key removed - no other project records it/, r.outs[4]);
});

test('uninstall in a child with the account file unreadable keeps the account key and prints the remove command', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); fs.writeFileSync(path.join(at(work), 'CLAUDE.md'), '# team\n'); } },
        { at: 'api', after: (work) => applyAccount(work, ['api'], '{ not json') },
        { at: 'api', act: 'uninstall', after: (work) => accountKey(work) },
    ]);
    assert.strictEqual(r.steps[2], 'claude-md-and-agents-md', r.outs[2]);
    assert.match(r.outs[2], /!! workspace: the account's instructionFiles key kept - .*\.claude\.json could not be read.*account-instructions --root \S+ --remove --hash [0-9a-f]{64}/, r.outs[2]);
    assert.doesNotMatch(r.outs[2], /stamp kept/, 'the unread account file does not hold the uninstall back');
});

// ------------------------------------------------------------------ release 2, D2: the parent's local MCP registrations
// The account stub keeps `.claude.json` as the CLI does: local scope is `projects[<real path>]`, an add-json entry is stored
// with its `type`. Each case writes the root's registrations itself, as a session in the root would have.

const accountOf = (work) => path.join(work, 'acct', '.claude.json');
const keyAt = (work, rel) => fs.realpathSync(at(work, rel));
const localOf = (work, rel) => ((((json(accountOf(work)) || {}).projects || {})[keyAt(work, rel)]) || {}).mcpServers || {};
function putLocal(work, rel, servers)
{
    const data = json(accountOf(work)) || {};
    const entry = ((data.projects ||= {})[keyAt(work, rel)] ||= {});
    entry.mcpServers = { ...(entry.mcpServers || {}), ...servers };
    for (const [n, v] of Object.entries(servers)) if (v === null) delete entry.mcpServers[n];
    fs.mkdirSync(path.dirname(accountOf(work)), { recursive: true });
    fs.writeFileSync(accountOf(work), JSON.stringify(data, null, 2));
}
const putAccount = (work, mutate) => { const data = json(accountOf(work)) || {}; mutate(data); fs.writeFileSync(accountOf(work), JSON.stringify(data, null, 2)); };
const mcpCalls = (work) => (readOr(path.join(work, 'claude-calls.log'), '') || '').split('\n').filter((l) => /^mcp (add-json|remove) /.test(l));
const stateOf = (work, rel) => json(path.join(at(work, rel), '.alfred', 'state', 'workspace-mcp.json'));
const rowsOf = (work, rel) => lineOf(stampOf(work, rel), 'workspace-mcp');
const rowMap = (line) => Object.fromEntries((line || '').split(',').filter(Boolean).map((r) => r.replace(/^local:/, '').split('=')));
const hashOf = (entry) => stampLib.entryHash(entry);
const SRV = { type: 'stdio', command: 'node', args: ['srv.js', '--stdio'], env: { MODE: 'one' } };
const mcpState = (work) => ({ calls: mcpCalls(work), local: localOf(work, 'api'), rows: rowsOf(work, 'api'), state: stateOf(work, 'api') });
const d2 = (steps) => scenario(steps, { account: true });

// ------------------------------------------------------------------ D8: the hint that replaced D2's copies
// A child is told about a linked member's local-scope server it cannot see; nothing registers it here.
const HINT = (name, rel) => `mcp ${name}: registered for ${rel} only (local scope) - not seen here. Share it: claude mcp add-json -s user, or the root's .mcp.json - approve it once in this folder; or copy it here: claude mcp get ${name} in ${rel}, then claude mcp add-json -s local ${name}`;
const hintsIn = (out) => out.split('\n').map((l) => l.replace(/^==>/, '').trim()).filter((l) => /^mcp \S+: registered for /.test(l));
const writeCopies = (work, rel, names) =>
{
    const f = path.join(at(work, rel), '.claude', 'alfred-code.stamp');
    stampLib.markLine(f, 'workspace-mcp', names.map((n) => `local:${n}=${hashOf(localOf(work, rel)[n])}`).join(','));
    const s = path.join(at(work, rel), '.alfred', 'state', 'workspace-mcp.json');
    fs.mkdirSync(path.dirname(s), { recursive: true });
    fs.writeFileSync(s, `${JSON.stringify(Object.fromEntries(names.map((n) => [n, '0'.repeat(64)])), null, 2)}\n`);
};

test('D8: a child names each linked member\'s local server it cannot see', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'api/tool', { parent: 'api' }); putLocal(work, '.', { srv: SRV, other: SRV }); } },
        { at: 'api', after: (work) => putLocal(work, 'api', { near: SRV }) },
        { at: 'api/tool' },
    ]);
    assert.deepStrictEqual(hintsIn(r.outs[1]).sort(), [HINT('other', '..'), HINT('srv', '..')], r.outs[1]);
    assert.deepStrictEqual(hintsIn(r.outs[2]).sort(), [HINT('near', '..'), HINT('other', '../..'), HINT('srv', '../..')], r.outs[2]);
});

test('D8: no line for a server registered here at any scope, in an ancestor\'s .mcp.json, at user scope or under ignore mcp', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) =>
        {
            join(work, 'api');
            putLocal(work, '.', { mine: SRV, theirs: SRV, proj: SRV, anc: SRV, ign: SRV, shown: SRV });
            putLocal(work, 'api', { mine: { type: 'stdio', command: 'node', args: ['own.js'], env: {} } });
            putAccount(work, (d) => { d.mcpServers = { theirs: { type: 'stdio', command: 'node', args: ['user.js'], env: {} } }; });
            fs.writeFileSync(path.join(at(work, 'api'), '.mcp.json'), `${JSON.stringify({ mcpServers: { proj: { command: 'node', args: ['p.js'] } } }, null, 2)}\n`);
            fs.writeFileSync(path.join(at(work), '.mcp.json'), `${JSON.stringify({ mcpServers: { anc: { command: 'node', args: ['a.js'] } } }, null, 2)}\n`);
            edit(work, 'api', (m) => wsLib.addIgnore(m, 'mcp', 'ign'));
        } },
        { at: 'api' },
    ]);
    assert.deepStrictEqual(hintsIn(r.outs[1]), [HINT('shown', '..')], r.outs[1]);
});

test('D8: the hint calls no claude mcp verb', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { srv: SRV }); } },
        { at: 'api', after: (work) => mcpCalls(work) },
        update('api', { after: (work) => (readOr(path.join(work, 'claude-calls.log'), '') || '').split('\n').filter((l) => /^mcp /.test(l)) }),
    ]);
    assert.strictEqual(hintsIn(r.outs[1]).length, 1, r.outs[1]);
    assert.deepStrictEqual(r.steps[1], [], 'no add-json or remove');
    assert.deepStrictEqual(r.steps[2], [], 'no claude mcp call of any kind');
});

test('D8: an unreadable or two-key account file prints its one !! line; a keyless member prints none', POSIX_ONLY, () =>
{
    const bad = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { srv: SRV }); } },
        { at: 'api', before: (work) => fs.writeFileSync(accountOf(work), '{ not json') },
    ]);
    assert.strictEqual((bad.outs[1].match(/^(==>)?\s*!! workspace: .*\.claude\.json could not be read - no MCP hint for the linked folders$/gm) || []).length, 1, bad.outs[1]);
    assert.deepStrictEqual(hintsIn(bad.outs[1]), []);
    const two = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { srv: SRV }); putAccount(work, (d) => { d.projects[`${keyAt(work, '.')}/`] = { mcpServers: { srv: SRV } }; }); } },
        { at: 'api' },
    ]);
    assert.strictEqual((two.outs[1].match(/^(==>)?\s*!! workspace: .*\.claude\.json holds 2 entries for \.\. \(.*\) - no MCP hint for it$/gm) || []).length, 1, two.outs[1]);
    const none = d2([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
    ]);
    assert.doesNotMatch(none.outs[1], /!! workspace: .*\.claude\.json|^(==>)?\s*mcp /m, none.outs[1]);
});

test('D8: no output names an entry\'s JSON or a value', POSIX_ONLY, () =>
{
    const TOKEN = 'tok-d8-0123456789abcdef';
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: { type: 'stdio', command: 'node', args: ['secret-arg.js'], env: { API_TOKEN: TOKEN } } }); } },
        { at: 'api' },
        cli('status', { at: 'api' }),
    ]);
    assert.strictEqual(hintsIn(r.outs[1]).length, 1, r.outs[1]);
    for (const out of [r.outs[1], r.outs[2]])
        for (const bit of [TOKEN, 'secret-arg.js', '"command"', 'API_TOKEN']) assert.ok(!out.includes(bit), `the output holds ${bit}:\n${out}`);
});

test('D8: status prints the hint lines', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { srv: SRV }); } },
        { at: 'api' },
        cli('status', { at: 'api' }),
    ]);
    assert.deepStrictEqual(hintsIn(r.outs[2]), [HINT('srv', '..')], r.outs[2]);
});

test('D8: an install with workspace-mcp rows drops them and the state file, leaves the account file byte-identical and names the kept registrations in one line', POSIX_ONLY, () =>
{
    let before = null;
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV, b: SRV }); } },
        { at: 'api', after: (work) => { putLocal(work, 'api', { a: SRV, b: SRV }); writeCopies(work, 'api', ['a', 'b']); before = fs.readFileSync(accountOf(work)); return mcpState(work); } },
        update('api', { after: (work) => ({ ...mcpState(work), account: fs.readFileSync(accountOf(work)).equals(before) }) }),
        update('api', { after: mcpState }),
    ]);
    assert.ok(r.steps[1].rows && r.steps[1].state, 'the older record is in place');
    const got = r.steps[2];
    assert.strictEqual(got.rows, null, r.outs[2]);
    assert.strictEqual(got.state, null, r.outs[2]);
    assert.ok(got.account, 'the account file is byte-identical');
    assert.deepStrictEqual(Object.keys(got.local).sort(), ['a', 'b'], 'the registrations stay');
    assert.deepStrictEqual(got.calls, [], 'no claude mcp call');
    assert.strictEqual((r.outs[2].match(/workspace: the MCP registrations an earlier release copied here \(a, b\) are kept as yours/g) || []).length, 1, r.outs[2]);
    assert.deepStrictEqual(hintsIn(r.outs[2]), [], 'a server registered here is not hinted');
    assert.doesNotMatch(r.outs[3], /earlier release copied here/, 'a second update says nothing more');
});

test('D8: with the switch at 0 nothing is hinted and the rows stay as recorded', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV, c: SRV }); } },
        { at: 'api', after: (work) => { putLocal(work, 'api', { a: SRV }); writeCopies(work, 'api', ['a']); return mcpState(work); } },
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, after: mcpState }),
    ]);
    assert.deepStrictEqual(hintsIn(r.outs[2]), [], r.outs[2]);
    assert.deepStrictEqual([r.steps[2].rows, r.steps[2].state], [r.steps[1].rows, r.steps[1].state]);
});

test('D8: uninstall in a child with workspace-mcp rows removes no registration and names them; at the root it strips the children\'s rows', POSIX_ONLY, () =>
{
    const child = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: (work) => { putLocal(work, 'api', { a: SRV }); writeCopies(work, 'api', ['a']); } },
        { at: 'api', act: 'uninstall', after: (work) => ({ ...mcpState(work), stamp: fs.existsSync(path.join(at(work, 'api'), '.claude', 'alfred-code.stamp')) }) },
    ]);
    const got = child.steps[2];
    assert.deepStrictEqual(got.calls, [], child.outs[2]);
    assert.deepStrictEqual(Object.keys(got.local), ['a'], 'the registration stays as the user\'s');
    assert.match(child.outs[2], /workspace: the MCP registrations an earlier release copied here \(a\) are kept as yours/);
    assert.strictEqual(got.state, null, 'the state file goes');
    assert.strictEqual(got.stamp, false, child.outs[2]);
    const root = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: (work) => { putLocal(work, 'api', { a: SRV }); writeCopies(work, 'api', ['a']); return mcpState(work); } },
        { at: '.', act: 'uninstall', after: mcpState },
    ]);
    assert.ok(root.steps[1].rows, root.outs[1]);
    assert.strictEqual(root.steps[2].rows, null, root.outs[2]);
    assert.deepStrictEqual(root.steps[2].local, root.steps[1].local, 'the copies stay as the user\'s own');
    assert.deepStrictEqual(root.steps[2].calls, [], root.outs[2]);
});

test('D2: ignore mcp for a parent .mcp.json server writes a disabledMcpjsonServers member, ledgered, and removes it when lifted', POSIX_ONLY, () =>
{
    const disabledOf = (work) => (json(path.join(at(work, 'api'), '.claude', 'settings.local.json')) || {}).disabledMcpjsonServers;
    const settingsRows = (work) => lineOf(stampOf(work, 'api'), 'managed-settings') || '';
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); fs.writeFileSync(path.join(at(work), '.mcp.json'), `${JSON.stringify({ mcpServers: { shared: { command: 'node', args: ['s.js'] } } }, null, 2)}\n`); } },
        { at: 'api', after: disabledOf },
        update('api', { before: (work) => edit(work, 'api', (m) => wsLib.addIgnore(m, 'mcp', 'shared')), after: (work) => ({ disabled: disabledOf(work), rows: settingsRows(work), excludes: excludesOf(work, 'api').length }) }),
        update('api', { before: (work) => edit(work, 'api', (m) => wsLib.removeIgnore(m, 'mcp', 'shared')), after: (work) => ({ disabled: disabledOf(work), rows: settingsRows(work), excludes: excludesOf(work, 'api').length }) }),
    ]);
    const h = stampLib.valueHash('shared');
    assert.strictEqual(r.steps[1], undefined, 'nothing is disabled before the ignore line');
    assert.deepStrictEqual(r.steps[2].disabled, ['shared'], r.outs[2]);
    assert.ok(r.steps[2].rows.includes(`settings.local.json:disabledMcpjsonServers[${h}]=${h}`), r.steps[2].rows);
    assert.ok(r.steps[2].excludes > 0, 'the excludes rows stay beside it');
    assert.strictEqual(r.steps[3].disabled, undefined, r.outs[3]);
    assert.ok(!r.steps[3].rows.includes('disabledMcpjsonServers'), r.steps[3].rows);
    assert.strictEqual(r.steps[3].excludes, r.steps[2].excludes);
});

// ---- release 3, T3: a child reads its ancestors' docs roots; their docs and memory are read-only (R2, R8) -----------
const localSettingsOf = (work, rel) => json(path.join(at(work, rel), '.claude', 'settings.local.json')) || {};
// Mode v2 stage 2: settings.local.json holds the stack's secret-file and seat denies at project scope too; the rows these
// cases are about are the additional directories and the Edit denies, so the deny list is read as those alone.
const permsOf = (work, rel) =>
{
    const perms = { ...(localSettingsOf(work, rel).permissions || {}) };
    if (Array.isArray(perms.deny)) perms.deny = perms.deny.filter((d) => d.startsWith('Edit('));
    if (Array.isArray(perms.deny) && !perms.deny.length) delete perms.deny;
    return perms;
};
const ledgerRowsOf = (work, rel, arrayPath) => Object.keys((stampLib.readLedger(path.join(at(work, rel), '.claude', 'alfred-code.stamp')) || { settings: {} }).settings?.['settings.local.json'] || {})
    .filter((r) => r.startsWith(`${arrayPath}[`));
const denyFor = (p) => wsLib.editDenyRule(p, process.platform);
const docsOf = (work, rel) => layoutLib.docsRootOf(fs.realpathSync(at(work, rel)), { env: acct(work) });
const memOf = (work, rel) => layoutLib.memoryDirsOf(fs.realpathSync(at(work, rel)), { env: acct(work), home: work });

test('editDenyRule writes the POSIX form the permissions docs give, //c/ on win32', () =>
{
    assert.strictEqual(wsLib.editDenyRule('/x/my docs', 'linux'), 'Edit(//x/my docs/**)');
    assert.strictEqual(wsLib.editDenyRule('C:\\Users\\a b\\docs\\', 'win32'), 'Edit(//c/Users/a b/docs/**)');
    assert.strictEqual(wsLib.editDenyRule('d:\\w', 'win32'), 'Edit(//d/w/**)');
});

// ancestorAccess alone, on a bare tree: `local` maps a folder to its settings.local.json object.
const accessTree = (local) =>
{
    const work = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ws-access-')));
    for (const rel of ['.', 'api']) fs.mkdirSync(at(work, rel), { recursive: true });
    for (const [rel, o] of Object.entries(local))
    {
        fs.mkdirSync(path.join(at(work, rel), '.claude'), { recursive: true });
        fs.writeFileSync(path.join(at(work, rel), '.claude', 'settings.local.json'), JSON.stringify(o));
    }
    const env = acct(work);
    const access = wsLib.ancestorAccess({ projectRoot: at(work, 'api'), env }, { ignores: [], members: [{ root: at(work), dataRoot: '.alfred', view: { ignores: [] } }] });
    fs.rmSync(work, { recursive: true, force: true });
    return { work, access, covers: (file) => access.deny.some((rule) => (file + '/').startsWith(rule.slice('Edit(/'.length, -'**)'.length))) };
};

test('ancestorAccess never denies a folder holding the child\'s own memory, its project or its docs root; a relative autoMemoryDirectory is not read', POSIX_ONLY, () =>
{
    const nested = accessTree({ '.': { autoMemoryDirectory: '/m/ws' }, 'api': { autoMemoryDirectory: '/m/ws/api' } });
    assert.ok(!nested.covers('/m/ws/api/MEMORY.md'), `the child's own nested memory: ${nested.access.deny}`);
    assert.strictEqual(nested.access.deny.length, 1, 'the docs root keeps its row');
    const dot = accessTree({ '.': { autoMemoryDirectory: '.' } });
    assert.ok(!dot.covers(path.join(at(dot.work, 'api'), 'src', 'a.ts')), `a relative value: ${dot.access.deny}`);
    assert.ok(dot.access.deny.includes(denyFor(path.join(dot.work, 'acct', 'projects', at(dot.work).replace(/[^A-Za-z0-9]/g, '-'), 'memory'))), `the default folder instead: ${dot.access.deny}`);
    const docs = accessTree({ '.': { env: { ALFRED_CODE_DOCS_PATH: '.' } } });
    assert.deepStrictEqual(docs.access.dirs, [], 'a docs root holding the child is no additional directory');
    assert.ok(!docs.covers(path.join(at(docs.work, 'api'), 'src', 'a.ts')), `a docs root holding the child: ${docs.access.deny}`);
    const whole = accessTree({ '.': { autoMemoryDirectory: '/' } });
    assert.ok(!whole.covers(path.join(at(whole.work, 'api'), 'src', 'a.ts')), `an absolute folder above the child: ${whole.access.deny}`);
});

test('a child gets each linked ancestor\'s docs root and an Edit deny row for it and its memory folder, ledgered per member; the excludes stay beside them; a second run changes nothing', POSIX_ONLY, () =>
{
    const read = (work) => ({ perms: permsOf(work, 'api'), excludes: excludesOf(work, 'api').length, dirs: ledgerRowsOf(work, 'api', 'permissions.additionalDirectories').length,
        deny: ledgerRowsOf(work, 'api', 'permissions.deny').length, ex: ledgerRowsOf(work, 'api', 'claudeMdExcludes').length, docs: docsOf(work, '.'), mem: memOf(work, '.'), hash: treeHash(at(work, 'api')) });
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: read },
        update('api', { after: read }),
        update('api', { after: read }),
        { at: 'web', after: (work) => ({ perms: permsOf(work, 'web') }) },
    ]);
    const got = r.steps[1];
    assert.deepStrictEqual(got.perms.additionalDirectories, [got.docs], r.outs[1]);
    assert.strictEqual(got.mem.length, 1);
    assert.deepStrictEqual([...got.perms.deny].sort(), [denyFor(got.docs), denyFor(got.mem[0])].sort());
    assert.deepStrictEqual([got.dirs, got.deny], [1, 2], 'one ledger row per member');
    assert.ok(got.excludes > 0 && got.ex === got.excludes, 'the claudeMdExcludes rows survive beside them');
    assert.deepStrictEqual(r.steps[2].perms, got.perms, 'the update keeps them');
    assert.strictEqual(r.steps[3].hash, r.steps[2].hash, 'a second update changes nothing');
    assert.deepStrictEqual(r.steps[4].perms, {}, 'a project with no parent gets none');
});

test('ignore docs root drops the docs row and its deny, the memory deny stays; a moved docs root swaps its rows', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
        // a leftover key the root's own update would retire: set where only the child's run reads it
        update('api', { before: (work) => setEnv(work, '.', 'settings.local.json', { ALFRED_CODE_DOCS_PATH: 'moved/docs' }), after: (work) => ({ perms: permsOf(work, 'api'), docs: docsOf(work, '.'), mem: memOf(work, '.') }) }),
        update('api', { before: (work) => edit(work, 'api', (m) => wsLib.addIgnore(m, 'docs', 'root')), after: (work) => ({ perms: permsOf(work, 'api'), mem: memOf(work, '.'), dirs: ledgerRowsOf(work, 'api', 'permissions.additionalDirectories') }) }),
    ]);
    const moved = r.steps[2];
    assert.ok(moved.docs.endsWith(path.join('moved', 'docs')));
    assert.deepStrictEqual(moved.perms.additionalDirectories, [moved.docs], r.outs[2]);
    assert.ok(moved.perms.deny.includes(denyFor(moved.docs)) && !moved.perms.deny.some((d) => d.includes('/.alfred/docs')), 'the old row is removed, the new one written');
    const ignored = r.steps[3];
    assert.strictEqual(ignored.perms.additionalDirectories, undefined, r.outs[3]);
    assert.deepStrictEqual(ignored.perms.deny, [denyFor(ignored.mem[0])]);
    assert.deepStrictEqual(ignored.dirs, []);
});

test('a user\'s own additionalDirectories entry and deny rule are never claimed and survive install, update and uninstall; uninstall removes the stack\'s rows; the kill switch keeps them', POSIX_ONLY, () =>
{
    let mine;
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', before: (work) =>
        {
            const docs = fs.realpathSync(path.join(at(work), '.alfred')) + `${path.sep}docs`;
            mine = { additionalDirectories: ['/mine'], deny: ['Edit(//x/**)', denyFor(docs)] };
            fs.mkdirSync(path.join(at(work, 'api'), '.claude'), { recursive: true });
            fs.writeFileSync(path.join(at(work, 'api'), '.claude', 'settings.local.json'), JSON.stringify({ permissions: mine }, null, 2));
        }, after: (work) => ({ perms: permsOf(work, 'api'), deny: ledgerRowsOf(work, 'api', 'permissions.deny').length }) },
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, after: (work) => ({ perms: permsOf(work, 'api') }) }),
        { at: 'api', act: 'uninstall', after: (work) => ({ perms: permsOf(work, 'api') }) },
    ]);
    const inst = r.steps[1].perms;
    assert.ok(inst.additionalDirectories.includes('/mine') && inst.deny.includes('Edit(//x/**)'), r.outs[1]);
    assert.strictEqual(r.steps[1].deny, 1, 'the user\'s copy of the docs deny is not claimed - only the memory deny is the stack\'s');
    assert.deepStrictEqual(r.steps[2].perms, inst, 'frozen: the rows stay');
    const after = r.steps[3].perms;
    assert.deepStrictEqual(after.additionalDirectories, ['/mine'], r.outs[3]);
    assert.deepStrictEqual(after.deny, mine.deny, 'the user\'s rules survive; the stack\'s memory deny goes');
});

test('a memory folder equal to the child\'s own gets no deny row', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', before: (work) => { fs.mkdirSync(path.join(work, 'acct'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '~/shared-mem' })); }, after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => ({ perms: permsOf(work, 'api'), docs: docsOf(work, '.') }) },
    ]);
    assert.deepStrictEqual(r.steps[1].perms.deny, [denyFor(r.steps[1].docs)], r.outs[1]);
});

// ------------------------------------------------------------------ refreshBelow (2026-11-10, spec section 4)
// The user's report: a child session loaded the root's rules twice. Each project's own run writes excludes for every
// stamped folder above it, so the duplicates came only from a child installed before its root, or a rule the root added
// later - until that child's own next run. The root's install or update now brings that write forward for every stamped
// project below, against each project's OWN ledger.
{
    const settingsOf = (work, rel) => readOr(path.join(at(work, rel), '.claude', 'settings.local.json'));
    const claudeHash = (work, rel) => treeHash(path.join(at(work, rel), '.claude'));
    const ledgerRows = (work, rel) => (lineOf(stampOf(work, rel), 'managed-settings') || '').split(',').filter(Boolean);
    const HAND = '/somewhere/else/CLAUDE.md';
    const NEW_RULE = 'rule sql-conventions';
    const created = (out) => (out.match(/!! settings\.local\.json: created/g) || []).length;

    test('refreshBelow: children installed first get the root\'s excludes, a new root rule, a re-run and the child\'s own update (spec 4)', POSIX_ONLY, () =>
    {
        const keep = {};
        const r = scenario([
            { at: 'api/tool' },
            { at: 'api' },
            { at: 'web', before: (work) => fs.writeFileSync(path.join(at(work, 'web'), '.gitignore'), '.claude/settings.local.json\n') },
            { at: '.', before: (work) =>
            {
                const f = path.join(at(work, 'api'), '.claude', 'settings.local.json');
                const data = json(f) || {};
                data.claudeMdExcludes = [...(data.claudeMdExcludes || []), HAND];
                fs.writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
                plantGen(work, '.');
            }, after: (work) => ({
                want: ruleGlobs(work, '.'), api: excludesOf(work, 'api'), tool: excludesOf(work, 'api/tool'), web: excludesOf(work, 'web'),
                rows: ledgerRows(work, 'api'),
            }) },
            update('.', { args: ['--add', NEW_RULE], before: (work) => plantGen(work, '.', 'alfred-architecture'), after: (work) => { keep.api = claudeHash(work, 'api'); keep.tool = claudeHash(work, 'api/tool'); return { want: ruleGlobs(work, '.'), api: excludesOf(work, 'api') }; } }),
            update('.', { after: (work) => ({ api: claudeHash(work, 'api') === keep.api, tool: claudeHash(work, 'api/tool') === keep.tool }) }),
            update('api', { after: (work) => ({ api: excludesOf(work, 'api'), rows: ledgerRows(work, 'api') }) }),
            update('.', { before: (work) => { keep.plan = claudeHash(work, 'api'); }, args: (work) => ['--print-plan', '--plan-out', path.join(work, 'plan.json')],
                after: (work) => ({ api: claudeHash(work, 'api') === keep.plan }) }),
        ]);
        const root = r.steps[3];
        assert.ok(root.want.length > 0, 'the root holds a generated rule');
        for (const [rel, list] of [['api', root.api], ['api/tool', root.tool], ['web', root.web]])
            for (const g of root.want) assert.ok(list.includes(g), `${rel}: no exclude for ${g}\n${r.outs[3]}`);
        assert.ok(root.api.includes(HAND), 'the hand-added member is kept');
        const glob = (g) => `settings.local.json:claudeMdExcludes[`;
        assert.ok(root.rows.some((row) => row.startsWith(glob())), 'the child\'s stamp ledgers the rows');
        assert.strictEqual(root.rows.filter((row) => row.startsWith(glob())).length, root.api.length - 1, 'every stack member ledgered, the hand one not');
        assert.match(r.outs[3], /workspace: api - excludes refreshed \(\d+ rules\)/);
        assert.match(r.outs[3], /workspace: api\/tool - excludes refreshed \(\d+ rules\)/);
        assert.match(r.outs[1], /workspace: tool - excludes refreshed/, 'api is a root over tool too');
        assert.strictEqual(created(r.outs[1]), 1, 'api\'s install made tool\'s file, in a repo that does not ignore it');
        assert.strictEqual(created(r.outs[3]), 0, 'the root made only web\'s file, and web ignores it (api\'s was there already)');
        assert.strictEqual(r.steps[3].web.length > 0, true, 'web got the file');
        const added = r.steps[4];
        assert.ok(added.want.length > root.want.length, `the update added a rule\n${r.outs[4]}`);
        for (const g of added.want) assert.ok(added.api.includes(g), `the new rule's glob reached the child: ${g}\n${r.outs[4]}`);
        assert.deepStrictEqual(r.steps[5], { api: true, tool: true }, 'a re-run changes no byte below');
        assert.match(r.outs[5], /workspace: api - excludes current/);
        const own = r.steps[6];
        assert.strictEqual(new Set(own.api).size, own.api.length, 'no duplicate member after the child\'s own update');
        assert.deepStrictEqual([...own.api].sort(), [...added.api].sort(), 'the child\'s own update keeps the same set');
        assert.doesNotMatch(r.outs[6], /!!/, r.outs[6]);
        assert.strictEqual(r.steps[7].api, true, '--print-plan writes nothing below');
    });

    test('refreshBelow: a switched-off child, a locked one, a garbage settings file and a garbage workspace record are left as they are (spec 4)', POSIX_ONLY, () =>
    {
        const keep = {};
        const lock = (work) => path.join(at(work, 'web'), '.alfred', 'workspace.lock');
        const rels = ['api', 'web', 'api/tool', 'cli'];
        const r = scenario([
            { at: 'api/tool' },
            { at: 'api' },
            { at: 'web' },
            { at: 'cli' },
            { at: '.', before: (work) =>
            {
                setEnv(work, 'api', 'settings.local.json', { ALFRED_CODE_WORKSPACE: '0' });
                fs.mkdirSync(path.dirname(lock(work)), { recursive: true });
                fs.writeFileSync(lock(work), '');
                fs.writeFileSync(path.join(at(work, 'api/tool'), '.claude', 'settings.local.json'), '{ not json');
                // review I5: a child whose own workspace.json is garbage - its ignores cannot be read, so nothing is written there
                fs.mkdirSync(path.join(at(work, 'cli'), '.alfred'), { recursive: true });
                fs.writeFileSync(path.join(at(work, 'cli'), '.alfred', 'workspace.json'), '{');
                for (const rel of rels) keep[rel] = claudeHash(work, rel);
            }, after: (work) =>
            {
                fs.rmSync(lock(work), { force: true });
                return Object.fromEntries(rels.map((rel) => [rel, claudeHash(work, rel) === keep[rel]]));
            } },
        ], { prepare: (work) => { fs.mkdirSync(at(work, 'cli'), { recursive: true }); rt.execCommand('git', ['init', '-q', at(work, 'cli')]); } });
        assert.deepStrictEqual(r.steps[4], { api: true, web: true, 'api/tool': true, cli: true }, r.outs[4]);
        assert.match(r.outs[4], /!! workspace: web is locked/);
        assert.match(r.outs[4], /!! .*api\/tool/, 'the unreadable settings file is named');
        assert.doesNotMatch(r.outs[4], /workspace: api - excludes/, 'the switched-off child is not touched');
        assert.ok(r.outs[4].includes(GARBAGE_LINE('cli/.alfred/workspace.json')), r.outs[4]);
        assert.doesNotMatch(r.outs[4], /workspace: cli - excludes/, 'the garbage child is not touched');
    });

    test('refreshBelow: a stamp that cannot be written leaves the child\'s settings as they were (spec 4)', { ...POSIX_ONLY, skip: POSIX_ONLY.skip || (process.getuid?.() === 0 && 'root writes through the mode bits') }, () =>
    {
        // Mode v2 stage 2: the child's own install wrote the stack's rows into settings.local.json at project scope, so the
        // file exists before the root's run - the rows refreshBelow added are taken out again and the bytes come back.
        const stampFile = (work) => path.join(at(work, 'api'), '.claude', 'alfred-code.stamp');
        let before = null;
        const r = scenario([
            { at: 'api' },
            { at: '.', before: (work) => { before = settingsOf(work, 'api'); fs.chmodSync(stampFile(work), 0o444); }, after: (work) =>
            {
                fs.chmodSync(stampFile(work), 0o644);
                return { settings: settingsOf(work, 'api'), rows: ledgerRows(work, 'api').filter((row) => row.includes('claudeMdExcludes')).length };
            } },
        ]);
        assert.ok(before !== null, 'setup: the child\'s install wrote settings.local.json');
        assert.strictEqual(r.steps[1].settings, before, 'the child\'s settings.local.json is as it was');
        assert.strictEqual(r.steps[1].rows, 0);
        assert.match(r.outs[1], /!! workspace: api/);
    });

    test('refreshBelow: every other ledger row comes back byte for byte (spec 4)', POSIX_ONLY, () =>
    {
        const { memberRow } = require('./install/settings.js');
        const deny = 'Edit(//elsewhere/**)';
        const dir = '/elsewhere';
        const extra = [`settings.json:modelSettings.claude-opus-5-5.autoCompactWindow=${'a'.repeat(64)}`,
            `settings.local.json:${memberRow('permissions.deny', deny).replace(/\[(.*)\]$/, '[$1]')}=${memberRow('permissions.deny', deny).slice(-65, -1)}`,
            `settings.local.json:${memberRow('permissions.additionalDirectories', dir)}=${memberRow('permissions.additionalDirectories', dir).slice(-65, -1)}`];
        const r = scenario([
            { at: 'api' },
            { at: '.', before: (work) =>
            {
                const f = path.join(at(work, 'api'), '.claude', 'settings.local.json');
                fs.writeFileSync(f, `${JSON.stringify({ permissions: { deny: [deny], additionalDirectories: [dir] } }, null, 2)}\n`);
                const s = path.join(at(work, 'api'), '.claude', 'alfred-code.stamp');
                const line = lineOf(stampOf(work, 'api'), 'managed-settings') || '';
                stampLib.markLine(s, 'managed-settings', [line, ...extra].filter(Boolean).join(','));
            }, after: (work) => ({ rows: ledgerRows(work, 'api') }) },
        ]);
        for (const row of extra) assert.ok(r.steps[1].rows.includes(row), `kept: ${row}\n${r.steps[1].rows.join('\n')}`);
        assert.ok(r.steps[1].rows.some((row) => row.startsWith('settings.local.json:claudeMdExcludes[')), r.outs[1]);
    });
}

// ------------------------------------------------------------------ workspace.json: the conversion and a garbage record

const jsonAt = (work, rel) => path.join(at(work, rel), '.alfred', 'workspace.json');
const oldAt = (work, rel) => path.join(at(work, rel), '.alfred', 'workspace');
// The record made garbage by hand: the old file gone, workspace.json no valid JSON.
const garble = (work, rel) => { fs.rmSync(oldAt(work, rel), { force: true }); fs.mkdirSync(path.dirname(jsonAt(work, rel)), { recursive: true }); fs.writeFileSync(jsonAt(work, rel), '{"children": ["api"],'); };
const GARBAGE_LINE = (rel) => `!! workspace: ${rel} is not valid JSON - fix it by hand; the workspace pass neither reads nor writes it until then`;

test('install converts an old file before the workspace pass, and --print-plan does not', POSIX_ONLY, () =>
{
    const r = scenario([
        // the old file's text is the subject: a comment the conversion names - the workspace pass, reading it after, names nothing
        { at: '.', after: (work) => { putWorkspace(at(work), { children: ['api'] }, { legacy: true }); fs.mkdirSync(path.dirname(oldAt(work, 'api')), { recursive: true }); fs.writeFileSync(oldAt(work, 'api'), 'parent ..\n# hand note\n'); } },
        { at: 'api', after: (work) => ({ json: fs.existsSync(jsonAt(work, 'api')), old: fs.existsSync(oldAt(work, 'api')), members: layoutLib.workspaceChain(fs.realpathSync.native(at(work, 'api')), { env: acct(work) }).members.length }) },
        { ...planStep('plan.json'), after: (work) => ({ json: fs.existsSync(jsonAt(work, '.')), old: fs.existsSync(oldAt(work, '.')) }) },
        update('.', { after: (work) => ({ json: fs.existsSync(jsonAt(work, '.')), old: fs.existsSync(oldAt(work, '.')), values: readWorkspaceValues(at(work)) }) }),
    ]);
    const line = 'workspace: .alfred/workspace converted to workspace.json - restart any session open in this project since before this run';
    assert.deepStrictEqual(r.steps[1], { json: true, old: false, members: 1 }, r.outs[1]);
    assert.ok(r.outs[1].includes("workspace: .alfred/workspace converted to workspace.json (comment '# hand note' not carried into workspace.json) - restart any session open in this project since before this run"), r.outs[1]);
    assert.doesNotMatch(r.outs[1], /!! workspace: \.alfred\/workspace(\.json)?: comment/, 'the workspace pass read the converted record');
    assert.deepStrictEqual(r.steps[2], { json: false, old: true }, r.outs[2]);
    assert.ok(!r.outs[2].includes('converted to workspace.json'), r.outs[2]);
    assert.deepStrictEqual(r.steps[3], { json: true, old: false, values: { children: ['api'] } }, r.outs[3]);
    assert.ok(r.outs[3].includes(line), r.outs[3]);
});

test('the run\'s own garbage record freezes the workspace part of an update', POSIX_ONLY, () =>
{
    const snap = (work) => ({
        env: envOf(work, 'api'), vars: readOr(path.join(at(work, 'api'), '.alfred', '.variables')),
        own: lineOf(stampOf(work, 'api'), 'own-picks'), ownEnv: lineOf(stampOf(work, 'api'), 'own-env'), x: hasSkill(work, 'api', X),
    });
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n` },
        update('.', { args: ['--add', `skill ${X}`], after: (work) => { const s = snap(work); garble(work, 'api'); return s; } }),
        update('api', { after: (work) => ({ ...snap(work), json: readOr(jsonAt(work, 'api')) }) }),
    ]);
    const before = r.steps[2];
    const after = r.steps[3];
    assert.strictEqual(after.json, '{"children": ["api"],', 'the garbage record is left byte for byte');
    assert.strictEqual(after.x, false, `nothing inherited is added:\n${r.outs[3]}`);
    assert.deepStrictEqual(after.env, before.env, r.outs[3]);
    assert.strictEqual(after.vars, before.vars, r.outs[3]);
    assert.strictEqual(after.own, before.own, r.outs[3]);
    assert.strictEqual(after.ownEnv, before.ownEnv, r.outs[3]);
    assert.strictEqual(r.outs[3].split('\n').filter((l) => l.replace(/^==>\s*/, '').trim() === GARBAGE_LINE('.alfred/workspace.json')).length, 1, r.outs[3]);
    assert.doesNotMatch(r.outs[3], /workspace: from \.\. - /);
});

test('uninstall refuses before any change over a garbage workspace record', POSIX_ONLY, () =>
{
    const refusal = (rel) => `error: ${rel} is not valid JSON - the workspace links it records cannot be released; nothing was removed - fix it by hand, then run uninstall again`;
    const snapOf = (work) => `${tree(work, '.')}\n${tree(work, 'api')}`;
    const fix = (work, rel) => { fs.rmSync(jsonAt(work, rel), { force: true }); putWorkspace(at(work, rel), rel === '.' ? { children: ['api'] } : { parent: '..' }, { legacy: false }); };
    for (const [where, garbled, named] of [['.', '.', '.alfred/workspace.json'], ['api', '.', '../.alfred/workspace.json'], ['.', 'api', 'api/.alfred/workspace.json']])
    {
        const label = `uninstall in ${where} over ${garbled}'s garbage record`;
        const r = scenario([
            { at: '.', after: (work) => join(work, 'api') },
            { at: 'api', after: (work) => { garble(work, garbled); return snapOf(work); } },
            { at: where, act: 'uninstall', after: (work) => { const s = snapOf(work); fix(work, garbled); return s; } },
            { at: where, act: 'uninstall', after: (work) => ({ root: readWorkspaceValues(at(work)), api: readWorkspaceValues(at(work, 'api')) }) },
        ], { failOk: true });
        assert.strictEqual(r.codes[2], 1, `${label}:\n${r.outs[2]}`);
        assert.ok(r.errs[2].includes(refusal(named)), `${label}:\n${r.errs[2]}`);
        assert.strictEqual(r.steps[2], r.steps[1], `${label}: a file changed`);
        // fixed by hand, the next uninstall releases the child
        assert.strictEqual(r.codes[3], 0, `${label}:\n${r.outs[3]}${r.errs[3]}`);
        assert.ok(!(r.steps[3].api || {}).parent, `${label}: api still names its parent\n${r.outs[3]}`);
        assert.ok(!(r.steps[3].root || {}).children, `${label}: the root still lists api\n${r.outs[3]}`);
    }
});

// ------------------------------------------------------------------ the fixed root (2026-11-11)
// A parent an older release left on a custom root R: its folder, the key and the stamp's line name R until its own next
// run moves it. A child's run reads the parent where it is and writes nothing under the parent's `.alfred`.
test('fixed root: a child\'s run reads its parent\'s unmoved folder', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { plantOlderRoot(at(work)); join(work, 'api'); } },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => ({
            own: lineOf(stampOf(work, 'api'), 'own-picks'), js: hasSkill(work, 'api', 'javascript'),
            record: fs.existsSync(path.join(at(work), 'var', 'data', 'workspace.json')), alfred: fs.existsSync(path.join(at(work), '.alfred')),
        }) },
    ]);
    const got = r.steps[1];
    assert.strictEqual(got.own, `skill/${OWN}`, r.outs[1]);
    assert.ok(got.js, 'the parent\'s set reached the child');
    assert.ok(got.record, 'the parent\'s record stays under R');
    assert.strictEqual(got.alfred, false, 'nothing is written under the parent\'s .alfred');
});

// ------------------------------------------------------------------ stage 1: the update's one rewrite of the ignore keys (Section 7)
// refreshBelow called as the update calls it, on a root holding a stamp and a record; a project below is a folder with a
// stamp naming its release. The launch 0 keeps each project below out of the excludes pass, which is not the subject.
{
    const { compareVersions } = require('./install/source.js');
    const HOLD = (rel, version) => `  workspace.json keeps its singular keys: ${rel} is at ${version}`;
    const tree = (t, record) =>
    {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ws-plural-')));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const stamp = (rel, version) =>
        {
            const dir = path.join(root, ...rel.split('/').filter(Boolean), '.claude');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'alfred-code.stamp'), version === null ? 'scope: project\n' : `version: ${version}\nscope: project\n`);
        };
        const file = path.join(root, '.alfred', 'workspace.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
        stamp('', '3.11.0');
        const run = (release) =>
        {
            const lines = [];
            wsLib.refreshBelow({ projectRoot: root, env: { ALFRED_CODE_WORKSPACE: '0' }, log: (l) => lines.push(l), release, compare: compareVersions });
            return lines.filter((l) => l.includes('workspace.json'));
        };
        return { root, file, stamp, run, text: () => fs.readFileSync(file, 'utf8'), json: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
    };

    test('Section 7: an update rewrites singular ignore keys once, and a second run changes nothing', (t) =>
    {
        const w = tree(t, { role: 'root', ignore: { rule: ['a'], env: ['E'] } });
        assert.deepStrictEqual(w.run('3.11.0'), []);
        assert.deepStrictEqual(w.json(), { role: 'root', ignore: { rules: ['a'], env: ['E'] } });
        const after = w.text();
        const then = (Date.now() - 60000) / 1000;
        fs.utimesSync(w.file, then, then);
        const mtime = fs.statSync(w.file).mtimeMs;
        assert.deepStrictEqual(w.run('3.11.0'), []);
        assert.strictEqual(w.text(), after);
        assert.strictEqual(fs.statSync(w.file).mtimeMs, mtime, 'the second run does not write the file');
    });

    test('Section 7: the rewrite is held while a project below is stamped by an older release, the line names it, and it is made once that project is updated', (t) =>
    {
        const w = tree(t, { ignore: { rule: ['a'] } });
        const before = w.text();
        w.stamp('below/api', '3.10.0');
        w.stamp('below/bare', null);
        assert.deepStrictEqual(w.run('3.11.0'), [HOLD('below/api', '3.10.0')]);
        assert.strictEqual(w.text(), before, 'held: the file keeps its bytes');
        w.stamp('below/api', '3.11.0');
        assert.deepStrictEqual(w.run('3.11.0'), [], 'a stamp with no version line holds nothing');
        assert.deepStrictEqual(w.json(), { ignore: { rules: ['a'] } });

        // a tree not yet at PLURAL_SINCE compares with its own release, as JSON_SINCE does
        const early = tree(t, { ignore: { hook: ['h'] } });
        early.stamp('kid', '3.9.2');
        assert.deepStrictEqual(early.run('3.10.0'), [HOLD('kid', '3.9.2')]);
        early.stamp('kid', '3.10.0');
        assert.deepStrictEqual(early.run('3.10.0'), []);
        assert.deepStrictEqual(early.json(), { ignore: { hooks: ['h'] } });
    });

    test('Section 7: no release (an install run), a plural file and a file with no ignore keys are left alone', (t) =>
    {
        for (const [record, release] of [
            [{ ignore: { rule: ['a'] } }, ''],
            [{ ignore: { rules: ['a'] } }, '3.11.0'],
            [{ role: 'root' }, '3.11.0'],
            [{ ignore: { env: ['E'] } }, '3.11.0'],
        ])
        {
            const w = tree(t, record);
            w.stamp('below/api', '3.10.0');
            const before = w.text();
            assert.deepStrictEqual(w.run(release), [], JSON.stringify(record));
            assert.strictEqual(w.text(), before, JSON.stringify(record));
        }
    });
}

// W3 Task 3: the canary is seeded where no stamped folder above sends this project rules - an ignored project is cut off
// from every one above it, so it seeds its own; an unmarked standalone project below a root still seeds none (pinned).
test('canary: an ignored project below a root seeds its own; an unmarked standalone one below a root seeds none', POSIX_ONLY, () =>
{
    const canary = (work, rel) => fs.existsSync(path.join(at(work, rel), '.claude', 'rules', 'alfred-rules.md'));
    const r = scenario([
        { at: '.', after: (work) =>
        {
            edit(work, '.', (m) => wsLib.addIgnoredChild(wsLib.setRole(m, 'root'), 'web'));
            for (const rel of ['web', 'api']) fs.writeFileSync(path.join(at(work, rel), '.gitignore'), '.claude/\n.alfred/\n');
            return { root: canary(work, '.') };
        } },
        { at: 'web', after: (work) => ({ web: canary(work, 'web') }) },
        { at: 'api', after: (work) => ({ api: canary(work, 'api') }) },
    ]);
    assert.strictEqual(r.steps[0].root, true, r.outs[0]);
    assert.strictEqual(r.steps[1].web, true, r.outs[1]);
    assert.strictEqual(r.steps[2].api, false, r.outs[2]);
});

// W3 Task 4: D16's wide rows. `legacy` is a plain folder between the root and the ignored project `legacy/app`.
const putMcpAt = (work, rel, names) => fs.writeFileSync(path.join(at(work, rel), '.mcp.json'),
    `${JSON.stringify({ mcpServers: Object.fromEntries(names.map((n) => [n, { command: 'node', args: [`${n}.js`] }])) }, null, 2)}\n`);
const appTree = (work) => { fs.mkdirSync(at(work, 'legacy/app'), { recursive: true }); rt.execCommand('git', ['init', '-q', at(work, 'legacy/app')]); };
const HAND_ROW = '/my/own/**';

test('an ignored project\'s run writes the wide rows and drops the ancestor rows', POSIX_ONLY, () =>
{
    const read = (work) => ({
        local: json(LOCAL(work, 'legacy/app')) || {}, bytes: readOr(LOCAL(work, 'legacy/app')),
        stamp: stampOf(work, 'legacy/app').replace(/^installed(-ms)?: .*$/gm, ''),
        ex: ledgerRowsOf(work, 'legacy/app', 'claudeMdExcludes'), mcp: ledgerRowsOf(work, 'legacy/app', 'disabledMcpjsonServers'),
        dirs: ledgerRowsOf(work, 'legacy/app', 'permissions.additionalDirectories'), deny: ledgerRowsOf(work, 'legacy/app', 'permissions.deny'),
        want: wsLib.excludeGlobs(['legacy', '.'].flatMap((rel) => wsLib.WIDE.map((n) => path.join(fs.realpathSync.native(at(work, rel)), ...n.split('/').filter(Boolean)) + (n.endsWith('/') ? path.sep : ''))), process.platform),
    });
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'legacy/app'); plantGen(work, '.'); putMcpAt(work, '.', ['rootsrv', 'both']); } },
        { at: 'legacy/app', before: (work) => putMcpAt(work, 'legacy/app', ['both']), after: read },
        update('legacy/app', { before: (work) =>
        {
            edit(work, '.', (m) => wsLib.addIgnoredChild(m, 'legacy/app'));
            const data = json(LOCAL(work, 'legacy/app'));
            data.claudeMdExcludes = [...(data.claudeMdExcludes || []), HAND_ROW];
            fs.writeFileSync(LOCAL(work, 'legacy/app'), `${JSON.stringify(data, null, 2)}\n`);
        }, after: read }),
        update('legacy/app', { after: read }),
    ], { prepare: appTree, account: true });
    const [joined, cut, again] = r.steps.slice(1);
    assert.ok(joined.dirs.length > 0 && joined.deny.length > 0, `the joined child held ancestor rows first:\n${r.outs[1]}`);
    assert.strictEqual(cut.want.length, 12);
    assert.deepStrictEqual(cut.local.claudeMdExcludes.filter((g) => g !== HAND_ROW).sort(), [...cut.want].sort(), r.outs[2]);
    assert.ok(cut.local.claudeMdExcludes.includes(HAND_ROW), 'the hand-added row stays');
    assert.strictEqual(cut.local.claudeMdExcludes.filter((g) => g !== HAND_ROW && /\/\*\*$/.test(g) && /\[rR\]\[uU\]\[lL\]\[eE\]\[sS\]\/\*\*$|rules\/\*\*$/.test(g)).length, 2, 'two rules folders, each as <path>/**');
    assert.strictEqual(cut.ex.length, 12, cut.ex.join('\n'));
    assert.deepStrictEqual(cut.local.disabledMcpjsonServers, ['rootsrv']);
    assert.strictEqual(cut.mcp.length, 1);
    assert.deepStrictEqual([cut.dirs, cut.deny], [[], []], 'no docs-root or memory row for an ancestor');
    assert.strictEqual(((cut.local.permissions || {}).additionalDirectories || []).length, 0);
    assert.deepStrictEqual([again.bytes, again.stamp], [cut.bytes, cut.stamp], 'a second update changes no byte');
});

test('an unmarked joined child and an unmarked standalone project write today\'s rows and no server row', POSIX_ONLY, () =>
{
    // The rows as <BASE> computes them: F3's for every stamped folder above, nothing for a server nobody ignores.
    const base = (work, rel) =>
    {
        const self = fs.realpathSync.native(at(work, rel));
        const anc = wsLib.stampedAncestors(self, { env: acct(work) });
        return [...new Set(wsLib.excludeGlobs(anc.flatMap((root, i) => wsLib.ancestorExcludes(root, { childIgnores: [], nearer: [self, ...anc.slice(0, i)] })), process.platform))].sort();
    };
    const read = (rel) => (work) => ({ local: json(LOCAL(work, rel)) || {}, base: base(work, rel) });
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); plantGen(work, '.'); putMcpAt(work, '.', ['rootsrv']); fs.writeFileSync(path.join(at(work, 'web'), '.gitignore'), '.claude/\n.alfred/\n'); } },
        { at: 'api', after: read('api') },
        { at: 'web', after: read('web') },
    ], { account: true });
    for (const [i, rel] of [[1, 'api'], [2, 'web']])
    {
        const got = r.steps[i];
        assert.ok(got.base.length > 0, rel);
        assert.deepStrictEqual([...(got.local.claudeMdExcludes || [])].sort(), got.base, `${rel}:\n${r.outs[i]}`);
        assert.strictEqual(got.local.disabledMcpjsonServers, undefined, rel);
    }
});

// W3 Task 6: a project the root marks by hand releases itself at its own next update.
const markApi = (work) => edit(work, '.', (m) => wsLib.addIgnoredChild(m, 'api'));
const joinedApi = { at: '.', after: (work) => { join(work, 'api'); plantGen(work, '.'); fs.writeFileSync(path.join(at(work, 'api'), '.gitignore'), '.claude/\n.alfred/\n'); } };
const apiState = (work) =>
{
    const store = path.join(at(work, 'api'), '.alfred', 'stack');
    const stampFile = path.join(at(work, 'api'), '.claude', 'alfred-code.stamp');
    return {
        rec: readOr(path.join(at(work, 'api'), '.alfred', 'workspace.json')),
        stamp: stampOf(work, 'api').replace(/^installed(-ms)?: .*$/gm, ''),
        local: readOr(LOCAL(work, 'api')),
        store: fs.existsSync(store) ? treeHash(store) : '',
        links: lineOf(stampOf(work, 'api'), 'links'),
        inherited: require('./install/links.js').inherited(at(work, 'api'), stampLib.readLinks(stampFile)).length,
        canary: fs.existsSync(path.join(at(work, 'api'), '.claude', 'rules', 'alfred-rules.md')),
        rulesRow: wsLib.excludeGlobs([`${path.join(fs.realpathSync.native(at(work)), '.claude', 'rules')}${path.sep}`], process.platform)[0],
    };
};

test('an ignored project releases itself at its own update', POSIX_ONLY, () =>
{
    const r = scenario([joinedApi, { at: 'api', after: apiState }, update('api', { before: markApi, after: apiState }), update('api', { after: apiState })]);
    const [joined, cut, again] = r.steps.slice(1);
    assert.ok(joined.links && joined.inherited > 0, `the joined child linked from above first:\n${r.outs[1]}`);
    assert.strictEqual(JSON.parse(cut.rec).parent, undefined, r.outs[2]);
    for (const key of ['own-picks', 'own-env', 'workspace-mcp']) assert.strictEqual(lineOf(cut.stamp, key), null, key);
    assert.strictEqual(cut.inherited, 0, 'each link is the project\'s own now');
    assert.match(r.outs[2], /workspace: \.\. ignores this project - /);
    assert.match(r.outs[2], /workspace: released api - /);
    assert.ok(JSON.parse(cut.local).claudeMdExcludes.includes(cut.rulesRow), r.outs[2]);
    assert.strictEqual(cut.canary, true);
    assert.doesNotMatch(r.outs[3], /ignores this project|released api/);
    assert.deepStrictEqual([again.rec, again.stamp, again.local, again.store], [cut.rec, cut.stamp, cut.local, cut.store], 'a second update changes no byte');
});

test('--print-plan releases nothing', POSIX_ONLY, () =>
{
    const r = scenario([joinedApi, { at: 'api', after: apiState },
        update('api', { before: markApi, args: (work) => ['--print-plan', '--plan-out', path.join(work, 'plan.json')], after: apiState })]);
    const [before, after] = r.steps.slice(1);
    assert.deepStrictEqual([after.rec, after.stamp, after.store], [before.rec, before.stamp, before.store], r.outs[2]);
});

test('a release that cannot finish freezes the workspace part', POSIX_ONLY, () =>
{
    const lock = (work) => path.join(at(work, 'api'), '.alfred', 'workspace.lock');
    const r = scenario([joinedApi, { at: 'api', after: apiState },
        update('api', { before: (work) => { markApi(work); fs.writeFileSync(lock(work), 'held\n'); }, after: (work) => { const s = apiState(work); fs.unlinkSync(lock(work)); return s; } }),
        update('api', { after: apiState })]);
    const [before, held, freed] = r.steps.slice(1);
    assert.match(r.outs[2], /api could not be released \(.*\) - run \/alfred-code:update there/);
    assert.strictEqual(JSON.parse(held.rec).parent, '..', 'the parent is still recorded');
    assert.strictEqual(held.links, before.links, 'no link was replaced');
    assert.strictEqual(r.codes[2], 0);
    assert.strictEqual(JSON.parse(freed.rec).parent, undefined, r.outs[3]);
});

test('the switch at 0, and a same-repository entry, release nothing', POSIX_ONLY, () =>
{
    const off = scenario([joinedApi, { at: 'api' },
        update('api', { before: (work) => { markApi(work); setEnv(work, 'api', 'settings.local.json', { ALFRED_CODE_WORKSPACE: '0' }); }, after: apiState })]);
    assert.strictEqual(JSON.parse(off.steps[2].rec).parent, '..', off.outs[2]);
    assert.doesNotMatch(off.outs[2], /released api|ignores this project/);
    assert.ok(!(JSON.parse(off.steps[2].local).claudeMdExcludes || []).includes(off.steps[2].rulesRow));
    const lib = (work) => path.join(at(work), 'lib');
    const same = scenario([
        { at: '.', after: (work) => { fs.mkdirSync(lib(work), { recursive: true }); } },
        { at: 'lib', after: (work) => { edit(work, '.', (m) => wsLib.addIgnoredChild(wsLib.setRole(m, 'root'), 'lib')); } },
        update('lib', { after: (work) => ({ local: json(path.join(lib(work), '.claude', 'settings.local.json')) || {}, rec: readOr(path.join(lib(work), '.alfred', 'workspace.json')) }) }),
    ], { prepare: (work) => rt.execCommand('git', ['init', '-q', at(work)]) });
    assert.ok(!(same.steps[2].local.claudeMdExcludes || []).some((g) => /\/\*\*$/.test(g)), same.outs[2]);
    assert.doesNotMatch(same.outs[2], /released lib|ignores this project/);
});
