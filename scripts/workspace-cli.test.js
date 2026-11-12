'use strict';
// The workspace CLI (plan Task 11): one verb per test over throwaway trees, each read back from the files it wrote.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ws = require('./install/workspace.js');
const { valueHash } = require('./install/stamp.js');
const { putWorkspace, readWorkspaceRecord, readWorkspaceValues } = require('./workspace-fixture.js');

const CLI = path.join(__dirname, 'workspace.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-cli-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: path.join(TMP, 'acct') };
ENV.ALFRED_CODE_WORKSPACE = '1';   // on by default since 3.0.0; pinned so a launch 0 in the caller's env cannot freeze it

// { rel: { stamp, git, record, file } } under a fresh folder; returns rel -> real path.
const tree = (spec) =>
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    for (const [rel, o] of Object.entries(spec))
    {
        const dir = path.join(top, ...rel.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        if (o.git) execFileSync('git', ['init', '-q'], { cwd: dir });
        if (o.stamp) { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'alfred-code.stamp'), 'sha: x\n'); }
        if (o.record !== undefined) putWorkspace(dir, o.record, o.legacy ? { legacy: true } : {});
    }
    return (rel = '.') => fs.realpathSync.native(path.join(top, ...rel.split('/')));
};
const cli = (...argv) => { const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8', env: ENV }); return { out: r.stdout, err: r.stderr, code: r.status }; };
// The record's set values, through the fixture's one reader (null when the project holds none).
const wsFile = (root, dataRoot = '.alfred') => readWorkspaceValues(root, { dataRoot });
const stampText = (root) => fs.readFileSync(path.join(root, '.claude', 'alfred-code.stamp'), 'utf8');
const joined = () => tree({ ws: { stamp: true, record: { children: ['api'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } });

test('parent prints none, a joinable parent, or the reason a folder cannot be a child', () =>
{
    const at = tree({ alone: { git: true }, ws: { stamp: true }, 'ws/api': { git: true }, 'ws/plain': {}, repo: { stamp: true, git: true }, 'repo/sub': {} });
    assert.deepStrictEqual(cli('parent', '--root', at('alone')), { out: 'parent: none\n', err: '', code: 0 });
    assert.strictEqual(cli('parent', '--root', at('ws/api')).out, 'parent: ..\tchild=yes\n');
    assert.strictEqual(cli('parent', '--root', at('ws/plain')).out, 'parent: ..\tchild=no\twhy=not-a-checkout\n');
    assert.strictEqual(cli('parent', '--root', at('repo/sub')).out, 'parent: ..\tchild=no\twhy=same-repo\n');
});

test('register writes the parent line here and the child line in the parent, the parent\'s first', () =>
{
    const at = tree({ ws: { stamp: true }, 'ws/apps/api': { git: true } });
    const r = cli('register', '--root', at('ws/apps/api'));
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.strictEqual(r.out, 'workspace: parent ../.. written\nworkspace: child apps/api written in ../..\n');
    assert.deepStrictEqual(wsFile(at('ws/apps/api')), { parent: '../..' });
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['apps/api'] });
    const again = cli('register', '--root', at('ws/apps/api'));
    assert.strictEqual(again.code, 0);
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['apps/api'] }, 'a second register writes no second line');
    const none = tree({ alone: { git: true } });
    const refused = cli('register', '--root', none('alone'));
    assert.strictEqual(refused.code, 2);
    assert.match(refused.out, /^!! workspace: /m);
});

test('a held parent lock exits 3 and leaves neither file written', () =>
{
    const at = tree({ ws: { stamp: true, record: {} }, 'ws/api': { git: true } });
    fs.writeFileSync(path.join(at('ws'), '.alfred', 'workspace.lock'), String(process.pid));
    const r = cli('register', '--root', at('ws/api'));
    assert.strictEqual(r.code, 3, r.out);
    assert.match(r.out, /^!! workspace: .*locked.*the join is offered again at the next update/m);
    assert.deepStrictEqual(wsFile(at('ws')), {});
    assert.strictEqual(wsFile(at('ws/api')), null);
});

test('unregister removes the parent\'s child line and this project\'s parent line', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api', 'web'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..', ignore: { skill: ['x'] } } } });
    const r = cli('unregister', '--root', at('ws/api'));
    assert.strictEqual(r.code, 0, r.out);
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['web'] });
    assert.deepStrictEqual(wsFile(at('ws/api')), { ignore: { skill: ['x'] } });
});

test('join --answer none writes role standalone, join joins as the role ask\'s Child does, and any other answer is bad input', () =>
{
    const at = tree({ ws: { stamp: true }, 'ws/api': { git: true }, 'ws/web': { git: true } });
    assert.strictEqual(cli('join', '--root', at('ws/web'), '--answer', 'none').out, 'role: standalone\njoin: none\n');
    assert.deepStrictEqual(wsFile(at('ws/web')), { role: 'standalone', above: '..' });
    const r = cli('join', '--root', at('ws/api'), '--answer', 'join');
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /role: child of \.\.\njoin: join\n$/);
    assert.deepStrictEqual(wsFile(at('ws/api')), { parent: '..', above: '..' });
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['api'] });
    const bad = cli('join', '--root', at('ws/api'), '--answer', 'maybe');
    assert.strictEqual(bad.code, 2);
    assert.match(bad.out, /^!! workspace: --answer takes join or none/m);
});

// Every file under `dir` by its posix path, the folders in `skip` left out.
const filesOf = (dir, skip = []) =>
{
    const out = {};
    const walk = (d) =>
    {
        for (const e of fs.readdirSync(d, { withFileTypes: true }))
        {
            const p = path.join(d, e.name);
            const rel = path.relative(dir, p).split(path.sep).join('/');
            if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
            if (e.isDirectory()) walk(p);
            else out[rel] = fs.readFileSync(p, 'utf8');
        }
    };
    walk(dir);
    return out;
};
const asksOf = (text) => text.split('\n').filter((l) => l.startsWith('ask: ')).map((l) => l.slice('ask: '.length).split('\t'));

test('AC2: role --when init prints the role and one ask line per option, Recommended first; Child changes the parent by its one child line', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['web'] } }, 'ws/web': { stamp: true, git: true, record: { parent: '..' } }, 'ws/api': { git: true }, 'ws/web/sub': {} });
    assert.strictEqual(cli('role', '--root', at('ws/api'), '--when', 'init').out, 'role: standalone (no role recorded)\nask: Child of .. (Recommended)\tchild\nask: Standalone\tstandalone\nask: Root\troot\n');
    assert.strictEqual(cli('role', '--root', at('ws/web/sub'), '--when', 'init').out,
        'role: standalone (no role recorded)\nwhy: .. is the same git repository - this folder is part of it, not a project of its own\nask: Standalone (Recommended)\tstandalone\nask: Root\troot\n');
    const before = filesOf(at('ws'), ['api']);
    const r = cli('role', '--root', at('ws/api'), '--answer', 'child');
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^role: child of \.\.$/m);
    const after = filesOf(at('ws'), ['api']);
    // the record itself converts at this write (the old file becomes workspace.json); no other file appears or goes
    const isRecord = (rel) => /^\.alfred\/workspace(\.json)?$/.test(rel);
    const others = (files) => Object.keys(files).filter((rel) => !isRecord(rel)).sort();
    assert.deepStrictEqual(others(after), others(before), 'no file appeared or went in the parent\'s tree');
    for (const rel of Object.keys(before)) if (!isRecord(rel)) assert.strictEqual(after[rel], before[rel], rel);
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['web', 'api'] }, 'the parent changed by exactly its one child');
    assert.deepStrictEqual(wsFile(at('ws/api')), { parent: '..', above: '..' });
    assert.strictEqual(cli('role', '--root', at('ws/api'), '--when', 'init', '--answer', 'nonsense').code, 2);
    assert.strictEqual(cli('role', '--root', at('ws/api'), '--when', 'later').code, 2, 'a --when outside init, update and configure is bad input');
});

test('AC3 + AC4: each tree change asks once at update; the first option applied unattended leaves two more updates quiet with no file changed', () =>
{
    const cases = {
        never: [{ ws: { stamp: true }, 'ws/api': { stamp: true, git: true } }, 'ws/api', 'Join .. (Recommended)', 'child of ..'],
        above: [{ ws: { stamp: true }, 'ws/api': { stamp: true, git: true, record: { role: 'standalone', above: 'none' } } }, 'ws/api', 'Join .. (Recommended)', 'child of ..'],
        'parent-gone': [{ ws: {}, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } }, 'ws/api', 'Become standalone (Recommended)', 'standalone'],
        rejoin: [{ ws: { stamp: true, record: {} }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } } }, 'ws/api', 'Rejoin .. (Recommended)', 'child of ..'],
        between: [{ ws: { stamp: true, record: { children: ['apps/api'] } }, 'ws/apps': { stamp: true }, 'ws/apps/api': { stamp: true, git: true, record: { parent: '../..' } } }, 'ws/apps/api', 'Stay child of ../.. (Recommended)', 'child of ../..'],
    };
    for (const [kind, [spec, rel, first, role]] of Object.entries(cases))
    {
        const at = tree(spec);
        const asks = asksOf(cli('role', '--root', at(rel), '--when', 'update').out);
        assert.strictEqual(asks[0][0], first, kind);
        const r = cli('role', '--root', at(rel), '--answer', asks[0][1]);
        assert.strictEqual(r.code, 0, `${kind}: ${r.out}`);
        const files = filesOf(at('ws'));
        for (let i = 0; i < 2; i++) assert.strictEqual(cli('role', '--root', at(rel), '--when', 'update').out, `role: ${role}\n`, `${kind}: update ${i + 1} asks nothing`);
        assert.deepStrictEqual(filesOf(at('ws')), files, `${kind}: no file changed`);
    }
    const off = tree({ ws: { stamp: true }, 'ws/api': { stamp: true, git: true } });
    const r = spawnSync(process.execPath, [CLI, 'role', '--root', off('ws/api'), '--when', 'update'], { encoding: 'utf8', env: { ...ENV, ALFRED_CODE_WORKSPACE: '0' } });
    assert.strictEqual(r.stdout, 'role: workspace off\n', 'the kill switch asks nothing');
});

test('AC5: configure\'s moves write D1\'s lines; root to standalone with a child is refused, naming it; Keep is first in each', () =>
{
    const at = tree({ ws: { stamp: true }, 'ws/api': { stamp: true, git: true }, 'ws/web': { stamp: true, git: true } });
    const answer = (rel, a) => { const r = cli('role', '--root', at(rel), '--answer', a); assert.strictEqual(r.code, 0, `${rel} ${a}: ${r.out}`); return r.out; };
    assert.deepStrictEqual(asksOf(cli('role', '--root', at('ws/api')).out)[0], ['Keep (Recommended)', 'stay']);
    answer('ws/api', 'root');
    assert.deepStrictEqual(wsFile(at('ws/api')), { role: 'root', above: '..' }, 'standalone to root');
    answer('ws/api', 'join:..');
    assert.deepStrictEqual(wsFile(at('ws/api')), { parent: '..', above: '..' }, 'root to child: the role line goes');
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['api'] });
    assert.deepStrictEqual(asksOf(cli('role', '--root', at('ws/api')).out).map((a) => a[0]), ['Keep (Recommended)', 'Leave and become standalone', 'Leave and become a root']);
    answer('ws/api', 'leave:standalone');
    assert.deepStrictEqual(wsFile(at('ws/api')), { role: 'standalone', above: '..' }, 'child to standalone');
    assert.deepStrictEqual(wsFile(at('ws')), {});
    answer('ws/web', 'child');
    answer('ws/web', 'leave:root');
    assert.deepStrictEqual(wsFile(at('ws/web')), { role: 'root', above: '..' }, 'child to root');
    answer('ws/web', 'join:..');
    assert.deepStrictEqual(asksOf(cli('role', '--root', at('ws')).out)[0], ['Keep (Recommended)', 'stay']);
    const before = wsFile(at('ws'));
    const refused = cli('role', '--root', at('ws'), '--answer', 'standalone');
    assert.strictEqual(refused.code, 2, refused.out);
    assert.match(refused.out, /^!! workspace: this project is the root of web - each child leaves first/m);
    assert.deepStrictEqual(wsFile(at('ws')), before, 'the refusal wrote nothing');
});

test('AC6: status prints child of .., root of 2 children, standalone, standalone (no role recorded) and workspace off', () =>
{
    const at = tree({
        ws: { stamp: true, record: { children: ['api', 'web'] } },
        'ws/api': { stamp: true, git: true, record: { parent: '..' } },
        'ws/web': { stamp: true, git: true, record: { parent: '..' } },
        solo: { stamp: true, git: true, record: { role: 'standalone', above: 'none' } },
        fresh: { stamp: true, git: true },
    });
    const first = (rel, e = ENV) => spawnSync(process.execPath, [CLI, 'status', '--root', at(rel)], { encoding: 'utf8', env: e }).stdout.split('\n')[0];
    assert.strictEqual(first('ws/api'), 'role: child of ..');
    assert.strictEqual(first('ws'), 'role: root of 2 children');
    assert.strictEqual(first('solo'), 'role: standalone');
    assert.strictEqual(first('fresh'), 'role: standalone (no role recorded)');
    assert.strictEqual(first('ws/api', { ...ENV, ALFRED_CODE_WORKSPACE: '0' }), 'role: workspace off');
});

// R067 (burn-down 2026-11-04): the excludes are written for every stamped folder above, joined or not, so validate's load
// check keys on this count, never on a linked parent alone.
test('R067: status counts the installed folders above, an unlinked nested project included', () =>
{
    const at = tree({
        ws: { stamp: true, record: { role: 'root' } },
        'ws/nested': { stamp: true, git: true, record: { role: 'standalone', above: '..' } },
        'ws/api': { stamp: true, git: true },
        solo: { stamp: true, git: true },
    });
    const line = (rel, e = ENV) => spawnSync(process.execPath, [CLI, 'status', '--root', at(rel)], { encoding: 'utf8', env: e }).stdout.split('\n').find((l) => l.startsWith('installed-above: '));
    assert.strictEqual(line('ws/nested'), 'installed-above: 1', 'a nested project that never joined still carries the excludes');
    assert.strictEqual(line('ws/api'), 'installed-above: 1');
    assert.strictEqual(line('solo'), 'installed-above: 0');
    assert.strictEqual(line('ws/nested', { ...ENV, ALFRED_CODE_WORKSPACE: '0' }), 'installed-above: 0', 'off freezes every lookup');
});

test('R067: validate runs its load check wherever an installed folder sits above, joined or not', () =>
{
    const body = fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', 'commands', 'validate.md'), 'utf8');
    assert.match(body, /node "\$TMP\/repo\/scripts\/workspace\.js" status --root \. \| grep -qE '\^installed-above: \[1-9\]' && node "\$TMP\/repo\/scripts\/workspace\.js" check-loads --root \./);
    assert.doesNotMatch(body, /grep -q '\^workspace: parent \\\.\\\.' && node "\$TMP\/repo\/scripts\/workspace\.js" check-loads/);
});

test('status prints show\'s notes: the HOOKS_OFF line, the not-read line and the credential line, never a value (AC17)', () =>
{
    const at = joined();
    const token = `ghp_${'Q7'.repeat(14)}`;
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', '.variables'), `ALFRED_CODE_HOOKS_OFF=guard-secret-value\nALFRED_CODE_CONFIG_PROTECT=0\nALFRED_CODE_X_TOKEN=${token}\n`);
    const r = cli('status', '--root', at('ws/api'));
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^!! variables: ALFRED_CODE_HOOKS_OFF in \.variables is not read - it lives in \.claude\/settings\.json$/m);
    assert.match(r.out, /^!! variables: ALFRED_CODE_CONFIG_PROTECT in \.variables is not read - only the stack's variables are; a guard switch stays in \.claude\/settings\.json$/m);
    assert.match(r.out, /^!! variables: ALFRED_CODE_X_TOKEN in \.variables looks like a credential - keep it in \.alfred\/\.secrets$/m);
    assert.ok(!r.out.includes(token) && !r.out.includes('guard-secret-value'), 'no value printed');
});

test('status prints each chain key with its source and no value', () =>
{
    const at = joined();
    const value = (n) => `v${n}-${'Z9'.repeat(8)}`;
    fs.writeFileSync(path.join(at('ws'), '.alfred', '.secrets'), `SHARED_TOKEN=${value(1)}\nROOT_ONLY=${value(2)}\n`);
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', '.secrets'), `SHARED_TOKEN=${value(3)}\nAPI_ONLY=${value(4)}\n`);
    const r = cli('status', '--root', at('ws/api'));
    assert.strictEqual(r.code, 0, r.out);
    const lines = r.out.split('\n').filter((l) => l.startsWith('secrets: '));
    assert.deepStrictEqual(lines.sort(), ['secrets: API_ONLY own', 'secrets: ROOT_ONLY from ..', 'secrets: SHARED_TOKEN own'].sort());
    for (const n of [1, 2, 3, 4]) assert.ok(!r.out.includes(value(n)), 'no value printed');
});

// The CLI loads hook-prelude for its blocking stdio, and the prelude applies the chain to process.env at load: show must
// still name where each value comes from, run from the project as status runs it - never `env` for an inherited one.
test('variables.js show run from the project names an inherited value from <rel>, not env', () =>
{
    const at = joined();
    fs.writeFileSync(path.join(at('ws'), '.alfred', '.variables'), 'ALFRED_CODE_SCORER_LEVEL=90\n');
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', '.variables'), 'ALFRED_CODE_HISTORY=4\n');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'variables.js'), 'show', '--root', '.'], { cwd: at('ws/api'), encoding: 'utf8', env: ENV });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ALFRED_CODE_SCORER_LEVEL=90 \(from \.\.\)$/m, r.stdout);
    assert.match(r.stdout, /^ALFRED_CODE_HISTORY=4 \(own\)$/m);
    assert.match(r.stdout, /^ALFRED_CODE_TURN_CHECK=0 \(default\)$/m, 'a key no file holds reads its default, not the env the prelude filled');
});

test('ignore --add and --remove edit this project\'s ignore lines', () =>
{
    const at = joined();
    assert.strictEqual(cli('ignore', '--root', at('ws/api'), '--add', 'skill sqlite').code, 0);
    assert.strictEqual(cli('ignore', '--root', at('ws/api'), '--add', 'env ALFRED_CODE_SCORER').code, 0);
    assert.deepStrictEqual(wsFile(at('ws/api')), { parent: '..', ignore: { skill: ['sqlite'], env: ['ALFRED_CODE_SCORER'] } });
    assert.strictEqual(cli('ignore', '--root', at('ws/api'), '--remove', 'skill sqlite').code, 0);
    assert.deepStrictEqual(wsFile(at('ws/api')), { parent: '..', ignore: { env: ['ALFRED_CODE_SCORER'] } });
    assert.strictEqual(cli('ignore', '--root', at('ws/api'), '--add', 'colour blue').code, 2);
});

test('children prints each direct child as ok or gone', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api', 'gone', 'deep/web'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['tool'] } }, 'ws/api/tool': { stamp: true }, 'ws/deep/web': { stamp: true } });
    assert.strictEqual(cli('children', '--root', at('ws')).out, 'child: api\tok\nchild: gone\tgone\nchild: deep/web\tok\n');
});

test('status names the parent, the own, ignored and inherited lines, and the last load check', () =>
{
    const at = joined();
    fs.appendFileSync(path.join(at('ws/api'), '.claude', 'alfred-code.stamp'), 'own-picks: skill/npm\n');
    putWorkspace(at('ws/api'), { ...readWorkspaceRecord(at('ws/api')).record, ignore: { skill: ['sqlite'] } });
    const plan = path.join(TMP, 'installed.json');
    fs.writeFileSync(plan, JSON.stringify({ skills: ['javascript', 'npm'], rules: ['alfred-security'], plugins: [{ name: 'alfred-code' }] }));
    const r = cli('status', '--root', at('ws/api'), '--installed', plan);
    assert.strictEqual(r.out, 'role: child of ..\nworkspace: parent ..\ninstalled-above: 1\nown: skill npm\nignored: skill sqlite\nfrom-root: plugin alfred-code, rule alfred-security, skill javascript\ndocs: -\nmemory: -\ncheck: never\n');
    fs.mkdirSync(path.join(at('ws/api'), '.alfred', 'state'), { recursive: true });
    fs.writeFileSync(path.join(at('ws/api'), '.alfred', 'state', 'workspace-check.json'), JSON.stringify({ at: '2026-10-26T10:00:00Z', state: 'clean', misses: [] }));
    assert.match(cli('status', '--root', at('ws/api')).out, /^from-root: unknown - pass --installed <plan json>\ndocs: -\nmemory: -\ncheck: clean 2026-10-26T10:00:00Z\n$/m);
    const alone = tree({ alone: { git: true } });
    assert.strictEqual(cli('status', '--root', alone('alone')).out, 'role: standalone (no role recorded)\nworkspace: parent none\ninstalled-above: 0\nown: -\nignored: -\nfrom-root: unknown - pass --installed <plan json>\ncheck: never\n');
});

test('status names the ancestor docs roots and the memory index it reads, or ignored', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api', 'web'] } }, 'ws/api': { stamp: true, git: true, record: { parent: '..' } }, 'ws/web': { stamp: true, git: true, record: { parent: '..', ignore: { docs: ['root'], memory: ['root'] } } } });
    const docs = path.join(at('ws'), '.alfred', 'docs');
    fs.mkdirSync(path.join(docs, 'architecture'), { recursive: true });
    const index = path.join(ENV.CLAUDE_CONFIG_DIR, 'projects', at('ws').normalize('NFC').replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'MEMORY.md');
    fs.mkdirSync(path.dirname(index), { recursive: true });
    fs.writeFileSync(index, '- a note\n');
    const lines = (rel, e = ENV) => spawnSync(process.execPath, [CLI, 'status', '--root', at(rel)], { encoding: 'utf8', env: e }).stdout.split('\n').filter((l) => /^(docs|memory): /.test(l));
    assert.deepStrictEqual(lines('ws/api'), [`docs: ${docs}`, `memory: ${index}`]);
    assert.deepStrictEqual(lines('ws/web'), ['docs: ignored', 'memory: ignored']);
    assert.deepStrictEqual(lines('ws'), [], 'the root reads no ancestor');
    assert.deepStrictEqual(lines('ws/api', { ...ENV, ALFRED_CODE_WORKSPACE: '0' }), [], 'nor does a child with the switch at 0');
    fs.writeFileSync(index, '');
    assert.deepStrictEqual(lines('ws/api'), [`docs: ${docs}`, 'memory: -'], 'an empty index is none');
});

test('account-instructions: --check, --apply records the row in each named stamp, --decline over two roots writes both, --remove takes the key at its hash', () =>
{
    const one = joined();
    const two = joined();
    fs.writeFileSync(path.join(one('ws'), 'CLAUDE.md'), '# team\n');
    const acct = ENV.CLAUDE_CONFIG_DIR;
    fs.rmSync(acct, { recursive: true, force: true });
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--check').out, 'instructions-both: ask\n');
    const applied = cli('account-instructions', '--root', one('ws/api'), '--root', two('ws/api'), '--apply');
    assert.strictEqual(applied.code, 0, applied.out);
    const row = `settings.json:${ws.INSTRUCTION_KEY}=${valueHash(JSON.stringify('claude-md-and-agents-md'))}`;
    for (const root of [one('ws/api'), two('ws/api')]) assert.match(stampText(root), new RegExp(`^managed-account: ${row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(acct, 'settings.json'), 'utf8')).pluginConfigs['cc-plugin-agents-md@builtin'].options.instructionFiles, 'claude-md-and-agents-md');
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--check').out, 'instructions-both: set\n');
    const removed = cli('account-instructions', '--root', one('ws/api'), '--root', two('ws/api'), '--remove');
    assert.strictEqual(removed.code, 0, removed.out);
    assert.ok(!fs.readFileSync(path.join(acct, 'settings.json'), 'utf8').includes('instructionFiles'));
    for (const root of [one('ws/api'), two('ws/api')]) assert.doesNotMatch(stampText(root), /^managed-account:/m);
    const declined = cli('account-instructions', '--root', one('ws/api'), '--root', two('ws/api'), '--decline');
    assert.strictEqual(declined.code, 0);
    for (const root of [one('ws/api'), two('ws/api')]) assert.match(stampText(root), /^instructions-both: declined$/m);
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--check').out, 'instructions-both: declined\n');
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api')).code, 2, 'no mode is bad input');
    fs.rmSync(acct, { recursive: true, force: true });
});

test('an unknown verb is bad input', () =>
{
    const r = cli('frobnicate');
    assert.strictEqual(r.code, 2);
    assert.match(r.out, /^!! workspace: /m);
});

test('answer merges, replaces and refuses', () =>
{
    const file = path.join(fs.mkdtempSync(path.join(TMP, 'ans-')), 'answers.json');
    const ans = (...a) => cli('answer', '--file', file, ...a);
    assert.strictEqual(ans('--project', '.', '--', '--instructions-at', 'root').code, 0);
    assert.strictEqual(ans('--project', 'api', '--', '--instructions-at', 'root', '--instructions-file', 'agents').code, 0);
    assert.strictEqual(ans('--project', 'api', '--', '--instructions-at', 'claude', '--add', 'skill sqlite').code, 0);
    assert.strictEqual(ans('--project', 'api', '--', '--add', 'rule alfred-docs').code, 0);
    assert.strictEqual(ans('--project', 'api/tool', '--', '--docs-root-move', 'move', '--docs-root-leave', 'adr,notes').code, 0);
    const want = {
        '.': ['--instructions-at', 'root'],
        api: ['--instructions-at', 'claude', '--instructions-file', 'agents', '--add', 'skill sqlite', '--add', 'rule alfred-docs'],
        'api/tool': ['--docs-root-move', 'move', '--docs-root-leave', 'adr,notes'],
    };
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), want);
    const before = fs.readFileSync(file, 'utf8');
    for (const refused of [['--scope', 'user'], ['--instructions-at', 'maybe'], ['--docs-root-leave', 'a'], ['--add', 'colour blue'], ['--instructions-at'], ['--data-move', 'move'], []])
    {
        const r = ans('--project', 'api', '--', ...refused);
        assert.strictEqual(r.code, 2, `${refused.join(' ')}: ${r.out}`);
        assert.match(r.out, /^!! workspace: /m);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), before, refused.join(' '));
    }
    assert.strictEqual(ans('--project', '../out', '--', '--instructions-at', 'claude').code, 2);
    fs.writeFileSync(file, '{ not json');
    assert.strictEqual(ans('--project', '.', '--', '--instructions-at', 'claude').code, 2, 'an answers file that does not parse is refused, never replaced');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
});

// A stand-in installer: a --print-plan run writes the folder's read-back, any other run touches .claude/runs and prints
// `say`; a run in a folder named `hangIn` blocks for 30 s first. Every call is logged as '<real cwd> <args>'.
function fakeSource(say = '', { hangIn = '' } = {})
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
        `fs.appendFileSync(${JSON.stringify(path.join(src, 'runs.log'))}, fs.realpathSync.native(process.cwd()) + ' ' + a.join(' ') + '\\n');`,
        "if (a.includes('--print-plan'))",
        '{',
        "    fs.writeFileSync(a[a.indexOf('--plan-out') + 1], JSON.stringify({ root: ws.realKey(process.cwd()), skills: ['javascript'], before: ['skill javascript'], failures: 0, unreadable: [], blind: false }));",
        '    process.exit(0);',
        '}',
        `if (${JSON.stringify(hangIn)} && path.basename(process.cwd()) === ${JSON.stringify(hangIn)}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);`,
        "fs.appendFileSync(path.join(process.cwd(), '.claude', 'runs'), 'x');",
        `process.stdout.write(${JSON.stringify(say)});`,
        '',
    ].join('\n'));
    const runs = () => { try { return fs.readFileSync(path.join(src, 'runs.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
    return { src, runs };
}
const cascadeTree = () => tree({
    ws: { stamp: true, record: { children: ['api', 'web'] } },
    'ws/api': { stamp: true, git: true, record: { parent: '..', children: ['tool'] } },
    'ws/api/tool': { stamp: true, git: true, record: { parent: '..' } },
    'ws/web': { stamp: true, git: true, record: { parent: '..' } },
});

test('cascade reads each parent back once, after its own run, and passes it to the children', () =>
{
    const at = cascadeTree();
    const { src, runs } = fakeSource('==> done\n');
    const r = cli('cascade', '--root', at('ws'), '--source', src);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.out, 'cascade: api\tupdated\ncascade: api/tool\tupdated\ncascade: web\tupdated\ncascade: done 3 updated, 0 failed, 0 skipped\n');
    const calls = runs().map((l) => [l.split(' ')[0], l.includes('--print-plan') ? 'plan' : 'run']);
    assert.deepStrictEqual(calls, [[at('ws'), 'plan'], [at('ws/api'), 'run'], [at('ws/api'), 'plan'], [at('ws/api/tool'), 'run'], [at('ws/web'), 'run']]);
    for (const l of runs().filter((x) => !x.includes('--print-plan')))
        assert.match(l, / update --source \S+ --scope project --installed-only --keep-pins --parent-plan \S+$/, l);
});

test('cascade writes each row as it finishes, so a call stopped mid-run leaves the rows it got to', () =>
{
    const at = cascadeTree();
    const { src } = fakeSource('==> done\n', { hangIn: 'web' });
    const r = spawnSync(process.execPath, [CLI, 'cascade', '--root', at('ws'), '--source', src], { encoding: 'utf8', env: ENV, timeout: 8000 });
    assert.strictEqual(r.signal, 'SIGTERM', 'the call was stopped while web ran');
    assert.strictEqual(r.stdout, 'cascade: api\tupdated\ncascade: api/tool\tupdated\n');
});

test('cascade marks a run failed on its summary line even though it exits 0', () =>
{
    const at = cascadeTree();
    const { src, runs } = fakeSource('==>   !! settings.local.json is not valid JSON - left as it is\n==>   1 step(s) reported a failure above - the rest of the run completed\n');
    const r = cli('cascade', '--root', at('ws'), '--source', src);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^cascade: api\tfailed\n  !! settings\.local\.json is not valid JSON - left as it is\ncascade: api\/tool\tskipped\ncascade: web\tfailed\n/, r.out);
    assert.match(r.out, /^cascade: done 0 updated, 2 failed, 1 skipped$/m);
    assert.ok(!runs().some((l) => l.startsWith(`${at('ws/api/tool')} `)), 'the skipped child never ran');
    const bare = fakeSource('  1 step(s) reported a failure above - the rest of the run completed\n');
    assert.match(cli('cascade', '--root', at('ws'), '--source', bare.src).out, /^cascade: web\tfailed$/m, 'the summary line without the log prefix counts too');
});

test('cascade skips a listed child whose own parent line does not point back', () =>
{
    const at = cascadeTree();
    putWorkspace(at('ws/web'), { role: 'standalone' });
    const webBefore = readWorkspaceRecord(at('ws/web')).text;
    const { src, runs } = fakeSource();
    const r = cli('cascade', '--root', at('ws'), '--source', src);
    assert.match(r.out, /^!! cascade: web does not name \. as its parent - skipped; join it again or run workspace\.js unregister there\ncascade: web\tskipped$/m, r.out);
    assert.ok(!runs().some((l) => l.startsWith(`${at('ws/web')} `)));
    assert.strictEqual(readWorkspaceRecord(at('ws/web')).text, webBefore, 'the skipped child\'s record is untouched');
    assert.ok(!fs.existsSync(path.join(at('ws/web'), '.claude', 'runs')));
    assert.match(r.out, /^cascade: done 2 updated, 0 failed, 1 skipped$/m);
});

test('cascade refuses an answers entry outside the allow-list before that project runs', () =>
{
    const at = cascadeTree();
    const answers = path.join(fs.mkdtempSync(path.join(TMP, 'ans-')), 'answers.json');
    fs.writeFileSync(answers, JSON.stringify({ web: ['--scope', 'user'], api: ['--instructions-at', 'root'] }));
    const { src, runs } = fakeSource();
    const r = cli('cascade', '--root', at('ws'), '--source', src, '--answers', answers);
    assert.match(r.out, /^!! cascade: the answers for web hold --scope - not an answer the cascade passes; skipped\ncascade: web\tskipped$/m, r.out);
    assert.ok(runs().some((l) => l.startsWith(`${at('ws/api')} `) && l.endsWith(' --instructions-at root')));
    assert.ok(!runs().some((l) => l.startsWith(`${at('ws/web')} `)));
    fs.writeFileSync(answers, '[1, 2]');
    assert.strictEqual(cli('cascade', '--root', at('ws'), '--source', src, '--answers', answers).code, 2);
    fs.rmSync(answers);
    assert.match(cli('cascade', '--root', at('ws'), '--source', src, '--answers', answers).out, /^cascade: done 3 updated, 0 failed, 0 skipped$/m, 'an answers file never written is no answer');
});

test('cascade --hold runs nothing, names every project below held and a gone one gone-kept, out of the count', () =>
{
    const at = cascadeTree();
    putWorkspace(at('ws'), { children: ['api', 'web', 'old'] });
    const { src, runs } = fakeSource('==> done\n');
    const r = cli('cascade', '--root', at('ws'), '--source', src, '--hold');
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out, 'cascade: api\theld\ncascade: api/tool\theld\ncascade: web\theld\ncascade: old\tgone-kept\ncascade: done 0 updated, 0 failed, 0 skipped, 3 held\n');
    assert.deepStrictEqual(runs(), [], 'no read-back and no installer run');
    assert.deepStrictEqual(wsFile(at('ws')), { children: ['api', 'web', 'old'] }, 'the gone child keeps its entry');
    for (const c of ['ws/api', 'ws/api/tool', 'ws/web']) assert.ok(!fs.existsSync(path.join(at(c), '.claude', 'runs')), c);
    assert.strictEqual(cli('cascade', '--root', at('ws'), '--hold').out, r.out, 'a hold needs no source');
    const off = spawnSync(process.execPath, [CLI, 'cascade', '--root', at('ws'), '--hold'], { encoding: 'utf8', env: { ...ENV, ALFRED_CODE_WORKSPACE: '0' } });
    assert.strictEqual(off.stdout, 'cascade: off - ALFRED_CODE_WORKSPACE is 0\n');
    const alone = tree({ solo: { stamp: true } });
    assert.strictEqual(cli('cascade', '--root', alone('solo'), '--hold').out, 'cascade: done 0 updated, 0 failed, 0 skipped, 0 held\n', 'a standalone project holds nothing');
});

// Review 2026-10-28: the user's 'No, only this project' is written down at the ask, so the cascade call ten minutes later
// is the same line on either answer and cannot run the children against it.
test('answer --hold records \'only this project\' in the answers file, and the cascade then holds', () =>
{
    const at = cascadeTree();
    const answers = path.join(fs.mkdtempSync(path.join(TMP, 'ans-')), 'answers.json');
    fs.writeFileSync(answers, JSON.stringify({ api: ['--instructions-at', 'root'] }));
    const w = cli('answer', '--file', answers, '--hold');
    assert.strictEqual(w.code, 0, w.out);
    assert.strictEqual(w.out, 'answer: . hold - the cascade runs nothing below\n');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(answers, 'utf8')), { api: ['--instructions-at', 'root'], '.': 'hold' });
    const { src, runs } = fakeSource('==> done\n');
    const r = cli('cascade', '--root', at('ws'), '--source', src, '--answers', answers);
    assert.strictEqual(r.out, 'cascade: api\theld\ncascade: api/tool\theld\ncascade: web\theld\ncascade: done 0 updated, 0 failed, 0 skipped, 3 held\n');
    assert.deepStrictEqual(runs(), []);
    const fresh = path.join(path.dirname(answers), 'none.json');
    assert.strictEqual(cli('answer', '--file', fresh, '--hold').code, 0, 'a walk with no other answer starts the file');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')), { '.': 'hold' });
    assert.strictEqual(cli('answer', '--hold').code, 2, '--hold still needs --file');
});

test('cascade with ALFRED_CODE_WORKSPACE=0 runs nothing', () =>
{
    const at = cascadeTree();
    const { src, runs } = fakeSource();
    const r = spawnSync(process.execPath, [CLI, 'cascade', '--root', at('ws'), '--source', src], { encoding: 'utf8', env: { ...ENV, ALFRED_CODE_WORKSPACE: '0' } });
    assert.strictEqual(r.stdout, 'cascade: off - ALFRED_CODE_WORKSPACE is 0\n');
    assert.deepStrictEqual(runs(), []);
});

test('cascade with ALFRED_CODE_WORKSPACE unset runs: on since 3.0.0 (D9)', () =>
{
    const at = cascadeTree();
    const { src, runs } = fakeSource('==> done\n');
    const env = { ...ENV };
    delete env.ALFRED_CODE_WORKSPACE;
    const r = spawnSync(process.execPath, [CLI, 'cascade', '--root', at('ws'), '--source', src], { encoding: 'utf8', env });
    assert.match(r.stdout, /^cascade: done 3 updated, 0 failed, 0 skipped$/m, r.stdout);
    assert.ok(runs().length > 0);
});

test('account-instructions --remove --hash takes the key with no stamp left to record it', () =>
{
    const one = joined();
    const acct = ENV.CLAUDE_CONFIG_DIR;
    fs.rmSync(acct, { recursive: true, force: true });
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--apply').code, 0);
    fs.rmSync(path.join(one('ws/api'), '.claude', 'alfred-code.stamp'));
    const hash = valueHash(JSON.stringify('claude-md-and-agents-md'));
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--remove', '--hash', 'f'.repeat(64)).out, "instructions-both: not removed - changed since it was written - kept as the user's\n");
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--remove', '--hash', 'nope').code, 2);
    assert.strictEqual(cli('account-instructions', '--root', one('ws/api'), '--remove', '--hash', hash).out, 'instructions-both: removed\n');
    assert.ok(!fs.readFileSync(path.join(acct, 'settings.json'), 'utf8').includes('instructionFiles'));
    fs.rmSync(acct, { recursive: true, force: true });
});

test('plan in a standalone project prints its row and spawns nothing', () =>
{
    const at = tree({ alone: { stamp: true, git: true } });
    const { src, runs } = fakeSource();
    const r = cli('plan', '--root', at('alone'), '--source', src);
    assert.strictEqual(r.out, 'workspace-plan: 1 projects\nproject: .\tscope=project\tversion=?->9.9.9\tadd=-\tdrop=-\n');
    assert.deepStrictEqual(runs(), []);
});

test('plan with ALFRED_CODE_WORKSPACE=0 lists only this project and reads nothing back', () =>
{
    const at = cascadeTree();
    const { src, runs } = fakeSource();
    const r = spawnSync(process.execPath, [CLI, 'plan', '--root', at('ws'), '--source', src, '--rescan'], { encoding: 'utf8', env: { ...ENV, ALFRED_CODE_WORKSPACE: '0' } });
    assert.strictEqual(r.stdout, 'workspace-plan: off - ALFRED_CODE_WORKSPACE is 0\n');
    assert.deepStrictEqual(runs(), []);
});

test('plan at a root carries a child\'s role-ask row from its preflight, never a join line', () =>
{
    const at = tree({ ws: { stamp: true, record: { children: ['api/tool'] } }, 'ws/api': { stamp: true, git: true }, 'ws/api/tool': { stamp: true, git: true, record: { parent: '../..' } } });
    const { src } = fakeSource();
    const r = cli('plan', '--root', at('ws'), '--source', src);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /^project: api\/tool\t.*\n  workspace: role-ask between \.\.$/m, r.out);
    assert.doesNotMatch(r.out, /workspace: join /);
});

// F24 (the 2026-10-28 workspace run): update-workspace.md asked for the project rows as one table, and the model built it
// by hand; the plan now prints it, with a `total:` line the paste gate proves - only when a second project or a rescan
// row is there, the case update-workspace.md is read in.
test('renderPlanTable: a header, one row per project, then the total', () =>
{
    const { renderPlanTable } = require('./workspace.js');
    const lines = renderPlanTable([
        { rel: '.', scope: 'project', version: '3.2.1->3.3.0', add: '-', drop: '-', asks: [] },
        { rel: 'api', scope: 'local', version: '3.2.1->3.3.0', add: 'skill x', drop: '-', asks: ['docs-move: offer', 'workspace: role-ask between ..'] },
    ]);
    assert.strictEqual(lines.length, 4, lines.join('\n'));
    assert.match(lines[0], /^project +\| scope +\| version +\| adds +\| drops +\| asks$/);
    assert.match(lines[1], /\| -$/, 'no asks shows -');
    assert.match(lines[2], /docs-move: offer; workspace: role-ask between \.\.$/);
    assert.strictEqual(lines[3], 'total: 2 projects');
});

test('plan prints the table for a root with a child, and none for a standalone project', () =>
{
    const { src } = fakeSource();
    const alone = tree({ alone: { stamp: true, git: true } });
    assert.doesNotMatch(cli('plan', '--root', alone('alone'), '--source', src).out, /^total:/m);
    const at = tree({ ws: { stamp: true, record: { children: ['api/tool'] } }, 'ws/api': { stamp: true, git: true }, 'ws/api/tool': { stamp: true, git: true, record: { parent: '../..' } } });
    const r = cli('plan', '--root', at('ws'), '--source', src);
    assert.match(r.out, /^project +\| scope +\| version +\| adds +\| drops +\| asks\n\. +\| project .*\napi\/tool +\| .*\ntotal: 2 projects$/m, r.out);
});

test('register under a parent stamped with an older release converts its record and prints the older-project line once; under a current parent it prints none', () =>
{
    const release = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const at = tree({ old: { stamp: true, record: { children: ['web'] }, legacy: true }, 'old/api': { git: true }, cur: { stamp: true, record: { children: ['web'] }, legacy: true }, 'cur/api': { git: true } });
    fs.writeFileSync(path.join(at('old'), '.claude', 'alfred-code.stamp'), 'version: 3.8.0\nhooks-route: plugin\n');
    fs.writeFileSync(path.join(at('cur'), '.claude', 'alfred-code.stamp'), `version: ${release}\nhooks-route: plugin\n`);
    const line = '!! workspace: .. runs an older release - it reads the old workspace file, which is now workspace.json; update .. next';
    const r = cli('register', '--root', at('old/api'));
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.strictEqual(r.out.split('\n').filter((l) => l === line).length, 1, r.out);
    assert.strictEqual(readWorkspaceRecord(at('old')).source, 'json', 'the parent\'s record is converted');
    assert.deepStrictEqual(wsFile(at('old')), { children: ['web', 'api'] });
    const c = cli('register', '--root', at('cur/api'));
    assert.strictEqual(c.code, 0, c.out + c.err);
    assert.strictEqual(readWorkspaceRecord(at('cur')).source, 'json');
    assert.doesNotMatch(c.out, /runs an older release/, c.out);
});

test('review I1: ignore --remove of a line an old-format record never held converts it and says not there', () =>
{
    const at = tree({ p: { stamp: true, record: { children: ['web'] }, legacy: true } });
    const r = cli('ignore', '--root', at('p'), '--remove', 'skill x');
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /converted to workspace\.json/, r.out);
    assert.match(r.out, /^workspace: ignore skill x not there$/m, r.out);
});
