'use strict';

// analyze-usage.test.js - the analyzer's accounting invariants against a synthetic
// transcript: per-message usage dedup (fold-max), tool-result volume, per-skill
// attribution incl. cache-read, --from/--to windowing, and flag-before-target parsing.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'analyze-usage.js');

const line = (o) => JSON.stringify(o) + '\n';
const usage = (input, cc, cr, out) => ({
  input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out,
});

function writeFixture(dir) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    // msg m1, duplicated line with identical usage - must count ONCE
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(10, 100, 1000, 50), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x.cs' } }] } }) +
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:01.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(10, 100, 1000, 50), content: [] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:00:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'abcd'.repeat(100) }] } }) +
    // msg m2, attributed to a skill
    line({ type: 'assistant', timestamp: '2026-07-15T07:10:00.000Z', attributionSkill: 'csharp', message: { id: 'm2', model: 'claude-sonnet-5', usage: usage(5, 0, 2000, 30), content: [] } }) +
    // msg m3, outside the test window
    line({ type: 'assistant', timestamp: '2026-07-15T09:00:00.000Z', message: { id: 'm3', model: 'claude-sonnet-5', usage: usage(1, 0, 5000, 10), content: [] } }),
  );
  return file;
}

function run(args) {
  return JSON.parse(execFileSync('node', [SCRIPT, ...args, '--json'], { encoding: 'utf8' }));
}

test('full report: dedups per message.id, measures results, attributes skill cache-read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const { main } = run([file]);
  assert.strictEqual(main.total.msgs, 3);
  assert.strictEqual(main.total.output, 90);
  assert.strictEqual(main.total.cacheRead, 8000);
  assert.strictEqual(main.toolCalls.Read.calls, 1);
  assert.strictEqual(main.toolCalls.Read.resultChars, 400);
  // m3 carries no stamp: sticky carry-forward attributes it to the last active skill and
  // counts it separately as carried (the stamp drops at task-notifications mid-run - measured)
  assert.deepStrictEqual(main.skillAttribution.csharp, { msgs: 2, output: 40, cacheRead: 7000, carriedMsgs: 1, maxCarryRun: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('compaction pairs count once; guard denials bucket as hookBlocks, not errors; workflows/ nests are scanned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'Big.cs' } }] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Blocked: whole-file Read of Big.cs (300 lines) - locate the symbol first.' }] } }) +
    // one real compaction emits BOTH markers - must count once
    line({ type: 'system', timestamp: '2026-07-15T07:01:00.000Z', compactMetadata: { trigger: 'auto' } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:01:00.001Z', isCompactSummary: true, message: { content: 'summary' } }) +
    line({ type: 'assistant', timestamp: '2026-07-15T07:02:00.000Z', message: { id: 'm2', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'x.txt' } }] } }) +
    line({ type: 'user', timestamp: '2026-07-15T07:02:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'File does not exist.' }] } }),
  );
  const wfDir = path.join(dir, 'subagents', 'workflows', 'wf_1');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'agent-w1.jsonl'),
    line({ type: 'assistant', timestamp: '2026-07-15T07:03:00.000Z', message: { id: 'w1', model: 'claude-sonnet-5', usage: usage(1, 0, 50, 7), content: [] } }),
  );
  const { main, agents } = run([file]);
  assert.strictEqual(main.compactions, 1, 'dual-marker compaction counts once');
  assert.strictEqual(main.toolCalls.Read.hookBlocks, 1, 'guard denial bucketed');
  assert.strictEqual(main.toolCalls.Read.errors, 1, 'real error still counted');
  assert.strictEqual(agents.length, 1, 'nested workflow transcript found');
  assert.strictEqual(agents[0].meta.agentType, 'workflow-subagent');
  assert.strictEqual(agents[0].group, 'workflows/wf_1');
  assert.strictEqual(agents[0].stats.total.output, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--from/--to windows the accounting to the run inside a long session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const report = run([file, '--from', '2026-07-15T06:59:00Z', '--to', '2026-07-15T08:00:00Z']);
  assert.strictEqual(report.window.to, '2026-07-15T08:00:00Z');
  assert.strictEqual(report.main.total.msgs, 2);
  assert.strictEqual(report.main.total.output, 80);
  assert.strictEqual(report.main.total.cacheRead, 3000);
  assert.strictEqual(report.main.lastTs, '2026-07-15T07:10:00.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--report-md emits the machine-written skeleton with tables and fill-in sections', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.ok(md.startsWith('# Stack usage report - session `session`'));
  // machine-written numbers: deduped msgs and the skill attribution row
  assert.ok(md.includes('| main session | 16 | 100 | 8.0k | 90 | 3 |'), 'tokens table row present');
  assert.ok(md.includes('| csharp |  | 0 | ~0 | 2 (1 carried) | 40 | 7.0k |'), 'skills attribution row present (sticky carry labeled)');
  assert.ok(md.includes('| Read | 1 | ~100 | 0 |  |'), 'tools table row present');
  // judgment surface is fill-in only
  // Guard blocks is the FOURTH required fill: the no-ledger branch prints a question ('say which,
  // do not infer') that shipped unanswered in audited bundles because no section was marked.
  assert.ok(md.includes('## Guard blocks - FILL IN'));
  assert.ok(md.includes('## Waste analysis - FILL IN'));
  assert.ok(md.includes('## Protocol check - FILL IN'));
  assert.ok(md.includes('## Verdict - FILL IN'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a flag value before the target is not mistaken for the target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const { main } = run(['--to', '2026-07-15T08:00:00Z', file]);
  assert.strictEqual(main.total.msgs, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the audit's analyzer defects: each test pins a number a shipped report got wrong ---

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-')); }
function fixture(dir, records) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, records.map(line).join(''));
  return file;
}
const bash = (id, command) => ({
  type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z',
  message: { id: `m-${id}`, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
});
const result = (id, extra) => ({
  type: 'user', timestamp: '2026-07-15T07:00:01.000Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(extra || {}) }] },
});

test('hook-log join: the ledger cross-check counts calls in the window, on parsed epochs', () => {
  // Both sides are ISO strings. `firstTs - 250` on a string is NaN, so every comparison was false
  // and inWin was 0 for EVERY session carrying a ledger - the report printed '0% of tool calls are
  // inside the ledger window' plus the false 'wired mid-session' line the latency budget exists to
  // remove. Re-derived by hand across the audited corpus, those same sessions were 8/8, 10/10,
  // 12/12, 25/25, 50/51 and 65/66. Nothing referenced inWin or callPct in this file before.
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo one'), result('t1'), bash('t2', 'echo two'), result('t2')]);
  const ledger = path.join(dir, 'tools-usage.jsonl');
  // The ledger rows straddle the two calls, both of which sit at 07:00:00.000Z.
  fs.writeFileSync(ledger, [
    line({ ts: '2026-07-15T06:59:59.900Z', tool: 'Bash', detail: 'echo one' }),
    line({ ts: '2026-07-15T07:00:00.100Z', tool: 'Bash', detail: 'echo two' }),
  ].join(''));
  const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
  assert.ok(cov, 'the join reports coverage when a ledger is given');
  assert.strictEqual(cov.inWin, 2, 'both calls are inside the ledger window');
  assert.strictEqual(cov.callPct, 100, '... so call coverage is 100%, not 0%');
  assert.strictEqual(cov.tailCalls, 0, 'and nothing sits past the window - the string + number form concatenated and always said 0 here too');

  // A call genuinely outside the window still counts as outside: the fix is arithmetic, not a blanket pass.
  const dir2 = tmp();
  const file2 = fixture(dir2, [bash('t1', 'echo one'), result('t1')]);
  const ledger2 = path.join(dir2, 'tools-usage.jsonl');
  fs.writeFileSync(ledger2, line({ ts: '2026-07-15T09:00:00.000Z', tool: 'Bash', detail: 'much later' }));
  const cov2 = run([file2, '--hook-log', ledger2]).hookLog.coverage;
  assert.strictEqual(cov2.inWin, 0, 'a call two hours before the ledger opens is outside it');
  assert.strictEqual(cov2.callPct, 0, '... and reads as 0% for a real reason');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('generated-docs touches: a Windows Write target matches the docs prefix', () => {
  // `docsPrefixes` is spelled with forward slashes; a Windows run writes `C:\\...\\.claude\\docs\\`,
  // so every doc a Windows session wrote scored 0 writes (measured: five Write calls, three docs).
  const dir = tmp();
  const w = (id, file_path) => ({
    type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z',
    message: { id: `m-${id}`, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id, name: 'Write', input: { file_path, content: 'x' } }] },
  });
  const file = fixture(dir, [
    w('w1', 'C:\\Projects\\app\\.claude\\docs\\architecture\\ARCHITECTURE.md'), result('w1'),
    w('w2', '/home/u/app/.claude/docs/architecture/ARCHITECTURE.md'), result('w2'),
  ]);
  const { main } = run([file]);
  const touch = main.docTouches && main.docTouches['architecture/ARCHITECTURE.md'];
  assert.ok(touch, 'the doc is seen at all');
  assert.strictEqual(touch.writes, 2, 'both separators count - the Windows one was invisible before');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('user prompts: one typed turn counts once; echoes, stdout siblings and compact summaries do not', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'run the audit' } },
    // the same typed turn's sibling records share the parentUuid - they are not new prompts
    { type: 'user', timestamp: '2026-07-15T07:00:00.100Z', parentUuid: 'p1', origin: { kind: 'human' }, message: { content: '<local-command-stdout>done</local-command-stdout>' } },
    { type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p2', origin: { kind: 'slash_command' }, message: { content: '<command-name>/alfred-code:setup</command-name>' } },
    { type: 'user', timestamp: '2026-07-15T07:02:00.000Z', parentUuid: 'p3', isCompactSummary: true, message: { content: 'summary' } },
    // no origin at all: the exclusion list is the fallback
    { type: 'user', timestamp: '2026-07-15T07:03:00.000Z', parentUuid: 'p4', message: { content: '<task-notification>agent done</task-notification>' } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.userPrompts, 1, 'prompt count was inflated up to 500% by echoes and siblings');
  assert.strictEqual(main.commandInvocations['alfred-code:setup'], 1, 'the slash command is still stamped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('git acts: a quoted or heredoc mention is prose, a denied commit never ran, a real one counts', () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('q1', 'echo "git commit -m x" >> notes.txt'),
    result('q1'),
    bash('q2', "cat <<'EOF' > plan.md\ngit commit -m y\ngh pr merge 42\nEOF"),
    result('q2'),
    bash('q3', 'git add -A && git commit -m "the real one"'),
    result('q3'),
    bash('q4', 'git commit -m "denied"'),
    result('q4', { is_error: true, content: 'Blocked: no COMMIT-GATE receipt. Do NOT retry this command yet.' }),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.gitCommits, 1, 'quoted, heredoc and denied commits must not count');
  assert.strictEqual(main.prMerges, 0, 'a heredoc gh pr merge is documentation');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doc touches: assignments and globs open no row, rm clears, a heredoc mention is not a write', () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('d1', 'D=.claude/docs/architecture/ARCHITECTURE.md'),
    result('d1'),
    bash('d2', 'cat .claude/docs/architecture/ARCHITECTURE.md'),
    result('d2'),
    bash('d3', 'rm -f .claude/docs/flow/COMMIT-GATE.md'),
    result('d3'),
    bash('d4', "cat <<'EOF' > /dev/null\nsee .claude/docs/architecture/ASSESSMENT.md\nEOF"),
    result('d4'),
    bash('d5', 'ls .claude/docs/*.md; head -5 .claude/docs/PROJECT-CODE-STYLE.md.'),
    result('d5'),
  ]);
  const { main } = run([file]);
  const docs = main.docTouches;
  assert.strictEqual(docs['architecture/ARCHITECTURE.md'].bashReads, 1, 'the cat is the only read; the binding is neither');
  assert.strictEqual(docs['architecture/ARCHITECTURE.md'].bashWrites, undefined);
  assert.strictEqual(docs['flow/COMMIT-GATE.md'].cleared, 1, 'an rm clears a receipt, it does not write one');
  assert.strictEqual(docs['flow/COMMIT-GATE.md'].bashWrites, undefined);
  assert.ok(!('architecture/ASSESSMENT.md' in docs), 'a heredoc body is data, not doc I/O');
  assert.ok(!Object.keys(docs).some((k) => k.includes('*')), 'a glob names no one document');
  assert.strictEqual(docs['PROJECT-CODE-STYLE.md'].bashReads, 1, 'trailing punctuation is not part of the name');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('peak and floor context, and one row per compaction with its dropped tokens', () => {
  const dir = tmp();
  const msg = (id, ts, cr) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage: usage(0, 0, cr, 1), content: [] } });
  const file = fixture(dir, [
    msg('a1', '2026-07-15T07:00:00.000Z', 60000),
    msg('a2', '2026-07-15T07:10:00.000Z', 390000),
    { type: 'system', timestamp: '2026-07-15T07:15:00.000Z', compactMetadata: { trigger: 'auto', preTokens: 390000, postTokens: 12000, durationMs: 122000 } },
    { type: 'user', timestamp: '2026-07-15T07:15:00.100Z', isCompactSummary: true, message: { content: 'summary' } },
    msg('a3', '2026-07-15T07:20:00.000Z', 12000),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.peakCtx, 390000, 'reports that quoted the LAST context understated the peak by 17-43%');
  assert.strictEqual(main.peakCtxAt, '2026-07-15T07:10:00.000Z');
  assert.strictEqual(main.floorCtx, 12000, 'the cold floor is the standing inventory');
  assert.strictEqual(main.compactions, 1);
  assert.deepStrictEqual(main.compactionEvents, [{
    ts: '2026-07-15T07:15:00.000Z', pre: 390000, post: 12000, dropped: 378000, durationMs: 122000, trigger: 'auto',
  }], 'the dropped tokens and the wall clock were read and never printed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cost-state carries the thinking tokens and the model id the transcript strips', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'a1', model: 'claude-opus-5', usage: usage(1, 0, 100, 5), content: [] } },
    { type: 'cost-state', timestamp: '2026-07-15T07:05:00.000Z', totalCostUSD: 4.5, modelUsage: { 'claude-opus-5[1m]': { thinkingTokens: 1000 } } },
    // cumulative and written more than once - the largest wins
    { type: 'cost-state', timestamp: '2026-07-15T07:09:00.000Z', totalCostUSD: 10.42, modelUsage: { 'claude-opus-5[1m]': { thinkingTokens: 2691 }, 'claude-haiku-4-5-20251001': { thinkingTokens: 0 } } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.thinkingTokens, 2691, 'billed thinking is attributable to no message and was never printed');
  assert.deepStrictEqual(main.modelIdsFull, ['claude-opus-5[1m]', 'claude-haiku-4-5-20251001'], 'only cost-state keeps the [1m] suffix the fresh-session threshold keys off');
  assert.strictEqual(main.totalCostUSD, 10.42);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('denials: a Stop-hook string, a colon-less Blocked, and a user DECLINE are three different things', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', isMeta: true, message: { content: 'Stop hook feedback:\n- ["/p/.claude/hooks/guard-stop-contract.js"]: Blocked: the turn ends on a question.' } },
    bash('b1', 'git push origin develop'),
    // the JSON permission-decision route: no colon after Blocked, and no hooks bracket at all
    result('b1', { is_error: true, content: 'Bash operation blocked by hook. Blocked because no PUSH-GATE receipt. Do NOT retry this command yet.' }),
    { type: 'assistant', timestamp: '2026-07-15T07:02:00.000Z', message: { id: 'm-a1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id: 'a1', name: 'AskUserQuestion', input: {} }] } },
    result('a1', { is_error: true, content: "The user doesn't want to proceed with this tool use." }),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.stopHookBlocks, 1, 'a Stop denial is meta user TEXT and was structurally invisible');
  assert.strictEqual(main.toolCalls.Bash.hookBlocks, 1, 'the colon is not part of the denial contract');
  assert.strictEqual(main.toolCalls.Bash.errors, 0, 'a gate working is not a tool failure');
  assert.strictEqual(main.toolCalls.AskUserQuestion.declines, 1, 'a decline is the user answering, not an error');
  assert.strictEqual(main.toolCalls.AskUserQuestion.errors, 0);
  assert.deepStrictEqual(main.denialsByHook, { 'guard-stop-contract.js': 1, '(unattributed)': 1 }, 'the bracket attributes; its absence still counts');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an attachment and a post-compaction cache-write both reach the spike accumulator', () => {
  const dir = tmp();
  const file = fixture(dir, [
    { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'a1', model: 'claude-sonnet-5', usage: usage(0, 0, 1000, 1), content: [] } },
    { type: 'user', timestamp: '2026-07-15T07:00:30.000Z', origin: { kind: 'human' }, attachments: [{ type: 'edited_text_file', content: 'x'.repeat(4000) }], message: { content: 'here it is' } },
    { type: 'assistant', timestamp: '2026-07-15T07:01:00.000Z', message: { id: 'a2', model: 'claude-sonnet-5', usage: usage(0, 0, 51000, 1), content: [] } },
    // after a reset the context DROPS, so the re-cache has a negative delta and was invisible
    { type: 'assistant', timestamp: '2026-07-15T07:10:00.000Z', message: { id: 'a3', model: 'claude-sonnet-5', usage: usage(0, 40000, 0, 1), content: [] } },
  ]);
  const { main } = run([file]);
  const att = main.spikes.find((sp) => sp.ts === '2026-07-15T07:01:00.000Z');
  assert.ok(att && /attachment:edited_text_file/.test(att.causes || ''), 'the largest spike printed as (prompt/attachment only)');
  const cw = main.spikes.find((sp) => sp.kind === 'cache-write');
  assert.ok(cw && cw.delta === 40000, 'a post-compaction re-cache is a cost class of its own');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--hook-blocks reaches --json and the markdown report, with the false-positive caveat', () => {
  const dir = tmp();
  const file = writeFixture(dir);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  // named for the SESSION, which is how the guards write it - a directory is narrowed to the
  // analyzed session's own file, so a neighbour's rows can never land in this tally
  fs.writeFileSync(path.join(blocks, 'session.jsonl'),
    line({ ts: '2026-07-15T07:00:00.000Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'whole-file Read of Big.cs' }) +
    line({ ts: '2026-07-15T07:05:00.000Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Bash', reason: 'cat of Big.cs' }),
  );
  const report = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
  assert.strictEqual(report.hookBlocks.rows, 2);
  assert.strictEqual(report.hookBlocks.byHook['guard-read-whole-file.js'].blocks, 2);
  const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
  assert.ok(md.includes('guard-read-whole-file.js'), 'the ledger was dropped from --report-md entirely');
  assert.ok(/false positive/i.test(md), 'a denial may be a false positive - the old gloss scored every block as a success');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The block detector matched 'Blocked' / 'Do NOT retry' bare, and those are the HARNESS's words
// too. Measured over the 489-transcript audit corpus: 90 real stack blocks (every one carrying the
// PreToolUse guard bracket) against 11 auto-mode-classifier denials, 3 foreground-`sleep` blocks
// and 2 AskUserQuestion schema failures - 16 events charged to guards that never ran, one of them
// surfacing as a phantom `denialsByHook: {"(unattributed)": 1}` in a shipped report.
test('harness denials never count as stack hook blocks, and stay visible as their own number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    const call = (id, name) => ({ type: 'tool_use', id, name, input: {} });
    const result = (id, content, extra = {}) => line({
        type: 'user', timestamp: '2026-07-15T07:00:01.000Z', ...extra,
        message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content }] },
    });
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [call('t1', 'Read'), call('t2', 'Bash'), call('t3', 'Bash'), call('t4', 'AskUserQuestion'), call('t5', 'Write')] } }) +
        // a real one: the PreToolUse bracket is how all 90 corpus blocks arrive
        result('t1', 'PreToolUse:Read hook error: [node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-read-whole-file.js"]: Blocked: whole-file Read of Big.cs (300 lines).') +
        // the auto-mode classifier - carries its own denial kind AND says so in the text
        result('t2', 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier.', { toolDenialKind: 'automode-blocked' }) +
        // the Bash tool's own foreground-sleep block; no stack hook blocks sleep
        result('t3', '<tool_use_error>Blocked: sleep 45 followed by: tail -20 out.log. To wait for a condition, use Monitor.</tool_use_error>') +
        // a tool-schema failure whose own text contains 'Do not retry this call'
        result('t4', '<tool_use_error>InputValidationError: questions.0.options too_small. Do not retry this call and do not invent a filler second option.</tool_use_error>') +
        // the user's own no - already a decline, and it reads as neither
        result('t5', "The user doesn't want to proceed with this tool use.", { toolDenialKind: 'user-rejected' }),
    );
    const { main } = run([file]);
    assert.strictEqual(main.toolCalls.Read.hookBlocks, 1, 'the real guard denial still counts');
    assert.strictEqual(main.toolCalls.Bash.hookBlocks || 0, 0, 'classifier and sleep blocks are not guard denials');
    assert.strictEqual(main.toolCalls.AskUserQuestion.hookBlocks || 0, 0, 'a schema failure is not a guard denial');
    assert.deepStrictEqual(main.denialsByHook, { 'guard-read-whole-file.js': 1 }, 'no phantom (unattributed) row');
    assert.strictEqual(main.harnessDenials, 3, "the three that read as a block are counted as the harness's");
    fs.rmSync(dir, { recursive: true, force: true });
});

// --- the ledger join --------------------------------------------------------------------------
// `hookLog.firstTs - HOOK_LATENCY_MS` on an ISO STRING is NaN, and every `>=` against NaN is
// false, so `inWin` was 0 for every session that had a ledger at all: 107 of the 136 cross-check
// lines in the audit corpus's shipped reports read '0% of tool calls are inside the ledger window'
// while the true coverage of those same sessions ran 8/8, 10/10, 25/25, 50/51, 65/66. Nothing could
// pin it because the function was unreachable - hence the export.
const { hookJoinStats } = require('./analyze-usage.js');

test('hook-ledger join: coverage is computed on parsed epochs, and the latency budget is the measured one', () => {
    const at = (ms) => new Date(Date.parse('2026-07-15T07:00:00.000Z') + ms).toISOString();
    // 8 calls, all inside the ledger's own span; the last one lands 400ms after the final ledger
    // row - inside the measured hook latency (183-497ms), so it is coverage, not a tail.
    const main = {
        file: 'x.jsonl', firstTs: at(0), lastTs: at(10000), clearTs: null,
        toolCallTs: [at(0), at(1000), at(2000), at(3000), at(4000), at(5000), at(6000), at(6400)],
    };
    const hookLog = { rows: 8, firstTs: at(0), lastTs: at(6000) };
    const j = hookJoinStats(main, [], hookLog, { Read: { calls: 8, resultChars: 0, errors: 0, hookBlocks: 0 } });
    assert.strictEqual(j.coverage.inWin, 8, 'every in-window call counts - this was 0 for every session');
    assert.strictEqual(j.coverage.callPct, 100);
    assert.strictEqual(j.coverage.tailCalls, 0, 'a call inside the latency budget is not a tail');
    assert.strictEqual(j.coverage.outside, 0);

    // A call well past the budget IS a tail, and must still be reported as one.
    const late = { ...main, toolCallTs: [...main.toolCallTs, at(20000)], lastTs: at(20000) };
    const j2 = hookJoinStats(late, [], hookLog, { Read: { calls: 9, resultChars: 0, errors: 0, hookBlocks: 0 } });
    assert.strictEqual(j2.coverage.tailCalls, 1, 'a genuinely late call is a tail');
    assert.strictEqual(j2.coverage.inWin, 8);
});

// A DIRECTORY of hook-block ledgers is the PROJECT's shared collection, one file per session.
// Reading all of it charged one session with eight sessions' blocks (measured: 28 reported against
// the session's own 1, which is also what its transcript's hook-blk column says).
test('hook-block ledger: a directory is narrowed to the analyzed session, never merged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const blocks = path.join(dir, 'hook-blocks');
    fs.mkdirSync(blocks);
    const row = (hook) => JSON.stringify({ ts: '2026-07-15T07:00:00.000Z', hook, event: 'PreToolUse', tool: 'Read', reason: 'Blocked: x' }) + '\n';
    fs.writeFileSync(path.join(blocks, 'mine.jsonl'), row('guard-read-whole-file.js'));
    fs.writeFileSync(path.join(blocks, 'someone-else.jsonl'), row('guard-secret-value.js').repeat(9));
    const file = path.join(dir, 'mine.jsonl');
    fs.writeFileSync(file, line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [] } }));

    const { hookBlocks } = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
    assert.strictEqual(hookBlocks.rows, 1, "only this session's ledger is read");
    assert.deepStrictEqual(Object.keys(hookBlocks.byHook), ['guard-read-whole-file.js']);

    // The file may still be passed directly - that bypasses the narrowing entirely.
    const direct = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', path.join(blocks, 'someone-else.jsonl'), '--json'], { encoding: 'utf8' }));
    assert.strictEqual(direct.hookBlocks.rows, 9, 'an explicit file is read as given');
    fs.rmSync(dir, { recursive: true, force: true });
});

// The generated-docs table read one hardcoded spelling on each route: `/.claude/docs/` with
// forward slashes for Read/Write (blank for every Windows project - 4 of the 9 audited) and the
// literal `.claude/docs/` for Bash (so `--docs-root` fixed only half the table).
test('generated docs: both routes honour --docs-root, and a Windows path is not invisible', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: "cat > docs/architecture/ARCHITECTURE.md <<'EOF'\nx\nEOF" } },
            { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: 'C:\\proj\\docs\\architecture\\ASSESSMENT.md' } },
        ] } }) +
        line({ type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }) +
        line({ type: 'user', timestamp: '2026-07-15T07:00:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }));

    const { main } = run([file, '--docs-root', 'docs']);
    assert.strictEqual(main.docTouches['architecture/ARCHITECTURE.md'].bashWrites, 1, 'the Bash route sees the remapped root');
    assert.strictEqual(main.docTouches['architecture/ASSESSMENT.md'].writes, 1, 'a backslash path is the same document');
    fs.rmSync(dir, { recursive: true, force: true });
});

// The exclusion list is only as good as its enumeration: <local-command-caveat> appears 117 times
// in the audit corpus and <fork-boilerplate> once, and each one manufactured a free-text user turn -
// which is exactly what an unheld-stop candidate is built from.
test('user prompts: every harness-injected wrapper is excluded, not just the ones first thought of', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const file = path.join(dir, 'session.jsonl');
    const userText = (txt, ts, uuid) => line({ type: 'user', uuid, timestamp: ts, message: { content: [{ type: 'text', text: txt }] } });
    fs.writeFileSync(file,
        line({ type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } }) +
        userText('<local-command-caveat>the command output is shown below</local-command-caveat>', '2026-07-15T07:00:01.000Z', 'u1') +
        userText('<fork-boilerplate>a fork was started</fork-boilerplate>', '2026-07-15T07:00:02.000Z', 'u2') +
        userText('now fix the parser', '2026-07-15T07:00:03.000Z', 'u3'));
    const { main } = run([file]);
    assert.strictEqual(main.userPrompts, 1, 'only the typed turn is a prompt');
    fs.rmSync(dir, { recursive: true, force: true });
});

// Four report defects the audit filed against the same table set: a companion skill's row read as
// a run that cost nothing, a denial the bracket could not name left as a phantom guard, result
// SIZES with no call beside them, and one reason per hook standing in for several causes.
test('report joins: a folded companion, an unattributed denial, the biggest results and every block reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
    const blocks = path.join(dir, 'hook-blocks');
    fs.mkdirSync(blocks);
    const file = path.join(dir, 'sess.jsonl');
    const at = (i) => `2026-07-15T07:${String(i).padStart(2, '0')}:00.000Z`;
    let body = '';
    // two Skill calls in one turn: the second reads as an in-protocol companion load
    body += line({ type: 'assistant', timestamp: at(1), message: { id: 'm1', model: 'claude-opus-5', usage: usage(1, 0, 900, 20), content: [{ type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'alfred-task-solve' } }] } });
    body += line({ type: 'assistant', timestamp: at(2), attributionSkill: 'alfred-task-solve', message: { id: 'm2', model: 'claude-opus-5', usage: usage(1, 0, 1000, 20), content: [{ type: 'tool_use', id: 's2', name: 'Skill', input: { skill: 'create-ticket' } }] } });
    body += line({ type: 'assistant', timestamp: at(3), attributionSkill: 'alfred-task-solve', message: { id: 'm3', model: 'claude-opus-5', usage: usage(1, 0, 1100, 20), content: [] } });
    // a big Bash result with its own description, and a failing one 30 minutes earlier in the day
    body += line({ type: 'assistant', timestamp: at(4), message: { id: 'm4', model: 'claude-opus-5', usage: usage(1, 0, 1200, 20), content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'cat meta/migrations.json', description: 'read the migrations catalog' } }] } });
    body += line({ type: 'user', timestamp: at(5), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'x'.repeat(5180) }] } });
    body += line({ type: 'assistant', timestamp: at(6), message: { id: 'm5', model: 'claude-opus-5', usage: usage(1, 0, 1300, 20), content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'npm test', description: 'run the suite' } }] } });
    body += line({ type: 'user', timestamp: at(7), message: { content: [{ type: 'tool_result', tool_use_id: 'b2', content: 'boom', is_error: true }] } });
    // a Stop-hook denial with NO bracket - the JSON permission route the report called a phantom
    body += line({ type: 'user', isMeta: true, timestamp: at(8), message: { role: 'user', content: 'Stop hook feedback:\nBlocked: this turn ends on a decision-shaped question in prose.' } });
    fs.writeFileSync(file, body);
    fs.writeFileSync(path.join(blocks, 'sess.jsonl'),
        JSON.stringify({ ts: '2026-07-15T07:08:00.300Z', hook: 'guard-stop-contract.js', event: 'Stop', tool: '', reason: 'Blocked: decision-shaped question', detail: { branch: 'prose-ask', matched: 'your call' } }) + '\n'
        + JSON.stringify({ ts: at(9), hook: 'guard-secret-value.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: Read of /a/settings.json' }) + '\n'
        + JSON.stringify({ ts: at(10), hook: 'guard-secret-value.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: Read of /b/.env' }) + '\n');

    const { main, hookBlocks } = JSON.parse(execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
    // the companion's cost is charged to its parent, and the terminal row says so instead of 0
    assert.strictEqual(main.companionOf['create-ticket'], 'alfred-task-solve', 'the second Skill call in one turn is a companion load');
    const text = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
    assert.match(text, /create-ticket\s+1\s+~\d+\s+folded -> alfred-task-solve/, 'the companion row names where its cost went, never a bare 0');
    // the unattributed denial is joined to the ledger row 300ms away
    assert.match(text, /joined by ledger timestamp \(within 300ms\): guard-stop-contract\.js×1/, 'the phantom guard becomes the one that actually fired');
    // the biggest results carry the call's own label
    assert.match(text, /Bash read the migrations catalog/, 'a result size is printed beside what the call asked for');
    // errors carry their timestamps, so a phase cannot be blamed for another phase's failures
    assert.match(text, /errors, by WHEN they landed/, 'the errors get a when');
    assert.match(text, /07:07:00/, '... naming each one');
    // one row per DISTINCT reason, not one per hook
    const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
    assert.match(md, /\| `guard-secret-value\.js` \| 1 \| PreToolUse \/ Read \| Blocked: Read of \/a\/settings\.json \|/, 'the first file gets its own row');
    assert.match(md, /\| `guard-secret-value\.js` \| 1 \| PreToolUse \/ Read \| Blocked: Read of \/b\/\.env \|/, 'and so does the second - two files are two causes');
    assert.match(md, /\[prose-ask\]/, "the guard's own branch tag rides along with the reason");
    assert.strictEqual(hookBlocks.rows, 3);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('the window tier names its source, and an abandoned session says so', () => {
    const dir = tmp();
    const file = path.join(dir, 'sess.jsonl');
    const at = (i) => `2026-07-16T09:${String(i).padStart(2, '0')}:00.000Z`;
    let body = '';
    // the session's own reminder carries the suffix; cost-state's billing key does NOT
    body += line({ type: 'user', timestamp: at(1), message: { role: 'user', content: 'You are powered by the model named Opus 5. The exact model ID is claude-opus-5[1m].' } });
    body += line({ type: 'assistant', timestamp: at(2), message: { id: 'm1', model: 'claude-opus-5', usage: usage(1, 0, 900, 20), content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls', description: 'list' } }] } });
    body += line({ type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } });
    body += line({ type: 'cost-state', timestamp: at(4), modelUsage: { 'claude-opus-5': { thinkingTokens: 10 } }, totalCostUSD: 0.5 });
    // the last row in the file is the interrupt marker: the run was abandoned, not closed
    body += line({ type: 'user', timestamp: at(5), message: { role: 'user', content: '[Request interrupted by user for tool use]' } });
    fs.writeFileSync(file, body);

    const text = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
    assert.match(text, /model \(with window suffix\) claude-opus-5\[1m\] \(the session's own model reminder\) - cost-state says claude-opus-5/,
        'the reminder answers and the disagreement is printed, never silently resolved');
    assert.match(text, /user interrupts 1 - the session ENDS on one/, 'a session ending on an interrupt is reported as abandoned');
    const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
    assert.match(md, /\*\*Model \(with window suffix\)\*\* claude-opus-5\[1m\]/, 'the markdown report carries the same source line');
    assert.match(md, /\*\*Interrupts\*\* 1 - the session ENDS on one/, '... and the same interrupt line');
    fs.rmSync(dir, { recursive: true, force: true });
});

// A FORK's transcript opens as a copy of its parent's rows, each still carrying the parent's id
// under `session_id` (the camel-case `sessionId` is rewritten to the fork's own): two forks of one conversation shared 90-92 assistant ids with their parent and the
// rollup counted that run three times; the dedupe was done by hand (measured).
// The id is a CANDIDATE parent, never the verdict: `/clear` starts a new session whose rows keep
// the previous session's `session_id`, and reading that as a copied prefix labelled 21 of 115
// audited sessions (329.4M tokens) 'already billed elsewhere' and blanked their scorecards. The
// proof is the MESSAGE - the parent's own transcript holding that assistant message id.
const OWN_SID = '22222222-2222-4222-8222-222222222222';
const PARENT_SID = '11111111-1111-4111-8111-111111111111';
function forkFixture(dir, { parentRows, ownRows, parentFile = true }) {
  const file = path.join(dir, OWN_SID + '.jsonl');
  fs.writeFileSync(file, ownRows.map(line).join(''));
  if (parentFile) fs.writeFileSync(path.join(dir, PARENT_SID + '.jsonl'), parentRows.map(line).join(''));
  return file;
}

test('fork prefix: a real fork shares its parent\'s message ids; a post-/clear session shares only the id', () => {
  const dir = tmp();
  const parentCall = bash('t1', 'echo parent');
  parentCall.message.usage = usage(1, 0, 5000, 1);
  const ownCall = bash('t2', 'echo own');
  ownCall.timestamp = '2026-07-15T07:10:00.000Z';
  // A REAL fork: the copied rows carry the parent's id AND the parent transcript holds `m-t1`.
  const file = forkFixture(dir, {
    parentRows: [{ ...parentCall, sessionId: PARENT_SID, session_id: PARENT_SID }, { ...result('t1'), sessionId: PARENT_SID, session_id: PARENT_SID }],
    ownRows: [
      { ...parentCall, sessionId: OWN_SID, session_id: PARENT_SID },
      { ...result('t1'), sessionId: OWN_SID, session_id: PARENT_SID },
      { ...ownCall, sessionId: OWN_SID, session_id: OWN_SID },
      { ...result('t2'), sessionId: OWN_SID, session_id: OWN_SID, timestamp: '2026-07-15T07:10:01.000Z' },
    ],
  });
  const ledger = path.join(dir, 'tools-usage.jsonl');
  fs.writeFileSync(ledger, line({ ts: '2026-07-15T07:10:00.100Z', tool: 'Bash', detail: 'echo own' }));
  const out = run([file, '--hook-log', ledger]);
  assert.deepStrictEqual(out.main.forkPrefix, { rows: 2, msgs: 1, cacheRead: 5000, cacheCreate: 0, output: 1, toolCalls: 1, sessionIds: [PARENT_SID] });
  assert.strictEqual(out.main.total.msgs, 2, 'the totals still count the whole file');
  assert.strictEqual(out.main.total.cacheRead, 5010);
  const cov = out.hookLog.coverage;
  assert.strictEqual(cov.calls, 1, 'the join sees the tail only');
  assert.strictEqual(cov.inWin, 1);
  assert.strictEqual(cov.outside, 0, "the parent's call is not this ledger's gap");
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fork prefix: a post-/clear session keeps every one of its own rows', () => {
  const dir = tmp();
  // What `/clear` really writes: the caveat wrapper, the command marker, then the session's own
  // work - and EVERY row still carrying the previous session's snake-case id (measured on 9 local
  // transcripts: 51 to 2,300 such rows apiece, 0 message ids shared with the named parent).
  const ownCall = bash('t2', 'npm test');
  ownCall.message.usage = usage(1, 0, 9000, 7);
  const file = forkFixture(dir, {
    parentRows: [{ ...bash('p1', 'echo parent'), sessionId: PARENT_SID, session_id: PARENT_SID }],
    ownRows: [
      { type: 'user', timestamp: '2026-07-15T06:59:58.000Z', sessionId: OWN_SID, session_id: PARENT_SID, isMeta: true, message: { content: '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>' } },
      { type: 'user', timestamp: '2026-07-15T06:59:59.000Z', sessionId: OWN_SID, session_id: PARENT_SID, message: { content: '<command-name>/clear</command-name><command-message>clear</command-message>' } },
      { ...ownCall, sessionId: OWN_SID, session_id: PARENT_SID },
      { ...result('t2'), sessionId: OWN_SID, session_id: PARENT_SID },
    ],
  });
  const { main } = run([file]);
  assert.strictEqual(main.forkPrefix.rows, 0, 'a /clear is not a fork - none of these rows was billed elsewhere');
  assert.strictEqual(main.forkPrefix.msgs, 0);
  assert.deepStrictEqual(main.forkPrefix.sessionIds, []);
  assert.strictEqual(main.total.cacheRead, 9000, 'the session keeps its own cost');
  assert.strictEqual(main.toolCallTs.length, 1, "... and its own tool calls, so the scorecard is not blanked");
  assert.strictEqual(main.efficiency.checks.test.calls, 1, 'the check it ran is still counted');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fork prefix: an unreachable or non-matching parent proves nothing, and a plain file is nobody\'s fork', () => {
  const dir = tmp();
  // Same foreign id, no parent file on this machine: nothing proves the rows are a copy.
  const file = forkFixture(dir, {
    parentRows: [],
    parentFile: false,
    ownRows: [{ ...bash('t1', 'echo x'), sessionId: OWN_SID, session_id: PARENT_SID }, { ...result('t1'), sessionId: OWN_SID, session_id: PARENT_SID }],
  });
  assert.strictEqual(run([file]).main.forkPrefix.msgs, 0, 'an unreachable parent is not evidence');

  // Parent reachable, but it holds different messages - a resumed session, not a copy.
  const dir2 = tmp();
  const file2 = forkFixture(dir2, {
    parentRows: [{ ...bash('other', 'echo elsewhere'), sessionId: PARENT_SID, session_id: PARENT_SID }],
    ownRows: [{ ...bash('t1', 'echo x'), sessionId: OWN_SID, session_id: PARENT_SID }, { ...result('t1'), sessionId: OWN_SID, session_id: PARENT_SID }],
  });
  assert.strictEqual(run([file2]).main.forkPrefix.msgs, 0, 'the parent does not hold this message');

  const plain = fixture(tmp(), [{ ...bash('t1', 'echo'), sessionId: 'not-a-session-id' }, result('t1')]);
  assert.strictEqual(run([plain]).main.forkPrefix.msgs, 0);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

// A call the harness rejects before PreToolUse leaves no ledger row, and a ledger row can have no
// transcript call (an ask the transcript never wrote). A count-based 'unmatched' cancelled the two
// into a false 40 vs 40 (measured): the join now lists each side.
test('hook-log join: unmatched calls and unmatched rows are listed per side, not netted', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo one'), result('t1'), bash('t2', 'echo two'), result('t2')]);
  const ledger = path.join(dir, 'tools-usage.jsonl');
  fs.writeFileSync(ledger, [
    line({ ts: '2026-07-15T07:00:00.100Z', tool: 'Bash', detail: 'echo one' }),
    line({ ts: '2026-07-15T07:00:00.200Z', tool: 'AskUserQuestion', detail: 'q' }),
  ].join(''));
  const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
  assert.strictEqual(cov.unmatched, 0, 'the netted count says all is well');
  assert.strictEqual(cov.matchedCalls, 1);
  assert.strictEqual(cov.unmatchedCallCount, 1, '... one call has no row');
  assert.strictEqual(cov.unmatchedCalls[0].tool, 'Bash');
  assert.strictEqual(cov.unmatchedRowCount, 1, '... and one row has no call');
  assert.strictEqual(cov.unmatchedRows[0].tool, 'AskUserQuestion');
  assert.strictEqual(run([file, '--hook-log', ledger]).hookLog.rowsIdx, undefined, 'the row index stays out of the dump');
});

// The bill sees calls the transcript never records - the harness's post-turn recap call is one -
// so cost-state cache-read exceeded the transcript's by exactly one peak context (694,773 vs
// 590,045, measured) and nothing said so.
test('cost-state cache-read above the transcript is reported as untranscribed calls', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1'),
    { type: 'cost-state', sessionId: 'x', modelUsage: { 'claude-sonnet-5': { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cacheReadInputTokens: 22, cacheCreationInputTokens: 0 } } }]);
  const { main } = run([file]);
  assert.strictEqual(main.costState.cacheRead, 22);
  assert.strictEqual(main.total.cacheRead, 10);
  assert.deepStrictEqual(main.untranscribed, { cacheRead: 12, contexts: 1.1 });
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\*\*Untranscribed calls\*\* cost-state cache-read 22 vs transcript 10 - gap 12/);
});

// The fork-liveness probe writes a mode: probe row into the same ledger the guards block into; a
// probe is a measurement, never a block, and the tally must not read it as one.
test('hook-blocks: a probe row is counted apart from the blocks', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [
    line({ ts: '2026-07-15T07:00:00.500Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: whole-file Read of Big.cs' }),
    line({ ts: '2026-07-15T07:00:01.500Z', hook: 'guard-cross-project-write.js', event: 'PreToolUse', tool: 'Edit', mode: 'probe', kind: 'fork-liveness', reason: 'probe: Edit of a file while a live sibling session' }),
  ].join(''));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.rows, 1, 'one block');
  assert.strictEqual(hookBlocks.probes, 1, 'one probe, apart');
  assert.deepStrictEqual(hookBlocks.probeKinds, { 'fork-liveness': 1 });
  assert.strictEqual(Object.keys(hookBlocks.byHook).length, 1, 'the probe is not a hook block row');
});

test('hook-blocks: every log-only row (any mode) is counted apart from the blocks', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [
    line({ ts: '2026-07-15T07:00:00.500Z', hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'Blocked: whole-file Read of Big.cs' }),
    line({ ts: '2026-07-15T07:00:02.500Z', hook: 'guard-stop-contract.js', event: 'Stop', tool: '', mode: 'skip-tool-end', kind: 'tool-ended-turn', reason: 'skip: the turn ended on a tool call - logged, not judged' }),
  ].join(''));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.rows, 1, 'one block');
  assert.deepStrictEqual(hookBlocks.probeKinds, { 'tool-ended-turn': 1 });
  assert.ok(!hookBlocks.byHook['guard-stop-contract.js'], 'a skip row is not a stop-contract block');
});

// The done gate and the root-cause trigger are LOG-ONLY probes (2026-09-25): guard-stop-contract.js
// writes where each skill was needed, and the analyzer counts what the session did about it.
const tool = (id, name, input, ts) => ({
  type: 'assistant', timestamp: ts || '2026-07-15T07:00:00.000Z',
  message: { id: `m-${id}`, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id, name, input }] },
});
const doneRow = (detail) => line({ ts: '2026-07-15T07:00:05.000Z', hook: 'guard-stop-contract.js', event: 'Stop', tool: '', mode: 'probe', kind: 'done-gate',
  reason: 'probe: a done claim - logged, not held', detail: { claim: 'Fixed', file: 'src/a.js', run: null, skill: false, tests: 'declared', rule: null, outcome: 'unrun', ...detail } });
const redRow = (id, extra) => line({ ts: '2026-07-15T07:00:01.000Z', hook: 'guard-stop-contract.js', event: 'PostToolUseFailure', tool: 'Bash', mode: 'probe', kind: 'root-cause',
  reason: 'probe: a red npm test run - logged, nothing injected', detail: { run: 'npm test', key: 'npm test', tool_use_id: id, agent: null, agent_type: null, ...(extra || {}) } });

// R3 (ECC comparison): guard-answer-length.js writes one `kind: correction` probe row per correction
// turn, `injected` when ALFRED_CODE_CORRECTION_NUDGE=inject handed the save line back.
test('hook-blocks: correction probe rows are counted, split by whether the save line was injected', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  const corr = (injected, marker) => line({ ts: '2026-07-15T07:00:03.000Z', hook: 'guard-answer-length.js', event: 'UserPromptSubmit', tool: '', mode: 'probe', kind: 'correction',
    injected, reason: 'probe: a correction turn - logged, nothing injected', detail: { marker, chars: 20 } });
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [corr(false, 'no'), corr(false, 'I meant'), corr(true, 'shorter')].join(''));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.deepStrictEqual(hookBlocks.correction, { turns: 3, injected: 1 });
  assert.strictEqual(hookBlocks.rows, 0, 'a probe is never a block');
  const text = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
  assert.match(text, /CORRECTION NUDGE \(probe\): 3 correction turn\(s\) - 1 with the save line injected, 2 logged only/);
  const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| correction nudge \| 3 \| 1 \| 2 \|/);
  const roll = JSON.parse(execFileSync('node', [SCRIPT, dir, '--hook-blocks', blocks, '--json'], { encoding: 'utf8' }));
  assert.deepStrictEqual(roll.probes.correction, { turns: 3, injected: 1 }, 'the rollup sums the corpus');
});

test('hook-blocks: done-gate probe rows split into ran, and unrun by rule, no tests, skill loaded and missed', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo'), result('t1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [
    doneRow({ outcome: 'ran', run: 'npm test' }),
    doneRow({ rule: 'CLAUDE.md: - Do not run the tests: they need the staging database.' }),
    doneRow({ rule: 'AGENTS.md: Tests must not be run by the agent.', tests: 'none-found' }),
    doneRow({ tests: 'none-found' }),
    doneRow({ skill: true }),
    doneRow({}),
    doneRow({ run: 'npm test' }),
  ].join(''));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.deepStrictEqual(hookBlocks.doneGate, { claims: 7, ran: 1, unrun: 6, byRule: 2, noTests: 1, skillLoaded: 1, inContext: 0, missed: 2 },
    'exclusive buckets, a rule first, then no tests, then a loaded skill, then one loaded earlier');
  assert.strictEqual(hookBlocks.rows, 0, 'a probe is never a block');
  const text = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
  assert.match(text, /DONE GATE \(probe\): 7 done claim\(s\) over an edit - 1 ran after the edit, 6 unrun: 2 excused by a rule, 1 with no tests found, 1 with the skill loaded, 0 with it loaded earlier, 2 MISSED/);
  const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| done gate \| 7 \| 1 \| 2 \| 1 \| 1 \| 0 \| 2 \|/);
});

test('hook-blocks: a root-cause probe is resolved against the transcript after the red run', () => {
  const dir = tmp();
  const red = { content: 'Exit code 1\nnot ok 1', is_error: true };
  // main: an edit before the load (after-fix), then a second streak with the skill already in context
  const file = fixture(dir, [
    tool('t1', 'Bash', { command: 'npm test' }), result('t1', red),
    tool('t2', 'Edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'b' }), result('t2'),
    tool('t3', 'Skill', { skill: 'alfred-habits-root-cause' }), result('t3'),
    tool('t4', 'Bash', { command: 'dotnet build' }), result('t4', red),
    tool('t5', 'Edit', { file_path: 'src/b.cs', old_string: 'a', new_string: 'b' }), result('t5'),
  ]);
  const sub = path.join(dir, 'session', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const agent = (name, records) => fs.writeFileSync(path.join(sub, `agent-${name}.jsonl`), records.map(line).join(''));
  // a shell fix with no load: missed
  agent('a1', [tool('s1', 'Bash', { command: 'npm test' }), result('s1', red), tool('s2', 'Bash', { command: "sed -i 's/x/y/' src/b.js" }), result('s2')]);
  // a prose edit and a read, then nothing: no fix followed
  agent('a2', [tool('u1', 'Bash', { command: 'npm test' }), result('u1', red), tool('u2', 'Edit', { file_path: 'README.md', old_string: 'a', new_string: 'b' }), result('u2'),
    tool('u3', 'Read', { file_path: 'src/a.js' }), result('u3')]);
  // a seat whose definition preloads the skill
  agent('a3', [tool('v1', 'Bash', { command: 'dotnet test' }), result('v1', red), tool('v2', 'Edit', { file_path: 'src/c.cs', old_string: 'a', new_string: 'b' }), result('v2')]);
  // the skill loaded before the fix
  agent('a4', [tool('x1', 'Bash', { command: 'npm test' }), result('x1', red), tool('x2', 'Skill', { skill: 'alfred-code:alfred-habits-root-cause' }), result('x2'),
    tool('x3', 'Edit', { file_path: 'src/d.js', old_string: 'a', new_string: 'b' }), result('x3')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), [
    redRow('t1'), redRow('t4'), redRow('s1', { agent: 'a1' }), redRow('u1', { agent: 'a2' }),
    redRow('v1', { agent: 'a3', agent_type: 'alfred-code:dotnet-test-failure-resolver' }), redRow('x1', { agent: 'a4' }), redRow('nope'),
  ].join(''));
  // a scratch write under /tmp is no fix: the red run with only that after it had no fix
  agent('a5', [tool('y1', 'Bash', { command: 'npm test' }), result('y1', red), tool('y2', 'Write', { file_path: '/tmp/probe.js', content: '1' }), result('y2')]);
  fs.appendFileSync(path.join(blocks, 'session.jsonl'), redRow('y1', { agent: 'a5' }));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.deepStrictEqual(hookBlocks.rootCause, { streaks: 8, beforeFix: 1, inContext: 1, preloaded: 1, afterFix: 1, missed: 1, noFix: 2, unmatched: 1 });
  const text = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
  assert.match(text, /ROOT CAUSE \(probe\): 8 red streak\(s\) - 1 loaded before the fix, 1 already in context, 1 preloaded by the seat, 1 loaded after the fix, 1 MISSED, 2 with no fix after, 1 unmatched/);
});

test('hook-blocks: a fix is judged against the session\'s own cwd - inside it counts wherever it lives, outside it is scratch', () => {
  const dir = tmp();
  const red = { content: 'Exit code 1', is_error: true };
  const proj = path.join('/private/tmp', 'proj-under-tmp');
  const at = (r) => ({ ...r, cwd: proj });
  const file = fixture(dir, [
    at(tool('a1', 'Bash', { command: 'npm test' })), at(result('a1', red)),
    at(tool('a2', 'Write', { file_path: path.join(os.homedir(), 'elsewhere', 'probe.js'), content: '1' })), at(result('a2')),
    at(tool('a3', 'Skill', { skill: 'alfred-habits-root-cause' })), at(result('a3')),
    at(tool('a4', 'Edit', { file_path: path.join(proj, 'src', 'a.js'), old_string: 'a', new_string: 'b' })), at(result('a4')),
  ]);
  const sub = path.join(dir, 'session', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-b.jsonl'), [at(tool('b1', 'Bash', { command: 'npm test' })), at(result('b1', red)),
    at(tool('b2', 'Edit', { file_path: path.join(proj, 'src', 'b.js'), old_string: 'a', new_string: 'b' })), at(result('b2'))].map(line).join(''));
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), redRow('a1') + redRow('b1', { agent: 'b' }));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.rootCause.beforeFix, 1, 'a write outside the cwd is scratch, so the load came before the fix');
  assert.strictEqual(hookBlocks.rootCause.missed, 1, 'a project file under /private/tmp is still the fix');
});

// Review I7: a done-gate skill loaded in an EARLIER turn is in context, not a trigger that failed.
test('hook-blocks: an unrun claim whose session loaded the done-gate skill earlier is counted in context, not missed', () => {
  const dir = tmp();
  const file = fixture(dir, [tool('k1', 'Skill', { skill: 'alfred-code:alfred-habits-done-gate' }, '2026-07-15T06:00:00.000Z'), result('k1')]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), doneRow({}) + line({ ...JSON.parse(doneRow({})), ts: '2026-07-15T05:00:00.000Z' }));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.doneGate.inContext, 1, 'the claim after the load');
  assert.strictEqual(hookBlocks.doneGate.missed, 1, 'the claim before it');
});

// Review I5: a write the shell aims elsewhere through a cd or a variable, a denied edit, and a failed
// Skill call change nothing - none of them is a fix or a load.
test('hook-blocks: a shell write outside the cwd through a cd or a variable, a denied edit and a failed load are neither fix nor load', () => {
  const dir = tmp();
  const red = { content: 'Exit code 1', is_error: true };
  const proj = path.join(os.homedir(), 'proj-x');
  const at = (r) => ({ ...r, cwd: proj });
  const file = fixture(dir, [
    at(tool('c1', 'Bash', { command: 'npm test' })), at(result('c1', red)),
    at(tool('c2', 'Bash', { command: "cd /tmp/x && cat > p.js <<'EOF'\n1\nEOF" })), at(result('c2')),
    at(tool('c3', 'Bash', { command: 'echo 1 > "$TMPDIR/p.js"' })), at(result('c3')),
    at(tool('c4', 'Edit', { file_path: path.join(proj, 'src', 'a.js'), old_string: 'a', new_string: 'b' })), at(result('c4', { content: 'Edit operation blocked by hook', is_error: true })),
    at(tool('c5', 'Skill', { skill: 'alfred-habits-root-cause' })), at(result('c5', { content: 'Unknown skill', is_error: true })),
  ]);
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'), redRow('c1'));
  const { hookBlocks } = run([file, '--hook-blocks', blocks]);
  assert.strictEqual(hookBlocks.rootCause.noFix, 1, JSON.stringify(hookBlocks.rootCause));
});

test('hook-blocks: directory mode sums the probe rows of each session it reads, and no one else\'s', () => {
  const dir = tmp();
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  for (const [sid, rows] of [['s-one', [doneRow({}), doneRow({ outcome: 'ran' })]], ['s-two', [doneRow({ tests: 'none-found' })]]]) {
    fs.writeFileSync(path.join(dir, `${sid}.jsonl`), [bash('t1', 'echo'), result('t1')].map(line).join(''));
    fs.writeFileSync(path.join(blocks, `${sid}.jsonl`), rows.join(''));
  }
  fs.writeFileSync(path.join(blocks, 's-other.jsonl'), doneRow({}));
  const out = run([dir, '--hook-blocks', blocks]);
  assert.deepStrictEqual(out.probes.doneGate, { claims: 3, ran: 1, unrun: 2, byRule: 0, noTests: 1, skillLoaded: 0, inContext: 0, missed: 1 });
  assert.deepStrictEqual(out.probes.rootCause, { streaks: 0, beforeFix: 0, inContext: 0, preloaded: 0, afterFix: 0, missed: 0, noFix: 0, unmatched: 0 });
  const text = execFileSync('node', [SCRIPT, dir, '--hook-blocks', blocks], { encoding: 'utf8' });
  assert.match(text, /DONE GATE \(probe\): 3 done claim\(s\)/);
  assert.ok(!('probes' in run([dir])), 'no --hook-blocks, no probe tally');
});

// ---------- the efficiency scorecard ----------
// Each row is a measured practice with a denominator; these pin the classifiers on synthetic
// transcripts so a regex drift cannot silently move a rate the observation week is read from.

const scAsst = (id, ts, u, content, extra = {}) => line({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage: u, content, ...extra } });
const scHuman = (ts, text) => line({ type: 'user', timestamp: ts, message: { content: text } });
const toolRes = (ts, id, text, isError) => line({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }] } });
const scBash = (id, cmd) => ({ type: 'tool_use', id, name: 'Bash', input: { command: cmd } });
const scRead = (id, file) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: file } });
const scT = (n) => `2026-07-15T07:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;

test("scorecard: a cache miss uses Claude Code's own rule, and the first request after a compaction is an expected rebuild", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    scAsst('m1', scT(0), usage(10, 100000, 0, 5), []) +
    scAsst('m2', scT(1), usage(10, 500, 100000, 5), []) +          // read everything m1 cached: continuous
    scAsst('m3', scT(2), usage(10, 90000, 20000, 5), []) +         // re-processed 80.5k of 100.5k: a MISS
    line({ type: 'system', timestamp: scT(3), compactMetadata: { trigger: 'auto', preTokens: 110000, postTokens: 30000 } }) +
    line({ type: 'user', timestamp: scT(3), isCompactSummary: true, message: { content: 'summary' } }) +
    scAsst('m4', scT(4), usage(10, 30000, 0, 5), []) +             // the rebuild after the compaction: EXPECTED
    scAsst('m5', scT(5), usage(10, 100, 30000, 5), []),            // continuous again
  );
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.cacheMisses, 1);
  assert.strictEqual(e.cacheMissTokens, 90000);
  assert.strictEqual(e.cacheMissAt[0].reprocessed, 80500);
  assert.strictEqual(e.expectedRebuilds, 1);
  assert.strictEqual(e.expectedRebuildTokens, 30000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: build-dir reads and post-compaction re-reads are counted on both routes, once per file per compaction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    scAsst('m1', scT(0), usage(1, 0, 100, 5), [scRead('t1', 'src/a.cs'), scRead('t2', 'node_modules/x/index.js'), scBash('t3', 'cat dist/main.js'), scBash('t4', "sed -n '1,20p' src/b.cs")]) +
    toolRes(scT(1), 't1', 'a'.repeat(400)) + toolRes(scT(1), 't2', 'b'.repeat(800)) + toolRes(scT(1), 't3', 'c'.repeat(200)) + toolRes(scT(1), 't4', 'd'.repeat(100)) +
    line({ type: 'system', timestamp: scT(2), compactMetadata: { trigger: 'auto' } }) +
    line({ type: 'user', timestamp: scT(2), isCompactSummary: true, message: { content: 'summary' } }) +
    scAsst('m2', scT(3), usage(1, 0, 100, 5), [scRead('t5', 'src/a.cs'), scRead('t6', 'src/c.cs'), scBash('t7', 'head -n 5 src/b.cs'), scRead('t8', 'src/a.cs')]) +
    toolRes(scT(4), 't5', 'a'.repeat(400)) + toolRes(scT(4), 't6', 'e'.repeat(300)) + toolRes(scT(4), 't7', 'd'.repeat(50)) + toolRes(scT(4), 't8', 'a'.repeat(400)),
  );
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.buildDirReads.calls, 2, 'the Read and the cat under a build dir');
  assert.strictEqual(e.buildDirReads.chars, 1000);
  assert.strictEqual(e.buildDirReads.paths['node_modules/x/index.js'], 800);
  assert.deepStrictEqual(e.compactionRereads, [{ ts: scT(2), candidates: 4, files: 2, chars: 450 }], 'a.cs once (its second post-compaction read is not a second re-read), b.cs via head');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: test runs split scoped from whole-suite, and a commit is checked only when a check sat within the window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  let body = '';
  body += scAsst('m1', scT(0), usage(1, 0, 100, 5), [scBash('c1', 'dotnet test --filter FullyQualifiedName~Foo'), scBash('c2', 'dotnet test'), scBash('c3', 'npm run build')]);
  body += toolRes(scT(1), 'c1', 'x'.repeat(300)) + toolRes(scT(1), 'c2', 'y'.repeat(5000)) + toolRes(scT(1), 'c3', 'z'.repeat(100));
  body += scAsst('m2', scT(2), usage(1, 0, 100, 5), [scBash('g1', 'git commit -m first')]) + toolRes(scT(3), 'g1', '[main abc] first');
  // 45 unrelated calls push the last check out of the 40-call window
  const filler = []; for (let i = 0; i < 45; i++) filler.push(scBash(`f${i}`, `echo ${i}`));
  body += scAsst('m3', scT(4), usage(1, 0, 100, 5), filler);
  for (let i = 0; i < 45; i++) body += toolRes(scT(5), `f${i}`, String(i));
  body += scAsst('m4', scT(6), usage(1, 0, 100, 5), [scBash('g2', 'git commit -m second')]) + toolRes(scT(7), 'g2', '[main def] second');
  // the check and the commit in ONE call: checked
  body += scAsst('m5', scT(8), usage(1, 0, 100, 5), [scBash('g3', 'npm test -- src/a.spec.ts && git commit -m third')]) + toolRes(scT(9), 'g3', '12 passed\n[main ghi] third');
  fs.writeFileSync(file, body);
  const { main } = run([file]);
  const e = main.efficiency;
  assert.deepStrictEqual(e.checks.test, { calls: 3, chars: 300 + 5000 + '12 passed\n[main ghi] third'.length, scoped: 2, whole: 1 });
  assert.strictEqual(e.checks.build.calls, 1);
  assert.strictEqual(main.gitCommits, 3);
  assert.strictEqual(e.commitsChecked, 2);
  assert.deepStrictEqual(e.commitsUnchecked, [scT(6)]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: a green claim with no check in its turn is listed, a checked or negated one is not; long answers and correction streaks count as the hook would', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  const endTurn = (id, ts, text) => scAsst(id, ts, usage(1, 0, 100, 5), [{ type: 'text', text }], { stop_reason: 'end_turn' });
  let body = '';
  body += scHuman(scT(0), 'do it');
  body += endTurn('m1', scT(1), 'Done. All tests pass now.');                       // no check this turn: UNVERIFIED
  body += scHuman(scT(2), 'ok');
  body += scAsst('m2', scT(3), usage(1, 0, 100, 5), [scBash('c1', 'npm test')]) + toolRes(scT(4), 'c1', '12 passed');
  body += endTurn('m3', scT(5), 'Tests pass, 12/12.');                              // the turn ran the check
  body += scHuman(scT(6), 'and?');
  body += endTurn('m4', scT(7), 'The tests do not pass yet - two failures remain.'); // negated: not a claim
  body += scHuman(scT(8), 'more');
  body += endTurn('m5', scT(9), 'word '.repeat(420));                              // 2,099 chars of prose: LONG
  // a correction streak: three short turns, each after a 1,500+ char answer
  for (let i = 0; i < 4; i++) {
    body += endTurn(`L${i}`, scT(10 + 2 * i), 'prose '.repeat(280));
    body += scHuman(scT(11 + 2 * i), 'no, shorter');
  }
  fs.writeFileSync(file, body);
  const { main } = run([file]);
  const e = main.efficiency;
  assert.strictEqual(e.greenClaims, 2);
  assert.deepStrictEqual(e.unverifiedGreenClaims, [scT(1)]);
  assert.strictEqual(e.longAnswers, 1, 'the 2,099-char answer; the four 1,680-char streak answers sit under the 1,800 cap');
  assert.strictEqual(e.correctionTurns, 4, 'every short turn after a merged 1,500+ char answer');
  assert.strictEqual(e.longAnswered, 4);
  assert.strictEqual(e.finalAnswers, 8);
  assert.deepStrictEqual(e.correctionStreaks, [scT(15)], 'recorded once, at the third short turn, not again at the fourth');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The single-turn test is guard-answer-length.js's own (the pinned copy): a short turn that follows an
// answer of ANY length and carries a correction marker. A status question after a long answer is no
// correction any more; a correction after a short answer now counts.
test('scorecard: corrections are the hook\'s marker test, not a short turn after a long answer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const endTurn = (id, ts, text) => scAsst(id, ts, usage(1, 0, 100, 5), [{ type: 'text', text }], { stop_reason: 'end_turn' });
  let a = scHuman(scT(0), 'write it') + endTurn('a1', scT(1), 'prose '.repeat(280)) + scHuman(scT(2), 'how much time is left?');
  a += endTurn('a2', scT(3), 'About ten minutes.') + scHuman(scT(4), 'I meant the CI pipeline');
  a += endTurn('a3', scT(5), 'Switched to the CI pipeline.') + scHuman(scT(6), 'Are you still running?') + endTurn('a4', scT(7), 'No.');
  const fa = path.join(dir, 'a.jsonl');
  fs.writeFileSync(fa, a);
  const ea = run([fa]).main.efficiency;
  assert.strictEqual(ea.correctionTurns, 1, 'the streak view still counts the short turn after the long answer');
  assert.strictEqual(ea.correctionsSaved, 0);
  assert.deepStrictEqual(ea.correctionsUnsaved, [scT(4)], 'only the marked turn is a correction');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: a correction is saved when a memory store follows within three replies, and unsaved otherwise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const endTurn = (id, ts, text) => scAsst(id, ts, usage(1, 0, 100, 5), [{ type: 'text', text }], { stop_reason: 'end_turn' });
  const store = (id, ts, name = 'mcp__plugin_memory_memory__memory_store') => scAsst(id, ts, usage(1, 0, 100, 5), [{ type: 'tool_use', id: `t${id}`, name, input: { content: 'a lesson' } }]) + toolRes(ts, `t${id}`, 'stored');
  const long = 'prose '.repeat(280);
  // Transcript A, hand-counted: correction 1 saved in the first reply; correction 2 saved in the
  // THIRD reply (still inside the window); correction 3 never saved over three replies.
  let a = scHuman(scT(0), 'write it') + endTurn('a1', scT(1), long) + scHuman(scT(2), 'no, shorter');
  a += store('a2', scT(3)) + endTurn('a3', scT(4), 'Saved, shorter now.');
  a += scHuman(scT(5), 'next') + endTurn('a4', scT(6), long) + scHuman(scT(7), 'wrong again');
  a += endTurn('a5', scT(8), 'Fixed.') + scHuman(scT(9), 'hm') + endTurn('a6', scT(10), 'Yes.') + scHuman(scT(11), 'ok');
  a += store('a7', scT(12)) + endTurn('a8', scT(13), 'Noted.');
  a += scHuman(scT(14), 'more') + endTurn('a9', scT(15), long) + scHuman(scT(16), 'no');
  a += endTurn('a10', scT(17), 'Right.') + scHuman(scT(18), 'x') + endTurn('a11', scT(19), 'Sure.') + scHuman(scT(20), 'y') + endTurn('a12', scT(21), 'Fine.');
  a += scHuman(scT(22), 'z') + store('a13', scT(23)) + endTurn('a14', scT(24), 'Late save.');
  // Transcript B: a save through the registration route's bare name counts (joined here, so the
  // shipped-name sweep of lint check 54 never reads it as a tool this repo ships); a correction the
  // session ended on, with no reply saving it, is unsaved.
  const bareStore = ['mcp', 'memory', 'memory_store'].join('__');
  let b = scHuman(scT(30), 'go') + endTurn('b1', scT(31), long) + scHuman(scT(32), 'not that');
  b += store('b2', scT(33), bareStore) + endTurn('b3', scT(34), 'Stored.');
  b += scHuman(scT(35), 'again') + endTurn('b4', scT(36), long) + scHuman(scT(37), 'still wrong');
  const fa = path.join(dir, 'a.jsonl');
  const fb = path.join(dir, 'b.jsonl');
  fs.writeFileSync(fa, a);
  fs.writeFileSync(fb, b);
  const ea = run([fa]).main.efficiency;
  assert.strictEqual(ea.correctionTurns, 3);
  assert.strictEqual(ea.correctionsSaved, 2);
  assert.deepStrictEqual(ea.correctionsUnsaved, [scT(16)]);
  const eb = run([fb]).main.efficiency;
  assert.strictEqual(eb.correctionTurns, 2);
  assert.strictEqual(eb.correctionsSaved, 1);
  assert.deepStrictEqual(eb.correctionsUnsaved, [scT(37)]);
  const md = execFileSync('node', [SCRIPT, fa, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /corrections saved to memory.*2 of 3 correction\(s\) saved within 3 replies; 1 unsaved \(33%\)/);
  // Over the run: the rollup carries each session's pair and the total the S2.2 threshold reads.
  const roll = run([dir]);
  const bySession = Object.fromEntries(roll.sessions.map((x) => [x.session, x.corrections]));
  assert.deepStrictEqual(bySession, { a: { saved: 2, total: 3 }, b: { saved: 1, total: 2 } });
  assert.deepStrictEqual(roll.corrections, { saved: 3, total: 5 });
  const rtxt = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(rtxt, /corr-saved/);
  assert.match(rtxt, /^\s+a\s.*\s2\/3\s*$/m);
  assert.match(rtxt, /^\s+TOTAL\s.*\s3\/5\s*$/m);
  assert.match(rtxt, /^corrections saved to memory over 2 sessions: 3 of 5; 2 unsaved \(40%\)$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: dispatch overhead flags a seat whose input was mostly its own first-message context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, scAsst('m1', scT(0), usage(1, 0, 100, 5), []));
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'),
    scAsst('a1', scT(1), usage(0, 0, 50000, 10), []) + scAsst('a2', scT(2), usage(0, 2000, 50000, 10), []));
  fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'aspnet-implementer' }));
  fs.writeFileSync(path.join(sub, 'agent-b1.jsonl'),
    scAsst('b1', scT(3), usage(0, 0, 10000, 10), []) + scAsst('b2', scT(4), usage(0, 40000, 10000, 10), []) + scAsst('b3', scT(5), usage(0, 0, 50000, 10), []));
  fs.writeFileSync(path.join(sub, 'agent-b1.meta.json'), JSON.stringify({ agentType: 'evidence-gatherer' }));
  const { dispatchOverhead: d } = run([file]);
  assert.strictEqual(d.seats, 2);
  assert.strictEqual(d.heavy, 1);
  assert.deepStrictEqual(d.heavySeats, [{ type: 'aspnet-implementer', msgs: 2, floor: 50000, share: 98 }]);
  assert.strictEqual(d.preloadTokens, 130000);
  assert.strictEqual(d.seatInputTokens, 212000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scorecard: the markdown skeleton carries the scorecard table and the efficiency verdict fill-in; the text report carries the block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-'));
  const file = writeFixture(dir);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /## Efficiency scorecard/);
  assert.match(md, /\| cache continuity \| 0 miss\(es\)/);
  assert.match(md, /\| long answers \| 0 of 0 final answer/);
  assert.ok(md.indexOf('## Efficiency verdict - FILL IN') < md.indexOf('## Verdict - FILL IN'), 'the efficiency verdict precedes the skill verdict');
  assert.match(md, /TOKEN VERDICT/);
  assert.match(md, /EFFECTIVENESS/);
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /\nEFFICIENCY \(/);
  assert.match(txt, /checked commits\s+no commit/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- INVENTORY vs USE: the complement the report never had ---
// The analyzer counted consumption and never what was installed and never touched, so
// 'unused in this corpus' was an ad-hoc script every time it was asked. These fixtures pin
// one detection branch per layer plus the unused complement.

// A synthetic install: two skills reached three different ways, one never; an agent whose
// frontmatter PRELOADS a skill; an always-on rule, a path-scoped rule with a glob the session
// matches, one named only by the shell-route notice, and one nothing touches.
function writeInventory(root) {
  const claude = path.join(root, '.claude');
  const mk = (p) => fs.mkdirSync(p, { recursive: true });
  mk(path.join(claude, 'skills'));
  mk(path.join(claude, 'agents'));
  mk(path.join(claude, 'rules'));
  for (const s of ['alpha-skill', 'beta-skill', 'gamma-skill', 'delta-skill']) {
    mk(path.join(claude, 'skills', s));
    fs.writeFileSync(path.join(claude, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: "fixture"\n---\n\nbody\n`);
  }
  fs.writeFileSync(path.join(claude, 'agents', 'demo-implementer.md'),
    '---\nname: demo-implementer\ndescription: fixture seat\nmodel: sonnet\nskills:\n  - gamma-skill\n  - demo-plugin:preloaded-helper\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'agents', 'unused-agent.md'), '---\nname: unused-agent\ndescription: never dispatched\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'baseline-demo.md'), '---\ndescription: always-on, no paths\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'demo-conventions.md'), '---\npaths: ["**/*.cs"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'shell-only-conventions.md'), '---\npaths: ["**/*.sql"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'other-conventions.md'), '---\npaths: ["**/*.{ts,tsx}"]\n---\n\nbody\n');
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {}, context7: {} } }));
  const pluginsFile = path.join(root, 'installed_plugins.json');
  fs.writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: { 'demo-plugin@market': [{ scope: 'user' }], 'typescript-lsp@market': [{ scope: 'user' }], 'hooks-only-plugin@market': [{ scope: 'user' }] } }));
  return { claude, pluginsFile };
}

const invAsst = (id, ts, content) => ({
  type: 'assistant', timestamp: ts,
  message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content },
});
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });

function writeInventoryTranscript(dir, root, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [
    // the transcript's own cwd - the machine that ran it. Present so the resolution is exercised.
    line({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: root, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'do the thing' } }),
    line(invAsst('m1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'alpha-skill' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    // the slash route - a skill invoked as a command emits no Skill event at all
    line({ type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p2', origin: { kind: 'slash_command' }, message: { content: '<command-name>/beta-skill</command-name>' } }),
    // a harness command must NOT open a skill row
    line({ type: 'user', timestamp: '2026-07-15T07:01:01.000Z', parentUuid: 'p3', origin: { kind: 'slash_command' }, message: { content: '<command-name>/model</command-name>' } }),
    line(invAsst('m2', '2026-07-15T07:02:00.000Z', [use('t2', 'Task', { subagent_type: 'demo-implementer', description: 'build one task' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:02:30.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'done' }] } }),
    // a governed file touched through a file tool - the glob proxy's input
    line(invAsst('m3', '2026-07-15T07:03:00.000Z', [use('t3', 'Edit', { file_path: `${root}/src/Foo.cs`, old_string: 'a', new_string: 'b' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:03:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } }),
    // the DIRECT attach record the harness writes when it loads the rule
    line({ type: 'attachment', timestamp: '2026-07-15T07:03:02.000Z', attachment: { type: 'nested_memory', path: `${root}/.claude/rules/demo-conventions.md`, displayPath: '.claude/rules/demo-conventions.md', content: { type: 'Project', content: 'body' } } }),
    // guard-read-whole-file's shell-route reminder names its rule, and nothing else does
    line({ type: 'attachment', timestamp: '2026-07-15T07:03:03.000Z', attachment: { type: 'hook_additional_context', hookName: 'guard-read-whole-file.js', content: ['This command touches files governed by `.claude/rules/shell-only-conventions.md`. Read the rule.'] } }),
    line(invAsst('m4', '2026-07-15T07:04:00.000Z', [use('t4', 'mcp__plugin_serena_serena__find_symbol', { name_path: 'Foo' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:04:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'sym' }] } }),
    line(invAsst('m5', '2026-07-15T07:05:00.000Z', [use('t5', 'LSP', { method: 'definition' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:05:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't5', content: 'def' }] } }),
    // a plugin skill: the namespace is the plugin layer's evidence, and the skill row is observed
    line(invAsst('m6', '2026-07-15T07:06:00.000Z', [use('t6', 'Skill', { skill: 'demo-plugin:helper' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:06:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't6', content: 'ok' }] } }),
  ].join(''));
  return file;
}

const invRow = (rows, name) => rows.find((r) => r.name === name);

test('inventory vs use: every layer scores what was used, HOW it was observed, and what never was', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const file = writeInventoryTranscript(dir, root, 'session.jsonl');
  const { inventory } = run([file, '--inventory', claude, '--plugins', pluginsFile]);

  // --- skills: three routes in, three different columns
  assert.deepStrictEqual(invRow(inventory.skills, 'alpha-skill').how, ['Skill call x1'], 'the Skill tool');
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').firstUse, '2026-07-15T07:00:10.000Z');
  assert.deepStrictEqual(invRow(inventory.skills, 'beta-skill').how, ['slash command x1'], 'the slash route emits no Skill event');
  assert.deepStrictEqual(invRow(inventory.skills, 'gamma-skill').how, ['preloaded via demo-implementer x1'],
    "a seat's frontmatter preload is paid for in full and shows zero calls - its own column, never the caller's");
  assert.strictEqual(invRow(inventory.skills, 'delta-skill').used, 'no');
  assert.strictEqual(invRow(inventory.skills, 'model'), undefined, '/model is the harness, not a skill');
  assert.strictEqual(invRow(inventory.skills, 'demo-plugin:helper').source, 'observed', 'a plugin skill is used but not in the project inventory');
  assert.deepStrictEqual(invRow(inventory.skills, 'demo-plugin:preloaded-helper').how, ['preloaded via demo-implementer x1']);

  // --- agents
  assert.deepStrictEqual(invRow(inventory.agents, 'demo-implementer').how, ['dispatched x1']);
  assert.strictEqual(invRow(inventory.agents, 'unused-agent').used, 'no');

  // --- rules: always-on is not a question a transcript can answer; the rest have two direct
  // records and a glob proxy under them
  assert.strictEqual(invRow(inventory.rules, 'baseline-demo.md').used, 'not observable');
  assert.deepStrictEqual(invRow(inventory.rules, 'demo-conventions.md').how.sort(),
    ['attached (transcript record) x1', 'glob proxy x1'], 'the attach record AND the proxy, never one instead of the other');
  assert.deepStrictEqual(invRow(inventory.rules, 'shell-only-conventions.md').how, ['shell-route notice x1'],
    'the shell route attaches no rule, so the guard notice is the only record there is');
  assert.strictEqual(invRow(inventory.rules, 'other-conventions.md').used, 'no');

  // --- plugins: a namespace, an LSP call, and one that ships only hooks and left no hook row
  assert.deepStrictEqual(invRow(inventory.plugins, 'demo-plugin').how.sort(), ['namespaced skill/command x1', 'preloaded skill x1'],
    "a plugin skill named in a seat's preload list is that plugin's body entering the seat, on its own evidence line");
  assert.deepStrictEqual(invRow(inventory.plugins, 'typescript-lsp').how, ['LSP call x1']);
  assert.strictEqual(invRow(inventory.plugins, 'hooks-only-plugin').used, 'no');

  // --- MCP
  assert.deepStrictEqual(invRow(inventory.mcps, 'serena').how, ['calls x1']);
  assert.strictEqual(invRow(inventory.mcps, 'context7').used, 'no');
  assert.match(inventory.source.skills_agents_rules, /^project /);
  assert.strictEqual(inventory.source.sessions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the corpus answer is used in N of M sessions, and the never-used set per layer', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  writeInventoryTranscript(sessions, root, 'a.jsonl');
  // the second session touches nothing the first did
  fs.writeFileSync(path.join(sessions, 'b.jsonl'),
    line(invAsst('n1', '2026-07-16T07:00:00.000Z', [use('u1', 'Read', { file_path: `${root}/README.txt` })])));
  const { inventory } = run([sessions, '--inventory', claude, '--plugins', pluginsFile]);
  assert.strictEqual(inventory.source.sessions, 2);
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').sessionsUsed, 1, 'used in 1 of 2');
  assert.strictEqual(invRow(inventory.skills, 'alpha-skill').ofSessions, 2);
  assert.strictEqual(invRow(inventory.skills, 'delta-skill').used, 'no', 'never used across the corpus');
  assert.strictEqual(invRow(inventory.rules, 'other-conventions.md').used, 'no');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the block renders in the text report, the skeleton and the rollup', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  const file = writeInventoryTranscript(dir, root, 'session.jsonl');
  const args = ['--inventory', claude, '--plugins', pluginsFile];

  const txt = execFileSync('node', [SCRIPT, file, ...args], { encoding: 'utf8' });
  assert.match(txt, /\nINVENTORY vs USE \(/);
  assert.match(txt, /SKILLS - used 3 of 4 installed, \+2 used but in no inventory the run could read/);
  assert.match(txt, /unused \(1\): delta-skill/);
  assert.match(txt, /always-on - in every prompt, use not observable \(1\): baseline-demo\.md/);

  const md = execFileSync('node', [SCRIPT, file, ...args, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /## Inventory vs use/);
  assert.match(md, /### Skills \(used 3 of 4 installed, \+2 used but in no inventory the run could read\)/);
  assert.match(md, /\| alpha-skill \| installed \| 1\/1 \| yes \| Skill call x1 \| 2026-07-15T07:00:10\.000Z \|/);
  assert.match(md, /> unused \(1\): delta-skill/);
  assert.ok(md.indexOf('## Inventory vs use') < md.indexOf('## Tools ('), 'the complement sits with the surface tables, before the tools table');

  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  fs.copyFileSync(file, path.join(sessions, 'a.jsonl'));
  const roll = execFileSync('node', [SCRIPT, sessions, ...args], { encoding: 'utf8' });
  assert.match(roll, /\nINVENTORY vs USE \(/, 'directory mode carries the corpus answer');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inventory vs use: the glob subset covers **, *, ? and brace groups, and nothing else', () => {
  const { globToRe, parseFrontmatter } = require('./analyze-usage.js');
  assert.ok(globToRe('**/*.cs').test('C:/Projects/app/src/Foo.cs'));
  assert.ok(globToRe('**/*.cs').test('Foo.cs'), 'a bare relative path still matches');
  assert.ok(!globToRe('**/*.cs').test('/app/src/Foo.csproj'));
  assert.ok(globToRe('**/*.{ts,tsx}').test('/app/src/app.tsx'), 'brace group');
  assert.ok(!globToRe('**/*.{ts,tsx}').test('/app/src/app.js'));
  assert.ok(globToRe('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRe('src/*.ts').test('src/deep/a.ts'), 'a single star never crosses a separator');
  assert.ok(globToRe('**/file?.md').test('/x/file1.md'));
  // the frontmatter subset the loaders read: an inline array, a block list, a plain value
  const fm = parseFrontmatter('---\nname: demo\npaths: ["**/*.cs", "**/*.razor"]\nskills:\n  - one\n  - two\n---\nbody');
  assert.deepStrictEqual(fm.paths, ['**/*.cs', '**/*.razor']);
  assert.deepStrictEqual(fm.skills, ['one', 'two']);
  assert.strictEqual(fm.name, 'demo');
});

test('inventory vs use: a nested corpus is walked recursively, per project, and ledgers are not sessions', () => {
  // The collected-bundle layout is `<corpus>/<project>/<session-id>/<session-id>.jsonl` with the
  // ledgers beside it, and directory mode used to read only the files directly inside the folder
  // it was given: an empty TOTAL, no inventory block, and every ledger file a bogus session row.
  // Two projects, two different installs - the point of resolving the inventory per session.
  const dir = tmp();
  const corpus = path.join(dir, 'corpus');
  const mkSkill = (claude, name) => {
    fs.mkdirSync(path.join(claude, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(claude, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: "fixture"\n---\n\nbody\n`);
  };
  const project = (name, skills) => {
    const root = path.join(dir, name);
    const claude = path.join(root, '.claude');
    for (const s of skills) mkSkill(claude, s);
    return root;
  };
  // `shared-skill` is installed in BOTH and used in ONE; `solo-skill` is installed in one project
  // only and never used; `absent-skill` exists nowhere and must never appear at all.
  const rootA = project('project-a', ['shared-skill', 'solo-skill']);
  const rootB = project('project-b', ['shared-skill']);

  const bundle = (proj, sid, root, records) => {
    const d = path.join(corpus, proj, sid);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${sid}.jsonl`), records.map(line).join(''));
    // the two ledger families a bundle carries - JSONL of the same shape, never a session
    fs.writeFileSync(path.join(d, `tool-usage-${sid}.jsonl`), line({ ts: '2026-07-15T07:00:00.000Z', tool: 'Read' }));
    fs.writeFileSync(path.join(d, `hook-blocks-${sid}.jsonl`), line({ ts: '2026-07-15T07:00:00.000Z', hook: 'guard-read-whole-file.js' }));
    // a dispatched seat's transcript belongs to its parent, never to the rollup as a session
    fs.mkdirSync(path.join(d, 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(d, 'subagents', 'agent-s1.jsonl'), line(invAsst('s1', '2026-07-15T07:09:00.000Z', [])));
    return d;
  };
  bundle('project-a', 'aaaaaaaa-1111-1111-1111-111111111111', rootA, [
    { type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: rootA, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } },
    invAsst('a1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'shared-skill' })]),
    { type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  ]);
  bundle('project-b', 'bbbbbbbb-2222-2222-2222-222222222222', rootB, [
    { type: 'user', timestamp: '2026-07-16T07:00:00.000Z', cwd: rootB, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } },
    invAsst('b1', '2026-07-16T07:00:10.000Z', [use('t1', 'Read', { file_path: `${rootB}/README.md` })]),
    { type: 'user', timestamp: '2026-07-16T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  ]);
  // a collection-level ledger folder: its files are named `<session-id>.jsonl` and are not sessions
  fs.mkdirSync(path.join(corpus, 'project-a', 'tools-usage'), { recursive: true });
  fs.writeFileSync(path.join(corpus, 'project-a', 'tools-usage', 'cccccccc-3333-3333-3333-333333333333.jsonl'),
    line({ ts: '2026-07-15T07:00:00.000Z', tool: 'Bash' }));

  const pluginsFile = path.join(dir, 'installed_plugins.json');
  fs.writeFileSync(pluginsFile, JSON.stringify({ version: 2, plugins: {} }));
  const out = run([corpus, '--plugins', pluginsFile]);

  assert.deepStrictEqual(out.sessions.map((x) => x.session).sort(),
    ['aaaaaaaa-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222'],
    'two sessions found two folders deep, and no ledger or seat transcript among them');
  assert.strictEqual(out.sessions.length, 2, 'and no third row for either seat transcript');
  assert.strictEqual(out.total.msgs, 4, "2 main msgs + each bundle's seat, counted under its parent - the TOTAL was empty before the walk recursed");
  const inv = out.inventory;
  assert.strictEqual(inv.source.sessions, 2);
  assert.strictEqual(inv.source.inventories, 2, 'two cwds resolved two project inventories, not one');

  const shared = invRow(inv.skills, 'shared-skill');
  assert.strictEqual(shared.installedIn, 2, 'installed in 2 of 2 sessions');
  assert.strictEqual(shared.sessionsUsed, 1, '... and used in 1');
  const solo = invRow(inv.skills, 'solo-skill');
  assert.strictEqual(solo.used, 'no');
  assert.strictEqual(solo.installedIn, 1, 'installed in one project only - the unused line must say so');
  assert.strictEqual(invRow(inv.skills, 'absent-skill'), undefined, 'a name nothing installed is not a non-use finding');

  const txt = execFileSync('node', [SCRIPT, corpus, '--plugins', pluginsFile], { encoding: 'utf8' });
  assert.match(txt, /SKILLS - used 1 of 2 installed/);
  assert.match(txt, /never used \(1\): solo-skill \(installed in 1\/2\)/,
    'the unused line carries the install count when the run spans installs that differ');
  assert.doesNotMatch(txt, /tool-usage-|hook-blocks-|agent-s1/, 'no ledger or seat row in the rollup table');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- family A of the 2026-09-22 audit remediation: one test per fixed cluster ---

const cli = (args) => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

test('tool arguments are masked by credential SHAPE before any renderer prints them', () => {
  // The TOOLS side prints what a call ASKED FOR, so a Grep pattern that was a live token reached
  // the report and, through it, the bundle written under the project's docs path.
  const dir = tmp();
  const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'}kLmN`;
  const gitlab = `glpat-${'xY'.repeat(10)}`;
  const file = fixture(dir, [
    { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: token } }] } },
    { type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: 'x'.repeat(400) }] } },
    { type: 'assistant', timestamp: '2026-07-15T07:00:02.000Z', message: { id: 'm2', model: 'claude-sonnet-5', usage: usage(1, 0, 10, 1), content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: `curl -H "PRIVATE-TOKEN: ${gitlab}" https://example.invalid` } }] } },
    { type: 'user', timestamp: '2026-07-15T07:00:03.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'y'.repeat(600) }] } },
  ]);
  const { main } = run([file]);
  const labels = main.topResults.map((r) => r.label).join(' | ');
  assert.ok(!labels.includes(token), 'the GitHub token is not in the dump');
  assert.ok(!labels.includes(gitlab), 'and neither is the GitLab one');
  assert.match(labels, /<redacted credential \(\d+ chars\)>/, 'the row still says a credential was the argument');
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.ok(!md.includes(token) && !md.includes(gitlab), 'and no renderer prints it either');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('interrupts are counted on the parsed row, never on the raw line', () => {
  // Measured across one project's transcripts: 6 genuine interrupts against 7 raw-line hits, and
  // none of the 7 was one - the marker travels inside tool results and queued-command records.
  const dir = tmp();
  const file = fixture(dir, [
    bash('t1', 'grep interrupted transcript.jsonl'),
    { type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'transcript.jsonl:88: [Request interrupted by user]' }] } },
    { type: 'attachment', timestamp: '2026-07-15T07:00:02.000Z', attachment: { type: 'queued_command', prompt: '[Request interrupted by user for tool use]' } },
    { type: 'user', timestamp: '2026-07-15T07:00:03.000Z', parentUuid: 'p9', origin: { kind: 'human' }, message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.userInterrupts, 1, 'one real interrupt, not three');
  assert.strictEqual(main.lastInterruptTs, '2026-07-15T07:00:03.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a removal's own ls/test tail is not a tool error", () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('t1', 'rm -rf "$TMP/repo" && ls "$TMP/repo"'),
    { type: 'user', timestamp: '2026-07-15T07:00:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'ls: no such file or directory' }] } },
    bash('t2', 'ls /does/not/exist'),
    { type: 'user', timestamp: '2026-07-15T07:00:02.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'ls: no such file or directory' }] } },
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.toolCalls.Bash.errors, 1, 'only the unrelated ls is an error');
  assert.strictEqual(main.toolCalls.Bash.rmVerifyTails, 1, '... the verification tail is counted as what it is');
  assert.strictEqual(main.topResults.filter((r) => r.error).length, 1, 'and the results list agrees');
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /1 shell call\(s\) ended on an ls\/test verifying an rm/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a test runner counts anywhere in the segment, and a config FILE name does not', () => {
  const dir = tmp();
  const file = fixture(dir, [
    bash('t1', './node_modules/.bin/jest src/foo.test.ts'),
    result('t1'),
    bash('t2', 'CI=1 npx jest --runInBand'),
    result('t2'),
    bash('t3', 'cat jest.config.js'),
    result('t3'),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.efficiency.checks.test.calls, 2, 'both runs count - the segment-start anchor scored 0');
  assert.strictEqual(main.efficiency.checks.test.scoped, 1, 'the one naming a test file is scoped');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a carried skill stamp ends at the next human turn that does not continue the run', () => {
  const dir = tmp();
  const asst = (id, ts, skill) => ({ type: 'assistant', timestamp: ts, ...(skill ? { attributionSkill: skill } : {}), message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content: [] } });
  const file = fixture(dir, [
    asst('m1', '2026-07-15T07:00:00.000Z', 'demo-skill'),
    // 'continue' keeps the run going - the stamp survives it
    { type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'continue' } },
    asst('m2', '2026-07-15T07:02:00.000Z', null),
    // a new request is a new phase - the carry stops here
    { type: 'user', timestamp: '2026-07-15T07:03:00.000Z', parentUuid: 'p2', origin: { kind: 'human' }, message: { content: 'now update the README and push the branch' } },
    asst('m3', '2026-07-15T07:04:00.000Z', null),
  ]);
  const { main } = run([file]);
  assert.strictEqual(main.skillAttribution['demo-skill'].msgs, 2, 'the stamped msg plus the one the continuation carried');
  assert.strictEqual(main.skillAttribution['demo-skill'].carriedMsgs, 1);
  assert.strictEqual(main.total.msgs, 3, 'the third message is still counted - it is just not the skill\'s');
  fs.rmSync(dir, { recursive: true, force: true });
});

test("inventory: the session's own roster wins, and a stamp that postdates the session says so", () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const claude = path.join(root, '.claude');
  fs.mkdirSync(path.join(claude, 'skills', 'installed-later'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'skills', 'installed-later', 'SKILL.md'), '---\nname: installed-later\ndescription: "fixture"\n---\n\nbody\n');
  fs.writeFileSync(path.join(claude, 'rules', 'baseline-demo.md'), '---\ndescription: always-on\n---\n\nbody\n');
  // the install landed AFTER the session ran - the very drift that reported 44 skills to a session
  // whose own transcript proves `.claude` did not exist
  fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'source: x\nref: main\nsha: abcdef1234567890\nversion: 0.9.9\ninstalled: 2026-08-01T00:00:00Z\n');
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    line({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: root, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } }),
    line({ type: 'attachment', timestamp: '2026-07-15T07:00:01.000Z', attachment: { type: 'skill_listing', isInitial: true, skillCount: 2, names: ['roster-skill', 'other-roster-skill'], content: '- roster-skill: fixture\n- other-roster-skill: fixture\n' } }),
    line({ type: 'attachment', timestamp: '2026-07-15T07:00:02.000Z', attachment: { type: 'agent_listing_delta', isInitial: true, addedTypes: ['roster-agent'], removedTypes: [], addedLines: ['- roster-agent: fixture'] } }),
    line(invAsst('m1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'roster-skill' })])),
    line({ type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
  ].join(''));
  const { inventory } = run([file]);
  const names = inventory.skills.map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['other-roster-skill', 'roster-skill'], "the session's own roster is the installed set");
  assert.strictEqual(invRow(inventory.skills, 'installed-later'), undefined, 'a skill installed after the session is not reported as unused by it');
  assert.strictEqual(invRow(inventory.skills, 'roster-skill').used, 'yes');
  assert.strictEqual(invRow(inventory.agents, 'roster-agent').used, 'no');
  assert.match(inventory.source.skills_agents_rules, /from the session's own roster/);
  assert.match(inventory.vintage.inventoryWhy, /INSTALLED 2026-08-01T00:00:00Z .*AFTER this session/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--report-md carries a Session vintage block naming what the session loaded', () => {
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const claude = path.join(root, '.claude');
  fs.mkdirSync(path.join(claude, 'skills', 'demo-skill'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'rules', 'baseline-demo.md'), '---\ndescription: always-on\n---\n\nbody\n');
  // today's source has a section the session never saw
  fs.writeFileSync(path.join(claude, 'skills', 'demo-skill', 'SKILL.md'),
    '---\nname: demo-skill\ndescription: "fixture"\n---\n\n# Demo\n\nstep one\n\n## A rule added later\n\nnever load a whole file\n');
  fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), 'sha: abcdef1234567890\nversion: 0.2.79\ninstalled: 2026-07-01T00:00:00Z\n');
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    line({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: root, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' }, version: '2.1.0' }),
    line(invAsst('m1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'demo-skill' })])),
    line({ type: 'attachment', timestamp: '2026-07-15T07:00:11.000Z', attachment: { type: 'invoked_skills', skills: [{ name: 'demo-skill', path: 'projectSettings:demo-skill', content: `Base directory for this skill: ${claude}/skills/demo-skill\n\n# Demo\n\nstep one\n` }] } }),
    line({ type: 'user', timestamp: '2026-07-15T07:00:12.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    line({ type: 'user', timestamp: '2026-07-15T07:01:00.000Z', parentUuid: 'p2', origin: { kind: 'slash_command' }, message: { content: '<command-name>/demo-plugin:run</command-name>' } }),
    // the harness's own commands are not a body anything can be graded against
    line({ type: 'user', timestamp: '2026-07-15T07:01:30.000Z', parentUuid: 'p3', origin: { kind: 'slash_command' }, message: { content: '<command-name>/model</command-name>' } }),
  ].join(''));
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.ok(md.includes('## Session vintage'), 'the block is machine-written, not a section to remember');
  assert.match(md, /\| Stack install \| v0\.2\.79 .*installed before this session ran \|/);
  assert.match(md, /\| demo-skill \| Skill call \| \d+ chars \| \d+ chars \| DIFFERS - the current source has different sections \|/);
  assert.match(md, /\| demo-plugin:run \| slash command \|.*body not captured/);
  assert.ok(!/\| model \| slash command \|/.test(md), "the harness's own commands carry no skill body");
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--check-report prints one row per judgment number that cites no machine row and no locator', () => {
  const dir = tmp();
  const report = path.join(dir, 'report-usage.md');
  fs.writeFileSync(report, [
    '# Stack usage report - session `s`',
    '',
    '## Tokens (deduped per API message)',
    '',
    '| scope | input | cache-read | msgs |',
    '|---|---|---|---|',
    '| main session | 16 | 8.0k | 3 |',
    '',
    '## Waste analysis - FILL IN',
    '',
    '_Ranked by tokens wasted. Every claim cites a table row above._',
    '',
    '- The session re-read the same file 4 times, ~12.5k tokens wasted.',
    '- It spent 8.0k of cache-read on orientation.',
    '- The plan file was rewritten twice (L42).',
    '- A claim pointing past the end of the transcript (L9999).',
    '',
    '## Verdict - FILL IN',
    '',
    '| skill | worked | note |',
    '|---|---|---|',
    '| demo | y | 3 of 3 steps |',
    '',
  ].join('\n'));
  // the bundle's own transcript is what makes a locator resolvable
  fs.writeFileSync(path.join(dir, 'aaaaaaaa-1111-1111-1111-111111111111.jsonl'), Array.from({ length: 100 }, (_, i) => line({ type: 'user', i })).join(''));
  const res = cli(['--check-report', report]);
  assert.strictEqual(res.status, 1, 'a report with unsourced numbers fails the check');
  assert.match(res.out, /Waste analysis.*4\b/, 'the re-read count is in no table');
  assert.match(res.out, /12\.5k/, '... and neither is the token claim');
  assert.ok(!/8\.0k/.test(res.out.split('unsourced')[0].replace(/12\.5k/g, '')), 'a number the Tokens table prints is not flagged');
  assert.match(res.out, /L9999 - the transcript has 100 rows/, 'a locator past the end of the transcript is not a citation');
  assert.ok(!res.out.includes('L42'), 'a resolvable locator settles its line');

  // the clean case
  const clean = path.join(dir, 'clean.md');
  fs.writeFileSync(clean, ['# R', '', '## Tokens', '', '| a | b |', '|---|---|', '| main | 42 |', '', '## Waste analysis - FILL IN', '', '- 42 tokens went to orientation.', ''].join('\n'));
  const ok = cli(['--check-report', clean]);
  assert.strictEqual(ok.status, 0);
  assert.match(ok.out, /clean - every number in a judgment section/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--out writes the report to a file, so no shell redirect is needed', () => {
  const dir = tmp();
  const file = writeFixture(dir);
  const dest = path.join(dir, 'report-usage.md');
  const res = cli([file, '--report-md', '--out', dest]);
  assert.strictEqual(res.status, 0);
  assert.match(res.out, /written: .*report-usage\.md \(\d+ lines, \d+ chars\)/);
  assert.ok(fs.readFileSync(dest, 'utf8').startsWith('# Stack usage report - session `session`'), 'the file holds the report the redirect would have written');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hook join: two ledger rows equally close to one call leave it UNJOINED, never guessed', () => {
  const dir = tmp();
  const file = fixture(dir, [bash('t1', 'echo one'), result('t1')]);
  const ledger = path.join(dir, 'tools-usage.jsonl');
  fs.writeFileSync(ledger, [
    line({ ts: '2026-07-15T06:59:59.900Z', tool: 'Bash', detail: 'a' }),
    line({ ts: '2026-07-15T07:00:00.100Z', tool: 'Bash', detail: 'b' }),
  ].join(''));
  const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
  assert.strictEqual(cov.matchedCalls, 0, 'the ledger carries no tool_use_id, so neither row wins');
  assert.strictEqual(cov.ambiguousCalls, 1);
  assert.strictEqual(cov.unmatchedCalls[0].ambiguous, true);
  const md = execFileSync('node', [SCRIPT, file, '--hook-log', ledger, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /UNJOINED/);
  assert.match(md, /no `tool_use_id`/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a token past the label cut is still masked - the mask runs before the slice', () => {
  const dir = tmp();
  const token = `sk-ant-${'x'.repeat(30)}`;
  const file = fixture(dir, [
    // the token STARTS before the 70-char label cut and runs past it: the old order sliced
    // through it and printed the head of a live credential
    bash('t1', `echo ${'a'.repeat(40)} ${token} tail`),
    result('t1'),
  ]);
  const { main } = run([file]);
  const label = main.topResults[0].label;
  assert.ok(!label.includes('sk-ant-'), 'not even the head of the token survives the cut');
  assert.ok(label.length <= 70);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- navigation: located reads, symbol tools against grep-then-read, whole-file denials ----------
// Three synthetic transcripts, each counted by hand below. A read counts when it names a SOURCE file
// (a code extension, outside a build dir) on either route; it is LOCATED when a symbol tool (serena's
// three symbol tools, the LSP tool) or a grep (the Grep tool, serena's pattern search, a shell grep/rg
// opening a command segment) sits in the 3 tool calls before it, or in the same call. A symbol step
// in that window wins over a grep. Whole-file denials come from the block ledger when it is passed,
// else from the transcript's own hook bracket.
const SERENA = (tool) => `mcp__plugin_serena_serena__${tool}`;
const navCall = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });
function navTranscript(file, calls, results = {}) {
  let body = '';
  calls.forEach((c, n) => {
    body += scAsst(`m-${c.id}`, scT(2 * n), usage(1, 0, 100, 5), [c]);
    const r = results[c.id];
    body += toolRes(scT(2 * n + 1), c.id, r ? r.text : 'ok', r && r.error);
  });
  fs.writeFileSync(file, body);
}

test('navigation A: serena-first reads are located, a read after an edit is not', () => {
  // a1 find_symbol (symbol) | a2 Read Orders.cs: window [symbol] -> LOCATED by symbol
  // a3 get_symbols_overview, a4 find_referencing_symbols (symbol x2)
  // a5 Read Billing.cs: window [read, symbol, symbol] -> LOCATED by symbol
  // a6 Read README.md: not a source file | a7 Edit (nothing)
  // a8 Read Orders.cs: window [read, read, edit] -> NOT located
  // hand count: 3 source reads, 2 located (2 symbol, 0 grep), 3 symbol calls, 0 grep calls, 0 denials
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  navTranscript(file, [
    navCall('a1', SERENA('find_symbol'), { name_path: 'Orders' }),
    navCall('a2', 'Read', { file_path: 'src/Orders.cs', offset: 10, limit: 30 }),
    navCall('a3', SERENA('get_symbols_overview'), { relative_path: 'src/Billing.cs' }),
    navCall('a4', SERENA('find_referencing_symbols'), { name_path: 'Bill' }),
    navCall('a5', 'Read', { file_path: 'src/Billing.cs', offset: 1, limit: 20 }),
    navCall('a6', 'Read', { file_path: 'README.md' }),
    navCall('a7', 'Edit', { file_path: 'src/Orders.cs', old_string: 'a', new_string: 'b' }),
    navCall('a8', 'Read', { file_path: 'src/Orders.cs' }),
  ]);
  const { main } = run([file]);
  assert.deepStrictEqual(main.efficiency.navigation, { reads: 3, located: 2, symbolLocated: 2, grepLocated: 0, symbolCalls: 3, grepCalls: 0 });
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /navigation\s+2 of 3 source-file read\(s\) had a locate step in the 3 calls before \(67%\); symbol tools 3 call\(s\) against 0 grep-then-read sequence\(s\); 0 whole-file denial\(s\) \(transcript bracket - pass --hook-blocks for the ledger\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('navigation B: grep-then-read on both routes, a pipe filter is no locate step, denials come from the ledger', () => {
  // b1 Grep (grep) | b2 Read Foo.ts: window [grep] -> LOCATED by grep
  // b3 shell grep (grep) | b4 sed -n of bar.ts: window [grep, read, grep] -> LOCATED by grep
  // b5 `rg ... && cat baz.py`: a grep AND a read in one call -> LOCATED by grep
  // b6 npm test, b7 Glob (a file locate, not a place in it), b8 `git log | grep` (a filter, not a locate)
  // b9 Read Big.cs: window [b6, b7, b8] -> NOT located, and the guard denies it
  // b10 ranged Read Big.cs: window [b7, b8, b9] -> NOT located
  // hand count: 5 source reads, 3 located (0 symbol, 3 grep), 0 symbol calls, 3 grep calls;
  // the ledger holds 1 whole-file row and 1 row of another guard -> 1 whole-file denial
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  navTranscript(file, [
    navCall('b1', 'Grep', { pattern: 'class Foo' }),
    navCall('b2', 'Read', { file_path: 'src/Foo.ts', offset: 5, limit: 20 }),
    navCall('b3', 'Bash', { command: 'grep -rn "bar(" src' }),
    navCall('b4', 'Bash', { command: "sed -n '10,40p' src/bar.ts" }),
    navCall('b5', 'Bash', { command: 'rg -n baz src && cat src/baz.py' }),
    navCall('b6', 'Bash', { command: 'npm test' }),
    navCall('b7', 'Glob', { pattern: '**/*.cs' }),
    navCall('b8', 'Bash', { command: 'git log --oneline | grep fix' }),
    navCall('b9', 'Read', { file_path: 'src/Big.cs' }),
    navCall('b10', 'Read', { file_path: 'src/Big.cs', offset: 1, limit: 40 }),
  ], { b9: { text: 'Blocked: whole-file Read of src/Big.cs (900 lines) - locate the symbol first.', error: true } });
  const blocks = path.join(dir, 'hook-blocks');
  fs.mkdirSync(blocks);
  fs.writeFileSync(path.join(blocks, 'session.jsonl'),
    line({ ts: scT(16), hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'whole-file Read of src/Big.cs' }) +
    line({ ts: scT(10), hook: 'guard-secret-value.js', event: 'PreToolUse', tool: 'Bash', reason: 'credential read' }));
  const { main } = run([file]);
  assert.deepStrictEqual(main.efficiency.navigation, { reads: 5, located: 3, symbolLocated: 0, grepLocated: 3, symbolCalls: 0, grepCalls: 3 });
  const txt = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks], { encoding: 'utf8' });
  assert.match(txt, /navigation\s+3 of 5 source-file read\(s\) had a locate step in the 3 calls before \(60%\); symbol tools 0 call\(s\) against 3 grep-then-read sequence\(s\); 1 whole-file denial\(s\) \(hook-block ledger\)/);
  const md = execFileSync('node', [SCRIPT, file, '--hook-blocks', blocks, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| navigation \| 3 of 5 source-file read\(s\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('navigation C: main and seat windows are counted apart and summed, a symbol step beats a grep in one window', () => {
  // main: c1 LSP (symbol) | c2 Read app.component.ts: window [symbol] -> LOCATED by symbol
  //       c3 Read huge.ts: window [symbol, read] -> LOCATED by symbol; the guard denies it (bracket only)
  // seat: s1 search_for_pattern (grep) | s2 find_symbol (symbol)
  //       s3 Read Svc.cs: window [grep, symbol] -> LOCATED by symbol (the symbol wins)
  //       s4 Read package.json: not a source file
  //       s5 Read Other.cs: window [symbol, read, read] -> LOCATED by symbol
  //       s6 `cat src/x.go`: window [read, read, read] -> NOT located
  // hand count: main 2/2 located, seat 2/3 located; the sum is 5 reads, 4 located (4 symbol, 0 grep),
  // 2 symbol calls, 1 grep call, and 1 whole-file denial from the transcript bracket (no ledger passed)
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  navTranscript(file, [
    navCall('c1', 'LSP', { operation: 'goToDefinition', filePath: 'src/app.component.ts', line: 3, character: 5 }),
    navCall('c2', 'Read', { file_path: 'src/app.component.ts', offset: 1, limit: 30 }),
    navCall('c3', 'Read', { file_path: 'src/huge.ts' }),
  ], { c3: { text: 'Blocked: whole-file Read of src/huge.ts [node "/x/hooks/guard-read-whole-file.js"]', error: true } });
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub);
  navTranscript(path.join(sub, 'agent-s1.jsonl'), [
    navCall('s1', SERENA('search_for_pattern'), { substring_pattern: 'Svc' }),
    navCall('s2', SERENA('find_symbol'), { name_path: 'Svc' }),
    navCall('s3', 'Read', { file_path: 'src/Svc.cs', offset: 1, limit: 30 }),
    navCall('s4', 'Read', { file_path: 'package.json' }),
    navCall('s5', 'Read', { file_path: 'src/Other.cs', offset: 1, limit: 30 }),
    navCall('s6', 'Bash', { command: 'cat src/x.go' }),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-s1.meta.json'), JSON.stringify({ agentType: 'aspnet-implementer' }));
  const { main, agents } = run([file]);
  assert.deepStrictEqual(main.efficiency.navigation, { reads: 2, located: 2, symbolLocated: 2, grepLocated: 0, symbolCalls: 1, grepCalls: 0 });
  assert.deepStrictEqual(agents[0].stats.efficiency.navigation, { reads: 3, located: 2, symbolLocated: 2, grepLocated: 0, symbolCalls: 1, grepCalls: 1 });
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /navigation\s+4 of 5 source-file read\(s\) had a locate step in the 3 calls before \(80%\); symbol tools 2 call\(s\) against 0 grep-then-read sequence\(s\); 1 whole-file denial\(s\) \(transcript bracket - pass --hook-blocks for the ledger\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- dollars: a dated list-price table, a cost per session and per seat ----------

test('price table: every row is complete, sourced and dated, and the page\'s stated multipliers hold', () => {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'model-prices.json'), 'utf8'));
  assert.match(t.source, /^https:\/\/platform\.claude\.com\/docs\//);
  assert.match(t.fetched, /^\d{4}-\d{2}-\d{2}$/);
  const ids = t.models.map((m) => m.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'one row per model id');
  // The page states the cache columns as multipliers of the base input price: 1.25x for a
  // 5-minute write, 2x for a 1-hour write, 0.1x for a hit except the two it names. A refresh that
  // mistypes one column breaks here, not in a report.
  const hit = { 'claude-fable-5-1': 0.025, 'claude-mythos-5-1': 0.025, 'claude-opus-5-5': 0.05 };
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const m of t.models) {
    assert.match(m.id, /^claude-[a-z]+-\d+(?:-\d+)?$/, `${m.id}: a dateless API id`);
    for (const k of ['input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output']) assert.ok(m[k] > 0, `${m.id}: ${k}`);
    assert.ok(near(m.cache_write_5m, 1.25 * m.input), `${m.id}: 5m write is 1.25x input`);
    assert.ok(near(m.cache_write_1h, 2 * m.input), `${m.id}: 1h write is 2x input`);
    assert.ok(near(m.cache_read, (hit[m.id] || 0.1) * m.input), `${m.id}: cache hit multiplier`);
    if (m.fast) assert.ok(m.fast.input > m.input && m.fast.output > m.output, `${m.id}: fast mode is a premium`);
  }
});

// A synthetic table with round prices, so every dollar below is counted by hand and stays true
// whatever the real table says after its next refresh.
function writePrices(dir) {
  const f = path.join(dir, 'prices.json');
  fs.writeFileSync(f, JSON.stringify({ source: 'https://example.test/pricing', fetched: '2026-01-01', models: [
    { id: 'claude-test-a', input: 1, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, output: 5, fast: { input: 2, output: 10 } },
    { id: 'claude-test-b', input: 10, cache_write_5m: 12.5, cache_write_1h: 20, cache_read: 1, output: 50 },
  ] }));
  return f;
}
const costUsage = (i, cc, cr, out, split, extra = {}) => ({ ...usage(i, cc, cr, out), ...(split ? { cache_creation: { ephemeral_5m_input_tokens: split[0], ephemeral_1h_input_tokens: split[1] } } : {}), ...extra });
const costAsst = (id, ts, model, u) => line({ type: 'assistant', timestamp: ts, message: { id, model, usage: u, content: [] } });

test('cost: priced once per message from the folded usage, split by cache TTL, fast mode scaled, unpriced named, seats summed', () => {
  // main m1 (claude-test-a, a dated id): three STREAMED rows of one message, output growing 10 ->
  //   200 -> 2000 while the input side repeats - folded once: in 1000, 5m write 1000, 1h write 3000,
  //   read 100000, out 2000 = 1000*1 + 1000*1.25 + 3000*2 + 100000*0.1 + 2000*5 = 28,250 -> $0.02825
  //   (a per-row sum would have billed 3000 in, 12000 written, 300000 read, 2210 out)
  // main m2 (claude-test-a[1m], fast, no split): write 1000 at the 5m rate, read 50000, out 1000,
  //   every input column x2 (fast input 2 / input 1), output at the fast 10:
  //   1000*1.25*2 + 50000*0.1*2 + 1000*10 = 22,500 -> $0.0225
  // main m3 (claude-mystery-9): unpriced, named with its message count
  // seat s1 aspnet-implementer (claude-test-b): 100*10 + 10000*1 + 100*50 = 16,000 -> $0.016
  // seat s2 evidence-gatherer (claude-test-b): 1000*50 = 50,000 -> $0.05
  // hand count: main $0.05075, seats $0.066, session $0.11675
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file,
    costAsst('m1', scT(0), 'claude-test-a-20260101', costUsage(1000, 4000, 100000, 10, [1000, 3000])) +
    costAsst('m1', scT(1), 'claude-test-a-20260101', costUsage(1000, 4000, 100000, 200, [1000, 3000])) +
    costAsst('m1', scT(2), 'claude-test-a-20260101', costUsage(1000, 4000, 100000, 2000, [1000, 3000])) +
    costAsst('m2', scT(3), 'claude-test-a[1m]', costUsage(0, 1000, 50000, 1000, null, { speed: 'fast' })) +
    costAsst('m3', scT(4), 'claude-mystery-9', costUsage(10, 0, 0, 10, [0, 0])) +
    line({ type: 'cost-state', timestamp: scT(5), totalCostUSD: 0.2, modelUsage: { 'claude-test-a': { inputTokens: 1000, outputTokens: 3000, cacheReadInputTokens: 150000, cacheCreationInputTokens: 5000 } } }));
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'agent-s1.jsonl'), costAsst('s1', scT(6), 'claude-test-b', costUsage(100, 0, 10000, 100, [0, 0])));
  fs.writeFileSync(path.join(sub, 'agent-s1.meta.json'), JSON.stringify({ agentType: 'aspnet-implementer' }));
  fs.writeFileSync(path.join(sub, 'agent-s2.jsonl'), costAsst('s2', scT(7), 'claude-test-b', costUsage(0, 0, 0, 1000, [0, 0])));
  fs.writeFileSync(path.join(sub, 'agent-s2.meta.json'), JSON.stringify({ agentType: 'evidence-gatherer' }));
  const prices = writePrices(dir);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);
  const out = run([file, '--prices', prices]);
  assert.strictEqual(out.main.total.output, 3010, 'the streamed rows fold to their last snapshot, never a per-row sum');
  assert.strictEqual(out.main.total.cacheRead, 150000);
  near(out.main.cost.usd, 0.05075, 'main');
  assert.deepStrictEqual(out.main.cost.unpriced, { 'claude-mystery-9': 1 });
  assert.strictEqual(out.main.cost.noSplitMsgs, 1);
  assert.strictEqual(out.main.cost.fastMsgs, 1);
  near(out.agents.find((a) => a.id === 's1').stats.cost.usd, 0.016, 'seat s1');
  near(out.cost.usd, 0.11675, 'session');
  near(out.cost.subagents, 0.066, 'seats');
  near(out.cost.byType['evidence-gatherer'], 0.05, 'seat type');
  const txt = execFileSync('node', [SCRIPT, file, '--prices', prices], { encoding: 'utf8' });
  assert.match(txt, /cost at list price\s+~\$0\.12 - main \$0\.05, subagents \$0\.07 over 2 seat\(s\) \(evidence-gatherer \$0\.05, aspnet-implementer \$0\.02\); cost-state billed \$0\.20; unpriced: claude-mystery-9 x1 msg; 1 msg\(s\) with no cache-write split, billed at the 5-minute rate; 1 fast-mode msg\(s\)/);
  assert.match(txt, /tests: list price from https:\/\/example\.test\/pricing, fetched 2026-01-01/);
  assert.match(txt, /evidence-gatherer\s+1\s+1\.0k\s+0\s+1\s+\$0\.05/, 'the seat table carries a cost column');
  const md = execFileSync('node', [SCRIPT, file, '--prices', prices, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| agent type \| n \| output \| cache-read \| msgs \| cost \| wall \| top tools \|/);
  assert.match(md, /\| cost at list price \| ~\$0\.12 - main \$0\.05/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cost: a copied fork prefix is the parent\'s bill, a rollup carries a cost per session, a missing table says so', () => {
  const dir = tmp();
  const prices = writePrices(dir);
  // the parent's message (read 5000 at 0.1, out 1 at 5 = 505 -> $0.000505) is copied into the fork;
  // the fork's own message (out 100 at 5 = 500 -> $0.0005) is the fork's whole cost
  const parentRow = { type: 'assistant', timestamp: '2026-07-15T07:00:00.000Z', message: { id: 'p1', model: 'claude-test-a', usage: usage(0, 0, 5000, 1), content: [] } };
  const ownRow = { type: 'assistant', timestamp: '2026-07-15T07:10:00.000Z', message: { id: 'o1', model: 'claude-test-a', usage: usage(0, 0, 0, 100), content: [] } };
  const file = forkFixture(dir, {
    parentRows: [{ ...parentRow, sessionId: PARENT_SID, session_id: PARENT_SID }],
    ownRows: [{ ...parentRow, sessionId: OWN_SID, session_id: PARENT_SID }, { ...ownRow, sessionId: OWN_SID, session_id: OWN_SID }],
  });
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);
  const out = run([file, '--prices', prices]);
  near(out.main.cost.usd, 0.0005, 'own');
  near(out.main.cost.prefixUsd, 0.000505, 'prefix');
  // rollup: one cost per session, the fork's own and the parent's own - the prefix is never billed twice
  const roll = run([dir, '--prices', prices]);
  const bySid = Object.fromEntries(roll.sessions.map((r) => [r.session, r.cost]));
  near(bySid[OWN_SID], 0.0005, 'fork row');
  near(bySid[PARENT_SID], 0.000505, 'parent row');
  const rtxt = execFileSync('node', [SCRIPT, dir, '--prices', prices], { encoding: 'utf8' });
  assert.match(rtxt, /\bcost\b/);
  assert.match(rtxt, /\$0\.0005\b/);
  const none = execFileSync('node', [SCRIPT, file, '--prices', path.join(dir, 'absent.json')], { encoding: 'utf8' });
  assert.match(none, /cost at list price\s+price table unreadable/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- MCP failures: the calls a server answered with an error, per server, per session ----------

test('MCP failures: a server error counts per server across main and seats; a guard, a harness rejection and a decline do not', () => {
  // main: serena find_symbol ok | serena find_symbol ERROR (the server's own 'Error executing tool')
  //       serena get_symbols_overview ok | context7 query-docs ERROR (MCP timeout)
  //       context7 resolve-library-id: a guard denial -> REJECTED, never ran
  //       memory memory_search: an InputValidationError -> REJECTED by the harness, never ran
  //       playwright-chrome browser_click: the user declined -> an answer, not a failure
  // seat: serena find_symbol ERROR | playwright-firefox browser_navigate ok
  // hand count: 9 calls, 3 server errors (serena 2 of 4, context7 1 of 2), 2 rejected
  const dir = tmp();
  const file = path.join(dir, 'session.jsonl');
  const mcpName = (server, tool) => `mcp__plugin_${server}_${server}__${tool}`;
  navTranscript(file, [
    navCall('e1', mcpName('serena', 'find_symbol'), { name_path: 'A' }),
    navCall('e2', mcpName('serena', 'find_symbol'), { name_path: 'B' }),
    navCall('e3', mcpName('serena', 'get_symbols_overview'), { relative_path: 'src/a.cs' }),
    navCall('e4', mcpName('context7', 'query-docs'), { query: 'x' }),
    navCall('e5', mcpName('context7', 'resolve-library-id'), { libraryName: 'y' }),
    navCall('e6', mcpName('memory', 'memory_search'), {}),
    navCall('e7', mcpName('playwright-chrome', 'browser_click'), { element: 'OK' }),
  ], {
    e2: { text: 'Error executing tool find_symbol: language server not running', error: true },
    e4: { text: 'MCP error -32001: Request timed out', error: true },
    e5: { text: 'Blocked: this call is gated [node "/x/hooks/guard-unapproved-dispatch.js"]', error: true },
    e6: { text: '<tool_use_error>InputValidationError: memory_search failed due to the following issue: query is required</tool_use_error>', error: true },
    e7: { text: "The user doesn't want to proceed with this tool use.", error: true },
  });
  const sub = path.join(dir, 'subagents');
  fs.mkdirSync(sub);
  navTranscript(path.join(sub, 'agent-s1.jsonl'), [
    navCall('f1', mcpName('serena', 'find_symbol'), { name_path: 'C' }),
    navCall('f2', mcpName('playwright-firefox', 'browser_navigate'), { query: 'z' }),
  ], { f1: { text: 'Error executing tool find_symbol: timeout', error: true } });
  const { main, agents } = run([file]);
  assert.strictEqual(main.mcp.serena.errors, 1);
  assert.strictEqual(main.mcp.context7.errors, 1);
  assert.strictEqual(main.mcp.context7.rejected, 1, 'a guard denial is a rejection, not a server failure');
  assert.strictEqual(main.mcp.memory.errors, 0);
  assert.strictEqual(main.mcp.memory.rejected, 1, 'a schema failure never reached the server');
  assert.strictEqual(main.mcp['playwright-chrome'].errors, 0, 'a decline is an answer');
  assert.strictEqual(agents[0].stats.mcp.serena.errors, 1);
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /MCP failures\s+3 of 9 MCP call\(s\) returned an error: serena 2\/4, context7 1\/2; 2 more rejected before the server ran \(a guard or the harness\)/);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| serena \| 4 \| [^|]+ \| 2 \|/, 'the MCP table counts server errors only');
  assert.match(md, /\| MCP failures \| 3 of 9 MCP call\(s\)/);
  // per session, in the rollup
  const roll = run([dir]);
  assert.deepStrictEqual(roll.sessions[0].mcp, { calls: 9, errors: 3 });
  const rtxt = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(rtxt, /mcp-err/);
  assert.match(rtxt, /\b3\/9\b/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MCP failures: a session with no MCP call says so', () => {
  const dir = tmp();
  const file = writeFixture(dir);
  const txt = execFileSync('node', [SCRIPT, file], { encoding: 'utf8' });
  assert.match(txt, /MCP failures\s+no MCP call/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A session recorded before 2.0.0 names the stack's items under the 1.x plugin names, and the
// project it ran in may still hold the 1.x stamp: both are the house's own, read like the new ones.
test('a 1.x session: its claude-stack scoped names join the bare inventory, and its stamp is the vintage', () => { // legacy-name
  const dir = tmp();
  const root = path.join(dir, 'proj');
  const { claude, pluginsFile } = writeInventory(root);
  fs.writeFileSync(path.join(claude, 'claude-stack.stamp'), 'sha: abcdef1234567890\nversion: 1.3.0\ninstalled: 2026-07-01T00:00:00Z\n'); // legacy-name
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    line({ type: 'user', timestamp: '2026-07-15T07:00:00.000Z', cwd: root, parentUuid: 'p1', origin: { kind: 'human' }, message: { content: 'go' } }),
    line(invAsst('m1', '2026-07-15T07:00:10.000Z', [use('t1', 'Skill', { skill: 'claude-stack:alpha-skill' })])), // legacy-name
    line({ type: 'user', timestamp: '2026-07-15T07:00:11.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    line(invAsst('m2', '2026-07-15T07:01:00.000Z', [use('t2', 'Task', { subagent_type: 'claude-stack-web-angular:demo-implementer', description: 'build one task' })])), // legacy-name
    line({ type: 'user', timestamp: '2026-07-15T07:01:01.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'done' }] } }),
  ].join(''));
  const { inventory } = run([file, '--inventory', claude, '--plugins', pluginsFile]);
  assert.deepStrictEqual(invRow(inventory.skills, 'alpha-skill').how, ['Skill call x1']);
  assert.strictEqual(invRow(inventory.skills, 'claude-stack:alpha-skill'), undefined, 'the row did not split in two'); // legacy-name
  assert.deepStrictEqual(invRow(inventory.agents, 'demo-implementer').how, ['dispatched x1']);
  const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
  assert.match(md, /\| Stack install \| v1\.3\.0 .*installed before this session ran \|/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Task 22: the code-style capture was renamed, and a rule it generated before that names its old
// spelling. Both count as a rule attach; the old spelling comes from the manifest's `renamed` map.
test('style rule attaches: a rule generated under the capture\'s old name still counts', () => {
  const renamed = require('../meta/stack-manifest.json').renamed.skills;
  const old = Object.keys(renamed).find((k) => renamed[k] === 'alfred-capture-code-style');
  assert.ok(old, 'the map names the capture\'s old spelling');
  const dir = tmp();
  const said = (ts, name) => ({ type: 'user', timestamp: ts, message: { content: `# Project code style (generated - the ${name} skill owns this rule)` } });
  const file = fixture(dir, [said('2026-07-15T07:00:00.000Z', old), said('2026-07-15T07:00:01.000Z', 'alfred-capture-code-style'),
    { type: 'assistant', timestamp: '2026-07-15T07:00:02.000Z', message: { id: 'm1', model: 'claude-sonnet-5', usage: usage(1, 0, 1, 1), content: [{ type: 'text', text: 'ok' }] } }]);
  try { assert.strictEqual(run([file]).main.styleRuleAttaches, 2); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
