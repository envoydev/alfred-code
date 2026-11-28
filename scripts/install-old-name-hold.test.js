'use strict';
// B4 (session-audit-fixes, T14): the `.sensitive-data` -> `.secrets` rename waits while a file the user owns still names
// the old store. The pure scan on file texts first, then the update end to end through the seed sandbox.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { oldNameReferences, holdsRename, holdLines } = require('./install/old-name-hold/references.js');
const { installedPaths } = require('./install/old-name-hold/installed.js');
const { MAX_SCAN_FILES, OLD_TEMPLATE_LINES } = require('./install/old-name-hold/constants.js');
const { scanOldNameReferences } = require('./install/old-name-hold/effects.js');

const ROOT = '.alfred';
const { RUN_BOOKS } = require('../stack/mcp/data-root.js');
const INSTALLED = installedPaths({
    hooks: ['guard-secret-value.js'], engines: ['layout.js'], modules: [], skills: ['database-security'], agents: ['security-auditor.md'], rules: ['alfred-security.md', 'typescript-conventions.md'],
});
const refs = (files, installed = INSTALLED) => oldNameReferences(ROOT, files.map(([file, text]) => ({ path: file, text })), { runBooks: RUN_BOOKS, installed });

test('oldNameReferences lists each user file that names the old store, sorted and once', () =>
{
    assert.deepStrictEqual(refs([
        ['mcp-servers/x.sh', 'source .alfred/.sensitive-data\nsource .alfred/.sensitive-data\n'],
        ['.github/workflows/ci.yml', 'run: cat .sensitive-data'],
        ['README.md', 'the store is .alfred/.secrets'],
        ['.env.example', 'ONE=1'],
    ]), ['.github/workflows/ci.yml', 'mcp-servers/x.sh']);
});

test('oldNameReferences ignores what the installer wrote: its deny row, its hooks, rules and run books, and the data root', () =>
{
    const deny = '{"permissions":{"deny":["Read(.secrets)","Read(.sensitive-data)"]}}';
    assert.deepStrictEqual(refs([
        ['.claude/settings.local.json', deny],
        ['.claude/hooks/guard-secret-value.js', "const OLD = '.sensitive-data';"],
        ['.claude/hooks/layout.js', "const OLD = '.sensitive-data';"],
        ['.claude/rules/alfred-security.md', 'the `.sensitive-data` file'],
        ['.claude/rules/typescript-conventions.md', 'the `.sensitive-data` file'],
        ['.claude/skills/database-security/SKILL.md', 'the `.sensitive-data` file'],
        ['.claude/agents/security-auditor/security-auditor.md', 'the `.sensitive-data` file'],
        [`.alfred/docs/${RUN_BOOKS[0]}`, 'keys in .alfred/.sensitive-data'],
        [`docs/${RUN_BOOKS[1]}`, 'keys in .alfred/.sensitive-data'],
        ['.alfred/docs/notes.md', 'old: .alfred/.sensitive-data'],
    ]), []);
});

test('oldNameReferences counts the user own settings row and .mcp.json, which the installer never wrote', () =>
{
    assert.deepStrictEqual(refs([
        ['.claude/settings.json', '{"permissions":{"deny":["Read(.alfred/.sensitive-data)"]}}'],
        ['.mcp.json', '{"args":["--env-file",".alfred/.sensitive-data"]}'],
    ]), ['.claude/settings.json', '.mcp.json']);
});

test('oldNameReferences does not take a longer name for the old store', () =>
{
    assert.deepStrictEqual(refs([
        ['a.sh', 'x.sensitive-data and .sensitive-data.bak and .sensitive-data-old'],
        ['b.sh', 'cat ".sensitive-data"'],
    ]), ['b.sh']);
});

test('a user hook, command or skill under .claude that names the old store holds the rename; an installed stack copy does not', () =>
{
    assert.deepStrictEqual(refs([
        ['.claude/hooks/mine.sh', '. .alfred/.sensitive-data'],
        ['.claude/commands/load.md', 'read .alfred/.sensitive-data'],
        ['.claude/skills/own-skill/SKILL.md', 'keys in .alfred/.sensitive-data'],
        ['.claude/hooks/guard-secret-value.js', "const OLD = '.sensitive-data';"],
        ['.claude/rules/alfred-security.md', 'the `.sensitive-data` file'],
    ]), ['.claude/commands/load.md', '.claude/hooks/mine.sh', '.claude/skills/own-skill/SKILL.md']);
});

test('each AGENTS.template.md line a released version seeded does not hold in a seeded AGENTS.md; a user line naming the old store still does', () =>
{
    assert.strictEqual(OLD_TEMPLATE_LINES.length, 3, 'three released spellings');
    for (const line of OLD_TEMPLATE_LINES)
    {
        const seeded = `# Notes\n10. Secrets + config\n   ${line}\n`;
        assert.deepStrictEqual(refs([['AGENTS.md', seeded], ['.claude/AGENTS.md', seeded]]), [], line);
        assert.deepStrictEqual(refs([['AGENTS.md', `${seeded}\nOur keys: .alfred/.sensitive-data\n`]]), ['AGENTS.md'], line);
    }
    assert.ok(OLD_TEMPLATE_LINES.includes('cert / .sensitive-data blocks.'));
    assert.ok(OLD_TEMPLATE_LINES.includes('cert / .secrets / .sensitive-data blocks.'));
});

test('the shipped AGENTS.template.md no longer names the old store', () =>
{
    const template = fs.readFileSync(path.join(__dirname, '..', 'stack', 'AGENTS.template.md'), 'utf8');
    assert.doesNotMatch(template, /\.sensitive-data/);
    assert.ok(template.includes('.secrets'));
});

test('a scan that stopped at the file cap holds the rename even when it found nothing, and says so', () =>
{
    assert.strictEqual(holdsRename([], false), false);
    assert.strictEqual(holdsRename(['a.sh'], false), true);
    assert.strictEqual(holdsRename([], true), true);
    const lines = holdLines(ROOT, [], true, 20000);
    assert.match(lines.join('\n'), /stopped at 20000 files/);
    assert.match(lines.join('\n'), /\.alfred\/\.sensitive-data stays/);
});

test('the hold lines say what the scan covered', () =>
{
    const lines = holdLines(ROOT, ['mcp-servers/x.sh'], false, MAX_SCAN_FILES);
    assert.match(lines.join('\n'), /tracked text files under 1 MB, \.mcp\.json and \.claude\/settings\*\.json/);
});

test('the file cap: at the cap the scan is whole, one over it stops', POSIX_ONLY, () =>
{
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'old-name-cap-'));
    try
    {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        for (const n of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, n), 'x');
        execFileSync('git', ['add', '.'], { cwd: dir });
        const at = (maxFiles) => scanOldNameReferences({ projectRoot: dir, root: ROOT, maxFiles }).capped;
        assert.deepStrictEqual([at(4), at(3), at(2)], [false, false, true], 'one under, at, one over');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('binary and oversized files past the cap do not cap the scan: only the files actually read count', POSIX_ONLY, () =>
{
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'old-name-read-'));
    try
    {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        fs.writeFileSync(path.join(dir, 'one.txt'), 'x');
        fs.writeFileSync(path.join(dir, 'two.txt'), 'x');
        for (const n of ['a.bin', 'b.bin', 'c.bin']) fs.writeFileSync(path.join(dir, n), Buffer.from([0, 1, 2]));
        for (const n of ['big1.txt', 'big2.txt']) fs.writeFileSync(path.join(dir, n), ' '.repeat(1024 * 1024 + 1));
        execFileSync('git', ['add', '.'], { cwd: dir });
        const scan = (maxFiles) => scanOldNameReferences({ projectRoot: dir, root: ROOT, maxFiles, installed: INSTALLED });
        assert.deepStrictEqual([scan(2).capped, scan(1).capped], [false, true], 'two text files read: at the cap whole, one under the cap stops');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the scan counts neither the stack own files nor the data root against the cap', POSIX_ONLY, () =>
{
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'old-name-own-'));
    try
    {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        for (const rel of ['.alfred/docs/a.md', '.alfred/docs/b.md', '.claude/hooks/layout.js', 'one.txt'])
        {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), 'x');
        }
        execFileSync('git', ['add', '-f', '.'], { cwd: dir });
        const found = scanOldNameReferences({ projectRoot: dir, root: ROOT, maxFiles: 1, installed: INSTALLED });
        assert.strictEqual(found.capped, false, 'only one.txt counts');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scanOldNameReferences reads tracked text files under the size cap, skips binary and stops at the file cap', POSIX_ONLY, () =>
{
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'old-name-'));
    try
    {
        const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
        execFileSync('git', ['init', '-q'], { cwd: dir });
        put('s/tracked.sh', 'a .alfred/.sensitive-data');
        put('s/untracked.sh', 'a .alfred/.sensitive-data');
        put('s/big.txt', `${' '.repeat(1024 * 1024)}.alfred/.sensitive-data`);
        put('s/blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('.alfred/.sensitive-data')]));
        put('.mcp.json', '{"a":".alfred/.sensitive-data"}');
        execFileSync('git', ['add', 's/tracked.sh', 's/big.txt', 's/blob.bin'], { cwd: dir });
        const found = scanOldNameReferences({ projectRoot: dir, root: ROOT, installed: INSTALLED });
        assert.deepStrictEqual(found.files, ['.mcp.json', 's/tracked.sh']);
        assert.strictEqual(found.capped, false);
        assert.ok(MAX_SCAN_FILES > 0);
        const small = scanOldNameReferences({ projectRoot: dir, root: ROOT, maxFiles: 1 });
        assert.strictEqual(small.capped, true);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ the update, end to end
const SELECTION = 'rule alfred-docs-root\n';
const UPDATE = ['--scope', 'project', '--installed-only'];
const NO_SESSION = { CLAUDE_CODE_SESSION_ID: '' };
const RELEASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
const CORE_HERE = JSON.stringify([{ id: 'alfred-code@envoydev', scope: 'user', enabled: true, version: RELEASE }]);
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const OLD_STORE = ['.alfred', '.sensitive-data'];
const NEW_STORE = ['.alfred', '.secrets'];
const SCRIPT = ['mcp-servers', 'x.sh'];
const look = (repo) => ({
    old: read(path.join(repo, ...OLD_STORE)), fresh: read(path.join(repo, ...NEW_STORE)),
    stamp: (read(path.join(repo, '.claude', 'alfred-code.stamp')) || '').replace(/^installed(?:-ms)?: .*$/gm, ''),
});

function plantOldState(repo)
{
    fs.rmSync(path.join(repo, ...NEW_STORE), { force: true });
    fs.writeFileSync(path.join(repo, ...OLD_STORE), 'K=v\n');
    const stampFile = path.join(repo, '.claude', 'alfred-code.stamp');
    fs.writeFileSync(stampFile, read(stampFile).replace(/^secrets: .*\n/m, ''));
    fs.mkdirSync(path.join(repo, SCRIPT[0]));
    fs.writeFileSync(path.join(repo, ...SCRIPT), '#!/bin/sh\nset -a; . .alfred/.sensitive-data\n');
    execFileSync('git', ['add', SCRIPT.join('/')], { cwd: repo });
}
const dropReference = (repo) => fs.writeFileSync(path.join(repo, ...SCRIPT), '#!/bin/sh\nset -a; . .alfred/.secrets\n');

test('the rename is held while mcp-servers/x.sh names the old store, listed in the report; it runs once the file is changed; a re-run changes nothing', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update', 'update', 'update', 'update'], SELECTION, {
        env: NO_SESSION, plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE, UPDATE, UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) plantOldState(repo); if (i === 3) dropReference(repo); return look(repo); },
    });
    assert.match(steps[1].stamp, /^secrets: dual run-\d+$/m, 'the first update records the dual line');
    assert.deepStrictEqual([steps[2].old, steps[2].fresh], ['K=v\n', null], 'held: the old file stays, no .secrets');
    assert.match(outs[2], /mcp-servers\/x\.sh/, outs[2]);
    assert.match(outs[2], /\.alfred\/\.secrets/, 'the report names the change that lets the rename go');
    assert.doesNotMatch(outs[2], /renamed \.sensitive-data/);
    assert.deepStrictEqual([steps[3].old, steps[3].fresh], ['K=v\n', null], 'held again: the next update checks again and the file still names it');
    assert.match(outs[3], /mcp-servers\/x\.sh/);
    assert.deepStrictEqual([steps[4].old, steps[4].fresh], [null, 'K=v\n'], 'no reference: the rename goes');
    assert.match(outs[4], /renamed \.sensitive-data -> \.secrets/);
    assert.deepStrictEqual(steps[5], steps[4], 'a re-run changes nothing');
    assert.doesNotMatch(outs[5], /renamed|mcp-servers/);
});

test('with no user file naming the old store the rename goes at the second update, as before', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env: NO_SESSION, plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) { plantOldState(repo); dropReference(repo); } return look(repo); },
    });
    assert.deepStrictEqual([steps[2].old, steps[2].fresh], [null, 'K=v\n'], outs[2]);
    assert.match(outs[2], /renamed \.sensitive-data -> \.secrets/);
});

// L1-26: the same update prunes a retired stack rule copy, so the copy must not hold the rename it is about to lose.
const RETIRED_RULE = ['.claude', 'rules', 'baseline-security.md'];
const { MARKER } = require('./install/native-rules-constants.js');
// planted after the first update, which records the dual line and would prune the copy itself
const plantRetiredRule = (repo, body) =>
{
    fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(repo, ...RETIRED_RULE), body);
    execFileSync('git', ['add', '-f', RETIRED_RULE.join('/')], { cwd: repo });
};

test('L1-26: a tracked retired stack rule copy that names the old store and that the same update prunes does not hold the rename', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env: NO_SESSION, plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) { plantOldState(repo); dropReference(repo); } if (i === 1) plantRetiredRule(repo, `${MARKER}\nkeys live in .alfred/.sensitive-data\n`); return { ...look(repo), rule: read(path.join(repo, ...RETIRED_RULE)) }; },
    });
    assert.strictEqual(steps[2].rule, null, 'the retired copy is pruned');
    assert.deepStrictEqual([steps[2].old, steps[2].fresh], [null, 'K=v\n'], outs[2]);
    assert.match(outs[2], /renamed \.sensitive-data -> \.secrets/);
    assert.doesNotMatch(outs[2], /baseline-security\.md names/);
});

test('L1-26: a retired rule copy that the update keeps as the user own, and that names the old store, still holds the rename', POSIX_ONLY, () =>
{
    const { outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        env: NO_SESSION, plugins: CORE_HERE,
        args: [['--scope', 'project'], UPDATE, UPDATE],
        each: (repo, i) => { if (i === 0) { plantOldState(repo); dropReference(repo); } if (i === 1) plantRetiredRule(repo, 'my own rule: keys live in .alfred/.sensitive-data\n'); return { ...look(repo), rule: read(path.join(repo, ...RETIRED_RULE)) }; },
    });
    assert.notStrictEqual(steps[2].rule, null, 'the user copy stays');
    assert.deepStrictEqual([steps[2].old, steps[2].fresh], ['K=v\n', null], outs[2]);
    assert.match(outs[2], /baseline-security\.md names/);
});
