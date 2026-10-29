#!/usr/bin/env node
'use strict';
// The stack's variables from the command line (workspace roles and variables, D5): the walks set values through this
// in place of a hand merge into settings, and show what each key reads as.
//
//   node scripts/variables.js set --root <dir> [--scope project|user|local] KEY=value ...   (KEY= removes the key)
//   node scripts/variables.js show --root <dir>
//   node scripts/variables.js recommend --root <dir> [--scope project|user|local] [--child]   (the docs-versioning answer)
//
// set exits 1 when a pair is refused (the key is named, never the value), 2 on a bad call.
const path = require('node:path');
const layout = require('../stack/hooks/layout.js');
const variables = require('./install/variables.js');

const USAGE = [
    'usage: node scripts/variables.js set --root <dir> [--scope project|user|local] KEY=value ...',
    '       node scripts/variables.js show --root <dir>',
    '       node scripts/variables.js recommend --root <dir> [--scope project|user|local] [--child]',
].join('\n');
const SCOPES = ['project', 'user', 'local'];

function parse(argv)
{
    const [cmd, ...rest] = argv;
    if (!['set', 'show', 'recommend'].includes(cmd)) return null;
    const out = { cmd, root: process.cwd(), scope: '', pairs: [], child: false };
    for (let i = 0; i < rest.length; i++)
    {
        const word = rest[i];
        if (word === '--root' || word === '--scope')
        {
            const value = rest[++i];
            if (value === undefined || value.startsWith('--')) return null;
            if (word === '--root') out.root = path.resolve(value);
            else if (SCOPES.includes(value)) out.scope = value;
            else return null;
        }
        else if (cmd === 'set' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) out.pairs.push(word);
        else if (cmd === 'recommend' && word === '--child') out.child = true;
        else return null;
    }
    return cmd === 'set' && !out.pairs.length ? null : out;
}

// `env` is the launch env: the prelude the entry loads for its blocking stdio also applies the stack's variables to
// process.env, which would make show name every inherited value `env`.
function main(env = process.env)
{
    const args = parse(process.argv.slice(2));
    if (!args)
    {
        console.error(USAGE);
        return 2;
    }
    if (args.cmd === 'recommend')
    {
        const scope = args.scope || 'project';
        const docsPath = require('./install/copy.js').resolveDocsRoot(args.root, scope);
        const advice = require('./install/docs.js').docsVersioningAdvice({ projectRoot: args.root, docsPath, scope, child: args.child });
        console.log(`docs-versioning: recommend ${advice.value} - ${advice.reason}`);
        return 0;
    }
    if (args.cmd === 'show')
    {
        for (const row of variables.show(args.root, { env })) console.log(`${row.key}=${row.value} (${row.source})`);
        for (const note of layout.variablesOf(args.root, { env }).notes) console.log(note);
        return 0;
    }
    const got = variables.set(args.root, args.pairs, { scope: args.scope || undefined, env });
    return got.refused.length ? 1 : 0;
}

if (require.main === module)
{
    const launch = { ...process.env };
    // A pipe's write is async on POSIX: blocking first, so process.exit never cuts the output short.
    require('../stack/hooks/hook-prelude.js').blockingStdio();
    process.exit(main(launch));
}

module.exports = { parse, main };
