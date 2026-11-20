'use strict';
// Whether a Bash command is one of the walk's own narrow forms on its run dir. Pure: the caller gives the run dir, the
// project dir, the plugin root, the script allowlist and the marker path.
const { ANY_CONTROL_RE, SHELL, WORD, GREP_FLAGS, GREP_QUIET_FLAGS, RM_FLAGS, PIPEFAIL, REPO_DIR, SESSION_FILE } = require('./constants.js');
const { parse } = require('./shell.js');
const { canon, resolveWord, isUnder, isStrictlyUnder, sepOf } = require('./paths.js');

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
    if (value.startsWith('-'))
    {
        const at = value.indexOf('=');
        if (at < 0) return true;
        value = value.slice(at + 1);
    }
    const resolved = resolveWord(value, base, state.win);
    return Boolean(resolved) && state.roots.some((root) => isUnder(resolved, root, state.win));
}

function isAllowedScript(word, base, state)
{
    const script = resolveIn(word, base, state);
    const prefix = `${state.repoDir}${sepOf(state.win)}`;
    if (!script || !script.startsWith(prefix)) return false;
    return state.scripts.has(script.slice(prefix.length).split(SHELL.segmentSplit).join('/'));
}

const isQuotedPattern = (word) => word.quote !== '' && word.value !== '' && !word.value.startsWith('-') && !word.label;

function isMainForm(command, base, state)
{
    const [head, ...rest] = command.words;
    if (head.quote !== '' || command.words.some((word) => word.label)) return false;
    if (head.value === WORD.node) return rest.length > 0 && isAllowedScript(rest[0], base, state) && rest.slice(1).every((word) => isSafeArg(word, base, state));
    if (head.value === WORD.cat) return rest.length > 0 && rest.every((word) => !word.value.startsWith('-') && isRunDirFile(word, base, state));
    if (head.value === WORD.head) return rest.length === 2 && SHELL.headCount.test(rest[0].value) && isRunDirFile(rest[1], base, state);
    if (head.value === WORD.grep) return rest.length === 3 && GREP_FLAGS.has(rest[0].value) && isQuotedPattern(rest[1]) && isRunDirFile(rest[2], base, state);
    return false;
}

function isRemoval(command, base, state)
{
    const [head, flags, dir, marker] = command.words;
    if (command.words.length !== 4 || command.out || command.err || head.quote !== '' || head.value !== WORD.rm || flags.value !== RM_FLAGS) return false;
    return resolveIn(dir, base, state) === state.runDir && state.marker !== null && resolveIn(marker, base, state) === state.marker;
}

function isSink(command, base, state)
{
    if (command.out || command.err) return false;
    const [head, ...rest] = command.words;
    if (head.quote !== '') return false;
    if (head.value === WORD.tee) return rest.length === 1 && isTarget(rest[0], base, state);
    return head.value === WORD.grep && rest.length === 2 && GREP_QUIET_FLAGS.has(rest[0].value) && isQuotedPattern(rest[1]);
}

const hasLabel = (command) => command.words.some((word) => word.label) || Boolean(command.out && command.out.label);

function isPipeline(element, base, state)
{
    const [first, ...sinks] = element.commands;
    if (element.commands.some(hasLabel)) return false;
    if (first.words[0].quote === '' && first.words[0].value === WORD.rm) return element.commands.length === 1 && isRemoval(first, base, state);
    if (!isMainForm(first, base, state)) return false;
    if (sinks.length) return !first.out && sinks.every((sink) => isSink(sink, base, state));
    return !first.out || isTarget(first.out, base, state);
}

const isWords = (element, words) => element.kind === 'pipeline' && element.commands.length === 1
    && element.commands[0].words.map((word) => word.value).join(' ') === words.join(' ') && !element.commands[0].out && !element.commands[0].err;

function isChangeDir(element, state)
{
    if (element.kind !== 'pipeline' || element.commands.length !== 1) return null;
    const command = element.commands[0];
    if (hasLabel(command) || command.out || command.err || command.words.length !== 2 || command.words[0].value !== WORD.cd) return null;
    const target = command.words[1].value;
    if (target.startsWith('/') || SHELL.driveStart.test(target)) return false;
    const resolved = resolveWord(target, state.cwd, state.win);
    return resolved && isUnder(resolved, state.cwd, state.win) ? resolved : false;
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
        if (elements.length < 2 || seps[0] !== '&&') return false;
        base = moved;
        from = 1;
    }
    return elements.slice(from).every((element) => element.kind === 'pipeline' && isPipeline(element, base, state));
}

function isEchoTail(element)
{
    if (element.kind !== 'pipeline' || element.commands.length !== 1) return false;
    const { words, out, err } = element.commands[0];
    return !out && !err && words.length === 2 && words[0].quote === '' && words[0].value === WORD.echo && Boolean(words[1].label);
}

function approvesForms(command, ctx)
{
    if (typeof command !== 'string' || !ctx || typeof ctx.runDir !== 'string' || typeof ctx.cwd !== 'string' || typeof ctx.pluginRoot !== 'string') return false;
    const text = command.replace(/\n+$/, '');
    if (!text || ANY_CONTROL_RE.test(text)) return false;
    const list = parse(text);
    if (!list) return false;
    const state = makeState(ctx);
    let { elements } = list;
    const { seps } = list;
    let first = 0;
    if (elements.length > 1 && isWords(elements[0], PIPEFAIL) && seps[0] === ';') first = 1;
    if (elements.length - first > 1 && isEchoTail(elements[elements.length - 1]) && seps[seps.length - 1] === ';') elements = elements.slice(0, -1);
    const body = elements.slice(first);
    return body.length > 0 && body.every((element) => (element.kind === 'group' ? isGroup(element.list, state) : isPipeline(element, state.cwd, state)));
}

module.exports = { approvesForms };
