# The seven design rules, and the observability spec

Read at method step 4, before the plan is decomposed. `SKILL.md` carries the three questions and
the one-line form of each rule; this file is the long form - each rule with the failure shape it
prevents - plus the `log_points` spec every task card is stamped from.

## The seven

1. **YAGNI + rule of three.** Design the direct solution; the seam goes in at the third occurrence,
   split on what actually varied. An extension point the requirement has not asked for twice is
   indirection someone pays for now for flexibility that usually never arrives - a strategy
   interface with one implementation forever is the classic shape.
2. **High cohesion, low coupling - the placement test.** Everything a task owns changes for the same
   reason. A task boundary that splits one axis of change across two seats, or bundles two axes into
   one, is the wrong boundary - redraw it before the build starts, not after.
3. **Program to an interface at boundaries ONLY.** A seam belongs where one really exists: an
   external system, something the tests mock, something with two implementations or a credible
   second. An interface mirroring every class is ceremony, and a fat interface whose consumers use a
   fraction of it is the same failure from the other side.
4. **Illegal states unrepresentable where cheap, fail fast everywhere else.** Constructor validation,
   required fields, closed hierarchies for domain state, enums over strings; where the type system
   will not help, validate at the boundary and throw. Default to composition - inherit only for true
   substitutability, and a subtype that cannot stand in for its base is a design defect, not an
   implementation detail.
5. **Command-query separation.** A method either mutates or answers, never both.
6. **Least astonishment.** The name is the contract - a seam that does more than its name says means
   fixing one of the two, in the plan, before it ships.
7. **Patterns are refactored TOWARD, never started from.** Where the trigger is already in the code
   (the same change hitting three places, a switch growing per feature, a test that needs half the
   system), name the established pattern rather than inventing a bespoke shape - and absent a
   trigger, the simpler structure wins. A pattern the language absorbed (first-class functions,
   generics, pattern matching) is a keyword now, not a structure to build.

## Observability

**Observability is designed at the seams, never sprinkled by the implementer.** Stamp each task
card with `log_points` - where a line goes, at what level, carrying which identifiers: the boundary
crossings the task owns (an inbound request, message or job run's start and outcome; an outbound call
to an external system; a persistence write), the decision points a reader would need to reconstruct
the path (a retry, a fallback, a rejected input, a state transition), and every failure exit. Level by
who acts: error means someone acts now, warning means degraded but handled, information means a
business-significant event, debug means investigation only. The message carries the join keys an
investigator needs - the correlation or trace id, the entity id - and never a secret, a token, a
payload, or personal data beyond the project's policy. A failure is logged ONCE, at the boundary that
handles it, never log-and-rethrow at each layer; a background job, a fire-and-forget or a swallowed
catch with no log point is a silent failure, and a design defect. Where the framework already emits
the event (request logging, client logging) the card says so instead of duplicating it. A task with
no failure exit of its own stamps `log_points: none - <reason>` - an absent field and a considered
none must never look alike. Every point goes through the repo's existing logging seam and message
convention - name the precedent on the card, never a second logger.
