'use strict';

/*
 * v7.32 — ÜRETİCİ E-POSTA GRUPLARI (ORTAK ALAN + KAYIT BAZLI KİLİT)
 *
 * Kullanıcı talepleri (birebir):
 *   · "üretici e-posta adreslerini gruplayarak organize edebileyim. Gruplamayı
 *      ülke olarak ve Dokuma / Örme / Triko / Denim gibi gruplarla yöneteceğim.
 *      Bu başlıkları dilediğim gibi ekle/çıkar şeklinde düzenleyeceğim. Bu alan
 *      kullanıcılar arasında görünür olsun, herkesin girdiği veri ortak alanda
 *      görünür durumda olsun."
 *   · "birisi bir e posta kaydını düzenliyorken, diğer kullanıcılar için edit
 *      özelliğini o e posta kaydında kapat. o an kimin editledigi de diger
 *      kisiler tarafından görülsün. son güncelleme tarihi kayıt bazlı görünür
 *      olsun."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *  1) Kilit gerçekten KAPATIR: başkası o kaydı yazamaz.
 *  2) Kilit YETKİ SUNUCUDA doğrulanır — istemcinin iddiası yetmez (§32).
 *  3) KİLİDİN SÜRESİ VAR. Süresiz kilit, tarayıcısını kapatan kullanıcının
 *     kaydı herkese kalıcı olarak kilitlemesi demekti.
 *  4) Kilidi KİMİN tuttuğu bildirilir.
 *  5) Kayıt bazlı son güncelleme damgası tutulur.
 *  6) Başlık silmek kayıtları SAHİPSİZ BIRAKMAZ (§142).
 *  7) Eşzamanlı yazmada sessiz üzerine yazma yok (revizyon çakışması).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertLazy } = require('./helpers/script-loading');

/* Bir <div id="..."> elementinin iç HTML'ini etiket sayarak çıkarır. Sabit iki
   metin arasını dilimlemek markup sırası değiştiğinde sessizce boş dönüyordu. */
function innerHtmlOf(html, id) {
  const open = new RegExp(`<div[^>]*id="${id}"[^>]*>`);
  const match = open.exec(html);
  assert.ok(match, `${id} elementi bulunamadı`);
  let depth = 1, index = match.index + match[0].length;
  const start = index;
  const tag = /<(\/?)div\b/g;
  tag.lastIndex = index;
  for (let hit = tag.exec(html); hit && depth > 0; hit = tag.exec(html)) {
    depth += hit[1] ? -1 : 1;
    index = hit.index;
  }
  assert.equal(depth, 0, `${id} elementi kapatılmamış`);
  return html.slice(start, index);
}

const ROOT = path.join(__dirname, '..');

function withStore(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-emailgroups-'));
  const previous = {
    server: process.env.BUYER_LOG_SERVER_DATA_ROOT, app: process.env.BUYER_LOG_DATA_ROOT,
    local: process.env.BUYER_LOG_LOCAL_DATA_ROOT, config: process.env.BUYER_LOG_CONFIG_PATH,
  };
  process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
  process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
  process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
  process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
  const storePath = require.resolve(path.join(ROOT, 'server', 'lib', 'email-groups-store.js'));
  const userDataPath = require.resolve(path.join(ROOT, 'server', 'user-data.js'));
  delete require.cache[storePath]; delete require.cache[userDataPath];
  const store = require(storePath);
  try { return run(store); } finally {
    delete require.cache[storePath]; delete require.cache[userDataPath];
    for (const [key, value] of [['BUYER_LOG_SERVER_DATA_ROOT', previous.server], ['BUYER_LOG_DATA_ROOT', previous.app],
      ['BUYER_LOG_LOCAL_DATA_ROOT', previous.local], ['BUYER_LOG_CONFIG_PATH', previous.config]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const AYSE = { id: 'u-ayse', name: 'AYŞE ERCAN' };
const MEHMET = { id: 'u-mehmet', name: 'MEHMET KAYA' };
const seed = (store, extra = {}) => store.createRecord({ manufacturer: 'ELSIWA APPAREL', email: 'info@elsiwa.example', ...extra }, AYSE).record;

/* ------------------------------------------------------------------ */
/* 1) Ortak alan                                                       */
/* ------------------------------------------------------------------ */

test('kayıt ortak alana yazılır — herkes aynı veriyi okur', () => {
  withStore(store => {
    const record = seed(store);
    // İkinci bir "oturum" aynı dosyayı okur.
    const seen = store.publicStore().records.find(item => item.id === record.id);
    assert.equal(seen.manufacturer, 'ELSIWA APPAREL');
    assert.equal(seen.email, 'info@elsiwa.example');
    assert.equal(seen.createdByName, 'AYŞE ERCAN');
  });
});

test('kullanıcının saydığı gruplar hazır gelir ama sabit değildir', () => {
  withStore(store => {
    assert.deepEqual(store.publicStore().types.map(item => item.name), ['Dokuma', 'Örme', 'Triko', 'Denim']);
    // Ülke listesi UYDURULMAZ: kuruluşa göre değişir, boş başlar.
    assert.deepEqual(store.publicStore().countries, []);
  });
});

test('başlıklar eklenip çıkarılabilir, aynı ad iki kez girilmez', () => {
  withStore(store => {
    const revision = store.publicStore().revision;
    const saved = store.replaceHeadings('country', [{ name: 'Türkiye' }, { name: 'Mısır' }, { name: 'türkiye' }], revision);
    assert.deepEqual(saved.countries.map(item => item.name), ['Türkiye', 'Mısır']);
  });
});

/* ------------------------------------------------------------------ */
/* 2) Kayıt bazlı kilit — asıl istek                                   */
/* ------------------------------------------------------------------ */

test('kilit BAŞKASINI GERÇEKTEN durdurur', () => {
  withStore(store => {
    const record = seed(store);
    store.acquireLock(record.id, AYSE);
    assert.throws(() => store.updateRecord(record.id, { email: 'yeni@example.com' }, MEHMET),
      error => error.code === 'EMAIL_RECORD_LOCKED');
    // Kayıt değişmemiş olmalı.
    assert.equal(store.publicStore().records[0].email, 'info@elsiwa.example');
  });
});

test('kilidi KİM tuttuğu bildirilir', () => {
  withStore(store => {
    const record = seed(store);
    store.acquireLock(record.id, AYSE);
    assert.throws(() => store.acquireLock(record.id, MEHMET), error => {
      assert.equal(error.code, 'EMAIL_RECORD_LOCKED');
      assert.match(error.message, /AYŞE ERCAN/);
      assert.equal(error.lock.userId, 'u-ayse');
      return true;
    });
    // Diğer kullanıcılar kilidi listede de görür.
    const seen = store.publicStore().records[0];
    assert.equal(seen.lock.userName, 'AYŞE ERCAN');
  });
});

test('KİLİT SUNUCUDA doğrulanır — kilitsiz yazma reddedilir (§32)', () => {
  withStore(store => {
    const record = seed(store);
    // Kimse kilidi almadan yazmaya çalışıyor.
    assert.throws(() => store.updateRecord(record.id, { email: 'x@example.com' }, AYSE),
      error => error.code === 'EMAIL_RECORD_LOCK_REQUIRED');
  });
});

test('istemcinin gönderdiği sahte kilit kabul edilmez', () => {
  withStore(store => {
    const record = store.createRecord({
      manufacturer: 'SAHTE', email: 'a@b.c',
      lock: { userId: 'u-mehmet', userName: 'MEHMET KAYA', at: new Date().toISOString() },
    }, AYSE).record;
    // Oluşturmada kilit alanı yok sayılır; yazmak için gerçek kilit gerekir.
    assert.equal(record.lock, null);
    assert.throws(() => store.updateRecord(record.id, { email: 'z@z.z' }, MEHMET),
      error => error.code === 'EMAIL_RECORD_LOCK_REQUIRED');
  });
});

test('kilit sahibi yazabilir ve kaydedince kilit DÜŞER', () => {
  withStore(store => {
    const record = seed(store);
    store.acquireLock(record.id, AYSE);
    const saved = store.updateRecord(record.id, { email: 'yeni@elsiwa.example' }, AYSE);
    assert.equal(saved.record.email, 'yeni@elsiwa.example');
    assert.equal(saved.record.lock, null, 'kaydettikten sonra kayıt başkalarına açılmalı');
    // Artık Mehmet de düzenleyebilir.
    store.acquireLock(record.id, MEHMET);
    assert.equal(store.publicStore().records[0].lock.userId, 'u-mehmet');
  });
});

/* ------------------------------------------------------------------ */
/* 3) Kilidin süresi — en tehlikeli kısım                              */
/* ------------------------------------------------------------------ */

test('SÜRESİ GEÇMİŞ kilit kaydı sonsuza dek kilitlemez', () => {
  /* Bu olmasaydı: tarayıcısını kapatan bir kullanıcı o kaydı HERKES için
     kalıcı olarak kilitlerdi ve elle müdahale gerekirdi. */
  withStore(store => {
    const record = seed(store);
    store.acquireLock(record.id, AYSE);
    // Kilidi elle eskitmek: dosyaya TTL'den eski bir damga yazılır.
    const raw = JSON.parse(fs.readFileSync(store.FILE, 'utf8'));
    raw.records[0].lock.at = new Date(Date.now() - store.LOCK_TTL_MS - 1000).toISOString();
    fs.writeFileSync(store.FILE, JSON.stringify(raw), 'utf8');

    assert.equal(store.publicStore().records[0].lock, null, 'süresi geçmiş kilit görünmemeli');
    // Devralınabilir olmalı.
    store.acquireLock(record.id, MEHMET);
    assert.equal(store.publicStore().records[0].lock.userId, 'u-mehmet');
  });
});

test('kilit ömrü makul sınırlarda', () => {
  withStore(store => {
    assert.ok(store.LOCK_TTL_MS >= 30000, 'çok kısa olursa düzenleme sırasında kilit elden gider');
    assert.ok(store.LOCK_TTL_MS <= 600000, 'çok uzun olursa kapanan tarayıcı kaydı uzun süre bloke eder');
  });
});

test('kilit tazelenebilir (kalp atışı) — açık pencere kilidi kaybetmez', () => {
  withStore(store => {
    const record = seed(store);
    const first = store.acquireLock(record.id, AYSE).record.lock.at;
    const again = store.acquireLock(record.id, AYSE).record.lock.at;
    assert.ok(Date.parse(again) >= Date.parse(first), 'aynı kullanıcı kilidi tazeleyebilmeli');
  });
});

/* ------------------------------------------------------------------ */
/* 4) Kayıt bazlı son güncelleme                                       */
/* ------------------------------------------------------------------ */

test('son güncelleme kayıt bazlı tutulur: ne zaman ve KİM', () => {
  withStore(store => {
    const record = seed(store);
    assert.equal(record.createdByName, 'AYŞE ERCAN');
    assert.ok(Date.parse(record.updatedAt) > 0);
    store.acquireLock(record.id, MEHMET);
    const saved = store.updateRecord(record.id, { note: 'kapasite teyidi' }, MEHMET);
    assert.equal(saved.record.updatedByName, 'MEHMET KAYA');
    assert.equal(saved.record.createdByName, 'AYŞE ERCAN', 'oluşturan bilgisi korunmalı');
    assert.ok(Date.parse(saved.record.updatedAt) >= Date.parse(record.updatedAt));
  });
});

/* ------------------------------------------------------------------ */
/* 5) Veri kaybı yok                                                   */
/* ------------------------------------------------------------------ */

test('İÇİNDE KAYIT OLAN başlık silinemez — kayıtlar sahipsiz kalmaz (§142)', () => {
  withStore(store => {
    const revision = store.publicStore().revision;
    const { countries } = store.replaceHeadings('country', [{ name: 'Türkiye' }], revision);
    const turkey = countries[0];
    store.createRecord({ manufacturer: 'A', email: 'a@a.a', countryId: turkey.id }, AYSE);
    assert.throws(() => store.replaceHeadings('country', [], store.publicStore().revision), error => {
      assert.equal(error.code, 'EMAIL_HEADING_IN_USE');
      assert.match(error.message, /Türkiye \(1 kayıt\)/);
      return true;
    });
    // Kayıt ve başlık yerinde durmalı.
    assert.equal(store.publicStore().records.length, 1);
    assert.equal(store.publicStore().countries.length, 1);
  });
});

test('boş başlık silinebilir', () => {
  withStore(store => {
    store.replaceHeadings('country', [{ name: 'Mısır' }], store.publicStore().revision);
    store.replaceHeadings('country', [], store.publicStore().revision);
    assert.deepEqual(store.publicStore().countries, []);
  });
});

test('eşzamanlı yazma SESSİZCE üzerine yazmaz', () => {
  withStore(store => {
    const stale = store.publicStore().revision;
    seed(store); // başka biri araya girdi, revizyon ilerledi
    store.createRecord({ manufacturer: 'B', email: 'b@b.b' }, MEHMET, stale);
    assert.deepEqual(store.publicStore().records.map(record => record.manufacturer), ['ELSIWA APPAREL', 'B']);
  });
});

test('adı ve e-postası boş kayıt eklenemez', () => {
  withStore(store => {
    assert.throws(() => store.createRecord({ note: 'yalnız not' }, AYSE), error => error.code === 'VALIDATION_ERROR');
  });
});

test('silmek de kilit ister', () => {
  withStore(store => {
    const record = seed(store);
    assert.throws(() => store.deleteRecord(record.id, MEHMET), error => error.code === 'EMAIL_RECORD_LOCK_REQUIRED');
    store.acquireLock(record.id, MEHMET);
    store.deleteRecord(record.id, MEHMET);
    assert.equal(store.publicStore().records.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 6) Sunucu uçları                                                    */
/* ------------------------------------------------------------------ */

test('uçlar tanımlı ve yazar kimliği OTURUMDAN alınır', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  for (const route of ["app.get('/api/email-groups'", "app.post('/api/email-groups/records'",
    "app.put('/api/email-groups/records/:id'", "app.delete('/api/email-groups/records/:id'",
    "app.post('/api/email-groups/records/:id/lock'", "app.delete('/api/email-groups/records/:id/lock'",
    "app.put('/api/email-groups/headings/:kind'"]) {
    assert.ok(server.includes(route), `${route} eksik`);
  }
  assert.match(server, /function emailGroupsActor\(req\)/);
  assert.match(server, /req\.currentUser \|\| \{\}/, 'kimlik oturumdan gelmeli, istemciden değil');
});

/* ------------------------------------------------------------------ */
/* 7) Arayüz — kart tasarımı, kilit gösterimi, tazeleme                */
/* ------------------------------------------------------------------ */

const UI = fs.readFileSync(path.join(ROOT, 'public', 'email-groups.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('Source Data ekranında E-Mail Groups düğmesi var ve betik yükleniyor', () => {
  /* v7.81: "Kaynak Veri" ayarlar menüsü kaldırıldı; bu iş Veri Yönetimi
     ekranındaki Araçlar bölümünde ve artık ne yaptığını da yazıyor. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'emailgroups'/);
  assert.match(DM_UI, /BLEmailGroups\?\.open\?\.\(\)/);
  /* v7.81: "Kaynak Veri" ayarlar menüsü tamamen kaldırıldı; dilim alacak bir
     kap kalmadı. Düğmenin varlığı yukarıda Veri Yönetimi araç kaydından
     doğrulanıyor. */
  assert.doesNotMatch(INDEX, /sourceSettingsMenu/);
  assertLazy('email-groups.js');
});

test('KART tasarımı kullanılıyor (tablo değil)', () => {
  assert.match(UI, /class="egCard/);
  assert.match(CSS, /\.egCards\{[^}]*grid/, 'kartlar ızgara düzeninde dizilmeli');
  assert.match(CSS, /\.egCard\{/);
  assert.equal(/<table|<tbody/.test(UI), false, 'kayıtlar tabloyla çizilmemeli');
});

test('directory bölümleri global section gizleme kuralını geçersiz kılar', () => {
  assert.match(CSS, /\.egDirectorySection\{[^}]*display:block/,
    'E-Mail Groups dizinindeki section elemanları görünür olmalı');
});

test('dizin satırı tıklanınca seçilir ve detay güncellenir', () => {
  const start = UI.indexOf("const select = event.target.closest('[data-eg-select]');");
  const body = UI.slice(start, start + 240);
  assert.match(body, /if \(select && !event\.target\.closest\('a,input,select,textarea'\)\)/,
    'satırın kendisi button olduğu için button guard seçimi engellememeli');
});

test('kilitli kartta Düzenle düğmesi ÇİZİLMEZ, yerine kimin düzenlediği yazar', () => {
  const start = UI.indexOf('function cardHtml(');
  const body = UI.slice(start, UI.indexOf('function editCardHtml('));
  assert.match(body, /lockedByOther\(record\)/);
  assert.match(body, /egLockBadge/);
  assert.match(body, /düzenliyor/);
  // Düzenle düğmesi yalnız kilit YOKKEN çizilir.
  assert.match(body, /other\s*\n?\s*\?[\s\S]*egLockBadge[\s\S]*:[\s\S]*data-eg-edit/);
});

test('kendi kilidin engel değildir', () => {
  const start = UI.indexOf('function lockedByOther(');
  const body = UI.slice(start, start + 400);
  assert.match(body, /lock\.userId !== S\.currentUserId/);
});

test('son güncelleme KART BAZINDA gösterilir (tarih + kim)', () => {
  const start = UI.indexOf('function cardHtml(');
  const body = UI.slice(start, UI.indexOf('function editCardHtml('));
  assert.match(body, /Son güncelleme/);
  assert.match(body, /stampText\(record\.updatedAt\)/);
  assert.match(body, /record\.updatedByName/);
});

test('liste kendi kendine tazelenir ama AÇIK FORMU ezmez', () => {
  /* Tazeleme olmasa "kimin düzenlediği" bilgisi bayat kalırdı; ama açık formu
     yeniden çizmek kullanıcının yazdığı metni silerdi. */
  assert.match(UI, /S\.refreshTimer = setInterval/);
  const start = UI.indexOf('async function refresh(');
  const body = UI.slice(start, start + 500);
  assert.match(body, /if \(S\.editingId && !force\) return;/);
});

test('kilit kalp atışıyla tazelenir ve sunucudaki ömrün ALTINDA kalır', () => {
  assert.match(UI, /HEARTBEAT_MS = (\d+)/);
  const heartbeat = Number((UI.match(/HEARTBEAT_MS = (\d+)/) || [])[1]);
  const store = require(path.join(ROOT, 'server', 'lib', 'email-groups-store.js'));
  assert.ok(heartbeat > 0 && heartbeat < store.LOCK_TTL_MS,
    'kalp atışı kilit ömründen kısa olmalı, yoksa düzenleme sırasında kilit düşer');
});

test('pencere kapanınca kilit bırakılır', () => {
  const start = UI.indexOf('function close()');
  const body = UI.slice(start, start + 600);
  assert.match(body, /lock`, \{ method: 'DELETE' \}/);
  // Tarayıcı kapanışında son şans: sendBeacon YALNIZ POST gönderebilir.
  assert.match(UI, /sendBeacon/);
  assert.match(UI, /lock-release/);
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/email-groups\/records\/:id\/lock-release'/,
    'beacon ucu sunucuda olmalı, yoksa çağrı sessizce boşa gider');
});

test('gruplama ülke ve grup boyutlarında yapılır, başlıksız kayıt kaybolmaz', () => {
  const start = UI.indexOf('function sections()');
  const body = UI.slice(start, start + 900);
  assert.match(body, /S\.groupBy === 'country'/);
  assert.match(body, /Atanmamış/, 'başlığı olmayan kayıt da bir bölümde görünmeli');
});
