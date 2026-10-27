<!-- planted: written at Expert depth for 'like for a 6-year-old' - B-trees, page splits, selectivity and write amplification, no analogy mapped for a child -->
# topic-explainer-expert-for-child

## TASK

explain like for a 6-year-old what an index in a database is

## DRAFT

**The short answer.** An index is an auxiliary B+-tree keyed on one or more columns, mapping each key to a row identifier, so a predicate on the key resolves in O(log n) page reads instead of a full scan.

**How it works, step by step.**

1. Leaf pages hold sorted (key, rowid) pairs; interior pages hold separator keys, so the tree's height grows with log base fan-out of n.
2. A lookup descends root to leaf - typically 3-4 page reads for millions of rows at a fan-out of a few hundred.
3. An insert into a full leaf splits it and pushes a separator up; a split at the root grows the tree by one level.
4. The planner uses the index only when the predicate's selectivity is high enough that random leaf-to-heap lookups beat a sequential scan.

**Going deeper.** Covering indexes avoid the heap fetch entirely; composite indexes serve only predicates on a leftmost prefix; every index adds write amplification and lock footprint on each insert and update.

**Recap.**

- O(log n) lookups at the cost of write amplification.
- Selectivity decides whether the planner uses it.

**Check yourself.**

1. Why does a composite index on (a, b) not help a query on b alone?

Answer: the tree is sorted by a first, so b's values are scattered across the leaves.

**Words to know.**

- Selectivity - the fraction of rows a predicate matches.
- Fan-out - the number of children an interior page points to.
