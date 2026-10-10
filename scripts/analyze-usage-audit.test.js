'use strict';

// analyze-usage-audit.test.js - the analyzer defects the usage audit of 2026-10-10 measured, one test per
// defect, each fixture a genericized shape of the transcript rows the audited bundles carried. Every test
// failed on the analyzer before its fix (ANALYZE_USAGE_SCRIPT points the suite at another copy to show it).

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = process.env.ANALYZE_USAGE_SCRIPT || path.join(__dirname, 'analyze-usage.js');

const line = (o) => JSON.stringify(o) + '\n';
const usage = (input, cc, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
const T = (n) => `2026-07-15T07:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
const asst = (id, ts, content, extra = {}) => ({ type: 'assistant', timestamp: ts, message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, 100, 5), content, ...extra } });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const sh = (id, command, extra = {}) => tool(id, 'Bash', { command, ...extra });
const res = (ts, id, content, isError) => ({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const human = (ts, text, parent) => ({ type: 'user', timestamp: ts, parentUuid: parent || `p-${ts}`, origin: { kind: 'human' }, message: { content: text } });
const said = (id, ts, text) => asst(id, ts, [{ type: 'text', text }], { stop_reason: 'end_turn' });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-usage-audit-')); }
function write(dir, rows, name = 'session.jsonl') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, rows.map(line).join(''));
  return file;
}
const run = (args) => JSON.parse(execFileSync('node', [SCRIPT, ...args, '--json'], { encoding: 'utf8' }));
const text = (args) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

// C02 - Nx check forms. The shapes are the ones 18 audited Nx sessions ran (`nx test <p> --testFile`,
// `run-many -t a,b,c -p <p>`, `affected -t test`, `nx build <p>`, `-t lint test --projects=a,b`), each scored
// 'test 0 / build 0 / lint 0' with its commits unchecked.
test('C02: Nx targets score as test / build / lint, a runner named as an argument does not, and a commit after them is checked', () => {
  const dir = tmp();
  try {
    const rows = [
      asst('m1', T(0), [
        sh('n1', "cd /work/app; npx nx test feature-a --testFile=a.spec.ts 2>&1 | grep -E 'Tests:|FAIL'; echo \"exit $?\""),
        sh('n2', "npx nx run-many -t test,lint,typecheck -p feature-a 2>&1 | grep -E 'Successfully ran|Failed tasks' | head"),
        sh('n3', 'npx nx affected -t test --base=HEAD 2>&1 | tail -6'),
        sh('n4', 'npx nx build consumer 2>&1 | grep -E "ERROR|Successfully"'),
        sh('n5', 'npx nx run-many -t lint test --projects=ui,home,space 2>&1 | head -20'),
        sh('n6', 'npx nx run consumer:test'),
        sh('x1', 'S=/tmp/s; npx nx serve consumer --port 4200 > $S/serve.log 2>&1 &'),
        sh('x2', "grep -o '\"testFile\"' node_modules/@nx/jest/src/executors/jest/schema.json; grep -l jest libs/ui/project.json"),
        sh('p1', 'npx prettier --check libs/a.ts'),
        sh('p2', 'npx prettier --write libs/a.ts'),
        sh('a1', 'node /opt/stack/scripts/agents-md-check.js'),
        // a multi-line quoted script and a comment are text, whatever runner they name
        sh('x3', "f=AGENTS.md && perl -0pi -e '\ns/^old$/npx nx test <project> --testFile=x.spec.ts/m;\ns/a/b/;\n' $f"),
        sh('x4', "echo start # don't; npm test later\nls"),
      ]),
      ...['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'x1', 'x2', 'p1', 'p2', 'a1', 'x3', 'x4'].map((id) => res(T(1), id, 'ok')),
      asst('m2', T(2), [sh('g1', 'git commit -m done')]),
      res(T(3), 'g1', '[main abc] done'),
    ];
    const { main } = run([write(dir, rows)]);
    const c = main.efficiency.checks;
    assert.strictEqual(c.test.calls, 5, 'n1, n2, n3, n5, n6 - never the serve, never the grep naming jest');
    assert.strictEqual(c.test.scoped, 3, 'a --testFile run, a one-project run-many, a run <p>:test');
    assert.strictEqual(c.test.whole, 2, 'affected, and run-many over three projects');
    assert.strictEqual(c.build.calls, 2, 'the typecheck target and nx build');
    assert.strictEqual(c.lint.calls, 4, 'two run-many lint targets, prettier --check and the stack checker - never prettier --write');
    assert.strictEqual(main.efficiency.commitsChecked, 1);
    assert.deepStrictEqual(main.efficiency.commitsUnchecked, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C02 (f24eb967#11): a backgrounded suite writes its verdict to a log; the turn that reads the log has its check.
test('C02: reading the log a backgrounded check wrote is that check\'s result - the green claim beside it is checked', () => {
  const dir = tmp();
  try {
    const rows = [
      human(T(0), 'run the gate'),
      asst('m1', T(1), [sh('b1', 'S=/tmp/scratch; dotnet format App.slnx --verify-no-changes > $S/format.log 2>&1; echo "format_exit=$?" >> $S/format.log; dotnet test App.slnx -v minimal > $S/suite.log 2>&1', { run_in_background: true })]),
      res(T(2), 'b1', 'Command running in background with ID: b1'),
      said('m2', T(3), 'Started the format check and the suite in the background.'),
      human(T(10), 'status?'),
      asst('m3', T(11), [sh('r1', "S=/tmp/scratch; cat $S/format.log | tail -3; tail -5 $S/suite.log")]),
      res(T(12), 'r1', 'format_exit=0\nPassed!  - Failed: 0, Passed: 1650'),
      said('m4', T(13), 'The format check is clean and all 1650 tests pass.'),
      // a log nobody's check wrote is still no evidence
      human(T(20), 'and the other one?'),
      asst('m5', T(21), [sh('r2', 'tail -5 /tmp/other/notes.log')]),
      res(T(22), 'r2', 'whatever'),
      said('m6', T(23), 'The build is green.'),
    ];
    const { main } = run([write(dir, rows)]);
    const e = main.efficiency;
    assert.strictEqual(e.greenClaims, 2);
    assert.deepStrictEqual(e.unverifiedGreenClaims, [T(23)], 'only the claim with no check and no check log behind it');
    assert.strictEqual(e.checkLogReads, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
