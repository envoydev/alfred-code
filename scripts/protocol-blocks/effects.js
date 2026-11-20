'use strict';
// The protocol-block approval's one touch of the outside world: it reads the setup bodies and writes the table.
const fs = require('node:fs');
const path = require('node:path');
const { BODY_DIRS, TABLE_FILE, GENERATED_BY, TABLE_NOTE } = require('./constants.js');
const { buildTable } = require('./blocks.js');

// Every markdown body under the setup folders, in a stable order.
function readBodies(root)
{
    const files = [];
    const walk = (dir) =>
    {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)))
        {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.md')) files.push({ file: path.relative(root, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
        }
    };
    for (const dir of BODY_DIRS) walk(path.join(root, dir));
    return files;
}

const tableText = (table) => `${JSON.stringify({ generatedBy: GENERATED_BY, note: TABLE_NOTE, ...table }, null, 2)}\n`;

// Writes the table, or with `check` reports whether the file on disk is current. Returns { file, current }.
function writeTable(root, { check = false } = {})
{
    const file = path.join(root, TABLE_FILE);
    const want = tableText(buildTable(readBodies(root)));
    let have = '';
    try { have = fs.readFileSync(file, 'utf8'); } catch { have = ''; }
    if (!check && have !== want) fs.writeFileSync(file, want);
    return { file: TABLE_FILE, current: have === want };
}

module.exports = { readBodies, writeTable };
