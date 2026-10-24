'use strict';
// THE SMALL SEEDS AND THE PINS - Phase 7, T4b.
//
// Both layers write into files the project or the user owns, so every test here is about what is
// NOT written: an instruction file (AGENTS.md or CLAUDE.md) that already exists, or a pin the refresh did not change.
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

// --- update: a seed the stack still owns takes the release's template, under the name it was stamped with ------

test('refresh: the owned seed takes the release template, keeps the H1 it was stamped with, and a second call changes nothing', () =>
{
    const sourceDir = dir({ 'stack/AGENTS.template.md': '# __PROJECT_NAME__\n\nNew outline for __PROJECT_NAME__.\n' });
    // Seeded as 'alpha', now checked out under another folder name.
    const projectRoot = dir({ '.claude/AGENTS.md': '# alpha\n\nOld outline - an older release steps.\n' });
    const logs = [];
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot, sourceDir, log: (m) => logs.push(m) }), true);
    const file = path.join(projectRoot, '.claude', 'AGENTS.md');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '# alpha\n\nNew outline for alpha.\n');
    assert.ok(logs.some((m) => /unfilled seed refreshed/.test(m)), logs.join(' | '));
    const again = [];
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot, sourceDir, log: (m) => again.push(m) }), true);
    assert.deepStrictEqual(again, [], 'a current seed is not rewritten');
});

test('refresh: no H1, no file or no template - nothing is written and the caller keeps the earlier seed', () =>
{
    const sourceDir = dir(TEMPLATE);
    const bare = dir({ '.claude/AGENTS.md': 'no title line\n' });
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot: bare, sourceDir }), false);
    assert.strictEqual(fs.readFileSync(path.join(bare, '.claude', 'AGENTS.md'), 'utf8'), 'no title line\n');
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot: dir(), sourceDir }), false);
    const kept = dir({ '.claude/AGENTS.md': '# x\n\nOld.\n' });
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot: kept, sourceDir: dir() }), false);
    assert.strictEqual(fs.readFileSync(path.join(kept, '.claude', 'AGENTS.md'), 'utf8'), '# x\n\nOld.\n');
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

// An AGENTS.md answer kept beside a CLAUDE.local.md (update's ask-local): a renamed seed would sit unread there, so the
// 2.1.6 move leaves it in place, at the root or in .claude/ alike (review 2026-10-23, finding 5).
test('move: an unedited seed beside a CLAUDE.local.md stays .claude/CLAUDE.md - an AGENTS.md there would go unread', () =>
{
    for (const local of ['CLAUDE.local.md', '.claude/CLAUDE.local.md'])
    {
        const projectRoot = dir({ '.claude/CLAUDE.md': '# seed\n', [local]: '# mine\n' });
        const { r, logs, gitMvs } = move(projectRoot);
        assert.strictEqual(r, 'kept-local', local);
        assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')) && !fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')), local);
        assert.deepStrictEqual(gitMvs, []);
        assert.ok(logs.some((m) => /left in place/.test(m) && /CLAUDE\.local\.md/.test(m)), logs.join(' | '));
    }
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
    const kept = move(a, { ledgerHash: '' });
    assert.strictEqual(kept.r, 'kept-edited');
    assert.ok(kept.logs.some((l) => /with no ledger row it cannot be told from an older seed/.test(l)) && !kept.logs.some((l) => /edited since the stack seeded it/.test(l)), kept.logs.join(' | '));
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

// --- where the instruction file lives (--instructions-at) ------------------

test('place: --instructions-at root seeds AGENTS.md at the root, and no .claude/ re-include is asked for', () =>
{
    const projectRoot = dir();
    const logs = [];
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: dir(TEMPLATE), at: 'root', log: (m) => logs.push(m) }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), `# ${path.basename(projectRoot)}\n\nOutline.\n`);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')), 'no second copy under .claude/');
    assert.ok(logs.some((m) => /seeded to AGENTS\.md at the project root/.test(m)), logs.join(' | '));
    assert.ok(!logs.some((m) => /!\.claude\/AGENTS\.md/.test(m)), `a root file needs no re-include: ${logs.join(' | ')}`);
    assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: dir(TEMPLATE), at: 'root' }), false, 'a re-run seeds nothing');
});

test('place: the seed path is .claude/AGENTS.md when it is there, else a root AGENTS.md, else .claude/AGENTS.md', () =>
{
    const at = (files) => { const r = dir(files); return path.relative(r, seeds.seededAgentsMdPath(r)).split(path.sep).join('/'); };
    assert.strictEqual(at({}), '.claude/AGENTS.md');
    assert.strictEqual(at({ 'AGENTS.md': 'x' }), 'AGENTS.md');
    assert.strictEqual(at({ '.claude/AGENTS.md': 'x' }), '.claude/AGENTS.md');
    assert.strictEqual(at({ 'AGENTS.md': 'x', '.claude/AGENTS.md': 'y' }), '.claude/AGENTS.md');
});

test('place: the refresh follows a root seed', () =>
{
    const projectRoot = dir({ 'AGENTS.md': '# kept-name\n\nOld outline.\n' });
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot, sourceDir: dir(TEMPLATE) }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8'), '# kept-name\n\nOutline.\n');
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude')), 'nothing written under .claude/');
});

const place = (projectRoot, at, { tracked = () => false, ignored = () => false } = {}) =>
{
    const logs = [];
    const gitMvs = [];
    const moved = seeds.placeInstructionFiles({
        projectRoot, at, tracked, ignored,
        gitMv: (from, to) => { gitMvs.push([from, to]); fs.renameSync(from, to); },
        log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`),
    });
    return { moved, logs, gitMvs };
};
const body = (root, rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : null);

test('place: root moves .claude/AGENTS.md and .claude/CLAUDE.md up, content kept, and a re-run moves nothing', () =>
{
    const projectRoot = dir({ '.claude/AGENTS.md': '# a\n', '.claude/CLAUDE.md': '# c\n', '.claude/settings.json': '{}' });
    const first = place(projectRoot, 'root');
    assert.deepStrictEqual(first.moved, ['.claude/AGENTS.md -> AGENTS.md', '.claude/CLAUDE.md -> CLAUDE.md']);
    assert.deepStrictEqual([body(projectRoot, 'AGENTS.md'), body(projectRoot, 'CLAUDE.md')], ['# a\n', '# c\n']);
    assert.deepStrictEqual([body(projectRoot, '.claude/AGENTS.md'), body(projectRoot, '.claude/CLAUDE.md')], [null, null]);
    assert.strictEqual(body(projectRoot, '.claude/settings.json'), '{}', 'nothing else under .claude/ moves');
    assert.deepStrictEqual(first.gitMvs, [], 'untracked: a plain rename');
    assert.ok(first.logs.some((m) => /\.claude\/AGENTS\.md -> AGENTS\.md: moved on your answer/.test(m)), first.logs.join(' | '));
    const again = place(projectRoot, 'root');
    assert.deepStrictEqual([again.moved, again.logs], [[], []], 'idempotent and quiet');
});

test('place: claude moves the root files into .claude/, git mv where tracked, and names the re-include an ignored one needs', () =>
{
    const projectRoot = dir({ 'AGENTS.md': '# a\n', 'CLAUDE.md': '# c\n', 'CLAUDE.local.md': '# mine\n' });
    const r = place(projectRoot, 'claude', { tracked: (at) => /AGENTS\.md$/.test(at), ignored: (at) => /CLAUDE\.md$/.test(at) });
    assert.deepStrictEqual(r.moved, ['AGENTS.md -> .claude/AGENTS.md', 'CLAUDE.md -> .claude/CLAUDE.md']);
    assert.strictEqual(r.gitMvs.length, 1, 'only the tracked one through git mv');
    assert.match(r.gitMvs[0][1], /\.claude[\\/]AGENTS\.md$/);
    assert.ok(r.logs.some((m) => /AGENTS\.md -> \.claude\/AGENTS\.md: moved on your answer \(git mv, staged as a rename\)/.test(m)), r.logs.join(' | '));
    assert.ok(r.logs.some((m) => /!! \.claude\/CLAUDE\.md is git-ignored here - add '!\.claude\/CLAUDE\.md' after the '\.claude\/\*' line/.test(m)), r.logs.join(' | '));
    assert.ok(!r.logs.some((m) => /'!\.claude\/AGENTS\.md'/.test(m)), 'a file git still tracks needs no re-include line');
    assert.strictEqual(body(projectRoot, 'CLAUDE.local.md'), '# mine\n', 'CLAUDE.local.md stays at the root - it is personal and only read there');
});

test('place: a destination that already holds the file is never overwritten - both are named and left', () =>
{
    const projectRoot = dir({ 'AGENTS.md': '# root\n', '.claude/AGENTS.md': '# claude\n' });
    for (const at of ['root', 'claude'])
    {
        const r = place(projectRoot, at);
        assert.deepStrictEqual(r.moved, []);
        assert.deepStrictEqual([body(projectRoot, 'AGENTS.md'), body(projectRoot, '.claude/AGENTS.md')], ['# root\n', '# claude\n']);
        assert.ok(r.logs.some((m) => /both exist - merge them by hand and delete one/.test(m)), r.logs.join(' | '));
    }
});

test('place: nothing given or nothing to move is a no-op, and a failed move is a note with the command', () =>
{
    const empty = dir();
    assert.deepStrictEqual(place(empty, 'root'), { moved: [], logs: [], gitMvs: [] });
    const projectRoot = dir({ '.claude/AGENTS.md': '# a\n' });
    assert.deepStrictEqual(place(projectRoot, '').moved, [], "'' means not given: nothing moves");
    assert.strictEqual(body(projectRoot, '.claude/AGENTS.md'), '# a\n');
    const logs = [];
    const moved = seeds.placeInstructionFiles({ projectRoot, at: 'root', tracked: () => true, gitMv: () => { throw new Error('index.lock exists'); }, log: (m) => logs.push(m), note: (m) => logs.push(`NOTE ${m}`) });
    assert.deepStrictEqual(moved, []);
    assert.strictEqual(body(projectRoot, '.claude/AGENTS.md'), '# a\n', 'the file stays where it was');
    assert.ok(logs.some((m) => /^NOTE \.claude\/AGENTS\.md could not be moved to AGENTS\.md \(index\.lock exists\) - to do it by hand: git mv \.claude\/AGENTS\.md AGENTS\.md$/.test(m)), logs.join(' | '));
});

test('place: the instructions line says where the files are - none, claude, root or split', () =>
{
    assert.strictEqual(seeds.instructionsLine(dir()), 'instructions: none');
    assert.strictEqual(seeds.instructionsLine(dir({ '.claude/AGENTS.md': 'x' })), 'instructions: claude .claude/AGENTS.md');
    assert.strictEqual(seeds.instructionsLine(dir({ 'AGENTS.md': 'x', 'CLAUDE.md': 'y' })), 'instructions: root AGENTS.md CLAUDE.md');
    assert.strictEqual(seeds.instructionsLine(dir({ 'AGENTS.md': 'x', '.claude/CLAUDE.md': 'y' })), 'instructions: split AGENTS.md .claude/CLAUDE.md');
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

// The user's ask of 2026-10-21 (after 2.9.0): init and configure ask which name the instruction file carries - AGENTS.md or
// CLAUDE.md - and the seed, a switch, the update and a part's own file follow the answer the stamp keeps.
test('name: a CLAUDE.md answer seeds .claude/CLAUDE.md (the root on the place answer), with no AGENTS.md floor line', () =>
{
    const source = dir(TEMPLATE);
    for (const [at, rel] of [['', '.claude/CLAUDE.md'], ['root', 'CLAUDE.md']])
    {
        const projectRoot = dir();
        const logs = [];
        assert.strictEqual(seeds.seedAgentsMd({ projectRoot, sourceDir: source, at, kind: 'claude', log: (m) => logs.push(m) }), true);
        assert.strictEqual(fs.readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8'), `# ${path.basename(projectRoot)}\n\nOutline.\n`);
        assert.ok(!fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md')) && !fs.existsSync(path.join(projectRoot, 'AGENTS.md')), 'no AGENTS.md');
        assert.ok(!logs.some((m) => /2\.1\.277/.test(m)) && logs.some((m) => m.includes(`seeded to ${rel === 'CLAUDE.md' ? 'CLAUDE.md at the project root' : '.claude/CLAUDE.md'}`)), logs.join(' | '));
        assert.strictEqual(seeds.seededAgentsMdPath(projectRoot, 'claude'), path.join(projectRoot, ...rel.split('/')), 'the ledger row reads the seed under its name');
    }
});

test('name: the refresh follows the answer - a CLAUDE.md seed is refreshed under its own name', () =>
{
    const source = dir({ 'stack/AGENTS.template.md': '# __PROJECT_NAME__\n\nNew outline.\n' });
    const projectRoot = dir({ '.claude/CLAUDE.md': '# shop\n\nOld outline.\n' });
    assert.strictEqual(seeds.refreshSeededAgentsMd({ projectRoot, sourceDir: source, kind: 'claude' }), true);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, '.claude', 'CLAUDE.md'), 'utf8'), '# shop\n\nNew outline.\n');
});

test('name: a switch renames the root, .claude/ and each part file, re-spells the re-include, names a clash, and a re-run renames nothing', () =>
{
    const projectRoot = dir({ 'AGENTS.md': 'root', '.claude/AGENTS.md': 'seed', 'web/AGENTS.md': 'web', 'api/AGENTS.md': 'api', 'api/CLAUDE.md': 'api own',
        '.gitignore': 'node_modules/\n.claude/*\n!.claude/AGENTS.md\n' });
    const logs = [];
    const parts = ['web/AGENTS.md', 'api/AGENTS.md', 'api/CLAUDE.md'];
    const moved = seeds.renameInstructionFiles({ projectRoot, kind: 'claude', parts, log: (m) => logs.push(m) });
    assert.deepStrictEqual(moved, ['AGENTS.md -> CLAUDE.md', '.claude/AGENTS.md -> .claude/CLAUDE.md', 'web/AGENTS.md -> web/CLAUDE.md']);
    const read = (rel) => fs.readFileSync(path.join(projectRoot, ...rel.split('/')), 'utf8');
    assert.deepStrictEqual(['CLAUDE.md', '.claude/CLAUDE.md', 'web/CLAUDE.md', 'api/AGENTS.md', 'api/CLAUDE.md'].map(read), ['root', 'seed', 'web', 'api', 'api own'], 'content kept, the clash untouched');
    assert.strictEqual(read('.gitignore'), 'node_modules/\n.claude/*\n!.claude/CLAUDE.md\n');
    assert.ok(logs.some((m) => m === '  api/AGENTS.md: left as it is - api/CLAUDE.md exists beside it; merge them by hand and delete one'), logs.join(' | '));
    assert.ok(logs.some((m) => m === '  .gitignore: the re-include line now names .claude/CLAUDE.md'), logs.join(' | '));
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot, kind: 'claude', parts: ['web/CLAUDE.md', 'api/AGENTS.md', 'api/CLAUDE.md'] }), [], 'a re-run renames nothing');
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot, kind: 'agents', parts: ['web/CLAUDE.md'] }),
        ['CLAUDE.md -> AGENTS.md', '.claude/CLAUDE.md -> .claude/AGENTS.md', 'web/CLAUDE.md -> web/AGENTS.md'], 'and back');
    assert.strictEqual(read('.gitignore'), 'node_modules/\n.claude/*\n!.claude/AGENTS.md\n');
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot, kind: '' }), [], 'no answer, no rename');
});

test('name: a tracked file goes through git mv; a failed one stays, named with its command; CLAUDE.local.md never moves', () =>
{
    const projectRoot = dir({ 'AGENTS.md': 'root', 'CLAUDE.local.md': 'mine' });
    const calls = [];
    seeds.renameInstructionFiles({ projectRoot, kind: 'claude', tracked: () => true, gitMv: (from, to) => { calls.push([path.basename(from), path.basename(to)]); fs.renameSync(from, to); } });
    assert.deepStrictEqual(calls, [['AGENTS.md', 'CLAUDE.md']]);
    assert.ok(fs.existsSync(path.join(projectRoot, 'CLAUDE.local.md')), 'the personal file keeps its name');
    const stuck = dir({ '.claude/CLAUDE.md': 'seed' });
    const notes = [];
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot: stuck, kind: 'agents', tracked: () => true, gitMv: () => { throw new Error('index.lock exists'); }, note: (m) => notes.push(m) }), []);
    assert.ok(fs.existsSync(path.join(stuck, '.claude', 'CLAUDE.md')) && /to do it by hand: git mv \.claude\/CLAUDE\.md \.claude\/AGENTS\.md/.test(notes.join(' ')), notes.join(' | '));
});

test('name: an answer a root or .claude/ file already carries renames nothing, a part included; with none there, the parts follow it', () =>
{
    const keep = dir({ '.claude/AGENTS.md': 'seed', 'web/CLAUDE.md': 'web' });
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot: keep, kind: 'agents', parts: ['web/CLAUDE.md'] }), []);
    assert.ok(fs.existsSync(path.join(keep, 'web', 'CLAUDE.md')), 'a Keep answer leaves a part of the other name as it is');
    const both = dir({ 'AGENTS.md': 'a', '.claude/CLAUDE.md': 'c', 'web/AGENTS.md': 'w' });
    for (const kind of ['agents', 'claude'])
        assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot: both, kind, parts: ['web/AGENTS.md'] }), [], `files=both, ${kind}: neither is renamed`);
    const partsOnly = dir({ 'web/AGENTS.md': 'w' });
    assert.deepStrictEqual(seeds.renameInstructionFiles({ projectRoot: partsOnly, kind: 'claude', parts: ['web/AGENTS.md'] }), ['web/AGENTS.md -> web/CLAUDE.md'], 'no root file yet: the part takes the seed\'s name');
});

test('name: the fact line - the install\'s name, the files\' names, the stamp\'s answer, a CLAUDE.local.md, and what an update does', () =>
{
    const line = seeds.instructionsFileLine;
    assert.strictEqual(line(dir()), 'instructions-file: agents files=none answer=none local=no update=none');
    // an install from 2.9.0 or earlier never answered: its first update asks once, whichever name the file carries
    assert.strictEqual(line(dir({ '.claude/AGENTS.md': 'x' })), 'instructions-file: agents files=agents answer=none local=no update=ask');
    // still on .claude/CLAUDE.md and never asked: the rename-first ask, the nudge 2.9.0's update gave (the user's ruling of
    // 2026-10-22); a root CLAUDE.md is the team's own file, which no update renamed, so it gets the plain ask, Keep first
    assert.strictEqual(line(dir({ '.claude/CLAUDE.md': 'x' })), 'instructions-file: agents files=claude answer=none local=no update=ask-rename');
    assert.strictEqual(line(dir({ 'CLAUDE.md': 'x' })), 'instructions-file: agents files=claude answer=none local=no update=ask');
    assert.strictEqual(line(dir({ 'CLAUDE.md': 'x', '.claude/CLAUDE.md': 'y' })), 'instructions-file: agents files=claude answer=none local=no update=ask');
    assert.strictEqual(line(dir({ 'AGENTS.md': 'x', '.claude/CLAUDE.md': 'y' })), 'instructions-file: agents files=both answer=none local=no update=ask');
    // answered: asked again only when the files carry the other name
    assert.strictEqual(line(dir({ '.claude/CLAUDE.md': 'x' }), 'claude'), 'instructions-file: claude files=claude answer=claude local=no update=none');
    assert.strictEqual(line(dir({ '.claude/AGENTS.md': 'x' }), 'claude'), 'instructions-file: claude files=agents answer=claude local=no update=ask');
    assert.strictEqual(line(dir({ 'AGENTS.md': 'x', '.claude/CLAUDE.md': 'y' }), 'agents'), 'instructions-file: agents files=both answer=agents local=no update=none');
    // a CLAUDE.local.md keeps every AGENTS.md unread: a CLAUDE.md file is recorded as the answer while none was given,
    // and an AGENTS.md answer is asked about with that reason, never written over unasked (review 2026-10-23, finding 5)
    for (const local of ['CLAUDE.local.md', '.claude/CLAUDE.local.md'])
    {
        assert.strictEqual(line(dir({ '.claude/CLAUDE.md': 'x', [local]: 'y' })), 'instructions-file: agents files=claude answer=none local=yes update=record-claude', local);
        assert.strictEqual(line(dir({ '.claude/CLAUDE.md': 'x', [local]: 'y' }), 'agents'), 'instructions-file: agents files=claude answer=agents local=yes update=ask-local', local);
    }
    assert.strictEqual(line(dir({ 'CLAUDE.md': 'x', 'CLAUDE.local.md': 'y' }), 'agents'), 'instructions-file: agents files=claude answer=agents local=yes update=ask-local', 'a root CLAUDE.md too');
    assert.strictEqual(line(dir({ '.claude/CLAUDE.md': 'x', 'CLAUDE.local.md': 'y' }), 'claude'), 'instructions-file: claude files=claude answer=claude local=yes update=none');
    assert.strictEqual(line(dir({ '.claude/AGENTS.md': 'x', 'CLAUDE.local.md': 'y' })), 'instructions-file: agents files=agents answer=none local=yes update=ask');
    assert.strictEqual(line(dir({ 'web/CLAUDE.md': 'x' }), 'bogus'), 'instructions-file: agents files=none answer=none local=no update=none', 'a part file is no root fact; an unknown answer is none');
});

test('name: the stamp keeps the answer for either name, and no line means it was never asked', () =>
{
    const stamp = require('./install/stamp.js');
    const base = { repoUrl: 'u', ref: 'r', sha: 's', version: '1', installed: 'i', action: 'install', scope: 'project', hooks: [], alwaysRules: [], alwaysMcps: [] };
    const root = dir();
    const file = path.join(root, 'alfred-code.stamp');
    fs.writeFileSync(file, stamp.renderStamp({ ...base, instructionsFile: 'claude' }));
    assert.match(fs.readFileSync(file, 'utf8'), /^instructions-file: claude$/m);
    assert.strictEqual(stamp.readInstructionsFile(file), 'claude');
    assert.strictEqual(stamp.readInstructionsAnswer(file), 'claude');
    fs.writeFileSync(file, stamp.renderStamp({ ...base, instructionsFile: 'agents' }));
    assert.match(fs.readFileSync(file, 'utf8'), /^instructions-file: agents$/m, 'an AGENTS.md answer is kept too, so the update does not ask again');
    assert.deepStrictEqual([stamp.readInstructionsFile(file), stamp.readInstructionsAnswer(file)], ['agents', 'agents']);
    fs.writeFileSync(file, stamp.renderStamp(base));
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /instructions-file/, 'no answer, no line');
    assert.deepStrictEqual([stamp.readInstructionsFile(file), stamp.readInstructionsAnswer(file)], ['agents', '']);
    fs.writeFileSync(file, 'sha: s\ninstructions-file: weird\n');
    assert.deepStrictEqual([stamp.readInstructionsFile(file), stamp.readInstructionsAnswer(file)], ['agents', ''], 'a garbage line is no answer');
    assert.deepStrictEqual([stamp.readInstructionsFile(path.join(root, 'none.stamp')), stamp.readInstructionsAnswer(path.join(root, 'none.stamp'))], ['agents', '']);
});

test('name: the seed\'s ledger row follows a rename - its hash folds in the file name, so the unedited seed stays the stack\'s', () =>
{
    const library = require('./install/library.js');
    const projectRoot = dir({ '.claude/AGENTS.md': '# shop\n\nOutline.\n' });
    const held = library.hashItem(path.join(projectRoot, '.claude', 'AGENTS.md'));
    seeds.renameInstructionFiles({ projectRoot, kind: 'claude' });
    const now = path.join(projectRoot, '.claude', 'CLAUDE.md');
    assert.notStrictEqual(library.hashItem(now), held, 'the premise: the same bytes hash apart under the new name');
    assert.strictEqual(seeds.seedRowAfterRename(held, now), library.hashItem(now), 'the row is re-keyed to the new name');
    fs.writeFileSync(now, '# shop\n\nMine.\n');
    assert.strictEqual(seeds.seedRowAfterRename(held, now), held, 'an edited file keeps the old row - it is the user\'s');
    assert.strictEqual(seeds.seedRowAfterRename('', now), '', 'no row, none made');
    assert.strictEqual(seeds.seedRowAfterRename(held, path.join(projectRoot, 'absent.md')), held, 'a missing file changes nothing');
});
