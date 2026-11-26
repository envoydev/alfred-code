'use strict';

// The ignore entries the project in `projectDir` records, read through the workspace reader. A folder with no record,
// a record that cannot be read and a missing folder all give no entry: the fit check then offers everything, as before.
function readIgnoresOf(projectDir)
{
    if (!projectDir) return [];
    try { return require('../install/workspace.js').readWorkspace(projectDir, { env: process.env }).view.ignores; }
    catch { return []; }
}

module.exports = { readIgnoresOf };
