'use strict';
// The flow block's driver: one cell driven through the Agent SDK, so the arm's own recommended entry
// runs with a scripted approver answering every stop. Print mode cannot show AskUserQuestion; the
// SDK's canUseTool fires on it and takes the answers.
//
// The session is the plain cell's (lib/session.js run() calls this driver where a plain cell spawns
// `claude -p`): the same installed CLI, cwd, env, settings layer, model, effort and permission mode,
// the Claude Code system prompt `claude -p` runs (the SDK's own default is a minimal one), and the
// same time limit, limit detection and result handling. What differs is only what a flow is:
//   - the arm's prompts for the task's kind go one after another in ONE session, each once the turn
//     before it has a result; `{prompt}` is the task's prompt, `{file:<path>}` the one file in the
//     clone that path names when the prompt is sent (the findings or plan the step before it wrote);
//   - canUseTool answers AskUserQuestion with, per question, the option whose label carries
//     '(Recommended)', else the first, and refuses every other permission request with print mode's
//     own words - so a flow cell gets no permission a plain cell lacks. Plan mode is the exception
//     print mode never meets (it has no plan tools): ExitPlanMode is a stop, answered with its first
//     option - the plan is approved - because a refused one leaves the session in plan mode until the
//     time limit; EnterPlanMode needs no answer and is let through;
//   - the first turn waits for the plugin MCP servers the way print mode's does. Print mode waits up
//     to 2 s for every pending server; a streaming-input session waits for none of the deferred ones
//     (CLI 2.1.283, qf(): waitForDeferrable is false there) and starts with them all pending (b4-probe-
//     flow-ours: 4 of 4 pending, 29 tools against a plain cell's 105). CLAUDE_CODE_MCP_STARTUP_WAIT_MS
//     = 2000 sets exactly print mode's pair - a 2 s deadline, every pending server.
//   - every SDK message goes to stdout.jsonl (the stream-json shape print mode writes), every answer
//     and refusal to approvals.jsonl.
// A turn that ends in an error result, or a {file:} that names no single file, stops the flow there:
// the session ends and its work is graded like any cell's.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { kill } = require('./session.js');

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
const WIN = process.platform === 'win32';
const RECOMMENDED = /\(recommended\)/i;
const FLOW_TOKEN = /\{prompt\}|\{file:([^}]*)\}/g;
const MCP_FIRST_TURN_WAIT_MS = '2000';
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const READ_TOOLS = ['Read', 'Glob', 'Grep'];

// The ESM SDK from this CommonJS harness, with the Claude Code version its package says it speaks.
async function loadSdk()
{
    let entry;
    try { entry = require.resolve(SDK_PACKAGE); }
    catch { throw new Error(`the Agent SDK (${SDK_PACKAGE}) is not installed - run npm install at the repo root`); }
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8'));
    const mod = await import(SDK_PACKAGE);
    return { query: mod.query, version: pkg.version, claudeCodeVersion: pkg.claudeCodeVersion };
}

// The SDK drives the installed CLI over its control protocol, which is versioned with the CLI: an
// SDK built for another Claude Code is refused rather than trusted to speak this one's.
function assertSdkMatches(sdk, cliVersion)
{
    if (!sdk.claudeCodeVersion) throw new Error(`Agent SDK ${sdk.version} names no Claude Code version - it cannot be matched to the CLI`);
    const cli = String(cliVersion).trim();
    if (cli !== sdk.claudeCodeVersion && !cli.startsWith(`${sdk.claudeCodeVersion} `)) throw new Error(`Agent SDK ${sdk.version} is built for Claude Code ${sdk.claudeCodeVersion} - this CLI is ${cli}`);
}

// The executable the SDK starts: the same `claude` a plain cell spawns, resolved on the host PATH to
// a file (the SDK takes a path, never a command name). A node-run CLI is its script.
function cliPath(claude, PATH)
{
    if (claude.length > 1) return path.resolve(claude[claude.length - 1]);
    const name = claude[0];
    if (name.includes('/')) return path.resolve(name);
    for (const dir of String(PATH || '').split(path.delimiter).filter(Boolean))
    {
        const file = path.join(dir, name);
        try
        {
            fs.accessSync(file, fs.constants.X_OK);
            if (fs.statSync(file).isFile()) return file;
        }
        catch { /* next */ }
    }
    throw new Error(`no ${name} on the PATH - the flow drives the CLI the plain cells run`);
}

// The approver's pick for one question: the option labelled '(Recommended)', else the first. A
// multi-select question takes every recommended option.
function choose(q)
{
    const options = Array.isArray(q.options) ? q.options : [];
    const recommended = options.filter((o) => RECOMMENDED.test(String(o.label)));
    if (recommended.length) return { answer: (q.multiSelect ? recommended : recommended.slice(0, 1)).map((o) => o.label).join(', '), by: 'recommended' };
    return { answer: options[0].label, by: 'first' };
}

// Print mode's own refusal is the ask's message, which the CLI never hands an SDK host - it sends a
// reason string instead. So: a file tool names its path, as the CLI words it ('write to' / 'read
// from'); any other ask carrying a reason gets that reason, which IS print mode's text for the common
// case ('This command requires approval' - 5 of pilot 2's Bash refusals) and a close one for the
// rest (a compound command's print text also lists the parts, which the host is not told); no reason
// is the CLI's own default sentence.
function refusal(toolName, input, blockedPath, decisionReason)
{
    const target = blockedPath || input.file_path || input.notebook_path || input.path;
    if (target && WRITE_TOOLS.includes(toolName)) return `Claude requested permissions to write to ${target}, but you haven't granted it yet.`;
    if (target && READ_TOOLS.includes(toolName)) return `Claude requested permissions to read from ${target}, but you haven't granted it yet.`;
    if (typeof decisionReason === 'string' && decisionReason.trim()) return decisionReason;
    return `Claude requested permissions to use ${toolName}, but you haven't granted it yet.`;
}

// The files a {file:} pattern names in the clone, as paths relative to it (`*` in the last part only).
function filesNamed(repo, rel)
{
    const dir = path.posix.dirname(rel);
    const re = new RegExp(`^${path.posix.basename(rel).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    let names;
    try { names = fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name); }
    catch { names = []; }
    return names.sort().map((n) => (dir === '.' ? n : `${dir}/${n}`));
}

// One prompt as sent: every token filled in a single pass, so a task prompt that happens to contain
// '{file:...}' or '$&' is inserted as written.
function fill(template, { taskPrompt, repo })
{
    let file = null;
    let stop = null;
    const text = template.replace(FLOW_TOKEN, (whole, rel) =>
    {
        if (rel === undefined) return taskPrompt;
        const found = filesNamed(repo, rel);
        if (found.length !== 1) { stop = `{file:${rel}} names ${found.length} files`; return whole; }
        [file] = found;
        return file;
    });
    return stop ? { stop } : { text, file };
}

function driver({ sdk, cli, prompts })
{
    return async ({ cell, prompt, session, sessionId, tmp, env, timeLimitMin, graceMs }) =>
    {
        const taskPrompt = prompt.replace(/\s+$/, '');
        const approvalsFile = path.join(cell.results, 'approvals.jsonl');
        const out = fs.openSync(cell.stdout, 'w');
        const err = fs.openSync(cell.stderr, 'w');
        fs.writeFileSync(approvalsFile, '');
        const note = (row) => fs.appendFileSync(approvalsFile, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);

        const sent = [];
        const results = [];
        let flowStopped = null;
        let turn = 0;
        let child = null;
        let exited = null;
        let cliArgs = null;
        let spawnError = null;
        let sdkError = null;
        let timedOut = false;
        let killer = null;
        const counts = { answered: 0, denied: 0 };
        const abort = new AbortController();

        // The input pump waits here until n turns have a result, the session is over or the time
        // limit struck. It counts rather than trusting a wake-up to land while it waits, so an SDK that
        // pulls its input lazily cannot strand it.
        let waiter = null;
        let sdkDone = false;
        const wake = () => { if (waiter) { const w = waiter; waiter = null; w(); } };
        const turnsEnded = async (n) =>
        {
            while (results.length < n && !timedOut && !sdkDone) await new Promise((resolve) => { waiter = resolve; });
        };

        async function* input()
        {
            for (let i = 0; i < prompts.length; i++)
            {
                if (i > 0)
                {
                    await turnsEnded(i);
                    if (timedOut || results.length < i) return;
                    const last = results[results.length - 1];
                    if (last.is_error) { flowStopped = `prompt ${i} ended in an error result (${last.subtype})`; return; }
                }
                const filled = fill(prompts[i], { taskPrompt, repo: cell.repo });
                if (filled.stop) { flowStopped = `prompt ${i + 1}: ${filled.stop}`; return; }
                turn = i + 1;
                sent.push({ at: new Date().toISOString(), template: prompts[i], file: filled.file });
                yield { type: 'user', message: { role: 'user', content: filled.text }, parent_tool_use_id: null };
            }
            // Closing the input ends the session: wait for the last turn's result first.
            await turnsEnded(prompts.length);
        }

        const canUseTool = async (toolName, toolInput, opts = {}) =>
        {
            const ids = { turn, toolUseId: opts.toolUseID || null, agentId: opts.agentID || null };
            if (toolName === 'EnterPlanMode') return { behavior: 'allow', updatedInput: toolInput };
            if (toolName === 'ExitPlanMode')
            {
                counts.answered += 1;
                note({ kind: 'answer', ...ids, tool: 'ExitPlanMode', answer: 'approve', by: 'first' });
                return { behavior: 'allow', updatedInput: toolInput };
            }
            const questions = toolName === 'AskUserQuestion' && Array.isArray(toolInput.questions) ? toolInput.questions : null;
            if (questions && questions.length && questions.every((q) => Array.isArray(q.options) && q.options.length))
            {
                const answers = {};
                for (const q of questions)
                {
                    const { answer, by } = choose(q);
                    answers[q.question] = answer;
                    counts.answered += 1;
                    note({ kind: 'answer', ...ids, header: q.header || null, question: q.question, multiSelect: Boolean(q.multiSelect), options: q.options.map((o) => o.label), answer, by });
                }
                return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
            }
            const message = refusal(toolName, toolInput || {}, opts.blockedPath, opts.decisionReason);
            counts.denied += 1;
            note({ kind: 'deny', ...ids, tool: toolName, message, decisionReason: opts.decisionReason || null });
            return { behavior: 'deny', message };
        };

        // The CLI leads its own process group, as a plain cell's does, so a stop reaches every build
        // and test it started; its stderr goes to the cell's stderr.log.
        const spawnClaudeCodeProcess = ({ command, args, cwd, env: childEnv, signal }) =>
        {
            cliArgs = args;
            child = spawn(command, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', err], detached: !WIN });
            exited = new Promise((resolve) =>
            {
                child.once('exit', (code, sig) => resolve({ code, signal: sig }));
                child.once('error', (e) => { spawnError = e.code || e.message; resolve({ code: null, signal: null }); });
            });
            signal.addEventListener('abort', () => kill(child, 'SIGTERM'), { once: true });
            return child;
        };

        const started = Date.now();
        const limit = setTimeout(() =>
        {
            timedOut = true;
            wake();
            if (child) kill(child, 'SIGTERM');
            abort.abort();
            killer = setTimeout(() => { if (child) kill(child, 'SIGKILL'); }, graceMs);
        }, timeLimitMin * 60 * 1000);

        try
        {
            const q = sdk.query({
                prompt: input(),
                options: {
                    pathToClaudeCodeExecutable: cli, cwd: cell.repo, env: { ...env, CLAUDE_CODE_MCP_STARTUP_WAIT_MS: MCP_FIRST_TURN_WAIT_MS },
                    model: session.model, effort: session.effort, permissionMode: session.permissionMode, settings: session.settingsFile,
                    settingSources: ['user', 'project', 'local'], systemPrompt: { type: 'preset', preset: 'claude_code' },
                    allowedTools: tmp ? [`Read(/${tmp}/**)`] : [], sessionId,
                    canUseTool, spawnClaudeCodeProcess, abortController: abort,
                },
            });
            for await (const message of q)
            {
                fs.writeSync(out, `${JSON.stringify(message)}\n`);
                if (message.type === 'result')
                {
                    results.push(message);
                    wake();
                }
            }
        }
        catch (e) { sdkError = e.message || String(e); }
        finally
        {
            sdkDone = true;
            wake();
        }

        // The SDK ends once the CLI's output does; its exit is what a plain cell's status is read from.
        let status = { code: null, signal: null };
        if (exited)
        {
            let bound = null;
            const bounded = await Promise.race([exited, new Promise((resolve) => { bound = setTimeout(() => resolve(null), graceMs + 1000); })]);
            clearTimeout(bound);
            if (bounded) status = bounded;
            else
            {
                kill(child, 'SIGKILL');
                status = await exited;
            }
        }
        clearTimeout(limit);
        clearTimeout(killer);
        fs.closeSync(out);
        fs.closeSync(err);
        const ended = Date.now();

        const last = results[results.length - 1];
        let failed = null;
        if (!timedOut)
        {
            if (!exited) failed = 'the SDK never started the CLI';
            else if (!last) failed = 'the session wrote no result';
            else if (last.is_error) failed = `the last turn ended in an error result (${last.subtype})`;
            else if (sdkError) failed = `the SDK stopped: ${sdkError}`;
        }
        return {
            code: status.code, signal: status.signal, error: spawnError, timedOut, started, ended, failed,
            extra: { mode: 'flow', sdk: sdk.version, sent, flowStopped, sdkError, ...counts, cliArgs },
        };
    };
}

module.exports = { driver, loadSdk, assertSdkMatches, cliPath, choose, refusal, fill, SDK_PACKAGE };
