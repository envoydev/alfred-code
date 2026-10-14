# Docker runtime hardening - past non-root

The image already runs as a non-root USER (see SKILL.md); these are the runtime caps that stop a compromised or leaking process from escalating, exhausting PIDs, or starving the host. Compose spelling shown - the docker-run flags are the same switches.

```yaml
services:
  api:
    cap_drop: [ALL]              # drop every Linux capability; add back one at a time only when proven needed
    security_opt:
      - no-new-privileges:true   # setuid/setgid binaries cannot escalate
      # keep the DEFAULT seccomp profile (never seccomp:unconfined);
      # add an AppArmor or SELinux profile where the host supports one
    read_only: true              # root filesystem read-only where the app allows
    tmpfs: [/tmp]                # scratch space for the read-only rootfs
    pids_limit: 256              # fork-bomb guard
    mem_limit: 512m
    cpus: "1.0"
```

- Dropping ALL can stop the container from starting at all. A binary carrying a FILE capability (`docker run --rm --entrypoint getcap <image> <binary>`; the official `caddy` image's binary holds `cap_net_bind_service=ep`) fails `exec <binary>: operation not permitted` under `cap_drop: [ALL]` - measured 2026-10-14 on `caddy:2-alpine` (2.11.7): exit 255, and exit 0 once `cap_add: [NET_BIND_SERVICE]` names it, with no-new-privileges or without, as root or as uid 1000. no-new-privileges alone did not break it. So start the container under the new options before calling the change done (SKILL.md, 'Prove the pipeline change' step 4).
- Never reach for `--privileged` - it disables every isolation mechanism at once; grant a single capability back instead, with the reason recorded. A service that 'needs' many capabilities usually needs a different design.
- The memory / CPU / PID caps are per-service circuit breakers: a runaway process becomes one dead container instead of a starved host.

## Inter-container traffic - what the obvious knobs actually do

Compose has no `icc` key. The bridge driver option `com.docker.network.bridge.enable_icc: "false"` under a network's `driver_opts` cuts every peer on that network at once, so it fits only a network of mutually isolated services - not a network where two of five services must still talk. The daemon-wide `icc` setting in `daemon.json` covers just the default bridge, which a Compose project does not use. So segmentation is done with networks, as the compose rule in SKILL.md states: put backing services on an `internal: true` network, give each service only the networks it needs, and reach for a driver option only when every peer on that network is meant to be isolated.
