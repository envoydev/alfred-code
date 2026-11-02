'use strict';
// plugins-root.js - the folder Claude Code keeps its plugins under: installed_plugins.json, known_marketplaces.json, cache/
// and marketplaces/. It is <config dir>/plugins unless CLAUDE_CODE_PLUGIN_CACHE_DIR moves it - despite its name the variable
// sets that whole root, the cache in its cache/ folder (code.claude.com/docs/en/plugins/loading, 'Find plugins on disk';
// code.claude.com/docs/en/env-vars). One home: lsp-coverage.js beside it and scripts/hud-statusline.js read the root here.
const os = require('node:os');
const path = require('node:path');

const CACHE_DIR_VAR = 'CLAUDE_CODE_PLUGIN_CACHE_DIR';

// The variable as set, trimmed; '' when unset or blank.
const movedRoot = (env = process.env) => String(env[CACHE_DIR_VAR] || '').trim();

// `configDir` is the account dir the caller already resolved; without one, CLAUDE_CONFIG_DIR, else ~/.claude.
function pluginsRoot(env = process.env, configDir)
{
    const moved = movedRoot(env);
    if (moved) return path.resolve(moved);
    return path.join(configDir || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'plugins');
}

module.exports = { CACHE_DIR_VAR, movedRoot, pluginsRoot };
