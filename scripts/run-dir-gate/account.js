'use strict';
// The account's config dir as Claude Code reads it: CLAUDE_CONFIG_DIR when it is set and absolute, else <home>/.claude, where
// home is HOME (and, on Windows alone, USERPROFILE when HOME is unset). Pure: values in, a text or null out.
const { ACCOUNT, WIN32 } = require('./constants.js');

const present = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

function accountDirOf(env, platform)
{
    const configured = present(env[ACCOUNT.configDirKey]);
    if (configured && ACCOUNT.absolute.test(configured)) return configured;
    const home = present(env[ACCOUNT.homeKey]) || (platform === WIN32 ? present(env[ACCOUNT.profileKey]) : null);
    if (!home || !ACCOUNT.absolute.test(home)) return null;
    return `${home.replace(ACCOUNT.trailingSeps, '')}/${ACCOUNT.dirName}`;
}

module.exports = { accountDirOf };
