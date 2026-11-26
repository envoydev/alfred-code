'use strict';
// scan-evidence --children: the named values of the child-root scan.

const FLAG_CHILDREN = '--children';
// The value that names no child: the root is read alone. An empty value never passes the run-dir gate, so this word stands for it.
const NONE = 'none';
// The `root:` block's line for each project read as a child, then the project's folder.
const CHILD_LINE = 'child: ';
const ROW_OK = 'ok';
// The `subtree()` depth of a direct child of the root.
const DIRECT_DEPTH = 1;
const LIST_SEPARATOR = ',';
const PATH_SEPARATOR = '/';
const HIT_PRESENT = ' present';
const HIT_IN = ' in ';

module.exports = { FLAG_CHILDREN, NONE, CHILD_LINE, ROW_OK, DIRECT_DEPTH, LIST_SEPARATOR, PATH_SEPARATOR, HIT_PRESENT, HIT_IN };
