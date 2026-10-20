'use strict';
// The stack audit of 2026-10-20, agents track: what the seat bodies, their orchestrators' protocol docs and the data
// stack's detection now say. Each test names the audit row it holds, so a regression reads as the row it reopens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const AGENTS = path.join(ROOT, 'stack', 'agents');
const squash = (s) => s.replace(/\s+/g, ' ');
const seats = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const read = (seat) => fs.readFileSync(path.join(AGENTS, `${seat}.md`), 'utf8');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const split = (text) =>
{
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    return { meta: yaml.load(m[1]), body: m[2] };
};
const meta = (seat) => split(read(seat)).meta;
const body = (seat) => split(read(seat)).body;
const rules = () => JSON.parse(readRel('meta/shared-rules.json')).rules;
const copiesOf = (id) => { const r = rules()[id]; return [r.owner, ...(r.sites || [])]; };
const listedIn = (id) => new Set(copiesOf(id).map((c) => c.file));
const section = (text, heading) =>
{
    const at = text.indexOf(`\n## ${heading}`);
    if (at < 0) return '';
    const rest = text.slice(at + 1);
    const next = rest.indexOf('\n## ', 3);
    return next < 0 ? rest : rest.slice(0, next);
};
const of = (suffix) => seats.filter((s) => s.endsWith(suffix));

// --- A7 (the user's ruling: the data trio is .NET / EF Core only) ----------------------------------------------------------
// The data seats preview `dotnet ef` scripts and gate on `__EFMigrationsHistory`, but init detected `data` from any
// `*.sql`, so a Flyway or Prisma repo got a trio that could only report BLOCKED_BY_BUILD. Detection now asks for EF
// Core, every data seat says so, and `dotnet-migrate` - which data-implementer names on demand - is seeded with the
// stack instead of arriving only through the designer's and verifier's preloads.
test('A7: data is detected from EF Core alone, the trio says .NET / EF Core, dotnet-migrate is seeded', () =>
{
    const init = squash(readRel('setup-plugin/references/init-install.md'));
    assert.doesNotMatch(init, /`\*\.sql` \/ a migrations folder -> `data`/, 'init: *.sql alone no longer detects data');
    assert.ok(init.includes('a `.csproj` referencing `Microsoft.EntityFrameworkCore.*`, or a `Migrations/` folder holding a `*ModelSnapshot.cs` beside a `.csproj` -> `data`'), 'init: the EF Core signal');
    assert.match(init, /`\*\.sql` files or a migrations folder alone \(Flyway, Liquibase, Prisma, a Node or Python ORM\) are NOT `data`/, 'init: the pure-SQL case is named');
    for (const s of ['data-solution-designer', 'data-implementer', 'data-verifier'])
        assert.match(meta(s).description, /\.NET \/ EF Core/, `${s}: the description names .NET / EF Core`);
    const recs = JSON.parse(readRel('meta/recommendations.json'));
    assert.ok(recs.stacks.data.skills.includes('dotnet-migrate'), 'stacks.data seeds dotnet-migrate');
    assert.ok(squash(read('data-implementer')).includes('load `dotnet-migrate`'), 'the cite it backs');
});

// --- agents #2: the WPF seats no longer call the toolkit generators unavailable on net48 ------------------------------
// The preloaded dotnet-wpf reference says the generators run on net48 under three conditions (PackageReference, C# 8+,
// the .NET 6+ SDK) with a netstandard2.0 view-model library as the fallback; the seats said the opposite.
test('agents #2: the WPF seats point at the net48 reference instead of contradicting it', () =>
{
    for (const s of ['wpf-implementer', 'wpf-verifier'])
    {
        const text = squash(read(s));
        assert.doesNotMatch(text, /generators (are )?unavailable/, `${s}: the stale net48 claim`);
        assert.ok(text.includes("`dotnet-wpf`'s `references/net-framework-48.md`"), `${s}: the pointer`);
        assert.ok(meta(s).skills.includes('dotnet-wpf'), `${s}: the reference's skill is preloaded`);
    }
    const ref = squash(readRel('stack/skills/dotnet-wpf/references/net-framework-48.md'));
    assert.match(ref, /PackageReference, not packages\.config/);
    assert.match(ref, /\.NET Standard 2\.0 class library/);
});

// --- agents #3 (C3-C6): one shape per seat return, the seat's Report its home and the protocol docs its read --------------
const report = (s) => squash(section(body(s), 'Report'));
const lastIndex = (text, needle) => text.lastIndexOf(needle);
test('agents #3 C3: every designer Report names the four card stamps and a user_decisions line before its closing lines', () =>
{
    const designers = of('-solution-designer');
    assert.strictEqual(designers.length, 10);
    for (const s of designers)
    {
        const r = report(s);
        for (const stamp of ['`implementer_model`', '`anchors`', 'acceptance', '`log_points`']) assert.ok(r.includes(stamp), `${s}: ${stamp}`);
        assert.ok(r.indexOf('a literal `user_decisions:` line') >= 0 && r.indexOf('a literal `user_decisions:` line') < r.indexOf('Close with a literal `status:` line'), `${s}: user_decisions before the close`);
    }
    assert.deepStrictEqual([...listedIn('designer-card-stamps')].sort(), designers.map((s) => `stack/agents/${s}.md`).sort());
    const protocol = squash(readRel('stack/skills/task-solve-cross/references/agent-output-protocol.md'));
    for (const key of ['Oriented:', 'user_decisions:', 'status: PLAN_READY | NEEDS_CONTEXT | BLOCKED_CONTRACT_CHANGE', 'contract_version:'])
        assert.ok(protocol.includes(key), `protocol designer shape: ${key}`);
    assert.doesNotMatch(protocol, /verification_notes:|forbidden_changes: \[\]\s+implementer_model: haiku \| sonnet\s+# designer-assigned by task difficulty; sonnet floors any risk trigger\s+verification_notes/, 'the old designer YAML');
    const trio = squash(readRel('stack/skills/task-solve-cross/references/domain-trio-protocol.md'));
    assert.ok(trio.includes("A `user_decisions:` line other than `none` is the user's call"), 'the trio protocol routes user_decisions to the plan-review ask');
});

test('agents #3 C4: the implementer schema is what the seats emit - no field without a producer', () =>
{
    const protocol = squash(readRel('stack/skills/task-solve-cross/references/agent-output-protocol.md'));
    for (const gone of ['regression_proof', 'files_changed', 'validation_performed', 'next_recommended_action', 'checks_performed', 'signoff:'])
        assert.ok(!protocol.includes(gone), `protocol still names ${gone}`);
    for (const key of ['checked prior notes:', 'decisions:', 'ceilings:', 'status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | BLOCKED_CONTRACT_CHANGE'])
        assert.ok(protocol.includes(key), `protocol implementer shape: ${key}`);
    for (const s of of('-implementer'))
    {
        const text = squash(read(s));
        for (const key of ['checked prior notes:', '`decisions:`', '`ceilings:`']) assert.ok(text.includes(key), `${s} emits ${key}`);
    }
});

test('agents #3 C5: both diagnosers close on literal route / confidence / affected_domains lines before status, pinned', () =>
{
    const routes = ['no_fix_needed', 'resolver', 'single_domain_implementer', 'cross_domain_contract_change', 'user_decision_needed'];
    const inv = squash(readRel('stack/skills/task-solve-cross/references/issue-investigation.md'));
    for (const s of ['issue-diagnoser-ci', 'issue-diagnoser-runtime'])
    {
        const r = report(s);
        for (const k of ['`route:`', '`confidence:`', '`affected_domains:`']) assert.ok(r.includes(k), `${s}: ${k}`);
        for (const v of routes) assert.ok(r.includes(`\`${v}\``), `${s}: route ${v}`);
        assert.ok(r.indexOf('`route:`') < lastIndex(r, 'Close with a literal `status:` line'), `${s}: the keys come before status`);
        assert.ok(inv.includes(`route: ${routes[0]}`), 'the investigation YAML vocabulary');
    }
    assert.ok(inv.includes('closes on four literal lines - `route:`'), 'the investigation doc reads the seat shape');
    assert.strictEqual(listedIn('diagnoser-routing-keys').size, 3);
});

test('agents #3 C6: the plan-audit brief carries the passes and the eight fields, and the verifier returns them', () =>
{
    const tvp = squash(readRel('stack/skills/task-verify-plan/SKILL.md'));
    assert.ok(tvp.includes('the brief carries both: the five passes and the eight-field block'), 'task-verify-plan: the brief carries the Output');
    for (const s of of('-verifier'))
        assert.ok(squash(read(s)).includes("return the output fields the brief names (a plan audit's eight, `Passes:` among them) above the closing lines"), `${s}: returns the fields`);
});

// --- agents #8 (C7): the designer seat has no ask, so task-design's two asks become report fields there -------------------
test('agents #8 C7: task-design turns its asks into NEEDS_CONTEXT / user_decisions inside a seat, and its behaviour-change ask is a template', () =>
{
    const td = readRel('stack/skills/task-design/SKILL.md');
    const flat = squash(td);
    assert.ok(flat.includes('A seat holds no AskUserQuestion, so each ask below is a report field there'), 'the seat carve-out');
    assert.ok(flat.includes('Inside a designer seat, load nothing here: an ambiguous brief returns NEEDS_CONTEXT'), 'step 0 in a seat');
    assert.ok(flat.includes('inside a designer seat it is a `user_decisions:` row, `asked: pending`'), 'the behaviour change in a seat');
    const asks = [...td.matchAll(/```ask\n([\s\S]*?)```/g)].map((m) => m[1]);
    assert.ok(asks.some((a) => /behaviour change/.test(a) && /\(Recommended\)/.test(a)), 'the behaviour-change ask template');
    const tvp = readRel('stack/skills/task-verify-plan/SKILL.md');
    assert.strictEqual([...tvp.matchAll(/```ask\n/g)].length, 2, 'task-verify-plan: the mode ask and the judgment ask');
    assert.doesNotMatch(squash(tvp), /through its own AskUserQuestion instead of folding/, 'the prose stop is a template now');
});

// --- agents #6: every seat that stores a hand-off note writes it BEFORE the report, pinned ---------------------------------
test('agents #6: the implementers, resolvers and integration reviewer write memory before the report, pinned', () =>
{
    const writers = seats.filter((s) => /memory_store/.test(read(s)));
    const pinned = listedIn('verifier-memory-before-report');
    for (const s of [...of('-implementer'), ...of('-resolver'), 'integration-reviewer'])
    {
        assert.ok(writers.includes(s), `${s}: stores a note`);
        assert.ok(pinned.has(`stack/agents/${s}.md`), `${s}: a copy of verifier-memory-before-report`);
        const r = report(s);
        assert.ok(r.includes('Memory writes come BEFORE the report'), `${s}: the ordering sits in its Report`);
    }
    assert.strictEqual(pinned.size, 28);
});

// --- A-T1 prose half: a verifier runs no tree-wide git state command, pinned (the hooks track enforces it) -----------------
test('A-T1: every verifier carries the git-state ban beside its Bash line, pinned', () =>
{
    const verifiers = of('-verifier');
    for (const s of verifiers)
    {
        const lines = section(body(s), 'Conventions').split('\n');
        const bash = lines.findIndex((l) => l.startsWith('- Bash '));
        assert.ok(bash >= 0, `${s}: its Bash line`);
        assert.match(lines[bash + 1], /^- No tree-wide git state command - `git reset`, `git restore --staged`, `git checkout --`, `git stash`, `git add`, `git commit`/, `${s}: the ban follows it`);
    }
    assert.deepStrictEqual([...listedIn('verifier-no-git-state')].sort(), verifiers.map((s) => `stack/agents/${s}.md`).sort());
});

// --- agents #12: a colliding description names the sibling that wins, never 'another stack' ------------------------------
test('agents #12: the colliding descriptions name the winning sibling, and ng-build-error-resolver hands off red specs and red CI', () =>
{
    const d = (s) => meta(s).description;
    const names = {
        'console-implementer': 'windows-service-implementer', 'windows-service-implementer': 'console-implementer',
        'windows-service-solution-designer': 'console-solution-designer',
        'ionic-angular-implementer': 'web-angular-implementer', 'ionic-angular-solution-designer': 'web-angular-solution-designer',
        'wpf-implementer': 'windows-service-implementer', 'wpf-solution-designer': 'winforms-solution-designer',
        'winforms-implementer': 'wpf-implementer', 'winforms-solution-designer': 'wpf-solution-designer',
        'browser-extension-implementer': 'web-angular-implementer', 'browser-extension-verifier': 'web-angular-verifier',
        'ng-build-error-resolver': 'angular-test-resolver',
    };
    for (const [s, sibling] of Object.entries(names)) assert.ok(d(s).includes(`(${sibling})`), `${s} names ${sibling}`);
    assert.ok(d('ng-build-error-resolver').includes('red CI (issue-diagnoser-ci)'), 'red CI goes to the CI diagnoser');
    for (const s of Object.keys(names)) assert.doesNotMatch(d(s), /another (C# |TypeScript )?stack/, `${s}: a vague not-for`);
    for (const s of seats) assert.ok(d(s).length <= 300, `${s}: ${d(s).length}`);
});

// --- agents #13: the desktop designers' companion-service paragraph is one registered text --------------------------------
test('agents #13: the WPF and WinForms designers carry the companion-service paragraph as a pinned pair', () =>
{
    assert.deepStrictEqual([...listedIn('desktop-designer-companion-service')].sort(), ['stack/agents/winforms-solution-designer.md', 'stack/agents/wpf-solution-designer.md']);
    for (const c of copiesOf('desktop-designer-companion-service')) assert.ok(squash(readRel(c.file)).includes(squash(c.marker)), c.file);
});

// --- agents #14: the small items -------------------------------------------------------------------------------------------
test('agents #14: AppHost only where one exists, left_running on every verifier, no Bash doc fetch, no pinned Angular versions', () =>
{
    const devops = squash(read('devops-verifier'));
    assert.doesNotMatch(devops, /dotnet build the AppHost[,;]/, 'devops-verifier: an unconditional AppHost build');
    assert.ok(devops.includes('dotnet build the Aspire AppHost when the project has one'), 'devops-verifier: the condition');
    for (const s of of('-verifier')) assert.ok(squash(read(s)).includes('a literal `left_running:` line'), `${s}: left_running`);
    assert.strictEqual(listedIn('verifier-left-running-line').size, 11);
    assert.doesNotMatch(squash(read('console-solution-designer')), /fetching vendor docs to scratch/);
    const ng = squash(read('web-angular-solution-designer'));
    for (const pin of ['500 KB initial budget', 'stable v20.2, default v21', 'Signal Forms (form()) on v21+']) assert.ok(!ng.includes(pin), `web-angular designer pins '${pin}'`);
});

test('agents #14: the reviewer names its security categories, code-style has one first step, the auditor masks once', () =>
{
    const reviewer = squash(read('integration-reviewer'));
    assert.doesNotMatch(reviewer, /apply the security checklist/);
    assert.ok(reviewer.includes('auth, secrets, injection, data-access'), 'the categories the security row names');
    const style = squash(read('code-style-analyzer'));
    assert.doesNotMatch(style, /FIRST tool call of your run/, 'code-style: a second competing first');
    assert.ok(style.includes('One order per run: the Glob of your scope'), 'code-style: one order');
    const auditor = squash(read('security-auditor'));
    assert.strictEqual((auditor.match(/actual secret/g) || []).length, 1, 'security-auditor: the masking rule said once');
    assert.ok(auditor.includes("the security rule's Credentials section"), 'pointing at its home');
});

// --- agents #5: per-dispatch effort exists on the Agent tool; routing never sets it, only the user's ask does ----------------
test('agents #5: model-routing says the Agent tool takes effort and the house sets it only on the user\'s ask', () =>
{
    const mr = squash(readRel('stack/skills/task-solve-cross/references/model-routing.md'));
    assert.doesNotMatch(mr, /not re-tunable per call|the seat cannot receive/, 'the drifted claim');
    assert.ok(mr.includes("The Agent tool does take a per-dispatch `effort` argument, but the house sets it only on the user's explicit ask"), 'the current fact and the house use');
});

module.exports = { seats, read, readRel, meta, body, section, squash, rules, copiesOf, listedIn, of };
