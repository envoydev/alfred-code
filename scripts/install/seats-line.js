'use strict';

const { stackSeat } = require('../derive-state.js');

// The one log line that says where the agents come from on this route (the plugin carries them, or
// they were copied), so an absent .claude/agents after an update reads as the route, not as a loss.
function seatsLine({ viaPlugin, coreSeats, switchedOff, copied })
{
    if (!viaPlugin) return `seats: ${copied} copied into .claude/agents`;
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

module.exports = { seatsLine, countSwitchedOff };
