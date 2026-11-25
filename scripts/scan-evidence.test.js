'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { putWorkspace } = require('./workspace-fixture.js');

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
    put('web/package.json', JSON.stringify({ dependencies: { '@angular/material': '^17.0.0', '@angular/core': '^16.2.0' }, devDependencies: { '@capacitor/core': '^6.0.0' } }));
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
        assert.deepStrictEqual(found.mcps, {}, 'no MCP signal - the stack seeds no server (2026-10-24)');
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

// R27: the optional plugins - the LSP pair since 2.0.0 retired the other two - are picks the scan
// SUGGESTS, each on its own evidence, off the shipped catalog.
function pluginTree(files)
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-plugins-'));
    for (const [rel, text] of Object.entries(files))
    {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}

test('the plugins layer suggests each optional plugin on its own evidence, naming the manifest matched', () => {
    const cases = [
        ['csharp-lsp', { 'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>' }, /src\/Api\/Api\.csproj present/],
        ['csharp-lsp', { 'Shop.sln': 'Microsoft Visual Studio Solution File\n' }, /Shop\.sln present/],
        ['typescript-lsp', { 'web/tsconfig.json': '{}' }, /web\/tsconfig\.json present/],
        ['typescript-lsp', { 'web/package.json': JSON.stringify({ devDependencies: { typescript: '^5.4.0' } }) }, /typescript in web\/package\.json/],
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

// The capture-awareness merge (spec 2026-10-29 2.2): the block's home is awareness/, and a map at EITHER home - the old
// architecture/ one an update has not moved yet included - means the capture ran, so nothing is written.
test('--orientation refuses when either home\'s map exists', () =>
{
    const root = tree(DOTNET);
    const docs = path.join(root, '.claude/docs');
    const out = path.join(docs, 'awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md');
    try
    {
        assert.match(orient('').stderr, /\[--out <docs>\/awareness\/ARCHITECTURE-ORIENTATION-AWARENESS\.md\]/);
        for (const map of ['architecture/ARCHITECTURE.md', 'awareness/ARCHITECTURE-AWARENESS.md'])
        {
            fs.mkdirSync(path.dirname(path.join(docs, map)), { recursive: true });
            fs.writeFileSync(path.join(docs, map), '# Architecture\n');
            for (const o of [out, path.join(docs, 'architecture/ORIENTATION.md')])
            {
                const refused = orient(root, '--out', o);
                assert.strictEqual(refused.status, 1, `${map} with --out ${path.relative(docs, o)}`);
                assert.match(refused.stderr, /the architecture capture already ran here; nothing written/);
                assert.ok(!fs.existsSync(o), 'nothing written beside a capture');
            }
            fs.rmSync(path.join(docs, map));
        }
        assert.strictEqual(orient(root, '--out', out).status, 0, 'no map at either home: the block is written');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Audit 2026-10-10 (session f10cb06a): inside git the scan walked ignored tool caches - mutation-test sandboxes, a CLI
// build cache, a browser profile - into the map as packages and an MV2 extension, and read no Nx target, so an Nx
// workspace whose CI ran 14 steps printed 'none declared' for build, test, run and entry points.
const NX = {
    '.gitignore': '.stryker-tmp/\n.angular/\n',
    'package.json': JSON.stringify({ devDependencies: { nx: '^21.0.0', '@angular/core': '^20.0.0', typescript: '~5.8.0' } }),
    'package-lock.json': '{}\n',
    'nx.json': JSON.stringify({ targetDefaults: { build: { cache: true } } }),
    'apps/shop/project.json': JSON.stringify({ name: 'shop', projectType: 'application', targets: {
        build: { executor: '@angular/build:application', options: { browser: 'apps/shop/src/main.ts' } }, serve: { executor: '@angular/build:dev-server' }, test: { executor: '@nx/jest:jest' } } }),
    'apps/shop/src/main.ts': 'bootstrapApplication(App);\n',
    'libs/ui/project.json': JSON.stringify({ name: 'ui', projectType: 'library', targets: { test: { executor: '@nx/jest:jest' }, lint: { executor: '@nx/eslint:lint' } } }),
    '.stryker-tmp/sandbox-a1/package.json': JSON.stringify({ scripts: { build: 'ng build' }, dependencies: { '@angular/core': '^20.0.0' } }),
    '.stryker-tmp/sandbox-a1/.playwright/chrome/Models/1.0/manifest.json': JSON.stringify({ manifest_version: 2, name: 'x' }),
    '.angular/cache/20/shop/vite/deps/package.json': JSON.stringify({ type: 'module' }),
};

test('--orientation inside git reads only what git keeps (tracked plus untracked it does not ignore)', () =>
{
    const root = tree(NX);
    try
    {
        execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root });
        const md = orient(root).stdout;
        assert.doesNotMatch(md, /stryker-tmp|\.angular\/cache|browser extension/, `an ignored cache is no module:\n${md}`);
        assert.match(md, /\| Modules \| [^\n]*`\.` \(package\)/, 'the untracked, unignored root package stays');
        const found = scan(root);
        assert.ok(Object.values(found).every((layer) => Object.values(layer).every((hit) => !/stryker-tmp|\.angular/.test(hit))), JSON.stringify(found));
        fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
        assert.match(orient(root).stdout, /stryker-tmp/, 'outside git the walk is the folder walk it was');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--orientation on an Nx workspace: each project.json\'s declared targets and build entry, run through the package manager', () =>
{
    const root = tree(Object.fromEntries(Object.entries(NX).filter(([rel]) => !/^\.(stryker-tmp|angular)\//.test(rel))));
    try
    {
        const md = orient(root).stdout;
        assert.match(md, /\| Stack \| [^\n]*Nx workspace \(2 projects\)/);
        for (const m of ['`apps/shop` (nx application)', '`libs/ui` (nx library)']) assert.ok(md.includes(m), `${m} in\n${md}`);
        assert.match(md, /\| Build \| `npx nx build shop` \|/);
        assert.match(md, /\| Test \| `npx nx run-many -t test`; `npx nx test shop`; `npx nx test ui` \|/);
        assert.match(md, /\| Run \| `npx nx serve shop` \|/);
        assert.match(md, /\| Entry points \| `apps\/shop\/src\/main\.ts` \|/);
        fs.rmSync(path.join(root, 'nx.json'));
        assert.doesNotMatch(orient(root).stdout, /nx build|nx application/, 'a project.json with no nx.json is no Nx workspace - never guessed');
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// 2026-11-10 (the user's report on 3.9.2): the shell's cwd had drifted to a folder above the project, so `--root .`
// read another project's manifests (sqlite, csharp-lsp from a child folder) with no word of it. The scan names the root
// it read and warns on a nested repo or a root below a repo's top; the found map is unchanged.
{
    const { spawnSync: run } = require('node:child_process');
    const git = (cwd, ...a) => run('git', ['-C', cwd, ...a], { encoding: 'utf8' });
    const scanOut = (root) =>
    {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-out-')), 'found.json');
        const r = run('node', [SCRIPT, '--root', root, '--catalog', CATALOG, '--out', out], { encoding: 'utf8' });
        return { r, lines: r.stdout.split('\n').filter(Boolean), found: JSON.parse(fs.readFileSync(out, 'utf8')).found };
    };
    const nestedRoot = () =>
    {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-nest-'));
        fs.mkdirSync(path.join(root, 'child', '.git'), { recursive: true });
        fs.writeFileSync(path.join(root, 'child', 'app.csproj'), '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.0.0" />\n  </ItemGroup>\n</Project>\n');
        return root;
    };

    test('scan names its root and warns on signals from a nested repo; the found map is unchanged', () =>
    {
        const root = nestedRoot();
        const { r, lines, found } = scanOut(root);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(lines[0], `root: ${fs.realpathSync.native(root)}`);
        assert.ok(lines.includes('!! scan-evidence: signals from nested repos child - each is its own project; check --root'), r.stdout);
        // captured from the scan before this change
        assert.deepStrictEqual(found, { skills: { 'dotnet-data-access': 'Microsoft.EntityFrameworkCore.Sqlite in child/app.csproj', sqlite: 'Microsoft.EntityFrameworkCore.Sqlite in child/app.csproj' }, mcps: {}, plugins: { 'csharp-lsp': 'child/app.csproj present' } });
    });

    test('a workspace root reads its child projects with no nested-repo warning', () =>
    {
        const root = nestedRoot();
        putWorkspace(root, { role: 'root' });
        const { lines } = scanOut(root);
        assert.deepStrictEqual(lines.filter((l) => l.startsWith('!!')), []);
    });

    // Final review (2026-11-10, Important 2): init writes the role at its install step, after this scan, so a first-time Root
    // answer reaches the scan as --role root - the role file is not there yet.
    test('a Root answer passed as --role root before the role is written: no nested-repo warning', () =>
    {
        const scanWith = (root, extra) =>
        {
            const r = run('node', [SCRIPT, '--root', root, '--catalog', CATALOG, ...extra], { encoding: 'utf8' });
            return r.stderr.split('\n').filter((l) => l.startsWith('!!'));
        };
        const root = nestedRoot();
        assert.deepStrictEqual(scanWith(root, ['--role', 'root']), []);
        assert.match(scanWith(root, ['--role', 'standalone']).join('\n'), /signals from nested repos child/, 'a Standalone answer still warns');
        assert.match(scanWith(root, []).join('\n'), /signals from nested repos child/, 'no answer: as before');
    });

    test('a root below a repo top is named; the repo top itself is not, whatever path spells it', () =>
    {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-repo-'));
        git(repo, 'init', '-q');
        fs.mkdirSync(path.join(repo, 'sub'));
        fs.writeFileSync(path.join(repo, 'sub', 'package.json'), '{}');
        const below = scanOut(path.join(repo, 'sub'));
        const top = git(repo, 'rev-parse', '--show-toplevel').stdout.trim();
        assert.ok(below.lines.includes(`!! scan-evidence: ${fs.realpathSync.native(path.join(repo, 'sub'))} is below the repo ${top} - is --root the project?`), below.r.stdout);
        // os.tmpdir() is a symlinked path on macOS (/var -> /private/var): the top spelled either way warns nothing
        for (const spelled of [repo, fs.realpathSync.native(repo)])
            assert.deepStrictEqual(scanOut(spelled).lines.filter((l) => l.startsWith('!!')), [], spelled);
        if (process.platform !== 'win32')
        {
            const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-link-')), 'r');
            fs.symlinkSync(repo, link);
            assert.deepStrictEqual(scanOut(link).lines.filter((l) => l.startsWith('!!')), [], 'a symlinked top');
        }
    });

    test('without --out stdout stays the JSON alone; the root line goes to stderr', () =>
    {
        const root = nestedRoot();
        const r = run('node', [SCRIPT, '--root', root, '--catalog', CATALOG], { encoding: 'utf8' });
        assert.ok(JSON.parse(r.stdout).found, 'stdout parses as the payload');
        assert.match(r.stderr, /^root: /m);
        assert.match(r.stderr, /^!! scan-evidence: signals from nested repos child/m);
    });
}

// ---- --children: a workspace root reads the joined children it includes, each as its own root ----
const { prefixHit, mergeFound, underAny, childList, withBelow } = require('./scan-evidence-children/merge.js');
const { CHILD_LINE } = require('./scan-evidence-children/constants.js');

test('prefixHit puts the child folder in front of both hit shapes', () =>
{
    assert.strictEqual(prefixHit('@angular/core in package.json', 'app'), '@angular/core in app/package.json');
    assert.strictEqual(prefixHit('src/main.ts present', 'app'), 'app/src/main.ts present');
    assert.strictEqual(prefixHit('postgres service in docker-compose in dc/docker-compose.yml', 'app/tool'), 'postgres service in docker-compose in app/tool/dc/docker-compose.yml');
});

test('mergeFound keeps own hits first, then each child in the order given, the first hit per name', () =>
{
    const own = { skills: { a: 'x in package.json' }, mcps: {}, plugins: {} };
    const merged = mergeFound(own, [
        { rel: 'app', found: { skills: { a: 'x in package.json', b: 'y in package.json' }, mcps: {}, plugins: { p: 'f.csproj present' } } },
        { rel: 'api', found: { skills: { b: 'z in package.json', c: 'w in package.json' }, mcps: {}, plugins: {} } },
    ]);
    assert.deepStrictEqual(merged, { skills: { a: 'x in package.json', b: 'y in app/package.json', c: 'w in api/package.json' }, mcps: {}, plugins: { p: 'app/f.csproj present' } });
    assert.deepStrictEqual(Object.keys(merged.skills), ['a', 'b', 'c']);
    assert.deepStrictEqual(mergeFound(own, []), own, 'no children: the own map as it is');
});

test('underAny matches a path equal to a folder or below it, never a sibling sharing the prefix', () =>
{
    assert.strictEqual(underAny('app', ['app']), true);
    assert.strictEqual(underAny('app/package.json', ['app']), true);
    assert.strictEqual(underAny('app-two/package.json', ['app']), false);
    assert.strictEqual(underAny('package.json', ['app', 'api']), false);
    assert.strictEqual(underAny('app/package.json', []), false);
});

test('childList reads none as no child and a csv as its words', () =>
{
    assert.deepStrictEqual(childList('none'), []);
    assert.deepStrictEqual(childList('app,api'), ['app', 'api']);
    assert.deepStrictEqual(childList('app'), ['app']);
});

test('withBelow gives each named child, then every row below it in row order', () =>
{
    const rows = [{ rel: '.' }, { rel: 'app' }, { rel: 'app/tool' }, { rel: 'app/tool/deep' }, { rel: 'api' }, { rel: 'app-two' }];
    assert.deepStrictEqual(withBelow(['api', 'app'], rows), ['api', 'app', 'app/tool', 'app/tool/deep']);
    assert.deepStrictEqual(withBelow([], rows), []);
});

// A workspace root `ws` joined to `app` (angular-material) and `api` (dotnet), `app` joined to `app/tool` (capacitor).
function childrenFixture({ git: useGit })
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-kids-'));
    const folder = (rel, files, record, ownGit) =>
    {
        const dir = path.join(base, ...rel.split('/'));
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        for (const [name, text] of Object.entries(files))
        {
            fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
            fs.writeFileSync(path.join(dir, name), text);
        }
        putWorkspace(dir, record);
        if (ownGit) execFileSync('git', ['init', '-q'], { cwd: dir });
        return dir;
    };
    const ws = folder('ws', { 'package.json': JSON.stringify({ dependencies: { pg: '^8.0.0' } }) }, { role: 'root', children: ['app', 'api'] }, useGit);
    folder('ws/app', { 'package.json': JSON.stringify({ dependencies: { '@angular/material': '^17.0.0' } }) }, { parent: '..', children: ['tool'] }, true);
    folder('ws/app/tool', { 'package.json': JSON.stringify({ dependencies: { '@capacitor/core': '^6.0.0' } }) }, { parent: '..' }, true);
    folder('ws/api', { 'Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <PackageReference Include="MassTransit" Version="8.0.0" />\n  </ItemGroup>\n</Project>' }, { parent: '..' }, true);
    return ws;
}
const kids = (root, ...extra) =>
{
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-kids-out-')), 'found.json');
    const r = spawnSync('node', [SCRIPT, '--root', root, '--catalog', CATALOG, '--out', out, ...extra], { encoding: 'utf8' });
    return { r, lines: r.stdout.split('\n').filter(Boolean), found: JSON.parse(fs.readFileSync(out, 'utf8')).found };
};
const hits = (found) => Object.values(found).flatMap((layer) => Object.values(layer));

test('--children reads each child repository at a git root and names the folder', () =>
{
    const ws = childrenFixture({ git: true });
    const { r, lines, found } = kids(ws, '--children', 'app');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(hits(found).some((h) => /^@angular\/material in app\/package\.json$/.test(h)), JSON.stringify(found));
    assert.ok(!hits(found).some((h) => h.includes('api/') || h.includes('Api.csproj')), 'api is not named');
    assert.ok(lines.includes('child: app'), r.stdout);
    assert.ok(!lines.includes('child: api'), r.stdout);
});

test('--children leaves a joined child out at a non-git root, and --children none reads the root alone', () =>
{
    const ws = childrenFixture({ git: false });
    const plain = hits(kids(ws).found);
    assert.ok(plain.some((h) => h.includes('app/') || h.includes('api/')), 'without the flag the folder walk reads into the children');
    const only = kids(ws, '--children', 'app');
    assert.ok(!hits(only.found).some((h) => h.includes('Api.csproj') || h.includes('api/')), JSON.stringify(only.found));
    assert.ok(hits(only.found).some((h) => /in app\/package\.json$/.test(h)), JSON.stringify(only.found));
    const none = kids(ws, '--children', 'none');
    assert.ok(!hits(none.found).some((h) => h.includes('app/') || h.includes('api/') || h.includes('Api.csproj')), JSON.stringify(none.found));
    assert.ok(hits(none.found).some((h) => /^pg in package\.json$/.test(h)), 'the root own package is read');
    assert.deepStrictEqual(none.lines.filter((l) => l.startsWith(CHILD_LINE)), []);
});

test('--children app reads the grandchild repository below app by itself', () =>
{
    const ws = childrenFixture({ git: false });
    const { lines, found } = kids(ws, '--children', 'app');
    assert.ok(hits(found).some((h) => /in app\/tool\/package\.json$/.test(h)), JSON.stringify(found));
    assert.ok(hits(found).every((h) => !/in app\/app\/|in app\/tool\/tool\//.test(h)));
    assert.deepStrictEqual(lines.filter((l) => l.startsWith(CHILD_LINE)), ['child: app', 'child: app/tool']);
});

test('--children names a rel that is no joined child on stderr and reads nothing for it', () =>
{
    const ws = childrenFixture({ git: true });
    const { r, lines } = kids(ws, '--children', 'nope');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /--children nope is not a joined child of/);
    assert.deepStrictEqual(lines.filter((l) => l.startsWith(CHILD_LINE)), []);
});

// captured from the scan before --children existed
const PINNED = { skills: { 'dotnet-messaging': 'MassTransit in api/Api.csproj', 'angular-material': '@angular/material in app/package.json', 'capacitor-release': '@capacitor/core in app/tool/package.json', postgres: 'pg in package.json' }, mcps: {}, plugins: { 'csharp-lsp': 'api/Api.csproj present' } };

test('without --children the scan is unchanged', () =>
{
    const ws = childrenFixture({ git: false });
    const { lines, found } = kids(ws);
    assert.deepStrictEqual(lines, [`root: ${fs.realpathSync.native(ws)}`]);
    assert.deepStrictEqual(found, PINNED);
});

test('--children none at a git root leaves a joined child that is a plain folder of the same repository out', () =>
{
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'evscan-same-'));
    execFileSync('git', ['init', '-q'], { cwd: ws });
    fs.mkdirSync(path.join(ws, 'app', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'app', '.claude', 'alfred-code.stamp'), 'sha: x\n');
    fs.writeFileSync(path.join(ws, 'app', 'package.json'), JSON.stringify({ dependencies: { '@angular/material': '^17.0.0' } }));
    putWorkspace(ws, { role: 'root', children: ['app'] });
    putWorkspace(path.join(ws, 'app'), { parent: '..' });
    assert.deepStrictEqual(hits(kids(ws).found), ['@angular/material in app/package.json'], 'without the flag the folder is read');
    assert.deepStrictEqual(hits(kids(ws, '--children', 'none').found), []);
    assert.deepStrictEqual(hits(kids(ws, '--children', 'app').found), ['@angular/material in app/package.json']);
});
