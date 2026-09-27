'use strict';

/* VERİ EŞLEŞTİRME KURALLARI — DÜZENLEYİCİ (v7.82).
 *
 * Bu dosya kaynak metni değil, ÇİZİMİ sınar: düzenleyici sahte bir sunucu
 * yanıtıyla vm içinde çalıştırılır. Kaynak-sözleşme testi "data-add-operand
 * yazıyor mu" diye sorabilir; ama üç kaynaklı bir koşulun gerçekten üç kutu
 * çizip çizmediğini yalnız çalıştırmak söyler. Dosya bu doğrulamayı kaldıracak
 * kadar küçük ve saf şablon; app-main.js gibi DOM'a gömülü değil.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'data-management-matchrule.js'), 'utf8');

function payload() {
  return {
    revision: 7,
    sourceMode: 'database',
    fullSchema: false,
    exactOnly: true,
    sources: [
      { id: 'conn-asas', role: 'asas', profileId: 'asas-orders', label: 'ASAS', kind: 'database', connection: { server: 's1', catalog: 'ASAS_30' }, columns: [{ table: 'Orders', name: 'Order Code' }, { table: 'Orders', name: 'Model' }], error: '', authoritative: false },
      { id: 'conn-ias', role: 'antrepo', profileId: 'ias-warehouse', label: 'IAS', kind: 'database', connection: { server: 's2', catalog: 'IASv2' }, columns: [{ table: 'Shipments', name: 'Order Code' }], error: '', authoritative: false },
      { id: 'conn-plm', role: 'plm', profileId: 'plm', label: 'PLM', kind: 'database', connection: { server: 's3', catalog: 'PLM' }, columns: [{ table: 'Styles', name: 'Style Key' }], error: '', authoritative: false },
    ],
    suggested: { version: 2, conditions: [] },
    config: {
      version: 2,
      conditions: [
        {
          id: 'ocode', normalization: '', operands: [
            { sourceId: 'conn-asas', role: 'asas', header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod', table: 'Orders', name: 'Order Code', kind: 'column', unresolved: '' },
            { sourceId: 'conn-ias', role: 'antrepo', header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod', table: 'Shipments', name: 'Order Code', kind: 'column', unresolved: '' },
            { sourceId: 'conn-plm', role: 'plm', header: 'Style Key', canonicalHeader: 'Style Key', table: 'Styles', name: 'Style Key', kind: 'column', unresolved: '' },
          ],
        },
        {
          id: 'model', normalization: '', operands: [
            { sourceId: 'conn-asas', role: 'asas', header: 'Model Adı', canonicalHeader: 'Model Adı', table: 'Orders', name: 'Model', kind: 'column', unresolved: '' },
            { sourceId: 'conn-ias', role: 'antrepo', header: 'Ürün Ad', canonicalHeader: 'Ürün Ad', table: '', name: '', kind: 'column', unresolved: 'column' },
          ],
        },
      ],
    },
  };
}

/** Düzenleyiciyi sahte bir yanıtla açar ve çizilen HTML'i döndürür. */
async function renderEditor(response = payload()) {
  let html = '';
  const host = {
    classList: { add() {}, remove() {} },
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(host, 'innerHTML', { get: () => html, set: value => { html = value; } });

  const sandbox = {
    window: {},
    appLang: 'tr',
    escapeHtml: value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    renderMatchAudit: () => '<div>audit</div>',
    fetch: async () => ({ ok: true, json: async () => response }),
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  await sandbox.window.BLDataMatchRule.open(host, { canManage: true });
  return html;
}

test('üç kaynaklı koşul üç operand kutusu çizer', async () => {
  const html = await renderEditor();
  assert.strictEqual((html.match(/data-source="0:/g) || []).length, 3);
  assert.strictEqual((html.match(/data-pick="0:/g) || []).length, 3);
  // İki operandlı koşulda iki kutu; sayı koşula göre değişmeli, sabit olmamalı.
  assert.strictEqual((html.match(/data-source="1:/g) || []).length, 2);
});

test('kaynak adları sunucudan gelir; ekranda sabit ASAS/IAS etiketi yoktur', async () => {
  const html = await renderEditor();
  assert.match(html, />ASAS</);
  assert.match(html, />IAS</);
  assert.match(html, />PLM</, 'üçüncü kaynak da seçilebilir olmalı');
  assert.doesNotMatch(html, /ASAS sütunu|IAS sütunu/);
  assert.match(html, /Veri eşleştirme kuralları/);
});

test('çözülemeyen alan görünür işaretlenir ve uyarı yazılır', async () => {
  const html = await renderEditor();
  assert.match(html, /isUnresolved/);
  assert.match(html, /dmrNote--bad/);
});

test('alan ve koşul ekleme/çıkarma denetimleri çizilir', async () => {
  const html = await renderEditor();
  assert.match(html, /data-add-operand/);
  assert.match(html, /data-drop-operand/);
  assert.match(html, /data-add /);
  assert.match(html, /data-drop="/);
  assert.match(html, /data-save/);
});

test('tek koşullu kuralda koşul silme kapalıdır', async () => {
  const single = payload();
  single.config.conditions = [single.config.conditions[0]];
  const html = await renderEditor(single);
  const dropButton = html.slice(html.indexOf('data-drop="0"'), html.indexOf('data-drop="0"') + 200);
  assert.match(dropButton, /disabled/, 'son koşul silinememeli');
});

test('iki operandlı koşulda operand silme kapalıdır', async () => {
  const html = await renderEditor();
  // 1. koşulda iki operand var: hiçbiri silinemez, yoksa koşul kısıt üretmez.
  const second = html.slice(html.indexOf('data-drop-operand="1:0"'));
  assert.match(second.slice(0, 200), /disabled/);
  // 0. koşulda üç operand var: silinebilir.
  const first = html.slice(html.indexOf('data-drop-operand="0:0"'));
  assert.doesNotMatch(first.slice(0, 120), /disabled/);
});


test('veritabanı sütun seçicisi yalnız seçilen kaynağın canlı şemasını lazy yükler', async () => {
  let html = '';
  let clickHandler = null;
  const fetchUrls = [];
  const pickerCalls = [];
  const initial = payload();
  initial.sources[0].schemaLoaded = false;

  const live = payload();
  live.sources[0] = {
    ...live.sources[0],
    schemaLoaded: true,
    authoritative: true,
    columns: [
      { table: 'Orders', name: 'Order Code' },
      { table: 'Orders', name: 'Database Only Key' },
    ],
  };

  const host = {
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { if (type === 'click') clickHandler = fn; },
    removeEventListener() {},
  };
  Object.defineProperty(host, 'innerHTML', { get: () => html, set: value => { html = value; } });

  const sandbox = {
    window: {
      BLDataPicker: {
        open(_anchor, items) { pickerCalls.push(items); },
        close() {},
      },
    },
    appLang: 'tr',
    escapeHtml: value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    renderMatchAudit: () => '<div>audit</div>',
    fetch: async url => {
      fetchUrls.push(String(url));
      return { ok: true, json: async () => String(url).includes('fullSource=') ? live : initial };
    },
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  await sandbox.window.BLDataMatchRule.open(host, { canManage: true });

  const anchor = {
    dataset: { pick: '0:0' },
    innerHTML: 'Sipariş Kod',
    disabled: false,
    isConnected: true,
  };
  const target = {
    closest(selector) { return selector === '[data-pick]' ? anchor : null; },
  };
  clickHandler({ target });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(fetchUrls.some(url => url.includes('/api/match-rule?fullSource=conn-asas')),
    'seçilen ASAS kaynağının gerçek şeması istenmeli');
  assert.strictEqual(pickerCalls.length, 1);
  assert.ok(pickerCalls[0].some(entry => entry.label === 'Database Only Key'),
    'Buyer Log Field Mapping dışında kalan gerçek database sütunu seçicide görünmeli');
});
