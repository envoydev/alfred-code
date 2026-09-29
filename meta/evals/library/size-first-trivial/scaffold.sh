#!/bin/bash
# The workspace: a README whose title carries one typo, and a source file the fix must not touch.
set -e
printf '# Claude Stak\n\nA small demo project.\n' > README.md
mkdir -p src && printf 'export const answer = 42;\n' > src/index.ts
