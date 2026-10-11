'use strict';
// Usage audit 2026-10-11 (31 Windows sessions of a consuming project), the skills and agents track. One file for the
// track's pins, so the parallel apply branches never collide in a shared test file. Each block names its finding.
const test = require('node:test');
require('./hook-test-env').isolateHookSuite({ ownTmp: true });
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

// ------------------------------------------------------------------ SD15 - the upgrade gate and the execution verdict

// 2ca8e8ee#1: 'The staged plan is ready ... Execute it stage by stage?' fired with no text block since the plan was built -
// the user approved blind. 2ca8e8ee#2: the run then dropped every seat on its own call ('the stages share csproj files').
test('2ca8e8ee#1 #2: the upgrade gate follows a printed plan and offers the in-session mode, never drops seats alone', () =>
{
    const up = read('stack/skills/task-version-upgrade/SKILL.md');
    assert.match(flat(up), /PRINT the staged plan in the chat first - every stage with its edits, its verification command and its rollback point - in the same turn as the gate/);
    const gates = asksOf(up).filter((a) => /^The staged plan above/.test(a.question));
    assert.strictEqual(gates.length, 2, 'both gate templates say the plan is above');
    assert.ok(!asksOf(up).some((a) => /^The staged plan is ready:/.test(a.question)), 'no gate over an unshown plan');
    assert.deepStrictEqual(gates[0].options, ['Approve - execute through the seats (Recommended)', 'Approve - execute in this session', 'Just the plan', 'Stop - changes needed']);
    assert.match(flat(up), /The mark moves to 'in this session' when the verdict reads `serial`; the run never drops the seats on its own call/);
    assert.match(flat(up), /Load `habits-execution-strategy` \(the Skill tool\); its `Execution:` line is the mode reason/);
    const strat = flat(read('stack/skills/habits-execution-strategy/SKILL.md'));
    assert.match(strat, /Inside a flow that owns dispatch - the solve flows, the diagnose flow, the version-upgrade flow -/);
    assert.match(strat, /the flow's seats stand until the user picks in-session there/);
});

// 42951e5b#2: the plan audit applied a 'non-judgment' fix that dropped a correct `-p:Platform=x86` from the test
// command, hedged 'if the project lacks that configuration, say so', with no read of the test project: 6 false reds.
test('42951e5b#2: a command-changing fix lands only with its proof quoted; a hedged one is an unverified finding', () =>
{
    const vp = flat(read('stack/skills/task-verify-plan/SKILL.md'));
    assert.match(vp, /Nor is a fix that changes a build, test or acceptance COMMAND \(a flag, a configuration, a project path\) unless the run or read that proves the new form is quoted in the `Gated` block/);
    assert.match(vp, /a fix hedged on an assumption \('if the project lacks that configuration, say so'\) is a finding marked `unverified`, left in the plan as written for the build to prove, never applied in-step/);
});

// 5984019e#7: 'Redo passes in full-suite order' rested on `grep ... | head -8` of 39 failure names; the other 31 were
// never read, and 'the other 37 are the extension going silent' had no log check.
test('5984019e#7: a per-test claim quotes that test\'s own log line, and a head of the list proves only what it printed', () =>
{
    const gate = flat(read('stack/skills/habits-done-gate/SKILL.md'));
    assert.match(gate, /A claim about a NAMED test inside a run \('X passes in full-suite order', 'the other 37 fail for Y'\) quotes that test's own line from the run's saved log, found by its name/);
    assert.match(gate, /a `head` of it proves the lines it printed and nothing past them/);
    assert.match(gate, /A claim about a named test, or about all the failures, resting on a `head` of the log that never printed it\./);
});

// 177c5743#5: 31 documentation plans adapted the code-only task card on their own.
test('177c5743#5: a documentation plan has its own card - target, change, evidence, verification', () =>
{
    const pw = read('stack/skills/habits-plan-writing/SKILL.md');
    const card = (/A documentation plan[\s\S]*?```text\n([\s\S]*?)```/.exec(pw) || [])[1] || '';
    assert.deepStrictEqual([...card.matchAll(/^- (\w+):/gm)].map((m) => m[1]), ['status', 'target', 'change', 'evidence', 'verification']);
    assert.match(flat(pw), /four fields in place of `files`, `anchors`, `traps`, `test`, `acceptance` and `log_points`/);
});

// ------------------------------------------------------------------ SD15 - the related-projects capture

// d9035363#3: the seats stamped the sibling's branch@sha against their agent file (the brief asked for it) and ran 12
// read-only git calls; the prior doc's missing sibling sha forced a date-based drift reconstruction (5 Bash calls).
test('d9035363#3: the analyzer stamps the sibling\'s read_at and may read its git history, never mutate it', () =>
{
    const seat = flat(read('stack/agents/related-project-analyzer.md'));
    assert.match(seat, /`Bash` reaches it only through READ-ONLY git - `git -C <sibling> rev-parse \| log \| diff \| ls-files \| show`/);
    assert.match(seat, /\*\*Bash does nothing else\*\*: the read-only git above, the clone and its `rm -rf <scratch>\/<name>` cleanup/);
    assert.match(seat, /no checkout, fetch, pull, reset or stash/);
    assert.match(seat, /read_at: <sibling branch>@<short sha> \| n\/a - not a git checkout/);
    assert.match(seat, /the house schema minus `captured:` \(the caller stamps that per entry at merge, from the host's branch and sha - never you\)/, 'captured: stays the host stamp');
    const shapes = flat(read('stack/skills/capture-related-projects/references/artifact-shapes.md'));
    assert.match(shapes, /read_at: main@9f8e7d6 captured: develop@a1b2c3d, 2026-07-24/);
    assert.match(shapes, /`read_at:` is the other side's provenance: the SIBLING's own `<branch>@<short-sha>`/);
    const skill = flat(read('stack/skills/capture-related-projects/SKILL.md'));
    assert.match(skill, /the `read_at:` its entry already carries in the doc \(a re-capture starts from what changed since\)/);
});

// d9035363#4: the skill said apply markdown-style to the doc; the markdown-docs rule says the generated docs root takes no load.
test('d9035363#4: the related-projects doc loads no formatting skill - its shape is fixed in artifact-shapes.md', () =>
{
    const skill = read('stack/skills/capture-related-projects/SKILL.md');
    assert.doesNotMatch(skill, /markdown-style/);
    assert.match(flat(skill), /a quick reference whose shape is fixed verbatim in `references\/artifact-shapes\.md` - no formatting skill loads for it/);
});

// ------------------------------------------------------------------ SD09 - the architecture capture's zero-drift exit

// d9035363#1 (residual of 19a0571f): an older release's rule named `.alfred/docs/architecture/ASSESSMENT.md`, a doc
// that had moved, and survived two capture runs that exited at zero drift with 'no rule regeneration'. The exit's own
// grep is RUN here over that rule and over the current template: the old rule hits, the template does not.
test('d9035363#1: the zero-drift exit greps its generated rule for a path and rewrites that rule alone', { skip: process.platform === 'win32' && 'runs the check through sh' }, () =>
{
    const skill = read('stack/skills/capture-architecture/SKILL.md');
    const cmd = (/check the one file the docs' own drift cannot show, the generated rule: `([^`]+)`/.exec(skill) || [])[1];
    assert.ok(cmd, 'the exit names its check command');
    assert.match(flat(skill), /rewrite that rule alone to its template in `references\/doc-shapes\.md` \(the one load this exit takes\) and add `rule regenerated - <the hit, or absent>`/);
    assert.doesNotMatch(skill, /no write, no rule regeneration/);
    const template = (/## \.claude\/rules\/alfred-project-architecture\.md[\s\S]*?```markdown\n([\s\S]*?)```/.exec(read('stack/skills/capture-architecture/references/doc-shapes.md')) || [])[1];
    assert.ok(template, 'doc-shapes carries the rule template');
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-arch-rule-'));
    try
    {
        fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
        const rule = path.join(repo, '.claude', 'rules', 'alfred-project-architecture.md');
        const runCheck = () => require('node:child_process').spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
        fs.writeFileSync(rule, '# Architecture\r\n\r\nRead `.alfred/docs/architecture/ARCHITECTURE.md`; the findings are in `.alfred/docs/architecture/ASSESSMENT.md`.\r\n');
        const old = runCheck();
        assert.strictEqual(old.status, 0, 'an older, path-bearing rule is a hit');
        assert.match(old.stdout, /ASSESSMENT\.md/);
        fs.writeFileSync(rule, template);
        assert.strictEqual(runCheck().status, 1, 'the current template names no path - no hit');
        fs.rmSync(rule);
        assert.strictEqual(runCheck().status, 2, 'an absent rule is its own signal');
    }
    finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

// 177c5743#4: 29 fork seats spent ~61.6M of ~69.2M input tokens re-reading the parent; seats $20.44 against main $17.73.
test('177c5743#4: the mode choice prices a fork against a briefed seat', () =>
{
    const strat = flat(read('stack/skills/habits-execution-strategy/SKILL.md'));
    assert.match(strat, /\*\*A fork or a briefed seat\*\* - a fork starts from this whole conversation and re-sends it on every turn it takes/);
    assert.match(strat, /Past the install's fresh-session trigger, brief a named or Explore seat; fork only a seat that needs this conversation's own state/);
    assert.match(strat, /A fork dispatched past the fresh-session trigger for a unit a brief could carry\./);
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
