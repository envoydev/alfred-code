// Lint check 33's measure, kept out of lint-skills.js so the lint file's own length stays what the
// read-guard suite measures against (guard-hooks.test.js reads lint-skills.js as its long source file).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STACK = path.join(ROOT, 'stack');

// 33's measure - what the model is SENT, never what sits on disk. Claude Code removes a rule's
// frontmatter before loading it and strips block-level HTML comments, a fenced one kept
// (code.claude.com/docs/en/memory); a `disable-model-invocation` skill's description is not in
// context, and `when_to_use` is appended to the description in the listing
// (code.claude.com/docs/en/skills). Counting whole files over-counted the rules by their frontmatter
// and maintainer notes, and the manual-only descriptions besides, while the fixed text every
// generated capabilities rule carries - its usage policy - went uncounted.
function frontmatterOf(text)
{
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
    return m ? m[1] : '';
}

function frontmatterValue(frontmatter, key)
{
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter);
    return m ? m[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
}

function injectedRuleText(text)
{
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    if (lines[0] === '---')
    {
        const end = lines.indexOf('---', 1);
        if (end > 0) i = end + 1;
    }
    const out = [];
    let fence = null;
    let inComment = false;
    const afterClose = (line) => line.slice(line.indexOf('-->') + 3);
    for (; i < lines.length; i++)
    {
        const line = lines[i];
        if (inComment)
        {
            if (!line.includes('-->')) continue;
            inComment = false;
            if (afterClose(line).trim()) out.push(afterClose(line));
            continue;
        }
        const f = /^\s*(```|~~~)/.exec(line);
        if (f)
        {
            if (!fence) fence = f[1];
            else if (line.trim().startsWith(fence)) fence = null;
            out.push(line);
            continue;
        }
        if (!fence && /^\s*<!--/.test(line))
        {
            if (!line.includes('-->')) inComment = true;
            else if (afterClose(line).trim()) out.push(afterClose(line));
            continue;
        }
        out.push(line);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// The fixed text every generated capabilities rule carries: the usage-policy section of the skill's
// copy target (its policy-rev stamp is a comment, stripped). The locked servers' shared routing row left with the
// servers (2026-10-24, the stack ships no MCP server); every row now is one server's, paid only where it is registered.
function capabilitiesFixedText(skillText)
{
    const skill = String(skillText || '').split(/\r?\n/);
    const at = skill.findIndex((l) => l.startsWith('## Usage policy (fixed'));
    const policy = [];
    for (let i = at; at !== -1 && i < skill.length; i++)
    {
        if (i > at && (/^## /.test(skill[i]) || /^```/.test(skill[i]))) break;
        policy.push(skill[i]);
    }
    return { policy: injectedRuleText(policy.join('\n')) };
}

// The generated awareness rule's own text: SKILL.md's copy target as injected, its import slot left out - the docs it
// imports are the project's own run book and siblings, never the stack's fixed text.
function awarenessRuleText(skillText)
{
    const lines = String(skillText || '').split(/\r?\n/);
    const marker = lines.findIndex((l) => /COPY TARGET/.test(l));
    const open = marker === -1 ? -1 : lines.findIndex((l, i) => i > marker && /^```markdown\s*$/.test(l));
    const close = open === -1 ? -1 : lines.findIndex((l, i) => i > open && /^```\s*$/.test(l));
    if (close === -1) return '';
    return injectedRuleText(lines.slice(open + 1, close).filter((l) => !/^<the script's import lines/.test(l)).join('\n'));
}

function alwaysOnSurface({
    rulesDir = path.join(STACK, 'rules'),
    agentsDir = path.join(STACK, 'agents'),
    skillsDir = path.join(STACK, 'skills'),
    capabilitiesDir = path.join(skillsDir, 'capture-awareness'),
} = {})
{
    const read = (file) => fs.readFileSync(file, 'utf8');
    let rules = 0;
    for (const f of fs.readdirSync(rulesDir))
    {
        if (!f.endsWith('.md')) continue;
        const text = read(path.join(rulesDir, f));
        if (/^paths:/m.test(frontmatterOf(text))) continue;   // path-scoped: lazy, not always-on
        rules += injectedRuleText(text).length;
    }
    let agents = 0;
    let agentTools = 0;
    for (const f of fs.readdirSync(agentsDir))
    {
        if (!f.endsWith('.md')) continue;
        const fm = frontmatterOf(read(path.join(agentsDir, f)));
        agents += frontmatterValue(fm, 'description').length;
        if (fm.trim()) agentTools += listedTools(fm).length;   // a file with no frontmatter is no seat
    }
    let skills = 0;
    let manualOnly = 0;
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true }))
    {
        const file = path.join(skillsDir, e.name, 'SKILL.md');
        if (!e.isDirectory() || !fs.existsSync(file)) continue;
        const fm = frontmatterOf(read(file));
        if (/^true$/i.test(frontmatterValue(fm, 'disable-model-invocation'))) { manualOnly += 1; continue; }
        skills += frontmatterValue(fm, 'description').length + frontmatterValue(fm, 'when_to_use').length;
    }
    const readSoft = (file) => { try { return read(file); } catch { return ''; } };
    // The agents reference holds the stamped usage policy in its copy target.
    const fixed = capabilitiesFixedText(readSoft(path.join(capabilitiesDir, 'references', 'agents.md')));
    const generated = fixed.policy.length + awarenessRuleText(readSoft(path.join(capabilitiesDir, 'SKILL.md'))).length;
    return { rules, agents, agentTools, skills, manualOnly, generated, total: rules + agents + agentTools + skills + generated };
}

// The dispatcher lists each seat as `- <plugin>:<name>: <description> (Tools: <tools>)` - the `tools:` value
// verbatim (a YAML list joined with ', '), `*` when the seat names none. That suffix is sent beside every
// description on every message (audit 2026-10-10, session 8f44a003: 33,635 of the listing's 45,027 chars), so
// it is part of `total` - the user's 2026-10-13 ruling ('Count them, cap 80k'), taken with the navigation
// server's memory tools leaving every seat's grant.
function listedTools(frontmatter)
{
    let tools = frontmatterValue(frontmatter, 'tools');
    if (!tools)
    {
        const m = /^tools:[ \t]*\r?\n((?:[ \t]+-[ \t]+.*(?:\r?\n|$))+)/m.exec(frontmatter);
        tools = m ? m[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean).join(', ') : '*';
    }
    return ` (Tools: ${tools})`;
}

const alwaysOnParts = (s) => `pathless rules ${s.rules} (as injected), agent descriptions ${s.agents}, skill descriptions ${s.skills}`
    + ` (${s.manualOnly} manual-only not in context), generated capabilities fixed text ${s.generated}`
    + `, agent tools lists ${s.agentTools} (listed beside each description)`;

module.exports = { frontmatterOf, frontmatterValue, injectedRuleText, capabilitiesFixedText, awarenessRuleText, alwaysOnSurface, alwaysOnParts, listedTools };
