'use strict';
// The MCP and plugin package's prose facts (2.1.5 Minors): each assertion holds a wrong claim absent and the
// right one present, where no subject suite fits. The evidence behind each is named beside it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
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
    const solve = read('stack/skills/task-solve/SKILL.md');
    assert.doesNotMatch(solve, /`write_memory\(/);
    assert.match(solve, /`mcp__plugin_alfred-navigation_alfred-navigation__write_memory\('<feature>\/<contract_version>\/<seat>\/<task>'/);
});

// M39: serena 1.7.0's list_memories(topic) lists the FOLDER <memories>/<topic>/ and nothing else
// (memory_manager.py list_project_memories / list_memories), and a `/` in a memory name is stored as a
// subfolder that read, edit and delete resolve the same way (get_memory_file_path) - measured on the pinned
// wheel: a `__` prefix as topic listed nothing. So the handoff names are folders, and a seat asks the server
// for its run's notes instead of pattern-matching the whole store.
const TRIO_COPIES = each('stack/skills', /references[\\/]domain-trio-protocol\.md$/);
test('M39 the handoff notes are named as topic folders the server can filter', () =>
{
    const shipped = [
        ...each('stack', /\.(md|js|json)$/), ...each('setup-plugin', /\.(md|js|json)$/),
        'meta/shared-rules.json', 'docs/alfred-code.html', ...require('./claude-docs.js').claudeDocFiles(),
    ];
    for (const f of shipped)
    {
        const text = read(f);
        assert.doesNotMatch(text, /<feature>__<contract_version>/, `${f}: the old __ grammar`);
        // The flat cycle-note name survives only as the pre-2.1.6 note a resume may still find (review B3).
        assert.doesNotMatch(text.replace(/a pre-2\.1\.6 one is\s+`<feature>__cycle\.md`/g, ''), /<feature>__cycle|csv-export__cycle/, `${f}: the old cycle-note name`);
    }
    const seats = each('stack/agents', /\.md$/).filter((f) => /Memory handoff:/.test(read(f)));
    assert.strictEqual(seats.length, 38);
    for (const f of seats)
    {
        const text = read(f);
        // 2.1.6 review B4: the 17 seats that read ONE note before (their own seat's earlier pass) still read one -
        // a run's whole folder is p95 17,535 chars, max 42,082 (39 local runs) - and the 21 that read every
        // matching note still read the run's notes.
        const own = /(-solution-designer|-resolver|issue-diagnoser-(ci|runtime)|integration-reviewer)\.md$/.test(f);
        const reads = own ? 'the one note it lists under your own seat name' : 'the notes it lists';
        assert.ok(text.includes(`At START, \`mcp__plugin_alfred-navigation_alfred-navigation__list_memories\` with \`topic: '<feature>/<contract_version>'\` then \`mcp__plugin_alfred-navigation_alfred-navigation__read_memory\` ${reads} for `), `${f}: reads ${reads}`);
        const name = /-implementer\.md$/.test(f) ? '<feature>/<contract_version>/<seat>/<task>' : '<feature>/<contract_version>/<seat>';
        assert.ok(text.includes(`one compact note named \`${name}\``), `${f}: hands off as ${name}`);
    }
    assert.strictEqual(TRIO_COPIES.length, 5);
    for (const f of TRIO_COPIES)
    {
        const text = read(f);
        assert.match(text, /ONE naming grammar: `<feature>\/<contract_version>\/<seat>`/, f);
        assert.match(text, /`list_memories` with `topic: '<feature>\/<contract_version>'`/, f);
        assert.match(text, /`<feature>` is never `global`/, f);
    }
    const reuse = read('stack/skills/task-solve-cross/references/capability-reuse.md');
    assert.doesNotMatch(reuse, /prefix-matches/);
    assert.match(reuse, /`list_memories` with `topic: '<feature>\/<contract_version>'`/);
    const solve = read('stack/skills/task-solve/SKILL.md');
    assert.match(solve, /`write_memory` named `<feature>\/cycle`/);
    assert.match(solve, /cycle note 'csv-export\/cycle'/);
    assert.match(read('stack/skills/loop-quality/references/delegated-mode.md'), /named `<feature>\/<contract_version>\/<seat>\/<task>`/);
});

// M39: the purge count reads the folder shape, and a run begun before 2.1.6 (flat `<feature>__` names) is
// counted too, so a run straddling the update leaves no note behind. Review B2: it counts in node, so no
// `find` first on PATH (Windows' find.exe is a string search) can read it as 'none left'. Run as written.
const purgeLine = () => /The purge is counted, not claimed\.\*\* At close, from the project root: `([^`]+)`/.exec(read(TRIO_COPIES[0]))[1];
const purgeFixture = (fn) =>
{
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm39-purge-'));
    const put = (rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), 'x'); };
    try { fn(dir, put); }
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
test('M39 the purge count counts the feature folder and a pre-2.1.6 run\'s flat notes, nothing else', { skip: process.platform === 'win32' }, () =>
{
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const cmd = purgeLine().replace(/<feature>/g, 'csv-export');
    purgeFixture((dir, put) =>
    {
        // A `find` first on PATH that is not the POSIX one (Windows' find.exe searches strings): it errors, so a
        // find-based count read 0 here.
        const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'm39-bin-'));
        fs.writeFileSync(path.join(bin, 'find'), '#!/bin/sh\necho "FIND: Parameter format not correct" >&2\nexit 2\n', { mode: 0o755 });
        const count = (pathDirs) =>
        {
            const env = { ...process.env, PATH: [...pathDirs, process.env.PATH].join(path.delimiter) };
            delete env.ALFRED_CODE_DATA_PATH;
            try { return execFileSync('bash', ['-c', cmd], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
            catch (err) { return String(err.stdout || '').trim(); }
        };
        try
        {
            assert.strictEqual(count([]), '0', 'no memories folder at all: none left');
            seedPurge(dir, put);
            assert.strictEqual(count([]), '4', 'three notes in the folder (the empty folder delete_memory leaves is none) and one flat 2.0.0 note');
            assert.strictEqual(count([bin]), '4', 'a foreign find first on PATH changes nothing');
        }
        finally { fs.rmSync(bin, { recursive: true, force: true }); }
    });
});

// Review B2: the count is plain node, so its logic runs the same on every platform - no shell, no find.
test('M39 the purge count\'s node program counts the same without a shell', () =>
{
    const { execFileSync } = require('node:child_process');
    const m = /^node -e "([^"]+)" <feature>$/.exec(purgeLine());
    assert.ok(m, 'the line is one node program with the feature as its argument');
    assert.doesNotMatch(m[1], /[$`!%^&<>]/, 'nothing a shell (bash, zsh, cmd, PowerShell) would expand inside the quotes');
    purgeFixture((dir, put) =>
    {
        seedPurge(dir, put);
        const env = { ...process.env };
        delete env.ALFRED_CODE_DATA_PATH;
        assert.strictEqual(execFileSync(process.execPath, ['-e', m[1], 'csv-export'], { cwd: dir, env, encoding: 'utf8' }).trim(), '4');
        fs.renameSync(path.join(dir, '.alfred'), path.join(dir, 'data'));
        assert.strictEqual(execFileSync(process.execPath, ['-e', m[1], 'csv-export'], { cwd: dir, env: { ...env, ALFRED_CODE_DATA_PATH: 'data' }, encoding: 'utf8' }).trim(), '4', 'the data root setting is followed');
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
    const rule = read('stack/skills/capture-agent-capabilities/references/generated-rule-template.md');
    for (const server of ['windows-desktop', 'macos-desktop'])
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

// M44: the memory ToolSearch line had two homes no pin tied together.
test('M44 the memory ToolSearch line is pinned across its homes', () =>
{
    const pin = JSON.parse(read('meta/shared-rules.json')).rules['memory-toolsearch-line'];
    assert.ok(pin, 'a memory-toolsearch-line pin');
    const line = 'ToolSearch select:mcp__plugin_alfred-memory_alfred-memory__memory_store,mcp__plugin_alfred-memory_alfred-memory__memory_search,mcp__plugin_alfred-memory_alfred-memory__memory_list';
    assert.strictEqual(pin.owner.file, 'stack/rules/alfred-memory.md');
    assert.strictEqual(pin.owner.marker, line);
    assert.deepStrictEqual(pin.sites.map((s) => [s.file, s.marker]), [['stack/hooks/memory-session.js', line]]);
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
    for (const file of ['stack/mcp/desktop-launch.js', 'stack/skills/capture-agent-capabilities/references/generated-rule-template.md'])
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
