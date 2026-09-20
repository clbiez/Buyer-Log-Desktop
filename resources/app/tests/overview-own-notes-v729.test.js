'use strict';

/*
 * v7.29 — GENEL BAKIŞ YALNIZ KENDİ NOTLARINIZI GÖSTERİR
 *
 * Kullanıcı talebi (birebir):
 *   "Overview ekranında sadece kullanıcının aldığı notlar görünsün. Diğer
 *    kullanıcıların girdiği notlar CP ve Orders ekranında görünsün, overview
 *    ekranına gelmesin."
 *
 * Ve eski kayıtlar için (birebir):
 *   "yazar bilgisi bulunmayan eski kayıtların hepsine GÖKBERK ÇELEBİ yazar
 *    ismi tanımla."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *
 *  1) YAZAR SUNUCUDA BELİRLENİR (§32). İstemcinin gönderdiği bir yazar alanı
 *     asla kabul edilmez; damga oturumdan gelir. Aksi hâlde herhangi bir
 *     istemci notu başkasının adına yazabilirdi.
 *  2) SÜZME ALAN BAZINDA. Aynı siparişin "Notlar"ı sizin, "Ek Not"u
 *     başkasınınsa Genel Bakış'ta yalnız sizinki görünür.
 *  3) CP VE ORDERS DEĞİŞMEZ. Not hücreleri herkesin notunu göstermeye devam
 *     eder; süzgeç yalnız Genel Bakış hatırlatıcısındadır.
 *  4) GERİ DOLDURMA VERİ BOZMAZ (§142). Yazarsız eski notlara yalnız YAZAR
 *     alanı eklenir; not metnine, tarihine, damgası olan notlara dokunulmaz ve
 *     işlem tekrar çalıştığında hiçbir şeyi değiştirmez.
 *  5) NOT SİLİNİRSE YAZAR DA DÜŞER. Yoksa boş bir nota ait damga kalır ve
 *     sonra yazan kişinin notu yanlış kişiye atfedilirdi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function withDb(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-notes-v729-'));
  const previous = {
    server: process.env.BUYER_LOG_SERVER_DATA_ROOT, app: process.env.BUYER_LOG_DATA_ROOT,
    local: process.env.BUYER_LOG_LOCAL_DATA_ROOT, config: process.env.BUYER_LOG_CONFIG_PATH,
  };
  process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
  process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
  process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
  process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
  // user-data.js veri kökünü YÜKLENİRKEN hesaplar; db.js onu oradan alır.
  // İkisi birden tazelenmezse yazma geçici klasöre değil önceki köke gider.
  const dbPath = require.resolve(path.join(ROOT, 'server', 'db.js'));
  const userDataPath = require.resolve(path.join(ROOT, 'server', 'user-data.js'));
  delete require.cache[dbPath]; delete require.cache[userDataPath];
  const db = require(dbPath);
  try { return run(db); } finally {
    delete require.cache[dbPath]; delete require.cache[userDataPath];
    for (const [key, value] of [['BUYER_LOG_SERVER_DATA_ROOT', previous.server], ['BUYER_LOG_DATA_ROOT', previous.app], ['BUYER_LOG_LOCAL_DATA_ROOT', previous.local], ['BUYER_LOG_CONFIG_PATH', previous.config]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 1) Yazar damgası — sunucu tarafı                                    */
/* ------------------------------------------------------------------ */

test('not yazıldığında yazar damgası oturumdan alınır', () => {
  withDb(db => {
    db.patchOrderOverride(1001, { notes: { Notes: 'Kumaş gecikmesi' } }, null, null, { actor: { id: 'u-ayse', name: 'AYŞE ERCAN' } });
    const record = db.loadOverrides().notesmap[1001];
    assert.equal(record.Notes, 'Kumaş gecikmesi');
    assert.equal(record.NotesBy, 'u-ayse');
    assert.equal(record.NotesByName, 'AYŞE ERCAN');
  });
});

test('İSTEMCİNİN gönderdiği yazar alanı kabul edilmez (§32)', () => {
  withDb(db => {
    // Kötü niyetli bir istemci notu Moderatör'ün üzerine yazmaya çalışıyor.
    db.patchOrderOverride(1002, {
      notes: { Notes: 'Sahte not', NotesBy: 'moderator', NotesByName: 'MODERATÖR' },
    }, null, null, { actor: { id: 'u-mehmet', name: 'MEHMET KAYA' } });
    const record = db.loadOverrides().notesmap[1002];
    assert.equal(record.NotesBy, 'u-mehmet', 'yazar yalnız oturumdan gelmeli');
    assert.equal(record.NotesByName, 'MEHMET KAYA');
  });
});

test('Notlar ve Ek Not ayrı ayrı damgalanır', () => {
  withDb(db => {
    db.patchOrderOverride(1003, { notes: { Notes: 'A notu' } }, null, null, { actor: { id: 'u-a', name: 'A' } });
    db.patchOrderOverride(1003, { notes: { EkNot: 'B notu' } }, null, null, { actor: { id: 'u-b', name: 'B' } });
    const record = db.loadOverrides().notesmap[1003];
    assert.equal(record.NotesBy, 'u-a');
    assert.equal(record.EkNotBy, 'u-b');
  });
});

test('not silinince yazar damgası da düşer', () => {
  withDb(db => {
    db.patchOrderOverride(1004, { notes: { Notes: 'Geçici' } }, null, null, { actor: { id: 'u-a', name: 'A' } });
    db.patchOrderOverride(1004, { notes: { Notes: '' } }, null, null, { actor: { id: 'u-a', name: 'A' } });
    const record = db.loadOverrides().notesmap[1004];
    assert.equal(record.Notes, '');
    assert.equal(record.NotesBy, undefined, 'boş nota yazar damgası kalmamalı');
    assert.equal(record.NotesByName, undefined);
  });
});

test('oturumsuz bir iç çağrı mevcut yazarı SİLMEZ', () => {
  // Boş bir yazar yazmak, notu "yazarı bilinmiyor" durumuna düşürüp sahibinin
  // Genel Bakış listesinden kaybetmesine yol açardı.
  withDb(db => {
    db.patchOrderOverride(1005, { notes: { Notes: 'İlk' } }, null, null, { actor: { id: 'u-a', name: 'A' } });
    db.patchOrderOverride(1005, { notes: { Notes: 'Sonra' } }); // actor yok
    const record = db.loadOverrides().notesmap[1005];
    assert.equal(record.Notes, 'Sonra');
    assert.equal(record.NotesBy, 'u-a');
  });
});

/* ------------------------------------------------------------------ */
/* 2) Eski kayıtların geri doldurulması                                */
/* ------------------------------------------------------------------ */

test('yazarsız eski notlara GÖKBERK ÇELEBİ yazılır', () => {
  const map = { 5001: { Notes: 'Eski not', NotesAt: '2026-01-05T08:00:00.000Z' } };
  const out = require(path.join(ROOT, 'server', 'db.js')).backfillLegacyNoteAuthors(map);
  assert.equal(out[5001].NotesByName, 'GÖKBERK ÇELEBİ');
  assert.ok(String(out[5001].NotesBy || '').length, 'kimlik alanı da dolmalı');
  assert.equal(out[5001].Notes, 'Eski not', 'not metni değişmemeli (§142)');
  assert.equal(out[5001].NotesAt, '2026-01-05T08:00:00.000Z', 'tarih değişmemeli');
});

test('YAZARI OLAN notlar geri doldurmadan etkilenmez', () => {
  const db = require(path.join(ROOT, 'server', 'db.js'));
  const map = { 5002: { Notes: 'Ayşe’nin notu', NotesBy: 'u-ayse', NotesByName: 'AYŞE ERCAN' } };
  const out = db.backfillLegacyNoteAuthors(map);
  assert.equal(out[5002].NotesBy, 'u-ayse');
  assert.equal(out[5002].NotesByName, 'AYŞE ERCAN');
});

test('boş notlar yazar damgası almaz', () => {
  const db = require(path.join(ROOT, 'server', 'db.js'));
  const out = db.backfillLegacyNoteAuthors({ 5003: { Notes: '', EkNot: '   ' } });
  assert.equal(out[5003].NotesBy, undefined);
  assert.equal(out[5003].EkNotBy, undefined);
});

test('geri doldurma tekrarlanabilir — ikinci çalıştırma hiçbir şeyi değiştirmez', () => {
  const db = require(path.join(ROOT, 'server', 'db.js'));
  const map = { 5004: { Notes: 'Eski', EkNot: 'Eski ek' } };
  const first = JSON.parse(JSON.stringify(db.backfillLegacyNoteAuthors(map)));
  const second = db.backfillLegacyNoteAuthors(map);
  assert.deepEqual(second, first);
});

test('aynı sipariş yarı damgalıysa yalnız eksik alan doldurulur', () => {
  const db = require(path.join(ROOT, 'server', 'db.js'));
  const out = db.backfillLegacyNoteAuthors({ 5005: { Notes: 'Yeni', NotesBy: 'u-ayse', NotesByName: 'AYŞE', EkNot: 'Eski ek' } });
  assert.equal(out[5005].NotesBy, 'u-ayse');
  assert.equal(out[5005].EkNotByName, 'GÖKBERK ÇELEBİ');
});

test('geri doldurma açılışta çalışır — eski dosya yazarsız kalmaz', () => {
  withDb(db => {
    const file = path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, 'overrides.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ notesmap: { 7001: { Notes: 'v7.28 öncesi not' } }, _revision: 1, _revisions: { orders: 1 } }), 'utf8');
    const record = db.loadOverrides().notesmap[7001];
    assert.equal(record.NotesByName, 'GÖKBERK ÇELEBİ');
    assert.equal(record.Notes, 'v7.28 öncesi not');
  });
});

/* ------------------------------------------------------------------ */
/* 3) Yazar satırlara taşınır                                          */
/* ------------------------------------------------------------------ */

function asasOrder(extra = {}) {
  return {
    ocode: 1234567, model: 'MODEL-A', ccode: 'BLK', colour: 'SIYAH', season: 'S7', countryRaw: 'INDIA',
    manufacturer: 'MFR', license: 'MINECRAFT', category: 'TOP', qty: 100, kalan: 100, fob: 1.2,
    opd: new Date(2026, 7, 1), ex: new Date(2026, 8, 1), retail: new Date(2026, 9, 1), mb: new Date(2026, 9, 1),
    merkezSevkeHazirKalan: 0, ...extra,
  };
}
function overrides(extra = {}) {
  return { notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, datemap: {}, pricingRules: [], transitRules: [], ...extra };
}

test('CP satırları not yazarını taşır', () => {
  const key = parse.orderLineKey(1234567, 'MODEL-A', 'BLK');
  const [row] = parse.buildCPRowsFromASAS([asasOrder()], {}, overrides({ notesmap: { [key]: {
    Notes: 'Ayşe notu', NotesBy: 'u-ayse', NotesByName: 'AYŞE ERCAN',
    EkNot: 'Mehmet notu', EkNotBy: 'u-mehmet', EkNotByName: 'MEHMET KAYA',
  } } }));
  assert.equal(row._notesBy, 'u-ayse');
  assert.equal(row._notesByName, 'AYŞE ERCAN');
  assert.equal(row._ekNotBy, 'u-mehmet');
  assert.equal(row._ekNotByName, 'MEHMET KAYA');
  // CP satırındaki NOT METİNLERİ herkes için aynı kalır — süzgeç yalnız Genel Bakış'ta.
  assert.equal(row.Notes, 'Ayşe notu');
  assert.equal(row['Ek Not'], 'Mehmet notu');
});

test('önbellekten güncellenen satır yazarsız kalmaz', () => {
  // Bu satır atlanırsa kullanıcının az önce yazdığı not kendi Genel Bakış
  // listesinde görünmezdi (önbellekteki satırda yazar alanı olmayacaktı).
  const start = SERVER.indexOf('function applyIncrementalProjectionPatch(');
  const body = SERVER.slice(start, start + 1400);
  assert.match(body, /row\._notesBy\s*=\s*notesRec\.NotesBy/);
  assert.match(body, /row\._ekNotByName\s*=\s*notesRec\.EkNotByName/);
  assert.match(body, /overrides\.notesmap/, 'yazar kayıtlı notesmap’ten okunmalı, patch’ten değil');
});

test('sunucu yazarı oturumdan üretir ve tüm yazma uçlarına geçirir', () => {
  assert.match(SERVER, /function noteActorOf\(profile\)/);
  assert.match(SERVER, /profile\.displayName \|\| profile\.username/);
  const calls = SERVER.match(/patchOrderOverrides?\([^\n]*noteActorOf\(/g) || [];
  assert.ok(calls.length >= 4, `not yazabilen her uç yazarı geçirmeli (bulunan: ${calls.length})`);
});

/* ------------------------------------------------------------------ */
/* 4) Genel Bakış süzgeci                                              */
/* ------------------------------------------------------------------ */

// Tarayıcı kodundaki iki saf yardımcıyı yalıtıp çalıştırır: appLang/state gibi
// bağımlılıkları olmayan, karar veren asıl işlevler bunlar.
function loadOverviewHelpers(currentUser) {
  const grab = name => {
    const start = APP.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} bulunamadı`);
    let depth = 0, index = APP.indexOf('{', start);
    for (let i = index; i < APP.length; i++) {
      if (APP[i] === '{') depth++;
      else if (APP[i] === '}') { depth--; if (!depth) return APP.slice(start, i + 1); }
    }
    throw new Error(`${name} gövdesi kapanmadı`);
  };
  const source = [
    'const window={BL_USER_CONTEXT:CURRENT_USER};',
    'const state={currentUser:CURRENT_USER};',
    "function norm(v){return v==null?'':String(v).trim();}",
    "function turknorm(v){return String(v==null?'':v).toLocaleUpperCase('tr-TR').trim();}",
    grab('noteAuthorIdentity'),
    grab('noteAuthoredByCurrentUser'),
    grab('overviewNoteCanonical'),
    grab('overviewOrderNoteText'),
    grab('overviewNoteTimestamp'),
    'return {noteAuthoredByCurrentUser,overviewOrderNoteText,overviewNoteTimestamp};',
  ].join('\n');
  return new Function('CURRENT_USER', source)(currentUser);
}

const ME = { id: 'u-gokberk', displayName: 'GÖKBERK ÇELEBİ' };

test('Genel Bakış KENDİ notunu gösterir', () => {
  const helpers = loadOverviewHelpers(ME);
  const row = { Notes: 'Benim notum', _notesBy: 'u-gokberk', _notesByName: 'GÖKBERK ÇELEBİ' };
  assert.equal(helpers.overviewOrderNoteText(row), 'Benim notum');
});

test('BAŞKASININ notu Genel Bakış’a gelmez', () => {
  const helpers = loadOverviewHelpers(ME);
  const row = { Notes: 'Ayşe’nin notu', _notesBy: 'u-ayse', _notesByName: 'AYŞE ERCAN' };
  assert.equal(helpers.overviewOrderNoteText(row), '');
});

test('SÜZME ALAN BAZINDA: aynı siparişte yalnız sizin alanınız görünür', () => {
  const helpers = loadOverviewHelpers(ME);
  const row = {
    Notes: 'Benim notum', _notesBy: 'u-gokberk', _notesByName: 'GÖKBERK ÇELEBİ',
    'Ek Not': 'Ayşe’nin eki', _ekNotBy: 'u-ayse', _ekNotByName: 'AYŞE ERCAN',
  };
  assert.equal(helpers.overviewOrderNoteText(row), 'Benim notum');
});

test('yalnız Ek Not sizinse o görünür', () => {
  const helpers = loadOverviewHelpers(ME);
  const row = {
    Notes: 'Ayşe’nin notu', _notesBy: 'u-ayse', _notesByName: 'AYŞE ERCAN',
    'Ek Not': 'Benim ekim', _ekNotBy: 'u-gokberk', _ekNotByName: 'GÖKBERK ÇELEBİ',
  };
  assert.equal(helpers.overviewOrderNoteText(row), 'Benim ekim');
});

test('geri doldurulmuş eski notlar GÖKBERK ÇELEBİ’de görünür, başkasında görünmez', () => {
  const legacy = { Notes: 'v7.28 öncesi not', _notesBy: 'legacy-note-author', _notesByName: 'GÖKBERK ÇELEBİ' };
  assert.equal(loadOverviewHelpers(ME).overviewOrderNoteText(legacy), 'v7.28 öncesi not');
  const other = loadOverviewHelpers({ id: 'u-ayse', displayName: 'AYŞE ERCAN' });
  assert.equal(other.overviewOrderNoteText(legacy), '');
});

test('yazarı hiç olmayan not kimseye ait sayılmaz', () => {
  const helpers = loadOverviewHelpers(ME);
  assert.equal(helpers.overviewOrderNoteText({ Notes: 'Sahipsiz' }), '');
  assert.equal(helpers.noteAuthoredByCurrentUser('', ''), false);
});

test('yalnız adla saklanmış damga Türkçe büyük/küçük harf farkına takılmaz', () => {
  const helpers = loadOverviewHelpers(ME);
  assert.equal(helpers.noteAuthoredByCurrentUser('', 'gökberk çelebi'), true);
  assert.equal(helpers.noteAuthoredByCurrentUser('GÖKBERK ÇELEBİ', ''), true);
});

test('tarih de yalnız SİZE ait notlardan hesaplanır', () => {
  // Aksi hâlde başkasının notunun tarihi sizin listenizin sıralamasını belirlerdi.
  const helpers = loadOverviewHelpers(ME);
  const row = {
    Notes: 'Ayşe’nin notu', _notesBy: 'u-ayse', _notesAt: '2026-01-01T00:00:00.000Z',
    'Ek Not': 'Benim ekim', _ekNotBy: 'u-gokberk', _ekNotAt: '2026-06-01T00:00:00.000Z',
  };
  assert.equal(helpers.overviewNoteTimestamp(row), Date.parse('2026-06-01T00:00:00.000Z'));
  assert.equal(helpers.overviewNoteTimestamp({ Notes: 'x', _notesBy: 'u-ayse', _notesAt: '2026-01-01T00:00:00.000Z' }), null);
});

/* ------------------------------------------------------------------ */
/* 5) CP ve Orders'a dokunulmadı                                       */
/* ------------------------------------------------------------------ */

test('CP ve Orders not hücreleri süzülmez — herkesin notu görünmeye devam eder', () => {
  // Süzgeç YALNIZ Genel Bakış yardımcılarında olmalı; hücre çizimi ham
  // row.Notes / row['Ek Not'] okumaya devam etmeli.
  const uses = APP.match(/noteAuthoredByCurrentUser\(/g) || [];
  assert.ok(uses.length >= 3, 'süzgeç Genel Bakış yardımcılarında kullanılmalı');
  const cellStart = APP.indexOf('function cellHtml(');
  const cellBody = APP.slice(cellStart, APP.indexOf('function cellPlainText('));
  assert.equal(/noteAuthoredByCurrentUser/.test(cellBody), false, 'hücre çizimi not yazarına göre süzmemeli');
  const plainStart = APP.indexOf('function cellPlainText(');
  assert.equal(/noteAuthoredByCurrentUser/.test(APP.slice(plainStart, plainStart + 2000)), false, 'Excel çıktısı da süzmemeli');
});

/* v7.30'da GÜNCELLENDİ (silinmedi). Bu test sürümü "7.29" olarak SABİT
   yazıyordu ve her yükseltmede kırılıyordu; gerçek bir kusuru değil yalnız
   tarihi bildiriyordu. Sürüm yayılımı zaten formula-columns testinde
   package.json'dan okunarak sınanıyor. Buradaki asıl amaç — v7.29 sürüm
   notunun geri doldurmayı ve olası yanlış atfı AÇIKÇA söylemesi — korunuyor. */
test('v7.29 sürüm notu geri doldurmayı ve olası yanlış atfı açıkça söyler', () => {
  const history = fs.readFileSync(path.join(ROOT, 'public', 'version-history.js'), 'utf8');
  assert.ok(history.includes("v: '7.29'"), 'v7.29 kaydı silinmemeli');
  assert.match(history, /GÖKBERK ÇELEBİ adına geri dolduruldu/);
  assert.match(history, /gerçekte başka kullanıcılar tarafından yazılmış olabilir/);
});

test('Genel Bakış metinleri kuralı açıkça anlatır', () => {
  assert.match(APP, /SİZİN notunuzu taşıyan/);
  assert.match(APP, /YALNIZ sizin yazdığınız notlar listelenir/);
  assert.match(APP, /CP Tracker ve Siparişler ekranlarında durmaya devam eder/);
});

test('Notes Reminder not metnine tıklamak mevcut not düzenleyicisini açar', () => {
  const start = APP.indexOf('function renderOverviewPriorityReminder(');
  const end = APP.indexOf('function renderOverviewRefreshResult(', start);
  const block = APP.slice(start, end);
  assert.match(block, /class=\"ovNoteText ovNoteTextEdit\"/);
  assert.match(block, /data-note-edit=\"\$\{groupIndex\}\"/);
  assert.match(block, /querySelectorAll\('\[data-note-edit\]'\)/);
  assert.match(block, /openOverviewNoteEditor\(groups\[Number\(node\.dataset\.noteEdit\)\]\)/);
  assert.match(APP, /function openOverviewNoteEditor\(group\)[\s\S]*openNotesEditor\(Number\(target\.row\._id\),target\.key\)/);
});
