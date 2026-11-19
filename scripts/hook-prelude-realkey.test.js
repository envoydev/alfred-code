'use strict';
const test = require('node:test');
const SUITE = require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { realLong } = require('./test-paths.js');

const PRELUDE_SOURCE = path.join(__dirname, '..', 'stack', 'hooks', 'hook-prelude.js');
const PROJECT_FOLDER = 'proj';
const SPELLED_UPPER = PROJECT_FOLDER.toUpperCase();

// hook-prelude.js alone in a folder, so its `require('./layout.js')` fails and realKey takes the no-layout fallback.
function preludeWithoutLayout()
{
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-nolayout-'));
    fs.copyFileSync(PRELUDE_SOURCE, path.join(folder, 'hook-prelude.js'));
    return { folder, prelude: require(path.join(folder, 'hook-prelude.js')) };
}

const caseInsensitiveDisk = (probe) => fs.existsSync(path.join(probe, SPELLED_UPPER));

test('the no-layout fallback folds case as the disk does: a case-different spelling of the project is inside', (t) =>
{
    const base = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-case-')));
    const { folder, prelude } = preludeWithoutLayout();
    t.after(() =>
    {
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(folder, { recursive: true, force: true });
    });
    const project = path.join(base, PROJECT_FOLDER);
    const inside = path.join(project, 'sub');
    fs.mkdirSync(inside, { recursive: true });
    if (!caseInsensitiveDisk(base))
    {
        t.skip('this disk is case-sensitive: a case-different spelling names another folder, so there is nothing to fold');
        return;
    }
    assert.strictEqual(prelude.leavesProject(inside, path.join(base, SPELLED_UPPER)), false, 'the project spelled in another case still holds the folder');
    assert.strictEqual(prelude.leavesProject(inside, project), false, 'the same spelling holds it too');
});

test('the no-layout fallback still reads a folder behind a link that leaves the project as outside', (t) =>
{
    const base = realLong(fs.mkdtempSync(path.join(os.tmpdir(), 'prelude-link-')));
    const { folder, prelude } = preludeWithoutLayout();
    t.after(() =>
    {
        fs.rmSync(base, { recursive: true, force: true });
        fs.rmSync(folder, { recursive: true, force: true });
    });
    const project = path.join(base, PROJECT_FOLDER);
    const elsewhere = path.join(base, 'elsewhere');
    fs.mkdirSync(project);
    fs.mkdirSync(elsewhere);
    try { fs.symlinkSync(elsewhere, path.join(project, 'sessions'), 'junction'); }
    catch { t.skip('this host cannot create a link'); return; }
    assert.strictEqual(prelude.leavesProject(path.join(project, 'sessions'), project), true);
});
