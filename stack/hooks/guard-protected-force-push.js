#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate: block a force-push or deletion of a protected branch (main / master /
// develop). It is a deterministic, catastrophic, irreversible event - so it is enforced by a
// hook with no prose copy to consult (alfred-git.md only prefers --force-with-lease), never left to
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
//     protected branch.
// A plain fast-forward push to main, or any force on a feature branch (prefer
// --force-with-lease), is left alone - blocking it would be a false-positive.
// Out of model (an honest mistake never writes these): a command word or refspec a substitution computes
// (`bash -c "$(echo ...)"`, `source <(...)`), a push over ssh or inside `docker exec`, and text past the scan budget.
'use strict';
const fs = require('fs');
// The docs root env value, ALFRED_CODE_DOCS_PATH (hook-prelude.js envOf).
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.alfred/docs';
const { execFileSync } = require('child_process');

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
        return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
    catch
    {
        return null; // not a repo / detached / git missing -> caller fails open
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

// Block a push that would force-update, delete, or mirror a protected branch.
function isProtectedForcePush(command, cwd)
{
    const read = shellWrites.gitText(command, cwd);
    for (const call of read.calls)
    {
        if (call.sub !== 'push')
        {
            continue;
        }
        const after = pushWords(call.argv);
        const gitCwd = read.callDir(call);
        // HEAD and @ name the branch checked out where git runs - `git push -f origin HEAD` on main is
        // the bare force spelled out, and read literally it named no protected branch and passed.
        let head;
        const branchOf = (ref) => (ref === 'HEAD' || ref === '@' ? (head === undefined ? (head = currentBranch(gitCwd)) : head) : ref);

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
            return true;
        }

        // A wildcard destination (`'refs/heads/*:refs/heads/*'`) names every branch, protected ones included: forced, or
        // under --prune (which deletes every remote branch the source side lacks), it is the --all case spelled as a
        // refspec, and it passed (audit 2026-10-08).
        const prune = after.some(t => t === '--prune');
        if (after.some(t => !t.startsWith('-') && refDestination(t).includes('*') && (unquote(t).startsWith('+') || hasForceFlag || prune)))
        {
            return true;
        }

        // Explicit refspec whose destination is a protected branch, when the op is a
        // force ('+' prefix or a force flag) or a delete (--delete/-d, or ':dst').
        // Unquote first so a quoted token - `"main"` or `"+main"` - is read correctly.
        const targets = after.filter(t => !t.startsWith('-') && PROTECTED.includes(branchOf(normalizeBranch(refDestination(t)))));
        for (const t of targets)
        {
            const u = unquote(t);
            if (u.startsWith('+') || hasForceFlag || hasDeleteFlag || refSource(t) === '')
            {
                return true;
            }
        }

        // Bare push targets HEAD's branch - block a force or delete of a protected one. The flags are read first, so an
        // ordinary push spawns no git.
        if ((hasForceFlag || hasDeleteFlag) && isBarePush(after) && PROTECTED.includes(branchOf('HEAD')))
        {
            return true;
        }
    }

    return false;
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
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                        ts: new Date().toISOString(),
                        hook: path.basename(__filename),
                        event: payload.hook_event_name || payload.tool_name || '',
                        tool: payload.tool_name || '',
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
    if (!isProtectedForcePush(command, cwd))
    {
        process.exit(0);
    }

    process.stderr.write(
        'Blocked: rewriting or deleting a shared branch (main/master/develop) is forbidden - a house rule enforced here, no prose copy to consult - ' +
        'no force-push, branch deletion, or --mirror. Push to a feature branch and open a PR; ' +
        'use --force-with-lease only on your own feature branch.\n');
    process.exit(2);
}

main();
