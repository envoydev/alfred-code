'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const judges = require('../../stack/hooks/guard-data-class.js');
const {
  DEFAULT_ROOT_PARTS, DEFAULT_SAMPLE_LIMIT, TRANSCRIPT_EXT, TOOL_USE_MARK, GIT_TIMEOUT_MS, GIT_MAX_BUFFER, GIT_STATUS,
  GIT_SAFE_ARGS, TOOL, QUERY_GROUP, FOUND_STATE, SAMPLE_KIND,
} = require('./constants');
const { createTally, noteQuery, reportOf, denySampleLine, askSampleLine, evenlySpaced } = require('./tally');
const { readVerdict, needsTrackedCheck, wantsHead, planQuery, queryFindings } = require('./judging');

function transcriptsUnder(root) {
  const found = [];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name.endsWith(TRANSCRIPT_EXT)) found.push(full);
    }
  }
  return found.sort();
}

function git(argv, cwd, okStatuses) {
  const result = spawnSync('git', GIT_SAFE_ARGS.concat(argv), {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    encoding: 'utf8',
  });
  if (result.error) return { kind: 'fail', stdout: '' };
  if (result.status === GIT_STATUS.notARepo) return { kind: 'norepo', stdout: '' };
  if (okStatuses.includes(result.status)) return { kind: 'ok', stdout: result.stdout || '' };
  return { kind: 'fail', stdout: '' };
}

function isFolder(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function isTracked(file) {
  return git(judges.trackedArgv(file), path.dirname(file), [0]).kind === 'ok';
}

function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(judges.HEAD_BYTES);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, count).toString('utf8');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function judgeRead(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const ext = path.extname(file);
  const facts = { base: path.basename(file), ext, bytes: stat.size, tracked: false, head: wantsHead(ext) ? readHead(file) : undefined };
  let verdict = readVerdict(facts);
  if (needsTrackedCheck(verdict)) {
    facts.tracked = isTracked(file);
    verdict = readVerdict(facts);
  }
  return verdict ? { branch: verdict.branch, ext, bytes: stat.size } : null;
}

function searchRepo(cwd, plan) {
  const found = { paths: [], names: [], state: FOUND_STATE.repo };
  if (!cwd || !isFolder(cwd)) return { ...found, state: FOUND_STATE.none };
  const steps = [
    { wanted: plan.paths, argv: judges.pathsArgv, ok: [0], read: judges.pathsFound, key: 'paths' },
    { wanted: plan.names, argv: judges.namesArgv, ok: [0, 1], read: judges.namesFound, key: 'names' },
  ];
  for (const step of steps) {
    if (!step.wanted.length) continue;
    const result = git(step.argv(step.wanted), cwd, step.ok);
    if (result.kind === 'norepo') return { paths: [], names: [], state: FOUND_STATE.none };
    if (result.kind === 'fail') found.state = FOUND_STATE.failed;
    else found[step.key] = step.read(result.stdout, step.wanted);
  }
  return found;
}

function queryGroup(name) {
  if (name === TOOL.webSearch) return QUERY_GROUP.webSearch;
  if (name === TOOL.webFetch) return QUERY_GROUP.webFetch;
  return QUERY_GROUP.mcp;
}

function judgeQuery(name, input, cwd) {
  const texts = judges.judgedTexts(name, input);
  if (texts === null) return null;
  let state = FOUND_STATE.repo;
  let first = null;
  for (const text of texts) {
    const found = searchRepo(cwd, planQuery(text));
    if (found.state === FOUND_STATE.failed) state = FOUND_STATE.failed;
    else if (found.state === FOUND_STATE.none && state === FOUND_STATE.repo) state = FOUND_STATE.none;
    const findings = queryFindings(text, found);
    if (findings.any && !first) first = { text, findings };
  }
  if (!texts.length) state = cwd && isFolder(cwd) ? FOUND_STATE.repo : FOUND_STATE.none;
  return { group: queryGroup(name), state, denied: first !== null, first };
}

function noteRead(tally, samples, item, cwd) {
  tally.reads += 1;
  const input = item.input || {};
  if (typeof input.file_path !== 'string' || !input.file_path) return;
  const verdict = judgeRead(path.resolve(cwd || '', input.file_path));
  if (!verdict) return;
  tally.asks[verdict.branch] += 1;
  samples.ask.push(askSampleLine(verdict.branch, verdict.ext, verdict.bytes));
}

function noteTool(tally, samples, item, cwd) {
  if (item.name === TOOL.read) return noteRead(tally, samples, item, cwd);
  const outcome = judgeQuery(item.name, item.input, cwd);
  if (!outcome) return undefined;
  noteQuery(tally, outcome.group, outcome);
  if (outcome.denied) samples.deny.push(denySampleLine(item.name, outcome.first.findings, outcome.first.text));
  return undefined;
}

function toolUses(line) {
  if (!line.includes(TOOL_USE_MARK)) return null;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  const content = row && row.message && row.message.content;
  if (!Array.isArray(content)) return null;
  return { cwd: typeof row.cwd === 'string' ? row.cwd : '', items: content.filter((c) => c && c.type === 'tool_use') };
}

async function replayTranscript(file, tally, samples, seenIds) {
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    const row = toolUses(line);
    if (!row) continue;
    for (const item of row.items) {
      if (item.id) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
      }
      noteTool(tally, samples, item, row.cwd);
    }
  }
}

function writeSamples(file, samples, limit) {
  const body = []
    .concat(evenlySpaced(samples.deny, limit).map((l) => `${SAMPLE_KIND.deny}\t${l}`))
    .concat(evenlySpaced(samples.ask, limit).map((l) => `${SAMPLE_KIND.ask}\t${l}`));
  fs.writeFileSync(file, body.join('\n') + '\n');
}

async function run({ root, samplesFile, sampleLimit }) {
  const base = root || path.join(os.homedir(), ...DEFAULT_ROOT_PARTS);
  const limit = Number.isInteger(sampleLimit) ? sampleLimit : DEFAULT_SAMPLE_LIMIT;
  const tally = createTally();
  const samples = { deny: [], ask: [] };
  const seenIds = new Set();
  for (const file of transcriptsUnder(base)) {
    tally.transcripts += 1;
    await replayTranscript(file, tally, samples, seenIds);
  }
  if (samplesFile) writeSamples(samplesFile, samples, limit);
  return reportOf(tally);
}

module.exports = { run };
