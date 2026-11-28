'use strict';
// THE OLD-NAME HOLD (B4), the decision: which of the files the effects layer read still name `.sensitive-data`. Pure -
// file texts in, relative paths out. Never returns a value from a file, only its path.
const { OLD_NAME_PATTERN, OLD_TEMPLATE_LINES, SETTINGS_DIR, SETTINGS_FILE_PATTERN, INSTALLER_DENY_ROW, SCAN_COVERS } = require('./constants.js');

const isSettingsFile = (rel) => rel.startsWith(`${SETTINGS_DIR}/`) && SETTINGS_FILE_PATTERN.test(rel.slice(SETTINGS_DIR.length + 1));
const isRunBook = (runBooks, rel) => runBooks.some((book) => rel === book || rel.endsWith(`/${book}`));

// The stack's own: the paths its lists name under `.claude/` (`installed`: { files, prefixes }, installed.js), the run
// books, and everything in the data root. A settings file is never the stack's - it holds the user's rows too.
function isInstallerFile(root, rel, { runBooks = [], installed = { files: [], prefixes: [] } } = {})
{
    if (isSettingsFile(rel)) return false;
    const base = String(root).replace(/\/+$/, '');
    return rel.startsWith(`${base}/`) || isRunBook(runBooks, rel)
        || installed.files.includes(rel) || installed.prefixes.some((prefix) => rel.startsWith(prefix));
}

// A seeded AGENTS.md carries the stack's own template line, in any released spelling; it is the stack's text, not the user's reference.
const withoutTemplateLine = (text) => text.split('\n').filter((line) => !OLD_TEMPLATE_LINES.includes(line.trim())).join('\n');

// files: [{ path, text }], paths relative to the project with `/`. Returns the sorted paths of the user's files that name
// the old store; a settings file's own deny row, which the installer wrote, is not a reference.
function oldNameReferences(root, files, own = {})
{
    const found = new Set();
    for (const { path: rel, text } of files)
    {
        if (isInstallerFile(root, rel, own)) continue;
        const cleaned = withoutTemplateLine(isSettingsFile(rel) ? String(text).replace(INSTALLER_DENY_ROW, '""') : String(text));
        if (OLD_NAME_PATTERN.test(cleaned)) found.add(rel);
    }
    return [...found].sort();
}

// A file naming the old store holds the rename; so does a scan that stopped at the file cap - the guard reads both names,
// so a hold is safe, and a rename past a file the scan never read is not.
const holdsRename = (references, capped) => references.length > 0 || Boolean(capped);

// The report's lines for a held rename: what the scan covered, one line per file, then the cap where the scan stopped short.
function holdLines(root, references, capped, maxFiles)
{
    const lines = [`  !! sensitive: ${root}/.sensitive-data stays, both names stay readable - the scan covers ${SCAN_COVERS}`];
    for (const rel of references) lines.push(`  !! sensitive: ${rel} names ${root}/.sensitive-data - change it to ${root}/.secrets; the next update renames the store once no file names the old one`);
    if (capped) lines.push(`  !! sensitive: the scan stopped at ${maxFiles} files - a file it did not read may still name the old store, so the rename waits`);
    return lines;
}

module.exports = { oldNameReferences, isInstallerFile, holdsRename, holdLines };
