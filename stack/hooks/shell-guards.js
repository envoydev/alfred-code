#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
//
// THE SHELL-GUARD DISPATCHER (R11). A Bash or PowerShell call used to spawn one node process per
// shell guard - eight guards plus instrumentation, nine processes (R11; nine guards since the post-compaction hold) - and on a Windows guest a bare
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
// non-deterministically; here every blocking guard's reason reaches it, in GUARDS order - except after a
// PROTECTIVE guard's exit 2 (force-push, rm, secret), which is answered at once: the guards run one after
// another, so a later one stalling past the budget would drop it - a timed-out command hook has its output
// discarded and, on PreToolUse, the call continues through the normal permission flow with every verdict dropped
// (code.claude.com/docs/en/hooks, 'Timeouts': 'A timed-out command ... hook doesn't block the tool call'; the
// deny-on-timeout of the agent-sdk page is the SDK callback family) - and the protective ones therefore run first
// (RUN_ORDER). Context
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
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// The guards a shell call runs, in the manifest's order. A guard joins when its verdict is a
// function of the payload and the files it reads - true of all nine, docs-session's state files
// and the post-compaction hold's marker included. instrument-tool-usage is not here: it is wired on every tool (`.*`), so it would fire
// for Bash as well.
const GUARDS = [
    'guard-protected-force-push',
    'guard-catastrophic-rm',
    'guard-read-whole-file',
    'guard-secret-value',
    'guard-ungated-commit',
    'guard-fresh-session-start',
    'guard-config-protection',
    'guard-cross-project-write',
    'docs-session',
];
const SELF = 'shell-guards';
const MATCHER = 'Bash|PowerShell|Monitor';
// The guards whose exit 2 ends the run where it stands (2.1.5 M2) - hook-prelude.js PROTECTIVE's shell members,
// spelled here so a dispatcher running without the prelude keeps the rule.
const PROTECTIVE = new Set(['guard-protected-force-push', 'guard-catastrophic-rm', 'guard-secret-value']);
// The order the guards RUN in: the protective ones first, so a guard stalling past the budget can never drop their
// verdict (the secret guard ran after the read guard - the 2.1.5 hooks review), the rest in the manifest's order.
// The answer still lists every message in GUARDS order.
const RUN_ORDER = [...GUARDS.filter((g) => PROTECTIVE.has(g)), ...GUARDS.filter((g) => !PROTECTIVE.has(g))];

// ---- the wiring ---------------------------------------------------------------------------------
// The manifest keeps one `<guard>.js::Bash|PowerShell|Monitor` row per guard (the shell route: shell-writes.js SHELL_TOOLS) - that is the catalog the walk
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

// ---- the compile cache ---------------------------------------------------------------------------
// About 50 of the ~120ms a Bash call waits on this dispatcher was compiling the guards, not judging (deep hooks review
// 2026-10-16). V8's cached data for each guard body is kept in the temp dir under a key of its source and this Node, so an
// edited guard or a new Node never reads a stale entry; a rejected or unreadable entry is a plain compile, and the entry is
// written once, after the guard ran, so it holds the functions the run compiled. The helpers a guard `require`s take
// Node's own compile cache (keyed on their source too). Any failure here is a plain compile: the cache only saves time.
const crypto = require('node:crypto');
const CACHE_PREFIX = 'alfred-v8-';
const GUARD_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];
try { require('node:module').enableCompileCache?.(path.join(os.tmpdir(), `${CACHE_PREFIX}modules`)); }
catch { /* an older Node, or a dir it cannot write */ }
function compileGuard(file, source)
{
    const text = source.replace(/^#!/, '//');
    let entry = null;
    try { entry = path.join(os.tmpdir(), `${CACHE_PREFIX}${path.basename(file, '.js')}-${crypto.createHash('sha1').update(`${process.version}\0${text}`).digest('hex').slice(0, 16)}.bin`); }
    catch { entry = null; }
    let cachedData;
    try { if (entry) cachedData = fs.readFileSync(entry); }
    catch { cachedData = undefined; }
    let script = null;
    try
    {
        // one line of wrapper, so every line number the guard reports is its own
        script = new vm.Script(`(function (${GUARD_PARAMS.join(', ')}) {${text}\n})`, { filename: file, cachedData });
        const fn = script.runInThisContext();
        const fresh = !cachedData || script.cachedDataRejected;
        return { fn, save: () =>
        {
            if (!fresh || !entry) return;
            try
            {
                const tmp = `${entry}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, script.createCachedData());
                fs.renameSync(tmp, entry);
                const prelude = require('./hook-prelude.js');
                if (typeof prelude.sweepStale === 'function') prelude.sweepStale(os.tmpdir(), CACHE_PREFIX);
            }
            catch { /* a cache that cannot be written costs only the next compile */ }
        } };
    }
    catch
    {
        return { fn: vm.compileFunction(text, GUARD_PARAMS, { filename: file }), save: () => {} };
    }
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
    let compiled = null;
    try
    {
        compiled = compileGuard(file, source);
        compiled.fn.call(mod.exports, mod.exports, req, mod, file, path.dirname(file));
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
    if (compiled) compiled.save();
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

// ---- the dispatcher's own checks (audit 2026-10-10) ---------------------------------------------
// Four habits the rules state and no guard held, judged once here on the shell route - never per guard - and only where
// the stack runs its non-protective hooks (hook-prelude.js standDown: the csv, `minimal`, a repo never set up, a Cursor
// payload):
//   - zsh (the Bash tool runs the user's $SHELL) aborts the WHOLE command on a bare glob it cannot match and on a bare
//     word opening with `=` (`=====` looks up a command `====`); a tool-owned glob (`--include=*.ts`, `-name *.md`) and
//     a `=word` are quoted before any guard reads the command, so every guard judges what runs (sessions 7491ab75: 25
//     aborted steps; 0498718d: 44; 458953b8, f10cb06a, db6c1ae1: `echo =====`). A brace list after `--include=` is
//     expanded the way the shell would have, one quoted word per alternative.
//   - a FOREGROUND `until` / `while` loop that sleeps holds the turn and every queued message until it ends (516e653d:
//     a question waited 6m58s; 3b53e0e8: a sentinel that never matched ran the full 600s): blocked, naming
//     run_in_background and the Monitor tool. A `while read` loop reads input and is no poll; the command's `timeout`s
//     summing to 120s or less bound it. A foreground `tail -f` is the same wait (deep hooks review 2026-10-16).
//   - an unaddressed `sed -i` `s///` whose pattern matches more than one line of its file gets a note naming the lines
//     (49cb4b82: both task cards flipped).
//   - a recursive grep for a code identifier in the main session writes one `mode: probe` row, the rate a nudge would
//     be weighed on (bc2fa83e: 16 grep-then-read against 1 symbol call).
// What the first background call of an actor is told (RU04): the watch mechanics the quality-gates rule used to carry.
const BACKGROUND_NOTE = 'Background wait (alfred-quality-gates.md): one command whose end is all that matters needs nothing more - its exit '
    + 're-invokes you. A suite of unknown length (failures show long before its end), a condition inside a run or across several '
    + 'arms takes the `Monitor` tool when you start it - on the failure lines plus an alert when the output goes quiet (deferred: '
    + '`ToolSearch select:Monitor` first). Poll it through `Monitor` or its new lines, never a whole-log re-read. A \'what is '
    + 'running\' check keys on a specific PID, marker file or output sentinel, never a bare process-name grep; task lists track '
    + 'tasks, not shells. Tell the user ONE start line - what runs and when it should finish - then nothing until the result or a '
    + 'failure: one watch whose command ends on either (an `until` on the result line or a crash signature), never a reply per '
    + 'sample, never silence past the finish time you gave.';
// What the first Monitor call of an actor is told (audit 2026-10-20 C32, 7c1af769 / 9a0314ed): the note above rode only a
// background Bash call, 1.5h before the Monitor whose per-sample lines woke 12 turns (2.8M) - every printed line is a wake.
const MONITOR_NOTE = 'Monitor watch: every line this command prints wakes a turn. Print only on a change, a threshold, the result or a '
    + 'failure signature - never a line per sample or per loop pass (`while true; do echo ...; sleep 30; done` wakes you every 30s) - '
    + 'and end the command on the result or a crash. Tell the user ONE start line - what runs and when it should finish - then '
    + 'nothing until the result or a failure: never a reply per wake, never silence past the finish time you gave.';

// THE READ-ONLY SEATS (audit 2026-10-20 A-T1): a seat whose brief says it only observes - a verifier, a solution designer,
// an analyzer, the integration reviewer, the security auditor, the evidence gatherer, an issue diagnoser - still carries
// Bash, and a verifier's `git reset -q` unstaged a user's `git rm` (audit 2026-10-10). Keyed on the payload's
// `agent_type`, bare or the house's own prefix (another plugin's seat of that name is not ours); implementers and
// resolvers stay free. Each literal write target (shell-writes.js scanShell: a redirect, tee, cp / mv, rm, an in-place
// edit, a PowerShell write cmdlet, a runtime's literal write) outside the OS temp dirs and `/dev`, and each git call that
// moves the index, the working tree, a ref or a stash (gitMutates, plus the plumbing that does), is the seat's write.
// A target the shell expands at run time (`> "$OUT"`, a computed interpreter path) cannot be judged and passes.
const READ_ONLY_SEAT = /^(?:alfred-code:)?(?:[a-z][\w-]*-verifier|[a-z][\w-]*-solution-designer|integration-reviewer|security-auditor|evidence-gatherer|[a-z][\w-]*-analyzer|issue-diagnoser-[a-z][\w-]*)$/;
const SEAT_GIT_WRITES = new Set(['update-index', 'update-ref', 'symbolic-ref', 'worktree', 'gc', 'prune', 'notes', 'replace', 'filter-branch', 'read-tree', 'checkout-index']);
function readOnlySeatWrite(payload, command, cwd, sw)
{
    if (!READ_ONLY_SEAT.test(String(payload.agent_type || ''))) return null;
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    const scratch = [os.tmpdir(), process.env.TMPDIR, process.env.TEMP, process.env.TMP, '/tmp', '/private/tmp', '/var/tmp']
        .filter(Boolean).map((d) => real(d));
    const inside = (p, d) => p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
    let scan;
    try { scan = sw.scanShell(command, { cwd }); }
    catch { scan = null; }
    if (scan)
    {
        const norm = (t) => sw.nativePath(sw.unquote(t).replace(/^~(?=$|[\\/])/, os.homedir()));
        for (const t of scan.targets)
        {
            const raw = scan.expandVars(t.raw);
            if (!raw || sw.isVar(raw) || raw === sw.UNKNOWN_WRITE) continue;
            if (/^\/dev(?:\/|$)/.test(raw) || /^(?:nul|NUL|\$null)$/.test(raw)) continue;
            const base = sw.anchorAt(scan.cds, t.index, cwd, norm) || cwd;
            const name = norm(raw);
            let abs = path.isAbsolute(name) ? name : path.resolve(base, name);
            const dir = real(path.dirname(abs));
            abs = path.join(dir, path.basename(abs));
            if (scratch.some((d) => inside(abs, d))) continue;
            return { what: `writes ${raw} (${t.what || 'a write'})`, matched: raw };
        }
    }
    let read;
    try { read = sw.gitText(command, cwd); }
    catch { read = null; }
    for (const call of (read && read.calls) || [])
    {
        const sub = call.sub;
        const argv = (call.argv || []).map(String);
        if (!sub) continue;
        let writes = sw.gitMutates(sub, argv) || SEAT_GIT_WRITES.has(sub) || (sub === 'reflog' && /^(?:expire|delete)$/.test(argv[0] || ''));
        if (sub === 'clean' && argv.some((a) => a === '--dry-run' || /^-[A-Za-z]*n[A-Za-z]*$/.test(a))) writes = false;
        if (sub === 'apply' && argv.some((a) => /^--(?:check|stat|numstat|summary)$/.test(a)) && !argv.some((a) => /^--(?:apply|index|cached)$/.test(a))) writes = false;
        if (sub === 'worktree' && /^(?:list)$/.test(argv[0] || '')) writes = false;
        if (writes) return { what: `runs \`git ${[sub, ...argv].join(' ').slice(0, 80)}\`, which changes the repository`, matched: `git ${sub}` };
    }
    return null;
}

function ownChecks(stdin)
{
    const out = { stdin, results: [] };
    let payload;
    try { payload = JSON.parse(stdin.toString('utf8')); }
    catch { return out; }
    if (!payload || typeof payload !== 'object') return out;
    const tool = String(payload.tool_name || '');
    const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command || !/^(?:Bash|PowerShell|Monitor)$/.test(tool)) return out;
    let prelude = null;
    try { prelude = require('./hook-prelude.js'); }
    catch { prelude = null; }
    try { if (prelude && (prelude.standDown(SELF) || prelude.cursorStandDown(payload, __filename))) return out; }
    catch { /* gates unreadable: judged */ }
    let sw;
    try { sw = require('./shell-writes.js'); }
    catch { return out; }
    const root = process.env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === 'string' && payload.cwd) || process.cwd();
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : root;
    const row = (fields) => ledgerRow(payload, prelude, fields);

    // -- a read-only seat's shell write (audit 2026-10-20 A-T1) --
    const seatWrite = readOnlySeatWrite(payload, command, cwd, sw);
    if (seatWrite)
    {
        const seat = String(payload.agent_type);
        const text = `Blocked: ${seat} is a read-only seat, and this command ${seatWrite.what} - nothing ran.\n`
            + 'A read-only seat observes and reports: no file write outside the OS temp dir, and no git command that moves the\n'
            + 'index, the working tree, a branch or a stash (a verifier\'s `git reset -q` unstaged a user\'s `git rm` - audit\n'
            + '2026-10-10). Run the read form instead (`git diff`, `git status`, `git stash list`, a dry run), write scratch output\n'
            + 'under the OS temp dir, or put the change you would make in your report for the caller to apply.';
        row({ reason: firstLine(text).slice(0, 200), agent: payload.agent_id || null, tool_use_id: payload.tool_use_id || null, detail: { branch: 'read-only-seat', seat, matched: seatWrite.matched.slice(0, 120) } });
        out.results.push({ guard: `${SELF}.js`, code: 2, stdout: '', stderr: text });
        return out;
    }
    if (!/^(?:Bash|Monitor)$/.test(tool)) return out;
    let masked = command;
    try { masked = sw.blankComments(sw.blankHeredocs(command)); }
    catch { masked = command; }
    let spans = [];
    try { spans = sw.quotedSpans(masked); }
    catch { spans = []; }
    const quoted = (i) => spans.some(([a, b]) => i >= a && i < b);

    // -- the poll loop (Bash only: a Monitor command IS the background watch) --
    const LOOP = /(?:^|[\s;&|({]|\bthen\b|\bdo\b|\belse\b)(?:until|while)\s+(?!(?:IFS=\S*\s+)?read\b)[\s\S]*?\bdo\b[\s\S]*?\bsleep\s+[\d.]+[smh]?\b[\s\S]*?\bdone\b/;
    let words = [];
    try { words = sw.commandWords(command); }
    catch { words = []; }
    // timeout's DURATION: its first operand past the options (-s / -k take a value; --signal= and --kill-after= carry one),
    // with an s / m / h / d suffix (hooks review 2026-10-16: `timeout 2m` and `timeout -s KILL 60` read as unbounded).
    const timeoutSeconds = (argv) =>
    {
        let k = 0;
        while (k < argv.length && /^-/.test(argv[k])) k += /^(?:-s|-k|--signal|--kill-after)$/.test(argv[k]) ? 2 : 1;
        const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(String(argv[k] || ''));
        return m ? Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : NaN;
    };
    // Bounded means every wait in the command together stays inside 120s: told to bound one loop, the model chained 110s
    // loops instead, and the turn stayed held in 9 of 11 episodes (deep hooks review 2026-10-16).
    const limits = words.filter((w) => w.name === 'timeout').map((w) => timeoutSeconds(w.argv));
    const bounded = limits.length > 0 && limits.every(Number.isFinite) && limits.reduce((a, b) => a + b, 0) <= 120;
    // ... or swapped the loop for `timeout 280 tail -f` - a follow is the same wait
    const follows = words.some((w) => w.name === 'tail' && w.argv.some((a) => /^-[A-Za-z0-9]*[fF][A-Za-z0-9]*$|^--follow(?:=|$)/.test(a)));
    const chars = masked.split('');
    for (const [a, b] of spans) for (let i = a; i < b && i < chars.length; i++) if (chars[i] !== '\n') chars[i] = ' ';
    const blankQuotes = chars.join('');
    // the lazy spans are linear only while the text is: a command past 50,000 characters is not judged for a loop
    const loopIn = (t) => t.length <= 50000 && /\bsleep\b/.test(t) && /\bdone\b/.test(t) && LOOP.test(t);
    const shellScript = words.filter((w) => /^(?:ba|z|da|k)?sh$/.test(w.name)).map((w) => w.argv[w.argv.indexOf('-c') + 1] || '').filter(Boolean);
    if (tool === 'Bash' && input.run_in_background !== true && !bounded && (follows || loopIn(blankQuotes) || shellScript.some(loopIn)))
    {
        const text = 'Blocked: a FOREGROUND wait - nothing ran. Wait in the background instead:\n'
            + '  - the same command with `run_in_background: true` - its exit re-invokes you, and you keep working meanwhile;\n'
            + '  - or the `Monitor` tool on the condition or the log line (deferred: `ToolSearch select:Monitor` first).\n'
            + `A sleeping \`until\` / \`while\` loop, a \`tail -f\` or a chain of bounded waits holds this turn and every message the user\n`
            + 'queues until it ends (measured: a question waited 6m58s; a sentinel that never matched ran the full 600s).';
        row({ reason: firstLine(text).slice(0, 200), detail: { branch: 'poll-loop' } });
        out.results.push({ guard: `${SELF}.js`, code: 2, stdout: '', stderr: text });
    }

    // -- the first background call: how to watch it (audit 2026-10-14 RU04) --
    // The always-on quality-gates rule keeps 'a wait measured in minutes runs in the background'; these mechanics ride
    // the first run_in_background Bash call of each actor (the main session or one seat), once - an exclusive marker -
    // where they apply, instead of every session's context (533 chars there; a background call in 24.8% of sessions).
    // The first Monitor call of each actor gets its own note under its own marker (audit 2026-10-20 C32): a session whose
    // background Bash heard the note an hour earlier still hears the per-wake rule where the watch starts.
    const watch = tool === 'Bash' && input.run_in_background === true ? { kind: '', branch: 'bg-note', note: BACKGROUND_NOTE }
        : tool === 'Monitor' ? { kind: 'mon-', branch: 'monitor-note', note: MONITOR_NOTE } : null;
    if (watch)
    {
        let first = false;
        try
        {
            const dir = (prelude && typeof prelude.envOf === 'function' && prelude.envOf(process.env, 'HOOK_LOG_DIR')) || os.tmpdir();
            const part = (v) => String(v || '').replace(/[^\w.-]/g, '_').slice(-80);
            fs.writeFileSync(path.join(dir, `alfred-bg-note-${watch.kind}${part(payload.session_id || 'nosession')}-${part(payload.agent_id || 'main')}`), new Date().toISOString(), { flag: 'wx' });
            first = true;
            if (prelude && typeof prelude.sweepStale === 'function') prelude.sweepStale(dir, 'alfred-bg-note-');
        }
        catch { first = false; }
        if (first)
        {
            row({ mode: 'probe', reason: `probe: ${watch.branch}`, detail: { branch: watch.branch } });
            out.results.push({ guard: `${SELF}.js`, code: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: watch.note } }) });
        }
    }

    // -- the zsh traps: quote what zsh would expand and abort on --
    const shell = path.basename(String(process.env.SHELL || ''));
    const edits = [];
    if (shell === 'zsh')
    {
        const tests = [];
        // `[[ ... ]]` and `(( ... ))` read their own operators: `==` there is no command lookup, and quoting it breaks them
        for (const m of masked.matchAll(/\[\[[\s\S]*?\]\]|\(\([\s\S]*?\)\)/g)) if (!quoted(m.index)) tests.push([m.index, m.index + m[0].length]);
        const inTest = (i) => tests.some(([a, b]) => i >= a && i < b);
        const END = '(?=$|[\\s;|&()<>])';
        const BARE = "[^\\s;|&()<>'\"`\\\\$]*";
        const braces = (v) => { const g = /\{([^{}]*,[^{}]*)\}/.exec(v); return g ? g[1].split(',').flatMap((alt) => braces(v.slice(0, g.index) + alt + v.slice(g.index + g[0].length))) : [v]; };
        for (const m of masked.matchAll(new RegExp(`(^|[\\s;|&(])(--(?:include|exclude|exclude-dir)=)(${BARE}[*?[]${BARE})${END}`, 'g')))
        {
            const at = m.index + m[1].length;
            if (quoted(at) || inTest(at)) continue;
            edits.push([at, at + m[2].length + m[3].length, braces(m[3]).map((v) => `${m[2]}'${v}'`).join(' ')]);
        }
        for (const m of masked.matchAll(new RegExp(`(^|[\\s;|&(])(-(?:i?name|i?path|i?wholename))(\\s+)(${BARE}[*?[]${BARE})${END}`, 'g')))
        {
            const at = m.index + m[1].length + m[2].length + m[3].length;
            if (quoted(at) || inTest(at) || m[4].includes('{')) continue;
            edits.push([at, at + m[4].length, `'${m[4]}'`]);
        }
        for (const m of masked.matchAll(new RegExp(`(^|[\\s;|&(])(=${BARE})${END}`, 'g')))
        {
            const at = m.index + m[1].length;
            if (m[2].length < 2 || quoted(at) || inTest(at)) continue;
            edits.push([at, at + m[2].length, `'${m[2]}'`]);
        }
    }
    if (edits.length)
    {
        let fixed = command;
        for (const [a, b, rep] of edits.sort((x, y) => y[0] - x[0])) fixed = fixed.slice(0, a) + rep + fixed.slice(b);
        const pm = typeof payload.permission_mode === 'string' && payload.permission_mode ? { permissionMode: payload.permission_mode } : {};
        row({ mode: 'rewrite', reason: 'rewrite: zsh-quote', detail: { branch: 'zsh-quote', fixes: edits.length, ...pm } });
        const next = { ...payload, tool_input: { ...input, command: fixed } };
        out.stdin = Buffer.from(JSON.stringify(next));
        out.results.push({ guard: `${SELF}.js`, code: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input, command: fixed } } }) });
    }

    // -- an unaddressed sed -i s/// over several lines --
    const notes = [];
    for (const w of words)
    {
        if (w.name !== 'sed' || !w.argv.some((a) => /^(?:-[A-Za-z]*i|--in-place)/.test(a)) || notes.length) continue;
        const scripts = [];
        const files = [];
        let ere = false;
        let scriptFile = false;
        const explicit = w.argv.some((a) => a === '-e' || a === '--expression');
        for (let k = 0; k < w.argv.length; k++)
        {
            const a = w.argv[k];
            if (a === '-e' || a === '--expression') { scripts.push(w.argv[++k] || ''); continue; }
            if (a === '-i' && w.argv[k + 1] === '') { k++; continue; }
            if (/^(?:-f|--file)$/.test(a)) { scriptFile = true; break; }
            if (/^-[A-Za-z]*[Er]/.test(a)) ere = true;
            if (a.startsWith('-')) continue;
            if (!explicit && !scripts.length) scripts.push(a); else files.push(a);
        }
        if (scriptFile || files.length > 4) continue;
        for (const script of scripts)
        {
            for (const cmd of script.split(/[;\n]/).map((x) => x.trim()))
            {
                const s = /^s(.)((?:(?!\1)[^\\]|\\.)*)\1((?:(?!\1)[^\\]|\\.)*)\1([gIi0-9]*)$/.exec(cmd);
                if (!s || !s[2]) continue;
                let re;
                try
                {
                    const src = ere ? s[2] : s[2].replace(/\\([(){}+?|])|([(){}+?|])/g, (all, esc, lit) => (esc ? esc : `\\${lit}`));
                    re = new RegExp(src, /[Ii]/.test(s[4]) ? 'i' : '');
                }
                catch { continue; }
                for (const f of files)
                {
                    let text = '';
                    try
                    {
                        const abs = path.resolve(cwd, f);
                        if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
                        text = fs.readFileSync(abs, 'utf8');
                    }
                    catch { continue; }
                    const lines = text.split('\n').map((l, i) => (re.test(l) ? i + 1 : 0)).filter(Boolean);
                    if (lines.length > 1)
                    {
                        notes.push(`sed -i: \`${cmd.slice(0, 60)}\` has no address and its pattern matches ${lines.length} lines of ${f} (line${lines.length > 1 ? 's' : ''} ${lines.slice(0, 6).join(', ')}${lines.length > 6 ? ', ...' : ''}) - every one changes. If one line was meant, address it (\`${lines[0]}s/.../.../\`) or anchor the pattern on text only that line holds.`);
                        break;
                    }
                }
                if (notes.length) break;
            }
            if (notes.length) break;
        }
    }
    if (notes.length)
    {
        row({ mode: 'probe', reason: 'probe: sed-multi-match', detail: { branch: 'sed-multi-match' } });
        out.results.push({ guard: `${SELF}.js`, code: 0, stderr: '', stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notes.join('\n') } }) });
    }

    // -- a name-match symbol grep in the main session (log only) --
    if (!payload.agent_id)
    {
        for (const w of words)
        {
            if (!/^(?:grep|egrep|fgrep|rg)$/.test(w.name)) continue;
            if (w.name !== 'rg' && !w.argv.some((a) => /^-[A-Za-z]*[rR]|^--recursive$/.test(a))) continue;
            const e = w.argv.indexOf('-e');
            const pattern = e >= 0 ? w.argv[e + 1] || '' : w.argv.find((a) => !a.startsWith('-')) || '';
            const ident = pattern.replace(/\\[b<>]/g, '');
            if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(ident) || /^[A-Za-z_]\w{2,}\\?\($/.test(ident))
            {
                row({ mode: 'probe', reason: 'probe: symbol-grep', detail: { branch: 'symbol-grep', pattern: pattern.slice(0, 40) } });
                break;
            }
        }
    }
    return out;
}

// One row in the session's hook-blocks ledger under the dispatcher's own name - its own checks' rows and the slow probe.
// A repo never set up writes none (GATE 4); telemetry never changes a verdict.
function ledgerRow(payload, prelude, fields)
{
    try
    {
        if (prelude && prelude.neverSetUp && prelude.neverSetUp()) return;
        const envOf = prelude && prelude.envOf ? prelude.envOf : (env, k) => env[`ALFRED_CODE_${k}`];
        const root = process.env.CLAUDE_PROJECT_DIR || (typeof payload.cwd === 'string' && payload.cwd) || process.cwd();
        const dir = path.resolve(root, envOf(process.env, 'DOCS_PATH') || '.alfred/docs', 'hook-blocks');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
            ts: new Date().toISOString(), hook: `${SELF}.js`, event: payload.hook_event_name || '', tool: String(payload.tool_name || ''), ...fields,
        }) + '\n');
    }
    catch { /* telemetry never changes a verdict */ }
}

// THE SLOW-RUN PROBE (audit 2026-10-14 HK15): 86 dispatcher runs took 1s or more in one week (max 12,086ms) and no row
// named the guard that spent it. A run past SLOW_MS - timed from the process's own start, so a slow node boot counts -
// writes one `mode: probe`, `kind: slow` row with each guard's ms, its own checks' and the boot's. Log only: the budget
// a guard gets is tuned on a week of these rows, never on one.
const SLOW_MS = 1000;
function slowProbe(timings, totalMs)
{
    if (!(totalMs > SLOW_MS)) return null;
    return { mode: 'probe', kind: 'slow', reason: `probe: slow - the dispatcher ran ${totalMs}ms`, detail: { branch: 'slow', total_ms: totalMs, ...timings } };
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
    // the dispatcher's own checks first: a zsh fix hands every guard the command that will run
    const started = performance.now();
    let own = { stdin, results: [] };
    try { own = ownChecks(stdin); }
    catch { /* never breaks the guards */ }
    stdin = own.stdin;
    const ownMs = performance.now() - started;
    const named = process.argv.slice(2).filter((a) => GUARDS.includes(a));
    const guards = named.length ? RUN_ORDER.filter((g) => named.includes(g)) : RUN_ORDER;
    const results = [...own.results];
    const spent = {};
    for (const g of guards)
    {
        const at = performance.now();
        const r = runGuard(path.join(__dirname, `${g}.js`), stdin);
        spent[g] = Math.round(performance.now() - at);
        results.push(r);
        // A protective block is a correct answer alone, so it is answered now: a guard still to run that
        // stalls past the budget would otherwise drop it - a timed-out command hook's output is discarded and the
        // call runs (code.claude.com/docs/en/hooks, 'Timeouts').
        if (r.code === 2 && PROTECTIVE.has(g)) break;
    }
    try
    {
        const slow = slowProbe({ startup_ms: Math.round(started), own_ms: Math.round(ownMs), guards: spent }, Math.round(performance.now()));
        if (slow)
        {
            const payload = JSON.parse(stdin.toString('utf8'));
            let prelude = null;
            try { prelude = require('./hook-prelude.js'); }
            catch { prelude = null; }
            if (payload && typeof payload === 'object' && !(prelude && (prelude.standDown(SELF) || prelude.cursorStandDown(payload, __filename))))
                ledgerRow(payload, prelude, slow);
        }
    }
    catch { /* telemetry never changes a verdict */ }
    const verdict = combine(results.sort((a, b) => GUARDS.indexOf(a.guard.replace(/\.js$/, '')) - GUARDS.indexOf(b.guard.replace(/\.js$/, ''))));
    // Exit only once both streams have flushed: a pipe write can still be pending on macOS.
    let pending = 0;
    const done = () => { if (--pending <= 0) process.exit(verdict.code); };
    for (const [stream, text] of [[process.stdout, verdict.stdout], [process.stderr, verdict.stderr]])
        if (text) { pending++; stream.write(text, done); }
    if (!pending) process.exit(verdict.code);
}

module.exports = { GUARDS, SELF, MATCHER, PROTECTIVE, RUN_ORDER, SLOW_MS, BACKGROUND_NOTE, MONITOR_NOTE, wiringRows, runGuard, combine, parseOut, ownChecks, slowProbe };
if (require.main === module) main();
