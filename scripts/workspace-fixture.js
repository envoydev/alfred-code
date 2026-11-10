'use strict';
// TEST HELPER (not shipped): writes and reads a project's workspace record for the suites, in either format, so a suite
// states the record's values and never its file's text. The suites moved onto it in the old line format first, then
// LEGACY_DEFAULT flipped to workspace.json - the same values must give the same results either way (spec: the
// workspace.json design, 2026-11-10, 'The fixture helper'). This is the one renderer of the old line format left.
const fs = require('node:fs');
const path = require('node:path');
const wf = require('../stack/hooks/workspace-file.js');

const LEGACY_DEFAULT = false;

// The old line format by the line-to-key table.
function legacyText(record)
{
    const lines = [];
    if (record.parent) lines.push(`parent ${record.parent}`);
    if (record.parentNone) lines.push('parent none');
    if (record.role && !(record.parentNone && record.role === 'standalone')) lines.push(`role ${record.role}`);
    if (record.above) lines.push(`above ${record.above}`);
    for (const child of record.children || []) lines.push(`child ${child}`);
    for (const [category, names] of Object.entries(record.ignore || {})) for (const name of names) lines.push(`ignore ${category} ${name}`);
    return lines.map((l) => `${l}\n`).join('');
}

// Writes `record` (a partial record) as the project's workspace record and returns the path written.
function putWorkspace(projectRoot, record, { dataRoot = '.alfred', legacy = LEGACY_DEFAULT } = {})
{
    const dir = path.join(projectRoot, ...dataRoot.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const full = { ...wf.emptyRecord(), ...record };
    const file = path.join(dir, legacy ? wf.LEGACY_NAME : wf.JSON_NAME);
    fs.writeFileSync(file, legacy ? legacyText(full) : `${JSON.stringify(wf.renderRecord(full), null, 2)}\n`);
    return file;
}

// The record the project holds, read through the one reader: { source, state, file, record, text } - `file` the path it
// was read from (workspace.json's when neither exists), `text` the file's own text.
function readWorkspaceRecord(projectRoot, { dataRoot = '.alfred' } = {})
{
    const read = wf.readRecord(path.join(projectRoot, ...dataRoot.split('/')));
    let text = read.text;
    if (text === null && read.state !== 'absent') { try { text = fs.readFileSync(read.file, 'utf8'); } catch { text = null; } }
    return { source: read.source, state: read.state, file: read.file, record: read.record, text };
}

// The record's set values only - null, false and empty keys left out - so an assertion names just what is set; null
// when the project holds no record. An empty record reads `{}`.
function readWorkspaceValues(projectRoot, opts = {})
{
    const read = readWorkspaceRecord(projectRoot, opts);
    if (read.state === 'absent') return null;
    const empty = (v) => v === null || v === false || (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length);
    return Object.fromEntries(Object.entries(read.record).filter(([, v]) => !empty(v)));
}

module.exports = { LEGACY_DEFAULT, putWorkspace, readWorkspaceRecord, readWorkspaceValues, legacyText };
