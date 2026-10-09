'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const leg = require('./gate-leg.js');
const gate = require('./gate.js');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('gate-leg: the TAP summary is read from its last block, and a run without one has no counts', () => {
    const tap = [
        'TAP version 13',
        '# tests 3',          // a test's own stdout, re-emitted as a comment - earlier, so the real summary wins
        'ok 1 - a',
        '# tests 2967', '# suites 4', '# pass 2960', '# fail 2', '# cancelled 1', '# skipped 4', '# todo 0', '# duration_ms 1234',
    ].join('\n');
    assert.deepStrictEqual(leg.parseTapSummary(tap), { tests: 2967, pass: 2960, fail: 2, cancelled: 1, skipped: 4, todo: 0 });
    assert.strictEqual(leg.parseTapSummary('TAP version 13\nok 1 - a\n'), null);
    assert.strictEqual(leg.parseTapSummary('    # tests 3\n    # fail 0\n'), null, 'an indented (nested) summary is not the run summary');
});

test('gate-leg: failing test names come out without indentation, TODO failures left out', () => {
    const tap = ['not ok 1 - top', '    not ok 2 - nested # TODO later', '    not ok 3 - nested real', 'ok 4 - fine'].join('\n');
    assert.deepStrictEqual(leg.failedTests(tap), ['top', 'nested real']);
    assert.strictEqual(leg.failedTests(Array.from({ length: 30 }, (_, i) => `not ok ${i} - t${i}`).join('\n')).length, 20);
});

test('gate-leg: a leg passes only when every step exits 0 and tests ran with none failed', () => {
    const steps = (lint = 0, testStatus = 0) => [{ name: 'checkout', status: 0 }, { name: 'install', status: 0 }, { name: 'lint', status: lint }, { name: 'test', status: testStatus }];
    const counts = (tests, fail = 0, cancelled = 0) => ({ tests, pass: tests - fail, fail, cancelled, skipped: 0, todo: 0 });
    assert.deepStrictEqual(leg.verdict(steps(), counts(10)), { ok: true, reasons: [] });
    // the historic trap: exit 0, zero tests
    assert.match(leg.verdict(steps(), counts(0)).reasons.join(), /0 tests ran/);
    assert.match(leg.verdict(steps(0, 1), counts(10, 2)).reasons.join(), /test exited 1.*2 test\(s\) failed/);
    assert.match(leg.verdict(steps(), counts(10, 0, 1)).reasons.join(), /1 test\(s\) cancelled/);
    assert.match(leg.verdict(steps(), null).reasons.join(), /no TAP summary/);
    assert.deepStrictEqual(leg.verdict(steps(3), counts(10)).reasons, ['lint exited 3'], 'a lint failure fails the leg on its own');
    assert.deepStrictEqual(leg.verdict([{ name: 'checkout', status: 0 }, { name: 'install', status: 1 }], null).reasons, ['install exited 1', 'the tests never ran']);
});

test('gate-leg: the runner env drops git plumbing, npm, Claude Code and stack variables, and sets CI and (when asked) temp', () => {
    const env = leg.runnerEnv({
        PATH: '/bin', HTTPS_PROXY: 'http://proxy', NODE_EXTRA_CA_CERTS: '/ca.pem',
        GIT_DIR: '/caller/.git', GIT_INDEX_FILE: 'x', npm_config_prefix: '/p', npm_lifecycle_event: 'gate', INIT_CWD: '/c',
        CLAUDE_PROJECT_DIR: '/p', CLAUDECODE: '1', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', NODE_OPTIONS: '--inspect', NODE_TEST_CONTEXT: 'child-v8',
    }, { tmp: '/w/tmp', platform: 'linux' });
    assert.deepStrictEqual(env, {
        PATH: '/bin', HTTPS_PROXY: 'http://proxy', NODE_EXTRA_CA_CERTS: '/ca.pem',
        CI: 'true', TMPDIR: '/w/tmp', TEMP: '/w/tmp', TMP: '/w/tmp',
    });
    // no temp asked: the machine's own stays, as a runner's does - and HOME's git config with it
    assert.deepStrictEqual(leg.runnerEnv({ PATH: '/bin', TMPDIR: '/var/t', HOME: '/h' }, { platform: 'linux' }), { PATH: '/bin', TMPDIR: '/var/t', HOME: '/h', CI: 'true' });
    assert.deepStrictEqual(gate.cleanEnv({ PATH: '/bin', GIT_WORK_TREE: '/x' }).CI, 'true');
    assert.ok(!('GIT_WORK_TREE' in gate.cleanEnv({ PATH: '/bin', GIT_WORK_TREE: '/x' })));
});

test('gate-leg: on Windows the env keeps one spelling per variable and gains Git\'s Unix tools, as a runner has them', () => {
    const git = 'C:\\Program Files\\Git';
    const files = new Set([`${git}\\cmd\\git.exe`, `${git}\\bin\\bash.exe`, `${git}\\usr\\bin\\bash.exe`]);
    const exists = p => files.has(p);
    const env = leg.runnerEnv({ Path: `C:\\Windows;${git}\\cmd`, Temp: 'C:\\old' }, { tmp: 'C:\\w\\tmp', platform: 'win32', exists });
    assert.deepStrictEqual(Object.keys(env).filter(k => /^(path|temp)$/i.test(k)), ['Path', 'TEMP'], 'no second Path or Temp key');
    assert.strictEqual(env.Path, `C:\\Windows;${git}\\cmd;${git}\\bin`, 'the launcher dir, never usr\\bin');
    assert.strictEqual(env.TEMP, 'C:\\w\\tmp');
    assert.strictEqual(leg.onPath('bash', env, { platform: 'win32', exists }), `${git}\\bin\\bash.exe`);
    assert.deepStrictEqual(leg.missingTools(env, { platform: 'win32', exists }), ['pwsh']);
    // bash already reachable: PATH is left alone; no git: nothing to add
    const withBash = { Path: `${git}\\usr\\bin;${git}\\cmd` };
    assert.strictEqual(leg.runnerEnv(withBash, { platform: 'win32', exists }).Path, withBash.Path);
    assert.strictEqual(leg.runnerEnv({ Path: 'C:\\Windows' }, { platform: 'win32', exists }).Path, 'C:\\Windows');
    // posix: PATH untouched, lookups use ':'
    const posix = leg.runnerEnv({ PATH: '/usr/bin:/bin' }, { platform: 'linux', exists: () => false });
    assert.strictEqual(posix.PATH, '/usr/bin:/bin');
    assert.strictEqual(leg.onPath('bash', posix, { platform: 'linux', exists: p => p === '/bin/bash' }), '/bin/bash');
});

test('gate: pre-push lines - deletions and refs the remote already has gate nothing, a commit pushed twice runs once', () => {
    const lines = [
        `refs/heads/develop ${SHA_A} refs/heads/develop ${SHA_B}`,
        `refs/heads/feature ${SHA_A} refs/heads/feature ${ZERO}`,        // the same commit to a new branch
        `(delete) ${ZERO} refs/heads/old ${SHA_B}`,                      // a deletion
        `refs/heads/same ${SHA_B} refs/heads/same ${SHA_B}`,             // already there
        `refs/tags/v1 ${SHA_B} refs/tags/v1 ${ZERO}`,
        'garbage line', '',
    ].join('\n');
    assert.deepStrictEqual(gate.readPrePush(lines), [{ sha: SHA_A, branch: 'develop', label: 'develop' }, { sha: SHA_B, branch: 'alfred-gate', label: 'v1' }]);
    assert.deepStrictEqual(gate.readPrePush(''), []);
    assert.deepStrictEqual(gate.readPrePush(`HEAD ${SHA_A} refs/heads/main ${ZERO}\r\n`), [{ sha: SHA_A, branch: 'main', label: 'main' }]);
});

test('gate: the Node major comes from ci.yml, so the gate follows CI rather than repeating it', () => {
    const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    assert.ok(Number.isInteger(gate.ciNodeMajor(ci)) && gate.ciNodeMajor(ci) >= 18);
    assert.strictEqual(gate.ciNodeMajor("node-version: '24'"), 24);
    assert.strictEqual(gate.ciNodeMajor('steps: []'), null);
});

test('gate: the mac leg finds the pinned Node major under nvm or Homebrew, else flags the current one', () => {
    const brew = path.join('/opt/homebrew/opt', 'node@22', 'bin', 'node');
    const exists = p => p.split(path.sep).join('/').includes('/nvm/') || p === brew;   // path.join spells \\ on Windows
    const list = () => ['v20.1.0', 'v22.9.0', 'v22.16.0', 'v24.11.0'];
    const seams = { current: '/cur/node', version: 'v24.11.0', env: { NVM_DIR: '/nvm' }, exists, list };
    assert.deepStrictEqual(gate.findNode(24, seams), { bin: '/cur/node', version: 'v24.11.0', matches: true });
    assert.deepStrictEqual(gate.findNode(22, seams), { bin: path.join('/nvm', 'versions', 'node', 'v22.16.0', 'bin', 'node'), version: 'v22.16.0', matches: true });
    assert.deepStrictEqual(gate.findNode(22, { ...seams, list: () => [] }), { bin: brew, version: 'v22', matches: true });
    assert.deepStrictEqual(gate.findNode(18, { ...seams, exists: () => false }), { bin: '/cur/node', version: 'v24.11.0', matches: false });
});

test('gate: the VM share is the first enabled read-write host folder, mounted at \\\\Mac\\<name>', () => {
    const info = { 'Host Shared Folders': { enabled: true, Docs: { enabled: true, path: '/ro', mode: 'ro' }, 'Win (P)': { enabled: true, path: '~/Parallels/Win (P)', mode: 'rw' } } };
    assert.deepStrictEqual(gate.vmShare(info, '/home/u'), { name: 'Win (P)', hostPath: '/home/u/Parallels/Win (P)', guestPath: '\\\\Mac\\Win (P)' });
    assert.strictEqual(gate.vmShare({ 'Host Shared Folders': { enabled: false, A: { enabled: true, path: '/a', mode: 'rw' } } }), null);
    assert.strictEqual(gate.vmShare({ 'Host Shared Folders': { enabled: true, A: { enabled: false, path: '/a', mode: 'rw' } } }), null);
    assert.strictEqual(gate.vmShare({}), null);
    assert.strictEqual(gate.vmShare(undefined), null);
});

test('gate: an isolated VM is read from its config.pvs; a VM is woken and put back the way it was found', () => {
    const dir = tmp('gate-pvs-');
    try
    {
        fs.writeFileSync(path.join(dir, 'config.pvs'), '<Settings><IsolatedVm>1</IsolatedVm></Settings>');
        assert.strictEqual(gate.isolated({ Home: dir }), true);
        fs.writeFileSync(path.join(dir, 'config.pvs'), '<Settings><IsolatedVm>0</IsolatedVm></Settings>');
        assert.strictEqual(gate.isolated({ Home: dir }), false);
        assert.strictEqual(gate.isolated({ Home: path.join(dir, 'missing') }), false);
        assert.strictEqual(gate.isolated({}), false);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.deepStrictEqual([gate.WAKE.stopped, gate.RESTORE.stopped], ['start', 'stop']);
    assert.deepStrictEqual([gate.WAKE.suspended, gate.RESTORE.suspended], ['resume', 'suspend']);
    assert.deepStrictEqual([gate.WAKE.paused, gate.RESTORE.paused], ['resume', 'pause']);
    assert.deepStrictEqual([gate.WAKE.running, gate.RESTORE.running], [undefined, undefined]);
});

test('gate: legs come from --legs, then GATE_LEGS, then git config gate.legs; a bad name is refused', () => {
    assert.deepStrictEqual(gate.parseArgs(['--legs', 'win,mac,win']).legs, ['win', 'mac']);
    assert.deepStrictEqual(gate.parseArgs(['--legs=linux', '--force', '--ref', 'develop']), { legs: ['linux'], ref: 'develop', force: true, keep: false, prePush: false, installHook: false, uninstallHook: false, rest: [] });
    assert.throws(() => gate.parseArgs(['--legs', 'mac,bsd']), /--legs takes a list/);
    assert.throws(() => gate.parseArgs(['--legs', '']), /--legs takes a list/);
    assert.throws(() => gate.parseArgs(['--nope']), /unknown option --nope/);
    const repo = tmp('gate-cfg-');
    try
    {
        execFileSync('git', ['init', '-q', repo]);
        assert.deepStrictEqual(gate.configuredLegs(repo, { legs: null }, {}), gate.LEGS);
        execFileSync('git', ['-C', repo, 'config', 'gate.legs', 'mac, linux']);
        assert.deepStrictEqual(gate.configuredLegs(repo, { legs: null }, {}), ['mac', 'linux']);
        assert.deepStrictEqual(gate.configuredLegs(repo, { legs: null }, { GATE_LEGS: 'win' }), ['win']);
        assert.deepStrictEqual(gate.configuredLegs(repo, { legs: ['linux'] }, { GATE_LEGS: 'win' }), ['linux']);
    }
    finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('gate: a leg on an older release of the pinned major than the node image is named; another major is left to its own note', () => {
    const v = (leg, node, note = '') => ({ leg, note, result: node && { node } });
    const verdicts = [v('mac', 'v22.16.0'), v('linux', 'v22.23.3'), v('win', 'v22.23.3'), v('x', 'v24.1.0', 'other major')];
    gate.nodeSkew(verdicts, 22);
    assert.match(verdicts[0].note, /node v22\.16\.0 here, older than the v22\.23\.3 in node:22/);
    assert.deepStrictEqual(verdicts.slice(1).map(x => x.note), ['', '', 'other major']);
    const noLinux = [v('mac', 'v22.1.0')];
    gate.nodeSkew(noLinux, 22);
    assert.strictEqual(noLinux[0].note, '');
});

test('gate: one gate per machine - a live holder is named, a dead or half-written one is taken over', () => {
    const dir = tmp('gate-lock-');
    const lock = path.join(dir, 'gate.lock');
    try
    {
        const release = gate.takeLock('/repo/a', { GATE_LOCK_DIR: lock });
        assert.strictEqual(fs.readFileSync(path.join(lock, 'pid'), 'utf8'), `${process.pid}\n/repo/a\n`);
        assert.throws(() => gate.takeLock('/repo/b', { GATE_LOCK_DIR: lock }), new RegExp(`another gate is running \\(pid ${process.pid}, /repo/a\\)`));
        release();
        assert.ok(!fs.existsSync(lock));
        fs.mkdirSync(lock);
        fs.writeFileSync(path.join(lock, 'pid'), '2147483646\n/repo/gone\n');   // no such process
        gate.takeLock('/repo/b', { GATE_LOCK_DIR: lock })();
        fs.mkdirSync(lock);                                                     // died before writing its pid
        gate.takeLock('/repo/c', { GATE_LOCK_DIR: lock })();
        assert.ok(!fs.existsSync(lock));
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gate: a leg without a result line, or one whose exit code disagrees with it, fails', () => {
    assert.deepStrictEqual(gate.legVerdict('linux', { reasons: ['docker is not running'] }), { leg: 'linux', ok: false, reasons: ['docker is not running'], note: '' });
    assert.match(gate.legVerdict('win', { code: 1, result: null }).reasons.join(), /printed no result \(exit 1\)/);
    assert.deepStrictEqual(gate.legVerdict('mac', { code: 1, result: { ok: true, reasons: [] } }).reasons, ['the leg exited 1']);
    assert.strictEqual(gate.legVerdict('mac', { code: 0, result: { ok: true, reasons: [] } }).ok, true);
});

test('gate: the pre-push hook is executable and hands its arguments to the gate', { skip: process.platform === 'win32' && 'file modes are not posix here' }, () => {
    const prePush = path.join(__dirname, 'git-hooks', 'pre-push');
    assert.ok(fs.statSync(prePush).mode & 0o111, 'pre-push must be executable or git skips it');
    const body = fs.readFileSync(prePush, 'utf8');
    assert.match(body, /^#!\/bin\/sh\n[\s\S]*exec node "\$\(git rev-parse --show-toplevel\)\/scripts\/gate\.js" --pre-push "\$@"\n$/);
    // no node on PATH (a GUI client) blocks the push with a reason, never skips the gate silently
    const r = spawnSync('/bin/sh', [prePush], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /node is not on PATH here.* --no-verify/);
});

// ---- a real leg on a fixture repo: CI-style checkout from a bundle, npm install, lint, test ---------

function fixtureRepo({ lint = 'node -e 0', withTest = true } = {})
{
    const dir = tmp('gate-fx-');
    const repo = path.join(dir, 'src');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0', private: true, scripts: { lint, test: 'node --test' } }));
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\npackage-lock.json\n');
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'main');
    git('checkout', '-q', '-b', 'develop');
    if (withTest)
    {
        fs.writeFileSync(path.join(repo, 'a.test.js'), "require('node:test')('one', () => {});\nrequire('node:test')('two', () => {});\n");
        git('add', '-A');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'tests');
    }
    git('update-ref', 'refs/alfred-gate/t', 'HEAD');
    const bundle = path.join(dir, 'repo.bundle');
    git('bundle', 'create', '-q', bundle, 'refs/alfred-gate/t', 'refs/heads/main');
    return { dir, repo, bundle, git };
}

function runLeg(fx, extra = {})
{
    const cfg = path.join(fx.dir, 'leg.json');
    fs.writeFileSync(cfg, JSON.stringify({ bundle: fx.bundle, gateRef: 'refs/alfred-gate/t', mainRef: 'refs/heads/main', branch: 'develop', name: 'fx', work: path.join(fx.dir, 'work'), ...extra }));
    const r = spawnSync(process.execPath, [path.join(__dirname, 'gate-leg.js'), cfg], { encoding: 'utf8', env: { ...process.env, GIT_DIR: path.join(fx.dir, 'not-a-repo') } });
    const line = r.stdout.split('\n').find(l => l.startsWith(leg.RESULT));
    return { status: r.status, result: line && JSON.parse(line.slice(leg.RESULT.length)), out: r.stdout + r.stderr };
}

test('gate-leg: a fixture repo passes - checked out on its branch with a local main, its two tests counted', () => {
    const fx = fixtureRepo();
    try
    {
        const r = runLeg(fx, { keep: true });
        assert.strictEqual(r.status, 0, r.out);
        assert.strictEqual(r.result.ok, true);
        assert.deepStrictEqual(r.result.steps.map(s => [s.name, s.status]), [['checkout', 0], ['install', 0], ['lint', 0], ['test', 0]]);
        assert.strictEqual(r.result.tests.tests, 2);
        assert.strictEqual(r.result.head, fx.git('rev-parse', 'develop'));
        const clone = path.join(fx.dir, 'work', 'fx');
        const cg = (...args) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8' }).trim();
        assert.strictEqual(cg('symbolic-ref', '--short', 'HEAD'), 'develop');
        assert.strictEqual(cg('rev-parse', 'main'), fx.git('rev-parse', 'main'), 'ci.yml needs a local main');
    }
    finally { fs.rmSync(fx.dir, { recursive: true, force: true }); }
});

test('gate-leg: zero tests and a failing lint each fail the leg, though npm test exits 0', () => {
    const fx = fixtureRepo({ lint: 'node -e "process.exit(3)"', withTest: false });
    try
    {
        const r = runLeg(fx);
        assert.strictEqual(r.status, 1, r.out);
        assert.strictEqual(r.result.ok, false);
        assert.deepStrictEqual(r.result.steps.map(s => [s.name, s.status]), [['checkout', 0], ['install', 0], ['lint', 3], ['test', 0]]);
        assert.deepStrictEqual(r.result.reasons, ['lint exited 3', '0 tests ran - a gate that runs nothing passes nothing']);
        assert.ok(!fs.existsSync(path.join(fx.dir, 'work')), 'the work dir is removed unless keep is set');
    }
    finally { fs.rmSync(fx.dir, { recursive: true, force: true }); }
});

test('gate: end to end on macOS - a pass is stamped and skipped next time, the temp ref is gone, a failing commit stops a push', { skip: process.platform !== 'darwin' && 'the mac leg runs natively on macOS only' }, () => {
    const fx = fixtureRepo();
    try
    {
        fx.git('update-ref', '-d', 'refs/alfred-gate/t');
        // HOME moves too: the mac leg clones under ~/Library/Caches, and a test never writes the real home
        const home = path.join(fx.dir, 'home');
        fs.mkdirSync(home);
        // and its own lock: the machine-wide one is held when this test runs inside a gate
        const lock = path.join(fx.dir, 'gate.lock');
        const run = (args, input) => spawnSync(process.execPath, [path.join(__dirname, 'gate.js'), ...args], { cwd: fx.repo, encoding: 'utf8', input, env: { ...process.env, HOME: home, GATE_LEGS: 'mac', GATE_LOCK_DIR: lock } });
        const first = run([]);
        assert.strictEqual(first.status, 0, first.stdout + first.stderr);
        assert.match(first.stdout, /mac\s+PASS\s+2 tests, 0 failed, 0 skipped/);
        const sha = fx.git('rev-parse', 'HEAD');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fx.repo, '.git', 'alfred-gate', 'pass', `${sha}.json`), 'utf8')).legs, ['mac']);
        assert.strictEqual(fx.git('for-each-ref', 'refs/alfred-gate/'), '', 'the temp ref is deleted');
        assert.ok(!fs.existsSync(lock), 'the lock is released');
        assert.deepStrictEqual(fs.readdirSync(path.join(home, 'Library', 'Caches', 'alfred-gate')), [], 'the clone is removed');
        const again = run(['--pre-push', 'origin', 'url'], `refs/heads/develop ${sha} refs/heads/develop ${ZERO}\n`);
        assert.strictEqual(again.status, 0);
        assert.match(again.stdout, /already passed on mac - skipped/);
        // a commit whose test fails stops the push
        fs.writeFileSync(path.join(fx.repo, 'b.test.js'), "require('node:test')('breaks', () => { throw new Error('no'); });\n");
        fx.git('add', '-A');
        fx.git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'broken');
        const bad = fx.git('rev-parse', 'HEAD');
        const blocked = run(['--pre-push', 'origin', 'url'], `(delete) ${ZERO} refs/heads/gone ${SHA_B}\nrefs/heads/develop ${bad} refs/heads/develop ${sha}\n`);
        assert.strictEqual(blocked.status, 1, blocked.stdout + blocked.stderr);
        assert.match(blocked.stdout, /mac\s+FAIL\s+3 tests, 1 failed/);
        assert.match(blocked.stdout, /not ok - breaks/);
        assert.match(blocked.stdout, /push stopped .* git push --no-verify/);
        assert.ok(!fs.existsSync(path.join(fx.repo, '.git', 'alfred-gate', 'pass', `${bad}.json`)), 'a failure stamps nothing');
        // nothing to gate: a deletion alone
        assert.strictEqual(run(['--pre-push', 'origin', 'url'], `(delete) ${ZERO} refs/heads/gone ${SHA_B}\n`).status, 0);
    }
    finally { fs.rmSync(fx.dir, { recursive: true, force: true }); }
});
