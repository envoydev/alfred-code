# Read-path diagnostics - EXPLAIN, pg_stat_statements, autovacuum

Read when diagnosing a slow query or a read-path regression - before any index or setting change, so the finding carries its measured evidence.

## Read-path diagnostics

- `EXPLAIN (ANALYZE, BUFFERS)` is the primary tool - it runs the query and shows real timing and IO. Read for:
  - `Seq Scan` on a large table -> missing index.
  - high `Rows Removed by Filter` -> poor selectivity.
  - `Buffers: read >> hit` -> not cached (memory pressure).
  - `Sort Method: external merge` -> `work_mem` too low.
  - estimate-vs-actual row gap of 10x+ -> stale statistics, run `ANALYZE`.
- Rank findings by measured impact (actual rows/buffers/time), never by the estimated cost percentage.
- Report each finding in these three lines, so the evidence travels with the fix and the re-measure is part of the contract:

  ```text
  symptom: Seq Scan on orders, 2.1M rows, Rows Removed by Filter 2.09M, 1840 ms
  cause:   no index serves WHERE status = 'open' (0.5% of rows)
  fix:     CREATE INDEX CONCURRENTLY orders_open_idx ON orders (status) WHERE status = 'open'
           -> re-run EXPLAIN (ANALYZE, BUFFERS) and quote the new node
  ```

- Enable `pg_stat_statements`; rank by `total_exec_time` (aggregate cost) and `mean_exec_time` (worst per-call); `pg_stat_statements_reset()` after a fix to re-measure.
- Autovacuum handles most tables; tune per-table for high churn and `ANALYZE` after a bulk change:

```sql
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ANALYZE orders;
```

- Which tables need that tuning is measured, not guessed - dead rows against live ones, and when each table was last vacuumed:

```sql
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_vacuum, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;
```

A high `dead_pct` with an old `last_autovacuum` is the table whose scale factor to lower.

- `work_mem` is per sort/hash node, not per connection - keep `work_mem * max_connections` under ~25% of RAM or sorts spill to disk.
- A prepared statement can lock in a generic plan that hurts skewed values; if a prepared query degrades, force per-value planning (`plan_cache_mode = force_custom_plan`).
