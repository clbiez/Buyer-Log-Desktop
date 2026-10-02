'use strict';
/* TR/EN dil desteği bekçisi: arayüze eklenen her Türkçe metnin İngilizce
   karşılığı olmalıdır. Eski eksiklerin tamamı düzeltildi;
   tests/fixtures/i18n-coverage-baseline.json boştur ve boş kalmalıdır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const coverage = require('./helpers/i18n-coverage');

const HOW_TO_FIX = [
  'Her Türkçe UI metni İngilizce karşılığıyla yazılmalıdır:',
  "  • L('Kaydet','Save') / T(tr,en) yardımcıları, isEn()?'Save':'Kaydet' veya {tr:'…',en:'…'}",
  '  • statik HTML: data-i18n-tr="…" data-i18n-en="…"',
  '  • son çare: public/i18n-dictionary.js içine ["Türkçe","English"] çifti',
  '  • UI metni değilse (veri anahtarı, Excel başlığı, regex): satıra // i18n-ignore',
  'Ayrıntı: CLAUDE.md "TR/EN dil desteği". Rapor: npm run i18n:check',
].join('\n');

test('i18n bekçisi: tarayıcı tek dilli metni yakalar, TR/EN çiftlerini kabul eder', () => {
  const scan = src => coverage.scanSource(src, 'x.js').map(item => item.text);
  // Yakalanması gerekenler
  assert.deepEqual(scan("showToast('Yeni modül verisi yüklenemedi');"), ['Yeni modül verisi yüklenemedi']);
  assert.deepEqual(scan("showToast('Önce bir şablon seçin','warn');"), ['Önce bir şablon seçin']);
  assert.deepEqual(scan('el.innerHTML=`<b>${n}</b> kayıt işlendi, ${m} atlandı`;'), ['kayıt işlendi, {1} atlandı']);
  assert.deepEqual(scan("const x=ok?'Şablon aktarımı tamamlandı':'Şablon aktarımı başarısız';"), ['Şablon aktarımı tamamlandı', 'Şablon aktarımı başarısız']);
  // Kabul edilenler
  assert.deepEqual(scan("const a=L('Rapor şablonu kaydedildi','Report template saved');"), []);
  assert.deepEqual(scan("const b=isEn()?'Report template saved':'Rapor şablonu kaydedildi';"), []);
  assert.deepEqual(scan("const c={tr:'Rapor şablonu kaydedildi',en:'Report template saved'};"), []);
  assert.deepEqual(scan('const d={"label":{"tr":"Şablonlar","en":"Templates"},"steps":{"tr":["Şablonu açın."],"en":["Open the template."]}};'), []);
  assert.deepEqual(scan("const e=en?`Saved ${n} rows`:`${n} satır kaydedildi ${fmt('düz')}`;"), []);
  assert.deepEqual(scan("const f=en?'Detail: '+x:'Detayı: '+x;"), []);
  assert.deepEqual(scan("console.warn('Şablon yüklenemedi:',err);"), []);
  assert.deepEqual(scan("const g=row['Üretici Adı']; // i18n-ignore — ASAS kaynak başlığı"), []);
  assert.deepEqual(scan("// Yorumdaki Türkçe metin taranmaz\n/* çoklu satır açıklaması */"), []);
  // Sözlükte karşılığı olan metin (çalışma zamanı katmanı çevirir)
  assert.deepEqual(scan("showToast('Tüm filtreleri temizle');"), []);
});

test('i18n bekçisi: baseline dışında İngilizce karşılığı olmayan Türkçe metin yok', () => {
  const baseline = coverage.readBaseline();
  const byFile = coverage.scanAll();
  const fresh = [];
  for (const [file, list] of Object.entries(byFile)) {
    const allowed = new Set(baseline[file] || []);
    for (const item of list) if (!allowed.has(item.text)) fresh.push(`${item.file}:${item.line}  ${item.text}`);
  }
  assert.equal(fresh.length, 0, `İngilizce karşılığı olmayan yeni Türkçe metin(ler):\n${fresh.join('\n')}\n\n${HOW_TO_FIX}`);
});

test('i18n bekçisi: baseline yalnız küçülür (düzeltilen kayıtlar silinmeli)', () => {
  const baseline = coverage.readBaseline();
  const current = coverage.toBaseline(coverage.scanAll());
  const stale = [];
  for (const [file, texts] of Object.entries(baseline)) {
    const still = new Set(current[file] || []);
    for (const text of texts) if (!still.has(text)) stale.push(`${file}  ${text}`);
  }
  assert.equal(stale.length, 0, `Düzeltilmiş eksikler baseline'da duruyor; "npm run i18n:baseline" ile silin:\n${stale.join('\n')}`);
});

test('i18n bekçisi: baseline donmuş üst sınırı aşamaz ve yeni dosya içeremez', () => {
  // Eski eksiklerin tamamı düzeltildi; baseline'a kayıt eklemek kural
  // ihlalidir — metnin TR/EN çiftini yazın.
  const MAX_ENTRIES = 0;
  const FROZEN_FILES = new Set([]);
  const baseline = coverage.readBaseline();
  const total = Object.values(baseline).reduce((sum, list) => sum + list.length, 0);
  assert.ok(total <= MAX_ENTRIES, `i18n baseline büyüdü (${total} > ${MAX_ENTRIES}). Yeni eksik baseline'a eklenemez.\n${HOW_TO_FIX}`);
  const extra = Object.keys(baseline).filter(file => !FROZEN_FILES.has(file));
  assert.deepEqual(extra, [], `Yeni dosya i18n baseline'a eklenemez; yeni modüller tam TR/EN destekli olmalıdır.\n${HOW_TO_FIX}`);
});

test('i18n bekçisi: npm komutları ve çalışma sözleşmesi kuralı yerinde', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(coverage.APP_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['i18n:check'], 'node scripts/i18n-coverage.js');
  assert.equal(pkg.scripts['i18n:baseline'], 'node scripts/i18n-coverage.js --shrink-baseline');
  const contract = fs.readFileSync(path.join(coverage.APP_ROOT, '..', '..', 'CLAUDE.md'), 'utf8');
  assert.match(contract, /TR\/EN dil desteği/);
  assert.match(contract, /i18n-coverage-guard\.test\.js/);
});
