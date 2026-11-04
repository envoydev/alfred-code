// THE PRIVACY RULES of scripts/collect-session.js (spec 4.4 of docs/superpowers/specs/2026-11-04-usage-collector-design.md,
// a machine-local design): the names never copied, the content a doc or temp file is denied for, and the real-path
// test. Each rule returns the reason a receipt row names - never the value it found.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const { SECRET_SHAPE, PEM_PRIVATE } = require('./credential-shapes.js');
const environment = require('../meta/environment.json');

// meta/environment.json's pattern for credential-named variables, the one copy the secret guard and layout.js pin to.
const SECRET_KEY_RE = new RegExp(environment.secret_key_pattern, 'i');

// Never copied by name, any letter case, whatever the class or flag (spec 4.4): [rule, test].
const EXACT = ['.secrets', '.sensitive-data', 'settings.json', 'settings.local.json', '.credentials.json', 'credentials.json',
    'installed_plugins.json', '.env', '.npmrc', '.netrc', '.git-credentials', '.pypirc', 'id_rsa', 'id_ecdsa', 'id_ed25519', 'id_dsa'];
const SUFFIXES = ['.env', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx'];
function neverCopied(name)
{
    const n = String(name).toLowerCase();
    if (EXACT.includes(n)) return n;
    if (n.startsWith('.env.')) return '.env.*';
    const suffix = SUFFIXES.find((s) => n.endsWith(s) && n.length > s.length);
    return suffix ? `*${suffix}` : null;
}

// An env-style key (capitals, digits, underscores) right before '=', ':' or '": "', bound on the same line to one token
// of 4 or more characters. The key is matched case-SENSITIVELY: lowercase prose ('key: value') and camelCase JSON keys
// are left to the shapes - the case-insensitive reading denied 33 of this repo's 338 plans (the plan's ruling).
const BINDING = /(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]*)(?:[ \t]*[=:]|"[ \t]*:)[ \t]*["']?([^\s"'`]{4,})/gm;
// A key ending in password, passwd or secret, in any letter case ('password: hunter2', '"db_password": ...'), bound the
// same way: measured 2026-11-04 over this repo's 2,596 docs, it denied 5 more - 3 holding live credentials no shape
// matches, 2 prose - where 'key' and 'token' in any case are everyday prose.
const STRONG_BINDING = /(?:^|[^A-Za-z0-9_])((?:[A-Za-z][A-Za-z0-9_.-]*?)?(?:password|passwd|secret))(?:[ \t]*[=:]|["'][ \t]*:)[ \t]*["']?([^\s"'`]{4,})/gim;
function contentDenial(text, keyPattern = SECRET_KEY_RE)
{
    if (SECRET_SHAPE.test(text)) return 'credential shape';
    if (PEM_PRIVATE.test(text)) return 'private key';
    for (const m of text.matchAll(BINDING)) if (keyPattern.test(m[1])) return `secret key ${m[1]}`;
    const strong = STRONG_BINDING.exec(text);
    STRONG_BINDING.lastIndex = 0;
    return strong ? `secret key ${strong[1]}` : null;
}

// True when `file`'s real path lies in `root`'s real path (or is it): a parent folder that is a link out of the root
// resolves outside it.
function realInside(fsx, file, root)
{
    const real = (p) =>
    {
        try { return (fsx.realpathSync.native || fsx.realpathSync)(p); }
        catch { return null; }
    };
    const f = real(file);
    const r = real(root);
    if (!f || !r) return false;
    const rel = path.relative(r, f);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const realpath = (fsx, p) => (fsx.realpathSync.native || fsx.realpathSync)(p);
// A path's real spelling when part of it does not exist yet: the nearest existing ancestor's real path plus the rest.
function realOf(fsx, p)
{
    let head = path.resolve(p);
    const rest = [];
    for (;;)
    {
        try { return path.join(realpath(fsx, head), ...rest.reverse()); }
        catch
        {
            const up = path.dirname(head);
            if (up === head) return path.resolve(p);
            rest.push(path.basename(head));
            head = up;
        }
    }
}

// THE GATE (spec 4.4): a copy run whose `out` lies in a git work tree writes only when git ignores every path it will
// write (`paths`, bundle-relative and '/'-separated), or `allowTracked`. Judged on real paths (a /var temp root is
// /private/var to git), with the hooks' safe git flags; `why` is the receipt's gate value, or the refusal.
const GIT_MAX = 67108864;
function gate(out, paths, opts = {})
{
    const fsx = opts.fs || fs;
    // git starts through runtime.js (its Windows resolution, the repo's one route to an external command); the seam
    // keeps execFileSync's contract - a failed start throws with no status and no signal
    const run = opts.execFileSync || require('./install/runtime.js').execCommand;
    const base = realOf(fsx, out);
    let cwd = base;
    while (!fsx.existsSync(cwd) && path.dirname(cwd) !== cwd) cwd = path.dirname(cwd);
    const git = (args, at, input) => run('git', ['-c', 'core.fsmonitor=false', ...args],
        { cwd: at, input, env: { ...(opts.env || process.env), GIT_OPTIONAL_LOCKS: '0' }, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: GIT_MAX });
    let top;
    try { top = String(git(['rev-parse', '--show-toplevel'], cwd)).trim(); }
    catch (e) { return { ok: true, why: e.code === 'ENOENT' || (e.status == null && !e.signal) ? 'git not found' : 'no work tree' }; }
    if (!top) return { ok: true, why: 'no work tree' };
    const realTop = realOf(fsx, top);
    const rels = paths.map((p) => path.relative(realTop, path.join(base, ...p.split('/'))).split(path.sep).join('/'));
    let stdout;
    try { stdout = git(['check-ignore', '--stdin', '-z', '-v', '-n'], realTop, rels.join('\0') + '\0'); }
    catch (e)
    {
        if (e.status === 1 && e.stdout) stdout = e.stdout;
        else if (opts.allowTracked) return { ok: true, why: 'allow-tracked' };
        else return { ok: false, why: `--out ${out} lies in the git work tree ${realTop}, and git check-ignore failed (${String(e.stderr || e.message).trim().split('\n')[0]}) - pass --allow-tracked only with the user's consent`, firstKept: rels[0] };
    }
    // -z -v -n: <source> NUL <line> NUL <pattern> NUL <path> NUL per path; an empty or '!' pattern keeps the path.
    const fields = String(stdout).split('\0');
    const ignored = new Set();
    for (let i = 0; i + 3 < fields.length; i += 4) if (fields[i + 2] && !fields[i + 2].startsWith('!')) ignored.add(fields[i + 3]);
    const firstKept = rels.find((r) => !ignored.has(r));
    if (firstKept === undefined) return { ok: true, why: 'ignored' };
    if (opts.allowTracked) return { ok: true, why: 'allow-tracked' };
    return {
        ok: false, firstKept,
        why: `--out ${out} lies in the git work tree ${realTop}, and git would keep ${firstKept} - add an ignore rule covering the bundle, or pass --allow-tracked (only with the user's consent)`,
    };
}

module.exports = { neverCopied, contentDenial, realInside, realOf, gate, SECRET_KEY_RE };
