'use strict';
// THE STACK'S VARIABLES - the writer (workspace roles and variables, D3 / D5 / D6 / D7). `<data root>/.variables` holds
// the stack's ALFRED_CODE_* values, one KEY=value per line, read by layout.js's loader. Every write goes through here:
// under `.variables.lock` (file-lock.js, the workspace file's timings), read with the loader's own grammar, changed
// line by line - comments, unknown lines and untouched values keep their bytes, a new key is appended in catalog order -
// then a temp file renamed into place, so no reader sees half a file. `set` routes each pair: a key the project's
// settings.local.json holds is written there (D4 step 2 would beat the file), a local-scope run never edits a
// .variables git tracks, and the two settings keys, a key outside the catalog, a credential-shaped value and a value on
// two lines are refused, the key named and never the value.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const layout = require('../../stack/hooks/layout.js');
const { SECRET_SHAPE, PEM_PRIVATE } = require('../credential-shapes.js');
const { parseJson } = require('./json-file.js');
const { sleepMs, takeLock } = require('./file-lock.js');
const stamp = require('./stamp.js');
const { DATA_IGNORE_HEAD } = require('../../stack/mcp/data-root.js');

const FILE = '.variables';
const LOCAL = 'settings.local.json';
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SETTINGS_KEYS = {
    ALFRED_CODE_HOOKS_OFF: 'lives in .claude/settings.json - not written to .variables',
    ALFRED_CODE_DATA_PATH: 'lives in .claude/settings.json - it names where .variables is, so it is not written to it',
};
const CATALOG = () => require('../../meta/environment.json').env || [];
const isFile = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

// The project's file: the checkout's, else the main worktree's when only that one exists (a gitignored file a new
// worktree lacks) - the loader's place. Where neither exists, the checkout's, which a write creates.
function fileOf(projectRoot, { env = process.env, dataRoot } = {})
{
    const checkout = path.resolve(projectRoot);
    // `dataRoot` is the checkout's root as a run decided it (the installer's, before its settings pass writes it).
    const at = (place) => path.join(place, ...(dataRoot && place === checkout ? dataRoot : layout.dataRootOf(place, { env })).split('/'), FILE);
    const own = at(checkout);
    if (isFile(own)) return own;
    const main = layout.mainCounterpart(checkout);
    if (main && layout.dirKey(main) !== layout.dirKey(checkout) && isFile(at(main))) return at(main);
    return own;
}

// { values, lines, eol }: the loader's values and the file's lines as read (no line ending), its line ending kept.
function read(file)
{
    const got = layout.readDotenv(file);
    if (!got) return { values: {}, lines: [], eol: '\n' };
    const text = layout.readText(file);
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') lines.pop();
    return { values: got.values, lines, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

const keyOf = (line) => (layout.COMMENT_LINE.test(line) ? null : (layout.DOTENV_LINE.exec(line) || [])[1] || null);
// A value the reader would read back otherwise (edge spaces, a quoted pair) is quoted on the way in.
const quoted = (value) => (layout.unquote(value) === value ? value : value.includes('"') ? `'${value}'` : `"${value}"`);

// The lines after `updates` ({ KEY: value | null }): a key's last line takes the value (its `export` kept), null drops
// every line of the key, a key with no line is appended in `order`.
function applied(lines, updates, order)
{
    const out = [...lines];
    const fresh = [];
    for (const [key, value] of Object.entries(updates))
    {
        const at = out.map((line, i) => (keyOf(line) === key ? i : -1)).filter((i) => i >= 0);
        if (value === null) { for (const i of at.reverse()) out.splice(i, 1); continue; }
        const line = `${key}=${quoted(String(value))}`;
        if (at.length) out[at[at.length - 1]] = `${/^\s*(?:export\s+)?/.exec(out[at[at.length - 1]])[0]}${line}`;
        else fresh.push([key, line]);
    }
    const rank = (key) => { const i = order.indexOf(key); return i < 0 ? order.length : i; };
    fresh.sort((a, b) => rank(a[0]) - rank(b[0]));
    return [...out, ...fresh.map(([, line]) => line)];
}
const render = (lines, eol) => (lines.length ? `${lines.join(eol)}${eol}` : '');

// Writes `updates` into `file` under its lock. { changed } - false with no `why` when the file already says it.
function write(file, updates, { order = layout.VARIABLE_KEYS, now = Date.now, sleep = sleepMs, retryMs = 2000, staleMs = 30000 } = {})
{
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); }
    catch { return { changed: false, why: 'unwritable' }; }
    const lock = `${file}.lock`;
    let held = false;
    try
    {
        held = takeLock(lock, { now, sleep, retryMs, staleMs });
        if (!held) return { changed: false, why: 'locked' };
        const current = read(file);
        const after = render(applied(current.lines, updates, order), current.eol);
        if (after === render(current.lines, current.eol)) return { changed: false };
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        try
        {
            fs.writeFileSync(tmp, after);
            fs.renameSync(tmp, file);
        }
        catch
        {
            try { fs.rmSync(tmp, { force: true }); } catch { /* nothing left to clean */ }
            return { changed: false, why: 'unwritable' };
        }
        return { changed: true };
    }
    catch
    {
        return { changed: false, why: 'unwritable' };
    }
    finally
    {
        if (held) try { fs.unlinkSync(lock); } catch { /* already gone */ }
    }
}

// git tracks the file (a teammate's project-scope install committed it). No git, or no repository: not tracked.
function tracked(file)
{
    try
    {
        execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch', '--', path.basename(file)],
            { cwd: path.dirname(file), stdio: 'ignore', timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
        return true;
    }
    catch { return false; }
}

// D6's verdict on `<dataRoot>/.variables`: `git check-ignore -q` decides (exit 0: ignored) - `-v` exits 0 on a negated
// match too, so it only names the rule: { ignored: false } | { ignored: true, source?, line?, own? }. `own` says the rule
// is the data root's own .gitignore AND the stack's text (its head), which the install re-includes `.variables` in - a
// file the user wrote there is kept as it is (docs.ensureDataIgnore), so it is not. No git, or no repository: not ignored.
function ignoreVerdict(projectRoot, dataRoot)
{
    const root = String(dataRoot).replace(/\\/g, '/').replace(/\/+$/, '');
    const rel = `${root}/${FILE}`;
    const git = (args) => spawnSync('git', ['-c', 'core.fsmonitor=false', ...args],
        { cwd: projectRoot, encoding: 'utf8', timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    if (git(['check-ignore', '-q', '--', rel]).status !== 0) return { ignored: false };
    const m = /^(.*?):(\d+):/.exec(String(git(['check-ignore', '-v', '--', rel]).stdout || ''));
    if (!m) return { ignored: true };
    // -v names a .gitignore from the repository's top, never the cwd.
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
    const top = String(git(['rev-parse', '--show-toplevel']).stdout || '').trim();
    const mine = path.join(projectRoot, ...root.split('/'), '.gitignore');
    let head = '';
    try { head = fs.readFileSync(mine, 'utf8'); } catch { /* the rule's file is elsewhere */ }
    const own = Boolean(top) && real(path.resolve(top, m[1])) === real(mine) && head.startsWith(DATA_IGNORE_HEAD);
    return { ignored: true, source: m[1], line: Number(m[2]), own };
}
// A data root change (--data-path) carries the file, as workspace.js moveWorkspace carries the workspace file - before the
// settings pass, so it reads the project's own values at the new root. A file already there is kept and the old named.
function carry({ projectRoot, from, to, log = () => {} })
{
    const src = path.join(projectRoot, ...String(from).split('/'), FILE);
    const dst = path.join(projectRoot, ...String(to).split('/'), FILE);
    if (!fs.existsSync(src)) return 'absent';
    if (fs.existsSync(dst))
    {
        log(`  !! variables: ${from}/${FILE} left in place - ${to}/${FILE} already exists`);
        return 'clash';
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    log(`  variables: moved ${from}/${FILE} -> ${to}/${FILE}`);
    return 'moved';
}

// The line D6 prints for an ignored file.
const ignoredLine = (dataRoot, verdict) =>
{
    const src = String(verdict.source || '');
    const inRoot = src === `${dataRoot}/.gitignore` || src.endsWith(`/${dataRoot}/.gitignore`);
    return `!! variables: ${dataRoot}/${FILE} is ignored by ${src ? `${src}:${verdict.line}` : 'a git rule'} - the keys are kept in settings.json; `
        + (inRoot ? `add !/${FILE} to ${dataRoot}/.gitignore, then update` : `ignore /${dataRoot}/* and re-include !/${dataRoot}/${FILE}, then update`);
};

// The project's settings.local.json: its parsed object, or null when absent or unparseable (D4 step 2 skips it).
function localSettings(projectRoot)
{
    const file = path.join(projectRoot, '.claude', LOCAL);
    try { const data = parseJson(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? { file, data } : null; }
    catch { return null; }
}
// The project's settings.json for a D6 write: its object with an `env` object, {} when absent. An unparseable file is
// refused whole - the user's own file is never rewritten from nothing.
function sharedSettings(projectRoot)
{
    const file = path.join(projectRoot, '.claude', 'settings.json');
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; }
    let data = {};
    if (text !== null)
    {
        try { data = parseJson(text); } catch { data = null; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('.claude/settings.json cannot be read - fix it, then run the set again');
    }
    if (!data.env || typeof data.env !== 'object' || Array.isArray(data.env)) data.env = {};
    return { file, data };
}
const heldLocally = (local, key) =>
{
    const env = local && local.data.env;
    const value = env && typeof env === 'object' && Object.hasOwn(env, key) ? env[key] : undefined;
    return value !== undefined && value !== null && value !== '';
};

// [key, value] pairs from `KEY=value` strings, [key, value] tuples or an object; a malformed word keeps a null key.
function pairsOf(input)
{
    if (!Array.isArray(input)) return Object.entries(input || {});
    return input.map((item) =>
    {
        if (Array.isArray(item)) return [item[0], item[1]];
        const text = String(item);
        const cut = text.indexOf('=');
        return cut > 0 ? [text.slice(0, cut), text.slice(cut + 1)] : [null, null];
    });
}

// D5's routing for each pair. An empty value (`KEY=`) removes the key. { written, toLocal, toSettings, refused }: the keys
// each way - `toSettings` at project or user scope where git ignores the file (D6), so the value still reaches the team.
// `team`: the value is the team's (the docs-versioning seed at project scope, C7) - a key settings.local.json holds is
// still written to the shared file, and the developer's own file is left as it is.
function set(projectRoot, pairs, { scope, env = process.env, log = console.log, team = false } = {})
{
    const root = path.resolve(projectRoot);
    const runScope = scope || stamp.installScope(root);
    const file = fileOf(root, { env });
    const rel = path.relative(root, file).split(path.sep).join('/') || FILE;
    const local = localSettings(root);
    const result = { written: [], toLocal: [], toSettings: [], refused: [] };
    const updates = {};
    const refuse = (key, why) => { result.refused.push(key); log(`!! variables: ${key} ${why}`); };
    let localChanged = false;
    let fileTracked;
    let verdict;
    let shared;
    for (const [key, raw] of pairsOf(pairs))
    {
        if (!key || !KEY_NAME.test(key)) { refuse('(a word)', 'is no KEY=value pair - not written'); continue; }
        const value = raw === null || raw === undefined || raw === '' ? null : String(raw);
        if (SETTINGS_KEYS[key]) { refuse(key, SETTINGS_KEYS[key]); continue; }
        if (!layout.VARIABLE_KEYS.includes(key)) { refuse(key, 'is not one of the stack\'s variables - not written (a guard switch stays in .claude/settings.json)'); continue; }
        if (value !== null && /[\r\n]/.test(value)) { refuse(key, '- a value is one line - not written'); continue; }
        if (value !== null && (SECRET_SHAPE.test(value) || PEM_PRIVATE.test(value)))
        {
            refuse(key, '- the value has a credential\'s shape; a credential goes in the data root\'s .secrets - not written');
            continue;
        }
        if (!team && heldLocally(local, key))
        {
            if (value === null) delete local.data.env[key];
            else local.data.env[key] = value;
            localChanged = true;
            result.toLocal.push(key);
            log(value === null
                ? `variables: ${key} removed from .claude/${LOCAL} - .variables answers for it here`
                : `variables: ${key} set in .claude/${LOCAL} (it overrides .variables here)`);
            continue;
        }
        if (runScope === 'local' && (fileTracked ??= tracked(file)))
        {
            refuse(key, '- .variables is tracked here; change it with the team (no .variables.local yet)');
            continue;
        }
        if (runScope !== 'local' && (verdict ??= ignoreVerdict(root, layout.dataRootOf(root, { env }))).ignored)
        {
            if (value === null) delete (shared ??= sharedSettings(root)).data.env[key];
            else (shared ??= sharedSettings(root)).data.env[key] = value;
            result.toSettings.push(key);
            continue;
        }
        updates[key] = value;
    }
    if (localChanged) fs.writeFileSync(local.file, `${JSON.stringify(local.data, null, 2)}\n`);
    if (shared && shared.data)
    {
        log(ignoredLine(layout.dataRootOf(root, { env }), verdict));
        fs.mkdirSync(path.dirname(shared.file), { recursive: true });
        fs.writeFileSync(shared.file, `${JSON.stringify(shared.data, null, 2)}\n`);
        log(`variables: ${result.toSettings.join(', ')} written to .claude/settings.json`);
    }
    const keys = Object.keys(updates);
    if (keys.length)
    {
        const done = write(file, updates);
        if (done.why)
        {
            for (const key of keys) refuse(key, `not written - ${rel} is ${done.why === 'locked' ? 'locked by another run' : 'not writable'}`);
        }
        else
        {
            result.written.push(...keys);
            log(`variables: ${keys.join(', ')} ${done.changed ? 'written to' : 'already so in'} ${rel}`);
        }
    }
    return result;
}

// Each variable's effective value and where it comes from: `own`, `from <rel>` (a linked member), `settings.local.json`,
// `env` (a launch or un-migrated settings value) or `default` (the catalog's, nothing set).
function show(projectRoot, { env = process.env, catalog = CATALOG() } = {})
{
    const { values, from } = layout.variablesOf(path.resolve(projectRoot), { env });
    return layout.VARIABLE_KEYS.map((key) =>
    {
        if (values[key] !== undefined)
        {
            const at = from[key];
            return { key, value: values[key], source: at === 'own' || at === LOCAL || at === 'env' ? at : `from ${at}` };
        }
        const row = catalog.find((r) => r.key === key) || {};
        return { key, value: String(row.default ?? ''), source: 'default' };
    });
}

module.exports = { FILE, fileOf, read, write, set, show, ignoreVerdict, ignoredLine, tracked, carry };
