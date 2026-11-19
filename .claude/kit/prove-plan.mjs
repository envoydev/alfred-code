#!/usr/bin/env node
// Copied into each repo as .claude/kit/prove-plan.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Proves an audit plan (shared/skills/repo-audit-plugin/references/plan-format.md): reads every edited file at the
// plan's Baseline revision, never from the working tree, and applies the edits in plan order - each Old found exactly
// once, at or after the end of the last edit to the same file, and replaced by its New. When every edit applied it
// writes the resulting files into a folder beside the plan (plan.md -> expected/) and prints one line per file. Each
// file there carries the suffix .expected (expected/src/a.test.ts.expected), so no test runner's pattern picks it up;
// --check also reads a folder written before the suffix.
//
//   node .claude/kit/prove-plan.mjs [--check] <plan> [--without E<n>[,E<m>]]...    run at the repository root
//
// --without, after a full pass, also writes expected-without-E<n>/: the plan with that edit and every edit that needs
// it left out. Prints `Applies: <applied> of <total> edits` always; a failed edit is named on stderr, one line each.
// --check replays the same way and writes nothing: it compares the result with the folders already beside the plan
// and with the plan's own `Applies:` line, prints one `Proved:` line per folder when all agree, and names each
// difference on stderr, one line each, when not.
// Exits 0 when every edit applied (with --check: and nothing differs), 1 when one did not (or something differs), 2
// when the plan or the command line cannot be used. Writes only beside the plan, never with --check, and runs no git
// command that changes anything.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXPECTED_FILE_SUFFIX } from './constants.mjs';
import {
    PlanError,
    appliesDifference,
    compareFolder,
    expectedFolderName,
    fail,
    parsePlan,
    proveVariant,
    replay,
    resultStates,
    resultTexts,
} from './plan-replay.mjs';

const EXIT = Object.freeze({ applied: 0, failed: 1, usage: 2 });
const WITHOUT_WORD = 'without';
const WITHOUT_OPTION = `--${WITHOUT_WORD}`;
const WITHOUT_VALUE = /^E\d+(,E\d+)*$/;
const CHECK_OPTION = '--check';
const IGNORED_FILE_NAME = '.DS_Store';
const NOT_A_FOLDER_CODES = new Set(['ENOENT', 'ENOTDIR']);
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });

function writeFolder(folder, files)
{
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    for (const [file, text] of files)
    {
        const target = path.join(folder, `${file}${EXPECTED_FILE_SUFFIX}`);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, text);
    }
}

const variantFolderName = (folderName, named) => `${folderName}-${WITHOUT_WORD}-${named.map((number) => `E${number}`).join('-')}`;

// Every regular file under a folder, as a map from its '/' path without the .expected suffix to its text, with no .DS_Store; a folder that is not there holds none.
function readFolder(folder)
{
    try
    {
        const entries = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== IGNORED_FILE_NAME);
        return new Map(entries.map((entry) =>
        {
            const file = path.join(entry.parentPath, entry.name);
            const relative = path.relative(folder, file).split(path.sep).join('/');
            const proved = relative.endsWith(EXPECTED_FILE_SUFFIX) ? relative.slice(0, -EXPECTED_FILE_SUFFIX.length) : relative;
            return [proved, readFileSync(file, 'utf8')];
        }));
    }
    catch (error)
    {
        if (NOT_A_FOLDER_CODES.has(error.code)) return new Map();
        throw error;
    }
}

// Compares what the full replay and each variant prove with the folders and the Applies line on disk, and writes nothing. Returns the exit code.
function check(planText, planFolder, folderName, full, edits, variants, readBaseline, revision)
{
    const wanted = resultTexts(resultStates(full));
    const differences = compareFolder(folderName, wanted, readFolder(path.join(planFolder, folderName)));
    const applies = appliesDifference(planText, edits.length);
    if (applies !== null) differences.push(applies);
    const proved = [`Proved: ${edits.length} of ${edits.length} edits; ${folderName}/ holds the ${wanted.size} proved files`];
    for (const named of variants)
    {
        const variantName = variantFolderName(folderName, named);
        const variant = proveVariant(edits, named, readBaseline, revision, variantName);
        if (variant.failures.length > 0)
        {
            differences.push(...variant.failures);
            continue;
        }
        differences.push(...compareFolder(variantName, variant.files, readFolder(path.join(planFolder, variantName))));
        proved.push(`Proved: ${variantName}/ holds the ${variant.files.size} proved files`);
    }
    if (differences.length === 0)
    {
        for (const line of proved) console.log(line);
        return EXIT.applied;
    }
    for (const line of differences) console.error(line);
    return EXIT.failed;
}

function parseArguments(args)
{
    let planPath = null;
    let isCheck = false;
    const variants = [];
    for (let index = 0; index < args.length; index++)
    {
        const argument = args[index];
        if (argument === CHECK_OPTION) isCheck = true;
        else if (argument === WITHOUT_OPTION)
        {
            const value = args[++index];
            if (value === undefined || !WITHOUT_VALUE.test(value)) fail(`${WITHOUT_OPTION} takes edit numbers such as E2 or E2,E8`);
            variants.push([...new Set(value.split(',').map((name) => Number(name.slice(1))))]);
        }
        else if (argument.startsWith('-')) fail(`unknown option ${argument}`);
        else if (planPath !== null) fail(`more than one plan path: ${planPath} and ${argument}`);
        else planPath = argument;
    }
    if (planPath === null) fail(`no plan path - usage: node prove-plan.mjs [${CHECK_OPTION}] <plan> [${WITHOUT_OPTION} E<n>[,E<m>]]...`);
    return { planPath, variants, check: isCheck };
}

function repositoryRoot()
{
    const result = git(process.cwd(), ['rev-parse', '--show-toplevel']);
    if (result.status !== 0) fail('not inside a git repository');
    return result.stdout.trim();
}

function resolveRevision(root, revision)
{
    const result = revision.startsWith('-') ? { status: 1 } : git(root, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]);
    if (result.status !== 0) fail(`unknown revision '${revision}' after Baseline`);
    return result.stdout.trim();
}

function reportReplay(full, editCount)
{
    console.log(`Applies: ${full.applied} of ${editCount} edits`);
    for (const note of full.notes) console.log(note);
}

function prove(args)
{
    const { planPath, variants, check: isCheck } = parseArguments(args);
    const root = repositoryRoot();
    const planText = readFileSync(path.resolve(planPath), 'utf8');
    const { revision, edits } = parsePlan(planText);
    const commit = resolveRevision(root, revision);
    const unknown = variants.flat().find((number) => !edits.some((edit) => edit.number === number));
    if (unknown !== undefined) fail(`${WITHOUT_OPTION} names E${unknown}, which the plan does not hold`);
    const readBaseline = (file) =>
    {
        const result = git(root, ['cat-file', 'blob', `${commit}:${file}`]);
        return result.status === 0 ? result.stdout : null;
    };

    const full = replay(edits, readBaseline, revision);
    if (full.failures.length > 0)
    {
        reportReplay(full, edits.length);
        for (const line of full.failures) console.error(line);
        return EXIT.failed;
    }
    const planFolder = path.dirname(path.resolve(planPath));
    const folderName = expectedFolderName(planPath);
    if (isCheck) return check(planText, planFolder, folderName, full, edits, variants, readBaseline, revision);

    reportReplay(full, edits.length);
    const results = resultStates(full);
    writeFolder(path.join(planFolder, folderName), resultTexts(results));
    for (const [file, state] of results)
        console.log(`  ${file} (${state.baseline === null ? 'new,' : `${state.baseline.length} ->`} ${state.text.length} characters)`);

    let exitCode = EXIT.applied;
    for (const named of variants)
    {
        const variantName = variantFolderName(folderName, named);
        const variant = proveVariant(edits, named, readBaseline, revision, variantName);
        for (const line of variant.failures) console.error(line);
        if (variant.failures.length > 0) exitCode = EXIT.failed;
        else
        {
            writeFolder(path.join(planFolder, variantName), variant.files);
            console.log(variant.line);
        }
    }
    return exitCode;
}

try
{
    process.exitCode = prove(process.argv.slice(2));
}
catch (error)
{
    // A file the plan names that cannot be read or written (an error with a string code) is as unusable as a bad plan.
    if (!(error instanceof PlanError) && typeof error.code !== 'string') throw error;
    console.error(`prove-plan: ${error.message}`);
    process.exitCode = EXIT.usage;
}
