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
// These tests drive the REAL installers against a local HTTP fixture that speaks the release
// endpoints and COUNTS asset hits, which is what proves a run downloaded nothing.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SH = path.join(ROOT, 'scripts', 'os', 'claude-stack.sh');
const PS1 = path.join(ROOT, 'scripts', 'os', 'claude-stack.ps1');
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
const ZIP = path.join(FIXTURE, 'alfred-code.zip');
execFileSync('git', ['-C', ROOT, 'archive', '--format=zip', `--add-file=${RELEASE_SOURCE}`, '-o', ZIP, 'HEAD'], { stdio: 'ignore' });
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

// A GitHub-shaped release host: /releases/latest 302s to the tag (that redirect IS the version
// probe), /releases/latest/download/<asset> serves the archive. It runs in its OWN PROCESS and
// records each request in a log file: the installers are driven with execFileSync, which blocks
// this process's event loop, so an in-process server could never answer them. `tag: 'none'` makes
// the probe unanswerable - the fork / offline / file:// shape the cache has to degrade through.
const SERVER_JS = path.join(FIXTURE, 'release-host.js');
fs.writeFileSync(SERVER_JS, `
const http = require('node:http'), fs = require('node:fs');
const [archive, zip, logFile, portFile, tag] = process.argv.slice(2);
const hit = kind => fs.appendFileSync(logFile, kind + '\\n');
http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/releases/latest') {
        hit('probe');
        if (tag === 'none') { res.writeHead(404); res.end(); return; }
        res.writeHead(302, { location: '/releases/tag/' + tag }); res.end(); return;
    }
    if (url.startsWith('/releases/tag/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
    if (url === '/releases/latest/download/claude-stack.tar.gz' || url === '/releases/latest/download/claude-stack.zip') { // legacy-name - only the frozen twins download here
        hit('asset');
        const body = fs.readFileSync(url.endsWith('.zip') ? zip : archive);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
        if (req.method === 'HEAD') { res.end(); return; }
        res.end(body); return;
    }
    res.writeHead(404); res.end();
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(portFile, String(this.address().port)); });
`);

// a synchronous sleep that does not need a `sleep` binary (Windows runners have none)
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

let hostSeq = 0;
function startHost({ tag = `v${VERSION}` } = {}) {
    const id = `h${++hostSeq}`;
    const logFile = path.join(FIXTURE, `${id}.log`);
    const portFile = path.join(FIXTURE, `${id}.port`);
    fs.writeFileSync(logFile, '');
    const child = spawn(process.execPath, [SERVER_JS, ARCHIVE, ZIP, logFile, portFile, tag ?? 'none'], { stdio: 'ignore' });
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(portFile) && Date.now() < deadline) sleepSync(20);
    assert.ok(fs.existsSync(portFile), 'the release host came up');
    const count = kind => fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l === kind).length;
    return {
        url: `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8').trim()}`,
        get assets() { return count('asset'); },
        get probes() { return count('probe'); },
        close: () => child.kill(),
    };
}

function work() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srccache-'));
    fs.writeFileSync(path.join(dir, 'sel.txt'), 'skill csharp\n');
    return dir;
}

// One install run of the sh twin, HOME isolated so the cache lands in this run's own account dir.
// The COPY route on purpose: this file proves which SOURCE a run resolved (archive, cache, clone,
// offline), and it reads that through a skill landing in .claude/skills. On the default plugin
// route a stack skill is carried by a plugin instead of copied, so the same assertion would say
// nothing about the source. The delivery route has its own proofs (mcp-verify.test.js, the matrix).
function runSh(home, host, env = {}) {
    return execFileSync('bash', [SH, 'install', '--scope', 'project', '--selection', path.join(home, 'sel.txt'), '--skills-only'], {
        cwd: home,
        encoding: 'utf8',
        env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, CLAUDE_CONFIG_DIR: '',
            CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false', CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false', ...env }, // legacy-name - the twin's own switches
    });
}

function cacheEntries(home) {
    const root = path.join(home, '.claude', 'cache', 'stack-source');
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
        .flatMap(slug => fs.readdirSync(path.join(root, slug)).map(v => path.join(root, slug, v)))
        .filter(p => fs.statSync(p).isDirectory());
}

function installedSkill(home) {
    return fs.existsSync(path.join(home, '.claude', 'skills', 'csharp', 'SKILL.md'));
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

// The frozen twins read the 1.x layout, cache/<marketplace>/claude-stack/<version>.
const TWIN_CACHE = { marketplace: 'claude-stack', plugin: 'claude-stack' }; // legacy-name

test('the plugin cache is the source, and nothing is downloaded', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, TWIN_CACHE);
        const out = runSh(home, host);
        assert.match(out, /source: plugin cache/, 'the run did not read the cache Claude Code left');
        assert.strictEqual(host.assets, 0, 'an archive was fetched although the cache was there');
        assert.strictEqual(host.probes, 0, 'the version probe is gone - the cache needs no release lookup');
        assert.ok(installedSkill(home), 'and it installed from it');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('the newest version directory wins when the cache holds several', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, { ...TWIN_CACHE, version: '0.9.0' });
        plantPluginCache(home, { ...TWIN_CACHE, version: '0.10.0' });   // newer by VERSION order, older by string order
        const out = runSh(home, host);
        assert.match(out, /source: plugin cache .*0\.10\.0/, `the older entry was taken:\n${out}`);
        assert.strictEqual(host.assets, 0);
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('a half-written cache entry is rejected and the archive is taken instead', () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, { ...TWIN_CACHE, truncated: true });
        const out = runSh(home, host);
        assert.doesNotMatch(out, /source: plugin cache/, 'a broken entry was installed from');
        assert.match(out, /releases\/latest\/download/, 'the archive is the fallback');
        assert.strictEqual(host.assets, 1);
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('no cache at all still installs, from the archive', () => {
    const host = startHost();
    const home = work();
    try
    {
        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/);
        assert.strictEqual(host.assets, 1, 'exactly one download');
        assert.ok(installedSkill(home));
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// The stack keeps no cache of its own any more: a run must leave nothing behind under the old
// location, or a later release would read a snapshot nothing maintains.
test('no run writes the retired stack-source cache', () => {
    const host = startHost();
    const home = work();
    try
    {
        runSh(home, host);
        assert.deepStrictEqual(cacheEntries(home), [], 'the retired cache layout was written again');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('an unanswerable version probe is no longer a factor - the archive still installs', () => {
    const host = startHost({ tag: 'none' });
    const home = work();
    try
    {
        const out = runSh(home, host);
        assert.match(out, /releases\/latest\/download/);
        assert.ok(installedSkill(home), 'a fork with no tag still installs');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

test('the ps1 twin reads the same plugin cache', { skip: skipNoPwsh }, () => {
    const host = startHost();
    const home = work();
    try
    {
        plantPluginCache(home, TWIN_CACHE);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', PS1, 'install', '-Scope', 'project',
            '-Selection', path.join(home, 'sel.txt'), '-SkillsOnly'], {
            cwd: home,
            encoding: 'utf8',
            env: { ...process.env, STACK_SKILLS_REPO: host.url, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: '',
                CLAUDE_STACK_SKILLS_VIA_PLUGIN: 'false', CLAUDE_STACK_HOOKS_VIA_PLUGIN: 'false' }, // legacy-name - the twin's own switches
        });
        assert.match(out, /source: plugin cache/, 'ps1: the cache was not read');
        assert.strictEqual(host.assets, 0, 'ps1: an archive was fetched anyway');
    }
    finally { host.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

// The guided walks do not run the installer's resolver - each command body pastes its own snippet
// from setup-plugin/references/source-protocol.md, one per platform. Three copies of one rule is
// exactly where they drift, and a drifted walk silently pays a download the installer would not.
// So run the protocol's OWN snippets against a planted cache and assert they land where the twins
// land: the newest valid entry, the half-written one rejected, nothing fetched.
function protocolSnippet(lang, index) {
    const md = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
    const blocks = [...md.matchAll(/```(bash|powershell)\n([\s\S]*?)```/g)].filter(m => m[1] === lang);
    assert.ok(blocks[index], `source-protocol.md has no ${lang} block #${index}`);
    return blocks[index][2];
}

// The same three entries both snippets and both twins have to agree on.
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
        const mark = `/tmp/alfred-code-run.${home.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.path`;
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

test("the protocol's bash snippet resolves the same entry as the sh twin", () => {
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
        assert.strictEqual(m[2], '0.10.0', 'it read a different version than the twins take');
        assert.ok(fs.existsSync(path.join(tmp, 'repo', 'stack', 'skills')), 'nothing was copied into $TMP/repo');
        assert.ok(!fs.existsSync(path.join(tmp, 'alfred-code.tar.gz')), 'it downloaded the archive over a usable cache');
        assert.strictEqual(
            fs.readFileSync(path.join(tmp, 'repo', 'RELEASE-SOURCE'), 'utf8'),
            fs.readFileSync(path.join(want, 'RELEASE-SOURCE'), 'utf8'),
            'the copy did not come from the newest valid entry');
    }
    finally
    {
        const mark = nativePath(`/tmp/alfred-code-run.${home.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.path`);
        for (const p of [tmp, mark]) if (p) fs.rmSync(p, { recursive: true, force: true });
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
        assert.match(out, /PS-VER=0\.10\.0/, `the ps twin read a different version:\n${out}`);
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

// Two more bodies find a file of their own in the plugin cache: the capabilities inventory script
// and the cross-task protocol the integration reviewer gates against. `find | head -1` took whichever
// cached version the filesystem listed first, and the reviewer looked only where the COPY route puts
// skills, so on the plugin route it always ran its reduced fallback. Both now take the newest entry
// the way the protocol does - sort -V, not listing order and not lexical order - so each body's own
// snippet runs here against two planted caches: one where listing order is wrong (0.2.84 before
// 1.0.0), one where lexical order is wrong (0.9.0 after 0.10.0).
function bodySnippet(file, re) {
    const m = fs.readFileSync(path.join(ROOT, file), 'utf8').match(re);
    assert.ok(m, `${file}: its plugin-cache lookup snippet is missing`);
    return m[1];
}

test('the capabilities script and the reviewer protocol resolve to the NEWEST cached entry', () => {
    for (const versions of [['0.2.84', '1.0.0'], ['0.9.0', '0.10.0']])
    {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cache lookup '));
        try
        {
            for (const v of versions)
            {
                const skills = path.join(home, 'acct', 'plugins', 'cache', 'envoydev', 'alfred-code', v, 'stack', 'skills');
                fs.mkdirSync(path.join(skills, 'project-agent-capabilities', 'scripts'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'project-agent-capabilities', 'scripts', 'capabilities-inventory.js'), '');
                fs.mkdirSync(path.join(skills, 'project-solve-cross-task', 'references'), { recursive: true });
                fs.writeFileSync(path.join(skills, 'project-solve-cross-task', 'references', 'contract-protocol.md'), '');
            }
            const newest = versions[versions.length - 1].replace(/\./g, '\\.');
            const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, 'acct') };
            // The capabilities block with its last line - the run - swapped for a print.
            const caps = bodySnippet('stack/skills/project-agent-capabilities/SKILL.md', /```bash\n(CAPS=[\s\S]*?)node "\$CAPS"\n```/);
            assert.match(execFileSync('bash', ['-c', `${caps}printf %s "$CAPS"`], { cwd: home, env, encoding: 'utf8' }),
                new RegExp(`/${newest}/stack/skills/project-agent-capabilities/scripts/capabilities-inventory\\.js$`), `capabilities: not the newest of ${versions}`);
            const rev = bodySnippet('stack/agents/integration-reviewer.md', /`(for d in [^`]*?cut -f2)`/);
            assert.match(execFileSync('bash', ['-c', rev], { cwd: home, env, encoding: 'utf8' }).trim(),
                new RegExp(`/${newest}$`), `reviewer: not the newest of ${versions}`);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

// --- 2.0.0: a 1.x install's cache dir, and the one the rename orphans -------------------------------
// A 1.x install cached the stack at cache/<key>/claude-stack/<v>. After the rename plus one session the // legacy-name
// CLI marks that dir `.orphaned_at` but KEEPS its files, and the new cache/<key>/alfred-code/<v> exists
// only once `plugin update alfred-code@<key>` runs (docs/rebrand-evidence.md S3, S8). So every lookup
// reads BOTH dirs, newest valid first, and never takes an orphaned one - a stale 1.x copy must never
// serve a 2.0.0 run. The listing names a pending rename on the OLD row (S9), and the old id fails
// `not_found` (S2): a renamed row is updated by the new id the note names.
const { pluginCache } = require('./install/source.js');
const LEGACY_DIR = 'claude-stack'; // legacy-name - the 1.x core's cache dir and marketplace key

// A bare cache entry: the two trees the validity test reads, and the RELEASE-SOURCE the snippets print.
function plantBare(cfg, marketplace, plugin, version, { orphaned = false, file } = {}) {
    const dir = path.join(cfg, 'plugins', 'cache', marketplace, plugin, version);
    for (const sub of ['stack/skills', 'stack/agents', 'scripts', 'stack/skills/project-agent-capabilities/scripts', 'stack/skills/project-solve-cross-task/references'])
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, 'RELEASE-SOURCE'), `sha: x\nref: main\nversion: ${version}\n`);
    for (const f of ['scripts/scan-evidence.js', 'stack/skills/project-agent-capabilities/scripts/capabilities-inventory.js', 'stack/skills/project-solve-cross-task/references/contract-protocol.md'])
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

// A recording `claude` for a 1.x account after the catalog refresh: `plugin list` prints the OLD ids
// with the plugin-renamed note (S9), the old id fails, and `plugin update alfred-code@claude-stack` // legacy-name
// lands cache/claude-stack/alfred-code/<lands> - what S8 measured. // legacy-name
const RENAMED_ROWS = JSON.stringify(['claude-stack', 'claude-stack-hooks'].map((name) => ({ // legacy-name
    id: `${name}@${LEGACY_DIR}`, version: '1.3.0', scope: 'user', enabled: true,
    notes: [`Renamed to "${name.replace(LEGACY_DIR, 'alfred-code')}" in the "${LEGACY_DIR}" marketplace`],
    noteDetails: [{ type: 'plugin-renamed', plugin: name, marketplace: LEGACY_DIR, related: name.replace(LEGACY_DIR, 'alfred-code') }],
})));
function stubRenamed(home, listing, lands) {
    const bin = path.join(home, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(home, 'listing.json'), listing);
    const land = path.join(home, '.claude', 'plugins', 'cache', LEGACY_DIR, 'alfred-code', lands || 'none');
    fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh',
        `printf '%s\\n' "$*" >> ${JSON.stringify(path.join(home, 'claude-calls.log'))}`,
        `if [ "$1 $2" = "plugin list" ]; then cat ${JSON.stringify(path.join(home, 'listing.json'))}; fi`,
        `if [ "$1 $2 $3" = "plugin update ${LEGACY_DIR}@${LEGACY_DIR}" ]; then exit 1; fi`,
        lands ? `if [ "$1 $2 $3" = "plugin update alfred-code@${LEGACY_DIR}" ]; then mkdir -p ${JSON.stringify(path.join(land, 'stack', 'skills'))} ${JSON.stringify(path.join(land, 'stack', 'agents'))}; printf 'sha: x\\nref: main\\nversion: ${lands}\\n' > ${JSON.stringify(path.join(land, 'RELEASE-SOURCE'))}; fi` : '',
        'exit 0', ''].join('\n'), { mode: 0o755 });
    return bin + path.delimiter + process.env.PATH;
}
const WANT_RENAMED = [`plugin update alfred-code-hooks@${LEGACY_DIR} --scope user -y`, `plugin update alfred-code@${LEGACY_DIR} --scope user -y`];

function runBashSnippet(home, PATH) {
    const script = path.join(home, 'resolve.sh');
    fs.writeFileSync(script, protocolSnippet('bash', 0));
    const out = execFileSync('bash', [script], { cwd: home, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH } });
    const m = out.match(/RESOLVED TMP=(\S+) (\S+) .*running=(\S+)/);
    assert.ok(m, `the snippet printed no RESOLVED line:\n${out}`);
    const mark = `/tmp/alfred-code-run.${home.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.path`;
    for (const p of [nativePath(m[1]), mark]) fs.rmSync(p, { recursive: true, force: true });
    return { version: m[2], running: m[3] };
}

test("the protocol's bash snippet updates a renamed 1.x row by its NEW id and takes the entry that lands under the old key", POSIX_STUB, () => {
    const home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        const r = runBashSnippet(home, stubRenamed(home, RENAMED_ROWS, '2.0.0'));
        assert.strictEqual(r.version, '2.0.0', 'it read the 1.x entry, not the renamed one the update landed');
        assert.strictEqual(r.running, '1.3.0', 'running= names the version this session loaded');
        const calls = claudeCalls(home);
        assert.ok(calls.includes(`plugin marketplace update ${LEGACY_DIR}`), `the 1.x key's catalog was never refreshed: ${calls.join(' | ')}`);
        assert.deepStrictEqual(updatesIn(home), WANT_RENAMED, calls.join(' | '));
        assert.ok(!calls.some((c) => c.startsWith(`plugin update ${LEGACY_DIR}@`)), 'the old id fails not_found - it is never used');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
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
            assert.strictEqual(runBashSnippet(home, stubRenamed(home, '[]')).version, want);
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});

test("the protocol's PowerShell snippet follows the rename, reads the 1.x dir and skips an orphaned one", { skip: skipNoPwsh || POSIX_STUB.skip }, () => {
    const run = (home, PATH) => {
        const script = path.join(home, 'resolve.ps1');
        fs.writeFileSync(script, `${protocolSnippet('powershell', 0)}\nWrite-Output "PS-VER=$Ver"\nWrite-Output "PS-WAS=$Was"\nWrite-Output "PS-TMP=$TMP"\n`);
        const out = execFileSync('pwsh', ['-NoProfile', '-File', script], { cwd: home, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PATH } });
        fs.rmSync(out.match(/PS-TMP=(.+)/)[1].trim(), { recursive: true, force: true });
        return { version: (out.match(/PS-VER=(\S*)/) || [])[1], was: (out.match(/PS-WAS=(\S*)/) || [])[1], out };
    };
    let home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        const r = run(home, stubRenamed(home, RENAMED_ROWS, '2.0.0'));
        assert.strictEqual(r.version, '2.0.0', r.out);
        assert.strictEqual(r.was, '1.3.0', r.out);
        assert.ok(claudeCalls(home).includes(`plugin marketplace update ${LEGACY_DIR}`), claudeCalls(home).join(' | '));
        assert.deepStrictEqual(updatesIn(home), WANT_RENAMED, claudeCalls(home).join(' | '));
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
    home = work();
    try
    {
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '1.3.0');
        assert.strictEqual(run(home, stubRenamed(home, '[]')).version, '1.3.0', 'the 1.x dir alone');
        plantBare(path.join(home, '.claude'), LEGACY_DIR, LEGACY_DIR, '2.1.0', { orphaned: true });
        plantBare(path.join(home, '.claude'), LEGACY_DIR, 'alfred-code', '2.0.0');
        assert.strictEqual(run(home, stubRenamed(home, '[]')).version, '2.0.0', 'an orphaned dir newer than a valid one');
    }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the four body snippets read the 1.x cache dir too, and never an orphaned one', () => {
    const snippets = {
        capabilities: [bodySnippet('stack/skills/project-agent-capabilities/SKILL.md', /```bash\n(CAPS=[\s\S]*?)node "\$CAPS"\n```/) + 'printf %s "$CAPS"', '/stack/skills/project-agent-capabilities/scripts/capabilities-inventory.js'],
        firstLook: [bodySnippet('stack/skills/project-first-look/SKILL.md', /```bash\n(SCAN=[\s\S]*?cut -f2\))\n/) + '\nprintf %s "$SCAN"', '/scripts/scan-evidence.js'],
        usage: [bodySnippet('stack/skills/project-stack-usage-analyzer/SKILL.md', /```bash\n(TMP=\$\(mktemp -d\)\nCFG=[\s\S]*?cut -f2\))\n/) + '\nrm -rf "$TMP"; printf %s "$SRC"', ''],
        reviewer: [bodySnippet('stack/agents/integration-reviewer.md', /`(for d in [^`]*?cut -f2)`/), ''],
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
                const got = execFileSync('bash', ['-c', script], { cwd: home, env, encoding: 'utf8' }).trim();
                assert.ok(got.endsWith(`${want}${tail}`), `${name}: took '${got}', want ...${want}${tail}`);
            }
        }
        finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
});
