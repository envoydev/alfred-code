'use strict';
// A $0 probe of what Claude Code SENDS: it talks to a stand-in Messages API on 127.0.0.1 that records each request and
// answers from a script (a text, or one tool call per main request), so no request reaches the vendor and nothing is
// billed. One row of a host-behaviour table is one command; re-run it on a new Claude Code release.
//
// usage: node hook-delivery.js <cwd> <label> [flags] -- <mark> [<mark> ...]
//   prints '<mark>: main-<n>' (the first main request holding it) or '<mark>: absent' per mark, then
//   'requests=<n> main=<m> exit=<code>'. The run is kept in <runs>/<label>/ (requests/, events/, stdout.txt, run.log,
//   home/, acct/); a label that already has a folder is refused, so a retry takes a new label.
// the scripted turn, in the order typed: --read <file>, --skill <name>, --agent, --step <json of { name, input }>.
//   A dispatched agent runs beside the session (an async launch), so its requests interleave with the session's: a
//   step carrying "sub": true waits for a subagent's request - one whose first message holds SUBAGENT-TURN, which
//   --agent's prompt opens with and a typed Agent step's prompt must too. requests/order.txt names each main
//   request's actor.
// hooks: --inject [--inject-size <n>] (text pushed at SessionStart, SubagentStart and after Read|Edit|Write),
//   --model-hook <model> (a PreToolUse hook on Agent returning updatedInput.model and no permission decision),
//   --ask <needle> (a throwaway plugin whose PreToolUse hook on Write|Edit answers 'ask' for an input naming the
//   needle, loaded with --plugin-dir), --settings <file> (its keys and hook rows merged over the recorder's)
// the run: --approve (trust the folder), --claude <path> (default claude; a .js runs through node), --runs <dir>
//   (default <tmp>/alfred-stage0/runs), --state <run folder> (reuse its home/ and acct/), --usage <n> (the
//   input_tokens the stand-in reports), --arg <cli flag> (passed through, repeatable)
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const VALUED = new Set(['--read', '--skill', '--step', '--model-hook', '--inject-size', '--claude', '--runs', '--state', '--settings', '--usage', '--ask', '--arg']);
const RECORDED = ['InstructionsLoaded', 'SessionStart', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PreToolUse', 'PostToolUse'];
const out = (s) => process.stdout.write(`${s}\n`);
const fail = (s, code) => { process.stderr.write(`${s}\n`); process.exit(code); };

const argv = process.argv.slice(2);
const cut = argv.indexOf('--');
const marks = cut >= 0 ? argv.slice(cut + 1) : [];
const [cwd, label, ...rest] = cut >= 0 ? argv.slice(0, cut) : argv;
if (!cwd || !label) fail('usage: node hook-delivery.js <cwd> <label> [flags] -- <mark> [<mark> ...]', 2);
// flags, in the order typed: [name, value]
const flags = [];
for (let i = 0; i < rest.length; i += 1) flags.push(VALUED.has(rest[i]) ? [rest[i], rest[i += 1]] : [rest[i], true]);
const has = (name) => flags.some(([n]) => n === name);
const all = (name) => flags.filter(([n]) => n === name).map(([, v]) => v);
const one = (name, fallback) => (all(name).length ? all(name).pop() : fallback);

const runs = path.resolve(one('--runs', path.join(os.tmpdir(), 'alfred-stage0', 'runs')));
const base = path.join(runs, label);
if (fs.existsSync(base)) fail(`run folder exists: ${label}`, 2);
const state = one('--state', '');
const home = path.join(state ? path.resolve(state) : base, 'home');
const acct = path.join(state ? path.resolve(state) : base, 'acct');
const events = path.join(base, 'events');
const reqs = path.join(base, 'requests');
for (const d of [home, acct, events, reqs]) fs.mkdirSync(d, { recursive: true });

// the hook scripts, written into the run folder so this file travels alone
const file = (name, text) => { const p = path.join(base, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
// a hook's command line: forward slashes, which Windows takes and no shell reads as an escape
const node = (script, ...args) => [`"${process.execPath}"`, `"${script}"`, ...args].join(' ').replace(/\\/g, '/');
const READ_STDIN = "let raw = '';\nprocess.stdin.on('data', (d) => { raw += d; }).on('end', () =>\n{\n";
const recorder = file('hook.js', `${READ_STDIN}    let name = 'event';\n    try { name = JSON.parse(raw).hook_event_name || name; } catch { /* no payload */ }\n    require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(events)}, \`\${Date.now()}-\${name}-\${process.pid}.json\`), raw);\n});\n`);
// stands in for a rule-loading hook: the documented additionalContext shape, its text from a file when one is named
const injector = file('inject.js', `const [event, mark, textFile] = process.argv.slice(2);\n${READ_STDIN}    const text = textFile ? require('node:fs').readFileSync(textFile, 'utf8') : \`Rule loaded by a hook (\${mark}): a probe rule.\`;\n    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));\n});\n`);
// stands in for a dispatch hook: keeps the Agent call's input, sets its model, answers no permission decision
const modelSetter = file('setmodel.js', `${READ_STDIN}    let input = {};\n    try { input = JSON.parse(raw).tool_input || {}; } catch { /* no payload */ }\n    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input, model: process.argv[2] } } }));\n});\n`);

const hooks = {};
const add = (event, row) => { (hooks[event] = hooks[event] || []).push(row); };
const command = (text) => ({ hooks: [{ type: 'command', command: text, timeout: 10 }] });
for (const event of RECORDED) add(event, command(node(recorder)));
if (has('--inject'))
{
    const SESSION = 'SESSION-INJECT-MARK';
    let textFile = '';
    const size = Number(one('--inject-size', 0));
    if (size)
    {
        if (size < SESSION.length) fail(`--inject-size is under the marker's ${SESSION.length} characters`, 2);
        textFile = file('inject.txt', `${'x'.repeat(size - SESSION.length)}${SESSION}`);
    }
    add('SessionStart', command(node(injector, 'SessionStart', SESSION, ...(textFile ? [`"${textFile}"`] : []))));
    add('SubagentStart', command(node(injector, 'SubagentStart', 'SUBAGENT-INJECT-MARK')));
    add('PostToolUse', { matcher: 'Read|Edit|Write', ...command(node(injector, 'PostToolUse', 'PATH-INJECT-MARK')) });
}
if (has('--model-hook')) add('PreToolUse', { matcher: 'Agent', ...command(node(modelSetter, one('--model-hook'))) });
let settings = { hooks };
if (has('--settings'))
{
    // the caller's file: its hook rows after the recorder's, its other keys as they are
    const extra = JSON.parse(fs.readFileSync(one('--settings'), 'utf8'));
    for (const [event, rows] of Object.entries(extra.hooks || {})) for (const row of rows) add(event, row);
    settings = { ...extra, hooks };
}
const settingsFile = file('hooks.json', JSON.stringify(settings, null, 2));

const cli = ['-p', 'hi', '--debug', '--debug-file', path.join(base, 'run.log'), '--settings', settingsFile, '--output-format', 'stream-json', '--verbose'];
if (has('--ask'))
{
    // a throwaway plugin: the ask arrives by the route a plugin's hook arrives
    const plugin = path.join(base, 'plugin');
    const asker = file(path.join('plugin', 'askhook.js'), `${READ_STDIN}    let input = '';\n    try { input = JSON.stringify(JSON.parse(raw).tool_input || {}).replace(/\\\\\\\\/g, '/'); } catch { /* no payload */ }\n    if (process.argv[2] && input.includes(process.argv[2])) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'PROBE-ASK: this write changes the project rules' } }));\n});\n`);
    file(path.join('plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'probe-ask', version: '0.0.1', description: 'A stand-in guard for one probe run' }, null, 2));
    // the needle crosses JSON and a shell line, so a backslash is a forward slash in it and in the input it is matched against
    file(path.join('plugin', 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write|Edit', ...command(node(asker, `"${one('--ask').replace(/\\/g, '/')}"`)) }] } }, null, 2));
    cli.push('--plugin-dir', plugin);
}
cli.push(...all('--arg'));

if (has('--approve'))
{
    const keys = new Set([cwd, fs.realpathSync(cwd)]);
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    if (top.status === 0) keys.add(top.stdout.trim());
    const config = path.join(acct, '.claude.json');
    let kept = {};
    try { kept = JSON.parse(fs.readFileSync(config, 'utf8')); } catch { kept = {}; }
    const projects = { ...(kept.projects || {}) };
    for (const k of keys) projects[k] = { ...(projects[k] || {}), hasTrustDialogAccepted: true, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: true };
    fs.writeFileSync(config, JSON.stringify({ ...kept, projects }));
}

// the script: one tool call per main request of its actor, in the order the flags were typed, then a plain text
const SUB = 'SUBAGENT-TURN';
const script = [];
for (const [name, value] of flags)
{
    if (name === '--read') script.push({ name: 'Read', input: { file_path: value } });
    else if (name === '--skill') script.push({ name: 'Skill', input: { skill: value } });
    else if (name === '--agent') script.push({ name: 'Agent', input: { description: 'probe', prompt: `${SUB}: say hi`, subagent_type: 'general-purpose' } });
    else if (name === '--step') script.push(JSON.parse(value));
}
const queue = { session: script.filter((s) => !s.sub), subagent: script.filter((s) => s.sub) };
const usage = Number(one('--usage', 10));
let main = 0;
let seen = 0;
function reply(body, step)
{
    const message = { id: `msg_mock_${seen}`, type: 'message', role: 'assistant', model: body.model || 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage, output_tokens: 1 } };
    const block = step
        ? { start: { type: 'tool_use', id: `toolu_mock_${seen}`, name: step.name, input: {} }, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) }, stop: 'tool_use' }
        : { start: { type: 'text', text: '' }, delta: { type: 'text_delta', text: 'done' }, stop: 'end_turn' };
    return { message, block };
}
const server = http.createServer((req, res) =>
{
    let raw = '';
    req.on('data', (d) => { raw += d; }).on('end', () =>
    {
        seen += 1;
        let body = {};
        try { body = JSON.parse(raw); } catch { /* not json */ }
        const url = req.url.split('?')[0];
        const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.method === 'POST' && url === '/v1/messages')
        {
            // a main request carries tools: the session's own turn or a subagent's; anything else is a side request
            const isMain = Array.isArray(body.tools) && body.tools.length > 0;
            const actor = JSON.stringify((body.messages || [])[0] || '').includes(SUB) ? 'subagent' : 'session';
            const step = isMain ? queue[actor].shift() : null;
            if (isMain)
            {
                main += 1;
                fs.writeFileSync(path.join(reqs, `main-${main}.json`), raw);
                fs.appendFileSync(path.join(reqs, 'order.txt'), `main-${main} ${actor}\n`);
            }
            else fs.writeFileSync(path.join(reqs, `side-${seen}.json`), raw);
            const { message, block } = reply(body, step);
            if (!body.stream) return json(200, { ...message, content: step ? [{ ...block.start, input: step.input }] : [{ type: 'text', text: 'done' }], stop_reason: block.stop });
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
        }
        if (req.method === 'POST' && url === '/v1/messages/count_tokens') return json(200, { input_tokens: usage });
        return json(404, { type: 'error', error: { type: 'not_found_error', message: 'stand-in server' } });
    });
});

server.listen(0, '127.0.0.1', () =>
{
    const source = process.env;
    const env = {
        CLAUDE_CONFIG_DIR: acct, HOME: home, USERPROFILE: home,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        // a bearer for the stand-in only: built here, never a real login, and the API-key variable stays unset
        ANTHROPIC_AUTH_TOKEN: ['stand', 'in', 'local', 'only'].join('-'),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    for (const k of ['PATH', 'TMPDIR', 'SystemRoot', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA']) if (source[k] !== undefined) env[k] = source[k];
    const binary = one('--claude', 'claude');
    // a .js stands in for the binary in the tests; a bare spawn of one fails on Windows
    const [program, args] = /\.js$/.test(binary) ? [process.execPath, [binary, ...cli]] : [binary, cli];
    const child = spawn(program, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    let closed = false;
    const done = (code) =>
    {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        server.close();
        fs.writeFileSync(path.join(base, 'stdout.txt'), stdout);
        const texts = [];
        for (let n = 1; n <= main; n += 1) texts.push(fs.readFileSync(path.join(reqs, `main-${n}.json`), 'utf8'));
        for (const mark of marks)
        {
            const n = texts.findIndex((t) => t.includes(mark));
            out(`${mark}: ${n < 0 ? 'absent' : `main-${n + 1}`}`);
        }
        out(`requests=${seen} main=${main} exit=${code}`);
    };
    child.on('error', (err) => done(`spawn-${err.code || 'failed'}`));
    child.on('close', (code, signal) => done(code === null ? `signal-${signal}` : code));
});
