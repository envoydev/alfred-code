'use strict';
// THE SOURCE: what Claude Code already cached, then the release archive, then a clone.
//
// The stack used to keep its own extracted-snapshot cache under the account dir, plus a version
// probe and an adoption path for Claude Code's marketplace clone. Phase 5 of the plugin migration
// deleted all three: every marketplace entry shares this repo's root as its `source`, so installing
// the core plugin leaves the WHOLE repo at <config>/plugins/cache/<marketplace>/alfred-code/
// <version> - RELEASE-SOURCE included - and that is the same snapshot the installer was
// downloading. The archive and clone routes remain for the two paths with no plugin cache to read:
// the copy route (both VIA_PLUGIN switches off) and a machine with no `claude` CLI.
//
// The plugin-cache/archive/clone resolution ORDER and its fallbacks are unit-tested directly against
// scripts/install/source.js in install-source.test.js (resolveSource / fetchArchive / cloneMain, each
// called with a fixture repoUrl - no subprocess, no HTTP fixture server). Phase 7b (R33) deleted the
// frozen shell and PowerShell twins, which is what the tests below used to drive as a REAL installer
// subprocess against a local HTTP fixture that speaks the release endpoints and counts asset hits;
// the Node seed's own CLI entry (scripts/install/alfred-code.js) has no equivalent env-var override
// for the release host, so that subprocess-level proof has no like-for-like replacement here - a
// follow-up that wants one would need to add a test-only override to the seed's own arg parsing.
// What remains below are the guided walks' own bash/PowerShell SNIPPETS
// (setup-plugin/references/source-protocol.md), never the twins - they read the same plugin cache
// directly, with no installer subprocess in the loop, so they are unaffected by the twins' removal.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hasPwsh = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const skipNoPwsh = hasPwsh ? false : 'pwsh not installed - ps1 behavioral test skipped';

const VERSION = '9.9.9';
const FAKE_SHA = 'abadcafe'.repeat(5);

// One archive built once for the whole file: a real snapshot of this working tree (so the
// installer finds stack/skills + stack/agents) carrying a RELEASE-SOURCE naming VERSION.
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-fixture-'));
const RELEASE_SOURCE = path.join(FIXTURE, 'RELEASE-SOURCE');
fs.writeFileSync(RELEASE_SOURCE, `sha: ${FAKE_SHA}\nref: main\nversion: ${VERSION}\nbuilt: 2026-09-09T00:00:00Z\n`);
const ARCHIVE = path.join(FIXTURE, 'alfred-code.tar.gz');
execFileSync('git', ['-C', ROOT, 'archive', '--format=tar.gz', `--add-file=${RELEASE_SOURCE}`, '-o', ARCHIVE, 'HEAD'], { stdio: 'ignore' });
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

function work() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-'));
    fs.writeFileSync(path.join(dir, 'sel.txt'), 'skill csharp\n');
    return dir;
}

// A plugin cache entry the way `claude plugin install` leaves it: the whole repo under
// <config>/plugins/cache/<marketplace>/alfred-code/<version>. Built from the same archive the
// release host serves, so a run that reads it installs exactly what a download would have.
function plantPluginCache(home, { version = VERSION, marketplace = 'envoydev', plugin = 'alfred-code', truncated = false } = {}) {
    const dir = path.join(home, '.claude', 'plugins', 'cache', marketplace, plugin, version);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', ARCHIVE, '-C', dir]);
    // The CLI names the directory after the release it installed, so the entry's own RELEASE-SOURCE
    // says the same thing. The archive this fixture untars always names VERSION, so restate it -
    // otherwise a multi-version case would resolve one version by directory and report another.
    fs.writeFileSync(path.join(dir, 'RELEASE-SOURCE'), `sha: ${FAKE_SHA}\nref: main\nversion: ${version}\nbuilt: 2026-09-09T00:00:00Z\n`);
    // a half-written entry: the validity test is stack/skills + stack/agents, so drop one
    if (truncated) fs.rmSync(path.join(dir, 'stack', 'agents'), { recursive: true, force: true });
    return dir;
}

// The guided walks do not run the installer's resolver - each command body pastes its own snippet
// from setup-plugin/references/source-protocol.md, one per platform. Three copies of one rule is
// exactly where they drift, and a drifted walk silently pays a download the installer would not.
// So run the protocol's OWN snippets against a planted cache and assert they land on: the newest
// valid entry, the half-written one rejected, nothing fetched.
function protocolSnippet(lang, index) {
    const md = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const blocks = [...md.matchAll(/```(bash|powershell)\n([\s\S]*?)```/g)].filter(m => m[1] === lang);
    assert.ok(blocks[index], `source-protocol.md has no ${lang} block #${index}`);
    return blocks[index][2];
}

// The same three entries both snippets (bash and PowerShell) have to agree on.
function plantThree(home) {
    plantPluginCache(home, { version: '0.9.0' });
    plantPluginCache(home, { version: '0.10.0' });                   // newest VALID - the expected answer
    plantPluginCache(home, { version: '0.11.0', truncated: true });  // newer, but half-written
    return path.join(home, '.claude', 'plugins', 'cache', 'envoydev', 'alfred-code', '0.10.0');
}

// Git Bash prints its own mount spelling (/tmp/tmp.X), which native node resolves against the current
// drive - so on Windows the path is translated before node opens it.
const nativePath = (p) => process.platform === 'win32'
    ? execFileSync('bash', ['-c', 'cygpath -w "$1"', 'cygpath', p], { encoding: 'utf8' }).trim() : p;

// The run marker a snippet run in `home` writes, named by the snippet's OWN lines run where it runs -
// never a formula copied into the test: a copy spelled the root the way os.tmpdir() does while the
// snippet reads the real path, so every cleanup missed and each run left its markers in /tmp.
function markOf(home) {
    const lines = protocolSnippet('bash', 0).split('\n').filter((l) => /^(RUN_ROOT|MARK)=/.test(l));
    assert.ok(lines.some((l) => l.startsWith('MARK=')), 'the bash snippet names no MARK= line');
    return nativePath(execFileSync('bash', ['-c', `${lines.join('\n')}\nprintf '%s' "$MARK"`], { cwd: home, encoding: 'utf8' }));
}

// A recording `claude` on PATH, so no snippet test reaches the real CLI or the real account. With
// `lands`, its `plugin update alfred-code@envoydev` writes that newer valid entry into the cache -
// what the real CLI does - so a snippet that picks BEFORE it updates is caught taking the stale one.
const POSIX_STUB = { skip: process.platform === 'win32' && 'the recording claude stub is a shell script' };
function stubClaude(home, listing, lands) {
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const cache = path.join(home, '.claude', 'plugins', 'cache', 'envoydev', 'alfred-code');
    fs.writeFileSync(path.join(home, 'listing.json'), listing);
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(home, 'claude-calls.log'))}`,
        `if [ "$1 $2" = "plugin list" ]; then cat ${JSON.stringify(path.join(home, 'listing.json'))}; fi`,
        lands ? `if [ "$1 $2 $3" = "plugin update alfred-code@envoydev" ]; then cp -R ${JSON.stringify(path.join(cache, '0.10.0'))} ${JSON.stringify(path.join(cache, lands))}; printf 'sha: x\\nref: main\\nversion: ${lands}\\n' > ${JSON.stringify(path.join(cache, lands, 'RELEASE-SOURCE'))}; fi` : '',
        'exit 0', ''].join('\n'), { mode: 0o755 });
    return bin + path.delimiter + process.env.PATH;
}
const claudeCalls = (home) => { try { return fs.readFileSync(path.join(home, 'claude-calls.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const CORE_ROW = (scope, version) => JSON.stringify([{ id: 'alfred-code@envoydev', version, scope, enabled: true }]);
// Every installed stack entry is updated, each at its own scope - the refreshed catalog is what Claude
// Code launches, so an entry left on its old version can name a file that version lacks. Not another
// project's row, and not the official marketplace's plugin of the same name.
const STACK_ROWS = (home) => JSON.stringify([
    { id: 'alfred-code@envoydev', version: '0.10.0', scope: 'user', enabled: true },
    { id: 'serena@envoydev', version: '0.10.0', scope: 'project', enabled: true, projectPath: fs.realpathSync(home) },
    { id: 'serena@envoydev', version: '0.9.0', scope: 'project', enabled: true, projectPath: '/elsewhere/another-project' },
    { id: 'serena@claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true },
]);
const WANT_UPDATES = ['plugin update alfred-code@envoydev --scope user -y', 'plugin update serena@envoydev --scope project -y'];
const updatesIn = (home) => claudeCalls(home).filter((c) => /^plugin update /.test(c)).sort();

test("the protocol's bash snippet updates the core FIRST, takes the entry that lands, and says what was running", POSIX_STUB, () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    let tmp = '';
    try
    {
        plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const out = execFileSync('bash', [script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, STACK_ROWS(home), '0.12.0') },
        });
        const m = out.match(/RESOLVED TMP=(\S+) (\S+) .*running=(\S+)/);
        assert.ok(m, `the snippet printed no RESOLVED line with running=:\n${out}`);
        tmp = m[1];
        assert.strictEqual(m[2], '0.12.0', 'it read the cache before the update landed the newer entry');
        assert.strictEqual(m[3], '0.10.0', 'running= must name the version this session loaded, from BEFORE the update');
        const calls = claudeCalls(home);
        assert.ok(calls.includes('plugin marketplace update envoydev'), calls.join(' | '));
        assert.deepStrictEqual(updatesIn(home), WANT_UPDATES, calls.join(' | '));
    }
    finally
    {
        const mark = markOf(home);
        for (const p of [tmp, mark]) if (p) fs.rmSync(p, { recursive: true, force: true });
        assert.ok(!fs.existsSync(mark), `the run marker outlived the test: ${mark}`);
        fs.rmSync(home, { recursive: true, force: true });
    }
});

// zsh aborts a whole `for` when ANY of its globs matches nothing, so a snippet naming the 1.x glob
// beside the 2.x one resolved to nothing on a clean 2.x machine (macOS's default shell) and curled the
// archive. A curl that fails and records itself makes that fallback loud.
const hasZsh = spawnSync('zsh', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0;
test("the protocol's bash snippet finds the plugin cache under zsh too, on a machine with no 1.x cache dir", { skip: POSIX_STUB.skip || (!hasZsh && 'zsh not installed') }, () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    let tmp = '';
    try
    {
        plantThree(home);
        const bin = stubClaude(home, STACK_ROWS(home), '0.12.0');
        const curlLog = path.join(home, 'curl-calls.log');
        fs.writeFileSync(path.join(home, 'bin', 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(curlLog)}\nexit 22\n`, { mode: 0o755 });
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const r = spawnSync('zsh', [script], { cwd: home, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: bin } });
        const m = (r.stdout || '').match(/RESOLVED TMP=(\S+) (\S+) /);
        assert.ok(m, `the snippet printed no RESOLVED line under zsh:\n${r.stdout}\n${r.stderr}`);
        tmp = m[1];
        assert.ok(!fs.existsSync(curlLog), `zsh skipped the plugin cache and downloaded: ${fs.existsSync(curlLog) && fs.readFileSync(curlLog, 'utf8')}`);
        assert.strictEqual(m[2], '0.12.0', 'zsh did not resolve the newest cache entry');
    }
    finally
    {
        const mark = markOf(home);
        for (const p of [tmp, mark]) if (p) fs.rmSync(p, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("the protocol's PowerShell snippet updates the core FIRST and takes the entry that lands", { skip: skipNoPwsh || POSIX_STUB.skip }, () => {
    const home = work();
    const script = path.join(home, 'resolve.ps1');
    try
    {
        plantThree(home);
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-WAS=$Was"\nWrite-Output "PS-TMP=$TMP"\n`);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, STACK_ROWS(home), '0.12.0') },
        });
        assert.match(out, /PS-VER=0\.12\.0/, `it read the cache before the update landed:\n${out}`);
        assert.match(out, /PS-WAS=0\.10\.0/, `$Was must name the version from BEFORE the update:\n${out}`);
        assert.deepStrictEqual(updatesIn(home), WANT_UPDATES, claudeCalls(home).join(' | '));
        fs.rmSync(out.match(/PS-TMP=(.+)/)[1].trim(), { recursive: true, force: true });
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// FINDING-5: the marker was named from the first 80 characters of the cleaned root, so two roots
// sharing that prefix (worktrees under one deep parent) shared ONE marker - an interrupted run's
// $TMP was then REUSED by the other project, a stale snapshot with its plugin update skipped.
test('two roots sharing their first 80 characters get two run markers, and every bash block names it one way (FINDING-5)', () => {
    const base = work();
    try
    {
        const long = 'x'.repeat(90);
        const [a, b] = ['a', 'b'].map((s) => path.join(base, long + s));
        for (const d of [a, b]) fs.mkdirSync(d);
        assert.notStrictEqual(markOf(a), markOf(b), 'two projects share one run marker');
        assert.strictEqual(markOf(a), markOf(a), 'the marker is not stable across calls');
        if (process.platform !== 'win32')
        {
            const deep = path.join(base, 'd'.repeat(100), 'e'.repeat(100), 'f'.repeat(100));
            fs.mkdirSync(deep, { recursive: true });
            assert.ok(path.basename(markOf(deep)).length <= 255, 'a deep root names a marker past the file-name limit');
        }
        const md = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
        const markLines = [...md.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((m) => m[1].split('\n').filter((l) => /^(RUN_ROOT|MARK)=/.test(l)));
        assert.ok(markLines.length >= 4, `expected the two bash blocks to name the marker: ${markLines.join(' | ')}`);
        assert.strictEqual(new Set(markLines.filter((l) => l.startsWith('MARK='))).size, 1, 'the bash blocks name the marker two ways');
    }
    finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("the protocol's bash snippet resolves the newest valid cache entry", () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    let tmp = '';
    try
    {
        const want = plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const out = execFileSync('bash', [script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, '[]') },
        });
        const m = out.match(/RESOLVED TMP=(\S+) (\S+)/);
        assert.ok(m, `the snippet printed no RESOLVED line:\n${out}`);
        tmp = nativePath(m[1]);
        assert.strictEqual(m[2], '0.10.0', 'it read the wrong entry - not the newest valid one');
        assert.ok(fs.existsSync(path.join(tmp, 'repo', 'stack', 'skills')), 'nothing was copied into $TMP/repo');
        assert.ok(!fs.existsSync(path.join(tmp, 'alfred-code.tar.gz')), 'it downloaded the archive over a usable cache');
        assert.strictEqual(
            fs.readFileSync(path.join(tmp, 'repo', 'RELEASE-SOURCE'), 'utf8'),
            fs.readFileSync(path.join(want, 'RELEASE-SOURCE'), 'utf8'),
            'the copy did not come from the newest valid entry');
    }
    finally
    {
        const mark = markOf(home);
        for (const p of [tmp, mark]) if (p) fs.rmSync(p, { recursive: true, force: true });
        assert.ok(!fs.existsSync(mark), `the run marker outlived the test: ${mark}`);
        fs.rmSync(home, { recursive: true, force: true });
    }
});

// A sandboxed Bash command writes only under the working directory and the session temp dir $TMPDIR
// points to (code.claude.com/docs/en/sandboxing, 'Filesystem isolation') - a marker in a fixed /tmp is
// refused there, so every call resolved a fresh $TMP and lost the last one's files. The marker follows
// $TMPDIR, falling back to /tmp where nothing sets it.
test("the protocol's bash snippet keeps its run marker under $TMPDIR, and a second call reuses it", POSIX_STUB, () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    const sbx = path.join(home, 'session-tmp');
    fs.mkdirSync(sbx);
    const tmps = [];
    try
    {
        plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const env = { ...process.env, TMPDIR: sbx, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, '[]') };
        const first = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
        const m = first.match(/RESOLVED TMP=(\S+)/);
        assert.ok(m, first);
        tmps.push(m[1]);
        assert.deepStrictEqual(fs.readdirSync(sbx).filter((f) => f.startsWith('alfred-code-run.')).length, 1, 'the marker is under $TMPDIR');
        // macOS's own mktemp -d picks the per-user temp dir whatever $TMPDIR says (measured), so the
        // snippet names the directory in its template.
        assert.strictEqual(path.dirname(m[1]), sbx, '$TMP itself is under $TMPDIR');
        const second = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
        assert.match(second, new RegExp(`^REUSING TMP=${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `, 'm'), 'the next call finds the same $TMP');
    }
    finally
    {
        for (const p of tmps) fs.rmSync(p, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});

test("the protocol's PowerShell snippet resolves the same entry", { skip: skipNoPwsh }, () => {
    const home = work();
    const script = path.join(home, 'resolve.ps1');
    try
    {
        const want = plantThree(home);
        // The block ends at $Ver; the two Write-Output lines are the test's probe, not the contract.
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-SRC=$Src"\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-TMP=$TMP"\n`);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], {
            cwd: home, encoding: 'utf8',
            env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, '[]') },
        });
        assert.match(out, /PS-VER=0\.10\.0/, `the ps snippet read a different version:\n${out}`);
        // compared as real paths: on Windows os.tmpdir() may be the 8.3 short name of the folder the snippet spells long
        assert.strictEqual(fs.realpathSync.native(out.match(/PS-SRC=(.+)/)[1].trim()), fs.realpathSync.native(want),
            'it took a different cache entry than the sh snippet');
        const tmp = out.match(/PS-TMP=(.+)/)[1].trim();
        assert.ok(fs.existsSync(path.join(tmp, 'repo', 'stack', 'skills')), 'nothing was copied into $TMP/repo');
        assert.ok(!fs.existsSync(path.join(tmp, 'alfred-code.zip')), 'it downloaded the archive over a usable cache');
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// One more body finds a file of its own in the plugin cache: the capabilities inventory script.
// `find | head -1` took whichever cached version the filesystem listed first; it now takes the newest
// entry the way the protocol does - sort -V, not listing order and not lexical order - so the body's own
// snippet runs here against two planted caches: one where listing order is wrong (0.2.84 before
// 1.0.0), one where lexical order is wrong (0.9.0 after 0.10.0). The integration reviewer's cache lookup
// is gone (2.1.4 audit I15): every stack skill is a library copy in the project since 2.1.0, so the
// reviewer reads .claude/skills alone.
function bodySnippet(file, re) {
    const m = fs.readFileSync(path.join(ROOT, file), 'utf8').match(re);
    assert.ok(m, `${file}: its plugin-cache lookup snippet is missing`);
    return m[1];
}

test('the capabilities script resolves to the NEWEST cached entry', () => {
    for (const versions of [['0.2.84', '1.0.0'], ['0.9.0', '0.10.0']])
    {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cache lookup '));
        try
        {
            for (const v of versions)
            {
                const skills = path.join(home, 'acct', 'plugins', 'cache', 'envoydev', 'alfred-code', v, 'stack', 'skills');
                fs.mkdirSync(path.join(skills, 'alfred-capture-agent-capabilities', 'scripts'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'alfred-capture-agent-capabilities', 'scripts', 'capabilities-inventory.js'), '');
                fs.mkdirSync(path.join(skills, 'alfred-task-solve-cross', 'references'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'alfred-task-solve-cross', 'references', 'contract-protocol.md'), '');
            }
            const newest = versions[versions.length - 1].replace(/\./g, '\\.');
            const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'acct') };
            // The capabilities block with its last line - the run - swapped for a print.
            const caps = bodySnippet('stack/skills/alfred-capture-agent-capabilities/SKILL.md', /```bash\n(CAPS=[\s\S]*?)node "\$CAPS"\n```/);
            assert.match(execFileSync('bash', ['-c', `${caps}printf %s "$CAPS"`], { cwd: home, env, encoding: 'utf8' }),
                new RegExp(`/${newest}/stack/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory\\.js$`), `capabilities: not the newest of ${versions}`);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

// --- 2.0.0: a 1.x install's cache dir, and the one a removed id orphans -----------------------------
// A 1.x install caches the stack at cache/<key>/claude-stack/<v>, and 2.0.0 lists that id as a retired // legacy-name
// alias, so `plugin update` of it lands the 2.0.0 repo in the same old slot (docs/rebrand-evidence.md
// S21); cache/<key>/alfred-code/<v> exists once the seed installs the new core. A dir the CLI no longer
// serves is marked `.orphaned_at` with its files KEPT (S3). So every lookup reads BOTH dirs, newest
// valid first, and never takes an orphaned one - a stale 1.x copy must never serve a 2.0.0 run.
const { pluginCache } = require('./install/source.js');
const LEGACY_DIR = 'claude-stack'; // legacy-name - the 1.x core's cache dir and marketplace key

// A bare cache entry: the two trees the validity test reads, and the RELEASE-SOURCE the snippets print.
function plantBare(cfg, marketplace, plugin, version, { orphaned = false, file } = {}) {
    const dir = path.join(cfg, 'plugins', 'cache', marketplace, plugin, version);
    for (const sub of ['stack/skills', 'stack/agents', 'scripts', 'stack/skills/alfred-capture-agent-capabilities/scripts', 'stack/skills/alfred-task-solve-cross/references'])
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, 'RELEASE-SOURCE'), `sha: x\nref: main\nversion: ${version}\n`);
    for (const f of ['scripts/scan-evidence.js', 'stack/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory.js', 'stack/skills/alfred-task-solve-cross/references/contract-protocol.md'])
        fs.writeFileSync(path.join(dir, f), file || '');
    if (orphaned) fs.writeFileSync(path.join(dir, '.orphaned_at'), '1790246851942');
    return dir;
}

test('pluginCache takes the newest valid entry across the alfred-code AND the 1.x claude-stack dir', () => { // legacy-name
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-legacy-'));
    try
    {
        const old = plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '1.3.0');
        assert.strictEqual(pluginCache(cfg), old, 'a 1.x cache holding only the claude-stack dir is still the snapshot'); // legacy-name
        const renamed = plantBare(cfg, LEGACY_DIR, 'alfred-code', '2.0.0');
        assert.strictEqual(pluginCache(cfg), renamed, 'the renamed entry under the OLD key is newer');
        const legacyNewer = plantBare(cfg, 'envoydev', LEGACY_DIR, '2.10.0');
        assert.strictEqual(pluginCache(cfg), legacyNewer, 'newest by VERSION across both dir names, not by name');
    }
    finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('pluginCache skips a version dir marked .orphaned_at - a stale 1.x copy never serves a 2.0.0 run', () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-orphan-'));
    try
    {
        plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '2.1.0', { orphaned: true });
        plantBare(cfg, 'envoydev', 'alfred-code', '2.2.0', { orphaned: true });
        assert.strictEqual(pluginCache(cfg), null, 'an orphaned dir alone is no snapshot - the archive route answers instead');
        const valid = plantBare(cfg, LEGACY_DIR, 'alfred-code', '2.0.0');
        assert.strictEqual(pluginCache(cfg), valid, 'the orphaned dirs are newer by version and still passed over');
    }
    finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

// A recording `claude` for a 1.x account after the catalog refresh: `plugin update` of the OLD id works
// and lands the 2.0.0 repo under the old slot, cache/<key>/claude-stack/<lands> (S21), while the new id // legacy-name
// is not installed, so updating it fails `not_installed` (S19). The rows still carry a rename note - a
// 2.0.0 catalog prints none, and a snippet that followed one would update the id nothing installed.
const ROWS_1X = JSON.stringify([LEGACY_DIR, `${LEGACY_DIR}-hooks`].map((name) => ({
    id: `${name}@${LEGACY_DIR}`, version: '1.3.0', scope: 'user', enabled: true,
    noteDetails: [{ type: 'plugin-renamed', plugin: name, marketplace: LEGACY_DIR, related: name.replace(LEGACY_DIR, 'alfred-code') }],
})));
function stub1x(home, listing, lands) {
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(home, 'listing.json'), listing);
    const land = path.join(home, '.claude', 'plugins', 'cache', LEGACY_DIR, LEGACY_DIR, lands || 'none');
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(home, 'claude-calls.log'))}`,
        `if [ "$1 $2" = "plugin list" ]; then cat ${JSON.stringify(path.join(home, 'listing.json'))}; fi`,
        `if [ "$1 $2 $3" = "plugin update alfred-code@${LEGACY_DIR}" ]; then exit 1; fi`,
        lands ? `if [ "$1 $2 $3" = "plugin update ${LEGACY_DIR}@${LEGACY_DIR}" ]; then mkdir -p ${JSON.stringify(path.join(land, 'stack', 'skills'))} ${JSON.stringify(path.join(land, 'stack', 'agents'))}; printf 'sha: x\\nref: main\\nversion: ${lands}\\n' > ${JSON.stringify(path.join(land, 'RELEASE-SOURCE'))}; fi` : '',
        'exit 0', ''].join('\n'), { mode: 0o755 });
    return bin + path.delimiter + process.env.PATH;
}
const WANT_1X = [`plugin update ${LEGACY_DIR}-hooks@${LEGACY_DIR} --scope user -y`, `plugin update ${LEGACY_DIR}@${LEGACY_DIR} --scope user -y`];

function runBashSnippet(home, PATH, extra = {}) {
    const script = path.join(home, 'resolve.sh');
    fs.writeFileSync(script, protocolSnippet('bash', 0));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH, ...extra };
    for (const k of ['ALFRED_CODE_SEED', 'CLAUDE_STACK_SEED']) if (!(k in extra)) delete env[k]; // legacy-name
    const out = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
    const m = out.match(/RESOLVED TMP=(\S+) (\S+) .*running=(\S+)/);
    assert.ok(m, `the snippet printed no RESOLVED line:\n${out}`);
    const mark = markOf(home);
    for (const p of [nativePath(m[1]), mark]) fs.rmSync(p, { recursive: true, force: true });
    assert.ok(!fs.existsSync(mark), `the run marker outlived the test: ${mark}`);
    return { version: m[2], running: m[3], seed: (out.match(/ seed=(\S+)/) || [])[1], key: (out.match(/ key=(\S+)/) || [])[1] };
}

test("the protocol's bash snippet updates each 1.x row by its OWN id and takes the 2.0.0 entry that lands under the old name", POSIX_STUB, () => {
    const home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        const r = runBashSnippet(home, stub1x(home, ROWS_1X, '2.0.0'));
        assert.strictEqual(r.version, '2.0.0', 'it read the 1.3.0 entry, not the 2.0.0 one the update landed');
        assert.strictEqual(r.running, '1.3.0', 'running= names the version this session loaded');
        assert.strictEqual(r.key, LEGACY_DIR, 'key= names the key the core is listed under - the 1.x one here');
        const calls = claudeCalls(home);
        assert.ok(calls.includes(`plugin marketplace update ${LEGACY_DIR}`), `the 1.x key's catalog was never refreshed: ${calls.join(' | ')}`);
        assert.deepStrictEqual(updatesIn(home), WANT_1X, calls.join(' | '));
        assert.ok(!calls.some((c) => c.startsWith('plugin update alfred-code')), 'the new ids are not installed yet - the seed installs the core');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// D1: the shell seed is refused from 2.0.0, under either spelling of the setting - so the resolve
// line reports either one, and the command bodies stop on it. No listing: key= is the fresh one.
test("the protocol's bash snippet reports the seed under either setting name, and key= with no core listed", POSIX_STUB, () => {
    for (const [extra, want] of [[{}, 'node'], [{ ALFRED_CODE_SEED: 'shell' }, 'shell'], [{ CLAUDE_STACK_SEED: 'shell' }, 'shell']]) // legacy-name
    {
        const home = work();
        try
        {
            plantBare(path.join(home, '.claude'), 'envoydev', 'alfred-code', '2.0.0');
            const r = runBashSnippet(home, stub1x(home, '[]'), extra);
            assert.strictEqual(r.seed, want, JSON.stringify(extra));
            assert.strictEqual(r.key, '?', 'no core row, no key to name');
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

test("the protocol's bash snippet reads the 1.x dir alone, and skips an orphaned dir newer than a valid one", POSIX_STUB, () => {
    for (const [plant, want] of [
        [(cfg) => plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '1.3.0'), '1.3.0'],
        [(cfg) => { plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '2.1.0', { orphaned: true }); plantBare(cfg, LEGACY_DIR, 'alfred-code', '2.0.0'); }, '2.0.0'],
    ])
    {
        const home = work();
        try
        {
            plant(path.join(home, '.claude'));
            assert.strictEqual(runBashSnippet(home, stub1x(home, '[]')).version, want);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

test("the protocol's PowerShell snippet updates each 1.x row by its own id, reads the 1.x dir and skips an orphaned one", { skip: skipNoPwsh || POSIX_STUB.skip }, () => {
    const run = (home, PATH) => {
        const script = path.join(home, 'resolve.ps1');
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-WAS=$Was"\nWrite-Output "PS-TMP=$TMP"\n`);
        const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH, CLAUDE_STACK_SEED: 'shell' }; // legacy-name
        delete env.ALFRED_CODE_SEED;
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], { cwd: home, encoding: 'utf8', env });
        fs.rmSync(out.match(/PS-TMP=(.+)/)[1].trim(), { recursive: true, force: true });
        const resolved = /RESOLVED TMP=\S+ \S* seed=(\S+) running=\S+ key=(\S+)/.exec(out) || [];
        return { version: (out.match(/PS-VER=(\S*)/) || [])[1], was: (out.match(/PS-WAS=(\S*)/) || [])[1], seed: resolved[1], key: resolved[2], out };
    };
    let home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        const r = run(home, stub1x(home, ROWS_1X, '2.0.0'));
        assert.strictEqual(r.version, '2.0.0', r.out);
        assert.strictEqual(r.was, '1.3.0', r.out);
        assert.strictEqual(r.seed, 'shell', `the 1.x seed setting is reported: ${r.out}`);
        assert.strictEqual(r.key, LEGACY_DIR, `key= names the 1.x key: ${r.out}`);
        assert.ok(claudeCalls(home).includes(`plugin marketplace update ${LEGACY_DIR}`), claudeCalls(home).join(' | '));
        assert.deepStrictEqual(updatesIn(home), WANT_1X, claudeCalls(home).join(' | '));
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
    home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        assert.strictEqual(run(home, stub1x(home, '[]')).version, '1.3.0', 'the 1.x dir alone');
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '2.1.0', { orphaned: true });
        plantBare(path.join(home, '.claude'), LEGACY_DIR, 'alfred-code', '2.0.0');
        assert.strictEqual(run(home, stub1x(home, '[]')).version, '2.0.0', 'an orphaned dir newer than a valid one');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the three body snippets read the 1.x cache dir too, and never an orphaned one', () => {
    const snippets = {
        capabilities: [bodySnippet('stack/skills/alfred-capture-agent-capabilities/SKILL.md', /```bash\n(CAPS=[\s\S]*?)node "\$CAPS"\n```/) + 'printf %s "$CAPS"', '/stack/skills/alfred-capture-agent-capabilities/scripts/capabilities-inventory.js'],
        firstLook: [bodySnippet('stack/skills/alfred-capture-first-look/SKILL.md', /```bash\n(SCAN=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$SCAN"', '/scripts/scan-evidence.js'],
        usage: [bodySnippet('stack/skills/alfred-capture-stack-usage/SKILL.md', /```bash\n(TMP=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/alfred-code\.XXXXXX"\)[^\n]*\nCFG=[\s\S]*?cut -f2\))\n/) + '\nrm -rf "$TMP"; printf %s "$SRC"', ''],
    };
    for (const [plant, want] of [
        [(cfg) => plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '1.3.0'), `/${LEGACY_DIR}/1.3.0`],
        [(cfg) => { plantBare(cfg, LEGACY_DIR, LEGACY_DIR, '2.1.0', { orphaned: true }); plantBare(cfg, LEGACY_DIR, 'alfred-code', '2.0.0'); }, '/alfred-code/2.0.0'],
    ])
    {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cache lookup '));
        try
        {
            plant(path.join(home, 'acct'));
            const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'acct') };
            for (const [name, [script, tail]] of Object.entries(snippets))
            {
                for (const sh of hasZsh ? ['bash', 'zsh'] : ['bash'])
                {
                    const got = execFileSync(sh, ['-c', script], { cwd: home, env, encoding: 'utf8' }).trim();
                    assert.ok(got.endsWith(`${want}${tail}`), `${sh} ${name}: took '${got}', want ...${want}${tail}`);
                }
            }
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});
