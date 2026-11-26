'use strict';
// hooks audit 2026-11-19, batch 6 - guard-secret-value.js: the masker fails closed (B6-S1), a YAML block of any length
// is read (B6-S1), a denial on the store names --with-sensitive (B6-F2), and the Grep denials name a way out that works
// (B6-G1). Every planted value is built in code, and no assertion message prints one.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { legacyBlock } = require('./hook-test-env');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-secret-value.js');
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'secret-b6-')));
const TOKEN = ['gh', 'p_'].join('') + 'Z9y8X7w6'.repeat(4);
const STORE_VALUE = 'st-' + 'k4'.repeat(6);
const KEY_VALUE = 'kf-' + 'r5'.repeat(6);
const MARK = 'B6-THROW-MARK';
const BLOCK_LINES = 130000;

function project() {
  const dir = fs.mkdtempSync(path.join(TMP, 'p-'));
  const put = (rel, text) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  put('.gitignore', '.alfred/\n');
  put('.alfred/install.json', '{}');
  put('.env', `API_TOKEN=${TOKEN}\n`);
  put('.alfred/.secrets', `DB_PASSWORD=${STORE_VALUE}\n`);
  put('.mcps-secrets', `SERVER_KEY=${KEY_VALUE}\n`);
  put('cfg/config.json', JSON.stringify({ Sentry: { Dsn: `https://${'0a'.repeat(16)}@o1.ingest.sentry.io/2`, TracesSampleRate: 0.2 } }, null, 2));
  put('big.yml', `doc: |\n${' a\n'.repeat(BLOCK_LINES)}password: ${'S3cret-'.repeat(3)}\n`);
  return dir;
}
const call = (dir, payload, pre = null) => spawnSync(process.execPath, [...(pre ? ['-r', pre] : []), HOOK], {
  input: JSON.stringify({ session_id: 'b6', cwd: dir, ...payload }), encoding: 'utf8', cwd: dir,
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir, HOME: path.join(dir, 'home'), USERPROFILE: path.join(dir, 'home') },
});
// A block as this suite read it - exit 2, the reason on stderr (legacyBlock); the ask and the deny are pinned in guard-secret-value.test.js.
const blocked = (dir, payload) => legacyBlock(call(dir, payload));
const rows = (dir) => { try { return fs.readFileSync(path.join(dir, '.alfred', 'statistics', 'hook-blocks', 'b6.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
const posted = (command, stdout) => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '', interrupted: false, isImage: false } });

test('B6-S1: a throw in the masker withholds the output and writes one mask-error row', () => {
  const dir = project();
  // a String#split that throws on the output alone: the masker splits what it masks into lines
  const pre = path.join(TMP, 'split-throws.js');
  fs.writeFileSync(pre, `const split = String.prototype.split;\nString.prototype.split = function (...a) { if (this.includes('${MARK}')) throw new RangeError('replay'); return split.apply(this, a); };\n`);
  const r = call(dir, posted('cat .env', `${MARK}\nAPI_TOKEN=${TOKEN}\n`), pre);
  assert.strictEqual(r.status, 0, r.stderr.slice(0, 200));
  const out = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput;
  assert.deepStrictEqual([out.stdout, out.stderr], ['output withheld: the masker failed', '']);
  assert.ok(!r.stdout.includes(TOKEN), 'no value in the answer');
  assert.deepStrictEqual(rows(dir).map((x) => [x.mode, x.detail.kind, x.detail.error]), [['probe', 'mask-error', 'RangeError']]);
});

test('B6-S1: a YAML block of 130,000 lines is read on the Read route and by the masker', () => {
  const dir = project();
  const read = call(dir, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'big.yml') } });
  assert.strictEqual(read.status, 0, read.stderr.slice(0, 200));
  assert.strictEqual(JSON.parse(read.stdout).hookSpecificOutput.permissionDecision, 'ask', 'the password under the block is found');
  const masked = call(dir, posted('head -1 big.yml; cat .env', `doc: |\nAPI_TOKEN=${TOKEN}\n`));
  assert.strictEqual(masked.status, 0, masked.stderr.slice(0, 200));
  assert.strictEqual(JSON.parse(masked.stdout).hookSpecificOutput.updatedToolOutput.stdout, 'doc: |\nAPI_TOKEN=<set (36 chars)>\n');
});

test('B6-F2: a denial naming the store names --with-sensitive; a key file\'s does not', () => {
  const dir = project();
  const store = blocked(dir, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, '.alfred', '.secrets') } });
  assert.strictEqual(store.status, 2);
  assert.match(store.stderr, /--with-sensitive -- "<command line>"/);
  const core = blocked(dir, { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: 'Get-Content .alfred/.secrets' } });
  assert.strictEqual(core.status, 2);
  assert.match(core.stderr, /--with-sensitive -- "<command line>"/, 'the core deny on the store too');
  const keyFile = blocked(dir, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, '.mcps-secrets') } });
  assert.strictEqual(keyFile.status, 2);
  assert.doesNotMatch(keyFile.stderr, /--with-sensitive/, '--with-sensitive never reads a key file');
});

test('B6-G1: the Grep denials say a narrower pattern is refused again and name the value-free view, which the shell passes', () => {
  const dir = project();
  const grep = (input) => blocked(dir, { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { output_mode: 'content', pattern: 'TracesSampleRate', ...input } });
  const walk = grep({ path: path.join(dir, 'cfg') });
  assert.strictEqual(walk.status, 2, 'the verdict is unchanged');
  assert.match(walk.stderr, /refused again, and a `!` glob is not read/);
  assert.match(walk.stderr, /--redacted "[^"]*config\.json" --note-to-stderr \| grep -n '<pattern>'/);
  const named = grep({ path: path.join(dir, 'cfg', 'config.json') });
  assert.strictEqual(named.status, 2, 'the verdict is unchanged');
  assert.match(named.stderr, /refused whatever the pattern - a narrower one is refused again/);
  assert.match(named.stderr, /--redacted "[^"]*config\.json" --note-to-stderr \| grep -n '<pattern>'/);
  const view = call(dir, { hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: `node "${HOOK}" --redacted cfg/config.json --note-to-stderr | grep -n TracesSampleRate` } });
  assert.strictEqual(view.status, 0, `the named way out passes the shell route even where no masker runs: ${view.stderr.slice(0, 160)}`);
});
