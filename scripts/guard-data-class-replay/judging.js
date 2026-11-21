'use strict';
const judges = require('../../stack/hooks/guard-data-class.js');
const { TRACKED_BRANCHES } = require('./constants');

function readVerdict(facts) {
  return judges.dumpVerdict(facts) || judges.documentVerdict({ ext: facts.ext, tracked: facts.tracked, listed: false });
}

function needsTrackedCheck(verdict) {
  return verdict !== null && TRACKED_BRANCHES.includes(verdict.branch);
}

function wantsHead(ext) {
  return judges.TEXT_DATA_EXTS.includes(String(ext).toLowerCase());
}

function planQuery(text) {
  const tokens = judges.tokensOf(text);
  return { paths: judges.pathCandidates(tokens), names: judges.nameCandidates(tokens) };
}

function queryFindings(text, found) {
  return judges.egressFindings(text, found);
}

module.exports = { readVerdict, needsTrackedCheck, wantsHead, planQuery, queryFindings };
