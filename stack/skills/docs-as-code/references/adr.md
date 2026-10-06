# Architecture Decision Records

One ADR captures ONE architecturally significant decision - a change to structure, non-functional
characteristics, dependencies, interfaces, or construction technique. The collection is the
decision log: the reason a future maintainer is not stuck 'blindly accepting or blindly changing'
what they inherit.

## Contents

- Core rules
- Nygard format (the default - lightest ceremony), with a worked ADR
- MADR 4 (when options were genuinely weighed), with a worked ADR
- Operational discipline (what actually decides success)
- House integration
- Checklist

## Core rules

- **One decision per record. Short** - one or two pages, so it gets read.
- **Immutable** - never rewrite an accepted ADR; write a new one and mark the old
  `superseded by ADR-NNNN` (both link to each other). Adding newly discovered consequences later
  is allowed - that is additive, not mutation.
- **Numbered by the engine, never by hand**: `node .claude/hooks/docs.js adr new '<title>'` takes
  the next number under `<docs-path>/decisions/`, writes the `NNNN-<slug>.md` skeleton (Nygard,
  status Proposed) and rewrites the `DECISIONS.md` index table - then fill the record. A project
  whose ADRs already live elsewhere keeps its own numbering there.
- **Written for a future developer**: full sentences, active voice ('We will ...'), inverted
  pyramid, consequences stated honestly - positive, negative, AND neutral.
- Status lifecycle: proposed -> accepted -> deprecated / superseded. Never delete. After a status
  change, `docs.js adr index` carries it into the table.

## Nygard format (the default - lightest ceremony)

Five sections: **Title** (numbered noun phrase naming the decision), **Status**, **Context** (the
forces - technical, business, constraints - neutral and factual), **Decision** ('We will ...'),
**Consequences** (all of them).

```markdown
# ADR-0001: Use PostgreSQL over SQL Server for the primary datastore

## Status
Accepted

## Context
New multi-tenant SaaS on ASP.NET Core; the team knows both PostgreSQL and SQL Server.
Licensing cost at scale, native JSONB, and cross-platform container deployment are the
key forces. No dependency on SQL Server-only tooling.

## Decision
We will use PostgreSQL as the primary datastore, accessed via EF Core with Npgsql.
JSONB holds semi-structured tenant metadata.

## Consequences
Positive: no per-core licensing; first-class JSONB; smaller Linux containers.
Negative: the team must learn Postgres operational tooling; existing T-SQL snippets
must be rewritten.
Neutral: local dev runs Postgres in Docker rather than LocalDB.
```

## MADR 4 (when options were genuinely weighed)

Adds the tradeoff analysis and metadata. Sections in order: optional YAML front matter
(`status:`, `date:`, `decision-makers:`, `consulted:`, `informed:`), title,
**Context and Problem Statement**, optional **Decision Drivers**, **Considered Options**,
**Decision Outcome** ('Chosen option: "...", because ...') with nested **Consequences**
(Good/Bad bullets) and **Confirmation** (how compliance is verified - in this house an
architecture fitness test beats a review promise, where the stack has them), then optional
**Pros and Cons of the Options** and **More Information**.

```markdown
---
status: "accepted"
date: 2026-02-10
decision-makers: [tech lead, backend guild]
---

# Adopt CQRS for the Orders bounded context

## Context and Problem Statement
Orders mixes complex write-side invariants with heavy read-side reporting; one EF Core
model causes lock contention and awkward DTO mapping. How should reads and writes be
structured?

## Considered Options
* Single shared EF Core model (status quo)
* CQRS with separate read models
* Full event sourcing

## Decision Outcome
Chosen option: "CQRS with separate read models", because it decouples the scaling
concerns without the operational cost of event sourcing.

### Consequences
* Good, because read and write sides evolve and scale independently.
* Bad, because eventual consistency between the models adds complexity.

### Confirmation
An architecture test asserts command handlers never query read models directly;
a load test holds read-side p95 under 200ms.
```

Pick Nygard for brevity; MADR when the options analysis or the Confirmation step carries value.
For MADR, restructure the skeleton `adr new` wrote - the index reads `status:` from the front matter.

## Operational discipline (what actually decides success)

Teams that fail at ADRs use the same templates as teams that succeed - the difference is
operational, not editorial:

- **PR-based review**: the ADR is authored in a pull request - `proposed` in the PR, `accepted`
  on merge. The discussion IS the review trail.
- **Definition of done**: an architecturally significant change is not done without its ADR
  written or superseded; an ADR is not done until the decision is implemented.
- **An index**: an unfindable log loses trust and dies. Under `<docs-path>/decisions/` the
  `DECISIONS.md` table is generated from the records by `adr new` / `adr index` - never edit it by
  hand. An ADR home elsewhere keeps its own index (adr-tools, the dotnet-adr global tool, Log4brains).
- **Granularity**: ADR the load-bearing decisions (session state placement, consistency model,
  monolith vs split). Skip the trivial (CSS framework) and the cosmic ('we will be cloud-native')
  - the classic dead log is full of both and missing the decisions that mattered.
- **Revisit** after about a month: append how the consequences actually played out.

## House integration

How the repo's architecture capture consumes the decision log at ORIENT is
`capture-architecture`'s protocol - this file owns only the ADR format it reads. Keep
rationale here, not on diagrams - a diagram shows the outcome and links the ADR that chose it.

## Checklist

- One decision, short, numbered by `docs.js adr new`.
- Superseded, never rewritten or deleted; supersede links run both ways.
- All consequences listed, negative included.
- Reviewed via PR; part of the definition of done; indexed.
- Load-bearing decisions only - not trivial, not cosmic.
- MADR's Confirmation names a verifiable check, ideally an architecture test.
