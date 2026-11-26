// The read half of guard-cross-project-write.js, for the scripts a command runs down to the depth the shared reader reads
// (hook-prelude.js SCAN_LIMITS.depth) and for `git commit -F<file>` with the file attached to the flag. Split from
// guard-cross-read.test.js, which is past the file size limit. Every case runs the guard as its own process under a fake HOME.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { scrubbed, verdictOf } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'stack', 'hooks', 'guard-cross-project-write.js');
const STRIPPED = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PROJECT_DIR_NAME', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE'];
const SCRIPTS_MAX = 8;
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

// A fake home holding the project (work/proj) and a sibling project (other-proj) the project's scripts can reach.
function fixture() {
  const outer = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'xnest-')));
  const home = path.join(outer, 'home');
  const put = (rel, text = 'x\n') => { const file = path.join(home, ...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const proj = path.join(home, 'work', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  git(proj, 'init', '-q');
  put('work/proj/x');
  const other = put('other-proj/notes.md');
  const script = (name, text) => put(`work/proj/${name}`, text);
  return { outer, home, put, proj, other, script, rm: () => fs.rmSync(outer, { recursive: true, force: true }) };
}
const withFixture = (body) => () => { const fx = fixture(); try { body(fx); } finally { fx.rm(); } };
function run(fx, command, env = {}) {
  const base = scrubbed();
  for (const key of STRIPPED) delete base[key];
  return spawnSync(process.execPath, [GUARD], {
    cwd: fx.proj, encoding: 'utf8',
    env: { ...base, HOME: fx.home, USERPROFILE: fx.home, TMPDIR: fx.home, TEMP: fx.home, TMP: fx.home, CLAUDE_PROJECT_DIR: fx.proj, ...env },
    input: JSON.stringify({ cwd: fx.proj, session_id: 'xn', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
  });
}
function asks(fx, command, why, env) {
  const r = run(fx, command, env);
  assert.strictEqual(verdictOf(r), 'ask', `${why}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /reads outside this workspace/, why);
}
function passes(fx, command, why, env) {
  const r = run(fx, command, env);
  assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
  assert.strictEqual(r.stdout, '', `${why}: ${r.stdout}`);
}
// A chain of scripts, each running the next; the last one runs `last`.
function chain(fx, names, last) {
  names.forEach((name, at) => fx.script(name, at + 1 < names.length ? `echo ${name}\nbash ${names[at + 1]}\n` : `${last}\n`));
}

test('a script two levels down that reads past the workspace asks', withFixture((fx) => {
  chain(fx, ['a.sh', 'b.sh'], `cat ${fx.other}`);
  asks(fx, 'bash a.sh', 'bash a.sh runs bash b.sh, which reads the sibling');
  chain(fx, ['ok-a.sh', 'ok-b.sh'], 'cat x');
  passes(fx, 'bash ok-a.sh', 'two levels naming only project files');
}));

test('a script three levels down asks, a script past the scan depth is not read by this half', withFixture((fx) => {
  chain(fx, ['a.sh', 'b.sh', 'c.sh'], `cat ${fx.other}`);
  asks(fx, 'bash a.sh', 'three levels of carried scripts');
  chain(fx, ['d1.sh', 'd2.sh', 'd3.sh', 'd4.sh'], `cat ${fx.other}`);
  const r = run(fx, 'bash d1.sh');
  assert.doesNotMatch(r.stdout, /reads outside this workspace/, 'the fourth level is past SCAN_LIMITS.depth, never judged as a read');
}));

test('a script that runs itself is read once and the cycle ends', { skip: process.platform === 'win32' && 'a preload path' }, withFixture((fx) => {
  const log = path.join(fx.home, 'opens.log');
  const spy = fx.put('spy/spy.js', `const fs = require('fs');\nconst open = fs.openSync;\nfs.openSync = function (p, ...rest) { if (String(p).endsWith('loop.sh')) fs.appendFileSync(${JSON.stringify(log)}, 'open\\n'); return open.call(this, p, ...rest); };\n`);
  fx.script('loop.sh', `echo hi\nbash loop.sh\ncat ${fx.other}\n`);
  asks(fx, 'bash loop.sh', 'a cycle still reads the sibling it names', { NODE_OPTIONS: `--require ${spy}` });
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'one open of the script');
}));

test('at most eight scripts are read for a command, whatever the levels', withFixture((fx) => {
  const names = (count) => Array.from({ length: count }, (_, at) => `s${at + 1}.sh`);
  for (const name of names(SCRIPTS_MAX + 1)) fx.script(name, 'cat x\n');
  fx.script(`s${SCRIPTS_MAX}.sh`, `cat ${fx.other}\n`);
  asks(fx, names(SCRIPTS_MAX).map((name) => `bash ${name}`).join('; '), 'the eighth script of one command is read');
  fx.script(`s${SCRIPTS_MAX}.sh`, 'cat x\n');
  fx.script(`s${SCRIPTS_MAX + 1}.sh`, `cat ${fx.other}\n`);
  passes(fx, names(SCRIPTS_MAX + 1).map((name) => `bash ${name}`).join('; '), 'the ninth script of one command is past the cap');
  fx.script('top.sh', `${names(SCRIPTS_MAX).map((name) => `bash ${name}`).join('; ')}\n`);
  fx.script(`s${SCRIPTS_MAX}.sh`, `cat ${fx.other}\n`);
  passes(fx, 'bash top.sh', 'the cap counts every level: top.sh and seven scripts below it, the eighth below is the ninth in all');
  fx.script(`s${SCRIPTS_MAX}.sh`, 'cat x\n');
  fx.script(`s${SCRIPTS_MAX - 1}.sh`, `cat ${fx.other}\n`);
  asks(fx, 'bash top.sh', 'the seventh script below top.sh is the eighth in all');
}));

test('a script run again takes one of the eight, not each run', withFixture((fx) => {
  fx.script('same.sh', 'cat x\n');
  fx.script('last.sh', `cat ${fx.other}\n`);
  const repeats = Array.from({ length: SCRIPTS_MAX }, () => 'bash same.sh').join('; ');
  asks(fx, `${repeats}; bash last.sh`, 'eight runs of one script and then another');
}));

test('a runtime body a carried script is handed is read, as one in the command is', withFixture((fx) => {
  const toSlash = (file) => file.replace(/\\/g, '/');
  fx.script('rt.sh', `python3 - <<'X'\nopen('${toSlash(fx.other)}')\nX\n`);
  asks(fx, 'bash rt.sh', 'a python heredoc in a script file');
  fx.script('rt-ok.sh', "python3 - <<'X'\nopen('x')\nX\n");
  passes(fx, 'bash rt-ok.sh', 'a python heredoc naming a project file');
}));

test('each script has its own word budget of 512: the word at the limit is read, one past it is not', withFixture((fx) => {
  const WORDS_MAX = 512;
  const filler = (count) => `ls ${Array.from({ length: count }, () => 'x').join(' ')}\ncat ${fx.other}\n`;
  fx.script('outer.sh', 'bash inner.sh\n');
  fx.script('inner.sh', filler(WORDS_MAX - 1));
  asks(fx, 'bash outer.sh', 'the 512th word of a script two levels down');
  fx.script('inner.sh', filler(WORDS_MAX));
  passes(fx, 'bash outer.sh', 'the 513th word of that script');
}));

test('git commit -F<file> with the file attached to the flag reads the file, as -F <file> does', withFixture((fx) => {
  fx.put('work/proj/msg.txt');
  for (const command of [`git commit -F${fx.other}`, `git commit -a -F${fx.other}`, `git commit -aF${fx.other}`, `git commit --amend -F"${fx.other}"`,
    `git tag -a v1 -F${fx.other}`, `git commit --file=${fx.other}`, `git commit --file ${fx.other}`, `git commit --file="${fx.other}"`,
    `/usr/bin/git commit -F${fx.other}`, `timeout 5 git commit -F${fx.other}`]) asks(fx, command, command);
  for (const command of ['git commit -Fmsg.txt', `git commit -F${path.join(fx.proj, 'msg.txt')}`, 'git commit -F-', 'git commit -aF-', 'git commit --file=-', 'git commit --file=msg.txt',
    `git commit -m${fx.other}`, `git commit -m "see ${fx.other}"`, `git commit --message=${fx.other}`, `git commit -am${fx.other}`, `git tag -a v1 -m${fx.other}`,
    `git grep -F${fx.other} x`, `git grep -Fn x`, `git commit -mF${fx.other}`, `git log -F${fx.other}`]) passes(fx, command, command);
}));

test('git commit --file=~/x and -F~/x name a file called ~ in the folder, as the shell hands them on, so they ask nothing', withFixture((fx) => {
  for (const command of ['git commit --file=~/other-proj/notes.md', 'git commit -F~/other-proj/notes.md', 'git tag -a v1 --file=~/other-proj/notes.md']) passes(fx, command, command);
  asks(fx, `git commit --file ~/other-proj/notes.md`, 'a separate word is a tilde the shell expands');
}));
