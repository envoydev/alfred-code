'use strict';
// THE SOURCE: what Claude Code already cached, then the release archive, then a clone.
//
// The stack used to keep its own extracted-snapshot cache under the account dir, plus a version
// probe and an adoption path for Claude Code's marketplace clone. Phase 5 of the plugin migration
// deleted all three: every marketplace entry shares this repo's root as its `source`, so installing
// the core plugin leaves the WHOLE repo at <config>/plugins/cache/<marketplace>/alfred-code/
// <version>, and that is the same snapshot the installer was
// downloading - with NO RELEASE-SOURCE (only the release archive carries one), so the fixtures below
// plant the version where a real entry holds it, its own setup-plugin/.claude-plugin/plugin.json. The archive and clone routes remain for the two paths with no plugin cache to read:
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
function plantVersion(dir, version) {
    const file = path.join(dir, 'setup-plugin', '.claude-plugin', 'plugin.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { manifest = { name: 'alfred-code' }; }
    fs.writeFileSync(file, JSON.stringify({ ...manifest, version }, null, 2));
}

function plantPluginCache(home, { version = VERSION, marketplace = 'envoydev', plugin = 'alfred-code', truncated = false } = {}) {
    const dir = path.join(home, '.claude', 'plugins', 'cache', marketplace, plugin, version);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', ARCHIVE, '-C', dir]);
    // The CLI names the directory after the release it installed, and the entry's own plugin.json says
    // the same thing - a real entry carries NO RELEASE-SOURCE (audit 2026-10-11: the resolve read only that
    // file and printed '?' in five sessions), so the archive's copy is removed and the version restated.
    fs.rmSync(path.join(dir, 'RELEASE-SOURCE'), { force: true });
    plantVersion(dir, version);
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
    // The PowerShell route lives beside the protocol (audit 2026-10-11: the whole-file read spilled past the Bash output cap).
    const file = lang === 'powershell' ? 'source-protocol-powershell.md' : 'source-protocol.md';
    const md = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', file), 'utf8');
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
        lands ? `if [ "$1 $2 $3" = "plugin update alfred-code@envoydev" ]; then cp -R ${JSON.stringify(path.join(cache, '0.10.0'))} ${JSON.stringify(path.join(cache, lands))}; printf '{"version": "${lands}"}\\n' > ${JSON.stringify(path.join(cache, lands, 'setup-plugin', '.claude-plugin', 'plugin.json'))}; fi` : '',
        'exit 0', ''].join('\n'), { mode: 0o755 });
    return bin + path.delimiter + process.env.PATH;
}
const claudeCalls = (home) => { try { return fs.readFileSync(path.join(home, 'claude-calls.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const CORE_ROW = (scope, version) => JSON.stringify([{ id: 'alfred-code@envoydev', version, scope, enabled: true }]);
// The core is updated at its own scope, and nothing else: a retired stack entry (serena) is pruned by the run, and
// preferred-tools - listed in the same catalog from its own repo - is the user's, updated on its own (the user's
// ruling of 2026-10-27). Not another project's row, and not the official marketplace's plugin of the same name.
const STACK_ROWS = (home) => JSON.stringify([
    { id: 'alfred-code@envoydev', version: '0.10.0', scope: 'user', enabled: true },
    { id: 'serena@envoydev', version: '0.10.0', scope: 'project', enabled: true, projectPath: fs.realpathSync(home) },
    { id: 'serena@envoydev', version: '0.9.0', scope: 'project', enabled: true, projectPath: '/elsewhere/another-project' },
    { id: 'serena@claude-plugins-official', version: '3.0.0', scope: 'user', enabled: true },
    { id: 'preferred-tools@envoydev', version: '0.1.0', scope: 'project', enabled: true, projectPath: fs.realpathSync(home) },
]);
const WANT_UPDATES = ['plugin update alfred-code@envoydev --scope user -y'];
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

// zsh aborts a whole `for` when ANY of its globs matches nothing, so a snippet naming a second glob
// beside the core's resolved to nothing on a machine where that one matched nothing (macOS's default
// shell) and curled the archive. A curl that fails and records itself makes that fallback loud.
const hasZsh = spawnSync('zsh', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0;
test("the protocol's bash snippet finds the plugin cache under zsh too", { skip: POSIX_STUB.skip || (!hasZsh && 'zsh not installed') }, () => {
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
        const manifestOf = (d) => fs.readFileSync(path.join(d, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8');
        assert.strictEqual(manifestOf(path.join(tmp, 'repo')), manifestOf(want), 'the copy did not come from the newest valid entry');
        assert.ok(!fs.existsSync(path.join(tmp, 'repo', 'RELEASE-SOURCE')), 'a plugin-cache copy carries no RELEASE-SOURCE - the version came from its plugin.json');
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
        const env = { ...process.env, TMPDIR: sbx, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: stubClaude(home, '[]'), CLAUDE_CODE_SESSION_ID: 'sess-a' };
        const first = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
        const m = first.match(/RESOLVED TMP=(\S+)/);
        assert.ok(m, first);
        tmps.push(m[1]);
        assert.deepStrictEqual(fs.readdirSync(sbx).filter((f) => f.startsWith('alfred-code-run.')).length, 1, 'the marker is under $TMPDIR');
        // macOS's own mktemp -d picks the per-user temp dir whatever $TMPDIR says (measured), so the
        // snippet names the directory in its template.
        assert.strictEqual(path.dirname(m[1]), sbx, '$TMP itself is under $TMPDIR');
        const second = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
        assert.match(second, new RegExp(`^REUSING TMP=${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 0\\.10\\.0 `, 'm'), 'the next call finds the same $TMP and names its version');
        // audit 2026-10-11 (sessions a9e06780 / bca100bd): a marker another session left - its cleanup rejected -
        // was reused 17 h later with a newer release installed. Only this session's own marker is reused.
        const other = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env: { ...env, CLAUDE_CODE_SESSION_ID: 'sess-b' } });
        const fresh = other.match(/^RESOLVED TMP=(\S+) /m);
        assert.ok(fresh, `another session's marker was reused:\n${other}`);
        tmps.push(fresh[1]);
        assert.notStrictEqual(fresh[1], m[1], 'a fresh resolve gets its own $TMP');
        // A marker written before the session check names no session: it resolves fresh too.
        fs.rmSync(path.join(fresh[1], 'run-session'));
        const legacy = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env: { ...env, CLAUDE_CODE_SESSION_ID: 'sess-b' } });
        const again = legacy.match(/^RESOLVED TMP=(\S+) /m);
        assert.ok(again, `a marker with no session was reused:\n${legacy}`);
        tmps.push(again[1]);
    }
    finally
    {
        for (const p of tmps) fs.rmSync(p, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    }
});

// audit 2026-10-11, session 5b9ce9c5: the Windows Bash tool handed the shell a Windows-form PATH
// (`C:\...;C:\...`), so no coreutils and no node resolved - and the block ran on, printing a success-shaped
// `RESOLVED TMP= ?` over an empty marker (216k to repair). The PATH is set INSIDE the shell, the way that
// session met it, so the case runs on every OS: where the heal finds every tool the run resolves for real,
// and where it cannot (no node under /usr/bin, no cygpath) the call stops on one MISSING line, writes no
// marker and never prints RESOLVED.
test("the protocol's bash snippet heals or stops on a Windows-form PATH - never a success line over an empty $TMP", () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    try
    {
        plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const mark = markOf(home);
        const r = spawnSync('bash', ['-c', `PATH='C:\\Windows\\system32;C:\\nowhere\\nodejs'; . "$1"`, 'resolve', script], {
            cwd: home, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude') },
        });
        const out = `${r.stdout}${r.stderr}`;
        assert.doesNotMatch(out, /RESOLVED TMP= /, `a success line with an empty $TMP:\n${out}`);
        const missing = /^MISSING (\S+) on the Bash PATH - nothing resolved$/m.exec(r.stdout);
        if (missing)
        {
            assert.strictEqual(r.status, 1, out);
            assert.ok(!fs.existsSync(mark), 'a stopped resolve wrote the marker');
            assert.doesNotMatch(r.stdout, /RESOLVED|REUSING/, out);
        }
        else
        {
            const m = /^RESOLVED TMP=(\S+) 0\.10\.0 /m.exec(r.stdout);
            assert.ok(m, `neither a MISSING line nor a full resolve:\n${out}`);
            fs.rmSync(nativePath(m[1]), { recursive: true, force: true });
        }
        fs.rmSync(mark, { force: true });
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// The same session's PATH with mktemp failing: before, an empty TMP and a cache hit ran `cp -R "$SRC" "/repo"` and wrote
// an empty marker. Now the call stops before any copy or marker write.
test("the protocol's bash snippet stops on an empty $TMP before any copy or marker write", POSIX_STUB, () => {
    const home = work();
    const script = path.join(home, 'resolve.sh');
    try
    {
        plantThree(home);
        fs.writeFileSync(script, protocolSnippet('bash', 0));
        const bin = stubClaude(home, '[]');
        fs.writeFileSync(path.join(home, 'bin', 'mktemp'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const mark = markOf(home);
        const r = spawnSync('bash', [script], { cwd: home, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH: bin } });
        assert.strictEqual(r.status, 1, `${r.stdout}${r.stderr}`);
        assert.match(r.stdout, /^MISSING a temp dir under \S+ - nothing resolved$/m);
        assert.doesNotMatch(r.stdout, /RESOLVED|REUSING/);
        assert.ok(!fs.existsSync(mark), 'the marker was written over an empty $TMP');
        assert.ok(!claudeCalls(home).some((c) => /^plugin update /.test(c)), 'it went on to update plugins');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
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
                fs.mkdirSync(path.join(skills, 'capture-awareness', 'scripts'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'capture-awareness', 'scripts', 'capabilities-inventory.js'), '');
                fs.mkdirSync(path.join(skills, 'task-solve-cross', 'references'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'task-solve-cross', 'references', 'contract-protocol.md'), '');
            }
            const newest = versions[versions.length - 1].replace(/\./g, '\\.');
            const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'acct') };
            // The capabilities block with its last line - the run - swapped for a print.
            const caps = bodySnippet('stack/skills/capture-awareness/SKILL.md', /```bash\n(CAPS=[\s\S]*?)echo "caps: \$\{CAPS:-absent\}"\n```/);
            assert.match(execFileSync('bash', ['-c', `${caps}printf %s "$CAPS"`], { cwd: home, env, encoding: 'utf8' }),
                new RegExp(`/${newest}/stack/skills/capture-awareness/scripts/capabilities-inventory\\.js$`), `capabilities: not the newest of ${versions}`);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

// --- the cache dir under any marketplace key, and the one a removed id orphans ----------------------
// The core is cached at cache/<key>/alfred-code/<v>, and a machine can hold it under more than one key.
// A dir the CLI no longer serves is marked `.orphaned_at` with its files KEPT (S3). So every lookup reads
// every key, newest valid first, and never takes an orphaned one - a stale copy must never serve a run.
const { pluginCache } = require('./install/source.js');
const OTHER_KEY = 'other-key';

// A bare cache entry: the two trees the validity test reads, and the RELEASE-SOURCE the snippets print.
function plantBare(cfg, marketplace, plugin, version, { orphaned = false, file } = {}) {
    const dir = path.join(cfg, 'plugins', 'cache', marketplace, plugin, version);
    for (const sub of ['stack/skills', 'stack/agents', 'scripts', 'stack/skills/capture-awareness/scripts', 'stack/skills/task-solve-cross/references'])
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
    plantVersion(dir, version);   // a real cache entry: the version in plugin.json, no RELEASE-SOURCE
    for (const f of ['scripts/scan-evidence.js', 'stack/skills/capture-awareness/scripts/capabilities-inventory.js', 'stack/skills/task-solve-cross/references/contract-protocol.md'])
        fs.writeFileSync(path.join(dir, f), file || '');
    if (orphaned) fs.writeFileSync(path.join(dir, '.orphaned_at'), '1790246851942');
    return dir;
}

test('pluginCache takes the newest valid alfred-code entry across every marketplace key, and no other plugin dir', () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-keys-'));
    try
    {
        assert.strictEqual(pluginCache(cfg), null, 'an empty config dir is no snapshot');
        const other = plantBare(cfg, OTHER_KEY, 'alfred-code', '2.0.0');
        assert.strictEqual(pluginCache(cfg), other, 'a core cached under another key is still the snapshot');
        const newer = plantBare(cfg, 'envoydev', 'alfred-code', '2.10.0');
        assert.strictEqual(pluginCache(cfg), newer, 'newest by VERSION across keys, not by name');
        plantBare(cfg, 'envoydev', 'serena', '9.0.0');
        assert.strictEqual(pluginCache(cfg), newer, 'another plugin\'s dir is never the snapshot');
    }
    finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

test('pluginCache skips a version dir marked .orphaned_at - a stale copy never serves a run', () => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-orphan-'));
    try
    {
        plantBare(cfg, OTHER_KEY, 'alfred-code', '2.1.0', { orphaned: true });
        plantBare(cfg, 'envoydev', 'alfred-code', '2.2.0', { orphaned: true });
        assert.strictEqual(pluginCache(cfg), null, 'an orphaned dir alone is no snapshot - the archive route answers instead');
        const valid = plantBare(cfg, OTHER_KEY, 'alfred-code', '2.0.0');
        assert.strictEqual(pluginCache(cfg), valid, 'the orphaned dirs are newer by version and still passed over');
    }
    finally { fs.rmSync(cfg, { recursive: true, force: true }); }
});

function runBashSnippet(home, PATH, extra = {}) {
    const script = path.join(home, 'resolve.sh');
    fs.writeFileSync(script, protocolSnippet('bash', 0));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH, ...extra };
    if (!('ALFRED_CODE_SEED' in extra)) delete env.ALFRED_CODE_SEED;
    const out = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env });
    const m = out.match(/RESOLVED TMP=(\S+) (\S+) .*running=(\S+)/);
    assert.ok(m, `the snippet printed no RESOLVED line:\n${out}`);
    const mark = markOf(home);
    for (const p of [nativePath(m[1]), mark]) fs.rmSync(p, { recursive: true, force: true });
    assert.ok(!fs.existsSync(mark), `the run marker outlived the test: ${mark}`);
    return { version: m[2], running: m[3], seed: (out.match(/ seed=(\S+)/) || [])[1], key: (out.match(/ key=(\S+)/) || [])[1] };
}

// D1: the shell seed is refused from 2.0.0 - so the resolve line reports the setting, and the command
// bodies stop on it. An empty setting is unset. No listing: key= is the fresh one.
test("the protocol's bash snippet reports the seed setting, and key= with no core listed", POSIX_STUB, () => {
    for (const [extra, want] of [[{}, 'node'], [{ ALFRED_CODE_SEED: '' }, 'node'], [{ ALFRED_CODE_SEED: 'shell' }, 'shell']])
    {
        const home = work();
        try
        {
            plantBare(path.join(home, '.claude'), 'envoydev', 'alfred-code', '2.0.0');
            const r = runBashSnippet(home, stubClaude(home, '[]'), extra);
            assert.strictEqual(r.seed, want, JSON.stringify(extra));
            assert.strictEqual(r.key, '?', 'no core row, no key to name');
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

test("the protocol's bash snippet reads a core cached under another key, and skips an orphaned dir newer than a valid one", POSIX_STUB, () => {
    for (const [plant, want] of [
        [(cfg) => plantBare(cfg, OTHER_KEY, 'alfred-code', '1.3.0'), '1.3.0'],
        [(cfg) => { plantBare(cfg, 'envoydev', 'alfred-code', '2.1.0', { orphaned: true }); plantBare(cfg, OTHER_KEY, 'alfred-code', '2.0.0'); }, '2.0.0'],
    ])
    {
        const home = work();
        try
        {
            plant(path.join(home, '.claude'));
            assert.strictEqual(runBashSnippet(home, stubClaude(home, '[]')).version, want);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

test("the protocol's PowerShell snippet reads a core cached under another key, skips an orphaned dir and reports the seed", { skip: skipNoPwsh || POSIX_STUB.skip }, () => {
    const run = (home, PATH) => {
        const script = path.join(home, 'resolve.ps1');
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-TMP=$TMP"\n`);
        const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH, ALFRED_CODE_SEED: 'shell' };
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], { cwd: home, encoding: 'utf8', env });
        fs.rmSync(out.match(/PS-TMP=(.+)/)[1].trim(), { recursive: true, force: true });
        const resolved = /RESOLVED TMP=\S+ \S* seed=(\S+) running=\S+ key=(\S+)/.exec(out) || [];
        return { version: (out.match(/PS-VER=(\S*)/) || [])[1], seed: resolved[1], key: resolved[2], out };
    };
    const home = work();
    try
    {
        plantBare(path.join(home, '.claude'), OTHER_KEY, 'alfred-code', '1.3.0');
        const r = run(home, stubClaude(home, '[]'));
        assert.strictEqual(r.version, '1.3.0', `a core cached under another key: ${r.out}`);
        assert.strictEqual(r.seed, 'shell', `the seed setting is reported: ${r.out}`);
        assert.strictEqual(r.key, '?', `no core row, no key to name: ${r.out}`);
        plantBare(path.join(home, '.claude'), 'envoydev', 'alfred-code', '2.1.0', { orphaned: true });
        plantBare(path.join(home, '.claude'), OTHER_KEY, 'alfred-code', '2.0.0');
        assert.strictEqual(run(home, stubClaude(home, '[]')).version, '2.0.0', 'an orphaned dir newer than a valid one');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// Audit 2026-10-14 SKC10: the four lookups that still spelled `*/alfred-code/*` now share the one-glob form of the
// others, registered as `plugin-cache-newest-entry`; each still takes the newest entry and never an orphaned one.
test('the aligned lookups (run book, AGENTS.md check, both spec checks) read a core cached under any key, never an orphaned one', () => {
    const snippets = {
        runBook: [bodySnippet('stack/skills/capture-awareness/references/project.md', /```bash\n( *SCAN=\$\(for d in[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$SCAN"', '/scripts/scan-evidence.js'],
        agentsMd: [bodySnippet('stack/skills/habits-adjust-agents-md/SKILL.md', /```bash\n(STACK=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$STACK"', ''],
        solve: ['SPEC=.claude/skills/task-solve/scripts/spec-check.js\n' + bodySnippet('stack/skills/task-solve/references/full-spec.md', /\n(\[ -f "\$SPEC" \] \|\| SPEC=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$SPEC"', '/stack/skills/task-solve/scripts/spec-check.js'],
        cross: ['SPEC=.claude/skills/task-solve-cross/scripts/spec-check.js\n' + bodySnippet('stack/skills/task-solve-cross/references/full-spec.md', /\n(\[ -f "\$SPEC" \] \|\| SPEC=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$SPEC"', '/stack/skills/task-solve-cross/scripts/spec-check.js'],
        // capture-quality's chain resolves its state script the same way (2026-10-29)
        quality: [bodySnippet('stack/skills/capture-quality/SKILL.md', /\n( *QS=\.claude\/skills\/capture-quality\/scripts\/quality-state\.js\n *\[ -f "\$QS" \] \|\| QS=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$QS"', '/stack/skills/capture-quality/scripts/quality-state.js'],
    };
    const plantAll = (cfg, marketplace, version, opts) => {
        const dir = plantBare(cfg, marketplace, 'alfred-code', version, opts);
        for (const f of ['scripts/agents-md-check.js', 'stack/skills/task-solve/scripts/spec-check.js', 'stack/skills/task-solve-cross/scripts/spec-check.js', 'stack/skills/capture-quality/scripts/quality-state.js'])
        {
            fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
            fs.writeFileSync(path.join(dir, f), '');
        }
    };
    for (const [plant, want] of [
        [(cfg) => plantAll(cfg, OTHER_KEY, '1.3.0'), `/${OTHER_KEY}/alfred-code/1.3.0`],
        [(cfg) => { plantAll(cfg, 'envoydev', '2.1.0', { orphaned: true }); plantAll(cfg, OTHER_KEY, '2.0.0'); }, `/${OTHER_KEY}/alfred-code/2.0.0`],
    ])
    {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cache lookup '));
        try
        {
            plant(path.join(home, 'acct'));
            const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'acct') };
            for (const [name, [script, tail]] of Object.entries(snippets))
                for (const sh of hasZsh ? ['bash', 'zsh'] : ['bash'])
                {
                    const got = execFileSync(sh, ['-c', script], { cwd: home, env, encoding: 'utf8' }).trim();
                    assert.ok(got.endsWith(`${want}${tail}`), `${sh} ${name}: took '${got}', want ...${want}${tail}`);
                }
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
    const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'shared-rules.json'), 'utf8')).rules['plugin-cache-newest-entry'];
    assert.strictEqual(entry.sites.length, 7, 'seven skill sites beside the source protocol (capture-quality\'s chain the seventh)');
});

test('the three body snippets read a core cached under any key, and never an orphaned one', () => {
    const snippets = {
        capabilities: [bodySnippet('stack/skills/capture-awareness/SKILL.md', /```bash\n(CAPS=[\s\S]*?)echo "caps: \$\{CAPS:-absent\}"\n```/) + 'printf %s "$CAPS"', '/stack/skills/capture-awareness/scripts/capabilities-inventory.js'],
        usage: [bodySnippet('stack/skills/capture-usage-report/SKILL.md', /```bash\n(TMP=\$\(mktemp -d "\$\{TMPDIR:-\/tmp\}\/alfred-code\.XXXXXX"\)[^\n]*\nCFG=[\s\S]*?cut -f2\))\n/) + '\nrm -rf "$TMP"; printf %s "$SRC"', ''],
    };
    for (const [plant, want] of [
        [(cfg) => plantBare(cfg, OTHER_KEY, 'alfred-code', '1.3.0'), `/${OTHER_KEY}/alfred-code/1.3.0`],
        [(cfg) => { plantBare(cfg, 'envoydev', 'alfred-code', '2.1.0', { orphaned: true }); plantBare(cfg, OTHER_KEY, 'alfred-code', '2.0.0'); }, `/${OTHER_KEY}/alfred-code/2.0.0`],
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
