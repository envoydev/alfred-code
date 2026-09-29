'use strict';
// The release workflow ships two archives under BOTH names for the 2.x line, so a 1.x install's
// archive fallback (releases/latest/download/claude-stack.tar.gz, through GitHub's own repo // legacy-name
// redirect) does not 404 once the marketplace and plugin names move to alfred-code
// (task-5c, requirement 3). No test here reads scripts/*.js - this is the workflow TEXT itself,
// the one place the asset list is declared.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');

test('release workflow: gh release create names all four assets - both names, tar.gz and zip', () => {
    const start = WORKFLOW.indexOf('gh release create');
    assert.ok(start >= 0, 'no gh release create line found');
    const block = WORKFLOW.slice(start, WORKFLOW.indexOf('\n\n', start));
    for (const asset of ['alfred-code.tar.gz', 'alfred-code.zip', 'claude-stack.tar.gz', 'claude-stack.zip']) // legacy-name
        assert.ok(block.includes(asset), `gh release create does not name ${asset}`);
});

test('release workflow: the legacy assets are a COPY of the same bytes, not a second git archive', () => {
    const buildStart = WORKFLOW.indexOf('Build the source archives');
    assert.ok(buildStart >= 0, 'no "Build the source archives" step found');
    const buildBlock = WORKFLOW.slice(buildStart, WORKFLOW.indexOf('- name:', buildStart + 1));
    const archiveCalls = (buildBlock.match(/git archive --format/g) || []).length;
    assert.strictEqual(archiveCalls, 2, 'exactly two git archive calls - tar.gz and zip of the new name only, never a second git archive under the old name');
    assert.match(buildBlock, /cp\s+alfred-code\.tar\.gz\s+claude-stack\.tar\.gz/); // legacy-name
    assert.match(buildBlock, /cp\s+alfred-code\.zip\s+claude-stack\.zip/); // legacy-name
});

test('release workflow: a comment says why the legacy names ship and that they go when 2.x ends', () => {
    assert.match(WORKFLOW, /claude-stack\.(?:tar\.gz|zip).{0,400}(?:fallback|1\.x)/is, 'no comment naming the 1.x fallback the legacy assets serve'); // legacy-name
    assert.match(WORKFLOW, /(?:drop|remove|retire).{0,40}(?:2\.x ends|end of 2\.x)/i, 'no comment saying the legacy assets go when 2.x ends');
});

// M27: the recreate step deletes and re-creates v<version>, so a merge to main WITHOUT a version bump silently moved the
// tag, while an install already on that version never updates (a plugin version keeps users on it until it changes).
// A guard step before it fails the job when the tag exists at ANOTHER commit; the same commit (a re-run) passes, and
// only a manual run with replace_tag set moves it. The step's own shell runs here against a scratch origin.
const yaml = require('js-yaml');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

function guardStep()
{
    const doc = yaml.load(WORKFLOW);
    const steps = doc.jobs.release.steps;
    const at = steps.findIndex((s) => s && /Refuse a same-version re-release/.test(s.name || ''));
    const recreate = steps.findIndex((s) => s && /Recreate the release/.test(s.name || ''));
    return { doc, step: steps[at], at, recreate };
}

test('M27 release workflow: a guard step before the recreate refuses a tag that already names another commit', () => {
    const { doc, step, at, recreate } = guardStep();
    assert.ok(step, 'a guard step exists');
    assert.ok(at >= 0 && at < recreate, 'it runs before the step that deletes the tag');
    assert.strictEqual(step.env.VERSION, '${{ steps.ver.outputs.version }}');
    assert.strictEqual(step.env.REPLACE_TAG, "${{ inputs.replace_tag || 'false' }}", 'the manual override arrives through env, never spliced into run');
    const input = doc.on.workflow_dispatch.inputs.replace_tag;
    assert.strictEqual(input.type, 'boolean');
    assert.strictEqual(input.default, false);
    assert.strictEqual(doc.jobs.release.if, "github.ref == 'refs/heads/main'", 'a manual run releases main only');
});

test('M27 release workflow: the guard step itself - another commit fails, the same commit or no tag passes, replace_tag moves it', { skip: process.platform === 'win32' && 'bash' }, () => {
    const { step } = guardStep();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-guard-'));
    try
    {
        const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim();
        const origin = path.join(dir, 'origin.git');
        const work = path.join(dir, 'work');
        git(dir, 'init', '-q', '--bare', origin);
        git(dir, 'clone', '-q', origin, work);
        git(work, 'commit', '-q', '--allow-empty', '-m', 'a');
        const first = git(work, 'rev-parse', 'HEAD');
        git(work, 'tag', 'v9.9.9');
        git(work, 'tag', '-a', 'v8.8.8', '-m', 'annotated');
        git(work, 'push', '-q', 'origin', 'HEAD:main', '--tags');
        git(work, 'commit', '-q', '--allow-empty', '-m', 'b');
        const second = git(work, 'rev-parse', 'HEAD');
        const run = (version, sha, replace = 'false') => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
            cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, VERSION: version, GITHUB_SHA: sha, REPLACE_TAG: replace },
        });
        const moved = run('9.9.9', second);
        assert.strictEqual(moved.status, 1, moved.stdout + moved.stderr);
        assert.match(moved.stdout + moved.stderr, /v9\.9\.9 already names .* - bump the version/);
        assert.strictEqual(run('8.8.8', second).status, 1, 'an annotated tag is judged by the commit it names');
        assert.strictEqual(run('9.9.9', first).status, 0, 'a re-run of the same commit refreshes the assets');
        assert.strictEqual(run('8.8.8', first).status, 0, 'the annotated tag at the same commit too');
        assert.strictEqual(run('7.7.7', second).status, 0, 'a new version has no tag yet');
        const allowed = run('9.9.9', second, 'true');
        assert.strictEqual(allowed.status, 0, allowed.stderr);
        assert.match(allowed.stdout + allowed.stderr, /replace_tag/);
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
