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
    'stack/skills/capture-awareness/references/project.md',
    'stack/skills/capture-awareness/references/project-code-style-doc-shape.md',
    'stack/skills/capture-awareness/references/related-projects.md',
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
// asks first unless its loop invoked it, and its doc-shape no longer claims 'no write gate'. Since 2026-10-29 each is
// a part of capture-quality - a reference beside the router, which carries the frontmatter.
const QUALITY = 'stack/skills/capture-quality';
const part = (name) => `${QUALITY}/references/${name}.md`;
const RUN_GATES = {
    'architecture-quality': { doc: 'ARCHITECTURE-ASSESSMENT.md', before: '### 1. ORIENT' },
    'code-quality': { doc: 'CODE-ASSESSMENT.md', before: '### 1. ORIENT' },
    'test-coverage-quality': { doc: 'COVERAGE-QUALITY.md', before: '### 3. MEASURE' },
};
test('audit 2026-10-08: the three model-invocable captures gate an unrequested run behind one ask', () => {
    const { lintAskTemplates } = require('./lint-skills.js');
    assert.ok(!/^disable-model-invocation:/m.test(read(`${QUALITY}/SKILL.md`).split('---')[1]), 'capture-quality stays model-invocable - the loops call it');
    for (const [name, { doc, before }] of Object.entries(RUN_GATES))
    {
        const text = read(part(name));
        const flat = squash(text);
        const gate = flat.indexOf('Run gate');
        assert.ok(gate > -1 && gate < flat.indexOf(before), `${name}: the run gate sits before ${before}`);
        assert.match(flat, /No answer, no run\./, `${name}: no answer means no run`);
        const block = text.match(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/m);
        assert.ok(block && block[1].includes(doc), `${name}: the gate is an ask template naming ${doc}`);
        assert.deepStrictEqual(lintAskTemplates([{ file: name, text }]), [], `${name}: lint 61 holds`);
        // The coverage doc shape was folded into its part's step 5 (audit 2026-10-30 SKC-05).
        const shape = name === 'test-coverage-quality' ? part(name) : part(`${name}-doc-shape`);
        assert.ok(!squash(read(shape)).includes('No write gate, no diff check'), `${name}: the reference no longer says 'no write gate'`);
    }
    for (const name of ['architecture-quality', 'code-quality'])
        assert.ok(squash(read(part(name))).includes('`Run gate:`'), `${name}: the receipt records the gate`);
    assert.ok(read(part('test-coverage-quality')).includes('Run gate:    <'), 'the coverage close records the gate');
});

// Stack audit 2026-10-20 row 10: a FIRST coverage capture ran the instrumented suites (Docker / Testcontainers) before
// any ask. It now asks 'Measure now' before MEASURE, joined with the bar and mode asks in one call.
test('stack audit 2026-10-20: a first coverage capture asks before it measures', () => {
    const { lintAskTemplates } = require('./lint-skills.js');
    const text = read(part('test-coverage-quality'));
    const flat = squash(text);
    const gate = flat.indexOf('Run gate on a FIRST capture no calling flow started.');
    assert.ok(gate > -1 && gate < flat.indexOf('### 3. MEASURE'), 'the first-capture gate sits before MEASURE');
    assert.match(flat, /in the SAME AskUserQuestion call as the first capture's other asks \(the % bar, the analysis mode\)/);
    const asks = [...text.matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => m[1]);
    const first = asks.find((a) => /No COVERAGE-QUALITY\.md yet\. Measure every surface now\?/.test(a));
    assert.ok(first, 'the first-capture gate is a template');
    assert.match(first, /^\s*- 'Measure now \(Recommended\)'/m);
    assert.match(first, /- 'Not now' - nothing runs, nothing is written/);
    assert.deepStrictEqual(lintAskTemplates([{ file: 'test-coverage-quality', text }]), []);
    assert.ok(text.includes('Run gate:    <the answer verbatim | invoked by the coverage loop>'), 'a first capture records its answer too');
});

test('audit 2026-10-08: each capture close is a literal template with its post-write check named', () => {
    const cov = read(part('test-coverage-quality'));
    for (const field of ['Doc:', 'Raw:', 'Verdicts:', 'Weak points:', 'Unmeasured:', 'Leftovers:'])
        assert.match(cov, new RegExp(`^${field} +\\S`, 'm'), `coverage close carries ${field}`);
    assert.ok(squash(cov).includes('`wc -l` COVERAGE-QUALITY.md after the write; a missing `## Resume` section is fixed before the report'), 'coverage measures its write');
    // Each part's fields live in its reference, the close's own in the router (the capture-awareness merge, 2026-10-29).
    const aware = ['SKILL.md', 'references/agents.md', 'references/project.md', 'references/related-projects.md']
        .map((f) => read(`stack/skills/capture-awareness/${f}`)).join('\n');
    for (const field of ['Agents:', 'Inventory:', 'Project:', 'Asked:', 'Unknown:', 'Credentials:', 'Value check:', 'Watch:', 'Related:', 'Landed:', 'Rule:'])
        assert.match(aware, new RegExp(`^${field} +<`, 'm'), `awareness close carries ${field}`);
    for (const ref of ['project', 'related-projects'])
        assert.ok(squash(read(`stack/skills/capture-awareness/references/${ref}.md`)).includes('node .claude/hooks/docs.js lint awareness'), `${ref} lints the awareness domain`);
    assert.ok(!aware.includes('Verify before reporting:'), 'the prose close is gone');
    const style = read('stack/skills/capture-awareness/references/project-code-style.md');
    assert.match(style, /^Verify: +</m, 'code-style close carries Verify:');
    assert.ok(squash(style).includes('`node .claude/hooks/docs.js lint preferences`'), 'code-style lints its domain');
    const aq = read(part('architecture-quality'));
    assert.ok(aq.includes('| `Ceilings:` |'), 'the Known-ceilings flag has a receipt field');
    assert.ok(read('stack/skills/capture-awareness/references/project.md').includes('node .claude/hooks/docs.js watch <one file DISCOVER cited>') && /^Watch: +</m.test(aware), 'the run book checks its watch globs');
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
    assert.ok(line.includes(`\`ALFRED_CODE_CONTEXT_WINDOW_DEFAULT\` itself (${seed('ALFRED_CODE_CONTEXT_WINDOW_DEFAULT')} seeded - a trigger, never a window)`), 'the default trigger');
    assert.ok(line.includes(`\`ALFRED_CODE_CONTEXT_WINDOW_FOR_1M\` (${seed('ALFRED_CODE_CONTEXT_WINDOW_FOR_1M')} seeded)`), 'the 1M trigger');
    assert.ok(line.includes(`\`ALFRED_CODE_CONTEXT_WINDOW_FOR_300K\` (${seed('ALFRED_CODE_CONTEXT_WINDOW_FOR_300K')})`), 'the 300K trigger');
    assert.ok(line.includes(`\`ALFRED_CODE_CONTEXT_WINDOW_FOR_200K\` (${seed('ALFRED_CODE_CONTEXT_WINDOW_FOR_200K')}; a trigger at or above the window clamps to 90% of it)`), 'the 200K trigger and its clamp');
    assert.match(read('stack/hooks/fresh-session.js'), /at >= window\) at = Math\.floor\(window \* 0\.9\)/, 'the clamp the line names is the hook\'s');
    // the privacy invariant sits where compaction never cuts it - before the run, not after ~18k chars
    const skill = read('stack/skills/capture-usage-report/SKILL.md');
    assert.ok(skill.indexOf('## Privacy rule') > -1 && skill.indexOf('## Privacy rule') < skill.indexOf('## The run'), 'privacy rule before the run');
    const ref = squash(read('stack/skills/capture-usage-report/references/diagnosis-discipline.md'));
    assert.ok(ref.includes('the TOKEN VERDICT (delivered / cost / avoidable share') && ref.includes('## Verdict - one table'), 'the moved section clauses live in the reference');
});

test('audit 2026-10-08: the inventory marks every capture a loop invokes as model-invocable by design', () => {
    const inv = read('stack/skills/capture-awareness/scripts/awareness-state.js');
    const set = /const MODEL_INVOCABLE_BY_DESIGN = new Set\(\[([^\]]*)\]\)/.exec(inv);
    const names = [...set[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const loop of ['loop-architecture-quality', 'loop-code-quality', 'loop-test-coverage-quality'])
    {
        const body = read(`stack/skills/${loop}/SKILL.md`);
        for (const cap of ['capture-awareness', 'capture-quality'])
            if (body.includes(`\`${cap}\``) && !/^disable-model-invocation:/m.test(read(`stack/skills/${cap}/SKILL.md`).split('---')[1]))
                assert.ok(names.includes(cap), `${loop} names ${cap}, so the generated rule lists it as orchestration`);
    }
    assert.ok(names.includes('capture-quality') && names.includes('capture-awareness'), 'the loops\' captures are in the set');
});

test('audit 2026-10-08: the architecture part keeps its anecdotes in the evidence appendix', () => {
    const body = read('stack/skills/capture-awareness/references/architecture.md');
    assert.doesNotMatch(body, /\(measured/, 'no measured parenthetical in the run-time body');
    const ev = squash(read('stack/skills/capture-awareness/references/architecture-evidence.md'));
    assert.ok(ev.includes('preload is 51% of seat input tokens') && ev.includes('a line-number grep re-verified a code claim'), 'both anecdotes moved');
    assert.ok(squash(read('stack/skills/capture-awareness/references/architecture-doc-shapes.md')).includes("('1 (overlay, 12 sections)')"), 'the overlay count rule moved to Branches');
    const flat = squash(body);
    assert.ok(flat.indexOf('- Write the map to its required shape') < flat.indexOf('- After the write, run `node .claude/hooks/docs.js lint awareness --map`'), 'the write precedes its lint');
});

// Audit 2026-10-14 SKC01: three captures told the run to apply markdown-style to their doc under the docs root,
// which markdown-docs.md and markdown-style itself exclude (the root belongs to the skill that writes it).
// e1b790fe fixed the related-projects capture; the same wording now covers the other three.
test('audit 2026-10-14 SKC01: no capture loads markdown-style for its docs-root doc', () => {
    const files = [
        'stack/skills/capture-awareness/references/project-code-style.md',
        'stack/skills/capture-awareness/references/project-code-style-doc-shape.md',
        'stack/skills/capture-awareness/references/architecture.md',
        'stack/skills/capture-awareness/references/architecture-doc-shapes.md',
        part('test-coverage-quality'),
    ];
    for (const rel of files)
        assert.doesNotMatch(read(rel), /markdown-style/, `${rel}: names markdown-style for a docs-root doc`);
    assert.ok(squash(read('stack/skills/capture-awareness/references/project-code-style.md')).includes('no formatting skill loads for it (the docs root belongs to the skill that writes it)'),
        'the code-style part states why no formatting skill loads');
    assert.ok(read('stack/skills/capture-awareness/references/architecture-doc-shapes.md').includes('Load `docs-as-code` before writing'), 'the diagram load stays');
});

// Audit 2026-10-14 SKC05: the login ask's recommended option promised to add the account's keys to the sensitive
// data, but every install writes that file and the run may never append to it - the report hands KEY= lines instead.
test('audit 2026-10-14 SKC05: the login ask names the KEY= handoff, never a write to an existing sensitive-data file', () => {
    const raw = read('stack/skills/capture-awareness/references/project.md');
    const ask = (raw.match(/```ask\nHow does an agent log in\?[\s\S]*?```/) || [''])[0];
    assert.ok(ask, 'the login ask is a template');
    const first = ask.split('\n').find((l) => l.startsWith('- '));
    assert.match(first, /\(Recommended\)' - the report hands one `KEY=` line per key for `<data root>\/\.secrets`/, 'the recommended option names the handoff');
    assert.doesNotMatch(ask, /its keys, empty, in/, 'no promised write');
    const ref = squash(read('stack/skills/capture-awareness/references/project.md'));
    assert.ok(ref.includes('The capture writes it only when the login answer asked for the keys and it is absent (an install older than that)') && ref.includes('every value EMPTY'), 'the absent-file write stays the stated exception');
});

// Audit 2026-10-14 SKC06: the usage-report body sat at the compaction re-attach cut with the `Discipline: read`
// receipt rule as the first text to drop. The receipt rule now sits in step 4 beside the read it receipts, and the
// machine-section list and the previously-audited test live in the run-mechanics reference.
test('audit 2026-10-14 SKC06: the usage-report receipt rule sits early, its mechanics in the reference', () => {
    const raw = read('stack/skills/capture-usage-report/SKILL.md');
    const at = Buffer.from(raw).indexOf('The discipline is READ this run, never remembered');
    assert.ok(at > -1 && at < 15000, `the receipt rule sits before byte 15000 (at ${at})`);
    assert.ok(raw.length < 19000, `the body shrank (${raw.length})`);
    assert.doesNotMatch(raw, /## Don't game it[\s\S]*step-4 discipline is READ/, 'no second copy at the end');
    const mech = squash(read('stack/skills/capture-usage-report/references/run-mechanics.md'));
    assert.ok(mech.includes('## Which sessions to skip - the previously-audited test') && mech.includes('carries no `FILL IN` section'), 'the skip test moved');
    assert.ok(mech.includes('A non-use finding cites that section\'s own row instead of the stack\'s full catalog'), 'the inventory rule moved');
    assert.ok(squash(raw).includes('the test (the report, never the folder) is in `references/run-mechanics.md`'), 'the body points at it');
});
