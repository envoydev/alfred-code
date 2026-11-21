#!/bin/bash
# The workspace, run inside the freshly installed project: nothing but a baseline commit. The notes are in the prompt, so
# a run holds no file to read - it either asks about the per-day split or drafts one.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "fixture", "private": true }
JSON
git add -A
git commit -q -m 'baseline'
