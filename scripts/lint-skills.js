#!/usr/bin/env node
// Repo lint: keep the registration surfaces and all cross-skill references in
// sync. The installer's six lists - skills, agents, rules, hooks, plugins, MCPs - live in ONE
// hand-edited file, meta/stack-manifest.json (Phase 7b, R33, deleted the frozen shell and
// PowerShell installers that used to carry them). SKILLS and MCPS are ALSO shared with the Cursor
// stack (the separate cursor-stack repo, whose installers clone this repo for skills); that
// cross-repo parity is held by discipline (a baseline change is a two-repo commit).
// Catches the failure modes that actually happen:
//   1. a skill directory exists but is missing from a manifest or the HTML
//      inventory (it would silently never install);
//   2. a SKILL.md references a skill name that does not exist anywhere (typo or
//      rename rot, e.g. `vertical-slice` vs `vertical-slice-architecture`);
//   3. a SKILL.md frontmatter block that a strict YAML parser (js-yaml here)
//      cannot load, which silently drops the skill from the registry, e.g. an
//      unquoted `description:` containing `Companion: ` (colon-space);
//   4. drift between the two manifests, or between them and the stack HTML;
//   5. headline Skills/Plugins/MCP/Hooks/Agents/Rules counts in the
//      README drifting from the actual installer/on-disk set sizes (those prose
//      numbers can no longer lie);
//   6. a backticked skill name that resolves to nothing - scanned in skill files,
//      agents/*.md subagents, AND the base template + claude rules
//      (CLAUDE.template.md / rules/*.md), where a renamed skill would
//      otherwise rot silently; tokens there resolve against
//      skills + plugins + MCPs + agent names + NON_SKILL_TOKENS;
//   7. a false 'Vendored from' label on a house dotnet-* skill (they are
//      original work; honest 'Adapted from'/attribution is allowed);
//   8. the two installers listing the SKILLS block in a DIFFERENT
//      ORDER (not just a different set);
//   9. the on-disk agents/*.md set diverging from the agents the
//      installers fetch (the AGENTS manifest array);
//  10. a LOAD directive naming a skill the install can legitimately lack - an
//      optional skill (evidence-gated or opt-in, so unreachable from any seed
//      closure) cited with no availability guard, which makes the model call a
//      skill that is not there and take an 'Unknown skill' error;
//  11. the CROSS-STACK case of the same defect - a load directive naming a skill
//      absent from a stack the CITING artifact itself ships into (an always-on
//      agent naming `angular-security`, which a .NET-only install never has);
//  12. the four classes of named cite that same machinery used to walk past - a
//      directive with no load verb (`Companions:`, `Points at`, `routes to`), an
//      AGENT name, a bare `<plugin>:<skill>` name, and any cite in a file whose
//      one `**Availability**` callout was blanketing sections it never spoke for;
//  13. an agent `tools:` entry that is not a real tool name (a dead grant is silent),
//      and a reference over 100 lines that opens with no table of contents.
// Also verifies that every NON_SKILL_TOKENS allowlist entry is still actually used (no dead
// config), that rules/*.md + agents/*.md frontmatter parses as
// strict YAML with the required keys (an unquoted ': ' scalar breaks GitHub
// rendering and strict parsers - the skills already get this via check 1),
// that every copy of a deliberate multi-home rule still matches its marker in
// meta/shared-rules.json (edit one copy without syncing the others = red),
// and warns (soft) on over-long SKILL.md descriptions.
// Needs js-yaml (run `npm install` once). Run: node scripts/lint-skills.js
//   -> exit 0 clean (warnings allowed), 1 with findings.
'use strict';
const fs = require('fs');
// --- CRLF normalization, once, at the boundary --------------------------------------------------
// A Windows checkout has CRLF line endings (git's autocrlf converts on the way out), and JS treats
// `\r` as a LINE TERMINATOR: `.` does not match it. So a pattern ending `(#.*)?$` fails on every
// commented line - measured, when the installers were still text (the frozen `.ps1` twin, deleted
// Phase 7b): eight false findings on a repo where the source was in perfect sync. Text read here is
// never sensitive to which bytes end a line, so normalize every utf8 read and let every regex below
// stay written for `\n`.
const _readFileSync = fs.readFileSync;
fs.readFileSync = (p, o) => ((o === 'utf8' || (o && o.encoding === 'utf8'))
    ? String(_readFileSync(p, o)).replace(/\r\n/g, '\n')
    : _readFileSync(p, o));

const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { SIGNAL_KINDS } = require('./scan-evidence.js');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'stack', 'skills');
const MANIFEST_JSON = path.join(ROOT, 'meta', 'stack-manifest.json');
const README = path.join(ROOT, 'README.md');
const CLAUDE_README = README;   // merged into the root README at the repo flatten
const STACK_HTML = path.join(ROOT, 'docs', 'alfred-code.html');
const AGENTS_DIR = path.join(ROOT, 'stack', 'agents');
const CLAUDE_TEMPLATE = path.join(ROOT, 'stack', 'CLAUDE.template.md');
const CLAUDE_RULES_DIR = path.join(ROOT, 'stack', 'rules');
const PLUGIN_MARKETPLACE_URLS = new Set([
    'https://github.com/anthropics/claude-plugins-official',
    'https://github.com/jarrodwatts/claude-hud',
    'https://github.com/DietrichGebert/ponytail',
]);

// Backticked kebab-case tokens that look like skill names but are not
// (code identifiers, example selectors). Extend when lint flags a false positive.
// Every entry here MUST appear as a backtick in some skill file (check 11 fails
// any dead entry), so this stays an exact, self-pruning allowlist.
const NON_SKILL_TOKENS = new Set([
    // the CLAUDE.template.md rules table's slash-only-capture notation - a marker, not a skill.
    'user-run',
    // the commit-gate hook, referenced by name from baseline-git.md and project-verify-code - a hook, not a skill.
    'guard-ungated-commit',
    // the env-gated usage instrument, named by the usage analyzer as the thing to switch on - a hook, not a skill.
    'instrument-tool-usage',
    // npm flags, npmrc keys, and package names in the npm skill - tool identifiers, not skills.
    'ignore-scripts',
    'min-release-age',
    'default-days',
    'run-s',
    'run-p',
    // a command frontmatter field and the reserved marketplace names named in the plugin-authoring skill - identifiers, not skills.
    'allowed-tools',
    'claude-plugins-official',
    'claude-community',
    'anthropic-plugins',
    // CSP directive + npm package named in the browser-extension skill - identifiers, not skills.
    'unsafe-eval',
    'chrome-types',
    // lint rule, npm packages, and a CSS property named in the typescript skill's references.
    'no-floating-promises',
    'ts-pattern',
    'web-vitals',
    'aspect-ratio',
    // webpack plugin/loader/devtool/mode identifiers named in the webpack skill - tools, not skills.
    'fork-ts-checker-webpack-plugin',
    'hidden-source-map',
    'thread-loader',
    'speed-measure-webpack-plugin',
    'write-dts',
    'tsconfig-paths-webpack-plugin',
    'app-order-list', // Angular selector example in angular-conventions
    'order-list',     // Angular selector example in angular-conventions
    'axe-core',       // a11y testing package in angular-conventions, not a skill
    'jest-axe',       // a11y testing package in angular-conventions, not a skill
    'vitest-axe',     // its Vitest twin, same runner-conditional a11y line
    // old Angular Material button directive selectors named in angular-material's
    // v20 migration note (matButton replaced them) - code identifiers, not skills.
    'mat-button',
    'mat-raised-button',
    'mat-flat-button',
    'mat-stroked-button',
    // Claude Code SKILL.md frontmatter field (manual-only skills), backticked in
    // prose in project-solve-cross-task + the base template - a field name, not a skill.
    'disable-model-invocation',
    // the two GENERATED per-project awareness rules (written by the capture skills,
    // never in the installer manifest) - rule file names, not skills; referenced by
    // project-solve-cross-task's in-session scoping step.
    'baseline-project-architecture',
    'baseline-project-related-context',
    // built-in Claude Code agent type named in the base template's navigation
    // guidance (don't delegate single-symbol lookups to it) - not a house skill.
    'general-purpose',
    // real .NET CLI diagnostic tools (global tools), backticked as code identifiers
    // in dotnet-diagnostics/references/dumps.md - not house skills.
    'dotnet-dump',
    'dotnet-gcdump',
    'dotnet-counters',
    'dotnet-trace',
    // PostgreSQL extension module named in database-conventions' SQL style reference
    // (pre-v13 UUID generation) - a Postgres module, not a house skill.
    'uuid-ossp',
    // file-naming style term backticked in the typescript style reference - a
    // convention name, not a house skill.
    'kebab-case',
]);

const findings = [];
const warnings = [];   // soft (printed, never fail the build)

function flag(message)
{
    findings.push(message);
}

function warn(message)
{
    warnings.push(message);
}

// The manifest reader. Until Phase 7b these four shapes (skill map, file list, flat set, hooks list)
// were parsed out of the sh/ps1 text blocks - now they read meta/stack-manifest.json directly, the
// one hand-edited home for the six lists. Each reader keeps the exact OUTPUT shape its old
// text-parsing twin gave the checks below (Map/Set of active vs commented), so a row's `active:
// false` still means 'shipped but not seeded' - a real state, not an absence.
function readStackManifest(file)
{
    return JSON.parse(fs.readFileSync(file || MANIFEST_JSON, 'utf8'));
}

// SKILLS rows -> {active: Map(name -> repo), commented: Map(name -> repo)}.
function manifestSkillMap(rows)
{
    const active = new Map();
    const commented = new Map();
    for (const row of rows || [])
        (row.active === false ? commented : active).set(row.name, row.repo);
    return { active, commented };
}

// AGENTS / RULES / HOOKS rows -> the ordered list of active `file` names (a hook wired on two
// matchers is two rows, one file - callers that want unique files de-dupe with a Set).
function manifestFileList(rows)
{
    return (rows || []).filter((r) => r.active !== false).map((r) => r.file);
}

function localSkillDirs()
{
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
}

// PLUGINS / MCPS rows -> {active: Set(name), commented: Set(name)}. `idOf` picks the row's own name
// field: a plugin's `id` is `name@marketplace` (split on `@`), an MCP row's `name` is already bare.
function manifestFlatSet(rows, idOf)
{
    const active = new Set();
    const commented = new Set();
    for (const row of rows || [])
        (row.active === false ? commented : active).add(idOf(row));
    return { active, commented };
}

// Lint the evidence catalog (meta/evidence.json) against the
// artifact rosters: a typo'd key silently never matches (the scan just skips it),
// and a regex signal without a label surfaces as raw regex in the guided commands'
// consent tables. Pure - main() feeds it the real catalog and rosters; the test
// file exercises it with synthetic ones.
function lintEvidenceCatalog(catalog, rosters)
{
    const out = [];
    const layers = { skills: 'skill', mcps: 'mcp', plugins: 'plugin' };
    for (const key of Object.keys(catalog))
    {
        if (key !== '_comment' && !(key in layers))
        {
            out.push(`evidence.json has unknown layer '${key}' - the scan reads only skills/mcps/plugins, so its entries would silently never match`);
        }
    }

    for (const [layer, singular] of Object.entries(layers))
    {
        for (const [name, entry] of Object.entries(catalog[layer] || {}))
        {
            if (!rosters[layer].has(name))
            {
                out.push(`evidence.json names ${singular} '${name}' which is not in the ${layer} roster - the signal would silently never match`);
            }

            for (const kind of Object.keys(entry))
            {
                if (!kind.startsWith('_') && !SIGNAL_KINDS.includes(kind))
                {
                    out.push(`evidence.json ${singular} '${name}' has unknown signal kind '${kind}' - the scan reads only ${SIGNAL_KINDS.join('/')}, so it would silently never match`);
                }
            }

            for (const kind of ['csprojContent', 'content'])
            {
                for (const signal of entry[kind] || [])
                {
                    if (typeof signal.label !== 'string' || signal.label.trim() === '')
                    {
                        out.push(`evidence.json ${singular} '${name}' has a ${kind} signal without a label - consent tables would show the raw regex`);
                    }
                }
            }
        }
    }

    return out;
}

// Lint the judgment catalog (meta/judgment.json) against the artifact
// rosters: refs are '<category>:<name>' and a typo'd ref silently never fires; every overlap
// item needs its unique gap (the keep decision hinges on it); versionConflicts need an integer
// threshold; occasionBound cadences must be non-empty. Pure, like lintEvidenceCatalog.
function lintJudgmentCatalog(catalog, rosters)
{
    const out = [];
    const plural = { skill: 'skills', agent: 'agents', mcp: 'mcps', plugin: 'plugins' };
    const known = ref =>
    {
        const i = ref.indexOf(':');
        const layer = plural[ref.slice(0, i)];
        return layer && rosters[layer] && rosters[layer].has(ref.slice(i + 1));
    };
    const checkRef = (ref, where) => { if (!known(ref)) out.push(`judgment.json ${where} names '${ref}' which resolves to no known artifact - it would silently never fire`); };

    for (const o of catalog.overlaps || [])
    {
        const items = o.items || [];
        if (items.length < 2) out.push('judgment.json has an overlap with fewer than 2 items - nothing to overlap');
        if (typeof o.shared !== 'string' || o.shared.trim() === '') out.push(`judgment.json overlap [${items.join(', ')}] has no shared capability text`);
        for (const ref of items)
        {
            checkRef(ref, 'overlap');
            if (typeof (o.gaps || {})[ref] !== 'string' || !o.gaps[ref].trim()) out.push(`judgment.json overlap item '${ref}' has no gap - the keep decision hinges on each side's unique gap`);
        }
    }

    for (const c of catalog.versionConflicts || [])
    {
        checkRef(c.item, 'versionConflicts');
        for (const field of ['package', 'conflict', 'survives'])
        {
            if (typeof c[field] !== 'string' || !c[field].trim()) out.push(`judgment.json versionConflicts '${c.item}' is missing '${field}'`);
        }
        if (!/^\d+$/.test(String(c.below || ''))) out.push(`judgment.json versionConflicts '${c.item}' has non-integer below '${c.below}'`);
    }

    for (const [ref, cadence] of Object.entries(catalog.occasionBound || {}))
    {
        checkRef(ref, 'occasionBound');
        if (typeof cadence !== 'string' || cadence.trim() === '') out.push(`judgment.json occasionBound '${ref}' has an empty cadence - the cadence IS the citation`);
    }

    return out;
}

// Lint the shared-rules registry (meta/shared-rules.json): each entry is ONE rule whose text
// deliberately lives in several stack files (a canonical owner + inline restatements, no prose
// cross-mentions). Every copy is pinned by a marker phrase from that file's own wording,
// matched whitespace-normalized so md line wrapping cannot break it. A copy edited or deleted
// breaks its marker -> the finding lists every other copy, forcing the sync mechanically.
// 30. A CAPABILITY SENTENCE in the stack's own source needs a live probe or it does not ship.
// Three artifacts were caught asserting a harness capability nobody had tested: a deny-list claim
// that the account settings.json `Read(**/config.json)` rule also stops a Bash `cat` (refuted live -
// two cats returned content, is_error:false, zero denial strings in the transcript), a brief handing
// a git-drift question to a seat with no Bash, and the installer comment resting the whole
// SECRET_DENY mechanism on the first claim. A false claim in the SOURCE propagates to every install.
// So: a sentence that says what the harness DOES with a tool, a permission, a hook or a config file
// must carry its evidence within the same comment block - `measured`, `replayed`, `reproduced`,
// `probed`, `verified`, `confirmed` or `proven`. Deliberately narrow: it is the assertion shape that
// shipped false three times, not every sentence with the word 'hook' in it.
const CAP_NOUN = /(deny (list|rule)|denial|permission|PreToolUse|PostToolUse|SessionStart|UserPromptSubmit|Stop hook|matcher|settings\.json|additionalContext|subagent|\.mcp\.json|allowlist)/i;
const CAP_VERB = /(reaches|does not reach|never reaches|blocks|does not block|cannot|is not consulted|expands|does not expand|takes effect|inherits|does not inherit|propagates|never fires)/i;
const CAP_PROOF = /\b(measured|replayed|reproduced|probed|verified|confirmed|proven|proved)\b/i;
function lintCapabilityClaims(files)
{
    const out = [];
    for (const { path: rel, text } of files)
    {
        for (const m of text.matchAll(/[^.\n]{40,400}\./g))
        {
            const sentence = m[0];
            // a function header or a banner comment names the mechanism, it does not assert about it
            // a banner comment ('# INSTALL + UPDATE: ...') or a function header names the mechanism,
            // it does not assert anything about how the harness behaves
            if (/^\s*(#|\/\/)\s*[A-Z][A-Z +_-]{2,}:/.test(sentence)) continue;
            if (/^\s*\w[\w-]*\s*\(\)\s*\{/.test(sentence)) continue;
            if (/^\s*function\s+[\w-]+/.test(sentence)) continue;
            if (!CAP_NOUN.test(sentence) || !CAP_VERB.test(sentence)) continue;
            const ctx = text.slice(Math.max(0, m.index - 800), m.index + sentence.length + 800);
            if (CAP_PROOF.test(ctx)) continue;
            const line = text.slice(0, m.index).split('\n').length;
            out.push(`${rel}:${line} asserts a harness capability with no probe in its comment block - cite the measurement or do not claim it: '${sentence.trim().slice(0, 90)}'`);
        }
    }
    return out;
}

// 29. Every DELIBERATE-ONLY skill must be in guard-fresh-session-start.js's ORCHESTRATION list.
// `disable-model-invocation: true` is the skill saying it only ever starts because a person asked
// for it - which is exactly the run that must not start on another finished run's carried history.
// The list was hand-maintained and drifted: four such runs were missing from the live regex, so the
// fresh-session offer never fired for them. Generated from the roster instead of trusted.
function lintOrchestrationRoster(deliberateSkills, hookSrc)
{
    const m = /^const ORCHESTRATION = (\/.*\/);$/m.exec(hookSrc);
    if (!m) return ['guard-fresh-session-start.js: no `const ORCHESTRATION = /.../;` line to check the roster against'];
    let re;
    try { re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/'))); }
    catch (err) { return [`guard-fresh-session-start.js: ORCHESTRATION is not a usable regex (${err.message})`]; }
    return deliberateSkills
        .filter((name) => !re.test(name))
        .map((name) => `${name} declares disable-model-invocation but is absent from guard-fresh-session-start.js's ORCHESTRATION list - the fresh-session offer will never fire for it`);
}

// 28. The plugin-settings catalog (meta/plugin-settings.json) - the same silent-miss class as
// evidence.json, one layer out: a row for a plugin the stack does not install is never offered,
// and a key the plugin does not read is a no-op the user still gets asked about. The version the
// keys were read from is part of the row, so an upstream rename is traceable rather than silent.
// Pure, like lintEvidenceCatalog.
function lintPluginSettings(catalog, pluginRoster)
{
    const out = [];
    for (const key of Object.keys(catalog))
    {
        if (key !== '_comment' && key !== 'plugins') out.push(`plugin-settings.json has unknown top-level key '${key}' - the tool reads only 'plugins'`);
    }

    for (const [name, entry] of Object.entries(catalog.plugins || {}))
    {
        if (!pluginRoster.has(name)) out.push(`plugin-settings.json names plugin '${name}', which is not in the plugins roster - its settings would never be offered`);
        // The note must name THIS plugin and a version - a row copied from a sibling keeps the
        // sibling's name and reads as verified while pointing at the wrong package's keys. The
        // INSTALLED version cannot be compared here: the PLUGINS manifest pins no version (it
        // installs newest), so that half is the walk's job, where `claude plugin list` is readable.
        if (!new RegExp(`^${escapeRe(name)} \\d+\\.\\d+\\.\\d+`).test(String(entry.verified || ''))) out.push(`plugin-settings.json '${name}' needs a \`verified\` note opening with '${name} <version>' - the exact plugin and version its keys were read from, since a key the plugin does not read is a silent no-op and a row copied from another plugin reads as verified`);
        if (!Array.isArray(entry.targets) || !entry.targets.length) { out.push(`plugin-settings.json '${name}' has no targets`); continue; }
        for (const t of entry.targets)
        {
            if (!t.file || path.isAbsolute(t.file) || t.file.includes('..')) out.push(`plugin-settings.json '${name}' target file must be a relative path inside the account config dir, got '${t.file}'`);
            if (!t.settings || typeof t.settings !== 'object') { out.push(`plugin-settings.json '${name}' target '${t.file}' has no settings object`); continue; }
            for (const group of Object.keys(t.settings))
            {
                if (!((t.why || {})[group])) out.push(`plugin-settings.json '${name}' target '${t.file}' changes '${group}' with no \`why\` - a recommendation the user cannot weigh is not one`);
            }
        }
    }

    return out;
}

// Pure, like lintEvidenceCatalog: readFile is injected for testability.
function lintSharedRules(registry, readFile)
{
    const out = [];
    const squash = s => s.replace(/\s+/g, ' ');
    for (const [name, rule] of Object.entries(registry.rules || {}))
    {
        const copies = [
            ...(rule.owner ? [{ ...rule.owner, role: 'owner' }] : []),
            ...(rule.sites || []).map(s => ({ ...s, role: 'site' })),
        ];
        if (!rule.owner) out.push(`shared-rules '${name}' has no owner - the canonical copy must be named`);
        if (copies.length < 2) out.push(`shared-rules '${name}' lists fewer than 2 copies - nothing shared to sync`);

        for (const copy of copies)
        {
            if (typeof copy.marker !== 'string' || copy.marker.trim() === '')
            {
                out.push(`shared-rules '${name}' ${copy.role} ${copy.file} has an empty marker`);
                continue;
            }

            let content;
            try
            {
                content = readFile(copy.file);
            }
            catch
            {
                out.push(`shared-rules '${name}' ${copy.role} names missing file ${copy.file}`);
                continue;
            }

            if (!squash(content).includes(squash(copy.marker)))
            {
                const others = copies.filter(c => c !== copy).map(c => c.file).join(', ');
                out.push(`shared-rules '${name}': marker not found in ${copy.file} - the copy was edited or removed; sync the other copies (${others}), then update the markers`);
            }
        }
    }

    return out;
}


// The skills an install can legitimately LACK: every local skill NOT reachable
// from the guided commands' seeds (meta/recommendations.json) through the
// dependency graph (agent -> skill, rule -> skill). Everything else arrives with
// its stack; these arrive only on an evidence match or a deliberate opt-in.
function optionalSkills(recs, graph, skillDirs)
{
    const reachable = new Set();
    for (const [, c] of Object.entries(seedClosures(recs, graph)))
    {
        for (const s of c.skills) if (skillDirs.has(s)) reachable.add(s);
    }

    return new Set([...skillDirs].filter(s => !reachable.has(s)));
}

// What each SEED installs, closed over the graph (an agent or rule pulls its skills).
// `general` is the opt-in list no stack owns, so it seeds nothing: a skill reachable only
// from there is absent unless the user deliberately adds it.
function seedClosures(recs, graph)
{
    const out = {};
    for (const [tag, seed] of [['ALWAYS', recs.always || {}], ...Object.entries(recs.stacks || {})])
    {
        const c = { skills: new Set(seed.skills || []), agents: new Set(seed.agents || []), rules: new Set(seed.rules || []) };
        for (const kind of ['agents', 'rules'])
        {
            for (const name of c[kind])
            {
                for (const s of (((graph[kind] || {})[name] || {}).skills || [])) c.skills.add(s);
            }
        }

        out[tag] = c;
    }

    // ALWAYS ships into every project, so every stack's closure contains it too - without this
    // union an always-on skill reads as 'absent everywhere' and the cross-stack check inverts.
    for (const [tag, c] of Object.entries(out))
    {
        if (tag === 'ALWAYS') continue;
        for (const kind of ['skills', 'agents', 'rules']) for (const n of out.ALWAYS[kind]) c[kind].add(n);
    }

    return out;
}

// The agents an install can legitimately LACK - the same computation as optionalSkills, one layer
// out. `related-project-analyzer` is the live case: it sits in recommendations.json's `general`
// list, so no stack seeds it and a project can carry the skill that names it without the seat.
function optionalAgents(recs, graph, agentNames)
{
    const reachable = new Set();
    for (const [, c] of Object.entries(seedClosures(recs, graph)))
    {
        for (const a of c.agents) if (agentNames.has(a)) reachable.add(a);
    }

    return new Set([...agentNames].filter(a => !reachable.has(a)));
}

// The stacks a given artifact is installed in. ALWAYS means every project, so an artifact
// seeded there may cite only skills that are ALSO everywhere.
// 39. An artifact NO seed installs (opt-in, evidence-gated, the `general` list) used to return an
// empty host set, which exempted it from the cross-stack check entirely - a citer with no closure
// was the one shape that could name anything. It is the opposite case: such an artifact can land in
// ANY project, so only what ships everywhere is guaranteed beside it. Its host is every stack.
function hostStacks(closures, kind, name)
{
    const stacks = Object.keys(closures).filter(t => t !== 'ALWAYS');
    if ((closures.ALWAYS[kind] || new Set()).has(name)) return new Set(stacks);

    const seeded = stacks.filter(t => closures[t][kind].has(name));

    return new Set(seeded.length > 0 ? seeded : stacks);
}

// The artifacts a given citer must NOT direct a load of without a guard: those missing from at
// least one stack the citer itself ships into. This is the general case of optionalSkills -
// a cross-cutting seat (the always-on agents) citing a stack skill is the same defect as citing
// an evidence-gated one, and it is the shape that actually bit: `angular-security` named by an
// agent installed in every project, .NET-only ones included.
// `layer` picks which roster the candidates come from: 'skills' (check 26) or 'agents' (check 36).
function absentFor(closures, kind, name, candidates, layer)
{
    const host = hostStacks(closures, kind, name);

    return new Set([...candidates].filter(c => [...host].some(t => !closures[t][layer].has(c))));
}

function absentSkillsFor(closures, kind, name, skillDirs)
{
    return absentFor(closures, kind, name, skillDirs, 'skills');
}

// 36. The same rule, for SEAT names. An agent name is cited exactly like a skill name and breaks the
// same way: project-architecture-quality-loop (ALWAYS) routes a red to four per-stack resolvers, so
// every install is missing at least two of them, and the optional-cite machinery scanned skill names
// only. A name inside the citer's own stack closure passes; anything else is described, not named.
function absentAgentsFor(closures, kind, name, agentNames)
{
    return absentFor(closures, kind, name, agentNames, 'agents');
}

// 27. No artifact may put a skill into a project's install by NAMING it. The `suggests:`
// frontmatter did exactly that: the guided walk offered `dotnet-aspire` on a devops project with
// no Aspire in it, `dotnet-authentication` on a browser extension, `angular-security` on a
// WinForms install. The mechanism is removed - a need is proven, never suggested. What a project
// actually uses comes from meta/evidence.json matched against ITS OWN manifests; what a stack
// always needs is a meta/recommendations.json seed. What a seat loads at RUNTIME stays a body
// matter, by description (checks 25 and 26), and reaches no install decision.
// Characters a reader cannot see: zero-width and joiner marks, bidi overrides and isolates (the
// Trojan Source class, CVE-2021-42574), word joiners, a byte-order mark past byte 0, and the Unicode
// tag block (U+E0000-E007F), which carries invisible text a model reads and a reviewer does not.
// Written as escapes here so this file passes its own sweep. A BOM at byte 0 of a .ps1 is kept:
// Windows PowerShell 5.1 reads a BOM-less script as the ANSI code page.
const HIDDEN_CHAR_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\uDB40[\uDC00-\uDC7F]/g;
function hiddenChars(text, file)
{
    const out = [];
    String(text).split('\n').forEach((l, i) =>
    {
        for (const m of l.matchAll(HIDDEN_CHAR_RE))
        {
            if (i === 0 && m.index === 0 && m[0] === '\uFEFF' && /\.ps1$/i.test(file)) continue;
            out.push({ line: i + 1, hex: m[0].codePointAt(0).toString(16).toUpperCase() });
        }
    });
    return out;
}

// 55. Our own workflows are checked the way a PR reviewer would not bother to: an event field
// spliced into a `run` script is shell the PR author writes (a title of `"; curl ... | sh #` runs);
// a third-party action on a tag runs whatever that tag points at tomorrow; `pull_request_target`
// checking out the PR head hands a fork's code the base repo's secrets. GitHub-owned actions
// (`actions/`, `github/`) and local ones (`./`) may float; everything else pins a 40-hex commit.
const WORKFLOW_EVENT_SPLICE = /\$\{\{\s*github\.(event\.|head_ref)[^}]*\}\}/;
function lintWorkflows(files)
{
    const out = [];
    for (const { file, text } of files)
    {
        let doc;
        try { doc = yaml.load(text); }
        catch (err) { out.push(`workflow ${file}: not parseable YAML - ${String(err.message).split('\n')[0]}`); continue; }
        if (!doc || typeof doc !== 'object') continue;
        const on = doc.on === undefined ? doc.true : doc.on;
        const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on || {});
        const prTarget = triggers.includes('pull_request_target');
        for (const [jobName, job] of Object.entries(doc.jobs || {}))
        {
            const steps = (job && Array.isArray(job.steps)) ? job.steps : [];
            steps.forEach((step, i) =>
            {
                if (!step || typeof step !== 'object') return;
                const where = `workflow ${file}: job ${jobName} step ${i + 1}`;
                if (typeof step.run === 'string')
                {
                    const m = WORKFLOW_EVENT_SPLICE.exec(step.run);
                    if (m) out.push(`${where}: \`${m[0]}\` is spliced into run - pass it through env: and read "$VAR"`);
                }
                if (typeof step.uses === 'string')
                {
                    const u = step.uses.trim();
                    const owned = /^(actions|github)\//.test(u) || u.startsWith('./');
                    const pinned = /@[0-9a-f]{40}$/.test(u) || /^docker:\/\/.+@sha256:[0-9a-f]{64}$/.test(u);
                    if (!owned && !pinned) out.push(`${where}: \`${u}\` floats on a tag - pin the 40-hex commit, the tag as a trailing comment`);
                }
                const ref = step.with && typeof step.with.ref === 'string' ? step.with.ref : '';
                if (prTarget && /github\.(event\.pull_request\.head|head_ref)/.test(ref))
                    out.push(`${where}: pull_request_target checks out the PR head (\`${ref}\`) - fork code with the base repo's secrets`);
            });
        }
    }
    return out;
}
function workflowFiles()
{
    const dir = path.join(ROOT, '.github', 'workflows');
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort(); } catch { return []; }
    return names.map((n) => ({ file: `.github/workflows/${n}`, text: fs.readFileSync(path.join(dir, n), 'utf8') }));
}

function lintSuggestionEdges(label, text)
{
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
    if (!fm || !/^suggests:/m.test(fm[1])) return [];

    return [`${label} declares \`suggests:\` in its frontmatter - that mechanism is removed, because an `
        + `artifact naming a skill must never put it into a project's install (measured: dotnet-aspire offered `
        + `to a project with no Aspire). Prove the need with a meta/evidence.json signal against the project's `
        + `own manifests, or seed it per stack in meta/recommendations.json`];
}

// A backticked cite of an OPTIONAL skill inside a load directive must carry an
// availability guard, or the model calls Skill(<name>) in a project that never
// installed it and gets 'Unknown skill: <name>' (measured 2026-09-04 in a
// consuming project: project-architecture-analyzer told the session to load
// `dotnet-architecture-tests`, which meta/evidence.json installs only when
// NetArchTest/ArchUnitNET is in the manifests). A cite that merely POINTS at a
// skill ('boundary enforcement lives in `x`') is not a directive and is not
// flagged - only an instruction to load it.
//
// Two directive shapes are scanned:
//   A. prose - a load verb in the SAME SENTENCE before the token ('load `x` when
//      judging fit'); scoping to the sentence keeps an earlier 'Load when ...'
//      about the file itself from flagging a later pointer on the same line
//   B. a router-table row - the token sits in the last cell of a row under a
//      '| ... | Load |' header (or '| Also load |' - any header cell whose last WORD is
//      'load'; 'Payload' is not one), which is the house routing shape
//
// The remedy is NOT a guard phrase next to the name. A skill is selected by matching
// what it says it covers against the installed inventory, so a directive that must
// survive a trimmed install DESCRIBES the capability ('the skill covering Angular
// hardening') instead of naming it: the name only works where the skill exists, while
// the description also tells a seat without it what to do. Naming stays correct for a
// skill guaranteed alongside the citing artifact - a frontmatter preload, an own-stack
// skill - which is why the check is scoped to the ones that can be absent.
//
// One escape: a file opening with an explicit '**Availability**' callout blankets its
// cites. That is for the ROUTER HUBS, whose whole content is a name -> area table and
// which are stack-scoped anyway.
// `re-enter` / `re-invoke` are the flow twins' spelling ('re-enter `x`' measured unflagged in three
// always-on skills). `run` / `runs` / `see` were tried and rejected: 'Run migrations (mechanics in
// `x`)' and 'see `x`' are pointers, and the trial flagged 11 of them for zero directives.
const LOAD_VERB = /\b(?:load|loads|invoke|invokes|reach for|pull in|add|consult|open|re-enter|re-invoke)\b/i;
// 35. A load verb is not the only shape a directive takes. Five more route the reader BY NAME with
// no verb at all, and the 2026-09-12 audits measured them walking straight past this scan: a
// `Companions:` list in a description (dotnet-architecture-tests:3, postgres:3), a `Points at ...`
// routing line (devops:3, ionic-security:3), a `routes to` / `routes through` sentence
// (project-architecture-quality-loop:34, four resolver seats named in an ALWAYS skill), a
// `hands off to` / `dispatches` hand-over, and a `that mechanism is x` pointer. Each one tells the
// reader which artifact owns the next step, which is a directive whatever the verb - and each one
// names something most installs do not have. `routes to` is included beside the brief's
// `routes through` because the measured miss uses it.
const DIRECTIVE_SHAPE = /(?:\bcompanions?(?:\s+skills?)?\s*:|\bpoints?\s+at\b|\broutes?\s+(?:to|through)\b|\bthat\s+mechanism\s+is\b|\bhands?\s+off\s+to\b|\bdispatch(?:es|ed|ing)?\b)/i;
// 35b. The verb can also come AFTER the name, and the scan above only ever read the text BEFORE
// it - so two live directives walked straight past: 'belongs to `x` ... load both alongside this'
// and 'is owned by `x`; reach for it'. Both name a skill the citing install can lack. The trailing
// form is deliberately NARROW - the verb must be followed by a back-reference (both / it / them /
// the pair) rather than a fresh object - because a plain trailing verb turns every pointer into a
// directive ('mechanics live in `x`. Load the migration tool' is two different artifacts), and the
// pointer-versus-directive line is the whole thing this scan protects.
const TRAILING_DIRECTIVE = /\b(?:load|loads|invoke|invokes|reach for|pull in|consult|re-enter|re-invoke)\s+(?:both|it|them|that one|those|the (?:one|pair|two)\b)/i;
const AVAILABILITY_GUARD = /\b(?:in (?:your|the) skill list|not installed|never installed|is absent|are absent|installed only (?:where|when|if)|(?:when|where|if) installed)\b/i;
// A blanket guard covers every cite in its file, and it must be DELIBERATE: an explicit
// '**Availability**' callout carrying a guard phrase. The earlier form also accepted any
// line pairing a guard phrase with a common word ('every', 'rows', 'below'), which silenced
// 13 of 263 files by accident - project-architecture-analyzer/SKILL.md among them, the very
// file whose unguarded cite produced the measured 'Unknown skill' error. Proven by mutation:
// a fresh unguarded load directive added to a blanketed file was not flagged.
const AVAILABILITY_BLANKET = /\*\*Availability\b/;

// 38. The blanket covers the callout's OWN SECTION, never the whole file. The router hubs put the
// callout at the top of the routing table it speaks for, and a whole-file blanket then silenced
// every other cite in the file - project-build-from-scratch's line-22 setup-skill names sit ten
// lines above a callout that speaks only for the per-stack scaffolding table, and
// dotnet-web-backend's runs from `## Deep specialists` at the bottom yet covered all 147 lines
// above it. Coverage runs from the callout to the next heading of the SAME or a HIGHER level than
// the heading the callout sits under: a hub whose callout sits under the file's `# title` still
// blankets the whole file, which is what keeps `dotnet` / `frontend` green.
function availabilityCoverage(lines)
{
    const covered = new Array(lines.length).fill(false);
    const levelOf = (l) => (/^(#{1,6})\s/.exec(l) || [, ''])[1].length;
    for (let i = 0; i < lines.length; i++)
    {
        if (!AVAILABILITY_BLANKET.test(lines[i]) || !AVAILABILITY_GUARD.test(lines[i])) continue;
        let level = 1;
        for (let j = i; j >= 0; j--)
        {
            const l = levelOf(lines[j]);
            if (l) { level = l; break; }
        }

        for (let k = i; k < lines.length; k++)
        {
            if (k > i && levelOf(lines[k]) && levelOf(lines[k]) <= level) break;
            covered[k] = true;
        }
    }

    return covered;
}

// A markdown row's cells, in order and WITHOUT dropping empty ones - the column index is what a
// header cell's meaning attaches to, so a blank cell may not shift its neighbours left.
function tableCells(line)
{
    const t = line.trim();
    if (!t.startsWith('|')) return null;
    const parts = t.split('|');
    parts.shift();
    if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();

    return parts.map(c => c.trim());
}

// The names a citer is GUARANTEED to have beside it whatever the install: its own frontmatter
// `skills:` preload. Naming those is sanctioned by the house rule, so they never carry a finding.
function frontmatterPreloads(text)
{
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
    const out = new Set();
    if (!fm) return out;
    try
    {
        const meta = yaml.load(fm[1]);
        if (meta && Array.isArray(meta.skills)) for (const s of meta.skills) out.add(String(s).split(':').pop());
    }
    catch
    {
        // broken frontmatter is check 18's finding, not this one's
    }

    return out;
}

// Which lines of the frontmatter block NO cite check may scan: every key except `description:` and
// its continuation. The other keys ARE the artifact's own registration - `name:`, and above all the
// `skills:` preload list, which is the house's sanctioned GUARANTEE shape: the skill is injected
// whole at seat start, so a name there is a declaration that it is present, the opposite of an
// unguarded cite. Two seats were permanently red on a YAML list item that cannot carry a content
// clause and has nothing to teach, since the seat already holds the skill. The `description` stays
// in scope: it is shipped prose a router reads, and it is where the measured `Companions:` and
// `Points at` cites live.
function frontmatterSkipLines(lines)
{
    const skip = new Set();
    if (lines[0] !== '---') return skip;
    let inDesc = false;
    for (let i = 1; i < lines.length; i++)
    {
        if (lines[i] === '---') break;
        if (/^description\s*:/.test(lines[i])) { inDesc = true; continue; }
        if (/^[A-Za-z][\w-]*\s*:/.test(lines[i])) inDesc = false;
        if (!inDesc) skip.add(i);
    }

    return skip;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// A cite is matched backticked OR bare: every measured miss in the descriptions is bare
// (`Companions: dotnet-testing (the test-suite host)`), and a description is where a name costs the
// most - it is read by a model choosing between installed skills. A path or a longer identifier is
// excluded by the boundaries (`stack/skills/dotnet-migrate/SKILL.md`, `mcp__plugin_serena_serena__find_symbol`).
// A BARE match is taken only for a HYPHENATED name, though: single-word rosters entries (`mobile`,
// `dotnet`, `npm`, `frontend`) are ordinary English, and the trial flagged 14 sentences that merely
// used the word - 'the mobile stack', 'npm audit'. Those still count backticked, which is how the
// house writes a real cite.
function citeMatcher(names)
{
    if (names.length === 0) return null;
    const alts = [...names].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

    return new RegExp(`(?<![A-Za-z0-9_./-])(${alts})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9]|/)`, 'g');
}

function lintOptionalCites(file, text, optional, opts = {})
{
    const findings = [];
    const agents = opts.agents || new Set();
    const lines = text.split(/\r?\n/);
    const covered = availabilityCoverage(lines);
    const skipFm = frontmatterSkipLines(lines);
    const guaranteed = frontmatterPreloads(text);
    const candidates = [...optional, ...agents]
        .filter(n => n !== opts.self && !guaranteed.has(n));
    const matcher = citeMatcher(candidates);
    if (!matcher) return findings;

    let loadCols = new Set();   // column indices whose header cell ends in 'load' or 'route'
    for (let i = 0; i < lines.length; i++)
    {
        if (covered[i] || skipFm.has(i)) continue;
        const line = lines[i];
        const cells = tableCells(line);
        if (!cells)
        {
            loadCols = new Set();
        }
        else if (!/^[\s:|-]+$/.test(line.trim()))
        {
            const cols = new Set();
            cells.forEach((c, idx) => { if (/(?:^|\s)(?:load|route|routes)$/i.test(c)) cols.add(idx); });
            if (cols.size > 0) loadCols = cols;
        }

        for (const m of line.matchAll(matcher))
        {
            const name = m[1];
            const backticked = line[m.index - 1] === '`' && line[m.index + name.length] === '`';
            if (!backticked && !name.includes('-')) continue;
            const isAgent = agents.has(name) && !optional.has(name);
            const cellRe = new RegExp(`(?<![A-Za-z0-9_./-])${escapeRe(name)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9]|/)`);
            const inLoadCell = cells !== null && [...loadCols].some(idx => cellRe.test(cells[idx] || ''));
            const before = line.slice(0, m.index);
            const sentence = before.slice(before.lastIndexOf('. ') + 1);
            const rest = line.slice(m.index + name.length);
            const restOfSentence = rest.split(/\.\s/)[0];
            if (!inLoadCell && !LOAD_VERB.test(sentence) && !DIRECTIVE_SHAPE.test(sentence)
                && !TRAILING_DIRECTIVE.test(restOfSentence)) continue;

            const what = isAgent ? 'seat' : 'skill';
            const where = opts.absentIn
                ? `and it is absent in ${opts.absentIn(name, isAgent ? 'agents' : 'skills').join(', ')}, where this ${opts.citerKind || 'artifact'} is still installed`
                : `and that ${what} can be absent here (evidence-gated or opt-in)`;
            findings.push(`${file}:${i + 1} directs a load of \`${name}\` BY NAME, ${where}. `
                + `Describe what the ${what} covers instead, so it is matched from the installed inventory `
                + `and a project without it still knows what to do - or open the section with an `
                + `'**Availability**' callout if it is a router hub`);
        }
    }

    return findings;
}

// 37. A plugin-qualified name (`superpowers:verification-before-completion`) is a cite of a skill
// the stack does not own and cannot guarantee: the plugin is per-install on Claude Code and
// documented OPTIONAL on the cursor-stack twin. Naming it BARE teaches a seat without the plugin
// nothing at all - the 2026-09-12 agent audits found 10 verifiers plus security-auditor resting the
// whole done gate on a bare `superpowers:verification-before-completion`, and 4 resolvers resting
// their whole method on a bare `superpowers:systematic-debugging`. The house form pairs the name
// with what it CONTAINS in the same sentence, as baseline-quality-gates.md did until R72: 'satisfy
// `superpowers:verification-before-completion` - build + relevant tests run, output quoted'. A
// content clause is a dash, colon or parenthetical clause opening straight after the token, or a
// dash clause closing straight before it. The namespaces come from the installers' own PLUGINS
// block, so a plugin added there is covered without touching this check.
//
// The BARE plugin name is the same class one level up, and the 2026-09-12 plugins audit found four
// of them uncovered: a body naming `csharp-lsp` or `claude-md-management` on its own is naming a
// per-install, droppable plugin, so a seat on an install that dropped it reads a name and nothing
// else. Only the BACKTICKED spelling is judged - that is the token stack-graph.js reads to emit the
// dependency edge, so backticking a cite is what puts it in the graph, while the unbackticked word
// is prose ('superpowers' is an English word before it is a plugin). Same content-clause test.
function lintPluginCites(file, text, pluginNames)
{
    const findings = [];
    if (!pluginNames || pluginNames.size === 0) return findings;
    const alts = [...pluginNames].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const token = new RegExp(`(?<![A-Za-z0-9_./-])(${alts}):([a-z][a-z0-9-]*)(?![A-Za-z0-9_-]|\\.[A-Za-z0-9]|/)`, 'g');
    const bare = new RegExp('`(' + alts + ')`', 'g');
    const lines = text.split(/\r?\n/);
    const skipFm = frontmatterSkipLines(lines);
    for (let i = 0; i < lines.length; i++)
    {
        if (skipFm.has(i)) continue;   // a `skills:` preload is the guarantee, not a cite
        for (const m of lines[i].matchAll(token))
        {
            const after = lines[i].slice(m.index + m[0].length).replace(/^`/, '');
            const before = lines[i].slice(0, m.index).replace(/`$/, '');
            const sentenceBefore = before.slice(before.lastIndexOf('. ') + 1);
            const clauseAfter = /^\s*[-:(]\s*\S[^\n]{11,}/.test(after);
            const clauseBefore = /\s-\s[^-]{12,}$/.test(sentenceBefore);
            if (clauseAfter || clauseBefore) continue;
            findings.push(`${file}:${i + 1} cites \`${m[1]}:${m[2]}\` BARE - the plugin is per-install, so a seat `
                + `without it reads a name and nothing else. Pair the name with what it contains in the same sentence `
                + `(the shape baseline-quality-gates.md uses: the name, then ' - ' and the one clause that says what `
                + `the method demands), so the rule still stands where the plugin is absent`);
        }

        for (const m of lines[i].matchAll(bare))
        {
            const after = lines[i].slice(m.index + m[0].length);
            const sentenceBefore = lines[i].slice(0, m.index).slice(lines[i].slice(0, m.index).lastIndexOf('. ') + 1);
            if (/^\s*[-:(]\s*\S[^\n]{11,}/.test(after) || /\s-\s[^-]{12,}$/.test(sentenceBefore)) continue;
            findings.push(`${file}:${i + 1} names the plugin \`${m[1]}\` BARE - it is per-install and droppable, `
                + `so a seat on an install without it reads a name and nothing else. Say what it GIVES in the same `
                + `sentence (the name, then ' - ' and the one clause that says what it provides), so the guidance `
                + `still stands where the plugin is absent`);
        }
    }

    return findings;
}

// Extract the stack HTML's view of the inventory: house skill names,
// third-party repo skill names, plugin names (from plugin-URL skill rows and
// "/plugin install X@" install cells), and MCP server names.
// An agent body claiming a skill is preloaded must have that skill in the
// frontmatter skills: block. The measured regression: a body claimed four
// preloads, the frontmatter carried one, and 56 of 58 production dispatches
// built without conventions loaded. Two claim shapes are checked; 'Load X on
// demand' text AFTER the claim keyword on the same line is deliberately not
// scanned - it is the opposite of a preload claim:
//   A. '`x`, `y` are preloaded ...' - the skills named BEFORE the keyword
//   B. 'the preloaded `x` skill/hub/recipe' - the skill right after it
// A skill body may point at a SIBLING skill's reference file as a locating pointer ('`csharp` (its
// `references/concurrency.md`)'). Nothing loads it, so a sibling rename dangles the pointer silently
// - the reader is sent to a file that no longer exists and nothing in the repo notices. Every
// `references/<file>.md` a skill names must resolve: in its own folder, in the sibling skill named
// beside it (a backticked skill name within the preceding ~160 chars), or - for a pointer that
// describes the owner by capability instead of naming it - in SOME skill folder.
function lintReferencePointers(skillsDir, skillDirs, fsLike = fs)
{
    const findings = [];
    const dirSet = new Set(skillDirs);
    const has = (d, rel) => fsLike.existsSync(path.join(skillsDir, d, rel));
    for (const d of skillDirs)
    {
        const files = [path.join(skillsDir, d, 'SKILL.md')];
        const refDir = path.join(skillsDir, d, 'references');
        if (fsLike.existsSync(refDir)) for (const r of fsLike.readdirSync(refDir)) if (r.endsWith('.md')) files.push(path.join(refDir, r));
        for (const file of files)
        {
            if (!fsLike.existsSync(file)) continue;
            const text = fsLike.readFileSync(file, 'utf8');
            const re = /`(references\/[A-Za-z0-9._\/-]+\.md)`/g;
            let m;
            while ((m = re.exec(text)) !== null)
            {
                const rel = m[1];
                if (has(d, rel)) continue;
                const ctx = text.slice(Math.max(0, m.index - 160), m.index);
                const named = [...ctx.matchAll(/`([a-z0-9-]+)`/g)].map(x => x[1]).filter(n => dirSet.has(n) && n !== d);
                const label = path.relative(skillsDir, file);
                if (named.length > 0)
                {
                    if (!named.some(n => has(n, rel)))
                        findings.push(`${label}: points at \`${rel}\` beside \`${named.join('`/`')}\` and none of them has that file - a sibling rename dangled the pointer; fix the path or the name`);
                }
                else if (![...dirSet].some(n => has(n, rel)))
                {
                    findings.push(`${label}: points at \`${rel}\` which no skill folder holds - the file was renamed or removed under the pointer`);
                }
            }
        }
    }
    return findings;
}

function lintPreloadClaims(agentFile, text, skillDirs)
{
    const findings = [];
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let declared = [];
    try
    {
        const meta = fm ? yaml.load(fm[1]) : null;
        if (meta && Array.isArray(meta.skills))
        {
            // frontmatter entries may be plugin-namespaced ('superpowers:x')
            declared = meta.skills.map(s => String(s).split(':').pop());
        }
    }
    catch
    {
        // broken agent frontmatter is check 18's finding, not this one's
    }

    const claimed = (token) =>
    {
        if (skillDirs.has(token) && !declared.includes(token))
        {
            findings.push(`agents/${agentFile} claims \`${token}\` is preloaded but the frontmatter skills: block does not list it`);
        }
    };

    for (const bodyLine of text.split('\n'))
    {
        const keyword = bodyLine.match(/\b(?:are|is)\s+preloaded\b/i);
        if (keyword)
        {
            // scope to the claim's own sentence - an earlier sentence on the same
            // line ('Load the domain router (`dotnet`, ...) ...') is not a claim
            const before = bodyLine.slice(0, keyword.index);
            const claimSeg = before.slice(before.lastIndexOf('. ') + 1);
            for (const m of claimSeg.matchAll(/`([a-z][a-z0-9-]*)`/g))
            {
                claimed(m[1]);
            }
        }

        for (const m of bodyLine.matchAll(/\bpreloaded\s+`([a-z][a-z0-9-]*)`/gi))
        {
            claimed(m[1]);
        }
    }

    return findings;
}

// 40. Every name in an agent's `tools:` allowlist must be a tool that exists. A dead entry is a
// SILENT no-op - the seat launches, the grant does nothing, and only a list where NOTHING resolves
// fails loudly - so a rename upstream or a typo here rots with no signal (the 2026-09-12 agents
// audit left `LSP` as an open verification item for exactly this reason: nothing in the repo could
// answer it). Verified against the Claude Code tools reference,
// https://code.claude.com/docs/en/tools-reference (fetched 2026-09-12): 'The tool names are the
// exact strings you use in permission rules'. `LSP` is in that table and is real. MCP grants are the
// documented `mcp__<server>`, `mcp__<server>__<tool>` and `mcp__<server>__*` shapes
// (https://code.claude.com/docs/en/sub-agents). Legacy spellings the reference no longer lists
// (`Task`, `MultiEdit`, `BashOutput`, `KillShell`, `SlashCommand`) are findings, not aliases.
const TOOL_NAMES = new Set([
    'Agent', 'Artifact', 'AskUserQuestion', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'Edit',
    'EndConversation', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree', 'Glob',
    'Grep', 'ListAgents', 'ListMcpResourcesTool', 'LSP', 'Monitor', 'NotebookEdit', 'PowerShell',
    'PushNotification', 'Read', 'ReadMcpResourceTool', 'RemoteTrigger', 'ReportFindings',
    'ScheduleWakeup', 'SendFeedback', 'SendMessage', 'SendUserFile', 'ShareOnboardingGuide', 'Skill',
    'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TaskUpdate', 'TodoWrite',
    'ToolSearch', 'WaitForMcpServers', 'WebFetch', 'WebSearch', 'Workflow', 'Write',
]);
const MCP_GRANT = /^mcp__[a-z0-9][a-z0-9_-]*(?:__(?:\*|[A-Za-z0-9_-]+))?$/;

function lintAgentTools(label, text)
{
    const line = /^tools:\s*(.+)$/m.exec(text || '');
    if (!line) return [];

    return line[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
        .filter(t => !TOOL_NAMES.has(t) && !MCP_GRANT.test(t))
        .map(t => `${label} grants tool '${t}', which is not a Claude Code tool name or an `
            + `mcp__<server>[__<tool>] grant - a dead entry grants nothing and fails silently; fix the `
            + `spelling or drop it (tool names: https://code.claude.com/docs/en/tools-reference)`);
}

// 43. Every agent's `tools:` allowlist must grant the shared memory MCP's store, search and list
// tools. The memory MCP is the required shared memory (CLAUDE.md's MCP catalog): a seat that can
// search but not save, or save but not search, defeats the point - the spec gives every seat both,
// read-only support seats included (the rule that scopes what gets SAVED to lessons lives beside
// the grant, not instead of it). An agent with no `tools:` line inherits every tool, memory
// included, so it has nothing to fix.
const MEMORY_TOOLS = ['mcp__plugin_memory_memory__memory_store', 'mcp__plugin_memory_memory__memory_search', 'mcp__plugin_memory_memory__memory_list'];

function lintAgentMemoryTools(label, text)
{
    const line = /^tools:\s*(.+)$/m.exec(text || '');
    if (!line) return [];

    const tools = line[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    const missing = MEMORY_TOOLS.filter(t => !tools.includes(t));
    if (missing.length === 0) return [];

    return [`${label} tools: allowlist is missing ${missing.join(', ')} - every seat must be able to `
        + `search and save the shared memory`];
}

// 41. A reference over 100 lines opens with a table of contents, inside the first 15 lines. Without
// one a seat has to read the whole file to find out whether the answer is in it, which is the exact
// cost a reference exists to avoid - and the 2026-09-12 audits counted 21 such files across the
// collection, the largest at 288 lines. A heading or bold line saying Contents / TOC / Table of
// contents counts, and so does a bare anchor list (two or more `[...](#...)` links).
function lintReferenceContents(skillsDir, skillDirs, fsLike = fs)
{
    const findings = [];
    for (const d of skillDirs)
    {
        const refDir = path.join(skillsDir, d, 'references');
        if (!fsLike.existsSync(refDir)) continue;
        for (const r of fsLike.readdirSync(refDir).filter(f => f.endsWith('.md')))
        {
            const lines = fsLike.readFileSync(path.join(refDir, r), 'utf8').split('\n');
            if (lines.length <= 100) continue;
            const head = lines.slice(0, 15);
            const named = head.some(l => /^(?:#{1,6}\s|\s*\*\*).*\b(?:contents|toc|table of contents)\b/i.test(l));
            const anchors = head.filter(l => /\[[^\]]+\]\(#[^)]+\)/.test(l)).length;
            if (named || anchors >= 2) continue;
            findings.push(`${d}/references/${r}: ${lines.length} lines with no table of contents in its first 15 - `
                + `open it with a Contents list of its own section anchors, so a seat can see what is in the file `
                + `without reading all of it`);
        }
    }

    return findings;
}

// 42. A plugin manifest that ENUMERATES a component directory owns two lists that must say the same
// thing. Claude Code loads exactly what the array names, so a file added to `commands/` and not to
// the array ships DEAD - it is in the package, downloaded by every install, and invisible to the
// user - while an array row whose file is gone fails the plugin's load. Neither is visible from
// either list alone, and the package has no test that would notice. A field the manifest leaves out
// is the default directory scan and has nothing to reconcile, so it is skipped rather than flagged.
function lintPluginComponents(manifest, listings)
{
    const findings = [];
    const norm = (v) => String(v).replace(/^\.\//, '').replace(/\\/g, '/');
    for (const [field, actual] of Object.entries(listings))
    {
        if (!Array.isArray(manifest[field])) continue;
        const declared = new Set(manifest[field].map(norm));
        const onDisk = new Set(actual.map(f => `${field}/${f}`));
        for (const d of [...declared].sort())
        {
            if (!onDisk.has(d)) findings.push(`setup-plugin/.claude-plugin/plugin.json \`${field}\` names '${d}', which is not on disk - the plugin fails to load`);
        }

        for (const a of [...onDisk].sort())
        {
            if (!declared.has(a)) findings.push(`setup-plugin/${a} is not in plugin.json's \`${field}\` array - an enumerated field is the WHOLE list, so this file ships dead in every install`);
        }
    }

    return findings;
}

function parseStackHtml()
{
    const html = fs.readFileSync(STACK_HTML, 'utf8');
    const house = new Set([...html.split('const house = {')[1].split('};')[0]
        .matchAll(/\["([a-z0-9-]+)","/g)].map(m => m[1]));
    const houseManual = new Set([...html.split('const house = {')[1].split('};')[0]
        .matchAll(/\["([a-z0-9-]+)",[^\n]*"manual"\]/g)].map(m => m[1]));

    const repoBlock = html.split('const repository = [')[1].split('\n];')[0];
    const repoSkills = new Set();
    const plugins = new Set();
    for (const m of repoBlock.matchAll(/\["([a-zA-Z0-9:_-]+)","[^"]*","([^"]+)"/g))
    {
        if (PLUGIN_MARKETPLACE_URLS.has(m[2]))
        {
            plugins.add(m[1].split(':')[0]);
        }
        else
        {
            repoSkills.add(m[1]);
        }
    }

    const otherBlock = html.split('const otherTools = [')[1].split('\n];')[0];
    const mcps = new Set();
    for (const m of otherBlock.matchAll(/\["([a-z0-9-]+)", "([^"]+)", "[^"]*", "([^"]*)"/g))
    {
        if (m[2].startsWith('MCP server'))
        {
            mcps.add(m[1]);
        }

        const install = m[3].match(/\/plugin install ([a-z0-9-]+)@/);
        if (install)
        {
            plugins.add(install[1]);
        }
    }

    const hooksBlock = (html.split('const hooks = [')[1] ?? '').split('\n];')[0];
    const hooks = new Set([...hooksBlock.matchAll(/\["([a-z0-9-]+)"/g)].map(m => m[1]));

    return { house, houseManual, repoSkills, plugins, mcps, hooks };
}

// Every manifest in `manifests` ({label -> Set}) must hold the same entries as
// the reference (the first). Flags both-direction diffs against the reference,
// which transitively proves all four agree.
function assertSameSet(what, manifests)
{
    const labels = Object.keys(manifests);
    const [refLabel, refSet] = [labels[0], manifests[labels[0]]];
    for (const label of labels.slice(1))
    {
        const set = manifests[label];
        for (const name of refSet)
        {
            if (!set.has(name))
            {
                flag(`${what} '${name}' is in ${refLabel} but not ${label}`);
            }
        }

        for (const name of set)
        {
            if (!refSet.has(name))
            {
                flag(`${what} '${name}' is in ${label} but not ${refLabel}`);
            }
        }
    }
}

function main()
{
    const dirs = localSkillDirs();

    // SKILLS are cross-repo shared with the cursor-stack twins too (a separate repo, its own
    // parity held by discipline). The one Node-side source is meta/stack-manifest.json.
    const raw = readStackManifest();
    const primary = manifestSkillMap(raw.skills);   // canonical SKILLS view
    // The manifest's SKILLS rows name this repo's own skills by its GitHub slug.
    const HOUSE_REPO = require('./install/brand.js').BRAND.slug;

    // 1. Every skill dir has a SKILL.md whose YAML frontmatter loads cleanly,
    //    names the skill after its directory, and carries a non-empty description.
    //    Also collects the manual-only set (disable-model-invocation) for check 19.
    const manualSkills = new Set();
    for (const dir of dirs)
    {
        const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
        if (!fs.existsSync(skillFile))
        {
            flag(`skills/${dir}/ has no SKILL.md`);
            continue;
        }

        const fm = fs.readFileSync(skillFile, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm)
        {
            flag(`skills/${dir}/SKILL.md has no YAML frontmatter block`);
            continue;
        }

        let meta;
        try
        {
            meta = yaml.load(fm[1]);
        }
        catch (err)
        {
            flag(`skills/${dir}/SKILL.md frontmatter is not valid YAML: ${err.reason || err.message}`);
            continue;
        }

        if (meta === null || typeof meta !== 'object' || Array.isArray(meta))
        {
            flag(`skills/${dir}/SKILL.md frontmatter did not parse to a mapping`);
            continue;
        }

        if (meta.name !== dir)
        {
            flag(`skills/${dir}/SKILL.md frontmatter name is '${meta.name}', expected '${dir}'`);
        }

        if (typeof meta.description !== 'string' || meta.description.trim() === '')
        {
            flag(`skills/${dir}/SKILL.md frontmatter has no non-empty 'description'`);
        }

        if (meta['disable-model-invocation'] === true)
        {
            manualSkills.add(dir);
        }
    }

    // 2. Every local skill is registered (uncommented) in the manifests. (The README no
    //    longer carries a skills list - the HTML inventory is the browsable catalog and
    //    its own checks below keep it in sync; the README keeps only the headline counts.)
    for (const dir of dirs)
    {
        if (!primary.active.has(dir))
        {
            flag(`skills/${dir} is not registered in the installer SKILLS block`);
        }
    }

    // 3. Every active envoydev manifest entry has a local directory.
    for (const [skill, repo] of primary.active)
    {
        if (repo === HOUSE_REPO && !dirs.includes(skill))
        {
            flag(`SKILLS registers ${HOUSE_REPO}|${skill} but skills/${skill}/ does not exist`);
        }
    }

    // 4/4b/5 retired: those checked the two frozen twins agreed with each other (same active set,
    // same order) and that the ps1 twin's own inventory comment matched its count. Phase 7b (R33)
    // deleted both twins - meta/stack-manifest.json is the only copy of the SKILLS list left, so
    // there is nothing left to diverge from.

    // 6. Every backticked hyphenated token in skill files resolves to a known
    //    skill (any manifest entry, active or commented, or a local dir) or the
    //    explicit non-skill allowlist. The regex now also accepts a leading
    //    uppercase letter and PascalCase/UPPER segments, so a real skill like
    //    `OpenTelemetry-NET-Instrumentation` is validated instead of skipped.
    //    Capitalized tokens unrelated to any skill (HTTP headers like
    //    `Content-Type`, ticket IDs like `PROJ7-4521`) are left alone; a
    //    capitalized token is only flagged when it case-insensitively COLLIDES
    //    with a known skill but the exact casing is wrong (a real reference typo).
    const known = new Set(dirs);
    for (const k of primary.active.keys()) known.add(k);
    for (const k of primary.commented.keys()) known.add(k);
    const knownLower = new Map([...known].map(k => [k.toLowerCase(), k]));
    const matchedNonSkill = new Set();   // for check 11 (dead-allowlist reverse check)
    for (const dir of dirs)
    {
        const files = [path.join(SKILLS_DIR, dir, 'SKILL.md')];
        const refsDir = path.join(SKILLS_DIR, dir, 'references');
        if (fs.existsSync(refsDir))
        {
            files.push(...fs.readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => path.join(refsDir, f)));
        }

        for (const file of files)
        {
            if (!fs.existsSync(file))
            {
                continue;
            }

            const text = fs.readFileSync(file, 'utf8');
            for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)`/g))
            {
                const token = m[1];
                if (NON_SKILL_TOKENS.has(token))
                {
                    matchedNonSkill.add(token);
                    continue;
                }

                if (known.has(token))
                {
                    continue;   // exact match - a real skill reference, incl. PascalCase names
                }

                // Not an exact known skill. A lowercase token that is not known
                // is a typo/rename-rot. A capitalized token is only a finding
                // when it collides case-insensitively with a real skill (a
                // casing typo); otherwise it is an unrelated identifier/header.
                const collision = knownLower.get(token.toLowerCase());
                if (token === token.toLowerCase())
                {
                    flag(`${path.relative(ROOT, file)} references \`${token}\` - not a known skill (typo? add to NON_SKILL_TOKENS if intentional)`);
                }
                else if (collision)
                {
                    flag(`${path.relative(ROOT, file)} references \`${token}\` - wrong casing for skill '${collision}'`);
                }
            }
        }
    }


    // 8-10. The agent scripts are the source of truth for EVERYTHING in use: skills, plugins, and
    // MCPs. The stack HTML must agree with meta/stack-manifest.json.
    const html = parseStackHtml();
    const pluginsManifest = manifestFlatSet(raw.plugins, (r) => r.id.split('@')[0]);
    const mcpsManifest = manifestFlatSet(raw.mcps, (r) => r.name);

    // 18. Backticked skill names in the base template + claude rules must
    //     resolve too, or a renamed skill rots silently there (the gap check 6
    //     left open). Unlike a skill file, a template/rule legitimately names
    //     plugins (`csharp-lsp`, `claude-hud`), MCPs (`playwright`,
    //     `serena`), subagents (`ng-build-error-resolver`), and the
    //     superpowers workflow skills - so resolve against the full registration
    //     surface (skills + plugins + MCPs + agent names) plus NON_SKILL_TOKENS,
    //     and only flag a token that matches NONE of them. The same case-collision
    //     rule as check 6: a capitalized token is a finding only when it
    //     case-insensitively collides with a known skill (a casing typo).
    const resolvable = new Set(known);   // all skills (dirs + every manifest selector)
    for (const s of [...pluginsManifest.active, ...pluginsManifest.commented]) resolvable.add(s);
    for (const s of [...mcpsManifest.active, ...mcpsManifest.commented]) resolvable.add(s);
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const f of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))) resolvable.add(f.replace(/\.md$/, ''));
    }

    const resolvableLower = new Map([...resolvable].map(k => [k.toLowerCase(), k]));
    const templateFiles = [CLAUDE_TEMPLATE];
    if (fs.existsSync(CLAUDE_RULES_DIR))
    {
        templateFiles.push(...fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')).map(f => path.join(CLAUDE_RULES_DIR, f)));
    }

    for (const file of templateFiles.filter(fs.existsSync))
    {
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(/`([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)`/g))
        {
            const token = m[1];
            if (NON_SKILL_TOKENS.has(token))
            {
                matchedNonSkill.add(token);
                continue;
            }

            if (resolvable.has(token))
            {
                continue;
            }

            const collision = resolvableLower.get(token.toLowerCase());
            if (token === token.toLowerCase())
            {
                flag(`${path.relative(ROOT, file)} references \`${token}\` - not a known skill/plugin/MCP/agent (typo? add to NON_SKILL_TOKENS if intentional)`);
            }
            else if (collision)
            {
                flag(`${path.relative(ROOT, file)} references \`${token}\` - wrong casing for '${collision}'`);
            }
        }
    }

    // 8. HTML skills vs manifests (house section vs dirs; repo rows vs third-party inventory).
    for (const name of html.house)
    {
        if (!dirs.includes(name))
        {
            flag(`HTML house row '${name}' has no skills/${name}/ directory`);
        }
    }

    for (const dir of dirs)
    {
        if (!html.house.has(dir))
        {
            flag(`skills/${dir} is missing from the HTML house section`);
        }
    }

    const thirdPartyActive = new Set([...primary.active.keys()].filter(s => primary.active.get(s) !== HOUSE_REPO));
    const inventory = new Set([...thirdPartyActive, ...primary.commented.keys()]);
    for (const name of thirdPartyActive)
    {
        if (!html.repoSkills.has(name))
        {
            flag(`manifest skill '${name}' is missing from the HTML repository section`);
        }
    }

    for (const name of html.repoSkills)
    {
        if (!inventory.has(name))
        {
            flag(`HTML repository row '${name}' is not in the installer manifests (active or commented)`);
        }
    }

    // 9. Plugins: every active plugin appears in the HTML (and vice versa). Twin-vs-twin parity
    //    retired with the twins (Phase 7b, R33) - one manifest, nothing left to compare it against.
    for (const name of pluginsManifest.active)
    {
        if (!html.plugins.has(name))
        {
            flag(`active plugin '${name}' is missing from the HTML inventory`);
        }
    }

    for (const name of html.plugins)
    {
        if (!pluginsManifest.active.has(name) && !pluginsManifest.commented.has(name))
        {
            flag(`HTML references plugin '${name}' which is not in the installer PLUGINS block (active or commented)`);
        }
    }

    // 10. MCPs: the HTML MCP rows equal the manifest set exactly.
    for (const name of mcpsManifest.active)
    {
        if (!html.mcps.has(name))
        {
            flag(`active MCP '${name}' is missing from the HTML inventory`);
        }
    }

    for (const name of html.mcps)
    {
        if (!mcpsManifest.active.has(name) && !mcpsManifest.commented.has(name))
        {
            flag(`HTML lists MCP '${name}' which is not in the installer MCPS block (active or commented)`);
        }
    }

    // 11. Reverse allowlist check: every NON_SKILL_TOKENS entry must actually
    //     appear as a backtick in some scanned surface - a skill file (check 6)
    //     or the base template / a claude rule (check 18), both of which
    //     record matches. A never-matched entry is dead config (e.g. a `dev-log` left
    //     behind after the trigger word stopped being backticked) - prune it.
    for (const token of NON_SKILL_TOKENS)
    {
        if (!matchedNonSkill.has(token))
        {
            flag(`NON_SKILL_TOKENS lists '${token}' but no skill file / template / rule backticks it - dead allowlist entry, remove it`);
        }
    }

    // 12. The active manifest set sizes (and the installer's HOOKS/AGENTS/RULES
    //     arrays) are the single source of truth; the headline counts in the
    //     claude README must equal them so the prose cannot silently drift.
    //     The README spells the count two ways: a table cell ('| 67 |') and an
    //     inline '(67)'. Hook / agent / rule counts come from the installer
    //     array sizes; the Rules count is validated against CLAUDE_RULES.
    const skillCount = primary.active.size;
    const pluginCount = pluginsManifest.active.size;
    const mcpCount = mcpsManifest.active.size;
    // Count unique hook FILES, not matcher entries - one hook wired on two tools
    // (guard-read-whole-file on Read + Bash) is still one hook.
    const claudeHookCount = new Set(manifestFileList(raw.hooks)).size;
    const claudeAgentCount = manifestFileList(raw.agents).length;
    const claudeRuleCount = manifestFileList(raw.rules).length;

    // 12b. Stack hooks in alfred-code.html: the 'Stack hooks' section rows and the
    //      c-hooks count must match the manifest's `hooks` list (names stripped of
    //      their .js, both directions; count tied to the array size - same rigor as
    //      the README hook count above).
    const installerHooks = new Set(manifestFileList(raw.hooks).map((f) => f.replace(/\.js$/, '')));
    for (const name of installerHooks)
    {
        if (!html.hooks.has(name))
        {
            flag(`active hook '${name}' is missing from the alfred-code.html Stack hooks section`);
        }
    }

    for (const name of html.hooks)
    {
        if (!installerHooks.has(name))
        {
            flag(`alfred-code.html Stack hooks row '${name}' is not in the installer HOOKS block`);
        }
    }

    const htmlHookCount = (fs.readFileSync(STACK_HTML, 'utf8').match(/id="c-hooks">(\d+)</) || [])[1];
    if (htmlHookCount == null)
    {
        flag('alfred-code.html: no c-hooks count element found to verify against the HOOKS array');
    }
    else if (Number(htmlHookCount) !== claudeHookCount)
    {
        flag(`alfred-code.html: c-hooks count is ${htmlHookCount} but the installer holds ${claudeHookCount} hooks`);
    }

    const readmeCount = (file, label, rowLabel) =>
    {
        const text = fs.readFileSync(file, 'utf8');
        // '| **Skills** | 67 |' (table cell) or '| **Skills** (67) |' (inline).
        const m = text.match(new RegExp(`\\*\\*${rowLabel}[^*]*\\*\\*\\s*(?:\\((\\d+)\\)|\\|\\s*(\\d+))`));
        if (!m)
        {
            flag(`${label}: no headline '${rowLabel}' count found to verify against the manifests`);
            return null;
        }

        return Number(m[1] ?? m[2]);
    };

    for (const [rowLabel, expected] of [
        ['Skills', skillCount],
        ['MCP servers', mcpCount],
        ['Plugins', pluginCount],
        ['Hooks', claudeHookCount],
        ['Agents', claudeAgentCount],
        ['Rules', claudeRuleCount],
    ])
    {
        const got = readmeCount(CLAUDE_README, 'README.md', rowLabel);
        if (got !== null && got !== expected)
        {
            flag(`README.md: headline ${rowLabel} count is ${got} but the installer holds ${expected}`);
        }
    }

    // 12b. The on-disk agents/*.md set must equal the agents the manifest carries. A drift means a
    //      committed subagent never installs, or the seed fetches an agent that no longer exists.
    const agentManifest = new Set(manifestFileList(raw.agents));
    const agentDiskSet = fs.existsSync(AGENTS_DIR)
        ? new Set(fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        : new Set();
    assertSameSet('agent file', { 'agents/': agentDiskSet, 'stack-manifest.json agents': agentManifest });

    // 12d. Same parity for the CLAUDE rules: the on-disk rules/*.md set must equal the manifest's
    //      `rules` list. A drift means a committed rule never installs, or the seed fetches a rule
    //      that no longer exists.
    const ruleManifest = new Set(manifestFileList(raw.rules));
    assertSameSet('rule file', {
        'rules/': new Set(fs.existsSync(CLAUDE_RULES_DIR) ? fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')) : []),
        'stack-manifest.json rules': ruleManifest,
    });

    // 13. The Claude subagents reference house skills by backticked name (e.g.
    //     `csharp`, `dotnet-testing`). Each backticked hyphenated token must
    //     resolve to a local skill dir or a manifest selector. Tool names
    //     (`Edit`, `Read`) and code identifiers (`fakeAsync`, `setTimeout`) are
    //     single words, not hyphenated, so they are not scanned here.
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const agentFile of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf8');
            for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g))
            {
                const token = m[1];
                if (!known.has(token) && !NON_SKILL_TOKENS.has(token))
                {
                    flag(`agents/${agentFile} references skill \`${token}\` - not a local skill dir or a manifest selector`);
                }
            }
        }
    }

    // 13b. Preload claims must match the frontmatter skills: block (see
    //      lintPreloadClaims for the measured regression this guards).
    if (fs.existsSync(AGENTS_DIR))
    {
        const skillDirSet = new Set(dirs);
        for (const agentFile of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf8');
            for (const finding of lintPreloadClaims(agentFile, text, skillDirSet))
            {
                flag(finding);
            }
        }
    }

    // 14. House dotnet-* skills are original work, not vendored copies. Guard
    //     against the CONTRADICTORY 'Vendored from <kit>' inventory label
    //     reappearing on a dotnet-* SKILL.md (or its references) or the stack
    //     HTML in a dotnet-* context. Scoped to the false 'vendored from' label
    //     only - an honest 'Adapted from' / third-party notice is NOT blocked, so
    //     a future genuinely-incorporated skill can still carry its MIT credit.
    //     (The ponytail row's vendoring note is unrelated and lives on a
    //     non-dotnet row, so scope the HTML scan to dotnet-* lines.)
    const provenance = /\bvendored from\b/i;
    for (const dir of dirs.filter(d => d.startsWith('dotnet')))
    {
        const files = [path.join(SKILLS_DIR, dir, 'SKILL.md')];
        const refsDir = path.join(SKILLS_DIR, dir, 'references');
        if (fs.existsSync(refsDir))
        {
            files.push(...fs.readdirSync(refsDir).filter(f => f.endsWith('.md')).map(f => path.join(refsDir, f)));
        }

        for (const file of files.filter(fs.existsSync))
        {
            if (provenance.test(fs.readFileSync(file, 'utf8')))
            {
                flag(`${path.relative(ROOT, file)} contains a 'Vendored from' label - house dotnet-* skills are original work, drop the provenance note`);
            }
        }
    }

    for (const line of fs.readFileSync(STACK_HTML, 'utf8').split('\n'))
    {
        if (/dotnet-/.test(line) && provenance.test(line))
        {
            flag(`alfred-code.html has a dotnet-* line with a 'Vendored from' label - house dotnet-* skills are original work`);
        }
    }

    // 15. A description over 1,000 chars FAILS the build - skills and agents alike. The house
    //     style deliberately packs routing into descriptions (Companions + version floor + negative
    //     scope), so the rich .NET/router skills legitimately run 800-1,000; but every description
    //     is loaded into every session before a single message (check 33 sums them), so past that
    //     bar the routing prose is paid for on every turn of every install. This was a warning at
    //     1,100: nine descriptions sat between 1,004 and 1,146 and it fired on none of them.
    const DESC_LIMIT = 1000;
    const descriptionFiles = [
        ...dirs.map(dir => [`skills/${dir}/SKILL.md`, path.join(SKILLS_DIR, dir, 'SKILL.md')]),
        ...fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).sort().map(f => [`agents/${f}`, path.join(AGENTS_DIR, f)]),
    ];
    for (const [label, file] of descriptionFiles)
    {
        if (!fs.existsSync(file))
        {
            continue;
        }

        const fm = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!fm)
        {
            continue;
        }

        let meta;
        try
        {
            meta = yaml.load(fm[1]);
        }
        catch
        {
            continue;   // checks 1 and 18 already flagged the YAML failure
        }

        if (meta && typeof meta.description === 'string' && meta.description.length > DESC_LIMIT)
        {
            flag(`${label} description is ${meta.description.length} chars (> ${DESC_LIMIT}) - trim it; every description is always-on context in every install`);
        }
    }

    // 16. An agent told to invoke the Skill tool must carry 'Skill' in its tools:
    //     allowlist - otherwise it deadlocks on the very convention gate the
    //     instruction exists to satisfy (the exact regression this guards against).
    if (fs.existsSync(AGENTS_DIR))
    {
        for (const agentFile of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
        {
            const text = fs.readFileSync(path.join(AGENTS_DIR, agentFile), 'utf8');
            const toolsLine = text.match(/^tools:\s*(.+)$/m);
            const tools = toolsLine ? toolsLine[1].split(',').map(t => t.trim()) : [];
            if (/invoke the Skill tool/i.test(text) && !tools.includes('Skill'))
            {
                flag(`agents/${agentFile} tells the agent to invoke the Skill tool but 'Skill' is not in its tools: allowlist - it would deadlock on the convention gate`);
            }

            // 40. ... and every name in that allowlist resolves to a real tool.
            for (const finding of lintAgentTools(`agents/${agentFile}`, text)) flag(finding);

            // 43. ... and every allowlist grants the shared memory MCP's store, search and list tools.
            for (const finding of lintAgentMemoryTools(`agents/${agentFile}`, text)) flag(finding);
        }
    }

    // 18. rules/*.md and agents/*.md frontmatter must be strict
    //     YAML - the same failure mode check 1 guards for skills: an unquoted
    //     scalar containing ': ' breaks GitHub rendering AND any strict
    //     frontmatter parser. Rules need a non-empty description (pathless
    //     baseline) or a paths string array (path-scoped). Agents need
    //     name (= filename) plus the house keys: description, model, effort, tools.
    let rulesChecked = 0;
    let agentsChecked = 0;
    for (const target of [
        { dir: path.join(ROOT, 'stack', 'rules'), kind: 'rule' },
        { dir: path.join(ROOT, 'stack', 'agents'), kind: 'agent' },
    ])
    {
        for (const file of fs.readdirSync(target.dir).filter(f => f.endsWith('.md')).sort())
        {
            const rel = `${target.kind === 'rule' ? 'rules' : 'agents'}/${file}`;
            if (target.kind === 'rule') rulesChecked++; else agentsChecked++;
            const fm = fs.readFileSync(path.join(target.dir, file), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!fm)
            {
                flag(`${rel} has no YAML frontmatter block`);
                continue;
            }

            let meta;
            try
            {
                meta = yaml.load(fm[1]);
            }
            catch (err)
            {
                flag(`${rel} frontmatter is not valid YAML: ${err.reason || err.message}`);
                continue;
            }

            if (meta === null || typeof meta !== 'object' || Array.isArray(meta))
            {
                flag(`${rel} frontmatter did not parse to a mapping`);
                continue;
            }

            if (target.kind === 'rule')
            {
                const hasDesc = typeof meta.description === 'string' && meta.description.trim() !== '';
                const hasPaths = Array.isArray(meta.paths) && meta.paths.length > 0 && meta.paths.every(p => typeof p === 'string');
                if (!hasDesc && !hasPaths)
                {
                    flag(`${rel} frontmatter needs a non-empty 'description' (pathless) or a 'paths' string array (path-scoped)`);
                }
            }
            else
            {
                const expected = file.replace(/\.md$/, '');
                if (meta.name !== expected)
                {
                    flag(`${rel} frontmatter name is '${meta.name}', expected '${expected}'`);
                }

                for (const key of ['description', 'model', 'effort', 'tools'])
                {
                    if (typeof meta[key] !== 'string' || meta[key].trim() === '')
                    {
                        flag(`${rel} frontmatter has no non-empty '${key}'`);
                    }
                }
            }
        }
    }

    // 19. The HTML house-skills invocation column must match frontmatter:
    //     every disable-model-invocation skill carries the "manual" row flag,
    //     and no auto-invoked skill claims it.
    for (const name of manualSkills)
    {
        if (!html.houseManual.has(name))
        {
            flag(`alfred-code.html house row for '${name}' misses the "manual" invocation flag (its SKILL.md sets disable-model-invocation)`);
        }
    }

    for (const name of html.houseManual)
    {
        if (!manualSkills.has(name))
        {
            flag(`alfred-code.html marks '${name}' manual but its SKILL.md does not set disable-model-invocation`);
        }
    }

    // 20. The committed dependency graph (meta/stack-graph.json) must match a
    //     fresh build from the current skills/agents/rules/manifests. Lazy-require
    //     avoids a load-time cycle (stack-graph.js requires this module back).
    const stackGraph = require('./stack-graph.js');
    if (stackGraph.readCommitted() !== stackGraph.serialize(stackGraph.buildStackGraph()))
    {
        flag('stack-graph: meta/stack-graph.json is stale - run `node scripts/stack-graph.js --write` and commit it');
    }

    // 21. ONE version everywhere: the plugin manifest (what the marketplace serves from
    //     main) and the marketplace metadata must agree - the release workflow tags each
    //     release v<version> from the plugin manifest, so a mismatch here would ship a
    //     release whose version differs from the marketplace's.
    const pluginManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'setup-plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    const marketplaceManifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const marketplaceVersion = marketplaceManifest.metadata && marketplaceManifest.metadata.version;
    if (!pluginManifest.version)
    {
        flag('setup-plugin/.claude-plugin/plugin.json has no version - the release workflow tags each release from it');
    }
    else if (pluginManifest.version !== marketplaceVersion)
    {
        flag(`version drift: setup-plugin plugin.json '${pluginManifest.version}' vs .claude-plugin/marketplace.json metadata '${marketplaceVersion}' - the plugin, the marketplace, and the release must carry ONE version`);
    }

    // 42. What the manifest ENUMERATES must equal what is on disk - see lintPluginComponents.
    const pluginComponentDirs = {};
    for (const field of ['commands', 'agents', 'hooks'])
    {
        const dir = path.join(ROOT, 'setup-plugin', field);
        if (fs.existsSync(dir)) pluginComponentDirs[field] = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    }

    for (const finding of lintPluginComponents(pluginManifest, pluginComponentDirs)) flag(finding);

    // 22. The evidence catalog names only real artifacts, and every regex signal
    //     carries a display label. Rosters: skill dirs; MCPs/plugins from the
    //     installer blocks (active + commented - a commentable entry is still real).
    const evidencePath = path.join(ROOT, 'meta', 'evidence.json');
    let evidenceCatalog = null;
    try
    {
        evidenceCatalog = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    }
    catch (err)
    {
        flag(`meta/evidence.json is unreadable: ${err.message}`);
    }

    if (evidenceCatalog)
    {
        const rosters = {
            skills: new Set(dirs),
            mcps: new Set([...mcpsManifest.active, ...mcpsManifest.commented]),
            plugins: new Set([...pluginsManifest.active, ...pluginsManifest.commented]),
        };
        for (const finding of lintEvidenceCatalog(evidenceCatalog, rosters))
        {
            flag(finding);
        }

        // 28. The plugin-settings catalog - rows must name an installed plugin and carry a why.
        const pluginSettingsPath = path.join(ROOT, 'meta', 'plugin-settings.json');
        try
        {
            const pluginSettings = JSON.parse(fs.readFileSync(pluginSettingsPath, 'utf8'));
            for (const finding of lintPluginSettings(pluginSettings, rosters.plugins)) flag(finding);
        }
        catch (err)
        {
            flag(`meta/plugin-settings.json is unreadable: ${err.message}`);
        }

        // 30. Capability sentences in the stack's own source carry their probe.
        try
        {
            const capFiles = [];
            const walk = (dir, rel) =>
            {
                for (const e of fs.readdirSync(dir, { withFileTypes: true }))
                {
                    if (e.name.startsWith('.')) continue;
                    const full = path.join(dir, e.name);
                    const r = `${rel}/${e.name}`;
                    if (e.isDirectory()) walk(full, r);
                    else if (/\.(md|js|sh|ps1)$/.test(e.name)) capFiles.push({ path: r, text: fs.readFileSync(full, 'utf8') });
                }
            };
            for (const d of ['stack/rules', 'stack/hooks', 'scripts/install', 'setup-plugin']) walk(path.join(ROOT, d), d);
            for (const finding of lintCapabilityClaims(capFiles)) flag(finding);
        }
        catch (err)
        {
            flag(`the capability-claim sweep could not run: ${err.message}`);
        }

        // 32. House voice in the SHIPPED text: no em-dash. The guided walks and the rules are the
        //     only voice source on a fresh install (the baseline-interaction rule is not there yet),
        //     so a dash that reaches a project teaches the wrong one - measured, a first-run
        //     narration line opened with an em-dash on exactly that surface.
        try
        {
            const dashed = [];
            // ... and the same walk flags characters nobody can see (hiddenChars above), over scripts/ too.
            const hidden = [];
            // A RUN's own output is not shipped text: `setup-plugin/evals/results/` holds the eval
            // report and its aggregate JSON, written by Claude Code with its own punctuation and
            // re-dated on every run (gitignored for the same reason). Sweeping it made the house
            // voice check fail on a file the house did not write.
            const GENERATED = new Set(['setup-plugin/evals/results']);
            const sweep = (dir, rel) =>
            {
                if (GENERATED.has(rel)) return;
                for (const e of fs.readdirSync(dir, { withFileTypes: true }))
                {
                    if (e.name.startsWith('.')) continue;
                    const full = path.join(dir, e.name);
                    const r = `${rel}/${e.name}`;
                    if (e.isDirectory()) sweep(full, r);
                    else if (/\.(md|js|sh|ps1|json|ya?ml)$/.test(e.name))
                    {
                        const text = fs.readFileSync(full, 'utf8');
                        // the em-dash is house voice for what SHIPS; scripts/ is swept for hidden characters only
                        if (rel.split('/')[0] !== 'scripts')
                        {
                            const hit = text.split('\n').findIndex(l => /[\u2014\u2015]/.test(l));
                            if (hit !== -1) dashed.push(`${r}:${hit + 1}`);
                        }
                        for (const h of hiddenChars(text, e.name)) hidden.push(`hidden character U+${h.hex} at ${r}:${h.line} - write it as an escape`);
                    }
                }
            };
            for (const d of ['stack', 'setup-plugin', 'meta', 'scripts']) sweep(path.join(ROOT, d), d);
            for (const site of dashed) flag(`house voice: an em-dash in shipped text at ${site} - single dashes only`);
            for (const line of hidden) flag(line);
        }
        catch (err)
        {
            flag(`the em-dash sweep could not run: ${err.message}`);
        }

        // 29. The deliberate-only roster vs the fresh-session hook's ORCHESTRATION list.
        try
        {
            const deliberate = localSkillDirs()
                .filter((d) => /^\s*disable-model-invocation:\s*true\s*$/m.test(fs.readFileSync(path.join(SKILLS_DIR, d, 'SKILL.md'), 'utf8')));
            const hookSrc = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-fresh-session-start.js'), 'utf8');
            for (const finding of lintOrchestrationRoster(deliberate, hookSrc)) flag(finding);
        }
        catch (err)
        {
            flag(`the deliberate-only roster check could not run: ${err.message}`);
        }

        // 23. The judgment catalog (meta/judgment.json) - same silent-miss
        //     class: refs must resolve, overlaps carry both gaps, thresholds parse.
        const judgmentPath = path.join(ROOT, 'meta', 'judgment.json');
        let judgmentCatalog = null;
        try
        {
            judgmentCatalog = JSON.parse(fs.readFileSync(judgmentPath, 'utf8'));
        }
        catch (err)
        {
            flag(`meta/judgment.json is unreadable: ${err.message}`);
        }

        if (judgmentCatalog)
        {
            const agentNames = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
            for (const finding of lintJudgmentCatalog(judgmentCatalog, { ...rosters, agents: new Set(agentNames) }))
            {
                flag(finding);
            }
        }
    }

    // 31. guard-secret-value.js judges a key by meta/environment.json's `secret_key_pattern`; the
    //     hook ships into projects without meta/, so it carries a copy - and the copy must be
    //     byte-identical, or a key the catalog calls secret is one the guard lets through.
    try
    {
        const envCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'environment.json'), 'utf8'));
        const hookSrc = fs.readFileSync(path.join(ROOT, 'stack', 'hooks', 'guard-secret-value.js'), 'utf8');
        const m = hookSrc.match(/const SECRET_KEY_SOURCE = '([^']*)'/);
        if (!m)
        {
            flag('guard-secret-value.js: no `const SECRET_KEY_SOURCE = \'...\'` literal - the environment.json parity check has nothing to compare');
        }
        else if (m[1] !== envCatalog.secret_key_pattern)
        {
            flag(`guard-secret-value.js SECRET_KEY_SOURCE '${m[1]}' differs from meta/environment.json secret_key_pattern '${envCatalog.secret_key_pattern}'`);
        }
    }
    catch (err)
    {
        flag(`guard-secret-value.js / meta/environment.json parity check could not read its inputs: ${err.message}`);
    }

    // 29. The capabilities usage policy carries a content stamp, and the stamp matches the block.
    //     That block ships VERBATIM into every project's generated baseline-project-agent-capabilities.md,
    //     and nothing could tell a project carrying a two-release-old copy from a current one - the
    //     generated rule is never re-fetched, only re-generated by a user re-run. The stamp is what
    //     `/alfred-code:validate` compares a project's copy against, so it has to be true here first.
    try
    {
        const capPath = path.join(SKILLS_DIR, 'project-agent-capabilities', 'SKILL.md');
        const capLines = fs.readFileSync(capPath, 'utf8').split('\n');
        const start = capLines.findIndex((l) => l.startsWith('## Usage policy (fixed'));
        if (start < 0) { flag('project-agent-capabilities/SKILL.md has no `## Usage policy (fixed ...)` heading - the stamped block moved or was renamed'); }
        else
        {
            const revLine = capLines[start + 1] || '';
            const declared = (revLine.match(/policy-rev:\s*([0-9a-f]{8})/) || [])[1];
            let end = start + 2;
            while (end < capLines.length && !capLines[end].startsWith('## ')) end += 1;
            const block = capLines.slice(start + 2, end).join('\n').trim();
            const actual = crypto.createHash('sha1').update(block).digest('hex').slice(0, 8);
            if (!declared) flag('project-agent-capabilities/SKILL.md: the usage-policy block carries no `<!-- policy-rev: ... -->` line directly under its heading');
            else if (declared !== actual) flag(`project-agent-capabilities/SKILL.md: policy-rev is ${declared} but the block hashes to ${actual} - the stamped policy changed, so bump the rev (projects compare their generated copy against it)`);
        }
    }
    catch (err)
    {
        flag(`project-agent-capabilities/SKILL.md is unreadable: ${err.message}`);
    }

    // 24. The shared-rules registry (meta/shared-rules.json) - the sanctioned multi-home
    //     rules. Any copy edited without its marker (and its sibling copies) updated fails
    //     here, so the multi-home sync is mechanical, not remembered.
    const sharedRulesPath = path.join(ROOT, 'meta', 'shared-rules.json');
    let sharedRules = null;
    try
    {
        sharedRules = JSON.parse(fs.readFileSync(sharedRulesPath, 'utf8'));
    }
    catch (err)
    {
        flag(`meta/shared-rules.json is unreadable: ${err.message}`);
    }

    // 27. The environment catalog (meta/environment.json) against what the Node seed actually
    //     seeds - scripts/install/settings.js, the one place that writes an ALFRED_CODE_ key into
    //     settings.json - plus the rename targets migrations.json names. (25 and 26 are the
    //     optional-cite checks CLAUDE.md names by number - do not renumber those.)
    try
    {
        const envCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'environment.json'), 'utf8'));
        const seedSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'install', 'settings.js'), 'utf8');
        let migrationsCatalog = null;
        try { migrationsCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'migrations.json'), 'utf8')); }
        catch { /* its own lint reports an unreadable migrations.json */ }
        const commandSrc = {};
        for (const cmd of ['setup.md', 'configure.md', 'validate.md'])
        {
            commandSrc[`commands/${cmd}`] = fs.readFileSync(path.join(ROOT, 'setup-plugin', 'commands', cmd), 'utf8');
        }
        for (const finding of lintEnvironmentCatalog(envCatalog, seedSrc, migrationsCatalog, commandSrc))
        {
            flag(finding);
        }
    }
    catch (err)
    {
        flag(`meta/environment.json is unreadable: ${err.message}`);
    }

    let sharedRuleCount = 0;
    let sharedRuleCopies = 0;
    if (sharedRules)
    {
        sharedRuleCount = Object.keys(sharedRules.rules || {}).length;
        sharedRuleCopies = Object.values(sharedRules.rules || {}).reduce((n, r) => n + (r.owner ? 1 : 0) + (r.sites || []).length, 0);
        for (const finding of lintSharedRules(sharedRules, f => fs.readFileSync(path.join(ROOT, f), 'utf8')))
        {
            flag(finding);
        }
    }

    // 25. Cross-skill LOAD directives must not name a skill the install can lack.
    //     Optional skills (not reachable from any seed closure - evidence-gated or
    //     opt-in only) are absent in most projects, so an unguarded 'load `x`' makes
    //     the model call a skill that is not there and take an 'Unknown skill' error.
    try
    {
        const recs = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'recommendations.json'), 'utf8'));
        const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-graph.json'), 'utf8'));
        const skillDirs = new Set(dirs);
        const agentNames = new Set(fs.existsSync(AGENTS_DIR)
            ? fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
            : []);
        const optional = optionalSkills(recs, graph, skillDirs);
        const optionalSeats = optionalAgents(recs, graph, agentNames);
        const closures = seedClosures(recs, graph);
        const pluginNames = new Set([...pluginsManifest.active, ...pluginsManifest.commented]);
        // each scanned file with the artifact that OWNS it, so check 26 can ask which stacks
        // ship it: a skill's references belong to the skill, an agent/rule to itself.
        const scanned = [];
        for (const dir of dirs)
        {
            const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
            if (fs.existsSync(skillFile)) scanned.push([`skills/${dir}/SKILL.md`, skillFile, 'skills', dir]);
            const refDir = path.join(SKILLS_DIR, dir, 'references');
            if (fs.existsSync(refDir))
            {
                for (const f of fs.readdirSync(refDir).filter(f => f.endsWith('.md')))
                {
                    scanned.push([`skills/${dir}/references/${f}`, path.join(refDir, f), 'skills', dir]);
                }
            }
        }

        if (fs.existsSync(AGENTS_DIR))
        {
            for (const f of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')))
            {
                scanned.push([`agents/${f}`, path.join(AGENTS_DIR, f), 'agents', f.replace(/\.md$/, '')]);
            }
        }

        if (fs.existsSync(CLAUDE_RULES_DIR))
        {
            for (const f of fs.readdirSync(CLAUDE_RULES_DIR).filter(f => f.endsWith('.md')))
            {
                scanned.push([`rules/${f}`, path.join(CLAUDE_RULES_DIR, f), 'rules', f.replace(/\.md$/, '')]);
            }
        }

        scanned.push(['CLAUDE.template.md', CLAUDE_TEMPLATE, null, null]);

        for (const [label, file, kind, owner] of scanned)
        {
            const text = fs.readFileSync(file, 'utf8');
            for (const finding of lintOptionalCites(label, text, optional, { agents: optionalSeats, self: owner }))
            {
                flag(finding);
            }

            // 27. No install edge from a name: the removed `suggests:` frontmatter must not return.
            for (const finding of lintSuggestionEdges(label, text)) flag(finding);

            // 37. A plugin-qualified name carries its content clause or it teaches nothing.
            for (const finding of lintPluginCites(label, text, pluginNames)) flag(finding);

            // 26 + 36. Cross-stack coupling: a load directive naming a skill (26) or a seat (36)
            //     that is absent from at least one stack the CITING artifact itself ships into.
            //     Check 25 is the special case where the target reaches no stack at all; this is the
            //     one that bit in practice - a cross-cutting agent installed in every project naming
            //     `angular-security`, which a .NET-only install never has.
            if (!kind) continue;
            const absent = absentSkillsFor(closures, kind, owner, skillDirs);
            for (const s of absent) if (optional.has(s)) absent.delete(s);   // already reported above
            const absentSeats = absentAgentsFor(closures, kind, owner, agentNames);
            for (const a of absentSeats) if (optionalSeats.has(a)) absentSeats.delete(a);
            const host = [...hostStacks(closures, kind, owner)];
            const opts = {
                agents: absentSeats,
                self: owner,
                citerKind: kind === 'skills' ? 'skill' : kind.replace(/s$/, ''),
                absentIn: (name, layer) => host.filter(t => !closures[t][layer].has(name)),
            };
            for (const finding of lintOptionalCites(label, text, absent, opts)) flag(finding);
        }
    }
    catch (err)
    {
        flag(`optional-cite check could not run: ${err.message}`);
    }

    if (warnings.length > 0)
    {
        for (const warning of warnings)
        {
            console.error(`WARN: ${warning}`);
        }

        console.error('');
    }

    // 34. Every `references/<file>.md` a skill names resolves - own folder, the sibling named beside
    //     it, or some skill folder for a capability-described owner. A sibling rename used to dangle
    //     these locating pointers silently (surface-4 audit: 69 cross-skill pointers, none checked).
    for (const finding of lintReferencePointers(SKILLS_DIR, localSkillDirs())) flag(finding);

    // 41. A reference over 100 lines opens with a table of contents in its first 15.
    for (const finding of lintReferenceContents(SKILLS_DIR, localSkillDirs())) flag(finding);

    // 33. The ALWAYS-ON surface has a budget, and the number is printed every run. Everything here
    //     is re-sent on EVERY message of every session and every subagent of an install that takes
    //     it: the pathless baseline rules load like CLAUDE.md, and each agent's and skill's
    //     `description` rides the dispatch/skill inventory. An audit of 164 sessions measured the
    //     standing floor at 87k-134k tokens per message and the stack-owned share at roughly a
    //     third of it, with nothing in the repo measuring - so a paragraph added here costs more
    //     than the same paragraph anywhere else, and it used to cost it invisibly.
    let alwaysOnChars = 0;
    try
    {
        const descOf = (file) =>
        {
            const m = fs.readFileSync(file, 'utf8').match(/^description:\s*(.*)$/m);
            return m ? m[1].length : 0;
        };
        let ruleChars = 0;
        for (const f of fs.readdirSync(CLAUDE_RULES_DIR))
        {
            if (!f.endsWith('.md')) continue;
            const full = path.join(CLAUDE_RULES_DIR, f);
            if (/^paths:/m.test(fs.readFileSync(full, 'utf8'))) continue;   // path-scoped: lazy, not always-on
            ruleChars += fs.statSync(full).size;
        }
        let agentChars = 0;
        for (const f of fs.readdirSync(AGENTS_DIR)) if (f.endsWith('.md')) agentChars += descOf(path.join(AGENTS_DIR, f));
        let skillChars = 0;
        for (const d of localSkillDirs()) skillChars += descOf(path.join(SKILLS_DIR, d, 'SKILL.md'));
        alwaysOnChars = ruleChars + agentChars + skillChars;
        // The ceiling is the measured surface plus ~10% headroom: it is a budget to DEFEND, not a
        // target to grow into. Raising it is a deliberate edit with a reason, which is the point.
        const ALWAYS_ON_MAX = 160000;
        if (alwaysOnChars > ALWAYS_ON_MAX)
        {
            flag(`always-on surface ${alwaysOnChars} chars (~${Math.round(alwaysOnChars / 4000)}k tokens) is over the ${ALWAYS_ON_MAX} budget`
                + ` - pathless rules ${ruleChars}, agent descriptions ${agentChars}, skill descriptions ${skillChars}.`
                + ` Every one of those characters is re-sent on every message of every session and subagent: trim, or raise the budget deliberately.`);
        }
    }
    catch (err)
    {
        flag(`the always-on surface measurement could not run: ${err.message}`);
    }

    // 44 + 45. Plugin placement is computed: the core is the only plugin, and the generated entries are current.
    // 46. The repo root carries no name a shared-source marketplace entry auto-discovers (spike S9c).
    // 47. The marketplace manifest passes `claude plugin validate --strict`.
    for (const finding of lintPluginPlacement()) flag(finding);
    for (const finding of lintRepoRootReserved()) flag(finding);
    // 48. The core's hooks block matches the manifest's own wiring table.
    for (const finding of lintHooksEntry()) flag(finding);
    // 49. The LIVE marketplace matches the generated entries - from Phase 3 the core is generated
    // too, so a hand edit to any entry is drift, not a change; the two 1.x aliases are generated
    // like the retired entries, and a `renames` key or a hooks entry is a finding.
    for (const finding of lintMarketplaceEntries()) flag(finding);
    // 50. Every agent's `skills:` preload carries the plugin prefix the placement gives it.
    for (const finding of lintAgentPreloads()) flag(finding);
    // 51. The seed's CORE_DEP_PLUGINS mirrors the manifest's parked cross-marketplace dependencies.
    for (const finding of lintCoreDependencies()) flag(finding);
    // 52. Nothing the marketplace ships depends on a plugin `bin/` entry (spike S4: Windows NOT RUN).
    for (const finding of lintNoPluginBin()) flag(finding);
    // 53. The MCP plugin entries match the generator, the installer catalog and the tree.
    for (const finding of lintMcpEntries()) flag(finding);
    // 54. No shipped file names an MCP tool by its BARE server spelling - it would never resolve.
    for (const finding of lintMcpToolNames()) flag(finding);
    // 55. Our own workflows: no event field spliced into run, no floating third-party action, no
    //     pull_request_target checkout of the PR head.
    for (const finding of lintWorkflows(workflowFiles())) flag(finding);
    // 56. No retired plugin's name is left in shipped stack text.
    for (const finding of lintRetiredNames(stackTextFiles())) flag(finding);
    // 57. The 1.x name stays in the legacy readers - every other tracked line spells alfred-code.
    for (const finding of lintLegacyNames(repoTextFiles())) flag(finding);
    for (const finding of lintMarketplaceSchema()) flag(finding);

    if (findings.length > 0)
    {
        for (const finding of findings)
        {
            console.error(`LINT: ${finding}`);
        }

        console.error(`\n${findings.length} finding(s).`);
        process.exit(1);
    }

    console.log(`lint-skills: clean (${dirs.length} skills, ${primary.active.size} active manifest entries, `
        + `${pluginsManifest.active.size} plugins, ${mcpsManifest.active.size} MCPs; manifest + HTML in sync; `
        + `${rulesChecked} rules + ${agentsChecked} agents frontmatter-clean; `
        + `${sharedRuleCount} shared rule(s), ${sharedRuleCopies} copies in sync; `
        + `always-on surface ~${Math.round(alwaysOnChars / 4000)}k tokens).`);
}

// ---------------------------------------------------------------------------------------------
// 44 + 45. Placement is COMPUTED from meta/recommendations.json + meta/stack-graph.json, so the
// generated entries are derivable - and a drift between what the rule computes and what is committed
// is exactly the failure this pair exists to catch. Since 1.3.0 the rule has ONE plugin, the core; every
// other item is library, copied per pick, so a project pays exactly its per-item closure by
// construction and the old cost gate has nothing left to measure.
function lintPluginPlacement(placeIn)
{
    const out = [];
    let placeMod;
    let buildMod;
    try
    {
        placeMod = require('./plugin-placement.js');
        buildMod = require('./build-marketplace.js');
    }
    catch (err)
    {
        return [`the plugin placement modules could not be loaded: ${err.message}`];
    }

    let place = placeIn;
    if (!place)
    {
        try { place = placeMod.placement(); }
        catch (err) { return [`plugin placement could not run: ${err.message}`]; }
    }

    if (Object.keys(place.plugins).length !== 1 || !place.plugins[placeMod.CORE])
        out.push(`the placement ships plugins other than ${placeMod.CORE} - every non-core item is library, copied per pick.`);

    const seen = new Map();
    const note = (key, where) =>
    {
        if (seen.has(key)) out.push(`${key} has two homes: ${seen.get(key)} and ${where} - placement puts every item in exactly one.`);
        else seen.set(key, where);
    };
    for (const [name, plug] of Object.entries(place.plugins))
    {
        for (const s of plug.skills) note('skill:' + s, name);
        for (const a of plug.agents) note('agent:' + a, name);
    }
    for (const s of place.library.skills) note('skill:' + s, placeMod.LIBRARY);
    for (const a of place.library.agents) note('agent:' + a, placeMod.LIBRARY);
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta/stack-graph.json'), 'utf8'));
    for (const s of Object.keys(graph.skills)) if (!seen.has('skill:' + s)) out.push(`skill ${s} is in no plugin and not in the library - placement must be total.`);
    for (const a of Object.keys(graph.agents)) if (!seen.has('agent:' + a)) out.push(`agent ${a} is in no plugin and not in the library - placement must be total.`);

    try
    {
        const wanted = buildMod.serialize(buildMod.buildEntries({ placement: place }));
        const have = fs.existsSync(buildMod.ENTRIES_FILE) ? fs.readFileSync(buildMod.ENTRIES_FILE, 'utf8') : null;
        if (have !== wanted) out.push('meta/plugin-entries.json is STALE - run `npm run marketplace`; it is generated, never hand-edited.');
    }
    catch (err) { out.push(`the plugin entries could not be generated: ${err.message}`); }

    return out;
}

// 46. Every marketplace entry that shares this repo as its `source` also gets whatever sits at the
// ROOT under a component name, whatever that entry lists - measured in spike S9, assert (c): a root
// `agents/` loaded once PER ENTRY, a root `.mcp.json` and `hooks/hooks.json` loaded once and were
// attributed to a different entry each. An explicit path list does NOT suppress it. So these names
// are reserved at the repo root. `.mcp.json` is the one exception: this repo is itself a consuming
// project, so a machine-local one is expected - but it must stay UNTRACKED, or every install from a
// local-path marketplace registers this repo's own servers into the consuming project.
const RESERVED_ROOT_NAMES = ['skills', 'commands', 'agents', 'hooks', 'monitors', 'settings.json', '.lsp.json'];
function lintRepoRootReserved(root)
{
    const base = root || ROOT;
    const out = [];
    for (const name of RESERVED_ROOT_NAMES)
    {
        const full = path.join(base, name);
        if (!fs.existsSync(full)) continue;
        if (name === 'hooks' && !fs.existsSync(path.join(full, 'hooks.json'))) continue;
        out.push(`the repo root carries \`${name}\`, which every marketplace entry sharing \`source: "./"\` auto-discovers whatever the entry lists (spike S9c) - move it under stack/ or setup-plugin/.`);
    }
    const mcp = path.join(base, '.mcp.json');
    if (fs.existsSync(mcp) && isTracked(base, '.mcp.json'))
        out.push('the repo root carries a TRACKED `.mcp.json` - every marketplace entry sharing the root would register its servers into the consuming project (spike S9c). This repo\'s own .mcp.json stays machine-local and gitignored.');
    return out;
}

function isTracked(base, rel)
{
    try
    {
        execFileSync('git', ['-C', base, 'ls-files', '--error-unmatch', rel], { stdio: 'ignore' });
        return true;
    }
    catch { return false; }
}

// 51. The core declares no dependencies (a missing one disables it at load), so the installer puts
// its cross-marketplace companion beside it on every run - the seed from CORE_DEP_PLUGINS in
// install/plugins.js. Until Phase 7b this also had to agree with each twin's own copy of that list;
// the twins are gone, so the remaining agreement is with the manifest: a core dependency is a plugin
// row PARKED (`active: false`) rather than picked - the seed's list and the manifest's parked rows
// have to name the same plugins, or a companion the seed installs is invisible to the catalog (a
// stamp / `--installed-only` derivation would not know it shipped), or the manifest parks a plugin
// the seed never installs (a row parked for no reason a fresh install can act on).
function lintCoreDependencies(manifestFile, seedList)
{
    const out = [];
    let rows;
    try { rows = readStackManifest(manifestFile).plugins; }
    catch (err) { return [`meta/stack-manifest.json plugins[] could not be read: ${err.message}`]; }
    if (!Array.isArray(rows) || !rows.length) return ['meta/stack-manifest.json has no plugins[] - the core would silently lose its cross-marketplace companion.'];

    const want = (seedList || require('./install/plugins.js').CORE_DEP_PLUGINS).map((n) => n.split('@')[0]).sort();
    if (!want.length) out.push('install/plugins.js CORE_DEP_PLUGINS is empty - the core plugin would lose its cross-marketplace companion.');

    const parked = rows.filter((r) => r.active === false).map((r) => r.id.split('@')[0]).sort();
    if (want.join(',') !== parked.join(','))
        out.push(`CORE_DEP_PLUGINS is [${want.join(', ')}] in the seed but the manifest parks [${parked.join(', ') || 'nothing'}] as active:false - keep them in sync.`);

    for (const name of want)
        if (!rows.some((r) => r.id.split('@')[0] === name))
            out.push(`CORE_DEP_PLUGINS names '${name}', which has no row in meta/stack-manifest.json plugins - the seed depends on a plugin the manifest never lists.`);

    return out;
}

// 52. Spike S4 proved a plugin `bin/` entry lands on PATH on macOS and recorded Windows as NOT RUN:
// Windows has no shebang handling, and whether Claude Code shims a `bin/` entry there is unknown.
// The plan's own condition is that until that check runs, no shipped code path may depend on one.
// This enforces it, at the repo root (every shared-source entry auto-discovers it, spike S9c) and
// in the two trees the entries ship from. Running the Windows check is what lifts this.
function lintNoPluginBin(root)
{
    const base = root || ROOT;
    const out = [];
    for (const rel of ['bin', path.join('stack', 'bin'), path.join('setup-plugin', 'bin')])
    {
        if (!fs.existsSync(path.join(base, rel))) continue;
        out.push(`\`${rel}\` exists - a plugin \`bin/\` entry is unproven on Windows (spike S4 NOT RUN), so nothing shipped may depend on one. Run the Windows check before adding it.`);
    }
    try
    {
        const mk = JSON.parse(fs.readFileSync(path.join(base, '.claude-plugin', 'marketplace.json'), 'utf8'));
        for (const e of mk.plugins || [])
            for (const key of ['commands', 'skills', 'agents', 'hooks', 'mcpServers'])
                for (const v of [].concat(e[key] || []))
                    if (typeof v === 'string' && /(^|\/)bin(\/|$)/.test(v))
                        out.push(`marketplace entry '${e.name}' lists \`${v}\` under ${key}, which reaches a bin/ path - unproven on Windows (spike S4).`);
    }
    catch { /* the schema check owns an unreadable manifest */ }
    return out;
}

// 53. The MCP plugin entries are GENERATED from meta/mcp-pins.json plus the shapes in
// build-marketplace.js, and the installer's MCPS catalog still owns the NAMES. Three ways this can
// rot, one check: the live marketplace drifting from the generator, a catalog server with no plugin
// to carry it (it would silently stop being installable), and a plugin naming a launcher or helper
// script that is not in the tree (the server would fail at start-up with no clue why).
function lintMcpEntries()
{
    const out = [];
    let build;
    try { build = require('./build-marketplace.js'); }
    catch (err) { return [`the marketplace generator could not be loaded: ${err.message}`]; }

    let wanted;
    try { wanted = build.mcpPlugins(); }
    catch (err) { return [`the MCP entries could not be generated: ${err.message}`]; }

    let mkt;
    try { mkt = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')); }
    catch (err) { return [`.claude-plugin/marketplace.json could not be read: ${err.message}`]; }

    for (const entry of wanted)
    {
        const live = (mkt.plugins || []).find(p => p && p.name === entry.name);
        if (!live)
        {
            out.push(`.claude-plugin/marketplace.json has no \`${entry.name}\` MCP entry - run \`node scripts/build-marketplace.js --mcp-entries\`.`);
            continue;
        }
        if (JSON.stringify(live) !== JSON.stringify(entry))
            out.push(`the \`${entry.name}\` MCP entry is STALE against the generator - run \`node scripts/build-marketplace.js --mcp-entries\`.`);
    }

    // ONE PLUGIN, ONE SERVER, SAME NAME. A plugin server's tools are addressed
    // `mcp__plugin_<plugin>_<server>__<tool>`, so this invariant is what makes every shipped tool
    // name `mcp__plugin_<n>_<n>__<tool>` for a single `<n>`. It is also what keeps a project from
    // loading schemas it did not pick: all of a plugin's servers load together, so a second server
    // in an entry is a second set of tool schemas in every session of every project that enabled it.
    for (const entry of wanted)
    {
        const servers = Object.keys(entry.mcpServers || {});
        if (servers.length !== 1 || servers[0] !== entry.name)
            out.push(`the \`${entry.name}\` MCP entry declares [${servers.join(', ')}] - one plugin carries exactly ONE server, named like the plugin, or the tool names stop being mcp__plugin_<n>_<n>__<tool> and every session pays the extra schemas.`);
    }

    // Every catalog server has a plugin, and every plugin serves a catalog server. The catalog is
    // meta/stack-manifest.json's `mcps` list, which stays the one home for the NAMES even after the
    // registrations move - 28 call sites read a name out of it.
    const catalog = manifestFlatSet(readStackManifest().mcps, (r) => r.name);
    const carried = new Set();
    for (const entry of wanted) for (const server of Object.keys(entry.mcpServers)) carried.add(server);
    // playwright expands into one plugin per engine; each maps back to its catalog name, the way
    // every installed-name reader already maps `playwright-*`.
    const family = name => name.replace(/^playwright-.*/, 'playwright');
    const families = new Set([...carried].map(family));
    for (const name of catalog.active)
        if (!families.has(name))
            out.push(`MCP '${name}' is in the installer catalog but no plugin entry carries it - add a shape in build-marketplace.js.`);
    for (const name of families)
        if (!catalog.active.has(name) && !catalog.commented.has(name))
            out.push(`the marketplace carries MCP '${name}', which is in neither the active nor the commented installer catalog.`);

    // S14: an unset `${VAR}` with no default stays LITERAL in a plugin entry - it does not become
    // empty. So a placeholder without a `:-` default only ships where the literal is the lesser
    // evil, and each such case is named here rather than left to read as an oversight. The two
    // left are Claude Code's own variables, which the harness supplies to a plugin server itself.
    const LITERAL_OK = new Set(['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR']);
    for (const entry of wanted)
        for (const [server, spec] of Object.entries(entry.mcpServers))
        {
            const text = JSON.stringify(spec);
            for (const m of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/g))
            {
                if (m[2] || LITERAL_OK.has(m[1])) continue;
                out.push(`MCP server '${server}' expands \${${m[1]}} with no \`:-\` default - an unset variable stays LITERAL in a plugin entry (spike S14), so give it a default or add it to LITERAL_OK with the reason.`);
            }
        }

    // A launcher or headers helper the entry names must exist, or the server dies at start-up with
    // a message no user can act on.
    for (const entry of wanted)
        for (const [server, spec] of Object.entries(entry.mcpServers))
        {
            const words = [...(spec.args || []), spec.command || '', spec.headersHelper || ''];
            for (const word of words)
            {
                const m = String(word).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/);
                if (!m) continue;
                if (!fs.existsSync(path.join(ROOT, m[1])))
                    out.push(`MCP server '${server}' points at ${m[1]}, which is not in the tree.`);
            }
        }
    return out;
}

// 54. Every MCP server the stack ships arrives through a PLUGIN, so its tools are addressed
// `mcp__plugin_<plugin>_<server>__<tool>`. The bare `mcp__<server>__<tool>` spelling belonged to
// the registration route and resolves to nothing now: a `tools:` allowlist written that way
// silently drops the tool, and a `ToolSearch select:` line written that way silently finds none.
// The names are read from the generated entries, never typed here - so this file cannot itself
// contain the spelling it bans, and a new server is covered the day its entry lands.
function lintMcpToolNames()
{
    const out = [];
    let names;
    try { names = require('./build-marketplace.js').mcpPlugins().map(e => e.name); }
    catch (err) { return [`the MCP entries could not be generated, so the tool-name sweep did not run: ${err.message}`]; }
    const bare = new RegExp(`mcp__(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})__`, 'g');
    const roots = ['stack', 'setup-plugin', 'meta', 'scripts'];
    const skip = /(^|\/)(node_modules|\.git)(\/|$)/;
    const walk = (dir, hit) =>
    {
        let names2;
        try { names2 = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return hit; }
        for (const d of names2)
        {
            const full = path.join(dir, d.name);
            if (skip.test(path.relative(ROOT, full))) continue;
            if (d.isDirectory()) { walk(full, hit); continue; }
            if (!/\.(md|mdc|js|json|sh|ps1|html|txt)$/.test(d.name)) continue;
            let body;
            try { body = fs.readFileSync(full, 'utf8'); } catch { continue; }
            const found = body.match(bare);
            if (found) hit.push([path.relative(ROOT, full), found.length, found[0]]);
        }
        return hit;
    };
    const hits = [];
    for (const r of roots) walk(path.join(ROOT, r), hits);
    for (const [file, count, sample] of hits)
        out.push(`${file} names an MCP tool by its bare server spelling (${count}x, e.g. \`${sample}\`) - a plugin server's tools are \`mcp__plugin_<plugin>_<server>__<tool>\`, so the bare form resolves to nothing.`);
    return out;
}

// 56. A retired plugin's NAME does not outlive the plugin in shipped text. The seats kept its
// disciplines inline under house terms; a leftover name points a seat at a plugin no install
// carries, and the interaction rule already bans its code markers.
const RETIRED_TERMS = [
    { name: 'ponytail', re: /\bponytail/i, use: "'build lean' / 'question the need' / 'over-build review'" },
];
function lintRetiredNames(files)
{
    const out = [];
    for (const { file, text } of files)
        text.split('\n').forEach((line, i) =>
        {
            for (const t of RETIRED_TERMS)
                if (t.re.test(line)) out.push(`${file}:${i + 1} names the retired '${t.name}' plugin - the house terms are ${t.use}`);
        });
    return out;
}
function stackTextFiles(root = ROOT)
{
    const files = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (/\.(md|mdc|js|json|sh|ps1|ya?ml|txt)$/.test(e.name))
                files.push({ file: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
        }
    };
    walk(path.join(root, 'stack'));
    return files;
}

// 57. The 1.x name stays in the legacy readers. 2.0.0 renamed the stack to alfred-code, and the
// old spellings are READ for the whole 2.x line - so a 1.x spelling left anywhere else is either a
// reader nobody marked or a new thing named after a retired product. A line that must keep one
// carries `legacy-name` (`// legacy-name`, `# legacy-name`, `<!-- legacy-name -->`). What passes
// without a marker, each for its reason:
const LEGACY_NAME = /claude-stack|CLAUDE_STACK_/g; // legacy-name
const LEGACY_FILES = [
    { re: /^docs\/[^/]+-evidence\.md$/, why: 'measured evidence keeps its words' },
    { re: /^meta\/migrations\.json$/, why: 'a migration names the spelling it migrates from' },
    { re: /^meta\/retired-entries\.json$/, why: 'the only record of what each 1.x per-stack entry carried' },
    { re: /^\.claude-plugin\/marketplace\.json$/, why: 'generated: its 1.x aliases come from brand.js LEGACY, its retired entries from retired-entries.json, and check 49 holds it to the generator' },
];
// JSON carries no comment, and brand.js is the one home a call site takes the old names from.
const LEGACY_SPANS = [
    { file: 'meta/stack-manifest.json', start: /^\s*"retired"\s*:\s*\{/, why: 'the retired lists are history' },
    { file: 'scripts/install/brand.js', start: /^const LEGACY = \{/, why: 'the one home of the 1.x names' },
];
// The per-stack entries 1.2.0 shipped keep their 1.x names while they are retired (plan decision
// D2): a name listed in meta/retired-entries.json passes wherever it appears.
function retiredEntryNames(root = ROOT)
{
    try { return JSON.parse(fs.readFileSync(path.join(root, 'meta', 'retired-entries.json'), 'utf8')).entries.map((e) => e.name); }
    catch { return []; }
}
// The line range of the brace block opening on the first line `start` matches, strings skipped.
function braceSpan(lines, start)
{
    const first = lines.findIndex((l) => start.test(l));
    if (first < 0) return null;
    let depth = 0;
    let quote = '';
    for (let i = first; i < lines.length; i++)
    {
        const line = lines[i];
        for (let c = 0; c < line.length; c++)
        {
            const ch = line[c];
            if (quote) { if (ch === '\\') c++; else if (ch === quote) quote = ''; continue; }
            if (ch === '"' || ch === "'" || ch === '`') quote = ch;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) return [first, i];
        }
    }
    return [first, lines.length - 1];
}
function lintLegacyNames(files, { retiredEntries = retiredEntryNames() } = {})
{
    const escaped = [...retiredEntries].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
    const retiredRe = escaped.length ? new RegExp(`(?:${escaped.join('|')})(?![\\w-])`, 'g') : null;
    const out = [];
    for (const { file, text } of files)
    {
        if (LEGACY_FILES.some((a) => a.re.test(file))) continue;
        const lines = text.split('\n');
        const spans = LEGACY_SPANS.filter((s) => s.file === file).map((s) => braceSpan(lines, s.start)).filter(Boolean);
        lines.forEach((line, i) =>
        {
            if (line.includes('legacy-name') || spans.some(([a, b]) => i >= a && i <= b)) return;
            const rest = retiredRe ? line.replace(retiredRe, '') : line;
            const hits = [...new Set(rest.match(LEGACY_NAME) || [])];
            if (hits.length)
                out.push(`${file}:${i + 1} spells the 1.x name (${hits.join(', ')}) - use alfred-code / ALFRED_CODE_, or mark a legacy reader's line \`legacy-name\` (\`// legacy-name\` in code, \`<!-- legacy-name -->\` in markdown).`);
        });
    }
    return out;
}
// Every tracked text file: `git ls-files` when `root` is a repo's top level, else a walk of the
// tree (the clean export the gate runs in has no .git), node_modules and .git skipped. A file
// holding a NUL byte is binary and skipped.
function repoTextFiles(root = ROOT)
{
    let names = null;
    try
    {
        const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (fs.realpathSync(top) === fs.realpathSync(root))
            names = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    }
    catch { names = null; }
    if (!names)
    {
        names = [];
        const walk = (dir, rel) =>
        {
            for (const e of fs.readdirSync(dir, { withFileTypes: true }))
            {
                if (e.name === 'node_modules' || e.name === '.git') continue;
                const r = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) walk(path.join(dir, e.name), r);
                else if (e.isFile()) names.push(r);
            }
        };
        walk(root, '');
    }
    const files = [];
    for (const name of names.sort())
    {
        let buf;
        try { buf = fs.readFileSync(path.join(root, name)); } catch { continue; }   // tracked but deleted in the tree
        if (buf.includes(0)) continue;
        files.push({ file: name, text: buf.toString('utf8') });
    }
    return files;
}

// 48. The stack hooks ride the CORE entry (2.0.0, 'Fold into core'), GENERATED from the manifest's
// own hooks[] wiring table, so the plugin route and the settings.json route cannot drift while both
// exist. A matcher edited in one place and not the other is exactly the bug this catches: the copied
// hook would still gate a tool the plugin hook no longer sees, or the reverse. `liveIn` is a parsed
// marketplace for a test; the lint reads the committed file.
function lintHooksEntry(liveIn)
{
    const out = [];
    let build;
    try { build = require('./build-marketplace.js'); }
    catch (err) { return [`the marketplace generator could not be loaded: ${err.message}`]; }

    let wanted;
    let stack;
    try { wanted = build.coreEntry(); stack = build.hooksBlock(build.parseHookWirings()); }
    catch (err) { return [`the core's hooks could not be generated: ${err.message}`]; }

    let mkt = liveIn;
    if (!mkt)
    {
        try { mkt = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8')); }
        catch (err) { return [`.claude-plugin/marketplace.json could not be read: ${err.message}`]; }
    }

    const live = (mkt.plugins || []).find(p => p && p.name === wanted.name);
    if (!live) return [`.claude-plugin/marketplace.json has no \`${wanted.name}\` entry - run \`npm run marketplace\`.`];
    if (JSON.stringify(live.hooks) !== JSON.stringify(wanted.hooks))
        out.push(`the \`${wanted.name}\` core entry's hooks are STALE against the manifest's hooks table - run \`npm run marketplace\` (\`node scripts/build-marketplace.js --hooks-entry\` prints the wanted block).`);

    // Every wired hook file exists, and every hook file that exists is either wired or an engine.
    const ENGINES = new Set(['docs.js', 'memory.js', 'history.js', 'hook-prelude.js', 'fresh-session.js']);
    const wired = new Set();
    for (const blocks of Object.values(stack))
        for (const block of blocks)
            for (const entry of block.hooks)
            {
                // The launcher shape is part of the contract: a bare script path needs the exec
                // bit, which git carries into the plugin cache as committed, and never runs on Windows.
                const m = String(entry.command).match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/stack\/hooks\/([a-z-]+\.js)"/);
                if (!m)
                {
                    out.push(`the core's stack hooks run \`${entry.command}\` - every hook launches as node "\${CLAUDE_PLUGIN_ROOT}/stack/hooks/<file>".`);
                    continue;
                }
                const file = m[1];
                wired.add(file);
                if (!fs.existsSync(path.join(ROOT, 'stack/hooks', file)))
                    out.push(`the core wires ${file}, which is not in stack/hooks/.`);
            }
    for (const file of fs.readdirSync(path.join(ROOT, 'stack/hooks')))
    {
        if (!file.endsWith('.js') || ENGINES.has(file) || wired.has(file)) continue;
        out.push(`stack/hooks/${file} is wired by nothing - add it to the installer's HOOKS table or name it an engine.`);
    }

    // The two gates belong to every wired hook, and to no engine.
    for (const file of wired)
    {
        const text = fs.readFileSync(path.join(ROOT, 'stack/hooks', file), 'utf8');
        if (!text.includes('STACK HOOK GATES'))
            out.push(`stack/hooks/${file} carries no stand-down gate - a plugin copy would fire beside a still-wired project copy.`);
        else if (!text.includes(`standDown('${file.replace(/\.js$/, '')}')`))
            out.push(`stack/hooks/${file} names another hook in standDown() - the gate must name itself.`);
    }
    return out;
}

// 50. A preload names a plugin skill, and a BARE name silently preloads a stale `.claude/skills/`
// copy when one is present (spike S6) - the exact shape every migrating project has for a session.
// The prefix is computed from the placement, so this only checks that the files agree with it.
function lintAgentPreloads()
{
    let rows;
    try { rows = require('./scope-agent-preloads.js').scopedFor(); }
    catch (err) { return [`the agent preloads could not be checked: ${err.message}`]; }
    const findings = [];
    for (const r of rows)
    {
        if (r.problem) { findings.push(`agent preload: ${r.file} - ${r.problem}`); continue; }
        if (r.block !== r.wanted)
            findings.push(`agent preload: ${r.file} is not scoped to the placement - run \`npm run scope-preloads\``);
    }
    return findings;
}

// 49. Every plugin entry in the live marketplace is GENERATED - the placement decides what the core
// ships, meta/retired-entries.json what each retiring entry still lists, and brand.js LEGACY the two
// 1.x ids listed as retired aliases - so a hand-edited path list, description or dependency is
// drift. The core is the one PLUGIN; the aliases are the only other stack entries it accepts, each
// exactly as generated. A `renames` key or a hooks entry is a finding: 2.0.0 ships neither (S11/S16,
// and the fold). `liveIn` is a parsed marketplace for a test; the lint reads the committed file.
function lintMarketplaceEntries(liveIn)
{
    const findings = [];
    let live = liveIn;
    let wanted;
    let build;
    try
    {
        build = require('./build-marketplace.js');
        if (!live) live = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
        wanted = build.buildEntries().concat(build.aliasEntries(), build.retiredMarketplaceEntries());
    }
    catch (err)
    {
        return [`the marketplace entries could not be checked: ${err.message}`];
    }
    const byName = new Map((live.plugins || []).map(p => [p.name, p]));
    for (const entry of wanted)
    {
        const have = byName.get(entry.name);
        if (!have) { findings.push(`marketplace.json is missing the generated entry ${entry.name} - run \`npm run marketplace\``); continue; }
        if (JSON.stringify(have) !== JSON.stringify(entry))
            findings.push(`marketplace.json entry ${entry.name} does not match the generated one - run \`npm run marketplace\`; it is generated, never hand-edited`);
    }
    const generated = new Set(wanted.map(e => e.name));
    if (live && Object.prototype.hasOwnProperty.call(live, 'renames'))
        findings.push('marketplace.json carries a `renames` key - 2.0.0 ships none: a rename strands a 1.x install with no hooks and no skills (docs/rebrand-evidence.md S11, S16); the 1.x ids are listed as aliases instead - run `npm run marketplace`');
    // The MCP plugins are generated by ANOTHER table and have their own check (53, from
    // meta/mcp-pins.json plus the shapes in build-marketplace.js). Placement never produces them, so
    // they are not drift.
    const elsewhere = new Set();
    try { for (const e of build.mcpPlugins()) elsewhere.add(e.name); } catch { /* 53 reports it */ }
    for (const p of live.plugins || [])
    {
        if (!p || elsewhere.has(p.name) || generated.has(p.name)) continue;
        if ((build.FOLDED_ENTRIES || []).includes(p.name))
            findings.push(`marketplace.json carries ${p.name}, whose hooks folded into the core in 2.0.0 - run \`npm run marketplace\`, which drops it`);
        else findings.push(`marketplace.json carries ${p.name}, which the placement does not produce - remove it or give it a home in plugin-placement.js`);
    }
    return findings;
}

// 47. The manifest the marketplace serves has to pass the CLI's own schema check. The CLI is not
// present everywhere (a CI image, a fresh clone), and a missing tool is reported as NOT RUN rather
// than laundered into a pass - the rule the stack applies to every other probe.
function lintMarketplaceSchema()
{
    const out = [];
    try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); }
    catch
    {
        console.log('lint-skills: the claude CLI is absent - `claude plugin validate --strict` NOT RUN.');
        return out;
    }
    try { execFileSync('claude', ['plugin', 'validate', ROOT, '--strict'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err)
    {
        const said = (String(err.stdout || '') + String(err.stderr || '')).trim().split('\n').filter(Boolean).slice(-4).join(' | ');
        out.push(`\`claude plugin validate --strict\` failed on .claude-plugin/marketplace.json: ${said}`);
    }
    return out;
}

// The environment catalog (meta/environment.json) is the ONE list the three guided commands read
// for the settings.json `env` block - and the Node seed (scripts/install/settings.js) is what
// actually seeds it. Unlike the frozen twins, settings.js seeds most rows GENERICALLY, looping over
// this very catalog (applyEnv's absent-only pass) - so there is nothing to compare there, that
// direction is true by construction. The four rows it names LITERALLY - the two `written: true` keys
// it sets outside that loop, and the two DECISIONS (docs versioning, hooks-off) it special-cases by
// name - are the ones a rename can desync, so those are checked against the seed's own source text.
function lintEnvironmentCatalog(catalog, seedSrc, migrations, commandSrc)
{
    const out = [];
    // The three guided commands must READ the catalog, not a list typed into their prose - that is
    // the whole point of having one: a variable a release adds is asked about, shown and reconciled
    // without touching three command files.
    for (const [name, src] of Object.entries(commandSrc || {}))
    {
        if (!src.includes('meta/environment.json'))
        {
            out.push(`${name} does not read meta/environment.json - its environment step would go stale the next time a variable is added`);
        }
    }
    const rows = Array.isArray(catalog.env) ? catalog.env : null;
    if (!rows)
    {
        return ['environment.json has no `env` array - the guided commands would read an empty environment layer'];
    }

    // migrations.json keeps its history's words under the 1.x prefix; read here under the catalog's
    // own name, via the SAME prefix mapping applyEnv runs at install time (meta/migrations.json is
    // the one source, not a hard-coded regex).
    const { prefixRenames } = require('./install/env-migrations.js').envMigrations(migrations);
    const current = (key) =>
    {
        for (const [from, to] of prefixRenames)
            if (key.startsWith(from)) return to + key.slice(from.length);
        return key;
    };
    const namedInSeed = new Set([...seedSrc.matchAll(/ALFRED_CODE_[A-Z0-9_]+/g)].map((m) => current(m[0])));
    const keys = new Set();
    for (const row of rows)
    {
        if (!row.key) { out.push('environment.json has a row with no `key`'); continue; }
        if (keys.has(row.key)) { out.push(`environment.json lists ${row.key} twice`); }
        keys.add(row.key);
        if (typeof row.default !== 'string') { out.push(`environment.json ${row.key} has no string \`default\` - the seed value and the walk's shown default come from it`); }
        if (!row.what) { out.push(`environment.json ${row.key} has no \`what\` - the walks print it, so a row without one cannot be asked about`); }
        if (row.written && !namedInSeed.has(row.key)) { out.push(`environment.json ${row.key} is marked written, but scripts/install/settings.js never names it literally - the Node seed would never set it`); }
    }
    // The two DECISIONS are special-cased by literal key name, never fed through the generic loop -
    // both a catalog row and a mention in the seed's own source are required, or the special case
    // silently stops applying on one side.
    for (const key of ['ALFRED_CODE_DOCS_VERSIONING', 'ALFRED_CODE_HOOKS_OFF'])
    {
        if (!keys.has(key)) { out.push(`scripts/install/settings.js special-cases ${key}, which environment.json does not list`); }
        if (!namedInSeed.has(key)) { out.push(`${key} is a catalog row, but scripts/install/settings.js does not name it - the special case moved or was removed`); }
    }
    // setup asks the `ask: true` rows on ONE AskUserQuestion screen, and the tool caps a call at four
    // questions; a row with `asked_with` rides along with another row's question. Past four, the
    // fifth question is silently dropped by the tool - so the cap is enforced here, at authoring time.
    const asked = rows.filter(r => r.ask && !r.asked_with).length;
    if (asked > 4) { out.push(`environment.json asks ${asked} questions on setup's environment screen - the AskUserQuestion cap is 4; fold one row into another with asked_with, or stop asking it`); }
    // A rename in migrations.json must land on a key the catalog owns, or validate would offer to
    // migrate a value into a variable nothing reads.
    for (const m of (migrations && migrations.migrations) || [])
    {
        const r = m.rename_settings_env;
        if (!r) { continue; }
        if (!keys.has(current(r.to))) { out.push(`migrations.json '${m.id}' renames ${r.from} to ${r.to}, which environment.json does not list`); }
        const row = rows.find(x => x.key === current(r.to));
        if (row && row.renamed_from !== r.from) { out.push(`environment.json ${r.to} does not record renamed_from '${r.from}' - validate reads it to spot the old spelling on disk`); }
    }

    return out;
}

module.exports = {
    hiddenChars,
    lintWorkflows,
    lintPluginPlacement,
    lintHooksEntry,
    lintMcpEntries,
    lintMcpToolNames,
    lintRetiredNames,
    stackTextFiles,
    lintLegacyNames,
    repoTextFiles,
    lintCoreDependencies,
    lintNoPluginBin,
    lintMarketplaceEntries,
    lintAgentPreloads,
    lintRepoRootReserved,
    lintMarketplaceSchema,
    RESERVED_ROOT_NAMES,
    paths: { ROOT, SKILLS_DIR, MANIFEST_JSON, AGENTS_DIR, CLAUDE_RULES_DIR },
    readStackManifest,
    manifestSkillMap,
    manifestFileList,
    manifestFlatSet,
    localSkillDirs,
    lintEvidenceCatalog,
    lintPluginSettings,
    lintPluginComponents,
    lintOrchestrationRoster,
    lintCapabilityClaims,
    lintJudgmentCatalog,
    lintEnvironmentCatalog,
    lintSharedRules,
    lintPreloadClaims,
    lintOptionalCites,
    lintPluginCites,
    lintAgentTools,
    lintAgentMemoryTools,
    MEMORY_TOOLS,
    lintReferencePointers,
    lintReferenceContents,
    optionalSkills,
    optionalAgents,
    lintSuggestionEdges,
    seedClosures,
    hostStacks,
    absentSkillsFor,
    absentAgentsFor,
    availabilityCoverage,
    TOOL_NAMES,
    NON_SKILL_TOKENS,
};

if (require.main === module)
{
    main();
}
