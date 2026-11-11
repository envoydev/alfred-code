#!/usr/bin/env node
// Suite for the project's sensitive data in stack/hooks/guard-secret-value.js: `<data root>/.sensitive-data`, a dotenv the
// user fills by hand (the user's ruling of 2026-10-13). Its values are kept out of the chat by accident - a Read is blocked, a
// copy, link, archive or add of it is refused (the store check), what a shell read of it printed comes back masked, and
// where no masker runs any command naming it is refused (the core; swap 1, 2026-11-11) - and a command that needs them runs through
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
const { putWorkspace } = require('./workspace-fixture.js');
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
const shellVerdict = (tool, cwd, command) => verdict(run({ tool_name: tool, tool_input: { command }, cwd, session_id: 'suite' }));
// `bash` above names no transcript: the guard's core mode, where no masker runs. `above` is a foreground Bash call on a
// client at the masker's floor - judged by the store check and the three denies alone, never rewritten.
const FLOOR = path.join(TMP, 'floor.jsonl');
fs.writeFileSync(FLOOR, JSON.stringify({ type: 'user', entrypoint: 'cli', version: '2.1.322' }) + '\n');
const above = (cwd, command) =>
{
    const r = run({ tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'suite', transcript_path: FLOOR });
    assert.ok(!/updatedInput/.test(r.stdout), `no rewrite: ${command}`);
    return r.status;
};
// What the model gets of `stdout` after the run: the masker's answer, or the text as printed when it masked nothing.
const SANDBOX_HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
const masked = (cwd, command, stdout, env = {}) =>
{
    const r = run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, cwd, session_id: 'suite',
        tool_response: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } },
    { CLAUDE_PROJECT_DIR: cwd, HOME: SANDBOX_HOME, USERPROFILE: SANDBOX_HOME, CLAUDE_CONFIG_DIR: path.join(SANDBOX_HOME, '.claude'), ...env });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput.stdout : stdout;
};
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

test(`sensitive data: a shell read of the store runs above the masker's floor, its output masked; where no masker runs it is refused [${FILE}]`, () =>
{
    const { dir, file } = project('dump', { file: FILE });
    for (const command of [`cat "${file}"`, `head -5 "${file}"`, `grep API "${file}"`, `cat "${file}" | sort`])
    {
        assert.strictEqual(above(dir, command), 0, `${command}: runs as written`);
        const r = run({ tool_name: 'Bash', tool_input: { command }, cwd: dir, session_id: 'suite' });
        assert.strictEqual(r.status, 2, `${command}: refused in core mode`);
        assert.match(r.stderr, /--presence/, command);
    }
    const shown = masked(dir, `cat "${file}"`, STORE);
    for (const value of STORE_VALUES) assert.ok(!shown.includes(value), `${value} in the masked output:\n${shown}`);
    assert.match(shown, /DB_HOST=<set \(11 chars\)>/, 'every value of the store is masked, whatever its key');
    const view = spawnSync(process.execPath, [HOOK, '--redacted', file], { encoding: 'utf8' });
    assert.strictEqual(view.status, 0, view.stderr);
    for (const value of [TOKEN, 'db.internal']) assert.ok(!view.stdout.includes(value), `${value} in the redacted view:\n${view.stdout}`);
    assert.match(view.stdout, /API_TOKEN=/);
    assert.match(view.stdout, /DB_HOST=/);
    const keys = spawnSync(process.execPath, [HOOK, '--presence', file], { encoding: 'utf8' });
    assert.match(keys.stdout, /API_TOKEN/);
    assert.ok(!keys.stdout.includes(TOKEN), keys.stdout);
});

test(`sensitive data: a copy, a move, a link or an add of the store is refused on every host; a read of it only where no masker runs [${FILE}]`, () =>
{
    const { dir, file } = project('mention', { file: FILE });
    const rel = `.alfred/${FILE}`;
    // the store check, whatever the client: the values would land where the chat can read
    for (const command of [`cp ${rel} /tmp/out`, `git add ${rel}`, `mv ${rel} /tmp/out`, `ln -s ${rel} env.local`])
        for (const at of [above, bash]) assert.strictEqual(at(dir, command), 2, command);
    // above the masker's floor a read runs as written - what it prints comes back masked
    for (const command of [`source ${rel}`, `. ./${rel} && ./deploy.sh`, `export $(xargs < ${rel})`, `test -f ${rel} && echo yes`, `ls -la ${rel}`, `wc -l ${rel}`,
        `grep -c prod ${rel} && npm run build`, `git check-ignore -q ${rel} || echo NOT-IGNORED`, `echo "keys live in ${rel}"`])
        assert.strictEqual(above(dir, command), 0, command);
    // core mode: any command whose words name the store is refused, a look included (swap 1 ruling 3's stated cost)
    for (const command of [`source ${rel}`, `cat ${rel}`, `ls -la ${rel}`, `wc -l ${rel}`, `export $(xargs < ${rel})`, `git check-ignore -q ${rel}`, `bash -c 'source ${rel}'`])
        assert.strictEqual(bash(dir, command), 2, command);
    // text that is no word naming it, the data root itself and the guard's own modes pass there too
    for (const command of ['ls -la .alfred', `echo ${rel}.example`, `echo "keys live in ${rel}"`, `git commit -m 'fix the ${rel} reader'`,
        `cat >> plan.md <<'EOF'\n- the deploy reads DB_HOST from ${rel} (names only)\nEOF`,
        `node "${HOOK}" --presence "${file}"`, `node "${HOOK}" --with-sensitive -- "npm run deploy"`])
        assert.strictEqual(bash(dir, command), 0, command);
    const r = run({ tool_name: 'Bash', tool_input: { command: `cp ${rel} /tmp/out` }, cwd: dir, session_id: 'suite' });
    assert.match(r.stderr, /--with-sensitive/, 'the refusal names the run that uses the values');
});


// Audit 2026-10-14 HK11 (replays sens.js, sens2.js): the refusal read the literal name only, so a glob, a quoted split or the
// folder holding the store passed. The store check resolves each spelling; an ordinary command on the data root passes.
test(`sensitive data: the store check resolves a glob, a quoted split, a brace list, a cd and a symlink, and refuses a tree verb over the store's folder (HK11) [${FILE}]`, () =>
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
    fs.symlinkSync(path.join(dir, '.alfred', FILE), path.join(dir, 'env.link'));
    for (const command of [`git add -f .alfred/${G}`, 'tar cf - .alfred | tar xOf -', 'tar cf - .alfred | tar tvf -', 'zip -r /tmp/a.zip .alfred && unzip -p /tmp/a.zip',
        'cp -r .alfred /tmp/bk', 'rsync -a .alfred/ /tmp/bk/', 'cd .alfred && git add -f .', `ln -s .alfred/${G} env.local`, `mv .alfred/${BRACE} /tmp/`,
        `cp .alfred/'${FILE}' /tmp/x`, `cp .alfred/${SPLIT} /tmp/x`, `bash -c 'cp .alfred/${G} /tmp/x'`, 'cp env.link /tmp/x'])
        for (const at of [above, bash]) assert.strictEqual(at(dir, command), 2, command);
    // a read through any of those spellings runs above the floor (masked after) and is refused where no masker runs
    for (const command of [`source .alfred/${G}`, `set -a; . .alfred/${G}; set +a; npm run migrate`, `docker compose --env-file=.alfred/${G} up`,
        `cat .alfred/'${FILE}'`, `cat .alfred/${SPLIT}`, 'source env.link', `cd .alfred && source ${G}`])
    {
        assert.strictEqual(above(dir, command), 0, command);
        assert.strictEqual(bash(dir, command), 2, `core: ${command}`);
    }
    for (const command of ['ls -la .alfred', 'git add .', 'git add -A', 'git add .alfred/docs/x.md',
        'tar czf /tmp/src.tgz src', 'cp -r src /tmp/src-copy', 'cp .alfred/docs/x.md /tmp/', 'zip -r /tmp/docs.zip .alfred/docs', 'find .alfred -name "*.md"',
        'cd .alfred && ls', 'git status', "git commit -m 'note: the store stays out of git'", `echo .alfred/${FILE}.example`,
        `cat > notes.md <<'EOF'\nsource .alfred/${G}\nEOF`])
        for (const at of [above, bash]) assert.strictEqual(at(dir, command), 0, command);
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
// passed unjudged. A name assembled from literals the same command assigned is expanded by the shared reader first.
test(`audit 2026-10-20 C17: a store name built by concatenation is the store - refused when carried, and when read where no masker runs [${FILE}]`, () => {
    const { dir } = project('concat', { file: FILE });
    const built = `f="${FILE.slice(0, 5)}"; f="\${f}${FILE.slice(5)}"; `;
    assert.strictEqual(bash(dir, `${built}cat ".alfred/$f"`), 2, 'core: the print is refused');
    assert.strictEqual(above(dir, `${built}cat ".alfred/$f"`), 0, 'above the floor it runs, and the store\'s values are masked after');
    for (const at of [above, bash])
    {
        assert.strictEqual(at(dir, `${built}cp ".alfred/$f" /tmp/x`), 2, 'a copy is refused');
        assert.strictEqual(at(dir, `${built}cp ".alfred/$f" /tmp/x; f=other`), 2, 'a later reassignment does not hide it');
        assert.strictEqual(at(dir, `f="${FILE.slice(0, 5)}"; f="\${f}-notes"; cat ".alfred/$f" 2>/dev/null`), 0, 'another name built the same way is no store');
    }
});

// Audit 2026-10-20 H3: a walk through the store and a diff of a tracked store printed every value raw. Since swap 1 both
// run as written and the masker reads what they printed: a line out of the store is masked by its path or its diff
// header, whatever its key.
test(`H3: a walk through the store and a git stream of it come back with every value masked [${FILE}]`, { skip: process.platform === 'win32' && 'sh pipeline' }, () =>
{
    const { dir } = project('h3-walk', { file: FILE });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const host = process.env.DB_HOST;\n');
    const printed = (command) => spawnSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8' }).stdout;
    for (const command of ['grep -rn DB_HOST .', 'grep -rn internal .'])
    {
        assert.strictEqual(above(dir, command), 0, `${command}: runs as written`);
        const out = masked(dir, command, printed(command));
        assert.ok(!out.includes('db.internal'), `${command}: printed raw - ${out}`);
        assert.match(out, new RegExp(`${RE(FILE)}:\\d+:DB_HOST=<set \\(11 chars\\)>`), out);
    }
    const clean = printed('grep -rn process.env .');
    assert.strictEqual(masked(dir, 'grep -rn process.env .', clean), clean, 'a walk that prints nothing of the store comes back as printed');
    // a store tracked by hand: the diff header names it, and every changed value is masked
    const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
    g('add', '-f', '.'); g('commit', '-qm', 'init');
    fs.writeFileSync(path.join(dir, '.alfred', FILE), STORE.replace('db.internal', 'db2.internal') + 'PLAIN line no pair\n');
    assert.strictEqual(above(dir, 'git diff'), 0, 'the diff runs as written');
    const out = masked(dir, 'git diff', printed('git diff'));
    assert.ok(!/db2?\.internal|PLAIN line/.test(out) && !out.includes(TOKEN), out);
    assert.match(out, /^\+DB_HOST=<set \(12 chars\)>$/m, out);
    assert.match(out, /^\+<sensitive-data line>$/m, out);
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
        if (o.record !== undefined) putWorkspace(dir, o.record, { dataRoot: o.data || '.alfred' });
        if (o.store !== undefined) fs.writeFileSync(path.join(data, '.secrets'), o.store);
        if (o.local !== undefined) fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), o.local);
    }
    return (rel = '.') => path.join(top, ...rel.split('/'));
};
const CUSTOM = { data: 'var/data', local: JSON.stringify({ env: { ALFRED_CODE_DATA_PATH: 'var/data' } }) };
// The workspace is on by default since 3.0.0 (D9); the chain cases still pin it, so a launch 0 in the caller's env cannot freeze them.
const WS_ON = { ALFRED_CODE_WORKSPACE: '1' };
const wsThree = (extra = {}) => wsTree({
    'ws': { record: { children: ['api'] }, store: 'A=root-a-value\nB=root-b-value\n', ...extra.ws },
    'ws/api': { record: { parent: '..', children: ['tool'] }, store: 'A=child-a-value\n', ...extra.api },
    'ws/api/tool': { record: { parent: '..' }, ...extra.tool },
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

test('workspace chain: a tree verb reaching a parent store is refused, at the default and a custom data root', () =>
{
    for (const extra of [{}, { ws: CUSTOM }])
    {
        const at = wsThree({ api: { store: undefined }, ...extra });
        const root = extra.ws ? '../var/data' : '../.alfred';
        for (const command of [`tar cf - ${root}`, `cp -R ${root} x`, 'tar cf - ..', 'zip -r out.zip ..'])
            for (const how of [above, bash]) assert.strictEqual(how(at('ws/api'), command), 2, `${root}: ${command}`);
        assert.strictEqual(above(at('ws/api'), `tar cf - .. --exclude ${root.slice(3)}`), 0, 'an exclusion of the parent\'s data root passes');
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

// R9 / SG1 rule 2 (the engine refusal: a run, a copy or a feed of the launcher or the chain reader) left with the shell
// judging in swap 1 (ruling 1): above the masker's floor a run of one is a command like any other, its output masked;
// in core mode a command naming one is refused - pinned in guard-secret-value.test.js ('swap 1 core: the store, the key
// file and an engine are names the core refuses').



test('SG1 D2: the key file is guarded by name - a Read, a Grep, a copy of it and, where no masker runs, any command naming it', () => {
  const KEY = ['.mcps-sec', 'rets'].join('');
  const dir = fs.mkdtempSync(path.join(TMP, 'd2-'));
  const home = fs.mkdtempSync(path.join(TMP, 'd2home-'));
  for (const d of [path.join(dir, '.alfred'), path.join(dir, '.companion'), path.join(home, '.companion')]) {
    fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, KEY), 'DB_HOST=db.internal\nCONTEXT7_API_KEY=\n');
  }
  const env = { HOME: home, USERPROFILE: home };
  const call = (tool_name, tool_input, extra = {}) => run({ tool_name, tool_input, cwd: dir, session_id: 'suite', ...extra }, env);
  const floor = { transcript_path: FLOOR };
  assert.equal(call('Read', { file_path: path.join(dir, '.alfred', KEY) }).status, 2, 'Read: DB_HOST alone is guarded in the key file');
  assert.equal(call('Grep', { pattern: 'DB', path: path.join(dir, '.alfred', KEY), output_mode: 'content' }).status, 2);
  // a copy or a move of it is the store check's, on every host
  for (const c of [`cp .alfred/${KEY} copy.txt`, `cp .companion/${KEY} k.txt`, `mv .alfred/${KEY} x`])
    for (const extra of [floor, {}]) assert.equal(call('Bash', { command: c }, extra).status, 2, c);
  const msg = call('Bash', { command: `cp .alfred/${KEY} copy.txt` }, floor).stderr;
  assert.match(msg, /key file/); assert.match(msg, /--presence/); assert.doesNotMatch(msg, /--with-sensitive/);
  // a read of it - a find handing it to a reader included - runs above the floor, and the masker reads what it printed:
  // every value of a key file the command names or the data root holds, whatever its key
  for (const c of [`cat .alfred/${KEY}`, `source .alfred/${KEY}`, `find ~/.companion -name ${KEY} -exec cat {} +`, `find . -name ${KEY} | xargs cat`, `cat $(find . -name ${KEY})`]) {
    assert.equal(call('Bash', { command: c }, floor).status, 0, c);
    const after = run({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: c }, cwd: dir, session_id: 'suite',
      tool_response: { stdout: 'DB_HOST=db.internal\n', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } }, env);
    assert.equal(JSON.parse(after.stdout).hookSpecificOutput.updatedToolOutput.stdout, 'DB_HOST=<set (11 chars)>\n', `masked after the run: ${c}`);
  }
  // where no masker runs, a command whose words name it is refused, pointed to --presence
  for (const c of [`cat .alfred/${KEY}`, `source .alfred/${KEY}`]) {
    const r = call('Bash', { command: c });
    assert.equal(r.status, 2, c);
    assert.match(r.stderr, /--presence/, c);
  }
  // D2's narrow pin: script text naming the key file is never refused for the name, on either route
  fs.mkdirSync(path.join(dir, 'scripts')); fs.writeFileSync(path.join(dir, 'scripts', 'keys.js'), `const f = '${KEY}';\n`);
  for (const c of [`grep -rn '${KEY}' scripts`, 'sed -n 1,40p scripts/keys.js', `cat >> scripts/keys.test.js <<'EOF'\npath.join(dir, '${KEY}')\nEOF`,
    `python3 - <<'EOF'\np='scripts/keys.js'; s=open(p).read(); open(p,'w').write(s.replace('${KEY}', '${KEY}'))\nEOF`,
    `grep -rl '${KEY}' scripts | xargs sed -i 's/x/y/'`])
    for (const extra of [floor, {}]) assert.equal(call('Bash', { command: c }, extra).status, 0, c);
});

