'use strict';
// The project root in shipped skill text (the user's ruling of 2026-11-03, the D8 fix pass and its follow-up). Claude Code
// substitutes `${CLAUDE_PROJECT_DIR}` in a skill's SKILL.md only (code.claude.com/docs/en/skills, 'Available string
// substitutions'); a reference file is read as literal text, and Cursor or Codex substitute nothing anywhere. So skill
// prose names `<project root>`, which the model fills in on every host. A fenced command block is the one exception: its
// command also passes `${CLAUDE_SESSION_ID}`, so it is bound to Claude Code until the multi-host adapter (D5) rewrites it.
// The installer writes a SKILL.md's approval stamp path back as `${CLAUDE_PROJECT_DIR}` in the Claude Code copy
// (install/library.js renderSkillFile, pinned in install-library.test.js), so an install holds the text 3.7.1 shipped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'stack', 'skills');
function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

function prose(text) { return text.replace(/^```[\s\S]*?^```/gm, ''); }
test('no skill file names ${CLAUDE_PROJECT_DIR} in its prose; it says <project root>', () => {
    const files = walk(SKILLS);
    assert.ok(files.length > 100, `${files.length} skill files`);
    const named = files.filter((f) => prose(fs.readFileSync(f, 'utf8')).includes('${CLAUDE_PROJECT_DIR}'));
    assert.deepStrictEqual(named.map((f) => path.relative(SKILLS, f)), []);
    const stamp = fs.readFileSync(path.join(SKILLS, 'task-solve', 'references', 'step-mechanics.md'), 'utf8');
    assert.ok(stamp.includes('`<project root>/<data root>/state/approvals/<plan id>/APPROVAL`'), 'the per-plan stamp names the placeholder');
    const waiver = fs.readFileSync(path.join(SKILLS, 'task-solve', 'SKILL.md'), 'utf8');
    assert.ok(waiver.includes('write `<project root>/<data root>/state/approvals/APPROVAL`'), 'the AUTO waiver names the placeholder');
    for (const s of ['loop-code-quality', 'loop-architecture-quality', 'task-build-from-scratch']) {
        const body = fs.readFileSync(path.join(SKILLS, s, 'SKILL.md'), 'utf8');
        assert.ok(body.includes('Write the stamp at the ABSOLUTE path `<project root>/<data root>/state/approvals/<plan id>/APPROVAL`'), s);
    }
});
test('the cross flow points at its own waiver, not a SKILL.md that has none', () => {
    const modes = fs.readFileSync(path.join(SKILLS, 'task-solve-cross', 'references', 'execution-modes.md'), 'utf8');
    assert.ok(!modes.includes('under the autonomy waiver in `SKILL.md`'), 'the stale pointer is gone');
    assert.ok(modes.includes('under the autonomy waiver above'));
    assert.ok(!/\*\*Autonomy waiver/.test(fs.readFileSync(path.join(SKILLS, 'task-solve-cross', 'SKILL.md'), 'utf8')), 'the cross SKILL.md holds no waiver');
});
