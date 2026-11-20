'use strict';
// The account's config dir as Claude Code reads it: CLAUDE_CONFIG_DIR when it is set and absolute, else <home>/.claude, where
// home is HOME off Windows. On Windows os.homedir() reads USERPROFILE, so that comes first; HOMEDRIVE + HOMEPATH and then HOME are
// the fallbacks a shell or a profile-less environment may leave.
// Pure: values in, a text or null out.
const { ACCOUNT, WIN32 } = require('./constants.js');

const present = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);

function windowsHome(env)
{
    const drive = present(env[ACCOUNT.driveKey]);
    const homePath = present(env[ACCOUNT.pathKey]);
    return present(env[ACCOUNT.profileKey]) || (drive && homePath ? `${drive}${homePath}` : null) || present(env[ACCOUNT.homeKey]);
}

function accountDirOf(env, platform)
{
    const configured = present(env[ACCOUNT.configDirKey]);
    if (configured && ACCOUNT.absolute.test(configured)) return configured;
    const home = platform === WIN32 ? windowsHome(env) : present(env[ACCOUNT.homeKey]);
    if (!home || !ACCOUNT.absolute.test(home)) return null;
    return `${home.replace(ACCOUNT.trailingSeps, '')}/${ACCOUNT.dirName}`;
}

module.exports = { accountDirOf };
