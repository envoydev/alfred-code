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

test('malformed input never throws', withFixture((fx) => {
  for (const payload of [{ tool_name: 'Read', tool_input: {} }, { tool_name: 'Grep', tool_input: {} }, { tool_name: 'Glob', tool_input: {} },
    { tool_name: 'Read' }, { tool_name: 'Read', tool_input: { file_path: 7 } }, { tool_name: 'Glob', tool_input: { pattern: null } }]) passes(fx, payload, {}, JSON.stringify(payload));
  const env = envOf(fx);
  delete env.HOME; delete env.USERPROFILE;
  const r = spawnSync(process.execPath, [GUARD], { cwd: fx.proj, encoding: 'utf8', env, input: JSON.stringify({ cwd: fx.proj, session_id: 'xr', hook_event_name: 'PreToolUse', ...read(fx.other) }) });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '', 'no home to measure from: nothing asked');
}));
