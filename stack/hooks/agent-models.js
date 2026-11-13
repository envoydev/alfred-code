// installer-managed - update overwrites local edits; put project policy in a separate hook file.
// THE MODEL FILE: a hand-edited <project>/.alfred/agents.json names, per host, the model a seat runs on - { "claude": { "agents":
// { "aspnet-verifier": { "model": "opus" } } } }. Not a hook: a module the dispatch guard requires inside a try. The nearest file wins.
'use strict';
const fs = require('fs');
const path = require('path');
const layout = require('./layout.js');
const HOSTS = ['claude', 'cursor'];
const KINDS = ['agents', 'skills'];
const MODEL_RE = /^[A-Za-z0-9._:\[\]-]{1,100}$/;
// Measured (docs/workspace-source-evidence.md): P5 - a skill's `model:` moves no request; P6 - the Agent tool's schema takes four names, and any other model in the reply REFUSES the dispatch.
const SKILLS_APPLY = false;
const SKILLS_WHY = SKILLS_APPLY ? '' : 'a skill\'s model field does not change the request on this Claude Code release';
const FULL_IDS = { agents: false, skills: false };
// A map its host or this release applies none of: its entries are checked, then it is named once and left out.
const OFF = { claude: { skills: SKILLS_APPLY ? '' : `not applied in this release (${SKILLS_WHY})` }, cursor: { agents: 'read, not applied - waits for the Cursor run', skills: 'no route on this host' } };
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// One file: { state: 'absent' | 'garbage' | 'ok', hosts: { <host>: { agents: { <name>: <model> }, skills: {} } }, problems: [<text>] }. Never throws.
function readFile(file)
{
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { if (e.code === 'ENOENT') return { state: 'absent', hosts: {}, problems: [] }; }
    if (!isObject(data)) return { state: 'garbage', hosts: {}, problems: ['not JSON - the file is ignored'] };
    const out = { state: 'ok', hosts: {}, problems: [] };
    const rowsOf = (value, at) => (isObject(value) ? Object.entries(value) : (out.problems.push(`${at}: not an object - skipped`), []));
    for (const [host, kinds] of Object.entries(data))
    {
        if (!HOSTS.includes(host)) { out.problems.push(`unknown host '${host}' skipped`); continue; }
        out.hosts[host] = { agents: {}, skills: {} };
        for (const [kind, rows] of rowsOf(kinds, host))
        {
            if (!KINDS.includes(kind)) { out.problems.push(`${host}: unknown key '${kind}' skipped`); continue; }
            const kept = {};
            for (const [name, entry] of rowsOf(rows, `${host}.${kind}`))
            {
                const model = isObject(entry) ? entry.model : undefined;
                const flaw = typeof model !== 'string' || !MODEL_RE.test(model) ? 'the model must be 1 to 100 characters of letters, digits and . _ : [ ] -' : !OFF[host][kind] && !FULL_IDS[kind] && !/^(sonnet|opus|haiku|fable)$/.test(model) ? 'the model must be one of sonnet, opus, haiku, fable - a full model id is not taken' : '';
                if (flaw) out.problems.push(`${host}.${kind}.${name}: ${flaw} - skipped`); else kept[name.slice(name.indexOf(':') + 1)] = model;
            }
            if (!OFF[host][kind]) out.hosts[host][kind] = kept;
            else if (Object.keys(kept).length) out.problems.push(`${host}.${kind}: ${OFF[host][kind]}`);
        }
    }
    return out;
}
// What applies at `start`, nearest first - its own file (`here`; in a linked git worktree with none, the main checkout's), then each linked member's above, seats alone: { applied: [{ kind, name, model, from }], problems: [{ from, text }] }.
function entries({ start, env = process.env, host })
{
    const above = layout.workspaceOn({ env, projectRoot: start }) ? layout.workspaceChain(layout.chainProjectOf(start), { env }).members : [];
    const files = [{ from: 'here', dir: path.join([start, layout.chainProjectOf(start)].find((d) => fs.existsSync(path.join(d, '.alfred', 'agents.json'))) || start, '.alfred') }, ...above.map((m) => ({ from: m.rel, dir: path.join(m.root, ...m.dataRoot.split('/')) }))];
    const out = { applied: [], problems: [] };
    for (const { from, dir } of files)
    {
        const read = readFile(path.join(dir, 'agents.json'));
        for (const kind of from === 'here' ? KINDS : ['agents'])
            for (const [name, model] of Object.entries((read.hosts[host] || {})[kind] || {}))
                if (!out.applied.some((row) => row.kind === kind && row.name === name)) out.applied.push({ kind, name, model, from });
        out.problems.push(...read.problems.filter((text) => from === 'here' || /^([a-z]+\.agents[.:]|not JSON)/.test(text)).map((text) => ({ from, text })));
    }
    return out;
}
// { model, from } for a seat or a skill, its plugin prefix dropped, or null.
const modelFor = ({ start, env, host, kind, name }) => entries({ start, env, host }).applied.filter((row) => row.kind === kind && row.name === String(name).slice(String(name).indexOf(':') + 1)).map(({ model, from }) => ({ model, from }))[0] || null;
module.exports = { HOSTS, KINDS, MODEL_RE, SKILLS_APPLY, SKILLS_WHY, FULL_IDS, readFile, modelFor, entries };
