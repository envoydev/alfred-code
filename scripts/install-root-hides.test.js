'use strict';
// A workspace root hides what a child below it also loads (workspace-child-stacks, 2026-11-25): the child's copy of a skill the
// root lists, as a `skillOverrides` key in the root's own settings.local.json, and the native rule file the root keeps for a
// set-aside child, as a `claudeMdExcludes` glob. Each case runs the real installer over a root and a child in a temp tree.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');
const wsLib = require('./install/workspace.js');
const stampLib = require('./install/stamp.js');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { putWorkspace } = require('./workspace-fixture.js');
const { realLong } = require('./test-paths.js');

const RULE = 'angular-conventions';
const DROPPED = 'sqlite';   // outside the closure of the always rules: nothing requires it, so a drop applies
const SELECTION = `skill javascript\nskill ${DROPPED}\nrule ${RULE}\n`;
const SCOPE = ['--scope', 'local'];
const UPDATE = [...SCOPE, '--installed-only'];
const OFF = 'off';
const CHILD = 'api';
const ACCOUNT_ON = { ALFRED_CODE_WORKSPACE: '1' };

const localOf = (repo) => path.join(repo, '.claude', 'settings.local.json');
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const overrides = (repo) => (readJson(localOf(repo)) || {}).skillOverrides || {};
const excludes = (repo) => (readJson(localOf(repo)) || {}).claudeMdExcludes || [];
const ledgerRows = (repo) => Object.keys((stampLib.readLedger(path.join(repo, '.claude', 'alfred-code.stamp')) || { settings: {} }).settings['settings.local.json'] || {});
const keyRows = (repo) => ledgerRows(repo).filter((row) => row.startsWith('skillOverrides{'));
const ruleGlob = (repo) => wsLib.excludeGlobs([path.join(repo, '.claude', 'rules', `${RULE}.md`)], process.platform)[0];

// The child, laid down after the root's install so its skills can link into the root's store: its own stamp with the links
// it holds, a real symlink for each, real folders no record names, its own git repository unless `shareRepo`, and its record.
// `included` makes it an included child; else it is set aside, with `keptFor` as the root's kept lines.
function child(repo, { links = ['javascript', DROPPED], handMade = ['hand-made'], shareRepo = false, included = true, keptFor = null, ownPicks = '', symlinked = false } = {})
{
    // `symlinked`: the project lives beside the root and the root's folder is a link to it.
    const at = symlinked ? path.join(path.dirname(repo), 'real-repo') : path.join(repo, CHILD);
    const skills = path.join(at, '.claude', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    const linkLine = links.length ? `links: ${links.map((name) => `skills/${name}=symlink`).join(',')}\n` : '';
    fs.writeFileSync(path.join(at, '.claude', 'alfred-code.stamp'), `seats-route: plugin\nown-picks: ${ownPicks}\n${linkLine}`);
    for (const name of links) fs.symlinkSync(path.relative(skills, path.join(repo, '.alfred', 'stack', 'skills', name)), path.join(skills, name), 'dir');
    for (const name of handMade) fs.mkdirSync(path.join(skills, name), { recursive: true });
    fs.writeFileSync(path.join(at, '.gitignore'), '.claude/\n.alfred/\n');   // git ignores the folder, so the child's skills stay links
    if (!shareRepo) rt.execCommand('git', ['init', '-q', at]);
    putWorkspace(at, { parent: '..' });
    if (symlinked) fs.symlinkSync(path.relative(repo, at), path.join(repo, CHILD), 'dir');
    putWorkspace(repo, { children: [CHILD], includeAsked: [CHILD], ...(included ? { includedChildren: [CHILD] } : {}), ...(keptFor ? { keptFor } : {}) });
}

const seen = (repo) => ({ over: overrides(repo), rows: keyRows(repo) });
// Runs the actions with the child laid down after the first one; `steps` are the args of each step after the first (an update
// by default), and `after` reads each step's tree and may change it for the next.
const run = (actions, { steps = [], first = [], env = ACCOUNT_ON, childOptions = {}, after = seen } = {}) =>
    seedRun(actions, SELECTION, { args: [[...SCOPE, ...first], ...actions.slice(1).map((_, i) => steps[i] || UPDATE)], env, each: (repo, i) => { if (i === 0) child(repo, childOptions); return after(repo, i); } });
const NAMES = [`${CHILD}:javascript`, `${CHILD}:${DROPPED}`];

test('a root with a linked child hides the child\'s copy of each skill it lists, and no skill the child holds of its own', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update'], { childOptions: { links: ['javascript', DROPPED, 'csharp'] } });
    assert.deepStrictEqual(steps[0].over, {}, 'the child was not there at the install');
    for (const name of NAMES) assert.strictEqual(steps[1].over[name], OFF, outs[1]);
    assert.ok(!Object.keys(steps[1].over).some((key) => /csharp|hand-made/.test(key)), `${JSON.stringify(steps[1].over)}: a skill the root does not list, and a folder no record names, stay visible`);
    assert.strictEqual(steps[1].rows.length, Object.keys(steps[1].over).length, 'one ledger row a key');
});

test('a re-run changes nothing: the settings file and the stamp\'s ledger line stay byte for byte', POSIX_ONLY, () =>
{
    const bytes = (repo) => [fs.readFileSync(localOf(repo), 'utf8'), (/^managed-settings: .*$/m.exec(fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8')) || [])[0]];
    const { steps } = run(['install', 'update', 'update', 'update'], { after: bytes });
    assert.match(steps[1][1], /skillOverrides\{/, 'the first run after the join writes the rows');
    assert.deepStrictEqual(steps[2], steps[1]);
    assert.deepStrictEqual(steps[3], steps[1]);
});

// What the child's stamp links after the run, and what the root links itself: the keys are the two lists' common names.
const linkedNames = (repo, rel) => stampLib.readLinks(path.join(repo, ...rel, '.claude', 'alfred-code.stamp')).filter((e) => e.path.startsWith('skills/')).map((e) => e.path.slice(7));
const rootLinks = (repo) => fs.readdirSync(path.join(repo, '.claude', 'skills'));

test('the first root run after a child joins writes a key for every skill the run links into the child, not the one the child held before', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update'], {
        after: (repo) => ({ over: overrides(repo), expected: linkedNames(repo, [CHILD]).filter((name) => rootLinks(repo).includes(name)).map((name) => `${CHILD}:${name}`).sort() }),
    });
    assert.ok(steps[1].expected.length > 5, `the run re-links the child to the root's whole set: ${steps[1].expected.length}\n${outs[1]}`);
    assert.deepStrictEqual(Object.keys(steps[1].over).sort(), steps[1].expected);
});

test('a member pick the root links into its own .claude/skills gets a key, though the root\'s own list does not name it', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { childOptions: { links: ['javascript', 'csharp'], ownPicks: 'skill/csharp' }, after: (repo) => ({ over: overrides(repo), linked: rootLinks(repo).includes('csharp') }) });
    assert.ok(steps[1].linked, 'the root links the member pick itself');
    assert.strictEqual(steps[1].over[`${CHILD}:csharp`], OFF);
});

test('a set-aside child that holds a link to a skill the root links is hidden the same way', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { childOptions: { included: false }, after: (repo) => ({ over: overrides(repo), links: linkedNames(repo, [CHILD]) }) });
    assert.ok(steps[1].links.includes('javascript'), `the child keeps its link: ${steps[1].links}`);
    assert.strictEqual(steps[1].over[`${CHILD}:javascript`], OFF);
});

// A project laid down below the root with one link to the root's skill, a real project of its own.
function plant(repo, rel)
{
    const at = path.join(repo, ...rel.split('/'));
    fs.mkdirSync(path.join(at, '.claude', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(at, '.claude', 'alfred-code.stamp'), 'seats-route: plugin\nown-picks: \nlinks: skills/javascript=symlink\n');
    fs.symlinkSync(path.relative(path.join(at, '.claude', 'skills'), path.join(repo, '.alfred', 'stack', 'skills', 'javascript')), path.join(at, '.claude', 'skills', 'javascript'), 'dir');
    fs.writeFileSync(path.join(at, '.gitignore'), '.claude/\n.alfred/\n');
    rt.execCommand('git', ['init', '-q', at]);
    putWorkspace(at, { parent: '..' });
}

test('a grandchild is keyed by its whole path from the root', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], {
        childOptions: { links: ['javascript'] },
        after: (repo, i) =>
        {
            if (i === 0) { plant(repo, 'api/grand'); putWorkspace(path.join(repo, CHILD), { parent: '..', children: ['grand'] }); }
            return overrides(repo);
        },
    });
    assert.strictEqual(steps[1][`${CHILD}/grand:javascript`], OFF, JSON.stringify(steps[1]));
    assert.strictEqual(steps[1][`${CHILD}:javascript`], OFF);
});

test('a project the workspace ignores loses its keys: a joined child has them, and the same project once ignored has none', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'update'], {
        childOptions: { links: ['javascript'] },
        after: (repo, i) =>
        {
            if (i === 0) { plant(repo, 'other'); putWorkspace(repo, { children: [CHILD, 'other'], includedChildren: [CHILD, 'other'], includeAsked: [CHILD, 'other'] }); }
            if (i === 1) putWorkspace(repo, { children: [CHILD, 'other'], includedChildren: [CHILD, 'other'], includeAsked: [CHILD, 'other'], ignoredChildren: ['other'] });
            return overrides(repo);
        },
    });
    assert.strictEqual(steps[1]['other:javascript'], OFF, `joined, it has the key: ${JSON.stringify(steps[1])}`);
    assert.ok(!Object.keys(steps[2]).some((key) => key.startsWith('other:')), `ignored, it has none: ${JSON.stringify(steps[2])}`);
    assert.strictEqual(steps[2][`${CHILD}:javascript`], OFF, 'the other child keeps its key');
});

test('a child that is a symlink to a project outside the root keeps its key path inside the root', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { childOptions: { symlinked: true } });
    assert.strictEqual(steps[1].over[`${CHILD}:javascript`], OFF, JSON.stringify(Object.keys(steps[1].over).slice(0, 4)));
    assert.ok(!Object.keys(steps[1].over).some((key) => key.includes('..')), 'no key leaves the root');
});

test('with docs memory on, two consecutive runs leave the stamp byte for byte the same: the key rows keep the ledger\'s order', POSIX_ONLY, () =>
{
    const stampText = (repo) => fs.readFileSync(path.join(repo, '.claude', 'alfred-code.stamp'), 'utf8').split('\n').filter((l) => !/^(installed|installed-ms|initialised|action):/.test(l)).join('\n');
    const { steps } = run(['install', 'update', 'update', 'update'], { first: ['--memory', 'docs'], after: (repo) => stampText(repo) });
    assert.match(steps[1], /autoMemoryDirectory=/, 'the memory row is ledgered');
    assert.match(steps[1], /skillOverrides\{/, 'the first run after the join writes the keys');
    assert.strictEqual(steps[2], steps[1], 'the run that wrote the keys and the run after it leave one stamp');
    assert.strictEqual(steps[3], steps[1]);
    assert.ok(steps[1].indexOf('skillOverrides{') < steps[1].indexOf('autoMemoryDirectory='), 'the memory row stays last');
});

test('an uninstall at the root takes its keys out of settings.local.json and leaves the user\'s', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'uninstall'], {
        steps: [null, SCOPE],
        after: (repo, i) =>
        {
            if (i === 0) fs.writeFileSync(localOf(repo), JSON.stringify({ skillOverrides: { mine: OFF } }));
            return overrides(repo);
        },
    });
    assert.ok([...NAMES, 'mine'].every((key) => Object.hasOwn(steps[1], key)), JSON.stringify(steps[1]));
    assert.deepStrictEqual(steps[2], { mine: OFF });
});

test('a key the user already holds is theirs: kept as set, never ledgered', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], {
        after: (repo, i) => { if (i === 0) fs.writeFileSync(localOf(repo), JSON.stringify({ skillOverrides: { [NAMES[0]]: 'on' } })); return seen(repo); },
    });
    assert.strictEqual(steps[1].over[NAMES[0]], 'on');
    assert.strictEqual(steps[1].over[NAMES[1]], OFF);
    assert.strictEqual(steps[1].rows.length, Object.keys(steps[1].over).length - 1, 'a row for each key but the user\'s');
});

test('a skill the root drops loses its key at the next run, and a key the user then changed to on stays', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'update', 'update', 'update'], {
        steps: [null, null, [...UPDATE, '--drop', `skill ${DROPPED}`]],
        after: (repo, i) =>
        {
            const got = seen(repo);
            if (i === 3) fs.writeFileSync(localOf(repo), JSON.stringify({ ...readJson(localOf(repo)), skillOverrides: { ...got.over, [NAMES[0]]: 'on' } }));
            return got;
        },
    });
    assert.ok(NAMES.every((name) => steps[2].over[name] === OFF), JSON.stringify(steps[2].over));
    assert.strictEqual(steps[3].over[NAMES[1]], undefined, 'the dropped skill\'s key went');
    assert.strictEqual(steps[3].over[NAMES[0]], OFF);
    assert.strictEqual(steps[4].over[NAMES[0]], 'on', 'a value the user changed is theirs');
    assert.strictEqual(steps[4].rows.length, steps[3].rows.length - 1, 'the row of that key is dropped');
});

test('the workspace switch at 0 writes no key', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { env: { ALFRED_CODE_WORKSPACE: '0' } });
    assert.deepStrictEqual(steps[1].over, {});
});

test('a print-plan run writes no key', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'update'], { steps: [[...UPDATE, '--print-plan']] });
    assert.deepStrictEqual(steps[1].over, {});
    assert.ok(Object.keys(steps[2].over).length > 0, 'the next real run writes them');
});

test('nothing is written into the child', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { after: (repo, i) => (i === 0 ? false : fs.existsSync(path.join(repo, CHILD, '.claude', 'settings.local.json'))) });
    assert.strictEqual(steps[1], false);
});

test('a child skill the root does not list, and a folder no record names, stay visible', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update'], { childOptions: { links: [], handMade: ['javascript'] } });
    assert.deepStrictEqual(steps[1].over, {}, 'a javascript folder no record names is the child\'s own');
});

// The kept rule: the root drops a rule its set-aside child keeps; the root's marked native file goes on loading unless the exclude hides it.
const KEEP = [...UPDATE, '--drop', `rule ${RULE}`];
const kept = (repo) => ({ glob: excludes(repo).includes(ruleGlob(repo)), native: fs.existsSync(path.join(repo, '.claude', 'rules', `${RULE}.md`)) });
const keeper = (extra = {}) => ({ links: [], handMade: [], included: false, keptFor: { [CHILD]: [`rule ${RULE}`] }, ...extra });

test('a rule the root keeps for a set-aside child with its own repository is excluded from root sessions', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update', 'update'], { steps: [KEEP], childOptions: keeper(), after: kept });
    assert.strictEqual(steps[0].glob, false, 'the root lists the rule itself at the first run');
    for (const i of [1, 2]) assert.deepStrictEqual(steps[i], { glob: true, native: true }, outs[i]);
});

test('a rule kept for a set-aside child that shares the root\'s repository stays loading, and the log names the rule and the child', POSIX_ONLY, () =>
{
    const { outs, steps } = run(['install', 'update'], { steps: [KEEP], childOptions: keeper({ shareRepo: true }), after: kept });
    assert.deepStrictEqual(steps[1], { glob: false, native: true }, outs[1]);
    assert.match(outs[1], new RegExp(`workspace: rule ${RULE} stays loading here - ${CHILD} keeps it and shares this repository's settings`));
});

test('the rule\'s exclude leaves once the child ignores the rule', POSIX_ONLY, () =>
{
    const { steps } = run(['install', 'update', 'update'], {
        steps: [KEEP], childOptions: keeper(),
        after: (repo, i) => { const got = kept(repo); if (i === 1) putWorkspace(path.join(repo, CHILD), { parent: '..', ignore: { rule: [RULE] } }); return got; },
    });
    assert.deepStrictEqual(steps[1], { glob: true, native: true });
    assert.strictEqual(steps[2].glob, false);
});

const FOLDS_CASE = { skip: POSIX_ONLY.skip || (process.platform === 'linux' && 'the disk keeps case') };
test('a key spells the child\'s path as the disk does, not as the record wrote it', FOLDS_CASE, () =>
{
    const { steps } = run(['install', 'update'], {
        after: (repo, i) =>
        {
            if (i === 0) putWorkspace(repo, { children: ['API'], includedChildren: ['API'], includeAsked: ['API'] });
            return overrides(repo);
        },
    });
    assert.strictEqual(steps[1][`${CHILD}:javascript`], OFF, JSON.stringify(steps[1]));
});
