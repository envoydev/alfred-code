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

export const SESSION_FILE = 'kit-session.md';
export const STOP_PHRASES = Object.freeze([
    Object.freeze({ starts: Object.freeze(['stop auto run', 'stop auto-run']), line: 'Auto-run: off' }),
    Object.freeze({ starts: Object.freeze(['stop scoring']), line: 'Scoring: off' }),
]);
