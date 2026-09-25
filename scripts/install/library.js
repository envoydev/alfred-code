'use strict';
// THE LIBRARY COPY - every skill and agent outside the core, copied into the project per pick.
//
// A plugin skill is locked on (Claude Code's own rule, measured in the 2026-09-24 library test), so
// a project copy is the only thing a project can switch off. Three rules:
//   - IDENTICAL CONTENT IS NOT REWRITTEN, like every other copy the installer makes.
//   - THE STAMP HOLDS THE HASH OF WHAT WAS WRITTEN. A copy whose hash differs from it was edited in
//     the project; update still overwrites it (the stack owns the copy), but says so, and validate
//     reports the drift before any update runs.
//   - A MISSING SOURCE IS REPORTED AND SKIPPED; the copy already there stays.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Every file under `p` as [relative path, content], sorted by path so the hash is stable across
// platforms and directory orders; one entry for a file; null when absent.
function files(p)
{
    let stat;
    try { stat = fs.statSync(p); } catch { return null; }
    if (stat.isFile()) return [[path.basename(p), fs.readFileSync(p)]];
    const out = [];
    const walk = (dir, rel) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
        {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), r);
            else out.push([r, fs.readFileSync(path.join(dir, e.name))]);
        }
    };
    walk(p, '');
    return out;
}

function hashItem(p)
{
    const list = files(p);
    if (!list) return null;
    const h = crypto.createHash('sha256');
    for (const [rel, buf] of list) h.update(`${rel}\0${buf.length}\0`).update(buf);
    return h.digest('hex');
}

// hashItem's single-file formula, over content already in memory - for a NORMALISED comparison
// (library-check.js restores the docs-root placeholder before hashing) where writing a probe file
// to disk just to hash it would be wasted work.
function hashBuffer(name, buf)
{
    const h = crypto.createHash('sha256');
    return h.update(`${name}\0${buf.length}\0`).update(buf).digest('hex');
}

// Rules are a third kind, same shape as agents: no plugin ever carries one (there is no plugin
// route for a rule), so every rule is always a library copy, on every route.
// `render` maps `<kind>/<name>` of a single-file item to a function of its source text: the copy is
// compared with, and written as, the rendered text - so a copy the installer itself substitutes into
// (baseline-docs-root's `__DOCS_ROOT__`) is rewritten only when the substitution changes it.
function copyLibrary({ sourceDir, skillsDir, agentsDir, rulesDir, skills = [], agents = [], rules = [], stamped = null, render = {}, log = () => {}, note = () => {} })
{
    const out = { skills: {}, agents: {}, rules: {} };
    const plan = [
        ...skills.map((name) => ({ kind: 'skills', label: 'skill', name, src: path.join(sourceDir, 'stack', 'skills', name), dst: path.join(skillsDir, name) })),
        ...agents.map((name) => ({ kind: 'agents', label: 'agent', name, src: path.join(sourceDir, 'stack', 'agents', `${name}.md`), dst: path.join(agentsDir, `${name}.md`) })),
        ...rules.map((name) => ({ kind: 'rules', label: 'rule', name, src: path.join(sourceDir, 'stack', 'rules', `${name}.md`), dst: path.join(rulesDir, `${name}.md`) })),
    ];
    for (const item of plan)
    {
        const renderer = render[`${item.kind}/${item.name}`];
        let body = null;
        if (renderer) { try { body = Buffer.from(renderer(fs.readFileSync(item.src, 'utf8'))); } catch { body = null; } }
        const want = body ? hashBuffer(path.basename(item.dst), body) : hashItem(item.src);
        if (!want) { note(`${item.label} '${item.name}' not found in the stack source`); continue; }
        const have = hashItem(item.dst);
        if (have === want) { out[item.kind][item.name] = want; continue; }
        const was = stamped && stamped[item.kind] ? stamped[item.kind][item.name] : undefined;
        if (have && was && have !== was) log(`  overwriting a hand-edited copy: ${item.label} ${item.name}`);
        fs.rmSync(item.dst, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(item.dst), { recursive: true });
        if (body) fs.writeFileSync(item.dst, body);
        else fs.cpSync(item.src, item.dst, { recursive: true });
        out[item.kind][item.name] = hashItem(item.dst);
        log(`${item.label} [library]: ${item.name}`);
    }
    return out;
}

module.exports = { hashItem, hashBuffer, copyLibrary };
