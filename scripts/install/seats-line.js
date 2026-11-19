'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { stackSeat } = require('../derive-state.js');

const BACK_TO_PLUGIN = ' - /alfred-code:configure (Environment) moves them back into the plugin';

// The one log line that says where the agents come from on this route (the plugin carries them, or
// they were copied), so an absent .claude/agents after an update reads as the route, not as a loss. On the copy route the
// seat files of an earlier, wider pick stay on disk, so the line counts the picked ones and names the rest.
function seatsLine({ viaPlugin, coreSeats, switchedOff, picked, earlier })
{
    if (!viaPlugin)
    {
        const head = `seats: copy route - ${picked} picked in .claude/agents`;
        const line = earlier > 0
            ? `${head}; ${earlier} earlier copies not picked stay there - the stack no longer updates them; delete a file to drop its seat`
            : head;
        return `${line}${BACK_TO_PLUGIN}`;
    }
    return `seats: ${coreSeats - switchedOff} on from the alfred-code plugin, ${switchedOff} switched off in permissions.deny`
        + ' - no .claude/agents on this route (/alfred-code:status lists them)';
}

// How many of the core's seats the deny rows of the settings files switch off: each seat once, however many rows or files
// name it and whoever wrote them; a row for a seat the core does not ship, or one that is no seat row, counts for nothing.
function countSwitchedOff(denyRows, coreSeatNames)
{
    const shipped = new Set(coreSeatNames);
    return new Set((Array.isArray(denyRows) ? denyRows : []).map(stackSeat).filter((seat) => seat && shipped.has(seat))).size;
}

// The seat files in the agents folder, each counted once per real path (a link and its target are one seat): `picked` for
// the files this run picked, `earlier` for any other `<seat>.md` of the run's stack/agents. Two passes, so the order the
// folder lists never decides - a picked file claims its real path before any other name is weighed. A file that is no
// seat of the stack (the project's own agent) counts for nothing.
function countSeatFiles({ agentsDir, seatNames, pickedFiles })
{
    const real = (file) => { try { return fs.realpathSync(path.join(agentsDir, file)); } catch { return null; } };
    const claimed = new Set();
    for (const file of pickedFiles) { const at = real(file); if (at) claimed.add(at); }
    const picked = claimed.size;
    const isSeat = new Set(seatNames);
    let names = [];
    try { names = fs.readdirSync(agentsDir); } catch { /* no agents folder: nothing on disk */ }
    let earlier = 0;
    for (const file of names)
    {
        if (!file.endsWith('.md') || !isSeat.has(file.slice(0, -3))) continue;
        const at = real(file);
        if (at && !claimed.has(at)) { claimed.add(at); earlier++; }
    }
    return { picked, earlier };
}

module.exports = { seatsLine, countSwitchedOff, countSeatFiles };
