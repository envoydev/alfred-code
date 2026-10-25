// habits-create-ticket writes each ticket to a file as well as the chat block (item 5, 2026-10-25): the body names the
// path, the slug rule, the header lines and the order - after the output scorer released it, before the chat block -
// with the `Saved:` line outside the fenced block, so the 'Nothing session-local' rule holds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const BODY = fs.readFileSync(path.join(__dirname, '..', 'stack', 'skills', 'habits-create-ticket', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');

test('create-ticket: each ticket is also a file under the docs root, written after the scorer released it (item 5)', () => {
  assert.match(BODY, /`<docs root>\/tickets\/<slug>\.md`/);
  assert.match(BODY, /`<type>-<area>-<short>`/);
  assert.match(BODY, /at most 60 characters/);
  assert.match(BODY, /`-2`/);
  for (const h of ['Type:', 'Created:', 'Status: draft', 'Status: filed']) assert.ok(BODY.includes(h), h);
  assert.match(BODY, /`Saved: <path>` below the block/);
  assert.match(BODY, /A withheld ticket writes no file/);
  assert.match(BODY, /The file is written once the output scorer released the ticket, before the chat block/);
});
