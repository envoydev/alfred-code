'use strict';
const { ASK_BRANCHES, QUERY_GROUP, SAMPLE_CHARS, FOUND_STATE } = require('./constants');

function createTally() {
  const asks = {};
  for (const branch of ASK_BRANCHES) asks[branch] = 0;
  const queries = {};
  for (const group of Object.values(QUERY_GROUP)) queries[group] = 0;
  return { transcripts: 0, reads: 0, asks, queries, denies: 0, judgedWithRepo: 0, judgedShapeOnly: 0, unjudged: 0 };
}

function noteQuery(tally, group, outcome) {
  tally.queries[group] += 1;
  if (outcome.state === FOUND_STATE.none) tally.judgedShapeOnly += 1;
  else tally.judgedWithRepo += 1;
  if (outcome.state === FOUND_STATE.failed) tally.unjudged += 1;
  if (outcome.denied) tally.denies += 1;
}

function reportOf(tally) {
  return {
    transcripts: tally.transcripts,
    reads: tally.reads,
    asks: tally.asks,
    queries: tally.queries,
    denies: tally.denies,
    judgedWithRepo: tally.judgedWithRepo,
    judgedShapeOnly: tally.judgedShapeOnly,
    unjudged: tally.unjudged,
  };
}

function findingKinds(findings) {
  const parts = [];
  if (findings.paths.length) parts.push(`paths=${findings.paths.length}`);
  if (findings.names.length) parts.push(`names=${findings.names.length}`);
  if (findings.codeLines) parts.push(`codeLines=${findings.codeLines}`);
  return parts.join(',');
}

function denySampleLine(tool, findings, text) {
  const shown = String(text).replace(/\s+/g, ' ').slice(0, SAMPLE_CHARS);
  return `${tool}\t${findingKinds(findings)}\t${shown}`;
}

function askSampleLine(branch, ext, bytes) {
  return `Read\t${branch}\t${ext || '(no ext)'} ${bytes} bytes`;
}

function evenlySpaced(lines, limit) {
  if (limit <= 0) return [];
  if (lines.length <= limit) return lines.slice();
  const picked = [];
  for (let i = 0; i < limit; i++) picked.push(lines[Math.floor((i * lines.length) / limit)]);
  return picked;
}

module.exports = { createTally, noteQuery, reportOf, denySampleLine, askSampleLine, evenlySpaced };
