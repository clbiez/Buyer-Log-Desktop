'use strict';

/* v2026-10-30 — İKİ SABİT UFUK VE YENİLEME ZİNCİRİ.
 *
 * Kullanıcı kararı: "Veri kaynağı refresh horizonlarını sadece 2 basit horizon
 * seçimine daraltacağım (INTAKE hariç). CP ayrı, diğer modüller ayrı çalışacak.
 * Diğer modüller yenilendiğinde CP de yenilensin. Data Management'ta da
 * bunları birleştirelim."
 *
 * Korunan kusurlar:
 *  1) ÇİFT SORGU. Kaynak izleyici CP ve Diğer modüller birlikte değiştiğinde
 *     CP'yi iki ayrı yenilemede çalıştırmamalı.
 *  2) ZİNCİR KOPMASI. İstemci ve sunucu "Diğer modüller" isteğini AYNI kuralla
 *     CP'ye genişletmeli; CP isteği geniş grubu çalıştırmamalı.
 *  3) SESSİZ KAYIP. Sabit gruba geçişte eski ayrı filtre saklanmalı; saklama
 *     deterministik olmalı (kaynak revizyon parmak izi okumadan okumaya oynamaz).
 *  4) INTAKE ufuklara girmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scopes = require('../server/lib/model-scopes');
const { normalizeHorizon } = require('../server/lib/modelHorizon');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const ALL = ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis'];
const LINKED = ['orders', 'backlog', 'lfl', 'priceanalysis'];
const H = values => ({ table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] });

function clientHelpers() {
  const begin = APP.indexOf('let authoritativeLinkedRefreshTargets=null;');
  const end = APP.indexOf('function refreshTargetsLabel(', begin);
  const watchBegin = APP.indexOf('// Değişen sayfalar yenileme birimlerine bölünür.');
  const watchEnd = APP.indexOf('async function runSourceWatch(', watchBegin);
  assert.ok(begin > 0 && end > begin && watchBegin > 0 && watchEnd > watchBegin, 'istemci yardımcıları bulunamadı');
  const context = {
    ALL_REFRESH_TARGETS: ALL, DEFAULT_LINKED_REFRESH_TARGETS: LINKED, appLang: 'tr',
    fetch: async () => ({ ok: true, json: async () => ({ linkedTargets: LINKED }) }),
    renderHorizonBadges: () => {},
  };
  vm.createContext(context);
  vm.runInContext(APP.slice(begin, end) + APP.slice(watchBegin, watchEnd), context);
  return context;
}

test('istemci ve sunucu "Diğer modüller" isteğini aynı kuralla CP\'ye genişletir', () => {
  const client = clientHelpers();
  for (const request of [['lfl'], ['orders'], ['priceanalysis', 'backlog'], ['cp'], ['cp', 'lfl'], []]) {
    assert.deepEqual(
      Array.from(client.withLinkedRefreshTargets(request)).sort(),
      scopes.withRefreshTargets(request).slice().sort(),
      `istemci ve sunucu ayrıştı: ${request.join(',')}`);
  }
  assert.deepEqual(Array.from(client.withLinkedRefreshTargets(['cp'])), ['cp'], 'CP geniş grubu çalıştırmaz');
});

test('kaynak izleyici CP\'yi iki kez sorgulamaz', () => {
  const client = clientHelpers();
  const units = value => JSON.parse(JSON.stringify(client.sourceWatchUnits(value)));
  assert.deepEqual(units(['cp']), [['cp']]);
  const both = units(['cp', 'orders']);
  assert.equal(both.length, 1, 'tek yenileme birimi');
  assert.deepEqual(both[0].slice().sort(), ALL.slice().sort());
  assert.equal(both[0].filter(target => target === 'cp').length, 1);
  const linkedOnly = units(['lfl']);
  assert.equal(linkedOnly.length, 1);
  assert.ok(linkedOnly[0].includes('cp'), 'Diğer modüller değişince CP de yenilenir');
});

test('iki ufuk sabittir; INTAKE ufuklara girmez', () => {
  assert.deepEqual(scopes.HORIZON_GROUPS.map(group => group.id), ['cp', 'linked']);
  const all = scopes.HORIZON_GROUPS.flatMap(group => group.targets);
  assert.ok(!all.includes('intake'));
  assert.deepEqual(scopes.normalizeLinkedTargets(['cp', 'lfl'], 'asas'), LINKED, 'kayıttaki özel üyelik okunmaz');
  assert.deepEqual(scopes.normalizeLinkedTargets(undefined, 'antrepo'), ['orders', 'backlog']);
  assert.equal(scopes.normalizeLinkedTargets(['intake'], 'intake'), null, 'INTAKE bağ kavramına sahip değil');
  assert.deepEqual(scopes.withRefreshTargets(['intake']), ['intake'], 'INTAKE zinciri tetiklemez');
});

test('geçişte saklanan eski filtre deterministiktir ve yalnız değişen üye için üretilir', () => {
  const raw = [
    { id: 'sc_cp', name: 'CP', targets: ['cp'], horizon: H(['LIC']) },
    { id: 'sc_core', name: 'Core', targets: ['orders', 'backlog', 'priceanalysis'], horizon: H(['S7']) },
    { id: 'sc_lfl', name: 'LFL', targets: ['lfl'], horizon: H(['S5']) },
  ];
  const normalized = scopes.normalizeScopes(raw, 'asas', {}, normalizeHorizon);
  const first = scopes.supersededLinkedHorizons(raw, normalized, LINKED, normalizeHorizon);
  const second = scopes.supersededLinkedHorizons(raw, normalized, LINKED, normalizeHorizon);
  assert.deepEqual(first, second, 'aynı girdi aynı çıktıyı vermeli');
  assert.deepEqual(first.map(entry => entry.moduleId), ['lfl']);
  assert.deepEqual(first[0].horizon.groups[0].conditions[0].values, ['S5']);
  assert.equal(first[0].scopeName, 'LFL');
  // Normalizasyon sonrası tekrar uygulanınca saklanacak bir şey kalmaz.
  assert.deepEqual(scopes.supersededLinkedHorizons(normalized, scopes.normalizeScopes(normalized, 'asas', {}, normalizeHorizon), LINKED, normalizeHorizon), []);
});
