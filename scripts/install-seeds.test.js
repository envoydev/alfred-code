'use strict';
// THE SMALL SEEDS AND THE PINS - Phase 7, T4b.
//
// Both layers write into files the project or the user owns, so every test here is about what is
// NOT written: a CLAUDE.md that already exists, a key the run was not handed, a credential value in
// a log line, a pin the refresh did not change.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const seeds = require('./install/seeds.js');
const pins = require('./install/pins.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'install-seeds-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
const dir = (files = {}) =>
{
    const base = path.join(TMP, `d-${seq++}`);
    fs.mkdirSync(base, { recursive: true });
    for (const [rel, body] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), body);
    }
    return base;
};
const FM = (model, effort) => `---\nname: x\n${model ? `model: ${model}\n` : ''}${effort ? `effort: ${effort}\n` : ''}---\n\nBody with model: prose that is not a pin.\n`;

// --- the account env keys -------------------------------------------------

test('account keys: a credential is logged BY LENGTH, a plain value by value', () =>
{
    const configDir = dir();
    const logs = [];
    seeds.seedAccountKeys({ configDir, env: { CONTEXT7_API_KEY: 'ctx7-xyz' }, log: (m) => logs.push(m), note: () => {} });
    seeds.seedAccountEnv({ configDir, key: 'PLAIN_SLUG', value: 'acme/web', log: (m) => logs.push(m), note: () => {} });
    const all = logs.join('\n');
    assert.match(all, /CONTEXT7_API_KEY=set \(8 chars\)/);
    assert.match(all, /PLAIN_SLUG=acme\/web written/);
    assert.ok(!all.includes('ctx7-xyz'), 'an api key value reached a log line');
});

test('account keys: 2.0.0 writes no sentry key, and leaves the ones an older run wrote', () =>
{
    const configDir = dir({ 'settings.json': JSON.stringify({ env: { SENTRY_SLUG: 'acme', SENTRY_ACCESS_TOKEN: 'kept' } }) });
    const written = seeds.seedAccountKeys({ configDir, env: { SENTRY_ACCESS_TOKEN: 'handed', SENTRY_SLUG: 'other' }, log: () => {}, note: () => {} });
    assert.deepStrictEqual(written, []);
    const env = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')).env;
    assert.deepStrictEqual(env, { SENTRY_SLUG: 'acme', SENTRY_ACCESS_TOKEN: 'kept' });
});

test('account keys: a key the run was NOT handed is never written, let alone cleared', () =>
{
    const configDir = dir({ 'settings.json': JSON.stringify({ env: { CONTEXT7_API_KEY: 'kept', OTHER: '1' } }) });
    const written = seeds.seedAccountKeys({ configDir, env: {}, log: () => {}, note: () => {} });
    assert.deepStrictEqual(written, []);
    const env = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')).env;
    assert.deepStrictEqual(env, { CONTEXT7_API_KEY: 'kept', OTHER: '1' });
});

test('account keys: an unchanged value does not rewrite the file', () =>
{
    const configDir = dir({ 'settings.json': `${JSON.stringify({ env: { CONTEXT7_API_KEY: 'ctx7-same' } }, null, 4)}\n` });
    const before = fs.readFileSync(path.join(configDir, 'settings.json'));
    const logs = [];
    const written = seeds.seedAccountKeys({ configDir, env: { CONTEXT7_API_KEY: 'ctx7-same' }, log: (m) => logs.push(m), note: () => {} });
    assert.deepStrictEqual(written, []);
    assert.ok(fs.readFileSync(path.join(configDir, 'settings.json')).equals(before), 'an unchanged run reformatted the account file');
    assert.ok(logs.some((m) => /CONTEXT7_API_KEY already set \(9 chars\)/.test(m)), logs.join(' | '));
});

test('account keys: state reports presence and length, never the value', () =>
{
    const configDir = dir({ 'settings.json': JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: 'sntryu_secret' } }) });
    assert.strictEqual(seeds.accountKeyState(configDir, 'SENTRY_ACCESS_TOKEN'), 'SENTRY_ACCESS_TOKEN=set (13 chars)');
    assert.strictEqual(seeds.accountKeyState(configDir, 'CONTEXT7_API_KEY'), 'CONTEXT7_API_KEY=absent');
    assert.strictEqual(seeds.accountKeyState(dir(), 'SENTRY_SLUG'), 'SENTRY_SLUG=absent');
});

test('account keys: a malformed account file is REFUSED, not overwritten', () =>
{
    const configDir = dir({ 'settings.json': '{ not json' });
    const notes = [];
    seeds.seedAccountKeys({ configDir, env: { CONTEXT7_API_KEY: 'ctx7-xyz' }, log: () => {}, note: (m) => notes.push(m) });
    assert.strictEqual(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'), '{ not json');
    assert.ok(notes.some((m) => /could not write CONTEXT7_API_KEY/.test(m)), notes.join(' | '));
});

// --- CLAUDE.md ------------------------------------------------------------

test('CLAUDE.md: seeded from the template with the project name stamped in', () =>
{
    const source = dir({ 'stack/CLAUDE.template.md': '# __PROJECT_NAME__\n\nOutline.\n' });
    const projectRoot = dir();
    const logs = [];
    assert.strictEqual(seeds.seedClaudeMd({ projectRoot, sourceDir: source, log: (m) => logs.push(m) }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), 'utf8'),
        `# ${path.basename(projectRoot)}\n\nOutline.\n`);
});

test('CLAUDE.md: a root AGENTS.md gets a live import under the H1 - once a CLAUDE.md exists Claude stops reading AGENTS.md on its own', () =>
{
    const source = dir({ 'stack/CLAUDE.template.md': '# __PROJECT_NAME__\n\nOutline.\n' });
    const projectRoot = dir({ 'AGENTS.md': '# Agents\n' });
    const logs = [];
    assert.strictEqual(seeds.seedClaudeMd({ projectRoot, sourceDir: source, log: (m) => logs.push(m) }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), 'utf8'),
        `# ${path.basename(projectRoot)}\n\n@../AGENTS.md\n\nOutline.\n`);
    assert.ok(logs.some((m) => /AGENTS\.md: imported/.test(m)), logs.join(' | '));
});

test('CLAUDE.md: no AGENTS.md, no import line', () =>
{
    const source = dir({ 'stack/CLAUDE.template.md': '# __PROJECT_NAME__\n\nOutline.\n' });
    const projectRoot = dir({ 'agents.txt': 'x\n' });
    assert.strictEqual(seeds.seedClaudeMd({ projectRoot, sourceDir: source }), true);
    assert.ok(!/@\.\.\/AGENTS\.md/.test(fs.readFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), 'utf8')));
});

test('CLAUDE.md: EITHER existing location stops the seed - two copies would both auto-load', () =>
{
    const source = dir({ 'stack/CLAUDE.template.md': '# __PROJECT_NAME__\n' });
    for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md'])
    {
        const projectRoot = dir({ [rel]: '# mine\n' });
        const logs = [];
        assert.strictEqual(seeds.seedClaudeMd({ projectRoot, sourceDir: source, log: (m) => logs.push(m) }), false);
        assert.strictEqual(fs.readFileSync(path.join(projectRoot, rel), 'utf8'), '# mine\n');
        assert.ok(logs.some((m) => /already present - left as-is/.test(m)), logs.join(' | '));
    }
});

test('CLAUDE.md: a template missing from the snapshot is reported, and nothing is written', () =>
{
    const projectRoot = dir();
    const notes = [];
    assert.strictEqual(seeds.seedClaudeMd({ projectRoot, sourceDir: dir(), note: (m) => notes.push(m) }), false);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')));
    assert.ok(notes.some((m) => /CLAUDE\.template\.md not found/.test(m)), notes.join(' | '));
});

// --- the playwright downloads --------------------------------------------

test('playwright: only firefox and webkit are downloaded, and a failure is a HINT not a stop', () =>
{
    const asked = [];
    const logs = [];
    const done = seeds.playwrightDownloads({
        browsers: ['chrome', 'firefox', 'msedge', 'webkit'], pin: '@1.0',
        run: (e) => { asked.push(e); return e !== 'webkit'; }, log: (m) => logs.push(m),
    });
    assert.deepStrictEqual(asked, ['firefox', 'webkit'], 'an installed-browser engine was downloaded');
    assert.deepStrictEqual(done, ['firefox']);
    assert.ok(logs.some((m) => /could not download webkit - run by hand: npx -y -p @playwright\/mcp@1\.0/.test(m)), logs.join(' | '));
});

// --- the pins -------------------------------------------------------------

test('pins: a value the refresh CHANGED is put back, one it left alone is not rewritten', () =>
{
    const root = dir({ '.claude/agents/a.md': FM('opus', 'xhigh'), '.claude/agents/b.md': FM('sonnet', 'high') });
    const files = pins.pinFiles({ projectRoot: root, skillsDir: path.join(root, '.claude', 'skills'), agents: ['a.md::x', 'b.md::y'] });
    const snapshot = pins.snapshotPins({ files });
    // The refresh resets a.md to the catalog default and leaves b.md as it was.
    fs.writeFileSync(path.join(root, '.claude/agents/a.md'), FM('sonnet', 'medium'));
    const before = fs.readFileSync(path.join(root, '.claude/agents/b.md'));
    const logs = [];
    assert.strictEqual(pins.restorePins({ snapshot, files, log: (m) => logs.push(m) }), 2);
    assert.strictEqual(pins.readPin(path.join(root, '.claude/agents/a.md'), 'model'), 'opus');
    assert.strictEqual(pins.readPin(path.join(root, '.claude/agents/a.md'), 'effort'), 'xhigh');
    assert.ok(fs.readFileSync(path.join(root, '.claude/agents/b.md')).equals(before), 'an unchanged file was rewritten');
    assert.ok(logs.some((m) => /pin kept: agents\/a\.md model=opus \(upstream: sonnet\)/.test(m)), logs.join(' | '));
});

test('pins: a key the upstream file no longer carries is NOT re-introduced', () =>
{
    const root = dir({ '.claude/agents/a.md': FM('opus', 'xhigh') });
    const files = pins.pinFiles({ projectRoot: root, skillsDir: '', agents: ['a.md::x'] });
    const snapshot = pins.snapshotPins({ files });
    fs.writeFileSync(path.join(root, '.claude/agents/a.md'), FM('sonnet', ''));
    pins.restorePins({ snapshot, files });
    assert.strictEqual(pins.readPin(path.join(root, '.claude/agents/a.md'), 'effort'), '', 'a dropped key was re-added');
    assert.strictEqual(pins.readPin(path.join(root, '.claude/agents/a.md'), 'model'), 'opus');
});

test('pins: only the FRONTMATTER block is read and written, never the body', () =>
{
    const file = path.join(dir({ 'a.md': FM('opus', '') }), 'a.md');
    assert.strictEqual(pins.readPin(file, 'model'), 'opus');
    pins.writePin(file, 'model', 'sonnet');
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /^model: sonnet$/m);
    assert.match(body, /Body with model: prose that is not a pin\./, 'the body was rewritten');
    // A file with no frontmatter at all is not a pin target, however pin-shaped its body looks.
    const plain = path.join(dir({ 'b.md': '# Notes\n\nmodel: opus\neffort: xhigh\n' }), 'b.md');
    assert.strictEqual(pins.readPin(plain, 'model'), '');
    assert.strictEqual(pins.writePin(plain, 'model', 'sonnet'), false);
    assert.strictEqual(fs.readFileSync(plain, 'utf8'), '# Notes\n\nmodel: opus\neffort: xhigh\n');
});

test('pins: the targets are the files the project actually has', () =>
{
    const root = dir({ '.claude/agents/a.md': FM('opus', ''), '.claude/skills/project-x/SKILL.md': FM('sonnet', '') });
    const files = pins.pinFiles({
        projectRoot: root, skillsDir: path.join(root, '.claude', 'skills'),
        agents: ['a.md::x', 'absent.md::y'], skills: ['stack|project-x', 'stack|project-missing'],
    });
    assert.deepStrictEqual(files, [
        path.join(root, '.claude/agents/a.md'),
        path.join(root, '.claude/skills/project-x/SKILL.md'),
    ]);
});

test('pins: a file carrying no pin at all is not snapshotted', () =>
{
    const root = dir({ '.claude/agents/a.md': '---\nname: x\n---\n\nbody\n' });
    const files = pins.pinFiles({ projectRoot: root, skillsDir: '', agents: ['a.md::x'] });
    const logs = [];
    assert.strictEqual(pins.snapshotPins({ files, log: (m) => logs.push(m) }).size, 0);
    assert.ok(logs.some((m) => /snapshotted model\/effort from 0 file/.test(m)), logs.join(' | '));
});
