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
  assert.match(text, /The ten guards with a\s+`Bash\|PowerShell\|Monitor` row are wired as ONE hook/);
  assert.doesNotMatch(text, /The eight guards with a\s+`Bash\|PowerShell` row/);
  for (const row of manifestRows().filter((r) => !r.matcher.startsWith('@') && /(^|\|)Bash(\||$)/.test(r.matcher)))
    assert.strictEqual(row.matcher, 'Bash|PowerShell|Monitor', `${row.file}: every shell row names Monitor`);
});

test('swap 1: the hooks doc states the masker, its floor and the failure-path ceiling', () => {
  const text = claude();
  assert.match(text, /updatedToolOutput/);
  assert.match(text, /Claude Code `2\.1\.322` \(`MASKER_FLOOR`/);
  assert.match(text, /PostToolUseFailure takes no replacement output/);
  assert.match(text, /THE DENY-ON-NAME CORE/);
  assert.match(text, /THE STORE CHECK/);
  assert.match(text, /a COMPARISON naming a credential file[\s\S]*an ENCODER over one[\s\S]*a print that is NOT ALONE/);
  assert.doesNotMatch(text, /--redact-stdin/);
  assert.doesNotMatch(text, /are REWRITTEN via/);
  const notes = Object.fromEntries(manifestRows().filter((r) => r.file === 'guard-secret-value.js').map((r) => [r.matcher, r.note]));
  assert.match(notes['Bash|PowerShell|Monitor'], /the store check/);
  assert.match(notes['Bash|PowerShell|Monitor'], /a comparison naming a credential file, an encoder over one, a print that is not alone/);
  assert.match(notes['Bash|PowerShell|Monitor'], /the deny-on-name core/);
  assert.match(notes['Bash|PowerShell|Monitor'], /Nothing is rewritten/);
  assert.doesNotMatch(notes['@SessionStart'], /a dump masked and a source or copy refused/);
  assert.match(notes['@SessionStart'], /a copy refused and what a shell read printed comes back masked/);
});

test('I3: the ask wiring is no longer described as injection-only, never denying', () => {
  const text = claude();
  assert.doesNotMatch(text, /INJECTION-ONLY, never denying: PreToolUse `AskUserQuestion`/);
  assert.match(text, /the ask's own SHAPE is FIXED IN PLACE when every reason is\s+mechanical/);
  const note = manifestRows().find((r) => r.file === 'guard-stop-contract.js' && r.matcher === 'AskUserQuestion').note;
  assert.doesNotMatch(note, /never denies|INJECT context into the ask being built/);
  assert.match(note, /FIX IN PLACE an ask whose own shape is mechanically wrong .* through updatedInput with no decision; DENY once per ask text/);
  assert.doesNotMatch(read('docs/alfred-code.html'), /AskUserQuestion wiring that remains never denies/);
});

test('I4 and I5: CLAUDE.md states the narrowed loop sweep and the identifier rule', () => {
  const text = claude();
  assert.match(text, /A shell loop is a sweep only when a `cat` in its body\s+reads the loop VARIABLE/);
  assert.match(text, /'reference to' \/\s+'usages of' count only before a code identifier/);
});

test('I10 / stage 1 B12: the desktop gate is retired, and the hooks are counted as the manifest wires them', () => {
  // The desktop exec guard left in complexity stage 1 (B12): no row, no file; the rule loader joined in workspace stage 4a,
  // so the count everywhere is eighteen.
  assert.strictEqual(manifestRows().filter((r) => r.file === 'guard-desktop-exec.js').length, 0);
  assert.match(claude(), /`stack\/hooks\/` - eighteen hooks/);
  assert.match(claude(), /all eighteen, generated from the manifest's `hooks\[\]`/);
  assert.doesNotMatch(claude(), /`guard-desktop-exec\.js` \(PreToolUse/);
  // The stale hook count, never the word itself: the footprint counts seventeen references.
  assert.doesNotMatch(read('README.md'), /seventeen (?:wired |stack )?hooks/);
  assert.doesNotMatch(read('docs/install-footprint.md'), /seventeen (?:wired |stack |house )?hooks/);
  // The walk's own count follows the manifest's hook files (hooks track H6, 2026-10-21: the pin forbade 'all eighteen'
  // from the days eighteen was stale, and preferences-session made it right again).
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two'];
  const walk = read('setup-plugin/references/walk.md');
  const counted = [...walk.matchAll(/\ball ([a-z-]+teen|[a-z]+ty(?:-[a-z]+)?)\b/g)].map((m) => m[1]);
  assert.ok(counted.length, 'the walk counts its hooks');
  assert.deepStrictEqual([...new Set(counted)], [words[new Set(manifestRows().map((r) => r.file)).size]]);
  assert.doesNotMatch(walk, /monitor-session/);
});

test('I12: CLAUDE.md names the two navigation edit tools on docs-session and check-turn-build', () => {
  const text = claude();
  // N6 (2026-10-24): a navigation server's tools under any registration name, since the stack ships none.
  assert.match(text, /a navigation server's two edit tools `rename_symbol` \/ `safe_delete_symbol` under any registration name \(N6\) - held like an Edit/);
  assert.match(text, /`check-turn-build\.js` \(`Stop` only\)[\s\S]{0,400}The turn's files come from git/, 'the build check reads git at Stop, so the navigation server\'s edits need no wiring of their own');
});

// Audit 2026-10-14 HK08: the rule, the audit skill and the HTML said 80 / 50 for the two dispatchers' timeouts, 'five' file
// guards and 'seven' (then 'eight') shell guards, while the generated wiring stamped 90 / 60 over nine and six. The numbers
// are read from the tables that produce them, so the prose moves with a guard added or dropped.
test('HK08: the dispatcher timeouts and guard counts in the prose are the ones HOOK_TIMEOUTS and the GUARDS tables give', () => {
  const { HOOK_TIMEOUTS } = require(path.join(ROOT, 'scripts', 'install', 'settings.js'));
  const shellGuards = require(path.join(HOOKS, 'shell-guards.js'));
  const fileGuards = require(path.join(HOOKS, 'file-guards.js'));
  const shellSecs = HOOK_TIMEOUTS['shell-guards.js'].PreToolUse;
  const fileSecs = HOOK_TIMEOUTS['file-guards.js'].PreToolUse;
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const nShell = words[shellGuards.GUARDS.length];
  const nFile = words[fileGuards.GUARDS.length];
  const rule = read('.claude/rules/repo-hooks.md');
  assert.match(rule, new RegExp(`\`shell-guards\\.js\`'s ${shellSecs} and \`file-guards\\.js\`'s ${fileSecs} `), 'the rule states the generated timeouts');
  assert.match(rule, new RegExp(`The ${nFile} guards with a file-tool row ride ONE hook`), 'the rule counts the file guards');
  assert.match(rule, new RegExp(`The ${nShell} guards with a\\s+\`Bash\\|PowerShell\\|Monitor\` row`), 'the rule counts the shell guards');
  assert.match(read('.claude/skills/repo-audit-hooks/references/discovery.md'), new RegExp(`the ${nShell} \`Bash\\|PowerShell\\|Monitor\` PreToolUse guards`));
  const html = read('docs/alfred-code.html');
  assert.match(html, new RegExp(`The ${nShell} guards judging a Bash, PowerShell or Monitor call run in ONE process, <code>shell-guards\\.js</code> \\(timeout ${shellSecs}s`));
  assert.match(html, new RegExp(`the ${nFile} judging a file tool in another, <code>file-guards\\.js</code> \\(timeout ${fileSecs}s`));
  assert.match(read('.claude/skills/repo-audit-hooks/references/rubric.md'), /^Six dimensions, 100 points per hook\./m, 'the rubric counts its own six (HK17)');
});
