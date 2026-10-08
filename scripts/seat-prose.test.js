'use strict';
// The 2.1.5 audit's agents package (merged.md M47-M58, M60): what the seat bodies claim, the shape every
// seat keeps, and the shared-rules pins that hold a multi-home sentence in step. Each test names the
// finding it holds, so a regression reads as the audit line it reopens.
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
// The section a heading opens, up to the next `## ` heading.
const section = (text, heading) =>
{
    const at = text.indexOf(`\n## ${heading}`);
    if (at < 0) return '';
    const rest = text.slice(at + 1);
    const next = rest.indexOf('\n## ', 3);
    return next < 0 ? rest : rest.slice(0, next);
};

// --- M47: a verifier that runs the built app bounds the run and says what is left up ----------------
// windows-service-verifier bounds its console run and reports it on a `left_running:` line; console- and
// aspnet-verifier started the same kind of process with neither, so the close's tear-down ask never heard
// of it.
test('M47: every verifier whose Checks run the built app bounds the run and reports left_running, pinned', () =>
{
    const runners = seats.filter((s) => s.endsWith('-verifier') && /RUN the (built|app)|boot attempt/.test(section(body(s), 'Checks')));
    for (const seat of ['console-verifier', 'aspnet-verifier', 'windows-service-verifier', 'wpf-verifier', 'winforms-verifier'])
        assert.ok(runners.includes(seat), `${seat}: its Checks run the app`);
    const pinned = listedIn('verifier-left-running-line');
    for (const seat of runners)
    {
        const text = squash(read(seat));
        assert.match(text, /wall-clock timeout/, `${seat}: the run is bounded by a wall-clock timeout`);
        assert.match(text, /stop(ped)? (it )?before the report/, `${seat}: and stopped before the report`);
        assert.ok(text.includes('a literal `left_running:` line'), `${seat}: the left_running footer line`);
        assert.ok(pinned.has(`stack/agents/${seat}.md`), `${seat}: a copy of verifier-left-running-line`);
    }
});

// --- M48 lives in guard-hooks.test.js (the dispatch guard pins a diagnoser to the evidence gatherer) ---

// --- M49: the three opus pins outside the designers carry their reason where the other pins do -------
test('M49: every opus pin outside the designers is named, with its effort and reason, in the house-pins paragraph', () =>
{
    const routing = squash(readRel('stack/skills/task-solve-cross/references/model-routing.md'));
    const para = routing.slice(routing.indexOf('The house pins land'), routing.indexOf('One caveat on the Escalate-when column'));
    assert.ok(para.length > 0, 'the house-pins paragraph');
    const opus = seats.filter((s) => meta(s).model === 'opus' && !s.endsWith('-solution-designer'));
    assert.deepStrictEqual(opus, ['issue-diagnoser-ci', 'issue-diagnoser-runtime', 'security-auditor']);
    for (const seat of opus)
        assert.match(para, new RegExp(`\\b${seat} opus/${meta(seat).effort} \\(`), `${seat}: its pin and a parenthesised reason`);
    assert.match(para, /no A\/B against a sonnet pin/, 'the paragraph says the pins are unmeasured against the repo goal');
    const pins = squash(require('./claude-docs.js').readClaudeDocs()).match(/Pins: [^.]*\./);
    assert.ok(pins, 'the CLAUDE.md pins sentence');
    for (const seat of opus) assert.ok(pins[0].includes(seat), `CLAUDE.md's pins sentence names ${seat}`);
});

// --- M50: integration-reviewer cites the security-half claim to the skill that makes it ---------------
test('M50: integration-reviewer attributes the security-half pass to the commit checkpoint, not the security rule', () =>
{
    const text = squash(body('integration-reviewer'));
    assert.doesNotMatch(text, /alfred-security\.md` treats this gate's pass/, 'the security rule makes no such claim');
    assert.ok(text.includes("the commit checkpoint's security half counts this gate's pass as its review"), 'described by what it covers');
    const skill = squash(readRel('stack/skills/habits-commit-checkpoint/SKILL.md'));
    assert.ok(skill.includes('the integration-reviewer gate does'), 'the claim\'s home still makes it');
    const rule = squash(readRel('stack/rules/alfred-security.md'));
    assert.doesNotMatch(rule, /integration-reviewer/, 'and the rule still does not');
});

// --- M51: security-auditor's rubric carve-out names only what the seat has ---------------------------
test('M51: security-auditor skips on a rubric dispatch only what its Method holds', () =>
{
    const line = squash(body('security-auditor')).match(/When dispatched by the `loop-quality` skill[^\n]*?never to rubric audits\./);
    assert.ok(line, 'the rubric carve-out');
    assert.doesNotMatch(line[0], /plan\/contract diff|build\+test rerun/, 'a Method with no plan diff and no rerun skips neither');
    assert.ok(line[0].includes('the memory handoff WRITE unless the dispatch brief asks for it'), 'the registered clause stays');
    assert.ok(line[0].includes("the loop's keyed shape"), 'the keyed shape stays');
    const method = squash(section(body('security-auditor'), 'Method (bounded)'));
    assert.doesNotMatch(method, /contract diff|rerun the build|build\+test/, 'still true of the Method');
});

// --- M52: the design bar points at a file that exists; the extension seat keeps its own bar ------------
test('M52: web-angular-implementer loads the design-quality reference, the extension seat its own UI rules', () =>
{
    const web = squash(body('web-angular-implementer'));
    assert.doesNotMatch(web, /Design quality section/, 'angular-conventions has no such section');
    assert.ok(web.includes('load `references/design-quality.md` of the preloaded `angular-conventions`'), 'the reference its SKILL.md names');
    assert.ok(fs.existsSync(path.join(ROOT, 'stack', 'skills', 'angular-conventions', 'references', 'design-quality.md')));
    assert.ok(squash(readRel('stack/skills/angular-conventions/SKILL.md')).includes('load `references/design-quality.md`'), 'the skill points at it too');
    const ext = squash(body('browser-extension-implementer'));
    assert.doesNotMatch(ext, /Angular conventions|design-quality/, 'no cross-stack pointer from the extension seat');
    assert.ok(ext.includes("the preloaded `browser-extension` skill's 'Tooling and UI' rules are the bar"), 'its own bar');
    assert.match(readRel('stack/skills/browser-extension/SKILL.md'), /^## Tooling and UI$/m, 'the section it names exists');
});

// --- M53: devops-implementer preloads no test-first skill its loop never runs --------------------------
test('M53: devops-implementer drops the test-first preload and describes the skill for a scripted task', () =>
{
    const skills = meta('devops-implementer').skills || [];
    assert.ok(!skills.includes('habits-test-first'), 'a config-only loop that never writes a test');
    assert.ok(skills.includes('habits-done-gate'), 'the done gate stays');
    const text = squash(body('devops-implementer'));
    assert.match(text, /the always-on rule's test-first Skill call/, 'the rare script task still reaches the method');
    assert.match(text, /`test: none`/, 'and a config task records the honest line');
    // review-215-agents MINOR 1: the line the Conventions ask for needs a slot in the report, or it is never returned
    assert.match(squash(section(body('devops-implementer'), 'Report')), /a literal `test:` line/, 'the Report carries the test line');
});

// --- M54: a registered sentence copied into a seat is a pinned copy ------------------------------------
// A copy the registry does not list is a copy no lint holds in step: edit the owner and it silently drifts.
// `trio-note-naming-grammar-restated` pins a naming GRAMMAR, not a sentence - every seat spells it inside
// its own `memory-handoff-mechanism` copy, which is pinned there.
const GRAMMAR_ONLY = new Set(['trio-note-naming-grammar-restated']);
test('M54: every seat carrying a registered marker is a listed copy of that entry', () =>
{
    const unlisted = [];
    for (const [id, rule] of Object.entries(rules()))
    {
        if (GRAMMAR_ONLY.has(id) || !rule.owner) continue;
        const copies = copiesOf(id);
        const listed = new Set(copies.map((c) => c.file));
        const markers = [...new Set(copies.map((c) => squash(c.marker)))];
        for (const seat of seats)
        {
            const file = `stack/agents/${seat}.md`;
            if (listed.has(file)) continue;
            const text = squash(read(seat));
            if (markers.some((m) => text.includes(m))) unlisted.push(`${id}: ${file}`);
        }
    }
    assert.deepStrictEqual(unlisted, []);
});

test('M54: the ten implementers are copies of the findings-plan carve-out, code-quality-analyzer of the report bound', () =>
{
    const implementers = seats.filter((s) => s.endsWith('-implementer'));
    assert.strictEqual(implementers.length, 10);
    const carve = listedIn('implementer-findings-plan-carve-out');
    for (const seat of implementers) assert.ok(carve.has(`stack/agents/${seat}.md`), `${seat}: a pinned carve-out copy`);
    assert.ok(listedIn('seat-report-size-bound').has('stack/agents/code-quality-analyzer.md'));
});

// --- M55: one description shape and one Scope section per seat -----------------------------------------
test('M55: no seat body carries a trigger phrase - a body routes nothing', () =>
{
    const hits = seats.filter((s) => /Triggers on\b/.test(body(s)));
    assert.deepStrictEqual(hits, []);
});

test('M55: every seat has exactly one ## Scope and a description with its Do NOT use / Not for clause', () =>
{
    const { lintAgentShape } = require('./lint-skills.js');
    const findings = seats.flatMap((s) => lintAgentShape(`agents/${s}.md`, meta(s).description, body(s)));
    assert.deepStrictEqual(findings, []);
    // code-style-analyzer's old Scope held its dispatch inputs; test-coverage-analyzer had two
    assert.match(body('code-style-analyzer'), /^## Dispatch inputs$/m);
    assert.match(body('test-coverage-analyzer'), /^## Dispatch inputs$/m);
});

// --- M56: three garbled sentences, each said once ------------------------------------------------------
test('M56: the three garbled sentences read once and cleanly', () =>
{
    const asp = squash(body('aspnet-verifier'));
    assert.doesNotMatch(asp, /- unlocks error-handling/, 'the parenthetical no longer swallows the sentence');
    assert.ok(asp.includes('`dotnet-web-backend` (the web hub, which routes error handling, security, OpenAPI, minimal APIs and MVC to the focused skills that are the source of truth for each)'), 'the hub clause');
    assert.ok(asp.includes('and `dotnet-data-access` (app-side EF query composition - ordering, Take/limit, how Total is derived) are preloaded'), 'the data-access clause');
    const web = squash(body('web-angular-solution-designer'));
    assert.doesNotMatch(web, /\) \(Material/, 'no two parentheticals back to back');
    assert.ok(web.includes('an area outside them (styling and theming, security hardening, a release or build concern)'), 'one list');
    // The Scope paragraph's Do NOT use clause said the ORM-vs-schema boundary three times over.
    const useWhen = body('data-solution-designer').split('\n').find((l) => l.startsWith('Use when'));
    assert.strictEqual((useWhen.match(/DbContext/g) || []).length, 1, 'the ORM-vs-schema boundary is stated once');
    assert.strictEqual((useWhen.match(/this seat owns/g) || []).length, 1);
});

// --- M58: every read-only support seat opens its return with a routable status word -------------------
test('M58: the six support seats each return a literal status: line', () =>
{
    const support = ['architecture-analyzer', 'code-quality-analyzer', 'code-style-analyzer', 'evidence-gatherer', 'related-project-analyzer', 'test-coverage-analyzer'];
    for (const seat of support) assert.match(body(seat), /`status: [A-Z_]+( \| [A-Z_]+)+`/, `${seat}: a status vocabulary`);
    assert.ok(squash(body('test-coverage-analyzer')).includes('Open with a literal `status: CHARACTERIZED | PARTIAL | UNPARSED` line'));
    assert.ok(squash(body('related-project-analyzer')).includes('Open with a literal `status: CHARACTERIZED | UNVERIFIED` line'));
});

// --- M60 lives in capture-project-capabilities.test.js (the run-book line's trigger) --------------------

// --- M59: the runaway caps are measured, not guessed -------------------------------------------------
// Turns per run from 802 subagent transcripts on the maintainer's machine (by real path - 537 more were the same
// files reached through symlinked project folders) (2026-09-29; a turn is one assistant
// API response): implementers n=58, max 116; verifiers n=124, max 152; architecture-analyzer n=38, max 30. Each
// cap is twice the most seen, rounded up to the next 50. The resolvers (one run seen, 20 turns) take the
// implementer's cap - the nearest measured shape, an edit-build-test loop - because an until-green loop is the
// runaway the cap exists for. Every other seat had too few runs to set one, so it has none.
test('M59: the turn caps sit where the measurement put them, and nowhere else', () =>
{
    const CAP = { implementer: 250, verifier: 350, resolver: 250, 'architecture-analyzer': 100 };
    const kind = (s) => (/-implementer$/.test(s) ? 'implementer' : /-verifier$/.test(s) ? 'verifier'
        : /-resolver$/.test(s) ? 'resolver' : s);
    const capped = seats.filter((s) => CAP[kind(s)]);
    assert.strictEqual(capped.length, 25, '10 implementers, 10 verifiers, 4 resolvers, architecture-analyzer');
    for (const s of seats) assert.strictEqual(meta(s).maxTurns, CAP[kind(s)], `${s}: maxTurns`);
    // Review B1: the transcript count is the de-duplicated one, and the cap's CLI floor is named.
    const claude = squash(require('./claude-docs.js').readClaudeDocs());
    assert.doesNotMatch(claude, /1,330/);
    assert.match(claude, /the most turns measured for the seat's kind over 802 local subagent transcripts/);
    assert.match(claude, /Claude Code returns the output marked partial \(2\.1\.246\+\)/);
});

// --- 2026-10-08 audit (agents.md F01-F17, hooks.md #9) ------------------------------------------------
// Each case names the report row it holds, so a regression reads as the audit line it reopens.
const designers = seats.filter((s) => s.endsWith('-solution-designer'));
const implementers = seats.filter((s) => s.endsWith('-implementer'));
const resolvers = seats.filter((s) => s.endsWith('-resolver'));
const diagnosers = ['issue-diagnoser-ci', 'issue-diagnoser-runtime'];
// The `## Scope` section's first paragraph - the Use-when line.
const scopeLine = (seat) => (section(body(seat), 'Scope').split('\n\n')[1] || '').replace(/\s+/g, ' ').trim();

test('agents F01: integration-reviewer runs migrations only on a disposable database, as data-verifier does', () =>
{
    const text = squash(body('integration-reviewer'));
    assert.ok(text.includes('both on a disposable database this run starts (the Testcontainers fixture or a throwaway container) - never to the project\'s configured connection'), 'check 4 names its target');
    assert.ok(text.includes('the down path (or a documented forward-fix) is proven on that same database'));
    assert.ok(text.includes('the migration scripts (against the disposable database of check 4)'), 'the Bash line points at the same target');
    const entry = rules()['migration-disposable-database'];
    assert.ok(entry, 'registered');
    assert.strictEqual(entry.owner.file, 'stack/agents/data-verifier.md');
    assert.deepStrictEqual([...listedIn('migration-disposable-database')].sort(),
        ['stack/agents/data-verifier.md', 'stack/agents/evidence-gatherer.md', 'stack/agents/integration-reviewer.md']);
});

test('agents F02: issue-diagnoser-ci hands the tree back on the ref it found', () =>
{
    const text = squash(body('issue-diagnoser-ci'));
    assert.ok(text.includes('before the report check it back out (or remove the worktree you added) so the tree is handed back where you found it; name both refs in the report'));
});

test('agents F04: every designer closes on literal status and contract_version lines, the verdict no longer mid-report', () =>
{
    assert.strictEqual(designers.length, 10);
    for (const s of designers)
    {
        const report = squash(section(body(s), 'Report'));
        assert.ok(!report.includes('End with the verdict'), `${s}: the 'end with X, then Y' order`);
        const close = report.indexOf('Close with a literal `status:` line - PLAN_READY, or NEEDS_CONTEXT / BLOCKED_CONTRACT_CHANGE when blocked - and a literal `contract_version:` line');
        assert.ok(close > report.indexOf('the integration notes') && close > report.indexOf('task list'), `${s}: the close comes after the plan`);
        assert.ok(listedIn('designer-verdict-line').has(`stack/agents/${s}.md`), `${s}: pinned`);
    }
});

test('agents F08: resolvers and diagnosers close on a literal status line', () =>
{
    for (const s of [...resolvers, ...diagnosers])
    {
        const report = squash(section(body(s), 'Report'));
        assert.doesNotMatch(report, /Lead with a status|End with a diagnosis status|give the diagnosis status/, s);
        assert.ok(report.includes('Close with a literal `status:` line, the last line of the report - '), s);
        assert.ok(report.trim().endsWith('reads as a seat death.') || report.trim().endsWith('reads as a status-less return.'), `${s}: the close is the section's last sentence`);
    }
    for (const s of resolvers) assert.ok(listedIn('working-seat-status-vocabulary').has(`stack/agents/${s}.md`), s);
});

test('agents F05: the trimmed Scopes keep the short Use-when shape, and no Scope carries a roster attribution or a flow name', () =>
{
    const trimmed = [...['wpf', 'winforms', 'console', 'windows-service', 'ionic-angular', 'data', 'devops', 'browser-extension']
        .flatMap((st) => [`${st}-implementer`, `${st}-verifier`, `${st}-solution-designer`]), 'related-project-analyzer'];
    assert.strictEqual(trimmed.length, 25);
    for (const s of trimmed)
    {
        const line = scopeLine(s);
        assert.ok(line.length > 0 && line.length <= 450, `${s}: Scope ${line.length} chars`);
        assert.doesNotMatch(line, /primary caller/, `${s}: a caller attribution`);
    }
    for (const s of seats) assert.doesNotMatch(scopeLine(s), /Best (dispatched|as)|task-build-from-scratch|task-verify-code|\/code-review/, s);
});

test('agents F07: the colliding descriptions draw the sibling boundary, and no resolver claims a hand-off it cannot make', () =>
{
    const d = (s) => meta(s).description;
    assert.match(d('aspnet-implementer'), /schema\/migration tasks \(data-implementer\)/);
    assert.match(d('aspnet-solution-designer'), /schema-only change \(data-solution-designer\)/);
    assert.match(d('aspnet-verifier'), /schema is data-verifier/);
    for (const role of ['implementer', 'solution-designer', 'verifier'])
        assert.match(d(`web-angular-${role}`), new RegExp(`Ionic/Capacitor \\(ionic-angular-${role}\\)`), role);
    assert.match(d('issue-diagnoser-runtime'), /a red test suite \(the test resolvers\)/);
    assert.match(d('architecture-analyzer'), /rule-based findings \(code-quality-analyzer\)/);
    for (const s of ['dotnet-build-error-resolver', 'ng-build-error-resolver'])
        assert.doesNotMatch(read(s), /hands off to/, `${s}: the seat holds no Agent tool`);
    for (const s of seats) assert.ok(d(s).length <= 300, `${s}: ${d(s).length}`);
});

test('agents F11: every implementer treats a red outside its boundary as BLOCKED, not an attempt', () =>
{
    assert.strictEqual(implementers.length, 10);
    for (const s of implementers) assert.ok(squash(body(s)).includes('A red that traces to code OUTSIDE your boundary'), s);
    assert.deepStrictEqual([...listedIn('implementer-solution-test-gate')].sort(), implementers.map((s) => `stack/agents/${s}.md`).sort(), 'the sibling-red half is pinned in every copy');
});

test('hooks #9: no implementer is told to git-restore its own files - the discard guard blocks it and only the user can open it', () =>
{
    for (const s of implementers)
    {
        const text = squash(body(s));
        assert.ok(!text.includes('beyond your own task\'s files'), `${s}: the carve-out the guard blocks`);
        assert.ok(text.includes('revert YOUR files by editing them back'), s);
    }
});

test('agents F13: the diagnoser and analyzer copies are pinned', () =>
{
    const want = {
        'diagnoser-sanctioned-nested-dispatch': ['stack/agents/issue-diagnoser-ci.md', 'stack/agents/issue-diagnoser-runtime.md', 'stack/skills/task-solve-cross/references/issue-investigation.md'],
        'diagnoser-gather-accounting': ['stack/agents/issue-diagnoser-ci.md', 'stack/agents/issue-diagnoser-runtime.md'],
        'analyzer-first-call-navigation': ['stack/agents/architecture-analyzer.md', 'stack/agents/code-quality-analyzer.md', 'stack/agents/code-style-analyzer.md'],
        'analyzer-bash-reading-only': ['stack/agents/architecture-analyzer.md', 'stack/agents/code-quality-analyzer.md', 'stack/agents/code-style-analyzer.md', 'stack/agents/test-coverage-analyzer.md'],
        'analyzer-batch-lookups': ['stack/agents/code-quality-analyzer.md', 'stack/agents/code-style-analyzer.md'],
        'analyzer-generated-code-excluded': ['stack/agents/code-quality-analyzer.md', 'stack/agents/code-style-analyzer.md'],
    };
    for (const [id, files] of Object.entries(want)) assert.deepStrictEqual([...listedIn(id)].sort(), files.sort(), id);
});

test('agents F14 + F16: the run-book line leads with its condition, and the gatherer skips it when it never runs the app', () =>
{
    const line = 'When the run book `<docs-path>/project-capabilities/PROJECT-CAPABILITIES.md` exists, read it before you start, log into or hand-check the app';
    for (const s of [...seats.filter((x) => x.endsWith('-verifier')), 'issue-diagnoser-runtime', 'evidence-gatherer', 'integration-reviewer'])
    {
        const text = squash(body(s));
        assert.ok(text.includes(line), s);
        assert.ok(!text.includes('Before you start, log into'), `${s}: the line that read as 'log in before you start'`);
    }
    assert.ok(squash(body('evidence-gatherer')).includes('A gather-task that never runs the app - a CI-log pull, a symbol lookup - skips it.'));
});

test('agents F15 + F17: no implementation product in a role line, and the reviewer\'s fallback reads as three bullets', () =>
{
    for (const s of seats) assert.ok(!body(s).includes('serena-first'), s);
    const text = body('integration-reviewer');
    assert.ok(!text.includes('predates 2.1.0'), 'install history dropped');
    assert.match(text, /^- When that Glob finds nothing \(the project switched that skill off\), gate on the two essentials/m);
    assert.match(text, /^- Load the domain skill for a seam you must judge in depth/m);
});

test('agents F06: every quoted skill-section pointer in a trap list resolves to a heading of a skill the seat preloads', () =>
{
    const headings = (skill) =>
    {
        try { return fs.readFileSync(path.join(ROOT, 'stack', 'skills', skill, 'SKILL.md'), 'utf8').split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim()); }
        catch { return []; }
    };
    let pointers = 0;
    for (const s of seats)
    {
        const traps = section(body(s), 'Failure modes I hunt');
        const preloads = meta(s).skills || [];
        for (const m of traps.matchAll(/'## ([^']+)'/g))
        {
            pointers++;
            assert.ok(preloads.some((k) => headings(k).some((h) => h.startsWith(m[1]))), `${s}: '## ${m[1]}' is no heading of ${preloads.join(', ')}`);
        }
    }
    assert.ok(pointers >= 20, `found ${pointers}`);
    const asp = squash(section(body('aspnet-implementer'), 'Failure modes I hunt'));
    assert.ok(!asp.includes('(the loaded skills carry the fix;'), 'the over-claim: three of the seven traps have no preload home');
    for (const h of ['Session lifetime and thread-safety', 'Identity map and change tracking', 'Loading strategy and N+1', 'Model expected failures as return values'])
        assert.ok(asp.includes(`'## ${h}'`), h);
});
