'use strict';

function snapshotSessionError(sourceDir, fileText, envSessionId)
{
    const recorded = typeof fileText === 'string' ? fileText.trim() : '';
    const current = typeof envSessionId === 'string' ? envSessionId.trim() : '';
    if (!recorded || !current || recorded === current) return null;
    return `error: --source ${sourceDir} is another session's snapshot - run the resolve block again`;
}

module.exports = { snapshotSessionError };
