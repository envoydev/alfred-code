'use strict';
// Memory P3 - docs mode, the installer half (scripts/install/memory-dir.js): the ledgered `autoMemoryDirectory` row in
// .claude/settings.local.json, written, re-pointed and taken back, and every refusal (R4, plus the plan's 'garbage' and
// the user's own value). Each case runs the Node seed end to end against a recording `claude` and reads the files left.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const memoryDir = require('./install/memory-dir.js');
const layout = require('../stack/hooks/layout.js');
const stamp = require('./install/stamp.js');

const SEL = 'rule markdown-docs\n';
const real = (p) => fs.realpathSync.native(p);
const memOf = (repo, data = '.alfred') => path.join(real(repo), ...data.split('/'), 'docs', 'memory');
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const json = (f) => { const t = readOr(f); return t === null ? null : JSON.parse(t); };
const localOf = (repo) => json(path.join(repo, '.claude', 'settings.local.json'));
const settingsOf = (repo) => json(path.join(repo, '.claude', 'settings.json')) || {};
const stampOf = (repo) => readOr(path.join(repo, '.claude', 'alfred-code.stamp')) || '';
const modeOf = (repo) => ((layout.readDotenv(path.join(repo, '.alfred', '.variables')) || {}).values || {}).ALFRED_CODE_MEMORY;
const rowHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stampRow = (repo) => (/settings\.local\.json:autoMemoryDirectory=([0-9a-f]{64})/.exec(stampOf(repo)) || [])[1] || null;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const writeLocal = (repo, value) =>
{
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'settings.local.json'), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
// The run's dates and its action word are no change.
const noDates = (text) => text.split('\n').filter((l) => !/^(installed|installed-ms|initialised|action):/.test(l) && !/action \(or that skill\)/.test(l)).join('\n');
const docsInspect = (repo) => ({ want: memOf(repo), local: localOf(repo), settings: settingsOf(repo), stamp: stampOf(repo), row: stampRow(repo), mode: modeOf(repo) });

test('docs: install --memory docs writes the absolute main-checkout path and its stamp row', POSIX_ONLY, () =>
{
    const r = seedRun('install', SEL, { args: ['--memory', 'docs'], inspect: docsInspect });
    assert.strictEqual(r.result.local.autoMemoryDirectory, r.result.want, r.out);
    assert.ok(path.isAbsolute(r.result.local.autoMemoryDirectory));
    assert.strictEqual(r.result.row, rowHash(r.result.want), 'the stamp records the sha256 of the JSON string');
    assert.ok(!Object.hasOwn(r.result.settings, 'autoMemoryDirectory'), 'never the committed settings.json');
    assert.strictEqual(r.result.mode, 'docs');
    assert.match(r.out, /settings\.local\.json: autoMemoryDirectory written - \.alfred\/docs\/memory\/ \(ALFRED_CODE_MEMORY is docs; Claude's own memory lives with the docs from the next session\)/);
});

test('docs: a second update changes nothing', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, {
        args: [['--memory', 'docs'], []],
        each: (repo) => ({ local: readOr(path.join(repo, '.claude', 'settings.local.json')), stamp: noDates(stampOf(repo)) }),
    });
    assert.strictEqual(r.steps[1].local, r.steps[0].local, 'the local file is byte-equal');
    assert.strictEqual(r.steps[1].stamp, r.steps[0].stamp, 'the stamp is equal bar its dates');
    assert.doesNotMatch(r.outs[1], /autoMemoryDirectory (written|re-pointed)/);
});

// The temp-project matrix (Task 3, case 19x): a joined child in its own repository reads docs through the chain and writes
// its own row beside the workspace rows in the same file. The row's place in the stamp is fixed, so a re-run is byte-equal.
test('docs: a joined child\'s second install leaves its stamp unchanged - the row keeps its place beside the workspace rows', POSIX_ONLY, () =>
{
    const ws = require('./install/workspace.js');
    const r = seedRun(['install', 'install', 'install'], SEL, {
        args: [['--memory', 'docs'], [], []],
        cwds: ['repo', 'repo/api', 'repo/api'],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, 'api')); git(path.join(repo, 'api'), 'init', '-q'); },
        each: (repo, i) =>
        {
            const child = path.join(repo, 'api');
            if (i > 0) return { stamp: noDates(stampOf(child)), local: readOr(path.join(child, '.claude', 'settings.local.json')), want: memOf(child) };
            const env = { CLAUDE_CONFIG_DIR: path.join(path.dirname(repo), 'acct') };
            assert.ok(ws.writeWorkspace(child, (m) => ws.setParent(m, '..'), { env }).ok);
            assert.ok(ws.writeWorkspace(repo, (m) => ws.addChild(m, 'api'), { env }).ok);
            return null;
        },
    });
    const [, first, second] = r.steps;
    assert.strictEqual(JSON.parse(first.local).autoMemoryDirectory, first.want, r.outs[1]);
    assert.match(first.stamp, /settings\.local\.json:claudeMdExcludes\[/, 'the child carries workspace rows in the same file');
    assert.strictEqual(second.local, first.local, 'the local file is byte-equal');
    assert.strictEqual(second.stamp, first.stamp, 'the stamp is equal bar its dates');
});

test('docs -> default removes the row and the file it alone held', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, { args: [['--memory', 'docs'], ['--memory', 'default']], inspect: docsInspect });
    assert.strictEqual(r.result.local, null, r.outs[1]);
    assert.strictEqual(r.result.row, null);
    assert.strictEqual(r.result.mode, 'default');
    assert.match(r.outs[1], /settings\.local\.json: autoMemoryDirectory removed - ALFRED_CODE_MEMORY is no longer docs, so Claude's own memory is back at its default place/);
    assert.match(r.outs[1], /settings\.local\.json removed - it held nothing but the stack's entries/);
});

test('docs -> custom: the row goes, autoMemoryEnabled false arrives', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, { args: [['--memory', 'docs'], ['--memory', 'custom']], inspect: docsInspect });
    assert.ok(!(r.result.local && Object.hasOwn(r.result.local, 'autoMemoryDirectory')), r.outs[1]);
    assert.strictEqual(r.result.row, null);
    assert.strictEqual(r.result.settings.autoMemoryEnabled, false, 'P2\'s switch-off in the run\'s own file');
});

test('docs: refused on a tracked settings.local.json - nothing written, ALFRED_CODE_MEMORY stays default', POSIX_ONLY, () =>
{
    const r = seedRun('install', SEL, {
        args: ['--memory', 'docs'],
        prepare: (repo) => { writeLocal(repo, '{}\n'); git(repo, 'add', '-f', '.claude/settings.local.json'); },
        inspect: (repo) => ({ ...docsInspect(repo), text: readOr(path.join(repo, '.claude', 'settings.local.json')) }),
    });
    assert.match(r.out, /!! memory: docs not written - \.claude\/settings\.local\.json is tracked in git, so Claude Code reads it as the repository's - untrack it \(git rm --cached \.claude\/settings\.local\.json, then add it to \.gitignore\) to allow docs mode; ALFRED_CODE_MEMORY stays 'default'/);
    assert.strictEqual(r.result.text, '{}\n');
    assert.strictEqual(r.result.mode, 'default');
    assert.strictEqual(r.result.row, null);
});

test('docs: refused under a symlinked .claude', { skip: process.platform === 'win32' && 'a symlink needs a privilege there' }, () =>
{
    const r = seedRun('install', SEL, {
        args: ['--memory', 'docs'],
        prepare: (repo, work) => { fs.mkdirSync(path.join(work, 'shared-claude')); fs.symlinkSync(path.join(work, 'shared-claude'), path.join(repo, '.claude')); },
        inspect: (repo) => ({ local: json(path.join(path.dirname(repo), 'shared-claude', 'settings.local.json')), mode: modeOf(repo) }),
    });
    assert.match(r.out, /!! memory: docs not written - \.claude is a symlink, so Claude Code reads its settings\.local\.json as the repository's; ALFRED_CODE_MEMORY stays 'default'/);
    assert.ok(!(r.result.local && Object.hasOwn(r.result.local, 'autoMemoryDirectory')));
    assert.strictEqual(r.result.mode, 'default');
});

test('docs: refused on a garbage settings.local.json, the file untouched', POSIX_ONLY, () =>
{
    const r = seedRun('install', SEL, {
        args: ['--memory', 'docs'],
        prepare: (repo) => writeLocal(repo, '{oops'),
        inspect: (repo) => ({ text: readOr(path.join(repo, '.claude', 'settings.local.json')), mode: modeOf(repo), row: stampRow(repo) }),
    });
    assert.strictEqual(r.result.text, '{oops');
    assert.match(r.out, /!! memory: docs not written - \.claude\/settings\.local\.json is not valid JSON - fix it, then run \/alfred-code:update again; ALFRED_CODE_MEMORY stays 'default'/);
    assert.strictEqual(r.result.mode, 'default');
    assert.strictEqual(r.result.row, null);
});

test('docs: the user\'s own other autoMemoryDirectory refuses and stays; their own equal value is accepted unrecorded', POSIX_ONLY, () =>
{
    const other = seedRun('install', SEL, { args: ['--memory', 'docs'], prepare: (repo) => writeLocal(repo, { autoMemoryDirectory: '/elsewhere' }), inspect: docsInspect });
    assert.match(other.out, /!! memory: docs not written - \.claude\/settings\.local\.json sets its own autoMemoryDirectory - yours, so it stays; ALFRED_CODE_MEMORY stays 'default'/);
    assert.strictEqual(other.result.local.autoMemoryDirectory, '/elsewhere');
    assert.strictEqual(other.result.mode, 'default');
    assert.strictEqual(other.result.row, null);

    const equal = seedRun(['install', 'update'], SEL, { args: [['--memory', 'docs'], []], prepare: (repo) => writeLocal(repo, { autoMemoryDirectory: memOf(repo) }), inspect: docsInspect });
    assert.strictEqual(equal.result.mode, 'docs');
    assert.strictEqual(equal.result.local.autoMemoryDirectory, equal.result.want);
    assert.strictEqual(equal.result.row, null, 'the user\'s value is never recorded');
    assert.match(equal.outs[0], /settings\.local\.json: autoMemoryDirectory already names \.alfred\/docs\/memory\/ - yours, kept and not recorded/);
    assert.doesNotMatch(equal.outs[1], /autoMemoryDirectory/, 'a run with no --memory says nothing of it');
});

test('docs: a user value in settings.json is outranked and named once; a re-run does not name it again', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, {
        args: [['--memory', 'docs'], []],
        prepare: (repo) => { fs.mkdirSync(path.join(repo, '.claude')); fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '/team' })); },
        inspect: docsInspect,
    });
    assert.match(r.outs[0], /settings\.local\.json: autoMemoryDirectory outranks yours in \.claude\/settings\.json - Claude's own memory goes to \.alfred\/docs\/memory\/; yours stays/);
    assert.doesNotMatch(r.outs[1], /outranks/);
    assert.strictEqual(r.result.settings.autoMemoryDirectory, '/team', 'yours stays');
});

test('outrankLines: a managed autoMemoryDirectory is named as outranking the row; a settings.json one as outranked', () =>
{
    const top = real(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-outrank-')));
    try
    {
        const root = path.join(top, 'repo');
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        git(root, 'init', '-q');
        const env = { CLAUDE_CONFIG_DIR: path.join(top, 'acct') };
        const wanted = layout.docsMemoryDir(root, { env });
        const managed = path.join(top, 'managed', 'managed-settings.json');
        fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: '/team' }));
        writeLocal(root, { autoMemoryDirectory: wanted });
        const home = path.join(top, 'home');
        assert.deepStrictEqual(memoryDir.outrankLines(root, { wanted, env, managed, home }),
            ['settings.local.json: autoMemoryDirectory outranks yours in .claude/settings.json - Claude\'s own memory goes to .alfred/docs/memory/; yours stays']);
        fs.mkdirSync(path.dirname(managed));
        fs.writeFileSync(managed, JSON.stringify({ autoMemoryDirectory: '/corp/memory' }));
        const lines = memoryDir.outrankLines(root, { wanted, env, managed, home });
        assert.ok(lines.includes('!! memory: a managed autoMemoryDirectory outranks .claude/settings.local.json here - Claude\'s own memory stays at /corp/memory, not .alfred/docs/memory/'), lines.join('\n'));
    }
    finally { fs.rmSync(top, { recursive: true, force: true }); }
});

test('docs: the row committed after the write is removed by the next update (D11)', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update', 'update'], SEL, {
        args: [['--memory', 'docs'], [], []],
        each: (repo, i) => { if (i === 0) git(repo, 'add', '-f', '.claude/settings.local.json'); return { local: localOf(repo), row: stampRow(repo) }; },
        inspect: docsInspect,
    });
    assert.match(r.outs[1], /settings\.local\.json: autoMemoryDirectory removed - \.claude\/settings\.local\.json is tracked in git, so Claude Code reads it as the repository's - untrack it \(git rm --cached \.claude\/settings\.local\.json, then add it to \.gitignore\) to allow docs mode/);
    assert.ok(!(r.steps[1].local && Object.hasOwn(r.steps[1].local, 'autoMemoryDirectory')));
    assert.strictEqual(r.steps[1].row, null);
    assert.strictEqual(r.result.mode, 'docs', 'the mode value is not changed');
    assert.doesNotMatch(r.outs[2], /autoMemoryDirectory written/, 'a file still in the index is still tracked: no write next run');
    assert.match(r.outs[2], /!! memory: ALFRED_CODE_MEMORY is docs, but \.claude\/settings\.local\.json is tracked in git/);
});

test('docs: a moved repo folder is re-pointed on update', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, {
        args: [['--memory', 'docs'], []],
        cwds: ['repo', 'moved'],
        each: (repo, i) => { if (i === 0) fs.cpSync(repo, path.join(path.dirname(repo), 'moved'), { recursive: true }); return null; },
        inspect: (repo) => docsInspect(path.join(path.dirname(repo), 'moved')),
    });
    const lines = r.outs[1].split('\n').filter((l) => /autoMemoryDirectory re-pointed/.test(l));
    assert.strictEqual(lines.length, 1, r.outs[1]);
    assert.match(lines[0], /settings\.local\.json: autoMemoryDirectory re-pointed - .*repo\/\.alfred\/docs\/memory -> \.alfred\/docs\/memory\/ \(the folder moved\)/);
    assert.strictEqual(r.result.local.autoMemoryDirectory, r.result.want);
    assert.strictEqual(r.result.row, rowHash(r.result.want));
});

test('docs: a data-root move carries memory/ and re-points the row', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, {
        args: [['--memory', 'docs'], ['--data-path', '.data', '--data-move', 'move']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.mkdirSync(path.join(repo, '.alfred', 'docs', 'memory'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.alfred', 'docs', 'memory', 'MEMORY.md'), '# Memory\n- a lesson\n');
            return null;
        },
        inspect: (repo) => ({ local: localOf(repo), want: memOf(repo, '.data'), text: readOr(path.join(repo, '.data', 'docs', 'memory', 'MEMORY.md')), row: stampRow(repo) }),
    });
    assert.strictEqual(r.result.text, '# Memory\n- a lesson\n', r.outs[1]);
    assert.strictEqual(r.result.local.autoMemoryDirectory, r.result.want);
    assert.strictEqual(r.result.row, rowHash(r.result.want));
});

test('docs: local scope writes the same file and keeps it across a switch to project scope', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'update'], SEL, {
        args: [['--scope', 'local', '--memory', 'docs'], ['--scope', 'project']],
        each: (repo) => ({ local: localOf(repo), row: stampRow(repo) }),
        inspect: docsInspect,
    });
    assert.strictEqual(r.steps[0].local.autoMemoryDirectory, r.result.want, r.outs[0]);
    assert.strictEqual(r.steps[0].row, rowHash(r.result.want));
    assert.strictEqual(r.result.local.autoMemoryDirectory, r.result.want, r.outs[1]);
    assert.strictEqual(r.result.row, rowHash(r.result.want));
});

test('docs: user scope writes the project\'s settings.local.json, never the account\'s settings.json; uninstall takes it back', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'uninstall'], SEL, {
        args: [['--scope', 'user', '--memory', 'docs'], []],
        each: (repo, i) => ({ ...docsInspect(repo), account: json(path.join(path.dirname(repo), 'acct', 'settings.json')) || {} }),
    });
    const [after, gone] = r.steps;
    assert.strictEqual(after.local.autoMemoryDirectory, after.want, r.outs[0]);
    assert.strictEqual(after.row, rowHash(after.want));
    assert.ok(!Object.hasOwn(after.account, 'autoMemoryDirectory'));
    assert.ok(!(gone.local && Object.hasOwn(gone.local, 'autoMemoryDirectory')), r.outs[1]);
});

// The installer's project root is always the git top level (alfred-code.js, rt.gitRoot), so a same-repo child cannot be
// installed through the seed: its half of OD5 is driven through gate and step over a hand-made layout.
function sameRepoChild()
{
    const top = real(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-share-')));
    const parent = path.join(top, 'ws');
    const child = path.join(parent, 'api');
    fs.mkdirSync(child, { recursive: true });
    git(parent, 'init', '-q');
    for (const [dir, file] of [[parent, 'child api\n'], [child, 'parent ..\n']])
    {
        fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), file);
    }
    fs.writeFileSync(path.join(parent, '.alfred', '.variables'), 'ALFRED_CODE_MEMORY=docs\n');
    const configDir = path.join(top, 'acct');
    writeLocal(parent, { autoMemoryDirectory: layout.docsMemoryDir(parent, { env: { CLAUDE_CONFIG_DIR: configDir } }) });
    const lines = [];
    const ctx = (memory) => ({
        projectRoot: child, claudeDir: path.join(child, '.claude'), configDir, args: { memory, memoryCopy: false },
        ledger: stamp.emptyLedger(), dataInfo: { root: '.alfred' }, docsRootPending: false, log: (m) => lines.push(m), note: (m) => lines.push(`note: ${m}`),
    });
    return { top, parent, child, lines, ctx };
}

test('docs: a same-repo workspace child sharing its parent\'s docs memory - no write, no !! line, no stamp row; a re-run changes nothing', () =>
{
    const t = sameRepoChild();
    try
    {
        for (const memory of [undefined, 'docs', undefined])
        {
            const ctx = t.ctx(memory);
            t.lines.length = 0;
            memoryDir.gate(ctx);
            memoryDir.step(ctx, '.alfred/docs');
            assert.strictEqual(ctx.memoryDirRow, null);
            assert.ok(!fs.existsSync(path.join(t.child, '.claude', 'settings.local.json')), 'nothing written in the child');
            assert.ok(!t.lines.some((l) => /!!/.test(l)), t.lines.join('\n'));
            if (memory) assert.ok(t.lines.includes(`  memory: docs - shares ..'s docs memory (${layout.docsMemoryDir(t.parent)}/), so nothing is written here`), t.lines.join('\n'));
            else assert.deepStrictEqual(t.lines, []);
            assert.strictEqual(ctx.args.memory, undefined, 'the child keeps reading docs from its member');
        }
        // With the parent's row gone the child is refused as before (it sits below its repository root).
        writeLocal(t.parent, {});
        const ctx = t.ctx(undefined);
        t.lines.length = 0;
        memoryDir.gate(ctx);
        memoryDir.step(ctx, '.alfred/docs');
        assert.ok(t.lines.some((l) => l.startsWith('  !! memory: ALFRED_CODE_MEMORY is docs, but this project is below its repository root')), t.lines.join('\n'));
        assert.ok(!fs.existsSync(path.join(t.child, '.claude', 'settings.local.json')));
    }
    finally { fs.rmSync(t.top, { recursive: true, force: true }); }
});

test('docs: uninstall removes the row and names the memory folder as kept', POSIX_ONLY, () =>
{
    const r = seedRun(['install', 'uninstall'], SEL, {
        args: [['--memory', 'docs'], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            fs.mkdirSync(path.join(repo, '.alfred', 'docs', 'memory'), { recursive: true });
            fs.writeFileSync(path.join(repo, '.alfred', 'docs', 'memory', 'MEMORY.md'), '# Memory\n');
            return null;
        },
        inspect: (repo) => ({ local: localOf(repo), kept: readOr(path.join(repo, '.alfred', 'docs', 'memory', 'MEMORY.md')) }),
    });
    assert.match(r.out, /the data root \.alfred\/ - the docs, the docs memory \.alfred\/docs\/memory\/ \(Claude Code reads its default place again\)/);
    assert.strictEqual(r.result.kept, '# Memory\n');
    assert.ok(!(r.result.local && Object.hasOwn(r.result.local, 'autoMemoryDirectory')));
});
