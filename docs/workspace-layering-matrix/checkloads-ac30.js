'use strict';
// AC2 + AC30 (and AC27's check-loads bullet) end to end with the REAL claude: root + git child installed from the export (the installer's claude calls
// stubbed), then checkLoads in-process with a wrapped spawn, so the probe's env and its debug log can be read.
//   node checkloads-ac30.js <export> <real claude>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const REPO = path.resolve(process.argv[2]);
const REAL = process.argv[3];
const { seedRun } = require(path.join(REPO, 'scripts', 'seed-sandbox.js'));
const ws = require(path.join(REPO, 'scripts', 'install', 'workspace.js'));
const runtime = require(path.join(REPO, 'scripts', 'install', 'runtime.js'));
const CLI = path.join(REPO, 'scripts', 'workspace.js');
const SEL = 'skill javascript\nrule alfred-security\nrule alfred-navigation\n';
const rows = [];
const check = (id, ok, detail = '') => rows.push(`${ok ? 'PASS' : 'FAIL'} ${id}${ok ? '' : `\n     ${String(detail).replace(/\n/g, '\n     ').slice(0, 1800)}`}`);

const r = seedRun(['install', 'install'], SEL, {
    plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]),
    cwds: ['ws', 'ws/api'],
    prepare: (repo, work) => { fs.mkdirSync(path.join(work, 'ws', 'api'), { recursive: true }); execFileSync('git', ['init', '-q', path.join(work, 'ws', 'api')]); },
    each: (repo, i) =>
    {
        const work = path.dirname(repo);
        const root = path.join(work, 'ws');
        const child = path.join(root, 'api');
        const acct = path.join(work, 'acct');
        const env = { PATH: process.env.PATH, HOME: work, CLAUDE_CONFIG_DIR: acct, TMPDIR: process.env.TMPDIR };
        if (i === 0)
        {
            ws.writeWorkspace(child, (m) => ws.setParent(m, '..'), { env });
            ws.writeWorkspace(root, (m) => ws.addChild(m, 'api'), { env });
            return null;
        }
        // A filled AGENTS.md at the root - the team's own file, which a child session should still load.
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Team rules\n\nRun the tests before a commit.\n');
        const local = path.join(child, '.claude', 'settings.local.json');
        const original = fs.readFileSync(local, 'utf8');
        const probe = (extraEnv = {}) =>
        {
            const seen = {};
            const rt = { ...runtime, spawnCommand: (cmd, args, opts) =>
            {
                const out = runtime.spawnCommand(cmd, args, opts);
                seen.env = opts.env;
                const at = args.indexOf('--debug-file');
                try { seen.log = fs.readFileSync(args[at + 1], 'utf8'); } catch { seen.log = ''; }
                return out;
            } };
            const result = ws.checkLoads({ projectRoot: child, env: { ...env, ...extraEnv }, configDir: acct, claudeBin: REAL, rt });
            return { result, ...seen };
        };
        const out = {};
        // 1. all the excludes, ANTHROPIC_API_KEY in the calling env (a dummy value, never a real key)
        out.clean = probe({ ANTHROPIC_API_KEY: 'sk-ant-dummy-not-a-key' });
        // 2. one exclude row deleted by hand - the root's alfred-security rule
        const data = JSON.parse(original);
        const dropped = data.claudeMdExcludes.find((g) => /[sS]\][eE]?.*[cC][uU][rR][iI][tT][yY]/.test(g) || /security/i.test(g.replace(/\[(.)[^\]]?\]/g, '$1')));
        data.claudeMdExcludes = data.claudeMdExcludes.filter((g) => g !== dropped);
        fs.writeFileSync(local, JSON.stringify(data, null, 2));
        out.oneOut = probe();
        fs.writeFileSync(local, original);
        // 3. the account's instructionFiles key set: clean with the excludes, the seed AGENTS.md a miss without its row
        out.apply = spawnSync(process.execPath, [CLI, 'account-instructions', '--root', child, '--apply'], { env: { ...process.env, ...env }, encoding: 'utf8' });
        out.keyed = probe();
        const data2 = JSON.parse(original);
        const agentsRow = data2.claudeMdExcludes.find((g) => /agents\.md$/i.test(g.replace(/\[(.)[^\]]?\]/g, '$1')));
        data2.claudeMdExcludes = data2.claudeMdExcludes.filter((g) => g !== agentsRow);
        fs.writeFileSync(local, JSON.stringify(data2, null, 2));
        out.keyedOut = probe();
        fs.writeFileSync(local, original);
        // 4. the skips: a project apiKeyHelper, a settings.local.json env key - no claude start
        const proj = path.join(child, '.claude', 'settings.json');
        const projOriginal = fs.readFileSync(proj, 'utf8');
        fs.writeFileSync(proj, JSON.stringify({ ...JSON.parse(projOriginal), apiKeyHelper: '/bin/echo' }, null, 2));
        out.helper = probe();
        fs.writeFileSync(proj, projOriginal);
        for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK'])
        {
            const d = JSON.parse(original);
            d.env = { ...(d.env || {}), [key]: key === 'ANTHROPIC_API_KEY' ? 'sk-ant-dummy-not-a-key' : '1' };
            fs.writeFileSync(local, JSON.stringify(d, null, 2));
            out[key] = probe();
            fs.writeFileSync(local, original);
        }
        out.record = fs.readFileSync(path.join(child, '.alfred', 'state', 'workspace-check.json'), 'utf8');
        out.dropped = dropped;
        out.root = root;
        out.files = execFileSync('find', [root, '-maxdepth', '3', '-name', '*.md', '-not', '-path', '*/skills/*', '-not', '-path', '*/rules/*'], { encoding: 'utf8' });
        return out;
    },
});
const g = r.steps[1];
const NO_CRED = /Not logged in|no credentials|No API key|not authenticated/i;
const request = /api\.anthropic\.com\/v1\/messages|\[API:request\]|POST \/v1\/messages/i;
const agentsLines = (log) => (log || '').split('\n').filter((l) => /AGENTS\.md/.test(l)).map((l) => l.slice(0, 260));
check('AC2 with every exclude, check-loads is clean on macOS', g.clean.result.state === 'clean', JSON.stringify(g.clean.result));
check('AC30 ANTHROPIC_API_KEY in the calling env never reaches the probe', g.clean.env && !Object.keys(g.clean.env).some((k) => /ANTHROPIC_API_KEY/i.test(k)), JSON.stringify(Object.keys(g.clean.env || {})));
check('AC30 the probe HOME is a throwaway folder', g.clean.env && /alfred-check-loads-/.test(g.clean.env.HOME) && g.clean.env.HOME !== process.env.HOME, g.clean.env && g.clean.env.HOME);
check('AC30 the debug log carries the no-credentials line, and no request is made', NO_CRED.test(g.clean.log) && !request.test(g.clean.log), (g.clean.log.split('\n').filter((l) => NO_CRED.test(l) || request.test(l)).join('\n')) || g.clean.log.slice(0, 1200));
check('AC2 one exclude row deleted by hand: check-loads names that miss alone', g.oneOut.result.state === 'misses' && g.oneOut.result.misses.length === 1 && /alfred-security\.md$/.test(g.oneOut.result.misses[0]), `${JSON.stringify(g.oneOut.result)}\ndropped=${g.dropped}`);
check('AC30 with the instructionFiles key: clean with the excludes - the scan keeps the filled root AGENTS.md and the child\'s own, not the seed', g.apply.status === 0 && g.keyed.result.state === 'clean' && agentsLines(g.keyed.log).some((l) => /found 2 of \d+ directories/.test(l)),
    `${g.apply.stdout}${g.apply.stderr}\n${JSON.stringify(g.keyed.result)}\n${agentsLines(g.keyed.log).join('\n')}`);
check('AC30 with the instructionFiles key and the AGENTS.md row taken out: the seed .claude/AGENTS.md is the miss', g.keyedOut.result.state === 'misses' && g.keyedOut.result.misses.some((m) => /\.claude\/AGENTS\.md$/.test(m)), `${JSON.stringify(g.keyedOut.result)}\n${agentsLines(g.keyedOut.log).join('\n')}`);
check('AC30 a project apiKeyHelper is skipped with its line, no claude start', g.helper.result.state === 'skipped' && /apiKeyHelper/.test(g.helper.result.why) && !g.helper.env, JSON.stringify(g.helper.result));
for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK'])
    check(`AC30 settings.local.json env ${key} is skipped with its line, no claude start`, g[key].result.state === 'skipped' && new RegExp(`env\\.${key}`).test(g[key].result.why) && !g[key].env, JSON.stringify(g[key].result));
check('AC30 the record names the last state', /"state":"skipped"/.test(g.record), g.record);
// AC27: a nested project that answered 'Stay standalone' (parent none) still gets the root's excludes, and check-loads
// there reports clean with the real CLI.
const solo = seedRun(['install', 'install'], SEL, {
    plugins: JSON.stringify([{ id: 'alfred-code@envoydev', enabled: true, scope: 'user' }]),
    cwds: ['ws', 'ws/solo'],
    prepare: (repo, work) => { fs.mkdirSync(path.join(work, 'ws', 'solo'), { recursive: true }); execFileSync('git', ['init', '-q', path.join(work, 'ws', 'solo')]); },
    each: (repo, i) =>
    {
        const work = path.dirname(repo);
        const project = path.join(work, 'ws', 'solo');
        const env = { PATH: process.env.PATH, HOME: work, CLAUDE_CONFIG_DIR: path.join(work, 'acct'), TMPDIR: process.env.TMPDIR };
        if (i === 0) { ws.writeWorkspace(project, (m) => ws.setParent(m, 'none'), { env }); return null; }
        const excludes = (JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.local.json'), 'utf8')).claudeMdExcludes || []).length;
        const line = fs.readFileSync(path.join(project, '.alfred', 'workspace'), 'utf8');
        return { excludes, line, result: ws.checkLoads({ projectRoot: project, env, configDir: path.join(work, 'acct'), claudeBin: REAL }) };
    },
});
const sg = solo.steps[1];
check('AC27 a parent none project still gets the root\'s excludes, and check-loads there is clean', /^parent none$/m.test(sg.line) && sg.excludes > 0 && sg.result.state === 'clean', JSON.stringify(sg));
console.log(rows.join('\n'));
const failed = rows.filter((x) => x.startsWith('FAIL')).length;
console.log(`\n${rows.length - failed}/${rows.length} pass`);
process.exitCode = failed ? 1 : 0;
