'use strict';
// THE OLD-NAME HOLD (B4), the effects: gather the project's own text files and hand them to the pure scan. Text only,
// under MAX_FILE_BYTES each, at most `maxFiles` of them and `maxBytes` in all. A file is checked and dropped at once, so only
// the paths that name the old store stay in memory. Nothing here prints a file's text.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MAX_SCAN_FILES, MAX_FILE_BYTES, MAX_SCAN_BYTES, NUL_PROBE_BYTES, EXTRA_FILES, SETTINGS_DIR, SETTINGS_FILE_PATTERN } = require('./constants.js');
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

// -> { text, bytes } for a text file under the size cap, else null. A binary file is told by a NUL in its first
// NUL_PROBE_BYTES, so its body is never read.
function readText(projectRoot, rel)
{
    const file = path.join(projectRoot, ...rel.split('/'));
    let fd;
    try
    {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
        fd = fs.openSync(file, 'r');
        const probe = Buffer.alloc(Math.min(stat.size, NUL_PROBE_BYTES));
        fs.readSync(fd, probe, 0, probe.length, 0);
        if (probe.includes(0)) return null;
        return { text: fs.readFileSync(fd, 'utf8'), bytes: stat.size };
    }
    catch { return null; }
    finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* nothing to close */ } } }
}

// -> { files: [relative paths that name the old store], capped }. `capped` is true when more than `maxFiles` readable files were
// found, or their text passed `maxBytes`: the scan stopped short, so the rename waits.
// The stack's own files (`installed`, `RUN_BOOKS`) and the data root are skipped before they are read or counted.
function scanOldNameReferences({ projectRoot, root, maxFiles = MAX_SCAN_FILES, maxBytes = MAX_SCAN_BYTES, installed })
{
    const own = { runBooks: RUN_BOOKS, installed };
    const present = (rel) => fs.existsSync(path.join(projectRoot, ...rel.split('/')));
    const all = [...new Set([...EXTRA_FILES.filter(present), ...settingsFiles(projectRoot), ...trackedFiles(projectRoot)])].filter((rel) => !isInstallerFile(root, rel, own));
    // Only a file actually read - text, under the size cap - counts toward `maxFiles` and `maxBytes`; capped means one more was left unread.
    const found = new Set();
    let read = 0;
    let bytes = 0;
    let capped = false;
    for (const rel of all)
    {
        const file = readText(projectRoot, rel);
        if (file === null) continue;
        if (read === maxFiles || bytes + file.bytes > maxBytes) { capped = true; break; }
        read += 1;
        bytes += file.bytes;
        for (const hit of oldNameReferences(root, [{ path: rel, text: file.text }], own)) found.add(hit);
    }
    return { files: [...found].sort(), capped };
}

module.exports = { scanOldNameReferences };
