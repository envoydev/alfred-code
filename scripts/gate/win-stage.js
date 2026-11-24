'use strict';
const { WIN_STAGE } = require('./constants.js');

// The PowerShell that readies the VM for the win leg: a dead run's folders out (inside gate\ only), then the share's files
// copied into the leg folder on the guest's own disk - nothing runs from the share (Node 26 failed reading
// \\?\UNC\Mac\package.json there) - and exit 1 when the copy left no leg script.
function stageScript({ sweep, guestDir, leg })
{
    return [
        `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${sweep}'`,
        `New-Item -ItemType Directory -Force '${leg}' | Out-Null`,
        `Copy-Item -Recurse -Force '${guestDir}\\*' '${leg}'`,
        `if (-not (Test-Path '${leg}\\${WIN_STAGE.legScript}')) { exit 1 }`,
    ].join('; ');
}

module.exports = { stageScript };
