'use strict';
// Audit 2026-10-20b integration: what one track found in another track's files and left for the merge. One file for
// those pins, so no track's own test file carries another's finding.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');

// I1: the registry note says a caller of capture-preferences' script names what to do where it is absent, and
// task-verify-code does; the ten verifier seats ran it with no such line, so a seat with no script had no instruction.
test('I1: every verifier seat names its fallback when the preferences script is absent', () =>
{
    const seats = fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((f) => /-verifier\.md$/.test(f));
    assert.strictEqual(seats.length, 10);
    for (const f of seats)
    {
        const body = flat(read(`stack/agents/${f}`));
        assert.ok(body.includes("quote its `checked:` line (no script there: judge each entry by hand and say so);"), f);
    }
});

// I2: P3 (a) left the code-quality capture handing its seats CODE-PREFERENCES.md entries only, an architecture entry
// being the architecture-quality capture's hand-off, and the findings gate now reads 'a style opinion' and cites
// `CODE-PREFERENCES.md#c3`; the analyzer seat still named both docs and the old wording.
test('I2: the code-quality analyzer is handed code preferences only, in the findings gate\'s words', () =>
{
    const body = flat(read('stack/agents/code-quality-analyzer.md'));
    assert.ok(!body.includes('ARCHITECTURE-PREFERENCES.md'), 'no architecture entries');
    assert.ok(body.includes("the user's preference entries from `CODE-PREFERENCES.md`;"), 'code entries');
    assert.ok(!body.includes("'it differs from a preference'"), 'old wording');
    assert.ok(body.includes("'breaks CODE-PREFERENCES.md#c3'"), 'the cite');
});
