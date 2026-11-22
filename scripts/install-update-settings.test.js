'use strict';
// What `/alfred-code:update` (update --installed-only, NO --selection) does to a project's settings files, end to end:
// a hook the user switched off by hand while its copy stayed on disk (F1), and the `{}` an update from an older
// release left in .claude/settings.json (F2). Every case reads the files the run left.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');
const { seedRun, POSIX_ONLY, updateInstalled, plantSharedInstall } = require('./seed-sandbox.js');

const SELECTION = 'agent aspnet-implementer\nrule markdown-docs\n';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false' };
const OFF_KEY = 'ALFRED_CODE_HOOKS_OFF';
const WHOLE_HOOK = 'guard-read-whole-file';
const PART_ENTRY = 'guard-ungated-commit:push';

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const localFile = (repo) => path.join(repo, '.claude', 'settings.local.json');
const sharedFile = (repo) => path.join(repo, '.claude', 'settings.json');
const hookFile = (repo, name) => path.join(repo, '.claude', 'hooks', `${name}.js`);
const offList = (repo) => String((((readJson(localFile(repo)) || {}).env) || {})[OFF_KEY] || '').split(',').filter(Boolean);

// What the user does by hand: names a hook in the off-list of settings.local.json.
function switchOff(repo, ...entries)
{
    const data = readJson(localFile(repo)) || {};
    const held = String((data.env || {})[OFF_KEY] || '').split(',').filter(Boolean);
    data.env = { ...(data.env || {}), [OFF_KEY]: [...held, ...entries].join(',') };
    fs.writeFileSync(localFile(repo), `${JSON.stringify(data, null, 2)}\n`);
}

// A copied hook the off-list names whole is read as off, and on every copy route the update drops it as `--drop 'hook <name>'`
// does: its copy goes, its wiring goes, the off-list is what the route writes (the name on the hooks-only copy route, none on the
// full copy route). A part entry leaves its hook picked. Leaving the copy route
// prunes every copy, so only the off-list is asserted there.
const FULL_COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const wiresHook = (repo, name) => JSON.stringify((readJson(localFile(repo)) || {}).hooks || {}).includes(`/.claude/hooks/${name}.js`);
const hooksFolder = (repo) => fs.readdirSync(path.join(repo, '.claude', 'hooks')).sort();
const stateOf = (repo) => ({ off: offList(repo).sort(), local: fs.readFileSync(localFile(repo), 'utf8'), hooks: hooksFolder(repo) });

// The full copy route writes no whole-hook name: its off-state is the missing copy (derive-state `writable`), so only the part entry stays.
for (const [label, installEnv, updateEnv, copyRoute, listsWhole] of [
    ['hooks-only copy route (the core stays)', COPY_ROUTE, COPY_ROUTE, true, true],
    ['full copy route', FULL_COPY_ROUTE, FULL_COPY_ROUTE, true, false],
    ['leaving the copy route', COPY_ROUTE, {}, false, true],
])
{
    test(`update with no selection, ${label}: a copied hook the off-list names whole is dropped (copy and wiring go), the off-list as the route writes it - a part entry kept`, POSIX_ONLY, () =>
    {
        const { result } = seedRun(['install'], SELECTION, { plugins: PLUGINS, env: installEnv, inspect: (repo) =>
        {
            assert.ok(fs.existsSync(hookFile(repo, WHOLE_HOOK)) && fs.existsSync(hookFile(repo, 'guard-ungated-commit')), 'the copy route copies every hook');
            switchOff(repo, WHOLE_HOOK, PART_ENTRY);
            updateInstalled(repo, { env: updateEnv });
            const first = { ...stateOf(repo), wholeCopy: fs.existsSync(hookFile(repo, WHOLE_HOOK)), partCopy: fs.existsSync(hookFile(repo, 'guard-ungated-commit')),
                wholeWired: wiresHook(repo, WHOLE_HOOK), partWired: wiresHook(repo, 'guard-ungated-commit') };
            updateInstalled(repo, { env: updateEnv });
            return { first, again: stateOf(repo) };
        } });
        const { first, again } = result;
        assert.ok(first.off.includes(PART_ENTRY), `the part entry stays in the off-list: ${first.off}`);
        assert.strictEqual(first.off.includes(WHOLE_HOOK), listsWhole, `the off-list names the whole hook only where the route writes one: ${first.off}`);
        assert.strictEqual(first.wholeCopy, false, 'the copy of the hook the list names is gone');
        assert.strictEqual(first.wholeWired, false, 'and so is its wiring');
        if (copyRoute)
        {
            assert.strictEqual(first.partCopy, true, 'a part entry leaves its hook picked: its copy stays');
            assert.strictEqual(first.partWired, true, 'and wired');
        }
        assert.deepStrictEqual(again, { off: first.off, local: first.local, hooks: first.hooks }, 'a second update changes nothing');
    });
}

// F2: an update from an older release moves the stack's rows out of settings.json and leaves it holding `{}`.
function updateOverSharedInstall({ prepareAfterInstall = () => {}, track = false } = {})
{
    return seedRun(['install'], SELECTION, { plugins: PLUGINS, inspect: (repo) =>
    {
        plantSharedInstall(repo);
        prepareAfterInstall(repo);
        if (track) { rt.execCommand('git', ['add', '-f', '.claude/settings.json'], { cwd: repo }); }
        const out = updateInstalled(repo);
        return { out, shared: readJson(sharedFile(repo)), exists: fs.existsSync(sharedFile(repo)), local: readJson(localFile(repo)) };
    } }).result;
}

test('update over a settings.json install: the emptied settings.json is removed and the log says so', POSIX_ONLY, () =>
{
    const r = updateOverSharedInstall();
    assert.strictEqual(r.exists, false, '.claude/settings.json held nothing and is gone');
    assert.ok(r.out.includes('settings.json removed - it held nothing'), r.out);
    assert.ok(r.local && r.local.env, 'the rows moved to settings.local.json');
});

test('update over a settings.json install: a key of the user\'s own keeps settings.json', POSIX_ONLY, () =>
{
    const r = updateOverSharedInstall({ prepareAfterInstall: (repo) =>
    {
        const data = readJson(sharedFile(repo));
        fs.writeFileSync(sharedFile(repo), JSON.stringify({ ...data, permissions: { allow: ['Bash(ls)'] } }, null, 2));
    } });
    assert.deepStrictEqual(r.shared, { permissions: { allow: ['Bash(ls)'] } });
    assert.ok(!r.out.includes('settings.json removed'), r.out);
});

test('update with a git-tracked settings.json of {} the run did not change: it stays, and one line names it', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install'], SELECTION, { plugins: PLUGINS, inspect: (repo) =>
    {
        fs.writeFileSync(sharedFile(repo), '{}\n');
        rt.execCommand('git', ['add', '-f', '.claude/settings.json'], { cwd: repo });
        const out = updateInstalled(repo);
        return { out, exists: fs.existsSync(sharedFile(repo)), text: fs.readFileSync(sharedFile(repo), 'utf8') };
    } });
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.text, '{}\n', 'the file is as the user committed it');
    assert.ok(/settings\.json: kept - it holds nothing, but git tracks it/.test(result.out), result.out);
});

test('update with an untracked settings.json of {} the run did not change: it is removed', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install'], SELECTION, { plugins: PLUGINS, inspect: (repo) =>
    {
        fs.writeFileSync(sharedFile(repo), '{}\n');
        const out = updateInstalled(repo);
        return { out, exists: fs.existsSync(sharedFile(repo)) };
    } });
    assert.strictEqual(result.exists, false);
    assert.ok(result.out.includes('settings.json removed - it held nothing'), result.out);
});

test('update over an unparseable settings.json: it stays untouched', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install'], SELECTION, { plugins: PLUGINS, inspect: (repo) =>
    {
        fs.writeFileSync(sharedFile(repo), '{ not json');
        const out = updateInstalled(repo);
        return { out, text: fs.existsSync(sharedFile(repo)) ? fs.readFileSync(sharedFile(repo), 'utf8') : null };
    } });
    assert.strictEqual(result.text, '{ not json');
});

// A settings.json this run cannot remove (a read-only folder) is named, never fatal: the installer is fail-soft.
test('dropEmptySharedSettings: a file that cannot be removed is named in a note and the run goes on', POSIX_ONLY, (t) =>
{
    if (process.getuid && process.getuid() === 0) { t.skip('root removes a file from a read-only folder'); return; }
    const settings = require('./install/settings.js');
    const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'empty-shared-'));
    const file = path.join(folder, 'settings.json');
    fs.writeFileSync(file, '{}\n');
    fs.chmodSync(folder, 0o555);
    try
    {
        const notes = [];
        assert.strictEqual(settings.dropEmptySharedSettings({ file, tracked: () => false, log: () => {}, note: (m) => notes.push(m) }), false);
        assert.ok(fs.existsSync(file), 'the file stays');
        assert.ok(notes.length === 1 && notes[0].includes('settings.json'), notes.join('\n'));
    }
    finally { fs.chmodSync(folder, 0o755); fs.rmSync(folder, { recursive: true, force: true }); }
});

// WRITTEN is the run's own record: a second run in the same process (a test calling main twice) starts with none.
test('dropEmptySharedSettings: a write of an earlier run in the same process is not this run\'s change', () =>
{
    const settings = require('./install/settings.js');
    const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'empty-shared-'));
    const file = path.join(folder, 'settings.json');
    try
    {
        fs.writeFileSync(file, JSON.stringify({ deniedMcpServers: [{ serverName: 'x' }] }));
        settings.applyMcpDeny({ file, lift: ['x'] });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {}, 'the run itself left the {}');
        assert.strictEqual(settings.dropEmptySharedSettings({ file, tracked: () => true }), true, 'a tracked {} this run wrote goes');
        settings.beginRun();
        fs.writeFileSync(file, '{}\n');
        assert.strictEqual(settings.dropEmptySharedSettings({ file, tracked: () => true }), false, 'a tracked {} the next run did not write stays');
        assert.ok(fs.existsSync(file));
    }
    finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
