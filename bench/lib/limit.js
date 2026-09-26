'use strict';
// A usage-limit stop, told apart from the arm's own failure. On a subscription the plan's limit ends
// every later session with an error result, which graded as-is would score 0 against whichever arm
// happened to run next. The shapes are NOT verified against a real limit (none can be provoked on
// purpose), so the pattern is deliberately wide and only ever read on an ERROR - a successful session
// that talks about rate limits is the task, not a limit. What it misses stays an `error` cell, and the
// phase-end review of every error cell is the net.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sessionEnv } = require('./env.js');

const LIMIT_RE = /usage limit|limit reached|hit your limit|rate[_ -]?limit|\b429\b|resets? (at )?\d/i;
const PROBE_PROMPT = 'Reply with the single word ok';
const PROBE_TIMEOUT_MS = 2 * 60 * 1000;

function readText(file)
{
    try { return fs.readFileSync(file, 'utf8'); }
    catch { return ''; }
}

function lastResult(text)
{
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--)
    {
        let row = null;
        try { row = JSON.parse(lines[i]); }
        catch { continue; }
        if (row && row.type === 'result') return row;
    }
    return null;
}

function limitHit({ stdoutFile, stderrFile })
{
    const result = lastResult(readText(stdoutFile));
    if (result && !result.is_error) return { hit: false, text: null };
    if (result)
    {
        const text = String(result.result || '');
        return LIMIT_RE.test(text) ? { hit: true, text } : { hit: false, text: null };
    }
    // No result at all: the CLI died before it could write one, and stderr is all there is.
    const line = readText(stderrFile).split('\n').find((l) => LIMIT_RE.test(l));
    return line ? { hit: true, text: line.trim() } : { hit: false, text: null };
}

// One short question through the same credential and env shape a cell gets, in a throwaway account
// dir. Only a successful result says the limit has cleared: a probe that fails for any other reason
// keeps the run waiting, because resuming into a broken route would fail every cell it starts.
async function probe({ claude = ['claude'], session, base = process.env, auth })
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-probe-'));
    try
    {
        const config = path.join(dir, 'config');
        const home = path.join(dir, 'home');
        fs.mkdirSync(config);
        fs.mkdirSync(home);
        const env = sessionEnv({ base, session, arm: null, config, home, auth });
        const argv = ['-p', '--output-format', 'stream-json', '--verbose', '--model', session.model, '--max-turns', '1', PROBE_PROMPT];
        const r = spawnSync(claude[0], [...claude.slice(1), ...argv], { cwd: dir, env, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' });
        const result = lastResult(r.stdout || '');
        if (result && !result.is_error && r.status === 0) return { ok: true, text: null };
        if (result) return { ok: false, text: String(result.result || 'an error result') };
        return { ok: false, text: r.error ? `the probe failed: ${r.error.code || r.error.message}` : `the probe exited ${r.status === null ? r.signal : r.status} with no result` };
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { limitHit, probe, LIMIT_RE };
