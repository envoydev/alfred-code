# Usage audit - finding shape and statuses

Read before the first finding is written - every audit file, the summary and Phase C use this shape.

Every finding, everywhere, uses one shape - the clustering depends on it:

```
- [SEVERITY] [category] <one-line defect> | evidence: <session id + locator + measured number> | home: <exact stack file> | status: OPEN / FIXED-SINCE <ref> / PARTLY FIXED <ref> / NOT-STACK | fix: <the smallest mechanism that removes it>
```

Severity: `BLOCKER` (a wrong result shipped, or a gate failed to catch one), `MATERIAL` (a broken
contract with real consequence, or measured avoidable cost), `MINOR`. Categories:
`protocol-violation`, `wrong-behavior`, `token-waste`, `missing-mechanism`, `report-integrity`,
`docs-and-gates`, `user-friction`.

**The four statuses, and what each one costs to claim:**

- `FIXED-SINCE <ref>` is a claim about the LIVE tree and is verified there before it is written -
  open the named file at HEAD (or in the working tree, saying which) and read the clause that
  closes the finding. A release note, a changelog line, another audit file's stamp, or your own
  memory of having fixed it are none of them evidence (measured: two FIXED-SINCE stamps in one
  campaign were written off a remembered edit; re-reading the source proved one defect fully live).
- `PARTLY FIXED <ref>` is the honest home for a mitigation that is real but not the mechanism the
  finding asked for - prose where a gate was needed, a measurement where an enforcement was needed,
  a fix that closes three of four routes. The stamp SAYS which half landed and names the residual in
  its own words. Without this status the two failure modes are a false FIXED and a stale OPEN, and a
  campaign that has neither word for it produces both.
- `NOT-STACK` covers a defect no stack file owns: the audited project's own code, the harness, and
  the audit's OWN output. That last class is large and predictable - a defect in a bundle's
  `report-usage.md`, a `SUMMARY.md`, or the report-generation prompt is a local artifact, so close
  it `NOT-STACK` and route the durable half to the stack skill that owns that work
  (`alfred-capture-stack-usage`), naming the rule that landed there.
- `OPEN` is a transient state, never a verdict. A finding is OPEN only between the audit that filed
  it and the routing answer that dispositions it - see Phase C's close-out.

**Bulk stamping is allowed, per HOME, never per finding-count.** A cluster of N findings sharing one
home closes with one verification of that home's live source and one stamp text naming the mechanism
that closed it. Never stamp by pattern-match on the finding's own words: the same sentence appears
in findings the mechanism does not reach.
