#!/usr/bin/env node
'use strict';
// The EVAL BUNDLE - the core plus the whole library, flattened into ONE plugin, for
// `claude plugin eval` only. Nothing installs it.
//
//   node scripts/build-eval-bundle.js <out>
//
// Library items are project copies, listed by no marketplace entry, so the eval CLI - which loads a
// plugin into an isolated session - cannot see them any other way. The bundle is named
// `alfred-code`, the core's own name, so a core agent's `alfred-code:<skill>` preload resolves as
// it does in a project; a library agent's BARE preload (a project copy resolves it by name) is
// rewritten to that spelling here, in the copy, never in the source. `meta/evals/library/*` travel
// as the bundle's `evals/`: one case per stack profile, each graded on both arms so the
// with/without-plugin delta is measured, not assumed, plus the size-first cases of task-solve
// (a library skill since 2.1.0, so only the bundle carries it).
//
// The core's commands and router call `${CLAUDE_PLUGIN_ROOT}/scripts/...`, `.../setup-plugin/references/...`
// and `.../stack/hooks/...` - the core's plugin root is the repo root. The bundle copies those trees
// (and `meta/`, which the scripts read) to the same relative paths, so every path a bundled body names
// resolves inside the bundle as it does in the core (the 2.1.4 audit, I9).
const fs = require('node:fs');
const path = require('node:path');
const { placement, CORE } = require('./plugin-placement.js');
const { coreEntry } = require('./build-marketplace.js');

const REPO = path.resolve(__dirname, '..');
const BUNDLE_DESCRIPTION = 'Eval bundle: the alfred-code core plus the full library, for claude plugin eval only.';

// Bare house preloads in the frontmatter `skills:` list become `alfred-code:<n>`; a name with a
// colon belongs to another plugin and is left alone.
function scopePreloads(text, houseSkills)
{
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!m) return text;
    let inSkills = false;
    const lines = m[1].split('\n').map((line) =>
    {
        if (/^skills:\s*$/.test(line)) { inSkills = true; return line; }
        if (inSkills && !/^\s*-/.test(line) && line.trim()) inSkills = false;
        if (!inSkills) return line;
        return line.replace(/^(\s*-\s*)([a-z0-9-]+)\s*$/, (all, lead, name) => (houseSkills.has(name) ? `${lead}${CORE}:${name}` : all));
    });
    return `---\n${lines.join('\n')}\n---${text.slice(m[0].length)}`;
}

function build(out, { repo = REPO } = {})
{
    const place = placement();
    const core = coreEntry({ placement: place });
    const skills = [...place.plugins[CORE].skills, ...place.library.skills];
    const agents = [...place.plugins[CORE].agents, ...place.library.agents];
    const house = new Set(skills);

    // The output is wiped first, so only an absent or empty directory, or a bundle this script wrote,
    // is ever a target - `npm run eval-bundle -- .` must not take the working tree with it.
    // A FILE there is refused too: reading it as a directory throws, which must never read as absent.
    const stat = fs.statSync(out, { throwIfNoEntry: false });
    const entries = stat && stat.isDirectory() ? fs.readdirSync(out) : [];
    let ours = false;
    try { ours = JSON.parse(fs.readFileSync(path.join(out, '.claude-plugin', 'plugin.json'), 'utf8')).description === BUNDLE_DESCRIPTION; } catch { ours = false; }
    if (stat && (!stat.isDirectory() || (entries.length && !ours))) throw new Error(`${out} is not an empty directory and not a previous eval bundle - pick a new directory`);
    fs.rmSync(out, { recursive: true, force: true });
    for (const d of ['skills', 'agents', 'commands', 'evals', '.claude-plugin']) fs.mkdirSync(path.join(out, d), { recursive: true });

    fs.cpSync(path.join(repo, 'setup-plugin', 'skills', 'alfred-code'), path.join(out, 'skills', 'alfred-code'), { recursive: true });
    for (const s of skills) fs.cpSync(path.join(repo, 'stack', 'skills', s), path.join(out, 'skills', s), { recursive: true });
    for (const a of agents)
        fs.writeFileSync(path.join(out, 'agents', `${a}.md`), scopePreloads(fs.readFileSync(path.join(repo, 'stack', 'agents', `${a}.md`), 'utf8'), house));
    for (const c of core.commands) fs.copyFileSync(path.join(repo, c), path.join(out, 'commands', path.basename(c)));

    // The trees the bundled bodies name under ${CLAUDE_PLUGIN_ROOT} - and what the scripts read - at the
    // core's own relative paths. The library cases already travel as evals/, so meta/evals is left out.
    const ROOT_TREES = ['scripts', 'meta', 'stack', path.join('setup-plugin', 'references')];
    for (const tree of ROOT_TREES)
        fs.cpSync(path.join(repo, tree), path.join(out, tree), { recursive: true, filter: (src) => path.relative(repo, src) !== path.join('meta', 'evals') });

    const casesDir = path.join(repo, 'meta', 'evals', 'library');
    const cases = fs.existsSync(casesDir) ? fs.readdirSync(casesDir).filter((c) => fs.existsSync(path.join(casesDir, c, 'case.yaml'))) : [];
    for (const c of cases) fs.cpSync(path.join(casesDir, c), path.join(out, 'evals', c), { recursive: true });

    fs.writeFileSync(path.join(out, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
        name: CORE,
        version: core.version,
        description: BUNDLE_DESCRIPTION,
        // `claude plugin validate --strict` refuses a manifest without it (measured, 2026-09-24).
        author: core.author,
    }, null, 2)}\n`);
    return { skills: skills.length + 1, agents: agents.length, commands: core.commands.length, cases: cases.length };
}

if (require.main === module)
{
    const out = process.argv[2];
    if (!out) { console.error('usage: build-eval-bundle.js <out>'); process.exit(1); }
    try { console.log(JSON.stringify(build(path.resolve(out)))); }
    catch (err) { console.error(String(err.message || err)); process.exit(1); }
}

module.exports = { build, scopePreloads };
