'use strict';
// Pilot 3's flow block (b4-pilot-3-flow): the review's live probe cost $6.64 over five cells and got one result,
// the close ask recommended a commit six times out of six ($6.36, 19 gate denials), 18 of 40 asks carried no
// Recommended mark, and ours/data-02 r2 failed because its blocker ask offered 'You run it' instead of the
// in-session route. These pins hold the fixes in the skill text, the review seat's brief, the stop-contract
// hook's close push, and lint check 61 over every `ask` template.
const test = require('node:test');
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
    const core = flat(read('stack/skills/alfred-task-verify-code/SKILL.md'));
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
    assert.match(lintFlowAskPresence({ ...texts, 'alfred-task-solve': undefined }).join('\n'), /alfred-task-solve\/SKILL\.md/, 'a missing SKILL.md is red');
});

test('A4: the three flow skills each carry ask templates, and every one passes check 61', () => {
    assert.deepStrictEqual([...ASK_FLOW_SKILLS].sort(), ['alfred-issue-diagnoser', 'alfred-task-solve', 'alfred-task-solve-cross']);
    for (const name of ASK_FLOW_SKILLS) {
        const found = asks(skillText(name));
        assert.ok(found.length >= 2, `${name}: ${found.length} ask template(s)`);
        for (const a of found) assert.strictEqual(a.options.filter((o) => /\(Recommended\)$/.test(o)).length, 1, `${name}: ${a.question}`);
    }
});

test('A4: a flow close recommends Hold, and a picked commit still runs the whole checkpoint', () => {
    for (const name of ['alfred-task-solve', 'alfred-task-solve-cross']) {
        const text = skillText(name);
        const close = asks(text).find((a) => a.options.some((o) => /^Commit/.test(o)));
        assert.ok(close, `${name}: a close ask that offers the commit`);
        assert.match(close.options.find((o) => /\(Recommended\)$/.test(o)), /^Hold - review the diff first/, `${name}: Hold is the recommendation`);
        assert.match(flat(text), /alfred-habits-commit-checkpoint/, `${name}: a picked commit runs the checkpoint`);
    }
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
    const blocker = asks(skillText('alfred-task-solve')).find((a) => a.options.some((o) => /^Re-scope around it/.test(o)));
    assert.ok(blocker, 'the blocker ask is a template');
    assert.match(blocker.options.find((o) => /\(Recommended\)$/.test(o)), /^Re-scope around it/, 'the in-session route is recommended');
    for (const o of blocker.options) assert.doesNotMatch(o, /you run it|run it myself|retry/i, o);
});

test('A5: the build bar - a model change never leaves its task without its migration', () => {
    const core = flat(read('stack/skills/alfred-task-implement/SKILL.md'));
    assert.match(core, /model change never leaves its task without its migration/i);
    assert.match(core, /design-time/i, 'the generator runs against the design-time factory\'s project');
    assert.match(core, /hand-written/i, 'and falls back to a hand-written migration');
});
