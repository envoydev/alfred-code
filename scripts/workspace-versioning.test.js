// Workspace versioning, task 2: ALFRED_CODE_DOCS_VERSIONING reaches a joined child through the one variable loader, and
// only an `ignore env` line (D3) stops it - the join and W1 prunes never remove a child's own value of it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ws = require('./install/workspace.js');
const stampLib = require('./install/stamp.js');
const layout = require('../stack/hooks/layout.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const variablesLib = require('./install/variables.js');

const KEY = 'ALFRED_CODE_DOCS_VERSIONING';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-versioning-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ON = { CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };
const hashOf = stampLib.valueHash;

// A root and a joined child, as `workspace.js join` leaves them: the root lists the child, the child names its parent.
const joined = ({ root = `${KEY}=local\n`, child, childStamp = 'sha: x\nmanaged-env: \n', rootStamp = 'sha: x\nmanaged-env: \n' } = {}) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 'j-'));
    const dirs = { root: path.join(top, 'ws'), child: path.join(top, 'ws', 'api') };
    for (const dir of Object.values(dirs))
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
    }
    execFileSync('git', ['init', '-q'], { cwd: dirs.child });
    fs.writeFileSync(path.join(dirs.root, '.claude', 'alfred-code.stamp'), rootStamp);
    fs.writeFileSync(path.join(dirs.child, '.claude', 'alfred-code.stamp'), childStamp);
    putWorkspace(dirs.root, { children: ['api'] });
    putWorkspace(dirs.child, { parent: '..' });
    if (root !== null) fs.writeFileSync(path.join(dirs.root, '.alfred', '.variables'), root);
    if (child !== undefined) fs.writeFileSync(path.join(dirs.child, '.alfred', '.variables'), child);
    return { root: fs.realpathSync.native(dirs.root), child: fs.realpathSync.native(dirs.child) };
};
const varsText = (dir) => fs.readFileSync(path.join(dir, '.alfred', '.variables'), 'utf8');

test('a child reads the root\'s versioning through the loader', () =>
{
    const at = joined();
    assert.strictEqual(layout.variablesOf(at.child, { env: {} }).values[KEY], 'local');
});

test('the layout sets: only the switch is never taken from a member, and the key is never pruned', () =>
{
    assert.deepStrictEqual([...layout.MEMBER_NEVER], ['ALFRED_CODE_WORKSPACE']);
    assert.deepStrictEqual([...layout.CHAIN_PRUNE_NEVER], [KEY]);
});

test('chainValues hands the key on', () =>
{
    const at = joined();
    assert.strictEqual(ws.chainValues(at.child, { env: ON })[KEY], 'local');
    assert.ok(!Object.hasOwn(ws.chainValues(at.child, { env: ON }), 'ALFRED_CODE_WORKSPACE'));
});

test('W1 keeps a typed local equal to the root\'s', () =>
{
    const at = joined({ child: `${KEY}=local\n` });
    const got = ws.pruneChained(at.child, { env: ON, log: () => {} });
    assert.ok(got.own.includes(KEY), JSON.stringify(got));
    assert.ok(!got.dropped.includes(KEY));
    assert.strictEqual(varsText(at.child), `${KEY}=local\n`);
});

test('a join keeps an answered git', () =>
{
    const stamp = `sha: x\nmanaged-env: .variables:${KEY}=${hashOf('git')}\n`;
    const at = joined({ child: `${KEY}=git\n`, childStamp: stamp });
    const got = ws.pruneChained(at.child, { env: ON, log: () => {}, seeds: true });
    assert.ok(got.own.includes(KEY), JSON.stringify(got));
    assert.ok(!got.dropped.includes(KEY));
    assert.strictEqual(varsText(at.child), `${KEY}=git\n`);
    assert.strictEqual(stampLib.readLedger(path.join(at.child, '.claude', 'alfred-code.stamp')).env['.variables'][KEY], hashOf('git'), 'its ledger row stays');
});

test('envPlan never copies or seeds the key', () =>
{
    const planFor = (stampText, settings) =>
    {
        const at = joined({ childStamp: stampText });
        fs.writeFileSync(path.join(at.child, '.claude', 'settings.json'), JSON.stringify({ env: settings }));
        const ledger = stampLib.readLedger(path.join(at.child, '.claude', 'alfred-code.stamp'));
        return ws.envPlan({ workspace: { on: true, members: ws.chain(at.child, { env: ON }).members, ignores: [] }, args: { action: 'update', scope: 'project' },
            projectRoot: at.child, env: ON, claudeDir: path.join(at.child, '.claude'), ledger });
    };
    const rows = `settings.json:${KEY}=${hashOf('local')},settings.json:ALFRED_CODE_HISTORY=${hashOf('5')}`;
    const copies = planFor(`sha: x\nmanaged-env: ${rows}\nown-env: \n`, { [KEY]: 'local' });
    assert.ok(!copies.copies.includes(KEY) && !copies.seeds.includes(KEY), JSON.stringify(copies));
    const seeded = planFor(`sha: x\nmanaged-env: settings.json:${KEY}=${hashOf('git')}\njoin-prune: settings\n`, { [KEY]: 'git' });
    assert.ok(!seeded.copies.includes(KEY) && !seeded.seeds.includes(KEY), JSON.stringify(seeded));
});

test('ignore env stops it', () =>
{
    const at = joined();
    putWorkspace(at.child, { parent: '..', ignore: { env: [KEY] } });
    assert.strictEqual(layout.variablesOf(at.child, { env: {} }).values[KEY], undefined);
    assert.ok(!Object.hasOwn(ws.chainValues(at.child, { env: ON }), KEY));
});

test('keepOnLeave writes the inherited value and its ledger row', () =>
{
    const at = joined({ rootStamp: `sha: x\nmanaged-env: .variables:${KEY}=${hashOf('local')}\n` });
    const got = ws.keepOnLeave(at.child, { env: ON, log: () => {} });
    assert.ok(got.written.includes(KEY), JSON.stringify(got));
    assert.match(varsText(at.child), new RegExp(`^${KEY}=local$`, 'm'));
    assert.strictEqual(stampLib.readLedger(path.join(at.child, '.claude', 'alfred-code.stamp')).env['.variables'][KEY], hashOf('local'), 'the seed keeps its ledger row');
});

// --- Task 5: the installer's seeds, the answers it records and the one remover (D3, D3b) ------------------------------
// Each case runs the installer from this tree in a sandbox: `ws` is a plain folder (no repository, so its own docs
// versioning is `local`), `ws/api` a git repository. A step is { at, act, args, before(work), after(work) }.
const SOURCE = path.join(__dirname, '..');
const SEED = path.join(__dirname, 'install', 'alfred-code.js');
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const SELECTION = 'rule alfred-docs-root\nrule alfred-git\n';
const API = 'api';

function scenario(steps)
{
    return seedRun(steps.map((s) => s.act || 'install'), '', {
        plugins: PLUGINS, source: SOURCE, seed: SEED,
        cwds: steps.map((s) => path.join('ws', s.at || '')),
        env: steps.map((s) => ({ ALFRED_CODE_WORKSPACE: '1', ...(s.env || {}) })),
        args: steps.map((s, i) => (repo, work) =>
        {
            if (s.before) s.before(work);
            const sel = path.join(work, `sel-${i}.txt`);
            fs.writeFileSync(sel, SELECTION);
            // The root's first install chooses `local` (a plain-folder root seeds none, and only a chosen value chains).
            const chosen = i === 0 && !s.at && !s.act && !s.args ? ['--docs-versioning', 'local'] : [];
            return [...(s.act === 'update' ? ['--installed-only'] : []), '--selection', sel, ...chosen, ...(s.args || [])];
        }),
        prepare: (repo, work) =>
        {
            fs.mkdirSync(path.join(work, 'ws', API), { recursive: true });
            execFileSync('git', ['init', '-q', path.join(work, 'ws', API)]);
        },
        each: (repo, i) => (steps[i].after ? steps[i].after(path.dirname(repo)) : null),
    });
}
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct'), ALFRED_CODE_WORKSPACE: '1' });
const rootAt = (work) => path.join(work, 'ws');
const childAt = (work) => path.join(work, 'ws', API);
const stampAt = (dir) => path.join(dir, '.claude', 'alfred-code.stamp');
const join = (work) =>
{
    assert.ok(ws.writeWorkspace(childAt(work), (m) => ws.setParent(m, '..'), { env: acct(work) }).ok);
    assert.ok(ws.writeWorkspace(rootAt(work), (m) => ws.addChild(m, API), { env: acct(work) }).ok);
};
const setRoot = (work, value) => assert.deepStrictEqual(variablesLib.set(rootAt(work), [`${KEY}=${value}`], { env: acct(work), log: () => {} }).refused, []);
const look = (work) => ({
    own: (layout.readDotenv(path.join(childAt(work), '.alfred', '.variables')) || { values: {} }).values[KEY],
    read: layout.variablesOf(childAt(work), { env: acct(work) }).values[KEY],
    row: (((stampLib.readLedger(stampAt(childAt(work))) || {}).env || {})['.variables'] || {})[KEY],
    answered: stampLib.readAnsweredEnv(stampAt(childAt(work))),
});

test('a fresh child under a local root gets no versioning line', POSIX_ONLY, () =>
{
    const r = scenario([{ after: join }, { at: API, after: look }]);
    assert.deepStrictEqual(r.steps[1], { own: undefined, read: 'local', row: undefined, answered: [] }, r.outs[1]);
    assert.doesNotMatch(r.outs[1], /ALFRED_CODE_DOCS_VERSIONING seeded/);
});

// An older child: it installed on its own and seeded `git`, then joined a root that answers `local`.
const olderChild = (extra = {}) => [{}, { at: API, after: look }, { at: API, act: 'update', before: join, ...extra }];

test('an older child\'s git seed leaves', POSIX_ONLY, () =>
{
    const r = scenario([...olderChild({ after: look })]);
    assert.deepStrictEqual(r.steps[1], { own: 'git', read: 'git', row: hashOf('git'), answered: [] }, 'the standalone install seeded git');
    assert.deepStrictEqual(r.steps[2], { own: undefined, read: 'local', row: undefined, answered: [] }, r.outs[2]);
});

test('an older child\'s git seed leaves after the stamp and the same run already wrote the local shape', POSIX_ONLY, () =>
{
    const shape = (work) => ({ ...look(work), ignore: fs.readFileSync(path.join(childAt(work), '.alfred', '.gitignore'), 'utf8') });
    const r = scenario([{}, { at: API, after: shape }, { at: API, act: 'update', before: join, after: shape }]);
    assert.strictEqual(r.steps[2].row, undefined, 'the stamp the run wrote holds no row for the removed line');
    assert.notStrictEqual(r.steps[2].ignore, r.steps[1].ignore, 'the .gitignore follows the workspace\'s local');
    assert.match(r.outs[2], /workspace: .*ALFRED_CODE_DOCS_VERSIONING.*removed/);
});

test('an older child\'s git seed stays while its settings.json holds a versioning value', POSIX_ONLY, () =>
{
    const hold = (work) => fs.writeFileSync(path.join(childAt(work), '.claude', 'settings.json'), JSON.stringify({ env: { [KEY]: 'local' } }));
    const r = scenario([{}, { at: API, after: look }, { at: API, act: 'update', before: (work) => { hold(work); join(work); }, after: look }]);
    assert.deepStrictEqual(r.steps[2], { own: 'git', read: 'git', row: hashOf('git'), answered: [] }, r.outs[2]);
    assert.match(r.outs[2], /workspace: ALFRED_CODE_DOCS_VERSIONING 'git' stays in \.alfred\/\.variables: settings\.json holds a value for it/, r.outs[2]);
});

test('--docs-versioning git stays after a second run', POSIX_ONLY, () =>
{
    const r = scenario([{ after: join }, { at: API, args: ['--docs-versioning', 'git'], after: look }, { at: API, act: 'update', after: look }]);
    for (const step of [1, 2]) assert.deepStrictEqual(r.steps[step], { own: 'git', read: 'git', row: hashOf('git'), answered: [KEY] }, `step ${step}\n${r.outs[step]}`);
});

test('a firm local child under a git root is seeded local', POSIX_ONLY, () =>
{
    const r = scenario([{ after: (work) => { join(work); setRoot(work, 'git'); } }, { at: API, args: ['--scope', 'local'], after: look }]);
    assert.deepStrictEqual(r.steps[1], { own: 'local', read: 'local', row: hashOf('local'), answered: [] }, r.outs[1]);
});

test('a firm seed equal to the chain is not written', POSIX_ONLY, () =>
{
    const r = scenario([{ after: join }, { at: API, args: ['--scope', 'local'], after: look }]);
    assert.deepStrictEqual(r.steps[1], { own: undefined, read: 'local', row: undefined, answered: [] }, r.outs[1]);
});

// A child that installed at local scope on its own (it seeded `local`), joins a root and moves to project scope.
const leavingLocal = (rootValue) => scenario([{ after: (work) => { if (rootValue) setRoot(work, rootValue); } },
    { at: API, args: ['--scope', 'local'], after: look },
    { at: API, act: 'update', args: ['--scope', 'project'], before: join, after: look }]);

test('a child leaving local scope under a local root is not reseeded git', POSIX_ONLY, () =>
{
    const r = leavingLocal();
    assert.strictEqual(r.steps[1].own, 'local', 'the local install seeded local');
    assert.deepStrictEqual(r.steps[2], { own: undefined, read: 'local', row: undefined, answered: [] }, r.outs[2]);
});

test('a garbage chain value neither skips the reseed nor ranks', POSIX_ONLY, () =>
{
    const r = leavingLocal('bogus');
    assert.strictEqual(r.steps[2].own, 'git', `the reseed ran:\n${r.outs[2]}`);
});

// An older child whose hand-set docs root `docs-ext` is kept out of git: the update that moves it carries `local`.
const olderDocsRoot = (work) =>
{
    const child = childAt(work);
    const settings = path.join(child, '.claude', 'settings.json');
    const rule = require('./install/copy.js').ruleAt(child, 'alfred-docs-root');
    fs.writeFileSync(path.join(child, '.gitignore'), '/docs-ext/\n');
    fs.writeFileSync(settings, JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs-ext' } }, null, 2));
    fs.writeFileSync(stampAt(child), fs.readFileSync(stampAt(child), 'utf8').replace(/^managed-env: ?(.*)$/m, (_, rest) => `managed-env: ${rest ? `${rest},` : ''}settings.json:ALFRED_CODE_DOCS_PATH=${hashOf('docs-ext')}`));
    fs.writeFileSync(rule, fs.readFileSync(rule, 'utf8').replace(/This install's root: `[^`]*`/, 'This install\'s root: `docs-ext`'));
    fs.rmSync(path.join(child, '.alfred', 'docs'), { recursive: true, force: true });
    for (const rel of ['architecture/ARCHITECTURE.md', 'ORIENTATION.md']) fs.mkdirSync(path.dirname(path.join(child, 'docs-ext', rel)), { recursive: true }) || fs.writeFileSync(path.join(child, 'docs-ext', rel), '# x\n');
};

test('a carried local is recorded and stays', POSIX_ONLY, () =>
{
    const r = scenario([{ after: (work) => setRoot(work, 'git') }, { at: API, after: olderDocsRoot },
        { at: API, act: 'update', before: join, args: ['--docs-root-move', 'move'], after: look }, { at: API, act: 'update', after: look }]);
    assert.match(r.outs[2], /the old root was kept out of git/, r.outs[2]);
    for (const step of [2, 3]) assert.deepStrictEqual(r.steps[step], { own: 'local', read: 'local', row: hashOf('local'), answered: [KEY] }, `step ${step}\n${r.outs[step]}`);
});

const cli = (work, ...args) => execFileSync(process.execPath, [path.join(__dirname, 'variables.js'), 'set', '--root', childAt(work), ...args],
    { env: { ...process.env, ...acct(work) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('variables.js set records the answer', POSIX_ONLY, () =>
{
    const r = scenario([{ after: join }, { at: API, after: (work) =>
    {
        const file = stampAt(childAt(work));
        stampLib.markLine(file, 'answered-env', 'ALFRED_CODE_HISTORY');
        cli(work, `${KEY}=git`);
        const recorded = stampLib.readAnsweredEnv(file);
        cli(work, `${KEY}=git`);
        const again = stampLib.readAnsweredEnv(file);
        cli(work, 'ALFRED_CODE_HISTORY=5');
        const other = stampLib.readAnsweredEnv(file);
        cli(work, `${KEY}=`);
        return { recorded, again, other, removed: stampLib.readAnsweredEnv(file) };
    } }]);
    assert.deepStrictEqual(r.steps[1], { recorded: ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HISTORY'], again: ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HISTORY'],
        other: ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HISTORY'], removed: ['ALFRED_CODE_HISTORY'] });
    const bare = fs.mkdtempSync(path.join(TMP, 'bare-'));
    fs.mkdirSync(path.join(bare, '.claude'));
    execFileSync('git', ['init', '-q'], { cwd: bare });
    execFileSync(process.execPath, [path.join(__dirname, 'variables.js'), 'set', '--root', bare, `${KEY}=git`], { env: { ...process.env, ...ON }, stdio: 'ignore' });
    assert.deepStrictEqual(fs.readdirSync(path.join(bare, '.claude')), [], 'no stamp, nothing written to one');
});

test('local scope names the seed and removes nothing', POSIX_ONLY, () =>
{
    const tracked = (work) =>
    {
        execFileSync('git', ['add', '-f', '.alfred/.variables'], { cwd: childAt(work) });
        join(work);
    };
    const r = scenario([{}, { at: API, args: ['--scope', 'local'], after: look }, { at: API, act: 'update', before: tracked, after: look }]);
    assert.strictEqual(r.steps[1].own, 'local', 'the local install seeded local');
    assert.deepStrictEqual(r.steps[2], r.steps[1], r.outs[2]);
    assert.match(r.outs[2], /workspace: ALFRED_CODE_DOCS_VERSIONING 'local' in \.alfred\/\.variables is the stack's seed .* leaves it as it is/, r.outs[2]);
});
