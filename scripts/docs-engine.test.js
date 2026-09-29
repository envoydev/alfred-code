// scripts/docs-engine.test.js - the architecture docs engine, driven through its CLI in throwaway git repos.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_STACK_') || k === 'CLAUDE_DOCS_PATH') delete process.env[k]; // C19: a 1.x install's ambient spelling answers through envOf too - legacy-name
const { repo, section, HOOKS } = require('./docs-fixture');

const PATTERNS = section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') + '\n'
  + section('users', 'src/Api/Users/**', 'Users are soft-deleted, never removed.');

const NESTED = '## orders\n<!-- id: orders -->\nOrders rule.\n\n### paging\n<!-- id: paging -->\nTen rows.\n\n'
  + '## users\n<!-- id: users -->\nUsers are soft-deleted, never removed.\n';

test('show prints one section, several ids print each, toc lists ids', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const one = r.cli(['show', 'patterns#orders']);
    assert.strictEqual(one.status, 0);
    assert.match(one.stdout, /ledgered before the payment call/);
    assert.doesNotMatch(one.stdout, /soft-deleted/);
    assert.match(r.cli(['show', 'patterns#orders', 'patterns#users']).stdout, /ledgered[\s\S]*soft-deleted/);
    assert.match(r.cli(['toc', 'patterns']).stdout, /patterns#orders[\s\S]*patterns#users/);
    assert.match(r.cli(['show', 'references/patterns#users']).stdout, /soft-deleted/, 'a file key may carry its folder');
  } finally { r.rm(); }
});

test('where names the narrowest covering section and never offers history', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Users/User.cs': 'class User {}\n', 'src/Api/Program.cs': 'app.Run();\n' },
    docs: {
      'references/patterns.md': PATTERNS,
      'ARCHITECTURE.md': section('everything', 'src/**', 'All routes return the envelope.'),
      'history/assessment-rounds.md': section('round-1', 'src/Api/Orders/**', 'Refund review notes.'),
    },
  });
  try {
    const out = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(out.split('\n')[0], /^patterns#orders /, 'the narrow glob comes first');
    assert.doesNotMatch(out, /assessment-rounds/, 'history is never a pointer');
    assert.match(r.cli(['show', 'assessment-rounds#round-1']).stdout, /Refund review notes/, 'history stays readable');
  } finally { r.rm(); }
});

// A narrow section says what this file is; an area-wide one says what every change in that area must satisfy. Three
// narrow neighbours used to fill the answer on their own, so the area-wide section was unreachable at the gate.
test('where keeps the last slot for the area-wide section when narrow ones would fill it', () => {
  const files = { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' };
  for (let i = 0; i < 60; i++) files[`src/Api/Misc/M${i}.cs`] = 'class M {}\n';
  const r = repo({
    files,
    docs: {
      'references/patterns.md': ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n'),
      'ARCHITECTURE.md': section('everything', 'src/**', 'All routes return the envelope.'),
    },
  });
  try {
    const out = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout.trim().split('\n');
    assert.strictEqual(out.length, 3, out.join(' | '));
    assert.match(out[0], /^patterns#a /, 'the narrowest still answers first');
    assert.match(out[1], /^patterns#b /);
    assert.match(out[2], /^ARCHITECTURE#everything /, 'the area-wide section keeps the last slot');
  } finally { r.rm(); }
});

test('the docs root follows ALFRED_CODE_DOCS_PATH', () => {
  const r = repo({ docsPath: 'docs', docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /ledgered/);
    assert.match(r.cli(['files']).stdout, /docs\/architecture\/references\/patterns\.md/);
  } finally { r.rm(); }
});

// Every printed path goes through one helper. On Windows path.relative answers with '\', and the Windows run
// printed 'docs\architecture\references\patterns.md' - a path no covers glob, watch root or ref ever matches.
test('a printed doc path is project-relative and /-separated on Windows too, and a posix backslash stays a name', () => {
  const enginePath = require.resolve('../stack/hooks/docs.js');
  const { shownFrom } = require(enginePath);
  delete require.cache[enginePath]; // pure helper: no ROOT of this process is kept around for a later require
  assert.strictEqual(shownFrom('C:\\proj', 'C:\\proj\\docs\\architecture\\references\\patterns.md', path.win32), 'docs/architecture/references/patterns.md');
  assert.strictEqual(shownFrom('C:\\proj', 'C:/proj/.claude/docs/.branches/feat-x', path.win32), '.claude/docs/.branches/feat-x');
  assert.strictEqual(shownFrom('/proj', '/proj/docs/odd\\name.md', path.posix), 'docs/odd\\name.md');
});

test('an unknown file or section answers with what exists, exit 0', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['show', 'nope#x']).stdout, /no such doc file: nope\. Known: .*patterns/);
    assert.match(r.cli(['show', 'patterns#nope']).stdout, /no section nope in patterns[\s\S]*patterns#orders/);
  } finally { r.rm(); }
});

const setText = (heading, id, body) => `## ${heading}\n<!-- id: ${id} -->\n<!-- covers: src/Api/Orders/** -->\n${body}\n`;

test('overlay mode: a feature branch writes its own version and mainline keeps its text', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/refund-cap');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('commit', '-qam', 'cap');
    const out = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are capped at 10 per order.'));
    assert.strictEqual(out.status, 0, out.stdout);
    const over = '.claude/docs/.branches/feat-refund-cap/architecture/references/patterns/orders.md';
    assert.ok(r.exists(over), 'the override sits at <branch>/<domain>/<file>/<id>.md');
    assert.match(r.read('.claude/docs/.branches/feat-refund-cap/.base/architecture/references/patterns/orders.md'), /ledgered before the payment call/, 'the base holds mainline text');
    const meta = JSON.parse(r.read('.claude/docs/.branches/feat-refund-cap/BASE.json'));
    assert.strictEqual(meta.branch, 'feat/refund-cap');
    assert.strictEqual(meta.head, r.git('rev-parse', 'HEAD'));
    assert.strictEqual(meta.files['src/Api/Orders/Refund.cs'], r.git('rev-parse', 'HEAD:src/Api/Orders/Refund.cs').slice(0, 12), 'the committed change is recorded by its blob');
    assert.ok(!Object.keys(meta.files).some((f) => f.startsWith('.claude/')), 'logs and docs are never recorded');
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/, 'mainline untouched');
    assert.match(r.read(over), /<!-- captured: [0-9a-f]{7,40}/, 'set stamps the section');
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /capped at 10[\s\S]*/);
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /this branch's version of patterns#orders/);
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /ledgered before the payment call/, 'develop reads mainline');
  } finally { r.rm(); }
});

test('in place: on mainline, with committed docs, and without git', () => {
  const a = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const b = repo({ tracked: true, docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(a.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Mainline rule.')).stdout, /into .*patterns\.md/);
    assert.match(a.read('.claude/docs/architecture/references/patterns.md'), /Mainline rule\.[\s\S]*soft-deleted/);
    b.git('switch', '-qc', 'feat/x');
    assert.match(b.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Committed rule.')).stdout, /into .*patterns\.md/);
    assert.ok(!b.exists('.claude/docs/.branches'), 'committed docs never get an overlay');
    fs.rmSync(path.join(b.root, '.git'), { recursive: true, force: true });
    assert.match(b.cli(['set', 'patterns#users'], setText('users', 'users', 'No git rule.')).stdout, /into .*patterns\.md/);
  } finally { a.rm(); b.rm(); }
});

// How the docs are versioned is an install-time DECISION carried in settings.json env, not a guess the engine makes
// from git. The declaration WINS in both directions - a doc write must never be silently untracked or silently
// local - and the engine says so where the setting and the repo disagree.
test('declared git versioning writes in place although git ignores the docs', () => {
  const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/declared-git');
    const out = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are capped at 10.'), GIT);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /into .*patterns\.md/);
    assert.ok(!r.exists('.claude/docs/.branches'), 'git versioning never writes an overlay');
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
    const st = r.cli(['status'], undefined, GIT).stdout;
    assert.match(st, /^mode: git \(declared by ALFRED_CODE_DOCS_VERSIONING/m);
    assert.match(st, /^Versioning mismatch: ALFRED_CODE_DOCS_VERSIONING declares 'git', but \.claude\/docs is not tracked by git - the setting wins, so doc sections are written in place/m);
  } finally { r.rm(); }
});

test('declared local versioning keeps the branch overlay although the docs are committed', () => {
  const LOCAL = { ALFRED_CODE_DOCS_VERSIONING: 'local' };
  const r = repo({ tracked: true, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/declared-local');
    const out = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are capped at 10.'), LOCAL);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.ok(r.exists('.claude/docs/.branches/feat-declared-local/architecture/references/patterns/orders.md'), 'the branch version lands in the overlay');
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/, 'the committed text is untouched');
    assert.match(r.cli(['show', 'patterns#orders'], undefined, LOCAL).stdout, /capped at 10/, 'and the branch reads its own version');
    const st = r.cli(['status'], undefined, LOCAL).stdout;
    assert.match(st, /^mode: overlay \(declared by ALFRED_CODE_DOCS_VERSIONING/m);
    assert.match(st, /^Versioning mismatch: ALFRED_CODE_DOCS_VERSIONING declares 'local', but \.claude\/docs is tracked by git - the setting wins, so this branch's sections stay in the overlay/m);
  } finally { r.rm(); }
});

// Task 14 / whole-branch review finding 2: the committed-docs probe knows every DOMAIN, not architecture/ alone.
// A project documented only in code-style/ (or decisions/, or related-projects/) is an ordinary shape - a
// watch.json is what makes a domain and nothing requires architecture/ to be one. Probing architecture/ alone read
// that project's COMMITTED docs as ignored: writes went into .branches/ inside a git-versioned docs root, status
// reported 'docs are ignored by git', and versioningMismatch - the one line whose job is to report exactly this
// disagreement - stayed silent, because it demanded architecture/ exist before it would speak.
test('committed docs in a domain other than architecture/ are read as committed, by status and by where a write lands', () => {
  const r = repo({
    tracked: true,
    files: {
      'src/Api/Refund.cs': 'class Refund {}\n',
      '.claude/docs/code-style/watch.json': JSON.stringify({ sourceRoots: ['src'] }),
      '.claude/docs/code-style/CODE-STYLE.md': section('csharp', 'src/**.cs', 'Braces open on the same line.'),
    },
  });
  try {
    assert.ok(!r.exists('.claude/docs/architecture'), 'the whole case: there is no architecture/ folder at all');
    assert.match(r.cli(['status']).stdout, /^mode: git \(docs are not kept out of git - git versions them per branch\)/m);
    r.git('switch', '-qc', 'feat/style');
    const out = r.cli(['set', 'CODE-STYLE#csharp'], '## csharp\n<!-- id: csharp -->\n<!-- covers: src/**.cs -->\nBraces open on the next line.\n');
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /into .*CODE-STYLE\.md/);
    assert.ok(!r.exists('.claude/docs/.branches'), 'nothing is written under .branches/ inside a docs root git versions');
    assert.match(r.read('.claude/docs/code-style/CODE-STYLE.md'), /next line/, 'the committed file itself carries the change');
    // and a declaration that disagrees is REPORTED, naming the docs root the probe now answers for
    const st = r.cli(['status'], undefined, { ALFRED_CODE_DOCS_VERSIONING: 'local' }).stdout;
    assert.match(st, /^Versioning mismatch: ALFRED_CODE_DOCS_VERSIONING declares 'local', but \.claude\/docs is tracked by git - the setting wins, so this branch's sections stay in the overlay/m);
  } finally { r.rm(); }
});

// The other half of the same rule: a watch.json is what makes a domain, so a docs root holding only watch-less
// folders (quality/, related-context/) holds nothing this setting governs and reports no disagreement about it.
test('a committed docs root holding no domain at all is no fact to disagree with', () => {
  const r = repo({ tracked: true, files: { '.claude/docs/quality/ASSESSMENT.md': '# Findings\n' } });
  try {
    for (const mode of ['git', 'local']) {
      const st = r.cli(['status'], undefined, { ALFRED_CODE_DOCS_VERSIONING: mode }).stdout;
      assert.doesNotMatch(st, /Versioning mismatch/, `quality/ carries no watch.json, so it is no domain: '${mode}'`);
    }
  } finally { r.rm(); }
});

// Every install made before the key existed carries no value: the fallback is the one rule (docs-versioning-rule.test.js
// runs all four homes of it), and nothing is called a mismatch until someone declares a mode.
test('absent, empty or unknown versioning falls back to the kept-out-of-git rule, and nothing is called a mismatch', () => {
  const ignored = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const committed = repo({ tracked: true, docs: { 'references/patterns.md': PATTERNS } });
  try {
    for (const v of ['', 'auto', 'yes', 'true']) {
      const extra = { ALFRED_CODE_DOCS_VERSIONING: v };
      const a = ignored.cli(['status'], undefined, extra).stdout;
      const b = committed.cli(['status'], undefined, extra).stdout;
      assert.match(a, /^mode: overlay \(docs are kept out of git - branch versions live in \.branches\/\)/m, `ignored docs at '${v}'`);
      assert.match(b, /^mode: git \(docs are not kept out of git - git versions them per branch\)/m, `committed docs at '${v}'`);
      for (const out of [a, b]) assert.doesNotMatch(out, /Versioning mismatch/, `nothing declared, nothing to mismatch at '${v}'`);
    }
    assert.match(ignored.cli(['status'], undefined, { ALFRED_CODE_DOCS_VERSIONING: ' GIT ' }).stdout, /^mode: git \(declared/m, 'the value is trimmed and read case-insensitively');
  } finally { ignored.rm(); committed.rm(); }
});

// In git mode the automatic halves have nothing to do - git carries the docs with the branch - and an overlay
// written before the setting changed is stranded, exactly as it is when a previously ignored docs root is committed.
test('git versioning stands promote down and strands an overlay written before the flip', () => {
  const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/left');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Branch rule.')).status, 0);
    assert.match(r.cli(['show', 'patterns#orders'], undefined, GIT).stdout, /ledgered before the payment call/, 'git mode reads mainline, not the overlay');
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged'], undefined, GIT).stdout, /^git versioning: git carries the docs with the branch, so there is nothing to promote$/m);
    assert.ok(r.exists('.claude/docs/.branches/feat-left'), 'and nothing is folded in or deleted behind the setting');
    assert.match(r.cli(['status'], undefined, GIT).stdout, /stranded branch versions: feat-left/);
    assert.strictEqual(r.cli(['prune', 'feat/left'], undefined, GIT).stdout.trim(), 'pruned: feat-left', 'the by-hand prune still clears one');
  } finally { r.rm(); }
});

// The 30-day sweep keeps an overlay while `mergedBranches()` still names it - that is what stops it deleting a
// decision a promote could still fold in. In git mode that list is empty BY DESIGN, so the sweep lost half its
// guard: a merged, never-promoted overlay whose branch is gone was deleted with its text. The whole promote /
// prune machinery stands down under git versioning; naming one by hand still works.
test('git versioning: the 30-day sweep stands down instead of deleting what a promote would have kept', () => {
  const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const over = '.claude/docs/.branches/feat-landed/architecture/references/patterns/orders.md';
  try {
    r.git('switch', '-qc', 'feat/landed');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n');
    r.git('commit', '-qam', 'cap');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are capped at 10.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/landed');
    r.git('branch', '-D', 'feat/landed');
    const metaFile = path.join(r.root, '.claude/docs/.branches/feat-landed/BASE.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    meta.updated = new Date(Date.now() - 60 * 86400000).toISOString();   // the sweep's only other condition
    fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    assert.match(r.cli(['prune'], undefined, GIT).stdout, /^git versioning: git carries the docs with the branch, so nothing is swept - 'prune <branch>' still drops one overlay by name$/m);
    assert.ok(r.exists(over), 'the overlay text a promote would have folded in survives');
    assert.strictEqual(r.cli(['prune', 'feat/landed'], undefined, GIT).stdout.trim(), 'pruned: feat-landed', 'naming it by hand still drops it');
  } finally { r.rm(); }
});

// Every message names the key that ACTUALLY answered, read from one ordered list, so a twin that reads another
// spelling diverges on that list alone instead of on five sentences - and no message can name a key nobody set.
test('the mode messages name the env key that declared the mode, never a hardcoded one', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const enginePath = require.resolve('../stack/hooks/docs.js');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '', ALFRED_CODE_DOCS_VERSIONING: '' });
    delete require.cache[enginePath];
    const docs = require(enginePath);
    docs.VERSIONING_KEYS.unshift('DOCS_VERSIONING_OTHER_SPELLING');
    process.env.DOCS_VERSIONING_OTHER_SPELLING = 'git';
    assert.match(docs.versioningMismatch(), /^Versioning mismatch: DOCS_VERSIONING_OTHER_SPELLING declares 'git', but \.claude\/docs is not tracked by git/);
    assert.match(docs.status().mode, /^git \(declared by DOCS_VERSIONING_OTHER_SPELLING - /);
  } finally {
    delete require.cache[enginePath];
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    r.rm();
  }
});

// B-M6: a 1.x project declared the mode under the old spelling. Between the plugin update and its first
// /alfred-code:update that declaration is READ, never inferred over - and the new spelling wins when both exist.
test('the legacy docs-versioning key declares the mode until the rename lands, and the new key wins over it', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  const enginePath = require.resolve('../stack/hooks/docs.js');
  const saved = { ...process.env };
  const LEGACY_KEY = 'CLAUDE_STACK_DOCS_VERSIONING'; // legacy-name
  const under = (env) => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved, { CLAUDE_PROJECT_DIR: r.root, ALFRED_CODE_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '', ALFRED_CODE_DOCS_VERSIONING: '', [LEGACY_KEY]: '' }, env);
    delete require.cache[enginePath];
    const docs = require(enginePath);
    return { mode: docs.docsMode(), status: docs.status().mode };
  };
  try {
    const inferred = under({}).mode;
    const other = inferred === 'git' ? 'local' : 'git';
    const legacy = under({ [LEGACY_KEY]: other });
    assert.strictEqual(legacy.mode, other, 'the old spelling is read, not inferred over');
    assert.match(legacy.status, new RegExp(`^${other === 'git' ? 'git' : 'overlay'} \\(declared by ${LEGACY_KEY} - `));
    assert.strictEqual(under({ ALFRED_CODE_DOCS_VERSIONING: inferred, [LEGACY_KEY]: other }).mode, inferred, 'the new spelling wins');
  } finally {
    delete require.cache[enginePath];
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    r.rm();
  }
});

test('a section new on a branch is written with an empty base and read as added', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/new');
    assert.strictEqual(r.cli(['set', 'patterns#device-paging'], '## Device paging\n<!-- id: device-paging -->\nTen rows per page.\n').status, 0);
    assert.strictEqual(r.read('.claude/docs/.branches/feat-new/.base/architecture/references/patterns/device-paging.md'), '');
    assert.match(r.cli(['show', 'patterns#device-paging']).stdout, /Ten rows per page/);
    assert.match(r.cli(['toc', 'patterns']).stdout, /patterns#device-paging .*\[this branch\]/);
  } finally { r.rm(); }
});

test('mainline edits to other lines reach the branch through a clean three-way merge', () => {
  // Changes three unchanged lines apart: git merge-file treats touching hunks as a conflict, so the test keeps a gap.
  const body = (first, last) => `${first}\nLine two.\nLine three.\nLine four.\n${last}`;
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', body('Line one.', 'Line five.')) } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body('Line one.', 'Line five, on the branch.')}\n`);
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body('Line one, on mainline.', 'Line five.')}\n`);
    r.git('switch', '-q', 'feat/x');
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /Line one, on mainline\.[\s\S]*Line five, on the branch\./);
    assert.doesNotMatch(out, /CONFLICT/);
  } finally { r.rm(); }
});

test('the same line changed on both sides: the branch text is served and flagged, --conflict shows both', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 10.\n');
    r.git('switch', '-q', 'develop');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nThe cap is 20.\n');
    r.git('switch', '-q', 'feat/x');
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /The cap is 10\./);
    assert.match(out, /CONFLICT/);
    const both = r.cli(['show', 'patterns#orders', '--conflict']).stdout;
    assert.match(both, /<<<<<<< mainline[\s\S]*The cap is 20\.[\s\S]*=======[\s\S]*The cap is 10\.[\s\S]*>>>>>>> feat\/x/);
  } finally { r.rm(); }
});

test('a stamp rewritten on both sides alone never conflicts', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'Stable text.') } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStable text.\nBranch addition.\n');
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'x\n'); r.git('add', '-A'); r.git('commit', '-qm', 'move HEAD');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nStable text.\n');
    r.git('switch', '-q', 'feat/x');
    assert.doesNotMatch(r.cli(['show', 'patterns#orders']).stdout, /CONFLICT/);
  } finally { r.rm(); }
});

test("a child section set inside an overridden parent lands in the parent's override and reads back", () => {
  const r = repo({ docs: { 'references/patterns.md': NESTED } });
  try {
    r.git('switch', '-qc', 'feat/x');
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nOrders rule, branch.\n\n### paging\n<!-- id: paging -->\nTen rows.\n');
    r.cli(['set', 'patterns#paging'], '### paging\n<!-- id: paging -->\nTwenty rows.\n');
    assert.match(r.cli(['show', 'patterns#paging']).stdout, /Twenty rows\./);
    const out = r.cli(['show', 'patterns#orders']).stdout;
    assert.match(out, /Orders rule, branch\./);
    assert.match(out, /Twenty rows\./);
    assert.ok(!r.exists('.claude/docs/.branches/feat-x/architecture/references/patterns/paging.md'), 'no separate child override file');
    assert.ok(r.exists('.claude/docs/.branches/feat-x/architecture/references/patterns/orders.md'), 'the parent override still exists');
  } finally { r.rm(); }
});

test('setting a parent drops a nested child override its text now carries', () => {
  const r = repo({ docs: { 'references/patterns.md': NESTED } });
  try {
    r.git('switch', '-qc', 'feat/y');
    r.cli(['set', 'patterns#paging'], '### paging\n<!-- id: paging -->\nTwelve rows.\n');
    assert.ok(r.exists('.claude/docs/.branches/feat-y/architecture/references/patterns/paging.md'));
    r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nParent rewritten.\n\n### paging\n<!-- id: paging -->\nTwelve rows.\n');
    assert.ok(!r.exists('.claude/docs/.branches/feat-y/architecture/references/patterns/paging.md'), 'the child override is dropped');
    assert.ok(!r.exists('.claude/docs/.branches/feat-y/.base/architecture/references/patterns/paging.md'), 'its base twin is dropped too');
    assert.match(r.cli(['show', 'patterns#paging']).stdout, /Twelve rows\./);
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /Parent rewritten\./);
  } finally { r.rm(); }
});

test('set refuses: detached HEAD, empty text, no section id, unknown file', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['set', 'patterns#orders'], '   \n').stdout, /empty section text/);
    assert.match(r.cli(['set', 'patterns'], 'x').stdout, /name one section/);
    assert.match(r.cli(['set', 'nope#x'], 'x').stdout, /no such doc file/);
    r.git('checkout', '-q', '--detach');
    const d = r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'x'));
    assert.strictEqual(d.status, 1);
    assert.match(d.stdout, /detached HEAD/);
  } finally { r.rm(); }
});

function branchWithDecision(r, name, text) {
  r.git('switch', '-qc', name);
  r.write('src/Api/Orders/Refund.cs', `class Refund { /* ${name} */ }\n`);
  r.git('add', '-A'); r.git('commit', '-qm', `work on ${name}`);
  assert.strictEqual(r.cli(['set', 'patterns#orders'], text).status, 0);
  r.git('switch', '-q', 'develop');
}
const ORDERS = (body) => `## orders\n<!-- id: orders -->\n<!-- covers: src/Api/Orders/** -->\n${body}\n`;

test('a merge commit is detected and promoted; the overlay goes; promoted.jsonl records it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const out = r.cli(['promote', '--merged']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /feat\/cap .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10[\s\S]*soft-deleted/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-cap'));
    assert.match(r.read('.claude/docs/.branches/promoted.jsonl'), /"branch":"feat-cap"/);
  } finally { r.rm(); }
});

// A model that ASKS where a decision lives must not get a worse answer than one that just edits. The gate's own
// ranking was boosted by what a merge had just folded in; this proves the plain CLI reads that from the engine's
// own promote record, with no hook anywhere in the run, and that the boost expires.
test('where names a freshly promoted section first, and stops when the fold is old', () => {
  const NARROW = ['a', 'b', 'c'].map((x) => section(x, 'src/Api/Orders/**', `Narrow rule ${x}.`)).join('\n');
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'src/Api/Users/User.cs': 'class User {}\n' },
    docs: { 'references/patterns.md': NARROW, 'references/boundaries.md': section('paging', 'src/**', 'Pages hold 20 rows.') },
  });
  try {
    r.git('switch', '-qc', 'feat/drawer');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Page; }\n'); r.git('commit', '-qam', 'drawer');
    r.cli(['set', 'boundaries#paging'], '## paging\n<!-- id: paging -->\n<!-- covers: src/** -->\nA drawer list holds at most 10 rows.\n');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/drawer');
    const cold = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(cold.split('\n')[0], /^patterns#a /, 'nothing promoted yet: the narrowest answers');
    assert.strictEqual(r.cli(['promote', '--merged']).status, 0);
    const fresh = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(fresh.split('\n')[0], /^boundaries#paging /, 'what just landed answers first');
    assert.match(fresh, /patterns#a /, 'and the ranking still fills the rest');
    const log = '.claude/docs/.branches/promoted.jsonl';
    const rows = r.read(log).trim().split('\n').map((l) => JSON.parse(l));
    r.write(log, `${rows.map((x) => JSON.stringify({ ...x, at: new Date(Date.now() - 9 * 3600 * 1000).toISOString() })).join('\n')}\n`);
    const stale = r.cli(['where', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(stale.split('\n')[0], /^patterns#a /, 'a fold nobody read for a working day is no longer news');
    assert.doesNotMatch(stale, /boundaries#paging/);
    // A half-written or hand-edited ledger costs the boost, never the answer.
    r.write(log, `not json at all\n{"at":"nope","results":[{"id":"boundaries#paging"}]}\n{"at":"${new Date().toISOString()}","results":"x"}\n`);
    const junk = r.cli(['where', 'src/Api/Orders/Refund.cs']);
    assert.strictEqual(junk.status, 0);
    assert.match(junk.stdout.split('\n')[0], /^patterns#a /);
  } finally { r.rm(); }
});

test('a squash merge is detected by blobs', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/squash', ORDERS('Squashed rule.'));
    r.git('merge', '-q', '--squash', 'feat/squash'); r.git('commit', '-qm', 'squash');
    r.git('branch', '-D', 'feat/squash');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Squashed rule\./);
  } finally { r.rm(); }
});

test('a fast-forward merge is detected by ancestry, a rebase merge by blobs', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/ff', ORDERS('Fast-forwarded rule.'));
    r.git('merge', '-q', '--ff-only', 'feat/ff');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/ff \(ancestor\) patterns#orders: merged/);
    branchWithDecision(r, 'feat/rebased', ORDERS('Rebased rule.'));
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'mainline moved');
    r.git('cherry-pick', 'feat/rebased');
    r.git('branch', '-D', 'feat/rebased');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/rebased \(blobs\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Rebased rule\./);
  } finally { r.rm(); }
});

// The overlay is written before the branch has a commit of its own, so BASE.json snapshots head === base and no
// files at all. The branch commits afterwards and lands: the snapshot is one commit behind, and only the branch ref
// still says what the branch actually holds.
test('a section set before the branch\'s first commit is still promoted when the branch merges', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/early');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    const meta = JSON.parse(r.read('.claude/docs/.branches/feat-early/BASE.json'));
    assert.strictEqual(meta.head, meta.base, 'the snapshot is taken before the branch has a commit of its own');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/early');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/early .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10[\s\S]*soft-deleted/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-early'), 'the overlay is folded in and gone');
  } finally { r.rm(); }
});

test('a section set before the first commit is promoted through a squash merge too', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/early-squash');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Squashed early rule.')).status, 0);
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 20; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--squash', 'feat/early-squash'); r.git('commit', '-qm', 'squash');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/early-squash .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Squashed early rule\./);
    assert.ok(!r.exists('.claude/docs/.branches/feat-early-squash'));
  } finally { r.rm(); }
});

test('a branch with no commits of its own is never taken as merged', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/fresh');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));
  } finally { r.rm(); }
});

// Catching up with mainline moves the branch tip without the branch committing anything: the tip is then a mainline
// commit, indistinguishable from a landed one by ancestry alone. The recorded fork point is what keeps them apart.
test('a branch that only caught up with mainline is never taken as merged', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/behind');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Not yet.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'mainline moved');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-behind'));
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
  } finally { r.rm(); }
});

// The release shape this repo itself uses: work lands on develop, develop is merged into main. A branch that only
// caught up sits on develop's tip - and that tip becomes the release merge's SECOND parent, which is exactly the
// shape a merged branch has. Two variants: the tip is still develop's head, and develop has moved on past it.
for (const moveOn of [false, true]) {
  test(`a branch that only caught up is never promoted when a second mainline ref merges that mainline${moveOn ? ', develop moved on' : ''}`, () => {
    const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
    try {
      r.git('branch', 'main');
      r.git('switch', '-qc', 'feat/behind');
      assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still being decided.')).status, 0);
      r.git('switch', '-q', 'develop');
      r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
      r.git('switch', '-q', 'feat/behind');
      r.git('merge', '-q', '--ff-only', 'develop');
      r.git('switch', '-q', 'main');
      r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
      if (moveOn) {
        r.git('switch', '-q', 'develop');
        r.write('README.md', 'z\n'); r.git('commit', '-qam', 'develop moved on');
        r.git('switch', '-q', 'main');
      }
      assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
      assert.ok(r.exists('.claude/docs/.branches/feat-behind'), 'the in-progress overlay survives');
      assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
      assert.match(r.cli(['status']).stdout, /branches sitting on mainline with no proof they merged: feat-behind/);
    } finally { r.rm(); }
  });
}

// The most ordinary state in this workflow: a branch cut, a decision written, nothing committed yet, mainline
// moving on. Nothing landed and nothing is stranded, so naming it would invite a fold that publishes an
// unfinished decision. A branch that has never committed is the one shape here that IS decidable: tip === base.
test('a branch that has never committed anything is never called unpromotable', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/never-committed');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still thinking.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moves on');
    const out = r.cli(['status']).stdout;
    assert.doesNotMatch(out, /no proof they merged/, 'nothing about it is unclear');
    assert.doesNotMatch(out, /deleted branches/);
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-never-committed'));
  } finally { r.rm(); }
});

// A fork point the repo does not have - pruned, re-cloned, hand-edited - makes head !== base true by accident,
// and every route that reads the fork point then reasons from a commit that does not exist.
test('an overlay whose recorded fork point does not resolve is never promoted', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('branch', 'main');
    r.git('switch', '-qc', 'feat/behind');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Still being decided.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moves');
    r.git('switch', '-q', 'feat/behind');
    r.git('merge', '-q', '--ff-only', 'develop');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
    const metaPath = path.join(r.root, '.claude/docs/.branches/feat-behind/BASE.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    fs.writeFileSync(metaPath, `${JSON.stringify({ ...meta, base: 'f'.repeat(40) }, null, 2)}\n`);
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-behind'), 'the overlay survives an unreadable fork point');
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /ledgered before the payment call/);
  } finally { r.rm(); }
});

// The same broken fork point must not cost a branch whose blobs speak for themselves.
test('a squashed branch is still promoted by blobs when its fork point does not resolve', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/blobbed');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int B; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'b');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Blob rule.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--squash', 'feat/blobbed'); r.git('commit', '-qm', 'squash');
    r.git('branch', '-D', 'feat/blobbed');
    const metaPath = path.join(r.root, '.claude/docs/.branches/feat-blobbed/BASE.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    fs.writeFileSync(metaPath, `${JSON.stringify({ ...meta, base: 'f'.repeat(40) }, null, 2)}\n`);
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/blobbed \(blobs\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Blob rule\./);
  } finally { r.rm(); }
});

// The same release shape, with a branch that really did commit and land: the guard above must not cost this one.
test('a branch merged into develop and released into main is still promoted there', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n', 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('branch', 'main');
    r.git('switch', '-qc', 'feat/released');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap => 10; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'cap');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge feat/released', 'feat/released');
    r.git('switch', '-q', 'main');
    r.git('merge', '-q', '--no-ff', '-m', 'release', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/released .*patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-released'));
  } finally { r.rm(); }
});

// A snapshot is taken while the branch is still short of mainline and never rewritten afterwards: going back to a
// merged branch for one more session used to re-measure it as 'no commits of its own' and strand its sections.
test('a session on a branch after it merged leaves its snapshot alone', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/revisited');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int R; }\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'r');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Revisited rule.')).status, 0);
    const before = r.read('.claude/docs/.branches/feat-revisited/BASE.json');
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/revisited');
    r.git('switch', '-q', 'feat/revisited');
    r.hook({ hook_event_name: 'SessionStart', session_id: 'revisit-1' });
    assert.strictEqual(r.read('.claude/docs/.branches/feat-revisited/BASE.json'), before, 'the merged branch keeps its snapshot');
    assert.strictEqual(r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nAlso decided here.\n').status, 0);
    assert.strictEqual(JSON.parse(r.read('.claude/docs/.branches/feat-revisited/BASE.json')).base, JSON.parse(before).base, 'and keeps it through a later set');
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/revisited \(ancestor\) patterns#orders: merged/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Revisited rule\./);
  } finally { r.rm(); }
});

// The other half of the same rule: a branch that only caught up must not have its snapshot re-measured either, or
// its head would advance onto mainline while its base stayed put and the next promote would take it as merged.
test('a set on a branch that only caught up does not make it promotable', () => {
  const r = repo({ files: { 'README.md': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/caught-up');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('First thought.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.write('README.md', 'y\n'); r.git('commit', '-qam', 'develop moved');
    r.git('switch', '-q', 'feat/caught-up');
    r.git('merge', '-q', '--ff-only', 'develop');
    assert.strictEqual(r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nSecond thought.\n').status, 0);
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-caught-up'));
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /Second thought/);
  } finally { r.rm(); }
});

test('a branch cut from develop with no commits is never promoted when origin/HEAD is main', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const remote = `${r.root}-remote`;
  try {
    spawnSync('git', ['init', '-q', '--bare', remote]);
    r.git('branch', 'main');
    r.git('remote', 'add', 'origin', remote);
    r.git('push', '-q', 'origin', 'develop', 'main');
    r.git('remote', 'set-head', 'origin', 'main');
    r.write('README.md', 'ahead\n'); r.git('add', '-A'); r.git('commit', '-qm', 'develop moves ahead');

    // a branch cut here has no commits of its own - it must not be taken as merged, whatever origin/HEAD says.
    r.git('switch', '-qc', 'feat/fresh');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', '-q', 'develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));

    // a branch with a commit of its own, merged into develop, is still promoted correctly.
    r.git('switch', '-qc', 'feat/real');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int R; }\n'); r.git('commit', '-qam', 'r');
    r.cli(['set', 'patterns#orders'], ORDERS('Real rule.'));
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/real');
    assert.match(r.cli(['promote', '--merged']).stdout, /feat\/real \(ancestor\) patterns#orders: merged/);
  } finally { r.rm(); fs.rmSync(remote, { recursive: true, force: true }); }
});

test('a branch cut from origin/develop with no commits is never promoted when the local develop is stale', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  const remote = `${r.root}-remote`;
  try {
    spawnSync('git', ['init', '-q', '--bare', remote]);
    r.git('remote', 'add', 'origin', remote);
    r.git('push', '-q', 'origin', 'develop');
    r.write('README.md', 'ahead\n'); r.git('add', '-A'); r.git('commit', '-qm', 'develop moves ahead');
    r.git('push', '-q', 'origin', 'develop');
    r.git('reset', '--hard', 'HEAD~1'); // the local develop goes stale; origin/develop stays ahead
    r.git('fetch', '-q', 'origin');

    // cut from origin/develop, the real tip - not from the local branch, which has not caught up.
    r.git('switch', '-qc', 'feat/fresh', 'origin/develop');
    r.cli(['set', 'patterns#orders'], ORDERS('Not yet.'));
    r.git('switch', 'develop');
    r.git('merge', '-q', '--ff-only', 'origin/develop');
    assert.match(r.cli(['promote', '--merged']).stdout, /nothing merged/);
    assert.ok(r.exists('.claude/docs/.branches/feat-fresh'));
  } finally { r.rm(); fs.rmSync(remote, { recursive: true, force: true }); }
});

test('two branches adding the same new section: the second promote conflicts, not overwrites', () => {
  const r = repo({ files: { 'src/Api/Orders/A.cs': 'class A {}\n', 'src/Api/Orders/B.cs': 'class B {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/a');
    r.write('src/Api/Orders/A.cs', 'class A { int X; }\n'); r.git('commit', '-qam', 'a');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nFrom A.\n');
    r.git('switch', '-q', 'develop');

    r.git('switch', '-qc', 'feat/b');
    r.write('src/Api/Orders/B.cs', 'class B { int X; }\n'); r.git('commit', '-qam', 'b');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nFrom B.\n');
    r.git('switch', '-q', 'develop');

    r.git('merge', '-q', '--no-ff', '-m', 'merge a', 'feat/a');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#paging: added/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /From A\./);

    r.git('merge', '-q', '--no-ff', '-m', 'merge b', 'feat/b');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#paging: conflict \(both added this section\)/);
    const doc = r.read('.claude/docs/architecture/references/patterns.md');
    assert.match(doc, /From A\./);
    assert.doesNotMatch(doc, /From B\./);
  } finally { r.rm(); }
});

test('a promote conflict keeps that override; setting the section on mainline resolves it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    branchWithDecision(r, 'feat/c', ORDERS('The cap is 10.'));
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/c');
    const first = r.cli(['promote', '--merged']);
    assert.match(first.stdout, /patterns#orders: conflict/);
    assert.ok(r.exists('.claude/docs/.branches/feat-c/architecture/references/patterns/orders.md'));
    assert.match(r.cli(['show', 'patterns#orders', '--conflict', 'feat/c']).stdout, /<<<<<<< mainline/);
    const resolved = r.cli(['set', 'patterns#orders'], ORDERS('The cap is 10.'));
    assert.match(resolved.stdout, /resolved the pending doc conflict with: feat-c/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-c'));
  } finally { r.rm(); }
});

test("keeping mainline's text resolves a conflict too", () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'The cap is 5.') } });
  try {
    branchWithDecision(r, 'feat/e', ORDERS('The cap is 10.'));
    r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/e');
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: conflict/);
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: conflict/);
    const lines = r.read('.claude/docs/.branches/promoted.jsonl').trim().split('\n');
    assert.strictEqual(lines.length, 1, 'a repeated, unchanged conflict never appends another row');
    const resolved = r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    assert.match(resolved.stdout, /resolved the pending doc conflict with: feat-e/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-e'));
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /The cap is 20\./);
  } finally { r.rm(); }
});

test('a section new on the branch is appended on promote; one mainline removed is a conflict', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/add');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int P; }\n'); r.git('commit', '-qam', 'p');
    r.cli(['set', 'patterns#paging'], '## Paging\n<!-- id: paging -->\nTen rows.\n');
    r.cli(['set', 'patterns#users'], '## users\n<!-- id: users -->\nUsers are archived.\n');
    r.git('switch', '-q', 'develop');
    r.write('.claude/docs/architecture/references/patterns.md', section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/add');
    const out = r.cli(['promote', '--merged']).stdout;
    assert.match(out, /patterns#paging: added/);
    assert.match(out, /patterns#users: conflict \(mainline removed this section\)/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Ten rows\./);
  } finally { r.rm(); }
});

test('a doc file mainline no longer has stays a plain conflict, never traps an unclearable marker', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' },
    docs: {
      'references/patterns.md': PATTERNS,
      'references/legacy.md': section('old-rule', 'src/Api/Legacy/**', 'Legacy behavior.'),
    },
  });
  try {
    r.git('switch', '-qc', 'feat/mix');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int M; }\n'); r.git('commit', '-qam', 'm');
    r.cli(['set', 'patterns#orders'], ORDERS('Mixed rule.'));
    r.cli(['set', 'legacy#old-rule'], '## old rule\n<!-- id: old-rule -->\nBranch keeps it.\n');
    r.git('switch', '-q', 'develop');

    // mainline drops the whole doc file this branch also touched.
    fs.rmSync(path.join(r.root, '.claude/docs/architecture/references/legacy.md'), { force: true });
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/mix');

    const first = r.cli(['promote', '--merged']).stdout;
    assert.match(first, /patterns#orders: merged/);
    assert.match(first, /legacy#old-rule: conflict \(mainline has no such doc file\)/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-mix/.conflict/architecture/references/legacy/old-rule.md'), 'no marker for a missing doc file - set can never match one to clear it');
    assert.ok(r.exists('.claude/docs/.branches/feat-mix/architecture/references/legacy/old-rule.md'), 'the conflicting override is kept as-is');

    const second = r.cli(['promote', '--merged']).stdout;
    assert.match(second, /legacy#old-rule: conflict \(mainline has no such doc file\)/);
    assert.doesNotMatch(second, /patterns#orders/, 'the already-landed side is never revisited');
  } finally { r.rm(); }
});

test('status lists a deleted unmerged branch; promote <branch> folds it in, prune <branch> drops it', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/gone', ORDERS('Gone rule.'));
    branchWithDecision(r, 'feat/drop', ORDERS('Dropped rule.'));
    r.git('branch', '-D', 'feat/gone'); r.git('branch', '-D', 'feat/drop');
    assert.match(r.cli(['status']).stdout, /deleted branches never detected as merged: feat-drop, feat-gone|deleted branches never detected as merged: feat-gone, feat-drop/);
    assert.match(r.cli(['promote', 'feat-gone']).stdout, /patterns#orders: merged/);
    assert.match(r.cli(['prune', 'feat-drop']).stdout, /pruned: feat-drop/);
    assert.ok(!r.exists('.claude/docs/.branches/feat-drop'));
  } finally { r.rm(); }
});

test('prune without a branch drops only overlays of deleted branches idle for 30 days', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    const backdate = (rel) => {
      const meta = JSON.parse(r.read(rel));
      meta.updated = old;
      r.write(rel, `${JSON.stringify(meta, null, 2)}\n`);
    };

    // idle: BASE.json itself says it was last touched 40 days ago - pruned.
    branchWithDecision(r, 'feat/idle', ORDERS('Idle rule.'));
    r.git('branch', '-D', 'feat/idle');
    backdate('.claude/docs/.branches/feat-idle/BASE.json');

    // recent: BASE.json still says 'now' - a backdated directory mtime must not fool prune into dropping it.
    branchWithDecision(r, 'feat/recent', ORDERS('Recent rule.'));
    r.git('branch', '-D', 'feat/recent');
    const oldTime = new Date(Date.now() - 40 * 86400000);
    fs.utimesSync(path.join(r.root, '.claude/docs/.branches/feat-recent'), oldTime, oldTime);

    // merged: idle by BASE.json's clock too, but still merged into develop - promote owns it, not bulk prune.
    branchWithDecision(r, 'feat/merged', ORDERS('Merged rule.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/merged');
    r.git('branch', '-D', 'feat/merged');
    backdate('.claude/docs/.branches/feat-merged/BASE.json');

    const out = r.cli(['prune']).stdout;
    assert.strictEqual(out.trim(), 'pruned: feat-idle');
    assert.ok(!r.exists('.claude/docs/.branches/feat-idle'));
    assert.ok(r.exists('.claude/docs/.branches/feat-recent'), 'BASE.json says now, so it is kept despite the backdated directory');
    assert.ok(r.exists('.claude/docs/.branches/feat-merged'), 'a merged overlay belongs to promote, not to bulk prune');
  } finally { r.rm(); }
});

test('status: mode, branch, overrides and conflicts; a shallow clone skips promote', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/s');
    r.cli(['set', 'patterns#orders'], ORDERS('Branch rule.'));
    const out = r.cli(['status']).stdout;
    assert.match(out, /mode: overlay/);
    assert.match(out, /branch: feat\/s/);
    assert.match(out, /overrides: patterns#orders/);
    r.write('.claude/docs/architecture/BRANCH-DELTA.md', '## Old delta\nA decision.\n');
    assert.match(r.cli(['status']).stdout, /BRANCH-DELTA\.md from an older capture/);
    assert.doesNotMatch(r.cli(['files']).stdout, /BRANCH-DELTA/, 'never read as a doc');
    assert.ok(r.exists('.claude/docs/architecture/BRANCH-DELTA.md'));
    r.git('switch', '-q', 'develop');
    const clone = `${r.root}-shallow`;
    require('node:child_process').spawnSync('git', ['clone', '-q', '--depth', '1', `file://${r.root}`, clone]);
    const s = require('node:child_process').spawnSync(process.execPath, [require('./docs-fixture').HOOKS + '/docs.js', 'promote', '--merged'], { cwd: clone, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: clone, ALFRED_CODE_DOCS_PATH: '.claude/docs' } });
    assert.match(s.stdout, /shallow clone: merged branches cannot be detected/);
    fs.rmSync(clone, { recursive: true, force: true });
  } finally { r.rm(); }
});

test('lint: duplicate id, missing id, conflict markers, size at 6000 passes and 6001 fails', () => {
  const body = (n) => 'x'.repeat(n);
  const head = '## big\n<!-- id: big -->\n';
  const r = repo({ docs: {
    'references/a.md': `${head}${body(6000 - head.length)}\n\n## dup\n<!-- id: same -->\nOne.\n\n## dup two\n<!-- id: same -->\nTwo.\n\n## no id here\nText.\n`,
    'references/b.md': `## over\n<!-- id: over -->\n${body(6001 - '## over\n<!-- id: over -->\n'.length)}\n`,
    'references/c.md': '## merged\n<!-- id: merged -->\n<<<<<<< mainline\nx\n=======\ny\n>>>>>>> feat\n',
  } });
  try {
    const out = r.cli(['lint']);
    assert.strictEqual(out.status, 1);
    assert.doesNotMatch(out.stdout, /oversized section \(\d+ chars, cap 6000\): a#big/, '6000 passes');
    assert.match(out.stdout, /oversized section \(6001 chars, cap 6000\): b#over/);
    assert.match(out.stdout, /duplicate id a#same/);
    assert.match(out.stdout, /section without an id: references\/a 'no id here'/);
    assert.match(out.stdout, /merge conflict markers in references\/c/);
  } finally { r.rm(); }
});

test('lint: ORIENTATION.md at 4096 bytes passes, 4097 fails; watch.json problems are reported', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': 'o'.repeat(4096) } });
  try {
    assert.doesNotMatch(r.cli(['lint']).stdout, /ORIENTATION\.md is/);
    r.write('.claude/docs/architecture/ORIENTATION.md', 'o'.repeat(4097));
    assert.match(r.cli(['lint']).stdout, /ORIENTATION\.md is 4097 bytes, cap 4096/);
    r.write('.claude/docs/architecture/watch.json', '{ not json');
    assert.match(r.cli(['lint']).stdout, /watch\.json is not valid JSON/);
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['patterns#nope'] }] }));
    assert.match(r.cli(['lint']).stdout, /watch\.json 'root' names a section that does not exist: patterns#nope/);
  } finally { r.rm(); }
});

test('seed-ids adds missing ids once; a second run changes nothing; duplicate headings get distinct ids', () => {
  const r = repo({ docs: { 'references/p.md': '## Orders\nA.\n\n## Orders\nB.\n\n## Users\n<!-- id: users -->\nC.\n' } });
  try {
    assert.match(r.cli(['seed-ids']).stdout, /^2 ids added/);
    const once = r.read('.claude/docs/architecture/references/p.md');
    assert.match(once, /<!-- id: orders -->[\s\S]*<!-- id: orders-2 -->/);
    assert.match(r.cli(['seed-ids']).stdout, /^0 ids added/);
    assert.strictEqual(r.read('.claude/docs/architecture/references/p.md'), once);
  } finally { r.rm(); }
});

test('watch: globs and new module folders map to their sections; missing or malformed watch.json hits nothing', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.match(r.cli(['watch', 'src/Api/Program.cs']).stdout, /no watch\.json/);
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
      newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] },
    }));
    const hit = r.cli(['watch', 'src/Api/Program.cs', 'src/Api/Orders/Refund.cs']).stdout;
    assert.match(hit, /composition root: src\/Api\/Program\.cs -> patterns#orders/);
    assert.doesNotMatch(hit, /Refund/);
    assert.match(r.cli(['watch', '--dir', 'src/Api/Features/Billing']).stdout, /new module: src\/Api\/Features\/Billing\/ -> patterns#users/);
    r.write('.claude/docs/architecture/watch.json', '[]');
    assert.match(r.cli(['watch', 'src/Api/Program.cs']).stdout, /nothing hit/);
  } finally { r.rm(); }
});

// changedSince/snapshot carry no CLI verb of their own, so this drives the engine as a module: require
// stack/hooks/docs.js directly with CLAUDE_PROJECT_DIR pointed at the throwaway repo. The module is cached by
// resolved path, so the cache entry is cleared before and after - each test that does this gets a fresh ROOT.
const ENGINE_PATH = require.resolve(path.join(require('./docs-fixture').HOOKS, 'docs.js'));
function requireEngine(root) {
  delete require.cache[ENGINE_PATH];
  process.env.CLAUDE_PROJECT_DIR = root;
  process.env.ALFRED_CODE_DOCS_PATH = '.claude/docs';
  process.env.CLAUDE_DOCS_PATH = '';
  return require(ENGINE_PATH);
}

test('a folder is a domain only when it holds a watch.json', () => {
  const r = repo();
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/quality/ASSESSMENT.md', '# x');
    r.write('.claude/docs/.branches/watch.json', '{}');
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.domains(), ['architecture', 'code-style']);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Two domains, each holding its own root doc - the shared setup for parseRef's bare, qualified and
// ambiguous cases.
function twoDomainFixture() {
  const r = repo();
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/architecture/ARCHITECTURE.md', section('orders', 'src/Api/Orders/**', 'Orders rule.'));
  r.write('.claude/docs/code-style/watch.json', '{}');
  r.write('.claude/docs/code-style/CODE-STYLE.md', section('csharp', '*.cs', 'Style rule.'));
  return r;
}

test('a bare ref resolves while exactly one domain holds that file', () => {
  const r = twoDomainFixture();
  try {
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.parseRef('ARCHITECTURE#orders'), { domain: 'architecture', file: 'ARCHITECTURE.md', id: 'ARCHITECTURE#orders' });
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('a qualified ref always resolves', () => {
  const r = twoDomainFixture();
  try {
    const docs = requireEngine(r.root);
    assert.equal(docs.parseRef('code-style/CODE-STYLE#csharp').domain, 'code-style');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('an ambiguous bare ref throws naming every candidate', () => {
  const r = twoDomainFixture();
  try {
    r.write('.claude/docs/code-style/ARCHITECTURE.md', '## x\n<!-- id: ARCHITECTURE#x -->\n');
    const docs = requireEngine(r.root);
    assert.throws(() => docs.parseRef('ARCHITECTURE#x'),
      /ARCHITECTURE#x is in architecture and code-style - name one/);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Round 2 (review findings 1, 2, 3, 6): a domain's own references/ subfolder must never be mistaken for
// a domain name, a stated domain must keep its subfolder rather than swallow it, a typo must not silently
// compose a path, and the promise has to hold for refs this repo actually ships - not just hand-picked
// shapes.

test('a bare ref carrying a subfolder resolves by which domain holds it, not by treating the subfolder as a domain', () => {
  const r = twoDomainFixture();
  try {
    r.write('.claude/docs/architecture/references/patterns.md', PATTERNS);
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.parseRef('references/patterns#orders'),
      { domain: 'architecture', file: 'references/patterns.md', id: 'references/patterns#orders' });
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('a domain-qualified ref keeps its subfolder instead of folding it into the domain name', () => {
  const r = twoDomainFixture();
  try {
    r.write('.claude/docs/architecture/references/patterns.md', PATTERNS);
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.parseRef('architecture/references/patterns#orders'),
      { domain: 'architecture', file: 'references/patterns.md', id: 'references/patterns#orders' });
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('a mistyped or unknown leading segment throws instead of composing a path into a folder that is not a domain', () => {
  const r = twoDomainFixture();
  try {
    const docs = requireEngine(r.root);
    assert.throws(() => docs.parseRef('architcture/ARCHITECTURE#orders'),
      /no domain or subfolder resolves architcture\/ARCHITECTURE#orders/);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('an empty ref or one ending in a slash is refused rather than composed into a file named .md', () => {
  const r = twoDomainFixture();
  try {
    const docs = requireEngine(r.root);
    assert.throws(() => docs.parseRef(''), /not a section ref/);
    assert.throws(() => docs.parseRef('architecture/'), /not a section ref/);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// The compatibility proof itself: a bare id straight out of a shipped watch.json's sections array
// (alfred-capture-architecture/references/doc-shapes.md's own example uses this shape, e.g.
// 'modules#module-map') and the 'references/<topic>#<id>' spelling docs-session.js documents as an
// equivalent way to write the same ref (stack/hooks/docs-session.js:220) - both must resolve to the one
// file that actually holds the section, architecture/references/patterns.md, not to a nonexistent
// architecture/patterns.md.
test('a real watch.json sections entry and the references/ spelling both resolve to the file that holds them', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'root', globs: ['src/**'], sections: ['patterns#orders'] }],
    }));
    const docs = requireEngine(r.root);
    const bare = docs.parseRef('patterns#orders');
    assert.strictEqual(bare.domain, 'architecture');
    assert.strictEqual(bare.file, 'references/patterns.md');
    assert.ok(fs.existsSync(path.join(r.root, '.claude', 'docs', 'architecture', bare.file)), bare.file);

    const withFolder = docs.parseRef('references/patterns#orders');
    assert.strictEqual(withFolder.domain, 'architecture');
    assert.strictEqual(withFolder.file, 'references/patterns.md');
    assert.ok(fs.existsSync(path.join(r.root, '.claude', 'docs', 'architecture', withFolder.file)));
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Fix round 2 (task-3-fix-review.md, finding 1): docs-session.js:221 tells users three spellings
// resolve to the same section - 'patterns#orders', 'references/patterns#orders' and
// 'patterns.md#orders'. findFile used to carry its own explicit basename tier that stripped '.md';
// parseRef's merged search compares a fileKey against relKey/key, both already extension-stripped, so
// a literal '.md' fileKey matched neither once findFile started delegating to it.
test('the "<file>.md#<id>" spelling stays resolvable through parseRef and every reader, extension and all', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const docs = requireEngine(r.root);
    const withExt = docs.parseRef('patterns.md#orders');
    assert.strictEqual(withExt.domain, 'architecture');
    assert.strictEqual(withExt.file, 'references/patterns.md');
    assert.match(r.cli(['show', 'patterns.md#orders']).stdout, /ledgered before the payment call/, 'show resolves the .md spelling too');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('a second domain becomes readable by show without a watch.json in every old fixture', () => {
  const r = repo({
    files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' },
    docs: { 'references/patterns.md': PATTERNS },
  });
  try {
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/code-style/CODE-STYLE.md', section('csharp', '*.cs', 'Style rule.'));
    assert.match(r.cli(['show', 'patterns#orders']).stdout, /ledgered before the payment call/, 'architecture stays readable with no watch.json of its own');
    assert.match(r.cli(['show', 'CODE-STYLE#csharp']).stdout, /Style rule\./, 'code-style is readable too, via the bare key match - domain-qualified show/set/toc is a later task');
  } finally { r.rm(); }
});

// Fix round 2 (task-2-fix-review.md): findFile shares parseRef's collision refusal, the grandfather
// clause is one place so every entry point agrees, the not-found hint names distinguishable candidates,
// and resetDomains gets a real caller.

test('a cross-domain filename collision refuses the write instead of picking the alphabetically-first domain', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    r.write('.claude/docs/architecture/NOTES.md', setText('orders', 'orders', 'Architecture text.'));
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/code-style/NOTES.md', setText('orders', 'orders', 'Style text.'));
    const out = r.cli(['set', 'NOTES#orders'], setText('orders', 'orders', 'STYLE TEXT THE AUTHOR MEANT FOR code-style.'));
    assert.strictEqual(out.status, 1, out.stdout);
    // findFile now delegates to parseRef (fix round 2), but set still calls it with the bare file key
    // alone (the id is split off first, same as always), so the refusal names only the file, same as before.
    assert.match(out.stdout, /NOTES is in architecture and code-style - name one, as <domain>\/NOTES/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/NOTES.md'), /STYLE TEXT/, 'architecture was not silently written');
    assert.doesNotMatch(r.read('.claude/docs/code-style/NOTES.md'), /STYLE TEXT/, 'code-style was not written either - the ref must be qualified');
  } finally { r.rm(); }
});

test('a watch-less architecture/ gives the same domain and file from every entry point', () => {
  // repo() never writes a watch.json unless a test does - this one deliberately never does.
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.domains(), ['architecture'], 'architecture counts without a watch.json of its own');
    const bare = docs.parseRef('patterns#orders');
    const qualified = docs.parseRef('architecture/references/patterns#orders');
    assert.strictEqual(bare.domain, 'architecture');
    assert.strictEqual(bare.file, 'references/patterns.md');
    assert.strictEqual(qualified.domain, 'architecture', 'the qualified spelling must not throw on the very installs that exist today');
    assert.strictEqual(qualified.file, 'references/patterns.md');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('a not-found ref names domain-qualified candidates in the Known list, not the same bare name twice', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    r.write('.claude/docs/architecture/NOTES.md', setText('orders', 'orders', 'Architecture text.'));
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/code-style/NOTES.md', setText('orders', 'orders', 'Style text.'));
    const out = r.cli(['show', 'nope#x']).stdout;
    assert.match(out, /Known: .*architecture\/NOTES.*code-style\/NOTES/);
  } finally { r.rm(); }
});

test('resetDomains clears the cache a fixture needs to see a domain added after the module was required', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    const docs = requireEngine(r.root);
    assert.deepEqual(docs.domains(), ['architecture']);
    r.write('.claude/docs/code-style/watch.json', '{}');
    assert.deepEqual(docs.domains(), ['architecture'], 'still cached, stale on purpose');
    docs.resetDomains();
    assert.deepEqual(docs.domains(), ['architecture', 'code-style'], 'fresh after the reset');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Task 3: the overlay carries the domain. A domain-qualified `set` used to be unreachable (findFile has no
// notion of a domain prefix), so a same-named file in two domains could never actually collide in the
// overlay before now - qualifying the ref is what makes the bug reachable at all.

test('two domains holding the same filename do not collide in the overlay', () => {
  const r = repo();
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/architecture/NOTES.md', '# Notes\n');
  r.write('.claude/docs/code-style/watch.json', '{}');
  r.write('.claude/docs/code-style/NOTES.md', '# Notes\n');
  try {
    r.git('switch', '-qc', 'feat/x');
    const archSet = r.cli(['set', 'architecture/NOTES#a'], 'architecture text.\n');
    assert.strictEqual(archSet.status, 0, archSet.stdout);
    const styleSet = r.cli(['set', 'code-style/NOTES#a'], 'style text.\n');
    assert.strictEqual(styleSet.status, 0, styleSet.stdout);
    const archOver = '.claude/docs/.branches/feat-x/architecture/NOTES/a.md';
    const styleOver = '.claude/docs/.branches/feat-x/code-style/NOTES/a.md';
    assert.ok(r.exists(archOver), 'architecture keeps its own overlay path');
    assert.ok(r.exists(styleOver), 'code-style keeps a distinct overlay path, not overwriting architecture\'s');
    assert.match(r.read(archOver), /architecture text\./);
    assert.match(r.read(styleOver), /style text\./);
  } finally { r.rm(); }
});

test('promote folds two domains independently and removes the whole branch overlay', () => {
  const r = repo();
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/architecture/NOTES.md', '# Notes\n');
  r.write('.claude/docs/code-style/watch.json', '{}');
  r.write('.claude/docs/code-style/NOTES.md', '# Notes\n');
  try {
    r.git('switch', '-qc', 'feat/two-domains');
    r.write('src/marker.txt', 'x\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'work on feat/two-domains');
    assert.strictEqual(r.cli(['set', 'architecture/NOTES#a'], 'architecture text.\n').status, 0);
    assert.strictEqual(r.cli(['set', 'code-style/NOTES#a'], 'style text.\n').status, 0);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/two-domains');
    const out = r.cli(['promote', '--merged']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(r.read('.claude/docs/architecture/NOTES.md'), /architecture text\./);
    assert.match(r.read('.claude/docs/code-style/NOTES.md'), /style text\./);
    assert.ok(!r.exists('.claude/docs/.branches/feat-two-domains'), 'the whole branch overlay is gone once every domain folded');
  } finally { r.rm(); }
});

// Fix round 2 (task-3-review.md): promoteLocked composed a mainline path from rel[0] with no check that
// it named a real domain, or that the composed file was actually that domain's own. Two shapes an
// overlay written before this task (or before domains existed at all) can have on disk.

// A hand-written overlay skips set(), so it must also hand-write the BASE.json set() would have written -
// mergedBranches() reads it to know the branch exists and what its tip was, regardless of the overlay's
// own shape underneath.
function writeBaseMeta(r, dir, branch, base, head) {
  r.write(`${dir}/BASE.json`, `${JSON.stringify({ branch, base, head, files: {}, updated: new Date().toISOString() }, null, 2)}\n`);
}

test('promote migrates a pre-domain overlay with no domain segment into the grandfathered architecture domain', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/pre-domain');
    const base = r.git('rev-parse', 'HEAD');
    r.write('src/marker.txt', 'x\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'work');
    const head = r.git('rev-parse', 'HEAD');
    // The shape overlayParts produced before this task: straight to the relKey, no leading domain
    // segment at all - the only shape possible before domains existed, since 'architecture' was the
    // whole engine.
    r.write('.claude/docs/.branches/feat-pre-domain/references/patterns/paging.md', '### paging\n<!-- id: paging -->\nTwelve rows.\n');
    r.write('.claude/docs/.branches/feat-pre-domain/.base/references/patterns/paging.md', '');
    writeBaseMeta(r, '.claude/docs/.branches/feat-pre-domain', 'feat/pre-domain', base, head);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/pre-domain');
    const out = r.cli(['promote', '--merged']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /patterns#paging: added/);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /Twelve rows\./, 'folded into the real file, not left invisible');
    assert.ok(!r.exists('.claude/docs/.branches/feat-pre-domain'), 'the overlay is gone once its only entry folded');
  } finally { r.rm(); }
});

test('promote refuses a stranded overlay that would otherwise fold into a decoy file, and keeps its text', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' } });
  // A file sitting at the docs ROOT, owned by no domain - what a domain's own root file (e.g.
  // architecture/ASSESSMENT.md) decays into once read with a domain segment that no longer resolves
  // (Task 10 moves exactly this file to quality/ASSESSMENT.md).
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/ASSESSMENT.md', '# Assessment\nExisting content, never touched by docs.js.\n');
  try {
    r.git('switch', '-qc', 'feat/stray');
    const base = r.git('rev-parse', 'HEAD');
    r.write('src/marker.txt', 'x\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'work');
    const head = r.git('rev-parse', 'HEAD');
    // Hand-written: set() always writes the new, domain-qualified shape now, so this is what an overlay
    // from before domains existed - or one whose domain later moved - looks like on disk, its segment
    // coinciding with an unrelated file's name.
    r.write('.claude/docs/.branches/feat-stray/ASSESSMENT/brand-new.md', '## brand new\n<!-- id: brand-new -->\nBranch text that must not be lost.\n');
    r.write('.claude/docs/.branches/feat-stray/.base/ASSESSMENT/brand-new.md', '');
    writeBaseMeta(r, '.claude/docs/.branches/feat-stray', 'feat/stray', base, head);
    r.git('switch', '-q', 'develop');
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/stray');
    const out = r.cli(['promote', '--merged']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /conflict/, 'reported, not silently folded');
    assert.doesNotMatch(r.read('.claude/docs/ASSESSMENT.md'), /Branch text that must not be lost/, 'the decoy file at the docs root was never written to');
    assert.ok(r.exists('.claude/docs/.branches/feat-stray/ASSESSMENT/brand-new.md'), 'the branch text is kept, not deleted, while its domain cannot be resolved');
    assert.match(r.read('.claude/docs/.branches/feat-stray/ASSESSMENT/brand-new.md'), /Branch text that must not be lost/);
  } finally { r.rm(); }
});

// Fix round 2 (task-3-fix-review.md, finding 2): the rescue must move the override, its .base twin and
// any .conflict twin onto the domain-qualified shape, not just redirect `mainline` - otherwise a
// migrated overlay's own conflict marker lands under the legacy rel, where writeInPlace (which always
// builds a marker path from overlayParts, domain-qualified) never looks, and the documented resolve -
// set the section on mainline - silently does nothing.
test("a migrated overlay's conflict marker lands where writeInPlace looks, so resolving it on mainline clears it", () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': ORDERS('The cap is 5.') } });
  try {
    r.git('switch', '-qc', 'feat/legacy');
    const base = r.git('rev-parse', 'HEAD');
    r.write('src/marker.txt', 'x\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'work');
    const head = r.git('rev-parse', 'HEAD');
    // The pre-domain shape (no leading domain segment), with a base that still matches what mainline
    // held when the branch forked.
    r.write('.claude/docs/.branches/feat-legacy/references/patterns/orders.md', ORDERS('The cap is 10.'));
    r.write('.claude/docs/.branches/feat-legacy/.base/references/patterns/orders.md', ORDERS('The cap is 5.'));
    writeBaseMeta(r, '.claude/docs/.branches/feat-legacy', 'feat/legacy', base, head);
    r.git('switch', '-q', 'develop');
    // Mainline changes the same section before the merge, so the migrated fold lands as a genuine
    // conflict, not a clean add.
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.')).status, 0);
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/legacy');
    const first = r.cli(['promote', '--merged']);
    assert.match(first.stdout, /patterns#orders: conflict/);
    assert.ok(r.exists('.claude/docs/.branches/feat-legacy/architecture/references/patterns/orders.md'), 'the override itself moved under architecture/, not just the mainline pointer');
    assert.ok(!r.exists('.claude/docs/.branches/feat-legacy/references/patterns/orders.md'), 'the legacy override file itself is gone, renamed rather than copied');
    assert.ok(r.exists('.claude/docs/.branches/feat-legacy/.base/architecture/references/patterns/orders.md'), 'the .base twin moved too');
    assert.ok(!r.exists('.claude/docs/.branches/feat-legacy/.base/references/patterns/orders.md'), 'the legacy .base file itself is gone');
    const resolved = r.cli(['set', 'patterns#orders'], ORDERS('The cap is 20.'));
    assert.match(resolved.stdout, /resolved the pending doc conflict with: feat-legacy/, 'writeInPlace found the marker where the migration put it');
    assert.ok(!r.exists('.claude/docs/.branches/feat-legacy'), 'the whole overlay is gone once its only conflict resolves');
  } finally { r.rm(); }
});

// MAJOR: set's own collision refusal recommends a <domain>/<file>#<id> spelling; every reader must
// accept it too, not just set.

test('show, toc and hash resolve a domain-qualified ref the same way set already does', () => {
  const r = repo();
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/architecture/NOTES.md', '# Notes\n');
  r.write('.claude/docs/code-style/watch.json', '{}');
  r.write('.claude/docs/code-style/NOTES.md', '# Notes\n');
  try {
    assert.strictEqual(r.cli(['set', 'code-style/NOTES#style'], 'style text.\n').status, 0);
    assert.match(r.cli(['show', 'code-style/NOTES#style']).stdout, /style text\./, 'show accepts the spelling set recommends');
    assert.match(r.cli(['toc', 'code-style/NOTES']).stdout, /NOTES#style/, 'toc accepts it too');
    const h = r.cli(['hash', 'code-style/NOTES#style']);
    assert.strictEqual(h.status, 0, h.stdout);
    assert.match(h.stdout.trim(), /^[0-9a-f]{12}$/, 'hash resolves the qualified ref instead of failing to find the section');
  } finally { r.rm(); }
});

// MINOR: findFile's tiered search (an exact relKey match wins outright, the basename tier never even
// runs) and parseRef's merged search (relKey or basename, either counts) must not disagree.

test('a bare ref that resolves by relKey in one domain and by basename in another is a refused collision under both show and set, not a silent tier pick', () => {
  const r = repo();
  r.write('.claude/docs/architecture/watch.json', '{}');
  r.write('.claude/docs/architecture/references/patterns.md', PATTERNS);
  r.write('.claude/docs/code-style/watch.json', '{}');
  r.write('.claude/docs/code-style/patterns.md', section('csharp', '*.cs', 'Style rule.'));
  try {
    // 'patterns' matches code-style/patterns.md by an exact relKey and architecture/references/patterns.md
    // only by basename. Before this fix, findFile's tiering took the exact-relKey match and never looked
    // at architecture's file at all - a silent pick in the one tier findFile's own collision check does
    // not cover. Both entry points must refuse now, naming both domains.
    // show never sets a nonzero exit code on a refusal (same as the pre-existing 'no such doc file' case
    // above) - only its stdout carries the message, so only stdout is asserted here.
    const shown = r.cli(['show', 'patterns#csharp']);
    assert.match(shown.stdout, /patterns is in architecture and code-style - name one/);
    const written = r.cli(['set', 'patterns#csharp'], setText('csharp', 'csharp', 'x'));
    assert.strictEqual(written.status, 1, written.stdout);
    assert.match(written.stdout, /patterns is in architecture and code-style - name one/);
  } finally { r.rm(); }
});

test('changedSince reports both sides of a staged rename', () => {
  const r = repo({ files: { 'src/Api/Old.cs': 'class Old {}\n' } });
  try {
    const engine = requireEngine(r.root);
    const snap = engine.snapshot();
    r.git('mv', 'src/Api/Old.cs', 'src/Api/New.cs');
    const changed = engine.changedSince(snap);
    assert.ok(changed.files.includes('src/Api/Old.cs'), `expected Old.cs in ${JSON.stringify(changed.files)}`);
    assert.ok(changed.files.includes('src/Api/New.cs'), `expected New.cs in ${JSON.stringify(changed.files)}`);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('lint: a watch entry missing sections and a newModule missing globs are both reported; a complete watch.json lints clean', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'root', globs: ['src/*/Program.cs'] }],
      newModule: { sections: ['patterns#users'] },
    }));
    const broken = r.cli(['lint']);
    assert.strictEqual(broken.status, 1);
    assert.match(broken.stdout, /watch\.json watch\[0\]\.sections is missing/);
    assert.match(broken.stdout, /watch\.json newModule\.globs is missing/);

    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
      newModule: { globs: ['src/*/Features/*/'], sections: ['patterns#users'] },
    }));
    const clean = r.cli(['lint']);
    assert.strictEqual(clean.status, 0, clean.stdout);
    assert.doesNotMatch(clean.stdout, /is missing/);
  } finally { r.rm(); }
});

// Task 6b review, finding 1 (BLOCKER): a watch entry naming a section of a file its OWN domain declares
// notOwned is the intended shape for a decisions domain - askRef alone can never see a protected file (it
// is excluded from domainFiles, which is what makes the write refusal hold), so lint used to false-flag
// every such entry as missing. protectedRef(e.domain, id) is the same fallback resolveHit already applies
// for the runtime ask; lint must accept it too, or every decisions/ install fails on a clean checkout. A
// genuinely missing section - one neither askRef nor protectedRef can find - must still fail.
test('lint accepts a watch entry naming a protected section, and still fails one naming a genuinely missing one', () => {
  const r = repo({ docs: {} });
  try {
    r.write('.claude/docs/decisions/DECISIONS.md', '## Refund sync\n<!-- id: refund-sync -->\nRefunds are synced nightly.\n');
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      notOwned: ['DECISIONS.md'],
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#refund-sync'] }],
    }));
    const clean = r.cli(['lint']);
    assert.strictEqual(clean.status, 0, clean.stdout);
    assert.doesNotMatch(clean.stdout, /names a section that does not exist/, clean.stdout);

    r.write('.claude/docs/decisions/watch.json', JSON.stringify({
      notOwned: ['DECISIONS.md'],
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['DECISIONS#nope'] }],
    }));
    const broken = r.cli(['lint']);
    assert.strictEqual(broken.status, 1);
    assert.match(broken.stdout, /decisions\/watch\.json 'composition root' names a section that does not exist: DECISIONS#nope/);
  } finally { r.rm(); }
});

// Task 4: each domain's watch.json is read on its own - loadWatch/watchHits no longer read one
// docs-root-wide file.

test('two domains each watch their own globs; a changed file hits only its own domain, and hits carry the domain', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n', 'style/Linter.cs': 'x\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
    }));
    r.write('.claude/docs/code-style/watch.json', JSON.stringify({
      watch: [{ kind: 'linter', globs: ['style/*.cs'], sections: ['CODE-STYLE#csharp'] }],
    }));
    r.write('.claude/docs/code-style/CODE-STYLE.md', section('csharp', '*.cs', 'Style rule.'));
    const text = r.cli(['watch', 'src/Api/Program.cs', 'style/Linter.cs']).stdout;
    assert.match(text, /composition root: src\/Api\/Program\.cs -> patterns#orders/);
    assert.match(text, /linter: style\/Linter\.cs -> CODE-STYLE#csharp/);
    const docs = requireEngine(r.root);
    const hits = docs.watchHits(['src/Api/Program.cs', 'style/Linter.cs']);
    assert.strictEqual(hits.find((h) => h.kind === 'composition root').domain, 'architecture');
    assert.strictEqual(hits.find((h) => h.kind === 'linter').domain, 'code-style');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('an empty watch.json is a domain that watches nothing; a malformed watch.json in one domain does not break its neighbour', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
    }));
    r.write('.claude/docs/related-projects/watch.json', '{}');
    const docs = requireEngine(r.root);
    const hits = docs.watchHits(['src/Api/Program.cs']);
    assert.deepEqual(hits.filter((h) => h.domain === 'related-projects'), [], 'an empty watch.json watches nothing');
    assert.strictEqual(hits.find((h) => h.domain === 'architecture').sections[0], 'patterns#orders', 'its neighbour still hits normally');

    r.write('.claude/docs/related-projects/watch.json', '{ not json');
    // watchOf is cached per domain (finding 4 of the fix round) - resetDomains is the same escape hatch
    // that already clears DOMAINS_CACHE for a fixture that changes the docs root after require().
    docs.resetDomains();
    const stillHits = docs.watchHits(['src/Api/Program.cs']);
    assert.strictEqual(stillHits.find((h) => h.domain === 'architecture').sections[0], 'patterns#orders', 'a malformed watch.json beside it does not break architecture');
    const problems = docs.lint().problems;
    assert.match(problems.join('\n'), /related-projects\/watch\.json is not valid JSON/);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('watchOf is cached per domain: once warm, a repeated parseRef call reads no watch.json again', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    r.write('.claude/docs/code-style/watch.json', '{}');
    const docs = requireEngine(r.root);
    docs.parseRef('patterns#orders'); // warm the cache: domainFiles -> notOwnedOf -> watchOf, per domain
    const before = fs.readFileSync;
    let calls = 0;
    fs.readFileSync = (...a) => { if (String(a[0]).endsWith('watch.json')) calls++; return before(...a); };
    try {
      for (let i = 0; i < 5; i++) docs.parseRef('patterns#orders');
    } finally { fs.readFileSync = before; }
    assert.strictEqual(calls, 0, `expected no watch.json reads once warm (measured pre-cache: 5 reads per parseRef call), got ${calls}`);
    docs.resetDomains();
    let after = 0;
    fs.readFileSync = (...a) => { if (String(a[0]).endsWith('watch.json')) after++; return before(...a); };
    try { docs.parseRef('patterns#orders'); } finally { fs.readFileSync = before; }
    assert.ok(after > 0, 'resetDomains clears the watch cache too, or a fixture that rewrites watch.json after require() would go stale');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('lint resolves a domain-qualified sections entry through parseRef, not a bare-id set membership check', () => {
  const r = repo({ files: { 'src/Api/Program.cs': 'app.Run();\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['architecture/references/patterns#orders'] }],
    }));
    const clean = r.cli(['lint']);
    assert.strictEqual(clean.status, 0, clean.stdout);
    assert.doesNotMatch(clean.stdout, /names a section that does not exist/);

    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['architecture/references/patterns#nope'] }],
    }));
    const broken = r.cli(['lint']);
    assert.strictEqual(broken.status, 1);
    assert.match(broken.stdout, /watch\.json 'composition root' names a section that does not exist: architecture\/references\/patterns#nope/);
  } finally { r.rm(); }
});

test('set refuses a file the domain declares notOwned, naming the file and not the id', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'NOTES.md': '## Notes\n<!-- id: notes -->\nEditorial notes.\n' } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    const out = r.cli(['set', 'architecture/NOTES#notes'], 'rewritten by the engine\n');
    assert.strictEqual(out.status, 1, out.stdout);
    assert.match(out.stdout, /NOTES\.md is maintained by another skill - this engine does not write it/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/NOTES.md'), /rewritten by the engine/, 'nothing was written');
    // notOwned also keeps the file out of the corpus entirely - never sectioned, never a lint target.
    const docs = requireEngine(r.root);
    assert.ok(!docs.docFiles().some((f) => f.endsWith('NOTES.md')), 'a notOwned file is not in the domain\'s own files');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('ORIENTATION.md stays refused under the same notOwned mechanism, with no notOwned entry declared', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS, 'ORIENTATION.md': 'o'.repeat(10) } });
  try {
    r.write('.claude/docs/architecture/watch.json', '{}');
    const out = r.cli(['set', 'architecture/ORIENTATION#x'], 'new text\n');
    assert.strictEqual(out.status, 1, out.stdout);
    assert.match(out.stdout, /ORIENTATION\.md is maintained by another skill - this engine does not write it/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/ORIENTATION.md'), /new text/);
  } finally { r.rm(); }
});

// --- task-4-review.md fix round: worst finding first ---

// Finding 1 (MEDIUM): askRef matched a section by `${key(file)}#${sec}` alone, which is basename-scoped -
// two domains sharing a references/ basename (ordinary: every domain owns one) let a domain-qualified
// watch.json entry resolve into the WRONG domain's file, and lint blessed it.
test('a domain-qualified sections entry never resolves through a same-basename file in another domain', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['architecture/references/patterns#users'] }],
    }));
    r.write('.claude/docs/code-style/watch.json', '{}');
    // code-style owns a references/patterns.md of its own with the section architecture's watch.json names -
    // same basename, different domain, the shape this plan's own ledger calls ordinary.
    r.write('.claude/docs/code-style/references/patterns.md', section('users', 'src/Api/Users/**', 'Users are soft-deleted, never removed.'));
    const out = r.cli(['lint']);
    assert.strictEqual(out.status, 1, out.stdout);
    assert.match(out.stdout, /watch\.json 'composition root' names a section that does not exist: architecture\/references\/patterns#users/);
  } finally { r.rm(); }
});

// Same fixture, read through the module directly: proves show and askRef now agree (the review's other
// proof - hash disagreeing with show for the same ref).
test('askRef and show agree on a domain-qualified ref, even when another domain shares its basename', () => {
  const r = repo({ docs: { 'references/patterns.md': section('orders', 'src/Api/Orders/**', 'Refunds are ledgered before the payment call.') } });
  try {
    r.write('.claude/docs/code-style/watch.json', '{}');
    r.write('.claude/docs/code-style/references/patterns.md', section('users', 'src/Api/Users/**', 'Users are soft-deleted, never removed.'));
    const docs = requireEngine(r.root);
    assert.strictEqual(docs.askRef('architecture/references/patterns#users'), null, 'architecture does not have this section - askRef must not borrow code-style\'s');
    assert.match(docs.show('code-style/references/patterns#users'), /soft-deleted/, 'it still resolves on the domain that actually owns it');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// A section served from a BRANCH OVERLAY has s.from pointing at the overlay file, not the mainline file -
// the reviewer's own one-clause suggestion (`x.from === file`) would silently stop askRef from resolving
// any overridden section. Proves the fix taken here (`x.file`, which parse() sets once to the mainline
// file and sections() never reassigns) still resolves one.
test('askRef still resolves a section overridden on a branch (from is the overlay path, file is not)', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/x');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], '## orders\n<!-- id: orders -->\nRefunds are ledgered at midnight.\n').status, 0);
    const docs = requireEngine(r.root);
    const ref = docs.askRef('architecture/references/patterns#orders');
    assert.ok(ref, 'an overridden section must still resolve, not just a mainline one');
    assert.match(ref.first, /ledgered at midnight/, 'and it reads the branch override, not the mainline text under it');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Finding 2 (MEDIUM): declaring notOwned on a file that already carries a branch overlay orphans that
// overlay silently - nothing on disk is lost, but show/status/lint all go quiet and promote's own `why`
// names three causes, none of which is this one, with advice that cannot work for it.
test('declaring notOwned on a file that already has a branch overlay orphans it visibly, not silently', () => {
  const r = repo({ docs: { 'NOTES.md': '## Notes\n<!-- id: notes -->\nEditorial notes.\n' } });
  try {
    r.git('switch', '-qc', 'feat/notes');
    assert.strictEqual(r.cli(['set', 'NOTES#notes'], 'Branch-local notes.\n').status, 0);
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    assert.ok(r.exists('.claude/docs/.branches/feat-notes/architecture/NOTES/notes.md'), 'nothing is destroyed on disk');

    const lintOut = r.cli(['lint']);
    assert.match(lintOut.stdout, /NOTES\.md.*notOwned/i, 'lint names the orphaned overlay - where a person would look');

    const promoteOut = r.cli(['promote', 'feat/notes']);
    assert.match(promoteOut.stdout, /notOwned/i, "promote's why names the real cause");
    assert.doesNotMatch(promoteOut.stdout, /move the text under the right domain by hand, then promote again/, 'advice that cannot work for a notOwned file is not given for this cause');
  } finally { r.rm(); }
});

// Finding 3 (LOW): the good refusal fired only on the domain-qualified spelling (parseRef can name a
// domain for it explicitly) - a bare ref to the same file never resolves a domain at all, because
// parseRef's own domain search runs over domainFiles, which already excludes a notOwned file. The bare
// spelling is what docs-session.js documents to users and what every pre-domain ref uses.
test('the notOwned refusal reaches the bare spelling too, not only the domain-qualified one', () => {
  const r = repo({ docs: { 'NOTES.md': '## Notes\n<!-- id: notes -->\nEditorial notes.\n', 'ORIENTATION.md': 'o'.repeat(10) } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    const notes = r.cli(['set', 'NOTES#notes'], 'rewritten by the engine\n');
    assert.strictEqual(notes.status, 1, notes.stdout);
    assert.match(notes.stdout, /NOTES\.md is maintained by another skill - this engine does not write it/);

    const orientation = r.cli(['set', 'ORIENTATION#x'], 'new text\n');
    assert.strictEqual(orientation.status, 1, orientation.stdout);
    assert.match(orientation.stdout, /ORIENTATION\.md is maintained by another skill - this engine does not write it/);
  } finally { r.rm(); }
});

// --- task-4-review.md, second pass: two residuals fixed rather than parked ---

// Residual 1: parseRef strips a trailing '.md' before it ever reaches domainFiles' lookup, but
// notOwnedMatch (set's own bare-ref path, since a notOwned file is excluded from domainFiles and
// parseRef can therefore never name a domain for it) appended '.md' onto the UNSTRIPPED fileKey - so
// 'NOTES.md' became the candidate 'NOTES.md.md', which never matches the declared 'NOTES.md'. The bare
// spelling ('NOTES#notes') and the domain-qualified spelling ('architecture/NOTES.md#notes', which
// never reaches notOwnedMatch at all) both worked; only bare-plus-'.md' fell through - and that is the
// spelling docs-session.js:221 documents to the reader as equivalent to the other two.
test('the notOwned refusal reaches the bare-plus-.md spelling too, not only bare and domain-qualified', () => {
  const r = repo({ docs: { 'NOTES.md': '## Notes\n<!-- id: notes -->\nEditorial notes.\n' } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    const out = r.cli(['set', 'NOTES.md#notes'], 'rewritten by the engine\n');
    assert.strictEqual(out.status, 1, out.stdout);
    assert.match(out.stdout, /NOTES\.md is maintained by another skill - this engine does not write it/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/NOTES.md'), /rewritten by the engine/, 'nothing was written');
  } finally { r.rm(); }
});

// Found by the temp-project matrix, not by a unit test: notOwnedMatch matched a GLOB against a bare
// name without ever asking whether that file exists. A decisions domain ships `notOwned: ["**.md"]` -
// the catch-all spelling its own doc-shape reference pins, because ADR filenames are unbounded - and
// that glob matches ANY bare name, so every ref that resolved no domain came back 'is maintained by
// another skill' instead of 'no such doc file'. Two costs, both measured on a temp project: `set` and
// `show` gave contradictory answers about the same missing file in one run, and a typo of a real doc
// name ('ARCHITECTUR#modules') was reported protected rather than missing - which tells a writer to
// stop instead of retrying the spelling, silently dropping the rewrite a finish ask had just asked for.
// A notOwned file is one domainFiles EXCLUDED, so it exists on disk by definition; requiring that is
// what keeps the refusal to the files it was written for. protectedRef already makes the same check.
test('a catch-all notOwned glob never claims a file that does not exist - the bare ref still says no such doc file', () => {
  const r = repo({ docs: { 'ARCHITECTURE.md': '## modules\n<!-- id: modules -->\nOne module per feature.\n' } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ sourceRoots: ['src'] }));
    r.write('.claude/docs/decisions/0001-refunds.md', '# 0001\n\n## refunds\n<!-- id: refunds -->\nRefunds stay synchronous.\n');
    r.write('.claude/docs/decisions/watch.json', JSON.stringify({ notOwned: ['**.md'] }));
    for (const ref of ['NOSUCHFILE#x', 'ARCHITECTUR#modules', 'NOSUCHFILE.md#x']) {
      const out = r.cli(['set', ref], 'text\n');
      assert.strictEqual(out.status, 1, `${ref} should still be refused: ${out.stdout}`);
      assert.match(out.stdout, /no such doc file/, `${ref} is missing, not protected: ${out.stdout}`);
      assert.doesNotMatch(out.stdout, /maintained by another skill/, `${ref} must not be reported as protected`);
    }
    // the same run's `show` agrees, which is the inconsistency this exists to stop
    assert.match(r.cli(['show', 'NOSUCHFILE#x']).stdout, /no such doc file/, 'show and set must give one answer');
    // and the protection itself is untouched: the file that DOES exist is still refused, every spelling
    for (const ref of ['0001-refunds#refunds', 'decisions/0001-refunds#refunds', '0001-refunds.md#refunds']) {
      const out = r.cli(['set', ref], 'QUEUE THEM NOW\n');
      assert.strictEqual(out.status, 1, `${ref}: ${out.stdout}`);
      assert.match(out.stdout, /maintained by another skill - this engine does not write it/, ref);
    }
    assert.doesNotMatch(r.read('.claude/docs/decisions/0001-refunds.md'), /QUEUE THEM NOW/, 'the decision was never written');
    // a domain-QUALIFIED ref into the protected domain still refuses whether or not the file exists:
    // there the caller named the domain, so 'this engine does not write it' answers the real question.
    assert.match(r.cli(['set', 'decisions/0002-new-adr#x'], 'a new ADR\n').stdout, /maintained by another skill/, 'creating an ADR through the engine stays refused');
  } finally { r.rm(); }
});

// Residual 2: watchOf(domain) is exported and cached (WATCH_CACHE) - the object it returns, and every
// array reachable from it, IS the cached value, not a view of it. unowned() (also exported) hands back
// watchOf(domain).notOwned directly. Before the fix, a caller that pushed, sorted or spliced any of
// these arrays corrupted every later read of that domain in the same process - including the notOwned
// refusal the two tests above depend on. Frozen once per domain at cache-write time (not on every read,
// so the caching two rounds of review paid for stays paid for): a mutation attempt now throws instead of
// silently landing, and every field watchOf exposes (sourceRoots, watch - and its nested globs/sections -
// newModule, notOwned) is covered by the same recursive freeze, not just notOwned.
test('watchOf and unowned hand back frozen structures: a caller cannot push, sort or splice into the cache', () => {
  const r = repo({ docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({
      sourceRoots: ['src'],
      watch: [{ kind: 'composition root', globs: ['src/*/Program.cs'], sections: ['patterns#orders'] }],
      notOwned: ['ZZZ.md', 'NOTES.md'],
    }));
    const docs = requireEngine(r.root);
    const notOwned = docs.unowned('architecture');
    assert.deepEqual(notOwned, ['ZZZ.md', 'NOTES.md']);
    assert.throws(() => notOwned.push('EVIL.md'), TypeError, 'unowned() must not hand back a growable array');
    assert.throws(() => notOwned.sort(), TypeError, 'sort reorders in place, which a frozen array must refuse too');
    assert.throws(() => notOwned.splice(0, 1), TypeError);

    const w = docs.watchOf('architecture');
    assert.throws(() => w.watch.push({ kind: 'evil', globs: ['*'], sections: ['x'] }), TypeError, "watchOf's other fields are exposed the same way - not gold-plated, actually reachable through loadWatch");
    assert.throws(() => w.watch[0].globs.push('**'), TypeError, 'a nested array reachable through the cached object is frozen too');
    assert.throws(() => w.sourceRoots.push('evil'), TypeError);

    // The cache is provably unaffected by every attempt above: the next read is byte-for-byte what the first was.
    assert.deepEqual(docs.unowned('architecture'), ['ZZZ.md', 'NOTES.md'], 'a mutation attempt on one read must not reach the next');
    assert.deepEqual(docs.watchOf('architecture').watch[0].globs, ['src/*/Program.cs']);
    assert.deepEqual(docs.watchOf('architecture').sourceRoots, ['src']);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// --- Task 6b: a protected file can still be QUOTED, read-only, for the warning docs-session.js builds ---

test('protectedRef quotes a section of a file its own domain declares notOwned, and set against it is still refused', () => {
  const r = repo({ docs: { 'NOTES.md': section('note', '', 'A person wrote this decision by hand.') } });
  try {
    r.write('.claude/docs/architecture/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    const docs = requireEngine(r.root);
    const ref = docs.protectedRef('architecture', 'NOTES#note');
    assert.ok(ref, 'a protected file must still resolve through the read-only route');
    assert.strictEqual(ref.heading, 'note');
    assert.match(ref.first, /A person wrote this decision by hand\./);
    assert.strictEqual(ref.file, '.claude/docs/architecture/NOTES.md');
    // Still excluded from domainFiles - the read route is separate from the mechanism the write refusal
    // depends on, not a widening of it.
    assert.ok(!docs.docFiles().some((f) => f.endsWith('NOTES.md')), 'a notOwned file stays out of domainFiles');
    const out = r.cli(['set', 'architecture/NOTES#note'], 'rewritten by the engine\n');
    assert.strictEqual(out.status, 1, out.stdout);
    assert.match(out.stdout, /NOTES\.md is maintained by another skill - this engine does not write it/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/NOTES.md'), /rewritten by the engine/, 'still nothing written');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('protectedRef never resolves a different domain\'s file, protected or not, and a wrongly-domain-qualified ref finds nothing', () => {
  const r = repo();
  try {
    r.write('.claude/docs/alpha/watch.json', JSON.stringify({ notOwned: ['NOTES.md'] }));
    r.write('.claude/docs/alpha/NOTES.md', section('note', '', 'Alpha decision text.'));
    r.write('.claude/docs/beta/watch.json', '{}');
    r.write('.claude/docs/beta/NOTES.md', section('note', '', 'Beta text.'));
    const docs = requireEngine(r.root);
    assert.strictEqual(docs.protectedRef('beta', 'NOTES#note'), null, 'beta does not declare NOTES.md notOwned - nothing to warn about under beta');
    assert.strictEqual(docs.protectedRef('beta', 'alpha/NOTES#note'), null, 'a ref qualified for a domain other than the one asked never resolves');
    const ref = docs.protectedRef('alpha', 'NOTES#note');
    assert.match(ref.first, /Alpha decision text/, 'only alpha\'s own copy resolves when alpha is asked');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// --- the seams the final whole-branch review found ---

// One `git hash-object` per dirty file is one PROCESS per file. Stop runs changedSince at the end of every turn
// until a watch entry hits, so this is the per-turn floor of a session whose tree is dirty.
test('a dirty tree costs one batched hash, never one git process per file', () => {
  const files = {};
  for (let i = 0; i < 200; i++) files[`src/Api/T${i}.cs`] = `class T${i} {}\n`;
  const r = repo({ files, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const engine = requireEngine(r.root);
    for (let i = 0; i < 200; i++) r.write(`src/Api/T${i}.cs`, `class T${i} { int x; }\n`);
    for (let i = 0; i < 200; i++) r.write(`src/Api/U${i}.cs`, `class U${i} {}\n`);
    const t0 = Date.now();
    const snap = engine.snapshot();
    r.write('src/Api/T0.cs', 'class T0 { int y; }\n');
    const changed = engine.changedSince(snap);
    const ms = Date.now() - t0;
    assert.strictEqual(Object.keys(snap.dirty).length, 400, 'every dirty and untracked path is snapshotted');
    assert.ok(changed.files.includes('src/Api/T0.cs'), `expected T0.cs among ${changed.files.length} changed files`);
    assert.ok(!changed.files.includes('src/Api/T1.cs'), 'a file that did not move is not reported');
    assert.ok(ms < 2500, `400 dirty files took ${ms}ms - one git hash-object per file (measured 6.4s at 400, 13.2s at 800, past the wired 10s hook timeout, which kills the end-of-session ask)`);
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

test('the batched hash answers exactly what one hash-object per file answers', () => {
  const r = repo({ files: { 'src/Api/Kept.cs': 'class Kept {}\n', 'src/Api/Gone.cs': 'class Gone {}\n' } });
  try {
    const engine = requireEngine(r.root);
    r.write('src/Api/New.cs', 'class New {}\n');
    fs.rmSync(path.join(r.root, 'src', 'Api', 'Gone.cs'));
    const paths = ['src/Api/Kept.cs', 'src/Api/New.cs', 'src/Api/Gone.cs', 'src/Api/Kept.cs'];
    const batched = engine.blobsOf(paths);
    for (const p of paths) assert.strictEqual(batched.get(p), engine.blobOf(p), `${p} hashes the same either way`);
    assert.strictEqual(batched.get('src/Api/Gone.cs'), '-', 'a path that is gone never reaches git');
    assert.strictEqual(batched.size, 3, 'a repeated path is hashed once');
  } finally { delete require.cache[ENGINE_PATH]; r.rm(); }
});

// Two sessions starting on mainline at the same moment each read the doc file before either writes: one
// promoted section is lost and BOTH overlays are deleted, so that branch's text is gone for good.
test('promote does nothing while another promote holds the lock', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    r.write('.claude/docs/.branches/.promote.lock', '{"pid":1}\n');
    const out = r.cli(['promote', '--merged']);
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/, 'mainline is not written while the lock is held');
    assert.ok(r.exists('.claude/docs/.branches/feat-cap/architecture/references/patterns/orders.md'), 'the overlay survives a skipped promote');
    assert.match(out.stdout, /another promote is running/);
    fs.rmSync(path.join(r.root, '.claude', 'docs', '.branches', '.promote.lock'));
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/, 'the next run picks it up');
    assert.ok(!r.exists('.claude/docs/.branches/.promote.lock'), 'the lock is released');
  } finally { r.rm(); }
});

test('a stale lock left by a killed process never blocks a promote forever', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    branchWithDecision(r, 'feat/cap', ORDERS('Refunds are capped at 10.'));
    r.git('merge', '-q', '--no-ff', '-m', 'merge', 'feat/cap');
    const lock = path.join(r.root, '.claude', 'docs', '.branches', '.promote.lock');
    fs.writeFileSync(lock, '{"pid":1}\n');
    const old = (Date.now() - 10 * 60 * 1000) / 1000;
    fs.utimesSync(lock, old, old);
    assert.match(r.cli(['promote', '--merged']).stdout, /patterns#orders: merged/);
  } finally { r.rm(); }
});

// safe() folds both names onto '.branches/feature-login'. Without an owner check the second branch reads the
// first branch's decisions as its own, overwrites them, and a promote folds them in under the wrong name.
test('two branch names that collide under safe() never share one overlay', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feature/login');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Slash branch decision.')).status, 0);
    r.git('switch', '-q', 'develop');
    r.git('switch', '-qc', 'feature-login');
    assert.doesNotMatch(r.cli(['show', 'patterns#orders']).stdout, /Slash branch decision/, 'the dash branch reads mainline, not the slash branch');
    const st = r.cli(['status']).stdout;
    assert.match(st, /overrides: none/);
    assert.match(st, /feature\/login/, 'status names the branch that owns the directory');
    const w = r.cli(['set', 'patterns#orders'], ORDERS('Dash branch decision.'));
    assert.strictEqual(w.status, 1, 'the write is refused, never blended into the other branch');
    assert.match(w.stdout, /feature\/login/);
    assert.match(r.read('.claude/docs/.branches/feature-login/architecture/references/patterns/orders.md'), /Slash branch decision/, 'the owner keeps its text');
    r.git('switch', '-q', 'develop');
    const p = r.cli(['promote', 'feature-login']);
    assert.strictEqual(p.status, 1, 'promoting by the colliding live name is refused');
    assert.match(p.stdout, /feature\/login/);
  } finally { r.rm(); }
});

// The third pillar reads git. Without a repo it can never fire, and only the mode line can say so.
test('status says the end-of-session check is blind without git', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-nogit-')));
  try {
    fs.mkdirSync(path.join(root, '.claude', 'docs', 'architecture', 'references'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'docs', 'architecture', 'references', 'patterns.md'), PATTERNS);
    const out = spawnSync(process.execPath, [path.join(HOOKS, 'docs.js'), 'status'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: '.claude/docs', CLAUDE_DOCS_PATH: '' },
    });
    assert.strictEqual(out.status, 0);
    assert.match(out.stdout, /^mode: no git \(docs written in place; the end-of-session check cannot see what changed\)/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// Committing a docs root that used to be ignored flips tracked() - and every overlay under .branches/ becomes
// unreadable and unpromotable at once, with no word anywhere.
test('status reports overlays stranded by committing a previously ignored docs root', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    r.git('switch', '-qc', 'feat/cap');
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    assert.match(r.cli(['status']).stdout, /^mode: overlay/m);
    r.write('.gitignore', '.claude/docs/docs-log.jsonl\n.claude/docs/.branches/\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'commit the docs');
    const out = r.cli(['status']).stdout;
    assert.match(out, /^mode: git/m);
    assert.match(out, /stranded/);
    assert.match(out, /feat-cap/);
  } finally { r.rm(); }
});

// The only ledger in this stack that was not under <docs-path>: hook-blocks and tools-usage are both there,
// and a project that commits .claude/ accumulated this one in git.
test('the engine log lands under the docs root, beside hook-blocks', () => {
  const r = repo({ docsPath: 'docs', files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    assert.strictEqual(r.cli(['set', 'patterns#orders'], ORDERS('Refunds are capped at 10.')).status, 0);
    assert.ok(r.exists('docs/docs-log.jsonl'), 'the log is written under the docs root');
    assert.match(r.read('docs/docs-log.jsonl'), /"event":"doc-set"/);
    assert.ok(!r.exists('.claude/docs-log.jsonl'), 'and never under .claude/ any more');
  } finally { r.rm(); }
});

// ---- the lost update: two agents rewriting one section, the second silently winning ----
// The finish ask shows a section's current text, so `set` can carry the hash of what it was SHOWN; a mismatch
// refuses the write and hands the text that is there now over, instead of dropping the first rewrite.

test('the hash is content only, so a re-stamp is no lost update', () => {
  const GIT = { ALFRED_CODE_DOCS_VERSIONING: 'git' };
  const r = repo({ tracked: true, files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const before = r.cli(['hash', 'patterns#orders'], '', GIT).stdout.trim();
    assert.match(before, /^[0-9a-f]{12}$/, 'a short content hash');
    r.write('src/Api/Orders/Refund.cs', 'class Refund { int Cap; }\n');
    r.git('commit', '-qam', 'cap');
    // A new capture stamp, the same words: the stamp line moves on every write, and hashing it would refuse every
    // second agent for a change nobody made.
    assert.strictEqual(r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are ledgered before the payment call.'), GIT).status, 0);
    assert.strictEqual(r.cli(['hash', 'patterns#orders'], '', GIT).stdout.trim(), before, 'same words, same hash');
    assert.strictEqual(r.cli(['hash', 'patterns#nope'], '', GIT).status, 1, 'a section that is not there');
  } finally { r.rm(); }
});

test('set --expect writes when the section is still the text the hash was taken from', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const h = r.cli(['hash', 'patterns#orders']).stdout.trim();
    const out = r.cli(['set', 'patterns#orders', '--expect', h], setText('orders', 'orders', 'Refunds are capped at 10.'));
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/);
  } finally { r.rm(); }
});

test('set --expect refuses a stale rewrite and hands over the text that is there now', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const stale = r.cli(['hash', 'patterns#orders']).stdout.trim();
    // The first agent lands its rewrite.
    assert.strictEqual(r.cli(['set', 'patterns#orders'], setText('orders', 'orders', 'Refunds are ledgered AFTER the payment call.')).status, 0);
    // The second was shown the old text and must not overwrite what it never read.
    const out = r.cli(['set', 'patterns#orders', '--expect', stale], setText('orders', 'orders', 'Refunds are capped at 10.'));
    assert.strictEqual(out.status, 1, 'refused');
    assert.match(out.stdout, /patterns#orders changed while you were working - nothing was written\. Here it is now:/);
    assert.match(out.stdout, /ledgered AFTER the payment call/, 'the new text is handed over');
    assert.match(out.stdout, /--expect [0-9a-f]{12}/, 'with the hash to try again against');
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /capped at 10/, 'nothing was written');
  } finally { r.rm(); }
});

test('a section deleted under a waiting agent refuses too, and an empty hash is no check at all', () => {
  const r = repo({ files: { 'src/Api/Orders/Refund.cs': 'class Refund {}\n' }, docs: { 'references/patterns.md': PATTERNS } });
  try {
    const out = r.cli(['set', 'patterns#gone', '--expect', 'abcabcabcabc'], '## gone\n<!-- id: gone -->\nText.\n');
    assert.strictEqual(out.status, 1, 'a section the hash cannot belong to is never created blind');
    assert.match(out.stdout, /patterns#gone changed while you were working/);
    // `--expect` with its hash lost (a copy-paste, an empty shell variable, a truncated line) must REFUSE. Skipping
    // the compare there is the one path where a stale write lands while the writer believes it is guarded.
    const naked = r.cli(['set', 'patterns#orders', '--expect'], setText('orders', 'orders', 'Unguarded.'));
    assert.strictEqual(naked.status, 1, naked.stdout);
    assert.match(naked.stdout, /--expect needs a hash/);
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /Unguarded\./, 'and nothing was written');
    const empty = r.cli(['set', 'patterns#orders', '--expect', ''], setText('orders', 'orders', 'Also unguarded.'));
    assert.strictEqual(empty.status, 1, 'an explicitly empty hash is the same mistake');
    assert.doesNotMatch(r.read('.claude/docs/architecture/references/patterns.md'), /Also unguarded\./);
  } finally { r.rm(); }
});

// ADR numbering and the decision-log index (plan 4.13): `adr new '<title>'` allocates the next number under the docs
// root's decisions/, writes the record's skeleton and rewrites DECISIONS.md's index table from the record files.
const DEC = '.claude/docs/decisions';
const adrRecord = (num, title, status) => `# ADR-${num}: ${title}\n\n## Status\n${status}\n\n## Context\nForces.\n`;
const INDEX_HEAD = '| ADR | Title | Status |\n|---|---|---|\n';

test('adr new: an absent or empty decisions folder starts at 0001, writes the index and protects the records', () => {
  for (const setup of [() => {}, (r) => fs.mkdirSync(path.join(r.root, DEC), { recursive: true })]) {
    const r = repo({ docs: {} });
    try {
      setup(r);
      const out = r.cli(['adr', 'new', 'Use PostgreSQL']);
      assert.strictEqual(out.status, 0, out.stdout);
      assert.match(out.stdout, /created \.claude\/docs\/decisions\/0001-use-postgresql\.md/);
      const rec = r.read(`${DEC}/0001-use-postgresql.md`);
      assert.match(rec, /^# ADR-0001: Use PostgreSQL\n/);
      assert.match(rec, /\n## Status\nProposed\n/);
      assert.match(rec, /\n## Context\n[\s\S]*\n## Decision\n[\s\S]*\n## Consequences\n/);
      assert.match(r.read(`${DEC}/DECISIONS.md`), /\| ADR \| Title \| Status \|\n\|---\|---\|---\|\n\| \[0001\]\(0001-use-postgresql\.md\) \| Use PostgreSQL \| Proposed \|\n/);
      assert.deepStrictEqual(JSON.parse(r.read(`${DEC}/watch.json`)), { notOwned: ['**.md'] });
      // The seeded catch-all is what keeps a person's record out of `set`: the engine numbers records, never rewrites one.
      const set = r.cli(['set', 'decisions/0001-use-postgresql#status'], '## Status\nAccepted\n');
      assert.strictEqual(set.status, 1, set.stdout);
      assert.match(set.stdout, /maintained by another skill/);
    } finally { r.rm(); }
  }
});

test('adr new: the next number is one past the highest, and a gap is never refilled', () => {
  const r = repo({ docs: {} });
  try {
    r.write(`${DEC}/0001-first.md`, adrRecord('0001', 'First', 'Accepted'));
    r.write(`${DEC}/0003-third.md`, adrRecord('0003', 'Third', 'Accepted'));
    r.write(`${DEC}/notes.md`, 'Not a record.\n');
    assert.strictEqual(r.cli(['adr', 'new', 'Fourth']).status, 0);
    assert.ok(r.exists(`${DEC}/0004-fourth.md`), 'max + 1, the 0002 gap stays a gap');
    assert.ok(!r.exists(`${DEC}/0002-fourth.md`));
    const again = r.cli(['adr', 'new', 'Fifth']);
    assert.match(again.stdout, /0005-fifth\.md/);
    const index = r.read(`${DEC}/DECISIONS.md`);
    assert.match(index, /\[0001\][\s\S]*\[0003\][\s\S]*\[0004\][\s\S]*\[0005\]/, 'rows in number order');
    assert.doesNotMatch(index, /notes\.md/, 'a file without a number is no record');
  } finally { r.rm(); }
});

test('adr new: an existing index table is rewritten in place from the records, the text around it kept', () => {
  const r = repo({ docs: {} });
  try {
    r.write(`${DEC}/watch.json`, JSON.stringify({ notOwned: ['**.md'] }));
    r.write(`${DEC}/0001-refunds-sync.md`, adrRecord('0001', 'Refunds stay synchronous', 'Accepted'));
    const before = '# Decisions\n\nWhy we chose what we chose.\n\n';
    const after = '\n## Refund sync\n<!-- id: refund-sync -->\nRefunds are deliberately synchronous.\n';
    r.write(`${DEC}/DECISIONS.md`, `${before}${INDEX_HEAD}| [0001](0001-refunds-sync.md) | Refunds stay synchronous | Proposed |\n${after}`);
    const out = r.cli(['adr', 'new', 'Queue depth cap']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.match(out.stdout, /index rewritten: \.claude\/docs\/decisions\/DECISIONS\.md \(2 records\)/);
    assert.strictEqual(r.read(`${DEC}/DECISIONS.md`), `${before}${INDEX_HEAD}`
      + '| [0001](0001-refunds-sync.md) | Refunds stay synchronous | Accepted |\n'
      + '| [0002](0002-queue-depth-cap.md) | Queue depth cap | Proposed |\n'
      + after, 'the status comes from the record, and nothing outside the table moved');
    assert.ok(!out.stdout.includes('seeded'), 'an existing watch.json is left alone');
    // A status change in a record alone reaches the table through `adr index`.
    r.write(`${DEC}/0002-queue-depth-cap.md`, adrRecord('0002', 'Queue depth cap', 'Superseded by ADR-0003'));
    assert.strictEqual(r.cli(['adr', 'index']).status, 0);
    assert.match(r.read(`${DEC}/DECISIONS.md`), /\| \[0002\]\(0002-queue-depth-cap\.md\) \| Queue depth cap \| Superseded by ADR-0003 \|/);
    // A log with no table yet gets one above its first section, never inside it.
    r.write(`${DEC}/DECISIONS.md`, `# Decisions\n${after}`);
    assert.strictEqual(r.cli(['adr', 'index']).status, 0);
    assert.match(r.read(`${DEC}/DECISIONS.md`), /^# Decisions\n\n\| ADR \| Title \| Status \|\n[\s\S]*\| \[0002\][^\n]*\n\n## Refund sync\n/);
  } finally { r.rm(); }
});

test('adr new: a title that needs a slug keeps its words in the record and the index', () => {
  const r = repo({ docs: {} });
  try {
    const out = r.cli(['adr', 'new', 'Cache: Redis | "sessions" & carts (v2)!']);
    assert.strictEqual(out.status, 0, out.stdout);
    assert.ok(r.exists(`${DEC}/0001-cache-redis-sessions-carts-v2.md`), out.stdout);
    assert.match(r.read(`${DEC}/0001-cache-redis-sessions-carts-v2.md`), /^# ADR-0001: Cache: Redis \| "sessions" & carts \(v2\)!\n/);
    assert.match(r.read(`${DEC}/DECISIONS.md`), /\| Cache: Redis \\\| "sessions" & carts \(v2\)! \| Proposed \|/, 'a pipe in the title cannot split the row');
    assert.strictEqual(r.cli(['adr', 'new', 'Кеш сесій']).status, 0);
    assert.ok(r.exists(`${DEC}/0002-decision.md`), 'a title with nothing to slug still gets a file name');
    const bare = r.cli(['adr', 'new', '   ']);
    assert.strictEqual(bare.status, 1);
    assert.match(bare.stdout, /adr new needs a title/);
    assert.ok(!r.exists(`${DEC}/0003-decision.md`), 'nothing allocated without a title');
  } finally { r.rm(); }
});

test('adr new: a malformed index is left intact and reported, and the number is still taken', () => {
  const cases = [
    ['no rule row under the header', '| ADR | Title | Status |\n| [0001](0001-a.md) | A | Accepted |\n', /is not a \|---\|---\|---\| rule/],
    ['a row with the wrong cell count', `${INDEX_HEAD}| [0001](0001-a.md) | A |\n`, /2 cells, the index has 3/],
    ['a row naming no record', `${INDEX_HEAD}| [0001](0001-a.md) | A | Accepted |\n| [0009](0009-gone.md) | Gone | Accepted |\n`, /names 0009-gone\.md, which is not a record/],
    ['two index tables', `${INDEX_HEAD}| [0001](0001-a.md) | A | Accepted |\n\n${INDEX_HEAD}`, /2 index tables/],
  ];
  for (const [what, table, reason] of cases) {
    const r = repo({ docs: {} });
    try {
      r.write(`${DEC}/0001-a.md`, adrRecord('0001', 'A', 'Accepted'));
      const index = `# Decisions\n\n${table}`;
      r.write(`${DEC}/DECISIONS.md`, index);
      const out = r.cli(['adr', 'new', 'B']);
      assert.strictEqual(out.status, 1, `${what}: ${out.stdout}`);
      assert.match(out.stdout, /created \.claude\/docs\/decisions\/0002-b\.md/, what);
      assert.match(out.stdout, /index NOT rewritten/, what);
      assert.match(out.stdout, reason, what);
      assert.strictEqual(r.read(`${DEC}/DECISIONS.md`), index, `${what}: left byte for byte`);
      assert.ok(r.exists(`${DEC}/0002-b.md`), `${what}: the record is written`);
    } finally { r.rm(); }
  }
});

// A provisional ORIENTATION.md (plan 4.12) is the first-look scan's output, not a capture: every reader treats it as
// stale by definition. Written here by the scan itself, so the marker the scan prints and the one the engine keys on
// cannot drift apart unnoticed.
const SCAN = path.join(__dirname, 'scan-evidence.js');
test('a provisional ORIENTATION.md is stale by definition: status, stale and lint say so', () => {
  const r = repo({ files: { 'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n', 'src/Api/Program.cs': 'app.Run();\n' } });
  try {
    assert.match(r.cli(['status']).stdout, /^orientation: none$/m);
    const scan = spawnSync(process.execPath, [SCAN, '--orientation', '--root', r.root, '--out', path.join(r.root, '.claude/docs/architecture/ORIENTATION.md')], { encoding: 'utf8' });
    assert.strictEqual(scan.status, 0, scan.stderr);
    assert.match(r.cli(['status']).stdout, /^orientation: provisional - a first-look scan, stale by definition until the architecture capture replaces it$/m);
    assert.match(r.cli(['stale']).stdout, /^architecture\/ORIENTATION\.md - provisional: stale by definition until the architecture capture replaces it$/m);
    const lint = r.cli(['lint']);
    assert.strictEqual(lint.status, 0, lint.stdout);
    assert.match(lint.stdout, /note {4}ORIENTATION\.md is provisional/);
    r.write('.claude/docs/architecture/ORIENTATION.md', 'Api -> Domain. `src/Api/Program.cs` starts it.\n');
    assert.match(r.cli(['status']).stdout, /^orientation: captured$/m);
    assert.doesNotMatch(r.cli(['stale']).stdout, /provisional/);
  } finally { r.rm(); }
});

// verifyBlock read `src/...` anywhere in a path, so `web/src/main.ts` was checked as `src/main.ts` and reported missing.
test('lint checks a path the orientation names from its first segment only', () => {
  const r = repo({ files: { 'web/src/main.ts': 'x\n', 'src/Api/Program.cs': 'x\n' }, docs: { 'ORIENTATION.md': 'Entry: `web/src/main.ts`, `src/Api/Program.cs`, `src/Api/Gone.cs`.\n' } });
  try {
    const out = r.cli(['lint']).stdout;
    assert.doesNotMatch(out, /does not exist: src\/main\.ts/, out);
    assert.match(out, /names a path that does not exist: src\/Api\/Gone\.cs/, 'a real miss still fails');
    assert.doesNotMatch(out, /does not exist: src\/Api\/Program\.cs/);
  } finally { r.rm(); }
});

test('every git child process a hook or engine starts carries a timeout (2.1.5 M2)', () => {
  // A stalled git in the docs engine used to hold the whole shell-guard dispatcher past its budget, and a
  // timed-out hook lets the call through. Each call is read from `'git'` to the end of its options object.
  const open = [];
  for (const f of fs.readdirSync(HOOKS).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(HOOKS, f), 'utf8');
    for (const m of src.matchAll(/(?:execFileSync|spawnSync|execSync)\(\s*'git'/g)) {
      const end = src.indexOf('})', m.index);
      const call = src.slice(m.index, end < 0 ? m.index + 400 : end + 2);
      if (!/\btimeout\s*:/.test(call)) open.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepStrictEqual(open, [], 'git calls with no timeout');
});
