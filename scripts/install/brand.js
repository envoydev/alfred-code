'use strict';
// THE NAME - what the stack is called: its marketplace, core plugin, repo slug, catalog slug and stamp file. A call
// site uses BRAND, never a literal of its own. A registered marketplace's KEY is read from the
// listings (marketOf), never assumed: `marketplace remove` would uninstall the stack from every
// project on the machine, so a key is never re-registered under another name.
const fs = require('node:fs');
const path = require('node:path');

// No hooks entry: 2.0.0 folds the hooks into the core (user ruling 'Fold into core in 2.0.0').
// `slug` is this repo, where the stack's source lives; `catalog` is the repo serving the `envoydev` marketplace, which
// lists the core from `slug` beside the owner's other plugins (2026-11-14: the catalog left this repo for its own).
const BRAND = { marketplace: 'envoydev', core: 'alfred-code', slug: 'envoydev/alfred-code', catalog: 'envoydev/plugins-marketplaces', stamp: 'alfred-code.stamp' };

const isCore = (name) => name === BRAND.core;

// A listing row as `claude plugin list --json` prints it (`id: name@key`) or as parsePluginList
// returns it (`name`, `marketplace`) - both callers exist.
const rowId = (row) =>
{
    if (!row || typeof row !== 'object') return ['', ''];
    if (row.id) { const [name, key = ''] = String(row.id).split('@'); return [name, key]; }
    return [String(row.name || ''), String(row.marketplace || '')];
};

// The core is LOCKED on, so a listed core row is enabled whatever its `enabled` flag says: the listing
// reads `false` for a project-scope core that visibly runs, session after session
// (docs/plugin-cli-evidence.md S22). Only the plugin-level flag is overruled - a
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
// A registration made before 2026-11-14 points at this repo, which served the catalog until then. It is still the
// stack's (re-registering would uninstall every plugin installed from it), so it matches; movedCatalog names the move.
const regRepo = (row) =>
{
    const src = row && typeof row.source === 'object' && row.source ? row.source : {};
    return (row && (row.repo || urlSlug(row.url))) || src.repo || urlSlug(src.url);
};
function stackSlug(row, setting)
{
    const src = row && typeof row.source === 'object' && row.source ? row.source : {};
    const repo = regRepo(row);
    if (sameSlug(repo, BRAND.catalog) || sameSlug(repo, BRAND.slug)) return BRAND.catalog;
    if (setting.slug && sameSlug(repo, setting.slug)) return BRAND.catalog;
    const dir = row.path || src.path;
    if (setting.dir && dir && resolved(dir) === resolved(setting.dir)) return BRAND.catalog;
    return null;
}

// THE KEY this install's stack lives under, and whether anything registered says so (`known`: a
// fresh account has no registration yet, and only then does the caller add one):
//   1. the key of the marketplace whose CORE is installed - an enabled row first;
//   2. else the key of a registered marketplace whose source is the stack's repo;
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
    const hit = regs.find((m) => stackSlug(m, setting) === BRAND.catalog);
    if (hit) return { key: String(hit.name), known: true };
    return { key: BRAND.marketplace, known: false };
}

const marketKey = (opts) => marketOf(opts).key;

// The one line that says the registration under `key` still points at this repo, which stopped serving the catalog on
// 2026-11-14: its next refresh fails, and only the user can move it, since `marketplace remove` uninstalls every plugin
// installed from it. Null when the registration is anything else.
function movedCatalog(marketplaces, key)
{
    const reg = (Array.isArray(marketplaces) ? marketplaces : []).find((m) => m && m.name === key);
    if (!reg || !sameSlug(regRepo(reg), BRAND.slug)) return null;
    return `!! the ${key} marketplace is registered from ${BRAND.slug}, which no longer serves it - the catalog moved to ${BRAND.catalog}; until you move it, no update reaches this install: https://github.com/${BRAND.catalog}#moving-from-the-old-marketplace`;
}

// The stamp in `dir`: `read` is the file when it exists (else null), `write` its path either way.
function stampFile(dir)
{
    const write = path.join(dir, BRAND.stamp);
    return { read: fs.existsSync(write) ? write : null, write };
}

module.exports = { BRAND, isCore, alwaysOn, rowOn, marketOf, marketKey, movedCatalog, stampFile };
