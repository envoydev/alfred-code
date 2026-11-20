'use strict';
// Whether a Bash command is one of the walk's own narrow forms on its run dir. Pure: the caller gives the run dir, the
// project dir, the plugin root, the script allowlist and the marker path.
const { ANY_CONTROL_RE, SHELL, OP, KIND, QUOTE, FLAG, WORD, GREP_FLAGS, GREP_QUIET_FLAGS, RM_FLAGS, PIPEFAIL, REPO_DIR, SESSION_FILE, ANCESTOR_TARGET_RE, PARENT_READ } = require('./constants.js');
const { parse } = require('./shell.js');
const { canon, resolveWord, isAbsoluteWord, ancestorOf, isUnder, isStrictlyUnder, sepOf } = require('./paths.js');

function makeState(ctx)
{
    const win = SHELL.driveStart.test(ctx.runDir);
    const sep = sepOf(win);
    const runDir = canon(ctx.runDir, win);
    const scripts = new Set(Array.from(ctx.scripts || [], (name) => (win ? name.toLowerCase() : name)));
    return {
        win,
        runDir,
        repoDir: `${runDir}${sep}${REPO_DIR}`,
        cwd: canon(ctx.cwd, win),
        roots: [runDir, canon(ctx.cwd, win), canon(ctx.pluginRoot, win)],
        scripts,
        marker: ctx.markerPath ? canon(ctx.markerPath, win) : null,
    };
}

const resolveIn = (word, base, state) => resolveWord(word.value, base, state.win);

function isTarget(word, base, state)
{
    const target = resolveIn(word, base, state);
    if (!target || !isStrictlyUnder(target, state.runDir, state.win) || isUnder(target, state.repoDir, state.win)) return false;
    return target.split(sepOf(state.win)).pop() !== SESSION_FILE;
}

function isRunDirFile(word, base, state)
{
    const file = resolveIn(word, base, state);
    return Boolean(file) && isStrictlyUnder(file, state.runDir, state.win);
}

function isSafeArg(word, base, state)
{
    let value = word.value;
    if (value.startsWith(FLAG.long))
    {
        const at = value.indexOf(FLAG.assign);
        if (at < 0) return true;
        value = value.slice(at + 1);
    }
    else if (value.startsWith(FLAG.dash)) return value.length <= FLAG.shortLength;
    const resolved = resolveWord(value, base, state.win);
    const roots = state.ancestor && !isAbsoluteWord(value, state.win) ? [...state.roots, state.ancestor] : state.roots;
    return Boolean(resolved) && roots.some((root) => isUnder(resolved, root, state.win));
}

function isAllowedScript(word, base, state)
{
    const script = resolveIn(word, base, state);
    const prefix = `${state.repoDir}${sepOf(state.win)}`;
    if (!script || !script.startsWith(prefix)) return false;
    return state.scripts.has(script.slice(prefix.length).split(SHELL.segmentSplit).join('/'));
}

const isScriptAt = (word, relative, base, state) => state.scripts.has(state.win ? relative.toLowerCase() : relative) && resolveIn(word, base, state) === `${state.repoDir}${sepOf(state.win)}${relative.split('/').join(sepOf(state.win))}`;

function valueAfter(words, flag)
{
    const at = words.findIndex((word) => word.value === flag);
    return at < 0 || words.some((word, index) => index > at && word.value === flag) ? null : words[at + 1] || null;
}

// An installer call names its snapshot once, and it is this run's: an `--source=<path>` or a second `--source` would swap it for
// a folder the walk never made, and no `--flag=value` spelling passes an installer form at all.
function pinsSource(args, base, state)
{
    if (args.some((word) => word.value.startsWith(FLAG.long) && word.value.includes(FLAG.assign))) return false;
    const source = valueAfter(args, PARENT_READ.source);
    return Boolean(source) && resolveIn(source, base, state) === state.repoDir;
}

const isQuotedPattern = (word) => word.quote !== QUOTE.none && word.value !== '' && !word.value.startsWith(FLAG.dash) && !word.label;

function isMainForm(command, base, state)
{
    const [head, ...rest] = command.words;
    if (head.quote !== QUOTE.none || command.words.some((word) => word.label)) return false;
    if (head.value === WORD.node)
    {
        if (rest.length === 0 || !isAllowedScript(rest[0], base, state) || !rest.slice(1).every((word) => isSafeArg(word, base, state))) return false;
        return !isScriptAt(rest[0], PARENT_READ.installer, base, state) || pinsSource(rest.slice(1), base, state);
    }
    if (head.value === WORD.cat) return rest.length > 0 && rest.every((word) => !word.value.startsWith(FLAG.dash) && isRunDirFile(word, base, state));
    if (head.value === WORD.head) return rest.length === 2 && SHELL.headCount.test(rest[0].value) && isRunDirFile(rest[1], base, state);
    if (head.value === WORD.grep) return rest.length === 3 && GREP_FLAGS.has(rest[0].value) && isQuotedPattern(rest[1]) && isRunDirFile(rest[2], base, state);
    return false;
}

function isRemoval(command, base, state)
{
    const [head, flags, dir, marker] = command.words;
    if (command.words.length !== 4 || command.out || command.err || head.quote !== QUOTE.none || head.value !== WORD.rm || flags.value !== RM_FLAGS) return false;
    return resolveIn(dir, base, state) === state.runDir && state.marker !== null && resolveIn(marker, base, state) === state.marker;
}

function isSink(command, base, state)
{
    if (command.out || command.err) return false;
    const [head, ...rest] = command.words;
    if (head.quote !== QUOTE.none) return false;
    if (head.value === WORD.tee) return rest.length === 1 && isTarget(rest[0], base, state);
    return head.value === WORD.grep && rest.length === 2 && GREP_QUIET_FLAGS.has(rest[0].value) && isQuotedPattern(rest[1]);
}

const hasLabel = (command) => command.words.some((word) => word.label) || Boolean(command.out && command.out.label);

function isPipeline(element, base, state)
{
    const [first, ...sinks] = element.commands;
    if (element.commands.some(hasLabel)) return false;
    if (first.words[0].quote === QUOTE.none && first.words[0].value === WORD.rm) return element.commands.length === 1 && isRemoval(first, base, state);
    if (!isMainForm(first, base, state)) return false;
    if (sinks.length) return !first.out && sinks.every((sink) => isSink(sink, base, state));
    return !first.out || isTarget(first.out, base, state);
}

const isWords = (element, words) => element.kind === KIND.pipeline && element.commands.length === 1
    && element.commands[0].words.map((word) => word.value).join(SHELL.space) === words.join(SHELL.space) && !element.commands[0].out && !element.commands[0].err;

// A `cd` element: null when the element is no `cd`, false for one the gate refuses, else where it goes. A child folder is
// `./<dir under cwd>`; a parent read goes up by `..` segments only, and then carries `ancestor`.
function isChangeDir(element, state)
{
    if (element.kind !== KIND.pipeline || element.commands.length !== 1) return null;
    const command = element.commands[0];
    if (hasLabel(command) || command.out || command.err || command.words.length !== 2 || command.words[0].value !== WORD.cd) return null;
    const [, word] = command.words;
    if (word.quote !== QUOTE.double) return false;
    if (ANCESTOR_TARGET_RE.test(word.value)) return { base: ancestorOf(word.value, state.cwd, state.win), ancestor: true };
    if (!word.value.startsWith(SHELL.childPrefix)) return false;
    const resolved = resolveWord(word.value, state.cwd, state.win);
    return resolved && isUnder(resolved, state.cwd, state.win) ? { base: resolved, ancestor: false } : false;
}

// The installer as a read of the parent: `update ... --installed-only --print-plan` over this run's snapshot, its read-back
// written under the run dir. Nothing else of the installer passes.
function isInstallerRead(command, base, state)
{
    const args = command.words.slice(2);
    if (args[0].value !== WORD.update || !pinsSource(args, base, state)) return false;
    if (!PARENT_READ.required.every((flag) => args.some((word) => word.value === flag))) return false;
    const planOut = valueAfter(args, PARENT_READ.planOut);
    if (!planOut || !isTarget(planOut, base, state)) return false;
    if (command.out && !isTarget(command.out, base, state)) return false;
    return args.slice(1).every((word) => isSafeArg(word, base, state));
}

// The one command a parent read may run in the folder above: the scope read, or the installer as a read.
function isParentRead(element, base, state)
{
    if (element.kind !== KIND.pipeline || element.commands.length !== 1) return false;
    const [command] = element.commands;
    const [head, script, ...rest] = command.words;
    if (hasLabel(command) || head.quote !== QUOTE.none || head.value !== WORD.node || !script) return false;
    const inner = { ...state, ancestor: base };
    if (isScriptAt(script, PARENT_READ.stamp, base, state))
        return rest.length === 2 && rest[0].value === WORD.scope && rest[1].value === WORD.here && !command.out && !command.err;
    return isScriptAt(script, PARENT_READ.installer, base, state) && rest.length > 0 && isInstallerRead(command, base, inner);
}

function isGroup(list, state)
{
    const { elements, seps } = list;
    let base = state.cwd;
    let from = 0;
    const moved = isChangeDir(elements[0], state);
    if (moved === false) return false;
    if (moved)
    {
        if (elements.length < 2 || seps[0] !== OP.and) return false;
        if (moved.ancestor) return elements.length === 2 && isParentRead(elements[1], moved.base, state);
        base = moved.base;
        from = 1;
    }
    return elements.slice(from).every((element) => element.kind === KIND.pipeline && isPipeline(element, base, state));
}

function isEchoTail(element)
{
    if (element.kind !== KIND.pipeline || element.commands.length !== 1) return false;
    const { words, out, err } = element.commands[0];
    return !out && !err && words.length === 2 && words[0].quote === QUOTE.none && words[0].value === WORD.echo && Boolean(words[1].label);
}

function approvesForms(command, ctx)
{
    if (typeof command !== 'string' || !ctx || typeof ctx.runDir !== 'string' || typeof ctx.cwd !== 'string' || typeof ctx.pluginRoot !== 'string') return false;
    const text = command.replace(SHELL.trailingNewlines, '');
    if (!text || ANY_CONTROL_RE.test(text)) return false;
    const list = parse(text);
    if (!list) return false;
    const state = makeState(ctx);
    let { elements } = list;
    const { seps } = list;
    let first = 0;
    if (elements.length > 1 && isWords(elements[0], PIPEFAIL) && seps[0] === OP.semi) first = 1;
    if (elements.length - first > 1 && isEchoTail(elements[elements.length - 1]) && seps[seps.length - 1] === OP.semi) elements = elements.slice(0, -1);
    const body = elements.slice(first);
    return body.length > 0 && body.every((element) => (element.kind === KIND.group ? isGroup(element.list, state) : isPipeline(element, state.cwd, state)));
}

// A `cat` of double-quoted files under the plugin's own folder, nothing else: no flag, no redirect, no second command. It names
// no run dir, so the verdict asks for it apart from `approvesForms`.
function approvesPluginRead(command, ctx)
{
    if (typeof command !== 'string' || !ctx || typeof ctx.pluginRoot !== 'string' || ctx.pluginRoot === '') return false;
    const text = command.replace(SHELL.trailingNewlines, '');
    if (!text || ANY_CONTROL_RE.test(text)) return false;
    const list = parse(text);
    if (!list || list.elements.length !== 1 || list.elements[0].kind !== KIND.pipeline || list.elements[0].commands.length !== 1) return false;
    const { words, out, err } = list.elements[0].commands[0];
    const [head, ...files] = words;
    if (out || err || head.quote !== QUOTE.none || head.value !== WORD.cat || files.length === 0) return false;
    const win = SHELL.driveStart.test(ctx.pluginRoot);
    const root = canon(ctx.pluginRoot, win);
    return files.every((word) =>
    {
        if (word.quote !== QUOTE.double || word.label || word.value.startsWith(FLAG.dash) || !isAbsoluteWord(word.value, win)) return false;
        const file = resolveWord(word.value, root, win);
        return Boolean(file) && isStrictlyUnder(file, root, win);
    });
}

module.exports = { approvesForms, approvesPluginRead };
