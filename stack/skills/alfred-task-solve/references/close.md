# The close - new scope, a sibling repo's change, doc drift

Read at step 6, CLOSE, before the close ask is built.

## New scope after `Completed:`

New scope arriving in-chat after `Completed:` is a NEW cycle in a NEW plan file (a stamped file
is a record, never a place to append) - re-enter step 1, or say plainly that the work is running
ungated and why; never build it on a casual 'yes, add it'. Measured: 8 scope additions over one
55-hour session with zero plan-file writes and no ungated statement either.

## A change a sibling repo must make

When the change affects a sibling repo's client, the handoff is a
FILE in THIS repo - a task card under `<docs-path>/cross-project-tasks/` (the cross-project
write guard blocks a write into the sibling's tree; reading it stays open) or a navigation-server note -
never chat-only prose - and verify the sibling's actual source before writing what it must do.

## Doc-drift awareness

**Doc-drift awareness** - one line at most in the close report, the user decides, never
auto-run: when the landed change touched an architecture-critical surface (the list is in
`references/step-mechanics.md`), say so and name
`/alfred-capture-architecture` (update mode is diff-scoped and cheap); when substantial
code + tests landed and the coverage doc is absent or its stamp predates the change, name
`/alfred-capture-test-coverage` the same way.
