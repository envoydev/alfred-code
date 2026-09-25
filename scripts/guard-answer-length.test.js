// Behavior tests for stack/hooks/guard-answer-length.js - the short-answer contract's
// mechanization. A hook that fires on the wrong turn is worse than no hook (it trains the model
// to treat blocks as noise), so both directions are pinned: the wall-of-text block AND every
// exemption that must stay silent.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (/^(?:ALFRED_CODE|CLAUDE_STACK)_/.test(k) || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: the session's own stack env, in either spelling, never decides a case - legacy-name

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

test('Stop allows a wall of text when the depth request is Ukrainian or Russian', () => {
    for (const ask of ['розкажи детально', 'опиши покроково', 'розпиши будь ласка', 'напиши план',
        'расскажи подробно', 'объясни развернуто']) {
        const p = transcript('depth-cyr', ask, [{ type: 'text', text: WALL }]);
        assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 0, `'${ask}' must lift the cap`);
    }
});

test('Stop still blocks a Ukrainian question that asked for no depth', () => {
    const p = transcript('short-cyr', 'що робить цей хук?', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2);
});

test("Stop still blocks on a bare 'explain' - an explanation is capped like any other answer", () => {
    const p = transcript('explain', 'explain what the hook does', [{ type: 'text', text: WALL }]);
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p }).status, 2);
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
    assert.strictEqual(run({ hook_event_name: 'Stop', transcript_path: p, stop_hook_active: true }).status, 0);
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
    const one = stop('Done — the build is green.');
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
    const ledger = path.join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'docs', 'hook-blocks');
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
