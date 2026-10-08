---
name: habits-test-first
description: "Use before writing production code for a feature, bug fix or behavior change - before the first source edit. Not for config or docs edits, which skip tests."
---

# Test first - red for the right reason, then green, then clean

A test written after the code passes by construction: it was shaped around what the code does, not
what it should do. Written first and seen failing, it proves what no later test can - that it can
fail, and that it fails for the behavior it names.

## When to use

- Fires the moment before the first edit to a source file, in any language and test framework, whether or not the user said 'TDD' or 'tests'.
- The test-driven cycle, and the honest 'test: none' line, with its reason, when no test fits.
- Not for a config-only or docs-only edit or a throwaway spike, which record 'test: none' with the reason and go straight to the done gate.

## The cycle

1. **Write the test.** One behavior per test, named for that behavior, asserting the observable
   result the requirement or the task card's acceptance names - never the implementation's
   internals. Use the project's own framework, folder and naming.
2. **Watch it fail for the expected reason.** Run it and read the failure. It counts as red only
   when it compiled, RAN and failed on the assertion the behavior names - a compile error, a missing
   fixture, an import typo or a skipped test is not red: fix that and run again. A test that passes
   before the code exists tests nothing: fix the test, never the expectation. Quote the failing
   assertion line in the reply or the seat report - `red: <test> - <assertion line>`.
3. **Write the minimal code that passes.** Only what the test demands - no option, branch or
   abstraction a test does not ask for yet.
4. **See it green.** Run it again with its neighbours (the file, or the project's scoped test
   command) and read the result: the new test and every old one pass.
5. **Refactor while green.** Tidy names, duplication and structure, re-running after each step. A
   refactor that turns anything red is undone, not patched.

Then the next behavior, from step 1.

## A bug fix

The test reproduces the bug first: it fails for the cause found (`habits-root-cause`, step 6), then
the fix turns it green. A fix with no failing test first is a guess the suite cannot hold.

## When no test fits

Config-only, docs-only, a throwaway spike, or code the project has no harness for: say so in one
line with the reason (`test: none - <reason>`), never skip it silently. A spike that becomes the
real code starts over at step 1.

## Signs it was skipped

- Production code written before any test for it exists.
- A new test whose first run was green.
- A test edited until it passes, instead of the code.
- 'Tested manually' standing in for a test the harness could run.
