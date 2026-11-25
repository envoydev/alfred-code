'use strict';
// The keep of a path-scoped rule (workspace-child-stacks, final review): the root keeps its marked native `.claude/rules/<name>.md`
// while a set-aside child keeps the rule, so the child loads it through Claude Code's ancestor loading and nothing is written in
// the child. The file goes with the keep.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');
const nativeRules = require('./install/native-rules.js');
const { putWorkspace, readWorkspaceValues } = require('./workspace-fixture.js');

const RULE = 'angular-conventions';
const KEPT_LINE = `rule ${RULE}`;
const SELECTION = `skill markdown-style\nrule ${RULE}\n`;
const SCOPE = ['--scope', 'local'];
const DROP = [...SCOPE, '--installed-only', '--drop', KEPT_LINE];
const UPDATE = [...SCOPE, '--installed-only'];

const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const lineOf = (text, key) => ((new RegExp(`^${key}: ?(.*)$`, 'm').exec(text) || [])[1] ?? null);
function setAside(repo, keptFor)
{
    fs.mkdirSync(path.join(repo, 'api', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'api', '.claude', 'alfred-code.stamp'), 'seats-route: plugin\nown-picks: \n');
    putWorkspace(path.join(repo, 'api'), { parent: '..' });
    putWorkspace(repo, { children: ['api'], includeAsked: ['api'], keptFor });
}
const stateOf = (repo) =>
{
    const native = path.join(repo, '.claude', 'rules', `${RULE}.md`);
    return {
        native: fs.existsSync(native) && nativeRules.hasMarker(fs.readFileSync(native, 'utf8')),
        store: fs.existsSync(path.join(repo, '.alfred', 'stack', 'rules', `${RULE}.md`)),
        child: fs.existsSync(path.join(repo, 'api', '.claude', 'rules', `${RULE}.md`)),
        stamp: fs.readFileSync(stampOf(repo), 'utf8'),
        record: readWorkspaceValues(repo),
    };
};
const run = (args, each) => seedRun(['install', 'update', 'update'], SELECTION, { args: [SCOPE, ...args], each });

test('root: a kept rule keeps its marked native file and its store copy, a later run keeps both, and the child gets none', POSIX_ONLY, () =>
{
    const { outs, steps } = run([DROP, UPDATE], (repo, i) =>
    {
        if (i === 0) { assert.ok(stateOf(repo).native, 'the root writes its own pick natively'); setAside(repo, { api: [KEPT_LINE] }); }
        return stateOf(repo);
    });
    for (const i of [1, 2])
    {
        assert.ok(steps[i].store, outs[i]);
        assert.ok(steps[i].native, `run ${i} keeps the root's marked native file: ${outs[i]}`);
        assert.ok(!steps[i].child, 'nothing is written in the set-aside child');
        assert.strictEqual(lineOf(steps[i].stamp, 'kept-only'), `rule/${RULE}`);
    }
});

test('root: the native file of a kept rule goes once the child ignores the rule', POSIX_ONLY, () =>
{
    const { outs, steps } = run([DROP, UPDATE], (repo, i) =>
    {
        if (i === 0) setAside(repo, { api: [KEPT_LINE] });
        if (i === 1) putWorkspace(path.join(repo, 'api'), { parent: '..', ignore: { rule: [RULE] } });
        return stateOf(repo);
    });
    assert.ok(steps[1].native, outs[1]);
    assert.ok(!steps[2].native, outs[2]);
    assert.ok(!steps[2].store, outs[2]);
    assert.strictEqual(lineOf(steps[2].stamp, 'kept-only'), null);
});

test('root: the native file of a kept rule goes once the child is included again', POSIX_ONLY, () =>
{
    const { outs, steps } = run([DROP, UPDATE], (repo, i) =>
    {
        if (i === 0) setAside(repo, { api: [KEPT_LINE] });
        if (i === 1) putWorkspace(repo, { children: ['api'], includedChildren: ['api'], includeAsked: ['api'] });
        return stateOf(repo);
    });
    assert.ok(steps[1].native, outs[1]);
    assert.ok(!steps[2].native, outs[2]);
    assert.ok(!steps[2].store, outs[2]);
});

test('root: a run the store lock refused never prunes a rule store copy, even one a member picks while the child ignores it', POSIX_ONLY, () =>
{
    const lock = (repo) => path.join(repo, '.alfred', 'workspace.lock');
    const { outs, steps } = run([DROP, UPDATE], (repo, i) =>
    {
        if (i === 0) setAside(repo, { api: [KEPT_LINE] });
        if (i === 1)
        {
            fs.writeFileSync(path.join(repo, 'api', '.claude', 'alfred-code.stamp'), `seats-route: plugin\nown-picks: rule/${RULE}\n`);
            putWorkspace(path.join(repo, 'api'), { parent: '..', ignore: { rule: [RULE] } });
            fs.writeFileSync(lock(repo), String(process.pid));
        }
        return stateOf(repo);
    });
    assert.match(outs[2], /!! workspace: the store is locked/);
    assert.doesNotMatch(outs[2], /rule pruned \(no member below picks it now\)/, outs[2]);
    assert.ok(steps[2].store, `the store copy stays while the member picks it: ${outs[2]}`);
});

test('root: a rule store copy with no recorded hash stays when the keep ends, and the log says it has no record', POSIX_ONLY, () =>
{
    const { outs, steps } = run([DROP, UPDATE], (repo, i) =>
    {
        if (i === 0) setAside(repo, { api: [KEPT_LINE] });
        if (i === 1)
        {
            putWorkspace(path.join(repo, 'api'), { parent: '..', ignore: { rule: [RULE] } });
            const text = fs.readFileSync(stampOf(repo), 'utf8').replace(new RegExp(`(^library-rules: .*?)(^|,)${RULE}=[0-9a-f]+`, 'm'), '$1');
            fs.writeFileSync(stampOf(repo), text);
        }
        return stateOf(repo);
    });
    assert.ok(steps[2].store, outs[2]);
    assert.match(outs[2], /rule kept: angular-conventions\.md - no member below picks it now, but it has no recorded hash, so it stays/, outs[2]);
    assert.doesNotMatch(outs[2], /edited since the stack wrote it/);
});
