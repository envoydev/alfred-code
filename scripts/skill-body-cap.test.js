'use strict';
// Lint check 62 (pilot 3, A6): a SKILL.md body is capped at 8,000 chars - the core imperatives, with the rest in
// `references/` read on demand. Measured: ours' first call was 64,468 tokens against bare's ~35,900, a plain C# cell
// carried csharp's 16.4k body in 8 of 8 cells, and a flow cell 104-123k chars of step-skill bodies to its last turn.
// A body that cannot split yet sits on an explicit allowlist with its reason, and an entry that no longer needs it
// is stale.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lintSkillBodyCap, SKILL_BODY_CAP, SKILL_BODY_ALLOW, localSkillDirs, paths } = require('./lint-skills.js');

function tree(skills) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'body-cap-'));
    for (const [name, body] of Object.entries(skills)) {
        fs.mkdirSync(path.join(dir, name), { recursive: true });
        fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: "x"\n---\n${body}`);
    }
    return dir;
}

test('check 62: a body over the cap fails, the frontmatter is not counted, and the allowlist needs a reason', () => {
    assert.strictEqual(SKILL_BODY_CAP, 8000);
    const dir = tree({ at: 'a'.repeat(8000), over: 'b'.repeat(8001), allowed: 'c'.repeat(9000), stale: 'd'.repeat(100), reasonless: 'e'.repeat(9000) });
    const found = lintSkillBodyCap(dir, ['at', 'over', 'allowed', 'stale', 'reasonless'], { allowed: 'cannot split: one table', stale: 'was big', reasonless: '' });
    const text = found.join('\n');
    assert.doesNotMatch(text, /\bat:/, 'exactly at the cap passes');
    assert.match(text, /over: body 8001 chars is over the 8000 cap/);
    assert.doesNotMatch(text, /allowed:/, 'an allowlisted body with a reason passes');
    assert.match(text, /stale: allowlisted .* but its body is 100 chars/, 'a stale entry fails');
    assert.match(text, /reasonless: allowlisted with no reason/);
    assert.strictEqual(found.length, 3);
});

test('check 62: every shipped skill body is within the cap or allowlisted with its reason', () => {
    assert.deepStrictEqual(lintSkillBodyCap(paths.SKILLS_DIR, localSkillDirs(), SKILL_BODY_ALLOW), []);
});
