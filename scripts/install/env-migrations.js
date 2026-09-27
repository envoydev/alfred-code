'use strict';
// meta/migrations.json keeps one entry per retirement, with the settings-env change inside it
// (rename / remove / clear). applyEnv takes the three flat lists; this is the one translation.
function envMigrations(file)
{
    const out = { renames: [], retired: [], reseed: [], prefixRenames: [] };
    for (const e of (file && file.migrations) || [])
    {
        if (e.rename_settings_env) out.renames.push([e.rename_settings_env.from, e.rename_settings_env.to]);
        if (e.remove_settings_env) out.retired.push([e.remove_settings_env.key, e.remove_settings_env.when_value ?? null]);
        if (e.clear_settings_env) out.reseed.push([e.clear_settings_env.key, e.clear_settings_env.when_value, e.clear_settings_env.to]);
        if (e.rename_settings_env_prefix) out.prefixRenames.push([e.rename_settings_env_prefix.from, e.rename_settings_env_prefix.to]);
    }
    // Every retirement/reseed key text in the file is HISTORY (the entry that introduced it), but
    // applyEnv's prefix-rename pass runs BEFORE retirements/reseed and already moved any key it
    // covers - map the key here so those steps still find it under its current spelling.
    const mapKey = (key) =>
    {
        for (const [from, to] of out.prefixRenames)
            if (key.startsWith(from)) return to + key.slice(from.length);
        return key;
    };
    out.retired = out.retired.map(([key, onlyWhen]) => [mapKey(key), onlyWhen]);
    out.reseed = out.reseed.map(([key, badSeed, to]) => [mapKey(key), badSeed, to]);
    return out;
}

module.exports = { envMigrations };
