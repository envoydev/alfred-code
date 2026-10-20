#!/usr/bin/env node
// Suite for the project's sensitive data in stack/hooks/guard-secret-value.js: `<data root>/.sensitive-data`, a dotenv the
// user fills by hand (the user's ruling of 2026-10-13). Its values are kept out of the chat by accident - a Read is blocked, a
// shell dump becomes the redacted view, a source / copy / print is refused - and a command that needs them runs through
// `--with-sensitive`, which puts them in its environment and masks each one's exact text in its output (an encoded
// print is not caught - the twin-parser case below reads values back as hex through it). The session starts with its KEYS.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const dataRoot = require('../stack/mcp/data-root.js');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-secret-value.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-sensitive-')));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
process.env.ALFRED_CODE_DOCS_PATH = path.join(TMP, 'ledger');

// Fake by construction: long enough to be masked, and not a run of one character (a placeholder by content).
const TOKEN = 'tok-' + 'a1b2'.repeat(6);
const STORE = `# the project's own\nexport API_TOKEN="${TOKEN}"\nDB_HOST=db.internal\nPORT=80\n`;

// A project with a store under its data root; `root` is the data root's folder.
function project(name, { text = STORE, root = '.alfred' } = {})
{
    const dir = path.join(TMP, name);
    fs.mkdirSync(path.join(dir, ...root.split('/')), { recursive: true });
    const file = path.join(dir, ...root.split('/'), '.sensitive-data');
    if (text !== null) fs.writeFileSync(file, text);
    return { dir, file };
}
const run = (payload, env = {}) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } });
const updated = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput.command; } catch { return null; } };
const verdict = (r) => (r.status === 2 ? 2 : updated(r) != null ? 'rewrite' : r.status);
const bash = (cwd, command) => verdict(run({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'suite' }));
const started = (cwd, env) => run({ hook_event_name: 'SessionStart', source: 'startup', cwd, session_id: 'suite' }, env);
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return null; } };
// A print script, so the wrapped command line is the same under sh and cmd.exe.
const PRINT = path.join(TMP, 'print.js');
fs.writeFileSync(PRINT, "const [how, ...keys] = process.argv.slice(2);\nfor (const k of keys) { const v = process.env[k]; const out = how === 'hex' ? Buffer.from(v ?? '').toString('hex') : String(v); (how === 'err' ? console.error : console.log)(`${k}=${out}`); }\nif (how === 'exit') process.exit(Number(keys[0]));\n");
const wrapped = (cwd, line, env = {}) => spawnSync(process.execPath, [HOOK, '--with-sensitive', '--', line], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
const node = (...args) => [`"${process.execPath}"`, `"${PRINT}"`, ...args].join(' ');

test('sensitive data: a Read of the store is blocked, whatever its keys are called', () =>
{
    const { dir, file } = project('read');
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: file }, cwd: dir, session_id: 'suite' }).status, 2);
    // DB_HOST alone is no credential by name - in the store it is one all the same.
    const host = project('read-host', { text: 'DB_HOST=db.internal\n' });
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: host.file }, cwd: host.dir, session_id: 'suite' }).status, 2, 'every value in the store is a credential');
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'API', path: file, output_mode: 'content' }, cwd: dir, session_id: 'suite' }).status, 2, 'a Grep of its content too');
});

test('sensitive data: a shell dump becomes the redacted view, and that view masks every value', () =>
{
    const { dir, file } = project('dump');
    for (const command of [`cat "${file}"`, `head -5 "${file}"`, `grep API "${file}"`, `cat "${file}" | sort`])
    {
        const r = run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' });
        // A later stage (`| head -5`, `| sort`) stays on the view.
        assert.ok(String(updated(r)).startsWith(`node "${HOOK}" --redacted "${file}"`), `${command}\n-> ${updated(r)}`);
    }
    const view = spawnSync(process.execPath, [HOOK, '--redacted', file], { encoding: 'utf8' });
    assert.strictEqual(view.status, 0, view.stderr);
    for (const value of [TOKEN, 'db.internal']) assert.ok(!view.stdout.includes(value), `${value} in the redacted view:\n${view.stdout}`);
    assert.match(view.stdout, /API_TOKEN=/);
    assert.match(view.stdout, /DB_HOST=/);
    const keys = spawnSync(process.execPath, [HOOK, '--presence', file], { encoding: 'utf8' });
    assert.match(keys.stdout, /API_TOKEN/);
    assert.ok(!keys.stdout.includes(TOKEN), keys.stdout);
});

test('sensitive data: a command naming the store is refused - source, copy, add, print; a look at it passes', () =>
{
    const { dir, file } = project('mention');
    const rel = '.alfred/.sensitive-data';
    for (const command of [`source ${rel}`, `. ./${rel} && ./deploy.sh`, `cp ${rel} /tmp/out`, `git add ${rel}`, `export $(xargs < ${rel})`, `rm ${rel}`])
        assert.notStrictEqual(bash(dir, command), 0, command);
    for (const command of [`test -f ${rel} && echo yes`, `[ -s ${rel} ]`, `ls -la ${rel}`, `wc -l ${rel}`, 'ls -la .alfred', `echo ${rel}.example`,
        `node "${HOOK}" --presence "${file}"`, `node "${HOOK}" --with-sensitive -- "npm run deploy"`])
        assert.strictEqual(bash(dir, command), 0, command);
    const r = run({ tool_name: 'Bash', tool_input: { command: `source ${rel}` }, cwd: dir, session_id: 'suite' });
    assert.match(r.stderr, /--with-sensitive/, 'the refusal names the run that uses the values');
});

// The 2026-10-17 usage audit: three refusals of commands that read no value - git's own check that the store is ignored
// (the session-start warning's check), a plan line naming the store and its KEYS, and a count-only host check chained to a
// build. Each passes now; the same verbs feeding a reader, a shell heredoc and a redirect onto the store stay refused.
test('sensitive data: a git look, a name in written text and a count-only check pass; piped on or run they do not', () =>
{
    const { dir } = project('looks');
    const rel = '.alfred/.sensitive-data';
    for (const command of [`git check-ignore -q ${rel}`, `git check-ignore -q ${rel} || echo NOT-IGNORED`, `git -C . check-ignore -v ${rel}`, `git status --short ${rel}`,
        `cat >> plan.md <<'EOF'\n- the deploy reads DB_HOST and API_TOKEN from ${rel} (names only)\nEOF`, `echo "keys DB_HOST, API_TOKEN live in ${rel}"`,
        `grep -c prod ${rel} && npm run build`, `grep -qi 'DB_HOST=.*prod' ${rel} || npm run start`, `grep -ci prod ${rel}; npm run build`, `cut -d= -f1 ${rel}`])
        assert.strictEqual(bash(dir, command), 0, command);
    for (const command of [`echo ${rel} | xargs cat`, `grep -l x ${rel} | xargs cat`, `git ls-files ${rel} | xargs cat`, `echo x > ${rel}`,
        `bash <<'EOF'\nsource ${rel}\necho $DB_HOST\nEOF`, `echo "$(source ${rel}; echo $DB_HOST)"`])
        assert.strictEqual(bash(dir, command), 2, command);
    assert.strictEqual(bash(dir, `grep prod ${rel}`), 'rewrite', 'a grep that prints lines still gets the masked view');
});

// Audit 2026-10-14 HK11 (replays sens.js, sens2.js): the refusal read the literal name only, so a glob, a quoted split or the
// folder holding the store passed while the dump half resolved the same globs. Each replayed shape is refused now; an
// ordinary command on the data root or the project passes.
test('sensitive data: a glob, a quoted split or an archive / add / copy of the folder holding the store is refused (HK11)', () =>
{
    const { dir } = project('spelled');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1\n');
    fs.mkdirSync(path.join(dir, '.alfred', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'x.md'), '# x\n');
    for (const command of ['source .alfred/.sens*', 'set -a; . .alfred/.sens*; set +a; npm run migrate', 'source .alfred/.sens* && echo $DB_HOST',
        'tar cf - .alfred | tar xOf -', 'tar cf - .alfred | tar tvf -', 'docker compose --env-file .alfred/.sens* up -d', 'docker compose --env-file=.alfred/.sens* up',
        'git add -f .alfred/.sens*', 'zip -r /tmp/a.zip .alfred && unzip -p /tmp/a.zip', 'cp -r .alfred /tmp/bk', 'rsync -a .alfred/ /tmp/bk/',
        "cat .alfred/'.sensitive-data'", 'cat .alfred/.sensitive""-data', 'cd .alfred && source .sens*', 'cd .alfred && git add -f .',
        "bash -c 'source .alfred/.sens*'", 'ln -s .alfred/.sens* env.local', 'mv .alfred/.sens{itive-data,} /tmp/'])
        assert.strictEqual(bash(dir, command), 2, command);
    // a link to the store is the store, by its real path
    fs.symlinkSync(path.join(dir, '.alfred', '.sensitive-data'), path.join(dir, 'env.link'));
    assert.strictEqual(bash(dir, 'source env.link'), 2, 'a symlink resolves to the store');
    for (const command of ['ls -la .alfred', 'ls .alfred/.sens*', 'test -f .alfred/.sens* && echo y', 'git add .', 'git add -A', 'git add .alfred/docs/x.md',
        'tar czf /tmp/src.tgz src', 'cp -r src /tmp/src-copy', 'cp .alfred/docs/x.md /tmp/', 'zip -r /tmp/docs.zip .alfred/docs', 'find .alfred -name "*.md"',
        'cd .alfred && ls', 'git status', "git commit -m 'note: the store stays out of git'", 'echo .alfred/.sensitive-data.example',
        "cat > notes.md <<'EOF'\nsource .alfred/.sens*\nEOF"])
        assert.strictEqual(bash(dir, command), 0, command);
    const r = run({ tool_name: 'Bash', tool_input: { command: 'source .alfred/.sens*' }, cwd: dir, session_id: 'suite' });
    assert.match(r.stderr, /--with-sensitive/, 'the same refusal, naming the run that uses the values');
});

test('--with-sensitive: the values are in the command\'s environment and each prints as <KEY>; the exit code is the command\'s', () =>
{
    const { dir } = project('wrap');
    const out = wrapped(dir, node('out', 'API_TOKEN', 'DB_HOST', 'PORT'));
    assert.strictEqual(out.status, 0, out.stderr);
    assert.strictEqual(out.stdout.replace(/\r/g, ''), 'API_TOKEN=<API_TOKEN>\nDB_HOST=<DB_HOST>\nPORT=80\n', 'a value under 4 characters is not masked');
    assert.match(out.stderr, /3 value\(s\) from .*\.sensitive-data in the environment \(API_TOKEN, DB_HOST, PORT\)/);
    assert.ok(!out.stderr.includes(TOKEN));
    const err = wrapped(dir, node('err', 'API_TOKEN'));
    assert.match(err.stderr, /API_TOKEN=<API_TOKEN>/, 'stderr is masked too');
    assert.ok(!err.stderr.includes(TOKEN), err.stderr);
    assert.strictEqual(wrapped(dir, node('exit', '3')).status, 3);
    const own = wrapped(dir, node('hex', 'API_TOKEN'), { API_TOKEN: 'from-the-shell' });
    assert.strictEqual(own.stdout.trim(), `API_TOKEN=${Buffer.from(TOKEN).toString('hex')}`, 'the run asked for the project\'s value: the file wins');
});

test('--with-sensitive: no store runs the command and says so; no command is a usage error', () =>
{
    const dir = path.join(TMP, 'wrap-none');
    fs.mkdirSync(dir, { recursive: true });
    const r = wrapped(dir, node('out', 'API_TOKEN'));
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, /not found - the command runs without it/);
    const bare = spawnSync(process.execPath, [HOOK, '--with-sensitive', '--'], { cwd: dir, encoding: 'utf8' });
    assert.strictEqual(bare.status, 2);
    assert.match(bare.stderr, /usage:/);
});

test('session start: the store\'s KEYS and the run that uses them, never a value; silent with none, an empty one, or garbage', () =>
{
    const { dir } = project('start');
    const said = context(started(dir));
    assert.match(said, /^Sensitive data: \.alfred\/\.sensitive-data holds API_TOKEN, DB_HOST, PORT - /);
    assert.match(said, /--with-sensitive -- "<command line>"/);
    // audit 2026-10-14 PL2: the browser takes the store as its --secrets file, so a login types the KEY name
    assert.match(said, /In the browser, type a KEY name in browser_type \/ browser_fill_form: the browser server fills its value and shows it as <secret>KEY<\/secret>\./);
    for (const value of [TOKEN, 'db.internal']) assert.ok(!said.includes(value), said);
    for (const [name, text] of [['start-none', null], ['start-empty', ''], ['start-garbage', '\u0000\u0001 not a dotenv {"a":1}\n']])
    {
        const r = started(project(name, { text }).dir);
        assert.strictEqual(r.status, 0, name);
        assert.strictEqual(r.stdout, '', `${name}: ${r.stdout}`);
    }
});

test('session start: a store git would commit is said - not ignored, or tracked; the data root\'s own .gitignore quiets it', () =>
{
    const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' });
    const { dir } = project('start-git');
    git(dir, 'init', '-q');
    assert.match(context(started(dir)), /WARNING: git does not ignore \.alfred\/\.sensitive-data/);
    fs.writeFileSync(path.join(dir, '.alfred', '.gitignore'), dataRoot.dataIgnoreText({ root: '.alfred', docsPath: '.alfred/docs' }));
    assert.doesNotMatch(context(started(dir)), /WARNING/, 'the root\'s own .gitignore covers it');
    git(dir, 'add', '-f', '.alfred/.sensitive-data');
    assert.match(context(started(dir)), /WARNING: git does not ignore .*untrack it with git rm --cached/, 'a tracked store is said even under an ignore rule');
});

test('session start and --with-sensitive: a custom data root, and a linked worktree reading its main checkout\'s store', () =>
{
    const custom = project('start-custom', { root: 'var/data' });
    assert.match(context(started(custom.dir, { ALFRED_CODE_DATA_PATH: 'var/data' })), /^Sensitive data: var\/data\/\.sensitive-data holds API_TOKEN/);
    assert.strictEqual(started(custom.dir).stdout, '', 'the default root holds none');
    assert.strictEqual(started(custom.dir, { ALFRED_CODE_DATA_PATH: '../outside' }).stdout, '', 'a root outside the project is never read');
    const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' });
    const { dir: main } = project('wt-main');
    git(main, 'init', '-q');
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git(main, 'add', 'README.md');
    git(main, 'commit', '-qm', 'x');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'alfred-code.stamp'), 'sha: abc\n');
    const wt = path.join(TMP, 'wt-linked');
    git(main, 'worktree', 'add', '-q', wt);
    assert.match(context(started(wt)), /holds API_TOKEN, DB_HOST, PORT/, 'a new worktree has no store of its own: the main checkout\'s is the one');
    assert.strictEqual(wrapped(wt, node('out', 'API_TOKEN')).stdout.trim(), 'API_TOKEN=<API_TOKEN>');
});

// The launchers read the store through data-root.js, the guard through its own parser (the hooks ship apart from
// stack/mcp on the copy route): one fixture, one answer.
test('sensitive data: the guard and data-root.js read one store the same way - BOM, CRLF, export, quotes, comments, = in a value', () =>
{
    const text = '\uFEFF# comment\r\nexport A_ONE="quoted value"\r\nB_TWO=\'single\'\r\n  C_THREE = spaced  \r\nD_URL=postgres://u:p@h/db?x=1\r\nE_EMPTY=\r\n;not a key\r\n';
    const { dir } = project('twin', { text });
    const read = dataRoot.readSensitive({ projectDir: dir });
    assert.deepStrictEqual(read, { A_ONE: 'quoted value', B_TWO: 'single', C_THREE: 'spaced', D_URL: 'postgres://u:p@h/db?x=1', E_EMPTY: '' });
    const r = wrapped(dir, node('hex', ...Object.keys(read)));
    const guard = Object.fromEntries(r.stdout.trim().split(/\r?\n/).map((l) => l.split('=')).map(([k, hex]) => [k, Buffer.from(hex, 'hex').toString()]));
    assert.deepStrictEqual(guard, read, r.stderr);
    const utf16 = project('twin-utf16', { text: null });
    fs.writeFileSync(utf16.file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('K_ONE=wide value\r\n', 'utf16le')]));
    assert.deepStrictEqual(dataRoot.readSensitive({ projectDir: utf16.dir }), { K_ONE: 'wide value' });
    assert.strictEqual(wrapped(utf16.dir, node('hex', 'K_ONE')).stdout.trim(), `K_ONE=${Buffer.from('wide value').toString('hex')}`);
});

// audit 2026-10-20 C17 (fabea019): after a refusal the model built the store's name in pieces; the dump and the copy then
// passed unjudged. A name assembled from literals the same command assigned resolves before either check.
test('audit 2026-10-20 C17: a store name built by concatenation is masked when printed and refused when carried', () => {
    const { dir } = project('concat');
    const built = 'f=".sensitive"; f="$f-data"; ';
    const out = run({ tool_name: 'Bash', tool_input: { command: `${built}cat ".alfred/$f"` }, cwd: dir, session_id: 'suite' });
    assert.match(updated(out) || '', /--redacted ".*\.alfred[\\/]\.sensitive-data"/, 'the print becomes the masked view');
    assert.strictEqual(bash(dir, `${built}cp ".alfred/$f" /tmp/x`), 2, 'a copy is refused');
    assert.strictEqual(bash(dir, `${built}source ".alfred/$f"`), 2, 'a source is refused');
    assert.strictEqual(bash(dir, `${built}cp ".alfred/$f" /tmp/x; f=other`), 2, 'a later reassignment does not hide it');
    assert.strictEqual(bash(dir, `${built}git check-ignore -q ".alfred/$f"; echo ignored=$?`), 0, 'a look still passes (the evidence shape)');
    assert.strictEqual(bash(dir, 'f=".sensitive"; f="$f-notes"; cat ".alfred/$f" 2>/dev/null'), 0, 'another name built the same way is no store');
});

// Audit 2026-10-20 H3: a walk through the store and a diff of a tracked store printed every value raw - the stream masker
// had no store kind, though the session start says a printed value is masked. Now a line out of the store is masked by
// its path or its diff header, whatever its key, so the probe finds it and the stage is piped.
test('H3: a walk through the store and a git stream of it mask every value', { skip: process.platform === 'win32' && 'sh pipeline' }, () =>
{
    const { dir } = project('h3-walk');
    fs.writeFileSync(path.join(dir, 'app.js'), 'const host = process.env.DB_HOST;\n');
    const sh = (command) => spawnSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8' });
    for (const command of ['grep -rn DB_HOST .', 'grep -rn internal .'])
    {
        const out = updated(run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' }));
        assert.ok(out && out.includes('--redact-stdin'), `${command}: the walk reaches the store, so it is piped - ${out}`);
        const r = sh(out);
        assert.ok(!r.stdout.includes('db.internal'), `${command}: printed raw - ${r.stdout}`);
        assert.match(r.stdout, /\.sensitive-data:\d+:DB_HOST=<set \(11 chars\)>/, r.stdout);
    }
    assert.strictEqual(bash(dir, 'grep -rn no_such_word_anywhere .'), 0, 'a walk that prints nothing of the store runs as written');
    // a store tracked by hand: the diff header names it, and every changed value is masked
    const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
    g('add', '-f', '.'); g('commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, '.alfred', '.sensitive-data'), STORE.replace('db.internal', 'db2.internal') + 'PLAIN line no pair\n');
    const out = updated(run({ tool_name: 'Bash', tool_input: { command: 'git diff' }, cwd: dir, session_id: 'suite' }));
    assert.ok(out && out.includes('--redact-stdin'), `a diff of the tracked store is piped - ${out}`);
    const r = sh(out);
    assert.ok(!/db2?\.internal|PLAIN line/.test(r.stdout) && !r.stdout.includes(TOKEN), r.stdout);
    assert.match(r.stdout, /^\+DB_HOST=<set \(12 chars\)>$/m, r.stdout);
    assert.match(r.stdout, /^\+<sensitive-data line>$/m, r.stdout);
});
