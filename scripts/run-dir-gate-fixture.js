'use strict';
// Shared by the run-dir gate's test files: a stand-in body of the walk, its generated table, and the names the forms use.
const fs = require('node:fs');
const path = require('node:path');
const { buildTable } = require('./run-dir-gate/table.js');
const { RESOLVE_LINE } = require('./run-dir-gate/constants.js');

const ROOT = path.join(__dirname, '..');
const BODY_FILE = 'setup-plugin/commands/init.md';
const D = '/t/alfred-code.AbC123';
const MARKER = '/m/alfred-code-run.x.path';
const PLUGIN_ROOT = '/plug';
const PROJECT = '/p';

function readBodies()
{
    const files = [];
    const walk = (dir) =>
    {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) files.push({ file: path.relative(ROOT, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
        }
    };
    walk(path.join(ROOT, 'setup-plugin/commands'));
    walk(path.join(ROOT, 'setup-plugin/references'));
    return files;
}

const call = (script, args) => `node "$TMP/repo/${script}" ${args}`;
const resolveFence = `\`\`\`bash\n${RESOLVE_LINE}\n\`\`\``;
const bodyOf = (lines) => [resolveFence, '```bash', ...lines, '```'].join('\n');
const tableOf = (lines) => buildTable([{ file: BODY_FILE, text: bodyOf(lines) }]);

// What a walk body writes for the scripts the gate tests call.
const LINES = [
    call('scripts/install/stamp.js', 'scope .'),
    call('scripts/install/stamp.js', 'state .'),
    call('scripts/install/stamp.js', 'mark .'),
    call('scripts/install/stamp.js', 'x'),
    call('scripts/install/stamp.js', 'x .'),
    call('scripts/install/stamp.js', 'x --root . --root "./<rel>" --out "$TMP/<name>"'),
    call('scripts/install/stamp.js', 'y .'),
    call('scripts/install/alfred-code.js', 'update --source "$TMP/repo" --scope <scope> --installed-only --print-plan --plan-out "$TMP/parent.json"'),
    call('scripts/install/alfred-code.js', 'update --source "$TMP/repo" --scope <scope> --installed-only --add \'<line>\' --drop "<category> <name>" --memory default|docs'),
    call('scripts/install/alfred-code.js', 'install --source "$TMP/repo" --scope <scope> --selection "$TMP/selection.txt" --memory docs'),
    call('scripts/install/alfred-code.js', 'uninstall --source "$TMP/repo"'),
    call('scripts/stack-select.js', '--inherited-check "$TMP/parent.json" --emit "$TMP/selection.txt"'),
    call('scripts/scan-evidence.js', '--root . --catalog "$TMP/repo/meta/evidence.json" --out "$TMP/found.json"'),
    call('scripts/scan-evidence.js', '--root <rel> --out "$TMP/found-<n>.json"'),
    call('scripts/update-preflight.js', '--snapshot "$TMP/repo" --root .'),
    call('scripts/plugin-settings.js', '--catalog "$TMP/repo/meta/plugin-settings.json" --config-dir <account dir> --installed <kept plugins csv> --apply'),
    call('scripts/workspace.js', 'answer --file "$TMP/answers.json" --project <rel> -- <flag> <value>'),
    call('scripts/workspace.js', 'answer --file "$TMP/answers.json" --hold'),
    call('scripts/workspace.js', 'cascade --root . --source "$TMP/repo" --answers "$TMP/answers.json"'),
    call('scripts/workspace.js', 'role --root . --answer <answer>'),
    call('scripts/variables.js', 'set --root . --scope <scope> KEY=value'),
    call('stack/hooks/guard-secret-value.js', '--redacted <settings.json>'),
];
const table = tableOf(LINES);
const SHAPES = table.scripts;
const ctx = { runDir: D, cwd: PROJECT, pluginRoot: PLUGIN_ROOT, scripts: SHAPES, markerPath: MARKER };
const node = (script) => `node "${D}/repo/${script}"`;
const stamp = node('scripts/install/stamp.js');
const alfred = node('scripts/install/alfred-code.js');
const own = { raw: D, path: D, real: D, inTemp: true, session: 's1', owned: true };
const foreign = { raw: '/t/alfred-code.Other1', path: '/t/alfred-code.Other1', real: '/t/alfred-code.Other1', inTemp: true, session: 's2', owned: true };

module.exports = { ROOT, BODY_FILE, D, MARKER, PLUGIN_ROOT, PROJECT, readBodies, call, bodyOf, tableOf, LINES, SHAPES, ctx, node, stamp, alfred, own, foreign };
