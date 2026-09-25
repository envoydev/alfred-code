// scripts/docs-fixture.js - throwaway git repos holding architecture docs, for the docs engine and hook tests.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const HOOKS = path.join(__dirname, '..', 'stack', 'hooks');

function repo({ tracked = false, files = {}, docs = {}, docsPath = '.claude/docs' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-engine-')));
  const git = (...args) => {
    const r = rt.spawnCommand('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (rel, text) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  git('init', '-q', '-b', 'develop');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  // The engine's own ledger is machine-local in BOTH modes: committed, it would be modified in every session and
  // `git switch` would refuse to leave the branch.
  write('.gitignore', `${docsPath}/docs-log.jsonl\n${tracked ? '' : `${docsPath}/\n`}`);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  for (const [rel, text] of Object.entries(docs)) write(path.join(docsPath, 'architecture', rel), text);
  git('add', '-A');
  git('commit', '-qm', 'seed');
  // ALFRED_CODE_DOCS_VERSIONING is scrubbed like the legacy docs-path spelling: this runner may itself sit in a
  // session whose settings.json declares a mode, and a fixture must exercise the mode the CASE hands it.
  const env = (extra) => ({ ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_DOCS_PATH: docsPath, CLAUDE_DOCS_PATH: '', ALFRED_CODE_DOCS_VERSIONING: '', ...extra });
  const cli = (args, input, extra = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'docs.js'), ...args], { cwd: root, input, encoding: 'utf8', env: env(extra) });
  const hook = (payload, extra = {}) => spawnSync(process.execPath, [path.join(HOOKS, 'docs-session.js')], { cwd: root, input: JSON.stringify(payload), encoding: 'utf8', env: env(extra) });
  return {
    root, git, write, cli, hook,
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    rm: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

const section = (id, covers, body) => `## ${id.replace(/-/g, ' ')}\n<!-- id: ${id} -->\n${covers ? `<!-- covers: ${covers} -->\n` : ''}${body}\n`;

module.exports = { repo, section, HOOKS };
