'use strict';
// TEST HELPER (not shipped): a root project and a git child below it, each run by the installer in one sandbox, so a suite
// states the steps - which project, which action, which picks - and reads what each left behind.
const fs = require('node:fs');
const path = require('node:path');
const { seedRun } = require('./seed-sandbox.js');
const wsLib = require('./install/workspace.js');
const rt = require('./install/runtime.js');

const SOURCE = path.join(__dirname, '..');
const CHILD = 'api';
const TOP = '.';
const PLUGINS = JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]);

const at = (work, rel = TOP) => path.join(work, 'ws', ...(rel === TOP ? [] : [rel]));
const acct = (work) => ({ CLAUDE_CONFIG_DIR: path.join(work, 'acct'), ALFRED_CODE_WORKSPACE: '1' });
// The two projects record each other: the child names the parent, the parent lists the child.
const join = (work) =>
{
    if (!wsLib.writeWorkspace(at(work, CHILD), (m) => wsLib.setParent(m, '..'), { env: acct(work) }).ok) throw new Error('child record not written');
    if (!wsLib.writeWorkspace(at(work), (m) => wsLib.addChild(m, CHILD), { env: acct(work) }).ok) throw new Error('root record not written');
};
// The root forgets the child: the child's own record still names the root, which no longer lists it back.
const demote = (work) => fs.rmSync(path.join(at(work), '.alfred', 'workspace.json'), { force: true });

// `steps`: { at, act ('install' | 'update'), sel (the selection file's text), before(work), after(work) -> read back }.
function runSteps(steps)
{
    return seedRun(steps.map((s) => s.act), '', {
        plugins: PLUGINS, source: steps.map(() => SOURCE),
        cwds: steps.map((s) => path.join('ws', ...(s.at === TOP ? [] : [s.at]))),
        env: steps.map(() => ({ ALFRED_CODE_WORKSPACE: '1' })),
        args: steps.map((s, i) => (repo, work) =>
        {
            if (s.before) s.before(work);
            const sel = path.join(work, `sel-${i}.txt`);
            fs.writeFileSync(sel, s.sel);
            return ['--selection', sel, ...(s.act === 'update' ? ['--installed-only'] : [])];
        }),
        prepare: (repo, work) =>
        {
            fs.mkdirSync(at(work, CHILD), { recursive: true });
            rt.execCommand('git', ['init', '-q', at(work, CHILD)]);
            fs.writeFileSync(path.join(at(work, CHILD), '.gitignore'), '.claude/\n.alfred/\n');   // git ignores the folders, so each kind is linked from a store
        },
        each: (repo, i) => (steps[i].after ? steps[i].after(path.dirname(repo)) : null),
    });
}

module.exports = { SOURCE, CHILD, TOP, at, join, demote, runSteps };
