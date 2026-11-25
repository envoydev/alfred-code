'use strict';
// workspace-include: the named values of `workspace.js include`.

const STATE = Object.freeze({ included: 'included', setAside: 'set-aside', unasked: 'unasked' });
// The `subtree()` row state of a listed child whose folder is gone.
const ROW_GONE = 'gone';
const FLAG = Object.freeze({ include: '--include', setAside: '--set-aside', keep: '--keep' });
const NONE = 'none';
const STORE_KINDS = Object.freeze(['skill', 'agent', 'rule']);

const EXIT = Object.freeze({ ok: 0, failed: 1, usage: 2, locked: 3 });
const READ = Object.freeze({ off: 'off', notRoot: 'not-a-root', noChildren: 'no-children', garbage: 'garbage', ok: 'ok' });
const WRITE_WHY = Object.freeze({ locked: 'locked', garbage: 'garbage' });

const ERROR_PREFIX = '!! workspace: ';
const LINE = Object.freeze({
    off: 'include: off - ALFRED_CODE_WORKSPACE is 0',
    notRoot: 'include: not a root',
    noChildren: 'include: no children',
    noneAside: 'include: no child set aside',
    unattended: 'unattended: on',
    below: 'below',
});

// The one child path `subtree()` gives the top row, and the one the lists use for it.
const TOP_RELS = Object.freeze(['', '.']);
const MIN_BELOW_DEPTH = 2;
// The `subtree()` depth of a joined child of the root.
const CHILD_DEPTH = 1;

// A kept line: two words, one space. The category and the name are judged by the record's own ignore-entry rule.
const KEPT_LINE_RE = /^\S+ \S+$/;
const MARKDOWN_SUFFIX_RE = /\.md$/;
const MARKDOWN_KINDS = Object.freeze(['agent', 'rule']);

// A root hides a child's copy of a skill under `<child path>:<name>` (the name Claude Code lists it by), and names a link
// in the child's stamp `skills/<name>`.
const SKILL_KEY_JOIN = ':';
const SKILL_LINK_PREFIX = 'skills/';
const REL_JOIN = '/';
const RULE_CATEGORY = 'rule';

module.exports = { SKILL_KEY_JOIN, SKILL_LINK_PREFIX, REL_JOIN, RULE_CATEGORY, STATE, ROW_GONE, FLAG, NONE, STORE_KINDS, EXIT, READ, WRITE_WHY, ERROR_PREFIX, LINE, TOP_RELS, MIN_BELOW_DEPTH, CHILD_DEPTH, KEPT_LINE_RE, MARKDOWN_SUFFIX_RE, MARKDOWN_KINDS };
