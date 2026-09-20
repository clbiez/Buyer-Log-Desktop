'use strict';

/*
 * v7.25 — ÜÇ SAHA BULGUSU
 *
 * 1) "kullanıcı ayarlarında ASAS'daki tüm buying group'lar, MAG'lar ve
 *     MMYG'ler görünmüyor."
 *    Sebep: listeler orderAccess'ten türetiliyordu. orderAccess bir YETKİ
 *    kaynağıdır ve bilerek dardır — yalnız sayısal sipariş kodlu satırlar,
 *    üstelik "adet > 0" ve "Buyer Grup ≠ YARDIM" süzgecinden geçmiş ASAS
 *    satırları. Artık seçim listeleri AYRI ve BİRİKİMLİ bir katalogdan gelir.
 *
 * 2) "Moderatörlerin de yöneticisi olabilir."
 *    Kök Moderatör hesabının managerId'si her normalizasyonda null'a
 *    çekiliyordu; atansa bile kayboluyordu.
 *
 * 3) "Fatih av yazınca öneri olarak FATİH AVCI çıkıyor ancak üzerine
 *     tıkladığımda hiçbir şey olmuyor, metin siliniyor."
 *    Sebep: mouseenter her seferinde bütün öneri listesini yeniden çiziyordu.
 *    İmleç ÖNERİ ÜZERİNDE DURURKEN bile tarayıcı yeni öğeye tekrar mouseenter
 *    gönderdiği için bu kendini besleyen bir döngüydü (ölçüm: imleç
 *    kıpırdamadan 1,5 saniyede 92 yeniden çizim). Tıklamanın dayandığı düğme
 *    saniyede onlarca kez DOM'dan siliniyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-v725-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const userAccess = require('../server/lib/user-access');
const iam = require('../server/lib/iam-core');

const ROOT = path.join(__dirname, '..');
const SELECT_USER = fs.readFileSync(path.join(ROOT, 'public', 'select-user.html'), 'utf8');
const UM = fs.readFileSync(path.join(ROOT, 'public', 'user-management.js'), 'utf8');

/* ------------------------------- 1) BİRİKİMLİ MAG / MMYG / BUYING GROUP */

const WIDE = [
  { ocode: 1001, buyer: 'AYŞE', merch: 'CU4E', ageGroup: 'KADIN', buyerGrup: 'DOKUMA' },
  { ocode: 1002, buyer: 'MEHMET', merch: 'CU4E', ageGroup: 'KADIN', buyerGrup: 'LİSANS' },
  { ocode: 1003, buyer: 'ZEYNEP', merch: 'CK1E', ageGroup: 'ERKEK', buyerGrup: 'ÖRME' },
  // Sipariş kodu OLMAYAN satır: yetki kaynağına giremez ama katalogda yerini alır.
  { ocode: '', buyer: 'BURAK', merch: 'CX9E', ageGroup: 'ÇOCUK', buyerGrup: 'AKSESUAR' },
];
// Sonraki yenileme DAHA DAR: ufuk daraltılmış ya da adetler sıfırlanmış.
const NARROW = [
  { ocode: 1001, buyer: 'AYŞE', merch: 'CU4E', ageGroup: 'KADIN', buyerGrup: 'DOKUMA' },
];

test('v7.25 katalog, sipariş kodu olmayan satırların değerlerini de içerir', () => {
  userAccess.syncProfiles(WIDE, { authoritative: true });
  const store = userAccess.loadStore();
  assert.deepEqual([...store.scopeCatalog.buyingGroups].sort(), ['AKSESUAR', 'DOKUMA', 'LİSANS', 'ÖRME'].sort());
  assert.ok(store.scopeCatalog.mags.includes('CX9E'), 'sipariş kodsuz satırın MAG\'ı da listelenmeli');
  assert.ok(store.scopeCatalog.mmygs.includes('ÇOCUK'));
  // Yetki kaynağı DEĞİŞMEZ: sipariş kodsuz satır oraya girmez. (Boş kod
  // Number('') → 0 olduğu için eskiden "0" diye sahte bir sipariş açıyordu.)
  assert.deepEqual(Object.keys(store.orderAccess).sort(), ['1001', '1002', '1003']);
  assert.equal(Object.prototype.hasOwnProperty.call(store.orderAccess, '0'), false, 'kodsuz satır sahte bir sipariş yaratmamalı');
});

test('v7.25 daha DAR bir yenileme listeyi KÜÇÜLTMEZ', () => {
  userAccess.syncProfiles(NARROW, { authoritative: true });
  const store = userAccess.loadStore();
  assert.ok(store.scopeCatalog.buyingGroups.includes('ÖRME'), 'bir kez görülmüş Buying Group listeden düşmemeli');
  assert.ok(store.scopeCatalog.mags.includes('CK1E'));
  assert.ok(store.scopeCatalog.mmygs.includes('ERKEK'));
  // Yetki kaynağı ise DARALIR — orası güncel gerçeği yansıtmalıdır.
  assert.deepEqual(Object.keys(store.orderAccess), ['1001']);
});

test('v7.25 katalog MAG → MMYG → Buying Group kırılımını korur', () => {
  const store = userAccess.loadStore();
  assert.deepEqual(store.scopeCatalog.magMmyg.CU4E, ['KADIN']);
  assert.deepEqual([...store.scopeCatalog.magMmygBuyingGroups.CU4E.KADIN].sort(), ['DOKUMA', 'LİSANS'].sort());
  assert.deepEqual(store.scopeCatalog.magMmygBuyingGroups.CK1E.ERKEK, ['ÖRME']);
});

test('v7.25 yetkisiz (Buyer klasörü) yenileme kataloğu DEĞİŞTİREMEZ', () => {
  const before = JSON.stringify(userAccess.loadStore().scopeCatalog);
  userAccess.syncProfiles([{ ocode: 9999, buyer: 'X', merch: 'SAHTE', ageGroup: 'SAHTE', buyerGrup: 'SAHTE' }], { authoritative: false });
  assert.equal(JSON.stringify(userAccess.loadStore().scopeCatalog), before, 'yalnız Moderatör kaynağı yetkilidir (§32)');
});

/* ------------------------------------------- 2) MODERATÖRÜN YÖNETİCİSİ */

test('v7.25 Moderatör hesabının yöneticisi atanabilir ve KORUNUR', () => {
  const profile = iam.normalizeProfileIam({ id: 'moderator', username: 'Gökberk', systemRole: 'moderator', managerId: 'user-42' });
  assert.equal(profile.managerId, 'user-42', 'normalizasyon yöneticiyi silmemeli');
  assert.equal(profile.supervisorId, 'user-42');
});

test('v7.25 Moderatör yöneticisiz de kalabilir', () => {
  const profile = iam.normalizeProfileIam({ id: 'moderator', username: 'Gökberk', systemRole: 'moderator' });
  assert.equal(profile.managerId, null);
});

test('v7.25 döngü koruması yerinde: kimse kendi astına bağlanamaz', () => {
  const store = {
    moderator: { id: 'moderator', username: 'Gökberk', systemRole: 'moderator', status: 'ACTIVE', managerId: null },
    users: [{ id: 'u1', username: 'Ali', systemRole: 'manager', status: 'ACTIVE', managerId: 'moderator' }],
  };
  assert.throws(() => iam.validateHierarchy(store, 'moderator', 'u1'), /döngü/i);
  assert.throws(() => iam.validateHierarchy(store, 'moderator', 'moderator'), /kendi yöneticisi/i);
});

test('v7.25 arayüzde Moderatörün yönetici alanı kilitli değil', () => {
  assert.ok(!UM.includes("root ? ' disabled' : ''}`, managers"), 'yönetici seçimi role göre kilitlenmemeli');
  assert.ok(!UM.includes('Kök Moderatör hesabı başka bir yöneticiye bağlanamaz'), 'eski kısıt metni kalmamalı');
  const submit = UM.slice(UM.indexOf("if (kind === 'profile')"), UM.indexOf("if (kind === 'grants')"));
  const managerAt = submit.indexOf('patch.managerId');
  const guardAt = submit.indexOf("if (id !== 'moderator')");
  assert.ok(managerAt >= 0 && managerAt < guardAt, 'yönetici alanı Moderatör için de gönderilmeli');
});

/* --------------------------------------- 3) GİRİŞ EKRANI ÖNERİ TIKLAMASI */

test('v7.25 öneri listesi fare üzerine gelince YENİDEN ÇİZİLMEZ', () => {
  const from = SELECT_USER.indexOf("button.addEventListener('mouseenter'");
  assert.ok(from >= 0, 'mouseenter dinleyicisi bulunmalı');
  const handler = SELECT_USER.slice(from, from + 400);
  assert.ok(!handler.includes('renderSuggestions()'), 'üzerine gelmek listeyi yeniden kurmamalı — tıklanan düğme DOM\'dan siliniyordu');
  assert.ok(handler.includes('if (index === activeIndex) return;'), 'aynı öğe için hiç iş yapılmamalı');
  assert.ok(handler.includes('syncActiveHighlight()'), 'yalnız vurgu güncellenmeli');
});

test('v7.25 klavye gezinmesi de ucuz yoldan vurgular', () => {
  const keydown = SELECT_USER.slice(SELECT_USER.indexOf("$('username').addEventListener('keydown'"), SELECT_USER.indexOf("document.addEventListener('pointerdown'"));
  assert.ok(keydown.includes('syncActiveHighlight()'), 'ok tuşları listeyi baştan çizmemeli');
  assert.ok(keydown.includes('choose(activeIndex)'), 'Enter ile seçim korunmalı');
});

test('v7.25 vurgu güncellemesi DOM\'u yeniden kurmaz', () => {
  const fn = SELECT_USER.slice(SELECT_USER.indexOf('function syncActiveHighlight'), SELECT_USER.indexOf('function choose'));
  assert.ok(!/innerHTML/.test(fn), 'vurgu için innerHTML yazılmamalı');
  assert.ok(fn.includes("classList.toggle('isActive'"), 'yalnız sınıf değişmeli');
  assert.ok(fn.includes('aria-selected'), 'erişilebilirlik durumu da güncellenmeli');
});

test('v7.25 kullanıcı adı olmayan bir öneri, yazılan metni SİLMEZ', () => {
  const fn = SELECT_USER.slice(SELECT_USER.indexOf('function choose(index)'), SELECT_USER.indexOf('function clearSelected'));
  const guardAt = fn.indexOf("if (!String(candidate.loginName || '').trim())");
  const assignAt = fn.indexOf("$('username').value = selected.loginName;");
  assert.ok(guardAt >= 0, 'boş kullanıcı adı için koruma olmalı');
  assert.ok(assignAt > guardAt, 'değer ancak korumadan sonra yazılmalı');
  assert.ok(fn.includes('setError('), 'sebep yazılmalı — sessizce hiçbir şey olmamış gibi görünmemeli');
});
