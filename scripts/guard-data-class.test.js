#!/usr/bin/env node
// Suite for the pure judges of stack/hooks/guard-data-class.js. Runs with `npm test` (node --test).
'use strict';
const test = require('node:test');
require('./hook-test-env').isolateHookSuite();
const assert = require('node:assert/strict');
const path = require('node:path');

const judges = require(path.join('..', 'stack', 'hooks', 'guard-data-class.js'));
const {
  piiCounts, parseSensitivePaths, globMatch, pathState, dumpVerdict, documentVerdict, serverOf, judgedTexts,
  tokensOf, pathCandidates, nameCandidates, trackedArgv, pathsArgv, namesArgv, pathsFound, namesFound,
  egressFindings, codeLines, rewriteBrief, askText, denyText, PUBLIC_NAMES,
} = judges;

const emails = (count, domain) => Array.from({ length: count }, (_, i) => 'user' + i + '@' + domain);
const lines = (values) => values.join('\n');

function luhnComplete(prefix) {
  for (let check = 0; check < 10; check++) {
    const digits = prefix + check;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return digits;
  }
  throw new Error('no check digit');
}

function ibanOf(country, bban, shiftCheck = 0) {
  const toDigits = (s) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const rearranged = toDigits(bban + country + '00');
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, '0');
  const shifted = String((Number(check) + shiftCheck) % 100).padStart(2, '0');
  return country + shifted + bban;
}

const BBAN = 'WEST' + '12345698765432';

test('piiCounts counts 20 distinct emails on a real-looking domain', () => {
  const c = piiCounts(lines(emails(20, 'acme-mail.io')));
  assert.equal(c.emails, 20);
  assert.equal(c.total, 20);
});

test('piiCounts skips emails on reserved domains', () => {
  for (const domain of ['example.com', 'x.test', 'y.invalid', 'localhost', 'mail.example.org', 'host.example']) {
    assert.equal(piiCounts(lines(emails(20, domain))).total, 0, domain);
  }
});

test('piiCounts counts a Luhn-valid card and not a Luhn-invalid one', () => {
  const valid = luhnComplete('411111111111111');
  const invalid = valid.slice(0, -1) + String((Number(valid.slice(-1)) + 1) % 10);
  assert.equal(piiCounts('card ' + valid + ' ok').cards, 1);
  assert.equal(piiCounts('card ' + invalid + ' ok').cards, 0);
  const spaced = valid.replace(/(\d{4})(?=\d)/g, '$1 ');
  assert.equal(piiCounts(spaced).cards, 1);
});

test('piiCounts counts a mod-97 IBAN and not one with a wrong check digit', () => {
  assert.equal(piiCounts('iban ' + ibanOf('GB', BBAN) + ' end').ibans, 1);
  assert.equal(piiCounts('iban ' + ibanOf('GB', BBAN, 1) + ' end').ibans, 0);
  const grouped = ibanOf('GB', BBAN).replace(/(.{4})/g, '$1 ').trim();
  assert.equal(piiCounts('iban ' + grouped + ' end').ibans, 1);
});

test('piiCounts counts an E.164 phone and not a national number', () => {
  assert.equal(piiCounts('call +' + '380501234567').phones, 1);
  assert.equal(piiCounts('call 0501234567').phones, 0);
});

test('piiCounts counts a repeated value once', () => {
  const same = lines(Array(30).fill('user0@' + 'acme-mail.io'));
  assert.equal(piiCounts(same).emails, 1);
});

test('binary bytes do not throw', () => {
  const buf = Buffer.concat([Buffer.from([0, 0, 255, 254, 0x80, 0xc3]), Buffer.from('a@b.cc'), Buffer.alloc(50)]);
  assert.equal(typeof piiCounts(buf.toString('utf8')).total, 'number');
});

test('dumpVerdict: a big untracked data file is a dump by size', () => {
  const base = { base: 'orders.csv', ext: '.csv', tracked: false, head: null };
  assert.deepEqual(dumpVerdict({ ...base, bytes: 102401 }), { branch: 'dump-size', why: '100 KB .csv' });
  assert.equal(dumpVerdict({ ...base, bytes: 102400 }), null);
  assert.equal(dumpVerdict({ ...base, bytes: 500000, tracked: true }), null);
});

test('dumpVerdict: a name with a prod word is a dump by name', () => {
  assert.deepEqual(
    dumpVerdict({ base: 'orders_prod.sql', ext: '.sql', bytes: 10, tracked: false, head: null }),
    { branch: 'dump-name', why: "name says 'prod'" },
  );
  assert.equal(dumpVerdict({ base: 'production-backup.dump', ext: '.dump', bytes: 10, tracked: true, head: null }).branch, 'dump-name');
  assert.equal(dumpVerdict({ base: 'product.csv', ext: '.csv', bytes: 10, tracked: false, head: null }), null);
});

test('dumpVerdict: 20 personal-data values in the head make a dump, 19 do not', () => {
  const base = { base: 'notes.txt', ext: '.txt', bytes: 1000, tracked: false };
  assert.deepEqual(
    dumpVerdict({ ...base, head: lines(emails(20, 'acme-mail.io')) }),
    { branch: 'dump-pii', why: '20 personal-data values: 20 emails' },
  );
  assert.equal(dumpVerdict({ ...base, head: lines(emails(19, 'acme-mail.io')) }), null);
});

test('dumpVerdict: images and pdfs are never a dump', () => {
  assert.equal(dumpVerdict({ base: 'prod.png', ext: '.png', bytes: 9e6, tracked: false, head: null }), null);
  assert.equal(dumpVerdict({ base: 'prod.pdf', ext: '.pdf', bytes: 9e6, tracked: false, head: null }), null);
});

test('documentVerdict: an untracked pdf asks, a tracked one passes', () => {
  assert.deepEqual(documentVerdict({ ext: '.pdf', tracked: false, listed: false }), { branch: 'document-untracked', kind: 'an untracked .pdf' });
  assert.equal(documentVerdict({ ext: '.pdf', tracked: true, listed: false }), null);
});

test('documentVerdict: a listed path asks even when tracked or not a document type', () => {
  const kind = 'listed in .alfred/.sensitive-paths';
  assert.deepEqual(documentVerdict({ ext: '.docx', tracked: true, listed: true }), { branch: 'document-listed', kind });
  assert.deepEqual(documentVerdict({ ext: '.md', tracked: true, listed: true }), { branch: 'document-listed', kind });
});

test('parseSensitivePaths ignores comments and blanks and splits cleared lines', () => {
  const lists = parseSensitivePaths('# note\n\nclients/**\n!clients/ok/**\r\n  \n!  \n');
  assert.deepEqual(lists, { listed: ['clients/**'], cleared: ['clients/ok/**'] });
  assert.deepEqual(parseSensitivePaths(null), { listed: [], cleared: [] });
});

test('pathState: a cleared line wins over a listed one', () => {
  const lists = parseSensitivePaths('clients/**\n!clients/**');
  assert.equal(pathState('clients/a/b.pdf', lists), 'cleared');
  assert.equal(pathState('clients/a/b.pdf', parseSensitivePaths('clients/**')), 'listed');
  assert.equal(pathState('other/b.pdf', parseSensitivePaths('clients/**')), null);
});

test('pathState: a path outside the project and a glob reaching outside give nothing', () => {
  const lists = parseSensitivePaths('../x/*\n/abs/*\n**');
  assert.equal(pathState(null, lists), null);
  assert.equal(pathState('../x/a.pdf', parseSensitivePaths('../x/*')), null);
  assert.equal(pathState('/abs/a.pdf', parseSensitivePaths('/abs/*')), null);
  assert.equal(pathState('a.pdf', parseSensitivePaths('../x/*\n/abs/*')), null);
});

test('windows path matches a slash glob', () => {
  const normalized = 'clients\\a.pdf'.replace(/\\/g, '/');
  assert.equal(pathState(normalized, parseSensitivePaths('Clients/*.PDF')), 'listed');
});

test('globMatch: star stays in a folder, double star crosses, question matches one char', () => {
  assert.equal(globMatch('a/*.pdf', 'a/b.pdf'), true);
  assert.equal(globMatch('a/*.pdf', 'a/b/c.pdf'), false);
  assert.equal(globMatch('a/**', 'a/b/c.pdf'), true);
  assert.equal(globMatch('a/?.pdf', 'a/b.pdf'), true);
  assert.equal(globMatch('a/?.pdf', 'a/bb.pdf'), false);
  assert.equal(globMatch('a.b', 'axb'), false);
});

test('serverOf reads the server of a plain and a plugin tool name', () => {
  assert.equal(serverOf('mcp__context7__query-docs'), 'context7'); // mcp-fixture
  assert.equal(serverOf('mcp__plugin_x_context7__resolve-library-id'), 'context7'); // mcp-fixture
  assert.equal(serverOf('Read'), null);
});

test('judgedTexts: WebSearch gives its query', () => {
  assert.deepEqual(judgedTexts('WebSearch', { query: 'node fs.rmSync' }, []), ['node fs.rmSync']);
});

test('judgedTexts: WebFetch gives the decoded query values only', () => {
  const url = 'https://h.io/a/src/x.js?q=src%2Fpricing.js+bug#frag';
  assert.deepEqual(judgedTexts('WebFetch', { url, prompt: 'summarize applyDiscount' }, []), ['src/pricing.js bug']);
});

test('unparsable url is not judged', () => {
  assert.deepEqual(judgedTexts('WebFetch', { url: 'not a url' }, []), []);
});

test('judgedTexts: documentation servers give their query field, other servers are not judged', () => {
  assert.deepEqual(judgedTexts('mcp__context7__query-docs', { libraryId: '/a/b', query: 'how to x' }, []), ['how to x']); // mcp-fixture
  assert.deepEqual(judgedTexts('mcp__plugin_x_context7__resolve-library-id', { libraryName: 'react', query: 'hooks' }, []), ['hooks']); // mcp-fixture
  assert.equal(judgedTexts('mcp__serena__search_for_pattern', { pattern: 'x' }, []), null); // mcp-fixture
  assert.deepEqual(judgedTexts('mcp__ref__search', { q: 'find this' }, ['ref']), ['find this']);
  assert.equal(judgedTexts('mcp__ref__search', { q: 'find this' }, []), null);
});

test('tokensOf cuts a line suffix and pathCandidates keeps the path', () => {
  const tokens = tokensOf('at src/pricing.js:13:20');
  assert.deepEqual(tokens, ['at', 'src/pricing.js']);
  assert.deepEqual(pathCandidates(tokens), ['src/pricing.js']);
  assert.deepEqual(pathCandidates(['./src/a.js', 'noslash.js', 'src/noext']), ['src/a.js']);
});

test('nameCandidates keeps project-shaped names and drops public ones', () => {
  const tokens = tokensOf('applyDiscount clampPercent getServerSideProps fetch');
  assert.deepEqual(nameCandidates(tokens), ['applyDiscount', 'clampPercent']);
  assert.ok(PUBLIC_NAMES.includes('getServerSideProps'));
});

test('long query stays linear', () => {
  const text = ('word/path.js applyDiscount x_y; ').repeat(650).slice(0, 20000);
  const start = Date.now();
  const tokens = tokensOf(text);
  pathCandidates(tokens);
  nameCandidates(tokens);
  codeLines(text);
  piiCounts(text + 'a'.repeat(20000));
  assert.ok(Date.now() - start < 200);
});

test('candidates drop glob and magic pathspec shapes and odd names', () => {
  assert.deepEqual(pathCandidates(['src/*.js']), []);
  assert.deepEqual(pathCandidates(['src/:(top)a.js']), []);
  assert.deepEqual(nameCandidates(['a|bC_d']), []);
  assert.deepEqual(nameCandidates(['fs.rmSync']), ['rmSync']);
});

test('git argv shapes', () => {
  assert.deepEqual(trackedArgv('/p/q/file.pdf'), ['ls-files', '--error-unmatch', '--', 'file.pdf']);
  assert.deepEqual(pathsArgv(['src/a.js', 'b/c.ts']), ['ls-files', '-z', '--', ':(top,glob)**/src/a.js', ':(top,glob)**/b/c.ts']);
  const argv = namesArgv(['my$Var1', 'other']);
  assert.deepEqual(argv.slice(0, 5), ['grep', '-o', '-h', '-I', '-E']);
  assert.ok(argv.some((a) => a.includes('my\\$Var1')));
  const joined = argv.join(' ');
  assert.ok(!/\\s/.test(joined) && !/\\b/.test(joined));
  assert.ok(!argv.includes('-w'));
  assert.equal(argv.filter((a) => a === '-e').length, 4);
  const pathspecs = argv.slice(argv.indexOf('--'));
  assert.deepEqual(pathspecs.slice(0, 2), ['--', ':/']);
  assert.deepEqual(pathspecs.slice(2), ['**/*.md', '**/*.txt', '**/*.min.*', '**/vendor/**', '**/dist/**', '**/public/build/**', '**/public/js/**', '**/third_party/**', '**/node_modules/**'].map((g) => ':(top,exclude,glob)' + g));
  assert.ok(argv.some((a) => a.includes('[[:space:]]+other([^[:alnum:]_$]|$)')));
  const own = argv.filter((a) => a.includes('other([[:space:]]*:'));
  assert.equal(own.length, 1);
  assert.ok(own[0].includes('[[:space:]]*:[[:space:]]*((async[[:space:]]+)?function|async[[:space:]]*\\()') && own[0].includes('[[:space:]]*=[[:space:]]*(async[[:space:]]+)?(function|\\()'));
  assert.ok(!own[0].includes('[:=]'));
});

test('pathsFound and namesFound map output back to candidates', () => {
  assert.deepEqual(pathsFound('src/pricing.js\0lib/a.js\0', ['src/pricing.js', 'x/y.js']), ['src/pricing.js']);
  assert.deepEqual(pathsFound('deep/src/pricing.js\0', ['src/pricing.js']), ['src/pricing.js']);
  assert.deepEqual(pathsFound('xsrc/pricing.js\0', ['src/pricing.js']), []);
  assert.deepEqual(
    namesFound('function applyDiscount\nclampPercent = (\n', ['applyDiscount', 'clampPercent', 'other']),
    ['applyDiscount', 'clampPercent'],
  );
  assert.deepEqual(namesFound('function applyDiscountX\n', ['applyDiscount']), []);
});

test('egressFindings is quiet for a public text with nothing found', () => {
  const found = egressFindings('node 22 fs.rmSync recursive maxRetries', { paths: [], names: [] });
  assert.equal(found.any, false);
  assert.equal(egressFindings('x', { paths: ['a/b.js'], names: [] }).any, true);
  assert.equal(egressFindings('const total = items.map((b) => { return b * 2; });', { paths: [], names: [] }).any, true);
});

test('codeLines counts marker lines only when the text has the code shape', () => {
  assert.equal(codeLines('function computeTotal(a) { return a * 2; }'), 1);
  assert.equal(codeLines('node 22 fs.rmSync recursive maxRetries'), 0);
  assert.equal(codeLines('const total = items.reduce((a, b) => a + b, 0);\nif (total > max) { warn(); }'), 2);
  assert.equal(codeLines('a { b'), 0);
  assert.equal(codeLines('how do I write a for loop; and a while loop in JavaScript today'), 0);
});

test('rewriteBrief names each token to remove and gives a general example', () => {
  const brief = rewriteBrief({
    tool: 'WebSearch',
    text: 'why does applyDiscount in src/pricing.js round wrong',
    paths: ['src/pricing.js'],
    names: ['applyDiscount'],
    codeLines: 0,
  });
  assert.equal(brief, [
    'Blocked: this WebSearch query sends project code to a third-party service.',
    'Remove: src/pricing.js, applyDiscount.',
    'Keep: the language and its version, public library and API names, the error type and its generic message, the behaviour.',
    'Search again in general terms, e.g. "why does in round wrong", then apply the answer to the local code.',
    'The code itself never leaves this session.',
  ].join('\n'));
});

test('rewriteBrief counts code lines and drops the example when under 2 words are left', () => {
  const brief = rewriteBrief({ tool: 'WebSearch', text: 'fix applyDiscount\nconst a = b => { return c; };', paths: [], names: ['applyDiscount'], codeLines: 1 });
  const rows = brief.split('\n');
  assert.equal(rows.length, 5);
  assert.equal(rows[1], 'Remove: applyDiscount, 1 code line.');
  assert.ok(!rows[3].includes('e.g.'));
  assert.equal(rows[3], 'Search again in general terms, then apply the answer to the local code.');
  assert.ok(rewriteBrief({ tool: 'WebSearch', text: 'a\nb', paths: [], names: [], codeLines: 3 }).includes('3 code lines.'));
});

test('askText names the clear list, denyText never does', () => {
  for (const route of ['dump', 'document']) {
    assert.ok(askText(route, 'data/x.csv', 'detail').includes('.alfred/.sensitive-paths'));
    assert.ok(askText(route, 'data/x.csv', 'detail').includes("'!data/x.csv'"));
    const deny = denyText(route, 'data/x.csv', 'detail');
    assert.ok(!deny.includes('.sensitive-paths') && !deny.includes('!'));
    assert.ok(deny.startsWith('Blocked: Read of data/x.csv'));
  }
});

test('globMatch: a leading double star folder matches zero or more folders', () => {
  assert.equal(globMatch('**/x.pdf', 'x.pdf'), true);
  assert.equal(globMatch('**/x.pdf', 'a/b/x.pdf'), true);
  assert.equal(globMatch('**/x.pdf', 'a/bx.pdf'), false);
  assert.equal(globMatch('a/**/x.pdf', 'a/x.pdf'), true);
  assert.equal(globMatch('a/**/x.pdf', 'a/b/c/x.pdf'), true);
});

test('pathState: a cleared double star line clears a root-level file', () => {
  const lists = parseSensitivePaths('**/*.csv\n!**/x.csv');
  assert.equal(pathState('x.csv', lists), 'cleared');
  assert.equal(pathState('y.csv', lists), 'listed');
});

test('pathCandidates strips leading parent folders and drops an inner one', () => {
  assert.deepEqual(pathCandidates(['../../src/pricing.js']), ['src/pricing.js']);
  assert.deepEqual(pathCandidates(['./../src/pricing.js']), ['src/pricing.js']);
  assert.deepEqual(pathCandidates(['src/../x.js']), []);
  assert.deepEqual(pathCandidates(['../../src/../x.js']), []);
});

test('denyText never names the list file, even for the kind a listed document carries', () => {
  const kind = documentVerdict({ ext: '.docx', tracked: true, listed: true }).kind;
  assert.ok(kind.includes('.sensitive-paths'));
  const deny = denyText('document', 'clients/a.docx', kind);
  assert.ok(!deny.includes('.sensitive-paths'));
  assert.ok(deny.includes('listed as sensitive'));
  assert.ok(!denyText('dump', 'a.csv', 'see .alfred/.sensitive-paths').includes('.sensitive-paths'));
  assert.ok(askText('document', 'clients/a.docx', kind).includes('.alfred/.sensitive-paths'));
});
