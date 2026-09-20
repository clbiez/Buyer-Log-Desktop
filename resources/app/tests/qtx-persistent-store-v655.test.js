'use strict';

/* v6.55 — QTX dosyalarının kalıcı olarak kaydedilmesi ve sağ tık menüsü.
 *
 * Kullanıcı isteği: Colour Code'a sağ tıklayınca "Umbrella'da Bul" ile
 * Umbrella'dan QTX indirilip Buyer Log'a KALICI olarak kaydedilsin; "QTX
 * İndir" ile kayıtlı dosya yeniden indirilebilsin; Colour Code hücreleri
 * VARSAYILAN olarak sade görünsün, yalnız kayıtlı olanlar mavi+kalın olsun;
 * bu işaretleme Colour Code'a göre TÜM tablolarda/modellerde ortak olsun.
 *
 * Önceki mimari (v6.24/v6.41): çift tıklama yalnız tarayıcı indirmesini
 * TETİKLİYORDU, dosyanın baytları sunucuya hiç ulaşmıyordu. Bu tur, aynı
 * kanıtlanmış arama/eşleştirme mantığını KORUYARAK, "Download'a tıkla ve
 * BEKLE" adımını "tıklamadan önce ağ isteğini/blob linkini yakala" ile
 * değiştiriyor (mode:'fetch').
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* --------------------------------------------------------- 1) KALICI DEPO */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-qtx-store-v655-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(tmpRoot, 'local');
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const qtxStore = require(path.join(ROOT, 'server', 'lib', 'qtx-store.js'));

test('v6.55 QTX dosyası kaydedilip Colour Code ile geri okunabiliyor', () => {
  const saved = qtxStore.saveQtxFile('Q6K', Buffer.from('sahte qtx'), { fileName: 'Q6K.qtx', savedBy: 'u1' });
  assert.equal(saved.colourCode, 'Q6K');
  assert.equal(saved.fileName, 'Q6K.qtx');
  const entry = qtxStore.entryFor('Q6K');
  assert.ok(entry);
  assert.equal(entry.savedBy, 'u1');
});

test('v6.55 Colour Code araması büyük/küçük harf ve boşluktan bağımsız', () => {
  assert.ok(qtxStore.entryFor('q6k'));
  assert.ok(qtxStore.entryFor('  Q6K  '));
  assert.ok(qtxStore.entryFor('Q6K'));
});

test('v6.55 kaydedilmemiş Colour Code için null dönüyor, hata fırlatmıyor', () => {
  assert.equal(qtxStore.entryFor('YOK-BOYLE-BIRSEY'), null);
  assert.equal(qtxStore.filePathFor('YOK-BOYLE-BIRSEY'), null);
});

test('v6.55 kayıtlı dosyanın gerçek baytları diskten okunabiliyor', () => {
  const file = qtxStore.filePathFor('Q6K');
  assert.ok(file);
  assert.equal(fs.readFileSync(file.fullPath, 'utf8'), 'sahte qtx');
  assert.equal(file.fileName, 'Q6K.qtx');
});

test('v6.55 listSavedColourCodes tüm kayıtlı anahtarları döndürüyor', () => {
  qtxStore.saveQtxFile('HPM', Buffer.from('ikinci dosya'), { fileName: 'HPM.qtx' });
  const list = qtxStore.listSavedColourCodes();
  assert.ok(list.includes('Q6K'));
  assert.ok(list.includes('HPM'));
});

test('v6.55 boş Colour Code veya boş içerik reddediliyor', () => {
  assert.throws(() => qtxStore.saveQtxFile('', Buffer.from('x')), err => err.code === 'QTX_COLOUR_REQUIRED');
  assert.throws(() => qtxStore.saveQtxFile('ABC', Buffer.alloc(0)), err => err.code === 'QTX_FILE_EMPTY');
});

test('v6.55 aynı Colour Code tekrar kaydedilince eski dosyanın üzerine yazılıyor (tek kayıt kalır)', () => {
  qtxStore.saveQtxFile('Q6K', Buffer.from('güncellenmiş içerik'), { fileName: 'Q6K-v2.qtx' });
  const file = qtxStore.filePathFor('Q6K');
  assert.equal(fs.readFileSync(file.fullPath, 'utf8'), 'güncellenmiş içerik');
  assert.equal(qtxStore.listSavedColourCodes().filter(c => c === 'Q6K').length, 1);
});

/* -------------------------------------------- 2) UMBRELLA OTOMASYONU (mode) */

test('v6.55 umbrellaQtxDownloadExpression iki modda da geçerli JS üretiyor', () => {
  const c = require(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'));
  const trigger = c.umbrellaQtxDownloadExpression({ colourCode: 'Q6K' }, 'trigger');
  const fetchMode = c.umbrellaQtxDownloadExpression({ colourCode: 'Q6K' }, 'fetch');
  assert.doesNotThrow(() => new Function(`return ${trigger};`));
  assert.doesNotThrow(() => new Function(`return ${fetchMode};`));
  // Tek şablon, ÇALIŞMA ZAMANINDA cfg.mode'a göre dallanır (kod tekrarını
  // önlemek için bilinçli tasarım) — her iki üretimde de aynı dallanma
  // mevcuttur, yalnız gömülü cfg JSON'undaki mode değeri farklıdır.
  assert.match(trigger, /"mode":"trigger"/);
  assert.match(fetchMode, /"mode":"fetch"/);
  assert.match(trigger, /if\(cfg\.mode==='fetch'\)\{/, 'çalışma zamanı dallanması her iki üretimde de bulunmalı');
});

test('v6.55 fetch modu Download\'a tıklamadan ÖNCE yakalayıcıyı kuruyor', () => {
  // Sıralama kritik: tıklamadan SONRA yakalayıcı kurulsaydı, indirme
  // başladığı andaki ağ isteği/blob linki kaçırılırdı.
  const c = require(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'));
  const expr = c.umbrellaQtxDownloadExpression({ colourCode: 'Q6K' }, 'fetch');
  const captureAt = expr.indexOf('const capturePromise=captureDownloadBytes');
  const clickAt = expr.indexOf('clickElement(button);', captureAt);
  assert.ok(captureAt >= 0 && clickAt > captureAt);
});

test('v6.55 captureDownloadBytes fetch-override ile gerçek baytları yakalıyor (uçtan uca)', async () => {
  const start = CONNECTOR.indexOf('const captureDownloadBytes=async(doc,win)=>{');
  const end = CONNECTOR.indexOf('const colourCanonical=canonical(cfg.colourCode)', start);
  const body = CONNECTOR.slice(start, end);

  const win = { btoa: s => Buffer.from(s, 'binary').toString('base64') };
  class FakeMutationObserver { constructor() {} observe() {} disconnect() {} }
  win.MutationObserver = FakeMutationObserver;
  win.HTMLAnchorElement = class {};
  global.MutationObserver = FakeMutationObserver;
  global.HTMLAnchorElement = win.HTMLAnchorElement;

  const qtxBytes = Buffer.from('GERCEK-QTX-ICERIGI');
  win.fetch = async () => ({
    headers: { get: () => 'application/octet-stream' },
    clone() { return this; },
    async arrayBuffer() { return qtxBytes.buffer.slice(qtxBytes.byteOffset, qtxBytes.byteOffset + qtxBytes.byteLength); },
  });
  const doc = { body: {} };
  const fn = new Function('doc', 'win', 'sleep', 'SETTINGS', 'return (async(doc,win)=>{' + body + ' return await captureDownloadBytes(doc,win); })(doc,win);');

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SETTINGS = { fetchCaptureWait: 300 };
  const resultPromise = fn(doc, win, sleep, SETTINGS);
  // captureDownloadBytes SETTINGS.fetchCaptureWait kadar bekliyor; testte kısa
  // tutup win.fetch'i hemen tetikleyip sonucu bekliyoruz.
  setTimeout(() => { win.fetch('https://umbrella.example/x/Q6K.qtx'); }, 50);
  const result = await resultPromise;
  assert.ok(result && result.buffer);
  assert.equal(Buffer.from(new Uint8Array(result.buffer)).toString(), 'GERCEK-QTX-ICERIGI');
});

/* --------------------------------------------------------------- 3) SUNUCU */

test('v6.55 üç yeni QTX ucu tanımlı ve yetki korumalı', () => {
  assert.match(SERVER, /app\.post\('\/api\/qtx\/fetch-and-save'/);
  assert.match(SERVER, /app\.get\('\/api\/qtx\/saved'/);
  assert.match(SERVER, /app\.get\('\/api\/qtx\/file\/:colourCode'/);
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/qtx/fetch-and-save'"), SERVER.indexOf("app.get('/api/qtx/file/:colourCode'") + 500);
  const guards = block.match(/userAccess\.requireAnyArea\('cp', 'orders', 'koleksiyon'\)/g) || [];
  assert.equal(guards.length, 3);
});

test('v6.55 eski trigger-only /api/qtx/download ucu kaldırılmış (ölü kod bırakılmadı)', () => {
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/qtx\/download'/);
});

test('v6.55 fetch-and-save ucu mode:fetch ile çağırıp sonucu kalıcı depoya yazıyor', () => {
  const block = SERVER.slice(SERVER.indexOf("app.post('/api/qtx/fetch-and-save'"), SERVER.indexOf("app.get('/api/qtx/saved'"));
  assert.match(block, /mode:'fetch'/);
  assert.match(block, /qtxStore\.saveQtxFile\(colourCode,buffer/);
  assert.match(block, /QTX_BYTES_NOT_CAPTURED/, 'baytlar yakalanamazsa açık bir hata verilmeli, sessizce başarılı sayılmamalı');
});

/* --------------------------------------------------------------- 4) İSTEMCİ */

test('v6.55 eski çift tıklama davranışı kaldırılmış, sağ tık (contextmenu) bağlı', () => {
  assert.doesNotMatch(APP, /table\.addEventListener\('dblclick'/);
  assert.match(APP, /table\.addEventListener\('contextmenu'/);
});

test('v6.55 sağ tık menüsü iki seçenek sunuyor, kayıtlı değilse indirme kapalı', () => {
  const body = bodyOf(APP, 'openQtxContextMenu');
  assert.match(body, /data-act="fetch"/);
  assert.match(body, /data-act="download"\$\{hasSaved\?'':' disabled'\}/);
});

test('v6.55 uçtan uca: menü HTML\'i özel karakterleri kaçırıyor ve kayıt durumuna göre doğru üretiliyor', () => {
  const norm = v => String(v == null ? '' : v).trim();
  const escapeHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let appendedHtml = '';
  const fakeDoc = {
    createElement: () => ({ set innerHTML(v) { appendedHtml = v; }, style: {}, querySelector: () => ({ addEventListener: () => {} }) }),
    body: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {},
  };
  const win = { innerWidth: 1000, innerHeight: 800 };
  const fn = new Function('document', 'window', 'norm', 'escapeHtml', 'appLang', 'qtxSavedColourSet', 'qtxColourKey', 'qtxCellIdentity', 'closeQtxContextMenu',
    `function openQtxContextMenu(event,tableId,cell){${bodyOf(APP, 'openQtxContextMenu')}} return openQtxContextMenu;`
  )(fakeDoc, win, norm, escapeHtml, 'tr', new Set(['Q6K']), v => norm(v).toLocaleUpperCase('tr-TR'), () => ({ colourCode: 'Q6K & Test' }), () => {});
  fn({ preventDefault() {}, clientX: 10, clientY: 10 }, 'cpTable', {});
  assert.match(appendedHtml, /Q6K &amp; Test/);
  assert.match(appendedHtml, /data-act="fetch"/);
});

test('v6.55 applyQtxSavedHighlight yalnız kayıtlı Colour Code hücrelerini işaretliyor', () => {
  const norm = v => String(v == null ? '' : v).trim();
  function makeCell(text) {
    const classes = new Set();
    return { textContent: text, classList: { toggle: (cls, on) => { on ? classes.add(cls) : classes.delete(cls); } }, _classes: classes };
  }
  const saved = makeCell('Q6K'), unsaved = makeCell('HPM');
  const fakeTable = { querySelectorAll: () => [saved, unsaved] };
  const fakeDoc = { getElementById: id => (id === 'cpTable' ? fakeTable : null) };
  const qtxColourKey = v => norm(v).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  const fn = new Function('document', 'norm', 'qtxSavedColourSet', 'qtxColourKey',
    `function applyQtxSavedHighlight(){${bodyOf(APP, 'applyQtxSavedHighlight')}} return applyQtxSavedHighlight;`
  )(fakeDoc, norm, new Set(['Q6K']), qtxColourKey);
  fn();
  assert.ok(saved._classes.has('qtxSavedColourCell'));
  assert.ok(!unsaved._classes.has('qtxSavedColourCell'));
});

test('v6.55 uygulama açılışında kayıtlı liste çekiliyor', () => {
  assert.match(APP, /void loadQtxSavedList\(\);/);
  const body = bodyOf(APP, 'loadQtxSavedList');
  assert.match(body, /\/api\/qtx\/saved/);
});

/* --------------------------------------------------------------------- 5) CSS */

test('v6.55 Colour Code hücreleri VARSAYILAN olarak sade, yalnız kayıtlı olan kalın+mavi', () => {
  // Eski kural TÜM hücreleri koşulsuz mavi+kalın yapıyordu; artık yalnız
  // .qtxSavedColourCell sınıfı taşıyan hücreler bu görünümü alıyor.
  assert.doesNotMatch(CSS, /#cpTable td\[data-key="C\.Code"\],#ordersTable td\[data-key="C\.Code"\],#kolTable td\[data-key="colourCode"\]\{color:var\(--acc\);font-weight:700/);
  assert.match(CSS, /td\.qtxSavedColourCell\[data-key="C\.Code"\],#ordersTable td\.qtxSavedColourCell\[data-key="C\.Code"\],#kolTable td\.qtxSavedColourCell\[data-key="colourCode"\]\{color:var\(--acc\);font-weight:700/);
});
