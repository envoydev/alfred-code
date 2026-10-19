'use strict';
// Pilot 3's flow block (b4-pilot-3-flow): the review's live probe cost $6.64 over five cells and got one result,
// the close ask recommended a commit six times out of six ($6.36, 19 gate denials), 18 of 40 asks carried no
// Recommended mark, and ours/data-02 r2 failed because its blocker ask offered 'You run it' instead of the
// in-session route. These pins hold the fixes in the skill text, the review seat's brief, the stop-contract
// hook's close push, and lint check 61 over every `ask` template.
const test = require('node:test');
// 2.1.5 M5: no inherited stack env, entrypoint or project dir, and the suite fails on a write under os.tmpdir()'s docs root.
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
delete process.env.CLAUDE_CODE_ENTRYPOINT; // the runner's own entrypoint never decides a hook case
const { lintAskTemplates, lintFlowAskPresence, ASK_FLOW_SKILLS } = require('./lint-skills.js');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'stack', 'skills');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// A skill's whole text: the core plus every reference it loads on demand.
const skillText = (name) => {
    const dir = path.join(SKILLS, name);
    const refs = fs.existsSync(path.join(dir, 'references')) ? fs.readdirSync(path.join(dir, 'references')).filter((f) => f.endsWith('.md')) : [];
    return [fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), ...refs.map((f) => fs.readFileSync(path.join(dir, 'references', f), 'utf8'))].join('\n');
};
// Every `ask` block of a text, as { question, options: [label] }.
const asks = (text) => [...text.matchAll(/^[ \t]*```ask\n([\s\S]*?)^[ \t]*```/gm)].map((m) => {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
    return { question: lines[0], options: lines.filter((l) => /^- '/.test(l)).map((l) => (l.match(/^- '(.*)' - /) || l.match(/^- '(.*)'\s*$/))[1]) };
});
const flat = (s) => s.replace(/\s+/g, ' ');

// ---- A3: the review's live probe is bounded ------------------------------------------------------
test('A3: the review counts an in-process run through the real Program, else takes ONE boot attempt', () => {
    const core = flat(read('stack/skills/task-verify-code/SKILL.md'));
    assert.match(core, /WebApplicationFactory/, 'the in-process route is named');
    assert.match(core, /real `Program`/, 'through the app\'s own Program');
    assert.match(core, /ONE boot attempt/, 'the attempt is bounded');
    assert.match(core, /NOT RUN - environment/, 'and the verdict it ends on is stated');
    assert.doesNotMatch(core, /a NOT RUN live-probe is never a pass/, 'the line that drove the retries is gone');
    assert.match(core, /never write to a database/i, 'the probe never rewrites shared state it did not start');
    const seat = flat(read('stack/agents/aspnet-verifier.md'));
    assert.match(seat, /WebApplicationFactory[^.]*real `Program`/, 'the review seat carries the same bound');
    assert.match(seat, /ONE boot attempt/);
    assert.match(seat, /NOT RUN - environment/);
});

// ---- A4: every flow ask marks exactly one recommendation; the close recommends Hold -------------
test('A4: lint check 61 fails an ask template with no mark, or with two', () => {
    const block = (...opts) => ['```ask', 'Build it now? The plan is gated.', ...opts.map((o) => `- '${o}' - why`), '```'].join('\n');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'a.md', text: block('Go (Recommended)', 'Stop') }]), []);
    assert.match(lintAskTemplates([{ file: 'a.md', text: block('Go', 'Stop') }]).join('\n'), /a\.md.*no option marked '\(Recommended\)'/);
    assert.match(lintAskTemplates([{ file: 'b.md', text: block('Go (Recommended)', 'Stop (Recommended)') }]).join('\n'), /b\.md.*2 options marked/);
    assert.match(lintAskTemplates([{ file: 'c.md', text: block('Go (Recommended)') }]).join('\n'), /c\.md.*fewer than two options/);
    const indented = block('Go', 'Stop').split('\n').map((l) => `   ${l}`).join('\n');
    assert.match(lintAskTemplates([{ file: 'd.md', text: `1. **STEP** - ask:\n\n${indented}\n` }]).join('\n'), /d\.md.*no option marked/, 'an indented template is read too');
});

// Audit 2026-10-20 C01 (fabea019, 7c1af769): 'Not yet - changes needed' - say what changes in Other' was sent verbatim and
// denied by the stop contract's OTHER_RE on every run. Check 61 runs the hook's own regex, read from its source line.
test('C01: check 61 fails an ask option that tells the user to type into Other, with the hook\'s own OTHER_RE', () => {
    const { hookOtherRe } = require('./lint-skills.js');
    const re = hookOtherRe();
    assert.ok(re instanceof RegExp, 'the regex is read from guard-stop-contract.js');
    const hookSrc = fs.readFileSync(path.join(__dirname, '..', 'stack', 'hooks', 'guard-stop-contract.js'), 'utf8');
    assert.ok(hookSrc.includes(`const OTHER_RE = ${re.toString()};`), 'the lint holds the very literal the hook runs');
    const block = (...lines) => ['```ask', 'Approve the plan? The gate passed.', ...lines, '```'].join('\n');
    for (const bad of [
        "- 'Not yet - changes needed' - edit the plan, or say what changes in Other",
        "- 'Apply some - name them in Other' - only the changes you list",
        "- 'I will type them via Other' - the run maps the locations you type",
        "- 'Changes needed' - type them into the Other box",
    ]) {
        const out = lintAskTemplates([{ file: 'x.md', text: block("- 'Approve (Recommended)' - build it", bad) }]).join('\n');
        assert.match(out, /x\.md.*tells the user to type into Other/, bad);
    }
    // the rewritten shape: a label-only pick, the detail asked for in plain text after it
    assert.deepStrictEqual(lintAskTemplates([{ file: 'y.md', text: block("- 'Approve (Recommended)' - build it", "- 'Not yet - changes needed' - edit the plan yourself, or I ask what to change next, in plain text") }]), []);
    // a missing hook line is a finding, never a silent pass
    assert.match(lintAskTemplates([{ file: 'z.md', text: block("- 'Go (Recommended)' - a", "- 'Stop' - b") }], null).join('\n'), /no one-line `const OTHER_RE/);
    assert.strictEqual(hookOtherRe(path.join(__dirname, 'no-such-hook.js')), null);
});

test('C01: no shipped ask template tells the user to type into Other', () => {
    const re = require('./lint-skills.js').hookOtherRe();
    const root = path.join(__dirname, '..');
    const hits = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.md')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm)) for (const l of m[1].split('\n').map((x) => x.trim())) if (/^- '/.test(l) && re.test(l)) hits.push(`${path.relative(root, p)}: ${l}`); } };
    walk(path.join(root, 'stack', 'skills'));
    walk(path.join(root, 'setup-plugin'));
    assert.deepStrictEqual(hits, []);
});

// Review of pilot 4, M6: a label holding an apostrophe read as unmarked, and a mark on the second option passed.
test('A4: check 61 reads a label up to its last quote before the why, and wants the recommendation first', () => {
    const block = (...opts) => ['```ask', 'Commit it? The review passed.', ...opts.map((o) => `- '${o}' - why`), '```'].join('\n');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'e.md', text: block("Hold - don't commit yet (Recommended)", 'Commit') }]), [], 'an apostrophe inside the label');
    assert.deepStrictEqual(lintAskTemplates([{ file: 'e.md', text: ['```ask', 'Go?', "- 'Go (Recommended)'", "- 'Stop'", '```'].join('\n') }]), [], 'an option with no why');
    assert.match(lintAskTemplates([{ file: 'f.md', text: block('Stop', 'Go (Recommended)') }]).join('\n'), /f\.md.*'\(Recommended\)' option is listed 2nd - list it first/);
});

// M6 too: the presence check passed while any one template was left, so a stop dropped back to prose went unseen.
test('A4: check 61 counts each flow skill\'s templates in SKILL.md itself, so removing one goes red', () => {
    const texts = Object.fromEntries(ASK_FLOW_SKILLS.map((name) => [name, fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8')]));
    assert.deepStrictEqual(lintFlowAskPresence(texts), [], 'the shipped SKILL.md files pass');
    for (const name of ASK_FLOW_SKILLS) {
        const dropped = texts[name].replace(/^([ \t]*)```ask[ \t]*\n[\s\S]*?^[ \t]*```[ \t]*\n/m, '$1(the stop, in prose)\n');
        assert.notStrictEqual(dropped, texts[name], `${name}: a template was removed`);
        assert.match(lintFlowAskPresence({ ...texts, [name]: dropped }).join('\n'), new RegExp(`${name}/SKILL\\.md.*\`ask\` template`), `${name}: one template fewer is red`);
    }
    assert.match(lintFlowAskPresence({ ...texts, 'task-solve': undefined }).join('\n'), /task-solve\/SKILL\.md/, 'a missing SKILL.md is red');
});

test('A4: the three flow skills each carry ask templates, and every one passes check 61', () => {
    // audit 2026-10-14 SKF-06: the three loops, task-implement and task-build-from-scratch joined - auto-mode answers only a marked ask
    assert.deepStrictEqual([...ASK_FLOW_SKILLS].sort(), ['habits-adjust-agents-md', 'issue-diagnoser', 'loop-architecture-quality', 'loop-code-quality',
        'loop-test-coverage', 'task-build-from-scratch', 'task-implement', 'task-solve', 'task-solve-cross']);
    for (const name of ASK_FLOW_SKILLS) {
        const found = asks(skillText(name));
        assert.ok(found.length >= (name === 'habits-adjust-agents-md' ? 1 : 2), `${name}: ${found.length} ask template(s)`);
        for (const a of found) assert.strictEqual(a.options.filter((o) => /\(Recommended\)$/.test(o)).length, 1, `${name}: ${a.question}`);
    }
});

// The user's ruling 2026-10-13 (usage audit 2026-10-10, session 0824440b: the closes recommended Hold and the user overrode
// it 3 of 3 times): a LOCAL commit takes the mark - it stays on this machine and `git reset --soft HEAD~1` undoes it - and
// every push or publish ask recommends holding, since it leaves the machine. One rule, every ask that offers either.
test('A4: a commit ask recommends the local commit and a push or publish ask recommends holding, in every skill', () => {
    for (const name of ['task-solve', 'task-solve-cross']) {
        const text = skillText(name);
        const close = asks(text).find((a) => a.options.some((o) => /^Commit/.test(o)));
        assert.ok(close, `${name}: a close ask that offers the commit`);
        assert.deepStrictEqual(close.options[0], 'Commit now (Recommended)', `${name}: the local commit is the recommendation, listed first`);
        assert.match(flat(text), /habits-commit-checkpoint/, `${name}: a picked commit runs the checkpoint`);
    }
    let commits = 0, pushes = 0;
    for (const name of fs.readdirSync(SKILLS)) {
        const dir = path.join(SKILLS, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        const files = [path.join(dir, 'SKILL.md')];
        if (fs.existsSync(path.join(dir, 'references'))) for (const f of fs.readdirSync(path.join(dir, 'references'))) files.push(path.join(dir, 'references', f));
        for (const f of files.filter((x) => x.endsWith('.md') && fs.existsSync(x))) {
            for (const a of asks(fs.readFileSync(f, 'utf8'))) {
                const marked = a.options.find((o) => /\(Recommended\)$/.test(o));
                if (a.options.some((o) => /^Commit now\b/.test(o))) { commits += 1; assert.strictEqual(marked, 'Commit now (Recommended)', `${f}: ${a.question}`); }
                if (a.options.some((o) => /^(Push now|Publish)\b/.test(o))) { pushes += 1; assert.strictEqual(marked, 'Hold - push later (Recommended)', `${f}: ${a.question}`); }
            }
        }
    }
    assert.ok(commits >= 3 && pushes >= 2, `the walk found the asks (commit ${commits}, push ${pushes})`);
});

test('A4: the stop-contract hook\'s pending-close push offers no commit', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'stack', 'hooks', 'guard-stop-contract.js')], {
        input: JSON.stringify({ hook_event_name: 'Stop', session_id: 'a4', last_assistant_message: 'The fix is done and the suite is green. Not pushed yet - the next step whenever you are ready.' }),
        encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'a4-')) },
    });
    assert.strictEqual(r.status, 2, 'the pending close is still held');
    assert.doesNotMatch(r.stderr, /push or hold|commit now/i, 'the push names no commit or push as the next move');
    assert.match(r.stderr, /uncommitted diff is held/i, 'and says the diff stays held');
});

// ---- A5: a blocked tool is recovered in the session ----------------------------------------------
test('A5: the build-step blocker ask recommends the in-session route, never retry or you-run-it', () => {
    const blocker = asks(skillText('task-solve')).find((a) => a.options.some((o) => /^Re-scope around it/.test(o)));
    assert.ok(blocker, 'the blocker ask is a template');
    assert.match(blocker.options.find((o) => /\(Recommended\)$/.test(o)), /^Re-scope around it/, 'the in-session route is recommended');
    for (const o of blocker.options) assert.doesNotMatch(o, /you run it|run it myself|retry/i, o);
});

test('A5: the build bar - a model change never leaves its task without its migration', () => {
    const core = flat(read('stack/skills/task-implement/SKILL.md'));
    assert.match(core, /model change never leaves its task without its migration/i);
    assert.match(core, /design-time/i, 'the generator runs against the design-time factory\'s project');
    assert.match(core, /hand-written/i, 'and falls back to a hand-written migration');
});

// ---- Task 1 (flow-cost): on a full spec, design and plan audit are one step with one approval ask ---------------
// Pilot 3: the gate changed the plan in 1 of 4 feature cells, and the steps before the build cost $0.95-1.65 a cell.
test('full spec: the solve flow states the checklist, runs the check script and pins the merged ask', () => {
    const { ASK_FLOW_TEMPLATES } = require('./lint-skills.js');
    assert.deepStrictEqual(ASK_FLOW_TEMPLATES, { 'task-solve': 9, 'task-solve-cross': 5, 'issue-diagnoser': 4, 'habits-adjust-agents-md': 3,
        'loop-architecture-quality': 10, 'loop-code-quality': 10, 'loop-test-coverage': 8, 'task-implement': 10, 'task-build-from-scratch': 5 });
    for (const name of ['task-solve', 'task-solve-cross']) {
        const core = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
        assert.match(core, /scripts\/spec-check\.js/, `${name}: the check is a script, not a judgment`);
        assert.match(flat(core), /the surface/i, `${name}: surface`);
        assert.match(flat(core), /observable behaviour/i, `${name}: behaviour`);
        assert.match(flat(core), /tests or acceptance criteria/i, `${name}: verification`);
        assert.match(flat(core), /more than one stack/i, `${name}: a multi-stack request keeps every gate`);
        assert.match(flat(core), /auth, secret or payment path/i, `${name}: a security path keeps every gate`);
        const merged = asks(core).find((a) => /^Full spec/.test(a.question));
        assert.ok(merged, `${name}: the merged step's one approval ask is a template`);
        assert.match(merged.options[0], /^Build as planned.*\(Recommended\)$/, `${name}: build as planned is recommended, first`);
    }
    assert.match(flat(read('stack/skills/task-solve/SKILL.md')), /`path: merged` you may raise to gated[^.]*never lower\./, 'the model may raise the script\'s verdict to gated, never lower it');
});
