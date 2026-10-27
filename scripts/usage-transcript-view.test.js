'use strict';
// The usage audit's transcript reader (stack/skills/capture-usage-report/scripts/transcript-view.js) and the skill's
// bundle-author split. 2026-10-17: one audit run's 69 bundle authors took the session's model (40 Opus, 29 Sonnet, $195
// of $208) and spent about 44% of their calls on transcript digs, each through a helper script written for the question.
// The reader answers those questions in one bounded call; the skill names the authors' model in the dispatch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'stack', 'skills', 'capture-usage-report');
const VIEW = path.join(SKILL, 'scripts', 'transcript-view.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-view-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const BIG = 'x'.repeat(60000);
// A session: a typed prompt, a command run, an ask and its answer, an errored Bash, a 60k-char Read result, a seat with an
// error of its own, a torn last line.
function session(name) {
  const t = (s) => `2026-10-17T10:00:${String(s).padStart(2, '0')}.000Z`;
  const rows = [
    { type: 'user', timestamp: t(1), message: { role: 'user', content: 'fix the export' } },
    { type: 'user', timestamp: t(2), isMeta: true, message: { role: 'user', content: '<system-reminder>ignored</system-reminder>' } },
    { type: 'user', timestamp: t(3), message: { role: 'user', content: '<command-name>/task-solve</command-name><command-args>fix it</command-args>' } },
    { type: 'assistant', timestamp: t(4), message: { id: 'm1', content: [{ type: 'text', text: 'Size: small' }, { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test' } }], usage: { input_tokens: 5, cache_read_input_tokens: 90000 } } },
    { type: 'user', timestamp: t(5), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: true, content: 'Exit code 1\n3 failing' }] } },
    { type: 'assistant', timestamp: t(6), message: { id: 'm2', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'src/big.ts' } }] } },
    { type: 'user', timestamp: t(7), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: BIG }] } },
    { type: 'assistant', timestamp: t(8), message: { id: 'm3', content: [{ type: 'tool_use', id: 'a1', name: 'AskUserQuestion', input: { questions: [{ question: 'Commit?', options: [{ label: 'Commit locally (Recommended)' }, { label: 'Leave it' }] }] } }] } },
    { type: 'user', timestamp: t(9), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Your questions have been answered: "Commit?"="Commit locally (Recommended)"' }] } },
    { type: 'assistant', timestamp: t(10), message: { id: 'm4', content: [{ type: 'tool_use', id: 'g1', name: 'Agent', input: { subagent_type: 'general-purpose', model: 'sonnet', description: 'Usage bundle 1' } }] } },
    { type: 'assistant', timestamp: t(11), message: { id: 'm5', content: [{ type: 'text', text: 'All tests pass.' }] } },
  ];
  const file = path.join(TMP, `${name}.jsonl`);
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"type":"assistant","message":{"content":[{"type":"te');
  const sub = path.join(TMP, name, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), [
    { type: 'assistant', timestamp: t(20), message: { id: 's1', content: [{ type: 'tool_use', id: 'sb', name: 'Bash', input: { command: 'cat missing' } }] } },
    { type: 'user', timestamp: t(21), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sb', is_error: true, content: 'No such file' }] } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const usage = path.join(TMP, `${name}.usage.json`);
  fs.writeFileSync(usage, JSON.stringify({ main: {
    spikes: [{ ts: t(7), delta: 15000, ctx: 105000, causes: 'Read x1' }],
    topResults: [{ name: 'Read', label: 'big.ts', chars: 60000, ts: t(7), error: false }],
    efficiency: { cacheMissAt: [], unverifiedGreenClaims: [t(11)], commitsUnchecked: [], compactionRereads: [] },
  } }));
  return { file, usage };
}
const view = (...args) => {
  const r = spawnSync(process.execPath, [VIEW, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test('pack: typed prompts, asks with answers, runs, errors (seats too) and each flagged moment, every line a locator', () => {
  const { file, usage } = session('pack');
  const r = view('pack', file, usage);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /## Typed prompts \(2\)\nL1 10:00:01 fix the export\nL3 10:00:03 <command-name>\/task-solve/, 'a meta row and a tool result are no typed prompt');
  assert.match(r.out, /L8 10:00:08 ASK Commit\? \[Commit locally \(Recommended\) \| Leave it\]\n {2}-> L9 Your questions have been answered: "Commit\?"="Commit locally \(Recommended\)"/);
  assert.match(r.out, /L3 10:00:03 command \/task-solve/);
  assert.match(r.out, /L10 10:00:10 Agent general-purpose \(sonnet\): Usage bundle 1/, 'a dispatch shows the model it was given');
  assert.match(r.out, /## Errored tool results \(2, 1 seat transcript\(s\) read\)\nL5 10:00:05 Bash: Exit code 1 3 failing\nagent-a1 L2 10:00:21 Bash: No such file/);
  assert.match(r.out, /### context spike @ 10:00:07 - \+15000 to 105000 - Read x1\nL4 .*\nL5 .*\nL6 .*Read: src\/big\.ts\nL7 10:00:07 result: 60000 chars/);
  assert.match(r.out, /### green claim with no check @ 10:00:11\n(?:.*\n)*L11 10:00:11 assistant text: All tests pass\./);
  assert.ok(r.out.length < 8000, `the 60k result is never printed whole (${r.out.length})`);
  const capped = view('pack', file, usage, '--max', '1000');
  assert.match(capped.out, /\.\.\. \[pack cut at 1000 chars - \d+ more; narrow with timeline \/ grep\]/);
  const out = path.join(TMP, 'evidence.md');
  assert.match(view('pack', file, usage, '--out', out).out, /^transcript-view: wrote .*evidence\.md \(\d+ chars\)/);
  assert.match(fs.readFileSync(out, 'utf8'), /^# Evidence pack - pack\.jsonl \(11 rows\)/, 'the torn last line is skipped, never fatal');
  assert.equal(view('pack', file).code, 0, 'no usage json: the pack without flagged moments');
});

test('timeline, show and grep: one bounded line per row, rows by locator, matches by role', () => {
  const { file } = session('views');
  const tl = view('timeline', file, '--from', '4', '--to', '7').out.trim().split('\n');
  assert.deepEqual(tl.map((l) => l.split(' ')[0]), ['L4', 'L5', 'L6', 'L7']);
  assert.match(tl[0], /^L4 10:00:04 assistant \[ctx 90k\] text: Size: small \/ Bash: npm test$/);
  assert.match(tl[1], /^L5 10:00:05 result ERROR: 21 chars Exit code 1 3 failing$/);
  const shown = view('show', file, 'L7,8-9', '--chars', '300').out;
  assert.match(shown, /== L7 user 2026-10-17T10:00:07\.000Z\n\[tool_result r1\] x{270,}\n\.\.\. \[\d+ more chars\]/);
  assert.match(shown, /== L8 assistant .*\n\[tool_use AskUserQuestion a1\] \{"questions"/);
  assert.match(shown, /== L9 user/);
  assert.match(view('show', file, '99').out, /no row at 99/);
  assert.match(view('grep', file, 'all tests', '--role', 'assistant').out, /^L11 10:00:11 assistant: All tests pass\./);
  assert.match(view('grep', file, 'export', '--role', 'user').out, /^L1 10:00:01 USER: fix the export/);
  assert.match(view('grep', file, 'failing', '--role', 'result').out, /^L5 10:00:05 result ERROR: Exit code 1 3 failing/);
  assert.equal(view('grep', file, 'nowhere-at-all').out.trim(), 'no match');
});

test('usage errors exit 2 with the usage line; a missing transcript or bad json is said, never thrown', () => {
  const { file } = session('errs');
  for (const args of [[], ['pack'], ['nope', file], ['show', file], ['show', file, 'abc'], ['grep', file], ['grep', file, '('], ['grep', file, 'x', '--role', 'seat'], ['timeline', path.join(TMP, 'missing.jsonl')]]) {
    const r = view(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /^transcript-view: [^\n]+\nusage: transcript-view\.js pack/, args.join(' '));
  }
  const bad = path.join(TMP, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  assert.match(view('pack', file, bad).err, /cannot read .*bad\.json as JSON/);
  const empty = path.join(TMP, 'empty.jsonl');
  fs.writeFileSync(empty, '');
  assert.match(view('pack', empty).out, /^# Evidence pack - empty\.jsonl \(0 rows\)/);
});

test('the skill: authors on a model named in the dispatch, the reader before any helper script, the spot check in step 5', () => {
  const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8').replace(/\s+/g, ' ');
  const skill = read('SKILL.md');
  assert.match(skill, /\*\*Who writes each bundle\.\*\* One session to audit, or no subagent dispatch: write it here\. Two or more: one AUTHOR subagent per bundle, at most six at a time, and never past `ALFRED_CODE_MAXIMUM_RUN_AGENTS`, each on a mid-tier model named in the dispatch \(`model: 'sonnet'` on Claude Code's Agent call\) - never a default seat, which takes this session's model/);
  assert.match(skill, /\*\*Gather with the reader, never a helper script\.\*\* Each bundle starts with `node <snapshot>\/stack\/skills\/capture-usage-report\/scripts\/transcript-view\.js pack <transcript> <usage json> --out <tmp>\/<sid>-evidence\.md`/);
  assert.match(skill, /It quotes the transcript, so it stays in `<tmp>`, out of the bundle\./);
  assert.match(skill, /The spot check, when authors wrote the bundles: the two with the most flagged moments in their pack/);
  const brief = read('references/bundle-brief.md');
  assert.match(brief, /Gather with the reader, never a script of your own: node <snapshot>\/stack\/skills\/capture-usage-report\/scripts\/transcript-view\.js pack/);
  assert.match(brief, /Last command: node <snapshot>\/scripts\/analyze-usage\.js --check-report/);
  assert.match(brief, /One line: `bundle <sid>: <the Verdict's headline> - check-report clean`/);
  assert.match(read('references/run-mechanics.md'), /transcript-view\.js timeline "<transcript>" --from 200 --to 260/);
  assert.doesNotMatch(read('references/run-mechanics.md'), /sed -n '250p'/, 'the hand-rolled sed recipes are gone');
});
