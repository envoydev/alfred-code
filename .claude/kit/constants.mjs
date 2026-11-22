// Copied into each repo as .claude/kit/constants.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// The named values kit-settings.mjs, status-hook.mjs and prove-plan.mjs share.

// What a dispatch accepts as its model.
export const MODELS = Object.freeze(['sonnet', 'opus', 'haiku', 'fable']);

export const VARIABLE = Object.freeze({
    passScore: 'KIT_PASS_SCORE',
    planModel: 'KIT_PLAN_MODEL',
    auditModel: 'KIT_AUDIT_MODEL',
    reviewModel: 'KIT_REVIEW_MODEL',
    implementModel: 'KIT_IMPLEMENT_MODEL',
    searchModel: 'KIT_SEARCH_MODEL',
    scoring: 'KIT_SCORING',
    autoRun: 'KIT_AUTO_RUN',
    autoApprove: 'KIT_AUTO_APPROVE',
});

// The names the resolved settings go by, and the names the kit's own settings file may hold.
export const SETTING = Object.freeze({
    passScore: 'pass_score',
    planModel: 'plan_model',
    auditModel: 'audit_model',
    reviewModel: 'review_model',
    implementModel: 'implement_model',
    searchModel: 'search_model',
    scoring: 'scoring',
    autoRun: 'auto_run',
    autoApprove: 'auto_approve',
});

export const DEFAULT_PASS_SCORE = 90;
// The one role with no agent file to name its model: a search finds and reports, so the cheapest model does it.
export const DEFAULT_SEARCH_MODEL = 'haiku';
export const COMMITTED_SETTINGS = '.claude/settings.json';

export const SWITCH = Object.freeze({ on: 'on', off: 'off' });

// The three modes a request can switch, whatever the variables say. `setting` is the mode's name among the settings,
// `names` are what a request may call it. Auto-approve has no 'plan approval' among its names: 'disable plan approval'
// reads both ways, so the session saves that one, not the hook.
export const SWITCH_MODES = Object.freeze([
    Object.freeze({ setting: SETTING.autoRun, names: Object.freeze(['auto run', 'auto-run', 'autorun', 'auto mode']) }),
    Object.freeze({ setting: SETTING.scoring, names: Object.freeze(['scoring']) }),
    Object.freeze({ setting: SETTING.autoApprove, names: Object.freeze(['auto approve', 'auto-approve', 'autoapprove', 'auto approval', 'auto-approval']) }),
]);
// What a request may start with and still count, as a pattern source, and the article its names may carry:
// 'Please, turn off the scoring'.
export const POLITE_PREFIX = 'please,? ';
export const ARTICLE = 'the ';
// The line a request is read from ends at the first newline, and a line ending in a question mark asks and saves nothing.
export const NEWLINE = '\n';
export const QUESTION_MARK = '?';
// The verbs that switch a mode when a request opens with one and the mode's name: 'turn off scoring'.
export const SWITCH_VERBS = Object.freeze({
    on: Object.freeze(['turn on', 'switch on', 'enable', 'start']),
    off: Object.freeze(['turn off', 'switch off', 'disable', 'stop']),
});
// The verbs whose 'on' or 'off' may follow the mode's name: 'turn scoring off'.
export const SPLIT_VERBS = Object.freeze(['turn', 'switch']);
// The five roles whose model a request can name, in the order the user's line shows them. `setting` is the role's name
// among the settings, `label` its word on the user's line, `names` what a request may call it before 'model', and `verbs`
// what a request may open with: 'audit with fable'.
export const MODEL_ROLES = Object.freeze([
    Object.freeze({ setting: SETTING.planModel, label: 'plan', names: Object.freeze(['plan', 'planning', 'planner']), verbs: Object.freeze(['plan']) }),
    Object.freeze({ setting: SETTING.auditModel, label: 'audit', names: Object.freeze(['audit', 'auditor']), verbs: Object.freeze(['audit']) }),
    Object.freeze({ setting: SETTING.reviewModel, label: 'review', names: Object.freeze(['review', 'reviewer', 'scoring', 'grading', 'grader']), verbs: Object.freeze(['review', 'grade', 'score']) }),
    Object.freeze({ setting: SETTING.implementModel, label: 'implement', names: Object.freeze(['implement', 'implementation', 'implementer', 'editor']), verbs: Object.freeze(['implement', 'build', 'edit']) }),
    Object.freeze({ setting: SETTING.searchModel, label: 'search', names: Object.freeze(['search']), verbs: Object.freeze(['search']) }),
]);
// The word that makes a role's name a model choice - 'plan model', 'review models' - and its pattern with the plural.
export const MODEL_WORD = 'model';
export const MODEL_WORD_PATTERN = `${MODEL_WORD}s?`;
// The verbs a model choice may open with: 'set the review model to sonnet'.
export const MODEL_LEADING_VERBS = Object.freeze(['set', 'use', 'switch', 'change', 'make']);
// What may join the roles of one model choice: 'plan, review and implement models'.
export const ROLE_JOINERS = Object.freeze([', and ', ' and ', ', ']);
// What may sit between the roles and the model, as pattern sources: ' to ', a colon or equals sign, or a bare space.
export const MODEL_CONNECTORS = Object.freeze([' to ', ' is ', ' are ', ' on ', ' with ', ' ?[:=] ?', ' ']);
// The word between a role's verb and the model: 'edit with haiku'.
export const VERB_CONNECTOR = 'with';
// What may follow the value of a request without changing it: 'plan model fable for good', 'scoring off please'.
export const VALUE_TAILS = Object.freeze([
    'for good', 'always', 'by default', 'permanently', 'from now on',
    'for every session', 'in every session', 'for all sessions', 'in all sessions',
    'please',
]);
// The punctuation that may end a value in a request, so that 'fable.' counts and 'fable-like' does not.
export const VALUE_END_PUNCTUATION = '.,;:!';
// Pattern sources for where a value may end. A boundary is the end of the line, or punctuation followed by a space or the
// end of the line - what comes after it is another sentence. A form ends at a boundary or at a tail and a boundary.
const BOUNDARY = `$|[${VALUE_END_PUNCTUATION}](?: |$)`;
export const VALUE_END = `(?:${BOUNDARY}| (?:${VALUE_TAILS.join('|')})(?:${BOUNDARY}))`;

// The kit's own settings folder and the file there, committed with the repo. It holds every setting, the switches too.
export const KIT_FOLDER = '.claude/kit';
export const KIT_SETTINGS_FILE = `${KIT_FOLDER}/settings.json`;
export const MODEL_SETTINGS = Object.freeze([SETTING.planModel, SETTING.auditModel, SETTING.reviewModel, SETTING.implementModel, SETTING.searchModel]);
export const SWITCH_SETTINGS = Object.freeze([SETTING.scoring, SETTING.autoRun, SETTING.autoApprove]);
export const KIT_FILE_SETTINGS = Object.freeze([...MODEL_SETTINGS, SETTING.passScore, ...SWITCH_SETTINGS]);
export const MIN_PASS_SCORE = 1;
export const MAX_PASS_SCORE = 100;
// What the origin of a fallen-through value says about the value, after 'is', and what a file's other problem tells the user.
export const MODEL_REASON = `not one of ${MODELS.join(', ')}`;
export const SCORE_REASON = `not a whole number from ${MIN_PASS_SCORE} to ${MAX_PASS_SCORE}`;
export const SWITCH_REASON = "neither 'on' nor 'off'";
export const FIX_OR_DELETE = ' - fix or delete it';
// The words of `node .claude/kit/settings.mjs`: print the values, set one, or remove one from the kit's file.
export const SETTINGS_COMMAND = Object.freeze({ set: 'set', unset: 'unset' });
export const SETTINGS_EXIT = Object.freeze({ ok: 0, failed: 1 });
export const SETTINGS_USAGE = `usage: node ${KIT_FOLDER}/settings.mjs [${SETTINGS_COMMAND.set} <name> <value> | ${SETTINGS_COMMAND.unset} <name>] - names: ${KIT_FILE_SETTINGS.join(', ')}`;
export const SETTINGS_REFUSED = `saving changes the file of the repo this script is installed in: run ${KIT_FOLDER}/settings.mjs there, not from a checkout`;
// The temporary file a save writes beside the settings file before it renames it into place.
export const TEMP_SUFFIX = '.tmp';
// What the hook writes to stderr, and what Claude's values say about a request's save: a rule keys on both.
export const HOOK_ERROR_PREFIX = 'claude-kit status hook:';
export const SAVED_PREFIX = 'saved:';
export const NOT_SAVED_PREFIX = 'not saved -';
// The most characters of one value or one source the status hook prints, and what it puts where it cut one: a kit file,
// a variable or an agent file can hold a value of any length, and Claude Code replaces a string of more than 10,000
// characters that a hook returns with a pointer to a file.
export const MAX_SHOWN_LENGTH = 400;
export const CUT_MARK = '...';
// reply-budget.mjs: the communication rule's line the communication hook sends with each request, found by its opening, and
// the limits it checks Claude's last reply against - the rule's own numbers and lift words.
export const COMMUNICATION_RULE_FILE = '.claude/rules/communication.md';
export const COMMUNICATION_HOOK_ERROR_PREFIX = 'claude-kit communication hook:';
export const REMINDER_OPENING = '- Each request carries this reminder:';
export const REMINDER_HEAD = `Reply limits (${COMMUNICATION_RULE_FILE}):`;
export const REPLY_MAX_PROSE_CHARS = 900;
export const REPLY_MAX_LEAD_SENTENCES = 3;
export const MIN_SENTENCE_WORDS = 3;
export const LIFT_PATTERN = /\b(?:in detail|step by step|teach me)\b/i;
export const CLOSE_LINE_PATTERN = /^\s*(?:[-*]\s*)?\*{0,2}Checks:/m;
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
export const INLINE_CODE_PATTERN = /`[^`]*`/g;
export const INLINE_CODE_STAND_IN = 'X';
export const TABLE_ROW_START = '|';
export const HEADING_START = '#';
export const BULLET_PATTERN = /^\s*(?:[-*]|\d+[.)])\s+/;
export const SENTENCE_BREAK = /(?<=[.!?:])\s+/;
export const WORD_GAP = /\s+/;
// A turn nobody typed - a task notification, another session's message, a compaction summary - opens with one of these
// where its transcript entry records no origin.
export const NOT_TYPED_OPENINGS = Object.freeze(['<task-notification', '<cross-session-message', 'Another Claude session sent', '[SYSTEM NOTIFICATION', 'This session is being continued']);
export const TYPED_ORIGIN = 'human';
export const ENTRY_TYPE = Object.freeze({ user: 'user', assistant: 'assistant', attachment: 'attachment' });
// A prompt typed while a turn runs is queued: its transcript entry is an attachment that holds the text and the origin.
export const QUEUED_COMMAND = 'queued_command';
export const TEXT_PART = 'text';
// A turn is still running after a text when a tool call or a tool result follows it.
export const TURN_RUNNING_PARTS = Object.freeze(['tool_use', 'tool_result']);
// The ends of the transcript the hook reads for the last reply, small to large: one reply is far smaller, a typed
// request can be far back, and a whole transcript can pass 100 MB. The hook stops at the first one that holds a typed request.
export const TRANSCRIPT_TAIL_STEPS = Object.freeze([512 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024, 32 * 1024 * 1024]);
// The status line's note ends at its last ';', so the reminder carries none, in case a reader joins the two hooks' texts.
export const STATUS_ITEM_END = ';';
export const ITEM_END_STAND_IN = ',';

// check.mjs: the registry of text kept on purpose in more than one file (only the kit itself has it), the separator
// between a sibling repo and a path in it ('alfred-code:AGENTS.md'), and the words a failure to read the registry opens with.
export const COPIES_FILE = 'copies.json';
export const SITE_SEPARATOR = ':';
export const COPIES_UNREADABLE = `${COPIES_FILE} cannot be read`;
// check.mjs: where a kit keeps its skill sources, the file names a skill sits in there, and the lock path of a copied skill.
export const SHARED_SKILLS_FOLDER = 'shared/skills';
export const SKILL_FILE_NAMES = Object.freeze(['SKILL.md', 'SKILL.md.tmpl']);
export const LOCKED_SKILL_PATTERN = /^\.claude\/skills\/[^/]+\/SKILL\.md$/;
// check.mjs: the frontmatter of a skill and the house rule for its description - one line, this many characters at most.
export const FRONTMATTER_FENCE = '---';
export const DESCRIPTION_KEY = 'description:';
export const MAX_DESCRIPTION_LENGTH = 160;
export const DESCRIPTION_PROBLEM = Object.freeze({
    notOneLine: 'description is not on one line',
    missing: 'no description in the frontmatter',
});
// A YAML block scalar header ('>', '|-', '>+2') and a line that continues the key above it.
export const BLOCK_SCALAR_PATTERN = /^[>|][+-]?\d*$/;
export const CONTINUATION_PATTERN = /^[ \t]+\S/;
export const QUOTE_MARKS = Object.freeze(["'", '"']);

// What prove-plan.mjs adds to each file it writes into an expected folder, so that no test runner's pattern matches it.
export const EXPECTED_FILE_SUFFIX = '.expected';
