// Behavior tests for stack/hooks/reply-budget.js - the check of the last reply against the answer budget.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replyCheckOf, noteFor } = require('../stack/hooks/reply-budget.js');

const entry = (value) => JSON.stringify(value);
const typed = (text, extra = {}) => entry({ type: 'user', message: { role: 'user', content: text }, ...extra });
const reply = (text) => entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const lines = (...rows) => rows.join('\n') + '\n';
const check = (replyText, request = 'what changed?') => replyCheckOf(lines(typed(request), reply(replyText)));
const SHORT = 'Done - the build is green.';

test('a short reply gets no note and the request counts as found', () => {
    assert.deepStrictEqual(check(SHORT), { requestFound: true, note: null });
});

test('prose of exactly 900 characters gets no note, 901 gets one naming both numbers', () => {
    assert.strictEqual(check('a'.repeat(900)).note, null);
    assert.strictEqual(check('a'.repeat(901)).note, 'Last reply: 901 characters of prose, lead sentences: 0 - over the limit. Make this one fit.');
});

test('characters are counted as code points: an emoji is one', () => {
    assert.strictEqual(check('\u{1F600}'.repeat(900)).note, null);
    assert.match(check('\u{1F600}'.repeat(901)).note, /^Last reply: 901 characters/);
});

test('code blocks, table rows and inline code are not prose', () => {
    const block = '```js\n' + 'x'.repeat(2000) + '\n```';
    assert.strictEqual(check(`Result below.\n${block}`).note, null);
    const table = Array.from({ length: 60 }, (_, i) => `  | item ${i} | ${'y'.repeat(30)} |`).join('\n');
    assert.strictEqual(check(`Result below.\n${table}`).note, null);
    const inline = `Run ${'`' + 'z'.repeat(1000) + '`'} now.`;
    assert.strictEqual(check(inline).note, null);
});

test('inline code counts as one character', () => {
    const text = `${'a'.repeat(898)} \`one two three\``;
    assert.strictEqual(check(text).note, null);
    assert.match(check(`${text}b`).note, /^Last reply: 901 characters/);
});

test('three lead sentences get no note, four get one', () => {
    assert.strictEqual(check('The build is green. The tests pass now. Lint is clean too.').note, null);
    assert.strictEqual(
        check('The build is green. The tests pass now. Lint is clean too. The docs are fresh.').note,
        'Last reply: 78 characters of prose, lead sentences: 4 - over the limit. Make this one fit.',
    );
});

test('a sentence of fewer than three words does not count, a colon does not end a sentence', () => {
    assert.strictEqual(check('Done. Fixed. Green. Merged. Shipped.').note, null);
    assert.strictEqual(check('Result is here: it works fine now. Cause is known: a bad path.').note, null);
    assert.match(check('Result is here: it works fine now. Cause is known: a bad path. Fix is small now. Test is added too.').note, /lead sentences: 4/);
});

test('bullets and their indented continuation lines are not lead sentences', () => {
    const bullets = '- First point is here. Second sentence of it.\n  A wrapped line of the same bullet.\n* Another point goes here.\n1. A numbered point right here.\n2) Another numbered point here.';
    assert.strictEqual(check(`The build is green.\n${bullets}`).note, null);
});

test('an indented line after a blank line is a lead line again', () => {
    const text = 'The build is green.\n- A bullet goes here.\n\n  This line is lead now. And this one. And one more.';
    assert.match(check(text).note, /lead sentences: 4/);
});

test('heading lines are skipped', () => {
    assert.strictEqual(check('# A heading with many words here. And more words.\nThe build is green.').note, null);
});

test('a Checks line exempts the reply', () => {
    const long = 'a'.repeat(1200);
    for (const closer of ['Checks: lint passed', '- Checks: lint passed', '**Checks:** lint passed', '  * Checks: ok']) {
        assert.strictEqual(check(`${long}\n${closer}`).note, null, closer);
    }
    assert.match(check(`${long}\nNo Checks: here in the line`).note, /^Last reply/);
});

test('each lift phrase in the typed request exempts the reply', () => {
    const long = 'a'.repeat(1200);
    for (const phrase of ['in detail', 'step by step', 'teach me', 'walk me through', 'ELI5', 'write a plan', 'Please Write A Plan now']) {
        const result = check(long, `explain this ${phrase}`);
        assert.deepStrictEqual(result, { requestFound: true, note: null }, phrase);
    }
    assert.match(check(long, 'planning ahead, in details').note, /^Last reply/);
});

test('origin.kind human is a typed request, any other kind is not', () => {
    const long = 'a'.repeat(1200);
    const human = replyCheckOf(lines(typed('what changed?', { origin: { kind: 'human' } }), reply(long)));
    assert.match(human.note, /^Last reply/);
    const other = replyCheckOf(lines(typed('what changed?', { origin: { kind: 'task-notification' } }), reply(long)));
    assert.deepStrictEqual(other, { requestFound: false, note: null });
});

test('a later turn nobody typed does not move the request', () => {
    const long = 'a'.repeat(1200);
    const rows = lines(typed('what changed?', { origin: { kind: 'human' } }), typed('summary', { origin: { kind: 'system' } }), reply(long));
    assert.match(replyCheckOf(rows).note, /^Last reply/);
});

test('a queued command attachment is read from its prompt and origin', () => {
    const long = 'a'.repeat(1200);
    const queued = (prompt, kind) => entry({ type: 'attachment', attachment: { type: 'queued_command', prompt, origin: { kind } } });
    assert.match(replyCheckOf(lines(queued('what changed?', 'human'), reply(long))).note, /^Last reply/);
    assert.strictEqual(replyCheckOf(lines(queued('explain in detail', 'human'), reply(long))).note, null);
    assert.deepStrictEqual(replyCheckOf(lines(queued('what changed?', 'system'), reply(long))), { requestFound: false, note: null });
    const noOrigin = entry({ type: 'attachment', attachment: { type: 'queued_command', prompt: 'what changed?' } });
    assert.match(replyCheckOf(lines(noOrigin, reply(long))).note, /^Last reply/);
});

test('with no origin the opening of the text decides', () => {
    const long = 'a'.repeat(1200);
    for (const opening of ['<task-notification>x', '<cross-session-message>', 'Another Claude session sent a note', '[SYSTEM NOTIFICATION] hi', 'This session is being continued from']) {
        assert.deepStrictEqual(replyCheckOf(lines(typed(`  ${opening}`), reply(long))), { requestFound: false, note: null }, opening);
    }
    assert.match(replyCheckOf(lines(typed('what changed?'), reply(long))).note, /^Last reply/);
});

test('empty, meta and compaction-summary user entries are no request', () => {
    const long = 'a'.repeat(1200);
    for (const row of [typed('   '), typed('hello', { isMeta: true }), typed('hello', { isCompactSummary: true })]) {
        assert.deepStrictEqual(replyCheckOf(lines(row, reply(long))), { requestFound: false, note: null });
    }
});

test('text parts of a content array are joined, tool results are not a request', () => {
    const long = 'a'.repeat(1200);
    const user = entry({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'what' }, { type: 'text', text: 'changed?' }] } });
    assert.match(replyCheckOf(lines(user, reply(long))).note, /^Last reply/);
});

test('no note while the turn runs: a tool_use or tool_result part follows the last text', () => {
    const long = 'a'.repeat(1200);
    const toolUse = entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } });
    const toolResult = entry({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
    assert.deepStrictEqual(replyCheckOf(lines(typed('go'), reply(long), toolUse)), { requestFound: true, note: null });
    assert.deepStrictEqual(replyCheckOf(lines(typed('go'), reply(long), toolUse, toolResult)), { requestFound: true, note: null });
    assert.match(replyCheckOf(lines(typed('go'), toolUse, toolResult, reply(long))).note, /^Last reply/);
});

test('no request in the lines means no note and requestFound false; a cut first line is skipped', () => {
    assert.deepStrictEqual(replyCheckOf(lines(reply('a'.repeat(1200)))), { requestFound: false, note: null });
    assert.deepStrictEqual(replyCheckOf(''), { requestFound: false, note: null });
    const cut = '"cut":"half a line"}\n' + lines(typed('go'), reply('a'.repeat(1200)));
    assert.match(replyCheckOf(cut).note, /^Last reply/);
});

test('a request with no reply yet is not found, so no note', () => {
    assert.deepStrictEqual(replyCheckOf(lines(typed('go'))), { requestFound: false, note: null });
});

test('noteFor reads a transcript file and returns the note, or an empty string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-budget-'));
    try {
        const long = path.join(dir, 'long.jsonl');
        fs.writeFileSync(long, lines(typed('go'), reply('a'.repeat(1200))));
        assert.match(noteFor(long), /^Last reply: 1200 characters of prose/);
        const short = path.join(dir, 'short.jsonl');
        fs.writeFileSync(short, lines(typed('go'), reply(SHORT)));
        assert.strictEqual(noteFor(short), '');
        const empty = path.join(dir, 'empty.jsonl');
        fs.writeFileSync(empty, '');
        assert.strictEqual(noteFor(empty), '');
        assert.strictEqual(noteFor(path.join(dir, 'missing.jsonl')), '');
        assert.strictEqual(noteFor(dir), '');
        assert.strictEqual(noteFor(undefined), '');
        assert.strictEqual(noteFor(''), '');
        assert.strictEqual(noteFor(42), '');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('noteFor grows the tail: a request beyond 512 KB but within 2 MB is found', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-budget-'));
    try {
        const file = path.join(dir, 'grow.jsonl');
        const filler = entry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: { pad: 'p'.repeat(100000) } }] } });
        const body = [typed('go'), ...Array.from({ length: 8 }, () => filler), reply('a'.repeat(1200))];
        fs.writeFileSync(file, lines(...body));
        assert.ok(fs.statSync(file).size > 512 * 1024 && fs.statSync(file).size < 2 * 1024 * 1024);
        assert.match(noteFor(file), /^Last reply: 1200 characters/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('noteFor gives no note when no tail holds the request', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-budget-'));
    try {
        const file = path.join(dir, 'none.jsonl');
        fs.writeFileSync(file, lines(reply('a'.repeat(1200)), reply('b'.repeat(1200))));
        assert.strictEqual(noteFor(file), '');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('after a bullet only a space- or tab-indented line continues it, as in claude-kit; other leading space is a lead line', () => {
    const sentence = 'This line has enough words to count.';
    assert.strictEqual(check(`- a bullet point here\n  ${sentence} ${sentence} ${sentence} ${sentence}`).note, null);
    assert.match(check(`- a bullet point here\n\u00a0${sentence} ${sentence} ${sentence} ${sentence}`).note, /lead sentences: 4 /);
});

test('noteFor: a 512 KB cut inside a multi-byte character of the request line skips that line and finds it in the next tail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-budget-'));
    try {
        const file = path.join(dir, 'cut.jsonl');
        const request = typed('\u00e9'.repeat(1000) + ' what changed?');
        const tail = '\r\n' + reply('a'.repeat(1200)) + '\r\n';
        const pad = 512 * 1024 - Buffer.byteLength(tail) - 1001;
        const filler = entry({ type: 'system', text: 'f'.repeat(Math.max(0, pad - 40)) });
        const body = request + '\n' + filler + tail;
        fs.writeFileSync(file, body);
        const start = Buffer.byteLength(body) - 512 * 1024;
        const head = Buffer.from(body).subarray(0, Buffer.byteLength(request));
        assert.ok(start > 0 && start < head.length, 'the 512 KB tail starts inside the request line');
        assert.match(noteFor(file), /^Last reply: 1200 characters of prose/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const FIELD_LABELS = ['Result:', 'Progress:', 'Leftovers:', 'Deferred by you:', 'Checks:', 'Cleanup:'];
// Fixtures of fake text in the shape and length of two audited replies (562 and 459 characters with their field lines).
const AUDITED_PROGRESS = [
    'The widget parser now reads both date formats and the sample suite is green again.',
    'Progress: parser change landed in the module, sample suite rerun twice, no new warnings seen.',
    'Result: the widget export keeps its old order, and the new column is the last one in each row.',
    'Leftovers: the old fixture file is still in the tree, since another test reads it.',
    'Deferred by you: the rename of the export helper, which you held back until the next release.',
    'Cleanup: removed the scratch folder this run made, left the cache and the lock folders in place for the next run.',
].join('\n');
const AUDITED_SHORT = [
    'The retry loop now stops after three tries and logs each failure once.',
    'Result: the loop ends on the third failure, so a dead host no longer stalls the run.',
    'Progress: unit tests added for the limit, the log line and the reset after a success.',
    'Leftovers: the old retry flag is still read by one script, which a later change will move over to the new limit.',
    'Cleanup: removed the scratch folder this run created, and stopped the test server it started in the run.',
].join('\n');

test('the audited replies with their field lines get no note', () => {
    assert.strictEqual(AUDITED_PROGRESS.length, 562);
    assert.strictEqual(AUDITED_SHORT.length, 459);
    assert.strictEqual(check(AUDITED_PROGRESS).note, null);
    assert.strictEqual(check(AUDITED_SHORT).note, null);
});

test('the field lines Result:, Progress:, Leftovers:, Deferred by you:, Checks:, Cleanup: are not counted', () => {
    const lead = 'The build is green. The tests pass now. Lint is clean too.';
    const field = (label) => `${label} ${'a'.repeat(300)}. And one more sentence is here.`;
    for (const label of FIELD_LABELS) {
        const text = `${lead}\n${field(label)}\n${field(label)}\n${field(label)}`;
        assert.strictEqual(check(text).note, null, label);
    }
    for (const marker of ['- ', '* ', '  ', '**']) {
        assert.strictEqual(check(`${lead}\n${marker}Result: ${'a'.repeat(1000)}. Two more here.`).note, null, marker);
    }
    assert.strictEqual(check(`${lead}\nResult: ${'a'.repeat(500)}\n  a wrapped line of ${'b'.repeat(500)}`).note, null);
});

test('a label inside a line is no field line, so that prose still counts', () => {
    assert.match(check(`The Result: ${'a'.repeat(1000)}`).note, /^Last reply: 1\d{3} characters/);
    assert.match(check(`See Cleanup: ${'a'.repeat(1000)}`).note, /^Last reply/);
    assert.match(check(`Results: ${'a'.repeat(1000)}`).note, /^Last reply/);
});

test('a 950-character reply of plain prose and a 4-sentence lead still get the note, field lines beside them or not', () => {
    const plain = `${'word '.repeat(189)}end.`;
    assert.ok(plain.length >= 940 && plain.length <= 960, String(plain.length));
    assert.match(check(plain).note, /^Last reply: 9\d\d characters/);
    assert.match(check(`${plain}\nResult: it works fine now.`).note, /^Last reply: 9\d\d characters/);
    const four = 'The build is green. The tests pass now. Lint is clean too. The docs are fresh.';
    assert.match(check(four).note, /lead sentences: 4/);
    assert.match(check(`${four}\nProgress: done with all of it.`).note, /lead sentences: 4/);
});
