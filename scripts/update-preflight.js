#!/usr/bin/env node
'use strict';
// update-preflight.js - everything /alfred-code:update needs to know BEFORE it runs the
// installer, in ONE call. It wraps stamp-compare.js and adds the two things the command
// used to compute by hand, in the model, in three more round trips:
//
//   - the migrations catalog's `detect` rules, EVALUATED here. They are purely declarative
//     (file_exists / settings_env_key / settings_env_value / settings_env_prefix /
//     settings_hook_wired) and there was no runner, so the command read all of
//     meta/migrations.json into context - the maintainer `_comment` included - and hand-wrote
//     probes for each entry. Measured: four API round trips and a catalog dump for what is a
//     3-line existence check.
//   - the scope settings.json `env` KEY NAMES, as a before-state. The close-out asserted
//     'no key renamed, reset or newly seeded' with nothing to diff against; a name set taken
//     before the run makes that line a comparison instead of a claim. Names only - a VALUE
//     never leaves this script, so the credential in that file cannot reach a transcript.
//
// Output is the stamp-compare line contract, unchanged and first (so every existing branch
// still reads), then:
//
//   legacy-stamp: <path> - ...             (only when the baseline is a 1.x global install's account stamp)
//   changed: skills=<n> agents=<n> rules=<n> hooks=<n> template=<yes|no>
//   validate: yes|no                        (the version delta spans more than one release)
//   policy-rev: current|none|stale installed=<hash|none> snapshot=<hash|none>
//   migration: <id>\t<detect kind>          (one line per DETECTED entry; none -> no lines)
//   migrations: none detected               (only when none fired)
//   new: <category> <name>\t<verdict>\t<entry|->[\t<take|leave>][\tenables=<csv>][\tcopies=<csv>][\tfrom=<old>][\twas-off]
//                                           (one line per item the release ADDED or RENAMED,
//                                           classified by derive-state's classifyNew against THIS
//                                           install: arrives | renamed | offer | off | unknown;
//                                           'new: none' if none)
//   docs-move: offer <from> -> <to>\ttracked=<n> untracked=<n>[\tconflicts=<n>]
//            | repoint <from> -> <to> (nothing to move) | none (<why>)
//                                           (the one-time move out of the old default docs root;
//                                           a project install only)
//   env-keys: <comma-separated key names>   (or 'env-keys: none')
//   unattended: on                          (only with ALFRED_CODE_UNATTENDED=1)
//
// Exit codes are stamp-compare's, passed through so the caller's branching is unchanged:
// 0 = compare done, 2 = no stamp, 3 = compare unreachable. A usage error is 1.
//
// `--log <installer-log>` is a SEPARATE post-install mode (no --snapshot needed): it reads the
// installer's own log - the command already captures it via the fixed `tee "$TMP/install.log"`
// form - and prints the RESTART/'!!' facts the update close-out used to judge from a raw grep
// dump in the model, one of two report rows the update.md BLOCKER measured missing 1-in-4/1-in-5:
//
//   restart: yes|no                         (mcps=<n> above 0 in the log, --hooks <n> above 0, or a
//                                           moved docs root)
//   warn: <line>                            (one per '!!' fail-soft line; none printed if none)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn
const { isCore, rowOn, marketKey, stampFile: stampIn } = require('./install/brand.js');

function arg(name, fallback)
{
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

function readJson(file)
{
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

// One migration entry's `detect` against the install root. Unknown kinds never fire - a
// catalog written by a newer release must not make an older preflight claim a detection.
const isEnvDetect = (entry) => Object.keys((entry && entry.detect) || {}).some((k) => k.startsWith('settings_env_'));

function detects(entry, root, settings)
{
    const d = (entry && entry.detect) || {};
    if (d.file_exists) return fs.existsSync(path.resolve(root, d.file_exists));
    if (d.settings_env_key) return !!(settings && settings.env && Object.prototype.hasOwnProperty.call(settings.env, d.settings_env_key));
    if (d.settings_env_value) return !!(settings && settings.env && String(settings.env[d.settings_env_value.key]) === String(d.settings_env_value.equals));
    if (d.settings_env_prefix) return !!(settings && settings.env && Object.keys(settings.env).some((k) => k.startsWith(d.settings_env_prefix)));
    if (d.settings_hook_wired)
    {
        const [file, matcher] = String(d.settings_hook_wired).split('::');
        const hooks = (settings && settings.hooks) || {};
        for (const [event, groups] of Object.entries(hooks))
        {
            if (matcher && event !== matcher) continue;
            for (const g of Array.isArray(groups) ? groups : [])
                for (const h of (g && g.hooks) || [])
                    if (String((h && h.command) || '').includes(file)) return true;
        }
        return false;
    }
    return false;
}

function detectKind(entry)
{
    return Object.keys((entry && entry.detect) || {})[0] || 'unknown';
}

// The actionable fields of ONE fired entry, as `label, value` pairs. Only what the caller acts
// on: the reason it names in the report, the follow-up it prints, and the edits it applies.
function migrationFields(e)
{
    const out = [];
    if (e.why) out.push(['why', e.why]);
    if (e.then) out.push(['then', e.then]);
    if (Array.isArray(e.remove) && e.remove.length) out.push(['remove', e.remove.join(', ')]);
    if (e.unwire_settings_hook) out.push(['unwire', e.unwire_settings_hook]);
    if (e.rename_settings_env) out.push(['env-rename', `${e.rename_settings_env.from} -> ${e.rename_settings_env.to}`]);
    if (e.rename_settings_env_prefix) out.push(['env-rename-prefix', `${e.rename_settings_env_prefix.from}* -> ${e.rename_settings_env_prefix.to}*`]);
    if (e.remove_settings_env) out.push(['env-remove', e.remove_settings_env.key]);
    if (e.clear_settings_env) out.push(['env-reset', `${e.clear_settings_env.key}: ${e.clear_settings_env.when_value} -> ${e.clear_settings_env.to}`]);
    return out;
}

// The compare's stack-owned paths, bucketed by the install class they land in. The update
// close names what the release actually refreshed from THIS, not from the installer's log
// tail (which counts everything it copied - it re-copies every file on every run).
function changedClasses(compareLines)
{
    const n = { skills: 0, agents: 0, rules: 0, hooks: 0, template: false };
    const seen = { skills: new Set(), agents: new Set(), rules: new Set(), hooks: new Set() };
    for (const line of compareLines)
    {
        const m = /^(modified|added|removed|renamed)\t([^\t]+)/.exec(line);
        if (!m) continue;
        const p = m[2];
        // Distinct ITEMS, not files: a skill is its folder, so SKILL.md plus its references count once
        // (measured: skills=108 reported against 78 shipped).
        const item = /^stack\/(skills|agents|rules|hooks)\/([^/]+)/.exec(p);
        if (item) seen[item[1]].add(item[2]);
        else if (/^stack\/CLAUDE\.template\.md$/.test(p)) n.template = true;
    }
    for (const k of Object.keys(seen)) n[k] = seen[k].size;
    return n;
}

// Version-delta span, from the compare's own `version: <old> -> <new>` line - no second call,
// no re-derivation: the same string stamp-compare already printed. Major/minor moving is always
// multi-release; a patch-only move is multi-release past a single step.
function parseVersion(v)
{
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function spansMultipleReleases(versionLine)
{
    const m = /^version: (\S+) -> (\S+)$/.exec(versionLine || '');
    if (!m) return false;
    const a = parseVersion(m[1]);
    const b = parseVersion(m[2]);
    if (!a || !b) return false;
    if (a[0] !== b[0] || a[1] !== b[1]) return true;
    return (b[2] - a[2]) > 1;
}

// The items a release ADDED, from the compare's own lines: a skill is new when its SKILL.md is, a
// seat, rule or hook when its one file is. A file added inside an existing skill is no new item.
const ITEM_PATHS = [
    ['skill', /^stack\/skills\/([^/]+)\/SKILL\.md$/],
    ['agent', /^stack\/agents\/([^/]+)\.md$/],
    ['rule', /^stack\/rules\/([^/]+)\.md$/],
    ['hook', /^stack\/hooks\/([^/]+)\.js$/],
];
// A rename (`renamed\t<new>\t<- <old>`) keeps its old name as `from`, and whether the old COPY is
// on disk - that is what decides that the update carries it rather than offering it.
const OLD_COPY = { skill: (d, n) => path.join(d, 'skills', n, 'SKILL.md'), agent: (d, n) => path.join(d, 'agents', `${n}.md`), rule: (d, n) => path.join(d, 'rules', `${n}.md`), hook: (d, n) => path.join(d, 'hooks', `${n}.js`) };
// A name the snapshot's `renamed` map (meta/stack-manifest.json) carries is the same item continuing
// even when the compare saw only an add - git reports a rewritten folder as added plus removed.
const RENAMED_KIND = { skill: 'skills', agent: 'agents' };
function addedItems(compareLines, claudeDir, renamed = {})
{
    const out = [];
    for (const line of compareLines)
    {
        const m = /^(added|renamed)\t([^\t]+)(?:\t<- (.+))?$/.exec(line);
        if (!m) continue;
        for (const [category, re] of ITEM_PATHS)
        {
            const hit = re.exec(m[2]);
            if (!hit || out.some((o) => o.category === category && o.name === hit[1])) continue;
            const item = { category, name: hit[1] };
            const old = m[3] ? re.exec(m[3]) : null;
            const mapped = Object.entries(renamed[RENAMED_KIND[category]] || {}).find(([, to]) => to === hit[1]);
            const from = old && old[1] !== hit[1] ? old[1] : mapped && mapped[0];
            if (from) { item.from = from; item.oldOnDisk = fs.existsSync(OLD_COPY[category](claudeDir, from)); }
            out.push(item);
        }
    }
    return out;
}

// The library items this project already holds as copies - a new rule whose closure pulls only
// these costs nothing to take.
function libraryCopies(claudeDir)
{
    const list = (dir, keep) => { try { return fs.readdirSync(dir).filter(keep); } catch { return []; } };
    return {
        skills: list(path.join(claudeDir, 'skills'), (d) => fs.existsSync(path.join(claudeDir, 'skills', d, 'SKILL.md'))),
        agents: list(path.join(claudeDir, 'agents'), (f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
    };
}

// The stack's rows of `claude plugin list --json`, or null when it cannot be read - a verdict on a
// listing nobody read would offer items the project already carries. `--listing <file>` stands in
// for the CLI (tests, or a listing the caller already captured). With no `--marketplace` the key is
// the one the installed core lives under - a 1.x install keeps its old key.
function readListing(root, marketplace)
{
    const { parsePluginList } = require('./install/plugins.js');
    const file = arg('--listing');
    let text = null;
    if (file) { try { text = fs.readFileSync(file, 'utf8'); } catch { text = null; } }
    else
    {
        const r = rt.spawnCommand('claude', ['plugin', 'list', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
        text = r.status === 0 ? String(r.stdout || '') : null;
    }
    try { JSON.parse(text); } catch { return null; }
    // THIS project's rows and the account's, as the seed reads them: the listing also prints other
    // projects' project-scope rows, which may carry the other key.
    const ours = parsePluginList(text, root, { byMarketplace: true });
    return parsePluginList(text, root, { marketplace: marketplace || marketKey({ listing: ours }) });
}

// M8 (Task 22 fix round 1): the stamp's picks by kind, bare names - null when it records none, so a
// renamed item is never judged declined on a stamp that could not say.
function pickedByKind(stampFile, splitPick)
{
    const picks = require('./install/stamp.js').readPicked(stampFile);
    const names = (list) => new Set(list.map((e) => splitPick(e).name));
    return picks && { skill: names(picks.skills), agent: names(picks.agents) };
}

function newItemLines({ root, claudeDir, snapshot, settings, stampFile, compareLines, routes })
{
    const { classifyNew, splitPick } = require('./derive-state.js');
    // Only what this release actually ships, BEFORE the listing is read: a path that names no item
    // (an engine, a README) must not cost a `claude plugin list` call.
    const found = addedItems(compareLines, claudeDir, (readJson(path.join(snapshot, 'meta', 'stack-manifest.json')) || {}).renamed || {});
    const shipped = new Set(classifyNew({ added: found, routes: {} }).map((r) => `${r.category} ${r.name}`));
    const added = found.filter((a) => shipped.has(`${a.category} ${a.name}`));
    if (!added.length) return ['new: none'];
    const listing = readListing(root, arg('--marketplace'));
    const s = settings && typeof settings === 'object' ? settings : {};
    const env = s.env && typeof s.env === 'object' ? s.env : {};
    const hooksDir = path.join(claudeDir, 'hooks');
    let hasHooks = false;
    try { hasHooks = fs.readdirSync(hooksDir).some((f) => /^(guard-|docs-session|memory-session|instrument-).*\.js$/.test(f)); } catch { hasHooks = false; }
    // The walk's None held across a release: every hook the LAST release shipped is switched off.
    // A 1.x settings file spells the switch-off CLAUDE_STACK_HOOKS_OFF until the installer's env pass // legacy-name
    // renames it, which runs after this preflight.
    const { hookDisabled, envOf } = require('../stack/hooks/hook-prelude.js');
    const hooksOff = String(envOf(env, 'HOOKS_OFF') || '');
    let shippedBefore = [];
    try { shippedBefore = ((/^shipped-hooks: (.*)$/m.exec(fs.readFileSync(stampFile, 'utf8')) || [])[1] || '').split(',').filter(Boolean); } catch { shippedBefore = []; }
    // The installer holds None only while the core that carries the hooks is enabled (it enables the
    // core regardless, and writes no hook none without it) - so the verdict holds it only then too.
    // Listed is enabled for the core: it is locked on, and the listing's flag can read false while
    // it runs (brand.js rowOn, docs/rebrand-evidence.md S22). A 1.x hooks id says nothing on its own.
    const coreOn = Boolean(listing && listing.some((r) => isCore(r.name) && rowOn(r)));
    const noneBefore = coreOn && shippedBefore.length > 0 && shippedBefore.every((h) => hookDisabled(h, { ALFRED_CODE_HOOKS_OFF: hooksOff }));
    const rows = classifyNew({
        added, noneBefore,
        plugins: listing && listing.filter(rowOn).map((r) => r.name),
        parked: listing ? listing.filter((r) => !rowOn(r)).map((r) => r.name) : [],
        deny: s.permissions && Array.isArray(s.permissions.deny) ? s.permissions.deny : [],
        hooksOff,
        routes,
        always: ((readJson(path.join(snapshot, 'meta', 'recommendations.json')) || {}).always) || {},
        hasHooks,
        copied: libraryCopies(claudeDir),
        picked: pickedByKind(stampFile, splitPick),
    });
    if (!rows.length) return ['new: none'];
    return rows.map((r) => [
        `new: ${r.category} ${r.name}`, r.verdict, r.entry || '-',
        ...(r.recommend ? [r.recommend] : []),
        ...(r.enables && r.enables.length ? [`enables=${r.enables.join(',')}`] : []),
        ...(r.copies && r.copies.length ? [`copies=${r.copies.map((c) => c.split(' ')[1]).join(',')}`] : []),
        ...(r.from ? [`from=${r.from}`] : []),
        ...(r.oldOnDisk ? ['old-on-disk'] : []),
        ...(r.wasOff ? ['was-off'] : []),
    ].join('\t'));
}

// The policy-rev second VALIDATE trigger - was two greps the caller ran by hand and then
// re-confirmed 3 extra times in one audited run (~275k tokens): one printed row instead.
function policyRevLine(root, snapshot)
{
    const installedFile = path.join(root, '.claude', 'rules', 'baseline-project-agent-capabilities.md');
    const snapshotFile = path.join(snapshot, 'stack', 'skills', 'alfred-capture-agent-capabilities', 'SKILL.md');
    const readRev = f => { try { return (fs.readFileSync(f, 'utf8').match(/policy-rev: ([0-9a-f]+)/) || [])[1]; } catch { return undefined; } };
    if (!fs.existsSync(installedFile)) return 'policy-rev: none';
    const installed = readRev(installedFile);
    const snap = readRev(snapshotFile);
    if (installed && snap && installed === snap) return 'policy-rev: current';
    return `policy-rev: stale installed=${installed || 'none'} snapshot=${snap || 'none'}`;
}

// `--log` postcheck mode: the RESTART/'!!' facts read from the installer's own log, after it
// runs - no --snapshot needed, so this never re-hits the compare API.
function runLogMode(logFile)
{
    const hooks = Number(arg('--hooks', '0')) || 0;
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { text = ''; }
    const warnLines = text.split('\n').filter(l => l.includes('!!'));
    for (const l of warnLines) console.log(`warn: ${l.trim()}`);
    const m = /mcps=(\d+)/.exec(text);
    const mcps = m ? Number(m[1]) : 0;
    // A moved docs root: the session's loaded baseline-docs-root rule still names the old one.
    const docsMoved = /docs root: moved /.test(text);
    console.log(`restart: ${(mcps > 0 || hooks > 0 || docsMoved) ? 'yes' : 'no'}`);
}

function main()
{
    const logFile = arg('--log');
    if (logFile) { runLogMode(logFile); return; }

    const snapshot = arg('--snapshot');
    if (!snapshot)
    {
        console.error('usage: update-preflight.js --snapshot <extracted-repo-dir> [--stamp <stamp-file>] [--root <install root>] [--settings <settings.json>] [--config-dir <account dir>] [--repo <owner/name>] [--fixture <compare.json>] [--listing <plugin-list.json>] [--marketplace <name>]\n       update-preflight.js --log <installer-log> [--hooks <n>]');
        process.exit(1);
    }
    const root = arg('--root', '.');
    // Global mode passes the ACCOUNT dir as the root, which holds the stamp and settings.json itself.
    // An account dir set through CLAUDE_CONFIG_DIR can have any name - it is recognised by holding the
    // stamp itself and no `.claude/` of its own.
    // A 1.x install's stamp keeps its old name until this update rewrites it; either one counts.
    const accountDir = /^\.claude(-.+)?$/.test(path.basename(path.resolve(root)))
        || (!fs.existsSync(path.join(root, '.claude')) && Boolean(stampIn(root).read));
    const claudeDir = accountDir ? path.resolve(root) : path.join(root, '.claude');
    // I8 (R51): a 1.x GLOBAL install's stamp is still in the account dir until the installer - which
    // runs AFTER this - moves it into the project; while the project holds no stamp of its own, that
    // account stamp is the baseline, or the first update exits 'no stamp' before it can migrate.
    const { legacyAccountStamp, readStampScope } = require('./install/stamp.js');
    const own = stampIn(claudeDir).read;
    const acctEnv = arg('--config-dir') ? { ...process.env, CLAUDE_CONFIG_DIR: arg('--config-dir') } : process.env;
    const legacy = !own && !accountDir && !arg('--stamp') ? legacyAccountStamp({ claudeDir, env: acctEnv }) : null;
    const stampFile = arg('--stamp', own || legacy || stampIn(claudeDir).write);
    // M4 (R54): the file this run WRITES is the before-state and what the migrations act on -
    // settings.local.json when the stamp says local (settings.js settingsTarget). The new-item
    // classification reads the off-state the way Claude Code lays the two files: env key by key with
    // the local file winning, deny combined (settings.js readBackSettings) - a local deny is off too.
    const settingsLib = require('./install/settings.js');
    const stampScope = readStampScope(stampFile);
    const settingsFile = arg('--settings', accountDir ? path.join(claudeDir, 'settings.json') : settingsLib.settingsTarget(claudeDir, stampScope === 'local' ? 'local' : 'project'));
    const layered = arg('--settings') || accountDir ? null : settingsLib.readBackSettings(claudeDir, 'local');

    const compareArgs = [path.join(snapshot, 'scripts', 'stamp-compare.js'), '--snapshot', snapshot, '--stamp', stampFile];
    for (const flag of ['--repo', '--fixture']) { const v = arg(flag); if (v) compareArgs.push(flag, v); }
    const res = spawnSync(process.execPath, compareArgs, { encoding: 'utf8' });
    const out = String(res.stdout || '').replace(/\n$/, '');
    if (out) console.log(out);
    if (res.stderr) process.stderr.write(res.stderr);
    if (legacy) console.log(`legacy-stamp: ${legacy} - a 1.x global install; this update moves it into the project`);

    const lines = out ? out.split('\n') : [];
    const c = changedClasses(lines);
    console.log(`changed: skills=${c.skills} agents=${c.agents} rules=${c.rules} hooks=${c.hooks} template=${c.template ? 'yes' : 'no'}`);
    console.log(`validate: ${spansMultipleReleases(lines.find(l => l.startsWith('version: '))) ? 'yes' : 'no'}`);
    console.log(policyRevLine(root, snapshot));

    const catalog = readJson(path.join(snapshot, 'meta', 'migrations.json'));
    const entries = (catalog && catalog.migrations) || [];
    const settings = readJson(settingsFile);
    // R99: a project or user run migrates the STACK keys settings.local.json holds too (the writer's
    // overlay), so a migration fires on either file - on the local one for those keys alone.
    const localFile = path.join(claudeDir, 'settings.local.json');
    const localStack = settingsFile === localFile || arg('--settings') ? null
        : { env: Object.fromEntries(Object.entries((readJson(localFile) || {}).env || {}).filter(([k]) => settingsLib.isStackKey(k))) };
    let fired = 0;
    for (const e of entries)
    {
        if (!detects(e, root, settings) && !(localStack && isEnvDetect(e) && detects(e, root, localStack))) continue;
        fired += 1;
        console.log(`migration: ${e.id}\t${detectKind(e)}`);
        // Every field the caller ACTS on, for the entries that actually fired - so the catalog
        // itself never has to be opened. Reading 'that one entry by id' still pulled the file
        // into context (measured: 2,182 of a 5,180-char read was the maintainer `_comment`, 42%,
        // paid again on every update of every consuming project). An entry that did not fire
        // prints nothing, so the cost scales with what is true of THIS install.
        for (const [label, value] of migrationFields(e)) console.log(`  ${label}: ${value}`);
    }
    if (!fired) console.log('migrations: none detected');

    // N6: the routes the installer will commit (plugins.js committedRoutesAt, C5) - a switch only
    // settings.local.json holds yields to settings.json below local scope. They sit in the project's
    // `.claude/`: the --settings file's own folder when one is named (a 1.x global install's is there).
    const routeDir = arg('--settings') ? path.dirname(path.resolve(arg('--settings'))) : accountDir ? path.resolve('.claude') : claudeDir;
    const routes = require('./install/plugins.js').committedRoutesAt({ env: process.env, claudeDir: routeDir, scope: stampScope === 'local' ? 'local' : 'project' });
    for (const l of newItemLines({ root, claudeDir, snapshot, settings: layered || settings, stampFile, compareLines: lines, routes })) console.log(l);

    // The one-time docs-root offer, from the rule the installer applies (docs.docsMovePlan): the same
    // settings view the docs root is read from, and the stamp's ledger for who wrote the value.
    if (!accountDir)
    {
        const docs = require('./install/docs.js');
        const view = settingsLib.readBackSettings(claudeDir, stampScope === 'local' ? 'local' : 'project').env || {};
        const ledger = require('./install/stamp.js').readLedger(stampFile);
        const managed = ledger && ledger.env ? Object.assign({}, ...Object.values(ledger.env)) : null;
        console.log(docs.docsMoveLine(docs.docsMovePlan({
            projectRoot: path.resolve(root), env: view, ledger: managed, stamped: fs.existsSync(stampFile), launchEnv: process.env,
        })));
    }

    const keys = settings && settings.env ? Object.keys(settings.env).sort() : [];
    console.log(`env-keys: ${keys.length ? keys.join(',') : 'none'}`);
    // Nobody answers this run: the command answers its own asks by init.md's Unattended rule.
    if (require('./init-plan.js').isUnattended()) console.log('unattended: on');

    process.exit(typeof res.status === 'number' ? res.status : 3);
}

main();
