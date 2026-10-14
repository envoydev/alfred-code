'use strict';
// The release workflow ships the two alfred-code archives - the workflow TEXT itself, the one place
// the asset list is declared.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');

test('release workflow: gh release create names exactly the two archives, tar.gz and zip', () => {
    const start = WORKFLOW.indexOf('gh release create');
    assert.ok(start >= 0, 'no gh release create line found');
    const block = WORKFLOW.slice(start, WORKFLOW.indexOf('\n\n', start));
    const assets = block.slice(block.lastIndexOf(' -- ') + 4).trim().split(/\s+/);
    assert.deepStrictEqual(assets, ['alfred-code.tar.gz', 'alfred-code.zip']);
});

test('release workflow: one git archive per format, no copy under a second name', () => {
    const buildStart = WORKFLOW.indexOf('Build the source archives');
    assert.ok(buildStart >= 0, 'no "Build the source archives" step found');
    const buildBlock = WORKFLOW.slice(buildStart, WORKFLOW.indexOf('- name:', buildStart + 1));
    assert.strictEqual((buildBlock.match(/git archive --format/g) || []).length, 2);
    assert.doesNotMatch(buildBlock, /^\s*cp\s/m);
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

// One tree, one test run: ci.yml and lint.yml no longer run on a push to main (the merge carries the tree develop
// already ran them on - 2.4.0 ran the same tree twice, 14 minutes each, and released before the second ended), so
// the release itself requires a green run of each on the tree it ships.
const workflowDoc = (name) => yaml.load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8'));

function treeStep()
{
    const steps = yaml.load(WORKFLOW).jobs.release.steps;
    const at = steps.findIndex((s) => s && /Require a green test and lint run/.test(s.name || ''));
    return { steps, at, step: steps[at] };
}

test('release workflow: it requires a green test and lint run of its tree before it builds, and CI skips main for it', () => {
    const doc = yaml.load(WORKFLOW);
    const { steps, at, step } = treeStep();
    assert.ok(step, 'a tested-tree step exists');
    assert.ok(at < steps.findIndex((s) => s && /Build the source archives/.test(s.name || '')), 'it runs before the archives are built');
    assert.strictEqual(steps[0].with['fetch-depth'], 2, 'the parents are fetched, so their trees compare');
    assert.strictEqual(doc.permissions.actions, 'read', 'the step reads the runs of this tree');
    for (const wf of ['ci.yml', 'lint.yml'])
    {
        const on = workflowDoc(wf).on;
        assert.deepStrictEqual(on.push, { 'branches-ignore': ['main'] }, `${wf} runs on every push but main's`);
        assert.ok('workflow_dispatch' in on, `${wf} can be run on main by hand, for a tree no branch ran`);
        assert.ok(step.run.includes(`for wf in ci.yml lint.yml`), `the step asks for ${wf} by its file name`);
    }
});

test('release workflow: the tested-tree step - the merged tip\'s green runs pass, a red, absent or other-tree run fails, a running one is waited on', { skip: process.platform === 'win32' && 'bash' }, () => {
    const { step } = treeStep();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tree-'));
    try
    {
        const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd: work, encoding: 'utf8' }).trim();
        const work = path.join(dir, 'work');
        fs.mkdirSync(work);
        git('init', '-q');
        fs.writeFileSync(path.join(work, 'f'), 'a\n');
        git('add', 'f');
        git('commit', '-qm', 'a');
        const a = git('rev-parse', 'HEAD');
        git('checkout', '-qb', 'develop');
        fs.writeFileSync(path.join(work, 'f'), 'b\n');
        git('commit', '-qam', 'b');
        const b = git('rev-parse', 'HEAD');
        git('checkout', '-q', 'main');
        git('merge', '-q', '--no-ff', '-m', 'merge', 'develop');
        const merge = git('rev-parse', 'HEAD');
        // A stub gh: the state of each workflow's runs per commit, from RUNS ('<sha> <wf>' -> states, one per call, the last one sticking).
        const bin = path.join(dir, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const sha = /head_sha=([0-9a-f]+)/.exec(process.argv[3])[1];
const wf = /workflows\\/([\\w.]+)/.exec(process.argv[5])[1];
const key = sha + ' ' + wf;
const seen = process.env.CALLS + '/' + key.replace(' ', '-');
const n = fs.existsSync(seen) ? Number(fs.readFileSync(seen, 'utf8')) : 0;
fs.writeFileSync(seen, String(n + 1));
const states = JSON.parse(process.env.RUNS)[key] || [];
if (states.length) console.log(states[Math.min(n, states.length - 1)]);
`, { mode: 0o755 });
        const run = (runs, extra = {}) =>
        {
            const calls = fs.mkdtempSync(path.join(dir, 'calls-'));
            const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
                cwd: work, encoding: 'utf8',
                env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir, GITHUB_REPOSITORY: 'o/r', CALLS: calls, RUNS: JSON.stringify(runs), WAIT_MINUTES: '40', POLL_SECONDS: '0', ...extra },
            });
            return { status: r.status, out: r.stdout + r.stderr };
        };
        const green = (sha) => ({ [`${sha} ci.yml`]: ['green'], [`${sha} lint.yml`]: ['green'] });

        let r = run(green(b));
        assert.strictEqual(r.status, 0, r.out);
        assert.match(r.out, /ci\.yml: green on this tree[\s\S]*lint\.yml: green on this tree/);
        assert.strictEqual(run(green(merge)).status, 0, 'a run on main itself (workflow_dispatch) counts');
        r = run({ ...green(b), [`${b} ci.yml`]: ['red'] });
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.out, /no green ci\.yml run for this tree/);
        assert.strictEqual(run({ ...green(b), [`${b} ci.yml`]: ['red', 'green'] }).status, 1, 'a red run is no wait');
        r = run({ [`${b} ci.yml`]: ['green'] });
        assert.strictEqual(r.status, 1, 'lint must pass too');
        assert.match(r.out, /no green lint\.yml run/);
        assert.strictEqual(run(green(a)).status, 1, 'the old main parent ran another tree');
        assert.strictEqual(run({}).status, 1, 'no run at all');
        r = run({ ...green(b), [`${b} ci.yml`]: ['running', 'running', 'green'] });
        assert.strictEqual(r.status, 0, r.out);
        assert.strictEqual((r.out.match(/ci\.yml: running on this tree - waiting/g) || []).length, 2, 'it polls until the run ends');
        r = run({ ...green(b), [`${b} ci.yml`]: ['running'] }, { WAIT_MINUTES: '0' });
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.out, /ci\.yml is still running on this tree after 0 minutes/);
        assert.strictEqual(run({ ...green(b), [`${b} ci.yml`]: ['red'], [`${merge} ci.yml`]: ['green'] }).status, 0, 'any green run of the tree is enough');

        // A merge that resolved something carries a tree neither parent ran: only a run on it counts.
        git('checkout', '-q', 'develop');
        fs.writeFileSync(path.join(work, 'g'), 'c\n');
        git('add', 'g');
        git('commit', '-qm', 'c');
        const c = git('rev-parse', 'HEAD');
        git('checkout', '-q', 'main');
        git('merge', '-q', '--no-ff', '--no-commit', 'develop');
        fs.writeFileSync(path.join(work, 'f'), 'resolved\n');
        git('commit', '-qam', 'merge with a fix');
        const fixed = git('rev-parse', 'HEAD');
        r = run({ ...green(c), ...green(merge) });
        assert.strictEqual(r.status, 1, r.out);
        assert.match(r.out, new RegExp(`no green ci\\.yml run for this tree \\(${fixed}\\)`), 'it names the one commit that carries the tree');
        assert.strictEqual(run(green(fixed)).status, 0, 'a run on the merge itself passes it');
    }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
