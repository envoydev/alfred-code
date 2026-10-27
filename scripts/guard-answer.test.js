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

function run(payload, env = {}) {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } });
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
    const LINE = /this reads as a correction - keep what it teaches before continuing/;
    const log = prompted('no, shorter');
    assert.strictEqual(log.rows.length, 1);
    assert.strictEqual(log.rows[0].injected, false);
    assert.doesNotMatch(log.ctx, LINE, 'log (the seed, and the value when absent) injects nothing');
    assert.match(log.ctx, /3 sentences/, 'the budget still goes out');
    const inject = prompted('no, shorter', { env: { ALFRED_CODE_CORRECTION_NUDGE: 'inject' } });
    assert.strictEqual(inject.rows.length, 1);
    assert.strictEqual(inject.rows[0].injected, true);
    assert.match(inject.ctx, /a preference it states \('per project, never global'\) as an entry in the preferences docs \(\/capture-preferences\)/, 'audit 2026-10-11 SD16 (ce9d4811): a stated preference is named with its home');
    assert.match(inject.ctx, LINE);
    // The stack depends on no memory server (2026-10-24): the line names no MCP tool.
    assert.doesNotMatch(inject.ctx, /mcp__|memory_store/, 'the save line names no server');
    // 84eedb4b (audit 2026-10-10, T5 cross-track): a stated project fact rode a correction and was never stored
    assert.match(inject.ctx, /a project fact it states \(a branch, an environment, a version pairing\) in Claude Code's own memory/, 'the save line names the fact\'s home too');
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

// ---------------------------------------------------------------------------------------------
// the scorer (mode-output-scorer): --mode-output-scorer-on|off, the on line, the stacked line, the ON line, compaction
// ---------------------------------------------------------------------------------------------
const { scorerFile } = require('../stack/hooks/hook-prelude.js');
const ROOT = process.env.CLAUDE_PROJECT_DIR;
const SKILL_COPY = path.join(ROOT, '.claude', 'skills', 'mode-output-scorer');
const seedSkillCopy = () => { fs.mkdirSync(SKILL_COPY, { recursive: true }); fs.writeFileSync(path.join(SKILL_COPY, 'SKILL.md'), '---\nname: mode-output-scorer\n---\n'); };
seedSkillCopy();
const SCORER_CFG = { CLAUDE_CONFIG_DIR: fs.mkdtempSync(path.join(TMP, 'cfg-')) };   // no account copy or override reaches in
const ON = { ALFRED_CODE_SCORER: '1' };
const ON_LINE = ' - load mode-output-scorer before releasing a designer plan file, root-cause verdict or inline plan for work started now; --mode-output-scorer-off after a command stops it';
const ctxOf = (result) => JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
const msgOf = (sid, text, env = {}, extra = {}) => JSON.parse(run({ hook_event_name: 'UserPromptSubmit', prompt: text, session_id: sid, ...extra }, { ...SCORER_CFG, ...env }).stdout).systemMessage;
const prompt = (sid, text, env = {}) => ctxOf(run({ hook_event_name: 'UserPromptSubmit', prompt: text, session_id: sid }, { ...SCORER_CFG, ...env }));
const said = (payload, env = {}) => run(payload, { ...SCORER_CFG, ...env }).stdout;
const stateOf = (sid) => { try { return fs.readFileSync(scorerFile(ROOT, sid), 'utf8'); } catch { return null; } };
const scorerRows = (kind) => {
    const dir = path.join(ROOT, '.alfred', 'statistics', 'hook-blocks');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((r) => r.kind === kind);
};
const settingsLocal = path.join(ROOT, '.claude', 'settings.local.json');
const writeOverride = (name, value) => fs.writeFileSync(settingsLocal, JSON.stringify({ skillOverrides: { [name]: value } }));
const clearOverride = () => fs.rmSync(settingsLocal, { force: true });
// the AUTO stamp a typed --mode-auto-run-on writes, naming its session (auto-mode.test.js autoStamp)
const APPROVAL = path.join(ROOT, '.alfred', 'state', 'approvals', 'APPROVAL');
const autoStamp = (sid) => { fs.mkdirSync(path.dirname(APPROVAL), { recursive: true }); fs.writeFileSync(APPROVAL, `AUTO - "/loop-code-quality --mode-auto-run-on"\nsession: ${sid}\nskill: loop-code-quality\n`); };

test('scorer: env on injects the on line with the level, the run cap and every listed output (AC2)', () => {
    assert.ok(prompt('a1', 'plan it', ON).endsWith(` scorer: on (level 80, rounds 3, env)${ON_LINE}`));
});
test('scorer: --mode-output-scorer-on in the leading run holds for later prompts; -off writes off (AC7)', () => {
    assert.match(prompt('a2', '/task-solve --mode-output-scorer-on go'), /scorer: on \(level 80, rounds 3, flag\)/);
    assert.match(stateOf('a2'), /^on\nat: /);
    assert.match(prompt('a2', 'next'), /scorer: on \(level 80, rounds 3, flag\)/);
    assert.doesNotMatch(prompt('a3', 'next'), /scorer:/);
    assert.match(prompt('a2', '/loop-code-quality --mode-output-scorer-off'), / scorer: off for this session$/);
    assert.match(stateOf('a2'), /^off\nat: /);
    assert.doesNotMatch(prompt('a2', 'next'), /scorer:/);
});
test('scorer: --mode-output-scorer-off beats env on, and says so once (AC4)', () => {
    assert.match(prompt('a4', '/task-solve --mode-output-scorer-off x', ON), / scorer: off for this session$/);
    assert.doesNotMatch(prompt('a4', 'next', ON), /scorer:/);
});
test('scorer: a flag outside the leading run, or with no family command, switches nothing (AC7)', () => {
    for (const text of ['go --mode-output-scorer-on', '/task-solve fix x --mode-output-scorer-on', '/review-code --mode-output-scorer-on x',
        'what does `/task-solve --mode-output-scorer-on` do', '> /task-solve --mode-output-scorer-on x', '--score-on', '/task-solve --score-on x'])
        assert.doesNotMatch(prompt('a5', text), /scorer: on/, text);
    assert.strictEqual(stateOf('a5'), null);
});
test('scorer: a flag-only /mode-output-scorer line is no stack (AC7)', () => {
    assert.match(prompt('a5b', '/mode-output-scorer --mode-output-scorer-on'), /scorer: on \(level 80, rounds 3, flag\)/);
    assert.match(stateOf('a5b'), /^on\n/);
    assert.doesNotMatch(prompt('a5b', '/mode-output-scorer --mode-output-scorer-on'), /scorer: stacked/);
    assert.doesNotMatch(prompt('a5b', '/mode-output-scorer --mode-output-scorer-off'), /scorer: stacked/);
    assert.match(stateOf('a5b'), /^off\n/);
    assert.match(prompt('a5b', '/mode-output-scorer --mode-output-scorer-on explain x'), /scorer: stacked for this request/);
});
test('scorer: both flags in one message - off wins', () => {
    assert.match(prompt('a6', '/task-solve --mode-output-scorer-on --mode-output-scorer-off x', ON), /off for this session/);
    assert.match(stateOf('a6'), /^off\n/);
});
test('scorer: the level and the run cap read their defaults for bad values and as given in range (AC6, AC23)', () => {
    for (const [v, want] of [['59', 80], ['101', 80], ['abc', 80], ['', 80], ['60', 60], ['100', 100]])
        assert.match(prompt('a7', 'x', { ...ON, ALFRED_CODE_SCORER_LEVEL: v }), new RegExp(`level ${want}, rounds 3, env`), `level ${v}`);
    for (const [v, want] of [['0', 3], ['11', 3], ['abc', 3], ['', 3], ['1', 1], ['10', 10]])
        assert.match(prompt('a7', 'x', { ...ON, ALFRED_CODE_SCORER_ROUNDS: v }), new RegExp(`level 80, rounds ${want}, env`), `rounds ${v}`);
});
test('scorer: the outputs list narrows the phrases; a bad name is ignored with one row per session (AC24, R25)', () => {
    assert.match(prompt('a8', 'x', { ...ON, ALFRED_CODE_SCORER_OUTPUTS: 'designer-plan,root-cause' }), /releasing a designer plan file or root-cause verdict;/);
    assert.match(prompt('a8', 'x', { ...ON, ALFRED_CODE_SCORER_OUTPUTS: ' Root-Cause ' }), /releasing a root-cause verdict;/);
    for (const bad of ['topic-explainer', 'foo']) {
        const env = { ...ON, ALFRED_CODE_SCORER_OUTPUTS: bad };
        assert.ok(prompt(`a9${bad}`, 'x', env).endsWith(ON_LINE), bad);
        prompt(`a9${bad}`, 'y', env);
        assert.strictEqual(scorerRows('scorer-outputs-ignored').filter((r) => r.detail.name === bad).length, 1, bad);
    }
});
test('scorer: the auto-run word while the session holds a live AUTO stamp, and the longest line stays under 230 chars', () => {
    autoStamp('b5');
    const ctx = prompt('b5', '/task-solve --mode-output-scorer-on x', { ALFRED_CODE_SCORER_LEVEL: '100', ALFRED_CODE_SCORER_ROUNDS: '10' });
    fs.rmSync(APPROVAL, { force: true });
    const line = ctx.slice(ctx.indexOf('scorer: on'), ctx.indexOf(' auto-run: on'));
    assert.match(line, /^scorer: on \(level 100, rounds 10, flag, auto-run\) - /);
    assert.ok(line.length <= 230, `${line.length}`);
});
test('scorer: a typed stack with the switch off injects the stacked line; the name in code or a quote does not (AC25)', () => {
    const STACKED = 'scorer: stacked for this request (level 80, rounds 3) - grade this request\'s output with mode-output-scorer before releasing it';
    for (const t of ['/task-version-upgrade /mode-output-scorer upgrade to .NET 10', 'using mode-output-scorer, explain closures'])
        assert.ok(prompt('c1', t).endsWith(` ${STACKED}`), t);
    for (const t of ['what does `/mode-output-scorer` do', '> /mode-output-scorer x'])
        assert.doesNotMatch(prompt('c1', t), /scorer:/, t);
    assert.strictEqual(stateOf('c1'), null, 'a stack writes no state file');
});
test('scorer: the bare name in a question is talk - only the slash form or a usage word stacks it (final review 4)', () => {
    assert.doesNotMatch(prompt('c2', 'why did mode-output-scorer not run?'), /scorer: stacked for this request/);
    assert.match(prompt('c2b', 'explain closures with mode-output-scorer'), /scorer: stacked for this request/);
});
test('scorer: --mode-output-scorer-on and a stack in one message carry both lines, on first', () => {
    const ctx = prompt('c3', '/task-solve /mode-output-scorer --mode-output-scorer-on explain x');
    assert.ok(ctx.indexOf('scorer: on (') >= 0 && ctx.indexOf('scorer: on (') < ctx.indexOf('scorer: stacked'), ctx);
});
test('scorer: user-invocable-only - no on line with the switch on, a stack still gets its line (AC19)', () => {
    writeOverride('mode-output-scorer', 'user-invocable-only');
    assert.doesNotMatch(prompt('c4', 'x', ON), /scorer: on/);
    assert.match(prompt('c4', '/mode-output-scorer explain x', ON), /scorer: stacked/);
    clearOverride();
});
test('scorer: no skill copy, or skillOverrides off - no line, a stack included (AC19)', () => {
    writeOverride('mode-output-scorer', 'off');
    assert.doesNotMatch(prompt('c5', '/mode-output-scorer x', ON), /scorer:/);
    clearOverride(); fs.rmSync(SKILL_COPY, { recursive: true });
    assert.doesNotMatch(prompt('c5', '/mode-output-scorer x', ON), /scorer:/);
    seedSkillCopy();
});
test('scorer: guard-answer, guard-stop-contract, or either scorer part off - no line, a stack included (AC13, AC20)', () => {
    for (const off of ['guard-answer', 'guard-answer:scorer', 'guard-stop-contract', 'guard-stop-contract:scorer'])
        assert.ok(!said({ hook_event_name: 'UserPromptSubmit', prompt: '/mode-output-scorer x', session_id: 'c6' }, { ...ON, ALFRED_CODE_HOOKS_OFF: off }).includes('scorer:'), off);
});
test('scorer: a payload with agent_id, a harness prompt, and all four keys unset - no line, no file (AC1)', () => {
    assert.ok(!said({ hook_event_name: 'UserPromptSubmit', prompt: '/task-solve --mode-output-scorer-on x', session_id: 'd1', agent_id: 'g1' }).includes('scorer:'));
    assert.ok(!said({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>done</task-notification> /task-solve --mode-output-scorer-on x', session_id: 'd1' }).includes('scorer:'));
    assert.doesNotMatch(prompt('d1', 'plain'), /scorer:/);
    assert.strictEqual(stateOf('d1'), null);
});
test('scorer: a garbage session file reads as absent and leaves one scorer-file-garbage row', () => {
    fs.mkdirSync(path.dirname(scorerFile(ROOT, 'd2')), { recursive: true }); fs.writeFileSync(scorerFile(ROOT, 'd2'), 'garbage');
    assert.match(prompt('d2', 'x', ON), /level 80, rounds 3, env/);
    assert.strictEqual(scorerRows('scorer-file-garbage').length, 1);
});
test('scorer: a plain prompt sweeps an 8-day-old scorer folder (R11)', () => {
    const dir = path.join(ROOT, '.alfred', 'state', 'sessions', 'scorer');
    const old = path.join(dir, 'gone', 'x', 'ab12cd34.draft.md'); fs.mkdirSync(path.dirname(old), { recursive: true }); fs.writeFileSync(old, 'd');
    const s = (Date.now() - 8 * 86400000) / 1000; fs.utimesSync(old, s, s);
    fs.rmSync(path.join(dir, '.alfred-sweep-scorer'), { force: true });     // an earlier prompt may have swept today
    prompt('d3', 'plain', ON);
    assert.ok(!fs.existsSync(path.join(dir, 'gone')));
});
test('scorer: the compaction route carries the on line while on, and nothing while off', () => {
    const compact = (env) => ctxOf(run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'd4' }, { ...SCORER_CFG, ...env }));
    assert.match(compact(ON), /scorer: on \(level 80, rounds 3, env\)/);
    assert.doesNotMatch(compact({}), /scorer:/);
});

// ---------------------------------------------------------------------------------------------
// the ON line (stack-modes spec section 3): one systemMessage listing the modes on, computed from the prompt's own flags
// ---------------------------------------------------------------------------------------------
const AUTO_LINE = 'auto-run: on for this session - each ask takes its (Recommended) option; only --mode-auto-run-off after a command ends it';
const clearStamp = () => fs.rmSync(APPROVAL, { force: true });
test('ON line: lists exactly the modes on, on the prompt that turns one on or off, /mode-auto-run fix X included (AC8)', () => {
    clearStamp();
    assert.strictEqual(msgOf('e1', 'plain'), undefined, 'nothing on - no message');
    assert.strictEqual(msgOf('e1', '/task-solve --mode-auto-run-on fix x'), 'Modes ON: auto-run');
    assert.strictEqual(msgOf('e2', '/mode-auto-run fix X'), 'Modes ON: auto-run');
    assert.strictEqual(msgOf('e3', '/task-solve --mode-output-scorer-on x'), 'Modes ON: output-scorer (level 80)');
    assert.strictEqual(msgOf('e3', 'next'), 'Modes ON: output-scorer (level 80)');
    assert.strictEqual(msgOf('e4', '/task-solve --mode-auto-run-on --mode-output-scorer-on x', { ALFRED_CODE_SCORER_LEVEL: '90' }), 'Modes ON: auto-run, output-scorer (level 90)');
    autoStamp('e5');
    assert.strictEqual(msgOf('e5', 'next', ON), 'Modes ON: auto-run, output-scorer (level 80)');
    assert.ok(prompt('e5', 'next').endsWith(` ${AUTO_LINE}`));
    assert.strictEqual(msgOf('e5', '/mode-auto-run --mode-auto-run-off', ON), 'Modes ON: output-scorer (level 80)');
    assert.strictEqual(msgOf('e5', '/task-solve --mode-auto-run-off --mode-output-scorer-off x', ON), undefined);
    clearStamp();
    assert.doesNotMatch(prompt('e6', 'next'), /auto-run: on/);
});
test('ON line: a refused -on (another session running, read-only data root, empty /mode-auto-run) does not list auto-run (AC8)', () => {
    clearStamp();
    assert.strictEqual(msgOf('f1', '/mode-auto-run'), undefined, 'an empty /mode-auto-run');
    assert.strictEqual(msgOf('f1', '/mode-auto-run', ON), 'Modes ON: output-scorer (level 80)');
    // another session's stamp, its transcript beside this one written just now
    const tdir = fs.mkdtempSync(path.join(TMP, 'tr-'));
    fs.writeFileSync(path.join(tdir, 'other-sid.jsonl'), '{}\n');
    fs.writeFileSync(path.join(tdir, 'f2.jsonl'), '{}\n');
    fs.mkdirSync(path.dirname(APPROVAL), { recursive: true });
    fs.writeFileSync(APPROVAL, 'AUTO - "/task-solve --mode-auto-run-on x"\nsession: other-sid\nskill: task-solve\n');
    assert.strictEqual(msgOf('f2', '/task-solve --mode-auto-run-on fix x', {}, { transcript_path: path.join(tdir, 'f2.jsonl') }), undefined, 'another session running');
    clearStamp();
    // a data root that cannot be written
    const ro = fs.mkdtempSync(path.join(TMP, 'ro-'));
    fs.chmodSync(ro, 0o555);
    try {
        const out = JSON.parse(run({ hook_event_name: 'UserPromptSubmit', prompt: '/task-solve --mode-auto-run-on fix x', session_id: 'f3' }, { ...SCORER_CFG, CLAUDE_PROJECT_DIR: ro }).stdout);
        assert.strictEqual(out.systemMessage, undefined, 'read-only data root');
    } finally { fs.chmodSync(ro, 0o755); }
});
test('ON line: the prompt flag beats the stored state, so the parallel end hook cannot race it (Review Focus 3)', () => {
    autoStamp('g1');   // the stamp still stands: the start hook's -off has not run yet
    assert.strictEqual(msgOf('g1', '/loop-code-quality --mode-auto-run-off'), undefined);
    assert.doesNotMatch(prompt('g1', '/loop-code-quality --mode-auto-run-off'), /auto-run: on/);
    clearStamp();      // no stamp yet: the start hook's write has not landed
    assert.strictEqual(msgOf('g2', '/loop-code-quality --mode-auto-run-on'), 'Modes ON: auto-run');
    assert.ok(prompt('g2b', '/loop-code-quality --mode-auto-run-on').endsWith(` ${AUTO_LINE}`));
    assert.strictEqual(fs.existsSync(APPROVAL), false, 'guard-answer writes no stamp');
});
test('ON line: a mode flag after a non-family command lists nothing and switches nothing (AC9)', () => {
    clearStamp();
    assert.strictEqual(msgOf('h1', '/review-code --mode-auto-run-on X'), undefined);
    assert.strictEqual(msgOf('h1', '/habits-explain-topic --mode-output-scorer-on X'), undefined);
    assert.strictEqual(stateOf('h1'), null);
});
test('ON line: a seat or a harness prompt gets no message', () => {
    autoStamp('h2');
    assert.ok(!said({ hook_event_name: 'UserPromptSubmit', prompt: 'next', session_id: 'h2', agent_id: 'g1' }).includes('systemMessage'));
    assert.ok(!said({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>done</task-notification>', session_id: 'h2' }).includes('systemMessage'));
    clearStamp();
});
test('compaction: both context lines come back, no systemMessage', () => {
    autoStamp('k1');
    const out = JSON.parse(run({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'k1' }, { ...SCORER_CFG, ...ON }).stdout);
    clearStamp();
    assert.strictEqual(out.systemMessage, undefined);
    assert.match(out.hookSpecificOutput.additionalContext, /scorer: on \(level 80, rounds 3, env, auto-run\)/);
    assert.ok(out.hookSpecificOutput.additionalContext.endsWith(` ${AUTO_LINE}`));
});
