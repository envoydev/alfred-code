---
paths: ["**/*.cs", "**/*.csproj", "**/*.sln", "**/*.slnx", "**/*.xaml", "**/Directory.Build.props", "**/Directory.Packages.props", "**/*.targets", "**/nuget.config", "**/NuGet.Config"]
---

<!-- Fires on every .NET file touch by design: build state has no glob, and this soft router
     replaced the retired require-convention-skill hard gate. The rent is these few lines. -->

A broken .NET build or red test suite - delegating beats looping in-session; the run's session-or-agents pick, or the user's word, decides - absent both, offer the resolver through AskUserQuestion (resolver seat vs in-session fix, resolver recommended):
fix-the-build goes to **`dotnet-build-error-resolver`** (MC#### errors = WPF XAML markup
compile are its scope too), make-the-tests-pass goes to **`dotnet-test-failure-resolver`**
once the build is green. The subagent absorbs the repeated build/test output and returns only a
diagnosis.

A seat may register under a NAMESPACE (`<namespace>:<seat>`) rather than as a bare name; where it
does, only that spelling resolves - dispatch it exactly as the roster spells it.

A resolver that stops as BLOCKED_CONTRACT_CHANGE hit a fix needing a shared-contract change -
outside its bounded scope by design; a running `alfred-task-solve-cross` flow handles it per its
contract protocol - otherwise name `/alfred-task-solve-cross` as the user's next step (the skill is
manual-only; a model Skill call is blocked). Never edit the contract to go green.

A seat with no Agent tool (an implementer or a resolver) does NOT delegate - this routing policy is
the orchestrator's; run your own bounded fix loop and report the red per your cap. A read-only seat
(a verifier, a designer, a reviewer, an analyzer) has no Edit to loop with: it reports the red and
names the resolver. A diagnoser carries the Agent tool but its one sanctioned dispatch is the
evidence-gatherer: it names the resolver in its report, never dispatches one.
