'use strict';
// claude-md-check.js: a project's CLAUDE.md files against the tree they describe - every path they name
// exists, every command's program resolves, no placeholder or TODO is left, and no line still carries
// the template's own authoring text. Deterministic: no model call, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'claude-md-check.js');
const { checkText, findFiles } = require('./claude-md-check.js');
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// A project tree: `files` maps a relative path to its content (a trailing '/' makes a directory).
function tree(files = {}, { git = false } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-'));
    roots.push(root);
    for (const [rel, body] of Object.entries(files))
    {
        const full = path.join(root, rel);
        if (rel.endsWith('/')) { fs.mkdirSync(full, { recursive: true }); continue; }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, body);
    }
    if (git) execFileSync('git', ['init', '-q'], { cwd: root });
    return root;
}

const TEMPLATE = [
    '# __PROJECT_NAME__',
    '',
    '<!-- Authoring outline - write these sections into the project-specific top of this file.',
    '1. What this project is - one paragraph: domain, shape (binary / service / library), persistence.',
    "2. Stack - languages, frameworks and key libraries at their EXACT versions ('EF Core 10', not 'EF Core'), test stack",
    '   + coverage gate.',
    '-->',
    '',
    '## Rules',
    '',
    'The rules this project runs on, all in `.claude/rules/`: every baseline file loads each session.',
    '',
].join('\n');

// Every program resolves except the ones a case names as missing.
const onPath = (missing = []) => (cmd) => (missing.includes(cmd) ? '' : `/usr/bin/${cmd}`);
const run = (root, text, { file = 'CLAUDE.md', missing = [], template = TEMPLATE, ignored = [] } = {}) =>
    checkText({ root, file, text, template, locate: onPath(missing), isIgnored: (rel) => ignored.includes(rel) });
const kinds = (findings) => findings.map((f) => `${f.line} ${f.kind} ${f.what}`);

test('a CLAUDE.md whose paths exist and whose programs resolve is clean', () =>
{
    const root = tree({ 'src/Api/Program.cs': '', 'src/Web/': '', 'Directory.Build.props': '', '.editorconfig': '' });
    const text = [
        '# Orders',
        '',
        'Entry point `src/Api/Program.cs`; the web app lives in `src/Web/`.',
        'Shared build settings: `Directory.Build.props`, formatting in `.editorconfig`.',
        '',
        '## Commands',
        '',
        '```bash',
        'dotnet build',
        'dotnet test --filter Category=Unit',
        '```',
    ].join('\n');
    assert.deepStrictEqual(run(root, text), []);
});

test('a named path that no longer exists is a finding, with its line', () =>
{
    const root = tree({ 'src/Api/Program.cs': '', 'src/Web/': '' });
    const text = ['# Orders', '', 'Old entry point `src/Legacy/Startup.cs`.', 'Gone folder `src/Admin/`.', 'Dotfile `.nvmrc` too.'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['3 path src/Legacy/Startup.cs', '4 path src/Admin/', '5 path .nvmrc']);
});

test('what only looks like a path is not judged - refs, MIME types, members, namespaces, URLs, globs, placeholders, packages, home', () =>
{
    const root = tree({ 'src/': '' });
    const text = [
        'Rebase on `origin/main` and send `application/json`.',
        'Log with `console.log`, register `Microsoft.Extensions.Hosting`, read `process.env`.',
        'See `https://example.invalid/docs/a.md` and every `src/**/*.cs` file.',
        'Name it `<feature>/index.ts` and install `@angular/core`; your own `~/.npmrc` stays yours.',
        'A branch is `feat/<short-description>`, a ref is `HEAD~1`.',
        'Type `/security-review` or `/alfred-code:init`; `/usr/local/bin` and `/c/...` are the machine\'s.',
        'A sweep over `.md` files, and the installer stamps `__DOCS_ROOT__`.',
    ].join('\n');
    assert.deepStrictEqual(run(root, text), []);
});

// Measured on this repo's own CLAUDE.md: a partial path (`install/docs.js`) or a bare name
// (`settings.local.json`) names a file wherever it sits - only one nothing in the project ends with is stale.
test('an unanchored path exists when some path in the project ends with it; an anchored one is read from its base only', () =>
{
    const root = tree({ 'scripts/install/docs.js': '', 'stack/skills/a/references/x.md': '', '.claude/settings.local.json': '' });
    assert.deepStrictEqual(run(root, 'See `install/docs.js`, `references/x.md`, `settings.local.json` and `skills/`.'), []);
    assert.deepStrictEqual(kinds(run(root, 'See `references/gone.md` and `./docs.js`.')), ['1 path references/gone.md', '1 path ./docs.js']);
});

test('a path is resolved from the file\'s own folder or the project root: .claude/CLAUDE.md names root paths, web/CLAUDE.md names its own', () =>
{
    const root = tree({ 'src/Api/Program.cs': '', 'web/src/main.ts': '', 'web/package.json': '{}' });
    assert.deepStrictEqual(run(root, 'Entry `src/Api/Program.cs`.', { file: '.claude/CLAUDE.md' }), []);
    assert.deepStrictEqual(run(root, 'Bootstrap in `src/main.ts`, deps in `package.json`.', { file: 'web/CLAUDE.md' }), []);
    assert.deepStrictEqual(kinds(run(root, 'Bootstrap in `src/missing.ts`.', { file: 'web/CLAUDE.md' })), ['1 path src/missing.ts']);
});

test('a missing path git ignores is a local file the setup creates, never a finding', () =>
{
    const root = tree({ 'src/': '' });
    assert.deepStrictEqual(run(root, 'Copy `.envrc` to `.env`.', { ignored: ['.env', '.envrc'] }), []);
    assert.deepStrictEqual(kinds(run(root, 'Copy `.envrc` to `.env`.', { ignored: ['.env'] })), ['1 path .envrc']);
});

// I1 (final review of the rename): read over four real consuming projects the check gave 39 rows and 1 was
// true. The five shapes below are what the other 38 were made of - each fixture is synthetic.
test('I1a: a .NET part folder named <Company>.<Part> answers for the part: `Bot/Program.cs` is `src/Acme.Bot/Program.cs`', () =>
{
    const root = tree({ 'src/Acme.Bot/Program.cs': '', 'src/Acme.Domain/Entities/Order.cs': '', 'tests/Acme.Orders.Tests/Integration/': '', 'src/Acme.Settings.json': '' });
    assert.deepStrictEqual(run(root, 'Entry `Bot/Program.cs`, the entity `Domain/Entities/Order.cs`, the net `Orders.Tests/Integration/`.'), []);
    assert.deepStrictEqual(kinds(run(root, 'Gone: `Bot/Startup.cs`, `Api/Program.cs` and `Settings.json`.')), ['1 path Bot/Startup.cs', '1 path Api/Program.cs', '1 path Settings.json'],
        'a part folder answers only for a path under it - a bare file name never matches a dotted one');
});

test('I1b: a shell line is split where the shell splits it - a trailing comment, a 2>&1 and a | inside an argument start no program', () =>
{
    const root = tree({});
    const text = [
        '## Commands',
        '```bash',
        'dotnet test 2>&1 | tee out.log   # full suite; slow',
        'gulp build:client:local|develop',
        'npm run e2e # e2e & local-only, hits the dev API',
        'make check | less',
        'npm ci && lint-all || true',
        '```',
        '',
        '- `npm start # opens it; needs the api`',
    ].join('\n');
    const missing = ['1', 'develop', 'slow', 'local-only', 'hits', 'needs', 'less', 'lint-all'];
    assert.deepStrictEqual(kinds(run(root, text, { missing })), ['6 command less', '7 command lint-all'], 'a whitespace-delimited | and && / || still split');
});

test('I1c: a project-local binary resolves - node_modules/.bin, a package.json dependency, a dotnet tool manifest, a script in the folder', () =>
{
    const root = tree({
        'package.json': JSON.stringify({ devDependencies: { gulp: '^4.0.0', nx: '19.0.0', '@acme/tasks': '1.0.0' } }),
        'node_modules/.bin/eslint': '',
        'web/package.json': JSON.stringify({ name: 'web' }),
        'web/node_modules/.bin/ng': '',
        '.config/dotnet-tools.json': JSON.stringify({ version: 1, isRoot: true, tools: { 'dotnet-reportgenerator-globaltool': { version: '5.0.0', commands: ['reportgenerator'] } } }),
        'setup_local.bat': '',
    });
    const text = ['## Commands', '```bash', 'gulp build', 'nx run app:serve', 'eslint .', 'tasks all', 'cd web && ng build', 'reportgenerator -reports:x', 'setup_local.bat', 'webpack --mode production', '```'].join('\n');
    const missing = ['gulp', 'nx', 'eslint', 'tasks', 'ng', 'reportgenerator', 'setup_local.bat', 'webpack'];
    assert.deepStrictEqual(kinds(run(root, text, { missing })), ['10 command webpack']);
});

test('I1d: a clause that denies a path is no claim it exists - No `x`, there is no `x`, NOT used here: `x`', () =>
{
    const root = tree({ 'src/': '' });
    const text = [
        '- No `appsettings.json` - config comes from the environment.',
        '- There is no `.env`; secrets come from the vault.',
        '- Deliberately NOT used here: `Directory.Packages.props`.',
        '- Entry point `src/Program.cs` - not the old one.',
        '| `src/Old.cs` | never edited by hand |',
    ].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['4 path src/Program.cs', '5 path src/Old.cs'], 'a negation in another clause of the line denies nothing');
});

test('I1e: a dot-token that is a suffix or a kind of name is no dotfile - `.api.ts`, `.hbm.xml`, `.template`, `.example`, `.invalid`', () =>
{
    const root = tree({ 'src/': '' });
    const text = [
        'Generated clients end in `.api.ts`; mappings live in `.hbm.xml` files.',
        'Config ships as `.template` and `.example` copies, and test mail goes to an `.invalid` domain.',
        'Each appsettings`.local` copy is per machine.',
        'Missing dotfile `.nvmrc`.',
    ].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['4 path .nvmrc']);
});

test('the <docs-path> placeholder resolves to the install\'s docs root', () =>
{
    const root = tree({ '.claude/settings.json': JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/ai' } }), 'docs/ai/architecture/ARCHITECTURE.md': '' });
    assert.deepStrictEqual(run(root, 'Map: `<docs-path>/architecture/ARCHITECTURE.md`.'), []);
    assert.deepStrictEqual(kinds(run(root, 'Style: `<docs-path>/code-style/CODE-STYLE.md`.')), ['1 path docs/ai/code-style/CODE-STYLE.md']);
});

test('an @import and a relative markdown link are paths too; a web link and an anchor are not', () =>
{
    const root = tree({ 'AGENTS.md': '', 'docs/setup.md': '' });
    const text = ['@../AGENTS.md', '@missing-notes.md', 'Read [setup](docs/setup.md#tools), [gone](docs/gone.md), [site](https://example.invalid), [top](#rules).', 'Mail ops@example.invalid.'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { file: '.claude/CLAUDE.md' })), ['2 path missing-notes.md', '3 path docs/gone.md']);
});

test('every program in a shell block must resolve: builtins, prompts, comments, env prefixes and chains are read the way a shell would', () =>
{
    const root = tree({ 'gradlew': '' });
    const text = [
        '## Commands',
        '```bash',
        '# build everything',
        '$ dotnet build',
        'cd web && npm ci',
        'FOO=1 pnpm test | tee out.log',
        './gradlew build',
        './mvnw verify',
        'export NODE_ENV=test; make \\',
        '  check',
        '```',
    ].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { missing: ['pnpm', 'make'] })), ['6 command pnpm', '8 command ./mvnw', '9 command make']);
});

test('inline commands are read under a commands or setup heading only - a code span elsewhere is code', () =>
{
    const root = tree({});
    const text = [
        '## Setup',
        '',
        '- Needs the .NET 10 SDK; `docker compose up -d` starts the test database, `ASPNETCORE_ENVIRONMENT` picks the config.',
        '',
        '## Commands',
        '',
        '| Command | What |',
        '|---|---|',
        '| `mvn verify` | full suite |',
        '',
        '## Code conventions',
        '',
        '- Never `async void`; prefer `readonly struct` for value types.',
    ].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { missing: ['mvn', 'docker', 'async', 'readonly'] })), ['3 command docker', '9 command mvn']);
});

test('a PowerShell block skips cmdlets and variables, and checks the programs', () =>
{
    const root = tree({});
    const text = ['```powershell', 'Set-Location web', '$env:CI = "1"', 'dotnet test', '```'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { missing: ['dotnet', 'Set-Location'] })), ['4 command dotnet']);
});

test('a placeholder or a TODO left in the live text is a finding; inside a comment or a code span it is not', () =>
{
    const root = tree({ 'app/__init__.py': '' });
    const text = [
        '# __PROJECT_NAME__',
        '<!-- __STILL_A_COMMENT__ and a TODO in a comment -->',
        'Stack: TODO fill in.',
        'The package marker `app/__init__.py`; a `TODO` without a ticket is rejected.',
        'Root is __DOCS_ROOT__ here.',
    ].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['1 placeholder __PROJECT_NAME__', '3 todo TODO', '5 placeholder __DOCS_ROOT__'],
        'a placeholder H1 over live text of the project\'s own is no unfilled copy - the placeholder row says what is left');
});

test('a live line still carrying the template\'s own authoring text is a finding; the template\'s live Rules text is not', () =>
{
    const root = tree({ '.claude/rules/': '' });
    const text = [
        '# Orders',
        '',
        '## What this project is',
        '',
        'What this project is - one paragraph: domain, shape (binary / service / library), persistence.',
        '',
        '## Stack',
        '',
        '- .NET 10, EF Core 10.',
        '- Stack - languages, frameworks and key libraries at their EXACT versions, nothing more.',
        '',
        '## Rules',
        '',
        'The rules this project runs on, all in `.claude/rules/`: every baseline file loads each session.',
    ].join('\n');
    const got = run(root, text);
    assert.deepStrictEqual(got.map((f) => `${f.line} ${f.kind}`), ['5 template', '10 template'], 'a whole outline sentence, and one cut short');
    assert.match(got[0].what, /^What this project is - one paragraph/);
    assert.match(got[1].what, /^Stack - languages, frameworks and key libraries at their EXACT versions/);
});

test('line numbers survive a multi-line comment', () =>
{
    const root = tree({});
    const text = ['# Orders', '<!-- one', 'two', 'three -->', 'Gone `src/Gone.cs`.'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['5 path src/Gone.cs']);
});

test('findFiles: the root file, .claude/CLAUDE.md and a part\'s own file - never an ignored or vendored copy', () =>
{
    const root = tree({
        'CLAUDE.md': '# a', '.claude/CLAUDE.md': '# b', 'web/CLAUDE.md': '# c', 'node_modules/x/CLAUDE.md': '# d',
        'build/CLAUDE.md': '# e', '.gitignore': 'build/\n', 'docs/claude.md': '# not the name',
    }, { git: true });
    assert.deepStrictEqual(findFiles(root), ['.claude/CLAUDE.md', 'CLAUDE.md', 'web/CLAUDE.md']);
    const plain = tree({ 'CLAUDE.md': '# a', 'api/CLAUDE.md': '# b', 'node_modules/x/CLAUDE.md': '# d', 'bin/CLAUDE.md': '# e' });
    assert.deepStrictEqual(findFiles(plain), ['CLAUDE.md', 'api/CLAUDE.md'], 'outside git the vendored and build folders are skipped by name');
});

// The CLI: what validate and the skill paste.
const cli = (root, args = [], env = {}) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

const POSIX = { skip: process.platform === 'win32' && 'the stub npm is a shell script' };
test('cli: findings print file:line kind and exit 1; a clean project exits 0; no CLAUDE.md is nothing to check', POSIX, () =>
{
    const bin = tree({ 'npm': '#!/bin/sh\nexit 0\n' });
    fs.chmodSync(path.join(bin, 'npm'), 0o755);
    const PATH = `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`;
    const bad = tree({ 'CLAUDE.md': '# __PROJECT_NAME__\n\n## Commands\n\n```bash\nnpm test\nnosuchprogram-xyz run\n```\n\nSee `src/gone.ts`.\n' }, { git: true });
    const r = cli(bad, [], { PATH });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n'), [
        'CLAUDE.md:1 placeholder: __PROJECT_NAME__ - the template\'s placeholder was never filled',
        'CLAUDE.md:7 command: nosuchprogram-xyz - not on PATH',
        'CLAUDE.md:10 path: src/gone.ts - does not exist',
        'claude-md-check: 3 finding(s) in 1 file(s)',
    ]);
    const good = tree({ 'CLAUDE.md': '# Orders\n\n```bash\nnpm test\n```\n' }, { git: true });
    const ok = cli(good, [], { PATH });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.strictEqual(ok.stdout.trim(), 'claude-md-check: clean (1 file(s))');
    const none = cli(tree({}), [], { PATH });
    assert.strictEqual(none.status, 0);
    assert.strictEqual(none.stdout.trim(), 'claude-md-check: no CLAUDE.md in this project');
});

test('cli: --file checks one file; an unreadable template skips only the template check, and says so', () =>
{
    const root = tree({ 'CLAUDE.md': '# Orders\n', 'web/CLAUDE.md': 'See `gone.ts`.\n' }, { git: true });
    const one = cli(root, ['--file', 'CLAUDE.md']);
    assert.strictEqual(one.status, 0, one.stdout);
    assert.strictEqual(one.stdout.trim(), 'claude-md-check: clean (1 file(s))');
    const r = cli(root, ['--template', path.join(root, 'no-such-template.md')]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /template .*unreadable - the template-text check did not run/);
    assert.match(r.stdout, /^web\/CLAUDE\.md:1 path: gone\.ts - does not exist$/m);
    const bad = cli(root, ['--bogus']);
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /usage: node claude-md-check\.js/);
});

// A HAND copy of the template (the fill-in block's route when the seed step was skipped) keeps its
// placeholder H1: on a project whose captures all ran, it is flagged unfilled and by that placeholder
// alone; a GENERATED row whose capture never ran names files that are not there.
test('cli: a hand copy of the shipped template is flagged unfilled and by its placeholder alone - and a skipped capture\'s row by its files', () =>
{
    const template = fs.readFileSync(path.join(__dirname, '..', 'stack', 'CLAUDE.template.md'), 'utf8');
    const rules = ['baseline-interaction', 'baseline-quality-gates', 'baseline-security', 'baseline-git', 'baseline-navigation', 'baseline-docs-root', 'baseline-memory',
        'baseline-project-agent-capabilities', 'baseline-project-architecture', 'baseline-project-related-context', 'project-code-style'];
    const files = { '.claude/CLAUDE.md': template, '.claude/docs/code-style/CODE-STYLE.md': '' };
    for (const r of rules) files[`.claude/rules/${r}.md`] = '';
    const root = tree(files, { git: true });
    const r = cli(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n').map((l) => l.replace(/ - .*/, '')), ['.claude/CLAUDE.md:1 template: the template', '.claude/CLAUDE.md:1 placeholder: __PROJECT_NAME__', 'claude-md-check: 2 finding(s) in 1 file(s)']);
    fs.rmSync(path.join(root, '.claude/rules/project-code-style.md'));
    fs.rmSync(path.join(root, '.claude/docs/code-style'), { recursive: true });
    const skipped = cli(root).stdout.trim().split('\n').map((l) => l.replace(/:\d+ /, ' ').replace(/ - .*/, ''));
    assert.deepStrictEqual(skipped.slice(2, -1), ['.claude/CLAUDE.md path: project-code-style.md', '.claude/CLAUDE.md path: .claude/rules/project-code-style.md',
        '.claude/CLAUDE.md path: .claude/docs/code-style/CODE-STYLE.md'], 'the intro line and the row both name the capture that never ran');
});

// The skill's first read: which CLAUDE.md files exist and whether one is still the untouched seed - the
// fact its create-or-improve choice turns on, stated by the script instead of inferred.
test('cli --list: every CLAUDE.md with its size, the untouched seed marked, and nothing checked', () =>
{
    const root = tree({ '.claude/CLAUDE.md': '# __PROJECT_NAME__\n\n## Rules\n', 'web/CLAUDE.md': '# web\n\nSee `gone.ts`.\n' }, { git: true });
    const r = cli(root, ['--list']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n'), ['.claude/CLAUDE.md: 3 lines, the seeded template (unfilled)', 'web/CLAUDE.md: 3 lines']);
    const none = cli(tree({}), ['--list']);
    assert.strictEqual(none.stdout.trim(), 'claude-md-check: no CLAUDE.md in this project');
});

// Measured by the skill's walkthrough (2026-09-26): the installer stamps the H1 with the folder name, so
// the file it seeds carries no `__PROJECT_NAME__` - an unfilled seed is known by what the installer
// leaves: the template's fill-in block still there, and no live section but the H1 and `## Rules`.
test('the seed the installer writes reads as the unfilled template - listed as such, and a finding - until a section of the project\'s own lands', () =>
{
    const { claudeMdBody } = require('./install/seeds.js');
    const root = tree({}, { git: true });
    const seed = claudeMdBody({ projectRoot: root, sourceDir: path.join(__dirname, '..') });
    assert.ok(!seed.includes('__PROJECT_NAME__'), 'the installer stamps the H1');
    fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/CLAUDE.md'), seed);
    assert.deepStrictEqual(cli(root, ['--list']).stdout.trim().split('\n'), [`.claude/CLAUDE.md: ${seed.replace(/\n$/, '').split('\n').length} lines, the seeded template (unfilled)`]);
    const r = cli(root);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /^\.claude\/CLAUDE\.md:1 template: the template - never filled: only its H1 and ## Rules are live$/m);
    const filled = seed.replace('\n## Rules\n', '\n## Commands\n\n- `git status`\n\n## Rules\n');
    fs.writeFileSync(path.join(root, '.claude/CLAUDE.md'), filled);
    assert.doesNotMatch(cli(root, ['--list']).stdout, /unfilled/, 'a section of the project\'s own makes it the project\'s file');
    assert.doesNotMatch(cli(root).stdout, /never filled/);
});

// I3 (final review of the rename): the seed with its H1 renamed and two lines of the user's own rules under
// it - no `##` of their own - read as unfilled, so the skill took Create mode and wrote over the user's
// text with no diff shown. Live text outside the H1 and `## Rules` that the template does not carry is the
// project's own; the template's own live lines, or the installer's AGENTS import, are not.
test('I3: the seed holding the user\'s own lines under a renamed H1 is the project\'s file; the template\'s own lines or the AGENTS import keep it unfilled', () =>
{
    const { claudeMdBody } = require('./install/seeds.js');
    const root = tree({ '.claude/rules/': '' }, { git: true });
    const seed = claudeMdBody({ projectRoot: root, sourceDir: path.join(__dirname, '..') });
    const write = (body) => fs.writeFileSync(path.join(root, '.claude/CLAUDE.md'), body);
    const listed = () => cli(root, ['--list']).stdout;
    const own = seed.replace(/^# [^\n]*\n/, '# Orders service\n\nAlways run the migrations before the tests.\nNever commit the generated client.\n');
    write(own);
    assert.doesNotMatch(listed(), /unfilled/, 'the user\'s own lines under the H1 are the project\'s text');
    assert.doesNotMatch(cli(root).stdout, /never filled/);
    write(seed.replace(/^# [^\n]*\n/, '# Orders service\n'));
    assert.match(listed(), /unfilled/, 'a renamed H1 alone is still the seed');
    const rulesLine = seed.split('\n').find((l) => l.startsWith('The rules this project runs on'));
    write(seed.replace(/^# [^\n]*\n/, `# Orders service\n\n${rulesLine}\n`));
    assert.match(listed(), /unfilled/, 'a line the template itself carries is not the project\'s text');
    const withAgents = tree({ 'AGENTS.md': '# agents\n', '.claude/rules/': '' }, { git: true });
    fs.writeFileSync(path.join(withAgents, '.claude/CLAUDE.md'), claudeMdBody({ projectRoot: withAgents, sourceDir: path.join(__dirname, '..') }));
    assert.match(cli(withAgents, ['--list']).stdout, /unfilled/, 'the import the installer writes under the H1 is the installer\'s');
});
