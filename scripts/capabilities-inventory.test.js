// Behavior tests for the shipped capabilities script - written from the defects a 154-bundle audit
// of real sessions REPRODUCED in the stack's most-run skill (46 of 115 audited sessions). Each case
// pins one of them: a precheck that could never print empty, an inventory layer that was never
// listed, a count tallied by hand, a compare verdict the model improvised, an MCP row with no
// 'first call:', a frontmatter check that died on a missing PyYAML and reported green anyway.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'capture-agent-awareness', 'scripts', 'capabilities-inventory.js');
const SKILL_MD = path.join(__dirname, '..', 'stack', 'skills', 'capture-agent-awareness', 'SKILL.md');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilities-inventory-'));
// The CLI stubs are POSIX shell: a Windows run has no way to put a fake `claude` on PATH that
// `spawnSync(..., {shell:true})` would resolve, so those cases say so instead of passing blind.
const posixOnly = process.platform === 'win32' ? 'the CLI stub is a POSIX shell script' : false;

// Every file's mtime is pinned relative to this epoch: the precheck is a strictly-newer compare,
// and a suite that let the filesystem clock decide would pass or fail by scheduling.
const BASE = Math.floor(Date.now() / 1000) - 10_000;
const touch = (p, offset) => fs.utimesSync(p, BASE + offset, BASE + offset);

function write(p, text, offset)
{
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    if (offset !== undefined) touch(p, offset);
    return p;
}

// A stub `claude` on PATH - and PATH holds nothing else, so a real CLI on the machine can never
// answer instead (`claude mcp list` runs a health check; a suite must not pay it). The stub uses
// only shell builtins for the same reason: PATH carries no /bin either.
function stubCli(dir, { mcp = '', plugins = '[]' } = {})
{
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const fixture of [mcp, plugins]) assert.doesNotMatch(fixture, /'/, 'the stub single-quotes its fixtures');
    write(path.join(bin, 'claude'), `#!/bin/sh\ncase "$1 $2" in\n"mcp list") echo '${mcp}' ;;\n"plugin list") echo '${plugins}' ;;\nesac\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    return bin;
}

function run(args, { cwd, bin } = {})
{
    const env = { PATH: bin || path.join(TMP, 'empty-bin'), HOME: TMP };
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
fs.mkdirSync(path.join(TMP, 'empty-bin'), { recursive: true });

const skillFile = (name, { slashOnly = false, description = 'Does a thing. And then some more prose nobody needs in a router row.' } = {}) =>
    `---\nname: ${name}\ndescription: "${description}"\n${slashOnly ? 'disable-model-invocation: true\n' : ''}---\n\n# ${name}\n`;

// A project the way an installer leaves one: skills, seats, rules, .mcp.json, the stamp - and the
// generated rule written LAST, which is the state the precheck has to read as 'nothing to do'.
function project(name, opts = {})
{
    const root = path.join(TMP, name);
    for (const [dir, s] of Object.entries(opts.skills || { 'capture-agent-awareness': { slashOnly: true }, 'markdown-author': {} }))
    {
        write(path.join(root, '.claude', 'skills', dir, 'SKILL.md'), skillFile(dir, s), -100);
    }
    for (const seat of opts.seats || ['aspnet-implementer', 'aspnet-verifier', 'security-auditor'])
    {
        write(path.join(root, '.claude', 'agents', `${seat}.md`), `---\nname: ${seat}\n---\n\n# ${seat}\n`, -100);
    }
    write(path.join(root, '.claude', 'rules', 'alfred-navigation.md'), '---\n---\n\n# nav\n', -100);
    write(path.join(root, '.claude', 'rules', 'markdown-docs.md'), '---\npaths: ["**/*.md"]\n---\n\n# md\n', -100);
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'alfred-navigation': {}, 'alfred-documentation': {}, 'alfred-memory': {}, 'chrome-control': {} } }, null, 2), -100);
    write(path.join(root, '.claude', 'alfred-code.stamp'), 'sha: abcdef1234567890\nversion: 0.2.79\n', -100);
    if (opts.rule !== false) write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), opts.rule || '---\ndescription: generated\n---\n\n# This project\'s capabilities\n\nCaptured: 2026-09-01 from 0.2.79@abcdef1\n', 0);
    return root;
}

test('precheck: an untouched install prints empty, and a start DIRECTORY newer than the rule is not drift', { skip: posixOnly }, () =>
{
    const root = project('untouched');
    // The shell form listed the start directories themselves, whose mtime moves on every child
    // create or rename - the rule's own save included - so it printed drift in 26 of 26 runs.
    touch(path.join(root, '.claude', 'skills'), 500);
    touch(path.join(root, '.claude', 'rules'), 500);
    const { out } = run([], { cwd: root });
    assert.match(out, /PRECHECK:\s+empty - 0 files newer than the rule \(Captured: 2026-09-01[^)]*\)/);
    assert.doesNotMatch(out, /PRECHECK:\s+drift/);
});

test('precheck: a changed rule file is a COUNT before the first three names', { skip: posixOnly }, () =>
{
    const root = project('drifted');
    touch(path.join(root, '.claude', 'rules', 'markdown-docs.md'), 200);
    touch(path.join(root, '.claude', 'skills', 'markdown-author', 'SKILL.md'), 150);
    const { out } = run([], { cwd: root });
    assert.match(out, /PRECHECK:\s+drift - 2 file\(s\) newer than the rule/);
    assert.match(out, /\.claude\/rules\/markdown-docs\.md/);
    // newest first, so the head of the list is the real change and not whatever the walk saw first
    assert.ok(out.indexOf('markdown-docs.md') < out.indexOf('markdown-author/SKILL.md'), 'drift is sorted newest first');
});

test('precheck: no rule at all is the FIRST capture', { skip: posixOnly }, () =>
{
    const { out } = run([], { cwd: project('first-run', { rule: false }) });
    assert.match(out, /PRECHECK:\s+FIRST - no rule yet/);
});

test('inventory: every layer prints its own count, including the .claude/rules layer step 1 never listed', { skip: posixOnly }, () =>
{
    const root = project('inventory', {
        skills: {
            'capture-agent-awareness': { slashOnly: true, description: 'The deliberate capabilities capture. Use when the user asks to capture the project capabilities.' },
            'capture-architecture': { description: 'Captures the architecture. A long second sentence.' },
            'markdown-author': {},
        },
    });
    const bin = stubCli(path.join(TMP, 'inventory-cli'), {
        mcp: 'Checking MCP server health\n\nserena: uvx --from git+... serena start-mcp-server - ✔ Connected\ncontext7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected\nclaude.ai Notion: https://mcp.notion.com/mcp - ⊘ Disabled for this project',
        plugins: JSON.stringify([{ id: 'superpowers@x', enabled: true }, { id: 'claude-hud@y', enabled: false }, { id: 'elsewhere@z', enabled: true, projectPath: '/nowhere/else' }]),
    });
    const { out } = run([], { cwd: root, bin });

    assert.match(out, /SKILLS:\s+3 total, 2 orchestration \(1 model-invocable-by-design\)/);
    assert.match(out, /\/capture-agent-awareness - The deliberate capabilities capture$/m);
    assert.match(out, /\/capture-architecture - .*\(model-invocable-by-design\)/);
    assert.match(out, /SEATS:\s+3 total/);
    assert.match(out, /seat families \(1\): aspnet/);
    assert.match(out, /RULES:\s+3 total, 2 pathless, 1 path-scoped/);
    assert.match(out, /path-scoped: markdown-docs \[\*\*\/\*\.md\]/);
    assert.match(out, /MCP:\s+4 registered in \.mcp\.json, 0 from enabled plugins, 3 live in `claude mcp list`/);
    assert.doesNotMatch(out, /heavy native deps/, 'the stack ships no heavy-native-deps server since 2.0.0 - no flag left to raise');
    assert.match(out, /PLUGINS:\s+2 after dedupe/);
    assert.match(out, /claude-hud \(disabled\), superpowers \(enabled\)/, 'deduped and sorted, so the row is stable between runs');
    assert.doesNotMatch(out, /elsewhere/, 'a sibling repo\'s project-scoped plugin row is not this project\'s');
});

test('inventory: the MCP block is the LIVE list, not .mcp.json alone, and every routing row carries its first call', { skip: posixOnly }, () =>
{
    const root = project('live-mcp');
    const bin = stubCli(path.join(TMP, 'live-cli'), {
        // `Failed to connect` carries the word `connect`, so a connected-first test would report a
        // dead server as live - the one claim in this block nothing downstream can catch.
        mcp: 'alfred-navigation: cmd - ✔ Connected\nalfred-memory: uvx x - ✗ Failed to connect\nclaude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected',
    });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /alfred-memory\s+registered\s+live: failed/);
    // registered but NOT connected, and live but NOT registered - the two facts the file cannot give
    assert.match(out, /alfred-documentation\s+registered\s+live: not in the live list/);
    assert.match(out, /claude\.ai Notion\s+-\s+live: connected\s+\(reaches the session from the account or the harness/);
    const rows = out.split('\n').filter((l) => /^\s+- `/.test(l));
    // The locked three share one row pointing at the load line their baselines carry (audit I24).
    assert.equal(rows.length, 2, 'one routing row per registered server, the locked servers on one');
    for (const row of rows) assert.match(row, /first call: (`ToolSearch select:|the `ToolSearch select:` line its baseline names)/, `no first call: in ${row.slice(0, 60)}`);
});

test('inventory: a browser engine server gets the catalog row with its own registered name', { skip: posixOnly }, () =>
{
    const root = project('browser');
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'chrome-control': {} } }), -100);
    const { out } = run([], { cwd: root, bin: stubCli(path.join(TMP, 'pw-cli')) });
    assert.match(out, /chrome-control\s+registered .*routing: browser/);
    assert.match(out, /- `chrome-control` - the browser server \(Playwright MCP\): drive a browser/);
    // A .mcp.json server's tools are `mcp__<name>__<tool>` - the plugin spelling finds nothing there
    // (R63). The bare name is assembled here so lint check 54 never reads it as shipped text.
    const bare = `mcp_${'_chrome-control__'}`;
    assert.ok(out.includes(`${bare}browser_snapshot`), 'the catalog row is re-spelled for the registration');
    assert.doesNotMatch(out, /mcp__plugin_chrome-control_chrome-control__/);
});

// Every add-back line of the 2.0.0 MCP cut registers into .mcp.json, and those servers carry no
// catalog row - the fallback row is the one they get, so it must name the tools they really have.
test('inventory: a registered server with no catalog row gets its first call in the registration spelling', { skip: posixOnly }, () =>
{
    const root = project('addback');
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'angular-cli': {} } }), -100);
    const { out } = run([], { cwd: root, bin: stubCli(path.join(TMP, 'addback-cli')) });
    const row = out.split('\n').find((l) => /- `angular-cli` - routing: see project docs/.test(l));
    assert.ok(row, `no fallback row for angular-cli in:\n${out}`);
    assert.match(row, /first call: `ToolSearch select:` plus the `mcp__angular-cli__\*` names/); // mcp-fixture - a retired server's add-back registration spelling
    assert.doesNotMatch(row, /mcp__plugin_/);
});

test('inventory: a CLI that is not on PATH is `CLI absent`, never an empty plugin list', { skip: posixOnly }, () =>
{
    const { out } = run([], { cwd: project('no-cli') });
    assert.match(out, /PLUGINS:\s+CLI absent - OMIT the Plugins section/);
    assert.match(out, /live list unavailable - CLI absent/);
});

test('inventory: a plugin-covered install prints the plugin\'s layers, not an empty one', { skip: posixOnly }, () =>
{
    const root = project('plugin-only', { rule: false });
    fs.rmSync(path.join(root, '.claude', 'skills'), { recursive: true, force: true });
    fs.rmSync(path.join(root, '.claude', 'agents'), { recursive: true, force: true });
    const plugin = path.join(TMP, 'plugin-cache', 'house-stack', '1.0.0');
    write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'house-stack', version: '1.0.0' }));
    write(path.join(plugin, 'skills', 'task-solve-cross', 'SKILL.md'), skillFile('task-solve-cross', { slashOnly: true, description: 'The single entry-point orchestrator. More prose.' }));
    write(path.join(plugin, 'skills', 'markdown-author', 'SKILL.md'), skillFile('markdown-author'));
    write(path.join(plugin, 'agents', 'aspnet-implementer.md'), '---\nname: aspnet-implementer\n---\n');
    // a DISABLED plugin's skills are not live, and a stale cached version is not an install: the
    // roots are the enabled rows' own installPath, never a walk of the config dir.
    const stale = path.join(TMP, 'plugin-cache', 'house-stack', '0.9.0');
    write(path.join(stale, 'skills', 'retired-skill', 'SKILL.md'), skillFile('retired-skill'));
    const bin = stubCli(path.join(TMP, 'plugin-cli'), {
        plugins: JSON.stringify([
            { id: 'house-stack@demo', enabled: true, installPath: plugin },
            { id: 'off-stack@demo', enabled: false, installPath: stale },
        ]),
    });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /SOURCE:\s+PLUGIN-COVERED - 1 enabled plugin\(s\) carry 2 skill\(s\) and 1 seat\(s\), beside 0 skill\(s\) and 0 seat\(s\) copied under \.claude\/: house-stack/);
    assert.match(out, /SKILLS:\s+2 total, 1 orchestration/);
    assert.match(out, /\/task-solve-cross - The single entry-point orchestrator/);
    assert.match(out, /SEATS:\s+1 total/);
    assert.doesNotMatch(out, /retired-skill/, 'a disabled plugin and a stale cached version carry nothing');
});

// The delivery this release ships: the core plugin carries the always closure, `.claude/` keeps the LIBRARY picks.
// Two things went wrong before this case existed. The plugin branch fired only when the local dir
// was EMPTY, so a project holding 25 extras read 25 skills and never looked at the plugins. And the
// scan credited a plugin with everything in its cache, which for a SHARED repo root is every
// sibling's items too - measured at 860 seats where the truth is 43, and a hooks-only entry
// claiming all of them.
test('inventory: extras and plugin-carried items are UNIONED, and a shared root counts only its own entry', { skip: posixOnly }, () =>
{
    const root = project('extras-plus-plugins', { rule: false });
    fs.rmSync(path.join(root, '.claude', 'skills'), { recursive: true, force: true });
    fs.rmSync(path.join(root, '.claude', 'agents'), { recursive: true, force: true });
    write(path.join(root, '.claude', 'skills', 'angular-material', 'SKILL.md'), skillFile('angular-material'));
    write(path.join(root, '.claude', 'agents', 'related-project-analyzer.md'), '---\nname: related-project-analyzer\n---\n');
    // ONE shared root, two entries: a stack entry that ships one skill and one seat, and a
    // hooks-only entry that ships neither. Both caches hold the whole tree.
    const shared = path.join(TMP, 'shared-cache');
    write(path.join(shared, 'stack', 'skills', 'dotnet-wpf', 'SKILL.md'), skillFile('dotnet-wpf'));
    write(path.join(shared, 'stack', 'skills', 'markdown-style', 'SKILL.md'), skillFile('markdown-style'));
    write(path.join(shared, 'stack', 'agents', 'wpf-implementer.md'), '---\nname: wpf-implementer\n---\n');
    write(path.join(shared, 'stack', 'agents', 'aspnet-verifier.md'), '---\nname: aspnet-verifier\n---\n');
    write(path.join(shared, '.claude-plugin', 'marketplace.json'), JSON.stringify({
        name: 'house', plugins: [
            { name: 'house-wpf', source: './', skills: ['./stack/skills/dotnet-wpf'], agents: ['./stack/agents/wpf-implementer.md'] },
            { name: 'house-hooks', source: './' },
        ],
    }));
    const bin = stubCli(path.join(TMP, 'shared-cli'), {
        plugins: JSON.stringify([
            { id: 'house-wpf@house', enabled: true, installPath: shared },
            { id: 'house-hooks@house', enabled: true, installPath: shared },
        ]),
    });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /SOURCE:\s+PLUGIN-COVERED - 1 enabled plugin\(s\) carry 1 skill\(s\) and 1 seat\(s\), beside 1 skill\(s\) and 1 seat\(s\) copied under \.claude\/: house-wpf/);
    assert.match(out, /SKILLS:\s+2 total/, 'the extra plus the one the entry ships');
    assert.match(out, /SEATS:\s+2 total/);
    assert.match(out, /house-wpf:wpf-implementer/, 'a plugin seat carries its dispatch prefix');
    assert.match(out, /related-project-analyzer/, 'a copied extra keeps its bare name');
    assert.doesNotMatch(out, /markdown-style/, 'a sibling entry\'s skill sitting in the same cache is not this one\'s');
    assert.doesNotMatch(out, /aspnet-verifier/, 'and neither is its seat');
});

// 2.1.0: the core carries every seat and the project denies each one it did not pick - a seat
// `permissions.deny` names is not in the listing (spike S3) and fails at dispatch, so the generated
// rule must not route to it. Denies merge across the account, project and local files.
test('inventory: a seat permissions.deny names is left out of the SEATS line - any settings file', { skip: posixOnly }, () =>
{
    const root = project('denied-seats', { rule: false });
    fs.rmSync(path.join(root, '.claude', 'agents'), { recursive: true, force: true });
    const cache = path.join(TMP, 'core-cache');
    for (const seat of ['aspnet-implementer', 'web-angular-implementer', 'security-auditor', 'evidence-gatherer'])
        write(path.join(cache, 'stack', 'agents', `${seat}.md`), `---\nname: ${seat}\n---\n`);
    write(path.join(cache, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'envoydev', plugins: [
        { name: 'alfred-code', source: './', skills: [], agents: ['./stack/agents/aspnet-implementer.md', './stack/agents/web-angular-implementer.md', './stack/agents/security-auditor.md', './stack/agents/evidence-gatherer.md'] },
    ] }));
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:web-angular-implementer)', 'Read(.env)'] } }));
    write(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:evidence-gatherer)'] } }));
    write(path.join(TMP, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Agent(alfred-code:security-auditor)'] } }));
    const bin = stubCli(path.join(TMP, 'denied-cli'), { plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, installPath: cache }]) });
    try
    {
        const { out } = run([], { cwd: root, bin });
        assert.match(out, /SEATS:\s+1 total \(3 denied in permissions\.deny, left out\)/, out);
        assert.match(out, /^\s+alfred-code:aspnet-implementer$/m, out);
        for (const seat of ['web-angular-implementer', 'evidence-gatherer', 'security-auditor'])
            assert.doesNotMatch(out, new RegExp(`alfred-code:${seat}(,|$)`, 'm'), `${seat} is denied`);
    }
    finally { fs.rmSync(path.join(TMP, '.claude'), { recursive: true, force: true }); }
});

// I4: a seat the project keeps as its own copy (tuned or edited) is the one a flow should run - by its bare name.
// Listed beside the core's twin, the roster would offer both and a flow could dispatch the core's pins.
test('inventory: a project seat copy wins its name over the core\'s twin, as a copied skill does', { skip: posixOnly }, () =>
{
    const root = project('kept-seat', { rule: false });
    fs.rmSync(path.join(root, '.claude', 'agents'), { recursive: true, force: true });
    write(path.join(root, '.claude', 'agents', 'aspnet-implementer.md'), '---\nname: aspnet-implementer\nmodel: opus\n---\n');
    const cache = path.join(TMP, 'kept-core-cache');
    for (const seat of ['aspnet-implementer', 'aspnet-verifier'])
        write(path.join(cache, 'stack', 'agents', `${seat}.md`), `---\nname: ${seat}\n---\n`);
    write(path.join(cache, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'envoydev', plugins: [
        { name: 'alfred-code', source: './', skills: [], agents: ['./stack/agents/aspnet-implementer.md', './stack/agents/aspnet-verifier.md'] },
    ] }));
    const bin = stubCli(path.join(TMP, 'kept-cli'), { plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, installPath: cache }]) });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /^\s+alfred-code:aspnet-verifier, aspnet-implementer$/m, out);
    assert.doesNotMatch(out, /alfred-code:aspnet-implementer/, out);
});

test('inventory: no local dirs and no plugin carrying them is a STOP, not an empty rule', { skip: posixOnly }, () =>
{
    const root = project('nothing-at-all', { rule: false });
    fs.rmSync(path.join(root, '.claude', 'skills'), { recursive: true, force: true });
    fs.rmSync(path.join(root, '.claude', 'agents'), { recursive: true, force: true });
    const { out } = run([], { cwd: root });
    assert.match(out, /SOURCE:\s+no local \.claude\/skills or \.claude\/agents and the CLI is absent.*say so and STOP/);
    assert.match(out, /SKILLS:\s+0 total/);
});

test('compare: an identical body is `identical - DO NOT WRITE`, a changed one names the sections', { skip: posixOnly }, () =>
{
    const body = '---\ndescription: generated\n---\n\n# This project\'s capabilities\n\nCaptured: 2026-09-01 from 0.2.79@abcdef1\n\n## Subagent seats\naspnet-implementer\n';
    const root = project('compare', { rule: body });
    const same = write(path.join(TMP, 'body-same.md'), body);
    const identical = run(['--body', same], { cwd: root });
    assert.equal(identical.status, 0);
    assert.match(identical.out, /COMPARE:\s+identical - DO NOT WRITE \(\d+ bytes\)/);

    const changed = write(path.join(TMP, 'body-changed.md'), body.replace('aspnet-implementer', 'aspnet-implementer, aspnet-verifier'));
    const differs = run(['--body', changed], { cwd: root });
    assert.equal(differs.status, 0);
    assert.match(differs.out, /COMPARE:\s+differs - WRITE \.claude\/rules\/alfred-agent-awareness\.md in ONE call/);
    assert.match(differs.out, /sections changed: ## Subagent seats/);
});

test('compare: a body differing only in its Captured date is identical, so a later day does not rewrite the rule', { skip: posixOnly }, () =>
{
    const body = '---\ndescription: generated\n---\n\n# x\n\nCaptured: 2026-09-01 from 0.2.79@abcdef1\n\n## Subagent seats\naspnet-implementer\n';
    const root = project('compare-captured', { rule: body });
    const later = write(path.join(TMP, 'body-later.md'), body.replace('2026-09-01', '2026-10-05'));
    assert.match(run(['--body', later], { cwd: root }).out, /COMPARE:\s+identical - DO NOT WRITE/);
    const moved = write(path.join(TMP, 'body-later-changed.md'), body.replace('2026-09-01', '2026-10-05').replace('aspnet-implementer', 'aspnet-verifier'));
    assert.match(run(['--body', moved], { cwd: root }).out, /COMPARE:\s+differs - WRITE/);
});

test('compare: no rule yet is a write, and trailing-newline drift alone is not', { skip: posixOnly }, () =>
{
    const body = '---\ndescription: generated\n---\n\n# x\n';
    assert.match(run(['--body', write(path.join(TMP, 'body-first.md'), body)], { cwd: project('compare-first', { rule: false }) }).out, /COMPARE:\s+differs - no rule yet, WRITE/);
    assert.match(run(['--body', write(path.join(TMP, 'body-nl.md'), `${body}\n\n`)], { cwd: project('compare-nl', { rule: body }) }).out, /COMPARE:\s+identical/);
});

// The written rule has to carry the policy block VERBATIM, so the fixtures build it from the
// skill's own copy - a policy edit moves both sides at once and never silently rots this suite.
function policyFrom(skillText, docsRoot)
{
    const lines = skillText.split('\n');
    const at = lines.findIndex((l) => /<!--\s*policy-rev:/.test(l));
    const body = [];
    for (let i = at + 1; i < lines.length; i++)
    {
        if (/^#{1,6} /.test(lines[i]) || /^```/.test(lines[i])) break;
        body.push(lines[i]);
    }
    return [lines[at], ...body].join('\n').split('<docs-path>').join(docsRoot);
}

const validRule = (docsRoot = '.alfred/docs') => [
    '---',
    'description: Project capabilities awareness - generated by /capture-agent-awareness; edit via a re-run, not by hand.',
    '---',
    '',
    '# This project\'s capabilities',
    '',
    'Captured: 2026-09-22 from 0.2.79@abcdef1',
    '',
    '## Usage policy (fixed - stamped verbatim, every run)',
    policyFrom(fs.readFileSync(SKILL_MD, 'utf8'), docsRoot),
    '',
    '## Orchestration skills (slash-only - invisible until invoked)',
    '/capture-agent-awareness - The deliberate capabilities capture',
    '',
    '## Subagent seats',
    'aspnet-implementer, aspnet-verifier',
    '',
    '## MCP routing',
    '- `serena` - symbol navigator. first call: `ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__find_symbol`.',
    '- `context7` - docs. first call: `ToolSearch select:mcp__plugin_alfred-documentation_alfred-documentation__query-docs`.',
    '',
    '## Plugins',
    'superpowers (enabled)',
    '',
].join('\n');

test('--verify: a well-formed rule passes, parsed by node and never by PyYAML', { skip: posixOnly }, () =>
{
    const root = project('verify-ok');
    const rule = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), validRule());
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /frontmatter:\s+ok - parsed by node/);
    assert.match(out, /policy-rev:\s+ok/);
    assert.match(out, /policy block:\s+ok/);
    assert.match(out, /mcp rows:\s+ok - 2 of 2 carry their 'first call:' line/);
    assert.match(out, /VERIFY:\s+PASS/);
    assert.equal(status, 0, out);
});

test('--verify: broken frontmatter exits non-zero and says which line broke it', { skip: posixOnly }, () =>
{
    const root = project('verify-fm');
    const rule = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), validRule().replace('---\n\n# This project', '\n\n# This project'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /frontmatter:\s+FAIL/);
    assert.match(out, /VERIFY:\s+FAIL/);
    assert.equal(status, 1, out);
});

test('--verify: a `paths:` key makes the pathless rule a scoped one, and fails', { skip: posixOnly }, () =>
{
    const root = project('verify-paths');
    const rule = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), validRule().replace('description: Project', 'paths: ["**/*.md"]\ndescription: Project'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /paths key:\s+FAIL - present/);
    assert.equal(status, 1, out);
});

test('--verify: an MCP row with no `first call:` exits non-zero and names the server', { skip: posixOnly }, () =>
{
    const root = project('verify-mcp');
    const rule = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'),
        validRule().replace('- `context7` - docs. first call: `ToolSearch select:mcp__plugin_alfred-documentation_alfred-documentation__query-docs`.', '- `playwright` - browser checks, only for that target.'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /mcp rows:\s+FAIL - 1 of 2 carry no 'first call:' - playwright/);
    assert.match(out, /VERIFY:\s+FAIL \(1 check/);
    assert.equal(status, 1, out);
});

test('--verify: a hand-edited policy block fails, and a resolved <docs-path> does not', { skip: posixOnly }, () =>
{
    const root = project('verify-policy');
    const edited = validRule().replace('never to answer a question', 'never to answer questions');
    assert.notStrictEqual(edited, validRule(), 'the fixture edit landed on a sentence the policy block still carries');
    const ruleA = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), edited);
    assert.match(run(['--verify', ruleA], { cwd: root }).out, /policy block:\s+FAIL - differs from the skill at line \d+/);

    // the one slot that is not a slot: `<docs-path>` resolved to this project's docs root
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/ai' } }), -100);
    const ruleB = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), validRule('docs/ai'));
    const { status, out } = run(['--verify', ruleB], { cwd: root });
    assert.match(out, /policy block:\s+ok - \d+ lines, verbatim from the skill \(`<docs-path>` resolved to docs\/ai\)/);
    assert.equal(status, 0, out);
});

test('--verify: a missing rule file fails rather than reporting a green check it never ran', { skip: posixOnly }, () =>
{
    const root = project('verify-absent');
    const { status, out } = run(['--verify', path.join(root, 'nowhere.md')], { cwd: root });
    assert.match(out, /file:\s+FAIL - absent or empty/);
    assert.equal(status, 1);
});

test('report: the docs root is resolved and printed, so `<docs-path>` is never left in the rule', { skip: posixOnly }, () =>
{
    const root = project('docs-root');
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/ai' } }), -100);
    const { out } = run([], { cwd: root });
    assert.match(out, /DOCS ROOT: docs\/ai\s+\(from ALFRED_CODE_DOCS_PATH in \.claude\/settings\.json env\)/);
    assert.match(out, /CAPTURED:\s+\d{4}-\d{2}-\d{2} from 0\.2\.79@abcdef1/);
    assert.match(out, /COMPARE:\s+no verdict yet/);
});

// Every update rewrites the stamp, a no-op one included: a newer stamp alone read as drift after each update, and
// the full compose that followed came out identical. The stamp's revision against the rule's `Captured: ... from`
// value decides; any other newer file is still drift beside it.
test('precheck: a stamp rewritten at the captured revision is not drift; a new revision, no revision or another file is', { skip: posixOnly }, () =>
{
    const root = project('stamp-same-rev');
    const stamp = path.join(root, '.claude', 'alfred-code.stamp');
    write(stamp, 'sha: abcdef1234567890\nversion: 0.2.79\nwritten: later\n', 300);
    const same = run([], { cwd: root }).out;
    assert.match(same, /PRECHECK:\s+empty - 0 files newer than the rule \(Captured: 2026-09-01 from 0\.2\.79@abcdef1; a stamp rewrite at the same revision 0\.2\.79@abcdef1 is not drift\)/);

    write(stamp, 'sha: abcdef1234567890\nversion: 0.2.80\n', 300);
    assert.match(run([], { cwd: root }).out, /PRECHECK:\s+drift - 1 file\(s\)[\s\S]*alfred-code\.stamp/, 'a new version is drift');

    write(stamp, 'sha: 9999999aaaaaaa\nversion: 0.2.79\n', 300);
    assert.match(run([], { cwd: root }).out, /PRECHECK:\s+drift - 1 file\(s\)/, 'a new commit at the same version is drift');

    write(stamp, 'nothing: here\n', 300);
    assert.match(run([], { cwd: root }).out, /PRECHECK:\s+drift - 1 file\(s\)/, 'a stamp with no revision cannot prove it is the same');

    write(stamp, 'sha: abcdef1234567890\nversion: 0.2.79\n', 300);
    touch(path.join(root, '.claude', 'rules', 'markdown-docs.md'), 200);
    const both = run([], { cwd: root }).out;
    assert.match(both, /PRECHECK:\s+drift - 2 file\(s\)/, 'the stamp is not dropped when another file moved too');

    const noFrom = project('stamp-no-from', { rule: '---\ndescription: generated\n---\n\nCaptured: 2026-09-01\n' });
    touch(path.join(noFrom, '.claude', 'alfred-code.stamp'), 300);
    assert.match(run([], { cwd: noFrom }).out, /PRECHECK:\s+drift - 1 file\(s\)/, 'a rule that recorded no revision stays drift');
});

test('report: an unreadable skill frontmatter is reported as unreadable, never filled from memory', { skip: posixOnly }, () =>
{
    const root = project('unreadable');
    write(path.join(root, '.claude', 'skills', 'broken', 'SKILL.md'), '---\nname: broken\ndescription: x\n\n# no closing fence\n', -100);
    const { out } = run([], { cwd: root });
    assert.match(out, /UNREADABLE broken: no closing `---`/);
});

// Pilot 2 (2026-09-27): on the plugin route no server sits in .mcp.json, so the routing block came out
// empty, the rule said 'None registered in .mcp.json', and the model made 0 MCP calls in 12 cells.
// A plugin-provided server reaches the session under `mcp__plugin_<plugin>_<server>__` - it gets the
// same row a registration gets, in that spelling.
const routingRows = (out) => out.split('\n').filter((l) => /^\s+- `/.test(l)).map((l) => l.trim());
const PLUGIN_LIST = JSON.stringify([
    { id: 'alfred-code@envoydev', enabled: true },
    { id: 'alfred-navigation@envoydev', enabled: true, mcpServers: { 'alfred-navigation': {} } },
    { id: 'alfred-documentation@envoydev', enabled: true, mcpServers: { 'alfred-documentation': {} } },
    { id: 'alfred-memory@envoydev', enabled: true, mcpServers: { 'alfred-memory': {} } },
    { id: 'chrome-control@envoydev', enabled: true, mcpServers: { 'chrome-control': {} } },
    { id: 'firefox-control@envoydev', enabled: false, mcpServers: { 'firefox-control': {} } },
    { id: 'windows-control@envoydev', enabled: true, mcpServers: { 'windows-control': {} }, projectPath: '/nowhere/else' },
    { id: 'csharp-lsp@claude-plugins-official', enabled: true },
]);

test('inventory: every server an enabled plugin provides gets its routing row in the plugin spelling', { skip: posixOnly }, () =>
{
    const root = project('plugin-mcp');
    fs.rmSync(path.join(root, '.mcp.json'));
    const bin = stubCli(path.join(TMP, 'plugin-mcp-cli'), {
        mcp: 'plugin:alfred-navigation:alfred-navigation: uvx x - ✔ Connected\nplugin:alfred-memory:alfred-memory: uvx y - ✗ Failed to connect',
        plugins: PLUGIN_LIST,
    });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /MCP:\s+0 registered in \.mcp\.json \(no \.mcp\.json\), 4 from enabled plugins/);
    assert.match(out, /alfred-navigation\s+plugin\s+live: connected\s+from alfred-navigation/);
    assert.match(out, /alfred-memory\s+plugin\s+live: failed/);
    assert.match(out, /alfred-documentation\s+plugin\s+live: not in the live list/);
    assert.doesNotMatch(out, /plugin:alfred-navigation:alfred-navigation.*reaches the session from the account or the harness/, 'a plugin server is not an account connector');
    const rows = routingRows(out);
    assert.deepStrictEqual(rows.map((r) => /^- ((?:`[^`]+`(?:, )?)+) - /.exec(r)[1]), ['`alfred-navigation`, `alfred-documentation`, `alfred-memory`', '`chrome-control`'],
        'one row per enabled plugin server, the locked ones on one - never a disabled one, another project\'s, or a plugin with no server');
    assert.match(rows[1], /first call: `ToolSearch select:mcp__plugin_chrome-control_chrome-control__browser_snapshot/, 'plugin spelling');
    assert.match(rows[0], /first call: the `ToolSearch select:` line its baseline names/, 'the locked row points at the baselines\' load lines');
});

test('inventory: with no CLI, the project settings enabledPlugins name the plugin servers', { skip: posixOnly }, () =>
{
    const root = project('plugin-settings');
    fs.rmSync(path.join(root, '.mcp.json'));
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'alfred-navigation@envoydev': true, 'alfred-memory@envoydev': true, 'csharp-lsp@claude-plugins-official': true, 'alfred-code@envoydev': true } }), -100);
    write(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'alfred-memory@envoydev': false } }), -100);
    const { out } = run([], { cwd: root });
    assert.match(out, /live list unavailable - CLI absent/);
    assert.deepStrictEqual(routingRows(out).map((r) => /^- ((?:`[^`]+`(?:, )?)+) - /.exec(r)[1]), ['`alfred-navigation`'], 'settings.local.json switches memory off; the core and the LSP carry no server');
    assert.match(routingRows(out)[0], /first call: the `ToolSearch select:` line its baseline names/);
});

test('inventory: a registered server keeps its own row, and a third-party plugin server is spelled by its plugin', { skip: posixOnly }, () =>
{
    const root = project('plugin-both');
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'alfred-navigation': {} } }), -100);
    const bin = stubCli(path.join(TMP, 'plugin-both-cli'), {
        plugins: JSON.stringify([
            { id: 'alfred-navigation@envoydev', enabled: true, mcpServers: { 'alfred-navigation': {} } },
            { id: 'acme-tools@acme', enabled: true, mcpServers: { tracker: {} } },
        ]),
    });
    const rows = routingRows(run([], { cwd: root, bin }).out);
    assert.deepStrictEqual(rows.map((r) => /^- `([^`]+)`/.exec(r)[1]), ['alfred-navigation', 'tracker'], 'one row per server name');
    assert.doesNotMatch(rows[0], /mcp__plugin_/, 'the registration wins its name and keeps its own spelling');
    assert.match(rows[1], /routing: see project docs\. first call: `ToolSearch select:` plus the `mcp__plugin_acme-tools_tracker__\*` names/); // mcp-fixture
});

test('--verify: a rule built from plugin-provided rows passes', { skip: posixOnly }, () =>
{
    const root = project('plugin-verify');
    fs.rmSync(path.join(root, '.mcp.json'));
    const bin = stubCli(path.join(TMP, 'plugin-verify-cli'), { plugins: PLUGIN_LIST });
    const rows = routingRows(run([], { cwd: root, bin }).out);
    const rule = write(path.join(root, 'composed.md'), validRule().replace(/## MCP routing\n[\s\S]*?\n\n/, `## MCP routing\n${rows.join('\n')}\n\n`));
    const r = run(['--verify', rule], { cwd: root, bin });
    assert.match(r.out, /mcp rows:\s+ok - 2 of 2 carry their 'first call:' line/);
});

// Pilot 2 (2026-09-27): init's capture wrote its composed body to the session temp dir with the Write
// tool, which print mode refused ('you haven't granted it yet'); it recovered through a heredoc and
// emitted the body twice. The body goes under the docs root's flow/ folder instead - inside the project,
// where acceptEdits lets the Write land, and out of git through the docs root's own .gitignore.
// Audit 2026-10-10 (C06, session b91d6135): the read-template, compose, compare and write turns copied the script's own
// lines by hand - ~281k of 467k context tokens - and the report hand-summed three MCP figures into one. --write does it
// all from the skill's copy target, and the report's Inventory line is printed ready-made.
test('report: the plain inventory writes nothing and points at --write; the skill runs --write and composes nothing', { skip: posixOnly }, () =>
{
    const root = project('body-path');
    const before = fs.readFileSync(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), 'utf8');
    assert.match(run([], { cwd: root }).out, /COMPARE:\s+no verdict yet - `--write` composes the rule from these lines/);
    assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), 'utf8'), before, 'the plain run writes nothing');
    const skill = fs.readFileSync(SKILL_MD, 'utf8');
    assert.match(skill, /node "\$CAPS" --write\n```/, 'the resolve block runs the whole capture');
    assert.doesNotMatch(skill, /compose the\s+WHOLE body in-session/, 'no in-session compose');
    assert.doesNotMatch(skill, /capabilities-body\.md/, 'no hand-composed body file');
    assert.doesNotMatch(skill, /delete it in the same run\./, 'the legacy rule is the script\'s to remove');
});

const RULE = (root) => path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md');
const reportLines = (out) => Object.fromEntries(out.split('\n').filter((l) => /^(Rule|Verify|Inventory|Drift): {2,}/.test(l)).map((l) => [l.split(':')[0], l.replace(/^\w+:\s+/, '')]));

test('--write: a first capture composes the rule from the copy target, verifies it and prints the report lines', { skip: posixOnly }, () =>
{
    const root = project('write-first', { rule: false });
    const plain = run([], { cwd: root }).out;
    const r = run(['--write'], { cwd: root });
    assert.strictEqual(r.status, 0, r.out);
    const rule = fs.readFileSync(RULE(root), 'utf8');
    assert.match(r.out, /COMPARE:\s+differs - no rule yet, WRITTEN \.claude\/rules\/alfred-agent-awareness\.md \(\d+ bytes\)/);
    assert.match(r.out, /VERIFY:\s+PASS/);
    assert.doesNotMatch(rule, /<the script's|<docs-path>|<data root>/, 'every slot filled');
    assert.match(rule, /^Captured: \d{4}-\d{2}-\d{2} from 0\.2\.79@abcdef1$/m);
    assert.ok(rule.includes(policyFrom(fs.readFileSync(SKILL_MD, 'utf8'), '.alfred/docs')), 'the policy block, stamp included, verbatim');
    assert.match(rule, /^## Orchestration skills.*\n\/capture-agent-awareness - Does a thing$/m, 'the printed orchestration row');
    assert.match(rule, /^## Subagent seats\naspnet-implementer, aspnet-verifier, security-auditor$/m, 'the printed SEATS line');
    for (const row of routingRows(plain)) assert.ok(rule.includes(row), `the printed routing row: ${row.slice(0, 60)}`);
    assert.doesNotMatch(rule, /^## Plugins/m, 'the CLI is absent, so no Plugins section');
    const rep = reportLines(r.out);
    assert.match(rep.Rule, /^created - \d+ bytes$/);
    assert.strictEqual(rep.Verify, 'PASS');
    assert.strictEqual(rep.Inventory, 'skills 2 / seats 3 / rules 2 / MCP 4 (4 in .mcp.json + 0 from plugins; live list unavailable) / plugins CLI absent');
    assert.strictEqual(rep.Drift, 'first capture - no rule before this run');

    // A re-run over the rule it wrote is identical, and leaves the file alone - its mtime included.
    touch(RULE(root), 0);
    const again = run(['--write'], { cwd: root });
    assert.match(again.out, /COMPARE:\s+identical - not rewritten/);
    assert.match(reportLines(again.out).Rule, /^unchanged, not rewritten - \d+ bytes$/);
    assert.strictEqual(reportLines(again.out).Verify, 'not run - nothing written');
    assert.strictEqual(fs.statSync(RULE(root)).mtimeMs, (BASE + 0) * 1000, 'not rewritten');
    assert.strictEqual(fs.readFileSync(RULE(root), 'utf8'), rule);
});

test('--write: with the CLI, the Plugins section and the plugin counts come off the printed lines', { skip: posixOnly }, () =>
{
    const root = project('write-cli', { rule: false });
    const bin = stubCli(path.join(TMP, 'write-cli-bin'), {
        mcp: 'context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected',
        plugins: JSON.stringify([{ id: 'superpowers@x', enabled: true }, { id: 'claude-hud@y', enabled: false }]),
    });
    const r = run(['--write'], { cwd: root, bin });
    assert.strictEqual(r.status, 0, r.out);
    assert.match(fs.readFileSync(RULE(root), 'utf8'), /^## Plugins\nclaude-hud \(disabled\), superpowers \(enabled\)\n$/m);
    assert.strictEqual(reportLines(r.out).Inventory, 'skills 2 / seats 3 / rules 2 / MCP 4 (4 in .mcp.json + 0 from plugins; 1 live) / plugins 2');
});

test('--write: an empty precheck writes only under --refresh; drift writes and names the changed sections', { skip: posixOnly }, () =>
{
    const root = project('write-refresh');
    const stub = fs.readFileSync(RULE(root), 'utf8');
    const held = run(['--write'], { cwd: root });
    assert.match(held.out, /PRECHECK:\s+empty/);
    assert.match(held.out, /COMPARE:\s+differs \(sections changed: .*## Subagent seats.*\) - NOT WRITTEN: the precheck is empty/);
    assert.strictEqual(fs.readFileSync(RULE(root), 'utf8'), stub, 'nothing written without --refresh');
    assert.match(reportLines(held.out).Rule, /\(precheck empty\)$/);
    assert.strictEqual(reportLines(held.out).Drift, 'none - PRECHECK empty');

    const refreshed = run(['--write', '--refresh'], { cwd: root });
    assert.match(refreshed.out, /COMPARE:\s+differs - WRITTEN .*the whole file .*sections changed: /);
    assert.match(reportLines(refreshed.out).Rule, /^refreshed - \d+ bytes$/);
    assert.strictEqual(reportLines(refreshed.out).Drift, 'none in the tree - a --refresh run');
    assert.strictEqual(refreshed.status, 0, refreshed.out);

    // A seat added after the capture is drift: written without --refresh.
    touch(RULE(root), 0);
    write(path.join(root, '.claude', 'agents', 'data-verifier.md'), '---\nname: data-verifier\n---\n', 500);
    const drift = run(['--write'], { cwd: root });
    assert.match(drift.out, /COMPARE:\s+differs - WRITTEN .*sections changed: ## Subagent seats$/m);
    assert.match(reportLines(drift.out).Drift, /^1 file\(s\): \.claude\/agents\/data-verifier\.md$/);
    assert.match(fs.readFileSync(RULE(root), 'utf8'), /^aspnet-implementer, aspnet-verifier, data-verifier, security-auditor$/m);
});

test('--write: the legacy 1.x rule is removed in the same run, and no source is a refusal that writes nothing', { skip: posixOnly }, () =>
{
    const root = project('write-legacy', { rule: false });
    const legacy = write(path.join(root, '.claude', 'rules', 'baseline-project-capabilities.md'), '# old\n', -100);
    const r = run(['--write'], { cwd: root });
    assert.match(r.out, /LEGACY:\s+removed \.claude\/rules\/baseline-project-capabilities\.md/);
    assert.ok(!fs.existsSync(legacy));
    assert.doesNotMatch(run(['--write'], { cwd: root }).out, /LEGACY:/, 'nothing to remove, no line');

    const empty = project('write-nothing');
    const stub = fs.readFileSync(RULE(empty), 'utf8');
    fs.rmSync(path.join(empty, '.claude', 'skills'), { recursive: true, force: true });
    fs.rmSync(path.join(empty, '.claude', 'agents'), { recursive: true, force: true });
    const refused = run(['--write', '--refresh'], { cwd: empty });
    assert.strictEqual(refused.status, 1);
    assert.match(refused.out, /WRITE:\s+refused - no local skills or seats/);
    assert.strictEqual(fs.readFileSync(RULE(empty), 'utf8'), stub, 'a good rule is never replaced by an empty one');
});

test('--write: a copy target with a slot the script does not fill writes nothing', { skip: posixOnly }, () =>
{
    // The script reads the SKILL.md beside it, so a copied skill dir with an extra slot stands in for a broken release.
    const dir = path.join(TMP, 'broken-skill');
    fs.cpSync(path.dirname(SKILL_MD), dir, { recursive: true });
    const md = path.join(dir, 'SKILL.md');
    fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('## MCP routing\n', '## MCP routing\n<the script\'s NEW slot>\n'));
    const root = project('write-broken', { rule: false });
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'capabilities-inventory.js'), '--write'], { cwd: root, encoding: 'utf8', env: { PATH: path.join(TMP, 'empty-bin'), HOME: TMP } });
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /COMPOSE:\s+FAIL - the copy target holds a slot this script does not fill: <the script's NEW slot>/);
    assert.ok(!fs.existsSync(RULE(root)), 'nothing written');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// 2.1.5 audit M74: 'never to answer a question' told a user asking 'what is our C# convention for X'
// that the convention skill was not for them - the convention rules call it the source of truth.
test('policy: a skill is not loaded only for a question the code or the conversation already answers (M74)', () =>
{
    const skill = fs.readFileSync(SKILL_MD, 'utf8').replace(/\s+/g, ' ');
    assert.ok(skill.includes('never to answer a question the code or the conversation already answers'), 'the policy line');
    assert.ok(!/never to answer a question\.\s/.test(skill), 'the unqualified form is gone');
});

// Audit 2026-10-11 SD07 (sessions 7be545ce, ce9d4811, both Windows): the Plugins line dropped a plugin the project enables
// (a case-exact projectPath compare) and stamped another `enabled` while the CLI listed it disabled (the first row that
// passed the filter decided) - both into the always-on rule, both through --verify. These run on EVERY OS: the input is
// the Windows shape itself, never a POSIX stand-in.
const CI = require(SCRIPT);

test('SD07 7be545ce#1: a Windows projectPath is this project whatever its drive or folder case and separators', () =>
{
    const rows = CI.parsePluginList(JSON.stringify([
        { id: 'csharp-lsp@claude-plugins-official', scope: 'project', enabled: true, projectPath: 'c:\\Users\\dev\\Source\\App' },
        { id: 'csharp-lsp@claude-plugins-official', scope: 'project', enabled: false, projectPath: 'C:\\Users\\dev\\Source\\Other' },
        { id: 'csharp-lsp@claude-plugins-official', scope: 'project', enabled: false, projectPath: 'C:\\Users\\dev\\Source\\Third' },
        { id: 'claude-hud@claude-hud', scope: 'user', enabled: true },
    ]), 'C:/Users/Dev/source/app/');
    assert.deepStrictEqual(rows.map((r) => [r.name, r.state, r.skipped]), [['claude-hud', 'enabled', 0], ['csharp-lsp', 'enabled', 2]]);
    assert.strictEqual(CI.projectKey('c:\\Users\\dev\\Source\\App'), CI.projectKey('C:/Users/Dev/source/app/'));
    assert.notStrictEqual(CI.projectKey('/Repo'), CI.projectKey('/repo'), 'a POSIX path keeps its case: another case is another folder there');
});

test('SD07 ce9d4811#2: the narrowest row decides, and an `enabled` that is no boolean is no answer', () =>
{
    const rows = CI.parsePluginList(JSON.stringify([
        { id: 'csharp-lsp@claude-plugins-official', scope: 'user', enabled: true },
        { id: 'csharp-lsp@claude-plugins-official', scope: 'project', enabled: false, projectPath: 'C:\\Work\\App' },
        { id: 'odd@m', scope: 'project', projectPath: 'C:\\Work\\App' },
    ]), 'C:\\Work\\App');
    assert.deepStrictEqual(rows.map((r) => [r.name, r.state, r.scope]), [['csharp-lsp', 'disabled', 'project'], ['odd', 'unclear', 'project']]);
});

test('SD07 7be545ce#1 ce9d4811#2: the settings cross-check states a disagreement and a settings-only plugin, each as a flag', () =>
{
    const settings = new Map([
        ['csharp-lsp', { on: true, file: 'settings.json', own: true }],
        ['typescript-lsp', { on: true, file: 'settings.local.json', own: true }],
        ['account-only', { on: true, file: 'account settings.json', own: false }],
        ['claude-hud', { on: true, file: 'account settings.json', own: false }],
    ]);
    const { rows, flags } = CI.crossCheckPlugins([
        { name: 'claude-hud', state: 'enabled' },
        { name: 'csharp-lsp', state: 'disabled', enabled: false },
        { name: 'odd', state: 'unclear', enabled: 'yes' },
    ], settings);
    assert.deepStrictEqual(rows.map((r) => `${r.name} (${r.state})`), [
        'claude-hud (enabled)',
        'csharp-lsp (state unclear: CLI disabled / settings enabled in settings.json)',
        'odd (state unclear: CLI enabled="yes" / settings none)',
        'typescript-lsp (enabled in .claude/settings.local.json - no CLI row for this path)',
    ]);
    assert.strictEqual(flags.length, 3);
    assert.match(flags[2], /^typescript-lsp: \.claude\/settings\.local\.json enables it, and `claude plugin list` has no row for this path/);
    const line = rows.map((r) => `${r.name} (${r.state})`).join(', ');
    assert.deepStrictEqual([...CI.pluginEntries(line).keys()], ['claude-hud', 'csharp-lsp', 'odd', 'typescript-lsp'], 'the line splits back into its entries');
});

test('SD07: the inventory prints each deciding row and the flags; a settings-only plugin is on the Plugins line', { skip: posixOnly }, () =>
{
    const root = project('sd07-inventory');
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'csharp-lsp@claude-plugins-official': true } }), -100);
    const bin = stubCli(path.join(TMP, 'sd07-cli'), { plugins: JSON.stringify([
        { id: 'superpowers@x', scope: 'user', enabled: true },
        { id: 'csharp-lsp@claude-plugins-official', scope: 'project', enabled: true, projectPath: '/some/other/repo' },
    ]) });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /^ {2}csharp-lsp \(enabled in \.claude\/settings\.json - no CLI row for this path\), superpowers \(enabled\)$/m);
    assert.match(out, /^ {2}decided by superpowers: enabled - row user, no projectPath$/m);
    assert.match(out, /^FLAG: {6}csharp-lsp: \.claude\/settings\.json enables it/m);
    assert.match(out, /\/ plugins 2$/m);
});

test('SD07 ce9d4811#2: --verify fails a Plugins line a fresh probe contradicts, and passes the one it confirms', { skip: posixOnly }, () =>
{
    const root = project('sd07-verify');
    const bin = stubCli(path.join(TMP, 'sd07-verify-cli'), { plugins: JSON.stringify([{ id: 'superpowers@x', scope: 'user', enabled: false }]) });
    const rule = write(path.join(root, '.claude', 'rules', 'alfred-agent-awareness.md'), validRule());
    const bad = run(['--verify', rule], { cwd: root, bin });
    assert.strictEqual(bad.status, 1, bad.out);
    assert.match(bad.out, /plugins:\s+FAIL - the Plugins line contradicts a fresh `claude plugin list` - superpowers: rule enabled, now disabled/);
    fs.writeFileSync(rule, validRule().replace('superpowers (enabled)', 'superpowers (disabled)'));
    const good = run(['--verify', rule], { cwd: root, bin });
    assert.match(good.out, /plugins:\s+ok - 1 plugin\(s\), as a fresh `claude plugin list` reads them/);
    assert.match(run(['--verify', rule], { cwd: root }).out, /plugins:\s+ok - not compared - CLI absent/);
});
