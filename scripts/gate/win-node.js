'use strict';
const { WIN_NODE } = require('./constants.js');

// The PowerShell the VM runs as SYSTEM to list every node.exe it holds, one `<path>|<version>` line each.
function nodeProbeScript()
{
    const layouts = WIN_NODE.nvmLayouts.map((l) => `(Join-Path $h '${l}')`).join(', ');
    return [
        '$c = @()',
        '$g = Get-Command node -ErrorAction SilentlyContinue',
        'if ($g) { $c += $g.Source }',
        `$c += '${WIN_NODE.programFiles}'`,
        'Get-ChildItem \'Registry::HKEY_USERS\' | ForEach-Object { '
            + `$h = (Get-ItemProperty -Path ('Registry::' + $_.Name + '\\Environment') -Name ${WIN_NODE.nvmHomeKey} -ErrorAction SilentlyContinue).${WIN_NODE.nvmHomeKey}; `
            + `if ($h) { $c += (Get-ChildItem -Path ${layouts} -ErrorAction SilentlyContinue).FullName } }`,
        `$c | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique | ForEach-Object { $_ + '${WIN_NODE.separator}' + (& $_ --version) }`,
    ].join('; ');
}

function versionParts(version)
{
    return String(version).trim().replace(/^v/, '').split('.').map(Number);
}

function newer(a, b)
{
    for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    return false;
}

// The newest node.exe of `major` in the probe's output (any major when none is asked); null when none.
function pickNode(output, major)
{
    let best = null;
    for (const line of String(output).split(/\r?\n/))
    {
        const at = line.lastIndexOf(WIN_NODE.separator);
        if (at <= 0) continue;
        const parts = versionParts(line.slice(at + 1));
        if (!Number.isInteger(parts[0]) || (major && parts[0] !== major)) continue;
        if (!best || newer(parts, best.parts)) best = { bin: line.slice(0, at).trim(), parts };
    }
    return best ? best.bin : null;
}

module.exports = { nodeProbeScript, pickNode };
