#!/usr/bin/env node
'use strict';
// A stand-in for `claude -p`, for the harness tests: it writes a transcript where the real CLI
// writes one (<CLAUDE_CONFIG_DIR>/projects/<cwd, non-alphanumerics as '-'>/<session-id>.jsonl) and
// prints stream-json, then does what its FAKE_* variables ask. Those reach it through the arm's own
// env, the one channel the harness lets through.
//
//   FAKE_RECORD=<file>        write { argv, env, cwd, tmpdirExists } there first
//   FAKE_EDIT=<name>          write a file into the clone
//   FAKE_WRITE_OUTSIDE=<path> write a file outside it
//   FAKE_SUBAGENT=1           add one subagent transcript
//   FAKE_LEAK=1|<VAR>         put an auth value (ANTHROPIC_API_KEY, or the named variable) into the transcript,
//                             stdout and the edit - a model running `env`
//   FAKE_SLEEP_MS=<n>         wait before finishing; FAKE_IGNORE_TERM=1 survives SIGTERM
//   FAKE_EXIT=<n>             the exit status
//   FAKE_STDERR=<text>        write <text> to stderr first
//   FAKE_LIMIT_FILE=<file>    while <file> exists ({ "from": n }), the nth session started and every later
//                             one ends on a usage-limit result (counted in <file>.count)
//   --version                 prints a fake version, as the driver asks the real CLI
//   plugin list --json        prints FAKE_PLUGINS (a JSON list), or [] - what a template's setup installed
//   mcp list                  appends { cwd, MCP_TIMEOUT, UV_CACHE_DIR, UV_PYTHON_INSTALL_DIR } to FAKE_WARM_RECORD, if set
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
if (argv[0] === '--version') { process.stdout.write('0.0.0-fake (Claude Code)\n'); process.exit(0); }
if (argv[0] === 'plugin' && argv[1] === 'list')
{
    if (process.env.FAKE_PLUGINS_FAIL) { process.stderr.write('plugin list failed\n'); process.exit(1); }
    process.stdout.write(`${process.env.FAKE_PLUGINS || '[]'}\n`);
    process.exit(0);
}
if (argv[0] === 'mcp' && argv[1] === 'list')
{
    const e = process.env;
    if (e.FAKE_WARM_RECORD) fs.appendFileSync(e.FAKE_WARM_RECORD, `${JSON.stringify({ cwd: process.cwd(), MCP_TIMEOUT: e.MCP_TIMEOUT, UV_CACHE_DIR: e.UV_CACHE_DIR, UV_PYTHON_INSTALL_DIR: e.UV_PYTHON_INSTALL_DIR })}\n`);
    process.stdout.write('Checking MCP server health...\n\nplugin:p:s1: fake - ✔ Connected\n');
    process.exit(0);
}
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const env = process.env;
const sid = flag('--session-id');
const prompt = argv[argv.length - 1];
if (env.FAKE_STDERR) process.stderr.write(`${env.FAKE_STDERR}\n`);
if (env.FAKE_RECORD) fs.writeFileSync(env.FAKE_RECORD, JSON.stringify({ argv, env: { ...env }, cwd: process.cwd(), tmpdirExists: Boolean(env.TMPDIR) && fs.existsSync(env.TMPDIR) }));

const leakName = env.FAKE_LEAK === '1' ? 'ANTHROPIC_API_KEY' : env.FAKE_LEAK;
const leak = leakName ? ` ${env[leakName]}` : '';
const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const rows = [
    { type: 'user', sessionId: sid, message: { role: 'user', content: prompt } },
    { type: 'assistant', sessionId: sid, message: { id: 'msg_fake_1', role: 'assistant', model: flag('--model'), content: [{ type: 'text', text: `done${leak}` }], usage } },
];
fs.writeFileSync(path.join(dir, `${sid}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
if (env.FAKE_SUBAGENT)
{
    const sub = path.join(dir, sid, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), `${JSON.stringify({ type: 'assistant', message: { id: 'msg_fake_sub', role: 'assistant', content: [], usage } })}\n`);
}
if (env.FAKE_EDIT) fs.writeFileSync(path.join(process.cwd(), env.FAKE_EDIT), `edited${leak}\n`);
if (env.FAKE_WRITE_OUTSIDE) fs.writeFileSync(env.FAKE_WRITE_OUTSIDE, 'outside\n');

process.stdout.write(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: sid })}\n`);
if (env.FAKE_LIMIT_FILE && fs.existsSync(env.FAKE_LIMIT_FILE))
{
    const { from } = JSON.parse(fs.readFileSync(env.FAKE_LIMIT_FILE, 'utf8'));
    fs.appendFileSync(`${env.FAKE_LIMIT_FILE}.count`, 'x');
    if (fs.statSync(`${env.FAKE_LIMIT_FILE}.count`).size >= from)
    {
        process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid, result: 'Claude AI usage limit reached|1790000000' })}\n`);
        process.exit(1);
    }
}
const finish = () =>
{
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', session_id: sid, result: `done${leak}` })}\n`);
    process.exit(Number(env.FAKE_EXIT || 0));
};
if (env.FAKE_IGNORE_TERM) process.on('SIGTERM', () => {});
if (env.FAKE_SLEEP_MS) setTimeout(finish, Number(env.FAKE_SLEEP_MS));
else finish();
