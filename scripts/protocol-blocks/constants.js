'use strict';
// The protocol-block approval's named values: which bodies are read, which fences are shell, what marks a placeholder,
// how the shared opener is told apart, and where the table is written.
const BODY_DIRS = Object.freeze(['setup-plugin/commands', 'setup-plugin/references']);
const SHELL_LANGS = Object.freeze(new Set(['bash', 'sh', 'shell']));
// A fence pairs with its own closer whatever its language, so a closer is never read as an opener.
const FENCE_RE = /^([ \t]*)```([^`\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
// A `<name>` the model fills in: a letter right after the `<`, so a redirect (`2>&1`, `< file`, `<<'EOF'`) is no placeholder.
const PLACEHOLDER_RE = /<[A-Za-z][^<>\n]*>/;
// The one line only the per-call opener holds (source-protocol.md 'Every later call re-reads the marker').
// A comment: from a `#` that opens a word to the line's end. A placeholder there is never run, so it is not judged.
const COMMENT_RE = /(^|[ \t])#.*$/gm;
const OPENER_LINE = 'TMP=$(cat "$MARK" 2>/dev/null); if [ -z "$TMP" ]';
const TABLE_FILE = 'setup-plugin/hooks/protocol-blocks.json';
const HASH = 'sha256';
const GENERATED_BY = 'scripts/protocol-blocks.js';
const TABLE_NOTE = 'Generated: the hash of each fixed shell block in the setup bodies, and the opener every later call starts with. Run `npm run protocol-blocks` after a block changes.';
module.exports = { BODY_DIRS, SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, OPENER_LINE, TABLE_FILE, HASH, GENERATED_BY, TABLE_NOTE };
