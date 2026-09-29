#!/bin/bash
# The workspace: a one-file API, so the file count alone would read as small.
set -e
mkdir -p src
cat > src/server.ts <<'TS'
import express from 'express';

const app = express();
app.use(express.json());

app.post('/login', (req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
TS
printf '{ "name": "api", "dependencies": { "express": "^5.0.0" } }\n' > package.json
