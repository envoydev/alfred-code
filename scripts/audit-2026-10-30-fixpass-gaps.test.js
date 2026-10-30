'use strict';
// Fix pass FC of the 2026-10-30 audit branch: four guard gaps the earlier fix passes left, one block per gap, each with
// its legitimate twins:
// 1. a shell-run string from a variable - `C='rm -rf ~'; bash -c "$C"` (and `sh -c`, `eval`, the runner's line) passed
//    the rm guard: the carried text was the word `$C`, never the literal the command bound it to;
// 2. an unquoted backslash in a word - `cat .e\nv`, `cat \.env`, `c\at .env` - passed the secret guard's path and verb
//    tests, at the top level and inside the runner's line: bash drops the backslash, the guard kept it;
// 3. a script FILE a shell runs - `bash run.sh` with `cat .env` (or the runner's line) in it - passed the secret guard,
//    which read the command and never the file the shared reader already reads;
// 4. a session transcript was writable - the config dir is a write allowance for memory, so a Write, an Edit or a shell
//    append could forge the answer rows every receipt reads, and the payload's own transcript_path was never judged.
// Nothing here runs a dangerous command: each is stdin text to a hook, in mkdtemp folders removed after.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');
const DISPATCH = path.join(HOOKS, 'shell-guards.js');
const GUARD = path.join(HOOKS, 'guard-secret-value.js');
const shell = require(path.join(HOOKS, 'shell-writes.js'));
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixpass-gaps-')));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = path.join(HOME, '.claude');
fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
for (const k of Object.keys(process.env))
  if (/^ALFRED_CODE_/.test(k) || k === 'CLAUDE_PLUGIN_ROOT' || k === 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE') delete process.env[k];

const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
// A set-up project under the sandbox home: a git repo with the install stamp and a credential file.
function project(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(HOME, prefix)));
  git(dir, 'init', '-q', '-b', 'feature');
  git(dir, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'version: 2.0.0\n');
  fs.writeFileSync(path.join(dir, '.env'), `API_TOKEN=${'x0'.repeat(20)}\n`);
  fs.writeFileSync(path.join(dir, 'README.md'), '# readme\n');
  return dir;
}
// A dispatcher's verdict on one call: 2 (exit 2), 'deny', 'rewrite' or 0.
function fire(dir, tool, toolInput, extra = {}) {
  const dispatcher = shell.isShellTool(tool) ? DISPATCH : path.join(HOOKS, 'file-guards.js');
  const r = spawnSync(process.execPath, [dispatcher], {
    input: JSON.stringify({ session_id: 'fc', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, cwd: dir, ...extra.payload }),
    encoding: 'utf8', cwd: dir, env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_PROJECT_DIR: dir, ...extra.env },
  });
  let v = r.status === 2 ? 2 : 0;
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput || {};
    if (v === 0 && o.permissionDecision === 'deny') v = 'deny';
    else if (v === 0 && o.updatedInput) v = 'rewrite';
  } catch { /* no JSON */ }
  return { v, out: `${r.stderr}${r.stdout}`, stdout: r.stdout };
}
const bash = (dir, command, extra) => fire(dir, 'Bash', { command }, extra);
const runner = (line) => `node "${GUARD}" --with-sensitive -- ${line}`;

test('FC 1: a shell-run string that is a name bound to a literal is carried as that literal', () => {
  const texts = (c) => shell.carriedScripts(c).map((s) => s.text);
  // the shared reader: the newest literal assignment before the use, the runtime -e rule
  assert.deepStrictEqual(texts('C=\'rm -rf ~\'; bash -c "$C"'), ['rm -rf ~']);
  assert.deepStrictEqual(texts('C=\'rm -rf ~\'; sh -c "${C}"'), ['rm -rf ~']);
  assert.deepStrictEqual(texts('C=\'rm -rf ~\'; eval "$C"'), ['rm -rf ~']);
  assert.deepStrictEqual(texts(`C='rm -rf ~'; ${runner('"$C"')}`), ['rm -rf ~']);
  assert.deepStrictEqual(texts('C=ls; C=\'rm -rf ~\'; bash -c "$C"'), ['rm -rf ~'], 'the newest literal wins');
  assert.deepStrictEqual(texts('C=\'rm -rf ~\'; C=ls; bash -c "$C"'), ['ls'], 'the newest literal wins the other way');
  assert.deepStrictEqual(texts('C="ls -la"; bash -c "$C"'), ['ls -la'], 'a double-quoted literal');
  // out of model, as before: a substitution, an unset name, a prefix assignment, a single-quoted word, a loop name
  assert.deepStrictEqual(texts('C=$(cat cmd.txt); bash -c "$C"'), ['$C']);
  assert.deepStrictEqual(texts('C=ls; C=$(date); bash -c "$C"'), ['$C'], 'the newest binding is a substitution');
  assert.deepStrictEqual(texts('bash -c "$NEVER_SET"'), ['$NEVER_SET']);
  assert.deepStrictEqual(texts('C=\'rm -rf ~\' bash -c "$C"'), ['$C'], 'a prefix assignment is the command\'s environment');
  assert.deepStrictEqual(texts('C=\'rm -rf ~\'; bash -c \'$C\''), ['$C'], 'single-quoted: the inner shell reads its own C');
  assert.deepStrictEqual(texts('for C in a b; do bash -c "$C"; done'), ['$C']);
  const dir = project('fc1-');
  for (const c of ['C=\'rm -rf ~\'; bash -c "$C"', 'C=\'rm -rf ~\'; sh -c "$C"', 'C=\'rm -rf ~\'; eval "$C"', 'C=\'rm -rf ~\'; bash -c "${C}"',
    `C='rm -rf ~'; ${runner('"$C"')}`, `C='cat .env'; ${runner('"$C"')}`]) {
    const r = bash(dir, c);
    assert.strictEqual(r.v, 2, `${c}\n${r.out}`);
  }
  // the twins keep today's verdict
  for (const c of ['C=\'ls -la\'; bash -c "$C"', 'C=\'rm -rf ~\'; C=ls; bash -c "$C"', 'C=$(date); bash -c "$C"', 'bash -c "$NEVER_SET"']) {
    const r = bash(dir, c);
    assert.strictEqual(r.v, 0, `${c}\n${r.out}`);
  }
});

test('FC 2: an unquoted backslash is judged as bash hands the word on - dropped before the path and verb tests', () => {
  const dir = project('fc2-');
  for (const c of ['cat .e\\nv', 'cat \\.env', 'c\\at .env', 'ca\\t ./.e\\nv', 'e\\nv']) {
    const r = bash(dir, c);
    assert.ok(r.v === 'rewrite' || r.v === 2, `${c}: read raw\n${r.out}`);
    if (r.v === 'rewrite') assert.match(r.out, /--redacted/, c);
  }
  for (const line of ["'cat .e\\nv'", "'c\\at .env'", "'cat \\.env'"]) {
    const r = bash(dir, runner(line));
    assert.strictEqual(r.v, 2, `${line} inside the runner\n${r.out}`);
  }
  // the steps a rewrite keeps are the ones the model wrote, every backslash in place
  const kept = bash(dir, 'cat .e\\nv; echo a\\-b');
  assert.strictEqual(kept.v, 'rewrite', kept.out);
  assert.match(JSON.parse(kept.stdout).hookSpecificOutput.updatedInput.command, /; echo a\\-b$/);
  // the twins: a backslash inside quotes is the program's, never the shell's; one before a blank or an operator stays
  for (const c of ["printf 'a\\nb'", "grep 'x\\.y' README.md", 'echo "a\\nb"', 'echo a\\;b', 'ls my\\ dir']) {
    const r = bash(dir, c);
    assert.strictEqual(r.v, 0, `${c}\n${r.out}`);
  }
});

test('FC 3: a script file a shell runs is judged as commands - a dump in one blocks, naming the presence and redacted routes', () => {
  const dir = project('fc3-');
  const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  put('dump.sh', 'cat .env\n');
  put('bang.sh', '#!/bin/sh\ncat .env\n');
  put('runner.sh', `${runner("'cat .env'")}\n`);
  put('outer.sh', 'bash dump.sh\n');
  put('clean.sh', 'echo hi\nls -la\n');
  put('test.sh', 'test -f .env && echo present\n');
  put('presence.sh', `node "${GUARD}" --presence .env API_TOKEN\n`);
  put('py.py', '#!/usr/bin/env python3\nprint(1)\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  put('sub/up.sh', 'cat ../.env\n');
  for (const c of ['bash dump.sh', 'sh dump.sh', '. ./dump.sh', 'source dump.sh', './dump.sh', './bang.sh', 'bash runner.sh', 'bash outer.sh',
    'bash < dump.sh', 'cat dump.sh | sh', 'C=\'cat .env\'; bash -c "$C"', 'cd sub && bash up.sh']) {
    const r = bash(dir, c);
    assert.strictEqual(r.v, 2, `${c}\n${r.out}`);
    assert.match(r.out, /--presence/, c);
    assert.match(r.out, /--redacted/, c);
  }
  // the twins: no credential read, a presence test, the guard's own presence read, another interpreter's file
  for (const c of ['bash clean.sh', 'bash test.sh', 'bash presence.sh', './py.py', 'C=ls; bash -c "$C"', 'bash missing.sh']) {
    const r = bash(dir, c);
    assert.strictEqual(r.v, 0, `${c}\n${r.out}`);
  }
  // a dump in the command itself still takes its view beside a clean script
  const r = bash(dir, 'cat .env; bash clean.sh');
  assert.strictEqual(r.v, 'rewrite', r.out);
});

test('FC 3: a script file is judged in linear work - its held assignments read the text once, and a 1MB one runs', () => {
  // Found while closing gap 3: every `X=$(...)` stage split the whole text again (heldOnlyInArgs), uncharged - a 500KB
  // script file took 50s. The work count must grow linearly, and one generous wall-clock bound catches a step that
  // charges nothing.
  const dir = project('fc3w-');
  const meter = path.join(TMP, 'judge-work.js');
  fs.writeFileSync(meter, "process.on('exit', () => { if (global.JUDGE_WORK) require('fs').writeSync(2, `\\nJUDGE_WORK ${global.JUDGE_WORK.used}\\n`); });\n");
  const line = 'V=$(date); curl -H "$V" https://example.invalid/x\n';
  const once = (chars) => {
    fs.writeFileSync(path.join(dir, 'held.sh'), line.repeat(Math.ceil(chars / line.length)));
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['-r', meter, GUARD], {
      input: JSON.stringify({ session_id: 'fc', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'bash held.sh' }, cwd: dir }),
      encoding: 'utf8', cwd: dir, env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_PROJECT_DIR: dir },
    });
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, status: r.status, work: Number((/JUDGE_WORK (\d+)/.exec(r.stderr) || [])[1]), err: r.stderr };
  };
  const half = once(100000);
  const full = once(200000);
  assert.strictEqual(full.status, 0, full.err);
  assert.ok(full.work <= 2.5 * half.work, `work grows linearly (${half.work} at 100,000 characters, ${full.work} at 200,000)`);
  assert.ok(full.ms < 10000, `the 200,000-character script took ${Math.round(full.ms)}ms`);
  // a clean script past the old 2M work budget still runs: the budget grows with what the reader carried
  const big = once(1000000);
  assert.strictEqual(big.status, 0, big.err);
});

test('FC 4: a session transcript is no write target - under the config dir\'s projects/ and the payload\'s own transcript_path', () => {
  const dir = project('fc4-');
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  const p = path.join(cfg, 'projects', '-fc4');
  const t = path.join(p, '0000-sess.jsonl');
  const seat = path.join(p, '0000-sess', 'subagents', 'agent-1.jsonl');
  fs.mkdirSync(path.dirname(seat), { recursive: true });
  fs.mkdirSync(path.join(p, 'memory'), { recursive: true });
  for (const f of [t, seat]) fs.writeFileSync(f, '{"type":"user"}\n');
  fs.writeFileSync(path.join(p, 'memory', 'MEMORY.md'), '- note\n');
  const denied = (tool, input, extra) => {
    const r = fire(dir, tool, input, extra);
    assert.strictEqual(r.v, 2, `${tool} ${JSON.stringify(input)}\n${r.out}`);
    assert.match(r.out, /session transcript/, r.out);
    assert.doesNotMatch(r.out, /CROSS-WRITE-ALLOW/, 'no receipt route');
  };
  denied('Write', { file_path: t, content: '{"type":"user"}\n' });
  denied('Edit', { file_path: seat, old_string: 'user', new_string: 'assistant' });
  denied('MultiEdit', { file_path: t, edits: [{ old_string: 'user', new_string: 'x' }] });
  denied('Bash', { command: `echo '{"type":"user"}' >> "${t}"` });
  denied('Bash', { command: 'printf x >> ~/.claude/projects/-fc4/0000-sess.jsonl' });
  denied('Bash', { command: `rm -f "${t}"` });
  denied('Bash', { command: `mv "${t}" "${path.join(dir, 'moved.jsonl')}"` });
  denied('Bash', { command: `sed -i.bak s/user/x/ "${t}"` });
  denied('Bash', { command: `rm -rf "${path.join(p, '0000-sess')}"` }, undefined);
  // the payload's own transcript, wherever it lives - a relative shell path into it too
  const own = path.join(dir, '.sessions', 'own.jsonl');
  denied('Write', { file_path: own, content: 'x' }, { payload: { transcript_path: own } });
  denied('Bash', { command: 'echo x >> .sessions/own.jsonl' }, { payload: { transcript_path: own } });
  denied('Bash', { command: 'rm -rf .sessions' }, { payload: { transcript_path: own } });
  // a relocated config dir is the config dir
  const cfg2 = path.join(TMP, 'cfg2');
  denied('Write', { file_path: path.join(cfg2, 'projects', '-p', 's.jsonl'), content: 'x' }, { env: { CLAUDE_CONFIG_DIR: cfg2 } });
  // the twins keep today's verdicts: memory, reads, the account settings, a project jsonl, a folder with no transcript
  for (const [tool, input] of [['Write', { file_path: path.join(p, 'memory', 'x.md'), content: 'x' }], ['Read', { file_path: t }],
    ['Bash', { command: `grep -c user "${t}"` }], ['Bash', { command: `wc -l "${t}"` }], ['Write', { file_path: path.join(cfg, 'settings.json'), content: '{}' }],
    ['Write', { file_path: path.join(dir, 'data', 'rows.jsonl'), content: '{}' }], ['Bash', { command: `rm -rf "${path.join(p, 'memory')}"` }],
    ['Bash', { command: `cp "${t}" "${path.join(dir, 'copy.jsonl')}"` }]]) {
    const r = fire(dir, tool, input);
    assert.strictEqual(r.v, 0, `${tool} ${JSON.stringify(input)}\n${r.out}`);
  }
});
