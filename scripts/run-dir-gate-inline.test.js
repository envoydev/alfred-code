'use strict';
// The calls of a skill the walks follow inline (the AGENTS.md skill, `<stack>` = the run dir's repo) and the close's removal call.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { approvesForms } = require('./run-dir-gate/forms.js');
const { D, MARKER, ROOT, SHIPPED, shippedCtx } = require('./run-dir-gate-fixture.js');

const REMOVAL = 'r' + 'm -rf';
const SKILL = 'stack/skills/habits-adjust-agents-md/SKILL.md';
const at = (script) => `node "${D}/repo/${script}"`;
const readBody = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\s+/g, ' ');

test('the live AGENTS.md skill call, with the stack held in a shell variable and chained, stays silent; each command on the literal path passes alone', () =>
{
    const chained = `S="${D}/repo"; node "$S/scripts/agents-md-check.js" --root . --list; node "$S/scripts/scan-evidence.js" --orientation --root .; cat package.json; cat "$S/stack/AGENTS.template.md" | head -60`;
    assert.equal(approvesForms(chained, shippedCtx), false);
    const alone = [
        `${at('scripts/agents-md-check.js')} --root . --list`,
        `${at('scripts/agents-md-check.js')} --root . --outline`,
        `${at('scripts/agents-md-check.js')} --root .`,
        `${at('scripts/scan-evidence.js')} --orientation --root .`,
        `${at('scripts/update-preflight.js')} --offers --root . | grep '^instructions-file:'`,
    ];
    for (const form of alone) assert.equal(approvesForms(form, shippedCtx), true, form);
    assert.equal(approvesForms(`${at('scripts/agents-md-check.js')} --root . --list --nope`, shippedCtx), false);
    assert.ok(SHIPPED.scripts['scripts/agents-md-check.js'][''].flags['--outline'], 'the table holds the skill\'s own flags');
});

test('the close\'s removal is a call of its own: it passes alone and stays silent chained with the look at the tree', () =>
{
    const removal = `${REMOVAL} "${D}" "${MARKER}"`;
    assert.equal(approvesForms(removal, shippedCtx), true);
    assert.equal(approvesForms(`${removal}; ls -a .claude; find . -maxdepth 2 \\( -name 'install.log' -o -name 'raw.json' \\)`, shippedCtx), false);
    assert.equal(approvesForms(`${removal}; ls -a .claude`, shippedCtx), false);
    const step = readBody('setup-plugin/references/update-close.md').split('## 8. Clean up the temp dir - ALWAYS')[1];
    assert.match(step, /`r[m] -rf "\$TMP" "\$MARK"`, a call of its OWN - never chained with another command/);
    assert.match(step, /as a separate call after it \(read-only, naming no run dir\)/);
});

test('each walk text that sends the model to the AGENTS.md skill says: the literal RESOLVED path for <stack>, no shell variable, one command per call', () =>
{
    for (const file of ['setup-plugin/references/update-close.md', 'setup-plugin/references/init-bootstrap.md', 'setup-plugin/commands/configure.md'])
    {
        const text = readBody(file);
        const at = text.indexOf(`$TMP/repo/${SKILL}`);
        assert.ok(at >= 0, file);
        assert.match(text.slice(at, at + 1400), /literal `RESOLVED` path, no shell variable, and each command in a call of its own/, file);
    }
});
