'use strict';
// A flat agent file of an older install (`.claude/agents/<name>.md`, or in the store) and whose it is: the stack's only at a
// recorded hash, at the stack's own text, or - in a home git sees - for a seat this run picks on a stamp with no ledger.
// Anything else is the user's and stays, whichever route and picks line the stamp holds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { seedRun, POSIX_ONLY } = require('./seed-sandbox.js');

const COPY = { ALFRED_CODE_SKILLS_VIA_PLUGIN: 'false' };
const SEAT = 'security-auditor';
const MINE = `---\nname: ${SEAT}\ndescription: mine\n---\nMY OWN SEAT\n`;
const stampOf = (repo) => path.join(repo, '.claude', 'alfred-code.stamp');
const claude = (repo, ...rest) => path.join(repo, '.claude', 'agents', ...rest);
const store = (repo, ...rest) => path.join(repo, '.alfred', 'stack', 'agents', ...rest);
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const dropLines = (repo, pattern) => fs.writeFileSync(stampOf(repo), fs.readFileSync(stampOf(repo), 'utf8').split('\n').filter((l) => !pattern.test(l)).join('\n'));
const LEDGER = /^(managed-|workspace-(mcp|wrap))/;
const PICKS = /^picked-(skills|agents):/;
const ROUTES = [['plugin', {}], ['copy', COPY]];

// The old install's shape: the seat is not linked or stored as a folder, the user's flat file sits in `.claude/agents`.
const plantFlat = (repo) =>
{
    fs.rmSync(claude(repo, SEAT), { recursive: true, force: true });
    fs.rmSync(store(repo, SEAT), { recursive: true, force: true });
    fs.mkdirSync(claude(repo), { recursive: true });
    fs.writeFileSync(claude(repo, `${SEAT}.md`), MINE);
};
const reach = (repo) => ({
    mine: read(claude(repo, `${SEAT}.md`)), storeText: read(store(repo, SEAT, `${SEAT}.md`)), folder: lstat(claude(repo, SEAT)), storeFolder: lstat(store(repo, SEAT)), storeFlat: lstat(store(repo, `${SEAT}.md`)),
});
const run = (env, selection, each) => seedRun(['install', 'update', 'update'], selection, { env, args: [['--scope', 'local'], [], []], each, inspect: reach });

for (const [route, env] of ROUTES)
{
    test(`flat agents: local scope, a stamp with no ledger and no picks line keeps the user's unpicked ${SEAT} (${route} route)`, POSIX_ONLY, () =>
    {
        const { outs, result } = run(env, 'skill markdown-style\nagent evidence-gatherer\n', (repo, i) =>
        {
            if (i !== 0) return null;
            dropLines(repo, new RegExp(`${LEDGER.source}|${PICKS.source}`));
            plantFlat(repo);
            return null;
        });
        assert.strictEqual(result.mine, MINE, 'the user\'s text stays on disk');
        assert.strictEqual(result.storeFolder, null);
        assert.strictEqual(result.storeFlat, null);
        for (const out of outs.slice(1)) assert.ok(!/agent moved to a folder: security-auditor|pruned[^\n]*security-auditor/.test(out), out);
    });

    test(`flat agents: local scope, a stamp with no ledger and a picks line naming the seat keeps the user's edited file (${route} route)`, POSIX_ONLY, () =>
    {
        const { outs, result } = run(env, `skill markdown-style\nagent ${SEAT}\n`, (repo, i) =>
        {
            if (i !== 0) return null;
            dropLines(repo, LEDGER);
            assert.match(fs.readFileSync(stampOf(repo), 'utf8'), new RegExp(`^picked-agents:.*${SEAT}`, 'm'), 'the picks line names the seat');
            plantFlat(repo);
            return null;
        });
        assert.strictEqual(result.mine, MINE, 'the user\'s text stays on disk, neither moved nor overwritten');
        if (route === 'plugin') assert.strictEqual(result.storeFolder, null, 'the core carries the seat, nothing is stored');
        else assert.ok(result.storeText && !result.storeText.includes('MY OWN SEAT'), 'the stack\'s own copy is stored; the user\'s file is not taken into it');
        for (const out of outs.slice(1)) assert.ok(!/agent moved to a folder: security-auditor|pruned[^\n]*security-auditor/.test(out), out);
    });
}

test('flat agents: local scope, copy route, an edited flat file in the store is kept and named once, by its real path', POSIX_ONLY, () =>
{
    const { outs, result } = seedRun(['install', 'update', 'update'], `skill markdown-style\nagent ${SEAT}\n`, {
        env: COPY, args: [['--scope', 'local'], [], []],
        each: (repo, i) =>
        {
            if (i !== 0) return null;
            const text = fs.readFileSync(store(repo, SEAT, `${SEAT}.md`), 'utf8');
            fs.rmSync(store(repo, SEAT), { recursive: true });
            fs.unlinkSync(claude(repo, SEAT));
            fs.writeFileSync(store(repo, `${SEAT}.md`), `${text}\nMY EDIT\n`);
            return null;
        },
        inspect: (repo) => ({ edited: read(store(repo, `${SEAT}.md`)), folder: lstat(store(repo, SEAT)) }),
    });
    assert.match(result.edited, /MY EDIT/, 'the edited file stays on disk');
    assert.strictEqual(result.folder, null, 'no folder beside it');
    for (const out of outs.slice(1))
    {
        const lines = out.split('\n').filter((l) => /agent kept:[^\n]*security-auditor/.test(l));
        assert.strictEqual(lines.length, 1, `named once: ${lines.join(' | ')}`);
        assert.match(lines[0], /\.alfred\/stack\/agents\/security-auditor\.md/);
        assert.ok(!/ \.claude\/agents\/security-auditor\.md/.test(lines[0]), 'not the .claude path, which holds no such file');
    }
});
