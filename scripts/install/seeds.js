'use strict';
// THE SMALL SEEDS - the per-project files and account values a run lays down once.
//
//   - `CLAUDE.md`, from the stack-neutral template, ONLY when the project has neither
//     `./CLAUDE.md` nor `./.claude/CLAUDE.md`. Claude Code auto-loads either, so seeding beside an
//     existing one would leave two copies of the project's instructions.
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

// The same pattern meta/environment.json calls secret_key_pattern.
const SECRET_KEY = /(TOKEN|SECRET|KEY|PASSWORD|PASSWD|DSN|CREDENTIAL|AUTH)$/;
const PROJECT_NAME_TOKEN = '__PROJECT_NAME__';
const DOWNLOADED_ENGINES = ['firefox', 'webkit'];

// Written to the account file, never to argv: argv is readable by every process on the box.
function seedAccountEnv({ configDir, key, value, log = () => {}, note = () => {} })
{
    const file = path.join(configDir, 'settings.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
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

// 'KEY=set (N chars)' or 'KEY=absent' - a length, never a value.
function accountKeyState(configDir, key)
{
    let value = '';
    try { value = String(JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')).env?.[key] ?? ''); }
    catch { value = ''; }
    return value.trim() ? `${key}=set (${value.length} chars)` : `${key}=absent`;
}

// INSTALL only, once. The H1 placeholder is stamped with the repo folder name - the same __TOKEN__
// convention as the docs-root rule, and because the seed runs once a hand-written title is never
// clobbered.
// The body the seed writes into .claude/CLAUDE.md for this project, or null with no template - also the
// ledger fallback's test that a CLAUDE.md is still the unfilled seed (R10).
function claudeMdBody({ projectRoot, sourceDir })
{
    let body;
    try { body = fs.readFileSync(path.join(sourceDir, 'stack', 'CLAUDE.template.md'), 'utf8'); } catch { return null; }
    body = body.split(PROJECT_NAME_TOKEN).join(path.basename(projectRoot));
    // Claude reads a root AGENTS.md on its own only while no CLAUDE.md exists, so the seed would switch it
    // off: a live import under the H1 keeps it loading (resolved against this file, hence the '../').
    return fs.existsSync(path.join(projectRoot, 'AGENTS.md')) ? body.replace(/^(#[^\n]*\n)/, '$1\n@../AGENTS.md\n') : body;
}

function seedClaudeMd({ projectRoot, sourceDir, log = () => {}, note = () => {} })
{
    if (fs.existsSync(path.join(projectRoot, 'CLAUDE.md')) || fs.existsSync(path.join(projectRoot, '.claude', 'CLAUDE.md')))
    {
        log('  CLAUDE.md: already present - left as-is (finish its authoring outline if not done)');
        return false;
    }
    const body = claudeMdBody({ projectRoot, sourceDir });
    if (body === null) { note('CLAUDE.template.md not found in the stack source'); return false; }
    const dest = path.join(projectRoot, '.claude', 'CLAUDE.md');
    const agents = fs.existsSync(path.join(projectRoot, 'AGENTS.md'));
    try
    {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, body);
    }
    catch (err) { note(`CLAUDE.md could not be seeded (${err.message})`); return false; }
    if (agents) log('  AGENTS.md: imported from the seeded .claude/CLAUDE.md (@../AGENTS.md), so it keeps loading');
    log("  CLAUDE.md: seeded to .claude/CLAUDE.md - write the project top from its authoring-outline comment, and keep the '.claude/*' + '!.claude/CLAUDE.md' gitignore lines so it stays committed");
    return true;
}

// Only the engines whose build Playwright ships itself; chrome and msedge use the installed browser.
function playwrightDownloads({ browsers = [], pin = '', run, log = () => {} })
{
    const done = [];
    for (const engine of browsers)
    {
        if (!DOWNLOADED_ENGINES.includes(engine)) continue;
        log(`playwright: downloading the ${engine} build the server launches`);
        if (run(engine)) { done.push(engine); continue; }
        log(`  !! could not download ${engine} - run by hand: npx -y -p @playwright/mcp${pin} playwright install ${engine}`);
    }
    return done;
}

module.exports = { seedAccountEnv, seedAccountKeys, accountKeyState, seedClaudeMd, claudeMdBody, playwrightDownloads, SECRET_KEY, PROJECT_NAME_TOKEN };
