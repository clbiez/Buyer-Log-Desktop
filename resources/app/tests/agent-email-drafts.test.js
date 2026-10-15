'use strict';
/* Agent e-posta taslakları: LCW AI'ın verdiği taslaklarda yalnız geçerli
   adresler, tek satır konu ve sınırlı gövde kalır; Buyer Log her taslağı
   Outlook'ta açılan .eml (X-Unsent) olarak üretir, CC dahil. Hiçbir şey
   gönderilmez. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parseDrafts, address } = require('../server/lib/agent-email-drafts');
const { parseStructured } = require('../server/lib/lcwai/lcwai-prompt');

test('drafts keep valid addresses only, one-line subjects and bounded bodies', () => {
  const drafts = parseDrafts([
    JSON.stringify({ to: ['DEMO Supplier <supplier@example.com>', '[adres gerekli]', 'supplier@example.com'], cc: 'merch.a@example.com; Merch B <merch.b@example.com>', subject: 'Order status\r\nBcc: evil@example.com', body: 'Hello\r\n\r\n| Order | EXF |\n|---|---|\n| 7300001 | 2026-10-12 |' }),
    { to: [], cc: [], subject: 'No address yet', body: 'Body' },
    'not json', { to: ['x@example.com'] }, ['array'],
  ]);
  assert.equal(drafts.length, 2, 'invalid JSON, empty drafts and arrays are dropped');
  assert.deepEqual(drafts[0].to, ['DEMO Supplier <supplier@example.com>'], 'placeholder and duplicate addresses are removed');
  assert.deepEqual(drafts[0].cc, ['merch.a@example.com', 'Merch B <merch.b@example.com>']);
  assert.equal(drafts[0].subject, 'Order status Bcc: evil@example.com', 'no header injection through the subject');
  assert.equal(drafts[0].body, 'Hello\n\n| Order | EXF |\n|---|---|\n| 7300001 | 2026-10-12 |');
  assert.equal(drafts[0].droppedAddresses, 1);
  assert.equal(drafts[1].missingRecipient, true);
  assert.equal(address('mailto:a@b.co'), 'a@b.co');
  assert.equal(address('Ali <a@b>'), null, 'an address without a domain is not used');
  assert.equal(address('"Evil" <a@b.com>\r\nBcc: x@y.com'), null, 'no line breaks reach an address');
  assert.equal(parseDrafts(Array.from({ length: 30 }, (_, i) => ({ subject: 's' + i, body: 'b' }))).length, 20);
});

test('the agent contract keeps draft objects and puts the answer first so it can stream', () => {
  const raw = JSON.stringify({ answer: '2 taslak hazırladım.', emailDrafts: [{ to: ['a@example.com'], subject: 'S', body: 'B' }] });
  const parsed = parseStructured(raw, 'agent-office');
  assert.equal(parsed.ok, true);
  assert.deepEqual(parseDrafts(parsed.data.emailDrafts), [{ to: ['a@example.com'], cc: [], subject: 'S', body: 'B', missingRecipient: false, droppedAddresses: 0 }]);
  const { buildPrompt } = require('../server/lib/lcwai/lcwai-prompt');
  const prompt = buildPrompt({ source: 'agent-office', lang: 'en', task: 'Draft e-mails', context: {} }).prompt;
  assert.ok(prompt.indexOf('"answer"') < prompt.indexOf('"emailDrafts"'), 'answer is listed before emailDrafts');
  assert.match(prompt, /put every draft in emailDrafts/);assert.match(prompt, /nothing is sent/);
});

test('the .eml draft carries To, Cc and X-Unsent so Outlook opens it as an editable draft', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const pick = name => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
  const build = new Function('crypto', 'Buffer', 'path', [pick('mimeBase64'), pick('mimeHeader'), pick('safeMailFilename'), pick('pricingMailAttachments'), pick('buildPricingEml'), 'return buildPricingEml;'].join('\n'))(crypto, Buffer, path);
  const eml = build({ to: '"DEMO" <supplier@example.com>', cc: 'merch.a@example.com; merch.b@example.com\r\nBcc: evil@example.com', subject: 'Sipariş durumu', text: 'Merhaba', html: '<p>Merhaba</p>' });
  const head = eml.split('\r\n\r\n')[0].split('\r\n');
  assert.equal(head[0], 'X-Unsent: 1');
  assert.ok(head.includes('To: "DEMO" <supplier@example.com>'));
  assert.ok(head.includes('Cc: merch.a@example.com; merch.b@example.comBcc: evil@example.com'), 'line breaks are stripped, so no extra header is created');
  assert.ok(!head.some(line => /^Bcc:/i.test(line)));
  assert.ok(head.includes('Subject: =?UTF-8?B?' + Buffer.from('Sipariş durumu').toString('base64') + '?='));
  const noCc = build({ to: 'a@example.com', subject: 'S', text: 't', html: 'h' });
  assert.ok(!/\r\nCc:/.test(noCc.split('\r\n\r\n')[0]), 'pricing drafts without CC are unchanged');
});

test('review follow-ups: long drafts survive, names cannot break the header, ASCII-only addresses, commas inside names', () => {
  const body = Array.from({ length: 320 }, (_, i) => '| 41' + String(i).padStart(5, '0') + ' | DEMO | 2026-10-12 |').join('\n');
  const parsed = parseStructured(JSON.stringify({ answer: 'a', emailDrafts: [{ to: ['a@example.com'], subject: 'S', body }, JSON.stringify({ to: ['b@example.com'], subject: 'T', body })] }), 'agent-office');
  assert.deepEqual(parseDrafts(parsed.data.emailDrafts).map(d => d.body.length), [body.length, body.length], 'a draft with a long order table is not cut into broken JSON');
  assert.equal(parseStructured(JSON.stringify({ answer: 'a', perspectives: ['x'.repeat(5000)] }), 'agent-office').data.perspectives[0].length, 2000, 'other fields keep their limits');
  assert.equal(address('Evil\\ <a@example.com>'), 'Evil <a@example.com>', 'a backslash cannot escape the closing quote');
  assert.equal(address('ayşe@lcwaikiki.com'), null);assert.equal(address('a@b.c.'), null);
  assert.equal(address('first.last@lcwaikiki.com'), 'first.last@lcwaikiki.com');assert.equal(address("o'neil@corp.co.uk"), "o'neil@corp.co.uk");
  assert.deepEqual(parseDrafts([{ subject: 'S', body: 'B', to: 'x@example.com', cc: '"Khan, Salem" <k@example.com>; b@example.com, c@example.com' }])[0].cc,
    ['Khan, Salem <k@example.com>', 'b@example.com', 'c@example.com'], 'a comma inside a quoted name does not split the address');
});

test('the e-mail HTML leaves out the chat copy toolbar and names are quoted safely', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'agent-office.js'), 'utf8');
  assert.match(src, /function mailBodyHtml\(body\)\{[^}]*\.lcwaiCodeHead,button[^}]*remove\(\)/);
  assert.match(src, /<body>\$\{mailBodyHtml\(draft\.body\)\}<\/body>/);
  assert.match(src, /name\.replace\(\/\["\\\\\]\/g,''\)/, 'quotes and backslashes are removed from ASCII display names');
});
