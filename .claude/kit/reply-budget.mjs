// Copied into each repo as .claude/kit/reply-budget.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// The status hook's reply check, kept pure: from the communication rule's text it takes the reminder line, and from the
// end of a transcript the size of Claude's last reply. The hook reads both files and passes their text in.
import {
    BULLET_PATTERN, CLOSE_LINE_PATTERN, CODE_BLOCK_PATTERN, ENTRY_TYPE, HEADING_START, INLINE_CODE_PATTERN, INLINE_CODE_STAND_IN,
    ITEM_END_STAND_IN, LIFT_PATTERN, MIN_SENTENCE_WORDS, NEWLINE, NOT_TYPED_OPENINGS, REMINDER_HEAD, REMINDER_OPENING,
    REPLY_MAX_LEAD_SENTENCES, REPLY_MAX_PROSE_CHARS, SENTENCE_BREAK, STATUS_ITEM_END, TABLE_ROW_START, TEXT_PART, TYPED_ORIGIN,
    WORD_GAP,
} from './constants.mjs';

const withoutItemEnds = (text) => text.replaceAll(STATUS_ITEM_END, ITEM_END_STAND_IN);

export function reminderOf(ruleText)
{
    const line = ruleText.split(NEWLINE).find((candidate) => candidate.startsWith(REMINDER_OPENING));
    const reminder = line === undefined ? '' : line.slice(REMINDER_OPENING.length).trim();
    return reminder === '' ? null : withoutItemEnds(reminder);
}

function proseOf(reply)
{
    const withoutBlocks = reply.replace(CODE_BLOCK_PATTERN, '');
    const withoutTables = withoutBlocks.split(NEWLINE).filter((line) => !line.trimStart().startsWith(TABLE_ROW_START)).join(NEWLINE);
    return withoutTables.replace(INLINE_CODE_PATTERN, INLINE_CODE_STAND_IN);
}

function leadSentenceCount(prose)
{
    return prose.split(NEWLINE)
        .filter((line) => !BULLET_PATTERN.test(line))
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith(HEADING_START))
        .flatMap((line) => line.split(SENTENCE_BREAK))
        .filter((sentence) => sentence.split(WORD_GAP).length >= MIN_SENTENCE_WORDS)
        .length;
}

function parseEntry(line)
{
    try
    {
        const entry = JSON.parse(line);
        return entry !== null && typeof entry === 'object' ? entry : null;
    }
    catch { return null; }
}

function textOf(entry)
{
    const content = entry.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.filter((part) => part?.type === TEXT_PART && typeof part.text === 'string').map((part) => part.text).join(NEWLINE);
}

function isTypedTurn(entry, said)
{
    if (entry.isMeta || entry.isCompactSummary) return false;
    if (typeof entry.origin?.kind === 'string') return entry.origin.kind === TYPED_ORIGIN;
    return !NOT_TYPED_OPENINGS.some((opening) => said.trimStart().startsWith(opening));
}

// The last reply in the transcript's lines and the typed request it answered - a later turn nobody typed does not move
// either. A first line cut by the tail read fails to parse and is skipped.
function lastExchangeOf(transcriptText)
{
    let request = '';
    let reply = '';
    let replyRequest = '';
    for (const line of transcriptText.split(NEWLINE))
    {
        const entry = parseEntry(line);
        if (entry === null) continue;
        const text = textOf(entry);
        if (text.trim() === '') continue;
        if (entry.type === ENTRY_TYPE.assistant)
        {
            reply = text;
            replyRequest = request;
        }
        else if (entry.type === ENTRY_TYPE.user && isTypedTurn(entry, text)) request = text;
    }
    return { reply, request: replyRequest };
}

export function replyNoteOf(transcriptText)
{
    const { reply, request } = lastExchangeOf(transcriptText);
    if (reply === '' || CLOSE_LINE_PATTERN.test(reply) || LIFT_PATTERN.test(request)) return null;
    const prose = proseOf(reply);
    const proseChars = prose.trim().length;
    const leadSentences = leadSentenceCount(prose);
    if (proseChars <= REPLY_MAX_PROSE_CHARS && leadSentences <= REPLY_MAX_LEAD_SENTENCES) return null;
    return `Last reply: ${proseChars} characters of prose and ${leadSentences} lead sentences - over the limit. Make this one fit.`;
}

export function reminderContextOf(ruleText, transcriptText)
{
    const reminder = reminderOf(ruleText);
    if (reminder === null) return null;
    const note = replyNoteOf(transcriptText);
    return [REMINDER_HEAD, reminder, ...(note === null ? [] : [note])].join(' ');
}
