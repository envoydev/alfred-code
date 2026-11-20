'use strict';
// The gate's verdict for one Bash call: allow the walk's own forms on this session's run dir, deny a run dir that is not the
// run's only on proof, and say nothing in every other case. Pure: the caller read the dirs and the marker.
const { CONTROL_RE, REASON } = require('./constants.js');
const { sameDir } = require('./dirs.js');
const { isResolve } = require('./table.js');
const { approvesForms } = require('./forms.js');

const SILENT = Object.freeze({ decision: null });

// A marker proves the run dir only when the dir it names holds this session's id.
const isTrusted = (marker, sessionId) => Boolean(marker) && marker.session !== '' && marker.session === sessionId;

const isMarkerDir = (dir, marker) => sameDir(dir.path, marker.dir) || sameDir(dir.raw, marker.dir);

function decide({ command, table, sessionId, dirs, marker, ctx })
{
    if (typeof command !== 'string') return SILENT;
    if (isResolve(command, table)) return { decision: 'allow' };
    if (CONTROL_RE.test(command) || !sessionId || !Array.isArray(dirs) || dirs.length === 0) return SILENT;
    if (dirs.some((dir) => !dir.path || !dir.session)) return SILENT;
    if (isTrusted(marker, sessionId) && dirs.some((dir) => !isMarkerDir(dir, marker))) return { decision: 'deny', reason: REASON.wrongDir(marker.dir) };
    if (!dirs.every((dir) => dir.owned && dir.session === sessionId)) return SILENT;
    return approvesForms(command, ctx) ? { decision: 'allow' } : SILENT;
}

module.exports = { decide };
