// The pure parts of the read half of guard-cross-project-write.js (plan outside-workspace-reads): the named values, the
// glob prefix, the first-segment test of the project zone and the text of the prompt. A copied hook module (HOOK_MODULES):
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

module.exports = { READ_TOOLS, READ_PATHS_SHOWN, READ_BRANCH, globPrefix, firstSegmentApart, shownPath, readText };
