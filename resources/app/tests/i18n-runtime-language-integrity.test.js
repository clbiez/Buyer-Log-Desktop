'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

function loadRuntime() {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(read('i18n-dictionary.js'), context);
  vm.runInContext(read('i18n-runtime.js'), context);
  return window;
}

test('dil katmanı: EN kipinde Türkçe, TR kipinde İngilizce metin karşılığına tamamlanır', () => {
  const { BLI18n } = loadRuntime();
  const T = BLI18n.translate;
  assert.equal(T('Tüm filtreleri temizle', 'en'), 'Clear all filters');
  assert.equal(T('Apply', 'tr'), 'Uygula');
  // Ters sıralı yardımcılardan toplanan çiftler dili karıştırmamalı.
  assert.equal(T('Uygula', 'tr'), 'Uygula');
  assert.equal(T('Uygula', 'en'), 'Apply');
  // Yer tutucu, önek ve ayırıcılı bileşik metinler.
  assert.equal(T('3 satır', 'en'), '3 rows');
  assert.equal(T('Ön maliyet oluşturulamadı: Bağlantı başarısız oldu.', 'en'), 'Preliminary costing could not be created: Connection failed.');
  assert.equal(T('Güncel Durum → Antrepo Giriş Tarihi', 'en'), 'Current Status → Antrepo Entry Date');
  assert.equal(T('Filtrele: Country', 'tr'), 'Filtrele: Ülke');
  assert.equal(T('Create 0 · Update 0 · Delete 0', 'tr'), 'Oluştur 0 · Güncelle 0 · Sil 0');
  // Sunucu hata mesajları da çevrilir.
  assert.equal(T('Sync klasörü ayarlanmadı.', 'en'), 'Sync folder is not set.');
  // Bilinçli ortak jargon ve saat gibi veriler değişmez.
  assert.equal(T('CP Tracker', 'tr'), 'CP Tracker');
  assert.equal(T('12:30', 'en'), '12:30');
});

test('dil katmanı sözlüğü: yer tutucular eşleşir ve çift yönleri tutarlıdır', () => {
  const { BL_I18N_DICTIONARY } = loadRuntime();
  const TR = /[çğıİöşüÇĞŞÜÖ]/;
  const ph = value => (value.match(/\{\d+\}/g) || []).sort().join(',');
  assert.ok(BL_I18N_DICTIONARY.pairs.length > 5000);
  for (const [tr, en] of BL_I18N_DICTIONARY.pairs) {
    assert.equal(ph(tr), ph(en), `yer tutucu uyuşmazlığı: ${tr}`);
    assert.ok(!(TR.test(en) && !TR.test(tr)), `ters çift: ${tr} → ${en}`);
  }
});

test('dil katmanı veri hücrelerine, input değerlerine ve değersiz option metnine dokunmaz', () => {
  const runtime = read('i18n-runtime.js');
  assert.match(runtime, /function isDataCell\(cell\)/);
  assert.match(runtime, /TEXT_ONLY_SKIP=new Set\(\['TEXTAREA','INPUT','SELECT'\]\)/);
  assert.match(runtime, /el\.tagName==='OPTION'&&!el\.hasAttribute\('value'\)/);
});

test('dil değişimi dil katmanını ve Siparişler yeniden çizimini tetikler; takvim dili izler', () => {
  const app = read('app-main.js');
  const html = read('index.html');
  assert.match(html, /<script src="i18n-dictionary\.js\?v=__BL_ASSET_VERSION__"><\/script>\n<script src="i18n-runtime\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
  assert.match(app, /window\.BLI18n\?\.setLanguage\?\.\(appLang\)/);
  assert.match(app, /\['cp','orders','overview'\]\.forEach/);
  assert.match(app, /const calEn=appLang==='en';/);
  assert.match(app, /DATE_CAL_MONTHS_EN=\['January'/);
  assert.match(html, /data-i18n-tr="Genişletilmiş" data-i18n-en="Extended"/);
});

test('giriş ekranı dil katmanını oturum öncesi yükleyebilir', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const login = read('select-user.html');
  assert.match(server, /for \(const file of \['i18n-dictionary\.js', 'i18n-runtime\.js'\]\)/);
  assert.match(login, /<script src="\/i18n-runtime\.js"><\/script>/);
  assert.match(login, /window\.BLI18n\.setLanguage\(lang\)/);
});
