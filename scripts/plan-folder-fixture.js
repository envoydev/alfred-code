'use strict';
// A folder plan built through the engine, for the hook suites (PF1): the Markdown first, then the engine's verbs in
// a fixed order - sync, approve, start, done, block, cursor, redesign, complete - each one required to exit 0.
const fs = require('node:fs');
const path = require('node:path');
const P = require('../stack/hooks/plan-status.js');

const PLANS = '.alfred/docs/work/plans';

function markdown(cards)
{
    const out = ['# Feature - plan', '', 'Oriented: none - fixture', 'Asked: "x"', '', '## Tasks', ''];
    for (let n = 1; n <= cards; n++) out.push(`### Task ${n} - slice ${n}`, '', '- estimate: 10m', '');
    return out.join('\n');
}

function planFolder(root, id = 'csv', opts = {})
{
    const o = { cards: 3, plans: PLANS, approve: false, done: [], start: [], block: [], note: null, complete: false, redesign: false, session: null, sync: true, ...opts };
    const rel = `${o.plans}/${id}/`;
    const dir = path.join(root, ...o.plans.split('/'), id);
    const md = path.join(dir, `${id}.md`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(md, markdown(o.cards));
    const env = { CLAUDE_PROJECT_DIR: root, ...(o.session ? { CLAUDE_CODE_SESSION_ID: o.session } : {}) };
    const run = (argv, stdin = '') => P.run(argv, { cwd: root, env, stdin });
    const must = (argv, stdin = '') =>
    {
        const r = run(argv, stdin);
        if (r.code !== 0) throw new Error(`plan-folder-fixture: ${argv.join(' ')} -> ${r.code} ${r.err}`);
        return r;
    };
    const ref = ['--plan', id];
    if (o.sync) must(['sync', ...ref]);
    if (o.approve) must(['approve', ...ref, '--mode', 'session']);
    for (const t of o.start) must(['start', ...ref, '--task', t]);
    for (const t of o.done) { must(['start', ...ref, '--task', t]); must(['done', ...ref, '--task', t], `result: ok ${t}\n`); }
    for (const t of o.block) { must(['start', ...ref, '--task', t]); must(['block', ...ref, '--task', t], 'needs: a run\n'); }
    if (o.note !== null) must(['cursor', ...ref], `note: ${o.note}\n`);
    if (o.redesign) must(['redesign', ...ref], 'why: the seam moved\n');
    if (o.complete) must(['complete', ...ref, '--with-open'], 'suite: npm test - ok\n');
    const status = () => JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    return { dir, md, rel, run, status };
}

// Parse a status.json, change it in place, write it back as two-space JSON.
function putStatus(dir, change)
{
    const file = path.join(dir, 'status.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    change(s);
    fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
    return s;
}

module.exports = { planFolder, putStatus, PLANS };
