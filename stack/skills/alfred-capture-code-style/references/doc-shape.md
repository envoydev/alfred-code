# code-style/CODE-STYLE.md - the merged doc's shape and write protocol

## Contents

- **The domain** - one file, a `##` section per language, `references/` for overflow
- **Section format** - `<!-- id: -->` and `<!-- covers: -->`, and the glob spelling proven against the real engine
- **The five pieces** - what MERGE consolidates the seats' reports into, in order
- **watch.json** - real per-language entries, `sourceRoots` derived from DETECT
- **Write mechanics** - `docs.js set`, mode-agnostic; the folder; what a re-run reconciles

## The domain: one file, a section per language

`<docs-path>/code-style/CODE-STYLE.md` is a docs domain like every other - it carries its own
`watch.json`, so `domains()` in `.claude/hooks/docs.js` picks it up and the engine sections, lints and
watches it exactly like `architecture/` or `decisions/`. Unlike `decisions/`, nothing here is
`notOwned`: this skill is the sole author, so an ordinary write (or an ordinary `docs.js set` on a
branch) is always allowed.

**One file, not one file per language.** Each language gets its own `##` section carrying its own
narrow `covers:` glob - that glob already routes a change in that language to its section, so a second
axis of separation (one file per language) would only cost a reader who wants to compare two languages
side by side. `<docs-path>/code-style/references/` holds anything too long for a section (a long
enforcement-map appendix, a deep per-framework idiom list) - the same hub-and-spoke shape as
`architecture/references/`, created only when actually needed.

## Section format

Every `##` heading in `CODE-STYLE.md` (and any `references/*.md` file) carries its metadata as comment
lines directly under it, same convention as every other domain:

    ## C#
    <!-- id: c-sharp -->
    <!-- covers: src/**.cs -->

- `id` - lowercase slug, unique in the file, kept across heading rewordings. `docs.js seed-ids` adds a
  missing one.
- `covers` - the language's own extensions, as globs. The **Project type**, **Enforcement map** and
  **Cross-cutting idioms** sections carry no `covers:` of their own - they span every language, so no
  single glob would be honest, and they fall back to the file's own union the way an area-wide section
  does everywhere else in this engine.

**The glob spelling is `src/**.cs`, not `src/**/*.cs` - proven against the real engine, not assumed.**
`globRe`'s bare `*` stops at one path segment, so `src/**/*.cs` requires a directory between `src/` and
the filename and MISSES every file sitting directly in `src/` - and that miss lands on exactly the
files a capture cannot afford to miss: measured against the real engine, `src/**/*.cs` misses
`src/Program.cs` and `src/**/*.ts` misses `src/main.ts`, both common entry-point files sitting one level
down. `src/**.cs` and `src/**.ts` match both that file and anything nested deeper (`src/Domain/Order.cs`,
`src/app/sub/foo.component.ts`) - the same `**.md`-over-`**/*.md` lesson `decisions/watch.json` already
proved, restated here because a source-file glob is exactly where the next author reaches for the
plausible-looking spelling instead of the correct one. Test every `covers:` glob against
`node .claude/hooks/docs.js watch <path>` on a temp fixture before it ships in a real capture.

## The five pieces

Read at step 3 MERGE, before the doc is written. The seats' per-language reports are the input; this is
the shape they are consolidated into, in this order. Apply the `markdown-style` skill to the result - it
is a quick reference, not a wall of prose.

1. **One opening line** - the project's actual style; configs stay enforced; this captures what they
   cannot; where this doc and a house convention skill disagree, THIS doc wins.
2. **Project type** - the consolidated verdict from the seats' evidence.
3. **Enforcement map** - one table across languages: language -> config file(s) -> what runs them.
4. **One `##` section per language** - each seat's Enforced + Idioms, merged faithfully into its own
   heading (not a shared 'Per language' parent with the languages as prose underneath): keep every
   'uncertain' / 'inconsistent' marker, never smooth one over, and keep the divergence-from-house-skill
   flags - they are the useful signal. This is the section RULE's extension union and `watch.json`'s
   entries both derive from - one language, one heading, one `covers:`.
5. **Cross-cutting idioms** - what spans languages: file/folder organization, test structure and naming,
   comment density.

**A re-run** reconciles the existing doc against the fresh reports - correct what drifted, add what is
new, drop what is gone, per language section. Never a parallel second doc, and never an append log.

## watch.json

Real entries derived from DETECT and the seats' **Language + extensions** sections, never a template -
one watch entry per language, its globs the same extensions the RULE step's union already used, its
`sections` the language's own `CODE-STYLE#<id>`:

    {
      "sourceRoots": ["src"],
      "watch": [
        { "kind": "C# style", "globs": ["src/**.cs"], "sections": ["CODE-STYLE#c-sharp"] },
        { "kind": "TypeScript style", "globs": ["src/**.ts", "src/**.html", "src/**.scss"], "sections": ["CODE-STYLE#typescript"] }
      ]
    }

`sourceRoots` are the folders this project's code actually lives in - taken from the same DETECT scan
that found the languages, never hardcoded to `src` for a project that keeps code elsewhere. A change
under a language's globs makes the session hook ask whether that language's section still holds - unlike
`decisions/` (a domain a person alone writes, which only warns, never asks), code style gets the
ordinary finish ask, because this domain is written by this skill and a re-run can act on the answer.

## Write mechanics

Same mechanics as every non-protected domain, restated so a re-run never has to guess: create
`<docs-path>/code-style/` and `references/` only when absent; a re-run reconciles the existing file in
place rather than starting a parallel doc.

**On mainline, or without git, MERGE writes the file directly** (Write, same REPLACE-wholesale rule as
the generated rule in step 4: read what exists first, so the write is legal). **On a feature branch
under local/overlay versioning, MERGE lands each changed section through
`node .claude/hooks/docs.js set CODE-STYLE#<id>`** instead of writing the file - the engine puts it in
that branch's overlay under `.branches/`, `docs.js set` stamps the section itself
(`<!-- captured: -->`), and the section folds into mainline by itself at the first mainline session
after the branch merges. **The capture does not check which mode is active** - `docs.js status` names
it, but MERGE calls `set` unconditionally and the engine decides where the text lands; a mode check in
this skill would be a second, driftable copy of a decision the engine already owns. Proven against the
real engine on a temp fixture: a section written with `docs.js set` on a feature branch left the
mainline `CODE-STYLE.md` untouched and was readable through `docs.js show` from that branch; the
mainline file only changes once that branch is promoted or merged.

**Verify the shape before it ships.** `docs.js lint` is the arbiter of whether a `watch.json` is valid -
run it against a temp fixture holding this shape before trusting it; a documented shape that lints red
is worse than no shape, because the next capture copies it verbatim.
