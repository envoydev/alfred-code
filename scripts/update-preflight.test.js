'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
    fs.mkdirSync(path.join(snap, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'stamp-compare.js'), path.join(snap, 'scripts', 'stamp-compare.js'));
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

function run(args)
{
    try { return { out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' }), code: 0 }; }
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
        detect: { settings_env_prefix: 'CLAUDE_STACK_' },
        rename_settings_env_prefix: { from: 'CLAUDE_STACK_', to: 'ALFRED_CODE_' },
    }];
    const none = scaffold({ migrations, settings: { env: { MY_OWN_APP_KEY: 'x' } } });
    assert.match(run(['--snapshot', none.snap, '--root', none.install, '--fixture', none.fixtureFile]).out, /^migrations: none detected$/m);

    const seeded = scaffold({ migrations, settings: { env: { CLAUDE_STACK_MONITOR: 'log' } } });
    const out = run(['--snapshot', seeded.snap, '--root', seeded.install, '--fixture', seeded.fixtureFile]).out;
    assert.match(out, /^migration: alfred-code-settings-prefix\tsettings_env_prefix$/m);
    assert.match(out, /^ {2}env-rename-prefix: CLAUDE_STACK_\* -> ALFRED_CODE_\*$/m);
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
    fs.mkdirSync(path.join(snap, 'stack', 'skills', 'project-agent-capabilities'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), 'policy-rev: abc123\nsome text');
    fs.writeFileSync(path.join(snap, 'stack', 'skills', 'project-agent-capabilities', 'SKILL.md'), 'policy-rev: abc123\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: current$/m);

    fs.writeFileSync(path.join(snap, 'stack', 'skills', 'project-agent-capabilities', 'SKILL.md'), 'policy-rev: def456\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=abc123 snapshot=def456$/m);

    fs.writeFileSync(path.join(install, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), 'no rev stamped here');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=none snapshot=def456$/m, 'a rule with no rev at all IS the mismatch, nothing further to check');
});

test('--log mode: restart yes on mcps=<n> above 0 in the installer log, and names each !! line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, [
        '  installed/refreshed this run - skills=12, plugins=6, mcps=5, hooks=11, agents=11, rules=9',
        '!! sentry: SENTRY_ACCESS_TOKEN missing, registration still written',
        '!! playwright-webkit: browser download failed, server not registered',
        'mcp repaired: serena',
    ].join('\n'));
    const { out } = run(['--log', log]);
    assert.match(out, /^restart: yes$/m);
    assert.match(out, /^warn: !! sentry: SENTRY_ACCESS_TOKEN missing, registration still written$/m);
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
              then: 're-run /project-code-style-analyzer' },
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
    assert.match(out, /^ {2}then: re-run \/project-code-style-analyzer$/m, 'the follow-up the report prints');
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
        { id: 'alfred-code@envoydev', enabled: true }, { id: 'alfred-code-hooks@envoydev', enabled: true },
        { id: 'claude-stack-aspnet@envoydev', enabled: false },
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    const rows = out.split('\n').filter((l) => l.startsWith('new: '));
    assert.deepStrictEqual(rows.filter((r) => !r.startsWith('new: rule ')), [
        'new: skill markdown-style\tarrives\talfred-code',
        'new: skill dotnet-web-backend\toffer\t-\tleave',
        'new: agent code-style-analyzer\toff\talfred-code',
        'new: hook docs-session\tarrives\talfred-code-hooks',
    ]);
    // a renamed line with no old copy on disk is a plain offer; its closure copies a library skill
    // the project lacks, so the recommendation is leave and the copy is named
    assert.match(rows.find((r) => r.startsWith('new: rule sql-conventions')), /^new: rule sql-conventions\toffer\t-\tleave\tcopies=[a-z-]+(,[a-z-]+)*$/);
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

test('new items: an arriving rename still names its old copy for the prune; None holds only while the hooks entry is enabled', () => {
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
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }, { id: 'alfred-code-hooks@envoydev', enabled: true }]));
    const on = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(on, /^new: rule baseline-memory\tarrives\t-\tfrom=old-memory\told-on-disk$/m, on);
    assert.match(on, /^new: hook docs-session\toff\talfred-code-hooks$/m, 'None held');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }, { id: 'alfred-code-hooks@envoydev', enabled: false }]));
    const parked = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(parked, /^new: hook docs-session\tarrives\talfred-code-hooks$/m, 'the installer enables the hooks entry and writes no hook none there - the hook arrives');
});
