'use strict';
// The named values of remove-nested (install/nested.js and nested-guard.js).

// Every path below the nested folder a removal step reads, writes or deletes through: a link at one, or one that resolves
// outside the folder, refuses the verb. The stamp's own file and the tool-ignore files its record names are added at the call.
const GUARDED_PATHS = Object.freeze([
    '.claude', '.claude/skills', '.claude/agents', '.claude/rules', '.claude/hooks', '.claude/settings.json', '.claude/settings.local.json',
    '.alfred', '.alfred/stack', '.alfred/stack/skills', '.alfred/stack/agents', '.alfred/stack/rules', '.mcp.json',
]);

const OUTSIDE_WHY = 'outside this folder';

module.exports = { GUARDED_PATHS, OUTSIDE_WHY };
