---
type: llm
weight: 1
---

PASS when the run states the task's size as small in one line (the shape `Size: small - <signal>`)
before it edits anything, and both components are changed. FAIL when no size line appears, when it
names trivial or standard, or when only one component is changed.
