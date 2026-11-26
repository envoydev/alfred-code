// scripts/guard-ask-sweep.test.js - the proof that no PreToolUse block was left outside the shared helper (guards ask instead
// of block, 2026-11-25, Task 7). A hook source line that writes a `deny` or exits 2 must carry a marker naming why it may
// stay; the marker counts per file are pinned, so a marker added to hide a missed site changes a count and fails here.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { verdictOf, blockText } = require('./hook-test-env');
const { repo, section } = require('./docs-fixture');
const { canAsk } = require('../stack/hooks/hook-prelude.js');

const ROOT = path.join(__dirname, '..');
// scripts/run-dir-gate writes the run-dir gate's verdict (setup-plugin/hooks/run-dir-gate.js hands it to emit), so it is swept too.
const HOOK_DIRS = ['stack/hooks', 'setup-plugin/hooks', 'scripts/run-dir-gate'];
const PRELUDE = 'hook-prelude.js';
// The deny forms read: a PreToolUse deny verdict, an exit 2 (literal, DENY_EXIT or a `{ code: 2 }` result) and a top-level
// `decision: 'block'`, which Claude Code still reads as a deny on PreToolUse.
const DENY_RE = /permissionDecision:\s*['"]deny['"]|process\.exit\(\s*(?:2|DENY_EXIT)\s*\)|\bcode:\s*2\b|['"]?\bdecision['"]?\s*:\s*['"]block['"]/;
// An exit through a variable counts when the same function sets that variable to 2 (the blockCall fallback: `let code = 2`).
// Out of reach: a variable set to 2 by another route (a ternary, a call, another function).
const VARIABLE_EXIT_RE = /process\.exit\(\s*([A-Za-z_$][\w$]*)\s*\)/;
const FUNCTION_START_RE = /^(?:async\s+)?function\b|^(?:const|let|var)\s/;
const SCOPE_END_RE = /^\}/;
const escapeRegExp = (text) => text.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');
const setsToTwoInFunction = (name, lines, k) => {
  const assignment = new RegExp(`(?:^|[^\\w$.])${escapeRegExp(name)}\\s*=\\s*2\\s*;`);
  for (let j = k - 1; j >= 0; j--) {
    if (SCOPE_END_RE.test(lines[j])) return false;
    if (assignment.test(lines[j])) return true;
    if (FUNCTION_START_RE.test(lines[j])) return false;
  }
  return false;
};
// The run-dir gate keeps its verdict words in its own VERDICT constant, so that form is read in its folder only.
const RUN_DIR_FOLDER = 'scripts/run-dir-gate/';
const RUN_DIR_DENY_RE = /\bVERDICT\.deny\b/;
const denyIn = (rel, line) => DENY_RE.test(line) || (rel.startsWith(RUN_DIR_FOLDER) && RUN_DIR_DENY_RE.test(line));
const variableExitIn = (line, lines, k) => {
  const exit = VARIABLE_EXIT_RE.exec(line);
  return Boolean(exit) && setsToTwoInFunction(exit[1], lines, k);
};
const MARKER = Object.freeze({
  stop: '// guard-ask: Stop hold',
  combine: '// guard-ask: combine re-emits a deny',
  cli: '// guard-ask: CLI usage',
  fallback: '// guard-ask fallback: no prelude',
  runDir: '// guard-ask: run-dir verdict',
  blockCall: '// guard-ask: blockCall exit',
  postToolUse: '// guard-ask: PostToolUse void',
});
// The marker count each file carries today, by marker. A site added to a Stop branch or a CLI usage exit changes one on purpose.
const EXPECTED_MARKERS = Object.freeze({
  'stack/hooks/guard-stop-contract.js': { [MARKER.stop]: 11, [MARKER.fallback]: 1, [MARKER.blockCall]: 1 },
  'stack/hooks/shell-guards.js': { [MARKER.combine]: 1, [MARKER.fallback]: 1 },
  'stack/hooks/guard-secret-value.js': { [MARKER.cli]: 2, [MARKER.blockCall]: 1 },
  'stack/hooks/secrets-run.js': { [MARKER.cli]: 1 },
  'stack/hooks/docs-session.js': { [MARKER.fallback]: 1, [MARKER.stop]: 2 },
  'stack/hooks/preferences-session.js': { [MARKER.fallback]: 1 },
  'setup-plugin/hooks/guard-layer-table.js': { [MARKER.fallback]: 1, [MARKER.blockCall]: 1, [MARKER.postToolUse]: 1 },
  // the Stop block of the turn build check, and the usage exits of the handoff CLI
  'stack/hooks/check-turn-build.js': { [MARKER.stop]: 1 },
  'stack/hooks/handoff.js': { [MARKER.cli]: 7 },
  // each guard's own blockCall: its exit is the code the prelude chose, 2 only where the prelude is missing
  'stack/hooks/guard-catastrophic-rm.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-config-protection.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-cross-project-write.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-fresh-session-start.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-protected-force-push.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-read-whole-file.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-unapproved-dispatch.js': { [MARKER.blockCall]: 1 },
  'stack/hooks/guard-ungated-commit.js': { [MARKER.blockCall]: 1 },
  // the verdict builder and its answer; emit asks through the helper, so each site only names the verdict
  'scripts/run-dir-gate/verdict.js': { [MARKER.runDir]: 2 },
  'scripts/run-dir-gate/effects.js': { [MARKER.runDir]: 2 },
});
// Every hook with a PreToolUse block (the map of this change) routes it through the helper.
const BLOCKING_HOOKS = [
  'shell-guards', 'preferences-session', 'guard-catastrophic-rm', 'guard-protected-force-push', 'guard-read-whole-file',
  'guard-secret-value', 'guard-config-protection', 'guard-cross-project-write', 'guard-data-class', 'guard-ungated-commit',
  'guard-fresh-session-start', 'guard-unapproved-dispatch', 'guard-stop-contract', 'docs-session',
].map((name) => `stack/hooks/${name}.js`).concat('setup-plugin/hooks/guard-layer-table.js', 'scripts/run-dir-gate/effects.js');

const hookFiles = () => HOOK_DIRS.flatMap((dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.js') && f !== PRELUDE).map((f) => `${dir}/${f}`));
const linesOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
const markerIn = (line) => Object.values(MARKER).find((m) => line.includes(m));
// Every unmarked deny site of one file: a marker on the site's own line or the line before it clears it.
const unmarkedSites = (rel, lines) => lines.flatMap((line, k) => {
  if (!(denyIn(rel, line) || variableExitIn(line, lines, k)) || line.includes(MARKER.fallback)) return [];
  return markerIn(line) || (k > 0 && markerIn(lines[k - 1])) ? [] : [`${rel}:${k + 1}`];
});

test('no PreToolUse deny is left outside the prelude', () => {
  const unmarked = hookFiles().flatMap((rel) => unmarkedSites(rel, linesOf(rel)));
  assert.deepStrictEqual(unmarked, [], `a deny or exit 2 with no marker - route it through askOrBlock (blockCall), never add a marker: ${unmarked.join(', ')}`);
});

test('the marker counts per file are pinned, so a marker cannot hide a missed site', () => {
  const found = {};
  for (const rel of hookFiles()) {
    for (const line of linesOf(rel)) {
      for (const marker of Object.values(MARKER)) if (line.includes(marker)) { found[rel] ||= {}; found[rel][marker] = (found[rel][marker] || 0) + 1; }
    }
  }
  assert.deepStrictEqual(found, EXPECTED_MARKERS);
});

test('every blocking hook routes through the helper', () => {
  for (const rel of BLOCKING_HOOKS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /\baskOrBlock\b|\bblockVerdict\b/, `${rel} calls askOrBlock (or the dispatcher's blockVerdict)`);
  }
  const files = new Set(hookFiles());
  for (const rel of BLOCKING_HOOKS) assert.ok(files.has(rel), `${rel} is a hook file the sweep reads`);
});

test('the run-dir gate hands its deny to the helper', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'setup-plugin/hooks/run-dir-gate.js'), 'utf8');
  assert.match(hook, /emit\([^;]*\bprelude\b[^;]*\);/, 'the hook passes the prelude to emit');
});

test('B62: SubagentHandback denies in default, auto and dontAsk through canAsk', () => {
  for (const permission_mode of ['default', 'auto', 'dontAsk', undefined]) {
    assert.strictEqual(canAsk({ tool_name: 'SubagentHandback', permission_mode }, {}), false, String(permission_mode));
    assert.strictEqual(canAsk({ tool_name: 'Bash', permission_mode }, {}), permission_mode !== 'dontAsk', `a Bash call in ${permission_mode}`);
  }
});

test('B62: a docs-session hold on a hand-back is a deny in default, auto and dontAsk', () => {
  const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
  const ALLOW = { ALFRED_CODE_DOCS_GATE: '0' };
  const patterns = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.');
  const watch = JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }] });
  for (const mode of ['default', 'auto', 'dontAsk']) {
    const r = repo({ tracked: true, files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': patterns, 'watch.json': watch } });
    try {
      const session = `sweep-${process.pid}-${mode}`;
      const seat = { session_id: session, agent_id: 'h1', agent_type: 'dotnet-implementer' };
      r.hook({ hook_event_name: 'SubagentStart', ...seat, agent_id: 'agent-h1' }, GIT);
      r.hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/Api/Program.cs' }, ...seat }, { ...GIT, ...ALLOW });
      r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
      const out = r.hook({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message: 'status: DONE\ncontract_version: 3' }, permission_mode: mode, ...seat }, GIT);
      assert.strictEqual(verdictOf(out), 'deny', `${mode}: ${out.stdout}`);
      assert.match(blockText(out), /^Docs check: you changed src\/Api\/Program\.cs/, mode);
    } finally { r.rm(); }
  }
});

test('the VERDICT.deny form is read in the run-dir gate folder only, and every other deny form is read everywhere', () => {
  const verdictLine = "if (trusted) return { decision: VERDICT.deny, reason };";
  assert.ok(denyIn('scripts/run-dir-gate/verdict.js', verdictLine), 'the run-dir gate names its deny through VERDICT');
  assert.ok(!denyIn('stack/hooks/forge-gate.js', verdictLine), 'another hook has no VERDICT constant to read');
  for (const rel of ['scripts/run-dir-gate/effects.js', 'stack/hooks/shell-guards.js', 'setup-plugin/hooks/guard-layer-table.js']) {
    assert.ok(denyIn(rel, "out = { permissionDecision: 'deny' };"), `${rel}: a deny verdict`);
    assert.ok(denyIn(rel, 'process.exit(2);'), `${rel}: an exit 2`);
    assert.ok(denyIn(rel, 'process.exit( DENY_EXIT )'), `${rel}: the shared exit name`);
    assert.ok(!denyIn(rel, "out = { permissionDecision: 'ask' };"), `${rel}: an ask is no deny`);
  }
});

test('an unmarked exit through a variable set to 2 in its own function is a deny site', () => {
  const blockCall = ['function blockCall(input, text) {', '  let code = 2;', '  try { code = pick(input); }', '  catch { process.stderr.write(text); }', '  process.exit(code);', '}'];
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', blockCall), ['stack/hooks/x.js:5']);
  const marked = blockCall.map((line) => (line.includes('process.exit') ? `${line} // guard-ask: blockCall exit` : line));
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', marked), []);
  const other = ['function first() {', '  let code = 2;', '  return code;', '}', 'function second(code) {', '  process.exit(code);', '}'];
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', other), [], 'a variable set to 2 in another function is no deny');
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ['if (run) main().then((code) => process.exit(code));']), [], 'a variable with no 2 in sight is no deny');
});

test('an unmarked { code: 2 } result is a deny site', () => {
  const lines = ["  return {", '    code: 2,', "    stderr: text,", '  };'];
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', lines), ['stack/hooks/x.js:2']);
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ['    code: 2, // guard-ask: Stop hold']), []);
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ['    code: 20,', '    code: 0,']), [], 'only the code 2 is a deny');
});

test("an unmarked top-level decision: 'block' is a deny site", () => {
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ["  out.write(JSON.stringify({ decision: 'block', reason }));"]), ['stack/hooks/x.js:1']);
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ['  out.write(\'{"decision":"block"}\');']), ['stack/hooks/x.js:1'], 'the quoted key spelling');
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ["  // guard-ask: Stop hold", "  out.write(JSON.stringify({ decision: 'block', reason }));"]), []);
  assert.deepStrictEqual(unmarkedSites('stack/hooks/x.js', ["  out.write(JSON.stringify({ decision: 'approve' }));"]), []);
});
