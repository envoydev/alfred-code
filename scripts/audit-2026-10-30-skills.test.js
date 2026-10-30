'use strict';
// The 2026-10-30 report-only audit, track T3 (the flow, capture and habit skills): each block names the finding it
// holds (skills-flows.md SKF-nn, skills-capture-habits.md SKC-nn, rules.md RU-nn), so an edit that brings the
// defect back goes red here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const skill = (name) => read(`stack/skills/${name}/SKILL.md`);
const section = (text, heading) => (text.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1] || '').split(/^## /m)[0];
const registry = () => JSON.parse(read('meta/shared-rules.json')).rules;

test('SKF-03: no skill names the alfred-architecture rule 3.5.0 removed', () =>
{
    const t = flat(skill('task-solve-cross'));
    assert.doesNotMatch(t, /alfred-architecture/, 'task-solve-cross names the removed rule');
    assert.match(t, /`alfred-awareness` points at it when the hook is off/, 'the hook-off pointer is alfred-awareness');
});

test('SKF-04: the two reviewers read their target with one registered text', () =>
{
    const code = skill('review-code');
    const security = skill('review-security');
    const target = section(code, 'Target');
    assert.ok(target.length > 1000, 'review-code has a Target section');
    assert.strictEqual(section(security, 'Target'), target, 'the Target sections are byte-identical');
    const entry = registry()['review-target-read'];
    assert.ok(entry, 'registered as review-target-read');
    const files = [entry.owner, ...entry.sites].map((c) => c.file);
    for (const f of ['stack/skills/review-code/SKILL.md', 'stack/skills/review-security/SKILL.md']) assert.ok(files.includes(f), f);
    const count = /Run inline\. First count the target from its own diff: [\s\S]*?the convention rules the changed files attach/;
    assert.strictEqual(count.exec(flat(security))[0], count.exec(flat(code))[0], 'the Dispatch count sentence is shared');
});

// The compaction re-attach keeps a skill's first 5,000 tokens; the repo pins that at 17,700 body chars
// (audit-2026-10-20-skills.test.js, task-solve's cap). A rule past it is gone after a compaction.
const body = (name) => skill(name).replace(/^---\n[\s\S]*?\n---\n/, '');
const REATTACH = 17700;
const inside = (name, marker) =>
{
    const at = flat(body(name)).indexOf(flat(marker));
    assert.ok(at > -1, `${name}: '${marker}' present`);
    assert.ok(at + flat(marker).length <= REATTACH, `${name}: '${marker}' ends at ${at + flat(marker).length}, past ${REATTACH}`);
};

test('SKF-05: the architecture loop runs its siblings\' anti-gaming sweep and reports the field', () =>
{
    const ref = 'stack/skills/loop-architecture-quality/references/anti-gaming-sweep.md';
    const entry = registry()['anti-gaming-sweep-commands'];
    assert.ok([entry.owner, ...entry.sites].some((c) => c.file === ref), 'the vendored commands are registered');
    const t = flat(skill('loop-architecture-quality'));
    assert.match(t, /round 1 also records the sweep baseline/, 'round 1 records the baseline');
    assert.match(t, /On STOP, when any fix shipped: after the final build \+ tests, Read `references\/anti-gaming-sweep\.md`/, 'the sweep runs at STOP');
    assert.match(t, /\*\*Baseline\*\*, \*\*Anti-gaming\*\*, \*\*Notes\*\*/, 'the report field');
    const mech = flat(read('stack/skills/loop-architecture-quality/references/loop-mechanics.md'));
    assert.match(mech, /Sweep baseline: <sha recorded at round 1>/, 'the RESUME BLOCK carries the baseline');
    assert.match(mech, /\*\*Anti-gaming\*\* - the sweep over the cumulative diff/, 'the field rule');
});

test('SKF-06: the loops\' consent stamp, the round cap and task-implement\'s closers sit inside the re-attach window', () =>
{
    for (const loop of ['loop-architecture-quality', 'loop-code-quality'])
    {
        inside(loop, 'APPROVED small-tier - resumed round <N>');
        inside(loop, 'Hard cap: 3 improve rounds');
        assert.match(flat(section(skill(loop), 'Execution modes')), /mode ask's answer IS the dispatch consent/, `${loop}: the consent stamp sits in Execution modes`);
    }
    inside('task-implement', '**Known ceilings.** File every deliberate simplification');
    inside('task-implement', 'a task that cannot go green honestly goes back to design as a named delta');
});

test('SKF-07: task-solve\'s Modes paragraph is in the reference read first, on every size', () =>
{
    assert.match(flat(read('stack/skills/task-solve/references/full-spec.md')), /\*\*Modes\.\*\* Mode flags right after the command/);
    assert.doesNotMatch(read('stack/skills/task-solve/references/step-mechanics.md'), /\*\*Modes\.\*\*/);
    const sites = [registry()['auto-mode-contract'].owner, ...registry()['auto-mode-contract'].sites].map((c) => c.file);
    assert.ok(sites.includes('stack/skills/task-solve/references/full-spec.md'));
});

test('SKF-08: a findings-path hand-off reads as the diagnosed bug once the heredoc carries its lines', () =>
{
    const { classify } = require('../stack/skills/task-solve/scripts/spec-check.js');
    const bare = classify('.alfred/docs/work/diagnoses/orders-sync-disposed.md');
    assert.strictEqual(bare.bug, '', 'the bare path reads bug: no (the defect)');
    assert.strictEqual(bare.sizeFloor, 'trivial');
    const shaped = classify([
        'Type: bug',
        'Observable: nightly order sync stops after the first batch; expected all batches',
        'Task 1: scope the DbContext per batch - owns src/Orders/OrderSyncJob.cs; acceptance: the sync job test covers three batches and passes',
        'Task 2: integration test for a multi-batch sync - owns tests/Orders/OrderSyncJobTests.cs; acceptance: the test fails on the old code and passes on the fix',
        '.alfred/docs/work/diagnoses/orders-sync-disposed.md',
    ].join('\n'));
    assert.match(shaped.bug, /ticket kind/, 'bug: yes');
    assert.notStrictEqual(shaped.sizeFloor, 'trivial');
    assert.match(flat(read('stack/skills/task-solve/references/full-spec.md')), /A request that is only a findings path [^.]*?put `Type: bug`, the file's `Observable:` line and each `## Tasks` card's title, owned files and acceptance criterion above the path/);
});

test('SKF-10: the diagnoser names the error-monitoring job, not a pre-2.10.1 MCP mechanism', () =>
{
    for (const f of ['stack/skills/issue-diagnoser/SKILL.md', 'stack/skills/issue-diagnoser/references/evidence-tiers.md'])
    {
        const t = flat(read(f));
        assert.doesNotMatch(t, /monitoring MCP|comments out the MCPs/, `${f}: stale MCP wording`);
        assert.match(t, /the error-monitoring tool,? when the start line's tool order ranks one/, f);
    }
});

test('SKF-11: the greenfield close names the captures to the user without a false slash-only claim', () =>
{
    const t = flat(skill('task-build-from-scratch'));
    assert.doesNotMatch(t, /slash-only/);
    assert.match(t, /named to the user, never invoked from here/);
});

test('SKF-12: the refused-stamp ask offers the flow\'s own unit inline', () =>
{
    const want = {
        'task-implement': 'Run the tasks inline',
        'loop-architecture-quality': 'Run this fix inline',
        'loop-code-quality': 'Run this fix inline',
        'loop-test-coverage-quality': 'Run this fix inline',
        'task-build-from-scratch': 'Run this slice inline',
    };
    for (const [name, label] of Object.entries(want))
    {
        const t = skill(name);
        assert.doesNotMatch(t, /'Run this stage inline'/, `${name}: a flow with no stages offers a stage`);
        assert.ok(t.includes(`- '${label}' - no dispatch, no stamp`), `${name}: '${label}'`);
    }
});

// SKF-13 + SKF-14: a skill reads another skill's folder only at a registered exception. mode-auto-run follows the
// installed task-solve SKILL.md (the user's ruling: the one sanctioned route around its manual-only wall); the other
// sites run capture-preferences' checker, which keeps no shared home (the plan's ruling), and say what to do without it.
const CROSS_READS = {
    'mode-auto-run -> task-solve/SKILL.md': 'SKF-13',
    'capture-quality -> capture-preferences/scripts/preferences.js': 'preferences-by-hand',
    'review-code -> capture-preferences/scripts/preferences.js': 'SKF-14',
    'task-verify-code -> capture-preferences/scripts/preferences.js': 'SKF-14',
};
test('SKF-13: every cross-folder skill read is a registered exception', () =>
{
    const dir = path.join(ROOT, 'stack/skills');
    const names = new Set(fs.readdirSync(dir));
    const re = /(?:\.claude\/skills\/|\.\.\/|(?<![\w.-])skills\/)([a-z0-9-]+)\/((?:references|scripts|assets)\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]|SKILL\.md)/g;
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : /\.(md|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
    const seen = new Set();
    for (const f of walk(dir))
    {
        const own = path.relative(dir, f).split(path.sep)[0];
        for (const m of fs.readFileSync(f, 'utf8').matchAll(re))
        {
            if (m[1] === own || !names.has(m[1])) continue;
            const key = `${own} -> ${m[1]}/${m[2]}`;
            assert.ok(CROSS_READS[key], `${path.relative(ROOT, f)}: unregistered cross-folder read ${key}`);
            seen.add(key);
        }
    }
    assert.ok(seen.has('mode-auto-run -> task-solve/SKILL.md'), 'the scan still finds the sanctioned read');
});

test('SKF-15/16: the runtime catalogue covers a production event\'s trace, and its When to use is one case and one boundary', () =>
{
    const t = skill('issue-signatures-runtime');
    const desc = /^description: "(.*)"$/m.exec(t)[1];
    assert.match(desc, /local or production stack trace/);
    assert.match(desc, /Not for red CI\.$/);
    const when = section(t, 'When to use');
    assert.doesNotMatch(when, /Keywords:/);
    assert.doesNotMatch(when, /production incident|local-runtime evidence only/);
    assert.match(flat(when), /on your own machine or in a production event that carries the trace/);
    assert.match(flat(skill('issue-diagnoser')), /for a failure on your own machine or a production event's trace/);
});

test('SKF-17: task-version-upgrade states the auto-run gate once, beside its Modes paragraph', () =>
{
    const t = flat(skill('task-version-upgrade'));
    assert.doesNotMatch(t, /starts ONLY from the user/);
    assert.doesNotMatch(t, /Auto-run is the user's to turn on/);
    assert.strictEqual(t.split('Under auto-run the gate is answered, not skipped').length - 1, 1);
});

test('SKF-18: the handoff-note sites speak of notes, not memory', () =>
{
    for (const f of ['stack/skills/loop-test-coverage-quality/SKILL.md', 'stack/skills/loop-architecture-quality/references/loop-mechanics.md',
        'stack/skills/loop-code-quality/references/loop-mechanics.md', 'stack/skills/task-solve-cross/SKILL.md'])
        assert.doesNotMatch(flat(read(f)), /memory (hand-off|hygiene|store|purge)/, f);
});

test('SKF-19: both reviewers show one filled report row', () =>
{
    for (const name of ['review-code', 'review-security'])
    {
        const row = /A filled row: `([^`]+)`/.exec(section(skill(name), 'Report'));
        assert.ok(row, `${name}: a filled row`);
        assert.strictEqual(row[1].split(' | ').length, 5, `${name}: the row fills every column`);
    }
});

test('SKF-20: the two long verify steps are split into one bullet per rule', () =>
{
    const subs = (name, head) =>
    {
        const lines = skill(name).split('\n');
        const at = lines.findIndex((l) => l.startsWith(head));
        assert.ok(at > -1, `${name}: ${head}`);
        assert.ok(lines[at].length < 120, `${name}: the step head stands alone`);
        const out = [];
        for (let i = at + 1; /^ {3}- /.test(lines[i] || ''); i++) out.push(lines[i]);
        return out;
    };
    assert.strictEqual(subs('task-verify-plan', '1. **Risk coverage - the highest-leverage pass.**').length, 7);
    assert.strictEqual(subs('task-verify-code', '4. **Run it, and check nothing existing broke.**').length, 7);
});

test('SKF-21: task-implement marks its EF Core lines as the .NET example', () =>
{
    const t = flat(skill('task-implement'));
    assert.match(t, /\(the \.NET example: EF Core's `PendingModelChangesWarning`\)/);
    assert.match(t, /The \.NET example, an EF Core migration: `dotnet ef migrations add/);
});

test('SKF-22: the diagnoser\'s CI-seat offer dispatches the seat as the roster spells it', () =>
{
    assert.match(flat(skill('issue-diagnoser')), /offer that dispatch as the recommended option at this stop rather than re-deriving it here, the seat dispatched exactly as the roster spells it/);
});

test('SKF-23: no dated or opaque token in the code loop example or the scorer revise step', () =>
{
    assert.doesNotMatch(skill('loop-code-quality'), /1\.x starter/);
    const scorer = flat(skill('mode-output-scorer'));
    assert.doesNotMatch(scorer, /says why \(P11\)/);
    assert.match(scorer, /\(the designer-plan rubric's scope item, P11\)/);
});

test('SKF-24: no skill names a shipped rule by its retired baseline name', () =>
{
    const dir = path.join(ROOT, 'stack/skills');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []);
    for (const f of walk(dir))
        assert.doesNotMatch(flat(fs.readFileSync(f, 'utf8')), /\b(interaction|quality-gates|security|navigation|preferences|docs-root) baseline\b/, path.relative(ROOT, f));
});

test('SKC-02: a lone architecture-quality run reads the state block its lighter path keys on', () =>
{
    const one = flat(section(skill('capture-quality'), '2\\. One part'));
    assert.match(one, /architecture-quality: read `references\/architecture-quality\.md` and follow it\. Alone, it runs section 3 step 1's state block first/);
    assert.match(flat(read('stack/skills/capture-quality/references/architecture-quality.md')), /when the state script \(capture-quality's chain block\) reports `architecture-quality: current`/);
});

test('SKC-03: capture-quality no longer promises the conversational code-quality route', () =>
{
    const t = flat(skill('capture-quality'));
    assert.doesNotMatch(t, /description match on 'how good is this code\?'/);
    assert.doesNotMatch(t, /'is this code any good\?' - can match|'is this code any good\?', 'what is our coverage\?'/);
    assert.match(t, /A bare 'is this code any good\?' measured no load \(0 of 10\)/);
    assert.doesNotMatch(flat(read('stack/skills/capture-quality/references/code-quality.md')), /'is this code any good\?' can match this skill/);
});

// SKC-04 + SKC-05: every reference a part reads at load time is named under its part line in the router, so a write
// contract is one hop from the SKILL.md, never two.
const PART_REFS = {
    'capture-awareness': ['project-code-style-doc-shape', 'architecture-doc-shapes', 'architecture-hazards', 'architecture-vocabulary-roles', 'architecture-report-fields'],
    'capture-quality': ['architecture-quality-doc-shape', 'code-quality-doc-shape', 'test-coverage-quality-weak-points'],
};
test('SKC-04/05: the capture routers name each part\'s load-time references', () =>
{
    for (const [name, refs] of Object.entries(PART_REFS))
    {
        const one = section(skill(name), '2\\. One part');
        for (const r of refs)
        {
            assert.ok(fs.existsSync(path.join(ROOT, `stack/skills/${name}/references/${r}.md`)), `${name}/${r}.md exists`);
            assert.match(one, new RegExp(`^  - \`references/${r}\\.md\` - .+, read (before|at) [A-Z]+\\.$`, 'm'), `${name}: ${r} under its part line`);
        }
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'stack/skills/capture-quality/references/test-coverage-quality-doc-shape.md')), 'the 5-line coverage doc shape is folded into its part');
    const step5 = flat(section(read('stack/skills/capture-quality/references/test-coverage-quality.md').replace(/^### /gm, '## '), '5\\. WRITE - reconcile both artifacts'));
    assert.match(step5, /a first-line stamp `Captured: <branch>@<short-sha>, <YYYY-MM-DD>`/);
    assert.match(step5, /Put a `## Resume` section right under the stamp/);
    assert.match(step5, /never a per-claim edit stream/);
});
