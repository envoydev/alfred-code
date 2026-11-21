#!/bin/bash
# The workspace, run inside the freshly installed project: a small node project whose package.json lists react 19 and a
# chart kit that peers on react 18, and ci.log, the saved Actions log of the failed install step (npm ci ends in
# ERESOLVE). The log is short and one job is red, so the catalogue's gatherer reference says to stay inline: the run
# triages in the main session, starts no diagnoser seat and, if it starts a gatherer anyway, reads the reference first.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p src
printf '.alfred/\n.serena/\n.memory-mcp/\nnode_modules/\n' >> .gitignore
cat > package.json <<'JSON'
{
  "name": "dash-app",
  "private": true,
  "scripts": {
    "build": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "react": "^19.0.0",
    "@fixture/chart-kit": "^2.4.0"
  }
}
JSON
cat > CLAUDE.md <<'MD'
# dash-app

A small dashboard app. CI runs `npm ci`, then `npm test`, on every pull request.

## Commands

- Install: `npm ci`
- Test: `npm test`
MD
cat > src/index.js <<'JS'
'use strict';
console.log('dash-app');
JS
cat > ci.log <<'LOG'
Run npm ci
npm error code ERESOLVE
npm error While resolving: @fixture/chart-kit@2.4.0
npm error Found: react@19.0.0
npm error peer react@"^18.0.0" from @fixture/chart-kit@2.4.0
Error: Process completed with exit code 1.
LOG
git add -A
git commit -q -m 'baseline'
