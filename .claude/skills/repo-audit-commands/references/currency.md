# Command audit - Phase 1b currency check

Read at Phase 1b, before any row drives a score or an edit.

Command bodies carry claims about the outside world - a CLI's flags, a package, a version floor, a settings key - and
this audit's own principles and rubric rest on documented harness behaviour. Training-data recall drifts, so these
claims are verified against current documentation - the official Claude Code pages for the harness, the
documentation MCP for a library - never re-asserted from memory. This check changes no dimension weights (scores
stay comparable across audit runs); an unresolved DRIFTED finding blocks the command from A.

1. **Inventory** while scoring Phase 1: collect every externally-verifiable claim in the bodies and the scripts'
   usage lines they quote - a named CLI and its flags, a package, a version floor, a settings key, a 'X does not
   support Y' statement.
2. **The harness facts this audit leans on** are external claims too, re-read from the live pages each run (the
   skills page at <https://code.claude.com/docs/en/skills>, the plugin manifest reference at
   <https://code.claude.com/docs/en/plugins-reference>), since they move between releases. As read on 2026-11-16:
   - a command file is served by the same mechanism as a skill and takes the same frontmatter except `name` and
     `paths`; the file name is the command, a subfolder is a namespace, and a skill wins over a command file of the
     same name;
   - `disable-model-invocation: true` stops the model starting the entry and takes its description out of context;
     `allowed-tools` pre-approves for the invoking turn and `disallowed-tools` removes tools for it;
   - `$ARGUMENTS` is the whole argument string, `$ARGUMENTS[N]` and `$N` count from zero, `arguments` names
     positions, and an argument no placeholder reads is appended as `ARGUMENTS: <value>`;
   - a `` !`command` `` line and a fenced `!` block run before the content reaches the model, a failing one aborts
     the invocation, they are checked against permission rules, and a `disableSkillShellExecution` setting turns
     them off;
   - a listing entry is cut at 1,536 characters, and after a compaction the first 5,000 tokens of each invoked
     entry return under a shared 25,000-token budget;
   - in a plugin, the manifest's `commands` key replaces the default `commands/` scan, a map entry sets exactly one
     of `source` or `content`, commands are typed as `/<plugin>:<command>`, and the plugin root, plugin data and
     project variables are substituted in the body but are not in the environment of a shell tool call.
   Whether an argument is substituted into a pre-run shell line before it runs is not stated on those pages: treat
   it as unsafe until the live page or a run in the repo's sandbox says otherwise.
3. **Prioritize** what a release can invalidate: version-named claims, flag syntax, support statements. House
   judgment (naming, tone, which step asks) has no external truth to check - skip it.
4. **Verify, bounded**: group the claims by tool or library; per library, one `resolve-library-id` plus at most 2-3
   `query-docs` calls covering the whole batch. Cap ~15 libraries per run - the long tail rolls to the next audit and
   is listed as unchecked, and a run starts with the unchecked list of the last audit's report, where one is on
   disk, so a claim is not left unchecked run after run. The documentation server unreachable, or not among this
   seat's tools: fetch the official page itself - its `.md` form where the site serves one - and quote the line
   found, saying in the report that the lookup went to the page. The page route is bounded too: one fetch per page
   where it comes back whole, kept as a file in the run folder that answers every later claim on it; a page longer
   than one fetch returns is read on by offset until the claim's section is reached; and a DRIFTED verdict rests
   on the passage fetched word for word, since a fetch that answers through a summary can paraphrase. Where only a
   summary can be had, the claim is listed as unchecked - never CURRENT or UNVERIFIABLE - with what the summary
   said beside it, and it is in the unchecked list the next audit starts with. A claim whose summary reports a
   contradiction blocks its item from A, as a DRIFTED one does, until the passage is read word for word - then
   it takes the verdict the passage gives; a summary that reports agreement leaves the claim unchecked, never
   CURRENT. Mark the check SKIPPED in the report only when neither can be reached, and move on; never substitute
   recall for the lookup.
5. **Verdict per claim**: CURRENT (docs agree) | DRIFTED (docs contradict - a MATERIAL finding) | UNVERIFIABLE
   (docs silent - recorded, not a finding). Record the table (source, claim, verdict, evidence line) in the baseline
   report. A sentence in quotation marks that a file attributes to a page is a row of its own - a line that quotes
   two pages is two rows - and under the table goes the list of pages read: a page a target names that is not in
   that list is an unchecked claim and is listed as one.
6. **Remediation routing** for DRIFTED: fix it in Phase 2 - and when the drifted content is version-coupled detail
   (a flag list, a per-release config block), prefer REPLACING it with the durable instruction plus a fetch-at-use
   step (the tool's own `--help`, the documentation server at usage time) over updating the number: judgment stays
   in the artifact, drifting facts are fetched live.
