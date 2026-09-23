'use strict';
// A tree removal that outlasts a concurrent writer: macOS Finder drops .DS_Store files into folders
// while they are being deleted, and one rmdir then fails ENOTEMPTY (measured in the B3 proof run,
// which lost its report to it). Node retries ENOTEMPTY / EBUSY / EPERM itself when asked to.
const fs = require('node:fs');

const removeTree = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

module.exports = { removeTree };
