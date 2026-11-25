// scripts/hook-test-env.js - the containment every hook suite applies before it spawns a hook (2.1.5 M5).
// A suite run from a Claude Code session inherits that session's stack settings (an installed checkout seeds
// ALFRED_CODE_DOCS_PATH and the rest into every tool call), its CLAUDE_CODE_ENTRYPOINT and possibly its
// project dir. A hook that reads one of them judges the RUNNER's install - 8 commit-gate cases failed on an
// inherited docs path - and a hook that writes lands in the runner's tree, or, with CLAUDE_PROJECT_DIR pointed
// at os.tmpdir(), in `$TMPDIR/<data root>/statistics/hook-blocks`: a stray folder that broke the benchmark isolation checks.
// One call at the top of each hook suite, after `require('node:test')` and before any env value is set or
// copied: every inherited stack key, the entrypoint, the plugin root and profile and the project dir go, a
// fresh project dir comes back for the suite's own spawns, and the suite FAILS if anything it ran wrote under
// os.tmpdir()'s own docs root, or into the checkout's own hook-blocks ledger, while it ran.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STACK_KEY = /^ALFRED_CODE_/;
const SESSION_KEYS = ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE', 'CLAUDE_PROJECT_DIR'];

// The docs roots a hook falls back to under a project dir of os.tmpdir(): the default and the old one - plus the
// RUNNER's own ledger: a hook spawned with no project dir and no cwd writes its block row under process.cwd(), the
// checkout itself (audit 2026-10-08: layer-table-gate.test.js left 494 rows in the repo's nosession.jsonl unseen).
// Only the ledger folder is watched there, never the whole docs root, which a person edits while a suite runs. Since
// 2.8.0 the hooks' state and ledgers sit beside the docs root, in the data root's state/ and statistics/
// (stack/hooks/layout.js) - the checkout's own ledger with them.
// The checkout's two hook-blocks ledger folders: the data root's (2.8.0+) and the docs root's (before it).
const checkoutLedgers = (root) => [path.join(root, '.alfred', 'statistics', 'hook-blocks'), path.join(root, '.alfred', 'docs', 'hook-blocks')];
const strayRoots = () => [...['.alfred', '.claude'].map((d) => path.join(os.tmpdir(), d, 'docs')),
    ...['state', 'statistics'].map((d) => path.join(os.tmpdir(), '.alfred', d)),
    ...checkoutLedgers(process.cwd()),
    // the session status file (2026-10-29): a hook whose cwd is os.tmpdir() would publish under it
    path.join(os.tmpdir(), '.claude', 'session-inspector')];

// Every file under the stray roots written at or after `since` (ms), as paths.
function strayWrites(since, roots = strayRoots())
{
    const out = [];
    const walk = (dir) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else { try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch { /* gone */ } }
        }
    };
    for (const root of roots) walk(root);
    return out;
}

// The whole-run check (bug 2 of the complexity audit, 2026-11-10): a suite that skips isolateHookSuite, or a probe
// spawned outside one, wrote 213 rows into the checkout's own nosession.jsonl, which a folder-wide tally reads as
// sessions. run-tests.js snapshots the two ledger folders before the run and fails it on any file new or grown after,
// except a live session's own file - named after its session id, a UUID, which no test spells.
const LIVE_SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

// Every file under `dirs` mapped to its size; a missing folder adds nothing.
function ledgerSnapshot(dirs)
{
    const sizes = new Map();
    const walk = (dir) =>
    {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries)
        {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else { try { sizes.set(p, fs.statSync(p).size); } catch { /* gone */ } }
        }
    };
    for (const dir of dirs) walk(dir);
    return sizes;
}

// The files `after` holds that are new or larger than in `before`, sorted, a live session's own file left out.
const ledgerGrowth = (before, after) => [...after]
    .filter(([file, size]) => !LIVE_SESSION_FILE.test(path.basename(file)) && size > (before.get(file) ?? -1))
    .map(([file]) => file)
    .sort();

// A copy of `env` with none of the keys a runner's session hands down.
function scrubbed(env = process.env)
{
    const out = { ...env };
    for (const k of Object.keys(out)) if (STACK_KEY.test(k) || SESSION_KEYS.includes(k)) delete out[k];
    return out;
}

// `ownTmp`: the suite and every hook it spawns get a temp dir of their own (TMPDIR, TEMP and TMP), removed after
// the run - the read and stop hooks keep per-session state files under os.tmpdir(), and the suites left thousands of
// them in the machine's temp dir (audit 2026-10-08: 5,910 `guard-read-*.json`). The stray check reads both temp dirs.
function isolateHookSuite({ ownTmp = false } = {})
{
    for (const k of Object.keys(process.env)) if (STACK_KEY.test(k) || SESSION_KEYS.includes(k)) delete process.env[k];
    const machineRoots = strayRoots();
    let tmp = null;
    if (ownTmp)
    {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-suite-tmp-')));
        for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = tmp;
    }
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-suite-project-')));
    const since = Date.now() - 1000;   // a coarse filesystem clock never hides a write made this second
    const test = require('node:test');
    test.after(() =>
    {
        fs.rmSync(project, { recursive: true, force: true });
        const stray = [...new Set([...strayWrites(since), ...strayWrites(since, machineRoots)])];
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
        if (stray.length) throw new Error(`this suite wrote under os.tmpdir()'s own docs root or the checkout's ledger - a hook ran with the temp dir or the runner's cwd as its project: ${stray.join(', ')}`);
    });
    return { project, tmp };
}

// A review run the commit guard reads - the model's Skill call of review-code, then its result line (a review counts
// once its `Findings:` line follows the call, 2026-10-22). Since 2026-10-22 a commit receipt's VERIFIED line needs one in
// the session whatever it names, so a suite judging another line of the receipt hands the guard a transcript holding
// it. No timestamp: the guard's answered-before-review check reads it as no time at all.
const REVIEW_ROW = JSON.stringify({ type: 'assistant', message: { id: 'm-review', content: [{ type: 'tool_use', id: 't-review', name: 'Skill', input: { skill: 'review-code' } },
    { type: 'text', text: 'Findings: none\nReviewed: 1 files, 1 changed lines, depth standard' }] } });
let reviewedCount = 0;
function reviewedTranscript(dir, rows = [])
{
    const file = path.join(dir, `reviewed-${process.pid}-${++reviewedCount}.jsonl`);
    fs.writeFileSync(file, [REVIEW_ROW, ...rows].join('\n') + '\n');
    return file;
}

// Text in another script, for a suite judging a reply the hooks cannot read as English (the user's ruling of 2026-11-03:
// no non-English words in plugin code or its tests). `count` pseudo-words of lower-case Cyrillic letters (U+0430 to
// U+044F), built from code points on a fixed seed: a run repeats, and no word of any language sits in the source.
function foreignWords(count, seed = 1)
{
    let s = (seed >>> 0) || 1;
    const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s >>> 16; };
    const words = [];
    for (let i = 0; i < count; i += 1)
        words.push(String.fromCodePoint(...Array.from({ length: 3 + (next() % 6) }, () => 0x0430 + (next() % 32))));
    return words.join(' ');
}

// Who gave an ask's answer, as Claude Code 2.1.323 writes it on the answer row (meta/probes/answer-source.js measured
// `permissionDecision.source`: `user_temporary` for a pick, `hook` for a hook's answer). Spread into an answer row;
// `null` writes no field (an older client's row).
const userPick = (source = 'user_temporary') =>
    (source === null ? {} : { permissionDecision: { decision: 'accept', source, grantScope: 'once', reasonCode: 'unknown' } });

// The account folder a suite hands a hook as CLAUDE_CONFIG_DIR when the hook must read the status-file gate as open: a
// settings.json enabling `alfred-mods@test`, the one thing that opens it (session-status.js readerOn). One per process,
// made on first use and removed when the suite ends.
const STATUS_ACCOUNT_SETTINGS = { enabledPlugins: { 'alfred-mods@test': true } };
let statusAccountDir = null;
function statusAccount()
{
    if (statusAccountDir) return statusAccountDir;
    statusAccountDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hook-suite-status-account-')));
    fs.writeFileSync(path.join(statusAccountDir, 'settings.json'), JSON.stringify(STATUS_ACCOUNT_SETTINGS));
    const dir = statusAccountDir;
    process.once('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });
    return statusAccountDir;
}

// What a hook run decided, as one word. `r` is a spawnSync result (`status`) or a dispatcher result (`code`): a raw exit 2
// is 2; else stdout read as ONE JSON object gives its permissionDecision when `ask` or `deny`; else 0. Non-empty stdout
// that opens with `{` and does not parse as one object throws - two JSON objects read as no decision in Claude Code.
function hookOutputOf(r)
{
    const out = String(r.stdout ?? '').trim();
    if (out === '' || out[0] !== '{') return {};
    let parsed;
    try { parsed = JSON.parse(out); } catch { throw new Error('stdout is not one JSON object'); }
    return (parsed && parsed.hookSpecificOutput) || {};
}
function verdictOf(r)
{
    if ((r.status ?? r.code) === 2) return 2;
    const decision = hookOutputOf(r).permissionDecision;
    return decision === 'ask' || decision === 'deny' ? decision : 0;
}
// The text the model gets from a block: an ask's additionalContext, a deny's reason, an exit 2's stderr.
function blockText(r)
{
    const verdict = verdictOf(r);
    if (verdict === 2) return String(r.stderr ?? '');
    if (verdict === 'ask') return String(hookOutputOf(r).additionalContext ?? '');
    return verdict === 'deny' ? String(hookOutputOf(r).permissionDecisionReason ?? '') : '';
}
// The text the user sees on an ask.
const askText = (r) => (verdictOf(r) === 'ask' ? String(hookOutputOf(r).permissionDecisionReason ?? '') : '');

// A block as the suites written before guards asked read it: an ask or a deny becomes exit 2 with the full reason on stderr
// and nothing on stdout. For the many cases that pin WHAT a guard refuses; the ask and the deny have their own cases.
const ASK_REASON_MARK = 'If the user declined: ';
function legacyBlock(r)
{
    const verdict = verdictOf(r);
    if (verdict !== 'ask' && verdict !== 'deny') return r;
    const text = blockText(r);
    const at = verdict === 'ask' ? text.indexOf(ASK_REASON_MARK) : -1;
    return { ...r, status: 2, stdout: '', stderr: at < 0 ? text : text.slice(at + ASK_REASON_MARK.length) };
}

module.exports = { isolateHookSuite, legacyBlock, statusAccount, scrubbed, strayWrites, strayRoots, checkoutLedgers, ledgerSnapshot, ledgerGrowth, LIVE_SESSION_FILE,
    reviewedTranscript, foreignWords, REVIEW_ROW, STACK_KEY, SESSION_KEYS, userPick, verdictOf, blockText, askText };
