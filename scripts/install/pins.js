'use strict';
// --keep-pins - the local model/effort values a refresh would otherwise reset.
//
// Every agent and skill ships with a `model:` / `effort:` pin in its frontmatter, and an update
// copies the catalog's values back over a project's own. `--keep-pins` snapshots what is on disk
// BEFORE the refresh and re-applies each value the refresh CHANGED - never a value the file did not
// carry, and never one the refresh left alone.
//
// Both halves are stated in the run summary either way: a run that RESET the pins to catalog
// defaults printed no line at all, so the close had nothing to cite and asserted the reset from
// memory instead.
const fs = require('node:fs');
const path = require('node:path');

// The value of one key from the LEADING frontmatter block - never from the body, where the same
// word can appear in prose.
function readPin(file, key)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return ''; }
    const lines = text.split('\n');
    if (!/^---\s*$/.test(lines[0] || '')) return '';
    for (let i = 1; i < lines.length; i += 1)
    {
        if (/^---\s*$/.test(lines[i])) return '';
        if (lines[i].startsWith(`${key}:`)) return lines[i].slice(key.length + 1).trim();
    }
    return '';
}

// Rewrite the key's line INSIDE the frontmatter block only.
function writePin(file, key, value)
{
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch { return false; }
    const lines = text.split('\n');
    if (!/^---\s*$/.test(lines[0] || '')) return false;
    for (let i = 1; i < lines.length; i += 1)
    {
        if (/^---\s*$/.test(lines[i])) return false;
        if (lines[i].startsWith(`${key}:`)) { lines[i] = `${key}: ${value}`; fs.writeFileSync(file, lines.join('\n')); return true; }
    }
    return false;
}

// Every locally-installed pin-bearing target: the manifest's agents, and each selected skill's
// SKILL.md. A file the project does not have is not a target.
function pinFiles({ projectRoot, skillsDir, agentsDir = path.join(projectRoot, '.claude', 'agents'), agents = [], skills = [] })
{
    const out = [];
    for (const entry of agents)
    {
        const file = path.join(agentsDir, String(entry).split('::')[0]);
        if (fs.existsSync(file)) out.push(file);
    }
    for (const entry of skills)
    {
        const file = path.join(skillsDir, String(entry).split('|').pop(), 'SKILL.md');
        if (fs.existsSync(file)) out.push(file);
    }
    return out;
}

const KEYS = ['model', 'effort'];

function snapshotPins({ files, log = () => {} })
{
    const snapshot = new Map();
    for (const file of files)
    {
        const saved = {};
        for (const key of KEYS) { const v = readPin(file, key); if (v) saved[key] = v; }
        if (Object.keys(saved).length) snapshot.set(file, saved);
    }
    log(`keep-pins: snapshotted model/effort from ${snapshot.size} file(s)`);
    return snapshot;
}

const display = (file) =>
{
    const at = file.replace(/\\/g, '/');
    const agents = at.indexOf('/.claude/agents/');
    if (agents >= 0) return `agents/${at.slice(agents + 16)}`;
    const skills = at.indexOf('/skills/');
    if (skills >= 0) return `skills/${at.slice(skills + 8)}`;
    return file;
};

function restorePins({ snapshot, files, log = () => {} })
{
    let kept = 0;
    for (const file of files)
    {
        const saved = snapshot.get(file);
        if (!saved) continue;
        for (const key of KEYS)
        {
            if (!saved[key]) continue;
            const current = readPin(file, key);
            // Only a value the refresh CHANGED: a key the upstream file no longer carries is not
            // re-introduced, and an unchanged one is not rewritten.
            if (!current || current === saved[key]) continue;
            if (writePin(file, key, saved[key])) { kept += 1; log(`  pin kept: ${display(file)} ${key}=${saved[key]} (upstream: ${current})`); }
        }
    }
    log(`keep-pins: re-applied ${kept} local pin value(s)`);
    return kept;
}

module.exports = { readPin, writePin, pinFiles, snapshotPins, restorePins, KEYS };
