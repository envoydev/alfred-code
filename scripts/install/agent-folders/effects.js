'use strict';

// The agent-folder pass (workspace versioning, D4): the one place it reads or writes the disk and runs git. For each of
// `.claude` and `.cursor` it asks plan.folderPlan what to do, does it, and hands back the two stamp records it keeps.
const fs = require('node:fs');
const path = require('node:path');
const { FOLDER, FOLDERS, IGNORE_FILE, ACTION, CLAUDE_IGNORE } = require('./constants.js');
const { folderPlan, wantedText } = require('./plan.js');

const readOrNull = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

function insideRepo(projectRoot, rt)
{
    const run = rt.spawnCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return run.status === 0 && String(run.stdout).trim() === 'true';
}

// Git tracks a file under the folder (a team's commit): a `.gitignore` there would hide nothing.
function tracksFiles(projectRoot, folder, rt)
{
    const run = rt.spawnCommand('git', ['ls-files', '-z', '--', folder], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return run.status === 0 && String(run.stdout || '').length > 0;
}

const writtenWhy = (folder, text) => (text === CLAUDE_IGNORE ? 'a local install keeps .claude out of git' : `versioning local keeps ${folder} out of git`);
const removedWhy = (folder, text) => (text === CLAUDE_IGNORE ? '.claude is shared at this scope' : `versioning is not local, so ${folder} is shared again`);

// { wrote, made }: whether the file is there now, and whether this call made the folder.
function writeText({ folder, dir, file, have, text, log })
{
    const made = !fs.existsSync(dir);
    try
    {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, text);
    }
    catch (err)
    {
        if (made) try { fs.rmdirSync(dir); } catch { /* not made, or not empty */ }
        log(`  !! ${folder}/${IGNORE_FILE} could not be written (${err.code || err.message}) - the next run tries again`);
        return { wrote: false, made: false };
    }
    log(`  ${folder}/${IGNORE_FILE} ${have === null ? 'written' : 'rewritten'} - ${writtenWhy(folder, text)}`);
    return { wrote: true, made };
}

// The stack's file leaves; a folder that cannot be written keeps it, with one `!!` line and no change to the records.
function removeText({ folder, file, have, log })
{
    try { fs.rmSync(file, { force: true }); }
    catch (err)
    {
        log(`  !! ${folder}/${IGNORE_FILE} could not be removed (${err.code || err.message}) - the next run tries again`);
        return false;
    }
    log(`  ${folder}/${IGNORE_FILE} removed - ${removedWhy(folder, have)}`);
    return true;
}

// `told` and `created` are the stamp's `told-tracked:` and `created-dirs:` records; each result is the FULL record: what
// was handed in plus what this call added, less a folder it removed; `failed` names the folders whose write or removal
// failed. `second` marks the pass after the ignore step: a change to `.claude` there moves the link homes, which happens
// at the next run. `skip` (the first pass's `failed`) leaves those folders alone, so a failure is said once per run.
function apply({ projectRoot, claudeDir, scope, log, rt, told = [], created = [] }, { versioning, second = false, skip = [] })
{
    const toldNow = new Set(told);
    const createdNow = new Set(created);
    const failed = [];
    const inRepo = insideRepo(projectRoot, rt);
    for (const folder of FOLDERS)
    {
        if (skip.includes(folder)) continue;
        const dir = folder === FOLDER.claude ? claudeDir : path.join(projectRoot, folder);
        const file = path.join(dir, IGNORE_FILE);
        const have = readOrNull(file);
        const tracked = inRepo && have === null && wantedText({ folder, scope, versioning }) !== null && tracksFiles(projectRoot, folder, rt);
        const plan = folderPlan({ folder, scope, versioning, have, tracked, inRepo, told: [...toldNow], created: [...createdNow] });
        let changed = false;
        if (plan.action === ACTION.tell) { log(`  ${plan.line}`); toldNow.add(plan.entry); }
        else if (plan.action === ACTION.write)
        {
            const done = writeText({ folder, dir, file, have, text: plan.text, log });
            changed = fs.existsSync(file);
            if (!done.wrote) failed.push(folder);
            if (done.made && folder === FOLDER.cursor) createdNow.add(folder);
        }
        else if (plan.action === ACTION.remove)
        {
            changed = removeText({ folder, file, have, log });
            if (!changed) failed.push(folder);
            if (changed && plan.dir) try { fs.rmdirSync(dir); createdNow.delete(folder); log(`  ${folder} removed - the stack made it and it is empty`); } catch { /* the project's files are in it */ }
        }
        if (second && changed && folder === FOLDER.claude)
            log(`  link homes: .claude is ${plan.action === ACTION.remove ? 'shared' : 'hidden'} now, so skills and agents move at the next run`);
    }
    return { toldTracked: [...toldNow].sort(), createdDirs: [...createdNow].sort(), failed };
}

module.exports = { apply };
