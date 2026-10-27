'use strict';
// AC22: every hook, engine and script reads the stack's variables through the one loader (`layout.variablesOf` /
// `applyVariables`), never a moved key straight out of a settings env. This is the inventory: a hit outside ALLOWED
// and PENDING fails, and so does a PENDING row that no longer hits, so the list only shrinks - each task that converts
// a reader deletes its rows, and the last one leaves PENDING empty.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// The keys that move into `.variables`: the catalog minus the two that stay in the settings (spec D3).
const MOVED = require('../meta/environment.json').env.map((r) => r.key)
    .filter((k) => k !== 'ALFRED_CODE_DATA_PATH' && k !== 'ALFRED_CODE_HOOKS_OFF')
    .map((k) => k.slice('ALFRED_CODE_'.length));

// Readers still to convert, as `<file>:<key suffix | env-lookup>` - none since T12c: every reader goes through the loader.
const PENDING = [];

// No read of a moved key in a settings file. Only the loader and the writer are allowed whole.
const WHOLE = new Set(['stack/hooks/layout.js', 'scripts/install/variables.js', 'scripts/variables.js']);
const ALLOWED = {
    'scripts/install/alfred-code.js:MEMORY': 'merged view (settings env with the .variables values laid over it), held by AC23 test "AC23: at <scope> scope AUTO_COMPACT=1 and MEMORY=custom keep every autoCompactWindow row and autoMemoryEnabled false byte-identical; 0 in .variables removes the rows"',
    'scripts/install/alfred-code.js:AUTO_COMPACT': 'variablesStep compares a flag with the loader\'s value (layout.variablesOf) - no settings read',
    'scripts/install/alfred-code.js:DOCS_VERSIONING': 'variablesStep compares a flag with the loader\'s value (layout.variablesOf) - no settings read',
    'scripts/install/settings.js:DOCS_VERSIONING': 'merged view (settings env with the .variables values laid over it): the seed and --docs-versioning decide in it before the move writes .variables, held by "a fresh install with --docs-versioning <mode> writes the <mode>-shaped data ignore (<scope> scope)" and the AC7 fresh-install tests',
    'scripts/install/settings.js:AUTO_COMPACT': 'merged view (settings env with the .variables values laid over it), held by AC23 test "AC23: at <scope> scope AUTO_COMPACT=1 and MEMORY=custom keep every autoCompactWindow row and autoMemoryEnabled false byte-identical; 0 in .variables removes the rows"',
    'scripts/install/settings.js:MEMORY': 'merged view (settings env with the .variables values laid over it), held by AC23 test "AC23: at <scope> scope AUTO_COMPACT=1 and MEMORY=custom keep every autoCompactWindow row and autoMemoryEnabled false byte-identical; 0 in .variables removes the rows"',
    'scripts/install/settings.js:env-lookup': 'applyEnv\'s migration and the uninstall read the settings env to move or remove it; `prior.env` is the stamp\'s ledger',
    'scripts/update-preflight.js:env-lookup': 'detects() reads the env object it is handed - a settings file\'s for a settings key, the loader\'s values (layout.variablesOf, layers files) for the stack\'s variables, held by "a preflight settings_env_value row matches a key only .variables holds"',
    'scripts/lint-skills.js:DOCS_VERSIONING': 'a lint check that the seed special-cases the catalog key - no settings read',
    'stack/skills/mode-output-scorer/scripts/scorecard.js:SCORER_LEVEL': 'setting() reads layout.variablesOf at the project root, held by "the scorecard reads SCORER_LEVEL=90 from the root\'s .variables in a child"',
    'stack/skills/mode-output-scorer/scripts/scorecard.js:SCORER_ROUNDS': 'setting() reads layout.variablesOf at the project root, held by "the scorecard reads SCORER_LEVEL=90 from the root\'s .variables in a child"',
    'stack/hooks/hook-prelude.js:SCORER': 'switchOn reads the hook\'s env, which applyVariables fills',
    'stack/hooks/hook-prelude.js:SCORER_LEVEL': 'reads the hook\'s env, which applyVariables fills',
    'stack/hooks/hook-prelude.js:SCORER_OUTPUTS': 'reads the hook\'s env, which applyVariables fills',
    'stack/hooks/hook-prelude.js:SCORER_ROUNDS': 'reads the hook\'s env, which applyVariables fills',
    'stack/hooks/hook-prelude.js:TURN_CHECK': 'the strict profile\'s switch list - no read',
    'stack/hooks/check-turn-build.js:TURN_CHECK': 'switchOn reads the process env, which applyVariables fills',
    'stack/hooks/fresh-session.js:CONTEXT_WINDOW_DEFAULT': 'freshAt reads the process env, which applyVariables fills',
    'stack/hooks/fresh-session.js:CONTEXT_WINDOW_FOR_1M': 'freshAt reads the process env, which applyVariables fills',
    'stack/hooks/fresh-session.js:CONTEXT_WINDOW_FOR_300K': 'freshAt reads the process env, which applyVariables fills',
    'stack/hooks/fresh-session.js:CONTEXT_WINDOW_FOR_200K': 'freshAt reads the process env, which applyVariables fills',
};

// A file that names a settings file in a string literal or calls a settings reader.
const SETTINGS_FILE = /(['"`])[^'"`\n]*settings(\.local)?\.json/;
const SETTINGS_READER = /\b(settingFrom|readBackSettings|readSettings)\(/;

function scanned()
{
    return execFileSync('git', ['ls-files', '*.js'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
        // the release matrices are test harnesses: they write 2.12.0-shaped settings on purpose, to update over them
        .filter((f) => !f.endsWith('.test.js') && !f.startsWith('scripts/fixtures/') && !f.startsWith('docs/workspace-layering-matrix/') && !WHOLE.has(f))
        .filter((f) => { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'); return SETTINGS_FILE.test(t) || SETTINGS_READER.test(t); });
}

// The rows one line hits. A process env read is no hit: the loader fills the process env, so those see the winner. A
// read of the loader's own values (`envOf(variablesOf(...).values, 'K')`) is no hit either: it is the loader.
function rowsOn(line)
{
    const rest = line.replace(/process\.env\.ALFRED_CODE_\w+/g, '').replace(/process\.env\[[^\]]*\]/g, '')
        .replace(/envOf\((?:[\w.]+\s*\|\|\s*)?process\.env\s*,[^)]*\)/g, '')
        .replace(/envOf\(\s*[\w.]*variablesOf\([^)]*\)\.values\s*,\s*(['"`])\w+\1\s*\)/g, '');
    const found = new Set();
    for (const s of MOVED)
    {
        // (a) `.env.ALFRED_CODE_<K>`, or a literal that is exactly the key (`[...]`, `Object.hasOwn(x, ...)` included);
        // (b) a literal that is exactly the suffix
        if (new RegExp(`\\.env\\.ALFRED_CODE_${s}\\b`).test(rest) || new RegExp(`(['"\`])(ALFRED_CODE_)?${s}\\1`).test(rest)) found.add(s);
        // (c) a settingFrom of the suffix
        const from = /settingFrom\(\{[^}]*suffix:\s*(['"`])([A-Z0-9_]+)\1/.exec(rest);
        if (from && from[2] === s) found.add(s);
    }
    // (b) a template literal whose head is a moved suffix's start, up to an underscore (`SCORER_${x}`)
    for (const m of rest.matchAll(/`([A-Z0-9_]+_)\$\{/g)) for (const s of MOVED) if (s.startsWith(m[1])) found.add(s);
    // (c) a lookup into some object's env by a computed key
    if (/envOf\((?!process\.env)[^,()]*\.env\b/.test(rest) || /[\w)\]]\.env\[(?!['"`])/.test(rest)) found.add('env-lookup');
    return found;
}

function hits()
{
    const out = new Map();
    for (const f of scanned())
    {
        fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((line, i) =>
        {
            if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
            for (const k of rowsOn(line))
            {
                const row = `${f}:${k}`;
                if (!out.has(row)) out.set(row, []);
                out.get(row).push(i + 1);
            }
        });
    }
    return out;
}

test('no tracked .js outside the tests reads or writes a moved key in a settings env', () =>
{
    const found = hits();
    const stray = [...found].filter(([row]) => !ALLOWED[row] && !PENDING.includes(row)).map(([row, lines]) => `${row} (line ${lines.join(', ')})`);
    assert.deepStrictEqual(stray, [], 'read through layout.variablesOf, or list the row in ALLOWED with its reason');
    const gone = PENDING.filter((row) => !found.has(row));
    assert.deepStrictEqual(gone, [], 'a converted reader leaves PENDING in the same step');
});

test('PENDING is empty: no reader of a moved key is left to convert (AC22)', () =>
{
    assert.strictEqual(PENDING.length, 0);
});

test('the scan sees each access shape and passes over a process env read, a message and a comment', () =>
{
    const rows = (line) => [...rowsOn(line)].sort();
    assert.deepStrictEqual(rows('const v = data.env.ALFRED_CODE_MEMORY;'), ['MEMORY']);
    assert.deepStrictEqual(rows('if (Object.hasOwn(own, \'ALFRED_CODE_SCORER\')) x();'), ['SCORER']);
    assert.deepStrictEqual(rows('const v = envOf(view, \'DOCS_VERSIONING\');'), ['DOCS_VERSIONING']);
    assert.deepStrictEqual(rows('const k = `SCORER_${name}`;'), ['SCORER_LEVEL', 'SCORER_OUTPUTS', 'SCORER_ROUNDS']);
    assert.deepStrictEqual(rows('const v = settingFrom({ env, projectDir, suffix: \'DOCS_VERSIONING\' });'), ['DOCS_VERSIONING']);
    assert.deepStrictEqual(rows('const v = settings.env[row.key];'), ['env-lookup']);
    assert.deepStrictEqual(rows('const v = envOf(data.env, suffix);'), ['env-lookup']);
    assert.deepStrictEqual(rows('const v = envOf(process.env, \'MEMORY\') || process.env.ALFRED_CODE_SCORER;'), []);
    assert.deepStrictEqual(rows('const v = envOf(env || process.env, \'HOOK_LOG_DIR\');'), []);
    assert.deepStrictEqual(rows('const on = envOf(variablesOf(root, { env: process.env }).values, \'TURN_CHECK\') === \'1\';'), [], 'the loader\'s own values');
    assert.deepStrictEqual(rows('return envOf(layout.variablesOf(root, { env: {}, layers: \'team\' }).values, \'DOCS_VERSIONING\');'), []);
    assert.deepStrictEqual(rows('const v = envOf(variablesOf(root).values, \'X\') || data.env.ALFRED_CODE_MEMORY;'), ['MEMORY'], 'a settings read beside it still hits');
    assert.deepStrictEqual(rows('log(\'set ALFRED_CODE_MEMORY in settings.json\');'), [], 'a key inside a longer string is no access');
    assert.deepStrictEqual(rows('const T = `T${n}`;'), [], 'a head that is no key fragment');
    assert.deepStrictEqual(rows('const CONFIG = /(?:\\.env[^/]*)$/;'), [], 'a regex naming .env files');
});
