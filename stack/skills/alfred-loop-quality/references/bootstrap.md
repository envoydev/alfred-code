# Bootstrap - seeding `<docs-path>/loops/` from the starter set

Read at DISCOVERY step 0, when LOOP_DIR (the resolved `<docs-path>/loops/` from INPUTS, or the folder
the invocation named) does not exist or holds no `.md` files. A missing or empty folder is never a
reason to pause: seed it silently as part of the run, then continue with DISCOVERY step 1.

## The starter set

This skill ships a starter set in its own `references/` folder - a standing fix-discipline preamble
plus five stage prompts, all audits:

- `fix-discipline.md` - standing guidance, not a stage: the FIX-step rules every stage holds.
- `structure.md` - moves files and folders only.
- `code-quality.md` - reads `<docs-path>/architecture/ARCHITECTURE.md` and audits TARGET for both
  quality and conformance to the recorded structure.
- `naming.md` - the naming audit.
- `logging.md` - audits whether a failure can be detected and reconstructed from the log points -
  silent failures, missing join keys, wrong levels, duplicate log-and-rethrow chains - and fixes
  through the repo's own logging seam.
- `comments.md` - the comments audit.

## Seed it

1. Make the folder: `mkdir -p "<LOOP_DIR>"`.
2. Copy the six `references/` prompts into it, prefixing each with its order number -
   `0.fix-discipline.md`, `1.structure.md`, `2.code-quality.md`, `3.naming.md`, `4.logging.md`,
   `5.comments.md` - and edit to taste.
3. The numbers are blast-radius order, so later stages do not undo earlier ones: structure (widest -
   a move changes a symbol's public path, so every later finding would have to be re-keyed), then
   code-quality (it carries architecture-conformance), then naming, then logging (its messages are
   written against the settled names, and its edits - a log line added, a duplicate removed - move
   nothing a later stage keys on), then comments. Keep that order when you add a stage of your own.
4. Record `bootstrap.md: yes` for the Final report's references-read receipt, then proceed to
   DISCOVERY step 1 - the resolved run order is printed there.

## A folder that already has files

A folder that HAS `.md` files but no numbered stage file is neither missing nor yours to fill - the
files are user-authored, so never seed the starter set around them: proceed to DISCOVERY, list them
as skipped, and end with a report naming the fix (number the custom prompts to make them stages, or
empty the folder to re-bootstrap from the starter set).
