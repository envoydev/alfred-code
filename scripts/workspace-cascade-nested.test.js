'use strict';
// The cascade counts a listed child that sits in the top's own git repository as nested, not as an unfinished skip.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { putWorkspace } = require('./workspace-fixture.js');

const CLI = path.join(__dirname, 'workspace.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-cascade-nested-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: path.join(TMP, 'acct'), ALFRED_CODE_WORKSPACE: '1' };

const SAME_REPO_LINE = 'cascade: api is part of this repository now - not updated; /alfred-code:update offers to remove its install';

function makeFolder(top, rel, { git = false, record } = {})
{
    const dir = path.join(top, ...rel.split('/'));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    if (git) execFileSync('git', ['init', '-q'], { cwd: dir });
    if (record) putWorkspace(dir, record);
    return fs.realpathSync.native(dir);
}

// A stand-in installer: a --print-plan run writes the read-back, any other run prints nothing and touches .claude/runs.
function fakeSource()
{
    const src = fs.mkdtempSync(path.join(TMP, 'src-'));
    fs.mkdirSync(path.join(src, 'scripts', 'install'), { recursive: true });
    fs.mkdirSync(path.join(src, 'setup-plugin', '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(src, 'setup-plugin', '.claude-plugin', 'plugin.json'), '{ "version": "9.9.9" }\n');
    fs.writeFileSync(path.join(src, 'scripts', 'install', 'alfred-code.js'), [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        `const ws = require(${JSON.stringify(path.join(__dirname, 'install', 'workspace.js'))});`,
        'const a = process.argv.slice(2);',
        `fs.appendFileSync(${JSON.stringify(path.join(src, 'runs.log'))}, fs.realpathSync.native(process.cwd()) + '\\n');`,
        "if (a.includes('--print-plan'))",
        '{',
        "    fs.writeFileSync(a[a.indexOf('--plan-out') + 1], JSON.stringify({ root: ws.realKey(process.cwd()), skills: ['javascript'], before: ['skill javascript'], failures: 0, unreadable: [], blind: false }));",
        '    process.exit(0);',
        '}',
        "fs.appendFileSync(path.join(process.cwd(), '.claude', 'runs'), 'x');",
        '',
    ].join('\n'));
    const ran = () => { try { return fs.readFileSync(path.join(src, 'runs.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
    return { src, ran };
}

const cascade = (top, src) =>
{
    const r = spawnSync(process.execPath, [CLI, 'cascade', '--root', top, '--source', src], { encoding: 'utf8', env: ENV });
    return { out: String(r.stdout || ''), code: r.status };
};

function sameRepoTree({ withWeb = true } = {})
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    const children = withWeb ? ['api', 'web'] : ['api'];
    const ws = makeFolder(top, 'ws', { git: true, record: { children } });
    makeFolder(top, 'ws/api', { record: { parent: '..', children: ['tool'] } });
    makeFolder(top, 'ws/api/tool', { git: true, record: { parent: '..' } });
    if (withWeb) makeFolder(top, 'ws/web', { git: true, record: { parent: '..' } });
    return ws;
}

test('a same-repo child reads nested, prints no !! line, and the summary counts it after skipped', () =>
{
    const ws = sameRepoTree();
    const { src, ran } = fakeSource();
    const r = cascade(ws, src);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^cascade: api\tnested$/m, r.out);
    assert.ok(r.out.split('\n').includes(SAME_REPO_LINE), r.out);
    assert.doesNotMatch(r.out, /^!! /m, r.out);
    assert.match(r.out, /^cascade: done 1 updated, 0 failed, 1 skipped, 1 nested$/m, r.out);
    assert.ok(!ran().some((l) => l.endsWith(path.join('ws', 'api'))), 'no installer ran in the same-repo child');
});

test('a row below a same-repo child stays skipped', () =>
{
    const ws = sameRepoTree();
    const { src } = fakeSource();
    const r = cascade(ws, src);
    assert.match(r.out, /^cascade: api\/tool\tskipped$/m, r.out);
    assert.match(r.out, /^cascade: web\tupdated$/m, r.out);
});

test('the summary has no nested suffix when no child is nested', () =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    const ws = makeFolder(top, 'ws', { git: true, record: { children: ['web'] } });
    makeFolder(top, 'ws/web', { git: true, record: { parent: '..' } });
    const { src } = fakeSource();
    const r = cascade(ws, src);
    assert.match(r.out, /^cascade: done 1 updated, 0 failed, 0 skipped$/m, r.out);
    assert.doesNotMatch(r.out, /nested/, r.out);
});
