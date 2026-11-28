// A2b (session audit 2026-11-27, wave T16): the stop contract denies an ask whose marked pick is a step only the user can do
// or whose question is about the user's own whereabouts. A shipped `ask` template that trips it would be denied on every run
// ('I will give the split (Recommended)' in dev-log-convert did, now 'Wait for your split'). Every template under stack/ and setup-plugin/ is sent through
// the hook's real entry, as a payload, and none may draw that denial.
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const { verdictResult } = require('./hook-test-env');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
for (const k of Object.keys(process.env)) if (k.startsWith('ALFRED_CODE_')) delete process.env[k];
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
delete process.env.CLAUDE_PROJECT_DIR;

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'stack', 'hooks', 'guard-stop-contract.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-user-step-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(TMP, { recursive: true, force: true }); });
process.env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(TMP, 'acct-'));
process.chdir(TMP);

const USER_STEP_DENIAL = /name the step in the reply and end the turn, or go on with other work/;
const ASK_FENCE = /^[ \t]*```ask[ \t]*\n([\s\S]*?)^[ \t]*```/gm;
const askLabel = (line) => { const m = line.match(/^- '(.*)' - /) || line.match(/^- '(.*)'\s*$/); return m ? m[1] : ''; };

function markdownFiles(dir)
{
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return markdownFiles(full);
        return entry.name.endsWith('.md') ? [full] : [];
    });
}
function shippedTemplates()
{
    const found = [];
    for (const file of ['stack', 'setup-plugin'].flatMap((dir) => markdownFiles(path.join(ROOT, dir))))
        for (const match of fs.readFileSync(file, 'utf8').matchAll(ASK_FENCE))
        {
            const lines = match[1].split('\n').map((line) => line.trim()).filter(Boolean);
            const options = lines.filter((line) => /^- '/.test(line)).map((line) =>
            {
                const label = askLabel(line);
                return { label, description: line.slice(`- '${label}'`.length).replace(/^\s*-\s*/, '') };
            });
            found.push({ where: path.relative(ROOT, file), question: lines[0], options });
        }
    return found;
}
function userStepDenial(...questions)
{
    const root = fs.mkdtempSync(path.join(TMP, 'proj-'));
    fs.mkdirSync(path.join(root, '.alfred', 'state', 'approvals'), { recursive: true });
    const payload = { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: questions.map((question) => ({ ...question, header: 'H', multiSelect: false })) },
        session_id: 'tpl', cwd: root, transcript_path: path.join(root, 'none.jsonl') };
    const result = verdictResult(spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, ALFRED_CODE_HOOK_LOG_DIR: fs.mkdtempSync(path.join(TMP, 'log-')) } }));
    return USER_STEP_DENIAL.test(`${result.stderr}\n${result.stdout}`);
}

test('a shipped ask template is never denied as a step only the user can do (A2b)', () =>
{
    const templates = shippedTemplates();
    assert.ok(templates.length >= 60, `the scan finds the templates (${templates.length})`);
    // one call judges them all (the hook stops at the first hit); only a hit sends each template through alone, to name it
    const denied = userStepDenial(...templates) ? templates.filter((template) => userStepDenial(template)).map((template) => `${template.where}: ${template.question.slice(0, 60)}`) : [];
    assert.deepStrictEqual(denied, []);
});
