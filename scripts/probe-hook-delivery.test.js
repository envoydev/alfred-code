'use strict';
// meta/probes/hook-delivery.js is never installed, but it is what re-measures host behaviour on a new Claude Code
// release: these tests run it against a fake `claude` (a .js the probe starts through node), so the suite notices it
// breaking. No real session, no request past 127.0.0.1.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const PROBE = path.join(__dirname, '..', 'meta', 'probes', 'hook-delivery.js');

// A fake binary: posts one main request holding MARK-A, then leaves its env and argv where the test reads them.
const FAKE = `'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const env = process.env;
const url = new URL('/v1/messages', env.ANTHROPIC_BASE_URL);
// one request per first message: the session's own, then (a file named second-actor in the project) a subagent's
const firsts = ['MARK-A', ...(fs.existsSync(path.join(process.cwd(), 'second-actor')) ? ['SUBAGENT-TURN: say hi'] : [])];
const calls = [];
function post()
{
    const first = firsts.shift();
    const body = JSON.stringify({ model: 'fake', stream: false, tools: [{ name: 'Read' }], messages: [{ role: 'user', content: first }] });
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) =>
    {
        let raw = '';
        res.on('data', (d) => { raw += d; }).on('end', () =>
        {
            const block = JSON.parse(raw).content[0];
            calls.push(block.type === 'tool_use' ? block.name + ':' + block.input.file_path : 'text');
            if (firsts.length) return post();
            fs.writeFileSync(path.join(process.cwd(), 'fake-' + Date.now() + '-' + process.pid + '.json'), JSON.stringify({
                url: env.ANTHROPIC_BASE_URL, apiKeySet: env.ANTHROPIC_API_KEY !== undefined, bearer: env.ANTHROPIC_AUTH_TOKEN,
                home: env.HOME, config: env.CLAUDE_CONFIG_DIR, argv: process.argv.slice(2), calls,
            }));
            return process.exit(0);
        });
    });
    req.end(body);
}
post();
`;

function setup()
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-hook-delivery-'));
    const project = path.join(root, 'project');
    const runs = path.join(root, 'runs');
    fs.mkdirSync(project);
    const fake = path.join(root, 'fake.js');
    fs.writeFileSync(fake, FAKE);
    const run = (label, ...flags) => spawnSync(process.execPath, [PROBE, project, label, '--claude', fake, '--runs', runs, ...flags, '--', 'MARK-A', 'MARK-B'],
        { encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'set-by-the-test' } });
    // what the fake saw, oldest first
    const saw = () => fs.readdirSync(project).filter((n) => n.startsWith('fake-')).sort().map((n) => JSON.parse(fs.readFileSync(path.join(project, n), 'utf8')));
    return { root, project, runs, run, saw, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('hook-delivery probe: records a request and reports each mark', () =>
{
    const s = setup();
    try
    {
        const r = s.run('canary');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /^MARK-A: main-1$/m);
        assert.match(r.stdout, /^MARK-B: absent$/m);
        assert.match(r.stdout, /^requests=1 main=1 exit=0$/m);
        assert.ok(fs.existsSync(path.join(s.runs, 'canary', 'requests', 'main-1.json')));
    }
    finally { s.done(); }
});

test('hook-delivery probe: the child env holds the stand-in URL, a dummy bearer and no API key', () =>
{
    const s = setup();
    try
    {
        assert.strictEqual(s.run('canary').status, 0);
        const [seen] = s.saw();
        assert.match(seen.url, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.strictEqual(seen.apiKeySet, false, 'the caller\'s key is not handed on');
        assert.strictEqual(seen.bearer, 'stand-in-local-only');
        assert.ok(seen.home.startsWith(s.runs + path.sep), seen.home);
        assert.ok(seen.config.startsWith(s.runs + path.sep), seen.config);
    }
    finally { s.done(); }
});

test('hook-delivery probe: --state reuses the first run\'s home and config dir', () =>
{
    const s = setup();
    try
    {
        assert.strictEqual(s.run('canary').status, 0);
        assert.strictEqual(s.run('resume', '--state', path.join(s.runs, 'canary')).status, 0);
        const [first, second] = s.saw();
        assert.strictEqual(second.home, first.home);
        assert.strictEqual(second.config, first.config);
        assert.ok(fs.existsSync(path.join(s.runs, 'resume', 'requests', 'main-1.json')), 'the second run keeps its own requests');
    }
    finally { s.done(); }
});

test('hook-delivery probe: --ask builds a plugin folder and passes --plugin-dir', () =>
{
    const s = setup();
    try
    {
        assert.strictEqual(s.run('ask', '--ask', '.alfred/stack/rules').status, 0);
        const { argv } = s.saw()[0];
        const dir = argv[argv.indexOf('--plugin-dir') + 1];
        assert.ok(argv.includes('--plugin-dir') && dir.startsWith(path.join(s.runs, 'ask') + path.sep), argv.join(' '));
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'probe-ask');
        const rows = JSON.parse(fs.readFileSync(path.join(dir, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse;
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].matcher, 'Write|Edit');
        assert.match(rows[0].hooks[0].command, /\.alfred\/stack\/rules/);
    }
    finally { s.done(); }
});

test('hook-delivery probe: an existing run folder is refused', () =>
{
    const s = setup();
    try
    {
        assert.strictEqual(s.run('canary').status, 0);
        const kept = path.join(s.runs, 'canary', 'requests', 'main-1.json');
        const before = fs.readFileSync(kept);
        const r = s.run('canary');
        assert.strictEqual(r.status, 2);
        assert.match(r.stderr, /run folder exists: canary/);
        assert.ok(fs.readFileSync(kept).equals(before), 'the first run is untouched');
        assert.strictEqual(s.saw().length, 1, 'and no second session started');
    }
    finally { s.done(); }
});

test('hook-delivery probe: --inject-size pads the session text to n characters', () =>
{
    const s = setup();
    try
    {
        assert.strictEqual(s.run('cap', '--inject', '--inject-size', '9999').status, 0);
        const text = fs.readFileSync(path.join(s.runs, 'cap', 'inject.txt'), 'utf8');
        assert.strictEqual(text.length, 9999);
        assert.ok(text.endsWith('SESSION-INJECT-MARK'));
        const rows = JSON.parse(fs.readFileSync(path.join(s.runs, 'cap', 'hooks.json'), 'utf8')).hooks.SessionStart;
        assert.ok(rows.some((row) => row.hooks[0].command.includes('inject.txt')), 'the session hook reads that file');
    }
    finally { s.done(); }
});

// A dispatched agent runs beside its parent (an async launch, 2.1.322), so its requests interleave with the parent's:
// a step marked `sub` waits for a subagent's request, and the others go to the session's own.
test('hook-delivery probe: a step marked sub is given to the subagent\'s request, the others to the session\'s', () =>
{
    const s = setup();
    try
    {
        fs.writeFileSync(path.join(s.project, 'second-actor'), '');
        const r = s.run('actors', '--step', JSON.stringify({ name: 'Read', input: { file_path: 'for-the-subagent' }, sub: true }), '--read', 'for-the-session');
        assert.strictEqual(r.status, 0, r.stderr);
        assert.deepStrictEqual(s.saw()[0].calls, ['Read:for-the-session', 'Read:for-the-subagent']);
        assert.match(r.stdout, /^requests=2 main=2 exit=0$/m);
        assert.strictEqual(fs.readFileSync(path.join(s.runs, 'actors', 'requests', 'order.txt'), 'utf8'), 'main-1 session\nmain-2 subagent\n');
    }
    finally { s.done(); }
});
