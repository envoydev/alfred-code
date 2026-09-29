// The 2026-09-29 audit, rules package (merged.md I19, I20, I21, I23, I24, plus the prose half of I12, I10 and
// I45): each case pins one finding's fix - a stale platform fact, an unresolved slot in the generated
// capabilities rule, the always-on budget measuring the wrong set, a stale rationale, and the generated rule
// restating the baselines.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (text) => text.replace(/\s+/g, ' ');
const CAPS_DIR = 'stack/skills/alfred-capture-agent-capabilities';
const SCRIPT = path.join(ROOT, CAPS_DIR, 'scripts', 'capabilities-inventory.js');
const TEMPLATE = `${CAPS_DIR}/references/generated-rule-template.md`;
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
    const lines = read(`${CAPS_DIR}/SKILL.md`).split('\n');
    const at = lines.findIndex((l) => /<!--\s*policy-rev:/.test(l));
    const out = [];
    for (let i = at + 1; i < lines.length && !/^#{1,6} /.test(lines[i]) && !/^```/.test(lines[i]); i++) out.push(lines[i]);
    return out.join('\n');
}

// The routing map the script reads: the template lines after 'The routing map', up to the next heading.
function routingMapText()
{
    const text = read(TEMPLATE);
    const from = text.indexOf('The routing map');
    const rest = text.slice(from);
    const end = rest.search(/\n#{1,6} /);
    return end === -1 ? rest : rest.slice(0, end);
}

// A project the script can inventory with no CLI on PATH: its servers come from .mcp.json.
function project(name, { servers = ['navigation', 'documentation', 'memory', 'browser-chrome'], settings, local, account } = {})
{
    const root = path.join(TMP, name);
    write(path.join(root, '.claude', 'skills', 'alfred-capture-agent-capabilities', 'SKILL.md'), '---\nname: alfred-capture-agent-capabilities\ndescription: "x"\ndisable-model-invocation: true\n---\n');
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

test('I19: baseline-security says a Read deny covers the shell file commands Claude Code recognizes', () =>
{
    const rule = squash(read('stack/rules/baseline-security.md'));
    assert.ok(!rule.includes('blocks only the Read TOOL'), 'the drifted claim is gone');
    assert.ok(!rule.includes('never a shell `cat`'), 'a shell `cat` of a denied file is covered now');
    for (const phrase of ['shell file commands Claude Code recognizes', '`grep -r`', 'a subprocess', '`guard-secret-value.js` covers those by content'])
        assert.ok(rule.includes(phrase), `baseline-security.md: '${phrase}'`);
});

// ------------------------------------------------------------------ I20

test('I20: the browser row names the resolved data root and engine, never the slots', () =>
{
    const { root, home } = project('data-root-default', { servers: ['browser-chrome', 'browser-firefox'] });
    const rows = rowsOf(run([], { cwd: root, home }).out);
    assert.equal(rows.length, 2, rows.join('\n'));
    assert.ok(rows[0].includes('`.alfred/browser/chrome/output/`'), rows[0]);
    assert.ok(rows[1].includes('`.alfred/browser/firefox/output/`'), rows[1]);
    for (const row of rows) assert.doesNotMatch(row, /<data root>|<engine>|<server>|<docs-path>/, row);
});

test('I20: the data root follows ALFRED_CODE_DATA_PATH, settings.local.json over settings.json', () =>
{
    const { root, home } = project('data-root-local', { servers: ['browser-chrome'], settings: { env: { ALFRED_CODE_DATA_PATH: 'data/shared' } }, local: { env: { ALFRED_CODE_DATA_PATH: 'data/mine' } } });
    const [row] = rowsOf(run([], { cwd: root, home }).out);
    assert.ok(row.includes('`data/mine/browser/chrome/output/`'), row);
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
        routingRow('browser-webkit', map, slots),
        pluginRoutingRow('browser-msedge', 'browser-msedge', map, slots),
        routingRow('windows-desktop', map, slots),
        pluginRoutingRow('macos-desktop', 'macos-desktop', map, slots),
    ];
    for (const row of rows) assert.doesNotMatch(row.split('first call:')[0], /<[a-z][a-z -]*>/, row);
    assert.ok(rows[0].includes('`data/x/browser/webkit/output/`'), rows[0]);
    assert.ok(rows[1].includes('`data/x/browser/msedge/output/`'), rows[1]);
    assert.ok(rows[2].includes('data/x/docs/flow/DESKTOP-EXEC-ALLOW'), rows[2]);
});

test('I20: the rows\' docs root follows a local-scope install\'s settings.local.json over settings.json', () =>
{
    const { root, home } = project('docs-root-local', { servers: ['windows-desktop'], settings: { env: { ALFRED_CODE_DOCS_PATH: 'shared/docs' } }, local: { env: { ALFRED_CODE_DOCS_PATH: 'var/data/docs' } } });
    const { out } = run([], { cwd: root, home });
    assert.match(out, /DOCS ROOT: var\/data\/docs\s+\(from ALFRED_CODE_DOCS_PATH in \.claude\/settings\.local\.json env\)/);
    const [row] = rowsOf(out);
    assert.ok(row.includes('`var/data/docs/flow/DESKTOP-EXEC-ALLOW`'), row);
});

test('I20: --verify fails a rule still holding an unresolved slot', () =>
{
    const { root, home } = project('verify-slot');
    const rule = write(path.join(root, 'rule.md'), '---\ndescription: generated\n---\n\n# x\n\n## Orchestration skills\n\n## Subagent seats\n\n## MCP routing\n- `browser-chrome` - screenshots land in `<data root>/browser/<engine>/output/`. first call: `ToolSearch select:x`.\n');
    const { status, out } = run(['--verify', rule], { cwd: root, home });
    assert.match(out, /slots:\s+FAIL - unresolved <data root>, <engine>/);
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
    write(path.join(base, 'caps', 'SKILL.md'), '# caps\n\n```markdown\n## Usage policy (fixed - stamped verbatim, every run)\n<!-- policy-rev: 00000000 -->\n- P1\n\n## Orchestration skills\n```\n');
    write(path.join(base, 'caps', 'references', 'generated-rule-template.md'), 'The routing map (only for servers actually present):\n- `navigation`, `documentation`, `memory` - LOCKED. first call: see the baselines.\n- `browser` - not fixed text.\n');
    const s = alwaysOnSurface({ rulesDir: path.join(base, 'rules'), agentsDir: path.join(base, 'agents'), skillsDir: path.join(base, 'skills'), capabilitiesDir: path.join(base, 'caps') });
    assert.equal(s.rules, 'ABCDE'.length, 'the body only - no frontmatter, no comment, no blank-line padding');
    assert.equal(s.agents, 5);
    assert.equal(s.skills, 6, 'description plus when_to_use, the manual-only skill not counted');
    assert.equal(s.manualOnly, 1);
    const fixed = '## Usage policy (fixed - stamped verbatim, every run)\n- P1'.length + '- `navigation`, `documentation`, `memory` - LOCKED. first call: see the baselines.'.length;
    assert.equal(s.generated, fixed, 'the policy section (its stamp comment is stripped) plus the locked-server row');
    assert.equal(s.total, s.rules + s.agents + s.skills + s.generated);
});

test('I21: the lint comment no longer claims ~10% headroom, and CLAUDE.md states what check 33 counts', () =>
{
    const lint = read('scripts/lint-skills.js');
    assert.ok(!lint.includes('~10% headroom'), 'the stale headroom claim is gone');
    const md = squash(read('CLAUDE.md'));
    assert.ok(!md.includes('pathless rules 25,090'), 'the whole-file figure is gone');
    assert.ok(md.includes('frontmatter and HTML comments stripped'), 'CLAUDE.md says the rules are counted as injected');
    assert.ok(md.includes('a `disable-model-invocation` skill\'s is not in context'), 'CLAUDE.md says the manual-only descriptions are skipped');
    assert.ok(md.includes('fails over 70,000 chars'), 'the limit itself stays');
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
    assert.ok(!policy.includes('Memory recall is historical'), 'baseline-memory owns what a recalled memory is worth');
    assert.ok(!policy.includes('<docs-path>'), 'baseline-docs-root owns where a doc lands');
});

test('I24: the locked servers share ONE routing row that points at their baselines', () =>
{
    const map = routingMapText();
    const locked = map.split('\n').filter((l) => /^- .*`(navigation|documentation|memory)`/.test(l));
    assert.equal(locked.length, 1, locked.join('\n'));
    assert.match(locked[0], /^- `navigation`, `documentation`, `memory` - /);
    for (const select of ['mcp__plugin_navigation_navigation__find_symbol', 'mcp__plugin_documentation_documentation__resolve-library-id', 'mcp__plugin_memory_memory__memory_store'])
        assert.ok(!map.includes(select), `the template restates a baseline's load line: ${select}`);
});

test('I24: the generated rule holds no sentence a baseline owns, except the pinned navigation-edit line', () =>
{
    const registry = JSON.parse(read('meta/shared-rules.json')).rules;
    const generated = squash(`${policyBlock()}\n${routingMapText()}`);
    const restated = Object.entries(registry)
        .filter(([, r]) => r.owner && /^stack\/rules\/baseline-/.test(r.owner.file))
        .filter(([, r]) => generated.includes(squash(r.owner.marker)))
        .map(([id]) => id);
    assert.deepStrictEqual(restated, ['navigation-edit-tools']);
});

test('I24: the report prints one locked-server row, and --verify passes a rule built from it', () =>
{
    const { root, home } = project('locked-row');
    const { out } = run([], { cwd: root, home });
    const rows = rowsOf(out);
    assert.equal(rows.length, 2, rows.join('\n'));
    assert.equal(rows.filter((r) => /^- `navigation`, `documentation`, `memory` - /.test(r)).length, 1, rows.join('\n'));
    assert.equal(rows.filter((r) => /^- `browser-chrome` - /.test(r)).length, 1, rows.join('\n'));
    const partial = rowsOf(run([], { cwd: project('locked-partial', { servers: ['memory', 'navigation'] }).root, home }).out);
    assert.deepStrictEqual(partial.map((r) => /^- ((?:`[^`]+`(?:, )?)+) - /.exec(r)[1]), ['`navigation`, `memory`'], 'a locked server the install lacks is not named');

    const skill = read(`${CAPS_DIR}/SKILL.md`).split('\n');
    const at = skill.findIndex((l) => /<!--\s*policy-rev:/.test(l));
    const rule = write(path.join(root, 'composed.md'), [
        '---', 'description: generated', '---', '', '# This project\'s capabilities', '', 'Captured: 2026-09-29 from 2.1.3@abcdef1', '',
        '## Usage policy (fixed - stamped verbatim, every run)', skill[at], policyBlock(), '',
        '## Orchestration skills (slash-only - invisible until invoked)', '/alfred-capture-agent-capabilities - x', '',
        '## Subagent seats', 'aspnet-verifier', '', '## MCP routing', ...rows, '',
    ].join('\n'));
    const verified = run(['--verify', rule], { cwd: root, home });
    assert.match(verified.out, /slots:\s+ok/);
    assert.match(verified.out, /mcp rows:\s+ok - 2 of 2/);
    assert.match(verified.out, /VERIFY:\s+PASS/);
    assert.equal(verified.status, 0, verified.out);
});

// ------------------------------------------------------------------ I12 (prose half)

test('I12: the navigation rule and the locked row keep rename and safe delete, every other edit on Edit / Write', () =>
{
    const nav = squash(read('stack/rules/baseline-navigation.md'));
    assert.ok(!nav.includes('symbol edits and the memory handoff stay on the navigation server'), 'the old edit routing is gone');
    const line = 'keeps symbol lookup, `rename_symbol`, `safe_delete_symbol` and the seat memory handoff';
    assert.ok(nav.includes(line), 'baseline-navigation.md');
    assert.ok(nav.includes('every other edit goes through Edit / Write'), 'baseline-navigation.md');
    const map = squash(routingMapText());
    assert.ok(map.includes(line) && map.includes('every other edit goes through Edit / Write'), 'the template row');
    assert.ok(!map.includes('symbol-level editor'), 'the row no longer sells the server as an editor');
});

// ------------------------------------------------------------------ I45 + I10 (prose half)

test('I45: the macOS row leads with the failed start, and an empty snapshot only past the skip switch', () =>
{
    const row = squash(routingMapText().split('\n').find((l) => l.startsWith('- `macos-desktop`')));
    assert.ok(!row.includes('an empty snapshot means the Accessibility grant is missing'), row);
    assert.ok(row.includes('fails to connect at start') && row.includes('System Settings opens'), row);
    assert.ok(row.includes('`MACOS_MCP_SKIP_PERMISSION_CHECK=1`'), row);
    assert.ok(row.includes('`Shell`') && row.includes('`<docs-path>/flow/DESKTOP-EXEC-ALLOW`'), row);
});

test('I10: the Windows row says FileSystem is off and App launch_executable is denied without the receipt', () =>
{
    const row = squash(routingMapText().split('\n').find((l) => l.startsWith('- `windows-desktop`')));
    assert.ok(row.includes('`FileSystem`'), row);
    assert.ok(row.includes('`launch_executable`') && row.includes('`<docs-path>/flow/DESKTOP-EXEC-ALLOW`'), row);
});
