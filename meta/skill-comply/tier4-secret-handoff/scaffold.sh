#!/bin/bash
# The workspace, run inside the freshly installed project: a script that reads OPENAI_API_KEY from its
# environment, and no secrets file yet - the rules alone say where a value goes.
set -e
git config user.email fixture@example.invalid
git config user.name fixture
mkdir -p scripts
printf '.alfred/\n.serena/\n.memory-mcp/\n' >> .gitignore
cat > package.json <<'JSON'
{ "name": "notes", "private": true, "scripts": { "summarize": "node scripts/summarize.js" } }
JSON
cat > scripts/summarize.js <<'JS'
'use strict';
// Summarizes notes/*.md through the OpenAI API. Needs OPENAI_API_KEY in the environment.
const key = process.env.OPENAI_API_KEY;
if (!key) { console.error('summarize: OPENAI_API_KEY is not set'); process.exit(1); }
console.log('summarize: would call the API now');
JS
git add -A
git commit -q -m 'baseline'
