// The 2026-09-29 audit, rules package (merged.md I19, I20, I21, I23, I24, plus the prose half of I12, I10 and
// I45): each case pins one finding's fix - a stale platform fact, an unresolved slot in the generated
// capabilities rule, the always-on budget measuring the wrong set, a stale rationale, and the generated rule
// restating the baselines.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { readClaudeDocs } = require('./claude-docs.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (text) => text.replace(/\s+/g, ' ');
const CAPS_DIR = 'stack/skills/capture-awareness';
const SCRIPT = path.join(ROOT, CAPS_DIR, 'scripts', 'awareness-state.js');
// The agents reference holds the doc's copy target, the stamped usage policy and the routing map.
const TEMPLATE = `${CAPS_DIR}/references/agents.md`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilities-rule-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function write(p, text)
{
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
}

// The usage-policy block as the skill stamps it: the lines under the policy-rev stamp, up to the next heading.
function policyBlock()
{
    const lines = read(TEMPLATE).split('\n');
    const at = lines.findIndex((l) => /<!--\s*policy-rev:/.test(l));
    const out = [];
    for (let i = at + 1; i < lines.length && !/^#{1,6} /.test(lines[i]) && !/^```/.test(lines[i]); i++) out.push(lines[i]);
    return out.join('\n');
}

// The routing map the script reads: the template lines after 'The routing map', up to the next heading.
function routingMapText()
{
    const text = read(TEMPLATE);
    const from = text.search(/^The routing map/m);
    const rest = text.slice(from);
    const end = rest.search(/\n#{1,6} /);
    return end === -1 ? rest : rest.slice(0, end);
}

// A project the script can inventory with no CLI on PATH: its servers come from .mcp.json.
function project(name, { servers = ['playwright-chrome', 'windows-desktop'], settings, local, account } = {})
{
    const root = path.join(TMP, name);
    write(path.join(root, '.claude', 'skills', 'capture-awareness', 'SKILL.md'), '---\nname: capture-awareness\ndescription: "x"\ndisable-model-invocation: true\n---\n');
    write(path.join(root, '.claude', 'agents', 'aspnet-verifier.md'), '---\nname: aspnet-verifier\n---\n');
    write(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: Object.fromEntries(servers.map((s) => [s, {}])) }));
    if (settings) write(path.join(root, '.claude', 'settings.json'), JSON.stringify(settings));
    if (local !== undefined) write(path.join(root, '.claude', 'settings.local.json'), typeof local === 'string' ? local : JSON.stringify(local));
    const home = path.join(TMP, `${name}-home`);
    if (account) write(path.join(home, '.claude', 'settings.json'), JSON.stringify(account));
    return { root, home };
}

function run(args, { cwd, home, env = {} })
{
    fs.mkdirSync(path.join(TMP, 'empty-bin'), { recursive: true });
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { PATH: path.join(TMP, 'empty-bin'), HOME: home || TMP, ...env } });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
// The script runs its report when executed; a require must not (it would probe the real `claude` CLI).
function loadScript()
{
    assert.match(fs.readFileSync(SCRIPT, 'utf8'), /if \(require\.main === module\)/, 'the script runs main() on require - no unit entry points');
    return require(SCRIPT);
}
const rowsOf = (out) => out.split('\n').filter((l) => /^\s+- `/.test(l)).map((l) => l.trim());

// ------------------------------------------------------------------ I19

test('I19: alfred-security says a Read deny covers the shell file commands Claude Code recognizes', () =>
{
    const rule = squash(read('stack/rules/alfred-security.md'));
    assert.ok(!rule.includes('blocks only the Read TOOL'), 'the drifted claim is gone');
    assert.ok(!rule.includes('never a shell `cat`'), 'a shell `cat` of a denied file is covered now');
    for (const phrase of ['shell file commands Claude Code recognizes', '`grep -r`', 'a subprocess', '`guard-secret-value.js` covers those by content'])
        assert.ok(rule.includes(phrase), `alfred-security.md: '${phrase}'`);
});

// ------------------------------------------------------------------ I20

test('I20: the rows name the resolved data root, never the slots', () =>
{
    const { root, home } = project('data-root-default', { servers: ['playwright-chrome', 'playwright-firefox', 'windows-desktop'] });
    const rows = rowsOf(run([], { cwd: root, home }).out);
    assert.equal(rows.length, 3, rows.join('\n'));
    assert.ok(rows[0].startsWith('- `playwright-chrome` - the browser server') && rows[1].startsWith('- `playwright-firefox` - the browser server'), rows.join('\n'));
    for (const row of rows.slice(0, 2)) assert.ok(row.includes("the server's `--output-dir`"), row);
    // HK-16 (audit 2026-10-30): the desktop row sends the receipt to the denial's lines, so no row carries the data root.
    assert.ok(rows[2].includes('write the lines the denial prints') && !rows[2].includes('DESKTOP-EXEC-ALLOW'), rows[2]);
    for (const row of rows) assert.doesNotMatch(row, /<data root>|<engine>|<server>|<docs-path>/, row);
});

test('I20: the data root follows ALFRED_CODE_DATA_PATH, settings.local.json over settings.json', () =>
{
    const { root, home } = project('data-root-local', { servers: ['windows-desktop'], settings: { env: { ALFRED_CODE_DATA_PATH: 'data/shared' } }, local: { env: { ALFRED_CODE_DATA_PATH: 'data/mine' } } });
    const { out } = run([], { cwd: root, home });
    assert.match(out, /MCP ROUTING rows - .*\(data root data\/mine\):/, out);
});

test('I20: the script resolves the data root the way stack/mcp/data-root.js does', () =>
{
    const { dataRootOf } = require('../stack/mcp/data-root.js');
    const { dataRoot } = loadScript();
    const cases = [
        ['none', {}],
        ['settings', { settings: { env: { ALFRED_CODE_DATA_PATH: 'data/a' } } }],
        ['local-wins', { settings: { env: { ALFRED_CODE_DATA_PATH: 'data/a' } }, local: { env: { ALFRED_CODE_DATA_PATH: './data/b/' } } }],
        ['malformed-local', { settings: { env: { ALFRED_CODE_DATA_PATH: 'data/a' } }, local: '{ not json' }],
        ['under-claude', { settings: { env: { ALFRED_CODE_DATA_PATH: '.claude/data' } } }],
        ['absolute', { settings: { env: { ALFRED_CODE_DATA_PATH: '/abs/data' } } }],
        ['space', { settings: { env: { ALFRED_CODE_DATA_PATH: 'my data' } } }],
        ['dotdot', { settings: { env: { ALFRED_CODE_DATA_PATH: 'a/../b' } } }],
        ['account', { account: { env: { ALFRED_CODE_DATA_PATH: 'acct-data' } } }],
    ];
    for (const [name, opts] of cases)
    {
        const { root, home } = project(`parity-${name}`, opts);
        const env = { CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
        assert.equal(dataRoot(root, env), dataRootOf({ env, projectDir: root }).root, name);
    }
    const { root } = project('parity-env');
    const env = { ALFRED_CODE_DATA_PATH: 'from-shell', CLAUDE_CONFIG_DIR: path.join(TMP, 'nowhere') };
    assert.equal(dataRoot(root, env), dataRootOf({ env, projectDir: root }).root, 'the shell env first');
});

test('I20: routingRow leaves no slot outside the first call names', () =>
{
    const { routingRow, pluginRoutingRow, routingMap } = loadScript();
    const map = routingMap();
    const slots = { dataRoot: 'data/x', docsRoot: 'data/x/docs' };
    const rows = [
        routingRow('playwright-webkit', map, slots),
        pluginRoutingRow('playwright', 'playwright', map, slots),
        routingRow('windows-desktop', map, slots),
        pluginRoutingRow('macos-desktop', 'macos-desktop', map, slots),
    ];
    for (const row of rows) assert.doesNotMatch(row.split('first call:')[0], /<[a-z][a-z -]*>/, row);
    assert.ok(rows[0].startsWith('- `playwright-webkit` - '), rows[0]);
    assert.ok(rows[1].startsWith('- `playwright` - '), rows[1]);
    for (const row of rows.slice(2)) assert.ok(row.includes('write the lines the denial prints') && !row.includes('DESKTOP-EXEC-ALLOW'), row);
});

test('I20: the rows\' docs and data roots follow a local-scope install\'s settings.local.json over settings.json', () =>
{
    // 2.8.0: the data root follows ALFRED_CODE_DATA_PATH the same way; since HK-16 the routing header names it, no row.
    const { root, home } = project('docs-root-local', { servers: ['windows-desktop'], settings: { env: { ALFRED_CODE_DOCS_PATH: 'shared/docs', ALFRED_CODE_DATA_PATH: 'shared' } }, local: { env: { ALFRED_CODE_DOCS_PATH: 'var/data/docs', ALFRED_CODE_DATA_PATH: 'var/data' } } });
    const { out } = run([], { cwd: root, home });
    assert.match(out, /DOCS ROOT: var\/data\/docs\s+\(from ALFRED_CODE_DOCS_PATH in \.claude\/settings\.local\.json env\)/);
    assert.match(out, /MCP ROUTING rows - .*\(data root var\/data\):/, out);
});

test('I20: --verify fails a rule still holding an unresolved slot', () =>
{
    const { root, home } = project('verify-slot');
    const rule = write(path.join(root, 'rule.md'), '---\ndescription: generated\n---\n\n# x\n\n## Orchestration skills\n\n## Subagent seats\n\n## MCP routing\n- `playwright` - screenshots land in `<data root>/<docs-path>/output/`. first call: `ToolSearch select:x`.\n');
    const { status, out } = run(['--verify', rule], { cwd: root, home });
    assert.match(out, /slots:\s+FAIL - unresolved <data root>, <docs-path>/);
    assert.equal(status, 1, out);
});

// ------------------------------------------------------------------ I21

test('I21: the injected rule text drops the frontmatter and block HTML comments, never a fenced one', () =>
{
    const { injectedRuleText } = require('./always-on-surface.js');
    const text = '---\ndescription: a note nobody is sent\n---\n\n# Rule\n\n- keep this\n\n<!-- Maintainer note: stripped\n     across lines. -->\n\n```md\n<!-- kept: inside a fence -->\n```\n- and this\n';
    const got = injectedRuleText(text);
    assert.ok(!got.includes('description:'), got);
    assert.ok(!got.includes('Maintainer note'), got);
    assert.ok(got.includes('<!-- kept: inside a fence -->'), got);
    assert.ok(got.includes('- keep this') && got.includes('- and this'), got);
});

test('I21: the always-on surface skips manual-only descriptions and prices the generated rule\'s fixed text', () =>
{
    const { alwaysOnSurface } = require('./always-on-surface.js');
    const base = path.join(TMP, 'surface');
    write(path.join(base, 'rules', 'baseline-a.md'), '---\ndescription: x\n---\n\nABCDE\n\n<!-- note -->\n');
    write(path.join(base, 'rules', 'scoped.md'), '---\npaths: ["**/*.cs"]\n---\n\nlazy text\n');
    write(path.join(base, 'agents', 'seat.md'), '---\nname: seat\ndescription: "12345"\n---\n');
    write(path.join(base, 'skills', 'on', 'SKILL.md'), '---\nname: on\ndescription: "1234"\nwhen_to_use: "56"\n---\n');
    write(path.join(base, 'skills', 'manual', 'SKILL.md'), '---\nname: manual\ndescription: "a long manual-only description"\ndisable-model-invocation: true\n---\n');
    // The agents reference holds the doc's policy and the routing map; SKILL.md the rule's copy target, its import slot left out.
    write(path.join(base, 'caps', 'SKILL.md'), '# caps\n\nCOPY TARGET - the rule:\n\n```markdown\n---\ndescription: d\n---\n\n# R\n\nText.\n\n<the script\'s import lines, one per awareness doc>\n```\n');
    write(path.join(base, 'caps', 'references', 'agents.md'), '# caps\n\n```markdown\n## Usage policy (fixed - stamped verbatim, every run)\n<!-- policy-rev: 00000000 -->\n- P1\n\n## Orchestration skills\n```\n\nThe routing map (only for servers actually present):\n- `playwright` - not fixed text.\n');
    const s = alwaysOnSurface({ rulesDir: path.join(base, 'rules'), agentsDir: path.join(base, 'agents'), skillsDir: path.join(base, 'skills'), capabilitiesDir: path.join(base, 'caps') });
    assert.equal(s.rules, 'ABCDE'.length, 'the body only - no frontmatter, no comment, no blank-line padding');
    assert.equal(s.agents, 5);
    assert.equal(s.skills, 6, 'description plus when_to_use, the manual-only skill not counted');
    assert.equal(s.manualOnly, 1);
    const fixed = '## Usage policy (fixed - stamped verbatim, every run)\n- P1'.length + '# R\n\nText.'.length;
    assert.equal(s.generated, fixed, 'the policy section (its stamp comment is stripped) and the awareness rule\'s own text - no routing row is fixed');
    assert.equal(s.total, s.rules + s.agents + s.agentTools + s.skills + s.generated);
});

// Audit 2026-10-10 C28 (session 8f44a003): the dispatcher lists each seat with its '(Tools: ...)' suffix - 33,635
// of the listing's 45,027 chars - and check 33 measured none of it.
test('C28: the always-on surface measures each seat\'s listed tools suffix and prints it beside the capped parts', () =>
{
    const { alwaysOnSurface, alwaysOnParts } = require('./always-on-surface.js');
    const base = path.join(TMP, 'surface-tools');
    write(path.join(base, 'rules', 'r.md'), 'R\n');
    write(path.join(base, 'agents', 'inline.md'), '---\nname: inline\ndescription: "d"\ntools: Read, Bash\n---\n');
    write(path.join(base, 'agents', 'listed.md'), '---\nname: listed\ndescription: "d"\ntools:\n  - Read\n  - "Grep"\n---\n');
    write(path.join(base, 'agents', 'none.md'), '---\nname: none\ndescription: "d"\n---\n');
    fs.mkdirSync(path.join(base, 'skills'), { recursive: true });
    const s = alwaysOnSurface({ rulesDir: path.join(base, 'rules'), agentsDir: path.join(base, 'agents'), skillsDir: path.join(base, 'skills'), capabilitiesDir: path.join(base, 'caps') });
    assert.equal(s.agentTools, ' (Tools: Read, Bash)'.length + ' (Tools: Read, Grep)'.length + ' (Tools: *)'.length, 'inline, a YAML list joined, and none as *');
    // The user's 2026-10-13 ruling ('Count them, cap 80k'): the suffix is part of the capped total.
    assert.equal(s.total, s.rules + s.agents + s.agentTools + s.skills + s.generated, 'the tools suffix is inside the cap');
    assert.match(alwaysOnParts(s), new RegExp(`agent tools lists ${s.agentTools} \\(listed beside each description\\)`));
    assert.ok(!alwaysOnParts(s).includes('not counted'), 'nothing measured is left out of the total');
});

test('I21: the lint comment no longer claims ~10% headroom, and CLAUDE.md states what check 33 counts', () =>
{
    const lint = read('scripts/lint-skills.js');
    assert.ok(!lint.includes('~10% headroom'), 'the stale headroom claim is gone');
    const md = squash(readClaudeDocs());
    assert.ok(!md.includes('pathless rules 25,090'), 'the whole-file figure is gone');
    assert.ok(md.includes('frontmatter and HTML comments stripped'), 'CLAUDE.md says the rules are counted as injected');
    assert.ok(md.includes('a `disable-model-invocation` skill\'s is not in context'), 'CLAUDE.md says the manual-only descriptions are skipped');
    assert.ok(md.includes('fails over 80,000 chars'), 'the limit itself stays');
    assert.match(lint, /const ALWAYS_ON_MAX = 80000;/, 'the cap is 80,000 since the tools lists count (2026-10-13)');
});

// ------------------------------------------------------------------ I23

test('I23: markdown-docs.md no longer claims markdown-style fires only on lint asks, and keeps its first action', () =>
{
    const rule = squash(read('stack/rules/markdown-docs.md'));
    assert.ok(!rule.includes('only catch explicit lint asks'), 'the stale rationale is gone');
    assert.ok(!rule.includes('misses the doc skills\' keyword triggers'), 'the stale frontmatter note is gone');
    assert.ok(rule.includes('the FIRST action after this rule attaches is the `markdown-style` Skill call'), 'the FIRST-action line stays');
});

// ------------------------------------------------------------------ I24

test('I24: the stamped policy drops the docs-placement and memory lines and states no fresh-session number', () =>
{
    const policy = squash(policyBlock());
    assert.ok(!/\d{3},000/.test(policy), `a fresh-session number is left: ${policy}`);
    assert.ok(policy.includes('past the window trigger'), 'the trigger is named, never numbered');
    assert.ok(!policy.includes('Memory recall is historical'), 'alfred-memory owns what a recalled memory is worth');
    assert.ok(!policy.includes('<docs-path>'), 'alfred-docs-root owns where a doc lands');
});

// 2026-10-24 (the stack ships no MCP server): the locked servers' shared row left with them, and every row is keyed by
// the name the record of the shipped servers registers it under.
test('I24: the routing map keys one row per recorded server and names no server the stack shipped', () =>
{
    const keys = routingMapText().split('\n').map((l) => /^- `([^`]+)` - /.exec(l)).filter(Boolean).map((m) => m[1]);
    assert.deepStrictEqual(keys, ['playwright', 'windows-desktop', 'macos-desktop', 'appium-mcp']);
    const record = Object.keys(JSON.parse(read('stack/mcp/original-mcps.json')).mcpServers);
    for (const key of keys.slice(1)) assert.ok(record.includes(key), `${key} is a record name`);
    assert.ok(record.some((k) => k.startsWith('playwright-')), 'the record registers the browser per engine');
    assert.doesNotMatch(routingMapText(), /`alfred-(?:navigation|documentation|memory)`|`(?:browser|windows-control|macos-control|mobile-control)` - /);
});

// Audit 2026-10-14 RU11: the locked row no longer restates the navigation rule's edit and memory lines - both
// baselines are locked into every install, so the generated rule paid ~190 chars for a copy of them.
test('I24: the generated rule holds no sentence a baseline owns', () =>
{
    const registry = JSON.parse(read('meta/shared-rules.json')).rules;
    const generated = squash(`${policyBlock()}\n${routingMapText()}`);
    const restated = Object.entries(registry)
        .filter(([, r]) => r.owner && /^stack\/rules\/alfred-/.test(r.owner.file))
        .filter(([, r]) => generated.includes(squash(r.owner.marker)))
        .map(([id]) => id);
    assert.deepStrictEqual(restated, []);
    assert.ok(!registry['navigation-edit-tools'], 'the edit line has one home, the navigation rule');
});

test('I24: the report prints one row per registered server, and --verify passes a rule built from it', () =>
{
    const { root, home } = project('locked-row');
    const { out } = run([], { cwd: root, home });
    const rows = rowsOf(out);
    assert.equal(rows.length, 2, rows.join('\n'));
    assert.equal(rows.filter((r) => /^- `playwright-chrome` - /.test(r)).length, 1, rows.join('\n'));
    assert.equal(rows.filter((r) => /^- `windows-desktop` - /.test(r)).length, 1, rows.join('\n'));
    const unknown = rowsOf(run([], { cwd: project('unknown-server', { servers: ['serena'] }).root, home }).out);
    assert.deepStrictEqual(unknown.map((r) => /^- `([^`]+)` - routing: see project docs\./.exec(r)?.[1]), ['serena'], 'a server the map does not key gets the unknown row');

    const skill = read(TEMPLATE).split('\n');
    const at = skill.findIndex((l) => /<!--\s*policy-rev:/.test(l));
    const rule = write(path.join(root, 'composed.md'), [
        '# This project\'s capabilities', '', 'Captured: 2026-09-29 from 2.1.3@abcdef1', '',
        '## Usage policy (fixed - stamped verbatim, every run)', skill[at], policyBlock(), '',
        '## Orchestration skills (slash-only - invisible until invoked)', '/capture-awareness - x', '',
        '## Subagent seats', 'aspnet-verifier', '', '## MCP routing', ...rows, '',
    ].join('\n'));
    const verified = run(['--verify', rule], { cwd: root, home });
    assert.match(verified.out, /slots:\s+ok/);
    assert.match(verified.out, /mcp rows:\s+ok - 2 of 2/);
    assert.match(verified.out, /VERIFY:\s+PASS/);
    assert.equal(verified.status, 0, verified.out);
});

// ------------------------------------------------------------------ I12 (prose half)

test('I12: the navigation rule keeps rename and safe delete, every other edit on Edit / Write', () =>
{
    const nav = squash(read('stack/rules/alfred-navigation.md'));
    assert.ok(!nav.includes('symbol edits and the memory handoff stay on the navigation server'), 'the old edit routing is gone');
    assert.ok(nav.includes('Edits go through Edit / Write'), 'alfred-navigation.md');
    assert.ok(nav.includes('only a symbol rename or a safe delete is used'), 'alfred-navigation.md');
    const map = squash(routingMapText());
    assert.ok(!map.includes('symbol-level editor'), 'no row sells a server as an editor');
    assert.ok(!nav.includes('seat memory handoff') && !map.includes('seat memory handoff'), 'no seat handoff left on a navigation server');
});

// ------------------------------------------------------------------ I45 + I10 (prose half)

test('I45: the macOS row leads with the failed start, and an empty snapshot only past the skip switch', () =>
{
    const row = squash(routingMapText().split('\n').find((l) => l.startsWith('- `macos-desktop`')));
    assert.ok(!row.includes('an empty snapshot means the Accessibility grant is missing'), row);
    assert.ok(row.includes('fails to connect at start') && row.includes('System Settings opens'), row);
    assert.ok(row.includes('`MACOS_MCP_SKIP_PERMISSION_CHECK=1`'), row);
    assert.ok(row.includes('`Shell`') && row.includes('write the lines the denial prints') && !row.includes('DESKTOP-EXEC-ALLOW'), row);
});

test('I10: the Windows row keeps FileSystem excluded and App launch_executable denied without the receipt', () =>
{
    const row = squash(routingMapText().split('\n').find((l) => l.startsWith('- `windows-desktop`')));
    assert.ok(row.includes('`FileSystem`'), row);
    assert.ok(row.includes('`launch_executable`') && row.includes('write the lines the denial prints') && !row.includes('DESKTOP-EXEC-ALLOW'), row);
});

// 2026-10-13: mobile-control (appium-mcp); 2026-10-24 keyed by the record's `appium-mcp`, its output dirs the server's own env.
test('appium-mcp: the row names the server\'s output dirs and the registration\'s tool spelling', () =>
{
    const { root, home } = project('mobile-row', { servers: ['appium-mcp'] });
    const rows = rowsOf(run([], { cwd: root, home }).out);
    assert.strictEqual(rows.length, 1, rows.join('\n'));
    assert.ok(rows[0].startsWith('- `appium-mcp` - the mobile server (appium-mcp)'), rows[0]);
    for (const dir of ['PAGE_SOURCES_DIR', 'SCREENSHOTS_DIR']) assert.ok(rows[0].includes(`\`${dir}\``), rows[0]);
    assert.match(rows[0], /ToolSearch select:mcp__appium-mcp__appium_session_management,mcp__appium-mcp__appium_find_element,/);   // mcp-fixture: the registration spelling a copy-route row is re-spelled to
    assert.doesNotMatch(rows[0], /<data root>|<server>|<engine>/, rows[0]);
});

// ---------------------------------------------------------------- the project split and the map line (spec 2026-10-29)
// `--rule` imports AGENTS, PROJECT-INFO, RUN-AND-DEBUG, RESOURCES, RELATED (with an entry) and USER (whenever it exists),
// each only when the file exists; it prints a size line per import and an over-budget line past a cap (1.4); and the
// architecture map is a pointer line after the imports, never an import, which retires alfred-architecture.md (1.7).
const AW = (root) => path.join(root, '.alfred', 'docs', 'awareness');
const AWARE_RULE = (root) => path.join(root, '.claude', 'rules', 'alfred-awareness.md');
const importsOf = (root) => fs.readFileSync(AWARE_RULE(root), 'utf8').split('\n').filter((l) => l.startsWith('@'))
    .map((l) => l.replace('@../../.alfred/docs/awareness/', ''));
const stamped = (title) => `Captured: main@abc1234, 2026-10-30\n\n# ${title}\n`;
const MAP_LINE = 'Architecture map: `.alfred/docs/awareness/ARCHITECTURE-AWARENESS.md` - only pointed at, never imported: read it by section before a structural change.';
// The retired marker as 3.3.0 wrote it.
const MARKER_330 = '---\ndescription: Project architecture capture marker - generated by /capture-architecture; edit via a re-run.\n---\n\n' // legacy
    + 'The architecture docs are captured for this project - read them before a structural change.\n';

test('the rule\'s imports: AGENTS, PROJECT-INFO, RUN-AND-DEBUG, RESOURCES, RELATED with an entry, USER whenever it exists', () =>
{
    const { root, home } = project('split-imports');
    for (const f of ['AGENTS', 'PROJECT-INFO', 'RUN-AND-DEBUG', 'RESOURCES']) write(path.join(AW(root), `${f}-AWARENESS.md`), stamped(f));
    const related = write(path.join(AW(root), 'RELATED-PROJECTS-AWARENESS.md'), stamped('Related projects'));
    const r = run(['--rule'], { cwd: root, home });
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(importsOf(root), ['AGENTS-AWARENESS.md', 'PROJECT-INFO-AWARENESS.md', 'RUN-AND-DEBUG-AWARENESS.md', 'RESOURCES-AWARENESS.md'],
        'no entry, no related import; no USER file, no USER import');
    fs.appendFileSync(related, '\n## acme-api\n<!-- id: acme-api -->\n');
    write(path.join(AW(root), 'USER-AWARENESS.md'), '# Your notes - the stack never writes this file\n');
    run(['--rule'], { cwd: root, home });
    assert.deepStrictEqual(importsOf(root), ['AGENTS-AWARENESS.md', 'PROJECT-INFO-AWARENESS.md', 'RUN-AND-DEBUG-AWARENESS.md', 'RESOURCES-AWARENESS.md',
        'RELATED-PROJECTS-AWARENESS.md', 'USER-AWARENESS.md'], 'the user\'s file is imported on its header alone');

    const old = project('split-imports-old');
    write(path.join(AW(old.root), 'PROJECT-AWARENESS.md'), stamped('Run book'));
    run(['--rule'], { cwd: old.root, home: old.home });
    assert.deepStrictEqual(importsOf(old.root), ['PROJECT-AWARENESS.md'], 'an install not yet updated: the run book under its own name');
});

test('the map\'s pointer line: after the imports when the map exists, never an import, and the 3.3.0 marker goes', () =>
{
    const { root, home } = project('map-line');
    const rules = path.join(root, '.claude', 'rules');
    const map = write(path.join(AW(root), 'ARCHITECTURE-AWARENESS.md'), stamped('Architecture'));
    write(path.join(AW(root), 'ARCHITECTURE-ORIENTATION-AWARENESS.md'), '# Orientation\n');
    write(path.join(rules, 'alfred-architecture.md'), MARKER_330);
    let r = run(['--rule'], { cwd: root, home });
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(importsOf(root), [], 'a project holding only the map gets the rule with the line alone');
    assert.ok(fs.readFileSync(AWARE_RULE(root), 'utf8').trimEnd().endsWith(`\n\n${MAP_LINE}`), 'the line, word for word, last');
    assert.doesNotMatch(r.out, /^size:.*ARCHITECTURE/m, 'nothing imported, no size line');
    assert.match(r.out, /REMOVED:\s+removed \.claude\/rules\/alfred-architecture\.md/);
    assert.ok(!fs.existsSync(path.join(rules, 'alfred-architecture.md')));

    write(path.join(AW(root), 'RUN-AND-DEBUG-AWARENESS.md'), stamped('Run book'));
    run(['--rule'], { cwd: root, home });
    const lines = fs.readFileSync(AWARE_RULE(root), 'utf8').split('\n');
    const last = lines.map((l) => l.startsWith('@')).lastIndexOf(true);
    assert.strictEqual(lines.slice(last + 1).find((l) => l.trim()), MAP_LINE, 'the first line after the last import');
    assert.ok(!lines.some((l) => l.startsWith('@') && /ARCHITECTURE/.test(l)), 'neither the map nor ORIENTATION is imported');

    fs.rmSync(map);
    run(['--rule'], { cwd: root, home });
    assert.doesNotMatch(fs.readFileSync(AWARE_RULE(root), 'utf8'), /Architecture map:/, 'no map, no line');

    write(map, stamped('Architecture'));
    write(path.join(rules, 'alfred-architecture.md'), `${MARKER_330}\nMy own note.\n`);
    r = run(['--rule'], { cwd: root, home });
    assert.ok(fs.existsSync(path.join(rules, 'alfred-architecture.md')), 'an edited marker is the user\'s');
    assert.match(r.out, /REMOVED:\s+kept \.claude\/rules\/alfred-architecture\.md - it is not the capture's own text/);
});

test('the size lines at each cap: one per imported doc, over budget only past the cap', () =>
{
    const CAPS = { 'PROJECT-INFO-AWARENESS.md': 2000, 'RESOURCES-AWARENESS.md': 1500, 'USER-AWARENESS.md': 4000 };
    for (const delta of [-1, 0, 1])
    {
        const { root, home } = project(`size${delta}`);
        for (const [f, cap] of Object.entries(CAPS)) write(path.join(AW(root), f), 'x'.repeat(cap + delta));
        write(path.join(AW(root), 'RUN-AND-DEBUG-AWARENESS.md'), stamped('Run book'));
        const r = run(['--rule'], { cwd: root, home });
        assert.strictEqual(r.status, 0, r.out);
        for (const [f, cap] of Object.entries(CAPS))
        {
            assert.match(r.out, new RegExp(`^size: +${f} ${cap + delta} bytes$`, 'm'), `${f} at ${cap + delta}`);
            const over = new RegExp(`^over budget: +${f} ${cap + delta} of ${cap} bytes$`, 'm');
            if (delta > 0) assert.match(r.out, over, `${f} past its cap`);
            else assert.doesNotMatch(r.out, over, `${f} at or under its cap`);
        }
        assert.match(r.out, /^size: +RUN-AND-DEBUG-AWARENESS\.md \d+ bytes$/m, 'every imported doc has its size line');
        assert.doesNotMatch(r.out, /^over budget: +RUN-AND-DEBUG/m, 'the run book has no cap');
    }
});
