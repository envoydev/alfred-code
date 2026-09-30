'use strict';
// The repo's own instructions are split: a lean CLAUDE.md hub plus path-scoped rules (.claude/rules/repo-*.md)
// that hold the mechanism notes. A test that pins a sentence of those notes reads them through here, so the
// sentence may live in any of the files. Order is fixed: the hub first, then the rules by name.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function claudeDocFiles(root = ROOT) {
  const rulesDir = path.join(root, '.claude', 'rules');
  const rules = fs.existsSync(rulesDir)
    ? fs.readdirSync(rulesDir).filter((f) => /^repo-.*\.md$/.test(f)).sort().map((f) => path.join('.claude', 'rules', f))
    : [];
  return ['CLAUDE.md', ...rules];
}

function readClaudeDocs(root = ROOT) {
  return claudeDocFiles(root).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
}

module.exports = { claudeDocFiles, readClaudeDocs };
