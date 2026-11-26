'use strict';
// workspace-include: what a root hides from its own sessions that a child below it also loads - the child's copy of a
// skill the root lists, and the native rule file the root keeps for a set-aside child. Pure, like select.js: the installer
// side (install/child-hide.js) reads the stamps and the records and hands the values in.

const { ROW_GONE, TOP_RELS, SKILL_KEY_JOIN, SKILL_LINK_PREFIX, REL_JOIN, RULE_CATEGORY } = require('./constants.js');

const unique = (list) => [...new Set(list)];
const joinRel = (base, rel) => (TOP_RELS.includes(base) ? rel : `${base}${REL_JOIN}${rel}`);

// The `subtree()` rows of the projects below the top that still hold an install. An ignored project is no row: the record's
// view leaves it out of `children`, so the walk never reaches it.
const belowRows = (rows) => rows.filter((row) => !TOP_RELS.includes(row.rel) && row.state !== ROW_GONE);

// The skill names the stack put in one child: each `skills/<name>` its stamp's `links:` line records, and each name its
// `library-skills:` line hashes (the copy route). A folder no record names is the child's own and is never listed here.
function stackSkillNames(links, libraryNames)
{
    const linked = links.filter((entry) => entry.path.startsWith(SKILL_LINK_PREFIX)).map((entry) => entry.path.slice(SKILL_LINK_PREFIX.length));
    return unique([...linked, ...libraryNames]).sort();
}

// The keys a root's `skillOverrides` wants: `<rel>:<name>` for each skill a child holds as the stack's that the root lists
// itself. `children` is `[{ rel, skills }]`, `listed` the bare names the root lists.
function hiddenSkillKeys({ children, listed })
{
    const mine = new Set(listed);
    return unique(children.flatMap(({ rel, skills }) => skills.filter((name) => mine.has(name)).map((name) => `${rel}${SKILL_KEY_JOIN}${name}`))).sort();
}

// The rule names among kept lines (`rule <name>`), less the rules the root lists itself.
const keptRuleNames = (lines, listedRules) => unique(lines.filter((line) => line.startsWith(`${RULE_CATEGORY} `)).map((line) => line.slice(RULE_CATEGORY.length + 1))
    .filter((name) => !listedRules.includes(name))).sort();

// Who keeps each rule: one `{ name, rel }` for each `rule <name>` line of a record's `keptFor`, `rel` the child's path from the top.
function ruleKeepers(records)
{
    return records.flatMap(({ rel, view }) => Object.entries(view.keptFor || {}).flatMap(([child, lines]) => lines
        .filter((line) => line.startsWith(`${RULE_CATEGORY} `)).map((line) => ({ name: line.slice(RULE_CATEGORY.length + 1), rel: joinRel(rel, child) }))));
}

// Which kept rules the root hides: a rule goes only while at least one child keeps it and none of them shares the root's
// settings (`shares(rel)`: a same-repository child reads the root's settings, so the exclude would cut it off). A rule a
// sharing child keeps stays loading, and `stays` names it with that child. A rule no record names is left alone.
function ruleVerdicts({ rules, keepers, shares })
{
    const hide = [];
    const stays = [];
    for (const name of rules)
    {
        const keeping = keepers.filter((keeper) => keeper.name === name);
        if (!keeping.length) continue;
        const sharing = keeping.find((keeper) => shares(keeper.rel));
        if (sharing) stays.push({ name, rel: sharing.rel }); else hide.push(name);
    }
    return { hide, stays };
}

module.exports = { joinRel, belowRows, stackSkillNames, hiddenSkillKeys, keptRuleNames, ruleKeepers, ruleVerdicts };
