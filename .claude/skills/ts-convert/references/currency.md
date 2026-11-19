# TypeScript conversion - the dated facts

Read by the planner seat before it classes a file and by `conversion-rules.md` wherever a rule names a row. Each
row was read from its source on the date given. Before a row decides a batch - the entry guard, the module format,
a version floor written into a repo's instruction file - the planner seat re-reads it from the live page (Node
serves each page as text: `https://nodejs.org/api/<page>.md`) and says in `convert.md` which rows it re-read. A row
the page now contradicts: the conversion follows the page, `convert.md` says so under 'Open questions', and the
corrected row is handed to the kit - this file's source is `shared/skills/ts-convert/` in claude-kit, never a
synced copy.

## Node, read 2026-11-18

| Row | Fact | Source |
|---|---|---|
| type stripping | Node runs a TypeScript file by replacing its types with whitespace: 'enabled by default' from 23.6.0 and 22.18.0, no experimental warning from 24.3.0 and 22.18.0, 'stable' from 25.2.0 and 24.12.0. 'No type checking is performed' | <https://nodejs.org/api/typescript.html> |
| module system by extension | `.ts` takes its module system as a `.js` file does, from the nearest `package.json` `type`; '`.mts` files will always be run as ES modules'; '`.cts` files will always be run as CommonJS modules'; '`.tsx` files are unsupported' | same page, 'Determining module system' |
| import extensions | a relative `import`, `import()` or `require()` of a TypeScript file names it with its extension: `./file.ts`, never `./file` | same section |
| no tsconfig at run time | 'Node.js ignores `tsconfig.json` files': no `paths`, no down-levelling. What a run needs is in the file itself | same page, 'Type stripping' |
| erasable syntax | type stripping errors on `enum` declarations, a `namespace` with runtime code, parameter properties and import aliases (`import x = require()`); a decorator is a parser error | same page, 'TypeScript features' |
| type-only imports | a type is imported with the `type` keyword, or Node treats it as a value import and the run fails | same page, 'Importing types without `type` keyword' |
| --check | 'TypeScript syntax is unsupported in the REPL, `--check`, and `inspect`.' Probed on Node v24.11.0: `node --check` exits 0 on a typed file that has `import` or `export` and 1 on a typed file that has neither - so it is no check of a converted file either way | same page, 'Non-file forms of input'; the probe |
| node_modules | Node refuses a TypeScript file under a `node_modules` folder | same page, 'Type stripping in dependencies' |
| import.meta.main | `true` when the module is the process's entry; 'Equivalent to `require.main === module` in CommonJS'. Added in 24.2.0 and 22.18.0 - so absent from every 23.x - and marked 'Stability: 1.0 - Early development' | <https://nodejs.org/api/esm.html> '`import.meta.main`' |
| import.meta.dirname | `import.meta.dirname` and `import.meta.filename` exist from 21.2.0 and 20.11.0, 'no longer experimental' from 24.0.0 and 22.16.0, on `file:` modules only; `filename` has symlinks resolved | same page |
| JSON import | `import data from './data.json' with { type: 'json' };` - Node supports the `type` attribute with the value `'json'` | same page, 'Import attributes' |
| require of an ES module | `require()` loads an ES module without a flag from 23.0.0 and 22.12.0, without a warning from 23.5.0 and 22.13.0, and is 'no longer experimental' from 25.4.0. The module must be 'fully synchronous (contains no top-level `await`)', else `ERR_REQUIRE_ASYNC_MODULE`. `require()` returns the module namespace object, the default export under `.default` | <https://nodejs.org/api/modules.html> 'Loading ECMAScript modules using `require()`' |
| require of .mts | that section names `.mjs` and `.js` files, not `.mts`. Probed on Node v24.11.0: a CommonJS `.js` file in a package with no `type` field requires `./lib.mts` and reads its named export | the probe; no page states it |
| require inside a cycle | `ERR_REQUIRE_CYCLE_MODULE`: 'a CommonJS to ESM or ESM to CommonJS edge participates in an immediate cycle', which is 'not allowed because ES Modules cannot be evaluated while they are already being evaluated' | <https://nodejs.org/api/errors.html> |

## TypeScript, read 2026-11-18

| Row | Fact | Source |
|---|---|---|
| erasableSyntaxOnly | reports the constructs type stripping cannot erase: `enum` declarations, `namespace`s and `module`s with runtime code, parameter properties, `import =` and `export =` assignments, `<prefix>`-style type assertions | <https://www.typescriptlang.org/tsconfig/#erasableSyntaxOnly> |
| allowImportingTsExtensions | lets an import name a `.ts`, `.mts` or `.tsx` file; 'only allowed when `--noEmit` or `--emitDeclarationOnly` is enabled' | <https://www.typescriptlang.org/tsconfig/#allowImportingTsExtensions> |
| rewriteRelativeImportExtensions | rewrites those extensions 'to their JavaScript equivalent in output files' - of use only where the compiler emits, so a `noEmit` config leaves it out | <https://www.typescriptlang.org/tsconfig/#rewriteRelativeImportExtensions> |
| verbatimModuleSyntax | holds the code to the `type` keyword rule above: an import or export without the `type` modifier is kept as written | <https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax> |
| nodenext | `module: nodenext` is the setting for code Node runs directly: 'You very likely want `"nodenext"` for modern Node.js projects' | <https://www.typescriptlang.org/tsconfig/#module> |

## What follows from the rows

- The entry guard (`conversion-rules.md`, 'CommonJS constructs') uses `import.meta.main` only in a package whose
  `engines.node` range, and the maintainer floor its instruction file gives, admit no version without it: 22.18 or
  newer of the 22 line, 24.2 or newer above it, and no 23.x. Any other package takes the `process.argv[1]` form.
- A converted file that a CommonJS file requires holds no top-level `await` (row 'require of an ES module').
- A cycle that holds a file staying CommonJS stays CommonJS whole (row 'require inside a cycle').
- A maintainer's Node is 22.18 or newer wherever a converted file runs (row 'type stripping'); a repo whose
  `engines` admits less gets that floor written into its instruction file, and `engines` is not changed.
- `node --check` is never a batch check (row '--check').
