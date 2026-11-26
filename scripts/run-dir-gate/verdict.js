'use strict';
// The gate's verdict for one Bash call: allow the walk's own forms on this session's run dir, deny a run dir that is not the
// run's only on proof, and say nothing in every other case. Pure: the caller read the dirs and the marker.
const { CONTROL_RE, REASON, VERDICT, ALLOW_REASON, EVENT } = require('./constants.js');
const { sameDir } = require('./dirs.js');
const { isResolve } = require('./table.js');
const { approvesForms, approvesPluginRead } = require('./forms.js');

// A marker proves the run dir only when this user owns it and the dir it names holds this session's id. A dir counts only when
// such a marker names it, or - with no such marker - when it sits directly in the hook's temp dir, where the resolve block makes it.
const isTrusted = (marker, sessionId) => Boolean(marker) && marker.owned === true && marker.session !== '' && marker.session === sessionId;

// The marker's dir and a named dir are one dir when their real paths agree; with no real path read, their text decides.
const isMarkerDir = (dir, marker) => sameDir(dir.real || dir.path, marker.realDir || marker.dir) || sameDir(dir.raw, marker.dir);

function decide({ command, table, sessionId, dirs, marker, ctx })
{
    if (typeof command !== 'string') return VERDICT.silent;
    if (CONTROL_RE.test(command)) return VERDICT.silent;
    if (isResolve(command, table)) return VERDICT.allow;
    if ((!Array.isArray(dirs) || dirs.length === 0) && approvesPluginRead(command, ctx)) return VERDICT.allow;
    if (!sessionId || !Array.isArray(dirs) || dirs.length === 0) return VERDICT.silent;
    if (dirs.some((dir) => !dir.path || !dir.session)) return VERDICT.silent;
    const trusted = isTrusted(marker, sessionId);
    if (trusted && dirs.some((dir) => !isMarkerDir(dir, marker))) return { decision: VERDICT.deny, reason: REASON.wrongDir(marker.dir) }; // guard-ask: run-dir verdict, asked in emit
    if (!dirs.every((dir) => dir.owned && dir.session === sessionId && (trusted || dir.inTemp === true))) return VERDICT.silent;
    return approvesForms(command, ctx) ? VERDICT.allow : VERDICT.silent;
}

// The PreToolUse answer for a verdict, built fresh each call (a verdict is a shared frozen object); null says nothing.
function hookOutput(verdict)
{
    if (!verdict || !verdict.decision) return null;
    const reason = verdict.decision === VERDICT.deny ? verdict.reason : ALLOW_REASON; // guard-ask: run-dir verdict, asked in emit
    return { hookSpecificOutput: { hookEventName: EVENT, permissionDecision: verdict.decision, permissionDecisionReason: reason } };
}

module.exports = { decide, hookOutput };
