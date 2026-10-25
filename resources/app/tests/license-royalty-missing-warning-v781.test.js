'use strict';

/* Non-DTR olup eşleşen License Royalty hesabı bulunmayan model/siparişler
 * için uyarı mekanizması.
 *
 * Kullanıcı talebi: "Non-DTR olup da, license calculations rule tanımlanmamış
 * koleksiyon modelleri veya cp, orders v.b. diğer modüllerde siparişlerini
 * için bir uyarı mekanizması istiyorum. Koleksiyon tablosunda FOB
 * hesaplamasını yapmasın, royalty hucresine uyarı versin. Diğer modüllerde
 * supp FOB hücresinde uyarı versin."
 *
 * ÖLÇÜLEN KUSUR (bu görevde bulundu): Koleksiyon'da eşleşen kural yoksa
 * kolApplyRulePricing royalty ve hologramı boş bırakıyor ama FOB'u YİNE
 * hesaplıyordu. kolComputeFobFromConfirmed boş royalty'yi 0, boş hologramı
 * 0 sayar:
 *     FOB = confirmed / (1 - 0) + 0 = confirmed
 * yani royalty hiç uygulanmamış gibi, sessizce DÜŞÜK bir FOB. Kullanıcı
 * bunun yanlış olduğunu ekranda göremiyordu.
 *
 * CP/Siparişler tarafında Supp. FOB zaten null kalıyordu (recalcSuppFobForRow)
 * ama hiçbir uyarı yoktu; hücre boş görünüyor, nedeni görünmüyordu.
 *
 * DTR'de kural GEREKMEZ (royalty yok) — uyarı yalnız Non-DTR'de çıkmalı,
 * yoksa DTR ağırlıklı tabloda sürekli yanlış alarm olurdu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

/* --- Yordamları kaynaktan çıkarıp GERÇEKTEN çalıştır --------------------- */

function loadFn(name, deps) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} bulunamadı`);
  const end = APP.indexOf('\n}', start);
  assert.ok(end > -1, `${name} gövdesi kapanmıyor`);
  const src = APP.slice(start, end + 2);
  const keys = Object.keys(deps);
  return new Function(...keys, `${src} return ${name};`)(...keys.map(k => deps[k]));
}

const turknorm = v => String(v == null ? '' : v).trim().toLocaleUpperCase('tr');
const nonDtr = row => {
  const l = turknorm(row && row.licensor);
  return Boolean(l && l !== 'DTR');
};

/* --- 1) Koleksiyon: eksik kural tespiti ---------------------------------- */

test('Koleksiyon: Non-DTR + eşleşen kural yok → eksik sayılır', () => {
  const missing = loadFn('kolLicenseRuleMissing', {
    kolLicensorUnresolvedState: () => null,
    kolLandedIsNonDtr: nonDtr,
    kolFindPricingRule: () => null,
  });
  assert.equal(missing({ licensor: 'WARNER' }), true);
});

test('Koleksiyon: DTR modelinde kural aranmaz — yanlış alarm yok', () => {
  let aranan = 0;
  const missing = loadFn('kolLicenseRuleMissing', {
    kolLicensorUnresolvedState: () => null,
    kolLandedIsNonDtr: nonDtr,
    kolFindPricingRule: () => { aranan++; return null; },
  });
  assert.equal(missing({ licensor: 'DTR' }), false);
  assert.equal(missing({ licensor: '' }), false, 'licensor boşsa da DTR gibi davranır');
  assert.equal(aranan, 0, 'DTR için kural araması hiç yapılmamalı');
});

test('Koleksiyon: kural varsa uyarı yok', () => {
  const missing = loadFn('kolLicenseRuleMissing', {
    kolLicensorUnresolvedState: () => null,
    kolLandedIsNonDtr: nonDtr,
    kolFindPricingRule: () => ({ id: 'r1', royalty: 12, hologramCost: 0.1 }),
  });
  assert.equal(missing({ licensor: 'WARNER' }), false);
});

/* --- 2) Koleksiyon: FOB artık hesaplanmıyor ------------------------------ */

function loadApplyRulePricing(rule) {
  /* Gerçek kolParseMoneyNum yüzde işaretini ve boşlukları soyar; stub bunu
     yapmazsa royalty '10.00%' NaN'a düşer ve test sessizce royaltysiz FOB
     ölçer (ilk yazımda tam bu oldu). */
  const parse = v => {
    const n = Number(String(v == null ? '' : v).replace(',', '.').replace(/[%\s$]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  return loadFn('kolApplyRulePricing', {
    kolLicensorUnresolvedState: () => null,
    kolFindPricingRule: () => rule,
    kolFormatPercentDisplay: v => `${Number(v).toFixed(2)}%`,
    kolFormatHologramDisplay: v => String(v),
    kolFormatMoneyDisplay: v => Number(String(v).replace(',', '.')).toFixed(2),
    kolParseMoneyNum: parse,
    kolLandedIsNonDtr: nonDtr,
    kolSuppFob: row => (row && row.__fobSource) || null,
    kolComputeFobFromConfirmed: (conf, royaltyPct, hologram) => {
      const c = parse(conf);
      if (!Number.isFinite(c)) return '';
      const r = parse(royaltyPct), rFrac = Number.isFinite(r) ? r / 100 : 0;
      const h = parse(hologram), hNum = Number.isFinite(h) ? h : 0;
      return (c / (1 - rFrac) + hNum).toFixed(2);
    },
    editableValuesEqual: (a, b) => String(a ?? '') === String(b ?? ''),
  });
}

test('Koleksiyon: Non-DTR + kural yok → FOB HESAPLANMAZ', () => {
  /* Korunan kusur: eskiden burada FOB = 5.00 (royalty 0 sayıldığı için)
     çıkıyordu. Onaylı fiyat duruyor ama royalty bilinmiyor; royaltysiz bir
     FOB yanlış bir sayıdır, boş bırakmak doğrudur. */
  const apply = loadApplyRulePricing(null);
  /* Satıra ÖNCEDEN yanlış bir FOB konuyor: düzeltmenin yalnız "yazmamak"
     değil, eski yanlış değeri TEMİZLEMEK de olması gerek — kural silinince
     ekranda eski royaltysiz FOB kalmamalı. */
  const row = {
    licensor: 'WARNER', fob: '9.99', royalty: '10.00%', hologramCost: '0.1',
    __fobSource: { price: '5.00', source: 'confirmed' },
  };
  apply(row);
  assert.equal(row.fob, '', 'royalty bilinmeden FOB yazılmamalı, eski değer de temizlenmeli');
  assert.equal(row.royalty, '', 'kural gidince royalty de temizlenmeli');
  assert.equal(row.hologramCost, '');
});

test('Koleksiyon: DTR + kural yok → FOB hesaplanmaya devam eder', () => {
  /* DTR'de royalty zaten yok; kural aramak gerekmez, FOB = onaylı fiyat
     DOĞRUdur. Bu satır uyarıdan etkilenmemeli. */
  const apply = loadApplyRulePricing(null);
  const row = { licensor: 'DTR', __fobSource: { price: '5.00', source: 'confirmed' } };
  apply(row);
  assert.equal(row.fob, '5.00');
});

test('Koleksiyon: Non-DTR + kural VAR → FOB royalty ile hesaplanır', () => {
  const apply = loadApplyRulePricing({ id: 'r1', royalty: 10, hologramCost: 0.1 });
  const row = { licensor: 'WARNER', __fobSource: { price: '5.00', source: 'confirmed' } };
  apply(row);
  assert.equal(row.fob, '5.66', '5 / (1 - 0.10) + 0.1');
  assert.equal(row.royalty, '10.00%');
});

/* --- 3) CP / Siparişler: eksik kural tespiti ----------------------------- */

function loadSuppFobRuleMissing({ rule = null, manual = false } = {}) {
  return loadFn('suppFobRuleMissing', {
    turknorm,
    hasManualSuppFob: () => manual,
    findSuppFobRule: () => rule,
  });
}

test('CP/Siparişler: Non-DTR + kural yok → eksik sayılır', () => {
  const missing = loadSuppFobRuleMissing();
  assert.equal(missing({ Licensor: 'WARNER' }), true);
});

test('CP/Siparişler: DTR satırında uyarı yok', () => {
  const missing = loadSuppFobRuleMissing();
  assert.equal(missing({ Licensor: 'DTR' }), false);
  assert.equal(missing({ Licensor: '' }), false);
});

test('CP/Siparişler: elle girilmiş Supp. FOB uyarı üretmez', () => {
  /* Kullanıcı değeri bilerek yazmış; kural aramasına ihtiyacı yok ve
     "eksik kural" uyarısı onu yanlış yönlendirirdi. */
  const missing = loadSuppFobRuleMissing({ manual: true });
  assert.equal(missing({ Licensor: 'WARNER' }), false);
});

test('CP/Siparişler: kural varsa uyarı yok', () => {
  const missing = loadSuppFobRuleMissing({ rule: { id: 'r1', royalty: 12 } });
  assert.equal(missing({ Licensor: 'WARNER' }), false);
});

/* --- 4) Uyarı GÖRÜNÜYOR mu: hücre çizimi -------------------------------- */

test('Koleksiyon royalty hücresi uyarıyı gösteriyor', () => {
  const start = APP.indexOf('const ruleMissing=c.k===');
  assert.ok(start > -1, 'royalty hücresinde eksik kural kontrolü yok');
  const block = APP.slice(start, start + 1400);
  assert.match(block, /c\.k==='royalty'&&kolLicenseRuleMissing\(r\)/,
    'uyarı ROYALTY hücresine bağlı değil');
  assert.match(block, /kolLicenseRuleMissingText\(r\)/, 'hücre başlığı uyarı metnini kullanmıyor');
  assert.match(block, /kolRuleMissing/, 'uyarı sınıfı yok');
  assert.match(block, /⚠/, 'görsel uyarı işareti yok');
  /* Renk INLINE style ile veriliyor; bir CSS sınıfı onu ezemezdi, bu yüzden
     uyarı rengi de inline koşulda olmalı. */
  assert.match(block, /ruleMissing\?'var\(--ui-warning\)'/, 'uyarı rengi inline koşulda değil');
});

test('CP/Siparişler Supp. FOB hücresi uyarıyı gösteriyor', () => {
  const start = APP.indexOf("case 'moneyEdit': {");
  assert.ok(start > -1, 'moneyEdit hücresi bulunamadı');
  const block = APP.slice(start, start + 1600);
  assert.match(block, /const ruleMissing = suppFobRuleMissing\(r\);/);
  assert.match(block, /ruleMissing \? suppFobRuleMissingText\(\) : suppFobHoverText\(r\)/,
    'uyarı metni normal hover metninin yerine geçmiyor');
  assert.match(block, /suppFobRuleMissing'/, 'uyarı sınıfı yok');
  assert.match(block, /ruleMissing\?'⚠':unit/, 'görsel uyarı işareti yok');
});

test('uyarı metinleri iki dilde ve tek yerden geliyor', () => {
  /* Aynı cümle hem hücre başlığında hem rozet mantığında kullanılıyor;
     iki ayrı yerde tutulsa biri güncellenip diğeri eskirdi. */
  assert.match(APP, /function suppFobRuleMissingText\(\)\{/);
  assert.match(APP, /function kolLicenseRuleMissingText\(row\)\{/);
  for (const fn of ['suppFobRuleMissingText', 'kolLicenseRuleMissingText']) {
    const start = APP.indexOf(`function ${fn}(`);
    const block = APP.slice(start, APP.indexOf('\n}', start));
    assert.match(block, /appLang==='en'/, `${fn} İngilizce karşılık taşımıyor`);
    assert.match(block, /License Royalty/, `${fn} kullanıcıyı kuralın tanımlandığı yere yönlendirmiyor`);
  }
});

test('kolLicenseRuleMissingText eksik alanı adıyla söylüyor', () => {
  /* "Kural yok" ile "bu satırda Ülke/License boş olduğu için eşleşemiyor"
     aynı sonuca çıkar ama ÇÖZÜMLERİ farklıdır; mesaj ikisini ayırmalı. */
  const text = loadFn('kolLicenseRuleMissingText', {
    kolLicensorUnresolvedState: () => null,
    kolPricingRuleContext: row => row.__ctx,
    appLang: 'tr',
  });
  const eksikUlke = text({ __ctx: { country: '', license: 'L1', licensor: 'WARNER' } });
  assert.match(eksikUlke, /Ülke/);
  const tamBaglam = text({ __ctx: { country: 'TR', license: 'L1', licensor: 'WARNER' } });
  assert.match(tamBaglam, /License Royalty/);
  assert.doesNotMatch(tamBaglam, /boş olduğu için/);
});

/* --- 5) Şablonu GERÇEKTEN çalıştır: üretilen HTML'i ölç ------------------
   Kaynak metin eşleşmesi "doğru değişken adı yazılmış mı"yı söyler, ama
   hücrenin gerçekten uyarıyı BASIP basmadığını söylemez. Aşağıdaki iki test
   şablon satırını kaynaktan kesip değerlendiriyor. */

function renderTemplate(lineMatcher, scope) {
  const line = APP.split(/\r?\n/).find(lineMatcher);
  assert.ok(line, 'şablon satırı bulunamadı');
  const expr = line.slice(line.indexOf('`'));
  const body = expr.replace(/;\s*$/, '');
  const keys = Object.keys(scope);
  return new Function(...keys, `return ${body};`)(...keys.map(k => scope[k]));
}

test('royalty hücresi şablonu uyarı durumunda ⚠ ve turuncu rengi BASIYOR', () => {
  const html = renderTemplate(
    l => l.includes('html+=`<td class="num kolRuleReadonly'),
    {
      fobFallback: false, ruleMissing: true, rc: ' data-key="royalty"',
      cellTitle: 'Kural yok', display: '—', escapeHtml: v => String(v),
    },
  );
  assert.match(html, /class="num kolRuleReadonly kolRuleMissing"/);
  assert.match(html, /⚠/);
  assert.match(html, /color:var\(--ui-warning\)/);
  assert.match(html, /title="Kural yok"/);
});

test('royalty hücresi şablonu normal durumda uyarı BASMIYOR', () => {
  const html = renderTemplate(
    l => l.includes('html+=`<td class="num kolRuleReadonly'),
    {
      fobFallback: false, ruleMissing: false, rc: ' data-key="royalty"',
      cellTitle: 'License Royalty hesabından', display: '12,00%', escapeHtml: v => String(v),
    },
  );
  assert.doesNotMatch(html, /kolRuleMissing/);
  assert.doesNotMatch(html, /⚠/);
  assert.doesNotMatch(html, /var\(--ui-warning\)/);
  assert.match(html, /12,00%/);
});

test('Supp. FOB hücresi şablonu uyarı durumunda birim yerine ⚠ gösteriyor', () => {
  const html = renderTemplate(
    l => l.includes('return `<td class="editTd money${autoSource?'),
    {
      autoSource: false, ruleMissing: true, tt: ' title="Kural yok"',
      unit: '$', cur: '', id: 42, c: { k: 'Supp. FOB' },editorIdentity:' data-line-key="42|DEMO|01" data-edit-owner="buyer"',
    },
  );
  assert.match(html, /suppFobRuleMissing/);
  assert.match(html, /⚠/);
  assert.match(html, /color:var\(--ui-warning\)/);
  assert.doesNotMatch(html, />\$</, 'uyarı varken para birimi gösterilmemeli');
  assert.match(html,/data-line-key="42\|DEMO\|01"/);
});

/* --- 6) TR Landed / Overseas Landed: aynı kural landed'a da uygulanıyor -- */

function loadLandedCalc({ licenseRuleMissing, trLicenseRuleMissing = licenseRuleMissing, trRule = null }) {
  const parse = v => {
    if (v === '' || v == null) return NaN;
    const n = Number(String(v).replace(/\s/g, '').replace('%', '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const start = APP.indexOf('function kolLandedIsNonDtr(');
  const end = APP.indexOf('\nfunction kolLandedCalc(', start);
  const endFull = APP.indexOf('\n}', end) + 2;
  const src = APP.slice(start, endFull) + '\nreturn {kolLandedIsNonDtr,kolLandedPriceWithCosts,kolLandedPriceWithRule,kolLandedCalc};';
  return new Function(
    'turknorm', 'kolParseMoneyNum', 'kolAutoFx', 'kolSuppFob',
    'kolDefaultLandedMultipliers', 'KOL_TR_LANDED_MULT', 'KOL_YD_LANDED_MULT',
    'kolLicenseRuleMissing', 'kolFindPricingRuleForCountryGroup', 'kolTrLicenseRuleMissing', src,
  )(
    turknorm, parse, () => 40, row => row.__suppFob || null,
    () => ({ tr: 1.05, overseas: 1.11 }), 1.05, 1.11,
    licenseRuleMissing, (_row, group) => group === 'TR' ? trRule : null, trLicenseRuleMissing,
  );
}

test('TR Landed: Non-DTR + TR kuralı yok → yalnız TR HESAPLANMAZ, TR kuralı varsa hesaplanır', () => {
  const row = { licensor: 'WARNER', trPrice: '100', trFx: '40', trLandedMult: '1', royalty: '10%', hologramCost: '0', __suppFob: { price: '1', source: 'confirmed' } };

  const missing = loadLandedCalc({
    licenseRuleMissing: () => false,
    trLicenseRuleMissing: () => true,
    trRule: null,
  });
  const kMissing = missing.kolLandedCalc(row);
  assert.equal(kMissing.trLanded, null, 'TR kuralı yokken TR Landed royaltysiz (yanlış) hesaplanmamalı');
  assert.equal(kMissing.trRuleMissing, true, 'TR Landed kendi uyarı bayrağını taşımıyor');
  assert.equal(kMissing.ruleMissing, false, 'TR kuralı eksikliği Overseas kuralını eksik göstermemeli');

  const present = loadLandedCalc({
    licenseRuleMissing: () => false,
    trLicenseRuleMissing: () => false,
    trRule: { countryGroup: 'TR', royalty: 25, hologramCost: 0.05 },
  });
  const kPresent = present.kolLandedCalc(row);
  assert.equal(Number(kPresent.trLanded.toFixed(4)), 3.3833, '(($100/40)/(1-0.25)+0.05)*1');
  assert.equal(kPresent.trRuleMissing, false);
  assert.equal(kPresent.trRoyaltyPct, 25);
  assert.equal(kPresent.trHologramCost, 0.05);
});

test('Overseas Landed: Non-DTR + kural yok → HESAPLANMAZ', () => {
  const row = { licensor: 'WARNER', ydLandedMult: '1', royalty: '25%', hologramCost: '0.05', __suppFob: { price: '1', source: 'confirmed' } };
  const missing = loadLandedCalc({ licenseRuleMissing: () => true });
  const k = missing.kolLandedCalc(row);
  assert.equal(k.ydLanded, null, 'kural yokken Overseas Landed royaltysiz hesaplanmamalı');
});

test('DTR satırında landed hesabı ruleMissing hep false döndürür', () => {
  /* Gerçek kolLicenseRuleMissing DTR'yi kendi içinde eler (bkz. testler
     1-3); burada kolLandedCalc'ın o sonucu SORGUSUZ kabul ettiğini
     ölçüyoruz — stub gerçek fonksiyonun DTR davranışını taklit ediyor. */
  const row = { licensor: 'DTR', trPrice: '100', trFx: '40', trLandedMult: '1', ydLandedMult: '1', __suppFob: { price: '1', source: 'confirmed' } };
  const mod = loadLandedCalc({
    licenseRuleMissing: r => turknorm(r.licensor) !== 'DTR',
    trLicenseRuleMissing: r => turknorm(r.licensor) !== 'DTR',
  });
  const k = mod.kolLandedCalc(row);
  assert.equal(k.ruleMissing, false);
  assert.equal(k.trRuleMissing, false);
  assert.equal(k.trLanded, 2.5, 'DTR royaltysiz hesaplanmaya devam etmeli');
  assert.equal(k.ydLanded, 1);
});

test('kolLandedPriceWithCosts kural yoksa null döner (tek gerçek kaynak)', () => {
  const mod = loadLandedCalc({ licenseRuleMissing: () => true });
  const row = { licensor: 'WARNER', royalty: '25%', hologramCost: '0.05' };
  assert.equal(mod.kolLandedPriceWithCosts(100, row), null);
});

test('TR Landed hücre şablonu uyarı sınıfını, ⚠ işaretini ve turuncu rengi taşıyor', () => {
  const start = APP.indexOf("const trCostTitle=k.trRuleMissing");
  assert.ok(start > -1, 'trCostTitle bulunamadı');
  const block = APP.slice(start, APP.indexOf('</div></td>`;', start) + 20);
  assert.match(block, /kolLandedTd\$\{k\.trRuleMissing\?' kolRuleMissing':''\}/,
    'TR Landed <td> TR kural uyarısına bağlı değil');
  assert.match(block, /\$\{k\.trRuleMissing\?'⚠':\(k\.trLanded==null/,
    'TR Landed değeri TR kuralı eksikken ⚠ göstermiyor');
  assert.match(block, /style="\$\{k\.trRuleMissing\?'color:var\(--ui-warning\);':''\}"/,
    'TR Landed rengi TR kuralı eksikken turuncu değil');
  assert.match(block, /kolTrLicenseRuleMissingText\(r\)/,
    'TR Landed başlığı TR kuralına özel uyarı metnini kullanmıyor');
});

test('Overseas Landed hücre şablonu uyarı sınıfını, ⚠ işaretini ve turuncu rengi taşıyor', () => {
  const start = APP.indexOf("const ydCostTitle=k.ruleMissing");
  assert.ok(start > -1, 'ydCostTitle bulunamadı');
  const block = APP.slice(start, APP.indexOf('</div></td>`;', start) + 20);
  assert.match(block, /kolLandedTd\$\{k\.ruleMissing\?' kolRuleMissing':''\}/,
    'Overseas Landed <td> uyarı sınıfı koşula bağlı değil');
  assert.match(block, /\$\{k\.ruleMissing\?'⚠':\(k\.ydLanded==null/,
    'Overseas Landed değeri uyarıda ⚠ göstermiyor');
  assert.match(block, /style="\$\{k\.ruleMissing\?'color:var\(--ui-warning\);':''\}"/,
    'Overseas Landed rengi uyarıda turuncu değil');
  assert.match(block, /kolLicenseRuleMissingText\(r\)/,
    'Overseas Landed başlığı uyarı metnini kullanmıyor');
});
