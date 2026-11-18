'use strict';
// The record reader (install/records.js): one view of what the stack wrote for a skill or a seat copy,
// read from the stamp's library-* line and, where that has none, from the ledger's managed-files row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashItem } = require('./install/library.js');
const { recordView, recordOf, editedSince } = require('./install/records.js');

const HASH_LIBRARY = 'a'.repeat(64);
const HASH_LEDGER = 'b'.repeat(64);
const HASH_SKILL_ROW = 'c'.repeat(64);
const HASH_SEAT_ROW = 'd'.repeat(64);

function scratch()
{
    return fs.mkdtempSync(path.join(os.tmpdir(), 'records-'));
}

function stampWith(dir, lines)
{
    const file = path.join(dir, 'alfred-code.stamp');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
}

test('recordView: a library line wins over a ledger row of the same item', () =>
{
    const dir = scratch();
    const stamp = stampWith(dir, ['version: 1.0.0', `library-skills: foo=${HASH_LIBRARY}`, `library-agents: bar=${HASH_LIBRARY}`, 'library-rules: ']);
    const ledger = { files: { 'skills/foo': HASH_LEDGER, 'agents/bar.md': HASH_LEDGER } };
    const view = recordView(stamp, ledger);
    assert.equal(view.skills.foo, HASH_LIBRARY);
    assert.equal(view.agents.bar, HASH_LIBRARY);
    assert.equal(view.ledgerHeld, true);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('recordView: a managed-files row fills a skill and a seat the library lines lack', () =>
{
    const dir = scratch();
    const stamp = stampWith(dir, ['version: 1.0.0', `library-skills: other=${HASH_LIBRARY}`, 'library-agents: ', 'library-rules: ']);
    const ledger = { files: { 'skills/foo': HASH_SKILL_ROW, 'agents/bar.md': HASH_SEAT_ROW, 'hooks/h.js': HASH_LEDGER, 'AGENTS.md': HASH_LEDGER } };
    const view = recordView(stamp, ledger);
    assert.deepEqual(view.skills, { other: HASH_LIBRARY, foo: HASH_SKILL_ROW });
    assert.deepEqual(view.agents, { bar: HASH_SEAT_ROW });
    assert.deepEqual(view.rules, {});
    fs.rmSync(dir, { recursive: true, force: true });
});

test('recordView: no stamp and no ledger give empty maps and ledgerHeld false', () =>
{
    const dir = scratch();
    const absent = path.join(dir, 'absent.stamp');
    const expected = { skills: {}, agents: {}, rules: {}, ledgerHeld: false };
    assert.deepEqual(recordView(absent, null), expected);
    assert.deepEqual(recordView(null, null), expected);
    assert.deepEqual(recordView(absent, { files: null }), expected, 'a ledger with no managed-files line holds nothing');
    assert.equal(recordView(absent, { files: {} }).ledgerHeld, true, 'an empty files map is still a held ledger');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('recordOf: null for an item neither line records', () =>
{
    const dir = scratch();
    const stamp = stampWith(dir, ['version: 1.0.0', `library-skills: foo=${HASH_LIBRARY}`, 'library-agents: ', 'library-rules: ']);
    const view = recordView(stamp, { files: { 'agents/bar.md': HASH_SEAT_ROW } });
    assert.equal(recordOf(view, 'skill', 'foo'), HASH_LIBRARY);
    assert.equal(recordOf(view, 'agent', 'bar'), HASH_SEAT_ROW);
    assert.equal(recordOf(view, 'skill', 'nothing'), null);
    assert.equal(recordOf(view, 'agent', 'foo'), null, 'a skill record is not a seat record');
    assert.equal(recordOf(view, 'skill', 'constructor'), null, 'no inherited key counts as a record');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('editedSince: false at the record\'s hash, true at another, false with no record, false for a missing file', () =>
{
    const dir = scratch();
    const file = path.join(dir, 'bar.md');
    fs.writeFileSync(file, 'one\n');
    const atRecord = hashItem(file);
    const stamp = stampWith(dir, ['version: 1.0.0', 'library-skills: ', `library-agents: bar=${atRecord}`, 'library-rules: ']);
    const view = recordView(stamp, null);
    assert.equal(editedSince(view, 'agent', 'bar', file), false, 'unchanged since the record');
    fs.writeFileSync(file, 'two\n');
    assert.equal(editedSince(view, 'agent', 'bar', file), true, 'changed since the record');
    assert.equal(editedSince(view, 'agent', 'unrecorded', file), false, 'no record is never edited');
    assert.equal(editedSince(view, 'agent', 'bar', path.join(dir, 'gone.md')), false, 'a missing file is not edited');
    fs.rmSync(dir, { recursive: true, force: true });
});
