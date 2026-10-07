#!/usr/bin/env node
'use strict';
// Stamp the deployed alfred-docs-root.md rule with the CURRENT docs root: the ALFRED_CODE_DOCS_PATH
// env value in <root>/.claude/settings.json, else the default. Handles both the fresh copy (the
// __DOCS_ROOT__ placeholder) and a previously stamped value - so the guided commands can re-stamp
// after an env change without re-running the installer (the installers stamp fresh copies with
// their own embedded logic; this script is the between-runs re-stamp).
//
// Usage: node stamp-docs-root.js [project-root]        (default: cwd - rules/ + settings.json under <root>/.claude)
//        node stamp-docs-root.js --claude-dir <dir>    (a global install: the account dir itself, e.g. ~/.claude-work)
//        node stamp-docs-root.js [project-root] --reprobe-versioning <value-this-run-seeded>
//                                                   (re-probe the docs-versioning mode at the path the file now
//                                                    holds; refused unless the file still holds that value)
//        node stamp-docs-root.js [project-root] --seed-versioning
//                                                   (ALFRED_CODE_DOCS_VERSIONING absent -> write probeVersioning's
//                                                    answer for the docs root the file holds; present -> untouched.
//                                                    Project root only - a global install is skipped with a message.)
// Exit 0 always - a missing rule file or unreadable settings is a fail-soft no-op with a message.

const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn
const { envOf } = require('../stack/hooks/hook-prelude.js');

const DEFAULT_ROOT = '.alfred/docs';
const STAMP_RE = /(This install's root: `)[^`]*(`)/;

function resolveDocsRoot(settingsFile)
{
    try
    {
        const env = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env || {};
        return envOf(env, 'DOCS_PATH') || DEFAULT_ROOT;
    }
    catch
    {
        return DEFAULT_ROOT;
    }
}

// R87 / R89: which settings a PROJECT run reads and writes, by the install's scope (the stamp's
// `scope:` line) - the rule the installer follows. At `local` scope the hooks see settings.local.json
// laid over settings.json (the N6 merge), so the docs root and a stored versioning decision are read
// from that view, and a write goes to settings.local.json, the file that scope writes. Any other
// scope: settings.json alone. The docs root itself comes from the installer's own resolver
// (`copy.resolveDocsRoot`), so the two can never stamp different roots.
function scopedSettings(root)
{
    const claudeDir = path.join(root, '.claude');
    const { stampFile } = require('./install/brand.js');
    const { readStampScope } = require('./install/stamp.js');
    const { settingsTarget, readBackSettings } = require('./install/settings.js');
    const scope = readStampScope(stampFile(claudeDir).read || '') === 'local' ? 'local' : 'project';
    const env = readBackSettings(claudeDir, scope, { sharedOnly: true }).env;
    return {
        file: settingsTarget(claudeDir, scope),
        env: env && typeof env === 'object' && !Array.isArray(env) ? env : {},
        docs: String(require('./install/copy.js').resolveDocsRoot(root, scope)).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    };
}

// The installer hashes alfred-docs-root.md AFTER it substitutes the placeholder (R29) - this
// script does the SAME substitution again, later, so a re-stamp here is the same kind of rewrite
// and must re-record the same hash, or the very next library check reads the rule as drift for a
// change this script's own protocol asked for. Owns exactly one key: a sibling rule's recorded
// hash, and everything else in the stamp, is left untouched. A 1.x install's stamp keeps its old
// name until the next update writes the new one; read whichever exists, same as every other reader.
function restampLibraryHash(claudeDir, ruleFile)
{
    let stampFile, hashItem;
    try
    {
        ({ stampFile } = require('./install/brand.js'));
        ({ hashItem } = require('./install/library.js'));
    }
    catch { return; }
    const target = stampFile(claudeDir).read;
    if (!target) return;
    let text;
    try { text = fs.readFileSync(target, 'utf8'); } catch { return; }
    const line = /^library-rules: (.*)$/m.exec(text);
    if (!line || !/(^|,)alfred-docs-root=/.test(line[1])) return;
    const hash = hashItem(ruleFile);
    if (!hash) return;
    const updated = line[1].replace(/(^|,)alfred-docs-root=[^,]*/, `$1alfred-docs-root=${hash}`);
    if (updated === line[1]) return;
    fs.writeFileSync(target, text.replace(line[0], `library-rules: ${updated}`));
}

// claudeDir holds rules/ + settings.json: <project>/.claude for a project install, the account dir
// (~/.claude, ~/.claude-<space>) for a 1.x global one. `value` is the root a project run resolved at
// its scope; the account-dir mode reads that dir's settings.json alone.
function stampDir(claudeDir, value)
{
    const ruleFile = path.join(claudeDir, 'rules', 'alfred-docs-root.md');
    if (!fs.existsSync(ruleFile))
    {
        console.log(`stamp-docs-root: no ${ruleFile} - nothing to stamp`);
        return;
    }
    const val = value || resolveDocsRoot(path.join(claudeDir, 'settings.json'));
    const text = fs.readFileSync(ruleFile, 'utf8');
    if (!STAMP_RE.test(text))
    {
        console.log(`stamp-docs-root: no stamp line in ${ruleFile} - left unchanged (env value still wins at session start)`);
        return;
    }
    fs.writeFileSync(ruleFile, text.replace(STAMP_RE, `$1${val}$2`));
    console.log(`stamp-docs-root: stamped '${val}' into ${ruleFile}`);
    restampLibraryHash(claudeDir, ruleFile);
}

function stamp(root)
{
    stampDir(path.join(root, '.claude'), require('./install/copy.js').resolveDocsRoot(root));
}

// The rule an ABSENT ALFRED_CODE_DOCS_VERSIONING is seeded by - the same rule as both installer seeds and docs.js
// keptOutOfGit(), and a table-driven test runs all four over the same repos: 'local' only when the docs are kept OUT
// of git - no domain is tracked AND either (a) a domain exists or (b) git ignores the docs root - and 'git' otherwise,
// a fresh project whose docs root is not ignored included. A tracked domain wins over an ignored root. `docs` is the
// docs path relative to `root`, forward slashes; the ignore probe asks `<docs>/` so a directory-only pattern matches a
// root that does not exist yet. Every DOMAIN is probed, never architecture/ alone: a watch.json is what makes a folder
// a domain (architecture/ is grandfathered in without one), so a project documented only in code-style/, decisions/ or
// related-projects/ is an ordinary shape. Same rule as docs.js domains(), reserved names and all; a watch-less folder
// like quality/ is no domain and no vote.
function probeVersioning(root, docs)
{
    const base = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${docs}`;
    let domainDirs = [];
    try
    {
        domainDirs = fs.readdirSync(base, { withFileTypes: true })
            .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['references', 'history'].includes(e.name))
            .map(e => e.name)
            .filter(n => n === 'architecture' || fs.existsSync(path.join(base, n, 'watch.json')))
            .sort();
    }
    catch { domainDirs = []; }
    const quiet = { cwd: root, stdio: 'ignore' };
    if (domainDirs.some(n => rt.spawnCommand('git', ['ls-files', '--error-unmatch', '--', `${base}/${n}`], quiet).status === 0)) return 'git';
    if (domainDirs.length) return 'local';
    return docs && rt.spawnCommand('git', ['check-ignore', '-q', '--', `${docs}/`], quiet).status === 0 ? 'local' : 'git';
}

// ALFRED_CODE_DOCS_VERSIONING is seeded by that rule, probed at the docs path the settings file
// held when the INSTALL ran. On the setup route the user's chosen docs root is applied AFTER that, so a key seeded
// against the old path can describe the wrong folder. The walk that MOVES the path re-probes here, in the same
// step that re-stamps the rule, and only when its own run seeded the key: a value an earlier install wrote is a
// decision, and re-probing it would silently switch an existing install. That condition is CHECKED, not trusted:
// the caller passes the value its own install seeded and the re-probe refuses when the file holds anything else -
// a user's answer on the environment screen, or an older install's value, reads as a mismatch and is left alone.
// Forward slashes on every OS, like the installers' own probe - a mixed-separator pathspec can fail to match under
// Git for Windows.
function reprobeVersioning(root, seeded)
{
    if (seeded !== 'git' && seeded !== 'local')
    {
        console.log("stamp-docs-root: --reprobe-versioning needs the value the install seeded ('git' or 'local') - nothing re-probed");
        return;
    }
    const { file: settingsFile, env: view, docs } = scopedSettings(root);
    let data;
    try { data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { console.log(`stamp-docs-root: cannot read ${settingsFile} - docs versioning left as it is`); return; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || (data.env !== undefined && (!data.env || typeof data.env !== 'object' || Array.isArray(data.env))))
    { console.log(`stamp-docs-root: ${settingsFile} is not a JSON object with an env object - docs versioning left as it is`); return; }
    const stored = envOf(view, 'DOCS_VERSIONING');
    if (!stored)
    {
        console.log('stamp-docs-root: no ALFRED_CODE_DOCS_VERSIONING in the env block - nothing to re-probe');
        return;
    }
    if (stored !== seeded)
    {
        console.log(`stamp-docs-root: the env block holds '${stored}', not the '${seeded}' this run seeded - that is a decision, so docs versioning is left as it is`);
        return;
    }
    if (rt.spawnCommand('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }).status !== 0)
    {
        console.log('stamp-docs-root: not a git repository - docs versioning left as it is');
        return;
    }
    const value = probeVersioning(root, docs);
    if (stored === value)
    {
        console.log(`stamp-docs-root: docs versioning already '${value}' at ${docs}/ - unchanged`);
        return;
    }
    data.env = data.env || {};
    data.env.ALFRED_CODE_DOCS_VERSIONING = value;
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`stamp-docs-root: docs versioning re-probed at ${docs}/: '${value}'`);
}

// The MISSING-row case `validate.md` (and any other reader) uses instead of the environment.json catalog default:
// that default is a CONSTANT ('git'), but this one key is DETECTED - writing the constant over a project whose docs
// are kept out of git is the exact silent switch the rule exists to prevent. Present already: left byte-for-byte,
// same guard as reprobeVersioning's 'a decision is never touched'. Merges only this one key.
function seedVersioning(root)
{
    const { file: settingsFile, env: view, docs } = scopedSettings(root);
    let data;
    try { data = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch { console.log(`stamp-docs-root: cannot read ${settingsFile} - nothing seeded`); return; }
    // An array is typeof 'object' too, and a property set on one is dropped by JSON.stringify - so without
    // the isArray checks a top-level [] or an `env: []` printed 'seeded' while writing nothing, and a string
    // `env` threw under strict mode, breaking the exit-0 promise. Each shape refuses before any write.
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!isObject(data))
    {
        console.log(`stamp-docs-root: ${settingsFile} is not a JSON object - nothing seeded`);
        return;
    }
    if (data.env !== undefined && !isObject(data.env))
    {
        console.log(`stamp-docs-root: ${settingsFile} has an env that is not a JSON object - nothing seeded`);
        return;
    }
    const decided = envOf(view, 'DOCS_VERSIONING');
    if (decided)
    {
        console.log(`stamp-docs-root: ALFRED_CODE_DOCS_VERSIONING already '${decided}' - nothing seeded`);
        return;
    }
    const value = probeVersioning(root, docs);
    const why = value === 'local' ? 'the docs are kept out of git' : 'the docs are not kept out of git';
    data.env = data.env || {};
    data.env.ALFRED_CODE_DOCS_VERSIONING = value;
    fs.writeFileSync(settingsFile, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`stamp-docs-root: ${path.basename(settingsFile)} env: ALFRED_CODE_DOCS_VERSIONING seeded '${value}' at ${docs}/ - ${why}`);
}

if (require.main === module)
{
    const argv = process.argv.slice(2);
    const i = argv.indexOf('--claude-dir');
    const reprobeAt = argv.indexOf('--reprobe-versioning');
    const seedAt = argv.indexOf('--seed-versioning');
    // The word after a flag is that flag's VALUE, never the positional project root - both value-taking flags do this;
    // --seed-versioning takes none, so it never claims the next word.
    const values = new Set([i + 1, reprobeAt + 1].filter(k => k > 0));
    const root = path.resolve(argv.find((a, k) => !a.startsWith('--') && !values.has(k)) || '.');
    if (i >= 0 && argv[i + 1]) stampDir(path.resolve(argv[i + 1]));
    else stamp(root);
    if (reprobeAt >= 0)
    {
        // A global install has no project repo to probe, and its docs root is not a path in one.
        if (i >= 0 && argv[i + 1]) console.log('stamp-docs-root: --reprobe-versioning needs a project root - skipped for a global install');
        else reprobeVersioning(root, argv[reprobeAt + 1]);
    }
    if (seedAt >= 0)
    {
        if (i >= 0 && argv[i + 1]) console.log('stamp-docs-root: --seed-versioning needs a project root - skipped for a global install');
        else seedVersioning(root);
    }
}

module.exports = { stamp, stampDir, resolveDocsRoot, reprobeVersioning, probeVersioning, seedVersioning };
