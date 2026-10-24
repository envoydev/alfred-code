'use strict';
// THE FLAG SURFACE OF THE NODE SEED - Phase 7, T1.
//
// The shell twin's `usage()` block IS the contract, and Phase 7 is a rewrite, never a behaviour
// change: every flag the twins take, the Node seed takes, with the same enum values, the same
// lower-casing, the same refusals, and the same two spellings (`--flag value` and `--flag=value`).
//
// Every refusal below happens BEFORE anything is written. That is the rule the shell states about
// `--docs-versioning` and the one worth keeping everywhere: a typo that reaches settings.json is a
// bad value a later run reads back as a deliberate choice.
const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs } = require('./install/args.js');

const ROOT = path.resolve(__dirname, '..');
const TMP_ENTRY = fs.mkdtempSync(path.join(os.tmpdir(), 'install-entry-'));
test.after(() => fs.rmSync(TMP_ENTRY, { recursive: true, force: true }));

const ok = (argv, env) => parseArgs(argv, env || {});
const fails = (argv, pattern, env) =>
{
    assert.throws(() => parseArgs(argv, env || {}), (err) =>
    {
        assert.match(err.message, pattern, `wrong refusal for ${JSON.stringify(argv)}: ${err.message}`);
        return true;
    }, `${JSON.stringify(argv)} was accepted`);
};

test('install-args: the action is positional and REQUIRED - there is no default install', () =>
{
    assert.strictEqual(ok(['install']).action, 'install');
    assert.strictEqual(ok(['update']).action, 'update');
    fails([], /action/i);
    fails(['provision'], /install.*update|action/i);
});

test('install-args: both spellings of every valued flag mean the same thing', () =>
{
    for (const [flag, value, key] of [
        ['--scope', 'local', 'scope'],
        ['--docs-versioning', 'local', 'docsVersioning'],
        ['--selection', '/tmp/sel.txt', 'selection'],
        ['--source', '/tmp/src', 'source'],
    ])
    {
        const spaced = ok(['install', flag, value])[key];
        const equals = ok(['install', `${flag}=${value}`])[key];
        assert.strictEqual(spaced, equals, `${flag} disagrees between its two spellings`);
        assert.strictEqual(spaced, value, `${flag} did not land in '${key}'`);
    }
});

test('install-args: a valued flag given LAST with no value is refused, not read as empty', () =>
{
    for (const flag of ['--scope',
        '--docs-versioning', '--selection', '--source'])
        fails(['install', flag], new RegExp(`${flag}.*needs a value`));
});

test('install-args: the boolean flags take no value', () =>
{
    const p = ok(['install', '--forge-cli', '--keep-pins', '--installed-only', '--print-plan', '--skills-only']);
    assert.strictEqual(p.forgeCli, true);
    assert.strictEqual(p.keepPins, true);
    assert.strictEqual(p.installedOnly, true);
    assert.strictEqual(p.printPlan, true);
    assert.strictEqual(p.skillsOnly, true);
});

test('install-args: --github-cli is gone - --forge-cli installs the CLI of whichever forge the origin is', () =>
{
    fails(['install', '--github-cli'], /unknown argument '--github-cli'/);
    assert.strictEqual(ok(['install']).forgeCli, false);
});

test('install-args: an unknown argument is refused and the message NAMES the flags', () =>
{
    fails(['install', '--oops'], /unknown argument '--oops'/);
    fails(['install', '--oops'], /--docs-versioning/);   // the message lists what IS accepted
});

test('install-args: the enums are lower-cased, so PowerShell casing works on both seeds', () =>
{
    assert.strictEqual(ok(['install', '--scope', 'Local']).scope, 'local');
    assert.strictEqual(ok(['install', '--docs-versioning', 'Git']).docsVersioning, 'git');
});

// The --space profile flag is gone (the user's ruling of 2026-10-23): the account is the one CLAUDE_CONFIG_DIR names, so
// either spelling of the flag is an unknown argument.
test('install-args: --space is refused as unknown', () =>
{
    fails(['install', '--space', 'work'], /unknown argument '--space'/);
    fails(['install', '--space=work'], /unknown argument '--space=work'/);
    assert.ok(!('space' in ok(['install'])), 'no space key is parsed');
});

test('install-args: every enum refuses a value outside its set', () =>
{
    fails(['install', '--scope', 'repo'], /--scope must be 'project', 'user' or 'local'/);
    fails(['install', '--docs-versioning', 'svn'], /--docs-versioning must be 'git' or 'local'/);
});

test('install-args: the defaults are nothing decided - scope included (I3)', () =>
{
    const p = ok(['install']);
    // I3 (R47): '' means 'not given' here too - alfred-code.js resolves it (project on a plain
    // install, the stamp's own scope on an update with no stamp line) once it can read the stamp.
    // Collapsing to 'project' in args.js is the bug this fixes: a later update on a user/local
    // install would silently fall back to project scope.
    assert.strictEqual(p.scope, '');
    // '' means 'not given' - a later rule decides, and that is NOT the same as a default
    assert.strictEqual(p.docsVersioning, '');
    assert.deepStrictEqual(p.ignored, [], 'nothing was ignored');
    for (const key of ['memoryLevel', 'playwrightBrowsers', 'playwrightEnabled']) assert.ok(!(key in p), `${key} is still parsed`);
});

// A-M4 (final review A): a generic ambient SCOPE is another tool's variable - read as this installer's
// scope, a `SCOPE=user` in the launching shell made a project run account-wide. Only the flag counts.
test('install-args: the scope comes from --scope alone - an ambient SCOPE is never read (A-M4)', () =>
{
    assert.strictEqual(ok(['install'], { SCOPE: 'user' }).scope, '');
    assert.strictEqual(ok(['install'], { SCOPE: 'global' }).scope, '');
    assert.strictEqual(ok(['install', '--scope', 'project'], { SCOPE: 'user' }).scope, 'project');
});

test("install-args: 'global' is accepted as an alias of 'user' - a 1.x command body still passes it", () =>
{
    assert.strictEqual(ok(['install', '--scope', 'global']).scope, 'user');
    assert.strictEqual(ok(['install', '--scope', 'GLOBAL']).scope, 'user');
});

// 2.10.1 took the servers out (the user's ruling of 2026-10-24), and with them the flags that configured them. A session
// started before the update still runs the older command body against this snapshot, so each is ACCEPTED with its value,
// in either spelling, and ignored - one line each, which the installer logs - never refused, never read as the action.
test('install-args: the server flags 2.10.1 retired are accepted with their value and ignored, one line each', () =>
{
    for (const flag of ['--memory-level', '--browsers', '--browser-enabled', '--playwright-browsers', '--playwright-enabled'])
    {
        const line = new RegExp(`^${flag} ignored - the (memory|browser) servers? left the stack in 2\\.10\\.1$`);
        for (const argv of [['update', flag, 'project'], ['update', `${flag}=chrome,firefox`], [flag, 'all', 'update']])
        {
            const p = ok(argv);
            assert.strictEqual(p.action, 'update', `${argv.join(' ')}: the value was read as the action`);
            assert.strictEqual(p.ignored.length, 1, argv.join(' '));
            assert.match(p.ignored[0], line);
        }
        assert.strictEqual(ok(['update', flag]).ignored.length, 1, `${flag} given last with no value is still only ignored`);
        assert.ok(!require('./install/args.js').FLAG_LIST.includes(flag), `the usage still lists ${flag}`);
    }
    assert.deepStrictEqual(ok(['install', '--browsers', 'chrome', '--memory-level', 'global']).ignored.length, 2, 'one line per flag');
});

// ------------------------------------------------------------------ the entry point

const { main } = require('./install/alfred-code.js');

// The entry is driven in-process with captured streams - an execFileSync per case would add seconds
// to a file that runs in milliseconds - so it is SANDBOXED BY ITS CWD. `main` takes the project
// root from `io.cwd`'s git root, and this suite runs inside the stack's own checkout: a case that
// reaches the layers with the default cwd installs the whole stack into THIS repo, over the
// developer's own `.claude/` (measured 2026-09-22 - it wrote a settings.json env pointing at
// /nonexistent-home and turned two hook cases red). A temp cwd outside any repo makes that
// impossible for every case in this file, including the ones added next.
const ENTRY_CWD = fs.mkdtempSync(path.join(TMP_ENTRY, 'cwd-'));
function run(argv, env = {})
{
    let out = '';
    let err = '';
    const code = main(argv, { HOME: '/nonexistent-home', CLAUDE_CONFIG_DIR: path.join(ENTRY_CWD, '.acct'), ...env },
        { out: (s) => { out += s; }, err: (s) => { err += s; }, cwd: ENTRY_CWD });
    return { code, out, err };
}

test('install-entry: a bad flag prints the usage and exits 1 - nothing is resolved first', () =>
{
    const r = run(['install', '--scope', 'repo']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /--scope must be 'project', 'user' or 'local'/);
    assert.match(r.err, /Usage:/, 'the refusal printed no usage');
    assert.strictEqual(r.out, '', 'a refused run still resolved a source');
});

test('install-entry: --print-plan prints the six resolved lists and exits 0, writing nothing', () =>
{
    const r = run(['install', '--source', ROOT, '--print-plan', '--memory-level', 'project']);
    assert.strictEqual(r.code, 0, `--print-plan failed: ${r.err}`);
    assert.match(r.out, /source: .*\(provided\)/);
    for (const list of ['skills', 'plugins', 'agents', 'rules', 'hooks'])
        assert.match(r.out, new RegExp(`^plan ${list}: \\S`, 'm'), `the plan named no ${list}`);
    // The stack ships no MCP server since 2.10.1: the line stays, so a reader of the six lists still finds it, empty.
    assert.match(r.out, /^plan mcps:$/m);
    assert.match(r.out, /--memory-level ignored - the memory server left the stack in 2\.10\.1/, 'the ignored flag was not said');
});

test('install-entry: --print-plan resolves NO runtime versions - a dry run makes no network call', () =>
{
    const r = run(['install', '--source', ROOT, '--print-plan']);
    assert.ok(!/resolving latest|pinned /.test(r.out), `a dry run went to the network: ${r.out.slice(0, 200)}`);
});

test('install-entry: the project root comes from io.cwd, never from the process', () =>
{
    // The sandbox above is only real if `main` actually anchors there. --installed-only names the
    // directory it looked in, so one refusal proves the whole file cannot reach this repo: with the
    // process cwd it would find the stack's own .claude and run a real update over it.
    const r = run(['update', '--source', ROOT, '--installed-only']);
    assert.strictEqual(r.code, 1);
    assert.match(r.err, /found nothing installed under/);
    assert.ok(r.err.includes(ENTRY_CWD), `looked somewhere else: ${r.err}`);
});

// R95 (Task 18b fix round 1): a git worktree whose own `.claude` holds no install record shares its main
// checkout's install. A run here would write a second install into the worktree, or - for an update -
// find nothing and name setup, which named update back (the loop the review measured). Every action
// stops before anything is resolved or written, naming the checkout to run from.
test('install-entry: in a worktree of an installed checkout every action stops, naming the main checkout, and writes nothing (R95)', () =>
{
    const { execFileSync } = require('node:child_process');
    const main = fs.mkdtempSync(path.join(TMP_ENTRY, 'wt-main-'));
    const git = (...a) => execFileSync('git', ['-C', main, ...a], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q');
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'init');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\nscope: project\n');
    const wt = path.join(TMP_ENTRY, `wt-${path.basename(main)}`);
    git('worktree', 'add', '-q', wt);
    const mainBefore = fs.readdirSync(path.join(main, '.claude')).sort();
    for (const argv of [['install'], ['update'], ['update', '--installed-only'], ['update', '--installed-only', '--print-plan']])
    {
        let out = '';
        let err = '';
        const code = require('./install/alfred-code.js').main([...argv, '--source', ROOT], { HOME: '/nonexistent-home', CLAUDE_CONFIG_DIR: path.join(wt, '..', 'wt-acct') },
            { out: (x) => { out += x; }, err: (x) => { err += x; }, cwd: wt });
        assert.strictEqual(code, 1, `${argv.join(' ')}: ${out.slice(-300)}`);
        assert.match(err, /^error: this is a git worktree of .+, which holds the install - run the installer from there$/m, `${argv.join(' ')}: ${err}`);
        // git names the checkout in the file system's own letter case, which a temp root can spell differently
        assert.ok([main, fs.realpathSync(main), fs.realpathSync.native(main)].some((p) => err.includes(p)), err);
        assert.ok(!/found nothing installed/.test(err), 'never the setup-naming refusal');
        assert.ok(!fs.existsSync(path.join(wt, '.claude')), `${argv.join(' ')}: wrote into the worktree`);
        assert.deepStrictEqual(fs.readdirSync(path.join(main, '.claude')).sort(), mainBefore, `${argv.join(' ')}: wrote into the main checkout`);
        assert.ok(!/^action: /m.test(out), 'no run started');
    }
});

test('install-entry: a --source that is not the stack fails before any layer is reached', () =>
{
    const r = run(['install', '--source', path.join(TMP_ENTRY, 'nope')]);
    assert.strictEqual(r.code, 1);
    // On the log stream, not stderr - the same place the sh twin reports it, so a run's transcript
    // reads the same whichever route produced it.
    assert.match(r.out, /not an alfred-code checkout/);
});

// An install carrying one copied skill and nothing else, read back by a copy-route update's dry run.
function planOverSkillOnly(skill)
{
    const repo = fs.mkdtempSync(path.join(TMP_ENTRY, `only-${skill}-`));
    fs.mkdirSync(path.join(repo, '.claude', 'skills', skill), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'stack', 'skills', skill, 'SKILL.md'), path.join(repo, '.claude', 'skills', skill, 'SKILL.md'));
    let out = '';
    let err = '';
    const copyRoute = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
    const code = main(['update', '--source', ROOT, '--installed-only', '--print-plan'],
        { HOME: '/nonexistent-home', CLAUDE_CONFIG_DIR: path.join(repo, '.acct'), ...copyRoute },
        { out: (s) => { out += s; }, err: (s) => { err += s; }, cwd: repo });
    assert.strictEqual(code, 0, `the update failed: ${err}`);
    return (/^plan mcps:(.*)$/m.exec(out) || [])[1].trim().split(/\s+/).filter(Boolean);
}

// 2.10.1: no server is locked, seeded or required by a skill any more, so an update plans none - on any route.
test('install-entry: an update plans no MCP server, whatever the picks', () =>
{
    assert.deepStrictEqual(planOverSkillOnly('csharp'), [], 'csharp required the documentation server until 2.10.1');
    assert.deepStrictEqual(planOverSkillOnly('markdown-style'), []);
});

// R83 a (Task 18b) supersedes dce452e's 'an install whose picks need no server still gets none': on the
// FULL copy route the registrations come from this plan alone, so an install whose picks need no
// 2.0.0 cut the sentry and context7-local servers (R26, R32): their flags are refused in one line
// naming the release, in either spelling and with any value - a command body still passing one fails
// loudly before anything is written, instead of reading as a choice nothing honours.
test('install-args: --context7, --sentry-slug and --sentry-auth are refused - removed in 2.0.0', () =>
{
    for (const [flag, value] of [['--context7', 'local'], ['--context7', 'remote'], ['--sentry-slug', 'acme/api'], ['--sentry-auth', 'oauth']])
    {
        fails(['install', flag, value], new RegExp(`^${flag} was removed in 2\\.0\\.0`));
        fails(['update', `${flag}=${value}`], new RegExp(`^${flag} was removed in 2\\.0\\.0`));
        fails(['update', flag], new RegExp(`^${flag} was removed in 2\\.0\\.0`));
        assert.throws(() => parseArgs(['install', flag, value], {}), (err) => !err.message.includes('\n'), `${flag}: one line`);
    }
    // The environment spellings are no flags: nothing reads them, and nothing refuses them.
    const p = ok(['install'], { SENTRY_SLUG: 'from-env', CONTEXT7_MODE: 'local' });
    for (const key of ['documentation', 'context7Given', 'sentrySlug', 'sentryAuth']) assert.ok(!(key in p), `${key} is still parsed`);
});

test('args: --add is repeatable, takes <category> <name>, and belongs to --installed-only', () =>
{
    const got = parseArgs(['update', '--installed-only', '--add', 'rule sql-conventions', '--add=skill csharp'], {});
    assert.deepStrictEqual(got.add, ['rule sql-conventions', 'skill csharp']);
    assert.deepStrictEqual(parseArgs(['update'], {}).add, []);
    assert.throws(() => parseArgs(['update', '--add', 'rule sql-conventions'], {}), /--add needs --installed-only/);
    assert.throws(() => parseArgs(['update', '--installed-only', '--add', 'sql-conventions'], {}), /--add takes/);
    assert.throws(() => parseArgs(['update', '--installed-only', '--add', 'widget x'], {}), /--add takes/);
});

test('args: --drop mirrors --add - repeatable, <category> <name>, only with --installed-only', () =>
{
    const got = parseArgs(['update', '--installed-only', '--drop', 'hook guard-answer', '--drop=agent security-auditor'], {});
    assert.deepStrictEqual(got.drop, ['hook guard-answer', 'agent security-auditor']);
    assert.throws(() => parseArgs(['update', '--drop', 'hook x'], {}), /--drop needs --installed-only/);
    assert.throws(() => parseArgs(['update', '--installed-only', '--drop', 'x'], {}), /--drop takes/);
});

test('args: --plan-out takes a file and belongs to --print-plan', () =>
{
    assert.strictEqual(parseArgs(['update', '--installed-only', '--print-plan', '--plan-out', 'inv.json'], {}).planOut, 'inv.json');
    assert.throws(() => parseArgs(['update', '--plan-out', 'inv.json'], {}), /--plan-out needs --print-plan/);
});

// The answer to update's hand-set docs-root ask (the user's answers of 2026-10-20): a move, naming the team's own entries
// to leave where they are - no keep, since every docs file of the stack's belongs under the data root.
test('install-args: --docs-root-leave names top-level entries and belongs to --docs-root-move move; keep is gone', () =>
{
    assert.deepStrictEqual(ok(['update', '--docs-root-move', 'move', '--docs-root-leave', 'architecture/, decisions']).docsRootLeave, ['architecture', 'decisions']);
    assert.deepStrictEqual(ok(['update']).docsRootLeave, []);
    fails(['update', '--docs-root-move', 'keep'], /--docs-root-move must be 'move'/);
    fails(['update', '--docs-root-leave', 'architecture'], /--docs-root-leave needs --docs-root-move move/);
    fails(['update', '--docs-root-move', 'move', '--docs-root-leave', '../x'], /--docs-root-leave names top-level entries/);
    fails(['update', '--docs-root-move', 'move', '--docs-root-leave', 'a/b'], /--docs-root-leave names top-level entries/);
});

// T4: configure and validate take their inventory from this dry run, so it names what the plan
// answered and writes the walk's --installed JSON - and nothing else.
test('install-entry: --print-plan --plan-out writes the inventory JSON and names what was answered', () =>
{
    const inv = path.join(ENTRY_CWD, 'installed.json');
    const r = run(['install', '--source', ROOT, '--print-plan', '--plan-out', inv], { PATH: '/nonexistent-bin' });
    assert.strictEqual(r.code, 0, `--plan-out failed: ${r.err}`);
    assert.match(r.out, /^plan answered: hooks=yes agents=yes$/m);
    const got = JSON.parse(fs.readFileSync(inv, 'utf8'));
    for (const k of ['rules', 'agents', 'skills', 'hooks', 'mcps', 'plugins', 'plugins_disabled']) assert.ok(Array.isArray(got[k]), k);
    assert.deepStrictEqual(got.mcps, [], 'no server is in the inventory');
    assert.ok(!fs.existsSync(path.join(ENTRY_CWD, '.claude')), 'the dry run wrote into the project');
});


// The 2.0.0 rename: --browsers / --browser-enabled are the flags; a command body from before it passes
// --playwright-browsers / --playwright-enabled, read as the same flag for one release. Both spellings of
// 2.2.0 (the user's ruling of 2026-10-06): each optional item - an LSP, claude-hud - takes its own scope, global (every
// project on the account) or project (this one); the core follows --scope and takes none. A retired server's own scope
// (a browser engine, a desktop or mobile server, until 2.10.1) is ignored with a line - an older walk still passes it.
test('install-args: --scope-of gives an optional item its own scope; the required ones take none', () =>
{
    assert.deepStrictEqual(ok(['install']).scopeOf, {}, 'no choice made: the run decides');
    const a = ok(['install', '--scope-of', 'claude-hud=global', '--scope-of=csharp-lsp=project', '--scope-of', 'TypeScript-LSP=User']);
    assert.deepStrictEqual(a.scopeOf, { 'claude-hud': 'user', 'csharp-lsp': 'project', 'typescript-lsp': 'user' }, 'global and user are one, the spelling is case-free');
    for (const item of ['alfred-code', 'superpowers'])
        fails(['install', '--scope-of', `${item}=global`], /--scope-of: '.*' has no scope of its own - one of typescript-lsp, csharp-lsp, claude-hud; the core follows --scope/);
    const c = ok(['install', '--scope-of', 'claude-hud=local']);
    assert.deepStrictEqual(c.scopeOf, { 'claude-hud': 'local' }, 'local is a scope of its own');
    for (const item of ['browser', 'chrome-control', 'webkit-control', 'windows-control', 'macos-control', 'mobile-control', 'alfred-navigation', 'alfred-memory', 'alfred-documentation'])
    {
        const p = ok(['update', '--scope-of', `${item}=global`]);
        assert.deepStrictEqual(p.scopeOf, {}, `${item}: a retired server took a scope`);
        assert.deepStrictEqual(p.ignored, [`--scope-of ${item} ignored - the server left the stack in 2.10.1`], item);
    }
    // managed is the admin's - no run installs there, so it is no answer.
    for (const bad of ['claude-hud', 'claude-hud=managed', 'claude-hud=', '=project'])
        fails(['install', '--scope-of', bad], /--scope-of takes '<item>=<global\|project\|local>'/);
    fails(['install', '--scope-of'], /--scope-of takes/);
    assert.ok(require('./install/args.js').FLAG_LIST.includes('--scope-of'));
});

test('install-args: --instructions-at places the instruction file - root or claude, lower-cased, anything else refused', () =>
{
    assert.strictEqual(ok(['install']).instructionsAt, '', 'not given: nothing moves and a seed goes to .claude/');
    assert.strictEqual(ok(['install', '--instructions-at', 'root']).instructionsAt, 'root');
    assert.strictEqual(ok(['update', '--instructions-at=Claude']).instructionsAt, 'claude');
    fails(['install', '--instructions-at', 'docs'], /--instructions-at must be 'root' or 'claude'/);
    fails(['install', '--instructions-at'], /--instructions-at.*needs a value/);
});

test('install-args: --instructions-file names the instruction file - agents or claude, lower-cased, anything else refused', () =>
{
    assert.strictEqual(ok(['install']).instructionsFile, '', 'not given: the stamp\'s answer stands, else AGENTS.md');
    assert.strictEqual(ok(['install', '--instructions-file', 'claude']).instructionsFile, 'claude');
    assert.strictEqual(ok(['update', '--instructions-file=Agents']).instructionsFile, 'agents');
    fails(['install', '--instructions-file', 'CLAUDE.md'], /--instructions-file must be 'agents' or 'claude'/);
    fails(['install', '--instructions-file'], /--instructions-file.*needs a value/);
    fails(['update', '--rename-claude-md'], /unknown argument '--rename-claude-md'/, 'the name answer renames now - the old flag is gone');
});

// The user's ask of 2026-10-23: /alfred-code:uninstall asks before an unedited instruction-file seed is deleted, and
// passes the answer; a run with no answer keeps the file.
test('install-args: --instructions-seed is uninstall\'s answer for the seed - keep or remove, lower-cased, anything else refused', () =>
{
    assert.strictEqual(ok(['uninstall']).instructionsSeed, '', 'not given: the seed is kept');
    assert.strictEqual(ok(['uninstall', '--instructions-seed', 'remove']).instructionsSeed, 'remove');
    assert.strictEqual(ok(['uninstall', '--instructions-seed=Keep']).instructionsSeed, 'keep');
    assert.ok(require('./install/args.js').FLAG_LIST.includes('--instructions-seed'));
    fails(['uninstall', '--instructions-seed', 'delete'], /--instructions-seed must be 'keep' or 'remove'/);
    fails(['uninstall', '--instructions-seed'], /--instructions-seed.*needs a value/);
    fails(['update', '--instructions-seed', 'remove'], /--instructions-seed is uninstall's answer/);
});
