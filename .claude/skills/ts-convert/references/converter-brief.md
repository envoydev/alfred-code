# TypeScript conversion - the converter seat's brief

You convert one batch of a planned conversion. The plan decided everything: which files, their new names, each
construct and the form it takes, every reference to update, the checks. You decide nothing. What the plan does not
cover, you report.

The dispatch gives you: REPOSITORY, RUN FOLDER, BATCH (a number) and the path of `convert.md`.

## Rules

1. Read the batch's section of `convert.md` - for batch 0, 'Toolchain (batch 0)'; for any other batch also that
   section's `Typecheck command` and `File list` lines - then `conversion-rules.md`
   beside this file, whole. A project rule that asks for a skill before an edit to a code file: load it where you
   hold the Skill tool, else Read its `SKILL.md` by path (`.claude/skills/<name>/SKILL.md`), and name what you
   read in your last message.
2. Write only the batch's files, under their old and new paths, and the files its 'References to update' and
   'Globs edited here' lines name. Nothing else: no other batch's file, no `leave` file, no `engines`, no
   `tsconfig` outside batch 0, not `progress.md` or `convert.md`.
3. The only git commands that change anything are `git mv` and, when the batch fails, the restore below. Never
   commit, stash, reset or push.
4. Keep what the code does. No reordering, no renamed export, no added validation, no fix. A defect you meet goes
   into your last message under 'Findings for the audit'.
5. Never run `node --check` on a converted file, never import a file to see whether it loads, and never run an
   entry: its top level can start a suite, a gate or a write.
6. Nothing you write into a tracked file carries an absolute local path or a token.

## A `convert` batch

1. Before any edit, run the batch's `Tests` command and note the count of tests it ran.
2. Rename each file with `git mv <old path> <new path>`.
3. Convert each file by the rules: every construct the plan lists for it takes the form the plan gives, types are
   added, and its test converts with it.
4. Apply every 'References to update' line and every 'Globs edited here' line, each exactly as written.
5. Run the checks, in this order:
   - the file list: the `File list:` commands of the plan's toolchain section, each run as written, hold every file
     of the batch between them;
   - the plan's `Typecheck command` passes;
   - the `Tests` command, with the new names, passes and runs the count of step 1;
   - each `check` file for reason (a) or (b) you edited still requires only JavaScript and JSON:
     `grep -nE "(require\(|from |import\()[[:space:]]*['\"](\.{1,2}/|/)[^'\"]*['\"]" <file> | grep -vE "\.(js|cjs|mjs|json)['\"]"`
     prints nothing.

## A `check` batch

1. Before any edit, run the batch's `Tests` command and note the count.
2. Add `// @ts-check` and the JSDoc types to each file, by 'A `check` file' in the rules. No rename, no code
   change beyond what that section allows.
3. Run the same four checks.

## Batch 0 - the toolchain

1. Apply each edit of 'Toolchain (batch 0)' exactly: a file created with the text the plan gives, a key added, a
   line replaced.
2. Install only what the plan lists, and only where it lists an install: read `.claude/skills/npm/SKILL.md` first
   and follow its supply-chain rules - exact versions, the lockfile kept.
3. Run the plan's check: the typecheck is green on the tree as it stands, and each `File list:` command, run as
   written, names a file of each root its config covers and no `leave` path.
4. Do not run the whole test suite: the coordinating session does, and records it.

## When a check stays red

Fix what the check names and run the checks again, once. Still red: put the batch back and say so.

```bash
git restore --staged --worktree --source=HEAD -- <the batch's old and new paths and every other file you touched>
git clean -f -- <the new paths git does not track>
git status --porcelain -- <the same paths>
```

The last command prints nothing. Then report `FAILED` with the first lines of the error. Never loosen a type, skip
a test, or edit a file outside the batch to make a check pass - an error in such a file is the reason you report.

## Your last message

At most 20 lines: `GREEN` or `FAILED` on the first line; the files, old name and new; each check with its result
line, the test count before and after among them; the references and globs you edited; every `@ts-expect-error`
you added, with its reason; each entry converted with no test of its own, as 'entry not covered'; 'Findings for
the audit'; and anything the plan did not cover.
