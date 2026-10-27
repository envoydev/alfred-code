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
const { seedRun, POSIX_ONLY, releaseExport, skipWithout } = require('./seed-sandbox.js');
const layoutLib = require('../stack/hooks/layout.js');
const variablesLib = require('./install/variables.js');

const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const CLI = path.join(__dirname, 'workspace.js');

const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const X = 'sqlite';   // outside the closure of the root's always rules (markdown-docs pulls markdown-style and docs-as-code)
const OWN = 'npm';
const SC = 'ALFRED_CODE_SCORER';

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
const ruleGlobs = (work, rel) => (lineOf(stampOf(work, rel), 'library-rules') || '').split(',').filter(Boolean).map((e) => e.split('=')[0])
    .map((n) => wsLib.excludeGlobs([path.join(at(work, rel), '.claude', 'rules', `${n}.md`)], process.platform)[0]);
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

// One sandbox, one step per entry: { at, act, sel, args: [] | (work) => [], env, before(work), after(work) }.
function scenario(steps, { plugins = PLUGINS, prepare = () => {}, account = false } = {})
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins, account,
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
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: (work) => ({
            want: ruleGlobs(work, '.'), excludes: excludesOf(work, 'api'), own: lineOf(stampOf(work, 'api'), 'own-picks'),
            js: hasSkill(work, 'api', 'javascript'), npm: hasSkill(work, 'api', OWN),
        }) },
    ]);
    const got = r.steps[1];
    assert.ok(got.want.length > 0, 'the root holds rule copies');
    for (const g of got.want) assert.ok(got.excludes.includes(g), `no exclude for ${g}:\n${got.excludes.join('\n')}`);
    assert.strictEqual(got.own, `skill/${OWN}`, r.outs[1]);
    assert.ok(got.js && got.npm);
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

test('env: the root\'s ALFRED_CODE_SCORER=1 reaches a local-scope child through the chain; configure\'s value stays; ignore env seeds the default (D5)', POSIX_ONLY, () =>
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
    assert.deepStrictEqual(r.steps[4], ['0', '0'], r.outs[4]);
});

// AC14's env half, Review Focus 7: a 2.12.0 tree with the switch at 1 - the root and a local-scope child installed by that
// release, the child holding the root's values as copies and one key of its own - updated by this tree, root first.
test('a 2.12.0 tree with the switch at 1: own-env keys land in the child\'s file, copies leave its settings, the own-env line goes, HOOKS_OFF keeps only the child\'s entries, every effective value unchanged, and the parent\'s guard-ungated-commit:push still stands down there (AC14)', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const oldWs = old && require(path.join(old, 'scripts', 'install', 'workspace.js'));
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
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
            setEnv(work, '.', 'settings.json', { [SC]: '1', [OFF]: 'guard-ungated-commit:push' });
            assert.ok(oldWs.writeWorkspace(at(work, 'api'), (m) => oldWs.setParent(m, '..'), { env: acct(work) }).ok);
            assert.ok(oldWs.writeWorkspace(at(work), (m) => oldWs.addChild(m, 'api'), { env: acct(work) }).ok);
        } },
        { at: 'api', ...OLD, args: local, after: (work) => setEnv(work, 'api', 'settings.local.json', { [LEVEL]: '95', [OFF]: 'guard-ungated-commit:push,docs-session:gate' }) },
        { at: 'api', ...OLD, act: 'update', args: [...local, '--installed-only'], after: api },
        update('.'),
        update('api', { args: local, after: api }),
    ]);
    const [before, after] = [r.steps[2], r.steps[4]];
    assert.strictEqual(before.local[SC], '1', `v2.12.0 copied the root's value: ${r.outs[1]}`);
    assert.strictEqual(before.local[OFF], 'guard-ungated-commit:push,docs-session:gate', r.outs[2]);
    assert.ok(before.ownEnv.split(',').includes(LEVEL), `v2.12.0 recorded the child's own value: ${before.ownEnv}`);
    assert.deepStrictEqual(after.effective, before.effective, r.outs[4]);
    assert.strictEqual(after.vars[LEVEL], '95', 'the own-env key landed in the child\'s file');
    assert.ok(!Object.hasOwn(after.vars, SC), 'a copy never lands in the child\'s file');
    assert.deepStrictEqual(Object.keys(after.local).filter((k) => k.startsWith('ALFRED_CODE_') && k !== 'ALFRED_CODE_DATA_PATH' && k !== OFF), [], JSON.stringify(after.local));
    assert.strictEqual(after.ownEnv, null, 'the own-env line went');
    assert.strictEqual(after.local[OFF], 'docs-session:gate', 'HOOKS_OFF keeps only the child\'s own entries');
    assert.deepStrictEqual(after.off, ['docs-session:gate', 'guard-ungated-commit:push'], 'the root\'s part entry still reaches the child');
});

// D5's leave (AC15): every value the child read through the chain is written into its own file first, so nothing
// changes; with the parent's stamp gone there is no chain to read, the keys that go to the defaults are named, and the
// next update seeds them as a standalone's.
test('AC15: leaving keeps every effective value; with ws deleted the child is seeded as standalone and names the keys that went to defaults', POSIX_ONLY, () =>
{
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from, ws: readOr(path.join(at(work, 'api'), '.alfred', 'workspace')) });
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
    assert.strictEqual(after.ws, 'role standalone\nabove ..\n');

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
    assert.strictEqual(gone.steps[3].ws, 'role standalone\nabove none\n');
    const seeded = gone.steps[4].vars;
    const fresh = Object.keys(seeded).filter((k) => !held.includes(k));
    assert.ok(fresh.length > 0 && fresh.every((k) => defaults.includes(k)), `the update seeded the named keys: ${fresh}`);
    assert.ok(!Object.values(gone.steps[4].from).includes('..'));
});

// AC24: a 2.12.0 standalone below a 3.0.0 root joins - at update by the Recommended answer, and through configure - and
// D5's prune leaves it its typed value and DOCS_VERSIONING only; leaving writes the root's value back into its file.
test('AC24: a 2.12.0 standalone joined at update and through configure reads SCORER_LEVEL=90 from ws, keeps its typed CORRECTION_NUDGE=inject, holds no other seeded key, keeps DOCS_VERSIONING; leaving writes SCORER_LEVEL=90 back', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
    const NUDGE = 'ALFRED_CODE_CORRECTION_NUDGE';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from });
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
        assert.deepStrictEqual(Object.keys(joined.vars).sort(), [NUDGE, 'ALFRED_CODE_DOCS_VERSIONING'].sort(), `${when}: ${JSON.stringify(joined.vars)}`);
        assert.strictEqual(joined.vars[NUDGE], 'inject');
        assert.match(r.outs[4], /^workspace: 2 of this project's values kept as its own \(.*\) - \d+ stack seeds? dropped, so the workspace's value reaches it$/m, r.outs[4]);
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
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
    const NUDGE = 'ALFRED_CODE_CORRECTION_NUDGE';
    const read = (work) => ({ effective: effectiveOf(work, 'api'), vars: varsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from, settings: readOr(path.join(at(work, 'api'), '.claude', 'settings.json')), stamp: stampOf(work, 'api') });
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
    assert.deepStrictEqual(Object.keys(joined.vars).sort(), [NUDGE, 'ALFRED_CODE_DOCS_VERSIONING'].sort(), `${JSON.stringify(joined.vars)}\n${r.outs[4]}`);
    assert.strictEqual(joined.vars[NUDGE], 'inject');
    const left = Object.keys(JSON.parse(joined.settings).env || {}).filter((k) => layoutLib.VARIABLE_KEYS.includes(k));
    assert.deepStrictEqual(left, [], 'no stack value left in settings.json');
    assert.match(r.outs[4], /settings\.json env: ALFRED_CODE_SCORER_LEVEL removed - a stack seed, so the workspace's value reaches this project/);
    assert.deepStrictEqual(again.vars, joined.vars, `a second update changes nothing: ${r.outs[5]}`);
    assert.ok(!/^join-prune:/m.test(joined.stamp), 'the run consumed the join-prune line');
});

// The spec's Migration: a 2.12.0 child registered while the switch was off (2.12's init joined unasked; no own-env line)
// is a project 'with the switch never set' - its update moves every value into its own .variables, nothing pruned.
test('a 2.12.0 child registered with the switch off keeps every value through the update - no join prune without a join', skipWithout('v2.12.0'), () =>
{
    const old = releaseExport('v2.12.0');
    const OLD = old && { seed: path.join(old, 'scripts', 'install', 'alfred-code.js'), source: old };
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
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

// D4 step 5 for Claude Code's own settings: a child whose AUTO_COMPACT and MEMORY come from the root writes the rows a
// project holding them itself would - else its hooks run compact / custom memory while Claude Code does neither.
test('a child reading AUTO_COMPACT=1 and MEMORY=custom from its root gets the autoCompactWindow rows and autoMemoryEnabled false', POSIX_ONLY, () =>
{
    const settingsOf = (work, rel) => json(path.join(at(work, rel), '.claude', 'settings.json')) || {};
    const r = scenario([
        { at: '.', after: (work) => { setVar(work, '.', { ALFRED_CODE_AUTO_COMPACT: '1', ALFRED_CODE_MEMORY: 'custom' }); join(work, 'api'); } },
        { at: 'api', after: (work) => ({ api: settingsOf(work, 'api'), from: layoutLib.variablesOf(at(work, 'api'), { env: acct(work) }).from }) },
        update('api', { after: (work) => ({ api: settingsOf(work, 'api') }) }),
    ]);
    const got = r.steps[1];
    assert.deepStrictEqual([got.from.ALFRED_CODE_AUTO_COMPACT, got.from.ALFRED_CODE_MEMORY], ['..', '..'], 'the child reads both from the root');
    const rows = Object.values(got.api.modelSettings || {}).filter((e) => e && e.autoCompactWindow !== undefined);
    assert.ok(rows.length > 0, `no autoCompactWindow row in the child: ${JSON.stringify(got.api.modelSettings)}\n${r.outs[1]}`);
    assert.strictEqual(got.api.autoMemoryEnabled, false, r.outs[1]);
    assert.deepStrictEqual(r.steps[2].api.modelSettings, got.api.modelSettings, 'an update keeps them');
    assert.strictEqual(r.steps[2].api.autoMemoryEnabled, false);
});

// AC19: on by default, and a launch 0 still freezes - the child reads a chain of one and an install there removes nothing.
test('AC19: a launch 0 in ws/api reads a chain of one and an install there removes nothing', POSIX_ONLY, () =>
{
    const LEVEL = 'ALFRED_CODE_SCORER_LEVEL';
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
        update('.', { args: ['--add', `skill ${X}`], after: (work) => readOr(path.join(at(work), '.alfred', 'workspace')) }),
        update('api', { after: (work) => ({ x: hasSkill(work, 'api', X), root: readOr(path.join(at(work), '.alfred', 'workspace')), own: readOr(path.join(at(work, 'api'), '.alfred', 'workspace')) }) }),
    ]);
    assert.strictEqual(r.steps[3].x, false, r.outs[3]);
    assert.strictEqual(r.steps[3].root, r.steps[2], 'the parent\'s workspace file was written');
    assert.match(r.steps[3].own, /^parent \.\.$/m);
    assert.match(r.outs[3], /!! workspace: parent \.\. in \.alfred\/workspace ignored - \.\. does not list this folder as a child/);
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

test('a parent with an unknown workspace line still yields parentLines', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); fs.appendFileSync(path.join(at(work), '.alfred', 'workspace'), 'frobnicate the tree\n'); } },
        { at: 'api' },
        update('.', { args: ['--add', `skill ${X}`] }),
        { ...planStep('plan.json'), after: (work) => json(path.join(work, 'plan.json')).failures },
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
    ]);
    assert.strictEqual(r.steps[3], 0, r.outs[3]);
    assert.match(r.outs[3], /!! workspace: \.alfred\/workspace line 'frobnicate the tree' is not understood/);
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

test('a data-root move at the root carries its workspace file, and the child\'s chain still finds the root', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api' },
        update('.', { args: ['--data-path', '.ws-data', '--data-move', 'move'], after: (work) => [readOr(path.join(at(work), '.ws-data', 'workspace')), fs.existsSync(path.join(at(work), '.alfred', 'workspace'))] }),
        update('.', { args: ['--add', `skill ${X}`] }),
        update('api', { after: (work) => hasSkill(work, 'api', X) }),
    ]);
    assert.match(r.steps[2][0] || '', /^child api$/m, r.outs[2]);
    assert.strictEqual(r.steps[2][1], false);
    assert.strictEqual(r.steps[4], true, r.outs[4]);
});

test('a joined child that moves its data root and adds an own pick in the same run keeps its chain and records the pick', POSIX_ONLY, () =>
{
    // prepare read the workspace file at the new root before moveWorkspace carried it there: no chain, the own lines
    // carried unchanged, and the pick dropped by the next update's delta (the final review, finding 2).
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n` },
        update('api', { args: ['--data-path', '.kid-data', '--data-move', 'move', '--add', `skill ${X}`], after: (work) => ({
            own: lineOf(stampOf(work, 'api'), 'own-picks'), file: readOr(path.join(at(work, 'api'), '.kid-data', 'workspace')),
        }) }),
        update('api', { after: (work) => ({ x: hasSkill(work, 'api', X), js: hasSkill(work, 'api', 'javascript') }) }),
    ]);
    assert.match(r.steps[2].file || '', /^parent \.\.$/m, r.outs[2]);
    assert.match(r.steps[2].own || '', new RegExp(`skill/${X}`), r.outs[2]);
    assert.deepStrictEqual(r.steps[3], { x: true, js: true }, r.outs[3]);
});

test('a child\'s --drop of an item its parent holds writes the ignore line, so the next update keeps it out; an --add lifts it (validate, a hand-run update)', POSIX_ONLY, () =>
{
    const wsFile = (work) => readOr(path.join(at(work, 'api'), '.alfred', 'workspace'));
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n` },
        update('api', { args: ['--drop', 'skill javascript'], after: (work) => ({ file: wsFile(work), js: hasSkill(work, 'api', 'javascript') }) }),
        update('api', { after: (work) => hasSkill(work, 'api', 'javascript') }),
        update('api', { args: ['--print-plan', '--add', 'skill javascript'], after: (work) => wsFile(work) }),
        update('api', { args: ['--add', 'skill javascript'], after: (work) => ({ file: wsFile(work), js: hasSkill(work, 'api', 'javascript'), own: lineOf(stampOf(work, 'api'), 'own-picks') }) }),
    ]);
    assert.match(r.steps[2].file || '', /^ignore skill javascript$/m, r.outs[2]);
    assert.strictEqual(r.steps[2].js, false);
    assert.strictEqual(r.steps[3], false, `the next update brought it back:\n${r.outs[3]}`);
    assert.match(r.steps[4] || '', /^ignore skill javascript$/m, 'a print-plan writes nothing');
    assert.doesNotMatch(r.steps[5].file || '', /ignore skill javascript/, r.outs[5]);
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

test('a child registered under a chosen data root installs with that root and inherits', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', sel: `${ROOT_SEL}skill ${X}\n`, after: (work) =>
        {
            setVar(work, '.', { [SC]: '1' });
            join(work, 'api', { dataRoot: '.kid-data' });
            edit(work, 'api', (m) => wsLib.addIgnore(m, 'skill', X), '.kid-data');
        } },
        planStep('root.json'),
        { at: 'api', args: (work) => ['--data-path', '.kid-data', '--parent-plan', path.join(work, 'root.json')], after: (work) => ({
            root: lineOf(stampOf(work, 'api'), 'data-root'), file: readOr(path.join(at(work, 'api'), '.kid-data', 'workspace')),
            alfred: fs.existsSync(path.join(at(work, 'api'), '.alfred')), x: hasSkill(work, 'api', X), js: hasSkill(work, 'api', 'javascript'),
            sc: effectiveOf(work, 'api')[SC],
        }) },
    ]);
    const got = r.steps[2];
    assert.strictEqual(got.root, '.kid-data', r.outs[2]);
    assert.doesNotMatch(r.outs[2], /not applied/);
    assert.match(got.file, /^parent \.\.$/m);
    assert.match(got.file, new RegExp(`^ignore skill ${X}$`, 'm'));
    assert.strictEqual(got.alfred, false);
    assert.deepStrictEqual([got.x, got.js, got.sc], [false, true, '1']);
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
        { at: '.', after: (work) => { edit(work, 'web', (m) => wsLib.setParent(m, 'none')); join(work, 'api/tool'); } },
        { at: 'web', after: (work) => ({ want: ruleGlobs(work, '.'), got: excludesOf(work, 'web') }) },
        { at: 'api' },
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
        cli('cascade', { after: (work) => readOr(path.join(at(work), '.alfred', 'workspace')) }),
    ]);
    assert.match(r.outs[3], /^cascade: web\tgone$/m, r.outs[3]);
    assert.match(r.outs[3], /^cascade: api\t(updated|unchanged)$/m, r.outs[3]);
    assert.strictEqual(r.steps[3], 'child api\n');
});

test('cascade applies one project\'s answer and no other\'s', POSIX_ONLY, () =>
{
    // A store an earlier root left behind: the stamp names .old as the data root, and .old holds the secrets file.
    const strand = (work, rel) =>
    {
        const dir = at(work, rel);
        fs.mkdirSync(path.join(dir, '.old'), { recursive: true });
        fs.renameSync(path.join(dir, '.alfred', '.secrets'), path.join(dir, '.old', '.secrets'));
        const file = path.join(dir, '.claude', 'alfred-code.stamp');
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^data-root: .*$/m, 'data-root: .old'));
    };
    const answers = (work) => path.join(work, 'answers.json');
    const has = (work, rel, file) => fs.existsSync(path.join(at(work, rel), ...file.split('/')));
    const r = scenario([
        { at: '.', after: (work) => { join(work, 'api'); join(work, 'web'); } },
        { at: 'api' },
        { at: 'web' },
        update('api'),
        update('web', { after: (work) => { strand(work, 'api'); strand(work, 'web'); } }),
        cli('plan'),
        cli('cascade', {
            before: (work) => fs.writeFileSync(answers(work), JSON.stringify({ web: ['--data-move', 'move'] })),
            args: (work) => ['--answers', answers(work)],
            after: (work) => ({ webMoved: has(work, 'web', '.alfred/.secrets') && !has(work, 'web', '.old/.secrets'), apiStray: has(work, 'api', '.old/.secrets') }),
        }),
    ]);
    const offer = /^ {2}data-move: offer \.alfred\tfrom=\.old\/\.secrets$/;
    const asksOf = (out, rel) => out.split(/^project: /m).find((b) => b.startsWith(`${rel}\t`)).split('\n').slice(1);
    assert.ok(asksOf(r.outs[5], 'api').some((l) => offer.test(l)), r.outs[5]);
    assert.ok(asksOf(r.outs[5], 'web').some((l) => offer.test(l)), r.outs[5]);
    // api had no entry, so its run got no --data-move and its stray store stayed where it was.
    assert.deepStrictEqual(r.steps[6], { webMoved: true, apiStray: true }, r.outs[6]);
});

test('a mid-level parent with an unknown workspace line still cascades', POSIX_ONLY, () =>
{
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', after: (work) => { join(work, 'api/tool', { parent: 'api' }); fs.appendFileSync(path.join(at(work, 'api'), '.alfred', 'workspace'), 'frobnicate x\n'); } },
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
            api: readOr(path.join(at(work, 'api'), '.alfred', 'workspace')), web: readOr(path.join(at(work, 'web'), '.alfred', 'workspace')),
            root: readOr(path.join(at(work), '.alfred', 'workspace')), own: lineOf(stampOf(work, 'api'), 'own-picks'),
            skills: [hasSkill(work, 'api', 'javascript'), hasSkill(work, 'api', OWN), hasSkill(work, 'web', 'javascript')],
            tool: tree(work, 'api/tool'), rootStamp: fs.existsSync(path.join(at(work), '.claude', 'alfred-code.stamp')),
        }) },
        update('api', { after: (work) => ({ excludes: excludesOf(work, 'api'), skills: [hasSkill(work, 'api', 'javascript'), hasSkill(work, 'api', OWN)] }) }),
    ]);
    const got = r.steps[4];
    assert.strictEqual(got.rootStamp, false, r.outs[4]);
    assert.strictEqual(got.api, 'child tool\n', r.outs[4]);
    assert.strictEqual(got.web, '');
    assert.ok(!/^child /m.test(got.root || ''), `the root still lists a child:\n${got.root}`);
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
        { at: 'api', act: 'uninstall', after: (work) => ({ root: readOr(path.join(at(work), '.alfred', 'workspace')), excludes: excludesOf(work, 'api'), key: accountKey(work), parent: readOr(path.join(at(work, 'api'), '.alfred', 'workspace')) }) },
        { at: 'web', act: 'uninstall', after: (work) => ({ root: readOr(path.join(at(work), '.alfred', 'workspace')), key: accountKey(work) }) },
    ]);
    assert.deepStrictEqual(r.steps[2], ['claude-md-and-agents-md', r.steps[2][1]]);
    assert.ok(r.steps[2][1] > 0, 'the child held excludes before');
    const first = r.steps[3];
    assert.strictEqual(first.root, 'child web\n', r.outs[3]);
    assert.deepStrictEqual(first.excludes, [], r.outs[3]);
    assert.ok(!/^parent /m.test(first.parent || ''), r.outs[3]);
    assert.strictEqual(first.key, 'claude-md-and-agents-md', 'another child still records the key');
    assert.match(r.outs[3], /instructionFiles key kept - 1 other project still records it: .*\/ws\/web/, r.outs[3]);
    assert.strictEqual(r.steps[4].root, '', r.outs[4]);
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
