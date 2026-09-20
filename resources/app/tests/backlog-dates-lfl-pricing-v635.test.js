'use strict';

/* v6.35 — Backlog tarih kaynakları, LFL düzeni ve fiyat geçmişi sıralaması.
 *
 * En kritik madde Backlog: 'Orijinal Exfactory Merch Tarih' ile
 * 'REVİZE YÜKLEME TARİHİ (EX-FACTORY)' sütunlarının İKİSİ de order.ex okuyordu.
 * order.ex ise applyDateOverrides'tan geçmiş, yani CP revizyonunu TAŞIYAN
 * değerdir: "Orijinal" sütunu orijinali göstermiyor ve iki sütun her zaman
 * birbirinin aynısı çıkıyordu. Aşağıdaki testler gerçek builder'ı çalıştırır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const LFL_CSS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* SAAT DİLİMİ TUZAĞI (v5.81 dersi, bu testte tekrar yaşandı):
   new Date('2026-03-01T00:00:00Z') UTC gece yarısıdır ve toISOString() ile geri
   okunduğunda UTC+3'te bir gün kayar. Uygulama gün bazında çalıştığı için
   fixture tarihleri YEREL gece yarısı kurulur ve karşılaştırma da yerel takvim
   bileşenlerinden yapılır; testin kendisi asla saat dilimi matematiğine
   güvenmez. */
const D = (text) => {
  const [y, m, d] = String(text).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const iso = (value) => {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ASAS tarihi 01.03, CP'de 15.03'e revize edilmiş bir sipariş.
function fixtureOrder() {
  return {
    ocode: '1234569', model: 'ALFA', ccode: 'RED', season: 'W6', countryRaw: 'Mısır',
    ex: D('2026-03-15'), _asasEx: D('2026-03-01'),
    retail: D('2026-05-01'), mb: D('2026-05-15'), qty: 1000,
  };
}
function segmentFor(order, kind, extra) {
  const seg = Object.assign({}, order, {
    _segmentKind: kind,
    _status: kind === 'production' ? 'Üretimde' : 'Depoda',
    qty: 400, _segmentIndex: 0,
  }, extra || {});
  Object.defineProperty(seg, '_sourceOrderRef', { value: order, enumerable: false });
  return seg;
}
function buildRows(segments, order) {
  return parse.backlogTemplateRowsFromSegments(segments, {}, new Map(), []);
}

/* ------------------------------------------- 1) BACKLOG: ORİJİNAL vs REVİZE */

test('v6.35 Orijinal Exfactory sütunu revizyonu DEĞİL ASAS tarihini gösteriyor', () => {
  const order = fixtureOrder();
  const [row] = buildRows([segmentFor(order, 'production')], order);
  assert.equal(iso(row['Orijinal Exfactory Merch Tarih']), '2026-03-01');
  // Ay sütunu da aynı kaynaktan türemeli; yoksa tarih ile ay çelişirdi.
  assert.equal(row['Orijinal Exfactory Merch Ay'], '2026-03');
  // Revize sütunu ondan FARKLI olmalı — eski hatada ikisi aynıydı.
  assert.notEqual(
    iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']),
    iso(row['Orijinal Exfactory Merch Tarih'])
  );
});

test('v6.35 üretim satırında revize sütunu CP revizyonundan geliyor', () => {
  const order = fixtureOrder();
  const [row] = buildRows([segmentFor(order, 'production')], order);
  assert.equal(iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-15');
});

test('v6.35 revizyon yoksa her iki sütun da ASAS tarihini veriyor', () => {
  const order = fixtureOrder();
  order.ex = D('2026-03-01');
  delete order._asasEx;
  const [row] = buildRows([segmentFor(order, 'production')], order);
  assert.equal(iso(row['Orijinal Exfactory Merch Tarih']), '2026-03-01');
  assert.equal(iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-01');
});

test('v6.35 parsiyel satırında revize sütunu ANTREPO handover tarihinden geliyor', () => {
  const order = fixtureOrder();
  const partial = segmentFor(order, 'ias', {
    _iasRow: { handover: D('2026-03-20'), arr: D('2026-04-10') },
    _arr: D('2026-04-10'),
  });
  const [row] = buildRows([partial], order);
  // Parsiyelin kendi yükleme tarihi; ne ASAS ne de CP revizyonu.
  assert.equal(iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-20');
  assert.equal(iso(row['Orijinal Exfactory Merch Tarih']), '2026-03-01');
});

test('v6.35 aynı siparişin parsiyeli ve üretim kalanı AYRI tarih alıyor', () => {
  const order = fixtureOrder();
  const partial = segmentFor(order, 'ias', {
    _iasRow: { handover: D('2026-03-20'), arr: D('2026-04-10') }, _arr: D('2026-04-10'),
  });
  const production = segmentFor(order, 'production');
  const rows = buildRows([partial, production], order);
  assert.equal(iso(rows[0]['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-20', 'parsiyel → ANTREPO');
  assert.equal(iso(rows[1]['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-15', 'üretim → CP revizyonu');
  // Orijinal ikisinde de aynı ve ASAS kaynaklı olmalı.
  assert.equal(iso(rows[0]['Orijinal Exfactory Merch Tarih']), '2026-03-01');
  assert.equal(iso(rows[1]['Orijinal Exfactory Merch Tarih']), '2026-03-01');
});

test('v6.35 handover boş parsiyelde sütun boş kalmıyor', () => {
  // Boş bırakmak "yükleme tarihi yok" izlenimi verirdi; siparişin geçerli
  // Ex-Factory tarihine düşülür.
  const order = fixtureOrder();
  const partial = segmentFor(order, 'ias', { _iasRow: { handover: null, arr: D('2026-04-10') }, _arr: D('2026-04-10') });
  const [row] = buildRows([partial], order);
  assert.equal(iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-15');
});

test('v6.35 eksik yükleme (shortage) satırı parsiyel sayılmıyor', () => {
  // Shortage bir parsiyel değil, üretim kalanının türevi: handover'a bakılmamalı.
  const order = fixtureOrder();
  const shortage = segmentFor(order, 'shortage', {
    _iasRow: { handover: D('2026-03-20') }, _status: 'Eksik Yükleme',
  });
  const [row] = buildRows([shortage], order);
  assert.equal(iso(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-03-15');
});

/* ------------------------------------------------- 2) LFL: SON KAYIT SİLİNMESİ */

test('v6.35 son karşılaştırma kaydı silinebiliyor', () => {
  const block = bodyOf(LFL, 'deleteComparisonScenario');
  // Eski koddaki "bir tane kaldıysa silme" freni kalkmalı.
  assert.doesNotMatch(block, /scenarios\.length<=1\)return/);
  assert.match(block, /scenariosSeeded=true/);
  // Silme düğmesi de artık koşulsuz etkin olmalı.
  assert.doesNotMatch(LFL, /data-scenario-delete[^`]*results\.length<=1\?' disabled'/);
});

test('v6.35 boşaltılan liste kendiliğinden yeniden dolmuyor', () => {
  const block = bodyOf(LFL, 'ensureComparisonScenarios');
  assert.match(block, /scenariosSeeded && !state\.customCompare\.scenarios\.length\) return state\.customCompare\.scenarios;/);
  // Bayrak kalıcı olmalı, yoksa sayfa yenilenince iki senaryo geri gelirdi.
  assert.match(LFL, /scenariosSeeded:state\.customCompare\.scenariosSeeded===true/);
  // Eski kayıtlar bayraksız; senaryo dizisi varsa tohumlanmış sayılmalı.
  assert.match(LFL, /if\(saved\.scenariosSeeded===true\|\|Array\.isArray\(saved\.scenarios\)\)state\.customCompare\.scenariosSeeded=true;/);
});

/* ------------------------------------------------------- 3) LFL: PANEL AYIRICI */

test('v6.35 analiz ızgarasında sürüklenebilir ayırıcı var', () => {
  assert.match(HTML, /id="lflAnalysisSplit"[^>]*role="separator"/);
  // Izgara üç sütunlu ve oran CSS değişkeninden geliyor olmalı.
  assert.match(LFL_CSS, /\.lflAnalysisGrid\{[^}]*var\(--lfl-split,1\.3fr\)[^}]*\}/);
  // Kartların birbirini uzatıp boşluk bırakması engellenmeli.
  assert.match(LFL_CSS, /\.lflAnalysisGrid\{[^}]*align-items:start;[^}]*\}/);
  // Dar ekranda ızgara tek sütuna düşerken ayırıcı gizlenmeli.
  assert.match(LFL_CSS, /\.lflSplitHandle\{display:none;\}/);
});

test('v6.35 ayırıcı oranı sınırlanıyor ve saklanıyor', () => {
  const clamp = new Function(`
    const ANALYSIS_SPLIT_MIN=0.25, ANALYSIS_SPLIT_MAX=0.8, ANALYSIS_SPLIT_DEFAULT=0.65;
    function clampAnalysisSplit(value){${bodyOf(LFL, 'clampAnalysisSplit')}}
    return clampAnalysisSplit;
  `)();
  assert.equal(clamp(0.5), 0.5);
  assert.equal(clamp(0.05), 0.25, 'alt sınırın altı kırpılmalı');
  assert.equal(clamp(0.99), 0.8, 'üst sınırın üstü kırpılmalı');
  // Bozuk değer varsayılana düşmeli; NaN bir ızgarayı çökertirdi.
  assert.equal(clamp('abc'), 0.65);
  assert.equal(clamp(null), 0.65);
  assert.match(LFL, /const ANALYSIS_SPLIT_KEY='lcw\.lfl\.analysisSplit\.v1';/);
  // Piksel değil ORAN saklanmalı; piksel pencere boyutu değişince bozulurdu.
  const apply = bodyOf(LFL, 'applyAnalysisSplit');
  assert.match(apply, /setProperty\('--lfl-split'/);
  assert.match(apply, /setProperty\('--lfl-split-right'/);
  assert.match(apply, /fr`\)/, 'oran fr birimiyle yazılmalı');
});

test('v6.35 ayırıcı klavyeyle de kullanılabiliyor ve bir kez bağlanıyor', () => {
  const block = bodyOf(LFL, 'initAnalysisSplitter');
  assert.match(block, /dataset\.splitBound==='1'\)return;/);
  assert.match(block, /ArrowLeft/);
  assert.match(block, /ArrowRight/);
  assert.match(block, /dblclick/);
});

/* --------------------------------- 4) FİYAT GEÇMİŞİ: ÜRETİCİ SÜTUN SIRALAMASI */

test('v6.35 kayıtlı üretici sırası hiçbir üreticiyi gizlemiyor', () => {
  const apply = new Function('BLStorage', `
    function qhLoadMfrOrder(){${bodyOf(QUOTES, 'qhLoadMfrOrder')}}
    function qhApplyMfrOrder(manufacturers){${bodyOf(QUOTES, 'qhApplyMfrOrder')}}
    const QH_MFR_ORDER_KEY='lcw.priceHistory.mfrOrder.v1';
    return qhApplyMfrOrder;
  `)({ getItem: () => JSON.stringify(['C', 'A']) });

  // Kayıtlı sıra C,A; veride ayrıca B ve D var. Bilinmeyenler SONA eklenmeli.
  assert.deepEqual(apply(['A', 'B', 'C', 'D']), ['C', 'A', 'B', 'D']);
  // Kayıtta olup veride olmayan üretici sessizce düşmeli.
  assert.deepEqual(apply(['A', 'B']), ['A', 'B']);
});

test('v6.35 kayıtlı sıra yoksa alfabetik sıra korunuyor', () => {
  const apply = new Function('BLStorage', `
    function qhLoadMfrOrder(){${bodyOf(QUOTES, 'qhLoadMfrOrder')}}
    function qhApplyMfrOrder(manufacturers){${bodyOf(QUOTES, 'qhApplyMfrOrder')}}
    const QH_MFR_ORDER_KEY='lcw.priceHistory.mfrOrder.v1';
    return qhApplyMfrOrder;
  `)({ getItem: () => null });
  assert.deepEqual(apply(['A', 'B', 'C']), ['A', 'B', 'C']);
});

test('v6.35 bozuk kayıt uygulamayı düşürmüyor', () => {
  const apply = new Function('BLStorage', `
    function qhLoadMfrOrder(){${bodyOf(QUOTES, 'qhLoadMfrOrder')}}
    function qhApplyMfrOrder(manufacturers){${bodyOf(QUOTES, 'qhApplyMfrOrder')}}
    const QH_MFR_ORDER_KEY='lcw.priceHistory.mfrOrder.v1';
    return qhApplyMfrOrder;
  `)({ getItem: () => '{bozuk' });
  assert.deepEqual(apply(['A', 'B']), ['A', 'B']);
});

test('v6.35 üretici başlıkları sürüklenebilir ve dinleyiciler delege edilmiş', () => {
  // paintHead() her çizimde başlıkları yeniden kurar; başlığa DOĞRUDAN bağlanan
  // dinleyici ilk yeniden çizimde kopardı, bu yüzden thead'e delege edilmeli.
  assert.match(QUOTES, /class="isNum qhMfrHead"/);
  assert.match(QUOTES, /draggable="true"/);
  assert.match(QUOTES, /thead\?\.addEventListener\('dragstart'/);
  assert.match(QUOTES, /thead\?\.addEventListener\('drop'/);
  assert.match(QUOTES, /thead\?\.addEventListener\('dragend'/);
});

test('v6.35 sütun taşıma sırayı gerçekten değiştirip kaydediyor', () => {
  const saved = [];
  const move = new Function('manufacturers', 'qhSaveMfrOrder', `
    function qhMoveManufacturer(from,to){${bodyOf(QUOTES, 'qhMoveManufacturer')}}
    return qhMoveManufacturer;
  `);
  const list = ['A', 'B', 'C', 'D'];
  const fn = move(list, (next) => saved.push([...next]));
  assert.equal(fn('D', 'B'), true);
  assert.deepEqual(list, ['A', 'D', 'B', 'C']);
  assert.deepEqual(saved.at(-1), ['A', 'D', 'B', 'C'], 'yeni sıra saklanmalı');
  // Kendi üstüne bırakmak ve bilinmeyen ad işlem üretmemeli.
  assert.equal(fn('A', 'A'), false);
  assert.equal(fn('X', 'A'), false);
  assert.equal(saved.length, 1);
});
