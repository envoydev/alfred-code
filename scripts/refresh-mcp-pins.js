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
const { PYTHON } = require('../stack/mcp/uv-python.js');

const REPO = path.join(__dirname, '..');
const PINS = path.join(REPO, 'meta', 'mcp-pins.json');

// registry: how to ask, and the spelling the pin takes inside the server's own command line.
const PACKAGES = {
    'browser':    { registry: 'npm',  package: '@playwright/mcp',       spelling: '@<v>' },
    'navigation': { registry: 'pypi', package: 'serena-agent',          spelling: '@<v>' },
    // The memory pin is spelled '==<v>' INSIDE the extras brackets ('mcp-memory-service[sqlite]==<v>'),
    // not '@<v>' like the others, which have no extras suffix to sit next to.
    'memory':     { registry: 'pypi', package: 'mcp-memory-service',    spelling: '==<v>' },
    'windows-desktop': { registry: 'pypi', package: 'windows-mcp',      spelling: '==<v>' },
    'macos-desktop':   { registry: 'pypi', package: 'macos-mcp',        spelling: '==<v>' },
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

// Does a `requires_python` specifier admit this Python? `x.y` against the clauses PyPI carries (>=, >,
// <, <=, ==, !=, ~=, a trailing .* on == / !=). A clause it cannot read admits - the launch says so.
const vparts = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
function vcmp(a, b)
{
    const x = vparts(a);
    const y = vparts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
}
function admits(spec, python)
{
    for (const clause of String(spec || '').split(',').map((c) => c.trim()).filter(Boolean))
    {
        const m = /^(~=|==|!=|>=|<=|>|<)\s*([0-9][0-9.]*)(\.\*)?$/.exec(clause);
        if (!m) continue;
        const [, op, want, star] = m;
        const head = star ? vparts(python).slice(0, vparts(want).length).join('.') : python;
        const c = vcmp(head, want);
        const ok = { '>=': c >= 0, '>': c > 0, '<=': c <= 0, '<': c < 0, '==': c === 0, '!=': c !== 0,
            '~=': c >= 0 && vcmp(vparts(python).slice(0, vparts(want).length - 1).join('.'), vparts(want).slice(0, -1).join('.')) === 0 }[op];
        if (!ok) return false;
    }
    return true;
}

// The newest FINAL release, not yanked, that the stack's pinned Python can install - every uvx server
// starts on that one interpreter (stack/mcp/uv-python.js), so a pin past its floor fails at launch
// (windows-mcp 0.8.6 needs 3.14). null when no release qualifies: the row keeps its committed pin.
function newestFor(json, python)
{
    const releases = (json && json.releases) || {};
    const ok = Object.keys(releases)
        .filter((v) => /^[0-9]+(\.[0-9]+)*$/.test(v))
        .filter((v) => releases[v].length && releases[v].every((f) => !f.yanked) && admits(releases[v][0].requires_python, python))
        .sort(vcmp);
    return ok.length ? ok[ok.length - 1] : null;
}

function pypiLatest(pkg)
{
    try
    {
        const out = rt.execCommand('curl', ['-fsSL', '--max-time', '20', `https://pypi.org/pypi/${pkg}/json`],
            { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
        return newestFor(JSON.parse(out), PYTHON);
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
module.exports = { PACKAGES, readPins, main, newestFor, admits };
