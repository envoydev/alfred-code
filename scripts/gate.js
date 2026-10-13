#!/usr/bin/env node
'use strict';
// The local CI gate: the lint and test workflows run here, on all three operating systems, before a
// push spends a CI run on them.
//
// Why it exists: CI is the only place the Windows leg ran, so a Windows-only failure surfaced 10-30
// minutes after a push and cost a fix-push-wait cycle each time. Here the three legs run in parallel
// on one machine against the COMMITTED tree, checked out the way ci.yml checks it out:
//   mac    native, on the Node major ci.yml pins (found under nvm or Homebrew; else the current node, flagged)
//   linux  a `node:<major>` container, as its unprivileged `node` user (a runner is not root)
//   win    a Parallels VM through `prlctl exec` as SYSTEM - elevated like a runner, which may create
//          symlinks, and reachable before anyone logs on - the bundle passed over a host shared folder;
//          the VM is started or resumed for the run and put back the way it was found
// Each leg runs `scripts/gate-leg.js` (checkout, npm install, lint, test) and passes only when tests
// actually ran and none failed - see that file for the verdict.
//
// A pass is stamped per commit (`<git dir>/alfred-gate/pass/<sha>.json`), so a push right after a
// manual gate does not run it twice. Logs: `<git dir>/alfred-gate/logs/`.
//
//   npm run gate [-- --legs mac,linux,win] [--ref <rev>] [--force] [--keep]
//   node scripts/gate.js --pre-push <remote> <url>     (the pre-push hook; reads the ref lines on stdin)
//   node scripts/gate.js --install-hook | --uninstall-hook
// Local config (never tracked): `git config gate.windowsVm '<Parallels VM name>'`, `git config gate.legs mac,linux`;
// GATE_LEGS and GATE_WINDOWS_VM override them for one run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn
const { RESULT, STEP, runnerEnv } = require('./gate-leg.js');

const LEGS = ['mac', 'linux', 'win'];
const HOOKS_PATH = 'scripts/git-hooks';
const ZERO_SHA = /^0+$/;
const LEG_TIMEOUT_MS = 45 * 60 * 1000;
const VM_READY_MS = 5 * 60 * 1000;
const KEEP_LOG_RUNS = 10;
const KEEP_PASS_STAMPS = 50;

function parseArgs(argv)
{
    const opts = { legs: null, ref: 'HEAD', force: false, keep: false, prePush: false, installHook: false, uninstallHook: false, rest: [] };
    for (let i = 0; i < argv.length; i++)
    {
        const a = argv[i];
        if (a === '--legs') opts.legs = parseLegs(argv[++i]);
        else if (a.startsWith('--legs=')) opts.legs = parseLegs(a.slice(7));
        else if (a === '--ref') opts.ref = argv[++i];
        else if (a === '--force') opts.force = true;
        else if (a === '--keep') opts.keep = true;
        else if (a === '--pre-push') opts.prePush = true;
        else if (a === '--install-hook') opts.installHook = true;
        else if (a === '--uninstall-hook') opts.uninstallHook = true;
        else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        else opts.rest.push(a);
    }
    return opts;
}

function parseLegs(text)
{
    const legs = String(text || '').split(/[\s,]+/).filter(Boolean);
    const bad = legs.filter(l => !LEGS.includes(l));
    if (bad.length || !legs.length) throw new Error(`--legs takes a list of ${LEGS.join(', ')} (got '${text}')`);
    return [...new Set(legs)];
}

// git's pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>` per ref. A deletion (local
// sha all zeros) and a ref the remote already has at that sha push no new code - nothing to gate.
function readPrePush(text)
{
    const out = new Map();
    for (const line of String(text).split(/\r?\n/))
    {
        const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
        if (!localSha || !/^[0-9a-f]{40,64}$/i.test(localSha) || ZERO_SHA.test(localSha) || localSha === remoteSha) continue;
        const branch = /^refs\/heads\/(.+)$/.exec(remoteRef || '')?.[1] || /^refs\/heads\/(.+)$/.exec(localRef || '')?.[1] || 'alfred-gate';
        const label = branch !== 'alfred-gate' ? branch : String(remoteRef || localRef || '').replace(/^refs\/(tags|heads)\//, '') || branch;
        if (!out.has(localSha)) out.set(localSha, { branch, label });
    }
    return [...out].map(([sha, t]) => ({ sha, ...t }));
}

// The Node major the test workflow pins - the gate follows CI rather than repeating the number.
function ciNodeMajor(ciYml)
{
    const m = /node-version:\s*['"]?(\d+)/.exec(String(ciYml || ''));
    return m ? Number(m[1]) : null;
}

function findNode(major, { current = process.execPath, version = process.version, env = process.env, home = os.homedir(), exists = fs.existsSync, list = safeList } = {})
{
    const majorOf = v => Number(String(v).replace(/^v/, '').split('.')[0]);
    if (!major || majorOf(version) === major) return { bin: current, version, matches: true };
    const found = [];
    const nvm = env.NVM_DIR || path.join(home, '.nvm');
    for (const v of list(path.join(nvm, 'versions', 'node'))) if (majorOf(v) === major) found.push({ bin: path.join(nvm, 'versions', 'node', v, 'bin', 'node'), version: v });
    for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt'])
    {
        const bin = path.join(prefix, `node@${major}`, 'bin', 'node');
        if (exists(bin)) found.push({ bin, version: `v${major}` });
    }
    const usable = found.filter(f => exists(f.bin)).sort((a, b) => compareVersions(b.version, a.version));
    return usable.length ? { ...usable[0], matches: true } : { bin: current, version, matches: false };
}

function compareVersions(a, b)
{
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

function safeList(dir)
{
    try { return fs.readdirSync(dir); }
    catch { return []; }
}

// The first enabled read-write host shared folder of a `prlctl list -i -j` record. Parallels mounts
// host share <name> in the guest at \\Mac\<name>.
function vmShare(info, home = os.homedir())
{
    const hsf = info && info['Host Shared Folders'];
    if (!hsf || hsf.enabled === false) return null;
    for (const [name, f] of Object.entries(hsf))
    {
        if (!f || typeof f !== 'object' || f.enabled === false || f.mode !== 'rw' || !f.path) continue;
        const hostPath = f.path.replace(/^~(?=$|\/)/, home);
        return { name, hostPath, guestPath: `\\\\Mac\\${name}` };
    }
    return null;
}

// How to bring a VM up for the run, and how to put it back the way it was found.
const WAKE = { stopped: 'start', suspended: 'resume', paused: 'resume' };
const RESTORE = { stopped: 'stop', suspended: 'suspend', paused: 'pause' };

function git(cwd, args)
{
    return rt.execCommand('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(cwd, args)
{
    try { return git(cwd, args); }
    catch { return ''; }
}

function fmtMs(ms)
{
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function stamp(d = new Date())
{
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function prune(dir, keep)
{
    const entries = safeList(dir).sort();
    for (const e of entries.slice(0, Math.max(0, entries.length - keep))) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
}

function passedLegs(gateDir, sha)
{
    try { return new Set(JSON.parse(fs.readFileSync(path.join(gateDir, 'pass', `${sha}.json`), 'utf8')).legs || []); }
    catch { return new Set(); }
}

// One gate at a time on this MACHINE, not per repo: two clones or worktrees share the one VM, and the
// second run's restore would stop it under the first. A lock left by a dead process is taken over.
// GATE_LOCK_DIR moves it - the gate's own test runs a gate inside a gate.
function takeLock(root, env = process.env)
{
    const lock = env.GATE_LOCK_DIR || path.join(os.tmpdir(), 'alfred-gate.lock');
    for (let attempt = 0; attempt < 2; attempt++)
    {
        try
        {
            fs.mkdirSync(lock);
            fs.writeFileSync(path.join(lock, 'pid'), `${process.pid}\n${root}\n`);
            return () => fs.rmSync(lock, { recursive: true, force: true });
        }
        catch (err)
        {
            if (err.code !== 'EEXIST') throw err;
            const [pid, owner] = readFile(path.join(lock, 'pid')).split('\n');
            if (Number(pid) && alive(Number(pid)))
                throw new Error(`another gate is running (pid ${pid}${owner ? `, ${owner}` : ''}); wait for it, or remove ${lock} if it is gone`);
            fs.rmSync(lock, { recursive: true, force: true });
        }
    }
    throw new Error(`could not take ${lock}`);
}

function alive(pid)
{
    try { process.kill(pid, 0); return true; }
    catch (err) { return err.code === 'EPERM'; }
}

// Spawns one leg's process, writes everything it prints to the leg's log, reports each step as it
// starts, and resolves with the leg's own RESULT line (null when it never printed one).
function runProcess(leg, cmd, args, { env, log, onKill } = {})
{
    return new Promise(resolve => {
        const out = fs.createWriteStream(log);
        const child = rt.spawnCommandAsync(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let result = null;
        let buf = '';
        const timer = setTimeout(() => { out.write(`\n[gate] ${leg} timed out after ${fmtMs(LEG_TIMEOUT_MS)}\n`); kill(); }, LEG_TIMEOUT_MS);
        const kill = () => { if (onKill) onKill(); child.kill('SIGTERM'); };
        child.stdout.on('data', d => {
            out.write(d);
            buf += d;
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0)
            {
                const line = buf.slice(0, nl).replace(/\r$/, '');
                buf = buf.slice(nl + 1);
                if (line.startsWith(STEP)) console.log(`  [${leg}] ${line.slice(STEP.length)}`);
                else if (line.startsWith(RESULT)) { try { result = JSON.parse(line.slice(RESULT.length)); } catch { /* reported as no result */ } }
            }
        });
        child.stderr.on('data', d => out.write(d));
        child.on('error', err => out.write(`\n[gate] ${cmd}: ${err.message}\n`));
        child.on('close', code => { clearTimeout(timer); out.end(() => resolve({ code, result })); });
        runProcess.active.add(kill);
        child.on('close', () => runProcess.active.delete(kill));
    });
}
runProcess.active = new Set();

// The leg travels as two files: gate-leg.js and the one spawn helper it starts commands through.
function copyLeg(dir)
{
    fs.mkdirSync(path.join(dir, 'install'), { recursive: true, mode: 0o755 });
    for (const rel of ['gate-leg.js', path.join('install', 'runtime.js')])
    {
        fs.copyFileSync(path.join(__dirname, rel), path.join(dir, rel));
        fs.chmodSync(path.join(dir, rel), 0o644);
    }
}

function writeLegFiles(dir, leg, cfg)
{
    const cfgPath = path.join(dir, `${leg}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    fs.chmodSync(cfgPath, 0o644);
    return cfgPath;
}

async function legMac(ctx)
{
    if (process.platform !== 'darwin') return { reasons: [`the mac leg runs natively and this host is ${process.platform}`] };
    const node = findNode(ctx.nodeMajor);
    // outside the temp tree, as a runner's checkout is; one gate per machine, so any clone already
    // there is a dead run's
    const work = path.join(os.homedir(), 'Library', 'Caches', 'alfred-gate', ctx.id);
    fs.rmSync(path.dirname(work), { recursive: true, force: true });
    if (!ctx.legCfg.keep) ctx.cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
    const cfg = writeLegFiles(ctx.runDir, 'mac', { ...ctx.legCfg, bundle: ctx.bundle, work });
    const env = { ...process.env, PATH: `${path.dirname(node.bin)}${path.delimiter}${process.env.PATH || ''}` };
    const note = node.matches ? '' : `node ${process.version}, not the v${ctx.nodeMajor} ci.yml pins (none found under nvm or Homebrew)`;
    return { note, ...(await runProcess('mac', node.bin, [ctx.legScript, cfg], { env: ctx.cleanEnv(env), log: ctx.log('mac') })) };
}

async function legLinux(ctx)
{
    if (!rt.which('docker')) return { reasons: ['docker is not installed'] };
    try { rt.execCommand('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }); }
    catch { return { reasons: ['docker is not running - start Docker Desktop, or drop the leg with --legs'] }; }
    writeLegFiles(ctx.runDir, 'linux', { ...ctx.legCfg, bundle: '/gate/repo.bundle', work: `/home/node/alfred-gate-${ctx.id}` });
    const name = `alfred-gate-${ctx.id}-linux`;
    const args = ['run', '--rm', '--init', '--name', name, '--user', 'node', '-v', `${ctx.runDir}:/gate:ro`, '-w', '/home/node',
        `node:${ctx.nodeMajor || 'lts'}`, 'node', '/gate/gate-leg.js', '/gate/linux.json'];
    const onKill = () => { try { rt.execCommand('docker', ['kill', name], { stdio: 'ignore' }); } catch { /* already gone */ } };
    return runProcess('linux', 'docker', args, { env: ctx.cleanEnv(process.env), log: ctx.log('linux'), onKill });
}

function prl(args, opts = {})
{
    return rt.execCommand('prlctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

// The calls made while the other legs run are async, so their output keeps draining while the VM boots.
function prlAsync(args, timeout)
{
    return new Promise((resolve, reject) => {
        const child = rt.spawnCommandAsync('prlctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('error', err => { clearTimeout(timer); reject(Object.assign(err, { stderr })); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(Object.assign(new Error(`prlctl ${args[0]} exited ${code}`), { stderr }));
        });
    });
}

function vmInfo(vm)
{
    return JSON.parse(prl(['list', '-i', '-j', vm]))[0];
}

// 'Isolate Windows from Mac' turns off every host channel prlctl exec needs; the JSON listing does not
// show it, the VM's config.pvs does.
function isolated(info)
{
    return /<IsolatedVm>1<\/IsolatedVm>/.test(readFile(path.join(String(info?.Home || ''), 'config.pvs')));
}

// The guest's last boot time - '' when it cannot be read. Encoded: prlctl exec drops quotes.
async function guestBoot(vm)
{
    const ps = "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')";
    try { return (await prlAsync(['exec', vm, 'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], 60000)).trim().split(/\r?\n/).pop(); }
    catch { return ''; }
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const SETTLED = ['running', 'stopped', 'suspended', 'paused'];
const TARGET = { stop: 'stopped', suspend: 'suspended', pause: 'paused' };

// Puts the VM back; '' when it got there, else what is wrong. Synchronous, since it also runs from
// the Ctrl-C handler. A stop is a shutdown started INSIDE Windows: `prlctl stop` logged an unexpected
// shutdown, and `--acpi` was cancelled after 30s on a VM fresh from an update restart (both measured).
// A VM mid-restart is let settle first.
function restoreVm(vm, action, { timeoutMs = 5 * 60 * 1000 } = {})
{
    const until = Date.now() + timeoutMs;
    const state = () => { try { return String(vmInfo(vm).State || '').toLowerCase(); } catch { return ''; } };
    while (!SETTLED.includes(state()) && Date.now() < until) sleepSync(3000);
    if (state() === TARGET[action]) return '';
    try
    {
        if (action === 'stop')
        {
            const ready = () => { try { return /ready/.test(prl(['exec', vm, 'cmd', '/c', 'echo ready'], { timeout: 30000 })); } catch { return false; } };
            while (!ready() && Date.now() < until) sleepSync(3000);
            prl(['exec', vm, 'shutdown', '/s', '/t', '0'], { timeout: 60000 });
        }
        else prl([action, vm], { timeout: 300000 });
    }
    catch (err) { return `could not ${action} '${vm}': ${String(err.stderr || err.message).trim().split('\n')[0]}`; }
    while (state() !== TARGET[action] && Date.now() < until) sleepSync(3000);
    const now = state();
    return now === TARGET[action] ? '' : `'${vm}' is ${now || 'unreadable'}, not ${TARGET[action]}, after ${Math.round(timeoutMs / 60000)} min - put it back by hand`;
}

async function waitForExec(vm)
{
    const until = Date.now() + VM_READY_MS;
    while (Date.now() < until)
    {
        try { if (/ready/.test(await prlAsync(['exec', vm, 'cmd', '/c', 'echo ready'], 30000))) return true; }
        catch { /* still booting */ }
        await new Promise(r => setTimeout(r, 3000));
    }
    return false;
}

async function legWin(ctx)
{
    const vm = process.env.GATE_WINDOWS_VM || tryGit(ctx.root, ['config', '--get', 'gate.windowsVm']);
    if (!vm) return { reasons: [`no Windows VM set - git config gate.windowsVm '<Parallels VM name>', or drop the leg with --legs`] };
    if (!rt.which('prlctl')) return { reasons: ['prlctl (Parallels Desktop) is not installed'] };
    let info;
    try { info = vmInfo(vm); }
    catch (err) { return { reasons: [`no Parallels VM '${vm}' (${String(err.stderr || err.message).trim().split('\n')[0]})`] }; }
    if (isolated(info)) return { reasons: [`VM '${vm}' is isolated from the Mac, so prlctl exec cannot reach it - pick another VM with git config gate.windowsVm`] };
    const share = vmShare(info);
    if (!share) return { reasons: [`VM '${vm}' has no read-write host shared folder to pass the bundle through`] };
    const state = String(info.State || '').toLowerCase();
    if (WAKE[state])
    {
        console.log(`  [win] ${WAKE[state]} '${vm}' (found ${state}; put back after the run)`);
        try { await prlAsync([WAKE[state], vm], 180000); }
        catch (err) { return { reasons: [`could not ${WAKE[state]} '${vm}': ${String(err.stderr || err.message).trim().split('\n')[0]}`] }; }
        ctx.cleanups.push(() => {
            console.log(`  [win] ${RESTORE[state]} '${vm}'`);
            const problem = restoreVm(vm, RESTORE[state]);
            if (problem) console.log(`  [win] ${problem}`);
        });
    }
    else if (state !== 'running') return { reasons: [`VM '${vm}' is ${state || 'in an unknown state'}`] };
    if (!(await waitForExec(vm)))
        return { reasons: [`'${vm}' accepted no command within ${fmtMs(VM_READY_MS)} - it needs Parallels Tools running, and isolation from the Mac turned off`] };
    const dirName = `alfred-gate-${ctx.id}`;
    // Killing prlctl on the Mac leaves the run going in the VM: a timeout or Ctrl-C ends the guest
    // tree too and removes its work dir. Encoded, because prlctl exec drops quotes inside an argument.
    const work = `C:\\alfred-gate\\${ctx.id}`;
    const guestKill = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${ctx.id}*' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId | Out-Null }; `
        + `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${work}'`;
    const onKill = () => {
        try { prl(['exec', vm, 'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(guestKill, 'utf16le').toString('base64')], { timeout: 60000 }); }
        catch { /* the VM is going down anyway */ }
    };
    const hostDir = path.join(share.hostPath, dirName);
    fs.mkdirSync(hostDir, { recursive: true });
    ctx.cleanups.push(() => fs.rmSync(hostDir, { recursive: true, force: true }));
    const guestDir = `${share.guestPath}\\${dirName}`;
    fs.copyFileSync(ctx.bundle, path.join(hostDir, 'repo.bundle'));
    copyLeg(hostDir);
    // SYSTEM's own temp dir is the Windows one nothing cleans: the run's temp sits in its work dir
    writeLegFiles(hostDir, 'win', { ...ctx.legCfg, bundle: `${guestDir}\\repo.bundle`, work, tempDir: true });
    // one gate per machine, so a run dir already there is a dead run's (the VM went down under it)
    const sweep = `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue 'C:\\alfred-gate\\*'`;
    try { await prlAsync(['exec', vm, 'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(sweep, 'utf16le').toString('base64')], 120000); }
    catch { /* the leg reports what matters */ }
    const bootBefore = await guestBoot(vm);
    const r = await runProcess('win', 'prlctl', ['exec', vm, 'node', `${guestDir}\\gate-leg.js`, `${guestDir}\\win.json`],
        { env: ctx.cleanEnv(process.env), log: ctx.log('win'), onKill });
    // A run cut off with no result: the VM went down under it - Windows Update restarts a VM that sat
    // off (MoNotificationUx.exe 'Service pack', TrustedInstaller 'Upgrade'), or someone shut it down from
    // its window (StartMenuExperienceHost.exe) - all measured. Say so rather than 'no result'.
    if (!r.result && bootBefore)
    {
        const down = `'${vm}' went down during the run - Windows Update restarting it, or a shutdown from its window; run the gate again`;
        let now = '';
        try { now = String(vmInfo(vm).State || '').toLowerCase(); } catch { /* unreadable counts as down */ }
        if (now !== 'running') return { ...r, reasons: [down] };
        if (!(await waitForExec(vm)) || (await guestBoot(vm)) !== bootBefore) return { ...r, reasons: [down] };
    }
    const major = Number(String(r.result?.node || '').replace(/^v/, '').split('.')[0]);
    return { ...r, note: r.result && ctx.nodeMajor && major !== ctx.nodeMajor ? `node ${r.result.node} in the VM, not the v${ctx.nodeMajor} ci.yml pins` : '' };
}

const LEG_RUNNERS = { mac: legMac, linux: legLinux, win: legWin };

// The env a leg's PROCESS starts with: none of the caller's git plumbing (a hook runs with GIT_DIR set),
// npm's run-script variables or a Claude Code session's. gate-leg.js scrubs again inside the leg.
const cleanEnv = env => runnerEnv(env);

function legVerdict(leg, r)
{
    if (r.reasons) return { leg, ok: false, reasons: r.reasons, note: r.note || '' };
    if (!r.result) return { leg, ok: false, reasons: [`the leg printed no result (exit ${r.code})`], note: r.note || '' };
    const reasons = [...(r.result.reasons || [])];
    if (r.result.ok && r.code !== 0) reasons.push(`the leg exited ${r.code}`);
    return { leg, ok: reasons.length === 0 && Boolean(r.result.ok), reasons, result: r.result, note: r.note || '' };
}

// setup-node resolves the LATEST release of the pinned major, and so does the node:<major> image; a
// leg on an older release of that major can disagree with CI (22.16.0 truncates a piped write that
// 22.23 and 22.14 deliver whole - measured), so the summary names it.
function nodeSkew(verdicts, major)
{
    const ref = verdicts.find(v => v.leg === 'linux')?.result?.node;
    if (!ref) return;
    for (const v of verdicts)
    {
        const mine = v.result?.node;
        if (v.leg === 'linux' || !mine || mine.split('.')[0] !== ref.split('.')[0] || compareVersions(mine, ref) >= 0) continue;
        v.note = [v.note, `node ${mine} here, older than the ${ref} in node:${major} - CI runs the latest ${ref.split('.')[0]}.x; update it here`].filter(Boolean).join('; ');
    }
}

function summaryLine(v)
{
    const t = v.result?.tests;
    const counts = t ? `${t.tests} tests, ${t.fail} failed, ${t.skipped} skipped` : 'no test counts';
    const tail = v.result ? `  node ${v.result.node}  ${fmtMs(v.result.ms || 0)}` : '';
    return `  ${v.leg.padEnd(6)} ${v.ok ? 'PASS' : 'FAIL'}  ${v.result ? counts : v.reasons.join('; ')}${tail}`;
}

function tail(file, n = 25)
{
    try
    {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => !l.startsWith(RESULT));
        return lines.slice(-n - 1).join('\n');
    }
    catch { return ''; }
}

// `branch` is what the clone checks out (a tag push gets a placeholder); `label` is what the run prints.
async function runGate({ root, sha, branch, label = branch, legs, force, keep })
{
    const commonDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const gateDir = path.join(commonDir, 'alfred-gate');
    const short = sha.slice(0, 10);
    if (!force)
    {
        const passed = passedLegs(gateDir, sha);
        if (legs.every(l => passed.has(l)))
        {
            console.log(`alfred-gate: ${label} @ ${short} already passed on ${legs.join(', ')} - skipped (--force reruns it)`);
            return true;
        }
    }
    const mainRef = branch === 'main' ? null
        : ['refs/remotes/origin/main', 'refs/heads/main'].find(r => tryGit(root, ['rev-parse', '--verify', '--quiet', r]));
    if (branch !== 'main' && !mainRef) throw new Error('no main branch here (refs/remotes/origin/main or refs/heads/main) - ci.yml needs one');

    const release = takeLock(root);
    const id = `${stamp()}-${short.slice(0, 8)}`;
    const logDir = path.join(gateDir, 'logs', id);
    fs.mkdirSync(logDir, { recursive: true });
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-gate-'));
    fs.chmodSync(runDir, 0o755);
    const gateRef = `refs/alfred-gate/${id}`;
    const ctx = {
        id, root, runDir, cleanups: [], cleanEnv,
        nodeMajor: ciNodeMajor(readFile(path.join(root, '.github', 'workflows', 'ci.yml'))),
        legScript: path.join(runDir, 'gate-leg.js'),
        bundle: path.join(runDir, 'repo.bundle'),
        log: leg => path.join(logDir, `${leg}.log`),
        // the legs share this machine's cores: each gets its part, near the 3 workers a runner has
        legCfg: { gateRef, mainRef, branch, name: path.basename(root), keep, concurrency: Math.max(1, Math.floor((os.availableParallelism() - 1) / legs.length)) },
    };
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const kill of runProcess.active) kill();
        for (const fn of ctx.cleanups.reverse()) { try { fn(); } catch { /* best effort */ } }
        tryGit(root, ['update-ref', '-d', gateRef]);
        fs.rmSync(runDir, { recursive: true, force: true });
        release();
    };
    const onSignal = sig => { console.log(`\nalfred-gate: ${sig} - stopping the legs and putting things back`); cleanup(); process.exit(130); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try
    {
        git(root, ['update-ref', gateRef, sha]);
        git(root, ['bundle', 'create', '-q', ctx.bundle, gateRef, ...(mainRef ? [mainRef] : [])]);
        copyLeg(runDir);
        fs.chmodSync(ctx.bundle, 0o644);
        const started = Date.now();
        console.log(`alfred-gate: ${label} @ ${short} on ${legs.join(', ')} (Node ${ctx.nodeMajor || '?'} as ci.yml pins)`);
        const verdicts = await Promise.all(legs.map(async leg => {
            let r;
            try { r = await LEG_RUNNERS[leg](ctx); }
            catch (err) { r = { reasons: [String(err.message || err)] }; }
            const v = legVerdict(leg, r);
            console.log(`  [${leg}] ${v.ok ? 'PASS' : 'FAIL'}`);
            return v;
        }));
        nodeSkew(verdicts, ctx.nodeMajor);
        console.log(`\nalfred-gate: ${label} @ ${short} - ${fmtMs(Date.now() - started)}`);
        for (const v of verdicts)
        {
            console.log(summaryLine(v));
            if (v.note) console.log(`         note: ${v.note}`);
            if (v.result?.missing?.length) console.log(`         note: no ${v.result.missing.join(', ')} here - the tests that need it skip or fail where CI runs them`);
            if (v.ok) continue;
            if (v.result) for (const r of v.reasons) console.log(`         ${r}`);
            for (const name of v.result?.failed || []) console.log(`         not ok - ${name}`);
            const testFailed = v.result?.failed?.length;
            if (fs.existsSync(ctx.log(v.leg)))
            {
                if (!testFailed) console.log(tail(ctx.log(v.leg)).replace(/^/gm, '         | '));
                console.log(`         log: ${ctx.log(v.leg)}`);
            }
        }
        const ok = verdicts.every(v => v.ok);
        if (ok)
        {
            const passDir = path.join(gateDir, 'pass');
            fs.mkdirSync(passDir, { recursive: true });
            const legsPassed = [...new Set([...passedLegs(gateDir, sha), ...legs])];
            fs.writeFileSync(path.join(passDir, `${sha}.json`), JSON.stringify({ legs: legsPassed, branch, at: new Date().toISOString() }) + '\n');
            pruneByTime(passDir, KEEP_PASS_STAMPS);
        }
        return ok;
    }
    finally
    {
        cleanup();
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        prune(path.join(gateDir, 'logs'), KEEP_LOG_RUNS);
    }
}

function pruneByTime(dir, keep)
{
    const entries = safeList(dir).map(e => ({ e, t: fs.statSync(path.join(dir, e)).mtimeMs })).sort((a, b) => a.t - b.t);
    for (const { e } of entries.slice(0, Math.max(0, entries.length - keep))) fs.rmSync(path.join(dir, e), { force: true });
}

function readFile(file)
{
    try { return fs.readFileSync(file, 'utf8'); }
    catch { return ''; }
}

function configuredLegs(root, opts, env = process.env)
{
    if (opts.legs) return opts.legs;
    if (env.GATE_LEGS) return parseLegs(env.GATE_LEGS);
    const cfg = tryGit(root, ['config', '--get', 'gate.legs']);
    return cfg ? parseLegs(cfg) : LEGS;
}

function installHook(root)
{
    const commonDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const current = tryGit(root, ['config', '--get', 'core.hooksPath']);
    if (current && current !== HOOKS_PATH) throw new Error(`core.hooksPath is already '${current}' - not replacing it; call scripts/git-hooks/pre-push from there instead`);
    const own = safeList(path.join(commonDir, 'hooks')).filter(f => !f.endsWith('.sample'));
    git(root, ['config', 'core.hooksPath', HOOKS_PATH]);
    console.log(`alfred-gate: pre-push hook on (core.hooksPath = ${HOOKS_PATH}) - every push runs the gate first; skip one with git push --no-verify`);
    if (own.length) console.log(`  note: ${own.join(', ')} in .git/hooks no longer run`);
    if (!tryGit(root, ['config', '--get', 'gate.windowsVm'])) console.log(`  the win leg needs: git config gate.windowsVm '<Parallels VM name>'`);
}

function uninstallHook(root)
{
    if (tryGit(root, ['config', '--get', 'core.hooksPath']) !== HOOKS_PATH) { console.log('alfred-gate: the pre-push hook is not on'); return; }
    git(root, ['config', '--unset', 'core.hooksPath']);
    console.log('alfred-gate: pre-push hook off');
}

async function main(argv)
{
    const opts = parseArgs(argv);
    const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
    if (opts.installHook) { installHook(root); return 0; }
    if (opts.uninstallHook) { uninstallHook(root); return 0; }
    const legs = configuredLegs(root, opts);
    if (opts.prePush)
    {
        // A tag push names the tag object; the gate runs the commit under it, once per commit.
        const targets = new Map();
        for (const t of readPrePush(fs.readFileSync(0, 'utf8')))
        {
            const sha = tryGit(root, ['rev-parse', '--verify', '--quiet', `${t.sha}^{commit}`]);
            if (sha && !targets.has(sha)) targets.set(sha, { ...t, sha });
        }
        for (const t of targets.values())
        {
            if (await runGate({ root, sha: t.sha, branch: t.branch, label: t.label, legs, force: opts.force, keep: opts.keep })) continue;
            console.log('\nalfred-gate: push stopped - fix the failure, or push once without the gate: git push --no-verify');
            return 1;
        }
        return 0;
    }
    const sha = git(root, ['rev-parse', '--verify', `${opts.ref}^{commit}`]);
    const branch = /^refs\/heads\/(.+)$/.exec(tryGit(root, ['rev-parse', '--symbolic-full-name', opts.ref]))?.[1] || 'alfred-gate';
    if (opts.ref === 'HEAD')
    {
        const dirty = tryGit(root, ['status', '--porcelain']).split('\n').filter(Boolean).length;
        if (dirty) console.log(`alfred-gate: ${dirty} uncommitted change(s), new files included, are NOT in the run - the gate tests the commit, as CI does`);
    }
    return (await runGate({ root, sha, branch, legs, force: opts.force, keep: opts.keep })) ? 0 : 1;
}

if (require.main === module)
{
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    main(process.argv.slice(2)).then(code => process.exit(code), err => { console.error(`alfred-gate: ${err.message || err}`); process.exit(2); });
}

module.exports = { LEGS, nodeSkew, takeLock, parseArgs, parseLegs, readPrePush, ciNodeMajor, findNode, vmShare, isolated, WAKE, RESTORE, cleanEnv, legVerdict, configuredLegs };
