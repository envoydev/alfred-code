'use strict';
// stack/hooks/plan-status.js - PF1 D7: the one writer of a plan folder's status.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
