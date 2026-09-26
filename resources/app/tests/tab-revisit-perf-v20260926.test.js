'use strict';

/* 30.000 satırlık tarayıcı profilinde bulundu: veri zaten yüklüyken bile her
   sekme geçişi 1–2,5 sn ana iş parçacığını kilitliyordu.
   1) Genel Bakış'a her girişte karar motoru "hazır" olayı yeniden işleniyor,
      öncelik kararları (CP ve Siparişler) temizlenip ≈1 sn yeniden hesaplanıyordu.
      Artık yalnız motor ilk kez yüklendiğinde temizlenir.
   2) Model/sipariş bağlantı zenginleştirmesi, sayfaya HERHANGİ bir düğüm
      eklendiğinde belgedeki BÜTÜN tabloları (gizli sekmeler dahil) satır satır
      tarıyordu. Artık yalnız eklenen düğümlerin tabloları işlenir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./helpers/app-main-functions');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('Genel Bakış’a tekrar girişte öncelik kararları temizlenmez; yalnız motor ilk yüklendiğinde', () => {
  const body = extractFunction(APP, 'switchTab');
  assert.match(body, /const decisionEngineWasReady=Boolean\(window\.BLCpAssistant&&typeof window\.BLCpAssistant\.computeDecisionsForRows==='function'\);/);
  assert.match(body, /\.then\(\(\)=>\{if\(decisionEngineWasReady\)return;try\{invalidateUnifiedPriorityDecisions\('overview-decision-engine-ready'\)/);
});

test('bağlantı zenginleştirmesi yalnız eklenen düğümlerin tablolarını işler', () => {
  const { tablesForMutations } = require('vm').runInNewContext(`${extractFunction(APP, 'tablesForMutations')};({tablesForMutations})`, {});
  const table = { tagName: 'TABLE', nodeType: 1, closest: () => null, querySelectorAll: () => [] };
  const row = { tagName: 'TR', nodeType: 1, closest: sel => (sel === 'table' ? table : null), querySelectorAll: () => [] };
  const toast = { tagName: 'DIV', nodeType: 1, closest: () => null, querySelectorAll: () => [] };
  const text = { nodeType: 3 };
  const found = tablesForMutations([{ addedNodes: [row, text] }, { addedNodes: [toast] }]);
  assert.deepEqual([...found], [table], 'bildirim/ipucu eklemek tablo taraması başlatmaz');
  assert.match(APP, /new MutationObserver\(mutations=>\{const tables=tablesForMutations\(mutations\);if\(tables\.size\)schedulePlmModelLinkEnhancement\(tables\);\}\)/);
});

test('bir tablonun verisi yüklenince diğer tablonun öncelik kararları geçersiz sayılmaz', () => {
  assert.match(APP, /invalidateUnifiedPriorityDecisions\('orders-projection-loaded',\['orders'\]\)/);
  assert.match(APP, /invalidateUnifiedPriorityDecisions\('cp-projection-loaded',\['cp'\]\)/);
  const sync = extractFunction(APP, 'syncUnifiedPrioritiesForTable');
  assert.match(sync, /cached\.dataRevision===_unifiedPriorityTableRevision\[tableKey\]/);
  const invalidate = extractFunction(APP, 'invalidateUnifiedPriorityDecisions');
  assert.match(invalidate, /tables\.length\?tables:\['cp','orders'\]/, 'tablo belirtilmezse eskisi gibi ikisi de temizlenir');
});

test('CP/Siparişler’e tekrar girişte değişmemiş tablo baştan çizilmez (yalnız deferredUi ilk yüklendiğinde)', () => {
  const body = extractFunction(APP, 'switchTab');
  assert.match(body, /const deferredUiWasLoaded=window\.BLPerf\?\.isFeatureLoaded\?\.\('deferredUi'\)===true;/);
  assert.match(body, /if\(currentActiveTab\(\)!==tab\|\|deferredUiWasLoaded\)return;/);
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'public', 'perf-runtime.js'), 'utf8');
  assert.match(runtime, /function isFeatureLoaded\(name\)\{return loadedFeatures\.has\(String\(name\)\);\}/);
  assert.match(runtime, /\.then\(\(\)=>\{loadedFeatures\.add\(name\);\}\)/);
});
