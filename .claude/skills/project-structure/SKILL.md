---
name: project-structure
description: "Load before adding a code file, folder or feature, or moving code - where it goes, the logic/effects split, constants and types files. Not for language style."
---

# Project structure - one shape for the code of every repo

The repos keep their code in one shape, so a person or an agent who has worked in one finds the same places in the
next: an entry that only wires, a folder per feature, logic that touches nothing, one file per folder that touches the
world, and constants and types in files of their own.

## When to use

- Before creating a code file or folder, adding a feature, or deciding where a function, a constant or a type goes -
  and before moving any of them.
- It governs new code and the code a change adds or rewrites. A file that predates the shape is never moved or split
  to match, unasked (the user's ruling, 2026-11-15).
- Not for the layout of skills, rules or docs, and not for language style: naming, async and typing are `javascript`
  and `typescript`.

## The shape

1. **An entry only wires.** The file a host or a command starts - a hooks module, a script named on a command line -
   reads its input, calls one function of a feature folder and hands back the result. No decision, no loop over data,
   no text building.
2. **One folder per feature**, named for the feature, beside its entry. A second feature never moves into the first
   one's folder.
3. **Inside the folder each file holds one kind of thing:**
   - `types` - the shapes, and nothing that runs;
   - `constants` - every named value, pattern and closed set the feature uses, the regex or lookup set that only one
     logic file reads included;
   - logic files, each named for what it computes - pure: values in, values out. No file system, process, environment,
     clock, network or host API, and no import of a file that has one;
   - `effects` - the folder's ONE file that touches the outside world. It gathers the input, calls the logic and
     writes the result. What the outside world is here, the map below says.
4. **Shared by two features or more:** the `core` folder, in the same four kinds. Code moves there when the second
   feature needs it, not before.
5. **Imports point one way:** entry -> `effects` -> logic -> `constants`, `types`. A feature uses another through the
   functions it exports, never by reaching past them.
6. **Tests follow the feature:** logic is tested with plain values and no fake, `effects` through the repo's own
   fakes. Where the test files live, the map says.

A value with a meaning is never written inline: it gets a name in `constants`. What counts as one, what does not, and
the form of a closed set are the `javascript` skill's 'Named values' (the `typescript` skill for the `as const` form).

## This repo's map

- Plain CommonJS JavaScript, so there is no `types` file; a feature's named values go in its `constants.js`.
- `stack/hooks/` is flat by contract: the installer copies a named list of hook files into a project's `.claude/hooks/`, so a hook there is a file, not a folder. In a hook file `main` is the entry and the effects (stdin, stdout, the file system, git), and a decision is an exported pure function. That folder's own rule is `.claude/rules/repo-hooks.md`.
- `scripts/` holds the repo's own tools. A new one is an entry `scripts/<name>.js` that only wires, and a folder `scripts/<name>/` with `constants.js`, logic files and `effects.js`.
- The outside world: `fs`, `child_process`, `process`, stdin and stdout, the clock, git.
- Tests: `scripts/<name>.test.js` beside the entry (`npm test` runs `scripts/**/*.test.js`).
- Everything written before 2026-11-15 is flat; it follows the shape only as it is changed, and is never split to match.

## Code that predates the shape

- A new feature takes the whole shape, even where its neighbours do not have it yet: copy the shape, not the
  neighbour.
- In an older file you are changing for another reason, the code you add or rewrite follows the shape - a new decision
  is a pure function in the feature's folder, a new value goes in `constants` - and everything else stays where it is.
- Where the map says a place is flat by contract, it stays flat; the map says what the unit is there.

## Close

One line in the report: `structure: <feature folder> - entry <file>, effects <file>, logic <files>, constants <file>,
types <file>; outside the shape: <what, and why, or 'nothing'>`.

## Signs it was skipped

- An entry file that decides, loops or formats.
- A logic file that imports the file system, the process or the host API - or a second file in one folder that does.
- A constant or a type declared in a logic or effects file - a regex at the top of the one file that uses it is the
  usual one - or a literal with a meaning repeated inline.
- A file moved or split only to match the shape, with nobody asking.
- A new feature written flat because its neighbours are.
