'use strict';
// A LOCAL INSTALL STAYS OUT OF GIT (the workspace source design, stage 1; the owner's decision 2): `.alfred/.gitignore`
// stops re-including itself where nothing under the folder is committed, and the run writes `.claude/.gitignore`
// holding `*` - one small file inside each folder, nothing outside the project. Project and user scope write what they
// wrote before. Each case reads the files the run left and asks git itself, with no global git config.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { CLAUDE_IGNORE } = require('../stack/mcp/data-root.js');
const { OWN_COMMENT } = require('./git-hygiene.js');

const SEL = 'skill csharp\nrule markdown-docs\n';
// The docs versioning is named: at local scope the seed becomes `local` only with the default-scope change beside this one.
const LOCAL = ['--scope', 'local', '--docs-versioning', 'local'];
const read = (repo, ...rel) => { try { return fs.readFileSync(path.join(repo, ...rel), 'utf8'); } catch { return null; } };
// git as a user with no global or system config has it: the sandbox folder is the home.
const git = (repo, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, HOME: path.dirname(repo), XDG_CONFIG_HOME: path.join(path.dirname(repo), 'xdg'), GIT_CONFIG_NOSYSTEM: '1' },
});
const untracked = (repo) => git(repo, 'status', '--porcelain').split('\n').filter(Boolean).map((l) => l.slice(3));
const ledgered = (repo) => /^managed-files: .*(^|,)\.gitignore=/m.test((read(repo, '.claude', 'alfred-code.stamp') || '').replace(/^managed-files: /m, 'managed-files: ,'));
const state = (repo) => ({
    claude: read(repo, '.claude', '.gitignore'), data: read(repo, '.alfred', '.gitignore'), exclude: read(repo, '.git', 'info', 'exclude'),
    row: ledgered(repo), ledger: ((read(repo, '.claude', 'alfred-code.stamp') || '').match(/^managed-files: .*$/m) || [null])[0], seen: fs.existsSync(path.join(repo, '.git')) ? untracked(repo).filter((p) => /^\.(alfred|claude)(\/|$)/.test(p)) : null,
});

test('a local install writes .claude/.gitignore, records it, and git status shows neither folder', POSIX_ONLY, () =>
{
    const { result, out } = seedRun('install', SEL, { args: LOCAL, inspect: state });
    assert.strictEqual(result.claude, CLAUDE_IGNORE);
    assert.ok(result.row, 'the stamp records the file');
    assert.ok(result.data && !result.data.includes('!/.gitignore'), `the data root's file re-includes nothing:\n${result.data}`);
    assert.deepStrictEqual(result.seen, [], 'git status lists neither folder');
    assert.match(out, /^==> {3}\.claude\/\.gitignore written - a local install keeps \.claude out of git$/m);
    assert.doesNotMatch(out, /settings\.local\.json: created/, 'the settings file is ignored before it is written');
});

test('project and user scope write no .claude/.gitignore and keep the self re-include', POSIX_ONLY, () =>
{
    for (const scope of ['project', 'user'])
    {
        const { result } = seedRun('install', SEL, { args: ['--scope', scope], inspect: state });
        assert.strictEqual(result.claude, null, scope);
        assert.strictEqual(result.row, false, scope);
        assert.ok(result.data.includes('!/.gitignore\n'), `${scope}:\n${result.data}`);
    }
});

test('a tracked file under .claude, or a .claude/.gitignore of the user\'s own, leaves the folder as it is', POSIX_ONLY, () =>
{
    const tracked = seedRun('install', SEL, {
        args: LOCAL,
        prepare: (repo) =>
        {
            fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.claude', 'team-notes.md'), 'ours\n');
            git(repo, 'add', '-f', '.claude/team-notes.md');
            git(repo, 'commit', '-q', '-m', 'the team commits a file under .claude');
        },
        inspect: state,
    });
    assert.strictEqual(tracked.result.claude, null, 'a folder git tracks files in is the team\'s');
    assert.strictEqual(tracked.result.row, false);
    assert.doesNotMatch(tracked.out, /\.claude\/\.gitignore written/);

    const own = seedRun('install', SEL, {
        args: LOCAL,
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', '.gitignore'), '!keep\n'); },
        inspect: state,
    });
    assert.strictEqual(own.result.claude, '!keep\n', 'the user\'s own file is kept byte for byte');
    assert.strictEqual(own.result.row, false);
});

test('a move from local to project scope removes the stack\'s file; an edited one stays', POSIX_ONLY, () =>
{
    const moved = seedRun(['install', 'install'], SEL, { args: [LOCAL, ['--scope', 'project']], inspect: state });
    assert.strictEqual(moved.result.claude, null);
    assert.strictEqual(moved.result.row, false);
    assert.match(moved.outs[1], /^==> {3}\.claude\/\.gitignore removed - \.claude is shared at this scope$/m);
    assert.ok(moved.result.data.includes('!/.gitignore\n'), 'the data root\'s file re-includes itself again');

    const edited = seedRun(['install', 'install'], SEL, {
        args: [LOCAL, ['--scope', 'project']],
        each: (repo, i) => { if (i === 0) fs.appendFileSync(path.join(repo, '.claude', '.gitignore'), '!shared.md\n'); },
        inspect: state,
    });
    assert.strictEqual(edited.result.claude, `${CLAUDE_IGNORE}!shared.md\n`, 'a changed file is the user\'s');
    assert.strictEqual(edited.result.row, false, 'and its ledger row goes');
});

test('uninstall removes the stack\'s .claude/.gitignore', POSIX_ONLY, () =>
{
    const { result, steps } = seedRun(['install', 'uninstall'], SEL, { args: [LOCAL, []], each: state, inspect: state });
    assert.strictEqual(steps[0].claude, CLAUDE_IGNORE);
    assert.strictEqual(result.claude, null);
});

test('a re-run at local scope changes neither file', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'install', 'update'], SEL, { args: [LOCAL, LOCAL, []], each: state });
    assert.deepStrictEqual(steps[1], steps[0]);
    assert.deepStrictEqual(steps[2], steps[0]);
    assert.strictEqual(steps[0].row, true);
    assert.ok(steps[0].ledger, 'and the ledger line, its rows in one order, is byte-equal across the three runs (above)');
    for (const out of outs.slice(1)) assert.doesNotMatch(out, /\.claude\/\.gitignore (written|removed)|\.alfred\/\.gitignore (written|rewritten)/);
});

test('the stack\'s line in the exclude file goes at local scope once the folder\'s own file hides it; under git versioning it stays', POSIX_ONLY, () =>
{
    const mine = `# mine\n/tmp-notes/\n${OWN_COMMENT}\n/.alfred/\n`;
    const prepare = (repo) => { fs.mkdirSync(path.join(repo, '.git', 'info'), { recursive: true }); fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), mine); };
    const hidden = seedRun(['install', 'install'], SEL, { args: [LOCAL, LOCAL], prepare, each: state, inspect: state });
    assert.strictEqual(hidden.result.exclude, '# mine\n/tmp-notes/\n');
    assert.match(hidden.outs[0], /^==> {3}exclude: the data root's line removed - \.alfred\/\.gitignore hides the folder now$/m);
    assert.doesNotMatch(hidden.outs[1], /line removed/, 'said once');
    assert.deepStrictEqual(hidden.result.seen, [], 'still hidden with the line gone');

    const committed = seedRun('install', SEL, { args: ['--scope', 'local', '--docs-versioning', 'git'], prepare, inspect: state });
    assert.strictEqual(committed.result.exclude, mine, 'the docs are committed: the folder\'s file re-includes, so the line stays');
    assert.ok(committed.result.data.includes('!/.gitignore\n!/docs/'));
    assert.strictEqual(committed.result.claude, CLAUDE_IGNORE);
});

test('a folder that is no git repository: both files written, exit 0', POSIX_ONLY, () =>
{
    const { result, code } = seedRun('install', SEL, {
        args: LOCAL,
        prepare: (repo) => fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true }),
        inspect: state,
    });
    assert.strictEqual(code, 0);
    assert.strictEqual(result.claude, CLAUDE_IGNORE);
    assert.ok(result.data && !result.data.includes('!/.gitignore'));
    assert.strictEqual(result.row, true);
});
