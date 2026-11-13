'use strict';
// THE USAGE SCOPE (workspace W2, D7 to D13): which projects a usage audit reads from where it is invoked, the
// transcript folders that hold their sessions, and what is left out. At a workspace root: the root and every project
// joined below it; in a joined child, a standalone project or with the switch off: that project alone. Built on the
// installer's own walkers (`chain`, `subtree`) and W3's one rule for an ignored project (`ignoredBy`) - no walker here.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const layout = require('../stack/hooks/layout.js');
const ws = require('./install/workspace.js');

// Review finding 10: the project's own transcripts folder, `<config>/projects/<name>`. Claude Code names it from the
// NATIVE path, every non-alphanumeric character a '-' (the documented rule), so on Windows 'C:\\Users\\me\\repo' is
// 'C--Users-me-repo'. Derived from the analyzer's own cwd, never in a command body: a shell's `pwd | sed` gets
// '-c-Users-me-repo' under Git Bash.
function sessionsDirOf(cwd, configDir) {
  return path.join(configDir, 'projects', String(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const realOf = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const posix = (p) => p.split(path.sep).join('/');

// The transcript folders of one project: the folder its own path names (and, for the start project, the folder the
// path as given names - Claude Code keeps the cwd as typed), then, where the project is its own git top or in no
// repository, the folder Claude Code names past 200 characters (`defaultMemoryDirs`' parent). Existing folders only.
function dirsOf(root, given, { env, configDir, rel, notes })
{
  const dirs = [];
  const add = (d) => { if (isDir(d) && !dirs.some((o) => layout.pathKey(o) === layout.pathKey(d))) dirs.push(d); };
  for (const p of given) add(sessionsDirOf(p, configDir));
  const top = layout.gitTopOf(root);
  if (!top || layout.pathKey(top) === layout.pathKey(root)) for (const m of layout.defaultMemoryDirs(root, { env })) add(path.dirname(m));
  else if (String(root).replace(/[^a-zA-Z0-9]/g, '-').length > layout.MEMORY_NAME_MAX)
    notes.push(`${rel}: a path past 200 characters inside another repository - its transcript folder is not looked up`);
  return dirs;
}

// A walked row whose own record reads and whose chain's first member is not the row above it in the walk.
function namesAnother(row, parentRow)
{
  if (ws.readWorkspace(row.root).state === 'garbage') return false;
  const first = ws.chain(row.root, { maxDepth: 1 }).members[0];
  return !first || ws.realKey(first.root) !== ws.realKey(parentRow.root);
}

// { projects: [{ rel, root, dirs }], leftOut: [{ rel, why }], notes: [string] } - `rel` from the start project, `.` for
// it, always first. A left-out row is named once and never beside a counted project (D20 through `ignoredBy`).
function usageScope(start, { env = process.env } = {})
{
  const notes = [];
  const given = path.resolve(start);
  const top = layout.projectRootOf(given).project;
  if (layout.pathKey(top) !== layout.pathKey(given))
    notes.push(`scope: started in ${posix(path.relative(top, given))} - the sessions read are those started at the project root`);
  const whole = ws.workspaceOn({ env, projectRoot: top }) && ws.chain(top).members.length === 0;
  const rows = whole ? ws.subtree(top, { env, log: (l) => notes.push(l) }) : [{ root: realOf(top), rel: '.', parentRel: null, state: 'ok' }];
  const byRel = new Map(rows.map((r) => [r.rel, r]));
  const left = new Map();
  const projects = [];
  for (const row of rows)
  {
    if (row.parentRel !== null)
    {
      const why = left.has(row.parentRel) ? `under ${row.parentRel}`
        : row.state === 'gone' ? 'gone'
          : ws.ignoredBy(row.root, { env }) ? 'ignored'
            : namesAnother(row, byRel.get(row.parentRel)) ? 'names another parent' : null;
      if (why) { left.set(row.rel, why); continue; }
    }
    projects.push(row);
  }
  // What the walk could not see: an ignored path is out of `children` already (W3), so each project's own list names it.
  if (whole) for (const p of projects)
  {
    const read = ws.readWorkspace(p.root);
    if (read.state === 'garbage') continue;
    for (const entry of read.view.ignoredChildren)
    {
      const rel = p.rel === '.' ? entry : `${p.rel}/${entry}`;
      if (!left.has(rel) && !projects.some((q) => q.rel === rel)) left.set(rel, 'ignored');
    }
  }
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude');
  return {
    projects: projects.map((p) => ({
      rel: p.rel, root: p.root, dirs: dirsOf(p.root, p.rel === '.' ? [top, p.root] : [p.root], { env, configDir, rel: p.rel, notes }),
    })),
    leftOut: [...left].map(([rel, why]) => ({ rel, why })),
    notes,
  };
}

module.exports = { usageScope, sessionsDirOf };
