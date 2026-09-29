#!/usr/bin/env node
'use strict';
// The full-spec check the single-chat solve flow runs before it merges design and plan audit into one step
// (alfred-task-solve, and alfred-task-solve-cross on its single-chat path). Pilot 3: the gate changed the plan in 1 of
// 4 feature cells, and the steps before the build cost $0.95-1.65 a cell. A FULL spec names three things - the
// surface (an endpoint, a component, a table or a file), the observable behaviour, and how it is verified (the tests
// or acceptance criteria). A request that misses one, spans more than one stack, or touches an auth, secret or payment
// path keeps every gate. The words are read, never understood: a false 'gated' costs one stop, a false 'merged' costs
// the gate, so any security signal and any doubt mean gated, and the model may raise the verdict to gated but never
// lower it.
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
