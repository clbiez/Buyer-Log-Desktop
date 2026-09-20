'use strict';

/* v9.30 — OCTOPUS PENCERESİ VE KALICI KONUŞMALAR
 *
 * Çekmece sabit kenara yapışıktı ve sohbet bağlamı bellekte tek bir diziydi:
 * panel kapanınca konuşma kayboluyordu. Bu iki değişikliğin ortak bedeli
 * DURUM: artık hatırlanan bir şey var ve hatırlanan şey yanlış olabilir.
 *
 * Testlerin tamamı o "yanlış olabilir" hâllerine bakıyor:
 *
 *   · Kayıtlı pencere konumu ekran küçüldüğünde GEÇERSİZ olur. Pencere
 *     yalnız başlığından taşınabildiği için, başlık dışarıda kalırsa pencere
 *     bir daha geri getirilemez — kullanıcı Octopus'un bozulduğunu sanır.
 *   · localStorage gizli sekmede, kota dolduğunda ve site verisi kapalıyken
 *     PATLAR; erişimin kendisi bile fırlatır. Panelin çalışmaya devam etmesi
 *     gerekir, yalnız hatırlamaması.
 *   · Aynı bilgisayarda kullanıcı değişince bir öncekinin konuşmaları
 *     görünmemeli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const conversations = require('../public/octopus-conversations.js');
const windowGeom = require('../public/octopus-window.js');

/* Gerçek localStorage sözleşmesi: string in, string out; kota dolunca
   fırlatır. Bellekte taklit etmek, gerçekte olan hatayı test edilebilir
   kılıyor. */
function fakeStorage({ limitBytes = Infinity, broken = false } = {}) {
  const map = new Map();
  return {
    get size() { return [...map.values()].reduce((n, v) => n + v.length, 0); },
    getItem(k) { if (broken) throw new Error('site verisi kapalı'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (broken) throw new Error('site verisi kapalı');
      const next = [...map.entries()].filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0) + v.length;
      if (next > limitBytes) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem(k) { if (broken) throw new Error('site verisi kapalı'); map.delete(k); },
  };
}

let clock = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();
const storeFor = (opts = {}) => {
  clock = 0;
  return conversations.createConversationStore({ storage: fakeStorage(), userId: 'u1', now, ...opts });
};

/* ==================================================== PENCERE GEOMETRİSİ */

test('v9.30 kayıtlı konum küçülen ekrana kırpılır', () => {
  /* Dizüstü dış ekrandan ayrıldığında 2560'lık bir konum 1440'lık ekranda
     tamamen dışarıda kalıyordu. */
  const clamped = windowGeom.clampGeometry(
    { x: 2200, y: 1300, width: 880, height: 620 },
    { width: 1440, height: 900 });
  assert.ok(clamped.x + windowGeom.KEEP_VISIBLE <= 1440, 'pencere ekranın sağına taşamaz');
  assert.ok(clamped.y + windowGeom.KEEP_VISIBLE <= 900, 'pencere ekranın altına taşamaz');
});

test('v9.30 başlık çubuğu HER ZAMAN erişilebilir kalır', () => {
  /* Pencere yalnız başlığından taşınabiliyor. Başlık ekran dışına çıkarsa
     pencere bir daha geri getirilemez — bu, kapanmayan bir hata. */
  const view = { width: 1280, height: 800 };
  const cases = [
    { x: -5000, y: -5000, width: 600, height: 400 },
    { x: 99999, y: 99999, width: 600, height: 400 },
    { x: -600, y: 0, width: 600, height: 400 },
  ];
  cases.forEach(geometry => {
    const c = windowGeom.clampGeometry(geometry, view);
    assert.ok(c.y >= 0, 'başlık yukarı kaçamaz: ' + JSON.stringify(c));
    assert.ok(c.x + c.width >= windowGeom.KEEP_VISIBLE, 'soldan tamamen çıkamaz: ' + JSON.stringify(c));
    assert.ok(c.x <= view.width - windowGeom.KEEP_VISIBLE, 'sağdan tamamen çıkamaz: ' + JSON.stringify(c));
  });
});

test('v9.30 pencere en küçük ölçünün altına inmez, ekrandan büyük olmaz', () => {
  const tiny = windowGeom.clampGeometry({ x: 0, y: 0, width: 10, height: 10 }, { width: 1280, height: 800 });
  assert.equal(tiny.width, windowGeom.MIN_WIDTH);
  assert.equal(tiny.height, windowGeom.MIN_HEIGHT);
  // Dar bir ekranda pencere ekranı aşamaz; aşarsa kenar tutamağı erişilemez olur.
  const huge = windowGeom.clampGeometry({ x: 0, y: 0, width: 9000, height: 9000 }, { width: 900, height: 600 });
  assert.equal(huge.width, 900);
  assert.equal(huge.height, 600);
});

test('v9.30 bozuk ya da eksik kayıt varsayılana düşer', () => {
  const storage = fakeStorage();
  storage.setItem('octopus:window:u1', '{bozuk json');
  const store = windowGeom.createGeometryStore({ storage, userId: 'u1', viewport: () => ({ width: 1600, height: 900 }) });
  const geometry = store.read();
  assert.ok(geometry.width >= windowGeom.MIN_WIDTH && geometry.height >= windowGeom.MIN_HEIGHT);
  assert.equal(geometry.minimized, false);
});

test('v9.30 eski şemalı kayıt kullanılmaz', () => {
  /* Şema numarası olmadan yazılmış eski bir kayıt, alanları farklı
     anlamlara gelen bir geometri olarak uygulanabilirdi. */
  const storage = fakeStorage();
  storage.setItem('octopus:window:u1', JSON.stringify({ x: 10, y: 10, width: 400, height: 400 }));
  const store = windowGeom.createGeometryStore({ storage, userId: 'u1', viewport: () => ({ width: 1600, height: 900 }) });
  assert.notEqual(store.read().width, 400, 'şemasız kayıt yok sayılmalı');
});

test('v9.30 yazılan geometri geri okunur ve kullanıcıya göre ayrılır', () => {
  const storage = fakeStorage();
  const viewport = () => ({ width: 1600, height: 900 });
  const mine = windowGeom.createGeometryStore({ storage, userId: 'u1', viewport });
  mine.write({ x: 120, y: 90, width: 700, height: 500, minimized: true });
  assert.deepEqual(mine.read(), { x: 120, y: 90, width: 700, height: 500, minimized: true });
  const other = windowGeom.createGeometryStore({ storage, userId: 'u2', viewport });
  assert.notEqual(other.read().x, 120, 'başka kullanıcı başkasının yerleşimini almamalı');
});

test('v9.30 depolama tamamen kapalıysa pencere yine açılır', () => {
  const store = windowGeom.createGeometryStore({
    storage: fakeStorage({ broken: true }), userId: 'u1',
    viewport: () => ({ width: 1280, height: 800 }),
  });
  const geometry = store.read();
  assert.ok(geometry.width >= windowGeom.MIN_WIDTH, 'hatırlamamak açılmamaktan iyidir');
  assert.doesNotThrow(() => store.write({ x: 5, y: 5, width: 500, height: 400 }));
});

/* ========================================================= KONUŞMALAR */

test('v9.30 konuşma kapanıp açılınca kaybolmaz', () => {
  const storage = fakeStorage();
  clock = 0;
  const first = conversations.createConversationStore({ storage, userId: 'u1', now });
  const active = first.active();
  first.append(active.id, { role: 'user', content: 'Nova’nın açık siparişleri' });
  first.append(active.id, { role: 'assistant', content: '12 sipariş bulundu.' });

  const reopened = conversations.createConversationStore({ storage, userId: 'u1', now });
  const list = reopened.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);
  assert.equal(reopened.active().id, active.id, 'kaldığı yerden devam etmeli');
});

test('v9.30 başlık ilk kullanıcı mesajından türer ve DEĞİŞMEZ', () => {
  /* Her mesajda yeniden hesaplansaydı liste kullanıcının altında kayardı. */
  const store = storeFor();
  const conv = store.active();
  store.append(conv.id, { role: 'user', content: '  AW27   riskli   siparişler  ' });
  assert.equal(store.list()[0].title, 'AW27 riskli siparişler');
  store.append(conv.id, { role: 'assistant', content: 'Üç sipariş riskli.' });
  store.append(conv.id, { role: 'user', content: 'Peki fiyatlar?' });
  assert.equal(store.list()[0].title, 'AW27 riskli siparişler', 'başlık sabit kalmalı');
});

test('v9.30 uzun başlık kısaltılır', () => {
  const store = storeFor();
  const conv = store.active();
  store.append(conv.id, { role: 'user', content: 'x'.repeat(400) });
  const title = store.list()[0].title;
  assert.ok(title.length <= 52, 'başlık listeyi taşırmamalı');
  assert.match(title, /…$/);
});

test('v9.30 "yeni konuşma" boş kabuk üretmez', () => {
  /* Kullanıcı üst üste basınca liste boş konuşmalarla doluyordu. */
  const store = storeFor();
  const a = store.create();
  const b = store.create();
  const c = store.create();
  assert.equal(a.id, b.id);
  assert.equal(b.id, c.id);
  assert.equal(store.list().length, 1);
  // Dolu bir konuşmadan sonra YENİ konuşma gerçekten yeni olmalı.
  store.append(a.id, { role: 'user', content: 'bir soru' });
  assert.notEqual(store.create().id, a.id);
  assert.equal(store.list().length, 2);
});

test('v9.30 modele giden bağlam eski davranışla aynı', () => {
  /* Kalıcılık, modelin GÖRDÜĞÜ şeyi değiştirmemeli; yoksa aynı soru
     kalıcılıktan önce ve sonra farklı cevap verirdi. */
  const store = storeFor();
  const conv = store.active();
  for (let i = 0; i < 20; i += 1) {
    store.append(conv.id, { role: i % 2 ? 'assistant' : 'user', content: 'm' + i });
  }
  const history = store.history(conv.id);
  assert.equal(history.length, conversations.MODEL_HISTORY);
  assert.deepEqual(history[history.length - 1], { role: 'assistant', content: 'm19' });
  assert.deepEqual(Object.keys(history[0]), ['role', 'content'], 'modele yalnız rol ve içerik gider');
});

test('v9.30 kullanıcılar birbirinin konuşmasını görmez', () => {
  const storage = fakeStorage();
  clock = 0;
  const mine = conversations.createConversationStore({ storage, userId: 'u1', now });
  mine.append(mine.active().id, { role: 'user', content: 'benim sorum' });
  const other = conversations.createConversationStore({ storage, userId: 'u2', now });
  assert.equal(other.list().filter(item => item.messageCount > 0).length, 0);
});

test('v9.30 kimliksiz oturumda konuşma YAZILMAZ', () => {
  /* Anonim bir kovaya yazmak, bir sonraki kullanıcıya sızdırmak olurdu. */
  const storage = fakeStorage();
  clock = 0;
  const store = conversations.createConversationStore({ storage, userId: '', now });
  assert.equal(store.persistent, false);
  store.append(store.active().id, { role: 'user', content: 'gizli kalmalı' });
  assert.equal(storage.size, 0, 'depoya hiçbir şey yazılmamalı');
  // Panel yine de çalışır; tek fark kalıcı olmaması.
  assert.equal(store.list()[0].messageCount, 1);
});

test('v9.30 kota dolduğunda panel çalışmaya devam eder', () => {
  const storage = fakeStorage({ limitBytes: 300 });
  clock = 0;
  const store = conversations.createConversationStore({ storage, userId: 'u1', now });
  const conv = store.active();
  assert.doesNotThrow(() => {
    for (let i = 0; i < 30; i += 1) store.append(conv.id, { role: 'user', content: 'uzun bir mesaj '.repeat(20) });
  });
  assert.equal(store.list()[0].messageCount, 30, 'bellekte çalışmaya devam etmeli');
});

test('v9.30 kapaklar depo şişmeden uygulanır', () => {
  const store = storeFor({ maxConversations: 3, maxMessages: 4 });
  for (let i = 0; i < 6; i += 1) {
    const conv = store.create();
    store.append(conv.id, { role: 'user', content: 'konuşma ' + i });
  }
  assert.equal(store.list().length, 3, 'en eski konuşmalar düşmeli');
  const newest = store.list()[0];
  for (let i = 0; i < 10; i += 1) store.append(newest.id, { role: 'user', content: 'm' + i });
  assert.equal(store.list()[0].messageCount, 4, 'mesaj kapağı uygulanmalı');
});

test('v9.30 bozuk kayıt paneli kilitlemez', () => {
  const storage = fakeStorage();
  storage.setItem('octopus:conversations:u1', '{yarım');
  clock = 0;
  const store = conversations.createConversationStore({ storage, userId: 'u1', now });
  assert.deepEqual(store.list().filter(item => item.messageCount > 0), []);
  assert.doesNotThrow(() => store.append(store.active().id, { role: 'user', content: 'yeniden başla' }));
});

test('v9.30 konuşma silinir ve tümü temizlenir', () => {
  const store = storeFor();
  const a = store.active(); store.append(a.id, { role: 'user', content: 'bir' });
  const b = store.create(); store.append(b.id, { role: 'user', content: 'iki' });
  assert.equal(store.remove(a.id), true);
  assert.equal(store.list().length, 1);
  store.clear();
  assert.deepEqual(store.list().filter(item => item.messageCount > 0), []);
});

test('v9.30 liste en yeniden eskiye sıralanır', () => {
  const store = storeFor();
  const a = store.active(); store.append(a.id, { role: 'user', content: 'ilk' });
  const b = store.create(); store.append(b.id, { role: 'user', content: 'ikinci' });
  store.append(a.id, { role: 'user', content: 'ilke geri dönüş' });
  assert.equal(store.list()[0].id, a.id, 'son dokunulan üstte olmalı');
});

/* ============================================== PENCERE DAVRANIŞI (KAYNAK)

   copilot.js tarayıcıda çalışıyor ve DOM'a bağlı; bu dosya için projenin
   yerleşik yöntemi KAYNAK EŞLEŞTİRMEsi. Aşağıdakiler kozmetik değil: her biri
   canlı kontrolde görülmüş ya da mantıkla kanıtlanmış bir kusuru kilitliyor. */

const fsNode = require('node:fs');
const pathNode = require('node:path');
const readSource = rel => fsNode.readFileSync(pathNode.join(__dirname, '..', rel), 'utf8');
const CLIENT = readSource('public/copilot.js');
const CSS = readSource('public/copilot.css');
const LOADER = readSource('public/perf-runtime.js');

test('v9.30 pencere MODAL DEĞİL: arkadaki uygulama tıklanabilir', () => {
  /* Çekmecenin örtüsü uygulamayı tıklanamaz yapıyordu. Octopus'un işi
     tabloya BAKARKEN soru sormak; örtü bu işi imkânsız kılıyordu. */
  assert.equal(/bCpBackdrop/.test(CLIENT), false, 'örtü kaldırılmalı');
  assert.equal(/bCpBackdrop/.test(CSS), false, 'örtü stili de kaldırılmalı');
  /* Yalnız OCTOPUS PENCERESİ modal değil. Model yöneticisi ayrı bir örtülü
     diyalog ve modal KALMALI: orada indirme/ayar işlemi sürerken arkadaki
     panele dokunmak tutarsız bir duruma yol açardı. */
  const windowMarkup = CLIENT.slice(CLIENT.indexOf('<aside class="bCpWindow"'), CLIENT.indexOf('</aside>'));
  assert.equal(/aria-modal/.test(windowMarkup), false, 'pencere modal değil');
  assert.match(CLIENT, /class="bCpManager" role="dialog" aria-modal="true"/, 'model yöneticisi modal kalmalı');
  assert.match(CSS, /\.bCpRoot\{[^}]*pointer-events:none/, 'kök tıklamayı geçirmeli');
  assert.match(CSS, /\.bCpWindow\{[^}]*pointer-events:auto/, 'yalnız pencere yakalamalı');
});

test('v9.30 gizliyken geometri KAYDEDİLMEZ', () => {
  /* Kapatmak root'u hidden yapıyor, ölçüler sıfıra düşüyor ve
     ResizeObserver bunu boyutlandırma sanıp kullanıcının penceresini kalıcı
     olarak en küçük ölçüye indiriyordu. */
  const save = CLIENT.slice(CLIENT.indexOf('function saveGeometry('), CLIENT.indexOf('function mountWindowControls('));
  assert.match(save, /if\(root\.hidden\|\|!shell\.offsetWidth\|\|!shell\.offsetHeight\)return null;/);
});

test('v9.30 sürükleme pointer capture kullanır ve SÜRÜKLERKEN kırpar', () => {
  const mount = CLIENT.slice(CLIENT.indexOf('function mountWindowControls('), CLIENT.indexOf('function toggleMinimized('));
  // Capture olmadan fare pencereden çıkınca pencere "yapışık" kalıyordu.
  assert.match(mount, /setPointerCapture/);
  assert.match(mount, /pointercancel/, 'iptal edilen hareket sürüklemeyi bitirmeli');
  /* Kırpma yalnız bırakırken uygulansaydı kullanıcı pencereyi ekran dışına
     götürüp geri zıplamasını izlerdi. */
  assert.match(mount, /pointermove[\s\S]*clampGeometry/);
  assert.match(mount, /addEventListener\('resize'/, 'ekran küçülünce yeniden kırpılmalı');
});

test('v9.30 açılış küçültülmüş pencereyi geri açar', () => {
  /* Kullanıcı düğmeye "bana Octopus'u göster" diye basıyor, "küçük bir çubuk
     göster" diye değil. Konum ve boyut korunur. */
  const open = CLIENT.slice(CLIENT.indexOf('root.hidden=false;'));
  assert.match(open.slice(0, 400), /toggleMinimized\(false\)/);
});

test('v9.30 öneriler yalnız BOŞ konuşmada gösterilir', () => {
  /* Eski kontrol .bCpBody'nin boşluğuna bakıyordu; artık orada döküm kabı da
     var ve hiçbir zaman boş olmuyor — kontrol bozulmuştu. */
  assert.equal(/!body\.innerHTML\.trim\(\)/.test(CLIENT), false, 'eski kontrol kalmamalı');
  assert.match(CLIENT, /const empty=live&&!live\.innerHTML\.trim\(\)&&\(!conversation\|\|!conversation\.messages\.length\);/);
});

/* ========================================== KONUŞMA BAĞLANTISI (KAYNAK) */

test('v9.30 soru CEVAPTAN ÖNCE kaydedilir', () => {
  /* İkisini birlikte yazmak, istek yarıda kalırsa sorunun da kaybolması
     demekti — kullanıcı ne sorduğunu göremezdi. */
  const ask = CLIENT.slice(CLIENT.indexOf('async function ask(question){'));
  const record = ask.indexOf("recordMessage('user'");
  const busyPaint = ask.indexOf('bCpBusy');
  assert.ok(record > 0 && record < busyPaint, 'soru, meşgul göstergesinden önce kaydedilmeli');
  const answer = CLIENT.slice(CLIENT.indexOf('async function askGeneralAssistant('));
  const recordAnswer = answer.indexOf("recordMessage('assistant'");
  /* v9.33'te çizim `show`a döndü: hangi konuşmaya çizileceği İŞE bağlı,
     o anda hangi konuşmaya bakıldığına değil. Sıra kuralı aynı kaldı. */
  const paintAnswer = answer.indexOf('show(renderAssistantResponse(result))');
  assert.ok(recordAnswer > 0 && recordAnswer < paintAnswer, 'cevap çizilmeden önce kaydedilmeli');
  assert.match(answer.slice(recordAnswer, recordAnswer + 120), /,conversationId\)/,
    'cevap SORULDUĞU konuşmaya yazılmalı');
});

test('v9.30 konuşma değişince bekleyen öneri TAŞINMAZ', () => {
  /* Başka bir konuşmada üretilmiş bir öneriyi burada onaylamak, yanlış kayda
     yazmak olurdu. Aynısı silme ve temizleme için de geçerli. */
  ['data-bcp-conv]', 'data-bcp-conv-remove]', 'data-bcp-conv-clear]'].forEach(handle => {
    const at = CLIENT.indexOf(handle);
    assert.ok(at > 0, 'işleyici yok: ' + handle);
    const body = CLIENT.slice(at, at + 700);
    assert.match(body, /pendingProposal=null/, handle + ' bekleyen öneriyi temizlemeli');
    assert.match(body, /richIndex=-1/, handle + ' zengin cevabı temizlemeli');
  });
});

test('v9.30 "tümünü temizle" geri alınamaz, bu yüzden onay ister', () => {
  const at = CLIENT.indexOf('data-bcp-conv-clear]');
  assert.match(CLIENT.slice(at, at + 500), /global\.confirm/);
});

test('v9.30 iş rozeti GERÇEK duruma bakar', () => {
  /* Uydurma bir sayaç, olmayan bir yetenek vaat etmek olurdu. Bugün gerçek
     olan tek arka plan işi uçuştaki istektir. */
  const jobs = CLIENT.slice(CLIENT.indexOf('function renderJobs('), CLIENT.indexOf('function paint('));
  /* v9.33: rozet artık KUYRUĞUN gerçek sayısını gösteriyor; tek uçuşluyken
     `busy` bayrağıydı. İkisi de gerçek durumdan okuyor. */
  assert.match(jobs, /badge\.hidden=!stats\.active;/);
  assert.match(jobs, /queue\?queue\.stats\(\)/);
  assert.equal(/[0-9]+ jobs running/.test(CLIENT), false, 'sabit bir sayaç yazılmamalı');
  assert.match(CLIENT, /finally\{busy=false;renderJobs\(\);\}/, 'iş bitince rozet güncellenmeli');
});

test('v9.30 modele giden bağlam depodan gelir', () => {
  assert.match(CLIENT, /question,history:modelHistory\(\),language:lang\(\)/);
  const history = CLIENT.slice(CLIENT.indexOf('function modelHistory('), CLIENT.indexOf('function markRichTurn('));
  // Depo yoksa panel eski davranışına düşer; kalıcılık bir ÖN KOŞUL değil.
  assert.match(history, /if\(!store\|\|!conversation\)return conversationHistory;/);
});

test('v9.30 aynı mesaj iki kez çizilmez', () => {
  /* Son cevap zengin biçimde, öncekiler metin olarak çizilir. Sınır
     threadCut; olmasaydı son cevap hem dökümde hem canlı alanda görünürdü. */
  const cut = CLIENT.slice(CLIENT.indexOf('function threadCut('), CLIENT.indexOf('function renderThread('));
  assert.match(cut, /richIndex>=0/);
  assert.match(CLIENT, /messages\.slice\(0,threadCut\(conversation\)\)/);
});

test('v9.30 kalıcı olmayan oturum kullanıcıya SÖYLENİR', () => {
  /* Kullanıcı konuşmasının saklandığını sanıp kapatırsa kaybeder. */
  assert.match(CLIENT, /data-bcp-persist-notice/);
  assert.match(CLIENT, /const ephemeral=!store\.persistent\|\|store\.degraded;/);
});

test('v9.30 yeni modüller yükleme listesinde', () => {
  /* Listeye eklenmezse panel açılır ama depolar hiç kurulmaz ve kalıcılık
     sessizce çalışmaz. */
  const line = LOADER.split(/\r?\n/).find(text => text.includes('copilot:['));
  assert.ok(line, 'copilot özellik listesi bulunamadı');
  assert.match(line, /'octopus-conversations\.js'/);
  assert.match(line, /'octopus-window\.js'/);
  // Depolar copilot.js'ten ÖNCE yüklenmeli.
  assert.ok(line.indexOf('octopus-conversations.js') < line.indexOf("'copilot.js'"));
  assert.ok(line.indexOf('octopus-window.js') < line.indexOf("'copilot.js'"));
});

test('v9.30 dar pencerede kenar çubuğu kapanır', () => {
  /* Ekran genişliğine göre değil PENCERE genişliğine göre: pencere
     taşınabilir ve küçük olabilir. 360 pikselde 212 piksellik bir liste
     cevaba yer bırakmıyordu. */
  assert.match(CSS, /container-type:inline-size;container-name:bCpWin/);
  assert.match(CSS, /@container bCpWin \(max-width:620px\)\{\.bCpSide\{display:none\}\}/);
});
