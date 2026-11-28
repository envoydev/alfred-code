'use strict';
// The last-reply check communication-reminder.js uses: the size of Claude's last reply, read from the end of the transcript.
// `replyCheckOf(text)` is pure; `noteFor(path)` reads the file in growing tails and returns the note, or ''.
// No dependency on hook-prelude: a missing module or a failed read adds no note.
const fs = require('fs');

const REPLY_MAX_PROSE_CHARS = 900;
const REPLY_MAX_LEAD_SENTENCES = 3;
const MIN_SENTENCE_WORDS = 3;
// The lift words of the budget line itself (BUDGET_TEXT in communication-reminder.js), so the note never contradicts it.
const LIFT_PATTERN = /\b(?:in detail|step by step|teach me|walk me through|eli5|write a plan)\b/i;
// The field lines the communication rule and the skills require in a close. One closed set: a line that starts with one
// of these labels is outside the budget, with its wrapped lines. The label shape is a copy of guard-stop-contract.js's
// LABEL_HEAD and LABEL_TAIL (list marker, bold or underscore marks, any case); hooks are separate files, so it is copied.
const FIELD_LABELS = Object.freeze(['Result', 'Progress', 'Leftovers', 'Deferred by you', 'Checks', 'Cleanup']);
const CLOSE_LABEL = 'Checks';
const LABEL_HEAD = String.raw`^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+|\|[ \t]*)?(?:\*\*|__)?`;
const LABEL_TAIL = String.raw`(?:\*\*|__)?[ \t]*:(?:\*\*|__)?[ \t]*`;
const labelPattern = (labels, flags, end = '') => new RegExp(`${LABEL_HEAD}(?:${labels.join('|')})${LABEL_TAIL}${end}`, flags);
const FIELD_LINE_PATTERN = labelPattern(FIELD_LABELS, 'i');
const BARE_FIELD_LINE_PATTERN = labelPattern(FIELD_LABELS, 'i', '$');
const CLOSE_LINE_PATTERN = labelPattern([CLOSE_LABEL], 'im');
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]*`/g;
const INLINE_CODE_STAND_IN = 'X';
const TABLE_ROW_START = '|';
const HEADING_START = '#';
const BULLET_PATTERN = /^\s*(?:[-*]|\d+[.)])\s+/;
const CONTINUATION_PATTERN = /^[ \t]+\S/;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
const WORD_GAP = /\s+/;
const NEWLINE = '\n';
// A turn nobody typed opens with one of these where its transcript entry records no origin.
const NOT_TYPED_OPENINGS = Object.freeze(['<task-notification', '<cross-session-message', 'Another Claude session sent', '[SYSTEM NOTIFICATION', 'This session is being continued']);
const TYPED_ORIGIN = 'human';
const ENTRY_TYPE = Object.freeze({ user: 'user', assistant: 'assistant', attachment: 'attachment' });
const QUEUED_COMMAND = 'queued_command';
const TEXT_PART = 'text';
const TURN_RUNNING_PARTS = Object.freeze(['tool_use', 'tool_result']);
const TRANSCRIPT_TAIL_STEPS = Object.freeze([512 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024, 32 * 1024 * 1024]);

// The lines that are not field lines; a field line's wrapped lines - indented, up to the next blank line - go with it,
// and so do the bullet lines right after a field label that stands alone on its line.
function withoutFieldLines(text) {
  let inField = false;
  let bareField = false;
  return text.split(NEWLINE).filter((line) => {
    if (line.trim() === '') inField = bareField = false;
    else if (FIELD_LINE_PATTERN.test(line)) { inField = true; bareField = BARE_FIELD_LINE_PATTERN.test(line); }
    else if (!(inField && (CONTINUATION_PATTERN.test(line) || (bareField && BULLET_PATTERN.test(line))))) inField = bareField = false;
    return !inField;
  }).join(NEWLINE);
}

function proseOf(reply) {
  const withoutBlocks = reply.replace(CODE_BLOCK_PATTERN, '');
  const withoutTables = withoutBlocks.split(NEWLINE).filter((line) => !line.trimStart().startsWith(TABLE_ROW_START)).join(NEWLINE);
  return withoutFieldLines(withoutTables).replace(INLINE_CODE_PATTERN, INLINE_CODE_STAND_IN);
}

// The sentences outside the bullets; a bullet's wrapped lines - indented, up to the next blank line - are the bullet's.
function leadSentenceCount(prose) {
  let inBullet = false;
  const leadLines = [];
  for (const line of prose.split(NEWLINE)) {
    if (line.trim() === '') inBullet = false;
    else if (BULLET_PATTERN.test(line)) inBullet = true;
    else if (!(inBullet && CONTINUATION_PATTERN.test(line))) leadLines.push(line.trim());
  }
  return leadLines
    .filter((line) => !line.startsWith(HEADING_START))
    .flatMap((line) => line.split(SENTENCE_BREAK))
    .filter((sentence) => sentence.split(WORD_GAP).length >= MIN_SENTENCE_WORDS)
    .length;
}

function parseEntry(line) {
  try {
    const entry = JSON.parse(line);
    return entry !== null && typeof entry === 'object' ? entry : null;
  } catch { return null; }
}

function textOf(entry) {
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part && part.type === TEXT_PART && typeof part.text === 'string').map((part) => part.text).join(NEWLINE);
}

function hasPart(entry, types) {
  const content = entry.message && entry.message.content;
  return Array.isArray(content) && content.some((part) => part && types.includes(part.type));
}

// The text of a request nobody but a person typed, or null: a user turn, or a prompt queued while a turn ran. Where the
// entry records an origin the origin decides - a queued prompt's sits inside 'attachment' - else its opening does.
function typedRequestOf(entry) {
  const queued = entry.type === ENTRY_TYPE.attachment && entry.attachment && entry.attachment.type === QUEUED_COMMAND;
  if (entry.type !== ENTRY_TYPE.user && !queued) return null;
  const said = queued ? entry.attachment.prompt : textOf(entry);
  if (typeof said !== 'string' || said.trim() === '' || entry.isMeta || entry.isCompactSummary) return null;
  const origin = queued ? entry.attachment.origin : entry.origin;
  const kind = origin && origin.kind;
  if (typeof kind === 'string') return kind === TYPED_ORIGIN ? said : null;
  return NOT_TYPED_OPENINGS.some((opening) => said.trimStart().startsWith(opening)) ? null : said;
}

// The last reply in the transcript's lines, the typed request it answered (null where the lines hold none) and whether a
// tool call or result follows the reply's text - then the text was interim and the turn is still running. A later turn
// nobody typed does not move the request. A first line cut by the tail read fails to parse and is skipped.
function lastExchangeOf(transcriptText) {
  let request = null;
  const exchange = { reply: '', request: null, turnRunning: false };
  for (const line of transcriptText.split(NEWLINE)) {
    const entry = parseEntry(line);
    if (entry === null) continue;
    const typedRequest = typedRequestOf(entry);
    if (typedRequest !== null) request = typedRequest;
    const toolPart = hasPart(entry, TURN_RUNNING_PARTS);
    const text = entry.type === ENTRY_TYPE.assistant ? textOf(entry) : '';
    if (text.trim() !== '') Object.assign(exchange, { reply: text, request, turnRunning: false });
    if (toolPart) exchange.turnRunning = true;
  }
  return exchange;
}

// What the last reply in the transcript's lines gets: `requestFound` says whether the typed request it answered is in
// them, `note` is the text to tell Claude, or null. With no request in view the lift is unknown, so there is no note.
function replyCheckOf(transcriptText) {
  const { reply, request, turnRunning } = lastExchangeOf(transcriptText);
  if (request === null) return { requestFound: false, note: null };
  if (reply === '' || turnRunning || CLOSE_LINE_PATTERN.test(reply.replace(CODE_BLOCK_PATTERN, '')) || LIFT_PATTERN.test(request)) return { requestFound: true, note: null };
  const prose = proseOf(reply);
  const proseChars = [...prose.trim()].length;
  const leadSentences = leadSentenceCount(prose);
  if (proseChars <= REPLY_MAX_PROSE_CHARS && leadSentences <= REPLY_MAX_LEAD_SENTENCES) return { requestFound: true, note: null };
  return { requestFound: true, note: `Last reply: ${proseChars} characters of prose, lead sentences: ${leadSentences} - over the limit. Make this one fit.` };
}

// The last byteCount bytes of a file, and whether they reach its start (the first line may be cut where they do not).
// Any failure is an empty read from the start: no note.
function readTail(file, byteCount) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(descriptor);
    const length = Math.min(byteCount, size);
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(descriptor, buffer, 0, length, size - length);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), reachedStart: length === size };
  } catch {
    return { text: '', reachedStart: true };
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* nothing to close */ } }
  }
}

// The note on the last reply, from growing tails of the transcript: the first tail that holds the typed request the
// reply answered decides. No path, no request in the largest tail or the whole file, or a read failure: ''.
function noteFor(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return '';
  for (const byteCount of TRANSCRIPT_TAIL_STEPS) {
    const { text, reachedStart } = readTail(transcriptPath, byteCount);
    const { requestFound, note } = replyCheckOf(text);
    if (requestFound) return note || '';
    if (reachedStart) return '';
  }
  return '';
}

module.exports = { replyCheckOf, noteFor };
