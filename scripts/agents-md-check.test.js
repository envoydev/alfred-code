'use strict';
// agents-md-check.js: a project's AGENTS.md (and CLAUDE.md) files against the tree they describe - every path they name
// exists, every command's program resolves, no placeholder or TODO is left, and no line still carries
// the template's own authoring text. Deterministic: no model call, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'agents-md-check.js');
const { checkText, findFiles } = require('./agents-md-check.js');
const roots = [];
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// A project tree: `files` maps a relative path to its content (a trailing '/' makes a directory).
function tree(files = {}, { git = false } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsmd-'));
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

// audit 2026-10-10 C24: the old-root `.claude/docs/...` pointers sit in a folder git ignores, so every one passed (13 dead
// pointers, 0 rows); a package named like a file and a row the user kept were re-asked on every validate.
test('C24: a stale docs pointer is a row whatever git ignores, and a moved one names the new root', () =>
{
    const root = tree({ '.claude/rules/': '', '.alfred/docs/architecture/ARCHITECTURE.md': '# a', 'src/Api/': '' });
    const ignoredAll = ['.claude/docs/architecture/ARCHITECTURE.md', '.claude/docs/quality/GONE.md', '.alfred/docs/architecture/NOPE.md',
        '.alfred/docs/code-style/CODE-STYLE.md', '.claude/rules/alfred-project-awareness.md', 'src/Api/appsettings.Development.json', '.env'];
    const check = (text) => checkText({ root, file: 'AGENTS.md', text, template: TEMPLATE, locate: onPath([]), isIgnored: (rel) => ignoredAll.includes(rel), docsRoot: '.alfred/docs' });
    const rows = check('Map `.claude/docs/architecture/ARCHITECTURE.md`, `.alfred/docs/architecture/NOPE.md`.');
    assert.deepStrictEqual(kinds(rows), ['1 path .claude/docs/architecture/ARCHITECTURE.md', '1 path .alfred/docs/architecture/NOPE.md']);
    assert.match(rows[0].why, /the docs root is `\.alfred\/docs` now, where `\.alfred\/docs\/architecture\/ARCHITECTURE\.md` does/);
    assert.strictEqual(rows[1].why, 'does not exist');
    assert.deepStrictEqual(check('Local: `src/Api/appsettings.Development.json` and `.env`.'), [], 'a local file the setup creates stays quiet');
    assert.deepStrictEqual(check('Not yet captured: `.alfred/docs/code-style/CODE-STYLE.md`, `.claude/rules/alfred-project-awareness.md`, `.claude/docs/quality/GONE.md`.'), [],
        'a domain no capture wrote, a generated rule and a legacy path with no twin stay quiet where git ignores them');
});

test('C24: a backticked dependency name is a package, and a line marked keep raises no row', () =>
{
    const root = tree({ 'package.json': JSON.stringify({ dependencies: { 'driver.js': '^1.6.0' } }) });
    assert.deepStrictEqual(run(root, 'Tours use `driver.js`.'), []);
    assert.deepStrictEqual(kinds(run(root, 'Tours use `shepherd.js`.')), ['1 path shepherd.js']);
    assert.deepStrictEqual(run(root, 'Name a client `x.api.ts`. <!-- agents-md-check: keep -->'), []);
    assert.deepStrictEqual(kinds(run(root, 'Name a client `x.api.ts`.')), ['1 path x.api.ts']);
    assert.deepStrictEqual(kinds(run(root, 'Name a client `x.api.ts`. <!-- keep -->\nAnd `y.api.ts`.')), ['1 path x.api.ts', '2 path y.api.ts'], 'only the exact marker, only its own line');
});

// The user's ruling of 2026-10-21: every file in .claude/rules/ loads itself, so the `## Rules` list an older template
// seeded only repeats the rules in every session - one row at its heading, which the improve mode offers to remove.
test('stack-rules: a `## Rules` section naming the stack\'s own rules is one row at its heading - a table, the old prose, a baseline name', () =>
{
    const root = tree({ '.claude/rules/alfred-git.md': 'x', '.claude/rules/markdown-docs.md': 'x' });
    const check = (text) => kinds(checkText({ root, file: 'AGENTS.md', text, template: TEMPLATE, locate: onPath([]), isIgnored: () => true }));
    const table = (rows) => ['# App', '', '## Rules', '', '| Rule | What |', '|---|---|', ...rows.map((r) => `| \`${r}\` | x |`)].join('\n');
    assert.deepStrictEqual(check(table(['.claude/rules/alfred-git.md'])), ['3 stack-rules ## Rules']);
    assert.deepStrictEqual(check(['# App', '', '## Rules', '', 'Every `alfred-*` file loads each session.'].join('\n')), ['3 stack-rules ## Rules'], 'the older seeds\' prose');
    assert.deepStrictEqual(check(table(['.claude/rules/baseline-git.md'])), ['3 stack-rules ## Rules'], 'a pre-2.1.6 name');
    assert.deepStrictEqual(check(['# App', '', '## Rules', '', '### Baseline', '', '| `.claude/rules/alfred-git.md` | x |'].join('\n')), ['3 stack-rules ## Rules'], 'a ### under it is still the section');
    assert.deepStrictEqual(check(table(['.claude/rules/alfred-git.md']).replace('## Rules', '## Rules <!-- agents-md-check: keep -->')), [], 'a kept heading is silenced');
});

// The temp-project matrix of 2026-10-21: a filled 2.9.0 seed drew the section's row plus one path row per generated or
// retired rule its table named - four rows for one fix. The section's removal covers them, so its row stands alone.
test('stack-rules: inside the flagged section no path row is raised - its removal covers them; after it the path check runs again', () =>
{
    const root = tree({});
    const text = ['# App', '', '## Rules', '', '| `.claude/rules/alfred-git.md` | x |', '| `.claude/rules/alfred-architecture.md` (GENERATED) | `.alfred/docs/awareness/` |',
        '', '## Key files', '', '- `src/gone.ts`'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['3 stack-rules ## Rules', '10 path src/gone.ts']);
    assert.deepStrictEqual(kinds(run(root, text.replace('## Rules', '## Rules <!-- agents-md-check: keep -->'))),
        ['5 path .claude/rules/alfred-git.md', '6 path .claude/rules/alfred-architecture.md', '6 path .alfred/docs/awareness/', '10 path src/gone.ts'], 'a kept section is checked line by line');
});

test('stack-rules: a list of the project\'s own rules, or a stack rule named outside the section, is no row - a named rule with no file is the path check\'s', () =>
{
    const root = tree({ '.claude/rules/alfred-git.md': 'x', '.claude/rules/markdown-docs.md': 'x' });
    const check = (text, isIgnored = () => true) => kinds(checkText({ root, file: 'AGENTS.md', text, template: TEMPLATE, locate: onPath([]), isIgnored }));
    const table = (rows) => ['# App', '', '## Rules', '', '| Rule | What |', '|---|---|', ...rows.map((r) => `| \`${r}\` | x |`)].join('\n');
    assert.deepStrictEqual(check(table(['.claude/rules/markdown-docs.md'])), [], 'the project\'s own list');
    assert.deepStrictEqual(check(`${table(['.claude/rules/markdown-docs.md'])}\n\n## Other\n\nThe git rule is \`.claude/rules/alfred-git.md\`.`), [], 'a later section is no list');
    assert.deepStrictEqual(check(table(['.claude/rules/gone.md']), () => false), ['7 path .claude/rules/gone.md']);
    const bare = tree({ 'docs/x.md': 'x' });
    assert.deepStrictEqual(kinds(checkText({ root: bare, file: 'AGENTS.md', text: table(['.claude/rules/alfred-git.md']), template: TEMPLATE, locate: onPath([]), isIgnored: () => false })),
        ['3 stack-rules ## Rules'], 'no .claude/rules/ at all: the section\'s row covers the path it names');
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

test('findFiles reads AGENTS.md as well as CLAUDE.md: the root, .claude/ and a part\'s own, sorted', () =>
{
    const root = tree({ 'AGENTS.md': '# a', '.claude/AGENTS.md': '# b', 'web/AGENTS.md': '# c', 'api/CLAUDE.md': '# d', 'node_modules/x/AGENTS.md': '# e', '.claude/rules/AGENTS.md': '# f' }, { git: true });
    assert.deepStrictEqual(findFiles(root), ['.claude/AGENTS.md', 'AGENTS.md', 'api/CLAUDE.md', 'web/AGENTS.md']);
});

test('a path named from .claude/AGENTS.md is read from the project root, and the file itself exists as a path', () =>
{
    const root = tree({ 'src/Api/Program.cs': '', '.claude/AGENTS.md': '# x' });
    assert.deepStrictEqual(run(root, 'Entry `src/Api/Program.cs`; see `.claude/AGENTS.md`.', { file: '.claude/AGENTS.md' }), []);
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
        'agents-md-check: 3 finding(s) in 1 file(s)',
    ]);
    const good = tree({ 'CLAUDE.md': '# Orders\n\n```bash\nnpm test\n```\n' }, { git: true });
    const ok = cli(good, [], { PATH });
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    assert.strictEqual(ok.stdout.trim(), 'agents-md-check: clean (1 file(s))');
    const none = cli(tree({}), [], { PATH });
    assert.strictEqual(none.status, 0);
    assert.strictEqual(none.stdout.trim(), 'agents-md-check: no AGENTS.md or CLAUDE.md in this project');
});

test('cli: --file checks one file; an unreadable template skips only the template check, and says so', () =>
{
    const root = tree({ 'CLAUDE.md': '# Orders\n', 'web/CLAUDE.md': 'See `gone.ts`.\n' }, { git: true });
    const one = cli(root, ['--file', 'CLAUDE.md']);
    assert.strictEqual(one.status, 0, one.stdout);
    assert.strictEqual(one.stdout.trim(), 'agents-md-check: clean (1 file(s))');
    const r = cli(root, ['--template', path.join(root, 'no-such-template.md')]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /template .*unreadable - the template-text check did not run/);
    assert.match(r.stdout, /^web\/CLAUDE\.md:1 path: gone\.ts - does not exist$/m);
    const bad = cli(root, ['--bogus']);
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /usage: node agents-md-check\.js/);
});

// A HAND copy of the template (the fill-in block's route when the seed step was skipped) keeps its
// placeholder H1: it is flagged unfilled and by that placeholder alone - its only live line is the H1, so a
// project with no rules and no docs yet adds no row.
test('cli: a hand copy of the shipped template is flagged unfilled and by its placeholder alone, on a project with no rules or docs', () =>
{
    const template = fs.readFileSync(path.join(__dirname, '..', 'stack', 'AGENTS.template.md'), 'utf8');
    const root = tree({ '.claude/AGENTS.md': template }, { git: true });
    const r = cli(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n').map((l) => l.replace(/ - .*/, '')), ['.claude/AGENTS.md:1 template: the template', '.claude/AGENTS.md:1 placeholder: __PROJECT_NAME__', 'agents-md-check: 2 finding(s) in 1 file(s)']);
});

// The skill's first read: which CLAUDE.md files exist and whether one is still the untouched seed - the
// fact its create-or-improve choice turns on, stated by the script instead of inferred.
test('cli --list: every CLAUDE.md with its size, the untouched seed marked, and nothing checked', () =>
{
    const root = tree({ '.claude/AGENTS.md': '# __PROJECT_NAME__\n\n## Rules\n', 'web/CLAUDE.md': '# web\n\nSee `gone.ts`.\n' }, { git: true });
    const r = cli(root, ['--list']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n'), ['.claude/AGENTS.md: 3 lines, the seeded template (unfilled)', 'web/CLAUDE.md: 3 lines']);
    const none = cli(tree({}), ['--list']);
    assert.strictEqual(none.stdout.trim(), 'agents-md-check: no AGENTS.md or CLAUDE.md in this project');
});

// Measured by the skill's walkthrough (2026-09-26): the installer stamps the H1 with the folder name, so
// the file it seeds carries no `__PROJECT_NAME__` - an unfilled seed is known by what the installer
// leaves: the template's fill-in block still there, and no live section but the H1 (and an older seed's `## Rules`).
test('the seed the installer writes reads as the unfilled template - listed as such, and a finding - until a section of the project\'s own lands', () =>
{
    const { agentsMdBody } = require('./install/seeds.js');
    const root = tree({}, { git: true });
    const seed = agentsMdBody({ projectRoot: root, sourceDir: path.join(__dirname, '..') });
    assert.ok(!seed.includes('__PROJECT_NAME__'), 'the installer stamps the H1');
    fs.mkdirSync(path.join(root, '.claude/rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/AGENTS.md'), seed);
    assert.deepStrictEqual(cli(root, ['--list']).stdout.trim().split('\n'), [`.claude/AGENTS.md: ${seed.replace(/\n$/, '').split('\n').length} lines, the seeded template (unfilled)`]);
    const r = cli(root);
    assert.strictEqual(r.status, 1, r.stdout);
    assert.match(r.stdout, /^\.claude\/AGENTS\.md:1 template: the template - never filled: no section of the project's own$/m);
    assert.doesNotMatch(seed, /^## Rules/m, 'the seed lists no rules');
    fs.writeFileSync(path.join(root, '.claude/AGENTS.md'), `${seed}\n## Rules\n\n| Rule | What |\n|---|---|\n| \`.claude/rules/alfred-git.md\` | x |\n`);
    assert.match(cli(root, ['--list']).stdout, /unfilled/, 'an older seed\'s rules list is no section of the project\'s own');
    const filled = `${seed}\n## Commands\n\n- \`git status\`\n`;
    fs.writeFileSync(path.join(root, '.claude/AGENTS.md'), filled);
    assert.doesNotMatch(cli(root, ['--list']).stdout, /unfilled/, 'a section of the project\'s own makes it the project\'s file');
    assert.doesNotMatch(cli(root).stdout, /never filled/);
});

// I3 (final review of the rename): the seed with its H1 renamed and two lines of the user's own rules under
// it - no `##` of their own - read as unfilled, so the skill took Create mode and wrote over the user's
// text with no diff shown. Live text outside the H1 and an older seed's `## Rules` that the template does not carry
// is the project's own; the template's own live lines, or the installer's AGENTS import, are not.
test('I3: the seed holding the user\'s own lines under a renamed H1 is the project\'s file; the template\'s own lines or the AGENTS import keep it unfilled', () =>
{
    const { agentsMdBody } = require('./install/seeds.js');
    const root = tree({ '.claude/rules/': '' }, { git: true });
    const seed = agentsMdBody({ projectRoot: root, sourceDir: path.join(__dirname, '..') });
    const write = (body) => fs.writeFileSync(path.join(root, '.claude/AGENTS.md'), body);
    const listed = () => cli(root, ['--list']).stdout;
    const own = seed.replace(/^# [^\n]*\n/, '# Orders service\n\nAlways run the migrations before the tests.\nNever commit the generated client.\n');
    write(own);
    assert.doesNotMatch(listed(), /unfilled/, 'the user\'s own lines under the H1 are the project\'s text');
    assert.doesNotMatch(cli(root).stdout, /never filled/);
    write(seed.replace(/^# [^\n]*\n/, '# Orders service\n'));
    assert.match(listed(), /unfilled/, 'a renamed H1 alone is still the seed');
    write(`${seed.replace(/^# [^\n]*\n/, '# Orders service\n')}\n## Rules\n\nThe rules this project runs on, all in \`.claude/rules/\`: every \`alfred-*\` file loads each session.\n`);
    assert.match(listed(), /unfilled/, 'an older seed\'s rules prose is not the project\'s text');
    const withAgents = tree({ 'AGENTS.md': '# agents\n', '.claude/rules/': '' }, { git: true });
    fs.writeFileSync(path.join(withAgents, '.claude/AGENTS.md'), agentsMdBody({ projectRoot: withAgents, sourceDir: path.join(__dirname, '..') }));
    assert.match(cli(withAgents, ['--list']).stdout, /unfilled/, 'the import the installer writes under the H1 is the installer\'s');
});

// Audit 2026-10-11 SD04 (sessions e7c8cbb6, b3f8193f, bca100bd, 6288ad94, 5b9ce9c5, 5f9fec85): 3 to 4 rows per run, every one
// correct text, and one 825k detour that reworded a correct line to silence the check. Three shapes, each replayed here.
const SHIPPED_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'stack', 'AGENTS.template.md'), 'utf8');

test('SD04: a bare name in a list of glob patterns is a pattern, never a claimed path - the rule name the list routes to is still checked', () =>
{
    const root = tree({ 'Directory.Build.props': '', '.claude/rules/dotnet-repair-agents.md': '' });
    const list = '- `**/*.csproj`, `**/*.sln`, `Directory.Build.props`, `Directory.Packages.props`, `**/*.targets`, `nuget.config` (and every `.cs`/`.xaml` touch) -> `dotnet-repair-agents.md` - routes a broken build.';
    const text = ['# Orders', '', '## Rules', '', list, '- `**/*.ts` or `tsconfig.app.json` -> `angular-repair-agents.md`'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text)), ['6 path angular-repair-agents.md'], 'the list names attach patterns; the routed rule is still a path');
    const prose = ['# Orders', '', 'Sources match `src/**/*.cs`; the solution config is `Gone.props`.'].join('\n');
    assert.deepStrictEqual(kinds(run(root, prose)), ['3 path Gone.props'], 'a glob elsewhere on the line, past prose, makes no list of the path');
});

test('SD04: a path its own line places in the parent directory is read from there - and is a row when it is not there either', () =>
{
    const parent = tree({ 'run_app.bat': '', 'proj/src/': '' });
    const root = path.join(parent, 'proj');
    const line = (name) => `- **Build/run**: open the solution and build. A convenience script \`${name}\` exists at the parent directory.`;
    assert.deepStrictEqual(kinds(run(root, ['# Orders', '', line('run_app.bat')].join('\n'), { file: '.claude/AGENTS.md' })), []);
    assert.deepStrictEqual(kinds(run(root, ['# Orders', '', line('gone_app.bat')].join('\n'), { file: '.claude/AGENTS.md' })), ['3 path gone_app.bat']);
    assert.deepStrictEqual(kinds(run(root, ['# Orders', '', 'A convenience script `run_app.bat` sits beside the solution.'].join('\n'), { file: '.claude/AGENTS.md' })), ['3 path run_app.bat'],
        'a line that places it nowhere else is read from the project only');
});

test('SD04: a line pointing at a generated rule is that pointer, not the outline - a copied outline sentence elsewhere still is', () =>
{
    const root = tree({ '.claude/rules/alfred-agent-awareness.md': '' });
    const pointer = '- MCP/skill/agent routing is not hand-filled here - it lives in the generated `.claude/rules/alfred-agent-awareness.md`; re-run the capture after an install.';
    const text = ['# Orders', '', '## Stack', '', pointer, '- .NET 10, WPF.'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { file: '.claude/AGENTS.md', template: SHIPPED_TEMPLATE })), []);
    const copied = ['# Orders', '', '## Setup', '', '- what a machine needs before build and test work: the SDK / runtime versions, nothing more.'].join('\n');
    assert.deepStrictEqual(run(root, copied, { file: '.claude/AGENTS.md', template: SHIPPED_TEMPLATE }).map((f) => `${f.line} ${f.kind}`), ['5 template']);
});

// Template audit 2026-10-20: the generated names stopped at the 2026-10-13 spellings, so the 2026-10-16 awareness rule and
// the 2.8.0 preferences rule read as baseline rules - the pointer the outline asks for was template text, naming either
// rule made the list 'enumerate' (seven baseline rows), and an uncaptured one was a missing rule. 9 rows, 1 true.
test('generated rules: every rule a capture skill writes is a generated name, and no shipped rule is', () =>
{
    const { GENERATED_STEM } = require('./agents-md-check.js');
    const generated = (stem) => new RegExp(`^${GENERATED_STEM}$`).test(stem);
    const repo = path.join(__dirname, '..');
    const shipped = fs.readdirSync(path.join(repo, 'stack', 'rules')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    const written = new Set();
    for (const d of fs.readdirSync(path.join(repo, 'stack', 'skills')).filter((n) => n.startsWith('capture-')))
    {
        let text = '';
        try { text = fs.readFileSync(path.join(repo, 'stack', 'skills', d, 'SKILL.md'), 'utf8'); } catch { continue; }
        for (const m of text.matchAll(/\.claude\/rules\/([a-z0-9-]+)\.md/g)) if (!shipped.includes(m[1])) written.add(m[1]);
    }
    assert.deepStrictEqual([...written].sort(), ['alfred-architecture', 'alfred-awareness']);
    for (const stem of written) assert.ok(generated(stem), `${stem} is written by a capture`);
    for (const stem of shipped) assert.ok(!generated(stem), `${stem} ships with the stack`);
});

test('generated rules: the awareness and architecture rules - a pointer is no template text, an uncaptured one is a path, a Rules list of them is the stack\'s', () =>
{
    const files = { '.claude/rules/alfred-awareness.md': '' };
    for (const r of ['interaction', 'quality-gates', 'security', 'preferences', 'navigation', 'docs-root', 'memory']) files[`.claude/rules/alfred-${r}.md`] = '';
    const root = tree(files);
    const pointer = '- MCP routing is NOT hand-filled here - it lives in the generated <docs-path>/awareness/AGENTS-AWARENESS.md, which .claude/rules/alfred-awareness.md imports.';
    const text = ['# Orders', '', '## Stack', '', pointer, '- .NET 10.', '', '## Key files', '', '| Rule | What |', '|---|---|',
        '| `.claude/rules/alfred-awareness.md` (GENERATED) | the inventory |', '| `.claude/rules/alfred-architecture.md` (GENERATED) | the architecture marker |'].join('\n');
    assert.deepStrictEqual(kinds(run(root, text, { file: '.claude/AGENTS.md', template: SHIPPED_TEMPLATE })), ['13 path .claude/rules/alfred-architecture.md']);
    fs.writeFileSync(path.join(root, '.claude/rules/alfred-architecture.md'), '');
    assert.deepStrictEqual(kinds(run(root, text, { file: '.claude/AGENTS.md', template: SHIPPED_TEMPLATE })), []);
    assert.deepStrictEqual(kinds(run(root, text.replace('## Key files', '## Rules'), { file: '.claude/AGENTS.md', template: SHIPPED_TEMPLATE })), ['8 stack-rules ## Rules']);
});

test('SD04 --outline: each numbered outline section with the heading that holds it, or lacks - informational, exit 0', () =>
{
    const body = ['# Orders', '', 'A billing service over SQL Server.', '', '## Stack', '', '- .NET 10.', '', '## Build and run commands', '', '- `dotnet build`',
        '', '### Testing', '', '- `dotnet test`', '', '## Rules', '', '- none'].join('\n');
    const root = tree({ '.claude/AGENTS.md': body }, { git: true });
    const r = cli(root, ['--outline']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const rows = r.stdout.trim().split('\n');
    assert.strictEqual(rows.length, 13, r.stdout);
    assert.match(rows[0], /^\.claude\/AGENTS\.md: outline 1\. What this project is - has \(line 3\)$/);
    assert.match(rows[1], /^\.claude\/AGENTS\.md: outline 2\. Stack - has \(line 5 '## Stack'\)$/);
    assert.match(rows[2], /^\.claude\/AGENTS\.md: outline 3\. Setup - lacks$/);
    assert.match(rows[3], /^\.claude\/AGENTS\.md: outline 4\. Commands - has \(line 9 '## Build and run commands'\)$/);
    assert.match(rows[11], /^\.claude\/AGENTS\.md: outline 12\. Testing approach - has \(line 13 '### Testing'\)$/);
    assert.strictEqual(rows.filter((l) => / - lacks$/.test(l)).length, 9);
    const bare = tree({ 'CLAUDE.md': '# Orders\n\n## Stack\n' }, { git: true });
    assert.match(cli(bare, ['--outline']).stdout, /^CLAUDE\.md: outline 1\. What this project is - lacks$/m, 'an H1 with no paragraph under it says nothing about the project');
});

test('shadowed: a CLAUDE.md on the seed\'s path keeps .claude/AGENTS.md from loading - unless it imports it or carries the keep marker', () =>
{
    const { shadowedRows } = require('./agents-md-check.js');
    const seed = { '.claude/AGENTS.md': '# Orders\n' };
    // Rows inside the tree only: a CLAUDE.md the machine keeps above its temp dir counts too, and is not this case's.
    const rows = (files, targets = ['.claude/AGENTS.md']) => shadowedRows(tree({ ...seed, ...files }), targets).filter((f) => !f.file.startsWith('../')).map((f) => `${f.file}:${f.line} ${f.kind} ${f.what}`);
    assert.deepStrictEqual(rows({}), [], 'no CLAUDE.md, nothing hides the seed');
    assert.deepStrictEqual(rows({ 'CLAUDE.md': '# Notes\n' }), ['CLAUDE.md:1 shadowed .claude/AGENTS.md']);
    assert.deepStrictEqual(rows({ 'CLAUDE.local.md': 'mine\n', '.claude/CLAUDE.md': 'team\n' }), ['.claude/CLAUDE.md:1 shadowed .claude/AGENTS.md', 'CLAUDE.local.md:1 shadowed .claude/AGENTS.md'], 'every one of the three counts');
    assert.deepStrictEqual(rows({ 'CLAUDE.md': '@.claude/AGENTS.md\n' }), [], 'an import loads it');
    assert.deepStrictEqual(rows({ 'CLAUDE.md': 'See `@.claude/AGENTS.md`.\n\n```\n@.claude/AGENTS.md\n```\n<!-- @.claude/AGENTS.md -->\n' }), ['CLAUDE.md:1 shadowed .claude/AGENTS.md'], 'a code span, a fence and a comment import nothing');
    assert.deepStrictEqual(rows({ 'CLAUDE.md': '@AGENTS.md\n' }), ['CLAUDE.md:1 shadowed .claude/AGENTS.md'], 'importing another file is not importing this one');
    assert.deepStrictEqual(rows({ 'CLAUDE.md': 'Ours. <!-- agents-md-check: keep -->\n' }), [], 'the keep marker is the user\'s choice');
    assert.deepStrictEqual(rows({ 'web/AGENTS.md': '# Web\n', 'web/CLAUDE.md': 'web\n', 'CLAUDE.md': '@.claude/AGENTS.md\n' }, ['.claude/AGENTS.md', 'web/AGENTS.md']), ['web/CLAUDE.md:1 shadowed web/AGENTS.md'], "a part's file is hidden only by its own folder's");
    const parent = tree({ 'CLAUDE.md': 'above\n', 'proj/.claude/AGENTS.md': '# Orders\n' });
    assert.ok(shadowedRows(path.join(parent, 'proj'), ['.claude/AGENTS.md']).some((f) => f.file === '../CLAUDE.md'), 'a folder above the project counts too');
});

test('shadowed: the CLI prints the row with its fix and exits 1; a re-run says the same', () =>
{
    const root = tree({ '.claude/AGENTS.md': '# Orders\n', 'CLAUDE.md': '# Notes\n' }, { git: true });
    const first = cli(root);
    assert.strictEqual(first.status, 1, first.stdout + first.stderr);
    assert.match(first.stdout, /^CLAUDE\.md:1 shadowed: \.claude\/AGENTS\.md - is not loaded while this file sits on its path - import it \(`@\.claude\/AGENTS\.md`\) or set Project instructions to claude-md-and-agents-md in \/config$/m);
    assert.strictEqual(cli(root).stdout, first.stdout, 'read-only: a second run changes nothing');
});
