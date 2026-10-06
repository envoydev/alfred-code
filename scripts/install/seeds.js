'use strict';
// THE SMALL SEEDS - the per-project files and account values a run lays down once.
//
//   - `.claude/AGENTS.md`, from the stack-neutral template, ONLY when the project has no `AGENTS.md`,
//     `.claude/AGENTS.md`, `CLAUDE.md` or `.claude/CLAUDE.md` - beside a CLAUDE.md the seed would never load,
//     beside another AGENTS.md it would be a second copy of the project's instructions. A root AGENTS.md is
//     the project's own file: checked and improved in place, never overwritten.
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
function agentsMdBody({ projectRoot, sourceDir })
{
    let body;
    try { body = fs.readFileSync(path.join(sourceDir, 'stack', 'AGENTS.template.md'), 'utf8'); } catch { return null; }
    return body.split(PROJECT_NAME_TOKEN).join(path.basename(projectRoot));
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

function seedAgentsMd({ projectRoot, sourceDir, log = () => {}, note = () => {} })
{
    const have = existingInstructionFile(projectRoot);
    if (have)
    {
        log(`  AGENTS.md: ${have} is the project's own instruction file - nothing seeded, left as-is (finish its authoring outline if not done)`);
        return false;
    }
    const body = agentsMdBody({ projectRoot, sourceDir });
    if (body === null) { note('AGENTS.template.md not found in the stack source'); return false; }
    const dest = path.join(projectRoot, '.claude', 'AGENTS.md');
    try
    {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
    }
    catch (err) { note(`AGENTS.md could not be seeded (${err.message})`); return false; }
    log("  AGENTS.md: seeded to .claude/AGENTS.md - write the project top from its authoring-outline comment, and keep the '.claude/*' + '!.claude/AGENTS.md' gitignore lines so it stays committed");
    log(`  ${AGENTS_MD_NOTE}${fs.existsSync(path.join(projectRoot, 'CLAUDE.local.md')) ? ' - the CLAUDE.local.md here already switches it off (Project instructions: claude-md-and-agents-md in /config reads both)' : ''}`);
    return true;
}

// UPDATE: a `.claude/CLAUDE.md` the stack seeded and nobody edited is the stack's own file, so it moves to
// the AGENTS.md name (`git mv` where git tracks it, so history follows). An edited one is the user's: left
// untouched, named with its move command, never renamed for them. A root AGENTS.md means the project's
// instructions already live there - moving would split them, so it is named and left. Returns
// 'moved' | 'kept-edited' | 'kept-root' | 'kept-both' | 'none' (a re-run finds nothing to do).
//   ledgerHash - the hash the last run recorded for `CLAUDE.md`; hash(path) - the installer's file hash
//   tracked(path) / gitMv(from, to) - injected so the module stays free of a git call of its own
// The update ask's line (update-preflight.js): `.claude/CLAUDE.md` with no AGENTS.md to clash with is offered for a
// rename, edited or not - the user's report of 2026-10-06 ('I need to rename from CLAUDE.md to AGENTS.md manually').
// Unedited, the run moves it anyway; a yes (`--rename-claude-md`) moves the user's own too.
function claudeMdOffer(projectRoot)
{
    const from = path.join(projectRoot, '.claude', 'CLAUDE.md');
    if (!fs.existsSync(from)) return 'agents-md: none (no .claude/CLAUDE.md)';
    if (fs.existsSync(path.join(projectRoot, 'AGENTS.md'))) return 'agents-md: none (the root AGENTS.md holds the instructions - merge .claude/CLAUDE.md by hand)';
    if (fs.existsSync(path.join(projectRoot, '.claude', 'AGENTS.md'))) return 'agents-md: none (.claude/AGENTS.md exists beside it - merge them by hand)';
    // Claude Code skips AGENTS.md while a CLAUDE.local.md sits beside or above it, so the renamed file would go unread.
    for (const local of [path.join(projectRoot, '.claude', 'CLAUDE.local.md'), path.join(projectRoot, 'CLAUDE.local.md')])
        if (fs.existsSync(local)) return `agents-md: none (${path.relative(projectRoot, local).split(path.sep).join('/')} would keep a renamed AGENTS.md from loading)`;
    return 'agents-md: offer .claude/CLAUDE.md -> .claude/AGENTS.md';
}

// A re-include of the old name in the project's ignore files follows the rename, or the moved file is ignored.
function respellReinclude(projectRoot, files)
{
    const done = [];
    for (const file of files)
    {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const next = text.replace(/^(\s*)!(\/?)\.claude\/CLAUDE\.md(\s*)$/gm, '$1!$2.claude/AGENTS.md$3');
        if (next === text) continue;
        fs.writeFileSync(file, next);
        done.push(path.relative(projectRoot, file).split(path.sep).join('/'));
    }
    return done;
}

function moveSeededClaudeMd({ projectRoot, sourceDir, ledgerHash = '', hash, tracked = () => false, gitMv = null, force = false, ignoreFiles = [], log = () => {}, note = () => {} })
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
    if (!unedited && !force)
    {
        const who = ledgerHash ? 'yours, edited since the stack seeded it' : 'left as-is - with no ledger row it cannot be told from an older seed';
        log(`  .claude/CLAUDE.md: ${who}; the stack's file is AGENTS.md now (${AGENTS_MD_NOTE}), to rename it: ${cmd(git)}`);
        return 'kept-edited';
    }
    try
    {
        if (git && gitMv) gitMv(from, to);
        else fs.renameSync(from, to);
    }
    catch (err) { note(`.claude/CLAUDE.md could not be moved to .claude/AGENTS.md (${String(err.message).trim()}) - to do it by hand: ${cmd(git)}`); return 'kept-edited'; }
    log(`  .claude/CLAUDE.md -> .claude/AGENTS.md: ${unedited ? 'the unedited seed' : 'your file, on your answer,'} moved${git ? ' (git mv, staged as a rename)' : ''}; ${AGENTS_MD_NOTE}`);
    if (force)
    {
        let fixed = [];
        try { fixed = respellReinclude(projectRoot, [path.join(projectRoot, '.gitignore'), ...ignoreFiles]); }
        catch (err) { note(`the '!.claude/CLAUDE.md' re-include line could not be re-spelled (${err.message}) - change it to '!.claude/AGENTS.md' by hand`); }
        for (const f of fixed) log(`  ${f}: the re-include line now names .claude/AGENTS.md`);
        return 'moved';
    }
    try
    {
        if (/^\s*!\/?\.claude\/CLAUDE\.md\s*$/m.test(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8')))
            log("  .gitignore: change the re-include line to '!.claude/AGENTS.md', or the moved file is ignored");
    }
    catch { /* no .gitignore to read */ }
    return 'moved';
}

// Only the engines whose build Playwright ships itself; chrome and msedge use the installed browser.
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

module.exports = { seedAccountEnv, seedAccountKeys, seedAgentsMd, agentsMdBody, moveSeededClaudeMd, claudeMdOffer, respellReinclude, playwrightDownloads };
