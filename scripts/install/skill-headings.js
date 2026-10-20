'use strict';
// A stack skill's IDENTITY across releases: its SKILL.md heading (the frontmatter `name` and `description` lines), and
// a hash of every heading the stack has shipped under each folder name (`meta/skill-headings.json`, generated from git
// history by `scripts/skill-headings.js`, held to the working tree by lint check 64).
//
// M3 claims a same-named copy the stamp does not record when its heading is the stack's. Checking the CURRENT heading
// alone missed every copy made before the stamp recorded skills (pre-2.1.0): its heading is an older one the stack
// really shipped, so update read it as the project's own and never touched it (2026-10-16: 14 and 28 such copies in
// two installs, still naming `context7`, their descriptions ~700 chars against the 160 cap).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = path.join('meta', 'skill-headings.json');

// `name\ndescription` from a SKILL.md's frontmatter, each value as written (quotes kept, trailing blanks dropped);
// null when the file has no frontmatter or no name.
function headingOf(text)
{
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
    if (!front) return null;
    const key = (k) => (((new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(front[1])) || [])[1] || '').trimEnd();
    const name = key('name');
    return name ? `${name}\n${key('description')}` : null;
}

const headingHash = (heading) => crypto.createHash('sha256').update(heading).digest('hex').slice(0, 16);

// name -> Set of past heading hashes, from the source's shipped file; an empty map when it is absent or unreadable
// (an older source: the current-heading test still runs).
function pastHeadings(sourceDir)
{
    try
    {
        const data = JSON.parse(fs.readFileSync(path.join(sourceDir, FILE), 'utf8'));
        return new Map(Object.entries(data.skills || {}).map(([name, list]) => [name, new Set(list)]));
    }
    catch { return new Map(); }
}

module.exports = { FILE, headingOf, headingHash, pastHeadings };
