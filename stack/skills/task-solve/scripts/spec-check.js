#!/usr/bin/env node
'use strict';
// The full-spec check the single-chat solve flow runs before it merges design and plan audit into one step
// (task-solve, and task-solve-cross on its single-chat path). Pilot 3: the gate changed the plan in 1 of
// 4 feature cells, and the steps before the build cost $0.95-1.65 a cell. A FULL spec names three things - the
// surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests
// or acceptance criteria). A request that misses one, spans more than one stack, or touches an auth, secret or payment
// path keeps every gate. The words are read, never understood: a false 'gated' costs one stop, a false 'merged' costs
// the gate, so any security signal and any doubt mean gated, and the model may raise the verdict to gated but never
// lower it.
//
//   node spec-check.js [<request file>]      (the request text on stdin when no file is named)
//   node spec-check.js --touched <size>      (the size re-check before a trivial or small close, run in the project)
//
// Built-ins only. Prints one line per item, the `size floor:` the request proves, then `spec:`, `path: merged|gated`
// and the `stop after design:` line that path means;
// `--touched` prints one `size check:` line.
const fs = require('fs');
const path = require('path');

const SURFACE_NOUN = 'endpoint|component|table|column|index|page|screen|form|service|class|method|function|migration|command|route|view|model|entity|dto|query|controller|repository|job|worker';
const SURFACE = [
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s`'")]*/,
    /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w-]+\.(?:cs|csproj|sln|ts|tsx|js|mjs|cjs|jsx|html|scss|css|sql|json|ya?ml|xaml|py|go|java|kt|rb|php|sh|ps1))\b/,
    new RegExp(`\\b(?:${SURFACE_NOUN})\\s+(?:\`[^\`]+\`|[A-Z][a-z0-9]+[A-Z][\\w.]*|[A-Za-z0-9]+_\\w+)`, 'i'),
    new RegExp(`(?:\`[^\`]+\`|\\b[A-Z][a-z0-9]+[A-Z][\\w.]*)\\s+(?:${SURFACE_NOUN})\\b`, 'i'),
];
// An outcome a caller or a test can observe: a verb of the result, a status code, a response shape.
const OUTCOME = /\b(?:returns?|responds?|response|gets?|lists?|listing|shows?|displays?|reads|rejects?|rejected|redirects?|throws?|fails?|succeeds?|rounds?|ordered|sorted|filters?|narrows?|saves?|saved|stores?|emits?|sends?|links?|has|carries|contains|includes|null|empty|must|should)\b|\b[1-5]\d\d\b/i;
const VERIFY = /\b(?:tests?|acceptance criteria|acceptance|assert\w*|verif(?:y|ies|ied))\b|\bgiven\b[\s\S]{0,120}\bwhen\b[\s\S]{0,120}\bthen\b/i;
const CRITERION = /^\s*(?:[-*•]|\d+[.)])\s+/;
const WEB_PAGE = /\bpages?\b/i;
const PAGING = /\b(?:page ?size|pagesize|page=|page number|paged|paging|pages? by pages?|pages? through|pages? of|next page|last page|first page|deep pages?|every page|per page)\b/i;
const STACKS = [
    ['backend', /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\b(?:api|endpoints?|controllers?|migrations?|database|dbcontext|ef core|sql|postgres\w*|sql server|sqlite|repository|asp\.net|backend)\b|\.cs\b/i],
    // By path as well as by word (review C2: a backend endpoint plus `src/app/order-detail.service.ts` read as one
    // stack): the web app's own folders, Angular's file roles, the view extensions; and the words a web change is
    // told in. A `page` counts only outside paging talk (WEB_PAGE below).
    ['web', /(?:^|[\s`'"(/])(?:src\/app|web|client|frontend|front-end|apps\/web|projects\/[\w-]+\/src\/app)\/[\w./-]+|\.(?:component|service|module|routes|store|page|directive|pipe|guard|resolver|interceptor|facade|effects|reducer)\.[jt]s\b|\.component\.\w+\b|\.(?:html|scss|css|tsx|jsx|vue|svelte)\b|\b(?:web|frontend|front-end|angular|react|vue|components?|templates?|browser|ui|buttons?|menu|router|routing|route guards?|routerlink|store|ngrx|signals? store)\b/i],
    ['desktop', /\b(?:wpf|winforms|windows forms|xaml|desktop app)\b/i],
    ['mobile', /\b(?:ionic|capacitor|ios|android|mobile app)\b/i],
    ['devops', /\b(?:dockerfile|docker|compose file|pipeline|github actions|ci\/cd|kubernetes|helm|terraform|deploy\w*)\b/i],
    ['extension', /\b(?:browser extension|manifest v3|content script|service worker)\b/i],
];
// A sentence that leaves a surface as it is names its stack as context, not as work ('Leave `GET /api/loans` as it is
// - the web app pages through it'), so it never counts toward the stacks the request spans.
const CONTEXT = /\b(?:leave|leaves|leaving|untouched|unchanged|as it is|as they are)\b/i;
// Any security signal gates, a rule reused as it stands included (review C1: 'view each other's public wishlists' with
// 'a private wishlist returns an empty array' merged). Access and visibility, ownership and tenancy, credentials,
// crypto, payment and personal data. A CancellationToken is the one token that is no credential.
const SECURITY = /\b(?:auth\w*|log[- ]?ins?|sign[- ]?(?:in|on|up)|passwords?|passphrases?|tokens?|jwt|oauth\w*|oidc|openid|saml|secrets?|credentials?|api[- ]?keys?|private keys?|encrypt\w*|decrypt\w*|crypto\w*|signatures?|payments?|billing|card numbers?|checkout|pci|permissions?|who (?:may|can)|only for themselves|on behalf of|access\w*|roles?|admins?|staff only|forbidden|40[13]|visib\w*|private|public|hidden|who can (?:see|view|read)|each other'?s?|another (?:user|member)'?s?|other (?:users|members)'?|their own|own data|owners?|owned|ownership|tenants?|tenancy|multi-tenant|shar(?:e|es|ed|ing)|pii|personal (?:data|information)|gdpr|ssn|social security)\b/i;
const NOT_A_CREDENTIAL = /\bcancellation ?tokens?\b/gi;

const quote = (m) => `'${String(m).trim().slice(0, 60)}'`;

// The size floor the request itself proves (usage audit 2026-10-10: a run sized itself small at 4 named files, one a
// vendored cross-repo contract, against a row capped at 3 files with no public contract). A floor only: the Size line
// may raise it on what the run reads, never state a size below it. Two stacks floor at standard, never cross: the stack
// read is by words (an Angular change naming the endpoint it calls reads as two), and a false cross moves the run to
// another flow - the Size line says cross when both sides change.
const NAMED_PATH = /(?:^|[\s`'"(\[])((?:[\w.@-]+[\\/])*[\w@-]+(?:\.[\w-]+)*\.(?:cs|csproj|sln|cshtml|razor|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|md|html?|s?css|sql|py|go|java|kt|swift|xml|vue|svelte|ps1|sh|toml|proto))(?=$|[\s`'",;:.)\]])/g;
// A framework's own name is no file of the change ('Node.js', 'Vue.js').
const NOT_A_FILE = /^(?:node|vue|next|nuxt|nest|express|ember|backbone|three|chart|moment|d3|alpine|svelte)\.js$/i;
const CONTRACT = /\b(?:contracts?|public api|schemas?|migrations?|dtos?|vendored|shared (?:types?|models?|library)|openapi|swagger|protobuf|wire format|breaking change)\b/i;
const INPUT_PARSING = /\b(?:pars(?:e|es|ed|ing|er)|validat\w*|sanitiz\w*|deserializ\w*|request body|query string)\b/i;

function classify(text) {
    const body = String(text || '').replace(/\r\n?/g, '\n');
    const lines = body.split('\n');
    const sentences = lines.flatMap((l) => l.split(/(?<=[.!?])\s+/)).filter((s) => s.trim());
    let surface = '';
    for (const re of SURFACE) { const m = body.match(re); if (m) { surface = (m[1] || m[0]).trim(); break; } }
    const b = body.match(OUTCOME);
    const behaviour = b ? quote(b[0]) : '';
    const criteria = lines.filter((l) => CRITERION.test(l) && OUTCOME.test(l)).length;
    const v = body.match(VERIFY);
    const verified = v ? `named - ${quote(v[0])}` : criteria >= 2 ? `${criteria} acceptance criteria listed` : '';
    const worded = sentences.filter((s) => !CONTEXT.test(s));
    const stacks = STACKS.filter(([name, re]) => worded.some((s) => re.test(s) || (name === 'web' && WEB_PAGE.test(s) && !PAGING.test(s)))).map(([name]) => name);
    const signal = body.replace(NOT_A_CREDENTIAL, ' ').match(SECURITY);
    const security = signal ? quote(signal[0]) : '';
    const missing = [
        surface ? '' : 'no surface named (an endpoint, a component, a table or a file)',
        behaviour ? '' : 'no observable behaviour stated',
        verified ? '' : 'not verified - no tests or acceptance criteria',
    ].filter(Boolean);
    const full = missing.length === 0;
    const problems = [
        ...missing,
        stacks.length > 1 ? `spans ${stacks.length} stacks (${stacks.join(', ')})` : '',
        security ? `touches a security path (${security})` : '',
    ].filter(Boolean);
    const paths = [...new Set([...body.matchAll(NAMED_PATH)].map((m) => m[1].replace(/\\/g, '/')).filter((p) => !NOT_A_FILE.test(p)))];
    const contract = body.match(CONTRACT);
    const parsing = body.match(INPUT_PARSING);
    const floorWhy = [stacks.length > 1 ? `${stacks.length} stacks named (${stacks.join(', ')}) - cross only when both change` : '',
        security ? `a security path (${security})` : '', contract ? `a contract (${quote(contract[0])})` : '',
        parsing ? `input parsing (${quote(parsing[0])})` : '', paths.length > 3 ? `${paths.length} files named` : ''].filter(Boolean);
    const sizeFloor = floorWhy.length ? 'standard' : paths.length >= 2 ? 'small' : 'trivial';
    const sizeReason = floorWhy.length ? floorWhy.join(', ') : `${paths.length} file(s) named, no contract, security or parsing signal`;
    return { surface, behaviour, verified, stacks, security, full, missing, path: problems.length ? 'gated' : 'merged', reason: problems.join('; '), paths, sizeFloor, sizeReason };
}

function report(r) {
    return [
        `surface: ${r.surface ? `yes - ${r.surface}` : 'no'}`,
        `behaviour: ${r.behaviour ? `yes - ${r.behaviour}` : 'no'}`,
        `verified: ${r.verified ? `yes - ${r.verified}` : 'no'}`,
        `stacks: ${r.stacks.length} - ${r.stacks.join(', ') || 'none named'}`,
        `security: ${r.security ? `yes - ${r.security}` : 'no'}`,
        `size floor: ${r.sizeFloor} - ${r.sizeReason} (the Size line may raise it, never go below it)`,
        `spec: ${r.full ? 'full' : `not full - ${r.missing.join('; ')}`}`,
        `path: ${r.path}`,
        // A gated path read as 'design and audit in one step' skipped step 1's stop (audit 2026-10-20 C37, 71d5428a):
        // the stop is printed, so the run copies a line instead of inferring the rule.
        `stop after design: ${r.path === 'gated' ? 'yes - the design step ends on its stop, before the plan audit' : 'no - design and plan audit run as one step'}`,
    ].join('\n');
}

// The size re-check (usage audit 2026-10-11, session 5984019e: a run sized small at a 4-file starting diff ended at 10
// touched files, two of them product code, and its close never raised the size, so the small row's one stop was the
// only one). What the run touched is the tracked diff against HEAD plus the untracked files, minus the data root,
// `.claude/` and the files the docs hook recorded as untracked when the change began - counted against the row's cap.
const SIZE_CAPS = { trivial: 1, small: 3 };
const SIZES = ['trivial', 'small', 'standard', 'cross'];

function gitOut(args, cwd) {
    const r = require('child_process').spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? String(r.stdout) : null;
}
// A -z listing as its paths, null when git refused.
const gitLines = (args, cwd) => { const out = gitOut(args, cwd); return out === null ? null : out.split('\0').filter(Boolean); };

function touchedFiles(cwd = process.cwd(), env = process.env) {
    const root = String(gitOut(['rev-parse', '--show-toplevel'], cwd) || '').trim();
    if (!root) return null;
    const tracked = gitLines(['diff', 'HEAD', '--name-only', '-z'], root) || gitLines(['diff', '--cached', '--name-only', '-z'], root) || [];
    const untracked = gitLines(['ls-files', '-o', '--exclude-standard', '-z'], root) || [];
    const posix = (p) => String(p).replace(/\\/g, '/');
    const docsRel = posix(path.relative(root, path.resolve(root, posix(env.ALFRED_CODE_DOCS_PATH || '.alfred/docs'))));
    const head = String(gitOut(['rev-parse', '--verify', '-q', 'HEAD'], root) || '').trim();
    let before = [];
    try { before = fs.readFileSync(path.join(root, docsRel, 'flow', `untracked-at-start-${/^[0-9a-f]{7,64}$/.test(head) ? head : 'unborn'}`), 'utf8').split(/\r?\n/).filter(Boolean).map(posix); }
    catch { /* no record - nothing to subtract */ }
    // The docs root sits in the stack's data root (`<data root>/docs`), whose other files are the stack's too.
    const dataRel = path.posix.basename(docsRel) === 'docs' && !['.', ''].includes(path.posix.dirname(docsRel)) ? path.posix.dirname(docsRel) : docsRel;
    const outside = (f) => f === '.claude' || f.startsWith('.claude/') || (dataRel && !dataRel.startsWith('..') && (f === dataRel || f.startsWith(`${dataRel}/`)));
    return [...new Set([...tracked, ...untracked].map(posix))].filter((f) => !outside(f) && !before.includes(f)).sort();
}

function sizeCheck(size, files) {
    if (!SIZES.includes(size)) return `size check: unknown size '${size}' - one of ${SIZES.join(', ')}`;
    if (files === null) return 'size check: not a git checkout - count the files the run touched by hand';
    const list = files.slice(0, 12).join(', ') + (files.length > 12 ? `, +${files.length - 12} more` : '');
    const cap = SIZE_CAPS[size];
    if (cap === undefined) return `size check: ${size} has no file cap - ${files.length} file(s) touched`;
    if (files.length <= cap) return `size check: ${size} holds - ${files.length} of ${cap} file(s) touched${list ? `: ${list}` : ''}`;
    return `size check: raise to standard - ${files.length} files touched, ${size} allows ${cap}: ${list}`;
}

module.exports = { classify, report, touchedFiles, sizeCheck };

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

if (require.main === module && process.argv[2] === '--touched') {
    blockingStdio();
    process.stdout.write(`${sizeCheck(String(process.argv[3] || '').toLowerCase(), touchedFiles())}\n`);
} else if (require.main === module) {
    blockingStdio();
    let text;
    try { text = fs.readFileSync(process.argv[2] || 0, 'utf8'); }
    catch (e) { process.stderr.write(`spec-check: cannot read ${process.argv[2] || 'stdin'} - ${e.code || e.message}\n`); process.exit(2); }
    process.stdout.write(`${report(classify(text))}\n`);
}
