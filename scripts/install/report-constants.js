'use strict';
// The named values of the run report (install/report.js): the two closing lines of a project run.

const EVENT = Object.freeze({ added: 'added', updated: 'updated', removed: 'removed', kept: 'kept' });
// Names listed in a report line before it ends in `, ...`.
const NAME_CAP = 8;
const NAME_JOIN = ', ';
const NAME_OVERFLOW = '...';
const TOP_REL = '.';
// The seat deny rows of a run are ONE item in a report, so a list of dozens never hides the files behind `, ...`.
const DENY_KIND = 'deny';
const DENY_ITEM = (count) => `deny rows (${count})`;
const REPORT_PREFIX = 'report:';
const NEW_SESSION_LINE = 'new session needed: rule files and agents load when a session starts - start one (or /clear) to pick them up';
// A line a project's own run printed (`==> report: .: ...`), read by the cascade to relabel it with the child's path.
const REPORT_LINE_AT_TOP = /^==> report: \.: (.+)$/m;

module.exports = { EVENT, NAME_CAP, NAME_JOIN, NAME_OVERFLOW, TOP_REL, DENY_KIND, DENY_ITEM, REPORT_PREFIX, NEW_SESSION_LINE, REPORT_LINE_AT_TOP };
