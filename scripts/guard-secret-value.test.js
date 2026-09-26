#!/usr/bin/env node
// Suite for stack/hooks/guard-secret-value.js. Runs with `npm test` (node --test).
'use strict';
const test = require('node:test');
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
  assert.equal(bash(`cat ${f.secret}`, { ALFRED_CODE_DOCS_PATH: ledger }), REWRITE, 'a rewrite costs no retried turn - it is not a block');
  assert.ok(!fs.existsSync(path.join(ledger, 'hook-blocks')), 'and writes no ledger row');
  assert.equal(bash(`curl -H "Authorization: Bearer ${FAKE_JWT}" https://example.test/api`, { ALFRED_CODE_DOCS_PATH: ledger }), 2);
  const rows = fs.readFileSync(path.join(ledger, 'hook-blocks', 'suite.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hook, 'guard-secret-value.js');
  assert.doesNotMatch(JSON.stringify(rows[0]), new RegExp(FAKE_JWT));
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
  const two = rewritten(`cat ${f.secret}; cat ${f.dotenv}`);
  assert.match(two, /^echo "# credential guard: 1 other step\(s\) of this command were dropped/, 'the note leads the rewrite');
  assert.match(two, /cat [^"]*\.env/, 'and names the dropped step');
  assert.ok(two.endsWith(view), 'the view still ends it');
  assert.match(rewritten(`cat ${f.secret}; cat "$SOME_UNSET_DIR/settings.json"`), /^echo "# credential guard: /,
    'an unresolvable path in another segment is never kept running either');
  // a heredoc in the same command cannot be spliced (the judged text has its body blanked), so the
  // whole-command rewrite stands - and says which steps went with it
  const withDoc = rewritten(`cat <<'EOF' > ${path.join(f.dir, 'notes.md')}\nplan\nEOF\ncat ${f.secret}`);
  assert.match(withDoc, /^echo "# credential guard: \d+ other step\(s\)/, 'the unspliceable shape names its drops');
  assert.match(withDoc, /notes\.md/, 'including the heredoc write that did not run');
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
