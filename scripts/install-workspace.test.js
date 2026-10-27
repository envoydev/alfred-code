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
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const CLI = path.join(__dirname, 'workspace.js');

const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const X = 'sqlite';   // outside the closure of the root's always rules (markdown-docs pulls markdown-style and docs-as-code)
const OWN = 'npm';
const SC = 'ALFRED_CODE_SCORER';

const at = (work, rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
// The workspace is off until 3.0.0 (the user's answer of 2026-10-27): every case here runs it on, the kill-switch cases at 0.
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct'), ALFRED_CODE_WORKSPACE: '1' });
const readOr = (file, fallback = null) => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stampOf = (work, rel) => readOr(path.join(at(work, rel), '.claude', 'alfred-code.stamp'), '');
const lineOf = (text, key) => { const m = new RegExp(`^${key}: ?(.*)$`, 'm').exec(text); return m ? m[1] : null; };
const hasSkill = (work, rel, name) => fs.existsSync(path.join(at(work, rel), '.claude', 'skills', name, 'SKILL.md'));
const envOf = (work, rel, file = 'settings.json') => ((json(path.join(at(work, rel), '.claude', file)) || {}).env || {});
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

test('env: the root\'s ALFRED_CODE_SCORER=1 lands in a local-scope child; configure\'s value stays; ignore env brings the default back (AC14)', POSIX_ONLY, () =>
{
    const local = ['--scope', 'local'];
    const r = scenario([
        { at: '.', after: (work) => { setEnv(work, '.', 'settings.json', { [SC]: '1' }); join(work, 'api'); join(work, 'web'); } },
        { at: 'api', args: local, after: (work) => envOf(work, 'api', 'settings.local.json')[SC] },
        { at: 'web', args: local, after: (work) => { setEnv(work, 'web', 'settings.local.json', { [SC]: '0' }); edit(work, 'api', (m) => wsLib.addIgnore(m, 'env', SC)); } },
        update('web', { args: local, after: (work) => [envOf(work, 'web', 'settings.local.json')[SC], lineOf(stampOf(work, 'web'), 'own-env')] }),
        update('api', { args: local, after: (work) => envOf(work, 'api', 'settings.local.json')[SC] }),
    ]);
    assert.strictEqual(r.steps[1], '1', r.outs[1]);
    assert.deepStrictEqual(r.steps[3], ['0', SC], r.outs[3]);
    assert.strictEqual(r.steps[4], '0', r.outs[4]);
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
    const keep = (work) => ({ own: lineOf(stampOf(work, 'api'), 'own-picks'), env: lineOf(stampOf(work, 'api'), 'own-env'), ex: excludesOf(work, 'api').length, sc: envOf(work, 'api')[SC], x: hasSkill(work, 'api', X) });
    const r = scenario([
        { at: '.', after: (work) => join(work, 'api') },
        { at: 'api', sel: `${ROOT_SEL}skill ${OWN}\n`, after: keep },
        update('.', { args: ['--add', `skill ${X}`], after: (work) => setEnv(work, '.', 'settings.json', { [SC]: '1' }) }),
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, after: keep }),
    ]);
    assert.ok(r.steps[1].ex > 0);
    assert.deepStrictEqual(r.steps[3], r.steps[1], r.outs[3]);
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
    const state = (work) => [hasSkill(work, 'api', X), envOf(work, 'api')[SC]];
    const r = scenario([
        { at: '.', after: (work) => { setEnv(work, '.', 'settings.json', { [SC]: '1' }); join(work, 'api'); } },
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
            setEnv(work, '.', 'settings.json', { [SC]: '1' });
            join(work, 'api', { dataRoot: '.kid-data' });
            edit(work, 'api', (m) => wsLib.addIgnore(m, 'skill', X), '.kid-data');
        } },
        planStep('root.json'),
        { at: 'api', args: (work) => ['--data-path', '.kid-data', '--parent-plan', path.join(work, 'root.json')], after: (work) => ({
            root: lineOf(stampOf(work, 'api'), 'data-root'), file: readOr(path.join(at(work, 'api'), '.kid-data', 'workspace')),
            alfred: fs.existsSync(path.join(at(work, 'api'), '.alfred')), x: hasSkill(work, 'api', X), js: hasSkill(work, 'api', 'javascript'),
            sc: envOf(work, 'api')[SC],
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
    const lines = (rel) => (work) => ['instructions-both', 'managed-account', 'own-picks', 'own-env'].map((k) => lineOf(stampOf(work, rel), k));
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
        { at: 'web', after: (work) => tree(work, 'api/tool') },
        { at: '.', act: 'uninstall', after: (work) => ({
            api: readOr(path.join(at(work, 'api'), '.alfred', 'workspace')), web: readOr(path.join(at(work, 'web'), '.alfred', 'workspace')),
            root: readOr(path.join(at(work), '.alfred', 'workspace')), own: lineOf(stampOf(work, 'api'), 'own-picks'), ownEnv: lineOf(stampOf(work, 'api'), 'own-env'),
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
    assert.deepStrictEqual([got.own, got.ownEnv], [null, null], 'a released child reads as standalone: every pick its own');
    assert.deepStrictEqual(got.skills, [true, true, true]);
    assert.strictEqual(got.tool, r.steps[3], 'the grandchild kept every file');
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
const runnerOf = (work, rel) => path.join(keyAt(work, rel), '.claude', 'hooks', 'secrets-run.js');
const SRV = { type: 'stdio', command: 'node', args: ['srv.js', '--stdio'], env: { MODE: 'one' } };
const mcpState = (work) => ({ calls: mcpCalls(work), local: localOf(work, 'api'), rows: rowsOf(work, 'api'), state: stateOf(work, 'api') });
const d2 = (steps) => scenario(steps, { account: true });

let fresh;
const freshRun = () => (fresh ||= d2([
    { at: '.', after: (work) =>
    {
        join(work, 'api');
        putLocal(work, '.', {
            srv: SRV,
            run: { type: 'stdio', command: 'node', args: [runnerOf(work, '.'), '--', 'tool', '--stdio'], env: {} },
            'bad.name': SRV,
            rel: { type: 'stdio', command: './bin/server', args: [], env: {} },
            mine: SRV, theirs: SRV, proj: SRV,
        });
        putLocal(work, 'api', { mine: { type: 'stdio', command: 'node', args: ['own.js'], env: {} } });
        putAccount(work, (d) => { d.mcpServers = { theirs: { type: 'stdio', command: 'node', args: ['user.js'], env: {} } }; });
        fs.writeFileSync(path.join(at(work, 'api'), '.mcp.json'), `${JSON.stringify({ mcpServers: { proj: { command: 'node', args: ['p.js'] } } }, null, 2)}\n`);
    } },
    { at: 'api', after: (work) => ({ ...mcpState(work), parent: localOf(work, '.'), runner: runnerOf(work, 'api') }) },
    update('api', { after: mcpState }),
]));

test('D2: a child copies its parent\'s local server once; a second run changes nothing (AC22)', POSIX_ONLY, () =>
{
    const r = freshRun();
    const got = r.steps[1];
    const adds = got.calls.filter((l) => l.startsWith('mcp add-json '));
    assert.deepStrictEqual(adds.map((l) => l.split(' ').slice(0, 5).join(' ')).sort(), ['mcp add-json -s local run', 'mcp add-json -s local srv'], r.outs[1]);
    assert.deepStrictEqual(got.local.srv, got.parent.srv, 'the copy is the parent\'s entry');
    assert.deepStrictEqual(rowMap(got.rows), { run: hashOf(got.local.run), srv: hashOf(got.local.srv) }, r.outs[1]);
    assert.deepStrictEqual(got.state, { run: hashOf(got.parent.run), srv: hashOf(got.parent.srv) });
    assert.match(r.outs[1], /mcp srv: copied/);
    for (const bit of ['srv.js', '"command"', '"args"', '--stdio']) assert.ok(!r.outs[1].includes(bit), `the log holds ${bit}:\n${r.outs[1]}`);
    const again = r.steps[2];
    assert.deepStrictEqual(again.calls, got.calls, 'the second run made an mcp call');
    assert.deepStrictEqual([again.local, again.rows, again.state], [got.local, got.rows, got.state], r.outs[2]);
});

test('D2: the runner path is re-pointed to the child\'s own', POSIX_ONLY, () =>
{
    const got = freshRun().steps[1];
    assert.deepStrictEqual(got.local.run.args, [got.runner, '--', 'tool', '--stdio']);
});

test('D2: a name outside [A-Za-z0-9_-] is named and not copied (R5)', POSIX_ONLY, () =>
{
    const r = freshRun();
    assert.ok(!Object.hasOwn(r.steps[1].local, 'bad.name'));
    assert.match(r.outs[1], /mcp "bad\.name": not copied - /);
});

test('D2: a parent entry with a relative command is named and not copied (R8)', POSIX_ONLY, () =>
{
    const r = freshRun();
    assert.ok(!Object.hasOwn(r.steps[1].local, 'rel'));
    assert.match(r.outs[1], /mcp rel: not copied - its command is a relative path/);
});

test('D2: a server registered in the child at any scope is not copied', POSIX_ONLY, () =>
{
    const r = freshRun();
    const got = r.steps[1];
    assert.deepStrictEqual(got.local.mine.args, ['own.js'], 'the child\'s own local entry stays');
    assert.ok(!Object.hasOwn(got.local, 'theirs') && !Object.hasOwn(got.local, 'proj'));
    assert.ok(!got.calls.some((l) => / (mine|theirs|proj) /.test(l)), got.calls.join('\n'));
    assert.match(r.outs[1], /mcp mine: not copied - this project registers its own \(local scope\)/);
    assert.match(r.outs[1], /mcp theirs: not copied - this project registers its own \(user scope\)/);
    assert.match(r.outs[1], /mcp proj: not copied - this project registers its own \(project scope\)/);
});

test('D2: a changed parent entry at hash is removed and added again; one changed by hand is kept and named', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV, b: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', {
            before: (work) => { putLocal(work, '.', { a: { ...SRV, args: ['srv.js', '--v2'] } }); putLocal(work, 'api', { b: { ...SRV, env: { MODE: 'mine' } } }); },
            after: (work) => ({ ...mcpState(work), parent: localOf(work, '.') }),
        }),
    ]);
    const got = r.steps[2];
    const made = got.calls.slice(r.steps[1].calls.length).map((l) => l.split(' ').slice(0, 5).join(' '));
    assert.deepStrictEqual(made, ['mcp remove a -s local', 'mcp add-json -s local a'], r.outs[2]);
    assert.deepStrictEqual(got.local.a, got.parent.a);
    assert.strictEqual(got.local.b.env.MODE, 'mine', 'the hand-changed copy is kept');
    assert.deepStrictEqual(rowMap(got.rows), { a: hashOf(got.local.a) }, 'the hand-changed copy left the ledger');
    assert.strictEqual(got.state.a, hashOf(got.parent.a));
    assert.match(r.outs[2], /mcp b: kept - /);
});

test('D2: a CLI that stores the entry in its own shape reads as at hash; a lost state file re-makes the copy once', POSIX_ONLY, () =>
{
    const BARE = { command: 'node', args: ['bare.js'] };
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { bare: BARE }); } },
        { at: 'api', after: mcpState },
        update('api', { after: mcpState }),
        update('api', { before: (work) => fs.rmSync(path.join(at(work, 'api'), '.alfred', 'state', 'workspace-mcp.json')), after: mcpState }),
        update('api', { after: mcpState }),
    ]);
    assert.deepStrictEqual(r.steps[1].local.bare, { type: 'stdio', ...BARE }, 'the stub stores its own shape');
    assert.strictEqual(r.steps[2].calls.length, r.steps[1].calls.length, r.outs[2]);
    const remade = r.steps[3].calls.slice(r.steps[2].calls.length).map((l) => l.split(' ').slice(0, 5).join(' '));
    assert.deepStrictEqual(remade, ['mcp remove bare -s local', 'mcp add-json -s local bare'], r.outs[3]);
    assert.deepStrictEqual(r.steps[3].state, { bare: hashOf(BARE) });
    assert.strictEqual(r.steps[4].calls.length, r.steps[3].calls.length, r.outs[4]);
});

test('D2: ignore mcp removes the copy; a parent server gone removes it; a parent key absent keeps it', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV, b: SRV, c: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', { before: (work) => { edit(work, 'api', (m) => wsLib.addIgnore(m, 'mcp', 'a')); putLocal(work, '.', { b: null }); }, after: mcpState }),
        update('api', { before: (work) => putAccount(work, (d) => { delete d.projects[keyAt(work, '.')]; }), after: mcpState }),
    ]);
    assert.deepStrictEqual(Object.keys(r.steps[1].local).sort(), ['a', 'b', 'c'], r.outs[1]);
    const gone = r.steps[2].calls.slice(r.steps[1].calls.length);
    assert.deepStrictEqual(gone.sort(), ['mcp remove a -s local', 'mcp remove b -s local'], r.outs[2]);
    assert.deepStrictEqual(Object.keys(r.steps[2].local), ['c']);
    assert.deepStrictEqual(Object.keys(rowMap(r.steps[2].rows)), ['c']);
    assert.strictEqual(r.steps[3].calls.length, r.steps[2].calls.length, r.outs[3]);
    assert.deepStrictEqual([r.steps[3].local, r.steps[3].rows], [r.steps[2].local, r.steps[2].rows]);
    assert.match(r.outs[3], /!! workspace: \S*\.claude\.json holds no entry for \.\. - /);
});

test('D2: an empty chain while the workspace is on changes no copy and keeps its rows; a rejoin refreshes at hash', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', { before: (work) => edit(work, '.', (m) => wsLib.removeChild(m, 'api')), after: mcpState }),
        update('api', { before: (work) => { edit(work, '.', (m) => wsLib.addChild(m, 'api')); putLocal(work, '.', { a: { ...SRV, args: ['v2'] } }); }, after: mcpState }),
    ]);
    assert.strictEqual(r.steps[2].calls.length, r.steps[1].calls.length, r.outs[2]);
    assert.deepStrictEqual([r.steps[2].local, r.steps[2].rows], [r.steps[1].local, r.steps[1].rows]);
    assert.strictEqual((r.outs[2].match(/no linked parent/g) || []).length, 1, r.outs[2]);
    assert.match(r.outs[2], /no linked parent - the copied MCP registration a is kept as it is/);
    const remade = r.steps[3].calls.slice(r.steps[2].calls.length).map((l) => l.split(' ').slice(0, 5).join(' '));
    assert.deepStrictEqual(remade, ['mcp remove a -s local', 'mcp add-json -s local a'], r.outs[3]);
    assert.deepStrictEqual(r.steps[3].local.a.args, ['v2']);
});

test('D2: an unreadable, replaced or two-key account file changes nothing and prints its !! line (AC22)', POSIX_ONLY, () =>
{
    const saved = {};
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', {
            before: (work) => { saved.text = readOr(accountOf(work)); putLocal(work, '.', { a: { ...SRV, args: ['v2'] } }); saved.changed = readOr(accountOf(work)); fs.writeFileSync(accountOf(work), '{ not json'); },
            after: (work) => { const got = { calls: mcpCalls(work), rows: rowsOf(work, 'api') }; fs.writeFileSync(accountOf(work), saved.changed); return got; },
        }),
        update('api', {
            before: (work) => { fs.mkdirSync(path.join(work, 'acct', 'backups'), { recursive: true }); fs.writeFileSync(path.join(work, 'acct', 'backups', `.claude.json.corrupted.${Date.now() + 1000}`), '{}'); },
            after: (work) => { const got = mcpState(work); fs.rmSync(path.join(work, 'acct', 'backups'), { recursive: true, force: true }); return got; },
        }),
        update('api', {
            before: (work) => putAccount(work, (d) => { d.projects[keyAt(work, '.').toUpperCase()] = { mcpServers: { a: SRV } }; }),
            after: mcpState,
        }),
    ]);
    const before = r.steps[1];
    for (const [i, line] of [[2, /!! workspace: \S*\.claude\.json could not be read - no MCP registration was copied from \.\. or removed/],
        [3, /!! workspace: \S*\.claude\.json was replaced since the last run .*- no MCP registration was copied from \.\. or removed/],
        [4, /!! workspace: \S*\.claude\.json holds 2 entries for \.\. .*- no MCP registration was copied from \.\. or removed/]])
    {
        assert.strictEqual(r.steps[i].calls.length, before.calls.length, `run ${i} made an mcp call:\n${r.outs[i]}`);
        assert.strictEqual(r.steps[i].rows, before.rows, r.outs[i]);
        assert.match(r.outs[i], line);
    }
    assert.deepStrictEqual(r.steps[4].local.a, SRV, 'the copy kept its first shape');
});

test('D2: a failing add-json prints the !! line and no CLI output', POSIX_ONLY, () =>
{
    const TOKEN = 'tok-d2-0123456789abcdef';
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: { type: 'stdio', command: 'node', args: ['a.js'], env: { API_TOKEN: TOKEN } } }); } },
        { at: 'api', env: { CLAUDE_STUB_ADDJSON_FAIL: '1' }, after: mcpState },
    ]);
    const got = r.steps[1];
    assert.match(r.outs[1], /!! mcp a: copy failed \(exit 1\)/);
    for (const bit of [TOKEN, 'a.js', '"command"', 'Invalid configuration']) assert.ok(!r.outs[1].includes(bit), `the log holds ${bit}`);
    assert.strictEqual(got.rows, null, 'no row for a copy that was not made');
    assert.ok(!Object.hasOwn(got.local, 'a'));
    assert.strictEqual(got.calls.filter((l) => l.startsWith('mcp add-json -s local a ')).length, 1);
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

test('D2: the retire path never touches a workspace-mcp row', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', {
            before: (work) => { const f = path.join(at(work, 'api'), '.claude', 'alfred-code.stamp'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^version: .*$/m, 'version: 2.10.0')); },
            after: mcpState,
        }),
    ]);
    assert.strictEqual(r.steps[2].calls.length, r.steps[1].calls.length, r.outs[2]);
    assert.deepStrictEqual([r.steps[2].local, r.steps[2].rows], [r.steps[1].local, r.steps[1].rows]);
    assert.ok(r.steps[2].rows, 'the row is there');
});

test('D2: uninstall in the child removes its copies at hash and keeps a changed one', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV, b: SRV }); } },
        { at: 'api', after: mcpState },
        { at: 'api', act: 'uninstall', before: (work) => putLocal(work, 'api', { b: { ...SRV, env: { MODE: 'mine' } } }), after: (work) => ({ ...mcpState(work), stamp: fs.existsSync(path.join(at(work, 'api'), '.claude', 'alfred-code.stamp')) }) },
    ]);
    const got = r.steps[2];
    assert.deepStrictEqual(got.calls.slice(r.steps[1].calls.length), ['mcp remove a -s local'], r.outs[2]);
    assert.deepStrictEqual(Object.keys(got.local), ['b']);
    assert.match(r.outs[2], /mcp b: kept - /);
    assert.strictEqual(got.state, null, 'the state file goes with the copies');
    assert.strictEqual(got.stamp, false, r.outs[2]);
});

test('D2: uninstall at the root strips the children\'s workspace-mcp rows and leaves the registrations', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: mcpState },
        { at: '.', act: 'uninstall', after: mcpState },
    ]);
    assert.ok(r.steps[1].rows, r.outs[1]);
    assert.strictEqual(r.steps[2].rows, null, r.outs[2]);
    assert.deepStrictEqual(r.steps[2].local, r.steps[1].local, 'the copies stay as the user\'s own');
    assert.strictEqual(r.steps[2].calls.length, r.steps[1].calls.length, r.outs[2]);
});

test('D2: the kill switch copies and removes nothing', POSIX_ONLY, () =>
{
    const r = d2([
        { at: '.', after: (work) => { join(work, 'api'); putLocal(work, '.', { a: SRV }); } },
        { at: 'api', after: mcpState },
        update('api', { env: { ALFRED_CODE_WORKSPACE: '0' }, before: (work) => putLocal(work, '.', { a: { ...SRV, args: ['v2'] }, c: SRV }), after: mcpState }),
    ]);
    assert.strictEqual(r.steps[2].calls.length, r.steps[1].calls.length, r.outs[2]);
    assert.deepStrictEqual([r.steps[2].local, r.steps[2].rows, r.steps[2].state], [r.steps[1].local, r.steps[1].rows, r.steps[1].state]);
});
