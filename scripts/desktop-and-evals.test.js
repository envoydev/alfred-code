'use strict';
// The 2.1.4 audit's plugin package (merged.md I9, I10, I11, I12, I45): the prose and structure facts its
// fixes rest on, held as content assertions - the wrong claim absent, the right one present. The
// behaviour itself is pinned where it runs (build-marketplace, install-mcp).
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

// ---------------------------------------------------------------- I10 - the desktop tool gate
// Ruling 'Gate + observe grants': FileSystem joins the default exclude list on both routes, and a house
// guard denies App's launch_executable mode and every macOS Shell call unless DESKTOP-EXEC-ALLOW allows it.
test('I10: the skill and windows.md say what stays on and that a house guard denies App launch_executable unless DESKTOP-EXEC-ALLOW allows it', () =>
{
    const skill = flat(read('stack/skills/desktop-automation/SKILL.md'));
    // stack audit 2026-10-20 row 14: Windows-MCP 0.8.8 enables every tool; since 2026-10-24 the user's registration excludes them
    assert.match(skill, /Windows-MCP enables every tool by default, so it is registered with PowerShell, Registry, Process and FileSystem excluded unless the user wants them/);
    assert.match(skill, /a house guard denies App's `launch_executable` mode[^.]*and every MacOS-MCP `Shell` call unless the user allowed it in `<data root>\/state\/approvals\/DESKTOP-EXEC-ALLOW`/);
    const win = flat(read('stack/skills/desktop-automation/references/windows.md'));
    assert.match(win, /--exclude-tools PowerShell,Registry,Process,FileSystem/);
    assert.match(win, /What stays on:/);
    assert.match(win, /a house guard denies that mode unless the user allowed it in `<data root>\/state\/approvals\/DESKTOP-EXEC-ALLOW`/);
    assert.doesNotMatch(win, /`Notification`, `FileSystem`, and - switched off/, 'FileSystem is no longer among the tools left on');
    const mac = flat(read('stack/skills/desktop-automation/references/macos.md'));
    assert.match(mac, /A house guard denies every `Shell` call[^.]*unless the user allowed it in `<data root>\/state\/approvals\/DESKTOP-EXEC-ALLOW`/);
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

test('I9: the size-first cases live with the library cases, where the eval bundle carries task-solve', () =>
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

// ---------------------------------------------------------------- SD08 - screenshot size and the Observe price
// Audit 2026-10-11, sessions 7f8803eb and fdce35ae: a Windows Snapshot measured 10-30k chars against ~2.4-2.7k tokens
// for a full-size screenshot, so 'Snapshot first ... an image is paid for on every later turn' steered to the dearer
// look, and the 85 full-size screenshots of the two runs were re-sent on every later turn with the scale knob never
// in view. The scale value itself is observe-first: the stack names WINDOWS_MCP_SCREENSHOT_SCALE and seeds none.
test('SD08: the Observe step picks the look by the question and names the scale knob', () =>
{
    const skill = flat(read('stack/skills/desktop-automation/SKILL.md'));
    assert.doesNotMatch(skill, /Snapshot first, with its UI tree and without vision\. Ask for vision \(a screenshot\) only/, 'the one-route rule that priced the image as the dear side');
    assert.match(skill, /\*\*To address an element\*\*[^*]*Snapshot with its UI tree and without vision/);
    assert.match(skill, /\*\*To check a state\*\*[^*]*on Windows a `Screenshot`/);
    assert.match(skill, /measured at 10-30k chars/);
    assert.match(skill, /MacOS-MCP has no Screenshot tool: its image is Snapshot with vision/);
    assert.match(skill, /`WINDOWS_MCP_SCREENSHOT_SCALE` \(0\.1 to 1\.0, default 1\.0 - full size\)[^.]*the stack seeds no value/);
    assert.match(skill, /no Snapshot, Screenshot or WaitFor between/);
    assert.match(skill, /`Snapshot`, `Click`, `Type`, `WaitFor` and `Screenshot` on Windows-MCP/, 'the Windows load line takes Screenshot');
    const win = flat(read('stack/skills/desktop-automation/references/windows.md'));
    assert.match(win, /How far a 1080p and a 4K desktop can shrink and stay readable is not measured yet\./);
});
