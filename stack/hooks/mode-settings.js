'use strict';
// The mode file's trust test (mode commands v2, stage 3): may the stack write the modes into it? A file git tracks is the
// team's ('tracked'), one no repository holds or git leaves untracked is this machine's ('own'), and anything the test
// cannot settle is 'unknown' - a `.claude` that is a link or holds its own `.git`, or a git that is missing, slow or odd.
// It requires the layout reader alone - never the prelude, which requires it.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const layout = require('./layout.js');

// git's exit status for `args` run in the folder holding `.claude`, or null when git cannot be run. A hook spawns git
// with the repository's fsmonitor off and no optional locks (hook-prelude.js gitSafe), and with no inherited GIT_* that
// could point it at another repository.
function localGitStatus(file, args = ['ls-files', '--error-unmatch', '--', ':(icase).claude/settings.local.json'])
{
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
    const r = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args],
        { cwd: path.dirname(path.dirname(file)), env: { ...env, GIT_OPTIONAL_LOCKS: '0' }, stdio: 'ignore', timeout: 3000, windowsHide: true });
    return r.error || r.status === null ? null : r.status;
}

// 'tracked' | 'own' | 'unknown' for the mode file `file`, by the table above.
function localTrust(file, status = localGitStatus)
{
    const claude = path.dirname(file);
    let st = null;
    try { st = fs.lstatSync(claude, { throwIfNoEntry: false }) || null; } catch { return 'unknown'; }
    if (st && (st.isSymbolicLink() || fs.existsSync(path.join(claude, '.git')))) return 'unknown';
    if (!layout.gitTopOf(path.dirname(claude))) return 'own';
    const code = status(file);
    return code === 0 ? 'tracked' : code === 1 ? 'own' : 'unknown';
}

module.exports = { localGitStatus, localTrust };
