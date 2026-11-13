'use strict';
// A $0 probe of WHO gave an ask's answer, as Claude Code records it: an AskUserQuestion answered by a PreToolUse hook
// (the hook leg) and one a person picks in the terminal (the picked leg), each read back from the transcript row that
// holds the answer - its `permissionDecision.source`, else `toolUseResult.permissionDecision.source`. A hook-answered
// row must not read as the user's; a picked one must. Every model request goes to a stand-in Messages API on
// 127.0.0.1 (an AskUserQuestion call first, then the text 'done'), the API-key variable is never passed on, and the
// account, home and project are folders of the run - nothing is billed. Re-run it on each Claude Code release.
//
// usage: node answer-source.js [--leg hook|picked|both] [--claude <path>] [--runs <dir>] [--project <dir>]
//   [--acct <dir>] [--home <dir>] [--own-hooks] [--before <prompt>] [--pty]
// --pty runs the hook leg in a terminal too: print mode (2.1.323) offers no AskUserQuestion, so it writes no answer row.
// prints 'hook-answered: source=<value|none> at=<key path|-> claude=<version>', 'picked: source=...' or
// 'picked: NOT RUN (<why>)', then one JSON summary line. Exit 0 as expected; 1 a hook-answered row opens `user`;
// 2 the picked row has no source or one not opening `user`; 3 a leg ran and no answer row was found.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VALUED = new Set(['--leg', '--claude', '--runs', '--project', '--acct', '--home', '--before']);
const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) opts[argv[i]] = VALUED.has(argv[i]) ? argv[i += 1] : true;
const leg = opts['--leg'] || 'both';
const base = path.resolve(opts['--runs'] || fs.mkdtempSync(path.join(os.tmpdir(), 'answer-source-')));
const acct = path.resolve(opts['--acct'] || path.join(base, 'acct'));
const home = path.resolve(opts['--home'] || path.join(base, 'home'));
const project = path.resolve(opts['--project'] || path.join(base, 'project'));
for (const d of [base, acct, home, project]) fs.mkdirSync(d, { recursive: true });
const binary = opts['--claude'] || 'claude';
const QUESTION = 'Go on?';
const PICK = 'Go on (Recommended)';
const opens = (source) => typeof source === 'string' && /^user/.test(source);

// The account is trusted for the project and past onboarding, so the terminal opens on the prompt.
{
    const file = path.join(acct, '.claude.json');
    let kept = {};
    try { kept = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { kept = {}; }
    const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
    const projects = { ...(kept.projects || {}), [project]: trusted, [fs.realpathSync(project)]: trusted };
    fs.writeFileSync(file, JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', ...kept, projects }));
}

// The hook leg's answerer: allows the ask and fills its answer, as a stop contract does.
const READ_STDIN = "let raw = '';\nprocess.stdin.on('data', (d) => { raw += d; }).on('end', () =>\n{\n";
const answerer = path.join(base, 'answer-hook.js');
fs.writeFileSync(answerer, `${READ_STDIN}    let input = {};\n    try { input = JSON.parse(raw).tool_input || {}; } catch { /* no payload */ }\n`
    + `    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow',\n`
    + `        updatedInput: { ...input, answers: { ${JSON.stringify(QUESTION)}: ${JSON.stringify(PICK)} } } } }));\n});\n`);
const settingsFile = path.join(base, 'answer-settings.json');
const command = `"${process.execPath}" "${answerer}"`.replace(/\\/g, '/');
fs.writeFileSync(settingsFile, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command, timeout: 10 }] }] } }, null, 2));

// The stand-in: while armed, the first main request whose prompt is 'hi' gets one AskUserQuestion call (so a --before
// turn typed into the same terminal gets 'done'); every other request the text 'done'.
let armed = false;
const texts = (m) => (typeof m.content === 'string' ? [m.content] : Array.isArray(m.content) ? m.content.filter((b) => b && b.type === 'text').map((b) => b.text) : []);
const saysHi = (body) => { const users = (body.messages || []).filter((m) => m && m.role === 'user'); const last = users[users.length - 1];
    return Boolean(last) && texts(last).some((t) => String(t).trim() === 'hi'); };
let served = 0;
const ASK = { questions: [{ question: QUESTION, header: 'Go on', multiSelect: false,
    options: [{ label: PICK, description: 'carry on' }, { label: 'Stop', description: 'stop here' }] }] };
const server = http.createServer((req, res) =>
{
    let raw = '';
    req.on('data', (d) => { raw += d; }).on('end', () =>
    {
        served += 1;
        let body = {};
        try { body = JSON.parse(raw); } catch { /* not json */ }
        const url = req.url.split('?')[0];
        const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.method === 'POST' && url === '/v1/messages/count_tokens') return json(200, { input_tokens: 10 });
        if (!(req.method === 'POST' && url === '/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'stand-in server' } });
        const ask = armed && Array.isArray(body.tools) && body.tools.length > 0 && saysHi(body);
        if (ask) armed = false;
        const message = { id: `msg_mock_${served}`, type: 'message', role: 'assistant', model: body.model || 'mock', content: [], stop_reason: null,
            stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } };
        const block = ask
            ? { start: { type: 'tool_use', id: `toolu_mock_${served}`, name: 'AskUserQuestion', input: {} },
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(ASK) }, stop: 'tool_use' }
            : { start: { type: 'text', text: '' }, delta: { type: 'text_delta', text: 'done' }, stop: 'end_turn' };
        if (!body.stream) return json(200, { ...message, content: ask ? [{ ...block.start, input: ASK }] : [{ type: 'text', text: 'done' }], stop_reason: block.stop });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const [event, data] of [
            ['message_start', { type: 'message_start', message }],
            ['content_block_start', { type: 'content_block_start', index: 0, content_block: block.start }],
            ['content_block_delta', { type: 'content_block_delta', index: 0, delta: block.delta }],
            ['content_block_stop', { type: 'content_block_stop', index: 0 }],
            ['message_delta', { type: 'message_delta', delta: { stop_reason: block.stop, stop_sequence: null }, usage: { output_tokens: 5 } }],
            ['message_stop', { type: 'message_stop' }],
        ]) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return res.end();
    });
});

function childEnv(port)
{
    const source = process.env;
    const env = {
        CLAUDE_CONFIG_DIR: acct, HOME: home, USERPROFILE: home,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        // a bearer for the stand-in only: built here, never a real login, and the API-key variable stays unset
        ANTHROPIC_AUTH_TOKEN: ['stand', 'in', 'local', 'only'].join('-'),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    for (const k of ['PATH', 'TMPDIR', 'SystemRoot', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'TERM', 'LANG']) if (source[k] !== undefined) env[k] = source[k];
    return env;
}

// One run of the program: a .js stands in for the binary in the tests.
function launch(program, args, env, timeoutMs)
{
    const [cmd, list] = /\.js$/.test(program) ? [process.execPath, [program, ...args]] : [program, args];
    return new Promise((resolve) =>
    {
        const child = spawn(cmd, list, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', () => {});
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        child.on('error', () => { clearTimeout(timer); resolve({ code: 'spawn-failed', stdout }); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    });
}

// The newest transcript row that carries an answer: a toolUseResult.answers object and a tool_result block.
function answerRow()
{
    const files = [];
    const walk = (dir) => { let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of list) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p); } };
    walk(path.join(acct, 'projects'));
    let best = null;
    for (const file of files)
    {
        const mtime = fs.statSync(file).mtimeMs;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        for (let i = lines.length - 1; i >= 0; i -= 1)
        {
            let row;
            try { row = JSON.parse(lines[i]); } catch { continue; }
            const result = row && row.toolUseResult;
            const content = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
            if (!result || typeof result.answers !== 'object' || result.answers === null || !content.some((b) => b && b.type === 'tool_result')) continue;
            if (!best || mtime > best.mtime) best = { row, mtime };
            break;
        }
    }
    if (!best) return null;
    const { row } = best;
    const top = row.permissionDecision && row.permissionDecision.source;
    const inner = row.toolUseResult.permissionDecision && row.toolUseResult.permissionDecision.source;
    const [source, at] = top !== undefined ? [top, 'permissionDecision.source'] : inner !== undefined ? [inner, 'toolUseResult.permissionDecision.source'] : [null, '-'];
    return { source, at, claude: row.version || 'unknown' };
}

const show = (value) => (value === null ? 'none' : typeof value === 'string' ? value : JSON.stringify(value));

async function before(env)
{
    if (!opts['--before']) return [];
    const r = await launch(binary, ['-p', opts['--before'], '--output-format', 'stream-json', '--verbose'], env, 180000);
    const init = r.stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.session_id);
    return init ? ['--resume', init.session_id] : [];
}

async function hookLeg(env)
{
    const settings = opts['--own-hooks'] ? [] : ['--settings', settingsFile];
    if (opts['--pty'])
    {
        // the --before prompt is typed into the same terminal session, so a stamp it writes names the session that asks
        const r = await terminal(env, settings, 'wait', opts['--before'] || '');
        if (r.notRun) { console.log(`hook-answered: NOT RUN (${r.notRun})`); return { notRun: r.notRun }; }
    }
    else
    {
        const resume = await before(env);
        armed = true;
        await launch(binary, ['-p', 'hi', ...resume, ...settings, '--output-format', 'stream-json', '--verbose'], env, 180000);
        armed = false;
    }
    const got = answerRow();
    console.log(got ? `hook-answered: source=${show(got.source)} at=${got.at} claude=${got.claude}` : 'hook-answered: no answer row');
    return got || { missing: true };
}

// The picked leg: the same session in a terminal, a python3 pty driver types 'hi', presses Enter on the question.
const DRIVER = [
    'import os, pty, re, select, sys, time, json',
    'prog, args, cwd, mode, first = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]',
    'pid, fd = pty.fork()',
    'if pid == 0:',
    '    os.chdir(cwd)',
    '    os.execvp(prog, [prog] + args)',
    "ANSI = re.compile(rb'\\x1b\\[[0-?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[@-_]')",
    "screen = b''",
    'def pump(seconds, needle=None):',
    '    global screen',
    '    end = time.time() + seconds',
    '    while time.time() < end:',
    '        r, _, _ = select.select([fd], [], [], 0.2)',
    '        if fd in r:',
    '            try: data = os.read(fd, 65536)',
    '            except OSError: return False',
    '            if not data: return False',
    '            screen += data',
    "            if needle and needle in ANSI.sub(b'', screen): return True",
    '    return False',
    'pump(10)',
    'if first:',
    '    for ch in first: os.write(fd, ch.encode()); time.sleep(0.05)',
    "    time.sleep(1.0); os.write(fd, b'\\r'); pump(20); screen = b''",
    "for ch in 'hi': os.write(fd, ch.encode()); time.sleep(0.05)",
    "time.sleep(0.5); os.write(fd, b'\\r')",
    "if mode == 'wait':",
    "    print('ASKED' if pump(60, b'done') else 'NOASK'); sys.stdout.flush()",
    "    os.write(fd, b'\\x03'); time.sleep(0.5); os.write(fd, b'\\x03'); pump(2)",
    '    os.kill(pid, 9); sys.exit(0)',
    "asked = pump(60, b'Go on?')",
    "print('ASKED' if asked else 'NOASK'); sys.stdout.flush()",
    'if asked:',
    "    time.sleep(1.0); os.write(fd, b'\\r')",
    "    screen = b''",
    "    done = pump(20, b'done')",
    "    if not done: os.write(fd, b'\\r'); done = pump(20, b'done')",
    "    print('DONE' if done else 'NODONE'); sys.stdout.flush()",
    "os.write(fd, b'\\x03'); time.sleep(0.5); os.write(fd, b'\\x03'); pump(2)",
    'try: os.kill(pid, 9)',
    'except OSError: pass',
].join('\n');

// One terminal session: 'pick' presses Enter on the question, 'wait' leaves the answer to a hook and waits for 'done'.
async function terminal(env, args, mode, first = '')
{
    if (process.platform === 'win32') return { notRun: 'no pty on win32' };
    if (/\.js$/.test(binary)) return { notRun: 'a stand-in binary has no terminal' };
    armed = true;
    const r = await new Promise((resolve) =>
    {
        const child = spawn('python3', ['-c', DRIVER, binary, JSON.stringify(args), project, mode, first], { env: { ...env, TERM: 'xterm-256color' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', () => {});
        const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
        child.on('error', () => { clearTimeout(timer); resolve({ stdout, missing: true }); });
        child.on('close', () => { clearTimeout(timer); resolve({ stdout }); });
    });
    armed = false;
    if (r.missing) return { notRun: 'no python3' };
    if (!/ASKED/.test(r.stdout)) return { notRun: mode === 'pick' ? 'the question never showed within 60 s' : 'the turn never ended within 60 s' };
    return {};
}

async function pickedLeg(env)
{
    const r = await terminal(env, [], 'pick');
    return r.notRun ? r : answerRow() || { missing: true };
}

server.listen(0, '127.0.0.1', async () =>
{
    const env = childEnv(server.address().port);
    const summary = {};
    if (leg === 'hook' || leg === 'both') summary.hook = await hookLeg(env);
    if (leg === 'picked' || leg === 'both')
    {
        const got = await pickedLeg(env);
        summary.picked = got;
        console.log(got.notRun ? `picked: NOT RUN (${got.notRun})` : got.missing ? 'picked: no answer row' : `picked: source=${show(got.source)} at=${got.at} claude=${got.claude}`);
    }
    console.log(JSON.stringify(summary));
    server.close();
    const h = summary.hook;
    const p = summary.picked;
    let code = 0;
    if (h && !h.missing && opens(h.source)) code = 1;
    else if (p && !p.notRun && !p.missing && !opens(p.source)) code = 2;
    else if ((h && h.missing) || (p && p.missing)) code = 3;
    process.exitCode = code;
});
