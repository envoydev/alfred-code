#!/bin/bash
# The workspace, run inside the freshly installed project: a small node project with its own root CLAUDE.md (fourteen
# lines, three project facts - build `npm run build`, test `npm test`, 'src/legacy is frozen') and the installer's seeded
# .claude/AGENTS.md, the unfilled template (written here only where the install left none). Both files sit in the
# baseline commit, so the run starts on a clean tree: a run that renames or cuts the CLAUDE.md shows in the trace.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src/legacy .claude
printf '.alfred/\n.serena/\n.memory-mcp/\nnode_modules/\n' >> .gitignore
cat > package.json <<'JSON'
{
  "name": "dash-app",
  "private": true,
  "scripts": {
    "build": "node src/index.js",
    "test": "node --test"
  }
}
JSON
cat > src/index.js <<'JS'
'use strict';
console.log('dash-app');
JS
cat > src/legacy/old-report.js <<'JS'
'use strict';
module.exports = { render: () => 'legacy report' };
JS
cat > CLAUDE.md <<'MD'
# dash-app

A small dashboard app.

## Commands

- Build: `npm run build`
- Test: `npm test`

## Rules

- src/legacy is frozen - do not edit it.
- Keep functions short and named for what they do.
- Run the tests before every commit.
MD
if [ ! -f .claude/AGENTS.md ]; then
cat > .claude/AGENTS.md <<'MD'
# dash-app

<!-- Fill-in block - delete once done. The installer seeds this file as .claude/AGENTS.md when the project has
     no AGENTS.md or CLAUDE.md. The habits-adjust-agents-md skill fills it (create) or brings an existing one
     up to date (improve), and ends on the deterministic check. -->
MD
fi
git add -A -f
git commit -q -m 'baseline'
