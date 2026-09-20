'use strict';

/* MODEL GÖRSELİ KOMUTU — v11.10
 *
 * "ASAS'tan görselleri getir" gibi bir istek DOM tıklamasına DEĞİL,
 * yapılandırılmış bir komuta çevrilir:
 *
 *   yapılandırılmış komut → güncel görünüm kapsamı → kanonik varlık işlemi
 *
 * Korunan regresyonlar:
 *  · Komut kümesi KAPALI kalır; model kendi komutunu uyduramaz.
 *  · Hedef küme modelin ürettiği bir listeden değil, EKRANDAN gelir.
 *  · Kaynak belirsizse sessizce ASAS ya da PLM seçilmez; kullanıcıya sorulur.
 *  · Seçim boşsa "seçilenler" tüm kümeye genişlemez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const bus = require(path.join(ROOT, 'public', 'copilot-ui-commands.js'));

function harness({ identities = [{ plmId: '1' }, { plmId: '2' }], selected = [{ plmId: '1' }], scope = true } = {}) {
  const calls = [];
  const runner = bus.createRunner({
    modelAssets: {
      updateModelImages: options => { calls.push({ kind: 'run', ...options }); },
      openCurrentViewImageAction: () => { calls.push({ kind: 'chooser' }); },
    },
    modelAssetScope: {
      currentScope: () => (scope ? { contextType: 'lfl-drilldown', identities, selectedIdentities: selected } : null),
    },
  });
  return { runner, calls };
}

test('komut kümesi kapalı kalır ve modelImages üyesidir', () => {
  assert.deepEqual(bus.COMMANDS, ['navigate', 'filter', 'clearFilters', 'modelImages']);
  const { runner, calls } = harness();
  const out = runner.run([{ command: 'fetchImagesByClicking', module: 'cp' }]);
  assert.equal(out[0].ok, false);
  assert.equal(out[0].reason, 'unsupported');
  assert.deepEqual(calls, [], 'bilinmeyen komut hiçbir şey çalıştırmamalı');
});

test('"eksik görselleri ASAS\'tan tamamla" güncel görünüm kapsamını kullanır', () => {
  const { runner, calls } = harness();
  const [result] = runner.run([{ command: 'modelImages', source: 'asas', mode: 'missing' }]);
  assert.equal(result.ok, true);
  assert.equal(result.source, 'asas');
  assert.equal(result.mode, 'missing');
  assert.equal(result.scope, 'lfl-drilldown');
  assert.equal(result.identities, 2);
  assert.equal(calls[0].kind, 'run');
  assert.equal(calls[0].scope.contextType, 'lfl-drilldown');
});

test('"seçili görselleri PLM\'den yenile" yalnız seçimi işler', () => {
  const { runner } = harness();
  const [result] = runner.run([{ command: 'modelImages', source: 'plm', mode: 'selected' }]);
  assert.equal(result.identities, 1, 'yalnız seçili kimlik işlenmeli');
  assert.equal(result.source, 'plm');
});

test('seçim boşken "seçilenler" tüm kümeye GENİŞLEMEZ', () => {
  const { runner, calls } = harness({ selected: [] });
  const [result] = runner.run([{ command: 'modelImages', source: 'plm', mode: 'selected' }]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-selection');
  assert.deepEqual(calls, []);
});

test('kaynak belirsizse sessizce seçilmez — kullanıcıya sorulur', () => {
  for (const command of [{ command: 'modelImages', mode: 'all' }, { command: 'modelImages', source: 'sap', mode: 'all' }]) {
    const { runner, calls } = harness();
    const [result] = runner.run([command]);
    assert.equal(result.pending, 'source-choice');
    assert.equal(result.source, '');
    assert.equal(calls[0].kind, 'chooser', 'ASAS/PLM arasında sessiz seçim YAPILMAMALI');
  }
});

test('görsel taşımayan bir ekranda komut uygulanmaz', () => {
  const empty = harness({ identities: [], selected: [] });
  assert.equal(empty.runner.run([{ command: 'modelImages', source: 'asas', mode: 'missing' }])[0].reason, 'empty-scope');
  const none = harness({ scope: false });
  assert.equal(none.runner.run([{ command: 'modelImages', source: 'asas', mode: 'missing' }])[0].reason, 'empty-scope');
});

test('sunucu aracı yalnız NİYETİ doğrular; hedef modeli KENDİ seçmez', () => {
  const registry = fs.readFileSync(path.join(ROOT, 'server/lib/agent-tool-registry.js'), 'utf8');
  const start = registry.indexOf("id: 'ui.model_images'");
  assert.ok(start > 0, 'ui.model_images aracı yok');
  const block = registry.slice(start, start + 2200);
  assert.match(block, /command: 'modelImages'/);
  // Kaynak yalnız ASAS/PLM olabilir; başka bir şey boşa düşer ve istemci sorar.
  assert.match(block, /source === 'asas' \|\| source === 'plm' \? source : ''/);
  // Ajan kimlik listesi ÜRETMEZ: zarfta model/PLM listesi yoktur.
  assert.doesNotMatch(block, /plmId|identities|items/);
  // Yetki kontrolü korunur.
  assert.match(block, /AREA_FORBIDDEN/);
});

test('istemci özeti ne yapıldığını söyler, teknik ayrıntı dökmez', () => {
  const { runner } = harness();
  const results = runner.run([{ command: 'modelImages', source: 'asas', mode: 'missing' }]);
  assert.equal(bus.describe(results, true), 'ASAS görselleri · 2 model');
  assert.equal(bus.describe(results, false), 'ASAS images · 2 model(s)');
});
