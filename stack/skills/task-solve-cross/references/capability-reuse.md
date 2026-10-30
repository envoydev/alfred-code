# Capability Reuse - wire the installed capability, never re-derive it

Reuse is a cost lever, not a tax on the budget. A seat that guesses an API signature or a framework version burns tokens twice - once on the guess, again on the rework pass when the guess is wrong - while the right capability returns the exact detail cheaply and inline. So capability wiring is part of each mode's design, not an afterthought.

The test for every capability on every seat: does it remove a guess, a re-derivation, or a pass? If yes, wire it in. If not, leave it off - an eager-loaded unused tool description or plugin is the same waste as an unused skill.

The stack ships no MCP server: each job - navigation, library docs, a browser, a desktop or a mobile app - is done with the tools the session-start tool order ranks for it, the built-ins (the `LSP`, `Grep`, `WebFetch`) where the user registered nothing. So a brief names the job, not a server the seat may not see; a seat that cannot reach a job's tools works from what is loaded and reports the check it would have run as UNVERIFIED, never a guess dressed as a result.

## Per-role wiring

| Role | Wires in | Removes |
|---|---|---|
| Orchestrator (the main session) | the committed architecture docs + the seam catalog to scope and route; code reads ONLY in a domain it will run inline itself - a domain it is about to dispatch a designer into is briefed with docs + requirements, and the code is read by that designer (measured: an orchestrator that pre-read a delegated domain bought the same reads twice) | a pre-read of a delegated domain, a scoping pass that re-derives what the architecture docs already say |
| Solution designers | the house domain skills (preloaded), the documentation tools for a version-gated API or feature, `<docs-path>/awareness/ARCHITECTURE-AWARENESS.md` plus its `<docs-path>/awareness/references/` detail (the durable committed map) and the navigation tools for the repo's existing architecture, its own earlier handoff note for the prior frozen contract | a re-derived architecture, a wrong version assumption, a re-frozen contract |
| Implementers | the house skills (loaded up front), the stack LSP plugin (csharp-lsp / typescript-lsp - inline diagnostics catch an error at edit time, so it does not bounce back from the gate as an extra fix round), the documentation tools before writing against any library API, the architecture docs (`<docs-path>/awareness/ARCHITECTURE-AWARENESS.md` + `<docs-path>/awareness/references/`) read at start to place the task without re-deriving the structure, the navigation tools for symbol navigation, a handoff-note read at start and write at hand-off | a fix-loop bounce, a version-guess rework, a whole-file read |
| Verifiers + integration reviewer | orient from the architecture docs, the implementer's handoff note and the diff, then INDEPENDENTLY run the gates and navigate the specific concerns with the navigation tools; the security review `alfred-security.md` defines, on a seat gating auth / data / migration; the browser tools only where a live browser is the only real proof (absent them, that check is reported NOT RUN) | a redundant full re-read (see Redundant reads below) |
| Diagnosers | the architecture docs to orient in the system, the navigation tools to locate the implicated symbol, a grep of `<docs-path>/work/diagnoses/` for a matching error signature and its proven fix, a read-only evidence-gatherer for the log and repro volume (kept off the opus seat) | a re-slurped log, a root cause a prior run already found |
| Repair resolvers | the stack LSP plugin, the navigation tools, a grep of `<docs-path>/work/diagnoses/` for the same error signature's prior fix | a re-derivation of a recurring fix |
| Evidence gatherer | the navigation tools and read-only Bash - no documentation tools (single-run, hands its digest straight back) | its own context cost - it stays the cheapest seat |

## Cross-cutting disciplines

- **The library docs before a library API, always.** A wrong package or framework version is a common rework trigger; the current signature from the documentation tools is cheaper than the failed build it prevents. Never write against a recalled version - where no docs source is reachable, the claim is marked unverified in the report, not asserted. This extends past API signatures to framework runtime semantics - signal / computed reactivity, change-detection, lifecycle order: cite the documentation tools or the house convention skill before resting correctness on a recalled semantic, never a guess.
- **Clarify before freezing, verify before closing.** Run `habits-clarify` (SKILL.md's clarify gate) before freezing a contract
  on genuinely ambiguous design; route the done gate (`habits-done-gate`) to the closing seat (the domain
  verifier or the integration reviewer). An optional workflow-skills plugin's DISPATCH skills, where the install
  has one - a parallel-agents one, a subagent-driven one - are superseded here and are not a second route in: the house flows are the entry points for multi-agent work, dispatch is explicit and never automatic, and the dispatch guard blocks an implementer that carries no approval stamp.
- **Keep the shared instruction file sharp.** A flow that depends on a stale AGENTS.md pays for it in every seat
  that loads it. Where the install has the tool that audits and revises an instruction file from what a session
  learned, use it rather than letting each seat work around the drift; it is an opt-in, so a project without it
  fixes the file by hand instead.
- **Minimal-code and report terseness** are the token-reduction disciplines, per `token-reduction.md`. Each seat
  carries its own rung inline - designers 'question the need', implementers and repair resolvers 'build lean', verifiers 'over-build review' -
  so the discipline is the seat's, never a plugin's; the stack ships no plugin for it.

## Redundant reads

Two seats reading the same module is double cost. The handoff note is what removes it: the implementer stores a compact note (findings, deviations, decisions) at hand-off on the handoff bus (`node .claude/hooks/handoff.js put`), and the verifier reads that note plus the diff to orient - it does not re-read the whole module from raw files.

Handoff notes are read by exact name, never searched - so the name is the contract between writer and reader: derive their parts verbatim from the frozen contract (the `feature` and `contract_version` exactly as the dispatch spells them, so both sides agree). Name each note `<feature>/<contract_version>/<seat>`; a seat that runs one instance per task in parallel (the implementers) appends its task - `<feature>/<contract_version>/<seat>/<task>` - so two parallel implementers on one feature never clobber a shared name. A note is one `node .claude/hooks/handoff.js put <name>` with the note on stdin; the bus keeps it in the main checkout's `<data root>/state/handoff/<feature>.jsonl`, so the project fences the store and a worktree seat writes where the next seat reads. The reader never reconstructs a seat's name: it calls `node .claude/hooks/handoff.js list <feature>/<contract_version>`, which prints that run's notes and nothing else (every parallel implementer's note included), newest first, the newest note per name winning; a seat reading its own earlier pass lists its own exact name. The handoff is best-effort on top of the unchanged dispatch-in / report-out path: a miss - a fresh clone, a first run, an absent note - is a clean 'no prior note', the seat re-derives and never blocks.

The safety floor holds regardless: the verifier still INDEPENDENTLY runs the build and the tests and navigates the concerns the note names with the navigation tools. It orients from the note; it never trusts the note in place of running the gate. An EXPENSIVE one-off proof the implementer already ran and recorded - a regression spec proven red against the pre-fix code, a captured repro - is CONFIRMED from that recorded artifact plus a spot check, not re-derived from scratch: the build and the test suite are always re-run, but the bespoke repro the note already proves is confirmed, not rebuilt. Same rule for the integration reviewer over the assembled whole - orient from the domain verifiers' notes and the diff, then run the assembled gates itself.

## The rule

Eager-load only the certain-use capability. Navigation-tool symbol reads, never a whole-file `Read` of a large source - an implementer locates the exact edit target before Editing, never Reading a file to locate what the navigation tools can point to. A compact handoff note read at start beats re-deriving prior findings, and reading `<docs-path>/awareness/ARCHITECTURE-AWARENESS.md` (+ `<docs-path>/awareness/references/`) beats re-deriving the project's structure - the durable map lives in the docs, the transient handoff in the note. The capability that removes a guess or a pass pays for itself; one that does not is the same waste as an unused skill.
