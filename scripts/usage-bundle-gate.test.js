'use strict';
// The usage audit's bundle gate (stack/skills/capture-usage-report/scripts/bundle-gate.js): the batch closes at 12 bundles
// OR at the first bundle boundary past the install's fresh-session trigger, and the same per-bundle call rewrites the
// SUMMARY's bundle list. Audit 2026-10-11 SD12, session ae38c08f: a 12-bundle single-turn run on a 1M window crossed the
// 400k trigger after bundle 4 and peaked at 719.5k (48.15M of 68.6M cache-read at or above 400k) with no Stop and no
// compaction to offer a fresh session; and SUMMARY.md was written after 8 bundles and after 12, not after each.
// Every case runs on every OS: the inputs are files, the engine is the stack's own fresh-session.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GATE = path.join(__dirname, '..', 'stack', 'skills', 'capture-usage-report', 'scripts', 'bundle-gate.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-gate-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// A live-session transcript whose last assistant message carried `ctx` context, on a 1M-window model.
function transcript(name, ctx, { model = 'claude-sonnet-5-5', crlf = false } = {})
{
    const rows = [
        { type: 'user', message: { role: 'user', content: 'audit the last sessions' } },
        { type: 'assistant', message: { id: 'a1', model, content: [{ type: 'text', text: 'first' }], usage: { input_tokens: 5, cache_read_input_tokens: 90000, cache_creation_input_tokens: 1000 } } },
        { type: 'assistant', message: { id: 'a2', model, content: [{ type: 'text', text: 'bundle closed' }], usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0 } } },
    ];
    const file = path.join(TMP, `${name}.jsonl`);
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join(crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n'));
    return file;
}
// A project root with no settings, so no auto-compact window or compaction record lowers the trigger.
const project = () => fs.mkdtempSync(path.join(TMP, 'proj-'));
// The seeds an install writes (meta/environment.json): a tier left unset reads as ALFRED_CODE_CONTEXT_WINDOW_DEFAULT
// (the user's ruling of 2026-10-21), so an installed project's run carries them.
const WINDOW_SEEDS = { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '400000', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '280000',
    ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '180000', ALFRED_CODE_CONTEXT_WINDOW_DEFAULT: '180000' };
function gate(args, { cwd = project(), env = {} } = {})
{
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ALFRED_CODE_') && !/^CLAUDE_(CODE_SESSION_ID|PROJECT_DIR|CONFIG_DIR|CODE_AUTO)/.test(k)));
    const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: 'utf8', env: { ...clean, ...WINDOW_SEEDS, HOME: TMP, CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ...env } });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

test('SD12 ae38c08f#3: past the fresh-session trigger the batch closes at this boundary, under it the next bundle runs', () =>
{
    const past = gate(['--done', '5', '--transcript', transcript('past', 450000)]);
    assert.equal(past.code, 0, past.err);
    assert.match(past.out, /^BUNDLE-GATE: CLOSE - context 450,000 is past the fresh-session trigger 400,000 \(5 bundle\(s\) done\)/);
    const under = gate(['--done', '4', '--transcript', transcript('under', 386000)]);
    assert.match(under.out, /^BUNDLE-GATE: next - context 386,000 of the fresh-session trigger 400,000; 4 of 12 bundles done$/);
    // The boundary reads as the Stop offer does (`ctx > at`): at the trigger runs on, one token over closes.
    assert.match(gate(['--done', '4', '--transcript', transcript('at', 400000)]).out, /^BUNDLE-GATE: next - context 400,000 of the fresh-session trigger 400,000;/);
    assert.match(gate(['--done', '4', '--transcript', transcript('over', 400001)]).out, /^BUNDLE-GATE: CLOSE - context 400,001 is past the fresh-session trigger 400,000/);
});

test('SD12 ae38c08f#3: the 12-bundle bound still closes on its own; a switched-off trigger or an unreadable context leaves only it', () =>
{
    assert.match(gate(['--done', '12', '--transcript', transcript('bound', 150000)]).out, /^BUNDLE-GATE: CLOSE - 12 of 12 bundles, the batch bound/);
    assert.match(gate(['--done', '11', '--transcript', transcript('off', 900000)], { env: { ALFRED_CODE_CONTEXT_WINDOW_FOR_1M: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_300K: '0', ALFRED_CODE_CONTEXT_WINDOW_FOR_200K: '0' } }).out,
        /^BUNDLE-GATE: next - the fresh-session trigger is off in this install; 11 of 12 bundles done$/);
    assert.match(gate(['--done', '3']).out, /^BUNDLE-GATE: next - this session's transcript was not found \(no --transcript, no CLAUDE_CODE_SESSION_ID match\), so only the 12-bundle bound applies; 3 of 12 bundles done$/);
    assert.match(gate(['--done', '3', '--transcript', transcript('crlf', 450000, { crlf: true })]).out, /^BUNDLE-GATE: CLOSE - context 450,000/, 'a Windows-saved transcript reads the same');
    assert.match(gate(['--done', '2', '--transcript', transcript('opus45', 190000, { model: 'claude-opus-4-5' })]).out, /^BUNDLE-GATE: CLOSE - context 190,000 is past the fresh-session trigger 180,000/, 'a 200k window takes its own tier');
    const compacted = transcript('compacted', 450000);
    fs.appendFileSync(compacted, JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' }) + '\n');
    assert.match(gate(['--done', '6', '--transcript', compacted]).out, /^BUNDLE-GATE: next - context unknown \(no usage row since the last compaction\), so only the 12-bundle bound applies; 6 of 12 bundles done$/);
    const alone = path.join(TMP, 'alone');
    fs.mkdirSync(alone);
    fs.copyFileSync(GATE, path.join(alone, 'bundle-gate.js'));
    const r = spawnSync(process.execPath, [path.join(alone, 'bundle-gate.js'), '--done', '2', '--transcript', transcript('alone', 450000)], { encoding: 'utf8' });
    assert.match(r.stdout, /^BUNDLE-GATE: next - the fresh-session engine was not found \(run this script from the snapshot\), so only the 12-bundle bound applies; 2 of 12 bundles done/, 'a copy outside the snapshot says why it cannot read the trigger');
    assert.equal(gate(['--done']).code, 2);
    assert.equal(gate(['--done', 'x']).code, 2);
    assert.equal(gate([]).code, 2);
});

test('SD12 ae38c08f#3: the live session is found by CLAUDE_CODE_SESSION_ID under the account projects folder', () =>
{
    const acct = path.join(TMP, 'acct2');
    const dir = path.join(acct, 'projects', 'C--Work-App');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(transcript('live', 520000), path.join(dir, 'abcd-1234.jsonl'));
    const r = gate(['--done', '2'], { env: { CLAUDE_CONFIG_DIR: acct, CLAUDE_CODE_SESSION_ID: 'abcd-1234' } });
    assert.match(r.out, /^BUNDLE-GATE: CLOSE - context 520,000 is past the fresh-session trigger 400,000/);
});

test('SD12 ae38c08f#6: --summary rewrites the bundle list in SUMMARY.md from the bundles on disk, the rest of the file kept', () =>
{
    const root = path.join(TMP, 'usage-report');
    const bundle = (sid, { start = '2026-10-05T16:11:59.967Z', fill = false, crlf = false } = {}) =>
    {
        fs.mkdirSync(path.join(root, sid), { recursive: true });
        const text = ['# Stack usage report', '', '## Environment', '', '| | |', '|---|---|', `| Session window | ${start} → 2026-10-05T16:56:33.273Z (45m) |`, '',
            '## Verdict', '', '| skill | worked as intended | biggest strength |', '|---|---|---|', `| task-solve | ${fill ? 'FILL IN' : 'partly - the bundles landed'} | x |`, ''].join(crlf ? '\r\n' : '\n');
        fs.writeFileSync(path.join(root, sid, 'report-usage.md'), text);
    };
    bundle('aaaa1111');
    bundle('bbbb2222', { start: '2026-10-06T09:00:00.000Z', crlf: true });
    bundle('cccc3333', { fill: true });
    fs.writeFileSync(path.join(root, 'SUMMARY.md'), '# Usage audit - SUMMARY\n\nThe judgment the run wrote by hand.\n');
    const r = gate(['--done', '3', '--summary', root]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^BUNDLE-GATE: next .*\nSUMMARY: .*SUMMARY\.md - 2 finished bundle\(s\), 1 in progress$/s);
    const text = fs.readFileSync(path.join(root, 'SUMMARY.md'), 'utf8');
    assert.match(text, /^The judgment the run wrote by hand\.$/m, 'what the run wrote stays');
    assert.match(text, /^\| `aaaa1111` \| 2026-10-05 \| partly - the bundles landed \| `aaaa1111\/report-usage\.md` \|$/m);
    assert.match(text, /^\| `bbbb2222` \| 2026-10-06 \| partly - the bundles landed \| `bbbb2222\/report-usage\.md` \|$/m);
    assert.match(text, /^\| `cccc3333` \| 2026-10-05 \| in progress - FILL IN sections left \| `cccc3333\/report-usage\.md` \|$/m);
    gate(['--done', '3', '--summary', root]);
    assert.equal(fs.readFileSync(path.join(root, 'SUMMARY.md'), 'utf8'), text, 'a second run rewrites the block in place - idempotent');
    const fresh = path.join(TMP, 'usage-report-new');
    fs.mkdirSync(path.join(fresh, 'dddd4444'), { recursive: true });
    fs.copyFileSync(path.join(root, 'aaaa1111', 'report-usage.md'), path.join(fresh, 'dddd4444', 'report-usage.md'));
    gate(['--done', '1', '--summary', fresh]);
    assert.match(fs.readFileSync(path.join(fresh, 'SUMMARY.md'), 'utf8'), /^\| `dddd4444` \| 2026-10-05 \|/m, 'no SUMMARY yet: the file is created with the block');
});

// Audit 2026-10-20 C40, 4d71a1b3: the gate said `next` 1,688 under the trigger after bundles that had grown the context
// 26.7k and 15.0k, and that bundle ended 15.1k past it. The gate's own earlier readings in the transcript give the run's
// largest growth between bundles; a margin under it closes now.
function withReadings(name, readings, ctx)
{
    const file = transcript(name, ctx);
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n');
    const last = rows.pop();
    readings.forEach((r, i) =>
    {
        const line = `BUNDLE-GATE: next - context ${r.toLocaleString('en-US')} of the fresh-session trigger 400,000; ${i + 1} of 12 bundles done`;
        // the tool result carries the line twice, as the harness writes it: the message content and the stdout copy
        rows.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: line }] }, toolUseResult: { stdout: line } }));
    });
    rows.push(last);
    fs.writeFileSync(file, rows.join('\n') + '\n');
    return file;
}

test('C40 4d71a1b3#2: a margin under the run\'s largest growth between bundles closes the batch before the bundle that would cross', () =>
{
    // the audited shape: 340.0k -> 366.7k (+26.7k) -> 381.7k (+15.0k) -> 398.3k now, 1,688 under the trigger
    const audited = gate(['--done', '3', '--transcript', withReadings('audited', [340000, 366700, 381700], 398312)]);
    assert.match(audited.out, /^BUNDLE-GATE: CLOSE - context 398,312 plus this run's largest growth between bundles, 26,700, passes the fresh-session trigger 400,000 \(3 bundle\(s\) done\)/);
    // seat-authored bundles grow the main session a little: room for one more such bundle runs it
    assert.match(gate(['--done', '3', '--transcript', withReadings('seats', [380000, 383000, 386000], 389000)]).out,
        /^BUNDLE-GATE: next - context 389,000 of the fresh-session trigger 400,000; 3 of 12 bundles done$/);
    // the boundary: growth landing exactly on the trigger runs on (the Stop offer's `ctx > at`), one over closes
    assert.match(gate(['--done', '2', '--transcript', withReadings('at', [390000], 395000)]).out, /^BUNDLE-GATE: next - context 395,000/);
    assert.match(gate(['--done', '2', '--transcript', withReadings('over', [389999], 395000)]).out, /^BUNDLE-GATE: CLOSE - context 395,000 plus this run's largest growth between bundles, 5,001/);
    // a compaction's drop is no growth, and a first bundle has no reading to project from
    assert.match(gate(['--done', '4', '--transcript', withReadings('dropped', [395000], 120000)]).out, /^BUNDLE-GATE: next - context 120,000/);
    assert.match(gate(['--done', '1', '--transcript', transcript('first', 398000)]).out, /^BUNDLE-GATE: next - context 398,000/);
});
