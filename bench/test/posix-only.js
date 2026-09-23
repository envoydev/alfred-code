'use strict';
// The harness runs where Claude Code's sandbox does - macOS and Linux (D4, D12 in the B2 plan) - and
// drive.js refuses Windows. Its process-level tests (process groups, signals, a spawned fake CLI) skip
// there with this reason, rather than pass by accident or fail on a platform nothing runs on.
const POSIX_ONLY = process.platform === 'win32' ? 'the benchmark harness runs on macOS and Linux only (D12)' : false;

module.exports = { POSIX_ONLY };
