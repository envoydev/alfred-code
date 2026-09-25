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

const DOCS_ROOT_DEFAULT = '.claude/docs';
const DOCS_ROOT_RULE = 'baseline-docs-root.md';

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

function installFromSource({ sourceDir, subdir, label, destDir, files, exec = false, log = () => {}, note = () => {} })
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
        if (sameContent(src, dest))
        {
            // Unchanged content can still have lost its exec bit - re-assert it rather than leave a
            // hook that is present, current and unable to run.
            if (exec) { try { fs.chmodSync(dest, 0o755); } catch { /* a read-only tree says so elsewhere */ } }
            log(`  ${label} current: ${file}`);
            skipped.push(file);
            continue;
        }
        fs.copyFileSync(src, dest);
        if (exec) { try { fs.chmodSync(dest, 0o755); } catch { /* as above */ } }
        log(`  ${label} installed -> ${file}`);
        copied.push(file);
    }
    return { copied, skipped, missing };
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
    const env = readBackSettings(claudeDir, at === 'local' ? 'local' : 'project').env;
    return envOf(env && typeof env === 'object' ? env : {}, 'DOCS_PATH') || DOCS_ROOT_DEFAULT;
}

// Replace `__DOCS_ROOT__` in the COPIED rule with the current value. It runs on install and on
// update, and it is once-only by construction: after it runs there is no placeholder left. What
// makes an update re-stamp is the copy that precedes it - the stamped destination differs from the
// pristine source, so the source is copied back and this writes the current value over a fresh
// placeholder. The two halves are one behaviour; neither works alone.
function stampDocsRoot(projectRoot, { scope, log = () => {}, note = () => {} } = {})
{
    const rule = path.join(projectRoot, '.claude', 'rules', DOCS_ROOT_RULE);
    if (!fs.existsSync(rule)) return false;
    const value = resolveDocsRoot(projectRoot, scope);
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
function removeDropped({ drop = [], dirs, shipped, log = () => {} })
{
    for (const line of drop)
    {
        const [category, name] = line.split(' ');
        if (!DROP_PATH[category] || !(shipped[category] || []).includes(name)) continue;
        const target = path.join(dirs[category], DROP_PATH[category](name));
        if (!fs.existsSync(target)) continue;
        fs.rmSync(target, { recursive: true, force: true });
        log(`  ${category} removed (dropped): ${name}`);
    }
}

module.exports = { installFromSource, stampDocsRoot, resolveDocsRoot, sameContent, removeDropped, DOCS_ROOT_DEFAULT };
