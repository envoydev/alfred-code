#!/usr/bin/env node
// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// PreToolUse gate: block a recursive `rm` of a catastrophic, unrecoverable target.
// The filesystem has no reflog, so this is the rm analog of the protected-branch
// force-push guard (guard-protected-force-push.js) - a deterministic, catastrophic,
// irreversible event enforced by a hook, not left to prose. Reads the tool-call
// JSON on stdin; exit 2 blocks (stderr fed back to the model), exit 0 allows.
//
// Scope is deliberately narrow - it fires ~never in normal work. A recursive rm
// (-r / -R / --recursive, with or without -f) is blocked when a target is:
//   - the filesystem root:   /   /.   or   /*
//   - the home directory:    ~   ~/   ~/*   $HOME   ${HOME}   $HOME/*   (quoted too,
//     including a quoted prefix with the glob outside: "$HOME"/* )
//   - the current dir itself:  *   ./*   .   ./   $PWD   ${PWD}   $PWD/*   (`rm -rf .`
//     / `rm -rf $PWD` wipes the cwd's contents)
//   - the parent dir:  ..   ../   ../*   (wipes the cwd and every sibling beside it - the same
//     unrecoverable class as '.', and `./..` was already caught while a bare `..` walked past)
// '..' and '.' segments are collapsed first, so a path that resolves to root (`/home/../`)
// or to the cwd (`./.`, `././`) is caught despite the literal text never being `/` or `.`. A recursive rm is
// also blocked when it names MULTIPLE single-segment absolute paths (`/usr /lib /etc
// /var`) - the multi-arg system wipe each dir dodges individually.
// An ordinary `rm -rf bin obj node_modules .playwright` is left alone - blocking it
// would be a false positive. Non-recursive rm, and rm of any single specific path, pass.
// Out of scope (same honesty as the force-push guard): indirection that deletes
// without a literal recursive `rm` of one of these targets - `find ... -delete`,
// `xargs rm`, `eval`, a subshell, or rm via a wrapper script - is NOT caught here;
// this guard reads the literal command's flat tokens.
'use strict';
const fs = require('fs');
const path = require('path');

// STACK HOOK GATES - they live in hook-prelude.js, whose header lists them, never inlined in every
// hook. Fail-open on purpose - no prelude, no project dir or a malformed settings file all leave
// this hook running.
let envOf = (env, suffix) => env[`ALFRED_CODE_${suffix}`];
if (require.main === module) {
  try {
    const prelude = require('./hook-prelude.js');
    envOf = prelude.envOf;
    if (prelude.standDown('guard-catastrophic-rm')) process.exit(0);
  } catch { /* an install without the prelude runs the hook unchanged */ }
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a
// project whose settings.json has not been migrated yet keeps resolving.
const docsRootEnv = () => envOf(process.env, 'DOCS_PATH') || '.claude/docs';

// A heredoc body is DATA, not shell: a plan or checklist that merely DESCRIBES this command is
// inert text, and matching it blocked a document write for its own prose (reproduced). Blank the
// payload spans, keeping the character count so any index into the command still holds.
const stripHeredocs = (c) => String(c).replace(
  /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
  (m) => m.replace(/[^\n]/g, ' '),
);

// Split a compound command (`a && rm -rf / ; b`) into segments so each `rm` is
// inspected on its own. Best-effort: subshell/expansion forms fall through to allow.
const SEPARATORS = /[;|&]{1,2}|\n/;

// A recursive flag: --recursive, or a combined short cluster containing r/R
// (-r, -R, -rf, -fr, -Rf, -rfv). --force alone never recurses, so it does not count.
function hasRecursive(args)
{
    return args.some(t => t === '--recursive' || (/^-[A-Za-z]+$/.test(t) && /[rR]/.test(t)));
}

// Strip one layer of surrounding quotes.
function unquote(tok)
{
    const t = tok.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))))
    {
        return t.slice(1, -1);
    }

    return t;
}

// Clean a token down to its comparable path: strip ALL quote characters - not just a
// fully-wrapping pair - so a quoted prefix with the glob outside the quotes (`"$HOME"/*`)
// collapses to the same '$HOME/*' as the unquoted form. Then collapse any '..' segments
// (literal-string matching would let '/home/../' and '/usr/../' resolve away to '/' at run
// time yet read as non-catastrophic here) and drop a trailing slash ('~/' -> '~'). $HOME
// stays literal because the string is unexpanded.
function cleanTarget(tok)
{
    let t = unquote(tok).replace(/['"]/g, '');
    const absolute = t.startsWith('/');
    const trailingGlob = /\/\*$/.test(t);
    // Collapse '..' against earlier segments; '/home/..' -> '', './a/..' -> '.', 'a/../..' -> '..'.
    const out = [];
    for (const seg of t.split('/'))
    {
        if (seg === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '')
        {
            out.pop();
        }
        else
        {
            out.push(seg);
        }
    }
    t = out.join('/');
    // A collapse that emptied an absolute path leaves bare '/' (or '/*' if it ended in a glob).
    if (absolute && (t === '' || t === '/'))
    {
        t = trailingGlob ? '/*' : '/';
    }

    return t.replace(/\/+$/, '') || (absolute ? '/' : t);
}

// Catastrophic, unrecoverable single targets: root, home, or a bare whole-dir glob.
function isCatastrophic(tok)
{
    // Drop '.' path segments (a no-op in a path) so './.', '././', and './*' read the
    // same as the bare cwd targets, then compare against the unrecoverable literals.
    const cleaned = (cleanTarget(tok) || '/').split('/').filter(s => s !== '.').join('/');
    const t = cleaned === '' ? '.' : cleaned;

    return t === '/' || t === '/*' || t === '/.'
        || t === '~' || t === '~/*'
        || t === '$HOME' || t === '${HOME}' || t === '$HOME/*' || t === '${HOME}/*'
        || t === '$PWD' || t === '${PWD}' || t === '$PWD/*' || t === '${PWD}/*'
        || t === '*' || t === './*' || t === '.' || t === '..' || t === '../*';
}

// A single-segment absolute path ('/usr', '/etc', '/var') - non-catastrophic alone, but
// a recursive rm naming TWO OR MORE of them is a system wipe each arg dodges individually.
function isTopLevelDir(tok)
{
    return /^\/[^/]+$/.test(cleanTarget(tok));
}

// True if any segment is a recursive rm naming a catastrophic target, or naming
// several top-level system dirs at once.
function isCatastrophicRm(command)
{
    for (const seg of command.split(SEPARATORS))
    {
        const tokens = seg.trim().split(/\s+/).filter(Boolean);
        // Skip leading env-assignments and benign prefixes so `rm` must be the segment's COMMAND,
        // not an argument to another program (no false positive on `echo rm -rf /` or a commit msg).
        let i = 0;
        while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])
            || tokens[i] === 'sudo' || tokens[i] === 'command' || tokens[i] === 'nice' || tokens[i] === 'time'))
        {
            i++;
        }

        const cmd = tokens[i];
        if (!cmd || !(cmd === 'rm' || cmd.endsWith('/rm')))
        {
            continue;
        }

        const args = tokens.slice(i + 1);
        if (!hasRecursive(args))
        {
            continue;
        }

        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.some(isCatastrophic) || paths.filter(isTopLevelDir).length >= 2)
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
            if (code === 2)
            {
                try
                {
                    // `path` is required at module scope above.
                    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
                    // resolve, NOT join: an ABSOLUTE ALFRED_CODE_DOCS_PATH makes path.join('/a/b','/x/y')
        // '/a/b/x/y', so every ledger row landed in a doubled path that nothing reads (measured
        // across all ten guards). resolve honours an absolute value and still joins a relative one.
        const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
                    fs.mkdirSync(dir, { recursive: true });
                    fs.appendFileSync(path.join(dir, `${payload.session_id || 'nosession'}.jsonl`), JSON.stringify({
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

    const command = stripHeredocs(payload?.tool_input?.command ?? '');

    // Git destroys uncommitted work with no undo, and this guard had ZERO git coverage: 225 lines
    // with no occurrence of `git`, so a destructive `git checkout --` replayed exit 0 against every
    // guard in the stack. These four verbs are the same class as a recursive rm - the working tree
    // is the only copy - and unlike a commit there is no reflog entry to recover from.
    // Gated on ACTUAL loss: a clean tree has nothing to destroy, so the command passes. That is the
    // same arithmetic the commit gate's trivial-diff exemption uses, and it keeps the guard silent
    // in the overwhelmingly common case of resetting an already-clean checkout.
    const destructiveGit = /(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]\s*\S+|\s+--\S+)*\s+(?:checkout\s+(?:--\s|\.(?:\s|$))|restore\s+(?!(?:--staged|--source)\b)|reset\s+--hard\b|clean\s+-\S*[fx])/;
    // A QUOTED span is data, exactly as it is in the commit guard: an echo, a plan sentence or a
    // grep pattern that merely CONTAINS `git reset --hard` invokes nothing, and denying it teaches
    // the obfuscation that then defeats this gate on a real one. The fill is a NON-space so the
    // span stays one opaque argument token and the offsets survive.
    const gitScan = command
        .replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, 'x'))
        .replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, 'x'));
    if (destructiveGit.test(gitScan))
    {
        const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

        // The PATHSPEC the command actually names. The gate used to ask only 'is the tree dirty',
        // which made its own prescribed escape - 'name the ONE file to revert instead of the whole
        // tree' - unreachable: `git restore .gitignore` was denied with all seven dirty files
        // listed, six of which the command never touched (measured live, twice in one session).
        // `reset --hard` and `checkout .` / `checkout --` with no path are whole-tree by nature and
        // keep the old arithmetic; anything that names paths is judged on THOSE paths only.
        const pathspec = (() => {
            const m = command.match(/git(?:\s+-[cC]\s*\S+|\s+--\S+)*\s+(checkout|restore|reset|clean)\b([^\n;&|]*)/);
            if (!m) return [];
            const verb = m[1];
            if (verb === 'reset') return [];                       // takes a commit, never a pathspec
            let rest = m[2] || '';
            rest = rest.replace(/^\s*--\s/, ' ');                  // the `--` separator itself
            const args = (rest.match(/"[^"]*"|'[^']*'|\S+/g) || [])
                .map((a) => a.replace(/^["']|["']$/g, ''))
                .filter((a) => a && !a.startsWith('-') && a !== '--');
            // `.` is the whole tree spelled as a path, and an unexpanded variable is unknowable -
            // both fall back to the whole-tree check rather than a guess.
            if (!args.length || args.some((a) => a === '.' || /\$\{?[A-Za-z_]/.test(a))) return [];
            return args;
        })();

        let dirty = '';
        try
        {
            // argv, never a shell string: the pathspec used to be single-quoted into an execSync
            // line, and on win32 that line runs through cmd.exe, where a single quote is a literal
            // character - git was asked about a file named 'seed.txt' with the quotes, found it
            // clean, and `git restore <dirty file>` passed on every Windows install (measured: the
            // release CI's windows job, both pathspec tests, 0 where 2 was expected).
            const { execFileSync } = require('child_process');
            // stdio: git's own stderr is CAPTURED, not inherited. Left inherited, a non-repo path
            // printed `fatal: not a git repository` to the user on a call this gate then PASSED -
            // noise that reads as a hook failure on a clean pass.
            dirty = execFileSync('git', ['status', '--porcelain', ...(pathspec.length ? ['--', ...pathspec] : [])],
                { cwd: root, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        }
        catch { dirty = ''; } // not a git repo / git unavailable - never block on our own failure

        // The user's own 'discard it' for THIS session. Every other blocking guard in the stack
        // honours an answer; this one had none, so it re-blocked a discard the user had just
        // chosen through AskUserQuestion, and the chosen action was silently substituted with a
        // `git stash push -u` (measured: answer at 06:54:14, block at 06:54:22, 142,674 cache-read
        // on the retried turn). Same shape as CROSS-WRITE-ALLOW: one path per line or `*` for the
        // whole tree, this session's own, under 8h.
        const allowed = (() => {
            if (!dirty) return false;
            try
            {
                const receipt = path.resolve(root, docsRootEnv(), 'flow', 'DISCARD-ALLOW');
                const st = fs.statSync(receipt);
                let sessionStartMs = 0;
                try
                {
                    const tr = fs.statSync(String(payload.transcript_path || ''));
                    sessionStartMs = tr.birthtimeMs && tr.birthtimeMs !== tr.ctimeMs ? tr.birthtimeMs : 0;
                }
                catch { sessionStartMs = 0; }
                if (Date.now() - st.mtimeMs > 8 * 60 * 60 * 1000 || (sessionStartMs && st.mtimeMs < sessionStartMs)) return false;
                const lines = fs.readFileSync(receipt, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
                if (lines.includes('*')) return true;
                const targets = pathspec.length ? pathspec : dirty.split('\n').map((r) => r.slice(3).trim());
                return targets.length > 0 && targets.every((f) => lines.some((l) => l === f || f.startsWith(`${l}/`)));
            }
            catch { return false; } // absent or unreadable - no allowance recorded
        })();

        if (dirty && !allowed)
        {
            const rows = dirty.split('\n');
            const scope = pathspec.length ? `the path(s) this command names` : `the working tree`;
            const receiptRel = path.join(docsRootEnv().replace(/^\//, ''), 'flow', 'DISCARD-ALLOW');
            process.stderr.write(
                `Blocked: this discards uncommitted work in ${rows.length} file(s) under ${scope}, and there is\n` +
                `no reflog for a working tree - once it is gone it is gone. A house rule enforced here, no prose\n` +
                `copy to consult - same class as the recursive-rm gate in this file.\n` +
                rows.slice(0, 10).map((r) => `  ${r}`).join('\n') +
                (rows.length > 10 ? `\n  ... and ${rows.length - 10} more` : '') +
                `\n\nDo not decide for the user: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
                `  'Keep the work (Recommended)' - \`git stash -u\`, or commit it\n` +
                `  'Discard it' - the loss is intended and the user says so\n` +
                `  'Narrow it' - name the ONE file to revert instead of the whole tree\n` +
                `On 'Discard it', write the receipt ${receiptRel} - one path per line exactly as the\n` +
                `command spells them, or \`*\` for everything - then retry the SAME command. It is honoured\n` +
                `for this session only, under 8h. A clean path passes this gate untouched.`,
            );
            process.exit(2);
        }
    }

    if (!isCatastrophicRm(command))
    {
        process.exit(0);
    }

    process.stderr.write(
        'Refusing a recursive rm of a catastrophic, unrecoverable target (/, ~, $HOME, the cwd or its ' +
        'parent, a bare *, or several top-level system dirs at once) - the filesystem has no reflog. A house ' +
        'rule enforced here, no prose copy to consult. ' +
        'Delete a specific subdirectory by name instead.\n');
    process.exit(2);
}

main();
