# Capability Reuse - wire the installed capability, never re-derive it

Reuse is a cost lever, not a tax on the budget. A seat that guesses an API signature or a framework version burns tokens twice - once on the guess, again on the rework pass when the guess is wrong - while the right capability returns the exact detail cheaply and inline. So capability wiring is part of each mode's design, not an afterthought.

The test for every capability on every seat: does it remove a guess, a re-derivation, or a pass? If yes, wire it in. If not, leave it off - an eager-loaded unused MCP description or plugin is the same waste as an unused skill.

Only serena is locked into every install. The rest of the baseline's servers - the library-docs one (context7), the browser driver (playwright), the cross-project memory store - and the stack ones are wired where the project kept them (the baseline comments out what a project does not need), so a brief names the capability, not a server the seat may not see; a seat that cannot reach one works from what is loaded and reports the check it would have run as UNVERIFIED, never a guess dressed as a result.

## Per-role wiring

| Role | Wires in | Removes |
|---|---|---|
| Orchestrator (the main session) | the committed architecture docs + the seam catalog to scope and route; code reads ONLY in a domain it will run inline itself - a domain it is about to dispatch a designer into is briefed with docs + requirements, and the code is read by that designer (measured: an orchestrator that pre-read a delegated domain bought the same reads twice) | a pre-read of a delegated domain, a scoping pass that re-derives what the architecture docs already say |
| Solution designers | the house domain skills (preloaded), the context7 MCP for a version-gated API or feature, `<docs-path>/architecture/ARCHITECTURE.md` plus its `<docs-path>/architecture/references/` detail (the durable committed map) and serena for the repo's existing architecture, a memory recall of the prior frozen contract | a re-derived architecture, a wrong version assumption, a re-frozen contract |
| Implementers | the house skills (loaded up front), the stack LSP plugin (csharp-lsp / typescript-lsp - inline diagnostics catch an error at edit time, so it does not bounce back from the gate as an extra fix round), the context7 MCP before writing against any library API, the architecture docs (`<docs-path>/architecture/ARCHITECTURE.md` + `<docs-path>/architecture/references/`) read at start to place the task without re-deriving the structure, serena for symbol navigation, a memory read at start and write at hand-off | a fix-loop bounce, a version-guess rework, a whole-file read |
| Verifiers + integration reviewer | orient from the architecture docs, the implementer's memory note and the diff, then INDEPENDENTLY run the gates and serena-navigate the specific concerns; the security-guidance hooks, where installed, on a seat gating auth / data / migration; the browser-driving MCP only where a live browser is the only real proof (absent it, that check is reported NOT RUN) | a redundant full re-read (see Redundant reads below) |
| Diagnosers | the architecture docs to orient in the system, serena to locate the implicated symbol, a memory recall of a matching error signature and its proven fix, a read-only evidence-gatherer for the log and repro volume (kept off the opus seat) | a re-slurped log, a root cause a prior run already found |
| Repair resolvers | the stack LSP plugin, serena, a memory recall of the same error signature's prior fix | a re-derivation of a recurring fix |
| Evidence gatherer | serena and read-only Bash only - no memory, no context7 (single-run, hands its digest straight back) | its own context cost - it stays the cheapest seat |

## Cross-cutting disciplines

- **The library docs before a library API, always.** A wrong package or framework version is a common rework trigger; the current signature from the docs MCP (context7 where the project kept it) is cheaper than the failed build it prevents. Never write against a recalled version - where no docs source is reachable, the claim is marked unverified in the report, not asserted. This extends past API signatures to framework runtime semantics - signal / computed reactivity, change-detection, lifecycle order: cite context7 or the house convention skill before resting correctness on a recalled semantic, never a guess.
- **Clarify before freezing, verify before closing.** Run `alfred-habits-clarify` (SKILL.md's clarify gate) before freezing a contract
  on genuinely ambiguous design; route the done gate (`alfred-habits-done-gate`) to the closing seat (the domain
  verifier or the integration reviewer). An optional workflow-skills plugin's DISPATCH skills, where the install
  has one - a parallel-agents one, a subagent-driven one - are superseded here and are not a second route in: this skill is the single entry point for multi-agent work, the
  capabilities rule says dispatch is explicit and never automatic, and the house dispatch guard denies a run
  started any other way. So the phrasing that fires them ('two independent tasks', 'execute this plan in
  parallel') lands on this skill, and their firing costs a denial and a retried turn.
- **Keep the shared instruction file sharp.** A flow that depends on a stale CLAUDE.md pays for it in every seat
  that loads it. Where the install has the tool that audits and revises an instruction file from what a session
  learned, use it rather than letting each seat work around the drift; it is an opt-in, so a project without it
  fixes the file by hand instead.
- **Minimal-code and report terseness** are the token-reduction disciplines, per `token-reduction.md`. Each seat
  carries its own rung inline - designers 'question the need', implementers and repair resolvers 'build lean', verifiers 'over-build review' -
  so the discipline is the seat's, never a plugin's; the stack ships no plugin for it.

## Redundant reads

Two seats reading the same module is double cost. The memory handoff is what removes it: the implementer stores a compact note (findings, deviations, decisions) at hand-off in serena's per-project memory, and the verifier reads that note plus the diff to orient - it does not re-read the whole module from raw files.

serena memory is local to this project and addressed by name, not searched - so the name is the contract between writer and reader: derive its parts verbatim from the frozen contract (the `feature` and `contract_version` exactly as the dispatch spells them, so both sides agree). Name each note `<feature>__<contract_version>__<seat>`; a seat that runs one instance per task in parallel (the implementers) appends its task - `<feature>__<contract_version>__<seat>__<task>` - so two parallel implementers on one feature never clobber a shared name. The reader never reconstructs an exact name: it `list_memories` and prefix-matches `<feature>__<contract_version>` plus the seat it wants, collecting every match (so it picks up all the parallel implementers' notes). No shared-store collision can occur - the notes live under this project's own `.serena/`, so the failure mode of a shared, semantically-searched DB (an unrelated project's note outranking yours, a bare `v2` colliding across features) is gone. The handoff is best-effort on top of the unchanged dispatch-in / report-out path: a name miss - a fresh clone, a first run, an absent note - is a clean 'no prior note', the seat re-derives and never blocks.

The safety floor holds regardless: the verifier still INDEPENDENTLY runs the build and the tests and serena-navigates the concerns the note names. It orients from the note; it never trusts the note in place of running the gate. An EXPENSIVE one-off proof the implementer already ran and recorded - a regression spec proven red against the pre-fix code, a captured repro - is CONFIRMED from that recorded artifact plus a spot check, not re-derived from scratch: the build and the test suite are always re-run, but the bespoke repro the note already proves is confirmed, not rebuilt. Same rule for the integration reviewer over the assembled whole - orient from the domain verifiers' notes and the diff, then run the assembled gates itself.

## The rule

Eager-load only the certain-use capability. serena symbol reads, never a whole-file `Read` of a large source - an implementer `find_symbol`s the exact edit target before Editing, never Reading a file to locate what serena can point to. A compact memory note read at start beats re-deriving prior findings, and reading `<docs-path>/architecture/ARCHITECTURE.md` (+ `<docs-path>/architecture/references/`) beats re-deriving the project's structure - the durable map lives in the docs, the transient handoff in the note. The capability that removes a guess or a pass pays for itself; one that does not is the same waste as an unused skill.
