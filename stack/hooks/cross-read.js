// The pure parts of the read half of guard-cross-project-write.js (plan outside-workspace-reads): the named values, the
// glob prefix, the first-segment test of the project zone, the words of a shell command that can name a path and the text
// of the prompt. A copied hook module (HOOK_MODULES):
// the guard requires it inside a try and reads nothing past the boundary without it. Nothing here touches the disk, the
// process or the environment - the guard hands in what it knows.
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const READ_PATHS_SHOWN = 3;
const READ_BRANCH = Object.freeze({ read: 'read-outside', search: 'search-outside' });
const READ_NEXT_STEP = 'Stay inside the workspace, or ask the user in chat why the files past it are needed before trying again - do not reach them by another command. The user can join that project to the workspace, or list it in ALFRED_CODE_ALLOW_WRITE_OUTSIDE.';
const READ_SEAT_STEP = "A subagent does not read outside its session's workspace: stop this step and say in your result which files past it you needed - the main session asks the user.";
const READ_GLOB_CHAR = /[*?[{]/;
const BARE_DRIVE = /^[A-Za-z]:$/;
// Folders under HOME that hold tools, not projects.
const TOOLCHAIN_SEGMENTS = Object.freeze(['go/pkg', 'miniconda3', 'anaconda3', 'miniforge3', 'snap', 'Android', 'flutter', 'sdk', 'development/flutter']);
// The folders the OS keeps apart from user work, by platform.
const OS_FOLDER = Object.freeze({ darwin: 'library', win32: 'appdata' });

// The shell route: at most 64 existing paths are judged per command, 512 words looked at and 8 carried scripts read (work,
// never time).
const SHELL_PATHS_MAX = 64;
const SHELL_WORDS_MAX = 512;
const SHELL_SCRIPTS_MAX = 8;
const PROSE_VERBS = new Set(['echo', 'printf']);
// The flags whose value is a sentence for a person: a commit message, a PR title or body. `-F` names the message file of a
// git commit or tag only; for tail, ls and less it is a plain flag.
const PROSE_FLAGS = new Set(['-m', '--message', '--body', '--title', '--notes', '--description', '--subject']);
const GIT_MESSAGE_FILE_FLAG = '-F';
const GIT_MESSAGE_VERBS = new Set(['commit', 'tag']);
// A verb whose first plain word is its pattern, never a root, unless a flag gives the pattern (`pattern`: its value is the
// pattern) or means there is none (`none`). `file` names a file of patterns, read like any file. `values` are the flags
// that take the next word, one set for each verb.
const EQ_PATTERN = /^(?:-e|--regexp)$/;
const EQ_FILE = /^(?:-f|--file)$/;
const GREP_FLAGS = Object.freeze({ pattern: EQ_PATTERN, file: EQ_FILE, none: null, values: new Set(['-A', '-B', '-C', '-m', '-d', '-D', '--include', '--exclude', '--exclude-dir',
  '--exclude-from', '--max-count', '--context', '--after-context', '--before-context', '--label', '--binary-files', '--devices', '--directories']) });
const RG_FLAGS = Object.freeze({ pattern: EQ_PATTERN, file: EQ_FILE, none: /^--(?:files|type-list)$/, values: new Set(['-A', '-B', '-C', '-m', '-g', '-t', '-T', '-j', '-d', '-M', '-E', '-r',
  '--glob', '--iglob', '--type', '--type-not', '--max-filesize', '--color', '--threads', '--context', '--max-depth', '--max-count', '--after-context', '--before-context', '--replace',
  '--engine', '--encoding', '--path-separator', '--pre', '--pre-glob', '--sort', '--sortr', '--max-columns', '--ignore-file', '--type-add', '--type-clear', '--colors']) });
// ag and ack: `-g` takes a file-name pattern in place of the search pattern, and `-f` is no file flag - ack's `-f` lists the
// files it would search, with no pattern at all.
const AG_FLAGS = Object.freeze({ pattern: /^-g$/, file: null, none: null, values: new Set(['-A', '-B', '-C', '-G', '-m', '-p', '-W', '--depth', '--ignore', '--ignore-dir',
  '--file-search-regex', '--path-to-ignore', '--workers', '--pager', '--max-count']) });
const ACK_FLAGS = Object.freeze({ pattern: /^-g$/, file: null, none: /^-f$/, values: new Set(['-A', '-B', '-C', '-m', '-t', '--ignore-dir', '--ignore-file', '--type', '--max-count',
  '--after-context', '--before-context', '--context', '--pager']) });
const PATTERN_VERBS = new Map([['grep', GREP_FLAGS], ['egrep', GREP_FLAGS], ['fgrep', GREP_FLAGS], ['rg', RG_FLAGS], ['ag', AG_FLAGS], ['ack', ACK_FLAGS]]);
const SHORT_CLUSTER = /^-[A-Za-z]{2,}$/;
// A verb whose every plain word is a root it walks, and the ones that walk only with a recursion flag.
const ROOT_VERBS = new Set(['fd', 'fdfind', 'tree', 'du', 'locate', 'plocate']);
const LISTING_VERB = /^(?:ls|dir|gci|get-childitem)$/i;
// `-R` and `--recursive` are case-sensitive (`ls -r` reverses the sort). PowerShell's own `-Recurse` and `-r` fold case: for
// `gci` and `Get-ChildItem` anywhere, and for `ls` and `dir` (its aliases) when the call runs under the PowerShell tool.
const RECURSE_FLAG = /^(?:-R|--recursive)$/;
const POWERSHELL_RECURSE_FLAG = /^-(?:r|recurse)$/i;
const POWERSHELL_LISTING_VERB = /^(?:gci|get-childitem)$/i;
const FIND_VERBS = new Set(['find', 'gfind']);
// Where find's roots end: its first test, action or group.
// find's own leading options, which come before its roots.
const FIND_OPTION = /^-[HLP]$/;
const FIND_EXPRESSION = /^(?:-.*|\(|\\\(|!)$/;
// A runtime or shell whose script words are searched for a path, and a database client whose every argument is.
const SCRIPT_VERB = /^(?:node(?:js)?|deno|bun|python[\d.]*|py|ruby|perl|php|pwsh|powershell|sh|bash|zsh|dash|ksh|eval)$/;
// A word of a script, not a file name: it holds a blank, a quote or a paren.
const SCRIPT_TEXT = /[\s'"(]/;
const DATABASE_VERB = /^(?:sqlite3?|duckdb|psql)$/;
const QUOTED_TILDE = /^["']/;
const EXPLICIT_PATH = /^(?:[~/]|\.\.[/\\])/;
const WIN_ABS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const PATH_IN_TEXT = /(?<![\w.~/\\:-])(?:~[\\/]|\$\{?(?:HOME|USERPROFILE)\}?[\\/]|[A-Za-z]:[\\/]|\/)[^\s'"`;,)<>|&]+/g;
const POWERSHELL_TOOL = /^PowerShell$/i;
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

// The flag a word stands for: a short cluster (`-rf`) ends in the flag that may take a value, `--file=x` is `--file`.
const flagOf = (text) => (SHORT_CLUSTER.test(text) ? `-${text.slice(-1)}` : text.startsWith('--') ? text.split('=')[0] : text);

// The words of one command word's own arguments that can name a path, as { word, text, search } - `search` marks a root a
// search verb walks. A pattern, a sentence flag's value and a quoted `~` (a literal name to the shell) are no path.
function argEntries(name, words, dequote, powershell) {
  const out = [];
  const texts = words.map((word) => dequote(word.raw));
  const keep = (at, text, search) => { if (!(QUOTED_TILDE.test(words[at].raw) && text.startsWith('~'))) out.push({ word: words[at], text, search }); };
  const finds = FIND_VERBS.has(name);
  const spec = PATTERN_VERBS.get(name) || null;
  const messageFile = name === 'git' && texts.some((text) => GIT_MESSAGE_VERBS.has(text));
  const recurses = (text) => RECURSE_FLAG.test(text) || ((powershell || POWERSHELL_LISTING_VERB.test(name)) && POWERSHELL_RECURSE_FLAG.test(text));
  const walks = ROOT_VERBS.has(name) || (LISTING_VERB.test(name) && texts.some(recurses));
  const patternGiven = (text) => { const flag = flagOf(text); return spec.pattern.test(flag) || (spec.file && spec.file.test(flag)) || (spec.none && spec.none.test(flag)); };
  let needsPattern = spec !== null && !texts.some(patternGiven);
  let rootsEnded = false;
  let flagsEnded = false;
  for (let at = 0; at < words.length; at++) {
    const text = texts[at];
    const flag = flagOf(text);
    if (!flagsEnded && text === '--') { flagsEnded = true; continue; }
    if (!flagsEnded && spec && spec.pattern.test(flag) && !text.includes('=')) { at++; continue; }
    if (!flagsEnded && spec && spec.file && spec.file.test(flag) && !text.includes('=')) { if (at + 1 < words.length) keep(at + 1, texts[at + 1], false); at++; continue; }
    if (!flagsEnded && spec && spec.values.has(flag) && !text.includes('=')) { at++; continue; }
    if (!flagsEnded && !spec && (PROSE_FLAGS.has(text) || (messageFile && text === GIT_MESSAGE_FILE_FLAG))) { at++; continue; }
    if (!flagsEnded && text.startsWith('-')) {
      const eq = text.indexOf('=');
      if (finds && !FIND_OPTION.test(text)) rootsEnded = true;
      if (eq > 0 && spec && spec.file && spec.file.test(flag)) keep(at, text.slice(eq + 1), false);
      else if (eq > 0 && !spec && !PROSE_FLAGS.has(text.slice(0, eq))) out.push({ word: words[at], text: text.slice(eq + 1), search: false });
      continue;
    }
    if (needsPattern) { needsPattern = false; continue; }
    if (finds && !rootsEnded && FIND_EXPRESSION.test(text)) rootsEnded = true;
    keep(at, text, (finds && !rootsEnded) || spec !== null || walks);
  }
  return out;
}

// The words of a parsed shell command (shell-writes.js parseShell's `cmds`) that can name a path to read, in order, each
// { text, index, search, scanned }: the arguments of every command word - a wrapper's own options left out, so find's roots
// count when it runs another command with `-exec` - an input redirect's target, a here-string's text and each absolute,
// `~` or `$HOME` stretch inside a script word of a runtime or a database client's argument. `echo` and `printf` are
// skipped. `dequote` gives a word as the shell hands it on; `powershell` says the call runs under the PowerShell tool.
function shellCandidates(cmds, dequote, powershell = false) {
  const out = [];
  const push = (text, index, search, scanned) => { if (out.length < SHELL_WORDS_MAX) out.push({ text, index, search, scanned }); };
  const scanText = (text, index) => { for (const found of text.match(PATH_IN_TEXT) || []) push(found, index, false, true); };
  for (const cmd of cmds) {
    for (const redir of cmd.redirs) {
      const text = dequote(redir.target.raw);
      if (redir.op === '<' && !(QUOTED_TILDE.test(redir.target.raw) && text.startsWith('~'))) push(text, redir.target.s, false, false);
      else if (redir.op === '<<<') scanText(text, redir.target.s);
    }
    const { cands, words } = cmd;
    for (let k = 0; k < cands.length; k++) {
      const cand = cands[k];
      const next = cands[k + 1];
      if (PROSE_VERBS.has(cand.name) || (next && next.chain.includes(cand.name))) continue; // a wrapper's own words are no paths
      const own = words.slice(cand.at + 1, next ? next.at : words.length);
      const scripted = SCRIPT_VERB.test(cand.name);
      const database = DATABASE_VERB.test(cand.name);
      for (const entry of argEntries(cand.name, own, dequote, powershell)) {
        push(entry.text, entry.word.s, entry.search, false);
        if (database || (scripted && SCRIPT_TEXT.test(entry.text))) scanText(entry.text, entry.word.s);
      }
    }
  }
  return out;
}

// What a shell command reads past the boundary: [{ tool, path, search }]. `units` are the command and each script it
// carries, each { cmds, expandVars(text, at), anchorAt(at), texts } - `texts` the bodies a runtime is handed. `env` is
// what the guard knows: dequote, isVar, platform, tool, root (the project's), cwd, resolve(word, base), exists,
// key (the case fold), inZone(path) and searchZone(path). A word is a path by its own shape or, once a `cd` moved the
// anchor, by being any word; a glob is judged by the folder it starts in. Cheap tests first, the zone test last.
function shellReadHits(units, env) {
  const hits = [];
  const seen = new Set();
  let existing = 0;
  for (const unit of units) {
    const cands = shellCandidates(unit.cmds, env.dequote, POWERSHELL_TOOL.test(String(env.tool || '')));
    for (const body of unit.texts || []) for (const found of body.text.match(PATH_IN_TEXT) || []) cands.push({ text: found, index: body.index, search: false, scanned: true });
    for (const cand of cands) {
      if (existing >= SHELL_PATHS_MAX) return hits;
      const word = unit.expandVars(cand.text, cand.index);
      if (env.isVar(word)) continue;
      const base = unit.anchorAt(cand.index);
      if (!cand.scanned && !isExplicitPath(word, env.platform) && (!base || base === env.root)) continue;
      const fixed = READ_GLOB_CHAR.test(word) ? globPrefix(word) || '.' : word;
      const abs = env.resolve(fixed, base || env.cwd);
      if (seen.has(env.key(abs)) || !env.exists(abs)) continue;
      seen.add(env.key(abs));
      existing++;
      const search = cand.search && env.searchZone(abs);
      if (search || env.inZone(abs)) hits.push({ tool: env.tool, path: abs, search });
    }
  }
  return hits;
}

// The text of a call whose own block also reads past the boundary: the clause that says so first, before any path, so
// the prompt's first sentence keeps it, and the read verdict after it for the model.
const joinRead = (text, readVerdict) => `${READ_ALSO}${text.replace(/^Blocked: /, '')}\nAlso: ${readVerdict}`;

module.exports = { SHELL_PATHS_MAX, SHELL_SCRIPTS_MAX, isExplicitPath, shellCandidates, shellReadHits, joinRead, READ_TOOLS, READ_PATHS_SHOWN, READ_BRANCH, globPrefix, firstSegmentApart, shownPath, readText };
