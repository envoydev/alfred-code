#!/usr/bin/env node
'use strict';
// HK-22 replay (audit 2026-10-30, the gate of 2026-11-04): runs recorded done-closes through the shipped `prompt` Stop
// hook text (stack/hooks/stop-judge-prompt.txt) and scores each verdict. Nothing shipped reads this file.
//
//   node scripts/ab-hk22.js --dry-run --closes <f.jsonl>                 print the call per close; launch nothing
//   node scripts/ab-hk22.js --live --run <n> --cache <f> --cap <usd> --closes <f.jsonl>
//        BILLED - one model call per close not in the cache; the cache file's whole spend counts against --cap
//   node scripts/ab-hk22.js score --cache <f> --closes <f.jsonl> [--labels <json>] [--runs 1,2,3] [--v2 <verdicts.json>]
//        [--unsure release|exclude] [--holds-out <f> --holds-run <n>] [--bar 'median>=132,min>=127,wrongholds<=20,flips<=8']
//   options: --prompt <file> (default stack/hooks/stop-judge-prompt.txt), --model <full id> (default claude-haiku-5-5)
//
// A row: {"id": "3", "close": "<final assistant text>", "expected"?: "hold"|"release", "stop_hook_active"?: bool,
// "background_tasks"?: []}. The real closes hold private session text: keep them outside the repo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const ROOT = path.join(__dirname, '..');
const SYSTEM = 'You evaluate one Claude Code hook condition and answer with JSON only.';
const DEFAULT_PROMPT = 'stack/hooks/stop-judge-prompt.txt';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const CALL_BUDGET = '0.05';

function fail(message, code = 2)
{
    process.stderr.write(`ab-hk22: ${message}\n`);
    process.exit(code);
}

function parseArgs(argv)
{
    const opts = { mode: null, closes: null, run: null, cache: null, cap: null, prompt: path.join(ROOT, DEFAULT_PROMPT), model: DEFAULT_MODEL,
        labels: null, runs: null, v2: null, unsure: 'release', holdsOut: null, holdsRun: null, bar: null };
    const valued = { '--closes': 'closes', '--run': 'run', '--cache': 'cache', '--cap': 'cap', '--prompt': 'prompt', '--model': 'model',
        '--labels': 'labels', '--runs': 'runs', '--v2': 'v2', '--unsure': 'unsure', '--holds-out': 'holdsOut', '--holds-run': 'holdsRun', '--bar': 'bar' };
    for (let i = 0; i < argv.length; i += 1)
    {
        const a = argv[i];
        if (a === '--dry-run' || a === '--live' || (a === 'score' && i === 0))
        {
            if (opts.mode) fail('pass one of --dry-run, --live or score');
            opts.mode = a.replace(/^--/, '');
        }
        else if (valued[a])
        {
            if (i + 1 >= argv.length) fail(`${a} needs a value`);
            opts[valued[a]] = argv[i += 1];
        }
        else fail(`unknown argument ${a}`);
    }
    if (!opts.mode) fail('pass --dry-run, --live (billed: one model call per close not cached) or score');
    if (!opts.closes) fail('--closes <f.jsonl> is required');
    if (opts.mode === 'live' && (opts.run === null || !opts.cache || opts.cap === null)) fail('--live needs --run, --cache and --cap');
    if (opts.mode === 'score' && !opts.cache) fail('score needs --cache');
    if (opts.run !== null && !/^[1-9]\d*$/.test(opts.run)) fail('--run takes a positive whole number');
    if (opts.cap !== null && !(Number(opts.cap) >= 0)) fail('--cap takes a dollar amount');
    if (!['release', 'exclude'].includes(opts.unsure)) fail("--unsure takes 'release' or 'exclude'");
    if ((opts.holdsOut === null) !== (opts.holdsRun === null)) fail('--holds-out and --holds-run go together');
    return opts;
}

// The prompt is the whole file, trimmed: the text the installer writes into the entry.
function readPrompt(file)
{
    const prompt = fs.readFileSync(file, 'utf8').trim();
    if (!/(^|[^\\])\$ARGUMENTS/.test(prompt)) throw new Error(`${file} carries no $ARGUMENTS placeholder`);
    return prompt;
}

function readCloses(file)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (err) { fail(`cannot read ${file}: ${err.message}`); }
    const rows = [];
    text.split(/\r?\n/).forEach((line, i) =>
    {
        if (!line.trim()) return;
        const where = `line ${i + 1}`;
        let row;
        try { row = JSON.parse(line); }
        catch { fail(`${where}: not JSON`); }
        if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${where}: not a JSON object`);
        if (row.id === undefined || row.id === null || String(row.id).trim() === '') fail(`${where}: id missing`);
        if (typeof row.close !== 'string' || !row.close.trim()) fail(`${where}: close must be a non-empty string`);
        if (row.expected !== undefined && row.expected !== 'hold' && row.expected !== 'release') fail(`${where}: expected must be 'hold' or 'release' when given`);
        if (row.stop_hook_active !== undefined && typeof row.stop_hook_active !== 'boolean') fail(`${where}: stop_hook_active must be true or false`);
        if (row.background_tasks !== undefined && !Array.isArray(row.background_tasks)) fail(`${where}: background_tasks must be an array`);
        rows.push({ id: String(row.id), close: row.close, expected: row.expected, stopHookActive: row.stop_hook_active === true, backgroundTasks: row.background_tasks || [], raw: row });
    });
    if (!rows.length) fail(`no closes in ${file}`);
    return rows;
}

// The Stop hook input a prompt hook receives as $ARGUMENTS (code.claude.com/docs/en/hooks, 'Stop input').
function hookInput(row)
{
    return JSON.stringify({
        session_id: `ab-hk22-${row.id}`,
        transcript_path: '',
        cwd: '',
        permission_mode: 'default',
        hook_event_name: 'Stop',
        stop_hook_active: row.stopHookActive,
        last_assistant_message: row.close,
        background_tasks: row.backgroundTasks,
        session_crons: [],
    });
}

// `$ARGUMENTS` takes the input JSON, `\$` renders as `$`, and a prompt without the placeholder gets the JSON appended.
function render(prompt, input)
{
    if (!/(^|[^\\])\$ARGUMENTS/.test(prompt)) return `${prompt.replace(/\\\$/g, '$')}\n\n${input}`;
    return prompt.replace(/\\\$|\$ARGUMENTS/g, (m) => (m === '\\$' ? '$' : input));
}

// Bare mode authenticates with ANTHROPIC_API_KEY only (Claude Code 2.1.316: a subscription token alone answers 'Not
// logged in'), so a CLAUDE_CODE_OAUTH_TOKEN run drops --bare and needs its own CLAUDE_CONFIG_DIR, which keeps the
// account's hooks, plugins and CLAUDE.md out of the call the way bare mode does.
function authOf(env)
{
    if (env.ANTHROPIC_API_KEY || !env.CLAUDE_CODE_OAUTH_TOKEN) return { bare: true };
    if (!env.CLAUDE_CONFIG_DIR) return { bare: false, error: 'a CLAUDE_CODE_OAUTH_TOKEN run needs CLAUDE_CONFIG_DIR set to an empty folder, so no account hook, plugin or CLAUDE.md joins the call' };
    return { bare: false };
}

// A full id only: the shipped entry carries no model key (Claude Code's background model), and an alias reaches the
// API as written (2026-11-03: `haiku` failed every call).
function claudeArgs(model, { bare = true } = {})
{
    if (!/^claude-/.test(String(model || ''))) throw new Error(`a full model id (claude-...) - an alias reaches the API as written: ${model}`);
    return ['-p', ...(bare ? ['--bare'] : []), '--tools', '', '--model', model, '--output-format', 'json', '--max-turns', '1',
        '--no-session-persistence', '--max-budget-usd', CALL_BUDGET, '--system-prompt', SYSTEM];
}

const quote = (s) => (/^[A-Za-z0-9_./=:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// The model's verdict from the CLI's json output: `result` holds its text, which holds the decision object.
function verdictOf(stdout)
{
    let outer;
    try { outer = JSON.parse(stdout); }
    catch { return { verdict: 'unparsed', reason: 'the CLI output is not JSON', cost: 0 }; }
    const text = outer && typeof outer.result === 'string' ? outer.result : '';
    const m = text.match(/\{[\s\S]*\}/);
    let decision = null;
    try { decision = m ? JSON.parse(m[0]) : null; }
    catch { decision = null; }
    const cost = outer && typeof outer.total_cost_usd === 'number' ? outer.total_cost_usd : 0;
    if (!decision || typeof decision.ok !== 'boolean') return { verdict: 'unparsed', reason: text.slice(0, 200), cost };
    const hold = decision.ok === false && decision.impossible !== true;
    return { verdict: hold ? 'hold' : 'release', reason: String(decision.reason || ''), cost };
}

function cacheKey(model, run, stdin)
{
    return crypto.createHash('sha256').update(JSON.stringify([String(model), Number(run), String(stdin)])).digest('hex');
}

// One JSON line per call; a line that does not parse is skipped, and a later line for a key wins.
function readCache(file)
{
    const map = new Map();
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return map; }
    for (const line of text.split(/\r?\n/))
    {
        if (!line.trim()) continue;
        try
        {
            const row = JSON.parse(line);
            if (row && typeof row.key === 'string') map.set(row.key, row);
        }
        catch { /* a torn line from a killed run */ }
    }
    return map;
}

const spentOf = (cache) => [...cache.values()].reduce((a, r) => a + (Number(r.cost) || 0), 0);
const isHold = (v) => v === 'hold' || v === 'done-close' || v === 'prose-ask';

// Per run: right / wrong against the labels (an `unsure` label reads as release, or leaves with `unsure: 'exclude'`);
// an unparsed or missing verdict is a release. Flips: labelled ids whose verdict differs across the runs. AND / OR:
// the judge's majority beside v2's verdict, reported only.
function tally({ rows, labels, runs, v2 = null, unsure = 'release' })
{
    const truth = new Map();
    for (const [id, l] of Object.entries(labels || {}))
    {
        if (l === 'hold' || l === 'release') truth.set(String(id), l);
        else if (l === 'unsure' && unsure === 'release') truth.set(String(id), 'release');
    }
    const at = new Map();
    for (const r of rows) at.set(`${r.run}\u0000${r.id}`, r.verdict);
    const verdict = (run, id) => at.get(`${run}\u0000${id}`);
    const count = (judge) =>
    {
        const c = { n: 0, right: 0, holdsRight: 0, releasesRight: 0, wrongHolds: 0, misses: 0 };
        for (const [id, l] of truth)
        {
            const held = judge(id);
            c.n += 1;
            if (held && l === 'hold') { c.right += 1; c.holdsRight += 1; }
            else if (!held && l === 'release') { c.right += 1; c.releasesRight += 1; }
            else if (held) c.wrongHolds += 1;
            else c.misses += 1;
        }
        return c;
    };
    const perRun = runs.map((run) =>
    {
        const c = count((id) => verdict(run, id) === 'hold');
        c.run = run;
        c.unparsed = [...truth.keys()].filter((id) => { const v = verdict(run, id); return v === undefined || v === 'unparsed'; }).length;
        return c;
    });
    const sorted = perRun.map((r) => r.right).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2) + (sorted.length % 2 === 0 ? 1 : 0)] : 0;
    const min = sorted.length ? sorted[0] : 0;
    let flips = 0;
    for (const id of truth.keys())
    {
        const seen = new Set(runs.map((run) => (verdict(run, id) === 'hold' ? 'hold' : 'release')));
        if (seen.size > 1) flips += 1;
    }
    let and = null;
    let or = null;
    if (v2)
    {
        const majority = (id) => runs.filter((run) => verdict(run, id) === 'hold').length * 2 > runs.length;
        const v2Hold = (id) => isHold(v2[id]);
        and = count((id) => majority(id) && v2Hold(id));
        or = count((id) => majority(id) || v2Hold(id));
    }
    return { perRun, median, min, flips, and, or };
}

// 'median>=132,min>=127,wrongholds<=20,flips<=8'. wrongholds is the worst run's: the bar holds for every run.
function checkBar(t, spec)
{
    const value = {
        median: t.median,
        min: t.min,
        flips: t.flips,
        wrongholds: t.perRun.reduce((a, r) => Math.max(a, r.wrongHolds), 0),
    };
    const failed = [];
    for (const term of String(spec).split(',').map((s) => s.trim()).filter(Boolean))
    {
        const m = /^(median|min|flips|wrongholds)(>=|<=)(\d+)$/.exec(term);
        if (!m) throw new Error(`a bar term reads <median|min|flips|wrongholds><>=|<=><n>: ${term}`);
        const [, name, op, n] = m;
        const v = value[name];
        const ok = op === '>=' ? v >= Number(n) : v <= Number(n);
        if (!ok) failed.push(`${name} ${v} ${op === '>=' ? '<' : '>'} ${n}`);
    }
    return { pass: failed.length === 0, failed };
}

function claudeCommand(args)
{
    const bin = process.env.AB_CLAUDE_BIN || 'claude';
    return /\.js$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
}

function live(opts, prompt, rows)
{
    const auth = authOf(process.env);
    if (auth.error) fail(auth.error);
    const args = claudeArgs(opts.model, auth);
    const run = Number(opts.run);
    const cap = Number(opts.cap);
    const cache = readCache(opts.cache);
    // A fresh empty cwd, and bare mode or an own config dir (authOf), so no project or user hook, plugin or CLAUDE.md
    // joins the call.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-hk22-'));
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    let fresh = 0;
    let cached = 0;
    let unparsed = 0;
    let spentNow = 0;
    let stopped = null;
    try
    {
        for (let i = 0; i < rows.length; i += 1)
        {
            const row = rows[i];
            const stdin = render(prompt, hookInput(row));
            const key = cacheKey(opts.model, run, stdin);
            const hit = cache.get(key);
            if (hit)
            {
                cached += 1;
                if (hit.verdict === 'unparsed') unparsed += 1;
                continue;
            }
            const spent = spentOf(cache);
            if (spent >= cap) { stopped = { spent, left: rows.length - i }; break; }
            const [cmd, argv] = claudeCommand(args);
            const t0 = Date.now();
            const r = rt.spawnCommand(cmd, argv, { cwd, env, input: stdin, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 24 });
            const v = r.status === 0 ? verdictOf(r.stdout || '') : { verdict: 'unparsed', reason: `exit ${r.status}: ${String(r.stderr || r.stdout || '').slice(0, 200)}`, cost: 0 };
            const entry = { key, id: row.id, run, model: opts.model, verdict: v.verdict, reason: v.reason, cost: v.cost || 0, ms: Date.now() - t0 };
            fs.appendFileSync(opts.cache, `${JSON.stringify(entry)}\n`);
            cache.set(key, entry);
            fresh += 1;
            spentNow += entry.cost;
            if (entry.verdict === 'unparsed') unparsed += 1;
            const after = spentOf(cache);
            if (after >= cap && i + 1 < rows.length)
            {
                const left = rows.slice(i + 1).filter((x) => !cache.has(cacheKey(opts.model, run, render(prompt, hookInput(x))))).length;
                if (left) { stopped = { spent: after, left }; break; }
            }
        }
    }
    finally { fs.rmSync(cwd, { recursive: true, force: true }); }
    process.stdout.write(`run ${run}: ${rows.length} rows, ${fresh} new, ${cached} cached, ${unparsed} unparsed, $${spentNow.toFixed(4)}\n`);
    if (stopped)
    {
        process.stdout.write(`cap: $${stopped.spent.toFixed(4)} of $${cap.toFixed(4)} reached - ${stopped.left} rows not run\n`);
        process.exit(3);
    }
}

function score(opts, prompt, rows)
{
    const cache = readCache(opts.cache);
    const runs = opts.runs ? opts.runs.split(',').map((s) => Number(s.trim())) : [1];
    if (runs.some((n) => !Number.isInteger(n) || n < 1)) fail('--runs takes a list of positive whole numbers');
    // Score exactly what this prompt and model produced for these closes: a row of another prompt, model or file never counts.
    const picked = [];
    for (const run of runs)
    {
        for (const row of rows)
        {
            const hit = cache.get(cacheKey(opts.model, run, render(prompt, hookInput(row))));
            if (hit) picked.push({ id: row.id, run, verdict: hit.verdict, cost: hit.cost });
        }
    }
    let labels = null;
    if (opts.labels)
    {
        try { labels = JSON.parse(fs.readFileSync(opts.labels, 'utf8')); }
        catch (err) { fail(`cannot read the labels ${opts.labels}: ${err.message}`); }
    }
    else if (rows.some((r) => r.expected)) labels = Object.fromEntries(rows.filter((r) => r.expected).map((r) => [r.id, r.expected]));
    if (labels)
    {
        const ids = new Set(rows.map((r) => r.id));
        labels = Object.fromEntries(Object.entries(labels).filter(([id]) => ids.has(String(id))));
    }
    let v2 = null;
    if (opts.v2)
    {
        try { v2 = JSON.parse(fs.readFileSync(opts.v2, 'utf8')); }
        catch (err) { fail(`cannot read the v2 verdicts ${opts.v2}: ${err.message}`); }
    }
    const fmt = (c) => `right ${c.right} of ${c.n} | holds right ${c.holdsRight}, releases right ${c.releasesRight}, wrong holds ${c.wrongHolds}, misses ${c.misses}`;
    let t = null;
    if (labels)
    {
        t = tally({ rows: picked, labels, runs, v2, unsure: opts.unsure });
        for (const r of t.perRun) process.stdout.write(`run ${r.run}: ${fmt(r)} | unparsed ${r.unparsed}\n`);
        process.stdout.write(`median ${t.median}, min ${t.min}, flips ${t.flips}\n`);
        if (t.and) process.stdout.write(`AND (judge majority and v2): ${fmt(t.and)}\nOR: ${fmt(t.or)}\n`);
    }
    else
    {
        for (const run of runs)
        {
            const mine = picked.filter((p) => p.run === run);
            const holds = mine.filter((p) => p.verdict === 'hold').length;
            const un = rows.length - mine.filter((p) => p.verdict !== 'unparsed').length;
            process.stdout.write(`run ${run}: ${rows.length} rows | holds ${holds}, releases ${rows.length - holds - un}, unparsed ${un}\n`);
        }
    }
    const spend = picked.reduce((a, p) => a + (Number(p.cost) || 0), 0);
    process.stdout.write(`spend on these rows: $${spend.toFixed(4)}; cache total: $${spentOf(cache).toFixed(4)}\n`);
    if (opts.holdsOut)
    {
        const run = Number(opts.holdsRun);
        const held = new Set(picked.filter((p) => p.run === run && p.verdict === 'hold').map((p) => p.id));
        const out = rows.filter((r) => held.has(r.id)).map((r) => JSON.stringify(r.raw));
        fs.writeFileSync(opts.holdsOut, out.length ? `${out.join('\n')}\n` : '');
        process.stdout.write(`holds written: ${out.length}\n`);
    }
    if (opts.bar)
    {
        if (!t) fail('--bar needs labels (--labels, or an expected field on the rows)');
        let b;
        try { b = checkBar(t, opts.bar); }
        catch (err) { fail(err.message); }
        process.stdout.write(b.pass ? 'bar: PASS\n' : `bar: FAIL (${b.failed.join('; ')})\n`);
    }
}

function main()
{
    const opts = parseArgs(process.argv.slice(2));
    let prompt;
    try { prompt = readPrompt(opts.prompt); }
    catch (err) { fail(err.message); }
    try { claudeArgs(opts.model); }
    catch (err) { fail(err.message); }
    const rows = readCloses(opts.closes);
    if (opts.mode === 'score') return score(opts, prompt, rows);
    if (opts.mode === 'live') return live(opts, prompt, rows);
    const args = claudeArgs(opts.model, authOf(process.env));
    for (const row of rows)
    {
        const stdin = render(prompt, hookInput(row));
        process.stdout.write(`--- row ${row.id}${row.expected ? `, expected ${row.expected}` : ''}: claude ${args.map(quote).join(' ')} < [stdin: ${Buffer.byteLength(stdin)} bytes]\n${stdin}\n`);
    }
    process.stdout.write(`calls: ${rows.length}\n`);
}

// The pinned copy (meta/shared-rules.json 'blocking-stdio'), never the prelude's: loading hook-prelude.js applies the
// project's variables to process.env, and the billed judge's environment must not take them.
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}

if (require.main === module)
{
    blockingStdio();
    main();
}

module.exports = { readPrompt, render, hookInput, authOf, claudeArgs, verdictOf, cacheKey, readCache, tally, checkBar, DEFAULT_PROMPT, DEFAULT_MODEL };
