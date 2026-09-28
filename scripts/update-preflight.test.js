'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name

const SCRIPT = path.join(__dirname, 'update-preflight.js');

// A credential-shaped value, so the 'names only' assertion below is a real test: this is what
// leaked into a transcript twice when the command read the env block with a plain dump.
const FAKE_TOKEN = 'sntrys_' + 'A'.repeat(48);

const FIXTURE = { files: [
    { status: 'modified', filename: 'stack/skills/csharp/SKILL.md' },
    { status: 'modified', filename: 'stack/skills/dotnet/SKILL.md' },
    // a second file of the SAME skill is still one skill changed (measured: skills=108 against 78 shipped)
    { status: 'modified', filename: 'stack/skills/dotnet/references/testing.md' },
    { status: 'modified', filename: 'stack/hooks/model-windows.json' },
    { status: 'modified', filename: 'stack/hooks/guard-secret-value.js' },
    { status: 'added', filename: 'stack/hooks/guard-new-thing.js' },
    { status: 'removed', filename: 'stack/rules/web-conventions.md' },
    { status: 'modified', filename: 'README.md' },
] };

function scaffold({ migrations = [], settings = null, stamp = 'sha: aaa111\nversion: 0.2.60\n', fixture = FIXTURE } = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
    const snap = path.join(root, 'repo');
    fs.mkdirSync(path.join(snap, 'scripts', 'install'), { recursive: true });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'stamp-compare.js'), path.join(snap, 'scripts', 'stamp-compare.js'));
    fs.copyFileSync(path.join(__dirname, 'install', 'source.js'), path.join(snap, 'scripts', 'install', 'source.js'));
    fs.copyFileSync(path.join(__dirname, 'install', 'brand.js'), path.join(snap, 'scripts', 'install', 'brand.js'));
    fs.writeFileSync(path.join(snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.2.70\n');
    fs.writeFileSync(path.join(snap, 'meta', 'migrations.json'), JSON.stringify({ _comment: 'x'.repeat(2000), migrations }));

    const install = path.join(root, 'project');
    fs.mkdirSync(path.join(install, '.claude'), { recursive: true });
    if (stamp !== null) fs.writeFileSync(path.join(install, '.claude', 'alfred-code.stamp'), stamp);
    if (settings) fs.writeFileSync(path.join(install, '.claude', 'settings.json'), JSON.stringify(settings));
    const fixtureFile = path.join(root, 'compare.json');
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture));
    return { snap, install, fixtureFile };
}

function run(args, env = process.env)
{
    try { return { out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env }), code: 0 }; }
    catch (e) { return { out: e.stdout, code: e.status }; }
}

test('ONE call carries the compare contract, the changed classes, the fired migrations and the env key names', () => {
    const { snap, install, fixtureFile } = scaffold({
        migrations: [
            { id: 'inject-code-style-hook-to-rule', detect: { file_exists: '.claude/hooks/inject-code-style.js' } },
            { id: 'docs-path-env-rename', detect: { settings_env_key: 'CLAUDE_DOCS_PATH' } },
        ],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs', SENTRY_ACCESS_TOKEN: FAKE_TOKEN } },
    });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'inject-code-style.js'), '// legacy');

    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(code, 0);
    assert.match(out, /^version: 0\.2\.60 -> 0\.2\.70$/m);
    assert.match(out, /^modified\tstack\/skills\/csharp\/SKILL\.md$/m);
    // the counts the close-out names refreshed paths from - the installer's log tail counts
    // every file it copied, which is all of them on every run
    assert.match(out, /^changed: skills=2 agents=0 rules=1 hooks=3 template=no$/m, 'distinct ITEMS: a skill folder counts once, model-windows.json is a hooks-class file');
    assert.match(out, /^migration: inject-code-style-hook-to-rule\tfile_exists$/m);
    assert.match(out, /^migration: docs-path-env-rename\tsettings_env_key$/m);
    assert.match(out, /^env-keys: CLAUDE_DOCS_PATH,SENTRY_ACCESS_TOKEN$/m);
});

test('an env VALUE never leaves the script - the key names are the whole output', () => {
    const { snap, install, fixtureFile } = scaffold({ settings: { env: { SENTRY_ACCESS_TOKEN: FAKE_TOKEN } } });
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.ok(!out.includes(FAKE_TOKEN), 'the credential value is never printed');
    assert.ok(!out.includes('sntrys_'), 'not even a fragment of it');
    assert.match(out, /^env-keys: SENTRY_ACCESS_TOKEN$/m);
});

test('the maintainer catalog never reaches the caller - only detected ids do', () => {
    const { snap, install, fixtureFile } = scaffold({
        migrations: [{ id: 'never-fires', detect: { file_exists: '.claude/hooks/absent.js' }, why: 'y'.repeat(400) }],
    });
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(out, /^migrations: none detected$/m);
    assert.ok(!out.includes('x'.repeat(50)), 'the catalog _comment stays out of context');
    assert.ok(!out.includes('y'.repeat(50)), 'so does an undetected entry');
});

test('settings_env_value fires only on the exact seeded value; an unknown detect kind never fires', () => {
    const migrations = [
        { id: 'autocompact-seed-dropped', detect: { settings_env_value: { key: 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', equals: '40' } } },
        { id: 'from-the-future', detect: { some_new_kind: 'whatever' } },
    ];
    const hand = scaffold({ migrations, settings: { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '55' } } });
    assert.match(run(['--snapshot', hand.snap, '--root', hand.install, '--fixture', hand.fixtureFile]).out, /^migrations: none detected$/m);

    const seeded = scaffold({ migrations, settings: { env: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' } } });
    const out = run(['--snapshot', seeded.snap, '--root', seeded.install, '--fixture', seeded.fixtureFile]).out;
    assert.match(out, /^migration: autocompact-seed-dropped\tsettings_env_value$/m);
    assert.ok(!out.includes('from-the-future'), 'a detect kind this release does not know never claims a detection');
});

test('settings_env_prefix fires on ANY key under that prefix, and reports the prefix rename', () => {
    const migrations = [{
        id: 'alfred-code-settings-prefix',
        detect: { settings_env_prefix: 'CLAUDE_STACK_' }, // legacy-name
        rename_settings_env_prefix: { from: 'CLAUDE_STACK_', to: 'ALFRED_CODE_' }, // legacy-name
    }];
    const none = scaffold({ migrations, settings: { env: { MY_OWN_APP_KEY: 'x' } } });
    assert.match(run(['--snapshot', none.snap, '--root', none.install, '--fixture', none.fixtureFile]).out, /^migrations: none detected$/m);

    const seeded = scaffold({ migrations, settings: { env: { CLAUDE_STACK_MONITOR: 'log' } } }); // legacy-name
    const out = run(['--snapshot', seeded.snap, '--root', seeded.install, '--fixture', seeded.fixtureFile]).out;
    assert.match(out, /^migration: alfred-code-settings-prefix\tsettings_env_prefix$/m);
    assert.match(out, /^ {2}env-rename-prefix: CLAUDE_STACK_\* -> ALFRED_CODE_\*$/m); // legacy-name
});

test('settings_hook_wired reads the wiring, not a file; the matcher scopes it', () => {
    const migrations = [{ id: 'unwire-one-matcher', detect: { settings_hook_wired: 'guard-stop-contract.js::AskUserQuestion' } }];
    const wired = { hooks: { AskUserQuestion: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js"' }] }] } };
    const a = scaffold({ migrations, settings: wired });
    assert.match(run(['--snapshot', a.snap, '--root', a.install, '--fixture', a.fixtureFile]).out, /^migration: unwire-one-matcher\tsettings_hook_wired$/m);

    const elsewhere = { hooks: { Stop: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-stop-contract.js"' }] }] } };
    const b = scaffold({ migrations, settings: elsewhere });
    assert.match(run(['--snapshot', b.snap, '--root', b.install, '--fixture', b.fixtureFile]).out, /^migrations: none detected$/m);
});

test('the compare exit codes pass through unchanged, and the preflight still reports the rest', () => {
    const { snap, install, fixtureFile } = scaffold({
        stamp: null,
        migrations: [{ id: 'docs-path-env-rename', detect: { settings_env_key: 'CLAUDE_DOCS_PATH' } }],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs' } },
    });
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(code, 2, 'no-stamp is still the refresh-only signal');
    assert.match(out, /^no-stamp$/m);
    assert.match(out, /^migration: docs-path-env-rename\tsettings_env_key$/m, 'a migration detect does not depend on the compare');
    assert.match(out, /^env-keys: CLAUDE_DOCS_PATH$/m);
});

test('the shipped catalog parses under the shipped detect vocabulary - every entry has a known kind', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'migrations.json'), 'utf8'));
    const known = new Set(['file_exists', 'settings_env_key', 'settings_env_value', 'settings_env_prefix', 'settings_hook_wired']);
    for (const e of catalog.migrations)
    {
        const kinds = Object.keys(e.detect || {});
        assert.strictEqual(kinds.length, 1, `${e.id} declares exactly one detect kind`);
        assert.ok(known.has(kinds[0]), `${e.id} uses a detect kind the preflight implements (${kinds[0]})`);
    }
});

test('validate: yes on a multi-release version span (major/minor move, or a patch move over 1)', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: 'sha: aaa111\nversion: 0.2.60\n' });
    fs.writeFileSync(path.join(snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.2.75\n');
    const out = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out;
    assert.match(out, /^validate: yes$/m, 'a 15-patch move spans more than one release');

    const minor = scaffold({ stamp: 'sha: aaa111\nversion: 0.2.60\n' });
    fs.writeFileSync(path.join(minor.snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.3.0\n');
    const outMinor = run(['--snapshot', minor.snap, '--root', minor.install, '--fixture', minor.fixtureFile]).out;
    assert.match(outMinor, /^validate: yes$/m, 'a minor bump is always multi-release, whatever the patch');
});

test('validate: no on a single-release version span, or no span at all', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: 'sha: aaa111\nversion: 0.2.60\n' });
    fs.writeFileSync(path.join(snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.2.61\n');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^validate: no$/m, 'exactly one patch step');

    const same = scaffold({ stamp: 'sha: bbb222\nversion: 0.2.70\n' });
    fs.writeFileSync(path.join(same.snap, 'RELEASE-SOURCE'), 'sha: bbb222\nversion: 0.2.70\n');
    assert.match(run(['--snapshot', same.snap, '--root', same.install, '--fixture', same.fixtureFile]).out, /^validate: no$/m, 'same revision, nothing to validate');
});

test('policy-rev: none when the generated rule is not installed', () => {
    const { snap, install, fixtureFile } = scaffold();
    const out = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out;
    assert.match(out, /^policy-rev: none$/m);
});

test('policy-rev: current when the stamped rev matches the shipped skill; stale otherwise', () => {
    const { snap, install, fixtureFile } = scaffold();
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(snap, 'stack', 'skills', 'alfred-capture-agent-capabilities'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), 'policy-rev: abc123\nsome text');
    fs.writeFileSync(path.join(snap, 'stack', 'skills', 'alfred-capture-agent-capabilities', 'SKILL.md'), 'policy-rev: abc123\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: current$/m);

    fs.writeFileSync(path.join(snap, 'stack', 'skills', 'alfred-capture-agent-capabilities', 'SKILL.md'), 'policy-rev: def456\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=abc123 snapshot=def456$/m);

    fs.writeFileSync(path.join(install, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), 'no rev stamped here');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=none snapshot=def456$/m, 'a rule with no rev at all IS the mismatch, nothing further to check');
});

test('--log mode: restart yes on mcps=<n> above 0 in the installer log, and names each !! line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, [
        '  installed/refreshed this run - skills=12, plugins=6, mcps=5, hooks=11, agents=11, rules=9',
        '!! could not resolve playwright latest - installing unpinned (re-run when online to pin it)',
        '!! playwright-webkit: browser download failed, server not registered',
        'mcp repaired: serena',
    ].join('\n'));
    const { out } = run(['--log', log]);
    assert.match(out, /^restart: yes$/m);
    assert.match(out, /^warn: !! could not resolve playwright latest - installing unpinned \(re-run when online to pin it\)$/m);
    assert.match(out, /^warn: !! playwright-webkit: browser download failed, server not registered$/m);
});

test('--log mode: restart yes on --hooks above 0 even when the log shows mcps=0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, '  installed/refreshed this run - skills=12, plugins=6, mcps=0, hooks=11, agents=11, rules=9');
    assert.match(run(['--log', log, '--hooks', '3']).out, /^restart: yes$/m);
    assert.match(run(['--log', log, '--hooks', '0']).out, /^restart: no$/m);
});

test('--log mode: restart no and no warn lines on a clean, MCP-less, hook-less run', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, '  installed/refreshed this run - skills=12, plugins=6, mcps=0, hooks=0, agents=11, rules=9');
    const { out } = run(['--log', log]);
    assert.match(out, /^restart: no$/m);
    assert.doesNotMatch(out, /^warn: /m);
});

test('a FIRED migration carries everything the caller acts on, so the catalog is never opened', () => {
    // Reading 'just that one entry by id' still pulled the whole catalog into context: measured
    // 2,182 of a 5,180-char read was the maintainer `_comment` - 42%, paid on every update of
    // every consuming project. The fields that matter are printed for the entries that fired.
    const { snap, install, fixtureFile } = scaffold({
        migrations: [
            { id: 'fired-one',
              detect: { file_exists: '.claude/hooks/inject-code-style.js' },
              remove: ['.claude/hooks/inject-code-style.js'],
              unwire_settings_hook: 'inject-code-style.js::PostToolUse',
              why: 'style delivery moved to a generated rule',
              then: 're-run /alfred-capture-code-style' },
            { id: 'env-one',
              detect: { settings_env_key: 'CLAUDE_DOCS_PATH' },
              rename_settings_env: { from: 'CLAUDE_DOCS_PATH', to: 'ALFRED_CODE_DOCS_PATH' },
              why: 'every other variable this stack owns is ALFRED_CODE_*' },
            { id: 'reset-one',
              detect: { settings_env_value: { key: 'ALFRED_CODE_EXAMPLE', equals: 'old' } },
              clear_settings_env: { key: 'ALFRED_CODE_EXAMPLE', when_value: 'old', to: 'new' },
              why: 'a seeded default that turned out wrong is reset only where it still holds the seed' },
            { id: 'quiet-one',
              detect: { file_exists: '.claude/hooks/never-here.js' },
              why: 'this entry did not fire and must print nothing',
              then: 'nothing' },
        ],
        settings: { env: { CLAUDE_DOCS_PATH: '.claude/docs', ALFRED_CODE_EXAMPLE: 'old' } },
    });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'inject-code-style.js'), '// legacy');

    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(out, /^migration: fired-one\tfile_exists$/m, 'the id line is unchanged - existing branches still read');
    assert.match(out, /^ {2}why: style delivery moved to a generated rule$/m, 'the reason the report labels it with');
    assert.match(out, /^ {2}then: re-run \/alfred-capture-code-style$/m, 'the follow-up the report prints');
    assert.match(out, /^ {2}remove: \.claude\/hooks\/inject-code-style\.js$/m, 'what the prune list takes');
    assert.match(out, /^ {2}unwire: inject-code-style\.js::PostToolUse$/m, 'the exact settings.json entry to drop');
    assert.match(out, /^ {2}env-rename: CLAUDE_DOCS_PATH -> ALFRED_CODE_DOCS_PATH$/m, 'the env edit, on the entry that carries one');
    assert.match(out, /^ {2}env-reset: ALFRED_CODE_EXAMPLE: old -> new$/m, 'a seeded default the installers reset, on the entry that carries one');
    assert.doesNotMatch(out, /quiet-one|did not fire/, 'an entry that did not fire costs nothing at all');
    assert.doesNotMatch(out, /xxxx/, 'and the maintainer comment never reaches the caller');
});

// T3: what a release ADDED, classified against THIS install - `new:` lines the update command asks
// from, instead of an FYI the user exits past. The listing is read from a file here; the command
// lets the script capture `claude plugin list --json` itself.
const NEW_FIXTURE = { files: [
    { status: 'added', filename: 'stack/skills/markdown-style/SKILL.md' },
    { status: 'added', filename: 'stack/skills/dotnet-web-backend/SKILL.md' },
    // a new FILE inside an existing skill is no new item
    { status: 'added', filename: 'stack/skills/csharp/references/new-topic.md' },
    { status: 'added', filename: 'stack/agents/code-style-analyzer.md' },
    { status: 'renamed', filename: 'stack/rules/sql-conventions.md' },
    // a name this release does not ship is no item at all
    { status: 'added', filename: 'stack/hooks/hook-prelude.js' },
    { status: 'added', filename: 'stack/hooks/docs-session.js' },
] };

test('new items: a core item arrives, a library item is offered, the user\'s off-state wins', () => {
    const { snap, install, fixtureFile } = scaffold({
        fixture: NEW_FIXTURE,
        settings: { permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] }, env: { ALFRED_CODE_HOOKS_OFF: '' } },
    });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([
        { id: 'alfred-code@envoydev', enabled: true },
        { id: 'claude-stack-aspnet@envoydev', enabled: false },
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    const rows = out.split('\n').filter((l) => l.startsWith('new: '));
    assert.deepStrictEqual(rows.filter((r) => !r.startsWith('new: rule ')), [
        'new: skill markdown-style\tarrives\talfred-code',
        'new: skill dotnet-web-backend\toffer\t-\tleave',
        'new: agent code-style-analyzer\toff\talfred-code',
        'new: hook docs-session\tarrives\talfred-code',
    ]);
    // a renamed line with no old copy on disk is a plain offer; its closure copies a library skill
    // the project lacks, so the recommendation is leave and the copy is named
    assert.match(rows.find((r) => r.startsWith('new: rule sql-conventions')), /^new: rule sql-conventions\toffer\t-\tleave\tcopies=[a-z-]+(,[a-z-]+)*$/);
});

// N6 (re-review): Claude Code puts settings.local.json's env into every process it starts, so a route
// switch the runner keeps there reached the classification as the run's own - while the installer (C5)
// follows settings.json at project and user scope. The preflight reads the routes the installer's way:
// a value only the local file holds yields to settings.json; a shell export it does not hold stands;
// at local scope the local file is the install's own settings and stands too.
test('new items: the routes are read the installer\'s way - a personal switch in settings.local.json yields to settings.json (N6)', () => {
    const fixture = { files: [{ status: 'added', filename: 'stack/skills/markdown-style/SKILL.md' }] };
    const env = { ...process.env, ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const verdict = ({ local, stamp }) =>
    {
        const { snap, install, fixtureFile } = scaffold({ fixture, settings: { env: {} }, ...(stamp ? { stamp } : {}) });
        if (local) fs.writeFileSync(path.join(install, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' } }));
        const listing = path.join(install, 'listing.json');
        fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
        const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing], env);
        return (/^new: skill markdown-style\t.*$/m.exec(out) || [out])[0];
    };
    assert.strictEqual(verdict({ local: true }), 'new: skill markdown-style\tarrives\talfred-code', 'a personal switch decided the committed route');
    assert.match(verdict({ local: false }), /^new: skill markdown-style\toffer\t-/, 'a shell export the local file does not hold is the run\'s own');
    assert.match(verdict({ local: true, stamp: 'sha: aaa111\nversion: 0.2.60\nscope: local\n' }), /^new: skill markdown-style\toffer\t-/, 'at local scope the local file is the install\'s own');
});

test('new items: a library skill the project already copied makes the rule that pulls it the free take', () => {
    const { snap, install, fixtureFile } = scaffold({ fixture: { files: [{ status: 'added', filename: 'stack/rules/sql-conventions.md' }] } });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const before = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    const copies = /^new: rule sql-conventions\toffer\t-\tleave\tcopies=(\S+)$/m.exec(before);
    assert.ok(copies, before);
    for (const name of copies[1].split(','))
    {
        fs.mkdirSync(path.join(install, '.claude', 'skills', name), { recursive: true });
        fs.writeFileSync(path.join(install, '.claude', 'skills', name, 'SKILL.md'), '---\nname: x\n---\n');
    }
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^new: rule sql-conventions\toffer\t-\ttake$/m);
});

test('new items: none added prints `new: none`; an unreadable listing leaves a core item unknown, never offered, and a library item offered', () => {
    const quiet = scaffold({ fixture: { files: [{ status: 'modified', filename: 'stack/skills/csharp/SKILL.md' }] } });
    const r1 = run(['--snapshot', quiet.snap, '--root', quiet.install, '--fixture', quiet.fixtureFile]);
    assert.match(r1.out, /^new: none$/m);

    const blind = scaffold({ fixture: { files: [{ status: 'added', filename: 'stack/skills/markdown-style/SKILL.md' }, { status: 'added', filename: 'stack/skills/dotnet-web-backend/SKILL.md' }] } });
    const bad = path.join(blind.install, 'listing.json');
    fs.writeFileSync(bad, '{ not json');
    const r2 = run(['--snapshot', blind.snap, '--root', blind.install, '--fixture', blind.fixtureFile, '--listing', bad]);
    assert.match(r2.out, /^new: skill markdown-style\tunknown\talfred-code$/m);
    // a library item is a copy, so no plugin listing decides it
    assert.match(r2.out, /^new: skill dotnet-web-backend\toffer\t-\tleave$/m);
});

test('new items: a compare naming no shipped item never calls `claude plugin list`', () => {
    const { snap, install, fixtureFile } = scaffold();   // adds stack/hooks/guard-new-thing.js, which no release ships
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-bin-'));
    const calls = path.join(bin, 'calls.log');
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "$*" >> "${calls}"\nexit 1\n`, { mode: 0o755 });
    try
    {
        const out = execFileSync('node', [SCRIPT, '--snapshot', snap, '--root', install, '--fixture', fixtureFile], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
        assert.match(out, /^new: none$/m);
        assert.ok(!fs.existsSync(calls), 'the CLI was called for nothing');
    }
    catch (e) { if (e.stdout === undefined) throw e; assert.fail(e.stdout); }
    finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

test('new items: a real rename line carries its old name, and an old copy on disk makes it renamed - carried, not offered', () => {
    const { snap, install, fixtureFile } = scaffold({ fixture: { files: [
        { status: 'renamed', filename: 'stack/rules/sql-conventions.md', previous_filename: 'stack/rules/old-sql.md' },
    ] } });
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'old-sql.md'), '# old\n');
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.match(out, /^renamed\tstack\/rules\/sql-conventions\.md\t<- stack\/rules\/old-sql\.md$/m, 'the compare line shape this parser reads');
    assert.match(out, /^new: rule sql-conventions\trenamed\t-\tfrom=old-sql\told-on-disk$/m);
});

// Task 22: a skill the release RENAMED is the same item continuing whether or not the compare saw a
// rename - git reports a rewritten folder as added plus removed - so the snapshot's `renamed` map
// names its old spelling: a library copy on disk is carried (renamed), never offered, and a core one
// arrives. The old names come from the map, never spelled here.
test('new items: the snapshot\'s renamed map names the old spelling when the compare saw only an add', () => {
    const { loadManifest } = require('./install/manifest.js');
    const renamed = loadManifest(path.join(__dirname, '..')).renamed;
    const oldOf = (to) => Object.keys(renamed.skills).find((k) => renamed.skills[k] === to);
    const { snap, install, fixtureFile } = scaffold({ fixture: { files: [
        { status: 'added', filename: 'stack/skills/alfred-capture-related-projects/SKILL.md' },
        { status: 'added', filename: 'stack/skills/alfred-task-solve/SKILL.md' },
    ] } });
    fs.writeFileSync(path.join(snap, 'meta', 'stack-manifest.json'), JSON.stringify({ renamed }));
    const old = oldOf('alfred-capture-related-projects');
    fs.mkdirSync(path.join(install, '.claude', 'skills', old), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'skills', old, 'SKILL.md'), `---\nname: ${old}\n---\n`);
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, new RegExp(`^new: skill alfred-capture-related-projects\\trenamed\\t-\\tfrom=${old}\\told-on-disk$`, 'm'), out);
    assert.match(out, new RegExp(`^new: skill alfred-task-solve\\tarrives\\talfred-code\\tfrom=${oldOf('alfred-task-solve')}$`, 'm'), out);
});

// M8 (Task 22 fix round 1): a renamed library item whose OLD name the stamp's picks never named and the
// disk never held was declined under that name - offering it under the new one presents a declined item
// as new. A picked old name with no copy is still offered, and a stamp with no picks line judges nothing.
test('new items: a renamed library item the stamp never picked, with no old copy, is not offered as new', () => {
    const { loadManifest } = require('./install/manifest.js');
    const renamed = loadManifest(path.join(__dirname, '..')).renamed;
    const old = Object.keys(renamed.skills).find((k) => renamed.skills[k] === 'alfred-capture-related-projects');
    const fixture = { files: [{ status: 'added', filename: 'stack/skills/alfred-capture-related-projects/SKILL.md' }] };
    const newLines = (stamp) =>
    {
        const { snap, install, fixtureFile } = scaffold({ fixture, stamp });
        fs.writeFileSync(path.join(snap, 'meta', 'stack-manifest.json'), JSON.stringify({ renamed }));
        const listing = path.join(install, 'listing.json');
        fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
        const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
        assert.strictEqual(code, 0, out);
        return out.split('\n').filter((l) => l.startsWith('new:')).join('\n');
    };
    const base = 'sha: aaa111\nversion: 0.2.60\n';
    assert.strictEqual(newLines(`${base}picked-skills: markdown-style@alfred-code\n`), 'new: none',
        'an old name the picks never named, with no copy, is not offered under its new one');
    assert.match(newLines(`${base}picked-skills: ${old}\n`), new RegExp(`^new: skill alfred-capture-related-projects\\toffer\\t.*from=${old}`, 'm'),
        'a picked old name with no copy on disk is still offered');
    assert.match(newLines(base), /^new: skill alfred-capture-related-projects\toffer\t/m,
        'a stamp with no picks line judges nothing - still an offer');
});

test('new items: global mode reads the account dir itself - its settings.json, not <account>/.claude/', () => {
    const { snap, install, fixtureFile } = scaffold({ fixture: { files: [{ status: 'added', filename: 'stack/agents/code-style-analyzer.md' }] } });
    const acct = path.join(install, '.claude-work');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'settings.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] } }));
    fs.copyFileSync(path.join(install, '.claude', 'alfred-code.stamp'), path.join(acct, 'alfred-code.stamp'));
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out } = run(['--snapshot', snap, '--root', acct, '--fixture', fixtureFile, '--listing', listing]);
    assert.match(out, /^new: agent code-style-analyzer\toff\talfred-code$/m, out);
});

test('new items: an arriving rename still names its old copy for the prune; None holds while the core is listed, whatever its flag', () => {
    const { snap, install, fixtureFile } = scaffold({
        stamp: 'sha: aaa111\nversion: 0.2.60\nshipped-hooks: guard-read-whole-file\n',
        settings: { env: { ALFRED_CODE_HOOKS_OFF: 'guard-read-whole-file' } },
        fixture: { files: [
            { status: 'renamed', filename: 'stack/rules/baseline-memory.md', previous_filename: 'stack/rules/old-memory.md' },
            { status: 'added', filename: 'stack/hooks/docs-session.js' },
        ] },
    });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(snap, 'meta', 'recommendations.json'), JSON.stringify({ always: { rules: ['baseline-memory'] } }));
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'old-memory.md'), '# old\n');
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const on = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(on, /^new: rule baseline-memory\tarrives\t-\tfrom=old-memory\told-on-disk$/m, on);
    assert.match(on, /^new: hook docs-session\toff\talfred-code$/m, 'None held');
    // The core carrying the hooks is locked on: its listing flag can read false while it runs (S22),
    // and the installer's read-back holds the None the same way.
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: false }]));
    const stale = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(stale, /^new: hook docs-session\toff\talfred-code$/m, 'None held - the flag is not the hook state');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'serena@envoydev', enabled: true }]));
    const absent = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(absent, /^new: hook docs-session\tarrives\talfred-code$/m, 'no core listed: the installer installs it and writes no hook none - the hook arrives');
    // A leftover 1.x hooks id says nothing on its own: the hooks ride the core.
    fs.writeFileSync(listing, JSON.stringify([{ id: 'serena@envoydev', enabled: true }, { id: 'claude-stack-hooks@envoydev', enabled: true }])); // legacy-name
    const alias = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(alias, /^new: hook docs-session\tarrives\talfred-code$/m, 'the hooks alias is no hooks home');
});

test('new items: a stale disabled flag on the core changes no verdict - a core item arrives, a denied seat stays off (S22)', () => {
    const { snap, install, fixtureFile } = scaffold({
        fixture: NEW_FIXTURE,
        settings: { permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] }, env: { ALFRED_CODE_HOOKS_OFF: '' } },
    });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: false }]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.deepStrictEqual(out.split('\n').filter((l) => l.startsWith('new: ') && !l.startsWith('new: rule ')), [
        'new: skill markdown-style\tarrives\talfred-code',
        'new: skill dotnet-web-backend\toffer\t-\tleave',
        'new: agent code-style-analyzer\toff\talfred-code',
        'new: hook docs-session\tarrives\talfred-code',
    ]);
});

// A 1.x install as 2.0.0's update first meets it: the stamp under its old name, every stack row
// under the old marketplace KEY (a registered key never changes), the core, the hooks id and the
// seat deny under the old names. The preflight must read all four, or it reports no stamp, reads the listing
// as empty, and offers items the project already carries.
test('new items: a 1.x install is read under its old stamp, marketplace key, core and deny', () => {
    const { snap, install, fixtureFile } = scaffold({
        stamp: null,
        fixture: NEW_FIXTURE,
        settings: { permissions: { deny: ['Agent(claude-stack:code-style-analyzer)'] } }, // legacy-name
    });
    fs.writeFileSync(path.join(install, '.claude', 'claude-stack.stamp'), 'sha: aaa111\nversion: 1.3.0\nshipped-hooks: guard-read-whole-file\n'); // legacy-name
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([
        { id: 'claude-stack@claude-stack', enabled: true }, // legacy-name
        { id: 'claude-stack-hooks@claude-stack', enabled: true }, // legacy-name
        { id: 'alfred-code@envoydev', enabled: false },   // another account's leftover: never the stack this project runs
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^version: 1\.3\.0 -> 0\.2\.70$/m, 'the 1.x stamp is the compare base');
    const rows = out.split('\n').filter((l) => l.startsWith('new: ') && !l.startsWith('new: rule '));
    assert.deepStrictEqual(rows, [
        'new: skill markdown-style\tarrives\talfred-code',
        'new: skill dotnet-web-backend\toffer\t-\tleave',
        'new: agent code-style-analyzer\toff\talfred-code',
        'new: hook docs-session\tarrives\talfred-code',
    ]);
    // an explicit --marketplace still wins over what the listing says: a key no core row is listed
    // under reads the core as absent, so its item is only offered (a listed core is never parked by
    // its flag any more - S22 - so the leftover's disabled row cannot show the forcing)
    const forced = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing, '--marketplace', 'elsewhere']).out;
    assert.match(forced, /^new: skill markdown-style\toffer\t/m, forced);
});

test('global mode: an account dir holding only the 1.x stamp is still the account dir', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: null, fixture: { files: [] } });
    const acct = path.join(path.dirname(install), 'acct-any-name');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'claude-stack.stamp'), 'sha: aaa111\nversion: 1.3.0\n'); // legacy-name
    const { out, code } = run(['--snapshot', snap, '--root', acct, '--fixture', fixtureFile]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^version: 1\.3\.0 -> 0\.2\.70$/m);
});

// A 1.x settings file spells the switch-off CLAUDE_STACK_HOOKS_OFF until the installer's env pass // legacy-name
// renames it - which runs AFTER this preflight. The walk's None, and a hook named off, hold under it.
test('new items: a 1.x CLAUDE_STACK_HOOKS_OFF is the switch-off - the None holds, a named hook is off', () => { // legacy-name
    const fixture = { files: [{ status: 'added', filename: 'stack/hooks/docs-session.js' }] };
    const none = scaffold({ stamp: 'sha: aaa111\nversion: 1.3.0\nshipped-hooks: guard-read-whole-file\n', fixture,
        settings: { env: { CLAUDE_STACK_HOOKS_OFF: 'guard-read-whole-file' } } }); // legacy-name
    const listing = path.join(none.install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const held = run(['--snapshot', none.snap, '--root', none.install, '--fixture', none.fixtureFile, '--listing', listing]).out;
    assert.match(held, /^new: hook docs-session\toff\talfred-code$/m, `the None held: ${held}`);
    const named = scaffold({ stamp: 'sha: aaa111\nversion: 1.3.0\nshipped-hooks: guard-read-whole-file,other-hook\n', fixture,
        settings: { env: { CLAUDE_STACK_HOOKS_OFF: 'docs-session' } } }); // legacy-name
    fs.writeFileSync(path.join(named.install, 'listing.json'), fs.readFileSync(listing));
    const off = run(['--snapshot', named.snap, '--root', named.install, '--fixture', named.fixtureFile, '--listing', path.join(named.install, 'listing.json')]).out;
    assert.match(off, /^new: hook docs-session\toff\talfred-code$/m, `the named hook is off: ${off}`);
});

// `claude plugin list --json` prints every project's project-scope rows. Another project on the same
// account may run the core under the other key - the key is this project's, read from its own rows.
test('new items: the key comes from THIS project\'s rows, never another project\'s', () => {
    const { snap, install, fixtureFile } = scaffold({ fixture: NEW_FIXTURE });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([
        { id: 'alfred-code@envoydev', enabled: true, scope: 'project', projectPath: path.join(path.dirname(install), 'other-project') },
        { id: 'alfred-code@claude-stack', enabled: true, scope: 'project', projectPath: install }, // legacy-name
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^new: skill markdown-style\tarrives\talfred-code$/m, out);
    assert.match(out, /^new: hook docs-session\tarrives\talfred-code$/m, out);
});

// I8 (R51): a 1.x GLOBAL install kept its stamp in the account dir, and the installer moves it into the
// project only on the update this preflight runs BEFORE. Reading the project alone exited 'no stamp'
// (2), and the command routed away before the migration could run. Only while the project has no stamp.
test('a 1.x global install\'s account stamp is the baseline until the update moves it (I8)', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: null, fixture: { files: [] } });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'docs.js'), '');
    const acct = path.join(path.dirname(install), 'acct');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'claude-stack.stamp'), 'sha: aaa111\nversion: 1.3.0\nscope: global\n'); // legacy-name
    const env = { ...process.env, CLAUDE_CONFIG_DIR: acct };
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^version: 1\.3\.0 -> 0\.2\.70$/m, out);
    assert.match(out, /^legacy-stamp: .*claude-stack\.stamp - a 1\.x global install; this update moves it into the project$/m, out); // legacy-name

    // The project's own stamp, once it has one, wins - the account copy stays for other projects.
    fs.writeFileSync(path.join(install, '.claude', 'alfred-code.stamp'), 'sha: aaa111\nversion: 2.0.0\n');
    const own = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env);
    assert.match(own.out, /^version: 2\.0\.0 -> 0\.2\.70$/m, own.out);
    assert.doesNotMatch(own.out, /^legacy-stamp:/m);

    // No account stamp either: still the plain 'no stamp' exit.
    const bare = scaffold({ stamp: null, fixture: { files: [] } });
    const none = run(['--snapshot', bare.snap, '--root', bare.install, '--fixture', bare.fixtureFile], { ...process.env, CLAUDE_CONFIG_DIR: path.join(path.dirname(bare.install), 'empty-acct') });
    assert.strictEqual(none.code, 2, none.out);
});

// M4 (Task 16 review, R54): a switch-off that lives in settings.local.json - a local-scope install's
// deny, or its ALFRED_CODE_HOOKS_OFF - is the user's off-state too; the classification reads both files
// the way Claude Code lays them (env key by key, the local file winning; deny combined).
test('new items: a deny or a hooks-off in settings.local.json is the user\'s off-state too (M4)', () => {
    const fixture = { files: [{ status: 'added', filename: 'stack/agents/code-style-analyzer.md' }, { status: 'added', filename: 'stack/hooks/docs-session.js' }] };
    const { snap, install, fixtureFile } = scaffold({ fixture, settings: { env: { ALFRED_CODE_HOOKS_OFF: '' } } });
    fs.writeFileSync(path.join(install, '.claude', 'settings.local.json'), JSON.stringify({
        permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] }, env: { ALFRED_CODE_HOOKS_OFF: 'docs-session' },
    }));
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^new: agent code-style-analyzer\toff\talfred-code$/m, out);
    assert.match(out, /^new: hook docs-session\toff\talfred-code$/m, out);
});

// R99 (Task 18b fix round 2): at project and user scope the update migrates a STACK key
// settings.local.json holds as well (the writer's overlay), so the preflight reports that migration too.
// A key of the local file that is not the stack's is never the run's to migrate.
test('migrations: at project scope a stack key settings.local.json holds is detected too, never its other keys (R99)', () => {
    const migrations = [
        { id: 'fresh-session-default-reseed', detect: { settings_env_value: { key: 'ALFRED_CODE_FRESH_SESSION_DEFAULT', equals: '250000' } } },
        { id: 'autocompact-seed-dropped', detect: { settings_env_value: { key: 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE', equals: '40' } } },
    ];
    const { snap, install, fixtureFile } = scaffold({ migrations, stamp: 'sha: aaa111\nversion: 0.2.60\nscope: project\n', settings: { env: { SHARED_ONLY: '1' } } });
    fs.writeFileSync(path.join(install, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_FRESH_SESSION_DEFAULT: '250000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '40' } }));
    const out = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out;
    assert.match(out, /^migration: fresh-session-default-reseed\tsettings_env_value$/m, out);
    assert.ok(!/^migration: autocompact-seed-dropped/m.test(out), 'a non-stack key of the local file is not the run\'s to migrate');
    assert.match(out, /^env-keys: SHARED_ONLY$/m, 'the before-state is still the file the run writes');
});

// The env-keys before-state is the file THIS run writes: settings.local.json at local scope (the
// stamp's `scope:` line), settings.json at every other.
test('env-keys: the before-state is the file the run writes - settings.local.json at local scope', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: 'sha: aaa111\nversion: 0.2.60\nscope: local\n', settings: { env: { SHARED_ONLY: '1' } } });
    fs.writeFileSync(path.join(install, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: '/x' } }));
    const local = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(local.out, /^env-keys: ALFRED_CODE_MEMORY_DB$/m, local.out);
    fs.writeFileSync(path.join(install, '.claude', 'alfred-code.stamp'), 'sha: aaa111\nversion: 0.2.60\nscope: project\n');
    const shared = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(shared.out, /^env-keys: SHARED_ONLY$/m, shared.out);
});

// Task 3 (2.1.0): an unstamped legacy copy-route install (`stamp.js state` reads `legacy-unstamped`) takes
// update's normal path, so its docs under the old default are OFFERED the move like any older install's -
// 'no install record' let the default change under them silently. A tree with no stack signature stays a
// fresh project with nothing to offer.
test('docs-move: an unstamped legacy install is offered the move; a tree with no stack signature is not', () => {
    const legacyKey = { CLAUDE_STACK_DOCS_PATH: '.claude/docs' }; // legacy-name
    const { snap, install, fixtureFile } = scaffold({ stamp: null, settings: { env: legacyKey } });
    fs.mkdirSync(path.join(install, '.claude', 'docs', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# arch\n');
    const bare = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(bare.out, /^docs-move: none \(no install record - a fresh install takes the new default\)$/m, 'one signature is no install');
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'guard-catastrophic-rm.js'), '// old\n');
    const legacy = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(legacy.code, 2, 'still no stamp to compare');
    assert.match(legacy.out, /^docs-move: offer \.claude\/docs -> \.alfred\/docs\ttracked=0 untracked=1$/m, legacy.out);
});
