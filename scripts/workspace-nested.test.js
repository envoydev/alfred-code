'use strict';
// REMOVE-NESTED, END TO END (2026-11-19) - a root installs, then a folder below it installs as its own git repository, and
// its `.git` is deleted: the plain subfolder an older release left. `workspace.js plan --rescan` names it `nested:` (never
// `rescan:`), and `remove-nested` takes out the stack's own files recorded in THAT folder's stamp and nothing else: no byte
// outside the folder changes - the root's install, git's exclude file, the account - and no `claude` call is made.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { POSIX_ONLY } = require('./seed-sandbox.js');
const { SOURCE, WORKSPACE, SELECTION, COPY_ROUTE, PLUGINS, EXIT_REFUSED, hashOf, treeHash, layOutNested, sandboxEnv, withNested, seedRun } = require('./nested-sandbox.js');

test('plan --rescan names an install in a plain subfolder as nested, never as a rescan row', POSIX_ONLY, () =>
{
    const got = withNested((repo, run) => run(['plan', '--root', '.', '--rescan', '--source', SOURCE]));
    assert.strictEqual(got.code, 0);
    assert.match(got.out, /^nested: pkg$/m);
    assert.doesNotMatch(got.out, /^rescan: pkg$/m);
});

test('remove-nested takes the folder\'s own stack files and keeps its edited copy, its notes, its instruction file and its data', POSIX_ONLY, () =>
{
    const got = withNested((repo, run, work) =>
    {
        const pkg = path.join(repo, 'pkg');
        const agent = path.join(pkg, '.claude', 'agents', 'aspnet-implementer.md');
        const note = path.join(pkg, '.claude', 'my-note.md');
        fs.writeFileSync(note, 'mine\n');
        fs.appendFileSync(agent, '\nmy own line\n');
        const skill = fs.readdirSync(path.join(pkg, '.claude', 'skills'))[0];
        const outside = (at) => at === path.join(repo, 'pkg') || at === path.join(repo, '.git');
        const before = {
            tree: treeHash(repo, repo, outside),
            exclude: hashOf(path.join(repo, '.git', 'info', 'exclude')),
            account: treeHash(path.join(work, 'acct'), work),
            calls: fs.existsSync(path.join(work, 'claude-calls.log')) ? fs.readFileSync(path.join(work, 'claude-calls.log'), 'utf8').split('\n').filter(Boolean).length : 0,
            rootStamp: hashOf(path.join(repo, '.claude', 'alfred-code.stamp')),
        };
        const stampBefore = fs.existsSync(path.join(pkg, '.claude', 'alfred-code.stamp'));
        const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        const logAfter = path.join(work, 'claude-calls.log');
        return {
            ran, stampBefore, skill,
            stampGone: !fs.existsSync(path.join(pkg, '.claude', 'alfred-code.stamp')),
            skillGone: !fs.existsSync(path.join(pkg, '.claude', 'skills', skill)),
            keptAgent: fs.readFileSync(agent, 'utf8').includes('my own line'),
            keptNote: fs.existsSync(note),
            keptInstructions: fs.existsSync(path.join(pkg, '.claude', 'AGENTS.md')),
            keptData: fs.existsSync(path.join(pkg, '.alfred', 'docs')),
            ruleCopyGone: !fs.existsSync(path.join(pkg, '.alfred', 'stack', 'rules', 'markdown-docs.md')),
            outsideSame: JSON.stringify(treeHash(repo, repo, outside)) === JSON.stringify(before.tree),
            excludeSame: hashOf(path.join(repo, '.git', 'info', 'exclude')) === before.exclude,
            accountSame: JSON.stringify(treeHash(path.join(work, 'acct'), work)) === JSON.stringify(before.account),
            rootStampSame: hashOf(path.join(repo, '.claude', 'alfred-code.stamp')) === before.rootStamp,
            newCalls: (fs.existsSync(logAfter) ? fs.readFileSync(logAfter, 'utf8').split('\n').filter(Boolean).length : 0) - before.calls,
        };
    });
    assert.ok(got.stampBefore);
    assert.strictEqual(got.ran.code, 0);
    assert.match(got.ran.out, /^remove-nested: pkg - \d+ stack file\(s\) removed$/m);
    assert.match(got.ran.out, /^remove-nested: done pkg$/m);
    assert.ok(got.stampGone, 'the nested stamp is gone');
    assert.ok(got.skillGone, 'an unedited copied skill is gone');
    assert.ok(got.ruleCopyGone, 'an unedited rule copy of the nested store is gone');
    assert.ok(got.keptAgent, 'the edited agent stays');
    assert.ok(got.keptNote && got.keptInstructions && got.keptData, 'the user\'s file, the instruction file and the data root stay');
    for (const kept of ['pkg/.claude/agents/aspnet-implementer.md', 'pkg/.claude/my-note.md', 'pkg/.claude/AGENTS.md', 'pkg/.alfred'])
        assert.match(got.ran.out, new RegExp(`^remove-nested: pkg kept ${kept.replace(/\./g, '\\.')} - `, 'm'), `${kept} is named in a kept line`);
    assert.ok(got.outsideSame, 'no file outside the folder changed');
    assert.ok(got.rootStampSame, 'the root\'s stamp is unchanged');
    assert.ok(got.excludeSame, 'git\'s exclude file is unchanged');
    assert.ok(got.accountSame, 'the account tree is unchanged');
    assert.strictEqual(got.newCalls, 0, 'no claude call was made');
});

test('remove-nested twice: the second run refuses with no stamp and changes nothing', POSIX_ONLY, () =>
{
    const got = withNested((repo, run) =>
    {
        const first = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        const left = treeHash(path.join(repo, 'pkg'), repo);
        const second = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        return { first, second, same: JSON.stringify(left) === JSON.stringify(treeHash(path.join(repo, 'pkg'), repo)) };
    });
    assert.strictEqual(got.first.code, 0);
    assert.strictEqual(got.second.code, EXIT_REFUSED);
    assert.ok(got.same);
});

test('remove-nested refuses, exit 2 and one !! line each: an escaping path, an absolute one, the root, no stamp, a project with its own .git', POSIX_ONLY, () =>
{
    const got = withNested((repo, run, work) =>
    {
        fs.mkdirSync(path.join(repo, 'plain'));
        fs.mkdirSync(path.join(repo, 'evil'));
        fs.symlinkSync(path.join(work, 'acct'), path.join(repo, 'evil', '.claude'));
        fs.symlinkSync(path.join(repo, 'pkg'), path.join(repo, 'alias'));
        fs.mkdirSync(path.join(work, 'acct'), { recursive: true });
        const account = treeHash(path.join(work, 'acct'), work);
        const before = treeHash(repo, repo, (at) => at === path.join(repo, '.git') || at === path.join(repo, 'alias'));
        const refusals = {
            parent: run(['remove-nested', '--root', '.', '--path', '../x']),
            absolute: run(['remove-nested', '--root', '.', '--path', path.join(repo, 'pkg')]),
            root: run(['remove-nested', '--root', '.', '--path', '.']),
            unstamped: run(['remove-nested', '--root', '.', '--path', 'plain']),
            missing: run(['remove-nested', '--root', '.', '--path', 'nowhere']),
            noPath: run(['remove-nested', '--root', '.']),
            linkedClaude: run(['remove-nested', '--root', '.', '--path', 'evil']),
            linkedFolder: run(['remove-nested', '--root', '.', '--path', 'alias']),
        };
        const untouched = JSON.stringify(treeHash(repo, repo, (at) => at === path.join(repo, '.git') || at === path.join(repo, 'alias'))) === JSON.stringify(before)
            && JSON.stringify(treeHash(path.join(work, 'acct'), work)) === JSON.stringify(account);
        execFileSync('git', ['init', '-q', path.join(repo, 'pkg')]);
        refusals.ownGit = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        return { refusals, untouched };
    });
    for (const [name, r] of Object.entries(got.refusals))
    {
        assert.strictEqual(r.code, EXIT_REFUSED, `${name} exits 2`);
        assert.strictEqual(r.out.split('\n').filter((l) => l.startsWith('!!')).length, 1, `${name} prints one !! line`);
        assert.doesNotMatch(r.out, /^remove-nested: /m, `${name} removes nothing`);
    }
    assert.match(got.refusals.ownGit.out, /own git repository/);
    assert.ok(got.untouched, 'a refusal changes no file');
});

test('remove-nested never reaches the root: run with the root as the folder it is told, the root\'s stamp stays', POSIX_ONLY, () =>
{
    const got = withNested((repo, run) =>
    {
        const stamp = path.join(repo, '.claude', 'alfred-code.stamp');
        const before = hashOf(stamp);
        const r = run(['remove-nested', '--root', 'pkg', '--path', '.']);
        const r2 = run(['remove-nested', '--root', '.', '--path', 'pkg/..']);
        return { r, r2, same: hashOf(stamp) === before };
    });
    assert.strictEqual(got.r.code, EXIT_REFUSED);
    assert.strictEqual(got.r2.code, EXIT_REFUSED);
    assert.ok(got.same);
});

// The folder-level links the review probed (2026-11-19): each pointed the nested folder's own path at the ROOT's copy, and the
// removal deleted or rewrote the root's files through it. Every shape must now be refused before a byte moves.
const link = (at, to) => { fs.rmSync(at, { recursive: true, force: true }); fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(to, at); };
const LINKED = {
    '.alfred': (pkg) => link(path.join(pkg, '.alfred'), '../.alfred'),
    '.alfred/stack': (pkg) => link(path.join(pkg, '.alfred', 'stack'), '../../.alfred/stack'),
    '.claude/agents': (pkg) => link(path.join(pkg, '.claude', 'agents'), '../../.claude/agents'),
    '.claude/skills': (pkg) => link(path.join(pkg, '.claude', 'skills'), '../../.claude/skills'),
    '.claude/settings.local.json': (pkg, repo) =>
    {
        const rootFile = path.join(repo, '.claude', 'settings.local.json');
        const data = fs.existsSync(rootFile) ? JSON.parse(fs.readFileSync(rootFile, 'utf8')) : {};
        fs.writeFileSync(rootFile, JSON.stringify({ ...data, myOwn: 1 }, null, 2));
        link(path.join(pkg, '.claude', 'settings.local.json'), '../../.claude/settings.local.json');
    },
    '.claude/hooks': (pkg, repo) =>
    {
        fs.mkdirSync(path.join(repo, '.claude', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.claude', 'hooks', 'root-hook.js'), '// the root\'s\n');
        link(path.join(pkg, '.claude', 'hooks'), '../../.claude/hooks');
    },
    '.mcp.json': (pkg, repo) =>
    {
        fs.writeFileSync(path.join(repo, '.mcp.json'), '{"mcpServers":{"mine":{"command":"x"}}}\n');
        link(path.join(pkg, '.mcp.json'), '../.mcp.json');
    },
};
for (const [shape, mutate] of Object.entries(LINKED))
    test(`remove-nested refuses a linked ${shape}: exit 2, one !! line naming it, no file outside the folder changes`, POSIX_ONLY, () =>
    {
        const got = withNested((repo, run) =>
        {
            const pkg = path.join(repo, 'pkg');
            mutate(pkg, repo);
            const outside = (at) => at === pkg || at === path.join(repo, '.git');
            const before = JSON.stringify(treeHash(repo, repo, outside));
            const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
            return { ran, same: JSON.stringify(treeHash(repo, repo, outside)) === before, stamp: fs.existsSync(path.join(pkg, '.claude', 'alfred-code.stamp')) };
        });
        const bang = got.ran.out.split('\n').filter((l) => l.startsWith('!!'));
        assert.strictEqual(got.ran.code, EXIT_REFUSED);
        assert.strictEqual(bang.length, 1);
        assert.ok(bang[0].includes(`pkg/${shape}`), 'the line names the path');
        assert.doesNotMatch(got.ran.out, /^remove-nested: /m, 'nothing was removed');
        assert.ok(got.same, 'no file outside the folder changed');
        assert.ok(got.stamp, 'the folder\'s stamp stays');
    });

test('remove-nested only unlinks an item-level link to the root\'s copy and leaves the root unchanged', POSIX_ONLY, () =>
{
    const got = withNested((repo, run) =>
    {
        const pkg = path.join(repo, 'pkg');
        const skill = fs.readdirSync(path.join(pkg, '.claude', 'skills'))[0];
        link(path.join(pkg, '.claude', 'skills', skill), `../../../.claude/skills/${skill}`);
        link(path.join(pkg, '.claude', 'agents', 'aspnet-implementer.md'), '../../../.claude/agents/aspnet-implementer.md');
        link(path.join(pkg, '.alfred', 'stack', 'rules', 'markdown-docs.md'), '../../../../.alfred/stack/rules/markdown-docs.md');
        const outside = (at) => at === pkg || at === path.join(repo, '.git');
        const before = JSON.stringify(treeHash(repo, repo, outside));
        const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        return { ran, same: JSON.stringify(treeHash(repo, repo, outside)) === before, rootSkill: fs.existsSync(path.join(repo, '.claude', 'skills', skill)) };
    });
    assert.strictEqual(got.ran.code, 0);
    assert.ok(got.same, 'no file outside the folder changed');
    assert.ok(got.rootSkill, 'the root\'s skill stays');
});

test('remove-nested also takes the stamp\'s .mcp.json entries, mcp-denied rows and tool-ignore block, and names a kept .mcp.json', POSIX_ONLY, () =>
{
    const { entryHash } = require('./install/stamp.js');
    const { MARK, END } = require('./install/tool-ignores.js');
    const got = withNested((repo, run, work) =>
    {
        const pkg = path.join(repo, 'pkg');
        const ours = { command: 'x' };
        fs.writeFileSync(path.join(pkg, '.mcp.json'), JSON.stringify({ mcpServers: { srv: ours, mine: { command: 'y' } } }));
        fs.writeFileSync(path.join(pkg, '.prettierignore'), `${MARK}\n/.alfred/\n/.claude/\n${END}\n`);
        const local = path.join(pkg, '.claude', 'settings.local.json');
        const data = fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, 'utf8')) : {};
        fs.writeFileSync(local, JSON.stringify({ ...data, deniedMcpServers: [{ serverName: 'gone' }, { serverName: 'mine' }] }));
        const stamp = path.join(pkg, '.claude', 'alfred-code.stamp');
        const text = fs.readFileSync(stamp, 'utf8').split('\n').filter((l) => !/^(managed-mcp|mcp-denied|tool-ignores):/.test(l));
        fs.writeFileSync(stamp, [...text.filter(Boolean), `managed-mcp: srv=${entryHash(ours)}`, 'mcp-denied: local:gone', 'tool-ignores: .prettierignore=created', ''].join('\n'));
        const outside = (at) => at === pkg || at === path.join(repo, '.git');
        const before = JSON.stringify(treeHash(repo, repo, outside));
        const ran = run(['remove-nested', '--root', '.', '--path', 'pkg']);
        return { ran, same: JSON.stringify(treeHash(repo, repo, outside)) === before,
            servers: Object.keys(JSON.parse(fs.readFileSync(path.join(pkg, '.mcp.json'), 'utf8')).mcpServers),
            denied: JSON.parse(fs.readFileSync(local, 'utf8')).deniedMcpServers, ignoreGone: !fs.existsSync(path.join(pkg, '.prettierignore')) };
    });
    assert.strictEqual(got.ran.code, 0);
    assert.deepStrictEqual(got.servers, ['mine'], 'the ledgered server left, the user\'s stays');
    assert.deepStrictEqual(got.denied, [{ serverName: 'mine' }], 'the stamp\'s deniedMcpServers row left, the user\'s stays');
    assert.ok(got.ignoreGone, 'the ignore file the stack made, holding only its block, is gone');
    assert.match(got.ran.out, /^remove-nested: pkg kept pkg\/\.mcp\.json - /m, 'the kept .mcp.json is named');
    assert.ok(got.same, 'no file outside the folder changed');
});

test('the guard allows a folder\'s own files, refuses a target whose folder is a link out, and never writes through a link', POSIX_ONLY, () =>
{
    const { guardFor, ledgerWithout } = require('./install/nested-guard.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-guard-'));
    try
    {
        const nested = path.join(dir, 'pkg');
        fs.mkdirSync(path.join(nested, '.claude'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'top', 'skills'), { recursive: true });
        fs.symlinkSync(path.join(dir, 'top', 'skills'), path.join(nested, '.claude', 'skills'));
        fs.writeFileSync(path.join(dir, 'top', 'skills', 'x'), 'x');
        fs.writeFileSync(path.join(dir, 'top', 'f.json'), '{}');
        fs.symlinkSync(path.join(dir, 'top', 'f.json'), path.join(nested, '.claude', 'settings.json'));
        const guard = guardFor(nested);
        assert.ok(guard.canRemove(path.join(nested, '.claude', 'agents', 'x.md')), 'a file below the folder, here absent');
        assert.ok(guard.canWrite(path.join(nested, '.mcp.json')), 'a write in the folder itself');
        assert.ok(!guard.canRemove(path.join(nested, '.claude', 'skills', 'x')), 'an item below a linked folder');
        assert.ok(!guard.canWrite(path.join(nested, '.claude', 'settings.json')), 'a write through a linked file');
        assert.ok(guard.canRemove(path.join(nested, '.claude', 'settings.json')), 'a linked file is only unlinked');
        const left = ledgerWithout({ env: { 'a.json': { K: 'h' }, 'b.json': { K: 'h' } }, deny: [{ file: 'a.json', entry: 'e' }], hooks: [{ file: 'b.json', id: 'i' }], settings: {} }, ['a.json']);
        assert.deepStrictEqual([Object.keys(left.env), left.deny.length, left.hooks.length], [['b.json'], 0, 1]);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a joined child that lost its .git is no project row: plan prints it only as nested, the cascade counts it nested and never runs the installer there', POSIX_ONLY, () =>
{
    const got = seedRun(['install', 'install'], SELECTION, {
        plugins: PLUGINS, env: COPY_ROUTE, source: SOURCE, cwds: ['repo', 'repo/pkg'], prepare: layOutNested,
        inspect(repo)
        {
            const work = path.dirname(repo);
            const pkg = path.join(repo, 'pkg');
            const run = (args, cwd = repo) => { const g = spawnSync(process.execPath, [WORKSPACE, ...args], { cwd, env: sandboxEnv(work), encoding: 'utf8' }); return { code: g.status, out: String(g.stdout || '') }; };
            const joined = run(['join', '--root', 'pkg', '--answer', 'join']);
            fs.rmSync(path.join(pkg, '.git'), { recursive: true, force: true });
            const stamp = path.join(pkg, '.claude', 'alfred-code.stamp');
            const before = fs.readFileSync(stamp, 'utf8');
            const plan = run(['plan', '--root', '.', '--rescan', '--source', SOURCE]);
            const cascade = run(['cascade', '--root', '.', '--source', SOURCE, '--answers', path.join(work, 'none.json')]);
            return { joined, plan, cascade, stampSame: fs.readFileSync(stamp, 'utf8') === before };
        },
    }).result;
    assert.strictEqual(got.joined.code, 0);
    assert.match(got.plan.out, /^nested: pkg$/m);
    assert.doesNotMatch(got.plan.out, /^project: pkg\t/m);
    assert.match(got.plan.out, /^workspace-plan: 1 projects$/m);
    assert.match(got.cascade.out, /^cascade: pkg\tnested$/m);
    assert.match(got.cascade.out, /^cascade: pkg is part of this repository now - not updated; \/alfred-code:update offers to remove its install$/m);
    assert.doesNotMatch(got.cascade.out, /^!! /m);
    assert.match(got.cascade.out, /^cascade: done 0 updated, 0 failed, 0 skipped, 1 nested$/m);
    assert.ok(got.stampSame, 'no installer ran in the folder');
});
