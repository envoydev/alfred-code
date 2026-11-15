// Copied into each repo as .claude/kit/constants.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// The named values kit-settings.mjs and status-hook.mjs share.

// What a dispatch accepts as its model.
export const MODELS = Object.freeze(['sonnet', 'opus', 'haiku', 'fable']);

export const VARIABLE = Object.freeze({
    passScore: 'KIT_PASS_SCORE',
    planModel: 'KIT_PLAN_MODEL',
    reviewModel: 'KIT_REVIEW_MODEL',
    implementModel: 'KIT_IMPLEMENT_MODEL',
    searchModel: 'KIT_SEARCH_MODEL',
    scoring: 'KIT_SCORING',
    autoRun: 'KIT_AUTO_RUN',
});

export const DEFAULT_PASS_SCORE = 90;
// The one role with no agent file to name its model: a search finds and reports, so the cheapest model does it.
export const DEFAULT_SEARCH_MODEL = 'haiku';
export const COMMITTED_SETTINGS = '.claude/settings.json';

export const SWITCH = Object.freeze({ on: 'on', off: 'off' });

export const SESSION_FILE = 'kit-session.md';
// The two modes a session can switch for itself, whatever the settings say. `line` opens the mode's lines in the
// session file, `names` are what a request may call it.
export const SESSION_SWITCHES = Object.freeze([
    Object.freeze({ line: 'Auto-run', names: Object.freeze(['auto run', 'auto-run', 'autorun', 'auto mode']) }),
    Object.freeze({ line: 'Scoring', names: Object.freeze(['scoring']) }),
]);
// The verbs that switch a mode when a request opens with one and the mode's name: 'turn off scoring'.
export const SWITCH_VERBS = Object.freeze({
    on: Object.freeze(['turn on', 'switch on', 'enable', 'start']),
    off: Object.freeze(['turn off', 'switch off', 'disable', 'stop']),
});
// The verbs whose 'on' or 'off' may follow the mode's name: 'turn scoring off'.
export const SPLIT_VERBS = Object.freeze(['turn', 'switch']);
