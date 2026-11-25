'use strict';
// A workspace top root lists a skill it links only for its children by name alone (root-children-only-picks, Task 3): a
// `skillOverrides` key `"<name>": "name-only"` beside the `<rel>:<name>` hide keys. Each case runs the real installer over a
// root and its children in a temp tree; the children are laid down after the root's install, as in install-root-hides.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');
const stampLib = require('./install/stamp.js');
const settingsKeys = require('./install/settings-keys.js');
const childrenOnly = require('./install/children-only-read.js');
const childHide = require('./install/child-hide.js');
const { NAME_ONLY, ROOT_SKILLS, trimLogLine } = require('./install/children-only-constants.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { putWorkspace } = require('./workspace-fixture.js');

const SELECTION = 'skill javascript\n';
const SCOPE = ['--scope', 'local'];
const UPDATE = [...SCOPE, '--installed-only'];
const OFF = 'off';
const ON = { ALFRED_CODE_WORKSPACE: '1' };
const WEB = 'web';
const API = 'api';
const WEB_SKILLS = ['angular-conventions', 'typescript'];
const API_SKILLS = ['csharp', 'dotnet-testing'];
const TRIMMED = [...WEB_SKILLS, ...API_SKILLS];
const KID_PICKS = { [WEB]: WEB_SKILLS, [API]: API_SKILLS };

const localOf = (repo) => path.join(repo, '.claude', 'settings.local.json');
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const overrides = (repo) => (readJson(localOf(repo)) || {}).skillOverrides || {};
const ledgerRows = (repo) => Object.keys((stampLib.readLedger(stampOf(repo)) || { settings: {} }).settings['settings.local.json'] || {});
const hasRow = (repo, name) => ledgerRows(repo).includes(settingsKeys.keyRow('skillOverrides', name));
const trimKeys = (over) => Object.keys(over).filter((key) => over[key] === NAME_ONLY).sort();
const rootLinks = (repo) => fs.readdirSync(path.join(repo, '.claude', 'skills'));

// One child, a project of its own: its stamp with the links it holds and its own picks, real links into the root's store.
function putChild(repo, rel, { shareRepo = false, picks = KID_PICKS[rel] || [], links = ['javascript', ...picks], stampText = null } = {})
{
    const at = path.join(repo, rel);
    const skills = path.join(at, '.claude', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    fs.writeFileSync(path.join(at, '.claude', 'alfred-code.stamp'), stampText !== null ? stampText
        : `seats-route: plugin\nown-picks: ${picks.map((name) => `skill/${name}`).join(',')}\nlinks: ${links.map((name) => `skills/${name}=symlink`).join(',')}\n`);
    for (const name of links) fs.symlinkSync(path.relative(skills, path.join(repo, '.alfred', 'stack', 'skills', name)), path.join(skills, name), 'dir');
    fs.writeFileSync(path.join(at, '.gitignore'), '.claude/\n.alfred/\n');
    if (!shareRepo) rt.execCommand('git', ['init', '-q', at]);
    putWorkspace(at, { parent: '..' });
}

function layChildren(repo, options = {})
{
    const rels = Object.keys(options.kids || KID_PICKS);
    for (const rel of rels) putChild(repo, rel, { ...(options.kids || {})[rel], shareRepo: (options.shared || []).includes(rel) });
    putWorkspace(repo, { children: rels, includeAsked: rels, includedChildren: rels });
}

const seen = (repo) => ({ over: overrides(repo), rows: ledgerRows(repo).filter((row) => row.startsWith('skillOverrides{')) });
const run = (actions, { env = ON, args = [], lay = {}, after = seen } = {}) =>
    seedRun(actions, SELECTION, {
        args: [SCOPE, ...actions.slice(1).map((_, i) => args[i] || UPDATE)], env,
        each: (repo, i) => { if (i === 0) layChildren(repo, lay); return after(repo, i); },
    });

test('a top root with an Angular child and a .NET child lists their skills by name, with a row for each key', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update'], { after: (repo, i) => ({ ...seen(repo), links: i ? rootLinks(repo) : [] }) });
    assert.deepStrictEqual(steps[0].over, {}, 'the children were not there at the install');
    for (const name of TRIMMED)
    {
        assert.strictEqual(steps[1].over[name], NAME_ONLY, `${name}: ${outs[1]}`);
        assert.ok(steps[1].rows.includes(settingsKeys.keyRow('skillOverrides', name)), `${name} has its ledger row`);
        assert.ok(steps[1].links.includes(name), `${name} stays linked at the root`);
    }
    assert.strictEqual(steps[1].over[`${WEB}:angular-conventions`], OFF, 'the child-qualified hide keys stay');
    assert.strictEqual(steps[1].rows.length, Object.keys(steps[1].over).length, 'one ledger row a key');
    assert.ok(trimKeys(steps[1].over).every((name) => !['habits-clarify', 'task-solve'].includes(name)), 'a locked skill is never trimmed');
    assert.match(outs[1], new RegExp(trimLogLine('typescript').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a re-run changes no byte of settings.local.json or the stamp', POSIX_ONLY, () =>
{
    const bytes = (repo) => [fs.readFileSync(localOf(repo), 'utf8'), (/^managed-settings: .*$/m.exec(fs.readFileSync(stampOf(repo), 'utf8')) || [])[0]];
    const { outs, steps } = run(['install', 'update', 'update', 'update'], { after: bytes });
    assert.match(steps[1][1], /skillOverrides\{/);
    assert.deepStrictEqual(steps[2], steps[1]);
    assert.deepStrictEqual(steps[3], steps[1]);
    assert.ok(!/listed by name at the root/.test(outs[2]), 'a re-run says nothing about a key it already holds');
});

test('a user "on" for a skill the run would trim stays and gets no row; a key set after a trim is not claimed either', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'update'], {
        after: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(localOf(repo), JSON.stringify({ skillOverrides: { typescript: 'on' } }));
            if (i === 1) fs.writeFileSync(localOf(repo), JSON.stringify({ ...readJson(localOf(repo)), skillOverrides: { ...overrides(repo), csharp: 'on' } }));
            return { ...seen(repo), hasTs: hasRow(repo, 'typescript'), hasCs: hasRow(repo, 'csharp') };
        },
    });
    assert.strictEqual(steps[1].over.typescript, 'on');
    assert.strictEqual(steps[1].hasTs, false);
    assert.strictEqual(steps[2].over.csharp, 'on', 'a value the user changed stays theirs');
    assert.strictEqual(steps[2].hasCs, false, 'and its row is dropped');
    assert.strictEqual(steps[2].over['angular-conventions'], NAME_ONLY);
});

test('ALFRED_CODE_ROOT_SKILLS=all after a trim removes exactly the trim keys and leaves the hide keys', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update', 'update'], { env: [ON, ON, { ...ON, [ROOT_SKILLS.key]: ROOT_SKILLS.all }] });
    assert.deepStrictEqual(trimKeys(steps[1].over).filter((name) => TRIMMED.includes(name)), [...TRIMMED].sort());
    assert.deepStrictEqual(trimKeys(steps[2].over), [], outs[2]);
    const hide = (over) => Object.keys(over).filter((key) => over[key] === OFF).sort();
    assert.deepStrictEqual(hide(steps[2].over), hide(steps[1].over), 'the <rel>:<name> keys stay');
    assert.ok(hide(steps[1].over).length > 0);
});

test('an uninstall takes the trim keys out and leaves the user\'s', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'uninstall'], {
        args: [null, SCOPE],
        after: (repo, i) => { if (i === 0) fs.writeFileSync(localOf(repo), JSON.stringify({ skillOverrides: { mine: OFF } })); return overrides(repo); },
    });
    assert.ok(TRIMMED.every((name) => steps[1][name] === NAME_ONLY), JSON.stringify(steps[1]));
    assert.deepStrictEqual(steps[2], { mine: OFF });
});

test('a garbage settings.local.json gets no write', POSIX_ONLY, () =>
{
    const garbage = '{ not json';
    const { steps } = run(['install', 'update'], { after: (repo, i) => { if (i === 0) fs.writeFileSync(localOf(repo), garbage); return fs.readFileSync(localOf(repo), 'utf8'); } });
    assert.strictEqual(steps[1], garbage);
});

test('a same-repository child stops every trim key: its sessions read the root\'s bare keys', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update'], { lay: { shared: [API] } });
    assert.deepStrictEqual(trimKeys(steps[1].over), [], `${JSON.stringify(steps[1].over)}`);
    assert.match(outs[1], new RegExp(`  skills: nothing listed by name at the root - ${API} shares its repository`));
    assert.strictEqual(steps[1].over[`${WEB}:typescript`], OFF, 'the hide keys are written all the same');
});

test('a child, run on its own, writes no trim key', () =>
{
    const wanted = childrenOnly.trimWant({ workspace: { parent: '..', on: true }, projectRoot: '/none', env: {}, configDir: '/none', dataInfo: { root: '/none' }, source: { dir: '/none' }, linkedSkills: TRIMMED });
    assert.deepStrictEqual(wanted, { want: {}, said: [] });
});

// A root and its children laid down by hand, for the cases that call trimWant with a snapshot of their own.
function bareRoot(options = {})
{
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'root-trims-'));
    const repo = path.join(work, 'repo');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    rt.execCommand('git', ['init', '-q', repo]);
    fs.writeFileSync(stampOf(repo), 'seats-route: plugin\nown-picks: \n');
    layChildren(repo, options);
    return { work, repo };
}
const ctxOf = (repo, work, sourceDir) => ({
    workspace: { on: true }, projectRoot: repo, env: { CLAUDE_CONFIG_DIR: path.join(work, 'acct') }, configDir: path.join(work, 'acct'),
    dataInfo: { root: path.join(repo, '.alfred') }, source: { dir: sourceDir }, linkedSkills: TRIMMED,
});
const REPO_ROOT = path.join(__dirname, '..');

test('trimWant reads the run\'s snapshot: the shipped one trims, one with no catalog trims nothing and says which file', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        assert.deepStrictEqual(Object.keys(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)).want).sort(), [...TRIMMED].sort());
        const empty = path.join(work, 'snapshot');
        fs.mkdirSync(path.join(empty, 'meta'), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, 'meta', 'evidence.json'), path.join(empty, 'meta', 'evidence.json'));
        assert.deepStrictEqual(childrenOnly.trimWant(ctxOf(repo, work, empty)), { want: {}, said: ['!! workspace: meta/stack-graph.json could not be read - no skill is trimmed to its name this run'] });
        fs.writeFileSync(path.join(empty, 'meta', 'stack-graph.json'), '{ not json');
        assert.match(childrenOnly.trimWant(ctxOf(repo, work, empty)).said[0], /meta\/stack-graph\.json could not be read/);
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a root whose own files hold a .ts file under src/ keeps typescript and angular-conventions in full', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        fs.mkdirSync(path.join(repo, 'src', 'app'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'src', 'app', 'main.ts'), '');
        assert.deepStrictEqual(Object.keys(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)).want).sort(), [...API_SKILLS].sort());
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a file past the depth cap in the root\'s own tree trims nothing and says so; a child\'s deep tree does not', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        const deep = (base) => { fs.mkdirSync(path.join(base, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true }); fs.writeFileSync(path.join(base, 'a', 'b', 'c', 'd', 'e', 'f', 'g.ts'), ''); };
        deep(path.join(repo, WEB));
        assert.strictEqual(Object.keys(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)).want).length, TRIMMED.length, 'inside a child the depth is the child\'s own');
        deep(path.join(repo, 'tools'));
        assert.deepStrictEqual(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)), { want: {}, said: ['!! workspace: the root\'s file walk stopped at depth 6 - no skill is trimmed to its name this run'] });
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a deep clone of its own below the root leaves the root\'s cap and signals alone', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        const clone = path.join(repo, 'vendor', 'clone');
        fs.mkdirSync(path.join(clone, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true });
        fs.writeFileSync(path.join(clone, 'a', 'b', 'c', 'd', 'e', 'f', 'g.ts'), '');
        rt.execCommand('git', ['init', '-q', clone]);
        assert.deepStrictEqual(Object.keys(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)).want).sort(), [...TRIMMED].sort());
        fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
        assert.deepStrictEqual(Object.keys(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)).want).sort(), [...TRIMMED].sort(), 'the same with no git at the root');
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

// The wrong-shape catalogs: a copy of the shipped meta files with one replaced.
function snapshotWith(work, replace)
{
    const dir = path.join(work, 'snapshot');
    fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
    for (const file of ['evidence.json', 'stack-graph.json', 'recommendations.json'])
    {
        const text = file in replace ? replace[file] : fs.readFileSync(path.join(REPO_ROOT, 'meta', file), 'utf8');
        fs.writeFileSync(path.join(dir, 'meta', file), text);
    }
    return dir;
}
const shippedGraph = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'meta', 'stack-graph.json'), 'utf8'));

test('a catalog that parses to the wrong shape trims nothing, says which file, and the hide keys still sync', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        for (const [file, text] of [['recommendations.json', 'null'], ['evidence.json', 'null'], ['stack-graph.json', '[]'], ['evidence.json', '"x"']])
        {
            const got = childHide.skillKeys(ctxOf(repo, work, snapshotWith(work, { [file]: text })));
            assert.deepStrictEqual(trimKeys(got.want), [], `${file} = ${text}`);
            assert.deepStrictEqual(got.said, [`!! workspace: meta/${file} could not be read - no skill is trimmed to its name this run`]);
            assert.strictEqual(got.want[`${WEB}:typescript`], OFF, 'the hide keys are still wanted');
        }
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a rule whose paths is not an array is skipped: no throw, the skill that only it signalled is not trimmed', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        const graph = shippedGraph();
        graph.rules['angular-conventions'].paths = '**/*.ts';
        graph.rules['csharp-conventions'].skills = 'csharp';
        const got = childHide.skillKeys(ctxOf(repo, work, snapshotWith(work, { 'stack-graph.json': JSON.stringify(graph) })));
        assert.strictEqual(got.want['angular-conventions'], undefined, 'its only signal was the broken rule');
        assert.strictEqual(got.want.typescript, NAME_ONLY, 'a skill with a sound rule is still trimmed');
        assert.strictEqual(got.want[`${WEB}:typescript`], OFF);
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a throw inside the trim step gives an empty trim want, one !! line, and the hide keys still sync', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot();
    try
    {
        const got = childHide.skillKeys({ ...ctxOf(repo, work, REPO_ROOT), source: null });
        assert.deepStrictEqual(trimKeys(got.want), []);
        assert.strictEqual(got.said.length, 1);
        assert.match(got.said[0], /^!! workspace: .* - no skill is trimmed to its name this run$/);
        assert.strictEqual(got.want[`${WEB}:typescript`], OFF);
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('a same-repository child and a git child linking csharp: no trim key, and trimWant names the child', POSIX_ONLY, () =>
{
    const { work, repo } = bareRoot({ shared: [API] });
    try
    {
        assert.deepStrictEqual(childrenOnly.trimWant(ctxOf(repo, work, REPO_ROOT)), { want: {}, said: [`skills: nothing listed by name at the root - ${API} shares its repository`] });
    }
    finally { fs.rmSync(work, { recursive: true, force: true }); }
});
