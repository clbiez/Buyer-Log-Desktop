'use strict';

// v5.79 — Koleksiyon satırlarını "Copy" ile kopyalarken Endeksmatik ve Landed
// sütunları Excel dışa aktarımıyla aynı değeri vermeli.
//
// Sorunun kökü: bu üç hücre ekranda bileşik çiziliyor. Endeksmatik bir <button>
// (strong + small), Landed sütunları ise içinde TL fiyat / çarpan / kur
// input'ları olan bir kart. Kopyalama DOM'dan okuduğu için Endeksmatik'in iki
// satırı ayırıcısız yapışıyor, Landed hücrelerinde ise hesaplanan sonuç yerine
// karttaki İLK input'un değeri (TR'de TL fiyatı, Overseas'te boş çarpan)
// panoya düşüyordu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function bodyOf(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = SRC.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}
function fnOf(name, args) {
  return new Function(...args, bodyOf(name));
}

const escapeHtml = fnOf('escapeHtml', ['s']);
const kolMoney2 = new Function('appLang', 'v', bodyOf('kolMoney2')).bind(null, 'tr');
const copyPlainCell = fnOf('copyPlainCell', ['text']);
const kolLandedCopyAttrs = new Function('escapeHtml', 'kolMoney2', 'value', 'profitPct',
  bodyOf('kolLandedCopyAttrs')).bind(null, escapeHtml, kolMoney2);

test('v5.79/v6.42 Landed hücresi panoya hesaplanan sayıyı taşır, karttaki ilk input’u değil', () => {
  const attrs = kolLandedCopyAttrs(4.3123);
  // Görünen metin dışa aktarımdaki gibi para biçiminde.
  assert.match(attrs, /data-copy-text="\$4,31"/);
  // Sayısal değer ayrıca taşınır ki Excel'de metin değil sayı olarak dursun.
  assert.match(attrs, /data-copy-num="4\.31"/);
  assert.match(attrs, /data-copy-numfmt="money2"/);
});

test('v6.42/v6.46 Overseas Landed kâr yüzdesi kopyalama metnine ekleniyor ve Excel yapıştırmasına da giriyor', () => {
  // v6.42: ekrandaki kâr rozeti (TR Landed'a göre avantaj) eskiden kopyalama
  // metnine hiç girmiyordu; yalnız landed sayısı kopyalanıyordu.
  // v6.46: v6.42'nin kendisi eksikti — data-copy-num HER ZAMAN da ekleniyordu,
  // bu yüzden _copyCellFromTd hücreyi SAYISAL modda işliyor ve Excel'in
  // gerçekte kullandığı HTML clipboard tarafına yalnız SAF SAYIYI (kâr YOK)
  // yazıyordu; kâr yalnız düz metin/TSV satırında görünüyordu. Kâr varken artık
  // sayısal attribute'lar hiç eklenmiyor, hücre METİN olarak kopyalanır ve kâr
  // HTML tarafına da girer.
  const withProfit = kolLandedCopyAttrs(4.3123, -3.4);
  assert.match(withProfit, /data-copy-text="\$4,31 \(-3,4%\)"/);
  assert.doesNotMatch(withProfit, /data-copy-num=/, 'kâr varken sayısal mod devre dışı kalmalı — yoksa kâr HTML tarafına hiç girmez');
  assert.doesNotMatch(withProfit, /data-copy-numfmt=/);
  // Kâr verilmezse (TR Landed hücresi gibi) davranış eskisiyle birebir aynı kalır:
  // hâlâ saf sayı, formülde kullanılabilir.
  const withoutProfit = kolLandedCopyAttrs(4.3123, null);
  assert.match(withoutProfit, /data-copy-text="\$4,31"/);
  assert.doesNotMatch(withoutProfit, /\(/);
  assert.match(withoutProfit, /data-copy-num="4\.31"/);
  assert.match(withoutProfit, /data-copy-numfmt="money2"/);
});

test('v5.79 Landed hesaplanamadıysa hücre boş kopyalanır', () => {
  // null gelirse ekranda "—" yazıyor; panoya tire değil boş hücre gitmeli,
  // yoksa Excel'de sayı sütununa metin karışır.
  const attrs = kolLandedCopyAttrs(null);
  assert.equal(attrs, ' data-copy-text=""');
  assert.doesNotMatch(attrs, /data-copy-num/);
  assert.equal(kolLandedCopyAttrs('abc'), ' data-copy-text=""');
});

test('v5.79 çok satırlı hücre TSV’de tırnaklanır, satırı bölmez', () => {
  assert.equal(copyPlainCell('TR ₺207,37\nYD -3,40% · TR +10,30%'), '"TR ₺207,37\nYD -3,40% · TR +10,30%"');
  assert.equal(copyPlainCell('sekme\tvar'), '"sekme\tvar"');
  assert.equal(copyPlainCell('tırnak "içerir"'), '"tırnak ""içerir"""');
  // Sıradan metin tırnaklanmaz; her hücreyi tırnaklamak Excel'de görünür bozulma yapar.
  assert.equal(copyPlainCell('Gemi+Uçak'), 'Gemi+Uçak');
  assert.equal(copyPlainCell(null), '');
});

test('v5.79 Endeksmatik hücresi dışa aktarımla aynı iki satırlı metni taşır', () => {
  // endeksmatikCompactText tek satırdır; Excel dışa aktarımı endeksmatikExcelText
  // kullanıyor (fiyat satırı + endeks satırı). Kopyalama da onu kullanmalı.
  assert.match(SRC, /<td class="endeksmatikTd"\$\{rc\} data-copy-text="\$\{escapeHtml\(endeksmatikExcelText\(endeksmatikRow\)\)\}"/);
});

test('v5.79/v6.42 her iki Landed sütunu da kopyalama verisini iliştirir', () => {
  // TR Landed'da kâr rozeti yok, tek argümanla çağrılır.
  // v7.81: kolRuleMissing sınıfı koşullu eklendiği için "kolLandedTd"
  // artık kapanış tırnağıyla bitmiyor; template ifadesiyle devam ediyor.
  assert.ok(SRC.includes('kolLandedTd${k.ruleMissing?'), 'TR/Overseas Landed uyarı sınıfı bulunamadı');
  assert.ok(SRC.includes('${kolLandedCopyAttrs(k.trLanded)}'), 'TR Landed kopyalama verisini iliştirmiyor');
  // Overseas Landed'da kâr yüzdesi de kopyalama metnine geçsin diye ikinci
  // argüman (profit) eklendi — v6.42.
  assert.ok(SRC.includes('${kolLandedCopyAttrs(k.ydLanded,profit)}'), 'Overseas Landed kopyalama verisini iliştirmiyor');
});

test('v5.79 hücre okuyucusu iliştirilmiş veriyi input/DOM metninden önce kullanır', () => {
  const body = bodyOf('_copyCellFromTd');
  const attrIndex = body.indexOf('td.dataset.copyText!==undefined');
  const ctlIndex = body.indexOf("String(ctl.value");
  const textIndex = body.indexOf('_copyMeaningfulCellText(td)');
  assert.ok(attrIndex > 0, 'iliştirilmiş kopyalama verisi okunmalı');
  assert.ok(attrIndex < ctlIndex, 'input değerinden önce gelmeli');
  assert.ok(attrIndex < textIndex, 'temizlenmiş DOM metninden önce gelmeli');
  // Sayısal hücre Excel'de sayı kalsın diye biçim bilgisiyle yazılır.
  assert.match(body, /mso-number-format/);
  // Çok satırlı hücre tek hücrede kalmalı.
  assert.match(body, /mso-data-placement:same-cell/);
  assert.match(body, /join\('<br>'\)/);
});

test('v5.79 para biçimi Excel’in beklediği maskedir', () => {
  const line = SRC.match(/const _COPY_NUMFMT = \{[^}]*\}/);
  assert.ok(line, '_COPY_NUMFMT tanımlı olmalı');
  const map = new Function(`${line[0]}; return _COPY_NUMFMT;`)();
  assert.equal(map.money2, '\\$#,##0.00');
});
