'use strict';
// The keyed rows of a settings file: the stack's keys of an object such as `skillOverrides`, each ledgered as
// `<object>{<sha256 of the key>}` at the hash of its value. The array members of settings.js (`syncMembers`) are the twin.
// A key already in the file with no row is the user's and is never claimed; a key whose value the user changed is theirs
// too, kept, and its row leaves. settings.js is past its size limit, so this sits beside it and requires it only inside a function.

const fs = require('node:fs');
const path = require('node:path');
const { formatOf, stringifyLike } = require('./json-file.js');
const { valueHash } = require('./stamp.js');
const { KEY_PATH } = require('./settings-keys-constants.js');

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keyRow = (objectPath, key) => `${objectPath}{${valueHash(key)}}`;
const valueRow = (value) => valueHash(JSON.stringify(value));
const keyByHash = (object, hash) => Object.keys(object).find((key) => valueHash(key) === hash);

// The rows of `prior` that belong to one object.
const rowsOf = (prior, objectPath) => Object.fromEntries(Object.entries(prior || {}).filter(([row]) => { const m = KEY_PATH.exec(row); return m && m[1] === objectPath; }));

// How a ledgered key stands in the parsed file: 'ours' (the key holds the value the row hashes), 'changed' (it holds another
// value) or 'absent' (the key or its object is gone).
function stateOfRow(data, row, hash)
{
    const [, objectPath, keyHash] = KEY_PATH.exec(row);
    if (!isPlainObject(data[objectPath])) return 'absent';
    const key = keyByHash(data[objectPath], keyHash);
    if (key === undefined) return 'absent';
    return valueRow(data[objectPath][key]) === hash ? 'ours' : 'changed';
}

// Takes one ledgered key out of the parsed file while it still holds its value, and drops its object once it is empty.
// Returns 'removed', 'changed' (the user's value, kept) or 'absent'.
function removeRowKey(data, row, hash)
{
    const state = stateOfRow(data, row, hash);
    if (state !== 'ours') return state;
    const [, objectPath, keyHash] = KEY_PATH.exec(row);
    delete data[objectPath][keyByHash(data[objectPath], keyHash)];
    if (!Object.keys(data[objectPath]).length) delete data[objectPath];
    return 'removed';
}

// Brings the stack's keys of one object to `want` (`{ key: value }`): a wanted key the file lacks is added and ledgered, a
// ledgered key still at the stack's value but wanted at another is rewritten (its row follows), a row whose key is no longer
// wanted takes its key out while the value is still the stack's, and a row whose key is gone or changed just leaves. The
// file is written only when something changed. Returns { rows, changed, created, refused }.
function syncKeys({ file, objectPath, want, prior = {}, log = () => {}, note = () => {}, report = null })
{
    const { readSettings, putFile } = require('./settings.js');
    const mine = rowsOf(prior, objectPath);
    let data;
    let existed;
    let fileText;
    try { ({ data, existed, text: fileText } = readSettings(file)); }
    catch (err) { note(`${err.message} - its ${objectPath} rows are kept as recorded`); return { rows: mine, changed: false, created: false, refused: true }; }
    if (Object.hasOwn(data, objectPath) && !isPlainObject(data[objectPath]))
    {
        note(`${path.basename(file)}: ${objectPath} is not an object - left as it is`);
        return { rows: mine, changed: false, created: false, refused: true };
    }
    const object = isPlainObject(data[objectPath]) ? { ...data[objectPath] } : {};
    const wanted = new Set(Object.keys(want).map(valueHash));
    const rows = {};
    let changed = false;
    for (const [row, hash] of Object.entries(mine))
    {
        const key = keyByHash(object, KEY_PATH.exec(row)[2]);
        if (key === undefined || valueRow(object[key]) !== hash) continue;
        if (wanted.has(valueHash(key)))
        {
            // The stack's own key at a new wanted value is rewritten, and its row follows; the file's one summary line counts it.
            if (valueRow(want[key]) !== hash) { object[key] = want[key]; changed = true; }
            rows[row] = valueRow(want[key]);
            continue;
        }
        delete object[key];
        changed = true;
        if (report) report.remove(objectPath, key);
    }
    for (const [key, value] of Object.entries(want))
    {
        if (Object.hasOwn(object, key)) continue;
        object[key] = value;
        rows[keyRow(objectPath, key)] = valueRow(value);
        changed = true;
    }
    if (!changed) return { rows, changed: false, created: false };
    if (Object.keys(object).length) data[objectPath] = object; else delete data[objectPath];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    putFile(file, stringifyLike(data, formatOf(fileText)));
    log(`  ${path.basename(file)}: ${objectPath} - ${Object.keys(rows).length} of the stack's keys`);
    return { rows, changed: true, created: !existed };
}

// The key rows of `prior` that a run which does not sync the keys still keeps: those whose key holds the stack's value in the
// file, or every one where the file cannot be read (the carry of settings.js `carryMemberRows`, for the rows of this file alone).
function carriedRows(file, prior)
{
    const { readSettings } = require('./settings.js');
    const mine = Object.fromEntries(Object.entries(prior || {}).filter(([row]) => KEY_PATH.test(row)));
    let data;
    try { ({ data } = readSettings(file)); }
    catch { return mine; }
    return Object.fromEntries(Object.entries(mine).filter(([row, hash]) => stateOfRow(data, row, hash) === 'ours'));
}

module.exports = { KEY_PATH, keyRow, valueRow, rowsOf, stateOfRow, removeRowKey, syncKeys, carriedRows };
