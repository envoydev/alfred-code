// THE PROFILE FIXTURE - one throwaway project per tech profile, installed from THIS working tree the way a user's
// setup installs it, so the system audit (repo-audit-system) maps what a fresh session there is sent. Six steps
// with a separate account dir each are where a hand-run goes wrong (measured 2026-10-16: the installer took the
// RELEASED core from GitHub until the export was registered as the marketplace first), so they live here once.
//
//   node scripts/profile-fixture.js <profile> <workdir> [--export <dir>] [--scope project|user|local] [--dry-run]
//   node scripts/profile-fixture.js --clean <workdir>
//
// <profile> is a `stacks` key of meta/recommendations.json, or `bare`. Writes <workdir>/<profile>/project (the
// stack's marker files, a git repo), <workdir>/<profile>/account (an isolated CLAUDE_CONFIG_DIR - nothing reaches the
// real plugin registry) and shares <workdir>/home (HOME, so the memory server's model downloads once). The export is
// `scripts/clean-export.js` of this tree, made once under <workdir>/export unless --export names one. --dry-run writes
// the project and its selection and prints the two external commands instead of running them. --scope is the
// installer's own (default project): `user` enables the plugins in the isolated account's settings, `local` in
// the project's settings.local.json. --clean deletes the test data a run left in <workdir> - each profile's fixture,
// the export and the shared home - and prints `removed:` and `left:`; the audit's results live elsewhere and stay.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawnCommand } = require('./install/runtime.js');

const ROOT = path.join(__dirname, '..');

const pkg = (scripts, deps = {}) => `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, scripts, dependencies: deps }, null, 2)}\n`;
const csproj = (sdk, props = '', items = '') => `<Project Sdk="${sdk}">\n  <PropertyGroup>\n    <TargetFramework>net9.0</TargetFramework>\n${props ? `    ${props}\n` : ''}  </PropertyGroup>\n${items ? `  <ItemGroup>\n    ${items}\n  </ItemGroup>\n` : ''}</Project>\n`;
const TSCONFIG = '{ "compilerOptions": { "strict": true, "target": "ES2022" } }\n';
const PROGRAM = 'Console.WriteLine("fixture");\n';
const ANGULAR = {
    'package.json': pkg({ build: 'ng build', test: 'ng test' }, { '@angular/core': '^20.0.0' }),
    'angular.json': '{ "version": 1, "projects": { "fixture": { "projectType": "application", "root": "" } } }\n',
    'tsconfig.json': TSCONFIG,
    'src/app/app.component.ts': "import { Component } from '@angular/core';\n\n@Component({ selector: 'app-root', template: '' })\nexport class AppComponent {}\n",
};
// The least each stack's detection (init-install.md step 3) needs to read the project as that stack.
const MARKERS = {
    bare: { 'README.md': '# Fixture\n\nA project with no stack marker.\n' },
    typescript: { 'package.json': pkg({ build: 'tsc', test: 'node --test' }), 'tsconfig.json': TSCONFIG, 'src/index.ts': 'export const answer = 42;\n' },
    javascript: { 'package.json': pkg({ test: 'node --test' }), 'src/index.js': "'use strict';\nmodule.exports = { answer: 42 };\n" },
    'web-angular': ANGULAR,
    'ionic-angular': { ...ANGULAR, 'ionic.config.json': '{ "name": "fixture", "type": "angular" }\n', 'capacitor.config.ts': "export default { appId: 'dev.fixture', appName: 'fixture', webDir: 'www' };\n" },
    'browser-extension': { 'package.json': pkg({ build: 'tsc', test: 'node --test' }), 'tsconfig.json': TSCONFIG, 'manifest.json': '{ "manifest_version": 3, "name": "fixture", "version": "1.0.0" }\n', 'src/background.ts': 'export {};\n' },
    aspnet: { 'src/Api/Api.csproj': csproj('Microsoft.NET.Sdk.Web'), 'src/Api/Program.cs': 'var app = WebApplication.CreateBuilder(args).Build();\napp.Run();\n' },
    console: { 'src/App/App.csproj': csproj('Microsoft.NET.Sdk', '<OutputType>Exe</OutputType>'), 'src/App/Program.cs': PROGRAM },
    'windows-service': { 'src/Svc/Svc.csproj': csproj('Microsoft.NET.Sdk.Worker', '<OutputType>Exe</OutputType>', '<PackageReference Include="Microsoft.Extensions.Hosting.WindowsServices" Version="9.0.0" />'), 'src/Svc/Program.cs': PROGRAM },
    wpf: { 'src/Desk/Desk.csproj': csproj('Microsoft.NET.Sdk', '<OutputType>WinExe</OutputType><UseWPF>true</UseWPF>'), 'src/Desk/App.xaml': '<Application x:Class="Desk.App" />\n' },
    winforms: { 'src/Forms/Forms.csproj': csproj('Microsoft.NET.Sdk', '<OutputType>WinExe</OutputType><UseWindowsForms>true</UseWindowsForms>'), 'src/Forms/Program.cs': PROGRAM },
    data: { 'src/Data/Data.csproj': '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.0" />\n  </ItemGroup>\n</Project>\n', 'src/Data/Migrations/AppDbContextModelSnapshot.cs': '// EF Core model snapshot\n', 'db/schema.sql': 'CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n' },
    devops: { Dockerfile: 'FROM node:22-alpine\n', '.github/workflows/ci.yml': 'name: ci\non: push\njobs: {}\n' },
};

// The raw selection setup's walk would accept with every row kept: the always seed plus the profile's own.
function selectionFor(recs, profile)
{
    const out = {};
    const seeds = [recs.always || {}, profile === 'bare' ? {} : ((recs.stacks || {})[profile] || {})];
    for (const seed of seeds)
        for (const [layer, names] of Object.entries(seed))
            if (Array.isArray(names)) out[layer] = [...new Set([...(out[layer] || []), ...names])];
    return out;
}

function writeFiles(root, files)
{
    for (const [rel, body] of Object.entries(files))
    {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body);
    }
}

// One step's command: spawned with the fixture's env, its output kept in the step's log for the report.
function step(name, cmd, args, { cwd, env, log })
{
    // Node itself is started as itself; anything else through the one spawn route (M6), where a Windows `claude.cmd` is
    // resolved and escaped, never handed to a shell. That route resolves a bare name on PATH, so an absolute node.exe
    // would come back 'not found' (the gate's Windows leg, 2026-10-16).
    const opts = { cwd, env, encoding: 'utf8', timeout: 15 * 60 * 1000 };
    const r = cmd === process.execPath ? spawnSync(process.execPath, args, opts) : spawnCommand(cmd, args, opts);
    fs.appendFileSync(log, `$ ${[cmd, ...args].join(' ')}\n${r.stdout || ''}${r.stderr || ''}\n[exit ${r.status}]\n\n`);
    if (r.status !== 0) throw new Error(`profile-fixture: ${name} failed (exit ${r.status}${r.error ? `, ${r.error.code || r.error.message}` : ''}) - see ${log}`);
}

function fixture(profile, workdir, { exportDir = '', scope = '', dryRun = false, out = (l) => process.stdout.write(`${l}\n`) } = {})
{
    const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
    if (!MARKERS[profile]) throw new Error(`profile-fixture: unknown profile '${profile}' - one of ${Object.keys(MARKERS).join(', ')}`);
    if (profile !== 'bare' && !(recs.stacks || {})[profile]) throw new Error(`profile-fixture: '${profile}' has markers but no stacks seed in recommendations.json`);
    workdir = path.resolve(workdir);
    const base = path.join(workdir, profile);
    const project = path.join(base, 'project');
    const account = path.join(base, 'account');
    const home = path.join(workdir, 'home');
    if (scope && !['project', 'user', 'local'].includes(scope)) throw new Error(`profile-fixture: --scope must be project, user or local, not '${scope}'`);
    if (fs.existsSync(project)) throw new Error(`profile-fixture: ${project} exists - a fixture is installed fresh; remove it first`);
    for (const d of [project, account, home]) fs.mkdirSync(d, { recursive: true });
    const log = path.join(base, 'install.log');
    fs.writeFileSync(log, '');

    let source = exportDir ? path.resolve(exportDir) : path.join(workdir, 'export');
    const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: account };
    for (const k of Object.keys(env)) if (/^ALFRED_CODE_/.test(k) || ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'].includes(k)) delete env[k];
    if (!fs.existsSync(path.join(source, 'scripts', 'install', 'alfred-code.js')))
    {
        if (exportDir) throw new Error(`profile-fixture: --export ${exportDir} holds no scripts/install/alfred-code.js`);
        step('clean-export', process.execPath, [path.join(ROOT, 'scripts', 'clean-export.js'), ROOT, source], { cwd: ROOT, env: process.env, log });
    }

    writeFiles(project, MARKERS[profile]);
    step('git init', 'git', ['init', '-q'], { cwd: project, env, log });
    const raw = path.join(base, 'raw.json');
    const selection = path.join(base, 'selection.txt');
    fs.writeFileSync(raw, JSON.stringify(selectionFor(recs, profile), null, 2));
    step('stack-select', process.execPath, [path.join(source, 'scripts', 'stack-select.js'), '--selection', raw, '--emit', selection], { cwd: project, env, log });

    // The export registered as the stack's marketplace BEFORE the installer runs, so the core it installs is this
    // tree's - the installer keeps a registration it finds under its key (plugins.js stackMarket).
    const commands = [
        ['claude', ['plugin', 'marketplace', 'add', source]],
        [process.execPath, [path.join(source, 'scripts', 'install', 'alfred-code.js'), 'install', '--source', source, '--selection', selection, ...(scope ? ['--scope', scope] : [])]],
    ];
    if (dryRun)
    {
        for (const [cmd, args] of commands) out(`would run: HOME=${home} CLAUDE_CONFIG_DIR=${account} ${[cmd, ...args].join(' ')}  (in ${project})`);
    }
    else
    {
        step('marketplace add', commands[0][0], commands[0][1], { cwd: project, env, log });
        step('install', commands[1][0], commands[1][1], { cwd: project, env, log });
    }
    out(`fixture: ${profile} project=${project} config-dir=${account} home=${home}`);
    out(`map it: HOME=${home} node scripts/session-surface.js ${project} --config-dir ${account} --run-hooks --listing-fraction <from the skills docs> --json`);
    return { profile, project, account, home, source, log, selection };
}

// What fixture() writes, and nothing else: a profile folder holding its install.log, the export (it carries the
// installer) and the shared home - the home only in a workdir that also holds a fixture or an export, so a folder that
// merely has a `home` in it is never taken for one. A file of anyone else's is left, and named.
const FIXTURE_PARTS = ['project', 'account', 'install.log', 'raw.json', 'selection.txt'];
// A link (an --export handed in as one, a Windows junction) goes as the link - never a walk into what it points at.
function removeEntry(p)
{
    if (!fs.lstatSync(p).isSymbolicLink()) { fs.rmSync(p, { recursive: true, force: true }); return; }
    try { fs.unlinkSync(p); }
    catch { fs.rmdirSync(p); }
}
function clean(workdir, { out = (l) => process.stdout.write(`${l}\n`) } = {})
{
    workdir = path.resolve(workdir);
    if (!fs.existsSync(workdir)) { out('removed: none'); out('left: none'); return { removed: [], left: [] }; }
    if (workdir === path.parse(workdir).root || workdir === path.resolve(os.homedir()) || fs.existsSync(path.join(workdir, '.git')))
        throw new Error(`profile-fixture: --clean refuses ${workdir} - a filesystem root, the home dir or a git checkout is no fixture workdir`);
    const entries = fs.readdirSync(workdir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink());
    const isFixture = (name) => Boolean(MARKERS[name]) && fs.existsSync(path.join(workdir, name, 'install.log'));
    const isExport = (name) => name === 'export' && fs.existsSync(path.join(workdir, name, 'scripts', 'install', 'alfred-code.js'));
    const ours = entries.some((e) => isFixture(e.name) || isExport(e.name));
    const removed = [];
    for (const e of entries)
    {
        const p = path.join(workdir, e.name);
        if (isFixture(e.name))
        {
            for (const part of FIXTURE_PARTS) fs.rmSync(path.join(p, part), { recursive: true, force: true });
            if (!fs.readdirSync(p).length) fs.rmdirSync(p);
            removed.push(e.name);
        }
        else if (isExport(e.name) || (ours && e.name === 'home'))
        {
            removeEntry(p);
            removed.push(e.name);
        }
    }
    const left = fs.readdirSync(workdir);
    if (!left.length) fs.rmdirSync(workdir);
    out(`removed: ${removed.join(', ') || 'none'}`);
    out(`left: ${left.join(', ') || 'none'}`);
    return { removed, left };
}

function main(argv)
{
    const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    if (argv[0] === '--clean')
    {
        if (argv.length !== 2) { console.error('usage: profile-fixture.js --clean <workdir>'); return 2; }
        try { clean(argv[1]); return 0; }
        catch (e) { console.error(e.message); return 1; }
    }
    const positional = argv.filter((a, i) => !a.startsWith('--') && !['--export', '--scope'].includes(argv[i - 1]));
    if (positional.length !== 2)
    {
        console.error(`usage: profile-fixture.js <profile> <workdir> [--export <dir>] [--scope project|user|local] [--dry-run] | --clean <workdir>\n  profiles: ${Object.keys(MARKERS).join(', ')}`);
        return 2;
    }
    try
    {
        fixture(positional[0], positional[1], { exportDir: arg('--export'), scope: arg('--scope'), dryRun: argv.includes('--dry-run') });
        return 0;
    }
    catch (e)
    {
        console.error(e.message);
        return 1;
    }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { MARKERS, selectionFor, fixture, clean, main };
