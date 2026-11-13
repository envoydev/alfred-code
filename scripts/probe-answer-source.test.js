'use strict';
// meta/probes/answer-source.js against a fake `claude`: the fake writes one transcript row (from a file this test
// writes, since the probe hands its child an isolated environment) under its CLAUDE_CONFIG_DIR and its own environment
// to a fixed file, so the probe's reading, its exit codes and the child's isolation are checked with no Claude Code
// and no request.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROBE = path.join(__dirname, '..', 'meta', 'probes', 'answer-source.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-answer-source-'));
const runsDir = path.join(TMP, 'runs');
const envOut = path.join(TMP, 'env.json');
const rowIn = path.join(TMP, 'row.json');
const FAKE = path.join(TMP, 'fake-claude.js');
fs.writeFileSync(FAKE, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const env = process.env;',
    "const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'p');",
    'fs.mkdirSync(dir, { recursive: true });',
    `fs.writeFileSync(path.join(dir, 's.jsonl'), \`\${fs.readFileSync(${JSON.stringify(rowIn)}, 'utf8')}\\n\`);`,
    `fs.writeFileSync(${JSON.stringify(envOut)}, JSON.stringify(env));`,
    "process.stdout.write('{}\\n');",
].join('\n'));
let seq = 0;
const dir = () => path.join(runsDir, `r${seq++}`);
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const run = (row, extra = []) =>
{
    fs.writeFileSync(rowIn, JSON.stringify(row));
    return spawnSync(process.execPath, [PROBE, '--leg', 'hook', '--claude', FAKE, '--runs', dir(), ...extra],
        { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'must-not-reach-the-child' } });
};
const answer = (pd) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x' }] },
    toolUseResult: { questions: [], answers: { 'Go on?': 'Go on (Recommended)' } }, version: '2.1.323', ...(pd ? { permissionDecision: pd } : {}) });

test('a hook-answered row reading hook passes', () =>
{
    const r = run(answer({ source: 'hook' }));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^hook-answered: source=hook at=permissionDecision\.source claude=2\.1\.323$/m);
});
test('a hook-answered row opening user is the stop', () => assert.strictEqual(run(answer({ source: 'user_temporary' })).status, 1));
test('a row with no field reads none and passes', () =>
{
    const r = run(answer(null));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /source=none at=-/);
});
test('no answer row is inconclusive', () => assert.strictEqual(run({ type: 'user', message: { role: 'user', content: 'hi' } }).status, 3));
test('the child is isolated and unbilled', () =>
{
    run(answer({ source: 'hook' }));
    const e = JSON.parse(fs.readFileSync(envOut, 'utf8'));
    assert.strictEqual(e.ANTHROPIC_API_KEY, undefined);
    assert.match(e.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const k of ['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE']) assert.ok(e[k].startsWith(runsDir), k);
});
test('--leg hook never starts the picked leg', () => assert.doesNotMatch(run(answer({ source: 'hook' })).stdout, /^picked:/m));
test('the field found under toolUseResult is reported at that path', () =>
{
    const row = answer(null);
    row.toolUseResult.permissionDecision = { source: 'hook' };
    assert.match(run(row).stdout, /source=hook at=toolUseResult\.permissionDecision\.source/);
});
