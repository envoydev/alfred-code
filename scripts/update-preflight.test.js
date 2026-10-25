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
    fs.mkdirSync(path.join(snap, 'scripts', 'install'), { recursive: true });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'stamp-compare.js'), path.join(snap, 'scripts', 'stamp-compare.js'));
    fs.copyFileSync(path.join(__dirname, 'install', 'source.js'), path.join(snap, 'scripts', 'install', 'source.js'));
    fs.copyFileSync(path.join(__dirname, 'install', 'brand.js'), path.join(snap, 'scripts', 'install', 'brand.js'));
    // The compare makes its stdio blocking through the prelude a release snapshot carries beside it.
    fs.mkdirSync(path.join(snap, 'stack', 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js'), path.join(snap, 'stack', 'hooks', 'hook-prelude.js'));
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
            { id: 'fresh-session-pct-retired', detect: { settings_env_key: 'ALFRED_CODE_FRESH_SESSION_PCT' } },
        ],
        settings: { env: { ALFRED_CODE_FRESH_SESSION_PCT: '60', SENTRY_ACCESS_TOKEN: FAKE_TOKEN } },
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
    assert.match(out, /^migration: fresh-session-pct-retired\tsettings_env_key$/m);
    assert.match(out, /^env-keys: ALFRED_CODE_FRESH_SESSION_PCT,SENTRY_ACCESS_TOKEN$/m);
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

test('settings_env_all fires only when every key holds the value, and names the off edit', () => {
    const migrations = [{ id: 'default-off-with-the-tiers',
        detect: { settings_env_all: { keys: ['ALFRED_CODE_A', 'ALFRED_CODE_B'], equals: '0' } },
        off_settings_env: { key: 'ALFRED_CODE_C', with: ['ALFRED_CODE_A', 'ALFRED_CODE_B'], when_value: ['300000', '180000'], to: '0' } }];
    for (const env of [{ ALFRED_CODE_A: '0', ALFRED_CODE_B: '5' }, { ALFRED_CODE_A: '0' }, {}])
    {
        const s = scaffold({ migrations, settings: { env } });
        assert.match(run(['--snapshot', s.snap, '--root', s.install, '--fixture', s.fixtureFile]).out, /^migrations: none detected$/m, JSON.stringify(env));
    }
    const all = scaffold({ migrations, settings: { env: { ALFRED_CODE_A: '0', ALFRED_CODE_B: '0' } } });
    const out = run(['--snapshot', all.snap, '--root', all.install, '--fixture', all.fixtureFile]).out;
    assert.match(out, /^migration: default-off-with-the-tiers\tsettings_env_all$/m, out);
    assert.match(out, /^ {2}env-off: ALFRED_CODE_C: 300000 \| 180000 \| absent -> 0 \(with ALFRED_CODE_A, ALFRED_CODE_B at 0\)$/m, out);
});

test('a BOM-prefixed settings.json is read like any other (audit F5)', () => {
    const migrations = [{ id: 'fresh-session-pct-retired', detect: { settings_env_key: 'ALFRED_CODE_FRESH_SESSION_PCT' } }];
    const bom = scaffold({ migrations });
    fs.writeFileSync(path.join(bom.install, '.claude', 'settings.json'), `\uFEFF${JSON.stringify({ env: { ALFRED_CODE_FRESH_SESSION_PCT: '60' } })}`);
    const out = run(['--snapshot', bom.snap, '--root', bom.install, '--fixture', bom.fixtureFile]).out;
    assert.match(out, /^migration: fresh-session-pct-retired\tsettings_env_key$/m, out);
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
        migrations: [{ id: 'fresh-session-pct-retired', detect: { settings_env_key: 'ALFRED_CODE_FRESH_SESSION_PCT' } }],
        settings: { env: { ALFRED_CODE_FRESH_SESSION_PCT: '60' } },
    });
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(code, 2, 'no-stamp is still the refresh-only signal');
    assert.match(out, /^no-stamp$/m);
    assert.match(out, /^migration: fresh-session-pct-retired\tsettings_env_key$/m, 'a migration detect does not depend on the compare');
    assert.match(out, /^env-keys: ALFRED_CODE_FRESH_SESSION_PCT$/m);
});

test('the shipped catalog parses under the shipped detect vocabulary - every entry has a known kind', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'migrations.json'), 'utf8'));
    const known = new Set(['file_exists', 'settings_env_key', 'settings_env_value', 'settings_env_all', 'settings_hook_wired']);
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

// The shipped policy is the awareness capture's agents reference; the installed one its doc, or a rule it replaced.
const policyAt = (snap) =>
{
    const f = path.join(snap, 'stack', 'skills', 'capture-awareness', 'references', 'agents.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    return f;
};

test('policy-rev: current when the stamped rev matches the shipped skill; stale otherwise', () => {
    const { snap, install, fixtureFile } = scaffold();
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'alfred-agent-awareness.md'), 'policy-rev: abc123\nsome text');
    fs.writeFileSync(policyAt(snap), 'policy-rev: abc123\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: current$/m);

    fs.writeFileSync(policyAt(snap), 'policy-rev: def456\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=abc123 snapshot=def456$/m);

    fs.writeFileSync(path.join(install, '.claude', 'rules', 'alfred-agent-awareness.md'), 'no rev stamped here');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: stale installed=none snapshot=def456$/m, 'a rule with no rev at all IS the mismatch, nothing further to check');

    // The awareness doc, once the update has written it, is read before any rule it replaced.
    fs.mkdirSync(path.join(install, '.alfred', 'docs', 'awareness'), { recursive: true });
    fs.writeFileSync(path.join(install, '.alfred', 'docs', 'awareness', 'AGENTS-AWARENESS.md'), 'policy-rev: def456\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: current$/m, 'the doc answers first');
});

test('policy-rev: an install still holding the pre-2.1.6 file name is read, not reported as none', () => {
    const { snap, install, fixtureFile } = scaffold();
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), 'policy-rev: abc123\nsome text');
    fs.writeFileSync(policyAt(snap), 'policy-rev: abc123\nsome text');
    assert.match(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out, /^policy-rev: current$/m);
});

test('--log mode: restart yes on a repaired registration in the installer log, and names each !! line', () => {
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

// audit 2026-10-10, session 229e2715: `restart: yes` on an update that changed nothing the session holds. The summary's
// `mcps=<n>` is the selection's size, printed on every run (measured 3 on the plugin route and on the MCP copy route
// alike), and the delta's `--hooks 3` counted although the stamp read `hooks-route: plugin` and the session already ran
// that release's hooks from the plugin cache.
const SNAP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
function logCase(lines, { route = 'plugin', running = SNAP_VERSION } = {})
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, ['==>   installed/refreshed this run - skills=31, plugins=0, mcps=3, hooks=18, agents=0, rules=9', ...lines].join('\n'));
    fs.mkdirSync(path.join(dir, 'project', '.claude'), { recursive: true });
    if (route) fs.writeFileSync(path.join(dir, 'project', '.claude', 'alfred-code.stamp'), `version: ${SNAP_VERSION}\nhooks-route: ${route}\n`);
    const plugin = path.join(dir, 'cache', 'alfred-code', String(running));
    if (running) { fs.mkdirSync(path.join(plugin, 'setup-plugin', '.claude-plugin'), { recursive: true }); fs.writeFileSync(path.join(plugin, 'setup-plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: running })); }
    return (extra = []) => (/^restart: (yes|no)$/m.exec(run(['--log', log, '--root', path.join(dir, 'project'), ...(running ? ['--running', plugin] : []), ...extra]).out) || [])[1];
}

test('--log mode: the summary\'s selection count alone is no restart', () => {
    assert.strictEqual(logCase([])(), 'no', 'mcps=3 is the selection, not a registration');
    assert.strictEqual(logCase(['==>   plugin alfred-code: 2.2.2 (already newest)', '==> plugin update [project]: alfred-code@envoydev'])(), 'no');
});

test('--log mode: every line that changed what the session loaded is a restart', () => {
    for (const line of [
        '==> mcp [project]: alfred-navigation', '==>   mcp repaired: alfred-memory (local scope)', '==>   mcp pruned: browser',
        '==>   mcp removed: chrome-control (.mcp.json)', '==> mcp refreshed [user]: alfred-memory (this release\'s shape)',
        '==> plugin install [project]: alfred-navigation@envoydev', '==> plugin enable [project]: alfred-memory@envoydev (installed but disabled)',
        '==>   !! plugin disabled [local]: chrome-control@envoydev (the copy route registers it)', '==> plugin uninstalled [project]: typescript-lsp@claude-plugins-official (no longer picked)',
        '==> plugin moved [local -> project]: claude-hud@claude-hud', '==>   plugin pruned (retired upstream) [project]: ponytail@ponytail',
        '==>   renamed: plugin navigation@envoydev -> alfred-navigation@envoydev [project]', '==>   plugin alfred-navigation: 2.2.1 -> 2.2.2',
        '==>   plugin claude-hud: 0.0.9 (installed this run)',
    ]) assert.strictEqual(logCase([line])(), 'yes', line);
});

test('--log mode: a hook delta owes a restart only where the session does not already run those hooks', () => {
    assert.strictEqual(logCase([])(['--hooks', '3']), 'no', 'plugin route, the session on the snapshot\'s release: the new hooks are live');
    assert.strictEqual(logCase([], { running: '0.0.1' })(['--hooks', '3']), 'yes', 'the session loaded another release');
    assert.strictEqual(logCase([], { running: '0.0.1' })(), 'yes', 'another release: its commands and server plugins are older too');
    assert.strictEqual(logCase([], { route: 'copy' })(['--hooks', '3']), 'yes', 'the copy route\'s hooks are copies, not the plugin\'s');
    assert.strictEqual(logCase([], { route: null })(['--hooks', '3']), 'yes', 'no stamp: the route is unknown');
    assert.strictEqual(logCase([], { running: null })(['--hooks', '3']), 'yes', 'no --running: the session\'s release is unknown');
    assert.strictEqual(logCase([])(['--hooks', '0']), 'no');
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
              then: 're-run /capture-project-code-style' },
            { id: 'env-one',
              detect: { settings_env_key: 'ALFRED_CODE_OLD_KEY' },
              rename_settings_env: { from: 'ALFRED_CODE_OLD_KEY', to: 'ALFRED_CODE_NEW_KEY' },
              why: 'the key was renamed' },
            { id: 'reset-one',
              detect: { settings_env_value: { key: 'ALFRED_CODE_EXAMPLE', equals: 'old' } },
              clear_settings_env: { key: 'ALFRED_CODE_EXAMPLE', when_value: 'old', to: 'new' },
              why: 'a seeded default that turned out wrong is reset only where it still holds the seed' },
            { id: 'fold-one',
              detect: { settings_env_key: 'ALFRED_CODE_FOLDED' },
              fold_settings_env: { key: 'ALFRED_CODE_FOLDED', when_value: '0', into: 'ALFRED_CODE_HOOKS_OFF', entry: 'some-hook:part' },
              why: 'an on/off key folded into the hooks csv' },
            { id: 'quiet-one',
              detect: { file_exists: '.claude/hooks/never-here.js' },
              why: 'this entry did not fire and must print nothing',
              then: 'nothing' },
        ],
        settings: { env: { ALFRED_CODE_OLD_KEY: '1', ALFRED_CODE_EXAMPLE: 'old', ALFRED_CODE_FOLDED: '0' } },
    });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'inject-code-style.js'), '// legacy');

    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(out, /^migration: fired-one\tfile_exists$/m, 'the id line is unchanged - existing branches still read');
    assert.match(out, /^ {2}why: style delivery moved to a generated rule$/m, 'the reason the report labels it with');
    assert.match(out, /^ {2}then: re-run \/capture-project-code-style$/m, 'the follow-up the report prints');
    assert.match(out, /^ {2}remove: \.claude\/hooks\/inject-code-style\.js$/m, 'what the prune list takes');
    assert.match(out, /^ {2}unwire: inject-code-style\.js::PostToolUse$/m, 'the exact settings.json entry to drop');
    assert.match(out, /^ {2}env-rename: ALFRED_CODE_OLD_KEY -> ALFRED_CODE_NEW_KEY$/m, 'the env edit, on the entry that carries one');
    assert.match(out, /^ {2}env-reset: ALFRED_CODE_EXAMPLE: old -> new$/m, 'a seeded default the installers reset, on the entry that carries one');
    assert.match(out, /^ {2}env-fold: ALFRED_CODE_FOLDED: 0 -> ALFRED_CODE_HOOKS_OFF \+= some-hook:part \(any other value goes\)$/m, 'a key folded into a csv');
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
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    const rows = out.split('\n').filter((l) => l.startsWith('new: '));
    assert.deepStrictEqual(rows.filter((r) => !r.startsWith('new: rule ')), [
        'new: skill markdown-style\tarrives\t-',
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
    // An always SEAT: it rides the core on the plugin route (arrives) and is copied only on a yes on the
    // copy route - a skill is a copy on both since 2.1.0, so it no longer tells the routes apart.
    const fixture = { files: [{ status: 'added', filename: 'stack/agents/evidence-gatherer.md' }] };
    const env = { ...process.env, ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
    const verdict = ({ local, stamp }) =>
    {
        const { snap, install, fixtureFile } = scaffold({ fixture, settings: { env: {} }, ...(stamp ? { stamp } : {}) });
        if (local) fs.writeFileSync(path.join(install, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' } }));
        const listing = path.join(install, 'listing.json');
        fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
        const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing], env);
        return (/^new: agent evidence-gatherer\t.*$/m.exec(out) || [out])[0];
    };
    assert.strictEqual(verdict({ local: true }), 'new: agent evidence-gatherer\tarrives\talfred-code', 'a personal switch decided the committed route');
    assert.match(verdict({ local: false }), /^new: agent evidence-gatherer\toffer\t-/, 'a shell export the local file does not hold is the run\'s own');
    assert.match(verdict({ local: true, stamp: 'sha: aaa111\nversion: 0.2.60\nscope: local\n' }), /^new: agent evidence-gatherer\toffer\t-/, 'at local scope the local file is the install\'s own');
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

test('new items: none added prints `new: none`; an unreadable listing leaves an always skill arriving and a library item offered', () => {
    const quiet = scaffold({ fixture: { files: [{ status: 'modified', filename: 'stack/skills/csharp/SKILL.md' }] } });
    const r1 = run(['--snapshot', quiet.snap, '--root', quiet.install, '--fixture', quiet.fixtureFile]);
    assert.match(r1.out, /^new: none$/m);

    const blind = scaffold({ fixture: { files: [{ status: 'added', filename: 'stack/skills/markdown-style/SKILL.md' }, { status: 'added', filename: 'stack/skills/dotnet-web-backend/SKILL.md' }] } });
    const bad = path.join(blind.install, 'listing.json');
    fs.writeFileSync(bad, '{ not json');
    const r2 = run(['--snapshot', blind.snap, '--root', blind.install, '--fixture', blind.fixtureFile, '--listing', bad]);
    // An always-closure skill is a copy (2.1.0) - it arrives whatever the listing says.
    assert.match(r2.out, /^new: skill markdown-style\tarrives\t-$/m);
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
        { status: 'added', filename: 'stack/skills/capture-usage-report/SKILL.md' },
        { status: 'added', filename: 'stack/skills/task-solve/SKILL.md' },
    ] } });
    fs.writeFileSync(path.join(snap, 'meta', 'stack-manifest.json'), JSON.stringify({ renamed }));
    const old = oldOf('capture-usage-report');
    fs.mkdirSync(path.join(install, '.claude', 'skills', old), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'skills', old, 'SKILL.md'), `---\nname: ${old}\n---\n`);
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, new RegExp(`^new: skill capture-usage-report\\trenamed\\t-\\tfrom=${old}\\told-on-disk$`, 'm'), out);
    assert.match(out, new RegExp(`^new: skill task-solve\\tarrives\\t-\\tfrom=${oldOf('task-solve')}$`, 'm'), out);
});

// M8 (Task 22 fix round 1): a renamed library item whose OLD name the stamp's picks never named and the
// disk never held was declined under that name - offering it under the new one presents a declined item
// as new. A picked old name with no copy is still offered, and a stamp with no picks line judges nothing.
test('new items: a renamed library item the stamp never picked, with no old copy, is not offered as new', () => {
    const { loadManifest } = require('./install/manifest.js');
    const renamed = loadManifest(path.join(__dirname, '..')).renamed;
    const old = Object.keys(renamed.skills).find((k) => renamed.skills[k] === 'capture-usage-report');
    const fixture = { files: [{ status: 'added', filename: 'stack/skills/capture-usage-report/SKILL.md' }] };
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
    assert.match(newLines(`${base}picked-skills: ${old}\n`), new RegExp(`^new: skill capture-usage-report\\toffer\\t.*from=${old}`, 'm'),
        'a picked old name with no copy on disk is still offered');
    assert.match(newLines(base), /^new: skill capture-usage-report\toffer\t/m,
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
            { status: 'renamed', filename: 'stack/rules/alfred-security.md', previous_filename: 'stack/rules/old-security.md' },
            { status: 'added', filename: 'stack/hooks/docs-session.js' },
        ] },
    });
    fs.mkdirSync(path.join(snap, 'meta'), { recursive: true });
    fs.writeFileSync(path.join(snap, 'meta', 'recommendations.json'), JSON.stringify({ always: { rules: ['alfred-security'] } }));
    fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'rules', 'old-security.md'), '# old\n');
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const on = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(on, /^new: rule alfred-security\tarrives\t-\tfrom=old-security\told-on-disk$/m, on);
    assert.match(on, /^new: hook docs-session\toff\talfred-code$/m, 'None held');
    // The core carrying the hooks is locked on: its listing flag can read false while it runs (S22),
    // and the installer's read-back holds the None the same way.
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: false }]));
    const stale = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(stale, /^new: hook docs-session\toff\talfred-code$/m, 'None held - the flag is not the hook state');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'serena@envoydev', enabled: true }]));
    const absent = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]).out;
    assert.match(absent, /^new: hook docs-session\tarrives\talfred-code$/m, 'no core listed: the installer installs it and writes no hook none - the hook arrives');
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
        'new: skill markdown-style\tarrives\t-',
        'new: skill dotnet-web-backend\toffer\t-\tleave',
        'new: agent code-style-analyzer\toff\talfred-code',
        'new: hook docs-session\tarrives\talfred-code',
    ]);
});

// An explicit --marketplace wins over the key the listing names: a key no core row is listed under reads
// the core as absent - which no longer moves a skill (a copy since 2.1.0, whatever the key), and a denied
// seat stays off either way.
test('new items: an explicit --marketplace wins over the listing\'s key - a skill still arrives, a denied seat stays off', () => {
    const { snap, install, fixtureFile } = scaffold({
        fixture: NEW_FIXTURE,
        settings: { permissions: { deny: ['Agent(alfred-code:code-style-analyzer)'] } },
    });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const forced = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing, '--marketplace', 'elsewhere']).out;
    assert.match(forced, /^new: skill markdown-style\tarrives\t-$/m, forced);
    assert.match(forced, /^new: agent code-style-analyzer\toff\talfred-code$/m, forced);
});

// `claude plugin list --json` prints every project's project-scope rows. Another project on the same
// account may run the core under the other key - the key is this project's, read from its own rows.
test('new items: the key comes from THIS project\'s rows, never another project\'s', () => {
    const { snap, install, fixtureFile } = scaffold({ fixture: NEW_FIXTURE });
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([
        { id: 'alfred-code@envoydev', enabled: true, scope: 'project', projectPath: path.join(path.dirname(install), 'other-project') },
        { id: 'alfred-code@my-fork', enabled: true, scope: 'project', projectPath: install },
    ]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^new: skill markdown-style\tarrives\t-$/m, out);
    assert.match(out, /^new: hook docs-session\tarrives\talfred-code$/m, out);
});

// I8 (R51): the compare base is the PROJECT's own stamp. A stamp in the account dir is no project's
// install - with none in the project the run is the plain 'no stamp' exit (2), whatever the account holds.
test('the project stamp is the compare base - an account-dir stamp never is (I8)', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: null, fixture: { files: [] } });
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'docs.js'), '');
    const acct = path.join(path.dirname(install), 'acct');
    fs.mkdirSync(acct, { recursive: true });
    fs.writeFileSync(path.join(acct, 'alfred-code.stamp'), 'sha: aaa111\nversion: 1.3.0\nscope: global\n');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: acct };
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env);
    assert.strictEqual(code, 2, out);
    assert.match(out, /^no-stamp$/m, out);

    fs.writeFileSync(path.join(install, '.claude', 'alfred-code.stamp'), 'sha: aaa111\nversion: 2.0.0\n');
    const own = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env);
    assert.strictEqual(own.code, 0, own.out);
    assert.match(own.out, /^version: 2\.0\.0 -> 0\.2\.70$/m, own.out);
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
// update's normal path. A tree with no stack signature stays a fresh project with nothing to offer. Since 2.8.0 the docs
// are no part of the offer (they move unasked), and since 2.10.1 an old server's data is none either: the stack ships no
// server, so its `.serena` stays where it is.
test('data-move: an unstamped legacy install takes update\'s path, and its old server data is no offer; a tree with no stack signature is no install', () => {
    const legacyKey = { ALFRED_CODE_DOCS_PATH: '.claude/docs' };
    const { snap, install, fixtureFile } = scaffold({ stamp: null, settings: { env: legacyKey } });
    fs.mkdirSync(path.join(install, '.claude', 'docs', 'architecture'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# arch\n');
    fs.mkdirSync(path.join(install, '.serena'), { recursive: true });
    fs.writeFileSync(path.join(install, '.serena', 'project.yml'), 'project_name: x\n');
    const bare = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.match(bare.out, /^data-move: none \(no install record - a fresh install lays the data under the root\)$/m, 'one signature is no install');
    fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, '.claude', 'hooks', 'guard-catastrophic-rm.js'), '// old\n');
    const legacy = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]);
    assert.strictEqual(legacy.code, 2, 'still no stamp to compare');
    assert.match(legacy.out, /^data-move: none \(nothing to move\)$/m, legacy.out);
    assert.ok(fs.existsSync(path.join(install, '.serena', 'project.yml')), 'the old server data is left where it is');
});

// audit 2026-10-11, session 5b9ce9c5: the close named the release delta ('changed: skills=10 agents=44') as this
// install's refresh while the installer copied 9 of the 10 skills and the install enabled 21 seats. `changed-here:`
// is the part this install carries - a copy on disk, a seat on the core no deny names, a hook the plugin route carries
// and HOOKS_OFF does not name - and the release's own `changed:` line stays as it was.
test('changed-here: the release delta narrowed to what this install carries, on the plugin and the copy route', () => {
    const fixture = { files: [
        { status: 'modified', filename: 'stack/skills/csharp/SKILL.md' },
        { status: 'modified', filename: 'stack/skills/dotnet/SKILL.md' },
        { status: 'modified', filename: 'stack/agents/code-reviewer.md' },
        { status: 'modified', filename: 'stack/agents/security-auditor.md' },
        { status: 'modified', filename: 'stack/rules/markdown-docs.md' },
        { status: 'modified', filename: 'stack/rules/web-conventions.md' },
        { status: 'modified', filename: 'stack/hooks/guard-secret-value.js' },
        { status: 'modified', filename: 'stack/hooks/guard-catastrophic-rm.js' },
        { status: 'modified', filename: 'stack/hooks/model-windows.json' },
    ] };
    const lay = (install) => {
        fs.mkdirSync(path.join(install, '.claude', 'skills', 'csharp'), { recursive: true });
        fs.writeFileSync(path.join(install, '.claude', 'skills', 'csharp', 'SKILL.md'), '---\nname: csharp\n---\n');
        fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
        fs.writeFileSync(path.join(install, '.claude', 'rules', 'markdown-docs.md'), '# r\n');
        fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(install, '.claude', 'hooks', 'model-windows.json'), '{}');
    };
    const plugin = scaffold({ fixture, stamp: 'sha: aaa111\nversion: 0.2.60\nseats-route: plugin\nhooks-route: plugin\n',
        settings: { permissions: { deny: ['Agent(alfred-code:security-auditor)'] }, env: { ALFRED_CODE_HOOKS_OFF: 'guard-catastrophic-rm' } } });
    lay(plugin.install);
    const p = run(['--snapshot', plugin.snap, '--root', plugin.install, '--fixture', plugin.fixtureFile]).out;
    assert.match(p, /^changed: skills=2 agents=2 rules=2 hooks=3 template=no$/m, 'the release delta is unchanged');
    assert.match(p, /^changed-here: skills=1 agents=1 rules=1 hooks=2$/m, p);
    const copy = scaffold({ fixture, stamp: 'sha: aaa111\nversion: 0.2.60\nseats-route: copy\nhooks-route: copy\n', settings: { env: {} } });
    lay(copy.install);
    fs.mkdirSync(path.join(copy.install, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(copy.install, '.claude', 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\n---\n');
    fs.writeFileSync(path.join(copy.install, '.claude', 'hooks', 'guard-secret-value.js'), '// copy\n');
    const c = run(['--snapshot', copy.snap, '--root', copy.install, '--fixture', copy.fixtureFile]).out;
    assert.match(c, /^changed-here: skills=1 agents=1 rules=1 hooks=2$/m, 'the copy route counts copies on disk only');
});

// audit 2026-10-11, session b3f8193f: the compare API caps at 300 files (`TRUNCATED`), and the 8 renames past the cap
// never reached the ask - it named 26 renamed skill copies, and the installer pruned 34. Every old name of the
// snapshot's `renamed` map whose copy is on disk is a rename row, listed by the compare or not.
test('new items: a rename the truncated compare never listed is still a renamed row when its old copy is on disk', () => {
    const { loadManifest } = require('./install/manifest.js');
    const renamed = loadManifest(path.join(__dirname, '..')).renamed;
    const [[oldA, toA], [oldB, toB]] = Object.entries(renamed.skills).filter(([, to]) => to.startsWith('task-')).slice(0, 2);
    const files = [{ status: 'renamed', filename: `stack/skills/${toA}/SKILL.md`, previous_filename: `stack/skills/${oldA}/SKILL.md` }];
    for (let i = 0; i < 300; i++) files.push({ status: 'modified', filename: `stack/skills/csharp/references/f${i}.md` });
    const { snap, install, fixtureFile } = scaffold({ fixture: { files } });
    fs.writeFileSync(path.join(snap, 'meta', 'stack-manifest.json'), JSON.stringify({ renamed }));
    for (const old of [oldA, oldB])
    {
        fs.mkdirSync(path.join(install, '.claude', 'skills', old), { recursive: true });
        fs.writeFileSync(path.join(install, '.claude', 'skills', old, 'SKILL.md'), `---\nname: ${old}\n---\n`);
    }
    const listing = path.join(install, 'listing.json');
    fs.writeFileSync(listing, JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true }]));
    const { out, code } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile, '--listing', listing]);
    assert.strictEqual(code, 0, out);
    assert.match(out, /^TRUNCATED/m, 'the fixture is past the compare cap');
    for (const [old, to] of [[oldA, toA], [oldB, toB]])
        assert.match(out, new RegExp(`^new: skill ${to}\\t\\S+\\t.*from=${old}\\told-on-disk`, 'm'), `${old} -> ${to}:\n${out}`);
});

// audit 2026-10-11, session b3f8193f: the close stated 'Renamed: 35 skills' and 'the 26 old skill copies' from memory,
// against 34 of each in the log. `--log` prints the installer's own counts, the pruned items by name.
test('--log mode: the installer\'s renamed and pruned lines are counted, the pruned ones named', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-log-'));
    const log = path.join(dir, 'install.log');
    fs.writeFileSync(log, [
        '==> renamed: skill old-solve -> new-solve',
        '==> renamed: skill old-design -> new-design',
        '==> renamed: agent old-seat -> new-seat',
        '==>   renamed: .claude/AGENTS.md - 3 old skill or seat name(s) re-spelled to the new names',
        '==>   skill pruned (retired upstream): old-solve',
        '==>   skill pruned (retired upstream): old-design',
        '==>   skill kept (retired upstream, tracked in git): plugin-authoring',
        '==>   plugin pruned (retired upstream) [project]: ponytail@ponytail',
    ].join('\n'));
    const { out } = run(['--log', log]);
    assert.match(out, /^renamed: 3 \(skill=2 agent=1\)$/m, out);
    assert.match(out, /^pruned: 3 \(skill=2 plugin=1\) - skill old-solve, old-design; plugin ponytail@ponytail$/m, out);
    fs.writeFileSync(log, '==>   installed/refreshed this run - skills=12, plugins=6, mcps=0, hooks=0, agents=11, rules=9');
    const quiet = run(['--log', log]).out;
    assert.match(quiet, /^renamed: none$/m);
    assert.match(quiet, /^pruned: none$/m);
});

// audit 2026-10-11, session b3f8193f: the installer only NAMES an old stack name in the project's own AGENTS.md, and
// step 6 spliced it with a hand `sed -i` after an ask that showed no diff. `--respell` prints that edit line by line
// from the snapshot's own renamed map, and `--apply` writes exactly those lines - the same hits the `!!` line counted.
test('--respell: the project\'s own instruction file gets a per-line plan, and --apply writes only those lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-respell-'));
    try {
        const renamed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8')).renamed;
        const [from, to] = Object.entries(renamed.skills).find(([, n]) => n === 'capture-code-quality');
        const own = [`# Notes`, `Run /${from} after a big change.`, `Keep scripts/${from}.sh as it is.`, `Untouched line.`, ''].join('\r\n');
        fs.mkdirSync(path.join(dir, '.claude'));
        fs.writeFileSync(path.join(dir, '.claude', 'AGENTS.md'), own);
        const dry = run(['--respell', '--root', dir]).out;
        assert.match(dry, new RegExp(`^respell: \\.claude/AGENTS\\.md:2  ${from} -> ${to}$`, 'm'), dry);
        assert.match(dry, new RegExp(`^- Run /${from} after a big change\\.$`, 'm'));
        assert.match(dry, new RegExp(`^\\+ Run /${to} after a big change\\.$`, 'm'));
        assert.match(dry, /^respell: 1 line\(s\) in 1 file\(s\)$/m, 'a name inside a path is no hit');
        assert.strictEqual(fs.readFileSync(path.join(dir, '.claude', 'AGENTS.md'), 'utf8'), own, 'a dry run writes nothing');
        // the installer's `!!` line counts the same hits the plan lists
        const logs = [];
        require('./install/selection.js').respellRenamed({ projectRoot: dir, renamed, log: (m) => logs.push(m), note: () => {} });
        assert.ok(logs.some((l) => l.includes('.claude/AGENTS.md is yours and names 1 old stack name(s)') && l.includes('update-preflight.js --respell')), logs.join('\n'));
        const applied = run(['--respell', '--apply', '--root', dir]).out;
        assert.match(applied, /^respelled: \.claude\/AGENTS\.md - 1 line\(s\)$/m, applied);
        assert.strictEqual(fs.readFileSync(path.join(dir, '.claude', 'AGENTS.md'), 'utf8'), own.replace(`/${from} `, `/${to} `), 'that line alone, CRLF kept');
        assert.match(run(['--respell', '--root', dir]).out, /^respell: none$/m, 'a second run has nothing to do');
        fs.rmSync(path.join(dir, '.claude', 'AGENTS.md'));
        assert.match(run(['--respell', '--root', dir]).out, /^respell: none$/m, 'no instruction file is nothing to do');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// audit 2026-10-11, session a9e06780: configure step 1's inventory, rendered from the read-back so its shape is fixed and
// the layer-table gate can prove the paste by its last line.
test('--inventory: the five rows in order with counts, plugins with their scope, and the total line last - an mcps key is no row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-inv-'));
    try {
        const file = path.join(dir, 'installed.json');
        fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ skills: ['b', 'a'], agents: [], rules: ['r1'], hooks: ['h1', 'h2'], mcps: ['browser'],
            plugins: [{ name: 'claude-hud', scope: 'user' }], plugins_disabled: ['x'], left_out: ['agent y'] }));
        const lines = run(['--inventory', file]).out.trim().split('\n');
        assert.deepStrictEqual(lines, [
            '| category | count | items |', '|---|---|---|',
            '| rules | 1 | r1 |', '| agents | 0 | - |', '| skills | 2 | b, a |', '| hooks | 2 | h1, h2 |',
            '| plugins | 1 | claude-hud [user] |',
            'total: 6 installed, 1 switched off, 1 plugin(s) parked',
        ]);
        fs.writeFileSync(file, 'garbage');
        const bad = run(['--inventory', file]);
        assert.strictEqual(bad.code, 1);
        assert.match(bad.out, /^inventory: .* could not be read - re-run the step-1 read-back$/m);
        assert.strictEqual(run(['--inventory', path.join(dir, 'missing.json')]).code, 1, 'a missing file is no empty inventory');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--offers: the instructions line says where the instruction files are, for the place question - an account install has none', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-place-'));
    try
    {
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        const offers = () => run(['--offers', '--root', root]).out.split('\n').filter((l) => /^instructions: /.test(l));
        assert.deepStrictEqual(offers(), ['instructions: none']);
        fs.writeFileSync(path.join(root, '.claude', 'AGENTS.md'), '# x\n');
        assert.deepStrictEqual(offers(), ['instructions: claude .claude/AGENTS.md']);
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# y\n');
        assert.deepStrictEqual(offers(), ['instructions: split CLAUDE.md .claude/AGENTS.md']);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the name line: the full read and --offers both print it from the stamp\'s answer; the agents-md line is gone', () => {
    const { snap, install, fixtureFile } = scaffold({ stamp: 'sha: aaa111\nversion: 0.2.60\ninstructions-file: claude\n' });
    fs.writeFileSync(path.join(install, '.claude', 'AGENTS.md'), '# x\n');
    const full = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile]).out;
    assert.match(full, /^instructions-file: claude files=agents answer=claude local=no update=ask$/m, full);
    assert.doesNotMatch(full, /^agents-md:/m);
    const offers = run(['--offers', '--root', install]).out;
    assert.match(offers, /^instructions-file: claude files=agents answer=claude local=no update=ask$/m, offers);
    assert.doesNotMatch(offers, /^agents-md:/m);
});

// D5 (workspace layering): an update in a joined child with a CLAUDE.md above it asks the account question.
test('update-preflight prints instructions-both: ask in a child', () =>
{
    const { snap, install, fixtureFile } = scaffold();
    const parent = path.dirname(install);
    fs.mkdirSync(path.join(parent, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(parent, '.claude', 'alfred-code.stamp'), 'sha: aaa111\nversion: 0.2.60\n');
    for (const [dir, line] of [[parent, 'child project\n'], [install, 'parent ..\n']])
    {
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), line);
    }
    fs.writeFileSync(path.join(parent, 'CLAUDE.md'), '# team\n');
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(parent, 'acct') };
    delete env.ALFRED_CODE_UNATTENDED;
    const { out } = run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env);
    assert.match(out, /^instructions-both: ask$/m, out);
    fs.rmSync(path.join(parent, '.alfred'), { recursive: true });
    assert.doesNotMatch(run(['--snapshot', snap, '--root', install, '--fixture', fixtureFile], env).out, /instructions-both/, 'a standalone project is never asked');
});

