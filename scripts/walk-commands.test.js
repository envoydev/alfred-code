'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fenceBlocks, buildTable, isResolve } = require('./run-dir-gate/table.js');
const { approvesForms, approvesPluginRead } = require('./run-dir-gate/forms.js');
const { markerName } = require('./run-dir-gate/marker.js');
const { reachableFiles, walkFilesOf, commandsOf, isNotCall } = require('./run-dir-gate/calls.js');
const { PLACEHOLDER_RE, WALKS, BODY } = require('./run-dir-gate/constants.js');

const ROOT = path.join(__dirname, '..');
const MAX_PROMPTS_PER_WALK = 3;
const RUN_DIR = '/t/alfred-code.AbC123';
const RUN_DIR_WIN = 'C:\\t\\alfred-code.AbC123';
const PROJECT = '/p';
const PLUGIN_ROOT = '/plug';
const MARKER_PATH = `/t/${markerName(PROJECT)}`;
// A stand-in word is longer than one letter: `x:x` would read as a drive, and no real category or item is one letter.
const SAMPLE_WORD = 'item';
// A placeholder that stands for a value of a known shape is filled with a realistic one, so a word template that misses it shows.
const ACCOUNT_DIR = '/home/u/.claude';
const REALISTIC_SAMPLES = [['<KEY>=<value>', 'ALFRED_CODE_AUTO_COMPACT=1']];
// The workspace line prints the parent folder as a `..`-shaped path; a child one level and two levels below its parent.
const SHAPE_SAMPLES = { count: '2', scope: 'project', csv: 'web,node', phrase: 'item two' };
const PARENT_SAMPLES = ['..', '../..'];
const PARENT_CD = 'cd "<rel>"';
const CHILD_FILE = 'init-child.md';
// Wording of the opener block, removed when the walks began to name the run dir literally.
// The one prefix a call may carry besides its own words: on Git Bash for Windows, after a `MISSING <tool> on the Bash PATH` line.
// A conditional prefix, not a call: it sets a variable, so the rule above would refuse it, and it prompts.
const CONDITIONAL_PREFIXES = [
    { file: 'source-protocol.md', prefix: 'PATH="/usr/bin:/bin:/mingw64/bin:', why: 'the Windows PATH line: a later call carries it again only on Git Bash for Windows, and prompts' },
];
const PATH_LINE_STATEMENTS = ['the one case where a later call sets a variable', 'those calls prompt', 'Windows Git Bash only'];
const isConditionalPrefix = (command) => CONDITIONAL_PREFIXES.some((entry) => command.file.endsWith(entry.file) && command.text.startsWith(entry.prefix));
const RETIRED_WORDING = ['marker block', 'every later block', 're-reads the marker', 'opener block'];

// Commands that stay behind Claude Code's own prompt: they name no run dir, or they are not a form the gate reads.
// `walk` is the typed walk the prompt shows in; `prefix` starts the command as the body writes it.
const NO_RUN_DIR = 'names no run dir, so the gate has no run dir to check it against';
const NODE_EVAL = 'a node -e program, not a shipped script of the run dir';
const PROJECT_ENGINE = 'the project\'s own hook engine, not a script of the run dir\'s repo';
const EXPECTED_PROMPTS = [
    { walk: 'init', prefix: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/install/stamp.js" state .', why: 'the first call, before any run dir exists; both scripts are the plugin root\'s' },
    { walk: 'init', prefix: 'uname -s ; git rev-parse --show-toplevel ; pwd', why: NO_RUN_DIR },
    { walk: 'init', prefix: "node -e 'let v;try{v=(JSON.parse(", why: NODE_EVAL },
    { walk: 'configure', prefix: 'node .claude/hooks/docs.js status', why: PROJECT_ENGINE },
    { walk: 'configure', prefix: "node -e 'let v;try{v=(JSON.parse(", why: NODE_EVAL },
    { walk: 'update', prefix: 'printenv ALFRED_CODE_UNATTENDED', why: NO_RUN_DIR },
    { walk: 'validate', prefix: 'node .claude/hooks/docs.js status', why: PROJECT_ENGINE },
];

const readText = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const listed = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.md')).map((name) => `${dir}/${name}`);
const ASSIGNMENT = /(?:^|[;&|(]\s*)[A-Za-z_][A-Za-z0-9_]*=/;

const PLUGIN_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}';
const ALL_PLACEHOLDERS = new RegExp(PLACEHOLDER_RE.source, 'g');
const OPTION_MARKS = /[[\]]|\.\.\./g;
const CHOICE = /(\S+?)(?:\|\S+)+/g;

// The body writes a command as a template: `[--flag]` is an optional part, `a|b` a choice, `...` a repeat. The sample keeps
// each optional part, takes the first choice and drops the marks, outside quotes only.
function untemplated(command)
{
    let quote = '';
    return command.split(/(["'])/).map((part) =>
    {
        if (part === '"' || part === "'") { quote = quote === part ? '' : quote || part; return part; }
        return quote ? part : part.replace(OPTION_MARKS, '').replace(CHOICE, '$1');
    }).join('');
}

const withRealistic = (command) => REALISTIC_SAMPLES.reduce((text, [placeholder, sample]) => text.replaceAll(placeholder, sample), command);
const ACCOUNT_PLACEHOLDER = '<account dir>';
const standIn = (placeholder) => (placeholder === ACCOUNT_PLACEHOLDER ? ACCOUNT_DIR : SAMPLE_WORD);
// A placeholder filled by its shape: a csv is two names joined by a comma, a quoted one with a space is two words.
function byShape(placeholder, at, text)
{
    if (placeholder === ACCOUNT_PLACEHOLDER) return ACCOUNT_DIR;
    const name = placeholder.slice(1, -1);
    const quoted = /["']/.test(text[at - 1] || '');
    if (name === 'n') return SHAPE_SAMPLES.count;
    if (name === 'scope') return SHAPE_SAMPLES.scope;
    if (/csv/i.test(name)) return SHAPE_SAMPLES.csv;
    if (quoted && /\s/.test(name)) return SHAPE_SAMPLES.phrase;
    return SAMPLE_WORD;
}
const TOKEN_VALUES = [['$TMP_WIN', RUN_DIR_WIN], ['$TMP', RUN_DIR], ['$MARK', MARKER_PATH]];
const filled = (command, parent = PARENT_SAMPLES[0], sample = standIn, keepTokens = false) =>
{
    const text = untemplated(withRealistic(command.replaceAll(PARENT_CD, `cd "${parent}"`)).replace(new RegExp(ALL_PLACEHOLDERS.source, 'g'), (placeholder, at, whole) => sample(placeholder, at, whole)))
        .replaceAll(PLUGIN_ROOT_TOKEN, PLUGIN_ROOT);
    return keepTokens ? text : TOKEN_VALUES.reduce((out, [token, value]) => out.replaceAll(token, value), text);
};
// The same call as a model may write it: the run dir's tokens set first, the call keeping `$TMP` and `$MARK`.
const RUN_DIR_TOKEN = /\$TMP(?![A-Za-z0-9_])/;
const assigned = (run) => `${RUN_DIR_TOKEN.test(run) ? `TMP=${RUN_DIR}; ` : ''}${run.includes('$MARK') ? `MARK=${MARKER_PATH}; ` : ''}${run}`;

const bodyFiles = [...listed(BODY.commands), ...listed(BODY.references)].map((file) => ({ file, text: readText(file) }));
const texts = new Map(bodyFiles.map(({ file, text }) => [file, text]));
const walkFiles = new Map(WALKS.map((walk) => [walk, reachableFiles(walk, texts)]));
const allFiles = walkFilesOf(texts);
const table = buildTable(bodyFiles);
const ctx = { runDir: RUN_DIR, cwd: PROJECT, pluginRoot: PLUGIN_ROOT, scripts: table.scripts, markerPath: MARKER_PATH, accountDir: ACCOUNT_DIR, accountDirReal: ACCOUNT_DIR };

const collected = allFiles.flatMap((file) => commandsOf(file, texts.get(file), fenceBlocks(texts.get(file)))).map((command) => ({
    ...command,
    walks: WALKS.filter((walk) => walkFiles.get(walk).has(command.file)),
    runs: [...new Set(PARENT_SAMPLES.flatMap((parent) => [filled(command.text, parent), filled(command.text, parent, byShape)]))],
    assignedRuns: [...new Set(PARENT_SAMPLES.flatMap((parent) => [filled(command.text, parent, standIn, true), filled(command.text, parent, byShape, true)]))].map(assigned),
    child: command.file.endsWith(CHILD_FILE) || command.text.includes(PARENT_CD),
}));
const nonResolve = collected.filter((command) => !command.resolve && !isNotCall(command) && !isConditionalPrefix(command));
const isApproved = (run) => approvesForms(run, ctx) || approvesPluginRead(run, ctx);
const prompting = nonResolve.filter((command) => !command.runs.every(isApproved));
const promptingAssigned = nonResolve.filter((command) => !command.assignedRuns.every(isApproved));
const entryFor = (command, walk) => EXPECTED_PROMPTS.find((entry) => entry.walk === walk && command.text.startsWith(entry.prefix));

test('the walks name commands to check', () =>
{
    assert.ok(allFiles.length >= WALKS.length);
    assert.ok(nonResolve.length > 40, `only ${nonResolve.length} commands collected`);
    assert.ok(collected.some((command) => command.resolve), 'the resolve block is collected');
});

test('the resolve block is the one block the table knows', () =>
{
    const resolves = collected.filter((command) => command.resolve);
    assert.ok(resolves.length > 0);
    for (const command of resolves) assert.equal(isResolve(command.text, table), true, command.file);
});

test('no walk command outside the resolve block expands a variable or sets one', () =>
{
    const bad = nonResolve.filter((command) => command.runs.some((run) => run.includes('${') || run.includes('$(') || ASSIGNMENT.test(run)));
    assert.deepEqual(bad.map((command) => `${command.file}: ${command.text}`), []);
});

test('every walk command is a form the run-dir gate approves, or is listed in EXPECTED_PROMPTS', () =>
{
    const unlisted = [];
    for (const command of prompting) for (const walk of command.walks) if (!entryFor(command, walk)) unlisted.push(`${walk} | ${command.file}: ${command.text}`);
    assert.deepEqual(unlisted, []);
});

test('every EXPECTED_PROMPTS entry names a command that still prompts, and a reason', () =>
{
    for (const entry of EXPECTED_PROMPTS)
    {
        assert.ok(entry.why && entry.why.length > 0, entry.prefix);
        assert.ok(prompting.some((command) => command.walks.includes(entry.walk) && command.text.startsWith(entry.prefix)), `stale entry: ${entry.walk} | ${entry.prefix}`);
    }
});

test('no walk has more than the bar of prompting commands', () =>
{
    for (const walk of WALKS)
    {
        const entries = new Set(prompting.filter((command) => command.walks.includes(walk)).map((command) => entryFor(command, walk)).filter(Boolean));
        assert.ok(entries.size <= MAX_PROMPTS_PER_WALK, `${walk}: ${entries.size} entries - ${[...entries].map((entry) => entry.prefix).join(' | ')}`);
        console.log(`EXPECTED_PROMPTS ${walk}: ${entries.size}`);
    }
});

test('the child paths stay inside the bar too, and are counted apart', () =>
{
    for (const walk of ['init', 'configure'])
    {
        const walkCommands = prompting.filter((command) => command.walks.includes(walk));
        const entriesOf = (commands) => new Set(commands.map((command) => entryFor(command, walk)).filter(Boolean));
        const standalone = entriesOf(walkCommands.filter((command) => !command.child));
        const child = entriesOf(walkCommands);
        const childOnly = walkCommands.filter((command) => command.child).map((command) => command.text);
        assert.ok(child.size <= MAX_PROMPTS_PER_WALK, `${walk} child path: ${child.size} entries - ${[...child].map((entry) => entry.prefix).join(' | ')}`);
        assert.deepEqual(childOnly, [], `${walk}: a child-only call still prompts`);
        console.log(`EXPECTED_PROMPTS ${walk} standalone path: ${standalone.size}, child path: ${child.size}`);
    }
});

test('a parent read is approved for a parent one and two folders up, and the plugin-root reads are collected', () =>
{
    const parentReads = nonResolve.filter((command) => command.text.includes(PARENT_CD));
    assert.ok(parentReads.length >= 4, `${parentReads.length} parent reads collected`);
    for (const command of parentReads) assert.ok(command.runs.length >= PARENT_SAMPLES.length, command.text);
    const proseCats = nonResolve.filter((command) => command.text.startsWith('cat "${CLAUDE_PLUGIN_ROOT}/'));
    assert.ok(proseCats.length >= 4, `${proseCats.length} plugin-root reads collected`);
});

test('no walk body keeps the wording of the retired marker opener', () =>
{
    const stale = [];
    for (const file of allFiles)
    {
        const text = readText(file).replace(/\s+/g, ' ');
        for (const phrase of RETIRED_WORDING) if (text.includes(phrase)) stale.push(`${file}: ${phrase}`);
    }
    assert.deepEqual(stale, []);
});

test('the Windows PATH line is one named conditional prefix: stated as the one case a later call sets a variable, prompting, and Git Bash for Windows only', () =>
{
    const [entry] = CONDITIONAL_PREFIXES;
    const protocol = readText(`${BODY.references}/${entry.file}`).replace(/\s+/g, ' ');
    for (const statement of PATH_LINE_STATEMENTS) assert.ok(protocol.includes(statement), statement);
    const holders = allFiles.filter((file) => readText(file).includes(entry.prefix));
    assert.deepEqual(holders, [`${BODY.references}/${entry.file}`], 'the prefix is written in one body only');
    assert.equal(readText(holders[0]).split(entry.prefix).length - 1, 1, 'and written once there');
    assert.ok(!collected.some((command) => command.text.includes('PATH="')), 'the prefix is no collected call');
    assert.equal(isApproved(`${entry.prefix}$(/usr/bin/cygpath -u -p "$PATH")" ; node "${RUN_DIR}/repo/scripts/install/stamp.js" state .`), false);
    assert.equal(isApproved(`PATH=/usr/bin:/bin node "${RUN_DIR}/repo/scripts/install/stamp.js" state .`), false);
});

test('the same calls with the run dir\'s tokens set first prompt exactly where the literal calls do', () =>
{
    assert.deepEqual(promptingAssigned.map((command) => command.text), prompting.map((command) => command.text));
    const tokenCalls = nonResolve.filter((command) => command.assignedRuns.some((run) => run.startsWith('TMP=')));
    assert.ok(tokenCalls.length > 40, `only ${tokenCalls.length} calls carry a token`);
    for (const walk of WALKS)
    {
        const entries = new Set(promptingAssigned.filter((command) => command.walks.includes(walk)).map((command) => entryFor(command, walk)).filter(Boolean));
        console.log(`EXPECTED_PROMPTS ${walk} (tokens set first): ${entries.size}`);
        assert.ok(entries.size <= MAX_PROMPTS_PER_WALK, walk);
    }
});
