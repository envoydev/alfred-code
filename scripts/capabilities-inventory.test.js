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

const SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'project-agent-capabilities', 'scripts', 'capabilities-inventory.js');
const SKILL_MD = path.join(__dirname, '..', 'stack', 'skills', 'project-agent-capabilities', 'SKILL.md');
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
    for (const [dir, s] of Object.entries(opts.skills || { 'project-agent-capabilities': { slashOnly: true }, 'markdown-author': {} }))
    {
        write(path.join(root, '.claude', 'skills', dir, 'SKILL.md'), skillFile(dir, s), -100);
    }
    for (const seat of opts.seats || ['aspnet-implementer', 'aspnet-verifier', 'security-auditor'])
    {
        write(path.join(root, '.claude', 'agents', `${seat}.md`), `---\nname: ${seat}\n---\n\n# ${seat}\n`, -100);
    }
    write(path.join(root, '.claude', 'rules', 'baseline-navigation.md'), '---\n---\n\n# nav\n', -100);
    write(path.join(root, '.claude', 'rules', 'markdown-docs.md'), '---\npaths: ["**/*.md"]\n---\n\n# md\n', -100);
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { serena: {}, context7: {}, memory: {}, 'appium-mcp': {} } }, null, 2), -100);
    write(path.join(root, '.claude', 'alfred-code.stamp'), 'sha: abcdef1234567890\nversion: 0.2.79\n', -100);
    if (opts.rule !== false) write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), opts.rule || '---\ndescription: generated\n---\n\n# This project\'s capabilities\n\nCaptured: 2026-09-01 from 0.2.79@abcdef1\n', 0);
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
            'project-agent-capabilities': { slashOnly: true, description: 'The deliberate capabilities capture. Use when the user asks to capture the project capabilities.' },
            'project-architecture-analyzer': { description: 'Captures the architecture. A long second sentence.' },
            'markdown-author': {},
        },
    });
    const bin = stubCli(path.join(TMP, 'inventory-cli'), {
        mcp: 'Checking MCP server health\n\nserena: uvx --from git+... serena start-mcp-server - ✔ Connected\ncontext7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected\nclaude.ai Notion: https://mcp.notion.com/mcp - ⊘ Disabled for this project',
        plugins: JSON.stringify([{ id: 'superpowers@x', enabled: true }, { id: 'claude-hud@y', enabled: false }, { id: 'elsewhere@z', enabled: true, projectPath: '/nowhere/else' }]),
    });
    const { out } = run([], { cwd: root, bin });

    assert.match(out, /SKILLS:\s+3 total, 2 orchestration \(1 model-invocable-by-design\)/);
    assert.match(out, /\/project-agent-capabilities - The deliberate capabilities capture$/m);
    assert.match(out, /\/project-architecture-analyzer - .*\(model-invocable-by-design\)/);
    assert.match(out, /SEATS:\s+3 total/);
    assert.match(out, /seat families \(1\): aspnet/);
    assert.match(out, /RULES:\s+3 total, 2 pathless, 1 path-scoped/);
    assert.match(out, /path-scoped: markdown-docs \[\*\*\/\*\.md\]/);
    assert.match(out, /MCP:\s+4 registered in \.mcp\.json, 3 live in `claude mcp list`/);
    assert.match(out, /heavy native deps registered: appium-mcp/);
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
        mcp: 'serena: cmd - ✔ Connected\nmemory: uvx x - ✗ Failed to connect\nclaude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected',
    });
    const { out } = run([], { cwd: root, bin });
    assert.match(out, /memory\s+registered\s+live: failed/);
    // registered but NOT connected, and live but NOT registered - the two facts the file cannot give
    assert.match(out, /context7\s+registered\s+live: not in the live list/);
    assert.match(out, /claude\.ai Notion\s+-\s+live: connected\s+\(reaches the session from the account or the harness/);
    const rows = out.split('\n').filter((l) => /^\s+- `/.test(l));
    assert.equal(rows.length, 4, 'one routing row per registered server');
    for (const row of rows) assert.match(row, /first call: `ToolSearch select:/, `no first call: in ${row.slice(0, 60)}`);
});

test('inventory: a playwright browser server gets the catalog row with its own registered name', { skip: posixOnly }, () =>
{
    const root = project('playwright');
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'playwright-chrome': {} } }), -100);
    const { out } = run([], { cwd: root, bin: stubCli(path.join(TMP, 'pw-cli')) });
    assert.match(out, /playwright-chrome\s+registered .*routing: playwright/);
    assert.match(out, /- `playwright-chrome` - drive a browser/);
    assert.match(out, /mcp__plugin_playwright-chrome_playwright-chrome__browser_snapshot/);
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
    write(path.join(plugin, 'skills', 'project-solve-cross-task', 'SKILL.md'), skillFile('project-solve-cross-task', { slashOnly: true, description: 'The single entry-point orchestrator. More prose.' }));
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
    assert.match(out, /\/project-solve-cross-task - The single entry-point orchestrator/);
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
    assert.match(differs.out, /COMPARE:\s+differs - WRITE \.claude\/rules\/baseline-project-agent-capabilities\.md in ONE call/);
    assert.match(differs.out, /sections changed: ## Subagent seats/);
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

const validRule = (docsRoot = '.claude/docs') => [
    '---',
    'description: Project capabilities awareness - generated by /project-agent-capabilities; edit via a re-run, not by hand.',
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
    '/project-agent-capabilities - The deliberate capabilities capture',
    '',
    '## Subagent seats',
    'aspnet-implementer, aspnet-verifier',
    '',
    '## MCP routing',
    '- `serena` - symbol navigator. first call: `ToolSearch select:mcp__plugin_serena_serena__find_symbol`.',
    '- `context7` - docs. first call: `ToolSearch select:mcp__plugin_context7_context7__query-docs`.',
    '',
    '## Plugins',
    'superpowers (enabled)',
    '',
].join('\n');

test('--verify: a well-formed rule passes, parsed by node and never by PyYAML', { skip: posixOnly }, () =>
{
    const root = project('verify-ok');
    const rule = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), validRule());
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
    const rule = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), validRule().replace('---\n\n# This project', '\n\n# This project'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /frontmatter:\s+FAIL/);
    assert.match(out, /VERIFY:\s+FAIL/);
    assert.equal(status, 1, out);
});

test('--verify: a `paths:` key makes the pathless rule a scoped one, and fails', { skip: posixOnly }, () =>
{
    const root = project('verify-paths');
    const rule = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), validRule().replace('description: Project', 'paths: ["**/*.md"]\ndescription: Project'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /paths key:\s+FAIL - present/);
    assert.equal(status, 1, out);
});

test('--verify: an MCP row with no `first call:` exits non-zero and names the server', { skip: posixOnly }, () =>
{
    const root = project('verify-mcp');
    const rule = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'),
        validRule().replace('- `context7` - docs. first call: `ToolSearch select:mcp__plugin_context7_context7__query-docs`.', '- `appium-mcp` - native-mobile debug, only for that target.'));
    const { status, out } = run(['--verify', rule], { cwd: root });
    assert.match(out, /mcp rows:\s+FAIL - 1 of 2 carry no 'first call:' - appium-mcp/);
    assert.match(out, /VERIFY:\s+FAIL \(1 check/);
    assert.equal(status, 1, out);
});

test('--verify: a hand-edited policy block fails, and a resolved <docs-path> does not', { skip: posixOnly }, () =>
{
    const root = project('verify-policy');
    const edited = validRule().replace('Over-loading a simple', 'Over loading a simple');
    const ruleA = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), edited);
    assert.match(run(['--verify', ruleA], { cwd: root }).out, /policy block:\s+FAIL - differs from the skill at line \d+/);

    // the one slot that is not a slot: `<docs-path>` resolved to this project's docs root
    write(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: 'docs/ai' } }), -100);
    const ruleB = write(path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md'), validRule('docs/ai'));
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
    assert.match(out, /COMPARE:\s+no --body yet/);
});

test('report: an unreadable skill frontmatter is reported as unreadable, never filled from memory', { skip: posixOnly }, () =>
{
    const root = project('unreadable');
    write(path.join(root, '.claude', 'skills', 'broken', 'SKILL.md'), '---\nname: broken\ndescription: x\n\n# no closing fence\n', -100);
    const { out } = run([], { cwd: root });
    assert.match(out, /UNREADABLE broken: no closing `---`/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
