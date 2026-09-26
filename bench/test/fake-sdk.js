'use strict';
// A stand-in for @anthropic-ai/claude-agent-sdk, for the flow tests: it never calls a model. Like the
// real SDK it spawns the CLI through the host's spawnClaudeCodeProcess (here the fake CLI's stream
// mode, which lives until its stdin closes), reads the streamed input EAGERLY - a pump pulls the next
// user message as soon as the host yields it, as the real SDK's does - plays one scripted turn per
// message (AskUserQuestion and permission requests through the host's canUseTool, edits in the
// clone), yields that turn's result, and ends once the input has ended and the CLI has exited. It
// writes the transcript where the CLI would (<CLAUDE_CONFIG_DIR>/projects/<cwd>/<session-id>.jsonl).
//
//   turns[i] = {
//     asks:  [[question, ...], ...]          each an AskUserQuestion call through canUseTool
//     tools: [{ name, input, blockedPath }]  each a permission request through canUseTool
//     edit:  ['rel/path']                    a file written into the clone
//     error: '<result subtype>'              the turn ends in an error result
//     limit: true                            the turn ends in a usage-limit result
//     leak:  true                            the turn's text carries the auth value, as a model running `env` would
//     hang:  true                            the turn never ends: the CLI must be killed
//   }
//
// `seen` collects what the host did: the options it passed, each input with the number of results
// already yielded when it arrived, and every canUseTool answer - for the last session on its own
// keys, and for every session in `seen.calls` (a drive runs several).
const fs = require('node:fs');
const path = require('node:path');

// `lazy: true` pulls the next user message only once the turn before it has yielded its result - an
// SDK the host must not rely on to be eager.
function fakeSdk({ turns = [], version = '0.0.0-sdk', claudeCodeVersion = '0.0.0-fake', seen = {}, lazy = false } = {})
{
    return async () => ({ version, claudeCodeVersion, query: (params) => play(params, turns, seen, lazy) });
}

async function* play({ prompt, options }, turns, seen, lazy)
{
    const call = { options, inputs: [], permissions: [] };
    seen.calls = [...(seen.calls || []), call];
    Object.assign(seen, call);
    const sid = options.sessionId;
    const cli = options.pathToClaudeCodeExecutable;
    const flags = ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--model', options.model, '--session-id', sid];
    const [command, args] = cli.endsWith('.js') ? [process.execPath, [cli, ...flags]] : [cli, flags];
    const child = options.spawnClaudeCodeProcess({ command, args, cwd: options.cwd, env: { ...options.env, CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }, signal: new AbortController().signal });
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

    const dir = path.join(options.env.CLAUDE_CONFIG_DIR, 'projects', options.cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const transcript = path.join(dir, `${sid}.jsonl`);
    const row = (r) => fs.appendFileSync(transcript, `${JSON.stringify(r)}\n`);

    let results = 0;
    const queue = [];
    let wake = null;
    let ended = false;
    const iterator = prompt[Symbol.asyncIterator]();
    const pullOne = async () =>
    {
        const got = await iterator.next();
        if (got.done) return null;
        call.inputs.push({ content: got.value.message.content, resultsBefore: results });
        return got.value;
    };
    const pump = async () =>
    {
        for (let msg = await pullOne(); msg; msg = await pullOne())
        {
            queue.push(msg);
            if (wake) wake();
        }
    };
    // Runs beside the turns, as the real SDK's input stream does; a failed input ends it like a closed one.
    if (!lazy) void pump().catch((e) => { call.inputError = e.message; }).finally(() => { ended = true; if (wake) wake(); });
    const next = async () =>
    {
        if (lazy) return pullOne();
        while (!queue.length && !ended) await new Promise((resolve) => { wake = resolve; });
        wake = null;
        return queue.shift() || null;
    };

    yield { type: 'system', subtype: 'init', session_id: sid, model: options.model, permissionMode: options.permissionMode };
    let i = 0;
    for (let msg = await next(); msg; msg = await next())
    {
        const turn = turns[i] || {};
        i += 1;
        row({ type: 'user', sessionId: sid, message: msg.message });
        let n = 0;
        const ask = async (name, input, extra = {}) =>
        {
            const id = `toolu_${i}_${n++}`;
            const use = { type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } };
            const answer = await options.canUseTool(name, input, { signal: new AbortController().signal, toolUseID: id, requestId: id, ...extra });
            call.permissions.push({ tool: name, answer });
            const content = answer.behavior === 'allow' ? JSON.stringify(answer.updatedInput) : answer.message;
            return [use, { type: 'user', session_id: sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: answer.behavior !== 'allow' }] } }];
        };
        for (const questions of turn.asks || []) yield* await ask('AskUserQuestion', { questions });
        for (const tool of turn.tools || []) yield* await ask(tool.name, tool.input, tool.blockedPath ? { blockedPath: tool.blockedPath } : {});
        for (const rel of turn.edit || [])
        {
            const file = path.join(options.cwd, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `turn ${i}\n`);
        }
        if (turn.hang)
        {
            const gone = await exited;
            throw new Error(`Claude Code process exited with ${gone.code === null ? gone.signal : `code ${gone.code}`}`);
        }
        const text = `turn ${i} done${turn.leak ? ` ${options.env.ANTHROPIC_API_KEY}` : ''}`;
        const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
        const assistant = { type: 'assistant', sessionId: sid, message: { id: `msg_fake_${i}`, role: 'assistant', model: options.model, content: [{ type: 'text', text }], usage } };
        row(assistant);
        yield { ...assistant, session_id: sid, parent_tool_use_id: null };
        results += 1;
        if (turn.limit) yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid, result: 'Claude AI usage limit reached|1790000000' };
        else yield { type: 'result', subtype: turn.error || 'success', is_error: Boolean(turn.error), session_id: sid, num_turns: 1, result: text };
    }
    child.stdin.end();
    const gone = await exited;
    if (gone.code !== 0) throw new Error(`Claude Code process exited with ${gone.code === null ? gone.signal : `code ${gone.code}`}`);
}

module.exports = { fakeSdk };
