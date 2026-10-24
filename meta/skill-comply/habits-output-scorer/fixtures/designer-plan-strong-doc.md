<!-- planted: none -->
# designer-plan-strong-doc

## TASK

Document in ARCHITECTURE.md how an order moves from placed to cancelled, including the rule that a shipped order cannot be cancelled. Documentation only - no code changes.

## DRAFT

# Order states - plan

Oriented: ARCHITECTURE.md 'Layers' and 'Data' read; LSP documentSymbol on src/orders/orderService.js; grep for `shipped` over src/ (one hit, src/orders/orderService.js:14); markdown-style loaded; preference and assessment docs read (ARCHITECTURE-PREFERENCES.md A1, CODE-ASSESSMENT.md W1 - neither governs this page)
Asked: "Document in ARCHITECTURE.md how an order moves from placed to cancelled, including the rule that a shipped order cannot be cancelled. Documentation only - no code changes."
Build: none - documentation only; the check is the read-back below
Resume: next task 1

## Fit

extend - ARCHITECTURE.md has a section per concern ('Layers', 'Data'); the states are a new concern and get their own section.

## Tasks

### Task 1 - ARCHITECTURE.md gains an 'Order states' section

- status: TODO
- target: .alfred/docs/architecture/ARCHITECTURE.md (modify) - a new `## Order states` section after 'Data'
- change: a reader finds the two states the code writes (`placed` on placeOrder, `cancelled` on cancelOrder), the refusal of a cancel for a `shipped` order, and that nothing in this service sets `shipped`
- evidence: src/orders/orderService.js:6 (`status: 'placed'`), src/orders/orderService.js:15 (`setStatus(id, 'cancelled')`), src/orders/orderService.js:14 (the `shipped` refusal); the grep above found no writer of `shipped` in src/
- verification: read the section back against the three lines cited, and confirm the page's other sections are unchanged with `git diff --stat`

## Decisions

- The page says where `shipped` comes from as an open question, not a fact - no precedent - nothing in src/ writes it, so the section states 'set outside this service (not found in src/)' rather than guess a writer.
