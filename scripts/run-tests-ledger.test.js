'use strict';
// Bug 2 of the complexity audit (2026-11-10): test rows reached this checkout's real hook-blocks ledger
// (.alfred/statistics/hook-blocks/nosession.jsonl, 213 rows), where a folder-wide tally counts them as sessions.
// run-tests.js snapshots the checkout's two ledger folders around the whole run and fails it on any new or grown
// file but a live session's own (a UUID name): these are the pieces it does that with.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkoutLedgers, ledgerSnapshot, ledgerGrowth, LIVE_SESSION_FILE } = require('./hook-test-env.js');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-growth-'));

test('checkoutLedgers names the two ledger folders under a checkout', () => {
    assert.deepStrictEqual(checkoutLedgers('/r'), [path.join('/r', '.alfred', 'statistics', 'hook-blocks'), path.join('/r', '.alfred', 'docs', 'hook-blocks')]);
});

test('ledgerSnapshot of a missing folder is empty, never a throw', () => {
    const root = tmpRoot();
    try { assert.deepStrictEqual([...ledgerSnapshot(checkoutLedgers(root)).entries()], []); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ledgerGrowth reports new and grown files, sorted, and nothing when nothing changed', () => {
    const root = tmpRoot();
    try
    {
        const [stats] = checkoutLedgers(root);
        fs.mkdirSync(stats, { recursive: true });
        fs.writeFileSync(path.join(stats, 'sweep-var.jsonl'), '{"a":1}\n');
        const before = ledgerSnapshot(checkoutLedgers(root));
        assert.deepStrictEqual(ledgerGrowth(before, ledgerSnapshot(checkoutLedgers(root))), [], 'nothing changed');
        fs.appendFileSync(path.join(stats, 'sweep-var.jsonl'), '{"a":2}\n');
        fs.writeFileSync(path.join(stats, 'nosession.jsonl'), '{"b":1}\n');
        assert.deepStrictEqual(ledgerGrowth(before, ledgerSnapshot(checkoutLedgers(root))),
            [path.join(stats, 'nosession.jsonl'), path.join(stats, 'sweep-var.jsonl')]);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ledgerGrowth leaves out a live session\'s own file (a UUID name)', () => {
    const root = tmpRoot();
    try
    {
        const [stats] = checkoutLedgers(root);
        fs.mkdirSync(stats, { recursive: true });
        const live = path.join(stats, '11111111-2222-4333-8444-555555555555.jsonl');
        fs.writeFileSync(live, '{"a":1}\n');
        const before = ledgerSnapshot(checkoutLedgers(root));
        fs.appendFileSync(live, '{"a":2}\n');
        assert.deepStrictEqual(ledgerGrowth(before, ledgerSnapshot(checkoutLedgers(root))), []);
        assert.ok(LIVE_SESSION_FILE.test(path.basename(live)) && !LIVE_SESSION_FILE.test('nosession.jsonl'));
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ledgerGrowth reports a file in a ledger folder created after the first snapshot', () => {
    const root = tmpRoot();
    try
    {
        const before = ledgerSnapshot(checkoutLedgers(root));
        const docs = checkoutLedgers(root)[1];
        fs.mkdirSync(docs, { recursive: true });
        fs.writeFileSync(path.join(docs, 'x.jsonl'), '{}\n');
        assert.deepStrictEqual(ledgerGrowth(before, ledgerSnapshot(checkoutLedgers(root))), [path.join(docs, 'x.jsonl')]);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
