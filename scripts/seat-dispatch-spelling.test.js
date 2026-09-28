'use strict';
// 2.1.0 puts all 44 seats in the core plugin, and a plugin agent is addressable ONLY as
// `<plugin>:<agent>` (plugin-migration spike S1 run 4: the bare name returns 'Agent type not found').
// A body that tells the model to dispatch a seat by its bare name - or by a name built from the
// `<stack>-implementer` pattern - now costs a failed call on every plugin-route install, while the
// full copy route and cursor-stack still resolve the bare name. So a dispatch instruction never spells
// the seat bare as a literal `subagent_type`, and every body that dispatches a named seat carries the
// pinned clause (`seat-dispatch-spelling` in shared-rules.json): dispatch it exactly as the roster
// spells it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MARKER = 'exactly as the roster spells it';
const squash = (s) => s.replace(/\s+/g, ' ');
const seats = fs.readdirSync(path.join(ROOT, 'stack', 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
const SEAT = seats.slice().sort((a, b) => b.length - a.length).map((s) => s.replace(/[-]/g, '\\-')).join('|');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []);
const split = (txt) => {
    if (!txt.startsWith('---')) return { front: '', body: txt };
    const end = txt.indexOf('\n---', 3);
    return end < 0 ? { front: '', body: txt } : { front: txt.slice(0, end), body: txt.slice(end + 4) };
};
// A seat without the Agent tool never dispatches (the fan-out is the main session's), so a designer's
// 'the main session fans out to aspnet-implementer' describes, it does not instruct.
const dispatches = (front) => /^tools:.*\bAgent\b/m.test(front);
const bodies = () => [
    ...walk(path.join(ROOT, 'stack', 'skills')),
    ...walk(path.join(ROOT, 'stack', 'rules')),
    ...walk(path.join(ROOT, 'setup-plugin')),
    ...walk(path.join(ROOT, 'stack', 'agents')).filter((f) => dispatches(split(fs.readFileSync(f, 'utf8')).front)),
].map((f) => ({ rel: path.relative(ROOT, f), body: split(fs.readFileSync(f, 'utf8')).body }));

test('no shipped body spells a stack seat bare as a subagent_type', () => {
    const bare = new RegExp(`subagent_type\\s*[:=]\\s*[\`'"]?(?:${SEAT})(?![\\w-])`);
    const hits = bodies().filter((b) => bare.test(b.body)).map((b) => `${b.rel}: ${b.body.match(bare)[0]}`);
    assert.deepStrictEqual(hits, [], 'a plugin seat resolves only as alfred-code:<seat>');
});

test('every body that dispatches a named seat carries the roster-spelling clause', () => {
    // The dispatch verb, then a seat (a real name or the `<stack>-` pattern) inside the same clause.
    const instr = new RegExp(`\\b(?:[Dd]ispatch(?:es|ing)?|[Ff]ans? (?:out|the)|[Hh]and (?:each|it)[^.]{0,40}to)\\b[^.;]{0,90}?(?:<stack>-(?:implementer|verifier|solution-designer)|(?<![\\w:-])(?:${SEAT})(?![\\w-]))`);
    const missing = bodies().filter((b) => instr.test(b.body) && !squash(b.body).includes(MARKER))
        .map((b) => `${b.rel}: '${b.body.match(instr)[0].slice(0, 80)}'`);
    assert.deepStrictEqual(missing, [], `each needs '${MARKER}' - a bare seat name fails on the plugin route`);
});

test('the clause is pinned, and every carrier is a registered site', () => {
    const shared = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'shared-rules.json'), 'utf8'));
    const rule = shared.rules['seat-dispatch-spelling'];
    assert.ok(rule, 'shared-rules.json pins seat-dispatch-spelling');
    const pinned = new Set([rule.owner.file, ...rule.sites.map((s) => s.file)]);
    const carriers = bodies().filter((b) => squash(b.body).includes(MARKER)).map((b) => b.rel.split(path.sep).join('/'));
    assert.deepStrictEqual(carriers.filter((c) => !pinned.has(c)), [], 'a carrier nobody registered drifts silently');
});
