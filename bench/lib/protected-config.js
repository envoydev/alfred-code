'use strict';
// The check-config families guard-config-protection.js protects, for the benchmark's arm-neutral
// 'check-weakening edit' metric, read from a cell's diff. The hook runs at top level and exports
// nothing, so these are COPIES, pinned to it by meta/shared-rules.json (protected-config-families,
// protected-config-keys): edit the hook first, then here.

// Whole-file protection: the file IS the check.
const WHOLE_FILE = [
  /^\.editorconfig$/, /^\.globalconfig$/, /\.ruleset$/, /^stylecop\.json$/,
  /^\.eslintrc(\.(js|cjs|mjs|json|ya?ml))?$/, /^eslint\.config\.[cm]?[jt]s$/,
  /^\.prettierrc(\.(js|cjs|mjs|json|ya?ml|toml))?$/, /^prettier\.config\.[cm]?[jt]s$/,
  /^biome\.jsonc?$/, /^\.stylelintrc(\.(js|cjs|json|ya?ml))?$/, /^stylelint\.config\.[cm]?js$/,
];
// Keyed protection: only the strictness SETTINGS are the check, compared as key=value pairs.
const KEYED = [
  { file: /^tsconfig(\..+)?\.json$/, pair: /"(strict\w*|noImplicit\w+|noUnused\w+|noUncheckedIndexedAccess|exactOptionalPropertyTypes|skipLibCheck)"\s*:\s*("[^"]*"|[^,}\s]+)/g },
  { file: /^(Directory\.Build\.(props|targets)|.+\.(cs|fs|vb)proj)$/, pair: /<(TreatWarningsAsErrors|WarningsAsErrors|WarningsNotAsErrors|WarningLevel|NoWarn|Nullable|AnalysisLevel|AnalysisMode|EnforceCodeStyleInBuild)\b[^>]*>([^<]*)<\/\1\s*>/g },
];

module.exports = { WHOLE_FILE, KEYED };
