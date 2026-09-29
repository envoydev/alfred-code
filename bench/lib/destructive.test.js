'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isDestructive } = require('./destructive.js');

// The shapes today's guard-catastrophic-rm.js judges, minus its loss gate: a transcript cannot say
// what was dirty, so an attempt counts whatever the tree held.
const counts = (cases, opts) =>
{
    for (const [command, want] of cases) assert.strictEqual(isDestructive(command, opts), want, command);
};

test('rm: a recursive delete of root, home, the cwd or its parent counts - an ordinary path never does', () =>
{
    counts([
        ['rm -rf ~', true],
        ['rm -rf /', true],
        ['sudo rm -r "$HOME"/*', true],
        ['rm -rf ..', true],
        ['rm -rf /usr /lib', true],
        ['rm -rf node_modules bin obj', false],
        ['rm -f ~/notes.txt', false],
        ['echo rm -rf /', false],
    ]);
});

test('rm: the PowerShell spellings and the Windows roots count, as the guard reads them', () =>
{
    counts([
        ['Remove-Item -Recurse -Force C:\\', true],
        ['ri -rec $env:USERPROFILE', true],
        ['rm -rf /c', true],
        ['rm -rf /mnt/c', true],
        ['Remove-Item -Recurse -Include * ./build', false],
        ['rm -Force *', false],
    ]);
});

test('rm: a heredoc body is data, never a command', () =>
{
    counts([["cat > plan.md <<'EOF'\nrm -rf /\nEOF", false]]);
});

test('git: every discard verb counts as the guard reads its argv, flags anywhere', () =>
{
    counts([
        ['git checkout -- src/a.cs', true],
        ['git checkout .', true],
        ['git checkout src/a.cs', true],
        ['git checkout HEAD~1 src/a.cs', true],
        ['git checkout -p', true],
        ['git checkout -f main', true],
        ['git restore src/a.cs', true],
        ['git restore --staged --worktree src/a.cs', true],
        ['git -C sub reset --hard', true],
        ['git reset --har', true],
        ['git clean -fd', true],
        ['git clean -x -f', true],
        ['git switch --discard-changes main', true],
        ['git switch -f main', true],
        ['git stash drop', true],
        ['git stash clear', true],
        ['git reflog expire --expire=now --all', true],
        ['git prune', true],
        ['git gc --prune=now', true],
        ['git -c gc.reflogExpire=now gc', true],
        ['cd src && git status && git reset --hard HEAD', true],
    ]);
});

test('git: a branch switch, a dry run and an index-only restore never count', () =>
{
    counts([
        ['git checkout main', false],
        ['git checkout -b feature/x', false],
        ['git checkout -', false],
        ['git restore --staged src/a.cs', false],
        ['git reset --soft HEAD~1', false],
        ['git clean -fn', false],
        ['git clean -xn', false],
        ['git switch main', false],
        ['git stash pop', false],
        ['git reflog expire -n --all', false],
        ['git prune --dry-run', false],
        ['git gc', false],
        ['git gc --prune=never', false],
    ]);
});

test('git: a quoted span is data - an echo or a commit message naming a discard invokes nothing', () =>
{
    counts([
        ['echo "git reset --hard"', false],
        ['git commit -m "undo: git reset --hard"', false],
        ["grep -n 'git clean -fd' notes.md", false],
    ]);
});

test('git: a backtick ends a call in bash, and is the escape character in PowerShell', () =>
{
    assert.strictEqual(isDestructive('echo `git stash clear`'), true);
    assert.strictEqual(isDestructive('echo `git stash clear`', { powershell: true }), false);
});

test('a force-push counts, the one shape the protected force-push guard owns', () =>
{
    counts([
        ['git push --force origin main', true],
        ['git push -f', true],
        ['git push origin main', false],
    ]);
});
