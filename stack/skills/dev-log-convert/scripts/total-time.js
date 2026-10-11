#!/usr/bin/env node
// total-time.js - normalize the time token on each drafted task line and total the day.
// Dependencies: none - Node.js built-ins only (no install, no network).
// Usage: node "<skill dir>/scripts/total-time.js" < lines.txt      (one task line per input line)
//        printf '%s\n' '1 ABC-1 (1h 30m) - Fixed x.' | node "<skill dir>/scripts/total-time.js"
// Output: one row per line with its normalized time, then the day total in `Xh Ym`.
// The time of a line is its bracketed token after the ticket id - `<n> <TICKET-ID> (<time>) - <summary>`.
// A duration in the summary ('raised the TTL to 30m') is never counted. A line whose head carries
// no bracketed time is reported as `(time not specified)` and counts as zero. A bracketed token holding a
// digit the units below do not account for ('30 min', '2-3h') is UNREADABLE: the run names the line, prints
// no total and exits 2 - a silent drop once printed a day 1h short (audit 2026-10-11, session 5f9fec85).

// Only a letter closes a unit: a digit after it starts the next duration, so `1h15m` and `1г15хв` read whole.
const UNIT = /(\d+(?:[.,]\d+)?)\s*(год|гг|хвил|хв|г|h|m)(?!\p{L})/giu;

// The first bracket on the line, and only when no ' - ' separator precedes it: past the separator a
// bracket belongs to the summary, not the task's time.
function timeToken(line) {
  const m = /\(([^)]*)\)/u.exec(line);
  if (!m || line.slice(0, m.index).includes(' - ')) return null;
  return m[1];
}

// { mins } for a read token (null when it holds no time), { unreadable } for a token with a digit left over.
function minutesOf(line) {
  const token = timeToken(line);
  if (token === null) return { mins: null };
  let total = 0, found = false;
  for (const m of token.matchAll(UNIT)) {
    const value = parseFloat(m[1].replace(',', '.'));
    const unit = m[2].toLowerCase();
    const isHour = unit === 'h' || unit === 'г' || unit === 'год' || unit === 'гг';
    total += isHour ? value * 60 : value;
    found = true;
  }
  const residue = token.replace(UNIT, ' ');
  if (/\d/u.test(residue)) return { unreadable: token };
  return { mins: found ? Math.round(total) : null };
}

function format(mins) {
  if (mins === null) return '(time not specified)';
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// stdout and stderr block, so a pipe gets every byte before process.exit (macOS writes a pipe async) - the
// prelude's blockingStdio, inline because a skill copy has no prelude beside it (blocking-stdio in meta/shared-rules.json).
function blockingStdio(streams = [process.stdout, process.stderr])
{
    for (const s of streams)
    {
        try { if (s && s._handle && typeof s._handle.setBlocking === 'function') s._handle.setBlocking(true); }
        catch { /* a stream that cannot block keeps Node's default */ }
    }
}
blockingStdio();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    console.error('total-time: no input. Pipe the drafted task lines in, one per line.');
    process.exit(1);
  }
  let sum = 0, timed = 0, untimed = 0;
  const unreadable = [];
  lines.forEach((line, i) => {
    const r = minutesOf(line);
    let shown;
    if (r.unreadable !== undefined) { unreadable.push(i + 1); shown = 'UNREADABLE'; }
    else if (r.mins === null) { untimed += 1; shown = format(null); }
    else { sum += r.mins; timed += 1; shown = format(r.mins); }
    console.log(`${String(i + 1).padStart(2)}. ${shown.padEnd(20)} ${line}`);
  });
  if (unreadable.length) {
    console.log(`No total: ${unreadable.length} time token(s) UNREADABLE - respell as <n>h <n>m and re-run.`);
    console.error(`total-time: unreadable time on line ${unreadable.join(', line ')} - no total is valid until every bracketed time reads as h / m (or г / год / гг / хв / хвил).`);
    process.exit(2);
  }
  console.log(`Total time: ${format(sum)}  (${sum}m over ${timed} timed line(s), ${untimed} without time)`);
});
