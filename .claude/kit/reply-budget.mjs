// Copied into each repo as .claude/kit/reply-budget.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// The agent-reminders hook's logic, kept pure: from each rule's text it takes the reminder line, and from the end of a
// transcript the size of Claude's last reply. The hook reads the files and passes their text in.
import {
    BULLET_PATTERN, CLOSE_LINE_PATTERN, CODE_BLOCK_PATTERN, CONTINUATION_PATTERN, CUT_MARK, ENTRY_TYPE, HEADING_START,
    INLINE_CODE_PATTERN, INLINE_CODE_STAND_IN, ITEM_END_STAND_IN, LIFT_PATTERN, MAX_SHOWN_LENGTH, MIN_SENTENCE_WORDS, NEWLINE,
    NOT_TYPED_OPENINGS, QUEUED_COMMAND, REMINDER_OPENING, REMINDER_SOURCES, REPLY_MAX_LEAD_SENTENCES, REPLY_MAX_PROSE_CHARS,
    SENTENCE_BREAK, STATUS_ITEM_END, TABLE_ROW_START, TEXT_PART, TURN_RUNNING_PARTS, TYPED_ORIGIN, WORD_GAP,
} from './constants.mjs';

const withoutItemEnds = (text) => text.replaceAll(STATUS_ITEM_END, ITEM_END_STAND_IN);

export function reminderOf(ruleText)
{
    const line = ruleText.split(NEWLINE).find((candidate) => candidate.startsWith(REMINDER_OPENING));
    const reminder = line === undefined ? '' : line.slice(REMINDER_OPENING.length).trim();
    if (reminder === '') return null;
    const whole = withoutItemEnds(reminder);
    return whole.length > MAX_SHOWN_LENGTH ? `${whole.slice(0, MAX_SHOWN_LENGTH)}${CUT_MARK}` : whole;
}

function proseOf(reply)
{
    const withoutBlocks = reply.replace(CODE_BLOCK_PATTERN, '');
    const withoutTables = withoutBlocks.split(NEWLINE).filter((line) => !line.trimStart().startsWith(TABLE_ROW_START)).join(NEWLINE);
    return withoutTables.replace(INLINE_CODE_PATTERN, INLINE_CODE_STAND_IN);
}

// Counts the sentences outside the bullets; a bullet's wrapped lines - indented, up to the next blank line - are the bullet's.
function leadSentenceCount(prose)
{
    let inBullet = false;
    const leadLines = [];
    for (const line of prose.split(NEWLINE))
    {
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

function hasPart(entry, types)
{
    const content = entry.message?.content;
    return Array.isArray(content) && content.some((part) => types.includes(part?.type));
}

// The text of a request nobody but a person typed, or null: a user turn, or a prompt queued while a turn ran. Where the
// entry records an origin the origin decides - a queued prompt's sits inside 'attachment' - else its opening does.
function typedRequestOf(entry)
{
    const queued = entry.type === ENTRY_TYPE.attachment && entry.attachment?.type === QUEUED_COMMAND;
    if (entry.type !== ENTRY_TYPE.user && !queued) return null;
    const said = queued ? entry.attachment.prompt : textOf(entry);
    if (typeof said !== 'string' || said.trim() === '' || entry.isMeta || entry.isCompactSummary) return null;
    const kind = (queued ? entry.attachment.origin : entry.origin)?.kind;
    if (typeof kind === 'string') return kind === TYPED_ORIGIN ? said : null;
    return NOT_TYPED_OPENINGS.some((opening) => said.trimStart().startsWith(opening)) ? null : said;
}

// The last reply in the transcript's lines, the typed request it answered (null where the lines hold none) and whether a
// tool call or result follows the reply's text - then the text was interim and the turn is still running. A later turn
// nobody typed does not move the request. A first line cut by the tail read fails to parse and is skipped.
function lastExchangeOf(transcriptText)
{
    let request = null;
    const exchange = { reply: '', request: null, turnRunning: false };
    for (const line of transcriptText.split(NEWLINE))
    {
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
// them, and `note` is the text to tell Claude, or null. With no request in view the lift is unknown, so there is no note.
export function replyCheckOf(transcriptText)
{
    const { reply, request, turnRunning } = lastExchangeOf(transcriptText);
    if (request === null) return { requestFound: false, note: null };
    if (reply === '' || turnRunning || CLOSE_LINE_PATTERN.test(reply) || LIFT_PATTERN.test(request)) return { requestFound: true, note: null };
    const prose = proseOf(reply);
    const proseChars = [...prose.trim()].length;
    const leadSentences = leadSentenceCount(prose);
    if (proseChars <= REPLY_MAX_PROSE_CHARS && leadSentences <= REPLY_MAX_LEAD_SENTENCES) return { requestFound: true, note: null };
    return { requestFound: true, note: `Last reply: ${proseChars} characters of prose, lead sentences: ${leadSentences} - over the limit. Make this one fit.` };
}

// The lines to send: for each rule of REMINDER_SOURCES, in order, its head and its reminder - and the note, on the rule
// that takes it. `ruleTexts` maps a rule's file to its text; a rule with no text or no reminder line adds no line, and
// with no line at all the result is null.
export function reminderContextOf(ruleTexts, note)
{
    const lines = REMINDER_SOURCES.flatMap(({ file, head, takesReplyNote }) =>
    {
        const reminder = reminderOf(ruleTexts[file] ?? '');
        if (reminder === null) return [];
        return [[head, reminder, ...(takesReplyNote && note !== null ? [note] : [])].join(' ')];
    });
    return lines.length === 0 ? null : lines.join(NEWLINE);
}
