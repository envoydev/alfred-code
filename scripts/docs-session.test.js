// scripts/docs-session.test.js - the docs session hook, driven through stdin payloads in throwaway git repos.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint (sdk-cli under claude -p) never decides a case - hook-prelude.js unattended()
const assert = require('node:assert');
const fs = require('node:fs');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name
const { repo, section } = require('./docs-fixture');

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
    assert.strictEqual(r.hook({ hook_event_name: 'SessionStart', session_id: sid() }, { ALFRED_CODE_DOCS_BLOCK: '0' }).stdout, '');
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
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"promote"/);
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
    const all = r.read('.claude/docs/docs-log.jsonl').trim().split('\n').map((l) => JSON.parse(l));
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
      env: { ...process.env, CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '', ALFRED_CODE_DOCS_VERSIONING: 'git' },
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
    assert.match(r.read('.claude/docs/hook-blocks/' + s + '.jsonl'), /"hook":"docs-session\.js"/);
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
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"bypass"/);
  } finally { r.rm(); }
});

test('shell reads are never held; shell writes are', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const s = sid();
    assert.ok(!denied(r.hook(pre('Bash', { command: 'grep -n Refund src/Api/Orders/Refund.cs 2>/dev/null' }, s))));
    assert.ok(!denied(r.hook(pre('Bash', { command: 'dotnet test tests/Api > run.log 2>&1' }, s))));
    assert.ok(denied(r.hook(pre('Bash', { command: "cat > src/Api/Orders/Refund.cs <<'EOF'\nclass Refund {}\nEOF" }, s))));
  } finally { r.rm(); }
});

// Both installer twins wire this hook on `Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|Grep|Glob`.
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
    for (const server of ['plugin_navigation_navigation', 'navigation']) {
      for (const tool of ['rename_symbol', 'safe_delete_symbol']) {
        const name = `mcp__${server}__${tool}`;
        assert.ok(denied(r.hook(pre(name, { name_path: 'Refund/Apply', relative_path: 'src/Api/Orders/Refund.cs', new_name: 'Run' }, sid()))), `${name} is held`);
      }
    }
    assert.ok(!denied(r.hook(pre('mcp__plugin_navigation_navigation__find_symbol', { name_path: 'Refund', relative_path: 'src/Api/Orders/Refund.cs' }, sid()))), 'a lookup is never held');
    const s = sid();
    r.hook(pre('Bash', { command: 'node .claude/hooks/docs.js show patterns#orders' }, s));
    assert.ok(!denied(r.hook(pre('mcp__plugin_navigation_navigation__rename_symbol', { name_path: 'Refund', relative_path: 'src/Api/Orders/Refund.cs', new_name: 'Refund2' }, s))), 'a section read unlocks it');
  } finally { r.rm(); }
});

test('the manifest wires docs-session and check-turn-build on the two kept navigation edit tools, both spellings', () => {
  const rows = require('../meta/stack-manifest.json').hooks;
  const re = (file, event) => rows.filter((row) => row.file === file && (event ? row.matcher.startsWith(`@${event}:`) : !row.matcher.startsWith('@')))
    .map((row) => row.matcher.replace(/^@\w+:/, ''));
  for (const [file, event] of [['docs-session.js', null], ['check-turn-build.js', 'PostToolUse']]) {
    const matchers = re(file, event);
    for (const server of ['plugin_navigation_navigation', 'navigation'])
      for (const tool of ['rename_symbol', 'safe_delete_symbol', 'replace_symbol_body']) {
        const name = `mcp__${server}__${tool}`;
        const hit = matchers.some((m) => (/^[\w\s,|-]+$/.test(m) ? m.split(/[|,]/).map((x) => x.trim()).includes(name) : new RegExp(m).test(name)));
        assert.strictEqual(hit, tool !== 'replace_symbol_body', `${file}: ${name}`);
      }
  }
});

test('source roots come from watch.json; ALFRED_CODE_DOCS_GATE=0 turns the gate off', () => {
  const r = repo({ files: { 'app/Orders/Refund.cs': 'x\n', 'src/Other.cs': 'x\n' }, docs: { 'references/patterns.md': section('orders', 'app/Orders/**', 'App rule.'), 'watch.json': JSON.stringify({ sourceRoots: ['app'] }) } });
  try {
    assert.ok(denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'src/Other.cs' }, sid()))));
    assert.ok(!denied(r.hook(pre('Edit', { file_path: 'app/Orders/Refund.cs' }, sid()), { ALFRED_CODE_DOCS_GATE: '0' })));
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
    ['mv src/a.cs src/b.cs', ['src/b.cs']],
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
  ];
  for (const [command, want] of cases) assert.deepStrictEqual(writeTargets(command).sort(), [...want].sort(), command);
});

const WATCH = (extra = {}) => JSON.stringify({ watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }], ...extra });
const start = (r, s) => r.hook({ hook_event_name: 'SessionStart', session_id: s });
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
// by the summary; a seat's SubagentStop ask keeps its own shape (pinned by the finished-agent test below).
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
    assert.strictEqual(r.hook(stopEv(b, true)).stdout, '', 'stop_hook_active');
    assert.strictEqual(r.hook(stopEv(b), { ALFRED_CODE_DOCS_ASK: '0' }).stdout, '', 'switched off');
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
    assert.match(reason, /set p#a --expect [0-9a-f]{12}\n {11}node .*set p#b --expect [0-9a-f]{12}\n {11}node .*set p#c --expect [0-9a-f]{12}/);
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
    assert.match(body.reason, /^Docs check: you changed src\/Api\/Program\.cs\n\nOne section documents this file - 'orders', in \.claude\/docs\/architecture\/references\/patterns\.md:\n  "Refunds are ledgered before the payment call\."\n\nDoes your change still leave that true\?\n\n  Yes -> reply: docs ok\n  No  -> rewrite the section, then run\n {11}node \.claude\/hooks\/docs\.js set patterns#orders --expect [0-9a-f]{12}\n {9}and commit the doc with your code, so it travels with this branch\.$/);
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"ask-update"/);
    assert.match(r.read(`.claude/docs/hook-blocks/${s}.jsonl`), /"event":"SubagentStop"/);
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
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"ask-answer".*"outcome":"unchanged"/);
  } finally { r.rm(); }
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
    const row = JSON.parse(r.read('.claude/docs/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
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
    const one = JSON.parse(r.read('.claude/docs/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
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
    const two = JSON.parse(r.read('.claude/docs/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
    assert.strictEqual(two.outcome, 'rewritten', 'the set landed, whatever words closed the turn');
    assert.deepStrictEqual(two.rewrote, ['patterns#orders']);
    assert.strictEqual(two.saidDocsOk, false, 'and it never said the phrase');
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
    const row = JSON.parse(r.read('.claude/docs/docs-log.jsonl').trim().split('\n').filter((l) => l.includes('"ask-answer"')).pop());
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
    const log = '.claude/docs/docs-log.jsonl';
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
    assert.match(reason, /\n {9}and it is stored for branch feat\/refunds only\. It moves into the\n {9}shared docs by itself once this branch is merged\. Nothing to commit\.$/);
    assert.doesNotMatch(reason, /commit the doc with your code/);
    // On mainline the overlay is never written, so neither clause is true there.
    r.git('switch', '-q', 'develop');
    const t = sid();
    r.hook(subStart(t, 'a2'));
    wroteBy(r, t, 'a2', 'src/Api/Program.cs', 'app.UseCors();\napp.Run();\n', {});
    assert.match(JSON.parse(r.hook(subStop(t, 'a2')).stdout).reason, /\n {9}and it lands in the shared docs at once\. Nothing to commit\.$/);
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
    assert.match(reason, /and commit the docs with your code, so they travel with this branch\.$/);
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
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"event":"ask-skipped".*"why":"no write attributed to this agent"/);
    // A seat that wrote, where nothing it wrote changed: the route a separator mismatch or a crowded cap ends in.
    const t = sid();
    r.hook(subStart(t, 'stale'), GIT);
    r.hook(preBy(t, 'stale', 'src/Api/Orders/Refund.cs'), { ...GIT, ...ALLOW });
    r.write('src/Api/Program.cs', 'app.UseOther();\napp.Run();\n');
    assert.strictEqual(r.hook(subStop(t, 'stale'), GIT).stdout, '');
    assert.match(r.read('.claude/docs/docs-log.jsonl'), /"why":"nothing this agent wrote changed"/);
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
  const md = fs.readFileSync(require('node:path').join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  const entry = md.slice(md.indexOf('  - `docs-session.js` ('), md.indexOf('  - `memory-session.js` ('));
  assert.match(entry, /a rename is credited to that declaring file alone/);
  assert.match(entry, /'no actor claimed' bucket and outside the turn check's root/);
});
