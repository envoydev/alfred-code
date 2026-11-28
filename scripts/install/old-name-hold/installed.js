'use strict';
// THE OLD-NAME HOLD (B4): the paths under `.claude/` the installer itself writes, from the lists it already holds (the
// manifest's picks and the hook engines and modules). Pure - names in, paths out: { files } match exactly, { prefixes }
// match the start of a path.
const { SETTINGS_DIR, STACK_RULE_PREFIX, STACK_OWN_FILES } = require('./constants.js');

function installedPaths({ hooks = [], engines = [], modules = [], skills = [], agents = [], rules = [] })
{
    const under = (folder, name) => `${SETTINGS_DIR}/${folder}/${name}`;
    const agentNames = agents.map((file) => file.replace(/\.md$/, ''));
    return {
        files: [
            ...[...hooks, ...engines, ...modules].map((file) => under('hooks', file)),
            ...agentNames.map((name) => under('agents', `${name}.md`)),
            ...rules.map((file) => under('rules', file)),
            ...STACK_OWN_FILES.map((file) => `${SETTINGS_DIR}/${file}`),
        ],
        prefixes: [
            ...skills.map((name) => `${under('skills', name)}/`),
            ...agentNames.map((name) => `${under('agents', name)}/`),
            under('rules', STACK_RULE_PREFIX),
        ],
    };
}

module.exports = { installedPaths };
