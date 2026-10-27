<!-- planted: none -->
# topic-explainer-strong-within-budget

## TASK

what is a database migration?

## DRAFT

A database migration is a small, numbered script that changes a database's structure - adding a table or a column - so every copy of the database can be brought to the same shape by running the scripts in order. In this project they are SQL files under `src/db/migrations/`, starting with `001_orders.sql`, which creates the `orders` table; a shipped migration is never edited, a change is a new file (ARCHITECTURE.md, 'Data').

Want the full walkthrough - how they run in order, why one is never edited, and a worked example? Say 'go deeper'.
