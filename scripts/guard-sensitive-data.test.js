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
const secretChain = require('../stack/hooks/secret-chain.js');

const HOOK = path.join(__dirname, '..', 'stack', 'hooks', 'guard-secret-value.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-sensitive-')));
process.env.CLAUDE_PROJECT_DIR = fs.mkdtempSync(path.join(TMP, 'root-'));
process.env.ALFRED_CODE_DOCS_PATH = path.join(TMP, 'ledger');

// Fake by construction: long enough to be masked, and not a run of one character (a placeholder by content).
const TOKEN = 'tok-' + 'a1b2'.repeat(6);
const STORE = `# the project's own\nexport API_TOKEN="${TOKEN}"\nDB_HOST=db.internal\nPORT=80\n`;
const STORE_VALUES = [TOKEN, 'db.internal'];   // every value is the store's: none may print

// A project with a store under its data root; `root` is the data root's folder, `file` the store's name - `.secrets`
// from item 3 (2026-10-25), `.sensitive-data` until every install has moved - so each case runs once per name.
function project(name, { text = STORE, root = '.alfred', file = '.sensitive-data' } = {})
{
    const dir = path.join(TMP, `${name}${file}`);
    fs.mkdirSync(path.join(dir, ...root.split('/')), { recursive: true });
    const at = path.join(dir, ...root.split('/'), file);
    if (text !== null) fs.writeFileSync(at, text);
    return { dir, file: at };
}
const NAMES = ['.secrets', '.sensitive-data'];
const RE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

for (const FILE of NAMES)
{
test(`sensitive data: a Read of the store is blocked, whatever its keys are called [${FILE}]`, () =>
{
    const { dir, file } = project('read', { file: FILE });
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: file }, cwd: dir, session_id: 'suite' }).status, 2);
    // DB_HOST alone is no credential by name - in the store it is one all the same.
    const host = project('read-host', { text: 'DB_HOST=db.internal\n', file: FILE });
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: host.file }, cwd: host.dir, session_id: 'suite' }).status, 2, 'every value in the store is a credential');
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'API', path: file, output_mode: 'content' }, cwd: dir, session_id: 'suite' }).status, 2, 'a Grep of its content too');
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'DB_HOST', path: host.file, output_mode: 'content' }, cwd: host.dir, session_id: 'suite' }).status, 2, 'a Grep naming a key no credential pattern names');
});

test(`sensitive data: a shell dump becomes the redacted view, and that view masks every value [${FILE}]`, () =>
{
    const { dir, file } = project('dump', { file: FILE });
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

test(`sensitive data: a command naming the store is refused - source, copy, add, print; a look at it passes [${FILE}]`, () =>
{
    const { dir, file } = project('mention', { file: FILE });
    const rel = `.alfred/${FILE}`;
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
test(`sensitive data: a git look, a name in written text and a count-only check pass; piped on or run they do not [${FILE}]`, () =>
{
    const { dir } = project('looks', { file: FILE });
    const rel = `.alfred/${FILE}`;
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
test(`sensitive data: a glob, a quoted split or an archive / add / copy of the folder holding the store is refused (HK11) [${FILE}]`, () =>
{
    const { dir } = project('spelled', { file: FILE });
    // the name as the shell would spell it: a glob of its head, a quoted split, a brace list
    const G = `${FILE.slice(0, 5)}*`;
    const SPLIT = `${FILE.slice(0, 4)}""${FILE.slice(4)}`;
    const BRACE = `${FILE.slice(0, 5)}{${FILE.slice(5)},}`;
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), '1\n');
    fs.mkdirSync(path.join(dir, '.alfred', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'x.md'), '# x\n');
    // The session's project dir keeps its own data root with no store (its statistics/ ledger, 2.8.0): an operand is judged
    // at every anchor it names, so `.alfred` there never hides the one in the cwd that holds the store.
    fs.mkdirSync(path.join(process.env.CLAUDE_PROJECT_DIR, '.alfred', 'statistics'), { recursive: true });
    for (const command of [`source .alfred/${G}`, `set -a; . .alfred/${G}; set +a; npm run migrate`, `source .alfred/${G} && echo $DB_HOST`,
        'tar cf - .alfred | tar xOf -', 'tar cf - .alfred | tar tvf -', `docker compose --env-file .alfred/${G} up -d`, `docker compose --env-file=.alfred/${G} up`,
        `git add -f .alfred/${G}`, 'zip -r /tmp/a.zip .alfred && unzip -p /tmp/a.zip', 'cp -r .alfred /tmp/bk', 'rsync -a .alfred/ /tmp/bk/',
        `cd .alfred && source ${G}`, 'cd .alfred && git add -f .',
        `bash -c 'source .alfred/${G}'`, `ln -s .alfred/${G} env.local`, `mv .alfred/${BRACE} /tmp/`])
        assert.strictEqual(bash(dir, command), 2, command);
    // a print of a quoted split is the literal path's print since HK-04 (the shell's quote removal): the masked view
    for (const command of [`cat .alfred/'${FILE}'`, `cat .alfred/${SPLIT}`])
    {
        const r = run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' });
        assert.notStrictEqual(verdict(r), 0, `${command}: rewritten or refused, never run as written`);
        if (verdict(r) === 'rewrite')
        {
            const out = spawnSync('bash', ['-c', updated(r)], { cwd: dir, encoding: 'utf8' });
            for (const v of STORE_VALUES) assert.ok(!(out.stdout + out.stderr).includes(v), `${command}: the masked view printed a value`);
        }
    }
    // a link to the store is the store, by its real path
    fs.symlinkSync(path.join(dir, '.alfred', FILE), path.join(dir, 'env.link'));
    assert.strictEqual(bash(dir, 'source env.link'), 2, 'a symlink resolves to the store');
    for (const command of ['ls -la .alfred', `ls .alfred/${G}`, `test -f .alfred/${G} && echo y`, 'git add .', 'git add -A', 'git add .alfred/docs/x.md',
        'tar czf /tmp/src.tgz src', 'cp -r src /tmp/src-copy', 'cp .alfred/docs/x.md /tmp/', 'zip -r /tmp/docs.zip .alfred/docs', 'find .alfred -name "*.md"',
        'cd .alfred && ls', 'git status', "git commit -m 'note: the store stays out of git'", `echo .alfred/${FILE}.example`,
        `cat > notes.md <<'EOF'\nsource .alfred/${G}\nEOF`])
        assert.strictEqual(bash(dir, command), 0, command);
    const r = run({ tool_name: 'Bash', tool_input: { command: `source .alfred/${G}` }, cwd: dir, session_id: 'suite' });
    assert.match(r.stderr, /--with-sensitive/, 'the same refusal, naming the run that uses the values');
});

test(`--with-sensitive: the values are in the command's environment and each prints as <KEY>; the exit code is the command's [${FILE}]`, () =>
{
    const { dir } = project('wrap', { file: FILE });
    const out = wrapped(dir, node('out', 'API_TOKEN', 'DB_HOST', 'PORT'));
    assert.strictEqual(out.status, 0, out.stderr);
    assert.strictEqual(out.stdout.replace(/\r/g, ''), 'API_TOKEN=<API_TOKEN>\nDB_HOST=<DB_HOST>\nPORT=80\n', 'a value under 4 characters is not masked');
    assert.match(out.stderr, new RegExp(`3 value\\(s\\) from .*${RE(FILE)} in the environment \\(API_TOKEN, DB_HOST, PORT\\)`));
    assert.ok(!out.stderr.includes(TOKEN));
    const err = wrapped(dir, node('err', 'API_TOKEN'));
    assert.match(err.stderr, /API_TOKEN=<API_TOKEN>/, 'stderr is masked too');
    assert.ok(!err.stderr.includes(TOKEN), err.stderr);
    assert.strictEqual(wrapped(dir, node('exit', '3')).status, 3);
    const own = wrapped(dir, node('hex', 'API_TOKEN'), { API_TOKEN: 'from-the-shell' });
    assert.strictEqual(own.stdout.trim(), `API_TOKEN=${Buffer.from(TOKEN).toString('hex')}`, 'the run asked for the project\'s value: the file wins');
});
}

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

for (const FILE of NAMES)
{
test(`session start: the store's KEYS and the run that uses them, never a value; silent with none, an empty one, or garbage [${FILE}]`, () =>
{
    const { dir } = project('start', { file: FILE });
    const said = context(started(dir));
    assert.match(said, new RegExp(`^Sensitive data: \\.alfred/${RE(FILE)} holds API_TOKEN, DB_HOST, PORT - `));
    assert.match(said, /--with-sensitive -- "<command line>"/);
    // audit 2026-10-30 HK-20: no server gets the store since 2.10.1, so the line no longer tells the model a browser fills a KEY
    assert.doesNotMatch(said, /browser_type|browser_fill_form|browser server fills/, 'the stale browser sentence');
    for (const value of [TOKEN, 'db.internal']) assert.ok(!said.includes(value), said);
    for (const [name, text] of [['start-none', null], ['start-empty', ''], ['start-garbage', '\u0000\u0001 not a dotenv {"a":1}\n']])
    {
        const r = started(project(name, { text, file: FILE }).dir);
        assert.strictEqual(r.status, 0, name);
        assert.strictEqual(r.stdout, '', `${name}: ${r.stdout}`);
    }
});

test(`session start: a store git would commit is said - not ignored, or tracked; the data root's own .gitignore quiets it [${FILE}]`, () =>
{
    const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' });
    const { dir } = project('start-git', { file: FILE });
    git(dir, 'init', '-q');
    assert.match(context(started(dir)), new RegExp(`WARNING: git does not ignore \\.alfred/${RE(FILE)}`));
    fs.writeFileSync(path.join(dir, '.alfred', '.gitignore'), dataRoot.dataIgnoreText({ root: '.alfred', docsPath: '.alfred/docs' }));
    assert.doesNotMatch(context(started(dir)), /WARNING/, 'the root\'s own .gitignore covers it');
    git(dir, 'add', '-f', `.alfred/${FILE}`);
    assert.match(context(started(dir)), /WARNING: git does not ignore .*untrack it with git rm --cached/, 'a tracked store is said even under an ignore rule');
});

test(`session start and --with-sensitive: a custom data root, and a linked worktree reading its main checkout's store [${FILE}]`, () =>
{
    const custom = project('start-custom', { root: 'var/data', file: FILE });
    assert.match(context(started(custom.dir, { ALFRED_CODE_DATA_PATH: 'var/data' })), new RegExp(`^Sensitive data: var/data/${RE(FILE)} holds API_TOKEN`));
    assert.strictEqual(started(custom.dir).stdout, '', 'the default root holds none');
    assert.strictEqual(started(custom.dir, { ALFRED_CODE_DATA_PATH: '../outside' }).stdout, '', 'a root outside the project is never read');
    const git = (dir, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' });
    const { dir: main } = project('wt-main', { file: FILE });
    git(main, 'init', '-q');
    fs.writeFileSync(path.join(main, 'README.md'), 'x\n');
    git(main, 'add', 'README.md');
    git(main, 'commit', '-qm', 'x');
    fs.mkdirSync(path.join(main, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(main, '.claude', 'alfred-code.stamp'), 'sha: abc\n');
    const wt = path.join(TMP, `wt-linked${FILE}`);
    git(main, 'worktree', 'add', '-q', wt);
    assert.match(context(started(wt)), /holds API_TOKEN, DB_HOST, PORT/, 'a new worktree has no store of its own: the main checkout\'s is the one');
    assert.strictEqual(wrapped(wt, node('out', 'API_TOKEN')).stdout.trim(), 'API_TOKEN=<API_TOKEN>');
});

// The installer reads the store through data-root.js (the old credentials' clash check), the guard through its own parser
// and the workspace chain through secret-chain.js (the hooks ship apart from stack/mcp on the copy route): one fixture,
// one answer.
test(`sensitive data: the guard, secret-chain.js and data-root.js read one store the same way - BOM, CRLF, export, quotes, comments, = in a value [${FILE}]`, () =>
{
    const text = '\uFEFF# comment\r\nexport A_ONE="quoted value"\r\nB_TWO=\'single\'\r\n  C_THREE = spaced  \r\nD_URL=postgres://u:p@h/db?x=1\r\nE_EMPTY=\r\n;not a key\r\n';
    const { dir, file } = project('twin', { text, file: FILE });
    const read = dataRoot.storeValues(fs.readFileSync(file));
    assert.deepStrictEqual(read, { A_ONE: 'quoted value', B_TWO: 'single', C_THREE: 'spaced', D_URL: 'postgres://u:p@h/db?x=1', E_EMPTY: '' });
    assert.deepStrictEqual(secretChain.readStore(file), read, 'secret-chain.js reads the store as data-root.js does');
    const r = wrapped(dir, node('hex', ...Object.keys(read)));
    const guard = Object.fromEntries(r.stdout.trim().split(/\r?\n/).map((l) => l.split('=')).map(([k, hex]) => [k, Buffer.from(hex, 'hex').toString()]));
    assert.deepStrictEqual(guard, read, r.stderr);
    const utf16 = project('twin-utf16', { text: null, file: FILE });
    fs.writeFileSync(utf16.file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('K_ONE=wide value\r\n', 'utf16le')]));
    assert.deepStrictEqual(dataRoot.storeValues(fs.readFileSync(utf16.file)), { K_ONE: 'wide value' });
    assert.deepStrictEqual(secretChain.readStore(utf16.file), { K_ONE: 'wide value' });
    assert.strictEqual(wrapped(utf16.dir, node('hex', 'K_ONE')).stdout.trim(), `K_ONE=${Buffer.from('wide value').toString('hex')}`);
});

// Final review 2026-10-25 C1: a path to the store the resolver cannot follow - a `$(pwd)` or `$(git rev-parse ...)` prefix,
// a variable bound to one, a script's own string - and a find that hands the store to a reader passed and printed every
// value. The data-root path is a mention by its text now, and a find feeding a reader is judged by what it walks.
test(`final review C1: the store behind a computed prefix, or found and fed to a reader, is refused [${FILE}]`, () =>
{
    const { dir } = project('c1', { file: FILE });
    fs.mkdirSync(path.join(dir, '.alfred', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.alfred', 'docs', 'x.md'), '# x\n');
    // A `$(pwd)` / `$(git rev-parse --show-toplevel)` prefix resolves (the dump half's own gap, closed the same day), so a
    // print through one is the literal path's print: rewritten to the masked view, which prints no value of the store.
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    for (const command of [`cat "$(pwd)/.alfred/${FILE}"`, `cat "$(git rev-parse --show-toplevel)/.alfred/${FILE}"`,
        `awk -F= '{print $2}' "$(pwd)/.alfred/${FILE}"`, `grep -h . "$(pwd)/.alfred/${FILE}"`, `R=$(pwd); cat "$R/.alfred/${FILE}"`])
    {
        const r = run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' });
        assert.notStrictEqual(verdict(r), 0, `${command}: rewritten or refused, never run as written`);
        if (verdict(r) === 'rewrite')
        {
            const out = spawnSync('bash', ['-c', updated(r)], { cwd: dir, encoding: 'utf8' });
            for (const v of STORE_VALUES) assert.ok(!(out.stdout + out.stderr).includes(v), `${command}: the masked view printed a value`);
        }
    }
    for (const command of [`source "$(pwd)/.alfred/${FILE}"`,
        `python3 -c "import os; print(open(os.getcwd()+'/.alfred/${FILE}', 'r').read())"`,
        `find .alfred -name ${FILE} -exec cat {} +`, `find . -name '${FILE}' -exec cat {} \\;`, `find . -iname '${FILE.toUpperCase()}' -execdir cat {} +`,
        `find .alfred -name ${FILE} | xargs cat`, `cat $(find . -name ${FILE})`, `ls -a .alfred | grep ${FILE} | xargs -I{} cat .alfred/{}`,
        'find .alfred -type f -exec cat {} +', 'find .alfred -type f | xargs cat', 'find .alfred -type f -print0 | xargs -0 cat'])
        assert.strictEqual(bash(dir, command), 2, command);
    for (const command of [`test -f "$(pwd)/.alfred/${FILE}" && echo y`, `git check-ignore -q "$(git rev-parse --show-toplevel)/.alfred/${FILE}"`,
        `echo "$(pwd)/.alfred/${FILE}.example"`, "find . -name '*.md' -exec grep -l x {} +", "find .alfred -name '*.md' | xargs wc -l",
        'find . -type f | xargs wc -l', `find . -name ${FILE}.example -exec cat {} +`])
        assert.strictEqual(bash(dir, command), 0, command);
    // a walk stopped short of the data root - `.secrets` only: any mention of the legacy name but a look is refused
    if (FILE === '.secrets') assert.strictEqual(bash(dir, 'find . -maxdepth 1 -name .secrets -exec cat {} +'), 0, 'a -maxdepth short of the store');
});

// Final review 2026-10-25 C2: on a case-insensitive disk (macOS, Windows) `.alfred/.SECRETS` and `.ALFRED/.secrets` open
// the store, and the name compare was case-sensitive, so a Read, a Grep and a shell print of either passed.
const caseBlind = (() => { const d = fs.mkdtempSync(path.join(TMP, 'case-')); fs.writeFileSync(path.join(d, 'a'), ''); return fs.existsSync(path.join(d, 'A')); })();
test(`final review C2: a case variant of the store's name or its data root is the store on a case-insensitive disk [${FILE}]`, { skip: !caseBlind && 'a case-sensitive disk holds no such variant' }, () =>
{
    // no credential-shaped key, so only the name rule can catch it
    const { dir } = project('c2', { text: 'DB_HOST=db.internal\n', file: FILE });
    for (const rel of [`.alfred/${FILE.toUpperCase()}`, `.ALFRED/${FILE}`, `.Alfred/${FILE[0]}${FILE[1].toUpperCase()}${FILE.slice(2)}`])
    {
        const file = path.join(dir, rel);
        assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: file }, cwd: dir, session_id: 'suite' }).status, 2, `Read ${rel}`);
        assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'DB_HOST', path: file, output_mode: 'content' }, cwd: dir, session_id: 'suite' }).status, 2, `Grep ${rel}`);
        assert.notStrictEqual(bash(dir, `cat ${rel}`), 0, `cat ${rel}: rewritten or refused, never run as written`);
        assert.strictEqual(bash(dir, `source ${rel}`), 2, `source ${rel}`);
        assert.strictEqual(bash(dir, `cp ${rel} /tmp/x`), 2, `cp ${rel}`);
    }
});

// audit 2026-10-20 C17 (fabea019): after a refusal the model built the store's name in pieces; the dump and the copy then
// passed unjudged. A name assembled from literals the same command assigned resolves before either check.
test(`audit 2026-10-20 C17: a store name built by concatenation is masked when printed and refused when carried [${FILE}]`, () => {
    const { dir } = project('concat', { file: FILE });
    const built = `f="${FILE.slice(0, 5)}"; f="\${f}${FILE.slice(5)}"; `;
    const out = run({ tool_name: 'Bash', tool_input: { command: `${built}cat ".alfred/$f"` }, cwd: dir, session_id: 'suite' });
    assert.match(updated(out) || '', new RegExp(`--redacted ".*\\.alfred[\\\\/]${RE(FILE)}"`), 'the print becomes the masked view');
    assert.strictEqual(bash(dir, `${built}cp ".alfred/$f" /tmp/x`), 2, 'a copy is refused');
    assert.strictEqual(bash(dir, `${built}source ".alfred/$f"`), 2, 'a source is refused');
    assert.strictEqual(bash(dir, `${built}cp ".alfred/$f" /tmp/x; f=other`), 2, 'a later reassignment does not hide it');
    assert.strictEqual(bash(dir, `${built}git check-ignore -q ".alfred/$f"; echo ignored=$?`), 0, 'a look still passes (the evidence shape)');
    assert.strictEqual(bash(dir, `f="${FILE.slice(0, 5)}"; f="\${f}-notes"; cat ".alfred/$f" 2>/dev/null`), 0, 'another name built the same way is no store');
});

// Audit 2026-10-20 H3: a walk through the store and a diff of a tracked store printed every value raw - the stream masker
// had no store kind, though the session start says a printed value is masked. Now a line out of the store is masked by
// its path or its diff header, whatever its key, so the probe finds it and the stage is piped.
test(`H3: a walk through the store and a git stream of it mask every value [${FILE}]`, { skip: process.platform === 'win32' && 'sh pipeline' }, () =>
{
    const { dir } = project('h3-walk', { file: FILE });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const host = process.env.DB_HOST;\n');
    const sh = (command) => spawnSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8' });
    for (const command of ['grep -rn DB_HOST .', 'grep -rn internal .'])
    {
        const out = updated(run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' }));
        assert.ok(out && out.includes('--redact-stdin'), `${command}: the walk reaches the store, so it is piped - ${out}`);
        const r = sh(out);
        assert.ok(!r.stdout.includes('db.internal'), `${command}: printed raw - ${r.stdout}`);
        assert.match(r.stdout, new RegExp(`${RE(FILE)}:\\d+:DB_HOST=<set \\(11 chars\\)>`), r.stdout);
    }
    assert.strictEqual(bash(dir, 'grep -rn no_such_word_anywhere .'), 0, 'a walk that prints nothing of the store runs as written');
    // a store tracked by hand: the diff header names it, and every changed value is masked
    const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
    g('add', '-f', '.'); g('commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, '.alfred', FILE), STORE.replace('db.internal', 'db2.internal') + 'PLAIN line no pair\n');
    const out = updated(run({ tool_name: 'Bash', tool_input: { command: 'git diff' }, cwd: dir, session_id: 'suite' }));
    assert.ok(out && out.includes('--redact-stdin'), `a diff of the tracked store is piped - ${out}`);
    const r = sh(out);
    assert.ok(!/db2?\.internal|PLAIN line/.test(r.stdout) && !r.stdout.includes(TOKEN), r.stdout);
    assert.match(r.stdout, /^\+DB_HOST=<set \(12 chars\)>$/m, r.stdout);
    assert.match(r.stdout, /^\+<sensitive-data line>$/m, r.stdout);
});
}

// Workspace layering, release 2 (AC19, AC20): a joined child reads each linked ancestor's store after its own - the nearest
// value of a key wins - and every store in the chain is denied by real path whether or not its values flow (the kill switch
// stops the values, never the deny). `spec` maps a folder to { file, store, data, local } as secret-chain.test.js's tree.
const wsTree = (spec) =>
{
    const top = fs.realpathSync(fs.mkdtempSync(path.join(TMP, 'ws-')));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        const data = path.join(dir, ...(o.data || '.alfred').split('/'));
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(data, { recursive: true });
        if (o.file !== undefined) fs.writeFileSync(path.join(data, 'workspace'), o.file);
        if (o.store !== undefined) fs.writeFileSync(path.join(data, '.secrets'), o.store);
        if (o.local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), o.local);
    }
    return (rel = '.') => path.join(top, ...rel.split('/'));
};
const CUSTOM = { data: 'var/data', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) };
// The workspace is on by default since 3.0.0 (D9); the chain cases still pin it, so a launch 0 in the caller's env cannot freeze them.
const WS_ON = { ALFRED_CODE_WORKSPACE: '1' };
const wsThree = (extra = {}) => wsTree({
    'ws': { file: 'child api\n', store: 'A=root-a-value\nB=root-b-value\n', ...extra.ws },
    'ws/api': { file: 'parent ..\nchild tool\n', store: 'A=child-a-value\n', ...extra.api },
    'ws/api/tool': { file: 'parent ..\n', ...extra.tool },
});
const hex = (s) => Buffer.from(s).toString('hex');

test('workspace chain: --with-sensitive gives the chain\'s values, nearest first, and masks a parent\'s value (AC20)', () =>
{
    const at = wsThree();
    const out = wrapped(at('ws/api'), node('out', 'A', 'B'), WS_ON);
    assert.strictEqual(out.status, 0, out.stderr);
    assert.strictEqual(out.stdout.replace(/\r/g, ''), 'A=<A>\nB=<B>\n', 'the parent\'s B is masked like the child\'s own A');
    assert.strictEqual(wrapped(at('ws/api'), node('hex', 'A', 'B'), WS_ON).stdout.replace(/\r/g, ''), `A=${hex('child-a-value')}\nB=${hex('root-b-value')}\n`, 'the nearest A wins');
    assert.match(out.stderr, /2 value\(s\) in the environment/);
    assert.match(out.stderr, /\.alfred\/\.secrets: A\b/);
    assert.match(out.stderr, /\.\.\/\.alfred\/\.secrets: B\b/);
    for (const value of ['child-a-value', 'root-a-value', 'root-b-value']) assert.ok(!out.stderr.includes(value), out.stderr);
    const tool = wrapped(at('ws/api/tool'), node('hex', 'A', 'B'), WS_ON);
    assert.strictEqual(tool.stdout.replace(/\r/g, ''), `A=${hex('child-a-value')}\nB=${hex('root-b-value')}\n`, 'a grandchild with no store of its own reads both ancestors');
});

test('workspace chain: a Read of the parent\'s store is denied from the child, at the default and at a custom data root', () =>
{
    const at = wsThree();
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: path.join(at('ws'), '.alfred', '.secrets') }, cwd: at('ws/api'), session_id: 'suite' }).status, 2);
    const custom = wsThree({ ws: CUSTOM });
    const store = path.join(custom('ws'), 'var', 'data', '.secrets');
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: store }, cwd: custom('ws/api'), session_id: 'suite' }).status, 2, 'a parent\'s custom root is the store by real path');
    assert.strictEqual(run({ tool_name: 'Grep', tool_input: { pattern: 'A', path: store, output_mode: 'content' }, cwd: custom('ws/api'), session_id: 'suite' }).status, 2);
});

test('workspace chain: a shell command naming the parent\'s store is refused or masked', () =>
{
    const at = wsThree();
    assert.notStrictEqual(bash(at('ws/api'), 'cat ../.alfred/.secrets'), 0);
    assert.strictEqual(bash(at('ws/api'), 'source ../.alfred/.secrets'), 2);
    const custom = wsThree({ ws: CUSTOM });
    assert.notStrictEqual(bash(custom('ws/api'), 'cat ../var/data/.secrets'), 0, 'a dump of the parent\'s custom-root store is the masked view or refused');
    assert.strictEqual(bash(custom('ws/api'), 'source ../var/data/.secrets'), 2);
    assert.strictEqual(bash(custom('ws/api'), 'cp ../var/data/.secrets /tmp/out'), 2);
    assert.strictEqual(bash(custom('ws/api'), 'ls -la ../var/data'), 0, 'a look passes');
});

test('workspace chain: the SessionStart line names each source\'s keys and no value', () =>
{
    const at = wsThree();
    const said = context(started(at('ws/api'), WS_ON));
    assert.match(said, /^Sensitive data: \.alfred\/\.secrets holds A; from \.\.: B - kept out of the chat/);
    assert.match(said, /--with-sensitive -- "<command line>"/);
    for (const value of ['child-a-value', 'root-a-value', 'root-b-value']) assert.ok(!said.includes(value), said);
    assert.match(context(started(at('ws/api/tool'), WS_ON)), /^Sensitive data: from \.\.: A; from \.\.\/\.\.: B - kept out of the chat/, 'a child with only ancestors\' stores gets the from-only line');
    assert.match(context(started(at('ws'), WS_ON)), /^Sensitive data: \.alfred\/\.secrets holds A, B - kept out of the chat/, 'the root holds only its own: today\'s line');
});

test('workspace chain: a tree verb or find reaching a parent store is refused, at the default and a custom data root', () =>
{
    for (const extra of [{}, { ws: CUSTOM }])
    {
        const at = wsThree({ api: { store: undefined }, ...extra });
        const root = extra.ws ? '../var/data' : '../.alfred';
        for (const command of [`tar cf - ${root}`, `cp -R ${root} x`, `find ${root} -exec cat {} \;`, `ls -a ${root} | grep .secrets | xargs cat`, 'tar cf - ..', 'zip -r out.zip ..'])
            assert.strictEqual(bash(at('ws/api'), command), 2, `${root}: ${command}`);
        assert.strictEqual(bash(at('ws/api'), `tar cf - .. --exclude ${root.slice(3)}`), 0, 'an exclusion of the parent\'s data root passes');
    }
});

test('workspace chain: under the kill switch the parent\'s values do not flow, and a Read or cat of the parent\'s store is still denied', () =>
{
    for (const [how, env, local] of [['settings', {}, JSON.stringify({ env: { ALFRED_CODE_WORKSPACE: '0' } })], ['env', { ALFRED_CODE_WORKSPACE: '0' }, undefined]])
    {
        const at = wsThree({ ws: CUSTOM, api: { local } });
        const out = wrapped(at('ws/api'), node('hex', 'A', 'B'), env);
        assert.strictEqual(out.stdout.replace(/\r/g, ''), `A=${hex('child-a-value')}\nB=\n`, `${how}: the parent's B does not flow`);
        const store = path.join(at('ws'), 'var', 'data', '.secrets');
        assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: store }, cwd: at('ws/api'), session_id: 'suite' }, env).status, 2, `${how}: the Read is denied by real path`);
        assert.notStrictEqual(verdict(run({ tool_name: 'Bash', tool_input: { command: 'cat ../var/data/.secrets' }, cwd: at('ws/api'), session_id: 'suite' }, env)), 0, `${how}: the cat is masked or refused`);
        assert.match(context(started(at('ws/api'), env)), /^Sensitive data: \.alfred\/\.secrets holds A - /, `${how}: the start line names the project's own keys alone`);
    }
});

// GitHub's Windows runner, 2026-10-27: its temp dir is the 8.3 `RUNNER~1`, which the JS realpath keeps while the workspace
// chain's native one expands it, so a parent's store read through the short spelling matched no store and passed. The
// tree's top (`ws-XXXXXX`, past eight characters) has a short name wherever the volume makes them.
const shortName = (p) =>
{
    if (process.platform !== 'win32') return p;
    // verbatim: Node's own quoting of the inner quotes is not cmd's
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : p;
};
const shortAlias = (at, rel = '.') => path.join(shortName(at()), ...rel.split('/'));
const hasShort = (at) => shortAlias(at) !== at() && fs.existsSync(shortAlias(at));
test('workspace chain: a parent\'s store reached through its 8.3 short name is still the store', { skip: !hasShort(wsTree({ x: {} })) && 'no 8.3 short names here' }, () =>
{
    const custom = wsThree({ ws: CUSTOM });
    const store = path.join(shortAlias(custom, 'ws'), 'var', 'data', '.secrets');
    assert.strictEqual(run({ tool_name: 'Read', tool_input: { file_path: store }, cwd: shortAlias(custom, 'ws/api'), session_id: 'suite' }).status, 2, 'the Read is denied by real path');
    assert.strictEqual(bash(shortAlias(custom, 'ws/api'), 'tar cf - ../var/data'), 2, 'a tree verb reaching it is refused');
    const at = wsThree();
    const out = wrapped(shortAlias(at, 'ws/api'), node('out', 'A', 'B'), WS_ON);
    assert.strictEqual(out.status, 0, out.stderr);
    assert.match(out.stderr, /\.\.\/\.alfred\/\.secrets: B\b/, 'the parent is named from the child, not from the disk\'s root');
});

// R9 (AC21): the runner passes a server's stdout unmasked and secret-chain.js returns the values raw, so a command line
// naming either, whatever its path, is refused and pointed to --with-sensitive. Only the store refusal's looks pass.
const shellVerdict = (tool, cwd, command) => verdict(run({ tool_name: tool, tool_input: { command }, cwd, session_id: 'suite' }));
test('workspace chain: a Bash, PowerShell or Monitor command naming secrets-run.js is denied, pointing to --with-sensitive (R9)', () =>
{
    const { dir } = project('engine-run', { file: '.secrets' });
    for (const command of ['node .claude/hooks/secrets-run.js -- x', '.claude/hooks/secrets-run.js -- x', 'bash -c \'node .claude/hooks/secrets-run.js -- x\'',
        'cp .claude/hooks/secrets-run.js r.js', 'git diff stack/hooks/secrets-run.js', 'NODE_OPTIONS= node "/abs/path/secrets-run.js" -- npx server'])
        for (const tool of ['Bash', 'PowerShell', 'Monitor']) assert.strictEqual(shellVerdict(tool, dir, command), 2, `${tool}: ${command}`);
    const r = run({ tool_name: 'Bash', tool_input: { command: 'node .claude/hooks/secrets-run.js -- x' }, cwd: dir, session_id: 'suite' });
    assert.match(r.stderr, /--with-sensitive -- "<command line>"/);
    assert.match(r.stderr, /secrets-run\.js/);
});

test('workspace chain: a command naming secret-chain.js is denied, inline or in a runtime heredoc (R9)', () =>
{
    const { dir } = project('engine-chain', { file: '.secrets' });
    for (const command of [`node -e "console.log(require('./.claude/hooks/secret-chain.js').chainOf('.').values)"`,
        `node <<'EOF'\nconsole.log(require('./.claude/hooks/secret-chain.js').chainOf('.').values)\nEOF`,
        `python3 - <<'EOF'\nimport subprocess; print(subprocess.run(['node', '-e', "require('./stack/hooks/secret-chain.js')"]))\nEOF`])
        assert.strictEqual(bash(dir, command), 2, command);
});

test('workspace chain: the looks list passes a command naming either engine (R9)', () =>
{
    const { dir } = project('engine-looks', { file: '.secrets' });
    for (const name of ['secrets-run.js', 'secret-chain.js'])
        for (const command of [`ls -l .claude/hooks/${name}`, `stat .claude/hooks/${name}`, `wc -l .claude/hooks/${name}`, `test -f .claude/hooks/${name} && echo yes`,
            `git ls-files .claude/hooks/${name}`, `echo ${name}`, `cat > notes.md <<'EOF'\nthe launcher is ${name}\nEOF`])
            assert.strictEqual(bash(dir, command), 0, command);
    assert.strictEqual(bash(dir, 'node scripts/workspace.js status'), 0);
    assert.strictEqual(bash(dir, 'node --test scripts/secrets-run.test.js'), 0, 'a test file named after the runner is not the runner');
    assert.strictEqual(bash(dir, 'ls .claude/hooks/secrets-run.js | xargs -I{} node {} -- server'), 2, 'a look piped on is a use');
    assert.strictEqual(bash(dir, 'node $(ls .claude/hooks/secret-chain.js) x'), 2);
});
