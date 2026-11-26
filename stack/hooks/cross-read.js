// The pure parts of the read half of guard-cross-project-write.js (plan outside-workspace-reads): the named values, the
// glob prefix, the first-segment test of the project zone, the words of a shell command that can name a path and the text
// of the prompt. A copied hook module (HOOK_MODULES):
// the guard requires it inside a try and reads nothing past the boundary without it. Nothing here touches the disk, the
// process or the environment - the guard hands in what it knows.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const READ_PATHS_SHOWN = 3;
const READ_BRANCH = Object.freeze({ read: 'read-outside', search: 'search-outside' });
const READ_NEXT_STEP = 'Stay inside the workspace, or ask the user in chat why the files past it are needed before trying again - do not reach them by another command.';
const READ_SEAT_STEP = "A subagent does not read outside its session's workspace: stop this step and say in your result which files past it you needed - the main session asks the user.";
const READ_GLOB_CHAR = /[*?[{]/;
const BARE_DRIVE = /^[A-Za-z]:$/;
// Folders under HOME that hold tools, not projects.
const TOOLCHAIN_SEGMENTS = Object.freeze(['go/pkg', 'miniconda3', 'anaconda3', 'miniforge3', 'snap', 'Android', 'flutter', 'sdk', 'development/flutter']);
// The folders the OS keeps apart from user work, by platform.
const OS_FOLDER = Object.freeze({ darwin: 'library', win32: 'appdata' });

// The shell route: at most 64 existing paths are judged per command, and at most 512 words looked at (work, never time).
const SHELL_PATHS_MAX = 64;
const SHELL_WORDS_MAX = 512;
const PROSE_VERBS = new Set(['echo', 'printf']);
// The flags whose value is a sentence for a person: a commit message, a PR title or body.
const PROSE_FLAGS = new Set(['-m', '--message', '--body', '--title', '--notes', '--description', '--subject']);
const SEARCH_VERBS = new Set(['find', 'gfind', 'fd', 'fdfind', 'rg', 'grep', 'egrep', 'fgrep', 'ag', 'ack', 'tree']);
// A runtime or shell whose script words are searched for a path, and a database client whose every argument is.
const SCRIPT_VERB = /^(?:node(?:js)?|deno|bun|python[\d.]*|py|ruby|perl|php|pwsh|powershell|sh|bash|zsh|dash|ksh|eval)$/;
// A word of a script, not a file name: it holds a blank, a quote or a paren.
const SCRIPT_TEXT = /[\s'"(]/;
const DATABASE_VERB = /^(?:sqlite3?|duckdb|psql)$/;
const EXPLICIT_PATH = /^(?:[~/]|\.\.[/\\])/;
const WIN_ABS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const PATH_IN_TEXT = /(?<![\w.~/\\:-])(?:~[\\/]|[A-Za-z]:[\\/]|\/)[^\s'"`;,)<>|&]+/g;
const READ_ALSO = 'Blocked: this call also reads outside this workspace (No keeps the work workspace only) - ';

const foldsCase = (platform) => platform === 'win32' || platform === 'darwin';
const foldFor = (platform) => (foldsCase(platform) ? (text) => String(text).toLowerCase() : (text) => String(text));

// The segments of a glob pattern before its first glob character, as a path ('' when none leads it). A bare drive
// (`C:/**/*.db`) is the drive's root: `C:` alone names the drive's own working folder.
function globPrefix(pattern) {
  const segments = pattern.split(/[\\/]/);
  const fixed = [];
  for (const segment of segments) { if (READ_GLOB_CHAR.test(segment)) break; fixed.push(segment); }
  const prefix = fixed.join('/');
  if (BARE_DRIVE.test(prefix)) return `${prefix}\\`;
  return prefix || (segments[0] === '' ? '/' : '');
}

// Whether the first folders of a path under HOME (its segments, home-relative) are a dot-folder, the OS folder or a
// toolchain folder: not a project's work.
function firstSegmentApart(segments, platform) {
  const fold = foldFor(platform);
  const first = fold(segments[0] || '');
  if (first.startsWith('.') || first === OS_FOLDER[platform]) return true;
  const firstTwo = segments.slice(0, 2).map(fold).join('/');
  return TOOLCHAIN_SEGMENTS.map(fold).some((seg) => seg === first || seg === firstTwo);
}

// ~/... in a shown path, whichever spelling of HOME it starts with.
function shownPath(target, homes, platform) {
  const fold = platform === 'win32' ? (text) => text.toLowerCase() : (text) => text;
  const sep = platform === 'win32' ? '\\' : '/';
  for (const home of homes) {
    if (home && fold(target) === fold(home)) return '~';
    if (home && fold(target).startsWith(fold(home) + sep)) return `~${target.slice(home.length)}`;
  }
  return target;
}

// The prompt text: the first three paths with a count of the rest, then the next step for a session or a subagent. The
// words the user must see come before the paths (askOrBlock shows the first sentence).
function readText(hits, { boundary, homes, seat, platform }) {
  const names = hits.slice(0, READ_PATHS_SHOWN).map((hit) => shownPath(hit.path, homes, platform)).join(', ');
  const more = hits.length > READ_PATHS_SHOWN ? ` and ${hits.length - READ_PATHS_SHOWN} more` : '';
  return `${hits[0].tool} reads outside this workspace (it ends at ${shownPath(boundary, homes, platform)}) - No keeps the work workspace only: ${names}${more}. ` +
    `Approve only if you meant to look there.\n${seat ? READ_SEAT_STEP : READ_NEXT_STEP}`;
}

// Whether a word names a place by itself: absolute, `~`-rooted, reaching up with `..`, or a drive path on win32.
function isExplicitPath(raw, platform) {
  return EXPLICIT_PATH.test(raw) || raw === '..' || raw.includes('/../') || (platform === 'win32' && WIN_ABS_PATH.test(raw));
}

// The words of a parsed shell command (shell-writes.js parseShell's `cmds`) that can name a path to read, in order, each
// { text, index, search, scanned }: an argument of the command word (a sentence flag and its value left out, `echo` and
// `printf` skipped), an input redirect's target, and each absolute or `~` stretch inside a script word of a runtime or a
// database client's argument. `dequote` gives a word as the shell hands it on.
function shellCandidates(cmds, dequote) {
  const out = [];
  const push = (text, index, search, scanned) => { if (out.length < SHELL_WORDS_MAX) out.push({ text, index, search, scanned }); };
  for (const cmd of cmds) {
    for (const redir of cmd.redirs) if (redir.op === '<') push(dequote(redir.target.raw), redir.target.s, false, false);
    const verb = cmd.cands[cmd.cands.length - 1];
    if (!verb || PROSE_VERBS.has(verb.name)) continue;
    const search = SEARCH_VERBS.has(verb.name);
    const scripted = SCRIPT_VERB.test(verb.name);
    const database = DATABASE_VERB.test(verb.name);
    for (let at = 0; at < verb.args.length; at++) {
      const word = verb.args[at];
      const text = dequote(word.raw);
      if (PROSE_FLAGS.has(text)) { at++; continue; }
      if (text.startsWith('-')) {
        const eq = text.indexOf('=');
        if (eq > 0 && !PROSE_FLAGS.has(text.slice(0, eq))) push(text.slice(eq + 1), word.s, search, false);
        continue;
      }
      push(text, word.s, search, false);
      if (database || (scripted && SCRIPT_TEXT.test(text))) for (const found of text.match(PATH_IN_TEXT) || []) push(found, word.s, false, true);
    }
  }
  return out;
}

// The text of a call whose own block also reads past the boundary: the clause that says so first, before any path, so
// the prompt's first sentence keeps it, and the read verdict after it for the model.
const joinRead = (text, readVerdict) => `${READ_ALSO}${text.replace(/^Blocked: /, '')}\nAlso: ${readVerdict}`;

module.exports = { SHELL_PATHS_MAX, isExplicitPath, shellCandidates, joinRead, READ_TOOLS, READ_PATHS_SHOWN, READ_BRANCH, globPrefix, firstSegmentApart, shownPath, readText };
