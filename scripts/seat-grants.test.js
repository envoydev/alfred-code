'use strict';
// The 2.1.4 audit's agents package (merged.md I11, I13-I18): what the seats are granted, what their
// bodies claim, and the shared-rules pins that keep the multi-home sentences in step. Each test names
// the finding it holds, so a regression reads as the audit line it reopens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const lint = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const AGENTS = path.join(ROOT, 'stack', 'agents');
const squash = (s) => s.replace(/\s+/g, ' ');
const seats = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
const read = (seat) => fs.readFileSync(path.join(AGENTS, `${seat}.md`), 'utf8');
const split = (text) =>
{
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    return { meta: yaml.load(m[1]), body: m[2] };
};
// `tools` and `disallowedTools` share one format: a comma-separated string (code.claude.com/docs/en/sub-agents).
const list = (v) => String(v || '').split(',').map((t) => t.trim()).filter(Boolean);
const tools = (seat) => list(split(read(seat)).meta.tools);
const disallowed = (seat) => list(split(read(seat)).meta.disallowedTools);
// The two lines are generated (scripts/seat-tools.js): a seat grants each server whole and removes what it must not
// hold. `held` is what it holds as Claude Code resolves that, tool by tool; `intent` is meta/seat-tools.json's row -
// where `<server>:*` says the seat takes a later pin's tools too.
const held = (seat) => [...require('./seat-tools.js').effectiveTools(split(read(seat)).meta.tools, split(read(seat)).meta.disallowedTools)];
const intent = (seat) => (JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'seat-tools.json'), 'utf8')).seats[seat] || []);
const body = (seat) => split(read(seat)).body;
const rules = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'shared-rules.json'), 'utf8')).rules;
const copiesOf = (id) => { const r = rules()[id]; return [r.owner, ...(r.sites || [])]; };
const verifiers = seats.filter((s) => s.endsWith('-verifier'));

// --- 2026-10-24, the user's ruling: the stack depends on no MCP server ------------------------------------------------
// A seat holds built-in tools only: `LSP` and grep navigate, WebFetch checks a library's docs, Bash runs the handoff bus.
// Its start line (preferences-session's tool order) names the job's tools the seat holds, so a body describes a job's
// tools - 'the navigation tools your start line orders' - and never names a server.
test('no seat holds an MCP server tool', () =>
{
    const servers = seats.flatMap((s) => [...tools(s), ...disallowed(s), ...intent(s)].filter((t) => /^mcp__|:/.test(t)).map((t) => `${s}: ${t}`));
    assert.deepStrictEqual(servers, []);
});

// I13, re-read: alfred-quality-gates.md sends an outside-world claim to a library's docs. A seat that judges or writes code
// reaches them through WebFetch, the documentation default; the five gatherers extract facts from THIS project and pass no
// outside-world verdict, so they stay without it.
const GATHERERS = new Set(['architecture-analyzer', 'code-style-analyzer', 'evidence-gatherer', 'related-project-analyzer', 'test-coverage-analyzer']);

test('I13: every seat that judges or writes code holds WebFetch, the documentation default', () =>
{
    assert.deepStrictEqual(seats.filter((s) => !GATHERERS.has(s) && !tools(s).includes('WebFetch')), []);
});

test('I13: a seat whose body sends it to the documentation tools holds WebFetch, and one naming an LSP operation holds LSP', () =>
{
    assert.deepStrictEqual(seats.filter((s) => /documentation tools your start line orders/.test(body(s)) && !tools(s).includes('WebFetch')), []);
    assert.deepStrictEqual(seats.filter((s) => /`LSP`|`(workspaceSymbol|findReferences|documentSymbol|goToDefinition)`/.test(body(s)) && !tools(s).includes('LSP')), []);
});

test('the handoff bus: every seat that stores or reads a note runs handoff.js through the Bash it holds', () =>
{
    const users = seats.filter((s) => /handoff\.js (put|list)/.test(body(s)));
    assert.ok(users.length >= 38, `${users.length} seats run the bus`);
    assert.deepStrictEqual(users.filter((s) => !tools(s).includes('Bash')), []);
    for (const s of users)
        assert.doesNotMatch(body(s), /memory_(store|list|search)|alfred-memory|memory tag/, `${s}: the bus replaced the memory server`);
    // a designer or a resolver reads its own earlier pass, never the whole run (a run's notes measured p95 17,535 chars)
    for (const s of seats.filter((x) => /-solution-designer$|-resolver$|^issue-diagnoser-|^integration-reviewer$/.test(x) && users.includes(x)))
        assert.match(body(s), /handoff\.js list <feature>\/<contract_version>\/<seat>`/, s);
});

// --- I14: the desktop observe seats --------------------------------------------------------------------------
// The ruling ('Gate + observe grants'): the WPF and WinForms verifiers and the evidence gatherer observe a running
// desktop app, they never drive it - now through the `desktop` tools their start line orders, which name none until a
// seat may hold a server again; a check nothing observed is reported UNVERIFIED, never passed.
const DESKTOP_SEATS = ['evidence-gatherer', 'winforms-verifier', 'wpf-verifier'];

test('I14: each observe seat describes the desktop tools by job, observes only, with the registered absence clause', () =>
{
    const pinned = copiesOf('optional-mcp-absence');
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-graph.json'), 'utf8'));
    for (const seat of DESKTOP_SEATS)
    {
        const text = squash(body(seat));
        assert.doesNotMatch(text, /`(windows|macos)-control`|desktop MCP|`(Snapshot|WaitFor|Wait|Screenshot)`/, `${seat}: described by job, never by server`);
        assert.match(text, /the `desktop` tools your start line orders, read-only ones only/, `${seat}: the job cite`);
        assert.match(text, /you never click or type/i, `${seat}: observe-only`);
        const site = pinned.find((c) => c.file === `stack/agents/${seat}.md` && /desktop|view|form/.test(c.marker));
        assert.ok(site, `${seat}: a desktop absence clause pinned under optional-mcp-absence`);
        assert.ok(squash(read(seat)).includes(squash(site.marker)), `${seat}: the pinned marker is in the body`);
        assert.deepStrictEqual((graph.agents[seat].mcps || []).filter((m) => /desktop|control/.test(m)), [], `${seat}: no graph edge to a desktop server`);
    }
});

test('I14: winforms-verifier runs the app the way wpf-verifier does - bounded, and named on left_running', () =>
{
    const text = squash(read('winforms-verifier'));
    assert.ok(!text.includes('never an interactive UI session'), 'the blanket ban is gone');
    assert.match(text, /wall-clock timeout/, 'the run is bounded');
    assert.match(text, /RUN the app on the changed forms/, 'the regression hunt runs the app');
    const files = copiesOf('verifier-left-running-line').map((c) => c.file);
    for (const seat of ['winforms-verifier', 'wpf-verifier'])
    {
        assert.ok(files.includes(`stack/agents/${seat}.md`), `${seat}: a verifier-left-running-line site`);
        assert.match(squash(read(seat)), /a literal `left_running:` line/, `${seat}: the footer line`);
    }
});

// --- audit 2026-10-14 AG08 (the user's ruling): the mobile observe seats ------------------------------------------
const MOBILE_SEATS = ['evidence-gatherer', 'ionic-angular-verifier'];

test('AG08: each mobile observe seat describes the mobile tools by job, observes only, with the absence clause', () =>
{
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-graph.json'), 'utf8'));
    for (const seat of MOBILE_SEATS)
    {
        const text = squash(body(seat));
        assert.doesNotMatch(text, /`mobile-control`|mobile MCP|appium_/, `${seat}: described by job, never by server`);
        assert.match(text, /the `mobile` tools your start line orders, read-only ones only, against a device session already open/, `${seat}: the job cite`);
        assert.match(text, /You observe, you never tap, type or open a session/, `${seat}: observe-only`);
        assert.match(text, /A project may have no mobile tools/, `${seat}: the absence clause`);
        assert.ok(!(graph.agents[seat].mcps || []).includes('mobile-control'), `${seat}: no graph edge to a mobile server`);
    }
    assert.match(squash(body('evidence-gatherer')), /say plainly that the device evidence was not obtainable here/);
    assert.match(squash(body('ionic-angular-verifier')), /a native screen nothing observed is never a silent pass/);
});

// --- I11, re-read: the browser seats ---------------------------------------------------------------------------
// The four seats that drive a browser name the `browser` tools their start line orders, never a hand-rolled script,
// and report a path nothing drove as UNVERIFIED.
const BROWSER_SEATS = ['evidence-gatherer', 'integration-reviewer', 'ionic-angular-verifier', 'web-angular-verifier'];

test('I11: the four browser seats describe the browser tools by job, with the absence clause', () =>
{
    for (const seat of BROWSER_SEATS)
    {
        const text = squash(body(seat));
        assert.doesNotMatch(text, /browser-automation MCP|MCP that drives a real browser|browser_(wait_for|snapshot)|playwright-/, seat);
        assert.match(text, /the `browser` tools your start line orders/, seat);
        assert.match(text, /A project may have no browser tools|has browser tools only where it wants them/, seat);
    }
});

test('I11: every disallowedTools entry is a real tool spelling, and none removes a tool the seat lists', () =>
{
    for (const seat of seats)
    {
        const deny = disallowed(seat);
        if (!deny.length) continue;
        // a misspelled deny fails OPEN - the tool it meant to remove stays granted
        assert.deepStrictEqual(lint.lintAgentTools(`agents/${seat}.md`, `tools: ${deny.join(', ')}\n`), [], seat);
        // 2.1.5 M35: judged on the seat's own grant line, where a listed 1.x alias's spelling is allowed.
        assert.deepStrictEqual(lint.lintStaleMcpToolNames({ files: [{ file: `stack/agents/${seat}.md`, text: `disallowedTools: ${deny.join(', ')}` }] }), [], seat);
        assert.deepStrictEqual(deny.filter((t) => tools(seat).includes(t)), [], `${seat}: a tool listed in both is removed`);
    }
});

// --- I15: the reviewer reads the project's library copy ---------------------------------------------
test('I15: no seat body looks for a skill in the plugin cache or the account dir - every skill is a project copy', () =>
{
    const hits = seats.filter((s) => /plugins\/cache|CLAUDE_CONFIG_DIR|\$HOME\/\.claude/.test(body(s)));
    assert.deepStrictEqual(hits, []);
});

test('I15: integration-reviewer reads .claude/skills, and keeps the two essentials only for a project without the skill', () =>
{
    const text = squash(body('integration-reviewer'));
    assert.match(text, /`\.claude\/skills\/task-solve-cross\/references\/\*\.md`/);
    assert.doesNotMatch(text, /account dir|on the plugin route/);
    assert.match(text, /switched that skill off/);
    assert.match(text, /gate on the two essentials you cannot reconstruct from the diff/);
});

// --- I16: the report is delivered through SubagentHandback when the seat has it ---------------------
// tools-reference: SubagentHandback 'Delivers a subagent's final report ... Provided only in auto mode, to
// subagents that the Agent tool runs locally other than forks'; Claude Code gives it even when `tools`
// leaves it out. A body saying the final plain message IS the deliverable is false there.
const HANDBACK = 'through SubagentHandback when your tools include it, else as your last message; nothing after it';
// The 2026-10-20 stack audit (#6) added every other seat that stores a hand-off note: the implementers, the four
// resolvers and the integration reviewer write it at the same point, so the same report-then-note failure applied;
// the 2026-10-20b agents audit added the designers, the two diagnosers and the security auditor for the same reason.
const HANDBACK_SEATS = [...verifiers, 'code-style-analyzer', 'related-project-analyzer', 'test-coverage-analyzer',
    ...seats.filter((s) => s.endsWith('-implementer') || s.endsWith('-resolver') || s.endsWith('-solution-designer')),
    'integration-reviewer', 'issue-diagnoser-ci', 'issue-diagnoser-runtime', 'security-auditor'].sort();

test('I16: no seat says its final plain message is the deliverable', () =>
{
    const hits = seats.filter((s) => /final message IS the deliverable|turn's LAST message/i.test(squash(read(s))));
    assert.deepStrictEqual(hits, []);
});

test('I16: every note-writing seat and the three structured-return seats carry the handback clause, pinned', () =>
{
    for (const seat of HANDBACK_SEATS) assert.ok(squash(read(seat)).includes(HANDBACK), `${seat}: the handback clause`);
    const copies = copiesOf('verifier-memory-before-report');
    assert.deepStrictEqual(copies.map((c) => c.file).sort(), HANDBACK_SEATS.map((s) => `stack/agents/${s}.md`));
    for (const c of copies) assert.ok(c.marker.includes(HANDBACK), `${c.file}: the marker pins the handback clause`);
});

// --- I17: architecture-analyzer's report bound by shape ---------------------------------------------
test('I17: architecture-analyzer caps each part of its verdict by lines and ends a cut part with a truncated tail', () =>
{
    const text = squash(body('architecture-analyzer'));
    for (const cap of ['Purpose 2', 'Public surface 10', 'Dependencies 10', 'Patterns 6', 'Smells 10'])
        assert.ok(text.includes(cap), `the cap '${cap}'`);
    assert.ok(text.includes('`truncated: <n> more`'), 'the tail line');
});

// --- I18: related-project-analyzer claims no hook it does not have -----------------------------------
test('I18: related-project-analyzer keeps the restriction and claims no rm-guard safety net', () =>
{
    const text = squash(body('related-project-analyzer'));
    assert.doesNotMatch(text, /guard-catastrophic-rm\.js/, 'the rm guard blocks only catastrophic targets');
    assert.doesNotMatch(text, /blocked at the tool call/);
    // the cross-project guard does stop an rm outside the project, but a delete inside the host repo passes
    // every guard - so the body claims no net at all rather than a partial one
    assert.match(text, /Never count on a hook to stop a wider delete - one inside the host repo passes every guard/);
});
