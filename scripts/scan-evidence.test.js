'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'scan-evidence.js');
const CATALOG = path.join(__dirname, '..', 'meta', 'evidence.json');

// One fixture tree exercising every signal kind, the skip-list, and the depth cap.
function buildFixture()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-'));
    const put = (rel, text) =>
    {
        const p = path.join(root, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    };
    put('src/Api/Api.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <PackageReference Include="MassTransit" Version="8.0.0" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.5.0" />
  </ItemGroup>
</Project>`);
    put('Directory.Packages.props', `<Project>
  <ItemGroup>
    <PackageVersion Include="Npgsql" Version="8.0.0" />
    <PackageVersion Include="Aspire.Hosting" Version="9.0.0" />
  </ItemGroup>
</Project>`);
    // CPM: the version-less PackageReference is the usage signal the central pin corroborates
    put('src/Worker/Worker.csproj', `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Npgsql" />
  </ItemGroup>
</Project>`);
    put('src/Gen/Gen.csproj', `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><IsRoslynComponent>true</IsRoslynComponent></PropertyGroup>
</Project>`);
    put('web/package.json', JSON.stringify({ dependencies: { '@angular/material': '^17.0.0', '@angular/core': '^16.2.0' }, devDependencies: { '@playwright/test': '^1.40.0' } }));
    put('nx.json', '{}');
    // content signal: a regex over a catalog-named code file (not a manifest)
    put('src/Api/Program.cs', 'app.MapGet("/health", () => "ok");\n');
    // brownfield view controller - no [ApiController], the base class is the signal
    put('src/Web/HomeController.cs', 'public class HomeController : Controller\n{\n}\n');
    // clean-architecture layer naming - a file-existence signal
    put('src/Shop.Domain/Shop.Domain.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>');
    // skip-list: a signal that exists ONLY under node_modules must not be found
    put('node_modules/somepkg/somepkg.csproj', '<PackageReference Include="BenchmarkDotNet" Version="0.13.0" />');
    // depth cap: a manifest buried deeper than the cap must not be found
    put('a/b/c/d/e/f/g/Deep.csproj', '<PackageReference Include="Grpc.AspNetCore" Version="2.60.0" />');
    return root;
}

function scan(root)
{
    const out = execFileSync('node', [SCRIPT, '--root', root, '--catalog', CATALOG], { encoding: 'utf8' });
    return JSON.parse(out).found;
}

test('scanner finds package, central-package, csproj-property, npm, and file signals with attribution', () => {
    const root = buildFixture();
    try
    {
        const found = scan(root);
        assert.match(found.skills['dotnet-messaging'], /MassTransit in src\/Api\/Api\.csproj/);
        assert.match(found.skills['dotnet-openapi'], /Swashbuckle\.AspNetCore in src\/Api\/Api\.csproj/);
        assert.match(found.skills['dotnet-data-access'], /Npgsql in src\/Worker\/Worker\.csproj/, 'a CPM version-less PackageReference is the usage signal');
        assert.match(found.skills['dotnet-source-generators'], /IsRoslynComponent/, 'csproj property signal');
        assert.match(found.skills['angular-material'], /@angular\/material in web\/package\.json/, 'npm dependency');
        assert.match(found.mcps['browser'], /@playwright\/test in web\/package\.json/, 'scoped npm prefix');
        assert.match(found.skills['nx'], /nx\.json/, 'file-existence signal');
        assert.match(found.skills['dotnet-minimal-api'], /minimal-API Map\* wiring in Program\.cs in src\/Api\/Program\.cs/, 'content signal over a named code file, labeled');
        assert.match(found.skills['dotnet-mvc-controllers'], /ApiController\/Controller classes in src\/Web\/HomeController\.cs/, 'a base-class-only view controller fires the signal');
        assert.match(found.skills['dotnet-architecture'], /Shop\.Domain\.csproj present/, 'clean-architecture layer naming is a file signal');
        assert.strictEqual(found.skills['dotnet-realtime'], undefined, 'the SignalR server regex does not fire on plain Map* endpoints');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scanner honors the skip-list, the depth cap, and reports nothing for absent signals', () => {
    const root = buildFixture();
    try
    {
        const found = scan(root);
        assert.strictEqual(found.skills['dotnet-performance'], undefined, 'a node_modules-only signal is not found');
        assert.strictEqual(found.skills['dotnet-grpc'], undefined, 'a beyond-depth-cap manifest is not read');
        assert.strictEqual(found.skills['dotnet-realtime'], undefined, 'no signal, no entry - absence is empty, not false');
        // under central package management a PackageVersion pin can exist for a package no
        // project references - a pin alone must never count as usage (the false-adds measured in a consuming project)
        assert.strictEqual(found.skills['dotnet-aspire'], undefined, 'a CPM PackageVersion pin with no PackageReference is not evidence');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The shipped catalog holds no conflict row since 2.0.0 cut the one it had (angular-cli), so the
// mechanism is proven on a fixture catalog of the same shape.
test('scanner with --judgment computes version conflicts from found package majors', () => {
    const root = buildFixture();
    const JUDGMENT = path.join(root, 'judgment.json');
    fs.writeFileSync(JUDGMENT, JSON.stringify({ versionConflicts: [
        { item: 'skill:angular-material', package: '@angular/core', below: '17', conflict: 'newer idioms', survives: 'component docs' },
        { item: 'skill:typescript', package: 'typescript', below: '5', conflict: 'unfound package', survives: 'n/a' },
    ] }));
    try
    {
        const out = execFileSync('node', [SCRIPT, '--root', root, '--catalog', CATALOG, '--judgment', JUDGMENT], { encoding: 'utf8' });
        const conflicts = JSON.parse(out).judgment.versionConflicts;
        assert.deepStrictEqual(conflicts.map(c => c.item), ['skill:angular-material'], 'no version found = no claim');
        const row = conflicts[0];
        assert.ok(row, '@angular/core ^16 is below the catalog threshold 17');
        assert.strictEqual(row.package, '@angular/core');
        assert.strictEqual(row.version, '^16.2.0');
        assert.strictEqual(row.below, '17');
        assert.match(row.rel, /web\/package\.json/);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('scanner on an empty project yields an empty found map', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-empty-'));
    try
    {
        const found = scan(root);
        assert.deepStrictEqual(found, { skills: {}, mcps: {}, plugins: {} });
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// R27: the four optional plugins are picks the scan SUGGESTS, each on its own evidence, off the shipped
// catalog. `git` makes the tree a repo so the tracked-file signal has something to ask.
function pluginTree(files, { track = [] } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-plugins-'));
    for (const [rel, text] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    execFileSync('git', ['init', '-q', root]);
    if (track.length) execFileSync('git', ['-C', root, 'add', '--', ...track]);
    return root;
}

test('the plugins layer suggests each optional plugin on its own evidence, naming the manifest matched', () => {
    const cases = [
        ['csharp-lsp', { 'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>' }, /src\/Api\/Api\.csproj present/],
        ['csharp-lsp', { 'Shop.sln': 'Microsoft Visual Studio Solution File\n' }, /Shop\.sln present/],
        ['typescript-lsp', { 'web/tsconfig.json': '{}' }, /web\/tsconfig\.json present/],
        ['typescript-lsp', { 'web/package.json': JSON.stringify({ devDependencies: { typescript: '^5.4.0' } }) }, /typescript in web\/package\.json/],
        ['security-guidance', { 'src/Api/Api.csproj': '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="8.0.0" /></ItemGroup></Project>' },
            /Microsoft\.AspNetCore\.Authentication\.JwtBearer in src\/Api\/Api\.csproj/],
        ['security-guidance', { 'api/package.json': JSON.stringify({ dependencies: { jsonwebtoken: '^9.0.0' } }) }, /jsonwebtoken in api\/package\.json/],
        ['security-guidance', { 'shop/package.json': JSON.stringify({ dependencies: { stripe: '^14.0.0' } }) }, /stripe in shop\/package\.json/],
        ['security-guidance', { 'Pay/Pay.csproj': '<Project><ItemGroup><PackageReference Include="Stripe.net" Version="43.0.0" /></ItemGroup></Project>' }, /Stripe\.net in Pay\/Pay\.csproj/],
        ['security-guidance', { 'web/package.json': JSON.stringify({ dependencies: { 'angular-auth-oidc-client': '^19.0.0' } }) }, /angular-auth-oidc-client in web\/package\.json/],
        ['security-guidance', { 'api/package.json': JSON.stringify({ dependencies: { '@nestjs/jwt': '^11.0.0' } }) }, /@nestjs\/jwt in api\/package\.json/],
        ['security-guidance', { 'api/package.json': JSON.stringify({ dependencies: { '@nestjs/passport': '^11.0.0' } }) }, /@nestjs\/passport in api\/package\.json/],
        ['security-guidance', { 'Old/Old.csproj': '<Project><ItemGroup><PackageReference Include="Microsoft.AspNetCore.Authentication" Version="2.3.0" /></ItemGroup></Project>' },
            /Microsoft\.AspNetCore\.Authentication in Old\/Old\.csproj/],
        ['security-guidance', { 'Idp/Idp.csproj': '<Project><ItemGroup><PackageReference Include="Duende.IdentityServer.EntityFramework" Version="7.0.0" /></ItemGroup></Project>' },
            /Duende\.IdentityServer\.EntityFramework in Idp\/Idp\.csproj/],
    ];
    for (const [plugin, files, want] of cases)
    {
        const root = pluginTree(files);
        try
        {
            const found = scan(root).plugins;
            assert.match(found[plugin] || '', want, `${plugin} on ${Object.keys(files)[0]}: ${JSON.stringify(found)}`);
        }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
});

test('claude-md-management is suggested on a TRACKED CLAUDE.md only - never an untracked one or the stack\'s own seed', () => {
    const tracked = pluginTree({ 'CLAUDE.md': '# x\n' }, { track: ['CLAUDE.md'] });
    const untracked = pluginTree({ 'CLAUDE.md': '# x\n' });
    const seeded = pluginTree({ '.claude/CLAUDE.md': '# x\n' }, { track: ['.claude/CLAUDE.md'] });
    const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-nogit-'));
    fs.writeFileSync(path.join(noGit, 'CLAUDE.md'), '# x\n');
    try
    {
        assert.match(scan(tracked).plugins['claude-md-management'] || '', /CLAUDE\.md tracked/);
        assert.strictEqual(scan(untracked).plugins['claude-md-management'], undefined, 'an untracked copy is one person\'s note');
        assert.strictEqual(scan(seeded).plugins['claude-md-management'], undefined, 'the installer seeds .claude/CLAUDE.md into every project');
        assert.strictEqual(scan(noGit).plugins['claude-md-management'], undefined, 'no git, nothing is tracked');
    }
    finally { for (const d of [tracked, untracked, seeded, noGit]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a project with none of the signals gets no optional plugin suggested', () => {
    const root = pluginTree({ 'README.md': '# x\n', 'web/package.json': JSON.stringify({ dependencies: { lodash: '^4.0.0' } }) });
    try { assert.deepStrictEqual(scan(root).plugins, {}); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The lint checks catalog names and labels, not regex syntax - a regex that does not compile must
// skip its one signal with a named warning instead of killing the whole scan.
test('a catalog regex that does not compile is skipped with a named warning, the scan still completes', () => {
    const { spawnSync } = require('node:child_process');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-badre-'));
    const catalogFile = path.join(root, 'catalog.json');
    try
    {
        fs.writeFileSync(path.join(root, 'nx.json'), '{}');
        fs.writeFileSync(catalogFile, JSON.stringify({ skills: { csharp: { content: [{ glob: 'Program.cs', regex: '(', label: 'broken' }] }, nx: { files: ['nx.json'] } } }));
        const r = spawnSync('node', [SCRIPT, '--root', root, '--catalog', catalogFile], { encoding: 'utf8' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stderr, /invalid regex/, 'the bad signal is named');
        assert.match(JSON.parse(r.stdout).found.skills.nx, /nx\.json/, 'the other signals still match');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every reported path uses forward slashes, on every platform', () =>
{
    // `path.relative` returns the NATIVE separator, so the same project reported
    // `MassTransit in src\Api\Api.csproj` on Windows and `src/Api/Api.csproj` everywhere else.
    // That string is the evidence reason the guided walk shows the user and attributes a selection
    // by, so it must not change shape with the machine. Caught by running the suite on
    // windows-latest for the first time.
    const root = buildFixture();
    const hits = JSON.stringify(scan(root));
    assert.ok(/src\/Api\/Api\.csproj/.test(hits), 'the reported path is posix-style');
    assert.ok(!/[A-Za-z0-9]\\\\[A-Za-z0-9]/.test(hits), 'no native separator survives into a reported path');
});

// --orientation (plan 4.12): the first-look scan. The same manifests the evidence scan reads, printed as a provisional
// ORIENTATION.md - stack, modules, build / test / run commands, entry points - so a project with no architecture
// capture still starts its sessions with a map. Every row is read from a manifest; nothing is inferred.
const { spawnSync } = require('node:child_process');
const MARKER = 'provisional - replaced by the architecture capture';
function tree(files)
{
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-orient-')));
    for (const [rel, text] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}
const orient = (root, ...extra) => spawnSync('node', [SCRIPT, '--orientation', '--root', root, ...extra], { encoding: 'utf8' });
const csproj = (sdk, props = '', refs = '') => `<Project Sdk="${sdk}">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>${props}\n  </PropertyGroup>\n  <ItemGroup>${refs}</ItemGroup>\n</Project>\n`;
const DOTNET = {
    'Shop.sln': 'Microsoft Visual Studio Solution File, Format Version 12.00\n',
    'src/Api/Api.csproj': csproj('Microsoft.NET.Sdk.Web'),
    'src/Api/Program.cs': 'var app = WebApplication.Create(args);\n',
    'src/Domain/Domain.csproj': csproj('Microsoft.NET.Sdk'),
    'src/Desk/Desk.csproj': csproj('Microsoft.NET.Sdk', '\n    <OutputType>WinExe</OutputType>\n    <UseWPF>true</UseWPF>'),
    'src/Desk/App.xaml': '<Application />\n',
    'tests/Api.Tests/Api.Tests.csproj': csproj('Microsoft.NET.Sdk', '', '\n    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.10.0" />'),
};

test('--orientation on a .NET solution: stack, modules, commands and entry points, read from the manifests', () =>
{
    const root = tree(DOTNET);
    try
    {
        const r = orient(root);
        assert.strictEqual(r.status, 0, r.stderr);
        const md = r.stdout;
        assert.match(md, /^Captured: no git, \d{4}-\d{2}-\d{2}\n/, 'the capture stamp opens the doc, honest about a tree with no git');
        assert.ok(md.includes(`# Orientation (${MARKER})`), 'the marker the docs engine keys on');
        assert.match(md, /\| Stack \| [^\n]*\.NET 8[^\n]*ASP\.NET Core[^\n]*WPF/);
        for (const m of ['`src/Api` (web)', '`src/Domain` (library)', '`src/Desk` (wpf)', '`tests/Api.Tests` (test)']) assert.ok(md.includes(m), `${m} in\n${md}`);
        assert.match(md, /\| Build \| `dotnet build Shop\.sln` \|/);
        assert.match(md, /\| Test \| `dotnet test Shop\.sln` \|/);
        assert.match(md, /\| Run \| `dotnet run --project src\/Api\/Api\.csproj`; `dotnet run --project src\/Desk\/Desk\.csproj` \|/);
        assert.match(md, /\| Entry points \| `src\/Api\/Program\.cs`; `src\/Desk\/App\.xaml` \|/);
        assert.doesNotMatch(md, /Api\.Tests\.csproj`/, 'a test project is never a run target');
        assert.ok(Buffer.byteLength(md) <= 4096, 'inside the orientation cap');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--orientation on node packages: the package manager, declared scripts and entries; the npm placeholder test is no test', () =>
{
    const root = tree({
        'web/package.json': JSON.stringify({ scripts: { build: 'ng build', test: 'ng test', start: 'ng serve' }, dependencies: { '@angular/core': '^17.1.0' }, devDependencies: { typescript: '~5.4.0' } }),
        'web/pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
        'web/angular.json': JSON.stringify({ projects: { shop: { architect: { build: { options: { browser: 'src/main.ts' } } } } } }),
        'web/src/main.ts': 'bootstrapApplication(App);\n',
        'tools/cli/package.json': JSON.stringify({ bin: { shopctl: 'bin/cli.js' }, scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
        'tools/cli/bin/cli.js': '#!/usr/bin/env node\n',
    });
    try
    {
        const r = orient(root);
        assert.strictEqual(r.status, 0, r.stderr);
        const md = r.stdout;
        assert.match(md, /\| Stack \| [^\n]*`web\/` Angular 17 \+ TypeScript[^\n]*`tools\/cli\/` JavaScript/);
        assert.match(md, /\| Build \| `pnpm run build` in `web\/` \|/);
        assert.match(md, /\| Test \| `pnpm run test` in `web\/` \|/, 'the placeholder test script of tools/cli is left out');
        assert.match(md, /\| Run \| `pnpm run start` in `web\/` \|/);
        assert.match(md, /\| Entry points \| `web\/src\/main\.ts`; `tools\/cli\/bin\/cli\.js` \|/);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--orientation stamps the branch and commit, and a large tree stays under the 4096-byte cap', () =>
{
    const files = { ...DOTNET };
    for (let i = 0; i < 40; i++) files[`src/Module${i}/Module${i}.csproj`] = csproj('Microsoft.NET.Sdk');
    const root = tree(files);
    try
    {
        const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
        git('init', '-q', '-b', 'develop');
        git('-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed');
        const r = orient(root);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, new RegExp(`^Captured: develop@${git('rev-parse', '--short', 'HEAD')}\\+dirty, \\d{4}-\\d{2}-\\d{2}\\n`), 'untracked manifests make the tree dirty');
        assert.match(r.stdout, /\(\+\d+ more\)/, 'the module list is capped, the rest counted');
        assert.ok(Buffer.byteLength(r.stdout) <= 4096, `${Buffer.byteLength(r.stdout)} bytes`);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Found on a temp project: a fresh `git init` has a branch but no commit, and `rev-parse --abbrev-ref HEAD` fails there.
test('--orientation on a repo with no commit yet names its branch, not a detached HEAD', () =>
{
    const root = tree(DOTNET);
    try
    {
        execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root });
        const r = orient(root);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^Captured: develop@no-commits\+dirty, \d{4}-\d{2}-\d{2}\n/);
        execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'seed'], { cwd: root });
        const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        execFileSync('git', ['checkout', '-q', '--detach'], { cwd: root });
        assert.match(orient(root).stdout, new RegExp(`^Captured: detached@${sha}\\+dirty, `), 'a real detached HEAD still says so');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--orientation with no manifest it knows prints nothing and exits 1', () =>
{
    const root = tree({ 'README.md': '# A project\n' });
    try
    {
        const r = orient(root);
        assert.strictEqual(r.status, 1);
        assert.strictEqual(r.stdout, '');
        assert.match(r.stderr, /no manifest recognized/);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--orientation --out writes the file, refreshes a provisional one, and never replaces a capture', () =>
{
    const root = tree(DOTNET);
    const out = path.join(root, '.claude/docs/architecture/ORIENTATION.md');
    try
    {
        assert.strictEqual(orient(root, '--out', out).status, 0, 'the folders are created');
        assert.ok(fs.readFileSync(out, 'utf8').includes(MARKER));
        fs.appendFileSync(out, 'stale line\n');
        assert.strictEqual(orient(root, '--out', out).status, 0, 'a provisional file is refreshed');
        assert.ok(!fs.readFileSync(out, 'utf8').includes('stale line'));
        fs.writeFileSync(out, 'Captured: develop@abc1234, 2026-09-01\n\nThe real map.\n');
        const refused = orient(root, '--out', out);
        assert.strictEqual(refused.status, 1);
        assert.match(refused.stderr, /not provisional - the architecture capture wrote it/);
        assert.strictEqual(fs.readFileSync(out, 'utf8'), 'Captured: develop@abc1234, 2026-09-01\n\nThe real map.\n');
        fs.rmSync(out);
        fs.writeFileSync(path.join(path.dirname(out), 'ARCHITECTURE.md'), '# Architecture\n');
        const beside = orient(root, '--out', out);
        assert.strictEqual(beside.status, 1);
        assert.match(beside.stderr, /ARCHITECTURE\.md/);
        assert.ok(!fs.existsSync(out), 'nothing written beside a capture');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
