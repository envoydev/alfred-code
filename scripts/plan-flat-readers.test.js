'use strict';
// PF1 (plan 2, Task 6): every reader of a single-file plan carries the mark `PF1 flat plan - until 4.0.0` in a comment, so
// 4.0.0 finds and removes them with one grep. A new flat reader joins this table or is not written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const MARK = 'PF1 flat plan - until 4.0.0';
const AT_LEAST = {
    'stack/hooks/docs-session.js': 1,
    'stack/hooks/guard-stop-contract.js': 2,
    'stack/hooks/guard-fresh-session-start.js': 3,
    'stack/hooks/guard-unapproved-dispatch.js': 1,
    'stack/hooks/session-status.js': 1,
    'stack/hooks/history.js': 3,
    'stack/hooks/layout.js': 1,
    'stack/hooks/plan-status.js': 1,
    'scripts/analyze-usage.js': 1,
};
const marked = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').split(/\r?\n/).filter((l) => l.includes(MARK));

test('each flat reader carries the mark at least as often as the table says, always in a comment', () =>
{
    for (const [rel, n] of Object.entries(AT_LEAST))
    {
        const lines = marked(rel);
        assert.ok(lines.length >= n, `${rel}: ${lines.length} marks, at least ${n} expected`);
        for (const l of lines) assert.ok(/^\s*\/\//.test(l) || l.indexOf('//') >= 0 && l.indexOf('//') < l.indexOf(MARK), `${rel}: the mark sits outside a comment: ${l.trim()}`);
    }
});

test('no other hook carries the mark', () =>
{
    const dir = path.join(REPO, 'stack', 'hooks');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')))
    {
        const rel = `stack/hooks/${f}`;
        if (rel in AT_LEAST) continue;
        assert.strictEqual(marked(rel).length, 0, `${rel} carries the mark - add it to the table or drop the flat reader`);
    }
});
