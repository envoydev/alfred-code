#!/usr/bin/env node
// Behavior tests for guard-read-whole-file.js and guard-cross-project-write.js, written from family
// E of the 154-bundle audit. Every case here was REPLAYED live on the shipped hook before the fix,
// so each pins a real regression - a false positive that blocked honest work and taught the model a
// bypass, or a remedy that could not be run. Both directions carry equal weight: the shape that was
// wrongly blocked passes now, and the dump or the out-of-tree write the gate exists for still blocks.
'use strict';
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite({ ownTmp: true }); // audit 2026-10-08: its hooks' tmp state stays in a dir of its own
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const READ = path.join(HOOKS, 'guard-read-whole-file.js');
const XWRITE = path.join(HOOKS, 'guard-cross-project-write.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-rw-'));
// Every guard appends a block row to `<root>/<docs-path>/hook-blocks/`, where the root falls back to
// the process cwd - so a suite run from this checkout would forge field ledger into the repo's own
// docs root (measured once at 12,480 rows). Pin a scratch root and an absolute ledger for the whole
// run; the cases that need a different root pass one of their own.
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
process.env.ALFRED_CODE_DOCS_PATH = path.join(TMP, 'ledger');
const ROOT = process.env.CLAUDE_PROJECT_DIR;

const run = (hook, payload, opts) => spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', ...opts });
const bash = (hook, command, opts) => run(hook, { tool_name: 'Bash', tool_input: { command } }, opts);
const ctxOf = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ''; } };
const sid = () => `rw-${Math.random().toString(36).slice(2)}`;
// The announcement is once per rule per SESSION, so every case names the session it spends.
// Run in the scratch root unless a case anchors elsewhere: the hook reads what is installed from the CWD's
// `.claude/rules` too, and this checkout's holds only the repo's own rules since 2.1.6 (no convention rule),
// so a run left at the checkout's cwd announced nothing - red here and in CI.
const announce = (command, session_id, hook = READ, opts = { cwd: ROOT }) => ctxOf(run(hook, { tool_name: 'Bash', tool_input: { command }, session_id }, opts));
const LONG_JS = 'const a = 1;\n'.repeat(500); // over the 400-line threshold

test('guard-read-whole-file: the convention rule is announced for the WRITE TARGET, never for an executed script or a 2>/dev/null', () => {
  // 5 findings in 5 bundles, three defects in one announcer: `2>/dev/null` tested TRUE as 'a
  // redirection into a path' on a read-only `find` / `ls`, and the EXECUTED script's own extension
  // named javascript-conventions.md for `node <snapshot>/stamp-compare.js > out.txt` - a command
  // whose only write target was a .txt, in a project holding no JS at all. The announcement is
  // spent once per rule per session, so a false fire costs the real write that follows it.
  const s = sid();
  assert.equal(announce("find . -name '*.cs' -type f 2>/dev/null", s), '', 'a stderr redirect writes no file a rule covers');
  assert.equal(announce('ls -la src/*.cs 2>/dev/null', s), '', 'nor does a listing');
  assert.equal(announce(`node ${path.join(TMP, 'repo', 'scripts', 'stamp-compare.js')} --json > ${path.join(TMP, 'out.txt')}`, s), '',
    'the EXECUTED script is not the write target - the .txt is');
  assert.equal(announce('node scripts/analyze-usage.js --window 200000 > rollup.txt', s), '', 'the analyzer naming its own path announces nothing');
  assert.equal(announce('grep -rn "IOrderService" src/Api/Orders.cs', s), '', 'a read was never a touch');
  // ... and the write itself still announces, on the target and on nothing else
  assert.match(announce("sed -i '' 's/a/b/' src/Api/Orders.cs", s), /csharp-conventions\.md/, 'an in-place edit of a .cs file');
  assert.match(announce('cp build/out.js dist/app.js', s), /javascript-conventions\.md/, 'a copy DESTINATION is a write');
  assert.match(announce('tee CHANGELOG.md < in', s), /markdown-docs\.md/, 'a tee target too');
  const s2 = sid();
  const ng = announce('printf x > src/app/user-profile.ts', s2);
  assert.match(ng, /angular-conventions\.md/, 'a redirect target under src/app names the Angular rule');
  assert.match(ng, /typescript-conventions\.md/, '... and the TypeScript baseline beside it');
});

test('guard-read-whole-file: a shell write to a skill file names the skill-authoring rule, a project skill under .claude included', () => {
  // Twin of skill-authoring.md's `paths:` - a run authoring a skill through the shell gets no attach
  // until it uses a file tool, so the hook names the rule on the first shell write, as it does for
  // every other convention rule. The markdown rule still attaches beside it on a tracked skill file.
  const both = announce("sed -i '' 's/a/b/' stack/skills/foo/SKILL.md", sid());
  assert.match(both, /skill-authoring\.md/, 'a SKILL.md edit');
  assert.match(both, /markdown-docs\.md/, 'the markdown rule on the same touch');
  assert.match(announce('printf x > skills/foo/references/api.md', sid()), /skill-authoring\.md/, 'a reference under a skill');
  // `.claude/skills/` is where a project keeps its own skills - authoring there is skill writing, even
  // though the markdown rule leaves the install's own tree alone.
  const own = announce('printf x > .claude/skills/mine/SKILL.md', sid());
  assert.match(own, /skill-authoring\.md/, 'a project skill under .claude');
  assert.doesNotMatch(own, /markdown-docs\.md/, 'the markdown rule still leaves .claude alone');
  assert.doesNotMatch(announce('printf x > README.md', sid()), /skill-authoring/, 'a plain doc is not a skill');
  assert.doesNotMatch(announce('printf x > docs/skills.md', sid()), /skill-authoring/, 'nor a doc that is only named for skills');
  assert.equal(announce('printf x > .claude/docs/notes.md', sid()), '', 'the install tree outside a skill stays silent');
  // The glob is case-SENSITIVE: a lowercase skill.md outside a skills/ folder is no skill file, and a
  // backup copy is not SKILL.md.
  assert.doesNotMatch(announce('printf x > docs/demo/skill.md', sid()), /skill-authoring/, 'a lowercase skill.md is not SKILL.md');
  assert.doesNotMatch(announce('cp stack/skills/foo/SKILL.md stack/skills/foo/SKILL.md.bak', sid()), /skill-authoring/, 'nor is a .bak copy');
});

test('guard-read-whole-file: a .md under .claude or the docs root names no OTHER rule - the carve-out lifts for skill files only', () => {
  // Review I1: the carve-out once dropped every such .md target before ANY rule was matched. Scoping
  // it to markdown-docs alone let a docs note whose NAME carries another rule's pattern spend that
  // rule's once-per-session announcement, so the real write later got nothing.
  assert.equal(announce('printf x > .claude/docs/related-context/next.js-upgrade.md', sid()), '', 'a docs note named for a .js file');
  assert.equal(announce('printf x > .claude/docs/architecture/references/Dockerfile.md', sid()), '', 'a docs page named for a Dockerfile');
  const committedRoot = { env: { ...process.env, ALFRED_CODE_DOCS_PATH: 'docs' } };
  assert.equal(announce('printf x > docs/architecture/Dockerfile.md', sid(), READ, committedRoot), '', 'a committed docs root too');
  const skill = announce('printf x > .claude/skills/csharp/references/x.cs.md', sid());
  assert.match(skill, /skill-authoring\.md/, 'a skill file under .claude still names the skill rule');
  assert.doesNotMatch(skill, /csharp-conventions\.md/, '... and no other');
  // ... while the same names outside those trees still announce their rules
  assert.match(announce('printf x > .claude/hooks/local-check.js', sid()), /javascript-conventions\.md/, 'a non-.md write under .claude still announces');
});

test('guard-read-whole-file: only a rule this install actually has is announced', () => {
  // One measured bundle was told to read `.claude/rules/javascript-conventions.md` in a project
  // that holds 0 JS files and never installed that rule. The hook's own sibling directory IS the
  // install's rules dir (`.claude/hooks/` -> `.claude/rules/`), so what is installed is knowable.
  const install = fs.mkdtempSync(path.join(TMP, 'install-'));
  fs.mkdirSync(path.join(install, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(install, '.claude', 'rules'), { recursive: true });
  const hook = path.join(install, '.claude', 'hooks', 'guard-read-whole-file.js');
  fs.copyFileSync(READ, hook);
  fs.writeFileSync(path.join(install, '.claude', 'rules', 'csharp-conventions.md'), '# csharp\n');
  const s = sid();
  // The hook reads the install's rules dir from its own sibling AND from the anchors - the project
  // dir and the CWD - so the fixture only answers the question when the run is anchored IN it. Left
  // at this checkout's cwd the case reads THIS repo's `.claude/rules`, which on a stack-installed
  // checkout holds every convention rule (measured 2026-09-22: red here, green in CI).
  const at = { cwd: install, env: { ...process.env, CLAUDE_PROJECT_DIR: install } };
  assert.match(announce("sed -i '' 's/a/b/' src/Api/Orders.cs", s, hook, at), /csharp-conventions\.md/, 'the rule this install has');
  assert.equal(announce('cp x.js dist/app.js', s, hook, at), '', 'the one it does not is never named');
  // with no rules directory at all nothing can be told, and the announcement is made rather than dropped
  assert.match(announce('cp x.js dist/app.js', sid()), /javascript-conventions\.md/, "this repo's own stack/rules is the sibling dir here");
});

// The benchmark pilot (2026-09-26): a plugin-launched hook announced `winforms-conventions.md` to a project that
// never installed it. On the plugin route the hook's sibling `../rules` is the PLUGIN's stack/rules - the whole
// catalog - so every convention rule read as installed. Only the project's own `.claude/rules` says what it has.
test('guard-read-whole-file: a plugin-launched hook reads the project\'s rules, never the plugin catalog beside it', () => {
  const cache = fs.mkdtempSync(path.join(TMP, 'plugin-'));
  fs.mkdirSync(path.join(cache, 'stack', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(cache, 'stack', 'rules'), { recursive: true });
  const hook = path.join(cache, 'stack', 'hooks', 'guard-read-whole-file.js');
  fs.copyFileSync(READ, hook);
  for (const r of ['winforms-conventions.md', 'csharp-conventions.md']) fs.writeFileSync(path.join(cache, 'stack', 'rules', r), '# rule\n');
  const project = fs.mkdtempSync(path.join(TMP, 'project-'));
  fs.mkdirSync(path.join(project, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude', 'rules', 'csharp-conventions.md'), '# csharp\n');
  const at = { cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project } };
  const said = announce("sed -i '' 's/a/b/' src/MainForm.cs", sid(), hook, at);
  assert.match(said, /csharp-conventions\.md/, 'the rule the project has');
  assert.doesNotMatch(said, /winforms-conventions\.md/, 'the catalog\'s other rule is never named');
});

test('guard-read-whole-file: a shell loop ENDS at its own done - a later cat is not the loop body', () => {
  // ~88k tokens per block, twice: the capabilities skill's own grep-only inventory loop followed by
  // `; cat .mcp.json` was denied as a whole-file markdown sweep, because the sweep pattern's
  // `[^\n]*?` ran straight past `done` and read the unrelated cat as the loop's body.
  const loop = `for f in ${ROOT}/.claude/skills/*/SKILL.md; do printf '%s|%s\\n' "$(grep -m1 '^name:' "$f" | cut -d' ' -f2-)" "$(grep -m1 '^description:' "$f" | cut -c1-160)"; done`;
  assert.equal(bash(READ, `${loop}; cat .mcp.json`).status, 0, "the skill's own inventory loop plus an unrelated cat");
  assert.equal(bash(READ, `${loop} && cat package.json`).status, 0, 'and with && between them');
  assert.equal(bash(READ, `${loop}`).status, 0, 'the loop alone always passed');
  // the sweep itself still blocks - inside the loop body, whatever follows the done
  assert.equal(bash(READ, 'for f in .claude/skills/*/SKILL.md; do cat "$f"; done').status, 2, 'a cat INSIDE the loop is the sweep');
  assert.equal(bash(READ, 'for f in src/*.cs; do cat -n "$f"; done; echo ok').status, 2, '... and a statement after the done does not excuse it');
  assert.equal(bash(READ, 'find . -name "*.cs" -exec cat {} +').status, 2, 'find -exec cat is untouched by the change');
});

test('guard-read-whole-file: no serena remedy for a path serena is seeded to ignore', () => {
  // Two bundles: the denial named serena for a path under `.claude/`, which both installer twins
  // seed into serena's OWN ignored_paths, so the redirect the model made from it errored. A remedy
  // that cannot run is worse than none - it costs the round trip and teaches the block is noise.
  const inClaude = path.join(ROOT, '.claude', 'hooks', 'local-hook.js');
  fs.mkdirSync(path.dirname(inClaude), { recursive: true });
  fs.writeFileSync(inClaude, LONG_JS);
  const r = run(READ, { tool_name: 'Read', tool_input: { file_path: inClaude } });
  assert.equal(r.status, 2, 'the whole-file read is still blocked');
  // M30: the hook's remedy line is the plugin spelling - the old `select:mcp__serena` pattern matched nothing any hook (mcp-fixture)
  // writes, so it could never fail (the ordinary-path case below proves this pattern does match a real remedy).
  assert.doesNotMatch(r.stderr, /ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__/, 'but no tools that cannot index this tree');
  assert.match(r.stderr, /ignored_paths/, 'the denial says why');
  assert.match(r.stderr, /grep -n/, 'and gives a remedy that works there');
  const inSerena = path.join(ROOT, '.serena', 'cache', 'big.ts');
  fs.mkdirSync(path.dirname(inSerena), { recursive: true });
  fs.writeFileSync(inSerena, LONG_JS);
  assert.doesNotMatch(run(READ, { tool_name: 'Read', tool_input: { file_path: inSerena } }).stderr, /ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__/,
    "serena's own tree either");
  // The data root (ALFRED_CODE_DATA_PATH, default .alfred) holds serena's own home and the browser profiles:
  // seeded into ignored_paths too, so no navigation remedy there either - the default and a custom root alike.
  for (const [root, env] of [['.alfred', {}], ['.data', { ALFRED_CODE_DATA_PATH: '.data' }]])
  {
    const inData = path.join(ROOT, root, 'serena', 'home', 'big.ts');
    fs.mkdirSync(path.dirname(inData), { recursive: true });
    fs.writeFileSync(inData, LONG_JS);
    const d = run(READ, { tool_name: 'Read', tool_input: { file_path: inData } }, { env: { ...process.env, ...env } });
    assert.equal(d.status, 2, root);
    assert.doesNotMatch(d.stderr, /ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__/, `no navigation remedy under ${root}`);
    assert.match(d.stderr, /grep -n/, root);
  }
  // ... and an ordinary source path still gets the whole ladder, loading call included
  const src = path.join(ROOT, 'src', 'big.ts');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, LONG_JS);
  const ok = run(READ, { tool_name: 'Read', tool_input: { file_path: src } });
  assert.equal(ok.status, 2);
  assert.match(ok.stderr, /ToolSearch select:mcp__plugin_alfred-navigation_alfred-navigation__get_symbols_overview/, 'the serena ladder is unchanged where it works');
});

test('guard-read-whole-file: an oversized binary or minified file is answered with PAGING, not a grep', () => {
  // Verified live: the non-gated big-file branch printed the grep + offset remedy for ANY oversized
  // file, a 93KB PNG included, where neither applies - 2 wasted calls. This branch judges SIZE, not
  // language, so it has to say what to do with bytes that have no lines.
  const dir = fs.mkdtempSync(path.join(TMP, 'big-'));
  // audit 2026-10-08: a rendered image (PNG, JPEG, GIF, WebP) is no longer here - the model is sent its pixels, at most
  // 4,784 visual tokens (platform.claude.com/docs/en/build-with-claude/vision), never its bytes; see the screenshot case.
  const blob = path.join(dir, 'store.bin');
  fs.writeFileSync(blob, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), Buffer.alloc(70 * 1024, 7)]));
  const b = run(READ, { tool_name: 'Read', tool_input: { file_path: blob } });
  assert.equal(b.status, 2, 'still blocked - a whole Read of it spends its whole size on context');
  assert.match(b.stderr, /head -c 2000/, 'paging, capped');
  assert.doesNotMatch(b.stderr, /grep -n '<pattern>'/, 'never a line-based remedy on bytes with no lines');
  const min = path.join(dir, 'bundle.min.css');
  fs.writeFileSync(min, `.a{color:red}${'.b{color:blue}'.repeat(5000)}`);
  const m = run(READ, { tool_name: 'Read', tool_input: { file_path: min } });
  assert.equal(m.status, 2);
  assert.match(m.stderr, /binary or minified/, 'one 70KB line is minified - an offset+limit Read answers nothing on it');
  // ... and a large TEXT file keeps the grep remedy, which is the right one there
  const notes = path.join(dir, 'persisted-output.txt');
  fs.writeFileSync(notes, 'a line of ordinary output\n'.repeat(4000));
  const t = run(READ, { tool_name: 'Read', tool_input: { file_path: notes } });
  assert.equal(t.status, 2);
  assert.match(t.stderr, /grep -n '<pattern>'/, 'a spilled text output is grepped, as before');
  assert.equal(run(READ, { tool_name: 'Read', tool_input: { file_path: notes, offset: 1, limit: 50 } }).status, 0, 'a ranged read passes');
});

test('audit 2026-10-08: a screenshot Read and a PDF Read naming its pages pass; any extension case is gated', () => {
  // The issue-diagnoser reads a screenshot, and a rendered image costs its pixels (at most 4,784 visual tokens,
  // platform.claude.com/docs/en/build-with-claude/vision) - every PNG over 60KB was blocked, and so was a paged PDF.
  const dir = fs.mkdtempSync(path.join(TMP, 'shots-'));
  const read = (file_path, extra = {}) => run(READ, { tool_name: 'Read', tool_input: { file_path, ...extra } }).status;
  for (const name of ['shot.png', 'photo.JPG', 'anim.gif', 'pic.webp']) {
    fs.writeFileSync(path.join(dir, name), Buffer.alloc(100 * 1024, 1));
    assert.equal(read(path.join(dir, name)), 0, `${name}: a rendered image`);
  }
  fs.writeFileSync(path.join(dir, 'doc.pdf'), Buffer.alloc(100 * 1024, 1));
  assert.equal(read(path.join(dir, 'doc.pdf'), { pages: '1-2' }), 0, 'a PDF read by its pages is a range');
  assert.equal(read(path.join(dir, 'doc.pdf')), 2, 'a whole one is still its whole size');
  // hooks review 2026-10-16: the Read tool pages a PDF itself - one of 10 pages or fewer reads whole, a longer one is
  // sent to `pages`, never to the binary remedy
  const pdf = (n) => Buffer.concat([Buffer.from('%PDF-1.4\n'), ...Array.from({ length: n }, (_, i) => Buffer.from(`${i + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`)),
    Buffer.from('2 0 obj << /Type /Pages /Count 1 >> endobj\n'), Buffer.alloc(100 * 1024, 32)]);
  fs.writeFileSync(path.join(dir, 'short.pdf'), pdf(3));
  assert.equal(read(path.join(dir, 'short.pdf')), 0, 'a 3-page PDF reads whole');
  fs.writeFileSync(path.join(dir, 'long.pdf'), pdf(12));
  assert.equal(read(path.join(dir, 'long.pdf')), 2, 'a 12-page PDF is sent to its pages');
  fs.writeFileSync(path.join(dir, 'BIG.TS'), 'const a = 1;\n'.repeat(500));
  assert.equal(read(path.join(dir, 'BIG.TS')), 2, 'an upper-case extension is the same source file');
});

test('audit 2026-10-08: a span, an identity filter, a glob or a listing past the threshold is the dump it prints; a big file of any extension too', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'spans-'));
  fs.writeFileSync(path.join(dir, 'big.ts'), 'const a = 1;\n'.repeat(500));
  fs.writeFileSync(path.join(dir, 'big.md'), `${'word '.repeat(20)}\n`.repeat(1300));
  fs.mkdirSync(path.join(dir, 'skills', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'a', 'SKILL.md'), 'x\n');
  // audit 2026-10-20 C28: a glob is sized by what it expands to, so the skills sweep needs files past THRESHOLD in all
  fs.mkdirSync(path.join(dir, 'skills', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'b', 'SKILL.md'), 'line\n'.repeat(450));
  const sh = (command, tool_name = 'Bash') => run(READ, { tool_name, tool_input: { command }, session_id: sid(), cwd: dir },
    { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).status;
  for (const c of ['head -n 9999 big.ts', 'sed -n 1,99999p big.ts', 'tail -n +2 big.ts', 'cat big.ts | grep ""', 'cat big.ts | awk 1',
    'cat big.ts | head -n 9999', 'cat skills/*/SKILL.md', "cat $(find src -name '*.ts')", 'cat big.md'])
    assert.equal(sh(c), 2, c);
  assert.equal(sh('cat big.ts', 'Monitor'), 2, 'the Monitor tool runs its command under the shell route');
  assert.equal(sh('bash <<A\nbash <<B\nbash <<C\nbash <<D\nbash <<E\ncat big.ts\nE\nD\nC\nB\nA\n'), 2, 'a shell body nested past three levels is judged out of budget');
  for (const c of ['head -40 big.ts', 'head -n 150 big.ts', 'sed -n 1,100p big.ts', 'tail -n +400 big.ts', 'cat big.ts | head -40', 'cat big.ts | grep const',
    'cat big.md | jq .', 'head -n 5 skills/*/SKILL.md', 'cat big.md > copy.md', 'cat skills/a/SKILL.md'])
    assert.equal(sh(c), 0, c);
});

test('audit 2026-10-08: parallel ranged Reads cannot each pass the cumulative cap, and the cap follows the real path', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'par-')));
  const file = path.join(dir, 'big.ts');
  fs.writeFileSync(file, 'const a = 1;\n'.repeat(500));
  const { spawn } = require('node:child_process');
  const ranged = (session_id, file_path, offset) => new Promise((resolve) => {
    const p = spawn(process.execPath, [READ], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    p.on('exit', resolve);
    p.stdin.end(JSON.stringify({ session_id, cwd: dir, tool_name: 'Read', tool_input: { file_path, offset, limit: 125 } }));
  });
  for (let t = 0; t < 5; t++) {
    const session = sid();
    const codes = await Promise.all([1, 126, 251, 376].map((o) => ranged(session, file, o)));
    assert.ok(codes.includes(2), `trial ${t}: four parallel quarters all passed (${codes})`);
  }
  // the same file spelled through a link is the same file
  const link = path.join(TMP, `par-link-${sid()}`);
  fs.symlinkSync(dir, link, 'junction');
  const s = sid();
  assert.equal(await ranged(s, file, 1), 0);
  assert.equal(await ranged(s, path.join(link, 'big.ts'), 126), 0, 'half, through the link');
  assert.equal(await ranged(s, file, 251), 2, 'a third quarter of the same real file passes the cap');
});

test('guard-cross-project-write: a quote inside a $( ) substitution does not close the outer span', () => {
  // Replayed at exit 2: in `"$(grep -o 'Sdk="[^"]*"' <csproj>)"` the `"` INSIDE the substitution
  // closed the outer double-quote span, so every span after it flipped and the later
  // `sed 's/<OutputType>//'` read as a redirection to `//`. ~112k tokens re-sent on the retry.
  const other = fs.mkdtempSync(path.join(TMP, 'projB-'));
  const xp = (command) => run(XWRITE, { tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' } }).status;
  assert.equal(xp(`echo "$(grep -o 'Sdk="[^"]*"' app.csproj)" && sed 's/<OutputType>//' app.csproj`), 0, 'the replayed command');
  assert.equal(xp(`sed 's/<OutputType>//' app.csproj`), 0, 'the sed alone always passed');
  assert.equal(xp(`V="$(jq -r '.name' pkg.json)"; echo "$V" > out.txt`), 0, 'an in-project write after a substitution is ordinary work');
  // ... and the gate keeps its teeth: the inside of a substitution is SHELL, not text
  assert.equal(xp(`echo "$(grep -c '"' a.txt)" && echo x > ${path.join(other, 'f.txt')}`), 2,
    'a real out-of-tree redirect after a substitution still blocks');
  assert.equal(xp(`echo "$(cat a.txt > ${path.join(other, 'f.txt')})"`), 2,
    'and a write INSIDE the substitution is judged, not read as quoted prose');
  assert.equal(xp(`echo "a > ${path.join(other, 'f.txt')} is how you would do it"`), 0, 'while quoted PROSE is still prose');
});

test('guard-cross-project-write: a comment is not shell - an apostrophe in one never unbalances the quotes', () => {
  // Pilot 3 prep (2026-09-27): the source-protocol snippet init runs carries a comment with an apostrophe;
  // it flipped every quoted span after it, and `x=>/@(envoydev|...)` inside a single-quoted `node -e`
  // program read as a redirection to `/@`. Bash ignores a word that starts with `#`, so nothing in one
  // can write - but a real redirect on the next line is still judged.
  const other = fs.mkdtempSync(path.join(TMP, 'projC-'));
  const xp = (command) => run(XWRITE, { tool_name: 'Bash', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' } }).status;
  const md = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
  const snippet = [...md.matchAll(/```bash\n([\s\S]*?)```/g)][0][1];
  assert.match(snippet, /#[^\n]*'/, 'the shipped snippet still has a comment carrying an apostrophe');
  assert.equal(xp(snippet), 0, 'the shipped source-protocol snippet');
  assert.equal(xp(`true   # it's a note\nnode -e 'a.filter(x=>/@(y)$/.test(x))'`), 0, 'the minimal shape');
  assert.equal(xp(`true # > ${path.join(other, 'f.txt')}`), 0, 'a redirect inside a comment writes nothing');
  assert.equal(xp(`true # it's a note\necho x > ${path.join(other, 'f.txt')}`), 2, 'a real redirect after a comment still blocks');
  assert.equal(xp(`echo "# not a comment" > ${path.join(other, 'f.txt')}`), 2, 'a # inside quotes is text, and the redirect after it is real');
  assert.equal(xp(`echo a#b > ${path.join(other, 'f.txt')}`), 2, 'a # inside a word is no comment');
  assert.equal(xp(`echo \${#X} > ${path.join(other, 'f.txt')}`), 2, 'a length expansion is no comment');
});

test('guard-cross-project-write: a PowerShell <# #> block comment ends at #>, and blanking never hides more than base did', () => {
  // Review A, M1: a `#` after `<` started a line comment, so `<# note #> echo x > <outside>` lost its redirect on the
  // PowerShell route (denied at base). A block comment is blanked as its own span; a `#` after `<` starts no line comment.
  const other = fs.mkdtempSync(path.join(TMP, 'projD-'));
  const target = path.join(other, 'f.txt');
  const ps = (command) => run(XWRITE, { tool_name: 'PowerShell', tool_input: { command } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' } }).status;
  assert.equal(ps(`<# note #> echo x > ${target}`), 2, 'the redirect after an inline block comment is judged');
  assert.equal(ps(`<# a note\n   over two lines #>\necho x > ${target}`), 2, 'a block comment over several lines ends at #>');
  assert.equal(ps(`<# it's a note > ${target} #>\necho ok`), 0, 'a redirect INSIDE the block comment writes nothing');
  // Bash ANSI-C quoting: `$'it\'s # x'` is ONE quoted word, so the `#` in it starts no comment - the command
  // reaches the quote parse exactly as it did at base, nothing blanked.
  const { scanShell } = require('../stack/hooks/shell-writes.js');
  const ansi = `echo $'it\\'s # x' > ${target}`;
  assert.strictEqual(scanShell(ansi).command, ansi, 'an ANSI-C string blanks nothing');
});

test('guard-read-whole-file: a shell write to any delivery surface devops-conventions.md covers names that rule (2.1.5 audit M73)', () => {
  // Twin of the rule's own `paths:`: the deploy scripts it always globbed, plus the pipeline and env
  // template families the audit added - a shell-only run gets no attach, so this is its one reminder.
  for (const target of ['scripts/deploy.sh', 'ops/deploy-prod.ps1', '.github/actions/setup/action.yml', 'ci/.github/actions/x/action.yaml',
    'azure-pipelines.yml', 'build/azure-pipelines-release.yaml', '.gitlab-ci.yml', '.env.example', 'api/.env.template', 'config/prod.env.template'])
    assert.match(announce(`printf x > ${target}`, sid()), /devops-conventions\.md/, target);
  for (const target of ['src/deployment.ts', 'notes/deploy.md', '.env', 'src/actions/action.yml.bak'])
    assert.doesNotMatch(announce(`printf x > ${target}`, sid()), /devops-conventions\.md/, target);
});

test('the Git Bash mount-path translation has ONE home, shell-writes.js, which every path-resolving guard requires (2.1.5 M8)', () => {
  // It was inlined in five guards and pinned as a shared rule on the premise that 'each hook is a standalone
  // file with no shared module' - shell-writes.js, hook-prelude.js and hidden-chars.js are exactly such modules.
  const sw = require(path.join(HOOKS, 'shell-writes.js'));
  assert.strictEqual(path.win32.normalize(sw.nativePath('/c/Users/a/x.ts', 'win32')), 'C:\\Users\\a\\x.ts', 'a drive mount');
  assert.strictEqual(path.win32.normalize(sw.nativePath('/cygdrive/d/work', 'win32')), 'D:\\work', 'a Cygwin mount');
  assert.strictEqual(sw.nativePath('/c/Users/a', 'darwin'), '/c/Users/a', 'off Windows the spelling is a real POSIX path');
  assert.strictEqual(sw.nativePath('/usr/local', 'win32'), '/usr/local', 'a longer first segment is no drive');
  for (const f of ['guard-config-protection', 'guard-cross-project-write', 'guard-secret-value', 'guard-read-whole-file', 'guard-ungated-commit']) {
    const src = fs.readFileSync(path.join(HOOKS, `${f}.js`), 'utf8');
    assert.doesNotMatch(src, /const MOUNT_RE =/, `${f} keeps no inline copy`);
    assert.match(src, /nativePath \} = require\([^)]*shell-writes\.js'\)\)/, `${f} requires it`);
  }
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'shared-rules.json'), 'utf8'));
  assert.ok(!JSON.stringify(rules).includes('"gitbash-mount-path"'), 'the pin that held the copies together is retired');
});

// A letter-case flip of every letter in a path (`/Users/a` -> `/uSERS/A`), the spelling a case-insensitive
// filesystem accepts for the same directory.
const flipCase = (p) => p.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));

test('guard-cross-project-write: a path spelled in another letter case is still inside the project (2.1.5 M9)', (t) => {
  // The JS realpathSync keeps the case it is given, so `c:\...\proj\x.ts` against a root spelled `C:\...` read as
  // outside - on Windows, and on a default (case-insensitive) macOS volume alike. realpathSync.native returns the
  // on-disk case. Judged only where the filesystem folds case: on a case-sensitive one the flip IS another path.
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'CaseProj-')));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  const flipped = flipCase(path.join(proj, 'src'));
  // A case-sensitive filesystem has nothing to fold: reported as a skip, never as a pass that judged nothing.
  if (!fs.existsSync(flipped)) { t.skip('case-sensitive filesystem - the flipped spelling is another path'); return; }
  const write = (file, env = {}) => run(XWRITE, { tool_name: 'Write', tool_input: { file_path: file, content: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '', ...env } }).status;
  assert.equal(write(path.join(flipped, 'a.ts')), 0, 'an existing folder in another case is the same folder');
  assert.equal(write(path.join(flipped, 'new', 'b.ts')), 0, 'and so is a new file below it');
  const other = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'CaseOther-')));
  assert.equal(write(path.join(flipCase(other), 'c.ts')), 2, 'a sibling in any case is still outside');
});

test('guard-cross-project-write: on Windows an allowance and a target compare without case (2.1.5 M9)',
  { skip: process.platform !== 'win32' && 'the lower-case compare is the win32 branch - it runs on windows-latest' }, () => {
  // A folder that does not exist yet has no on-disk case to read back, so the compare itself folds case on win32.
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'WinProj-')));
  const other = path.join(fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'WinOther-'))), 'Not', 'Yet');
  const write = (file, env = {}) => run(XWRITE, { tool_name: 'Write', tool_input: { file_path: file, content: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env } }).status;
  assert.equal(write(path.join(other, 'a.ts'), { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: flipCase(other) }), 0, 'an allowance spelled in another case covers the tree');
  assert.equal(write(path.join(flipCase(proj), 'Deep', 'New', 'b.ts'), { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' }), 0, 'the project in another drive and folder case');
  assert.equal(write(path.join(other, 'a.ts'), { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: '' }), 2, 'and outside is still outside');
});

test('guard-cross-project-write: an allowance for a tree not created yet resolves through its existing ancestor, as the target does', () => {
  // A missing allowance fell back to path.resolve and kept its spelling, while the target resolved its existing
  // ancestor on disk, so the two never met (windows-latest: an allowance under RUNNER~1, the target under runneradmin).
  // A link stands in for the 8.3 name here: a junction on win32 needs no privilege, the type is ignored elsewhere.
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'AllowProj-')));
  const base = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'AllowReal-')));
  const link = path.join(TMP, 'AllowLink');
  fs.symlinkSync(base, link, 'junction');
  const tree = path.join(link, 'Not', 'Yet');
  const write = (file) => run(XWRITE, { tool_name: 'Write', tool_input: { file_path: file, content: 'x' } },
    { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ALFRED_CODE_ALLOW_WRITE_OUTSIDE: tree } }).status;
  assert.equal(write(path.join(tree, 'a.ts')), 0, 'the allowance covers its own tree before it exists');
  assert.equal(write(path.join(base, 'Not', 'Yet', 'b.ts')), 0, 'spelled through the link or not');
  assert.equal(write(path.join(base, 'Other', 'c.ts')), 2, 'and a sibling of the allowed tree is still outside');
});

// ---------------------------------------------------------------------------------------------
// audit 2026-10-10 C11: the range cap is one rule per actor and file version on both routes
// ---------------------------------------------------------------------------------------------
const linesOf = (n, ext = 'ts') => Array.from({ length: n }, (_, i) => (ext === 'html' ? `<div>${i}</div>` : `const v${i} = ${i};`)).join('\n') + '\n';
const capDir = () => fs.mkdtempSync(path.join(TMP, 'cap-'));
const readAt = (file, offset, limit, session_id, agent_id) => run(READ, { tool_name: 'Read', tool_input: { file_path: file, offset, limit }, session_id, ...(agent_id ? { agent_id } : {}) }, { cwd: path.dirname(file) });
const shellAt = (dir, command, session_id, agent_id) => run(READ, { tool_name: 'Bash', tool_input: { command }, session_id, cwd: dir, ...(agent_id ? { agent_id } : {}) }, { cwd: dir });

test('audit 2026-10-10 C11: a seat\'s ranges are its own - the parent\'s rows never block its first read', () => {
  const dir = capDir(); const f = path.join(dir, 'InviteHandlers.ts'); fs.writeFileSync(f, linesOf(738));
  const s = sid();
  assert.equal(readAt(f, 1, 260, s).status, 0, 'the main session reads 35%');
  assert.equal(readAt(f, 299, 380, s, 'aced94b8').status, 0, 'the seat\'s first read, 51% alone, passes (3ce6b036 was blocked at 87%)');
  assert.equal(readAt(f, 1, 120, s, 'aced94b8').status, 2, 'the seat\'s OWN second range past 60% still blocks');
  assert.equal(readAt(f, 399, 200, s).status, 2, 'and the main session\'s own past 60% too');
});

// audit 2026-10-14 HK16 (the user's ruling): code-quality-analyzer made 143 of 277 range-cap blocks over 85 runs in a week,
// the verifiers 9 - the cap does not bind that seat; the whole-file size gate still does, and every other seat stays capped.
test('audit 2026-10-14 HK16: code-quality-analyzer reads past the range cap; other seats and the size gate still bind', () => {
  const dir = capDir(); const f = path.join(dir, 'OrderService.ts'); fs.writeFileSync(f, linesOf(738));
  const s = sid();
  const seatRead = (offset, limit, agent_id, agent_type) => run(READ, { tool_name: 'Read', tool_input: { file_path: f, ...(offset ? { offset, limit } : {}) }, session_id: s, agent_id, agent_type }, { cwd: dir });
  assert.equal(seatRead(1, 400, 'cqa1', 'alfred-code:code-quality-analyzer').status, 0);
  assert.equal(seatRead(399, 340, 'cqa1', 'alfred-code:code-quality-analyzer').status, 0, 'the house seat reads the rest past 60%');
  assert.equal(seatRead(1, 400, 'cqa2', 'code-quality-analyzer').status, 0);
  assert.equal(seatRead(399, 340, 'cqa2', 'code-quality-analyzer').status, 0, 'and so does its bare spelling');
  assert.equal(seatRead(1, 400, 'ver1', 'alfred-code:aspnet-verifier').status, 0);
  assert.equal(seatRead(399, 340, 'ver1', 'alfred-code:aspnet-verifier').status, 2, 'a verifier stays capped');
  assert.equal(seatRead(1, 400, 'oth1', 'other:code-quality-analyzer').status, 0);
  assert.equal(seatRead(399, 340, 'oth1', 'other:code-quality-analyzer').status, 2, 'another plugin\'s seat of that name stays capped');
  assert.equal(readAt(f, 1, 400, s).status, 0);
  assert.equal(run(READ, { tool_name: 'Read', tool_input: { file_path: f, offset: 399, limit: 340 }, session_id: s, agent_type: 'code-quality-analyzer' }, { cwd: dir }).status, 2, 'a type with no agent id is no seat');
  assert.equal(seatRead(undefined, undefined, 'cqa3', 'alfred-code:code-quality-analyzer').status, 2, 'its whole-file Read of an oversized file still blocks');
});

test('audit 2026-10-10 C11: rows read before an edit do not count against the edited file', () => {
  const dir = capDir(); const f = path.join(dir, 'projects-list.page.ts'); fs.writeFileSync(f, linesOf(1468));
  const s = sid();
  for (const [o, l] of [[1, 200], [201, 200], [1361, 42]]) assert.equal(readAt(f, o, l, s).status, 0, `range ${o}+${l} of the 1468-line version`);
  fs.writeFileSync(f, linesOf(790)); const t = Date.now() / 1000 + 5; fs.utimesSync(f, t, t);
  assert.equal(readAt(f, 601, 120, s).status, 0, 'a 15% read of the edited 790-line file is not blocked by the old version\'s rows (e499fc94)');
  assert.equal(readAt(f, 1, 400, s).status, 2, 'the new version\'s own rows still reach the cap');
});

test('audit 2026-10-10 C11: shell spans join the Read tool\'s range cap', () => {
  const dir = capDir(); const f = path.join(dir, 'server-messages.ts'); fs.writeFileSync(f, linesOf(652));
  const s = sid();
  assert.equal(readAt(f, 1, 196, s).status, 0, 'Read 1-196 (30%)');
  assert.equal(readAt(f, 259, 394, s).status, 2, 'Read 259-652 blocked (90%)');
  assert.equal(shellAt(dir, 'sed -n 197,500p server-messages.ts', s).status, 2, 'the sed span of the same file now blocks too: 77% (c5000cb1)');
  assert.equal(shellAt(dir, "awk 'NR>=219 && NR<=490' server-messages.ts", s).status, 2, 'and an awk NR span (c6142301)');
  assert.equal(shellAt(dir, 'tail -n 300 server-messages.ts', s).status, 2, 'and a tail');
  assert.equal(shellAt(dir, 'sed -n 197,240p server-messages.ts | grep -n foo', s).status, 0, 'a span into a filter prints nothing whole');
  assert.equal(shellAt(dir, 'sed -n 197,240p server-messages.ts', s).status, 0, 'a span inside the cap passes (37%)');
  // a fresh session reading through the shell alone hits the same cap
  const s2 = sid();
  assert.equal(shellAt(dir, 'sed -n 1,300p server-messages.ts', s2).status, 0, 'sed 1-300 (46%)');
  const second = shellAt(dir, 'sed -n 301,520p server-messages.ts', s2);
  assert.equal(second.status, 2, 'sed 301-520 makes 80%');
  assert.match(second.stderr, /at most 60%/, 'the denial states the cap');
});

// Audit 2026-10-11 SD16, session 5984019e: a sibling repo's 316-line service worker, Read 200+150 denied at 61% with the
// navigation remedy (that repo is in no index); the grep -C 3 fallback cut the handler at line 250 that held the answer.
test('audit 2026-10-11 SD16: an out-of-project file is located with grep, and the cap denial says how many lines are left', () => {
  const dir = capDir(); const f = path.join(dir, 'index.js'); fs.writeFileSync(f, linesOf(632, 'js'));
  const s = sid();
  assert.equal(readAt(f, 1, 200, s).status, 0, 'a first range (32%)');
  const r = readAt(f, 399, 300, s);
  assert.equal(r.status, 2, 'the measured second range still blocks - the 60% cap is unchanged');
  assert.match(r.stderr, /179 of its 632 lines are still readable by range here/, 'floor(632 x 0.6) = 379, less the 200 read');
  assert.match(r.stderr, /outside the project, so the navigation server has not indexed it/);
  assert.match(r.stderr, /grep -n '<function, handler or key you need>'/);
  assert.doesNotMatch(r.stderr, /get_symbols_overview|ToolSearch select/, 'no navigation remedy for a tree it never indexed');
  assert.equal(readAt(f, 473, 48, s).status, 0, 'the targeted range the denial points at passes (39%)');
  const inside = path.join(ROOT, 'svc.ts'); fs.writeFileSync(inside, linesOf(632));
  const s2 = sid();
  assert.equal(readAt(inside, 1, 200, s2).status, 0);
  const own = readAt(inside, 399, 300, s2);
  assert.equal(own.status, 2);
  assert.match(own.stderr, /ToolSearch select:/, 'a file in the project keeps the navigation remedy');
  assert.match(own.stderr, /179 of its 632 lines are still readable/);
});

test('audit 2026-10-10 C11: a markup template\'s denial names grep, never the symbol overview', () => {
  const dir = capDir(); const f = path.join(dir, 'project-detail.page.html'); fs.writeFileSync(f, linesOf(652, 'html'));
  const r = readAt(f, undefined, undefined, sid());
  assert.equal(r.status, 2, 'the whole read still blocks');
  assert.match(r.stderr, /grep -n/, 'the remedy is grep then a range');
  assert.doesNotMatch(r.stderr, /get_symbols_overview/, 'no navigation call that cannot index markup (81264f0d)');
  assert.match(r.stderr, /at most 60%/, 'the whole-file denial states the cap, never halves (7491ab75)');
  assert.doesNotMatch(r.stderr, /HALF the file/);
});

test('audit 2026-10-10 C11: an inverted grep prints the file minus its matches - judged like cat', () => {
  const dir = capDir(); fs.writeFileSync(path.join(dir, 'order-detail.page.ts'), linesOf(470)); fs.writeFileSync(path.join(dir, 'small.ts'), linesOf(50));
  assert.equal(shellAt(dir, 'grep -v "^import" order-detail.page.ts', sid()).status, 2, 'grep -v over a 470-line source (0498718d, at twice its size since the 400-line threshold)');
  assert.equal(shellAt(dir, 'cat order-detail.page.ts | grep -v "^import"', sid()).status, 2, 'and a cat piped into one');
  assert.equal(shellAt(dir, 'grep -vc "^import" order-detail.page.ts', sid()).status, 0, 'a count prints none of it');
  assert.equal(shellAt(dir, 'grep -v "^import" small.ts', sid()).status, 0, 'a small file is under the threshold');
  assert.equal(shellAt(dir, 'grep -n "^import" order-detail.page.ts', sid()).status, 0, 'a plain grep prints its matches only');
});

test('audit 2026-10-10 C11: a loop over a few small literal files is sized per file, not called a sweep', () => {
  const dir = capDir(); const sub = path.join(dir, 'Notifications'); fs.mkdirSync(sub);
  for (const n of ['A', 'B', 'C', 'D']) fs.writeFileSync(path.join(sub, `${n}.cs`), linesOf(40));
  const cards = path.join(dir, 'cards'); fs.mkdirSync(cards);
  fs.writeFileSync(path.join(cards, 'one.md'), '# one\n' + 'text\n'.repeat(40)); fs.writeFileSync(path.join(cards, 'two.md'), '# two\n' + 'text\n'.repeat(40));
  assert.equal(shellAt(dir, 'for f in Notifications/*.cs; do echo "== $f"; cat "$f"; done', sid()).status, 0, 'four 40-line files, 160 lines in all (49cb4b82)');
  assert.equal(shellAt(dir, 'for f in cards/one.md cards/two.md; do cat "$f"; done', sid()).status, 0, 'two named task cards (fbfc2de4)');
  fs.writeFileSync(path.join(sub, 'E.cs'), linesOf(260));
  assert.equal(shellAt(dir, 'for f in Notifications/*.cs; do cat "$f"; done', sid()).status, 2, 'past THRESHOLD lines in all it is the sweep');
  assert.equal(shellAt(dir, 'for f in src/**/*.cs; do cat "$f"; done', sid()).status, 2, 'a recursive glob cannot be sized');
  assert.equal(shellAt(dir, 'for d in Notifications; do cat ${d}/A.cs; done', sid()).status, 2, 'a path built on the variable is not sized per file');
});

// audit 2026-10-20 C28 (3a8a1ee3, 56ca25cb, 1b432dd2, 8396b5df, a8804432): a glob of a few small files, a glob in a folder
// name over two entry points and a sweep whose only sink is `wc` were denied as whole-file sweeps.
test('audit 2026-10-20 C28: a glob is sized by what it expands to, and a sweep piped into wc is a count', () => {
  const dir = capDir();
  fs.mkdirSync(path.join(dir, 'Req')); fs.mkdirSync(path.join(dir, 'Mig'));
  fs.writeFileSync(path.join(dir, 'A.cs'), linesOf(2));
  fs.writeFileSync(path.join(dir, 'Req', 'ReorderCategoriesA.cs'), linesOf(2)); fs.writeFileSync(path.join(dir, 'Req', 'ReorderCategoriesB.cs'), linesOf(2));
  fs.writeFileSync(path.join(dir, 'Mig', '2026_AddOrdersIndex.cs'), linesOf(30));
  for (const s of ['One', 'Two']) { fs.mkdirSync(path.join(dir, 'Services', s), { recursive: true }); fs.writeFileSync(path.join(dir, 'Services', s, 'Program.cs'), linesOf(40)); }
  const ok = (c, why) => assert.equal(shellAt(dir, c, sid()).status, 0, why || c);
  const no = (c, why) => assert.equal(shellAt(dir, c, sid()).status, 2, why || c);
  ok('cat A.cs Req/ReorderCategories*.cs', 'two 2-line files by glob (3a8a1ee3)');
  ok('cat Mig/*AddOrdersIndex.cs', 'a glob matching one small file (56ca25cb)');
  ok('cat Mig/*NoSuchName.cs', 'a glob matching nothing prints nothing');
  ok('for f in Services/*/Program.cs; do cat -n "$f"; done', 'a glob in a folder name over two entry points (1b432dd2)');
  ok('cat Services/*/Program.cs', 'the same glob handed to cat');
  ok('find . -name "*.cs" | xargs cat | wc -l', 'xargs cat into wc (a8804432)');
  ok('find . -name "*.cs" -exec cat {} + | wc -l', 'find -exec cat into wc');
  ok('find . -name "*.cs" -exec cat {} \\; 2>/dev/null | wc -c', 'the \\; form, stderr dropped');
  ok('for d in Req/; do echo "$d" $(cat $d*.cs | wc -l); done', 'a loop counting its files (8396b5df)');
  // what the guard exists for still blocks
  fs.writeFileSync(path.join(dir, 'Req', 'ReorderCategoriesBig.cs'), linesOf(450));
  no('cat Req/ReorderCategories*.cs', 'the same glob once it expands past THRESHOLD lines');
  no('for f in Services/*/Program.cs Req/*.cs; do cat -n "$f"; done', 'a loop past THRESHOLD in all');
  no('find . -name "*.cs" | xargs cat', 'the bare xargs sweep');
  no('find . -name "*.cs" -exec cat {} +', 'the bare -exec sweep');
  no('find . -name "*.cs" | xargs cat | tee all.txt | wc -l', 'only wc as the very next stage is a count');
  no('for d in Req/; do cat $d*.cs; done', 'the loop without its count');
  no('cat src/**/*.cs', 'a recursive glob cannot be sized');
});

test('audit 2026-10-10 C11: a file the working tree adds completes past the cap; a changed one names its diff', () => {
  const dir = capDir();
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'Old.cs'), linesOf(600)); git('add', '-A'); git('commit', '-qm', 'seed');
  fs.writeFileSync(path.join(dir, 'AdminPlanLimitsTests.cs'), linesOf(502));
  const s = sid();
  assert.equal(readAt(path.join(dir, 'AdminPlanLimitsTests.cs'), 1, 252, s).status, 0, 'first half of a NEW file');
  assert.equal(readAt(path.join(dir, 'AdminPlanLimitsTests.cs'), 253, 250, s).status, 0, 'its second half - under review whole (05c925e9)');
  fs.appendFileSync(path.join(dir, 'Old.cs'), 'const changed = 1;\n');
  assert.equal(readAt(path.join(dir, 'Old.cs'), 1, 300, s).status, 0, 'half of a changed file');
  const r = readAt(path.join(dir, 'Old.cs'), 301, 301, s);
  assert.equal(r.status, 2, 'a changed tracked file keeps the cap');
  assert.match(r.stderr, /git diff HEAD -- 'Old\.cs'|git diff HEAD -- '.*Old\.cs'/, 'and names its diff as the review route');
});

test('audit 2026-10-10 C11: a plan under the docs root reads whole; a missing relative path prints nothing', () => {
  const dir = capDir();
  const plans = path.join(dir, '.alfred', 'docs', 'plans'); fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, 'plan.md'), '# plan\n' + 'x'.repeat(70 * 1024) + '\n');
  fs.writeFileSync(path.join(dir, 'notes.md'), '# notes\n' + 'x'.repeat(70 * 1024) + '\n');
  const envd = { ...process.env, ALFRED_CODE_DOCS_PATH: '.alfred/docs', CLAUDE_PROJECT_DIR: dir };
  const rd = (p) => run(READ, { tool_name: 'Read', tool_input: { file_path: p }, session_id: sid() }, { cwd: dir, env: envd }).status;
  assert.equal(rd('.alfred/docs/plans/plan.md'), 0, 'the plan, 70KB, is the seat\'s mandated input');
  assert.equal(rd('notes.md'), 2, 'any other 70KB file still blocks');
  assert.equal(shellAt(dir, 'cat -n src/PlanLimits/AdminPlanLimitsEndpoints.cs 2>/dev/null || find src -name x', sid()).status, 0, 'a wrong path has nothing to dump (f24eb967)');
});

test('audit 2026-10-10 C11/C13: the rule notice reads no redirect inside quotes and no target outside the project', () => {
  const s = sid();
  assert.equal(announce(`perl -0pi -e 's/see > <name>.spec.ts/x/' notes.md`, s), '', 'a > inside the perl script is text (f10cb06a)');
  assert.equal(announce(`cat > ${path.join(TMP, 'scratch', 'emitter.mjs')} <<'EOF'\nx\nEOF`, sid()), '', 'a scratch file outside the project (8f44a003)');
  assert.match(announce('printf x > src/app/tool.mjs', sid()), /javascript-conventions\.md/, 'an in-project write still announces');
  // the interpreter splice the navigation rule sanctions: a bound name, then open(p, 'w') (81264f0d, 4f1c2ebb)
  assert.match(announce("python3 - <<'EOF'\np='libs/ui/src/lib/card.ts'\ns=open(p).read()\nopen(p,'w').write(s)\nEOF", sid()), /typescript-conventions\.md/,
    'a python heredoc edit of a .ts file names the TypeScript rule');
  // a target is resolved after the cd before it, and a read-only sed names no write (49cb4b82, T5 cross-track)
  const away = path.join(TMP, 'away');
  fs.mkdirSync(away, { recursive: true });
  assert.equal(announce(`cd ${away} && cat > scratch.ts <<'EOF'\nx\nEOF`, sid()), '', 'a write after a cd out of the project');
  assert.equal(announce(`cd ${away} && printf x > tool.mjs`, sid()), '', 'a redirect after a cd out of the project');
  assert.match(announce('cd src && printf x > app/tool.mjs', sid()), /javascript-conventions\.md/, 'a cd inside the project still announces');
  assert.equal(announce("sed -n '1,20p' src/app/tool.mjs | grep -i x", sid()), '', 'sed -n reads');
});

// Deep hooks review 2026-10-16 (the user's ruling): THRESHOLD 200 -> 400. 485 of 590 sized blocks in two weeks hit files of
// 200-400 lines, which the model then read anyway one request later. At, one under and one over the line; the range cap
// binds only above it, on both routes.
test('deep review: the whole-file threshold is 400 lines, and the range cap binds only above it', () => {
  const dir = capDir();
  for (const n of [399, 400, 401]) fs.writeFileSync(path.join(dir, `f${n}.ts`), linesOf(n));
  const whole = (n) => readAt(path.join(dir, `f${n}.ts`), undefined, undefined, sid()).status;
  assert.equal(whole(399), 0, 'one under');
  assert.equal(whole(400), 0, 'at the line');
  assert.equal(whole(401), 2, 'one over');
  const s = sid();
  assert.equal(readAt(path.join(dir, 'f400.ts'), 1, 200, s).status, 0);
  assert.equal(readAt(path.join(dir, 'f400.ts'), 201, 200, s).status, 0, 'no cap on a file read whole anyway');
  assert.equal(readAt(path.join(dir, 'f401.ts'), 1, 200, s).status, 0);
  assert.equal(readAt(path.join(dir, 'f401.ts'), 201, 100, s).status, 2, 'past 60% of a 401-line file');
  assert.equal(shellAt(dir, 'cat f400.ts', sid()).status, 0, 'the shell route at the line');
  assert.equal(shellAt(dir, 'cat f401.ts', sid()).status, 2, 'and one over');
  const r = readAt(path.join(dir, 'f401.ts'), undefined, undefined, sid());
  assert.ok(r.stderr.length < 900, `the whole-file denial stays short: ${r.stderr.length} chars`);
});

// Audit 2026-10-20 H7: a find naming ONE file by a literal name skipped the sweep gate and then the size gate - `find src
// -name big.ts -exec cat {} \;` and `| xargs cat` printed a 900-line file whole - while `-iname <literal> | xargs cat`, the
// same idiom case-folded, was denied as a sweep (8 corpus rows). The named files are sized now, and -iname is the idiom.
test('H7: a find naming one file is sized like a cat of it; -iname is the same idiom', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'h7-'));
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'big.ts'), 'const a = 1;\n'.repeat(900));
  fs.writeFileSync(path.join(dir, 'src', 'small.ts'), 'export const a = 1;\n');
  const at = (command) => run(READ, { tool_name: 'Bash', tool_input: { command }, cwd: dir }, { env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  for (const c of ['find src -name big.ts -exec cat {} \\;', 'find . -name big.ts | xargs cat', 'find src -iname BIG.ts | xargs cat', 'find src -name big.ts -exec cat {} +']) {
    const r = at(c);
    assert.equal(r.status, 2, `${c} prints a 900-line file`);
    assert.match(r.stderr, /prints .*big\.ts whole - 900 lines/, c);
  }
  for (const c of ['find src -name small.ts -exec cat {} \\;', 'find src -iname small.ts | xargs cat', 'find src -iname SMALL.TS -exec cat {} \\;',
    'find src -name big.ts -exec cat {} + | wc -l', 'find src -name none.ts -exec cat {} \\;']) {
    assert.equal(at(c).status, 0, `${c} must pass`);
  }
  assert.equal(at('find src -iname "*.ts" | xargs cat').status, 2, 'a glob is still the sweep');
});
