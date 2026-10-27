# Architecture preferences

Updated: 2026-10-24

## A1 - Routes go through the service
<!-- id: a1 -->
- Rule: a route handler calls the order service, never the repository or `db.run`.
- Scope: src/http/**
- Why: the order rules live in one place, and a route stays a thin adapter.
- Except: a health check that only pings the database.
