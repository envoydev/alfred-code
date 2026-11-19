'use strict';
// No shipped bash block trips Claude Code's 'brace with quote character (expansion obfuscation)' check: a block that
// does asks the user to approve it in every mode but auto (the live /alfred-code:update walk stopped at the resolve
// block, 2026-11-19). The check, read from Claude Code 2.1.329: every '{' inside quotes or backticks is blanked, a
// comment is kept as written, then /\{[^}]*['"]/ - an unquoted '{' with a quote before the next '}' - asks. It reads a
// heredoc body as plain text, so JSON fed through `<<'EOF'` trips it; a single-quoted argument does not.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ASKS = /\{[^}]*['"]/g;
const SHELL_FENCES = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console']);
const WORD_END = new Set([' ', '\t', '\n', ';', '|', '&', '(', ')', '<', '>']);

function blankQuotedBraces(command)
{
    if (!command.includes('{')) return command;
    const out = [];
    let single = false, double = false, backtick = false, wordStart = true, at = 0;
    while (at < command.length)
    {
        const char = command[at];
        const next = command[at + 1];
        if (backtick)
        {
            if (char === '\\' && ['`', '\\', '$'].includes(next)) { out.push(char, next); at += 2; continue; }
            if (char === '`') backtick = false;
            out.push(char === '{' ? ' ' : char); at += 1;
        }
        else if (single)
        {
            if (char === "'") single = false;
            out.push(char === '{' ? ' ' : char); at += 1;
        }
        else if (double)
        {
            if (char === '\\' && ['"', '\\', '`'].includes(next)) { out.push(char, next); at += 2; continue; }
            if (char === '`') { backtick = true; out.push(char); at += 1; continue; }
            if (char === '"') double = false;
            out.push(char === '{' ? ' ' : char); at += 1;
        }
        else if (char === '\\' && at + 1 < command.length) { out.push(char, next); if (next !== '\n') wordStart = false; at += 2; }
        else if (char === '#' && wordStart) { while (at < command.length && command[at] !== '\n') out.push(command[at++]); wordStart = true; }
        else if (char === '`') { backtick = true; wordStart = false; out.push(char); at += 1; }
        else
        {
            if (char === "'") single = true;
            else if (char === '"') double = true;
            wordStart = WORD_END.has(char);
            out.push(char); at += 1;
        }
    }
    return out.join('');
}

// The same release asks before any assignment to a name that changes how later commands are found or run (its Wr set,
// read case-blind, plus the ld_, dyld_ and bash_func_ prefixes): 'PATH assignment alters command lookup/execution'.
// The live walk met it on the resolve block's Git Bash heal (2026-11-20).
const LOOKUP_NAMES = new Set(['path', 'home', 'dirstack', 'tmpprefix', 'bash_env', 'env', 'cdpath', 'globignore', 'shell', 'fpath',
    'bash_loadables_path', 'module_path', 'manpath', 'mailpath', 'readnullcmd', 'nullcmd', 'histfile', 'zdotdir', 'functions',
    'commands', 'aliases', 'galiases', 'saliases', 'bash_cmds', 'bash_aliases', 'execignore', 'bash_source_path', 'lang',
    'language', 'lc_all', 'lc_ctype', 'lc_collate', 'lc_messages', 'lc_numeric', 'lc_time', 'histchars', 'textdomain',
    'textdomaindir']);
const LOOKUP_PREFIXES = ['ld_', 'dyld_', 'bash_func_'];
const ASSIGNMENT = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)\+?=/gm;
const changesLookup = (name) => LOOKUP_NAMES.has(name.toLowerCase()) || LOOKUP_PREFIXES.some((p) => name.toLowerCase().startsWith(p));

// The command with every quoted character blanked, so only words the shell reads as words are left.
function unquoted(command)
{
    let quote = '';
    return [...command].map((char) =>
    {
        if (quote) { if (char === quote) quote = ''; return char === '\n' ? char : ' '; }
        if (char === "'" || char === '"') { quote = char; return ' '; }
        return char;
    }).join('');
}
const lookupAssignments = (command) => [...unquoted(command).matchAll(ASSIGNMENT)].filter((m) => changesLookup(m[1])).map((m) => m[1]);

const askingAt = (command) => [...blankQuotedBraces(command).matchAll(ASKS)].map((m) => m.index);

function bashBlocks(file)
{
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    // Every fence pairs with its own closer whatever its language, so a closer is never read as a bare opener.
    const fence = /^([ \t]*)```([^`\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
    return [...text.matchAll(fence)].filter((m) => SHELL_FENCES.has(m[2].trim())).map((m) =>
    {
        const body = m[3].split('\n').map((line) => line.slice(m[1].length)).join('\n');
        const firstLine = text.slice(0, m.index).split('\n').length + 1;
        return { body, firstLine };
    });
}

// A command file's `!` line runs before the model reads the body: `!` then a backticked command.
function bangCommands(file)
{
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    return [...text.matchAll(/!`([^`\n]+)`/g)].map((m) => ({ body: m[1], firstLine: text.slice(0, m.index).split('\n').length }));
}

test('the ported check asks where Claude Code asks, and only there', () =>
{
    assert.deepStrictEqual(askingAt('x || { echo "MISSING"; exit 1; }'), [5], 'a brace group around a quoted echo asks');
    assert.deepStrictEqual(askingAt('node x <<\'EOF\'\n[ { "kind": "a" } ]\nEOF'), [17], 'JSON in a heredoc asks');
    assert.deepStrictEqual(askingAt('# { "a" }\necho ok'), [2], 'a comment keeps its braces');
    assert.deepStrictEqual(askingAt('echo "${A:-b}" \'{"a":1}\' `x {"y"}`'), [], 'a brace inside quotes or backticks does not');
    assert.deepStrictEqual(askingAt('if ! command -v git >/dev/null; then echo "MISSING git"; exit 1; fi'), [], 'if-then-fi does not');
    assert.deepStrictEqual(askingAt('printf \'%s\\n\' \'[ { "kind": "a" } ]\' | node x'), [], 'JSON in a single-quoted argument does not');
    assert.deepStrictEqual(askingAt('node .claude/hooks/handoff.js put a/v1/seat --text \'retry { "id": 1 } fixed it\''), [], 'the seats\' handoff form does not');
    assert.deepStrictEqual(askingAt('node .claude/hooks/handoff.js put a/v1/seat <<\'EOF\'\nretry { "id": 1 }\nEOF'), [58], 'the old heredoc form did');
    assert.deepStrictEqual(lookupAssignments('command -v tr || PATH="/usr/bin:$PATH"'), ['PATH'], 'a PATH heal asks');
    assert.deepStrictEqual(lookupAssignments('export LANG=C; LD_PRELOAD=x cmd'), ['LANG', 'LD_PRELOAD'], 'export and a prefix ask');
    assert.deepStrictEqual(lookupAssignments('TMP=$(mktemp -d); echo "PATH=x" \'HOME=y\'; MYPATH=1'), [], 'other names and quoted text do not');
});

test('no shipped bash block asks for approval through the brace-with-quote check', () =>
{
    const files = execFileSync('git', ['ls-files', 'setup-plugin/*.md', 'stack/*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(files.length > 50, `the scan reads the shipped bodies (${files.length} files)`);
    const blocks = files.flatMap((file) => [...bashBlocks(file), ...(file.startsWith('setup-plugin/commands/') ? bangCommands(file) : [])].map((b) => ({ file, ...b })));
    assert.ok(blocks.length >= 80, `the scan finds the shell blocks (${blocks.length}) - a broken fence pattern would pass on none`);
    const hits = blocks.flatMap(({ file, body, firstLine }) =>
        askingAt(body).map((at) => `${file}:${firstLine + body.slice(0, at).split('\n').length - 1}: ${body.slice(at, at + 60).replace(/\n/g, '\\n')}`));
    assert.deepStrictEqual(hits, [], 'rewrite each as if-then-fi, or pass JSON as a single-quoted argument');
    const lookups = blocks.flatMap(({ file, body, firstLine }) => lookupAssignments(body).map((name) => `${file}:${firstLine}: ${name}=`));
    assert.deepStrictEqual(lookups, [], 'a block that changes PATH or its kin asks every user - name the line in prose for the one case that needs it');
});
