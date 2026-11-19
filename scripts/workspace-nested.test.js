'use strict';
// REMOVE-NESTED, END TO END (2026-11-19) - a root installs, then a folder below it installs as its own git repository, and
// its `.git` is deleted: the plain subfolder an older release left. `workspace.js plan --rescan` names it `nested:` (never
// `rescan:`), and `remove-nested` takes out the stack's own files recorded in THAT folder's stamp and nothing else: no byte
// outside the folder changes - the root's install, git's exclude file, the account - and no `claude` call is made.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { seedRun, POSIX_ONLY, scrubStackEnv } = require('./seed-sandbox.js');
const { cleanExport } = require('./clean-export.js');

const REPO = path.join(__dirname, '..');
const WORKSPACE = path.join(REPO, 'scripts', 'workspace.js');
const SELECTION = 'agent aspnet-implementer\nrule markdown-docs\n';
const COPY_ROUTE = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);
const EXIT_REFUSED = 2;

const SOURCE = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-nested-source-'));
test.after(() => fs.rmSync(SOURCE, { recursive: true, force: true }));
cleanExport(REPO, SOURCE);

const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const filesUnder = (dir, skip = () => false) => (!fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
{
    const at = path.join(dir, d.name);
    if (skip(at)) return [];
    return d.isDirectory() && !d.isSymbolicLink() ? filesUnder(at, skip) : [at];
}));
// Every file's hash under `dir` (a link by its target text), keyed by the path below `base`.
const treeHash = (dir, base, skip) => Object.fromEntries(filesUnder(dir, skip).sort().map((f) =>
    [path.relative(base, f), fs.lstatSync(f).isSymbolicLink() ? `link:${fs.readlinkSync(f)}` : hashOf(f)]));

function layOutNested(repo)
{
    const pkg = path.join(repo, 'pkg');
    fs.mkdirSync(pkg);
    execFileSync('git', ['init', '-q', pkg]);
}

function sandboxEnv(work)
{
    const env = scrubStackEnv({ ...process.env, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'),
        PATH: `${path.join(work, 'bin')}${path.delimiter}${process.env.PATH}`,
        CLAUDE_STUB_LOG: path.join(work, 'claude-calls.log'), CLAUDE_STUB_PLUGINS: path.join(work, 'plugins.json') });
    for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_CODE_')) delete env[key];
    return { ...env, ...COPY_ROUTE, ALFRED_CODE_WORKSPACE: '1', ALFRED_CODE_MEMORY_WARM: '0' };
}

// The two installs, `repo` and `repo/pkg`; `inspect(repo, run)` sees them with pkg's `.git` gone, `run(args)` being
// workspace.js in the repo with the sandbox's environment: { code, out }.
function withNested(inspect)
{
    return seedRun(['install', 'install'], SELECTION, {
        plugins: PLUGINS, env: COPY_ROUTE, source: SOURCE, cwds: ['repo', 'repo/pkg'], prepare: layOutNested,
        inspect(repo)
        {
            const work = path.dirname(repo);
            fs.rmSync(path.join(repo, 'pkg', '.git'), { recursive: true, force: true });
            const run = (args, cwd = repo) =>
            {
                const got = spawnSync(process.execPath, [WORKSPACE, ...args], { cwd, env: sandboxEnv(work), encoding: 'utf8' });
                return { code: got.status, out: String(got.stdout || ''), err: String(got.stderr || '') };
            };
            return inspect(repo, run, work);
        },
    }).result;
}

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
