'use strict';
/*
 * v4.25 — Nakliye Kıyaslama karar kartları ve toplam USD etkisi.
 *
 * Sayfanın asıl sorusu tek: TR'de mi ürettirmeli, yoksa yurtdışında üretip
 * Gemi / Gemi+Uçak / Uçak ile mi getirmeli? Bu karşılaştırma 47 sütunluk tabloda
 * üç ayrı avantaj sütunu ve üç ayrı teslim tarihi olarak dağılmıştı.
 *
 * Ayrıca avantaj sütunları yalnız BİRİM yüzdesi veriyordu; karar toplam paraya
 * bakar. Toplam etki = (YD landed − domestic landed) × Adet.
 *
 * v9.18 — KARŞILAŞTIRMA TABANI DOMESTIC LANDED OLDU (kullanıcı kararı).
 * Eskiden YD LANDED, domestic FOB ile kıyaslanıyordu; yani masrafı eklenmiş bir
 * fiyat masrafsız bir fiyatla. Elma-elma karşılaştırma landed-landed olandır.
 * Çarpanlar da sabit değil, Landed Multipliers ayarından gelir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf-8'));
const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'public', 'shipping-engine.js'), 'utf-8');
const BLShippingEngine = require('../public/shipping-engine');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf-8');

// computeShipFormulas'ı bağımlılıklarıyla birlikte izole çalıştır.
function loadCompute(transitDays, multipliers) {
  const match = HTML.match(/function computeShipFormulas\(row\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'computeShipFormulas bulunamadı');
  // Çarpanlar uygulama ayarından gelir; izole koşumda enjekte edilir.
  const shipLandedMultipliers = () => multipliers || { tr: 1.05, overseas: 1.11 };
  const shipTransitDays = () => transitDays || { Gemi: 75, 'Gemi+Uçak': 45, 'Uçak': 15, _source: {} };
  const coerceDateLoose = value => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };
  const toNum = value => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const toISODate = d => {
    const p = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  return new Function('BLShippingEngine', 'coerceDateLoose', 'toNum', 'toISODate', 'shipTransitDays', 'shipLandedMultipliers', `return (${match[0]})`)(BLShippingEngine, coerceDateLoose, toNum, toISODate, shipTransitDays, shipLandedMultipliers);
}

function shipRow(extra) {
  return Object.assign({
    exFactory: '2026-08-01', opd: '2026-05-01',
    quantity: 1000, fob: 10, kur: 40, trFiyatTl: 440,   // TR USD = 11
    ydFiyatUsdLandedGemiUcak: 12, ydFiyatUsdLandedUcak: 14,
  }, extra || {});
}

test('birim hesapları ve landed taban', () => {
  const row = loadCompute()(shipRow());
  assert.strictEqual(row.trFiyatUsd, 11);
  // Domestic LANDED artık karşılaştırmanın tabanıdır: 11 × 1,05.
  assert.strictEqual(Number(row.trFiyatFobUsdLanded.toFixed(2)), 11.55);
  assert.strictEqual(Number(row.ydFiyatUsdLandedGemi.toFixed(2)), 11.1);
  assert.strictEqual(row.leadTime, 92);
  // Avantaj landed-landed: 11,10 / 11,55 − 1 = −%3,9 (eskiden FOB'a göre +%0,9).
  assert.strictEqual(Number((row.gemiAvantaj * 100).toFixed(1)), -3.9);
});

test('çarpanlar ayardan geliyor, sabit değil', () => {
  // Landed Multipliers değiştirildiğinde hem taban hem YD landed kaymalı.
  const row = loadCompute(null, { tr: 1.10, overseas: 1.20 })(shipRow());
  assert.strictEqual(Number(row.trFiyatFobUsdLanded.toFixed(2)), 12.1);   // 11 × 1,10
  assert.strictEqual(Number(row.ydFiyatUsdLandedGemi.toFixed(2)), 12);    // 10 × 1,20
  assert.strictEqual(Number((row.gemiAvantaj * 100).toFixed(1)), -0.8);   // 12 / 12,10 − 1
});

test('toplam etki adet ile çarpılır (taban: domestic landed)', () => {
  /* Bu alanlar v9.18'den beri EKRANDA gösterilmiyor (kullanıcı toplam USD
     farkına ihtiyaç duymuyor) ama hesap yerinde: ucuz, sınanmış ve tabanı
     avantajla aynı kalmalı. Ayrışırlarsa aynı satır iki farklı hikâye anlatır. */
  const row = loadCompute()(shipRow());
  // Taban 11,55 (11 × 1,05). Gemi: (11,10 − 11,55) × 1000 = −450 → yurtdışı ucuz
  assert.strictEqual(Math.round(row._totalGemi), -450);
  // Gemi+Uçak: (12 − 11,55) × 1000 = +450
  assert.strictEqual(Math.round(row._totalGemiUcak), 450);
  // Uçak: (14 − 11,55) × 1000 = +2450
  assert.strictEqual(Math.round(row._totalUcak), 2450);
  // Domestic landed toplamı: 11,55 × 1000
  assert.strictEqual(Math.round(row._totalTr), 11550);
});

test('yurtdışı ucuzsa toplam etki negatiftir', () => {
  const row = loadCompute()(shipRow({ trFiyatTl: 600 })); // TR USD = 15 → landed 15,75
  assert.ok(row._totalGemi < 0, 'gemi domestic landed\'den ucuzsa negatif olmalı');
  assert.strictEqual(Math.round(row._totalGemi), -4650); // (11,10 − 15,75) × 1000
});

test('eksik veri toplamı bozmaz, null döner', () => {
  const compute = loadCompute();
  assert.strictEqual(compute(shipRow({ quantity: '' }))._totalGemi, null);
  assert.strictEqual(compute(shipRow({ trFiyatTl: '' }))._totalGemi, null);
  assert.strictEqual(compute(shipRow({ ydFiyatUsdLandedUcak: '' }))._totalUcak, null);
});

test('toplam alanları tabloya ve Excel şablonuna sızmaz', () => {
  // Alt çizgiyle başlayan iç alanlar SHIP_COLS ve SHIP_EXCEL_HEADERS dışındadır.
  const cols = HTML.slice(HTML.indexOf('const SHIP_COLS = ['), HTML.indexOf('const CP_COLS = ['));
  const excel = HTML.slice(HTML.indexOf('const SHIP_EXCEL_HEADERS = ['), HTML.indexOf('const SHIP_EXCEL_DATE_KEYS'));
  for (const key of ['_totalGemi', '_totalGemiUcak', '_totalUcak', '_totalTr']) {
    assert.ok(!cols.includes(key), `${key} tabloya girmemeli`);
    assert.ok(!excel.includes(key), `${key} Excel şablonuna girmemeli`);
  }
});

test('nakliye süreleri Transfer Lead Times kurallarından çözülür', () => {
  assert.match(HTML, /return BLShippingEngine\.transitDays\(row,resolveTransitDaysForValues\)/);
  const resolver = ENGINE.match(/function transitDays\(row,resolveTransitDaysForValues\)\{[\s\S]*?\n\}/);
  assert.ok(resolver, 'shipTransitDays bulunamadı');
  assert.ok(resolver[0].includes('resolveTransitDaysForValues'), 'merkezi kural tablosuna sorulmalı');
  assert.ok(resolver[0].includes('forceRules'), 'karşılaştırma sayfasında durum kural aramasını engellememeli');
  // Sıra: kural → snapshot → sabit
  assert.ok(resolver[0].indexOf("source='rule'") < resolver[0].indexOf("source='snapshot'"),
    'önce merkezi kural, sonra snapshot denenmeli');
  assert.ok(resolver[0].includes('SHIP_TRANSIT_FALLBACK'), 'son çare sabitler olmalı');
});

test('teslim tarihleri çözülen transit günlerini kullanır', () => {
  const compute = loadCompute({ Gemi: 60, 'Gemi+Uçak': 30, 'Uçak': 10, _source: {} });
  const row = compute(shipRow());
  assert.strictEqual(row.retailTrWithVessel, '2026-09-30');   // 01.08 + 60
  assert.strictEqual(row.gemiUcakAntrepoTeslim, '2026-08-31'); // 01.08 + 30
  assert.strictEqual(row.ucakAntrepoTeslim, '2026-08-11');     // 01.08 + 10
});

test('ürün sütunu istenen alanları gösteriyor', () => {
  const card = HTML.match(/function shipModelCard\(row\)\{[\s\S]*?\n\}/);
  assert.ok(card, 'shipModelCard bulunamadı');
  for (const field of ['row.season', 'row.country', 'row.supplier', 'row.category', 'row.colorCode', 'row.quantity', 'row.retailDate']) {
    assert.ok(card[0].includes(field), `${field} model kartında olmalı`);
  }
  assert.ok(card[0].includes("shipCardInput(row,'exFactory'"), 'Ex-Factory kartta girilebilmeli');
});

test('elle girilen fiyatlar kendi kartında düzenleniyor', () => {
  const opts = HTML.match(/function shipDecisionOptions\(row\)\{[\s\S]*?\n\}/);
  assert.ok(opts[0].includes("key:'trFiyatTl'"), 'TR fiyatı Domestic kartında olmalı');
  assert.ok(opts[0].includes("key:'kur'"), 'kur da Domestic kartında olmalı');
  assert.ok(opts[0].includes("key:'ydFiyatUsdLandedGemiUcak'"), 'Gemi+Uçak fiyatı kendi kartında olmalı');
  assert.ok(opts[0].includes("key:'ydFiyatUsdLandedUcak'"), 'Uçak fiyatı kendi kartında olmalı');
});

test('kart listesi tüm modelleri alt alta çiziyor', () => {
  const render = HTML.slice(HTML.indexOf('function renderShipDecision()'), HTML.indexOf('function renderShipTable()'));
  // v(satır yönetimi): tek liste değil, kalıcı sıra + gizleme uygulanmış görünür
  // satırlar listelenir (bkz. shipVisibleRows/shipOrderedRows).
  assert.ok(render.includes('visibleRows.map(row=>'), 'tek model değil, görünür tüm satırlar listelenmeli');
  assert.ok(render.includes('shipVisibleRows()'), 'gizli satırlar kart tablosundan filtrelenmeli');
  assert.ok(render.includes('shipModelCard(row)') && render.includes('shipCompareCards(row)'),
    'her satırda model kartı ve karşılaştırma kartları olmalı');
});

test('karttaki giriş tabloyla aynı yola yazıyor', () => {
  const render = HTML.slice(HTML.indexOf('function renderShipDecision()'), HTML.indexOf('function renderShipTable()'));
  assert.ok(render.includes('commitShipEditor(inp'), 'kart girişi tablo ile aynı commit yolunu kullanmalı');
});

test('beş sütun istenen sırada üretiliyor', () => {
  const match = HTML.match(/function shipDecisionOptions\(row\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'shipDecisionOptions bulunamadı');
  const expected = ["key:'fob'", "key:'tr'", "key:'gemi'", "key:'gemiUcak'", "key:'ucak'"];
  expected.forEach(key => assert.ok(match[0].includes(key), `${key} kartı olmalı`));
  const positions = expected.map(key => match[0].indexOf(key));
  assert.deepStrictEqual([...positions].sort((a,b)=>a-b), positions, 'kart sırası FOB / Domestic / SEA / SEA+AIR / AIR olmalı');
  /* v9.18: ilk iki sütun FİYAT (priceOnly), son üçü AVANTAJ sütunudur.
     Adlar sütun başlığında yazıldığı için seçenek adı da sadeleşti. */
  assert.ok(match[0].includes("name:tr?'Overseas FOB':'Overseas FOB'"));
  assert.ok(match[0].includes("name:tr?'Domestic Landed':'Domestic Landed'"));
  // v9.20: kısaltılmış adlar açıldı — "SEA" tek başına neyin ölçüldüğünü
  // söylemiyordu; sütunda duran değer LANDED fiyattır.
  for (const label of ["name:'SEA Landed'", "name:'SEA+AIR Landed'", "name:'AIR Landed'"]) {
    assert.ok(match[0].includes(label), `${label} olmalı`);
  }
  assert.ok(match[0].includes('source:true') && match[0].includes('decision:false'), 'ham FOB karar alternatifi sayılmamalı');
  assert.ok(match[0].includes('baseline:true'), 'Domestic Landed taban olmalı');
  // Nakliye sütunları antrepo tarihini ve transit gününü taşımalı.
  assert.ok(match[0].includes('date:row.retailTrWithVessel') && match[0].includes("transit:days['Gemi']"));
  assert.ok(match[0].includes('date:row.gemiUcakAntrepoTeslim') && match[0].includes("transit:days['Gemi+Uçak']"));
  assert.ok(match[0].includes('date:row.ucakAntrepoTeslim') && match[0].includes("transit:days['Uçak']"));
});

test('en ucuz ve en erken hâlâ hesaplanıyor ama rozet olarak basılmıyor', () => {
  /* v(satır yönetimi): "Cheapest"/"Earliest" rozetleri Sea/Sea+AIR/Air'de
     kaldırıldı — kullanıcı kararı artık fiyatı doğrudan (Overseas FOB ile aynı
     görsel ağırlıkta) okuyarak verir. Hesap SİLİNMEDİ: shipComparisonClipboardRows
     hâlâ cheapest/earliest'i dışa aktarır, yalnız kart görünümünde basılmaz. */
  const state = HTML.match(/function shipDecisionState\(row\)\{[\s\S]*?\n\}/)[0];
  const badges = HTML.match(/function shipDecisionBadges\(option,state,tr\)\{[\s\S]*?\n\}/)[0];
  assert.ok(state.includes('const cheapest='), 'en ucuz hâlâ seçilmeli (kopyalama kullanıyor)');
  assert.ok(state.includes('const earliest='), 'en erken hâlâ seçilmeli (kopyalama kullanıyor)');
  assert.ok(!badges.includes('isCheap') && !badges.includes('isFast'), 'kart rozetlerinde artık basılmamalı');
});

test('kartlar yalnız izin verilen alanları düzenletiyor', () => {
  const opts = HTML.match(/function shipDecisionOptions\(row\)\{[\s\S]*?\n\}/)[0];
  const card = HTML.match(/function shipModelCard\(row\)\{[\s\S]*?\n\}/)[0];
  const editable = [...(opts + card).matchAll(/key:'([A-Za-z]+)'/g)].map(m => m[1])
    .concat([...(opts + card).matchAll(/shipCardInput\(row,'([A-Za-z]+)'/g)].map(m => m[1]));
  const allowed = new Set(['fob', 'tr', 'gemi', 'gemiUcak', 'ucak', 'trFiyatTl', 'kur', 'ydFiyatUsdLandedGemiUcak', 'ydFiyatUsdLandedUcak', 'exFactory']);
  editable.forEach(k => assert.ok(allowed.has(k), `${k} kartta düzenlenebilir olmamalı`));
  assert.ok(!(opts + card).includes('nihaiVasitaKarar'), 'nihai karar elle, tabloda girilmeye devam etmeli');
});

test('kart girişleri yazarken formülleri canlı önizler ve blur/change ile kaydeder', () => {
  const render = HTML.slice(HTML.indexOf('function renderShipDecision()'), HTML.indexOf('function renderShipTable()'));
  assert.ok(render.includes("addEventListener('input',()=>previewShipCardInput(inp))"), 'input sırasında canlı formül önizlemesi olmalı');
  assert.ok(render.includes("addEventListener('change',commit)"), 'change kaydı olmalı');
  assert.ok(render.includes("addEventListener('blur',commit)"), 'blur güvenlik kaydı olmalı');
  const preview = HTML.match(/function previewShipCardInput\(inp\)\{[\s\S]*?\n\}/)[0];
  assert.ok(preview.includes('const preview={...row,[key]:parsed.value}'), 'önizleme gerçek satırı değiştirmeden kopya üzerinde hesaplanmalı');
  assert.ok(preview.includes('computeShipFormulas(preview)'), 'formüller canlı yeniden hesaplanmalı');
  assert.ok(preview.includes('[data-ship-unit]') && preview.includes('[data-ship-total]') && preview.includes('[data-ship-date]'), 'kart sonuç alanları yerinde güncellenmeli');
});

test('kart girişi genel hücre kayıt güvenlik ağına dahildir', () => {
  const managed = HTML.match(/function managedEditorSnapshot\(el\)\{[\s\S]*?\n\}/)[0];
  assert.ok(managed.includes("editor.classList.contains('shipCardInput')"), 'kart inputu sekme/buton geçişlerinde de kaydedilmeli');
});

test('kart sayı ayrıştırması Türkçe ve İngilizce biçimleri kabul eder', () => {
  const fn = HTML.match(/function shipParseEditorValue\(inp,col\)\{[\s\S]*?\n\}/)[0];
  // v6.52 sonrası: ondalık ayırıcı belirsizliği çözümü normalizeDecimalText'e taşındı
  // (tableNumericValue/endeksmatikNumber/kolImportNumber ile paylaşılan tek kaynak).
  const normalizeFn = HTML.match(/function normalizeDecimalText\(text\)\{[\s\S]*?\n\}/)[0];
  const parse = new Function('shipRoundHalfUp2', `${normalizeFn}; return (${fn})`)(n => Math.round(Number(n)*100)/100);
  assert.deepStrictEqual(parse({value:'1.234,50'},{type:'manual-num',k:'trFiyatTl'}), {ok:true,value:1234.5});
  assert.deepStrictEqual(parse({value:'1,25'},{type:'manual-num',k:'kur'}), {ok:true,value:1.25});
  assert.strictEqual(parse({value:'abc'},{type:'manual-num',k:'kur'}).ok, false);
});

test('kart ve rozet stilleri tanımlı', () => {
  // v9.17: .shipModelCard ve .shipCards kaldırıldı (kart öbeği yok artık);
  // yerlerine tablo kabuğu .shipCompare ve model hücreleri geldi.
  // v9.18: model detayları tek sütunda toplandı (.shipCellProduct) ve görsel
  // sütunu eklendi; ayrı Transit sütunu kaldırıldı.
  // v(satır yönetimi): .shipCardPct ve .shipBadge.isCheap/.isFast artık hiçbir
  // markup tarafından üretilmediği için CSS'ten de kaldırıldı (ölü kural
  // bırakılmadı). Yerlerine sürükleme ve çift-tık-düzenleme sınıfları geldi.
  for (const cls of ['.shipRowCards', '.shipCompare', '.shipCellImage', '.shipThumb', '.shipCellProduct', '.shipCellDates', '.shipCard', '.shipCardPrice', '.shipCardInput', '.shipBadge.isSource', '.shipCardMetrics', '.shipCardInputs', '.isPriceEditable', '.isDragging']) {
    assert.ok(CSS.includes(cls), `${cls} tanımlı olmalı`);
  }
  assert.ok(!CSS.includes('.shipCardPct'), '.shipCardPct artık kullanılmıyor, ölü kural CSS\'te kalmamalı');
  assert.ok(!CSS.includes('.shipBadge.isCheap') && !CSS.includes('.shipBadge.isFast'), 'Cheapest/Earliest rozet kuralı kalmamalı');
});

test('v9.17 beş fiyat aynı satırda, sabit sırayla ve hizalı sütunlarda', () => {
  /* v4.59 beş fiyatı yatay bir KART şeridine dizmişti. Karşılaştırma ancak
     değerler aynı sütunda alt alta hizalanınca gözle yapılabildiği için
     v9.17 bunu gerçek tablo sütunlarına çevirdi. Sıra aynı kaldı. */
  const head = HTML.match(/function shipCompareHeadCells\(\)\{[\s\S]*?\n\}/);
  assert.ok(head, 'shipCompareHeadCells bulunamadı');
  const order = ["key:'fob'", "key:'tr'", "key:'gemi'", "key:'gemiUcak'", "key:'ucak'"];
  const at = order.map(key => head[0].indexOf(key));
  at.forEach((index, i) => assert.ok(index >= 0, order[i] + ' sütunu olmalı'));
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'sütun sırası FOB / Domestic / SEA / SEA+AIR / AIR olmalı');
  // Statik rol satır başına tekrarlanmaz; başlıkta bir kez yazılır.
  assert.ok(head[0].includes("role:tr?'Kaynak':'Source'") && head[0].includes("role:tr?'Taban':'Baseline'"));
  assert.match(CSS, /\.shipCompare tbody \.shipBadge\.isSource,\s*\.shipCompare tbody \.shipBadge\.isBase\{display:none;\}/);
  // v9.18: model detayları tek sütunda toplanıp Transit sütunu kalkınca tablo
  // daraldı (1240 -> 900), böylece A4'e yatayda sığıyor.
  assert.match(CSS, /\.shipCompare\{[\s\S]*min-width:900px/);
  assert.match(CSS, /\.shipCompareWrap\{overflow:auto/);

  const model = HTML.match(/function shipModelCard\(row\)\{[\s\S]*?\n\}/)[0];
  assert.ok(model.includes('shipProductName'), 'ürün adı kendi hücresinde olmalı');
  const compare = HTML.match(/function shipCompareCards\(row\)\{[\s\S]*?\n\}/)[0];
  assert.ok(compare.includes('data-ship-pct'), 'nakliye hücrelerinde yüzde alanı olmalı');
  assert.ok(compare.includes('shipCardInputs'), 'girişler hücrenin altındaki kompakt alanda tutulmalı');
});

test('v9.17 her model TEK tablo satırı olarak çiziliyor', () => {
  const render = HTML.slice(HTML.indexOf('function renderShipDecision()'), HTML.indexOf('function renderShipTable()'));
  assert.ok(render.includes('<table class="shipCompare">'), 'gerçek bir tablo çizilmeli');
  assert.ok(render.includes('<tr class="shipRowCards"'), 'her model tek satır olmalı');
  // Kart öbeğinin sarmalayıcıları kalmamalı.
  assert.ok(!render.includes('<div class="shipCards">'), 'fiyat kartı şeridi kaldırılmalı');
  // Düzenleme ve önizleme kancaları YERİNDE kalmalı: sözleşme değişmedi.
  assert.ok(render.includes('commitShipEditor(inp'), 'kayıt yolu aynı kalmalı');
  assert.ok(render.includes("querySelectorAll('.shipCardInput')"), 'giriş alanları bağlanmalı');
});

test('ham FOB en ucuz kararına katılmaz', () => {
  /* v9.18: FOB bir taşıma alternatifi değil, kaynak fiyattır. Artık yüzde de
     taşımaz (priceOnly) — yüzde yalnız üç nakliye seçeneğinde anlamlıdır. */
  const opts = HTML.match(/function shipDecisionOptions\(row\)\{[\s\S]*?\n\}/)[0];
  const state = HTML.match(/function shipDecisionState\(row\)\{[\s\S]*?\n\}/)[0];
  assert.ok(opts.includes('priceOnly:true'), 'FOB ve Domestic fiyat sütunudur');
  assert.ok(!opts.includes('versusDomestic'), 'yüzde artık computeShipFormulas\'ta hesaplanmalı');
  assert.ok(state.includes('option.decision!==false'), 'ham FOB en ucuz kararından dışlanmalı');
});
