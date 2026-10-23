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
// serena-tools-are-deferred measured seven such failures), so the seats spell the full plugin name.
test('M32 the verifiers, the integration reviewer and the solve flow spell the navigation tools in full', () =>
{
    const seats = each('stack/agents', /(-verifier|integration-reviewer)\.md$/);
    assert.strictEqual(seats.length, 11);
    for (const f of seats)
    {
        const text = read(f);
        assert.doesNotMatch(text, /\(`get_symbols_overview` \/ `find_symbol`\)/, f);
        assert.match(text, /reopen it through the navigation server \(`mcp__plugin_alfred-navigation_alfred-navigation__get_symbols_overview` \/ `mcp__plugin_alfred-navigation_alfred-navigation__find_symbol`\)/, f);
    }
    // The agents-mode dispatch rules moved to the step mechanics (usage audit 2026-10-10: the body sits at its cap).
    for (const f of ['stack/skills/task-solve/SKILL.md', 'stack/skills/task-solve/references/step-mechanics.md'])
        assert.doesNotMatch(read(f), /write_memory/, f);
    // 2026-10-13: the brief hands the seat its literal note name and the project tag; the seat stores through alfred-memory.
    assert.match(read('stack/skills/task-solve/references/step-mechanics.md'), /`note: <feature>\/<contract_version>\/<seat>\/<task>`, `project:<name>`/);
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
    const seats = each('stack/agents', /\.md$/).filter((f) => /Memory handoff:/.test(read(f)));
    assert.strictEqual(seats.length, 38);
    for (const f of seats)
    {
        const text = read(f);
        // 2.1.6 review B4: the 17 seats that read ONE note (their own earlier pass) still read one - a run's whole
        // note set is p95 17,535 chars, max 42,082 (39 local runs) - and the 21 that read every note still read the run's.
        const own = /(-solution-designer|-resolver|issue-diagnoser-(ci|runtime)|integration-reviewer)\.md$/.test(f);
        const tags = own ? "'note:<feature>/<contract_version>/<seat>', 'project:<name>'" : "'handoff:<feature>/<contract_version>', 'project:<name>'";
        const reads = own ? 'the newest note it lists - your own earlier pass -' : 'the notes it lists (newest first; the newest note per name wins)';
        assert.ok(text.includes(`At START, \`mcp__plugin_alfred-memory_alfred-memory__memory_list\` with \`tags: [${tags}]\`, \`tag_match: 'all'\`, \`page_size: 100\` - read ${reads} for `), `${f}: reads ${reads}`);
        const name = /-implementer\.md$/.test(f) ? '<feature>/<contract_version>/<seat>/<task>' : '<feature>/<contract_version>/<seat>';
        assert.ok(text.includes(`\`note:${name}\` and \`project:<name>\``), `${f}: hands off as ${name}`);
    }
    assert.strictEqual(TRIO_COPIES.length, 5);
    for (const f of TRIO_COPIES)
    {
        const text = read(f);
        assert.match(text, /ONE naming grammar: `<feature>\/<contract_version>\/<seat>`/, f);
        assert.match(text, /the name rides the row as its `note:<name>` tag, beside `handoff:<feature>\/<contract_version>`/, f);
        assert.match(text, /`memory_list`, `tag_match: 'all'`/, f);
    }
    const reuse = read('stack/skills/task-solve-cross/references/capability-reuse.md');
    assert.doesNotMatch(reuse, /prefix-matches|list_memories/);
    assert.match(reuse, /it calls `memory_list` with `handoff:<feature>\/<contract_version>` and the project tag, `tag_match: 'all'`/);
    // Usage audit 2026-10-10 (C20): the cycle note was a second cursor nobody kept fresh - the plan's Resume line
    // is the one cursor, and the store holds only the seats' hand-offs.
    const solve = read('stack/skills/task-solve/SKILL.md');
    assert.doesNotMatch(solve, /named `<feature>\/cycle`/);
    assert.match(solve, /\(`<feature>\/<contract_version>\/<seat>\/<task>`\), never a second cursor/);
    assert.match(solve, /Resume: step 4 BUILD - mode session - next task 2/);
    assert.match(read('stack/skills/loop-code-quality/references/delegated-mode.md'), /named `<feature>\/<contract_version>\/<seat>\/<task>`/);
});

// The purge count is a script's number, never a recollection: `node .claude/hooks/memory.js handoff <feature>` reads
// the memory database (this project's `handoff:<feature>` rows) and an older release's navigation-server notes still on
// disk - the feature folder and a pre-2.1.6 run's flat `<feature>__*`, a 2.0.0 `.serena/memories` too - in node, so no
// `find` first on PATH (Windows' find.exe is a string search, review B2) can read it as 'none left'. Run as written.
const purgeLine = () => /The purge is counted, not claimed\.\*\* At close, from the project root: `([^`]+)`/.exec(read(TRIO_COPIES[0]))[1];
let SQLITE = null;
try { process.removeAllListeners('warning'); SQLITE = require('node:sqlite'); } catch {}
const purgeFixture = (fn) =>
{
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm39-purge-'));
    const put = (rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), 'x'); };
    fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'stack', 'hooks', 'memory.js'), path.join(dir, '.claude', 'hooks', 'memory.js'));
    const db = path.join(dir, 'memory.db');
    const d = new SQLITE.DatabaseSync(db);
    d.exec(read('scripts/fixtures/memory-schema.sql'));
    const ins = d.prepare('INSERT INTO memories (content_hash, content, tags, memory_type, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)');
    const name = path.basename(dir);
    ins.run('a', 'designer note', `handoff,handoff:csv-export,handoff:csv-export/2026-09-29-csv,note:csv-export/2026-09-29-csv/web-angular-solution-designer,project:${name}`, 'note', 1, null);
    ins.run('b', 'purged note', `handoff,handoff:csv-export,note:csv-export/2026-09-29-csv/x,project:${name}`, 'note', 2, 3);
    ins.run('c', 'another feature', `handoff,handoff:csv-export-v2,note:csv-export-v2/v/x,project:${name}`, 'note', 4, null);
    ins.run('d', 'another project', 'handoff,handoff:csv-export,note:csv-export/v/y,project:other', 'note', 5, null);
    d.close();
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { 'alfred-memory': { type: 'stdio', command: 'node', args: [], env: { MCP_MEMORY_SQLITE_PATH: db } } } }));
    const env = { ...process.env, HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'acct'), CLAUDE_PROJECT_DIR: dir };
    delete env.ALFRED_CODE_DATA_PATH;
    try { fn(dir, put, env); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const seedPurge = (dir, put) =>
{
    put('.alfred/serena/memories/csv-export/cycle.md');
    put('.alfred/serena/memories/csv-export/2026-09-29-csv/web-angular-solution-designer.md');
    put('.alfred/serena/memories/csv-export/2026-09-29-csv/web-angular-implementer/task-2.md');
    fs.mkdirSync(path.join(dir, '.alfred/serena/memories/csv-export/2026-09-28-csv'), { recursive: true });
    put('.alfred/serena/memories/csv-export-v2/2026-09-29-csv/web-angular-verifier.md');
    put('.alfred/serena/memories/csv-export-v2__2026-09-29-csv__web-angular-verifier.md');
    put('.serena/memories/csv-export__2026-09-20-csv__web-angular-verifier.md');
    put('.alfred/serena/home/memories/global/csv-export/note.md');
};
test('M39 the purge count counts this project\'s feature rows and the legacy notes, nothing else', { skip: (process.platform === 'win32' && 'the find stub is a shell script') || (!SQLITE && 'node:sqlite unavailable') }, () =>
{
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    assert.strictEqual(purgeLine(), 'node .claude/hooks/memory.js handoff <feature>');
    const cmd = purgeLine().replace(/<feature>/g, 'csv-export');
    purgeFixture((dir, put, env) =>
    {
        const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'm39-bin-'));
        fs.writeFileSync(path.join(bin, 'find'), '#!/bin/sh\necho "FIND: Parameter format not correct" >&2\nexit 2\n', { mode: 0o755 });
        const count = (pathDirs) => execFileSync('bash', ['-c', cmd], { cwd: dir, env: { ...env, PATH: [...pathDirs, process.env.PATH].join(path.delimiter) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0];
        try
        {
            assert.strictEqual(count([]), '1', 'one live row of this project for the feature: purged, other-feature and other-project rows are none');
            seedPurge(dir, put);
            assert.strictEqual(count([]), '5', 'that row, three notes in the feature folder (an empty folder is none) and one flat 2.0.0 note');
            assert.strictEqual(count([bin]), '5', 'a foreign find first on PATH changes nothing');
        }
        finally { fs.rmSync(bin, { recursive: true, force: true }); }
    });
});

// Review B2: the count is plain node, so its logic runs the same on every platform - no shell, no find.
test('M39 the purge count runs the same without a shell, follows the data root, and never guesses', { skip: !SQLITE && 'node:sqlite unavailable' }, () =>
{
    const { spawnSync } = require('node:child_process');
    const m = /^node (\.claude\/hooks\/memory\.js) handoff <feature>$/.exec(purgeLine());
    assert.ok(m, 'the line runs the copied engine with the feature as its argument');
    purgeFixture((dir, put, env) =>
    {
        seedPurge(dir, put);
        const run = (extra = {}) => spawnSync(process.execPath, [path.join(dir, m[1]), 'handoff', 'csv-export'], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
        assert.strictEqual(run().stdout.split('\n')[0], '5');
        fs.renameSync(path.join(dir, '.alfred'), path.join(dir, 'data'));
        assert.strictEqual(run({ ALFRED_CODE_DATA_PATH: 'data' }).stdout.split('\n')[0], '5', 'the data root setting is followed');
        fs.writeFileSync(path.join(dir, 'memory.db'), 'not a database');
        const bad = run({ ALFRED_CODE_DATA_PATH: 'data' });
        assert.strictEqual(bad.status, 1);
        assert.strictEqual(bad.stdout, '', 'an unreadable database prints no number');
    });
});

// M33: the documentation server is locked into every install, so a seat names it by its role and never hedges
// on it being absent; what is left is the unreachable case.
test('M33 the seats name the locked documentation server one way and never as optional', () =>
{
    for (const f of each('stack/agents', /\.md$/))
    {
        const text = read(f);
        for (const stale of [/library-docs MCP/, /MCP that serves current library documentation/, /docs-lookup MCP/, /none installed/])
            assert.doesNotMatch(text, stale, `${f}: ${stale}`);
    }
    for (const f of ['angular-test-resolver', 'dotnet-build-error-resolver', 'dotnet-test-failure-resolver', 'ng-build-error-resolver', 'console-implementer', 'ionic-angular-implementer',
        'console-solution-designer', 'devops-solution-designer', 'ionic-angular-solution-designer', 'wpf-solution-designer'])
        assert.match(read(`stack/agents/${f}.md`), /the documentation server/, f);
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
    for (const server of ['windows-control', 'macos-control'])
    {
        assert.match(skill, new RegExp(`plus the other \`mcp__plugin_${server}_${server}__\\*\` names the session's own listing shows`), server);
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

// M43: mcp-memory-service reads tags only from `metadata` (server/handlers/memory.py, 11.14.0 line 193); a top-level
// `tags` argument is dropped, and an untagged row is invisible to the session-start project filter.
test('M43 alfred-memory names metadata.tags for the project tag', () =>
{
    const text = read('stack/rules/alfred-memory.md');
    assert.match(text, /`metadata\.tags` `project:<name>`/);
});

// M44: the memory ToolSearch line had two homes no pin tied together. Audit 2026-10-14 RU10 left it ONE, the memory hook's
// session and seat pushes; the tool preferences (phase 1, 2026-10-24) moved that home into the tool order's start line,
// built from the adapter table's memory job and resolved per actor, so the rule never repeats it and the memory hook
// says it only while the order is switched off (memory-session.test.js holds both sides).
test('M44 the memory ToolSearch line has one home, the tool order\'s start line', () =>
{
    const line = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list';
    assert.ok(!read('stack/rules/alfred-memory.md').includes('ToolSearch select:'), 'the rule carries no ToolSearch line');
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
    assert.match(text, /Where the harness defers MCP tools, load the browser plugin's tools through ToolSearch, by the names the deferred listing shows, before you call it absent\./);
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
                if (/^mcp__plugin_alfred-/.test(t)) seen += 1;
                assert.ok(!old.some((o) => t.startsWith(`mcp__plugin_${o}_${o}__`)), `${f} ${key} still names ${t}`);
            }
    }
    assert.ok(seen > 0, 'no seat names an alfred- tool - the check read nothing');
});
