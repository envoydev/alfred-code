'use strict';
// THE DATA ROOT, END TO END THROUGH THE SEED - ALFRED_CODE_DATA_PATH (default .alfred) holds the docs,
// the navigation server's folder and home, the browser profiles and a project-level memory database.
// A fresh install lays everything there; an update over a 2.0.0 layout (docs at .claude/docs, .serena,
// .playwright/<engine>, .memory-mcp) moves it on the answer `--data-move move` - the docs inline, a
// server's own data by its launcher at the next start (the plugin route) or inline (the copy route, where
// no launcher runs); `--data-move keep` keeps the old layout and no later update offers again; a custom
// root moves everything there. A docs root the user set is never moved.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const { valueHash } = require('./install/stamp.js');

const COPY_ENV = { ALFRED_CODE_HOOKS_VIA_PLUGIN: 'false', ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false', ALFRED_CODE_MCPS_VIA_PLUGIN: 'false' };
const SELECTION = 'rule baseline-docs-root\nrule baseline-memory\nmcp navigation\nmcp memory\nmcp documentation\nmcp browser\n';
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const json = (file) => JSON.parse(read(file) || '{}');
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// A snapshot of the tree, taken before the sandbox is removed: every file outside .git with its text.
function snapshot(repo)
{
    const files = new Map();
    const walk = (dir, rel) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            if (e.name === '.git' && !rel) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) { files.set(`${r}/`, null); walk(path.join(dir, e.name), r); }
            else files.set(r, read(path.join(dir, e.name)));
        }
    };
    walk(repo, '');
    return files;
}
const look = (repo) =>
{
    const files = snapshot(repo);
    return {
        env: json(path.join(repo, '.claude', 'settings.json')).env || {},
        local: json(path.join(repo, '.claude', 'settings.local.json')).env || {},
        stamp: read(path.join(repo, '.claude', 'alfred-code.stamp')) || '',
        rule: (/This install's root: `([^`]*)`/.exec(read(path.join(repo, '.claude', 'rules', 'baseline-docs-root.md')) || '') || [])[1],
        ignore: read(path.join(repo, '.alfred', '.gitignore')),
        mcp: json(path.join(repo, '.mcp.json')).mcpServers || {},
        has: (rel) => files.has(rel) || files.has(`${rel}/`),
        text: (rel) => files.get(rel) ?? null,
        repo,
        real: fs.realpathSync(repo),
    };
};
const pendingOf = (stamp) => stamp.split('\n').filter((l) => l.startsWith('data-pending: ')).sort();

// A 2.0.0 install's data, laid over what the current seed just installed: the docs at the old default with
// the stack's own ledger entry for it, no DATA_PATH key, and every server's folder at its 2.0.0 place.
function twoZeroLayout(repo, { memoryDb = true } = {})
{
    const claude = path.join(repo, '.claude');
    const settings = json(path.join(claude, 'settings.json'));
    delete settings.env.ALFRED_CODE_DATA_PATH;
    settings.env.ALFRED_CODE_DOCS_PATH = '.claude/docs';
    fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify(settings, null, 2));
    const stampFile = path.join(claude, 'alfred-code.stamp');
    const stamp = read(stampFile)
        .replace(/settings\.json:ALFRED_CODE_DOCS_PATH=[0-9a-f]{64}/, `settings.json:ALFRED_CODE_DOCS_PATH=${valueHash('.claude/docs')}`)
        .split('\n').filter((l) => !/^data-/.test(l)).join('\n');
    fs.writeFileSync(stampFile, stamp);
    fs.rmSync(path.join(repo, '.alfred'), { recursive: true, force: true });
    put(path.join(repo, '.claude', 'docs', 'architecture', 'ARCHITECTURE.md'), '# arch\n');
    put(path.join(repo, '.serena', 'project.yml'), 'project_name: repo\nlanguage_servers: ["typescript"]\nignored_paths: [".serena", ".claude", ".playwright"]\n');
    put(path.join(repo, '.serena', 'home', 'serena_config.yml'), 'project_serena_folder_location: "$projectDir/.serena"\nprojects: []\n');
    put(path.join(repo, '.serena', '.gitignore'), '*\n');
    put(path.join(repo, '.playwright', 'chrome', 'Default', 'Cookies'), 'session');
    put(path.join(repo, '.playwright', '.gitignore'), '*\n');
    if (memoryDb)
    {
        put(path.join(repo, '.memory-mcp', 'memory.db'), 'PROJ');
        put(path.join(repo, '.memory-mcp', '.gitignore'), '*\n');
        const local = json(path.join(claude, 'settings.local.json'));
        (local.env ??= {}).ALFRED_CODE_MEMORY_DB = path.join(repo, '.memory-mcp', 'memory.db');
        fs.writeFileSync(path.join(claude, 'settings.local.json'), JSON.stringify(local, null, 2));
    }
    return null;
}
const prep = (repo) => put(path.join(repo, 'package.json'), '{"name":"app"}\n');   // gives serena a language to seed
const UPDATE = ['--scope', 'project', '--installed-only'];

test('fresh install: every kind of data lands under .alfred, and git keeps the machine state out but the docs in', POSIX_ONLY, () =>
{
    const { result: r, out } = seedRun('install', SELECTION, { prepare: prep, args: ['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], inspect: look });
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred', out);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, '.alfred/docs');
    assert.strictEqual(r.rule, '.alfred/docs');
    assert.strictEqual(r.local.ALFRED_CODE_MEMORY_DB, path.join(r.real, '.alfred', '.alfred-memory', 'memory.db'));
    assert.match(r.ignore, /^\/\*$/m);
    assert.match(r.ignore, /^!\/docs\/$/m, 'the docs stay visible to git, or the versioning seed reads them as kept out');
    assert.match(r.text('.alfred/serena/project.yml'), /ignored_paths: \["\.alfred", "\.claude", "\.serena", "\.playwright"\]/);
    assert.match(r.text('.alfred/serena/home/serena_config.yml'), /project_serena_folder_location: "\$projectDir\/\.alfred\/serena"/);
    assert.match(r.stamp, /^data-root: \.alfred$/m);
    assert.deepStrictEqual(pendingOf(r.stamp), []);
    for (const old of ['.serena', '.playwright', '.memory-mcp', '.claude/docs']) assert.ok(!r.has(old), `${old} was created`);
});

test('update over a 2.0.0 layout, no answer: nothing moves, the old places keep serving, and the offer is named', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], UPDATE],
        each: (repo, i) => (i === 0 ? twoZeroLayout(repo) : null), inspect: look,
    });
    assert.match(outs[1], /data root: .*\/alfred-code:update offers the move to \.alfred/, outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, '.claude/docs', 'the hooks keep reading where the docs are');
    assert.ok(r.has('.claude/docs/architecture/ARCHITECTURE.md') && r.has('.serena/project.yml') && r.has('.playwright/chrome/Default/Cookies'));
    assert.deepStrictEqual(pendingOf(r.stamp), []);
    assert.strictEqual(r.local.ALFRED_CODE_MEMORY_DB, path.join(r.repo, '.memory-mcp', 'memory.db'), 'an unmoved project database is still the one named');
});

test('update over a 2.0.0 layout, --data-move move, plugin route: the docs move now, each server\'s data at its launcher\'s next start', POSIX_ONLY, () =>
{
    const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-move', 'move'], UPDATE],
        each: (repo, i) => (i === 0 ? twoZeroLayout(repo) : { stamp: pendingOf(look(repo).stamp), settings: read(path.join(repo, '.claude', 'settings.json')), local: read(path.join(repo, '.claude', 'settings.local.json')) }),
        inspect: look,
    });
    assert.match(outs[1], /docs root: moved \.claude\/docs -> \.alfred\/docs/, outs[1]);
    assert.ok(r.has('.alfred/docs/architecture/ARCHITECTURE.md') && !r.has('.claude/docs'));
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, '.alfred/docs');
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred');
    assert.strictEqual(r.rule, '.alfred/docs');
    assert.deepStrictEqual(pendingOf(r.stamp), [
        'data-pending: browser-chrome .playwright/chrome -> .alfred/browser/chrome',
        'data-pending: memory .memory-mcp -> .alfred/.alfred-memory',
        'data-pending: serena .serena -> .alfred/serena',
    ]);
    assert.ok(r.has('.serena/project.yml') && r.has('.playwright/chrome/Default/Cookies') && r.has('.memory-mcp/memory.db'), 'the live data waits for its launcher');
    for (const target of ['.alfred/serena', '.alfred/browser/chrome', '.alfred/.alfred-memory'])
        assert.ok(!r.has(target), `${target} was created before its launcher moved the data - the move would find it taken`);
    assert.match(outs[1], /restart/i);
    assert.strictEqual(r.local.ALFRED_CODE_MEMORY_DB, path.join(r.real, '.alfred', '.alfred-memory', 'memory.db'));
    // The re-run: the pending moves stay recorded while their data waits, and nothing else changes.
    assert.deepStrictEqual(steps[2], steps[1]);
    assert.doesNotMatch(outs[2], /docs root: moved/);
});

test('update: a pending line goes once its launcher moved the data, and a root it emptied goes with it', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) { put(path.join(repo, '.alfred', 'browser', 'chrome', 'Cookies'), 'c'); return null; }
            if (i === 1)   // the launchers at the next start
            {
                fs.rmSync(path.join(repo, '.data', 'serena'), { recursive: true, force: true });
                fs.renameSync(path.join(repo, '.alfred', 'serena'), path.join(repo, '.data', 'serena'));
                fs.mkdirSync(path.join(repo, '.data', 'browser'), { recursive: true });
                fs.renameSync(path.join(repo, '.alfred', 'browser', 'chrome'), path.join(repo, '.data', 'browser', 'chrome'));
            }
            return null;
        },
        inspect: look,
    });
    assert.deepStrictEqual(pendingOf(r.stamp), []);
    assert.ok(!r.has('.alfred'), 'the old root, emptied by the launchers, is removed');
    assert.ok(r.has('.data/browser/chrome/Cookies') && r.has('.data/docs/.gitignore'));
});

test('update: a pending line goes once its launcher moved the data', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-move', 'move'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) return twoZeroLayout(repo, { memoryDb: false });
            if (i === 1)   // what the launchers do at the next start
            {
                fs.rmSync(path.join(repo, '.alfred', 'serena'), { recursive: true, force: true });
                fs.renameSync(path.join(repo, '.serena'), path.join(repo, '.alfred', 'serena'));
                fs.mkdirSync(path.join(repo, '.alfred', 'browser'), { recursive: true });
                fs.renameSync(path.join(repo, '.playwright', 'chrome'), path.join(repo, '.alfred', 'browser', 'chrome'));
            }
            return null;
        },
        inspect: look,
    });
    assert.deepStrictEqual(pendingOf(r.stamp), []);
});

test('update over a 2.0.0 layout, --data-move move, full copy route: everything moves inline and .mcp.json names the new places', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        prepare: prep, env: COPY_ENV, args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-move', 'move']],
        each: (repo, i) => (i === 0 ? twoZeroLayout(repo) : null), inspect: look,
    });
    assert.ok(r.has('.alfred/serena/project.yml') && !r.has('.serena'), outs[1]);
    assert.strictEqual(r.text('.alfred/browser/chrome/Default/Cookies'), 'session');
    assert.strictEqual(r.text('.alfred/.alfred-memory/memory.db'), 'PROJ');
    assert.deepStrictEqual(pendingOf(r.stamp), []);
    const env = r.mcp.navigation && r.mcp.navigation.env;
    assert.strictEqual(env && env.SERENA_HOME, '.alfred/serena/home', JSON.stringify(r.mcp.navigation));
    assert.ok(r.mcp['browser-chrome'].args.includes('${CLAUDE_PROJECT_DIR:-.}/.alfred/browser/chrome'), JSON.stringify(r.mcp['browser-chrome']));
    assert.strictEqual(r.mcp.memory.env.MCP_MEMORY_SQLITE_PATH, path.join(r.real, '.alfred', '.alfred-memory', 'memory.db'));
    assert.match(r.text('.alfred/serena/home/serena_config.yml'), /project_serena_folder_location: "\$projectDir\/\.alfred\/serena"/);
});

test('update --data-move keep: the old layout stays, the docs root becomes the user\'s, and no later update offers again', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-move', 'keep'], UPDATE],
        each: (repo, i) => (i === 0 ? twoZeroLayout(repo, { memoryDb: false }) : null), inspect: look,
    });
    assert.match(r.stamp, /^data-move: kept$/m);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, '.claude/docs');
    assert.ok(r.has('.serena/project.yml') && r.has('.claude/docs/architecture/ARCHITECTURE.md'));
    assert.doesNotMatch(outs[2], /offers the move/, outs[2]);
});

test('a custom root: --data-path moves everything from .alfred, re-points the docs key and the rule, and a re-run changes nothing', POSIX_ONLY, () =>
{
    const { result: r, outs, steps } = seedRun(['install', 'update', 'update'], SELECTION, {
        prepare: prep, env: COPY_ENV, args: [['--scope', 'project', '--memory-level', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-path', '.data', '--data-move', 'move'], UPDATE],
        each: (repo, i) =>
        {
            if (i === 0) { put(path.join(repo, '.alfred', 'docs', 'architecture', 'ARCHITECTURE.md'), '# a\n'); put(path.join(repo, '.alfred', 'browser', 'chrome', 'Cookies'), 'c'); put(path.join(repo, '.alfred', '.alfred-memory', 'memory.db'), 'M'); }
            return { settings: read(path.join(repo, '.claude', 'settings.json')), mcp: read(path.join(repo, '.mcp.json')) };
        },
        inspect: look,
    });
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.data', outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, '.data/docs');
    assert.strictEqual(r.rule, '.data/docs');
    assert.ok(r.has('.data/docs/architecture/ARCHITECTURE.md') && r.has('.data/serena/project.yml') && r.has('.data/browser/chrome/Cookies') && r.has('.data/.alfred-memory/memory.db'));
    assert.ok(!r.has('.alfred'), 'the emptied old root is gone');
    assert.match(r.text('.data/.gitignore'), /^!\/docs\/$/m);
    assert.strictEqual(r.local.ALFRED_CODE_MEMORY_DB, path.join(r.real, '.data', '.alfred-memory', 'memory.db'));
    assert.deepStrictEqual(steps[2], steps[1], 'a re-run rewrote settings.json or .mcp.json');
});

test('--data-path over existing data with no --data-move changes nothing and says what would', POSIX_ONLY, () =>
{
    const { result: r, outs } = seedRun(['install', 'update'], SELECTION, {
        prepare: prep, args: [['--scope', 'project'], [...UPDATE, '--data-path', '.data']],
        each: (repo, i) => (i === 0 ? put(path.join(repo, '.alfred', 'docs', 'x.md'), 'x') : null), inspect: look,
    });
    assert.match(outs[1], /--data-path \.data not applied - .* --data-move move/, outs[1]);
    assert.strictEqual(r.env.ALFRED_CODE_DATA_PATH, '.alfred');
    assert.ok(r.has('.alfred/docs/x.md') && !r.has('.data'));
});

test('a docs root the user set is never moved - the rest of the data still is', POSIX_ONLY, () =>
{
    const { result: r } = seedRun(['install', 'update'], SELECTION, {
        prepare: prep, env: COPY_ENV, args: [['--scope', 'project', '--browsers', 'chrome'], [...UPDATE, '--data-move', 'move']],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            twoZeroLayout(repo, { memoryDb: false });
            const file = path.join(repo, '.claude', 'settings.json');
            const s = json(file);
            s.env.ALFRED_CODE_DOCS_PATH = 'docs';
            fs.writeFileSync(file, JSON.stringify(s, null, 2));
            put(path.join(repo, 'docs', 'architecture', 'ARCHITECTURE.md'), '# mine\n');
            return null;
        },
        inspect: look,
    });
    assert.strictEqual(r.env.ALFRED_CODE_DOCS_PATH, 'docs');
    assert.strictEqual(r.rule, 'docs');
    assert.ok(r.has('docs/architecture/ARCHITECTURE.md') && !r.has('.alfred/docs/architecture'));
    assert.ok(r.has('.alfred/serena/project.yml'), 'the servers\' data moved all the same');
    assert.doesNotMatch(r.ignore, /!\/docs\//, 'no docs live under the root, so all of it stays out of git');
});
