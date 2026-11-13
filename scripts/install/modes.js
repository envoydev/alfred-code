'use strict';
// The mode block and the installer (mode commands v2 stage 3): the four mode keys in the checkout's own settings.local.json
// are the user's typed modes. The settings pass sets them aside and puts them back as typed (setAside), one writeModes call
// after it refreshes Claude Code's own two keys from them (refresh), and uninstall takes the block out (remove).
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../../stack/hooks/layout.js');
const { writeModes, WHY, said } = require('../../stack/hooks/mode-settings.js');
const { readJson } = require('./json-file.js');

const COMPACT = 'ALFRED_CODE_AUTO_COMPACT';
const MODE_SET = new Set(layout.MODE_KEYS);
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

// A mode key's 3.10 name (until 4.0.0, layout.OLD_KEYS): held under its new name in its own place, as the rename would.
const OLD_NAME = Object.fromEntries(Object.entries(layout.OLD_KEYS).filter(([now]) => MODE_SET.has(now)).map(([now, old]) => [old, now]));

// Takes the mode keys out of a settings.local.json's env before the env passes; the returned putBack restores them in their
// place, as typed, and drops any mode key a pass added there. Any other file: nothing to set aside. `reseed(key, from,
// value)` may correct a value the stack itself seeded (its ledger row, B1's reseed list); putBack then returns true.
function setAside(data, label, reseed = (key, from, value) => value)
{
    if (label !== 'settings.local.json') return () => false;
    const order = plain(data.env) ? Object.keys(data.env) : [];
    const held = {};
    let reseeded = false;
    for (const [i, key] of order.entries())
    {
        const now = MODE_SET.has(key) ? key : OLD_NAME[key];
        if (!now) continue;
        if (key === now || (!Object.hasOwn(held, now) && !Object.hasOwn(data.env, now)))
        {
            held[now] = reseed(now, key, data.env[key]);
            reseeded ||= held[now] !== data.env[key];
            order[i] = now;
        }
        delete data.env[key];
    }
    return (after, ledgerRows) =>
    {
        for (const key of layout.MODE_KEYS) if (ledgerRows) delete ledgerRows[key];
        if (!plain(after.env)) { if (Object.keys(held).length) after.env = { ...held }; return reseeded; }
        if (!Object.keys(held).length) { for (const key of layout.MODE_KEYS) delete after.env[key]; return reseeded; }
        const back = {};
        for (const key of order) if (Object.hasOwn(held, key)) back[key] = held[key]; else if (Object.hasOwn(after.env, key)) back[key] = after.env[key];
        for (const [key, value] of Object.entries(after.env)) if (!Object.hasOwn(back, key) && !MODE_SET.has(key)) back[key] = value;
        after.env = back;
        return reseeded;
    };
}

// The project the mode file belongs to: a same-repository child or a linked worktree resolves it to another checkout's file.
const ownsModeFile = (projectRoot) => path.resolve(layout.modeFile(projectRoot)) === path.join(path.resolve(projectRoot), '.claude', 'settings.local.json');
const modeEnv = (file) => { const d = readJson(file); return plain(d) && plain(d.env) ? d.env : {}; };

// After the settings pass: one writeModes call. `autoCompact` is the run's --auto-compact answer ('on', 'off' or none);
// `held` says the flag was refused (a tracked .variables at local scope), so nothing is copied from the team's value.
function refresh({ projectRoot, configDir, dataRoot, autoCompact, held = false, log })
{
    if (!ownsModeFile(projectRoot)) return null;
    const file = layout.modeFile(projectRoot);
    const values = layout.variablesOf(projectRoot, { env: { CLAUDE_CONFIG_DIR: configDir }, dataRoot }).values;
    const update = autoCompact === 'on' ? { [COMPACT]: '1' } : autoCompact === 'off' ? { [COMPACT]: null }
        : !held && !Object.hasOwn(modeEnv(file), COMPACT) && values[COMPACT] === '1' ? { [COMPACT]: '1' } : {};
    const r = writeModes(projectRoot, update, { ...values, CLAUDE_CONFIG_DIR: configDir });
    if (r.why) log(`  !! modes: not written - ${WHY[r.why]}`);
    else if (r.changed)
    {
        const enabled = (readJson(file) || {}).autoCompactEnabled ?? 'absent';
        log(`  modes: ${Object.keys(r.windows).length} window rows, autoCompactEnabled ${enabled}${said(r)}`);
    }
    return r;
}

// Uninstall: the four keys leave the mode file, Claude Code's two keys only when the compact key was there; an emptied file goes.
function remove({ projectRoot, log })
{
    if (!ownsModeFile(projectRoot)) return null;
    const file = layout.modeFile(projectRoot);
    const env = modeEnv(file);
    const keys = layout.MODE_KEYS.filter((k) => Object.hasOwn(env, k));
    if (!keys.length) return null;
    const r = writeModes(projectRoot, Object.fromEntries(keys.map((k) => [k, null])), {});
    if (r.why) { log(`  !! modes: the mode block was left - ${WHY[r.why]}`); return r; }
    const left = readJson(file);
    if (plain(left) && !Object.keys(left).length)
    {
        fs.rmSync(file, { force: true });
        log('  settings.local.json removed - it held nothing but the mode block');
    }
    else log(`  settings.local.json: the mode block removed (${keys.join(', ')})`);
    return r;
}

module.exports = { setAside, refresh, remove, ownsModeFile };
