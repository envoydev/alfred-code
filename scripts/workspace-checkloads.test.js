'use strict';
// The exclude check (plan Task 13): checkLoads runs a logged-out `claude -p` in a child and names every ancestor file
// that loaded a second time. The `claude` here is a stand-in written in Node: it writes the debug log the probes
// recorded (docs/workspace-layering-evidence.md), runs each InstructionsLoaded hook from --settings with a payload per
// file the case names, and dumps its env and its --settings file for the case to read.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ws = require('./install/workspace.js');
const { hashItem } = require('./install/library.js');

const CLI = path.join(__dirname, 'workspace.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'checkloads-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NO_CREDS = '[Bootstrap] Skipped: no usable OAuth, WIF, or API key';
const FAKE = `#!${process.execPath}
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const cfg = JSON.parse(fs.readFileSync(__filename + '.json', 'utf8'));
const a = process.argv.slice(2);
const at = (flag) => a[a.indexOf(flag) + 1];
fs.mkdirSync(cfg.dump, { recursive: true });
fs.writeFileSync(path.join(cfg.dump, 'env.json'), JSON.stringify(process.env));
fs.writeFileSync(path.join(cfg.dump, 'argv.json'), JSON.stringify(a));
const settings = JSON.parse(fs.readFileSync(at('--settings'), 'utf8'));
fs.writeFileSync(path.join(cfg.dump, 'settings.json'), JSON.stringify(settings));
const log = [];
for (const file of cfg.events)
{
    for (const group of (settings.hooks || {}).InstructionsLoaded || [])
        for (const h of group.hooks || [])
        {
            execSync(h.command, { input: JSON.stringify({ hook_event_name: 'InstructionsLoaded', file_path: file, load_reason: 'session_start' }), stdio: ['pipe', 'ignore', 'inherit'] });
            log.push('InstructionsLoaded:session_start [' + h.command + '] completed with status 0');
        }
}
if (cfg.agents) log.push('[cc-plugin-agents-md] $.ui.log (to debug): no CLAUDE.md found; AGENTS.md loaded: ' + cfg.agents);
if (cfg.noCreds) log.push('${NO_CREDS}');
fs.writeFileSync(at('--debug-file'), log.join('\\n') + '\\n');
process.exit(1);
`;

// ws (stamped, one library rule copy and a seeded AGENTS.md) with the git child ws/api joined below it.
function setup({ events = () => [], agents = null, noCreds = true } = {})
{
    const top = fs.mkdtempSync(path.join(TMP, 't-'));
    const root = path.join(top, 'ws');
    const child = path.join(root, 'api');
    fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'rules', 'alfred-security.md'), '# security\n');
    fs.writeFileSync(path.join(root, '.claude', 'AGENTS.md'), '# seed\n');
    const seedHash = hashItem(path.join(root, '.claude', 'AGENTS.md'));
    fs.writeFileSync(path.join(root, '.claude', 'alfred-code.stamp'), `sha: x\nlibrary-rules: alfred-security=${'a'.repeat(64)}\nmanaged-files: AGENTS.md=${seedHash}\n`);
    fs.mkdirSync(path.join(child, '.claude', 'rules'), { recursive: true });
    execFileSync('git', ['init', '-q', child]);
    fs.writeFileSync(path.join(child, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    fs.writeFileSync(path.join(child, '.claude', 'rules', 'own.md'), '# own\n');
    for (const [dir, line] of [[root, 'child api\n'], [child, 'parent ..\n']])
    {
        fs.mkdirSync(path.join(dir, '.alfred'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.alfred', 'workspace'), line);
    }
    const real = { root: fs.realpathSync.native(root), child: fs.realpathSync.native(child) };
    const dump = path.join(top, 'dump');
    const bin = path.join(top, 'claude-fake.js');
    fs.writeFileSync(bin, FAKE, { mode: 0o755 });
    const agentsPath = agents ? agents(real) : null;
    fs.writeFileSync(`${bin}.json`, JSON.stringify({ dump, events: events(real), agents: agentsPath, noCreds }));
    const configDir = path.join(top, 'acct');
    const managedFile = path.join(top, 'managed', 'managed-settings.json');
    const env = { PATH: process.env.PATH, HOME: path.join(top, 'caller-home'), CLAUDE_CONFIG_DIR: configDir, TMPDIR: process.env.TMPDIR };
    const check = (extra = {}) => ws.checkLoads({ projectRoot: child, env: { ...env, ...extra }, configDir, claudeBin: bin, managedFile, now: () => new Date('2026-10-26T12:00:00Z') });
    const ran = () => fs.existsSync(path.join(dump, 'env.json'));
    const dumped = (name) => JSON.parse(fs.readFileSync(path.join(dump, name), 'utf8'));
    const record = () => JSON.parse(fs.readFileSync(path.join(child, '.alfred', 'state', 'workspace-check.json'), 'utf8'));
    const cli = () => spawnSync(process.execPath, [CLI, 'check-loads', '--root', child, '--claude', bin, '--managed-file', managedFile], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout;
    return { top, root, child, real, bin, configDir, managedFile, check, ran, dumped, record, cli };
}
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };

test('clean when nothing excluded fires', () =>
{
    const s = setup({ events: (r) => [path.join(r.child, '.claude', 'rules', 'own.md')] });
    assert.deepStrictEqual(s.check(), { state: 'clean', misses: [] });
    assert.deepStrictEqual(s.record(), { at: '2026-10-26T12:00:00.000Z', state: 'clean', misses: [] });
    assert.match(s.cli(), /^check-loads: clean$/m);
});

test('a miss is named when an excluded path fires', () =>
{
    const s = setup({ events: (r) => [path.join(r.child, '.claude', 'rules', 'own.md'), path.join(r.root, '.claude', 'rules', 'alfred-security.md')] });
    const got = s.check();
    assert.strictEqual(got.state, 'misses');
    assert.deepStrictEqual(got.misses, [path.join(s.real.root, '.claude', 'rules', 'alfred-security.md')]);
    assert.strictEqual(s.record().state, 'misses');
    assert.match(s.cli(), new RegExp(`^!! check-loads: ${path.join(s.real.root, '.claude', 'rules', 'alfred-security.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} loaded twice - run /alfred-code:update$`, 'm'));
});

test('an ancestor seed AGENTS.md named by the debug load line is a miss', () =>
{
    const s = setup({ agents: (r) => path.join(r.root, '.claude', 'AGENTS.md') });
    assert.deepStrictEqual(s.check(), { state: 'misses', misses: [path.join(s.real.root, '.claude', 'AGENTS.md')] });
    const own = setup({ agents: (r) => path.join(r.child, 'AGENTS.md') });
    assert.strictEqual(own.check().state, 'clean', 'the project\'s own AGENTS.md is no miss');
});

test('no no-credentials line means authenticated and nothing else (AC30)', () =>
{
    const s = setup({ noCreds: false, events: (r) => [path.join(r.root, '.claude', 'rules', 'alfred-security.md')] });
    assert.deepStrictEqual(s.check(), { state: 'authenticated', misses: [] });
    assert.strictEqual(s.cli().split('\n').filter((l) => l.startsWith('!!') || /^check-loads: (clean|skipped)/.test(l)).join('\n'), '!! check-loads: the probe authenticated');
});

test('the probe\'s environment is the allow-list: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN are absent (AC30)', () =>
{
    const s = setup();
    s.check({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', SOMETHING_ELSE: 'x' });
    const env = s.dumped('env.json');
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_PROFILE', 'SOMETHING_ELSE']) assert.ok(!(k in env), `${k} reached the probe`);
    assert.strictEqual(env.PATH, process.env.PATH);
    assert.notStrictEqual(env.CLAUDE_CONFIG_DIR, s.configDir, 'the probe runs in a throwaway account, never the caller\'s');
    assert.match(s.dumped('argv.json').join(' '), /^-p hi --debug --debug-file \S+ --settings \S+$/);
});

test('a project apiKeyHelper is skipped without a run (AC30)', () =>
{
    const s = setup();
    put(path.join(s.child, '.claude', 'settings.json'), { apiKeyHelper: '/bin/echo key' });
    assert.deepStrictEqual(s.check(), { state: 'skipped', misses: [], why: '.claude/settings.json sets apiKeyHelper' });
    assert.ok(!s.ran());
    assert.match(s.cli(), /^check-loads: skipped - \.claude\/settings\.json sets apiKeyHelper$/m);
});

test('a child settings.local.json env with ANTHROPIC_API_KEY, or CLAUDE_CODE_USE_BEDROCK, or a managed settings file (test seam: managedFile) with awsAuthRefresh, is skipped without a run, naming the file and the key (AC30)', () =>
{
    const local = setup();
    put(path.join(local.child, '.claude', 'settings.local.json'), { env: { ANTHROPIC_API_KEY: 'k' } });
    assert.strictEqual(local.check().why, '.claude/settings.local.json sets env.ANTHROPIC_API_KEY');
    assert.ok(!local.ran());
    const bedrock = setup();
    put(path.join(bedrock.child, '.claude', 'settings.json'), { env: { CLAUDE_CODE_USE_BEDROCK: '1', ALFRED_CODE_SCORER: '1' } });
    assert.strictEqual(bedrock.check().why, '.claude/settings.json sets env.CLAUDE_CODE_USE_BEDROCK');
    const managed = setup();
    put(managed.managedFile, { awsAuthRefresh: 'aws sso login' });
    assert.deepStrictEqual(managed.check(), { state: 'skipped', misses: [], why: `${managed.managedFile} sets awsAuthRefresh` });
    const dropIn = setup();
    put(path.join(path.dirname(dropIn.managedFile), 'managed-settings.d', '10-team.json'), { env: { GOOGLE_APPLICATION_CREDENTIALS: '/k.json' } });
    assert.match(dropIn.check().why, /managed-settings\.d.10-team\.json sets env\.GOOGLE_APPLICATION_CREDENTIALS$/);
    for (const s of [bedrock, managed, dropIn]) assert.ok(!s.ran());
    const fine = setup();
    put(path.join(fine.child, '.claude', 'settings.json'), { env: { ALFRED_CODE_SCORER: '1', ANTHROPIC_MODEL: 'x' } });
    assert.strictEqual(fine.check().state, 'clean', 'a key that neither authenticates nor picks a provider is no skip');
});

test('HOME and USERPROFILE point at a throwaway folder, never the caller\'s', () =>
{
    const s = setup();
    s.check({ USERPROFILE: path.join(s.top, 'caller-profile') });
    const env = s.dumped('env.json');
    assert.ok(env.HOME && env.HOME === env.USERPROFILE, JSON.stringify(env));
    assert.ok(![path.join(s.top, 'caller-home'), path.join(s.top, 'caller-profile'), os.homedir()].includes(env.HOME));
    assert.ok(!fs.existsSync(env.HOME), 'the throwaway home is removed after the run');
});

test('the account\'s pluginConfigs agents-md entry is carried into --settings, and only that key', () =>
{
    const s = setup();
    put(path.join(s.configDir, 'settings.json'), { model: 'opus', apiKeyHelper: '/bin/false', pluginConfigs: { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } }, 'other@x': { options: { a: 1 } } } });
    s.check();
    const settings = s.dumped('settings.json');
    assert.deepStrictEqual(Object.keys(settings).sort(), ['hooks', 'pluginConfigs']);
    assert.deepStrictEqual(settings.pluginConfigs, { 'cc-plugin-agents-md@builtin': { options: { instructionFiles: 'claude-md-and-agents-md' } } });
    const bare = setup();
    bare.check();
    assert.deepStrictEqual(Object.keys(bare.dumped('settings.json')), ['hooks']);
});

test('a project with no installed folder above it, or no claude, is not probed', () =>
{
    const alone = fs.mkdtempSync(path.join(TMP, 'alone-'));
    fs.mkdirSync(path.join(alone, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(alone, '.claude', 'alfred-code.stamp'), 'sha: x\n');
    assert.deepStrictEqual(ws.checkLoads({ projectRoot: alone, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: path.join(alone, 'acct') }, configDir: path.join(alone, 'acct'), managedFile: path.join(alone, 'none.json') }),
        { state: 'skipped', misses: [], why: 'no installed folder above this project' });
    const s = setup();
    const got = ws.checkLoads({ projectRoot: s.child, env: { PATH: '/nowhere', CLAUDE_CONFIG_DIR: s.configDir }, configDir: s.configDir, claudeBin: path.join(s.top, 'no-claude'), managedFile: s.managedFile });
    assert.strictEqual(got.state, 'error', JSON.stringify(got));
    assert.strictEqual(s.record().state, 'error');
});
