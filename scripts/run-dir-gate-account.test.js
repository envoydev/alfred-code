'use strict';
// The run-dir gate's account dir: the one value a plugin-settings `--config-dir` may take, and how the hook works it out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { accountDirOf } = require('./run-dir-gate/account.js');
const { D, shippedCtx, winShipped, WIN_RUN, atWin } = require('./run-dir-gate-fixture.js');

const ACCOUNT = '/home/u/.claude';
const accountCtx = { ...shippedCtx, accountDir: ACCOUNT, accountDirReal: ACCOUNT, platform: 'darwin' };
const settingsCall = (dir, tail = '--installed a,b --apply') => `node "${D}/repo/scripts/plugin-settings.js" --catalog "${D}/repo/meta/plugin-settings.json" --config-dir ${dir} ${tail}`;

test('--config-dir passes only as one double-quoted absolute path equal to the account\'s own config dir the hook computed', () =>
{
    const good = [`"${ACCOUNT}"`, `"${ACCOUNT}/"`, '"/HOME/U/.CLAUDE"'];
    for (const dir of good) assert.equal(approvesForms(settingsCall(dir), accountCtx), true, dir);
    assert.equal(approvesForms(settingsCall(`"${ACCOUNT}"`, '--installed a,b'), accountCtx), true, 'the report call, with no --apply');
    const bad = [`"/p/.claude"`, `"/home/u/other"`, '".claude"', '"C:.claude"', '"home/u/.claude"', '"./.claude"', `${ACCOUNT}`, `'${ACCOUNT}'`, `"${ACCOUNT}/sub"`, `"${ACCOUNT}/../x"`, '"/home/u"', '"~/.claude"', '""', 'x'];
    for (const dir of bad) assert.equal(approvesForms(settingsCall(dir), accountCtx), false, dir);
    for (const none of [null, undefined, '']) assert.equal(approvesForms(settingsCall(`"${ACCOUNT}"`), { ...accountCtx, accountDir: none, accountDirReal: none }), false, `no account dir: ${none}`);
    assert.equal(approvesForms(settingsCall(`"${ACCOUNT}"`, '--installed a,b --apply --config-dir "/p/.claude"'), accountCtx), false, 'a second --config-dir naming another dir');
    assert.equal(approvesForms(`node "${D}/repo/scripts/plugin-settings.js" --catalog "/p/evil.json" --config-dir "${ACCOUNT}" --apply`, accountCtx), false, 'the catalog stays pinned to the snapshot');
    const spelled = { ...accountCtx, accountDir: '/var/u/.claude', accountDirReal: '/private/var/u/.claude' };
    assert.equal(approvesForms(settingsCall('"/private/var/u/.claude"'), spelled), true, 'the real path spelling');
    assert.equal(approvesForms(settingsCall('"/var/u/.claude"'), spelled), true, 'the spelling the env gave');
});

test('--config-dir folds case on macOS and Windows only: on Linux a case variant is another folder', () =>
{
    for (const platform of ['linux', undefined]) assert.equal(approvesForms(settingsCall('"/HOME/U/.CLAUDE"'), { ...accountCtx, platform }), false, String(platform));
    assert.equal(approvesForms(settingsCall(`"${ACCOUNT}"`), { ...accountCtx, platform: 'linux' }), true);
    assert.equal(approvesForms(settingsCall('"/HOME/U/.CLAUDE"'), { ...accountCtx, platform: 'darwin' }), true);
});

test('--config-dir on Windows takes the account dir in a drive or an MSYS spelling, and refuses a drive-relative or another one', () =>
{
    const win = { ...winShipped, accountDir: 'C:\\Users\\u\\.claude', accountDirReal: 'C:\\Users\\u\\.claude' };
    const call = (dir) => `${atWin('scripts/plugin-settings.js')} --catalog "${WIN_RUN}\\repo\\meta\\plugin-settings.json" --config-dir ${dir} --installed a --apply`;
    for (const dir of ['"C:\\Users\\u\\.claude"', '"c:/users/u/.claude"', '"/c/Users/u/.claude"']) assert.equal(approvesForms(call(dir), win), true, dir);
    for (const dir of ['"C:.claude"', '"C:\\Users\\u\\other"', '".claude"', '"C:\\p\\.claude"', '"C:Users\\u\\.claude"']) assert.equal(approvesForms(call(dir), win), false, dir);
    const msys = { ...win, accountDir: '/c/Users/u/.claude', accountDirReal: '/c/Users/u/.claude' };
    assert.equal(approvesForms(call('"C:\\Users\\u\\.claude"'), msys), true);
});

test('accountDirOf is CLAUDE_CONFIG_DIR when set and absolute, else HOME/.claude, else USERPROFILE/.claude on Windows only', () =>
{
    assert.equal(accountDirOf({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' }, 'darwin'), '/cfg');
    assert.equal(accountDirOf({ CLAUDE_CONFIG_DIR: 'rel', HOME: '/h' }, 'darwin'), '/h/.claude');
    assert.equal(accountDirOf({ CLAUDE_CONFIG_DIR: '', HOME: '/h/' }, 'linux'), '/h/.claude');
    assert.equal(accountDirOf({ HOME: '/h' }, 'linux'), '/h/.claude');
    assert.equal(accountDirOf({ USERPROFILE: 'C:\\Users\\u' }, 'linux'), null);
    assert.equal(accountDirOf({ USERPROFILE: 'C:\\Users\\u' }, 'win32'), 'C:\\Users\\u/.claude');
    assert.equal(accountDirOf({ HOME: '/c/Users/u', USERPROFILE: 'C:\\Users\\v' }, 'win32'), 'C:\\Users\\v/.claude', 'os.homedir() on Windows: USERPROFILE first');
    assert.equal(accountDirOf({ HOME: '/c/Users/u', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\w' }, 'win32'), 'C:\\Users\\w/.claude', 'then HOMEDRIVE + HOMEPATH');
    assert.equal(accountDirOf({ HOME: '/c/Users/u', HOMEPATH: '\\Users\\w' }, 'win32'), '/c/Users/u/.claude', 'HOMEPATH alone is no home');
    assert.equal(accountDirOf({ HOME: '/c/Users/u', USERPROFILE: 'C:\\Users\\v' }, 'linux'), '/c/Users/u/.claude', 'off Windows HOME only');
    assert.equal(accountDirOf({ CLAUDE_CONFIG_DIR: 'C:\\cfg' }, 'win32'), 'C:\\cfg');
    for (const env of [{}, { HOME: '' }, { HOME: 'relative' }, { CLAUDE_CONFIG_DIR: '   ' }]) assert.equal(accountDirOf(env, 'darwin'), null, JSON.stringify(env));
});

