'use strict';
// scripts/plan-contract-fixture.js - PF1 D14: reads docs/plan-folder-contract.md, the one home of the plan folder's
// public shapes, so each writer's test is held to the doc's example and key lists, never to a copy in the test.
const fs = require('node:fs');
const path = require('node:path');

const DOC = path.join(__dirname, '..', 'docs', 'plan-folder-contract.md');
const SECTIONS = { status: 'status.json', scoring: 'scoring.json', session: 'Session status file' };

// The body of each `## ` section, by its heading text.
function sections()
{
    const out = {};
    let name = null;
    for (const line of fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n').split('\n'))
    {
        const head = /^## (.+)$/.exec(line);
        if (head) { name = head[1].trim(); out[name] = []; continue; }
        if (name) out[name].push(line);
    }
    return out;
}

function section(key)
{
    const body = sections()[SECTIONS[key]];
    if (!body) throw new Error(`plan-contract-fixture: no '## ${SECTIONS[key]}' section in ${DOC}`);
    return body;
}

// The first json fence under each of the three sections, parsed.
function examples()
{
    const out = {};
    for (const key of Object.keys(SECTIONS))
    {
        const body = section(key);
        const open = body.findIndex((l) => l.trim() === '```json');
        const close = open < 0 ? -1 : body.findIndex((l, i) => i > open && l.trim() === '```');
        if (open < 0 || close < 0) throw new Error(`plan-contract-fixture: no json fence under '## ${SECTIONS[key]}'`);
        out[key] = JSON.parse(body.slice(open + 1, close).join('\n'));
    }
    return out;
}

// The backticked names of one `<label> (in file order):` line in a section.
function keyLine(key, label)
{
    const line = section(key).find((l) => l.startsWith(`${label} (in file order):`));
    if (!line) throw new Error(`plan-contract-fixture: no '${label} (in file order):' line under '## ${SECTIONS[key]}'`);
    return [...line.slice(line.indexOf(':') + 1).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

const keyLines = () => ({
    status: keyLine('status', 'Keys'),
    task: keyLine('status', 'Task keys'),
    scoring: keyLine('scoring', 'Keys'),
    round: keyLine('scoring', 'Round keys'),
    session: keyLine('session', 'Keys'),
});

// A value's shape: an object as its keys in order mapped through shapeOf, an array as a one-entry array of its first
// entry's shape ([] when empty), null as 'null', anything else its typeof.
function shapeOf(value)
{
    if (value === null) return 'null';
    if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
    if (typeof value === 'object') return Object.fromEntries(Object.keys(value).map((k) => [k, shapeOf(value[k])]));
    return typeof value;
}

module.exports = { examples, keyLines, shapeOf };
