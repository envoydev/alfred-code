'use strict';
// Audit 2026-10-08 (skills): markdown-style, docs-as-code and dev-log-convert.
// - markdown-style (C15): the body forbids opening the references unless a rule is in dispute, so a fix
//   cites the quick-reference row; a closing lint re-run is a required line; the examples never stop on a
//   prose 'send the path'.
// - docs-as-code: the render check has a step the run can perform (a local parse), and the CLI is spelled the
//   way the package README spells it.
// - dev-log-convert: the per-input-shape rules fire on most inputs, so they live in the body, not behind a
//   pointer; both time asks are templates.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { lintAskTemplates } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

test('audit 2026-10-08: markdown-style cites what it has loaded and closes on a lint re-run', () => {
    const raw = read('stack/skills/markdown-style/SKILL.md');
    const md = squash(raw);
    assert.ok(md.includes('Neither `references/` file is opened unless a specific rule the two quick-reference tables do not settle is actually in dispute'), 'the no-open rule stands');
    assert.ok(md.includes("each fix cites the quick-reference row it breaks (e.g. 'syntax: Headings'), and a reference short name only when that file was opened for a dispute"), 'Pass 1 cites a row');
    assert.ok(md.includes('Every finding cites a rule - a quick-reference row, or the reference entry when one was opened.'), 'the hard limit agrees');
    assert.doesNotMatch(md, /each fix cites its rule by short name/, 'no short name the body never loaded');
    assert.ok(md.includes('**Close.** Re-run `markdownlint` on every file you edited and quote its summary line') && md.includes('mark it UNVERIFIED'), 'the close re-runs the linter');
    assert.doesNotMatch(md, /Send the path\.|Point me at the file/, 'no prose stop in the examples');
    assert.ok(md.includes('`markdown-docs-root-carve-out`') || md.includes('The generated docs root is NOT governed here'), 'the registered carve-out stays');
    assert.match(squash(read('stack/skills/markdown-style/references/syntax-canon.md')), /\(one entry, `syntax\/lists\/nested-indent-4`, is a should-fix and says so\)/);
});

test('audit 2026-10-08: docs-as-code has a parse step the run can perform, spelled as the CLI documents it', () => {
    const dac = squash(read('stack/skills/docs-as-code/SKILL.md'));
    assert.ok(dac.includes('## Mermaid ground rules (every Mermaid diagram)'), 'three diagram types route here');
    // the spelling is the package README's own (github.com/mermaid-js/mermaid-cli: `npx -p @mermaid-js/mermaid-cli mmdc -h`)
    assert.ok(dac.includes('`npx -p @mermaid-js/mermaid-cli mmdc -i <file>.mmd -o <tmp>/out.svg`'), 'the local parse');
    assert.ok(dac.includes('confirm the package and flags through the documentation server first'), 'the flags are confirmed at use');
    assert.doesNotMatch(dac, /preview on mermaid\.live/, 'the browser preview is no longer the only proof');
    assert.doesNotMatch(squash(read('stack/skills/docs-as-code/references/adr.md')), /is `capture-architecture`'s protocol/, 'no ownership breadcrumb');
});

test('audit 2026-10-08: dev-log-convert carries its per-input-shape rules inline and asks through templates', () => {
    const raw = read('stack/skills/dev-log-convert/SKILL.md');
    const dl = squash(raw);
    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills/dev-log-convert/references/edge-cases.md')), 'the reference is folded in');
    assert.doesNotMatch(raw, /edge-cases\.md/, 'nothing points at it');
    for (const rule of ['append `Testing. Merged changes.`', 'opens with `Investigated <brief topic>.`', 'never `Continued`', '`Off (<reason>).`', 'trust the bullets and recompute `Total time`', 'no weekend skip'])
        assert.ok(dl.includes(rule), `the body carries '${rule}'`);
    assert.strictEqual((raw.match(/^[ \t]*```ask[ \t]*$/gm) || []).length, 2, 'the split and the granularity asks are templates');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'dev-log-convert', text: raw }]), []);
    assert.strictEqual((dl.match(/write `\(time not specified\)`/g) || []).length, 0, 'the placeholder rule is stated once');
    assert.ok(dl.includes('A request to log work read off the repo still starts from \'dev-log\'.'), 'the repo route says how it fires');
    assert.doesNotMatch(dl, /\(measured|Measured:/, 'the measurement stories are cut to their rules');
});
