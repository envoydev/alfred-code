'use strict';
// THE SMALL SEEDS AND THE PINS - Phase 7, T4b.
//
// Both layers write into files the project or the user owns, so every test here is about what is
// NOT written: an instruction file (AGENTS.md or CLAUDE.md) that already exists, a key the run was not handed, a credential value in
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

// --- AGENTS.md ------------------------------------------------------------

const TEMPLATE = { 'stack/AGENTS.template.md': '# __PROJECT_NAME__\n\nOutline.\n' };

test('AGENTS.md: seeded to .claude/AGENTS.md from the template with the project name stamped in', () =>
{
    const source = dir(TEMPLATE);
    const projectRoot = dir();
    const logs = [];
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: source, log: (m) => logs.push(m) }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'AGENTS.md'), 'utf8'), `# ${path.basename(projectRoot)}\n\nOutline.\n`);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')) && !fs.existsSync(path.join(projectRoot, 'AGENTS.md')), 'nothing else is written');
    assert.ok(logs.some((m) => /2\.1\.277/.test(m)), `the version floor is named: ${logs.join(' | ')}`);
});

test('AGENTS.md: a root AGENTS.md is the project\'s own file - nothing is seeded beside it, and it is never touched', () =>
{
    const projectRoot = dir({ 'AGENTS.md': '# Agents\n' });
    const logs = [];
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: dir(TEMPLATE), log: (m) => logs.push(m) }), false);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude')), 'no .claude/AGENTS.md next to it');
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), '# Agents\n');
    assert.ok(logs.some((m) => /AGENTS\.md is the project's own instruction file - nothing seeded/.test(m)), logs.join(' | '));
});

test('AGENTS.md: any existing instruction file stops the seed - two copies would both load', () =>
{
    const source = dir(TEMPLATE);
    for (const rel of ['AGENTS.md', '.claude/AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md'])
    {
        const projectRoot = dir({ [rel]: '# mine\n' });
        const logs = [];
        assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: source, log: (m) => logs.push(m) }), false, rel);
        assert.strictEqual(fs.readFileSync(path.join(projectRoot, rel), 'utf8'), '# mine\n');
        assert.ok(logs.some((m) => /nothing seeded, left as-is/.test(m)), logs.join(' | '));
        assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')) || rel === '.claude/AGENTS.md', `${rel}: no second file`);
    }
});

test('AGENTS.md: only .claude/AGENTS.md present - kept as it is and a re-run changes nothing', () =>
{
    const source = dir(TEMPLATE);
    const projectRoot = dir({ '.claude/AGENTS.md': '# filled in by hand\n' });
    for (let i = 0; i < 2; i++) assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: source }), false);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'AGENTS.md'), 'utf8'), '# filled in by hand\n');
    // and the seed itself is idempotent: a second run over the file the first wrote leaves it
    const fresh = dir();
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot: fresh, sourceDir: source }), true);
    const first = fs.readFileSync(path.join(fresh, '.claude', 'AGENTS.md'), 'utf8');
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot: fresh, sourceDir: source }), false);
    assert.strictEqual(fs.readFileSync(path.join(fresh, '.claude', 'AGENTS.md'), 'utf8'), first);
});

test('AGENTS.md: a CLAUDE.local.md beside the seed is named - it makes Claude Code stop reading AGENTS.md', () =>
{
    const projectRoot = dir({ 'CLAUDE.local.md': 'mine\n' });
    const logs = [];
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: dir(TEMPLATE), log: (m) => logs.push(m) }), true);
    assert.ok(logs.some((m) => /CLAUDE\.local\.md here already switches it off/.test(m)), logs.join(' | '));
});

test('AGENTS.md: a template missing from the snapshot is reported, and nothing is written', () =>
{
    const projectRoot = dir();
    const notes = [];
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: dir(), note: (m) => notes.push(m) }), false);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')));
    assert.ok(notes.some((m) => /AGENTS\.template\.md not found/.test(m)), notes.join(' | '));
});

// --- update: the 2.1.6 seed moves from CLAUDE.md to AGENTS.md, only while it is still the stack's ------

const crypto = require('node:crypto');
const hashOf = (p) => crypto.createHash('sha256').update(`${path.basename(p)}\0`).update(fs.readFileSync(p)).digest('hex');
const move = (projectRoot, over = {}) =>
{
    const logs = [];
    const gitMvs = [];
    const ledgerHash = over.ledgerHash === undefined ? hashOf(path.join(projectRoot, '.claude', 'CLAUDE.md')) : over.ledgerHash;
    const r = seeds.moveSeededClaudeMd({
        projectRoot, sourceDir: dir(TEMPLATE), ledgerHash, hash: hashOf, tracked: over.tracked || (() => false),
        gitMv: (a, b) => { gitMvs.push([a, b]); fs.renameSync(a, b); }, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`),
    });
    return { r, logs, gitMvs };
};

test('move: an unedited seeded .claude/CLAUDE.md is renamed to .claude/AGENTS.md, and a re-run finds nothing', () =>
{
    const projectRoot = dir({ '.claude/CLAUDE.md': '# seed\n' });
    const first = move(projectRoot);
    assert.strictEqual(first.r, 'moved');
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')));
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'AGENTS.md'), 'utf8'), '# seed\n');
    assert.deepStrictEqual(first.gitMvs, [], 'untracked: a plain rename');
    assert.ok(first.logs.some((m) => /moved/.test(m) && /2\.1\.277/.test(m)), first.logs.join(' | '));
    assert.strictEqual(move(projectRoot, { ledgerHash: 'x' }).r, 'none', 'idempotent');
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'AGENTS.md'), 'utf8'), '# seed\n');
});

test('move: a tracked seed goes through git mv, and a gitignore re-include of the old name is named', () =>
{
    const projectRoot = dir({ '.claude/CLAUDE.md': '# seed\n', '.gitignore': '.claude/*\n!.claude/CLAUDE.md\n' });
    const m = move(projectRoot, { tracked: () => true });
    assert.strictEqual(m.r, 'moved');
    assert.strictEqual(m.gitMvs.length, 1);
    assert.match(m.gitMvs[0][0], /CLAUDE\.md$/); assert.match(m.gitMvs[0][1], /AGENTS\.md$/);
    assert.ok(m.logs.some((l) => /git mv/.test(l)) && m.logs.some((l) => /'!\.claude\/AGENTS\.md'/.test(l)), m.logs.join(' | '));
});

test('move: an edited seed is left untouched and named with its move command - never renamed for the user', () =>
{
    const projectRoot = dir({ '.claude/CLAUDE.md': '# seed\n' });
    const ledgerHash = hashOf(path.join(projectRoot, '.claude', 'CLAUDE.md'));
    fs.writeFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), '# seed\n\nmy own line\n');
    const m = move(projectRoot, { ledgerHash, tracked: () => true });
    assert.strictEqual(m.r, 'kept-edited');
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), 'utf8'), '# seed\n\nmy own line\n');
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')));
    assert.ok(m.logs.some((l) => /edited since the stack seeded it/.test(l) && /git mv \.claude\/CLAUDE\.md \.claude\/AGENTS\.md/.test(l)), m.logs.join(' | '));
    assert.strictEqual(m.gitMvs.length, 0);
});

test('move: with no ledger row, the current template body is the only proof of an unedited seed', () =>
{
    const a = dir({ '.claude/CLAUDE.md': `# ${'x'}\n` });
    assert.strictEqual(move(a, { ledgerHash: '' }).r, 'kept-edited');
    const b = dir();
    fs.mkdirSync(path.join(b, '.claude'));
    fs.writeFileSync(path.join(b, '.claude', 'CLAUDE.md'), `# ${path.basename(b)}\n\nOutline.\n`);
    assert.strictEqual(move(b, { ledgerHash: '' }).r, 'moved');
});

test('move: a root AGENTS.md holds the instructions - the seed stays, the situation is named, nothing splits', () =>
{
    const projectRoot = dir({ 'AGENTS.md': '# Agents\n', '.claude/CLAUDE.md': '# seed\n' });
    const m = move(projectRoot);
    assert.strictEqual(m.r, 'kept-root');
    assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')) && !fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')));
    assert.ok(m.logs.some((l) => /root AGENTS\.md holds its instructions/.test(l)), m.logs.join(' | '));
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), '# Agents\n');
});

test('move: both .claude files present is named and left, and no CLAUDE.md at all is nothing to do', () =>
{
    const both = dir({ '.claude/CLAUDE.md': '# a\n', '.claude/AGENTS.md': '# b\n' });
    const m = move(both);
    assert.strictEqual(m.r, 'kept-both');
    assert.strictEqual(fs.readFileSync(path.join(both, '.claude', 'AGENTS.md'), 'utf8'), '# b\n');
    assert.strictEqual(seeds.moveSeededClaudeMd({ projectRoot: dir(), sourceDir: dir(TEMPLATE), hash: hashOf }), 'none');
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
