'use strict';
/*
 * v4.28 — Koleksiyon'da TR / Yurt Dışı landed karşılaştırması ve kâr oranı.
 *
 *   TR Landed = TR Fiyat (TL) ÷ Kur × TR landed çarpanı (varsayılan 1,05)
 *   YD Landed = Supp. FOB × YD landed çarpanı (varsayılan 1,11)
 *   Kâr       = (TR Landed − YD Landed) ÷ TR Landed
 *
 * Supp. FOB önceliği: Confirmed → Best → Target.
 * Kur Ex-Factory ayından otomatik gelir; kur ve çarpanlar elle ezilebilir.
 * Ayrı sütun açılmaz: her hücre sonucu, girdileri ve kaynağı birlikte taşır.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf-8');

function grab(name) {
  const re = new RegExp(`function ${name}\\((?:[^)]*)\\)\\{[\\s\\S]*?\\n\\}`, 'm');
  const m = HTML.match(re);
  assert.ok(m, `${name} bulunamadı`);
  return m[0];
}

// Hesap fonksiyonlarını bağımlılıklarını taklit ederek yükle.
function loadCalc(fxRate) {
  const kolParseMoneyNum = v => {
    if (v === '' || v == null) return NaN;
    const n = Number(String(v).replace(/\s/g, '').replace('%', '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const kolConfirmedPricing = row => {
    const name = String(row.confirmedManufacturer || '').trim();
    if (!name || !row.pricing) return null;
    const price = kolParseMoneyNum(row.pricing[name]);
    return Number.isFinite(price) && price > 0 ? { name, price } : null;
  };
  const kolBestPricing = row => {
    let best = null;
    Object.entries(row.pricing || {}).forEach(([name, v]) => {
      const n = kolParseMoneyNum(v);
      if (Number.isFinite(n) && n > 0 && (!best || n < best.price)) best = { name, price: n };
    });
    return best;
  };
  const src = [
    grab('kolSuppFob'),
    grab('kolLandedIsNonDtr'),
    grab('kolLandedPriceWithCosts'),
    grab('kolLandedPriceWithRule'),
    grab('kolLandedCalc')
  ].join('\n') + '\nreturn {kolSuppFob, kolLandedIsNonDtr, kolLandedPriceWithCosts, kolLandedPriceWithRule, kolLandedCalc};';
  /* v7.81 — kolLandedPriceWithCosts artik kolLicenseRuleMissing'e bagli
     (Non-DTR + esleşen kural yoksa hesap durur). Bu dosyanin isi FORMULU
     dogrulamak, kural-eksik davranisini degil (o license-royalty-missing-
     warning-v781.test.js'te) -- stub hep 'kural var' dondurur, satirdaki
     royalty degeri eskisi gibi kullanilir. */
  const trRuleForRow = row => {
    const licensor=String(row&&row.licensor||'').trim().toUpperCase();
    if(!licensor||licensor==='DTR') return null;
    const royalty=kolParseMoneyNum(row&&row.royalty);
    const hologramCost=kolParseMoneyNum(row&&row.hologramCost);
    return {
      countryGroup:'TR',
      royalty:Number.isFinite(royalty)?royalty:0,
      hologramCost:Number.isFinite(hologramCost)?hologramCost:0,
    };
  };
  return new Function('kolParseMoneyNum', 'kolConfirmedPricing', 'kolBestPricing', 'kolAutoFx',
    'turknorm', 'KOL_TR_LANDED_MULT', 'KOL_YD_LANDED_MULT', 'kolLicenseRuleMissing',
    'kolFindPricingRuleForCountryGroup','kolTrLicenseRuleMissing', src)(
    kolParseMoneyNum, kolConfirmedPricing, kolBestPricing, () => fxRate,
    value => String(value == null ? '' : value).trim().toUpperCase(),
    1.05, 1.11, () => false, (row,group)=>group==='TR'?trRuleForRow(row):null, () => false);
}

const row = extra => Object.assign({
  exFactory: '2026-08-01', targetPrice: '', pricing: {}, confirmedManufacturer: '',
  trPrice: '', trLandedMult: '', trFx: '', ydLandedMult: '',
}, extra || {});

// ---------------------------------------------------------------------------
// Supp. FOB önceliği
// ---------------------------------------------------------------------------

test('önce Confirmed fiyat kullanılır', () => {
  const { kolSuppFob } = loadCalc(40);
  const r = row({ pricing: { A: '5.00', B: '4.00' }, confirmedManufacturer: 'A', targetPrice: '3.00' });
  assert.deepStrictEqual(kolSuppFob(r), { price: 5, source: 'confirmed', name: 'A' });
});

test('Confirmed yoksa en iyi (en düşük) fiyat', () => {
  const { kolSuppFob } = loadCalc(40);
  const r = row({ pricing: { A: '5.00', B: '4.00' }, targetPrice: '3.00' });
  assert.deepStrictEqual(kolSuppFob(r), { price: 4, source: 'best', name: 'B' });
});

test('hiç fiyat yoksa Target Price', () => {
  const { kolSuppFob } = loadCalc(40);
  assert.deepStrictEqual(kolSuppFob(row({ targetPrice: '3.00' })), { price: 3, source: 'target', name: '' });
});

test('hiçbiri yoksa boş döner', () => {
  const { kolSuppFob } = loadCalc(40);
  assert.strictEqual(kolSuppFob(row()), null);
});

// ---------------------------------------------------------------------------
// Landed ve kâr
// ---------------------------------------------------------------------------

test('TR landed = TL ÷ kur × çarpan', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ trPrice: '440' }));
  // 440 ÷ 40 = 11 USD; × 1,05 = 11,55
  assert.strictEqual(Number(k.trLanded.toFixed(4)), 11.55);
  assert.strictEqual(k.trMult, 1.05);
  assert.strictEqual(k.fx, 40);
  assert.strictEqual(k.fxIsManual, false);
});

test('YD landed = Supp. FOB × çarpan', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ pricing: { A: '10.00' } }));
  assert.strictEqual(Number(k.ydLanded.toFixed(4)), 11.1);
  assert.strictEqual(k.ydMult, 1.11);
});

test('Non-DTR landed fiyatları royalty bölme formülü ve hologram maliyetini uygular', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({
    licensor: 'FASHION UK',
    pricing: { A: '1.00' },
    royalty: '25%',
    hologramCost: '0,05',
    ydLandedMult: '1',
    trPrice: '100',
    trFx: '40',
    trLandedMult: '1',
  }));
  assert.strictEqual(Number(k.ydCostedFob.toFixed(4)), 1.3833, '($1 ÷ 0,75) + $0,05 olmalı');
  assert.strictEqual(Number(k.ydLanded.toFixed(4)), 1.3833);
  assert.strictEqual(Number(k.trBaseUsd.toFixed(4)), 2.50);
  assert.strictEqual(Number(k.trCostedUsd.toFixed(4)), 3.3833);
  assert.strictEqual(Number(k.trLanded.toFixed(4)), 3.3833);
  assert.strictEqual(k.nonDtr, true);
});

test('DTR landed fiyatlarında royalty ve hologram tekrar eklenmez', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({
    licensor: 'DTR',
    pricing: { A: '1.00' },
    royalty: '25%',
    hologramCost: '0,05',
    ydLandedMult: '1',
    trPrice: '100',
    trFx: '40',
    trLandedMult: '1',
  }));
  assert.strictEqual(k.ydLanded, 1);
  assert.strictEqual(k.trLanded, 2.5);
  assert.strictEqual(k.nonDtr, false);
});

test('kâr oranı TR landed üzerinden hesaplanır', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ trPrice: '440', pricing: { A: '10.00' } }));
  // (11,55 − 11,10) ÷ 11,55 = %3,896…
  assert.strictEqual(Number(k.profitPct.toFixed(2)), 3.90);
});

test('yurt dışı pahalıysa kâr negatiftir', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ trPrice: '400', pricing: { A: '12.00' } }));
  assert.ok(k.profitPct < 0);
});

test('elle girilen kur ve çarpanlar otomatiği ezer', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ trPrice: '440', trFx: '44', trLandedMult: '1,10', ydLandedMult: '1,20', pricing: { A: '10.00' } }));
  assert.strictEqual(k.fx, 44);
  assert.strictEqual(k.fxIsManual, true);
  assert.strictEqual(k.trMult, 1.1);
  assert.strictEqual(Number(k.trLanded.toFixed(4)), 11);
  assert.strictEqual(Number(k.ydLanded.toFixed(4)), 12);
});

test('kur bulunamazsa TR landed boş kalır, YD landed etkilenmez', () => {
  const { kolLandedCalc } = loadCalc(null);
  const k = kolLandedCalc(row({ trPrice: '440', pricing: { A: '10.00' } }));
  assert.strictEqual(k.trLanded, null);
  assert.strictEqual(k.profitPct, null);
  assert.strictEqual(Number(k.ydLanded.toFixed(2)), 11.1);
});

test('sıfır ve geçersiz değerler varsayılana düşer', () => {
  const { kolLandedCalc } = loadCalc(40);
  const k = kolLandedCalc(row({ trPrice: '440', trLandedMult: '0', trFx: 'abc', ydLandedMult: '-1', pricing: { A: '10.00' } }));
  assert.strictEqual(k.trMult, 1.05, 'sıfır çarpan varsayılana dönmeli');
  assert.strictEqual(k.fx, 40, 'geçersiz kur otomatiğe dönmeli');
  assert.strictEqual(k.ydMult, 1.11);
});

// ---------------------------------------------------------------------------
// Arayüz
// ---------------------------------------------------------------------------

test('iki sütun eklendi, fazladan sütun açılmadı', () => {
  const cols = HTML.slice(HTML.indexOf('const KOL_COLS = ['), HTML.indexOf('let kolCustomCols'));
  assert.ok(cols.includes("k:'trLanded'"), 'TR landed sütunu olmalı');
  assert.ok(cols.includes("k:'ydLanded'"), 'YD landed sütunu olmalı');
  for (const key of ['trPrice', 'trLandedMult', 'trFx', 'ydLandedMult']) {
    assert.ok(!cols.includes(`k:'${key}'`), `${key} için ayrı sütun açılmamalı`);
  }
});

test('girdiler hücrenin içinde ve kaydediliyor', () => {
  for (const key of ['trPrice', 'trLandedMult', 'trFx', 'ydLandedMult']) {
    assert.ok(HTML.includes(`data-k="${key}"`), `${key} hücre içinde düzenlenebilmeli`);
  }
  // editCell sınıfı, Koleksiyon'un ortak kaydetme yolunu tetikler.
  assert.ok(HTML.includes('class="editCell kolLandedInput"'), 'girdiler ortak kaydetme yolunu kullanmalı');
  const migrate = grab('migrateKolRow');
  for (const key of ['trPrice', 'trLandedMult', 'trFx', 'ydLandedMult']) {
    assert.ok(migrate.includes(`r.${key}`), `${key} satır göçünde tanımlanmalı`);
  }
});

test('kullanılan Supp. FOB kaynağı hücre içinde gösterilmiyor', () => {
  assert.ok(!HTML.includes('kolSuppSrc'), 'Overseas FOB kaynak rozeti görünmemeli');
  assert.ok(!CSS.includes('kolSuppSrc'), 'kaynak rozeti stilleri kaldırılmalı');
  assert.ok(HTML.includes('class="kolProfit'), 'Overseas fiyat avantajı yüzdesi hücrede gösterilmeli');
});

/*
 * v4.29: sütun sırası ve satır yüksekliği.
 * Hücre içeriği alt alta dizildiğinde tablodaki BÜTÜN satırlar yükseliyordu;
 * artık tek satırda yan yana durur.
 */
test('sütun sırası Overseas Landed → TR Landed ve ikisi tablonun en sağında', () => {
  const cols = HTML.slice(HTML.indexOf('const KOL_COLS = ['), HTML.indexOf('let kolCustomCols'));
  const at = key => cols.indexOf(`k:'${key}'`);
  assert.ok(at('not') < at('ydLanded'), 'Overseas Landed normal alanların sağında olmalı');
  assert.ok(at('ydLanded') < at('trLanded'), 'TR Landed, Overseas Landed\'in sağında olmalı');
  const afterTr = cols.slice(at('trLanded')).replace(/^[\s\S]*?\},/, '');
  assert.ok(!/\{k:'/.test(afterTr), 'TR Landed sonrasında başka Koleksiyon sütunu olmamalı');
});

test('v5.62 landed hücreleri Endeksmatik ile aynı minimum yükseklikte kompakt kart kullanıyor', () => {
  assert.ok(HTML.includes('kolLandedCard'), 'Landed kart kapsayıcısı kullanılmalı');
  assert.ok(/\.kolLandedCard\{[\s\S]*?min-height:38px/.test(CSS), 'kart Endeksmatik gibi minimum 38px yüksekliğinde olmalı');
  assert.ok(/\.kolLandedCard\{[\s\S]*?border-radius:9px/.test(CSS), 'Endeksmatik ile uyumlu kart köşe yapısı kullanılmalı');
  assert.ok(/\.kolLandedTd\{padding:3px 5px/.test(CSS), 'hücre dolgusu Endeksmatik yüksekliğiyle uyumlu olmalı');
  assert.ok(/\.kolLandedCard\{[\s\S]*?display:flex/.test(CSS), 'kalan veriler aynı satırda hizalanmalı');
});

/*
 * v4.30 — üç düzeltme:
 *  1) Landed alanları yeniden çizimi tetiklemiyordu: değer kaydediliyor ama
 *     hesaplanan hücreler eski değerde kalıyordu, yani yazmak "hiçbir şey
 *     değiştirmiyor" gibi görünüyordu.
 *  2) Girdiler kutu gibi duruyordu; artık yalnız değer görünür, tıklanınca
 *     düzenleme kenarlığı belirir.
 *  3) Kârlılık yüzdesi, yurt dışı fiyatının hemen SOLUNDA.
 */
test('landed alanı değişince satır yeniden çizilir', () => {
  const commit = HTML.slice(HTML.indexOf('function commitKolEditor'), HTML.indexOf('function commitKolPriceEditor'));
  const rerenderLine = commit.split('\n').find(l => l.includes("k==='trPrice'"));
  assert.ok(rerenderLine, 'landed alanları için yeniden çizim dalı olmalı');
  for (const key of ['trPrice', 'trLandedMult', 'trFx', 'ydLandedMult']) {
    assert.ok(rerenderLine.includes(`k==='${key}'`), `${key} yeniden çizim tetiklemeli`);
  }
  assert.ok(rerenderLine.includes('needsRerender=true'), 'yeniden çizim işaretlenmeli');
});

test('girdiler kutu gibi durmuyor, tıklanınca düzenleniyor', () => {
  const input = CSS.match(/input\.kolLandedInput\{[^}]*\}/)[0];
  assert.ok(/border:1px solid transparent/.test(input), 'kenarlık normalde görünmemeli');
  assert.ok(/background:transparent/.test(input), 'kutu zemini olmamalı');
  assert.ok(/input\.kolLandedInput:focus\{[\s\S]*?border-color:var\(--acc/.test(CSS),
    'tıklanınca düzenleme kenarlığı belirmeli');
});

test('Landed hücreleri Overseas fiyat avantajını gösterir, tekrar eden çarpan rozetlerini göstermez', () => {
  const cell = HTML.slice(HTML.indexOf("}else if(c.ydLanded){"), HTML.indexOf("}else if(c.buyingSample){"));
  const trCell = HTML.slice(HTML.indexOf("}else if(c.trLanded){"), HTML.indexOf("}else if(c.ydLanded){"));
  assert.ok(cell.includes('kolLandedVal'), 'Overseas ana landed fiyatı görünmeli');
  assert.ok(trCell.includes('kolLandedVal'), 'TR ana landed fiyatı görünmeli');
  assert.ok(cell.includes('kolProfit'), 'Overseas fiyat avantajı yüzdesi gösterilmeli');
  assert.ok(!cell.includes('kolLandedMiniMult'), 'Overseas tekrar çarpan etiketi kaldırılmalı');
  assert.ok(!trCell.includes('kolLandedBadge'), 'TR tekrar çarpan rozeti kaldırılmalı');
});
