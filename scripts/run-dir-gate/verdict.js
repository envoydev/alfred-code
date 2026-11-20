'use strict';
// The gate's verdict for one Bash call: allow the walk's own forms on this session's run dir, deny a run dir that is not the
// run's only on proof, and say nothing in every other case. Pure: the caller read the dirs and the marker.
const { CONTROL_RE, REASON, VERDICT, ALLOW_REASON, EVENT } = require('./constants.js');
const { sameDir } = require('./dirs.js');
const { isResolve } = require('./table.js');
const { approvesForms, approvesPluginRead } = require('./forms.js');

// A marker proves the run dir only when this user owns it and the dir it names holds this session's id.
const isTrusted = (marker, sessionId) => Boolean(marker) && marker.owned === true && marker.session !== '' && marker.session === sessionId;

const isMarkerDir = (dir, marker) => sameDir(dir.path, marker.dir) || sameDir(dir.raw, marker.dir);

function decide({ command, table, sessionId, dirs, marker, ctx })
{
    if (typeof command !== 'string') return VERDICT.silent;
    if (CONTROL_RE.test(command)) return VERDICT.silent;
    if (isResolve(command, table)) return VERDICT.allow;
    if ((!Array.isArray(dirs) || dirs.length === 0) && approvesPluginRead(command, ctx)) return VERDICT.allow;
    if (!sessionId || !Array.isArray(dirs) || dirs.length === 0) return VERDICT.silent;
    if (dirs.some((dir) => !dir.path || !dir.session)) return VERDICT.silent;
    if (isTrusted(marker, sessionId) && dirs.some((dir) => !isMarkerDir(dir, marker))) return { decision: VERDICT.deny, reason: REASON.wrongDir(marker.dir) };
    if (!dirs.every((dir) => dir.owned && dir.session === sessionId)) return VERDICT.silent;
    return approvesForms(command, ctx) ? VERDICT.allow : VERDICT.silent;
}

// The PreToolUse answer for a verdict, built fresh each call (a verdict is a shared frozen object); null says nothing.
function hookOutput(verdict)
{
    if (!verdict || !verdict.decision) return null;
    const reason = verdict.decision === VERDICT.deny ? verdict.reason : ALLOW_REASON;
    return { hookSpecificOutput: { hookEventName: EVENT, permissionDecision: verdict.decision, permissionDecisionReason: reason } };
}

module.exports = { decide, hookOutput };
