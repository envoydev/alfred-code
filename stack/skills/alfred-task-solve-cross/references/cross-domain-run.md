# Cross-Domain Run - the Producer-First Protocol

Read by `alfred-task-solve-cross` the moment the mode is `cross_domain_light` or `full_cross_domain` (the verifier-less `cross_without_domain_verifiers` runs the same sequence minus the domain-verifier seats - the integration-reviewer is then the only independent gate, and its brief says so). The ledger line `cross-domain protocol: read` is the receipt that this file was loaded this run; a cross-domain run whose ledger lacks it re-improvised the protocol.

## The sequence

```text
Requirements clarified, scope + dependency direction established (above)
  -> PRODUCER designer runs first (the upstream side per the dependency direction);
     the interface section of its plan IS the contract - record it in the ledger
  -> full_cross_domain only: CONSUMER designer validates the seam against its side's needs
     BEFORE anything is built - a misfit loops back to the producer designer at design cost
  -> producer + consumer verticals build (each internally sequential: implementers -> verifier;
     consumer implementers are briefed from the recorded interface)
  -> integration-reviewer gates the assembled whole  (final gate, mandatory)
  -> optional security-auditor if the risk requires
  -> commit only after the integration gate signs off
```

The producer designer's interface is recorded in the ledger before any consumer seat is briefed - routes, DTOs, error envelope, auth policy, whatever the seam carries. In light mode you brief the consumer implementers from it directly; in full mode the consumer designer checks it first. Either way the seam is written down once and every brief cites it.

The plan gate (the in-session `alfred-task-verify-plan` audit, five passes recorded by name) and the plan review stop (the user reads the gated plan and the recorded contract before any implementer spends anything) run between the producer designer's return and the first implementer dispatch - both are the skill body's, not this file's, and neither is skipped because the protocol here is long. Consumer implementers are briefed from the recorded interface, never from the producer plan's prose; a seat that finds the interface does not fit its side stops and emits BLOCKED_CONTRACT_CHANGE per `references/contract-protocol.md` - pause only the affected lanes, revise with the producer designer, record v2, re-brief, verify against v2 only.

When frontend and backend live in different repositories, run one flow per repo joined by the same recorded interface and the same final gate - `references/repo-separation.md`.

## Example - one routed run

'Add CSV export to the orders page' - the ask is crisp (columns and filter named), so no clarification pass:

1. Scope in-session: the related-context entries say the Angular client consumes the ASP.NET API; the export touches both -> backend produces, frontend consumes, routine seam -> **cross_domain_light**.
2. Dispatch the producer's solution-designer seat (here the .NET web one). Its plan's interface section - the export route, csv response shape, error envelope, existing orders auth policy - is recorded in the ledger as the seam.
3. Run the aspnet vertical; brief the angular implementer(s) from the recorded interface and run the angular vertical (implementers -> verifier).
4. Both domain verifiers sign off -> dispatch integration-reviewer; it probes the seam (content type, empty-result shape, auth on the new route) and signs off.
5. Commit - authorized by the integration gate, not the domain sign-offs - and close out the ledger.
