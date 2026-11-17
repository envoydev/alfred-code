#!/usr/bin/env node
// Copied into each repo as .claude/kit/audit-scope.mjs by claude-kit's sync - edit it in claude-kit, never here.
//
// Keeps what an audit graded beside the hashes of the files it graded, in a machine-local state file, so the next
// audit reads only what changed. An item is a file, or a folder named by its first path segment below a root; its
// grade is carried while its files, the --with files and the scoring files (the audit skill's rubric and currency
// text) hold the hashes they had when it was graded, and while it is no more than --max-age days old (30 by default),
// so an audit reads an item against outside documentation again before a grade grows old.
//
//   node .claude/kit/audit-scope.mjs scope <kind> [--full] [--max-age <days>] [--with <path>]... <root>...    run in any folder of the repository
//   node .claude/kit/audit-scope.mjs record <kind> --run <run folder> --grades <file> [--under <scoring hash> <folder hash>] [--with <path>]... <root>...
//
// scope prints `audit <id> - <why>` for each item to read and `carried <id> - ...` for each that keeps its grade, and
// writes nothing. record reads the grades file (one `<id> TAB <letter> TAB <numeric> TAB yes|no` per line) and writes
// only docs/superpowers/audits/state/<kind>.json, through a temp file in that folder. Every path but --grades is
// from the repository root, whatever folder of the repository the command runs in; --grades is read relative to the
// working directory. Exits 0 when done, 2 when the command line or the state file cannot be used.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkedPath, filesUnder, hashMap, itemsOf, localDate, parseGrades, parseState, recordState, scopeLines, serializeState } from './audit-items.mjs';

const EXIT = Object.freeze({ done: 0, usage: 2 });
const COMMAND = Object.freeze({ scope: 'scope', record: 'record' });
const OPTION = Object.freeze({ full: '--full', with: '--with', run: '--run', grades: '--grades', under: '--under', maxAge: '--max-age' });
const COMMAND_OPTIONS = Object.freeze({
    [COMMAND.scope]: [OPTION.full, OPTION.with, OPTION.maxAge],
    [COMMAND.record]: [OPTION.run, OPTION.grades, OPTION.under, OPTION.with],
});
const KIND_PATTERN = /^[a-z][a-z-]*$/;
const HASH_PATTERN = /^[0-9a-f]{40}$/;
const DAYS_PATTERN = /^[1-9]\d*$/;
const DEFAULT_MAX_AGE_DAYS = 30;
const STATE_FOLDER = 'docs/superpowers/audits/state';
const AUDIT_SKILL_PREFIX = '.claude/skills/repo-audit-';
const SCORING_FILES = Object.freeze(['references/rubric.md', 'references/currency.md']);
const IGNORED_FILE_NAME = '.DS_Store';
const NOT_A_FOLDER_CODES = new Set(['ENOENT', 'ENOTDIR']);
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const HASH_BATCH_SIZE = 100;
const NO_COMMAND_USAGE = `usage: node audit-scope.mjs ${COMMAND.scope}|${COMMAND.record} <kind> [options] <root>...`;

class UsageError extends Error
{
}

function fail(message)
{
    throw new UsageError(message);
}

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });

function gitOutput(root, args)
{
    const result = git(root, args);
    if (result.status !== 0) fail(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
    return result.stdout;
}

function isRegularFile(file)
{
    try
    {
        return lstatSync(file).isFile();
    }
    catch
    {
        return false;
    }
}

const stateFilePath = (kind) => `${STATE_FOLDER}/${kind}.json`;

function requirePath(text, label)
{
    const checked = checkedPath(text);
    if (checked.problem !== undefined) fail(`${label} ${text} ${checked.problem}`);
    return checked.path;
}

// What one option takes: the next argument, or two for --under. An argument that is itself an option is no value.
function takeValues(args, index, count, option)
{
    const values = args.slice(index + 1, index + 1 + count);
    if (values.length < count || values.some((value) => value.startsWith('-'))) fail(`${option} needs ${count === 1 ? 'a value' : 'a scoring hash and a folder hash'}`);
    return values;
}

function parseArguments(args)
{
    const [command, kind, ...rest] = args;
    if (command === undefined || !Object.hasOwn(COMMAND_OPTIONS, command)) fail(`${command === undefined ? 'no command' : `unknown command ${command}`} - ${NO_COMMAND_USAGE}`);
    if (kind === undefined || kind.startsWith('-')) fail(`no kind - ${NO_COMMAND_USAGE}`);
    if (!KIND_PATTERN.test(kind)) fail(`kind ${kind} does not match ${KIND_PATTERN}`);
    const options = { command, kind, roots: new Set(), withPaths: new Set(), full: false, maxAgeDays: DEFAULT_MAX_AGE_DAYS, run: null, grades: null, under: null };
    for (let index = 0; index < rest.length; index++)
    {
        const argument = rest[index];
        if (!argument.startsWith('-')) options.roots.add(requirePath(argument, 'root'));
        else if (!COMMAND_OPTIONS[command].includes(argument)) fail(`unknown option ${argument}`);
        else if (argument === OPTION.full) options.full = true;
        else if (argument === OPTION.under)
        {
            options.under = takeValues(rest, index, 2, argument);
            index += 2;
            if (!options.under.every((hash) => HASH_PATTERN.test(hash))) fail(`${OPTION.under} takes two 40-character hashes`);
        }
        else
        {
            const [value] = takeValues(rest, index++, 1, argument);
            if (argument === OPTION.with) options.withPaths.add(requirePath(value, `${argument} path`));
            else if (argument === OPTION.maxAge)
            {
                if (!DAYS_PATTERN.test(value)) fail(`${argument} takes a whole number of days, 1 or more`);
                options.maxAgeDays = Number(value);
            }
            else if (argument === OPTION.run) options.run = requirePath(value, `${argument} folder`);
            else options.grades = value;
        }
    }
    if (options.roots.size === 0) fail(`no root - ${NO_COMMAND_USAGE}`);
    if (command === COMMAND.record && (options.run === null || options.grades === null)) fail(`${COMMAND.record} needs ${OPTION.run} and ${OPTION.grades}`);
    return options;
}

function repositoryRoot()
{
    const result = git(process.cwd(), ['rev-parse', '--show-toplevel']);
    if (result.status !== 0) fail('not inside a git repository');
    return result.stdout.trim();
}

// The tracked files that are regular files in the working tree: a file deleted and not committed is not one.
function presentFiles(root)
{
    const listed = (flags) => gitOutput(root, ['ls-files', '-z', ...flags]).split('\0').filter((file) => file !== '');
    const deleted = new Set(listed(['--deleted']));
    return [...new Set(listed([]))].filter((file) => !deleted.has(file) && isRegularFile(path.join(root, file))).sort();
}

// The hash of each file's working-tree text, with the paths passed as arguments in batches.
function hashFiles(root, files)
{
    const hashes = new Map();
    for (let start = 0; start < files.length; start += HASH_BATCH_SIZE)
    {
        const batch = files.slice(start, start + HASH_BATCH_SIZE);
        const printed = gitOutput(root, ['hash-object', '--', ...batch]).split('\n');
        batch.forEach((file, index) => hashes.set(file, printed[index]));
    }
    return hashes;
}

function listingHash(files, hashes)
{
    const text = [...files].sort().map((file) => `${file} ${hashes.get(file)}\n`).join('');
    return createHash('sha1').update(text).digest('hex');
}

function regularFilesUnder(root, folder)
{
    try
    {
        const entries = readdirSync(path.join(root, folder), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== IGNORED_FILE_NAME);
        return entries.map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    }
    catch (error)
    {
        if (NOT_A_FOLDER_CODES.has(error.code)) return [];
        throw error;
    }
}

// The scoring hash (the rubric and the currency text) and the folder hash (the whole audit skill, tracked or not).
function auditSkillHashes(root, kind)
{
    const skill = `${AUDIT_SKILL_PREFIX}${kind}`;
    const scoring = SCORING_FILES.map((file) => `${skill}/${file}`).filter((file) => isRegularFile(path.join(root, file)));
    const folder = regularFilesUnder(root, skill);
    const hashes = hashFiles(root, [...new Set([...scoring, ...folder])]);
    return { scoring: listingHash(scoring, hashes), folder: listingHash(folder, hashes) };
}

function readState(root, kind)
{
    const relative = stateFilePath(kind);
    let text;
    try
    {
        text = readFileSync(path.join(root, relative), 'utf8');
    }
    catch (error)
    {
        if (error.code === 'ENOENT') return null;
        return fail(`cannot read the state file ${relative}: ${error.code ?? error.message}`);
    }
    const parsed = parseState(text, kind);
    if (parsed.problem !== undefined) fail(`cannot read the state file ${relative}: ${parsed.problem}`);
    return parsed.state;
}

// The state goes to a temp name in its own folder and is renamed over the state file, so a reader never sees half of it.
function writeState(root, kind, state)
{
    const target = path.join(root, stateFilePath(kind));
    const temp = `${target}.${process.pid}.tmp`;
    mkdirSync(path.dirname(target), { recursive: true });
    try
    {
        writeFileSync(temp, serializeState(kind, state));
        renameSync(temp, target);
    }
    catch (error)
    {
        rmSync(temp, { force: true });
        throw error;
    }
}

// Everything the two commands read: the roots checked, the present files, the --with files and the state file.
function load(options, root)
{
    for (const rootPath of options.roots)
        if (!existsSync(path.join(root, rootPath))) fail(`root ${rootPath} is not a file or folder in the working tree`);
    const present = presentFiles(root);
    const withFiles = [...options.withPaths].flatMap((withPath) =>
    {
        const files = filesUnder(present, withPath);
        if (files.length === 0) fail(`${OPTION.with} ${withPath} holds no tracked file`);
        return files;
    });
    return { present, withFiles: [...new Set(withFiles)], state: readState(root, options.kind) };
}

function scope(options, root)
{
    const { present, withFiles, state } = load(options, root);
    const { items, gone } = itemsOf(options.roots, options.withPaths, present, state === null ? [] : [...state.items.keys()]);
    const { scoring, folder } = auditSkillHashes(root, options.kind);
    const hashes = hashFiles(root, [...new Set([...items.flatMap((item) => item.files), ...withFiles])]);
    const hashed = items.map((item) => ({ id: item.id, hashes: hashMap(item.files, hashes) }));
    return scopeLines({ items: hashed, gone, state, full: options.full, withHashes: hashMap(withFiles, hashes), scoring, folder, today: localDate(new Date()), maxAgeDays: options.maxAgeDays });
}

function record(options, root)
{
    let text;
    try
    {
        text = readFileSync(path.resolve(options.grades), 'utf8');
    }
    catch (error)
    {
        fail(`cannot read the grades file ${options.grades}: ${error.code ?? error.message}`);
    }
    const parsed = parseGrades(text);
    if (parsed.problem !== undefined) fail(`${options.grades} ${parsed.problem}`);
    const { present, withFiles, state: previous } = load(options, root);
    const { scoring, folder } = options.under === null ? auditSkillHashes(root, options.kind) : { scoring: options.under[0], folder: options.under[1] };
    const ids = [...parsed.grades.map((grade) => grade.id), ...(previous?.items.keys() ?? [])];
    const hashes = hashFiles(root, [...new Set([...ids.flatMap((id) => filesUnder(present, id)), ...withFiles])]);
    const result = recordState({
        previous,
        grades: parsed.grades,
        filesOf: (id) => hashMap(filesUnder(present, id), hashes),
        withHashes: hashMap(withFiles, hashes),
        today: localDate(new Date()),
        run: options.run,
        scoring,
        folder,
    });
    writeState(root, options.kind, result.state);
    const { graded, kept, dropped, skipped } = result.counts;
    return [
        ...result.skipped.map((id) => `skipped ${id} - no tracked file`),
        `Recorded: ${graded} graded, ${kept} kept, ${dropped} dropped, ${skipped} skipped - ${stateFilePath(options.kind)}`,
    ];
}

function main(args)
{
    const options = parseArguments(args);
    const root = repositoryRoot();
    const lines = options.command === COMMAND.scope ? scope(options, root) : record(options, root);
    process.stdout.write(`${lines.join('\n')}\n`);
    return EXIT.done;
}

try
{
    process.exitCode = main(process.argv.slice(2));
}
catch (error)
{
    // A failed read, write, rename or mkdir (an error naming its syscall) is as unusable as a bad command line; any other error is a fault here.
    if (!(error instanceof UsageError) && typeof error.syscall !== 'string') throw error;
    console.error(`audit-scope: ${error.message}`);
    process.exitCode = EXIT.usage;
}
