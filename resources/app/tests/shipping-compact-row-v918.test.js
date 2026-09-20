'use strict';

/* v9.18 — NAKLİYE KIYASLAMA: KARAR ODAKLI TEK SATIR.
 *
 * v9.17 kart öbeğini tek tablo satırına indirmişti. v9.18 satırın İÇİNDEKİ
 * öncelikleri kullanıcının gerçek karar sırasına göre yeniden dizer:
 *
 *   1) YÜZDE  — "TR'de mi ürettireyim, yurtdışından mı getireyim?" sorusunun
 *               cevabını taşıyan sayı budur. Ana değer, 17px.
 *   2) FİYAT  — ikinci öncelik, aynı hücrede küçük.
 *
 * Ve karşılaştırmanın TABANI düzeltildi: eskiden YD LANDED, domestic FOB ile
 * kıyaslanıyordu — yani masrafı eklenmiş bir fiyat masrafsız bir fiyatla.
 * Artık landed-landed. Çarpanlar da sabit değil, Landed Multipliers ayarından
 * gelir; tablo, Excel ve bu görünüm aynı sayıyı kullanır.
 *
 * Sütunlar (yatayda A4'e sığacak kadar dar, 900px):
 *   Görsel | Ürün | Tarihler | Overseas FOB | Domestic Landed | Gemi | G+U | Uçak
 *
 * Tarayıcıda ölçüldü: taban 11,55 (11 × 1,05), Gemi 11,10 → −%3,9 (eskiden
 * FOB'a göre +%0,9). Tablo genişliği 1240 → 900px.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');
const HTML = read('public/index.html');

const fn = name => {
  const match = APP.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} bulunmalı`);
  return match[0];
};

/* ------------------------------------------- 1) KARŞILAŞTIRMA TABANI DOĞRU */

test('v9.18 avantaj tabanı domestic LANDED, domestic FOB değil', () => {
  const compute = fn('computeShipFormulas');
  assert.match(compute, /const trLanded = row\.trFiyatFobUsdLanded;/);
  assert.match(compute, /const advantage = landed => \(trLanded!==''/);
  // Eski FOB tabanlı formül kalmamalı.
  assert.doesNotMatch(compute, /row\.gemiAvantaj = \(trU!==''/);
  assert.doesNotMatch(compute, /gemiUcak\/trU - 1/);
});

test('v9.18 çarpanlar ayardan geliyor, koda gömülü değil', () => {
  const multipliers = fn('shipLandedMultipliers');
  assert.match(multipliers, /state\.overrides\.landedMultipliers/);
  // Ayar yoksa uygulamanın varsayılanlarına düşmeli.
  assert.match(multipliers, /pick\(raw\.tr,1\.05\)/);
  assert.match(multipliers, /pick\(raw\.overseas,1\.11\)/);
  const compute = fn('computeShipFormulas');
  assert.match(compute, /row\.trFiyatUsd\*multipliers\.tr/);
  assert.match(compute, /fob\*multipliers\.overseas/);
  // Sabit çarpan kalmamalı.
  assert.doesNotMatch(compute, /\*1\.05\)/);
  assert.doesNotMatch(compute, /\*1\.11\)/);
});

test('v9.18 tablo ve Excel başlıkları da landed diyor', () => {
  // Aynı isimli sütun iki farklı şey ölçemez; etiketler gerçeği söylemeli.
  for (const label of ['Gemi YD-TR Landed Avantaj (USD)', 'Gemi+Uçak YD-TR Landed Avantaj (USD)', 'Uçak YD-TR Landed Avantaj (USD)']) {
    assert.ok(APP.includes(label), `${label} olmalı`);
  }
  assert.ok(APP.includes('GEMİ YD-TR LANDED AVANTAJ (USD)'), 'Excel başlığı da güncellenmeli');
  assert.ok(!APP.includes('GEMİ YD-TR FİYAT AVANTAJ (USD)'), 'eski Excel başlığı kalmamalı');
});

/* ------------------------------------------------ 2) ÖNCELİK: FİYAT HER YERDE */

test('v(satır yönetimi) tüm sütunlarda ana değer fiyat, Overseas FOB ile aynı görsel ağırlık', () => {
  /* Eskiden nakliye hücrelerinde yüzde ana değerdi (bkz. git geçmişi v9.18).
     Kullanıcı isteği: Sea/Sea+AIR/Air'in ana değeri Overseas FOB ile görsel
     olarak eşleşmeli. Artık TEK bir head ifadesi var, priceOnly dalı yok. */
  const compare = fn('shipCompareCards');
  assert.match(compare, /const head=`<b class="shipCardPrice" data-ship-unit>\$\{priceText\}<\/b>`;/);
  assert.ok(!compare.includes('shipCardPct'), 'yüzde artık ayrı bir birincil sınıf taşımamalı');
  // Yüzde ikinci sıraya indi: metrik satırında, renk yönü korunarak.
  assert.match(compare, /<span class="shipCardRow \$\{pctClass\}" data-ship-pct>/);
});

test('v(satır yönetimi) yüzde artık tipografik olarak baskın değil, fiyatla aynı sınıfı paylaşır', () => {
  // .shipCardPct kaldırıldı: tüm ana değerler .shipCardPrice kullanıyor.
  assert.ok(!CSS.includes('.shipCardPct{'));
  const price = CSS.match(/\.shipCardPrice\{[^}]*\}/);
  assert.ok(price);
  // Yön işareti hâlâ renkle veriliyor, ama artık .shipCardRow üzerinden (metrik satırı).
  assert.match(CSS, /\.shipCardRow\.isGood\{color:var\(--green/);
  assert.match(CSS, /\.shipCardRow\.isBad\{color:var\(--danger/);
});

test('v(satır yönetimi) antrepo tarihi ve transit süresi büyütüldü', () => {
  const block = CSS.slice(CSS.indexOf('.shipCard:not(.isPriceOnly) [data-ship-date]'), CSS.indexOf('.shipCard:not(.isPriceOnly) [data-ship-date]') + 220);
  assert.match(block, /font-size:12px/);
  assert.match(block, /\.shipTransit/);
});

test('v(satır yönetimi) Sea+AIR/Air girişi varsayılan gizli, çift tıkla açılıyor', () => {
  const compare = fn('shipCompareCards');
  assert.match(compare, /SHIP_PRICE_EDITABLE_KEYS\.has\(option\.key\)/);
  assert.match(APP, /const SHIP_PRICE_EDITABLE_KEYS=new Set\(\['gemiUcak','ucak'\]\);/);
  assert.match(CSS, /\.shipCard\.isPriceEditable \.shipCardInputs\{display:none;\}/);
  assert.match(CSS, /\.shipCard\.isPriceEditable\.isEditingPrice \.shipCardInputs\{display:flex;\}/);
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /'\.shipCard\.isPriceEditable \[data-ship-unit\]'\)\.forEach/);
  assert.ok(render.includes("card.classList.add('isEditingPrice')"), 'çift tık düzenleme sınıfını açmalı');
});

test('v(satır yönetimi) "Change Ex-Factory" kaldırıldı, tarihe çift tıkla düzenleniyor', () => {
  assert.ok(!APP.includes('Change Ex-Factory'), '"Change Ex-Factory" etiketi kalmamalı');
  assert.ok(!APP.includes("'Ex-Factory değiştir'"), 'Türkçe karşılığı da kalmamalı');
  const model = fn('shipModelCard');
  assert.match(model, /data-ship-exfac/);
  assert.match(model, /shipCardInput\(row,'exFactory','','date'\)/);
  assert.match(CSS, /\.shipCellDates>\.shipField\{display:none; margin-top:3px;\}/);
  assert.match(CSS, /\.shipCellDates\.isEditingExFac>\.shipField\{display:flex;\}/);
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /'\[data-ship-exfac\]'\)\.forEach/);
  assert.ok(render.includes("cell.classList.add('isEditingExFac')"), 'çift tık Ex-Factory düzenleyicisini açmalı');
});

test('v(satır yönetimi) Escape kısmi değeri kaydetmiyor', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /event\.key==='Escape'/);
  assert.match(render, /inp\.value=inp\.defaultValue;/);
});

test('v9.18 toplam USD farkı artık gösterilmiyor', () => {
  const compare = fn('shipCompareCards');
  // Kullanıcı toplam farka ihtiyaç duymuyor; alan gizli kalır ki canlı
  // önizleme onu ararken hata vermesin.
  assert.match(compare, /class="shipCardRow isEmpty" data-ship-total/);
  assert.ok(!compare.includes('totalLabel'), 'toplam etiketi kaldırılmalı');
  const options = fn('shipDecisionOptions');
  assert.ok(!options.includes('total:'), 'seçenek artık toplam taşımamalı');
});

/* ------------------------------------------------------------ 3) SÜTUNLAR */

test('v9.18 sekiz sütun: görsel, ürün, tarihler ve beş fiyat/avantaj', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  for (const th of ['shipColImage', 'shipColProduct', 'shipColDates']) {
    assert.ok(render.includes(th), `${th} olmalı`);
  }
  // Ayrı Transit sütunu KALDIRILDI: transit günü nakliye hücresinde.
  assert.ok(!render.includes('shipColTransit'), 'ayrı Transit sütunu olmamalı');
  assert.ok(!render.includes('shipColModel') && !render.includes('shipColInfo'), 'eski sütunlar kalmamalı');
  assert.match(fn('shipCompareCards'), /class="shipCardRow shipTransit"/);
});

test('v9.18 model detayları TEK sütunda toplandı', () => {
  const model = fn('shipModelCard');
  // Üç hücre: görsel, ürün, tarihler.
  for (const cell of ['shipCellImage', 'shipCellProduct', 'shipCellDates']) {
    assert.ok(model.includes(cell), `${cell} olmalı`);
  }
  // İstenen alanların hepsi ürün sütununda.
  for (const field of ['row.season', 'row.country', 'row.supplier', 'row.quantity', 'row.styleName', 'row.category']) {
    assert.ok(model.includes(field), `${field} korunmalı`);
  }
  // Tarih sütunu: OPD / Ex-Factory / Retail.
  assert.match(model, /\['OPD', row\.opd/);
  assert.match(model, /\['Ex-Fac\.', row\.exFactory/);
  assert.match(model, /\['Retail', row\.retailDate/);
  assert.ok(model.includes("shipCardInput(row,'exFactory'"), 'Ex-Factory düzenlenebilir kalmalı');
});

test('v9.18 nakliye hücresi antrepo giriş tarihini ve transiti gösteriyor', () => {
  const options = fn('shipDecisionOptions');
  assert.match(options, /date:row\.retailTrWithVessel, transit:days\['Gemi'\]/);
  assert.match(options, /date:row\.gemiUcakAntrepoTeslim, transit:days\['Gemi\+Uçak'\]/);
  assert.match(options, /date:row\.ucakAntrepoTeslim, transit:days\['Uçak'\]/);
  const compare = fn('shipCompareCards');
  assert.match(compare, /Tahmini antrepo giriş/);
});

/* --------------------------------------------------------------- 4) GÖRSEL */

test('v9.18 görsel CP ile aynı override haritasından çözülüyor', () => {
  /* v9.20: yalnız haritadan çözmek yetmediği için satıra yazılan referans da
     devreye girdi — o yarısı aşağıdaki v9.20 testlerinde. Burada korunan kural
     tek kaynak: görsel CP'nin haritasından okunur, ayrı bir yol kurulmaz. */
  const resolver = fn('shipRowImageRef');
  assert.match(resolver, /cpImageRefFromOverride\(state&&state\.overrides,row\.plm,row\.colorCode,row\.orderCode/);
  // Aktarımda PLM kimliği taşınmalı, yoksa birleşik anahtar hiç kurulamaz.
  assert.match(APP, /plm: row\['PLM ID'\] \?\? row\['PLM Code'\] \?\? row\.plmId \?\? '',/);
  assert.match(CSS, /\.shipThumb\{/);
});

/* ------------------------------------------------- 5) EXCEL / MAİL KOPYASI */

test('v9.18 kıyaslama Excel ve e-postaya yapıştırılabilir kopyalanıyor', () => {
  const html = fn('shipCopyTableHtml');
  // Dış CSS panoya gitmez: stil satır içi olmalı, yoksa Excel/Outlook'ta çıplak kalır.
  assert.match(html, /const border='border:1px solid #d0d5dd;padding:4px 6px;/);
  assert.match(html, /style="\$\{border\}/);
  // Görsel mutlak URL olmalı, yoksa e-postada kırık görünür.
  assert.match(html, /\$\{location\.origin\}\$\{CP_IMAGE_API\}/);
  // Düz metin yedeği sekmeyle ayrılmalı (Excel'e sütun sütun yapışsın).
  assert.match(fn('shipCopyTablePlain'), /lines\.join\('\\n'\)/);
  assert.match(APP, /copyRichToClipboard\(shipCopyTableHtml\(\),shipCopyTablePlain\(\)\)/);
  // Düğme ve kancası.
  assert.ok(HTML.includes('id="shipCopyCompareBtn"'));
  assert.match(APP, /getElementById\('shipCopyCompareBtn'\)\?\.addEventListener/);
});

/* ------------------------------------------------------- 6) A4 OKUNAKLILIK */

test('v9.18 A4 baskı düzeni tanımlı', () => {
  // Dosyada başka @media print blokları da var; kendi bloğumuza sabitle.
  const section = CSS.indexOf('NAKLİYE KIYASLAMA — HER MODEL TEK SATIR (v9.18)');
  assert.ok(section >= 0, 'stil bloğu bulunmalı');
  const start = CSS.indexOf('@media print', section);
  assert.ok(start > section, 'baskı bloğu olmalı');
  const block = CSS.slice(start, start + 1400);
  assert.match(block, /@page\{size:A4 landscape/);
  // Satır sayfa sonunda ikiye bölünmemeli.
  assert.match(block, /\.shipRowCards\{break-inside:avoid; page-break-inside:avoid;\}/);
  // Kâğıtta giriş kutusu bir işe yaramaz.
  // v9.19: sürükleme tutamağı da aynı kurala katıldı.
  assert.match(block, /\.shipCardInputs,\.shipCellDates>\.shipField,\.colResizer\{display:none!important;\}/);
  // Yatay kaydırma kâğıtta anlamsız.
  assert.match(block, /\.shipCompareWrap\{overflow:visible/);
  // Baskıda punto birimleri kullanılmalı.
  assert.match(block, /\.shipCardPrice\{font-size:10pt;\}/);
});

test('v9.18 ekran yazıları da büyütüldü', () => {
  // Eski düzende 8,2-9,5px alanlar okunmuyordu.
  assert.match(CSS, /\.shipCompare\{[\s\S]*?font-size:11px/);
  assert.match(CSS, /\.shipProductName\{\s*font-size:11\.5px/);
  assert.match(CSS, /\.shipCardMetrics\{[\s\S]*?font-size:10px/);
  assert.match(CSS, /\.shipCardInput\{[\s\S]*?font:11px inherit/);
});

/* --------------------------------------- 7) İŞLEVSELLİK SÖZLEŞMESİ DURUYOR */

test('v9.18 düzenleme ve önizleme kancalarının hiçbiri bozulmadı', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.ok(render.includes("querySelectorAll('.shipCardInput')"));
  assert.ok(render.includes('commitShipEditor(inp'));
  assert.ok(render.includes("addEventListener('input',()=>previewShipCardInput(inp))"));
  assert.match(render, /<tr class="shipRowCards" data-shipid=/);

  const preview = fn('previewShipCardInput');
  assert.ok(preview.includes("inp.closest('.shipRowCards')"));
  assert.ok(preview.includes('.shipCard[data-ship-option='));
  for (const hook of ['[data-ship-unit]', '[data-ship-pct]', '[data-ship-total]', '[data-ship-date]', '[data-ship-badges]']) {
    assert.ok(preview.includes(hook), `${hook} kancası korunmalı`);
  }
  assert.ok(preview.includes('const preview={...row,[key]:parsed.value}'), 'önizleme gerçek satırı değiştirmemeli');
});

test('v9.18 boş metrik satır yüksekliği yemiyor', () => {
  assert.match(APP, /function shipMetricEmpty\(text\)/);
  assert.match(APP, /node\.classList\.toggle\('isEmpty',shipMetricEmpty\(text\)\);/);
  assert.match(CSS, /\.shipCardRow\.isEmpty\{display:none;\}/);
});

test('v9.18 sütun başlığı th olarak kalıyor', () => {
  /* REGRESYON: th'ye display:flex vermek onu tablo hücresi olmaktan çıkarır ve
     bütün fiyat başlıkları tek sütuna yığılır. */
  const start = CSS.indexOf('.shipCompare thead th.shipColPrice');
  assert.ok(start >= 0);
  assert.doesNotMatch(CSS.slice(start, start + 260), /display:flex/);
});

test('v9.18 tema dışına çıkılmadı ve köşe yuvarlanmadı', () => {
  const start = CSS.indexOf('NAKLİYE KIYASLAMA — HER MODEL TEK SATIR (v9.18)');
  assert.ok(start >= 0, 'stil bloğu bulunmalı');
  const block = CSS.slice(start, CSS.indexOf('KOLEKSİYON — YURT DIŞI', start));
  assert.ok(block.length > 800);
  assert.doesNotMatch(block, /border-radius/);
  // Ekran renkleri tema değişkenlerinden; baskıda kâğıt için sabit renk serbest.
  const screen = block.slice(0, block.indexOf('@media print'));
  const hardcoded = (screen.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter(hex => !['#12B76A', '#d64545', '#0a7a47', '#1b4bb8'].includes(hex));
  assert.deepEqual(hardcoded, [], 'ekranda tema dışı sabit renk olmamalı');
});

/* ------------------------------------------ 8) AYARLANABİLİR SÜTUN GENİŞLİĞİ */

test('v9.19 sütun genişlikleri kullanıcı tarafından ayarlanabiliyor', () => {
  /* Sabit CSS genişlikleri dengesizdi: girişi olan sütun (Domestic Landed,
     Gemi+Uçak, Uçak) dar kalıyor, başlık iki satıra kırılıyordu. Artık
     ölçüler colgroup'tan gelir ve başlıktaki tutamakla sürüklenir. */
  const columns = fn('shipCompareWidths');
  assert.ok(columns.includes('SHIP_COMPARE_COLUMNS'));
  assert.match(APP, /const SHIP_COMPARE_COLUMNS=\[/);
  // Her sütunun kendi varsayılanı ve asgarisi olmalı.
  for (const key of ['image', 'product', 'dates', 'fob', 'tr', 'gemi', 'gemiUcak', 'ucak']) {
    assert.match(APP, new RegExp(`\\{key:'${key}',\\s*def:\\d+,\\s*min:\\d+\\}`), `${key} ölçüsü tanımlı olmalı`);
  }
  // Girişi olan sütunlar ham fiyat sütunundan geniş başlamalı.
  const def = key => Number(APP.match(new RegExp(`\\{key:'${key}',\\s*def:(\\d+)`))[1]);
  assert.ok(def('tr') > def('fob'), 'Domestic Landed TL+Kur girişi taşıyor');
  assert.ok(def('gemiUcak') > def('gemi'), 'Gemi+Uçak USD girişi taşıyor');
});

test('v9.19 mevcut .colResizer bileşeni yeniden kullanılıyor', () => {
  // Yeni bir tutamak uydurulmaz; ana tablolarla aynı görünüm ve etkileşim.
  const attach = fn('attachShipCompareResize');
  assert.match(attach, /grip\.className='colResizer';/);
  assert.match(attach, /addEventListener\('mousedown'/);
  // Tutamağa çift tıklama o sütunu varsayılana döndürür.
  assert.match(attach, /addEventListener\('dblclick'/);
  assert.match(attach, /shipCompareWidths\(\)\[column\.key\]=column\.def;/);
  // Asgari genişliğin altına inilemez.
  assert.match(attach, /Math\.max\(column\.min,startPx\+\(move\.clientX-startX\)\)/);
});

test('v9.19 sürüklerken tablo yeniden çizilmiyor', () => {
  /* Her fare hareketinde renderShipDecision çağırmak sürüklemeyi takılgan
     yapar ve odaktaki giriş alanını kaybettirir. Yalnız colgroup güncellenir. */
  const attach = fn('attachShipCompareResize');
  assert.ok(!attach.includes('renderShipDecision'), 'sürükleme yeniden çizim tetiklememeli');
  assert.match(attach, /applyShipCompareWidths\(\);/);
  const apply = fn('applyShipCompareWidths');
  assert.match(apply, /col\.style\.width=widths\[column\.key\]\+'px';/);
  assert.match(apply, /table\.style\.minWidth=total\+'px';/);
});

test('v9.19 genişlikler kalıcı ve sıfırlanabilir', () => {
  assert.match(APP, /const SHIP_COMPARE_WIDTH_KEY='buyerlog\.shipCompare\.colWidths\.v1';/);
  const save = fn('saveShipCompareWidths');
  assert.match(save, /BLStorage\.setItem\(SHIP_COMPARE_WIDTH_KEY/);
  // Okuma bozuk/eksik kayıtta varsayılana düşmeli, satır bozulmamalı.
  const load = fn('shipCompareWidths');
  assert.match(load, /catch\(_\)\{ saved=\{\}; \}/);
  assert.match(load, /Number\.isFinite\(value\)&&value>0\?Math\.max\(column\.min,value\):column\.def/);
  // Toplu sıfırlama düğmesi.
  assert.ok(HTML.includes('id="shipResetWidthsBtn"'));
  assert.match(APP, /getElementById\('shipResetWidthsBtn'\)\?\.addEventListener\('click',\(\)=>resetShipCompareWidths\(\)\)/);
});

test('v9.19 CSS sabit genişlikleri colgroup ile çakışmıyor', () => {
  /* CSS'te width kalırsa colgroup'u ezer ve sürükleme etkisiz GÖRÜNÜR —
     kullanıcı çeker, hiçbir şey olmaz. table-layout:fixed de şart:
     auto düzende uzun bir hücre sütunu yine şişirir. */
  assert.match(CSS, /\.shipCompare\{[\s\S]*?table-layout:fixed/);
  assert.doesNotMatch(CSS, /\.shipColProduct\{min-width:210px; width:210px;\}/);
  assert.doesNotMatch(CSS, /\.shipColImage\{width:62px/);
  // Tutamağın konumlanabilmesi için başlık relative/sticky olmalı.
  assert.match(CSS, /\.shipCompare thead th\{position:sticky/);
});

test('v9.19 baskıda ekran genişlikleri kâğıda uyduruluyor', () => {
  const section = CSS.indexOf('NAKLİYE KIYASLAMA — HER MODEL TEK SATIR (v9.18)');
  const start = CSS.indexOf('@media print', section);
  const block = CSS.slice(start, start + 1600);
  // Ekranda 1032px olan tablo A4'e sığmalı: sabit ölçüler kâğıtta bırakılır.
  assert.match(block, /\.shipCompare\{table-layout:auto; min-width:0!important;\}/);
  assert.match(block, /\.shipCompare col\{width:auto!important;\}/);
  // Sürükleme tutamağı kâğıda basılmaz.
  assert.match(block, /\.colResizer\{display:none!important;\}|,\.colResizer\{display:none!important;\}/);
});

/* ------------------------------ 9) GÖRSEL, SEÇİM, SİLME, SÜTUN ADLARI (v9.20) */

test('v9.20 görsel aktarımda satıra yazılıyor', () => {
  /* Yalnız override haritasından çözmek yetmiyordu: kullanıcı CP'yi hiç
     açmadan Nakliye sekmesine geçerse harita BOŞ olur ve hücre boş kalır.
     Sahadaki belirti tam olarak buydu. */
  assert.match(APP, /_imageRef: row\._imageRef \|\| '',/);
  const resolver = fn('shipRowImageRef');
  assert.match(resolver, /const stored=String\(row\._imageRef\|\|''\)\.trim\(\);/);
});

test('v9.20 harita biliyorsa canlı sonuç, bilmiyorsa saklanan referans', () => {
  /* CP'de silinen görsel burada da silinmiş görünmeli; bu yüzden harita bu
     PLM hakkında bir şey biliyorsa (dolu kayıt ya da mezar taşı) canlı sonuç
     kazanır. Bilmiyorsa aktarım anındaki referans kullanılır. */
  const resolver = fn('shipRowImageRef');
  assert.match(resolver, /const known=row\.plm\?cpPlmImageKeysFor\(map,row\.plm\)\.length>0:false;/);
  assert.match(resolver, /if\(known\) return live;/);
  assert.match(resolver, /return live\|\|stored;/);
  // Çözülemezse satır bozulmamalı.
  assert.match(resolver, /catch\(_\)\{ return stored; \}/);
});

test('v9.20 kıyaslama tablosundan satır seçilebiliyor', () => {
  /* Seçim yalnız alttaki tabloda vardı; bu yüzden silme ve kur güncelleme de
     oraya bağlı kalıyordu. Artık kıyaslama tablosunun kendi kutuları var. */
  const model = fn('shipModelCard');
  assert.match(model, /<td class="shipCellChk"><input type="checkbox" class="shipCompareChk"/);
  // Görüntüleme yetkisi olmayan satır seçilememeli (silme onu reddediyor).
  assert.match(model, /row\._canEdit===false\?'disabled':''/);
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /<th class="shipColChk"><input type="checkbox" data-ship-chk-all/);
  assert.match(APP, /\{key:'chk',\s*def:\d+,\s*min:\d+\}/);
});

test('v9.20 iki tablo AYNI seçim kümesini paylaşıyor', () => {
  /* Ayrı bir küme kurulsaydı Kur Güncelle / Seçilenleri Sil / Excel hangi
     tablodan işaretlendiğine göre farklı satırlar görürdü. */
  const bind = fn('bindShipCompareSelection');
  assert.match(bind, /shipSelected\.add\(box\.dataset\.shipid\)/);
  assert.ok(!/new Set\(/.test(bind), 'kıyaslama tablosu kendi kümesini kurmamalı');
  const sync = fn('syncShipSelectionUi');
  // Her iki tablonun kutuları da eşitlenmeli.
  assert.match(sync, /querySelectorAll\('\.shipCompareChk'\)/);
  assert.match(sync, /querySelectorAll\('\.shipRowChk'\)/);
  // "Tümünü seç" kısmi seçimde belirsiz görünmeli.
  assert.match(sync, /all\.indeterminate=chosen>0&&chosen<selectable\.length;/);
  assert.match(sync, /updateShipSelectionActions\(\);/);
  // Alttaki tablo da üsttekini haberdar etmeli.
  const table = APP.slice(APP.indexOf('function renderShipTable()'), APP.indexOf('function renderShipTable()') + 4000);
  assert.ok(table.includes('syncShipSelectionUi();'), 'alt tablodan seçim üstte de görünmeli');
});

test('v9.20 seçim değişince tablo yeniden çizilmiyor', () => {
  // Yeniden çizim odaktaki giriş alanını ve kaydırmayı kaybettirir.
  const bind = fn('bindShipCompareSelection');
  assert.ok(!bind.includes('renderShipDecision'), 'seçim yeniden çizim tetiklememeli');
  const sync = fn('syncShipSelectionUi');
  assert.ok(!sync.includes('renderShipDecision'), 'eşitleme yeniden çizim tetiklememeli');
});

test('v9.20 silme kıyaslama tablosunu da tazeliyor', () => {
  const start = APP.indexOf("getElementById('shipDeleteBtn')");
  const block = APP.slice(start, start + 1200);
  assert.match(block, /ids:\[\.\.\.shipSelected\]/);
  // Silinen satır üstteki tabloda kalmamalı.
  assert.match(block, /await loadShipRows\(\);\s*\r?\n\s*renderShipDecision\(\);/);
});

test('v9.20 kopyalama seçili satırları alıyor', () => {
  const rows = fn('shipCopyRows');
  assert.match(rows, /const chosen=shipRows\.filter\(row=>shipSelected\.has\(row\._shipId\)\);/);
  assert.match(rows, /return chosen\.length\?chosen:shipRows;/);
  assert.match(fn('shipCopyTableHtml'), /shipCopyRows\(\)\.map/);
  assert.match(fn('shipCopyTablePlain'), /for\(const row of shipCopyRows\(\)\)/);
  // Kaç satırın kopyalandığı söylenmeli: kullanıcı seçim yaptığını sanabilir.
  assert.match(fn('copyShipComparison'), /const count=shipCopyRows\(\)\.length, partial=shipSelected\.size>0;/);
});

test('v9.20 nakliye sütunları "… Landed" adını taşıyor', () => {
  const options = fn('shipDecisionOptions');
  assert.match(options, /\{key:'gemi', name:'SEA Landed'/);
  assert.match(options, /\{key:'gemiUcak', name:'SEA\+AIR Landed'/);
  assert.match(options, /\{key:'ucak', name:'AIR Landed'/);
  const head = fn('shipCompareHeadCells');
  assert.match(head, /\{key:'gemi', name:'SEA Landed'\}/);
  assert.match(head, /\{key:'gemiUcak', name:'SEA\+AIR Landed'\}/);
  assert.match(head, /\{key:'ucak', name:'AIR Landed'\}/);
  // Kopyalanan tabloda da aynı adlar.
  assert.match(fn('shipCopyTableHtml'), /'SEA Landed','SEA\+AIR Landed','AIR Landed'/);
  assert.match(fn('shipCopyTablePlain'), /'SEA Landed','SEA\+AIR Landed','AIR Landed'/);
  // Kısaltılmış adlar kalmamalı.
  assert.ok(!APP.includes("name:tr?'Gemi':'SEA'"), 'eski kısa ad kalmamalı');
});
