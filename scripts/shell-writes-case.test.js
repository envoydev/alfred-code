'use strict';
// A `case` arm's pattern is no command: `[/])` read as a script run by its path made nvm.sh unread, and the rm guard
// blocked `source ~/.nvm/nvm.sh` in every dirty checkout as a whole-tree discard (2026-11-24).
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const shell = require(path.join(HOOKS, 'shell-writes.js'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-case-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const read = (command) => shell.gitText(command, TMP);
const subs = (command) => read(command).calls.map((c) => c.sub);
const words = (command) => shell.parseShell(command).cmds.map((c) => c.words.map((w) => w.raw)).filter((w) => w.length);

test('a case pattern holding a / is no script run by its path, so the text stays read', () => {
  for (const pattern of ['[/]', '*[!/]*/', 'x[!/]', '([/])'])
    assert.strictEqual(read(`case $D in\n  ${pattern}) echo a ;;\nesac\n`).unreadAt, -1, pattern);
  assert.strictEqual(read('case $D in [/]) echo a ;; esac').unreadAt, -1, 'a pattern on the case line');
});

test('a case pattern is no command: git) and rm) name no call, the arm body still runs', () => {
  assert.deepStrictEqual(subs('case $D in\n  git) echo a ;;\nesac'), []);
  assert.deepStrictEqual(subs('case $D in\n  a|git) echo a ;;\n  push) git status ;;\nesac'), ['status']);
  assert.deepStrictEqual(subs('case $D in git) git push ;; esac'), ['push']);
  assert.deepStrictEqual(words('case $D in\n  rm) echo a ;;\nesac'), [['case', '$D', 'in'], ['echo', 'a'], ['esac']]);
  assert.deepStrictEqual(words('case $D in rm|x) echo a ;; esac'), [['case', '$D', 'in'], ['echo', 'a'], ['esac']]);
});

test('a substitution inside a case pattern still runs, and a case inside an arm keeps its own patterns', () => {
  assert.deepStrictEqual(subs('case $D in\n  $(git push)) echo a ;;\nesac'), ['push']);
  assert.deepStrictEqual(subs('case $a in\n  x) case $b in\n    git) git status ;;\n  esac ;;\n  git) echo y ;;\nesac'), ['status']);
  assert.deepStrictEqual(subs('x=$(case a in (git) echo y ;; esac); git status'), ['status']);
});

test('a case word that leads no command starts no pattern, so the calls after it stay read', () => {
  assert.deepStrictEqual(subs('case "$1" in *) echo case y in; git push -f; (:);; esac'), ['push']);
  assert.deepStrictEqual(subs('case "$1" in *) echo case y in; rm -rf build; git reset --hard; (true);; esac'), ['reset']);
  assert.deepStrictEqual(subs('case x in a) echo case y in; (git push -f);; esac'), ['push']);
  assert.deepStrictEqual(subs('echo $(case x in a) echo case y in; git push; (true);; esac)'), ['push']);
});

test('a case pattern spelled case) opens no second case, so the calls after esac stay read', () => {
  assert.deepStrictEqual(subs('case x in a) echo;; case) echo;; esac; echo case y in; git push; (true)'), ['push']);
  assert.deepStrictEqual(subs('case x in a) echo;; case) echo;; esac; echo case y in; (git push)'), ['push']);
});

test('the rm guard passes a dirty checkout sourcing a script whose case pattern holds a /', () => {
  const repo = path.join(TMP, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\n');
  git('init', '-q');
  git('add', 'f.txt');
  git('commit', '-qm', 'i');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'b\n');
  const script = path.join(TMP, 'tool.sh');
  fs.writeFileSync(script, 'case $DIR in\n  *[!/]*/)\n    DIR="${DIR%"${DIR##*[!/]}"}"\n  ;;\nesac\n');
  const guard = (command) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-catastrophic-rm.js')],
    { input: JSON.stringify({ session_id: 'case-test', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' }).status;
  assert.strictEqual(guard(`source ${script}`), 0);
  assert.strictEqual(guard(`. ${script} && echo done`), 0);
  assert.strictEqual(guard(`source ${script}; git checkout -- f.txt`), 2, 'a real discard after it still blocks');
});

test('an esac inside a pattern opened by ( ends no case, so a substitution keeps its arm body', () => {
  assert.deepStrictEqual(subs('echo $(case "esac" in (esac) git push;; esac)'), ['push']);
  assert.deepStrictEqual(subs('echo $(case x in (a|esac) git push;; esac)'), ['push']);
  assert.deepStrictEqual(subs('echo `case "esac" in (esac) git reset --hard;; esac`'), ['reset']);
  assert.deepStrictEqual(subs('case x in esac; git status'), ['status'], 'esac right after in still ends the case');
});

// The sibling-repo report of 2026-11-24, command for command: nvm.sh sourced from `~`, then `nvm use`, in a dirty
// checkout. The fixture carries nvm.sh's shapes that broke the read - a case pattern holding a `/`, and `nvm` as a
// shell function whose `use` arm runs no git.
test('the rm guard passes the nvm commands of the 2026-11-24 report in a dirty checkout, and still blocks a real discard', () =>
{
    const home = path.join(TMP, 'home');
    const repo = path.join(TMP, 'nvm-repo');
    fs.mkdirSync(path.join(home, '.nvm'), { recursive: true });
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(home, '.nvm', 'nvm.sh'), [
        'nvm_strip_path() {',
        '  case "$1" in',
        '    *[!/]*/) echo "${1%"${1##*[!/]}"}" ;;',
        '    /) echo / ;;',
        '  esac',
        '}',
        'nvm() {',
        '  case "$1" in',
        '    use) nvm_strip_path "$NVM_DIR/versions/node/$2/bin" >/dev/null ;;',
        '    *) return 0 ;;',
        '  esac',
        '}',
        '',
    ].join('\n'));
    const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\n');
    git('init', '-q');
    git('add', 'f.txt');
    git('commit', '-qm', 'i');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'b\n');
    const guard = (command) => spawnSync(process.execPath, [path.join(HOOKS, 'guard-catastrophic-rm.js')],
        { input: JSON.stringify({ session_id: 'nvm-test', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...process.env, HOME: home } }).status;
    for (const command of [
        'source ~/.nvm/nvm.sh >/dev/null && nvm use >/dev/null && npm run validate && npm test',
        'source ~/.nvm/nvm.sh >/dev/null; nvm use >/dev/null; npm test 2>&1 | grep -E "fail|pass"',
        'export PATH=$HOME/.nvm/versions/node/v26.13.1/bin:$PATH; npm test',
        'nvm use 26 && npm test',
    ]) assert.strictEqual(guard(command), 0, command);
    for (const command of [
        'source ~/.nvm/nvm.sh >/dev/null && nvm use >/dev/null && git checkout -- .',
        'source ~/.nvm/nvm.sh; nvm use 26; git restore f.txt',
    ]) assert.strictEqual(guard(command), 2, command);
});
