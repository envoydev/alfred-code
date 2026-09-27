'use strict';
// THE NAME - what the stack is called now, and what a 1.x install still calls it.
//
// 2.0.0 renamed claude-stack to alfred-code, but nothing forces an install across: a registered // legacy-name
// marketplace's KEY never changes (and `marketplace remove` would uninstall the stack from every
// project on the machine), the stamp and the seat denies stay as the last update wrote them, and
// the plugin cache keeps the 1.x directory. So every READ takes either spelling - the new one wins
// when both exist - and every WRITE uses the new one. This file is the one home of the old names in
// the installer: a call site uses LEGACY, never a literal of its own.
const fs = require('node:fs');
const path = require('node:path');

// No hooks entry: 2.0.0 folds the hooks into the core (user ruling 'Fold into core in 2.0.0'). The
// 1.x hooks id stays in LEGACY - a retired alias the migration uninstalls (plugins.migrateLegacy).
const BRAND = { marketplace: 'envoydev', core: 'alfred-code', slug: 'envoydev/alfred-code', stamp: 'alfred-code.stamp' };
const LEGACY = {
    marketplace: 'claude-stack', // legacy-name
    core: 'claude-stack', // legacy-name
    hooks: 'claude-stack-hooks', // legacy-name
    slug: 'envoydev/claude-stack', // legacy-name
    stamp: 'claude-stack.stamp', // legacy-name
};

const isCore = (name) => name === BRAND.core || name === LEGACY.core;

// The name an entry goes by from 2.0.0. Only the core was renamed: the 1.x hooks id has no 2.0.0
// counterpart (its hooks ride the core), and a per-stack entry retired in 1.3.0 stays listed under
// its own name until update removes it.
const currentName = (name) => (isCore(name) ? BRAND.core : name);

// A listing row as `claude plugin list --json` prints it (`id: name@key`) or as parsePluginList
// returns it (`name`, `marketplace`) - both callers exist.
const rowId = (row) =>
{
    if (!row || typeof row !== 'object') return ['', ''];
    if (row.id) { const [name, key = ''] = String(row.id).split('@'); return [name, key]; }
    return [String(row.name || ''), String(row.marketplace || '')];
};

// The core is LOCKED on, under either spelling, so a listed core row is enabled whatever its
// `enabled` flag says: the listing reads `false` for a moved project-scope core that visibly runs,
// session after session (docs/rebrand-evidence.md S22). Only the plugin-level flag is overruled - a
// user's off-switch for one core item (a seat deny, a skillOverrides value, a hook named in
// ALFRED_CODE_HOOKS_OFF) is read elsewhere and still holds.
const alwaysOn = (name) => isCore(name);
const rowOn = (row) => Boolean(row) && (row.enabled !== false || alwaysOn(rowId(row)[0]));

const sameSlug = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
// A git URL names the repo too: https://github.com/<slug>(.git) or git@github.com:<slug>(.git).
const urlSlug = (url) => (/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(String(url || '')) || [])[1] || '';
const resolved = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// Which slug a `claude plugin marketplace list --json` row points at: the CLI prints the source
// flat (`{name, source: 'github', repo}`, `{name, source: 'git', url}` - evidence S7), and
// known_marketplaces.json nests it (`source: {source, repo}`); both are read. A directory source is
// the stack only when it is the path the MARKETPLACE setting names (a slug there - a fork - is
// matched like the stack's own).
function stackSlug(row, setting)
{
    const src = row && typeof row.source === 'object' && row.source ? row.source : {};
    const repo = row.repo || src.repo || urlSlug(row.url || src.url);
    for (const slug of [BRAND.slug, LEGACY.slug]) if (sameSlug(repo, slug)) return slug;
    if (setting.slug && sameSlug(repo, setting.slug)) return BRAND.slug;
    const dir = row.path || src.path;
    if (setting.dir && dir && resolved(dir) === resolved(setting.dir)) return BRAND.slug;
    return null;
}

// THE KEY this install's stack lives under, and whether anything registered says so (`known`: a
// fresh account has no registration yet, and only then does the caller add one):
//   1. the key of the marketplace whose CORE is installed (either name) - an enabled row first;
//   2. else the key of a registered marketplace whose source is the stack's repo (the current slug
//      first, since a fresh install takes that one);
//   3. else BRAND.marketplace.
function marketOf({ listing = [], marketplaces = [], env = {} } = {})
{
    const rows = Array.isArray(listing) ? listing : [];
    const cores = rows.map((r) => ({ id: rowId(r), enabled: r && r.enabled !== false })).filter((r) => isCore(r.id[0]) && r.id[1]);
    const core = cores.find((r) => r.enabled) || cores[0];
    if (core) return { key: core.id[1], known: true };

    // Required here, not at load: stamp.js needs only stampFile, and the core's SessionStart hook
    // loads stamp.js from the plugin root with nothing else of the installer around it.
    const { envOf } = require('../../stack/hooks/hook-prelude.js');
    const named = String(envOf(env || {}, 'MARKETPLACE') || '');
    const isSlug = /^[\w.-]+\/[\w.-]+$/.test(named) && !fs.existsSync(named);
    const setting = { slug: isSlug ? named : '', dir: named && !isSlug ? named : '' };
    const regs = (Array.isArray(marketplaces) ? marketplaces : []).filter((m) => m && m.name);
    for (const slug of [BRAND.slug, LEGACY.slug])
    {
        const hit = regs.find((m) => stackSlug(m, setting) === slug);
        if (hit) return { key: String(hit.name), known: true };
    }
    return { key: BRAND.marketplace, known: false };
}

const marketKey = (opts) => marketOf(opts).key;

// The stamp in `dir`: read the new file, else the 1.x one; always write the new one.
function stampFile(dir)
{
    const write = path.join(dir, BRAND.stamp);
    const old = path.join(dir, LEGACY.stamp);
    const read = fs.existsSync(write) ? write : fs.existsSync(old) ? old : null;
    return { read, write, legacy: old };
}

module.exports = { BRAND, LEGACY, isCore, alwaysOn, rowOn, currentName, marketOf, marketKey, stampFile };
