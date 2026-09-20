'use strict';

/* ASAS ↔ IAS EŞLEŞTİRME KURALI NEREDE YAŞAR?
 *
 * Korunan karar: bu komut AYARLAR MENÜSÜNDE durmamalı. Eşleştirme kuralı bir
 * uygulama tercihi değil, kaynak yapılandırmasının parçasıdır; ayarlar
 * menüsünde dururken kullanıcılar onu hiç bulamıyordu.
 *
 * v7.81: kural eski "Horizon ve Bağlantı" modalının alt çubuğundan Veri
 * Yönetimi ekranına taşındı. Karar aynı karar — kaynak yapılandırmasının
 * yanında — ama artık ORTAK ayarların tamamının bulunduğu yerde.
 *
 * Ayrıca: kural TEK bir kaynağın özelliği değil, İKİ kaynak ARASINDAKİ
 * ilişkidir. ASAS kartının içine koymak "ASAS ayarı" izlenimi verir ve
 * kullanıcı IAS tarafını değiştirmek istediğinde yanlış kartta arar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const DM = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
const RULE = fs.readFileSync(path.join(ROOT, 'public', 'data-management-matchrule.js'), 'utf8');

test('eşleştirme komutu ayarlar menüsünde DEĞİL, kaynak yapılandırmasının yanındadır', () => {
  assert.doesNotMatch(INDEX, /id="matchRuleBtn"/);
  assert.doesNotMatch(APP, /matchRuleBtn/);
  // Yeni yeri: Veri Yönetimi ekranı.
  assert.match(DM, /data-open-matchrule/);
  assert.match(DM, /function openMatchRule\(\)/);
  assert.match(RULE, /window\.BLDataMatchRule = \{ open, close \}/);
});

test('kural bir kaynağın İÇİNDE değil, kaynakların ARASINDA durur', () => {
  /* matchRuleRow() kaynak kartlarının ayrıntı panelinde değil, şeridin
     altında çiziliyor.

     v7.82: görünürlük koşulu artık KAYNAK ADIYLA yazılmaz. Satır, aynı modülü
     birden fazla kaynak beslediğinde görünür — eşleştirme sorusu tam olarak o
     zaman doğar. Eski koşul ("asas-orders VE ias-warehouse bağlı mı") üçüncü
     bir veritabanı eklendiğinde bu satırı görünmez bırakırdı. */
  const row = DM.match(/function matchRuleRow\(\) \{[\s\S]*?\n  \}/);
  assert.ok(row, 'matchRuleRow bulunamadı');
  assert.match(row[0], /module\.feeds|feeds \|\| \[\]/, 'görünürlük paylaşılan beslemeden okunmalı');
  assert.match(row[0], /ids\.size >= 2/, 'iki kaynağın aynı modülü beslemesi koşul olmalı');
  /* Kaynağa özgü kimlik GÖMÜLMEZ: yeni bir veritabanı bu satırı değiştirmeden
     eşleştirmeye katılabilmeli. */
  assert.doesNotMatch(row[0], /asas-orders|ias-warehouse|hasAsas|hasIas/);
  // Kaynak ayrıntısının içinde çizilmemeli.
  const detail = DM.match(/function sourceDetail\(source\) \{[\s\S]*?\n  \}/);
  assert.ok(detail);
  assert.doesNotMatch(detail[0], /matchRule/);
});

test('kural yazma yolu YENİDEN YAZILMADI; mevcut uç kullanılır', () => {
  /* İkinci bir yazma yolu, ikinci bir doğrulama demek olurdu (§9).
     validateMatchConfig sunucuda duruyor ve tek yetkili yer o. */
  const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(SERVER, /app\.put\('\/api\/match-rule'/);
  assert.match(RULE, /fetch\('\/api\/match-rule'/);
  /* Yorumlar ELENİR: bu dosyanın kendi açıklaması validateMatchConfig'in
     sunucuda olduğunu anlatıyor ve ham eşleştirme onu kod sanardı. */
  const ruleCode = RULE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(ruleCode, /validateMatchConfig/);
});

test('denetim (match-audit) taşındı, silinmedi ve tablosu ÇOĞALTILMADI', () => {
  /* Denetim kuralın gerçekten çalışıp çalışmadığını gösteren tek araçtı;
     ekran taşınırken düşürülseydi kullanıcı kuralı körlemesine kurardı. */
  assert.match(RULE, /\/api\/match-audit/);
  assert.match(RULE, /renderMatchAudit\(payload, en\(\)\)/, 'mevcut tablo bileşeni kullanılmalı');
  assert.match(APP, /function renderMatchAudit\(/, 'tablo bileşeni yerinde kalmalı');
  assert.equal((RULE.match(/matchAuditRow|<table/g) || []).length, 0, 'ikinci bir denetim tablosu yazılmamalı');
});
