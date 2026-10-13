// Behavior tests for dev-log-convert's self-check script. The skill tells the model to take the
// script's total over its own sum on a mismatch, so a script that counts a duration from the summary
// text ('Increased the cache TTL to 30m') turns a correct hand sum into a wrong printed total.
// The time of a task line is the bracketed token after the ticket id - nothing else on the line.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'dev-log-convert', 'scripts', 'total-time.js');

function run(lines)
{
    const r = spawnSync(process.execPath, [SCRIPT], { input: lines.join('\n') + '\n', encoding: 'utf8' });
    const total = /^Total time: (.*?)\s{2}\((\d+)m/m.exec(r.stdout);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, total: total && total[1], minutes: total && Number(total[2]) };
}

test('a duration in the summary text is not the task time', () =>
{
    const r = run([
        '1 ABC-5 (1h) - Increased the cache TTL to 30m.',
        '2 ABC-6 (2h) - Cut the nightly job from 3h to 20m.',
    ]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.total, '3h', r.stdout);
    assert.strictEqual(r.minutes, 180);
});

test('the bracketed token normalizes every accepted spelling', () =>
{
    const r = run([
        '1 ABC-1 (1h 30m) - Fixed the login redirect.',
        '2 ABC-2 (0.25h) - Reviewed the PR.',
        '3 ABC-3 (1,5 год) - Paired on the report.',
        '4 Other (45хв) - Standup.',
    ]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.minutes, 90 + 15 + 90 + 45, r.stdout);
});

test('a line with no bracketed time counts as zero, even when its summary names one', () =>
{
    const r = run([
        '1 ABC-7 (time not specified) - Moved the retry window to 15m.',
        '2 ABC-8 (2h) - Shipped the export.',
    ]);
    assert.match(r.stdout, /1 without time/);
    assert.strictEqual(r.minutes, 120, r.stdout);
});

test('a bracket that sits in the summary is not the time', () =>
{
    const r = run([
        '1 ABC-9 (1h) - Split the job (was 4h) into two.',
        '2 ABC-10 - Renamed the queue (the old 2h timeout stays).',
    ]);
    assert.strictEqual(r.minutes, 60, r.stdout);
    assert.match(r.stdout, /1 without time/);
});

test('several ticket ids before the bracket still read the bracket', () =>
{
    const r = run(['1 ABC-11, ABC-12 (2h 15m) - Merged the two fixes behind one flag set to 10m.']);
    assert.strictEqual(r.minutes, 135, r.stdout);
});

// Audit 2026-10-11, session 5f9fec85: a compact `(1h15m)` read as 15m (the unit's lookahead refused a digit,
// so the `h` before `15m` never matched), and the shipped day printed 6h 30m where its lines sum to 7h 30m.
// Every spelling the skill accepts, with and without the space, with a decimal point and a decimal comma.
test('every accepted unit spelling reads in full, compact or spaced', () =>
{
    const cases = [
        ['1h 15m', 75], ['1h15m', 75], ['2h30m', 150], ['1H15M', 75], ['90m', 90], ['15 m', 15], ['2 h', 120],
        ['1.5h', 90], ['1,5h', 90], ['1,5 h', 90], ['0.25h', 15], ['1.25h 15m', 90],
        ['1г 15хв', 75], ['1г15хв', 75], ['1 г 15 хв', 75], ['1год15хв', 75], ['1 год 15 хв', 75],
        ['1,5 год', 90], ['1.5г', 90], ['2гг', 120], ['2 гг 10 хв', 130], ['45хв', 45], ['10 хвил', 10], ['1г10хвил', 70],
    ];
    for (const [time, minutes] of cases)
    {
        const r = run([`1 ABC-1 (${time}) - Fixed the export.`]);
        assert.strictEqual(r.status, 0, `${time}: ${r.stderr}`);
        assert.strictEqual(r.minutes, minutes, `${time}: ${r.stdout}`);
    }
});

test('the 5f9fec85 day sums to its lines, not to a misparse', () =>
{
    const r = run(['1 ABC-1 (3h) - a.', '2 ABC-1 (2h) - b.', '3 ABC-1 (1h) - c.', '4 ABC-1 (1h15m) - d.', '5 ABC-1 (15m) - e.']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.total, '7h 30m', r.stdout);
});

test('a time token the script cannot read in full exits 2, names the line and prints no total', () =>
{
    for (const time of ['30 min', '2-3h', '1h15', '1.5 hours'])
    {
        const r = run(['1 ABC-1 (2h) - a.', `2 ABC-2 (${time}) - b.`]);
        assert.strictEqual(r.status, 2, `${time}: ${r.stdout}`);
        assert.strictEqual(r.total, null, `${time}: a total printed beside an unreadable token - ${r.stdout}`);
        assert.match(r.stdout, /UNREADABLE/, time);
        assert.match(r.stderr, /line 2/, time);
    }
});

test('a token with no digit is still time not specified, never unreadable', () =>
{
    const r = run(['1 ABC-1 (time not specified) - a.', '2 ABC-2 (TBD) - b.', '3 ABC-3 (2h) - c.']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.minutes, 120, r.stdout);
    assert.match(r.stdout, /2 without time/);
});

test('the skill body routes an UNREADABLE run and pastes the last run\'s total', () =>
{
    const body = require('node:fs').readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'dev-log-convert', 'SKILL.md'), 'utf8');
    assert.match(body, /Exit 2 with `UNREADABLE`/);
    assert.match(body, /copied from the `Total time:` line of that last run/);
    assert.doesNotMatch(body, /On a mismatch, take the script's total/, 'the carried-figure route is gone');
});

test('no input exits 1 with the usage line', () =>
{
    const r = run([]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /no input/);
});
