'use strict';
// The run-dir gate's named values: the hook's name, the patterns that find and read a run dir, the reason texts, and the
// closed sets the walk's command forms are made of.
const HOOK_NAME = 'run-dir-gate';
const OFF_SWITCH = `ALFRED_CODE_HOOKS_OFF=${HOOK_NAME}`;
const TABLE_FILE = 'setup-plugin/hooks/protocol-blocks.json';
const GENERATED_BY = 'scripts/protocol-blocks.js';
const TABLE_NOTE = 'Generated: the hash of each spelling of the resolve block, and each script the four walks run from the snapshot with a template per mode - the positionals and the flag values the walk bodies write. Run `npm run protocol-blocks` after a block changes.';
const QUICK_REJECT = 'alfred-code.';
const ALLOW_REASON = 'a shipped alfred-code walk call on this run\'s dir, unchanged';
const HOOK_FILE = 'run-dir-gate.js';
const EVENT = 'PreToolUse';
const TOOL = 'Bash';
const BLOCK_BRANCH = 'wrong-run-dir';
const BLOCK_REASON_MAX = 200;

// An absolute literal path with no `$` in it that ends in `alfred-code.` plus six letters or digits.
const RUN_DIR_RE = /(?:^|[\s"'=])((?:\/|[A-Za-z]:[\\/])[^\s"'$`]*?alfred-code\.[A-Za-z0-9]{6})(?![A-Za-z0-9])/g;
// A control character bash reads as text, never as a line break - a lone CR above all.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const CARRIAGE_RETURN_RE = /\r/;
const ANY_CONTROL_RE = /[\u0000-\u001f\u007f]/;
// The one line only the resolve block holds: it writes the run marker.
const RESOLVE_LINE = 'printf \'%s\\n\' "$TMP" > "$MARK"';

const RESOLVE_AGAIN = 'Run the resolve block again and use the run dir its newest RESOLVED or REUSING line prints.';
const REASON = Object.freeze({
    resolveAgain: RESOLVE_AGAIN,
    wrongDir: (dir) => `This call names a run dir that is not this run's dir. This run's dir is ${dir}. ${RESOLVE_AGAIN} To switch this check off, set ${OFF_SWITCH}.`,
});

const BODY = Object.freeze({ commands: 'setup-plugin/commands', references: 'setup-plugin/references' });
const BODY_DIRS = Object.freeze([BODY.commands, BODY.references]);
const WALKS = Object.freeze(['init', 'update', 'configure', 'validate']);
// Reached by name, but a record or a handout the walk hands over, never a body the walk runs: its commands are prose.
const SKIPPED_REFERENCES = Object.freeze(new Set(['source-protocol-powershell.md', 'update-history.md', 'post-install.md']));
const REFERENCE_NAME = /references\/([a-z0-9-]+\.md)/g;
const SHELL_LANGS = Object.freeze(new Set(['bash', 'sh', 'shell']));
// A fence pairs with its own closer whatever its language, so a closer is never read as an opener.
const FENCE_RE = /^([ \t]*)```([^`\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
// A `<name>` the model fills in: a letter right after the `<`, so a redirect (`2>&1`, `< file`, `<<'EOF'`) is no placeholder.
const PLACEHOLDER_RE = /<[A-Za-z][^<>\n]*>/;
// A comment: from a `#` that opens a word to the line's end. A placeholder there is never run, so it is not judged.
const COMMENT_RE = /(^|[ \t])#.*$/gm;
const HASH = 'sha256';
// A script the walk runs from the snapshot: `"$TMP/repo/<path>.js"`, or the run dir written as a `<...>` placeholder.
// An inline code span: the walk's short commands sit there, prose around it never counts.
const INLINE_CODE_RE = /`([^`\n]+(?:\n[^`\n]+){0,3})`/g;
const LINE_BREAK_RE = /\s*\n\s*/g;
const SCRIPT_RE = /"(?:\$TMP|<[^<>"\n]+>)\/repo\/([A-Za-z0-9_./-]+\.js)"/g;

const OP = Object.freeze({
    and: '&&', or: '||', semi: ';', pipe: '|', open: '(', close: ')', redirect: '>', background: '&', stderrToOut: '2>&1',
});
const LIST_OPS = Object.freeze(new Set([OP.semi, OP.and, OP.or]));
const SINGLE_OPS = Object.freeze(new Set([OP.semi, OP.pipe, OP.open, OP.close, OP.redirect]));
const BOUNDARY_CHARS = Object.freeze(new Set([' ', OP.semi, OP.pipe, OP.background, OP.close, OP.redirect]));
const TOKEN = Object.freeze({ word: 'word', op: 'op' });
const KIND = Object.freeze({ pipeline: 'pipeline', group: 'group' });
const QUOTE = Object.freeze({ none: '', single: "'", double: '"' });
const FLAG = Object.freeze({ dash: '-', long: '--', assign: '=', shortLength: 2 });

const SHELL = Object.freeze({
    space: ' ',
    bareChar: /[A-Za-z0-9_./:@%+=,-]/,
    unsafeInDouble: /[$`!]|\\\\|\\$/,
    echoLabel: /^[A-Za-z0-9 -]+: \$\?$/,
    headCount: /^-[0-9]{1,4}$/,
    driveStart: /^[A-Za-z]:[\\/]/,
    msysDrive: /^\/([A-Za-z])(?:\/(.*))?$/,
    segmentSplit: /[\\/]+/,
    trailingNewlines: /\n+$/,
    home: '~',
    childPrefix: './',
    parentSegment: '..',
});

const PATH = Object.freeze({
    sep: Object.freeze({ win: '\\', posix: '/' }),
    backslashes: /\\/g,
    slashes: /\//g,
    trailingSlashes: /\/+$/,
    trailingSeps: /[\\/]+$/,
    endsWithSep: /[\\/]$/,
    driveRoot: /^[A-Za-z]:[\\/]$/,
    foldedDrive: /^([A-Za-z]):\/(.*)$/,
    foldedMsysDrive: /^\/([A-Za-z])\/(.*)$/,
});

const MARKER = Object.freeze({
    prefix: 'alfred-code-run.',
    suffix: '.path',
    sanitizedLength: 60,
    hashLength: 12,
    safeChar: /[A-Za-z0-9]/,
    replacement: '-',
    blobLabel: 'blob',
    hashAlgorithm: 'sha1',
    textEncoding: 'utf8',
    digestEncoding: 'hex',
});

const WIN32 = 'win32';

const EFFECTS = Object.freeze({
    textEncoding: 'utf8',
    markdownSuffix: '.md',
    tempFallback: '/tmp',
    tempDirKey: 'TMPDIR',
    dataPathKey: 'ALFRED_CODE_DATA_PATH',
    dataRoot: '.alfred',
    statisticsDir: 'statistics',
    blocksDir: 'hook-blocks',
    noSession: 'nosession',
    absoluteDataPath: /^(?:\/|[A-Za-z]:\/)/,
    unsafeSessionChar: /[^\w.-]/g,
    toolTimeoutMs: 5000,
    git: Object.freeze({ command: 'git', args: Object.freeze(['-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel']), noLocksKey: 'GIT_OPTIONAL_LOCKS', noLocks: '0' }),
    cygpath: Object.freeze({ command: 'cygpath', flag: '-w' }),
});

const VERDICT = Object.freeze({
    allow: Object.freeze({ decision: 'allow' }),
    deny: 'deny',
    silent: Object.freeze({ decision: null }),
});

const WORD = Object.freeze({
    node: 'node', cat: 'cat', grep: 'grep', head: 'head', rm: 'rm', tee: 'tee', cd: 'cd', echo: 'echo', set: 'set', update: 'update', scope: 'scope', here: '.',
});
// A parent read's `cd` target: one or more `..` segments joined by `/`, a trailing `/` allowed - the folder above, never a named one.
const ANCESTOR_TARGET_RE = /^\.\.(?:\/\.\.)*\/?$/;
// The two scripts a child flow runs in its parent's folder, and the flags that keep the installer call a read.
const PARENT_READ = Object.freeze({
    stamp: 'scripts/install/stamp.js',
    installer: 'scripts/install/alfred-code.js',
    source: '--source',
    planOut: '--plan-out',
    required: Object.freeze(['--installed-only', '--print-plan']),
});
// A command that starts like this can be a read of the plugin's own files, so the hook does not quit on it.
const PLUGIN_READ_START_RE = /^cat\s+"/;
// What a node call's arguments are made of. A word is a plain word, a quoted phrase after a phrase flag, or a path under the
// run dir or the project; a flag and a mode pass only when a walk body calls the script with it.
const ARG = Object.freeze({
    plainWord: /^[A-Za-z0-9._:@,=+-]+$/,
    phrase: /^[A-Za-z0-9._:@,=+-]+(?: [A-Za-z0-9._:@,=+-]+)*$/,
    longFlag: /^--[a-z][a-z0-9-]*$/,
    shortFlag: /^-[A-Za-z]$/,
    modeWord: /^[a-z][a-z0-9-]*$/,
    allDots: /^\.+$/,
    badPathChar: /[|;&<>*?[\]{}()]/,
    relativePath: /^(?:\.\/)?[A-Za-z0-9._:@,=+-]+(?:\/[A-Za-z0-9._:@,=+-]+)*$/,
    targetSegment: /^[A-Za-z0-9._-]+$/,
    cwdSegment: /^(?!\.+$)[A-Za-z0-9._-]+$/,
    passthrough: '--',
    noMode: '',
});
const OUTPUT_FLAGS = Object.freeze(new Set(['--out', '--emit', '--plan-out']));
const INSTALLER_MODES = Object.freeze(new Set(['install', 'update']));
// The words that start a node call in a body, and what ends its argument list.
const CALL = Object.freeze({
    head: /node\s+$/,
    stop: new Set([';', ')', '>', '&', '`', '\n']),
    brackets: Object.freeze({ open: /^\[+/, close: /(?:\]|\.\.\.)+$/ }),
    stderrToOut: '2>',
    continuation: '\\\n',
});
const PLUGIN_READ = Object.freeze({ dir: 'setup-plugin', suffix: '.md' });
const COLLECT = Object.freeze({
    // A span that opens with `;` or `&&` is the end of a call the prose says to append it to; it is judged on a stand-in call.
    appended: /^(?:;|&&)\s/,
    appendBase: 'node "$TMP/repo/scripts/install/stamp.js" state .',
    // An inline code span is a command when it opens with a command word and an argument, never a bare word or a phrase.
    commandSpan: new RegExp([
        String.raw`node\s+(?:["'$<.]|-e\s+'|\S+\.js\b)`, String.raw`cat\s+["'$<./]`, String.raw`grep\s+-[EF]\s`, String.raw`head\s+-\d`, String.raw`rm\s+-rf\s`,
        String.raw`uname\s`, 'pwd$', String.raw`printenv\s`, String.raw`git\s+(?:mv|rev-parse|status|diff|check-ignore|ls-files|rm|add)\b`,
        String.raw`set\s+-o\s+pipefail;\s\S`, String.raw`printf\s+'`, String.raw`\(\s*(?:cd|node)\s`,
    ].map((part) => `^${part}`).join('|')),
    scriptPlaceholder: /\/repo\/[^"\s]*<[^<>"\n]+>[^"\s]*\.js"/,
    commentLine: /^\s*#/,
    // A prose read of the plugin's own files: 'in ONE Bash `cat`', after the `${CLAUDE_PLUGIN_ROOT}/...` paths it names.
    proseCat: /in one Bash `cat`/gi,
    pluginPath: /\$\{CLAUDE_PLUGIN_ROOT\}\/[^\s`"')]+/g,
    proseWindow: 500,
    paragraphBreak: /\n\n|\n(?:[-*]|\d+\.) /,
    trailingPunctuation: /[.,;:]+$/,
});
// Inline spans that open like a command but are text the walk hands the user or warns against; no walk call runs them.
const NOT_CALLS = Object.freeze([
    { file: 'update-walk.md', prefix: 'git mv <to>/<entry>', why: 'the move line the close tells the user, to move a docs entry back' },
    { file: 'update-close.md', prefix: 'git mv', why: 'names how the installer renamed a file, no call' },
    { file: 'update-close.md', prefix: 'git status', why: 'the call the close forbids' },
    { file: 'source-protocol.md', prefix: 'node "$TMP/repo/scripts/install/alfred-code.js" <install|update|uninstall> [flags]', why: 'the installer call as a template; each real call is written with its own flags and its --source' },
    { file: 'init-bootstrap.md', prefix: `${COLLECT.appendBase} ; node <version> is under`, why: 'a quoted hud line the run prints, no call' },
    { file: 'update-close.md', prefix: 'node .claude/hooks/docs.js prune', why: 'the command the close names for the user to run' },
]);
// The kinds of value a table template names, and what the generator reads off a body's spelling.
const VALUE = Object.freeze({ literal: 'literal', word: 'word', phrase: 'phrase', runDir: 'runDir', cwdPath: 'cwdPath' });
const TEMPLATE = Object.freeze({
    tmpPrefix: '$TMP/',
    choiceSep: '|',
    segmentSep: '/',
    segmentPlaceholder: '[A-Za-z0-9._-]+',
    placeholderParts: /(<[A-Za-z][^<>\n]*>)/,
    regexSpecials: /[.*+?^${}()|[\]\\]/g,
    whitespace: /\s/,
    kinds: Object.freeze(new Set(Object.values(VALUE))),
});
const GREP_FLAGS = Object.freeze(new Set(['-E', '-F']));
const GREP_QUIET_FLAGS = Object.freeze(new Set(['-qE', '-qF']));
const RM_FLAGS = '-rf';
const PIPEFAIL = Object.freeze(['set', '-o', 'pipefail']);
const REPO_DIR = 'repo';
const SESSION_FILE = 'run-session';

module.exports = {
    BODY, WALKS, SKIPPED_REFERENCES, REFERENCE_NAME, COLLECT, NOT_CALLS,
    HOOK_NAME, OFF_SWITCH, TABLE_FILE, GENERATED_BY, TABLE_NOTE, QUICK_REJECT, ALLOW_REASON, HOOK_FILE, EVENT, TOOL, BLOCK_BRANCH, BLOCK_REASON_MAX, INLINE_CODE_RE, EFFECTS, RUN_DIR_RE, CONTROL_RE, CARRIAGE_RETURN_RE, ANY_CONTROL_RE, RESOLVE_LINE, REASON, BODY_DIRS, SHELL_LANGS,
    FENCE_RE, PLACEHOLDER_RE, COMMENT_RE, HASH, SCRIPT_RE, OP, LIST_OPS, SINGLE_OPS, BOUNDARY_CHARS, TOKEN, KIND, QUOTE, FLAG, SHELL, PATH, MARKER, WIN32, VERDICT, WORD, GREP_FLAGS, GREP_QUIET_FLAGS, RM_FLAGS, PIPEFAIL,
    REPO_DIR, SESSION_FILE, ANCESTOR_TARGET_RE, PARENT_READ, PLUGIN_READ_START_RE, ARG, OUTPUT_FLAGS, INSTALLER_MODES, CALL, PLUGIN_READ, LINE_BREAK_RE, VALUE, TEMPLATE,
};
