'use strict';
/* Test raporu aktarımı ↔ LCW AI sözleşmesi: tek AI yolu (lcwai-prompt
   CONTRACTS + lcwai-knowledge), cevap şekli denetimi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../server/lib/lcwai/lcwai-prompt');
const knowledge = require('../server/lib/lcwai/lcwai-knowledge');

test('iki sözleşme kayıtlı: okuma ve inceleme', () => {
  assert.ok(prompts.contractFor('test-report-extract'));
  assert.ok(prompts.contractFor('test-report-review'));
  assert.equal(prompts.contractFor('test-report-extract').fields.talepNo.required, true);
});

test('prompt test raporu bilgisini gerçek motordan alır ve tek JSON ister', () => {
  const built = prompts.buildPrompt({ source: 'test-report-extract', task: 'oku', context: { fileName: 'a.pdf', mailText: 'Test Talep No : 4467254' }, lang: 'tr' });
  assert.deepEqual(built.modules, ['test-reports']);
  assert.equal(built.contract, 'test-report-extract');
  assert.match(built.prompt, /Ticari Onay geçer sayılır/);
  assert.match(built.prompt, /"talepNo": string/);
  assert.match(built.prompt, /Tahmin etmek yerine alanı boş bırak/);
  const review = prompts.buildPrompt({ source: 'test-report-review', task: 'incele', context: { reports: [] }, lang: 'en' });
  assert.match(review.prompt, /Do not change Buyer Log's outcome/);
  assert.equal(knowledge.selectModules({ source: 'test-report-review' })[0], 'test-reports');
});

test('cevap şekli denetlenir; dizi alanları kısaltılır', () => {
  const ok = prompts.parseStructured('```json\n{"talepNo":"3464570","testler":["a | C1 | Pass"],"confidence":"HIGH","explanation":"x"}\n```', 'test-report-extract');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.testler, ['a | C1 | Pass']);
  const missing = prompts.parseStructured('{"confidence":"HIGH"}', 'test-report-extract');
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.includes('missing:talepNo'));
});
test('full-source assessment permits independent correction and requests short, clear answers', () => {
  const built=prompts.buildPrompt({source:'test-report-assess',task:'Review',context:{caseId:'case'},lang:'en'});
  assert.match(built.prompt,/independently correct wrong or missing facts/);
  assert.match(built.prompt,/summary at most 2 short sentences \(240 characters\)/);
  assert.match(built.prompt,/On Track is not a test approval/);
  const invalid=prompts.parseStructured(JSON.stringify({protocol:'p',caseId:'c',snapshotId:'s',coveredSourceIds:'cut list',unresolvedSourceIds:[],assessments:[],explanation:'x'}),'test-report-assess');
  assert.equal(invalid.ok,false,'a shortened/malformed source list cannot be accepted');
});
