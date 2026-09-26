#!/usr/bin/env node
'use strict';
// skill-comply - is a skill FOLLOWED, step by step, in a real run?
//
// The stack measures hook block rates and tokens, never whether a process skill's own imperative
// steps happen. This grades exactly that. A skill's steps are extracted ONCE into a checked-in
// expectation file (`meta/skill-comply/<skill>/expect.json`, never installed - no plugin entry lists
// `meta/`), each step quoting the sentence it grades, so `check` goes red when that sentence changes
// and the step needs re-extracting. Two modes use it:
//
//   GRADE   a finished transcript (JSONL - a session file or `claude -p --output-format stream-json`
//           output) is read as an ordered trace of tool calls and assistant text blocks, and every
//           step's graders run over it. Offline, deterministic, no model call.
//   REPLAY  a fixture prompt runs through `claude -p` in a temp project with the stack installed, at
//           three prompt strictness levels, and each transcript is graded. Every replay run is a
//           BILLED nested session, so `--dry-run` prints the exact commands and `--live` is the only
//           way to start one - the user's word first.
//
// The three levels (the same fixture task each time):
//   explicit  the prompt names the skill or its steps - the ceiling: does it hold when asked for?
//   plain     the task in the user's words, nothing about the skill - the everyday case the skill's
//             description and rules must catch on their own
//   adverse   the task plus time pressure arguing against the ceremony, never an explicit waiver -
//             does the skill hold its non-waivable steps?
//
// Grader vocabulary. `tool_used` (tool, input_match, min default 1, max), `tool_order` (before/after,
// FIRST occurrence of each), `regex` (target last_message | trace, match contains | not_contains,
// flags) follow `claude plugin eval`'s semantics as read from the Claude Code 2.1.280 bundle: tool
// name equality, `input_match` a RegExp over the JSON-serialized input. A grader that uses only
// those fields pastes into a case.yaml as is. `llm`, `baseline` and `file_exists` are accepted and
// reported SKIP: a model judge is out of scope offline, and a transcript carries no created-files
// list. The rest is this script's own, named `x_*` or marked in the matcher:
//   matcher   'Tool' | {tool?, input_match?, field?, text_match?, text_not_match?} | {any: [...]}
//             | {all: [...]} | {ref: '<name in the file's matchers>'}. `text_match` runs over the
//             input's RAW string values (or one `field`), with the m flag; a string or a list, all
//             must match. No `tool` matches any event. `succeeded: true` (beside any of them) skips
//             a call that FAILED - a rejected Edit, a hook or permission deny, a blocked or invalid
//             call changed nothing and ran nothing. A shell command that ran and exited non-zero did
//             not fail: Claude Code marks it is_error ('Exit code 1'), but a red test run is a run.
//             Left out, a failed call still counts, so a denied commit is still an attempt in order. An MCP tool matches in both spellings - the
//             plugin route's `mcp__plugin_<n>_<n>__<tool>` and the registration route's bare one.
//   @text     each assistant text block is an event named `@text` in the same ordered trace, so a
//             line the skill says must come first ('Size: ...') is ordered like a tool call.
//   x_between some `tool` call lies after the LAST `after` call and before the FIRST `before` call
//             (`after` absent = the start, `before` absent = the end; an `after` never called fails
//             unless `after_optional`).
//   x_quotes_user  the first `match` call's text holds `capture` (group 1), and that group is a
//             verbatim substring of a user turn - the receipt quotes the user, not a paraphrase.
//   x_each    EVERY `tool` call has a `preceded_by` event since the call before it (or the start) and
//             a `followed_by` event before the call after it (or the end); either may be left out,
//             not both, and a `tool` never called fails - one hypothesis, one change, one re-run.
//             A `tool` call that failed is no call of the set (its retry is the same change); a
//             `preceded_by` / `followed_by` event skips failed calls only where its matcher says so.
//
//   node scripts/skill-comply.js check [<skill>...]
//   node scripts/skill-comply.js grade <skill|expect.json> <transcript.jsonl> [--level <l>] [--json]
//   node scripts/skill-comply.js replay --dry-run [--skill a,b] [--level a,b] [--source <dir>] [--out <dir>]
//                                   [--model <m>] [--max-budget-usd <n>] [--claude <bin>]
//   node scripts/skill-comply.js replay --live ...      (billed - never without the user's word)
//   node scripts/skill-comply.js compare <before-out> <after-out> [--skill a,b] [--level a,b]
//
// COMPARE grades both arms' transcripts (<out>/<skill>/<level>/transcript.jsonl) with THIS tree's
// expectation files and applies the A/B ship rule per step: after no worse than before. A step that
// fails on BOTH arms is INCONCLUSIVE, never 'not worse' - a grader blind to what the run did passes
// every comparison by default, and a step graded by nothing offline (only llm / baseline /
// file_exists graders, SKIP) is NOT GRADED - it measured nothing. The rule HOLDS only with no step
// worse, inconclusive, not run or not graded.
//
// The replay installs on the full COPY route, from a clean export: the copied skills are this
// working tree's text byte for byte, where the plugin route would resolve the released marketplace.
// HOME and CLAUDE_CONFIG_DIR are isolated under --out; the billed step runs under that config dir,
// which holds no login until one is given to it. POSIX shells only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const ROOT = path.join(__dirname, '..');
const EXPECT_DIR = path.join(ROOT, 'meta', 'skill-comply');
const LEVELS = ['explicit', 'plain', 'adverse'];
const TEXT = '@text';
const EVAL_TYPES = new Set(['tool_used', 'tool_order', 'regex']);
const SKIP_TYPES = { llm: 'needs a model judge - out of scope offline', baseline: 'needs a model judge - out of scope offline', file_exists: 'needs the run\'s created-files list, which a transcript does not carry' };
const X_TYPES = new Set(['x_between', 'x_quotes_user', 'x_each']);
const SECRETS = ['SENTRY_SLUG', 'SENTRY_ACCESS_TOKEN', 'CONTEXT7_API_KEY'];
// A shell tool's non-zero exit comes back is_error with this head - the command RAN.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const EXIT_STATUS = /^Exit code \d+/;

const COPY_ROUTE = ['ALFRED_CODE_SKILLS_VIA_PLUGIN=false', 'ALFRED_CODE_HOOKS_VIA_PLUGIN=false', 'ALFRED_CODE_MCPS_VIA_PLUGIN=false'];

// --- the transcript -------------------------------------------------------------------------------

// One ordered trace of the MAIN session: tool calls (deduplicated by id - a streamed message can
// repeat a block) and assistant text blocks. A subagent's lines are its own session, not this one.
function parseTranscript(text)
{
    const events = [];
    const users = [];
    const byId = new Map();
    const seenText = new Set();
    let lastMessage = '';
    let result = '';
    let bad = 0;
    for (const line of String(text).split('\n'))
    {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); }
        catch { bad++; continue; }
        if (!o || typeof o !== 'object') { bad++; continue; }
        if (o.isSidechain === true || o.parent_tool_use_id) continue;
        const m = o.message;
        if (o.type === 'assistant' && m && Array.isArray(m.content))
        {
            for (const c of m.content)
            {
                if (!c) continue;
                if (c.type === 'tool_use')
                {
                    if (c.id && byId.has(c.id)) continue;
                    const input = c.input && typeof c.input === 'object' ? c.input : {};
                    const ev = { tool: String(c.name || ''), input, inputText: jsonText(input), isError: false, failed: false };
                    events.push(ev);
                    if (c.id) byId.set(c.id, ev);
                }
                else if (c.type === 'text' && typeof c.text === 'string' && c.text.trim())
                {
                    const key = `${m.id || ''}|${c.text}`;
                    if (seenText.has(key)) continue;
                    seenText.add(key);
                    events.push({ tool: TEXT, input: { text: c.text }, inputText: jsonText({ text: c.text }), isError: false, failed: false });
                    lastMessage = c.text;
                }
            }
        }
        else if (o.type === 'user' && m)
        {
            // A harness-written row (a loaded skill body, a hook injection) is no user turn - the
            // skill's own receipt template must never count as the words it asks the run to quote.
            if (o.isMeta === true) continue;
            if (typeof m.content === 'string') users.push(m.content);
            else if (Array.isArray(m.content)) for (const c of m.content)
            {
                if (c && c.type === 'text' && typeof c.text === 'string') users.push(c.text);
                else if (c && c.type === 'tool_result' && byId.has(c.tool_use_id))
                {
                    const ev = byId.get(c.tool_use_id);
                    ev.isError = c.is_error === true;
                    const body = typeof c.content === 'string' ? c.content : strings(c.content).join('\n');
                    ev.failed = ev.isError && !(SHELL_TOOLS.has(canonical(ev.tool)) && EXIT_STATUS.test(body));
                }
            }
        }
        else if (o.type === 'result' && typeof o.result === 'string') result = o.result;
    }
    return { events, users, lastMessage: lastMessage || result, bad };
}

function jsonText(v)
{
    try { return JSON.stringify(v) ?? ''; }
    catch { return ''; }
}

function strings(v, out = [])
{
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) strings(x, out);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
    return out;
}

// The plugin route spells a server's tools `mcp__plugin_<n>_<n>__<tool>` (one plugin, one server,
// same name); the registration route spells them bare. Both are the same tool to a grader.
const canonical = (name) => String(name).replace(/^mcp__plugin_(.+?)_\1__/, 'mcp__$1__');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// --- matchers and graders -------------------------------------------------------------------------

function resolve(m, refs)
{
    if (typeof m === 'string') return { tool: m };
    if (m && m.ref !== undefined)
    {
        if (!refs || !refs[m.ref]) throw new Error(`matcher ref '${m.ref}' is not defined in the file's matchers`);
        return resolve(refs[m.ref], refs);
    }
    return m || {};
}

function matches(ev, raw, refs)
{
    const m = resolve(raw, refs);
    if (m.succeeded === true && ev.failed) return false;
    if (Array.isArray(m.any)) return m.any.some((x) => matches(ev, x, refs));
    if (Array.isArray(m.all)) return m.all.every((x) => matches(ev, x, refs));
    if (m.tool !== undefined && canonical(ev.tool) !== canonical(m.tool)) return false;
    if (m.input_match !== undefined && !new RegExp(m.input_match).test(ev.inputText)) return false;
    const text = strings(m.field !== undefined ? ev.input[m.field] : ev.input).join('\n');
    for (const p of list(m.text_match)) if (!new RegExp(p, 'm').test(text)) return false;
    for (const p of list(m.text_not_match)) if (new RegExp(p, 'm').test(text)) return false;
    return true;
}

function label(raw, refs)
{
    const m = resolve(raw, refs);
    if (raw && raw.ref !== undefined) return raw.ref;
    if (Array.isArray(m.any)) return `any(${m.any.map((x) => label(x, refs)).join(' | ')})`;
    if (Array.isArray(m.all)) return `all(${m.all.map((x) => label(x, refs)).join(' & ')})`;
    const pat = m.input_match ?? list(m.text_match)[0];
    return `${m.tool || '*'}${pat !== undefined ? ` /${pat}/` : ''}`;
}

const firstIndex = (events, m, refs) => events.findIndex((e) => matches(e, m, refs));
function lastIndex(events, m, refs)
{
    for (let i = events.length - 1; i >= 0; i--) if (matches(events[i], m, refs)) return i;
    return -1;
}

// The inline matcher of a tool_used / x_quotes_user grader: the eval shape (`tool`, `input_match`)
// plus this script's own fields, or a `match` holding any matcher.
function inlineMatcher(g)
{
    if (g.match !== undefined) return g.match;
    const m = {};
    for (const k of ['tool', 'input_match', 'field', 'text_match', 'text_not_match', 'any', 'all', 'ref', 'succeeded']) if (g[k] !== undefined) m[k] = g[k];
    return m;
}

function renderTrace(run)
{
    return run.events.map((e) => (e.tool === TEXT ? `${TEXT} ${e.input.text}` : `${e.tool} ${e.inputText}`)).join('\n');
}

const pass = (ok, explanation) => ({ passed: ok, explanation });
const skip = (explanation) => ({ skipped: true, explanation });

function runGrader(g, run, refs)
{
    const ev = run.events;
    switch (g.type)
    {
        case 'tool_used':
        {
            const m = inlineMatcher(g);
            const n = ev.filter((e) => matches(e, m, refs)).length;
            const min = g.min ?? 1;
            const max = g.max ?? Infinity;
            return pass(n >= min && n <= max, `${label(m, refs)} called ${n}x (expected ${min}..${max === Infinity ? 'inf' : max})`);
        }
        case 'tool_order':
        {
            const b = firstIndex(ev, g.before, refs);
            const a = firstIndex(ev, g.after, refs);
            if (b === -1) return pass(false, `'before' ${label(g.before, refs)} never called`);
            if (a === -1) return pass(false, `'after' ${label(g.after, refs)} never called`);
            return pass(b < a, `${label(g.before, refs)}@${b} ${b < a ? 'precedes' : 'does NOT precede'} ${label(g.after, refs)}@${a}`);
        }
        case 'x_between':
        {
            let lo = -1;
            if (g.after !== undefined)
            {
                lo = lastIndex(ev, g.after, refs);
                if (lo === -1 && !g.after_optional) return pass(false, `'after' ${label(g.after, refs)} never called`);
            }
            let hi = ev.length;
            if (g.before !== undefined)
            {
                hi = firstIndex(ev, g.before, refs);
                if (hi === -1) return pass(false, `'before' ${label(g.before, refs)} never called`);
            }
            const at = ev.map((e, i) => (matches(e, g.tool, refs) ? i : -1)).filter((i) => i !== -1);
            const hit = at.find((i) => i > lo && i < hi);
            const window = `after @${lo}, before @${hi === ev.length ? 'end' : hi}`;
            return hit !== undefined
                ? pass(true, `${label(g.tool, refs)}@${hit} lies ${window}`)
                : pass(false, `no ${label(g.tool, refs)} ${window} (called at ${at.length ? at.map((i) => `@${i}`).join(', ') : 'nowhere'})`);
        }
        case 'x_each':
        {
            const at = ev.map((e, i) => (!e.failed && matches(e, g.tool, refs) ? i : -1)).filter((i) => i !== -1);
            if (!at.length) return pass(false, `${label(g.tool, refs)} never called`);
            const has = (m, lo, hi) => ev.some((e, i) => i > lo && i < hi && matches(e, m, refs));
            const bad = [];
            at.forEach((p, k) =>
            {
                const lo = k === 0 ? -1 : at[k - 1];
                const hi = k === at.length - 1 ? ev.length : at[k + 1];
                if (g.preceded_by !== undefined && !has(g.preceded_by, lo, p)) bad.push(`@${p} has no ${label(g.preceded_by, refs)} since the one before`);
                if (g.followed_by !== undefined && !has(g.followed_by, p, hi)) bad.push(`@${p} has no ${label(g.followed_by, refs)} before the next`);
            });
            return bad.length
                ? pass(false, bad.join('; '))
                : pass(true, `each of ${at.length} ${label(g.tool, refs)} call(s) has its own ${[g.preceded_by, g.followed_by].filter((m) => m !== undefined).map((m) => label(m, refs)).join(' and ')}`);
        }
        case 'x_quotes_user':
        {
            const m = inlineMatcher(g);
            const hit = ev.find((e) => matches(e, m, refs));
            if (!hit) return pass(false, `${label(m, refs)} never called`);
            const got = new RegExp(g.capture, 'm').exec(strings(g.field !== undefined ? hit.input[g.field] : hit.input).join('\n'));
            if (!got || !got[1] || !norm(got[1])) return pass(false, `the call holds no /${g.capture}/ with a non-empty group 1`);
            const quoted = norm(got[1]);
            const found = run.users.some((u) => norm(u).includes(quoted));
            return pass(found, found ? `'${quoted}' is the user's own words` : `'${quoted}' appears in no user turn - a paraphrase, not a quote`);
        }
        case 'regex':
        {
            const target = g.target ?? 'last_message';
            if (target !== 'last_message' && target !== 'trace') return skip(`regex target ${JSON.stringify(target)} needs the run's working tree`);
            const text = target === 'trace' ? renderTrace(run) : run.lastMessage;
            const hit = new RegExp(g.pattern, g.flags || '').test(text);
            const want = (g.match ?? 'contains') === 'contains';
            return pass(hit === want, `/${g.pattern}/ ${hit ? 'found' : 'not found'} in ${target}`);
        }
        default:
            if (SKIP_TYPES[g.type]) return skip(`${g.type}: ${SKIP_TYPES[g.type]}`);
            return pass(false, `unknown grader type '${g.type}'`);
    }
}

function grade(expect, transcriptText, { level } = {})
{
    const run = parseTranscript(transcriptText);
    if (level && expect.prompts && typeof expect.prompts[level] === 'string') run.users.push(expect.prompts[level]);
    const refs = expect.matchers || {};
    const steps = expect.steps.map((s) =>
    {
        const results = s.graders.map((g) =>
        {
            let r;
            try { r = runGrader(g, run, refs); }
            catch (err) { r = pass(false, `grader threw: ${err.message}`); }
            return { name: g.name || g.type, type: g.type, ...r };
        });
        const graded = results.filter((r) => !r.skipped);
        const verdict = graded.length === 0 ? 'SKIP' : graded.every((r) => r.passed) ? 'PASS' : 'FAIL';
        return { id: s.id, verdict, results };
    });
    const graded = steps.filter((s) => s.verdict !== 'SKIP');
    return {
        skill: expect.skill,
        level: level || null,
        events: run.events.length,
        unreadable: run.bad,
        passed: graded.filter((s) => s.verdict === 'PASS').length,
        graded: graded.length,
        skipped: steps.length - graded.length,
        steps,
    };
}

// The A/B ship rule over two arms' grades, keyed '<skill>/<level>' (null = no usable transcript).
// `stepIds` names each skill's steps, so a level NEITHER arm ran still reports every step NOT RUN.
function compareArms(before, after, stepIds = {})
{
    const rows = [];
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])])
    {
        const [skill, level] = key.split('/');
        const b = before[key] || null;
        const a = after[key] || null;
        const ids = (a || b) ? (a || b).steps.map((s) => s.id) : (stepIds[skill] || []);
        for (const step of ids)
        {
            const vb = b ? b.steps.find((s) => s.id === step)?.verdict ?? '-' : '-';
            const va = a ? a.steps.find((s) => s.id === step)?.verdict ?? '-' : '-';
            let outcome;
            if (!b || !a || vb === '-' || va === '-') outcome = 'NOT RUN';
            else if (vb === 'SKIP' || va === 'SKIP') outcome = 'NOT GRADED';
            else if (vb === 'PASS' && va === 'FAIL') outcome = 'WORSE';
            else if (vb === 'FAIL' && va === 'PASS') outcome = 'better';
            else if (vb === 'FAIL') outcome = 'INCONCLUSIVE';
            else outcome = 'same';
            rows.push({ skill, level, step, before: vb, after: va, outcome });
        }
    }
    const count = (o) => rows.filter((r) => r.outcome === o).length;
    const worse = count('WORSE');
    const inconclusive = count('INCONCLUSIVE');
    const notRun = count('NOT RUN');
    const notGraded = count('NOT GRADED');
    const verdict = worse ? 'NOT MET' : inconclusive || notRun || notGraded || !rows.length ? 'NOT PROVEN' : 'HOLDS';
    return { rows, worse, inconclusive, notRun, notGraded, verdict };
}

function formatCompare(c)
{
    const out = c.rows.map((r) => `  ${r.skill} ${r.level} ${r.step}: before ${r.before}, after ${r.after} -> ${r.outcome}`);
    out.push(`ship rule: ${c.verdict} - ${c.worse} worse, ${c.inconclusive} inconclusive, ${c.notRun} not run, ${c.notGraded} not graded`);
    return out.join('\n');
}

// One arm's grades from a replay --out dir; a missing or empty transcript is no grade.
function gradeArm(dir, skills, levels)
{
    const grades = {};
    for (const skill of skills)
    {
        const exp = loadExpectation(skill).data;
        for (const level of levels)
        {
            const f = path.join(dir, skill, level, 'transcript.jsonl');
            let r = null;
            if (fs.existsSync(f)) r = grade(exp, fs.readFileSync(f, 'utf8'), { level });
            grades[`${skill}/${level}`] = r && r.events > 0 ? r : null;
        }
    }
    return grades;
}

function formatGrade(r)
{
    const out = [`skill-comply: ${r.skill}${r.level ? ` (level ${r.level})` : ''} - ${r.passed} of ${r.graded} graded steps followed${r.skipped ? `, ${r.skipped} skipped offline` : ''}`];
    const width = Math.max(...r.steps.map((s) => s.id.length));
    for (const s of r.steps)
    {
        const why = s.results.filter((x) => (s.verdict === 'PASS' ? x.passed : s.verdict === 'SKIP' ? x.skipped : !x.passed && !x.skipped));
        out.push(`  ${s.verdict.padEnd(4)}  ${s.id.padEnd(width)}  ${why.map((x) => x.explanation).join('; ')}`);
    }
    out.push(`trace: ${r.events} event(s), ${r.unreadable} unreadable line(s)`);
    return out.join('\n');
}

// --- expectation files ----------------------------------------------------------------------------

function loadExpectation(nameOrPath)
{
    const file = /\.json$/.test(nameOrPath) ? path.resolve(nameOrPath) : path.join(EXPECT_DIR, nameOrPath, 'expect.json');
    if (!fs.existsSync(file)) throw new Error(`no expectation file at ${file}`);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { throw new Error(`${file}: not valid JSON - ${err.message}`); }
    return { file, dir: path.dirname(file), data };
}

function listSkills()
{
    if (!fs.existsSync(EXPECT_DIR)) return [];
    return fs.readdirSync(EXPECT_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(EXPECT_DIR, d.name, 'expect.json')))
        .map((d) => d.name).sort();
}

function compiles(src, flags, where, problems)
{
    try { new RegExp(src, flags); }
    catch (err) { problems.push(`${where}: /${src}/ does not compile - ${err.message}`); }
}

function checkMatcher(m, refs, where, problems, depth = 0)
{
    if (depth > 8) { problems.push(`${where}: matcher refs nest too deep (a cycle?)`); return; }
    if (typeof m === 'string') return;
    if (!m || typeof m !== 'object') { problems.push(`${where}: a matcher is a tool name or an object`); return; }
    if (m.ref !== undefined)
    {
        if (!refs[m.ref]) problems.push(`${where}: matcher ref '${m.ref}' is not defined`);
        else checkMatcher(refs[m.ref], refs, `${where} -> ${m.ref}`, problems, depth + 1);
        return;
    }
    for (const k of ['any', 'all'])
        if (m[k] !== undefined)
        {
            if (!Array.isArray(m[k]) || !m[k].length) problems.push(`${where}: '${k}' must be a non-empty list`);
            else m[k].forEach((x, i) => checkMatcher(x, refs, `${where}.${k}[${i}]`, problems, depth + 1));
        }
    if (m.succeeded !== undefined && typeof m.succeeded !== 'boolean') problems.push(`${where}: 'succeeded' must be true or false`);
    if (m.input_match !== undefined) compiles(m.input_match, '', where, problems);
    for (const p of [...list(m.text_match), ...list(m.text_not_match)]) compiles(p, 'm', where, problems);
    const keys = ['tool', 'input_match', 'field', 'text_match', 'text_not_match', 'any', 'all'];
    if (!keys.some((k) => m[k] !== undefined)) problems.push(`${where}: an empty matcher matches every event`);
}

// Every problem that makes a file ungradeable or stale. The quote check is the drift gate: a step
// graded against a sentence the skill no longer says is grading the old skill.
function checkExpectation(exp)
{
    const { data: e, dir } = exp;
    const problems = [];
    const where = path.relative(ROOT, exp.file);
    if (e.schema_version !== 1) problems.push(`${where}: schema_version must be 1`);
    if (typeof e.skill !== 'string' || !e.skill) problems.push(`${where}: skill is required`);
    const sources = Array.isArray(e.sources) ? e.sources : [];
    if (!sources.length) problems.push(`${where}: sources must name the files the steps were extracted from`);
    const text = {};
    for (const s of sources)
    {
        const f = path.join(ROOT, s);
        if (!fs.existsSync(f)) problems.push(`${where}: source ${s} does not exist`);
        else text[s] = norm(fs.readFileSync(f, 'utf8'));
    }
    for (const l of LEVELS)
        if (!e.prompts || typeof e.prompts[l] !== 'string' || !e.prompts[l].trim()) problems.push(`${where}: prompts.${l} is required`);
    const run = e.run || {};
    if (!Number.isInteger(run.max_turns) || run.max_turns < 1 || run.max_turns > 200) problems.push(`${where}: run.max_turns must be an integer 1..200`);
    if (!Array.isArray(run.allowed_tools) || !run.allowed_tools.length) problems.push(`${where}: run.allowed_tools must be a non-empty list`);
    let recs = {};
    try { recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8')); }
    catch { problems.push(`${where}: meta/recommendations.json could not be read to check run.stacks`); }
    if (!Array.isArray(run.stacks) || !run.stacks.length) problems.push(`${where}: run.stacks must name the stack an init walk would detect for the fixture`);
    else for (const s of run.stacks) if (!(recs.stacks && recs.stacks[s])) problems.push(`${where}: run.stacks '${s}' is not a stack in meta/recommendations.json`);
    if (!run.selection || typeof run.selection !== 'object') problems.push(`${where}: run.selection is required (the stack-select.js input)`);
    else
    {
        let graph = null;
        try { graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-graph.json'), 'utf8')); }
        catch { problems.push(`${where}: meta/stack-graph.json could not be read to check the selection`); }
        for (const [cat, key] of [['skills', 'skills'], ['rules', 'rules'], ['agents', 'agents']])
            for (const n of list(run.selection[cat]))
                if (graph && !(graph[key] && graph[key][n])) problems.push(`${where}: selection ${cat} '${n}' is not in this release`);
    }
    if (!fs.existsSync(path.join(dir, 'scaffold.sh'))) problems.push(`${where}: scaffold.sh is missing beside it`);
    const refs = e.matchers || {};
    for (const [name, m] of Object.entries(refs)) checkMatcher(m, refs, `${where} matchers.${name}`, problems);
    const steps = Array.isArray(e.steps) ? e.steps : [];
    if (!steps.length) problems.push(`${where}: steps must be a non-empty list`);
    const ids = new Set();
    for (const s of steps)
    {
        const at = `${where} step ${s.id || '?'}`;
        if (!s.id || ids.has(s.id)) problems.push(`${at}: every step needs a unique id`);
        ids.add(s.id);
        if (!sources.includes(s.from)) problems.push(`${at}: from must be one of sources`);
        else if (text[s.from] !== undefined && (!s.quote || !text[s.from].includes(norm(s.quote))))
            problems.push(`${at}: its quote is no longer in ${s.from} - the skill changed, re-extract this step`);
        if (!Array.isArray(s.graders) || !s.graders.length) { problems.push(`${at}: graders must be a non-empty list`); continue; }
        s.graders.forEach((g, i) =>
        {
            const gw = `${at} grader ${i}`;
            if (!EVAL_TYPES.has(g.type) && !X_TYPES.has(g.type) && !SKIP_TYPES[g.type]) { problems.push(`${gw}: unknown type '${g.type}'`); return; }
            if (g.type === 'tool_used' || g.type === 'x_quotes_user') checkMatcher(inlineMatcher(g), refs, gw, problems);
            if (g.type === 'tool_order') { checkMatcher(g.before, refs, `${gw}.before`, problems); checkMatcher(g.after, refs, `${gw}.after`, problems); }
            if (g.type === 'x_between')
            {
                checkMatcher(g.tool, refs, `${gw}.tool`, problems);
                if (g.after !== undefined) checkMatcher(g.after, refs, `${gw}.after`, problems);
                if (g.before !== undefined) checkMatcher(g.before, refs, `${gw}.before`, problems);
            }
            if (g.type === 'x_each')
            {
                checkMatcher(g.tool, refs, `${gw}.tool`, problems);
                if (g.preceded_by === undefined && g.followed_by === undefined) problems.push(`${gw}: x_each needs preceded_by or followed_by`);
                if (g.preceded_by !== undefined) checkMatcher(g.preceded_by, refs, `${gw}.preceded_by`, problems);
                if (g.followed_by !== undefined) checkMatcher(g.followed_by, refs, `${gw}.followed_by`, problems);
            }
            if (g.type === 'x_quotes_user') compiles(g.capture || '', 'm', gw, problems);
            if (g.type === 'regex')
            {
                compiles(g.pattern || '', g.flags || '', gw, problems);
                if (!['contains', 'not_contains', undefined].includes(g.match)) problems.push(`${gw}: match ${JSON.stringify(g.match)} is not supported offline (contains | not_contains)`);
            }
        });
    }
    return problems;
}

// --- replay ---------------------------------------------------------------------------------------

const q = (s) => (/^[A-Za-z0-9_/.,:=@%+-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`);

function stackEnvKeys()
{
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'environment.json'), 'utf8')).env.map((r) => r.key); }
    catch { return []; }
}

// What an init walk would install for the fixture: the locked always-on set, the fixture's stack
// seeds, and whatever the flow names beyond them. Grading a skill in a project WITHOUT its baseline
// rules and servers would grade a stack no user runs. The seeds are the INSTALLED release's own
// (`root` - a handed --source), so an A/B arm on another release gets that release's walk, never
// this tree's.
function replaySelection(e, root = ROOT)
{
    const recs = JSON.parse(fs.readFileSync(path.join(root, 'meta', 'recommendations.json'), 'utf8'));
    const parts = [recs.always || {}, ...list(e.run.stacks).map((s) => (recs.stacks || {})[s] || {}), e.run.selection || {}];
    const out = {};
    for (const p of parts)
        for (const [k, v] of Object.entries(p))
            if (Array.isArray(v)) out[k] = [...new Set([...(out[k] || []), ...v])];
    return out;
}

// The whole replay as an ordered list of shell commands - the one list both --dry-run prints and
// --live runs, so what the user approves is what executes. `billed` marks the nested sessions and
// `grade` the reads that need their transcripts.
function replayPlan({ skills, levels, source, out, model, budget = 2, claude = 'claude' })
{
    const cmds = [];
    const add = (cmd, kind = 'prep', note) => cmds.push({ cmd, kind, note });
    const src = source ? path.resolve(source) : path.join(out, 'src');
    const home = path.join(out, 'home');
    const config = path.join(out, 'config');
    if (!source) add(`node ${q(path.join(ROOT, 'scripts', 'clean-export.js'))} ${q(ROOT)} ${q(src)}`, 'prep', 'one source snapshot for every run');
    add(`mkdir -p ${q(home)} ${q(config)}`);
    const clean = `env -i PATH="$PATH" TMPDIR="\${TMPDIR:-/tmp}" HOME=${q(home)} CLAUDE_CONFIG_DIR=${q(config)}`;
    const unset = [...SECRETS, ...stackEnvKeys()].map((k) => `-u ${k}`).join(' ');
    for (const skill of skills)
    {
        const { data: e, dir } = loadExpectation(skill);
        const sdir = path.join(out, skill);
        const selJson = path.join(sdir, 'selection.json');
        const selTxt = path.join(sdir, 'selection.txt');
        add(`mkdir -p ${q(sdir)}`, 'prep', `--- ${skill}`);
        add(`printf '%s\\n' ${q(JSON.stringify(replaySelection(e, source ? src : ROOT)))} > ${q(selJson)}`);
        add(`node ${q(path.join(src, 'scripts', 'stack-select.js'))} --selection ${q(selJson)} --emit ${q(selTxt)}`);
        // The copy route registers MCP servers bare, so the allowed list names them that way.
        const tools = e.run.allowed_tools.map(canonical).join(',');
        for (const level of levels)
        {
            const ldir = path.join(sdir, level);
            const proj = path.join(ldir, 'project');
            const transcript = path.join(ldir, 'transcript.jsonl');
            // No background maintenance: the scaffold's commit is past git's loose-objects threshold, and a
            // detached repack still writing into .git/objects outlives the run and breaks its removal.
            add(`mkdir -p ${q(proj)} && git -C ${q(proj)} init -q && git -C ${q(proj)} config maintenance.auto false`, 'prep', `${skill} / ${level}`);
            add(`(cd ${q(proj)} && ${clean} ${COPY_ROUTE.join(' ')} node ${q(path.join(src, 'scripts', 'install', 'alfred-code.js'))} install --source ${q(src)} --selection ${q(selTxt)} --memory-level project)`);
            add(`(cd ${q(proj)} && ${clean} bash ${q(path.join(dir, 'scaffold.sh'))})`);
            const flags = ['-p', '--output-format stream-json', '--verbose', `--max-turns ${e.run.max_turns}`, '--permission-mode dontAsk',
                '--setting-sources user,project,local', `--allowed-tools=${q(tools)}`, `--max-budget-usd ${budget}`];
            if (model) flags.push(`--model=${q(model)}`);
            add(`(cd ${q(proj)} && printf '%s' ${q(e.prompts[level])} | env ${unset} HOME=${q(home)} CLAUDE_CONFIG_DIR=${q(config)} ${q(claude)} ${flags.join(' ')} > ${q(transcript)})`, 'billed');
            add(`node ${q(__filename)} grade ${q(skill)} ${q(transcript)} --level ${level}`, 'grade');
        }
    }
    return cmds;
}

function formatPlan(cmds, { skills, levels, budget })
{
    const billed = cmds.filter((c) => c.kind === 'billed').length;
    const out = ['#!/bin/bash',
        `# skill-comply replay: ${skills.length} skill(s) x ${levels.length} level(s) = ${billed} billed nested session(s), each capped at --max-budget-usd ${budget}.`,
        '# The billed steps run under the isolated CLAUDE_CONFIG_DIR below, which holds no login until you give it one.',
        'set -e'];
    for (const c of cmds)
    {
        if (c.note) out.push(`# ${c.note}`);
        if (c.kind === 'billed') out.push('# billed: one nested model session');
        if (c.kind === 'grade') out.push('# grade: reads the transcript the billed step wrote');
        out.push(c.cmd);
    }
    return out.join('\n') + '\n';
}

function runLive(cmds, { timeoutMs = 900000 } = {})
{
    if (process.platform === 'win32') throw new Error('replay --live needs a POSIX shell');
    for (const c of cmds)
    {
        process.stderr.write(`skill-comply: ${c.kind}: ${c.cmd.slice(0, 160)}${c.cmd.length > 160 ? ' ...' : ''}\n`);
        const r = rt.spawnCommand('bash', ['-c', c.cmd], { stdio: 'inherit', timeout: c.kind === 'billed' ? timeoutMs : 600000 });
        const failed = r.status !== 0 || r.error;
        if (failed && c.kind === 'prep') throw new Error(`a preparation step failed (exit ${r.status ?? r.error.code}) - nothing after it ran`);
        if (failed) process.stderr.write(`skill-comply: ${c.kind} step exited ${r.status ?? r.error.code} - recorded, continuing\n`);
    }
}

// --- CLI ------------------------------------------------------------------------------------------

function parseFlags(argv)
{
    const flags = {};
    const pos = [];
    const valued = new Set(['--level', '--skill', '--source', '--out', '--model', '--max-budget-usd', '--claude']);
    const bare = new Set(['--json', '--dry-run', '--live']);
    for (let i = 0; i < argv.length; i++)
    {
        const a = argv[i];
        if (valued.has(a))
        {
            if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
            flags[a.slice(2)] = argv[++i];
        }
        else if (bare.has(a)) flags[a.slice(2)] = true;
        else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
        else pos.push(a);
    }
    return { flags, pos };
}

const USAGE = `usage:
  skill-comply.js check [<skill>...]
  skill-comply.js grade <skill|expect.json> <transcript.jsonl> [--level explicit|plain|adverse] [--json]
  skill-comply.js replay --dry-run [--skill a,b] [--level a,b] [--source <dir>] [--out <dir>] [--model <m>] [--max-budget-usd <n>] [--claude <bin>]
  skill-comply.js replay --live    (same flags - starts billed nested sessions)
  skill-comply.js compare <before-out> <after-out> [--skill a,b] [--level a,b]`;

function main(argv)
{
    const [mode, ...rest] = argv;
    let parsed;
    try { parsed = parseFlags(rest); }
    catch (err) { console.error(`skill-comply: ${err.message}\n${USAGE}`); return 2; }
    const { flags, pos } = parsed;

    if (mode === 'check')
    {
        const skills = pos.length ? pos : listSkills();
        if (!skills.length) { console.error('skill-comply: no expectation files under meta/skill-comply/'); return 1; }
        let bad = 0;
        for (const s of skills)
        {
            let problems;
            try { problems = checkExpectation(loadExpectation(s)); }
            catch (err) { problems = [err.message]; }
            bad += problems.length;
            console.log(problems.length ? problems.map((p) => `FAIL ${p}`).join('\n') : `ok   ${s}`);
        }
        return bad ? 1 : 0;
    }

    if (mode === 'grade')
    {
        if (pos.length !== 2) { console.error(USAGE); return 2; }
        if (flags.level !== undefined && !LEVELS.includes(flags.level)) { console.error(`skill-comply: --level must be one of ${LEVELS.join(', ')}`); return 2; }
        let exp;
        let text;
        try
        {
            exp = loadExpectation(pos[0]);
            text = fs.readFileSync(pos[1], 'utf8');
        }
        catch (err) { console.error(`skill-comply: ${err.code === 'ENOENT' ? `cannot read ${pos[1]}` : err.message}`); return 1; }
        const problems = checkExpectation(exp);
        if (problems.length) { console.error(problems.map((p) => `skill-comply: ${p}`).join('\n')); return 1; }
        const r = grade(exp.data, text, { level: flags.level });
        if (r.events === 0) { console.error(`skill-comply: ${pos[1]} holds no tool call or assistant text (${r.unreadable} unreadable line(s)) - a failed or empty run, not a grade`); return 1; }
        console.log(flags.json ? JSON.stringify(r, null, 2) : formatGrade(r));
        return 0;
    }

    if (mode === 'compare')
    {
        if (pos.length !== 2) { console.error(USAGE); return 2; }
        const skills = flags.skill ? String(flags.skill).split(',').filter(Boolean) : listSkills();
        const levels = flags.level ? String(flags.level).split(',').filter(Boolean) : LEVELS;
        const unknownLevel = levels.find((l) => !LEVELS.includes(l));
        if (unknownLevel) { console.error(`skill-comply: unknown level '${unknownLevel}' (${LEVELS.join(', ')})`); return 2; }
        let c;
        try
        {
            const stepIds = Object.fromEntries(skills.map((s) => [s, loadExpectation(s).data.steps.map((x) => x.id)]));
            c = compareArms(gradeArm(pos[0], skills, levels), gradeArm(pos[1], skills, levels), stepIds);
        }
        catch (err) { console.error(`skill-comply: ${err.message}`); return 1; }
        console.log(formatCompare(c));
        return c.verdict === 'HOLDS' ? 0 : 1;
    }

    if (mode === 'replay')
    {
        if (!flags['dry-run'] && !flags.live)
        {
            console.error('skill-comply: a replay starts billed nested sessions - pass --dry-run to print the commands, --live to run them (only on the user\'s word)');
            return 2;
        }
        const skills = flags.skill ? String(flags.skill).split(',').filter(Boolean) : listSkills();
        const levels = flags.level ? String(flags.level).split(',').filter(Boolean) : LEVELS;
        const unknownLevel = levels.find((l) => !LEVELS.includes(l));
        if (unknownLevel) { console.error(`skill-comply: unknown level '${unknownLevel}' (${LEVELS.join(', ')})`); return 2; }
        const budget = flags['max-budget-usd'] ?? '2';
        if (!/^\d+(\.\d+)?$/.test(String(budget)) || Number(budget) <= 0) { console.error('skill-comply: --max-budget-usd must be a positive number'); return 2; }
        const out = path.resolve(flags.out || path.join(os.tmpdir(), `skill-comply-${new Date().toISOString().replace(/[:.]/g, '-')}`));
        let cmds;
        try
        {
            for (const s of skills)
            {
                const problems = checkExpectation(loadExpectation(s));
                if (problems.length) throw new Error(problems.join('\n'));
            }
            if (flags.source && !fs.existsSync(path.join(flags.source, 'scripts', 'install', 'alfred-code.js')))
                throw new Error(`--source ${flags.source} is not a stack source (no scripts/install/alfred-code.js)`);
            cmds = replayPlan({ skills, levels, source: flags.source, out, model: flags.model, budget, claude: flags.claude || 'claude' });
        }
        catch (err) { console.error(`skill-comply: ${err.message}`); return 1; }
        if (flags['dry-run'])
        {
            process.stdout.write(formatPlan(cmds, { skills, levels, budget }));
            return 0;
        }
        try { runLive(cmds); }
        catch (err) { console.error(`skill-comply: ${err.message}`); return 1; }
        return 0;
    }

    console.error(USAGE);
    return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parseTranscript, grade, formatGrade, compareArms, formatCompare, checkExpectation, loadExpectation, listSkills, replayPlan, formatPlan, canonical, matches, main, LEVELS, EXPECT_DIR };
