'use strict';
// The full-spec check the single-chat solve flow runs before it merges design and plan audit into one step.
// Pilot 3 (b4-pilot-3-flow): the gate changed the plan in 1 of 4 feature cells, and the steps before the build cost
// $0.95-1.65 a cell. A full spec names the surface, the observable behaviour and how it is verified; a request that
// misses one, spans more than one stack or touches an auth / secret / payment path keeps every gate. The fixtures are
// written in the shape of the bench prompts, never copied from them.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'stack', 'skills', 'alfred-task-solve', 'scripts', 'spec-check.js');
const { classify } = require(SCRIPT);
const run = (text, args = []) => spawnSync(process.execPath, [SCRIPT, ...args], { input: text, encoding: 'utf8' });

const FULL_API = [
  'Staff cannot see which reminders a member was sent. Please add `GET /api/members/{memberId}/notices`, listing the notices sent about that member\'s loans.',
  '',
  '- Each entry has `id`, `loanId`, `kind` and `sentAt`.',
  '- Newest first: ordered by `sentAt` descending, then `id` descending.',
  '- An unknown `kind` value is rejected with the same 400 the loan list gives.',
  '- An unknown member id gets the same 404 as `GET /api/members/{memberId}/loans`.',
].join('\n');

const FULL_DATA = [
  'The export walks every loan page by page and it is slow. Add a cursor-paged `GET /api/loans/feed`.',
  'Leave `GET /api/loans` as it is - the web app pages through it.',
  '- The same optional `status` filter, with the same validation.',
  '- `limit` is 1 to 100, default 20; an out-of-range limit is a 400.',
  '- The response is `{ "items": [...], "nextCursor": "..." }`; `nextCursor` is null after the last page.',
  'Add an index named `IX_Loans_DueDate_Id` on `Loans` in a new migration.',
].join('\n');

const FULL_FILE_BUG = 'In src/Orders/Refund.cs, `Refund.Apply` rounds the amount down; it must round half-even. Add a failing test in RefundTests first, then fix it.';

const VAGUE = 'Can you make the notices better? Members keep saying they are confusing.';
const NO_VERIFY = 'Add `GET /api/items/{id}/history` that returns the item\'s past loans.';

const MULTI_STACK = [
  'Change `GET /api/reports/overdue` so each row carries the item and the member as objects, and make the report page in the web app use them.',
  '- The API keeps its access rule and row order; `itemName` is gone from the response.',
  '- The Item column in the Angular component shows the name followed by the SKU in brackets.',
  '- The member name links to their page; the empty state still reads the same.',
].join('\n');

const AUTH_CHANGE = [
  'Members need to borrow for themselves. Today only staff can create a loan with `POST /api/loans`. Please change who may do it:',
  '- A member-role caller may create a loan only for themselves; any other `memberId` gets 403 and nothing is saved.',
  '- Staff and admins are unchanged and still get 201 with the loan.',
].join('\n');

const SECRET = [
  'Move the payment provider key out of appsettings.json into user secrets in `src/Api/Program.cs`.',
  '- The app still starts and `GET /health` returns 200.',
  '- Add a test that fails when the key is missing.',
].join('\n');

test('a full single-stack spec takes the merged path, naming what satisfied each item', () => {
  for (const [name, text] of [['api', FULL_API], ['data', FULL_DATA], ['file bug', FULL_FILE_BUG]]) {
    const r = classify(text);
    assert.strictEqual(r.full, true, `${name}: ${JSON.stringify(r)}`);
    assert.strictEqual(r.path, 'merged', name);
    assert.ok(r.surface && r.behaviour && r.verified, `${name}: every item has its evidence`);
    assert.strictEqual(r.stacks.length <= 1, true, `${name}: ${r.stacks}`);
    assert.strictEqual(r.security, '', name);
  }
});

test('a vague request keeps every gate - it names no surface', () => {
  const r = classify(VAGUE);
  assert.strictEqual(r.full, false);
  assert.strictEqual(r.path, 'gated');
  assert.match(r.reason, /surface/);
});

test('a request that says nothing about how it is verified keeps every gate', () => {
  const r = classify(NO_VERIFY);
  assert.strictEqual(r.path, 'gated');
  assert.match(r.reason, /verified/);
});

test('a full spec that spans two stacks keeps every gate', () => {
  const r = classify(MULTI_STACK);
  assert.strictEqual(r.path, 'gated');
  assert.deepStrictEqual([...r.stacks].sort(), ['backend', 'web']);
  assert.match(r.reason, /stacks/);
});

test('a full spec on an auth, secret or payment path keeps every gate', () => {
  for (const [name, text] of [['auth change', AUTH_CHANGE], ['secret', SECRET]]) {
    const r = classify(text);
    assert.strictEqual(r.path, 'gated', name);
    assert.notStrictEqual(r.security, '', name);
    assert.match(r.reason, /security/, name);
  }
});

// Review C1: ordinary visibility wording merged an access-control change. Any access, visibility, ownership, credential,
// payment or personal-data signal gates - a reused rule included, since the merged path skips the stops that would
// catch a rule applied wrong.
const WISHLIST = [
  'Members should now be able to view each other\'s public wishlists. Add `GET /api/wishlists/{userId}`.',
  '- It returns the wishlist\'s `items`, newest first.',
  '- A private wishlist returns an empty items array instead of the real contents.',
  '- An unknown user id gets 404.',
].join('\n');
test('C1: a visibility, ownership or access change gates, however it is worded', () => {
  const variants = {
    wishlist: WISHLIST,
    reused: FULL_DATA.replace('- The same optional', '- Same access rule as `GET /api/loans`, and the same optional'),
    staffOnly: `${FULL_API}\n- Staff and admins only: a member-role caller gets the same 403 the overdue report gives them.`,
    owner: 'Add `PATCH /api/lists/{id}` so the owner can rename a list.\n- It returns 200 with the list.\n- Anyone else gets 404.',
    tenant: 'Add `GET /api/invoices` scoped to the caller\'s tenant.\n- It lists the tenant\'s invoices.\n- An empty tenant returns an empty array.',
    share: 'Add `POST /api/lists/{id}/share` so a list can be shared with another member.\n- It returns 201.\n- Sharing twice returns 409.',
    pii: 'Add `GET /api/members/export` with each member\'s PII columns.\n- It returns CSV.\n- An empty table returns the header only.',
    bearer: 'Add a refresh token to `POST /api/session`.\n- It returns 200 with the new token.\n- An expired one gets 401.',
  };
  for (const [name, text] of Object.entries(variants)) {
    const r = classify(text);
    assert.strictEqual(r.path, 'gated', `${name}: ${JSON.stringify(r)}`);
    assert.notStrictEqual(r.security, '', name);
  }
  const ct = classify('In src/Orders/Sync.cs, `Sync.Run` must stop when its CancellationToken fires.\n- It returns within 1 s.\n- A test cancels it mid-run.');
  assert.strictEqual(ct.security, '', 'a CancellationToken is no credential');
});

// Review C2: a backend endpoint plus the Angular service that calls it merged as one stack.
test('C2: an Angular .ts file, a component or a web page beside a backend change is two stacks', () => {
  const variants = {
    service: 'Add `GET /api/orders/{id}/timeline` returning the order\'s events, and update `src/app/order-detail.service.ts` to call it.\n- It returns the events oldest first.\n- An unknown id gets 404.',
    component: 'Add `GET /api/orders/{id}/timeline` returning the order\'s events, and show them in `order-detail.component.ts`.\n- It returns the events oldest first.\n- An unknown id gets 404.',
    webDir: 'Add `GET /api/orders/{id}/timeline` returning the events; `web/src/orders/detail.ts` renders them.\n- It returns the events oldest first.\n- An unknown id gets 404.',
    page: 'Add `GET /api/orders/{id}/timeline` returning the events, and list them on the order detail page.\n- It returns the events oldest first.\n- An unknown id gets 404.',
    store: 'Add `GET /api/orders/{id}/timeline`, and load it into the orders store.\n- It returns the events oldest first.\n- An unknown id gets 404.',
  };
  for (const [name, text] of Object.entries(variants)) {
    const r = classify(text);
    assert.deepStrictEqual([...r.stacks].sort(), ['backend', 'web'], `${name}: ${r.stacks}`);
    assert.strictEqual(r.path, 'gated', name);
  }
  assert.deepStrictEqual(classify(FULL_DATA).stacks, ['backend'], 'paging words are no web page');
});

test('the CLI prints one line per item and the path last, from stdin or a file', () => {
  const r = run(FULL_API);
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.deepStrictEqual(lines.map((l) => l.split(':')[0]), ['surface', 'behaviour', 'verified', 'stacks', 'security', 'spec', 'path']);
  assert.match(r.stdout, /^path: merged$/m);
  const g = run(VAGUE);
  assert.match(g.stdout, /^spec: not full - no surface named/m);
  assert.match(g.stdout, /^path: gated$/m);
  const empty = run('');
  assert.strictEqual(empty.status, 0);
  assert.match(empty.stdout, /^path: gated$/m, 'no request text is never a full spec');
  const missing = run('', [path.join(__dirname, 'no-such-request.txt')]);
  assert.notStrictEqual(missing.status, 0, 'an unreadable file is an error, never an empty request read as a verdict');
});
