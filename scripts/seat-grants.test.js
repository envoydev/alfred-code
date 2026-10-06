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
const { PW_ENGINES } = require('./build-marketplace.js');

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
const body = (seat) => split(read(seat)).body;
const rules = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'shared-rules.json'), 'utf8')).rules;
const copiesOf = (id) => { const r = rules()[id]; return [r.owner, ...(r.sites || [])]; };
const verifiers = seats.filter((s) => s.endsWith('-verifier'));

// --- I13: the gate seats reach the documentation server --------------------------------------------
// alfred-quality-gates.md loads in every seat and sends a claim about a package, an API shape or a
// deprecation to the documentation server. A seat that judges or writes code and cannot call it can only
// guess or mark the claim unverified. The five gatherers extract facts from THIS project and pass no
// outside-world verdict, so they stay without it.
const DOC_GRANT = 'mcp__plugin_alfred-documentation_alfred-documentation__*';
const GATHERERS = new Set(['architecture-analyzer', 'code-style-analyzer', 'evidence-gatherer', 'related-project-analyzer', 'test-coverage-analyzer']);

test('I13: every seat that judges or writes code holds the documentation grant the always-on rule sends it to', () =>
{
    const rule = fs.readFileSync(path.join(ROOT, 'stack', 'rules', 'alfred-quality-gates.md'), 'utf8');
    assert.match(squash(rule), /is checked against the `alfred-documentation` server/, 'the always-on rule still directs the lookup');
    const missing = seats.filter((s) => !GATHERERS.has(s) && !tools(s).includes(DOC_GRANT));
    assert.deepStrictEqual(missing, [], `each needs ${DOC_GRANT} in tools:`);
});

test('I13: a seat whose own body sends it to the documentation server holds the grant', () =>
{
    const missing = seats.filter((s) => /documentation server|mcp__plugin_alfred-documentation_alfred-documentation__/.test(body(s)) && !tools(s).includes(DOC_GRANT));
    assert.deepStrictEqual(missing, []);
});

// --- I14: the desktop servers' read-only observe tools --------------------------------------------
// The ruling ('Gate + observe grants'): the WPF and WinForms verifiers and the evidence gatherer observe a
// running desktop app, they never drive it. The observe set per server is what its pinned wheel marks
// readOnlyHint=True, less the tools that do not look at the desktop (Scrape fetches a URL; Windows'
// DisplayInventory and Wait add nothing a verifier needs): windows-mcp 0.8.5 Snapshot / Screenshot /
// WaitFor, macos-mcp 0.4.6 Snapshot / Wait (it has no Screenshot and no WaitFor).
const OBSERVE = { 'windows-desktop': ['Snapshot', 'Screenshot', 'WaitFor'], 'macos-desktop': ['Snapshot', 'Wait'] };
const DESKTOP_SEATS = ['evidence-gatherer', 'winforms-verifier', 'wpf-verifier'];
const desktopGrant = (server, tool) => `mcp__plugin_${server}_${server}__${tool}`;
const desktopTools = (seat) => tools(seat).filter((t) => /^mcp__plugin_(windows|macos)-desktop_/.test(t));

test('I14: the three observe seats hold exactly the read-only observe tools of both desktop servers', () =>
{
    const want = Object.entries(OBSERVE).flatMap(([server, names]) => names.map((n) => desktopGrant(server, n))).sort();
    for (const seat of DESKTOP_SEATS) assert.deepStrictEqual(desktopTools(seat).sort(), want, `${seat}: the observe set, nothing more`);
});

test('I14: no other seat holds a desktop tool, and none holds a desktop wildcard', () =>
{
    const extra = seats.filter((s) => !DESKTOP_SEATS.includes(s) && desktopTools(s).length);
    assert.deepStrictEqual(extra, [], 'a desktop tool drives the user\'s own machine - the observe seats only');
    const wild = seats.filter((s) => desktopTools(s).some((t) => t.endsWith('__*')));
    assert.deepStrictEqual(wild, [], 'a wildcard would grant Click, Type, App and the rest');
});

test('I14: each observe seat names the desktop server by what it does, with the registered absence clause', () =>
{
    const pinned = copiesOf('optional-mcp-absence');
    for (const seat of DESKTOP_SEATS)
    {
        const text = body(seat);
        // a backticked server name is a graph edge: it would pull the opt-in desktop server into every
        // install that picks the seat (evidence-gatherer is an always seat)
        assert.doesNotMatch(text, /`(windows|macos)-desktop`/, `${seat}: described, never named`);
        assert.match(squash(text), /drives this machine's own desktop apps/, `${seat}: the described cite`);
        const site = pinned.find((c) => c.file === `stack/agents/${seat}.md` && /desktop|view|form/.test(c.marker));
        assert.ok(site, `${seat}: a desktop absence clause pinned under optional-mcp-absence`);
        assert.ok(squash(read(seat)).includes(squash(site.marker)), `${seat}: the pinned marker is in the body`);
    }
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-graph.json'), 'utf8'));
    for (const seat of DESKTOP_SEATS)
        assert.deepStrictEqual(graph.agents[seat].mcps.filter((m) => /desktop/.test(m)), [], `${seat}: no graph edge to a desktop server`);
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

// Every MCP a stack seeds must be usable where that stack's work is judged, or be declared a main-session
// tool. Before I14 the WPF and WinForms stacks seeded the desktop server and granted it to no seat.
// browser-extension seeds the browser, but its verifier proves live behavior through the workspace's own
// E2E suite (Playwright loads the unpacked extension there); the browser server serves the main session.
const MAIN_THREAD_ONLY = { 'browser-extension': ['browser'] };
const grantedServers = (seat) => new Set(tools(seat)
    .map((t) => (t.match(/^mcp__plugin_([A-Za-z0-9][A-Za-z0-9.-]*)_\1__/) || [])[1])
    .filter(Boolean)
    .map((p) => (p.startsWith('browser-') ? 'browser' : p)));

test('I14: every MCP a stack seeds is granted to one of that stack\'s seats, or listed main-thread-only', () =>
{
    const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
    const stacks = { always: recs.always, ...recs.stacks };
    const gaps = [];
    const stale = [];
    for (const [name, stack] of Object.entries(stacks))
    {
        const held = new Set((stack.agents || []).flatMap((a) => [...grantedServers(a)]));
        for (const mcp of stack.mcps || [])
        {
            const mainOnly = (MAIN_THREAD_ONLY[name] || []).includes(mcp);
            if (!held.has(mcp) && !mainOnly) gaps.push(`${name}: ${mcp}`);
            if (held.has(mcp) && mainOnly) stale.push(`${name}: ${mcp}`);
        }
    }
    assert.deepStrictEqual(gaps, [], 'a seeded server no seat of the stack can call');
    assert.deepStrictEqual(stale, [], 'listed main-thread-only but granted - drop it from MAIN_THREAD_ONLY');
});

// --- I11: the browser wildcard minus browser_run_code_unsafe --------------------------------------
// The ruling ('Wildcard minus unsafe'): the four read-only seats keep `mcp__plugin_browser-<engine>_...__*`
// and deny the one RCE-equivalent tool (Playwright MCP 0.0.82 README: 'executes arbitrary JavaScript in
// the Playwright server process and is RCE-equivalent') through the documented `disallowedTools` field,
// which is applied first, then `tools` resolves against what is left.
const BROWSER_SEATS = ['evidence-gatherer', 'integration-reviewer', 'ionic-angular-verifier', 'web-angular-verifier'];
const browserWild = (engine) => `mcp__plugin_browser-${engine}_browser-${engine}__*`;
const unsafe = (engine) => `mcp__plugin_browser-${engine}_browser-${engine}__browser_run_code_unsafe`;

test('I11: the four read-only seats keep the browser wildcard for every engine', () =>
{
    for (const seat of BROWSER_SEATS)
        for (const engine of PW_ENGINES) assert.ok(tools(seat).includes(browserWild(engine)), `${seat}: ${browserWild(engine)}`);
});

test('I11: no seat granting a browser wildcard lacks the browser_run_code_unsafe disallow for that engine', () =>
{
    const missing = [];
    for (const seat of seats)
        for (const engine of PW_ENGINES)
            if (tools(seat).includes(browserWild(engine)) && !disallowed(seat).includes(unsafe(engine))) missing.push(`${seat}: ${unsafe(engine)}`);
    assert.deepStrictEqual(missing, []);
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
const HANDBACK_SEATS = [...verifiers, 'code-style-analyzer', 'related-project-analyzer', 'test-coverage-analyzer'].sort();

test('I16: no seat says its final plain message is the deliverable', () =>
{
    const hits = seats.filter((s) => /final message IS the deliverable|turn's LAST message/i.test(squash(read(s))));
    assert.deepStrictEqual(hits, []);
});

test('I16: the ten verifiers and the three structured-return seats carry the handback clause, pinned', () =>
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
