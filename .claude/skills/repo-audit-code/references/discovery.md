# Code audit - Phase 0 discovery

Read at Phase 0. Build every map below before scoring; edit nothing.

1. **The standards.** Read, by path, `.claude/skills/<name>/SKILL.md` for `project-structure`, `javascript`, `typescript`, `code-comments` and `ts-js-testing`, and the reference each names for the section you score with; then the repo's `structure_map` in `.claude/kit/repo.json`, its `tsconfig` files, and its lint and format configs where it has them. Name what you read in `records.md`.
2. **The classes.** Read `.claude/skills/ts-convert/SKILL.md`, 'The classes'. Take each JavaScript file's class from the newest `convert.md` on disk - this run folder's, else the newest under `docs/superpowers/audits/` or `docs/superpowers/convert/` - and class a file it does not list by those rules, in their order, citing the `notes` line, the `keep_js` entry or the shipped file that decides it. A `.ts`, `.mts`, `.cts` or `.tsx` file has no class to decide unless the repo's own word makes it `leave`.
3. **The checks.** Run every `checks` command before scoring and quote its result line; a red check at baseline is a finding on the items it names, not a stop. Where the dispatch names a `checks-before.txt`, the coordinating session already ran them: quote that file and run nothing.
4. **Read each item end to end, with its tests.** A file over the size one read returns is read in parts, to its last line. Record per item: what it is (an entry, a feature folder, a logic file, an effects file, a constants or types file, a test, a fixture); what it imports and what imports it; where it touches the outside world; the failure channels it uses; the input it takes from outside and where that is checked; its async work and the resources it holds; its comments; the tests the repo keeps for it and which behaviours they pin; for a `check` file, whether `// @ts-check` is there and whether the compiler's file list holds it.
5. **The set maps.** Over every item:
   - the import graph: each cycle, and each dependency that points against the layering - logic importing effects, a feature reaching past another's exported functions, an entry that decides;
   - the named values and their homes: a value with a meaning written inline, and a value defined in two places;
   - duplicated logic: the same computation written in two items;
   - the exports and their users: an export nothing imports, counting users outside the roots - a `package.json` script, a settings hook command, another repo's file list;
   - the module system per package: the nearest `package.json` `type` of each folder, and each file that differs from its package;
   - the tree against `structure_map`: a line of the map the tree no longer matches, and a folder the map does not name;
   - the `keep_js` entries against the files: a path that matches no file, and an entry whose reason is the outside runtime while only the repo's own runtime loads its file.
6. **In a batched run** build each map over your own items, and write what leaves your batch into `records-<n>.md` under 'For the set planner', one line each, in a form the `set` seat can merge without the code: an import edge with both paths, a named value with its value and its home, an export with its users found, a computation with the file and lines that hold it.
