'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The one log line that says where the agents come from on this route. Every seat is a copy now: on the plugin routes a
// picked seat sits in the store and is linked from `.claude/agents`, like a skill; on the full copy route it is a folder
// in `.claude/agents` itself. The copy route's seat files of an earlier, wider pick stay on disk, so its line counts
// the picked ones and names the rest.
function seatsLine({ viaPlugin, picked, earlier })
{
    if (viaPlugin) return `seats: ${picked} picked, copied per project and linked in .claude/agents - the plugin carries none (/alfred-code:status lists them)`;
    const head = `seats: copy route - ${picked} picked in .claude/agents`;
    return earlier > 0
        ? `${head}; ${earlier} earlier copies not picked stay there - the stack no longer updates them; delete a file to drop its seat`
        : head;
}

// The seats in the agents folder - a folder `<seat>`, or an older flat `<seat>.md` - each counted once per real path (a link and
// its target are one seat): `picked` for the ones this run picked, `earlier` for any other seat of the run's stack/agents. Two
// passes, so the order the folder lists never decides - a picked seat claims its real path before any other name is weighed. An
// entry that is no seat of the stack (the project's own agent) counts for nothing.
function countSeatFiles({ agentsDir, seatNames, pickedFiles })
{
    const stem = (file) => file.replace(/\.md$/, '');
    const real = (name) => { for (const file of [name, `${name}.md`]) { try { return fs.realpathSync(path.join(agentsDir, file)); } catch { /* try the other shape */ } } return null; };
    const claimed = new Set();
    for (const file of pickedFiles) { const at = real(stem(file)); if (at) claimed.add(at); }
    const picked = claimed.size;
    const isSeat = new Set(seatNames);
    let names = [];
    try { names = fs.readdirSync(agentsDir); } catch { /* no agents folder: nothing on disk */ }
    let earlier = 0;
    for (const name of new Set(names.map(stem)))
    {
        if (!isSeat.has(name)) continue;
        const at = real(name);
        if (at && !claimed.has(at)) { claimed.add(at); earlier++; }
    }
    return { picked, earlier };
}

module.exports = { seatsLine, countSeatFiles };
