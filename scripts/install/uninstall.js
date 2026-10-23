'use strict';
// UNINSTALL (R10) - the stack out of THIS project, and nothing of the user's with it.
//
// The ledger in the stamp (stamp.js `managed-*`, `library-*`) is the whole list: what the installer
// wrote here, each at the hash it wrote it with. Whatever the ledger does not name - a key, a hook, a
// server, a skill the user added - is theirs, and so is anything changed since the stack wrote it: kept,
// and said. A stamp from before the ledger names nothing exactly, so it is refused with the route to
// take (one update writes the ledger), rather than guessed at.
//
// The plugin rows follow the install's scope. At project and local scope the rows are this project's
// own, so they are uninstalled. A USER-scope row serves every project on the account - uninstalling it
// from here would take the stack out of all of them - so its commands are printed and never run
// (ruling). A third-party pick may be in use on its own, and the marketplace registration is the
// account's: both are printed the same way. The MCP copy route's registrations follow the same rule
// (review finding 7): a local-scope one is removed, a user-scope one printed. And since the user-scope
// core stays loaded, a user-scope uninstall keeps the seats denied here and ALFRED_CODE_HOOKS_OFF, so
// what the user switched off stays off (finding 8). A plugin listing that cannot be read is refused
// before any change (finding 3) - acted on as empty, it would remove no row and then drop the stamp.
//
// The order is plugins first (the hooks stop loading), then .mcp.json and the account-scope
// registrations, the settings entries, the copies, and the stamp LAST - only when nothing failed, so a
// re-run finishes what this one could not.
const fs = require('node:fs');
const path = require('node:path');
const { hashItem } = require('./library.js');
const { commonJsScope } = require('./copy.js');
const { entryHash } = require('./stamp.js');
const { locateSeed } = require('./seeds.js');

const isMarker = (file) => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Object.keys(j).length === 1 && j.type === 'commonjs'; } catch { return false; } };

// The instruction-file seeds the ledger records, each where it sits now: the `AGENTS.md` row under either name
// (locateSeed - review 2026-10-23: a rename the answer could not make), and a 2.1.6 install's `CLAUDE.md` row, the
// .claude/CLAUDE.md it seeded. One reading for the preview and the removal, so the question and the deletion agree.
function seedRows({ projectRoot, files = {}, instructionsKind = 'agents' })
{
    return [
        files['AGENTS.md'] && { row: 'AGENTS.md', at: locateSeed(projectRoot, instructionsKind, files['AGENTS.md']), held: files['AGENTS.md'] },
        files['CLAUDE.md'] && { row: 'CLAUDE.md', at: path.join(projectRoot, '.claude', 'CLAUDE.md'), held: files['CLAUDE.md'] },
    ].filter(Boolean);
}

// What an uninstall would do with each seed - read only, the preview /alfred-code:uninstall asks from (the user's ask of
// 2026-10-23): the seed's path from the project root, and `unedited` (still at its row's hash - removed only on
// `--instructions-seed remove`) or `edited` (the project's, kept); a row with no file at it is left out.
function seedPlan({ projectRoot, files = {}, instructionsKind = 'agents' })
{
    return seedRows({ projectRoot, files, instructionsKind }).map(({ at, held }) =>
    {
        const have = hashItem(at);
        return { rel: path.relative(projectRoot, at).split(path.sep).join('/'), state: !have ? 'none' : have === held ? 'unedited' : 'edited' };
    }).filter((p) => p.state !== 'none');
}

// Every library copy (library-*) and every other copy (managed-files) whose hash still matches - but the instruction-file
// seed only on the user's `seed: 'remove'` answer: it is the one file the project reads as its own instructions, so the
// uninstall asks before it goes (2026-10-23).
function removeManagedFiles({ claudeDir, skillsDir, library = {}, files = {}, instructionsKind = 'agents', seed = '', log = () => {} })
{
    const seeds = new Map(seedRows({ projectRoot: path.dirname(claudeDir), files, instructionsKind }).map((r) => [r.row, r.at]));
    const items = [
        ...Object.entries(library.skills || {}).map(([n, h]) => ['skill', n, path.join(skillsDir, n), h]),
        ...Object.entries(library.agents || {}).map(([n, h]) => ['agent', n, path.join(claudeDir, 'agents', `${n}.md`), h]),
        ...Object.entries(library.rules || {}).map(([n, h]) => ['rule', n, path.join(claudeDir, 'rules', `${n}.md`), h]),
        ...Object.entries(files).map(([rel, h]) =>
        {
            const [kind, name] = rel.includes('/') ? rel.split('/') : ['file', rel];
            // A seed's row is read where the seed sits (seedRows).
            const at = seeds.has(rel) ? seeds.get(rel) : kind === 'skills' ? path.join(skillsDir, name) : path.join(claudeDir, ...rel.split('/'));
            return [kind.replace(/s$/, ''), name, at, h];
        }),
    ];
    // Review finding 4: whatever the stamp named, nothing outside its own .claude folder is ever removed -
    // the item must sit directly inside the folder of its kind (a skill directory, a seat or rule file). The one exception
    // is the seed at the project root - that exact file, at the hash the stack wrote.
    const home = { skill: skillsDir, agent: path.join(claudeDir, 'agents'), rule: path.join(claudeDir, 'rules'), hook: path.join(claudeDir, 'hooks'), file: claudeDir };
    const seedPaths = new Set([...seeds.values()].map((at) => path.resolve(at)));
    const isSeed = (label, at) => label === 'file' && seedPaths.has(path.resolve(at));
    const inside = (label, at) => (Boolean(home[label]) && path.dirname(path.resolve(at)) === path.resolve(home[label])) || isSeed(label, at);
    for (const [label, name, at, hash] of items)
    {
        if (!inside(label, at)) { log(`  ${label} name skipped (${String(name).length} chars) - not an item inside its .claude folder`); continue; }
        const have = hashItem(at);
        if (!have) continue;
        if (have !== hash) { log(`  ${label} ${name}: kept - changed since the stack wrote it, so it is yours`); continue; }
        if (isSeed(label, at) && seed !== 'remove')
        {
            const rel = path.relative(path.dirname(claudeDir), at).split(path.sep).join('/');
            log(seed === 'keep' ? `  ${rel}: kept on your answer - the instruction file the stack seeded, unedited`
                : `  ${rel}: kept - the instruction file the stack seeded, unedited; it goes only with --instructions-seed remove (/alfred-code:uninstall asks)`);
            continue;
        }
        fs.rmSync(at, { recursive: true, force: true });
        log(`  ${label} removed: ${name}`);
    }
    // The CommonJS marker the installer wrote beside its hook copies goes once nothing else is left there.
    // Review finding 14: it scopes EVERY .js in the folder, so while a file of the user's is left (their
    // own hook, or a stack copy they edited and so kept) it stays - taking it would break a CommonJS hook
    // in a "type": "module" project.
    const hooksDir = path.join(claudeDir, 'hooks');
    let left = [];
    try { left = fs.readdirSync(hooksDir).filter((f) => f !== 'package.json'); } catch { left = []; }
    if (!left.length) commonJsScope({ dir: hooksDir, stackFiles: [], log });
    else if (isMarker(path.join(hooksDir, 'package.json'))) log(`  hooks marker kept: package.json - it scopes ${left.join(', ')}, left in .claude/hooks as yours`);
    for (const dir of [skillsDir, ...['agents', 'rules', 'hooks'].map((d) => path.join(claudeDir, d))])
    {
        try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* absent, or not ours to empty */ }
    }
}

// The stack's plugin rows (`rows`: every scope's, parsePluginList everyScope) at this install's scope. A
// dependency is refused while its dependent is installed, so a refusal is retried once the pass has
// taken everything else - as many passes as there are rows at most.
function removePlugins({ rows = [], market, scope, thirdParty = [], cli, log = () => {}, note = () => {} })
{
    const ours = rows.filter((r) => r.marketplace === market && r.version);
    let left = [];
    for (const r of ours)
    {
        const spec = `${r.name}@${r.marketplace}`;
        const at = r.scope || scope;
        if (at === scope && scope !== 'user') { if (!left.includes(spec)) left.push(spec); continue; }
        if (at === 'managed') log(`  ${spec} is installed at managed scope - your organization's managed settings own it, so it is not removed here; only an admin removes it`);
        else if (at === 'user') log(`  ${spec} is installed at user scope - every project on this account loads it, so it is not removed here: claude plugin uninstall ${spec} --scope user (or, for this project only: claude plugin disable ${spec} --scope project)`);
        else log(`  ${spec} is installed at ${at} scope, not this install's - not removed here: claude plugin uninstall ${spec} --scope ${at}`);
    }
    for (let pass = 0; pass < ours.length && left.length; pass++)
    {
        const next = left.filter((spec) =>
        {
            if (!cli(['plugin', 'uninstall', spec, '--scope', scope, '-y'], { quiet: true, expect: 'reported' })) return true;
            log(`  plugin uninstalled [${scope}]: ${spec}`);
            return false;
        });
        if (next.length === left.length) break;
        left = next;
    }
    for (const spec of left) note(`plugin uninstall failed: ${spec} - remove it by hand: claude plugin uninstall ${spec} --scope ${scope}`);
    for (const r of rows.filter((x) => thirdParty.includes(`${x.name}@${x.marketplace}`) && x.version))
        log(r.scope === 'managed'
            ? `  ${r.name}@${r.marketplace} (a third-party pick) is installed at managed scope - your organization's managed settings own it; only an admin removes it`
            : `  ${r.name}@${r.marketplace} (a third-party pick) is not removed - it may be in use on its own; if not: claude plugin uninstall ${r.name}@${r.marketplace} --scope ${r.scope || scope}`);
    return { left };
}

// Review finding 7: the MCP copy route's local- and user-scope registrations (the ledger's `mcpAt`), read
// from the account file (`readAt(scope)`, mcp.registrationsAt). A local one is this project's own, so it
// is removed through the CLI; a user-scope one serves every project on the account, so its command is
// printed and never run - the plugin rows' ruling. One changed since the stack registered it is the
// user's, kept and said. An account file that cannot be read removes nothing, and keeps the stamp.
function removeScopedMcp({ mcpAt = {}, readAt, cli, log = () => {}, note = () => {} })
{
    const printUser = (name) => log(`  mcp ${name} is registered at user scope - every project on this account loads it, so it is not removed here: claude mcp remove ${name} -s user`);
    for (const scope of ['local', 'user'])
    {
        const managed = mcpAt[scope] || {};
        if (!Object.keys(managed).length) continue;
        const regs = readAt(scope);
        if (regs.state === 'unreadable')
        {
            if (scope === 'user') { Object.keys(managed).forEach(printUser); continue; }
            note(`${regs.file} could not be read - no local-scope registration of the stack's was removed (${Object.keys(managed).join(', ')}); fix the file and run uninstall again`);
            continue;
        }
        for (const [name, hash] of Object.entries(managed))
        {
            const entry = regs.servers[name];
            if (!entry) continue;
            if (entryHash(entry) !== hash) { log(`  mcp ${name}: kept - the ${scope}-scope registration changed since the stack registered it, so it is yours; if it should go: claude mcp remove ${name} -s ${scope}`); continue; }
            if (scope === 'user') { printUser(name); continue; }
            if (cli(['mcp', 'remove', name, '-s', 'local'], { quiet: true, expect: 'reported' })) log(`  mcp removed: ${name} (local scope)`);
            else note(`mcp remove failed: ${name} - remove it by hand: claude mcp remove ${name} -s local`);
        }
    }
}

module.exports = { seedPlan, removeManagedFiles, removePlugins, removeScopedMcp };

// `node uninstall.js seed <project root>` - seedPlan over the stamp's ledger, nothing written: one
// `instructions-seed: <path> unedited|edited` line per seed, or `instructions-seed: none` (no stamp, no ledger, no seed).
if (require.main === module)
{
    require('../../stack/hooks/hook-prelude.js').blockingStdio();
    const [cmd, root = '.'] = process.argv.slice(2);
    if (cmd !== 'seed') { process.stderr.write('usage: node uninstall.js seed <project root>\n'); process.exit(2); }
    const stamp = require('./stamp.js');
    const projectRoot = path.resolve(root);
    const file = stamp.stampFiles({ projectRoot }).read;
    const ledger = file ? stamp.readLedger(file) : null;
    const plans = ledger ? seedPlan({ projectRoot, files: ledger.files || {}, instructionsKind: stamp.readInstructionsFile(file) }) : [];
    process.stdout.write(plans.length ? plans.map((p) => `instructions-seed: ${p.rel} ${p.state}\n`).join('') : 'instructions-seed: none\n');
}
