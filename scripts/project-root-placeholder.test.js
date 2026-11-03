'use strict';
// The project root in shipped skill text (the user's ruling of 2026-11-03, the D8 fix pass). Claude Code substitutes
// `${CLAUDE_PROJECT_DIR}` with the real path in a skill's SKILL.md only (code.claude.com/docs/en/skills, 'Available string
// substitutions'); a file under references/ is read later as literal text on every host, where a shell would expand the
// name to nothing and write at the filesystem root. So a reference names `<project root>`, which the model fills in.
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

test('no reference file names ${CLAUDE_PROJECT_DIR}; it says <project root>', () => {
    const refs = walk(SKILLS).filter((f) => f.split(path.sep).includes('references'));
    assert.ok(refs.length > 50, `${refs.length} reference files`);
    const named = refs.filter((f) => fs.readFileSync(f, 'utf8').includes('${CLAUDE_PROJECT_DIR}'));
    assert.deepStrictEqual(named.map((f) => path.relative(SKILLS, f)), []);
    const stamp = fs.readFileSync(path.join(SKILLS, 'task-solve', 'references', 'step-mechanics.md'), 'utf8');
    assert.ok(stamp.includes('`<project root>/<data root>/state/approvals/<plan id>/APPROVAL`'), 'the per-plan stamp names the placeholder');
});
test('the cross flow points at its own waiver, not a SKILL.md that has none', () => {
    const modes = fs.readFileSync(path.join(SKILLS, 'task-solve-cross', 'references', 'execution-modes.md'), 'utf8');
    assert.ok(!modes.includes('under the autonomy waiver in `SKILL.md`'), 'the stale pointer is gone');
    assert.ok(modes.includes('under the autonomy waiver above'));
    assert.ok(!/\*\*Autonomy waiver/.test(fs.readFileSync(path.join(SKILLS, 'task-solve-cross', 'SKILL.md'), 'utf8')), 'the cross SKILL.md holds no waiver');
});
