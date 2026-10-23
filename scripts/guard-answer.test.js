// Behavior tests for stack/hooks/guard-answer.js - the answer budget it injects, the correction streak it
// names, the typed-answer note after an ask, and the Stop silence the 2026-10-20 ruling left (it never blocks).
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

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-answer.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-hook-'));
// The hook appends a block row to `<root>/<data root>/statistics/hook-blocks/`, and the root falls back to the
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
    // Ruling S9 (the user's, 2026-10-20): 'step by step' lifts the budget like the other depth words.
    assert.match(ctx, /\(in detail \/ walk me through \/ step by step \/ teach me \/ ELI5 \/ write a plan\)/, 'the lift list names step by step');
});

// The user's ruling 2026-10-20: the answer budget is the interaction rule's and is injected, never enforced - the
// length cap and the em-dash block at Stop are gone. A Stop payload, wired by hand or by an old install, is silent.
test('no Stop wiring, and a Stop payload is silent: no block, no output, whatever the answer holds', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'stack-manifest.json'), 'utf8'));
    const rows = manifest.hooks.filter((h) => h.file === path.basename(HOOK));
    assert.ok(rows.length > 0, 'the hook is still wired for its other events');
    assert.ok(!rows.some((h) => /@Stop$/.test(h.matcher)), 'no Stop row');
    const dashes = WALL + ' \u2014 an em-dash \u2014 '.repeat(5);
    for (const [name, ask, text] of [['wall', 'did the build pass?', WALL], ['dash', 'status?', dashes], ['short', 'status?', SHORT]]) {
        const r = run({ hook_event_name: 'Stop', transcript_path: transcript(name, ask, [{ type: 'text', text }]), last_assistant_message: text });
        assert.strictEqual(r.status, 0, name);
        assert.strictEqual(r.stdout, '', `${name}: no decision on stdout`);
        assert.strictEqual(r.stderr, '', `${name}: nothing on stderr`);
    }
});

test('fails open on unparseable input and an unknown event', () => {
    assert.strictEqual(run({ hook_event_name: 'PreCompact' }).status, 0);
    const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    // a JSON scalar parses fine and used to throw a TypeError on the first field read (exit 1, stack trace shown as a hook error)
    assert.strictEqual(spawnSync(process.execPath, [HOOK], { input: 'null', encoding: 'utf8' }).status, 0);
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

// The correction nudge (ECC comparison R3, log-only first). The single-turn test used to be a SHAPE -
// a short turn right after a 1,500+ char answer - and the replay over the local transcripts put its
// precision near one in eight: status checks ('how much time is left?') and requests counted as
// corrections. It is now a short turn that follows an answer AND carries a correction marker. Each hit
// writes one `mode: probe` / `kind: correction` row; ALFRED_CODE_CORRECTION_NUDGE=inject also hands the
// save line back, `0` switches it off.
const ledgerRows = (sid) => {
    const f = path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'statistics', 'hook-blocks', `${sid}.jsonl`);
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
        assert.strictEqual(rows[0].hook, 'guard-answer.js');
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

// Ruling S3 (2026-10-20): Claude Code closes an idle AskUserQuestion itself - `afkTimeoutMs` on the result and 'No
// response after <N>s - the user may be away from keyboard' in its text. That is no answer: the hook writes the session's
// timeout marker, one `ask-timeout` row and a note; an answered ask or a typed prompt clears the marker.
test('S3: an ask the idle timeout closed is no answer - marker, row and note; an answer or a typed prompt clears it', () => {
    const logDir = fs.mkdtempSync(path.join(TMP, 's3-'));
    const env = { ...process.env, ALFRED_CODE_HOOK_LOG_DIR: logDir };
    const sid = 's3-sess';
    const marker = path.join(logDir, `alfred-ask-timeout-${sid}`);
    const qs = [{ question: 'Approve the plan?', options: [{ label: 'Approve (Recommended)' }, { label: 'Change it' }] }];
    const post = (tool_response) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        session_id: sid, tool_input: { questions: qs }, tool_response }), encoding: 'utf8', env });
    const timedOut = post({ questions: qs, answers: {}, afkTimeoutMs: 60000 });
    assert.strictEqual(timedOut.status, 0, 'never blocks');
    assert.match(JSON.parse(timedOut.stdout).hookSpecificOutput.additionalContext, /timed out - nobody answered it.*no approval/);
    assert.ok(fs.existsSync(marker), 'the session marker is written');
    assert.deepStrictEqual(ledgerRows(sid).map((r) => [r.mode, r.kind, r.detail.afkTimeoutMs]), [['probe', 'ask-timeout', 60000]]);
    post({ questions: qs, answers: { 'Approve the plan?': 'Approve (Recommended)' } });
    assert.ok(!fs.existsSync(marker), 'a real answer clears it');
    const text = post('No response after 60s — the user may be away from keyboard. Proceed using your best judgment based on the context so far.\nBefore going idle the user had selected: "Approve the plan?"="Approve (Recommended)".');
    assert.match(JSON.parse(text.stdout).hookSpecificOutput.additionalContext, /timed out/, 'the text form, picks made before going idle included');
    assert.ok(fs.existsSync(marker));
    spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: 'back - go on' }), encoding: 'utf8', env });
    assert.ok(!fs.existsSync(marker), 'a typed prompt clears it');
    const prelude = require('../stack/hooks/hook-prelude.js');
    assert.strictEqual(prelude.askTimedOut({ answers: { a: 'b' } }), false, 'a human-resolved result has no afkTimeoutMs');
    assert.strictEqual(prelude.askTimedOut('Your questions have been answered: "a"="b".'), false);
});

// Loading audit 2026-10-21 G3 and preferences ask Q-3 (the Recommended option, taken under the user's standing rule): a
// seat's own compaction start gets no answer budget - its report has its own shape - and a personal preferences entry
// sets the budget.
test('a seat\'s own compaction start carries no budget; the budget names the personal preferences doc', () => {
    assert.strictEqual(run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's', agent_id: 'agent-1', agent_type: 'alfred-code:web-angular-implementer' }).stdout, '');
    const text = JSON.parse(run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 's' }).stdout).hookSpecificOutput.additionalContext;
    assert.match(text, /an entry of the user's personal preferences doc sets it/);
});
