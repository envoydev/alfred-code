#!/usr/bin/env node
'use strict';
// handoff.js - THE SEATS' HANDOFF BUS (an engine copied beside docs.js, not wired; 2026-10-24, the user's ruling that the
// stack depends on no MCP server - the bus was memory-server rows tagged `handoff` before). One note per name, written
// by the seat that owns it and read by the next seat of the same run; the orchestrator counts and purges a feature's
// notes at the close. Notes live under the MAIN checkout's <data root>/state/handoff/<feature>.jsonl (layout.js
// projectRootOf), so a seat in a linked worktree writes where the next one reads; state/ is never committed.
//   node .claude/hooks/handoff.js put <feature>/<contract_version>/<seat>[/<task>]   the note on stdin (a heredoc)
//   node .claude/hooks/handoff.js list <feature>/<contract_version>                  the run's notes, newest first
//   node .claude/hooks/handoff.js left [<feature>]                                    first line: notes left, then `note <name>`
//   node .claude/hooks/handoff.js purge <feature>                                     the feature's notes removed, named
// A note is cut at NOTE_CAP: a handoff is a resume brief, never a dump of the diff.
const fs = require('fs');
const path = require('path');
const layout = require('./layout.js');

const NOTE_CAP = 4000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NAME_HELP = 'handoff: a note name is <feature>/<contract_version>/<seat>[/<task>], each part letters, digits, . _ -';

const storeDir = (cwd = process.cwd()) => layout.statePath(layout.projectRootOf(cwd).project, 'handoff', '');
const fileOf = (dir, feature) => path.join(dir, `${feature}.jsonl`);
const segments = (name, min, max) => {
  const parts = String(name || '').split('/');
  return parts.length >= min && parts.length <= max && parts.every((p) => SEGMENT.test(p)) ? parts : null;
};

// The feature's notes in write order; a line that is not a note is skipped. Throws on an unreadable file.
function readNotes(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const notes = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const n = JSON.parse(line); if (n && typeof n.name === 'string' && typeof n.text === 'string') notes.push(n); } catch { /* a torn line */ }
  }
  return notes;
}
// The newest note per name, newest first.
function latest(notes) {
  const byName = new Map();
  notes.forEach((n, i) => byName.set(n.name, { ...n, i }));
  return [...byName.values()].sort((a, b) => b.i - a.i);
}

function put(name, text, { cwd } = {}) {
  const parts = segments(name, 3, 4);
  if (!parts) return { code: 2, err: NAME_HELP };
  let body = String(text || '').replace(/\s+$/, '');
  if (!body.trim()) return { code: 2, err: 'handoff: no note text on stdin - pass it as a heredoc' };
  if (body.length > NOTE_CAP) body = `${body.slice(0, NOTE_CAP)}\n[cut at ${NOTE_CAP} chars]`;
  const dir = storeDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  // One short appended line per note: O_APPEND keeps parallel seats' lines whole.
  fs.appendFileSync(fileOf(dir, parts[0]), `${JSON.stringify({ name, at: new Date().toISOString(), text: body })}\n`);
  return { code: 0, out: `handoff: stored ${name}` };
}

function list(run, { cwd } = {}) {
  const parts = segments(run, 2, 2);
  if (!parts) return { code: 2, err: 'handoff: list takes <feature>/<contract_version>' };
  const prefix = `${run}/`;
  const notes = latest(readNotes(fileOf(storeDir(cwd), parts[0])).filter((n) => n.name.startsWith(prefix)));
  if (!notes.length) return { code: 0, out: 'handoff: none' };
  return { code: 0, out: notes.map((n) => `## ${n.name} (${n.at})\n${n.text}`).join('\n\n') };
}

function left(feature, { cwd } = {}) {
  if (feature && !segments(feature, 1, 1)) return { code: 2, err: 'handoff: left takes a <feature> or nothing' };
  const dir = storeDir(cwd);
  let files = [];
  if (feature) files = [fileOf(dir, feature)];
  else {
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); }
    catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  const names = files.flatMap((f) => latest(readNotes(f)).map((n) => n.name)).sort();
  return { code: 0, out: [String(names.length), ...names.map((n) => `note ${n}`)].join('\n') };
}

function purge(feature, { cwd } = {}) {
  if (!segments(feature, 1, 1)) return { code: 2, err: 'handoff: purge takes a <feature>' };
  const file = fileOf(storeDir(cwd), feature);
  const names = latest(readNotes(file)).map((n) => n.name).sort();
  fs.rmSync(file, { force: true });
  return { code: 0, out: `handoff: purged ${names.length} notes (${names.join(', ') || 'none'})` };
}

module.exports = { put, list, left, purge, storeDir, NOTE_CAP };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const finish = ({ code, out, err }) => {
    if (out) process.stdout.write(`${out}\n`);
    if (err) process.stderr.write(`${err}\n`);
    process.exitCode = code;
  };
  try {
    if (cmd === 'put') {
      let text = '';
      try { text = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }
      finish(put(arg, text));
    } else if (cmd === 'list') finish(list(arg));
    else if (cmd === 'left') finish(left(arg));
    else if (cmd === 'purge') finish(purge(arg));
    else finish({ code: 2, err: 'usage: handoff.js put <name> | list <feature>/<contract_version> | left [<feature>] | purge <feature>' });
  } catch (err) {
    finish({ code: 1, err: `handoff: the store cannot be read (${err.code || err.name})` });
  }
}
