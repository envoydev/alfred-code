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
// C07 spawns the instrumentation hook: the suite takes the containment helper every hook suite carries.
require('./hook-test-env').isolateHookSuite();

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

// C03: the GENERATED DOCS table, against the shapes 18 audited sessions used - the stack's own `docs.js` section route,
// a path bound to a variable, a runtime fed the path as argv, an in-place edit, a read of a file (or a folder above it)
// that is not there, another project's docs (by `../`, by absolute path, or relative after a `cd`), and an existence loop.
test('C03: docs.js show/set/where count from their own output; bound, argv, missing, foreign and probed paths read right', () => {
  const dir = tmp();
  try {
    const cwd = '/work/app';
    const at = (row) => ({ ...row, cwd });
    const rows = [
      at(asst('m1', T(0), [
        sh('d1', 'node .claude/hooks/docs.js show integrations#five-clients 2>&1 | head -30\nnode .claude/hooks/docs.js show slice-anatomy.md#idioms'),
        sh('d2', 'node .claude/hooks/docs.js where src/Api/Handlers.cs'),
        sh('d3', "node .claude/hooks/docs.js set architecture/ARCHITECTURE.md#known-ceilings <<'EOF'\n## Known ceilings\nEOF\necho \"set_exit=$?\""),
        sh('d4', 'node .claude/hooks/docs.js show nothing-here#x'),
        sh('v1', "cd /work/app; P=.alfred/docs/plans/2026-01-01-plan.md; cat > $P <<'EOF'\n# Plan\nEOF"),
        sh('v2', "P=.alfred/docs/plans/2026-01-01-plan.md; python3 - \"$P\" <<'PY'\nimport sys\np=sys.argv[1]; s=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nPY"),
        sh('x1', "grep -n '^#' .alfred/docs/code-style/CODE-STYLE.md | head -30"),
        sh('x2', 'cat ../sibling/.alfred/docs/cross-project-tasks/2026-01-01-card.md'),
        sh('x3', 'for p in .alfred/docs/architecture/A.md .alfred/docs/quality/Q.md; do [ -e "$p" ] && echo "$p"; done'),
        sh('x4', 'for p in .alfred/docs/quality/R.md; do cat "$p"; done'),
        sh('x5', 'ls .alfred/docs/plans/2026-01-01-plan.md'),
        tool('r1', 'Read', { file_path: '/work/other/.alfred/docs/plans/theirs.md' }),
        tool('r2', 'Read', { file_path: '/work/app/.alfred/docs/plans/ours.md' }),
        sh('y1', 'ls .alfred/docs/style/ 2>&1; grep -n x .alfred/docs/style/STYLE.md 2>/dev/null'),
        sh('y2', 'cd /work && sed -n 29,40p sibling/.alfred/docs/cross-project-tasks/2026-01-02-card.md'),
        sh('y3', "P=.alfred/docs/plans/2026-01-03-plan.md; sed -i '' 's/a/b/' $P && grep -c b $P"),
        sh('y4', 'cd .claude/worktrees/w1 && cat .alfred/docs/plans/wt.md'),
      ])),
      res(T(1), 'd1', '.alfred/docs/architecture/references/integrations.md line 414\n\n## Five clients\nbody\n\n.alfred/docs/architecture/references/slice-anatomy.md line 12\n\n## Idioms\nbody'),
      res(T(1), 'd2', 'slice-anatomy#idioms - Three handler idioms (1770 chars)\npersistence#bypass - A second bypass (1492 chars)'),
      res(T(1), 'd3', 'wrote architecture/ARCHITECTURE.md#known-ceilings into .alfred/docs/architecture/ARCHITECTURE.md\nset_exit=0'),
      res(T(1), 'd4', 'no such doc file: nothing-here. Known: integrations, slice-anatomy'),
      res(T(1), 'v1', ''),
      res(T(1), 'v2', ''),
      res(T(1), 'x1', 'ugrep: warning: .alfred/docs/code-style/CODE-STYLE.md: No such file or directory'),
      res(T(1), 'x2', '# card'),
      res(T(1), 'x3', '.alfred/docs/architecture/A.md'),
      res(T(1), 'x4', '# R'),
      res(T(1), 'x5', '.alfred/docs/plans/2026-01-01-plan.md'),
      res(T(1), 'r1', 'theirs'),
      res(T(1), 'r2', 'ours'),
      res(T(1), 'y1', 'ls: .alfred/docs/style/: No such file or directory'),
      res(T(1), 'y2', '# card'),
      res(T(1), 'y3', '2'),
      res(T(1), 'y4', '# wt'),
    ];
    const file = write(dir, rows);
    const docs = run([file]).main.docTouches;
    assert.deepStrictEqual(docs['architecture/references/integrations.md'], { reads: 0, writes: 0, bashReads: 1, docsJs: 1 });
    assert.strictEqual(docs['architecture/references/slice-anatomy.md'].bashReads, 1);
    assert.strictEqual(docs['(docs.js where - section lookup)'].bashReads, 1);
    assert.strictEqual(docs['architecture/ARCHITECTURE.md'].bashWrites, 1, 'the set wrote the file it names');
    assert.strictEqual(docs['plans/2026-01-01-plan.md'].bashWrites, 2, 'cat > $P and the argv-fed python write');
    assert.strictEqual(docs['plans/2026-01-01-plan.md'].bashReads, undefined, 'an ls of it is no read');
    assert.ok(!('code-style/CODE-STYLE.md' in docs), 'a read of a file that is not there read nothing');
    assert.ok(!('cross-project-tasks/2026-01-01-card.md' in docs), "another project's card is not this project's doc");
    assert.ok(!('architecture/A.md' in docs) && !('quality/Q.md' in docs), 'an existence loop reads nothing');
    assert.strictEqual(docs['quality/R.md'].bashReads, 1, 'a loop that cats its variable reads');
    assert.ok(!('plans/theirs.md' in docs), "a Read of another project's absolute path is not this project's doc");
    assert.strictEqual(docs['plans/ours.md'].reads, 1);
    assert.ok(!('style/STYLE.md' in docs), 'a read under a folder the result says is missing read nothing');
    assert.ok(!('cross-project-tasks/2026-01-02-card.md' in docs), 'a relative path after cd to the parent is the sibling');
    assert.deepStrictEqual([docs['plans/2026-01-03-plan.md'].bashWrites, docs['plans/2026-01-03-plan.md'].bashReads], [1, undefined], 'sed -i is a write, and a call that writes a doc counts the write');
    assert.strictEqual(docs['plans/wt.md'].bashReads, 1, 'a worktree under the project reads its own docs');
    const md = execFileSync('node', [SCRIPT, file, '--report-md'], { encoding: 'utf8' });
    assert.match(md, /\| architecture\/references\/integrations\.md \| 0 \| 0 \| 0 \| 1\/0 \(1 by docs\.js\) \|/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C04: the Session vintage, against an uncompacted session of the current harness - a Skill call's body is an isMeta
// row naming the call in `sourceToolUseID`, a plugin command's expansion carries no `Base directory` line, the harness
// appends the run's ARGUMENTS after the body, a pre-rename skill name, and a stamp the session's own update wrote.
test('C04: vintage reads Skill-call and command bodies from their meta rows, past ARGUMENTS and renames, and dates a mid-session install', () => {
  const dir = tmp();
  try {
    const root = path.join(dir, 'proj');
    const claude = path.join(root, '.claude');
    const skill = (name, body) => {
      fs.mkdirSync(path.join(claude, 'skills', name), { recursive: true });
      fs.writeFileSync(path.join(claude, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: "fixture"\n---\n\n${body}`);
    };
    skill('habit-x', '# Habit\n\nstep one\n\n## A rule added later\n\nrule\n');
    skill('task-solve', '# Solve\n\n## Step one\n\ndo it\n');
    fs.writeFileSync(path.join(claude, 'alfred-code.stamp'), `sha: abcdef1234567890\nversion: 9.9.9\ninstalled: ${T(30).replace('.000', '')}\n`);
    const meta = (ts, text, extra = {}) => ({ type: 'user', timestamp: ts, cwd: root, isMeta: true, message: { content: [{ type: 'text', text }] }, ...extra });
    const cmd = (ts, name) => ({ type: 'user', timestamp: ts, cwd: root, parentUuid: `c-${ts}`, origin: { kind: 'slash_command' }, message: { content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` } });
    const rows = [
      { ...human(T(0), 'go'), cwd: root },
      asst('m1', T(1), [tool('k1', 'Skill', { skill: 'habit-x' })]),
      res(T(2), 'k1', 'Launching skill: habit-x'),
      meta(T(2), `Base directory for this skill: ${claude}/skills/habit-x\n\n# Habit\n\nstep one\n`, { sourceToolUseID: 'k1' }),
      asst('m2', T(3), [tool('k2', 'Skill', { skill: 'alfred-code:project-solve-task', args: 'brief' })]),
      res(T(4), 'k2', 'Launching skill: alfred-code:project-solve-task'),
      meta(T(4), `Base directory for this skill: ${claude}/skills/task-solve\n\n# Solve\n\n## Step one\n\ndo it\n\nARGUMENTS: # pasted brief\n\n## its own heading\n\n${'x'.repeat(4000)}`, { sourceToolUseID: 'k2' }),
      said('m3', T(5), 'ok'),
      cmd(T(10), 'alfred-code:update'),
      meta(T(10), '# Update\n\nrefresh the install\n'),
      cmd(T(20), 'init'),
      meta(T(20), '# Init\n\nwrite a CLAUDE.md\n'),
      meta(T(21), '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>'),
      cmd(T(22), 'model'),
      said('m4', T(60), 'done'),
    ];
    const file = write(dir, rows);
    const vin = run([file]).inventory.vintage;
    const row = (n) => vin.rows.find((r) => r.name === n) || {};
    assert.strictEqual(row('habit-x').how, 'Skill call');
    assert.strictEqual(row('habit-x').verdict, 'DIFFERS - the current source has different sections', 'the loaded body is compared, not reported absent');
    assert.strictEqual(row('alfred-code:project-solve-task').verdict, 'same', 'the pre-rename name finds task-solve, and the ARGUMENTS block is not the body');
    assert.match(row('alfred-code:update').verdict, /current source unreachable/, "a plugin command's expansion is its loaded body");
    assert.strictEqual(row('alfred-code:update').how, 'slash command');
    assert.ok(!vin.rows.some((r) => r.name === 'init' || r.name === 'model'), "the harness's own commands carry no stack body");
    assert.match(vin.inventoryWhy, /INSTALLED DURING this session at /);
    const md = text([file, '--report-md']);
    assert.match(md, /\| Stack install \| v9\.9\.9 .*INSTALLED DURING this session at .* - rows before it ran on the prior install \|/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C06: the inventory join. The harness roster spells a plugin seat with its scope and a skill under the name the
// session's release gave it; every use is keyed bare and current. And the standing floor is the first message, which
// carries the session's own opening prompt (8f44a003: a ~112k-char slash load inside a '139.4k' install floor).
test('C06: scoped and pre-rename roster names join their uses, preloads follow the seat, and the floor nets out the first prompt', () => {
  const dir = tmp();
  try {
    const root = path.join(dir, 'proj');
    const claude = path.join(root, '.claude');
    fs.mkdirSync(path.join(claude, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'agents', 'demo-verifier.md'), '---\nname: demo-verifier\ndescription: fixture\nskills:\n  - demo-preload\n---\n\nbody\n');
    for (const n of ['task-solve', 'demo-preload']) {
      fs.mkdirSync(path.join(claude, 'skills', n), { recursive: true });
      fs.writeFileSync(path.join(claude, 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: fixture\n---\n\n# ${n}\n`);
    }
    const big = (id, ts, ctx, content) => ({ ...asst(id, ts, content), message: { id, model: 'claude-sonnet-5', usage: usage(1, 0, ctx, 5), content } });
    const rows = [
      { ...human(T(0), '/task-solve the brief'), cwd: root },
      { type: 'user', timestamp: T(0), cwd: root, isMeta: true, message: { content: [{ type: 'text', text: '# Solve\n' + 'x'.repeat(20000) }] } },
      { type: 'attachment', timestamp: T(0), attachment: { type: 'skill_listing', isInitial: true, names: ['alfred-code:project-solve-task', 'demo-preload'], content: '' } },
      { type: 'attachment', timestamp: T(0), attachment: { type: 'agent_listing_delta', isInitial: true, addedTypes: ['alfred-code:demo-verifier'], removedTypes: [], addedLines: [] } },
      big('m1', T(1), 30000, [tool('k1', 'Skill', { skill: 'alfred-code:project-solve-task' })]),
      res(T(2), 'k1', 'Launching skill'),
      big('m2', T(3), 31000, [tool('a1', 'Agent', { subagent_type: 'alfred-code:demo-verifier', description: 'verify', prompt: 'check it' })]),
      res(T(4), 'a1', 'verified'),
      { ...said('m3', T(5), 'done'), message: { id: 'm3', model: 'claude-sonnet-5', usage: usage(1, 0, 32000, 5), content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } },
    ];
    const file = write(dir, rows);
    // a plugin-served seat with no definition on disk: its preloads are isMeta rows spelled like a slash turn
    const sub = path.join(dir, 'session', 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-s1.meta.json'), JSON.stringify({ agentType: 'alfred-code:other-seat' }));
    fs.writeFileSync(path.join(sub, 'agent-s1.jsonl'), [
      { type: 'user', timestamp: T(3), message: { content: 'review it' } },
      { type: 'user', timestamp: T(3), isMeta: true, message: { content: [{ type: 'text', text: '<command-message>demo-preload</command-message>\n<command-name>demo-preload</command-name>\n<skill-format>true</skill-format>' }, { type: 'text', text: 'Base directory for this skill: x\n\n# demo-preload\n' }] } },
      asst('s1', T(4), [{ type: 'text', text: 'ok' }]),
    ].map(line).join(''));
    const { inventory } = run([file]);
    const row = (list, n) => list.find((r) => r.name === n);
    assert.strictEqual(row(inventory.agents, 'demo-verifier').used, 'yes', 'the dispatched seat joins its roster row');
    assert.strictEqual(row(inventory.agents, 'alfred-code:demo-verifier'), undefined, 'no scoped twin left unused');
    assert.strictEqual(row(inventory.skills, 'task-solve').used, 'yes', 'the pre-rename roster name joins the run');
    assert.strictEqual(row(inventory.skills, 'project-solve-task'), undefined, 'no pre-rename twin left unused');
    assert.deepStrictEqual(row(inventory.skills, 'demo-preload').how, ['preloaded via alfred-code:demo-verifier x1', 'preloaded via alfred-code:other-seat x1'],
      "a frontmatter preload follows the dispatch, and a seat's own preload row is a preload, never a slash command");
    const out = text([file]);
    assert.match(out, /standing inventory ~30\.0k tok\/msg/);
    assert.match(out, /of which ~5\.0k is the session's own first prompt .* the install's floor is ~25\.0k/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C07: the tool ledger. A row gains the call's own `tool_use_id` (and the subagent's `agent_id`) - added fields only,
// every existing one unchanged - and the analyzer joins by that id first, then tool + time, then the detail a row names
// between its call and the call's result. Old rows (no id) still join. The calls of one batched message run after it
// finishes streaming: 31 of one session's calls read UNJOINED beside their own rows (bc2fa83e).
test('C07: the ledger row carries tool_use_id and agent_id, and the join reads id, then time, then detail', () => {
  const dir = tmp();
  try {
    const hook = path.join(__dirname, '..', 'stack', 'hooks', 'instrument-tool-usage.js');
    const log = path.join(dir, 'ledger-hook.jsonl');
    const env = { ...process.env, ALFRED_CODE_INSTRUMENT: '1', ALFRED_CODE_INSTRUMENT_LOG: log };
    const fire = (payload) => require('node:child_process').spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', env }).status;
    assert.strictEqual(fire({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1', cwd: '/x', tool_use_id: 'toolu_1', agent_id: 'ag1' }), 0);
    assert.strictEqual(fire({ tool_name: 'Read', tool_input: { file_path: '/a/b/c.ts' }, session_id: 's1' }), 0);
    const hrows = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(Object.keys(hrows[0]), ['ts', 'session', 'tool', 'detail', 'cwd', 'tool_use_id', 'agent_id'], 'the five pinned fields first, unchanged, then the two added');
    assert.deepStrictEqual([hrows[0].tool_use_id, hrows[0].agent_id, hrows[0].detail], ['toolu_1', 'ag1', 'c.ts']);
    assert.deepStrictEqual([hrows[1].tool_use_id, hrows[1].agent_id], [null, null], 'a payload without them writes null');

    // one batched message: three Edits streamed at T(0), run 8-9s later; a Bash call 1.0s late with its description
    const ms = (sec, frac) => `2026-07-15T07:00:${String(sec).padStart(2, '0')}.${frac}Z`;
    const rows = [
      asst('m1', ms(0, '100'), [tool('e1', 'Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' }), tool('e2', 'Edit', { file_path: '/p/b.ts', old_string: 'a', new_string: 'b' }), tool('e3', 'Edit', { file_path: '/p/c.ts', old_string: 'a', new_string: 'b' })]),
      res(ms(9, '500'), 'e1', 'ok'), res(ms(9, '600'), 'e2', 'ok'), res(ms(9, '700'), 'e3', 'ok'),
      asst('m2', ms(20, '000'), [sh('b1', 'ls docs', { description: 'Check for legacy rule files' })]),
      res(ms(21, '500'), 'b1', 'x'),
      asst('m3', ms(30, '000'), [sh('b2', 'git status', { description: 'Show status' })]),
      res(ms(30, '600'), 'b2', 'x'),
      asst('m4', ms(40, '000'), [tool('g1', 'Grep', { pattern: 'needle' })]),
      res(ms(40, '300'), 'g1', 'x'),
    ];
    const file = write(dir, rows);
    const ledger = path.join(dir, 'tools-usage.jsonl');
    fs.writeFileSync(ledger, [
      { ts: ms(8, '200'), session: 's', tool: 'Edit', detail: 'a.ts', cwd: '/p', tool_use_id: 'e1', agent_id: null },   // new row: by id
      { ts: ms(8, '900'), session: 's', tool: 'Edit', detail: 'b.ts', cwd: '/p', tool_use_id: 'e2', agent_id: null },
      { ts: ms(9, '100'), session: 's', tool: 'Edit', detail: 'c.ts', cwd: '/p' },                                       // old row, 9s late: by detail
      { ts: ms(21, '100'), session: 's', tool: 'Bash', detail: 'Check for legacy rule files', cwd: '/p' },               // old row, 1.0s late: by detail
      { ts: ms(30, '200'), session: 's', tool: 'Bash', detail: 'Show status', cwd: '/p' },                               // old row, close: by time
      { ts: ms(41, '900'), session: 's', tool: 'Grep', detail: 'other', cwd: '/p' },                                     // names another call: orphan
    ].map(line).join(''));
    const cov = run([file, '--hook-log', ledger]).hookLog.coverage;
    assert.deepStrictEqual([cov.matchedById, cov.matchedByTime, cov.matchedByDetail, cov.matchedCalls], [2, 1, 2, 5]);
    assert.deepStrictEqual(cov.unmatchedCalls.map((c) => c.tool), ['Grep'], 'a row naming another detail past the result stays apart');
    assert.strictEqual(cov.unmatchedRowCount, 1);
    assert.match(text([file, '--hook-log', ledger]), /joined: 5 call\(s\) - 2 by tool_use_id, 1 by tool \+ timestamp within 750ms, 2 by detail/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C07 (05c925e9): a session bundle keeps its block ledger as `hook-blocks-<sid>.jsonl` beside the transcript; passing
// the bundle folder read nothing and printed a measured '0 whole-file denial(s)'.
test('C07: --hook-blocks on a bundle folder reads hook-blocks-<sid>.jsonl, and a folder with no ledger says so', () => {
  const dir = tmp();
  try {
    const sid = '11111111-2222-4333-8444-555555555555';
    const file = write(dir, [asst('m1', T(0), [tool('r1', 'Read', { file_path: '/p/Big.cs' })]), res(T(1), 'r1', 'Blocked: whole-file Read', true)], `${sid}.jsonl`);
    fs.writeFileSync(path.join(dir, `hook-blocks-${sid}.jsonl`), line({ ts: T(0), hook: 'guard-read-whole-file.js', event: 'PreToolUse', tool: 'Read', reason: 'whole-file Read of Big.cs' }));
    const j = run([file, '--hook-blocks', dir]).hookBlocks;
    assert.deepStrictEqual([j.rows, j.given], [1, true]);
    assert.match(text([file, '--hook-blocks', dir]), /1 whole-file denial\(s\) \(hook-block ledger\)/);
    const empty = fs.mkdtempSync(path.join(dir, 'none-'));
    const k = run([file, '--hook-blocks', empty]).hookBlocks;
    assert.deepStrictEqual([k.rows, k.given], [0, false], 'no file read is no measurement');
    assert.match(k.missing, /^no ledger file for 11111111-2222-4333-8444-555555555555 in /);
    const out = text([file, '--hook-blocks', empty]);
    assert.match(out, /whole-file denial\(s\) \(transcript bracket - no ledger file for /);
    assert.match(out, /HOOK BLOCKS: no ledger file for .* - no measurement, never a zero/);
    assert.match(text([file, '--hook-blocks', empty, '--report-md']), /_no ledger file for .* - no measurement, never a zero\. Pass the ledger file itself\._/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C05: a commit that opens its own line of a multi-line call (390aebcb, 49cb4b82, f6c591fa: 'git commits 0' over a
// receipted commit). A heredoc message naming the commit verb still counts nothing.
test('C05: a git commit or gh pr merge on a later line of a multi-line call counts; a heredoc body never does', () => {
  const dir = tmp();
  try {
    const rows = [
      asst('m1', T(0), [sh('c1', "cd /work/repo\ngit add src/a.ts src/b.ts\ngit commit -q -F - <<'EOF'\nfix: one\n\ngit commit -m inside-the-message\nEOF\necho \"commit=$?\"")]),
      res(T(1), 'c1', 'commit=0'),
      asst('m2', T(2), [sh('c2', 'cd /work/repo\ngh pr merge 12 --squash')]),
      res(T(3), 'c2', 'merged'),
    ];
    const file = write(dir, rows);
    const { main } = run([file]);
    assert.strictEqual(main.gitCommits, 1);
    assert.strictEqual(main.prMerges, 1);
    assert.match(text([file]), /git commits 1 \(\+1 pr-merge\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
