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
// The PowerShell spellings count the same (Remove-Item / ri / del / erase / rd / rmdir with -Recurse),
// and so do the Windows roots: a drive (C:\, C:/), its Git Bash / Cygwin / WSL mounts (/c, /cygdrive/c,
// /mnt/c) and $env:USERPROFILE / $env:HOME.
// Out of scope (same honesty as the force-push guard): indirection that deletes
// without a literal recursive `rm` of one of these targets - `find ... -delete`,
// `xargs rm`, `eval`, a subshell, or rm via a wrapper script - is NOT caught here;
// this guard reads the literal command's flat tokens.
// The git half (main() below) reads EVERY git call in the command from its argv - flags anywhere, a
// tree-ish before the paths - and judges each by what it would destroy: the dirty paths a discard
// names, what `clean -n` of the same flags lists (ignored files included), a stash entry, the reflog
// entries or unreachable objects a dry run would prune. One block names every loss. Ceilings: under a
// dated `gc --prune` a PACKED unreachable object is counted whatever its age (its age sits in the
// pack, not read here), and a git probe past its 5s timeout fails open like every hook here.
'use strict';
const fs = require('fs');
const path = require('path');

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
    off = prelude.standDown('guard-catastrophic-rm');
    unsetRepo = prelude.neverSetUp();
  } catch { /* an install without the prelude runs the hook unchanged */ }
  // Outside the try: the shell-guard dispatcher runs this file in-process, where that catch would swallow the exit.
  if (off) process.exit(0);
}
// The docs root env value. ALFRED_CODE_DOCS_PATH is the name; envOf (hook-prelude.js) also answers
// CLAUDE_STACK_DOCS_PATH (the pre-2.0.0 spelling) and, last, CLAUDE_DOCS_PATH (pre-0.2.43) - so a // legacy-name
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

// A recursive flag: --recursive, a short cluster of rm's own letters containing r/R (-r, -R, -rf,
// -fr, -Rf, -rfv), or PowerShell's -Recurse and its prefixes. --force alone never recurses - and
// PowerShell's -Force is one word, not a cluster: read as letters it carried an r, so `rm -Force *`
// was judged a recursive wipe.
function hasRecursive(args)
{
    return args.some(t => t === '--recursive' || (/^-[fiIrRdv]+$/.test(t) && /[rR]/.test(t))
        || /^-rec(?:u(?:r(?:se?)?)?)?(?::\$true)?$/i.test(t));
}

// The command words that delete: rm, and the PowerShell cmdlet with its aliases.
const REMOVE_VERBS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
// PowerShell parameters whose VALUE is a pattern or a name, never a target: `-Include *` narrows the
// delete to what matches under the path, so the `*` is not the cwd.
const VALUE_PARAMS = /^-(?:filter|include|exclude|credential|stream)$/i;

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
    // A Windows spelling uses backslashes: fold them only where the token is plainly a Windows path
    // (a drive, $env:, or ~\ / $HOME\) - in bash `\*` escapes the glob and names a file called '*'.
    if (/^(?:[A-Za-z]:|\$\{?env:|~\\|\$\{?HOME\}?\\)/i.test(t)) t = t.replace(/\\/g, '/');
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

    if (/^[A-Za-z]:(?:\/\*)?$/.test(t)) return true;                             // C:\  C:/  C:\*
    if (/^\/(?:cygdrive\/|mnt\/)?[A-Za-z](?:\/\*)?$/.test(t)) return true;            // /c  /cygdrive/c  /mnt/c
    if (/^\$\{?env:(?:userprofile|home|homedrive|systemdrive|systemroot|windir)\}?(?:\/\*)?$/i.test(t)) return true;
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
        if (!cmd || !(REMOVE_VERBS.has(cmd.toLowerCase()) || cmd.endsWith('/rm')))
        {
            continue;
        }

        const args = tokens.slice(i + 1);
        if (!hasRecursive(args))
        {
            continue;
        }

        const paths = args.filter((a, k) => !a.startsWith('-') && !(k > 0 && VALUE_PARAMS.test(args[k - 1])));
        if (paths.some(isCatastrophic) || paths.filter(isTopLevelDir).length >= 2)
        {
            return true;
        }
    }

    return false;
}

// ---- git, read as git reads its argv -----------------------------------------------------------
// The words of one shell command, quote-aware: '...' is literal and adjacent pieces join ("my file".js
// is one word). In bash "..." keeps \" \\ \$ \` as escapes and a backslash outside quotes escapes the
// next character; in PowerShell a backslash is a path separator and the escape is the backtick - read
// as a bash escape, `src\a.txt` named no file and its discard passed. A redirection and its target are
// no argument (`git clean -fdx > /dev/null` names no path).
function shellWords(text, powershell = false)
{
    const esc = powershell ? '`' : '\\';
    const words = [];
    let word = null;
    let redirect = false;
    const flush = () =>
    {
        if (word !== null) words.push({ text: word, redirect });
        word = null;
        redirect = false;
    };
    for (let i = 0; i < text.length; i++)
    {
        const ch = text[i];
        if (/\s/.test(ch)) { flush(); continue; }
        if (word === null)
        {
            word = '';
            redirect = /^\d*[<>]/.test(text.slice(i));
        }
        if (ch === "'")
        {
            const end = text.indexOf("'", i + 1);
            const stop = end < 0 ? text.length : end;
            word += text.slice(i + 1, stop);
            i = stop;
        }
        else if (ch === '"')
        {
            let j = i + 1;
            for (; j < text.length && text[j] !== '"'; j++)
            {
                if (text[j] === esc && j + 1 < text.length && (powershell || /["\\$`]/.test(text[j + 1]))) j++;
                word += text[j];
            }
            i = j;
        }
        else if (ch === esc)
        {
            word += text[i + 1] ?? '';
            i++;
        }
        else word += ch;
    }
    flush();
    const out = [];
    for (let k = 0; k < words.length; k++)
    {
        if (!words[k].redirect) out.push(words[k].text);
        else if (/^\d*(?:>>?|<|>&|<&|>\|)$/.test(words[k].text)) k++;   // the operator alone: its target is the next word
    }
    return out;
}

// The options git reads BEFORE the verb: `-C <dir>` (each one on from the last), `-c <key=value>`, and
// the few that take their value as the next word; every other one is a single word.
const GIT_GLOBAL_VALUE = /^--(?:git-dir|work-tree|namespace|attr-source|config-env|super-prefix)$/;
function splitGitCall(words)
{
    const dirs = [];
    const config = [];
    let i = 0;
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-')
    {
        const w = words[i];
        if (w === '-C' || w === '-c')
        {
            (w === '-C' ? dirs : config).push(words[i + 1] ?? '');
            i += 2;
        }
        else i += GIT_GLOBAL_VALUE.test(w) ? 2 : 1;
    }
    return { dirs, config, verb: words[i] || '', args: words.slice(i + 1) };
}

// Per verb: the short letters and long names that take a VALUE, and the long names this guard reads. A
// long option may be cut to any unique prefix, as git's own parser allows (`git reset --har` is --hard).
const GIT_OPTS = {
    checkout: { short: 'bB', value: ['orphan', 'conflict', 'pathspec-from-file'], flags: ['force', 'patch'] },
    restore: { short: 's', value: ['source', 'conflict', 'pathspec-from-file'], flags: ['staged', 'worktree', 'patch'] },
    switch: { short: 'cC', value: ['create', 'force-create', 'orphan', 'conflict'], flags: ['force', 'discard-changes'] },
    reset: { short: '', value: ['pathspec-from-file'], flags: ['hard'] },
    clean: { short: 'e', value: ['exclude'], flags: ['force', 'dry-run', 'quiet', 'interactive'] },
    gc: { short: '', value: [], flags: ['prune', 'no-prune'] },
};

// One verb's argv as entries (`-f`, `--force`, each with its value when it takes one), the positionals,
// and the words after `--` (null when there is no `--`). Flags may sit anywhere before `--`.
function parseGitArgs(args, spec)
{
    const known = [...spec.value, ...spec.flags];
    const full = (name) =>
    {
        if (known.includes(name)) return name;
        const hits = known.filter((n) => n.startsWith(name));
        return name && hits.length === 1 ? hits[0] : name;
    };
    const entries = [];
    const pos = [];
    let paths = null;
    for (let i = 0; i < args.length; i++)
    {
        const a = args[i];
        if (paths) { paths.push(a); continue; }
        if (a === '--') { paths = []; continue; }
        if (a.startsWith('--'))
        {
            const eq = a.indexOf('=');
            const name = full(eq < 0 ? a.slice(2) : a.slice(2, eq));
            const value = eq >= 0 ? a.slice(eq + 1) : spec.value.includes(name) ? (args[++i] ?? '') : undefined;
            entries.push({ name: `--${name}`, value });
            continue;
        }
        if (a.length > 1 && a.startsWith('-'))
        {
            for (let k = 1; k < a.length; k++)
            {
                if (spec.short.includes(a[k]))
                {
                    entries.push({ name: `-${a[k]}`, value: a.slice(k + 1) || (args[++i] ?? '') });
                    break;
                }
                entries.push({ name: `-${a[k]}` });
            }
            continue;
        }
        pos.push(a);
    }
    const has = (...names) => entries.some((e) => names.includes(e.name));
    const values = (...names) => entries.filter((e) => names.includes(e.name) && e.value !== undefined).map((e) => e.value);
    const count = (...names) => entries.filter((e) => names.includes(e.name)).length;
    return { entries, pos, paths, has, values, count };
}

// What ONE git call would destroy, as a plan the loss reader in main() answers - or null when the call
// is no destructive form at all. `isRev(word)` says whether a word names a commit or tree: git's own
// rule for `checkout <tree-ish> <paths>` written without `--`. `config` is the call's `-c` pairs.
function gitPlan(verb, args, config, isRev)
{
    const p = parseGitArgs(args, GIT_OPTS[verb] || { short: '', value: [], flags: [] });
    const prev = (t) => (t === '-' ? '@{-1}' : t);   // `-` is the previous branch to checkout and switch
    const reflogConfig = config.filter((c) => /^gc\..*reflogexpire(?:unreachable)?=/i.test(c)).flatMap((c) => ['-c', c]);
    if (verb === 'checkout')
    {
        const forced = p.has('-f', '--force');
        const creates = p.has('-b', '-B', '--orphan');
        let source;
        let paths = [];
        if (p.has('--pathspec-from-file')) return { kind: 'tree', paths: [], target: undefined };   // paths unknowable: the whole tree
        if (p.paths) { source = p.pos[0]; paths = p.paths; }
        else if (creates) source = p.pos[0];
        else if (p.pos.length && isRev(prev(p.pos[0]))) { source = p.pos[0]; paths = p.pos.slice(1); }
        else paths = p.pos;
        if (paths.length || p.has('-p', '--patch')) return { kind: 'tree', paths, target: source && prev(source) };
        // a branch switch or a new branch carries the work along - unless forced, which overwrites it
        return forced ? { kind: 'tree', paths: [], target: source && prev(source) } : null;
    }
    if (verb === 'restore')
    {
        // the working tree is the default; --staged alone restores the index only
        if (p.has('-S', '--staged') && !p.has('-W', '--worktree')) return null;
        const paths = [...p.pos, ...(p.paths || [])];
        if (!paths.length && !p.has('--pathspec-from-file')) return null;   // git refuses a restore with no path
        return { kind: 'tree', paths, target: p.values('-s', '--source').pop() };
    }
    if (verb === 'reset') return p.has('--hard') ? { kind: 'tree', paths: [], target: p.pos[0] } : null;
    if (verb === 'switch')
    {
        if (!p.has('-f', '--force', '--discard-changes')) return null;
        const target = p.has('--orphan') ? undefined : p.pos[0];
        return { kind: 'tree', paths: [], target: target && prev(target) };
    }
    if (verb === 'clean')
    {
        const force = p.count('-f', '--force');
        if (!force || p.has('-n', '--dry-run')) return null;
        // The dry run of the SAME call is exactly what it removes. -q and -i are left out: quiet prints
        // nothing, interactive would wait on a prompt. Every -f is kept: a second one reaches nested repos.
        const dry = ['-c', 'core.quotePath=false', 'clean', '-n'];
        for (let k = 0; k < force; k++) dry.push('-f');
        for (const flag of ['-d', '-x', '-X']) if (p.has(flag)) dry.push(flag);
        for (const v of p.values('-e', '--exclude')) dry.push(`--exclude=${v}`);
        const paths = [...p.pos, ...(p.paths || [])];
        // an unexpanded variable is unknowable - judged as the whole directory rather than guessed
        if (paths.length && !paths.some((a) => /\$/.test(a))) dry.push('--', ...paths);
        return { kind: 'clean', dry, paths };
    }
    if (verb === 'stash')
    {
        if (args[0] === 'clear') return { kind: 'stash', all: true };
        if (args[0] !== 'drop') return null;
        const named = args.slice(1).find((a) => !a.startsWith('-')) || '0';
        return { kind: 'stash', ref: /^\d+$/.test(named) ? `stash@{${named}}` : named };
    }
    // A dry run deletes nothing - it is how a careful run asks what the real one would.
    if (verb === 'reflog')
    {
        if (args[0] !== 'expire' || args.some((a) => a === '-n' || a === '--dry-run')) return null;
        const rest = args.slice(1).filter((a) => a !== '--verbose');
        return { kind: 'reflog', argv: [...reflogConfig, 'reflog', 'expire', '--dry-run', '--verbose', ...rest] };
    }
    if (verb === 'prune') return args.some((a) => a === '-n' || a === '--dry-run') ? null : { kind: 'prune', argv: ['prune', '--dry-run', ...args] };
    if (verb === 'gc')
    {
        // The prune date gc uses: -c gc.pruneExpire, then --prune=<date> / --no-prune, the last one
        // winning as git's parser reads them; a bare --prune keeps the configured default.
        let expiry;
        for (const c of config)
        {
            const m = /^gc\.pruneexpire=(.*)$/i.exec(c);
            if (m) expiry = m[1];
        }
        for (const e of p.entries)
        {
            if (e.name === '--prune' && e.value !== undefined) expiry = e.value;
            if (e.name === '--no-prune') expiry = 'never';
        }
        const dated = expiry !== undefined && expiry !== 'never' && expiry !== 'false';
        if (!dated && !reflogConfig.length) return null;
        return { kind: 'gc', expiry: dated ? expiry : null, reflog: reflogConfig.length ? [...reflogConfig, 'reflog', 'expire', '--dry-run', '--verbose', '--all'] : null };
    }
    return null;
}

// What a plan destroys, read from git itself: [{ kind, rows, targets, named }] - `rows` the lines the
// denial lists, `targets` what a DISCARD-ALLOW line must cover, `named` when the command named paths.
// `run(argv)` is git in the call's own directory; it throws when git cannot answer.
function readLoss(plan, run, gitCwd)
{
    const lines = (out) => out.split('\n').filter(Boolean);
    const wouldPrune = (argv) => lines(run(argv)).filter((l) => /^would prune\b/.test(l));
    if (plan.kind === 'stash')
    {
        const entries = lines(run(['stash', 'list']));
        if (plan.all) return [{ kind: 'stash', rows: entries, targets: entries.map((e) => e.split(':')[0]) }];
        return [{ kind: 'stash', rows: entries.filter((e) => e.startsWith(`${plan.ref}:`)), targets: [plan.ref] }];
    }
    if (plan.kind === 'reflog') return [{ kind: 'reflog', rows: wouldPrune(plan.argv), targets: ['*'] }];
    if (plan.kind === 'prune') return [{ kind: 'objects', rows: lines(run(plan.argv)), targets: ['*'] }];
    if (plan.kind === 'gc')
    {
        const out = [];
        if (plan.expiry)
        {
            // fsck names the loose AND packed unreachable objects, reflogs counted as reachable as gc
            // counts them. A date short of now keeps the younger ones: a loose object is judged by its own
            // age (a prune dry run of that date), a packed one counted whatever its age (not read here).
            let rows = lines(run(['fsck', '--unreachable', '--connectivity-only', '--no-progress'])).filter((l) => /^unreachable\b/.test(l));
            if (!/^(?:now|all)$/.test(plan.expiry))
            {
                const aged = new Set(lines(run(['prune', '--dry-run', `--expire=${plan.expiry}`])).map((l) => l.split(' ')[0]));
                const objects = path.resolve(gitCwd, run(['rev-parse', '--git-path', 'objects']).trim());
                rows = rows.filter((l) =>
                {
                    const sha = l.split(' ').pop();
                    return aged.has(sha) || !fs.existsSync(path.join(objects, sha.slice(0, 2), sha.slice(2)));
                });
            }
            out.push({ kind: 'objects', rows, targets: ['*'] });
        }
        if (plan.reflog) out.push({ kind: 'reflog', rows: wouldPrune(plan.reflog), targets: ['*'] });
        return out;
    }
    if (plan.kind === 'clean')
    {
        // `git status` never lists an ignored file, so -x / -X deleted an ignored .env or .claude/ with
        // exit 0; the dry run of the same flags lists exactly what goes, ignored files included.
        const removed = lines(run(plan.dry)).map((l) => /^Would remove (.+)$/.exec(l)).filter(Boolean).map((m) => m[1]);
        const named = plan.paths.length > 0 && !plan.paths.some((a) => /\$/.test(a));
        return [{ kind: 'tree', rows: removed.map((f) => `clean removes ${f}`), targets: named ? plan.paths : removed, named }];
    }
    // The PATHSPEC the command actually names. The gate used to ask only 'is the tree dirty', which made
    // its own prescribed escape - 'name the ONE file to revert instead of the whole tree' - unreachable:
    // `git restore .gitignore` was denied with all seven dirty files listed, six of which the command
    // never touched (measured live, twice in one session). `.` is the whole tree spelled as a path, and
    // an unexpanded variable is unknowable - both fall back to the whole-tree check rather than a guess.
    const whole = !plan.paths.length || plan.paths.some((a) => a === '.' || /\$/.test(a));
    const spec = whole ? [] : plan.paths;
    // -z: NUL-separated records, never C-quoted, so a non-ASCII name reads as written (the quoted
    // "caf\303\251.txt" never matched the target's ls-tree, and the untracked copy was overwritten).
    // A rename or copy record carries its source as the next field.
    const fields = run(['status', '--porcelain', '-z', ...(spec.length ? ['--', ...spec] : [])]).split('\0');
    const recs = [];
    for (let i = 0; i < fields.length; i++)
    {
        if (fields[i].length < 4) continue;
        const rec = { xy: fields[i].slice(0, 2), file: fields[i].slice(3) };
        if (/[RC]/.test(rec.xy)) rec.orig = fields[++i];
        recs.push(rec);
    }
    // An untracked row is lost only to clean, or to a call whose TARGET tracks that path (git overwrites
    // it); a path checkout, a restore and a reset to HEAD never touch one (measured: the guard's own
    // untracked ledger turned every whole-tree verb into a false block).
    const loose = recs.filter((r) => r.xy === '??').map((r) => r.file);
    let clash = new Set();
    if (plan.target && loose.length)
    {
        // a target git cannot list, or one spelled as an option, keeps every untracked row - never pass on our own failure
        try
        {
            if (plan.target.startsWith('-')) throw new Error('an option, not a target');
            const tracked = run(['ls-tree', '-r', '-z', '--full-tree', '--name-only', plan.target, '--', ...loose]).split('\0').filter(Boolean);
            clash = new Set(loose.filter((p) => tracked.some((t) => t === p || (p.endsWith('/') && t.startsWith(p)))));
        }
        catch { clash = new Set(loose); }
    }
    const lost = recs.filter((r) => (r.xy === '??' ? clash.has(r.file) : r.xy !== '!!'));
    return [{
        kind: 'tree',
        rows: lost.map((r) => `${r.xy} ${r.orig ? `${r.orig} -> ` : ''}${r.file}`),
        targets: spec.length ? spec : lost.map((r) => r.file),
        named: spec.length > 0,
    }];
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
                    // `path` is required at module scope above.
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

    const command = stripHeredocs(payload?.tool_input?.command ?? '');

    // COUNT FIRST, never deny: a SQL `DROP` and `dotnet ef database drop` are the database's rm -rf,
    // but whether a gate would earn its keep is a rate nobody has measured - so each call writes one
    // log-only `mode: 'probe'` row and passes. The SQL usually sits in a quoted argument or a heredoc,
    // so the raw text is scanned; the client that ran it is recorded, so prose can be told from
    // execution when the rows are read.
    (() => {
        if (unsetRepo) return;
        try
        {
            const raw = String(payload?.tool_input?.command ?? '');
            const bare = raw.replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, 'x')).replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, 'x'));
            const ef = /(?:^|[\s;&|(])dotnet\s+ef\s+database\s+drop\b/.exec(bare);
            const sql = ef ? null : /\bdrop\s+(?:table|database|schema|view|index|user|role)\b[^;\n'"]{0,80}/i.exec(raw);
            if (!ef && !sql) return;
            const client = (/(?:^|[\s;&|(/])(psql|mysql|mariadb|sqlite3|sqlcmd|sqlplus|mongosh|duckdb|clickhouse(?:-client)?|cockroach|snowsql|bq|dotnet)(?=\s|$)/.exec(bare) || [])[1] || '';
            const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
            const dir = path.resolve(root, docsRootEnv(), 'hook-blocks');
            fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `${String(payload.session_id || 'nosession').replace(/[^\w.-]/g, '_')}.jsonl`), JSON.stringify({
                ts: new Date().toISOString(),
                hook: path.basename(__filename),
                event: payload.hook_event_name || payload.tool_name || '',
                tool: payload.tool_name || '',
                mode: 'probe',
                kind: ef ? 'ef-database-drop' : 'sql-drop',
                reason: `probe: ${ef ? 'dotnet ef database drop' : `a SQL ${sql[0].split(/\s+/).slice(0, 2).join(' ').toUpperCase()}`}${client && !ef ? ` through ${client}` : ''} - logged, not denied`,
                detail: { client, matched: (ef ? ef[0] : sql[0]).trim().slice(0, 120) },
            }) + '\n');
        }
        catch { /* a probe never changes a verdict and never throws */ }
    })();

    // Git destroys uncommitted work with no undo, and this guard had ZERO git coverage: 225 lines
    // with no occurrence of `git`, so a destructive `git checkout --` replayed exit 0 against every
    // guard in the stack. These verbs are the same class as a recursive rm - the working tree
    // is the only copy - and unlike a commit there is no reflog entry to recover from.
    // Gated on ACTUAL loss: a clean tree has nothing to destroy, so the command passes. That is the
    // same arithmetic the commit gate's trivial-diff exemption uses, and it keeps the guard silent
    // in the overwhelmingly common case of resetting an already-clean checkout.
    // The same class, one step further: a FORCED checkout or switch overwrites the tree on its way to
    // another branch, and `stash drop` / `stash clear` / `reflog expire` destroy the recovery points
    // themselves - a dropped stash and an expired reflog entry are what every other undo leans on.
    // `prune` (whose default expiry is everything) and a `gc` given a prune date or a reflog expiry on
    // the command line delete what those undos recover, ending the grace window early.
    // Each is judged by what it would actually destroy: the dirty paths, what a `clean -n` of the same
    // flags lists, the stash entries it names, the reflog entries or objects a dry run would prune.
    // EVERY git call in the command is read, as git reads its argv (flags anywhere, a tree-ish before
    // the paths): judging only the first let `git reset --hard && git clean -fd` delete an untracked
    // file the reset keeps, and the positional regex this replaced let a dozen discard spellings by.
    //
    // A QUOTED span is data, exactly as it is in the commit guard: an echo, a plan sentence or a
    // grep pattern that merely CONTAINS `git reset --hard` invokes nothing, and denying it teaches
    // the obfuscation that then defeats this gate on a real one. The fill is a NON-space so the
    // span stays one opaque argument token and the offsets survive.
    const gitScan = command
        .replace(/'[^'\n]*'/g, (m) => m.replace(/[^\n]/g, 'x'))
        .replace(/"[^"\n]*"/g, (m) => m.replace(/[^\n]/g, 'x'));
    const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const losses = [];
    const { execFileSync } = require('child_process');
    // A backtick is bash's command substitution and PowerShell's escape, so only bash ends a call on it.
    const powershell = /powershell/i.test(String(payload.tool_name || ''));
    const callStart = powershell ? /(?:^|[;&|(\n]|\s)git(?=\s)/g : /(?:^|[;&|(`\n]|\s)git(?=\s)/g;
    const callEnd = powershell ? /[\n;&|)]|$/ : /[\n;&|)`]|$/;
    for (const found of gitScan.matchAll(callStart))
    {
        const start = found.index + found[0].length;
        const end = start + gitScan.slice(start).search(callEnd);
        const { dirs, config, verb, args } = splitGitCall(shellWords(command.slice(start, end), powershell));
        // WHERE git runs decides what a pathspec names: the call's own cwd, then a `cd` before it in the
        // same command, then its `-C`. Judged from the project root, a dirty file one folder down read
        // as absent and its discard passed. An unexpanded variable is not guessed - the anchor stays.
        let gitCwd = path.resolve(payload.cwd || root);
        for (const c of gitScan.slice(0, found.index).matchAll(/(?:^|&&|\|\||;|\n|\(|\|)\s*(?:cd|pushd|chdir|set-location|sl|push-location)\s+(?:-(?:literal)?path\s+)?(\S+)/gi))
        {
            const dest = command.substr(c.index + c[0].length - c[1].length, c[1].length).replace(/^["']|["']$/g, '');
            if (/\$/.test(dest)) continue;
            gitCwd = path.resolve(gitCwd, dest.replace(/^~(?=$|[\\/])/, require('os').homedir()));
        }
        for (const d of dirs) if (d && !/\$/.test(d)) gitCwd = path.resolve(gitCwd, d);
        // argv, never a shell string: the pathspec used to be single-quoted into an execSync line, and on
        // win32 that line runs through cmd.exe, where a single quote is a literal character - git was
        // asked about a file named 'seed.txt' with the quotes, found it clean, and `git restore <dirty
        // file>` passed on every Windows install (measured: the release CI's windows job). stdio: git's
        // own stderr is CAPTURED - inherited, a non-repo path printed `fatal: not a git repository` to the
        // user on a call this gate then PASSED. LC_ALL=C: the dry runs are read by their English words.
        const run = (argv) => execFileSync('git', argv, { cwd: gitCwd, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).toString();
        const isRev = (w) =>
        {
            if (!w || w.startsWith('-')) return false;
            try { run(['rev-parse', '--verify', '--quiet', `${w}^{tree}`]); return true; }
            catch { return false; }
        };
        const plan = gitPlan(verb, args, config, isRev);
        if (!plan) continue;
        // A git that cannot answer (not a repo, git absent) is no loss - never block on our own failure.
        try { losses.push(...readLoss(plan, run, gitCwd)); }
        catch { /* nothing read, nothing claimed */ }
    }

    // ONE block for the whole command: the losses grouped by what they destroy, every row named.
    const groups = new Map();
    for (const l of losses)
    {
        if (!l.rows.length) continue;
        const g = groups.get(l.kind) || { kind: l.kind, rows: [], targets: [], named: true };
        for (const r of l.rows) if (!g.rows.includes(r)) g.rows.push(r);
        for (const t of l.targets) if (!g.targets.includes(t)) g.targets.push(t);
        g.named = g.named && Boolean(l.named);
        groups.set(l.kind, g);
    }
    if (groups.size)
    {
        const kinds = [...groups.values()];
        const targets = kinds.flatMap((g) => g.targets);
        // The user's own 'discard it' for THIS session. Every other blocking guard in the stack
        // honours an answer; this one had none, so it re-blocked a discard the user had just
        // chosen through AskUserQuestion, and the chosen action was silently substituted with a
        // `git stash push -u` (measured: answer at 06:54:14, block at 06:54:22, 142,674 cache-read
        // on the retried turn). Same shape as CROSS-WRITE-ALLOW: one path (or stash entry) per line,
        // or `*` for everything, this session's own, under 8h - and it must cover EVERY loss named.
        const allowed = (() => {
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
                return targets.length > 0 && targets.every((f) => f !== '*' && lines.some((l) => l === f || f.startsWith(`${l}/`)));
            }
            catch { return false; } // absent or unreadable - no allowance recorded
        })();

        if (!allowed)
        {
            const receiptRel = path.join(docsRootEnv().replace(/^\//, ''), 'flow', 'DISCARD-ALLOW');
            const entries = (n) => `entr${n === 1 ? 'y' : 'ies'}`;
            const head = (g) => (g.kind === 'stash'
                ? `this destroys ${g.rows.length} stash ${entries(g.rows.length)}, and a dropped stash leaves no\nreflog entry to recover it from.`
                : g.kind === 'reflog'
                    ? `this expires ${g.rows.length} reflog ${entries(g.rows.length)} - the reflog is the one record of\ncommits no branch reaches, and gc deletes them once it is gone.`
                    : g.kind === 'objects'
                        ? `this deletes ${g.rows.length} unreachable object(s) now - a reset-away commit, a dropped stash or a lost\n\`git add\` lives on only as these until the grace window ends.`
                        : `this discards uncommitted work in ${g.rows.length} file(s) under ${g.named ? 'the path(s) this command names' : 'the working tree'}, and there is\nno reflog for a working tree - once it is gone it is gone.`);
            const body = kinds.map((g, k) => `${k ? 'And ' : 'Blocked: '}${head(g)}\n` +
                g.rows.slice(0, 10).map((r) => `  ${r}`).join('\n') +
                (g.rows.length > 10 ? `\n  ... and ${g.rows.length - 10} more` : '')).join('\n');
            const one = kinds.length === 1 ? kinds[0].kind : '';
            const keep = one === 'stash' ? `'Keep the stash (Recommended)' - leave it, or \`git stash apply\` it first`
                : one === 'reflog' ? `'Keep the reflog (Recommended)' - skip the expire`
                    : one === 'objects' ? `'Keep them (Recommended)' - a plain \`git gc\` keeps the grace window`
                        : one === 'tree' ? `'Keep the work (Recommended)' - \`git stash -u\`, or commit it`
                            : `'Keep it all (Recommended)' - run none of it; \`git stash -u\` or commit the work first`;
            const narrow = one === 'stash' ? `'Narrow it' - drop ONE named entry instead of every one`
                : groups.has('tree') ? `'Narrow it' - name the ONE file to revert instead of the whole tree` : '';
            const spell = one === 'stash' ? 'one entry per line as `stash@{N}`, or `*` for every one'
                : one === 'reflog' || one === 'objects' ? 'the single line `*`'
                    : one === 'tree' ? 'one path per line exactly as the\ncommand spells them, or `*` for everything'
                        : 'one path or `stash@{N}` per line exactly as\nnamed above, or `*` for everything (a reflog or object loss takes `*`)';
            process.stderr.write(
                body +
                `\nA house rule enforced here, no prose copy to consult - same class as the recursive-rm gate in this file.` +
                `\n\nDo not decide for the user: end this turn with ONE AskUserQuestion carrying, in this order -\n` +
                `  ${keep}\n` +
                `  'Discard it' - the loss is intended and the user says so\n` +
                (narrow ? `  ${narrow}\n` : '') +
                `On 'Discard it', write the receipt ${receiptRel} - ${spell} - then retry the SAME command. It is honoured\n` +
                `for this session only, under 8h. Nothing to lose passes this gate untouched.`,
            );
            process.exit(2);
        }
    }

    if (!isCatastrophicRm(command))
    {
        process.exit(0);
    }

    process.stderr.write(
        'Blocked: a recursive rm of a catastrophic, unrecoverable target (/, ~, $HOME, the cwd or its ' +
        'parent, a bare *, or several top-level system dirs at once) - the filesystem has no reflog. A house ' +
        'rule enforced here, no prose copy to consult. ' +
        'Delete a specific subdirectory by name instead.\n');
    process.exit(2);
}

main();
