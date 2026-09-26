#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// THE SHELL-GUARD DISPATCHER (R11). A Bash or PowerShell call used to spawn one node process per
// shell guard - eight guards plus instrumentation, nine processes - and on a Windows guest a bare
// node start alone costs ~90-130ms, so one call paid 350-410ms in parallel (measured, R11). This
// hook is the ONE process for all of them: it runs each guard IN-PROCESS and answers the way
// Claude Code merges the same guards wired as separate hooks.
//
// Each guard stays exactly what it was: its own file, its own `require.main === module` entry, its
// own gates and its own tests, which spawn it standalone. `runGuard` gives it the process it expects
// - its source compiled as the main module (so its `require.main === module` gate block runs), the
// payload on fd 0, `process.exit` ending it where it stands, its stdout and stderr captured, and
// argv, env, exit code and its ledger detail (`global.BLOCK_DETAIL`) put back afterwards - so no guard
// carries a second code path to drift.
// Every gate therefore still runs PER GUARD, and so does the ledger: a guard that blocks writes its
// own hook-blocks row under its own name.
//
// The merge (code.claude.com/docs/en/hooks, PreToolUse decision control; measured on CLI 2.1.283
// with separate probe hooks): any block blocks - an exit 2, whose message is its stderr, or a JSON
// `permissionDecision: deny`. Separate hooks showed the model ONE blocking reason, picked
// non-deterministically; here every blocking guard's reason reaches it, in GUARDS order. Context
// (`additionalContext`) is joined with a newline and delivered even beside a block, as separate
// hooks' was; `updatedInput` (the secret guard's rewrite) applies only when nothing blocks, and every
// guard judged the ORIGINAL command, as it did beside the others in parallel. A guard that throws or
// exits non-zero without JSON fails open for ITSELF - the others' verdicts stand - and the user gets
// the same notice a separate hook's failure gave (a `systemMessage`, never seen by the model).
//
// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them; each guard runs its own.
// The dispatcher's one is GATE 2 for itself: a project that wires the copied dispatcher (the hooks
// copy route) is judged by that copy, so the plugin's steps aside - yieldToCopiedTwin('shell-guards').
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// The guards a shell call runs, in the manifest's order. A guard joins when its verdict is a
// function of the payload and the files it reads - true of all eight, docs-session's state files
// included. instrument-tool-usage is not here: it is wired on every tool (`.*`), so it would fire
// for Bash as well.
const GUARDS = [
    'guard-protected-force-push',
    'guard-catastrophic-rm',
    'guard-read-whole-file',
    'guard-secret-value',
    'guard-ungated-commit',
    'guard-config-protection',
    'guard-cross-project-write',
    'docs-session',
];
const SELF = 'shell-guards';
const MATCHER = 'Bash|PowerShell';

// ---- the wiring ---------------------------------------------------------------------------------
// The manifest keeps one `<guard>.js::Bash|PowerShell` row per guard - that is the catalog the walk
// selects from and the csv names. Both generators (the core entry's hooks block and the copy route's
// settings.json) fold those rows into ONE dispatcher row, at the place of the first. The copy route
// passes `listGuards`: a strict subset is named in the wiring's args, so a guard the selection left
// out is not run by the dispatcher even while an older install's copy of its file is still on disk.
function wiringRows(rows, { listGuards = false } = {})
{
    const out = [];
    const picked = new Set();
    let at = -1;
    for (const row of rows || [])
    {
        const [file = '', matcher = '', args = ''] = String(row.file ?? row).split('::');
        const m = row.matcher ?? matcher;
        const a = row.args ?? args;
        const name = String(row.file ?? file).replace(/\.js$/, '');
        if (m === MATCHER && !String(a || '').trim() && GUARDS.includes(name))
        {
            if (at < 0) at = out.length;
            picked.add(name);
            continue;
        }
        out.push(typeof row === 'string' ? row : `${row.file}::${m}${a ? `::${a}` : ''}`);
    }
    if (at < 0) return out;
    const names = GUARDS.filter((g) => picked.has(g));
    const list = listGuards && names.length < GUARDS.length ? `::${names.join(' ')}` : '';
    out.splice(at, 0, `${SELF}.js::${MATCHER}${list}`);
    return out;
}

// ---- one guard, in-process ----------------------------------------------------------------------
// A guard's exit, thrown through its own stack so nothing after `process.exit` runs. Not an Error: a
// guard's generic `catch (e)` has no message to act on, and whatever it tries after an exit is dropped.
class GuardExit
{
    constructor(code) { this.code = code; }
}

function restoreEnv(snapshot)
{
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(snapshot, key)) delete process.env[key];
    for (const [key, value] of Object.entries(snapshot)) if (process.env[key] !== value) process.env[key] = value;
}

// Runs one guard file against the payload as its own process would, and returns what that process
// would have produced: { guard, code, stdout, stderr }, plus `error` when it threw and `swallowed` when
// its code visibly ran on past an exit - it wrote, exited again with another code, or fell off the end.
// That is a catch around process.exit, which a process never reaches and this runner cannot stop; the
// first exit stays the verdict either way, and the suites fail on the flag. (A catch whose body only
// exits with the same code, like the commit gate's size check, is the process's own answer.)
function runGuard(file, stdin)
{
    const guard = path.basename(file);
    const result = { guard, code: 0, stdout: '', stderr: '' };
    let source;
    try { source = fs.readFileSync(file, 'utf8'); }
    catch { result.missing = true; return result; }

    const saved = {
        exit: process.exit, out: process.stdout.write, err: process.stderr.write, read: fs.readFileSync,
        argv: process.argv, exitCode: process.exitCode, env: { ...process.env },
    };
    let exited = null;
    let stdinRead = false;
    const sink = (key) => function write(chunk, encoding)
    {
        if (exited === null) result[key] += Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
        else result.swallowed = true;
        return true;
    };
    process.stdout.write = sink('stdout');
    process.stderr.write = sink('stderr');
    process.exit = function exit(code)
    {
        const asked = code === undefined || code === null ? Number(process.exitCode) || 0 : Number(code) || 0;
        if (exited === null) exited = asked;
        else if (asked !== exited) result.swallowed = true;
        throw new GuardExit(exited);
    };
    // fd 0 is the payload, read once as a process reads its stdin; every other read is the real one.
    fs.readFileSync = function readFileSync(target, options, ...rest)
    {
        if (target !== 0 && target !== '/dev/stdin') return saved.read.call(fs, target, options, ...rest);
        const buf = stdinRead ? Buffer.alloc(0) : stdin;
        stdinRead = true;
        const encoding = typeof options === 'string' ? options : options && options.encoding;
        return encoding ? buf.toString(encoding) : Buffer.from(buf);
    };
    process.argv = [saved.argv[0], file];
    // A guard's ledger detail is a process GLOBAL: a separate process starts without one, so each guard
    // does here, and none survives it - a staged-scan detail used to ride the next guard's row.
    delete global.BLOCK_DETAIL;

    const base = createRequire(file);
    const mod = { id: file, filename: file, path: path.dirname(file), exports: {}, loaded: false, children: [], paths: [] };
    const req = Object.assign((id) => base(id), { resolve: base.resolve, cache: base.cache, extensions: base.extensions, main: mod });
    mod.require = req;
    try
    {
        const body = vm.compileFunction(source.replace(/^#!/, '//'), ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file });
        body.call(mod.exports, mod.exports, req, mod, file, path.dirname(file));
        // Fell off the end: the process would exit with whatever exitCode it set.
        if (exited === null) exited = Number(process.exitCode) || 0;
        else result.swallowed = true;
    }
    catch (err)
    {
        if (!(err instanceof GuardExit))
        {
            if (exited === null)
            {
                // An uncaught throw ends a node process with 1 and the stack on stderr.
                result.error = err;
                result.stderr += `${(err && err.stack) || err}\n`;
                exited = 1;
            }
            else result.swallowed = true;
        }
    }
    finally
    {
        process.exit = saved.exit;
        process.stdout.write = saved.out;
        process.stderr.write = saved.err;
        fs.readFileSync = saved.read;
        process.argv = saved.argv;
        process.exitCode = saved.exitCode;
        restoreEnv(saved.env);
        delete global.BLOCK_DETAIL;
    }
    result.code = exited;
    return result;
}

// ---- the merge ----------------------------------------------------------------------------------
// Claude Code reads a hook's stdout as JSON only when, trimmed, it starts with `{` and ends with `}`
// (hooks reference, 'Exit code 0'); anything else is plain text, which PreToolUse sends to the debug log.
function parseOut(stdout)
{
    const text = String(stdout || '').trim();
    if (!(text.startsWith('{') && text.endsWith('}'))) return { json: null, invalid: false };
    try
    {
        const json = JSON.parse(text);
        return json && typeof json === 'object' && !Array.isArray(json) ? { json, invalid: false } : { json: null, invalid: true };
    }
    catch { return { json: null, invalid: true }; }
}

// deny > defer > ask > allow (code.claude.com/docs/en/agent-sdk/hooks, 'Register multiple hooks').
const RANK = { allow: 1, ask: 2, defer: 3, deny: 4 };
const firstLine = (text) => String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const joinBlocks = (texts) => (texts.length === 1 ? texts[0] : texts.map((t) => String(t).replace(/\s+$/, '')).join('\n\n'));

function combine(results)
{
    const blocks = [];
    const contexts = [];
    const notes = [];
    const inputs = [];
    let decision = null;
    for (const r of results)
    {
        if (!r || r.missing) continue;
        const { json, invalid } = parseOut(r.stdout);
        const hso = json && json.hookSpecificOutput && typeof json.hookSpecificOutput === 'object' ? json.hookSpecificOutput : {};
        if (typeof hso.additionalContext === 'string' && hso.additionalContext) contexts.push(hso.additionalContext);
        if (json && typeof json.systemMessage === 'string' && json.systemMessage) notes.push(json.systemMessage);
        const reason = hso.permissionDecision === 'deny' ? String(hso.permissionDecisionReason || '')
            : json && json.decision === 'block' ? String(json.reason || '') : null;
        // Exit 2 blocks whatever the JSON says; its message is the JSON's blocking reason, else stderr.
        if (r.code === 2) { blocks.push({ text: reason || r.stderr, exit: true }); continue; }
        if (invalid || (!json && r.code !== 0))
        {
            notes.push(`${r.guard} hook error (non-blocking): ${firstLine(r.stderr) || (invalid ? 'its output is not valid JSON' : `exit ${r.code}`)}`);
            continue;
        }
        if (reason !== null) { blocks.push({ text: reason, exit: false }); continue; }
        if (hso.updatedInput && typeof hso.updatedInput === 'object' && !Array.isArray(hso.updatedInput)) inputs.push(hso.updatedInput);
        if (RANK[hso.permissionDecision] > (decision ? RANK[decision.value] : 0))
            decision = { value: hso.permissionDecision, reason: hso.permissionDecisionReason };
    }

    const out = (code, hso, stderr = '') =>
    {
        const body = {};
        if (notes.length) body.systemMessage = notes.join('\n');
        if (Object.keys(hso).length) body.hookSpecificOutput = { hookEventName: 'PreToolUse', ...hso };
        return { code, stdout: Object.keys(body).length ? JSON.stringify(body) : '', stderr };
    };
    const context = contexts.length ? { additionalContext: contexts.join('\n') } : {};
    if (blocks.length)
    {
        // Every block an exit-2 guard would have raised stays an exit 2, so the model reads it the way it
        // read that guard; a set of JSON denies alone stays one JSON deny (measured on CLI 2.1.283: an
        // exit 2 beside a JSON deny shows the exit-2 text, bracketed with the command; a JSON deny, without).
        if (blocks.some((b) => b.exit))
            return out(2, context, blocks.length === 1 ? blocks[0].text : `${joinBlocks(blocks.map((b) => b.text))}\n`);
        return out(0, { permissionDecision: 'deny', permissionDecisionReason: joinBlocks(blocks.map((b) => b.text)), ...context });
    }
    const hso = {};
    if (decision)
    {
        hso.permissionDecision = decision.value;
        if (decision.reason !== undefined) hso.permissionDecisionReason = decision.reason;
    }
    if (inputs.length) hso.updatedInput = Object.assign({}, ...inputs);
    return out(0, { ...hso, ...context });
}

// ---- the hook -----------------------------------------------------------------------------------
function main()
{
    try
    {
        if (require('./hook-prelude.js').yieldToCopiedTwin(SELF)) process.exit(0);
    }
    catch { /* an install without the prelude runs every guard */ }
    let stdin;
    try { stdin = fs.readFileSync(0); }
    catch { stdin = Buffer.alloc(0); }
    const named = process.argv.slice(2).filter((a) => GUARDS.includes(a));
    const guards = named.length ? GUARDS.filter((g) => named.includes(g)) : GUARDS;
    const results = guards.map((g) => runGuard(path.join(__dirname, `${g}.js`), stdin));
    const verdict = combine(results);
    // Exit only once both streams have flushed: a pipe write can still be pending on macOS.
    let pending = 0;
    const done = () => { if (--pending <= 0) process.exit(verdict.code); };
    for (const [stream, text] of [[process.stdout, verdict.stdout], [process.stderr, verdict.stderr]])
        if (text) { pending++; stream.write(text, done); }
    if (!pending) process.exit(verdict.code);
}

module.exports = { GUARDS, SELF, MATCHER, wiringRows, runGuard, combine, parseOut };
if (require.main === module) main();
