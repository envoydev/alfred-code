'use strict';
// stack/hooks/plan-status.js - PF1 D7: the one writer of a plan folder's status.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { scrubbed } = require('./hook-test-env');

const ENGINE = path.join(__dirname, '..', 'stack', 'hooks', 'plan-status.js');
const P = require(ENGINE);
const T0 = '2026-11-13T10:00:00Z';
const { realLong } = require('./test-paths.js');          // lint check 71: no JS-resolver realpath in a new test file
const tmp = () => realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-status-')));
const CARDS = [[1, 'Export projection', 25], [2, 'Streamed endpoint', 30], [3, 'Docs page', 10]];
const markdown = (cards = CARDS, eol = '\n') => ['# CSV export - plan', '', 'Oriented: docs.js show api', 'Asked: none', '', '## Tasks', '',
    ...cards.flatMap(([n, title, min]) => [`### Task ${n} - ${title}`, '', '- files: src/x.cs', ...(min === null ? [] : [`- estimate: ${min}m`]), '']),
    '## Decisions', '', '- none', ''].join(eol);
// A throwaway project holding one plan folder; `md: null` leaves the Markdown out.
function plan({ id = 'csv', md = markdown() } = {})
{
    const root = tmp();
    const dir = path.join(root, '.alfred', 'docs', 'work', 'plans', id);
    fs.mkdirSync(dir, { recursive: true });
    if (md !== null) fs.writeFileSync(path.join(dir, `${id}.md`), md);
    return { root, id, dir, file: path.join(dir, 'status.json'), rel: `.alfred/docs/work/plans/${id}/` };
}
const call = (p, argv, stdin = '', at = T0, env = {}) => P.run(argv, { cwd: p.root, stdin, now: () => new Date(at), env: { CLAUDE_PROJECT_DIR: p.root, ...env } });
const read = (p) => JSON.parse(fs.readFileSync(p.file, 'utf8'));
const seed = (p, change = () => {}) => { const s = P.emptyStatus('CSV export', P.stamp(new Date(T0))); change(s); fs.writeFileSync(p.file, `${JSON.stringify(s, null, 2)}\n`); return s; };

test('stamp: UTC to the minute', () =>
{
    assert.strictEqual(P.stamp(new Date('2026-11-13T10:42:59.999Z')), '2026-11-13T10:42Z');
    assert.match(P.stamp(), P.TIME_RE);
});

test('emptyStatus is valid and carries every key in the file order', () =>
{
    const s = P.emptyStatus('CSV export', '2026-11-13T10:00Z');
    assert.deepStrictEqual(Object.keys(s), P.KEYS);
    assert.deepStrictEqual(P.validate(s), []);
    assert.deepStrictEqual(s.resume, { note: null, next: null, at: '2026-11-13T10:00Z' });
});

test('validate names each problem by its field; an unknown key is none', () =>
{
    const bad = (change) => { const s = P.emptyStatus('t', '2026-11-13T10:00Z'); change(s); return P.validate(s); };
    const task = (over = {}) => ({ id: '1', title: 't', status: 'todo', estimateMin: null, startedAt: null, doneAt: null, result: null, needs: null, why: null, card: null, by: null, ...over });
    assert.deepStrictEqual(bad((s) => { s.later = 1; s.tasks.push({ ...task(), extra: true }); }), []);
    assert.match(bad((s) => { s.tasks.push(task(), task()); })[0], /^tasks\[1\]\.id - /, 'one id twice');
    assert.match(bad((s) => { s.tasks.push(task({ id: '01' })); })[0], /^tasks\[0\]\.id - /);
    assert.match(bad((s) => { s.retiredIds = ['1']; s.tasks.push(task()); })[0], /^tasks\[0\]\.id - /, 'a retired id');
    assert.match(bad((s) => { s.tasks.push(task({ estimateMin: 2.5 })); })[0], /^tasks\[0\]\.estimateMin - /);
    assert.match(bad((s) => { s.tasks.push(task({ doneAt: 'yesterday' })); })[0], /^tasks\[0\]\.doneAt - /);
    assert.match(bad((s) => { s.gate = { at: 'x', verdict: 'passed', block: '' }; })[0], /^gate\.at - /);
    assert.match(bad((s) => { s.approval = { mode: 'auto', words: null }; })[0], /^approval\.mode - /);
    assert.match(bad((s) => { s.decisions.push({ at: 'x' }); })[0], /^decisions\[0\]\.at - /);
    assert.match(bad((s) => { s.resume = null; })[0], /^resume - /);
    assert.strictEqual(bad((s) => { delete s.title; delete s.gate; }).length, 2, 'every problem, not the first alone');
    for (const not of [null, [], 'x', 7]) assert.strictEqual(P.validate(not).length, 1);
});

test('readStatus: absent, unreadable in each form, a bad shape and a good file - and it never throws', () =>
{
    const p = plan();
    assert.deepStrictEqual(P.readStatus(p.dir).why, 'absent');
    for (const garbage of ['', '{', '\ufeff{}', 'null', '[]'])
    {
        fs.writeFileSync(p.file, garbage);
        const r = P.readStatus(p.dir);
        assert.deepStrictEqual([r.ok, ['unreadable', 'shape'].includes(r.why)], [false, true], JSON.stringify(garbage));
    }
    for (const garbage of ['', '{', '\ufeff{}']) { fs.writeFileSync(p.file, garbage); assert.strictEqual(P.readStatus(p.dir).why, 'unreadable', JSON.stringify(garbage)); }
    seed(p, (s) => { s.schema = 2; });
    assert.deepStrictEqual([P.readStatus(p.dir).why, /^schema - /.test(P.readStatus(p.dir).detail)], ['shape', true]);
    const good = seed(p);
    assert.deepStrictEqual(P.readStatus(p.dir), { ok: true, status: good });
    fs.rmSync(p.file); fs.mkdirSync(p.file);
    assert.strictEqual(P.readStatus(p.dir).why, 'unreadable', 'a folder where the file is expected');
    assert.strictEqual(P.readStatus(path.join(p.root, 'gone')).why, 'absent');
});

test('readStatus: a file of exactly 1 MB reads, one byte over is unreadable (M7)', () =>
{
    const p = plan();
    const sized = (bytes) => { const s = P.emptyStatus('t', '2026-11-13T10:00Z'); s.resume.note = ''; const base = Buffer.byteLength(`${JSON.stringify(s, null, 2)}\n`); s.resume.note = 'x'.repeat(bytes - base); fs.writeFileSync(p.file, `${JSON.stringify(s, null, 2)}\n`); return fs.statSync(p.file).size; };
    assert.strictEqual(sized(P.MAX_BYTES - 1), P.MAX_BYTES - 1); assert.strictEqual(P.readStatus(p.dir).ok, true);
    assert.strictEqual(sized(P.MAX_BYTES), P.MAX_BYTES); assert.strictEqual(P.readStatus(p.dir).ok, true);
    assert.strictEqual(sized(P.MAX_BYTES + 1), P.MAX_BYTES + 1); assert.deepStrictEqual([P.readStatus(p.dir).why, P.readStatus(p.dir).detail], ['unreadable', 'over 1 MB']);
});

test('writeWhole: the text lands whole, no temp file is left, an old temp is swept', () =>
{
    const p = plan();
    const stale = `${p.file}.99999.tmp`; fs.writeFileSync(stale, 'x'); const old = new Date(Date.now() - 61000); fs.utimesSync(stale, old, old);
    const fresh = `${p.file}.99998.tmp`; fs.writeFileSync(fresh, 'x');
    P.writeWhole(p.file, '{"a":1}\n');
    assert.strictEqual(fs.readFileSync(p.file, 'utf8'), '{"a":1}\n');
    assert.deepStrictEqual(fs.readdirSync(p.dir).filter((n) => n.endsWith('.tmp')), [path.basename(fresh)], 'under a minute old is another call\'s');
    P.writeWhole(p.file, '{"a":2}\n');
    assert.strictEqual(fs.readFileSync(p.file, 'utf8'), '{"a":2}\n', 'over an existing file');
});

test('writeWhole: a rename refused as busy is retried five times, then throws and leaves no temp file', () =>
{
    const p = plan();
    const busy = (code) => Object.assign(new Error(code), { code });
    let calls = 0;
    P.writeWhole(p.file, 'a\n', { rename: (from, to) => { if (++calls < 3) throw busy('EPERM'); fs.renameSync(from, to); } });
    assert.deepStrictEqual([calls, fs.readFileSync(p.file, 'utf8')], [3, 'a\n']);
    calls = 0;
    assert.throws(() => P.writeWhole(p.file, 'b\n', { rename: () => { calls++; throw busy('EBUSY'); } }), { code: 'EBUSY' });
    assert.strictEqual(calls, 6, 'once and five retries');
    calls = 0;
    assert.throws(() => P.writeWhole(p.file, 'b\n', { rename: () => { calls++; throw busy('ENOSPC'); } }), { code: 'ENOSPC' });
    assert.strictEqual(calls, 1, 'another error is not retried');
    assert.deepStrictEqual([fs.readFileSync(p.file, 'utf8'), fs.readdirSync(p.dir).filter((n) => n.endsWith('.tmp'))], ['a\n', []]);
});

const REL = '.alfred/docs/work/plans/csv/';
const lines = (r) => r.out.split('\n').filter(Boolean);
const ok = (r, re) => { assert.strictEqual(r.code, 0, r.err); assert.strictEqual(r.err, ''); if (re) assert.match(r.out, re); return r; };
const refused = (r, code, re) => { assert.deepStrictEqual([r.code, r.out], [code, ''], r.err); assert.match(r.err, re); assert.strictEqual(r.err.trimEnd().split('\n').length, 1, 'one line'); return r; };
const untouched = (p, fn) => { const state = () => (fs.existsSync(p.file) ? [fs.readFileSync(p.file, 'utf8'), fs.statSync(p.file).mtimeMs] : null); const before = state(); const r = fn(); assert.deepStrictEqual(state(), before, 'the bytes and the mtime'); return r; };
const edit = (p, change) => { const s = read(p); change(s); fs.writeFileSync(p.file, `${JSON.stringify(s, null, 2)}\n`); };
const mdOf = (p) => path.join(p.dir, `${p.id}.md`);

test('run: a usage refusal is exit 2 with one stderr line and no stdout', () =>
{
    const p = plan();
    refused(call(p, []), 2, /^plan-status: no verb - one of sync, gate, approve, /);
    refused(call(p, ['tick', '--plan', 'csv']), 2, /^plan-status: unknown verb 'tick'/);
    refused(call(p, ['sync']), 2, /^plan-status: sync needs --plan <ref>\n$/);
    refused(call(p, ['sync', '--plan']), 2, /^plan-status: --plan needs a value/);
    refused(call(p, ['sync', '--plan', 'csv', '--force']), 2, /^plan-status: unknown flag --force/);
    refused(call(p, ['sync', '--plan', 'csv', '--task', '1']), 2, /^plan-status: sync takes no --task/);
    refused(call(p, ['list', '--plan', 'csv']), 2, /^plan-status: list takes no --plan/);
    refused(call(p, ['check']), 2, /^plan-status: check needs --plan <ref> or --all/);
    refused(call(p, ['check', '--plan', 'csv', '--all']), 2, /^plan-status: check needs --plan <ref> or --all/);
});

test('resolvePlan: a bare id, the folder, its Markdown and a backslash path name one plan', () =>
{
    const p = plan();
    const at = { cwd: p.root, env: { CLAUDE_PROJECT_DIR: p.root } };
    const want = { ok: true, id: 'csv', dir: p.dir, md: path.join(p.dir, 'csv.md'), rel: REL, root: p.root };
    for (const ref of ['csv', '.alfred/docs/work/plans/csv', '.alfred/docs/work/plans/csv/', '.alfred/docs/work/plans/csv/csv.md', '.alfred\\docs\\work\\plans\\csv', '.alfred\\docs\\work\\plans\\csv\\csv.md', p.dir])
        assert.deepStrictEqual(P.resolvePlan(ref, at), want, ref);
    assert.strictEqual(P.resolvePlan('csv', { cwd: path.join(p.root, '.alfred'), env: at.env }).dir, p.dir, 'a bare id goes by the root, not the cwd');
    assert.strictEqual(P.resolvePlan('new-one', at).dir, path.join(path.dirname(p.dir), 'new-one'), 'the folder need not exist');
    const other = tmp();
    assert.strictEqual(P.resolvePlan(p.dir, { cwd: other, env: { CLAUDE_PROJECT_DIR: other } }).rel, `${p.dir.split(path.sep).join('/')}/`, 'outside the root: the absolute path');
    const rows = [['', /no --plan/], ['csv.md', /a plan id carries no \.md/], ['con', /is not a plan id/], ['csv.', /is not a plan id/], ['a'.repeat(129), /is not a plan id/],
        ['.alfred/docs/work/plans/old-export.md', /a flat plan has no status\.json/], ['.alfred/docs/work/plans/csv/other.md', /not a plan folder/], ['src/csv', /not a plan folder/]];
    for (const [ref, re] of rows) { const r = P.resolvePlan(ref, at); assert.strictEqual(r.ok, false, ref); assert.match(r.why, re, ref); }
});

test('resolvePlan: the disk\'s spelling of the id', (t) =>
{
    const p = plan();
    if (!fs.existsSync(path.join(path.dirname(p.dir), 'CSV'))) return t.skip('a case-sensitive disk');
    const r = P.resolvePlan('.alfred/docs/work/plans/CSV', { cwd: p.root, env: { CLAUDE_PROJECT_DIR: p.root } });
    assert.deepStrictEqual([r.id, r.rel, path.basename(r.md)], ['csv', REL, 'csv.md']);
});

test('parseStdin: a label starts its value once; other lines continue it; a $ and a backtick stay text', () =>
{
    const got = P.parseStdin('lead-in\nresult: dotnet test - 4 passed\n  $HOME `id` "q"\nresult: a quoted result line\nwhy: late\n\n\n', ['result', 'why']);
    assert.deepStrictEqual(got, { result: 'dotnet test - 4 passed\n  $HOME `id` "q"\nresult: a quoted result line', why: 'late' });
    assert.deepStrictEqual(P.parseStdin('Result: x\n result: y\n', ['result']), {}, 'a label is exact and opens its line');
    assert.deepStrictEqual(P.parseStdin('result:\n', ['result']), { result: '' });
    assert.deepStrictEqual(P.parseStdin('', ['result']), {});
});

test('parseStdin: CRLF input', () =>
{
    assert.deepStrictEqual(P.parseStdin('choice: a\r\nmore\r\nprecedent: b\r\n', ['choice', 'precedent']), { choice: 'a\nmore', precedent: 'b' });
});

test('parseCards: the title, the cards, the estimates; CRLF; each problem', () =>
{
    assert.deepStrictEqual(P.parseCards(markdown()), { title: 'CSV export', problems: [],
        cards: [{ id: '1', title: 'Export projection', estimateMin: 25 }, { id: '2', title: 'Streamed endpoint', estimateMin: 30 }, { id: '3', title: 'Docs page', estimateMin: 10 }] });
    assert.deepStrictEqual(P.parseCards(markdown(CARDS, '\r\n')), P.parseCards(markdown()));
    assert.deepStrictEqual(P.parseCards(markdown([[1, 'A', null], [2, 'B', null]])).cards.map((c) => c.estimateMin), [null, null]);
    assert.deepStrictEqual(P.parseCards('no heading\n'), { title: null, cards: [], problems: [] });
    assert.deepStrictEqual(P.parseCards(markdown([[1, 'A', 5], [1, 'B', 5]])).problems, ['task 1 - two cards carry this id']);
    assert.deepStrictEqual(P.parseCards(markdown([[1, 'A', 5], [2, 'B', null]])).problems, ['estimates on some cards only (none on task 2)']);
    for (const bad of ['### Task - A', '### Task 02 - A', '### Task 1a - A', '### Task'])
        assert.match(P.parseCards(`# T - plan\n\n${bad}\n`).problems[0], /^line 3 - a card with no whole-number id$/, bad);
    assert.deepStrictEqual(P.parseCards('# T - plan\n\n### Tasks overview\n').problems, [], 'not a card heading');
});

test('sync: a heading inside a fence is no card', () =>
{
    const md = ['# CSV export - plan', '', '## Tasks', '', '### Task 1 - One', '', '```markdown', '### Task 9 - a quoted template', '- estimate: 99m', '```', '- estimate: 5m', '', '~~~', '### Task - no id', '~~~', '', '### Task 2 - Two', '- estimate: 10 m', ''].join('\n');
    assert.deepStrictEqual(P.parseCards(md), { title: 'CSV export', cards: [{ id: '1', title: 'One', estimateMin: 5 }, { id: '2', title: 'Two', estimateMin: 10 }], problems: [] });
});

test('counts and resumeText: what the lines and the hooks read', () =>
{
    const s = P.emptyStatus('t', '2026-11-13T10:00Z');
    assert.deepStrictEqual([P.counts(s), P.resumeText(s)], [{ total: 0, done: 0, todo: 0, in_progress: 0, blocked: 0, failed: 0 }, 'no task left']);
    s.tasks = ['done', 'blocked', 'todo'].map((status, i) => ({ id: String(i + 1), status }));
    s.resume = { note: 'step 4 BUILD\n  mode session', next: '2', at: s.updatedAt };
    assert.deepStrictEqual([P.counts(s), P.resumeText(s)], [{ total: 3, done: 1, todo: 1, in_progress: 0, blocked: 1, failed: 0 }, 'step 4 BUILD mode session - next task 2']);
});

test('sync: creates status.json from the Markdown; run again with nothing new it leaves the bytes and the mtime', () =>
{
    const p = plan();
    assert.deepStrictEqual(lines(ok(call(p, ['sync', '--plan', 'csv']))), [`plan-status: sync ok - plan csv (${REL})`, 'Tasks: 0 of 3 done', 'Resume: next task 1']);
    const s = read(p);
    assert.deepStrictEqual(Object.keys(s), P.KEYS);
    assert.deepStrictEqual(s.tasks.map((t) => [t.id, t.title, t.status, t.estimateMin, Object.keys(t).join()]),
        [['1', 'Export projection', 'todo', 25, P.TASK_KEYS.join()], ['2', 'Streamed endpoint', 'todo', 30, P.TASK_KEYS.join()], ['3', 'Docs page', 'todo', 10, P.TASK_KEYS.join()]]);
    assert.deepStrictEqual([s.title, s.updatedAt, s.approvedAt, s.resume], ['CSV export', '2026-11-13T10:00Z', null, { note: null, next: '1', at: '2026-11-13T10:00Z' }]);
    assert.strictEqual(fs.readFileSync(p.file, 'utf8'), `${JSON.stringify(s, null, 2)}\n`, 'two-space JSON, LF, one final newline');
    const again = untouched(p, () => ok(call(p, ['sync', '--plan', 'csv'], '', '2026-11-13T11:00:00Z')));
    assert.deepStrictEqual(lines(again), [`plan-status: sync - nothing to change - plan csv (${REL})`, 'Tasks: 0 of 3 done', 'Resume: next task 1']);
    assert.deepStrictEqual(fs.readdirSync(p.dir).sort(), ['csv.md', 'status.json'], 'no lock and no temp file left');
    const crlf = plan({ md: markdown(CARDS, '\r\n') });
    ok(call(crlf, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual(read(crlf).tasks, s.tasks, 'a CRLF Markdown');
    const bs = plan();
    ok(call(bs, ['sync', '--plan', '.alfred\\docs\\work\\plans\\csv']), /^plan-status: sync ok - plan csv \(\.alfred\/docs\/work\/plans\/csv\/\)\n/);
});

test('sync again: a new card at its place, a todo title and a never-started estimate refreshed, a todo task whose card is gone dropped', () =>
{
    const p = plan();
    ok(call(p, ['sync', '--plan', 'csv']));
    edit(p, (s) => { Object.assign(s.tasks[2], { status: 'in_progress', startedAt: '2026-11-13T10:01Z' }); });
    fs.writeFileSync(mdOf(p), markdown([[1, 'Export projection v2', 40], [4, 'Auth check', 15], [3, 'Docs page v2', 99]]));
    ok(call(p, ['sync', '--plan', 'csv'], '', '2026-11-13T10:30:00Z'));
    const s = read(p);
    assert.deepStrictEqual(s.tasks.map((t) => [t.id, t.title, t.estimateMin]), [['1', 'Export projection v2', 40], ['4', 'Auth check', 15], ['3', 'Docs page', 10]], 'a started task keeps its title and its estimate');
    assert.deepStrictEqual([s.dropped, s.retiredIds], [[{ id: '2', title: 'Streamed endpoint', at: '2026-11-13T10:30Z', why: 'card removed from the plan' }], ['2']]);
    fs.writeFileSync(mdOf(p), markdown([[1, 'A', 40], [4, 'B', 15]]));
    ok(call(p, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual(read(p).tasks.map((t) => t.id), ['1', '4', '3'], 'a task past todo whose card is gone stays, after the task it followed');
    fs.writeFileSync(mdOf(p), markdown([[1, 'A', 40], [2, 'Back again', 5], [4, 'B', 15]]));
    untouched(p, () => refused(call(p, ['sync', '--plan', 'csv']), 2, /^plan-status: sync refused: task 2 - a retired id\n$/));
});

test('sync: each refusal is exit 2 and writes nothing', () =>
{
    const rows = [[markdown([[1, 'A', 5], [1, 'B', 5]]), /sync refused: task 1 - two cards carry this id/], [markdown().replace('### Task 2 - ', '### Task - '), /sync refused: line \d+ - a card with no whole-number id/],
        [markdown([[1, 'A', 5], [2, 'B', null]]), /sync refused: estimates on some cards only/]];
    for (const [md, re] of rows) { const p = plan({ md }); refused(call(p, ['sync', '--plan', 'csv']), 2, re); assert.strictEqual(fs.existsSync(p.file), false); }
    const named = plan({ md: null });
    fs.writeFileSync(path.join(named.dir, 'plan.md'), markdown());
    refused(call(named, ['sync', '--plan', 'csv']), 2, /^plan-status: sync refused: no csv\.md in the plan folder\n$/);
    const flat = plan();
    fs.writeFileSync(path.join(path.dirname(flat.dir), 'csv.md'), '# flat\n');
    refused(call(flat, ['sync', '--plan', 'csv']), 2, /sync refused: a flat csv\.md holds this id/);
    refused(call(flat, ['sync', '--plan', 'con']), 2, /^plan-status: 'con' is not a plan id/);
    assert.deepStrictEqual(fs.readdirSync(flat.dir), ['csv.md']);
});

test('a status.json that is not a schema 1 file is exit 3, names the field and is never overwritten', () =>
{
    const withTask = (change) => { const s = P.emptyStatus('t', '2026-11-13T10:00Z'); s.tasks.push({ id: '1', title: 't', status: 'todo', estimateMin: null, startedAt: null, doneAt: null, result: null, needs: null, why: null, card: null, by: null }); change(s); return JSON.stringify(s); };
    const forms = { empty: '', brace: '{', bom: '\ufeff{}', 'over 1 MB': ' '.repeat(P.MAX_BYTES + 1), 'schema 2': withTask((s) => { s.schema = 2; }), 'a missing key': withTask((s) => { delete s.gate; }),
        'a bad status': withTask((s) => { s.tasks[0].status = 'DONE'; }), 'a bad time': withTask((s) => { s.updatedAt = '2026-11-13 10:00'; }) };
    for (const [name, text] of Object.entries(forms))
    {
        const p = plan();
        fs.writeFileSync(p.file, text);
        const r = untouched(p, () => call(p, ['sync', '--plan', 'csv']));
        assert.deepStrictEqual([r.code, r.out], [3, ''], name);
        assert.match(r.err, /^plan-status: status\.json is not a schema 1 status file: .+ - fix the file, or delete it and run sync \(it rebuilds the tasks at todo\)\n$/, name);
        assert.strictEqual(call(p, ['check', '--plan', 'csv']).code, 3, name);
    }
    const named = plan();
    fs.writeFileSync(named.file, forms['a bad status']);
    assert.match(call(named, ['sync', '--plan', 'csv']).err, /: tasks\[0\]\.status - /, 'the line names the field');
});

test('a write keeps a key it does not know, after the known ones', () =>
{
    const p = plan();
    ok(call(p, ['sync', '--plan', 'csv']));
    edit(p, (s) => { s.later = { a: 1 }; s.tasks[0].extra = 'x'; });
    fs.writeFileSync(mdOf(p), markdown([...CARDS, [4, 'New', 5]]));
    ok(call(p, ['sync', '--plan', 'csv']));
    const got = read(p);
    assert.deepStrictEqual([Object.keys(got), got.later, Object.keys(got.tasks[0]), got.tasks[0].extra, got.tasks.length], [[...P.KEYS, 'later'], { a: 1 }, [...P.TASK_KEYS, 'extra'], 'x', 4]);
});

test('the lock: a held lock is exit 4 after the wait and stays; a stale one is taken over', () =>
{
    const p = plan();
    ok(call(p, ['sync', '--plan', 'csv']));
    fs.writeFileSync(mdOf(p), markdown([...CARDS, [4, 'New', 5]]));
    const lock = `${p.file}.lock`;
    fs.writeFileSync(lock, '1');
    const t0 = Date.now();
    untouched(p, () => refused(call(p, ['sync', '--plan', 'csv']), 4, /^plan-status: status\.json\.lock is held - run the call again\n$/));
    assert.ok(Date.now() - t0 >= 1400 && fs.existsSync(lock), 'it waited, and left the other call\'s lock');
    const old = new Date(Date.now() - 6000);
    fs.utimesSync(lock, old, old);
    ok(call(p, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual([read(p).tasks.length, fs.existsSync(lock)], [4, false]);
});

test('a plan folder that cannot be written is exit 4', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
{
    const p = plan();
    fs.chmodSync(p.dir, 0o555);
    try { refused(call(p, ['sync', '--plan', 'csv']), 4, /^plan-status: cannot write in \.alfred\/docs\/work\/plans\/csv\/: E(ACCES|PERM)\n$/); }
    finally { fs.chmodSync(p.dir, 0o755); }
});

test('check: one plan or --all; each problem is a !! line and the exit is 3', () =>
{
    const p = plan();
    assert.deepStrictEqual(lines(ok(call(p, ['check', '--plan', 'csv']))), [`plan-status: check - no status yet - run sync - plan csv (${REL})`]);
    assert.deepStrictEqual(lines(ok(call(p, ['check', '--all']))), ['plan-status: check ok - 0 checked']);
    ok(call(p, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual(lines(ok(call(p, ['check', '--plan', 'csv']))), [`plan-status: check ok - plan csv (${REL})`]);
    assert.deepStrictEqual(lines(ok(call(p, ['check', '--all']))), ['plan-status: check ok - 1 checked']);
    edit(p, (s) => { s.tasks[0].status = 'DONE'; delete s.gate; });
    const r = untouched(p, () => call(p, ['check', '--all']));
    assert.deepStrictEqual([r.code, r.err], [3, 'plan-status: check found 2 problems\n']);
    assert.deepStrictEqual(lines(r).map((l) => l.replace(/ - .*/, '')).sort(), ['!! csv: gate', '!! csv: tasks[0].status']);
    fs.writeFileSync(p.file, '{');
    assert.match(call(p, ['check', '--plan', 'csv']).out, /^!! csv: status\.json unreadable - /);
});

test('list: every folder plan on a line, the flat plans counted in one', () =>
{
    const p = plan();
    ok(call(p, ['sync', '--plan', 'csv']));
    const plans = path.dirname(p.dir);
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(plans, rel)), { recursive: true }); fs.writeFileSync(path.join(plans, rel), text); };
    put('draft/draft.md', markdown()); put('broken/broken.md', markdown()); put('broken/status.json', '{'); put('notes/readme.md', 'x');
    put('old-a.md', '# a\n'); put('old-b.md', '# b\n\nCompleted: 2026-10-01\n');
    assert.deepStrictEqual(lines(ok(call(p, ['list']))), ['plan-status: list ok', 'broken - unreadable (.alfred/docs/work/plans/broken/)',
        `csv - not approved - 0 of 3 done - next task 1 (${REL})`, 'draft - not synced (.alfred/docs/work/plans/draft/)', 'flat: 2']);
    assert.deepStrictEqual(lines(ok(call(plan({ md: null }), ['list']))), ['plan-status: list ok', 'no plan']);
});

test('the CLI: the exit code is the verb\'s, stdout and stderr carry the lines', () =>
{
    const p = plan();
    const cli = (argv, input = '') => spawnSync(process.execPath, [ENGINE, ...argv], { cwd: p.root, input, encoding: 'utf8', env: { ...scrubbed(process.env), CLAUDE_PROJECT_DIR: p.root } });
    const first = cli(['sync', '--plan', '.alfred/docs/work/plans/csv']);
    assert.deepStrictEqual([first.status, first.stderr, first.stdout.split('\n')[0]], [0, '', `plan-status: sync ok - plan csv (${REL})`]);
    assert.match(read(p).updatedAt, P.TIME_RE);
    const bad = cli(['tick', '--plan', 'csv']);
    assert.deepStrictEqual([bad.status, bad.stdout], [2, '']);
    fs.writeFileSync(p.file, '{');
    assert.strictEqual(cli(['sync', '--plan', 'csv']).status, 3);
    assert.strictEqual(fs.readFileSync(p.file, 'utf8'), '{');
});
