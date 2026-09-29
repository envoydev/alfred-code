#!/usr/bin/env node
// Behavior tests for guard-read-whole-file.js and guard-cross-project-write.js, written from family
// E of the 154-bundle audit. Every case here was REPLAYED live on the shipped hook before the fix,
// so each pins a real regression - a false positive that blocked honest work and taught the model a
// bypass, or a remedy that could not be run. Both directions carry equal weight: the shape that was
// wrongly blocked passes now, and the dump or the out-of-tree write the gate exists for still blocks.
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
const announce = (command, session_id, hook = READ, opts) => ctxOf(run(hook, { tool_name: 'Bash', tool_input: { command }, session_id }, opts));
const LONG_JS = 'const a = 1;\n'.repeat(400); // over the 200-line threshold

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
  // M30: the hook's remedy line is the plugin spelling - the old `select:mcp__serena` pattern matched nothing any hook
  // writes, so it could never fail (the ordinary-path case below proves this pattern does match a real remedy).
  assert.doesNotMatch(r.stderr, /ToolSearch select:mcp__plugin_navigation_navigation__/, 'but no tools that cannot index this tree');
  assert.match(r.stderr, /ignored_paths/, 'the denial says why');
  assert.match(r.stderr, /grep -n/, 'and gives a remedy that works there');
  const inSerena = path.join(ROOT, '.serena', 'cache', 'big.ts');
  fs.mkdirSync(path.dirname(inSerena), { recursive: true });
  fs.writeFileSync(inSerena, LONG_JS);
  assert.doesNotMatch(run(READ, { tool_name: 'Read', tool_input: { file_path: inSerena } }).stderr, /ToolSearch select:mcp__plugin_navigation_navigation__/,
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
    assert.doesNotMatch(d.stderr, /ToolSearch select:mcp__plugin_navigation_navigation__/, `no navigation remedy under ${root}`);
    assert.match(d.stderr, /grep -n/, root);
  }
  // ... and an ordinary source path still gets the whole ladder, loading call included
  const src = path.join(ROOT, 'src', 'big.ts');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, LONG_JS);
  const ok = run(READ, { tool_name: 'Read', tool_input: { file_path: src } });
  assert.equal(ok.status, 2);
  assert.match(ok.stderr, /ToolSearch select:mcp__plugin_navigation_navigation__get_symbols_overview/, 'the serena ladder is unchanged where it works');
});

test('guard-read-whole-file: an oversized binary or minified file is answered with PAGING, not a grep', () => {
  // Verified live: the non-gated big-file branch printed the grep + offset remedy for ANY oversized
  // file, a 93KB PNG included, where neither applies - 2 wasted calls. This branch judges SIZE, not
  // language, so it has to say what to do with bytes that have no lines.
  const dir = fs.mkdtempSync(path.join(TMP, 'big-'));
  const png = path.join(dir, 'shot.png');
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), Buffer.alloc(70 * 1024, 7)]));
  const b = run(READ, { tool_name: 'Read', tool_input: { file_path: png } });
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
