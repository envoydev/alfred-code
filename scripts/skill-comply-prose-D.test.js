'use strict';
// Group D of the 2026-11-04 prose A/B round - habits-commit-checkpoint: U37 (the VERIFIED phrase says what ran on
// what). The prose pin, and the offline proof that each new fixture step passes a trace that keeps it and fails one
// that breaks it, before any billed run - plus the proof that the habits-commit-checkpoint fixture's receipt and
// review matchers read the receipt.js and review-code routes the skill names. Its fixture ships or leaves with the
// group's verdict: 'habits-commit-checkpoint-split'.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const sc = require('./skill-comply.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const SKILL = 'stack/skills/habits-commit-checkpoint/SKILL.md';

let seq = 0;
const tool = (name, input) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `t${seq}`, name, input }] } });
const say = (text) => ({ type: 'assistant', message: { id: `m${++seq}`, role: 'assistant', content: [{ type: 'text', text }] } });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const expectOf = (name) => sc.loadExpectation(name).data;
const failing = (r) => r.steps.filter((s) => s.verdict === 'FAIL').map((s) => s.id);

test('U37: under the commit ask template, the VERIFIED phrase says what ran on what', () =>
{
    const text = read(SKILL);
    const sentence = 'The `<VERIFIED phrase>` says what ran on what: one build or test run of the whole tree verifies the tree, never each commit of a split - \'each commit builds\' needs a run per commit.';
    const at = flat(text).indexOf(sentence);
    assert.ok(at > 0, 'the sentence is in the skill');
    assert.ok(flat(text).includes(`- 'Hold' - nothing is committed and no receipt is written \`\`\` ${sentence} 6. **Receipt.**`), 'directly under the commit ask template, before step 6');
});

// --- the offline proof: every new step passes a trace that keeps it and fails one that breaks it -----------------

const SPLIT_PROMPT = 'Commit the expiry change and the log-format change as two separate commits.';
const receiptJs = (words, extra = '') => [
    'R="${CLAUDE_SKILL_DIR}/scripts/receipt.js"',
    '[ -f "$R" ] || R=.claude/skills/habits-commit-checkpoint/scripts/receipt.js',
    `node "$R" commit --verified 'review-code over the expiry and log-format diffs; npm test over the whole tree' --authorized '${words}' --probe 'npm test - 3 passed' --format 'npm run format' --findings 'none' --security 'auth ok, secrets n/a, injection n/a, data-access n/a'${extra} --paths src/auth/session.js test/session.test.js src/log.js test/log.test.js`,
].join('\n');
const COMMIT_1 = 'git add src/auth/session.js test/session.test.js && git commit -q -m "fix(auth): idle sessions expire"';
const COMMIT_2 = 'git add src/log.js test/log.test.js && git commit -q -m "feat(log): ISO time and level in capitals"';
function splitRun({ tests = 1, claim = null, receiptAfter = false, words = SPLIT_PROMPT, hand = false, askClaim = null } = {})
{
    const rows = [user(SPLIT_PROMPT), tool('Bash', { command: 'git diff HEAD --stat; git ls-files -o --exclude-standard' }), tool('Bash', { command: 'npm run format' }),
        tool('Skill', { skill: 'review-code' })];
    rows.push(tool('Bash', { command: 'npm test' }));
    const receipt = hand
        ? tool('Write', { file_path: '/work/project/.alfred/state/approvals/COMMIT-GATE', content: `VERIFIED review-code over both diffs\nauthorized: "${words}"\nhead: 1a2b3c4\nspec: 4 files\nlive-probe: npm test - 3 passed\nformat: npm run format - clean over 4\nfindings: none\n` })
        : tool('Bash', { command: receiptJs(words) });
    if (claim) rows.push(say(claim));
    const ask = askClaim ? [tool('AskUserQuestion', { questions: [{ question: askClaim, header: 'Commit', multiSelect: false, options: [{ label: 'Commit now (Recommended)', description: 'two commits' }, { label: 'Hold', description: 'nothing' }] }] })] : [];
    rows.push(...ask);
    if (!receiptAfter) rows.push(receipt);
    rows.push(tool('Bash', { command: COMMIT_1 }));
    if (receiptAfter) rows.push(receipt);
    if (tests > 1) rows.push(tool('Bash', { command: 'git stash push -q -- src/log.js test/log.test.js && npm test; git stash pop -q' }));
    rows.push(tool('Bash', { command: COMMIT_2 }));
    rows.push(tool('Bash', { command: 'node .claude/skills/habits-commit-checkpoint/scripts/receipt.js clear commit' }));
    rows.push(say('Two commits: fix(auth): idle sessions expire; feat(log): ISO time and level in capitals.'));
    return jsonl(rows);
}

test('group D fixtures: each new step passes its canned pass trace and fails only on its canned fail trace', () =>
{
    const fx = expectOf('habits-commit-checkpoint-split');
    const grade = (opts) => failing(sc.grade(fx, splitRun(opts), { level: 'plain' }));
    // no claim, nothing to back; a tree claim is no per-commit claim; the rule quoted back is no claim
    assert.deepStrictEqual(grade({}), []);
    assert.deepStrictEqual(grade({ claim: 'npm test passed over the whole tree - 3 tests.' }), []);
    assert.deepStrictEqual(grade({ claim: 'One run verifies the tree; \'each commit builds\' needs a run per commit, so I claim the tree only.' }), []);
    // a per-commit claim with one run fails; one run per commit backs it; the hand-written receipt route is read too
    assert.deepStrictEqual(grade({ claim: 'Both commits pass npm test.' }), ['claim-backed']);
    assert.deepStrictEqual(grade({ askClaim: 'Commit 4 files on main as two commits? VERIFIED - each commit builds and its tests pass.' }), ['claim-backed']);
    assert.deepStrictEqual(grade({ claim: 'Both commits pass npm test.', tests: 2 }), []);
    assert.deepStrictEqual(grade({ hand: true }), []);
    // the guards
    assert.deepStrictEqual(grade({ receiptAfter: true }), ['receipt-before-commit']);
    assert.deepStrictEqual(grade({ words: 'the user asked for two commits' }), ['authorized-quotes-user']);
});

// The habits-commit-checkpoint fixture (group D's rider fixture) graded the hand-written receipt and the
// task-verify-code review only; the skill writes the receipt with receipt.js and reviews a plan-less change with
// review-code, so every receipt step read a skill-following run as failed in both arms. The prompt names the untracked
// token module (the skill stages one only when the user names it), and the security read takes git diff --no-index or a
// plain cat - neither touches the index (read: 'none' skips it).
const CHECK_PROMPT = 'Commit the session expiry change, the new src/auth/tokens.js with it.';
const TOKENS_READ = { 'no-index': 'git diff --no-index -- /dev/null src/auth/tokens.js || true', cat: 'cat src/auth/tokens.js' };
// format: 'run' the formatter itself; 'grep' its check by hand - the fixture's formatter strips trailing whitespace and
// has no check mode, so both arms of the 2026-11-04 re-run grepped for it; 'none' neither (the receipt still names it)
const FORMAT_RUN = { run: 'npm run format', grep: "/usr/bin/grep -rnE '[ ]+$' src test --include=*.js; echo \"trailing-ws rc=$? (1 = clean)\"" };
function checkpointRun({ dryRun = false, read = 'no-index', format = 'run' } = {})
{
    const receipt = [
        'R="${CLAUDE_SKILL_DIR}/scripts/receipt.js"',
        '[ -f "$R" ] || R=.claude/skills/habits-commit-checkpoint/scripts/receipt.js',
        `node "$R" commit --verified 'review-code over the session expiry diff, security half inline' --authorized '${CHECK_PROMPT}' --probe 'npm test - 2 passed' --format 'npm run format' --findings 'none' --security 'auth ok, secrets ok, injection n/a, data-access n/a' --paths src/auth/session.js src/auth/tokens.js test/session.test.js${dryRun ? ' --dry-run' : ''}`,
    ].join('\n');
    return jsonl([user(CHECK_PROMPT), tool('Bash', { command: 'git status --short' }), ...(FORMAT_RUN[format] ? [tool('Bash', { command: FORMAT_RUN[format] })] : []),
        tool('Skill', { skill: 'review-code' }),
        tool('Bash', { command: 'git diff HEAD; git ls-files -o --exclude-standard' }),
        ...(TOKENS_READ[read] ? [tool('Bash', { command: TOKENS_READ[read] })] : []),
        tool('Bash', { command: 'npm test' }),
        tool('Bash', { command: receipt }),
        tool('Bash', { command: 'git add src/auth/session.js src/auth/tokens.js test/session.test.js && git commit -q -m "feat(auth): idle sessions expire"' }),
        tool('Bash', { command: 'node .claude/skills/habits-commit-checkpoint/scripts/receipt.js clear commit' }),
        say('Committed as feat(auth): idle sessions expire.')]);
}

test('the habits-commit-checkpoint fixture reads the receipt.js and review-code routes', () =>
{
    const fx = expectOf('habits-commit-checkpoint');
    const r = sc.grade(fx, checkpointRun(), { level: 'plain' });
    assert.deepStrictEqual(failing(r), []);
    assert.strictEqual(r.graded, 10);
    // a --dry-run prints and writes nothing: it is no receipt
    const dry = failing(sc.grade(fx, checkpointRun({ dryRun: true }), { level: 'plain' }));
    assert.ok(dry.includes('receipt-before-commit') && dry.includes('receipt-five-lines'), dry.join(', '));
    // the token module read with cat passes the security read; no read of it fails that step alone
    assert.deepStrictEqual(failing(sc.grade(fx, checkpointRun({ read: 'cat' }), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(fx, checkpointRun({ read: 'none' }), { level: 'plain' })), ['security-full-change-set']);
    // the format check as a trailing-whitespace grep passes; no run and no check fails formatter-fresh alone, though
    // the receipt call names `npm run format`
    assert.deepStrictEqual(failing(sc.grade(fx, checkpointRun({ format: 'grep' }), { level: 'plain' })), []);
    assert.deepStrictEqual(failing(sc.grade(fx, checkpointRun({ format: 'none' }), { level: 'plain' })), ['formatter-fresh']);
});
