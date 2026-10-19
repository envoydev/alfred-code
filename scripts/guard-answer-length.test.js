// Behavior tests for stack/hooks/guard-answer-length.js - the short-answer contract's
// mechanization. A hook that fires on the wrong turn is worse than no hook (it trains the model
// to treat blocks as noise), so both directions are pinned: the wall-of-text block AND every
// exemption that must stay silent.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // audit 2026-10-08: its hooks' tmp state stays in a dir of its own
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k]; // C19: the session's own stack env never decides a case

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-answer-length.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-length-'));
// The hook appends a block row to `<root>/<docs-path>/hook-blocks/`, and the root falls back to the
// process cwd when CLAUDE_PROJECT_DIR is unset - so a suite run from this checkout wrote its
// fixtures into the repo's own field ledger. Pin a scratch root for the whole run.
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));

// A transcript is JSONL: one user turn, then the assistant answer under test.
function transcript(name, userText, assistantBlocks) {
    const p = path.join(TMP, `${name}.jsonl`);
    const rows = [];
    if (userText !== null)
        rows.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: userText }] } });
    rows.push({ type: 'assistant', message: { role: 'assistant', content: assistantBlocks } });
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return p;
}

function run(payload) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const WALL = 'This sentence exists only to burn prose characters against the cap. '.repeat(40); // ~2600 chars
const SHORT = 'Done - the build is green and the two failing tests now pass.';

test('UserPromptSubmit injects the answer budget as additionalContext', () => {
    const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'what changed?' });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /3 sentences/, 'the budget names the sentence cap');
    assert.match(ctx, /900 characters/, 'the budget names the character cap');
    assert.match(ctx, /Code, tables and command output are exempt/, 'the exemption travels with the budget');
});

test('Stop blocks a wall-of-text answer when nothing asked for depth', () => {
    const p = transcript('wall', 'did the build pass?', [{ type: 'text', text: WALL }]);
    const r = run({ hook_event_name: 'Stop', transcript_path: p });
    assert.strictEqual(r.status, 2, 'over the hard cap with no depth request must block');
    assert.match(r.stderr, /characters of prose/, 'the block reports the measured length');
    assert.match(r.stderr, /do NOT\s*\n?append the short version/i, 'the block forbids appending a summary to the wall');
});

test('Stop allows a wall of text when the user asked for depth', () => {
    for (const ask of ['walk me through it', 'give me the full breakdown', 'explain in detail', 'write a plan for this']) {
        const p = transcript('depth', ask, [{ type: 'text', text: WALL }]);
        assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, `'${ask}' must lift the cap`);
    }
});

// Deep hooks review 2026-10-16: the depth list is English only; a prompt it cannot read (30% or more of its letters outside
// ASCII) lifts the cap with a length-unread row, so a depth ask in any language keeps its answer.
test('Stop allows a wall of text after a prompt the depth list cannot read', () => {
    for (const ask of ['розкажи детально', 'опиши покроково', 'розпиши будь ласка', 'напиши план']) {
        const p = transcript('depth-cyr', ask, [{ type: 'text', text: WALL }]);
        assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, `'${ask}' must lift the cap`);
    }
});

test('a long answer to an unreadable prompt is logged as length-unread, never held; a Latin-script one is judged as English', () => {
    const p = transcript('short-cyr', 'що робить цей хук?', [{ type: 'text', text: WALL }]);
    const sid = `unread-${process.pid}`;
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p, session_id: sid }).status, 0, 'not held');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: transcript('short-fr', 'que fait ce hook ?', [{ type: 'text', text: WALL }]) }).status, 2, 'French reads as English: held');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: transcript('mixed', 'fix the label Зберегти in the dialog', [{ type: 'text', text: WALL }]) }).status, 2, 'English quoting a word under 30%: held');
});

test("Stop still blocks on a bare 'explain' - an explanation is capped like any other answer", () => {
    const p = transcript('explain', 'explain what the hook does', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2);
});

// Audit 2026-10-20 C21: the mandated closes the stack's contracts fix in labels - the flow's three stop fields, the
// update report's agents-md receipt, a capture REPORT's receipt lines - and a depth skill the user named were cut by the
// cap, each re-answer dropping a field the contract owes. One label alone, or two of the three flow fields, stays capped.
test('C21: a mandated label close and a user-named depth skill pass the cap; a partial or look-alike close still blocks', () => {
    const stop = (name, ask, text) => run({ hook_event_name: 'Stop', transcript_path: transcript(name, ask, [{ type: 'text', text }]) }).status;
    const flow = `Both cards are built.\n\n**Result:** done - ${WALL}\n\n**Progress:** 6 of 6 steps.\n\nLeftovers: none.`;
    assert.strictEqual(stop('c21-flow', 'continue', flow), 0, 'the three flow fields, bold or plain');
    assert.strictEqual(stop('c21-flow-2', 'continue', `**Result:** done - ${WALL}\n\n**Progress:** 6 of 6 steps.`), 2, 'two of three fields');
    assert.strictEqual(stop('c21-result-word', 'continue', `The result: ${WALL}\nProgress was good, leftovers none.`), 2, 'the words mid-line');
    const update = `Updated from 2.4.0 to 2.5.0. ${WALL}\n\n**AGENTS.md compare:** \`agents-md: compare 0 additions - check 1 row\`.\n\nNothing is pending on this run - these are yours to run when you choose.`;
    assert.strictEqual(stop('c21-update', '/alfred-code:update', update), 0, 'the update report carries its receipt');
    assert.strictEqual(stop('c21-update-no', '/alfred-code:update', update.replace(/agents-md: compare[^`]*/, 'agents-md compare was clean')), 2, 'no receipt shape');
    const capture = `Refreshed the assessment. ${WALL}\n\n- **Run gate:** answered 'Run and replace (Recommended)'.\n- **References:** \`references/doc-shape.md\`.\n- **Findings gate:** 19 considered, 6 passed.\n- **Model:** Opus 5.5 - the judgment ran on it.`;
    assert.strictEqual(stop('c21-capture', 'run it', capture), 0, 'the capture receipts, bulleted and bold');
    assert.strictEqual(stop('c21-capture-plain', 'run it', `${WALL}\nReferences: doc-shapes.md\nWrite gate: 'Refresh'\nModel: claude-opus-5-5`), 0, 'plain receipt lines');
    assert.strictEqual(stop('c21-capture-one', 'run it', `${WALL}\nModel: Opus 5.5\nReferences: none`), 2, 'the two anchors with no receipt');
    assert.strictEqual(stop('c21-skill', 'using that skill habits-explain-code explain me the issue', WALL), 0, 'the user named the depth skill');
    assert.strictEqual(stop('c21-skill-no', 'explain me the issue', WALL), 2, 'a bare explain stays capped');
});

test('Stop ignores code blocks, tables, quotes and inline spans when measuring', () => {
    const payload = [
        SHORT,
        '```js\n' + '// a long pasted file\nconst x = 1;\n'.repeat(60) + '```',
        '| col | col |\n|---|---|\n' + '| some fairly wide table cell | another wide cell |\n'.repeat(30),
        '> ' + 'quoted command output line\n> '.repeat(40),
        '`' + 'src/some/very/long/path/to/a/file.ts'.repeat(20) + '`',
    ].join('\n\n');
    const p = transcript('exempt', 'did the build pass?', [{ type: 'text', text: payload }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0,
        'a short answer carrying a big payload is not a wall of text');
});

test('Stop leaves a normal short answer alone', () => {
    const p = transcript('short', 'did the build pass?', [{ type: 'text', text: SHORT }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0);
});

test('Stop never loops: a continuation we caused passes untouched', () => {
    const p = transcript('loop', 'did the build pass?', [{ type: 'text', text: WALL }]);
    const session_id = `loop-${process.pid}-${Date.now()}`;
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id, transcript_path: p }).status, 2, 'the first Stop holds');
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id, transcript_path: p, stop_hook_active: true }).status, 0);
});

// The Stop chain (audit 2026-10-08 S1): `stop_hook_active` is set after ANY Stop hook's block, so the wall of text a
// sibling's continuation re-sends (the stop contract held the close) is judged - it passed unjudged before.
test('Stop judges a continuation a sibling Stop hook caused, then blocks it at most once', () => {
    const p = transcript('sibling', 'did the build pass?', [{ type: 'text', text: WALL }]);
    const session_id = `sibling-${process.pid}-${Date.now()}`;
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id, transcript_path: p, stop_hook_active: true }).status, 2, 'a sibling caused this continuation');
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id, transcript_path: p, stop_hook_active: true }).status, 0, 'never twice in one cycle');
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id, transcript_path: p }).status, 2, 'a new cycle judges afresh');
});

// Audit 2026-10-08 row 31: with no transcript path at all the length half has no user row to rule depth out, the same
// fail-open an unreadable transcript gets - it blocked with no depth check before.
test('Stop with no transcript path leaves the length half fail-open', () => {
    assert.strictEqual(run({ hook_event_name: 'Stop', session_id: `nopath-${process.pid}`, last_assistant_message: WALL }).status, 0);
});

test('Stop skips a turn that ended on a tool call', () => {
    const p = transcript('tool', 'did the build pass?', [
        { type: 'text', text: WALL },
        { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
    ]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0);
});

test('a tool_result user message is not mistaken for the user asking for depth', () => {
    const p = path.join(TMP, 'toolresult.jsonl');
    fs.writeFileSync(p, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'did it pass?' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'walk me through in detail' }] } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: WALL }] } }),
    ].join('\n') + '\n');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2,
        'depth words inside tool output must not lift the cap');
});

// A split turn: one logical answer written as two rows sharing a message.id. Keeping only the
// last row read the wall as an empty fragment and passed it silently - the defect the stop
// contract hit six times before both readers learned to merge by id.
test('a wall of text split across rows sharing one message.id is still blocked', () => {
    const wall = 'x'.repeat(2600);
    const p = transcript('split-id', 'do it', [{ type: 'text', text: wall }]);
    const rows = fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const last = rows[rows.length - 1];
    last.message.id = 'm-split';
    rows.push({ type: 'assistant', message: { id: 'm-split', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } });
    fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', transcript_path: p }), encoding: 'utf8' });
    assert.equal(r.status, 2);
});

test('fails open on a missing transcript, unparseable input, and an unknown event', () => {
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: path.join(TMP, 'nope.jsonl') }).status, 0);
    assert.strictEqual(run({ hook_event_name: 'PreCompact' }).status, 0);
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    // a JSON scalar parses fine and used to throw a TypeError on the first field read (exit 1, stack trace shown as a hook error)
    assert.strictEqual(spawnSync(process.execPath, [HOOK], { input: 'null', encoding: 'utf8' }).status, 0);
});

test('a plain-string user turn asking for depth lifts the cap', () => {
    const p = path.join(TMP, 'string-user.jsonl');
    fs.writeFileSync(p, [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'розкажи детально' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: WALL }] } }),
    ].join('\n') + '\n');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0);
});

test('the hard cap is a boundary: 1800 characters pass, 1801 block', () => {
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: transcript('cap-at', 'ok?', [{ type: 'text', text: 'x'.repeat(1800) }]) }).status, 0);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: transcript('cap-over', 'ok?', [{ type: 'text', text: 'x'.repeat(1801) }]) }).status, 2);
});

test('last_assistant_message is measured ahead of a lagging transcript', () => {
    // The harness documents the transcript as written asynchronously: here it still holds the
    // previous turn's short answer while the payload field carries this turn's wall of text.
    const p = transcript('lag', 'did the build pass?', [{ type: 'text', text: SHORT }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, 'the transcript alone is short');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p, last_assistant_message: WALL }).status, 2, 'the field carries the wall');
    const d = transcript('lag-depth', 'walk me through it', [{ type: 'text', text: SHORT }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: d, last_assistant_message: WALL }).status, 0, 'the depth ask still comes from the transcript');
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: path.join(TMP, 'absent.jsonl'), last_assistant_message: WALL }).status, 0,
        'no transcript means no user message to judge - fail open');
});

test('the em-dash ban is enforced on the same prose the cap reads', () => {
    // Measured across four audited sessions: 32 em-dashes in 21,434 characters of prose in one, 4
    // in another, 2 each in two more - with this hook's own injection carrying 'single dashes,
    // never em-dashes' three times in the same transcript. The rule was stated every turn and
    // checked on no surface; the Stop branch already holds the answer, so it checks it here.
    const stop = (text, userText) => run({
        hook_event_name: 'Stop',
        transcript_path: transcript(`dash-${Math.random().toString(36).slice(2)}`, userText || 'what changed?', [{ type: 'text', text }]),
        last_assistant_message: text,
    });
    assert.strictEqual(stop(SHORT).status, 0, 'a clean short answer passes');
    const one = stop('Done \u2014 the build is green.');
    assert.strictEqual(one.status, 2, 'an em-dash in prose is blocked');
    assert.match(one.stderr, /single dashes/, 'the denial names the rule');
    assert.match(one.stderr, /replaced by a single dash/, '... and asks for the same answer, not a shorter one');
    assert.strictEqual(stop('Done. See `a — b` in the table.').status, 0, 'a code span is not prose - the cap reads the same text');
    assert.strictEqual(stop('```\nconst a = 1; // a — b\n```\nDone.').status, 0, 'and neither is a fenced block');
    // The length exemptions excuse the LENGTH; an em-dash is a character to replace, so they do not
    // reach it - a re-answer at the same length loses nothing.
    const deep = stop(`${WALL} — and that is the detail.`, 'walk me through it in detail');
    assert.strictEqual(deep.status, 2, 'a depth request excuses the wall of text, not the em-dash');
    assert.match(deep.stderr, /single dashes/, '... and the denial says so alone');
    assert.doesNotMatch(deep.stderr, /characters of prose - the house budget/, '... without demanding a shorter answer');
    // Both wrong at once: ONE denial, naming both.
    const both = stop(`${WALL} — done.`);
    assert.strictEqual(both.status, 2, 'over the cap and carrying an em-dash');
    assert.match(both.stderr, /also uses 1 em-dash/, 'the length denial carries the voice fix');
    assert.match(both.stderr, /characters of prose/, '... and still names the length');
    // audit 2026-10-08: one dash class with the stop contract's ask deny (hook-prelude.js HOUSE_DASH)
    assert.strictEqual(stop('Done \u2013 the build is green.').status, 2, 'an en-dash, which the ask deny already read');
    assert.strictEqual(stop('Done \u2015 the build is green.').status, 2, 'the horizontal bar');
});

// The interaction rule's 're-ask on the SAME deliverable -> ONE format AskUserQuestion' shipped as
// prose and lost: nine corrections, nine redrafts of one report, 1.64M cache-read, no ask
// (measured). The UserPromptSubmit half now names the ask on the third short turn in a row that
// follows a long answer - injection only, so a wrong guess costs one sentence, never a turn.
test('UserPromptSubmit names the format ask after three short turns that each followed a long answer', () => {
    const long = (id) => ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text: WALL }] } });
    const short = (t) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] } });
    const rows = [short('write the report'), long('a1'), short('no, shorter'), long('a2'), short('drop the table'), long('a3')];
    const write = (name, rs) => { const p = path.join(TMP, name + '.jsonl'); fs.writeFileSync(p, rs.map((r) => JSON.stringify(r)).join('\n') + '\n'); return p; };
    const ctxOf = (prompt, tp) => JSON.parse(run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: tp }).stdout).hookSpecificOutput.additionalContext;
    const ctx = ctxOf('and in Ukrainian', write('streak', rows));
    assert.match(ctx, /FORMAT ASK/, 'the third short correction gets the format-ask line');
    assert.match(ctx, /3 consecutive short turns/, '... naming the count');
    assert.match(ctx, /3 sentences/, '... beside the budget, not instead of it');
    assert.doesNotMatch(ctxOf('and in Ukrainian', write('streak2', rows.slice(0, 4))), /FORMAT ASK/, 'two short turns are a conversation, not a streak');
    assert.doesNotMatch(ctxOf(WALL, write('streak3', rows)), /FORMAT ASK/, 'a long turn is a brief, not a correction');
    assert.doesNotMatch(ctxOf('<command-name>/help</command-name>', write('streak4', rows)), /FORMAT ASK/, 'a slash turn is not a correction');
});

// R3: the em-dash check reads last_assistant_message, which the harness sends whether or not the
// transcript is readable - an unreadable transcript skipped it along with the length check.
test('an unreadable transcript still gets the em-dash check - only the length half needs the user row', () => {
    const r = run({ hook_event_name: 'Stop', session_id: 'r3', transcript_path: path.join(TMP, 'absent.jsonl'),
        last_assistant_message: 'Done — the build is green.' });
    assert.strictEqual(r.status, 2, 'the dash is judged from the payload text');
    assert.match(r.stderr, /em-dash/);
    const long = run({ hook_event_name: 'Stop', session_id: 'r3b', transcript_path: path.join(TMP, 'absent.jsonl'), last_assistant_message: WALL });
    assert.strictEqual(long.status, 0, 'length stays fail-open: with no user row, depth cannot be ruled out');
});

// R5: a stop-contract block from the PREVIOUS turn, still inside two minutes, was read as this
// turn's, and the em-dash denial told the model to obey a block it never saw this turn.
test('a stop-contract row older than this turn does not make the em-dash denial yield', () => {
    const sid = 'r5';
    const ledger = path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'docs', 'hook-blocks');
    fs.mkdirSync(ledger, { recursive: true });
    const prior = new Date(Date.now() - 60 * 1000).toISOString();
    fs.writeFileSync(path.join(ledger, `${sid}.jsonl`), JSON.stringify({ ts: prior, hook: 'guard-stop-contract.js', event: 'Stop', tool: '', reason: 'Blocked: x' }) + '\n');
    const p = path.join(TMP, 'r5.jsonl');
    fs.writeFileSync(p, [
        { type: 'user', timestamp: new Date(Date.now() - 20 * 1000).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'status?' }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done — green.' }] } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = run({ hook_event_name: 'Stop', session_id: sid, transcript_path: p, last_assistant_message: 'Done — green.' });
    assert.strictEqual(r.status, 2);
    assert.doesNotMatch(r.stderr, /has already blocked this same turn/, 'the row predates the typed prompt, so it is another turn');
    fs.appendFileSync(path.join(ledger, `${sid}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), hook: 'guard-stop-contract.js', event: 'Stop', tool: '', reason: 'Blocked: y' }) + '\n');
    assert.match(run({ hook_event_name: 'Stop', session_id: sid, transcript_path: p, last_assistant_message: 'Done — green.' }).stderr,
        /has already blocked this same turn/, 'a row from this turn still yields');
});

// The correction nudge (ECC comparison R3, log-only first). The single-turn test used to be a SHAPE -
// a short turn right after a 1,500+ char answer - and the replay over the local transcripts put its
// precision near one in eight: status checks ('how much time is left?') and requests counted as
// corrections. It is now a short turn that follows an answer AND carries a correction marker. Each hit
// writes one `mode: probe` / `kind: correction` row; ALFRED_CODE_CORRECTION_NUDGE=inject also hands the
// save line back, `0` switches it off.
const ledgerRows = (sid) => {
    const f = path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'docs', 'hook-blocks', `${sid}.jsonl`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
const correctionRows = (sid) => ledgerRows(sid).filter((r) => r.mode === 'probe' && r.kind === 'correction');
let nudgeSeq = 0;
function prompted(prompt, { rows, env } = {}) {
    const sid = `nudge-${++nudgeSeq}`;
    const p = path.join(TMP, `${sid}.jsonl`);
    const rs = rows || [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'set up the pipeline' }] } },
        { type: 'assistant', message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Done - the workflow runs lint and tests.' }] } },
    ];
    fs.writeFileSync(p, rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt, transcript_path: p }),
        encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
    assert.strictEqual(r.status, 0, 'the nudge never blocks a prompt');
    return { sid, rows: correctionRows(sid), ctx: JSON.parse(r.stdout).hookSpecificOutput.additionalContext };
}

test('the correction test counts a short turn carrying a correction marker, after any answer', () => {
    for (const prompt of ['I meant the CI pipeline', 'no, shorter', 'shorter', 'But there is no resume block', 'Why did you stop?',
        'I told you to use the org token', 'Do not commit when you finish the whole work', 'Elementor updated, but the error is still there',
        'It’s wrong approach of CI', 'you forgot the tests', 'I do not want the host in that url', 'that name does not fit',
        'Okay but do not forget to verify changes', 'you said 30 minutes, but they have passed']) {
        const { rows } = prompted(prompt);
        assert.strictEqual(rows.length, 1, `a correction: ${prompt}`);
        assert.strictEqual(rows[0].hook, 'guard-answer-length.js');
        assert.strictEqual(rows[0].event, 'UserPromptSubmit');
        assert.ok(rows[0].detail && rows[0].detail.marker, 'the row names the marker that matched');
        assert.ok(!JSON.stringify(rows[0]).includes(prompt.slice(12)) || prompt.length < 24, 'the row carries the marker, never the prompt');
    }
});

test('the correction test leaves questions, status checks and requests alone', () => {
    for (const prompt of ['how much time is left?', 'Are you still running?', 'But is it effective?', 'what about an MCP instead of skills?',
        'Why you cannot connect to the staging backend?', 'continue', 'yes, do it', 'push', 'Stop or run?', 'have you finished?',
        'Commit current changes!', 'Set the docs versioning to local', 'what is left?']) {
        assert.deepStrictEqual(prompted(prompt).rows, [], `not a correction: ${prompt}`);
    }
});

// Audit 2026-10-11 SD14, session 5f9fec85: a request matched the weak 'it should be' inside a wh-clause ('investigate
// what type of a ticket it should be') and was logged as a correction.
test('the weak \'it should\' marker inside a wh-clause is no correction; standing alone it still is', () => {
    for (const prompt of ['Create a ticket for the browser extension, but before investigate what type of a ticket it should be',
        'check how it should be wired', 'find out which branch this should go to']) {
        assert.deepStrictEqual(prompted(prompt).rows, [], `a wh-clause: ${prompt}`);
    }
    for (const prompt of ['it should be the staging branch', 'Check the log. It should be empty', 'what a mess, it should be one file']) {
        assert.strictEqual(prompted(prompt).rows.length, 1, `a correction: ${prompt}`);
    }
});

// Audit 2026-10-20 C20 (4a210c3c, 3a8a1ee3): a request for an explanation and the user's remark about their own system
// were logged as corrections of the model.
test('C20: \'why you\' after an explain verb and a \'not working\' inside a stated reason are no correction; bare, both still are', () => {
    for (const prompt of ['Explain why you choose such an approach', 'Can you explain why you did that?', 'tell me why you picked Redis',
        'push without ci (because it;s not working right now)', 'merge it, because the staging deploy doesn\'t work today']) {
        assert.deepStrictEqual(prompted(prompt).rows, [], `not a correction: ${prompt}`);
    }
    for (const prompt of ['why did you delete the test?', 'Why you changed the port?', 'it is not working', 'the build doesn\'t work',
        'because your change broke it, it\'s not working']) {
        assert.strictEqual(prompted(prompt).rows.length, 1, `a correction: ${prompt}`);
    }
});

test('the correction test needs an answer before it, a typed turn and at most 200 characters', () => {
    const userOnly = [{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }];
    assert.deepStrictEqual(prompted('no, use the org token', { rows: userOnly }).rows, [], 'a first turn corrects nothing');
    assert.deepStrictEqual(prompted('/review no, shorter').rows, [], 'a slash command is not a correction');
    const at = 'no, ' + 'x'.repeat(196);
    assert.strictEqual(at.length, 200);
    assert.strictEqual(prompted(at).rows.length, 1, '200 characters is still a short turn');
    assert.deepStrictEqual(prompted(at + 'x').rows, [], '201 is a brief, not a correction');
    const interrupted = [
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'set up the pipeline' }] } },
        { type: 'assistant', message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] } },
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    ];
    assert.strictEqual(prompted('no, the other workflow', { rows: interrupted }).rows.length, 1, 'an interruption row sits between the answer and its correction');
    const noTranscript = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'nudge-none', prompt: 'no, shorter' }), encoding: 'utf8' });
    assert.strictEqual(noTranscript.status, 0);
    assert.deepStrictEqual(correctionRows('nudge-none'), [], 'no transcript, no answer to correct - fail-open');
});

test('ALFRED_CODE_CORRECTION_NUDGE: log writes the row only, inject adds the save line, 0 is off', () => {
    const LINE = /this reads as a correction - store it with memory_store \(user_correction, project tag\) before continuing/;
    const log = prompted('no, shorter');
    assert.strictEqual(log.rows.length, 1);
    assert.strictEqual(log.rows[0].injected, false);
    assert.doesNotMatch(log.ctx, LINE, 'log (the seed, and the value when absent) injects nothing');
    assert.match(log.ctx, /3 sentences/, 'the budget still goes out');
    const inject = prompted('no, shorter', { env: { ALFRED_CODE_CORRECTION_NUDGE: 'inject' } });
    assert.strictEqual(inject.rows.length, 1);
    assert.strictEqual(inject.rows[0].injected, true);
    assert.match(inject.ctx, /a preference it states \('per project, never global'\) as preference_signal/, 'audit 2026-10-11 SD16 (ce9d4811): a stated preference is named with its type');
    assert.match(inject.ctx, LINE);
    // The memory tools are DEFERRED (alfred-memory.md): naming one is not having it, so the line carries its loader (2.1.5 M11).
    assert.match(inject.ctx, /ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store\b/, 'the save line loads the deferred tool');
    // 84eedb4b (audit 2026-10-10, T5 cross-track): a stated project fact rode a correction and was never stored
    assert.match(inject.ctx, /a project fact it states \(a branch, an environment, a version pairing\) as a reference memory/, 'the save line names the fact type too');
    assert.doesNotMatch(prompted('how much time is left?', { env: { ALFRED_CODE_CORRECTION_NUDGE: 'inject' } }).ctx, LINE, 'no correction, no line');
    for (const off of ['0', 'off']) {
        const o = prompted('no, shorter', { env: { ALFRED_CODE_CORRECTION_NUDGE: off } });
        assert.deepStrictEqual(o.rows, [], `${off} writes no row`);
        assert.doesNotMatch(o.ctx, LINE);
    }
});

// Audit 2026-10-10 C15 / C07: an answer TYPED into an ask (its Other field) is the user speaking, but it arrives as a
// tool result - the prompt-time correction test never saw it (4f1c2ebb, 8f44a003) and an answer naming a folder was
// never opened (69dbed46).
let askSeq = 0;
function answered(answers, { questions, env, text } = {}) {
    const sid = `ask-${++askSeq}`;
    const qs = questions || [{ question: 'Run the demo login?', options: [{ label: 'Scripted login (Recommended)' }, { label: 'Skip it' }] }];
    const tool_response = text !== undefined ? text : { questions: qs, answers };
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', session_id: sid,
        tool_input: { questions: qs }, tool_response }), encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
    assert.strictEqual(r.status, 0, 'the typed-answer probe never blocks');
    const ctx = r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
    return { rows: ledgerRows(sid), ctx };
}
test('an answer typed into an ask is logged, a correction in it counts, a path in it is opened first (audit 2026-10-10 C15)', () => {
    const picked = answered({ 'Run the demo login?': 'Scripted login (Recommended)' });
    assert.deepStrictEqual(picked.rows, [], 'a picked label is no typed answer');
    assert.strictEqual(picked.ctx, '');
    const corr = answered({ 'Run the demo login?': 'Why you bother me with that, log in yourself right now!' });
    assert.deepStrictEqual(corr.rows.map((r) => r.kind), ['ask-answer-typed', 'correction'], 'the correction test reads the typed answer');
    assert.strictEqual(corr.rows[1].detail.via, 'ask-answer');
    assert.strictEqual(corr.ctx, '', 'log mode injects nothing');
    const inj = answered({ 'Run the demo login?': 'no, do not script it' }, { env: { ALFRED_CODE_CORRECTION_NUDGE: 'inject' } });
    assert.match(inj.ctx, /CORRECTION: the answer typed into the ask reads as a correction/);
    const fact = answered({ 'Run the demo login?': 'Already logged in; if http://127.0.0.1:9030/login shows a loading bar, wait until it loads.' });
    assert.deepStrictEqual(fact.rows.map((r) => r.kind), ['ask-answer-typed'], 'a project fact is logged, never a correction');
    assert.strictEqual(fact.ctx, '', 'a URL is no path to open');
    const dir = answered({ 'Where does the card go?': 'It is on ../sibling-app/.claude/docs/cross-project-tasks folder' },
        { questions: [{ question: 'Where does the card go?', options: [{ label: 'Here (Recommended)' }, { label: 'Later' }] }] });
    assert.match(dir.ctx, /names a path \(\.\.\/sibling-app\/\.claude\/docs\/cross-project-tasks\)\. Open it before acting/);
    assert.strictEqual(dir.rows[0].detail.path, true);
    const multi = answered({ 'Which?': 'A, B' }, { questions: [{ question: 'Which?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] });
    assert.deepStrictEqual(multi.rows, [], 'a multi-select pick of offered labels is no typed answer');
    const textForm = answered(null, { text: 'The user answered: "Run the demo login?"="no, wrong account". Read the answers carefully.' });
    assert.deepStrictEqual(textForm.rows.map((r) => r.kind), ['ask-answer-typed', 'correction'], 'the text form of the result is read too');
    const off = answered({ 'Run the demo login?': 'no, wrong account' }, { env: { ALFRED_CODE_CORRECTION_NUDGE: '0' } });
    assert.deepStrictEqual(off.rows.map((r) => r.kind), ['ask-answer-typed'], 'the nudge switch off keeps the typed row only');
    assert.strictEqual(run({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_response: 'garbage' }).status, 0);
});

// Audit 2026-10-10 C25, 758ce661: the 780-char budget rode a background gate's completion notice (~195 tokens carried on
// every later message). A harness task notice is no user turn.
test('a task notice arriving as a prompt gets no budget and no correction row', () => {
    const sid = 'notice-1';
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid,
        prompt: '<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n<summary>no, the gate is wrong</summary>\n</task-notification>' }),
        encoding: 'utf8', env: { ...process.env } });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '', 'nothing injected');
    assert.deepStrictEqual(correctionRows(sid), [], 'no row');
    // a seat's hand-back is the same: 351 of 960 budget injections in a week rode one (audit 2026-10-14 HK14)
    const back = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid,
        prompt: 'Another Claude session sent a message:\n<agent-message from="a1b2">\n[Subagent hand-back] no, the gate is wrong\n</agent-message>' }),
        encoding: 'utf8', env: { ...process.env } });
    assert.strictEqual(back.status, 0);
    assert.strictEqual(back.stdout, '', 'nothing injected for a hand-back');
    assert.deepStrictEqual(correctionRows(sid), [], 'and no row');
    assert.match(prompted('next step please').ctx, /3 sentences/, 'a typed prompt still gets the budget');
});
