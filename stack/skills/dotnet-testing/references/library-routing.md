# .NET test library routing

Runner, substitute library and assertion library are project-level decisions: pick one per category and stay consistent across the test project. The skill body carries the defaults; this file carries the alternatives and the reason to pick each.

## Contents
1. Test runners
2. Substitute / mock libraries
3. Assertion libraries

---

### Test runners

| Runner | When to pick |
|---|---|
| **xUnit** | Default for new projects. `[Fact]` / `[Theory]` + `[InlineData]` / `[MemberData]` / `[ClassData]`. No `[SetUp]` / `[TearDown]` - use constructor + `IDisposable` / `IAsyncLifetime`. Parallel by default. v3 is the current major: its packages are `xunit.v3.*` and its `IAsyncLifetime` returns `ValueTask`, while the fixtures in these references are v2-shaped (`Task`) - on v3, match the signatures through the documentation server. |
| **NUnit** | When the project already uses it, or for parameterized-test ergonomics (`[TestCase]`, `[TestCaseSource]`, `[Values]`, `[ValueSource]`). |
| **MSTest** | When the project ships with it (Visual Studio templates, internal Microsoft tooling). `[TestClass]` / `[TestMethod]` / `[DataRow]` / `[DynamicData]`. |

Do not mix runners in one project. Migrate, don't blend.

### Substitute / mock libraries

| Library | API style | When to pick |
|---|---|---|
| **NSubstitute** | Substitutes (`Substitute.For<T>()`); record/replay-free, terse syntax (`x.M(Arg.Any<int>()).Returns(...)`); loose by default - unconfigured members return defaults; `Received()` throws only when an expected call was not made. | Default for new projects. Fluent, readable in AAA. |
| **Moq** | Mocks (`new Mock<T>()`); `.Setup(...).Returns(...)`, `.Verify(...)`. Loose by default; `MockBehavior.Strict` opts into strict. | When project already uses Moq, or when tooling/team familiarity argues for it. |
| **FakeItEasy** | Fakes (`A.Fake<T>()`); `A.CallTo(() => fake.M(...)).Returns(...)`, `A.CallTo(...).MustHaveHappened()`. | Project preference; mature alternative with natural English DSL. |

Same project = one substitute library. Don't half-port.

Common rules regardless of library:
- Substitute only what you cannot construct (external services, ports, infrastructure). Prefer real instances for value objects, records, simple aggregates.
- Default to loose / non-strict; only assert calls that are part of the contract under test.
- Do not call `Received()` / `Verify()` / `MustHaveHappened()` on every interaction - verify the boundary that matters, leave the rest implicit.

### Assertion libraries

| Library | When to pick |
|---|---|
| **FluentAssertions 7.x** | Default. Rich diff output, structural equality, async support. Stay on 7.x: v8+ is free only for open-source and non-commercial use and needs a paid license for commercial projects (v7 stays Apache-2.0) - upgrading a client project is a licensing decision, not a routine bump. |
| **AwesomeAssertions** | Apache-2.0 community fork taken from FluentAssertions' last Apache-licensed release (v7) and developed forward independently. Drop-in choice when you want a permissive license and ongoing fixes without FA v8's commercial terms. |
| **Shouldly** | Project preference. Simpler API; good when FA's surface area feels heavy. |
| **xUnit/NUnit/MSTest built-in `Assert`** | When the project has no FA/Shouldly dependency and stays minimal. |

Snapshot / Verify assertions - approving serialized output instead of hand-written asserts - are `references/snapshot-testing.md`.
