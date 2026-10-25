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

const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const ROOT_SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const X = 'sqlite';   // outside the closure of the root's always rules (markdown-docs pulls markdown-style and docs-as-code)
const OWN = 'npm';
const SC = 'ALFRED_CODE_SCORER';

const at = (work, rel = '.') => path.join(work, 'ws', ...(rel === '.' ? [] : rel.split('/')));
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct') });
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
function scenario(steps, { plugins = PLUGINS, prepare = () => {} } = {})
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins,
        cwds: steps.map((s) => path.join('ws', ...(s.at && s.at !== '.' ? s.at.split('/') : []))),
        env: steps.map((s) => s.env || {}),
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
