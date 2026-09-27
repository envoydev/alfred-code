#!/usr/bin/env node
'use strict';
// The full-spec check the single-chat solve flow runs before it merges design and plan audit into one step
// (alfred-task-solve, and alfred-task-solve-cross on its single-chat path). Pilot 3: the gate changed the plan in 1 of
// 4 feature cells, and the steps before the build cost $0.95-1.65 a cell. A FULL spec names three things - the
// surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests
// or acceptance criteria). A request that misses one, spans more than one stack, or touches an auth, secret or payment
// path keeps every gate. The words are read, never understood: a false 'gated' costs one stop, a false 'merged' costs
// the gate, so every ambiguous signal leans gated, and the model may raise the verdict to gated but never lower it.
//
//   node spec-check.js [<request file>]      (the request text on stdin when no file is named)
//
// Built-ins only. Prints one line per item, then `spec:` and `path: merged|gated`.
const fs = require('fs');

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
const STACKS = [
    ['backend', /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/|\b(?:api|endpoints?|controllers?|migrations?|database|dbcontext|ef core|sql|postgres\w*|sql server|sqlite|repository|asp\.net|backend)\b|\.cs\b/i],
    ['web', /\b(?:web|frontend|front-end|angular|react|vue|components?|templates?|browser|ui|buttons?|menu)\b|\.(?:html|scss|css|tsx)\b/i],
    ['desktop', /\b(?:wpf|winforms|windows forms|xaml|desktop app)\b/i],
    ['mobile', /\b(?:ionic|capacitor|ios|android|mobile app)\b/i],
    ['devops', /\b(?:dockerfile|docker|compose file|pipeline|github actions|ci\/cd|kubernetes|helm|terraform|deploy\w*)\b/i],
    ['extension', /\b(?:browser extension|manifest v3|content script|service worker)\b/i],
];
// A sentence that leaves a surface as it is names its stack as context, not as work ('Leave `GET /api/loans` as it is
// - the web app pages through it'), so it never counts toward the stacks the request spans.
const CONTEXT = /\b(?:leave|leaves|leaving|untouched|unchanged|as it is|as they are)\b/i;
// Security words that mark the work itself, wherever they stand; and the access words that mark it only when the
// sentence does not reuse a rule that already exists ('the same 403 the report gives', 'keeps its access rule').
const SECURITY = /\b(?:authenticat\w*|log[- ]?ins?|sign[- ]?(?:in|on|up)|passwords?|passphrases?|tokens?|jwt|oauth\w*|oidc|openid|saml|secrets?|credentials?|api[- ]?keys?|private keys?|encrypt\w*|decrypt\w*|crypto\w*|signatures?|payments?|billing|card numbers?|checkout|pci|permissions?|who (?:may|can)|only for themselves|on behalf of)\b/i;
const ACCESS = /\b(?:authori[sz]\w*|roles?|admins? only|staff only|access rules?|forbidden|40[13])\b/i;
const REUSE = /\b(?:same|unchanged|as it is|as they are|keeps?|existing|already)\b/i;

const quote = (m) => `'${String(m).trim().slice(0, 60)}'`;

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
    const stacks = STACKS.filter(([, re]) => worded.some((s) => re.test(s))).map(([name]) => name);
    let security = '';
    const strong = body.match(SECURITY);
    if (strong) security = quote(strong[0]);
    else {
        const hit = sentences.find((s) => ACCESS.test(s) && !REUSE.test(s));
        if (hit) security = quote(hit.match(ACCESS)[0]);
    }
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
    return { surface, behaviour, verified, stacks, security, full, missing, path: problems.length ? 'gated' : 'merged', reason: problems.join('; ') };
}

function report(r) {
    return [
        `surface: ${r.surface ? `yes - ${r.surface}` : 'no'}`,
        `behaviour: ${r.behaviour ? `yes - ${r.behaviour}` : 'no'}`,
        `verified: ${r.verified ? `yes - ${r.verified}` : 'no'}`,
        `stacks: ${r.stacks.length} - ${r.stacks.join(', ') || 'none named'}`,
        `security: ${r.security ? `yes - ${r.security}` : 'no'}`,
        `spec: ${r.full ? 'full' : `not full - ${r.missing.join('; ')}`}`,
        `path: ${r.path}`,
    ].join('\n');
}

module.exports = { classify, report };

if (require.main === module) {
    let text;
    try { text = fs.readFileSync(process.argv[2] || 0, 'utf8'); }
    catch (e) { process.stderr.write(`spec-check: cannot read ${process.argv[2] || 'stdin'} - ${e.code || e.message}\n`); process.exit(2); }
    process.stdout.write(`${report(classify(text))}\n`);
}
