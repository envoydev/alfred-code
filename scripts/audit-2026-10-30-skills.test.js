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

test('SKC-06: a capture part reached only through its router carries no second Modes paragraph', () =>
{
    const parts = ['capture-awareness/references/architecture.md', 'capture-awareness/references/project-code-style.md',
        'capture-quality/references/architecture-quality.md', 'capture-quality/references/code-quality.md', 'capture-quality/references/test-coverage-quality.md'];
    const sites = [registry()['auto-mode-contract'].owner, ...registry()['auto-mode-contract'].sites].map((c) => c.file);
    for (const p of parts)
    {
        assert.doesNotMatch(read(`stack/skills/${p}`), /\*\*Modes\.\*\*/, p);
        assert.ok(!sites.includes(`stack/skills/${p}`), `${p}: off the auto-mode-contract sites`);
    }
    for (const router of ['capture-awareness', 'capture-quality']) assert.match(skill(router), /^\*\*Modes\.\*\* Mode flags right after the command/m, `${router} keeps it`);
});

test('SKC-07/08: the usage report names no dead six-seat limit and keeps headroom under its 19,000 cap', () =>
{
    const raw = skill('capture-usage-report');
    assert.doesNotMatch(raw, /at most six at a time/);
    assert.ok(raw.length <= 18700, `the body sits ${raw.length} chars, under 18,700`);
    assert.match(flat(read('stack/skills/capture-usage-report/references/diagnosis-discipline.md')), /The rows only you know, appended after the machine sections: OS, project stack\(s\), analyzer snapshot revision/);
});

test('SKC-09/10/11: no navigation server, the exclusion clause conditional, the instruction file named either way', () =>
{
    assert.doesNotMatch(flat(skill('habits-adjust-agents-md')), /navigation server/);
    assert.match(flat(skill('habits-adjust-agents-md')), /the navigation tools' symbol lookup, `LSP` `workspaceSymbol`/);
    const agents = flat(read('stack/skills/capture-awareness/references/agents.md'));
    assert.doesNotMatch(agents, /stay excluded \(`--exclude-tools`\)/);
    assert.match(agents, /are excluded where the registration passes `--exclude-tools` \(the add-back line does\)/);
    for (const name of ['habits-done-gate', 'habits-commit-checkpoint', 'capture-preferences'])
    {
        const t = flat(skill(name));
        assert.match(t, /instruction file \(`?AGENTS\.md`? or `?CLAUDE\.md`?\)/, name);
        assert.doesNotMatch(t, /this project's AGENTS\.md records|named in the project's `AGENTS\.md`\.|and the project's AGENTS\.md\./, name);
    }
});

test('SKC-14: the three habit stops are ask templates, the recommended option first', () =>
{
    const { lintAskTemplates } = require('./lint-skills.js');
    for (const [name, first] of [['habits-root-cause', 'Redesign <the part> (Recommended)'], ['habits-execution-strategy', 'Run the trimmed plan (Recommended)'],
        ['dev-log-convert', '<the shape the latest correction implies> (Recommended)']])
    {
        const text = skill(name);
        assert.ok(text.includes(`- '${first}' - `), `${name}: ${first}`);
        assert.deepStrictEqual(lintAskTemplates([{ file: name, text }]), [], `${name}: lint 61 holds`);
    }
});

test('SKC-15: the preferences write paragraph is split into bullets', () =>
{
    const lines = skill('capture-preferences').split('\n');
    const at = lines.findIndex((l) => l.startsWith('Write each touched doc whole:'));
    assert.ok(at > -1 && lines[at].length < 700, 'the lead stands alone');
    for (const [i, lead] of [[2, '- The personal code and architecture docs have no size cap'], [3, '- A `note:` that a `Scope:` glob reaches no file'], [4, '- Then `<script> reach --id <id>`']])
        assert.ok(lines[at + i].startsWith(lead), lead);
});

test('SKC-16: explain-topic\'s closing checklist sits inside the re-attach window', () =>
{
    inside('habits-explain-topic', '- [ ] The length is in proportion to the question');
    inside('habits-explain-topic', 'line is in context, the FIRST action before releasing the answer');
});

test('SKC-18: the Mermaid color rule matches the vendor page - box takes a name, neither takes hex', () =>
{
    const t = flat(skill('docs-as-code'));
    assert.match(t, /A `rect` region takes rgb\(\)\/rgba\(\); a `box` a color name, rgb\(\)\/rgba\(\) or hsl\(\)\/hsla\(\) - never hex in either/);
    assert.doesNotMatch(flat(read('stack/skills/docs-as-code/references/mermaid-sequence.md')), /rgb\(\) only|rgb\(\) not hex in rect\/box/);
});

test('SKC-19: where the format check comes from is one registered text in both gates', () =>
{
    const entry = registry()['format-check-source'];
    assert.ok(entry, 'registered');
    assert.deepStrictEqual([entry.owner, ...entry.sites].map((c) => c.file).sort(), ['stack/skills/habits-commit-checkpoint/SKILL.md', 'stack/skills/habits-done-gate/SKILL.md']);
    for (const c of [entry.owner, ...entry.sites]) assert.ok(read(c.file).includes(c.marker), c.file);
});

test('SKC-20/21/23: no callee names its callers, no step cited by number, no bare fence', () =>
{
    assert.doesNotMatch(flat(section(skill('capture-quality'), '4\\. Callers')), /loop-/);
    assert.doesNotMatch(flat(section(skill('capture-awareness'), '4\\. Callers')), /loop-/);
    assert.match(flat(section(skill('capture-quality'), '4\\. Callers')), /A calling flow hands `<topic> <DELEGATED\|INLINE> <target>`/);
    assert.doesNotMatch(skill('habits-test-first'), /`habits-root-cause`, step \d/);
    assert.match(skill('habits-test-first'), /its 'Fix at the root, test first' step/);
    assert.match(skill('habits-root-cause'), /\*\*Fix at the root, test first\.\*\*/, 'the named step exists');
    assert.doesNotMatch(skill('dev-log-convert'), /^ {2}```\n {2}git status --short/m);
});

test('RU-01: the imported usage policy recommends a fresh session only where a hook says it pays back', () =>
{
    const t = flat(read('stack/skills/capture-awareness/references/agents.md'));
    assert.doesNotMatch(t, /\(fresh session recommended\)/);
    assert.match(t, /may be offered a fresh session when this one already carries another run's history; recommend it only where a hook's fresh-session text in this session says it pays back/);
    assert.match(flat(skill('task-solve')), /Mark the fresh option only when a hook's fresh-session text in this session says a fresh session pays back/, 'the flow it now agrees with');
});

// RU-17: the copy target's fixed sentence named the map even when no map exists; the clause now rides the script's map
// line, which the rule carries only when the map does, and lint 33 measures the line in place of its slot.
test('RU-17: the map clause is written only with the map, and the always-on measure counts the line, not its slot', () =>
{
    const os = require('node:os');
    const aw = require('../stack/skills/capture-awareness/scripts/awareness-state.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ru17-'));
    try
    {
        const dir = path.join(tmp, '.alfred', 'docs', 'awareness');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'AGENTS-AWARENESS.md'), '# This project\'s capabilities\n');
        const none = aw.composeAwarenessRule({ projectRoot: tmp, docs: '.alfred/docs' });
        assert.ok(none.text && !none.mapLine, 'a rule with imports and no map');
        assert.doesNotMatch(none.text, /architecture map/i, 'no map, no word of one');
        fs.writeFileSync(path.join(dir, 'ARCHITECTURE-AWARENESS.md'), '# Map\n');
        const withMap = aw.composeAwarenessRule({ projectRoot: tmp, docs: '.alfred/docs' });
        assert.match(withMap.text, /^Architecture map: `\.alfred\/docs\/awareness\/ARCHITECTURE-AWARENESS\.md` - only pointed at, never imported: read it by section before a structural change\.$/m);
    }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    const { awarenessRuleText } = require('./always-on-surface.js');
    const measured = awarenessRuleText(skill('capture-awareness'));
    assert.doesNotMatch(measured, /<the script's/, 'no slot placeholder is counted');
    assert.ok(measured.includes(aw.MAP_LINE), 'the map line is counted in its slot');
});

// HK-16 (the plan's contract for every track): a skill that restates a receipt says to write the lines the guard's
// denial prints - its `session:` line included - never a receipt shape copied from the skill.
test('HK-16: the desktop server rows send the receipt to the denial\'s own lines', () =>
{
    const t = flat(read('stack/skills/capture-awareness/references/agents.md'));
    assert.doesNotMatch(t, /DESKTOP-EXEC-ALLOW/, 'no receipt path to write from memory');
    assert.strictEqual(t.split('until the user allows it - write the lines the denial prints, never a receipt from memory').length - 1, 2, 'both desktop rows');
});

test('SKC-24: the four rule-forced or preloaded habits leave the / menu and keep their description', () =>
{
    const html = read('docs/alfred-code.html');
    for (const name of ['habits-code-comments', 'habits-done-gate', 'habits-root-cause', 'habits-test-first'])
    {
        const front = /^---\n([\s\S]*?)\n---/.exec(skill(name))[1];
        assert.match(front, /^user-invocable: false$/m, `${name}: user-invocable false`);
        assert.doesNotMatch(front, /^disable-model-invocation:/m, `${name}: its description stays in context`);
        assert.match(html, new RegExp(`\\["${name}",[^\\n]*"model-only"\\]`), `${name}: the inventory row says model-only`);
    }
});

// Audit 2026-10-30, the hooks report's low row (T1 ac7ea27f): the commit guard now gates opening a change request from a
// CLI where it would push, so the checkpoint's Publishing section names that act beside the push and the merge.
test('hooks low row: the checkpoint names opening a change request that pushes as a publish', () =>
{
    const publishing = skill('habits-commit-checkpoint').replace(/\s+/g, ' ').split('## Publishing')[1].split('**A no-fast-forward publish')[0];
    assert.match(publishing, /`gh pr create`/);
    assert.match(publishing, /`glab mr create`/);
    assert.match(publishing, /would push/);
});

// Audit 2026-10-30 HK-20, its skill site (T2's leftover): no server receives the store since 2.10.1, so the run book's
// template teaches no key name typed into a browser form - the session-start line dropped the same sentence.
test('HK-20 skill site: the run-book template types no key name into a browser', () =>
{
    const reach = section(read('stack/skills/capture-awareness/references/project.md'), 'Reach and log in');
    assert.ok(reach, 'the Reach and log in section');
    assert.doesNotMatch(reach, /browser_type|browser_fill_form|--secrets|<secret>/, 'the browser KEY route');
    assert.match(flat(reach), /Credentials live in: .* - checked for presence, never printed/, 'the credentials line stays');
});
