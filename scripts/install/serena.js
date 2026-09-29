'use strict';
// THE SERENA SEED - the project.yml serena would otherwise generate badly.
//
// serena binds a repo through `--project-from-cwd`, which finds `.serena/project.yml` in its cwd.
// The config it AUTO-GENERATES is not a substitute: in async mode it writes an EMPTY language list
// and otherwise only the single top language, so a C# + TypeScript repo indexes half of itself. So
// the seed states both keys explicitly, from this machine's own scan.
//
// The rule that keeps an update safe: A KEY THAT CARRIES ENTRIES IS HAND-TUNED AND LEFT ALONE, and
// a key is NEVER appended when it already exists - serena's own generated config ships
// `language_servers: []` / `ignored_paths: []`, and a second key of the same name is a duplicate-key
// YAML error, not an override. An empty key is rewritten in place; a populated one is not touched.
//
// `ignored_paths` is set on EVERY run, independent of the language branch: an install predating the
// key, and every config serena generated itself, otherwise indexes `.serena/home` - measured on a
// 14-file fixture, 126 files attempted and 112 failed, every one inside the language-server dir.
const fs = require('node:fs');
const path = require('node:path');

// ~327MB of language servers, the stack's own files, and the playwright MCP's browser profile -
// none of them project source. 2.0.0's value, before the data root; still the stack's own to rewrite.
const IGNORED_PATHS = '[".serena", ".claude", ".playwright"]';
// Since the data root (stack/mcp/data-root.js): the root first - it holds serena's own home and folder,
// the browser profiles and the docs - then the stack files and the 2.0.0 places a project not yet moved
// still holds.
const ignoredPathsFor = (root) => (root ? `["${root}", ".claude", ".serena", ".playwright"]` : IGNORED_PATHS);
// True when an ignored_paths line holds a value the stack wrote: 2.0.0's, or the data-root shape for any
// root - never a list of the user's own.
function stackIgnored(text)
{
    const m = /^[ \t]*ignored_paths[ \t]*:[ \t]*(\[.*\])[ \t]*$/m.exec(String(text));
    if (!m) return false;
    let items;
    try { items = JSON.parse(m[1]); } catch { return false; }
    if (!Array.isArray(items)) return false;
    if (JSON.stringify(items) === IGNORED_PATHS.replace(/, /g, ',')) return true;
    return items.length === 4 && typeof items[0] === 'string' && require('../../stack/mcp/data-root.js').checkDataPath(items[0]).ok
        && JSON.stringify(items.slice(1)) === '[".claude",".serena",".playwright"]';
}

const CSHARP = /\.(sln|slnx|csproj)$/i;
const TYPESCRIPT = /(^tsconfig.*\.json$)|(^package\.json$)|\.(ts|tsx|js|jsx|mjs)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist']);

// The detected server ids, in a fixed order. serena's typescript server handles plain JavaScript
// too, so a package.json-only or .js-only repo takes it as well - without that a JS project
// detected nothing and got no seed at all.
function detectLanguages(root, { maxDepth = 4 } = {})
{
    const found = new Set();
    const walk = (dir, depth) =>
    {
        if (depth > maxDepth || found.size === 2) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries)
        {
            if (entry.isDirectory())
            {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name), depth + 1);
                continue;
            }
            if (CSHARP.test(entry.name)) found.add('csharp');
            else if (TYPESCRIPT.test(entry.name)) found.add('typescript');
        }
    };
    walk(root, 1);
    return ['csharp', 'typescript'].filter((id) => found.has(id));
}

// True when ONE of the named keys carries a non-empty list - inline (`key: [a, b]`) or as the
// `- item` block under it. An empty list, or a key followed by another key, is NOT entries.
function hasEntries(text, keys)
{
    const want = new Set(keys);
    let pending = false;
    for (const line of String(text).split('\n'))
    {
        const keyMatch = /^\s*([a-z_]+)\s*:(.*)$/.exec(line);
        if (keyMatch)
        {
            const [, key, rest] = keyMatch;
            pending = false;
            if (!want.has(key)) continue;
            const value = rest.trim();
            if (/\[\s*[^\][\s]/.test(value)) return true;      // an inline list with something in it
            if (value === '') pending = true;                  // a block list may follow
            continue;
        }
        if (pending && /^\s*-\s*\S/.test(line)) return true;
        if (pending && line.trim() && !line.trim().startsWith('#')) pending = false;
    }
    return false;
}

// Rewrite an EMPTY key in place, append an absent one, leave a populated one alone.
function setListKey(cfgFile, key, value, comment, { log = () => {} } = {})
{
    let text;
    try { text = fs.readFileSync(cfgFile, 'utf8'); }
    catch { return false; }
    if (hasEntries(text, [key])) return false;

    const line = new RegExp(`^[ \\t]*${key}[ \\t]*:.*$`, 'm');
    if (line.test(text))
    {
        fs.writeFileSync(cfgFile, text.replace(line, `${key}: ${value}`));
        log(`  serena: ${key} set to ${value} (was empty)`);
        return true;
    }
    fs.writeFileSync(cfgFile, `${text}\n# Added by alfred-code: ${comment}\n${key}: ${value}\n`);
    log(`  serena: ${key} ${value} appended to project.yml`);
    return true;
}

const quoteList = (ids) => `[${ids.map((id) => `"${id}"`).join(', ')}]`;

// `dir` is serena's per-project folder this run (data-root.js liveDir): <data root>/serena, or a 2.0.0
// `.serena` not moved yet - the file is seeded where serena reads it now, and moves with the folder.
function seedProject({ projectRoot, selected = true, dir = '.serena', root = null, log = () => {} })
{
    if (!selected) return { written: false, reason: 'serena is not in this selection' };
    const cfg = path.join(projectRoot, ...dir.split('/'), 'project.yml');
    const ignored = ignoredPathsFor(root);

    if (fs.existsSync(cfg))
    {
        let text = '';
        try { text = fs.readFileSync(cfg, 'utf8'); } catch { /* handled below */ }
        if (hasEntries(text, ['language_servers', 'languages']))
            log('  serena: project.yml already names its language servers - left as-is');
        else
        {
            const langs = detectLanguages(projectRoot);
            if (langs.length)
                setListKey(cfg, 'language_servers', quoteList(langs),
                    'serena writes this key empty (async) or with only the single top language.', { log });
            else log("  serena: no C#/TypeScript/JS sources found - language_servers left to serena's own detection");
        }
        // ALWAYS, independent of the branch above. A value the stack wrote follows the data root; one the
        // user wrote is theirs.
        const now = (/^[ \t]*ignored_paths[ \t]*:[ \t]*(.*?)[ \t]*$/m.exec(text) || [])[1];
        if (stackIgnored(text) && now !== ignored)
        {
            fs.writeFileSync(cfg, text.replace(/^[ \t]*ignored_paths[ \t]*:.*$/m, `ignored_paths: ${ignored}`));
            log(`  serena: ignored_paths set to ${ignored} (the stack's own value, re-pointed at the data root)`);
        }
        else setListKey(cfg, 'ignored_paths', ignored,
            'the data root holds the ~327MB of language servers and the browser profiles, .claude the stack files - none are project source.', { log });
        return { written: false, existing: true };
    }

    const langs = detectLanguages(projectRoot);
    // `language_servers` has no default in serena's schema, so a file WITHOUT it fails to load:
    // with nothing detected, write nothing and let serena generate its own.
    if (!langs.length)
    {
        log("  serena: no C#/TypeScript/JS sources found - left project.yml to serena's own detection");
        return { written: false, reason: 'nothing detected' };
    }
    const name = path.basename(projectRoot);
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, `# Seeded by alfred-code. serena binds this repo via --project-from-cwd; the config it would
# auto-generate instead is written with an EMPTY language list in async mode and with only the
# single top language otherwise, so it is stated here explicitly. Detected from the files in this
# repo at install time; edit freely - a key that carries entries is never rewritten by an update.
# The C# (Roslyn) server needs .NET 10+; serena installs it itself when the runtime is not on
# PATH, into SERENA_HOME (${dir}/home, ~327MB - keep it ignored).
project_name: "${name}"
language_servers: ${quoteList(langs)}
# The data root holds SERENA_HOME (the language servers, ~327MB of DLLs and node_modules) and
# the browser profiles, .claude the stack's own files, .serena and .playwright the same data
# where a project not yet moved keeps it - none of them project source. Without this line
# serena's indexer walks into them: measured on a 14-file fixture it tried 126 files and failed
# 112, every one of them inside .serena/home.
ignored_paths: ${ignored}
`);
    log(`  serena: seeded ${dir}/project.yml (project_name=${name}, language_servers=${quoteList(langs)})`);
    return { written: true, languages: langs, name };
}

// The whole `.serena/` is machine state - SERENA_HOME's language servers (the Roslyn `.mef-composition` cache
// reached a benchmark cell's diff), the index cache, the handoff memories - so it gets its own `.gitignore` of
// `*`, the way `.playwright/` and a project memory database do. serena writes a narrower one when none is
// there (`/cache` and `/project.local.yml`, src/serena/project.py) that leaves SERENA_HOME out: that exact
// text is serena's, not the project's, and is widened; any other text is the project's and stays.
const SERENA_IGNORE = '*\n';
const SERENA_OWN_IGNORE = '/cache\n/project.local.yml\n';
function ensureSerenaIgnore({ projectRoot, selected = true, log = () => {} })
{
    if (!selected) return 'skipped';
    const file = path.join(projectRoot, '.serena', '.gitignore');
    let have = null;
    try { have = fs.readFileSync(file, 'utf8'); } catch { have = null; }
    if (have === SERENA_IGNORE) return 'current';
    if (have !== null && have.replace(/\r\n/g, '\n') !== SERENA_OWN_IGNORE)
    {
        log('  serena: .serena/.gitignore is the project\'s own - left as it is (the whole .serena/ is machine state; keep it ignored)');
        return 'kept';
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, SERENA_IGNORE);
    log(`  serena: .serena/.gitignore ${have === null ? 'written' : 'widened from serena\'s own'} - the language servers, index and memories are never committed`);
    return have === null ? 'written' : 'replaced';
}

module.exports = { detectLanguages, hasEntries, setListKey, seedProject, ensureSerenaIgnore, stackIgnored, ignoredPathsFor, IGNORED_PATHS };
