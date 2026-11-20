'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { snapshotSessionError } = require('./install/run-session.js');
const { realLong } = require('./test-paths.js');

const INSTALLER = path.join(__dirname, 'install', 'alfred-code.js');
const SUITE_TMP = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'run-session-')));
test.after(() => fs.rmSync(SUITE_TMP, { recursive: true, force: true }));

test('snapshotSessionError: no file, a blank file or an unset variable goes on', () =>
{
    assert.equal(snapshotSessionError('/d/repo', null, 's2'), null);
    assert.equal(snapshotSessionError('/d/repo', '', 's2'), null);
    assert.equal(snapshotSessionError('/d/repo', ' \n', 's2'), null);
    assert.equal(snapshotSessionError('/d/repo', 's1\n', ''), null);
    assert.equal(snapshotSessionError('/d/repo', 's1\n', undefined), null);
});

test('snapshotSessionError: the same session goes on', () =>
{
    assert.equal(snapshotSessionError('/d/repo', 's1\n', 's1'), null);
});

test('snapshotSessionError: another session is refused with the one error line', () =>
{
    assert.equal(
        snapshotSessionError('/d/repo', 's1\n', 's2'),
        'error: --source /d/repo is another session\'s snapshot - run the resolve block again',
    );
});

function setup(name, runSession)
{
    const base = realLong(fs.mkdtempSync(path.join(SUITE_TMP, `${name}-`)));
    const runDir = path.join(base, 'alfred-code.AbC123');
    const project = path.join(base, 'project');
    const home = path.join(base, 'home');
    for (const dir of [path.join(runDir, 'repo'), project, home]) fs.mkdirSync(dir, { recursive: true });
    if (runSession !== null) fs.writeFileSync(path.join(runDir, 'run-session'), runSession);
    return { runDir, project, home };
}

function runInstaller({ runDir, project, home }, sessionId)
{
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: path.dirname(process.execPath) };
    delete env.CLAUDE_CONFIG_DIR;
    delete env.CLAUDE_CODE_SESSION_ID;
    if (sessionId) env.CLAUDE_CODE_SESSION_ID = sessionId;
    return spawnSync(process.execPath, [INSTALLER, 'update', '--source', path.join(runDir, 'repo')], { cwd: project, env, encoding: 'utf8' });
}

test('the installer refuses a --source whose run-session is another session\'s, before any write', () =>
{
    const dirs = setup('other', 's1\n');
    const result = runInstaller(dirs, 's2');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`error: --source ${path.join(dirs.runDir, 'repo')} is another session's snapshot - run the resolve block again`), result.stderr);
    assert.equal(fs.existsSync(path.join(dirs.project, '.claude')), false, 'nothing was written under the project');
});

test('the installer goes past the check with no run-session file, a matching one or no session variable', () =>
{
    const marker = 'is another session\'s snapshot';
    for (const [name, text, sessionId] of [['none', null, 's2'], ['same', 's2\n', 's2'], ['unset', 's1\n', '']])
    {
        const result = runInstaller(setup(name, text), sessionId);
        assert.equal(result.stderr.includes(marker), false, `${name}: ${result.stderr}`);
        assert.equal(result.stdout.includes(marker), false, `${name}: ${result.stdout}`);
    }
});
