'use strict';
// The 2.1.4 audit's plugin package (merged.md I9, I10, I11, I12, I45): the prose and structure facts its
// fixes rest on, held as content assertions - the wrong claim absent, the right one present. The
// behaviour itself is pinned where it runs (build-marketplace, mcp-launchers, install-mcp, install-desktop).
const test = require('node:test');
const assert = require('node:assert');
const { readClaudeDocs } = require('./claude-docs.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Prose wraps lines; a claim is matched over its words, not its line breaks.
const flat = (text) => text.replace(/\s+/g, ' ');

// ---------------------------------------------------------------- I45 - the macOS permission diagnosis
// macos-mcp 0.4.6 `serve()` calls validate_permissions() first (__main__.py:629-630); a missing grant
// with MACOS_MCP_SKIP_PERMISSION_CHECK unset logs 'Required permissions not granted: ...', opens System
// Settings and sys.exit(1) (permissions.py:154-177). An empty snapshot needs the skip switch first.
test('I45: the desktop skill leads the macOS diagnosis with the failed start, not an empty snapshot', () =>
{
    const skill = flat(read('stack/skills/desktop-automation/SKILL.md'));
    assert.match(skill, /macOS: the server fails to connect at start and System Settings opens\*\* - a grant is missing, and its log names which/);
    assert.match(skill, /`MACOS_MCP_SKIP_PERMISSION_CHECK=1`[^.]*starts ungranted[^.]*empty snapshot/);
    assert.doesNotMatch(skill, /\*\*macOS: an empty snapshot\*\*/, 'the old lead describes a state the pinned server never reaches by default');
});

test('I45: macos.md says a missing grant stops the start, and the skip switch is what makes an empty snapshot reachable', () =>
{
    const ref = flat(read('stack/skills/desktop-automation/references/macos.md'));
    assert.match(ref, /The server fails to connect at start, and System Settings opens by itself\./);
    assert.match(ref, /exits when one is missing/);
    assert.match(ref, /`MACOS_MCP_SKIP_PERMISSION_CHECK=1`[^.]* makes it start ungranted/);
    assert.match(ref, /Only then does an \*\*empty snapshot\*\*/);
    assert.doesNotMatch(ref, /stops that\./, 'the skip switch does more than stop the Settings pop-up');
});

test('I45: the installer\'s macOS prerequisite line names the failed start first', () =>
{
    const { prereqNotes } = require('../stack/mcp/desktop-launch.js');
    const lines = prereqNotes('macos-desktop').join('\n');
    assert.match(lines, /a server that fails to connect at start while System Settings opens is missing a grant - its log names which; a black vision snapshot means Screen Recording is missing/);
    assert.doesNotMatch(lines, /an empty snapshot means Accessibility is missing/);
});

// ---------------------------------------------------------------- I10 - the desktop tool gate
// Ruling 'Gate + observe grants': FileSystem joins the default exclude list on both routes, and a house
// guard denies App's launch_executable mode and every macOS Shell call unless DESKTOP-EXEC-ALLOW allows it.
test('I10: FileSystem is in the default gate, and the launcher comment states what stays on', () =>
{
    const { DEFAULT_EXCLUDE, copyRouteExclude } = require('../stack/mcp/desktop-launch.js');
    assert.deepStrictEqual(DEFAULT_EXCLUDE.split(','), ['PowerShell', 'Registry', 'Process', 'FileSystem']);
    assert.strictEqual(copyRouteExclude({ env: {} }), DEFAULT_EXCLUDE, 'the copy route resolves the same list');
    const launcher = flat(read('stack/mcp/desktop-launch.js'));
    assert.doesNotMatch(launcher, /shell, registry and process control stay off\./, 'the old comment left file writes and App out');
    assert.match(launcher, /`App` stays on[^.]*launch_executable/);
    const note = read('meta/stack-manifest.json');
    assert.match(note, /PowerShell, Registry, Process and FileSystem off/);
});

test('I10: the skill and windows.md say what stays on and that a house guard denies App launch_executable unless DESKTOP-EXEC-ALLOW allows it', () =>
{
    const skill = flat(read('stack/skills/desktop-automation/SKILL.md'));
    assert.match(skill, /PowerShell, Registry, Process and FileSystem switched off/);
    assert.match(skill, /a house guard denies App's `launch_executable` mode[^.]*and every MacOS-MCP `Shell` call unless the user allowed it in `<docs-path>\/flow\/DESKTOP-EXEC-ALLOW`/);
    const win = flat(read('stack/skills/desktop-automation/references/windows.md'));
    assert.match(win, /--exclude-tools PowerShell,Registry,Process,FileSystem/);
    assert.match(win, /What stays on:/);
    assert.match(win, /a house guard denies that mode unless the user allowed it in `<docs-path>\/flow\/DESKTOP-EXEC-ALLOW`/);
    assert.doesNotMatch(win, /`Notification`, `FileSystem`, and - switched off/, 'FileSystem is no longer among the tools left on');
    const mac = flat(read('stack/skills/desktop-automation/references/macos.md'));
    assert.match(mac, /A house guard denies every `Shell` call[^.]*unless the user allowed it in `<docs-path>\/flow\/DESKTOP-EXEC-ALLOW`/);
});

// ---------------------------------------------------------------- I9 - the plugin's own evals
// Each case's command or skill must be carried by the target the README runs it against, and every
// `${CLAUDE_PLUGIN_ROOT}/<path>` that command or skill names must exist in that target.
const EVAL_README = 'setup-plugin/evals/README.md';
const promptOf = (dir) =>
{
    const md = path.join(dir, 'prompt.md');
    if (fs.existsSync(md)) return fs.readFileSync(md, 'utf8').split(/\n---\n/).slice(1).join('\n').trim();
    const y = fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8');
    const m = /^\s+prompt: \|\n((?:\s{4,}.*\n?)+)/m.exec(y);
    return m ? m[1].trim() : '';
};
const invoked = (prompt) => (/^\/([a-z0-9:-]+)/.exec(prompt) || [])[1] || null;
const pluginRefs = (text) => [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+[A-Za-z0-9_-])/g)].map((m) => m[1]);

test('I9: the README runs no case against setup-plugin/ alone, and names a target per case', () =>
{
    const readme = read(EVAL_README);
    assert.doesNotMatch(readme, /claude plugin eval setup-plugin\b/, 'setup-plugin alone resolves none of the scripts its bodies call');
    assert.match(readme, /claude plugin eval alfred-code@envoydev --eval-dir setup-plugin\/evals/);
    assert.match(readme, /npm run eval-bundle/);
    assert.match(readme, /not re-recorded/i, 'the README says the table predates the retarget');
});

test('I9: every setup-plugin/evals case invokes a command or skill the core entry carries, and every plugin path it names resolves there', () =>
{
    const { coreEntry } = require('./build-marketplace.js');
    const core = coreEntry();
    const dir = path.join(ROOT, 'setup-plugin', 'evals');
    const cases = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'results').map((e) => e.name);
    assert.ok(cases.length >= 2, cases.join(','));
    const commands = new Map(core.commands.map((c) => [`alfred-code:${path.basename(c, '.md')}`, c]));
    const skills = new Map(core.skills.map((s) => [path.basename(s), path.join(s, 'SKILL.md')]));
    for (const name of cases)
    {
        const call = invoked(promptOf(path.join(dir, name)));
        assert.ok(call, `${name}: the prompt invokes a command or skill`);
        const body = commands.get(call) || skills.get(call);
        assert.ok(body, `${name}: /${call} is not carried by the core entry (commands ${[...commands.keys()].join(',')}; skills ${[...skills.keys()].join(',')})`);
        for (const ref of pluginRefs(read(body)))
            assert.ok(fs.existsSync(path.join(ROOT, ref)), `${name}: ${body} names \${CLAUDE_PLUGIN_ROOT}/${ref}, absent from the core's root`);
    }
});

test('I9: the size-first cases live with the library cases, where the eval bundle carries alfred-task-solve', () =>
{
    const { build } = require('./build-eval-bundle.js');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-and-evals-bundle-')), 'b');
    try
    {
        build(out);
        for (const c of ['size-first-trivial', 'size-first-small', 'size-first-floor'])
        {
            assert.ok(!fs.existsSync(path.join(ROOT, 'setup-plugin', 'evals', c)), `${c} still under setup-plugin/evals`);
            assert.ok(fs.existsSync(path.join(ROOT, 'meta', 'evals', 'library', c, 'case.yaml')), `${c} is not a library case`);
            const call = invoked(promptOf(path.join(out, 'evals', c)));
            assert.ok(fs.existsSync(path.join(out, 'skills', call, 'SKILL.md')), `${c}: the bundle does not carry /${call}`);
        }
        // The bundle's commands and router name their scripts under ${CLAUDE_PLUGIN_ROOT}: each must resolve.
        const bodies = [...fs.readdirSync(path.join(out, 'commands')).map((f) => path.join(out, 'commands', f)), path.join(out, 'skills', 'alfred-code', 'SKILL.md')];
        for (const body of bodies)
            for (const ref of pluginRefs(fs.readFileSync(body, 'utf8')))
                assert.ok(fs.existsSync(path.join(out, ref)), `${path.basename(body)} names \${CLAUDE_PLUGIN_ROOT}/${ref}, absent from the bundle`);
    }
    finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- CLAUDE.md, where these changes made it false
test('CLAUDE.md states the new gate, the browser flag and the stack serena context', () =>
{
    const doc = flat(readClaudeDocs());
    assert.match(doc, /Windows-MCP starts with `--exclude-tools PowerShell,Registry,Process,FileSystem`/);
    assert.doesNotMatch(doc, /Windows-MCP starts with `--exclude-tools PowerShell,Registry,Process`;/);
    assert.match(doc, /--no-webmcp/);
    assert.match(doc, /`stack\/mcp\/navigation-context\.yml`/);
    assert.match(doc, /`\.claude\/navigation-context\.yml`/);
    assert.doesNotMatch(doc, /Cursor runs serena with `--context ide-assistant`; Claude with `claude-code`\./);
    assert.doesNotMatch(doc, /MCP entries? (?:names?|depends? on) the core/);
});
