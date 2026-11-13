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

const GATE = ['Oriented:  verified', 'Asked:     verified', 'Decisions: 2 entries, each with its precedent', 'Scope:     matches', 'Existence: 6 names checked, 0 unverified',
    'Passes:    risk pass | scope pass | existence pass | edges pass | soundness pass', 'Findings:  none', 'Gated:     passed'].join('\n');
const SUITE = 'suite: npm test - 412 passed, 0 failed\n';
// A plan approved at 10:05 from the three cards.
function approved(opts) { const p = plan(opts); ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session'], '', '2026-11-13T10:05:00Z')); return p; }

test('gate: stores the eight-field block, its verdict and the time; a missing label is refused', () =>
{
    const p = plan();
    refused(call(p, ['gate', '--plan', 'csv'], GATE), 2, /^plan-status: no status yet - run sync\n$/);
    ok(call(p, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual(lines(ok(call(p, ['gate', '--plan', 'csv'], `${GATE}\r\n\r\n`, '2026-11-13T09:58:00Z'))), [`plan-status: gate ok - plan csv (${REL})`, 'Gated: passed', 'Resume: next task 1']);
    assert.deepStrictEqual(read(p).gate, { at: '2026-11-13T09:58Z', verdict: 'passed', block: GATE });
    for (const label of ['Oriented', 'Passes', 'Gated']) untouched(p, () => refused(call(p, ['gate', '--plan', 'csv'], GATE.replace(`${label}:`, `${label} -`)), 2, new RegExp(`^plan-status: gate refused: no ${label}: line\\n$`)));
    ok(call(p, ['gate', '--plan', 'csv'], GATE.replace('none', 'x'.repeat(5000))));
    const g = read(p).gate;
    assert.deepStrictEqual([g.block.length, g.block.endsWith('...'), g.verdict], [4000, true, 'passed'], 'the verdict is read before the cut');
});

test('approve: syncs, stamps the time with the mode or the words; the same approval changes nothing', () =>
{
    const p = plan();                                         // no status.json yet: approve syncs first
    assert.deepStrictEqual(lines(ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session'], '', '2026-11-13T10:05:00Z'))),
        [`plan-status: approve ok - plan csv (${REL})`, 'Approved: 2026-11-13T10:05Z - mode session', 'Resume: next task 1']);
    assert.deepStrictEqual([read(p).approvedAt, read(p).approval, read(p).tasks.length], ['2026-11-13T10:05Z', { mode: 'session', words: null }, 3]);
    untouched(p, () => ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session'], '', '2026-11-13T11:00:00Z'), /^plan-status: approve - nothing to change - /));
    ok(call(p, ['approve', '--plan', 'csv', '--mode', 'agents'], '', '2026-11-13T11:00:00Z'));
    assert.deepStrictEqual([read(p).approvedAt, read(p).approval.mode], ['2026-11-13T10:05Z', 'agents'], 'R6: the approval alone');
    untouched(p, () => refused(call(p, ['sync', '--plan', 'csv']), 2, /^plan-status: sync refused: the plan is approved - redesign reopens it\n$/));
    const w = plan();
    ok(call(w, ['approve', '--plan', 'csv'], 'words: go ahead,\n"ship" it\n', '2026-11-13T10:05:00Z'), /^Approved: 2026-11-13T10:05Z - "go ahead, "ship" it"$/m);
    assert.deepStrictEqual(read(w).approval, { mode: null, words: 'go ahead,\n"ship" it' });
});

test('approve: refused with neither a mode nor words, a mode that is none, no task, a bad card - and nothing is written', () =>
{
    const p = plan();
    refused(call(p, ['approve', '--plan', 'csv']), 2, /^plan-status: approve needs --mode session\|agents or a words: line\n$/);
    refused(call(p, ['approve', '--plan', 'csv'], 'words:\n'), 2, /approve needs --mode/);
    refused(call(p, ['approve', '--plan', 'csv', '--mode', 'auto']), 2, /^plan-status: --mode is session or agents\n$/);
    const empty = plan({ md: markdown([]) });
    refused(call(empty, ['approve', '--plan', 'csv', '--mode', 'session']), 2, /^plan-status: approve refused: no task\n$/);
    const bad = plan({ md: markdown([[1, 'A', 5], [1, 'B', 5]]) });
    refused(call(bad, ['approve', '--plan', 'csv', '--mode', 'session']), 2, /^plan-status: approve refused: task 1 - two cards carry this id\n$/);
    assert.deepStrictEqual([p, empty, bad].map((x) => fs.existsSync(x.file)), [false, false, false]);
});

test('redesign: reopens the design with approvedAt kept, takes the task in flight back to todo; approve closes it', () =>
{
    const p = approved();
    refused(call(plan(), ['redesign', '--plan', 'csv'], 'why: x\n'), 2, /no status yet - run sync/);
    ok(call(p, ['gate', '--plan', 'csv'], GATE, '2026-11-13T10:05:00Z'));
    edit(p, (s) => { Object.assign(s.tasks[0], { status: 'in_progress', startedAt: '2026-11-13T10:06Z' }); });
    untouched(p, () => refused(call(p, ['redesign', '--plan', 'csv'], 'why: x\n'), 2, /^plan-status: redesign refused: task 1 is in_progress - name it with --task\n$/));
    untouched(p, () => refused(call(p, ['redesign', '--plan', 'csv', '--task', '2'], 'why: x\n'), 2, /redesign refused: task 2 is not in_progress/));
    ok(call(p, ['redesign', '--plan', 'csv', '--task', '1'], 'why: the export must stream\n', '2026-11-13T10:20:00Z'));
    const s = read(p);
    assert.deepStrictEqual([s.reopenedAt, s.approvedAt, s.gate], ['2026-11-13T10:20Z', '2026-11-13T10:05Z', null], 'D5: approvedAt is never cleared');
    assert.deepStrictEqual(s.reopens, [{ at: '2026-11-13T10:20Z', why: 'the export must stream', approvedAt: '2026-11-13T10:05Z', gate: { at: '2026-11-13T10:05Z', verdict: 'passed', block: GATE }, task: '1' }]);
    assert.deepStrictEqual([s.tasks[0].status, s.tasks[0].startedAt, s.tasks[0].estimateMin, s.tasks[0].why], ['todo', '2026-11-13T10:06Z', 25, 'the export must stream']);
    untouched(p, () => refused(call(p, ['redesign', '--plan', 'csv'], 'why: again\n'), 2, /redesign refused: the design is already reopened/));
    untouched(p, () => refused(call(p, ['complete', '--plan', 'csv', '--with-open'], SUITE), 2, /complete refused: the design is reopened - approve it again first/));
    fs.writeFileSync(mdOf(p), markdown([[1, 'Export projection, streamed', 60], [2, 'Streamed endpoint', 30], [3, 'Docs page', 10]]));
    ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session'], '', '2026-11-13T10:40:00Z'));
    const a = read(p);
    assert.deepStrictEqual([a.approvedAt, a.reopenedAt, a.reopens.length, a.tasks[0].title, a.tasks[0].estimateMin], ['2026-11-13T10:40Z', null, 1, 'Export projection, streamed', 25], 'the estimate of a started task stays frozen');
    const fresh = plan();
    ok(call(fresh, ['sync', '--plan', 'csv']));
    refused(call(fresh, ['redesign', '--plan', 'csv'], 'why: x\n'), 2, /redesign refused: the plan is not approved/);
    const two = approved();
    edit(two, (s) => { s.tasks[0].status = 'in_progress'; s.tasks[1].status = 'in_progress'; });
    refused(call(two, ['redesign', '--plan', 'csv', '--task', '1'], 'why: x\n'), 2, /redesign refused: task 2 is in_progress - finish or block it first/);
});

test('cursor, decide, deviate, conformance: what each stores and refuses; a value is cut at its cap', () =>
{
    const p = approved();
    const c = (verb, stdin, at = T0, extra = []) => call(p, [verb, '--plan', 'csv', ...extra], stdin, at);
    assert.strictEqual(lines(ok(c('cursor', 'note: step 4 BUILD - mode session\n', '2026-11-13T10:10:00Z'))).pop(), 'Resume: step 4 BUILD - mode session - next task 1');
    assert.deepStrictEqual(read(p).resume, { note: 'step 4 BUILD - mode session', next: '1', at: '2026-11-13T10:10Z' });
    untouched(p, () => ok(c('cursor', 'note: step 4 BUILD - mode session\n', '2026-11-13T12:00:00Z'), /cursor - nothing to change/));
    refused(c('cursor', ''), 2, /^plan-status: cursor needs a note: line\n$/);
    ok(c('decide', 'choice: stream with IAsyncEnumerable\nprecedent: ExportController.cs:41\n', '2026-11-13T10:12:00Z', ['--task', '2']));
    ok(c('decide', 'choice: a\nprecedent: b\n', '2026-11-13T10:13:00Z'));
    assert.deepStrictEqual(read(p).decisions, [{ at: '2026-11-13T10:12Z', task: '2', choice: 'stream with IAsyncEnumerable', precedent: 'ExportController.cs:41' }, { at: '2026-11-13T10:13Z', task: null, choice: 'a', precedent: 'b' }]);
    refused(c('decide', 'choice: a\n'), 2, /^plan-status: decide needs a precedent: line\n$/);
    refused(c('decide', 'choice: a\nprecedent: b\n', T0, ['--task', '9']), 2, /^plan-status: decide refused: unknown task 9\n$/);
    ok(c('deviate', 'what: a DTO, not the entity\nwhy: the entity leaks the tenant id\nasked: yes, use a DTO\n', '2026-11-13T10:30:00Z', ['--task', '1']));
    ok(c('deviate', 'what: w\nwhy: y\n', '2026-11-13T10:31:00Z'));
    assert.deepStrictEqual(read(p).deviations, [{ at: '2026-11-13T10:30Z', task: '1', what: 'a DTO, not the entity', why: 'the entity leaks the tenant id', asked: 'yes, use a DTO' }, { at: '2026-11-13T10:31Z', task: null, what: 'w', why: 'y', asked: null }]);
    refused(c('deviate', 'what: w\n'), 2, /^plan-status: deviate needs a why: line\n$/);
    ok(c('conformance', 'verdict: conforms\nreviewer: aspnet-verifier, pass 1\n', '2026-11-13T11:00:00Z'), /^Conformance: conforms$/m);
    assert.deepStrictEqual(read(p).conformance, { at: '2026-11-13T11:00Z', verdict: 'conforms', reviewer: 'aspnet-verifier, pass 1', skipped: null });
    ok(c('conformance', 'skipped: "skip it, I read the diff myself"\n', '2026-11-13T11:05:00Z'), /^Conformance: skipped$/m);
    assert.deepStrictEqual(read(p).conformance, { at: '2026-11-13T11:05Z', verdict: 'skipped', reviewer: null, skipped: '"skip it, I read the diff myself"' });
    refused(c('conformance', 'verdict: conforms\n'), 2, /^plan-status: conformance needs a reviewer: or a skipped: line\n$/);
    refused(c('conformance', 'reviewer: r\n'), 2, /^plan-status: conformance needs a verdict: line\n$/);
    ok(c('decide', `choice: ${'c'.repeat(1000)}\nprecedent: ${'p'.repeat(1001)}\n`));
    const d = read(p).decisions.pop();
    assert.deepStrictEqual([d.choice.length, d.choice.endsWith('c'), d.precedent.length, d.precedent.endsWith('p...')], [1000, true, 1000, true], 'R4: at the cap whole, one over cut');
});

test('complete: needs the approval, a suite, no task in flight and every task done unless --with-open; then every write is refused', () =>
{
    const p = approved();
    const done = (t) => Object.assign(t, { status: 'done', startedAt: '2026-11-13T10:06Z', doneAt: '2026-11-13T10:30Z', result: 'r' });
    refused(call(p, ['complete', '--plan', 'csv']), 2, /^plan-status: complete needs a suite: line\n$/);
    untouched(p, () => refused(call(p, ['complete', '--plan', 'csv'], SUITE), 2, /^plan-status: complete refused: tasks 1, 2, 3 are not done - finish or drop them, or pass --with-open\n$/));
    edit(p, (s) => { s.tasks[0].status = 'in_progress'; });
    untouched(p, () => refused(call(p, ['complete', '--plan', 'csv', '--with-open'], SUITE), 2, /^plan-status: complete refused: task 1 is in_progress\n$/));
    edit(p, (s) => { done(s.tasks[0]); s.tasks[2].status = 'failed'; });
    assert.deepStrictEqual(lines(ok(call(p, ['complete', '--plan', 'csv', '--with-open'], SUITE, '2026-11-13T12:00:00Z'))), [`plan-status: complete ok - plan csv (${REL})`, 'Completed: 2026-11-13T12:00Z', 'Resume: no task left']);
    const s = read(p);
    assert.deepStrictEqual([s.completedAt, s.completion, s.resume.next], ['2026-11-13T12:00Z', { suite: 'npm test - 412 passed, 0 failed', open: ['2', '3'] }, null]);
    const writes = [['sync'], ['gate', GATE], ['approve', '', '--mode', 'session'], ['redesign', 'why: x\n'], ['cursor', 'note: x\n'], ['decide', 'choice: a\nprecedent: b\n'],
        ['deviate', 'what: a\nwhy: b\n'], ['conformance', 'verdict: v\nreviewer: r\n'], ['complete', SUITE]];
    for (const [verb, stdin = '', ...flags] of writes) untouched(p, () => refused(call(p, [verb, '--plan', 'csv', ...flags], stdin), 2, new RegExp(`^plan-status: ${verb} refused: new scope is a new plan\\n$`)));
    const all = approved();
    edit(all, (x) => { x.tasks.forEach(done); });
    ok(call(all, ['complete', '--plan', 'csv'], SUITE));
    assert.deepStrictEqual(read(all).completion.open, []);
    const not = plan();
    ok(call(not, ['sync', '--plan', 'csv']));
    refused(call(not, ['complete', '--plan', 'csv', '--with-open'], SUITE), 2, /complete refused: the plan is not approved/);
});

const CARD = '### Task - Rate limit the export\n\n- files: src/limit.cs\n- estimate: 15m\n';
const task = (p, id) => read(p).tasks.find((t) => t.id === id);

test('start, done, block, fail, reopen: each move, its fields and its lines', () =>
{
    const p = approved();
    const me = { CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-1111-4222-8333-444444444444' };
    const c = (verb, id, stdin = '', at = T0, env = me) => call(p, [verb, '--plan', 'csv', '--task', id], stdin, at, env);
    assert.deepStrictEqual(lines(ok(c('start', '1', '', '2026-11-13T10:06:00Z'))), [`plan-status: start ok - plan csv (${REL})`, 'Tasks: 0 of 3 done - task 1 in_progress', 'Resume: next task 1']);
    assert.deepStrictEqual([task(p, '1').status, task(p, '1').startedAt, task(p, '1').by], ['in_progress', '2026-11-13T10:06Z', me.CLAUDE_CODE_SESSION_ID]);
    assert.strictEqual(lines(untouched(p, () => ok(c('start', '1', '', '2026-11-13T10:07:00Z'))))[0], `plan-status: start - nothing to change - plan csv (${REL})`);
    const foreign = untouched(p, () => ok(c('start', '1', '', T0, { CLAUDE_CODE_SESSION_ID: 'bbbbbbbb-2222' })));
    assert.ok(lines(foreign).includes('!! task 1 was started by another session (aaaaaaaa)'));
    assert.ok(!ok(c('start', '1', '', T0, {})).out.includes('!!'), 'a call with no session id cannot tell');
    const r = ok(c('done', '1', 'result: dotnet test - 4 passed, 0 failed\n  cost $HOME `id`\nresult: quoted\n', '2026-11-13T10:37:00Z'));
    assert.deepStrictEqual(lines(r).slice(1), ['Tasks: 1 of 3 done - task 1 done, 25m estimated, 31m taken', 'Resume: next task 2']);
    assert.deepStrictEqual([task(p, '1').status, task(p, '1').doneAt, task(p, '1').result], ['done', '2026-11-13T10:37Z', 'dotnet test - 4 passed, 0 failed\n  cost $HOME `id`\nresult: quoted']);
    untouched(p, () => ok(c('done', '1', 'result: another\n'), /done - nothing to change/));
    refused(c('start', '1'), 2, /^plan-status: start refused: task 1 is done - reopen it first\n$/);
    ok(c('reopen', '1', 'why: a 500 on an empty set\n', '2026-11-13T11:00:00Z'));
    assert.deepStrictEqual([task(p, '1').status, task(p, '1').startedAt, task(p, '1').doneAt, task(p, '1').why, read(p).resume.next], ['in_progress', '2026-11-13T10:06Z', null, 'a 500 on an empty set', '1']);
    ok(c('block', '1', 'needs: the staging database\n'));
    assert.deepStrictEqual([task(p, '1').status, task(p, '1').needs], ['blocked', 'the staging database']);
    ok(c('done', '1', 'result: r2\n', '2026-11-13T11:30:00Z'));       // the wait is over: blocked goes straight to done
    ok(c('start', '2', '', '2026-11-13T11:31:00Z'));
    ok(c('fail', '2', 'why: the SDK lacks the call\n'));
    assert.deepStrictEqual([task(p, '2').status, task(p, '2').why], ['failed', 'the SDK lacks the call']);
    refused(c('done', '2', 'result: r\n'), 2, /^plan-status: done refused: task 2 is failed - start it first\n$/);
    ok(c('start', '2', '', '2026-11-13T12:00:00Z'));
    assert.strictEqual(task(p, '2').startedAt, '2026-11-13T11:31Z', 'startedAt is written once');
    refused(c('done', '3', 'result: r\n'), 2, /done refused: task 3 is todo - start it first/);
    refused(c('block', '3', 'needs: n\n'), 2, /block refused: task 3 is not in_progress/);
    refused(c('fail', '3', 'why: w\n'), 2, /fail refused: task 3 is not in_progress or blocked/);
    refused(c('reopen', '3', 'why: w\n'), 2, /reopen refused: task 3 is not done/);
    refused(c('done', '2', ''), 2, /^plan-status: done needs a result: line\n$/);
    refused(c('start', '9'), 2, /^plan-status: start refused: unknown task 9\n$/);
    refused(call(p, ['start', '--plan', 'csv']), 2, /^plan-status: start needs --task <id>\n$/);
    ok(c('done', '2', `result: ${'r'.repeat(2001)}\n`));
    assert.deepStrictEqual([task(p, '2').result.length, task(p, '2').result.endsWith('r...')], [2000, true]);
});

test('done: minutes taken never negative; with no estimate the line carries none', () =>
{
    const p = approved({ md: markdown([[1, 'A', null]]) });
    ok(call(p, ['start', '--plan', 'csv', '--task', '1'], '', '2026-11-13T10:30:00Z'));
    assert.deepStrictEqual(lines(ok(call(p, ['done', '--plan', 'csv', '--task', '1'], 'result: r\n', '2026-11-13T10:10:00Z'))).slice(1), ['Tasks: 1 of 1 done - task 1 done, 0m taken', 'Resume: no task left']);
});

test('task verbs wait for the approval and stop while the design is reopened', () =>
{
    const p = plan();
    ok(call(p, ['sync', '--plan', 'csv']));
    refused(call(p, ['start', '--plan', 'csv', '--task', '1']), 2, /^plan-status: start refused: the plan is not approved\n$/);
    refused(call(p, ['add-task', '--plan', 'csv'], CARD), 2, /^plan-status: add-task refused: the plan is not approved\n$/);
    ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session']));
    ok(call(p, ['redesign', '--plan', 'csv'], 'why: x\n'));
    for (const [verb, stdin] of [['start', ''], ['done', 'result: r\n'], ['block', 'needs: n\n'], ['fail', 'why: w\n'], ['reopen', 'why: w\n'], ['drop', 'why: w\n']])
        untouched(p, () => refused(call(p, [verb, '--plan', 'csv', '--task', '1'], stdin), 2, new RegExp(`^plan-status: ${verb} refused: approve the design again first\\n$`)));
    untouched(p, () => refused(call(p, ['add-task', '--plan', 'csv'], CARD), 2, /add-task refused: approve the design again first/));
});

test('add-task and drop: the next free id, a retired id never reused, the place', () =>
{
    const p = approved();
    assert.strictEqual(lines(ok(call(p, ['add-task', '--plan', 'csv', '--after', '1'], `\n${CARD}\n\n`)))[1], 'Tasks: 0 of 4 done - task 4 added');
    assert.deepStrictEqual(read(p).tasks.map((t) => t.id), ['1', '4', '2', '3']);
    assert.deepStrictEqual([task(p, '4').title, task(p, '4').status, task(p, '4').estimateMin, task(p, '4').card, task(p, '4').startedAt], ['Rate limit the export', 'todo', 15, CARD.trimEnd(), null]);
    assert.strictEqual(lines(ok(call(p, ['drop', '--plan', 'csv', '--task', '4'], 'why: folded into task 2\n', '2026-11-13T10:25:00Z')))[1], 'Tasks: 0 of 3 done - task 4 dropped');
    const s = read(p);
    assert.deepStrictEqual([s.tasks.map((t) => t.id), s.retiredIds, s.dropped], [['1', '2', '3'], ['4'], [{ id: '4', title: 'Rate limit the export', at: '2026-11-13T10:25Z', why: 'folded into task 2' }]]);
    ok(call(p, ['add-task', '--plan', 'csv'], CARD));
    assert.deepStrictEqual(read(p).tasks.map((t) => t.id), ['1', '2', '3', '5'], 'last, and never id 4 again');
    untouched(p, () => refused(call(p, ['add-task', '--plan', 'csv'], '### Task - No estimate\n\n- files: a\n'), 2, /^plan-status: add-task refused: the other tasks carry an estimate and this card has none\n$/));
    untouched(p, () => refused(call(p, ['add-task', '--plan', 'csv'], '### Task 7 - Numbered\n- estimate: 5m\n'), 2, /add-task refused: the heading is '### Task - <title>' - the script gives the id/));
    untouched(p, () => refused(call(p, ['add-task', '--plan', 'csv', '--after', '9'], CARD), 2, /add-task refused: unknown task 9/));
    ok(call(p, ['start', '--plan', 'csv', '--task', '1']));
    untouched(p, () => refused(call(p, ['drop', '--plan', 'csv', '--task', '1'], 'why: w\n'), 2, /^plan-status: drop refused: task 1 is not todo or failed\n$/));
    ok(call(p, ['add-task', '--plan', 'csv'], `### Task - Long\n- estimate: 5m\n${'x'.repeat(7000)}\n`));
    assert.deepStrictEqual([task(p, '6').card.length, task(p, '6').card.endsWith('...')], [6000, true]);
    const bare = approved({ md: markdown([[1, 'A', null]]) });
    ok(call(bare, ['add-task', '--plan', 'csv'], '### Task - No estimate anywhere\n'));
    assert.strictEqual(task(bare, '2').estimateMin, null);
});

test('sync and approve after a reopen: an added task stays as it was, after the task it followed; a card may not take its id', () =>
{
    const p = approved();
    ok(call(p, ['add-task', '--plan', 'csv', '--after', '1'], CARD));                       // 1, 4, 2, 3
    edit(p, (s) => { Object.assign(s.tasks[3], { status: 'done', startedAt: '2026-11-13T10:06Z', doneAt: '2026-11-13T10:30Z', result: 'r' }); });
    const before = task(p, '4');
    ok(call(p, ['redesign', '--plan', 'csv'], 'why: the order was wrong\n'));
    fs.writeFileSync(mdOf(p), markdown([[5, 'New first', 5], [1, 'Export projection', 25]]));   // cards 2 and 3 are gone
    ok(call(p, ['approve', '--plan', 'csv', '--mode', 'session'], '', '2026-11-13T11:00:00Z'));
    const s = read(p);
    assert.deepStrictEqual(s.tasks.map((t) => t.id), ['5', '1', '4', '3'], 'the cards in card order; 4 after 1; done task 3 after the task it followed');
    assert.deepStrictEqual([task(p, '4'), s.retiredIds, s.dropped.map((d) => d.id)], [before, ['2'], ['2']]);
    ok(call(p, ['redesign', '--plan', 'csv'], 'why: again\n'));
    fs.writeFileSync(mdOf(p), markdown([[5, 'New first', 5], [1, 'Export projection', 25], [4, 'Clash', 5]]));
    untouched(p, () => refused(call(p, ['sync', '--plan', 'csv']), 2, /^plan-status: sync refused: task 4 - an added task holds this id\n$/));
    untouched(p, () => refused(call(p, ['approve', '--plan', 'csv', '--mode', 'session']), 2, /^plan-status: approve refused: task 4 - an added task holds this id\n$/));
});

// A plan taken part of the way through a build: task 1 done, 2 blocked, 3 dropped, an added task 4, a decision, a deviation.
function built()
{
    const p = approved();
    const c = (argv, stdin = '', at = T0) => ok(call(p, [argv[0], '--plan', 'csv', ...argv.slice(1)], stdin, at));
    c(['start', '--task', '1'], '', '2026-11-13T10:06:00Z');
    c(['deviate', '--task', '1'], 'what: a DTO, not the entity\nwhy: the entity leaks the tenant id\nasked: yes, use a DTO\n', '2026-11-13T10:30:00Z');
    c(['done', '--task', '1'], 'result: dotnet test - 4 passed, 0 failed\ncost: $5 `echo`\n', '2026-11-13T10:37:00Z');
    c(['start', '--task', '2'], '', '2026-11-13T10:40:00Z');
    c(['decide', '--task', '2'], 'choice: stream with IAsyncEnumerable\nprecedent: ExportController.cs:41\n', '2026-11-13T10:41:00Z');
    c(['block', '--task', '2'], 'needs: the staging database\n');
    c(['drop', '--task', '3'], 'why: the docs page moved to another plan\n', '2026-11-13T10:50:00Z');
    c(['add-task', '--after', '2'], CARD);
    c(['cursor'], 'note: step 4 BUILD - mode session\n');
    return p;
}
const HEAD = (verb) => `plan-status: ${verb} ok - plan csv (${REL})`;

test('show: the stamps that are set, one to a line, then Resume and Tasks; a read never writes or waits on the lock', () =>
{
    const p = plan();
    assert.deepStrictEqual(lines(ok(call(p, ['show', '--plan', 'csv']))), [`plan-status: show - no status yet - run sync - plan csv (${REL})`]);
    assert.deepStrictEqual(lines(ok(call(p, ['resume', '--plan', 'csv']))), [`plan-status: resume - no status yet - run sync - plan csv (${REL})`]);
    refused(call(p, ['show', '--plan', 'gone']), 2, /^plan-status: no plan folder at \.alfred\/docs\/work\/plans\/gone\/\n$/);
    ok(call(p, ['sync', '--plan', 'csv']));
    assert.deepStrictEqual(lines(ok(call(p, ['show', '--plan', 'csv']))), [HEAD('show'), 'Resume: next task 1', 'Tasks: 0 of 3 done']);
    ok(call(p, ['gate', '--plan', 'csv'], GATE));
    ok(call(p, ['approve', '--plan', 'csv'], 'words: go ahead\n', '2026-11-13T10:05:00Z'));
    edit(p, (s) => { s.tasks.forEach((t) => Object.assign(t, { status: 'done', startedAt: '2026-11-13T10:06Z', doneAt: '2026-11-13T10:30Z', result: 'r' })); });
    ok(call(p, ['conformance', '--plan', 'csv'], 'verdict: conforms\nreviewer: r\n'));
    ok(call(p, ['cursor', '--plan', 'csv'], 'note: step 5 CLOSE\n'));
    ok(call(p, ['complete', '--plan', 'csv'], SUITE, '2026-11-13T12:00:00Z'));
    fs.writeFileSync(`${p.file}.lock`, '1');
    const t0 = Date.now();
    const shown = untouched(p, () => ok(call(p, ['show', '--plan', 'csv'])));
    assert.ok(Date.now() - t0 < 1000, 'no lock taken');
    assert.deepStrictEqual(lines(shown), [HEAD('show'), 'Gated: passed', 'Approved: 2026-11-13T10:05Z - "go ahead"', 'Conformance: conforms', 'Completed: 2026-11-13T12:00Z', 'Resume: step 5 CLOSE - no task left', 'Tasks: 3 of 3 done']);
    fs.writeFileSync(p.file, '{');
    assert.strictEqual(call(p, ['show', '--plan', 'csv']).code, 3);
    assert.strictEqual(call(p, ['resume', '--plan', 'csv']).code, 3);
});

test('show --full: the status lines, then the five sections; a $ in a result stays text', () =>
{
    assert.deepStrictEqual(ok(call(built(), ['show', '--plan', 'csv', '--full'])).out.split('\n'), [
        HEAD('show'), 'Approved: 2026-11-13T10:05Z - mode session', 'Resume: step 4 BUILD - mode session - next task 2', 'Tasks: 1 of 3 done', '',
        '## Tasks', '1 done - Export projection - 25m estimated, 31m taken', '  result: dotnet test - 4 passed, 0 failed', '  cost: $5 `echo`',
        '2 blocked - Streamed endpoint - 30m estimated', '  needs: the staging database', '4 todo - Rate limit the export - 15m estimated', '',
        '## Decisions', '- task 2 (2026-11-13T10:41Z)', '  choice: stream with IAsyncEnumerable', '  precedent: ExportController.cs:41', '',
        '## Deviations', '- task 1 (2026-11-13T10:30Z)', '  what: a DTO, not the entity', '  why: the entity leaks the tenant id', '  asked: "yes, use a DTO"', '',
        '## Dropped', '- 3 - Docs page - the docs page moved to another plan', '',
        '## Added cards', '### Task 4 - Rate limit the export', '', '- files: src/limit.cs', '- estimate: 15m', '', '',
    ]);
    const fresh = plan();
    ok(call(fresh, ['sync', '--plan', 'csv']));
    const out = ok(call(fresh, ['show', '--plan', 'csv', '--full'])).out;
    for (const h of ['Decisions', 'Deviations', 'Dropped', 'Added cards']) assert.ok(out.includes(`## ${h}\nnone\n`), h);
    const none = plan({ md: markdown([]) });
    ok(call(none, ['sync', '--plan', 'csv']));
    assert.ok(ok(call(none, ['show', '--plan', 'csv', '--full'])).out.includes('## Tasks\nnone\n'));
});

test('resume: the status lines, the Markdown up to ## Tasks, then each open card - an added one from the status file', () =>
{
    const p = built();
    const out = ok(call(p, ['resume', '--plan', 'csv'])).out;
    const cut = out.indexOf('\n\n');
    assert.deepStrictEqual(out.slice(0, cut).split('\n'), [HEAD('resume'), 'Approved: 2026-11-13T10:05Z - mode session', 'Resume: step 4 BUILD - mode session - next task 2', 'Tasks: 1 of 3 done']);
    const rest = out.slice(cut + 2);
    assert.ok(rest.startsWith('# CSV export - plan\n\nOriented: docs.js show api\nAsked: none\n'));
    assert.ok(rest.includes('### Task 2 - Streamed endpoint\n\n- files: src/x.cs\n- estimate: 30m\n'));
    assert.ok(rest.includes('### Task 4 - Rate limit the export\n\n- files: src/limit.cs\n- estimate: 15m\n'), 'the added card, numbered');
    assert.ok(rest.indexOf('### Task 2 - ') < rest.indexOf('### Task 4 - '), 'array order');
    for (const gone of ['### Task 1 - ', '### Task 3 - ', '## Decisions', '### Task - ']) assert.ok(!rest.includes(gone), gone);
    fs.rmSync(mdOf(p));
    const bare = ok(call(p, ['resume', '--plan', 'csv'])).out;
    assert.ok(bare.includes('!! csv.md is missing\n') && bare.includes('### Task 2 - Streamed endpoint\n(no card in the plan)\n') && bare.includes('### Task 4 - Rate limit the export\n'));
});

test('parseCall: the verb, the plan ref and the task from a shell command\'s text', () =>
{
    const rows = [
        ['node .claude/hooks/plan-status.js done --plan .alfred/docs/work/plans/csv --task 3 <<\'EOF\'\nresult: ok\nEOF', { verb: 'done', plan: '.alfred/docs/work/plans/csv', task: '3' }],
        ['node .claude/hooks/plan-status.js resume --plan csv', { verb: 'resume', plan: 'csv', task: null }],
        ['cd api && node "../.claude/hooks/plan-status.js" start --task 2 --plan "my plans/csv"', { verb: 'start', plan: 'my plans/csv', task: '2' }],
        ['node \'.claude/hooks/plan-status.js\' show --plan \'csv\' --full | head -5', { verb: 'show', plan: 'csv', task: null }],
        ['@\'\nresult: 4 passed\n\'@ | node .claude\\hooks\\plan-status.js done --plan .alfred\\docs\\work\\plans\\csv --task 3', { verb: 'done', plan: '.alfred\\docs\\work\\plans\\csv', task: '3' }],
        ['node .claude/hooks/plan-status.js list', { verb: 'list', plan: null, task: null }],
        ['node .claude/hooks/plan-status.js check --all', { verb: 'check', plan: null, task: null }],
        ['node .claude/hooks/plan-status.js done --plan $PLAN --task 3', null],
        ['node .claude/hooks/plan-status.js done --plan "`cat p`" --task 3', null],
        ['node .claude/hooks/plan-status.js tick --plan csv', null],
        ['node .claude/hooks/plan-status.js done --task 3', null],
        ['node .claude/hooks/plan-status.js check', null],
        ['echo plan-status.js done --plan csv', null],
        ['node scripts/build.js --plan csv', null],
    ];
    for (const [command, want] of rows) assert.deepStrictEqual(P.parseCall(command), want, command);
    for (const not of [undefined, null, 7, '']) assert.strictEqual(P.parseCall(not), null);
});

test('race: two processes, fifty writes each - the file parses and holds all hundred', async () =>
{
    const p = approved();
    const child = (tag) => new Promise((resolve, reject) =>
    {
        const code = `const P = require(${JSON.stringify(ENGINE)}); const at = { cwd: ${JSON.stringify(p.root)}, env: { CLAUDE_PROJECT_DIR: ${JSON.stringify(p.root)} } };
            for (let i = 0; i < 50; i++) { let r; do { r = P.run(['decide', '--plan', 'csv'], { ...at, stdin: 'choice: ${tag}' + i + '\\nprecedent: p\\n' }); } while (r.code === 4);
                if (r.code !== 0) throw new Error(r.err); }`;
        const c = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        c.stderr.on('data', (d) => { err += d; });
        c.on('error', reject);
        c.on('close', (status) => (status === 0 ? resolve() : reject(new Error(err))));
    });
    await Promise.all([child('a'), child('b')]);
    const s = read(p);
    assert.deepStrictEqual(P.validate(s), []);
    const want = ['a', 'b'].flatMap((tag) => Array.from({ length: 50 }, (_, i) => `${tag}${i}`));
    assert.deepStrictEqual(s.decisions.map((d) => d.choice).sort(), want.sort());
    assert.deepStrictEqual(fs.readdirSync(p.dir).sort(), ['csv.md', 'status.json'], 'no lock and no temp file left');
});
