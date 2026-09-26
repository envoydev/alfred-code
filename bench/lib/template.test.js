'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { POSIX_ONLY } = require('../test/posix-only.js');
if (POSIX_ONLY)
{
    test('harness process tests', { skip: POSIX_ONLY }, () => {});
    return;
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build, copyInto } = require('./template.js');
const { cellPaths } = require('./cells.js');

const SESSION = { model: 'm', effort: 'medium', permissionMode: 'acceptEdits', settings: {}, env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }, auth: ['ANTHROPIC_API_KEY'], scrub: [] };
const FAKE = [process.execPath, path.join(__dirname, '..', 'test', 'fake-claude.js')];

function fixture(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-tpl-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const src = path.join(dir, 'fixture');
    fs.mkdirSync(src);
    const git = (...a) => execFileSync('git', ['-C', src, ...a], { stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    fs.writeFileSync(path.join(src, 'app.txt'), 'app\n');
    git('add', '.');
    git('-c', 'user.name=b', '-c', 'user.email=b@example.invalid', 'commit', '-q', '-m', 'fixture');
    git('tag', 'bench-fixture-v1');
    return { bench: path.join(dir, 'bench'), source: src, lock: { tag: 'bench-fixture-v1', commit: git('rev-parse', 'HEAD') } };
}

// A setup step that counts its own runs in a file outside the template, and leaves a mark in the
// template's config that names the config's absolute path.
const counter = (file) => ['node', '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(file)},'x');fs.writeFileSync(process.argv[1]+'/where.json',JSON.stringify({config:process.argv[1],home:process.env.HOME}))`, '{config}'];

function arm(setup, extra = {})
{
    return { name: 'solo', pin: { kind: 'tag', value: 'v1' }, setup, onboarding: [], expects: [], env: {}, hash: 'abcdef0123456789', ...extra };
}

// A setup step that writes a JSON file under {config} or {repo}, as an installer or the CLI would.
const writeJson = (where, rel, value) => ['node', '-e', `const fs=require('fs'),p=require('path');const f=p.join(process.argv[1],${JSON.stringify(rel)});fs.mkdirSync(p.dirname(f),{recursive:true});fs.writeFileSync(f,process.argv[2].split('@REPO@').join(process.argv[3]))`, where, JSON.stringify(value), '{repo}'];
const localSettings = (paths) => JSON.parse(fs.readFileSync(path.join(paths.repo, '.claude', 'settings.local.json'), 'utf8'));
const PLUGINS = [
    { id: 'stack@market', enabled: true, installPath: '/x/cache/stack/1.0.0', mcpServers: { serena: {}, memory: {} } },
    { id: 'parked@market', enabled: false, installPath: '/x/cache/parked/1.0.0', mcpServers: { never: {} } },
    { id: 'lsp@official', enabled: true, installPath: '/x/cache/lsp/1.0.0' },
];

test('a template is built once per arm and pin, and serves every cell', (t) =>
{
    const f = fixture(t);
    const runs = path.join(path.dirname(f.bench), 'runs.txt');
    const a = arm([counter(runs)]);
    const first = build({ claude: FAKE, arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const second = build({ claude: FAKE, arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    assert.strictEqual(first.built, true);
    assert.strictEqual(second.built, false);
    assert.strictEqual(fs.readFileSync(runs, 'utf8'), 'x');
    assert.ok(fs.existsSync(path.join(first.paths.repo, 'app.txt')));
    assert.deepStrictEqual(execFileSync('git', ['-C', first.paths.repo, 'remote'], { stdio: 'pipe' }).toString().trim(), '', 'no way back to the source repo');
});

test('each cell gets its own copy: what one cell writes into its config or home the next never sees', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([counter(path.join(path.dirname(f.bench), 'runs.txt'))]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const one = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    const two = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 2 });
    copyInto(paths, one);
    fs.writeFileSync(path.join(one.config, 'leak.txt'), 'x');
    fs.mkdirSync(one.home, { recursive: true });
    fs.writeFileSync(path.join(one.home, 'leak.txt'), 'x');
    fs.writeFileSync(path.join(one.repo, 'app.txt'), 'changed\n');
    copyInto(paths, two);
    assert.ok(!fs.existsSync(path.join(two.config, 'leak.txt')));
    assert.ok(!fs.existsSync(path.join(two.home, 'leak.txt')));
    assert.ok(!fs.existsSync(path.join(paths.config, 'leak.txt')), 'the template itself is never written');
    assert.strictEqual(fs.readFileSync(path.join(two.repo, 'app.txt'), 'utf8'), 'app\n');
});

test('an absolute template path inside a copied file is rewritten to the cell\'s own', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([counter(path.join(path.dirname(f.bench), 'runs.txt'))]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const cell = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    copyInto(paths, cell);
    const where = JSON.parse(fs.readFileSync(path.join(cell.config, 'where.json'), 'utf8'));
    assert.deepStrictEqual(where, { config: cell.config, home: cell.home });
});

test('a failed setup step leaves no template, and names the step', (t) =>
{
    const f = fixture(t);
    const a = arm([['node', '-e', '0'], ['node', '-e', 'process.exit(3)']]);
    assert.throws(() => build({ claude: FAKE, arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock }), /solo setup step 2 \(node\) exited 3/);
    assert.ok(!fs.existsSync(path.join(f.bench, 'work', 'templates', 'solo-abcdef01')));
});

test('the restore steps run in the template repo after setup and before onboarding, with no credential', (t) =>
{
    const f = fixture(t);
    const log = path.join(path.dirname(f.bench), 'order.txt');
    const step = (tag) => ['node', '-e', `require('fs').appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(tag)} + ':' + process.cwd() + ':' + ('ANTHROPIC_API_KEY' in process.env) + '\\n')`];
    const session = { ...SESSION, restore: [step('restore')] };
    const { paths } = build({ claude: FAKE, arm: arm([step('setup')], { onboarding: ['/init'] }), session, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, base: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'k'.repeat(24) }, onboard: () => fs.appendFileSync(log, 'onboard\n') });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.deepStrictEqual(lines.map((l) => l.split(':')[0]), ['setup', 'restore', 'onboard']);
    assert.strictEqual(fs.realpathSync(lines[1].split(':')[1]), fs.realpathSync(paths.repo));
    assert.strictEqual(lines[1].split(':')[2], 'false');
});

test('a failed restore leaves no template, and names the command', (t) =>
{
    const f = fixture(t);
    const session = { ...SESSION, restore: [['node', '-e', 'process.exit(4)']] };
    assert.throws(() => build({ claude: FAKE, arm: arm([]), session, benchDir: f.bench, fixtureSource: f.source, lock: f.lock }), /solo package restore \(node -e process\.exit\(4\)\) exited 4/);
    assert.ok(!fs.existsSync(path.join(f.bench, 'work', 'templates', 'solo-abcdef01')));
});

test('the restored package folder is copied but never scanned for template paths', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const pkg = path.join(paths.home, '.nuget', 'packages', 'x', '1.0.0');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'x.nuspec'), `built in ${paths.home}\n`);
    fs.writeFileSync(path.join(paths.home, 'note.txt'), `built in ${paths.home}\n`);
    const cell = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    copyInto(paths, cell);
    assert.strictEqual(fs.readFileSync(path.join(cell.home, 'note.txt'), 'utf8'), `built in ${cell.home}\n`);
    assert.strictEqual(fs.readFileSync(path.join(cell.home, '.nuget', 'packages', 'x', '1.0.0', 'x.nuspec'), 'utf8'), `built in ${paths.home}\n`, 'package files carry no account path worth the scan');
});

// The B4 read found the template's own repo/.claude/settings.local.json naming the template's home by
// its OS-resolved (realpath) spelling while the harness's own paths.home carries the given, unresolved
// one (os.tmpdir() is a symlink on macOS) - a spelling the plain pairs list never matched, so the value
// survived into the cell unrewritten, still pointing at a directory the next template build wipes.
test('a settings value naming the template home by its realpath spelling is still rewritten into the cell\'s own home', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const real = fs.realpathSync(paths.home);
    if (real === paths.home) { t.skip('this filesystem gives no second spelling of the template home to test'); return; }
    fs.mkdirSync(path.join(paths.repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(paths.repo, '.claude', 'settings.local.json'), JSON.stringify({ env: { ALFRED_CODE_MEMORY_DB: path.join(real, '.memory-mcp', 'memory.db') } }));
    const cell = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    copyInto(paths, cell);
    const written = JSON.parse(fs.readFileSync(path.join(cell.repo, '.claude', 'settings.local.json'), 'utf8'));
    assert.strictEqual(written.env.ALFRED_CODE_MEMORY_DB, path.join(cell.home, '.memory-mcp', 'memory.db'), 'the realpath spelling maps to the cell\'s own home, not the template\'s');
});

test('a cell whose copied local settings still name the template directory is refused, not served', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    fs.mkdirSync(path.join(paths.repo, '.claude'), { recursive: true });
    // A realistic gap the pairs list cannot close: a file past the rewrite's own size cap (REWRITE_MAX_BYTES)
    // is never scanned, so whatever it names of the template survives into the cell exactly as written.
    const padding = 'x'.repeat(5 * 1024 * 1024);
    fs.writeFileSync(path.join(paths.repo, '.claude', 'settings.local.json'), JSON.stringify({ note: `see ${paths.repo}`, padding }));
    const cell = cellPaths({ benchDir: f.bench, run: 'r1', arm: 'solo', task: 't1', rep: 1 });
    assert.throws(() => copyInto(paths, cell), /solo\/t1\/r1: \.claude\/settings\.local\.json still names the template/);
    assert.ok(!fs.existsSync(cell.work), 'no half-leaked cell is left behind');
});

test('a failed onboarding leaves no template either', (t) =>
{
    const f = fixture(t);
    const a = arm([], { onboarding: ['/init'] });
    const onboard = () => { throw new Error('session exited 1'); };
    assert.throws(() => build({ claude: FAKE, arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard }), /solo onboarding 1: session exited 1/);
    assert.ok(!fs.existsSync(path.join(f.bench, 'work', 'templates', 'solo-abcdef01')));
});

test('onboarding runs each prompt in the template repo with the template\'s own account and home', (t) =>
{
    const f = fixture(t);
    const seen = [];
    const onboard = (prompt, where) => seen.push({ prompt, cwd: where.cwd, config: where.config, home: where.home });
    const { paths } = build({ claude: FAKE, arm: arm([], { onboarding: ['/init', 'second'] }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard });
    assert.deepStrictEqual(seen.map((s) => s.prompt), ['/init', 'second']);
    for (const s of seen) assert.deepStrictEqual([s.cwd, s.config, s.home], [paths.repo, paths.config, paths.home]);
});

test('each onboarding prompt gets its own temp dir, removed after it', (t) =>
{
    const f = fixture(t);
    const seen = [];
    build({ claude: FAKE, arm: arm([], { onboarding: ['/init', 'second'], expects: ['app.txt'] }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard: (prompt, where) => seen.push({ tmp: where.env.TMPDIR, cc: where.env.CLAUDE_CODE_TMPDIR, named: where.tmp, there: fs.existsSync(where.env.TMPDIR) }) });
    assert.strictEqual(seen.length, 2);
    assert.notStrictEqual(seen[0].tmp, seen[1].tmp);
    for (const s of seen) assert.ok(s.there && s.cc === s.tmp && s.named === s.tmp && !fs.existsSync(s.tmp));
});

test('onboarding gets only the credential the run chose, and setup gets none', (t) =>
{
    const f = fixture(t);
    const seen = [];
    const session = { ...SESSION, auth: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] };
    const base = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'k'.repeat(24), CLAUDE_CODE_OAUTH_TOKEN: 't'.repeat(24) };
    build({ claude: FAKE, arm: arm([], { onboarding: ['/init'] }), session, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, base, auth: 'CLAUDE_CODE_OAUTH_TOKEN', onboard: (prompt, where) => seen.push(where.env) });
    assert.strictEqual(seen[0].CLAUDE_CODE_OAUTH_TOKEN, base.CLAUDE_CODE_OAUTH_TOKEN);
    assert.ok(!('ANTHROPIC_API_KEY' in seen[0]));
});

test('a template under a CLAUDE.md is refused before its setup runs, and a work root moves it out of the bench dir', (t) =>
{
    const f = fixture(t);
    const runs = path.join(path.dirname(f.bench), 'runs.txt');
    const workRoot = path.join(path.dirname(f.bench), 'host', 'work');
    fs.mkdirSync(workRoot, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(workRoot), 'CLAUDE.md'), '# host rules\n');
    assert.throws(() => build({ claude: FAKE, arm: arm([counter(runs)]), session: SESSION, benchDir: f.bench, workRoot, fixtureSource: f.source, lock: f.lock }), /the template sits under .*CLAUDE\.md/);
    assert.ok(!fs.existsSync(runs), 'no setup step ran');
    fs.rmSync(path.join(path.dirname(workRoot), 'CLAUDE.md'));
    const out = build({ claude: FAKE, arm: arm([counter(runs)]), session: SESSION, benchDir: f.bench, workRoot, fixtureSource: f.source, lock: f.lock });
    assert.strictEqual(out.paths.dir, path.join(workRoot, 'templates', 'solo-abcdef01'));
    assert.ok(!fs.existsSync(path.join(f.bench, 'work')));
});

test('each enabled plugin\'s MCP servers, every registered server and the arm\'s own plugin code are pre-approved in the template\'s local settings', (t) =>
{
    const f = fixture(t);
    const a = arm([
        writeJson('{config}', '.claude.json', { mcpServers: { userwide: {} }, projects: { '@REPO@': { mcpServers: { localone: {} } } } }),
        writeJson('{repo}', '.mcp.json', { mcpServers: { projectone: {} } }),
        writeJson('{config}', 'plugins/known_marketplaces.json', { market: { installLocation: '/x/market' } }),
        writeJson('{repo}', '.claude/settings.local.json', { env: { KEEP: '1' }, permissions: { allow: ['Bash(make *)'], deny: ['Read(./.env)'] } }),
    ], { env: { FAKE_PLUGINS: JSON.stringify(PLUGINS) } });
    const { paths } = build({ claude: FAKE, arm: a, session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    const local = localSettings(paths);
    assert.deepStrictEqual(local.env, { KEEP: '1' }, 'what the arm wrote there is kept');
    assert.deepStrictEqual(local.permissions.deny, ['Read(./.env)']);
    assert.deepStrictEqual(local.permissions.allow, [
        'Bash(make *)',
        'mcp__plugin_stack_serena__*', 'mcp__plugin_stack_memory__*',
        'mcp__userwide__*', 'mcp__localone__*', 'mcp__projectone__*',
        'Read(//x/market/**)', 'Read(//x/cache/stack/1.0.0/**)', 'Read(//x/cache/lsp/1.0.0/**)',
    ]);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(paths.dir, 'grants.json'), 'utf8')), local.permissions.allow.slice(1), 'the grants are recorded beside READY');
});

test('the grant is the same rule for every arm: an arm with nothing installed gets no settings file at all', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    assert.ok(!fs.existsSync(path.join(paths.repo, '.claude')), 'bare stays bare');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(paths.dir, 'grants.json'), 'utf8')), []);
});

test('a plugin list the CLI cannot give fails the template, naming the step', (t) =>
{
    const f = fixture(t);
    assert.throws(() => build({ claude: FAKE, arm: arm([], { env: { FAKE_PLUGINS_FAIL: '1' } }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock }), /solo plugin list \(after setup\) exited 1/);
});

test('the MCP servers are warmed once, after the grants and before onboarding, with a connect timeout long enough for a cold uv cache', (t) =>
{
    const f = fixture(t);
    const warm = path.join(path.dirname(f.bench), 'warm.jsonl');
    const order = [];
    const shared = { UV_CACHE_DIR: '/w/uv/cache', UV_PYTHON_INSTALL_DIR: '/w/uv/python' };
    const { paths } = build({ claude: FAKE, arm: arm([], { onboarding: ['/init'], expects: ['CLAUDE.md'], env: { FAKE_WARM_RECORD: warm } }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, shared,
        onboard: (prompt, where) => { order.push(fs.existsSync(warm) ? 'onboard after warm' : 'onboard before warm'); assert.deepStrictEqual([where.env.UV_CACHE_DIR, where.env.UV_PYTHON_INSTALL_DIR], ['/w/uv/cache', '/w/uv/python']); fs.writeFileSync(path.join(where.cwd, 'CLAUDE.md'), '# made\n'); } });
    const rows = fs.readFileSync(warm, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 1, 'warmed once');
    assert.strictEqual(rows[0].MCP_TIMEOUT, '600000');
    assert.deepStrictEqual([rows[0].UV_CACHE_DIR, rows[0].UV_PYTHON_INSTALL_DIR], ['/w/uv/cache', '/w/uv/python']);
    assert.strictEqual(fs.realpathSync(rows[0].cwd), fs.realpathSync(paths.repo));
    assert.deepStrictEqual(order, ['onboard after warm']);
    assert.match(fs.readFileSync(path.join(paths.dir, 'mcp-warm.txt'), 'utf8'), /Connected/);
});

test('after onboarding the template records the CLI\'s plugin list beside READY', (t) =>
{
    const f = fixture(t);
    const { paths } = build({ claude: FAKE, arm: arm([], { onboarding: ['/init'], expects: ['CLAUDE.md'], env: { FAKE_PLUGINS: JSON.stringify(PLUGINS) } }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock,
        onboard: (prompt, where) => fs.writeFileSync(path.join(where.cwd, 'CLAUDE.md'), '# made\n') });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(paths.dir, 'plugins.json'), 'utf8')), PLUGINS);
    assert.ok(fs.existsSync(path.join(paths.dir, 'READY.json')));
});

test('an onboarding that left an expected output missing or empty fails the template loudly, and keeps its transcripts', (t) =>
{
    for (const leave of [null, ''])
    {
        const f = fixture(t);
        const onboard = (prompt, where) =>
        {
            fs.mkdirSync(path.join(where.dir, 'onboarding'), { recursive: true });
            fs.writeFileSync(path.join(where.dir, 'onboarding', '1.jsonl'), '{"type":"user"}\n');
            if (leave !== null) fs.writeFileSync(path.join(where.cwd, 'CLAUDE.md'), leave);
        };
        const dir = path.join(f.bench, 'work', 'templates', 'solo-abcdef01');
        assert.throws(() => build({ claude: FAKE, arm: arm([], { onboarding: ['/init'], expects: ['CLAUDE.md'] }), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock, onboard }),
            (err) => /solo onboarding left CLAUDE\.md missing or empty - the arm is not set up, so no cell may run on it/.test(err.message) && err.message.includes(`${dir}.failed`));
        assert.ok(!fs.existsSync(dir), 'no template is served');
        assert.ok(fs.existsSync(path.join(`${dir}.failed`, 'onboarding', '1.jsonl')), 'the onboarding transcript is kept to read');
    }
});

test('a template left half-built by a killed driver is rebuilt, never served', (t) =>
{
    const f = fixture(t);
    const runs = path.join(path.dirname(f.bench), 'runs.txt');
    const half = path.join(f.bench, 'work', 'templates', 'solo-abcdef01', 'repo');
    fs.mkdirSync(half, { recursive: true });
    fs.writeFileSync(path.join(half, 'stale.txt'), 'x');
    const out = build({ claude: FAKE, arm: arm([counter(runs)]), session: SESSION, benchDir: f.bench, fixtureSource: f.source, lock: f.lock });
    assert.strictEqual(out.built, true);
    assert.ok(!fs.existsSync(path.join(out.paths.repo, 'stale.txt')));
});
