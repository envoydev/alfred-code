'use strict';
// meta/migrations.json keeps one entry per retirement, with the settings-env change inside it
// (rename / remove / clear). applyEnv takes the three flat lists; this is the one translation.
function envMigrations(file)
{
    const out = { renames: [], retired: [], reseed: [] };
    for (const e of (file && file.migrations) || [])
    {
        if (e.rename_settings_env) out.renames.push([e.rename_settings_env.from, e.rename_settings_env.to]);
        if (e.remove_settings_env) out.retired.push([e.remove_settings_env.key, e.remove_settings_env.when_value ?? null]);
        if (e.clear_settings_env) out.reseed.push([e.clear_settings_env.key, e.clear_settings_env.when_value, e.clear_settings_env.to]);
    }
    return out;
}

module.exports = { envMigrations };
