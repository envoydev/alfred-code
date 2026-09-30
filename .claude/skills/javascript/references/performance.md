# JS/TS performance - browser vitals, Node event loop, profiling

Loaded from the `javascript` skill when chasing a slow page, a laggy interaction, or a saturated Node process.

## Browser - Core Web Vitals (75th percentile bars)

LCP < 2.5s, INP < 200ms, CLS < 0.1. INP (replaced FID in 2024) is the most-commonly-failed vital and is dominated by main-thread JavaScript:

- Ship less JS: route-based code splitting, dynamic `import()` for heavy libs (charts, editors, maps), tree-shaking with honest `sideEffects: false`.
- Break long tasks: `scheduler.yield()` / `postTask`, debounce/throttle handlers, no synchronous layout thrash (batch reads, then writes).
- Offload CPU work to Web Workers; `OffscreenCanvas` for render-heavy work.
- CLS: reserve layout space (explicit dimensions / `aspect-ratio`); LCP: preload the hero image, inline critical CSS, `font-display: swap`.
- Leaks: detached DOM nodes, un-removed listeners, closures over large scopes, uncleared timers - DevTools Memory + Performance panels.

Measure before optimizing: field data (CrUX / PageSpeed Insights - a 28-day rolling window, so fixes take weeks to show), lab data (Lighthouse, WebPageTest), RUM via the `web-vitals` package. Budget in CI (Lighthouse CI, size-limit). Fix whatever sits in the 'poor' band first - polishing an already-green metric is waste.

## Node - the event loop never blocks

- `fs.promises` + streaming for files; no sync FS/crypto/large-JSON parse on any request path.
- CPU-bound work (parsing, compression, encryption, images) goes to `worker_threads` (shared memory via `SharedArrayBuffer` when needed); scale across cores with `cluster`/PM2, keep workers stateless, move session/cache state out to Redis.
- Watch loop lag directly: `perf_hooks.monitorEventLoopDelay()`.

## Profiling

Clinic.js for triage (Doctor), CPU flamegraphs (Flame), async flow (Bubbleprof); `0x` for quick flamegraphs; `node --prof` / `--inspect` for the raw tools. Profile under production-like load in staging - an idle-machine profile lies.
