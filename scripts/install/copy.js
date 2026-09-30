'use strict';
// THE COPY LAYER - what a run still puts into the project itself.
//
// After Phases 3, 5 and 6 that is a short list: the rules, the skills and agents NO plugin carries
// (the extras), and the two hook ENGINES plus the model-window table. Everything else arrives
// through the project's own plugin closure.
//
// Four rules, all of them the shell's, and each one is a bug that happened:
//
//   - IDENTICAL CONTENT IS NOT REWRITTEN. An update that rewrites every file makes every file look
//     changed to git, and a project that commits its docs would see a diff per release.
//   - AN IDENTICAL FILE THAT LOST ITS EXEC BIT GETS IT BACK. A re-clone, or a checkout that dropped
//     the mode, leaves a hook that cannot run - and because the content matches, the copy that
//     would have fixed it is skipped. So the bit is re-asserted on the skip path too.
//   - A MISSING SOURCE FILE IS REPORTED AND SKIPPED. One bad file must not take the other 116 down,
//     and the copy already in the project stays: a source that could not be read is a reason to
//     change nothing, never a reason to delete.
//   - THE DESTINATION DIRECTORY IS MADE ON THE WAY, including for a nested path.
const fs = require('node:fs');
const path = require('node:path');
const { envOf } = require('../../stack/hooks/hook-prelude.js');

const DOCS_ROOT_DEFAULT = '.alfred/docs';
const DOCS_ROOT_RULE = 'alfred-docs-root.md';

function sameContent(a, b)
{
    try
    {
        const sa = fs.statSync(a);
        const sb = fs.statSync(b);
        if (sa.size !== sb.size) return false;
        return fs.readFileSync(a).equals(fs.readFileSync(b));
    }
    catch { return false; }
}

// The text files a copy-time `render` applies to - the ones a shipped tool name or preload can sit in.
const RENDER_EXT = ['.md', '.mdc', '.js', '.json', '.txt'];
const rendered = (src, render) => (render && RENDER_EXT.includes(path.extname(src)) ? Buffer.from(render(fs.readFileSync(src, 'utf8'))) : null);
const sameBytes = (body, dest) => { try { return fs.readFileSync(dest).equals(body); } catch { return false; } };

// `render` (C17): a function of a text file's source, whose result is what the copy holds - compared
// with the copy as it stands, and written only when they differ. Without it the bytes are copied.
function installFromSource({ sourceDir, subdir, label, destDir, files, exec = false, render = null, log = () => {}, note = () => {} })
{
    const copied = [];
    const skipped = [];
    const missing = [];
    for (const file of files)
    {
        const src = path.join(sourceDir, subdir, file);
        const dest = path.join(destDir, file);
        if (!fs.existsSync(src) || !fs.statSync(src).isFile())
        {
            note(`${label} '${file}' not found in the stack source`);
            missing.push(file);
            continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const body = rendered(src, render);
        if (body ? sameBytes(body, dest) : sameContent(src, dest))
        {
            // Unchanged content can still have lost its exec bit - re-assert it rather than leave a
            // hook that is present, current and unable to run.
            if (exec) { try { fs.chmodSync(dest, 0o755); } catch { /* a read-only tree says so elsewhere */ } }
            log(`  ${label} current: ${file}`);
            skipped.push(file);
            continue;
        }
        if (body) fs.writeFileSync(dest, body);
        else fs.copyFileSync(src, dest);
        if (exec) { try { fs.chmodSync(dest, 0o755); } catch { /* as above */ } }
        log(`  ${label} installed -> ${file}`);
        copied.push(file);
    }
    return { copied, skipped, missing };
}

// C17: one skill folder, file by file - each compared with the text it will hold (`render`, as above)
// and written only when it differs, its mode kept; a file or folder the source no longer has goes.
// Unlike the remove-then-copy it replaces, a re-run over an unchanged skill writes nothing. Returns the
// number of files written or removed.
function syncTree({ src, dest, render = null })
{
    let changed = 0;
    const keep = new Set();
    const put = (rel) =>
    {
        const from = path.join(src, rel);
        const to = path.join(dest, rel);
        for (const entry of fs.readdirSync(from, { withFileTypes: true }))
        {
            const r = path.join(rel, entry.name);
            const s = path.join(src, r);
            const d = path.join(dest, r);
            keep.add(r);
            let have = null;
            try { have = fs.lstatSync(d); } catch { /* absent */ }
            if (entry.isDirectory())
            {
                if (have && !have.isDirectory()) fs.rmSync(d, { recursive: true, force: true });
                fs.mkdirSync(d, { recursive: true });
                put(r);
                continue;
            }
            if (have && have.isDirectory()) fs.rmSync(d, { recursive: true, force: true });
            if (!entry.isFile()) { fs.cpSync(s, d, { recursive: true }); changed += 1; continue; }
            const mode = fs.statSync(s).mode & 0o777;
            const body = rendered(s, render) || fs.readFileSync(s);
            if (sameBytes(body, d)) { if (have && (have.mode & 0o777) !== mode) fs.chmodSync(d, mode); continue; }
            fs.mkdirSync(to, { recursive: true });
            fs.writeFileSync(d, body);
            fs.chmodSync(d, mode);
            changed += 1;
        }
    };
    const prune = (rel) =>
    {
        let entries;
        try { entries = fs.readdirSync(path.join(dest, rel), { withFileTypes: true }); } catch { return; }
        for (const entry of entries)
        {
            const r = path.join(rel, entry.name);
            if (!keep.has(r)) { fs.rmSync(path.join(dest, r), { recursive: true, force: true }); changed += 1; }
            else if (entry.isDirectory()) prune(r);
        }
    };
    fs.mkdirSync(dest, { recursive: true });
    put('');
    prune('');
    return changed;
}

// B seam (final review B): on the FULL copy route no core plugin is enabled, so a seat's preload spelled
// `<core>:<skill>` names a skill nothing serves - the copy route installed it under its bare name. Only
// the frontmatter's list items move; the body is prose.
function respellPreloads(text, core)
{
    const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(String(text));
    if (!m) return text;
    const re = new RegExp(`^([ \\t]*-[ \\t]*)${core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([A-Za-z0-9._-]+)([ \\t]*)$`, 'gm');
    return m[0].replace(re, '$1$2$3') + String(text).slice(m[0].length);
}

// The docs root, resolved as the hooks will see it at this install's scope (R83 b / R87): at `local`
// scope settings.local.json is laid over settings.json (the N6 merge, `readBackSettings`), so a docs
// path set only in the personal file is the root; at project and user scope only settings.json. The
// scope defaults to the stamp's own `scope:` line, so a reader outside a run (library-check,
// init-plan) resolves what the last install used. envOf reads the new key, then the 1.x
// CLAUDE_STACK_DOCS_PATH spelling an update renames later in the same run, then the pre-0.2.43 // legacy-name
// one. A malformed or absent file is not a failure - it means 'no value here', which is what the
// default is for.
function resolveDocsRoot(projectRoot, scope)
{
    // Required here, not at the top: settings.js pulls in derive-state.js, which a reader of this
    // module alone never needs.
    const { readBackSettings } = require('./settings.js');
    const { readStampScope } = require('./stamp.js');
    const { stampFile } = require('./brand.js');
    const claudeDir = path.join(projectRoot, '.claude');
    const at = scope || readStampScope(stampFile(claudeDir).read || '');
    // R98: at project and user scope the docs root is settings.json's alone - the stamped rule is shared.
    const env = readBackSettings(claudeDir, at === 'local' ? 'local' : 'project', { sharedOnly: true }).env;
    return envOf(env && typeof env === 'object' ? env : {}, 'DOCS_PATH') || DOCS_ROOT_DEFAULT;
}

// The docs versioning DECLARED in the same view the docs root is read from - 'git', 'local', or null
// when the key is absent or holds anything else (the four-home rule answers then).
function resolveDocsVersioning(projectRoot, scope)
{
    const { readBackSettings } = require('./settings.js');
    const { readStampScope } = require('./stamp.js');
    const { stampFile } = require('./brand.js');
    const claudeDir = path.join(projectRoot, '.claude');
    const at = scope || readStampScope(stampFile(claudeDir).read || '');
    const env = readBackSettings(claudeDir, at === 'local' ? 'local' : 'project', { sharedOnly: true }).env;
    const value = String(envOf(env && typeof env === 'object' ? env : {}, 'DOCS_VERSIONING') || '').trim().toLowerCase();
    return value === 'git' || value === 'local' ? value : null;
}

// The root the installed docs-root rule is stamped with now, or null (no rule, or still the placeholder).
function stampedDocsRoot(projectRoot)
{
    // A 2.1.5 install holds the rule under its old name until this run's prune, so it answers when the new one is absent.
    for (const name of [DOCS_ROOT_RULE, 'baseline-docs-root.md'])
    {
        try
        {
            const m = /This install's root: `([^`]*)`/.exec(fs.readFileSync(path.join(projectRoot, '.claude', 'rules', name), 'utf8'));
            if (m && m[1] !== '__DOCS_ROOT__') return m[1];
        }
        catch { /* absent: try the next name */ }
    }
    return null;
}

// Replace `__DOCS_ROOT__` in the COPIED rule with the current value. It runs on install and on
// update, and it is once-only by construction: after it runs there is no placeholder left. What
// makes an update re-stamp is the copy that precedes it - the stamped destination differs from the
// pristine source, so the source is copied back and this writes the current value over a fresh
// placeholder. The two halves are one behaviour; neither works alone.
function stampDocsRoot(projectRoot, { scope, value: given, log = () => {}, note = () => {} } = {})
{
    const rule = path.join(projectRoot, '.claude', 'rules', DOCS_ROOT_RULE);
    if (!fs.existsSync(rule)) return false;
    // `value`: the root a run decided before its settings write lands (a docs-root move) - else the file's.
    const value = given || resolveDocsRoot(projectRoot, scope);
    try
    {
        const text = fs.readFileSync(rule, 'utf8');
        if (!text.includes('__DOCS_ROOT__')) return false;
        fs.writeFileSync(rule, text.split('__DOCS_ROOT__').join(value));
        log(`  rule stamped: ${DOCS_ROOT_RULE} -> ${value}`);
        return true;
    }
    catch (err)
    {
        // The RULE is the write target here, not the install stamp - a failure leaves the rule's own
        // env-wins fallback in place rather than breaking the run.
        note(`docs-root stamp failed on ${rule} (${err.message}) - the rule keeps its env-wins fallback`);
        return false;
    }
}

// A --drop removes the COPY of what it names - on the copy routes the whole item, on the plugin
// routes an extra - or the next --installed-only read-back finds the file and puts it straight back.
// Only a name the stack ships; the engines are no hook line, so a drop never reaches them.
const DROP_PATH = { skill: (n) => n, agent: (n) => `${n}.md`, rule: (n) => `${n}.md`, hook: (n) => `${n}.js` };
// `keep(category, name)` (M3) names a same-named folder that is the project's own, never the stack's copy.
function removeDropped({ drop = [], dirs, shipped, keep = () => false, log = () => {} })
{
    for (const line of drop)
    {
        const [category, name] = line.split(' ');
        if (!DROP_PATH[category] || !(shipped[category] || []).includes(name)) continue;
        const target = path.join(dirs[category], DROP_PATH[category](name));
        if (!fs.existsSync(target)) continue;
        if (keep(category, name)) { log(`  ${category} kept (dropped, but the project's own - the stamp does not record it): ${name}`); continue; }
        fs.rmSync(target, { recursive: true, force: true });
        log(`  ${category} removed (dropped): ${name}`);
    }
}

// The copied hooks are CommonJS, and a project whose own package.json says `"type": "module"` makes
// Node load every `.js` under it as ESM - `.claude/hooks/` included: the engines crash on `require`,
// and a copied guard dies with exit 1, which Claude Code treats as a non-blocking error, so the call
// it exists to stop runs (reproduced: `rm -rf ~` through a copied rm guard). A package.json of exactly
// `{"type":"commonjs"}` beside the copies scopes that folder back. It is the stack's file only while
// it says exactly that: a package.json the user wrote there is never overwritten, only named; one of
// the user's own `.js` hooks written as ESM would break under the marker, so it is named and the marker
// is not written; and once no stack copy is left in the folder, the stack's marker goes with them.
const COMMONJS_MARKER = '{ "type": "commonjs" }\n';
const isCommonJsMarker = (text) =>
{
    try { const j = JSON.parse(text); return !!j && typeof j === 'object' && Object.keys(j).length === 1 && j.type === 'commonjs'; }
    catch { return false; }
};
function commonJsScope({ dir, stackFiles = [], log = () => {}, note = () => {} })
{
    const file = path.join(dir, 'package.json');
    let have = null;
    try { have = fs.readFileSync(file, 'utf8'); } catch { have = null; }
    const ours = have !== null && isCommonJsMarker(have);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    const stack = new Set(stackFiles);
    if (!names.some((f) => f.endsWith('.js') && stack.has(f)))
    {
        if (ours) { fs.rmSync(file, { force: true }); log('  hooks marker removed: package.json (no stack copy left beside it)'); }
        return ours ? 'pruned' : 'none';
    }
    if (ours) return 'current';
    if (have !== null)
    {
        note(`.claude/hooks/package.json is the project's own and is left as it is - the stack's copies there are CommonJS, so they fail if it says "type": "module"`);
        return 'user';
    }
    const esmOwn = names.filter((f) => f.endsWith('.js') && !stack.has(f)).filter((f) =>
    {
        try { return /^\s*(?:import\s[\s\S]*?\sfrom\s|import\s*['"]|export\s)/m.test(fs.readFileSync(path.join(dir, f), 'utf8')); }
        catch { return false; }
    });
    if (esmOwn.length)
    {
        note(`.claude/hooks holds your own ES-module hook(s) (${esmOwn.join(', ')}), so no CommonJS marker is written there - in a "type": "module" project the stack's copies beside them fail to load until those are renamed to .mjs`);
        return 'user-esm';
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, COMMONJS_MARKER);
    log('  hooks marker written -> package.json (the copies load as CommonJS whatever the project\'s own type)');
    return 'written';
}

module.exports = { installFromSource, syncTree, respellPreloads, stampDocsRoot, stampedDocsRoot, resolveDocsRoot, resolveDocsVersioning, sameContent, removeDropped, commonJsScope, COMMONJS_MARKER, DOCS_ROOT_DEFAULT };
