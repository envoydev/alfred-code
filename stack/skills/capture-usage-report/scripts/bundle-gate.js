#!/usr/bin/env node
// bundle-gate.js - the usage audit's per-bundle gate: run once after EACH bundle closes, it says whether the batch
// runs the next bundle or closes here, and (with --summary) rewrites SUMMARY.md's bundle list from the bundles on disk.
//
//   node <snapshot>/stack/skills/capture-usage-report/scripts/bundle-gate.js --done <n> [--summary <usage-report dir>] [--transcript <file>]
//
// The batch closes at 12 bundles, the bound, OR at the first bundle boundary whose context is past this install's
// fresh-session trigger. The trigger and the context come from the stack's own fresh-session engine
// (`stack/hooks/fresh-session.js` beside this snapshot), so the gate reads what the Stop offer reads: the same window
// table, the same per-tier variables, the same `ctx > trigger`. The live transcript is `--transcript`, else the file
// named by CLAUDE_CODE_SESSION_ID (set in every tool shell) under the account's projects folder.
// Why: a 12-bundle single-turn run on a 1M window crossed the 400k trigger after bundle 4 and ran on to 719.5k - no
// Stop and no compaction came to offer a fresh session, and 48.15M of its 68.6M cache-read sat at or above 400k
// (audit 2026-10-11, session ae38c08f).
//
// --summary: the block between the bundle-gate markers in <dir>/SUMMARY.md is replaced with one row per bundle folder
// that holds a report-usage.md - session, start date (the Environment 'Session window' row), headline verdict (the
// Verdict table's 'worked as intended' cells) and bundle path; a report still carrying FILL IN reads 'in progress'.
// Everything outside the markers is the run's own and is kept; a file with no block gets it appended, and a missing
// file is created holding the block alone. A row per bundle is a mechanism, where 'rewrite it after each bundle' was a reminder the same run
// skipped for 7 bundles (audit 2026-10-11, session ae38c08f).
//
// Prints one BUNDLE-GATE line (and a SUMMARY line with --summary); exit 0, or 2 on a usage error. Node built-ins only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const BOUND = 12;
const BEGIN = '<!-- bundle-gate:bundles begin - rewritten by bundle-gate.js after each bundle; edit outside this block -->';
const END = '<!-- bundle-gate:bundles end -->';
const USAGE = 'usage: bundle-gate.js --done <bundles closed this run> [--summary <usage-report dir>] [--transcript <session.jsonl>]';

function args(argv)
{
    const out = {};
    for (let i = 0; i < argv.length; i++)
    {
        const k = argv[i];
        if (k === '--done' || k === '--summary' || k === '--transcript')
        {
            if (i + 1 >= argv.length) return null;
            out[k.slice(2)] = argv[++i];
        }
        else return null;
    }
    return out;
}

const n = (x) => Number(x).toLocaleString('en-US');

// The live session's transcript: the named file, else CLAUDE_CODE_SESSION_ID's file under any project folder.
function liveTranscript(named)
{
    if (named) return fs.existsSync(named) ? named : null;
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    if (!sid || !/^[A-Za-z0-9-]+$/.test(sid)) return null;
    const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir() || '', '.claude'), 'projects');
    let best = null;
    let dirs = [];
    try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return null; }
    for (const d of dirs)
    {
        const f = path.join(projects, d.name, `${sid}.jsonl`);
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        if (!best || st.mtimeMs > best.at) best = { f, at: st.mtimeMs };
    }
    return best ? best.f : null;
}

function gateLine(done, transcript)
{
    const tail = `${done} of ${BOUND} bundles done`;
    if (done >= BOUND) return `BUNDLE-GATE: CLOSE - ${done} of ${BOUND} bundles, the batch bound - close the run: name every session left and the invocation that resumes it`;
    const boundOnly = (why) => `BUNDLE-GATE: next - ${why}, so only the ${BOUND}-bundle bound applies; ${tail}`;
    if (!transcript) return boundOnly("this session's transcript was not found (no --transcript, no CLAUDE_CODE_SESSION_ID match)");
    let engine;
    try { engine = require(path.join(__dirname, '..', '..', '..', 'hooks', 'fresh-session.js')); }
    catch { return boundOnly('the fresh-session engine was not found (run this script from the snapshot)'); }
    engine.use({ transcript_path: transcript, cwd: process.cwd() });
    const at = engine.ctxThreshold();
    if (at === null) return `BUNDLE-GATE: next - the fresh-session trigger is off in this install; ${tail}`;
    const ctx = engine.contextNow();
    if (!ctx) return boundOnly('context unknown (no usage row since the last compaction)');
    if (ctx > at) return `BUNDLE-GATE: CLOSE - context ${n(ctx)} is past the fresh-session trigger ${n(at)} (${done} bundle(s) done) - close the run here: name every session left and the invocation that resumes it from a fresh session`;
    return `BUNDLE-GATE: next - context ${n(ctx)} of the fresh-session trigger ${n(at)}; ${tail}`;
}

// ---- --summary: the bundle list -----------------------------------------------------------------------------------
const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
// The table rows of one `## <heading>` section, as arrays of cells (header and separator dropped).
function sectionRows(lines, heading)
{
    const at = lines.findIndex((l) => heading.test(l));
    if (at < 0) return [];
    const rows = [];
    for (let i = at + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++)
    {
        if (!/^\s*\|/.test(lines[i])) continue;
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
        rows.push(cells);
    }
    return rows.slice(1);   // the first row is the header
}
function bundleRow(root, sid)
{
    const text = fs.readFileSync(path.join(root, sid, 'report-usage.md'), 'utf8');
    const lines = text.split(/\r?\n/);
    const windowRow = lines.find((l) => /^\|\s*Session window\s*\|/.test(l)) || '';
    const date = (windowRow.match(/\|\s*Session window\s*\|\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '?';
    const open = /FILL IN/.test(text);
    let verdict;
    if (open) verdict = 'in progress - FILL IN sections left';
    else
    {
        const rows = sectionRows(lines, /^##\s+Verdict\b/).filter((r) => r.length >= 2 && r[1]);
        verdict = !rows.length ? 'no verdict table'
            : rows.length === 1 ? rows[0][1]
                : rows.map((r) => `${r[0]}: ${r[1]}`).join('; ');
    }
    return { sid, date, open, line: `| \`${cell(sid)}\` | ${date} | ${cell(verdict)} | \`${cell(sid)}/report-usage.md\` |` };
}
function writeSummary(root)
{
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
    catch { return `SUMMARY: not written - ${root} is not a folder`; }
    const rows = names.filter((s) => fs.existsSync(path.join(root, s, 'report-usage.md'))).map((s) => bundleRow(root, s))
        .sort((a, b) => (a.date === b.date ? (a.sid < b.sid ? -1 : 1) : a.date === '?' ? 1 : b.date === '?' ? -1 : a.date < b.date ? -1 : 1));
    const file = path.join(root, 'SUMMARY.md');
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = '# Usage audit - SUMMARY\n'; }
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const block = [BEGIN, '## Bundles', '', '| session | start | verdict | bundle |', '|---|---|---|---|', ...rows.map((r) => r.line), END].join(eol);
    const b = text.indexOf(BEGIN);
    const e = b < 0 ? -1 : text.indexOf(END, b);
    const next = b >= 0 && e >= 0 ? text.slice(0, b) + block + text.slice(e + END.length)
        : text.replace(/(\r?\n)*$/, '') + eol + eol + block + eol;
    if (next !== text)
    {
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, next);
        fs.renameSync(tmp, file);
    }
    const open = rows.filter((r) => r.open).length;
    return `SUMMARY: ${file} - ${rows.length - open} finished bundle(s), ${open} in progress`;
}

function main()
{
    const a = args(process.argv.slice(2));
    if (!a || a.done === undefined || !/^\d+$/.test(a.done)) { process.stderr.write(USAGE + '\n'); return 2; }
    const out = [gateLine(parseInt(a.done, 10), liveTranscript(a.transcript))];
    if (a.summary !== undefined) out.push(writeSummary(path.resolve(a.summary)));
    process.stdout.write(out.join('\n') + '\n');
    return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { gateLine, writeSummary, liveTranscript, BOUND, BEGIN, END };
