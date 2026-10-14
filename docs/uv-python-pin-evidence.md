# uvx Python pin - evidence (2026-09-23)

<!-- Re-spelled 2026-10-07: the stack's names read as it is named now; the measurements are unchanged. -->

Why serena and memory start on a pinned Python, and why installs refresh before they read the
plugin cache. Every number below was measured on 2026-09-23 with the command beside it.

## The failure

A Windows-on-ARM machine running 1.1.0 showed `plugin:serena:serena: CONNECTION_CLOSED` in `/mcp`.
Running the entry's own command by hand showed the cause: uvx picked the newest interpreter it
could find (native ARM64 CPython 3.14), found no wheel for pyyaml, and tried to compile it from
source. There was no MSVC toolchain, so the build failed and serena never started. The same command
with `--python cpython-3.13.13-windows-x86_64-none` installed serena in about 2.5s and
`claude mcp list` showed it connected.

The first hand patch went into the cached plugin's `marketplace.json` and changed nothing. The
entry Claude Code launches is read from the marketplace CLONE
(`~/.claude/plugins/marketplaces/envoydev/.claude-plugin/marketplace.json`), and
`claude plugin marketplace update` overwrites that clone. A hand patch is lost on the next refresh
either way, so the pin has to ship in the generated entry.

## SERENA_HOME on Windows

After the Python pin, serena started but its TypeScript language server died during initialize
(`LanguageServerTerminatedException`). serena's own log showed the cause:
`'.serena' is not recognized as an internal or external command`. serena 1.7.0 starts the
TypeScript server through npm's extensionless `.bin/typescript-language-server` shim instead of
`node cli.mjs`, and on Windows that shim runs through cmd.exe. serena joins its paths with
backslashes onto the entry's `.serena/home`, and cmd reads the unquoted
`.serena/home\language_servers\...` only as far as the first `/`. The same machine, by hand:
`.serena/home\...` fails, while `.serena\home\...` and the absolute path both print the server's
version (5.1.3).

- **Plugin route:** the launcher spells the relative `SERENA_HOME` in the platform's own separator
  (`.serena\home` on Windows) and keeps it relative: a plugin server's cwd is the project, so
  projects never share one home, and the fix does not depend on `${CLAUDE_PROJECT_DIR}` expanding
  in a plugin entry's env. It is NOT made absolute: cmd.exe gets the path unquoted, so an absolute
  one would be cut at the first space in the project's own path (`C:\Users\Jane Doe\...`) - the
  same failure, on a different character.
- **Copy route:** `.mcp.json` gets `.serena\home` on Windows (`@SERENA_HOME@`), and `.serena/home`
  elsewhere. It is the same directory on disk either way, so nothing is re-downloaded.

## Wheel coverage, measured

`uv pip compile` (uv 0.11.25), wheel-only for the compiled dependencies. serena-agent's sdist-only
`proxy-tools` is pure Python, so only the compiled five are forced to wheels:

```
echo 'serena-agent==1.7.0' > req.txt
uv pip compile req.txt --python-version <py> --python-platform <platform> \
  --only-binary pyyaml --only-binary ruamel-yaml-clib --only-binary cryptography \
  --only-binary psutil --only-binary tiktoken
```

| serena-agent 1.7.0 | 3.13 | 3.14 |
|---|---|---|
| x86_64-pc-windows-msvc | resolves | fails: pyyaml 6.0.2 has no usable wheels |
| aarch64-pc-windows-msvc | fails: cryptography has no usable wheels | fails |
| aarch64-apple-darwin | resolves | fails: pyyaml |
| x86_64-unknown-linux-gnu | resolves | fails: pyyaml |

The memory service, fully wheel-only (`--only-binary :all:`) over
`mcp-memory-service[sqlite]==11.13.0` plus `numpy`:

| memory 11.13.0 | 3.13 | 3.14 |
|---|---|---|
| x86_64-pc-windows-msvc | resolves | resolves |
| aarch64-pc-windows-msvc | fails: cryptography | fails: cryptography |
| aarch64-apple-darwin | resolves | fails: onnxruntime |
| x86_64-unknown-linux-gnu | resolves | resolves |

So 3.13 is the newest CPython that has a wheel for every compiled dependency, on every platform
that has any. Windows on ARM has none for some dependencies on any Python, while the x64 CPython
runs there under the OS's own emulation and has them all.

## The request string

uv accepts `<implementation>-<version>-<os>-<arch>-<libc>` as a Python request (context7,
`/astral-sh/uv`, docs/concepts/python-versions.md, 'Requesting a version'). The minor-only form
resolves on this uv version: `uv python list cpython-3.13-windows-x86_64-none --all-platforms
--only-downloads` answers `cpython-3.13.14-windows-x86_64-none`. The stack pins the minor, not
the patch, so uv takes the newest 3.13 patch.

## Why every run refreshes first

- `claude plugin install name@marketplace` refreshes that marketplace before the lookup (since
  v2.1.232), but it does nothing for a plugin that is already installed.
- `claude plugin update` reads the local catalog as it stands.
- A third-party marketplace such as this one has auto-update OFF by default.

(code.claude.com/docs/en/discover-plugins, 'Install plugins' and 'Configure auto-updates', via
context7 `/websites/code_claude`.)

The snapshot is the newest core entry in the plugin cache, and only `plugin update` puts a newer
one there. So a run that picked before updating installed the release it was meant to replace.
`scripts/install-plugins.test.js` and `scripts/source-cache.test.js` pin the order: a recording
`claude` stub lands a newer entry on `plugin update`, and the run must take it.

## windows-control on 3.14 (2026-10-14)

windows-mcp 0.8.6, 0.8.7 and 0.8.8 declare `requires_python >=3.14` on PyPI (0.8.5: `>=3.12`), so the
refresh held windows-control at 0.8.5 while every uvx server shared 3.13. The user ruled on 2026-10-14
to move it to 0.8.8 on 3.14, so `uv-python.js` gives windows-control its own Python (`SERVER_PYTHON`).
The other servers stay on 3.13. Measured on a Windows 11 ARM VM (`PROCESSOR_IDENTIFIER` ARMv8) with
uv 0.13.1 aarch64, as SYSTEM through `prlctl exec`, with a scratch `UV_CACHE_DIR` and
`UV_PYTHON_INSTALL_DIR`, each command `uv tool run --python <request> --exclude-newer
2026-10-14T23:59:59Z --from <pkg> windows-mcp serve ...`:

| request | package | `serve --help` | start + tools/list |
|---|---|---|---|
| `cpython-3.13-windows-x86_64-none` | `windows-mcp==0.8.5` | exit 0, 46 s (first) | serverInfo `windows-mcp` 4.1.0 in 7.7 s, 16 tools under the stack's `--exclude-tools`, 20 without |
| `cpython-3.14-windows-x86_64-none` | `windows-mcp==0.8.8` | exit 0, 30 s (first) | exit 1: `RuntimeError: No active interactive desktop for physical input control` |
| `cpython-3.14-windows-aarch64-none` | `windows-mcp==0.8.8` | exit 1, 82 s | not reached: `Failed to build cryptography==50.0.2` (maturin, `linker link.exe not found`) |

- The generated plugin entry, run on the same VM through a clean export's `desktop-launch.js` with the
  marketplace entry's own argv (node arm64), printed `desktop-launch: windows-mcp==0.8.8, python
  cpython-3.14-windows-x86_64-none, windows-mcp serve --exclude-tools PowerShell,Registry,Process,FileSystem`.
  uvx installed the tree, and the server stopped at the same start check as the row above.
- The x64 3.14 build installs the whole 0.8.8 tree and runs its CLI, so the x64 request
  (`cpython-3.14-windows-x86_64-none`) stays the Windows-on-ARM form. ARM64 still lacks the
  cryptography wheel and needs a compiler, as it did on 3.13.
- 0.8.8 starts a physical-input monitor in its lifespan. The monitor refuses to run unless the
  process's WTS session is active and the input desktop is `Default`
  (`windows_mcp/desktop/control_win32.py _interactive_desktop`). A lock screen or UAC prompt switches
  the input desktop to Winlogon. SYSTEM in session 0 has none of this, so the server exits at start.
  That is why the start column above failed in the probe. A start in the signed-in user's session
  was NOT RUN here: the scheduled task that would have launched it in that session was refused by
  this session's permission classifier.
- Tools at 0.8.8, from the wheel's own `tools/*.py` (`refresh-mcp-pins.js`): the 0.8.5 twenty plus
  `ControlStatus`. That tool is read-only and reports who holds the desktop and the user's idle wait.
  `App` keeps the same four modes (`tools/app.py:90`), and `--exclude-tools` / `--tools` are unchanged
  in `serve --help`.
