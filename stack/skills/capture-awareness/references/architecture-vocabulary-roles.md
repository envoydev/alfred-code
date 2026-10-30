# Vocabulary roles - what step 3 loads, matched by description

Read at AGGREGATE, before the first vocabulary load. The rule this file serves: a skill is selected by what its
DESCRIPTION says it covers, never by a remembered name - the installed set differs per project, and a name
from memory loads nothing or the wrong thing. List what is installed first (`ls .claude/skills`, plus the plugin
skills your own skill list shows), then fill each role below from that listing, and put the chosen names in the
report's `Vocabulary:` line. A role with no match is ABSENT: read the code instead and say so in the report.

## The roles

| Role | What the candidate's description must cover | When |
|---|---|---|
| Stack router | the hub for the area's stack - routes to the specialist skills | always |
| Architecture vocabulary | architecture styles and layering vocabulary (clean / vertical-slice / modular monolith, dependency direction, boundaries) | .NET projects |
| Convention skill | the house conventions for any file type you judge in depth | per file type judged |
| Pattern fit | GoF / design-pattern fit and misuse | .NET projects |
| Fitness tests | architecture fitness tests - whether a boundary is enforced or merely conventional | only where the project runs such tests |

## Stacks that ship no match - expected, not a gap

The architecture-vocabulary role is .NET-only today. The TypeScript verticals ship NO architecture-vocabulary
skill, and that is EXPECTED - not a gap to work around and never a reason to load a .NET skill on a TypeScript
project. On those projects read the structure the framework itself declares - the workspace/monorepo config, the
module and routing definitions, the DI/providers wiring, the path aliases - and reason from that.

The fitness-tests role exists only where the project runs such tests: with nothing matching, read the test
project directly and never guess at a skill name.

## Receipt

The report's `Vocabulary:` line carries one cell per row of the table above - `<role>: <skill loaded>`, `ABSENT`
(nothing installed matches: read the code), or `n/a - <its When that does not hold>` - so a skipped role is a
visible cell, not a sentence. An `always` role is never n/a: a run that reads no stack code still loads it or
writes ABSENT. The line is what makes the load happen; a report without it is a run that loaded nothing.
