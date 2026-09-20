'use strict';

/*
 * v7.39 — KULLANICI ADI ALANI
 *
 * Kullanıcı sorusu (birebir):
 *   "kullanıcı adı nasıl tanımlayacağım? Girişte kullanıcıların adı soyadını
 *    girerken önerilen kişi adına tıklayınca kullanıcı adı tanımlı değil
 *    uyarısı alıyorum"
 *
 * BULGU: sunucu kullanıcı adını GÜNCELLEMEYİ zaten kabul ediyordu
 * (applyBodyToTarget · body.username) ama ARAYÜZDE HİÇBİR YERDE ALAN YOKTU.
 * Yeni kullanıcıda ad sessizce "Ad Soyad"tan türetiliyor, sonradan hiç
 * değiştirilemiyordu. Adı boş kalan bir kayıt varsa giriş ekranı doğru uyarıyı
 * veriyor ama düzeltilecek yer bulunamıyordu — sorunun tamamı buydu.
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *   1) Düzenle formunda ve Yeni Kullanıcı penceresinde kullanıcı adı alanı var.
 *   2) Alan BOŞ bırakılırsa kullanıcının mevcut adı DEĞİŞMEZ (§142): boş değer
 *      sunucuya hiç gönderilmez, aksi hâlde sunucu tüm kaydı reddederdi.
 *   3) Adı tanımsız kullanıcı LİSTEDE görünür — tek tek kart açmadan bulunur.
 *   4) Giriş ekranındaki uyarı, düzeltilecek yeri adıyla söyler.
 *   5) Sunucudaki benzersizlik ve zorunluluk kuralları yerinde kalır (§32).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UM = read('public/user-management.js');
const LOGIN = read('public/select-user.html');
const ACCESS = read('server/lib/user-access.js');

/* ------------------------------------------------------------------ */
/* 1) SORUNUN KAYNAĞI                                                  */
/* ------------------------------------------------------------------ */

test('v7.39 · sunucu kullanıcı adını zaten kabul ediyordu (eksik olan arayüzdü)', () => {
  assert.match(ACCESS, /if \(body\.username != null\) \{ ensureUniqueUsername\(store, body\.username, target\.id\); target\.username = clean\(body\.username\)\.slice\(0, 120\); \}/);
});

test('v7.39 · boş kullanıcı adı sunucuda reddedilir — bu yüzden boş gönderilmez', () => {
  assert.match(ACCESS, /if \(!key\) throw hierarchyError\('Kullanıcı adı zorunludur\.', 'USERNAME_REQUIRED'\);/);
  assert.match(UM, /\.\.\.\(clean\(data\.get\('username'\)\) \? \{ username: clean\(data\.get\('username'\)\) \} : \{\}\)/,
    'boş alan hiç gönderilmemeli, yoksa tüm kaydetme hataya düşerdi');
});

test('v7.39 · benzersizlik kuralı yerinde (§32)', () => {
  assert.match(ACCESS, /if \(allProfiles\(store\)\.some\(profile => profile\.id !== exceptId && usernameKey\(profile\.username\) === key\)\) throw hierarchyError\('Bu kullanıcı adı zaten kullanılıyor\.'/);
});

/* ------------------------------------------------------------------ */
/* 2) DÜZENLE FORMU                                                    */
/* ------------------------------------------------------------------ */

test('v7.39 · düzenle formunda kullanıcı adı alanı var ve mevcut değerle dolu gelir', () => {
  const form = UM.slice(UM.indexOf('function detailEdit(user)'), UM.indexOf('/* ===================== 7b'));
  assert.match(form, /<input name="username" required value="\$\{esc\(user\.username \|\| ''\)\}"/);
  assert.match(form, /Kullanıcı adı/);
});

test('v7.39 · adı tanımsız kullanıcıya ne yapacağı formda yazılır', () => {
  const form = UM.slice(UM.indexOf('function detailEdit(user)'), UM.indexOf('/* ===================== 7b'));
  assert.match(form, /Bu kullanıcının adı TANIMSIZ/);
  assert.match(form, /Giriş ekranında bu ad yazılır/, 'tanımlıyken de ne işe yaradığı söylenmeli');
});

test('v7.39 · kullanıcı adı değişince parolanın değişmediği söylenir', () => {
  assert.match(UM, /kullanıcı yeni adıyla girer; parolası değişmez/);
});

/* ------------------------------------------------------------------ */
/* 3) YENİ KULLANICI PENCERESİ                                         */
/* ------------------------------------------------------------------ */

test('v7.39 · yeni kullanıcı penceresinde de alan var', () => {
  const dialog = UM.slice(UM.indexOf('function openCreateDialog(managerId)'), UM.indexOf("confirmLabel: T('Kullanıcıyı Oluştur'"));
  assert.match(dialog, /<input name="username" data-um-username required/);
});

test('v7.39 · Ad Soyad yazıldıkça kullanıcı adı dolar, ELLE yazılan üzerine yazılmaz', () => {
  assert.match(UM, /if \(usernameField && usernameField\.dataset\.umTouched !== '1'\) usernameField\.value = nameField\.value;/);
  assert.match(UM, /if \(event\.target\.closest\('\[data-um-username\]'\)\) event\.target\.dataset\.umTouched = '1';/);
});

test('v7.39 · dizinden aday seçilince kullanıcı adı da dolar', () => {
  assert.match(UM, /if \(usernameField && usernameField\.dataset\.umTouched !== '1'\) usernameField\.value = entry\.displayName;/);
});

test('v7.39 · alan boş bırakılırsa eski davranış korunur (ad soyad kullanılır)', () => {
  assert.match(UM, /username: clean\(data\.get\('username'\)\) \|\| clean\(data\.get\('displayName'\)\)/);
});

/* ------------------------------------------------------------------ */
/* 4) TANIMSIZ OLANI BULMAK                                            */
/* ------------------------------------------------------------------ */

test('v7.39 · kullanıcı adı listede bir sütun olarak görünür', () => {
  assert.match(UM, /<th>\$\{esc\(T\('Kullanıcı adı', 'User name'\)\)\}<\/th>/);
  assert.match(UM, /\$\{clean\(user\.username\) \? esc\(user\.username\)/);
});

test('v7.39 · tanımsız olan listede ve özet kartında UYARI olarak görünür', () => {
  assert.match(UM, /class="umWarn" title="\$\{esc\(T\('Giriş ekranında seçilebiliyor ama giriş yapamıyor\./);
  assert.match(UM, /Kullanıcı adı tanımsız: bu kişi giriş ekranında seçilebiliyor ama giriş yapamıyor\. Düzenle > Kullanıcı adı alanından tanımlayın\./);
});

test('v7.39 · özet kartında kullanıcı adı satırı var', () => {
  const block = UM.slice(UM.indexOf('function detailSummary(user)'), UM.indexOf('function detailEdit(user)'));
  assert.match(block, /<dt>\$\{esc\(T\('Kullanıcı adı', 'User name'\)\)\}<\/dt>/);
});

/* ------------------------------------------------------------------ */
/* 5) GİRİŞ EKRANI                                                     */
/* ------------------------------------------------------------------ */

test('v7.39 · giriş uyarısı düzeltilecek yeri ADIYLA söyler', () => {
  assert.match(LOGIN, /Kullanıcı & Yetki Yönetimi > kullanıcıyı aç > Düzenle > “Kullanıcı adı” alanından tanımlayabilir\./);
  assert.doesNotMatch(LOGIN, /yönetici kullanıcı kartından tanımlamalıdır/, 'yeri söylemeyen eski metin kalmamalı');
});

test('v7.39 · uyarı verilirken kullanıcının yazdığı metin hâlâ silinmez (v7.26 davranışı)', () => {
  const block = LOGIN.slice(LOGIN.indexOf('function choose(index)'), LOGIN.indexOf('function clearSelected()'));
  const warnAt = block.indexOf('setError(tr(');
  const assignAt = block.indexOf("$('username').value = selected.loginName;");
  assert.ok(warnAt > -1 && assignAt > warnAt, 'uyarıdan sonra return edilmeli, alan yazılmamalı');
  assert.match(block, /return;\s*\n\s*\}\s*\n\s*selected = candidate;/);
});

/* v7.40 — GÜNCELLENDİ (§156). Amaç aynı; sabit sürüm beklemek bu testi her
   yükseltmede engele çevirirdi. v7.39 kaydının geçmişte durduğu doğrulanır. */
test('v7.39/v7.40 sürüm tüm dosyalarda birlikte ilerliyor — canonical runtime source', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik sürüm cache etiketi kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.39'/, 'geçmiş sürüm kaydı korunmalı');
});
