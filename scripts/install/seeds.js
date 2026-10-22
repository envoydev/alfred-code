'use strict';
// THE SMALL SEEDS - the per-project files and account values a run lays down once.
//
//   - `.claude/AGENTS.md` (the root `AGENTS.md` on `--instructions-at root`; `CLAUDE.md` for either on
//     `--instructions-file claude`, the name the stamp's `instructions-file:` line keeps), from the stack-neutral template,
//     ONLY when the project has no `AGENTS.md`, `.claude/AGENTS.md`, `CLAUDE.md` or `.claude/CLAUDE.md` - beside a
//     CLAUDE.md an AGENTS.md seed would never load, beside another file it would be a second copy of the project's
//     instructions. A root instruction file is the project's own: checked and improved in place, never overwritten -
//     only moved or renamed, on the user's answer to the place or the name question (`placeInstructionFiles`,
//     `renameInstructionFiles`).
//   - The ACCOUNT settings.json `env` keys. At project scope too, deliberately: the account file is
//     the one whose env reaches `.mcp.json` URL and header expansion (measured on 2.1.266 - a
//     project `.claude/settings.json` leaves the 'Missing environment variables' warning in place).
//     A value the run was HANDED is explicit and overwrites; a key it was not handed is never
//     touched, let alone cleared, and a credential-shaped key is logged BY LENGTH, never by value.
//   - The playwright engine builds. firefox and webkit are Playwright's own builds, not a browser
//     the machine already has, so each kept one is downloaded through the server's OWN bundled
//     playwright and matches the version the server launches. Fail-soft.
const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('./json-file.js');

// The same pattern meta/environment.json calls secret_key_pattern.
const SECRET_KEY = /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$/;
const PROJECT_NAME_TOKEN = '__PROJECT_NAME__';
const DOWNLOADED_ENGINES = ['firefox', 'webkit'];

// Written to the account file, never to argv: argv is readable by every process on the box.
function seedAccountEnv({ configDir, key, value, log = () => {}, note = () => {} })
{
    const file = path.join(configDir, 'settings.json');
    let data = {};
    try { data = parseJson(fs.readFileSync(file, 'utf8')); }
    catch (err)
    {
        if (err.code !== 'ENOENT') { note(`could not write ${key} into ${file} (${err.message})`); return false; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { note(`could not write ${key} into ${file} (top level is not an object)`); return false; }
    data.env = data.env || {};
    const before = data.env[key];
    const shown = SECRET_KEY.test(key) ? `set (${String(value).length} chars)` : value;
    if (before === value) { log(`  ${key} already ${shown} in ${file}`); return false; }
    data.env[key] = value;
    try
    {
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    }
    catch (err) { note(`could not write ${key} into ${file} (${err.message})`); return false; }
    log(`  ${key}=${shown} written to ${file} env`);
    return true;
}

// Every key the stack knows that THIS RUN was handed, from the launch environment - since 2.0.0 cut
// the sentry server, only context7's key. A value never goes through a chat. The SENTRY_* keys an
// older run wrote are the user's credentials: never read here, never removed.
function seedAccountKeys({ configDir, env = {}, log, note })
{
    const written = [];
    const values = {
        CONTEXT7_API_KEY: env.CONTEXT7_API_KEY || '',
    };
    for (const [key, value] of Object.entries(values))
        if (value && seedAccountEnv({ configDir, key, value, log, note })) written.push(key);
    return written;
}

// INSTALL only, once. The H1 placeholder is stamped with the repo folder name - the same __TOKEN__
// convention as the docs-root rule, and because the seed runs once a hand-written title is never
// clobbered.
// The body the seed writes into .claude/AGENTS.md for this project, or null with no template - also the
// ledger fallback's test that an AGENTS.md is still the unfilled seed (R10).
function agentsMdBody({ projectRoot, sourceDir, name = path.basename(projectRoot) })
{
    let body;
    try { body = fs.readFileSync(path.join(sourceDir, 'stack', 'AGENTS.template.md'), 'utf8'); } catch { return null; }
    return body.split(PROJECT_NAME_TOKEN).join(name);
}

// Claude Code 2.1.277 is the first release that reads AGENTS.md itself (code.claude.com/docs/en/memory,
// the changelog entry of that version), and only while no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md sits
// in the working directory or above it - so an older one, or a session on a third-party provider, sees none of it.
const AGENTS_MD_FLOOR = '2.1.277';
const AGENTS_MD_NOTE = `Claude Code ${AGENTS_MD_FLOOR} or later reads AGENTS.md itself (every session from 2.1.281; before it, Bedrock and telemetry-disabled ones read CLAUDE.md only), and only while no CLAUDE.md or CLAUDE.local.md sits beside or above it`;

// Where an AGENTS.md can already be: the root (loaded beside .claude/AGENTS.md, so it is the project's own
// file) or .claude/. Either one, or any CLAUDE.md, means the project has its instruction file already.
function existingInstructionFile(projectRoot)
{
    for (const rel of ['AGENTS.md', '.claude/AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md'])
        if (fs.existsSync(path.join(projectRoot, ...rel.split('/')))) return rel;
    return null;
}

// The instruction file's name - the user's answer to init's and configure's name question (--instructions-file), kept in
// the stamp's `instructions-file:` line; AGENTS.md when nothing was answered.
const INSTRUCTION_NAMES = { agents: 'AGENTS.md', claude: 'CLAUDE.md' };
const instructionName = (kind) => INSTRUCTION_NAMES[kind] || INSTRUCTION_NAMES.agents;

// Where the stack's seed sits: .claude/<name> while it is there, else a root <name> (seeded or moved there on
// --instructions-at root), else .claude/<name>, where a seed goes. The ledger's `AGENTS.md` row - the seed's row,
// whatever its name - is read at this path, and only a file at that row's hash is the stack's: a root file the project
// wrote never reads as the seed.
function seededAgentsMdPath(projectRoot, kind = 'agents')
{
    const name = instructionName(kind);
    const inClaude = path.join(projectRoot, '.claude', name);
    const atRoot = path.join(projectRoot, name);
    return !fs.existsSync(inClaude) && fs.existsSync(atRoot) ? atRoot : inClaude;
}
// Where the seed the ledger's `AGENTS.md` row records actually sits: the file under either name still at that row's hash,
// .claude/ first and the install's name first. A rename the answer could not make (a root file already carried the other
// name) leaves the seed under its old name, and reading the row under the answered name hashed the project's own file
// there instead (review 2026-10-23). A root file is the row only while no .claude/ file of the install's name is there,
// as seededAgentsMdPath has it. No row, or no file at it: seededAgentsMdPath.
function locateSeed(projectRoot, kind = 'agents', held = '')
{
    if (held)
    {
        const { hashItem } = require('./library.js');
        const names = [instructionName(kind), instructionName(kind === 'claude' ? 'agents' : 'claude')];
        const atHash = (dir) => names.map((name) => path.join(dir, name)).find((at) =>
        {
            try { return hashItem(at) === held; } catch { return false; /* unreadable: not this one */ }
        });
        const found = atHash(path.join(projectRoot, '.claude'))
            || (!fs.existsSync(path.join(projectRoot, '.claude', names[0])) && atHash(projectRoot));
        if (found) return found;
    }
    return seededAgentsMdPath(projectRoot, kind);
}

function seedAgentsMd({ projectRoot, sourceDir, at = '', kind = 'agents', log = () => {}, note = () => {} })
{
    const name = instructionName(kind);
    const have = existingInstructionFile(projectRoot);
    if (have)
    {
        log(`  ${name}: ${have} is the project's own instruction file - nothing seeded, left as-is (finish its authoring outline if not done)`);
        return false;
    }
    const body = agentsMdBody({ projectRoot, sourceDir });
    if (body === null) { note('AGENTS.template.md not found in the stack source'); return false; }
    const dest = at === 'root' ? path.join(projectRoot, name) : path.join(projectRoot, '.claude', name);
    try
    {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
    }
    catch (err) { note(`${name} could not be seeded (${err.message})`); return false; }
    if (at === 'root') log(`  ${name}: seeded to ${name} at the project root - write the project top from its authoring-outline comment`);
    else log(`  ${name}: seeded to .claude/${name} - write the project top from its authoring-outline comment, and keep the '.claude/*' + '!.claude/${name}' gitignore lines so it stays committed`);
    // Claude Code reads CLAUDE.md in every version; only an AGENTS.md has a floor and a file that switches it off.
    if (name === 'AGENTS.md') log(`  ${AGENTS_MD_NOTE}${fs.existsSync(path.join(projectRoot, 'CLAUDE.local.md')) ? ' - the CLAUDE.local.md here already switches it off (Project instructions: claude-md-and-agents-md in /config reads both)' : ''}`);
    return true;
}

// UPDATE: a seed the stack still owns - unedited since the run that wrote it (the caller checks the ledger's hash) - is
// the template's until init fills it in, so it is rewritten from THIS release's template. Re-spelling the old body
// alone left the 2.5.0 seed's three capture steps as three lines naming the one capture that replaced them (the
// 2026-10-17 update matrix). True when the file now holds this release's seed.
function refreshSeededAgentsMd({ projectRoot, sourceDir, kind = 'agents', file = '', log = () => {}, note = () => {} })
{
    const dest = file || seededAgentsMdPath(projectRoot, kind);
    let now;
    try { now = fs.readFileSync(dest, 'utf8'); } catch { return false; }
    // The name the seed was stamped with, not this folder's: a second checkout under another folder name rewrote the
    // committed file's H1 on every update (install-memory.test.js). A seed whose H1 is gone is not refreshed.
    const h1 = /^# (.*)\r?\n/.exec(now);
    if (!h1) return false;
    const body = agentsMdBody({ projectRoot, sourceDir, name: h1[1] });
    if (body === null) return false;
    if (now === body) return true;
    try { fs.writeFileSync(dest, body); }
    catch (err) { note(`${path.relative(projectRoot, dest).split(path.sep).join('/')} could not be refreshed from this release's template (${err.message}) - it keeps the earlier seed`); return false; }
    log(`  ${path.basename(dest)}: the unfilled seed refreshed from this release's template - nothing in it was yours`);
    return true;
}

// UPDATE: a `.claude/CLAUDE.md` the stack seeded and nobody edited is the stack's own file, so it moves to
// the AGENTS.md name (`git mv` where git tracks it, so history follows). An edited one is the user's: left
// untouched, named with its move command, never renamed for them. A root AGENTS.md means the project's
// instructions already live there - moving would split them, so it is named and left. Returns
// 'moved' | 'kept-edited' | 'kept-root' | 'kept-both' | 'none' (a re-run finds nothing to do).
//   ledgerHash - the hash the last run recorded for `CLAUDE.md`; hash(path) - the installer's file hash
//   tracked(path) / gitMv(from, to) - injected so the module stays free of a git call of its own
// A re-include of the old name in the project's ignore files follows the rename, or the moved file is ignored.
function respellReinclude(projectRoot, files, from = 'CLAUDE.md', to = 'AGENTS.md')
{
    const done = [];
    const line = new RegExp(`^(\\s*)!(\\/?)\\.claude\\/${from.replace('.', '\\.')}(\\s*)$`, 'gm');
    for (const file of files)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const next = text.replace(line, `$1!$2.claude/${to}$3`);
        if (next === text) continue;
        fs.writeFileSync(file, next);
        done.push(path.relative(projectRoot, file).split(path.sep).join('/'));
    }
    return done;
}

function moveSeededClaudeMd({ projectRoot, sourceDir, ledgerHash = '', hash, tracked = () => false, gitMv = null, log = () => {}, note = () => {} })
{
    const from = path.join(projectRoot, '.claude', 'CLAUDE.md');
    const to = path.join(projectRoot, '.claude', 'AGENTS.md');
    if (!fs.existsSync(from)) return 'none';
    const cmd = (git) => `${git ? 'git mv' : 'mv'} .claude/CLAUDE.md .claude/AGENTS.md`;
    if (fs.existsSync(path.join(projectRoot, 'AGENTS.md')))
    {
        log(`  .claude/CLAUDE.md: left in place - the project's own root AGENTS.md holds its instructions, and moving this one would split them (${AGENTS_MD_NOTE})`);
        return 'kept-root';
    }
    if (fs.existsSync(to))
    {
        log('  .claude/CLAUDE.md: left in place - .claude/AGENTS.md exists beside it, and Claude Code ignores AGENTS.md while a CLAUDE.md is there; merge them and delete one');
        return 'kept-both';
    }
    let unedited = false;
    try
    {
        if (ledgerHash) unedited = hash(from) === ledgerHash;
        else { const seed = agentsMdBody({ projectRoot, sourceDir }); unedited = seed !== null && fs.readFileSync(from, 'utf8') === seed; }
    }
    catch { unedited = false; }
    const git = tracked(from);
    if (!unedited)
    {
        const who = ledgerHash ? 'yours, edited since the stack seeded it' : 'left as-is - with no ledger row it cannot be told from an older seed';
        log(`  .claude/CLAUDE.md: ${who}; the name ask of /alfred-code:update or configure renames it to AGENTS.md if you want (${AGENTS_MD_NOTE}), or by hand: ${cmd(git)}`);
        return 'kept-edited';
    }
    try
    {
        if (git && gitMv) gitMv(from, to);
        else fs.renameSync(from, to);
    }
    catch (err) { note(`.claude/CLAUDE.md could not be moved to .claude/AGENTS.md (${String(err.message).trim()}) - to do it by hand: ${cmd(git)}`); return 'kept-edited'; }
    log(`  .claude/CLAUDE.md -> .claude/AGENTS.md: the unedited seed moved${git ? ' (git mv, staged as a rename)' : ''}; ${AGENTS_MD_NOTE}`);
    try
    {
        if (/^\s*!\/?\.claude\/CLAUDE\.md\s*$/m.test(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8')))
            log("  .gitignore: change the re-include line to '!.claude/AGENTS.md', or the moved file is ignored");
    }
    catch { /* no .gitignore to read */ }
    return 'moved';
}

// Only the engines whose build Playwright ships itself; chrome and msedge use the installed browser.
// The user's answer to init's / configure's place question (--instructions-at): each instruction file at the other place
// moves - `git mv` where git tracks it, so history follows. A destination already holding one is never overwritten:
// both are named and left. CLAUDE.local.md stays at the root, the one place Claude Code reads it. A file moved into
// .claude/ that git now ignores (untracked, under a '.claude/*' line) is named with the re-include it needs. Returns
// the moves made, `<from> -> <to>` each.
function placeInstructionFiles({ projectRoot, at = '', tracked = () => false, gitMv = null, ignored = () => false, log = () => {}, note = () => {} })
{
    if (at !== 'root' && at !== 'claude') return [];
    const moved = [];
    for (const name of ['AGENTS.md', 'CLAUDE.md'])
    {
        const [fromRel, toRel] = at === 'root' ? [`.claude/${name}`, name] : [name, `.claude/${name}`];
        const from = path.join(projectRoot, ...fromRel.split('/'));
        const to = path.join(projectRoot, ...toRel.split('/'));
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to)) { log(`  ${fromRel}: left in place - ${fromRel} and ${toRel} both exist - merge them by hand and delete one`); continue; }
        const git = Boolean(gitMv) && tracked(from);
        try
        {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            if (git) gitMv(from, to);
            else fs.renameSync(from, to);
        }
        catch (err) { note(`${fromRel} could not be moved to ${toRel} (${String(err.message).trim()}) - to do it by hand: ${git ? 'git mv' : 'mv'} ${fromRel} ${toRel}`); continue; }
        moved.push(`${fromRel} -> ${toRel}`);
        log(`  ${fromRel} -> ${toRel}: moved on your answer${git ? ' (git mv, staged as a rename)' : ''}`);
        if (at === 'claude' && ignored(to)) log(`  !! ${toRel} is git-ignored here - add '!${toRel}' after the '.claude/*' line in .gitignore, or it stays out of git`);
    }
    return moved;
}

// The user's answer to init's / configure's name question (--instructions-file): the instruction file of the other name
// at the root and in .claude/ is renamed - `git mv` where git tracks it, so history follows - and a `!.claude/<old>`
// re-include in the ignore files follows it. A file already holding the new name is never overwritten: both are named and
// left. A part's own file (`web/AGENTS.md`, the `parts` the caller found) is renamed the same way: Claude Code reads no
// AGENTS.md at all while a CLAUDE.md sits in the working directory or above it (code.claude.com/docs/en/memory, 'When
// Claude Code reads AGENTS.md'), so a part file left under the old name would stop loading with nothing said.
// CLAUDE.local.md is Claude Code's personal file and never renamed. Returns the renames made, `<from> -> <to>` each.
function renameInstructionFiles({ projectRoot, kind = '', tracked = () => false, gitMv = null, ignoreFiles = [], parts = [], log = () => {}, note = () => {} })
{
    if (!INSTRUCTION_NAMES[kind]) return [];
    const to = INSTRUCTION_NAMES[kind];
    const from = to === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md';
    const moved = [];
    const own = ['', '.claude/'].map((dir) => `${dir}${from}`);
    // A root or .claude/ file already carrying the answered name makes the answer a Keep (or files=both, where neither is
    // renamed): nothing moves, so passing the answer on every ask records it without touching a part of the other name.
    if (['', '.claude/'].some((dir) => fs.existsSync(path.join(projectRoot, ...`${dir}${to}`.split('/'))))) return [];
    for (const fromRel of [...own, ...parts.filter((rel) => rel.endsWith(`/${from}`) && !own.includes(rel))])
    {
        const toRel = `${fromRel.slice(0, -from.length)}${to}`;
        const src = path.join(projectRoot, ...fromRel.split('/'));
        const dest = path.join(projectRoot, ...toRel.split('/'));
        if (!fs.existsSync(src)) continue;
        if (fs.existsSync(dest)) { log(`  ${fromRel}: left as it is - ${toRel} exists beside it; merge them by hand and delete one`); continue; }
        const git = Boolean(gitMv) && tracked(src);
        try
        {
            if (git) gitMv(src, dest);
            else fs.renameSync(src, dest);
        }
        catch (err) { note(`${fromRel} could not be renamed to ${toRel} (${String(err.message).trim()}) - to do it by hand: ${git ? 'git mv' : 'mv'} ${fromRel} ${toRel}`); continue; }
        moved.push(`${fromRel} -> ${toRel}`);
        log(`  ${fromRel} -> ${toRel}: renamed on your answer${git ? ' (git mv, staged as a rename)' : ''}`);
    }
    if (moved.some((m) => m.startsWith('.claude/')))
    {
        let fixed = [];
        try { fixed = respellReinclude(projectRoot, [path.join(projectRoot, '.gitignore'), ...ignoreFiles], from, to); }
        catch (err) { note(`the '!.claude/${from}' re-include line could not be re-spelled (${err.message}) - change it to '!.claude/${to}' by hand`); }
        for (const f of fixed) log(`  ${f}: the re-include line now names .claude/${to}`);
    }
    return moved;
}

// The seed's ledger row after a rename: library.hashItem folds the file name into the hash, so the same bytes under the
// other name read as the user's edit - never refreshed again, kept by uninstall. A file that still holds what the row
// recorded under the other name is re-keyed to its new one; anything else keeps the row it had.
function seedRowAfterRename(held, file)
{
    if (!held) return held;
    let buf;
    try { buf = fs.readFileSync(file); } catch { return held; }
    const { hashBuffer } = require('./library.js');
    const name = path.basename(file);
    const other = name === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md';
    return hashBuffer(other, buf) === held ? hashBuffer(name, buf) : held;
}

// The name question's fact line (update-preflight.js, the full read and --offers): the name this install works with -
// `agents` or `claude` (the stamp's answer, else AGENTS.md) - then which names the project's instruction files at the root
// and in .claude/ carry (`none`, `agents`, `claude` or `both`), the stamp's answer (`none` before 2.9.1 asked it),
// whether a CLAUDE.local.md sits at the root or in .claude/, and what an update does with it:
//   ask-rename    - no answer yet and the one CLAUDE.md is .claude/'s: the update asks with 'Rename to AGENTS.md'
//                   recommended, so an unattended update renames as 2.9.0's did (the user's rulings of 2026-10-22)
//   ask           - no answer yet otherwise (a root CLAUDE.md among them, Keep first), or the files carry the other
//                   name than the answer: the update asks once
//   record-claude - the files are CLAUDE.md beside a CLAUDE.local.md, which keeps any AGENTS.md unread (Claude Code reads
//                   AGENTS.md only while no CLAUDE.md or CLAUDE.local.md sits beside or above it): CLAUDE.md, unasked -
//                   an earlier `agents` answer included, which cannot load there and whose ask would offer a rename that
//                   stops the file loading (review 2026-10-23 kept it; said in one line)
//   none          - nothing to name, or the answer the files already carry
function instructionsFileLine(projectRoot, answer = '')
{
    const at = (rel) => fs.existsSync(path.join(projectRoot, ...rel.split('/')));
    const has = (name) => ['', '.claude/'].some((dir) => at(`${dir}${name}`));
    const a = has('AGENTS.md');
    const c = has('CLAUDE.md');
    const files = a && c ? 'both' : a ? 'agents' : c ? 'claude' : 'none';
    const said = INSTRUCTION_NAMES[answer] ? answer : '';
    const local = has('CLAUDE.local.md');
    // 2.9.0's update only ever renamed .claude/CLAUDE.md: a root CLAUDE.md is the team's own file, so it gets the plain
    // ask, Keep first, and an unattended update leaves it be.
    const update = files === 'none' ? 'none'
        : local && files === 'claude' && said !== 'claude' ? 'record-claude'
            : !said && files === 'claude' && !at('CLAUDE.md') ? 'ask-rename'
                : !said || (files !== 'both' && files !== said) ? 'ask' : 'none';
    return `instructions-file: ${said || 'agents'} files=${files} answer=${said || 'none'} local=${local ? 'yes' : 'no'} update=${update}`;
}

// The place question's fact line (update-preflight.js --offers): where the instruction files are - `none`, `claude`
// (all under .claude/), `root` or `split` - then each one found.
function instructionsLine(projectRoot)
{
    const have = ['AGENTS.md', 'CLAUDE.md', '.claude/AGENTS.md', '.claude/CLAUDE.md'].filter((rel) => fs.existsSync(path.join(projectRoot, ...rel.split('/'))));
    if (!have.length) return 'instructions: none';
    const inClaude = have.filter((rel) => rel.startsWith('.claude/')).length;
    return `instructions: ${inClaude === have.length ? 'claude' : inClaude ? 'split' : 'root'} ${have.join(' ')}`;
}

function playwrightDownloads({ browsers = [], pin = '', run, log = () => {} })
{
    const done = [];
    for (const engine of browsers)
    {
        if (!DOWNLOADED_ENGINES.includes(engine)) continue;
        log(`browser: downloading the ${engine} build the server launches`);
        if (run(engine)) { done.push(engine); continue; }
        log(`  !! could not download ${engine} - run by hand: npx -y -p @playwright/mcp${pin} playwright install ${engine}`);
    }
    return done;
}

module.exports = { seedAccountEnv, seedAccountKeys, seedAgentsMd, seededAgentsMdPath, locateSeed, refreshSeededAgentsMd, agentsMdBody, moveSeededClaudeMd, respellReinclude, seedRowAfterRename, placeInstructionFiles, renameInstructionFiles, instructionName, instructionsLine, instructionsFileLine, playwrightDownloads };
