'use strict';
// THE D8 A/B FIXTURES - the tracked builder the billed A/B (docs/superpowers/plans/2026-11-03-d8-ab.md) stands on.
// `scripts/profile-fixture.js` writes only a stack's marker files; this lays a task's real code over a profile-fixture
// project: a shared base (`common/angular`, `common/dotnet`), then the task's own `files/`. A task's `reference/` (one
// correct answer) is laid only by `check` and shown to the grader - never by `build`.
//
//   node scripts/d8-ab-fixtures.js list
//   node scripts/d8-ab-fixtures.js check <id> [--cache <dir>]
//   node scripts/d8-ab-fixtures.js build <id> <workdir> --export <dir> [--cache <dir>]
//
// `check` needs no stack install and no `claude`: in a temp dir it proves the base suite green except the acceptance
// test, which is red, then the reference green with the acceptance count passed, and the size trigger present. `build`
// installs the stack from an export (profile-fixture), lays the task, installs dependencies through the shared caches
// under <cache> (never the user's own npm or NuGet folders) and commits the result as the run's base.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnCommand } = require('./install/runtime.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'd8-ab');
const COMMON = 'common';
// The one list `change.diff` and `after.tar` both leave out: install output, build output, the stack's own folders and
// the seeded log - none of it is the run's change.
const JUDGE_EXCLUDES = ['.claude', '.alfred', 'node_modules', 'dist', '.angular', 'bin', 'obj', 'logs'];
const TIMEOUT_MS = 20 * 60 * 1000;
const IDENTITY = ['-c', 'user.name=Fixture Dev', '-c', 'user.email=dev@fixture.invalid', '-c', 'commit.gpgsign=false'];

function walk(dir, base = dir, out = [])
{
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
    {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, base, out);
        else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
}

function list()
{
    return fs.readdirSync(FIXTURES, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== COMMON && fs.existsSync(path.join(FIXTURES, e.name, 'task.json')))
        .map((e) => e.name).sort();
}

const DEFAULTS = { from: null, also: [], skills: [], base: null, second: null, size: null, rest: '', acceptance: '', oracle: [], acceptanceCount: 0, generate: null };

function loadTask(id)
{
    const file = path.join(FIXTURES, id, 'task.json');
    if (!fs.existsSync(file)) throw new Error(`d8-ab-fixtures: no task '${id}' - one of ${list().join(', ')}`);
    const own = JSON.parse(fs.readFileSync(file, 'utf8'));
    const inherited = own.from ? loadTask(own.from) : {};
    return { ...DEFAULTS, ...inherited, ...own, id, from: own.from || null };
}

// The folder whose files/ and reference/ a task lays: its own, or the one it inherits from.
function sourceOf(id)
{
    const own = JSON.parse(fs.readFileSync(path.join(FIXTURES, id, 'task.json'), 'utf8'));
    return own.from ? sourceOf(own.from) : id;
}

// What a project gets, in order: the base (its `gitignore` is folded into .gitignore, never laid), the task's files/,
// and only on request its reference/. `from` is relative to scripts/fixtures/d8-ab, `rel` to the project.
function layout(id, { reference = false } = {})
{
    const task = loadTask(id);
    const src = sourceOf(id);
    const entries = [];
    const add = (layer, dir) =>
    {
        const abs = path.join(FIXTURES, dir);
        if (!fs.existsSync(abs)) return;
        for (const rel of walk(abs))
        {
            if (layer === 'base' && rel === 'gitignore') continue;
            entries.push({ layer, from: `${dir}/${rel}`, rel });
        }
    };
    if (task.base) add('base', task.base);
    add('files', `${src}/files`);
    if (reference) add('reference', `${src}/reference`);
    return entries;
}

function lay(entries, project)
{
    for (const e of entries)
    {
        const to = path.join(project, e.rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(FIXTURES, e.from), to);
    }
}

function gitignoreLines(task)
{
    const bases = [task.base, ...(task.also || []).map((p) => `${COMMON}/${p}`)].filter(Boolean);
    const out = [];
    for (const b of bases)
    {
        const f = path.join(FIXTURES, b, 'gitignore');
        if (fs.existsSync(f)) out.push(...fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
    }
    return [...new Set(out)];
}

function writeGitignore(project, task)
{
    const file = path.join(project, '.gitignore');
    const had = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
    fs.writeFileSync(file, `${[...new Set([...had, ...gitignoreLines(task)])].join('\n')}\n`);
}

// The profile's marker files the laid layers did not write (a stub `app.component.ts`, a `src/App` the task does not
// use) would be stray code in the run's base, so they go.
function removeStrayMarkers(profile, project, entries)
{
    const { MARKERS } = require('./profile-fixture.js');
    const laid = new Set(entries.map((e) => e.rel));
    const removed = [];
    for (const rel of Object.keys(MARKERS[profile] || {}))
    {
        if (laid.has(rel)) continue;
        const p = path.join(project, rel);
        if (!fs.existsSync(p)) continue;
        fs.rmSync(p, { force: true });
        removed.push(rel);
        for (let d = path.dirname(p); d.startsWith(project) && d !== project; d = path.dirname(d))
        {
            if (fs.readdirSync(d).length) break;
            fs.rmdirSync(d);
        }
    }
    return removed;
}

// ---------------------------------------------------------------------------------------------
// Commands - argv steps, never a shell string
// ---------------------------------------------------------------------------------------------
const steps = (line) => String(line || '').split('&&').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/));

function toolEnv(cacheDir, home, base = process.env)
{
    const env = { ...base };
    for (const k of Object.keys(env)) if (/^ALFRED_CODE_/.test(k) || ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_CONFIG_DIR'].includes(k)) delete env[k];
    return {
        ...env,
        HOME: home,
        USERPROFILE: home,
        npm_config_cache: path.join(cacheDir, 'npm'),
        npm_config_update_notifier: 'false',
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        NG_CLI_ANALYTICS: 'false',
        NUGET_PACKAGES: path.join(cacheDir, 'nuget', 'packages'),
        NUGET_HTTP_CACHE_PATH: path.join(cacheDir, 'nuget', 'http'),
        NUGET_PLUGINS_CACHE_PATH: path.join(cacheDir, 'nuget', 'plugins'),
        DOTNET_CLI_HOME: path.join(cacheDir, 'dotnet-home'),
        DOTNET_NOLOGO: '1',
        DOTNET_CLI_TELEMETRY_OPTOUT: '1',
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    };
}

function runLine(line, { cwd, env, log })
{
    let output = '';
    for (const argv of steps(line))
    {
        const r = spawnCommand(argv[0], argv.slice(1), { cwd, env, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 });
        const said = `${r.stdout || ''}${r.stderr || ''}`;
        output += `$ ${argv.join(' ')}\n${said}\n[exit ${r.status}]\n`;
        if (log) fs.appendFileSync(log, `$ ${argv.join(' ')}\n${said}\n[exit ${r.status}]\n\n`);
        if (r.status !== 0) return { status: r.status === null ? 1 : r.status, output };
    }
    return { status: 0, output };
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
// How many tests a runner reports passed: Vitest's `Tests  <n> passed` (with or without a failed count before it), or
// dotnet's `Passed: <n>`. No line -> 0, so a filter that matched nothing never reads as a pass.
function passedCount(output)
{
    const text = String(output || '').replace(ANSI, '');
    let n = 0;
    for (const m of text.matchAll(/^\s*Tests\s+(?:.*?\|\s*)?(\d+) passed/gm)) n = Math.max(n, Number(m[1]));
    for (const m of text.matchAll(/Passed:\s*(\d+)/g)) n = Math.max(n, Number(m[1]));
    return n;
}
// How many tests a runner reports failed - the proof a red acceptance ran and failed on its assertions, not on a
// compile error.
function failedCount(output)
{
    const text = String(output || '').replace(ANSI, '');
    let n = 0;
    for (const m of text.matchAll(/^\s*Tests\s+(\d+) failed/gm)) n = Math.max(n, Number(m[1]));
    for (const m of text.matchAll(/Failed:\s*(\d+)/g)) n = Math.max(n, Number(m[1]));
    return n;
}
const acceptanceResult = (exit, output, task) => exit === 0 && passedCount(output) >= Math.max(1, task.acceptanceCount || 0);

function install(task, project, env, log)
{
    if (task.base === 'common/angular' || (task.also || []).includes('angular'))
    {
        const r = runLine('npm ci', { cwd: project, env, log });
        if (r.status !== 0) throw new Error(`d8-ab-fixtures: npm ci failed in ${project} - see ${log}`);
    }
    if (task.base === 'common/dotnet' || (task.also || []).includes('dotnet'))
    {
        const r = runLine('dotnet restore', { cwd: project, env, log });
        if (r.status !== 0) throw new Error(`d8-ab-fixtures: dotnet restore failed in ${project} - see ${log}`);
    }
}

// Files a task generates instead of tracking (t3's seeded log); filled in by the tasks that need it.
function generate(task, project)
{
    const written = [];
    for (const g of [].concat(task.generate || []))
    {
        const gen = GENERATORS[g.kind];
        if (!gen) throw new Error(`d8-ab-fixtures: unknown generator '${g.kind}'`);
        const p = path.join(project, g.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, gen(g));
        written.push({ path: g.path, bytes: fs.statSync(p).size });
    }
    return written;
}
const GENERATORS = {};

function git(project, args)
{
    const r = spawnCommand('git', [...IDENTITY, ...args], { cwd: project, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`d8-ab-fixtures: git ${args.join(' ')} failed in ${project}: ${String(r.stderr || '').trim()}`);
    return r.stdout || '';
}

// ---------------------------------------------------------------------------------------------
// build - one run's project
// ---------------------------------------------------------------------------------------------
function buildFixture(id, workdir, { exportDir, cacheDir = defaultCache() } = {})
{
    const task = loadTask(id);
    const { fixture } = require('./profile-fixture.js');
    const made = fixture(task.profile, workdir, { exportDir, out: () => {} });
    const { project, account, home } = made;
    const entries = layout(id);
    lay(entries, project);
    removeStrayMarkers(task.profile, project, entries);
    writeGitignore(project, task);
    generate(task, project);
    // profile-fixture's own install.log, so `profile-fixture.js --clean` takes it with the rest.
    install(task, project, toolEnv(cacheDir, home), made.log);
    git(project, ['config', 'user.name', 'Fixture Dev']);
    git(project, ['config', 'user.email', 'dev@fixture.invalid']);
    git(project, ['add', '-A']);
    git(project, ['commit', '-q', '-m', 'base']);
    const base = git(project, ['rev-parse', 'HEAD']).trim();
    return { project, account, home, base, task };
}

// ---------------------------------------------------------------------------------------------
// check - the fixture's own suite, free, no stack install
// ---------------------------------------------------------------------------------------------
function checkFixture(id, { cacheDir = defaultCache(), keep = false } = {})
{
    const task = loadTask(id);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `d8-check-${id}-`));
    const project = path.join(dir, 'project');
    const home = path.join(dir, 'home');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    const log = path.join(dir, 'check.log');
    const env = toolEnv(cacheDir, home);
    const lines = [];
    const say = (ok, name, detail) => lines.push(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    try
    {
        const entries = layout(id);
        lay(entries, project);
        writeGitignore(project, task);
        for (const g of generate(task, project)) say(true, 'log', `${g.path} ${g.bytes}`);
        install(task, project, env, log);
        git(project, ['init', '-q']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-q', '-m', 'base']);

        if (task.acceptance)
        {
            const rest = runLine(task.rest || task.suite, { cwd: project, env, log });
            const acc = runLine(task.acceptance, { cwd: project, env, log });
            const failed = failedCount(acc.output);
            const red = !acceptanceResult(acc.status, acc.output, task) && failed > 0;
            say(rest.status === 0 && red, 'base', `acceptance ${red ? 'red' : (failed ? 'GREEN' : 'NOT RUN (no failed test reported - a compile error?)')}, rest ${rest.status === 0 ? 'green' : 'RED'} (${failed} acceptance test(s) failed)`);
        }
        else
        {
            const suite = runLine(task.suite, { cwd: project, env, log });
            say(suite.status === 0, 'base', `suite and build ${suite.status === 0 ? 'green' : 'RED'}`);
        }

        lay(layout(id, { reference: true }).filter((e) => e.layer === 'reference'), project);
        const suite = runLine(task.suite, { cwd: project, env, log });
        if (task.acceptance)
        {
            const acc = runLine(task.acceptance, { cwd: project, env, log });
            const n = passedCount(acc.output);
            const ok = acceptanceResult(acc.status, acc.output, task);
            say(suite.status === 0 && ok, 'reference', `suite ${suite.status === 0 ? 'green' : 'RED'} and acceptance ${ok ? 'green' : 'RED'} (${n} of ${task.acceptanceCount} passed)`);
        }
        else say(suite.status === 0, 'reference', `suite and build ${suite.status === 0 ? 'green' : 'RED'}`);

        git(project, ['add', '-A']);
        const names = git(project, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
        const diff = git(project, ['diff', '--cached']);
        const fileOk = !task.trigger.files || names.length >= task.trigger.files;
        const grepOk = !task.trigger.grep || new RegExp(task.trigger.grep).test(diff);
        say(fileOk && grepOk, 'trigger', `${task.trigger.text} (the reference diff touches ${names.length} file(s)${task.trigger.grep ? `, /${task.trigger.grep}/ ${grepOk ? 'found' : 'MISSING'}` : ''})`);
    }
    catch (e)
    {
        say(false, 'check', e.message);
    }
    finally
    {
        if (!keep && !lines.some((l) => l.startsWith('FAIL'))) fs.rmSync(dir, { recursive: true, force: true });
        else lines.push(`kept: ${dir} (log ${log})`);
    }
    return lines;
}

function defaultCache()
{
    return path.join(os.tmpdir(), 'alfred-d8-ab', 'cache');
}

function sha256(text)
{
    return crypto.createHash('sha256').update(text).digest('hex');
}

function main(argv)
{
    const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    const cacheDir = path.resolve(arg('--cache') || defaultCache());
    const [cmd, id, workdir] = argv.filter((a, i) => !a.startsWith('--') && !['--cache', '--export'].includes(argv[i - 1]));
    try
    {
        if (cmd === 'list') { for (const t of list()) console.log(t); return 0; }
        if (cmd === 'check' && id)
        {
            const lines = checkFixture(id, { cacheDir, keep: argv.includes('--keep') });
            for (const l of lines) console.log(l);
            return lines.some((l) => l.startsWith('FAIL')) ? 1 : 0;
        }
        if (cmd === 'build' && id && workdir && arg('--export'))
        {
            const r = buildFixture(id, workdir, { exportDir: arg('--export'), cacheDir });
            console.log(`built ${id}: project=${r.project} base=${r.base}`);
            return 0;
        }
    }
    catch (e)
    {
        console.error(e.message);
        return 1;
    }
    console.error('usage: d8-ab-fixtures.js list | check <id> [--cache <dir>] [--keep] | build <id> <workdir> --export <dir> [--cache <dir>]');
    return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { FIXTURES, JUDGE_EXCLUDES, GENERATORS, list, loadTask, layout, walk, steps, runLine, passedCount, failedCount, acceptanceResult, toolEnv, gitignoreLines, buildFixture, checkFixture, sha256, main };
