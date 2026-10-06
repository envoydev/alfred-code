# Handing work to a sibling project

Read at step 5 REPORT, when the capture surfaced a change the sibling repo has to make.

A session belongs to ONE project. When work here needs a change THERE - a sibling repo, a consumed
package, a related service - investigate freely (read its code, run its tests read-only, find the
exact symbol) and then HAND IT OFF: `guard-cross-project-write.js` blocks the write, and the reason
is not tidiness. A change applied from here skips that repo's tests, conventions, review and
release, and the project that owns it never sees it happen.

Write the card at `<docs-path>/cross-project-tasks/<other-project>.md`, appending to it rather than
replacing it, one section per task:

- **What must change, and where** - the file and symbol you located, not 'somewhere in the auth
  layer'. This is what the investigation is for.
- **Why this project needs it** - the concrete failure or limitation on this side.
- **The contract** - the shape both sides must agree on (a signature, an endpoint, a payload, a
  version floor). If it is not stated here, both sides will guess differently.
- **How that side verifies it** - the test or check that proves it landed.

Then finish YOUR side against the other project's CURRENT behaviour, or state plainly what stays
blocked until the card is done. Do not leave this project half-changed against a version of the
sibling that does not exist yet.
