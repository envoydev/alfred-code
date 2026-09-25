---
name: dotnet-architecture
description: "Use when choosing or holding a .NET application architecture - where code belongs, layering or slicing, service and module boundaries, drift review - or when the user says clean architecture, vertical slice, DDD, modular monolith, microservices or bounded context. Not for architecture tests (the architecture fitness-test skill) or SQL tuning (the database skills)."
---

# dotnet-architecture (decision hub)

Decide the shape, then load the one style you chose. **Per-style depth lives in references - load exactly the ones your decision selects:**

- Layered internal structure -> `references/clean-architecture.md`
- Feature-sliced internal structure -> `references/vertical-slice.md`
- Rich domain (aggregates, invariants) -> `references/ddd.md` (additive - layers onto clean or vsa, does not replace it)
- Distinct bounded contexts in one deployable -> `references/modular-monolith.md`
- Independently deployed/scaled boundaries -> `references/microservices.md`

## Pick one, then commit

- **One internal style per codebase (or per module).** Clean and vertical-slice side by side means neither - a reader can't predict where anything lives.
- **In an established codebase the existing architecture wins.** Match it exactly; never introduce a 'better' second pattern.
- **Greenfield is a deliberate choice.** Load one style reference and build to it.
- **Record the choice where the project keeps decisions** - the style picked, the two alternatives rejected, and why - so the next reader inherits the reason and not just the folder layout. An architecture decision nobody wrote down is re-litigated at the next module.

## Decide on two axes (plus one additive)

**Topology - how many deployables, where the boundaries are.** Default to the least distributed thing that works:

| Situation | Topology |
|---|---|
| One team, one domain, most apps | single deployable (a monolith) |
| Distinct bounded contexts / multiple teams, but you still want one deploy and in-process transactions | modular monolith |
| A boundary genuinely needs independent deploy cadence, independent scale, team autonomy, or a different stack | microservices (extract from a modular monolith - never start here) |

**Internal organization - inside a deployable or module, pick one:**

| Situation | Style |
|---|---|
| Feature-rich API, many distinct use cases, teams building features in parallel | vertical slice |
| Medium+ complexity, long-lived, business rules span groups of entities, team comfortable with layers | clean architecture |
| CRUD-heavy, uniform operations, very small app (<5 features) | neither - plain entities + minimal API, don't force a pattern |

**Additive - `ddd` tactical patterns** when the domain has real invariants and behavior well beyond CRUD. DDD is not a competing style: it layers aggregates/value-objects/domain-events inside a clean layout or across vsa slices.

Evolve from vertical slice to clean architecture only when slices start sharing domain logic that no longer fits a feature-local helper. Extract a microservice from a modular-monolith module only when that module's data ownership + contract are already clean.

## The one shared dependency rule (clean / vsa / modular alike)

- Dependencies point inward. The domain - or a feature's core logic - depends on nothing external: no EF, HTTP, or framework types.
- Infrastructure (EF Core, external APIs, email, storage) sits behind an abstraction the inner layer defines and the outer layer implements. Swap the implementation without touching business logic.
- The composition root (`Program.cs`) creates infrastructure and passes it down; inner code never reaches for global state or a service locator.
- **This is a rule only if it's enforced.** Encode dependency-direction, no-layer-skipping, and slice/module isolation as fitness tests, or it erodes one stray `using` at a time. The .NET architecture-test skill (NetArchTest / ArchUnitNET rules that fail the build on a crossed boundary) owns the how; with none installed, the rule lives in review only.
- **Prove it before you claim the boundary holds.** Add the dependency-direction test, break it deliberately, run the suite and quote the red line; revert and quote the green one. Where no architecture-test skill or library is installed, say plainly that the rule is review-only here rather than implying a gate exists.
