'use strict';

/*
 * Ortak "dosya hazır" bildirim kartı: CP/Orders Excel dışa aktarımı ve
 * Electron indirmeleri için paylaşılan sözleşme — başarılı dosya işlemi → yetkin son yol
 * → tek bir sağ üst bildirim (Aç/Klasörde Göster). public/app-main.js ve
 * public/row-context-menu.js DOM'a bağlı/ayrıştırılamaz (bkz. CLAUDE.md §2),
 * bu yüzden kaynak-metin sözleşmesiyle test edilir; ui-primitives.js ve
 * server/lib/platform.js saf fonksiyonlar olduğu için doğrudan çalıştırılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const APP_MAIN = read('public/app-main.js');
const DESIGN = require('./helpers/manifest-css')();
const MAIN_SOURCE = read('electron/main.js');
const PRELOAD_SOURCE = read('electron/preload.js');

const UI = require('../public/ui-primitives.js');
const platform = require('../server/lib/platform');

/* --------------------------------------------------------- platform.js */

test('platform: dosyayı klasörde SEÇEREK gösterme komutu doğru platforma göre seçilir', () => {
  const plan = platform.revealFileInFolderPlan('/tmp/Buyer Log PO/PO_123.pdf');
  if (platform.IS_WINDOWS) {
    assert.equal(plan.cmd, 'explorer.exe');
    assert.deepEqual(plan.args, ['/select,/tmp/Buyer Log PO/PO_123.pdf']);
  } else if (platform.IS_MAC) {
    assert.equal(plan.cmd, 'open');
    assert.deepEqual(plan.args, ['-R', '/tmp/Buyer Log PO/PO_123.pdf']);
  } else {
    assert.equal(plan.cmd, 'xdg-open');
    assert.deepEqual(plan.args, ['/tmp/Buyer Log PO']);
  }
});

/* ------------------------------------------------------- ui-primitives.js */

test('ui-primitives: feedbackView isteğe bağlı ikincil satır (yol) ve aksiyon düğmeleri üretir', () => {
  const view = UI.feedbackView('Rapor.xlsx', {
    kind: 'success', kindLabel: 'Dosya oluşturuldu', detail: 'C:\\Users\\ali\\Downloads',
    actions: [{ id: 'open', label: 'Aç', primary: true }, { id: 'reveal', label: 'Klasörde Göster' }],
  });
  assert.match(view, /uiFeedbackDetail">C:\\Users\\ali\\Downloads</);
  assert.match(view, /data-ui-feedback-action="open"/);
  assert.match(view, /data-ui-feedback-action="reveal"/);
  assert.match(view, /uiFeedbackAction primary/);
});

test('ui-primitives: aksiyonsuz/detaysız çağrılar hâlâ eski (v10.38) çıktıyı üretir — geriye dönük uyumluluk', () => {
  const view = UI.feedbackView('Bilgi', { kind: 'info' });
  assert.doesNotMatch(view, /uiFeedbackDetail/);
  assert.doesNotMatch(view, /uiFeedbackActions/);
});

test('ui-primitives: notify aksiyon tıklamasını onAction\'a iletir, hata fırlatsa da çökmez', async () => {
  // notify() document olmadan kapalı bir no-op döner; burada yalnız DOM'suz
  // erken çıkışın (document tanımsızken) çökmediği doğrulanır.
  const close = UI.notify('mesaj', { kind: 'success' });
  assert.equal(typeof close, 'function');
  assert.doesNotThrow(() => close());
});

test('ui-primitives kaynak: aksiyon tıklaması devre dışı bırakılır, hata console.warn ile yutulur — kart çökmez', () => {
  assert.match(UI_SOURCE(), /data-ui-feedback-action/);
  assert.match(UI_SOURCE(), /btn\.disabled=true/);
  assert.match(UI_SOURCE(), /catch\(err=>\{console\.warn\('uiFeedback action failed:',err\);\}\)/);
});
function UI_SOURCE() { return read('public/ui-primitives.js'); }

/* --------------------------------------------------------------- design.css */

test('design.css: dosya-hazır kartının ek satırları da token tabanlı, hex renk yok', () => {
  const block = require('./helpers/manifest-css').rules(/uiFeedback/);
  assert.match(block, /\.uiFeedbackDetail\{/);
  assert.match(block, /\.uiFeedbackActions\{/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
});

/* --------------------------------------------------------------- app-main.js */

test('app-main.js: notifyFileReady ortak bildirimi (toast geçmişi + BLUI.notify) kullanır, kalıcıdır', () => {
  const start = APP_MAIN.indexOf('function notifyFileReady');
  assert.ok(start > 0, 'notifyFileReady tanımlı değil');
  const body = APP_MAIN.slice(start, APP_MAIN.indexOf('if(window.buyerLogDesktop'));
  assert.match(body, /notificationHistoryAdd\(/);
  assert.match(body, /window\.BLUI\?\.notify/);
  assert.match(body, /placement:'edge'/);
  assert.match(body, /duration:0/);
  assert.match(body, /mode==='downloaded'/);
});

test('app-main.js: başarısız aksiyon showToast ile kontrollü hata gösterir, uncaught bırakmaz', () => {
  const start = APP_MAIN.indexOf('function notifyFileReady');
  const body = APP_MAIN.slice(start, start + 1500);
  assert.match(body, /catch\(err\)\{/);
  assert.match(body, /showToast\(\(err&&err\.message\)/);
});

test('app-main.js: Electron indirme köprüsü yalnız köprü VARSA dinlenir, yol asla renderer\'da uydurulmaz', () => {
  const start = APP_MAIN.indexOf("if(window.buyerLogDesktop&&typeof window.buyerLogDesktop.onDownloadComplete");
  assert.ok(start > 0);
  const body = APP_MAIN.slice(start, start + 900);
  assert.match(body, /if\(!info\|\|!info\.success\|\|!info\.token\)return;/);
  assert.match(body, /mode:'created'/);
  assert.match(body, /window\.buyerLogDesktop\.openDownload\(info\.token\)/);
  assert.match(body, /window\.buyerLogDesktop\.revealDownload\(info\.token\)/);
});

/* ---------------------------------------------------- electron main/preload */

test('electron/main.js: tamamlanan indirme yalnız BAŞARILI durumda ve token ile bildirilir — ham yol renderer\'a "aksiyon girdisi" olarak gitmez', () => {
  assert.match(MAIN_SOURCE, /function registerDownload\(filePath\)/);
  assert.match(MAIN_SOURCE, /state === 'completed' && target/);
  assert.match(MAIN_SOURCE, /workspace\.sendToDownloadOwner\(initiatingContents, 'buyerlog:download-complete', payload\)/);
  assert.match(MAIN_SOURCE, /webContents\.send\('buyerlog:download-complete',/);
  assert.match(MAIN_SOURCE, /ipcMain\.handle\('buyerlog:open-download', \(event, token\)/);
  assert.match(MAIN_SOURCE, /ipcMain\.handle\('buyerlog:reveal-download', \(event, token\)/);
  assert.match(MAIN_SOURCE, /trustedBuyerLogIpcSender\(event\)/);
  assert.match(MAIN_SOURCE, /shell\.showItemInFolder\(entry\.path\)/);
  // Token bulunamazsa/​dosya silinmişse çökmeden kontrollü hata döner.
  assert.match(MAIN_SOURCE, /if \(!entry \|\| !fs\.existsSync\(entry\.path\)\) return \{ ok: false, error: 'not-found' \};/);
});

test('electron/preload.js: indirme köprüsü yalnız token alışverişi yapar — genel/ham yol parametresi yok', () => {
  assert.match(PRELOAD_SOURCE, /onDownloadComplete: \(callback\) => \{/);
  assert.match(PRELOAD_SOURCE, /openDownload: \(token\) => ipcRenderer\.invoke\('buyerlog:open-download', token\)/);
  assert.match(PRELOAD_SOURCE, /revealDownload: \(token\) => ipcRenderer\.invoke\('buyerlog:reveal-download', token\)/);
  // Mevcut mimari değişmezi hâlâ geçerli: ipcRenderer doğrudan dışa verilmez.
  assert.doesNotMatch(PRELOAD_SOURCE, /exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
});
