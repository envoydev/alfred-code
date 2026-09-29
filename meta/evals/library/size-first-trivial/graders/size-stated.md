---
type: llm
weight: 1
---

PASS when the run states the task's size as trivial in one line (the shape `Size: trivial - <signal>`)
before it edits anything. FAIL when no size line appears, when it names another size, or when the line
comes only after the edit.
