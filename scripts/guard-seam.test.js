#!/usr/bin/env node
// 2.1.6 seam review: the guards read one shell through several readers, and where two of them disagreed a command one
// blocked another passed. Each table below runs ONE command shape through every guard that judges it and asserts they
// agree, so a fix in one reader that the others do not share goes red here. Shapes are the review's own repros
// (final-review-216.md: M1, M2, M3, m1, m2, m4, m5).
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = process.env.SEAM_BASE_HOOKS || path.join(__dirname, '..', 'stack', 'hooks'); // SEAM_BASE_HOOKS: run the cells against another tree's hooks (the RED run)
const SECRET = path.join(HOOKS, 'guard-secret-value.js');
const READ = path.join(HOOKS, 'guard-read-whole-file.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-seam-'));
const ROOT = fs.mkdtempSync(path.join(TMP, 'root-'));
process.env.CLAUDE_PROJECT_DIR = ROOT;
process.env.ALFRED_CODE_DOCS_PATH = path.join(TMP, 'ledger');
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'account-'));

fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.env'), 'DB_HOST=localhost\nAPI_KEY=abc123\n');
fs.writeFileSync(path.join(ROOT, 'src', 'big.js'), 'const a = 1;\n'.repeat(400));
fs.writeFileSync(path.join(ROOT, 'package.json'), '{}\n');

const call = (hook, command) => spawnSync(process.execPath, [hook], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'seam', cwd: ROOT }),
  encoding: 'utf8', cwd: ROOT, env: { ...process.env },
});
const rewritten = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command != null; } catch { return false; } };
// The secret guard answers a content read with a rewrite or a block; the read guard answers a whole-file dump with a block.
const secretHits = (command) => { const r = call(SECRET, command); return r.status === 2 || rewritten(r); };
const readHits = (command) => call(READ, command).status === 2;

const SECRET_BODY = 'cat .env';
const READ_BODY = 'cat src/big.js';

// ---- M1: every heredoc opener spelling heredocsOf accepts is a heredoc to both guards ----
const OPENERS = ['<<\\EOT', "<<'EOT'", '<<"EOT"', '<<EOT', "<<-'EOT'", "<< 'EOT'", '<<-EOT', '<<-\\EOT'];
for (const opener of OPENERS) {
  test(`seam M1: a body fed to bash through ${opener} is judged by both guards`, () => {
    assert.ok(secretHits(`bash ${opener}\n${SECRET_BODY}\nEOT`), `secret guard, ${opener}`);
    assert.ok(readHits(`bash ${opener}\n${READ_BODY}\nEOT`), `read guard, ${opener}`);
  });
}
test('seam M1: a heredoc into cat is still data for both guards', () => {
  assert.ok(!secretHits(`cat <<\\EOT\n${SECRET_BODY}\nEOT`));
  assert.ok(!readHits(`cat <<\\EOT\n${READ_BODY}\nEOT`));
});

// ---- M2: one wrapper list for the guards - a wrapper the cross-project guard sees through is seen through here too ----
// Every wrapper shell-writes.js knows is walked past by both guards: the list is read from the module, so a wrapper added
// there without the guards seeing it goes red here. `eval` and `coproc` run their words as text, not as a prefix.
const sw = require(path.join(HOOKS, 'shell-writes.js'));
const WRAP_ARGS = { timeout: '30', gtimeout: '30', env: 'A=1', nice: '-n 5', ionice: '-c 3', stdbuf: '-oL', caffeinate: '-i' };
const WRAP = [...sw.WRAPPERS].filter((w) => !['eval', 'coproc'].includes(w)).map((w) => (WRAP_ARGS[w] ? `${w} ${WRAP_ARGS[w]}` : w))
  .concat([...sw.RUN_TOOLS].map((t) => `${t} run`));
for (const w of WRAP) {
  test(`seam M2: ${w} bash -c is judged by both guards`, () => {
    assert.ok(secretHits(`${w} bash -c '${SECRET_BODY}'`), `secret guard, ${w}`);
    assert.ok(readHits(`${w} bash -c '${READ_BODY}'`), `read guard, ${w}`);
  });
}
test('seam M2: xargs, find -exec and a here-string into a shell carry a script', () => {
  assert.ok(secretHits(`echo x | xargs -I{} sh -c '${SECRET_BODY}'`), 'secret, xargs');
  assert.ok(readHits(`echo x | xargs -I{} sh -c '${READ_BODY}'`), 'read, xargs');
  assert.ok(secretHits(`find . -maxdepth 1 -name package.json -exec sh -c '${SECRET_BODY}' \\;`), 'secret, find -exec');
  assert.ok(readHits(`find . -maxdepth 1 -name package.json -exec sh -c '${READ_BODY}' \\;`), 'read, find -exec');
  assert.ok(secretHits(`bash <<< '${SECRET_BODY}'`), 'secret, here-string');
  assert.ok(secretHits(`sh <<< "${SECRET_BODY}"`), 'secret, here-string double');
  assert.ok(readHits(`bash <<< '${READ_BODY}'`), 'read, here-string');
});

// ---- m1: a heredoc runtime that opens inside $( ), ( ) or a backtick is still a runtime ----
test('seam m1: a runtime heredoc inside a substitution or a subshell is judged', () => {
  const py = (inner) => `${inner}python3 - <<'EOF'\nprint(open('.env').read())\nEOF\n`;
  assert.ok(secretHits(`echo "$(${py('')})"`), 'secret, $( )');
  assert.ok(secretHits(`(${py('')})`), 'secret, ( )');
  assert.ok(secretHits(`x=\`${py('')}\``), 'secret, backtick');
  assert.ok(secretHits(`OUT=$(${py('')})`), 'secret, NAME=$( )');
  const pyBig = `python3 - <<'EOF'\nprint(open('src/big.js').read())\nEOF\n`;
  assert.ok(readHits(`echo "$(${pyBig})"`), 'read, $( )');
  assert.ok(readHits(`(${pyBig})`), 'read, ( )');
});

// ---- m2: the read guard has the secret guard's runtime list and here-string branch ----
test('seam m2: the read guard judges a runtime here-string and the wider runtime list', () => {
  const p = "print(open('src/big.js').read())";
  assert.ok(readHits(`python3 <<< "${p}"`), 'python here-string');
  assert.ok(readHits(`node <<< "console.log(require('fs').readFileSync('src/big.js','utf8'))"`), 'node here-string');
  assert.ok(readHits(`ruby <<< "puts File.read('src/big.js')"`), 'ruby here-string');
  assert.ok(readHits(`bun run - <<'EOF'\nconsole.log(require('fs').readFileSync('src/big.js','utf8'))\nEOF`), 'bun run -');
  assert.ok(readHits(`deno run - <<'EOF'\nconsole.log(Deno.readTextFileSync('src/big.js'))\nEOF`), 'deno run -');
  assert.ok(readHits(`pwsh -Command - <<'EOF'\nGet-Content src/big.js\nEOF`), 'pwsh -Command -');
});

// ---- m5: a body a shell expands, a git verb that prints a blob, a script the command wrote and runs ----
test('seam m5: $( ) in an unquoted heredoc body, git cat-file, a script the command writes then runs', () => {
  assert.ok(secretHits(`cat <<EOF > out.txt\nvalue: $(cat .env)\nEOF`), 'secret, unquoted body expansion');
  assert.ok(readHits(`cat <<EOF\nvalue: $(cat src/big.js)\nEOF`), 'read, unquoted body expansion into the terminal');
  assert.ok(!readHits(`cat <<EOF > out.txt\nvalue: $(cat src/big.js)\nEOF`), 'read, the same into a file is no dump');
  assert.ok(!readHits(`cat <<'EOF'\nvalue: $(cat src/big.js)\nEOF`), 'read, a quoted tag expands nothing');
  assert.ok(!secretHits(`cat <<'EOF' > out.txt\nvalue: $(cat .env)\nEOF`), 'a quoted tag expands nothing');
  assert.ok(secretHits('git cat-file -p HEAD:.env'), 'git cat-file prints a blob');
  assert.ok(secretHits(`cat > scratch.py <<'EOF'\nprint(open('.env').read())\nEOF\npython3 scratch.py`), 'a script written then run');
});

// ---- M3: the force-push and rm guards read a command through the reader the commit guard uses ----
const PUSH = path.join(HOOKS, 'guard-protected-force-push.js');
const RM = path.join(HOOKS, 'guard-catastrophic-rm.js');
const exit2 = (hook, command, cwd = ROOT) => spawnSync(process.execPath, [hook], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'seam', cwd }),
  encoding: 'utf8', cwd, env: { ...process.env },
}).status === 2;

test('seam M3: a force-push to main is blocked however the command carries it', () => {
  const blocked = [
    'git push --force origin main',
    'timeout 60 git push --force origin main',
    'env A=1 git push -f origin main',
    'nohup git push -f origin main',
    'GIT_SSH_COMMAND="ssh -i k" git push -f origin main',
    "bash -c 'git push --force origin main'",
    "sh -c 'git push --force origin main'",
    "bash <<'EOF'\ngit push --force origin main\nEOF",
    'bash <<\\EOF\ngit push --force origin main\nEOF',
    "bash <<< 'git push --force origin main'",
    'if git diff --quiet; then git push --force origin main; fi',
    'for f in a b; do git push --force origin main; done',
    'mkdir -p sub && cd sub && git push -f origin main',
    "git -c alias.pf='push --force' pf origin main",
    'eval "git push --force origin main"',
    'git push origin +main',
    'git push origin --delete main',
    'git push --mirror',
  ];
  for (const c of blocked) assert.ok(exit2(PUSH, c), `blocked: ${c}`);
  fs.writeFileSync(path.join(ROOT, 'run.sh'), 'git push --force origin main\n');
  assert.ok(exit2(PUSH, 'bash run.sh'), 'a script file a shell runs');
  const allowed = [
    'git push origin main',
    'timeout 60 git push origin main',
    'git push --force-with-lease origin feature/x',
    'git push -f origin feature/x',
    'echo "git push --force origin main"',
    "cat <<'EOF'\ngit push --force origin main\nEOF",
    "git commit -m 'never git push --force origin main'",
    'grep -n "push --force" README.md',
  ];
  for (const c of allowed) assert.ok(!exit2(PUSH, c), `allowed: ${c}`);
});

const GR = fs.mkdtempSync(path.join(TMP, 'repo-'));
const sh = (...a) => spawnSync('git', ['-C', GR, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
sh('init', '-q');
fs.mkdirSync(path.join(GR, 'src'), { recursive: true });
for (const f of ['a.txt', 'clean.txt', 'src/b.txt']) fs.writeFileSync(path.join(GR, f), 'seed\n');
sh('add', '-A'); sh('commit', '-qm', 'seed');
fs.writeFileSync(path.join(GR, 'a.txt'), 'changed\n');
fs.writeFileSync(path.join(GR, 'src', 'b.txt'), 'changed\n');
fs.writeFileSync(path.join(GR, 'src', 'untracked.txt'), 'x\n');

test('seam M3: a discard of dirty work is blocked inside a wrapper, a shell body, eval and a compound command', () => {
  const blocked = [
    'git checkout -- a.txt',
    "bash -c 'git checkout -- a.txt'",
    "timeout 30 bash -c 'git checkout -- a.txt'",
    "bash <<'EOF'\ngit checkout -- a.txt\nEOF",
    'bash <<\\EOF\ngit checkout -- a.txt\nEOF',
    'eval "git checkout -- a.txt"',
    'if true; then git checkout -- a.txt; fi',
    'for i in 1; do git checkout -- a.txt; done',
    'cd src && git checkout -- .',
    'cd src && git clean -fdx',
    'cd src && git reset --hard',
    'nohup git restore a.txt',
  ];
  for (const c of blocked) assert.ok(exit2(RM, c, GR), `blocked: ${c}`);
  const allowed = [
    'git add a.txt && git status',
    'echo "git checkout -- a.txt"',
    "cat <<'EOF'\ngit checkout -- a.txt\nEOF",
    'git checkout -- clean.txt',
    'timeout 30 git log --oneline',
  ];
  for (const c of allowed) assert.ok(!exit2(RM, c, GR), `allowed: ${c}`);
});

test('seam M3: a recursive rm of a catastrophic target is blocked inside a wrapper, a shell body and eval', () => {
  const blocked = ['rm -rf ~', 'timeout 5 rm -rf ~', "bash -c 'rm -rf ~'", "bash <<'EOF'\nrm -rf ~\nEOF", 'eval "rm -rf /"', 'if true; then rm -rf ~; fi', 'doas rm -rf ~'];
  for (const c of blocked) assert.ok(exit2(RM, c), `blocked: ${c}`);
  const allowed = ["cat <<'EOF'\nrm -rf ~\nEOF", 'echo "rm -rf ~"', 'rm -rf node_modules'];
  for (const c of allowed) assert.ok(!exit2(RM, c), `allowed: ${c}`);
});

test('seam m4: past the judged-call cap the rest of a command reads as one whole-tree discard', () => {
  const { SCAN_LIMITS } = require(path.join(HOOKS, 'hook-prelude.js'));
  const many = (n, line) => Array.from({ length: n }, () => line).join('\n');
  assert.ok(!exit2(RM, many(SCAN_LIMITS.gitJudged, 'git checkout -- clean.txt'), GR), 'at the cap every call is judged alone and names no loss');
  assert.ok(exit2(RM, many(SCAN_LIMITS.gitJudged + 1, 'git checkout -- clean.txt'), GR), 'one over: the dirty tree is at risk, so it blocks');
  assert.ok(!exit2(RM, many(3000, 'git add clean.txt && echo added'), GR), 'thousands of non-destructive calls cost no git spawn');
});

// ---- delta 1: a leading `(`, `{`, `!` or `time` opens a command, it does not hide it - one reader, every guard ----
test('seam delta 1: rm -rf inside a subshell, a group, after ! or time is blocked like the plain form', () => {
  const blocked = ['(cd $BUILD && rm -rf *)', '(rm -rf /)', '(cd ~ && rm -rf .)', '( rm -rf ~ )', '{ rm -rf ~; }', '! rm -rf ~', 'time rm -rf ~',
    '(time rm -rf ~)', '((rm -rf ~))', 'echo a; (rm -rf ~)', 'true && (cd / && rm -rf *)', '(sudo rm -rf ~)'];
  for (const c of blocked) assert.ok(exit2(RM, c), `blocked: ${c}`);
  const allowed = ['(cd sub && npm test)', '(cd build && rm -rf out)', '(rm -rf node_modules)', '{ echo hi; }', '(echo rm -rf ~)', '! grep x y', 'time npm test',
    'echo $(pwd)', '(cd sub && rm -rf ./dist)'];
  for (const c of allowed) assert.ok(!exit2(RM, c), `allowed: ${c}`);
});
test('seam delta 1: a whole-file dump inside a subshell, a group, after ! or time is judged like the plain form', () => {
  for (const c of ['(cd . && cat src/big.js)', '(cat src/big.js)', '{ cat src/big.js; }', '! cat src/big.js', 'time cat src/big.js', '(time cat src/big.js)',
    '(cd src && cat big.js)', 'true && (cat src/big.js)', '( cat src/big.js )']) assert.ok(readHits(c), `read blocked: ${c}`);
  for (const c of ['(cd . && cat src/big.js | head -5)', '(cd sub && npm test)', '{ echo hi; }', '(echo hi)']) assert.ok(!readHits(c), `read allowed: ${c}`);
  for (const c of ['(cat .env)', '(cd . && cat .env)', '{ cat .env; }', '! cat .env', 'time cat .env', '((cat .env))']) assert.ok(secretHits(c), `secret: ${c}`);
  for (const c of ['(cd sub && npm test)', '(echo hi)']) assert.ok(!secretHits(c), `secret allowed: ${c}`);
});

// ---- delta 3: a here-string handed to a runtime that reads its script from stdin (`-`, `-Command -`, `run -`) is a script ----
test('seam delta 3: a here-string to a runtime with - or flags is judged like the inline form', () => {
  const py = "print(open('src/big.js').read())";
  const nodeJs = "console.log(require('fs').readFileSync('src/big.js','utf8'))";
  const shapes = [
    `python3 - <<< "${py}"`, `python3 -u - <<< "${py}"`, `python - <<< "${py}"`,
    `node - <<< "${nodeJs}"`, `ruby - <<< "puts File.read('src/big.js')"`, `perl - <<< "open(F, 'src/big.js'); print <F>;"`,
    `bun run - <<< "${nodeJs}"`, `deno run - <<< "console.log(Deno.readTextFileSync('src/big.js'))"`,
    `pwsh -Command - <<< "Get-Content src/big.js"`, `pwsh - <<< "Get-Content src/big.js"`, `pwsh <<< "Get-Content src/big.js"`,
  ];
  for (const c of shapes) assert.ok(readHits(c), `read: ${c}`);
  const sec = [`python3 - <<< "print(open('.env').read())"`, `node - <<< "console.log(require('fs').readFileSync('.env','utf8'))"`,
    `ruby - <<< "puts File.read('.env')"`];
  for (const c of sec) assert.ok(secretHits(c), `secret: ${c}`);
  for (const c of [`python3 - <<< "print(1)"`, `node - <<< "console.log(2)"`, `pwsh - <<< "Get-Date"`]) assert.ok(!readHits(c), `read allowed: ${c}`);
});

// ---- delta 4: setsid is a wrapper - one list, every guard ----
test('seam delta 4: setsid carries its command for every guard', () => {
  assert.ok(sw.WRAPPERS.has('setsid'), 'setsid is in the one wrapper list');
  assert.ok(secretHits(`setsid bash -c '${SECRET_BODY}'`), 'secret');
  assert.ok(readHits(`setsid bash -c '${READ_BODY}'`), 'read');
  assert.ok(exit2(PUSH, "setsid bash -c 'git push --force origin main'"), 'force-push');
  assert.ok(exit2(PUSH, 'setsid -f git push --force origin main'), 'force-push, -f');
  assert.ok(exit2(RM, "setsid bash -c 'rm -rf ~'"), 'rm');
  assert.ok(exit2(RM, 'setsid rm -rf ~'), 'rm, direct');
  assert.ok(exit2(RM, "setsid bash -c 'git checkout -- a.txt'", GR), 'discard');
  assert.ok(!exit2(RM, 'setsid npm test'), 'an ordinary command passes');
});

// ---- a guard whose shared module is absent fails open, never crashes (parity test: a copy that runs before it lands) ----
const COMMIT = path.join(HOOKS, 'guard-ungated-commit.js');
const bare = (missing) => {
  const dir = fs.mkdtempSync(path.join(TMP, 'bare-'));
  for (const f of fs.readdirSync(HOOKS)) if (f.endsWith('.js') && !missing.includes(f)) fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
  for (const f of fs.readdirSync(HOOKS)) if (f.endsWith('.json')) fs.copyFileSync(path.join(HOOKS, f), path.join(dir, f));
  return dir;
};
const NO_SHELL = bare(['shell-writes.js']);
const CRASH = /Cannot find module|TypeError|ReferenceError|SyntaxError/;
const rawCall = (dir, hook, command) => spawnSync(process.execPath, [path.join(dir, hook)], {
  input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'seam', cwd: ROOT }),
  encoding: 'utf8', cwd: ROOT, env: { ...process.env },
});
test('seam: force-push, rm and commit guards fail open when shell-writes.js is absent', () => {
  for (const [hook, commands] of [
    ['guard-protected-force-push.js', ['git push --force origin main', 'git status']],
    ['guard-catastrophic-rm.js', ['rm -rf ~', 'git checkout -- a.txt', 'ls']],
    ['guard-ungated-commit.js', ['git commit -m x', 'git status']],
  ]) {
    for (const c of commands) {
      const r = rawCall(NO_SHELL, hook, c);
      assert.strictEqual(r.status, 0, `${hook}: ${c} -> ${r.status} ${r.stderr.slice(0, 160)}`);
      assert.ok(!CRASH.test(r.stderr), `${hook} must not report the missing module: ${r.stderr.slice(0, 160)}`);
    }
  }
});
test('seam: the read and secret guards keep judging (degraded) when shell-writes.js is absent', () => {
  for (const [hook, plain] of [['guard-read-whole-file.js', READ_BODY], ['guard-secret-value.js', SECRET_BODY]]) {
    const r = rawCall(NO_SHELL, hook, plain);
    assert.ok(r.status === 2 || /updatedInput/.test(r.stdout), `${hook} still judges a plain read: ${r.status}`);
    assert.ok(!CRASH.test(r.stderr), `${hook}: ${r.stderr.slice(0, 160)}`);
    for (const c of ['ls', `(cd . && ${plain})`, `time ${plain}`, `bash <<\\EOT\n${plain}\nEOT`, `python3 - <<< "print(1)"`, `setsid bash -c '${plain}'`, `cat <<EOF\n$(echo hi)\nEOF`]) {
      const q = rawCall(NO_SHELL, hook, c);
      assert.ok(q.status === 0 || q.status === 2, `${hook}: ${c} -> ${q.status}`);
      assert.ok(!CRASH.test(q.stderr), `${hook}: ${c}: ${q.stderr.slice(0, 160)}`);
    }
  }
});
