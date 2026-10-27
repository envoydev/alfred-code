'use strict';
// conformance: the stack's claims graded over a real session - each window a skill or a turn opens, cut from one parse
// (item 7, 2026-10-25). The windows first, then the claims file, the state grader and the marker lint.
const test = require('node:test');
const assert = require('node:assert');
const sc = require('./skill-comply.js');
const cf = require('./conformance.js');

let seq = 0;
const tool = (name, input = {}) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const cmdRow = (name) => user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args></command-args>`);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const stepOf = (result, id) => result.steps.find((s) => s.id === id);

test('windowsOf: a Skill call and a typed command row both open it; the first ask closes it (A7.6, Review Focus 3)', () => {
    const run = sc.parseTranscript(jsonl([cmdRow('task-solve'), tool('Read', { file_path: 'a.md' }), tool('AskUserQuestion', { questions: [] }),
        tool('Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' }), user('next')]));
    assert.deepStrictEqual(cf.windowsOf(run, 'task-solve').map((w) => [w.from, w.to]), [[0, 2]]);
    const [{ result }] = cf.gradeSession(run, sc.loadExpectation('task-solve').data);
    assert.notStrictEqual(stepOf(result, 'nothing-builds').verdict, 'FAIL', 'the Edit after the gate is outside the window');
    const viaSkill = sc.parseTranscript(jsonl([user('fix it'), tool('Skill', { skill: 'alfred-code:task-solve' }), tool('Read', { file_path: 'a.md' }), user('more')]));
    assert.deepStrictEqual(cf.windowsOf(viaSkill, 'task-solve').map((w) => [w.from, w.to]), [[0, 2]]);
});
test('gradeSession: no window gives []; a per-turn expectation opens at each prompt', () => {
    assert.deepStrictEqual(cf.gradeSession(sc.parseTranscript(jsonl([user('hi')])), sc.loadExpectation('task-solve').data), []);
    const turns = sc.parseTranscript(jsonl([user('a'), tool('Read', { file_path: 'a.md' }), user('b'), tool('Read', { file_path: 'b.md' })]));
    assert.strictEqual(cf.gradeSession(turns, sc.loadExpectation('answer-budget').data).length, 2);
});
test('a harness row inside a window - a task notice, a compaction summary - neither closes it nor opens a turn', () => {
    const notice = user('<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>');
    const summary = { ...user('This session is being continued from a previous conversation.'), isCompactSummary: true };
    const run = sc.parseTranscript(jsonl([cmdRow('task-solve'), tool('Read', { file_path: 'a.md' }), notice, summary, tool('Write', { file_path: 'p.md', content: 'x' }), user('next')]));
    assert.deepStrictEqual(cf.windowsOf(run, 'task-solve').map((w) => [w.from, w.to]), [[0, 2]]);
    assert.deepStrictEqual(run.marks.map((m) => m.kind), ['command', 'attachment', 'attachment', 'prompt']);
    assert.strictEqual(cf.gradeSession(run, sc.loadExpectation('answer-budget').data).length, 1, 'one typed prompt, one turn');
});
test('sliceRun: events and marks cut and rebased, users from the typed marks inside, lastMessage the last text inside', () => {
    const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
    const run = sc.parseTranscript(jsonl([user('a'), say('one'), user('b'), tool('Read', { file_path: 'x' }), say('two'), user('c'), say('three')]));
    const s = cf.sliceRun(run, { from: 1, to: 3 });
    assert.deepStrictEqual(s.events.map((e) => e.tool), ['Read', '@text']);
    assert.deepStrictEqual(s.marks.map((m) => [m.at, m.text]), [[0, 'b']]);
    assert.deepStrictEqual([s.users, s.lastMessage], [['b'], 'two']);
});
test('gradeSession: a session: false step is listed SKIPPED, never graded', () => {
    const exp = JSON.parse(JSON.stringify(sc.loadExpectation('task-solve').data));
    exp.steps.find((s) => s.id === 'nothing-builds').session = false;
    const run = sc.parseTranscript(jsonl([cmdRow('task-solve'), tool('Edit', { file_path: 'src/app.js', old_string: 'a', new_string: 'b' })]));
    const step = stepOf(cf.gradeSession(run, exp)[0].result, 'nothing-builds');
    assert.strictEqual(step.verdict, 'SKIP');
    assert.match(step.results[0].explanation, /^SKIPPED - session: false$/);
});

// Final review 2026-10-25 I1: the task-solve steps were bound to the replay fixture (a standard, input-parsing task), so
// every correct trivial or small run read as a violation. A step's `session: { said }` grades it only in a window whose
// own text matches - the design steps on `Size: standard`, the stop fields on a size that stops.
test('final review I1: a correct trivial or small task-solve run fails no step and leaves F1 unviolated; a standard one is still graded', () => {
    const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
    const exp = sc.loadExpectation('task-solve').data;
    const F1 = cf.loadClaims().find((c) => c.id === 'F1');
    const fails = (run) => cf.gradeSession(run, exp).flatMap(({ result }) => result.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id));
    const trivial = sc.parseTranscript(jsonl([cmdRow('task-solve'), tool('Bash', { command: 'node .claude/hooks/handoff.js left typo' }),
        say('Size: trivial - a typo in one comment'), tool('Edit', { file_path: '/p/src/app.js', old_string: 'teh', new_string: 'the' }),
        tool('Bash', { command: 'npm run lint' }), say('Fixed the typo in src/app.js; lint clean.'), user('thanks')]));
    const small = sc.parseTranscript(jsonl([cmdRow('task-solve'), tool('Bash', { command: 'node .claude/hooks/handoff.js left order-total' }),
        say('Size: small - two files in one domain, no contract touched'), tool('Edit', { file_path: '/p/src/total.js', old_string: 'a', new_string: 'b' }),
        tool('Bash', { command: 'npm test' }), tool('Skill', { skill: 'task-verify-code' }),
        say('Result: total rounds once - src/total.js\nProgress: 4 of 4 steps\nLeftovers: none'), tool('AskUserQuestion', { questions: [] })]));
    for (const [name, run] of [['trivial', trivial], ['small', small]]) {
        assert.deepStrictEqual(fails(run), [], `${name}: a correct run fails no step`);
        assert.strictEqual(cf.gradeClaims({ session: { main: run } }, [F1])[0].violated, 0, `${name}: F1 not violated`);
    }
    const [{ result }] = cf.gradeSession(small, exp);
    assert.match(stepOf(result, 'design-invoked').results[0].explanation, /^SKIPPED - session: the window never says/);
    assert.strictEqual(stepOf(result, 'stop-fields').verdict, 'PASS', 'a small run stops once, the close, and its fields are graded');
    assert.strictEqual(stepOf(result, 'size-floor').verdict, 'SKIP', 'the floor is the fixture task\'s, never a session\'s');
    // a standard run that skips its design is still a violation, of the step and of F1
    const standard = sc.parseTranscript(jsonl([cmdRow('task-solve'), say('Size: standard - input parsing'),
        tool('Edit', { file_path: '/p/src/order.js', old_string: 'a', new_string: 'b' }), tool('AskUserQuestion', { questions: [] })]));
    assert.ok(fails(standard).includes('design-invoked') && fails(standard).includes('nothing-builds'), fails(standard).join(','));
    assert.strictEqual(cf.gradeClaims({ session: { main: standard } }, [F1])[0].violated, 1);
});
test('skill-comply check: a step\'s session is false or { said: <regex> }, nothing else', () => {
    const loaded = sc.loadExpectation('task-solve');
    const problems = (v) => {
        const data = JSON.parse(JSON.stringify(loaded.data));
        data.steps[0].session = v;
        return sc.checkExpectation({ ...loaded, data }).filter((p) => /session/.test(p));
    };
    assert.deepStrictEqual([problems(false), problems({ said: 'Size:\\s*standard' })], [[], []]);
    for (const v of [true, {}, { said: '(' }, { said: 3 }, { typed: 'x' }]) assert.strictEqual(problems(v).length, 1, JSON.stringify(v));
});

// --- the claims file, the state grader and the marker lint (Task 13) ---------------------------------
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stamped = (row, iso) => ({ ...row, timestamp: iso });

test('every claim: held 1 on its holding bundle, violated 1 on its violating one; a state claim without data/ is not visible, naming the path (A7.1)', () => {
    const claims = cf.loadClaims();
    assert.strictEqual(new Set(claims.map((c) => c.area)).size, 8);
    assert.ok(claims.length >= 16);
    assert.deepStrictEqual(claims.filter((c) => cf.evidenceOf(c) !== 'trace').map((c) => c.id).sort(), ['D2', 'P1', 'P2', 'S1']);
    for (const c of claims) {
        const fx = cf.claimFixtures(c.id);
        assert.strictEqual(cf.gradeClaims(fx.held, [c])[0].held, 1, c.id);
        assert.strictEqual(cf.gradeClaims(fx.violated, [c])[0].violated, 1, c.id);
        const ev = cf.evidenceOf(c);
        if (ev === 'trace') { assert.strictEqual(fx.unseen, undefined, `${c.id}: a trace claim has no unseen case`); continue; }
        const unseen = cf.gradeClaims(fx.unseen, [c])[0];
        assert.deepStrictEqual([unseen.notVisible, unseen.held, unseen.violated], [1, 0, 0], c.id);
        for (const p of ev) assert.ok(unseen.missing.includes(`<data root>/${p.replace('<sid>', 's')}`), `${c.id}: ${p}`);
    }
});
test('x_state before: a ledger row orders against the first matching event; no row, no time or no source is not visible; no event is N/A', () => {
    const P1 = cf.loadClaims().find((c) => c.id === 'P1');
    const handed = { type: 'attachment', attachment: { type: 'hook_additional_context', content: ["The user's personal preferences - PERSONAL-PREFERENCES.md, pushed at every session start"], hookName: 'SessionStart' } };
    const edit = sc.parseTranscript(jsonl([handed, stamped(user('go'), '2026-10-25T10:00:00Z'),
        stamped(tool('Edit', { file_path: 'a.js', old_string: 'a', new_string: 'b' }), '2026-10-25T10:00:05Z')]));
    const bundle = (ledger, main = edit) => ({ sid: 's', session: { main, seats: [] },
        state: { history: null, scorer: null, ledger, missing: ledger ? {} : { ledger: 'statistics/hook-blocks/s.jsonl' } } });
    const push = (iso) => ({ kind: 'preferences-push', ts: iso && Date.parse(iso) });
    const one = (b) => cf.gradeClaims(b, [P1])[0];
    assert.strictEqual(one(bundle([push('2026-10-25T10:00:01Z')])).held, 1, 'the push before the edit holds');
    assert.strictEqual(one(bundle([push('2026-10-25T10:00:09Z')])).violated, 1, 'a push after the edit is a violation');
    assert.strictEqual(one(bundle([{ kind: 'other', ts: Date.parse('2026-10-25T10:00:01Z') }])).notVisible, 1, 'no push row: the writer left none');
    assert.strictEqual(one(bundle([push(null)])).notVisible, 1, 'a row with no time cannot order');
    const none = one(bundle(null));
    assert.deepStrictEqual([none.notVisible, none.missing], [1, '<data root>/statistics/hook-blocks/s.jsonl']);
    assert.strictEqual(one(bundle([push('2026-10-25T10:00:01Z')], sc.parseTranscript(jsonl([user('go')])))).applied, 0, 'no edit: the claim did not apply');
});
test('loadBundle: data/ beside the transcript is the default; a garbage history file is not visible and marked unreadable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
    try {
        fs.writeFileSync(path.join(dir, 's.jsonl'), jsonl([user('go')]));
        fs.mkdirSync(path.join(dir, 'data', 'state', 'history'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'data', 'state', 'history', 's.json'), '{ not json');
        const b = cf.loadBundle(path.join(dir, 's.jsonl'));
        assert.deepStrictEqual([b.sid, b.state.history, b.state.scorer, b.state.ledger], ['s', null, null, null]);
        assert.strictEqual(b.state.missing.history, 'state/history/s.json (unreadable)');
        assert.strictEqual(cf.loadBundle(path.join(dir, 's.jsonl'), { dataRoot: path.join(dir, 'nowhere') }).state.missing.history, 'state/history/s.json');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("background-wait in a session: a turn that ran no suite fails nothing - the replay fixture's steps (its suite, its Monitor, its failing test) are skipped", () => {
    const run = sc.parseTranscript(jsonl([user('what does this file do?'), tool('Read', { file_path: 'src/app.js' }), { type: 'assistant', message: { id: 'mx', role: 'assistant', content: [{ type: 'text', text: 'It wires the routes.' }] } }]));
    const [{ result }] = cf.gradeSession(run, sc.loadExpectation('background-wait').data);
    assert.deepStrictEqual(result.steps.map((s) => [s.id, s.verdict]), [['background', 'SKIP'], ['monitor', 'SKIP'], ['no-whole-log', 'PASS'], ['no-name-grep', 'PASS'], ['answer', 'SKIP']]);
});
test('loadBundle: a --hook-blocks folder reads hook-blocks-<sid>.jsonl or <sid>.jsonl, never the transcript itself, as readBlockLedger does', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
    try {
        const t = path.join(dir, 's.jsonl');
        fs.writeFileSync(t, jsonl([user('go')]));
        const only = cf.loadBundle(t, { hookBlocks: dir }).state;
        assert.strictEqual(only.ledger, null, 'the bundle folder holds only the transcript');
        assert.strictEqual(only.missing.ledger, dir);
        fs.writeFileSync(path.join(dir, 'hook-blocks-s.jsonl'), jsonl([{ ts: '2026-10-25T10:00:00.000Z', hook: 'shell-guards.js', mode: 'probe', kind: 'bg-note' }]));
        assert.deepStrictEqual(cf.loadBundle(t, { hookBlocks: dir }).state.ledger.map((r) => r.kind), ['bg-note']);
        const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
        fs.writeFileSync(path.join(docs, 's.jsonl'), jsonl([{ ts: '2026-10-25T10:00:00.000Z', hook: 'preferences-session.js', mode: 'probe', kind: 'preferences-push' }]));
        assert.deepStrictEqual(cf.loadBundle(t, { hookBlocks: docs }).state.ledger.map((r) => r.kind), ['preferences-push'], "the docs root's own <sid>.jsonl");
        fs.rmSync(docs, { recursive: true, force: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('lint: a claim whose marker left its file fails, naming the claim id (A7.5)', () => {
    assert.match(cf.lintConformance([{ id: 'N1', source: { file: 'scripts/skill-comply.js', marker: 'no such line' } }]).join('\n'), /N1/);
    assert.deepStrictEqual(cf.lintConformance(cf.loadClaims()), []);
});
test('event windows: the lookback counts tool calls, a from anchor starts the window, unless reads the typed turns inside, a seat is graded on its own run', () => {
    const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
    const run = sc.parseTranscript(jsonl([user('go'), tool('Grep', { pattern: 'x' }), say('found it'), tool('Glob', { pattern: '*' }), tool('Bash', { command: 'ls' }), tool('Read', { file_path: 'src/a.js' })]));
    const read = { tool: 'Read', field: 'file_path', text_match: '\\.js$' };
    assert.deepStrictEqual(cf.windowsFor(run, { opens: { event: read, lookback: 3 } }).map((w) => [w.from, w.to]), [[0, 5]], 'three tool calls back, the text block not counted');
    assert.deepStrictEqual(cf.windowsFor(run, { opens: { event: read, lookback: 2 } }).map((w) => [w.from, w.to]), [[2, 5]]);
    assert.deepStrictEqual(cf.windowsFor(run, { opens: { event: read, from: 'Glob' } }).map((w) => [w.from, w.to]), [[2, 5]]);
    assert.deepStrictEqual(cf.windowsFor(run, { opens: { event: 'Edit', from: 'Glob' } }), [], 'no event after the anchor, no window');
    const auto = sc.parseTranscript(jsonl([user('<command-name>/task-solve</command-name>\n<command-args>--auto-mode fix it</command-args>'), tool('Agent', { subagent_type: 'alfred-code:aspnet-implementer' })]));
    const dispatch = { opens: { event: { tool: 'Agent', field: 'subagent_type', text_match: 'implementer$' }, first: true, lookback: 'session', unless: { typed: '--auto-mode' } } };
    assert.deepStrictEqual(cf.windowsFor(auto, dispatch), [], 'an auto-mode run opens no window');
    assert.strictEqual(cf.windowsFor(sc.parseTranscript(jsonl([user('go'), tool('Agent', { subagent_type: 'x-implementer' })])), dispatch).length, 1);
    const claim = { id: 'T', area: 'awareness', window: { opens: { seat: 'verifier$', event: { tool: 'Bash', field: 'command', text_match: 'npm start' }, first: true, lookback: 'session' } },
        steps: [{ id: 'read', type: 'tool_used', tool: 'Read' }] };
    const seatRun = (rows) => sc.parseTranscript(jsonl(rows), { sidechain: true });
    const b = { sid: 's', session: { main: sc.parseTranscript(jsonl([user('go'), tool('Bash', { command: 'npm start' })])), seats: [
        { agentType: 'alfred-code:aspnet-verifier', run: seatRun([user('brief'), tool('Read', { file_path: 'r.md' }), tool('Bash', { command: 'npm start' })]) },
        { agentType: 'alfred-code:aspnet-verifier', run: seatRun([user('brief'), tool('Bash', { command: 'npm start' })]) },
        { agentType: 'alfred-code:aspnet-implementer', run: seatRun([user('brief'), tool('Bash', { command: 'npm start' })]) }] },
        state: { history: null, scorer: null, ledger: null, missing: {} } };
    const g = cf.gradeClaims(b, [claim])[0];
    assert.deepStrictEqual([g.applied, g.held, g.violated], [2, 1, 1], 'the two verifiers graded, the main session and the implementer not');
    assert.match(g.locators.join(' '), /aspnet-verifier/);
});

// --- final review M8: the claims say exactly what they grade ------------------------------------------------------------
const resultOf = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${seq}`, content: text }] } });
const hookContext = (text) => ({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [text], hookName: 'SessionStart', toolUseID: 'SessionStart', hookEvent: 'SessionStart' } });
const claimOf = (id) => cf.loadClaims().find((c) => c.id === id);
const withState = (main, state) => ({ sid: 's', session: { main, seats: [] }, state: { history: null, scorer: null, ledger: null, missing: {}, ...state } });

test('M8 S1: the outcome row is the window\'s own slug - a release or a kept final holds, another run\'s release does not', () => {
    const S1 = claimOf('S1');
    const run = (slug) => sc.parseTranscript(jsonl([user('plan it'), tool('Skill', { skill: 'alfred-code:habits-output-scorer' }),
        tool('Agent', { subagent_type: 'alfred-code:output-scorer', prompt: 'grade' }), tool('Bash', { command: `node "$S" next --slug ${slug} --level 80` })]));
    const one = (slug, rows) => cf.gradeClaims(withState(run(slug), { scorer: rows }), [S1])[0];
    assert.strictEqual(one('csv-plan', [{ slug: 'csv-plan', line: 'released d1' }]).held, 1, 'its own release');
    assert.strictEqual(one('csv-plan', [{ slug: 'csv-plan', line: 'final d1' }]).held, 1, 'withheld and kept is an outcome the script recorded');
    assert.strictEqual(one('csv-plan', [{ slug: 'other-plan', line: 'released d1' }]).notVisible, 1, 'another run\'s release says nothing of this one');
    assert.strictEqual(one('"$SLUG"', [{ slug: 'csv-plan', line: 'released d1' }]).notVisible, 1, 'a slug the command never spells cannot be tied');
});

test('M8 N2: a Grep for literal text is no symbol lookup; one for an identifier or a declaration is', () => {
    const N2 = claimOf('N2');
    const order = hookContext("Tool order - the stack's defaults (no TOOLS-PREFERENCES.md): in each job use the first rank that serves the target before the next.\n- navigation (locate symbols, callers and types before reading or editing code): LSP > Grep.");
    const one = (...calls) => cf.gradeClaims(withState(sc.parseTranscript(jsonl([order, user('where is it'), ...calls])), {}), [N2])[0];
    const lsp = () => tool('LSP', { operation: 'workspaceSymbol', query: 'cartTotal' });
    assert.strictEqual(one(tool('Grep', { pattern: 'Cannot read property', path: 'src' }), lsp()).held, 1, 'an error message is text, then the symbol by LSP');
    assert.strictEqual(one(tool('Bash', { command: 'grep -rn "no such file" .' }), lsp()).held, 1, 'a phrase through the shell is text too');
    for (const first of [tool('Grep', { pattern: 'cartTotal' }), tool('Grep', { pattern: '\\bcartTotal\\b', path: 'src' }), tool('Grep', { pattern: 'function cartTotal' }),
        tool('Bash', { command: 'grep -rn "fetchOrders" src' }), tool('Bash', { command: 'rg -w cartTotal' })])
        assert.strictEqual(one(first, lsp()).violated, 1, JSON.stringify(first.message.content[0].input));
});

test('M8 P1: with no personal doc handed over the claim does not apply; with one it orders the push before the first Edit', () => {
    const P1 = claimOf('P1');
    const push = hookContext("The user's personal preferences - .alfred/docs/preferences/PERSONAL-PREFERENCES.md, pushed at every session start and after each compaction. They bind this session as alfred-preferences.md ranks them:\n\n- short answers");
    const rows = (lead) => [...lead, stamped(user('go'), '2026-10-25T10:00:00Z'), stamped(tool('Edit', { file_path: 'a.js', old_string: 'a', new_string: 'b' }), '2026-10-25T10:00:05Z')];
    const ledger = [{ kind: 'preferences-push', ts: Date.parse('2026-10-25T10:00:01Z') }];
    const none = cf.gradeClaims(withState(sc.parseTranscript(jsonl(rows([]))), { ledger: [] }), [P1])[0];
    assert.deepStrictEqual([none.applied, none.notVisible], [0, 0], 'no doc, no hand-over: nothing to grade');
    assert.strictEqual(cf.gradeClaims(withState(sc.parseTranscript(jsonl(rows([push]))), { ledger }), [P1])[0].held, 1);
});

test('M8 D2: an ask the idle timeout closed is no answered ask, and past the history\'s 60 rulings only the last 60 count', () => {
    const D2 = claimOf('D2');
    const ask = () => tool('AskUserQuestion', { questions: [{ question: 'Which?', options: [{ label: 'A (Recommended)' }, { label: 'B' }] }] });
    const ruling = (i) => ({ ts: i, question: 'Which?', answer: 'A' });
    const one = (calls, n) => cf.gradeClaims(withState(sc.parseTranscript(jsonl([user('go'), ...calls])), { history: Array.from({ length: n }, (_, i) => ruling(i)) }), [D2])[0];
    assert.strictEqual(one([ask(), resultOf('User has answered your questions: "Which?"="A".'), ask(), resultOf('No response after 60s — the user may be away from keyboard. Proceed with your best judgment.')], 1).held, 1,
        'the timed-out ask recorded nothing and owed nothing');
    const many = (k) => Array.from({ length: k }, () => [ask(), resultOf('User has answered your questions: "Which?"="A".')]).flat();
    assert.strictEqual(one(many(61), 60).held, 1, 'the history keeps the last 60');
    assert.strictEqual(one(many(61), 59).violated, 1, 'one short of the cap is still a lost answer');
});

test('S1 and S2 open on the new name too (spec section 10)', () => {
    const fixtures = path.join(__dirname, 'fixtures', 'conformance');
    for (const id of ['S1', 'S2'])
    {
        const claim = cf.loadClaims().find((c) => c.id === id);
        assert.strictEqual(cf.gradeClaims(cf.claimFixtures(id).held, [claim])[0].held, 1, `${id}: the recorded old-name session still holds`);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `conformance-${id}-`));
        fs.cpSync(path.join(fixtures, id, 'held'), dir, { recursive: true });
        const transcript = path.join(dir, 's.jsonl');
        const text = fs.readFileSync(transcript, 'utf8');
        assert.ok(text.includes('habits-output-scorer'), `${id}: the fixture names the old skill`);
        fs.writeFileSync(transcript, text.split('habits-output-scorer').join('mode-output-scorer'));
        try { assert.strictEqual(cf.gradeClaims(cf.loadBundle(transcript), [claim])[0].held, 1, `${id}: the same session under the new name holds`); }
        finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
});
