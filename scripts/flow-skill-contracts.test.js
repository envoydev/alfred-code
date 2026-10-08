'use strict';
// The 2.1.4 audit - flow package (merged.md C1, I22, I25-I29, I32-I35). One file for the package's pins, so the
// parallel fix branches never collide in lint-skills.js. Each block names the finding it holds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const docs = require('./install/docs.js');
const { lintAskTemplates, lintFlowAskPresence, ASK_FLOW_SKILLS } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'stack', 'skills');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => String(s).replace(/\s+/g, ' ');
const body = (text) => String(text).replace(/^---\n[\s\S]*?\n---\n/, '');
const description = (name) => (read(`stack/skills/${name}/SKILL.md`).match(/^description:\s*"(.*)"\s*$/m) || [])[1] || '';
// Every shipped skill markdown file: SKILL.md plus its references.
const skillFiles = () => {
    const out = [];
    for (const d of fs.readdirSync(SKILLS)) {
        const main = path.join(SKILLS, d, 'SKILL.md');
        if (fs.existsSync(main)) out.push(main);
        const refs = path.join(SKILLS, d, 'references');
        if (fs.existsSync(refs)) for (const r of fs.readdirSync(refs)) if (r.endsWith('.md')) out.push(path.join(refs, r));
    }
    return out;
};
// Every `ask` block of a text, as { question, options: [label] }.
const asks = (text) => [...String(text).matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => (l.match(/^- '(.*)' - /) || l.match(/^- '(.*)'\s*$/))[1]) };
});
const shared = () => JSON.parse(read('meta/shared-rules.json')).rules;
const copiesOf = (entry) => [entry.owner, ...(entry.sites || [])].map((c) => c.file);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-skill-contracts-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let seq = 0;
function repo()
{
    const root = path.join(TMP, `p-${seq++}`);
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: root });
    return root;
}
const ignoreOf = (root) => path.join(root, '.alfred', 'docs', '.gitignore');
// The git-mode text develop 23c24b9d (2.1.3) wrote - an install updated from it carries exactly these bytes.
const GIT_TEXT_213 = '# alfred-code: the docs are committed (ALFRED_CODE_DOCS_VERSIONING=git); the hooks\' machine-local state is not\n'
    + '/flow/\n/hook-blocks/\n/history/\n/tools-usage/\n/.branches/\n/docs-log.jsonl\n';

// ---- C1: the usage audit's raw transcripts never land in a committable folder ---------------------------------
test('C1: git-mode docs root keeps the usage audit\'s raw transcripts out of git, the report and dumps in', () =>
{
    const root = repo();
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'written');
    const base = path.join(root, '.alfred', 'docs', 'usage-report');
    for (const rel of ['s1/s1.jsonl', 's1/subagents/agent-a.jsonl', 's1/hook-blocks-s1.jsonl', 's1/report-usage.md', 's1/s1.json', 'SUMMARY.md'])
    {
        fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
        fs.writeFileSync(path.join(base, rel), 'x\n');
    }
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.alfred/docs/usage-report'], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(status, /\.jsonl/, 'no transcript or ledger copy is committable');
    assert.deepStrictEqual(status.trim().split('\n').sort(), [
        '?? .alfred/docs/usage-report/SUMMARY.md',
        '?? .alfred/docs/usage-report/s1/report-usage.md',
        '?? .alfred/docs/usage-report/s1/s1.json',
    ]);
    const probe = spawnSync('git', ['check-ignore', '-q', '.alfred/docs/usage-report/s2/x.jsonl'], { cwd: root });
    assert.strictEqual(probe.status, 0, 'the skill\'s own consent probe reads a not-yet-written copy as ignored');
});

test('C1: an update over the 2.1.3 git-mode file rewrites it, a re-run changes nothing, the project\'s own is kept', () =>
{
    const root = repo();
    fs.mkdirSync(path.dirname(ignoreOf(root)), { recursive: true });
    fs.writeFileSync(ignoreOf(root), GIT_TEXT_213);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'replaced', 'the stack\'s former text is the stack\'s');
    assert.match(fs.readFileSync(ignoreOf(root), 'utf8'), /^\/usage-report\/\*\*\/\*\.jsonl$/m);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: root, docsPath: '.alfred/docs', mode: 'git' }), 'current');

    const crlf = repo();
    fs.mkdirSync(path.dirname(ignoreOf(crlf)), { recursive: true });
    fs.writeFileSync(ignoreOf(crlf), GIT_TEXT_213.replace(/\n/g, '\r\n'));
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: crlf, docsPath: '.alfred/docs', mode: 'local' }), 'replaced', 'a former text follows a versioning switch too, CRLF or not');
    assert.match(fs.readFileSync(ignoreOf(crlf), 'utf8'), /^\*$/m);

    const own = repo();
    fs.mkdirSync(path.dirname(ignoreOf(own)), { recursive: true });
    fs.writeFileSync(ignoreOf(own), `${GIT_TEXT_213}/drafts/\n`);
    assert.strictEqual(docs.ensureDocsIgnore({ projectRoot: own, docsPath: '.alfred/docs', mode: 'git' }), 'kept', 'an edited copy is the project\'s');
    assert.strictEqual(fs.readFileSync(ignoreOf(own), 'utf8'), `${GIT_TEXT_213}/drafts/\n`);
});

test('C1: the usage audit keys its transcript copy on git check-ignore and asks before a committable copy', () =>
{
    const skill = read('stack/skills/capture-usage-report/SKILL.md');
    assert.match(flat(skill), /git check-ignore -q "<docs-path>\/usage-report\/<session-id>\/x\.jsonl"/);
    const ask = asks(skill).find((a) => a.options.some((o) => /raw transcripts/i.test(o)));
    assert.ok(ask, 'the consent is an ask template');
    assert.deepStrictEqual(ask.options, ['Report and --json dumps only (Recommended)', 'Copy the raw transcripts too']);
    assert.deepStrictEqual(lintAskTemplates([{ file: 'stack-usage', text: skill }]), []);
    assert.doesNotMatch(flat(skill), /default machine-local docs root|COMMITTED docs root/, 'the stale default-layout premise is gone');
});

// ---- I25: no shipped skill teaches that the docs root is machine-local by default -----------------------------
test('I25: no shipped skill says the docs root is machine-local by default', () =>
{
    const stale = /machine-local by default|default machine-local|defaults inside it|machine-local under (?:the default layout|`\.claude\/`)|The doc is machine-local/;
    const hits = skillFiles().filter((f) => stale.test(flat(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f));
    assert.deepStrictEqual(hits, []);
});

test('I25: the four captures say where the docs land by the docs engine\'s own status line', () =>
{
    for (const rel of ['stack/skills/capture-related-projects/SKILL.md', 'stack/skills/capture-architecture/references/report-fields.md',
        'stack/skills/capture-code-style/SKILL.md', 'stack/skills/capture-test-coverage/SKILL.md'])
        assert.match(flat(read(rel)), /docs\.js status/, `${rel}: names the observable`);
    const landed = read('stack/skills/capture-code-style/SKILL.md').match(/^Landed:.*$/m);
    assert.ok(landed, 'the Landed field is still there');
    assert.match(landed[0], /mode: git/);
    assert.match(landed[0], /mode: overlay/);
    assert.match(flat(read('stack/skills/capture-test-coverage/SKILL.md')), /`mode: git`[^.]*raw/, 'test-coverage says the raw files are committed under git mode');
});

// ---- I26: the APPROVAL stamp's protected-path sentence is conditional and pinned at all nine sites ---------------
const PROTECTED = 'Only where the docs root still sits under `.claude/` (the old `.claude/docs` default, kept) is the write protected: '
    + 'a prompt for it offers \'Yes, and allow Claude to edit files in this project\'s .claude folder for this session\' - '
    + 'take that, since `permissions.allow` cannot pre-approve it.';
const STAMP_SITES = [
    'stack/skills/loop-architecture-quality/SKILL.md', 'stack/skills/loop-quality/SKILL.md',
    'stack/skills/loop-quality/references/delegated-mode.md', 'stack/skills/loop-test-coverage/SKILL.md',
    'stack/skills/task-build-from-scratch/SKILL.md', 'stack/skills/task-implement/SKILL.md',
    'stack/skills/task-solve/references/step-mechanics.md', 'stack/skills/task-solve-cross/references/execution-modes.md',
    'stack/skills/task-version-upgrade/SKILL.md',
];
test('I26: the stale prompt label is gone and every stamp site carries the one conditional sentence', () =>
{
    const stale = skillFiles().filter((f) => /its own settings for this session/.test(flat(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f));
    assert.deepStrictEqual(stale, []);
    for (const rel of STAMP_SITES) assert.ok(flat(read(rel)).includes(PROTECTED), `${rel}: the conditional sentence`);
    const entry = shared()['approval-stamp-protected-path'];
    assert.ok(entry, 'pinned in shared-rules.json');
    assert.deepStrictEqual(copiesOf(entry).sort(), [...STAMP_SITES].sort(), 'the lint holds every copy');
});

// ---- I22: the plan-file rule names the design flow's handoff ---------------------------------------------------
test('I22: the interaction baseline carves out the design flow\'s plan file, and both homes are pinned', () =>
{
    assert.match(flat(read('stack/rules/alfred-interaction.md')), /A written plan file only when the user asks for a plan, the work spans sessions, or a design flow writes it as its handoff/);
    assert.match(flat(read('stack/skills/task-design/SKILL.md')), /a design flow writes it as its handoff/);
    const entry = shared()['plan-file-design-handoff'];
    assert.ok(entry, 'pinned in shared-rules.json');
    assert.deepStrictEqual(copiesOf(entry).sort(), ['stack/rules/alfred-interaction.md', 'stack/skills/task-design/SKILL.md']);
});

// ---- I27: a shell variable never crosses a Bash call ------------------------------------------------------------
// Each Bash call is its own shell, so a fenced bash block that expands $NAME must assign it itself - or the skill
// has the model paste the literal an earlier block printed. Environment names the harness sets are exempt.
const ENV_NAME = /^(?:HOME|PATH|PWD|USER|TMPDIR|OSTYPE|SHELL|IFS|PIPESTATUS|RANDOM|LINENO|CLAUDE_[A-Z0-9_]+|ALFRED_CODE_[A-Z0-9_]+)$/;
function unassigned(block)
{
    const assigned = new Set();
    for (const a of block.matchAll(/(?:^|[\s;&|(!])(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\+?=/gm)) assigned.add(a[1]);
    for (const a of block.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) assigned.add(a[1]);
    for (const a of block.matchAll(/\bread\s+(?:-[a-z]+\s+)*([A-Za-z_][A-Za-z0-9_ ]*)/g)) for (const n of a[1].trim().split(/\s+/)) assigned.add(n);
    const used = new Set([...block.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].map((u) => u[1]));
    return [...used].filter((n) => !assigned.has(n) && !ENV_NAME.test(n));
}
test('I27: the scanner flags a variable used in a block that never assigns it', () =>
{
    assert.deepStrictEqual(unassigned('node "$CAPS" --body x\n'), ['CAPS']);
    assert.deepStrictEqual(unassigned('X=$(pwd)\nfor f in a b; do echo "$X/$f ${CLAUDE_CONFIG_DIR:-$HOME}"; done\n'), []);
});
test('I27: no fenced bash block in a shipped skill reads a variable another Bash call set', () =>
{
    const hits = [];
    for (const f of skillFiles())
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/^[ \t]*```(?:bash|sh|shell)[ \t]*\n([\s\S]*?)^[ \t]*```/gm))
        {
            const names = unassigned(m[1]);
            if (names.length) hits.push(`${path.relative(ROOT, f)}: ${names.join(', ')}`);
        }
    assert.deepStrictEqual(hits, []);
});
test('I27: the usage audit\'s temp dir is made under $TMPDIR, where a sandboxed command may write', () =>
{
    const skill = read('stack/skills/capture-usage-report/SKILL.md');
    assert.match(skill, /mktemp -d "\$\{TMPDIR:-\/tmp\}\/alfred-code\.XXXXXX"/);
    assert.doesNotMatch(skill, /mktemp -d\)/, 'a bare mktemp -d ignores $TMPDIR on macOS');
});

// ---- I28: deliberate, file-writing skills carry no question-shaped trigger --------------------------------------
test('I28: the three deliberate skills drop their question-shaped triggers', () =>
{
    const cases = {
        'capture-architecture': /what the structure or module boundaries are/,
        'capture-test-coverage': /how covered the project is/,
        'task-design': /where does this belong/,
    };
    for (const [name, question] of Object.entries(cases))
    {
        const d = description(name);
        assert.ok(d, `${name}: has a description`);
        assert.doesNotMatch(d, question, `${name}: the question phrasing is gone`);
        assert.ok(d.length <= 160, `${name}: ${d.length} chars`);
    }
    assert.match(description('task-design'), /'design this feature', 'plan this change'/);
});

// ---- I29: the solve flow's CLOSE and Do-not fit the compaction re-attach window ----------------------------------
test('I29: task-solve\'s body is under 18,000 chars with its stops still templated in SKILL.md', () =>
{
    const text = read('stack/skills/task-solve/SKILL.md');
    const b = body(text);
    assert.ok(b.length < 18000, `body is ${b.length} chars`);
    assert.ok(b.indexOf('6. **CLOSE**') > 0 && b.indexOf('## Do not') > b.indexOf('6. **CLOSE**'), 'CLOSE and Do not are both there');
    const texts = Object.fromEntries(ASK_FLOW_SKILLS.map((n) => [n, read(`stack/skills/${n}/SKILL.md`)]));
    assert.deepStrictEqual(lintFlowAskPresence(texts), [], 'every pinned ask template stayed in SKILL.md');
    assert.doesNotMatch(b, /pilot 3|data-02|55-hour|13 sessions loaded/, 'the anecdotes left the run-time body');
    const evidence = read('stack/skills/task-solve/references/evidence.md');
    for (const story of [/data-02/, /6 of 6/, /55-hour/, /13 sessions loaded/, /18 of 40/]) assert.match(evidence, story, `${story} kept in the evidence appendix`);
});

// ---- I32 + I33: verify-code's receipt and example carry what its contract requires ---------------------------------
test('I32: verify-code\'s COMMIT-GATE receipt adds the security row, pinned with the checkpoint', () =>
{
    // The receipt left SKILL.md for a reference the body reads when a commit is next (2026-10-08 audit, task-verify-code:74).
    const receipt = 'stack/skills/task-verify-code/references/commit-gate-receipt.md';
    const marker = '`security:` naming each category checked and its verdict';
    assert.ok(flat(read(receipt)).includes(marker));
    const entry = shared()['commit-gate-security-row'];
    assert.ok(entry, 'pinned in shared-rules.json');
    assert.deepStrictEqual(copiesOf(entry).sort(), ['stack/skills/habits-commit-checkpoint/SKILL.md', receipt]);
});

test('I33: verify-code\'s worked example opens with the six named fields, each filled', () =>
{
    // Regression joined the five in the 2026-10-08 audit (task-verify-code:60): step 4's callers and vacuous-test checks.
    const example = read('stack/skills/task-verify-code/SKILL.md').split('## Example')[1] || '';
    const block = (example.match(/```text\n([\s\S]*?)```/) || [])[1] || '';
    const lines = block.split('\n').filter(Boolean);
    assert.deepStrictEqual(lines.slice(0, 6).map((l) => l.split(':')[0]), ['Build', 'Live-probe', 'Regression', 'Findings', 'Probe code', 'Next run']);
    for (const l of lines.slice(0, 6)) assert.doesNotMatch(l, /<[^>]+>/, `${l}: a value, not a placeholder`);
});

// ---- I34 + I35: verify-plan's mode ask is a template, and its audit record names the five passes -------------------
test('I34: verify-plan\'s run-start mode ask is one template, this chat recommended first', () =>
{
    const skill = read('stack/skills/task-verify-plan/SKILL.md');
    const found = asks(skill);
    assert.strictEqual(found.length, 1);
    assert.deepStrictEqual(found[0].options, ['Audit this plan in this chat (Recommended)', 'Dispatch the <stack>-verifier seat']);
    assert.deepStrictEqual(lintAskTemplates([{ file: 'verify-plan', text: skill }]), []);
    assert.match(flat(skill), /ask ONE question before auditing/, 'the mode-ask-at-start marker stays');
});

test('I35: verify-plan and solve-cross record the audit in one Passes shape, pinned', () =>
{
    const line = 'Passes: risk <v> | scope <v> | existence <v> | edges <v> | soundness <v>';
    assert.ok(flat(read('stack/skills/task-verify-plan/SKILL.md')).includes(line), 'verify-plan\'s contract');
    assert.ok(flat(read('stack/skills/task-solve-cross/SKILL.md')).includes(line), 'solve-cross\'s ledger');
    const entry = shared()['plan-audit-passes-field'];
    assert.ok(entry, 'pinned in shared-rules.json');
    assert.strictEqual(entry.owner.file, 'stack/skills/task-verify-plan/SKILL.md');
    assert.deepStrictEqual(copiesOf(entry).sort(), ['stack/skills/task-solve-cross/SKILL.md', 'stack/skills/task-verify-plan/SKILL.md']);
});

// ---- 2.1.7: the usage audit's folder is `usage-report/` (was `alfred-code-usage-report/`) ----------------------
const GIT_TEXT_216 = GIT_TEXT_213 + '# the usage audit\'s raw transcript and ledger copies stay on this machine\n/alfred-code-usage-report/**/*.jsonl\n';
function oldBundle(root, sessions = ['s1'])
{
    const base = path.join(root, '.alfred', 'docs', 'alfred-code-usage-report');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'SUMMARY.md'), 'old summary\n');
    for (const s of sessions)
    {
        fs.mkdirSync(path.join(base, s), { recursive: true });
        fs.writeFileSync(path.join(base, s, 'report-usage.md'), `${s}\n`);
        fs.writeFileSync(path.join(base, s, `${s}.jsonl`), '{"raw":true}\n');
    }
    return base;
}
const usageArgs = (root) => ({ projectRoot: root, docsPath: '.alfred/docs' });

test('2.1.7: an update over the 2.1.6 git text rewrites it, then the old folder moves whole and its raw copies stay ignored', () =>
{
    const root = repo();
    const old = oldBundle(root);
    fs.writeFileSync(ignoreOf(root), GIT_TEXT_216);
    execFileSync('git', ['add', '.alfred/docs'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-qm', 'docs'], { cwd: root });
    assert.strictEqual(docs.ensureDocsIgnore({ ...usageArgs(root), mode: 'git' }), 'replaced');
    const lines = [];
    assert.strictEqual(docs.migrateUsageReport({ ...usageArgs(root), log: (l) => lines.push(l) }), 'moved');
    assert.ok(!fs.existsSync(old));
    assert.strictEqual(fs.readFileSync(path.join(root, '.alfred', 'docs', 'usage-report', 's1', 'report-usage.md'), 'utf8'), 's1\n');
    assert.match(lines.join('\n'), /alfred-code-usage-report\/ -> usage-report\//);
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.alfred/docs'], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(status, /\.jsonl/, 'the moved raw copy is still out of git');
    assert.match(status, /^R  \.alfred\/docs\/alfred-code-usage-report\/s1\/report-usage\.md -> \.alfred\/docs\/usage-report\/s1\/report-usage\.md$/m, 'a committed report moves as a staged rename');
    assert.strictEqual(docs.migrateUsageReport(usageArgs(root)), 'none', 'a re-run finds nothing to move');
});

test('2.1.7: a folder with raw copies is held where git would not ignore them at the new name - the project\'s own file kept', () =>
{
    const root = repo();
    const old = oldBundle(root);
    fs.writeFileSync(ignoreOf(root), '# ours\n/alfred-code-usage-report/**/*.jsonl\n');
    assert.strictEqual(docs.ensureDocsIgnore({ ...usageArgs(root), mode: 'git' }), 'kept');
    const lines = [];
    assert.strictEqual(docs.migrateUsageReport({ ...usageArgs(root), log: (l) => lines.push(l) }), 'held');
    assert.ok(fs.existsSync(path.join(old, 's1', 's1.jsonl')));
    assert.ok(!fs.existsSync(path.join(root, '.alfred', 'docs', 'usage-report')));
    assert.match(lines.join('\n'), /^ {2}!! .*add '\/usage-report\/\*\*\/\*\.jsonl'/m);
    // Reports alone carry nothing secret: they move whatever git says.
    fs.rmSync(path.join(old, 's1', 's1.jsonl'));
    assert.strictEqual(docs.migrateUsageReport(usageArgs(root)), 'moved');
});

test('2.1.7: a local root or no repository moves raw copies; a new folder already there is merged, never overwritten', () =>
{
    const local = repo();
    oldBundle(local);
    docs.ensureDocsIgnore({ ...usageArgs(local), mode: 'local' });
    assert.strictEqual(docs.migrateUsageReport(usageArgs(local)), 'moved');

    const bare = path.join(os.tmpdir(), `usage-bare-${process.pid}-${Date.now()}`);
    oldBundle(bare);
    try { assert.strictEqual(docs.migrateUsageReport(usageArgs(bare)), 'moved', 'outside git nothing can be committed'); }
    finally { fs.rmSync(bare, { recursive: true, force: true }); }

    const both = repo();
    docs.ensureDocsIgnore({ ...usageArgs(both), mode: 'git' });
    const old = oldBundle(both, ['s1', 's2']);
    const fresh = path.join(both, '.alfred', 'docs', 'usage-report');
    fs.mkdirSync(path.join(fresh, 's2'), { recursive: true });
    fs.writeFileSync(path.join(fresh, 's2', 'report-usage.md'), 'new s2\n');
    const lines = [];
    assert.strictEqual(docs.migrateUsageReport({ ...usageArgs(both), log: (l) => lines.push(l) }), 'merged');
    assert.strictEqual(fs.readFileSync(path.join(fresh, 's1', 'report-usage.md'), 'utf8'), 's1\n', 'a session only the old folder held moves');
    assert.strictEqual(fs.readFileSync(path.join(fresh, 's2', 'report-usage.md'), 'utf8'), 'new s2\n', 'the new copy is never overwritten');
    assert.strictEqual(fs.readFileSync(path.join(fresh, 'SUMMARY.md'), 'utf8'), 'old summary\n');
    assert.ok(fs.existsSync(path.join(old, 's2')), 'the clash stays at the old name');
    assert.match(lines.join('\n'), /!! .*already holds s2/);
});

// 2.2.2: superpowers/ goes - the superpowers plugin's folder name, a pick dropped in 2.0.0. Every folder in it moves up.
test('2.2.2: every folder under superpowers/ moves up to the docs root, history kept, and the emptied folder goes', () =>
{
    const root = repo();
    const base = path.join(root, '.alfred', 'docs');
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
    put('superpowers/plans/a.md', 'a\n');
    put('superpowers/specs/s.md', 's\n');
    put('superpowers/sdd/ledger.md', 'ledger\n');
    put('superpowers/sdd/briefs/t1.md', 't1\n');
    put('superpowers/NOTES.md', 'notes\n');
    put('superpowers/.DS_Store', 'x');
    execFileSync('git', ['add', '-f', '.alfred/docs/superpowers/plans/a.md'], { cwd: root });
    execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-qm', 'plan'], { cwd: root });
    const lines = [];
    assert.deepStrictEqual(docs.migratePlans({ ...usageArgs(root), log: (l) => lines.push(l) }), { plans: 'moved', specs: 'moved', sdd: 'moved', 'NOTES.md': 'moved' });
    for (const [rel, text] of [['plans/a.md', 'a\n'], ['specs/s.md', 's\n'], ['sdd/ledger.md', 'ledger\n'], ['sdd/briefs/t1.md', 't1\n'], ['NOTES.md', 'notes\n']])
        assert.strictEqual(fs.readFileSync(path.join(base, rel), 'utf8'), text, rel);
    assert.ok(!fs.existsSync(path.join(base, 'superpowers')), 'nothing but litter was left, so the folder goes');
    assert.match(lines.join('\n'), /docs migration \(superpowers\): superpowers\/plans\/ -> plans\//);
    assert.match(lines.join('\n'), /superpowers\/ removed/);
    const status = execFileSync('git', ['status', '--porcelain', '--', '.alfred/docs'], { cwd: root, encoding: 'utf8' });
    assert.match(status, /^R {2}\.alfred\/docs\/superpowers\/plans\/a\.md -> \.alfred\/docs\/plans\/a\.md$/m, 'a committed plan moves as a staged rename');
    assert.deepStrictEqual(docs.migratePlans(usageArgs(root)), {}, 'a re-run finds nothing to move');
});

test('2.2.2: a clash at the docs root is never overwritten - it stays under superpowers/, named, and the folder with it', () =>
{
    const root = repo();
    const base = path.join(root, '.alfred', 'docs');
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
    put('superpowers/plans/a.md', 'old a\n');
    put('superpowers/plans/b.md', 'b\n');
    put('superpowers/README.md', 'old readme\n');
    put('plans/a.md', 'new a\n');
    put('README.md', 'root readme\n');
    const lines = [];
    assert.deepStrictEqual(docs.migratePlans({ ...usageArgs(root), log: (l) => lines.push(l) }), { plans: 'merged', 'README.md': 'kept' });
    assert.strictEqual(fs.readFileSync(path.join(base, 'plans', 'a.md'), 'utf8'), 'new a\n', 'the root copy wins');
    assert.strictEqual(fs.readFileSync(path.join(base, 'plans', 'b.md'), 'utf8'), 'b\n', 'a plan only the old folder held moves');
    assert.strictEqual(fs.readFileSync(path.join(base, 'superpowers', 'plans', 'a.md'), 'utf8'), 'old a\n', 'the clash stays at the old name');
    assert.strictEqual(fs.readFileSync(path.join(base, 'superpowers', 'README.md'), 'utf8'), 'old readme\n');
    assert.strictEqual(fs.readFileSync(path.join(base, 'README.md'), 'utf8'), 'root readme\n');
    assert.match(lines.join('\n'), /!! docs migration \(superpowers\): plans\/ already holds a\.md/);
    assert.match(lines.join('\n'), /!! docs migration \(superpowers\): README\.md is already at the docs root/);
    assert.deepStrictEqual(docs.migratePlans({ projectRoot: path.join(TMP, 'absent'), docsPath: '.alfred/docs' }), {}, 'no docs root: nothing');
});
