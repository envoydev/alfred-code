'use strict';
const { TEST_FILE } = require('./constants.js');

// The `--tests` entries that are not a test file of the commit. run-tests.js takes an entry without `.js` for a flag's
// value and runs the whole suite, so a bare name cost a full 40-minute leg (2026-11-24).
function unknownTestFiles(list, committed)
{
    return list.filter((entry) => !TEST_FILE.test(entry) || !committed.has(entry));
}

module.exports = { unknownTestFiles };
