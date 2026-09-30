'use strict';
// Content assertions for the 2.1.4 audit's hooks package (merged.md I1-I5, the hook half of I10 and I12).
// Behaviour lives in each hook's own suite; these pin the prose and the single-home facts the fixes made true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'stack', 'hooks');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// I1: the shell route is ONE list in shell-writes.js; the inline copies (four pinned, one unpinned) are gone.
test('I1: every shell guard reads the shell route from shell-writes.js, and no hook keeps its own copy', () => {
  const sw = require(path.join(HOOKS, 'shell-writes.js'));
  assert.deepStrictEqual(sw.SHELL_TOOLS, ['Bash', 'PowerShell', 'Monitor']);
  for (const f of fs.readdirSync(HOOKS).filter((n) => n.endsWith('.js') && n !== 'shell-writes.js'))
    assert.doesNotMatch(fs.readFileSync(path.join(HOOKS, f), 'utf8'), /const isShellTool = \(n\) =>/, `${f} keeps an inline shell-route copy`);
  for (const f of ['guard-cross-project-write.js', 'guard-config-protection.js', 'guard-read-whole-file.js', 'guard-secret-value.js', 'docs-session.js'])
    assert.match(fs.readFileSync(path.join(HOOKS, f), 'utf8'), /shell-writes\.js/, `${f} requires the shared module`);
  assert.strictEqual(require(path.join(HOOKS, 'shell-guards.js')).MATCHER, sw.SHELL_TOOLS.join('|'), 'the dispatcher matches the same list');
  const rules = JSON.parse(read('meta/shared-rules.json'));
  assert.ok(!('shell-tool-route' in (rules.rules || rules)), 'the pin on the inline copies is retired');
});

const claude = () => require('./claude-docs.js').readClaudeDocs();
const manifestRows = () => JSON.parse(read('meta/stack-manifest.json')).hooks;

test('I1: CLAUDE.md names the Monitor route and the widened dispatcher matcher', () => {
  const text = claude();
  assert.match(text, /The eight guards with a\s+`Bash\|PowerShell\|Monitor` row are wired as ONE hook/);
  assert.doesNotMatch(text, /The eight guards with a\s+`Bash\|PowerShell` row/);
  for (const row of manifestRows().filter((r) => !r.matcher.startsWith('@') && /(^|\|)Bash(\||$)/.test(r.matcher)))
    assert.strictEqual(row.matcher, 'Bash|PowerShell|Monitor', `${row.file}: every shell row names Monitor`);
});

test('I2: CLAUDE.md states the comparison verbs and the probed git redactor', () => {
  const text = claude();
  assert.match(text, /comparison verbs \(`diff`, `sdiff`, `cmp`, `comm`, `rev`\)\s+are judged like `cat`/);
  assert.match(text, /--redact-stdin/);
  assert.match(text, /`git diff --exit-code` prints\s+unmasked, a stated ceiling/);
});

test('I3: the ask wiring is no longer described as injection-only, never denying', () => {
  const text = claude();
  assert.doesNotMatch(text, /INJECTION-ONLY, never denying: PreToolUse `AskUserQuestion`/);
  assert.match(text, /the one DENY is the ask's own house voice/);
  const note = manifestRows().find((r) => r.file === 'guard-stop-contract.js' && r.matcher === 'AskUserQuestion').note;
  assert.doesNotMatch(note, /never denies|INJECT context into the ask being built/);
  assert.match(note, /DENY once per ask text/);
  assert.doesNotMatch(read('docs/alfred-code.html'), /AskUserQuestion wiring that remains never denies/);
});

test('I4 and I5: CLAUDE.md states the narrowed loop sweep and the identifier rule', () => {
  const text = claude();
  assert.match(text, /A shell loop is a sweep only when a `cat` in its body\s+reads the loop VARIABLE/);
  assert.match(text, /'reference to' \/\s+'usages of' count only before a code identifier/);
});

test('I10: the desktop gate is one wired hook, counted everywhere the hooks are counted', () => {
  const rows = manifestRows().filter((r) => r.file === 'guard-desktop-exec.js');
  assert.strictEqual(rows.length, 1);
  const re = new RegExp(rows[0].matcher);
  for (const name of ['mcp__plugin_windows-desktop_windows-desktop__App', `mcp__${'windows-desktop'}__App`, 'mcp__plugin_macos-desktop_macos-desktop__Shell', `mcp__${'macos-desktop'}__Shell`])
    assert.ok(re.test(name), name);
  for (const name of ['mcp__plugin_windows-desktop_windows-desktop__Click', 'mcp__plugin_macos-desktop_macos-desktop__App', `mcp__${'windows-desktop'}__AppX`])
    assert.ok(!re.test(name), `${name} is not matched`);
  assert.match(claude(), /`stack\/hooks\/` - eighteen hooks/);
  assert.match(claude(), /all eighteen, generated from the manifest's `hooks\[\]`/);
  assert.match(claude(), /`guard-desktop-exec\.js` \(PreToolUse on the desktop servers' two process launchers/);
  assert.doesNotMatch(read('README.md'), /seventeen/);
  assert.doesNotMatch(read('docs/install-footprint.md'), /seventeen/);
  assert.doesNotMatch(read('setup-plugin/references/walk.md'), /all seventeen/);
});

test('I12: CLAUDE.md names the two kept navigation edit tools on docs-session and check-turn-build', () => {
  const text = claude();
  assert.match(text, /the navigation server's two kept edit tools `rename_symbol` \/ `safe_delete_symbol` - held like an Edit/);
  assert.match(text, /`check-turn-build\.js` \(`PostToolUse` on `Write\|Edit\|MultiEdit` and the navigation server's `rename_symbol` \/\s+`safe_delete_symbol`/);
});
