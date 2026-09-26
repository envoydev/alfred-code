#!/usr/bin/env node
'use strict';
// A project's CLAUDE.md files against the tree they describe. Read-only and deterministic - no model
// call, no network. The CLAUDE.md skill runs it as its last step; /alfred-code:validate runs it for drift.
//
//   node scripts/claude-md-check.js [--root <dir>] [--file <path> ...] [--template <file>]
//   node scripts/claude-md-check.js --list [--root <dir>]   - the files it would check, each with its size,
//                                                             the untouched seed marked; nothing checked
//
//   path        - a path the file names does not exist (a code span, an @import, a relative link); a
//                 clause that denies it ('No `x`') claims nothing
//   command     - a command's program does not resolve on PATH or in the project (node_modules/.bin, a
//                 package.json dependency, a dotnet tool manifest, a script in the folder) - a shell
//                 block, or a code span under a commands / setup / build / run heading
//   placeholder - a `__NAME__` placeholder the template seeds is still there
//   todo        - a TODO left in the live text
//   template    - a live line still carries the template's own authoring text
//
// Only the LIVE text is read: HTML comments are stripped from what Claude loads, so they are stripped
// here too, line numbers kept. With no --file it checks the root CLAUDE.md, .claude/CLAUDE.md and every
// part's own CLAUDE.md git does not ignore (outside git, the vendored and build folders are skipped by
// name). Exit 1 on any finding, 0 when clean or when the project has no CLAUDE.md, 2 on a usage error.
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');

const TEMPLATE_DEFAULT = path.join(__dirname, '..', 'stack', 'CLAUDE.template.md');
const USAGE = 'usage: node claude-md-check.js [--root <dir>] [--file <path> ...] [--template <file>] | --list [--root <dir>]';

// Folders that hold someone else's files or a build's output - never a CLAUDE.md of the project's own.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv', '__pycache__', '.serena', '.playwright', '.memory-mcp']);

// The extensions a code span must end in to count as a FILE name without a '/' in it. Lowercase only:
// `System.Text.Json` is a namespace, `appsettings.json` is a file.
const FILE_EXT = /\.(md|mdc|json|jsonc|ya?ml|toml|xml|ini|cfg|conf|config|lock|txt|csv|cs|csx|csproj|fsproj|vbproj|sln|slnx|props|targets|ruleset|ts|tsx|js|jsx|mjs|cjs|mts|cts|html?|css|scss|sass|less|vue|svelte|py|rb|go|rs|java|kt|kts|gradle|swift|sh|bash|zsh|ps1|psm1|bat|cmd|sql|proto|graphql|dockerfile|tf|bicep|http|resx|xaml|axaml|razor|cshtml|plist|pem)$/;
// A member access that looks like a file name: `this.props`, `console.log`, `process.env`.
const RECEIVER = /^(this|self|window|document|process|console|module|exports|globalThis|req|res|ctx|app|props|state)\./;
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'terminal', 'powershell', 'pwsh', 'ps1', 'ps', 'cmd', 'bat', 'batch']);
const PROMPT_ONLY_LANGS = new Set(['console', 'terminal']);
// A heading whose section holds commands; its inline code spans of two words or more are read as ones.
const COMMAND_HEADING = /\b(commands?|setup|build(ing)?|run(ning)?|scripts?)\b/i;
// Shell and cmd.exe builtins and keywords - part of the shell, never a program on PATH.
const BUILTINS = new Set(['cd', 'export', 'set', 'unset', 'source', '.', 'echo', 'printf', 'exit', 'return', 'if', 'then', 'else',
    'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'alias', 'unalias', 'eval', 'exec', 'read',
    'pushd', 'popd', 'true', 'false', 'test', '[', '[[', 'local', 'shift', 'trap', 'wait', 'time', 'type', 'command', 'builtin',
    'ulimit', 'umask', 'cls', 'rem', 'call', 'start', 'setlocal', 'endlocal', 'copy', 'del', 'dir', 'md', 'rd', 'ren', 'move']);
const PROGRAM = /^(?:\.{1,2}\/|\/)?[A-Za-z0-9_][A-Za-z0-9._+/-]*$/;
// Where a shell starts a new command: `&&`, `||`, `;` and a whitespace-delimited `|` - never the `&` of a
// redirect (`2>&1`) or a `|` inside an argument (`gulp build:local|develop`).
const COMMAND_SPLIT = /&&|\|\||;|(?<=\s)\|(?=\s|$)/;
// A clause that denies what it names - 'No `x`', 'there is no `x`', 'NOT used here: `x`' - claims nothing
// exists. A clause ends at a sentence stop, a ` - ` aside or a table cell.
const NEGATION = /\b(no|not|never|none|nor|without)\b|n't\b/i;
const CLAUSE_END = /[.;!?](?=\s|$)|\s-\s|\|/g;
// A one-dot word that names a kind of copy or a reserved domain (`.template`, `.example`, `.invalid`),
// never a dotfile of its own.
const SUFFIX_WORDS = new Set(['template', 'tmpl', 'example', 'sample', 'dist', 'default', 'local', 'orig', 'bak', 'invalid', 'test', 'localhost']);
const CMDLET = /^[A-Z][a-z]+-[A-Z][A-Za-z]+$/;
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;
const SHINGLE = 8;
// What the installer leaves in a file it seeded (scripts/install/seeds.js stamps the H1 with the folder
// name, so no placeholder is left to find): the template's fill-in block, and no live section of the
// project's own - only the H1 and `## Rules`.
const FILL_IN = '<!-- Fill-in block - delete once done.';
function unfilledSeed(text)
{
    const t = normalize(text);
    const { live } = stripComments(t);
    if (!t.includes(FILL_IN) && !/^#\s+__PROJECT_NAME__\s*$/m.test(live)) return false;
    return ![...live.matchAll(/^\s{0,3}(#{1,6})\s+(.*)$/gm)].some((m) => m[1] !== '#' && m[2].trim() !== 'Rules');
}

const WHY = {
    path: 'does not exist',
    command: 'not on PATH',
    placeholder: "the template's placeholder was never filled",
    todo: 'a TODO left in the live text',
    template: "still the template's own authoring text - replace it with this project's",
};

const posix = (p) => p.split(path.sep).join('/');
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const normalize = (text) => String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

// The comments blanked out, every newline kept, so a line number means the same in both.
function stripComments(text)
{
    const comments = [];
    const live = text.replace(/<!--[\s\S]*?-->/g, (m) => { comments.push(m.slice(4, -3)); return m.replace(/[^\n]/g, ' '); });
    return { live, comments };
}

// The folder a file's relative paths are read from: its own, except `.claude/CLAUDE.md`, which is the
// project's own file and names paths from the project root.
function baseOf(root, file)
{
    const dir = path.dirname(path.join(root, file));
    return path.basename(dir) === '.claude' ? path.dirname(dir) : dir;
}

// Every file and folder on disk under the root (ignored ones included - `.claude/settings.local.json` is
// real), the vendored and build folders and nested repositories left out. A path a CLAUDE.md names without
// an anchor - `appsettings.json`, `install/docs.js` - is a name, not a location: it exists when some
// file or folder here ends with it.
function projectIndex(root)
{
    const files = [];
    const dirs = [];
    const walk = (dir, rel) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries)
        {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory())
            {
                if (SKIP_DIRS.has(e.name) || exists(path.join(dir, e.name, '.git'))) continue;
                dirs.push(r);
                walk(path.join(dir, e.name), r);
            }
            else files.push(r);
        }
    };
    walk(root, '');
    return { files, dirs };
}
const endsWithPath = (list, p) => list.some((x) => x === p || x.endsWith(`/${p}`));
// A .NET part folder carries the solution's prefix - `src/Acme.Bot/` - and a CLAUDE.md names it by the part
// alone (`Bot/Program.cs`). Only a path with a folder in it: a bare `Settings.json` is never `Acme.Settings.json`.
const endsWithPart = (list, p) => p.includes('/') && list.some((x) =>
{
    const at = x.length - p.length - 1;
    return at > 0 && x.endsWith(`.${p}`) && x[at - 1] !== '/';
});

// The programs the project brings with it: every package.json's dependencies and bins (a package's bin
// is usually its own name, the scope dropped), what npm linked into node_modules/.bin beside it, and
// every command a dotnet tool manifest (.config/dotnet-tools.json) declares.
function localPrograms(root, tree)
{
    const found = new Set();
    const addDir = (dir) => { try { for (const n of fs.readdirSync(dir)) found.add(n.replace(/\.(cmd|ps1)$/i, '')); } catch { /* none installed */ } };
    const json = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return null; } };
    const bare = (name) => String(name).split('/').pop();
    addDir(path.join(root, 'node_modules', '.bin'));
    for (const rel of tree.files)
    {
        const name = rel.split('/').pop();
        if (name === 'package.json')
        {
            addDir(path.join(root, path.dirname(rel), 'node_modules', '.bin'));
            const pkg = json(rel);
            if (!pkg || typeof pkg !== 'object') continue;
            for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
                for (const dep of Object.keys(pkg[field] || {})) found.add(bare(dep));
            if (typeof pkg.bin === 'string' && pkg.name) found.add(bare(pkg.name));
            else if (pkg.bin && typeof pkg.bin === 'object') for (const b of Object.keys(pkg.bin)) found.add(b);
        }
        else if (name === 'dotnet-tools.json')
        {
            const manifest = json(rel);
            for (const tool of Object.values((manifest && manifest.tools) || {}))
                for (const cmd of (tool && Array.isArray(tool.commands) ? tool.commands : [])) found.add(String(cmd));
        }
    }
    return found;
}

// True when the clause holding columns [from, to) of `prose` denies what it names.
function denied(prose, from, to)
{
    let start = 0;
    let end = prose.length;
    for (const m of prose.matchAll(CLAUSE_END))
    {
        if (m.index + m[0].length <= from) start = m.index + m[0].length;
        else if (m.index >= to) { end = m.index; break; }
    }
    return NEGATION.test(prose.slice(start, end));
}

// The project's files as git sees them (tracked, plus untracked it does not ignore), else a walk that
// skips the vendored and build folders by name.
function listFiles(root)
{
    const r = rt.spawnCommand('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0) return String(r.stdout).split('\0').filter(Boolean).filter((rel) => !rel.split('/').some((seg) => SKIP_DIRS.has(seg)));
    const out = [];
    const walk = (dir, rel) =>
    {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries)
        {
            const r2 = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory())
            {
                if (SKIP_DIRS.has(e.name) || exists(path.join(dir, e.name, '.git'))) continue;
                if (e.name === '.claude') { if (exists(path.join(dir, e.name, 'CLAUDE.md'))) out.push(`${r2}/CLAUDE.md`); continue; }
                walk(path.join(dir, e.name), r2);
            }
            else out.push(r2);
        }
    };
    walk(root, '');
    return out;
}

// The CLAUDE.md files to check: the root one and .claude/CLAUDE.md even where git ignores them (they
// load all the same), plus every part's own.
function findFiles(root)
{
    const found = new Set(listFiles(root).filter((rel) => rel.split('/').pop() === 'CLAUDE.md'));
    for (const own of ['CLAUDE.md', '.claude/CLAUDE.md']) if (exists(path.join(root, own))) found.add(own);
    return [...found].filter((rel) => !rel.startsWith('.claude/') || rel === '.claude/CLAUDE.md').sort();
}

function docsRootOf(root)
{
    try { return require('./install/copy.js').resolveDocsRoot(root); }
    catch { return '.claude/docs'; }
}

// A code span that names a path, normalized, or '' when it names something else.
// A code span that names a path, normalized - `{ path, anchored }` - or null when it names something
// else. An absolute or home path is the machine's, a leading-slash word a slash command (`/config`), a
// bare extension (`.md`) a kind of file: none of them is judged.
function pathOf(span, docsRoot)
{
    let s = span.trim().replace(/\\/g, '/').replace(/:\d+(:\d+)?$/, '');
    let anchored = false;
    if (s.startsWith('<docs-path>/')) { s = `${docsRoot.replace(/\/+$/, '')}/${s.slice('<docs-path>/'.length)}`; anchored = true; }
    if (!s || /\s/.test(s) || s.includes('...') || s.includes(':')) return null;
    if (/[*?{}<>$%()[\]=|,;"'`!&^~#]/.test(s) || /^[@/-]/.test(s) || /^\.{1,2}$/.test(s)) return null;
    if (RECEIVER.test(s)) return null;
    const last = s.replace(/\/+$/, '').split('/').pop();
    if (/^\.[a-z0-9]+$/.test(last) && FILE_EXT.test(`x${last}`)) return null;
    // A bare dot-token of two dots or more is a suffix (`.api.ts`, `.hbm.xml`), and one naming a kind of
    // copy or a reserved domain is a word - neither is a dotfile.
    if (!s.includes('/') && s.startsWith('.') && (s.slice(1).includes('.') || SUFFIX_WORDS.has(s.slice(1).toLowerCase()))) return null;
    if (/^\.{1,2}\//.test(s)) return { path: s, anchored: true };
    if (s.endsWith('/') || /^\.[a-z0-9][a-z0-9._-]*$/.test(last) || FILE_EXT.test(last)) return { path: s, anchored };
    return s.includes('/') ? { path: `?${s}`, anchored } : null;   // a slash alone proves nothing - `?` asks for a first segment that exists
}

function spansOf(line)
{
    const spans = [];
    for (const m of line.matchAll(/`([^`\n]+)`/g)) spans.push({ text: m[1], col: m.index });
    return spans;
}

// The programs a shell line runs, each with the word as written: a trailing comment dropped, chains
// split, prompts, env assignments, variables and cmdlets passed over.
function programsOf(line)
{
    const out = [];
    for (const segment of line.replace(/(^|\s)#.*$/, '').split(COMMAND_SPLIT))
    {
        const words = segment.trim().replace(/^\(+/, '').split(/\s+/).filter(Boolean);
        let i = 0;
        while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || words[i] === 'sudo' || words[i] === 'env')) i++;
        const word = words[i];
        if (!word || word.startsWith('$') || CMDLET.test(word) || BUILTINS.has(word) || !PROGRAM.test(word)) continue;
        out.push(word);
    }
    return out;
}

function checkText({ root, file, text, template = null, locate = (cmd) => rt.locate(cmd), isIgnored, index, docsRoot } = {})
{
    const findings = [];
    const add = (line, col, kind, what, why = WHY[kind]) => findings.push({ file, line, col, kind, what, why });
    const { live } = stripComments(normalize(text));
    const lines = live.split('\n');
    const base = baseOf(root, file);
    const fileDir = path.dirname(path.join(root, file));
    const docs = docsRoot || docsRootOf(root);
    const ignored = isIgnored || ((rel) => rt.spawnCommand('git', ['-C', root, 'check-ignore', '-q', '--no-index', '--', rel], { stdio: 'ignore' }).status === 0);
    let tree = index;
    const somewhere = (p) =>
    {
        tree = tree || projectIndex(root);
        const bare = p.replace(/\/+$/, '');
        const lists = p.endsWith('/') ? [tree.dirs] : [tree.files, tree.dirs];
        return lists.some((list) => endsWithPath(list, bare) || endsWithPart(list, bare));
    };
    let bins = null;
    const localBin = (program) =>
    {
        tree = tree || projectIndex(root);
        bins = bins || localPrograms(root, tree);
        return bins.has(program);
    };

    // A path counts when it exists from a base the file reads from, when it is unanchored and some path
    // in the project ends with it, or when git ignores it (a local file the setup creates - `.env`, a
    // build output). `anchored` - `./x`, `../x`, a resolved `<docs-path>/x`, an @import - is read from
    // its bases only.
    const pathMissing = (p, bases, { anchored = false } = {}) =>
    {
        const target = p.replace(/^\?/, '');
        const candidates = bases.map((b) => path.join(b, target));
        if (candidates.some(exists)) return false;
        if (!anchored && !/^\.{1,2}\//.test(target) && somewhere(target)) return false;
        if (p.startsWith('?') && !bases.some((b) => exists(path.join(b, target.split('/')[0])))) return false;   // `origin/main`, `application/json`
        const rels = candidates.map((c) => posix(path.relative(root, c))).filter((r) => r && !r.startsWith('..'));
        return !rels.some((r) => ignored(r));
    };

    let fence = null;
    let heading = '';
    let heredoc = null;
    for (let i = 0; i < lines.length; i++)
    {
        const n = i + 1;
        const line = lines[i];
        const opener = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/.exec(line);
        if (fence)
        {
            if (opener && opener[1][0] === fence.mark[0] && opener[1].length >= fence.mark.length && !opener[2]) { fence = null; continue; }
            if (!SHELL_LANGS.has(fence.lang)) continue;
            if (heredoc) { if (line.trim() === heredoc) heredoc = null; continue; }
            let cmd = line;
            let start = n;
            while (/\\\s*$/.test(cmd) && i + 1 < lines.length) { cmd = cmd.replace(/\\\s*$/, ' ') + lines[++i]; }
            const prompt = /^\s*(\$|>|PS [^>]*>)\s+/.exec(cmd);
            if (PROMPT_ONLY_LANGS.has(fence.lang) && !prompt) continue;
            cmd = cmd.replace(/^\s*(\$|>|PS [^>]*>)\s+/, '');
            if (!cmd.trim() || /^\s*(#|::|REM\b)/i.test(cmd)) continue;
            const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(cmd);
            if (doc) heredoc = doc[1];
            for (const program of programsOf(cmd)) checkProgram(program, start, cmd.indexOf(program));
            continue;
        }
        if (opener) { fence = { mark: opener[1], lang: opener[2].toLowerCase() }; continue; }
        const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
        if (h) heading = h[1];

        const spans = spansOf(line);
        // A code span MENTIONS a placeholder or a TODO (`__DOCS_ROOT__` is stamped by the installer);
        // only the prose around it is left unfilled.
        const prose = line.replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
        for (const m of prose.matchAll(PLACEHOLDER)) add(n, m.index, 'placeholder', m[0]);
        for (const m of prose.matchAll(/\bTODO\b/g)) add(n, m.index, 'todo', 'TODO');

        for (const span of spans)
        {
            // A dot-token written onto a word (appsettings`.local`) is that word's suffix.
            const suffix = span.text.trim().startsWith('.') && /[\w*]/.test(line[span.col - 1] || '');
            const p = suffix ? null : pathOf(span.text, docs);
            if (p && !denied(prose, span.col, span.col + span.text.length + 2) && pathMissing(p.path, [base, root], { anchored: p.anchored }))
                add(n, span.col, 'path', p.path.replace(/^\?/, ''));
            if (COMMAND_HEADING.test(heading) && /\s/.test(span.text.trim()))
                for (const program of programsOf(span.text)) checkProgram(program, n, span.col);
        }
        for (const m of prose.matchAll(/(^|\s)@([^\s`]+)/g))
        {
            const target = m[2].replace(/[.,;:)]+$/, '');
            if (!target || target.startsWith('~') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) continue;
            if (!exists(path.resolve(fileDir, target))) add(n, m.index, 'path', target);
        }
        for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g))
        {
            const target = m[1].replace(/[#?].*$/, '');
            if (!target || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(m[1]) || m[1].startsWith('#')) continue;
            if (pathMissing(target, [fileDir, base, root], { anchored: true })) add(n, m.index, 'path', target);
        }
    }
    if (template) checkTemplateText();
    if (unfilledSeed(text)) add(1, -1, 'template', 'the template', 'never filled: only its H1 and ## Rules are live');
    return findings.sort((a, b) => a.line - b.line || a.col - b.col).map(({ col, ...f }) => f);

    function checkProgram(program, line, col)
    {
        if (/^(\.{1,2}\/|\/)/.test(program) || (program.includes('/') && !path.isAbsolute(program)))
        {
            if (![base, root].some((b) => exists(path.resolve(b, program)))) add(line, col, 'command', program, WHY.path);
            return;
        }
        // A script in the folder the file reads from (cmd.exe runs `setup.bat` from there), or a binary the
        // project installs, is the project's own - never a PATH question.
        if ([base, root].some((b) => isFile(path.join(b, program))) || localBin(program)) return;
        if (!locate(program)) add(line, col, 'command', program);
    }

    // The template's comment blocks as runs of words; a live paragraph sharing a run of SHINGLE words or
    // more with them was written from the outline, not from the project - a whole outline sentence or
    // one cut short alike. Eight words in a row are no accident.
    function checkTemplateText()
    {
        const words = (text) => text.replace(/^\s*(\d+\.|[-*]|#{1,6})\s+/gm, '').split(/\s+/).filter(Boolean);
        // Compared without trailing punctuation: 'versions,' in the live text is the outline's 'versions'.
        const key = (w) => w.replace(/[.,;:!?]+$/, '');
        const tw = words(stripComments(normalize(template)).comments.join('\n')).map(key);
        const shingles = new Set();
        for (let k = 0; k + SHINGLE <= tw.length; k++) shingles.add(tw.slice(k, k + SHINGLE).join(' '));
        if (!shingles.size) return;
        let para = [];
        const flush = () =>
        {
            const pw = [];
            for (const p of para) for (const w of words(p.text)) pw.push({ w, k: key(w), n: p.n });
            para = [];
            for (let k = 0; k + SHINGLE <= pw.length; k++)
            {
                if (!shingles.has(pw.slice(k, k + SHINGLE).map((x) => x.k).join(' '))) continue;
                let end = k + SHINGLE;
                while (end < pw.length && shingles.has(pw.slice(end - SHINGLE + 1, end + 1).map((x) => x.k).join(' '))) end++;
                const run = pw.slice(k, end).map((x) => x.w).join(' ');
                add(pw[k].n, 0, 'template', run.length > 80 ? `${run.slice(0, 77)}...` : run);
                k = end - 1;
            }
        };
        let inFence = false;
        lines.forEach((text, i) =>
        {
            if (/^\s*(`{3,}|~{3,})/.test(text)) { inFence = !inFence; flush(); return; }
            if (inFence || !text.trim()) { flush(); return; }
            para.push({ n: i + 1, text });
        });
        flush();
    }
}

function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {})
{
    let root = process.cwd();
    let templateFile = TEMPLATE_DEFAULT;
    const files = [];
    let list = false;
    for (let i = 0; i < argv.length; i++)
    {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--list') { list = true; continue; }
        if (['--root', '--file', '--template'].includes(flag) && value && !value.startsWith('--'))
        {
            if (flag === '--root') root = path.resolve(value);
            else if (flag === '--file') files.push(posix(path.relative(root, path.resolve(root, value))));
            else templateFile = path.resolve(value);
            i++;
            continue;
        }
        err(`${USAGE}\n`);
        return 2;
    }
    if (list) return listMain(root, files.length ? files : findFiles(root), { out, err });
    let template = null;
    try { template = fs.readFileSync(templateFile, 'utf8'); }
    catch { err(`claude-md-check: template ${templateFile} unreadable - the template-text check did not run\n`); }
    const targets = files.length ? files : findFiles(root);
    if (!targets.length) { out('claude-md-check: no CLAUDE.md in this project\n'); return 0; }
    const docsRoot = docsRootOf(root);
    const index = projectIndex(root);
    const findings = [];
    for (const file of targets)
    {
        let text;
        try { text = fs.readFileSync(path.join(root, file), 'utf8'); }
        catch (e) { err(`claude-md-check: ${file} unreadable (${e.code || e.message})\n`); return 2; }
        findings.push(...checkText({ root, file, text, template, docsRoot, index }));
    }
    for (const f of findings) out(`${f.file}:${f.line} ${f.kind}: ${f.what} - ${f.why}\n`);
    if (!findings.length) { out(`claude-md-check: clean (${targets.length} file(s))\n`); return 0; }
    out(`claude-md-check: ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)\n`);
    return 1;
}

// A seeded file still carrying the template's H1 placeholder in its live text has never been filled.
function listMain(root, targets, { out, err })
{
    if (!targets.length) { out('claude-md-check: no CLAUDE.md in this project\n'); return 0; }
    for (const file of targets)
    {
        let text;
        try { text = normalize(fs.readFileSync(path.join(root, file), 'utf8')); }
        catch (e) { err(`claude-md-check: ${file} unreadable (${e.code || e.message})\n`); return 2; }
        const lines = text.replace(/\n$/, '').split('\n').length;
        const seeded = unfilledSeed(text);
        out(`${file}: ${lines} lines${seeded ? ', the seeded template (unfilled)' : ''}\n`);
    }
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { checkText, findFiles, main, stripComments };
