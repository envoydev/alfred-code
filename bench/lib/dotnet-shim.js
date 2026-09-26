'use strict';
// A `dotnet` first on every session's PATH that runs MSBuild in ONE node with no node reuse. MSBuild's
// worker nodes talk over sockets the sandbox refuses, so a sandboxed build hangs until the task limit:
// `excludedCommands: ["dotnet *"]` matches a LEADING dotnet only, and the first pilot's compound forms
// (`cd .. && dotnet build`, `dotnet build | tail`, `timeout 300 dotnet test`) ran sandboxed - 107 of 354
// hung, while a session that added `-m:1` built the solution in 6 s. The same shim serves the
// unsandboxed leading form, so every build of every arm takes the one route.
//
// `run` is left alone: `dotnet run` hands every token it does not know to the application (measured:
// `dotnet run -m:1 -nodeReuse:false` printed ARGS[-m:1|-nodeReuse:false]), and an ASP.NET host fails on
// an unmapped `-m:1`. Tools that build through their own child dotnet (`dotnet ef`) are not reached.
const fs = require('node:fs');
const path = require('node:path');

const SWITCHES = ['-m:1', '-nodeReuse:false'];
const VERBS = ['build', 'test', 'publish', 'pack', 'msbuild'];

const quote = (s) => `'${String(s).split('\'').join('\'\\\'\'')}'`;

// POSIX sh, so the shim needs nothing but the real dotnet. The switches go before a `--`, whose tail
// belongs to the test application, else last.
function shimText(real)
{
    return [
        '#!/bin/sh',
        '# bench: MSBuild in one node, no node reuse - its worker nodes need sockets the sandbox refuses.',
        `real=${quote(real)}`,
        `case "$1" in ${VERBS.join('|')}) ;; *) exec "$real" "$@" ;; esac`,
        'n=$#',
        'placed=0',
        'for a do',
        `  if [ "$placed" = 0 ] && [ "$a" = "--" ]; then set -- "$@" ${SWITCHES.join(' ')}; placed=1; fi`,
        '  set -- "$@" "$a"',
        'done',
        'shift "$n"',
        `if [ "$placed" = 0 ]; then set -- "$@" ${SWITCHES.join(' ')}; fi`,
        'exec "$real" "$@"',
        '',
    ].join('\n');
}

function realDotnet(PATH, skip)
{
    for (const dir of String(PATH || '').split(path.delimiter).filter(Boolean))
    {
        if (path.resolve(dir) === path.resolve(skip)) continue;
        const candidate = path.join(dir, 'dotnet');
        try
        {
            fs.accessSync(candidate, fs.constants.X_OK);
            if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
        }
        catch { /* not here */ }
    }
    return null;
}

// Writes `<bin>/dotnet` over the first real dotnet on PATH and returns `bin`; null when there is none.
function installShims({ bin, PATH })
{
    const real = realDotnet(PATH, bin);
    if (!real) return null;
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'dotnet'), shimText(real), { mode: 0o755 });
    return bin;
}

module.exports = { installShims, shimText, SWITCHES, VERBS };
