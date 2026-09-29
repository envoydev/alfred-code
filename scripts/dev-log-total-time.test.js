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

test('no input exits 1 with the usage line', () =>
{
    const r = run([]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /no input/);
});
