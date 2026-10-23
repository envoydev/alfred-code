'use strict';
// The MCP and plugin package's prose facts (2.1.5 Minors): each assertion holds a wrong claim absent and the
// right one present, where no subject suite fits. The evidence behind each is named beside it.
const test = require('node:test');
// The purge-count cases run the memory engine (stack/hooks/memory.js) as a project would: no inherited stack env.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const each = (dir, re) => fs.readdirSync(path.join(ROOT, dir), { recursive: true }).filter((f) => re.test(f)).map((f) => path.join(dir, f).split(path.sep).join('/'));

// M20: mcp-memory-service 11.13.0 and later list numpy>=1.24.0 among their core requires_dist (PyPI JSON).
// Re-verify 2 R4: a memory launcher that refuses to start (a settings file it cannot read, no other key) showed only in the CLI's
// MCP log. status and validate render the level CLI's 'refused' and 'unreadable' answers, naming the file and the fix.
test('R4 status and validate name an unreadable settings file and the memory server\'s refusal', () =>
{
    for (const file of ['setup-plugin/commands/status.md', 'setup-plugin/commands/validate.md'])
    {
        const body = read(file);
        assert.match(body, /`refused <file>`/, `${file}: renders the refusal`);
        assert.match(body, /launcher refuses to start/, file);
        assert.match(body, /`unreadable <file>`/, `${file}: renders a skipped settings file`);
    }
});

test('M20 the memory launcher no longer says the service leaves numpy undeclared', () =>
{
    const text = read('stack/mcp/memory-launch.js');
    assert.doesNotMatch(text, /does not declare it/);
    assert.match(text, /declare it themselves \(numpy>=1\.24\.0/);
});

// M23: since 2.1.0 no skill rides the core; the skill is an always-on library copy.
test('M23 the claude-md-management retirement row calls the skill always-on, not the core\'s', () =>
{
    const text = read('meta/retired-plugins.json');
    assert.doesNotMatch(text, /the core's habits-adjust-agents-md skill/);
    assert.match(text, /the always-on habits-adjust-agents-md skill/);
});

// M29: each kept MCP server's launcher downloads and runs its pinned package at every session start, and serena
// fetches its language servers at run time - the Starts row said neither.
test('M29 the install footprint says what each MCP plugin runs at session start', () =>
{
    const doc = read('docs/install-footprint.md');
    const row = doc.slice(doc.indexOf('## What runs'), doc.indexOf('## What you install by hand'));
    assert.ok(row.length > 20, 'the What runs section');
    assert.match(row, /downloads and runs its pinned package/);
    for (const pkg of ['serena-agent', 'mcp-memory-service', '@playwright/mcp', 'windows-mcp', 'macos-mcp']) assert.ok(row.includes(pkg), pkg);
    assert.match(row, /language servers/);
});

// M24 behind a mirror: uv treats a file with no PEP 700 upload time as unavailable under a cut-off, and its error never
// names the cut-off (docs.astral.sh/uv/concepts/resolution, 'Reproducible resolutions'); `UV_EXCLUDE_NEWER=false` lifts
// it (docs.astral.sh/uv/reference/environment). The post-install connect check is where a server that will not start
// is read about, so the escape is named there.
test('M24 the post-install connect check names the escape for an index with no upload times', () =>
{
    const text = read('setup-plugin/references/post-install.md');
    const connect = text.slice(text.indexOf('**Then check they actually CONNECTED.**'), text.indexOf('**And check the plugins are ENABLED'));
    assert.match(connect, /publishes no upload times/);
    assert.match(connect, /`UV_EXCLUDE_NEWER=false`/);
    assert.match(connect, /`exclude-newer = false` in its `\[\[index\]\]` entry of the user-level\s+`uv\.toml`/);
});

// M32: a short tool name inside a call-shaped backtick is called as written and fails 'No such tool' (the pin
// serena-tools-are-deferred measured seven such failures). Since 2026-10-24 the seats hold no server: a blocked target is
// reopened through the LSP, whose operations are arguments of the one `LSP` tool.
test('M32 the verifiers, the integration reviewer and the solve flow spell the navigation tools as they are called', () =>
{
    const seats = each('stack/agents', /(-verifier|integration-reviewer)\.md$/);
    assert.strictEqual(seats.length, 11);
    for (const f of seats)
    {
        const text = read(f);
        assert.doesNotMatch(text, /\(`get_symbols_overview` \/ `find_symbol`\)/, f);
        assert.match(text, /reopen it through the navigation tools your start line orders \(`LSP` `documentSymbol` for its outline, `workspaceSymbol` for a symbol\)/, f);
    }
    // The agents-mode dispatch rules moved to the step mechanics (usage audit 2026-10-10: the body sits at its cap).
    for (const f of ['stack/skills/task-solve/SKILL.md', 'stack/skills/task-solve/references/step-mechanics.md'])
        assert.doesNotMatch(read(f), /write_memory/, f);
    // 2026-10-13: the brief hands the seat its literal note name; since 2026-10-24 the seat stores it on the handoff bus.
    assert.ok(read('stack/skills/task-solve/references/step-mechanics.md').includes('`note: <feature>/<contract_version>/<seat>/<task>` (the seat stores its note under that name on the handoff bus)'));
});

// M39 (2.1.6) named the handoff notes as folders serena's list_memories(topic) filtered by; since the user's
// 2026-10-13 ruling ('Serena is just for navigation, for memory it's only alfred memory') the same grammar rides an
// alfred-memory row as its `note:<name>` tag beside `handoff:<feature>/<contract_version>`, and a seat lists by those
// exact tags plus the project tag - never a search, never the whole store.
const TRIO_COPIES = each('stack/skills', /references[\\/]domain-trio-protocol\.md$/);
test('M39 the handoff notes keep the one grammar and are read by exact tags', () =>
{
    const shipped = [
        ...each('stack', /\.(md|js|json)$/), ...each('setup-plugin', /\.(md|js|json)$/),
        'meta/shared-rules.json', 'docs/alfred-code.html', ...require('./claude-docs.js').claudeDocFiles(),
    ];
    for (const f of shipped)
    {
        const text = read(f);
        assert.doesNotMatch(text, /<feature>__<contract_version>/, `${f}: the old __ grammar`);
        assert.doesNotMatch(text, /<feature>__cycle|csv-export__cycle/, `${f}: the old cycle-note name`);
    }
    // 2026-10-24: the bus is a file, `node .claude/hooks/handoff.js`, and a note is read by its exact name
    const seats = each('stack/agents', /\.md$/).filter((f) => /^- Handoff notes:/m.test(read(f)));
    assert.strictEqual(seats.length, 38);
    for (const f of seats)
    {
        const text = read(f);
        // 2.1.6 review B4: the 17 seats that read ONE note (their own earlier pass) still read one - a run's whole
        // note set is p95 17,535 chars, max 42,082 (39 local runs) - and the 21 that read every note still read the run's.
        const own = /(-solution-designer|-resolver|issue-diagnoser-(ci|runtime)|integration-reviewer)\.md$/.test(f);
        const run = own ? '<feature>/<contract_version>/<seat>' : '<feature>/<contract_version>';
        const reads = own ? 'the note it prints - your own earlier pass -' : 'the notes it prints (newest first; the newest note per name wins)';
        assert.ok(text.includes(`At START, \`node .claude/hooks/handoff.js list ${run}\` - read ${reads} for `), `${f}: reads ${reads}`);
        const name = /-implementer\.md$/.test(f) ? '<feature>/<contract_version>/<seat>/<task>' : '<feature>/<contract_version>/<seat>';
        assert.ok(text.includes(`\`node .claude/hooks/handoff.js put ${name} <<'EOF'\``), `${f}: hands off as ${name}`);
    }
    assert.strictEqual(TRIO_COPIES.length, 5);
    for (const f of TRIO_COPIES)
    {
        const text = read(f);
        assert.match(text, /ONE naming grammar: `<feature>\/<contract_version>\/<seat>`/, f);
        assert.ok(text.includes("read a run with `node .claude/hooks/handoff.js list <feature>/<contract_version>` - newest first, the newest note per name wins - or one note by its exact name"), f);
        assert.doesNotMatch(text, /memory_list|memory_store|memory_delete|tag_match/, f);
    }
    const reuse = read('stack/skills/task-solve-cross/references/capability-reuse.md');
    assert.doesNotMatch(reuse, /prefix-matches|list_memories|memory_list/);
    assert.ok(reuse.includes("it calls `node .claude/hooks/handoff.js list <feature>/<contract_version>`, which prints that run's notes and nothing else"));
    // Usage audit 2026-10-10 (C20): the cycle note was a second cursor nobody kept fresh - the plan's Resume line
    // is the one cursor, and the store holds only the seats' hand-offs.
    const solve = read('stack/skills/task-solve/SKILL.md');
    assert.doesNotMatch(solve, /named `<feature>\/cycle`/);
    assert.match(solve, /\(`<feature>\/<contract_version>\/<seat>\/<task>`\), never a second cursor/);
    assert.match(solve, /Resume: step 4 BUILD - mode session - next task 2/);
    assert.match(read('stack/skills/loop-code-quality/references/delegated-mode.md'), /named `<feature>\/<contract_version>\/<seat>\/<task>`/);
});

// The purge count is a script's number, never a recollection: `node .claude/hooks/handoff.js left <feature>` reads the
// handoff bus (2026-10-24; the memory database and an older release's navigation-server notes before it) in node, so no
// shell tool can read it as 'none left'. The engine's own cases - the data root, an unreadable store - are
// handoff-engine.test.js; here the protocol's line is run as written.
const purgeLine = () => /The purge is counted, not claimed\.\*\* At close, from the project root: `([^`]+)`/.exec(read(TRIO_COPIES[0]))[1];
test('M39 the purge count is the bus\'s own count of the feature\'s notes, the same line in every copy', () =>
{
    const { spawnSync } = require('node:child_process');
    assert.strictEqual(purgeLine(), 'node .claude/hooks/handoff.js left <feature>');
    for (const f of [...TRIO_COPIES, 'stack/skills/task-solve/references/step-mechanics.md'])
        assert.ok(read(f).includes('`node .claude/hooks/handoff.js left <feature>`'), f);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'm39-purge-')));
    try
    {
        fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
        for (const file of ['handoff.js', 'layout.js']) fs.copyFileSync(path.join(ROOT, 'stack', 'hooks', file), path.join(dir, '.claude', 'hooks', file));
        const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
        delete env.ALFRED_CODE_DATA_PATH;
        const bus = (args, input) => spawnSync(process.execPath, [path.join(dir, '.claude', 'hooks', 'handoff.js'), ...args], { cwd: dir, env, input, encoding: 'utf8' });
        bus(['put', 'csv-export/2026-09-29-csv/web-angular-solution-designer'], 'designer note');
        bus(['put', 'csv-export/2026-09-29-csv/web-angular-implementer/task-2'], 'implementer note');
        bus(['put', 'csv-export-v2/v/web-angular-verifier'], 'another feature');
        const [cmd, ...args] = purgeLine().replace(/<feature>/g, 'csv-export').split(' ');
        assert.strictEqual(cmd, 'node');
        const count = () => spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' }).stdout.split('\n')[0];
        assert.strictEqual(count(), '2', 'the feature\'s two notes, never the other feature\'s');
        bus(['purge', 'csv-export']);
        assert.strictEqual(count(), '0');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// M33: a seat names its documentation route one way - the documentation tools its start line orders (2026-10-24: no
// server is locked any more) - and never by a server's name; what is left is the unreachable case.
test('M33 the seats name the documentation tools one way', () =>
{
    for (const f of each('stack/agents', /\.md$/))
    {
        const text = read(f);
        for (const stale of [/library-docs MCP/, /MCP that serves current library documentation/, /docs-lookup MCP/, /none installed/])
            assert.doesNotMatch(text, stale, `${f}: ${stale}`);
    }
    for (const f of ['angular-test-resolver', 'dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'console-implementer', 'ionic-angular-implementer',
        'console-solution-designer', 'devops-solution-designer', 'ionic-angular-solution-designer', 'wpf-solution-designer'])
        assert.match(read(`stack/agents/${f}.md`), /the documentation tools your start line orders/, f);
});

// M34: the house rule names a server by its role, never its upstream as a verb.
test('M34 no skill says serena-first or serena-navigate', () =>
{
    for (const f of each('stack/skills', /\.md$/)) assert.doesNotMatch(read(f), /serena-(first|navigat)/, f);
});

// M37: serena 1.7.0 has no call-hierarchy tool (serena tools list --all at the pin; meta/mcp-tools.json).
test('M37 the inventory page claims no call-hierarchy tool for the navigation server', () =>
{
    const row = read('docs/alfred-code.html').split('\n').find((l) => l.startsWith('  ["alfred-navigation", "MCP server"'));
    assert.ok(row);
    assert.doesNotMatch(row, /call-hierarchy/);
    assert.match(row, /find-references, implementations and declarations/);
});

// M40: the desktop ToolSearch lines load four tools each; the rest of the server's tools exist too, and the
// browser row already says so.
test('M40 both desktop ToolSearch lines say the session\'s listing names more tools', () =>
{
    const skill = read('stack/skills/desktop-automation/SKILL.md');
    const rule = read('stack/skills/capture-awareness/references/agents.md');
    // 2026-10-24: the skill names no server spelling - the load line is the tool order's `desktop` line.
    assert.ok(skill.replace(/\s+/g, ' ').includes("plus that server's other tools the session's own listing shows"), 'the skill');
    for (const server of ['windows-desktop', 'macos-desktop'])
    {
        const row = rule.split('\n').find((l) => l.startsWith(`- \`${server}\``));
        assert.match(row, /plus the other `mcp__plugin_<server>_<server>__\*` names the session's own listing shows\.$/, server);
    }
});

// M42: the status example row is the default plugin route's target, at the pin.
test('M42 the status example row shows the plugin route launcher at the release pin', () =>
{
    const text = read('setup-plugin/commands/status.md');
    assert.doesNotMatch(text, /npx -y @playwright\/mcp@0\.0\.80/);
    assert.ok(text.includes('node .../browser-launch.js --package @playwright/mcp@<pin> --browser firefox'), 'the plugin-route shape, at the pin');
});

// M44: the memory ToolSearch line had two homes no pin tied together. Audit 2026-10-14 RU10 left it ONE, the memory hook's
// session and seat pushes; the tool preferences (phase 1, 2026-10-24) moved that home into the tool order's start line,
// built from the adapter table's memory job and resolved per actor, so the rule never repeats it and the memory hook
// says it only while the order is switched off (memory-session.test.js holds both sides).
test('M44 the memory ToolSearch line has one home, the tool order\'s start line', () =>
{
    const line = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list';
    assert.ok(!fs.existsSync(path.join(ROOT, 'stack', 'rules', 'alfred-memory.md')), 'no rule carries the line - the memory rule retired 2026-10-24');
    assert.strictEqual(JSON.parse(read('meta/shared-rules.json')).rules['memory-toolsearch-line'], undefined, 'no pin for a one-home line');
    const hook = read('stack/hooks/memory-session.js');
    assert.strictEqual(hook.split('ToolSearch select:').length, 2, 'the memory hook spells the line once, its fallback');
    assert.strictEqual(hook.split('TOOL_SEARCH_LINE}').length - 1, hook.split('orderOff() ?').length - 1, 'every use of it sits behind the order-off check');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'm44-')));
    const config = path.join(root, 'config');
    try
    {
        fs.mkdirSync(path.join(root, 'repo', '.claude'), { recursive: true });
        fs.mkdirSync(config);
        fs.writeFileSync(path.join(root, 'repo', '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'alfred-memory@envoydev': true } }));
        const tools = require('../stack/skills/capture-preferences/scripts/tools.js');
        const text = tools.toolsLine({ projectRoot: path.join(root, 'repo'), env: { ...process.env, CLAUDE_CONFIG_DIR: config }, seat: null, suggest: false });
        assert.ok(text.includes(line), text);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// M45: where the capabilities capture never ran, nothing told the main thread the browser tools are deferred.
test('M45 the live probe says the browser tools are deferred and loaded through ToolSearch', () =>
{
    const text = read('stack/skills/task-verify-code/references/live-probe.md').replace(/\s+/g, ' ');
    // Review 2.1.5 plugin, MINOR 3: 'defers MCP tools, its tools are deferred' read as a tautology.
    assert.doesNotMatch(text, /its tools are deferred/);
    // 2026-10-24: the stack ships no browser server - the tools are the tool order's `browser` line.
    assert.match(text, /the browser tools are the `browser` line of the session-start tool order, the server the user registered, so they can be absent\. Where the harness defers MCP tools, load them with that line's `ToolSearch select:` before you call them absent\./);
});

// R3: MacOS-MCP 0.4.6 has no exclude FLAG, but `[tools] exclude` in its config.toml removes a tool
// (macos_mcp/__main__.py: `for tool_name in cfg.tools.exclude: mcp.remove_tool(...)`; infrastructure/config.py).
test('R3 no page says MacOS-MCP cannot switch a tool off; each names the config.toml exclude', () =>
{
    const sites = {
        'stack/mcp/desktop-launch.js': /no exclude flag; its own config\.toml `\[tools\] exclude` removes/,
        'stack/skills/desktop-automation/references/macos.md': /no exclude flag; its own `~\/\.macos-mcp\/config\.toml` `\[tools\] exclude` removes/,
        'docs/alfred-code.html': /no exclude flag; its own config\.toml \[tools\] exclude removes/,
        '.claude/rules/repo-mcp.md': /MacOS-MCP 0\.4\.6 has no exclude flag; its own config\.toml `\[tools\] exclude` removes/,
    };
    for (const [file, right] of Object.entries(sites))
    {
        const text = read(file);
        assert.doesNotMatch(text, /MacOS-MCP (0\.4\.6 )?has no (such )?flag|no flag to switch a tool off|no off switch|MacOS-MCP has no flag for it/, file);
        assert.match(text, right, file);
    }
});

// R13: MacOS-MCP 0.4.6 has no Screenshot tool - the image is Snapshot with use_vision (its __main__.py tool list).
test('R13 the macOS lines name a black vision snapshot, never a screenshot the server does not have', () =>
{
    for (const file of ['stack/mcp/desktop-launch.js', 'stack/skills/capture-awareness/references/agents.md'])
    {
        const text = read(file);
        assert.doesNotMatch(text, /black screenshots/, file);
        assert.match(text, /a black vision snapshot/, file);
    }
});

// M35, through 2.2.0: the RETIRED aliases served their successor's server under the old name, so seats granted both
// spellings.
// 2.2.1 unlisted every RETIRED alias (the user's ruling of 2026-10-06), so no old spelling resolves anywhere: a seat
// grants (and denies) the CURRENT spelling only.
test('M35 no seat grants or denies an old spelling of a renamed server', () =>
{
    const old = ['navigation', 'documentation', 'memory', 'serena', 'context7', 'playwright-chrome', 'playwright-firefox', 'playwright-webkit', 'playwright-msedge'];
    const line = (text, key) => ((text.split('\n').find((l) => l.startsWith(`${key}:`)) || '').slice(key.length + 1)).split(',').map((t) => t.trim()).filter(Boolean);
    let seen = 0;
    for (const f of fs.readdirSync(path.join(ROOT, 'stack/agents')).filter((n) => n.endsWith('.md')))
    {
        const text = read(`stack/agents/${f}`);
        for (const key of ['tools', 'disallowedTools'])
            for (const t of line(text, key))
            {
                seen += 1;
                assert.ok(!old.some((o) => t.startsWith(`mcp__plugin_${o}_${o}__`)), `${f} ${key} still names ${t}`);
                // 2026-10-24: no seat names a server at all, the current spelling included
                assert.ok(!t.startsWith('mcp__'), `${f} ${key} names ${t}`);
            }
    }
    assert.ok(seen > 0, 'no seat lists a tool - the check read nothing');
});
