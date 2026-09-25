# Token-Reduction Policy - lean work and report terseness

Token reduction is a policy, not ad-hoc instructions repeated in every agent. Two disciplines do different jobs: lean work cuts unnecessary work and code (the big lever); report terseness cuts output verbosity (a smaller, selective lever). Both are inline-only, and for the same reason. Report terseness was the Caveman plugin until measurement showed that plugin's SessionStart hook never fired inside a dispatched seat, so it saved nothing in a multi-subagent flow while adding its descriptions to every context. Lean work came from a third-party plugin until 2026-09-12, when an audit measured 0 invocations across 115 sessions, a SubagentStart injection of ~1,310 tokens per seat for a ladder 34 agent bodies already carry in full, and a standing contradiction with the house rule banning shortcut markers in code comments. Both plugins are dropped; the seat bodies are the only home of the disciplines, under the house terms below.

## Lean work - the primary lever

Lean work is primary because it reduces the work itself, not just the words. Each seat class runs the discipline its role needs: the seats that write code build lean, the seats that plan question the need, the seats that judge code run the over-build review.

```yaml
lean_work:
  implementers: build lean
  repair_agents: build lean              # applied to a repair: the smallest correct edit, then stop
  domain_verifiers: over-build review    # hunt over-build past the plan
  solution_designers: question the need  # smallest plan that fully meets the requirement
```

Core behavior expected from an implementer ('build lean'):

```text
1. Do not write code if configuration, existing code, or deletion solves it.
2. Search for an existing pattern before adding a new abstraction.
3. Prefer a framework / native / stdlib feature before a new dependency.
4. Implement the smallest change that satisfies the contract and acceptance criteria.
5. Do not future-proof speculatively.
6. Record each deliberate simplification in the closing report as a `where | limit | revisit when` row ('OrderLock.Acquire | global lock | throughput matters - per-account locks') - never as a code comment; the close files the rows in the architecture docs' Known ceilings section.
7. Never cut security, accessibility, validation, data-loss prevention, or migration safety to get smaller.
```

Verifier / reviewer checks ('over-build review'):

```text
Did the seat overbuild? Add an abstraction with one caller? Add a dependency
where the framework/BCL already ships one? Duplicate an existing utility?
Change more files than the task required? Can the diff shrink without losing
correctness or safety? Over-build past the plan is a finding; re-opening scope
the plan deliberately included is the designer's call, not the verifier's.
```

This is why each seat already names its discipline inline - designers 'question the need', implementers and repair resolvers 'build lean', verifiers 'over-build review'. The integration-reviewer runs NO over-build review - over-build is already hunted per stack by the domain verifiers; it carries report-lean only. This policy is the shared statement of why.

## Report terseness - selective only

Report terseness mainly shrinks output tokens. It does not reduce file reads, tool output, reasoning, or repeated context, so it is a tail-trim, not a primary lever. Apply it only where output volume is real and readability is not at a premium.

Good uses: compact implementer final reports, verifier and integration punch-lists, repair-agent summaries, commit messages, and PR comments.

What 'lean' means mechanically (tokenizer-true): drop filler, hedging, and tool-call narration; prefer the short common word (fix, not 'implement a solution for'). Do NOT invent abbreviations (cfg/impl/req/res/fn) - BPE splits them the same as the full word, so they save zero tokens while costing the reader decode effort - and do not build arrow chains (a `->` glyph is its own token; words are no more expensive and stay unambiguous). Identifiers, API names, commands, and error strings stay verbatim always.

Avoid terseness for: BA requirements clarification, cross-stack contract output, alfred-task-design docs, security-audit reports, final architecture decisions, and Contract Change Requests - anything that must stay highly readable. Those are the high-readability seats that carry NO terseness line; the report / punch-list seats carry the inline 'Report lean.' discipline in their bodies.

**Mechanism note (measured):** report terseness is a discipline each seat applies INLINE in its own final report - hand back byte-exact code and a compressed explanation - the same inline-discipline model lean work uses ('build lean' / 'over-build review' named in each body). Why the Caveman plugin that once carried it was dropped is at the top of this file; the inline discipline is the whole of what it contributed. Keep the ceiling honest: terseness only shrinks the report's words, never the seat's input context, tool output, or reasoning - which dominate its token count - so the mode ladder (fewer seats) and capability-reuse (leaner context) are the levers that actually move seat tokens; this one trims the tail.

## Combined configuration

```yaml
token_reduction_policy:
  lean_work:
    implementers: build lean
    repair_agents: build lean
    verifiers: over-build review
    designers: question the need
  report_terseness:            # inline discipline in each report / punch-list seat (was the Caveman plugin, now dropped)
    reports: lite
    punch_lists: lite
    commit_messages: lite
    pr_comments: lite
    contracts: off
    solution_design: off
    security_audit: off
```

## The third lever - eager context and redundant reads

Lean work cuts the work, report terseness cuts the words; the third lever cuts the context a seat loads - load only the certain-use skill or MCP, navigate with serena, reach for context7 before a library API, and let a verifier orient from the implementer's memory note plus the diff instead of re-reading the whole module. The per-role wiring and the mechanisms live in `capability-reuse.md`, which also holds the safety floor: the verifier still runs the gates independently and never trusts the note in place of running the gate.

## The fourth lever - quiet the command output

The tool's own output is context you pay for, so run every gate at minimal verbosity rather than letting it stream a wall of text: `dotnet test -v minimal` (or `--logger "console;verbosity=minimal"`), `nx <target> --output-style=static`, `tsc --pretty false`, `git --no-pager status --short`. Then window a failing log to the first real error instead of pasting the whole run - the evidence-gatherer already does this for the diagnosers, and any seat running a build / test / lint gate should do the same. This is a cheaper, dependency-free version of a shell-output compressor: cut the noise at the source instead of filtering it after.

## The fifth lever - a Sonnet orchestrator

The main-session orchestrator that drives `alfred-task-solve-cross` does not need Opus. Its job - classify the request, dispatch the pinned seats, review each returned diff, run the final gate - is well within Sonnet, because the Opus intelligence is delivered by the `solution_designer` seat, which stays Opus by its own frontmatter pin regardless of the session model. So drive the flow session on Sonnet (`claude --model sonnet`); the pins keep Opus where it earns its cost (design), not where it does not (routing). This is a launch-time choice, not an agent pin - there is no lever to fix the orchestrator model from inside the stack, so it lives here as the recommended way to run the flow.

MEASURED (B3, aspnet, single run): a Sonnet orchestrator cost **$9.23 vs $12.77** on an Opus orchestrator - **28% cheaper** - with the designer still Opus (pins held), the verifier still catching a real defect, and the suite green.

Three trims that did NOT pay off on the same cell, so they are not levers - do not re-try them: dropping the verifier from `xhigh` to `high` cost slightly MORE (lower effort ran more turns for the same result); moving the evidence-gatherer to Haiku saves nothing (the diagnosers dispatched it 0 times across 9 cells); and raising the auto-compact threshold does nothing on a medium feature (16 turns never approaches the 400k trigger). The audited model / effort pins stand; the orchestrator model is the one place Sonnet is a free win.

Never let lean-work minimalism or report terseness cut a security check, validation, authorization safeguard, audit log, migration safety, or data-loss protection. Smaller is a means, not a license.

Two invariants bind the output-shaping levers specifically - windowing a failing log to its first real error (lever 4) and compressing an explanation (lever 2) both drop text, and two things must always survive the cut. First, the failure signal: the actual error and the non-zero exit have to reach the report intact, so a windowed log or a terse summary can never make a red gate read as green - if you shorten a failing run, prove it still failed. Second, secret hygiene: a credential that appears in raw tool output - a token, connection string, key, or password - must be redacted in the excerpt you quote, never copied verbatim into the report or the parent context just because it happened to sit next to the error you were keeping. Quoting less output is not a license to quote a secret.
