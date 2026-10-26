'use strict';
// secrets-run.js - the MCP server launcher (workspace layering, release 2), never a model tool. A registration that
// launches `node <project>/.claude/hooks/secrets-run.js -- <command> [args...]` gets the workspace chain's values in its
// environment, read at its cwd when that folder is this runner's own project or a workspace descendant of it (the
// chain's back-references prove it). In any other folder no chain value is passed, so a user-scope wrap never hands a
// tree's secrets to a server launched in an unrelated project. stdin and stdout are inherited untouched - stdout is the
// MCP protocol - and stderr is masked line by line, each value of MASK_MIN or more characters shown as <KEY>. The exit
// code is the command's, 1 when it cannot start. The secret guard denies a shell command naming this file and points
// to its --with-sensitive, which masks both streams.
// An engine (HOOK_ENGINES): Node's own modules, and ./layout.js and ./secret-chain.js beside it.
const fs = require('fs');
const path = require('path');

// Node writes a pipe async on macOS and an exit drops what the pipe has not taken: stderr is made blocking so every
// masked line reaches its reader (blocking-stdio in meta/shared-rules.json - this engine ships without the prelude).
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}

// WINDOWS: a copy of scripts/install/runtime.js's resolveWin, cmdArg and commandPlan (an engine cannot require the
// installer; scripts/secrets-run.test.js holds the two equal on the same inputs). A .exe / .com starts directly, a .cmd /
// .bat through cmd.exe with every argument quoted and caret-escaped twice, an argument holding a line break is refused.
const STARTABLE = ['.com', '.exe', '.bat', '.cmd'];
const isFileOnDisk = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const envKey = (env, name) => Object.keys(env || {}).find((k) => k.toUpperCase() === name);
function resolveWin(cmd, env = process.env, isFile = isFileOnDisk)
{
    const read = (name) => { const k = envKey(env, name); return k ? String(env[k] || '') : ''; };
    const dirs = read('PATH').split(';').map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter((d) => path.win32.isAbsolute(d) && /^([A-Za-z]:\\|\\\\)/.test(d));
    const listed = (read('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter((e) => STARTABLE.includes(e));
    const own = path.win32.extname(cmd).toLowerCase();
    const names = STARTABLE.includes(own) ? [cmd] : listed.map((e) => cmd + e);
    // A full path (process.execPath, a --claude path) is that file, never a name to look up on PATH.
    if (/^([A-Za-z]:\\|\\\\)/.test(cmd)) return names.find((name) => isFile(name)) || '';
    for (const dir of dirs)
        for (const name of names)
        {
            const full = path.win32.join(dir, name);
            if (isFile(full)) return full;
        }
    return '';
}
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArg(arg)
{
    const quoted = `"${String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
    return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}
function commandPlan(bin, argv, opts, { platform = process.platform, resolve = resolveWin } = {})
{
    if (platform !== 'win32') return { cmd: bin, args: argv, opts };
    const env = (opts && opts.env) || process.env;
    const full = resolve(bin, env);
    if (!full) return { why: `${bin}: not found on PATH as a .exe, .com, .cmd or .bat` };
    if (!/\.(cmd|bat)$/i.test(full)) return { cmd: full, args: argv, opts };
    if (argv.some((a) => /[\r\n]/.test(String(a)))) return { why: `${bin}: an argument holds a line break, which cmd.exe cannot pass` };
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    const line = [full.replace(CMD_META, '^$1'), ...argv.map(cmdArg)].join(' ');
    return { cmd: comspec, args: ['/d', '/s', '/c', `"${line}"`], opts: { ...opts, windowsVerbatimArguments: true } };
}

// The shortest value masked on stderr, as --with-sensitive's: PORT=80 would mask every 80 and say nothing a guess would not.
const MASK_MIN = 4;
const say = (line) => process.stderr.write(`# secrets-run: ${line}\n`);
// A folder as one comparable key: its real path, case folded where the disk folds it (layout.js wsKey's rule).
const keyOf = (p) =>
{
    let real = path.resolve(p);
    try { real = fs.realpathSync.native(real); } catch { /* as written */ }
    const key = real.split(path.sep).join('/');
    return process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key;
};

// Whether a server started in `cwd` may read the chain: the cwd's project is this runner's own, or a project whose
// workspace chain holds this runner's project as a member. The kill switch leaves only the first.
function chainAllowed(cwd, project, env, layout)
{
    let at = cwd;
    try { at = layout.projectRootOf(cwd).project; } catch { /* the cwd itself */ }
    const mine = keyOf(project);
    if (keyOf(at) === mine) return true;
    if (!layout.workspaceOn({ env, projectRoot: at })) return false;
    try { return layout.workspaceChain(at, { env }).members.some((m) => keyOf(m.root) === mine); } catch { return false; }
}

function main()
{
    blockingStdio();
    const rest = process.argv.slice(2);
    const words = rest[0] === '--' ? rest.slice(1) : rest;
    if (!words.length)
    {
        say('usage: node <project>/.claude/hooks/secrets-run.js -- <command> [args...]');
        process.exit(2);
    }
    const env = process.env;
    const cwd = process.cwd();
    const project = path.resolve(__dirname, '..', '..');
    let values = {};
    let from = {};
    let mask = (text) => text;
    try
    {
        const layout = require(path.join(__dirname, 'layout.js'));
        const secretChain = require(path.join(__dirname, 'secret-chain.js'));
        if (chainAllowed(cwd, project, env, layout))
        {
            ({ values, from } = secretChain.chainOf(cwd, { env }));
            mask = secretChain.masker(values, MASK_MIN);
        }
        else say(`${cwd} is neither this runner's project nor a workspace descendant of it - no chain value passed`);
    }
    catch (err) { say(`the chain could not be read (${err.message}) - no chain value passed`); }
    const keys = Object.keys(values);
    if (keys.length) say(`${keys.length} value(s) in the environment (${keys.map((k) => `${k} from ${from[k]}`).join(', ')}), each shown as <KEY> on stderr`);

    const plan = commandPlan(words[0], words.slice(1), { cwd, env: { ...env, ...values }, stdio: ['inherit', 'inherit', 'pipe'] });
    if (plan.why)
    {
        say(`could not start ${words[0]} - ${plan.why}`);
        process.exit(1);
    }
    const { spawn } = require('child_process');
    const child = spawn(plan.cmd, plan.args, plan.opts);
    // stderr line by line, so a value split across two chunks is still masked whole
    const { StringDecoder } = require('string_decoder');
    const decoder = new StringDecoder('utf8');
    let carry = '';
    child.stderr.on('data', (chunk) =>
    {
        const text = carry + decoder.write(chunk);
        const cut = text.lastIndexOf('\n');
        carry = cut < 0 ? text : text.slice(cut + 1);
        if (cut >= 0) process.stderr.write(mask(text.slice(0, cut + 1)));
    });
    const flush = () => { const tail = carry + decoder.end(); carry = ''; if (tail) process.stderr.write(mask(tail)); };
    child.on('error', (err) => { flush(); say(`could not start ${words[0]} - ${err.message}`); process.exit(1); });
    child.on('close', (code, signal) => { flush(); process.exitCode = signal ? 1 : (code ?? 0); });
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
}

if (require.main === module) main();
module.exports = { resolveWin, cmdArg, commandPlan };
