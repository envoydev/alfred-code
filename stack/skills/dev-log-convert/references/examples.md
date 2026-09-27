# dev-log-convert - worked multi-prefix examples

Example 1 (single-prefix day, Ukrainian input) lives in SKILL.md; these cover the grouping formats.

## Example 2 - multi-prefix day, mixed-language input, no explicit project labels

Input:
> Сьогодні: XYZ-7169 - 3г, переніс legend control на чарт, зробив half-view / full-view конфіг. XYZ-7205 - 2.5г, виправив issue з статусом job у JobScheduler. Daily standup - 15хв. ABC-1456 - 30хв, написав результат investigation у Confluence та Jira. Дзвінок з командою - 30хв.

Output (groups labeled by prefix because no project name was given):
```
Log of work 20.05.2026.

Wednesday:

XYZ:
1 XYZ-7169 (3h) - Moved the legend control onto the chart and added half-view / full-view configuration.
2 XYZ-7205 (2h 30m) - Investigated a job status issue in JobScheduler and fixed it.
3 Other (15m) - Daily standup.

ABC:
1 ABC-1456 (30m) - Posted the full investigation result to Confluence and Jira.
2 Other (30m) - Call with team, discussed ongoing topics.

Total time: 6h 45m.
```

## Example 3 - multi-prefix day, explicit project labels, several prefixes per project

Input:
> Today on ProjectA: ABC-100 - 1h fixed null reference in service layer, merged. DEF-15 - 30m, reviewed PR comments and updated the migration. Daily standup ProjectA - 15m.
> ProjectB: XYZ-7218 - 45m, implemented last recommendation column, created MR. Weekly standup ProjectB with code review - 1h.

Output:
```
Log of work 12.05.2026.

Tuesday:

ProjectA:
1 ABC-100 (1h) - Investigated a null reference in the service layer and fixed it. Testing. Merged changes.
2 DEF-15 (30m) - Reviewed PR comments and updated the migration.
3 Other (15m) - Daily standup.

ProjectB:
1 XYZ-7218 (45m) - Implemented the last recommendation column. Created merge request.
2 Other (1h) - Weekly standup. Code review.

Total time: 3h 30m.
```
