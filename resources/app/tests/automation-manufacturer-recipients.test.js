'use strict';

/*
 * Kullanıcının karşılaştığı hata (birebir, AI aracının cevabı):
 *   "Bu dille her pazartesi o haftanın yüklemeleri için otomatik e-posta
 *    taslağı oluşturulabilir; ancak kayıtların [Üretici] değerine göre ilgili
 *    üreticiye ayrı ayrı otomatik gönderim tanımlanamaz. Alıcı yalnızca Buyer
 *    Log'da seçilen gruptur."
 *
 * Kök nedenler:
 *  1) Automation Language SEND_EMAIL yalnız RECIPIENT_GROUP tanıyordu ve AI
 *     yönergesi "her zaman RECIPIENT_GROUP ASK_USER yaz" diyordu.
 *  2) Otomasyon adres defteri ortak üretici rehberini (E-Mail Grupları →
 *     Üreticiler) hiç okumuyordu; Prepare E-Mail adresleri v7.35'ten beri boş
 *     saklandığı için "Üretici" alanına göre bölme çözülemiyordu.
 *  3) Lisanslı Non-DTR siparişte Manufacturer lisansörün adıdır; sorumlu Alt
 *     Üretici'dir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const registry = require('../server/lib/ai-capability-registry');
const language = require('../server/lib/automation-language');
const compiler = require('../server/lib/ai-automation-compiler');
const recipeStore = require('../server/lib/automation-recipe-store');
const assistant = require('../public/automation-assistant.js');

const CODE = [
  'BUYERLOG_AUTOMATION 1.0',
  'NAME "Bu haftanın yüklemeleri"',
  'TRIGGER',
  '  WEEKLY ON MONDAY AT 09:00',
  'END',
  'SOURCE "orders"',
  'WHEN',
  '  DAYS_UNTIL([Ex-Factory]) BETWEEN 0 AND 6',
  'END',
  'ACTIONS',
  '  SEND_EMAIL',
  '    RECIPIENT_FIELD [Üretici]',
  '    SUBJECT "Bu haftanın yüklemeleri"',
  '    INCLUDE_MATCHING_ROWS TRUE',
  '  END',
  'END',
].join('\n');

test('Automation Language can split an email by manufacturer (RECIPIENT_FIELD)', () => {
  const model = registry.getCapabilityModel();
  assert.ok(model.actions.find(item => item.id === 'SEND_EMAIL').parameters.includes('RECIPIENT_FIELD'));
  const parsed = language.parse(CODE);
  assert.deepEqual(parsed.requiredInputs, []);
  const validation = language.validate(parsed, model);
  assert.equal(validation.ok, true, validation.errors.join(' | '));
  const draft = compiler.compile(parsed, validation, { sourceCode: CODE });
  assert.equal(draft.email.recipientMode, 'field');
  assert.equal(draft.email.recipientField, 'Üretici');
  assert.equal(draft.email.groupId, '');
  assert.equal(draft.schedule.mode, 'weekly');
  // Kayıt deposu tanımı RECIPIENT_FIELD'ı kaybetmez.
  const stored = recipeStore.normalizeRecipe({ ...draft, id: 'r1' }, 'u1');
  assert.equal(stored.ai.definition.actions[0].RECIPIENT_FIELD, '[Üretici]');
});

test('validator rejects a missing, ambiguous or unknown recipient field', () => {
  const model = registry.getCapabilityModel();
  const without = language.parse(CODE.replace('    RECIPIENT_FIELD [Üretici]\n', ''));
  assert.match(language.validate(without, model).errors.join(' '), /RECIPIENT_GROUP veya RECIPIENT_FIELD/);
  const both = language.parse(CODE.replace('    RECIPIENT_FIELD [Üretici]', '    RECIPIENT_FIELD [Üretici]\n    RECIPIENT_GROUP ASK_USER'));
  assert.match(language.validate(both, model).errors.join(' '), /birlikte/);
  const unknown = language.parse(CODE.replace('[Üretici]', '[Olmayan Alan]'));
  assert.match(language.validate(unknown, model).errors.join(' '), /Bilinmeyen alan/);
});

test('AI prompt no longer claims the recipient can only be a fixed group', () => {
  const prompt = assistant.buildAutomationPrompt({ lang: 'tr', source: 'orders', request: 'x', model: registry.getCapabilityModel() });
  assert.match(prompt, /RECIPIENT_FIELD \[Üretici\]/);
  assert.match(prompt, /RECIPIENT_GROUP ASK_USER/);
  assert.doesNotMatch(prompt, /her zaman RECIPIENT_GROUP ASK_USER yaz/);
  const en = assistant.buildAutomationPrompt({ lang: 'en', source: 'orders', model: registry.getCapabilityModel() });
  assert.match(en, /RECIPIENT_FIELD \[Manufacturer\]/);
});

test('server address book reads manufacturer cards and splits per responsible manufacturer', () => {
  const server = fs.readFileSync('server/server.js', 'utf8');
  assert.match(server, /function automationManufacturerCardGroups\(\)/);
  assert.match(server, /emailGroupsStore\.loadStore\(\)\.records/);
  assert.match(server, /prepare=automationManufacturerCardGroups\(\)\.concat\(automationPrepareEmailGroups\(ownerId\)\)/);
  assert.match(server, /manufacturerCards\.isManufacturerField\(field\)/);
  assert.match(server, /manufacturerCards\.splitRowsByResponsibleManufacturer\(rows,ordered\)/);
});

test('readiness accepts the canonical equivalent of an AI recipient field', () => {
  global.BLCanonicalFields = require('../public/canonical-fields.js');
  try {
    const recipe = { name: 'x', source: 'orders', purpose: 'email', filters: [], email: { recipientMode: 'field', recipientField: 'Üretici', subject: 's' } };
    const issues = assistant.readiness(recipe, { fields: ['Manufacturer', 'Order Code'], fieldsLoaded: true });
    assert.ok(!issues.some(item => item.target === 'email' && item.level === 'error'), JSON.stringify(issues));
    const missing = assistant.readiness({ ...recipe, email: { ...recipe.email, recipientField: 'Olmayan' } }, { fields: ['Manufacturer'], fieldsLoaded: true });
    assert.ok(missing.some(item => item.target === 'email' && item.level === 'error'));
  } finally { delete global.BLCanonicalFields; }
});
