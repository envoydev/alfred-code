'use strict';
// Usage audit 2026-10-11 (31 Windows sessions of a consuming project), the skills and agents track. One file for the
// track's pins, so the parallel apply branches never collide in a shared test file. Each block names its finding.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');

// ------------------------------------------------------------------ the index-safe review read (SD16, 42951e5b#3)

// 42951e5b: the review recipe `git add -N . && git diff HEAD; git reset -q`, run mid-merge, dropped MERGE_HEAD and the
// merge state was rebuilt by hand (387.0k). The checkpoint's two command blocks are RUN here over a resolved merge, an
// untracked source file and an untracked credential file, the second block through the secret guard as the harness
// would: MERGE_HEAD and the index come out as they went in, the new file's content is read, and the key stays masked.
test('the checkpoint review read keeps a merge and the index, reads a brand-new file, and the guard masks its key', { skip: process.platform === 'win32' && 'runs the read through sh' }, () =>
{
    const skill = read('stack/skills/habits-commit-checkpoint/SKILL.md');
    assert.doesNotMatch(skill, /reset chained into the SAME call/, 'the reset recipe is gone');
    assert.match(flat(skill), /Never `git add -N` and never `git reset` in a review or scope read/);
    assert.match(flat(skill), /never a loop or `xargs` over the list/);
    const blocks = [...(/Feed it the FULL change set([\s\S]*?)Name every file/.exec(skill) || ['', ''])[1].matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    assert.strictEqual(blocks.length, 2, 'the survey block and the per-file block');
    for (const b of blocks) assert.doesNotMatch(b, /add -N|reset|while|xargs/);
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-review-read-'));
    try
    {
        const git = (...a) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        git('init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
        git('add', '.');
        git('commit', '-qm', 'base');
        git('checkout', '-qb', 'other');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'other\n');
        git('commit', '-qam', 'other');
        git('checkout', '-q', 'main');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'main\n');
        git('commit', '-qam', 'main');
        try { git('merge', '-q', 'other'); } catch { /* the conflict is the point */ }
        fs.writeFileSync(path.join(repo, 'a.txt'), 'resolved\n');
        git('add', 'a.txt');
        fs.writeFileSync(path.join(repo, 'brand-new.txt'), 'NEW-FILE-BODY\n');
        const KEY = 'sk-' + 'ant-api03-' + 'Q'.repeat(80);
        fs.writeFileSync(path.join(repo, '.env'), `ANTHROPIC_API_KEY=${KEY}\n`);
        const mergeHead = path.join(repo, '.git', 'MERGE_HEAD');
        assert.ok(fs.existsSync(mergeHead), 'the fixture is mid-merge');
        const staged = git('diff', '--cached', '--name-status');
        const survey = execFileSync('sh', ['-c', blocks[0]], { cwd: repo, encoding: 'utf8' });
        assert.match(survey, /^\+resolved$/m, 'the tracked change is in the review');
        const listed = ['.env', 'brand-new.txt'];
        for (const f of listed) assert.match(survey, new RegExp(`^${f.replace('.', '\\.')}$`, 'm'), `the survey lists ${f}`);
        // The per-file block, built from the template over the listed files, then through the guard as the harness runs it.
        const unit = blocks[1].split(';')[0].trim();
        let command = listed.map((f) => unit.replace('<file-1>', f)).join('; ');
        const guard = spawnSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-secret-value.js')], { cwd: repo, encoding: 'utf8',
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, session_id: 'suite', cwd: repo }), env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
        assert.strictEqual(guard.status, 0, guard.stderr);
        const rewritten = ((JSON.parse(guard.stdout || '{}').hookSpecificOutput || {}).updatedInput || {}).command;
        assert.ok(rewritten, 'the guard sees the named credential file and rewrites the read');
        command = rewritten;
        const out = execFileSync('sh', ['-c', command], { cwd: repo, encoding: 'utf8' });
        assert.match(out, /^\+NEW-FILE-BODY$/m, 'the untracked file is in the review');
        assert.ok(!out.includes(KEY), 'the credential printed raw');
        assert.ok(fs.existsSync(mergeHead), 'the review read dropped MERGE_HEAD');
        assert.strictEqual(git('diff', '--cached', '--name-status'), staged, 'the review read moved the index');
        // The controls: a loop over the list prints the key past the guard, and the old recipe drops the merge.
        const loop = 'git ls-files -o --exclude-standard | while IFS= read -r f; do git diff --no-index -- /dev/null "$f"; done';
        const loopGuard = spawnSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-secret-value.js')], { cwd: repo, encoding: 'utf8',
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: loop }, session_id: 'suite', cwd: repo }), env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
        if (!JSON.parse(loopGuard.stdout || '{}').hookSpecificOutput && loopGuard.status === 0)
            assert.ok(spawnSync('sh', ['-c', loop], { cwd: repo, encoding: 'utf8' }).stdout.includes(KEY), 'control: an unseen loop prints the key');
        execFileSync('sh', ['-c', 'git add -N . && git diff HEAD >/dev/null; git reset -q'], { cwd: repo });
        assert.ok(!fs.existsSync(mergeHead), 'control: the reset recipe drops MERGE_HEAD');
    }
    finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ JSON on Windows (SD13 contract, the skill texts)

// Git for Windows ships no jq (e90a1845 and 177c5743 hit exit 127): a skill or seat that parses JSON says `node -e`.
// `gh ... --jq` is gh's own built-in filter and needs no jq binary. The three folders another track owns are left to it.
test('no skill or seat text runs a bare jq', () =>
{
    const OTHER_TRACK = new Set(['capture-agent-capabilities', 'capture-usage-report', 'habits-adjust-agents-md']);
    const files = [];
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.md$/.test(e.name)) files.push(p); } };
    for (const d of fs.readdirSync(path.join(ROOT, 'stack', 'skills'))) if (!OTHER_TRACK.has(d)) walk(path.join(ROOT, 'stack', 'skills', d));
    walk(path.join(ROOT, 'stack', 'agents'));
    const bare = /(?:^|[|;&(`]\s*|\$\(\s*)jq\b(?!uery)/m;
    const hits = files.filter((f) => bare.test(fs.readFileSync(f, 'utf8').replace(/--jq\b/g, '')));
    assert.deepStrictEqual(hits.map((f) => path.relative(ROOT, f)), []);
});

// ------------------------------------------------------------------ SD15 - task-solve's close and size

// The `ask` blocks of a text, as { question, options: [label] }.
const asksOf = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) =>
{
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.slice(1).map((l) => (/^- '(.*)'(?: - |$)/.exec(l) || [])[1]).filter(Boolean) };
});

// 42951e5b#9: the close ask left the unpushed commit out; the user typed 'commit both and push them' in Other.
test('42951e5b#9: an unpushed commit is its own close question, Hold first and recommended', () =>
{
    const solve = read('stack/skills/task-solve/SKILL.md');
    const push = asksOf(solve).find((a) => /is not pushed to <remote>/.test(a.question));
    assert.ok(push, 'the push question is a template');
    assert.deepStrictEqual(push.options, ['Hold - push later (Recommended)', 'Push now']);
    assert.match(push.question, /merge <A> before <B> - why/, 'several branches name the merge order');
    assert.match(flat(solve), /An unpushed commit is its own question too/);
});

// 42951e5b#10: a documented test command proved wrong (6 false reds without a platform flag) had no close-out route.
test('42951e5b#10: a command the cycle proved wrong is doc drift, named against AGENTS.md or the run book', () =>
{
    const mech = flat(read('stack/skills/task-solve/references/step-mechanics.md'));
    assert.match(mech, /A build, test or run command this cycle proved wrong[^.]*is doc drift too/);
    assert.match(mech, /names the AGENTS\.md line or the run-book section \(`<docs-path>\/project-capabilities\/PROJECT-CAPABILITIES\.md`\)/);
});

// 5984019e#2 / #3: a small run grew to 10 files and closed with no review; the re-check is a script line, the review a receipt.
test('5984019e#2 #3: a trivial or small close re-checks its size by script and carries its review receipt', () =>
{
    const solve = flat(read('stack/skills/task-solve/SKILL.md'));
    assert.match(solve, /The size can be raised mid-run, never lowered - re-checked before a trivial or small close \(`references\/full-spec\.md`\); a small close's `Result:` carries `review: <reviewer> - <its verdict>`/);
    const spec = flat(read('stack/skills/task-solve/references/full-spec.md'));
    assert.match(spec, /`node "\$SPEC" --touched <trivial\|small>`/);
    assert.match(spec, /On `raise to standard` the size rises where the run stands/);
    const body = read('stack/skills/task-solve/SKILL.md').replace(/^---\n[\s\S]*?\n---\n/, '');
    assert.ok(body.length < 17700, `the body stays under its cap: ${body.length}`);
});
