// The read half of guard-cross-project-write.js: a Read, Grep or Glob past the workspace, inside the project zone under
// HOME, asks the user first (plan outside-workspace-reads, task 1). Every case runs the guard as its own process under a
// fake HOME, so what is pinned is the verdict a session would see.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
const { scrubbed, verdictOf, askText, blockText } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { putWorkspace } = require('./workspace-fixture.js');

const GUARD = path.join(__dirname, '..', 'stack', 'hooks', 'guard-cross-project-write.js');
const PLUGIN_ROOT = path.join(__dirname, '..');
const STRIPPED = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PROJECT_DIR_NAME', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE'];
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
const keyOf = (dir) => fs.realpathSync.native(dir).normalize('NFC').replace(/[^A-Za-z0-9]/g, '-');

// A fake home holding the project (work/proj) and the folders the zone rules tell apart.
function fixture() {
  const outer = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'xread-')));
  const home = path.join(outer, 'home');
  const at = (...parts) => path.join(home, ...parts);
  const put = (rel, text = 'x\n') => { const file = at(...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const proj = at('work', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  git(proj, 'init', '-q');
  put('work/proj/x');
  const other = put('other-proj/notes.md');
  for (const rel of ['.nvm/x', 'go/pkg/mod/x', 'go/src/other/x', 'miniconda3/lib/x', 'Android/Sdk/x', 'tmp-area/t.txt']) put(rel);
  const own = put(`.claude/projects/${keyOf(proj)}/memory/MEMORY.md`);
  const foreign = put('.claude/projects/-elsewhere-other-key/memory/MEMORY.md');
  return { outer, home, at, put, proj, other, own, foreign, tmp: at('tmp-area'), rm: () => fs.rmSync(outer, { recursive: true, force: true }) };
}
function envOf(fx, extra = {}) {
  const env = scrubbed();
  for (const k of STRIPPED) delete env[k];
  return { ...env, HOME: fx.home, USERPROFILE: fx.home, TMPDIR: fx.tmp, TEMP: fx.tmp, TMP: fx.tmp, CLAUDE_PROJECT_DIR: fx.proj, ...extra };
}
function run(fx, payload, env = {}, session = 'xr') {
  return spawnSync(process.execPath, [GUARD], {
    cwd: fx.proj, encoding: 'utf8', env: envOf(fx, env),
    input: JSON.stringify({ cwd: fx.proj, session_id: session, hook_event_name: 'PreToolUse', ...payload }),
  });
}
const read = (file, more = {}) => ({ tool_name: 'Read', tool_input: { file_path: file }, ...more });
const grep = (dir, more = {}) => ({ tool_name: 'Grep', tool_input: { pattern: 'x', ...(dir ? { path: dir } : {}) }, ...more });
const glob = (pattern, dir, more = {}) => ({ tool_name: 'Glob', tool_input: { pattern, ...(dir ? { path: dir } : {}) }, ...more });
const blockRows = (fx, session) => {
  const file = path.join(fx.proj, '.alfred', 'statistics', 'hook-blocks', `${session}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
function passes(fx, payload, env, why) {
  const r = run(fx, payload, env);
  assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
  assert.strictEqual(r.stdout, '', `${why}: ${r.stdout}`);
}
function asks(fx, payload, env, why) {
  const r = run(fx, payload, env);
  assert.strictEqual(verdictOf(r), 'ask', `${why}: ${r.stdout}${r.stderr}`);
  return r;
}
// Runs `body` with a fresh fixture and removes it after.
const withFixture = (body) => () => { const fx = fixture(); try { body(fx); } finally { fx.rm(); } };

test('read of another project asks, naming the workspace end', withFixture((fx) => {
  const r = asks(fx, read(fx.other), {}, 'a Read of a sibling project');
  const shown = askText(r);
  assert.match(shown, /outside this workspace/);
  assert.match(shown, /workspace only/);
  assert.ok(shown.includes(fx.proj.replace(fx.home, '~')) || shown.includes(fx.proj), `names where the workspace ends: ${shown}`);
  assert.ok(shown.includes('~'), 'the home folder is shown as ~');
  assert.match(blockText(r), /Stay inside the workspace, or ask the user in chat/, 'the model is told what to do after a No');
  assert.match(blockText(r), /join that project to the workspace, or list it in ALFRED_CODE_ALLOW_WRITE_OUTSIDE/, 'the model is told the two levers');
  assert.strictEqual(blockRows(fx, 'xr')[0].detail.branch, 'read-outside');
}));

test('the same read is denied where nobody can answer', withFixture((fx) => {
  const r = run(fx, read(fx.other, { permission_mode: 'dontAsk' }));
  assert.strictEqual(verdictOf(r), 'deny', r.stdout);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /outside this workspace/);
}));

test('reads inside the project, a dot-folder, a toolchain folder, a system file and the temp dir pass', withFixture((fx) => {
  const system = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'win.ini') : '/usr/include/stdio.h';
  const files = [path.join(fx.proj, 'x'), fx.at('.nvm', 'x'), fx.at('go', 'pkg', 'mod', 'x'), fx.at('miniconda3', 'lib', 'x'), fx.at('Android', 'Sdk', 'x'), path.join(fx.tmp, 't.txt')];
  if (fs.existsSync(system)) files.push(system);
  for (const file of files) passes(fx, read(file), {}, file);
}));

test('go/src holds projects', withFixture((fx) => {
  asks(fx, read(fx.at('go', 'src', 'other', 'x')), {}, '~/go/src is not a module cache');
}));

test('a seat\'s read asks and tells the seat to stop', withFixture((fx) => {
  const r = asks(fx, read(fx.other, { agent_id: 'a1', agent_type: 'related-project-analyzer' }), {}, 'a seat past the workspace');
  assert.match(blockText(r), /A subagent does not read outside/);
  assert.match(askText(r), /outside this workspace/, 'the user sees the same verdict');
}));

test('a trusted memory folder under home passes', withFixture((fx) => {
  const memory = fx.put('notes/proj-memory/MEMORY.md');
  const setting = JSON.stringify({ autoMemoryDirectory: path.dirname(memory) });
  fx.put('work/proj/.claude/settings.local.json', setting);
  passes(fx, read(memory), {}, 'the memory folder an untracked settings.local.json names');
  fs.rmSync(path.join(fx.proj, '.claude', 'settings.local.json'));
  fx.put('work/proj/.claude/settings.json', setting);
  asks(fx, read(memory), {}, 'a project settings.json can arrive in a clone and opens nothing');
}));

test('a related-projects entry opens nothing', withFixture((fx) => {
  fx.put('work/proj/RELATED-PROJECTS-AWARENESS.md', '- name: other-proj\n  location: ~/other-proj\n');
  asks(fx, read(fx.other), {}, 'a file the model can write unlocks no read');
}));

test('own memory passes with no workspace', withFixture((fx) => {
  passes(fx, read(fx.own), { ALFRED_CODE_WORKSPACE: '0' }, 'the switch off');
  passes(fx, read(fx.own), {}, 'a project in no workspace');
  asks(fx, read(fx.foreign), { ALFRED_CODE_WORKSPACE: '0' }, 'another project\'s memory, switch off');
  asks(fx, read(fx.foreign), {}, 'another project\'s memory');
}));

test('a workspace member\'s memory and files pass', withFixture((fx) => {
  const work = fx.at('work');
  const sib = fx.at('work', 'sib');
  fx.put('work/sib/x');
  git(sib, 'init', '-q');
  const memory = fx.put(`.claude/projects/${keyOf(sib)}/memory/MEMORY.md`);
  const top = fx.put(`.claude/projects/${keyOf(work)}/memory/MEMORY.md`);
  fx.put('work/.claude/alfred-code.stamp', 'sha: x\n');
  fx.put('work/proj/.claude/alfred-code.stamp', 'sha: x\n');
  putWorkspace(work, { children: ['proj', 'sib'] });
  putWorkspace(fx.proj, { parent: '..' });
  passes(fx, read(path.join(sib, 'x')), {}, 'a sibling inside the workspace');
  passes(fx, read(memory), {}, 'a member\'s memory');
  passes(fx, read(top), {}, 'the root\'s memory');
  asks(fx, read(fx.foreign), {}, 'a stranger\'s memory');
  asks(fx, read(fx.other), {}, 'a folder beside the workspace');
}));

test('a link inside the project is the project\'s', { skip: process.platform === 'win32' && 'symlinks need privileges' }, withFixture((fx) => {
  fs.mkdirSync(path.join(fx.proj, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.dirname(fx.other), path.join(fx.proj, 'node_modules', 'dep'), 'dir');
  passes(fx, read(path.join(fx.proj, 'node_modules', 'dep', 'notes.md')), {}, 'a linked dependency, judged as written');
  asks(fx, read(fx.other), {}, 'the same file by its own path');
}));

test('a linked worktree of this repository passes', withFixture((fx) => {
  git(fx.proj, 'add', '-A');
  git(fx.proj, 'commit', '-qm', 'seed');
  const feature = fx.at('work', 'proj-feature');
  assert.strictEqual(git(fx.proj, 'worktree', 'add', '-q', '-b', 'feature', feature).status, 0);
  passes(fx, read(path.join(feature, 'x')), {}, 'a worktree of the same repository');
}));

test('Grep at home searches outside', withFixture((fx) => {
  asks(fx, grep(fx.home), {}, 'the home folder');
  assert.strictEqual(blockRows(fx, 'xr')[0].detail.branch, 'search-outside');
  asks(fx, grep(path.parse(fx.home).root), {}, 'the filesystem root');
  asks(fx, grep(path.dirname(fx.home)), {}, 'the folder holding the home folder');
  asks(fx, grep(path.dirname(fx.other)), {}, 'a project folder');
  passes(fx, grep(), {}, 'no path searches the working directory');
  passes(fx, grep(fx.proj), {}, 'the project');
}));

test('Glob patterns are judged by their fixed prefix', withFixture((fx) => {
  asks(fx, glob(`${fx.home}/**/*.db`), {}, 'an absolute pattern at home');
  asks(fx, glob('~/**/*.db'), {}, 'a pattern starting with ~');
  asks(fx, glob(`${fx.home}/other-pro*/x`), {}, 'a glob cutting a folder name judges the folder above');
  asks(fx, glob('*.md', fx.home), {}, 'a path at home');
  passes(fx, glob('**/*.js'), {}, 'a relative pattern, no path');
  passes(fx, glob(`${fx.proj}/**/*.js`), {}, 'an absolute pattern in the project');
}));

test('ALLOW_WRITE_OUTSIDE opens reads', withFixture((fx) => {
  passes(fx, read(fx.other), { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: path.dirname(fx.other) }, 'a tree the user named');
}));

test('the read part switch turns reads off alone', withFixture((fx) => {
  passes(fx, read(fx.other), { ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write:read' }, 'the read part off');
  const write = run(fx, { tool_name: 'Write', tool_input: { file_path: path.join(fx.other, '..', 'new.txt'), content: 'x' } }, { ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write:read' });
  assert.strictEqual(verdictOf(write), 'ask', 'the write half still asks');
}));

test('stand-downs never ask about a read', withFixture((fx) => {
  passes(fx, read(fx.other), { ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write' }, 'the hook off');
  passes(fx, read(fx.other), { CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal' }, 'the minimal profile');
  passes(fx, read(fx.other, { cursor_version: '1.7.0' }), {}, 'a Cursor payload');
  passes(fx, read(fx.other), { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, 'a repo never set up');
  fx.put('work/proj/.claude/alfred-code.stamp', 'sha: x\n');
  asks(fx, read(fx.other), { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, 'the same repo once set up');
  fx.put('work/proj/.claude/hooks/guard-cross-project-write.js', '// copied\n');
  fx.put('work/proj/.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-cross-project-write.js"', timeout: 10 }] }] } }));
  passes(fx, read(fx.other), { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, 'a wired copied twin judges it, not the plugin');
}));

test('long paths keep the required words on the prompt', withFixture((fx) => {
  const long = (name) => fx.put(`${name}${'d'.repeat(120 - name.length)}/f.txt`);
  const first = long('first-');
  const second = long('second-');
  const r = asks(fx, glob(`${path.dirname(second)}/*.txt`, path.dirname(first)), {}, 'two long zone paths in one Glob');
  assert.match(askText(r), /outside this workspace/);
  assert.match(askText(r), /workspace only/);
  assert.match(blockText(r), /Approve only if you meant to look there/);
}));

test('malformed input never throws, and a HOME unset falls back to the account home (the empty-home path is the HOME=/ case below)', withFixture((fx) => {
  for (const payload of [{ tool_name: 'Read', tool_input: {} }, { tool_name: 'Grep', tool_input: {} }, { tool_name: 'Glob', tool_input: {} },
    { tool_name: 'Read' }, { tool_name: 'Read', tool_input: { file_path: 7 } }, { tool_name: 'Glob', tool_input: { pattern: null } }]) passes(fx, payload, {}, JSON.stringify(payload));
  const env = envOf(fx);
  delete env.HOME; delete env.USERPROFILE;
  const r = spawnSync(process.execPath, [GUARD], { cwd: fx.proj, encoding: 'utf8', env, input: JSON.stringify({ cwd: fx.proj, session_id: 'xr', hook_event_name: 'PreToolUse', ...read(fx.other) }) });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '', 'a home that is the account\'s own: a path outside it is nobody\'s zone');
}));

test('Grep at ~/.claude searches every other project\'s memory', withFixture((fx) => {
  asks(fx, grep(fx.at('.claude')), {}, 'the account dir holds projects/');
  assert.strictEqual(blockRows(fx, 'xr')[0].detail.branch, 'search-outside');
  asks(fx, glob('*.md', fx.at('.claude')), {}, 'a Glob at the account dir');
  asks(fx, glob(`${fx.at('.claude')}/**/MEMORY.md`), {}, 'a pattern prefix at the account dir');
  asks(fx, grep(fx.at('.claude', 'projects')), {}, 'projects/ itself');
  passes(fx, grep(path.dirname(fx.own)), {}, 'this project\'s own memory folder');
  passes(fx, grep(fx.put('.claude/plugins/p/x') && fx.at('.claude', 'plugins')), {}, 'the account dir\'s plugins/ holds no projects/');
}));

test('a relocated CLAUDE_CONFIG_DIR under home is searched like ~/.claude', withFixture((fx) => {
  fx.put('cfg/projects/-elsewhere/x');
  asks(fx, grep(fx.at('cfg')), { CLAUDE_CONFIG_DIR: fx.at('cfg') }, 'a search over the relocated account dir');
}));

test('a dot-folder, toolchain or account-dir Read starts no git in a project with a trusted memory folder', { skip: process.platform === 'win32' && 'a shell stub' }, withFixture((fx) => {
  const memory = fx.put('notes/proj-memory/MEMORY.md');
  fx.put('work/proj/.claude/settings.local.json', JSON.stringify({ autoMemoryDirectory: path.dirname(memory) }));
  const bin = fx.put('bin/git', `#!/bin/sh\necho "$@" >> '${fx.at('git-calls.log')}'\nexec '${spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()}' "$@"\n`);
  fs.chmodSync(bin, 0o755);
  const env = { PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH}` };
  const calls = () => (fs.existsSync(fx.at('git-calls.log')) ? fs.readFileSync(fx.at('git-calls.log'), 'utf8').trim().split('\n').filter(Boolean).length : 0);
  for (const file of [fx.at('.nvm', 'x'), fx.at('go', 'pkg', 'mod', 'x'), fx.at('.claude', 'plugins', 'cache', 'x'), path.join(fx.proj, 'x')]) passes(fx, read(file), env, file);
  assert.strictEqual(calls(), 0, 'no git for a path the cheap tests already settle');
  asks(fx, read(fx.other), env, 'a zone path still checks the memory folder');
  assert.strictEqual(calls(), 1, 'one git call for the memory folder, shared by the write-half and read-half readers');
}));

test('HOME set to a filesystem root is no home: nothing is in the zone', { skip: process.platform === 'win32' && 'POSIX root' }, withFixture((fx) => {
  const root = path.parse(fx.home).root;
  passes(fx, read(fx.other), { HOME: root, USERPROFILE: root }, 'a file under a home of /');
  passes(fx, grep(fx.home), { HOME: root, USERPROFILE: root }, 'a search under a home of /');
  passes(fx, read(process.execPath), { HOME: root, USERPROFILE: root }, 'a system file: the node binary');
}));

test('cross-read.js: the pure parts of the read half', () => {
  const cross = require('../stack/hooks/cross-read.js');
  assert.strictEqual(cross.globPrefix('C:/**/*.db'), 'C:\\', 'a bare drive is the drive root, not the drive\'s cwd');
  assert.strictEqual(cross.globPrefix('c:\\**\\x'), 'c:\\');
  assert.strictEqual(cross.globPrefix('C:/Users/**/x'), 'C:/Users');
  assert.strictEqual(cross.globPrefix('/Users/me/pro*/x'), '/Users/me');
  assert.strictEqual(cross.globPrefix('/**/x'), '/');
  assert.strictEqual(cross.globPrefix('~/**/*.db'), '~');
  assert.strictEqual(cross.globPrefix('**/*.js'), '');
  assert.strictEqual(cross.globPrefix('src/{a,b}/x'), 'src');
  const apart = (rel, platform) => cross.firstSegmentApart(rel.split('/'), platform);
  assert.ok(apart('.nvm/x', 'linux') && apart('go/pkg/mod', 'linux') && apart('Android/Sdk', 'linux') && apart('development/flutter/bin', 'linux'));
  assert.ok(!apart('go/src/x', 'linux') && !apart('other-proj/x', 'linux') && !apart('go', 'linux'));
  assert.ok(apart('Library/x', 'darwin') && !apart('Library/x', 'linux') && apart('AppData/x', 'win32') && !apart('AppData/x', 'darwin'));
  assert.ok(apart('ANDROID/x', 'darwin') && !apart('ANDROID/x', 'linux'), 'case folds where the disk folds');
  const hits = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ tool: 'Grep', path: `/home/me/${n}` }));
  const text = cross.readText(hits, { boundary: '/home/me/work/proj', homes: ['/home/me'], seat: false, platform: 'linux' });
  assert.ok(text.startsWith('Grep reads outside this workspace (it ends at ~/work/proj) - No keeps the work workspace only: ~/a, ~/b, ~/c and 2 more. Approve only if you meant to look there.\n'), text);
  assert.match(text, /Stay inside the workspace, or ask the user in chat/);
  assert.match(text, /join that project to the workspace, or list it in ALFRED_CODE_ALLOW_WRITE_OUTSIDE/);
  assert.match(cross.readText(hits.slice(0, 1), { boundary: '/b', homes: [], seat: true, platform: 'linux' }), /A subagent does not read outside/);
});

test('cross-read.js ships with the copied hooks, and a guard beside no copy of it reads nothing', withFixture((fx) => {
  assert.ok(require('./install/alfred-code.js').HOOK_MODULES.includes('cross-read.js'), 'the copy route carries it');
  const hooks = path.join(__dirname, '..', 'stack', 'hooks');
  const copy = path.join(fx.outer, 'hooks-copy');
  fs.mkdirSync(copy);
  for (const f of fs.readdirSync(hooks)) if (fs.statSync(path.join(hooks, f)).isFile() && f !== 'cross-read.js') fs.copyFileSync(path.join(hooks, f), path.join(copy, f));
  const runCopy = () => spawnSync(process.execPath, [path.join(copy, 'guard-cross-project-write.js')], {
    cwd: fx.proj, encoding: 'utf8', env: envOf(fx), input: JSON.stringify({ cwd: fx.proj, session_id: 'xr', hook_event_name: 'PreToolUse', ...read(fx.other) }),
  });
  const without = runCopy();
  assert.strictEqual(without.status, 0, without.stderr);
  assert.strictEqual(without.stdout, '', 'the read half fails open with the module missing');
  fs.copyFileSync(path.join(hooks, 'cross-read.js'), path.join(copy, 'cross-read.js'));
  assert.strictEqual(verdictOf(runCopy()), 'ask', 'the same copy asks once the module is beside it');
}));

// ---- the shell route and the one-prompt join (plan outside-workspace-reads, task 2) ----------------------------------
const bash = (command, more = {}) => ({ tool_name: 'Bash', tool_input: { command }, ...more });
const reasonOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
const contextOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const count = (text, part) => text.split(part).length - 1;

test('a database opened by name asks', withFixture((fx) => {
  const db = fx.put('other-proj/mem.db');
  const r = asks(fx, bash(`sqlite3 ${db} "delete from t"`), {}, 'a database by its path');
  assert.match(askText(r), /^alfred-code guard-cross-project-write: Bash reads outside this workspace/);
  assert.strictEqual(blockRows(fx, 'xr')[0].detail.branch, 'read-outside');
  assert.deepStrictEqual(blockRows(fx, 'xr')[0].detail.names, ['mem.db'], 'basenames only');
  asks(fx, bash(`cat ${fx.other}`), {}, 'a plain cat');
  asks(fx, bash(`cat ${path.dirname(fx.other)}/*.md`), {}, 'a glob names the folder it starts in');
  asks(fx, bash('cat "$HOME/other-proj/notes.md"'), {}, 'a $HOME spelling');
  asks(fx, bash('cat ~/other-proj/notes.md'), {}, 'a ~ spelling');
  asks(fx, bash(`grep -c x < ${fx.other}`), {}, 'an input redirect');
  passes(fx, bash(`echo x > ${path.join(fx.proj, 'out.txt')}`), {}, 'an output redirect inside the project');
}));

test('a home search asks', withFixture((fx) => {
  const outer = path.dirname(fx.home);
  for (const command of ["find ~ -name '*.db'", `find ${outer} -name x`, 'find / -name x', `rg x ${outer}`, `grep -r x ${fx.home}`]) {
    asks(fx, bash(command), {}, command);
    const rows = blockRows(fx, 'xr');
    assert.strictEqual(rows[rows.length - 1].detail.branch, 'search-outside', command);
  }
  passes(fx, bash(`ls ${fx.home}`), {}, 'a listing of the home folder names no project');
  passes(fx, bash('find . -name x'), {}, 'a search in the project');
  passes(fx, bash('git status'), {}, 'a plain git call');
}));

test('a cd anchor is followed', withFixture((fx) => {
  asks(fx, bash(`cd ${path.dirname(fx.other)} && cat notes.md`), {}, 'a relative word after a cd out');
  asks(fx, bash('ls ..'), {}, '.. from the project is the folder above it');
  passes(fx, bash('cd src 2>/dev/null; cat x'), {}, 'a cd that stays in the project');
}));

test('an inline script naming a path asks', withFixture((fx) => {
  asks(fx, bash(`node -e "require('fs').readFileSync('${fx.other}')"`), {}, 'node -e');
  asks(fx, bash(`python3 -c "open('${fx.other}').read()"`), {}, 'python3 -c');
  asks(fx, bash(`bash -c 'cat ${fx.other}'`), {}, 'bash -c');
  passes(fx, bash('node -e "console.log(1/2, \'a\')"'), {}, 'a script naming no path');
}));

test('prose never asks', withFixture((fx) => {
  const other = path.dirname(fx.other);
  passes(fx, bash(`git commit -m "see ${other}"`), {}, 'a commit message');
  passes(fx, bash(`git commit -m ${other}`), {}, 'a commit message that is only a path');
  passes(fx, bash('gh pr create --body "see ~/other-proj"'), {}, 'a PR body');
  passes(fx, bash(`gh pr create --title x --body=${other}`), {}, 'a PR body with =');
  passes(fx, bash(`echo ${other}`), {}, 'echo');
  passes(fx, bash(`printf '%s' ${fx.other}`), {}, 'printf');
  passes(fx, bash(`git commit -m "$(cat <<'EOF'\nsee ${fx.other}\nEOF\n)"`), {}, 'a commit message heredoc');
  passes(fx, bash(`cat <<'EOF' > ${path.join(fx.proj, 'note.txt')}\nsee ${fx.other}\nEOF\n`), {}, 'a heredoc written to a project file');
}));

test('system paths and missing paths pass', withFixture((fx) => {
  if (process.platform !== 'win32') passes(fx, bash('cat /etc/hosts'), {}, 'a system file');
  passes(fx, bash(`cat ${path.join(path.dirname(fx.other), 'missing.txt')}`), {}, 'a path that does not exist');
  passes(fx, bash(`cat ${fx.at('.nvm', 'x')}`), {}, 'a dot-folder');
  passes(fx, bash(`cat ${path.join(fx.proj, 'x')}`), {}, 'the project');
}));

test('an unread script beside a zone read names the read', withFixture((fx) => {
  const { SCAN_LIMITS } = require('../stack/hooks/hook-prelude.js');
  const huge = fx.put('scratch/huge.sh', `${'#'.repeat(SCAN_LIMITS.bytes + 1024)}\necho done\n`);
  const r = asks(fx, bash(`sqlite3 ${fx.put('other-proj/mem.db')} 'select 1'; bash ${huge}`), {}, 'an unreadable script and a zone read');
  assert.match(reasonOf(r), /also reads outside this workspace/);
  assert.match(contextOf(r), /could not read/);
}));

test('a seat\'s write beside a zone read names the read', withFixture((fx) => {
  fx.put('other-proj/a');
  const r = asks(fx, bash(`cat ${fx.at('other-proj', 'a')} > ${fx.at('other-proj', 'b')}`, { agent_id: 'a1', agent_type: 'related-project-analyzer' }), {}, 'a seat');
  assert.match(reasonOf(r), /also reads outside this workspace/);
  assert.match(contextOf(r), /A subagent never writes outside/);
}));

test('a drive path is a candidate on win32', { skip: process.platform !== 'win32' && 'a Windows spelling' }, withFixture((fx) => {
  asks(fx, bash(`type ${fx.other.replace(/\//g, '\\')}`), {}, 'a drive path');
}));

test('the also-reads clause survives long write paths', withFixture((fx) => {
  const long = (name) => fx.put(`${name}${'d'.repeat(120 - name.length)}/f.txt`);
  const first = long('first-');
  const r = asks(fx, bash(`cat ${first} > ${path.join(path.dirname(first), 'out'.padEnd(120, 'o'))}`), {}, 'long paths');
  assert.match(reasonOf(r), /also reads outside this workspace/);
}));

test('a read-only call is not joined twice', withFixture((fx) => {
  const r = asks(fx, bash(`cat ${fx.other}`), {}, 'a read-only call');
  assert.strictEqual(count(reasonOf(r), 'outside this workspace'), 1);
  assert.doesNotMatch(reasonOf(r), /Also:/);
  assert.doesNotMatch(contextOf(r), /Also:/);
}));

test('one prompt names both halves', withFixture((fx) => {
  fx.put('other-proj/a');
  const a = fx.at('other-proj', 'a');
  const both = asks(fx, bash(`cat ${a} > ${fx.at('other-proj', 'b')}`), {}, 'a read and a write past the boundary');
  assert.match(reasonOf(both), /also reads outside this workspace/);
  assert.match(reasonOf(both), /other-proj/, 'names the write target');
  assert.match(contextOf(both), /Also: .*outside this workspace/);
  assert.ok(contextOf(both).includes('~/other-proj/a'), contextOf(both));
  const readOnly = asks(fx, bash(`cat ${a} > ${path.join(fx.proj, 'b')}`), {}, 'a read with a write inside');
  assert.match(reasonOf(readOnly), /Bash reads outside this workspace/);
  assert.doesNotMatch(reasonOf(readOnly), /also reads/);
}));

test('65 path words judge only 64', withFixture((fx) => {
  const files = Array.from({ length: 65 }, (_, i) => fx.put(`other-proj/f${i}.txt`));
  const r = asks(fx, bash(`cat ${files.join(' ')}`), {}, '65 existing zone paths');
  assert.match(blockText(r), /and 61 more/);
  assert.strictEqual(blockText(r).split(', ').length - 1 >= 2, true);
}));

test('long zone paths in one shell call keep both required phrases before the paths', withFixture((fx) => {
  const long = (name) => fx.put(`${name}${'d'.repeat(200 - name.length)}/f.txt`);
  const files = ['aa-', 'bb-', 'cc-', 'dd-'].map(long);
  const r = asks(fx, bash(`cat ${files.join(' ')}`), {}, 'four long zone paths');
  const shown = askText(r);
  assert.ok(shown.indexOf('outside this workspace') >= 0 && shown.indexOf('workspace only') >= 0, shown);
  assert.ok(shown.indexOf('workspace only') < shown.indexOf('~/aa-'), 'the phrases come before the first path');
  assert.match(blockText(r), /and 1 more\./);
  assert.match(blockText(r), /Approve only if you meant to look there/);
}));

test('the shell route honours the switches and the allowance', withFixture((fx) => {
  passes(fx, bash(`cat ${fx.other}`), { ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write:read' }, 'the read part off');
  passes(fx, bash(`cat ${fx.other}`), { ALFRED_CODE_ALLOW_WRITE_OUTSIDE: path.dirname(fx.other) }, 'a tree the user named');
  passes(fx, bash(`cat ${fx.other}`), { ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write' }, 'the hook off');
  const denied = run(fx, bash(`cat ${fx.other}`, { permission_mode: 'dontAsk' }));
  assert.strictEqual(verdictOf(denied), 'deny');
}));

// ---- fix round 1 of the review of task 2 ------------------------------------------------------------------------------
test('a search verb\'s pattern is no root, and a quoted ~ is no home', withFixture((fx) => {
  fx.put('work/proj/package.json', '{}\n');
  fx.put('work/proj/src/a.js');
  for (const command of ['grep -rn "~/.claude" src', 'rg -n "~/.claude/projects" src', 'grep -rn "$HOME" src', 'grep -n "/" package.json', "rg '/' src",
    "grep -c '~' package.json", "grep -rn '/Users/' .", 'grep -e "/" -r src', 'grep -F -n "/" package.json', 'cat "~/.claude/x"']) passes(fx, bash(command), {}, command);
  asks(fx, bash(`grep -r x ${path.dirname(fx.other)}`), {}, 'a real root still asks');
  asks(fx, bash(`grep -rn "/" ${fx.other}`), {}, 'the files after the pattern are roots');
  asks(fx, bash(`rg -f ${fx.other} src`), {}, '-f names a file that is read');
  asks(fx, bash(`grep -F x ${fx.other}`), {}, '-F is a grep flag, not a sentence flag');
  asks(fx, bash(`grep -m 1 -e foo ${fx.other}`), {}, 'a flag value is not the pattern');
  passes(fx, bash(`git commit -F ${fx.other}`), {}, '-F names a message file for git');
}));

test('find judges its own roots, also when it runs another command', withFixture((fx) => {
  const db = fx.put('other-proj/mem.db');
  for (const command of ["find ~ -name '*.db' -exec sqlite3 {} .tables \;", `find ${path.dirname(db)} -name '*.md' -exec cat {} \;`,
    `find ${path.dirname(db)} -name '*.md' -exec cat {} +`, 'find ~ -name x -exec echo {} \;', `sudo -u root find ${path.dirname(db)} -name x`, 'du -sh ~', 'ls -R ~',
    'Get-ChildItem -Recurse ~', 'gci -Recurse ~']) {
    asks(fx, bash(command), {}, command);
  }
  passes(fx, bash('ls ~'), {}, 'a plain listing of home');
  passes(fx, bash('find . -name x -exec cat {} \;'), {}, 'a search in the project');
  passes(fx, bash('locate notes'), {}, 'locate with a word that is no path');
}));

test('a $HOME spelling inside a script word is expanded', withFixture((fx) => {
  asks(fx, bash("bash -c 'cat $HOME/other-proj/notes.md'"), {}, '$HOME in bash -c');
  asks(fx, bash('python3 -c "open(\'$HOME/other-proj/notes.md\').read()"'), {}, '$HOME in python -c');
  asks(fx, bash("sh -c 'cat ${HOME}/other-proj/notes.md'"), {}, '${HOME} in sh -c');
  passes(fx, bash("bash -c 'cat $HOME/missing-proj/notes.md'"), {}, 'a path that does not exist');
}));

test('a script a shell or a runtime is handed is read for paths', withFixture((fx) => {
  const db = fx.put('other-proj/mem.db');
  asks(fx, bash(`bash <<'X'\ncat ${fx.other}\nX\n`), {}, 'a heredoc into a shell');
  asks(fx, bash(`python3 - <<'X'\nsqlite3.connect('${db}').execute('delete from t')\nX\n`), {}, 'a heredoc into a runtime');
  asks(fx, bash(`bash <<< "cat ${fx.other}"`), {}, 'a here-string into a shell');
  asks(fx, bash(`xargs cat <<< ${fx.other}`), {}, 'a here-string of a path');
  asks(fx, bash(`echo 'cat ${fx.other}' | bash`), {}, 'a script piped into a shell');
  asks(fx, bash(`cd ${path.dirname(db)} && bash <<'X'\ncat notes.md\nX\n`), {}, 'a heredoc after a cd out');
  fx.put('work/proj/run.sh', `cat ${fx.other}\n`);
  asks(fx, bash('bash run.sh'), {}, 'a script file the shell runs');
  fx.put('work/proj/ok.sh', 'cat x\n');
  passes(fx, bash('bash ok.sh'), {}, 'a script file naming only project files');
  passes(fx, bash("bash <<'X'\ncat x\nX\n"), {}, 'a heredoc naming only the project');
}));

test('the plugin\'s own root is open to read, a sibling folder is not', withFixture((fx) => {
  fx.put('work/proj/.claude/alfred-code.stamp', 'sha: x\n');
  const plugin = path.dirname(fx.put('plugin-dev/guard-secret-value.js', '// guard\n'));
  const env = { CLAUDE_PLUGIN_ROOT: plugin };
  passes(fx, bash(`node "${path.join(plugin, 'guard-secret-value.js')}" --with-sensitive -- "true"`), env, 'the runner call');
  passes(fx, read(path.join(plugin, 'guard-secret-value.js')), env, 'a Read inside the plugin root');
  asks(fx, bash(`node "${fx.put('other-tool/run.js', '// x\n')}"`), env, 'a sibling folder');
  asks(fx, read(fx.other), env, 'another project');
  asks(fx, bash(`cat ${path.join(plugin, 'guard-secret-value.js')}`), { CLAUDE_PLUGIN_ROOT: fx.at('elsewhere') }, 'with the root elsewhere the folder asks');
  asks(fx, read(fx.other), { CLAUDE_PLUGIN_ROOT: fx.home }, 'a plugin root holding the home folder opens nothing');
}));

test('the dispatcher gives ONE ask for a write past the project and a read past the workspace', withFixture((fx) => {
  fx.put('other-proj/a');
  const dispatcher = path.join(__dirname, '..', 'stack', 'hooks', 'shell-guards.js');
  const r = spawnSync(process.execPath, [dispatcher], {
    cwd: fx.proj, encoding: 'utf8', env: envOf(fx),
    input: JSON.stringify({ cwd: fx.proj, session_id: 'xr', hook_event_name: 'PreToolUse', ...bash(`cat ${fx.at('other-proj', 'a')} > ${fx.at('other-proj', 'b')}`) }),
  });
  assert.strictEqual(verdictOf(r), 'ask', `${r.stdout}${r.stderr}`);
  assert.strictEqual(r.stdout.trim().split('\n').length, 1, 'one JSON answer');
  const reason = reasonOf(r);
  assert.match(reason, /^alfred-code guard-cross-project-write: this call also reads outside this workspace/, 'the clause comes first');
  assert.strictEqual(count(reason, 'also reads outside this workspace'), 1);
  assert.match(contextOf(r), /Also: Bash reads outside this workspace/);
  assert.match(contextOf(r), /~\/other-proj\/a/);
}));

// ---- fix round 2 of the review of task 2 ------------------------------------------------------------------------------
test('-F is a sentence flag only for a git commit or tag', withFixture((fx) => {
  fx.put('work/proj/msg.txt');
  for (const command of [`tail -F ${fx.other}`, `ls -F ${fx.other}`, `less -F ${fx.other}`, `grep -F x ${fx.other}`]) asks(fx, bash(command), {}, command);
  for (const command of ['git commit -F msg.txt', `git commit -F ${fx.other}`, `git tag -a v1 -F ${fx.other}`]) passes(fx, bash(command), {}, command);
}));

test('a pattern verb whose flag means no pattern keeps its first word as a root', withFixture((fx) => {
  for (const command of ['rg --files ~', `rg --files ${fx.other}`, `ag -g foo ${fx.other}`, `ack -g foo ${fx.other}`, `ack -f ${fx.other}`, `ack -f --type=js ${fx.other}`, `rg -e x ${fx.other}`, `grep -ne x ${fx.other}`]) {
    asks(fx, bash(command), {}, command);
  }
  passes(fx, bash(`rg --files-with-matches "~/.claude" src`), {}, 'a pattern that is a quoted tilde');
}));

test('each pattern verb has its own value flags, and a short cluster ends in the flag that takes a value', withFixture((fx) => {
  for (const command of [`grep -T x ${fx.other}`, `grep --color x ${fx.other}`, `grep -rf ${fx.other} src`, `rg -nf ${fx.other} src`, `grep -f ${fx.other} src`, `ag -f x ${fx.other}`]) {
    asks(fx, bash(command), {}, command);
  }
  for (const command of [`grep -A 3 "/" ${path.join(fx.proj, 'x')}`, `grep -nA 3 "/" x`, `rg -g '*.js' "/" src`, `rg -tjs "~/x" src`, `grep -m 1 "/" x`]) passes(fx, bash(command), {}, command);
}));

test('each carried script file is read once for the scan and the read half together', { skip: process.platform === 'win32' && 'a preload path' }, withFixture((fx) => {
  const log = fx.at('opens.log');
  const spy = fx.put('spy/spy.js', `const fs = require('fs');\nconst open = fs.openSync;\nfs.openSync = function (p, ...rest) { if (String(p).endsWith('counted.sh')) fs.appendFileSync(${JSON.stringify(log)}, 'open\\n'); return open.call(this, p, ...rest); };\n`);
  fx.put('work/proj/counted.sh', `echo hi\ncat ${fx.other}\n`);
  const opens = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  for (const command of ['bash counted.sh', 'bash counted.sh; bash counted.sh']) {
    fs.rmSync(log, { force: true });
    asks(fx, bash(command), { NODE_OPTIONS: `--require ${spy}` }, command);
    assert.strictEqual(opens(), 1, `${command}: one open of the script`);
  }
  fs.rmSync(log, { force: true });
  passes(fx, bash('bash counted.sh'), { NODE_OPTIONS: `--require ${spy}`, ALFRED_CODE_HOOKS_OFF: 'guard-cross-project-write:read' }, 'the read half off');
  assert.strictEqual(opens(), 1, 'the scan alone opens it once');
}));

// ---- final review fix wave ---------------------------------------------------------------------------------------------
test('a session launched in a linked worktree or a subfolder reads its own tool-results, another project\'s folder still asks', withFixture((fx) => {
  const launches = [fx.at('work', 'proj', '.claude', 'worktrees', 'feat-1'), fx.at('work', 'proj', 'sub')];
  for (const launch of launches) {
    const folder = `.claude/projects/${keyOf(fx.put(`${path.relative(fx.home, launch)}/x`) && launch)}`;
    const transcript = fx.put(`${folder}/sess-1.jsonl`, '{}\n');
    const result = fx.put(`${folder}/sess-1/tool-results/out.txt`);
    const withTranscript = { transcript_path: transcript };
    passes(fx, read(result, withTranscript), {}, `a Read of the session's own tool-results (${path.basename(launch)})`);
    passes(fx, grep(path.dirname(result), withTranscript), {}, `a Grep of the session's own tool-results (${path.basename(launch)})`);
    asks(fx, read(fx.foreign, withTranscript), {}, 'another project\'s folder asks beside the transcript');
    asks(fx, read(result), {}, 'the same file with no transcript_path asks');
  }
  const outside = fx.put('elsewhere/projects/-x/sess.jsonl', '{}\n');
  asks(fx, read(fx.foreign, { transcript_path: outside }), {}, 'a transcript outside every account projects/ folder adds no key');
}));

test('a directory the user granted Claude Code opens for reads, from the account settings or an untracked local file only', withFixture((fx) => {
  const granted = path.dirname(fx.other);
  const grant = (...dirs) => JSON.stringify({ permissions: { additionalDirectories: dirs } });
  const account = fx.at('.claude', 'settings.json');
  asks(fx, read(fx.other), {}, 'no grant');
  fx.put('.claude/settings.json', grant(granted));
  passes(fx, read(fx.other), {}, 'a directory in the account settings');
  fx.put('.claude/settings.json', grant('~/other-proj'));
  passes(fx, read(fx.other), {}, 'a ~/ entry');
  fx.put('.claude/settings.json', grant('../../other-proj'));
  passes(fx, read(fx.other), {}, 'a relative entry, from the project root');
  fx.put('.claude/settings.json', grant('../other-proj'));
  asks(fx, read(fx.other), {}, 'a relative entry that lands elsewhere opens nothing');
  fx.put('.claude/settings.json', grant('~'));
  asks(fx, read(fx.other), {}, 'an entry that holds the home folder opens nothing');
  fs.rmSync(account);
  const local = path.join(fx.proj, '.claude', 'settings.local.json');
  fx.put('work/proj/.claude/settings.local.json', grant(granted));
  passes(fx, read(fx.other), {}, 'a directory in an untracked settings.local.json');
  assert.strictEqual(git(fx.proj, 'add', '-f', local).status, 0);
  asks(fx, read(fx.other), {}, 'the same file once git tracks it');
  git(fx.proj, 'rm', '-q', '--cached', local);
  fs.rmSync(local);
  fx.put('work/proj/.claude/settings.json', grant(granted));
  asks(fx, read(fx.other), {}, 'a project settings.json can arrive in a clone and opens nothing');
  git(fx.proj, 'add', '-f', path.join(fx.proj, '.claude', 'settings.json'));
  asks(fx, read(fx.other), {}, 'a tracked settings.json opens nothing');
}));

test('a malformed settings file opens nothing and throws nothing', withFixture((fx) => {
  for (const text of ['{ not json', '[]', '{"permissions":7}', '{"permissions":{"additionalDirectories":"x"}}', '{"permissions":{"additionalDirectories":[7,null,""]}}']) {
    fx.put('.claude/settings.json', text);
    fx.put('work/proj/.claude/settings.local.json', text);
    asks(fx, read(fx.other), {}, text);
  }
}));

test('ls -r is a reverse sort, not a recursive search, outside PowerShell', withFixture((fx) => {
  passes(fx, bash('ls -r ~'), {}, 'ls -r ~');
  passes(fx, bash('ls -r /'), {}, 'ls -r /');
  passes(fx, bash(`ls -lr ${fx.home}`), {}, 'ls -lr');
  asks(fx, bash(`ls -R ${path.dirname(fx.other)}`), {}, 'ls -R');
  asks(fx, bash('ls --recursive ~'), {}, 'ls --recursive');
  asks(fx, bash(`Get-ChildItem -recurse ${path.dirname(fx.other)}`), {}, 'Get-ChildItem -recurse');
  asks(fx, bash('gci -r ~'), {}, 'gci -r');
  const powershell = (command) => ({ tool_name: 'PowerShell', tool_input: { command } });
  asks(fx, powershell('ls -r ~'), {}, 'ls -r is Get-ChildItem -Recurse under PowerShell');
  asks(fx, powershell(`dir -Recurse ${path.dirname(fx.other)}`), {}, 'dir -Recurse under PowerShell');
  passes(fx, powershell('ls ~'), {}, 'a plain listing under PowerShell');
}));
