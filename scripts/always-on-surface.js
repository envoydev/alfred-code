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
// generated capabilities rule carries - its usage policy and the locked-server row - went uncounted.
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
// copy target (its policy-rev stamp is a comment, stripped) and the one row the locked servers share.
function capabilitiesFixedText(skillText, templateText)
{
    const skill = String(skillText || '').split(/\r?\n/);
    const at = skill.findIndex((l) => l.startsWith('## Usage policy (fixed'));
    const policy = [];
    for (let i = at; at !== -1 && i < skill.length; i++)
    {
        if (i > at && (/^## /.test(skill[i]) || /^```/.test(skill[i]))) break;
        policy.push(skill[i]);
    }
    const tpl = String(templateText || '').split(/\r?\n/);
    const from = tpl.findIndex((l) => /^The routing map/.test(l));
    let locked = '';
    for (let i = from + 1; from !== -1 && i < tpl.length && !/^#{1,6} /.test(tpl[i]); i++)
    {
        if (locked && !/^[ \t]+\S/.test(tpl[i])) break;
        if (locked) locked += ` ${tpl[i].trim()}`;
        else if (/^- `(?:alfred-)?navigation`/.test(tpl[i])) locked = tpl[i].trim();
    }
    return { policy: injectedRuleText(policy.join('\n')), locked };
}

function alwaysOnSurface({
    rulesDir = path.join(STACK, 'rules'),
    agentsDir = path.join(STACK, 'agents'),
    skillsDir = path.join(STACK, 'skills'),
    capabilitiesDir = path.join(skillsDir, 'capture-agent-capabilities'),
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
    for (const f of fs.readdirSync(agentsDir)) if (f.endsWith('.md')) agents += frontmatterValue(frontmatterOf(read(path.join(agentsDir, f))), 'description').length;
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
    const fixed = capabilitiesFixedText(readSoft(path.join(capabilitiesDir, 'SKILL.md')), readSoft(path.join(capabilitiesDir, 'references', 'generated-rule-template.md')));
    const generated = fixed.policy.length + fixed.locked.length;
    return { rules, agents, skills, manualOnly, generated, total: rules + agents + skills + generated };
}

const alwaysOnParts = (s) => `pathless rules ${s.rules} (as injected), agent descriptions ${s.agents}, skill descriptions ${s.skills}`
    + ` (${s.manualOnly} manual-only not in context), generated capabilities fixed text ${s.generated}`;

module.exports = { frontmatterOf, frontmatterValue, injectedRuleText, capabilitiesFixedText, alwaysOnSurface, alwaysOnParts };
