'use strict';
// Bug 5 of the complexity audit (2026-11-10): four folder keys under three rules. Task 5's probe (Claude Code 2.1.322 on
// darwin, an isolated account) showed the CLI matches a project-scope row case-exact: a row whose projectPath was re-spelled
// <dir>/PROJ was 'not installed in project scope' from <dir>/Proj, and its record stayed. So two rules, each with one home:
//   - the TREE key, layout.pathKey (workspace.realKey is it): the real path, '/' separated, case-folded on darwin, win32 and
//     any drive-letter path - for the folders the installer walks and compares;
//   - the LISTING key, plugins.projectKey (copied into awareness-state.js, which ships without the installer): a drive-letter
//     path folded, any other path its real path with its case kept - the plugin listing's own compare.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const layout = require('../stack/hooks/layout.js');
const workspace = require('./install/workspace.js');
const plugins = require('./install/plugins.js');
const awareness = require('../stack/skills/capture-awareness/scripts/awareness-state.js');
const { realLong } = require('./test-paths.js');

const TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'path-key-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const NO_LINKS = { skip: process.platform === 'win32' && 'links need privileges on Windows' };

// Every tree row runs through layout.pathKey, and through workspace.realKey where the row's platform is this host's -
// realKey takes the path alone, since its callers hand it to Array.map.
const treeKey = (p, platform) =>
{
    const a = layout.pathKey(p, platform);
    if (platform === process.platform) assert.strictEqual(workspace.realKey(p), a, `realKey and pathKey disagree on ${p}`);
    return a;
};
// Every listing row runs through plugins.projectKey and awareness-state's copy, which must agree.
const listingKey = (p, platform) =>
{
    const a = plugins.projectKey(p, platform);
    assert.strictEqual(awareness.projectKey(p, platform), a, `the two listing keys disagree on ${p} (${platform})`);
    return a;
};

test('the tree key folds case on darwin and win32, keeps it on linux', () =>
{
    assert.strictEqual(treeKey('/Repo', 'darwin'), treeKey('/repo', 'darwin'));
    assert.notStrictEqual(treeKey('/Repo', 'linux'), treeKey('/repo', 'linux'));
});

test('a drive-letter path folds case and separators under both keys, on any host', () =>
{
    for (const key of [treeKey, listingKey])
    {
        assert.strictEqual(key('c:\\Users\\dev\\App', 'linux'), key('C:/Users/Dev/app/', 'linux'));
        assert.strictEqual(key('C:\\A\\b', 'win32'), key('c:/a/B/', 'win32'));
    }
});

test('the listing key keeps a POSIX path\'s case on darwin and linux - the CLI\'s own compare', () =>
{
    for (const platform of ['darwin', 'linux']) assert.notStrictEqual(listingKey('/Repo', platform), listingKey('/repo', platform), platform);
});

test('realKey handed to Array.map keys each path as it keys it alone - the index is never read as a platform', () =>
{
    const paths = ['/Repo', TMP, path.join(TMP, 'Gone')];
    assert.deepStrictEqual(paths.map(workspace.realKey), paths.map((p) => workspace.realKey(p)));
});

test('a trailing separator makes no difference', () =>
{
    for (const key of [treeKey, listingKey]) for (const platform of ['darwin', 'linux']) assert.strictEqual(key(`${TMP}/`, platform), key(TMP, platform));
});

test('a symlink keys as its target under both keys', NO_LINKS, () =>
{
    const target = path.join(TMP, 'target');
    const link = path.join(TMP, 'link');
    fs.mkdirSync(target, { recursive: true });
    if (!fs.existsSync(link)) fs.symlinkSync(target, link);
    for (const key of [treeKey, listingKey]) assert.strictEqual(key(link, process.platform), key(target, process.platform));
});

test('a path that does not exist keys as its resolved spelling, never a throw', () =>
{
    const gone = path.join(TMP, 'Gone', 'Repo');
    const posix = path.resolve(gone).split(path.sep).join('/');
    // On Windows the temp dir is a drive-letter path, which both keys fold on any platform.
    const kept = /^[A-Za-z]:\//.test(posix) ? posix.toLowerCase() : posix;
    assert.strictEqual(treeKey(gone, 'linux'), kept);
    assert.strictEqual(treeKey(gone, 'darwin'), posix.toLowerCase());
    assert.strictEqual(listingKey(gone, 'darwin'), kept);
});

test('on darwin an existing folder spelled in upper case keeps that case in the listing key (never realpathSync.native)', { skip: process.platform !== 'darwin' && 'the on-disk case fold is a darwin read' }, () =>
{
    const dir = realLong(fs.mkdtempSync(path.join(TMP, 'pk-case-')));
    const spelled = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
    assert.ok(fs.existsSync(spelled), 'the disk folds case');
    assert.strictEqual(listingKey(spelled, 'darwin'), spelled);
    assert.strictEqual(treeKey(spelled, 'darwin'), dir.toLowerCase());
});
