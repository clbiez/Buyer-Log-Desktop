'use strict';

/* v9.43 — ORDER CODE SAĞ TIK MENÜSÜ: kaynak-metin doğrulaması.
 *
 * public/app-main.js ve public/row-context-menu.js DOM'a bağlı, ayrıştırılamaz
 * (bkz. CLAUDE.md §2) — bu yüzden kaynak metin eşleştirmesiyle test edilir.
 * Asıl korunan kusur: yeni sağ tık menüsü eklenirken mevcut Order Code
 * ÇİFT-TIK-Troy-aç davranışı (a.lnk, data-copy-text, global dblclick/click/
 * auxclick dinleyicileri) YANLIŞLIKLA değişmemeli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const ROW_MENU = fs.readFileSync(path.join(ROOT, 'public', 'row-context-menu.js'), 'utf8');

test('v9.43 mevcut Order Code çift-tık-Troy-aç davranışı değişmedi', () => {
  assert.match(APP_MAIN, /case 'ordercode': return `<td class="num"\$\{oc\?' data-ordercode-cell="1"':''\} data-copy-text=/);
  assert.match(APP_MAIN, /<a class="lnk" title=.*href="\$\{ORDER_URL\(oc\)\}">/);
  assert.match(APP_MAIN, /const BRIDGE_LINK_SELECTOR = 'a\.lnk\[href\]';/);
  assert.match(APP_MAIN, /document\.addEventListener\('dblclick',event=>\{/);
});

test('v9.43 ordercode hücresi yeni bir işaretleyici taşıyor, model-adı hücresini etkilemiyor', () => {
  assert.match(APP_MAIN, /data-ordercode-cell="1"/);
  // Model Name hücresinin kendi işaretçisi (plmModelLinkCell) hâlâ ayrı ve dokunulmamış.
  assert.match(APP_MAIN, /case 'modelLink': return `<td class="plmModelLinkCell"/);
});

test('v9.43 row-context-menu.js: contextmenu dispatch\'i model-adı dalına PARALEL yeni bir dal içeriyor', () => {
  assert.match(ROW_MENU, /if \(isModelCell\) \{ openForCell\(config, table, cell, event\); return; \}/);
  assert.match(ROW_MENU, /if \(cell\.dataset\.ordercodeCell === '1'\) \{ openOrderCodeMenu\(config, cell, event\); return; \}/);
});

test('v9.43 row-context-menu.js: Siparişi Kapat onay ister ve doğru endpoint/gövdeyi çağırır', () => {
  assert.match(ROW_MENU, /confirm\(/);
  assert.match(ROW_MENU, /\/api\/troy\/orders\/\$\{encodeURIComponent\(orderCode\)\}\/close/);
});

test('v9.43 row-context-menu.js: PO durumu/indirme/açma/klasör endpoint\'leri tam olarak dokümante edilen yollarla eşleşiyor', () => {
  assert.match(ROW_MENU, /\/api\/troy\/orders\/\$\{encodeURIComponent\(orderCode\)\}\/po\/status\?styleName=/);
  assert.match(ROW_MENU, /\/api\/troy\/orders\/\$\{encodeURIComponent\(orderCode\)\}\/po`, \{[\s\S]*?method: 'POST'/);
  assert.match(ROW_MENU, /\/api\/troy\/orders\/\$\{encodeURIComponent\(orderCode\)\}\/po\/open`/);
  assert.match(ROW_MENU, /\/api\/troy\/po-folder\/open'/);
});

test('v9.43 row-context-menu.js: menü öğe etiketleri dosya var/yok durumuna göre doğru seçiliyor', () => {
  assert.match(ROW_MENU, /if \(status && status\.exists\) \{/);
  assert.match(ROW_MENU, /PO\\'yu Aç.*Open PO/);
  assert.match(ROW_MENU, /PO\\'yu Yeniden İndir.*Re-download PO/);
  assert.match(ROW_MENU, /PO Klasörünü Aç.*Open PO Folder/);
  assert.match(ROW_MENU, /\} else \{[\s\S]*?Download PO/);
});

test('v9.43 row-context-menu.js: TROY_LOGIN_REQUIRED özel olarak ele alınıyor', () => {
  assert.match(ROW_MENU, /err\.code === 'TROY_LOGIN_REQUIRED'/);
});

test('v9.43 server.js: yeni Troy route\'ları yetki kontrolüyle tanımlı', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/troy\/orders\/:orderCode\/close', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /app\.get\('\/api\/troy\/orders\/:orderCode\/po\/status', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /app\.post\('\/api\/troy\/orders\/:orderCode\/po', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /app\.post\('\/api\/troy\/orders\/:orderCode\/po\/open', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /app\.post\('\/api\/troy\/po-folder\/open', userAccess\.requireAnyArea\('cp', 'orders'\)/);
});

test('v9.45 row-context-menu.js: "Revize Et" Siparişi Kapat\'ın yanına eklendi, ayrı bir menü sistemi kurulmadı', () => {
  assert.match(ROW_MENU, /label: T\('Siparişi Kapat', 'Close Order'\), run: \(\) => closeOrderAction\(orderCode\) \},\s*\n\s*\{ label: T\('Revize Et', 'Revise Order'\), run: \(\) => reviseOrderAction\(orderCode\) \}/);
});

test('v9.45 row-context-menu.js: Revize Et doğru endpoint\'i çağırıyor, TROY_LOGIN_REQUIRED\'de "Troy\'da Oturum Aç" akışına düşüyor', () => {
  assert.match(ROW_MENU, /\/api\/troy\/orders\/\$\{encodeURIComponent\(orderCode\)\}\/revise`, \{ method: 'POST' \}/);
  assert.match(ROW_MENU, /async function reviseOrderAction\(orderCode\)/);
  assert.match(ROW_MENU, /confirm\(T\('Revize işlemi için Troy\\'da oturum açmanız gerekiyor/);
  assert.match(ROW_MENU, /\/api\/troy\/login\/open', \{ method: 'POST' \}/);
});

test('v9.45 server.js: revize ve Troy login-open route\'ları yetki kontrolüyle tanımlı, Kapat/PO route\'larına dokunulmadı', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/troy\/orders\/:orderCode\/revise', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /app\.post\('\/api\/troy\/login\/open', userAccess\.requireAnyArea\('cp', 'orders'\)/);
  assert.match(server, /troyOrderService\.openRevision\(req\.currentUser\.id, req\.params\.orderCode\)/);
  assert.match(server, /troyOrderService\.openTroyLogin\(req\.currentUser\.id\)/);
  // Kapat route'u hâlâ aynı: closeOrder çağrısı değişmedi.
  assert.match(server, /troyOrderService\.closeOrder\(req\.currentUser\.id, req\.params\.orderCode\)/);
});
