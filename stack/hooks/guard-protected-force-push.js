#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate: block a force-push or deletion of a protected branch (main / master /
// develop). It is a deterministic, catastrophic, irreversible event - so it is enforced by a
// hook with no prose copy to consult (the git preferences doc only prefers --force-with-lease), never left to
// prose the model can skip. Reads the tool-call JSON on stdin; exit 2 blocks
// (stderr fed back to the model), exit 0 allows.
//
// Scope is deliberately narrow - it fires ~never in normal work. The command is read by shell-writes.js's
// `gitText`, the one reader every git guard shares (2.1.6 seam review M3): a `git push` counts only as a COMMAND WORD
// (`echo "git push --force"` is text), past any wrapper (`timeout 60`, `env A=1`, `nohup`, `sudo`, `xargs`), a `git -C dir`
// or `-c k=v`, inside `if` / `for` bodies, `bash -c '...'`, a heredoc or here-string into a shell, `eval`, a script FILE a
// shell runs and an alias git expands (`alias.pf = push --force`), each from the directory a leading `cd` moved it to.
// It blocks a `git push` that would irreversibly rewrite or remove main / master / develop:
//   - a force: -f / --force / --force-with-lease / --force-if-includes, a
//     '+'-prefixed refspec, --mirror (incl. --mirror=<value>), or a forced --all;
//   - a deletion: a `:branch` (empty-source) refspec, or --delete / -d;
//   - named explicitly (refspec, normalized past any refs/heads/ prefix and one
//     layer of surrounding quotes), or a bare force/delete while HEAD is on a
//     protected branch - HEAD as it stands when the push runs, after any `git switch` /
//     `git checkout` earlier in the command (audit 2026-10-30 HK-12);
//   - a bare push whose configured refspec (`-c remote.<r>.push=...`, or a `git config` earlier in
//     the command) forces or deletes one, or a `remote.<r>.mirror` so set; a forced `git send-pack`;
//     `gh api -X PATCH .../git/refs/heads/<protected> -F force=true` or `-X DELETE` on it; and
//     `gh repo sync --force` of a protected or the default branch (HK-15).
// A plain fast-forward push to main, or any force on a feature branch (prefer
// --force-with-lease), is left alone - blocking it would be a false-positive.
// Out of model (an honest mistake never writes these): a command word or refspec a substitution computes
// (`bash -c "$(echo ...)"`, `source <(...)`), a push over ssh or inside `docker exec`, and text past the scan budget;
// a refspec already in the repository's config (no git is spawned to read it) and a GraphQL `updateRef`.
'use strict';
const fs = require('fs');
// The docs root: <data root>/docs - a leftover ALFRED_CODE_DOCS_PATH (retired in 2.8.0) read first (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || `${envOf(process.env, 'DATA_PATH') || '.alfred'}/docs`;
const { execFileSync } = require('child_process');
// Every git this guard runs: fsmonitor off, no optional locks (hook-prelude.js gitSafe, audit 2026-10-20 H2) - the same two
// inline when the prelude is absent, since a protective read must not skip git or run a repository's own program.
const gitSafe = (() => { try { return require('./hook-prelude.js').gitSafe; } catch { return (argv, opts = {}) => ['git', ['-c', 'core.fsmonitor=false', ...argv], { ...opts, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' } }]; } })();

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
// R86: a repo never set up keeps this guard live but gets no block row (R54) - false fails open to logging.
let unsetRepo = false;
if (require.main === module) {
  let off = false;
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    off = prelude.standDown('guard-protected-force-push');
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}

// The reader every git guard shares. A copy that runs before it lands fails open like every gate here (the parity
// test's copy set), rather than judging with a second, weaker reader.
let shellWrites;
try { shellWrites = require('./shell-writes.js'); } catch { process.exit(0); }

const PROTECTED = ['main', 'master', 'develop'];
const FORCE_FLAG = /^(?:-f|--force|--force-with-lease|--force-if-includes)(?:=\S*)?$/;

// Strip one layer of surrounding quotes (same shape as the rm guard) so a quoted
// refspec - `git push origin "main" --force` - normalizes to the bare token.
function unquote(tok)
{
    const t = tok.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))))
    {
        return t.slice(1, -1);
    }

    return t;
}

// Branch name from a ref/refspec destination, normalized for the protected check:
// unquote, then drop a leading '+' (force marker) and any 'refs/heads/' prefix.
function normalizeBranch(ref)
{
    return unquote(ref).replace(/^\+/, '').replace(/^refs\/heads\//, '');
}

// Destination side of a refspec: '+src:dst' / 'src:dst' -> 'dst'; 'dst' -> 'dst'.
function refDestination(token)
{
    const ref = unquote(token).replace(/^\+/, '');
    const colon = ref.indexOf(':');

    return colon === -1 ? ref : ref.slice(colon + 1);
}

// Source side of a refspec; '' for a deletion refspec like ':main'.
function refSource(token)
{
    const ref = unquote(token).replace(/^\+/, '');
    const colon = ref.indexOf(':');

    return colon === -1 ? ref : ref.slice(0, colon);
}

// A "bare" push has no explicit refspec - at most the remote (e.g. `git push`,
// `git push origin`, `git push --force`). Such a push targets the current branch.
function isBarePush(tokensAfterPush)
{
    const refs = tokensAfterPush.filter(t => !t.startsWith('-'));

    return refs.length <= 1; // 0 = `git push`, 1 = the remote name only
}

function currentBranch(cwd)
{
    try
    {
        // git's stderr stays out of the hook's: on an unborn repo it printed `fatal: ambiguous argument 'HEAD'` (audit 2026-10-08).
        return execFileSync(...gitSafe(['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    }
    catch
    {
        return null; // not a repo / detached / git missing -> caller fails open
    }
}

// The remote's DEFAULT branch is protected too (audit 2026-10-20, the hooks track's minor list: a repository whose
// default is `trunk` or `production` had it force-pushed unguarded). Read from the remote-tracking HEAD git keeps
// (`refs/remotes/<remote>/HEAD`, set by clone or `git remote set-head`), no network; asked only of a force or a delete.
function remoteDefault(cwd, remote)
{
    try
    {
        const ref = execFileSync(...gitSafe(['-C', cwd, 'symbolic-ref', '--quiet', `refs/remotes/${remote || 'origin'}/HEAD`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
        const m = /^refs\/remotes\/[^/]+\/(.+)$/.exec(ref);
        return m ? m[1] : null;
    }
    catch
    {
        return null;
    }
}

// The push's words with each option's VALUE dropped: `-o ci.skip` read `ci.skip` as a refspec, so `git push -f -o
// ci.skip origin` on main was no bare push and passed (audit 2026-10-08). A value attached with `=` is one word already.
const VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
function pushWords(argv)
{
    const out = [];
    for (let i = 0; i < argv.length; i++)
    {
        if (VALUE_OPTIONS.has(argv[i]))
        {
            i++;
            continue;
        }
        out.push(argv[i]);
    }

    return out;
}

// ---- the branch HEAD names when the push runs (audit 2026-10-30 HK-12) ----------------------------------------------
// HEAD was read before the command ran, so on `feature` a `git switch main && git push --force` (or `git checkout main;
// git push -f origin HEAD`) named the feature branch and passed. Each `git switch` / `git checkout` that runs before the
// push in the same checkout moves it: the push names the last branch switched to. A path checkout moves nothing (`git
// checkout main -- a.txt`, `git checkout main a.txt`), nor does a word naming no branch, local or remote-tracking
// (`git checkout src/x.ts`) - a protected name is taken as the branch without asking git.
const SWITCH_NEW = /^(?:-[cCbB]|--create|--force-create|--orphan)$/;
function switchTarget(call)
{
    const a = call.argv;
    const before = [];
    const after = [];
    let dashes = false;
    let track = false;
    for (let i = 0; i < a.length; i++)
    {
        const w = a[i];
        if (dashes)
        {
            after.push(w);
            continue;
        }
        if (w === '--')
        {
            dashes = true;
            continue;
        }
        if (SWITCH_NEW.test(w))
        {
            return a[i + 1] !== undefined ? { branch: a[i + 1] } : null;
        }
        const attached = /^(?:-[cCbB](.+)|--(?:create|force-create|orphan)=(.+))$/.exec(w);
        if (attached)
        {
            return { branch: attached[1] || attached[2] };
        }
        if (w === '--detach' || (call.sub === 'switch' && w === '-d'))
        {
            return { detached: true };
        }
        if (w === '-t' || w === '--track' || w.startsWith('--track='))
        {
            track = true;
            continue;
        }
        if (w !== '-' && w.startsWith('-'))
        {
            continue;
        }
        before.push(w);
    }
    if (call.sub === 'switch')
    {
        return before[0] === '-' ? { prev: true } : before.length ? { branch: before[0] } : null;
    }
    // checkout: paths after `--`, or a tree-ish and paths, restore files and switch nothing
    if (after.length || before.length !== 1)
    {
        return null;
    }
    if (before[0] === '-')
    {
        return { prev: true };
    }
    // `git checkout -t origin/main` creates and switches to the local `main`
    return track && before[0].includes('/') ? { branch: before[0].replace(/^[^/]+\//, '') } : { branch: before[0], verify: true };
}

// A word git would check out as a branch: a local one, or a remote-tracking one it would create the local branch from.
// A git that cannot answer reads as no branch, so the push keeps the branch it had - the stricter reading.
function namesBranch(cwd, name)
{
    try
    {
        return execFileSync(...gitSafe(['-C', cwd, 'for-each-ref', '--count=1', '--format=%(refname)', `refs/heads/${name}`, `refs/remotes/*/${name}`],
            { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).trim() !== '';
    }
    catch
    {
        return false;
    }
}

function previousBranch(cwd)
{
    try
    {
        return execFileSync(...gitSafe(['-C', cwd, 'rev-parse', '--abbrev-ref', '@{-1}'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).trim() || null;
    }
    catch
    {
        return null;
    }
}

// One HEAD per checkout: the nearest folder holding `.git` (a linked worktree's `.git` file is its own checkout).
function checkoutOf(dir)
{
    const path = require('path');
    let d = dir;
    for (let i = 0; i < 64; i++)
    {
        if (fs.existsSync(path.join(d, '.git')))
        {
            return d;
        }
        const up = path.dirname(d);
        if (up === d)
        {
            break;
        }
        d = up;
    }

    return dir;
}

// The branch HEAD names when `push` runs in `dir`: every switch before it in that checkout replayed in run order.
function headAt(read, push, dir)
{
    const key = checkoutOf(dir);
    let cur = { kind: 'current' };
    let prev = { kind: 'previous' };
    for (const c of read.calls)
    {
        if ((c.sub !== 'switch' && c.sub !== 'checkout') || read.orderOf(c.at, push.at) >= 0)
        {
            continue;
        }
        const cDir = read.callDir(c);
        if (checkoutOf(cDir) !== key)
        {
            continue;
        }
        const t = switchTarget(c);
        if (!t)
        {
            continue;
        }
        if (t.prev)
        {
            [cur, prev] = [prev, cur];
            continue;
        }
        if (t.verify && !PROTECTED.includes(t.branch) && !namesBranch(cDir, t.branch))
        {
            continue; // a path or a commit, not a branch
        }
        prev = cur;
        cur = t.detached ? { kind: 'detached' } : { kind: 'branch', name: t.branch };
    }
    if (cur.kind === 'current')
    {
        return currentBranch(dir);
    }
    if (cur.kind === 'previous')
    {
        return previousBranch(dir);
    }

    return cur.kind === 'branch' ? cur.name : null;
}

// ---- refspecs from config (audit 2026-10-30 HK-15) --------------------------------------------------------------
// A push with no refspec takes `remote.<name>.push` (and `remote.<name>.mirror`) from config, so `git -c
// remote.origin.push=+HEAD:main push` and `git config remote.origin.push +HEAD:refs/heads/main && git push` forced main
// and passed. Read: the push's own `-c`, and a `git config` that sets one earlier in the same command. The config
// already on disk is not read (no git spawned per push) - a stated ceiling.
const CONFIG_VALUE_OPTIONS = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--value']);
const CONFIG_READ_FLAGS = /^(?:--get|--get-all|--get-regexp|--get-urlmatch|--get-color|--get-colorbool|--unset|--unset-all|-l|--list|--remove-section|--rename-section|-e|--edit)$/;
const CONFIG_READ_SUBS = new Set(['get', 'list', 'unset', 'remove-section', 'rename-section', 'edit', 'rename', 'remove']);
function configSet(argv)
{
    const pos = [];
    for (let i = 0; i < argv.length; i++)
    {
        const w = argv[i];
        if (CONFIG_VALUE_OPTIONS.has(w))
        {
            i++;
            continue;
        }
        if (CONFIG_READ_FLAGS.test(w))
        {
            return null;
        }
        if (w.startsWith('-'))
        {
            continue;
        }
        pos.push(w);
    }
    if (CONFIG_READ_SUBS.has(pos[0]))
    {
        return null;
    }
    if (pos[0] === 'set')
    {
        pos.shift();
    }

    return pos.length >= 2 ? `${pos[0]}=${pos[1]}` : null;
}
function configuredFor(read, push)
{
    const out = [];
    const take = (kv) =>
    {
        const m = /^remote\.(.+)\.(push|mirror)=([\s\S]*)$/i.exec(kv || '');
        if (m)
        {
            out.push({ remote: m[1], key: m[2].toLowerCase(), value: m[3].trim() });
        }
    };
    for (const c of read.calls)
    {
        if (c.sub === 'config' && read.orderOf(c.at, push.at) < 0)
        {
            take(configSet(c.argv));
        }
    }
    for (const kv of push.config)
    {
        take(kv);
    }

    return out;
}

// ---- the same act through gh (audit 2026-10-30 HK-15) -----------------------------------------------------------
// `gh api -X PATCH repos/o/r/git/refs/heads/main -F force=true` force-moves the branch on the server, `-X DELETE` on it
// deletes it, and `gh repo sync --force` hard-resets a branch (the default one when no `--branch` is given).
const GH_API_VALUE = new Set(['-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);
function ghApiForce(argv)
{
    let method = '';
    let endpoint = null;
    const fields = [];
    for (let i = 0; i < argv.length; i++)
    {
        const w = argv[i];
        let m;
        if (w === '-X' || w === '--method')
        {
            method = argv[++i] || '';
            continue;
        }
        if ((m = /^(?:-X|--method=)(.+)$/.exec(w)))
        {
            method = m[1];
            continue;
        }
        if (w === '-F' || w === '-f' || w === '--field' || w === '--raw-field')
        {
            fields.push(argv[++i] || '');
            continue;
        }
        if ((m = /^(?:-[Ff]|--field=|--raw-field=)(.+)$/.exec(w)))
        {
            fields.push(m[1]);
            continue;
        }
        if (GH_API_VALUE.has(w))
        {
            i++;
            continue;
        }
        if (w.startsWith('-'))
        {
            continue;
        }
        if (endpoint === null)
        {
            endpoint = w;
        }
    }
    const ref = endpoint && /(?:^|\/)repos\/[^/]+\/[^/]+\/git\/refs\/heads\/([^?]+?)\/?(?:\?.*)?$/.exec(endpoint);
    let branch = ref ? ref[1] : '';
    try
    {
        branch = decodeURIComponent(branch);
    }
    catch { /* a malformed escape is read as written */ }
    if (!PROTECTED.includes(branch))
    {
        return false;
    }
    const verb = method.toUpperCase();

    return verb === 'DELETE' || (verb === 'PATCH' && fields.some(f => /^force=true$/i.test(f)));
}
function ghRepoSyncForce(argv)
{
    let force = false;
    let branch = null;
    for (let i = 0; i < argv.length; i++)
    {
        const w = argv[i];
        let m;
        if (w === '--force')
        {
            force = true;
        }
        else if (w === '-b' || w === '--branch')
        {
            branch = argv[++i] || '';
        }
        else if ((m = /^(?:--branch=|-b)(.+)$/.exec(w)))
        {
            branch = m[1];
        }
        else if (w === '-s' || w === '--source')
        {
            i++;
        }
    }

    return force && (branch === null || PROTECTED.includes(branch));
}
function ghForce(read)
{
    for (const c of shellWrites.commandWords(null, read.parsed))
    {
        if (!/^gh(?:\.exe)?$/i.test(c.name))
        {
            continue;
        }
        if (c.argv[0] === 'api' && ghApiForce(c.argv.slice(1)))
        {
            return 'gh-api';
        }
        if (c.argv[0] === 'repo' && c.argv[1] === 'sync' && ghRepoSyncForce(c.argv.slice(2)))
        {
            return 'gh-repo-sync';
        }
    }

    return null;
}

// Block a push that would force-update, delete, or mirror a protected branch. Returns the route that fired (the block
// row's branch), or null.
function isProtectedForcePush(command, cwd)
{
    const read = shellWrites.gitText(command, cwd);
    const viaGh = read.parsed ? ghForce(read) : null;
    if (viaGh)
    {
        return viaGh;
    }
    for (const call of read.calls)
    {
        const sendPack = call.sub === 'send-pack';
        if (call.sub !== 'push' && !sendPack)
        {
            continue;
        }
        const after = pushWords(call.argv);
        const gitCwd = read.callDir(call);
        // HEAD and @ name the branch checked out where git runs when the push runs - `git push -f origin HEAD` on main
        // is the bare force spelled out, and read literally it named no protected branch and passed.
        let head;
        const branchOf = (ref) => (ref === 'HEAD' || ref === '@' ? (head === undefined ? (head = headAt(read, call, gitCwd)) : head) : ref);
        // The first non-option word names the remote; the default branch is read once per call, and only when asked.
        const remoteGiven = after.find(t => !t.startsWith('-'));
        const remote = remoteGiven || 'origin';
        let dflt;
        const isProtected = (name, risky) => PROTECTED.includes(name)
            || (risky && !!name && name === (dflt === undefined ? (dflt = remoteDefault(gitCwd, unquote(remote))) : dflt));

        // FORCE_FLAG catches -f / --force / --force-with-lease / --force-if-includes as whole tokens;
        // also catch clustered short flags (-fu, -uf, -fv): single-dash token containing f.
        const hasForceFlag = after.some(t => FORCE_FLAG.test(t))
            || after.some(t => /^-[A-Za-z]*f[A-Za-z]*$/.test(t) && !t.startsWith('--'));
        // ... and -d inside a cluster (`-ud origin main` deleted main - audit 2026-10-08).
        const hasDeleteFlag = after.includes('--delete') || after.some(t => /^-[A-Za-z]*d[A-Za-z]*$/.test(t) && !t.startsWith('--'));

        // --mirror / --mirror=<value> (and a forced --all) rewrite/prune every remote ref,
        // protected ones included, without naming them - always catastrophic on a shared remote.
        if (after.some(t => t === '--mirror' || t.startsWith('--mirror='))
            || (after.includes('--all') && hasForceFlag))
        {
            return 'mirror-or-all';
        }
        // a forced send-pack naming no ref updates every head both sides hold - main among them
        if (sendPack && hasForceFlag && isBarePush(after))
        {
            return 'send-pack';
        }

        // A wildcard destination (`'refs/heads/*:refs/heads/*'`) names every branch, protected ones included: forced, or
        // under --prune (which deletes every remote branch the source side lacks), it is the --all case spelled as a
        // refspec, and it passed (audit 2026-10-08).
        const prune = after.some(t => t === '--prune');
        const wildRisky = (t) => refDestination(t).includes('*') && (unquote(t).startsWith('+') || hasForceFlag || prune);
        if (after.some(t => !t.startsWith('-') && wildRisky(t)))
        {
            return 'wildcard';
        }

        // A push naming no refspec takes the remote's configured one: set by this call's `-c` or an earlier `git config`.
        if (!sendPack)
        {
            const conf = configuredFor(read, call).filter(e => !remoteGiven || e.remote === unquote(remoteGiven));
            if (conf.some(e => e.key === 'mirror' && /^(?:true|yes|on|1)$/i.test(e.value)))
            {
                return 'config-refspec';
            }
            if (isBarePush(after))
            {
                for (const e of conf)
                {
                    if (e.key !== 'push' || !e.value)
                    {
                        continue;
                    }
                    const forced = e.value.startsWith('+') || hasForceFlag || hasDeleteFlag || refSource(e.value) === '';
                    if (wildRisky(e.value) || (forced && isProtected(branchOf(normalizeBranch(refDestination(e.value))), true)))
                    {
                        return 'config-refspec';
                    }
                }
            }
        }

        // Explicit refspec whose destination is a protected branch, when the op is a
        // force ('+' prefix or a force flag) or a delete (--delete/-d, or ':dst').
        // Unquote first so a quoted token - `"main"` or `"+main"` - is read correctly.
        const risky = (t) => unquote(t).startsWith('+') || hasForceFlag || hasDeleteFlag || refSource(t) === '';
        const targets = after.filter(t => !t.startsWith('-') && isProtected(branchOf(normalizeBranch(refDestination(t))), t !== remote && risky(t)));
        for (const t of targets)
        {
            const u = unquote(t);
            if (u.startsWith('+') || hasForceFlag || hasDeleteFlag || refSource(t) === '')
            {
                return 'refspec';
            }
        }

        // Bare push targets HEAD's branch - block a force or delete of a protected one. The flags are read first, so an
        // ordinary push spawns no git.
        if ((hasForceFlag || hasDeleteFlag) && isBarePush(after) && isProtected(branchOf('HEAD'), true))
        {
            return 'bare';
        }
    }

    return null;
}

function main()
{
    let payload;
    try
    {
        payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    }
    catch
    {
        process.exit(0); // can't parse hook input -> don't block on a harness malfunction
    }
    if (!payload || typeof payload !== 'object')
    {
        process.exit(0); // a JSON scalar/null - nothing to judge
    }

    // --- block telemetry (shared by every guard hook; keep the copies identical) ------------
    // A block costs a whole turn - the stderr goes back to the model and the work is re-done - so a
    // FALSE positive is 10-100x the cost of the gate itself, and until this existed the block rate was
    // the one number the stack could not measure (measured 2026-09-04: the hooks emit ~22-25ms and
    // nothing else). One JSONL row per block, written where the tool-usage instrument writes, so
    // scripts/analyze-usage.js can tally both from the same docs root. Best-effort in every direction:
    // telemetry never changes the verdict and never throws.
    (() => {
        let last = '';
        const w = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk, ...rest) => { last = String(chunk); return w(chunk, ...rest); };
        const exit = process.exit.bind(process);
        process.exit = (code) =>
        {
            if (code === 2 && !unsetRepo)
            {
                try
                {
                    const path = require('path');
                    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
                    // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = (() => { try { return require('./layout.js').statsPath(root, ['hook-blocks']); } catch { return path.resolve(root, docsRootEnv(), 'hook-blocks'); } })();
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
                        // WHO was blocked and on which call: a seat's block is its own row (audit 2026-10-10 C07, 0498718d - seat
                        // blocks read as the main session's), and the call id joins the row to the transcript without a clock.
                        agent: payload.agent_id || null,
                        tool_use_id: payload.tool_use_id || null,
                        reason: last.split('\n')[0].slice(0, 200),
          // A hook may name the BRANCH that fired and what matched, when it has more than one
          // (`global.BLOCK_DETAIL`, dropped by JSON.stringify when nothing set it). A block whose
          // cause cannot be reconstructed cannot be tuned - this is the field that reconstructs it.
          detail: global.BLOCK_DETAIL || undefined,
                    }) + '\n');
                }
                catch { /* telemetry is never allowed to break the gate */ }
            }
            exit(code);
        };
    })();

    const command = String(payload?.tool_input?.command ?? '');
    const cwd = payload?.cwd ?? process.cwd();
    const route = isProtectedForcePush(command, cwd);
    if (!route)
    {
        process.exit(0);
    }
    global.BLOCK_DETAIL = { branch: route };

    process.stderr.write(
        'Blocked: rewriting or deleting a shared branch (main/master/develop, or the remote\'s default branch) is forbidden - a house rule enforced here, no prose copy to consult - ' +
        'no force-push, branch deletion, or --mirror. Push to a feature branch and open a PR; ' +
        'use --force-with-lease only on your own feature branch. If the user wants this push, it is theirs to run: ' +
        'give them the exact command to type themselves (a `!` prefix runs it in this session), never a way around this guard.\n');
    process.exit(2);
}

main();
