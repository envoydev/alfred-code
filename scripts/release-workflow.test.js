'use strict';
// The release workflow ships two archives under BOTH names for the 2.x line, so a 1.x install's
// archive fallback (releases/latest/download/claude-stack.tar.gz, through GitHub's own repo
// redirect) does not 404 once the marketplace and plugin names move to alfred-code
// (task-5c, requirement 3). No test here reads scripts/*.js - this is the workflow TEXT itself,
// the one place the asset list is declared.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');

test('release workflow: gh release create names all four assets - both names, tar.gz and zip', () => {
    const start = WORKFLOW.indexOf('gh release create');
    assert.ok(start >= 0, 'no gh release create line found');
    const block = WORKFLOW.slice(start, WORKFLOW.indexOf('\n\n', start));
    for (const asset of ['alfred-code.tar.gz', 'alfred-code.zip', 'claude-stack.tar.gz', 'claude-stack.zip'])
        assert.ok(block.includes(asset), `gh release create does not name ${asset}`);
});

test('release workflow: the legacy assets are a COPY of the same bytes, not a second git archive', () => {
    const buildStart = WORKFLOW.indexOf('Build the source archives');
    assert.ok(buildStart >= 0, 'no "Build the source archives" step found');
    const buildBlock = WORKFLOW.slice(buildStart, WORKFLOW.indexOf('- name:', buildStart + 1));
    const archiveCalls = (buildBlock.match(/git archive --format/g) || []).length;
    assert.strictEqual(archiveCalls, 2, 'exactly two git archive calls - tar.gz and zip of the new name only, never a second git archive under the old name');
    assert.match(buildBlock, /cp\s+alfred-code\.tar\.gz\s+claude-stack\.tar\.gz/);
    assert.match(buildBlock, /cp\s+alfred-code\.zip\s+claude-stack\.zip/);
});

test('release workflow: a comment says why the legacy names ship and that they go when 2.x ends', () => {
    assert.match(WORKFLOW, /claude-stack\.(?:tar\.gz|zip).{0,400}(?:fallback|1\.x)/is, 'no comment naming the 1.x fallback the legacy assets serve');
    assert.match(WORKFLOW, /(?:drop|remove|retire).{0,40}(?:2\.x ends|end of 2\.x)/i, 'no comment saying the legacy assets go when 2.x ends');
});
