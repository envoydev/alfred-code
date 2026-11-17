'use strict';

// The one log line that says where the agents come from on this route (the plugin carries them, or
// they were copied), so an absent .claude/agents after an update reads as the route, not as a loss.
function seatsLine({ viaPlugin, coreSeats, switchedOff, copied })
{
    if (!viaPlugin) return `seats: ${copied} copied into .claude/agents`;
    return `seats: ${coreSeats - switchedOff} on from the alfred-code plugin, ${switchedOff} switched off in permissions.deny`
        + ' - no .claude/agents on this route (/alfred-code:status lists them)';
}

module.exports = { seatsLine };
