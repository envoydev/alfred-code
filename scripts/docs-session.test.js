// scripts/docs-session.test.js - the docs session hook, driven through stdin payloads in throwaway git repos.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // its per-session state files left 138 per run in the machine's temp dir (2026-10-16)
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { repo, section, HOOKS } = require('./docs-fixture');

let n = 0;
const sid = () => `docs-test-${process.pid}-${++n}`;
const ctx = (out) => { try { return JSON.parse(out.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') + '\n' + section('users', 'src/Api/Users/**', 'Users are soft-deleted.');
const ORIENT = 'Api -> Infrastructure -> Domain. Orders own refunds.\n';

test('session start pushes the orientation block and how to read by section', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    const out = r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    const text = ctx(out);
    assert.match(out.stdout, /"hookEventName":"SessionStart"/);
    assert.match(text, /Orders own refunds/);
    assert.match(text, /node \.claude\/hooks\/docs\.js where <path>/);
    assert.match(text, /node \.claude\/hooks\/docs\.js show <file>#<id>/);
    assert.match(text, /Before your first change under src\/ or tests\//);
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_HOOKS_OFF: 'docs-session:block' }).stdout, '');
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_BLOCK: '0' }).stdout, '', 'the old key, read for the 2.x line');
  } finally { r.rm(); }
});

test('on a feature branch the start block names its overrides and conflicts', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.'), 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 10.\n');
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 20.\n');
    r.git('switch', '-q', 'feat/cap');
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /You are on branch feat\/cap\. 1 doc section\(s\) hold this branch's own decisions and replace mainline's in every read: patterns#orders/);
    assert.match(text, /Conflicts: patterns#orders/);
  } finally { r.rm(); }
});

test('on mainline the start hook promotes a merged branch and says so', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n'); r.git('commit', '-qam', 'cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are capped at 10.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    // The id, not just the count: a merged decision the session is never told the name of is one it never reads.
    assert.match(text, /Branch feat\/cap was merged: 1 doc section\(s\) folded into mainline and now hold its decisions: patterns#orders\./);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"promote"/);
    assert.ok(!r.exists('.claude/docs-log.jsonl'), 'the ledger lives under the docs root, beside hook-blocks');
  } finally { r.rm(); }
});

// One log file, many sessions: without the id the rows of two sessions cannot be told apart.
test('every log row carries the session it came from', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    const one = sid();
    const two = sid();
    r.git('switch', '-qc', 'feat/logged');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n'); r.git('commit', '-qam', 'cap');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are capped at 10.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/logged');
    r.hook({ hook_event_name: 'SessionStart', session_id: one });
    r.hook({ hook_event_name: 'PreToolUse', session_id: two, tool_name: 'Edit', tool_input: { file_path: 'src/Api/Orders/Refund.cs' } });
    const all = r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
    // `doc-set` rows come from the docs.js CLI, which is a plain command and has no session to name.
    const rows = all.filter((x) => x.event !== 'doc-set');
    assert.ok(rows.length >= 2, 'both sessions logged');
    assert.ok(rows.every((x) => x.session), 'no hook row is missing its session');
    assert.strictEqual(rows.find((x) => x.event === 'promote').session, one);
    assert.ok(rows.some((x) => x.event === 'hold' && x.session === two), 'the second session is told apart');
  } finally { r.rm(); }
});

// A branch sitting on mainline with nothing to prove it landed is the one case the engine cannot decide. It used to
// be reported nowhere: the branch is alive, so it is not a deleted-unmerged row, and no promote ever picks it up.
test('the start block names a live branch sitting on mainline with no proof it merged', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/behind');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStill being decided.\n');
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'develop');
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })),
      /Doc versions of branches sitting on mainline with no proof they merged: feat-behind/);
  } finally { r.rm(); }
});

test('the start block names conflict markers and duplicate ids, and a detached HEAD', () => {
  const r = repo({ tracked: true, docs: { 'references/patterns.md': `${PATTERNS}\n<<<<<<< HEAD\nA.\n=======\nB.\n>>>>>>> feat\n`, 'ORIENTATION.md': ORIENT } });
  try {
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /The docs need a repair before they are trusted: merge conflict markers in references\/patterns/);
    r.git('checkout', '-q', '--detach');
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /Detached HEAD: the docs are read-only/);
  } finally { r.rm(); }
});

// The declared mode wins over what the repo does, so a session that is about to write a doc is told when the two
// disagree - in place with nothing versioning it, or into an overlay beside a committed file.
test('the start block names a versioning mismatch in both directions', () => {
  const ignored = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  const committed = repo({ tracked: true, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    assert.match(ctx(ignored.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_VERSIONING: 'git' })),
      /Versioning mismatch: ALFRED_CODE_DOCS_VERSIONING declares 'git', but \.claude\/docs is not tracked by git - the setting wins, so doc sections are written in place/);
    assert.match(ctx(committed.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_VERSIONING: 'local' })),
      /Versioning mismatch: ALFRED_CODE_DOCS_VERSIONING declares 'local', but \.claude\/docs is tracked by git - the setting wins, so this branch's sections stay in the overlay/);
    for (const r of [ignored, committed]) assert.doesNotMatch(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /Versioning mismatch/, 'nothing declared, nothing said');
  } finally { ignored.rm(); committed.rm(); }
});

// Flipping the setting is what makes stranding reachable, and only `docs.js status` knew about it - nothing runs
// that by itself, so a branch version nobody can read any more went unannounced session after session.
test('the start block names doc versions stranded by git versioning', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/left');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nBranch rule.\n').status, 0);
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_VERSIONING: 'git' }));
    // The 30-day sweep stands down under git versioning, so this line returns every session until the overlay is
    // gone: it names the command that ends it, with the branch filled in, or it is a nag nobody can act on.
    assert.match(text, /Doc versions stranded by this install's git versioning: feat-left - nothing reads or promotes \.branches\/ any more, and this line returns every session until they are gone: re-apply what is still wanted with `node \.claude\/hooks\/docs\.js set <file>#<id>`, then end it with `node \.claude\/hooks\/docs\.js prune feat-left`\./);
    assert.doesNotMatch(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /stranded/, 'nothing is stranded while the overlay is the mode');
    r.git('switch', '-qc', 'feat/right');
    assert.strictEqual(r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nSecond branch rule.\n').status, 0);
    const two = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_VERSIONING: 'git' }));
    assert.match(two, /stranded by this install's git versioning: feat-left, feat-right - /);
    assert.match(two, /prune feat-left` \(one prune per name\)\./, 'with more than one name the command is an example, and says so');
  } finally { r.rm(); }
});

// A hook file and its engine are copied side by side, but an install that fails part way (or a hand-copied hook)
// leaves a NEWER docs-session.js beside an OLDER docs.js. Every field this block reads must be guarded: an
// unguarded read throws before anything is written, and the session gets no orientation at all.
test('a status object from an older engine still produces the start block', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'docs-skew-'));
  try {
    const { HOOKS } = require('./docs-fixture');
    const path = require('node:path');
    const engine = fs.readFileSync(path.join(HOOKS, 'docs.js'), 'utf8');
    assert.match(engine, /\n {4}stranded,\n/, 'the field this skew drops');
    fs.writeFileSync(path.join(dir, 'docs.js'), engine.replace(/\n {4}stranded,\n/, '\n'));
    fs.copyFileSync(path.join(HOOKS, 'docs-session.js'), path.join(dir, 'docs-session.js'));
    const out = require('node:child_process').spawnSync(process.execPath, [path.join(dir, 'docs-session.js')], {
      cwd: r.root, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid() }), encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_DOCS_VERSIONING: 'git' },
    });
    assert.strictEqual(out.stderr, '', 'the older engine is not an error');
    assert.match(ctx(out), /Orders own refunds/, 'the session is still oriented');
  } finally { r.rm(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('subagent start gets the orientation without branch lines or promotion', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nBranch rule.\n');
    const out = r.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_type: 'dotnet-implementer' });
    assert.match(out.stdout, /"hookEventName":"SubagentStart"/);
    assert.match(ctx(out), /Orders own refunds/);
    assert.doesNotMatch(ctx(out), /You are on branch/);
  } finally { r.rm(); }
});

test('deep review: a built-in seat that writes no project code gets no orientation and no snapshot', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    for (const seat of ['Explore', 'Plan', 'claude-code-guide', 'statusline-setup']) {
      const s = sid();
      const out = r.hook({ hook_event_name: 'SubagentStart', session_id: s, agent_id: `b-${seat}`, agent_type: seat });
      assert.strictEqual(out.status, 0); assert.strictEqual(out.stdout, '', `${seat} is silent`);
      const stop = r.hook({ hook_event_name: 'SubagentStop', session_id: s, agent_id: `b-${seat}`, agent_type: seat, last_assistant_message: 'Found it.' });
      assert.strictEqual(stop.status, 0); assert.strictEqual(stop.stdout, '', `${seat} is never asked`);
    }
    for (const seat of ['general-purpose', 'dotnet-implementer']) assert.match(ctx(r.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_type: seat })), /Orders own refunds/, `${seat} is oriented`);
  } finally { r.rm(); }
});

test('deep review: a footer copy inside ORIENTATION.md is pushed once, with the live domain list, and lint names it', () => {
  const stale = `${ORIENT}\nThe docs live under \`.claude/docs/\` (architecture, related-projects). Read them by section, not whole files:\n\`node docs.js where <path>\` names the sections covering a file; \`node docs.js show <file>#<id>\` prints one.\nFor a specific symbol the CODE wins; the docs give the decisions, the conventions and the reasons.\n`;
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': stale } });
  try {
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /Orders own refunds/);
    assert.strictEqual(text.match(/The docs live under/g).length, 1, 'one footer');
    assert.strictEqual(text.match(/the CODE wins/g).length, 1);
    assert.doesNotMatch(text, /related-projects/, 'the stale domain list is gone');
    assert.match(r.cli(['lint']).stdout, /repeats 3 line\(s\) of the session hook's own footer/);
  } finally { r.rm(); }
});

test('no docs folder, garbage stdin, unknown event: silent and exit 0', () => {
  const r = repo({});
  try {
    const a = r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    assert.strictEqual(a.status, 0); assert.strictEqual(a.stdout, '');
    const b = require('node:child_process').spawnSync(process.execPath, [require('./docs-fixture').HOOKS + '/docs-session.js'], { cwd: r.root, input: 'not json', encoding: 'utf8' });
    assert.strictEqual(b.status, 0); assert.strictEqual(b.stdout, '');
    assert.strictEqual(r.hook({ hook_event_name: 'Notification', session_id: sid() }).stdout, '');
  } finally { r.rm(); }
});

// M1 (R47, fix round 1): on the plugin route docs.js/memory.js/history.js are all tracked beside
// this hook in the marketplace clone, so a never-set-up project under a user-scope core never
// reaches the missing-module case - it is reachable only on the HOOKS COPY ROUTE
// (ALFRED_CODE_HOOKS_VIA_PLUGIN=false) when docs.js failed to land beside the hook. The catch is
// narrowed to exactly that MODULE_NOT_FOUND-for-docs.js case; anything else (a syntax error in a
// PRESENT engine) rethrows to the outer wrapper's stderr line - see the sibling test just below.
test('the engine missing from beside the hook: exit 0, no output, no stderr', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const path = require('node:path');
  const os = require('node:os');
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-lone-'));
  try {
    const { HOOKS } = require('./docs-fixture');
    fs.copyFileSync(path.join(HOOKS, 'docs-session.js'), path.join(lone, 'docs-session.js'));
    const out = require('node:child_process').spawnSync(process.execPath, [path.join(lone, 'docs-session.js')], {
      cwd: r.root, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid() }), encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: r.root },
    });
    assert.strictEqual(out.status, 0);
    assert.strictEqual(out.stdout, '');
    assert.strictEqual(out.stderr, '');
  } finally { r.rm(); fs.rmSync(lone, { recursive: true, force: true }); }
});

// M1 (R47, fix round 1): the narrowed catch swallows ONLY 'docs.js is missing' - a genuine load
// failure in a PRESENT engine (a syntax error, here) must still surface on stderr through the outer
// wrapper, never be silently treated as the never-set-up case above.
test('a syntax error in a PRESENT engine surfaces on stderr, never swallowed as a missing engine', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const path = require('node:path');
  const os = require('node:os');
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-broken-'));
  try {
    const { HOOKS } = require('./docs-fixture');
    fs.copyFileSync(path.join(HOOKS, 'docs-session.js'), path.join(lone, 'docs-session.js'));
    fs.writeFileSync(path.join(lone, 'docs.js'), 'const x = ;\n');
    const out = require('node:child_process').spawnSync(process.execPath, [path.join(lone, 'docs-session.js')], {
      cwd: r.root, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid() }), encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: r.root },
    });
    assert.strictEqual(out.stdout, '');
    assert.match(out.stderr, /^docs-session: /, 'a genuine load failure must reach the outer wrapper, not be swallowed');
    assert.doesNotMatch(out.stderr, /Cannot find module/, 'this is a syntax error, never a missing-module one');
  } finally { r.rm(); fs.rmSync(lone, { recursive: true, force: true }); }
});

const pre = (tool, input, session) => ({ hook_event_name: 'PreToolUse', session_id: session, tool_name: tool, tool_input: input });
const denied = (out) => /"permissionDecision":"deny"/.test(out.stdout);

test('the first source change is held and handed the covering section; a show unlocks it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.ok(denied(held));
    assert.match(held.stdout, /patterns#orders covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /ledgered before the payment call/);
    assert.match(r.read('.alfred/statistics/hook-blocks/' + s + '.jsonl'), /"hook":"docs-session\.js"/);
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s))), 'the handed-over section counts as read');
    const s2 = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show patterns#orders 2>&1' }, s2));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s2))));
  } finally { r.rm(); }
});

// The scenario this feature exists for: a teammate's branch merges and its decision is folded into mainline before
// turn one. That decision was written about a whole feature area, so three narrower sections outranked it and the
// gate never offered it - measured twice on a paid run, and the session failed the task both times. A decision that
// arrived in THIS session's fold is what the gate hands over, wherever the ranking would have put it.
test('a decision just folded in from a merged branch is what the gate hands over', () => {
  const NARROW = ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n');
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Orders/Order.cs': 'class Order {}\n', 'tests/Zeta/Quux.cs': 'x\n' },
    docs: { 'references/patterns.md': NARROW, 'references/boundaries.md': section('paging', 'src/**', 'Pages hold 20 rows.') },
  });
  try {
    r.git('switch', '-qc', 'feat/drawer');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Page; }\n'); r.git('commit', '-qam', 'drawer');
    r.cli(['set', 'boundaries#paging'], '## paging\n<!-- id: paging -->\n<!-- covers: src/** -->\nA drawer list holds at most 10 rows.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/drawer');
    // Before the fold is announced to a session, the three narrower sections fill the answer, as they should.
    const plain = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, sid()));
    assert.match(plain.stdout, /patterns#a covers src\/Api\/Orders\/Refund\.cs/, 'the narrowest answers first');
    assert.doesNotMatch(plain.stdout, /boundaries#paging/);
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s });
    // A folded decision is never noise on a path it says nothing about.
    assert.doesNotMatch(r.hook(pre('Edit', { file_path: 'tests/Zeta/Quux.cs' }, s)).stdout, /boundaries#paging/);
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.ok(denied(held));
    assert.match(held.stdout, /boundaries#paging covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /at most 10 rows/);
    assert.match(held.stdout, /Also covering it: patterns#a/, 'the ranking still fills the rest');
  } finally { r.rm(); }
});

// Two boundaries at once: a fold never takes the last slot, so the ranking always still answers; and the fold
// reaches the gate even where the start block is switched off - that switch silences text, it does not blind a gate.
test('a fold of two sections leaves the ranking its slot, block or no block', () => {
  const NARROW = ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n');
  const BOUNDS = `${section('paging', 'src/**', 'Pages hold 20 rows.')}\n${section('envelope', 'src/**', 'Every route returns the envelope.')}`;
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': NARROW, 'references/boundaries.md': BOUNDS } });
  try {
    r.git('switch', '-qc', 'feat/drawer');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Page; }\n'); r.git('commit', '-qam', 'drawer');
    r.cli(['set', 'boundaries#paging'], '## paging\n<!-- id: paging -->\n<!-- covers: src/** -->\nA drawer list holds at most 10 rows.\n');
    r.cli(['set', 'boundaries#envelope'], '## envelope\n<!-- id: envelope -->\n<!-- covers: src/** -->\nA drawer list is enveloped like the rest.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/drawer');
    const s = sid();
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: s }, { ALFRED_CODE_DOCS_BLOCK: '0' }).stdout, '', 'no block text');
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.match(held.stdout, /boundaries#paging covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(held.stdout, /Also covering it: boundaries#envelope .*patterns#a /, 'the second fold, then the ranking');
  } finally { r.rm(); }
});

// Which fold is INLINED is the expensive choice, so it is not the order the doc files happen to be scanned in that
// decides it: among freshly folded sections the narrowest cover answers first, exactly as it does everywhere else.
test('two folded sections are handed over narrowest first, not in scan order', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Users/User.cs': 'class User {}\n' },
    docs: {
      'ARCHITECTURE.md': section('everything', 'src/**', 'Every route returns the envelope.'),
      'references/patterns.md': section('a', 'src/Api/Orders/**', 'A refund is ledgered first.'),
    },
  });
  try {
    r.git('switch', '-qc', 'feat/two');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n'); r.git('commit', '-qam', 'two');
    r.cli(['set', 'ARCHITECTURE#everything'], '## everything\n<!-- id: everything -->\n<!-- covers: src/** -->\nEvery route returns the envelope, admin included.\n');
    r.cli(['set', 'patterns#a'], '## a\n<!-- id: a -->\n<!-- covers: src/Api/Orders/** -->\nA refund is ledgered at most once.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/two');
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s });
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
    assert.match(held.stdout, /patterns#a covers src\/Api\/Orders\/Refund\.cs - here it is/, 'the narrower fold is inlined');
    assert.match(held.stdout, /ledgered at most once/);
    assert.match(held.stdout, /Also covering it: ARCHITECTURE#everything/, 'the wider fold is still named');
  } finally { r.rm(); }
});

test('where, toc and status do not unlock; a Read of a doc file does', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js where src/Api/Orders' }, s));
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js toc patterns' }, s));
    assert.ok(denied(r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, s))));
    const s2 = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/architecture/references/patterns.md` }, s2));
    assert.ok(!denied(r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, s2))));
  } finally { r.rm(); }
});

test('no covering section: two holds pointing at the doc list, then the change goes through and a bypass is logged', () => {
  const r = repo({ files: { 'tests/Zeta/Quux.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const edit = pre('Edit', { file_path: 'tests/Zeta/Quux.cs' }, s);
    assert.match(r.hook(edit).stdout, /see what is documented: node \.claude\/hooks\/docs\.js files/);
    assert.ok(denied(r.hook(edit)));
    assert.ok(!denied(r.hook(edit)));
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"bypass"/);
  } finally { r.rm(); }
});

test('shell reads are never held; shell writes are', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    assert.ok(!denied(r.hook(pre('Bash', { command: 'grep -n Refund src/Api/Orders/Refund.cs 2>/dev/null' }, s))));
    assert.ok(!denied(r.hook(pre('Bash', { command: 'dotnet test tests/Api > run.log 2>&1' }, s))));
    assert.ok(denied(r.hook(pre('Bash', { command: "cat > src/Api/Orders/Refund.cs <<'EOF'\nclass Refund {}\nEOF" }, s))));
    // Audit 2026-10-08 row 46: the Monitor tool runs its command under the shell route, and its writes are held too.
    const m = sid();
    assert.ok(denied(r.hook(pre('Monitor', { command: 'echo x > src/Api/Orders/Refund.cs' }, m))), 'a Monitor write is held');
    assert.ok(!denied(r.hook(pre('Monitor', { command: 'tail -f run.log' }, m))), 'a Monitor watch is not');
  } finally { r.rm(); }
});

// Both installer twins wire this hook on `Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep` (Glob left 2026-10-16).
// Judging only `Bash` left the gate open on every Windows session and earned a doc read no consult credit.
test('PowerShell is the same shell route as Bash: its writes are held and its doc reads count', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    assert.ok(!denied(r.hook(pre('PowerShell', { command: 'Select-String -Pattern Refund -Path src/Api/Orders/Refund.cs' }, s))), 'a shell read is never held');
    // The shared syntax is what writeTargets parses on either shell: redirection, and the rm/mv/cp/mkdir aliases
    // PowerShell carries for its own Remove-Item / Move-Item / Copy-Item.
    assert.ok(denied(r.hook(pre('PowerShell', { command: "'class Refund {}' > src/Api/Orders/Refund.cs" }, s))), 'a redirect write is held');
    const sRm = sid();
    assert.ok(denied(r.hook(pre('PowerShell', { command: 'rm src/Api/Orders/Refund.cs' }, sRm))), 'an alias write is held');
    const s2 = sid();
    r.hook(pre('PowerShell', { command: 'node .claude/hooks/docs.js show patterns#orders' }, s2));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s2))), 'a docs.js show through PowerShell unlocks the gate');
    const s3 = sid();
    r.hook(pre('PowerShell', { command: 'Get-Content .claude/docs/architecture/references/patterns.md' }, s3));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s3))), 'a doc file read through PowerShell earns consult credit');
  } finally { r.rm(); }
});

// I12 (the user's ruling of 2026-09-29): the navigation server keeps two edit tools, rename_symbol and
// safe_delete_symbol, and both change source files - so the first change through either is held like an Edit.
// Their input names the file as `relative_path`. Both spellings: the plugin route's and the copy route's
// (built at run time - lint check 54 bans the bare server spelling as literal text).
test('the navigation server\'s two kept edit tools are held like an Edit, on both routes', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    for (const server of ['plugin_alfred-navigation_alfred-navigation', 'alfred-navigation', 'plugin_navigation_navigation', 'navigation']) {
      for (const tool of ['rename_symbol', 'safe_delete_symbol']) {
        const name = `mcp__${server}__${tool}`;
        assert.ok(denied(r.hook(pre(name, { name_path: 'Refund/Apply', relative_path: 'src/Api/Orders/Refund.cs', new_name: 'Run' }, sid()))), `${name} is held`);
      }
    }
    assert.ok(!denied(r.hook(pre('mcp__plugin_alfred-navigation_alfred-navigation__find_symbol', { name_path: 'Refund', relative_path: 'src/Api/Orders/Refund.cs' }, sid()))), 'a lookup is never held'); // mcp-fixture
    const s = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show patterns#orders' }, s));
    assert.ok(!denied(r.hook(pre('mcp__plugin_alfred-navigation_alfred-navigation__rename_symbol', { name_path: 'Refund', relative_path: 'src/Api/Orders/Refund.cs', new_name: 'Refund2' }, s))), 'a section read unlocks it'); // mcp-fixture
  } finally { r.rm(); }
});

test('the manifest wires docs-session on the two kept navigation edit tools, both spellings; check-turn-build reads git at Stop instead', () => {
  const rows = require('../meta/stack-manifest.json').hooks;
  const re = (file, event) => rows.filter((row) => row.file === file && (event ? row.matcher.startsWith(`@${event}:`) : !row.matcher.startsWith('@')))
    .map((row) => row.matcher.replace(/^@\w+:/, ''));
  assert.deepStrictEqual(rows.filter((row) => row.file === 'check-turn-build.js').map((row) => row.matcher), ['@Stop'], 'no per-edit wiring left');
  for (const [file, event] of [['docs-session.js', null]]) {
    const matchers = re(file, event);
    for (const server of ['plugin_alfred-navigation_alfred-navigation', 'alfred-navigation', 'plugin_navigation_navigation', 'navigation'])
      for (const tool of ['rename_symbol', 'safe_delete_symbol', 'replace_symbol_body']) {
        const name = `mcp__${server}__${tool}`;
        const hit = matchers.some((m) => (/^[\w\s,|-]+$/.test(m) ? m.split(/[|,]/).map((x) => x.trim()).includes(name) : new RegExp(m).test(name)));
        assert.strictEqual(hit, tool !== 'replace_symbol_body', `${file}: ${name}`);
      }
  }
});

test('source roots come from watch.json; docs-session:gate in ALFRED_CODE_HOOKS_OFF turns the gate off', () => {
  const r = repo({ files: { 'app/Orders/Refund.cs': 'x\n', 'src/Other.cs': 'x\n' }, docs: { 'references/patterns.md': section('orders', 'app/Orders/**', 'App rule.'), 'watch.json': JSON.stringify({ sourceRoots: ['app'] }) } });
  try {
    assert.ok(denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Other.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()), { ALFRED_CODE_HOOKS_OFF: 'docs-session:gate' })));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()), { ALFRED_CODE_DOCS_GATE: '0' })), 'the old key, read for the 2.x line');
  } finally { r.rm(); }
});

// Task 14 / whole-branch review finding 3: a domain that declares no sourceRoots contributes none. The shipped
// related-projects/watch.json is `{}` and its own shape doc says it declares nothing to watch - but the per-domain
// default folded src + tests into the union, so adding it to an 'app'-only project widened the gate to
// app,src,tests: the first change under src/ or tests/ was held for a section no domain documents, and `where`
// had nothing to hand over. The default belongs to the union alone, where a project that declares nothing
// anywhere still gets it.
test('an empty watch.json declares no source roots, and never widens another domain\'s', () => {
  const r = repo({ files: { 'app/Orders/Refund.cs': 'x\n', 'src/Other.cs': 'x\n' }, docs: { 'references/patterns.md': section('orders', 'app/Orders/**', 'App rule.'), 'watch.json': JSON.stringify({ sourceRoots: ['app'] }) } });
  const bare = repo({ files: { 'src/Other.cs': 'x\n' }, docs: { 'references/patterns.md': section('orders', 'src/**', 'Src rule.'), 'watch.json': '{}' } });
  try {
    r.write('.claude/docs/related-projects/watch.json', '{}');
    r.write('.claude/docs/related-projects/RELATED-PROJECTS.md', section('sibling', '', 'A sibling repo.'));
    assert.ok(denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()))), 'the declared root still holds');
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Other.cs' }, sid()))), 'and src/ is not adopted from an empty watch.json');
    assert.ok(denied(bare.hook(pre('Edit', { file_path: 'src/Other.cs' }, sid()))), 'a project declaring no root anywhere still gets the src/tests default');
  } finally { r.rm(); bare.rm(); }
});

test('writeTargets: the paths a shell command writes, from real runs', () => {
  const { writeTargets } = require('../stack/hooks/docs-session.js');
  const U = '<unknown source write>';
  const cases = [
    // reads that mention source paths - the live-run false positives
    ['grep -n "CancelDeletionRequest" -A 15 src/Shop.Api/Features/Auth/CancelDeletion/*.cs 2>/dev/null; echo "---"; find src/Shop.Api/Features/Auth -iname "*CancelDeletion*"', []],
    ['grep -rn "AddValidatorsFromAssembly\\|AbstractValidator" --include="*.cs" src/Shop.Api/Program.cs src/Shop.Api/Common 2>/dev/null | grep -v Features', []],
    ['nohup dotnet test tests/Shop.IntegrationTests > shop-integration-full.log 2>&1 &', ['shop-integration-full.log']],
    ['dotnet build Shop.slnx 2>&1 | tail -20', []],
    ['cat src/Api/Orders/OrderRefunds.cs', []],
    ['grep -n "x => x.Id > 0" src/Api/Orders/OrderRefunds.cs', []],
    ['ls src/Api > /dev/null 2>&1', []],
    ['find src -name "*.cs" 2>/dev/null | xargs grep -l Refund', []],
    ['git diff src/Api/Orders/OrderRefunds.cs', []],
    ['git checkout feat/x', []],
    // writes
    ['echo x > src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ['echo x >> src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ["cat > src/Api/Orders/New.cs <<'EOF'\nclass New { bool A(int x) => x > 0; }\nEOF", ['src/Api/Orders/New.cs']],
    ['cat > "src/Api/Orders/Quoted.cs" <<EOF\nx\nEOF', ['src/Api/Orders/Quoted.cs']],
    ["sed -i '' 's/a/b/' src/Api/Orders/OrderRefunds.cs", ['src/Api/Orders/OrderRefunds.cs']],
    ['sed -i.bak -e "s/a/b/" src/A.cs src/B.cs', ['src/A.cs', 'src/B.cs']],
    ['sed -n 1,20p src/Api/Orders/OrderRefunds.cs', []],
    ['perl -pi -e "s/a/b/" tests/X.cs', ['tests/X.cs']],
    ['cp /tmp/x.cs src/Api/Orders/Copy.cs', ['src/Api/Orders/Copy.cs']],
    ['cp src/Api/Orders/OrderRefunds.cs /tmp/backup.cs', ['/tmp/backup.cs']],
    ['mv src/a.cs src/b.cs', ['src/a.cs', 'src/b.cs']], // mv removes its source too
    ['rm -f src/Api/Orders/OrderQueries.cs tests/Old.cs', ['src/Api/Orders/OrderQueries.cs', 'tests/Old.cs']],
    ['mkdir -p src/Api/Refunds', ['src/Api/Refunds']],
    ['echo x | tee src/T.cs', ['src/T.cs']],
    ['dotnet ef migrations add AddRefunds --project src/Shop.Infrastructure', ['src/Shop.Infrastructure']],
    ['dotnet ef migrations add AddRefunds', [U]],
    ['dotnet ef database update', []],
    ['dotnet new classlib -o src/Shop.New', ['src/Shop.New']],
    ['git apply fix.patch', [U]],
    ['git checkout -- src/Api/Orders/OrderRefunds.cs', ['src/Api/Orders/OrderRefunds.cs']],
    ['git restore src/A.cs', ['src/A.cs']],
    ['cd src && echo x > A.cs', ['A.cs']],
    // an interpreter's own write is a write (guards:F6 - the local parser saw neither, so the seat was never credited)
    ['node -e "require(\'fs\').writeFileSync(\'src/a.ts\', \'x\')"', ['src/a.ts']],
    ["python3 - <<'PY'\nopen('src/a.py', 'w').write('x')\nPY", ['src/a.py']],
  ];
  for (const [command, want] of cases) assert.deepStrictEqual(writeTargets(command).sort(), [...want].sort(), command);
});

const WATCH = (extra = {}) => JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }], ...extra });
// A session that changed files runs a command that may write (a build, a generator): the Stop ask's unclaimed bucket counts
// only past one (recordRun, the 2026-10-17 usage audit). The cases below model that session; a read-only one has its own.
const ran = (r, s, env) => r.hook(pre('Bash', { command: 'npm run generate' }, s), env);
const start = (r, s, env) => { const out = r.hook({ hook_event_name: 'SessionStart', session_id: s }, env); ran(r, s, env); return out; };
const stopEv = (s, active) => ({ hook_event_name: 'Stop', session_id: s, stop_hook_active: Boolean(active) });

test('a change to a watched file asks once, naming the section; a second stop is silent', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const out = r.hook(stopEv(s));
    const body = JSON.parse(out.stdout);
    assert.strictEqual(body.decision, 'block');
    // The main session's ask is the SAME ask a finished agent gets - one shape, one thing to learn.
    assert.match(body.reason, /^Docs check: you changed src\/Api\/Program\.cs\n/);
    assert.match(body.reason, /"Refunds are ledgered before the payment call\."/);
    assert.match(body.reason, /  Yes -> reply: docs ok/);
    assert.match(body.reason, /set patterns#orders --expect [0-9a-f]{12}/);
    assert.strictEqual(r.hook(stopEv(s)).stdout, '');
  } finally { r.rm(); }
});

// Pilot 4 (b4-pilot-4-flow): all 8 flow cells ended on the docs reply ('docs ok'), so the last message a host reads
// carried no task summary. The Stop ask's reply is the session's last message, so it asks for the docs line FOLLOWED
// by the summary. A seat's SubagentStop reply is its report to the caller, so that ask closes on keeping the report
// whole (audit 2026-10-08 row 25: the 'docs ok' line alone dropped an implementer seat's status: lines; the
// finished-agent test below pins it).
test('the Stop ask keeps the task summary last: the docs line, then the summary in at most three lines', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const { reason } = JSON.parse(r.hook(stopEv(s)).stdout);
    assert.match(reason, /  Yes -> reply: docs ok\n/);
    assert.match(reason, /\n\nThis reply is your last message, so it carries the task summary: the docs line first \(docs ok, or\nthe section you rewrote\), then what you did in at most three lines\.$/);
  } finally { r.rm(); }
});

test('no hit, stop_hook_active, the ask switched off, or no watch.json: silent', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'x\n', 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const a = sid(); start(r, a);
    r.write('src/Api/Orders/Refund.cs', 'y\n');
    assert.strictEqual(r.hook(stopEv(a)).stdout, '', 'routine change');
    const b = sid(); start(r, b);
    r.write('src/Api/Program.cs', 'y\n');
    // The Stop chain (audit 2026-10-08 S1): `stop_hook_active` is set after ANY Stop hook's block, so a continuation a
    // sibling caused is judged (it never asked before) - and the ask still comes once per session.
    assert.match(r.hook(stopEv(b, true)).stdout, /"decision":"block"/, 'a continuation a sibling Stop hook caused is judged');
    assert.strictEqual(r.hook(stopEv(b, true)).stdout, '', 'its own continuation is silent');
    assert.strictEqual(r.hook(stopEv(b), { ALFRED_CODE_HOOKS_OFF: 'docs-session:ask' }).stdout, '', 'switched off');
    assert.strictEqual(r.hook(stopEv(b), { ALFRED_CODE_DOCS_ASK: '0' }).stdout, '', 'the old key, read for the 2.x line');
    fs.rmSync(`${r.root}/.claude/docs/architecture/watch.json`);
    const c = sid(); start(r, c);
    r.write('src/Api/Program.cs', 'z\n');
    assert.strictEqual(r.hook(stopEv(c)).stdout, '', 'no watch.json');
  } finally { r.rm(); }
});

test('four owning sections: the ask names three', () => {
  const secs = ['a', 'b', 'c', 'd'].map((x) => section(x, '', `${x}.`)).join('\n');
  const r = repo({ files: { 'src/Api/Program.cs': 'x\n' }, docs: { 'references/p.md': secs, 'watch.json': JSON.stringify({ watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['p#a', 'p#b', 'p#c', 'p#d'] }] }) } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Program.cs', 'y\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /^3 sections document this file:/m);
    // audit 2026-10-11 SD09: each command names where the new text comes from
    assert.match(reason, /set p#a --expect [0-9a-f]{12} < <file holding its new text>\n {11}node .*set p#b --expect [0-9a-f]{12} < <file holding its new text>\n {11}node .*set p#c --expect [0-9a-f]{12} < <file holding its new text>\n {9}\(the section's new text as `show` prints it - from a file as above, or piped in\)/);
    assert.doesNotMatch(reason, /p#d/);
  } finally { r.rm(); }
});

test('a new module folder hits newModule; a committed script change counts', () => {
  const r = repo({ files: { 'src/Api/Features/Orders/A.cs': 'x\n', 'src/Api/Program.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH({ newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] } }) } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Features/Billing/Invoice.cs', 'class Invoice {}\n');
    assert.match(JSON.parse(r.hook(stopEv(s)).stdout).reason, /Docs check: you changed src\/Api\/Features\/Billing\/[\s\S]*patterns#users/);
    const t = sid(); start(r, t);
    r.write('src/Api/Program.cs', 'changed by a script\n');
    r.git('commit', '-qam', 'script');
    assert.match(JSON.parse(r.hook(stopEv(t)).stdout).reason, /patterns#orders/);
  } finally { r.rm(); }
});

// ---- the finish ask, per agent: what THAT agent changed, asked once, against the section's text as it stands now ----
// The agent that made a change is the only context that knows why, so SubagentStop is where the ask has an answer.
const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
const subStart = (s, id, extra = {}) => ({ hook_event_name: 'SubagentStart', session_id: s, agent_id: id, agent_type: 'dotnet-implementer', ...extra });
const subStop = (s, id, extra = {}) => ({ hook_event_name: 'SubagentStop', session_id: s, agent_id: id, agent_type: 'dotnet-implementer', stop_hook_active: false, ...extra });
const watched = (extra) => repo({ tracked: true, files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Users/User.cs': 'class User {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH(), ...extra } });
// A tool event fired INSIDE a subagent carries that agent's id, so the write is attributed to the seat that made it.
const preBy = (s, id, file, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: s, tool_name: 'Edit', tool_input: { file_path: file }, agent_id: id, agent_type: 'dotnet-implementer', ...extra });
// A write is attributed where the call PROCEEDS, so these helpers drive the allowed call - the gate's own hold, and
// what it means for attribution, is the subject of its own tests rather than a side effect of every other one.
const ALLOW = { ALFRED_CODE_DOCS_GATE: '0' };
const wroteBy = (r, s, id, file, body, env = GIT) => { r.hook(preBy(s, id, file), { ...env, ...ALLOW }); r.write(file, body); };
const touch = (r) => r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
const touchBy = (r, s, id, env = GIT) => wroteBy(r, s, id, 'src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n', env);

test('a finished agent is asked about the section documenting what it changed, quoting its first sentence', () => {
  const r = watched();
  try {
    const s = sid();
    // The start payload spells the id 'agent-a1' and the stop payload 'a1' in the published examples; the key
    // survives either spelling, or the two events would never meet.
    r.hook(subStart(s, 'agent-a1'), GIT);
    touchBy(r, s, 'a1');
    const body = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout);
    assert.strictEqual(body.decision, 'block');
    assert.match(body.reason, /^Docs check: you changed src\/Api\/Program\.cs\n\nOne section documents this file - 'orders', in \.claude\/docs\/architecture\/references\/patterns\.md:\n  "Refunds are ledgered before the payment call\."\n\nDoes your change still leave that true\?\n\n  Yes -> reply: docs ok\n  No  -> rewrite the section, then run\n {11}node \.claude\/hooks\/docs\.js set patterns#orders --expect [0-9a-f]{12} < <file holding its new text>\n {9}\(the section's new text as `show` prints it - from a file as above, or piped in\)\n {9}and commit the doc with your code, so it travels with this branch\.\n\nThis reply is what your caller receives: the docs line first, then your report as your brief asks for it -\nits status: and contract_version: lines, where it has them, unchanged\.$/);
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"ask-update"/);
    assert.match(r.read(`.alfred/statistics/hook-blocks/${s}.jsonl`), /"event":"SubagentStop"/);
  } finally { r.rm(); }
});

test('one block per agent: the continuation stop and a later change are both silent', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    assert.match(r.hook(subStop(s, 'a1'), GIT).stdout, /"decision":"block"/);
    const again = r.hook(subStop(s, 'a1', { stop_hook_active: true, last_assistant_message: 'docs ok' }), GIT);
    assert.strictEqual(again.stdout, '', 'the continuation we caused never blocks');
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.UseCors();\napp.Run();\n');
    assert.strictEqual(r.hook(subStop(s, 'a1'), GIT).stdout, '', 'one block per agent, whatever it answered');
    // What the agent DID is read from the ledger, not from its prose: no `set` landed for the asked section.
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"ask-answer".*"outcome":"unchanged"/);
  } finally { r.rm(); }
});

// Deep hooks review 2026-10-16: a seat reports through SubagentHandback, so a SubagentStop ask came after the report had
// left (48 of 48, 41 never acted on). The ask is a deny of the first hand-back that owes one; the retry carries the answer.
const handBack = (s, id, message, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: s, tool_name: 'SubagentHandback', tool_input: { message }, agent_id: id, agent_type: 'dotnet-implementer', ...extra });
const answers = (r) => r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).map((l) => JSON.parse(l));

test('deep review: a seat is asked at its first hand-back, the retry passes with the answer, and SubagentStop stays quiet', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'agent-h1'), GIT);
    touchBy(r, s, 'h1');
    const first = r.hook(handBack(s, 'h1', 'status: DONE\ncontract_version: 3'), GIT);
    assert.ok(denied(first), first.stdout);
    const reason = JSON.parse(first.stdout).hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /^Docs check: you changed src\/Api\/Program\.cs\n\nOne section documents this file - 'orders'/);
    assert.match(reason, /Your report was NOT delivered\. Answer this first, then call SubagentHandback again: the docs line first\n\(docs ok, or the section you rewrote\), then your report unchanged/);
    assert.doesNotMatch(reason, /This reply is what your caller receives/, 'the SubagentStop closing is not this route\'s');
    assert.match(r.read(`.alfred/statistics/hook-blocks/${s}.jsonl`), /"event":"PreToolUse","tool":"SubagentHandback"/);
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"ask-update".*"via":"handback"/);
    const retry = r.hook(handBack(s, 'h1', 'docs ok\nstatus: DONE\ncontract_version: 3'), GIT);
    assert.strictEqual(retry.stdout, '', 'the hand-back sent after the ask is delivered');
    const [row] = answers(r);
    assert.deepStrictEqual([row.via, row.outcome, row.saidDocsOk], ['handback', 'unchanged', true]);
    assert.strictEqual(r.hook(subStop(s, 'h1', { last_assistant_message: 'done' }), GIT).stdout, '', 'no second ask at SubagentStop');
    assert.strictEqual(r.hook(handBack(s, 'h1', 'again'), GIT).stdout, '', 'nor at a later hand-back');
    assert.strictEqual(answers(r).length, 1, 'one answer row');
  } finally { r.rm(); }
});

test('deep review: the hand-back route asks nobody it should not, and a seat that stops instead of retrying is answered once', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'idle'), GIT);
    assert.strictEqual(r.hook(handBack(s, 'idle', 'status: DONE'), GIT).stdout, '', 'a seat that wrote nothing hands back at once');
    touch(r);
    assert.strictEqual(r.hook({ ...handBack(s, 'x', 'hi'), agent_id: undefined, agent_type: undefined }, GIT).stdout, '', 'the main session has no hand-back ask');
    r.hook(subStart(s, 'off'), GIT);
    touchBy(r, s, 'off');
    assert.strictEqual(r.hook(handBack(s, 'off', 'status: DONE'), { ...GIT, ALFRED_CODE_DOCS_ASK: '0' }).stdout, '', 'the ask switch covers this route');
    const s2 = sid();
    r.hook(subStart(s2, 'h2'), GIT);
    wroteBy(r, s2, 'h2', 'src/Api/Program.cs', 'app.UseH2();\napp.Run();\n');
    assert.ok(denied(r.hook(handBack(s2, 'h2', 'status: DONE'), GIT)));
    assert.strictEqual(r.hook(subStop(s2, 'h2', { last_assistant_message: 'docs ok' }), GIT).stdout, '', 'stopping instead of retrying is not asked again');
    const row = answers(r).pop();
    assert.deepStrictEqual([row.via, row.saidDocsOk], ['handback', true], 'its last message is the answer');
    // and with no hand-back at all, SubagentStop is still the ask (a harness without the tool)
    const s3 = sid();
    r.hook(subStart(s3, 'h3'), GIT);
    wroteBy(r, s3, 'h3', 'src/Api/Program.cs', 'app.UseH3();\napp.Run();\n');
    assert.match(r.hook(subStop(s3, 'h3'), GIT).stdout, /"decision":"block"/);
  } finally { r.rm(); }
});

test('deep review: the manifest wires docs-session on SubagentHandback as its own row, outside the file dispatcher', () => {
  const rows = require('../meta/stack-manifest.json').hooks.filter((h) => h.file === 'docs-session.js').map((h) => h.matcher);
  assert.ok(rows.includes('SubagentHandback') && rows.includes('@SubagentStop'), rows.join(' '));
  const entry = require('../.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'alfred-code');
  const pre = (entry.hooks.PreToolUse || []).filter((g) => g.matcher === 'SubagentHandback');
  assert.strictEqual(pre.length, 1);
  // the group also carries the output-scorer's seal (guard-stop-contract, 2026-10-25); docs-session is its own command in it
  assert.strictEqual(pre[0].hooks.filter((h) => /stack\/hooks\/docs-session\.js"$/.test(h.command)).length, 1, pre[0].hooks.map((h) => h.command).join(' | '));
});

// Task 6b review, finding 7: a warning-only ask-answer row reads sections: [], outcome: 'unchanged' - the
// same shape as a turn nothing was ever asked about at all, so the block ledger cannot tell a warning
// apart from a no-op without joining back to the ask-update row. `warned` is one extra field carrying the
// same ids ask-update already logs under `warnings`, so the row is self-describing on its own.
test('a warning-only turn is recorded distinctly from an ordinary unchanged ask', () => {
  const r = repo({ tracked: true, files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#refund-sync'] }],
      notOwned: ['DECISIONS.md'],
    }));
    r.write('.claude/docs/decisions/DECISIONS.md', section('refund-sync', '', 'Refunds are deliberately synchronous.'));
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    const body = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout);
    assert.strictEqual(body.decision, 'block');
    r.hook(subStop(s, 'a1', { stop_hook_active: true, last_assistant_message: 'noted' }), GIT);
    const row = JSON.parse(r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(row.outcome, 'unchanged', 'no ask was ever made, only a warning - nothing to rewrite');
    assert.deepStrictEqual(row.sections, [], 'a warning id never enters a.asked or the outcome it drives');
    assert.deepStrictEqual(row.warned, ['decisions/DECISIONS#refund-sync'], 'now on THIS row, not only findable by joining back to ask-update');
  } finally { r.rm(); }
});

// The two exchanges below are the verbatim closing lines of two live `claude -p` runs, and the substring test that
// used to decide this field read BOTH of them backwards: a refusal counted as a confirmation because it quoted the
// phrase it was declining to say, and a completed fix counted as a refusal because it closed in its own words.
const LIVE_REFUSAL = "I cannot truthfully reply 'docs ok' - changing the window from 30 to 45 days makes the documented rule stale, and I was unable to run the set command.";
const LIVE_FIX = 'I rewrote the section and ran the set command, so the docs gate is satisfied.';

test('the ask outcome is read from what landed in the docs, not from the words the agent chose', () => {
  const r = watched();
  try {
    const refused = sid();
    r.hook(subStart(refused, 'a1'), GIT);
    touchBy(r, refused, 'a1');
    assert.match(r.hook(subStop(refused, 'a1'), GIT).stdout, /"decision":"block"/);
    r.hook(subStop(refused, 'a1', { stop_hook_active: true, last_assistant_message: LIVE_REFUSAL }), GIT);
    const one = JSON.parse(r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(one.outcome, 'unchanged', 'nothing was written, whatever the prose quoted');
    assert.strictEqual(one.saidDocsOk, false, 'a sentence declining to say it is not saying it');
    assert.strictEqual(one.ok, undefined, 'no field claims to know what the agent meant');

    const fixed = sid();
    r.hook(subStart(fixed, 'a2'), GIT);
    wroteBy(r, fixed, 'a2', 'src/Api/Program.cs', 'app.UseFixed();\napp.Run();\n');
    const ask = JSON.parse(r.hook(subStop(fixed, 'a2'), GIT).stdout).reason;
    const hash = /--expect ([0-9a-f]{12})/.exec(ask)[1];
    assert.strictEqual(r.cli(['set', 'patterns#orders', '--expect', hash], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are ledgered after the payment call.\n', GIT).status, 0);
    r.hook(subStop(fixed, 'a2', { stop_hook_active: true, last_assistant_message: LIVE_FIX }), GIT);
    const two = JSON.parse(r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(two.outcome, 'rewritten', 'the set landed, whatever words closed the turn');
    assert.deepStrictEqual(two.rewrote, ['patterns#orders']);
    assert.strictEqual(two.saidDocsOk, false, 'and it never said the phrase');
  } finally { r.rm(); }
});

// 2.8.0: docs.js logs its sets to <data root>/statistics/docs-log.jsonl; an older engine copy (the skew before
// /alfred-code:update moves the folders) still logs to <docs-path>/docs-log.jsonl, and that set answers the ask too.
test('2.8.0: a set an older engine logged under the docs root still answers the ask', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    wroteBy(r, s, 'a1', 'src/Api/Program.cs', 'app.UseFixed();\napp.Run();\n');
    const ask = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout).reason;
    const hash = /--expect ([0-9a-f]{12})/.exec(ask)[1];
    assert.strictEqual(r.cli(['set', 'patterns#orders', '--expect', hash], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are ledgered after the payment call.\n', GIT).status, 0);
    const now = '.alfred/statistics/docs-log.jsonl';
    const rows = r.read(now).split('\n').filter(Boolean);
    const sets = rows.filter((l) => l.includes('"doc-set"'));
    assert.ok(sets.length, 'the engine logged its set under statistics/');
    r.write(now, rows.filter((l) => !l.includes('"doc-set"')).map((l) => `${l}\n`).join(''));
    r.write('.claude/docs/docs-log.jsonl', sets.map((l) => `${l}\n`).join(''));
    r.hook(subStop(s, 'a1', { stop_hook_active: true, last_assistant_message: 'docs ok' }), GIT);
    const row = JSON.parse(r.read(now).trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(row.outcome, 'rewritten', 'the legacy log\'s set is read');
    assert.deepStrictEqual(row.rewrote, ['patterns#orders']);
  } finally { r.rm(); }
});

test('the reply signal is the answer itself, and a partial rewrite says so', () => {
  const r = watched({ 'watch.json': JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders', 'patterns#users'] }] }) });
  try {
    // A section set BEFORE the ask is not an answer to it.
    const early = sid();
    r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\n<!-- covers: src/Api/Users/** -->\nUsers are archived.\n', GIT);
    r.hook(subStart(early, 'a1'), GIT);
    touchBy(r, early, 'a1');
    assert.match(r.hook(subStop(early, 'a1'), GIT).stdout, /"decision":"block"/);
    // One of the two asked sections is rewritten after the ask, and the agent answers in the prescribed words.
    const hash = r.cli(['hash', 'patterns#orders'], '', GIT).stdout.trim();
    assert.strictEqual(r.cli(['set', 'patterns#orders', '--expect', hash], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are ledgered at midnight.\n', GIT).status, 0);
    r.hook(subStop(early, 'a1', { stop_hook_active: true, last_assistant_message: 'docs ok' }), GIT);
    const row = JSON.parse(r.read('.alfred/statistics/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(row.outcome, 'partial', 'one of the two asked sections was rewritten');
    assert.deepStrictEqual(row.rewrote, ['patterns#orders'], 'and the set from before the ask is not counted');
    assert.strictEqual(row.saidDocsOk, true, 'the answer the ask asked for, given as the answer');
  } finally { r.rm(); }
});

// The ledger is read from its end, because what this asks about was written seconds ago. That window is a boundary,
// and the fact it reports has to survive it: a run busy enough to push the set out of the tail must not read as a
// section nobody rewrote.
test('a set buried under a busy run is still found, however far back the ledger has moved', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    const ask = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout).reason;
    const hash = /--expect ([0-9a-f]{12})/.exec(ask)[1];
    assert.strictEqual(r.cli(['set', 'patterns#orders', '--expect', hash], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are ledgered nightly.\n', GIT).status, 0);
    // 384KB of rows on top of it, every one of them newer than the ask - so no row in the tail window is older than
    // the ask, which is exactly the signal that the set may lie further back.
    const later = new Date(Date.now() + 1000).toISOString();
    const filler = `${JSON.stringify({ at: later, session: s, event: 'hold', file: 'src/Api/Orders/Refund.cs', sections: ['patterns#orders'] })}\n`;
    const log = '.alfred/statistics/docs-log.jsonl';
    r.write(log, r.read(log) + filler.repeat(Math.ceil((384 * 1024) / filler.length)));
    r.hook(subStop(s, 'a1', { stop_hook_active: true, last_assistant_message: 'docs ok' }), GIT);
    const row = JSON.parse(r.read(log).trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(row.outcome, 'rewritten', 'the rewrite happened, and a read window is not allowed to deny it');
    assert.deepStrictEqual(row.rewrote, ['patterns#orders']);
  } finally { r.rm(); }
});

test('an agent that changed nothing, or nothing the watch list names, is never asked', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'reviewer'), GIT);
    assert.strictEqual(r.hook(subStop(s, 'reviewer'), GIT).stdout, '', 'a read-only seat must never see this');
    const t = sid();
    r.hook(subStart(t, 'impl'), GIT);
    wroteBy(r, t, 'impl', 'src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n');
    assert.strictEqual(r.hook(subStop(t, 'impl'), GIT).stdout, '', 'changed, but no watch entry hits');
    // A stop with no start before it has no snapshot, so it cannot tell what this agent changed - silence, never a guess.
    assert.strictEqual(r.hook(subStop(sid(), 'orphan'), GIT).stdout, '');
  } finally { r.rm(); }
});

test('two agents that touch one section are both asked, and the second is shown the first rewrite', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    r.hook(subStart(s, 'a2'), GIT);
    // Both seats wrote the same file - the case the pair dedupe exists for.
    touchBy(r, s, 'a1');
    r.hook(preBy(s, 'a2', 'src/Api/Program.cs'), { ...GIT, ...ALLOW });
    const first = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout);
    assert.match(first.reason, /"Refunds are ledgered before the payment call\."/);
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\nRefunds are ledgered after the payment call.\n', GIT);
    const second = JSON.parse(r.hook(subStop(s, 'a2'), GIT).stdout);
    assert.match(second.reason, /"Refunds are ledgered after the payment call\."/, 'the second agent reads what the first wrote, not what it started from');
    assert.notStrictEqual(/--expect ([0-9a-f]{12})/.exec(first.reason)[1], /--expect ([0-9a-f]{12})/.exec(second.reason)[1], 'and a different hash, so the first rewrite cannot be dropped');
  } finally { r.rm(); }
});

test('local versioning says where the doc is stored instead of telling it to commit', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    r.git('switch', '-qc', 'feat/refunds');
    const s = sid();
    r.hook(subStart(s, 'a1'));
    touchBy(r, s, 'a1', {});
    const reason = JSON.parse(r.hook(subStop(s, 'a1')).stdout).reason;
    assert.match(reason, /\n {9}and it is stored for branch feat\/refunds only\. It moves into the\n {9}shared docs by itself once this branch is merged\. Nothing to commit\.\n\nThis reply is what your caller receives/);
    assert.doesNotMatch(reason, /commit the doc with your code/);
    // On mainline the overlay is never written, so neither clause is true there.
    r.git('switch', '-q', 'develop');
    const t = sid();
    r.hook(subStart(t, 'a2'));
    wroteBy(r, t, 'a2', 'src/Api/Program.cs', 'app.UseCors();\napp.Run();\n', {});
    assert.match(JSON.parse(r.hook(subStop(t, 'a2')).stdout).reason, /\n {9}and it lands in the shared docs at once\. Nothing to commit\.\n\nThis reply is what your caller receives/);
  } finally { r.rm(); }
});

test('the ask switch turns the whole thing off, snapshot included', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    assert.strictEqual(r.hook(subStop(s, 'a1'), { ...GIT, ALFRED_CODE_DOCS_ASK: '0' }).stdout, '', 'the ask is off');
    const t = sid();
    r.hook(subStart(t, 'a2'), { ...GIT, ALFRED_CODE_DOCS_ASK: '0' });
    assert.strictEqual(r.hook(subStop(t, 'a2'), GIT).stdout, '', 'and no snapshot was taken to compare against');
    // The orientation block has its own switch and is untouched by this one.
    assert.match(r.hook(subStart(sid(), 'a3'), { ...GIT, ALFRED_CODE_DOCS_ASK: '0' }).stdout, /"hookEventName":"SubagentStart"/);
  } finally { r.rm(); }
});

test('an agent payload with no id is keyed on its type, and two sections read as two', () => {
  const r = watched({ 'watch.json': JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders', 'patterns#users'] }] }) });
  try {
    const s = sid();
    r.hook({ hook_event_name: 'SubagentStart', session_id: s, agent_type: 'dotnet-implementer' }, GIT);
    // No agent_id on the tool event either: the type keys the attribution exactly as it keys the ask.
    r.hook({ hook_event_name: 'PreToolUse', session_id: s, agent_type: 'dotnet-implementer', tool_name: 'Edit', tool_input: { file_path: 'src/Api/Program.cs' } }, { ...GIT, ...ALLOW });
    touch(r);
    const reason = JSON.parse(r.hook({ hook_event_name: 'SubagentStop', session_id: s, agent_type: 'dotnet-implementer' }, GIT).stdout).reason;
    assert.match(reason, /^2 sections document this file:$/m);
    assert.match(reason, /\n  'orders', in \.claude\/docs\/architecture\/references\/patterns\.md:\n    "Refunds are ledgered before the payment call\."\n/);
    assert.match(reason, /\n  'users', in \.claude\/docs\/architecture\/references\/patterns\.md:\n    "Users are soft-deleted\."\n/);
    assert.match(reason, /Do your changes still leave those true\?/);
    assert.match(reason, /and commit the docs with your code, so they travel with this branch\.\n\nThis reply is what your caller receives/);
  } finally { r.rm(); }
});

// The brief's line 72: a read-only seat must never see this at all. changedSince() is a whole-TREE diff, so before
// writes were attributed, a reviewer running BESIDE a writer was told it changed the writer's file. This stack
// dispatches in parallel by design, so this is the common case, not a corner.
test('a read-only seat that ran beside a writer is never asked', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'writer'), GIT);
    r.hook(subStart(s, 'reviewer'), GIT);
    touchBy(r, s, 'writer');
    assert.strictEqual(r.hook(subStop(s, 'reviewer'), GIT).stdout, '', 'the seat that opened nothing is never told it changed something');
    assert.match(r.hook(subStop(s, 'writer'), GIT).stdout, /"decision":"block"/, 'and the seat that wrote is still asked');
  } finally { r.rm(); }
});

test('two writers in parallel are each asked about their own file only', () => {
  const r = watched({ 'watch.json': JSON.stringify({ watch: [
    { kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] },
    { kind: 'user surface', globs: ['src/*/Users/**'], sections: ['patterns#users'] },
  ] }) });
  try {
    const s = sid();
    r.hook(subStart(s, 'w1'), GIT);
    r.hook(subStart(s, 'w2'), GIT);
    touchBy(r, s, 'w1');
    wroteBy(r, s, 'w2', 'src/Api/Users/User.cs', 'class User { int Id; }\n');
    const one = JSON.parse(r.hook(subStop(s, 'w1'), GIT).stdout).reason;
    assert.match(one, /^Docs check: you changed src\/Api\/Program\.cs\n/, one);
    assert.doesNotMatch(one, /patterns#users/, 'never the other seat\'s section');
    const two = JSON.parse(r.hook(subStop(s, 'w2'), GIT).stdout).reason;
    assert.match(two, /^Docs check: you changed src\/Api\/Users\/User\.cs\n/, two);
    assert.doesNotMatch(two, /patterns#orders/, 'nor the other way round');
  } finally { r.rm(); }
});

// A single-seat run used to end with the same wall of text twice in a row - the shape that earns a gate its =0.
test('the main Stop never repeats an ask an agent already made, and still asks for the rest', () => {
  const r = watched({ 'watch.json': JSON.stringify({ watch: [
    { kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] },
    { kind: 'user surface', globs: ['src/*/Users/**'], sections: ['patterns#users'] },
  ] }) });
  try {
    const s = sid();
    start(r, s);
    r.hook(subStart(s, 'w1'), GIT);
    touchBy(r, s, 'w1');
    const asked = JSON.parse(r.hook(subStop(s, 'w1'), GIT).stdout).reason;
    assert.match(asked, /patterns#orders/);
    assert.strictEqual(r.hook(stopEv(s), GIT).stdout, '', 'the session does not repeat what the seat was already asked');
    // A section no agent was asked about is still the session's to answer for.
    const t = sid();
    start(r, t);
    r.write('src/Api/Users/User.cs', 'class User { int Age; }\n');
    const reason = JSON.parse(r.hook(stopEv(t), GIT).stdout).reason;
    assert.match(reason, /patterns#users/, reason);
    assert.doesNotMatch(reason, /patterns#orders/, 'and only that one');
  } finally { r.rm(); }
});

// Separator normalisation. On win32 `path.relative` answers in backslashes while git answers in forward slashes, so
// an unnormalised recorded path can never match a changed file and the whole ask goes dark - the same mismatch has
// always defeated the first-change gate's own root check. Pinned on the COMPOSITION rather than the platform:
// running this on real Windows is NOT RUN here.
test('a recorded path is spelled the way git spells it, whatever the platform separator', () => {
  const { toPosix } = require('../stack/hooks/docs-session.js');
  const nodePath = require('node:path');
  assert.strictEqual(toPosix(nodePath.win32.relative('C:\\proj', nodePath.win32.resolve('C:\\proj', 'src/Api/Program.cs')), '\\'), 'src/Api/Program.cs');
  assert.strictEqual(toPosix('src\\Api\\Orders\\Refund.cs', '\\'), 'src/Api/Orders/Refund.cs');
  // On posix a backslash is a legal character in a file name, so only the platform's own separator is translated.
  assert.strictEqual(toPosix('weird\\name.cs', '/'), 'weird\\name.cs');
  assert.strictEqual(toPosix('src/Api/Program.cs', '/'), 'src/Api/Program.cs');
});

// The hook's own orientation block teaches agents to run `docs.js show`, and the gate rewards pairing that read with
// the change, so one shell command doing both is a shape this stack actively encourages.
test('a shell command that reads a doc and writes in one go is still attributed', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'both'), GIT);
    r.hook({ hook_event_name: 'PreToolUse', session_id: s, agent_id: 'both', agent_type: 'dotnet-implementer', tool_name: 'Bash', tool_input: { command: "node .claude/hooks/docs.js show patterns#orders; printf 'x\\n' > src/Api/Program.cs" } }, { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'x\n');
    assert.match(r.hook(subStop(s, 'both'), GIT).stdout, /"decision":"block"/, 'the consult must not swallow the write');
  } finally { r.rm(); }
});

test('a seat whose write cannot be named never claims a file another seat wrote', () => {
  const r = watched({ 'watch.json': JSON.stringify({ watch: [
    { kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] },
    { kind: 'user surface', globs: ['src/*/Users/**'], sections: ['patterns#users'] },
  ] }) });
  try {
    const s = sid();
    r.hook(subStart(s, 'blindseat'), GIT);
    r.hook(subStart(s, 'otherseat'), GIT);
    // `git apply` writes something this hook cannot name - the widening that used to hand it the whole tree.
    r.hook({ hook_event_name: 'PreToolUse', session_id: s, agent_id: 'blindseat', agent_type: 'dotnet-implementer', tool_name: 'Bash', tool_input: { command: 'git apply fix.patch' } }, { ...GIT, ...ALLOW });
    wroteBy(r, s, 'otherseat', 'src/Api/Users/User.cs', 'class User { int Id; }\n');
    assert.strictEqual(r.hook(subStop(s, 'blindseat'), GIT).stdout, '', 'another seat\'s file is never handed to a blind write');
    assert.match(r.hook(subStop(s, 'otherseat'), GIT).stdout, /patterns#users/, 'and the seat that wrote it is asked');
  } finally { r.rm(); }
});

test('a blind write still answers for the change nobody else claimed', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'blindalone'), GIT);
    r.hook({ hook_event_name: 'PreToolUse', session_id: s, agent_id: 'blindalone', agent_type: 'dotnet-implementer', tool_name: 'Bash', tool_input: { command: 'git apply fix.patch' } }, { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'app.UseApplied();\napp.Run();\n');
    assert.match(r.hook(subStop(s, 'blindalone'), GIT).stdout, /patterns#orders/, 'it did write, and nothing says what');
  } finally { r.rm(); }
});

// PreToolUse records INTENT. A write this hook DENIES never happens, so recording it lets a parallel seat's change
// be read as this seat's work.
test('a write this hook denied is never attributed to the seat that tried it', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'held'), GIT);
    r.hook(subStart(s, 'writer'), GIT);
    const denied = r.hook(preBy(s, 'held', 'src/Api/Program.cs'), GIT);
    assert.match(denied.stdout, /"permissionDecision":"deny"/, 'the first change is held, so nothing was written');
    // The writer's own change, with the gate out of the way so this call is the one that proceeds.
    r.hook(preBy(s, 'writer', 'src/Api/Program.cs'), { ...GIT, ALFRED_CODE_DOCS_GATE: '0' });
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    assert.strictEqual(r.hook(subStop(s, 'held'), GIT).stdout, '', 'the seat that wrote nothing is silent');
    assert.match(r.hook(subStop(s, 'writer'), GIT).stdout, /"decision":"block"/, 'the seat that did write is asked');
  } finally { r.rm(); }
});

// stop() is the only cover a SKILL has, and a skill's work is main-session work. Subtracting a seat's sections
// outright silenced the session about them forever, including for its own later changes.
test('the main session is asked about its OWN change to a section a seat already answered for', () => {
  const r = watched();
  try {
    const s = sid();
    start(r, s);
    r.hook(subStart(s, 'seat'), GIT);
    touchBy(r, s, 'seat');
    assert.match(r.hook(subStop(s, 'seat'), GIT).stdout, /patterns#orders/, 'the seat is asked');
    // Now the session itself edits the same file - its own tool events carry no agent id.
    r.hook({ hook_event_name: 'PreToolUse', session_id: s, tool_name: 'Edit', tool_input: { file_path: 'src/Api/Program.cs' } }, { ...GIT, ALFRED_CODE_DOCS_GATE: '0' });
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.UseCors();\napp.Run();\n');
    assert.match(JSON.parse(r.hook(stopEv(s), GIT).stdout).reason, /patterns#orders/, 'the session answers for what it wrote itself');
  } finally { r.rm(); }
});

test('the silence an unattributed agent falls into is logged, and the switch skips the record', () => {
  const r = watched();
  try {
    const s = sid();
    r.hook(subStart(s, 'ghost'), GIT);
    r.write('src/Api/Program.cs', 'app.UseGhost();\napp.Run();\n');
    assert.strictEqual(r.hook(subStop(s, 'ghost'), GIT).stdout, '');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"ask-skipped".*"why":"no write attributed to this agent"/);
    // A seat that wrote, where nothing it wrote changed: the route a separator mismatch or a crowded cap ends in.
    const t = sid();
    r.hook(subStart(t, 'stale'), GIT);
    r.hook(preBy(t, 'stale', 'src/Api/Orders/Refund.cs'), { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'app.UseOther();\napp.Run();\n');
    assert.strictEqual(r.hook(subStop(t, 'stale'), GIT).stdout, '');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"why":"nothing this agent wrote changed"/);
    // With the ask switched off no write is recorded at all.
    const u = sid();
    r.hook(preBy(u, 'offseat', 'src/Api/Program.cs'), { ...GIT, ALFRED_CODE_DOCS_ASK: '0', ALFRED_CODE_DOCS_GATE: '0' });
    assert.ok(!fs.existsSync(`${require('node:os').tmpdir()}/docs-session-${u}--offseat.json`), 'no state file is written for a switched-off ask');
  } finally { r.rm(); }
});

// The main actor's key holds a character agentKey can never emit, so no agent name can ever land in its file -
// structurally, rather than because no shipped seat happens to be called that today.
test('a seat whose type is literally main never shares the main session actor', () => {
  const r = watched();
  try {
    const s = sid();
    start(r, s);
    const seat = { session_id: s, agent_type: 'main' };
    r.hook({ hook_event_name: 'SubagentStart', ...seat }, GIT);
    r.hook({ hook_event_name: 'PreToolUse', ...seat, tool_name: 'Edit', tool_input: { file_path: 'src/Api/Program.cs' } }, { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    assert.match(r.hook({ hook_event_name: 'SubagentStop', ...seat }, GIT).stdout, /"decision":"block"/, 'the seat is asked');
    assert.strictEqual(r.hook(stopEv(s), GIT).stdout, '', 'and the session never reads the seat\'s work as its own');
  } finally { r.rm(); }
});

// The litter is this hook's own: one state file per session plus one per actor, and the sibling scan reads the
// directory they sit in. A file exactly at the cutoff is KEPT - only one strictly older is dropped.
const DAY = 24 * 3600 * 1000;
const plantOld = (dir, name, ageMs) => {
  const f = require('node:path').join(dir, name);
  fs.writeFileSync(f, '{}');
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(f, t, t);
  return f;
};
const scratch = () => fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'sweep-'));

test('state files older than seven days are swept, at the boundary and only ours', () => {
  const { sweepOldState } = require('../stack/hooks/docs-session.js');
  const dir = scratch();
  try {
    const under = plantOld(dir, 'docs-session-under.json', 6 * DAY);
    const at = plantOld(dir, 'docs-session-at.json', 7 * DAY);
    const over = plantOld(dir, 'docs-session-over.json', 8 * DAY);
    const foreign = plantOld(dir, 'not-a-docs-session.json', 30 * DAY);
    const notJson = plantOld(dir, 'docs-session-keep.log', 30 * DAY);
    // 'now' is taken from the boundary file's own recorded mtime, so 'exactly seven days' is exact rather than
    // however many milliseconds the test itself took.
    sweepOldState(fs.statSync(at).mtimeMs + 7 * DAY, dir);
    assert.ok(fs.existsSync(under), 'six days old is kept');
    assert.ok(fs.existsSync(at), 'exactly at the cutoff is kept');
    assert.ok(!fs.existsSync(over), 'eight days old is swept');
    assert.ok(fs.existsSync(foreign), 'a file that is not ours is never touched');
    assert.ok(fs.existsSync(notJson), 'nor anything that is not a state file');
    // A directory that cannot be read is not an error.
    assert.doesNotThrow(() => sweepOldState(Date.now(), require('node:path').join(dir, 'gone')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the sweep runs by itself when a new state file appears, and never fails the hook', () => {
  // os.tmpdir() reads TMPDIR on posix and TEMP (then TMP) on Windows, so all three point at this scratch
  // directory: the hook's own state and its sweep both land here, and the machine's temp directory is left alone.
  // TMPDIR alone left a Windows run sweeping the real temp dir while the planted file sat here untouched.
  const dir = scratch();
  const r = watched();
  try {
    const old = plantOld(dir, 'docs-session-stale.json', 30 * DAY);
    const fresh = plantOld(dir, 'docs-session-fresh.json', 1 * DAY);
    const out = r.hook(subStart(sid(), 'sweeper'), { ...GIT, TMPDIR: dir, TEMP: dir, TMP: dir });
    assert.strictEqual(out.status, 0);
    assert.strictEqual(out.stderr, '', 'the sweep is never fatal');
    assert.ok(!fs.existsSync(old), 'a month-old state file is gone once a new one is written');
    assert.ok(fs.existsSync(fresh), 'a live one is untouched');
    assert.ok(fs.readdirSync(dir).some((f) => /^docs-session-.*--sweeper\.json$/.test(f)), 'and this agent has its own state');
  } finally { r.rm(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a heading-only section is quoted as empty rather than as nothing at all', () => {
  const r = watched({ 'references/patterns.md': '## Order refunds\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n' });
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    const reason = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout).reason;
    assert.doesNotMatch(reason, /\n {2}""\n/, 'an empty quote reads like a bug');
    assert.match(reason, /\n {2}"\(no text yet - this section is a heading only\)"\n/, reason);
  } finally { r.rm(); }
});

test('the quoted line is one sentence, capped, whatever the section grew to', () => {
  const long = `${'Refunds go back to the original payment method and never after ninety days'.repeat(6)}. And a second sentence.`;
  const r = watched({ 'references/patterns.md': section('orders', 'src/Api/Orders/**', long) });
  try {
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    touchBy(r, s, 'a1');
    const quoted = /\n {2}"([^"]*)"\n/.exec(JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout).reason)[1];
    assert.ok(quoted.length <= 200, `the quote is capped, got ${quoted.length}`);
    assert.doesNotMatch(quoted, /second sentence/, 'one sentence, not the section');
  } finally { r.rm(); }
});

// ---- Task 5: the session hook reads every domain, not just architecture/ ----

test('a project with code-style/ and no architecture/ still gets a SessionStart block and a finish ask', () => {
  const r = repo({ files: { 'src/Api/Format.cs': 'class Format {}\n' } });
  try {
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'style', globs: ['src/**/*.cs'], sections: ['STYLE#format'] }],
    }));
    r.write('.claude/docs/code-style/STYLE.md', section('format', 'src/**/*.cs', 'Braces open on the same line.'));
    const s = sid();
    const startOut = r.hook({ hook_event_name: 'SessionStart', session_id: s });
    ran(r, s);
    const text = ctx(startOut);
    assert.match(startOut.stdout, /"hookEventName":"SessionStart"/, 'a SessionStart block even with no architecture/ at all');
    assert.match(text, /How this project is documented/);
    assert.match(text, /docs live under `\.claude\/docs\/` \(code-style\)/);
    r.write('src/Api/Format.cs', 'class Format { }\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /^Docs check: you changed src\/Api\/Format\.cs\n/);
    assert.match(reason, /"Braces open on the same line\."/);
    assert.match(reason, /set STYLE#format --expect [0-9a-f]{12}/);
  } finally { r.rm(); }
});

test('a changed .cs file hitting a section in a code-style watch produces an ask naming that section', () => {
  const r = watched(); // architecture still watches src/*/Program.cs, unrelated to this hit
  try {
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'style', globs: ['src/**/*.cs'], sections: ['STYLE#format'] }],
    }));
    r.write('.claude/docs/code-style/STYLE.md', section('format', 'src/**/*.cs', 'Braces open on the same line.'));
    const s = sid();
    r.hook(subStart(s, 'a1'), GIT);
    wroteBy(r, s, 'a1', 'src/Api/Orders/Refund.cs', 'class Refund { int Id; }\n');
    const reason = JSON.parse(r.hook(subStop(s, 'a1'), GIT).stdout).reason;
    assert.match(reason, /^Docs check: you changed src\/Api\/Orders\/Refund\.cs\n/);
    assert.match(reason, /"Braces open on the same line\."/);
    assert.match(reason, /set STYLE#format --expect [0-9a-f]{12}/);
  } finally { r.rm(); }
});

test('the same filename in two domains, each with its own watch entry, produces two asks that name the right sections', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    // Both domains declare the exact same BARE spelling for their own section - the ambiguity a bare ref can now
    // hit, since a watch.json's sections are stored verbatim and two domains can each hold a file named NOTES.md.
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'style', globs: ['src/*/Program.cs'], sections: ['NOTES#note'] }],
    }));
    r.write('.claude/docs/code-style/NOTES.md', section('note', '', 'Braces open on the same line.'));
    r.write('.claude/docs/related-projects/watch.json', JSON.stringify({
      watch: [{ kind: 'related', globs: ['src/*/Program.cs'], sections: ['NOTES#note'] }],
    }));
    r.write('.claude/docs/related-projects/NOTES.md', section('note', '', 'See the shared auth service.'));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /^2 sections document this file:/m, reason);
    // Neither dropped (both quotes present) and neither crossed (each quote sits beside its OWN domain's file).
    assert.match(reason, /\.claude\/docs\/code-style\/NOTES\.md:\n {4}"Braces open on the same line\."/, reason);
    assert.match(reason, /\.claude\/docs\/related-projects\/NOTES\.md:\n {4}"See the shared auth service\."/, reason);
    assert.match(reason, /set code-style\/NOTES#note --expect [0-9a-f]{12}/, reason);
    assert.match(reason, /set related-projects\/NOTES#note --expect [0-9a-f]{12}/, reason);
  } finally { r.rm(); }
});

test('four domains present and the orientation lines survive', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    for (const d of ['code-style', 'related-projects', 'testing']) r.write(`.claude/docs/${d}/watch.json`, '{}');
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /How this project is documented - read this before deciding how to implement anything\./);
    assert.match(text, /docs live under `\.claude\/docs\/` \(architecture, code-style, related-projects, testing\)/);
    assert.match(text, /node \.claude\/hooks\/docs\.js where <path>/);
    assert.match(text, /node \.claude\/hooks\/docs\.js show <file>#<id>/);
    assert.match(text, /Orders own refunds/, 'ORIENTATION.md itself is still architecture-only and still carried');
  } finally { r.rm(); }
});

test('a domain whose watch.json is malformed does not take another domain\'s ask down with it', () => {
  const r = repo({ files: { 'src/Api/Format.cs': 'class Format {}\n' } });
  try {
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'style', globs: ['src/**/*.cs'], sections: ['STYLE#format'] }],
    }));
    r.write('.claude/docs/code-style/STYLE.md', section('format', 'src/**/*.cs', 'Braces open on the same line.'));
    r.write('.claude/docs/related-projects/watch.json', '{ not json');
    const s = sid();
    start(r, s);
    r.write('src/Api/Format.cs', 'class Format { }\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /"Braces open on the same line\."/, 'the malformed neighbour never blinds this domain\'s ask');
  } finally { r.rm(); }
});

// consultedBy used to credit a read only under architecture/. A project documented in code-style/ alone must get
// the same credit toward the first-change gate - the covers glob deliberately does not match the write target, so
// the only way this write goes through unheld is if the earlier Read itself was credited.
test('a doc read under any domain earns consult credit, not just architecture/', () => {
  const r = repo({ files: { 'src/Api/Format.cs': 'x\n' } });
  try {
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({ sourceRoots: ['src'] }));
    r.write('.claude/docs/code-style/STYLE.md', section('format', 'nomatch/**', 'Braces open on the same line.'));
    const s = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/code-style/STYLE.md` }, s));
    assert.ok(!denied(r.hook(pre('Write', { file_path: 'src/Api/Format.cs', content: 'x' }, s))), 'a code-style/ read releases the gate on the first try');
  } finally { r.rm(); }
});

// The credit is scoped to domain directories, never the whole docs root - hook-blocks/ and docs-log.jsonl sit
// beside the domain folders under the same root, and neither is a section covering a file.
test('a read under hook-blocks/ or docs-log.jsonl earns no consult credit', () => {
  const r = repo({ files: { 'src/Api/Format.cs': 'x\n' } });
  try {
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({ sourceRoots: ['src'] }));
    r.write('.claude/docs/code-style/STYLE.md', section('format', 'nomatch/**', 'Braces open on the same line.'));
    r.write('.claude/docs/docs-log.jsonl', '{}\n');
    r.write('.claude/docs/hook-blocks/x.jsonl', '{}\n');
    const s = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/docs-log.jsonl` }, s));
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/hook-blocks/x.jsonl` }, s));
    assert.ok(denied(r.hook(pre('Write', { file_path: 'src/Api/Format.cs', content: 'x' }, s))), 'reading the ledger or the block log is not a doc consult');
  } finally { r.rm(); }
});

// ---- Task 6b: a watch entry pointing at a protected file's section WARNS instead of going silent ----

test('a watch entry naming a section in a protected file produces a warning, not an ask - no command anywhere in it', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'NOTES.md': section('policy', '', 'Refunds are deliberately synchronous - the caller must see the failure.') } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['NOTES#policy'] }],
      notOwned: ['NOTES.md'],
    }));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /^Docs check: you changed src\/Api\/Program\.cs\n/);
    assert.match(reason, /A DECISION recorded by a person covers this file - 'policy', in \.claude\/docs\/architecture\/NOTES\.md:/, reason);
    assert.match(reason, /"Refunds are deliberately synchronous - the caller must see the failure\."/);
    assert.match(reason, /If your change makes that untrue, say so in your answer/);
    assert.doesNotMatch(reason, /reply: docs ok/, 'a warning offers no docs-ok affordance');
    assert.doesNotMatch(reason, /--expect/, 'a warning offers no --expect hash');
    assert.doesNotMatch(reason, /docs\.js set/, 'a warning offers no set command');
  } finally { r.rm(); }
});

test('ORIENTATION.md still produces nothing - no ask, no warning - once other watch entries exist', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT, 'watch.json': WATCH() } });
  try {
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.doesNotMatch(reason, /ORIENTATION/, 'nothing ever points a watch entry at it, so it never surfaces');
  } finally { r.rm(); }
});

// The proven bug from Task 5's review: domain alpha declares its own NOTES.md protected and watches
// 'NOTES#note'; domain beta holds a NOTES.md of its own too. Alpha's copy used to be invisible to the
// bare-resolution path, so the bare id resolved UNIQUELY (not ambiguously) to beta's file - no throw,
// so the qualified fallback never ran, and alpha's watch entry quoted beta's text and handed over a
// `set` that wrote into beta. Checking the hit's own domain for a protected match FIRST closes it.
test('the alpha/beta case: a domain\'s protected file is never answered by another domain\'s same-named file', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    r.write('.claude/docs/alpha/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['NOTES#note'] }],
      notOwned: ['NOTES.md'],
    }));
    r.write('.claude/docs/alpha/NOTES.md', section('note', '', 'Alpha decision text.'));
    r.write('.claude/docs/beta/watch.json', '{}');
    r.write('.claude/docs/beta/NOTES.md', section('note', '', 'Beta text.'));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /A DECISION recorded by a person covers this file - 'note', in \.claude\/docs\/alpha\/NOTES\.md:/, reason);
    assert.match(reason, /"Alpha decision text\."/);
    assert.doesNotMatch(reason, /Beta text/, 'alpha\'s entry must never quote beta\'s text');
    assert.doesNotMatch(reason, /set [\w/-]*NOTES#note/, 'never hands over a set into either file - a warning carries no command at all');
  } finally { r.rm(); }
});

test('one changed file hitting a normal section and a protected one yields one ask and one warning, never merged', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
    }));
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#refund-sync'] }],
      notOwned: ['DECISIONS.md'],
    }));
    r.write('.claude/docs/decisions/DECISIONS.md', section('refund-sync', '', 'Refunds are deliberately synchronous.'));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /One section documents this file - 'orders', in \.claude\/docs\/architecture\/references\/patterns\.md:/, reason);
    assert.match(reason, /"Refunds are ledgered before the payment call\."/);
    assert.match(reason, /set patterns#orders --expect [0-9a-f]{12}/);
    assert.match(reason, /A DECISION recorded by a person covers this file - 'refund sync', in \.claude\/docs\/decisions\/DECISIONS\.md:/, reason);
    assert.match(reason, /"Refunds are deliberately synchronous\."/);
    // Never merged into one block, and the warning LEADS: it can never be discharged, while the ask right
    // after it can be closed with one reply - a reader who answers the ask must not have already stopped
    // reading before reaching the warning. Also, the warning never borrows the ask's command: nothing
    // between where it starts and where the ask begins mentions a set command, an --expect hash or the
    // docs-ok reply.
    const warnIdx = reason.indexOf("A DECISION recorded by a person");
    const askIdx = reason.indexOf("One section documents this file");
    assert.ok(warnIdx > 0, reason);
    assert.ok(askIdx > warnIdx, reason);
    assert.doesNotMatch(reason.slice(warnIdx, askIdx), /--expect|reply: docs ok|docs\.js set/);
  } finally { r.rm(); }
});

// The message has a singular and a PLURAL branch, and only the singular one was covered - so the plural
// kept its pre-review wording ('sections a person owns') through a wording change the user made
// deliberately, and nothing went red. A user-facing string with no test is a string that drifts.
test('two protected sections warn in the plural, in the same words as the singular branch', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#refund-sync', 'DECISIONS#queue-depth'] }],
      notOwned: ['DECISIONS.md'],
    }));
    r.write('.claude/docs/decisions/DECISIONS.md',
      `${section('refund-sync', '', 'Refunds are deliberately synchronous.')}\n${section('queue-depth', '', 'The queue is bounded at 1000 on purpose.')}`);
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /2 DECISIONS recorded by a person cover this file:/, reason);
    assert.match(reason, /"Refunds are deliberately synchronous\."/, reason);
    assert.match(reason, /"The queue is bounded at 1000 on purpose\."/, reason);
    // The guarantee that makes a warning a warning holds in the plural too.
    assert.doesNotMatch(reason, /--expect|reply: docs ok|docs\.js set/, reason);
  } finally { r.rm(); }
});

// Task 5's review measured that with four domains (hits walked strictly in domain-alphabetical order,
// one cap of 3 shared by everything) only the first domain's entries plus one more ever got named - and
// a protected section in the third domain would be starved by the first two before it was ever reached.
// Asks and warnings now fill SEPARATE pools, so a warning is never crowded out by an ask that merely
// sorted earlier.
test('four domains where the third declares a protected section: the warning is delivered, not starved by the first two filling the ask cap', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders', 'patterns#users'] }],
    }));
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['STYLE#format', 'STYLE#indent'] }],
    }));
    r.write('.claude/docs/code-style/STYLE.md', `${section('format', '', 'Braces open on the same line.')}\n${section('indent', '', 'Two spaces, never tabs.')}`);
    // 'decisions' sorts third among these four domain names, exactly the position Task 5's review named.
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#refund-sync'] }],
      notOwned: ['DECISIONS.md'],
    }));
    r.write('.claude/docs/decisions/DECISIONS.md', section('refund-sync', '', 'Refunds are deliberately synchronous.'));
    r.write('.claude/docs/testing/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['TEST#coverage'] }],
    }));
    r.write('.claude/docs/testing/TEST.md', section('coverage', '', 'Every handler gets an integration test.'));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /A DECISION recorded by a person covers this file - 'refund sync', in \.claude\/docs\/decisions\/DECISIONS\.md:/, reason);
    assert.match(reason, /"Refunds are deliberately synchronous\."/);
  } finally { r.rm(); }
});

// Task 6b review, finding 2: fixing domain starvation above also reorders sections WITHIN a single domain
// once it has more than one matching watch entry - the fill loop draws one id per QUEUE per pass, and a
// queue is one watch entry, not one domain. Measured by the review: one domain, entry A (3 sections) then
// entry B (1 section), cap 3 - straight walk gave A#one, A#two, A#three; round-robin gives A#one, B#four,
// A#two, dropping A#three instead of starving B. Breadth over depth is the deliberate call (see the
// comment above sectionRefs); this pins today's order so a further change to the fill order is a decision,
// not an accident.
test('round-robin fills breadth-first across watch entries even within one domain, dropping the longer entry\'s last id before the shorter one is ever skipped', () => {
  const r = repo({
    files: { 'src/Api/Program.cs': 'app.Run();\n' },
    docs: {
      'references/patterns.md': ['one', 'two', 'three'].map((x) => section(x, '', `${x} text.`)).join('\n'),
      'other.md': section('four', '', 'four text.'),
    },
  });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [
        { kind: 'A', globs: ['src/*/Program.cs'], sections: ['patterns#one', 'patterns#two', 'patterns#three'] },
        { kind: 'B', globs: ['src/*/Program.cs'], sections: ['other#four'] },
      ],
    }));
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    const at = (needle) => reason.indexOf(needle);
    assert.ok(at('patterns#one') >= 0 && at('other#four') >= 0 && at('patterns#two') >= 0, reason);
    assert.ok(at('patterns#one') < at('other#four') && at('other#four') < at('patterns#two'), `expected the order one, four, two:\n${reason}`);
    assert.strictEqual(at('patterns#three'), -1, 'the cap is 3: the id round-robin never reaches (patterns#three) is dropped, not entry B');
  } finally { r.rm(); }
});

// ---- Task 14 / whole-branch review finding 1: lint and this hook must resolve a watch entry the SAME way ----
// A bare 'patterns#orders' is the spelling every existing install's watch.json holds, and it turns ambiguous the
// moment a second domain owns a references/patterns.md too - which the engine's own comment calls ordinary, since
// every domain owns a references/ folder. The hook falls back to the domain-qualified spelling and asks about the
// right section; lint had no such fallback and called the same entry missing. Three shipped skills name lint the
// arbiter and tell an agent to FIX a PROBLEM line, so the false positive instructs the repair of a CORRECT entry -
// and the ask asserted here is what dies with it. Driven through both readers in one test on purpose: the defect
// was in neither one alone, it was in the two disagreeing.
test('a bare watch entry ambiguous across two domains is asked about by the hook and never called missing by lint', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      sourceRoots: ['src'],
      watch: [{ kind: 'orders', globs: ['src/Api/Orders/**'], sections: ['patterns#orders'] }],
    }));
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/code-style/references/patterns.md', section('orders', '', 'Style patterns live here.'));
    const s = sid();
    start(r, s);
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /"Refunds are ledgered before the payment call\."/, 'the hook resolves the bare entry to its own domain\'s file');
    assert.doesNotMatch(reason, /Style patterns live here/, 'and never to the other domain\'s same-named file');
    const out = r.cli(['lint']);
    assert.doesNotMatch(out.stdout, /names a section that does not exist/, `lint must resolve what the hook resolved:\n${out.stdout}`);
    assert.strictEqual(out.status, 0, out.stdout);
  } finally { r.rm(); }
});

// A provisional orientation (plan 4.12) reaches every session with the warning that it is stale by definition; and a
// docs root holding nothing to read by section - only that file - has nothing for the first-change gate to hand over.
const PROVISIONAL = 'Captured: develop@abc1234, 2026-09-23\n\n# Orientation (provisional - replaced by the architecture capture)\n\n| Build | `dotnet build Shop.sln` |\n';
test('a provisional orientation is pushed with its stale warning, and with no section to read the gate stands down', () => {
  const r = repo({ files: { 'src/Api/Refund.cs': 'x\n' }, docs: { 'ORIENTATION.md': PROVISIONAL } });
  try {
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /dotnet build Shop\.sln/);
    assert.match(text, /This orientation is PROVISIONAL/);
    assert.doesNotMatch(text, /Before your first change/, 'no section exists to read first');
    assert.match(ctx(r.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_id: 'a1' })), /This orientation is PROVISIONAL/);
    const s = sid();
    assert.ok(!denied(r.hook(pre('Write', { file_path: 'src/Api/New.cs', content: 'x' }, s))), 'nothing to read, no hold');
    r.write('.claude/docs/architecture/references/patterns.md', PATTERNS);
    assert.ok(denied(r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, sid()))), 'with a section to read the gate holds as before');
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /Before your first change/);
  } finally { r.rm(); }
});

test('a captured orientation carries no provisional warning', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  try {
    assert.doesNotMatch(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /PROVISIONAL/);
  } finally { r.rm(); }
});

test('CLAUDE.md says a navigation rename is credited to its declaring file alone (2.1.5 final review R9)', () => {
  // serena's rename_symbol carries the declaring file in `relative_path`; the reference edits in other files are not
  // in the call, so they fall to the Stop ask's unclaimed bucket and outside the turn check's root - accepted, and said.
  const md = require('./claude-docs.js').readClaudeDocs();
  const entry = md.slice(md.indexOf('  - `docs-session.js` ('), md.indexOf('  - `preferences-session.js` ('));
  assert.match(entry, /a rename is credited to that declaring file alone/);
  assert.match(entry, /'no actor claimed' bucket and outside the turn check's root/);
});

// 2.2.0 upgrade: the docs move's own PostToolUse hooks still read the old root and rebuilt .claude/docs/flow.
// Since 2.8.0 each piece folds into its layout.js home - state/approvals/, state/sessions/, state/history/, statistics/ -
// never back into the docs root's retired flow/ or hook-blocks/; a live copy the pre-2.8.0 docs root still holds counts as
// the live one (findState), so a stale stranded stamp never lands in state/ to shadow it.
test('session start folds hook state stranded under the old .claude/docs into the live root', () => {
  const r = repo({ docsPath: '.alfred/docs', docs: { 'ORIENTATION.md': ORIENT } });
  try {
    r.write('.claude/docs/flow/monitor-s1.jsonl', '\n{"id":"old"}\n');
    r.write('.claude/docs/flow/APPROVAL', 'stale\n');
    r.write('.claude/docs/flow/COMMIT-GATE', 'VERIFIED x\n');
    r.write('.claude/docs/flow/turn-edits-s2', 'a.cs\n');
    r.write('.claude/docs/hook-blocks/s1.jsonl', '{"b":1}\n');
    r.write('.claude/docs/history/s3.json', '{"session":"s3"}\n');
    r.write('.claude/docs/tools-usage/s4.jsonl', '{"t":1}\n');
    r.write('.claude/docs/.DS_Store', 'x');
    r.write('.claude/settings.json', '{}\n');
    r.write('.alfred/docs/flow/monitor-s1.jsonl', '\n{"id":"new"}\n');
    r.write('.alfred/docs/flow/APPROVAL', 'live\n');
    const out = r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    assert.strictEqual(out.status, 0, out.stderr);
    assert.ok(!r.exists('.claude/docs'), 'the stranded root is gone');
    assert.ok(r.exists('.claude/settings.json'), '.claude/ itself is untouched');
    assert.match(r.read('.alfred/docs/flow/monitor-s1.jsonl'), /"new"[\s\S]*"old"/, 'a .jsonl appends to the live copy where it lives');
    assert.strictEqual(r.read('.alfred/docs/flow/APPROVAL'), 'live\n', 'the live root keeps its own state');
    assert.ok(!r.exists('.alfred/state/approvals/APPROVAL'), 'a stale stamp never lands in state/ to shadow the live one');
    assert.strictEqual(r.read('.alfred/state/approvals/COMMIT-GATE'), 'VERIFIED x\n', 'a receipt moves to state/approvals/');
    assert.strictEqual(r.read('.alfred/state/sessions/turn-edits-s2'), 'a.cs\n', 'session scratch moves to state/sessions/');
    assert.strictEqual(r.read('.alfred/state/history/s3.json'), '{"session":"s3"}\n', 'a session record moves to state/history/');
    assert.strictEqual(r.read('.alfred/statistics/hook-blocks/s1.jsonl'), '{"b":1}\n', 'a ledger moves to statistics/');
    assert.strictEqual(r.read('.alfred/statistics/tools-usage/s4.jsonl'), '{"t":1}\n');
    for (const gone of ['.alfred/docs/flow/COMMIT-GATE', '.alfred/docs/flow/turn-edits-s2', '.alfred/docs/hook-blocks', '.alfred/docs/history', '.alfred/docs/tools-usage']) {
      assert.ok(!r.exists(gone), `nothing is written to the retired ${gone}`);
    }
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"stranded-root","from":".claude\/docs","files":7/);
    // A re-run finds nothing and logs nothing more.
    r.hook({ hook_event_name: 'SessionStart', session_id: sid() });
    assert.strictEqual(r.read('.alfred/statistics/docs-log.jsonl').match(/stranded-root/g).length, 1);
  } finally { r.rm(); }
});

test('a stranded-root sweep leaves the old root alone when it holds a doc, a tracked file or is the live root', () => {
  const doc = repo({ docsPath: '.alfred/docs' });
  const tracked = repo({ docsPath: '.alfred/docs' });
  const live = repo({ docsPath: '.claude/docs' });
  const litter = repo({ docsPath: '.alfred/docs' });
  try {
    doc.write('.claude/docs/flow/monitor-s1.jsonl', '{}\n');
    doc.write('.claude/docs/architecture/ORIENTATION.md', ORIENT);
    tracked.write('.claude/docs/flow/APPROVAL', 'x\n');
    tracked.git('add', '-f', '.claude/docs/flow/APPROVAL'); tracked.git('commit', '-qm', 'track');
    live.write('.claude/docs/flow/monitor-s1.jsonl', '{}\n');
    litter.write('.claude/docs/.DS_Store', 'x');
    for (const r of [doc, tracked, live, litter]) assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }).status, 0);
    assert.ok(doc.exists('.claude/docs/flow/monitor-s1.jsonl') && !doc.exists('.alfred/docs/flow/monitor-s1.jsonl'), 'one doc keeps all of it');
    assert.ok(tracked.exists('.claude/docs/flow/APPROVAL'), 'a tracked file keeps all of it');
    assert.ok(live.exists('.claude/docs/flow/monitor-s1.jsonl'), 'the live root is never swept');
    assert.ok(!litter.exists('.claude/docs'), 'OS litter alone goes');
  } finally { for (const r of [doc, tracked, live, litter]) r.rm(); }
});

// ---- audit 2026-10-08: state, the porcelain cap, consult credit, the start-block cap, unattended rows, no watch ----

// Row 19: a parallel PreToolUse call read a half-written state file as `{snapshot: null}` and saved that back, losing the
// session's snapshot and its Stop ask. A reader landing mid-write now sees the previous state whole.
test('a state write is whole or absent to a reader that lands mid-write', () => {
  const { saveState, loadState } = require('../stack/hooks/docs-session.js');
  const s = sid();
  const file = require('node:path').join(require('node:os').tmpdir(), `docs-session-${s}.json`);
  const real = fs.writeFileSync;
  let seen = null;
  try {
    saveState(s, { snapshot: { head: 'before' } });
    fs.writeFileSync = (p, data, ...rest) => { real(p, String(data).slice(0, 7)); seen = loadState(s); return real(p, data, ...rest); };
    try { saveState(s, { snapshot: { head: 'after' } }); } finally { fs.writeFileSync = real; }
    assert.deepStrictEqual(seen.snapshot, { head: 'before' }, 'the reader mid-write saw the previous state whole');
    assert.deepStrictEqual(loadState(s).snapshot, { head: 'after' });
    assert.ok(!fs.readdirSync(require('node:path').dirname(file)).some((f) => f.startsWith(`docs-session-${s}.json.`)), 'no temp file is left behind');
  } finally { fs.writeFileSync = real; fs.rmSync(file, { force: true }); }
});

// Row 21: each round resolved every hit's next id before re-checking the cap, so 100 watch hits cost 100 section walks
// (137 / 738 / 2,261ms at 1 / 30 / 100 hits) for the same three asks.
test('the hit loop stops resolving at the cap: 100 watch hits cost three lookups, not 100', () => {
  const { sectionRefs } = require('../stack/hooks/docs-session.js');
  let calls = 0;
  const docs = { askRef: (id) => { calls++; return { id }; }, protectedRef: () => null, notOwnedOf: () => [], unowned: () => [] };
  const hits = Array.from({ length: 100 }, (_, i) => ({ kind: 'k', files: [`f${i}`], sections: [`p#s${i}`], domain: 'architecture' }));
  const { asks } = sectionRefs(docs, hits, 3);
  assert.deepStrictEqual(asks.map((a) => a.id), ['p#s0', 'p#s1', 'p#s2']);
  assert.strictEqual(calls, 3);
});

// Row 20: past 2,000 dirty paths the cap took git's first 2,000, so untracked files sorting ahead of a new watched file
// cost it its ask.
test('a watched new file past 2,000 other untracked paths is still asked about', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid();
    start(r, s);
    for (let i = 0; i < 2100; i++) r.write(`a/f${String(i).padStart(4, '0')}.txt`, `${i}\n`);
    r.write('src/New/Program.cs', 'app.Run();\n');
    const out = r.hook(stopEv(s));
    assert.match(out.stdout, /"decision":"block"/);
    assert.match(JSON.parse(out.stdout).reason, /src\/New\/Program\.cs/);
  } finally { r.rm(); }
});

// Row 42: a Glob of the docs folder, an `ls`, a Read of watch.json, an echoed show line and a show of a ref that does not
// exist each unlocked the hold; none of them reads a section.
test('a listing, a watch.json read, an echoed show and a show of a missing ref earn no consult credit', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const refs = `${r.root}/.claude/docs/architecture/references`;
  const write = (s) => r.hook(pre('Write', { file_path: 'src/Api/Orders/New.cs', content: 'x' }, s));
  try {
    const tries = [
      ['Glob', { pattern: '**/*.md', path: refs }],
      ['Bash', { command: `ls ${refs}` }],
      ['Read', { file_path: `${r.root}/.claude/docs/architecture/watch.json` }],
      ['Bash', { command: 'echo "next: node .claude/hooks/docs.js show patterns#orders"' }],
      ['Bash', { command: 'node .claude/hooks/docs.js show patterns#nope' }],
    ];
    for (const [tool, input] of tries) {
      const s = sid();
      r.hook(pre(tool, input, s));
      assert.ok(denied(write(s)), `${tool} ${JSON.stringify(input)} earned credit`);
    }
    const s = sid();
    r.hook(pre('Bash', { command: `head -40 ${refs}/patterns.md` }, s));
    assert.ok(!denied(write(s)), 'a shell read of a doc file still counts');
  } finally { r.rm(); }
});

// Row 42: an 11,901-byte ORIENTATION.md pushed the start block past the harness's 10,000-character context cap, which
// swaps it for a preview, so the where / show lines at its end were lost.
test('the start block caps ORIENTATION.md at 4KB and keeps the read lines after it', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': `${'Orders own refunds. '.repeat(600)}\n` } });
  try {
    const text = ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
    assert.match(text, /ORIENTATION\.md continues past its 4KB cap/);
    assert.match(text, /node \.claude\/hooks\/docs\.js show <file>#<id>/);
    assert.ok(text.length < 10000, `${text.length} chars`);
  } finally { r.rm(); }
});

// Row 42: the unattended skips went to docs-log.jsonl alone; every other asking hook writes a `mode: unattended` row the
// block-rate tally reads.
test('an unattended hold and an unattended Stop ask each write one mode: unattended row', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const U = { ALFRED_CODE_UNATTENDED: '1' };
  try {
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s }, U);
    ran(r, s, U);
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s), U)), 'never held unattended');
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    assert.strictEqual(r.hook(stopEv(s), U).stdout, '', 'never asked unattended');
    const rows = r.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(rows.map((x) => [x.mode, x.event, x.kind]), [['unattended', 'PreToolUse', 'docs hold'], ['unattended', 'Stop', 'docs finish ask']]);
    // Audit 2026-10-20 H11: one row per kind per session - a second held write and a second Stop add none.
    r.write('src/Api/Orders/Refund.cs', 'y\n');
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s), U)), 'still never held');
    assert.strictEqual(r.hook(stopEv(s), U).stdout, '', 'still never asked');
    assert.strictEqual(r.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').length, 2, 'no row repeats its kind');
  } finally { r.rm(); }
});

// Row 42: Stop diffed the whole tree every turn (47-261ms) even when no domain watches anything, which can only end in no
// hit. A git shim on PATH counts the calls.
test('with no watch entry Stop never diffs the tree', { skip: process.platform === 'win32' && 'a sh shim on PATH' }, () => {
  const path = require('node:path');
  const real = require('node:child_process').execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': '{}' } });
  const bin = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'git-shim-'));
  const calls = path.join(bin, 'calls.log');
  try {
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${calls}"\nexec "${real}" "$@"\n`, { mode: 0o755 });
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s }, env);
    ran(r, s, env);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    fs.writeFileSync(calls, '');
    assert.strictEqual(r.hook(stopEv(s), env).stdout, '');
    assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /status --porcelain|diff --name-only/);
  } finally { r.rm(); fs.rmSync(bin, { recursive: true, force: true }); }
});

// audit 2026-10-10 (84eedb4b, T4 cross-track): a plan stamped Completed: is a record - new scope opens a new plan file.
test('a write to a plan stamped Completed: is denied unless it changes only stamp lines', () => {
  const PLAN = '# Plan: csv export\nGated: 2026-10-09\nApproved: 2026-10-09 - build inline\nCompleted: 2026-10-09\n\n## Tasks\n- [x] Task 1 - export\n';
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/plans/csv-export.md', PLAN);
    r.write('.claude/docs/plans/open.md', '# Plan: open\nGated: 2026-10-10\n\n## Tasks\n- [ ] Task 1\n');
    const s = sid();
    const edit = (o, nw, file = 'csv-export.md') => r.hook(pre('Edit', { file_path: `${r.root}/.claude/docs/plans/${file}`, old_string: o, new_string: nw }, s));
    const add = edit('- [x] Task 1 - export\n', '- [x] Task 1 - export\n- [ ] Task 2 - the form fixes\n');
    assert.ok(denied(add), 'new scope appended to the stamped plan');
    assert.match(JSON.parse(add.stdout).hookSpecificOutput.permissionDecisionReason, /stamped Completed: .*NEW plan file.*ungated: <why>/s);
    assert.ok(!denied(edit('Completed: 2026-10-09\n', 'Completed: 2026-10-09 - Conformance: sound\n')), 'a stamp line may change');
    assert.ok(!denied(edit('- [ ] Task 1\n', '- [x] Task 1\n', 'open.md')), 'an open plan is edited freely');
    assert.ok(denied(r.hook(pre('Write', { file_path: `${r.root}/.claude/docs/plans/csv-export.md`, content: `${PLAN}- [ ] Task 2\n` }, s))), 'a Write that adds a task');
    assert.ok(!denied(r.hook(pre('Write', { file_path: `${r.root}/.claude/docs/plans/next-cycle.md`, content: '# Plan: next\n' }, s))), 'a NEW plan file');
    assert.ok(denied(r.hook(pre('MultiEdit', { file_path: `${r.root}/.claude/docs/plans/csv-export.md`, edits: [{ old_string: 'Gated: 2026-10-09', new_string: 'Gated: 2026-10-10' }, { old_string: '## Tasks', new_string: '## Tasks\n- [ ] Task 0' }] }, s))), 'one non-stamp edit in a MultiEdit');
    assert.ok(denied(r.hook(pre('Bash', { command: 'echo "- [ ] Task 2" >> .claude/docs/plans/csv-export.md' }, s))), 'a shell append');
    assert.ok(!denied(r.hook(pre('Bash', { command: 'grep -c Task .claude/docs/plans/csv-export.md' }, s))), 'a read');
    const rows = r.read(`.alfred/statistics/hook-blocks/${s}.jsonl`).trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(rows.length >= 4 && rows.every((x) => /stamped Completed/.test(x.reason)), 'one block row per denial');
  } finally { r.rm(); }
});

// The 2026-10-17 usage audit: the close that writes `Completed:` kept writing its own lines after it (the memories line, a
// tick, the leftovers) and each was denied. The actor that added the stamp edits that plan freely until the close stop is
// put to the user - an ask answered or a prompt typed after the stamp - then the record holds.
test('the close that stamps Completed: finishes its own edits; after its stop is answered the record holds', () => {
  const path = require('node:path');
  const OPEN = '# Plan: csv export\nGated: 2026-10-09\nApproved: 2026-10-09 - build inline\n\n## Tasks\n- [x] Task 1 - export\n';
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/plans/csv-export.md', OPEN);
    const s = sid();
    const tp = path.join(r.root, `${s}.jsonl`);
    const rows = (...xs) => fs.appendFileSync(tp, xs.map((x) => JSON.stringify(x)).join('\n') + '\n');
    rows({ type: 'user', message: { role: 'user', content: 'close it' } });
    const file = `${r.root}/.claude/docs/plans/csv-export.md`;
    const edit = (o, nw, session = s) => r.hook({ ...pre('Edit', { file_path: file, old_string: o, new_string: nw }, session), transcript_path: tp });
    assert.ok(!denied(edit('Approved: 2026-10-09 - build inline\n', 'Approved: 2026-10-09 - build inline\nCompleted: 2026-10-17\n')), 'the stamp itself');
    r.write('.claude/docs/plans/csv-export.md', OPEN.replace('build inline\n', 'build inline\nCompleted: 2026-10-17\n'));
    rows({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: {} }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } });
    assert.ok(!denied(edit('- [x] Task 1 - export\n', '- [x] Task 1 - export\nmemories purged: none\n')), 'the close\'s own line after the stamp');
    assert.ok(denied(edit('- [x] Task 1 - export\n', '- [x] Task 1 - export\n- [ ] Task 2\n', sid())), 'another session is still refused');
    rows({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'AskUserQuestion', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'Your questions have been answered: "Close?"="Close (Recommended)"' }] } });
    assert.ok(denied(edit('- [x] Task 1 - export\n', '- [x] Task 1 - export\n- [ ] Task 2\n')), 'the close stop answered: the record holds');
    const s2 = sid();
    const tp2 = path.join(r.root, `${s2}.jsonl`);
    fs.writeFileSync(tp2, JSON.stringify({ type: 'user', message: { role: 'user', content: 'close' } }) + '\n');
    r.write('.claude/docs/plans/csv-export.md', OPEN);
    r.hook({ ...pre('Edit', { file_path: file, old_string: 'build inline\n', new_string: 'build inline\nCompleted: 2026-10-17\n' }, s2), transcript_path: tp2 });
    r.write('.claude/docs/plans/csv-export.md', OPEN.replace('build inline\n', 'build inline\nCompleted: 2026-10-17\n'));
    fs.appendFileSync(tp2, JSON.stringify({ type: 'user', message: { role: 'user', content: 'and add the pdf export' } }) + '\n');
    assert.ok(denied(r.hook({ ...pre('Edit', { file_path: file, old_string: '- [x] Task 1 - export\n', new_string: '- [x] Task 1 - export\n- [ ] Task 2 - pdf\n' }, s2), transcript_path: tp2 })), 'a typed prompt after the stamp ends the close');
  } finally { r.rm(); }
});

// ---- audit 2026-10-10 C03 / C23: the hold pastes only a covering section, and calls only a code-style one the convention ----
test('audit 2026-10-10 C03 C23: a word-only hit is named as a candidate, never pasted as the convention; the hold does not repeat', () => {
  const WORDS = section('di-selection', '', 'The staff role composition table: staff role selection happens in the composition root, and the staff role seed reads it.');
  const r = repo({ files: { 'src/Api/Seeding/StaffRoleSeed.cs': 'class StaffRoleSeed {}\n' }, docs: { 'references/integrations.md': WORDS, 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const held = r.hook(pre('Edit', { file_path: 'src/Api/Seeding/StaffRoleSeed.cs' }, s));
    assert.ok(denied(held), 'still one hold');
    assert.match(held.stdout, /No section declares src\/Api\/Seeding\/StaffRoleSeed\.cs; these name its words:/);
    assert.match(held.stdout, /integrations#di-selection \(\d+ chars, `node \.claude\/hooks\/docs\.js show integrations#di-selection`\)/);
    assert.doesNotMatch(held.stdout, /selection happens in the composition root/, 'the section is not pasted');
    assert.doesNotMatch(held.stdout, /convention this change follows/);
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Seeding/StaffRoleSeed.cs' }, s))), 'the retry goes through');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"hold".*"via":"words"/);
  } finally { r.rm(); }
});

test('audit 2026-10-10 C23: a covering section is the documented context; a preferences section is preferences-session\'s to hand over (2026-10-21)', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const plain = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, sid()));
    assert.match(plain.stdout, /patterns#orders covers src\/Api\/Orders\/Refund\.cs - here it is/);
    assert.match(plain.stdout, /That is the documented context for this path\. Now make the change\./);
    assert.doesNotMatch(plain.stdout, /convention this change follows/);
    r.write('.claude/docs/preferences/watch.json', '{}\n');
    r.write('.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md', section('handlers', 'src/Api/Orders/**', 'A handler returns a Result, never throws for a business rule, and stays under forty lines of body text.'));
    const both = r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, sid()));
    assert.match(both.stdout, /patterns#orders covers src\/Api\/Orders\/Refund\.cs - here it is/, 'the architecture section is still the one pasted');
    assert.doesNotMatch(both.stdout, /A handler returns a Result/, 'the preferences section is not pasted here');
    assert.doesNotMatch(both.stdout, /PROJECT-CODE-PREFERENCES#handlers/, 'nor named');
  } finally { r.rm(); }
  const only = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' } });
  try {
    only.write('.claude/docs/preferences/watch.json', JSON.stringify({ sourceRoots: ['src'] }));
    only.write('.claude/docs/preferences/PROJECT-CODE-PREFERENCES.md', section('handlers', 'src/Api/Orders/**', 'A handler returns a Result.'));
    assert.ok(!denied(only.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, sid()))), 'preferences docs alone: no docs hold');
  } finally { only.rm(); }
});

test('audit 2026-10-10 C23: a section naming the changed file verbatim is asked about first; a near spelling is not', () => {
  const CODES = section('codes', '', 'src/Api/Program.cs registers 148 codes, 136 validator + 12 handler.')
    + '\n' + section('near', '', 'other/src/Api/Program.cs and src/Api/Program.cs.bak and src/Api/Program.csx are not it.');
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'references/slices.md': CODES, 'watch.json': WATCH() } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    const reason = JSON.parse(r.hook(stopEv(s)).stdout).reason;
    assert.match(reason, /^2 sections document this file:/m);
    assert.ok(reason.indexOf('set slices#codes') >= 0 && reason.indexOf('set slices#codes') < reason.indexOf('set patterns#orders'), reason);
    assert.doesNotMatch(reason, /slices#near/);
  } finally { r.rm(); }
});

test('audit 2026-10-10 C23: a file a checkout brought in is not the session\'s change; its own commit is', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const older = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  try {
    r.git('checkout', '-qb', 'staging');
    r.write('src/Api/Program.cs', 'app.UseStaging();\napp.Run();\n');
    process.env.GIT_COMMITTER_DATE = older;
    try { r.git('commit', '-qam', 'staging config'); } finally { delete process.env.GIT_COMMITTER_DATE; }
    r.git('checkout', '-q', 'develop');
    const s = sid(); start(r, s);
    r.git('checkout', '-q', 'staging');
    assert.strictEqual(r.hook(stopEv(s)).stdout, '', 'staging\'s own commit is not this session\'s change');
    r.write('src/Api/Program.cs', 'app.UseStaging();\napp.UseAuth();\napp.Run();\n');
    r.git('commit', '-qam', 'mine');
    assert.match(JSON.parse(r.hook(stopEv(s)).stdout).reason, /^Docs check: you changed src\/Api\/Program\.cs\n/, 'a commit the session made is');
  } finally { r.rm(); }
});

// Audit 2026-10-11 SD09, sessions cc87fa6c / e7c8cbb6: a rebase replays a pre-snapshot commit with a new committer time,
// and a pull brings a commit made elsewhere after the snapshot - both read as 'you changed'. HEAD's reflog says how each
// commit arrived.
test('audit 2026-10-11 SD09: a rebase, a pull and a cherry-pick of others\' work are not the session\'s change; its own commit, amend and rebased commit are', () => {
  const older = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const at = (date, fn) => { process.env.GIT_AUTHOR_DATE = date; process.env.GIT_COMMITTER_DATE = date; try { fn(); } finally { delete process.env.GIT_AUTHOR_DATE; delete process.env.GIT_COMMITTER_DATE; } };
  const asked = (r, s) => { const out = r.hook(stopEv(s)).stdout; return out ? JSON.parse(out).reason : ''; };
  // the rebase replay (cc87fa6c)
  let r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Api/Other.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    r.git('checkout', '-qb', 'feature');
    r.write('src/Api/Program.cs', 'app.UseFeature();\napp.Run();\n');
    at(older, () => r.git('commit', '-qam', 'old feature work'));
    r.git('checkout', '-q', 'develop');
    r.write('src/Api/Other.cs', 'y\n');
    at(older, () => r.git('commit', '-qam', 'develop moved'));
    // the measured shape: the session starts on one branch, checks another out and rebases it onto the first
    const s = sid(); start(r, s);
    r.git('checkout', '-q', 'feature');
    r.git('rebase', '-q', 'develop');
    assert.strictEqual(asked(r, s), '', 'the measured case: a rebased pre-snapshot commit is no change of this session');
    r.write('src/Api/Program.cs', 'app.UseFeature();\napp.UseAuth();\napp.Run();\n');
    r.git('commit', '-qam', 'mine');
    assert.match(asked(r, s), /you changed src\/Api\/Program\.cs/, 'a commit the session made after it is');
  } finally { r.rm(); }
  r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid(); start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    r.git('commit', '-qam', 'mine');
    r.git('commit', '-q', '--amend', '-m', 'mine, amended');
    assert.match(asked(r, s), /you changed src\/Api\/Program\.cs/, 'an amended commit is the session\'s own');
  } finally { r.rm(); }
  // the session's own commit moved by a rebase stays its own
  r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Api/Other.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    r.git('checkout', '-qb', 'base');
    r.write('src/Api/Other.cs', 'y\n');
    at(older, () => r.git('commit', '-qam', 'base moved'));
    r.git('checkout', '-q', 'develop');
    const s = sid(); start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    r.git('commit', '-qam', 'mine');
    r.git('rebase', '-q', 'base');
    assert.match(asked(r, s), /you changed src\/Api\/Program\.cs/, 'a commit authored in the session and rebased is still its own');
  } finally { r.rm(); }
  // a pull (fast-forward) of a commit made elsewhere AFTER the snapshot (e7c8cbb6), and a cherry-pick of an old one
  r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const other = `${r.root}-teammate`;
    r.git('clone', '-q', r.root, other);
    const s = sid(); start(r, s);
    fs.writeFileSync(require('node:path').join(other, 'src', 'Api', 'Program.cs'), 'app.UseTeam();\napp.Run();\n');
    r.git('-C', other, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'teammate pushed during the session');
    try {
      r.git('pull', '-q', '--ff-only', other, 'HEAD');
      assert.strictEqual(asked(r, s), '', 'a pull brings a commit made elsewhere after the snapshot - no reflog commit entry names it');
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  } finally { r.rm(); }
  r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    r.git('checkout', '-qb', 'old');
    r.write('src/Api/Program.cs', 'app.UseOld();\napp.Run();\n');
    at(older, () => r.git('commit', '-qam', 'old fix'));
    r.git('checkout', '-q', 'develop');
    const s = sid(); start(r, s);
    r.git('cherry-pick', 'old');
    assert.strictEqual(asked(r, s), '', 'a cherry-pick of a commit authored before the session is a replay');
  } finally { r.rm(); }
});

// Audit 2026-10-11 SD09, session 5f9fec85: `rm -f` of a git-ignored `.trx` under a test project's TestResults/ was held
// as a source change, with a 3,606-char section pasted beside it.
test('audit 2026-10-11 SD09: a run artifact git ignores, or one under TestResults/, is never held; a tracked source file still is', () => {
  const p = require('node:path');
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', '.gitignore': '*.log\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    fs.mkdirSync(p.join(r.root, 'tests', 'App.IntegrationTests', 'TestResults'), { recursive: true });
    fs.writeFileSync(p.join(r.root, 'tests', 'App.IntegrationTests', 'TestResults', 'ib10.trx'), '<x/>');
    fs.writeFileSync(p.join(r.root, 'src', 'Api', 'debug.log'), 'x');
    assert.ok(!denied(r.hook(pre('Bash', { command: 'rm -f tests/App.IntegrationTests/TestResults/ib10.trx' }, s))), 'the measured TestResults artifact');
    assert.ok(!denied(r.hook(pre('Bash', { command: 'rm -f src/Api/debug.log' }, s))), 'a file git ignores');
    assert.ok(!denied(r.hook(pre('Write', { file_path: 'src/Api/debug.log', content: 'y' }, s))), 'on the file route too');
    assert.ok(denied(r.hook(pre('Bash', { command: 'rm -f src/Api/Orders/Refund.cs' }, s))), 'a tracked source file is still a change the hold reads');
    assert.ok(denied(r.hook(pre('Bash', { command: 'rm -f src/Api/debug.log src/Api/Orders/Refund.cs' }, sid()))), 'an artifact beside a source file does not open the hold');
  } finally { r.rm(); }
});

// Audit 2026-10-11 SD09, session fdce35ae: 'you changed Directory.Build.props' for the user's own version bump, made in
// the IDE during a 4h33m idle gap of a session that wrote nothing.
test('audit 2026-10-11 SD09: an unclaimed change made while the session sat idle is not asked about; one made while it worked is', () => {
  const p = require('node:path');
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const tp = `${r.root}-t.jsonl`;
  const row = (ms) => JSON.stringify({ type: 'assistant', timestamp: new Date(ms).toISOString(), message: { content: [{ type: 'text', text: 'ok' }] } });
  try {
    const s = sid(); start(r, s);
    const now = Date.now();
    fs.writeFileSync(tp, [row(now - 5 * 3600e3), row(now - 5 * 3600e3 + 60e3), row(now - 60e3)].join('\n') + '\n');
    r.write('src/Api/Program.cs', 'app.UseVersion(3);\napp.Run();\n');
    const inGap = new Date(now - 2 * 3600e3);
    fs.utimesSync(p.join(r.root, 'src', 'Api', 'Program.cs'), inGap, inGap);
    const ask = () => { const out = r.hook({ ...stopEv(s), transcript_path: tp }).stdout; return out ? JSON.parse(out).reason : ''; };
    assert.strictEqual(ask(), '', 'the measured case: written mid-gap, claimed by no tool of the session');
    const edge = new Date(now - 5 * 3600e3 + 60e3 + 10e3);
    fs.utimesSync(p.join(r.root, 'src', 'Api', 'Program.cs'), edge, edge);
    assert.match(ask(), /you changed src\/Api\/Program\.cs/, 'written within 30s of the gap\'s edge: still the session\'s');
  } finally { r.rm(); fs.rmSync(tp, { force: true }); }
  const r2 = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  try {
    const s = sid(); start(r2, s);
    r2.write('src/Api/Program.cs', 'app.UseVersion(3);\napp.Run();\n');
    const out = r2.hook({ ...stopEv(s), transcript_path: p.join(r2.root, 'missing.jsonl') }).stdout;
    assert.match(out ? JSON.parse(out).reason : '', /you changed src\/Api\/Program\.cs/, 'no transcript to read: the change stays the session\'s');
  } finally { r2.rm(); }
});

// The 2026-10-17 usage audit: a session that only read and edited through its tools was asked about another session's
// uncommitted diff that no claim of that session named. The unclaimed bucket now needs this session to have run a command
// that may write; a read-only shell step does not count, and its own tool edits are still asked about.
test('a session that ran nothing that writes is not asked about a change no actor claimed; one that ran a build is', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Web/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const ALLOW_GATE = { ALFRED_CODE_DOCS_GATE: '0' };
  try {
    const s = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s }, ALLOW_GATE);
    for (const command of ['git status --short', 'grep -rn Refund src | head -5', 'git diff HEAD -- src', 'node .claude/hooks/docs.js show patterns#orders', 'ls -la src/Api'])
      r.hook(pre('Bash', { command }, s), ALLOW_GATE);
    r.write('src/Api/Program.cs', 'app.UseOtherSession();\napp.Run();\n');
    assert.strictEqual(r.hook(stopEv(s), ALLOW_GATE).stdout, '', 'another writer\'s diff, read-only session: not asked');
    const s2 = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s2 }, ALLOW_GATE);
    r.hook(pre('Edit', { file_path: 'src/Api/Program.cs' }, s2), ALLOW_GATE);
    r.write('src/Api/Program.cs', 'app.UseMine();\napp.Run();\n');
    assert.match(JSON.parse(r.hook(stopEv(s2), ALLOW_GATE).stdout).reason, /you changed src\/Api\/Program\.cs/, 'its own tool edit is still asked about');
    const s3 = sid();
    r.hook({ hook_event_name: 'SessionStart', session_id: s3 }, ALLOW_GATE);
    r.hook(pre('Bash', { command: 'dotnet ef migrations add Orders' }, s3), ALLOW_GATE);
    r.write('src/Web/Program.cs', 'app.UseGenerated();\napp.Run();\n');
    assert.match(JSON.parse(r.hook(stopEv(s3), ALLOW_GATE).stdout).reason, /you changed src\/Web\/Program\.cs/, 'a generator\'s output is still the session\'s');
  } finally { r.rm(); }
});

// 2026-10-16, an aspnet project on 2.5.0: a read-only session's Stop said 'you changed' four migration files a second
// session on the same checkout had written while it ran.
test('2026-10-16: a change another session on this checkout recorded as its own write is not asked about', () => {
  const os = require('node:os');
  const p = require('node:path');
  const r = watched();
  const edit = (s, file) => r.hook({ hook_event_name: 'PreToolUse', session_id: s, tool_name: 'Edit', tool_input: { file_path: file } }, { ...GIT, ...ALLOW });
  const ask = (s) => { const out = r.hook(stopEv(s), GIT).stdout; return out ? JSON.parse(out).reason : ''; };
  const claim = (s, v) => fs.writeFileSync(p.join(os.tmpdir(), `docs-session-${s}--main.session.json`), JSON.stringify(v));
  let body = 0;
  const change = () => r.write('src/Api/Program.cs', `app.UseStep(${++body});\napp.Run();\n`);
  try {
    const mine = sid(); const theirs = sid();
    start(r, mine); start(r, theirs);
    edit(theirs, 'src/Api/Program.cs'); change();
    const state = JSON.parse(fs.readFileSync(p.join(os.tmpdir(), `docs-session-${theirs}--main.session.json`), 'utf8'));
    // Recorded as the hook keys it: forward slashes, and on Windows case-folded as the file system compares.
    const key = p.resolve(r.root).split(p.sep).join('/');
    assert.strictEqual(state.root, process.platform === 'win32' ? key.toLowerCase() : key, 'the writer records the checkout beside its paths');
    assert.strictEqual(ask(mine), '', 'the measured case: the read-only session is not asked about the other session\'s write');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"changed-by-other-session","files":\["src\/Api\/Program\.cs"\]/);
    assert.match(ask(theirs), /you changed src\/Api\/Program\.cs/, 'the session that wrote it is still asked');
    const own = sid(); start(r, own);
    edit(own, 'src/Api/Program.cs'); change();
    assert.match(ask(own), /you changed src\/Api\/Program\.cs/, 'a file both sessions wrote is still this session\'s own');
    const past = new Date(Date.now() - 3600e3);
    fs.utimesSync(p.join(os.tmpdir(), `docs-session-${theirs}--main.session.json`), past, past);
    fs.utimesSync(p.join(os.tmpdir(), `docs-session-${own}--main.session.json`), past, past);
    const late = sid(); start(r, late); change();
    assert.match(ask(late), /you changed src\/Api\/Program\.cs/, 'a claim last written before this session\'s snapshot claims nothing');
    const foreign = sid(); const other = sid(); start(r, foreign); change();
    claim(other, { wrote: ['src/Api/Program.cs'], root: '/another/checkout' });
    assert.match(ask(foreign), /you changed src\/Api\/Program\.cs/, 'another project\'s session claims nothing here');
    const legacy = sid(); const old = sid(); start(r, legacy); change();
    claim(old, { wrote: ['src/Api/Program.cs'] });
    assert.match(ask(legacy), /you changed src\/Api\/Program\.cs/, 'a state file with no root (written before the record) claims nothing');
    const torn = sid(); const bad = sid(); start(r, torn); change();
    fs.writeFileSync(p.join(os.tmpdir(), `docs-session-${bad}--main.session.json`), '{"wrote": [');
    assert.match(ask(torn), /you changed src\/Api\/Program\.cs/, 'an unreadable state file claims nothing');
  } finally { r.rm(); }
});

// Audit 2026-10-20 C25 (6dba16e2, b5f384d2, 1b432dd2): the first source edit of every /clear resume was held, though the
// resume read the plan whose `Oriented:` line names the sections the design read. Those sections count as read; a plan
// naming none, a plan-shaped file outside plans/, or no plan read at all still leaves the edit held.
test('audit 2026-10-20 C25: a resume that reads its plan\'s Oriented sections is not held; a plan naming none still is', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n', 'notes/plan.md': 'Oriented: patterns#orders\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const plan = (name, oriented) => r.write(`.claude/docs/plans/${name}.md`, `# Plan\n\nOriented: ${oriented}\nAsked: "fix refunds"\n\n## Tasks\n`);
  const edit = (s) => r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s));
  try {
    plan('refunds', 'patterns#orders, CODE-STYLE.md lines 30-99 (C#); code read - src/Api/Orders/Refund.cs');
    const s = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/plans/refunds.md` }, s));
    assert.ok(!denied(edit(s)), 'the plan\'s Oriented section counts as read');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"consult","refs":\["patterns#orders"\]/);
    const sh = sid();
    r.hook(pre('Bash', { command: 'cat .claude/docs/plans/refunds.md' }, sh));
    assert.ok(!denied(edit(sh)), 'a shell read of the plan counts the same');
    plan('blind', 'none - a one-line fix');
    const none = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/plans/blind.md` }, none));
    assert.ok(denied(edit(none)), 'a plan naming no section earns nothing');
    plan('typo', 'patterns#nope, nosuch#orders');
    const typo = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/plans/typo.md` }, typo));
    assert.ok(denied(edit(typo)), 'a section the engine cannot resolve earns nothing');
    const outside = sid();
    r.hook(pre('Read', { file_path: `${r.root}/notes/plan.md` }, outside));
    assert.ok(denied(edit(outside)), 'an Oriented line outside the plans folder earns nothing');
    assert.ok(denied(edit(sid())), 'a session that read nothing is still held');
  } finally { r.rm(); }
});

// 2.8.0: plans live under the docs root's work/plans/ - a plan there is a record once stamped Completed:, and its
// Oriented sections count as read, exactly as one under the legacy plans/ an update has not moved yet.
test('2.8.0: a plan under work/plans/ is a plan - its Completed: stamp holds and its Oriented sections count as read', () => {
  const PLAN = '# Plan: csv export\nGated: 2026-10-09\nOriented: patterns#orders\nCompleted: 2026-10-09\n\n## Tasks\n- [x] Task 1 - export\n';
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/work/plans/csv-export.md', PLAN);
    const s = sid();
    const add = r.hook(pre('Edit', { file_path: `${r.root}/.claude/docs/work/plans/csv-export.md`, old_string: '- [x] Task 1 - export\n', new_string: '- [x] Task 1 - export\n- [ ] Task 2\n' }, s));
    assert.ok(denied(add), 'new scope appended to a stamped plan under work/plans/');
    assert.ok(denied(r.hook(pre('Bash', { command: 'echo "- [ ] Task 2" >> .claude/docs/work/plans/csv-export.md' }, s))), 'a shell append');
    const read = sid();
    r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/work/plans/csv-export.md` }, read));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, read))), 'its Oriented section counts as read');
  } finally { r.rm(); }
});

// Audit 2026-10-20 C25 (4f2bfdee): a `node -e` writing to a computed path under a temp run dir was read as a write under
// the first source root and held twice ('Before changing src/*'). An unnamed interpreter write is a source write only
// under a root the command names; a patch or a migration with no project still always is.
test('audit 2026-10-20 C25: an interpreter write to a computed temp path is not held; one naming a source root is', () => {
  const { writeTargets, unknownRoots } = require('../stack/hooks/docs-session.js');
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const TEMP = 'TD="${TMPDIR:-/tmp}"; TMP=$(ls -dt "$TD"/run.*/ | head -1); TMP=${TMP%/}\n'
    + 'node -e \'\nconst fs=require("fs");const [inp,out]=process.argv.slice(1);\nfs.writeFileSync(out, fs.readFileSync(inp,"utf8"));\n\' "$TMP/in.json" "$TMP/final.json"';
  const INTO_SRC = 'node -e \'const fs=require("fs");const [o]=process.argv.slice(1);fs.writeFileSync(o,"x")\' src/Api/Orders/Gen.cs';
  try {
    assert.deepStrictEqual(writeTargets(TEMP), ['<unknown interpreter write>']);
    assert.deepStrictEqual(unknownRoots(TEMP, ['src', 'tests']), []);
    assert.deepStrictEqual(unknownRoots(INTO_SRC, ['src', 'tests']), ['src']);
    assert.deepStrictEqual(unknownRoots('node -e "x" ./tests/a.json', ['src', 'tests']), ['tests']);
    assert.deepStrictEqual(unknownRoots('node -e "x" mysrc/a.json resources/b', ['src', 'tests']), [], 'a root inside another word is not named');
    assert.deepStrictEqual(unknownRoots('node -e "x"', ['.', 'src']), ['.'], 'a root that is the project is named by every command');
    assert.ok(!denied(r.hook(pre('Bash', { command: TEMP }, sid()))), 'the audited temp write is not held');
    assert.ok(denied(r.hook(pre('Bash', { command: INTO_SRC }, sid()))), 'an interpreter write naming src/ is held');
    assert.ok(denied(r.hook(pre('Bash', { command: 'git apply fix.patch' }, sid()))), 'a patch is still a source write');
  } finally { r.rm(); }
});

// Audit 2026-10-20 C25 (0685cd0b): the once-per-session Stop ask fired on a PAUSE - 'coded, but I can't build or test it
// yet' under a background watch - and was spent there. While the harness's registry shows work still running the ask waits
// for a later Stop, at most three times.
test('audit 2026-10-20 C25: the Stop ask waits while background work runs, asks at a later Stop, and waits at most three times', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() } });
  const running = [{ id: 'b1', type: 'shell', status: 'running', command: 'until sc.exe query Svc | grep -q STOPPED; do sleep 2; done' }];
  const stopWith = (s, tasks) => r.hook({ ...stopEv(s), ...(tasks ? { background_tasks: tasks } : {}) }).stdout;
  try {
    const s = sid();
    start(r, s);
    r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');
    assert.strictEqual(stopWith(s, running), '', 'a pause under running work is not asked');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"ask-deferred","why":"background work running","deferred":1/);
    assert.match(JSON.parse(stopWith(s, [])).reason, /^Docs check: you changed src\/Api\/Program\.cs/, 'the next Stop with nothing in flight asks');
    const settled = sid();
    start(r, settled);
    r.write('src/Api/Program.cs', 'app.UseOther();\napp.Run();\n');
    assert.match(JSON.parse(stopWith(settled, [{ id: 'b2', type: 'subagent', status: 'completed' }])).reason, /you changed/, 'finished work is no pause');
    const capped = sid();
    start(r, capped);
    r.write('src/Api/Program.cs', 'app.UseThird();\napp.Run();\n');
    for (let i = 0; i < 3; i++) assert.strictEqual(stopWith(capped, running), '', `deferral ${i + 1}`);
    assert.match(JSON.parse(stopWith(capped, running)).reason, /you changed/, 'the fourth Stop asks, running work or not');
  } finally { r.rm(); }
});

// Audit 2026-10-20 C25 (c5287cc1, 7c1af769): a sibling session's `git stash push` was charged to a session that never
// touched the file, and a stash this session only applied read as its own authoring. A stash's files are recorded as
// MOVED by the session that ran it: claimed against the others, never asked about itself; a file it then edits still is.
test('audit 2026-10-20 C25: a file moved by git stash is not charged to the session that only moved it, nor to a sibling', () => {
  const os = require('node:os');
  const p = require('node:path');
  const r = watched();
  const ask = (s) => { const out = r.hook(stopEv(s), GIT).stdout; return out ? JSON.parse(out).reason : ''; };
  const bash = (s, command) => r.hook(pre('Bash', { command }, s), { ...GIT, ...ALLOW });
  try {
    const { stashMoves } = require('../stack/hooks/docs-session.js');
    r.write('src/Api/Program.cs', 'app.UseSibling();\napp.Run();\n');
    assert.deepStrictEqual(stashMoves('git stash push -m wip', r.root, r.root), ['src/Api/Program.cs']);
    assert.deepStrictEqual(stashMoves('git stash push -m wip -- src/Api/Users', r.root, r.root), [], 'a pathspec narrows it');
    assert.deepStrictEqual(stashMoves('git stash list', r.root, r.root), [], 'a listing moves nothing');
    // c5287cc1: this session's snapshot holds the sibling's dirty file; the sibling then stashes it away.
    const mine = sid(); const theirs = sid();
    start(r, mine, GIT); start(r, theirs, GIT);
    bash(theirs, 'git stash push -m wip');
    r.git('stash', 'push', '-m', 'wip');
    const state = JSON.parse(fs.readFileSync(p.join(os.tmpdir(), `docs-session-${theirs}--main.session.json`), 'utf8'));
    assert.deepStrictEqual(state.moved, ['src/Api/Program.cs'], 'the stash records its files as moved');
    assert.strictEqual(ask(mine), '', 'the measured case: not charged with the sibling\'s stash');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"changed-by-other-session","files":\["src\/Api\/Program\.cs"\]/);
    assert.strictEqual(ask(theirs), '', 'the stashing session moved it, never authored it');
    // 7c1af769: a session applies a stash another session authored.
    const applier = sid();
    start(r, applier, GIT);
    bash(applier, 'git stash apply stash@{0}');
    r.git('stash', 'apply', 'stash@{0}');
    assert.strictEqual(ask(applier), '', 'an applied stash is not this session\'s authoring');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"changed-by-git-stash","files":\["src\/Api\/Program\.cs"\]/);
    const editor = sid();
    start(r, editor, GIT);
    bash(editor, 'git stash apply stash@{0}');
    r.hook(pre('Edit', { file_path: 'src/Api/Program.cs' }, editor), { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'app.UseEdited();\napp.Run();\n');
    assert.match(ask(editor), /you changed src\/Api\/Program\.cs/, 'a file it moved and then edited is its own');
  } finally { r.rm(); }
});

// ---- audit 2026-10-20 C43: an architecture write waits for the analyzer seats this session dispatched ----
// add5a91e: 'Verification is done', the first Edit, then a sixth architecture-analyzer dispatched and 42 more reference
// Edits made while it ran. A write under <docs>/architecture/ is held once per dispatch while such a seat is out.
const seatRows = (tp) => (...xs) => fs.appendFileSync(tp, xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
const dispatchRow = (id, type, desc = 'Verify patterns') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: type, description: desc, prompt: 'verify' } }] } });
const launchedRow = (id, agent) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agent} (internal ID)` }] }] } });
const noticeText = (id, agent) => `<task-notification>\n<task-id>${agent}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>`;

test('audit 2026-10-20 C43: an architecture write is held once while an analyzer seat is out, and passes once it handed back', () => {
  const p = require('node:path');
  const r = repo({ docs: { 'ARCHITECTURE.md': '# Architecture\n', 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const tp = p.join(r.root, `${s}.jsonl`);
    const rows = seatRows(tp);
    const doc = `${r.root}/.claude/docs/architecture/references/patterns.md`;
    const edit = (session = s, extra = {}) => r.hook({ ...pre('Edit', { file_path: doc, old_string: 'a', new_string: 'b' }, session), transcript_path: tp, ...extra });
    rows({ type: 'user', message: { role: 'user', content: '/capture-awareness architecture' } });
    assert.ok(!denied(edit()), 'no seat dispatched: the write passes');
    rows(dispatchRow('t1', 'alfred-code:architecture-analyzer', 'Verify remaining patterns'), launchedRow('t1', 'a111'));
    const held = edit();
    assert.ok(denied(held), 'the audited case: a seat is out');
    assert.match(held.stdout, /architecture-analyzer \('Verify remaining patterns'\)/);
    assert.match(held.stdout, /Wait for the hand-back/);
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"seat-hold"/);
    assert.match(fs.readdirSync(p.join(r.root, '.alfred/statistics/hook-blocks')).map((f) => r.read(`.alfred/statistics/hook-blocks/${f}`)).join(''), /Held: /);
    assert.ok(!denied(edit()), 'once per dispatch: the second attempt passes');
    assert.match(r.read('.alfred/statistics/docs-log.jsonl'), /"event":"seat-bypass"/);
    // an enqueued notice is not delivered yet; a new dispatch is held again
    rows(dispatchRow('t2', 'code-quality-analyzer'), launchedRow('t2', 'a222'));
    rows({ type: 'queue-operation', operation: 'enqueue', content: noticeText('t2', 'a222') });
    assert.ok(denied(edit()), 'a second seat out is held again, its queued notice not yet delivered');
    rows({ type: 'user', message: { role: 'user', content: noticeText('t1', 'a111') } });
    rows({ type: 'attachment', attachment: { type: 'queued_command', prompt: noticeText('t2', 'a222') } });
    assert.ok(!denied(edit()), 'every seat handed back: nothing is held');
    // a delivered hand-back message settles its seat too
    rows(dispatchRow('t3', 'architecture-analyzer'), launchedRow('t3', 'a333'));
    assert.ok(denied(edit()));
    rows({ type: 'user', isMeta: true, message: { role: 'user', content: 'Another Claude session sent a message:\n<agent-message from="a333">\n[Subagent hand-back] The text below is the final report.' } });
    assert.ok(!denied(edit()), 'the delivered hand-back ends the seat');
    // a seat's own call, and the gate switch, are never held
    rows(dispatchRow('t4', 'architecture-analyzer'), launchedRow('t4', 'a444'));
    assert.ok(!denied(edit(s, { agent_id: 'a444', agent_type: 'alfred-code:architecture-analyzer' })), 'a seat caller passes');
    assert.ok(!denied(r.hook({ ...pre('Edit', { file_path: doc }, s), transcript_path: tp }, { ALFRED_CODE_DOCS_GATE: '0' })), 'DOCS_GATE=0 passes');
  } finally { r.rm(); }
});

test('audit 2026-10-20 C43: no false hold - a returned seat, another seat type, a write outside architecture/, a malformed or missing transcript', () => {
  const p = require('node:path');
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    const tp = p.join(r.root, `${s}.jsonl`);
    const rows = seatRows(tp);
    const arch = `${r.root}/.claude/docs/architecture/ARCHITECTURE.md`;
    const write = (file, session = s, t = tp) => r.hook({ ...pre('Write', { file_path: file, content: '# x\n' }, session), transcript_path: t });
    // a foreground seat whose report is its tool_result has handed back
    rows(dispatchRow('f1', 'architecture-analyzer'), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'f1', content: [{ type: 'text', text: 'status: done\nDigest...' }] }] } });
    assert.ok(!denied(write(arch)), 'a foreground seat that returned');
    // a launch that failed is no seat out
    rows(dispatchRow('f2', 'architecture-analyzer'), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'f2', is_error: true, content: 'Agent type not found' }] } });
    assert.ok(!denied(write(arch)), 'a failed launch');
    // an implementer or a foreign plugin's analyzer is no capture seat
    rows(dispatchRow('f3', 'dotnet-implementer'), launchedRow('f3', 'b333'), dispatchRow('f4', 'other:architecture-analyzer'), launchedRow('f4', 'b444'));
    assert.ok(!denied(write(arch)), 'not a capture analyzer');
    // a TaskStop ends a seat
    rows(dispatchRow('f5', 'architecture-analyzer'), launchedRow('f5', 'b555'), { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'k1', name: 'TaskStop', input: { task_id: 'b555' } }] } });
    assert.ok(!denied(write(arch)), 'a stopped seat');
    // a seat out, but the write is not an architecture doc
    rows(dispatchRow('f6', 'architecture-analyzer'), launchedRow('f6', 'b666'));
    assert.ok(!denied(write(`${r.root}/.claude/docs/plans/x.md`)), 'a plan write is not held by the seat hold');
    assert.ok(!denied(write(`${r.root}/.claude/docs/architecture-notes.md`)), 'a sibling folder sharing the prefix');
    // malformed: garbage rows, a torn last row, a missing transcript, no transcript at all
    const bad = p.join(r.root, `${s}-bad.jsonl`);
    fs.writeFileSync(bad, 'not json\n{"type":"assistant","message":{"content":[{"type":"tool_use","id":"g1","name":"Agent","input":{"subagent_type":"architecture-analyzer"}}]}}\n\u0000\u0001{garbage\n{"type":"user","message":{"content":[{"type":"tool_re');
    assert.ok(denied(write(arch, sid(), bad)), 'garbage rows around a real dispatch: the real row still counts');
    assert.ok(!denied(write(arch, sid(), p.join(r.root, 'missing.jsonl'))), 'a missing transcript releases');
    assert.ok(!denied(r.hook(pre('Write', { file_path: arch, content: '# x\n' }, sid()))), 'no transcript path releases');
    fs.writeFileSync(bad, '\u0000garbage only\n[1,2]\nnull\n"str"\n');
    assert.ok(!denied(write(arch, sid(), bad)), 'a transcript of garbage holds nothing');
  } finally { r.rm(); }
});

test('audit 2026-10-20 C43: the shell route and a docs.js set of an architecture ref are held; a first capture with no domain yet is too', () => {
  const p = require('node:path');
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    const s = sid();
    const tp = p.join(r.root, `${s}.jsonl`);
    seatRows(tp)(dispatchRow('h1', 'architecture-analyzer'), launchedRow('h1', 'c111'));
    const bash = (command, session) => r.hook({ ...pre('Bash', { command }, session), transcript_path: tp, cwd: r.root });
    assert.ok(!r.exists('.claude/docs/architecture'), 'a first capture: no architecture domain yet');
    assert.ok(denied(bash('mkdir -p .claude/docs/architecture && cat > .claude/docs/architecture/ARCHITECTURE.md <<\'EOF\'\n# A\nEOF', sid())), 'a shell write under architecture/');
    assert.ok(denied(bash('node .claude/hooks/docs.js set architecture/ARCHITECTURE#layers < /tmp/x.md', sid())), 'a docs.js set of an architecture ref');
    assert.ok(!denied(bash('cat .claude/docs/architecture/ARCHITECTURE.md', sid())), 'a read is no write');
    assert.ok(!denied(bash('node .claude/hooks/docs.js set code-style/CODE-STYLE#naming < /tmp/x.md', sid())), 'another domain\'s set');
  } finally { r.rm(); }
});

// The capture-awareness merge (spec 2026-10-29 2.2): the map moved under awareness/, and the hold covers its files there
// as well as the legacy architecture/ home - never the run book's, which writes beside it.
test('the analyzer hold covers both homes', () => {
  const p = require('node:path');
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    const s = sid();
    const tp = p.join(r.root, `${s}.jsonl`);
    seatRows(tp)(dispatchRow('m1', 'architecture-analyzer'), launchedRow('m1', 'd111'));
    const write = (rel) => r.hook({ ...pre('Write', { file_path: `${r.root}/.claude/docs/${rel}`, content: '# x\n' }, sid()), transcript_path: tp });
    const bash = (command) => r.hook({ ...pre('Bash', { command }, sid()), transcript_path: tp, cwd: r.root });
    assert.ok(!r.exists('.claude/docs/awareness/ARCHITECTURE-AWARENESS.md'), 'a first capture: no map file yet');
    for (const rel of ['awareness/references/x.md', 'awareness/ARCHITECTURE-AWARENESS.md', 'architecture/ARCHITECTURE.md']) {
      const out = write(rel);
      assert.ok(denied(out), rel);
      assert.match(out.stdout, /\/capture-awareness architecture/, `${rel}: the denial names the part`);
    }
    assert.ok(!denied(write('awareness/RUN-AND-DEBUG-AWARENESS.md')), 'the run book writes while a seat is out');
    assert.ok(denied(bash('mkdir -p .claude/docs/awareness && cat > .claude/docs/awareness/ARCHITECTURE-AWARENESS.md <<\'EOF\'\n# A\nEOF')), 'a shell write to the map');
    for (const ref of ['ARCHITECTURE-AWARENESS#modules', 'awareness/ARCHITECTURE-ORIENTATION-AWARENESS#x', 'awareness/references/x#y']) {
      assert.ok(denied(bash(`node .claude/hooks/docs.js set ${ref} < /tmp/x.md`)), `a docs.js set of ${ref}`);
    }
    assert.ok(!denied(bash('node .claude/hooks/docs.js set RUN-AND-DEBUG-AWARENESS#build < /tmp/x.md')), 'the run book\'s set');
    assert.ok(!denied(bash('node .claude/hooks/docs.js set awareness/RUN-AND-DEBUG-AWARENESS#build < /tmp/x.md')), 'the run book\'s qualified set');
  } finally { r.rm(); }
});

test('the ORIENTATION push follows mapDomain', () => {
  const block = (r, rel, text) => r.write(`.claude/docs/${rel}`, text);
  const pushed = (r) => ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }));
  const fresh = repo();
  try {
    block(fresh, 'awareness/watch.json', '{}');
    block(fresh, 'awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md', 'New home block.\n');
    assert.match(pushed(fresh), /New home block/);
  } finally { fresh.rm(); }
  const old = repo({ docs: { 'ORIENTATION.md': 'Old home block.\n' } });
  try {
    assert.match(pushed(old), /Old home block/);
    block(old, 'awareness/watch.json', '{}');
    block(old, 'awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md', 'New home block.\n');
    const both = pushed(old);
    assert.match(both, /New home block/, 'both homes: the new one is pushed');
    assert.doesNotMatch(both, /Old home block/);
    block(old, 'awareness/ARCHITECTURE-ORIENTATION-AWARENESS.md', 'n'.repeat(5000));
    assert.match(pushed(old), /ARCHITECTURE-ORIENTATION-AWARENESS\.md continues past its 4KB cap/, 'the cap line names the file it cut');
  } finally { old.rm(); }
});

// Audit 2026-10-20 (hooks minor list): the conflict, deleted-branch and on-mainline lists at SessionStart had no cap; each
// is cut at six names with a count and the status command. Run against a stub engine holding nine of each.
test('the SessionStart lists are cut at six names with a count', () => {
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-cap-'));
  const hooks = path.join(__dirname, '..', 'stack', 'hooks');
  for (const f of ['docs-session.js', 'hook-prelude.js']) fs.copyFileSync(path.join(hooks, f), path.join(dir, f));
  const nine = (p) => Array.from({ length: 9 }, (_, i) => `${p}${i + 1}`);
  fs.writeFileSync(path.join(dir, 'docs.js'), `const nine = ${nine.toString()};
module.exports = { DOCS_ROOT: require('path').join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'docs'), BLOCK_FILE: '/nonexistent-orientation', domains: () => ['architecture'], snapshot: () => ({}), refreshBaseMeta() {}, autoPromote: () => [], docFiles: () => [],
  status: () => ({ mainline: true, conflicts: nine('c#'), deletedUnmerged: nine('del-'), liveOnMainline: nine('live-'), overrides: [], stranded: [] }),
  orientationState: () => null, integrity: () => [], loadWatch: () => ({ watch: [], newModule: [], sourceRoots: ['src'] }) };`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-cap-root-'));
  try {
    const r = spawnSync(process.execPath, [path.join(dir, 'docs-session.js')], { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid(), cwd: root }),
      encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    const text = ctx(r);
    for (const [label, p] of [['Conflicts: ', 'c#'], ['never detected as merged: ', 'del-'], ['with no proof they merged: ', 'live-']]) {
      const line = text.split('\n').find((l) => l.includes(label)) || '';
      assert.match(line, new RegExp(`${p}6 \\(\\+3 more: \``), `${label.trim()} is cut at six`);
      assert.doesNotMatch(line, new RegExp(`${p}7\\b`));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); }
});

// Ruling S3 (the user's, 2026-10-20): an ask the idle timeout closed is no answer, so while this session's timeout marker
// stands, writing an APPROVED / AUTO line into flow/APPROVAL is denied - by a file tool or a shell write that carries it.
test('S3: a stamp written while the last question timed out is denied; a delete, another file or an answered session passes', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const logs = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'docs-s3-'));
  try {
    const s = sid();
    const env = { ALFRED_CODE_HOOK_LOG_DIR: logs };
    const stamp = `${r.root}/.claude/docs/flow/APPROVAL`;
    const write = (content, session = s) => r.hook(pre('Write', { file_path: stamp, content }, session), env);
    assert.ok(!denied(write('APPROVED 1 - "build it"\n')), 'no timeout: the stamp is written');
    const marker = require('../stack/hooks/hook-prelude.js').askTimeoutMarker(s, env);
    fs.writeFileSync(marker, String(Date.now()));
    const held = write('APPROVED 1 - "build it"\n');
    assert.ok(denied(held), 'after a timeout an APPROVED stamp is denied');
    assert.match(JSON.parse(held.stdout).hookSpecificOutput.permissionDecisionReason, /the question timed out - re-ask/);
    assert.ok(denied(write('AUTO - "go"\n')), 'an AUTO line too');
    assert.ok(denied(r.hook(pre('Edit', { file_path: stamp, old_string: 'x', new_string: 'APPROVED 2 - "ok"' }, s), env)), 'an Edit that adds it');
    assert.ok(denied(r.hook(pre('Bash', { command: "printf 'APPROVED 1 - ok\\n' > .claude/docs/flow/APPROVAL" }, s), env)), 'a shell write that carries it');
    assert.ok(!denied(r.hook(pre('Bash', { command: 'rm -f .claude/docs/flow/APPROVAL' }, s), env)), 'deleting the stamp passes');
    assert.ok(!denied(r.hook(pre('Write', { file_path: `${r.root}/.claude/docs/flow/NOTES`, content: 'APPROVED by nobody\n' }, s), env)), 'another flow file passes');
    assert.ok(!denied(write('APPROVED 1 - "x"\n', sid())), 'another session with no timeout passes');
    assert.ok(!denied(r.hook({ ...pre('Write', { file_path: stamp, content: 'APPROVED 1\n' }, s), agent_id: 'a1', agent_type: 'x' }, env)), 'a seat\'s call is not judged here');
    // 2.8.0: the stamp's own home, <data root>/state/approvals/ - the pre-2.8.0 flow/ above stays covered for the 2.x line
    const fresh = r.hook(pre('Write', { file_path: `${r.root}/.alfred/state/approvals/APPROVAL`, content: 'APPROVED 1 - "build it"\n' }, s), env);
    assert.ok(denied(fresh), 'the stamp under state/approvals/ is denied too');
    assert.match(JSON.parse(fresh.stdout).hookSpecificOutput.permissionDecisionReason, /^Blocked: the question timed out - re-ask\. \.alfred\/state\/approvals\/APPROVAL would record/);
    assert.ok(denied(r.hook(pre('Bash', { command: "mkdir -p .alfred/state/approvals && printf 'AUTO - go\\n' > .alfred/state/approvals/APPROVAL" }, s), env)), 'and a shell write there');
    // per-plan approvals (2026-10-20): a plan's own stamp is the same approval
    const plan = r.hook(pre('Write', { file_path: `${r.root}/.alfred/state/approvals/cart/APPROVAL`, content: 'APPROVED cart - "build it"\n' }, s), env);
    assert.ok(denied(plan), "a plan's stamp under state/approvals/<plan id>/ is denied too");
    assert.match(JSON.parse(plan.stdout).hookSpecificOutput.permissionDecisionReason, /\.alfred\/state\/approvals\/cart\/APPROVAL would record/);
    assert.ok(denied(r.hook(pre('Bash', { command: "mkdir -p .alfred/state/approvals/cart && printf 'APPROVED cart - go\\n' > .alfred/state/approvals/cart/APPROVAL" }, s), env)), 'and a shell write there');
    assert.ok(!denied(r.hook(pre('Write', { file_path: `${r.root}/.alfred/state/approvals/cart/NOTES`, content: 'APPROVED cart\n' }, s), env)), 'another file in the plan folder passes');
    fs.rmSync(marker, { force: true });
    assert.ok(!denied(write('APPROVED 1 - "build it"\n')), 'once the next answer clears the marker, the stamp is written');
  } finally { r.rm(); fs.rmSync(logs, { recursive: true, force: true }); }
});

// ---- audit 2026-10-21 (preferences.md PF-8, loading.md G1 / G4 / G8) ----------------------------------------------
const PREFS_DOC = '# Personal preferences\n\nUpdated: 2026-10-21\n\n## P1 - Short\n<!-- id: p1 -->\n- Rule: be short.\n';
const prefsRepo = () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': ORIENT } });
  r.write('.claude/docs/preferences/PERSONAL-PREFERENCES.md', PREFS_DOC);
  r.write('.claude/docs/preferences/watch.json', '{}\n');
  return r;
};
const editRefund = (s, extra = {}) => ({ ...pre('Edit', { file_path: 'src/Api/Orders/Refund.cs' }, s), ...extra });

test('PF-8: reading a preferences doc earns no credit with the docs gate', () => {
  const r = prefsRepo();
  try {
    const s = sid();
    r.hook(pre('Read', { file_path: '.claude/docs/preferences/PERSONAL-PREFERENCES.md' }, s));
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show PERSONAL-PREFERENCES#p1' }, s));
    assert.ok(denied(r.hook(editRefund(s))), 'the preferences are preferences-session\'s to hand over');
    const t = sid();
    r.hook(pre('Read', { file_path: '.claude/docs/architecture/references/patterns.md' }, t));
    assert.ok(!denied(r.hook(editRefund(t))), 'an architecture read still counts');
  } finally { r.rm(); }
});

test('G1: a seat\'s edit in .claude/worktrees/<n> is judged as the project path it mirrors', () => {
  const r = prefsRepo();
  try {
    const out = r.hook(pre('Edit', { file_path: `${r.root}/.claude/worktrees/agent-1/src/Api/Orders/Refund.cs` }, sid()));
    assert.ok(denied(out), out.stdout);
    assert.match(out.stdout, /Refunds are ledgered before the payment call/);
  } finally { r.rm(); }
});

test('G4: the gate is per actor, and a compaction re-arms the actor it summarized', () => {
  const r = prefsRepo();
  try {
    const s = sid();
    r.hook({ ...pre('Read', { file_path: '.claude/docs/architecture/references/patterns.md' }, s), agent_id: 'a1', agent_type: 'dotnet-implementer' });
    assert.ok(denied(r.hook(editRefund(s))), 'a seat\'s read never reached the main context');
    const t = sid();
    r.hook(pre('Read', { file_path: '.claude/docs/architecture/references/patterns.md' }, t));
    assert.ok(denied(r.hook(editRefund(t, { agent_id: 'a2', agent_type: 'dotnet-implementer' }))), 'nor main\'s the seat\'s');
    assert.ok(!denied(r.hook(editRefund(t))), 'main read it');
    r.hook({ hook_event_name: 'SessionStart', session_id: t, source: 'compact' });
    assert.ok(denied(r.hook(editRefund(t))), 'the summary dropped the section: held again');
  } finally { r.rm(); }
});

test('G8: a seat\'s start block names conflict markers too', () => {
  const r = repo({ tracked: true, docs: { 'references/patterns.md': `${PATTERNS}\n<<<<<<< HEAD\nA.\n=======\nB.\n>>>>>>> feat\n`, 'ORIENTATION.md': ORIENT } });
  try {
    assert.match(ctx(r.hook({ hook_event_name: 'SubagentStart', session_id: sid(), agent_id: 'a9', agent_type: 'dotnet-implementer' })), /The docs need a repair before they are trusted: merge conflict markers/);
  } finally { r.rm(); }
});

// ---- docs-watch-every-domain (2026-10-27): a RECOMPUTED quality/ is asked at the close only, after the durable docs ----
const QPATH = '.claude/docs/quality';
const weak = (id, globs) => ({ kind: `weakness: ${id}`, globs, sections: [`ARCHITECTURE-ASSESSMENT#${id}`] });
const assessed = (rows) => `# Architecture assessment\n\n${rows.map(([id, covers, body]) => section(id, covers, body || `Weak point ${id}.`)).join('\n')}`;
function qrepo({ files = {}, archDocs = { 'references/patterns.md': PATTERNS, 'watch.json': WATCH() }, quality = [], rows = [] } = {}) {
  const r = repo({ tracked: true, files: { 'src/Api/Program.cs': 'app.Run();\n', 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Legacy/Old.cs': 'class Old {}\n', ...files }, docs: archDocs });
  r.write(`${QPATH}/watch.json`, JSON.stringify({ recomputed: true, notOwned: ['CODE-ASSESSMENT.md', 'references/**'], watch: quality }));
  r.write(`${QPATH}/ARCHITECTURE-ASSESSMENT.md`, assessed(rows));
  r.git('add', '-A');
  r.git('commit', '-qm', 'quality');
  return r;
}
const askedIds = (reason) => [...String(reason).matchAll(/ set (\S+) --expect/g)].map((m) => m[1]);
const stopReason = (r, s, env) => { const out = r.hook(stopEv(s), env); return out.stdout ? JSON.parse(out.stdout).reason : ''; };
const PROGRAM = (r) => r.write('src/Api/Program.cs', 'app.UseAuth();\napp.Run();\n');

test('recomputed: a weakness change is asked at the close (AC1)', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Legacy/**'])], rows: [['w1', 'src/Legacy/**']] });
  try {
    const s = sid(); start(r, s);
    r.write('src/Legacy/Old.cs', 'class Old { int x; }\n');
    const reason = stopReason(r, s);
    assert.deepStrictEqual(askedIds(reason), ['ARCHITECTURE-ASSESSMENT#w1']);
    assert.match(reason, /^Docs check: you changed src\/Legacy\/Old\.cs\n/);
  } finally { r.rm(); }
});

test('recomputed: the save line per domain under local versioning on a feature branch (AC4)', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Legacy/**', 'src/Api/Program.cs'])], rows: [['w1', 'src/Legacy/**']] });
  const LOCAL = { ALFRED_CODE_DOCS_VERSIONING: 'local' };
  try {
    r.git('switch', '-qc', 'feat/x');
    const a = sid(); start(r, a, LOCAL);
    r.write('src/Legacy/Old.cs', 'class Old { int x; }\n');
    const only = stopReason(r, a, LOCAL);
    assert.match(only, /\n {9}and it lands in the shared docs at once\. Nothing to commit\./);
    assert.doesNotMatch(only, /stored for branch/);
    const b = sid(); start(r, b, LOCAL);
    PROGRAM(r);
    const mixed = stopReason(r, b, LOCAL);
    assert.deepStrictEqual(askedIds(mixed), ['patterns#orders', 'ARCHITECTURE-ASSESSMENT#w1']);
    assert.match(mixed, /and it is stored for branch feat\/x only\. It moves into the\n {9}shared docs by itself once this branch is merged\. Nothing to commit\.\n {9}ARCHITECTURE-ASSESSMENT#w1 is rewritten from the code, so it lands in the shared docs at once\./);
  } finally { r.rm(); }
});

test('a seam change asks the related-projects section, a manifest change the run book (AC6)', () => {
  const r = qrepo({ files: { 'package.json': '{}\n', 'src/Api/Contracts/Order.cs': 'class Order {}\n' } });
  try {
    r.write('.claude/docs/awareness/watch.json', JSON.stringify({ notOwned: ['references/**'], watch: [
      { kind: 'run book: build and test commands', globs: ['package.json'], sections: ['PROJECT-AWARENESS#build'] },
      { kind: 'seam with x', globs: ['src/Api/Contracts/**'], sections: ['RELATED-PROJECTS-AWARENESS#x'] },
    ] }));
    r.write('.claude/docs/awareness/PROJECT-AWARENESS.md', `# Run book\n\n${section('build', 'package.json', 'Build with npm run build.')}`);
    r.write('.claude/docs/awareness/RELATED-PROJECTS-AWARENESS.md', `# Related projects\n\n${section('x', 'src/Api/Contracts/**', 'Project x reads the Order contract.')}`);
    r.git('add', '-A'); r.git('commit', '-qm', 'awareness');
    const a = sid(); start(r, a);
    r.write('src/Api/Contracts/Order.cs', 'class Order { int Id; }\n');
    assert.deepStrictEqual(askedIds(stopReason(r, a)), ['RELATED-PROJECTS-AWARENESS#x']);
    const b = sid(); start(r, b);
    r.write('package.json', '{ "name": "x" }\n');
    assert.deepStrictEqual(askedIds(stopReason(r, b)), ['PROJECT-AWARENESS#build']);
  } finally { r.rm(); }
});

test('recomputed: the two pools at and around the cap, durable first (AC14)', () => {
  const P = ['a', 'b', 'c'].map((x) => section(x, '', `Rule ${x}.`)).join('\n');
  const archOf = (n) => ({ 'references/p.md': P, 'references/patterns.md': PATTERNS, 'watch.json': JSON.stringify({ watch: n ? [{ kind: 'root', globs: ['src/Api/Program.cs'], sections: ['p#a', 'p#b', 'p#c'].slice(0, n) }] : [] }) });
  const ws = (n) => ['w1', 'w2', 'w3', 'w4'].slice(0, n);
  const run = (arch, q) => {
    const r = qrepo({ archDocs: archOf(arch), quality: ws(q).map((id) => weak(id, ['src/Api/Program.cs'])), rows: ws(q).map((id) => [id, '']) });
    try { const s = sid(); start(r, s); PROGRAM(r); return askedIds(stopReason(r, s)); } finally { r.rm(); }
  };
  assert.deepStrictEqual(run(3, 1), ['p#a', 'p#b', 'p#c'], '3 + 1');
  assert.deepStrictEqual(run(2, 2), ['p#a', 'p#b', 'ARCHITECTURE-ASSESSMENT#w1'], '2 + 2');
  assert.deepStrictEqual(run(1, 1), ['p#a', 'ARCHITECTURE-ASSESSMENT#w1'], '1 + 1');
  assert.deepStrictEqual(run(0, 4), ['ARCHITECTURE-ASSESSMENT#w1', 'ARCHITECTURE-ASSESSMENT#w2', 'ARCHITECTURE-ASSESSMENT#w3'], '0 + 4');
});

test('recomputed: three weakness sections naming the file do not crowd out a durable one naming it (AC14)', () => {
  const r = qrepo({
    archDocs: { 'references/boot.md': section('entry', 'src/Api/Program.cs', 'src/Api/Program.cs wires every module.'), 'watch.json': JSON.stringify({ watch: [{ kind: 'root', globs: ['src/Api/Program.cs'], sections: ['boot#entry'] }] }) },
    quality: ['w1', 'w2', 'w3'].map((id) => weak(id, ['src/Api/Program.cs'])),
    rows: ['w1', 'w2', 'w3'].map((id) => [id, 'src/Api/Program.cs', `src/Api/Program.cs is big (${id}).`]),
  });
  try {
    const s = sid(); start(r, s); PROGRAM(r);
    assert.deepStrictEqual(askedIds(stopReason(r, s)), ['boot#entry', 'ARCHITECTURE-ASSESSMENT#w1', 'ARCHITECTURE-ASSESSMENT#w2']);
  } finally { r.rm(); }
});

test('recomputed: reading the assessment earns no gate credit; a weakness-only target is held with nothing pasted (AC16)', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Legacy/**'])], rows: [['w1', 'src/Legacy/**']], archDocs: { 'references/patterns.md': PATTERNS, 'ARCHITECTURE.md': '# Map\n\nThe map.\n' } });
  const edit = (s, f = 'src/Api/Orders/Refund.cs') => r.hook(pre('Edit', { file_path: f }, s));
  try {
    const a = sid(); r.hook(pre('Read', { file_path: `${r.root}/${QPATH}/ARCHITECTURE-ASSESSMENT.md` }, a));
    assert.ok(denied(edit(a)), 'a Read of the assessment is no docs read');
    const b = sid(); r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show ARCHITECTURE-ASSESSMENT#w1' }, b));
    assert.ok(denied(edit(b)), 'nor a show of one of its sections');
    r.write('.claude/docs/plans/fix.md', '# Plan\n\nOriented: ARCHITECTURE-ASSESSMENT#w1\n\n## Tasks\n');
    const c = sid(); r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/plans/fix.md` }, c));
    assert.ok(denied(edit(c)), 'nor a plan whose Oriented line names one');
    const d = sid(); r.hook(pre('Read', { file_path: `${r.root}/.claude/docs/architecture/ARCHITECTURE.md` }, d));
    assert.ok(!denied(edit(d)), 'a durable doc read releases the gate');
    const e = sid();
    const held = edit(e, 'src/Legacy/Old.cs');
    assert.ok(denied(held));
    assert.doesNotMatch(held.stdout, /ARCHITECTURE-ASSESSMENT|here it is/);
    assert.ok(denied(edit(e, 'src/Legacy/Old.cs')), 'nothing went onto gate.consults: the next edit is held again');
  } finally { r.rm(); }
});

test('recomputed: a docs root holding only a recomputed domain runs no docs hook (AC16)', () => {
  const r = repo({ tracked: true, files: { 'src/Legacy/Old.cs': 'class Old {}\n' } });
  try {
    r.write(`${QPATH}/watch.json`, JSON.stringify({ recomputed: true, watch: [weak('w1', ['src/Legacy/**'])] }));
    r.write(`${QPATH}/ARCHITECTURE-ASSESSMENT.md`, assessed([['w1', 'src/Legacy/**']]));
    r.git('add', '-A'); r.git('commit', '-qm', 'quality');
    const s = sid();
    for (const out of [r.hook({ hook_event_name: 'SessionStart', session_id: s }), r.hook(pre('Edit', { file_path: 'src/Legacy/Old.cs' }, s))]) assert.deepStrictEqual([out.status, out.stdout], [0, '']);
    r.write('src/Legacy/Old.cs', 'class Old { int x; }\n');
    const out = r.hook(stopEv(s));
    assert.deepStrictEqual([out.status, out.stdout], [0, '']);
  } finally { r.rm(); }
});

test('recomputed: a seat is never asked a weakness section, even one naming its file; the close asks it, not the seat\'s durable one (AC17)', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Api/Program.cs'])], rows: [['w1', 'src/Api/Program.cs', 'src/Api/Program.cs is big.']] });
  try {
    const s = sid(); start(r, s, GIT);
    r.hook(subStart(s, 'agent-q1'), GIT);
    touchBy(r, s, 'q1');
    const back = r.hook(handBack(s, 'q1', 'status: DONE'), GIT);
    assert.ok(denied(back), back.stdout);
    assert.deepStrictEqual(askedIds(JSON.parse(back.stdout).hookSpecificOutput.permissionDecisionReason), ['patterns#orders']);
    assert.deepStrictEqual(askedIds(stopReason(r, s, GIT)), ['ARCHITECTURE-ASSESSMENT#w1']);
  } finally { r.rm(); }
});

test('recomputed: the close skips a hit the capture saw this session; a later change, no capture, and a deletion keep it (AC17)', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Legacy/**'])], rows: [['w1', 'src/Legacy/**']] });
  const at = (rel, sec) => { const t = new Date(Date.now() + sec * 1000); fs.utimesSync(`${r.root}/${rel}`, t, t); };
  const W = `${QPATH}/watch.json`;
  try {
    const saw = sid(); start(r, saw);
    r.write('src/Legacy/Old.cs', 'class Old { int a; }\n'); at('src/Legacy/Old.cs', 0); at(W, 5);
    assert.strictEqual(r.hook(stopEv(saw)).stdout, '', 'the capture ran after the change');
    const later = sid(); start(r, later);
    r.write('src/Legacy/Old.cs', 'class Old { int b; }\n'); at(W, 5); at('src/Legacy/Old.cs', 10);
    assert.deepStrictEqual(askedIds(stopReason(r, later)), ['ARCHITECTURE-ASSESSMENT#w1'], 'changed after the capture');
    const none = sid(); start(r, none);
    r.write('src/Legacy/Old.cs', 'class Old { int c; }\n'); at(W, -3600);
    assert.deepStrictEqual(askedIds(stopReason(r, none)), ['ARCHITECTURE-ASSESSMENT#w1'], 'no capture this session');
    const gone = sid(); start(r, gone);
    r.git('rm', '-qf', 'src/Legacy/Old.cs'); at(W, 5);
    assert.deepStrictEqual(askedIds(stopReason(r, gone)), ['ARCHITECTURE-ASSESSMENT#w1'], 'a deleted file keeps the hit');
  } finally { r.rm(); }
});

test('recomputed: the start block names no recomputed domain', () => {
  const r = qrepo({ quality: [weak('w1', ['src/Legacy/**'])], rows: [['w1', 'src/Legacy/**']] });
  try {
    assert.match(ctx(r.hook({ hook_event_name: 'SessionStart', session_id: sid() })), /The docs live under `\.claude\/docs\/` \(architecture\)\./);
  } finally { r.rm(); }
});

// D4: a preference entry whose Scope: the session's change emptied is named at the close, never rewritten.
const ARCH_PREFS_DOC = '.claude/docs/preferences/ARCHITECTURE-PREFERENCES.md';
const PREFS_A2 = '# Architecture preferences\n\n## A2 - Legacy stays frozen\n<!-- id: A2 -->\n- Rule: no new code in the legacy folder.\n- Scope: src/Gone/**\n';
const goneRepo = () => {
  const r = qrepo({ files: { 'src/Gone/x.cs': 'class X {}\n', 'src/Gone/y.cs': 'class Y {}\n' } });
  r.write(ARCH_PREFS_DOC, PREFS_A2);
  r.git('add', '-A'); r.git('commit', '-qm', 'prefs');
  return r;
};
test('a dead Scope is named at the close, and blocks once with no watch hit (AC21)', () => {
  const r = goneRepo();
  try {
    const keep = sid(); start(r, keep);
    r.git('rm', '-q', 'src/Gone/x.cs');
    assert.strictEqual(r.hook(stopEv(keep)).stdout, '', 'the glob still reaches y.cs');
    const edit = sid(); start(r, edit);
    r.write('src/Gone/y.cs', 'class Y { int z; }\n');
    assert.strictEqual(r.hook(stopEv(edit)).stdout, '', 'nothing vanished');
    const dead = sid(); start(r, dead);
    r.git('rm', '-qf', 'src/Gone/y.cs');
    const reason = stopReason(r, dead);
    assert.match(reason, /ARCHITECTURE-PREFERENCES\.md A2 - its Scope: `src\/Gone\/\*\*` reaches no file since this session's change - ask the user to run \/capture-preferences to re-scope A2/);
    assert.deepStrictEqual(askedIds(reason), [], 'no watch hit: only the Scope line');
    assert.strictEqual(r.hook(stopEv(dead)).stdout, '', 'once per session');
    assert.strictEqual(r.read(ARCH_PREFS_DOC), PREFS_A2, 'the user\'s words are never rewritten');
  } finally { r.rm(); }
});

test('a dead Scope is named in every documented spelling: a folder, a bare path, a file-name glob, a rooted glob (final review I2)', () => {
  for (const scope of ['src/Gone/', 'src/Gone', '*.gone.cs', '/src/Gone/**']) {
    const r = qrepo({ files: { 'src/Gone/x.gone.cs': 'class X {}\n' } });
    try {
      r.write(ARCH_PREFS_DOC, PREFS_A2.replace('src/Gone/**', scope));
      r.git('add', '-A'); r.git('commit', '-qm', 'prefs');
      const s = sid(); start(r, s);
      r.git('rm', '-qf', 'src/Gone/x.gone.cs');
      const scopeRe = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(stopReason(r, s), new RegExp(`A2 - its Scope: \`${scopeRe}\` reaches no file`), scope);
    } finally { r.rm(); }
  }
});

test('a dead Scope with no preferences engine beside the hooks adds nothing (AC21)', () => {
  const r = goneRepo();
  const hooks = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'hooks-copy-'));
  const { HOOKS } = require('./docs-fixture');
  fs.cpSync(HOOKS, `${hooks}/hooks`, { recursive: true });
  const run = (payload) => require('node:child_process').spawnSync(process.execPath, [`${hooks}/hooks/docs-session.js`], { cwd: r.root, input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_DOCS_VERSIONING: '' } });
  try {
    const s = sid();
    run({ hook_event_name: 'SessionStart', session_id: s });
    run(pre('Bash', { command: 'npm run generate' }, s));
    r.git('rm', '-qf', 'src/Gone/x.cs', 'src/Gone/y.cs');
    assert.deepStrictEqual([run(stopEv(s)).stdout], [''], 'fail-open: no engine, no line');
  } finally { r.rm(); fs.rmSync(hooks, { recursive: true, force: true }); }
});

// R5 (release 3): a linked child's start names each ancestor's docs root and its areas, read-only.
function wsDocs({ rootAreas = ['architecture', 'preferences'], childArch = true, childFile = 'parent ..\n' } = {}) {
  // .native: Windows CI's temp is an 8.3 name (RUNNER~1) and the readers report the long one.
  const top = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-ws-')));
  const put = (rel, text) => { const f = path.join(top, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('ws/.claude/alfred-code.stamp', 'sha: x\n');
  put('ws/.alfred/workspace', 'child api\n');
  for (const a of rootAreas) put(`ws/.alfred/docs/${a}/${a === 'architecture' ? 'ARCHITECTURE.md' : 'watch.json'}`, a === 'architecture' ? '# A\n' : '{}\n');
  put('ws/.alfred/docs/references/watch.json', '{}\n');
  put('ws/api/.claude/alfred-code.stamp', 'sha: x\n');
  put('ws/api/.alfred/workspace', childFile);
  if (childArch) put('ws/api/.alfred/docs/architecture/ARCHITECTURE.md', '# Api\n');
  const api = path.join(top, 'ws', 'api');
  spawnSync('git', ['init', '-q'], { cwd: api });
  const env = { ...process.env, CLAUDE_PROJECT_DIR: api, CLAUDE_CONFIG_DIR: path.join(top, 'cfg') };
  for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_WORKSPACE', 'ALFRED_CODE_DATA_PATH']) delete env[k];
  const hook = (payload, extra = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'docs-session.js')], { cwd: api, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid(), cwd: api, ...payload }), encoding: 'utf8', env: { ...env, ...extra } });
  return { docs: path.join(top, 'ws', '.alfred', 'docs'), hook, rm: () => fs.rmSync(top, { recursive: true, force: true }) };
}

test('a child\'s start names the root\'s docs root and areas, read-only; a child with no domain of its own still gets the line', () => {
  const w = wsDocs();
  const bare = wsDocs({ childArch: false });
  try {
    const out = w.hook({});
    assert.ok(ctx(out).includes(`Workspace root docs (read-only): ${w.docs} - architecture, preferences`), out.stdout + out.stderr);
    const alone = ctx(bare.hook({}));
    assert.strictEqual(alone.split('\n')[0], `Workspace root docs (read-only): ${bare.docs} - architecture, preferences`);
    assert.doesNotMatch(alone, /How this project is documented/);
  } finally { w.rm(); bare.rm(); }
});

test('no workspace docs line: a root with no domain, a seat\'s start, the kill switch, ignore docs root', () => {
  const none = wsDocs({ rootAreas: [] });
  const w = wsDocs();
  const ig = wsDocs({ childFile: 'parent ..\nignore docs root\n' });
  try {
    assert.doesNotMatch(ctx(none.hook({})) || '', /Workspace root docs/);
    assert.doesNotMatch(ctx(w.hook({ agent_id: 'seat-1' })) || '', /Workspace root docs/);
    assert.doesNotMatch(ctx(w.hook({}, { ALFRED_CODE_WORKSPACE: '0' })) || '', /Workspace root docs/);
    assert.doesNotMatch(ctx(ig.hook({})) || '', /Workspace root docs/);
  } finally { none.rm(); w.rm(); ig.rm(); }
});

// F25 (the 2026-10-28 workspace run): in a three-level chain every ancestor's line read 'root', so a leaf could not tell
// its parent's docs from the workspace root's. Each line names the member's role.
test('a three-level chain names parent then root', () => {
  const top = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-ws3-')));
  const put = (rel, text) => { const f = path.join(top, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  try {
    put('ws/.claude/alfred-code.stamp', 'sha: x\n');
    put('ws/.alfred/workspace', 'child api\n');
    put('ws/.alfred/docs/architecture/ARCHITECTURE.md', '# A\n');
    put('ws/.alfred/docs/preferences/watch.json', '{}\n');
    put('ws/api/.claude/alfred-code.stamp', 'sha: x\n');
    put('ws/api/.alfred/workspace', 'parent ..\nchild tool\n');
    put('ws/api/.alfred/docs/architecture/ARCHITECTURE.md', '# Api\n');
    put('ws/api/tool/.claude/alfred-code.stamp', 'sha: x\n');
    put('ws/api/tool/.alfred/workspace', 'parent ..\n');
    const leaf = path.join(top, 'ws', 'api', 'tool');
    spawnSync('git', ['init', '-q'], { cwd: leaf });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: leaf, CLAUDE_CONFIG_DIR: path.join(top, 'cfg') };
    for (const k of ['ALFRED_CODE_DOCS_PATH', 'ALFRED_CODE_WORKSPACE', 'ALFRED_CODE_DATA_PATH']) delete env[k];
    const out = spawnSync(process.execPath, [path.join(HOOKS, 'docs-session.js')], { cwd: leaf, input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid(), cwd: leaf }), encoding: 'utf8', env });
    const text = ctx(out);
    const parentLine = `Workspace parent docs (read-only): ${path.join(top, 'ws', 'api', '.alfred', 'docs')} - architecture`;
    const rootLine = `Workspace root docs (read-only): ${path.join(top, 'ws', '.alfred', 'docs')} - architecture, preferences`;
    assert.ok(text.includes(parentLine), out.stdout + out.stderr);
    assert.ok(text.includes(rootLine), out.stdout + out.stderr);
    assert.ok(text.indexOf(parentLine) < text.indexOf(rootLine), 'parent first, then root');
    const layout = require(path.join(HOOKS, 'layout.js'));
    assert.deepStrictEqual(layout.ancestorPrefsDirs(leaf, { env }).map((e) => e.role), ['parent', 'root']);
  } finally { fs.rmSync(top, { recursive: true, force: true }); }
});
