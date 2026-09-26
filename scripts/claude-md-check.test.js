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
    assert.deepStrictEqual(run(root, 'Copy `.env.example` to `.env`.', { ignored: ['.env', '.env.example'] }), []);
    assert.deepStrictEqual(kinds(run(root, 'Copy `.env.example` to `.env`.', { ignored: ['.env'] })), ['1 path .env.example']);
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
    assert.deepStrictEqual(kinds(run(root, text)), ['1 placeholder __PROJECT_NAME__', '3 todo TODO', '5 placeholder __DOCS_ROOT__']);
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

// The installer seeds the template as .claude/CLAUDE.md: on a project whose captures all ran, only the
// unfilled H1 is left; a GENERATED row whose capture never ran names files that are not there.
test('cli: the shipped template, seeded untouched, is flagged by its placeholder alone - and a skipped capture\'s row by its files', () =>
{
    const template = fs.readFileSync(path.join(__dirname, '..', 'stack', 'CLAUDE.template.md'), 'utf8');
    const rules = ['baseline-interaction', 'baseline-quality-gates', 'baseline-security', 'baseline-git', 'baseline-navigation', 'baseline-docs-root', 'baseline-memory',
        'baseline-project-agent-capabilities', 'baseline-project-architecture', 'baseline-project-related-context', 'project-code-style'];
    const files = { '.claude/CLAUDE.md': template, '.claude/docs/code-style/CODE-STYLE.md': '' };
    for (const r of rules) files[`.claude/rules/${r}.md`] = '';
    const root = tree(files, { git: true });
    const r = cli(root);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n').map((l) => l.replace(/ - .*/, '')), ['.claude/CLAUDE.md:1 placeholder: __PROJECT_NAME__', 'claude-md-check: 1 finding(s) in 1 file(s)']);
    fs.rmSync(path.join(root, '.claude/rules/project-code-style.md'));
    fs.rmSync(path.join(root, '.claude/docs/code-style'), { recursive: true });
    const skipped = cli(root).stdout.trim().split('\n').map((l) => l.replace(/:\d+ /, ' ').replace(/ - .*/, ''));
    assert.deepStrictEqual(skipped.slice(1, -1), ['.claude/CLAUDE.md path: project-code-style.md', '.claude/CLAUDE.md path: .claude/rules/project-code-style.md',
        '.claude/CLAUDE.md path: .claude/docs/code-style/CODE-STYLE.md'], 'the intro line and the row both name the capture that never ran');
});
