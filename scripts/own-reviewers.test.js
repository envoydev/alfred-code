'use strict';
// The stack's own reviewers (the user's ruling of 2026-10-22: 'I want use our reviewers, not from claude code. You are
// only allowed to take the useful data from them but use ours!'). /review-code and /review-security carry the method
// borrowed from Claude Code's bundled reviews as inline passes; every shipped text points at them, never at the built-ins.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const description = (text) =>
{
    const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
    const line = block && /^description:\s*"?(.*?)"?\s*$/m.exec(block[1]);
    return line ? line[1] : '';
};
// The ask templates in a body: each fenced `ask` block's option labels, in order.
const askOptions = (text) => [...text.matchAll(/```ask\n([\s\S]*?)```/g)].map((m) => m[1].split('\n').filter((l) => /^- '/.test(l)).map((l) => /^- '(.*)' - /.exec(l)[1]));
// The bounded target read both reviews share: the checkpoint's way, every untracked file through --no-index, nothing
// that moves the index.
function boundedRead(rel)
{
    const text = read(rel);
    for (const s of ['git diff HEAD', 'git ls-files -o --exclude-standard', 'git diff --no-index -- /dev/null', '|| true', 'gh pr diff'])
        assert.ok(text.includes(s), `${rel} names ${s}`);
    assert.match(squash(text), /never an unbounded whole-branch read/i, `${rel} keeps the read bounded`);
    for (const word of ['git add -N', 'git reset', 'xargs'])
        for (const line of text.split('\n').filter((l) => l.includes(word)))
            assert.match(line, /\bnever\b/i, `${rel}: '${word}' appears only in a never line - ${line}`);
}

test('review-code: description fits 15c and names its triggers', () =>
{
    const text = read('stack/skills/review-code/SKILL.md');
    assert.match(text, /^---\nname: review-code\n/);
    const d = description(text);
    assert.ok(d.length > 0 && d.length <= 160, `${d.length} chars`);
    assert.match(d, /^Use when/);
    assert.match(d, /review/);
});

test('review-code: reads the change set the bounded way, and every target form', () =>
{
    boundedRead('stack/skills/review-code/SKILL.md');
    assert.match(read('stack/skills/review-code/SKILL.md'), /\.\.\./, 'a branch is read against its base');
});

test('review-code: eight passes in order, and the refute pass', () =>
{
    const text = read('stack/skills/review-code/references/passes.md');
    const passes = (text.split(/^## Passes\s*$/m)[1] || '').split(/^## /m)[0];
    const firsts = [...passes.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => [Number(m[1]), m[2]]);
    const want = ['Each touched function', 'Removed behaviour', 'Callers and callees', 'Stack pitfalls', 'Wrapper', 'Altitude', 'Reuse', 'Conventions'];
    assert.deepEqual(firsts.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7, 8]);
    firsts.forEach(([, title], i) => assert.ok(title.startsWith(want[i]), `pass ${i + 1} opens '${want[i]}': ${title}`));
    const refute = squash(text.split(/^## Refute pass\s*$/m)[1] || '');
    for (const s of ['CONFIRMED', 'PLAUSIBLE', 'REFUTED', 'quoted line']) assert.ok(refute.includes(s), `the refute pass names ${s}`);
});

test('review-code: depth levels', () =>
{
    const text = squash(read('stack/skills/review-code/SKILL.md'));
    for (const s of ['--depth', '`quick`', '`standard`', '`deep`', 'gap sweep']) assert.ok(text.includes(s), s);
    assert.match(text, /`standard`[^.]*default/, 'standard is the default');
});

test('review-code: report, no fixes, and a marked close ask', () =>
{
    const text = read('stack/skills/review-code/SKILL.md');
    assert.ok(text.includes('file:line | summary | failure scenario | category | verdict'), 'the report table');
    const flat = squash(text);
    for (const s of ['no cap', 'no padding', 'fixes nothing']) assert.ok(flat.includes(s), s);
    const asks = askOptions(text);
    assert.ok(asks.length >= 1, 'an ask template');
    assert.equal(asks[asks.length - 1][0], 'Fix the confirmed ones (Recommended)');
});

// Final review 2026-10-22, the deferred minors the user asked to fix.
test('review-code: a Findings line by severity, the order defined, as the checkpoint receipt copies it', () =>
{
    const report = squash((read('stack/skills/review-code/SKILL.md').split(/^## Report\s*$/m)[1] || '').split(/^## /m)[0]);
    assert.ok(report.includes('`Findings: <n> BLOCKER, <m> MATERIAL, <k> MINOR`'), 'the Findings line');
    for (const s of ['BLOCKER is', 'MATERIAL is', 'MINOR is']) assert.ok(report.includes(s), `${s} defined`);
    assert.doesNotMatch(report, /most severe first, correctness before cleanup:/, 'the order is defined, not only named');
});

test('review-code: pass 8 says which --diff to run for each target', () =>
{
    const p8 = squash((/^8\. \*\*Conventions\.\*\*.*$/m.exec(read('stack/skills/review-code/references/passes.md')) || [''])[0]);
    assert.ok(p8.includes('a bare `--diff` for the change set or a path'), p8);
    assert.ok(p8.includes('`--diff <base>` for a branch or pull request'), p8);
});

test('review-code: quick depth reads the touched functions, never hunks only', () =>
{
    const quick = (/^- `quick` - .*$/m.exec(read('stack/skills/review-code/SKILL.md')) || [''])[0];
    assert.doesNotMatch(quick, /hunks only/, quick);
    assert.match(quick, /touched functions/);
});

test('review-security: the close names findings, the receipt\'s N is the target, and one over-clause', () =>
{
    const text = read('stack/skills/review-security/SKILL.md');
    const asks = askOptions(text);
    assert.equal(asks[asks.length - 1][0], 'Fix the findings (Recommended)', 'no CONFIRMED wording review-security never defines');
    const receipt = squash((text.split(/^## Receipt\s*$/m)[1] || '').split(/^## /m)[0]);
    assert.ok(receipt.includes('`<N>` is the target\'s file list'), receipt);
    assert.ok(receipt.includes('without the over-clause'), 'the checkpoint hands receipt.js the verdict alone');
});

test('security-auditor: tabnabbing follows not-a-finding.md', () =>
{
    const line = read('stack/agents/security-auditor.md').split('\n').find((l) => /target=_blank/.test(l)) || '';
    assert.match(line, /only with a concrete impact[^.]*not-a-finding\.md/, line);
});

test('review-code: the seat offer and the solve flows', () =>
{
    const text = squash(read('stack/skills/review-code/SKILL.md'));
    for (const s of ['600 changed lines', '<stack>-verifier', 'explicit-only']) assert.ok(text.includes(s), s);
});

// Final review 2026-10-22, I4: verifiers exist for ten stacks and are no always-installed seat, so a 'Dispatch the seat
// (Recommended)' over plain TypeScript or Python named a seat the roster lacks - and auto-mode takes the marked option.
test('review-code: offers a verifier seat only where the roster lists one', () =>
{
    const dispatch = squash((read('stack/skills/review-code/SKILL.md').split(/^## Dispatch\s*$/m)[1] || '').split(/^## /m)[0]);
    assert.ok(dispatch.includes('and the roster lists a `<stack>-verifier` for every touched stack'), dispatch);
    assert.match(dispatch, /Otherwise[^.]*run inline without asking/, 'no seat, no ask');
});

// Final review 2026-10-22, I3: a branch diffed against its own upstream holds the same commits and reviews nothing;
// a branch or PR not checked out was judged against the checkout's code; and the seat bar always counted the change set.
test('both reviews: a branch or PR is compared with the default branch, read at its head and counted from its own diff', () =>
{
    const section = (text, name) => squash((text.split(new RegExp(`^## ${name}\\s*$`, 'm'))[1] || '').split(/^## /m)[0]);
    for (const rel of ['stack/skills/review-code/SKILL.md', 'stack/skills/review-security/SKILL.md'])
    {
        const text = read(rel);
        const target = section(text, 'Target');
        assert.doesNotMatch(target, /@\{upstream\}/, `${rel}: never the branch's own upstream as the base`);
        assert.ok(target.includes('git symbolic-ref --short refs/remotes/origin/HEAD'), `${rel}: the remote's default branch`);
        assert.ok(target.includes('git show <head>:<path>'), `${rel}: a target not checked out is read at its head`);
        // a change request is read with plain git first, on every forge; the forge tool only where no such ref exists
        for (const s of ['git fetch <remote> refs/pull/<n>/head', 'refs/merge-requests/<n>/head', 'git rev-parse FETCH_HEAD', 'gh pr view <n> --json headRefOid'])
            assert.ok(target.includes(s), `${rel}: a change request's head - ${s}`);
        const dispatch = section(text, 'Dispatch');
        for (const s of ['git diff --shortstat <base>...<branch>', 'git diff --shortstat <base>...<head>', 'gh pr view <n> --json additions,deletions'])
            assert.ok(dispatch.includes(s), `${rel}: the count reads the target's own diff - ${s}`);
    }
    assert.ok(squash(read('stack/skills/review-code/references/passes.md')).includes('git show <head>:<path>'), 'the passes read at the head too');
});

// Final review 2026-10-22, I2: the change-set read took every file `git ls-files -o` lists, the ones untracked before
// the change began too (pilot 3: ~150 harness files), and neither review took a list of paths, so the checkpoint could
// not hand over the session's own - and the security count then no longer matched `spec:`.
test('both reviews: files untracked before the change began stay out, and the checkpoint hands over its paths', () =>
{
    const section = (text, name) => squash((text.split(new RegExp(`^## ${name}\\s*$`, 'm'))[1] || '').split(/^## /m)[0]);
    for (const rel of ['stack/skills/review-code/SKILL.md', 'stack/skills/review-security/SKILL.md'])
    {
        const target = section(read(rel), 'Target');
        assert.ok(target.includes('minus the paths in `<data root>/state/sessions/untracked-at-start-<HEAD sha>`'), `${rel}: the start record is subtracted`);
        assert.ok(target.includes('**One or more paths.**') && target.includes('git diff HEAD -- <path-1> <path-2>'), `${rel}: several paths are one target`);
        assert.ok(target.includes('a path named here is in scope even when the start record lists it'), `${rel}: a named path wins`);
    }
    const cp = squash(read('stack/skills/habits-commit-checkpoint/SKILL.md'));
    assert.ok(cp.includes('else `review-code` over the paths this commit takes in'), 'step 2 hands review-code the commit paths');
    assert.ok(cp.includes('load `review-security` with the Skill tool over the paths this commit takes in'), 'the security half hands them over too');
});

test('review-code: is always installed', () =>
{
    assert.ok(require('../meta/recommendations.json').always.skills.includes('review-code'));
});

test('review-security: description fits 15c', () =>
{
    const text = read('stack/skills/review-security/SKILL.md');
    assert.match(text, /^---\nname: review-security\n/);
    const d = description(text);
    assert.ok(d.length > 0 && d.length <= 160, `${d.length} chars`);
    assert.match(d, /^Use when/);
});

test('review-security: reads its target the bounded way', () =>
{
    boundedRead('stack/skills/review-security/SKILL.md');
});

test('review-security: the method in order', () =>
{
    const text = read('stack/skills/review-security/references/method.md');
    const firsts = [...text.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => [Number(m[1]), m[2]]);
    const want = ['Repo context', 'Departures', 'Taint trace', 'Categories', 'Confidence', 'Refute pass'];
    assert.deepEqual(firsts.map(([n]) => n), [1, 2, 3, 4, 5, 6]);
    firsts.forEach(([, title], i) => assert.ok(title.startsWith(want[i]), `step ${i + 1} opens '${want[i]}': ${title}`));
});

test('review-security: confidence bands, and leads never block', () =>
{
    const text = squash(read('stack/skills/review-security/SKILL.md') + ' ' + read('stack/skills/review-security/references/method.md'));
    assert.match(text, /8-10[^.]*finding/);
    assert.match(text, /5-7[^.]*lead/);
    assert.match(text, /under 5[^.]*dropped/);
    assert.ok(text.split(/(?<=\.)\s/).some((s) => /leads/i.test(s) && /never block/.test(s) && /VERIFIED/.test(s)), 'a sentence: leads never block VERIFIED');
    assert.ok(text.includes('a refuted one is dropped, never moved to the leads'));
});

test('review-security: what is NOT excluded here', () =>
{
    const text = read('stack/skills/review-security/references/not-a-finding.md');
    const section = (text.split(/^## Not excluded here\s*$/m)[1] || '').split(/^## /m)[0];
    assert.ok(section.trim(), 'a Not excluded here section');
    const items = section.split('\n').filter((l) => /^- /.test(l));
    for (const re of [/markdown/i, /prompt/i, /environment variable[^\n]*CLI flag|CLI flag[^\n]*environment variable/i, /denial of service[^\n]*rate limit[^\n]*outdated depend/i])
    {
        const hit = items.filter((l) => re.test(l));
        assert.equal(hit.length, 1, `one line for ${re}`);
        assert.match(hit[0], / - /, `the line says why: ${hit[0]}`);
    }
});

// Final review 2026-10-22, I6: 'the staged scan and the secret guard own committed secrets' read as 'drop a hardcoded
// secret in a tracked file' - the staged scan catches only credential-shaped literals.
test('review-security: a secret in a tracked file is always a finding', () =>
{
    const dropped = (read('stack/skills/review-security/references/not-a-finding.md').split(/^## Dropped\s*$/m)[1] || '').split(/^## /m)[0];
    const line = dropped.split('\n').find((l) => /secret/i.test(l)) || '';
    assert.match(line, /a secret in a tracked file always is/, line);
    assert.doesNotMatch(line, /own committed/, 'no line hands committed secrets to another check');
});

test('review-security: the receipt line counts the files read', () =>
{
    assert.ok(read('stack/skills/review-security/SKILL.md').includes('- over <N> files'));
});

test('review-security: a marked close ask', () =>
{
    const asks = askOptions(read('stack/skills/review-security/SKILL.md'));
    assert.ok(asks.length >= 1, 'an ask template');
    assert.equal(asks[asks.length - 1][0], 'Fix the findings (Recommended)');
});

test('review-security: is always installed', () =>
{
    assert.ok(require('../meta/recommendations.json').always.skills.includes('review-security'));
});

// Every shipped .md under these roots, and every manifest note, sends the model to ours: a line naming the built-in
// slash command is the miss this test exists for.
function shippedMd()
{
    const out = [];
    const walk = (dir) =>
    {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }))
        {
            const rel = path.join(dir, e.name);
            if (e.isDirectory()) walk(rel);
            else if (e.name.endsWith('.md')) out.push(rel);
        }
    };
    for (const d of ['stack/skills', 'stack/agents', 'stack/rules', 'setup-plugin']) walk(d);
    return out;
}
const BUILTIN_RE = /\/(?:code-review|security-review)\b/;

test('no shipped text sends the model to a built-in review', () =>
{
    const hits = [];
    for (const rel of shippedMd())
        read(rel).split('\n').forEach((line, i) => { if (BUILTIN_RE.test(line)) hits.push(`${rel}:${i + 1}`); });
    const notes = [];
    const walkNotes = (v, at) =>
    {
        if (Array.isArray(v)) v.forEach((x, i) => walkNotes(x, `${at}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === 'note' && typeof x === 'string' ? notes.push([at, x]) : walkNotes(x, `${at}.${k}`);
    };
    walkNotes(require('../meta/stack-manifest.json'), 'manifest');
    for (const [at, note] of notes) if (BUILTIN_RE.test(note)) hits.push(at);
    assert.deepEqual(hits, [], 'shipped lines naming a built-in review');
});

test('built-in review: the checkpoint runs ours', () =>
{
    const text = read('stack/skills/habits-commit-checkpoint/SKILL.md');
    const step2 = squash((/^2\. \*\*Review\.\*\*[\s\S]*?(?=^\d+\. \*\*)/m.exec(text) || [''])[0]);
    assert.ok(step2.includes('`task-verify-code`') && step2.includes('`review-code`'), 'step 2 names both reviews');
    const sec = squash((text.split(/^## The security half\s*$/m)[1] || '').split(/^## /m)[0]);
    for (const s of ['`review-security`', 'test-only diff', 'integration-reviewer']) assert.ok(sec.includes(s), `the security half keeps ${s}`);
});

test('built-in review: task-verify-code takes its passes from its own vendored copy of review-code\'s', () =>
{
    // 2026-10-30 audit SKF-01: the pointer into review-code's folder named a Claude-only path and broke wherever
    // that folder is absent, so the file is vendored whole and the pair kept byte-equal (review-passes-vendored)
    const verify = read('stack/skills/task-verify-code/SKILL.md');
    assert.ok(!verify.includes('review-code/references/passes.md'), 'no read from another skill\'s folder');
    assert.ok(verify.includes('`references/passes.md`'), 'the own copy is named');
    assert.strictEqual(read('stack/skills/task-verify-code/references/passes.md'), read('stack/skills/review-code/references/passes.md'), 'the vendored copy is byte-equal');
    // SKF-14: both sites that run the preferences script say what to do where it is absent
    for (const rel of ['stack/skills/task-verify-code/SKILL.md', 'stack/skills/review-code/references/passes.md'])
    {
        assert.match(squash(read(rel)), /no script there: judge each entry by hand|With no script there, judge every entry by hand/, `${rel}: the absent-script path`);
    }
});

test('built-in review: security-auditor scores and refutes like review-security', () =>
{
    const text = read('stack/agents/security-auditor.md');
    const d = description(text);
    assert.ok(d.length > 0 && d.length <= 300, `${d.length} chars`);
    assert.ok(d.includes('/review-security'), 'the description sends a diff to /review-security');
    const flat = squash(text);
    for (const s of ['not-a-finding.md', 'leads', 'exploit scenario']) assert.ok(flat.includes(s), s);
    assert.match(flat, /\b8 and above is a finding/);
});

// Final review 2026-10-22, I5: review-security dispatches the seat on a diff, while the seat's description refused a
// diff and its body had no diff mode - a posture report (Critical to Low, a memory write, a status line) came back.
test('built-in review: security-auditor takes review-security\'s diff brief as its spec', () =>
{
    const text = read('stack/agents/security-auditor.md');
    assert.doesNotMatch(description(text), /just the current diff/, 'the description no longer refuses the dispatch review-security makes');
    const conv = (text.split(/^## Conventions\s*$/m)[1] || '').split(/^## /m)[0];
    const bullet = squash(conv.split('\n- ').find((l) => /diff brief/.test(l)) || '');
    assert.ok(bullet.includes('dispatched by the `review-security` skill with a diff brief'), bullet);
    assert.ok(bullet.includes('that brief is the spec'), 'the brief is the spec');
    assert.ok(/bands/.test(bullet) && /leads/.test(bullet) && bullet.includes('`security:`'), 'its bands, leads and receipt line');
    assert.ok(bullet.includes('skip the handoff WRITE'), 'no hand-off write');
    const dispatch = squash((read('stack/skills/review-security/SKILL.md').split(/^## Dispatch\s*$/m)[1] || '').split(/^## /m)[0]);
    assert.ok(dispatch.includes('a diff brief'), 'review-security names the brief the seat keys on');
    assert.doesNotMatch(dispatch, /returns the same table/, 'no claim the posture report matches');
});
