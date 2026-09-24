#!/usr/bin/env node
// Deterministic evidence scan (Component A of the evidence layer): read the project's
// package manifests and catalog-named files, match them against the signal definitions in
// meta/evidence.json, and emit the `found` map the selection engine and
// the guided commands consume. Text over checked-in files only - no restore, no network.
// The conclusions are computed per run; the catalog ships only signal DEFINITIONS.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'out', '.serena', '.claude']);
const MAX_DEPTH = 6;
const MAX_CONTENT_BYTES = 512 * 1024;
const LAYERS = ['skills', 'mcps', 'plugins'];
// Every signal kind an entry may carry, in the order the scan tries them - the lint rejects any other.
const SIGNAL_KINDS = ['packages', 'files', 'tracked', 'csprojContent', 'content'];

function walk(root)
{
    const files = [];
    (function rec(dir, depth)
    {
        if (depth > MAX_DEPTH) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries)
        {
            if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(path.join(dir, e.name), depth + 1); }
            else files.push(path.join(dir, e.name));
        }
    })(root, 0);
    return files.sort();
}

function readCapped(file)
{
    try
    {
        if (fs.statSync(file).size > MAX_CONTENT_BYTES) return null;
        return fs.readFileSync(file, 'utf8');
    }
    catch { return null; }
}

// A trailing '.' (NuGet namespace) or '/' (npm scope) marks a prefix; anything else is exact.
function matchesPackage(signal, pkg)
{
    return signal.endsWith('.') || signal.endsWith('/') ? pkg.startsWith(signal) : pkg === signal;
}

// Basename glob with '*' only (the catalog's file/content globs are basename patterns).
function basenameMatches(glob, file)
{
    const pattern = glob.replace(/^\*\*\//, '');
    const re = new RegExp(`^${pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(path.basename(file));
}

function isDotnetManifest(file)
{
    const base = path.basename(file);
    return base.endsWith('.csproj') || base === 'Directory.Build.props' || base === 'Directory.Packages.props';
}

// Ordered [{pkg, rel}] across every manifest - first catalog match wins, so order is stable.
// A repo-relative path that goes into REPORTED text is written with forward slashes on every
// platform. `path.relative` hands back the native separator, so on Windows the same project
// produced `src\\Api\\Api.csproj` where every other machine produced `src/Api/Api.csproj` - the
// evidence reason the guided walk shows the user, and the string a selection is attributed by.
// The separator is presentation here, never a lookup: nothing reads these back as a path.
const relPosix = (root, file) => path.relative(root, file).split(path.sep).join('/');

function collectPackages(root, files)
{
    const out = [];
    for (const file of files)
    {
        const rel = relPosix(root, file);
        if (isDotnetManifest(file))
        {
            const text = readCapped(file);
            if (text === null) continue;
            // PackageReference ONLY - under central package management a Directory.Packages.props
            // <PackageVersion> pin can exist for a package no project references, so a pin alone
            // is never usage; the version-less CPM PackageReference carries the name.
            for (const t of text.matchAll(/<PackageReference\b[^>]*>/g))
            {
                const inc = /Include="([^"]+)"/.exec(t[0]);
                if (!inc) continue;
                const ver = /Version="([^"]+)"/.exec(t[0]);
                out.push({ pkg: inc[1], rel, version: ver ? ver[1] : undefined });
            }
        }
        else if (path.basename(file) === 'package.json')
        {
            const text = readCapped(file);
            if (text === null) continue;
            let json;
            try { json = JSON.parse(text); }
            catch { continue; }
            for (const section of ['dependencies', 'devDependencies'])
            {
                for (const [pkg, version] of Object.entries(json[section] || {})) out.push({ pkg, rel, version });
            }
        }
    }
    return out;
}

// A catalog regex that does not compile must not take the whole scan down with a stack trace (the
// lint checks names and labels, not regex syntax): name it on stderr and skip that one signal.
function safeRegex(source, where)
{
    try { return new RegExp(source); }
    catch (e) { console.error(`scan-evidence: skipping ${where} - invalid regex /${source}/ (${e.message})`); return null; }
}

// `tracked` signals: a file counts only when git tracks it - an untracked copy is one person's note,
// not the project's. The candidates are the walk's own, so the skip-list holds (the installer seeds
// `.claude/CLAUDE.md` into every project, which must never read as evidence), and one `git ls-files`
// answers for all of them. Outside git, or with git absent, nothing is tracked.
function trackedOf(root, candidates)
{
    if (!candidates.length) return new Set();
    try
    {
        const out = execFileSync('git', ['--literal-pathspecs', '-C', root, 'ls-files', '-z', '--', ...candidates.map(f => relPosix(root, f))],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return new Set(out.split('\0').filter(Boolean));
    }
    catch { return new Set(); }
}

function scan(root, catalog)
{
    const files = walk(root);
    const packages = collectPackages(root, files);
    const dotnetManifests = files.filter(isDotnetManifest);

    const found = { skills: {}, mcps: {}, plugins: {} };
    for (const layer of LAYERS)
    {
        for (const [name, entry] of Object.entries(catalog[layer] || {}))
        {
            let hit = null;
            for (const signal of entry.packages || [])
            {
                const p = packages.find(x => matchesPackage(signal, x.pkg));
                if (p) { hit = `${p.pkg} in ${p.rel}`; break; }
            }
            if (!hit) for (const glob of entry.files || [])
            {
                const f = files.find(x => basenameMatches(glob, x));
                if (f) { hit = `${relPosix(root, f)} present`; break; }
            }
            if (!hit) for (const glob of entry.tracked || [])
            {
                const tracked = trackedOf(root, files.filter(x => basenameMatches(glob, x)));
                const f = files.find(x => tracked.has(relPosix(root, x)));
                if (f) { hit = `${relPosix(root, f)} tracked`; break; }
            }
            if (!hit) for (const c of entry.csprojContent || [])
            {
                const re = safeRegex(c.regex, `${layer} ${name} csprojContent`);
                if (!re) continue;
                const f = dotnetManifests.find(x => { const t = readCapped(x); return t !== null && re.test(t); });
                if (f) { hit = `${c.label || c.regex} in ${relPosix(root, f)}`; break; }
            }
            if (!hit) for (const c of entry.content || [])
            {
                const re = safeRegex(c.regex, `${layer} ${name} content`);
                if (!re) continue;
                const f = files.find(x => basenameMatches(c.glob, x) && (t => t !== null && re.test(t))(readCapped(x)));
                if (f) { hit = `${c.label || c.regex} in ${relPosix(root, f)}`; break; }
            }
            if (hit) found[layer][name] = hit;
        }
    }
    return found;
}

// First integer in a version string ('^16.2.0' -> 16); null when none is parseable.
function majorOf(version)
{
    const m = /\d+/.exec(String(version || ''));
    return m ? parseInt(m[0], 10) : null;
}

// Component of the judgment catalog the scan can decide deterministically: an item whose
// guidance targets a newer major than the project runs. No version found = no claim.
function findVersionConflicts(root, judgment)
{
    const packages = collectPackages(root, walk(root));
    const out = [];
    for (const c of judgment.versionConflicts || [])
    {
        const p = packages.find(x => x.pkg === c.package && majorOf(x.version) !== null);
        if (p && majorOf(p.version) < parseInt(c.below, 10))
        {
            out.push({ item: c.item, package: c.package, version: p.version, below: c.below, conflict: c.conflict, survives: c.survives, rel: p.rel });
        }
    }
    return out;
}

// ---- The first-look scan (--orientation) ----
// The same manifests, read for what a newcomer needs first: the stack, the modules, the build / test / run commands
// and the entry points - printed as a PROVISIONAL ORIENTATION.md, so a project with no architecture capture still
// starts every session with a map, for the price of one script run instead of the capture's. Every row is read from
// a manifest or from a file a manifest names that exists on disk; a convention nothing declares is never guessed.
// The marker below is what the docs engine (stack/hooks/docs.js) keys on to treat the file as stale by definition.
const PROVISIONAL = 'provisional - replaced by the architecture capture';
const ORIENTATION_CAP = 4096;
const TEST_PACKAGE = /^(Microsoft\.NET\.Test\.Sdk|xunit(\.v3)?|NUnit|MSTest(\.TestFramework)?|TUnit)$/i;
const NPM_PLACEHOLDER_TEST = /no test specified/;

function tfmLabel(tfm)
{
    let m;
    if ((m = /^net(\d{2,})\.\d/.exec(tfm)) || (m = /^net([5-9])\.\d/.exec(tfm))) return `.NET ${m[1]}`;
    if ((m = /^netcoreapp(\d+\.\d+)/.exec(tfm))) return `.NET Core ${m[1]}`;
    if ((m = /^netstandard(\d+\.\d+)/.exec(tfm))) return `.NET Standard ${m[1]}`;
    if ((m = /^net(\d)(\d)(\d?)$/.exec(tfm))) return `.NET Framework ${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`;
    return tfm;
}

function dotnetProjects(root, files)
{
    const props = files.filter(f => path.basename(f) === 'Directory.Build.props').map(readCapped).filter(Boolean).join('\n');
    const inherited = /<TargetFrameworks?>([^<]+)</.exec(props);
    return files.filter(f => f.endsWith('.csproj')).map(f =>
    {
        const text = readCapped(f) || '';
        const dir = relPosix(root, path.dirname(f)) || '.';
        const sdk = (/<Project[^>]*\bSdk="([^"]+)"/.exec(text) || [])[1] || '';
        const tfms = ((/<TargetFrameworks?>([^<]+)</.exec(text) || inherited || [])[1] || '').split(';').map(t => t.trim()).filter(Boolean);
        const refs = [...text.matchAll(/<PackageReference\b[^>]*\bInclude="([^"]+)"/g)].map(m => m[1]);
        const exe = /<OutputType>\s*(Win)?Exe\s*</i.test(text);
        const flag = name => new RegExp(`<${name}>\\s*true\\s*<`, 'i').test(text);
        const test = flag('IsTestProject') || /^MSTest\.Sdk/i.test(sdk) || refs.some(r => TEST_PACKAGE.test(r));
        const aspire = flag('IsAspireHost') || /Aspire\.AppHost\.Sdk/.test(text);
        const kind = test ? 'test' : aspire ? 'aspire-host' : flag('UseWPF') ? 'wpf' : flag('UseWindowsForms') ? 'winforms'
            : /\.Sdk\.Web$/i.test(sdk) ? 'web' : /\.Sdk\.Worker$/i.test(sdk) ? 'worker' : /\.Sdk\.BlazorWebAssembly$/i.test(sdk) ? 'blazor' : exe ? 'exe' : 'library';
        const runnable = !test && (exe || ['aspire-host', 'web', 'worker', 'blazor'].includes(kind));
        const entry = runnable ? ['Program.cs', 'App.xaml'].map(n => path.join(path.dirname(f), n)).find(p => fs.existsSync(p)) : null;
        return { rel: relPosix(root, f), dir, kind, tfms, runnable, entry: entry ? relPosix(root, entry) : null };
    });
}

// The manager a package is run with: its own packageManager field, else the nearest lockfile up to the root.
function packageManager(root, dir, json)
{
    const declared = /^(npm|pnpm|yarn|bun)@/.exec(String(json.packageManager || ''));
    if (declared) return declared[1];
    for (let d = dir; ; d = path.dirname(d))
    {
        for (const [file, pm] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']])
            if (fs.existsSync(path.join(d, file))) return pm;
        if (path.relative(root, d) === '' || path.dirname(d) === d) return 'npm';
    }
}

function nodePackages(root, files)
{
    return files.filter(f => path.basename(f) === 'package.json').map(f =>
    {
        let json;
        try { json = JSON.parse(readCapped(f)); }
        catch { return null; }
        if (!json || typeof json !== 'object') return null;
        const abs = path.dirname(f);
        const dir = relPosix(root, abs);
        const deps = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
        const major = name => { const v = majorOf(deps[name]); return v === null ? '' : ` ${v}`; };
        const frameworks = [
            ['@angular/core', `Angular${major('@angular/core')}`], ['@ionic/angular', 'Ionic'], ['next', 'Next.js'],
            ['react', `React${major('react')}`], ['vue', 'Vue'], ['@nestjs/core', 'NestJS'], ['express', 'Express'], ['electron', 'Electron'],
        ].filter(([pkg]) => pkg in deps).map(([, label]) => label);
        const ts = 'typescript' in deps || fs.existsSync(path.join(abs, 'tsconfig.json'));
        const scripts = json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
        const pm = packageManager(root, abs, json);
        const at = dir ? ` in \`${dir}/\`` : '';
        const cmd = name => (typeof scripts[name] === 'string' ? `\`${pm} run ${name}\`${at}` : null);
        const run = ['start', 'dev', 'serve'].find(n => typeof scripts[n] === 'string');
        const entries = [];
        let ng = null;
        try { ng = JSON.parse(readCapped(path.join(abs, 'angular.json'))); }
        catch { ng = null; }
        for (const project of Object.values((ng && ng.projects) || {}))
        {
            const o = (((project || {}).architect || {}).build || {}).options || {};
            entries.push(o.browser || o.main);
        }
        entries.push(...(typeof json.bin === 'string' ? [json.bin] : Object.values(json.bin || {})), json.main);
        return {
            dir, label: [...frameworks, ts ? 'TypeScript' : 'JavaScript'].join(' + '),
            build: cmd('build'),
            test: typeof scripts.test === 'string' && !NPM_PLACEHOLDER_TEST.test(scripts.test) ? cmd('test') : null,
            run: run ? cmd(run) : null,
            entries: [...new Set(entries.filter(e => typeof e === 'string' && e).map(e => path.join(abs, e)).filter(p => fs.existsSync(p)).map(p => relPosix(root, p)))],
        };
    }).filter(Boolean);
}

// A browser extension declares its entries in manifest.json (manifest_version is what tells it from any other).
function extensions(root, files)
{
    return files.filter(f => path.basename(f) === 'manifest.json').map(f =>
    {
        let j;
        try { j = JSON.parse(readCapped(f)); }
        catch { return null; }
        if (!j || typeof j.manifest_version !== 'number') return null;
        const abs = path.dirname(f);
        const bg = j.background || {};
        const popup = (j.action || j.browser_action || {}).default_popup;
        const content = ((j.content_scripts || [])[0] || {}).js || [];
        const entries = [bg.service_worker, ...(bg.scripts || []), popup, content[0]]
            .filter(e => typeof e === 'string' && e).map(e => path.join(abs, e)).filter(p => fs.existsSync(p)).map(p => relPosix(root, p));
        return { dir: relPosix(root, abs), version: j.manifest_version, entries };
    }).filter(Boolean);
}

// The capture stamp every doc under the docs root opens with, from git itself; a tree outside git says so.
function captureLine(root)
{
    const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (git('rev-parse', '--git-dir') === null) return `Captured: no git, ${date}`;
    // symbolic-ref, not rev-parse --abbrev-ref: a fresh repo has a branch before it has a commit to resolve.
    const b = git('symbolic-ref', '--short', '-q', 'HEAD');
    const sha = git('rev-parse', '--short', 'HEAD');
    const dirty = git('status', '--porcelain') ? '+dirty' : '';
    return `Captured: ${b || 'detached'}@${sha || 'no-commits'}${dirty}, ${date}`;
}

// The document, or null when no manifest here is one this scan reads. Each list is capped and the rest counted; the
// caps shrink until the whole file fits the 4096 bytes every session pays for.
function orientation(root)
{
    // Shallowest first: the top-level app leads its row, a nested tool or fixture package follows it.
    const byDepth = (a, b) => a.split(path.sep).length - b.split(path.sep).length || (a < b ? -1 : a > b ? 1 : 0);
    const files = walk(root).sort(byDepth);
    const projects = dotnetProjects(root, files);
    const packages = nodePackages(root, files);
    const exts = extensions(root, files);
    if (!projects.length && !packages.length && !exts.length) return null;
    const depth = f => relPosix(root, f).split('/').length;
    const slns = files.filter(f => /\.slnx?$/.test(f));
    const top = slns.filter(f => depth(f) === Math.min(...slns.map(depth))).map(f => relPosix(root, f));
    const tests = projects.filter(p => p.kind === 'test');
    const runnable = projects.filter(p => p.runnable);
    const tfms = [...new Set(projects.flatMap(p => p.tfms).map(tfmLabel))];
    const kinds = { web: 'ASP.NET Core', worker: 'Worker service', wpf: 'WPF', winforms: 'WinForms', blazor: 'Blazor WebAssembly', 'aspire-host': 'Aspire' };
    const frameworks = [...new Set(projects.map(p => kinds[p.kind]).filter(Boolean))];
    const stack = [
        ...(projects.length ? [`${tfms.join(', ') || '.NET'} (C#)${frameworks.length ? ` - ${frameworks.join(', ')}` : ''}`] : []),
        ...packages.map(p => `${p.dir ? `\`${p.dir}/\` ` : ''}${p.label}`),
        ...exts.map(e => `${e.dir ? `\`${e.dir}/\` ` : ''}browser extension (MV${e.version})`),
    ];
    const modules = [
        ...projects.map(p => `\`${p.dir}\` (${p.kind})`),
        ...packages.map(p => `\`${p.dir || '.'}\` (package)`),
        ...exts.map(e => `\`${e.dir || '.'}\` (extension)`),
    ];
    const build = [
        ...(top.length ? top.map(s => `\`dotnet build ${s}\``) : (runnable.length ? runnable : projects.filter(p => p.kind !== 'test')).map(p => `\`dotnet build ${p.rel}\``)),
        ...packages.map(p => p.build).filter(Boolean),
    ];
    const test = [
        ...(tests.length ? (top.length ? top.map(s => `\`dotnet test ${s}\``) : tests.map(p => `\`dotnet test ${p.rel}\``)) : []),
        ...packages.map(p => p.test).filter(Boolean),
    ];
    const run = [...runnable.map(p => `\`dotnet run --project ${p.rel}\``), ...packages.map(p => p.run).filter(Boolean)];
    const entries = [...runnable.map(p => p.entry).filter(Boolean), ...packages.flatMap(p => p.entries), ...exts.flatMap(e => e.entries)].map(e => `\`${e}\``);
    const compose = (rowCap, moduleCap) =>
    {
        const cap = (list, n) => (list.length > n ? [...list.slice(0, n), `(+${list.length - n} more)`] : list);
        const row = (name, list, n) => `| ${name} | ${list.length ? cap(list, n).join('; ') : 'none declared'} |`;
        return [
            captureLine(root), '',
            `# Orientation (${PROVISIONAL})`, '',
            'A first-look scan of the manifests, not the architecture capture: each row is read from a manifest or a file it names, nothing is inferred. Verify a row against the code before relying on it.', '',
            '| | |', '|---|---|',
            `| Stack | ${stack.join('; ')} |`,
            `| Modules | ${cap(modules, moduleCap).join(', ')} |`,
            row('Build', build, rowCap), row('Test', test, rowCap), row('Run', run, rowCap), row('Entry points', entries, rowCap), '',
        ].join('\n');
    };
    for (const [rowCap, moduleCap] of [[4, 16], [3, 10], [2, 6], [1, 3], [1, 1]])
    {
        const doc = compose(rowCap, moduleCap);
        if (Buffer.byteLength(doc) <= ORIENTATION_CAP) return doc;
    }
    return compose(1, 1).slice(0, ORIENTATION_CAP);
}

// --out is the file the session-start block pushes. A provisional file is refreshed; a file the capture wrote, or
// any file beside the capture's own map, is never replaced - the scan exists for a project with NO capture.
function orientationMain(argv, arg)
{
    const root = arg('--root');
    if (!root) { console.error('usage: scan-evidence.js --orientation --root <project> [--out <docs>/architecture/ORIENTATION.md]'); process.exit(2); }
    if (!fs.existsSync(root)) { console.error(`scan-evidence: no such root ${root}`); process.exit(1); }
    const out = arg('--out');
    if (out)
    {
        const existing = fs.existsSync(out) ? readCapped(out) : null;
        if (existing !== null && !existing.includes(PROVISIONAL)) { console.error(`scan-evidence: ${out} is not provisional - the architecture capture wrote it; nothing replaced`); process.exit(1); }
        const map = path.join(path.dirname(out), 'ARCHITECTURE.md');
        if (fs.existsSync(map)) { console.error(`scan-evidence: ${map} exists - the architecture capture already ran here; nothing written`); process.exit(1); }
    }
    const doc = orientation(root);
    if (doc === null) { console.error(`scan-evidence: no manifest recognized under ${root} - nothing to orient from`); process.exit(1); }
    if (!out) { process.stdout.write(doc); return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, doc);
    process.stdout.write(`wrote ${out} (${Buffer.byteLength(doc)} bytes):\n\n${doc}`);
}

function main(argv)
{
    const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
    if (argv.includes('--orientation')) return orientationMain(argv, arg);
    const root = arg('--root');
    const catalogPath = arg('--catalog');
    if (!root || !catalogPath) { console.error('usage: scan-evidence.js --root <project> --catalog <evidence.json> [--out <file>] | --orientation --root <project> [--out <file>]'); process.exit(2); }
    let catalog;
    try { catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); }
    catch (e) { console.error(`scan-evidence: cannot read catalog ${catalogPath}: ${e.code || e.message}`); process.exit(1); }
    if (!fs.existsSync(root)) { console.error(`scan-evidence: no such root ${root}`); process.exit(1); }

    const payload = { found: scan(root, catalog) };
    const judgmentPath = arg('--judgment');
    if (judgmentPath)
    {
        let judgment;
        try { judgment = JSON.parse(fs.readFileSync(judgmentPath, 'utf8')); }
        catch (e) { console.error(`scan-evidence: cannot read judgment catalog ${judgmentPath}: ${e.code || e.message}`); process.exit(1); }
        payload.judgment = { versionConflicts: findVersionConflicts(root, judgment) };
    }

    const result = JSON.stringify(payload, null, 2);
    const out = arg('--out');
    if (out) fs.writeFileSync(out, result);
    else process.stdout.write(result + '\n');
}

module.exports = { scan, matchesPackage, basenameMatches, majorOf, findVersionConflicts, orientation, PROVISIONAL, SIGNAL_KINDS };

if (require.main === module) main(process.argv.slice(2));
