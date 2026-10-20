#!/usr/bin/env node
// receipt.js - write the COMMIT-GATE / PUSH-GATE receipt the guard-ungated-commit hook reads, with every field git
// can state filled from git: `head:` is the live HEAD, `spec:` counts and names the files the act takes in, and the
// `format:` / `security:` lines carry that same count. Only the judgment lines come from the caller. Hand-written
// receipts were refused 37 times in 3 weeks for those mechanical fields alone - a spec count off by the files the
// commit takes in (12), a review claiming security with no security: line (16), a head: another commit had moved
// past (about 9) - each a blocked act and a re-written file (hooks review 2026-10-16).
// Dependencies: none - Node.js built-ins and git.
// Usage, from the project (any folder of its repo):
//   node receipt.js commit --verified "<what was reviewed>" (--authorized "<user's words>" | --answered "<label>")
//        --probe "<what ran, or NOT RUN - reason>" --format "<format check command, or none>" --findings "<count or none>"
//        [--security "<categories checked and verdicts>"] [--carried "<cycle id>, reviewed <date>"]
//        [--paths <path>... | --all | --tree] [--dry-run]
//   node receipt.js push --verified "<what is published>" (--authorized | --answered) --probe "<...>" [--scope "<...>"]
//   node receipt.js commit|push --waived "<the user's words skipping the review>"
//   node receipt.js clear commit|push
// The commit set: the index, plus the changes under --paths (a `git add <paths>` or `git commit <paths>` the act runs),
// or plus every tracked change with --all (`git commit -a`); with nothing staged and no flag, the whole tree. The
// docs root, the data root's state/ (where the receipt lives, `<data root>/state/approvals/`) and statistics/, and what
// was untracked when the session began are left out, as the guard leaves them out. Exit 0 = written (or printed with
// --dry-run); 2 = refused, with the reason on stderr.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SHOWN = 8;
const MANIFESTS = ['package.json', 'pom.xml', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'build.gradle', 'build.gradle.kts'];

function parseArgs(argv) {
  const out = { _: [], paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--paths') { while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.paths.push(argv[++i]); continue; }
    if (a === '--all' || a === '--tree' || a === '--dry-run') { out[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) { out[a.slice(2)] = i + 1 < argv.length ? argv[++i] : ''; continue; }
    out._.push(a);
  }
  return out;
}

// The stack's setting ALFRED_CODE_<suffix>, '' read as unset (env-reader in meta/shared-rules.json pins the copies).
function envOf(env, suffix)
{
    const value = env[`ALFRED_CODE_${suffix}`];
    return value === '' ? undefined : value;
}
// data-root-reader (meta/shared-rules.json): ALFRED_CODE_DATA_PATH, relative to the project, else .alfred.
const dataRoot = (env = process.env) => String(envOf(env, 'DATA_PATH') || '.alfred').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '') || '.alfred';

const fail = (msg) => { process.stderr.write(`receipt: ${msg}\n`); process.exit(2); };
const gitIn = (cwd) => (args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const lines = (s, sep = '\n') => s.split(sep).map((l) => l.trim()).filter(Boolean);
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return p; } };
const topOf = (dir) => { try { return real(gitIn(dir)(['rev-parse', '--show-toplevel']).trim()); } catch { return null; } };

// The project root and docs root the guard uses: CLAUDE_PROJECT_DIR when it is in this repo, else the repo top.
function locate() {
  const top = topOf(process.cwd());
  if (!top) fail('not inside a git repository');
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  const root = projectDir && topOf(projectDir) === top ? real(projectDir) : top;
  // the environment first, then the project's settings files, as the hooks get them
  const setting = (suffix) => {
    let value = envOf(process.env, suffix);
    for (const f of ['settings.local.json', 'settings.json']) {
      if (value) break;
      try { value = envOf(JSON.parse(fs.readFileSync(path.join(root, '.claude', f), 'utf8')).env || {}, suffix); } catch { /* absent or unreadable */ }
    }
    return value;
  };
  const docsAbs = path.resolve(root, setting('DOCS_PATH') || '.alfred/docs');
  const dataAbs = path.resolve(root, dataRoot({ ALFRED_CODE_DATA_PATH: setting('DATA_PATH') }));
  // 2.8.0: the receipts live in <data root>/state/approvals/ (stack/hooks/layout.js), where the guard reads them first
  const approvalsAbs = path.join(dataAbs, 'state', 'approvals');
  const inTop = (abs) => { const r = path.relative(top, real(abs)).split(path.sep).join('/'); return r && !r.startsWith('..') && !path.isAbsolute(r) ? `${r}/` : null; };
  const ownPrefixes = [docsAbs, path.join(dataAbs, 'state'), path.join(dataAbs, 'statistics')].map(inTop).filter(Boolean);
  return { top, root, docsAbs, approvalsAbs, ownPrefixes, git: gitIn(top) };
}

// What was untracked when the session began (docs-session.js writes it per HEAD): this HEAD's record, else the newest.
function preExisting(ctx, head) {
  const dir = path.join(ctx.docsAbs, 'flow');
  let file = path.join(dir, `untracked-at-start-${head || 'unborn'}`);
  if (!fs.existsSync(file)) {
    file = null;
    let newest = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith('untracked-at-start-')) continue;
        const m = fs.statSync(path.join(dir, f)).mtimeMs;
        if (m > newest) { newest = m; file = path.join(dir, f); }
      }
    } catch { /* no flow folder */ }
  }
  const rootRel = path.relative(ctx.top, ctx.root).split(path.sep).join('/');
  try { return new Set(lines(fs.readFileSync(file, 'utf8')).map((f) => (rootRel ? `${rootRel}/${f}` : f))); } catch { return new Set(); }
}

// The files this commit takes in, repo-relative, as the guard's measure() reads them.
function commitFiles(ctx, args, head) {
  const keep = (f) => f && !ctx.ownPrefixes.some((p) => f.startsWith(p));
  const before = preExisting(ctx, head);
  const set = new Set();
  const diff = (base, paths) => { for (const f of lines(ctx.git(['diff', ...base, '--name-only', '-z', ...(paths.length ? ['--', ...paths] : [])]), '\0')) if (keep(f)) set.add(f); };
  const others = (paths) => { for (const f of lines(ctx.git(['ls-files', '-z', '--full-name', '--others', '--exclude-standard', ...(paths.length ? ['--', ...paths] : [])]), '\0')) if (keep(f) && !before.has(f)) set.add(f); };
  // against the cwd's REAL path, as ctx.top is: Windows keeps an 8.3 or junction spelling in process.cwd()
  const cwd = real(process.cwd());
  const paths = args.paths.map((p) => path.relative(ctx.top, path.resolve(cwd, p)).split(path.sep).join('/') || '.');
  diff(['--cached'], []);
  if (args.tree || (!set.size && !args.all && !paths.length)) { diff(['HEAD'], []); others([]); }
  else if (args.all) diff(['HEAD'], []);
  else if (paths.length) { diff(['HEAD'], paths); others(paths); }
  return [...set].sort();
}

// The files and commits a push takes out, as the guard's pushTouchedProjects() reads them.
function pushFiles(ctx) {
  let files;
  let commits = 0;
  try {
    files = lines(ctx.git(['diff', '@{u}..HEAD', '--name-only']));
    commits = Number(ctx.git(['rev-list', '--count', '@{u}..HEAD']).trim()) || 0;
  } catch {
    try {
      files = [...new Set(lines(ctx.git(['log', '--name-only', '--format=', 'HEAD', '--not', '--remotes'])))];
      commits = Number(ctx.git(['rev-list', '--count', 'HEAD', '--not', '--remotes']).trim()) || 0;
    } catch { files = []; }
  }
  return { files: files.filter((f) => !(ctx.docsPrefix && f.startsWith(ctx.docsPrefix))).sort(), commits };
}

function projectOf(ctx, f) {
  const parts = f.split('/');
  if (parts.length < 2) return null;
  if (parts.length >= 3 && /^(apps|libs|packages|projects|services|modules)$/i.test(parts[0])) return parts[1];
  try {
    const entries = fs.readdirSync(path.join(ctx.top, parts[0]));
    return entries.some((e) => MANIFESTS.includes(e) || /\.(csproj|sln|fsproj|vbproj)$/i.test(e)) ? parts[0] : null;
  } catch { return null; }
}

const named = (files) => (files.length ? ` - ${files.slice(0, SHOWN).join(', ')}${files.length > SHOWN ? `, and ${files.length - SHOWN} more` : ''}` : '');
// The user's words in quotes the guard reads: double quotes, or curly ones when the words hold a double quote.
const quote = (words) => (words.includes('"') ? `“${words}”` : `"${words}"`);

function build(gate, args, ctx) {
  const lead = (s) => String(s || '').trim();
  if (args.waived !== undefined) {
    if (!lead(args.waived)) fail('--waived needs the user\'s own words that skip the review');
    return { body: `WAIVED - ${quote(lead(args.waived))}\n`, files: [] };
  }
  const missing = ['verified', 'probe', ...(gate === 'commit' ? ['format', 'findings'] : [])].filter((k) => !lead(args[k]));
  if (!lead(args.authorized) && !lead(args.answered)) missing.push('authorized (or answered)');
  if (missing.length) fail(`missing ${missing.map((k) => `--${k.split(' ')[0]}`).join(', ')} - the guard refuses a receipt without ${missing.length > 1 ? 'them' : 'it'}`);
  let head = '';
  try { head = ctx.git(['rev-parse', 'HEAD']).trim(); } catch { fail('this repository has no commit yet - the receipt names the HEAD the review ran against'); }
  const security = lead(args.security);
  if (/\bsecurity\b/i.test(args.verified) && !lead(args.carried) && (!security || /^(no findings?|none|n\/a|clean|ok|0 findings?)\.?$/i.test(security)))
    fail('--verified claims a security review, so --security must name each category checked and its verdict (auth ok, secrets ok, injection ok, data-access n/a)');
  const out = [`VERIFIED ${lead(args.verified)}`];
  out.push(lead(args.authorized) ? `authorized: ${quote(lead(args.authorized))}` : `answered: ${lead(args.answered)}`);
  out.push(`head: ${head}`);
  let files;
  if (gate === 'commit') {
    files = commitFiles(ctx, args, head);
    if (!files.length) fail('this commit takes in no file - stage the change, or name it with --paths, --all or --tree');
    out.push(`spec: ${files.length} file${files.length === 1 ? '' : 's'}${named(files)}`);
    out.push(`live-probe: ${lead(args.probe)}`);
    const fmt = lead(args.format);
    out.push(/^none$/i.test(fmt) ? `format: none configured - clean over ${files.length} staged files, nothing to check` : `format: ${fmt} - clean over ${files.length} staged files`);
    out.push(`findings: ${lead(args.findings)}`);
    if (security) out.push(`security: ${security} - over ${files.length} files`);
  } else {
    const going = pushFiles(ctx);
    files = going.files;
    out.push(`spec: ${going.commits} commit${going.commits === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'} going out${named(files)}`);
    out.push(`live-probe: ${lead(args.probe)}`);
    const projects = [...new Set(files.map((f) => projectOf(ctx, f)).filter(Boolean))];
    const scope = lead(args.scope);
    if (projects.length > 1 && !/\bNOT RUN\b/i.test(args.probe)) {
      if (!scope) fail(`this push touches ${projects.join(', ')} - --scope must name what the probe covered (workspace, or every one of them)`);
      const missed = /\b(workspace|whole\s+repo|entire\s+repo|monorepo|all\s+projects?)\b/i.test(scope) ? [] : projects.filter((p) => !scope.toLowerCase().includes(p.toLowerCase()));
      if (missed.length) fail(`--scope ${scope} misses ${missed.join(', ')}, which this push also touches`);
    }
    if (scope) out.push(`scope: ${scope}`);
    if (security) out.push(`security: ${security}`);
  }
  if (lead(args.carried)) out.push(`carried: ${lead(args.carried)}`);
  return { body: `${out.join('\n')}\n`, files };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [verb, which] = args._;
  const gateOf = (w) => ({ commit: 'COMMIT-GATE', push: 'PUSH-GATE' })[w];
  if (verb === 'clear') {
    if (!gateOf(which)) fail('usage: receipt.js clear commit|push');
    const ctx = locate();
    const file = path.join(ctx.approvalsAbs, gateOf(which));
    fs.rmSync(file, { force: true });
    // and the pre-2.8.0 flow/ one, which the guard reads once the new one is gone
    fs.rmSync(path.join(ctx.docsAbs, 'flow', gateOf(which)), { force: true });
    process.stdout.write(`cleared ${path.relative(process.cwd(), file) || file}\n`);
    return;
  }
  if (!gateOf(verb)) fail('usage: receipt.js commit|push --verified ... | --waived ... (or clear commit|push) - see the header');
  const ctx = locate();
  const { body } = build(verb, args, ctx);
  const file = path.join(ctx.approvalsAbs, gateOf(verb));
  if (!args['dry-run']) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  process.stdout.write(`${args['dry-run'] ? 'would write' : 'wrote'} ${path.relative(process.cwd(), file) || file}:\n${body}`);
}

// stdout and stderr block, so a pipe gets every byte before process.exit (macOS writes a pipe async) - the
// prelude's blockingStdio, inline because a skill copy has no prelude beside it (blocking-stdio in meta/shared-rules.json).
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}

if (require.main === module) { blockingStdio(); main(); }
module.exports = { parseArgs };
