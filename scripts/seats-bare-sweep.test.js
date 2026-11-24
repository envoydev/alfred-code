'use strict';
// A seat is a library copy linked as `.claude/agents/<name>` since the seats left the core plugin, so its dispatch
// name is bare: `alfred-code:<seat>` is no dispatch target. Readers keep accepting the prefix (old transcripts carry
// it); no shipped text WRITES it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SWEPT_DIRS = ['stack', 'setup-plugin'];
const SKIPPED_FOLDERS = new Set(['node_modules', '.git']);
const TEXT_EXTENSIONS = new Set(['.md', '.js', '.json', '.txt', '.yml', '.yaml', '.html', '.ps1', '.sh']);
// Each exemption names why: a record of past spellings, or a reader that must accept the prefix. A reader matches
// the prefix with a pattern and names no seat, so none is listed today; add one here with its reason, never a folder.
const EXEMPT = new Map([
    ['setup-plugin/references/update-history.md', 'records the spellings past releases used'],
]);

const shippedSeats = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', 'stack-manifest.json'), 'utf8'))
    .agents.map((row) => row.file.replace(/\.md$/, ''));

function* filesUnder(dir)
{
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    {
        if (SKIPPED_FOLDERS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* filesUnder(full);
        else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) yield full;
    }
}

test('no shipped body spells alfred-code:<seat>', () =>
{
    const seats = shippedSeats();
    assert.ok(seats.length > 40, 'the manifest lists the shipped seats');
    const spelled = new RegExp(`alfred-code:(?:${seats.join('|')})(?![\\w-])`);
    const hits = [];
    for (const dir of SWEPT_DIRS)
        for (const file of filesUnder(path.join(ROOT, dir)))
        {
            const rel = path.relative(ROOT, file).split(path.sep).join('/');
            if (EXEMPT.has(rel)) continue;
            fs.readFileSync(file, 'utf8').split('\n').forEach((line, n) =>
            {
                if (spelled.test(line)) hits.push(`${rel}:${n + 1}`);
            });
        }
    assert.deepStrictEqual(hits, [], 'a seat is named bare - the plugin carries none');
});
