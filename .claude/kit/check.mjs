#!/usr/bin/env node
// Copied into each repo as .claude/kit/check.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Fails when a file claude-kit manages was edited, removed or left out of the repo: each path in
// .claude/kit/lock.json must hash to the value sync wrote. The fix is never a local edit - change the file
// in claude-kit and run its sync, so the three repos keep one copy of the rule or skill.
// Fails too when a CLAUDE.md sits beside the repo's AGENTS.md: Claude Code reads AGENTS.md only while the repo has
// no CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md, and says nothing when one of them switches it off.
// Where the repo has a copies.json (the kit itself), fails when a site of an entry lacks a marker of its text, or the
// file is missing or unreadable; a sibling repo that is not checked out beside this one is named, never a failure.
// Fails when a skill - one the lock lists, or one under shared/skills - has a description that is missing, not on one
// line, or longer than the limit. A check that finds nothing wrong prints one line, and writes nothing.
//
//   node .claude/kit/check.mjs        exit 0 when every check passes, 1 otherwise
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BLOCK_SCALAR_PATTERN, CONTINUATION_PATTERN, COPIES_FILE, COPIES_UNREADABLE, DESCRIPTION_KEY, DESCRIPTION_PROBLEM,
    FRONTMATTER_FENCE, LOCKED_SKILL_PATTERN, MAX_DESCRIPTION_LENGTH, QUOTE_MARKS, SHARED_SKILLS_FOLDER, SITE_SEPARATOR,
    SKILL_FILE_NAMES,
} from './constants.mjs';

const kitDir = dirname(fileURLToPath(import.meta.url));
const root = join(kitDir, '..', '..');
const lock = JSON.parse(readFileSync(join(kitDir, 'lock.json'), 'utf8'));

function fail(line)
{
    console.error(line);
    process.exitCode = 1;
}

function checkManagedFiles()
{
    const problems = [];
    for (const [rel, wanted] of Object.entries(lock.files))
    {
        let text;
        try { text = readFileSync(join(root, rel)); }
        catch { problems.push(`missing: ${rel}`); continue; }
        if (createHash('sha256').update(text).digest('hex') !== wanted) problems.push(`edited here: ${rel}`);
    }
    if (!problems.length)
    {
        console.log(`claude-kit: ${Object.keys(lock.files).length} managed files match ${lock.kit}`);
        return;
    }
    fail(`claude-kit: ${problems.length} managed file(s) differ from the kit (${lock.kit}):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('Change them in claude-kit and run its sync (node bin/sync.ts <repo>), never in this repo.');
}

function checkHidingClaudeMd()
{
    const hiding = existsSync(join(root, 'AGENTS.md'))
        ? ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].filter((rel) => existsSync(join(root, rel)))
        : [];
    if (hiding.length)
        fail(`claude-kit: ${hiding.join(', ')} hides AGENTS.md from Claude Code - move its lines into AGENTS.md and delete it.`);
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSite = (value) => isObject(value) && typeof value.site === 'string'
    && Array.isArray(value.markers) && value.markers.every((marker) => typeof marker === 'string');

// The entries of a copies.json, or an Error that says what is wrong with the file.
function parseRegistry(text)
{
    const { copies } = JSON.parse(text) ?? {};
    if (!Array.isArray(copies)) throw new Error("no 'copies' array");
    copies.forEach((entry, index) =>
    {
        const valid = isObject(entry) && typeof entry.id === 'string' && isSite(entry.owner)
            && Array.isArray(entry.copies) && entry.copies.every(isSite);
        if (!valid) throw new Error(`entry ${index} needs an 'id', an 'owner' and a 'copies' array of sites with 'markers'`);
    });
    return copies;
}

const collapseWhitespace = (text) => text.replace(/\s+/g, ' ');

// A site is a path from the root, or '<repo>:<path>' for a sibling repo beside this one.
function locateSite(site)
{
    const at = site.indexOf(SITE_SEPARATOR);
    if (at === -1) return { repo: null, file: join(root, site) };
    const repo = site.slice(0, at);
    return { repo, file: join(root, '..', repo, site.slice(at + SITE_SEPARATOR.length)) };
}

function checkCopies()
{
    const registryFile = join(root, COPIES_FILE);
    if (!existsSync(registryFile)) return;
    let entries;
    try { entries = parseRegistry(readFileSync(registryFile, 'utf8')); }
    catch (error) { fail(`${COPIES_UNREADABLE}: ${error.message}`); return; }

    const notChecked = new Map();
    let failures = 0;
    let sitesChecked = 0;
    let markersChecked = 0;
    for (const entry of entries)
    {
        for (const site of [entry.owner, ...entry.copies])
        {
            const { repo, file } = locateSite(site.site);
            if (repo && !existsSync(join(root, '..', repo)))
            {
                notChecked.set(repo, (notChecked.get(repo) ?? 0) + 1);
                continue;
            }
            let text;
            try { text = collapseWhitespace(readFileSync(file, 'utf8')); }
            catch { fail(`${COPIES_FILE} ${entry.id}: ${site.site} is missing`); failures++; continue; }
            sitesChecked++;
            markersChecked += site.markers.length;
            for (const marker of site.markers)
            {
                if (text.includes(collapseWhitespace(marker))) continue;
                fail(`${COPIES_FILE} ${entry.id}: ${site.site} lacks '${marker}'`);
                failures++;
            }
        }
    }
    for (const [repo, count] of notChecked)
        console.log(`claude-kit: ${COPIES_FILE} - ${repo} is not checked out beside this repo, ${count} site(s) not checked`);
    if (!failures)
        console.log(`claude-kit: ${COPIES_FILE} - entries: ${entries.length}, sites checked: ${sitesChecked}, markers: ${markersChecked}`);
}

// The lines of the frontmatter - between the file's first line and the next fence - or null where it has none.
function frontmatterLines(text)
{
    const lines = text.split(/\r?\n/);
    if (lines[0].trim() !== FRONTMATTER_FENCE) return null;
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE);
    return end === -1 ? null : lines.slice(1, end);
}

const withoutQuotes = (value) => value.length > 1 && QUOTE_MARKS.includes(value[0]) && value.endsWith(value[0])
    ? value.slice(1, -1)
    : value;

// What is wrong with the description in a skill file's text, or null.
function describeDescriptionProblem(text)
{
    const lines = frontmatterLines(text) ?? [];
    const index = lines.findIndex((line) => line.startsWith(DESCRIPTION_KEY));
    if (index === -1) return DESCRIPTION_PROBLEM.missing;
    const value = lines[index].slice(DESCRIPTION_KEY.length).trim();
    if (!value || BLOCK_SCALAR_PATTERN.test(value) || CONTINUATION_PATTERN.test(lines[index + 1] ?? ''))
        return DESCRIPTION_PROBLEM.notOneLine;
    const length = withoutQuotes(value).length;
    return length > MAX_DESCRIPTION_LENGTH ? `description is ${length} characters, over ${MAX_DESCRIPTION_LENGTH}` : null;
}

function listSkillFiles()
{
    const files = Object.keys(lock.files).filter((rel) => LOCKED_SKILL_PATTERN.test(rel));
    const sharedFolder = join(root, SHARED_SKILLS_FOLDER);
    if (!existsSync(sharedFolder)) return files;
    for (const skill of readdirSync(sharedFolder, { withFileTypes: true }))
    {
        if (!skill.isDirectory()) continue;
        for (const name of SKILL_FILE_NAMES)
            if (existsSync(join(sharedFolder, skill.name, name))) files.push(`${SHARED_SKILLS_FOLDER}/${skill.name}/${name}`);
    }
    return files;
}

function checkSkillDescriptions()
{
    let checked = 0;
    let failures = 0;
    for (const rel of listSkillFiles())
    {
        let text;
        try { text = readFileSync(join(root, rel), 'utf8'); }
        catch { continue; }
        checked++;
        const problem = describeDescriptionProblem(text);
        if (!problem) continue;
        fail(`${rel}: ${problem}`);
        failures++;
    }
    if (checked && !failures)
        console.log(`claude-kit: ${checked} skill description(s) are one line of ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
}

checkManagedFiles();
checkHidingClaudeMd();
checkCopies();
checkSkillDescriptions();
