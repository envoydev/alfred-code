'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fenceBlocks, buildTable, isResolve } = require('./run-dir-gate/table.js');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { markerName } = require('./run-dir-gate/marker.js');
const { SHELL_LANGS, FENCE_RE, PLACEHOLDER_RE, RESOLVE_LINE } = require('./run-dir-gate/constants.js');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = 'setup-plugin/commands';
const REFERENCES_DIR = 'setup-plugin/references';
const WALKS = ['init', 'update', 'configure', 'validate'];
const SKIPPED_REFERENCE = 'source-protocol-powershell.md';
// Reached by name, but a record or a handout the walk hands over, never a body the walk runs: its commands are prose.
const DOCUMENT_REFERENCES = ['update-history.md', 'post-install.md'];
const MAX_PROMPTS_PER_WALK = 3;
const RUN_DIR = '/t/alfred-code.AbC123';
const RUN_DIR_WIN = 'C:\\t\\alfred-code.AbC123';
const PROJECT = '/p';
const PLUGIN_ROOT = '/plug';
const MARKER_PATH = `/t/${markerName(PROJECT)}`;
const SAMPLE_WORD = 'x';
// An inline code span is a command when it opens with a command word and an argument, never a bare word or a phrase.
const COMMAND_SPAN = new RegExp([
    String.raw`node\s+(?:["'$<.]|-e\s+'|\S+\.js\b)`, String.raw`cat\s+["'$<./]`, String.raw`grep\s+-[EF]\s`, String.raw`head\s+-\d`, String.raw`rm\s+-rf\s`,
    String.raw`uname\s`, 'pwd$', String.raw`printenv\s`, String.raw`git\s+(?:mv|rev-parse|status|diff|check-ignore|ls-files|rm|add)\b`,
    String.raw`set\s+-o\s+pipefail;\s\S`, String.raw`printf\s+'`, String.raw`\(\s*(?:cd|node)\s`,
].map((part) => `^${part}`).join('|'));
// An inline span may wrap across up to four lines of a paragraph.
const WRAPPED_SPAN = /`([^`\n]+(?:\n[^`\n]+){0,3})`/g;
const SCRIPT_PLACEHOLDER = /\/repo\/[^"\s]*<[^<>"\n]+>[^"\s]*\.js"/;
const REFERENCE_NAME = /references\/([a-z0-9-]+\.md)/g;
const ASSIGNMENT = /(?:^|[;&|(]\s*)[A-Za-z_][A-Za-z0-9_]*=/;
const COMMENT_LINE = /^\s*#/;

// Inline spans that open like a command but are text the walk hands the user or warns against; no walk call runs them.
const NOT_CALLS = [
    { file: 'update-walk.md', prefix: 'git mv <to>/<entry>', why: 'the move line the close tells the user, to move a docs entry back' },
    { file: 'update-close.md', prefix: 'git mv', why: 'names how the installer renamed a file, no call' },
    { file: 'update-close.md', prefix: 'git status', why: 'the call the close forbids' },
    { file: 'update-close.md', prefix: 'node .claude/hooks/docs.js prune', why: 'the command the close names for the user to run' },
];

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
    { walk: 'update', prefix: 'node "$TMP/repo/scripts/install/stamp.js" state . ; cat "${CLAUDE_PLUGIN_ROOT}/', why: 'the cat reads the plugin root\'s file, outside the run dir' },
    { walk: 'update', prefix: 'printenv ALFRED_CODE_UNATTENDED', why: NO_RUN_DIR },
    { walk: 'validate', prefix: 'node .claude/hooks/docs.js status', why: PROJECT_ENGINE },
];

const readText = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const listed = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.md')).map((name) => `${dir}/${name}`);

function reachableFiles(walk)
{
    const seen = new Set([`${COMMANDS_DIR}/${walk}.md`]);
    const queue = [...seen];
    while (queue.length)
    {
        const file = queue.shift();
        for (const match of readText(file).matchAll(REFERENCE_NAME))
        {
            const next = `${REFERENCES_DIR}/${match[1]}`;
            if (match[1] === SKIPPED_REFERENCE || DOCUMENT_REFERENCES.includes(match[1]) || seen.has(next) || !fs.existsSync(path.join(ROOT, next))) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return seen;
}

const isResolveBlock = (body) => body.includes(RESOLVE_LINE);

function commandsOf(file)
{
    const text = readText(file);
    const found = [];
    for (const block of fenceBlocks(text))
    {
        if (!SHELL_LANGS.has(block.lang)) continue;
        if (isResolveBlock(block.body)) { found.push({ file, text: block.body, resolve: true }); continue; }
        for (const line of block.body.split('\n')) if (line.trim() && !COMMENT_LINE.test(line)) found.push({ file, text: line.trim(), resolve: false });
    }
    for (const span of text.replace(FENCE_RE, '').matchAll(WRAPPED_SPAN))
    {
        const flat = span[1].replace(/\s*\n\s*/g, ' ').trim();
        if (COMMAND_SPAN.test(flat) && !SCRIPT_PLACEHOLDER.test(flat)) found.push({ file, text: flat, resolve: false });
    }
    return found;
}

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

const filled = (command) => untemplated(command.replace(ALL_PLACEHOLDERS, SAMPLE_WORD))
    .replaceAll(PLUGIN_ROOT_TOKEN, PLUGIN_ROOT).replaceAll('$TMP_WIN', RUN_DIR_WIN).replaceAll('$TMP', RUN_DIR).replaceAll('$MARK', MARKER_PATH);

const bodyFiles = [...listed(COMMANDS_DIR), ...listed(REFERENCES_DIR)].map((file) => ({ file, text: readText(file) }));
const walkFiles = new Map(WALKS.map((walk) => [walk, reachableFiles(walk)]));
const allFiles = [...new Set([...walkFiles.values()].flatMap((files) => [...files]))].sort();
const table = buildTable(bodyFiles.filter((body) => !body.file.endsWith(SKIPPED_REFERENCE)));
const ctx = { runDir: RUN_DIR, cwd: PROJECT, pluginRoot: PLUGIN_ROOT, scripts: new Set(table.scripts), markerPath: MARKER_PATH };

const collected = allFiles.flatMap(commandsOf).map((command) => ({
    ...command,
    walks: WALKS.filter((walk) => walkFiles.get(walk).has(command.file)),
    run: filled(command.text),
}));
const isNotCall = (command) => NOT_CALLS.some((entry) => command.file.endsWith(entry.file) && command.text.startsWith(entry.prefix));
const nonResolve = collected.filter((command) => !command.resolve && !isNotCall(command));
const prompting = nonResolve.filter((command) => !approvesForms(command.run, ctx));
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
    const bad = nonResolve.filter((command) => command.run.includes('${') || command.run.includes('$(') || ASSIGNMENT.test(command.run));
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
