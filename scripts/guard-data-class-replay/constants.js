'use strict';

const FLAG = Object.freeze({ root: '--root', samples: '--samples', sampleLimit: '--sample-limit' });
const DEFAULT_ROOT_PARTS = Object.freeze(['.claude', 'projects']);
const DEFAULT_SAMPLE_LIMIT = 20;
const SAMPLE_CHARS = 140;
const TRANSCRIPT_EXT = '.jsonl';
const TOOL_USE_MARK = '"tool_use"';
const GIT_TIMEOUT_MS = 4000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const GIT_STATUS = Object.freeze({ notARepo: 128 });
const GIT_SAFE_ARGS = Object.freeze(['-c', 'core.fsmonitor=false']);
const TOOL = Object.freeze({ read: 'Read', webSearch: 'WebSearch', webFetch: 'WebFetch' });
const QUERY_GROUP = Object.freeze({ webSearch: 'WebSearch', webFetch: 'WebFetch', mcp: 'mcp' });
const ASK_BRANCHES = Object.freeze(['dump-size', 'dump-name', 'dump-pii', 'document-untracked', 'document-listed']);
const TRACKED_BRANCHES = Object.freeze(['dump-size', 'document-untracked']);
const FOUND_STATE = Object.freeze({ repo: 'repo', none: 'none', failed: 'failed', noText: 'noText' });
const SAMPLE_KIND = Object.freeze({ deny: 'deny', ask: 'ask' });

module.exports = {
  FLAG, DEFAULT_ROOT_PARTS, DEFAULT_SAMPLE_LIMIT, SAMPLE_CHARS, TRANSCRIPT_EXT, TOOL_USE_MARK, GIT_TIMEOUT_MS,
  GIT_MAX_BUFFER, GIT_STATUS, GIT_SAFE_ARGS, TOOL, QUERY_GROUP, ASK_BRANCHES, TRACKED_BRANCHES, FOUND_STATE, SAMPLE_KIND,
};
