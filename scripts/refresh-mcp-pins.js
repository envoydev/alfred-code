'use strict';
// THE MCP VERSION PINS - resolved deliberately, never during an install.
//
// Until Phase 6 the installer asked npm and PyPI for `latest` on every run and wrote the answer
// into .mcp.json, so two installs a week apart silently ran different server code from the same
// stack release. A plugin entry is static JSON in the marketplace, so there is no install-time step
// to ask in - and that is the better contract anyway: a pin moves when someone commits a move.
//
//   node scripts/refresh-mcp-pins.js            # report what would change, write nothing
//   node scripts/refresh-mcp-pins.js --write    # resolve and write meta/mcp-pins.json
//
// Offline or a dead registry is NOT a failure: the row keeps the pin it had, and the report says
// which ones could not be checked. A row that never resolved carries `null`, which the generator
// reads as 'ship unpinned' - the same fallback the installer had.
const fs = require('node:fs');
const path = require('node:path');
const rt = require('./install/runtime.js');  // R105: every external command through the one Windows-safe spawn

const REPO = path.join(__dirname, '..');
const PINS = path.join(REPO, 'meta', 'mcp-pins.json');

// registry: how to ask, and the spelling the pin takes inside the server's own command line.
const PACKAGES = {
    'browser':    { registry: 'npm',  package: '@playwright/mcp',       spelling: '@<v>' },
    'navigation': { registry: 'pypi', package: 'serena-agent',          spelling: '@<v>' },
    // The memory pin is spelled '==<v>' INSIDE the extras brackets ('mcp-memory-service[sqlite]==<v>'),
    // not '@<v>' like the others, which have no extras suffix to sit next to.
    'memory':     { registry: 'pypi', package: 'mcp-memory-service',    spelling: '==<v>' },
};

function npmLatest(pkg)
{
    try
    {
        const out = rt.execCommand('npm', ['view', pkg, 'version'],
            { encoding: 'utf8', timeout: 30000, env: { ...process.env, npm_config_fetch_timeout: '15000' } });
        return out.trim() || null;
    }
    catch { return null; }
}

function pypiLatest(pkg)
{
    try
    {
        const out = rt.execCommand('curl', ['-fsSL', '--max-time', '20', `https://pypi.org/pypi/${pkg}/json`],
            { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
        return JSON.parse(out).info.version || null;
    }
    catch { return null; }
}

function readPins()
{
    try { return JSON.parse(fs.readFileSync(PINS, 'utf8')); }
    catch { return { note: '', refreshed: null, pins: {} }; }
}

function main(argv)
{
    const write = argv.includes('--write');
    const current = readPins();
    const pins = {};
    const report = [];
    for (const [name, spec] of Object.entries(PACKAGES))
    {
        const was = (current.pins && current.pins[name] && current.pins[name].version) || null;
        const now = spec.registry === 'npm' ? npmLatest(spec.package) : pypiLatest(spec.package);
        // Unreachable keeps the committed pin: a refresh run on a plane must not unpin the stack.
        const version = now || was;
        pins[name] = { package: spec.package, registry: spec.registry, spelling: spec.spelling, version };
        if (!now) report.push(`  ${name}: NOT CHECKED (registry unreachable) - keeping ${was || 'unpinned'}`);
        else if (now === was) report.push(`  ${name}: ${now} (unchanged)`);
        else report.push(`  ${name}: ${was || 'unpinned'} -> ${now}`);
    }
    console.log(report.join('\n'));
    if (!write) { console.log('\nnothing written - re-run with --write to commit these pins'); return 0; }
    const out = {
        generatedBy: 'refresh-mcp-pins',
        note: 'The MCP runtime versions the generated plugin entries pin to. Refreshed deliberately with `node scripts/refresh-mcp-pins.js --write`, never during an install. A null version ships unpinned.',
        refreshed: new Date().toISOString().slice(0, 10),
        pins,
    };
    fs.writeFileSync(PINS, JSON.stringify(out, null, 2) + '\n');
    console.log(`\npins written: ${path.relative(REPO, PINS)}`);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { PACKAGES, readPins, main };
