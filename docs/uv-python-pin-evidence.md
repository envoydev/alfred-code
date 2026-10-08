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
