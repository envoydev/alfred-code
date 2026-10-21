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
        assert.ok(body.includes('no script or no docs from this cwd: `preferences: not checked - <why>`, never silent'), f);
    }
});

// I2: P3 (a) left the code-quality capture handing its seats CODE-PREFERENCES.md entries only, an architecture entry
// being the architecture-quality capture's hand-off, and the findings gate now reads 'a style opinion' and cites
// `CODE-PREFERENCES.md#c3`; the analyzer seat still named both docs and the old wording.
test('I2: the code-quality analyzer is handed code preferences only, in the findings gate\'s words', () =>
{
    const body = flat(read('stack/agents/code-quality-analyzer.md'));
    assert.ok(!body.includes('ARCHITECTURE-PREFERENCES.md'), 'no architecture entries');
    assert.ok(body.includes("the user's preference entries from `PERSONAL-CODE-PREFERENCES.md`;"), 'code entries');
    assert.ok(!body.includes("'it differs from a preference'"), 'old wording');
    assert.ok(body.includes("'breaks PERSONAL-CODE-PREFERENCES.md#c3'"), 'the cite');
});

// I3: the README said 'about 16k tokens' while docs/install-footprint.md measured 12.6k-13.8k (system audit 2026-10-20b
// R2) - two numbers for one fact, one of them stale. The footprint doc keeps the measurement; the README points at it.
test('I3: the README points at the footprint doc for the always-on cost, never a figure of its own', () =>
{
    const faq = read('README.md').split('What does it cost per message?')[1].split('</details>')[0];
    assert.ok(!/\d+(\.\d+)?k tokens/.test(faq), 'no second figure');
    assert.ok(faq.includes('(docs/install-footprint.md)'), 'the footprint doc');
    assert.ok(faq.includes('`/alfred-code:status`'), 'the install\'s own number');
});

// S1 (final review 2026-10-20b): the rule template and the doc shape name the git rule's consent and safety lines beside
// the never-list, but the capture skill's own conflict check, which tells the user before a weakening entry is written,
// did not - so 'force-push freely' was recorded with no warning while the rule it lands in says it never binds.
test('S1: the capture\'s conflict check names the locked git entries in its never-binds list', () =>
{
    const body = flat(read('stack/skills/capture-preferences/SKILL.md'));
    assert.ok(body.includes("the git doc's locked entries") && body.includes("never binds there, and no entry weakens a `locked` one"), 'the conflict check');
    const sites = JSON.parse(read('meta/shared-rules.json')).rules['git-preferences-carve-out'].sites.map((s) => s.file);
    assert.ok(sites.includes('stack/skills/capture-preferences/SKILL.md'), 'pinned as a site of the carve-out');
});

// S2 (final review 2026-10-20b): the build skill derives `<plan id>` from 'the plan file's name' but never named that
// file, so a seat brief's `plan:` line and the stamp's folder could each guess a different name and the dispatch hook
// refused the implementer. The protocol writes `<docs-path>/work/plans/<feature>.md`; the skill names it, one per slice.
test('S2: the build skill names the plan file its plan id comes from, one per slice', () =>
{
    const body = flat(read('stack/skills/task-build-from-scratch/SKILL.md'));
    assert.ok(body.includes("(`<plan id>` is the plan file's name without `.md` - the file the protocol writes for the slice, `<docs-path>/work/plans/<feature>.md` with the slice as `<feature>`, so each slice has its own id)"), 'the plan file named');
    const protocol = flat(read('stack/skills/task-build-from-scratch/references/domain-trio-protocol.md'));
    assert.ok(protocol.includes('you write `<docs-path>/work/plans/<feature>.md` from it'), 'the protocol writes that path');
});
