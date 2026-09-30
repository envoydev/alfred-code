#!/usr/bin/env node
// Suite for stack/hooks/guard-secret-value.js. Runs with `npm test` (node --test).
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

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-secret-value.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-secret-'));
// Every guard appends a block row under `<root>/<docs-path>/hook-blocks/`, and the root falls back
// to the process cwd - pin a scratch root so this suite never writes into the repo's own ledger.
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
const LEDGER = path.join(TMP, 'ledger');
process.env.ALFRED_CODE_DOCS_PATH = LEDGER;

// Fake by construction, and deliberately NOT a run of one character: a value that is just `xxx...`
// is a placeholder by content, which the guard's own template tells now read as 'not live'.
const FAKE_TOKEN = 'x0'.repeat(20); // 40 chars; the KEY name is what the guard judges
const SECRET_JSON = JSON.stringify({ env: { SENTRY_SLUG: 'acme', SENTRY_ACCESS_TOKEN: FAKE_TOKEN }, hooks: {} }, null, 2);

// A project tree under the pinned CLAUDE_PROJECT_DIR - the anchor a relative path, a `cd` and a
// glob resolve against.
const ROOT = process.env.CLAUDE_PROJECT_DIR;
fs.mkdirSync(path.join(ROOT, '.claude'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.claude', 'settings-secret.json'), SECRET_JSON);
fs.writeFileSync(path.join(ROOT, '.claude', 'clean.json'), JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: '.claude/docs' } }, null, 2));
fs.mkdirSync(path.join(ROOT, 'my dir'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'my dir', 'settings.json'), SECRET_JSON);
fs.writeFileSync(path.join(ROOT, '.env'), 'API_KEY=abc123\n');
fs.mkdirSync(path.join(ROOT, 'sub'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'sub', 'settings.json'), SECRET_JSON);
// A FAKE account dir. The real ~/.claude holds live credentials and is never read by this suite -
// CLAUDE_CONFIG_DIR is what the hook resolves an account-dir path against, so pin it here.
const ACCOUNT = fs.mkdtempSync(path.join(TMP, 'account-'));
fs.writeFileSync(path.join(ACCOUNT, 'settings.json'), SECRET_JSON);
process.env.CLAUDE_CONFIG_DIR = ACCOUNT;

function fixtures() {
  const dir = fs.mkdtempSync(path.join(TMP, 'fx-'));
  const w = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
  const wd = (sub, name, content) => { fs.mkdirSync(path.join(dir, sub), { recursive: true }); const p = path.join(dir, sub, name); fs.writeFileSync(p, content); return p; };
  return {
    dir,
    secret: w('settings.json', SECRET_JSON),
    spaced: wd('my dir', 'settings.json', SECRET_JSON),
    // The ordinary project files the content test must NOT read as credential files.
    i18n: w('en.json', JSON.stringify({ login: { password: 'Password', apiKey: 'API key' } }, null, 2)),
    manifest: w('manifest.json', JSON.stringify({ manifest_version: 3, key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' }, null, 2)),
    envExample: w('.env.example', 'API_KEY=your-api-key-here\nDB_PASSWORD=<your-password>\nSMTP_SECRET=changeme\n'),
    envSample: w('config.json.sample', JSON.stringify({ apiKey: 'abc123' }, null, 2)),
    testFixture: w('client.json', JSON.stringify({ apiKey: 'test-key-1234' }, null, 2)),
    clean: w('clean-settings.json', JSON.stringify({ env: { ALFRED_CODE_DOCS_PATH: '.claude/docs', ALFRED_CODE_PUSH_GATE: '1' }, hooks: {} }, null, 2)),
    mcp: w('.mcp.json', JSON.stringify({ mcpServers: { context7: { env: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' } } } }, null, 2)),
    dotenv: w('.env', 'DB_HOST=localhost\nAPI_KEY=abc123\n'),
    crlf: w('crlf.env', 'DB_HOST=localhost\r\nAPI_KEY=abc123\r\nSMTP_SECRET="changeme"\r\n'),
    emptyDotenv: w('empty.env', 'API_KEY=\nDB_HOST=localhost\n'),
    nested: w('appsettings.json', JSON.stringify({ ConnectionStrings: { Default: 'Server=x' }, Smtp: { Password: 'p@ss' } })),
    code: w('index.js', 'const TOKEN = process.env.TOKEN;\nmodule.exports = TOKEN;\n'),
  };
}

const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } });
// Three verdicts on the shell route: 2 = blocked (a credential-shaped literal, the Read tool), 0 =
// passed untouched, REWRITE = the call was rewritten on the way out (hookSpecificOutput.updatedInput)
// into its redacted or presence form - the model gets the file with every credential value replaced,
// never a red block and never a retried turn.
const REWRITE = 'rewrite';
const updatedCommand = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command; } catch { return null; } };
const verdict = (r) => (r.status === 2 ? 2 : updatedCommand(r) != null ? REWRITE : r.status);
const bash = (command, env) => verdict(run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite' }, env));
const rewritten = (command, env) => updatedCommand(run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite' }, env));
const read = (file_path, env) => run({ tool_name: 'Read', tool_input: { file_path }, session_id: 'suite' }, env).status;
const cli = (...args) => spawnSync(process.execPath, [HOOK, ...args], { encoding: 'utf8' });

// Measured across four audited sessions: five blocks on /alfred-code:update's own downloaded
// snapshot. Not the temp PATH - the CONTENT: this stack's catalogs are lists of variable NAMES
// under a field literally called `key`, and a name that names a credential is not one. The shell
// route was the worse half - the walk got its own catalog back with every `key` masked.
test('guard-secret-value: a stage that only PRINTS reads nothing - the rotation snippet survives', () => {
  const f = fixtures();
  // The measured failure: the stack asked the user to rotate an exposed credential, offered a
  // copy-ready `printf` of the rotation one-liner, and this guard answered it. At 0.2.62 that was a
  // visible block; at HEAD it had become a SILENT rewrite into a `--redacted` dump of the settings
  // file, so the snippet never reached the user and the token stayed live to the end of the session.
  const snippet = `printf '%s\\n' "python3 -c \\"import getpass,pathlib;f=pathlib.Path('${f.secret}')\\""`;
  assert.equal(bash(snippet), 0, 'a printf whose payload merely NAMES a credential file is text, not a read');
  assert.equal(bash(`echo "edit ${f.secret} by hand"`), 0, 'and so is an echo of prose naming the same path');
  // The carve-out is the FILE-CANDIDATE scan alone. Everything that made this guard worth having
  // still fires, so the fix cannot be a hole:
  assert.equal(bash('echo $SENTRY_ACCESS_TOKEN'), REWRITE, 'a credential VARIABLE in a print verb is still caught');
  assert.equal(bash('printf "%s" "$CONTEXT7_API_KEY"'), REWRITE, '... in printf too');
  assert.equal(bash(`echo "${FAKE_JWT}"`), 2, 'a credential-shaped LITERAL is still blocked');
  assert.equal(bash(`cat ${f.secret}`), REWRITE, 'an actual read of the same file is still rewritten');
  assert.equal(bash(`printf '%s' x && cat ${f.secret}`), REWRITE, 'a print stage does not excuse a read stage beside it');
});

test('guard-secret-value: the Windows spelling of the home dir is a path this guard can expand', () => {
  const f = fixtures();
  // `expandPath` returns null for any surviving `$`, so before USERPROFILE joined the VARS map the
  // account settings.json on every Windows install was never judged at all - and that is the one
  // platform where the path is routinely written that way. Measured: a live token printed from it.
  assert.equal(read('$USERPROFILE/settings.json', { USERPROFILE: f.dir }), 2, 'the Read route now resolves it');
  assert.equal(bash('cat $USERPROFILE/settings.json', { USERPROFILE: f.dir }), REWRITE, '... and so does the shell route');
  assert.equal(read('${USERPROFILE}/settings.json', { USERPROFILE: f.dir }), 2, 'the braced form too');
  assert.equal(read('$USERPROFILE/clean-settings.json', { USERPROFILE: f.dir }), 0, 'a file with no credential still passes - this expands paths, it does not widen what counts');
});

test('guard-secret-value: a credential-shaped key holding an identifier NAME is not a credential', () => {
  const repo = path.join(__dirname, '..');
  for (const f of ['meta/environment.json', 'meta/migrations.json', 'meta/recommendations.json', 'meta/plugin-settings.json']) {
    assert.equal(read(path.join(repo, f)), 0, `${f} - the walks read this file on every run`);
    assert.equal(bash(`cat ${path.join(repo, f)}`), 0, `${f} - and a dump of it is not rewritten into a masked view`);
  }
  const f = fixtures();
  const names = path.join(f.dir, 'catalog.json');
  fs.writeFileSync(names, JSON.stringify({ env: [{ key: 'SENTRY_ACCESS_TOKEN' }, { key: 'CONTEXT7_API_KEY' }], rename: { settings_env_key: 'CLAUDE_DOCS_PATH' } }));
  assert.equal(read(names), 0, 'a catalog of credential NAMES is not a credential file');
  // ...and the tell never excuses a value that is shaped like a credential
  const aws = path.join(f.dir, 'aws.json');
  fs.writeFileSync(aws, JSON.stringify({ AWS_ACCESS_KEY: 'AKIA1234567890ABCDEF' }));
  assert.equal(read(aws), 2, 'an all-caps AWS key id is judged on its shape, not excused as a name');
  const held = path.join(f.dir, 'held.json');
  fs.writeFileSync(held, JSON.stringify({ env: { SENTRY_ACCESS_TOKEN: 'sntryu_0123456789abcdef0123456789abcdef' } }));
  assert.equal(read(held), 2, 'and the same key holding a real token still blocks');
});

test('guard-secret-value: a dump verb on a file that holds a credential is blocked, judged by content', () => {
  const f = fixtures();
  assert.equal(bash(`cat ${f.secret}`), REWRITE, 'cat of a settings.json with a live token');
  assert.equal(bash(`jq .env ${f.secret}`), REWRITE, 'jq of the env block');
  assert.equal(bash(`head -20 ${f.secret}`), REWRITE, 'head shows the first lines, token included');
  assert.equal(bash(`grep -n SENTRY ${f.secret}`), REWRITE, 'grep prints the matching line, value included');
  assert.equal(bash(`cat ${f.dotenv}`), REWRITE, 'a dotenv file with API_KEY=value');
  assert.equal(bash(`cat ${f.nested}`), REWRITE, 'a nested Smtp.Password in appsettings.json');
  assert.equal(bash(`cat ${f.clean}`), 0, 'the same shape with no credential-shaped key passes');
  assert.equal(bash(`cat ${f.mcp}`), 0, 'a ${VAR} placeholder is not a live value');
  assert.equal(bash(`cat ${f.emptyDotenv}`), 0, 'an empty KEY= is not a live value');
  assert.equal(bash(`cat ${f.code}`), 0, 'source code is never a credential file');
  assert.equal(bash(`cat ${path.join(f.dir, 'missing.json')}`), 0, 'a missing file has nothing to judge');
});

test('guard-secret-value: the Grep TOOL is the third read route, and only its CONTENT mode prints', () => {
  // Measured live: a Bash read of a project settings.json was blocked at 11:09:37, and 8s later a
  // Grep with output_mode content on the SAME path returned two of its lines. Nothing leaked only
  // because the pattern happened to select non-credential keys.
  const f = fixtures();
  const grep = (tool_input) => run({ tool_name: 'Grep', tool_input, session_id: 'suite' }).status;
  assert.equal(grep({ pattern: 'SENTRY', path: f.secret, output_mode: 'content' }), 2, 'content mode prints the value line');
  assert.equal(grep({ pattern: 'SENTRY', path: f.secret, output_mode: 'count' }), 0, 'a count prints no value');
  assert.equal(grep({ pattern: 'SENTRY', path: f.secret }), 0, 'and files_with_matches is the default - a path, not a value');
  assert.equal(grep({ pattern: 'SENTRY', path: f.clean, output_mode: 'content' }), 0, 'a file with no live credential is a free read');
  assert.equal(grep({ pattern: 'SENTRY', path: f.dir, output_mode: 'content' }), 0, 'a directory walk is not a named read - the file routes still gate it');
});

test('guard-secret-value: a dump is rewritten into a redacted view - the file with every credential value replaced, never a block', () => {
  // The block cost a red denial plus a retried turn and, remote, left the user with nothing they could
  // run. The call is rewritten on the way out instead: the model gets the file back with each credential
  // value replaced by `<set (N chars)>`, the rest readable - the placeholder the transcript may hold.
  const f = fixtures();
  const cmd = rewritten(`cat ${f.secret}`);
  assert.equal(cmd, `node "${HOOK}" --redacted "${f.secret}"`, 'the whole call becomes the redacted view of that file');
  const view = cli('--redacted', f.secret);
  assert.equal(view.status, 0);
  assert.doesNotMatch(view.stdout + view.stderr, new RegExp(FAKE_TOKEN), 'the value never appears');
  assert.match(view.stdout, /"SENTRY_ACCESS_TOKEN": "<set \(40 chars\)>"/, 'masked in place, by length');
  assert.match(view.stdout, /"SENTRY_SLUG": "acme"/, 'a non-secret value stays readable');
  assert.match(view.stdout, /"hooks": \{\}/, 'the rest of the file is intact');
  assert.match(view.stdout, /^# credential guard: redacted view of /, 'the header says what happened');
  assert.match(view.stdout, /ONE AskUserQuestion/, 'and how to get the value when the user needs it');
  assert.match(view.stdout, /Presence only \(Recommended\)/);
  assert.match(view.stdout, /flow[\\/]SECRET-READ-ALLOW/);
  const env = cli('--redacted', f.dotenv).stdout;
  assert.match(env, /^DB_HOST=localhost$/m, 'dotenv: a plain line stays');
  assert.match(env, /^API_KEY=<set \(6 chars\)>$/m, 'dotenv: the credential line is masked');
  // The view is SPLICED in: only the segment that named the credential file becomes the redacted
  // read, and the other read-only segments run as written. Replacing the whole command dropped 3 of
  // 4 parts of a read-only command, and the 3 recovery calls cost ~124k (replayed).
  assert.equal(rewritten('cd sub && cat settings.json && ls'),
    `cd sub && node "${HOOK}" --redacted "${path.join(ROOT, 'sub', 'settings.json')}" && ls`,
    'the credential segment becomes the view; the cd and the ls are kept');
  assert.equal(bash(`node "${HOOK}" --redacted "${f.secret}"`), 0, 'the redacted view itself is exempt by name');
  // The path is double-quoted for bash, and only what bash reads inside double quotes is escaped: a
  // Windows path's own backslashes stay as they are, or the command names a path that is not the
  // file's (measured on windows-latest: `D:\\a\\...` for `D:\a\...`). A `$` in a path never
  // reaches the escaper - an unexpanded variable is never judged - so a backslash is the one case.
  fs.mkdirSync(path.join(ROOT, 'win\\dir'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'win\\dir', 'settings.json'), SECRET_JSON);
  assert.equal(rewritten("cd 'win\\dir' && cat settings.json"), `cd 'win\\dir' && node "${HOOK}" --redacted "${path.join(ROOT, 'win\\dir', 'settings.json')}"`, 'a backslash in the path is kept as it is');
  const missing = cli('--redacted', path.join(f.dir, 'nope.json'));
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /nope\.json: not found/);
});

test('guard-secret-value: a variable print and a whole-environment dump are rewritten into their presence forms', () => {
  const v = rewritten('echo $SENTRY_ACCESS_TOKEN');
  assert.match(v, /\[ -n "\$SENTRY_ACCESS_TOKEN" \] && echo "SENTRY_ACCESS_TOKEN=set \(\$\{#SENTRY_ACCESS_TOKEN\} chars\)" \|\| echo "SENTRY_ACCESS_TOKEN=absent"/, 'the presence idiom for that variable');
  assert.match(v, /^echo "# credential guard: /, 'led by the note that says what happened and how to get the value');
  assert.match(v, /flow[\\/]SECRET-READ-ALLOW/);
  assert.equal(rewritten('node -e "console.log(process.env.SENTRY_ACCESS_TOKEN)"'), v, 'a runtime print of the same variable rewrites the same');
  assert.equal(rewritten('printenv SENTRY_ACCESS_TOKEN'), v, 'printenv NAME too');
  assert.equal(rewritten('env'), `node "${HOOK}" --redacted-env`, 'a whole-environment dump becomes the masked listing');
  assert.equal(rewritten('node -p process.env'), `node "${HOOK}" --redacted-env`);
  const listing = spawnSync(process.execPath, [HOOK, '--redacted-env'], { encoding: 'utf8', env: { ...process.env, SENTRY_ACCESS_TOKEN: FAKE_TOKEN, PLAIN_VALUE: 'visible' } });
  assert.equal(listing.status, 0);
  assert.doesNotMatch(listing.stdout, new RegExp(FAKE_TOKEN));
  assert.match(listing.stdout, /^SENTRY_ACCESS_TOKEN=<set \(40 chars\)>$/m, 'a credential-shaped name is masked by length');
  assert.match(listing.stdout, /^PLAIN_VALUE=visible$/m, 'every other variable prints as env does');
  assert.match(listing.stdout, /^# credential guard: /, 'the header');
  assert.equal(bash(`node "${HOOK}" --redacted-env`), 0, 'the listing itself is exempt by name');
});

test('guard-secret-value: a block appends one ledger row naming the hook and never the value', () => {
  const f = fixtures();
  const ledger = path.join(TMP, 'ledger-' + Date.now());
  const rowsOf = () => fs.readFileSync(path.join(ledger, 'hook-blocks', 'suite.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(bash(`cat ${f.secret}`, { ALFRED_CODE_DOCS_PATH: ledger }), REWRITE, 'a rewrite costs no retried turn - it is not a block');
  // The shell route's main verdict is the rewrite, so it is counted - as a `mode` row, which the block rate
  // skips like the probe rows (2.1.5 M17): tool, branch and the file's basename, never the value.
  const [rw] = rowsOf();
  assert.deepStrictEqual([rw.mode, rw.hook, rw.tool, rw.detail && rw.detail.branch, rw.detail && rw.detail.file],
    ['rewrite', 'guard-secret-value.js', 'Bash', 'file', 'settings.json'], 'one rewrite row');
  assert.doesNotMatch(JSON.stringify(rw), new RegExp(FAKE_TOKEN), 'and it never carries the value');
  assert.equal(bash('env', { ALFRED_CODE_DOCS_PATH: ledger }), REWRITE);
  assert.equal(bash('echo $SENTRY_ACCESS_TOKEN', { ALFRED_CODE_DOCS_PATH: ledger }), REWRITE);
  assert.deepStrictEqual(rowsOf().slice(1).map((r) => [r.mode, r.detail.branch]), [['rewrite', 'env-stage'], ['rewrite', 'variable']],
    'the environment and the variable forms are counted the same way');
  assert.equal(bash(`curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`, { ALFRED_CODE_DOCS_PATH: ledger }), 2);
  const blocks = rowsOf().filter((r) => !r.mode);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].hook, 'guard-secret-value.js');
  assert.doesNotMatch(JSON.stringify(rowsOf()), new RegExp(FAKE_JWT));
});

test('guard-secret-value: copies, in-place edits, presence-shaped pipelines and prose stay silent', () => {
  const f = fixtures();
  assert.equal(bash(`cat ${f.secret} > ${path.join(f.dir, 'copy.json')}`), 0, 'output into a file never reaches the context');
  assert.equal(bash(`sed -i '' 's/acme/acme2/' ${f.secret}`), 0, 'an in-place sed edits, it does not print');
  assert.equal(bash(`grep -c SENTRY_ACCESS_TOKEN ${f.secret}`), 0, 'a count is presence');
  assert.equal(bash(`jq '.env | keys' ${f.secret}`), 0, 'keys only is presence');
  assert.equal(bash(`jq '.env.SENTRY_ACCESS_TOKEN | length' ${f.secret}`), 0, 'a length is presence');
  assert.equal(bash(`cat <<'EOF' > ${path.join(f.dir, 'plan.md')}\nStep 1: cat ${f.secret} to check the env block\nEOF`), 0, 'a heredoc body is prose');
  assert.equal(bash(`cat ${f.secret} | wc -l`), 0, 'a line count is presence');
  assert.equal(bash('cat "$SOME_UNSET_DIR/settings.json"'), 0, 'an unexpanded variable is never judged');
});

test('guard-secret-value: the --presence exemption covers its own segment only', () => {
  const f = fixtures();
  assert.equal(bash(`node "${HOOK}" --presence "${f.secret}" SENTRY_ACCESS_TOKEN`), 0, 'the accessor alone');
  assert.equal(bash(`true && node "${HOOK}" --presence "${f.secret}" && cat ${f.secret}`), REWRITE, 'a dump chained after the accessor is still a dump');
});

test('guard-secret-value: an inline runtime read of a credential file is the same dump, spelled differently', () => {
  const f = fixtures();
  assert.equal(bash(`node -e "const s=JSON.parse(require('fs').readFileSync('${f.secret}','utf8'));console.log(JSON.stringify(s.env||{},null,2))"`), REWRITE, 'the measured leak');
  // A runtime print that is ONLY a key list is the presence read spelled in code, and rewriting it
  // into the whole-file redacted view answered a ~200-char question with 6,273 chars, after which
  // the run needed a third command to re-check the half of its own output the rewrite swallowed
  // (measured, ~214k avoidable). It passes through as written; anything that can turn those names
  // back into values does not.
  assert.equal(bash(`node -e "console.log(Object.keys(require('${f.secret}').env))"`), 0, 'a key list is names, not values');
  assert.equal(bash(`node -e "const d=JSON.parse(require('fs').readFileSync('${f.secret}','utf8'));console.log(Object.keys(d.env||{}).join('\\n'))"`), 0, '... in the spelling that was measured');
  assert.equal(bash(`python3 -c "import json;d=json.load(open('${f.secret}'));print('\\n'.join(d['env'].keys()))"`), 0, '... and in python');
  assert.equal(bash(`node -e "const d=require('${f.secret}');console.log(Object.keys(d.env).map(k=>d.env[k]))"`), REWRITE, 'keys mapped back to their values is a dump again');
  assert.equal(bash(`node -e "console.log(Object.keys(require('${f.secret}').env), require('${f.secret}').env)"`), REWRITE, '... and so is a key list printed beside the object');
  assert.equal(bash(`python3 -c "import json;print(json.load(open('${f.secret}')))"`), REWRITE, 'python json.load');
  assert.equal(bash(`ruby -e "puts File.read('${f.secret}')"`), REWRITE, 'ruby File.read');
  assert.equal(bash(`node -e "console.log(require('${f.clean}').env)"`), 0, 'a clean file through a runtime passes');
  assert.equal(bash(`node -e "console.log(require('fs').existsSync('${f.secret}'))"`), REWRITE, 'existence through a runtime resolves the file too - use --presence, which is exempt by name');
  assert.equal(bash(`node "${HOOK}" --presence "${f.secret}" SENTRY_ACCESS_TOKEN`), 0, 'the accessor itself is the sanctioned read');
});

test('guard-secret-value: quoting never hides a dump - operators inside quotes do not split, an unbalanced quote falls back to the quote-blind split', () => {
  const f = fixtures();
  // the quote-blind split reads `> 2` as a write into a file, so this one blocks rather than rewrites - either way not excused
  assert.notEqual(bash(`echo "1 > 2 is true && cat ${f.secret}`), 0, 'an unterminated double quote cannot excuse the cat behind it');
  assert.equal(bash(`echo 'it's fine && cat ${f.secret}`), REWRITE, 'an unbalanced apostrophe');
  assert.equal(bash(`echo "C:\\dir\\" && cat ${f.secret}`), REWRITE, 'a backslash before the closing quote leaves it open - still judged');
  assert.equal(bash(`echo "1 > 2 is true" && cat ${f.secret}`), REWRITE, 'a balanced quote holding operators still splits at the real &&');
  assert.equal(bash(`printf '%s;%s' a b; cat ${f.secret}`), REWRITE, 'a ; inside quotes is data, the ; outside splits');
  assert.equal(bash(`echo 'it'\\''s' && cat ${f.secret}`), REWRITE, 'the shell apostrophe idiom');
  assert.equal(bash(`python3 -c "import json;print(json.load(open('${f.clean}')))"`), 0, 'a clean file through a runtime with ; inside quotes');
});

test('guard-secret-value: printing a credential-shaped variable is blocked; a length or a test is presence', () => {
  assert.equal(bash('echo $SENTRY_ACCESS_TOKEN'), REWRITE, 'bare $VAR');
  assert.equal(bash('echo "${CONTEXT7_API_KEY}"'), REWRITE, 'braced');
  assert.equal(bash('echo "${DB_PASSWORD:-none}"'), REWRITE, 'with a default');
  assert.equal(bash("printf '%s\\n' \"$SMTP_SECRET\""), REWRITE, 'printf');
  assert.equal(bash('printenv SENTRY_ACCESS_TOKEN'), REWRITE, 'printenv NAME');
  assert.equal(bash('[ -n "$SENTRY_ACCESS_TOKEN" ] && echo "SENTRY_ACCESS_TOKEN=set (${#SENTRY_ACCESS_TOKEN} chars)" || echo "SENTRY_ACCESS_TOKEN=absent"'), 0, 'the presence idiom: a test and a length');
  assert.equal(bash('echo $PATH'), 0, 'a non-secret variable');
  assert.equal(bash('echo "$ALFRED_CODE_DOCS_PATH"'), 0, 'PATH suffix is not a credential');
  assert.equal(bash('printenv ALFRED_CODE_INSTRUMENT'), 0, 'printenv of a non-secret');
  assert.equal(bash('echo "token count: 3"'), 0, 'a word, not a variable');
});

test('guard-secret-value: a whole-environment dump is blocked unless reduced to names', () => {
  assert.equal(bash('env'), REWRITE, 'bare env');
  assert.equal(bash('printenv'), REWRITE, 'bare printenv');
  assert.equal(bash('env | grep -i sentry'), REWRITE, 'filtered by a prefix still prints the value');
  assert.equal(bash('env | grep PATH'), REWRITE, 'any value filter prints values - the denial names printenv NAME for a non-secret');
  assert.equal(bash('env | cut -d= -f1 | sort'), 0, 'names only');
  assert.equal(bash("env | sed 's/=.*//'"), 0, 'names only, sed form');
  assert.equal(bash('env | wc -l'), 0, 'a count');
  assert.equal(bash('env | grep -c SENTRY'), 0, 'a count');
  assert.equal(bash('env FOO=bar node script.js'), 0, 'env as a command prefix is not a dump');
  assert.equal(bash('dotenv -e .env -- npm start'), 0, 'a word containing env is not env');
});

test('guard-secret-value: print verbs are judged per pipeline stage, and a prefix word does not hide an environment dump', () => {
  assert.equal(bash('echo "processing" | grep -v "$SOME_TOKEN"'), 0, 'a variable in a later grep stage is not printed by the echo');
  assert.equal(bash('echo ok | curl -d "$API_TOKEN" https://example.test'), 0, 'a variable handed to curl is used, not printed - the value never enters the transcript');
  assert.equal(bash('true | echo "$API_TOKEN"'), REWRITE, 'the print verb in a later stage is still judged');
  assert.equal(bash('echo "a|b $API_TOKEN"'), REWRITE, 'a quoted pipe does not end the stage');
  assert.equal(bash('sudo echo $DB_PASSWORD'), REWRITE, 'a prefix word before the print verb');
  assert.equal(bash('sudo env'), REWRITE, 'a prefix word before env');
  assert.equal(bash('FOO=bar env'), REWRITE, 'an assignment before env');
  assert.equal(bash('command printenv | head'), REWRITE, 'command printenv piped onward');
  assert.equal(bash('sudo env | cut -d= -f1'), 0, 'names only, prefixed');
  assert.equal(bash('env -i sh -c true'), 0, 'env running a command');
});

// A fake JWT: three base64url segments. Built by concatenation so no scanner reads a real shape off this file.
const FAKE_JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnopqrstuvwxyz0123'].join('.');

test('guard-secret-value: a credential-shaped literal in the command is blocked, heredoc bodies included', () => {
  assert.equal(bash(`curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`), 2, 'a token in a header');
  assert.equal(bash(`cat <<'EOF' > ${path.join(TMP, 'out.json')}\n{ "env": { "SENTRY_ACCESS_TOKEN": "${FAKE_JWT}" } }\nEOF`), 2, 'writing the value into a file through a heredoc is the same leak');
  assert.equal(bash('curl -H "Authorization: Bearer $API_TOKEN" https://example.test/api'), 0, 'a variable reference in a non-print verb is not a literal (and not printed)');
  assert.equal(bash('echo "the token format is eyJ...header.payload.signature"'), 0, 'prose about the shape is not the shape');
});

test('guard-secret-value: the Read tool on a file that holds a credential is blocked by content, not path', () => {
  const f = fixtures();
  assert.equal(read(f.secret), 2, 'a project settings.json the deny list leaves open');
  assert.equal(read(f.dotenv), 2, 'a dotenv file');
  assert.equal(read(f.clean), 0, 'a clean settings.json - the hook wiring a session legitimately inspects');
  assert.equal(read(f.mcp), 0, 'placeholders');
  assert.equal(read(f.code), 0, 'source');
  assert.equal(read(path.join(f.dir, 'missing.json')), 0, 'missing - let Read surface its own error');
  const r = run({ tool_name: 'Read', tool_input: { file_path: f.secret }, session_id: 'suite' });
  assert.match(r.stderr, /env\.SENTRY_ACCESS_TOKEN/);
  assert.match(r.stderr, /--redacted/, 'the denial names the redacted view the shell route gives for free');
  assert.doesNotMatch(r.stderr, new RegExp(FAKE_TOKEN));
  assert.equal(run({ tool_name: 'Read', tool_input: { file_path: f.secret, offset: 1, limit: 2 }, session_id: 'suite' }).status, 2, 'a ranged Read reads the same value');
  assert.equal(read(path.join('.claude', 'settings-secret.json')), 2, 'a relative file_path resolves against CLAUDE_PROJECT_DIR');
});

test('guard-secret-value: a runtime printing an environment variable is the same leak as echo $VAR', () => {
  assert.equal(bash('node -e "console.log(process.env.SENTRY_ACCESS_TOKEN)"'), REWRITE, 'process.env.NAME');
  assert.equal(bash('node -p process.env.SENTRY_ACCESS_TOKEN'), REWRITE, 'node -p of one variable');
  assert.equal(bash('node -p process.env'), REWRITE, 'node -p of the whole environment');
  assert.equal(bash('python3 -c "import os;print(os.environ.get(\'SENTRY_ACCESS_TOKEN\'))"'), REWRITE, 'os.environ.get');
  assert.equal(bash('python3 -c "import os;print(os.environ[\'SENTRY_ACCESS_TOKEN\'])"'), REWRITE, 'os.environ[NAME]');
  assert.equal(bash('python3 -c "import os;print(os.environ)"'), REWRITE, 'the whole environment through python');
  assert.equal(bash('ruby -e \'puts ENV["SENTRY_ACCESS_TOKEN"]\''), REWRITE, 'ruby ENV[NAME]');
  assert.equal(bash('perl -e \'print $ENV{SENTRY_ACCESS_TOKEN}\''), REWRITE, 'perl $ENV{NAME}');
  assert.equal(bash('node -e "console.log(process.env.HOME)"'), 0, 'a non-credential variable');
  assert.equal(bash('node -e "console.log(Object.keys(process.env))"'), 0, 'names only is presence');
});

test('guard-secret-value: a quoted or escaped path with a space stays one token', () => {
  const f = fixtures();
  assert.equal(bash(`cat "${f.spaced}"`), REWRITE, 'double-quoted');
  assert.equal(bash(`cat '${f.spaced}'`), REWRITE, 'single-quoted');
  assert.equal(bash(`cat ${f.spaced.replace(/ /g, '\\ ')}`), REWRITE, 'backslash-escaped');
  assert.equal(bash('cat "$CLAUDE_PROJECT_DIR/my dir/settings.json"'), REWRITE, 'a variable expanding to a path with a space');
});

test('guard-secret-value: a label, a template value and a public key are not live credentials', () => {
  const f = fixtures();
  assert.equal(bash(`cat ${f.i18n}`), 0, 'an i18n bundle whose value repeats its key');
  assert.equal(read(f.i18n), 0, 'the same through Read');
  assert.equal(bash(`cat ${f.manifest}`), 0, 'the MV3 manifest key is a PUBLIC key');
  assert.equal(read(f.manifest), 0, 'the same through Read');
  assert.equal(bash(`cat ${f.envExample}`), 0, 'a .env.example is a template by name and by value');
  assert.equal(read(f.envExample), 0, 'the same through Read');
  assert.equal(bash(`cat ${f.envSample}`), 0, 'a .sample basename is a template');
  assert.equal(bash(`cat ${f.testFixture}`), REWRITE, 'accepted: no content tell separates a fake test credential from a real one - the --presence route reads it');
});

test('guard-secret-value: a malformed cwd never crashes the gate', () => {
  const rel = path.join('.claude', 'settings-secret.json');
  assert.equal(verdict(run({ tool_name: 'Bash', tool_input: { command: `cat ${rel}` }, cwd: 5, session_id: 'suite' })), REWRITE, 'a numeric cwd - judged against the remaining anchors');
  assert.equal(verdict(run({ tool_name: 'Bash', tool_input: { command: `cat ${rel}` }, cwd: { a: 1 }, session_id: 'suite' })), REWRITE, 'an object cwd');
});

const presence = (...args) => spawnSync(process.execPath, [HOOK, '--presence', ...args], { encoding: 'utf8' });

test('guard-secret-value --presence: reports set (N chars) or absent, never a value', () => {
  const f = fixtures();
  const r = presence(f.secret, 'SENTRY_ACCESS_TOKEN', 'SENTRY_SLUG', 'CONTEXT7_API_KEY');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'SENTRY_ACCESS_TOKEN=set (40 chars)\nSENTRY_SLUG=set (4 chars)\nCONTEXT7_API_KEY=absent\n');
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(FAKE_TOKEN));
  assert.equal(presence(f.secret).stdout, 'SENTRY_SLUG=set (4 chars)\nSENTRY_ACCESS_TOKEN=set (40 chars)\n', 'no keys: every env key, in file order');
  assert.equal(presence(f.dotenv, 'API_KEY', 'DB_HOST').stdout, 'API_KEY=set (6 chars)\nDB_HOST=set (9 chars)\n', 'dotenv');
  assert.equal(presence(f.emptyDotenv, 'API_KEY').stdout, 'API_KEY=absent\n', 'an empty value is absent');
  assert.equal(presence(f.mcp, 'CONTEXT7_API_KEY').stdout, 'CONTEXT7_API_KEY=absent\n', 'no env block and no top-level key');
  const missing = presence(path.join(f.dir, 'nope.json'), 'SENTRY_SLUG');
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, `# ${path.join(f.dir, 'nope.json')}: not found\nSENTRY_SLUG=absent\n`);
  const tilde = presence('~/.this-file-does-not-exist-guard-secret-value.json', 'X');
  assert.match(tilde.stdout, /^# .*\.this-file-does-not-exist-guard-secret-value\.json: not found\nX=absent\n$/, '~ is expanded');
});

test('guard-secret-value: a CRLF dotenv file - the Windows-authored spelling - is read like an LF one', () => {
  // `DOTENV_LINE` ends in `(.*)$`, and `.` never crosses a line terminator, so a line split on `\n`
  // alone leaves a `\r` that no line matched: a CRLF .env was never judged (a live key passed) and
  // --presence reported every key absent.
  const f = fixtures();
  assert.equal(bash(`cat ${f.crlf}`), REWRITE, 'a live key in a CRLF file blocks');
  assert.equal(presence(f.crlf, 'API_KEY', 'SMTP_SECRET', 'DB_HOST').stdout,
    'API_KEY=set (6 chars)\nSMTP_SECRET=set (8 chars)\nDB_HOST=set (9 chars)\n', 'lengths count no \\r');
});

test('guard-secret-value: the shell\'s own variable dumps are whole-environment dumps', () => {
  assert.equal(bash('set | grep -i sentry'), REWRITE, 'set prints every variable, exported or not');
  assert.equal(bash('export | grep -i sentry'), REWRITE, 'export with no argument lists values');
  assert.equal(bash('export -p'), REWRITE, 'the portable spelling');
  assert.equal(bash('declare -p | grep TOKEN'), REWRITE, 'declare -p is the same list');
  assert.equal(bash('declare -p SENTRY_ACCESS_TOKEN'), REWRITE, 'a NAME argument is judged like printenv NAME');
  assert.equal(bash('typeset -p'), REWRITE, 'the ksh/zsh spelling');
  assert.equal(bash('set -e'), 0, 'a shell option carries an argument - not a dump');
  assert.equal(bash('set -- x'), 0, 'positional parameters');
  assert.equal(bash('export FOO=1'), 0, 'an assignment');
  assert.equal(bash('declare -a arr'), 0, 'a declaration');
  assert.equal(bash('declare -p ALFRED_CODE_INSTRUMENT'), 0, 'a non-credential name');
});

test('guard-secret-value: a runtime handed the credential file, or building its path, is judged', () => {
  const f = fixtures();
  assert.equal(bash(`python3 -m json.tool ${f.secret}`), REWRITE, 'the file as a bare argument');
  assert.equal(bash(`perl -ne 'print' ${f.secret}`), REWRITE, 'perl -ne');
  assert.equal(bash(`perl -pe '' ${f.secret}`), REWRITE, 'perl -pe');
  assert.equal(bash(`python3 -c "import sys;print(open(sys.argv[1]).read())" ${f.secret}`), REWRITE, 'argv[1]');
  assert.equal(bash(`node -e "console.log(require('fs').readFileSync(process.argv[1],'utf8'))" ${f.secret}`), REWRITE, 'process.argv[1]');
  assert.equal(bash('node -e "const p=require(\'path\').join(require(\'os\').homedir(),\'.claude\',\'settings.json\');console.log(require(\'fs\').readFileSync(p,\'utf8\'))"'), REWRITE, 'the account dir built at runtime - CLAUDE_CONFIG_DIR is the FAKE account this suite pins');
  assert.equal(bash('python3 -c "import os;print(open(os.path.join(os.path.expanduser(\'~\'),\'.claude\',\'settings.json\')).read())"'), REWRITE, 'the same in python');
  assert.equal(bash('node -e "console.log(require(\'fs\').readFileSync(`' + f.secret + '`,\'utf8\'))"'), REWRITE, 'a template literal');
  assert.equal(bash(`node -e "console.log(require('fs').readFileSync('${f.clean}','utf8'))"`), 0, 'a clean file still passes');
});

test('guard-secret-value: a cd moves the anchor, and a heredoc feeding a runtime or a shell is code', () => {
  const f = fixtures();
  assert.equal(bash('cd .claude && cat settings-secret.json'), REWRITE, 'a relative cd');
  assert.equal(bash('cd sub && cat settings.json'), REWRITE, 'the same file name lives in two directories');
  assert.equal(bash(`cd ${ROOT}/sub; cat settings.json`), REWRITE, 'an absolute cd, ; separated');
  assert.equal(bash(`python3 - <<'EOF'\nimport json;print(json.load(open('${f.secret}')))\nEOF`), REWRITE, 'a python heredoc');
  assert.equal(bash(`node <<'EOF'\nconsole.log(require('fs').readFileSync('${f.secret}','utf8'))\nEOF`), REWRITE, 'a node heredoc');
  assert.equal(bash(`bash <<'EOF'\ncat ${f.secret}\nEOF`), REWRITE, 'a shell heredoc');
  assert.equal(bash('node - <<\'EOF\'\nconsole.log(process.env.SENTRY_ACCESS_TOKEN)\nEOF'), REWRITE, 'a heredoc reading the environment');
  assert.equal(bash(`cat <<'EOF' > ${path.join(f.dir, 'plan2.md')}\nStep 1: cat ${f.secret} to check the env block\nEOF`), 0, 'a document that MENTIONS a dump is still prose');
});

test('guard-secret-value: a heredoc is judged by what reads its body (2.1.6 K1)', () => {
  // Measured: a `node - <<'EOF'` script WRITING test text that named "$CLAUDE_CONFIG_DIR/.claude.json" was blocked as a
  // read of this machine's account file. With the tag quoted, the shell hands the body over verbatim, and node never
  // expands `$NAME` - that string is the runtime's text, never a path it opens.
  const acctFile = path.join(ACCOUNT, '.claude.json');
  fs.writeFileSync(acctFile, SECRET_JSON);
  try {
    const writer = "node - <<'EOF'\nconst text = 'cat \"$CLAUDE_CONFIG_DIR/.claude.json\"';\nrequire('fs').writeFileSync('" + path.join(TMP, 'k1.test.js') + "', text);\nEOF";
    assert.equal(bash(writer), 0, 'a quoted-tag runtime body writing test text reads nothing');
    assert.equal(bash('cat > ' + path.join(TMP, 'k1.sh') + " <<'EOF'\ncat \"$CLAUDE_CONFIG_DIR/.claude.json\"\nEOF"), 0, 'a script FILE written through cat is data - .sh in its name runs nothing');
    // ... and every real read still judges
    assert.equal(bash('cat "$CLAUDE_CONFIG_DIR/.claude.json"'), REWRITE, 'cat');
    assert.equal(bash('jq . < "$CLAUDE_CONFIG_DIR/.claude.json"'), REWRITE, 'jq from a redirect');
    assert.equal(bash("node <<'EOF'\nconsole.log(require('fs').readFileSync('" + acctFile + "','utf8'))\nEOF"), REWRITE, 'a quoted-tag node heredoc reading a literal path');
    assert.equal(bash("node <<EOF\nconsole.log(require('fs').readFileSync('$CLAUDE_CONFIG_DIR/.claude.json','utf8'))\nEOF"), REWRITE, 'an UNquoted tag: the shell expands $NAME before node runs');
    assert.equal(bash("node <<'EOF'\nconst CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;\nconsole.log(require('fs').readFileSync(`${CLAUDE_CONFIG_DIR}/.claude.json`,'utf8'))\nEOF"), REWRITE, 'a quoted tag whose code binds the name from the environment');
    assert.equal(bash("bash <<'EOF'\ncat \"$CLAUDE_CONFIG_DIR/.claude.json\"\nEOF"), REWRITE, 'a shell body expands $NAME itself');
    assert.equal(bash("cat <<'EOF'; cat \"$CLAUDE_CONFIG_DIR/.claude.json\"\nhello\nEOF"), REWRITE, 'a command after the heredoc on its first line runs');
    assert.equal(bash("cat <<'EOF' | node\nconsole.log(require('fs').readFileSync('" + acctFile + "','utf8'))\nEOF"), REWRITE, 'a heredoc piped into a runtime is code');
  } finally {
    fs.rmSync(acctFile, { force: true });
  }
});

test('guard-secret-value: a heredoc body is code only where its program reads the script from stdin (2.1.6)', () => {
  // The same reading as the read guard's: a body fed to a script file, or beside -c / -e / -m, is that program's
  // input data, not its code - `bash ./run.sh <<EOF` runs run.sh, never the body. An option's own value is no
  // script file, so `bash -o pipefail <<EOF` and `node -r ./x.js <<EOF` still run the body.
  const f = fixtures();
  const RS = `require('fs').readFileSync('${f.secret}','utf8')`;
  const code = [
    ['bash with an option value', `bash -o pipefail <<'EOF'\ncat ${f.secret}\nEOF`],
    ['zsh -s', `zsh -s <<'EOF'\ncat ${f.secret}\nEOF`],
    ['node with a preload', `node -r ./x.js <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['python with a flag before the stdin dash', `python3 -u - <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    // `-` IS the stdin script, and what follows it is the script's argv (the replay: `python3 - <file> <<'EOF'` edits)
    ['python3 - with an argument after the dash', `python3 - out.txt <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['node - with an argument after the dash', `node - out.txt <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['python3 - dumping the environment', `python3 - out.txt <<'EOF'\nimport os\nprint(os.environ)\nEOF`],
    // An option that takes the NEXT word as its value leaves that word no script file (review B1 of 2.1.6: each of
    // these passed, the value read as the script file and the body blanked as data)
    ['bash -euo pipefail, the o bundled', `bash -euo pipefail <<'EOF'\ncat ${f.secret}\nEOF`],
    ['bash -euo pipefail printing a variable', `bash -euo pipefail <<'EOF'\nprintenv SENTRY_ACCESS_TOKEN\nEOF`],
    ['bash -euo pipefail echoing a variable', `bash -euo pipefail <<'EOF'\necho $SENTRY_ACCESS_TOKEN\nEOF`],
    ['bash -eo pipefail', `bash -eo pipefail <<'EOF'\ncat ${f.secret}\nEOF`],
    ['bash -uo pipefail', `bash -uo pipefail <<'EOF'\ncat ${f.secret}\nEOF`],
    ['bash +o posix', `bash +o posix <<'EOF'\ncat ${f.secret}\nEOF`],
    ['bash --rcfile', `bash --rcfile /dev/null <<'EOF'\ncat ${f.secret}\nEOF`],
    ['bash --init-file', `bash --init-file x <<'EOF'\ncat ${f.secret}\nEOF`],
    ['node --max-old-space-size with a space value', `node --max-old-space-size 4096 <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['node --stack-size with a space value', `node --stack-size 4096 <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['node with an unknown long option', `node --some-future-flag 1 <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['python3 -Q with a value', `python3 -Q new <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['python3 -X with a value', `python3 -X dev <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['python3 --check-hash-based-pycs with a value', `python3 --check-hash-based-pycs never <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['perl -Mstrict -we with no script word', `perl -Mstrict -we <<'EOF'\nopen F,'${f.secret}';print <F>\nEOF`],
    ['ruby -r with a space value', `ruby -r json <<'EOF'\nputs File.read('${f.secret}')\nEOF`],
    // php runs stdin with no file named, and its `--` hands the words after it to that script
    ['php reading its script from stdin', `php <<'EOF'\n<?php echo file_get_contents('${f.secret}');\nEOF`],
    ['php -- with argv for a script from stdin', `php -- a b <<'EOF'\n<?php print_r(getenv());\nEOF`],
    ['php -d with a value', `php -d memory_limit=1G <<'EOF'\n<?php readfile('${f.secret}');\nEOF`],
  ];
  for (const [what, command] of code) assert.equal(bash(command), REWRITE, `code: ${what}`);
  const data = [
    ['a body fed to a shell script file', `bash ./run.sh <<'EOF'\ncat ${f.secret}\nEOF`],
    ['a body fed beside bash -c', `bash -c 'wc -l' <<'EOF'\ncat ${f.secret}\nEOF`],
    ['a body fed to node -e', `node -e 'process.stdin.resume()' <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['a body fed to a python script file', `python3 tool.py <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['a body fed to python -m', `python3 -m json.tool <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    // a shell's `-` / `--` only ends its options: the next word is still the script file
    ['a body fed to a shell script file after --', `bash -- ./run.sh <<'EOF'\ncat ${f.secret}\nEOF`],
    ['a body fed to a script file after -euo pipefail', `bash -euo pipefail ./run.sh <<'EOF'\ncat ${f.secret}\nEOF`],
    ['a body fed to a script file after --rcfile', `bash --rcfile /dev/null ./run.sh <<'EOF'\ncat ${f.secret}\nEOF`],
    ['a body fed to node -e after a space-valued option', `node --max-old-space-size 4096 -e 'process.stdin.resume()' <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['a body fed to a node script after a boolean option', `node --enable-source-maps tool.js <<'EOF'\nconsole.log(${RS})\nEOF`],
    ['a body fed to a python script after -X', `python3 -X dev tool.py <<'EOF'\nprint(open('${f.secret}').read())\nEOF`],
    ['a body fed to perl -e', `perl -Mstrict -we 'print <STDIN>' <<'EOF'\nopen F,'${f.secret}';print <F>\nEOF`],
    ['a body fed to a php script file', `php tool.php <<'EOF'\n<?php readfile('${f.secret}');\nEOF`],
    ['a body fed beside php -r', `php -r 'echo 1;' <<'EOF'\n<?php readfile('${f.secret}');\nEOF`],
  ];
  for (const [what, command] of data) assert.equal(bash(command), 0, `data: ${what}`);
});

// Replay of 52,732 corpus commands: a node script editing CLAUDE.md was blocked as 'WRITES a file and names
// ~/.aws/credentials' - the path was documentation between Markdown backticks inside a JS string. A runtime never
// expands `~` itself, so a `~/` string in its code is text unless the code expands it (expanduser, expand_path, a
// glob, a replace with the home directory) or the runtime is PowerShell, whose provider paths do.
// Review B2 of 2.1.6: the shell candidates were only tokens carrying a `/`, `.`, `~` or `$`, so after a `cd` into a
// credentials directory the bare file name was never judged - `cd ~/.aws && cat credentials` passed while
// `cat ~/.aws/credentials` was rewritten. A bare operand of a dump verb is a file name like any other, resolved
// against the cd target, `env -C`'s directory and the session's own directory.
test('guard-secret-value: a bare file name a dump verb reads is judged where the shell stands (2.1.6)', () => {
  const home = fs.mkdtempSync(path.join(TMP, 'home-bare-'));
  fs.mkdirSync(path.join(home, '.aws'));
  fs.writeFileSync(path.join(home, '.aws', 'credentials'), `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  fs.mkdirSync(path.join(home, '.kube'));
  fs.writeFileSync(path.join(home, '.kube', 'config'), `apiVersion: v1\nkind: Config\nusers:\n- name: dev\n  user:\n    token: ${FAKE_TOKEN}\n`);
  fs.writeFileSync(path.join(home, '.aws', 'notes'), 'nothing secret here\n');
  const b = (command, cwd) => bash(command, { HOME: home, USERPROFILE: '', ...(cwd ? { CLAUDE_PROJECT_DIR: cwd } : {}) });
  try {
    const reads = [
      ['cd then cat', 'cd ~/.aws && cat credentials'],
      ['cd then head', 'cd ~/.aws && head credentials'],
      ['cd then cat a kubeconfig', 'cd ~/.kube && cat config'],
      ['cd with a semicolon', 'cd ~/.aws; cat credentials'],
      ['pushd', 'pushd ~/.aws && cat credentials'],
      ['a subshell cd', '(cd ~/.aws && cat credentials)'],
      ['env -C', `env -C ${path.join(home, '.aws')} cat credentials`],
      ['env --chdir=', `env --chdir=${path.join(home, '.aws')} cat credentials`],
      ['a grep whose pattern came by -e', 'cd ~/.aws && grep -e aws credentials'],
      ['a head with a value flag first', 'cd ~/.aws && head -n 5 credentials'],
    ];
    for (const [what, command] of reads) assert.equal(b(command), REWRITE, `read: ${what}`);
    assert.equal(b('cat credentials', path.join(home, '.aws')), REWRITE, 'a bare name in the session directory itself');
    const pass = [
      ['a bare name holding nothing', 'cd ~/.aws && cat notes'],
      ['a bare name that is no file', 'cd ~/.aws && cat missing'],
      ['a grep pattern word beside a clean file', 'cd ~/.aws && grep -n credentials notes'],
      ['a dump verb only named as an option', 'cd ~/.aws && find . -type f -name credentials'],
      ['a flag value beside a clean file', 'cd ~/.aws && grep -A 2 -m credentials aws notes'],
    ];
    for (const [what, command] of pass) assert.equal(b(command), 0, `pass: ${what}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guard-secret-value: the routes that print a file without a dump verb\'s name are judged too (2.1.6)', () => {
  // Review item 5 of 2.1.6: each of these printed ~/.aws/credentials or a dotenv whole on base and on the first 2.1.6 tree.
  const home = fs.mkdtempSync(path.join(TMP, 'home-routes-'));
  const aws = path.join(home, '.aws');
  fs.mkdirSync(aws);
  const cred = path.join(aws, 'credentials');
  fs.writeFileSync(cred, `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  fs.writeFileSync(path.join(aws, 'notes'), 'nothing secret here\n');
  const b = (command, cwd) => bash(command, { HOME: home, USERPROFILE: '', ...(cwd ? { CLAUDE_PROJECT_DIR: cwd } : {}) });
  try {
    const reads = [
      ['dd if=', `dd if=${cred}`],
      ['dd if= with a tilde and a status operand', 'dd if=~/.aws/credentials status=none'],
      ['dd onto stdout', `dd if=${cred} of=/dev/stdout`],
      ['dd if= of a bare name where the shell stands', 'cd ~/.aws && dd if=credentials'],
      ['iconv', `iconv -f utf-8 -t utf-8 ${cred}`],
      ['iconv -o onto stdout', `iconv -f utf-8 -t ascii -o /dev/stdout ${cred}`],
      ['php -r building the path from HOME', 'php -r \'echo file_get_contents(getenv("HOME")."/.aws/credentials");\''],
      ['php -r on a literal path', `php -r 'echo file_get_contents("${cred}");'`],
      ['sqlite3 readfile()', `sqlite3 :memory: "select readfile('${cred}')"`],
      ['sqlite3 readfile() of a bare name where the shell stands', 'cd ~/.aws && sqlite3 :memory: "select cast(readfile(\'credentials\') as text)"'],
      ['sqlite3 .shell', 'sqlite3 :memory: \'.shell cat ~/.aws/credentials\''],
      ['curl file://', `curl -s file://${cred}`],
      ['curl --url file://', `curl --url file://${cred}`],
      ['curl file:// under $PWD after a cd', 'cd ~/.aws && curl -s file://$PWD/credentials'],
      ['vim -es +%p', `vim -es +%p +q! ${cred}`],
      ['ex -s +%print', `ex -s '+%print' '+q!' ${cred}`],
      ['vi -es -c %p', `vi -es -c '%p' -c 'q!' ${cred}`],
      ['vim with no terminal paints the file', `vim ${cred}`],
      ['cp onto stdout', `cp ${cred} /dev/stdout`],
      ['cp onto stderr', 'cp ~/.aws/credentials /dev/stderr'],
      ['cp a bare name onto fd 1', 'cd ~/.aws && cp credentials /dev/fd/1'],
      ['split --filter', `split --filter=cat ${cred}`],
      ['split onto a device prefix', `split -l 100 ${cred} /dev/stdout`],
      ['expand', `expand ${cred}`],
      ['unexpand', `unexpand -a ${cred}`],
      ['fmt', `fmt -w 200 ${cred}`],
      ['zcat -f', `zcat -f ${cred}`],
      ['gzcat -f', `gzcat -f ${cred}`],
      ['look with an empty prefix', `look '' ${cred}`],
    ];
    for (const [what, command] of reads) assert.equal(b(command), REWRITE, `read: ${what}`);
    const pass = [
      ['cp to a backup', `cp ${cred} ${cred}.bak`],
      ['dd into a file', `dd if=${cred} of=${path.join(home, 'copy')}`],
      ['iconv -o into a file', `iconv -f utf-8 -t ascii -o ${path.join(home, 'out')} ${cred}`],
      ['curl -o into a file', `curl -s -o ${path.join(home, 'out')} file://${cred}`],
      ['curl -O', `curl -sO file://${cred}`],
      ['curl over https', 'curl -s https://example.com/.aws/credentials'],
      ['a vim edit that prints nothing', `vim -es '+%s/old/new/' '+wq' ${cred}`],
      ['sqlite3 with no file read', 'sqlite3 :memory: "select 1"'],
      ['look with only a prefix', 'look abc'],
      ['php -r reading nothing', "php -r 'echo 1;'"],
      ['a clean file through the same routes', `dd if=${path.join(aws, 'notes')} && iconv -f utf-8 -t utf-8 ${path.join(aws, 'notes')}`],
    ];
    for (const [what, command] of pass) assert.equal(b(command), 0, `pass: ${what}`);
    assert.equal(b(`vim -es '+%s/old/new/' '+%p' '+wq' ${cred}`), 2, 'a vim run that prints AND writes is blocked, never half-rewritten');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guard-secret-value: a string a shell runs is judged as that shell (2.1.6)', () => {
  // Found in the 2.1.6 review round, on base too: each of these printed ~/.aws/credentials with no rewrite, while the same
  // string inside a runtime's execSync(...) was judged.
  const home = fs.mkdtempSync(path.join(TMP, 'home-shellrun-'));
  const aws = path.join(home, '.aws');
  fs.mkdirSync(aws);
  const cred = path.join(aws, 'credentials');
  fs.writeFileSync(cred, `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const b = (command) => bash(command, { HOME: home, USERPROFILE: '' });
  try {
    const reads = [
      ['bash -c', "bash -c 'cat ~/.aws/credentials'"],
      ['sh -c double-quoted', `sh -c "cat ${cred}"`],
      ['bash -lc, the c bundled', "bash -lc 'cat ~/.aws/credentials'"],
      ['bash -e -c, the c alone after a flag', "bash -e -c 'head ~/.aws/credentials'"],
      ['bash -o pipefail -c, a flag taking a value', "bash -o pipefail -c 'cat ~/.aws/credentials'"],
      ['a shell nested in a shell', `bash -c "sh -c 'cat ${cred}'"`],
      ['eval', 'eval "cat ~/.aws/credentials"'],
      ['watch', "watch -n 1 'cat ~/.aws/credentials'"],
      ['su -c', "su root -c 'cat ~/.aws/credentials'"],
      ['echo piped into sh', 'echo "cat ~/.aws/credentials" | sh'],
      ['printf piped into bash', "printf 'cat ~/.aws/credentials\\n' | bash"],
      // a command string a runtime BUILDS from the home directory, handed to a shell
      ['node execSync of a built command', 'node -e \'require("child_process").execSync("cat " + require("os").homedir() + "/.aws/credentials", {stdio: "inherit"})\''],
      ['node execSync of a name bound to a built command', 'node -e \'const c = "cat " + require("os").homedir() + "/.aws/credentials"; require("child_process").execSync(c, {stdio: "inherit"})\''],
      ['python os.system of a built command', 'python3 -c \'import os; os.system("cat " + os.path.expanduser("~") + "/.aws/credentials")\''],
      // Re-verify 1 of 2.1.6: a wrapper word and its own arguments before the shell hid the string
      ['timeout', "timeout 30 bash -c 'cat ~/.aws/credentials'"],
      ['timeout with a signal flag', "timeout -s KILL 5 sh -c 'cat ~/.aws/credentials'"],
      ['env with an assignment', "env FOO=1 bash -c 'cat ~/.aws/credentials'"],
      ['env -u NAME', "env -u FOO bash -c 'cat ~/.aws/credentials'"],
      ['nice -n', "nice -n 5 bash -c 'cat ~/.aws/credentials'"],
      ['nohup', "nohup bash -c 'cat ~/.aws/credentials'"],
      ['sudo -u', "sudo -u root bash -c 'cat ~/.aws/credentials'"],
      ['stdbuf -oL', "stdbuf -oL bash -c 'cat ~/.aws/credentials'"],
      ['ionice -c', "ionice -c 3 bash -c 'cat ~/.aws/credentials'"],
      ['time', "time bash -c 'cat ~/.aws/credentials'"],
      ['command', "command bash -c 'cat ~/.aws/credentials'"],
      ['exec', "exec bash -c 'cat ~/.aws/credentials'"],
      ['wrappers stacked', "sudo -E timeout --signal=TERM 30 nice -n 5 env -i PATH=/usr/bin bash -c 'cat ~/.aws/credentials'"],
      ['a wrapper before eval', 'timeout 5 eval "cat ~/.aws/credentials"'],
      ['echo piped into a wrapped sh', 'echo "cat ~/.aws/credentials" | timeout 5 sh'],
      // Re-verify 1 of 2.1.6: a printed substitution prints what its command read
      ['echo of a substitution', 'echo "$(cat ~/.aws/credentials)"'],
      ['printf of a substitution', "printf '%s\\n' \"$(cat ~/.aws/credentials)\""],
      ['echo of a backtick substitution', 'echo `cat ~/.aws/credentials`'],
    ];
    for (const [what, command] of reads) assert.equal(b(command), REWRITE, `read: ${what}`);
    const pass = [
      ['bash running a script file', "bash ./run.sh 'cat ~/.aws/credentials'"],
      ['a -c string that only counts', "bash -c 'wc -l ~/.aws/credentials'"],
      ['echo piped into a shell running a script file', 'echo "cat ~/.aws/credentials" | bash ./run.sh'],
      ['echo on its own', 'echo "cat ~/.aws/credentials"'],
      ['a grep pattern naming the read', "grep -c 'cat ~/.aws/credentials' notes.md"],
      ['a built message printed, no shell', 'node -e \'console.log("config at " + require("os").homedir() + "/.aws/credentials")\''],
      ['timeout running a script file', "timeout 30 bash ./run.sh 'cat ~/.aws/credentials'"],
      ['a wrapped -c string that only counts', "timeout 30 bash -c 'wc -l ~/.aws/credentials'"],
      ['echo of a substitution that counts', 'echo "$(wc -l < ~/.aws/credentials)"'],
      ['echo of a substitution reading nothing', 'echo "$(date)"'],
    ];
    for (const [what, command] of pass) assert.equal(b(command), 0, `pass: ${what}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guard-secret-value: a UTF-16 file is judged by its decoded content, on every route (2.1.6)', () => {
  // Review item 5 of 2.1.6: a UTF-16 dotenv or settings file (Windows PowerShell 5 writes UTF-16LE with a BOM) read as no
  // credential at all, since its bytes never matched a KEY=value line.
  const dir = fs.mkdtempSync(path.join(TMP, 'u16-'));
  const le = (t) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);
  const be = (t) => { const b = Buffer.from(t, 'utf16le'); for (let i = 0; i + 1 < b.length; i += 2) { const x = b[i]; b[i] = b[i + 1]; b[i + 1] = x; } return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); };
  const envLe = path.join(dir, 'u16.env'); fs.writeFileSync(envLe, le(`DB_HOST=localhost\nAPI_KEY=${FAKE_TOKEN}\n`));
  const envBe = path.join(dir, 'u16be.env'); fs.writeFileSync(envBe, be(`API_KEY=${FAKE_TOKEN}\n`));
  const json = path.join(dir, 'u16.json'); fs.writeFileSync(json, le(SECRET_JSON));
  const clean = path.join(dir, 'clean16.env'); fs.writeFileSync(clean, le('DB_HOST=localhost\n'));
  try {
    assert.equal(bash(`cat ${envLe}`), REWRITE, 'a UTF-16LE dotenv on the shell route');
    assert.equal(bash(`cat ${envBe}`), REWRITE, 'a UTF-16BE dotenv on the shell route');
    assert.equal(bash(`cat ${json}`), REWRITE, 'a UTF-16LE settings file on the shell route');
    assert.equal(read(json), 2, 'the Read tool on a UTF-16LE settings file');
    assert.equal(bash(`cat ${clean}`), 0, 'a UTF-16 file holding no credential passes');
    const p = presence(envLe, 'API_KEY', 'DB_HOST').stdout;
    assert.match(p, new RegExp(`API_KEY=set \\(${FAKE_TOKEN.length} chars\\)`), 'the presence read decodes it');
    assert.match(p, /DB_HOST=set/, 'the presence read decodes every key');
    const view = cli('--redacted', json).stdout;
    assert.ok(!view.includes(FAKE_TOKEN) && !view.includes('\u0000'), 'the redacted view decodes it and masks the value');
    assert.match(view, /SENTRY_ACCESS_TOKEN/, 'the redacted view keeps the key name');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard-secret-value: a ~/ path inside runtime code is text unless the code expands the tilde (2.1.6)', () => {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  fs.mkdirSync(path.join(home, '.aws'));
  fs.writeFileSync(path.join(home, '.aws', 'credentials'), `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const b = (command) => bash(command, { HOME: home, USERPROFILE: '' });
  try {
    const text = [
      ['documentation between backticks in a node string', "node -e 'const s=\"Judged by content (INI - `~/.aws/credentials`, `~/.pypirc`)\"; require(\"fs\").writeFileSync(\"notes.md\", s)'"],
      ['a python string naming the path', "python3 -c \"s='see ~/.aws/credentials for the key'; open('notes.md','w').write(s)\""],
      ['a node read of a literal ~/ path, which node does not expand', "node -e 'console.log(require(\"fs\").readFileSync(\"~/.aws/credentials\",\"utf8\"))'"],
    ];
    for (const [what, command] of text) assert.equal(b(command), 0, `text: ${what}`);
    const reads = [
      ['python expanduser', "python3 -c \"import os;print(open(os.path.expanduser('~/.aws/credentials')).read())\""],
      ['python Path.expanduser', "python3 -c \"from pathlib import Path;print(Path('~/.aws/credentials').expanduser().read_text())\""],
      ['node replacing the tilde with the home directory', "node -e 'const p=\"~/.aws/credentials\".replace(/^~/, require(\"os\").homedir());console.log(require(\"fs\").readFileSync(p,\"utf8\"))'"],
      ['ruby File.expand_path', "ruby -e 'puts File.read(File.expand_path(\"~/.aws/credentials\"))'"],
      ['perl glob', "perl -e 'open(F, glob(\"~/.aws/credentials\")); print <F>'"],
      ['pwsh Get-Content, which expands the tilde itself', "pwsh -c 'Get-Content \"~/.aws/credentials\"'"],
      ['the shell expanding an unquoted tilde', 'cat ~/.aws/credentials'],
    ];
    for (const [what, command] of reads) assert.equal(b(command), REWRITE, `read: ${what}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Found beside the tilde rule: a runtime that hands a shell a COMMAND STRING (`execSync("cat ~/.aws/credentials")`,
// `os.system('env')`, Ruby backticks) printed the file or the environment unjudged - the scan saw one quoted string,
// `cat <path>`, which is no path. That string is shell, and is judged as the shell it runs.
test('guard-secret-value: a command string a runtime hands to a shell is judged as that shell (2.1.6)', () => {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  fs.mkdirSync(path.join(home, '.aws'));
  fs.writeFileSync(path.join(home, '.aws', 'credentials'), `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const b = (command) => bash(command, { HOME: home, USERPROFILE: '' });
  try {
    const judged = [
      ['node execSync', "node -e 'console.log(require(\"child_process\").execSync(\"cat ~/.aws/credentials\").toString())'"],
      ['node spawnSync sh -c', "node -e 'console.log(require(\"child_process\").spawnSync(\"sh\", [\"-c\", \"cat ~/.aws/credentials\"]).stdout.toString())'"],
      ['python os.system', "python3 -c \"import os; os.system('cat ~/.aws/credentials')\""],
      ['python subprocess with shell=True', "python3 -c \"import subprocess; print(subprocess.run('cat ~/.aws/credentials', shell=True, capture_output=True).stdout)\""],
      ['python os.popen in a heredoc', "python3 - <<'EOF'\nimport os\nprint(os.popen('head -5 ~/.aws/credentials').read())\nEOF"],
      ['ruby backticks', "ruby -e 'puts `cat ~/.aws/credentials`'"],
      ['perl qx', "perl -e 'print qx{cat ~/.aws/credentials}'"],
      ['node execSync of the environment', "node -e 'console.log(require(\"child_process\").execSync(\"env\").toString())'"],
      ['python os.system of the environment', "python3 -c \"import os; os.system('printenv')\""],
    ];
    for (const [what, command] of judged) assert.notEqual(b(command), 0, `judged: ${what}`);
    const allowed = [
      ['node execSync of git', "node -e 'console.log(require(\"child_process\").execSync(\"git status --short\").toString())'"],
      ['a mode word beside a spawn call', "node -e 'const mode = \"env\"; if (mode === \"set\") require(\"child_process\").execSync(\"git log -1\")'"],
      ['python os.system of a build', "python3 -c \"import os; os.system('npm test')\""],
      ['a JS template literal is no shell', "node -e 'const f = `cat ~/.aws/credentials`; require(\"fs\").writeFileSync(\"notes.md\", f)'"],
    ];
    for (const [what, command] of allowed) assert.equal(b(command), 0, `allowed: ${what}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// Replay of 52,732 corpus commands: two Python edit scripts (`python3 - <file> <<'EOF'`) were blocked as 'WRITES a file and
// names the whole environment' - one carried JS test text (`{ ...process.env }`, `JSON.stringify(`) inside a Python
// string, the other a JS regex `/^(sudo|env|nohup)$/`, whose `|env|` the shell splitter read as a bare `env` stage.
test('guard-secret-value: a runtime body reads the environment only in its own language, never through a shell stage (2.1.6)', () => {
  const edit = (inner) => `python3 - f.js <<'EOF'\nimport sys\np = sys.argv[1]\ns = open(p).read()\ns = s.replace("""${inner}""", """x""")\nopen(p, 'w').write(s)\nEOF`;
  const data = [
    ['JS text inside a Python string', edit('  const stdin = Buffer.from(JSON.stringify(payload));\n  const saved = { ...process.env };')],
    ['a JS regex alternation naming env inside a Python string', edit("while (/^(sudo|env|nohup|time)$/.test(words[0])) words.shift();")],
    ['Python text inside a node string', `node - <<'EOF'\nconst src = "import os\\nprint(os.environ)";\nrequire('fs').writeFileSync('gen.py', src);\nEOF`],
  ];
  for (const [what, command] of data) assert.equal(bash(command), 0, `data: ${what}`);
  const dumps = [
    ['python printing os.environ', `python3 - <<'EOF'\nimport os\nprint(os.environ)\nEOF`],
    ['python with an argument printing os.environ', `python3 - out.txt <<'EOF'\nimport os\nprint(dict(os.environ))\nEOF`],
    ['node printing process.env', `node - <<'EOF'\nconsole.log(JSON.stringify(process.env))\nEOF`],
    ['a heredoc piped into python printing os.environ', `cat <<'EOF' | python3\nimport os; print(os.environ)\nEOF`],
    ['a shell body keeps its env stage', `bash <<'EOF'\nenv | sort\nEOF`],
    ['ruby printing ENV', `ruby <<'EOF'\nputs ENV.to_h\nEOF`],
    ['an inline node script printing process.env', `node -e 'console.log(process.env)'`],
  ];
  for (const [what, command] of dumps) assert.equal(bash(command), REWRITE, `dump: ${what}`);
});

test('guard-secret-value: a credential path a runtime builds from the home directory is judged like a literal one (2.1.6)', () => {
  // A script that builds the path at run time (os.homedir(), process.env.HOME, Path.home(), Dir.home) handed the scan
  // no path at all: only a bare settings.json was ever anchored at home, so ~/.claude.json and ~/.docker/config.json read
  // that way were never judged. A FAKE home holds the credential files; the real one is never read.
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  fs.writeFileSync(path.join(home, '.claude.json'), SECRET_JSON);
  fs.mkdirSync(path.join(home, '.docker'));
  fs.writeFileSync(path.join(home, '.docker', 'config.json'), JSON.stringify({ auths: { 'registry.example': { auth: FAKE_TOKEN } } }));
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n  name = someone\n');
  const acctFile = path.join(ACCOUNT, '.claude.json');
  fs.writeFileSync(acctFile, SECRET_JSON);
  const b = (command) => bash(command, { HOME: home, USERPROFILE: '' });
  try {
    const built = [
      ['node, path.join(os.homedir(), ...)', "node -e \"console.log(require('fs').readFileSync(require('path').join(require('os').homedir(), '.claude.json'), 'utf8'))\""],
      ['node, os.homedir() + a literal', "node -e \"const os=require('os');console.log(require('fs').readFileSync(os.homedir() + '/.claude.json','utf8'))\""],
      ['node, a template over a name bound to the home', "node -e 'const fs=require(\"fs\");const h=require(\"os\").homedir();console.log(fs.readFileSync(`${h}/.claude.json`,\"utf8\"))'"],
      ['node, process.env.HOME and another credential file', "node -e 'console.log(require(\"fs\").readFileSync(require(\"path\").join(process.env.HOME, \".docker\", \"config.json\"), \"utf8\"))'"],
      ['node, process.env.CLAUDE_CONFIG_DIR', "node -e 'console.log(require(\"fs\").readFileSync(require(\"path\").join(process.env.CLAUDE_CONFIG_DIR, \".claude.json\"), \"utf8\"))'"],
      ['a node heredoc, the path bound statements before the read', "node - <<'EOF'\nconst path = require('path'), os = require('os');\nconst p = path.join(os.homedir(), '.claude.json');\nconsole.log(require('fs').readFileSync(p, 'utf8'));\nEOF"],
      ['a python heredoc, Path.home() / ...', "python3 - <<'EOF'\nfrom pathlib import Path\nprint((Path.home() / '.claude.json').read_text())\nEOF"],
      ['python, os.path.join(os.path.expanduser(\'~\'), ...)', "python3 -c \"import os;print(open(os.path.join(os.path.expanduser('~'), '.claude.json')).read())\""],
      ['ruby, File.join(Dir.home, ...)', "ruby -e 'puts File.read(File.join(Dir.home, \".claude.json\"))'"],
    ];
    for (const [what, command] of built) assert.equal(b(command), REWRITE, what);
    // ... and the same read spelled with the literal path takes the same verdict
    assert.equal(b("node -e \"console.log(require('fs').readFileSync('" + path.join(home, '.claude.json') + "', 'utf8'))\""), REWRITE, 'the literal twin');
    // controls: what must stay allowed
    assert.equal(b("node -e \"console.log(require('fs').readFileSync(require('path').join(require('os').homedir(), '.gitconfig'), 'utf8'))\""), 0, 'a home file holding no credential');
    assert.equal(b("node -e \"console.log(require('fs').readFileSync(require('path').join(require('os').homedir(), '.no-such-file.json'), 'utf8'))\""), 0, 'a home path that does not exist');
    assert.equal(b("node -e \"console.log(require('os').homedir())\""), 0, 'the home directory alone');
    assert.equal(b("node - <<'EOF'\nconst home = path.join(tmp, 'home');\nfs.writeFileSync(path.join(home, '.claude.json'), '{}');\nconst env = { HOME: home };\nEOF"), 0, 'test text building a SANDBOX home is not the real one');
    assert.equal(b("node -e 'process.env.HOME = \"/tmp/sandbox\"; console.log(require(\"fs\").readFileSync(require(\"path\").join(require(\"os\").homedir(), \".claude.json\"), \"utf8\"))'"), 0, 'a script that moves HOME first reads that home, not this one');
    const twin = b("node -e \"console.log('" + path.join(home, '.claude.json') + "')\"");
    assert.equal(b("node -e \"console.log(require('path').join(require('os').homedir(), '.claude.json'))\""), twin, 'a built path printed, not read, takes the verdict of its literal twin');
  } finally {
    fs.rmSync(acctFile, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('guard-secret-value: INI, netrc, npmrc and URL-per-line credential files are judged by content, and read by presence (2.1.6)', () => {
  // Only JSON and dotenv were ever credential files here, so `cat ~/.aws/credentials` (its first line a [section]),
  // ~/.pypirc, ~/.netrc, ~/.npmrc and ~/.git-credentials printed their values unjudged.
  const dir = fs.mkdtempSync(path.join(TMP, 'ini-'));
  const w = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  const aws = w('.aws/credentials', `# profiles\n[default]\naws_access_key_id = someid\naws_secret_access_key = ${FAKE_TOKEN}\n\n[work]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const pypirc = w('.pypirc', `[distutils]\nindex-servers =\n    pypi\n\n[pypi]\nusername = __token__\npassword: ${FAKE_TOKEN}\n`);
  const netrc = w('.netrc', `machine api.example.com\n  login someone\n  password ${FAKE_TOKEN}\n`);
  const gitCred = w('.git-credentials', `https://someone:${FAKE_TOKEN}@git.example.com\n`);
  const npmrc = w('.npmrc', `registry=https://registry.example.com/\n//registry.example.com/:_authToken=${FAKE_TOKEN}\n`);
  const appIni = w('app.ini', `[db]\nhost = localhost\npassword = ${FAKE_TOKEN}\n`);
  // what must stay allowed: INI files holding no credential, a template, a signing key NAME
  const gitconfig = w('.gitconfig', '[user]\n  name = someone\n  email = someone@example.com\n  signingkey = 3AA5C34371567BD2\n');
  const tox = w('tox.ini', '[tox]\nenvlist = py311\n\n[testenv]\ncommands = pytest\n');
  const template = w('app.ini.example', '[db]\npassword = changeme\n');
  const plainNetrc = w('other/.netrc', 'machine api.example.com\n  login someone\n');
  for (const [what, f] of [['aws', aws], ['pypirc (a colon pair)', pypirc], ['netrc', netrc], ['git-credentials', gitCred], ['npmrc', npmrc], ['a [section] file', appIni]]) {
    assert.equal(bash(`cat ${f}`), REWRITE, `${what}: a shell dump becomes the redacted view`);
    assert.equal(read(f), 2, `${what}: the Read tool is blocked`);
    const view = cli('--redacted', f).stdout;
    assert.ok(!view.includes(FAKE_TOKEN), `${what}: the view masks the value`);
    assert.match(view, /<set \(40 chars\)>/, `${what}: and says it was there`);
  }
  for (const [what, f] of [['a gitconfig with a signing key name', gitconfig], ['tox.ini', tox], ['a template', template], ['a netrc with no password', plainNetrc]]) {
    assert.equal(bash(`cat ${f}`), 0, `${what}: stays allowed`);
  }
  // the redacted view keeps what is not a credential, as written
  const awsView = cli('--redacted', aws).stdout;
  assert.match(awsView, /\[default\]/);
  assert.match(awsView, /aws_access_key_id = someid/);
  assert.match(cli('--redacted', netrc).stdout, /machine api\.example\.com/);
  assert.match(cli('--redacted', gitCred).stdout, /https:\/\/someone:<set \(40 chars\)>@git\.example\.com/);
  // presence reads name the key the way each format spells it
  assert.match(cli('--presence', aws, 'aws_secret_access_key').stdout, /^aws_secret_access_key=set \(40 chars\)$/m);
  assert.match(cli('--presence', aws, 'work.aws_secret_access_key').stdout, /^work\.aws_secret_access_key=set \(40 chars\)$/m);
  assert.match(cli('--presence', aws, 'default.aws_session_token').stdout, /=absent$/m);
  assert.match(cli('--presence', pypirc, 'pypi.password').stdout, /=set \(40 chars\)$/m);
  assert.match(cli('--presence', netrc, 'api.example.com.password').stdout, /=set \(40 chars\)$/m);
  assert.match(cli('--presence', gitCred, 'git.example.com').stdout, /=set \(40 chars\)$/m);
  assert.match(cli('--presence', npmrc, '//registry.example.com/:_authToken').stdout, /=set \(40 chars\)$/m);
  const listing = cli('--presence', aws).stdout;
  assert.match(listing, /^default\.aws_secret_access_key=set/m, 'the keyless listing names each section key');
  assert.ok(!listing.includes(FAKE_TOKEN), 'and never a value');
});

test('guard-secret-value: every credential file format is judged by content - YAML, XML, HCL, properties, pgpass, a key file (2.1.6)', () => {
  // The readers knew JSON, dotenv, INI, netrc and a URL per line, so `cat ~/.pgpass`, a kubeconfig, a gh hosts.yml, a
  // maven settings.xml, a NuGet.Config, a web.config connection string, a .terraformrc, a gradle.properties, a raw
  // private key and a vault token printed their values unjudged. Each format below is read by content; the formats
  // an existing reader already covers (.my.cnf, .s3cfg, a docker config.json 'auths' entry, cargo and pip INI files)
  // are proved here too.
  const dir = fs.mkdtempSync(path.join(TMP, 'formats-'));
  const w = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  const T = FAKE_TOKEN;
  const B64 = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQ';
  const formats = [
    // already read by an existing reader - proved, not changed
    ['.my.cnf (INI)', w('.my.cnf', `[client]\nuser = root\npassword = ${T}\n`), 'client.password'],
    ['.s3cfg (INI)', w('.s3cfg', `[default]\naccess_key = someid\nsecret_key = ${T}\n`), 'default.secret_key'],
    ['docker config.json auths (JSON)', w('.docker/config.json', JSON.stringify({ auths: { 'registry.example': { auth: T } } })), 'auths.registry.example.auth'],
    ['cargo credentials.toml (INI)', w('.cargo/credentials.toml', `[registry]\ntoken = "${T}"\n`), 'registry.token'],
    ['pip.conf index url (INI, a URL password)', w('pip.conf', `[global]\nindex-url = https://someone:${T}@pypi.example.com/simple\n`), 'global.index-url'],
    // newly read
    ['.pgpass', w('.pgpass', `# host:port:db:user:password\nlocalhost:5432:*:postgres:${T}\n`), 'localhost:5432:*:postgres'],
    ['a kubeconfig token', w('.kube/config', `apiVersion: v1\nkind: Config\nusers:\n- name: dev\n  user:\n    token: ${T}\n`), 'users.user.token'],
    ['a kubeconfig client key', w('kube2/config', `apiVersion: v1\nusers:\n- name: dev\n  user:\n    client-certificate-data: ${B64}\n    client-key-data: ${T}\n`), 'users.user.client-key-data'],
    ['gh hosts.yml', w('.config/gh/hosts.yml', `github.com:\n    user: someone\n    oauth_token: ${T}\n    git_protocol: https\n`), 'github.com.oauth_token'],
    ['.yarnrc.yml', w('.yarnrc.yml', `npmRegistryServer: "https://registry.example.com"\nnpmAuthToken: "${T}"\n`), 'npmAuthToken'],
    ['gem credentials', w('.gem/credentials', `---\n:rubygems_api_key: ${T}\n`), 'rubygems_api_key'],
    ['a Kubernetes Secret manifest', w('k8s/secret.yaml', `apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\nstringData:\n  password: ${T}\n`), 'stringData.password'],
    ['a compose environment list', w('docker-compose.yml', `services:\n  db:\n    image: postgres\n    environment:\n      - POSTGRES_PASSWORD=${T}\n`), 'POSTGRES_PASSWORD'],
    ['a YAML block holding a private key', w('tls.yaml', `tls:\n  key: |\n    -----BEGIN PRIVATE KEY-----\n    ${B64}\n    -----END PRIVATE KEY-----\n`), 'tls.key'],
    ['maven settings.xml', w('.m2/settings.xml', `<?xml version="1.0"?>\n<settings>\n  <servers>\n    <server>\n      <id>repo</id>\n      <username>someone</username>\n      <password>${T}</password>\n    </server>\n  </servers>\n</settings>\n`), 'settings.servers.server.password'],
    ['maven settings-security.xml', w('.m2/settings-security.xml', `<settingsSecurity>\n  <master>{${T}}</master>\n</settingsSecurity>\n`), 'settingsSecurity.master'],
    ['NuGet.Config', w('NuGet.Config', `<configuration>\n  <packageSourceCredentials>\n    <feed>\n      <add key="Username" value="someone" />\n      <add key="ClearTextPassword" value="${T}" />\n    </feed>\n  </packageSourceCredentials>\n</configuration>\n`), 'ClearTextPassword'],
    ['a web.config connection string', w('web.config', `<configuration>\n  <connectionStrings>\n    <add name="Db" connectionString="Server=db;Database=app;User Id=app;Password=${T};" />\n  </connectionStrings>\n</configuration>\n`), 'Db'],
    ['.terraformrc', w('.terraformrc', `credentials "app.terraform.io" {\n  token = "${T}"\n}\n`), 'app.terraform.io.token'],
    ['gradle.properties, a dotted first key', w('gradle.properties', `org.gradle.jvmargs=-Xmx2g\nsigning.password=${T}\n`), 'signing.password'],
    ['application.properties, a plain first key', w('application.properties', `server_port=8080\nspring.datasource.password=${T}\n`), 'spring.datasource.password'],
    ['rclone.conf, a pass key', w('rclone.conf', `[remote]\ntype = sftp\nuser = someone\npass = ${T}\n`), 'remote.pass'],
    ['.yarnrc (v1)', w('.yarnrc', `registry "https://registry.example.com"\n"//registry.example.com/:_authToken" "${T}"\n`), '//registry.example.com/:_authToken'],
    ['.htpasswd', w('.htpasswd', `someone:$apr1$abcdefgh$${T}\n`), 'someone'],
    ['a gitconfig URL carrying a token', w('gitconfig-url/.gitconfig', `[url "https://someone:${T}@github.com/"]\n\tinsteadOf = https://github.com/\n`), 'url "https://someone:<set>@github.com/"'],
    ['an OpenSSH private key', w('.ssh/id_ed25519', `-----BEGIN OPENSSH PRIVATE KEY-----\n${B64}\n${T}\n-----END OPENSSH PRIVATE KEY-----\n`), 'private key'],
    ['a PuTTY key', w('key.ppk', `PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: someone\nPublic-Lines: 1\n${B64}\nPrivate-Lines: 1\n${T}\nPrivate-MAC: ${T}\n`), 'private key'],
    ['a vault token', w('.vault-token', `${T}\n`), 'token'],
  ];
  for (const [what, f, key] of formats) {
    assert.equal(bash(`cat ${f}`), REWRITE, `${what}: a shell dump becomes the redacted view`);
    assert.equal(read(f), 2, `${what}: the Read tool is blocked`);
    const view = cli('--redacted', f).stdout;
    assert.ok(!view.includes(T), `${what}: the view masks the value`);
    assert.match(view, /<set \(\d+ chars\)>|<private key line>/, `${what}: and says it was there`);
    const listing = cli('--presence', f).stdout;
    assert.ok(!listing.includes(T), `${what}: the keyless presence listing prints no value`);
    if (!/<set>/.test(key)) assert.match(cli('--presence', f, key).stdout, /=set \(\d+ (?:chars|bytes)\)$/m, `${what}: presence reads ${key}`);
  }
  // a binary key store is a credential by its kind: the view says so, never the bytes
  const p12 = path.join(dir, 'cert.p12');
  fs.writeFileSync(p12, Buffer.from([0x30, 0x82, 0x0a, 0x01, 0x02, 0x01, 0x03, 0x30, 0x82, 0x09, 0xc7]));
  assert.equal(bash(`cat ${p12}`), REWRITE, 'a PKCS#12 key store: the dump becomes the view');
  assert.equal(read(p12), 2, 'a PKCS#12 key store: the Read tool is blocked');
  assert.match(cli('--redacted', p12).stdout, /<binary key store, 11 bytes>/);
  assert.match(cli('--presence', p12).stdout, /^key store=set \(11 bytes\)$/m);
  // the redacted view keeps what is not a credential, as written
  assert.match(cli('--redacted', formats[6][1]).stdout, /^kind: Config$/m);
  assert.match(cli('--redacted', formats[14][1]).stdout, /<username>someone<\/username>/);
  assert.match(cli('--redacted', formats[25][1]).stdout, /^-----BEGIN OPENSSH PRIVATE KEY-----$/m);
  // what must stay allowed: the same formats holding no credential, labels, variable references, a public key
  const allowed = [
    ['a plain YAML', w('ok/app.yml', 'name: app\nversion: 1\nauth: true\n')],
    ['a workflow reading its token from secrets', w('ok/ci.yml', 'jobs:\n  build:\n    env:\n      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n      NPM_TOKEN: $NPM_TOKEN\n')],
    ['a pom.xml', w('ok/pom.xml', '<?xml version="1.0"?>\n<project>\n  <artifactId>app</artifactId>\n  <version>1.0</version>\n</project>\n')],
    ['an XML label', w('ok/strings.xml', '<resources>\n  <string name="password">Password</string>\n</resources>\n')],
    ['a terraform file with a variable', w('ok/main.tf', 'variable "db_password" {\n  type = string\n}\nresource "x" "y" {\n  password = var.db_password\n}\n')],
    ['a properties file with no credential', w('ok/app.properties', 'server.port=8080\nlogging.level.root=INFO\n')],
    ['an ssh config', w('ok/.ssh/config', 'Host example\n  HostName example.com\n  IdentityFile ~/.ssh/id_ed25519\n')],
    ['a public key', w('ok/id_ed25519.pub', `ssh-ed25519 ${B64} someone@host\n`)],
    ['a Makefile', w('ok/Makefile', 'build: deps\n\tnpm run build\n')],
    ['a bypass flag is no pass key', w('ok/flags.yml', 'bypass: enabled\ncompass: north\n')],
  ];
  for (const [what, f] of allowed) assert.equal(bash(`cat ${f}`), 0, `${what}: stays allowed`);
});

test('guard-secret-value: the credential files beyond the named formats, their views, and the diffs of them (2.1.6)', () => {
  // A credential keyed by its HOST (composer's auth.json), a publish profile's `userPWD`, a GnuPG private key, bundler's
  // host keys, redis's `requirepass`, a Kubernetes Secret among other documents, a PEM body spread over dotenv lines,
  // and the binary key stores: each is judged, and each view masks what it judged.
  const dir = fs.mkdtempSync(path.join(TMP, 'formats2-'));
  const w = (rel, text) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  const T = FAKE_TOKEN;
  const B64 = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQ';
  const judged = [
    ['composer auth.json, a token keyed by its host', w('composer/auth.json', JSON.stringify({ 'github-oauth': { 'github.com': T } })), 'github-oauth.github.com'],
    ['composer auth.json, a bearer token', w('composer2/auth.json', JSON.stringify({ bearer: { 'repo.example.org': T } })), 'bearer.repo.example.org'],
    ['a publish profile', w('site.publishsettings', `<publishData>\n  <publishProfile profileName="site" userName="$site" userPWD="${T}" />\n</publishData>\n`), 'publishData.publishProfile.userPWD'],
    ['a pubxml password', w('PublishProfiles/prod.pubxml', `<Project>\n  <PropertyGroup>\n    <UserName>deploy</UserName>\n    <Password>${T}</Password>\n  </PropertyGroup>\n</Project>\n`), 'Project.PropertyGroup.Password'],
    ['a key/value pair spread over lines', w('spread/app.config', `<configuration>\n  <appSettings>\n    <add\n      key="ApiKey"\n      value="${T}" />\n  </appSettings>\n</configuration>\n`), 'ApiKey'],
    ['a GnuPG private key', w('.gnupg/private-keys-v1.d/ABCD.key', `Created: 20260101T000000\nKey: (private-key (ecc (curve Ed25519)(flags eddsa)\n (q #40${B64}#)\n (d #${T}#)))\n`), 'private key'],
    ['bundler credentials', w('proj/.bundle/config', `---\nBUNDLE_PATH: "vendor/bundle"\nBUNDLE_GEMS__EXAMPLE__COM: "someone:${T}"\n`), 'BUNDLE_GEMS__EXAMPLE__COM'],
    ['redis requirepass', w('redis.conf', `port 6379\nrequirepass ${T}\n`), 'requirepass'],
    ['a Secret after a ConfigMap', w('k8s/all.yaml', `kind: ConfigMap\ndata:\n  mode: fast\n---\nkind: Secret\ndata:\n  api: ${T}\n`), 'data.api'],
    ['a PEM key across dotenv lines', w('pem/.env', `NAME=app\nAPP_KEY="-----BEGIN RSA PRIVATE KEY-----\n${B64}\n${T}\n-----END RSA PRIVATE KEY-----"\n`), 'APP_KEY'],
    ['an export line in a .conf', w('svc/agent.conf', `# the agent's environment\nexport API_TOKEN=${T}\n`), 'API_TOKEN'],
    ['a YAML list under a credential key', w('ci/tokens.yml', `tokens:\n  - ${T}\n`), 'tokens'],
    ['a YAML flow map', w('ci/db.yml', `db: {user: app, password: ${T}}\n`), 'db.password'],
  ];
  for (const [what, f, key] of judged) {
    assert.equal(bash(`cat ${f}`), REWRITE, `${what}: a shell dump becomes the redacted view`);
    assert.equal(read(f), 2, `${what}: the Read tool is blocked`);
    const view = cli('--redacted', f).stdout;
    assert.ok(!view.includes(T), `${what}: the view masks the value`);
    assert.match(view, /<set \(\d+ chars\)>|<private key line>/, `${what}: and says it was there`);
    assert.ok(!cli('--presence', f).stdout.includes(T), `${what}: the keyless presence listing prints no value`);
    assert.match(cli('--presence', f, key).stdout, /=set \(\d+ chars\)$/m, `${what}: presence reads ${key}`);
  }
  assert.match(cli('--redacted', judged[1][1]).stdout, /"repo\.example\.org": "<set \(40 chars\)>"/);
  assert.match(cli('--redacted', judged[6][1]).stdout, /^BUNDLE_PATH: "vendor\/bundle"$/m, 'a bundler setting that is no host stays');
  assert.match(cli('--redacted', judged[8][1]).stdout, /^ {2}mode: fast$/m, 'a ConfigMap value stays');
  for (const store of ['vault.kdbx', 'server.jks', 'client.keystore', '.mylogin.cnf']) {
    const f = path.join(dir, store);
    fs.writeFileSync(f, Buffer.from([0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]));
    assert.equal(bash(`cat ${f}`), REWRITE, `${store}: the dump becomes the view`);
    assert.match(cli('--redacted', f).stdout, /<binary key store, 8 bytes>/, `${store}: the view names the kind`);
    assert.match(cli('--presence', f).stdout, /^key store=set \(8 bytes\)$/m, `${store}: presence reads its size`);
  }
  // an empty key store holds nothing
  fs.writeFileSync(path.join(dir, 'empty.p12'), '');
  assert.equal(bash(`cat ${path.join(dir, 'empty.p12')}`), 0, 'an empty key store: allowed');
  // what must stay allowed
  const allowed = [
    ['a .NET publicKeyToken', w('ok/web.config', '<configuration>\n  <runtime>\n    <dependentAssembly>\n      <assemblyIdentity name="System.Web.Mvc" publicKeyToken="31bf3856ad364e35" culture="neutral" />\n    </dependentAssembly>\n  </runtime>\n</configuration>\n')],
    ['an OpenAPI security scheme', w('ok/openapi.yaml', 'components:\n  securitySchemes:\n    apiKey:\n      type: apiKey\n      name: X-API-Key\n      in: header\n')],
    ['workflow and template references', w('ok/refs.yml', 'env:\n  NPM_TOKEN: ${{secrets.NPM_TOKEN}}\n  DB_PASSWORD: "{{.Values.dbPassword}}"\n  API_KEY: "#{ApiKey}"\n  SIGNING_SECRET: $(SigningSecret)\n  STORE_PASSWORD: "@store.password@"\n')],
    ['a key file path', w('ok/.env', 'SSH_KEY=~/.ssh/id_ed25519\nTLS_KEY=/etc/ssl/private/site.key\n')],
    ['an nginx config', w('ok/nginx.conf', 'server {\n  listen 443 ssl;\n  ssl_certificate_key /etc/nginx/ssl/site.key;\n  auth_basic "Restricted";\n}\n')],
    ['a ConfigMap alone', w('ok/cm.yaml', 'kind: ConfigMap\ndata:\n  api: someid\n')],
    ['a doc naming a password', w('ok/setup.md', '# Setup\n\npassword: hunter2 is what the tutorial uses\n')],
    ['a certificate', w('ok/site.pem', `-----BEGIN CERTIFICATE-----\n${B64}\n-----END CERTIFICATE-----\n`)],
    ['a gitconfig with no credential', w('ok/.gitconfig', '[user]\n\tname = someone\n\tsigningkey = ABCDEF0123456789\n[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n')],
    ['a Procfile', w('ok/Procfile', 'web: node server.js\nworker: node worker.js\n')],
  ];
  for (const [what, f] of allowed) assert.equal(bash(`cat ${f}`), 0, `${what}: stays allowed`);
  // the stream masker a git dump is piped through reads the same formats
  const diff = [
    'diff --git a/.m2/settings.xml b/.m2/settings.xml', '+++ b/.m2/settings.xml', `+      <password>${T}</password>`, '+      <username>someone</username>',
    'diff --git a/NuGet.Config b/NuGet.Config', '+++ b/NuGet.Config', `+      <add key="ClearTextPassword" value="${T}" />`,
    'diff --git a/.pgpass b/.pgpass', '+++ b/.pgpass', `+localhost:5432:*:postgres:${T}`,
    'diff --git a/main.tf b/main.tf', '+++ b/main.tf', `+  token = "${T}"`, '+  password = var.db_password',
    'diff --git a/.kube/config b/.kube/config', '+++ b/.kube/config', `+    client-key-data: ${T}`,
    'diff --git a/deploy/key.ppk b/deploy/key.ppk', '+++ b/deploy/key.ppk', '+Private-Lines: 1', `+${T}`, `+Private-MAC: ${T}`,
    'diff --git a/.htpasswd b/.htpasswd', '+++ b/.htpasswd', `+someone:$apr1$abcdefgh$${T}`,
    'diff --git a/compose.yml b/compose.yml', '+++ b/compose.yml', `+      - POSTGRES_PASSWORD=${T}`,
  ].join('\n') + '\n';
  const masked = spawnSync(process.execPath, [HOOK, '--redact-stdin'], { input: diff, encoding: 'utf8' }).stdout;
  assert.ok(!masked.includes(T), `the stream masker masks every format: ${masked}`);
  assert.match(masked, /^\+ {6}<username>someone<\/username>$/m, 'and keeps the rest');
  assert.match(masked, /^\+ {2}password = var\.db_password$/m, 'an HCL expression is no value');
});

// Replay of 52,732 corpus commands: `git show v1.3.0:<the 1.x installer script> | sed -n ...` went pass -> rewrite,
// because a headerless stream read every line as HCL and an installer's `    SENTRY_AUTH="oauth"   # ...` (a mode
// word) took the HCL attribute shape. An HCL attribute is read in an HCL file only.
test('guard-secret-value: an HCL attribute is read in an HCL file only - a script line in a headerless git show is not (2.1.6)', { skip: process.platform === 'win32' && 'posix git fixture' }, () => {
  const T = 'Zq8v' + 'Lm3NpX7rT2wKcY9s';
  const redact = (input) => spawnSync(process.execPath, [HOOK, '--redact-stdin'], { input, encoding: 'utf8' }).stdout;
  const script = '#!/usr/bin/env bash\nif [ -z "$SENTRY_AUTH" ]; then\n    SENTRY_AUTH="oauth"   # a headerless registration stays headerless\nfi\n';
  assert.equal(redact(script), script, 'a headerless shell script is printed as written');
  const tf = `diff --git a/main.tf b/main.tf\n+++ b/main.tf\n+  token = "${T}"   # the registry token\n`;
  assert.ok(!redact(tf).includes(T), 'an attribute in a file the header names as HCL is still masked');
  const repo = fs.mkdtempSync(path.join(TMP, 'git-hcl-'));
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'install.sh'), script);
  git('add', '.');
  git('commit', '-qm', 'init');
  const at = (command) => verdict(run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite', cwd: repo }, { CLAUDE_PROJECT_DIR: repo }));
  assert.equal(at('git show HEAD:install.sh | sed -n 1,4p'), 0, 'the probe finds nothing to mask, so nothing is rewritten');
});

test('guard-secret-value: a glob and a path held in a shell variable resolve to the same file', () => {
  const f = fixtures();
  assert.equal(bash('cat .env*'), REWRITE, 'a glob with no directory');
  assert.equal(bash('cat .claude/*.json'), REWRITE, 'a glob in the last component');
  assert.equal(bash(`cat ${ROOT}/.claude/settings-*.json`), REWRITE, 'an absolute glob');
  assert.equal(bash(`cat ${ROOT}/.claude/settings-secret.js?n`), REWRITE, 'a single-character glob');
  assert.equal(bash(`cat ${ROOT}/.claude/{settings-secret,x}.json`), REWRITE, 'brace alternatives');
  assert.equal(bash(`f=${f.secret}; cat $f`), REWRITE, 'a variable set one segment earlier');
  assert.equal(bash(`f=${f.secret}; cat "$f"`), REWRITE, 'quoted');
  assert.equal(bash(`f=${f.secret}\ncat "$f"`), REWRITE, 'across a newline');
  assert.equal(bash('for f in .claude/*.json; do cat "$f"; done'), REWRITE, 'a loop variable');
  assert.equal(bash(`cat ${path.join(ROOT, '.claude', 'clean*.json')}`), 0, 'a glob matching only clean files');
});

test('guard-secret-value: brace expansion is bounded - a pathological pattern costs one capped pass, never the hook timeout', () => {
  fixtures();
  const t0 = Date.now();
  assert.equal(bash(`cat ${ROOT}/${'{a,b}'.repeat(26)}.json`), 0, 'no such file');
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `took ${ms}ms - the brace recursion is unbounded (measured 4.8s at 24 groups before the cap)`);
});

test('guard-secret-value: a 40,000-character pathological command is judged in linear work, and one past the work budget is blocked (review M3 of 2.1.6)', () => {
  // The review measured 8.7s at 1,400 nested parens, growing superlinearly. The budget counts the characters judging
  // reads, never time, so the same command gets the same verdict on any machine: each shape is judged at 20,000 and
  // 40,000 characters, and its count (`global.JUDGE_WORK`, printed by a preload at exit) must grow linearly.
  const home = fs.mkdtempSync(path.join(TMP, 'home-budget-'));
  fs.mkdirSync(path.join(home, '.aws'));
  fs.writeFileSync(path.join(home, '.aws', 'credentials'), `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const rep = (u, n) => u.repeat(Math.ceil(n / u.length));
  const CRED = 'require("path").join(require("os").homedir(),".aws","credentials")';
  const meter = path.join(TMP, 'judge-work.js');
  fs.writeFileSync(meter, "if (process.env.JUDGE_WORK_MAX) global.JUDGE_WORK_MAX = Number(process.env.JUDGE_WORK_MAX);\n" +
    "process.on('exit', () => { if (global.JUDGE_WORK) require('fs').writeSync(2, `\\nJUDGE_WORK ${global.JUDGE_WORK.used} ${global.JUDGE_WORK.max}\\n`); });\n");
  const once = (command, max = '') => {
    const t = process.hrtime.bigint();
    const r = spawnSync(process.execPath, ['-r', meter, HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'budget' }), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: '', JUDGE_WORK_MAX: String(max) } });
    const w = /JUDGE_WORK (\d+) (\d+)/.exec(r.stderr) || [];
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, verdict: verdict(r), stderr: r.stderr, work: Number(w[1]), max: Number(w[2]) };
  };
  // The first two are blocked at the depth cap, before the work count could climb.
  const shapes = [
    ['nested parens beside a credential read (the review\'s shape)', (n) => `node -e 'const _=${'('.repeat(n / 2)}0${')'.repeat(n / 2)};console.log(require("fs").readFileSync(${CRED},"utf8"))'`, 2],
    ['nested parens around the credential path', (n) => `node -e 'console.log(require("fs").readFileSync(${'('.repeat(n / 2)}${CRED}${')'.repeat(n / 2)},"utf8").length)'`, 2],
    ['nested parens within the cap, repeated', (n) => `node -e 'let n=0${rep('+' + '('.repeat(60) + '1' + ')'.repeat(60), n)};console.log(require("fs").readFileSync(${CRED},"utf8"))'`, REWRITE],
    ['spaces after a cd', (n) => `cd ~/.aws &&${rep(' ', n)}grep -n -e aws credentials | head -3`, REWRITE],
    ['spaces inside a path join', (n) => `node -e 'const p=require("path").join(require("os").homedir(),${rep(' ', n)}".aws","credentials");console.log(require("fs").readFileSync(p,"utf8"))'`, REWRITE],
    ['commas inside a python join', (n) => `python3 -c 'import os;p=os.path.join(os.path.expanduser("~")${rep(',"a"', n)});print(open(p).read())'`, 0],
    ['a long environment chain', (n) => `node -e 'console.log(${rep('process.env.A+', n)}1)'`, 0],
    ['many pipeline stages', (n) => rep('cat ~/.aws/credentials | wc -l; ', n), 0],
  ];
  let slowest = 0;
  for (const [what, shape, want] of shapes) {
    const half = once(shape(20000));
    const full = once(shape(40000));
    assert.equal(full.verdict, want, `verdict: ${what}`);
    assert.ok(full.work < full.max, `${what}: inside the budget (${full.work} of ${full.max})`);
    assert.ok(full.work <= 2.5 * half.work, `${what}: work grows linearly (${half.work} at 20,000 characters, ${full.work} at 40,000)`);
    slowest = Math.max(slowest, full.ms);
  }
  // One generous sanity bound on the wall clock, 100x the ~50ms a run measures: a shape whose work stays small while its
  // time does not is a judging step that charges nothing.
  assert.ok(slowest < 5000, `the slowest run took ${Math.round(slowest)}ms`);
  // At the real ceiling: ten times the largest shape above costs past JUDGE_MAX_WORK, and is blocked by it, in bounded time.
  const huge = once(shapes[5][1](400000));
  assert.equal(huge.verdict, 2, `a 400,000-character shape past the work budget is blocked (${huge.work} of ${huge.max})`);
  assert.match(huge.stderr, /budget/);
  assert.ok(huge.ms < 5000, `the blocked run took ${Math.round(huge.ms)}ms`);
  // Past the work budget: the same count on every run, and a ceiling under it blocks the command, never lets it through.
  const r = once('ls ~/.aws');
  assert.equal(r.verdict, 0, 'a listing passes');
  assert.ok(r.work > 1, `the listing is judged (${r.work})`);
  assert.equal(once('ls ~/.aws').work, r.work, 'the same command costs the same work on every run');
  const over = once('ls ~/.aws', r.work - 1);
  assert.equal(over.verdict, 2, 'a command whose judging passes the work budget is blocked, never let through');
  assert.match(over.stderr, /budget/);
});

test('guard-secret-value: a credential read past a long script, 2,000 groups, 20 substitutions or 20 shells is still judged (2.1.6)', () => {
  // Each count used to stop the reading silently, so the read past it ran unjudged; the work budget bounds the cost now.
  const home = fs.mkdtempSync(path.join(TMP, 'home-caps-'));
  fs.mkdirSync(path.join(home, '.aws'));
  fs.writeFileSync(path.join(home, '.aws', 'credentials'), `[default]\naws_secret_access_key = ${FAKE_TOKEN}\n`);
  const env = { HOME: home, USERPROFILE: '' };
  const CRED = 'require("path").join(require("os").homedir(),".aws","credentials")';
  const read = `console.log(require("fs").readFileSync(${CRED},"utf8"))`;
  assert.equal(bash(`node -e '${'let a=1;'.repeat(9000)}${read}'`, env), REWRITE, 'past 64KB of script');
  assert.equal(bash(`node -e '${'f(1);'.repeat(2100)}${read}'`, env), REWRITE, 'past 2,000 groups');
  assert.equal(bash(`echo ${'"$(date)" '.repeat(21)}"$(cat ~/.aws/credentials)"`, env), REWRITE, 'the 22nd substitution');
  assert.equal(bash(`${"bash -c 'true'; ".repeat(21)}bash -c 'cat ~/.aws/credentials'`, env), REWRITE, 'the 22nd shell string');
});

test('guard-secret-value: a redirect to a terminal device is a dump, not a write into a file', () => {
  const f = fixtures();
  assert.equal(bash(`cat ${f.secret} > /dev/stdout`), REWRITE, '/dev/stdout is the transcript');
  assert.equal(bash(`cat ${f.secret} > /dev/stderr`), REWRITE, '/dev/stderr too');
  assert.equal(bash(`cat ${f.secret} >/dev/tty`), REWRITE, '/dev/tty too');
  assert.equal(bash(`cat ${f.secret} | tee /dev/stderr | wc -l`), REWRITE, 'a tee stage prints before the reducer');
  assert.equal(bash(`cat ${f.secret} | tee /dev/stderr > /dev/null`), REWRITE, 'the same behind a /dev/null redirect');
  assert.equal(bash(`cat ${f.secret} > ${path.join(f.dir, 'out.txt')}`), 0, 'a real file never reaches the context');
  assert.equal(bash(`cat ${f.secret} 2>/dev/null`), REWRITE, 'a stderr redirect leaves stdout in the transcript (re-review regression)');
  assert.equal(bash(`cat ${f.secret} 2>${path.join(f.dir, 'err.log')}`), REWRITE, 'stderr into a file, the same');
  assert.equal(bash('printenv SENTRY_ACCESS_TOKEN 2>/dev/null'), REWRITE, 'a print verb behind a stderr redirect');
  assert.equal(bash(`cat ${f.secret} 1>${path.join(f.dir, 'out.txt')}`), 0, 'fd 1 into a file is a write');
});

test('guard-secret-value: an exemption counts in its own stage only, never in a comment or an argument', () => {
  const f = fixtures();
  assert.equal(bash(`cat ${f.secret} # wc`), REWRITE, 'a reducer named in a comment');
  assert.equal(bash(`cat ${f.secret} # via guard-secret-value.js --presence`), REWRITE, 'the accessor named in a comment');
  assert.equal(bash(`cat ${f.secret} | grep -v wc`), REWRITE, 'a reducer named in an argument');
  assert.equal(bash(`node "${HOOK}" --presence ${f.secret} | cat ${f.secret}`), REWRITE, 'a dump piped after the accessor');
  assert.equal(bash(`cat ${f.secret} | wc -l`), 0, 'the reducer itself');
  assert.equal(bash(`cat ${f.secret} | jq '.env | keys'`), 0, 'keys only');
  assert.equal(bash(`grep -c TOKEN ${f.secret}`), 0, 'a count');
});

test('guard-secret-value: only a reduction to names or a count is presence', () => {
  const f = fixtures();
  assert.equal(bash('env | cut -d= -f2'), REWRITE, 'field 2 is the value');
  assert.equal(bash('env | cut -d= -f1-'), REWRITE, 'f1- is every field');
  assert.equal(bash("env | awk -F= '{print $2}'"), REWRITE, 'awk field 2');
  assert.equal(bash(`jq 'keys, .' ${f.secret}`), REWRITE, 'a comma prints the document beside the keys');
  assert.equal(bash(`jq '.env | length, .' ${f.secret}`), REWRITE, 'the same behind a length');
  assert.equal(bash('echo $(printenv SENTRY_ACCESS_TOKEN)'), REWRITE, 'the second print verb in the stage');
  assert.equal(bash('echo "$(printenv SENTRY_ACCESS_TOKEN)"'), REWRITE, 'quoted substitution');
  assert.equal(bash('env | cut -d= -f1 | sort'), 0, 'names only');
  assert.equal(bash("env | awk -F= '{print $1}'"), 0, 'awk field 1');
  assert.equal(bash(`jq -r 'keys[]' ${f.secret}`), 0, 'keys[] is names, one per line');
  assert.equal(bash(`jq -r '.env | keys[]' ${f.secret}`), 0, 'the same behind a path');
});

test('guard-secret-value: the dump verbs outside the cat/head list print the same bytes', () => {
  const f = fixtures();
  assert.equal(bash(`tac ${f.secret}`), REWRITE, 'tac');
  assert.equal(bash(`nl ${f.secret}`), REWRITE, 'nl');
  assert.equal(bash(`base64 ${f.secret}`), REWRITE, 'base64 is a reversible print');
  assert.equal(bash(`xxd ${f.secret}`), REWRITE, 'xxd');
  assert.equal(bash(`tee /dev/stdout < ${f.secret}`), REWRITE, 'tee reading a redirect');
  assert.equal(bash(`while read l; do echo "$l"; done < ${f.secret}`), REWRITE, 'a read loop over the file');
  assert.equal(bash(`cp ${f.secret} ${path.join(f.dir, 'settings.bak')}`), 0, 'a backup is not a dump');
});

test("guard-secret-value: a block ends in an ask, and the user's allow is honoured through a session receipt", () => {
  // Remote use: the user cannot run the copy-ready command in their own terminal, so a bare denial
  // took the decision away from them. The denial now mandates ONE AskUserQuestion, and the 'show or
  // use' answer is a receipt this guard reads - a file, a variable NAME or `*`, this session only.
  const f = fixtures();
  const receipt = path.join(LEDGER, 'flow', 'SECRET-READ-ALLOW');
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  try {
    const denied = run({ tool_name: 'Read', tool_input: { file_path: f.secret }, session_id: 'suite' });
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /ONE AskUserQuestion/, 'the denial mandates the ask');
    assert.match(denied.stderr, /Presence only \(Recommended\)/, 'presence is the recommended option');
    assert.match(denied.stderr, /flow[\\/]SECRET-READ-ALLOW/, 'the denial names the receipt');
    assert.doesNotMatch(denied.stderr, /stale/, 'no receipt, no staleness talk');
    assert.match(cli('--redacted', f.secret).stdout, /ONE AskUserQuestion/, 'the redacted view carries the ask too');
    assert.match(rewritten('echo $SENTRY_ACCESS_TOKEN'), /AskUserQuestion/, 'and so does the variable rewrite');
    // a file entry opens that file - by any dump verb and by Read - and nothing else
    fs.writeFileSync(receipt, `# allowed by the user in this session\n${f.secret}\n`);
    assert.equal(bash(`cat ${f.secret}`), 0, 'the listed file');
    assert.equal(bash(`jq -r .env.SENTRY_ACCESS_TOKEN ${f.secret}`), 0, 'any dump verb');
    assert.equal(read(f.secret), 0, 'and the Read tool');
    assert.equal(bash(`cat ${f.dotenv}`), REWRITE, 'an unlisted file stays blocked');
    assert.equal(bash('echo $SENTRY_ACCESS_TOKEN'), REWRITE, 'a file entry is not a variable');
    // a NAME entry opens that variable's print
    fs.writeFileSync(receipt, 'SENTRY_ACCESS_TOKEN\n');
    assert.equal(bash('echo $SENTRY_ACCESS_TOKEN'), 0, 'the listed variable');
    assert.equal(bash('echo $API_KEY'), REWRITE, 'another variable stays blocked');
    assert.equal(bash('env'), REWRITE, 'a whole-environment dump is not one variable');
    // `*` opens everything for the session - the remote user's 'just do the work'
    fs.writeFileSync(receipt, '*\n');
    assert.equal(bash(`cat ${f.dotenv}`), 0, 'any file');
    assert.equal(bash('env'), 0, 'the environment');
    assert.equal(bash(`echo 'TOKEN=${'ghp_' + 'A'.repeat(24)}' >> ${path.join(f.dir, '.env')}`), 0, 'a literal placed into a file');
    // stale: older than 8h reads as absent, and the denial says so
    const old = (Date.now() - 9 * 3600 * 1000) / 1000; fs.utimesSync(receipt, old, old);
    const aged = run({ tool_name: 'Read', tool_input: { file_path: f.secret }, session_id: 'suite' });
    assert.equal(aged.status, 2, 'a 9h-old receipt is absent');
    assert.match(aged.stderr, /stale/, 'and the denial says so');
    assert.match(cli('--redacted', f.secret).stdout, /stale/, 'the redacted view says so too');
  } finally {
    fs.rmSync(receipt, { force: true });
  }
});

// The PowerShell route. This guard matched `Bash` alone until 2026-09-12; a hook audit measured 122
// PowerShell tool calls in a 115-session corpus, carrying `tool_input.command` exactly as Bash does.
// The three shell verdicts are pinned again under the second tool name: the shape is the same, so a
// widened matcher that changed no verdict would be the bug.
test('guard-secret-value: the PowerShell tool is the same shell route', () => {
  const f = fixtures();
  const pwsh = (command, env) => verdict(run({ tool_name: 'PowerShell', tool_input: { command }, session_id: 'suite' }, env));
  const pwshOut = (command, env) => updatedCommand(run({ tool_name: 'PowerShell', tool_input: { command }, session_id: 'suite' }, env));
  assert.equal(pwsh(`cat ${f.secret}`), REWRITE, 'a dump of a credential-bearing file is redacted, not blocked');
  const out = pwshOut(`cat ${f.secret}`);
  assert.ok(out && out.includes('--redacted'), 'the rewrite routes through the redacted view');
  assert.ok(!String(out).includes(FAKE_TOKEN), 'the value never appears in the rewritten command');
  assert.equal(pwsh('echo $SENTRY_ACCESS_TOKEN'), REWRITE, 'an echo of a credential variable becomes its presence line');
  assert.equal(pwsh(`cat ${f.clean}`), 0, 'a file with no credential passes untouched');
  assert.equal(pwsh(`curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`), 2, 'a credential-shaped literal in the command is blocked');
});

// Measured 2026-09-15 on a temp project: the PowerShell route knew only Bash spelling, so
// `Get-Content .env`, `echo $env:MY_TOKEN` and `Get-ChildItem env:` printed raw values in real pwsh,
// and the presence rewrite of `echo $MY_TOKEN` was Bash syntax pwsh rejects with a ParserError.
test('guard-secret-value: PowerShell spelling - its read cmdlets, $env:NAME and env: drive listings', () => {
  const f = fixtures();
  const ps = (command) => run({ tool_name: 'PowerShell', tool_input: { command }, session_id: 'suite' });
  for (const cmd of [`Get-Content ${f.dotenv}`, `gc ${f.dotenv}`, `type ${f.dotenv}`, `get-content -Path ${f.dotenv} -Raw`,
    `Select-String -Path ${f.dotenv} -Pattern API`, `Get-Content ${f.dotenv} | Select-String API`]) {
    const out = updatedCommand(ps(cmd));
    assert.ok(out && out.includes('--redacted'), `${cmd}: rewritten to the redacted view`);
  }
  for (const cmd of ['echo $env:SENTRY_ACCESS_TOKEN', 'Write-Output $env:SENTRY_ACCESS_TOKEN', 'Write-Host "t=$env:SENTRY_ACCESS_TOKEN"',
    '$env:SENTRY_ACCESS_TOKEN', '"$env:SENTRY_ACCESS_TOKEN"', '${env:SENTRY_ACCESS_TOKEN}', "[Environment]::GetEnvironmentVariable('SENTRY_ACCESS_TOKEN')",
    'Get-Item env:SENTRY_ACCESS_TOKEN', '(Get-Item Env:SENTRY_ACCESS_TOKEN).Value', 'echo $SENTRY_ACCESS_TOKEN']) {
    const out = updatedCommand(ps(cmd));
    assert.ok(out && out.includes('SENTRY_ACCESS_TOKEN=absent') && !out.includes('[ -n'), `${cmd}: the PowerShell presence line`);
  }
  for (const cmd of ['Get-ChildItem env:', 'gci Env:\\', 'dir env:', 'ls env:', 'Get-ChildItem env:*TOKEN*', '[Environment]::GetEnvironmentVariables()']) {
    assert.ok(String(updatedCommand(ps(cmd))).includes('--redacted-env'), `${cmd}: the masked environment listing`);
  }
  for (const cmd of [`Get-Content ${f.clean}`, 'echo $env:PATH', '$env:PATH', 'if ($env:SENTRY_ACCESS_TOKEN) { "set" }', '$env:SENTRY_ACCESS_TOKEN.Length',
    'curl.exe -H "Authorization: $env:SENTRY_ACCESS_TOKEN" https://example.test', 'Get-ChildItem src', 'Get-Item package.json']) {
    assert.equal(verdict(ps(cmd)), 0, `${cmd}: not a print of a credential`);
  }
  assert.equal(verdict(ps(`Get-Content ${f.dotenv}; Set-Content out.txt 'x'`)), 2, 'a dropped changing step blocks, as on Bash');
  assert.equal(verdict(run({ tool_name: 'Bash', tool_input: { command: 'ls env:' }, session_id: 'suite' })), 0, 'the env: drive is PowerShell only');
  // updatedInput REPLACES the tool input (code.claude.com/docs/en/hooks), so the rewrite keeps the rest of it.
  const kept = JSON.parse(ps(`Get-Content ${f.dotenv}`, {}).stdout || '{}');
  const keptFull = JSON.parse(run({ tool_name: 'PowerShell', tool_input: { command: `gc ${f.dotenv}`, timeout: 5000, description: 'd' }, session_id: 'suite' }).stdout);
  assert.ok(kept.hookSpecificOutput, 'rewritten');
  assert.equal(keptFull.hookSpecificOutput.updatedInput.timeout, 5000, 'timeout survives the rewrite');
  assert.equal(keptFull.hookSpecificOutput.updatedInput.description, 'd', 'description survives the rewrite');
});

// The rewrites must RUN in real pwsh and print presence, never the value.
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
test('guard-secret-value: the PowerShell rewrites run in pwsh and print no value', { skip: !hasPwsh && 'pwsh not installed' }, () => {
  const f = fixtures();
  const pwshRun = (command, env) => spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', cwd: f.dir, env: { ...process.env, ...env } });
  const rewritten = (command) => updatedCommand(run({ tool_name: 'PowerShell', tool_input: { command }, session_id: 'suite' }));
  for (const cmd of ['echo $env:SENTRY_ACCESS_TOKEN', 'echo $SENTRY_ACCESS_TOKEN', "[Environment]::GetEnvironmentVariable('SENTRY_ACCESS_TOKEN')"]) {
    const set = pwshRun(rewritten(cmd), { SENTRY_ACCESS_TOKEN: FAKE_TOKEN });
    assert.equal(set.status, 0, `${cmd}: runs (${set.stderr})`);
    assert.match(set.stdout, /SENTRY_ACCESS_TOKEN=set \(40 chars\)/, `${cmd}: presence when set`);
    assert.ok(!set.stdout.includes(FAKE_TOKEN), `${cmd}: the value never prints`);
    const env = { ...process.env }; delete env.SENTRY_ACCESS_TOKEN;
    const unset = spawnSync('pwsh', ['-NoProfile', '-Command', rewritten(cmd)], { encoding: 'utf8', cwd: f.dir, env });
    assert.match(unset.stdout, /SENTRY_ACCESS_TOKEN=absent/, `${cmd}: absent when unset`);
  }
  const view = pwshRun(rewritten(`Get-Content ${f.dotenv}`));
  assert.equal(view.status, 0, `the file view runs (${view.stderr})`);
  assert.ok(view.stdout.includes('DB_HOST=localhost') && !view.stdout.includes('abc123'), 'the file view masks the value');
  const listing = pwshRun(rewritten('Get-ChildItem env:'), { SENTRY_ACCESS_TOKEN: FAKE_TOKEN });
  assert.equal(listing.status, 0, `the env listing runs (${listing.stderr})`);
  assert.ok(!listing.stdout.includes(FAKE_TOKEN), 'the env listing masks the value');
});

// Measured in an audited session (a .NET appsettings.Staging.json): the redacted view's header said 'A value
// never enters the chat' while the view printed the Postgres and Redis passwords (inside their connection
// strings - the KEY names the connection, not the credential) and the Firebase PEM private key (its line breaks
// read as a label's whitespace).
test('guard-secret-value: a password inside a connection string or URL, and a PEM private key, are credentials too', () => {
  const f = fixtures();
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvFAKEfakeFAKE\n-----END PRIVATE KEY-----\n';
  const pg = 'FakePgPass123';
  const redis = 'FakeRedisPass456';
  const app = path.join(f.dir, 'appsettings.Staging.json');
  fs.writeFileSync(app, JSON.stringify({
    ConnectionStrings: { Postgres: `Host=db.test;Database=app;Username=app;Password=${pg}`, Redis: `cache.test:6379,password=${redis},ssl=True` },
    Firebase: { PrivateKey: pem },
    SuperAdmin: { Email: 'admin@example.test' },
  }, null, 2));
  const view = cli('--redacted', app).stdout;
  for (const v of [pg, redis, 'MIIEvFAKEfakeFAKE']) assert.ok(!view.includes(v), `${v} never appears in the view`);
  assert.match(view, new RegExp(`Host=db\\.test;Database=app;Username=app;Password=<set \\(${pg.length} chars\\)>`), 'the rest of the connection string stays readable');
  assert.match(view, new RegExp(`cache\\.test:6379,password=<set \\(${redis.length} chars\\)>,ssl=True`), 'the Redis comma form');
  assert.match(view, new RegExp(`"PrivateKey": "<set \\(${pem.length} chars\\)>"`), 'the PEM key is one masked value');
  assert.match(view, /"Email": "admin@example\.test"/, 'a plain value stays');
  const only = (name, obj) => { const p = path.join(f.dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  assert.equal(read(only('conn.json', { ConnectionStrings: { Default: 'Server=x;User Id=sa;Password=FakePw999' } })), 2, 'a connection-string password alone makes a credential file');
  assert.equal(read(only('url.json', { Database: { Url: 'postgres://app:FakeUrlPw777@db.test:5432/app' } })), 2, 'a URL userinfo password');
  assert.equal(read(only('pem.json', { service: { cert: pem } })), 2, 'a PEM private key under any key');
  assert.equal(read(only('noconn.json', { ConnectionStrings: { Default: 'Server=x;Database=y;Trusted_Connection=True' }, Api: { Url: 'https://api.test:8443/v1@x' } })), 0, 'no password, no credential');
  assert.equal(read(only('placeholder.json', { ConnectionStrings: { Default: 'Server=x;Password=${DB_PASSWORD}' }, Url: 'postgres://app:${PG_PW}@db/app' })), 0, 'a placeholder password is not live');
  assert.equal(read(only('pubkey.json', { key: '-----BEGIN PUBLIC KEY-----\nMIIBfake\n-----END PUBLIC KEY-----' })), 0, 'a PUBLIC key is not a credential');
  const envPw = 'FakeEnvPw555';
  const dotenv = path.join(f.dir, 'url.env');
  fs.writeFileSync(dotenv, `DATABASE_URL=postgres://app:${envPw}@db.test/app\nPWD=/home/app\n`);
  assert.equal(bash(`cat ${dotenv}`), REWRITE, 'a dotenv URL password');
  const envView = cli('--redacted', dotenv).stdout;
  assert.match(envView, new RegExp(`^DATABASE_URL=postgres://app:<set \\(${envPw.length} chars\\)>@db\\.test/app$`, 'm'));
  assert.match(envView, /^PWD=\/home\/app$/m, 'a PWD path is not a password');
  const listing = spawnSync(process.execPath, [HOOK, '--redacted-env'], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: `postgres://app:${envPw}@db.test/app` } }).stdout;
  assert.ok(!listing.includes(envPw), 'the environment listing masks it too');
});

// Measured in the same session: `N=$(grep -c ...) && sed -i ... "$F" && jq -r .SuperAdmin.Email "$F"` came back
// as the redacted view of the file. The edit never ran and nothing said so; the user found the old value in the
// config 37 minutes later.
test('guard-secret-value: a command that also CHANGES something is blocked, never silently cut down to the redacted view', () => {
  const f = fixtures();
  const r = run({ tool_name: 'Bash', tool_input: { command: `F=${f.secret}\nN=$(grep -c SENTRY_SLUG "$F"); echo "matches=$N"\n[ "$N" = 1 ] && sed -i '' 's/acme/acme2/' "$F" && jq -r '.env.SENTRY_SLUG' "$F"` }, session_id: 'suite' });
  assert.equal(r.status, 2, 'blocked, visibly');
  assert.match(r.stderr, /nothing ran/i, 'the denial says the command did not run');
  assert.match(r.stderr, /sed -i/, 'and names the step the rewrite would have dropped');
  assert.doesNotMatch(r.stderr, new RegExp(FAKE_TOKEN));
  assert.equal(bash(`cat ${f.secret} && npm run build`), 2, 'a build after the dump');
  assert.equal(bash(`jq .env ${f.secret} | tee ${path.join(f.dir, 'copy.json')}`), 2, 'a tee into a file writes as it prints');
  assert.equal(bash(`echo $SENTRY_ACCESS_TOKEN && rm -rf ${path.join(f.dir, 'gone')}`), 2, 'the variable rewrite would drop steps the same way');
  assert.equal(rewritten('env && curl https://example.test'), `node "${HOOK}" --redacted-env && curl https://example.test`,
    '... but an environment dump is replaced in place, so no step is dropped and nothing needs blocking');
  assert.equal(bash(`cd ${f.dir} && ls && cat settings.json | head -5; echo "exit=$?"`), REWRITE, 'cd, ls, echo and a pipe change nothing - still the rewrite');
  assert.equal(bash(`[ -f ${f.secret} ] && cat ${f.secret} 2>/dev/null`), REWRITE, 'a test and a stderr redirect change nothing');
  assert.equal(bash(`sed -i '' 's/acme/acme2/' ${f.secret}`), 0, 'the edit on its own passes, as before');
});

// Measured in the same session: a one-key `grep -n -i '"email"' appsettings.Staging.json` came back as the whole
// redacted file (~1.3k tok), three times, each carried to the end of the session.
test('guard-secret-value: a narrow read of a credential file keeps its own filter over the redacted view', () => {
  const f = fixtures();
  const view = (file) => `node "${HOOK}" --redacted "${file}"`;
  assert.equal(rewritten(`grep -n SENTRY_SLUG ${f.secret}`), `${view(f.secret)} --note-to-stderr | grep -n SENTRY_SLUG`);
  assert.equal(rewritten(`jq -r '.env.SENTRY_SLUG' "${f.secret}"`), `${view(f.secret)} --note-to-stderr | jq -r '.env.SENTRY_SLUG'`, 'a quoted file operand');
  assert.equal(rewritten(`head -3 ${f.secret} | tail -1`), `${view(f.secret)} --note-to-stderr | head -3 | tail -1`, 'the rest of the pipeline is kept');
  assert.equal(rewritten(`cat ${f.secret}`), view(f.secret), 'a whole-file dump is still the whole view');
  assert.equal(rewritten(`grep SENTRY ${f.secret} ${f.dotenv}`), view(f.secret), 'two files: the view of the first, as before');
  const pw = updatedCommand(run({ tool_name: 'PowerShell', tool_input: { command: `grep -n SENTRY_SLUG ${f.secret}` }, session_id: 'suite' }));
  assert.equal(pw, `node '${HOOK}' --redacted '${f.secret}'`, 'the PowerShell tool keeps the whole view, PowerShell-quoted');
  // run for real: the note goes to stderr, the filter sees only the masked file
  const g = spawnSync('bash', ['-c', rewritten(`grep -n SENTRY ${f.secret}`)], { encoding: 'utf8' });
  assert.match(g.stdout, /"SENTRY_SLUG": "acme"/);
  assert.match(g.stdout, /"SENTRY_ACCESS_TOKEN": "<set \(40 chars\)>"/);
  assert.ok(!(g.stdout + g.stderr).includes(FAKE_TOKEN), 'the value never appears');
  assert.match(g.stderr, /^# credential guard: redacted view of .*line numbers count the view/, 'the note says what happened');
});

// --- family E of the 154-bundle audit: two replayed false positives and one ungated tool input ---

test('guard-secret-value: a credential-shaped literal in a Grep pattern is the leak the shell route already blocks', () => {
  // The Bash route blocks the literal; the Grep tool took the same string in `pattern` and nothing
  // judged it, so the value the shell refused was free through the search tool.
  const f = fixtures();
  const g = (tool_input) => run({ tool_name: 'Grep', tool_input, session_id: 'suite' });
  const blocked = g({ pattern: FAKE_JWT, path: f.dir, output_mode: 'files_with_matches' });
  assert.equal(blocked.status, 2, 'judged in every output mode - the pattern is in the transcript before any match is');
  assert.doesNotMatch(blocked.stderr, new RegExp(FAKE_JWT), 'and the denial never repeats the value');
  assert.equal(g({ pattern: 'SENTRY_ACCESS_TOKEN', path: f.clean, output_mode: 'content' }).status, 0, 'the KEY NAME is a free search');
  assert.equal(g({ pattern: 'Bearer ', path: f.code, output_mode: 'content' }).status, 0, 'and so is an ordinary pattern');
  assert.equal(bash(`grep -rn "${FAKE_JWT}" .`), 2, 'the shell route still blocks the same literal');
});

test('guard-secret-value: a compound read-only command keeps its other reads - only the credential segment becomes the view', () => {
  // Replayed: a 4-part read-only command (a source read, two greps and a value-safe grep of KEY
  // NAMES across three appsettings files) came back as ONE `--redacted appsettings.json`, and the
  // three recovery calls cost ~124k at that session's own context per message.
  const f = fixtures();
  const view = `node "${HOOK}" --redacted "${f.secret}"`;
  assert.equal(rewritten(`grep -n TODO ${f.code}; cat ${f.secret}; ls ${f.dir}`),
    `grep -n TODO ${f.code}; ${view}; ls ${f.dir}`, 'the other read-only segments run as written');
  assert.equal(rewritten(`cat ${f.secret} && echo done`), `${view} && echo done`, 'the separator is kept as it was');
  assert.equal(rewritten(`cat ${f.secret}`), view, 'a one-segment command is the view alone, as before');
  // A segment this guard cannot judge is never left running: the whole command is replaced, and the
  // note NAMES what was dropped - the silence is what cost the recovery calls.
  // The dropped step is spelled relative to the project anchor: the note clips each step at 160 chars (the
  // product's cap, kept), so an absolute path under a long TMPDIR lost its `.env` there (final review R11).
  const two = rewritten(`cat ${f.secret}; cat ${path.relative(ROOT, f.dotenv)}`);
  assert.match(two, /^echo "# credential guard: 1 other step\(s\) of this command were dropped/, 'the note leads the rewrite');
  assert.match(two, /cat [^"]*\.env/, 'and names the dropped step');
  assert.ok(two.endsWith(view), 'the view still ends it');
  assert.match(rewritten(`cat ${f.secret}; cat "$SOME_UNSET_DIR/settings.json"`), /^echo "# credential guard: /,
    'an unresolvable path in another segment is never kept running either');
  // a heredoc in the same command cannot be spliced (the judged text has its body blanked), so the
  // whole-command rewrite stands - and says which steps went with it
  const withDoc = rewritten(`cat <<'EOF'\nplan\nEOF\ncat ${f.secret}`);
  assert.match(withDoc, /^echo "# credential guard: \d+ other step\(s\)/, 'the unspliceable shape names its drops');
  assert.match(withDoc, /cat <<'EOF'/, 'including the heredoc step that did not run');
  // 2.1.6 K1: the heredoc's own first line is shell (shell-writes.js's blanker keeps it), so a heredoc WRITTEN to a
  // file is a changing step like any redirect - blocked, where the whole-line blank let the rewrite drop the write
  assert.equal(bash(`cat <<'EOF' > ${path.relative(ROOT, path.join(f.dir, 'notes.md'))}\nplan\nEOF\ncat ${f.secret}`), 2,
    'a heredoc write beside the read blocks rather than silently never running');
  assert.equal(bash(`cat ${f.secret} && npm run build`), 2, 'a CHANGING step still blocks the whole command, as before');
});

test('guard-secret-value: a translation bundle holds labels, not credentials', () => {
  // Measured: an i18n JSON came back as a 52.5KB 'redacted view ... 4 credential value(s)', and at
  // replay `cat` and `grep` on one were still rewritten. The whitespace tell cannot see a ONE-WORD
  // translation of 'Password', and the key is named `password` because that is the UI string.
  const dir = fs.mkdtempSync(path.join(TMP, 'i18n-'));
  fs.mkdirSync(path.join(dir, 'i18n'), { recursive: true });
  const bundle = path.join(dir, 'i18n', 'uk.json');
  fs.writeFileSync(bundle, JSON.stringify({ login: { password: 'Пароль', token: 'Токен', secret: 'Secret question' } }, null, 2));
  assert.equal(bash(`cat ${bundle}`), 0, 'a translation file is read as written');
  const plain = path.join(dir, 'labels.json');
  fs.writeFileSync(plain, JSON.stringify({ password: 'Пароль' }, null, 2));
  assert.equal(bash(`cat ${plain}`), 0, 'a non-ASCII label is a label wherever it sits - a machine credential is ASCII');
  // ... and a real credential is still a credential, in the same tree and outside it
  const real = path.join(dir, 'i18n', 'en.json');
  fs.writeFileSync(real, JSON.stringify({ login: { password: 'Password' }, dsn: `sntryu_${'0123456789abcdef'.repeat(2)}` }, null, 2));
  assert.equal(bash(`cat ${real}`), REWRITE, 'a known credential SHAPE wins, i18n path or not');
  const conn = path.join(dir, 'i18n', 'db.json');
  fs.writeFileSync(conn, JSON.stringify({ Postgres: 'postgres://app:FakePw123@db.test/app' }, null, 2));
  assert.equal(bash(`cat ${conn}`), REWRITE, 'and so does a password embedded in a connection string');
  const live = path.join(dir, 'settings.json');
  fs.writeFileSync(live, SECRET_JSON);
  assert.equal(bash(`cat ${live}`), REWRITE, 'an ordinary credential file is untouched by these tells');
});

// The benchmark pilot (2026-09-26): `env | grep -i msbuild; env | grep -i dotnet_cli` was BLOCKED as 'prints the
// whole environment AND runs a step that changes something' - the second `env` read as a changing step, and the
// rewrite would have dropped both filters anyway. An environment dump is now replaced where it stands: its
// pipeline keeps its filter over the masked listing, and every other step runs as written.
test('guard-secret-value: an environment dump keeps its filter and the rest of the command - the pilot command', () => {
  const view = `node "${HOOK}" --redacted-env`;
  assert.equal(rewritten('env | grep -i msbuild'), `${view} --note-to-stderr | grep -i msbuild`, 'the filter runs over the masked listing');
  assert.equal(rewritten('env | grep -i msbuild; env | grep -i dotnet_cli'),
    `${view} --note-to-stderr | grep -i msbuild; ${view} --note-to-stderr | grep -i dotnet_cli`, 'every dump in the command, never one left raw');
  assert.equal(rewritten('cd src && printenv | sort | grep -i MSBUILD && dotnet build -v q'),
    `cd src && ${view} --note-to-stderr | sort | grep -i MSBUILD && dotnet build -v q`, 'nothing is dropped, so a build beside it runs');
  assert.equal(rewritten('env'), view, 'a bare dump is still the whole listing, note first');
  assert.equal(rewritten('env FOO=bar node app.js'), null, 'env running a command is no dump');
  assert.equal(bash('env > /tmp/env.txt'), 0, 'into a file it never reaches the context, as before');
  // still judged: a credential variable printed in another step takes its presence form over everything
  assert.match(rewritten('env | grep -i x; echo $SENTRY_ACCESS_TOKEN'), /SENTRY_ACCESS_TOKEN=set/);
  // run for real: the listing is masked before the filter sees it, the note goes to stderr
  const r = spawnSync('bash', ['-c', rewritten('env | grep -i msbuild')], { encoding: 'utf8', env: { ...process.env, MSBUILD_TOKEN: FAKE_TOKEN, MSBUILDDISABLENODEREUSE: '1' } });
  assert.match(r.stdout, /^MSBUILDDISABLENODEREUSE=1$/m);
  assert.match(r.stdout, /^MSBUILD_TOKEN=<set \(40 chars\)>$/m);
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_TOKEN), 'the value never appears');
  assert.match(r.stderr, /^# credential guard: /, 'the note says what happened');
});

// Review (2026-09-26): a lone `&` backgrounds its left side and runs the right one - a step boundary the
// segment split did not know. `env | grep A & env` came back with the trailing bare `env` left raw after the
// in-place rewrite, and `true & env` / `env & env` were never judged at all (a gap older than this change).
test('guard-secret-value: a step after a background & is its own step - no environment dump is left raw', () => {
  const view = `node "${HOOK}" --redacted-env`;
  for (const cmd of ['env | grep A & env', 'true & env', 'env & env', 'true & printenv', 'sleep 1 & set']) {
    const out = rewritten(cmd);
    assert.ok(out, `${cmd}: rewritten`);
    assert.doesNotMatch(out.replace(/node "[^"]*" --redacted-env( --note-to-stderr)?/g, ''), /(^|[&|;]\s*)(env|printenv|set)\s*($|[&|;])/, `${cmd}: no raw dump left in ${out}`);
  }
  assert.equal(rewritten('true & env'), `true & ${view}`);
  // `&` inside redirections and `&&` are not the background operator
  assert.equal(bash('ls 2>&1 | head -3'), 0);
  assert.equal(bash('ls &> /dev/null && echo ok'), 0);
  assert.equal(rewritten('env 2>&1 | grep -i msbuild'), `${view} --note-to-stderr 2>&1 | grep -i msbuild`);
  // run for real: nothing prints the fake credential
  const r = spawnSync('bash', ['-c', rewritten('true & env | grep -i MSBUILD_TOKEN; wait')], { encoding: 'utf8', env: { ...process.env, MSBUILD_TOKEN: FAKE_TOKEN } });
  assert.ok(!(r.stdout + r.stderr).includes(FAKE_TOKEN), 'the value never appears');
});

// Pilot 2 (2026-09-27): init's own source-protocol snippet was blocked twice - it printed `key=${KEY:-?}`, a
// credential-SHAPED name. The name rule is what catches a credential a `$(...)` COMPUTES (`gh auth token`, a keychain
// or vault read, `env | grep`), so the guard stays as it was and the snippet names its variable MKT instead (review A,
// C1: an exemption for self-assigned variables printed those in full). The printed label stays `key=`.
function protocolSnippet() {
  const md = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'references', 'source-protocol.md'), 'utf8');
  return [...md.matchAll(/```bash\n([\s\S]*?)```/g)][0][1];
}
test('guard-secret-value: the source-protocol snippet assigns no credential-shaped name, so it passes as written', () => {
  const snippet = protocolSnippet();
  const shaped = new RegExp(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'meta', 'environment.json'), 'utf8')).secret_key_pattern);
  const assigned = [...snippet.matchAll(/(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=/g)].map((m) => m[1]);
  assert.deepStrictEqual(assigned.filter((n) => shaped.test(n)), [], 'no variable the snippet assigns matches secret_key_pattern');
  assert.match(snippet, / key=\$\{MKT:-\?\}/, 'the key= label stays, printed from MKT');
  assert.equal(bash(snippet), 0, 'the shipped snippet');
  // Through the dispatcher, the way the session runs every shell guard.
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'stack', 'hooks', 'shell-guards.js')],
    { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: snippet }, session_id: 'suite' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /credential-shaped variable/);
});

test('guard-secret-value: a credential a command substitution computes is judged by its name, whoever assigned it', () => {
  // Review A, C1: every one of these ran as typed under the reverted exemption. Base verdicts, pinned.
  const cases = [
    ['TOKEN=$(gh auth token); echo "token=$TOKEN"', 2],
    ['GITHUB_TOKEN=$(gh auth token); printf \'%s\\n\' "$GITHUB_TOKEN"', 2],
    ['API_KEY=$(security find-generic-password -s x -w); echo $API_KEY', 2],
    ['SECRET=$(vault kv get -field=password secret/db); echo "$SECRET"', 2],
    ['AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key); echo $AWS_SECRET_ACCESS_KEY', 2],
    ['KEY=$(env | grep TOKEN); echo $KEY', REWRITE],
    ['(KEY=$(true)); echo $KEY', 2],
    ['false && KEY=$(true); echo $KEY', REWRITE],
    ['KEY=$(true) true; echo $KEY', REWRITE],
    ['KEY=$(printenv API_TOKEN); echo $KEY', REWRITE],
    ['echo $API_TOKEN', REWRITE],
  ];
  for (const [command, want] of cases) assert.equal(bash(command), want, command);
});

// Pilot 3, ours guard-02 r1: `node -e "...fs.writeFileSync(path, ...)..."` and `perl -0pi -e 's/.../' <file>` on a
// credential file were REWRITTEN into its read-only redacted view, so both edits silently never ran (~66 s, 12 calls,
// until the Edit tool made the change). A stage that WRITES while it names the file is blocked, visibly - the same
// contract a changing step elsewhere in the command already had.
test('guard-secret-value: a stage that WRITES the credential file is blocked, never rewritten into a read-only view', () => {
  const f = fixtures();
  const cases = [
    [`perl -0pi -e 's/acme/acme2/' ${f.secret} && echo OK`, 'perl -0pi'],
    [`perl -pi -e 's/acme/acme2/' ${f.secret}`, 'perl -pi'],
    [`perl -i.bak -pe 's/acme/acme2/' ${f.secret}`, 'perl -i.bak'],
    [`perl -p -i -e 's/acme/acme2/' ${f.secret}`, 'perl -p -i'],
    [`ruby -i -pe 'gsub(/acme/, "acme2")' ${f.secret}`, 'ruby -i'],
    [`sed -E -i '' 's/acme/acme2/' ${f.secret}`, 'sed -i after another flag'],
    [`sed -e 's/acme/acme2/' -i ${f.secret}`, 'sed -i after the script'],
    [`node -e "const fs=require('fs');const p='${f.secret}';const d=JSON.parse(fs.readFileSync(p,'utf8'));d.x=2;fs.writeFileSync(p,JSON.stringify(d,null,2));console.log('done')"`, 'node writeFileSync'],
    [`node -e "require('fs').appendFileSync('${f.secret}', '\\n')"`, 'node appendFileSync'],
    [`python3 -c "import json;p='${f.secret}';d=json.load(open(p));d['x']=2;json.dump(d, open(p,'w'))"`, "python open(p,'w')"],
    [`python3 -c "p='${f.secret}';open(p, mode='a').write('x')"`, "python open(p, mode='a')"],
    [`python3 - <<'PY'\nimport json\np='${f.secret}'\nd=json.load(open(p))\nopen(p, 'w').write(json.dumps(d))\nPY`, 'python heredoc writer'],
    [`node -e "require('fs').writeFileSync('${path.join(f.dir, 'tok.txt')}', process.env.SENTRY_ACCESS_TOKEN)"`, 'a runtime writing a credential variable'],
  ];
  for (const [command, label] of cases) {
    const r = run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite' });
    assert.equal(r.status, 2, `${label}: ${updatedCommand(r) || r.stderr}`);
    assert.match(r.stderr, /WRITES a file/, label);
    assert.match(r.stderr, /Edit tool/, `${label}: names the route that works`);
    assert.doesNotMatch(r.stderr, new RegExp(FAKE_TOKEN), label);
  }
  // Unchanged: a read through the same runtimes is still the view, and a first-flag in-place sed still passes.
  assert.equal(bash(`perl -ne 'print' ${f.secret}`), REWRITE, 'perl reading, not writing');
  assert.equal(bash(`python3 -c "print(open('${f.secret}').read())"`), REWRITE, 'python reading');
  assert.equal(bash(`sed -i '' 's/acme/acme2/' ${f.secret}`), 0, 'sed -i as its first flag passes, as before');
  assert.equal(bash(`node -e "require('fs').writeFileSync('${path.join(f.dir, 'out.txt')}', 'x')"`), 0, 'a writer that names no credential file is not judged');
});

// Review of pilot 4, I1: four more write shapes still came back as the view, so their edit silently never ran - a script
// FILE run against the credential file (the guard cannot see what it does), gawk's in-place extension, pathlib's
// `.open('w')`, and node's `openSync(p, 'w')` + `writeSync`.
test('guard-secret-value: a script file, awk -i inplace, pathlib .open and fs.openSync on the credential file block', () => {
  const f = fixtures();
  const script = path.join(f.dir, 'fix.py');
  fs.writeFileSync(script, "import sys\np=sys.argv[1]\nopen(p,'w').write(open(p).read())\n");
  const cases = [
    [`python3 ${script} ${f.secret}`, 'python3 <script> <file>'],
    [`python3 -u ${script} ${f.secret}`, 'python3 -u <script> <file>'],
    [`cd ${f.dir} && python fix.py ${f.secret}`, 'python <relative script> <file>'],
    [`node ${path.join(f.dir, 'fix.js')} ${f.secret}`, 'node <script> <file>'],
    [`ruby ${path.join(f.dir, 'fix.rb')} ${f.secret}`, 'ruby <script> <file>'],
    [`perl ${path.join(f.dir, 'fix.pl')} ${f.secret}`, 'perl <script> <file>'],
    [`awk -i inplace '{gsub(/acme/,"acme2")}1' ${f.secret}`, 'awk -i inplace'],
    [`gawk -i inplace '{gsub(/acme/,"acme2")}1' ${f.secret}`, 'gawk -i inplace'],
    [`gawk --include=inplace '{gsub(/acme/,"acme2")}1' ${f.secret}`, 'gawk --include=inplace'],
    [`python3 -c "import pathlib;p=pathlib.Path('${f.secret}');t=p.read_text();p.open('w').write(t)"`, "pathlib .open('w')"],
    [`python3 -c "import pathlib;pathlib.Path('${f.secret}').write_text('x')"`, 'pathlib write_text'],
    [`node -e "const fs=require('fs');const fd=fs.openSync('${f.secret}','w');fs.writeSync(fd,'x')"`, "fs.openSync(p,'w')"],
    [`node -e "const fs=require('fs');const fd=fs.openSync('${f.secret}', 'r+');fs.writeSync(fd,'x')"`, "fs.openSync(p,'r+')"],
  ];
  const verdicts = cases.map(([command, label]) => {
    const r = run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite' });
    return `${label}: ${r.status === 2 ? 'blocked' : updatedCommand(r) ? 'rewritten' : 'passed'}`;
  });
  assert.deepEqual(verdicts, cases.map(([, label]) => `${label}: blocked`));
  for (const [command, label] of cases) {
    const r = run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite' });
    assert.match(r.stderr, /WRITES a file|script FILE/, label);
    assert.match(r.stderr, /Edit tool/, `${label}: names the route that works`);
    assert.doesNotMatch(r.stderr, new RegExp(FAKE_TOKEN), label);
  }
  // Unchanged: a module run, inline code that only reads, and awk without the extension are still the view.
  assert.equal(bash(`python3 -m json.tool ${f.secret}`), REWRITE, 'python3 -m json.tool reads');
  assert.equal(bash(`python3 -c "import pathlib;print(pathlib.Path('${f.secret}').open().read())"`), REWRITE, 'pathlib .open() reads');
  assert.equal(bash(`node -e "const fs=require('fs');console.log(fs.readFileSync(fs.openSync('${f.secret}','r')).length)"`), REWRITE, "openSync 'r' reads");
  assert.equal(bash(`awk '{print}' ${f.secret}`), REWRITE, 'awk without -i inplace reads');
  assert.equal(bash(`python3 ${script}`), 0, 'a script that names no credential file is not judged');
});

// Review of pilot 4, M1: a first-flag `sed -i` skipped the whole segment, so `sed -i '' 's/TOKEN.*/&/w /dev/stdout'`
// printed the credential line. The skip holds only for a script that writes to no terminal stream and runs nothing.
test('guard-secret-value: a first-flag sed -i is exempt only when its script prints and runs nothing', () => {
  const f = fixtures();
  const cases = [
    [`sed -i '' 's/acme/&/w /dev/stdout' ${f.secret}`, 'w /dev/stdout'],
    [`sed -i 's/acme/&/w /dev/stderr' ${f.secret}`, 'w /dev/stderr'],
    [`sed -i '' 's/acme/&/W /dev/tty' ${f.secret}`, 'W /dev/tty'],
    [`sed -i -e '/acme/w /dev/fd/1' ${f.secret}`, 'w command to /dev/fd/1'],
    [`sed -i 's/acme/cat \\/etc\\/hosts/e' ${f.secret}`, 'the s///e flag'],
    [`sed -i '1e date' ${f.secret}`, 'the e command'],
    [`sed -i -f ${path.join(f.dir, 'fix.sed')} ${f.secret}`, 'a script file the guard cannot see'],
  ];
  const verdicts = cases.map(([command, label]) => `${label}: ${bash(command) === 2 ? 'blocked' : bash(command) === REWRITE ? 'rewritten' : 'passed'}`);
  assert.deepEqual(verdicts, cases.map(([, label]) => `${label}: blocked`));
  // Unchanged: a plain in-place edit runs, `-e` included, and so does a `w` into an ordinary file.
  assert.equal(bash(`sed -i '' 's/acme/acme2/' ${f.secret}`), 0, 'plain sed -i');
  assert.equal(bash(`sed -i -e 's/acme/acme2/' -e 's/x/y/' ${f.secret}`), 0, 'sed -i -e');
  assert.equal(bash(`sed -i 's/acme/acme2/w ${path.join(f.dir, 'changed.txt')}' ${f.secret}`), 0, 'w into an ordinary file');
});

// Pilot 3: `--presence <appsettings> ConnectionStrings.Lending Notices.Gateway.ServiceToken` answered `absent` for two
// keys that exist - it read only top-level (or `env`) keys.
test('guard-secret-value --presence: a dotted, colon or double-underscore path reads a nested JSON key', () => {
  const f = fixtures();
  const p = path.join(f.dir, 'appsettings.Development.json');
  fs.writeFileSync(p, JSON.stringify({ ConnectionStrings: { Lending: 'Host=db;Password=' + FAKE_TOKEN }, Logging: { LogLevel: { 'Microsoft.Hosting.Lifetime': 'Information' } },
    Notices: { DueSoonDays: 2, Gateway: { ServiceToken: FAKE_TOKEN, Enabled: true } } }, null, 2));
  const r = presence(p, 'ConnectionStrings.Lending', 'Notices:Gateway:ServiceToken', 'Notices__DueSoonDays', 'Notices.Gateway.Missing', 'Notices.Gateway',
    'Logging.LogLevel.Microsoft.Hosting.Lifetime');
  assert.equal(r.stdout, [`ConnectionStrings.Lending=set (${17 + FAKE_TOKEN.length} chars)`, `Notices:Gateway:ServiceToken=set (${FAKE_TOKEN.length} chars)`,
    'Notices__DueSoonDays=set (1 chars)', 'Notices.Gateway.Missing=absent', 'Notices.Gateway=set (object, 2 keys)',
    'Logging.LogLevel.Microsoft.Hosting.Lifetime=set (11 chars)', ''].join('\n'));
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(FAKE_TOKEN));
  assert.equal(presence(p).stdout, [`ConnectionStrings.Lending=set (${17 + FAKE_TOKEN.length} chars)`, 'Logging.LogLevel.Microsoft.Hosting.Lifetime=set (11 chars)',
    `Notices.Gateway.ServiceToken=set (${FAKE_TOKEN.length} chars)`, ''].join('\n'), 'no keys: every string leaf, as a dotted path');
  assert.equal(presence(f.secret, 'env.SENTRY_SLUG', 'SENTRY_SLUG').stdout, 'env.SENTRY_SLUG=set (4 chars)\nSENTRY_SLUG=set (4 chars)\n', 'a settings.json: the env block first, a path from the root too');
});

// Review of pilot 4, M5: the no-KEY leaf listing printed a credential-shaped key NAME as written, and listed every
// string leaf of a large JSON (a lockfile) into the context.
test('guard-secret-value --presence: a credential-shaped key name is masked, and the leaf list stops at 200', () => {
  const f = fixtures();
  const shaped = 'gh' + 'p_' + 'A1'.repeat(15); // built at run time: the literal would trip the commit scan
  const users = path.join(f.dir, 'users.json');
  fs.writeFileSync(users, JSON.stringify({ users: { [shaped]: 'admin' }, [shaped]: { role: 'owner' } }));
  const listed = presence(users).stdout;
  assert.doesNotMatch(listed, new RegExp(shaped.slice(0, 12)), 'the shape never prints');
  assert.equal(listed, `users.<credential-shaped, ${shaped.length} chars>=set (5 chars)\n<credential-shaped, ${shaped.length} chars>.role=set (5 chars)\n`);
  assert.doesNotMatch(presence(users, `users.${shaped}`).stdout, new RegExp(shaped.slice(0, 12)), 'a KEY argument is masked on the way out too');
  assert.match(presence(users, `users.${shaped}`).stdout, /=set \(5 chars\)/, 'and still looked up as written');
  const lock = path.join(f.dir, 'package-lock.json');
  const packages = {};
  for (let i = 0; i < 450; i++) packages[`node_modules/p${i}`] = { version: '1.0.0' };
  fs.writeFileSync(lock, JSON.stringify({ name: 'x', packages }));
  const lines = presence(lock).stdout.trimEnd().split('\n');
  assert.equal(lines.length, 201, 'at most 200 leaves plus one count line');
  assert.equal(lines[200], '# 251 more string leaves not listed - name a KEY to read one');
});

// Pilot 3: the model's first presence call guessed `node .claude/hooks/guard-secret-value.js` (only the docs, memory and
// history engines are copied there) - the redacted view it had just read named no path at all.
test('guard-secret-value: the redacted view names the runnable presence command', () => {
  const f = fixtures();
  const view = cli('--redacted', f.secret).stdout;
  assert.ok(view.split('\n')[0].includes(`node "${HOOK}" --presence "${f.secret}" KEY`), view.split('\n')[0]);
});

// ---- I2 (2.1.4 audit): the comparison verbs and git's own dumps ---------------------------------
// Replayed at develop 23c24b9d: each shape below printed a live credential with exit 0 and no rewrite, while
// `cat` of the same file was rewritten. `diff .env .env.example` is the ordinary 'which keys am I missing' move,
// and alfred-security.md itself runs `git add -N . && git diff HEAD` over every security-relevant change.
const REDACTOR = `node "${HOOK}" --redact-stdin`;
test('I2: diff, sdiff, cmp, comm and rev of a credential file are judged like cat', () => {
  const f = fixtures();
  const at = (c) => `cd "${f.dir}" && ${c}`;
  for (const c of ['diff .env .env.example', 'diff -u .env.example .env', 'sdiff .env .env.example', 'comm .env .env.example', 'cmp -l .env .env.example', 'rev .env', 'tac .env'])
    assert.equal(bash(at(c)), REWRITE, c);
  assert.match(rewritten(at('diff .env .env.example')), /--redacted "[^"]*\.env"/, 'the view of the credential file');
  assert.equal(bash(at('diff .env.example clean-settings.json')), 0, 'no credential file among the operands');
  assert.equal(bash('git rev-parse --show-toplevel'), 0, 'rev inside rev-parse is no verb');
});

test('I2: a git command that prints file content is piped through the stream redactor, in place', () => {
  for (const c of ['git diff', 'git diff appsettings.json', 'git show HEAD:appsettings.json', 'git log -p -1', 'git stash show -p', 'git --no-pager diff --cached', 'git -C sub show HEAD'])
    assert.equal(rewritten(c), `${c} | ${REDACTOR}`, c);
  // outside a repository every probe fails, so each is piped; `--no-index` runs anywhere and is judged on its output
  const f = fixtures();
  const noIndex = 'git diff --no-index .env.example .env';
  assert.equal(updatedCommand(run({ tool_name: 'Bash', tool_input: { command: noIndex }, session_id: 'suite', cwd: f.dir })), `${noIndex} | ${REDACTOR}`, noIndex);
  assert.equal(rewritten('git diff | grep TOKEN'), `git diff | ${REDACTOR} | grep TOKEN`, 'its own filter reads the masked stream');
  assert.equal(rewritten('git add -N . && git diff HEAD; git reset -q'), `git add -N . && git diff HEAD | ${REDACTOR}; git reset -q`, 'the security-review diff keeps every step');
  for (const c of ['git status', 'git log --oneline -5', 'git diff --stat', 'git diff --name-only HEAD~1', 'git diff --quiet', 'git diff | wc -l', 'git diff > /tmp/x.patch', 'git stash show', `git diff | ${REDACTOR}`])
    assert.equal(bash(c), 0, `${c} passes untouched`);
});

test('I2: the stream redactor masks credential values, URL passwords and PEM bodies line by line', () => {
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA0000', 'abcdabcdabcd', '-----END RSA PRIVATE KEY-----'];
  const input = ['diff --git a/.env b/.env', '--- a/.env', '+++ b/.env', '-API_TOKEN=old', `+API_TOKEN=${FAKE_TOKEN}`, ' DB_HOST=localhost',
    '+  "ClientSecret": "' + FAKE_TOKEN + '",', '+DATABASE_URL=postgres://app:' + FAKE_TOKEN + '@db:5432/app',
    ...pem.map((l) => `+${l}`), '+const x = 1;'].join('\n') + '\n';
  const r = spawnSync(process.execPath, [HOOK, '--redact-stdin'], { input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes(FAKE_TOKEN), r.stdout);
  assert.ok(!r.stdout.includes('abcdabcdabcd'), 'the PEM body');
  assert.match(r.stdout, /^\+API_TOKEN=<set \(40 chars\)>$/m);
  assert.match(r.stdout, /^\+ {2}"ClientSecret": "<set \(40 chars\)>",$/m);
  assert.match(r.stdout, /^\+DATABASE_URL=postgres:\/\/app:<set \(40 chars\)>@db:5432\/app$/m);
  assert.match(r.stdout, /^\+-----BEGIN RSA PRIVATE KEY-----$/m, 'the PEM markers stay');
  assert.match(r.stdout, /^-API_TOKEN=<set \(3 chars\)>$/m, 'a removed value is a credential too');
  for (const keep of ['diff --git a/.env b/.env', '+++ b/.env', ' DB_HOST=localhost', '+const x = 1;'])
    assert.ok(r.stdout.split('\n').includes(keep), `${keep} stays as written`);
  assert.match(r.stderr, /credential guard/, 'a masked stream says so on stderr');
  const clean = spawnSync(process.execPath, [HOOK, '--redact-stdin'], { input: '+const x = 1;\n', encoding: 'utf8' });
  assert.equal(clean.stdout, '+const x = 1;\n');
  assert.equal(clean.stderr, '', 'nothing masked, nothing said');
});

test('I2: end to end - the rewritten git dumps print no credential from a real repository', { skip: process.platform === 'win32' && 'sh pipeline' }, () => {
  const repo = fs.mkdtempSync(path.join(TMP, 'git-dump-'));
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'appsettings.json'), JSON.stringify({ Api: { ClientSecret: FAKE_TOKEN } }, null, 2) + '\n');
  fs.writeFileSync(path.join(repo, '.env'), `API_TOKEN=${FAKE_TOKEN}\n`);
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'appsettings.json'), JSON.stringify({ Api: { ClientSecret: 'y1'.repeat(20) } }, null, 2) + '\n');
  for (const c of ['git diff', 'git show HEAD:appsettings.json', 'git log -p -1', 'git show HEAD']) {
    const cmd = updatedCommand(run({ tool_name: 'Bash', tool_input: { command: c }, session_id: 'suite', cwd: repo }, { CLAUDE_PROJECT_DIR: repo }));
    assert.ok(cmd && cmd.endsWith('--redact-stdin'), `${c} -> ${cmd}`);
    const out = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(!out.stdout.includes(FAKE_TOKEN) && !out.stdout.includes('y1'.repeat(20)), `${c} printed a credential:\n${out.stdout}`);
    assert.match(out.stdout, /<set \(40 chars\)>/, `${c} shows the masked value`);
  }
});

// A rewritten command carries a `node ...` stage the permission system has never seen, so an unconditional pipe
// would turn every read-only `git diff` into a call that asks. The guard probes the same git read first (argv,
// no shell, bounded) and pipes only a stage whose output would be masked - or one it cannot probe.
test('I2: a git dump with nothing to mask runs as written; one the probe cannot run is piped', { skip: process.platform === 'win32' && 'posix git fixture' }, () => {
  const repo = fs.mkdtempSync(path.join(TMP, 'git-clean-'));
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(repo, 'config.json'), JSON.stringify({ port: 8080 }) + '\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
  const at = (command) => verdict(run({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite', cwd: repo }, { CLAUDE_PROJECT_DIR: repo }));
  for (const c of ['git diff', 'git show HEAD', 'git log -p -1', 'git diff HEAD~0 -- app.js', 'git show HEAD:config.json'])
    assert.equal(at(c), 0, `${c}: nothing to mask, nothing rewritten`);
  for (const c of ['git diff $REV', 'git -c diff.external=x diff', 'git diff --output=o.patch', 'cd sub && git diff', 'git diff not-a-revision'])
    assert.equal(at(c), REWRITE, `${c}: not probed, so piped`);
  assert.ok(!fs.existsSync(path.join(repo, 'o.patch')), 'the probe never ran a writing flag');
  for (const c of ['git status && git diff', 'git log --oneline -1; git show HEAD'])
    assert.equal(at(c), 0, `${c}: a read-only step before it leaves the probe standing`);
});

// Final review IM1: the probe runs at PreToolUse, BEFORE the command's earlier steps. The security-review diff
// alfred-security.md prescribes (`git add -N . && git diff HEAD`) exists so a brand-new file shows - and the
// probe saw the tree before `git add -N .`, found nothing, piped nothing, and the run printed the new credential.
test('IM1: a git dump after a step that changes the tree is piped unprobed - a new untracked credential stays masked', { skip: process.platform === 'win32' && 'sh pipeline' }, () => {
  const repo = fs.mkdtempSync(path.join(TMP, 'git-new-'));
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'appsettings.json'), JSON.stringify({ Api: { ClientSecret: FAKE_TOKEN } }, null, 2) + '\n');
  for (const c of ['git add -N . && git diff HEAD; git reset -q', 'git add appsettings.json && git diff --cached']) {
    const cmd = updatedCommand(run({ tool_name: 'Bash', tool_input: { command: c }, session_id: 'suite', cwd: repo }, { CLAUDE_PROJECT_DIR: repo }));
    assert.ok(cmd && cmd.includes('--redact-stdin'), `${c} -> ${cmd}`);
    const out = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
    assert.ok(!out.stdout.includes(FAKE_TOKEN), `${c} printed a credential:\n${out.stdout}`);
    assert.match(out.stdout, /<set \(40 chars\)>/, `${c} shows the masked value`);
    git('reset', '-q');
  }
});
