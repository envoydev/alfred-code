# Reward-hacking shortcuts to reject

The .NET shortcut table the skill body cites - the recurring ways a change fakes a green build instead of earning it. Reject each in review, whoever wrote it.

| Shortcut | Instead |
|---|---|
| Disabled or skipped test (`[Fact(Skip=...)]`, `[Ignore]`, `#if false`, or deleting a failing test) | fix the defect the test caught (`dotnet-testing`) |
| Weakened assertion, `[ExcludeFromCodeCoverage]` on logic-bearing code (anything outside the testing hub's exclusion catalog), or a lowered coverage threshold | fix the code, keep the bar (`dotnet-testing`) |
| `#pragma warning disable`, `<NoWarn>`, or an `.editorconfig` severity downgrade to clear a promoted warning | fix the code, or defer the ID explicitly (SKILL.md's 'Warnings as errors' section) |
| Empty or exception-swallowing `catch` | handle it or let it propagate (`csharp`) |
| `Task.Delay` / `Thread.Sleep` to mask a race or flaky timing | inject the clock, await the real signal (`csharp`, `dotnet-testing`) |
| Inline `Version=` / `VersionOverride` bypassing central package management, or downgrading a package to dodge a conflict | keep versions central, fix the conflict (`dotnet-project-setup`) |
