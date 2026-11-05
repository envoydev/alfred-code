// THE COLLECTOR FIXTURE - one throwaway session for scripts/collect-session.test.js and the drift test: an isolated
// HOME and CLAUDE_CONFIG_DIR, a project, a transcript in the shape Claude Code writes (head and tail lines carrying no
// timestamp, read 2026-11-04 on local transcripts), its <sid>/ folder, a second session beside it and, with
// `stores`, every store the collector reads, for both sessions. A test helper, not a test: nothing here asserts.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execCommand } = require('./install/runtime.js');

const line = (o) => JSON.stringify(o) + '\n';
const FIRST_MS = Date.parse('2026-11-01T10:00:00.000Z');
const LAST_MS = Date.parse('2026-11-01T11:00:00.000Z');

// The transcript rows of one session: the head lines, four timestamped rows from `firstMs` to `lastMs` (one Write of a
// plan under the docs root), the closing bridge line.
function transcriptRows({ sid, project, plan, firstMs, lastMs, marker = '' })
{
    const at = (ms) => new Date(ms).toISOString();
    const mid = Math.round((firstMs + lastMs) / 2);
    return [
        { type: 'last-prompt', lastPrompt: `go${marker}`, sessionId: sid },
        { type: 'mode', mode: 'normal', sessionId: sid },
        { type: 'file-history-snapshot', messageId: 'm0', isSnapshotUpdate: false,
            snapshot: { messageId: 'm0', trackedFileBackups: {}, timestamp: at(firstMs - 60000) } },
        { type: 'user', timestamp: at(firstMs), cwd: project, sessionId: sid, uuid: 'u1', parentUuid: null,
            message: { role: 'user', content: `start${marker}` } },
        { type: 'assistant', timestamp: at(mid), cwd: project, sessionId: sid, uuid: 'a1', parentUuid: 'u1',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: plan, content: '# plan' } }] } },
        { type: 'user', timestamp: at(mid + 1000), cwd: project, sessionId: sid, uuid: 'u2', parentUuid: 'a1',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
        { type: 'assistant', timestamp: at(lastMs), cwd: project, sessionId: sid, uuid: 'a2', parentUuid: 'u2',
            message: { role: 'assistant', content: [{ type: 'text', text: `done${marker}` }] } },
        { type: 'bridge-session', sessionId: sid },
    ];
}

// Claude Code names a project's transcript folder after its path, every non-alphanumeric as '-'.
const encodeProject = (dir) => dir.replace(/[^A-Za-z0-9]/g, '-');

function makeSession(opts = {})
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-fx-'));
    const home = path.join(root, 'home');
    const config = path.join(root, 'config');
    const project = path.join(root, 'project');
    const tmp = path.join(root, 'tmp');
    for (const d of [home, config, project, tmp]) fs.mkdirSync(d, { recursive: true });
    // A fixed clock a day past the fixed last row, so every age-based rule reads the same on any machine.
    const now = opts.now ?? LAST_MS + 86400000;
    const lastMs = opts.lastRowAgeMs === undefined ? LAST_MS : now - opts.lastRowAgeMs;
    const firstMs = lastMs - (LAST_MS - FIRST_MS);
    const sid = crypto.randomUUID();
    const otherSid = crypto.randomUUID();
    const dataPath = opts.dataPath || '.alfred';
    const dataRoot = path.resolve(project, dataPath);
    const docsRoot = path.join(dataRoot, 'docs');

    const write = (rel, text) =>
    {
        const file = path.isAbsolute(rel) ? rel : path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return file;
    };

    if (opts.git)
    {
        execCommand('git', ['init', '-q', project], { stdio: 'ignore' });
        if (opts.gitignore !== undefined) write(path.join(project, '.gitignore'), opts.gitignore);
    }
    const settings = {};
    if (opts.dataPath) settings.ALFRED_CODE_DATA_PATH = opts.dataPath;
    if (Object.keys(settings).length) write(path.join(project, '.claude', 'settings.json'), JSON.stringify({ env: settings }, null, 2));
    fs.mkdirSync(dataRoot, { recursive: true });
    if (opts.instrument !== undefined) write(path.join(dataRoot, '.variables'), `ALFRED_CODE_INSTRUMENT=${opts.instrument}\n`);

    const folder = path.join(config, 'projects', encodeProject(project));
    const plan = path.join(docsRoot, 'work', 'plans', 'p.md');
    const transcript = write(path.join(folder, `${sid}.jsonl`),
        transcriptRows({ sid, project, plan, firstMs, lastMs }).map(line).join(''));
    write(path.join(folder, `${otherSid}.jsonl`),
        transcriptRows({ sid: otherSid, project, plan: path.join(docsRoot, 'work', 'plans', 'other.md'), firstMs, lastMs, marker: ' OTHER' }).map(line).join(''));
    write(path.join(folder, sid, 'subagents', 'agent-a1.jsonl'), line({ type: 'assistant', timestamp: new Date(firstMs + 5000).toISOString(),
        agentId: 'a1', sessionId: sid, message: { role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'Edit',
            input: { file_path: path.join(docsRoot, 'work', 'notes.md'), old_string: 'a', new_string: 'b' } }] } }));
    write(path.join(folder, sid, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose' }));
    write(path.join(folder, sid, 'tool-results', 'r1.txt'), 'a tool result');
    write(path.join(folder, sid, 'custom-title.json'), JSON.stringify({ title: 'fixture' }));

    const fx = {
        root, home, config, project, transcript, sid, otherSid, dataRoot, docsRoot, tmp, now, folder,
        firstMs, lastMs, out: path.join(root, 'out'),
        env: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, PATH: process.env.PATH },
        write,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
    if (opts.stores) plantStores(fx);
    return fx;
}

// The name-matched stores of the data root, for both sessions (the other session's content marked OTHER), and the
// session-inspector status file under the project.
const SESSION_NAMES = (s) => [
    `AUTO-RUN-${s}`, `AUTO-TAKEN-${s}`, `AUTO-SAID-${s}`, `COMPACT-STATE-${s}`, `twins-${s}.json`, `review-snapshot-${s}@c1.json`,
    `trivial-${s}`, `turn-check-${s}`, `AGENT-CAP-${s}-R-a1`, `SCORER-${s}`, `SCORER-HELD-${s}`, `preferences-${s}-main.json`,
];
const FORGE_NAMES = (s) => [`ACTS-${s}.jsonl`, `REFS-${s}.json`, `NOTE-${s}.json`, `PAUSE-${s}.json`];
function plantStores(fx)
{
    const at = new Date(fx.firstMs + 10000).toISOString();
    for (const [s, mark] of [[fx.sid, ''], [fx.otherSid, ' OTHER']])
    {
        const state = (kind, name) => path.join(fx.dataRoot, 'state', kind, name);
        const stats = (...parts) => path.join(fx.dataRoot, 'statistics', ...parts);
        fx.write(stats('hook-blocks', `${s}.jsonl`), line({ ts: at, session: s, hook: `guard-read-whole-file.js${mark}` }));
        fx.write(stats('tools-usage', `${s}.jsonl`), line({ ts: at, session: s, tool: 'Read', detail: `x${mark}` }) + line({ ts: at, session: s, tool: 'Bash', detail: `y${mark}` }));
        fx.write(state('history', `${s}.json`), JSON.stringify({ session: s, start: `abc${mark}` }));
        fx.write(path.join(state('sessions', 'scorer'), s, 'draft.md'), `# draft${mark}`);
        for (const name of SESSION_NAMES(s)) fx.write(state('sessions', name), `${name}${mark}`);
        const record = s === fx.sid ? 'untracked-at-start-abc123' : 'untracked-at-start-def456';
        fx.write(state('sessions', `untracked-session-${s}`), record);
        fx.write(state('sessions', record), `a.txt${mark}`);
        for (const name of FORGE_NAMES(s)) fx.write(state('forge', name), `${name}${mark}`);
        fx.write(path.join(fx.project, '.claude', 'session-inspector', 'status', `${s}.json`), JSON.stringify({ schema: 1, session: s, title: `t${mark}` }));
    }
}

module.exports = { makeSession, plantStores, transcriptRows, encodeProject, line, SESSION_NAMES, FORGE_NAMES, FIRST_MS, LAST_MS };
