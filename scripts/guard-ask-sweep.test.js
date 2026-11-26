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
const DENY_RE = /permissionDecision:\s*['"]deny['"]|process\.exit\(\s*(?:2|DENY_EXIT)\s*\)|\bVERDICT\.deny\b/;
const MARKER = Object.freeze({
  stop: '// guard-ask: Stop hold',
  combine: '// guard-ask: combine re-emits a deny',
  cli: '// guard-ask: CLI usage',
  fallback: '// guard-ask fallback: no prelude',
  runDir: '// guard-ask: run-dir verdict',
});
// The marker count each file carries today, by marker. A site added to a Stop branch or a CLI usage exit changes one on purpose.
const EXPECTED_MARKERS = Object.freeze({
  'stack/hooks/guard-stop-contract.js': { [MARKER.stop]: 11, [MARKER.fallback]: 1 },
  'stack/hooks/shell-guards.js': { [MARKER.combine]: 1 },
  'stack/hooks/guard-secret-value.js': { [MARKER.cli]: 2 },
  'stack/hooks/secrets-run.js': { [MARKER.cli]: 1 },
  'stack/hooks/docs-session.js': { [MARKER.fallback]: 1 },
  'stack/hooks/preferences-session.js': { [MARKER.fallback]: 1 },
  'setup-plugin/hooks/guard-layer-table.js': { [MARKER.fallback]: 1 },
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

test('no PreToolUse deny is left outside the prelude', () => {
  const unmarked = [];
  for (const rel of hookFiles()) {
    const lines = linesOf(rel);
    lines.forEach((line, k) => {
      if (!DENY_RE.test(line) || line.includes(MARKER.fallback)) return;
      if (!markerIn(line) && !(k > 0 && markerIn(lines[k - 1]))) unmarked.push(`${rel}:${k + 1}`);
    });
  }
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
