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
