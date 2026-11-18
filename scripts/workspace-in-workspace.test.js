'use strict';
// `workspace.inWorkspace`: the question the agents route switch asks before it refuses `--seats-route`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const workspace = require('./install/workspace.js');

const DATA_ROOT = '.alfred';
const SKILL = 'csharp';

function withProject(run)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'in-workspace-'));
    const projectRoot = path.join(dir, 'project');
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    try { return run({ dir, projectRoot, stampFile: path.join(projectRoot, '.claude', 'alfred-code.stamp') }); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const ask = ({ projectRoot, stampFile }) => workspace.inWorkspace({ projectRoot, stampFile, dataRoot: DATA_ROOT });

test('inWorkspace: a stamp whose links reach into another project\'s store, with no workspace record, is a workspace member', () =>
{
    withProject((where) =>
    {
        const store = path.join(where.dir, 'top', '.alfred', 'stack', 'skills', SKILL);
        fs.mkdirSync(store, { recursive: true });
        fs.mkdirSync(path.join(where.projectRoot, '.claude', 'skills'), { recursive: true });
        fs.symlinkSync(store, path.join(where.projectRoot, '.claude', 'skills', SKILL));
        fs.writeFileSync(where.stampFile, `sha: aaa111\nversion: 1.0.0\nlinks: skills/${SKILL}=symlink\n`);
        assert.equal(ask(where), true);
    });
});

test('inWorkspace: a stamp with member picks and no workspace record is a workspace top', () =>
{
    withProject((where) =>
    {
        fs.writeFileSync(where.stampFile, `sha: aaa111\nversion: 1.0.0\nmember-picks: skill/${SKILL}\n`);
        assert.equal(ask(where), true);
    });
});

test('inWorkspace: a garbage workspace.json and no links is no workspace, and nothing throws', () =>
{
    withProject((where) =>
    {
        fs.mkdirSync(path.join(where.projectRoot, DATA_ROOT), { recursive: true });
        fs.writeFileSync(path.join(where.projectRoot, DATA_ROOT, 'workspace.json'), '{ not json');
        fs.writeFileSync(where.stampFile, 'sha: aaa111\nversion: 1.0.0\n');
        assert.equal(ask(where), false);
    });
});
