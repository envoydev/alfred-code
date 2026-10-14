# Structure stage

A findings-based audit. Review TARGET for where files LIVE - the folder tree, each file's place in it, and the folder names - not what the files contain. Run this stage FIRST: moving a file is the widest blast radius in the pipeline, because in most languages the path is part of the symbol's public identity (a C# namespace, a Python or Go module path, a Java package, a TypeScript import specifier), so a move is an API change every later stage would otherwise have to re-key its findings against.

This stage is language- and framework-agnostic. It moves, groups and renames FOLDERS; it never edits a file body, never renames a symbol (that is the naming stage), and never introduces a new architectural boundary (that is `loop-architecture-quality`). Read `<docs-path>/architecture/ARCHITECTURE.md` if it exists - a layout the map records as deliberate is a decision, not a finding.

**The organizing principle: group by what the code is ABOUT, then by what it IS - never the reverse.** The top of the tree names the product's domains and features, so a newcomer reading the folder names learns what the system does, not which framework built it. A technical split (endpoints, handlers, requests, responses, models, mappers, components, services) is a SECOND level, applied inside a domain folder once that folder has grown enough to need it; a tree whose top level is `controllers/ models/ services/ utils/` tells the reader nothing about the product and forces every feature change to touch four distant folders. Converge the tree on the shape the repo ALREADY demonstrates somewhere: find the best-organized module in TARGET and treat it as the precedent every other module moves toward - never invent a scheme the codebase has not already chosen.

A finding here is keyed by the PATH it concerns - the folder, or the file being moved - standing in for the loop's `file:line-or-symbol` slot, so the open set stays comparable across passes.

Look for:
- **Dump folders** - a folder holding many files with no internal grouping and more than one unrelated concept in it: the classic `common`, `shared`, `utils`, `helpers`, `lib`, `misc`, `core`. Split it by concept, one folder per cohesive group. The highest-value finding class in most codebases.
- **Colocation failures** - things that change together living apart, or things that change for different reasons living together. A feature's own files belong in that feature's folder; a file used by exactly one module belongs inside it, not in a shared folder.
- **A missing type level inside a big domain folder** - where the repo's own best module splits roles into subfolders and a sibling module of similar size does not, the sibling is the finding; converge it on the precedent.
- **Misplaced files** - a file under a domain, layer, or feature it does not belong to; a test, fixture, script, or config sitting in the source tree with no reason to be there; a file whose folder misrepresents its layer (domain logic filed under a shared kernel, an admin-only type inside a consumer feature).
- **A concept split across two folders**, so a reader has to know both to change one thing.
- **Folder names that do not say what they hold** - an abbreviation, a framework word where a domain word belongs, a name that no longer matches the contents after earlier drift. Prefer the plural noun of the thing held (`orders/`, not `order-stuff/` or `OrderManagement/`), in the casing the repo already uses.
- **Over-nesting** - depth that buys nothing: a chain of single-child folders, a folder created for one or two files, a path deeper than about four levels below the source root.
- **A test tree that does not mirror its source tree**, so the test for a file is not findable from the file's own path.

Not a finding - do not churn these: a small cohesive folder holding a contract next to its one implementation (the interface belongs with what it contracts, and splitting it into distant `abstractions/` and `impl/` trees is the finding in the opposite direction, unless the ecosystem's own convention mandates it - a published package boundary, a plugin contract with several implementations); framework- or tool-mandated layout (an Angular feature module, a Django app, a Rails or Next.js convention path, an ORM's migrations folder, a package manifest's required location - the framework wins, never fight it to satisfy this stage); generated, vendored, or third-party trees (`node_modules`, build output, generated clients, scaffolded migrations), out of scope entirely; an entry point, composition root, or manifest at the source root; depth or grouping the language's own convention fixes (a Go package per directory, a Java package matching the folder).

Making the fix:
- Move whole files; do not edit bodies. The only content change a move may carry is its mechanical consequence - the declared namespace, package, or module line, and every import, `using`, or reference that points at it.
- Move every reference with the file - a half-moved symbol is worse than the original layout. Use the language's own refactoring tooling where it is reliable; where it is not, a word-boundary replace across the tree plus the compiler or import check.
- The build is the gate. After each batch of moves, run the project's build (or import / type-check for a dynamic language) and its full test suite; a symbol index or language server may be stale against a large uncommitted move, so the build output is the authority, not the editor.
- Batch by folder, not by file - one concept group at a time, gated, so a red build points at one group instead of fifty scattered files.
- Do not create a folder for fewer than three files, and do not add a level the precedent module does not have. Preserve file history where the version control system tracks moves (`git mv`, or a plain move plus a rename-detecting commit).

Severity: a file whose folder misrepresents its layer or domain, or a move that would break a dependency direction the architecture enforces, is a BLOCKER; a dump folder mixing unrelated concepts, a domain folder missing the type split its sibling modules all have, or a concept split across two folders is MAJOR; a single misplaced file, an unclear or off-convention folder name, or one level of needless nesting is MINOR.

A deviation from a preference is not a finding unless you can name what it breaks - a wrong finding costs more than a missed one.

Bar: zero findings at every severity - real findings only: a candidate with nothing nameable it breaks is not a finding (not recorded, not counted against this bar), `open: []` on pass 1 is a valid, complete result, and every real finding is listed, never trimmed.
