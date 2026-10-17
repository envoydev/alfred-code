#!/usr/bin/env node
// transcript-view.js - the usage audit's one reader of a session transcript, so a bundle's author reads rows instead of
// writing a helper script for each question. One transcript row is one JSONL line and can carry a 50k-token tool result,
// so every view is bounded and numbered by LINE (`L<n>`, 1-based - the locator `analyze-usage.js --check-report` resolves).
//
//   node transcript-view.js pack <transcript> <usage.json> [--out <file>] [--max <chars>]
//   node transcript-view.js timeline <transcript> [--from <L>] [--to <L>]
//   node transcript-view.js show <transcript> <L>[,<L>|<a>-<b>...] [--chars <n>]
//   node transcript-view.js grep <transcript> <regex> [--role user|assistant|result]
//
// pack: the evidence a report's judgment sections cite, gathered in one call - the typed prompts, every ask with its
// answer, the skill and command runs, the errored tool results (the session's and its seats', from `subagents/` beside
// the transcript), and, for each moment the analyzer's --json flagged (context spikes, cache misses, green claims with no
// check, unchecked commits, compaction re-reads, the largest tool results), that row and the three before it.
// Why: the 2026-10-17 usage audit's 69 bundle authors spent 44% of their calls (about 1,900) digging rows out by hand,
// each through a script of its own (a timeline, an ask list, an error list, a grep of the assistant text), and every
// call re-sent the author's whole context.
//
// Prints to stdout (or --out); exit 0, or 2 on a usage error or an unreadable transcript. Node built-ins only.
'use strict';
const fs = require('fs');
const path = require('path');

const USAGE = 'usage: transcript-view.js pack <transcript> <usage.json> [--out <file>] [--max <chars>]\n'
  + '       transcript-view.js timeline <transcript> [--from <L>] [--to <L>]\n'
  + '       transcript-view.js show <transcript> <L>[,<L>|<a>-<b>...] [--chars <n>]\n'
  + '       transcript-view.js grep <transcript> <regex> [--role user|assistant|result]\n';

function fail(msg) { process.stderr.write(`${msg}\n${USAGE}`); process.exit(2); }
function opt(args, name, dflt) { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; }

// Every row, its 1-based line number kept; a line that is no JSON (a torn tail) is skipped, never fatal.
function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail(`transcript-view: cannot read ${file} (${e.code || e.message})`); }
  const rows = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) return;
    try { const o = JSON.parse(l); if (o && typeof o === 'object') rows.push({ L: i + 1, o }); } catch { /* torn line */ }
  });
  return rows;
}

const oneLine = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}...` : t; };
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? `${t.slice(0, n)}\n... [${t.length - n} more chars]` : t; };
const hms = (ts) => (typeof ts === 'string' && ts.length >= 19 ? ts.slice(11, 19) : '--:--:--');
const blocks = (o) => { const c = o && o.message && o.message.content; return Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []; };
const resultText = (b) => (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x && x.type === 'text' ? x.text : x && x.type ? `[${x.type}]` : '')).join('\n') : '');
const HARNESS = /^\s*(?:<system-reminder>|<task-notification>|<local-command-|<command-message>|Stop hook feedback:|Caveat: )/;

// A row the user TYPED: a user row whose text is not a tool result and not text the harness wrote.
function typedText(o) {
  if (!o || o.type !== 'user' || o.isMeta) return null;
  const c = o.message && o.message.content;
  if (typeof c === 'string') return HARNESS.test(c) && !/<command-name>/.test(c) ? null : c;
  if (!Array.isArray(c) || c.some((b) => b && b.type === 'tool_result')) return null;
  const t = c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  return t && (!HARNESS.test(t) || /<command-name>/.test(t)) ? t : null;
}
// What a tool call names, in one phrase: its command, path, pattern, skill, question or brief.
function inputHead(name, input) {
  const i = input || {};
  if (name === 'AskUserQuestion') return (i.questions || []).map((q) => q && q.question).filter(Boolean).join(' | ');
  if (name === 'Skill') return `${i.skill || ''} ${i.args || ''}`;
  if (name === 'Agent' || name === 'Task') return `${i.subagent_type || 'general-purpose'}${i.model ? ` (${i.model})` : ''}: ${i.description || ''}`;
  return i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || JSON.stringify(i);
}
// One line per row - the timeline's shape and the pack's.
function summary(r) {
  const o = r.o;
  const head = `L${r.L} ${hms(o.timestamp)}`;
  if (o.type === 'assistant') {
    const parts = blocks(o).map((b) => (b.type === 'text' ? `text: ${oneLine(b.text, 160)}`
      : b.type === 'tool_use' ? `${b.name}: ${oneLine(inputHead(b.name, b.input), 160)}` : null)).filter(Boolean);
    const u = o.message && o.message.usage;
    const ctx = u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0;
    return parts.length ? `${head} assistant${ctx ? ` [ctx ${Math.round(ctx / 1000)}k]` : ''} ${parts.join(' / ')}` : null;
  }
  if (o.type === 'user') {
    const typed = typedText(o);
    if (typed != null) return `${head} USER: ${oneLine(typed, 200)}`;
    const res = blocks(o).filter((b) => b && b.type === 'tool_result');
    if (res.length) return `${head} result${res.some((b) => b.is_error) ? ' ERROR' : ''}: ${res.map((b) => `${resultText(b).length} chars ${oneLine(resultText(b), 100)}`).join(' / ')}`;
    return null;
  }
  if (o.type === 'system' && o.subtype) return `${head} system ${o.subtype}${o.content ? `: ${oneLine(o.content, 120)}` : ''}`;
  return null;
}

function timeline(rows, from, to) {
  return rows.filter((r) => r.L >= from && r.L <= to).map(summary).filter(Boolean).join('\n');
}

function show(rows, spec, chars) {
  const want = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^L?(\d+)(?:-L?(\d+))?$/);
    if (!m) fail(`transcript-view: bad line spec '${part}'`);
    const a = +m[1]; const b = m[2] ? +m[2] : a;
    for (let n = a; n <= Math.min(b, a + 200); n++) want.add(n);
  }
  const out = [];
  for (const r of rows) {
    if (!want.has(r.L)) continue;
    const o = r.o;
    const body = [];
    for (const b of blocks(o)) {
      if (b.type === 'text') body.push(b.text);
      else if (b.type === 'tool_use') body.push(`[tool_use ${b.name} ${b.id || ''}] ${JSON.stringify(b.input || {})}`);
      else if (b.type === 'tool_result') body.push(`[tool_result ${b.tool_use_id || ''}${b.is_error ? ' ERROR' : ''}] ${resultText(b)}`);
      else if (b.type === 'thinking') body.push('[thinking]');
    }
    if (!body.length && o.type === 'system') body.push(String(o.content || o.subtype || ''));
    out.push(`== L${r.L} ${o.type} ${o.timestamp || ''}\n${clip(body.join('\n'), chars)}`);
  }
  return out.join('\n\n') || `no row at ${spec}`;
}

function grep(rows, pattern, role) {
  let re;
  try { re = new RegExp(pattern, 'i'); } catch (e) { fail(`transcript-view: bad regex (${e.message})`); }
  const out = [];
  for (const r of rows) {
    const o = r.o;
    const texts = [];
    if (o.type === 'assistant' && (!role || role === 'assistant')) for (const b of blocks(o)) { if (b.type === 'text') texts.push(['assistant', b.text]); else if (b.type === 'tool_use') texts.push([`assistant ${b.name}`, JSON.stringify(b.input || {})]); }
    if (o.type === 'user') {
      const typed = typedText(o);
      if (typed != null && (!role || role === 'user')) texts.push(['USER', typed]);
      if (!role || role === 'result') for (const b of blocks(o)) if (b.type === 'tool_result') texts.push([`result${b.is_error ? ' ERROR' : ''}`, resultText(b)]);
    }
    for (const [who, t] of texts) {
      const m = re.exec(t);
      if (!m) continue;
      const at = Math.max(0, m.index - 100);
      out.push(`L${r.L} ${hms(o.timestamp)} ${who}: ${at ? '...' : ''}${oneLine(t.slice(at, m.index + m[0].length + 100), 260)}`);
      if (out.length >= 200) { out.push('... (first 200 matches)'); return out.join('\n'); }
    }
  }
  return out.join('\n') || 'no match';
}

// The analyzer's flagged moments: one { kind, ts, detail } per timestamp its --json names.
function flagged(usage) {
  const m = (usage && usage.main) || {};
  const e = m.efficiency || {};
  const out = [];
  const add = (kind, ts, detail) => { if (typeof ts === 'string' && ts) out.push({ kind, ts, detail: detail || '' }); };
  for (const s of m.spikes || []) add('context spike', s.ts, `+${s.delta} to ${s.ctx}${s.causes ? ` - ${s.causes}` : ''}`);
  for (const c of e.cacheMissAt || []) add('cache miss', c && c.ts, c && `re-cached ${c.recached}`);
  for (const t of e.unverifiedGreenClaims || []) add('green claim with no check', typeof t === 'string' ? t : t && t.ts);
  for (const t of e.commitsUnchecked || []) add('commit with no check', typeof t === 'string' ? t : t && t.ts);
  for (const c of e.compactionRereads || []) add('compaction re-read', c && c.ts, c && `${c.files} files, ${c.chars} chars`);
  for (const t of (m.topResults || []).slice(0, 5)) add('large tool result', t && t.ts, t && `${t.name} ${t.label || ''} ${t.chars} chars${t.error ? ' ERROR' : ''}`);
  return out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

function pack(file, rows, usage, max) {
  const parts = [`# Evidence pack - ${path.basename(file)} (${rows.length} rows)`, '',
    'Every line is `L<n> <time>` - the locator a report row cites. `show <transcript> <L>` prints a row whole (bounded).', ''];
  const typed = rows.filter((r) => typedText(r.o) != null);
  parts.push(`## Typed prompts (${typed.length})`, ...typed.map((r) => `L${r.L} ${hms(r.o.timestamp)} ${oneLine(typedText(r.o), 300)}`), '');
  // asks and their answers, joined by the tool call id
  const answers = new Map();
  for (const r of rows) for (const b of blocks(r.o)) if (b.type === 'tool_result' && b.tool_use_id) answers.set(b.tool_use_id, { L: r.L, text: resultText(b), err: b.is_error });
  const asks = [];
  const runs = [];
  for (const r of rows) {
    for (const b of blocks(r.o)) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'AskUserQuestion') {
        const a = answers.get(b.id);
        const qs = ((b.input || {}).questions || []).map((q) => `${q.question} [${(q.options || []).map((x) => x && x.label).join(' | ')}]`).join(' / ');
        asks.push(`L${r.L} ${hms(r.o.timestamp)} ASK ${oneLine(qs, 400)}\n  -> ${a ? `L${a.L}${a.err ? ' ERROR' : ''} ${oneLine(a.text, 300)}` : 'no answer in the transcript'}`);
      }
      if (b.name === 'Skill' || b.name === 'Agent' || b.name === 'Task') runs.push(`L${r.L} ${hms(r.o.timestamp)} ${b.name} ${oneLine(inputHead(b.name, b.input), 200)}`);
    }
    const t = typedText(r.o);
    const cmd = t && t.match(/<command-name>([^<]+)<\/command-name>/);
    if (cmd) runs.push(`L${r.L} ${hms(r.o.timestamp)} command ${cmd[1]}`);
  }
  parts.push(`## Asks and answers (${asks.length})`, ...asks, '', `## Skill, command and dispatch runs (${runs.length})`, ...runs, '');
  // errored tool results, the session's and each seat's
  const errs = [];
  const errorsOf = (rs, who) => {
    const names = new Map();
    for (const r of rs) for (const b of blocks(r.o)) if (b.type === 'tool_use') names.set(b.id, b.name);
    for (const r of rs) for (const b of blocks(r.o)) if (b.type === 'tool_result' && b.is_error) errs.push(`${who}L${r.L} ${hms(r.o.timestamp)} ${names.get(b.tool_use_id) || 'tool'}: ${oneLine(resultText(b), 240)}`);
  };
  errorsOf(rows, '');
  const subDir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents');
  let seats = [];
  try { seats = fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).sort(); } catch { /* no seats */ }
  for (const f of seats) errorsOf(load(path.join(subDir, f)), `${f.replace(/\.jsonl$/, '')} `);
  parts.push(`## Errored tool results (${errs.length}${seats.length ? `, ${seats.length} seat transcript(s) read` : ''})`, ...errs, '');
  // the analyzer's flagged moments, each with the rows that led to it
  const moments = usage ? flagged(usage) : [];
  parts.push(`## Flagged moments (${moments.length}, from the analyzer's --json)`);
  for (const f of moments) {
    let at = -1;
    for (let i = 0; i < rows.length; i++) { const ts = rows[i].o.timestamp; if (typeof ts === 'string' && ts <= f.ts) at = i; else if (typeof ts === 'string' && ts > f.ts) break; }
    parts.push(`### ${f.kind} @ ${hms(f.ts)}${f.detail ? ` - ${f.detail}` : ''}`);
    if (at < 0) { parts.push('(no row at or before this time)'); continue; }
    const lines = [];
    for (let i = at; i >= 0 && lines.length < 4; i--) { const s = summary(rows[i]); if (s) lines.unshift(s); }
    parts.push(...lines);
  }
  let text = parts.join('\n') + '\n';
  if (text.length > max) text = `${text.slice(0, max)}\n... [pack cut at ${max} chars - ${text.length - max} more; narrow with timeline / grep]\n`;
  return text;
}

function main(argv) {
  const [cmd, file, ...rest] = argv;
  if (!cmd || !file || cmd === '--help' || cmd === '-h') fail('transcript-view: a command and a transcript are required');
  const rows = load(file);
  let out;
  if (cmd === 'pack') {
    const usageFile = rest[0] && !rest[0].startsWith('--') ? rest[0] : null;
    let usage = null;
    if (usageFile) { try { usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch (e) { fail(`transcript-view: cannot read ${usageFile} as JSON (${e.code || e.message})`); } }
    out = pack(file, rows, usage, Math.max(1000, +opt(rest, '--max', 60000) || 60000));
    const dest = opt(rest, '--out', null);
    if (dest) { fs.writeFileSync(dest, out); out = `transcript-view: wrote ${dest} (${out.length} chars)\n`; }
  } else if (cmd === 'timeline') {
    out = timeline(rows, +opt(rest, '--from', 1) || 1, +opt(rest, '--to', Infinity) || Infinity) + '\n';
  } else if (cmd === 'show') {
    if (!rest[0]) fail('transcript-view: show needs a line spec');
    out = show(rows, rest[0], Math.max(100, +opt(rest, '--chars', 2000) || 2000)) + '\n';
  } else if (cmd === 'grep') {
    if (!rest[0]) fail('transcript-view: grep needs a regex');
    const role = opt(rest, '--role', null);
    if (role && !/^(user|assistant|result)$/.test(role)) fail(`transcript-view: bad --role '${role}'`);
    out = grep(rows, rest[0], role) + '\n';
  } else fail(`transcript-view: unknown command '${cmd}'`);
  process.stdout.write(out);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { load, typedText, flagged, pack, timeline, show, grep };
