'use strict';

// ignores: [{ category, name }] as the workspace reader's view lists them - the same singular category words the
// redundant rows carry. Returns the rows whose '<category> <name>' no ignore names.
function dropIgnoredRows(rows, ignores)
{
    if (!ignores || !ignores.length) return rows;
    const ignored = new Set(ignores.map((entry) => `${entry.category} ${entry.name}`));
    return rows.filter((row) => !ignored.has(`${row.category} ${row.name}`));
}

module.exports = { dropIgnoredRows };
