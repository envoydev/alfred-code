'use strict';
// Audit 2026-10-08 (skills): how the captures write their docs and when they may run at all.
// - C9 / BLOCKER 3: two captures said both 'MERGE writes the file directly' and 'MERGE calls `set`
//   unconditionally', and `docs.js set` refuses a file that does not exist yet - so a first capture on an
//   overlay branch failed. Every capture now states one route: a first capture writes whole, a re-run goes
//   through `set`, and the engine picks the target. The engine half is exercised on a real fixture.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { repo } = require('./docs-fixture.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

const ROUTE_FILES = [
    'stack/skills/capture-project-capabilities/references/doc-shape.md',
    'stack/skills/capture-code-style/references/doc-shape.md',
    'stack/skills/capture-related-projects/references/artifact-shapes.md',
];

test('C9: every capture states one docs-engine write route - whole on a first capture, `set` on a re-run', () => {
    for (const rel of ROUTE_FILES)
    {
        const text = squash(read(rel));
        assert.ok(text.includes('`docs.js set` refuses a file that does not exist yet'), `${rel}: a first capture writes the file whole`);
        assert.ok(text.includes('on mainline, without git or under git versioning, and into this branch\'s overlay otherwise - the capture never decides which'),
            `${rel}: the engine picks the target`);
        assert.ok(text.includes('also edit the top `Captured:` line to this run\'s'), `${rel}: an in-place re-run keeps the doc stamp current`);
        for (const stale of ['calls `set` unconditionally', 'writes the file directly', 'directly** (Write'])
            assert.ok(!text.includes(stale), `${rel}: still carries the contradicting route '${stale}'`);
    }
    const entry = JSON.parse(read('meta/shared-rules.json')).rules['capture-docs-engine-write-route'];
    assert.ok(entry, 'the route is registered as a shared rule');
    assert.deepStrictEqual([entry.owner.file, ...entry.sites.map((s) => s.file)].sort(), [...ROUTE_FILES].sort(), 'owner + both sites');
});

test('C9: the engine refuses `set` on a missing doc on an overlay branch, and takes it once the file exists', () => {
    const r = repo();
    try
    {
        r.write('.claude/docs/code-style/watch.json', '{}\n');
        r.git('switch', '-q', '-c', 'feature/x');
        const missing = r.cli(['set', 'CODE-STYLE#typescript'], '## TypeScript\nTwo-space indent.\n');
        assert.match(missing.stdout, /no such doc file/, 'set cannot create the first file');
        r.write('.claude/docs/code-style/CODE-STYLE.md', 'Captured: feature/x@abc1234, 2026-10-08\n\n## TypeScript\n<!-- id: typescript -->\nTwo-space indent.\n');
        const rerun = r.cli(['set', 'CODE-STYLE#typescript'], '## TypeScript\nFour-space indent.\n');
        assert.doesNotMatch(rerun.stdout, /no such doc file|error/i, `a re-run's set lands: ${rerun.stdout}${rerun.stderr}`);
        assert.match(r.cli(['show', 'CODE-STYLE#typescript']).stdout, /Four-space indent/, 'the branch reads the re-run section');
    }
    finally { r.rm(); }
});

// The three model-invocable captures that dispatch seats and replace their doc: a description match on a
// conversational question ('what are the risks here?') used to start the whole run with no approval. Each now
// asks first unless its loop invoked it, and its doc-shape no longer claims 'no write gate'.
const RUN_GATES = {
    'capture-architecture-quality': { shape: 'references/doc-shape.md', doc: 'ASSESSMENT.md', before: '### 1. ORIENT' },
    'capture-code-quality': { shape: 'references/doc-shape.md', doc: 'CODE-ASSESSMENT.md', before: '### 1. ORIENT' },
    'capture-test-coverage': { shape: 'references/doc-shape.md', doc: 'COVERAGE.md', before: '### 3. MEASURE' },
};
test('audit 2026-10-08: the three model-invocable captures gate an unrequested run behind one ask', () => {
    const { lintAskTemplates } = require('./lint-skills.js');
    for (const [name, { shape, doc, before }] of Object.entries(RUN_GATES))
    {
        const text = read(`stack/skills/${name}/SKILL.md`);
        assert.ok(!/^disable-model-invocation:/m.test(text.split('---')[1]), `${name} stays model-invocable - its loop calls it`);
        const flat = squash(text);
        const gate = flat.indexOf('Run gate');
        assert.ok(gate > -1 && gate < flat.indexOf(before), `${name}: the run gate sits before ${before}`);
        assert.match(flat, /No answer, no run\./, `${name}: no answer means no run`);
        const block = text.match(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/m);
        assert.ok(block && block[1].includes(doc), `${name}: the gate is an ask template naming ${doc}`);
        assert.deepStrictEqual(lintAskTemplates([{ file: name, text }]), [], `${name}: lint 61 holds`);
        assert.ok(!squash(read(`stack/skills/${name}/${shape}`)).includes('No write gate, no diff check'), `${name}: the reference no longer says 'no write gate'`);
    }
    for (const name of ['capture-architecture-quality', 'capture-code-quality'])
        assert.ok(squash(read(`stack/skills/${name}/SKILL.md`)).includes('`Run gate:`'), `${name}: the receipt records the gate`);
    assert.ok(read('stack/skills/capture-test-coverage/SKILL.md').includes('Run gate:    <'), 'the coverage close records the gate');
});

test('audit 2026-10-08: each capture close is a literal template with its post-write check named', () => {
    const cov = read('stack/skills/capture-test-coverage/SKILL.md');
    for (const field of ['Doc:', 'Raw:', 'Verdicts:', 'Weak points:', 'Unmeasured:', 'Leftovers:'])
        assert.match(cov, new RegExp(`^${field} +\\S`, 'm'), `coverage close carries ${field}`);
    assert.ok(squash(cov).includes('`wc -l` COVERAGE.md after the write; a missing `## Resume` section is fixed before the report'), 'coverage measures its write');
    const rel = read('stack/skills/capture-related-projects/SKILL.md');
    for (const field of ['Rule:', 'Doc:', 'Skipped:', 'first_read:', 'Landed:'])
        assert.match(rel, new RegExp(`^${field} +<`, 'm'), `related-projects close carries ${field}`);
    assert.ok(squash(rel).includes('`node .claude/hooks/docs.js lint related-projects`'), 'related-projects lints its domain');
    assert.ok(!rel.includes('Verify before reporting:'), 'the prose close is gone');
    const style = read('stack/skills/capture-code-style/SKILL.md');
    assert.match(style, /^Verify: +</m, 'code-style close carries Verify:');
    assert.ok(squash(style).includes('`node .claude/hooks/docs.js lint code-style`'), 'code-style lints its domain');
    const aq = read('stack/skills/capture-architecture-quality/SKILL.md');
    assert.ok(aq.includes('| `Ceilings:` |'), 'the Known-ceilings flag has a receipt field');
    const look = read('stack/skills/capture-first-look/SKILL.md');
    for (const field of ['File:', 'Stack:', 'Modules:', 'Not declared:', 'Lint:', 'Replaced by:'])
        assert.match(look, new RegExp(`^${field} +`, 'm'), `first-look close carries ${field}`);
    const caps = read('stack/skills/capture-project-capabilities/SKILL.md');
    assert.ok(caps.includes('node .claude/hooks/docs.js watch <one file DISCOVER cited>') && /^Watch: +</m.test(caps), 'the run book checks its watch globs');
});

// C12: the fresh-session figures the usage audit judges a session against are the hook's seeded defaults,
// read from the one env catalog - a drifted figure judged every unlisted-model claim against the wrong bar.
test('audit 2026-10-08: the usage audit quotes the fresh-session seeds the env catalog holds', () => {
    const rows = JSON.stringify(JSON.parse(read('meta/environment.json')));
    const seed = (key) =>
    {
        const m = new RegExp(`"key":"${key}","default":"(\\d+)"`).exec(rows);
        assert.ok(m, `meta/environment.json seeds ${key}`);
        return Number(m[1]).toLocaleString('en-US');
    };
    const line = squash(read('stack/skills/capture-usage-report/references/diagnosis-discipline.md'));
    assert.ok(line.includes(`\`ALFRED_CODE_DEFAULT_CONTEXT_WINDOW\`, ${seed('ALFRED_CODE_DEFAULT_CONTEXT_WINDOW')} seeded`), 'the default window');
    assert.ok(line.includes(`\`ALFRED_CODE_FRESH_SESSION_1M\` (${seed('ALFRED_CODE_FRESH_SESSION_1M')} seeded)`), 'the 1M trigger');
    assert.ok(line.includes(`\`ALFRED_CODE_FRESH_SESSION_200K\` (${seed('ALFRED_CODE_FRESH_SESSION_200K')})`), 'the 200k trigger');
    assert.ok(line.includes(`\`ALFRED_CODE_FRESH_SESSION_DEFAULT\` (${seed('ALFRED_CODE_FRESH_SESSION_DEFAULT')} - a trigger at or above the window clamps to 90% of it`), 'the default trigger and its clamp');
    assert.match(read('stack/hooks/fresh-session.js'), /at >= window\) at = Math\.floor\(window \* 0\.9\)/, 'the clamp the line names is the hook\'s');
    // the privacy invariant sits where compaction never cuts it - before the run, not after ~18k chars
    const skill = read('stack/skills/capture-usage-report/SKILL.md');
    assert.ok(skill.indexOf('## Privacy rule') > -1 && skill.indexOf('## Privacy rule') < skill.indexOf('## The run'), 'privacy rule before the run');
    const ref = squash(read('stack/skills/capture-usage-report/references/diagnosis-discipline.md'));
    assert.ok(ref.includes('the TOKEN VERDICT (delivered / cost / avoidable share') && ref.includes('## Verdict - one table'), 'the moved section clauses live in the reference');
});

test('audit 2026-10-08: the inventory marks every capture a loop invokes as model-invocable by design', () => {
    const inv = read('stack/skills/capture-agent-capabilities/scripts/capabilities-inventory.js');
    const set = /const MODEL_INVOCABLE_BY_DESIGN = new Set\(\[([^\]]*)\]\)/.exec(inv);
    const names = [...set[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const loop of ['loop-architecture-quality', 'loop-quality', 'loop-test-coverage'])
    {
        const body = read(`stack/skills/${loop}/SKILL.md`);
        for (const cap of ['capture-architecture', 'capture-architecture-quality', 'capture-code-quality', 'capture-test-coverage'])
            if (body.includes(`\`${cap}\``) && !/^disable-model-invocation:/m.test(read(`stack/skills/${cap}/SKILL.md`).split('---')[1]))
                assert.ok(names.includes(cap), `${loop} names ${cap}, so the generated rule lists it as orchestration`);
    }
    assert.ok(names.includes('capture-test-coverage'), 'the coverage loop\'s capture is in the set');
});

test('audit 2026-10-08: capture-architecture keeps its anecdotes in the evidence appendix', () => {
    const body = read('stack/skills/capture-architecture/SKILL.md');
    assert.doesNotMatch(body, /\(measured/, 'no measured parenthetical in the run-time body');
    const ev = squash(read('stack/skills/capture-architecture/references/evidence.md'));
    assert.ok(ev.includes('preload is 51% of seat input tokens') && ev.includes('a line-number grep re-verified a code claim'), 'both anecdotes moved');
    assert.ok(squash(read('stack/skills/capture-architecture/references/doc-shapes.md')).includes("('1 (overlay, 12 sections)')"), 'the overlay count rule moved to Branches');
    const flat = squash(body);
    assert.ok(flat.indexOf('- Write the map to its required shape') < flat.indexOf('- After the write, run `node .claude/hooks/docs.js lint architecture`'), 'the write precedes its lint');
});
