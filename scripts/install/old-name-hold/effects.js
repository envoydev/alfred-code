'use strict';
// THE OLD-NAME HOLD (B4), the effects: gather the project's own text files and hand them to the pure scan. Text only,
// under MAX_FILE_BYTES each, at most `maxFiles` of them. Nothing here prints a file's text.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MAX_SCAN_FILES, MAX_FILE_BYTES, EXTRA_FILES, SETTINGS_DIR, SETTINGS_FILE_PATTERN } = require('./constants.js');
const { RUN_BOOKS } = require('../../../stack/mcp/data-root.js');
const { oldNameReferences, isInstallerFile } = require('./references.js');

const NUL = '\u0000';

function trackedFiles(projectRoot)
{
    const r = spawnSync('git', ['ls-files', '-z'], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true });
    return r.status === 0 ? r.stdout.split(NUL).filter(Boolean) : [];
}

function settingsFiles(projectRoot)
{
    try { return fs.readdirSync(path.join(projectRoot, SETTINGS_DIR)).filter((n) => SETTINGS_FILE_PATTERN.test(n)).map((n) => `${SETTINGS_DIR}/${n}`); }
    catch { return []; }
}

function readText(projectRoot, rel)
{
    const file = path.join(projectRoot, ...rel.split('/'));
    try
    {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
        const text = fs.readFileSync(file, 'utf8');
        return text.includes(NUL) ? null : text;
    }
    catch { return null; }
}

// -> { files: [relative paths that name the old store], capped }. `capped` is true when more than `maxFiles` readable files were found.
// The stack's own files (`installed`, `RUN_BOOKS`) and the data root are skipped before they are read or counted.
function scanOldNameReferences({ projectRoot, root, maxFiles = MAX_SCAN_FILES, installed })
{
    const own = { runBooks: RUN_BOOKS, installed };
    const present = (rel) => fs.existsSync(path.join(projectRoot, ...rel.split('/')));
    const all = [...new Set([...EXTRA_FILES.filter(present), ...settingsFiles(projectRoot), ...trackedFiles(projectRoot)])].filter((rel) => !isInstallerFile(root, rel, own));
    // Only a file actually read - text, under the size cap - counts toward `maxFiles`; capped means one more was left unread.
    const files = [];
    let capped = false;
    for (const rel of all)
    {
        const text = readText(projectRoot, rel);
        if (text === null) continue;
        if (files.length === maxFiles) { capped = true; break; }
        files.push({ path: rel, text });
    }
    return { files: oldNameReferences(root, files, own), capped };
}

module.exports = { scanOldNameReferences };
