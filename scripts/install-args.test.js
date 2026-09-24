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
        ['--space', 'work', 'space'],
        ['--scope', 'local', 'scope'],
        ['--docs-versioning', 'local', 'docsVersioning'],
        ['--memory-level', 'scoped', 'memoryLevel'],
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
    for (const flag of ['--space', '--scope',
        '--docs-versioning', '--memory-level', '--selection', '--source'])
        fails(['install', flag], new RegExp(`${flag}.*needs a value`));
});

test('install-args: the boolean flags take no value', () =>
{
    const p = ok(['install', '--github-cli', '--keep-pins', '--installed-only', '--print-plan', '--skills-only']);
    assert.strictEqual(p.githubCli, true);
    assert.strictEqual(p.keepPins, true);
    assert.strictEqual(p.installedOnly, true);
    assert.strictEqual(p.printPlan, true);
    assert.strictEqual(p.skillsOnly, true);
});

test('install-args: an unknown argument is refused and the message NAMES the flags', () =>
{
    fails(['install', '--oops'], /unknown argument '--oops'/);
    fails(['install', '--oops'], /--memory-level/);   // the message lists what IS accepted
});

test('install-args: the enums are lower-cased, so PowerShell casing works on both seeds', () =>
{
    assert.strictEqual(ok(['install', '--scope', 'Local']).scope, 'local');
    assert.strictEqual(ok(['install', '--docs-versioning', 'Git']).docsVersioning, 'git');
    assert.strictEqual(ok(['install', '--memory-level', 'Scoped']).memoryLevel, 'scoped');
});

test('install-args: --space is baked into a PATH, so its characters are checked', () =>
{
    assert.strictEqual(ok(['install', '--space', 'work-2.0_x']).space, 'work-2.0_x');
    fails(['install', '--space', '-lead'], /--space/);
    fails(['install', '--space', 'has space'], /--space/);
    fails(['install', '--space', 'sl/ash'], /--space/);
    // the casing of a space IS significant - it names a directory
    assert.strictEqual(ok(['install', '--space', 'Work']).space, 'Work');
});

test('install-args: every enum refuses a value outside its set', () =>
{
    fails(['install', '--scope', 'repo'], /--scope must be 'project', 'user' or 'local'/);
    fails(['install', '--docs-versioning', 'svn'], /--docs-versioning must be 'git' or 'local'/);
    fails(['install', '--memory-level', 'account'], /--memory-level must be/);
});

test('install-args: the defaults are project scope, and nothing else decided', () =>
{
    const p = ok(['install']);
    assert.strictEqual(p.scope, 'project');
    // '' means 'not given' - a later rule decides, and that is NOT the same as a default
    assert.strictEqual(p.docsVersioning, '');
    assert.strictEqual(p.memoryLevel, '');
    assert.deepStrictEqual(p.playwrightBrowsers, []);
});

test('install-args: the flag beats the environment, and the environment beats the default', () =>
{
    assert.strictEqual(ok(['install'], { SCOPE: 'user' }).scope, 'user');
    assert.strictEqual(ok(['install', '--scope', 'project'], { SCOPE: 'user' }).scope, 'project');
});

test("install-args: 'global' is accepted as an alias of 'user' - a 1.x command body still passes it", () =>
{
    assert.strictEqual(ok(['install', '--scope', 'global']).scope, 'user');
    assert.strictEqual(ok(['install', '--scope', 'GLOBAL']).scope, 'user');
    assert.strictEqual(ok(['install'], { SCOPE: 'global' }).scope, 'user');
});

test('install-args: --memory-level project rides every scope - the db path is resolved per project, not baked into the registration', () =>
{
    assert.strictEqual(ok(['install', '--memory-level', 'project']).memoryLevel, 'project');
    assert.strictEqual(ok(['install', '--memory-level', 'project', '--scope', 'user']).memoryLevel, 'project');
    assert.strictEqual(ok(['install', '--memory-level', 'project', '--scope', 'local']).memoryLevel, 'project');
    assert.strictEqual(ok(['install', '--memory-level', 'project', '--scope', 'global']).memoryLevel, 'project');
});

test('install-args: the playwright engines come back in ONE canonical order, however they were typed', () =>
{
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'webkit,chrome']).playwrightBrowsers,
        ['chrome', 'webkit'], 'the server list depends on how the flag was typed');
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'MSEdge,Firefox']).playwrightBrowsers,
        ['msedge', 'firefox']);
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'chrome,chrome']).playwrightBrowsers,
        ['chrome'], 'a repeated engine produced two servers');
});

test('install-args: a playwright value naming no engine is a typo, never "no flag"', () =>
{
    fails(['install', '--playwright-browsers', ','], /--playwright-browsers needs at least one/);
    fails(['install', '--playwright-browsers', 'safari'], /--playwright-browsers takes chrome, msedge, firefox, webkit/);
    fails(['install', '--playwright-browsers='], /--playwright-browsers.*needs a value/);
});

test('install-args: --playwright-enabled takes the engines to ENABLE - a csv, all or none; absent is null, never a choice', () =>
{
    // Two choices, both the user's (R67): which engines to install, and which of those to enable.
    // Absent means 'not asked' - a fresh install enables every engine, an update flips nothing.
    assert.strictEqual(ok(['install']).playwrightEnabled, null);
    assert.deepStrictEqual(ok(['install', '--playwright-enabled', 'webkit,Chrome']).playwrightEnabled, ['chrome', 'webkit'],
        'the enabled set depends on how the flag was typed');
    assert.deepStrictEqual(ok(['install', '--playwright-enabled=firefox']).playwrightEnabled, ['firefox']);
    assert.strictEqual(ok(['install', '--playwright-enabled', 'ALL']).playwrightEnabled, 'all');
    assert.deepStrictEqual(ok(['install', '--playwright-enabled', 'none']).playwrightEnabled, [], 'none is an empty set, not an absent flag');
    assert.deepStrictEqual(ok(['install', '--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'firefox']).playwrightEnabled, ['firefox']);
    assert.ok(require('./install/args.js').FLAG_LIST.includes('--playwright-enabled'), 'the usage does not list the flag');
});

test('install-args: --playwright-enabled refuses an engine it cannot enable, in one line', () =>
{
    fails(['install', '--playwright-enabled', 'safari'], /--playwright-enabled takes all, none, or chrome, msedge, firefox, webkit \(got 'safari'\)/);
    fails(['install', '--playwright-enabled', ','], /--playwright-enabled needs all, none, or at least one of chrome, msedge, firefox, webkit/);
    fails(['install', '--playwright-enabled', 'all,chrome'], /--playwright-enabled takes all or none ALONE/);
    fails(['install', '--playwright-enabled', 'none,firefox'], /--playwright-enabled takes all or none ALONE/);
    fails(['install', '--playwright-enabled'], /--playwright-enabled needs a value/);
    // Beside an explicit install set, an engine outside it is refused - it would never be installed.
    fails(['install', '--playwright-browsers', 'chrome', '--playwright-enabled', 'chrome,webkit'],
        /^--playwright-enabled names webkit, which --playwright-browsers does not install \(chrome\) - enable only an engine being installed$/);
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
    const r = run(['install', '--source', ROOT, '--print-plan', '--memory-level', 'scoped']);
    assert.strictEqual(r.code, 0, `--print-plan failed: ${r.err}`);
    assert.match(r.out, /source: .*\(provided\)/);
    for (const list of ['skills', 'plugins', 'mcps', 'agents', 'rules', 'hooks'])
        assert.match(r.out, new RegExp(`^plan ${list}: \\S`, 'm'), `the plan named no ${list}`);
    // The playwright row is expanded into its engines BEFORE the plan is printed, so the dry run
    // reports the servers a real run would register, not the catalog row they come from.
    assert.match(r.out, /^plan mcps: .*playwright-chrome/m);
    assert.ok(!/^plan mcps: .*(^| )playwright\|/m.test(r.out), 'the unexpanded catalog row reached the plan');
});

test('install-entry: --playwright-enabled naming an engine this run does not install is refused before anything is written', () =>
{
    // No --playwright-browsers: the kept set is chrome (the default), so firefox is not being installed.
    const r = run(['install', '--source', ROOT, '--print-plan', '--playwright-enabled', 'firefox']);
    assert.strictEqual(r.code, 1, r.out.slice(0, 400));
    assert.match(r.err, /--playwright-enabled names firefox, which this run does not install \(installs: chrome\) - enable only an engine being installed/);
    assert.ok(!/^plan /m.test(r.out), 'the refused run still printed a plan');
    const all = run(['install', '--source', ROOT, '--print-plan', '--playwright-browsers', 'chrome,firefox', '--playwright-enabled', 'all']);
    assert.strictEqual(all.code, 0, all.err);
    assert.match(all.out, /^plan mcps: .*playwright-chrome.*playwright-firefox/m);
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

test('install-entry: an update over an install carrying no server plans all three locked servers in ONE run', () =>
{
    // The read-back adopts the locked servers only into an install that carries the mcp layer, and
    // the closure brings that layer in AFTER it (csharp requires context7) - so the first update
    // registered context7 alone and the second added serena and memory. One update is the fixed point.
    const mcps = planOverSkillOnly('csharp');
    for (const name of ['serena', 'context7', 'memory'])
        assert.ok(mcps.includes(name), `${name} is not in the plan: ${mcps.join(' ')}`);
});

test('install-entry: an install whose picks need no server stays without one - the layer is still not carried', () =>
{
    assert.deepStrictEqual(planOverSkillOnly('markdown-style'), []);
});

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
    for (const key of ['context7', 'context7Given', 'sentrySlug', 'sentryAuth']) assert.ok(!(key in p), `${key} is still parsed`);
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
    const got = parseArgs(['update', '--installed-only', '--drop', 'hook guard-answer-length', '--drop=agent security-auditor'], {});
    assert.deepStrictEqual(got.drop, ['hook guard-answer-length', 'agent security-auditor']);
    assert.throws(() => parseArgs(['update', '--drop', 'hook x'], {}), /--drop needs --installed-only/);
    assert.throws(() => parseArgs(['update', '--installed-only', '--drop', 'x'], {}), /--drop takes/);
});

test('args: --plan-out takes a file and belongs to --print-plan', () =>
{
    assert.strictEqual(parseArgs(['update', '--installed-only', '--print-plan', '--plan-out', 'inv.json'], {}).planOut, 'inv.json');
    assert.throws(() => parseArgs(['update', '--plan-out', 'inv.json'], {}), /--plan-out needs --print-plan/);
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
    assert.ok(got.mcps.includes('playwright') && !got.mcps.some((m) => m.startsWith('playwright-')), 'the engines fold back onto the catalog row');
    assert.ok(!fs.existsSync(path.join(ENTRY_CWD, '.claude')), 'the dry run wrote into the project');
});
