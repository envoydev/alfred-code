'use strict';
// Workspace versioning, task 6 (D4 / D8): the agent-folder pass - `local` keeps `.claude` and `.cursor` out of git through
// one `.gitignore` each - and uninstall taking the stack's texts back. The pure table first, then the pass on temp
// repositories, then whole installer runs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const rt = require('./install/runtime.js');
const { folderPlan } = require('./install/agent-folders/plan.js');
const { apply } = require('./install/agent-folders/effects.js');
const { trackedNotice, ownNotice } = require('./install/agent-folders/constants.js');
const variables = require('./install/variables.js');
const docs = require('./install/docs.js');
const { CLAUDE_IGNORE, CLAUDE_VERSIONING_IGNORE, CURSOR_VERSIONING_IGNORE } = require('../stack/mcp/data-root.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-folders-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let seq = 0;
const project = ({ repo = true } = {}) =>
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(root, { recursive: true });
    if (repo) git(root, 'init', '-q');
    return fs.realpathSync.native(root);
};
const read = (root, ...rel) => { try { return fs.readFileSync(path.join(root, ...rel), 'utf8'); } catch { return null; } };
const put = (root, rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const run = (root, { scope = 'project', versioning = 'local', told = [], created = [], second = false } = {}) =>
{
    const lines = [];
    const record = apply({ projectRoot: root, claudeDir: path.join(root, '.claude'), scope, log: (l) => lines.push(l), rt, told, created }, { versioning, second });
    return { lines, ...record };
};

const PLAN = { folder: '.claude', scope: 'project', versioning: 'local', have: null, tracked: false, inRepo: true, told: [], created: [] };
const PLAN_TABLE = [
    ['local scope keeps today\'s text on .claude', { scope: 'local', versioning: 'local' }, { action: 'write', text: CLAUDE_IGNORE }],
    ['local scope with versioning git still keeps today\'s text', { scope: 'local', versioning: 'git' }, { action: 'write', text: CLAUDE_IGNORE }],
    ['project + local writes the versioning text on .claude', {}, { action: 'write', text: CLAUDE_VERSIONING_IGNORE }],
    ['project + local writes the versioning text on .cursor', { folder: '.cursor' }, { action: 'write', text: CURSOR_VERSIONING_IGNORE }],
    ['user scope + local writes both too', { scope: 'user', folder: '.cursor' }, { action: 'write', text: CURSOR_VERSIONING_IGNORE }],
    ['local scope + local writes the versioning text on .cursor too', { scope: 'local', folder: '.cursor' }, { action: 'write', text: CURSOR_VERSIONING_IGNORE }],
    ['local scope + git writes nothing on .cursor', { scope: 'local', versioning: 'git', folder: '.cursor' }, { action: 'keep' }],
    ['project + git removes the stack text', { versioning: 'git', have: CLAUDE_VERSIONING_IGNORE }, { action: 'remove', dir: false }],
    ['project + git removes the old local scope text', { versioning: 'git', have: CLAUDE_IGNORE }, { action: 'remove', dir: false }],
    ['project + git with no file does nothing', { versioning: 'git' }, { action: 'keep' }],
    ['project + git keeps anything else', { versioning: 'git', have: `${CLAUDE_VERSIONING_IGNORE}!keep.md\n` }, { action: 'keep' }],
    ['an unknown versioning (null) with no file writes nothing', { versioning: null }, { action: 'keep' }],
    ['an unknown versioning (null) keeps a stack text on .claude', { versioning: null, have: CLAUDE_VERSIONING_IGNORE }, { action: 'keep' }],
    ['an unknown versioning (null) keeps the recorded .cursor and its stack text', { folder: '.cursor', versioning: null, have: CURSOR_VERSIONING_IGNORE, created: ['.cursor'] }, { action: 'keep' }],
    ['an unknown versioning (null) keeps the old local scope text at project scope', { versioning: null, have: CLAUDE_IGNORE }, { action: 'keep' }],
    ['an unknown versioning (null) at local scope still writes a local install\'s own text', { scope: 'local', versioning: null }, { action: 'write', text: CLAUDE_IGNORE }],
    ['a removed .cursor the stack made is flagged for its folder', { folder: '.cursor', versioning: 'git', have: CURSOR_VERSIONING_IGNORE, created: ['.cursor'] }, { action: 'remove', dir: true }],
    ['a scope change rewrites one stack text as the other', { have: CLAUDE_IGNORE }, { action: 'write', text: CLAUDE_VERSIONING_IGNORE }],
    ['the wanted text already there is kept', { have: CLAUDE_VERSIONING_IGNORE }, { action: 'keep' }],
    ['tracked and not told: tell with the exact notice', { tracked: true }, { action: 'tell', line: '!! .claude: git tracks files under it - versioning local cannot hide it; untrack them (git rm -r --cached .claude) to keep it out', entry: '.claude' }],
    ['tracked and told: keep', { tracked: true, told: ['.claude'] }, { action: 'keep' }],
    ['not in a repository: keep', { inRepo: false }, { action: 'keep' }],
    ['the stack\'s first line plus one more is the user\'s: kept and named once', { have: `${CLAUDE_VERSIONING_IGNORE}!shared.md\n` }, { action: 'tell', line: ownNotice('.claude'), entry: 'own:.claude' }],
    ['a user file at .cursor is kept and named once', { folder: '.cursor', have: '*.log\n' }, { action: 'tell', line: ownNotice('.cursor'), entry: 'own:.cursor' }],
    ['a user file already named is kept silently', { folder: '.cursor', have: '*.log\n', told: ['own:.cursor'] }, { action: 'keep' }],
    ['a user file is not named where the stack would write nothing', { versioning: 'git', have: '*.log\n' }, { action: 'keep' }],
];
for (const [name, input, expected] of PLAN_TABLE)
    test(`folderPlan: ${name}`, () => assert.deepStrictEqual(folderPlan({ ...PLAN, ...input }), expected));

test('folderPlan: the notice is the one the brief names, per folder', () =>
{
    assert.strictEqual(trackedNotice('.cursor'), '!! .cursor: git tracks files under it - versioning local cannot hide it; untrack them (git rm -r --cached .cursor) to keep it out');
});

test('folderPlan: at local scope a notice on .claude names the local install, not versioning local', () =>
{
    const tracked = folderPlan({ ...PLAN, scope: 'local', versioning: 'git', tracked: true });
    assert.strictEqual(tracked.line, '!! .claude: git tracks files under it - a local install cannot hide it; untrack them (git rm -r --cached .claude) to keep it out');
    const own = folderPlan({ ...PLAN, scope: 'local', versioning: 'git', have: '*.log\n' });
    assert.strictEqual(own.line, '!! .claude/.gitignore: not the stack\'s text, so it is yours and stays - a local install does not hide .claude until its rule is in that file');
    assert.match(folderPlan({ ...PLAN, scope: 'project', have: '*.log\n' }).line, /versioning local does not hide \.claude/, 'at project scope versioning is the cause');
});

test('apply: versioning local at project scope writes both files, makes .cursor and records it', () =>
{
    const root = project();
    const result = run(root);
    assert.strictEqual(read(root, '.claude', '.gitignore'), CLAUDE_VERSIONING_IGNORE);
    assert.strictEqual(read(root, '.cursor', '.gitignore'), CURSOR_VERSIONING_IGNORE);
    assert.deepStrictEqual(result.createdDirs, ['.cursor']);
    assert.deepStrictEqual(result.toldTracked, []);
    assert.strictEqual(git(root, 'status', '--porcelain'), '', 'git sees neither folder');
});

test('apply: a first write of a versioning text at project scope logs one line naming the file', () =>
{
    const root = project();
    const { lines } = run(root);
    assert.deepStrictEqual(lines, ['  .claude/.gitignore written - versioning local keeps .claude out of git', '  .cursor/.gitignore written - versioning local keeps .cursor out of git']);
});

test('apply: a second run writes nothing and says nothing', () =>
{
    const root = project();
    const first = run(root);
    const before = [read(root, '.claude', '.gitignore'), read(root, '.cursor', '.gitignore')];
    const second = run(root, { told: first.toldTracked, created: first.createdDirs });
    assert.deepStrictEqual(second.lines, []);
    assert.deepStrictEqual([read(root, '.claude', '.gitignore'), read(root, '.cursor', '.gitignore')], before);
    assert.deepStrictEqual(second, { lines: [], toldTracked: first.toldTracked, createdDirs: first.createdDirs, failed: [] });
});

test('apply: a .cursor that already existed is not recorded, and never removed', () =>
{
    const root = project();
    put(root, '.cursor/rules/mine.mdc', 'x\n');
    const on = run(root);
    assert.deepStrictEqual(on.createdDirs, []);
    const off = run(root, { versioning: 'git', created: on.createdDirs });
    assert.strictEqual(read(root, '.cursor', '.gitignore'), null);
    assert.strictEqual(read(root, '.cursor', 'rules', 'mine.mdc'), 'x\n');
    assert.deepStrictEqual(off.createdDirs, []);
});

test('apply: back at git only the stack text goes from a .cursor holding a user file, and the folder stays recorded', () =>
{
    const root = project();
    const on = run(root);
    put(root, '.cursor/mine.json', '{}\n');
    const off = run(root, { versioning: 'git', created: on.createdDirs });
    assert.strictEqual(read(root, '.cursor', '.gitignore'), null);
    assert.strictEqual(read(root, '.cursor', 'mine.json'), '{}\n');
    assert.deepStrictEqual(off.createdDirs, ['.cursor'], 'the folder is not empty, so it is not removed or dropped');
});

test('apply: back at git the .claude text goes and the .cursor folder the stack made goes with its file', () =>
{
    const root = project();
    const on = run(root);
    const off = run(root, { versioning: 'git', created: on.createdDirs });
    assert.strictEqual(read(root, '.claude', '.gitignore'), null);
    assert.strictEqual(fs.existsSync(path.join(root, '.cursor')), false);
    assert.deepStrictEqual(off.createdDirs, []);
    assert.match(off.lines.join('\n'), /\.claude\/\.gitignore removed/);
});

test('apply: a file of the user\'s - even the stack\'s first line plus more - is never rewritten or removed, and named once', () =>
{
    const root = project();
    const mine = `${CLAUDE_VERSIONING_IGNORE}!shared.md\n`;
    put(root, '.claude/.gitignore', mine);
    put(root, '.cursor/.gitignore', '*.tmp\n');
    const first = run(root, { versioning: 'local' });
    assert.deepStrictEqual(first.lines, [`  ${ownNotice('.claude')}`, `  ${ownNotice('.cursor')}`]);
    assert.deepStrictEqual(first.toldTracked, ['own:.claude', 'own:.cursor']);
    let record = first;
    for (const versioning of ['git', 'local'])
    {
        record = run(root, { versioning, told: record.toldTracked, created: record.createdDirs });
        assert.deepStrictEqual(record.lines, [], versioning);
    }
    assert.deepStrictEqual(record.toldTracked, ['own:.claude', 'own:.cursor']);
    assert.strictEqual(read(root, '.claude', '.gitignore'), mine);
    assert.strictEqual(read(root, '.cursor', '.gitignore'), '*.tmp\n');
});

test('apply: an unread docs versioning (null) removes nothing - the stack texts, the recorded .cursor and the records stay', () =>
{
    const root = project();
    const on = run(root);
    assert.deepStrictEqual(on.createdDirs, ['.cursor']);
    const failed = run(root, { versioning: null, told: ['.claude'], created: on.createdDirs });
    assert.deepStrictEqual(failed.lines, []);
    assert.strictEqual(read(root, '.claude', '.gitignore'), CLAUDE_VERSIONING_IGNORE);
    assert.strictEqual(read(root, '.cursor', '.gitignore'), CURSOR_VERSIONING_IGNORE);
    assert.deepStrictEqual({ toldTracked: failed.toldTracked, createdDirs: failed.createdDirs }, { toldTracked: ['.claude'], createdDirs: ['.cursor'] });
    const second = run(root, { versioning: null, second: true, created: on.createdDirs });
    assert.deepStrictEqual(second.lines, []);
    assert.strictEqual(read(root, '.claude', '.gitignore'), CLAUDE_VERSIONING_IGNORE);
});

test('apply: a folder git tracks files in gets no file and one notice, told once', () =>
{
    const root = project();
    put(root, '.claude/team.md', 'ours\n');
    git(root, 'add', '-f', '.claude/team.md');
    git(root, 'commit', '-q', '-m', 'team file');
    const first = run(root);
    assert.strictEqual(read(root, '.claude', '.gitignore'), null);
    assert.deepStrictEqual(first.lines.filter((l) => l.includes('!!')), [`  ${trackedNotice('.claude')}`]);
    assert.deepStrictEqual(first.toldTracked, ['.claude']);
    assert.strictEqual(read(root, '.cursor', '.gitignore'), CURSOR_VERSIONING_IGNORE, '.cursor is a folder of its own');
    const again = run(root, { told: first.toldTracked, created: first.createdDirs });
    assert.deepStrictEqual(again.lines, []);
    assert.deepStrictEqual(again.toldTracked, ['.claude']);
});

test('apply: not in a git repository writes no agent-folder file', () =>
{
    const root = project({ repo: false });
    const result = run(root);
    assert.deepStrictEqual(result, { lines: [], toldTracked: [], createdDirs: [], failed: [] });
    assert.strictEqual(fs.existsSync(path.join(root, '.claude')), false);
    assert.strictEqual(fs.existsSync(path.join(root, '.cursor')), false);
});

test('apply: a failed write is one !! line naming the file and records nothing', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
{
    const root = project();
    fs.mkdirSync(path.join(root, '.claude'));
    fs.chmodSync(root, 0o555);
    try
    {
        const result = run(root);
        const bang = result.lines.filter((l) => l.includes('!!'));
        assert.strictEqual(bang.length, 1, result.lines.join('\n'));
        assert.match(bang[0], /^ {2}!! \.cursor\/\.gitignore could not be written/);
        assert.deepStrictEqual(result.createdDirs, []);
        assert.deepStrictEqual(result.toldTracked, []);
    }
    finally { fs.chmodSync(root, 0o755); }
    const retry = run(root);
    assert.deepStrictEqual(retry.createdDirs, ['.cursor'], 'the next run tries again');
});

test('apply: an unwritable .claude keeps the stack text on local -> git, with one !! line and no record change', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () =>
{
    const root = project();
    const on = run(root);
    const folder = path.join(root, '.claude');
    fs.chmodSync(folder, 0o555);
    try
    {
        const back = run(root, { versioning: 'git', told: on.toldTracked, created: on.createdDirs });
        const bang = back.lines.filter((l) => l.includes('!!'));
        assert.strictEqual(bang.length, 1, back.lines.join('\n'));
        assert.match(bang[0], /^ {2}!! \.claude\/\.gitignore could not be removed/);
        assert.strictEqual(read(root, '.claude', '.gitignore'), CLAUDE_VERSIONING_IGNORE, 'the file stays');
        assert.deepStrictEqual([back.toldTracked, back.failed], [on.toldTracked, ['.claude']]);
    }
    finally { fs.chmodSync(folder, 0o755); }
    assert.strictEqual(run(root, { versioning: 'git', created: on.createdDirs }).lines.filter((l) => l.includes('!!')).length, 0, 'the next run takes the file back');
    assert.strictEqual(read(root, '.claude', '.gitignore'), null);
});

test('apply: a second pass that changes the answer says the link homes move at the next run', () =>
{
    const root = project();
    const first = run(root, { versioning: 'git' });
    assert.deepStrictEqual(first.lines, []);
    const second = run(root, { versioning: 'local', second: true });
    assert.ok(second.lines.some((l) => /link homes: \.claude is hidden now, so skills and agents move at the next run/.test(l)), second.lines.join('\n'));
    const quiet = run(root, { versioning: 'local', second: true, created: second.createdDirs });
    assert.deepStrictEqual(quiet.lines, [], 'no change, no line');
    const back = run(root, { versioning: 'git', second: true, created: second.createdDirs });
    assert.ok(back.lines.some((l) => /link homes: \.claude is shared now/.test(l)), back.lines.join('\n'));
});

test('apply: a wanted text replaces the other stack text in place', () =>
{
    const root = project();
    put(root, '.claude/.gitignore', CLAUDE_IGNORE);
    const result = run(root, { scope: 'project', versioning: 'local' });
    assert.strictEqual(read(root, '.claude', '.gitignore'), CLAUDE_VERSIONING_IGNORE);
    assert.match(result.lines[0], /^ {2}\.claude\/\.gitignore rewritten - versioning local keeps \.claude out of git$/);
});

const SEL = 'skill markdown-style\nskill javascript\n';
const COPY = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const LOCAL_VERSIONING = ['--scope', 'project', '--docs-versioning', 'local'];
const stampLines = (repo) => (read(repo, '.claude', 'alfred-code.stamp') || '').split('\n').filter((l) => !/^installed(-ms)?:/.test(l)).join('\n');
const snapshot = (repo) => ({
    claude: read(repo, '.claude', '.gitignore'), cursor: read(repo, '.cursor', '.gitignore'), data: read(repo, '.alfred', '.gitignore'),
    variables: read(repo, '.alfred', '.variables'), stamp: stampLines(repo),
});
const isLink = (repo, ...rel) => { try { return fs.lstatSync(path.join(repo, ...rel)).isSymbolicLink(); } catch { return false; } };
const isDir = (repo, ...rel) => { try { return fs.lstatSync(path.join(repo, ...rel)).isDirectory(); } catch { return false; } };

test('install: versioning local at project scope writes both files, records .cursor and a second run changes nothing', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'install'], SEL, { args: [LOCAL_VERSIONING, LOCAL_VERSIONING], env: COPY, each: snapshot });
    assert.strictEqual(steps[0].claude, CLAUDE_VERSIONING_IGNORE);
    assert.strictEqual(steps[0].cursor, CURSOR_VERSIONING_IGNORE);
    assert.match(steps[0].stamp, /^created-dirs: \.cursor$/m);
    assert.match(outs[0], /^==> {3}\.claude\/\.gitignore written - versioning local keeps \.claude out of git$/m);
    assert.match(outs[0], /^==> {3}\.cursor\/\.gitignore written - versioning local keeps \.cursor out of git$/m);
    assert.deepStrictEqual(steps[1], steps[0], 'every file and the stamp, byte for byte');
    assert.doesNotMatch(outs[1], /\.(claude|cursor)\/\.gitignore (written|rewritten|removed)/);
});

// R17a / R17b: a `.cursor` that cannot be made (a file holds its name) is said once per run, and the next run tries again.
test('install: an unwritable .cursor prints its !! line once per run, and the next run still retries', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'install'], SEL, {
        args: [LOCAL_VERSIONING, LOCAL_VERSIONING], env: COPY,
        prepare: (repo) => fs.writeFileSync(path.join(repo, '.cursor'), 'a file, not a folder\n'),
        each: (repo, i) => { const row = { cursor: read(repo, '.cursor', '.gitignore'), stamp: stampLines(repo) }; if (i === 0) fs.rmSync(path.join(repo, '.cursor')); return row; },
    });
    const said = (out) => (out.match(/^==> {3}!! \.cursor\/\.gitignore could not be written/gm) || []).length;
    assert.strictEqual(said(outs[0]), 1, outs[0]);
    assert.strictEqual(steps[0].cursor, null);
    assert.strictEqual(said(outs[1]), 0, outs[1]);
    assert.strictEqual(steps[1].cursor, CURSOR_VERSIONING_IGNORE, 'the next run tries again');
});

test('install: versioning local then git at project scope turns the links into copies and takes the files back', POSIX_ONLY, () =>
{
    const { steps } = seedRun(['install', 'update'], SEL, {
        args: [LOCAL_VERSIONING, ['--docs-versioning', 'git']], env: COPY,
        each: (repo) => ({ ...snapshot(repo), linked: isLink(repo, '.claude', 'skills', 'javascript'), copied: isDir(repo, '.claude', 'skills', 'javascript'),
            cursorDir: fs.existsSync(path.join(repo, '.cursor')) }),
    });
    assert.strictEqual(steps[0].linked, true, 'hidden .claude: the store and a link');
    assert.strictEqual(steps[0].cursorDir, true);
    assert.strictEqual(steps[1].claude, null);
    assert.strictEqual(steps[1].cursor, null);
    assert.strictEqual(steps[1].cursorDir, false, 'the folder the stack made goes with its file');
    assert.strictEqual(steps[1].linked, false);
    assert.strictEqual(steps[1].copied, true, 'the link became a real folder');
    assert.doesNotMatch(steps[1].stamp, /created-dirs:/);
});

test('uninstall: removes the stack\'s texts and the .cursor folder it made', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'uninstall'], SEL, {
        args: [LOCAL_VERSIONING, []], env: COPY,
        inspect: (repo) => ({ claude: read(repo, '.claude', '.gitignore'), cursorDir: fs.existsSync(path.join(repo, '.cursor')) }),
    });
    assert.strictEqual(result.claude, null);
    assert.strictEqual(result.cursorDir, false);
});

test('uninstall: a .cursor holding a user file keeps the folder and the file, and the user\'s .gitignore stays', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'uninstall'], SEL, {
        args: [LOCAL_VERSIONING, []], env: COPY,
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(repo, '.cursor', 'mine.json'), '{}\n'); },
        inspect: (repo) => ({ cursorGitignore: read(repo, '.cursor', '.gitignore'), mine: read(repo, '.cursor', 'mine.json') }),
    });
    assert.strictEqual(result.cursorGitignore, null);
    assert.strictEqual(result.mine, '{}\n');
});

test('uninstall: a .cursor/.gitignore the user wrote stays', POSIX_ONLY, () =>
{
    const { result } = seedRun(['install', 'uninstall'], SEL, {
        args: [LOCAL_VERSIONING, []], env: COPY,
        each: (repo, i) => { if (i === 0) fs.writeFileSync(path.join(repo, '.cursor', '.gitignore'), `${CURSOR_VERSIONING_IGNORE}!keep\n`); },
        inspect: (repo) => read(repo, '.cursor', '.gitignore'),
    });
    assert.strictEqual(result, `${CURSOR_VERSIONING_IGNORE}!keep\n`);
});

test('ignoreVerdict: the stack\'s own .claude/.gitignore is the stack\'s rule, a user file is not', () =>
{
    const root = project();
    put(root, '.claude/.gitignore', CLAUDE_VERSIONING_IGNORE);
    assert.deepStrictEqual(variables.ignoreVerdict(root, '.alfred', '.claude/docs/'), { ignored: true, source: '.claude/.gitignore', line: 2, own: true });
    put(root, '.claude/.gitignore', CLAUDE_IGNORE);
    assert.strictEqual(variables.ignoreVerdict(root, '.alfred', '.claude/docs/').own, true);
    put(root, '.claude/.gitignore', `${CLAUDE_VERSIONING_IGNORE}!shared.md\n`);
    assert.strictEqual(variables.ignoreVerdict(root, '.alfred', '.claude/docs/').own, false, 'the stack\'s first line plus more is the user\'s');
    put(root, '.claude/.gitignore', '*\n');
    assert.strictEqual(variables.ignoreVerdict(root, '.alfred', '.claude/docs/').own, false);
});

test('a docs root under .claude with the stack\'s .claude/.gitignore is not firm, and a user\'s rule there is', () =>
{
    const root = project();
    put(root, '.claude/docs/architecture/NOTES.md', 'x\n');
    put(root, '.claude/.gitignore', CLAUDE_VERSIONING_IGNORE);
    const stacks = docs.docsVersioningAdvice({ projectRoot: root, docsPath: '.claude/docs', scope: 'project', dataRoot: '.alfred' });
    assert.deepStrictEqual({ value: stacks.value, firm: stacks.firm }, { value: 'local', firm: false });
    put(root, '.claude/.gitignore', '*\n');
    const users = docs.docsVersioningAdvice({ projectRoot: root, docsPath: '.claude/docs', scope: 'project', dataRoot: '.alfred' });
    assert.deepStrictEqual({ value: users.value, firm: users.firm }, { value: 'local', firm: true });
});

test('install: a .claude/.gitignore of the user\'s is named once and on the stamp, and a second run says nothing', POSIX_ONLY, () =>
{
    const { steps, outs } = seedRun(['install', 'install'], SEL, {
        args: [LOCAL_VERSIONING, LOCAL_VERSIONING], env: COPY,
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude'), { recursive: true }); fs.writeFileSync(path.join(repo, '.claude', '.gitignore'), '!mine\n'); },
        each: snapshot,
    });
    assert.strictEqual(steps[0].claude, '!mine\n');
    assert.match(steps[0].stamp, /^told-tracked: own:\.claude$/m);
    assert.match(outs[0], /^==> {3}!! \.claude\/\.gitignore: not the stack's text, so it is yours and stays/m);
    assert.doesNotMatch(outs[1], /not the stack's text/);
    assert.deepStrictEqual(steps[1], steps[0]);
});
