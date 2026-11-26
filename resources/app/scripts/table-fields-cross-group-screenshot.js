'use strict';
// Gerçek Buyer Log (izole, üretilmiş demo veri): CP Alanlar çekmecesinde bir sistem
// sütunu (Ürün Tanım / Product Description) sürükle-bırakla Sipariş Detayları
// başlığına taşınır. Tablo bandı, kişisel kayıt, sayfa yenileme sonrası kalıcılık ve
// "Alanları sıfırla" doğrulanır; sürüm notu görselini üretir. Uzak yazma yoktur.
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/table-fields-cross-group-screenshot.js [--no-shot]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

const KEY = 'Ürün Tanım'; // i18n-ignore — ASAS sütun anahtarı
const TARGET = 'Season';
const FROM = 'Model Detayları', TO = 'Sipariş Detayları'; // i18n-ignore — başlık kimlikleri

async function openCp(page) {
  await page.click('button[data-tab="cp"]');
  await page.waitForFunction(() => state.cp && state.cp.rows && state.cp.rows.length && document.querySelector('#view-cp')?.offsetParent, null, { timeout: 120000 });
  await page.waitForSelector('#view-cp [data-table-fields="cp"]', { state: 'attached', timeout: 60000 });
}
// Kalem düğmesi görünüm seçici menüsündedir; çekmece aynı işleyiciyle açılır.
const clickFields = page => page.evaluate(() => openTableFieldsMenu(document.querySelector('#view-cp [data-table-fields="cp"]')));
async function openFields(page) {
  await clickFields(page);
  await page.waitForSelector('#_tableFieldsMenu .tableFieldsList');
  for (const group of [FROM, TO]) {
    const toggle = `#_tableFieldsMenu [data-table-fields-toggle="${group}"]`;
    if (await page.$eval(toggle, el => el.getAttribute('aria-expanded')) !== 'true') await page.click(toggle);
  }
}
// Tabloda sütunun üstündeki ana başlık bandı (thead groupRow) hangi başlığı gösteriyor?
const bandOf = (page, key) => page.evaluate(column => {
  const index = visibleCols('cp').findIndex(c => c.k === column);
  if (index < 0) return null;
  const band = [...document.querySelectorAll('#cpTable thead tr.groupRow th[data-grp]')].find(th => Number(th.dataset.start) <= index && index <= Number(th.dataset.end));
  return band ? band.dataset.grp : null;
}, key);

(async () => {
  const app = await start({ initScript: () => { try { localStorage.setItem('bl.user.moderator.lcw.lang.v1', 'en'); localStorage.setItem('bl.user.moderator.lcw_theme', 'dark'); localStorage.setItem('buyerlog.ui.appearance', JSON.stringify({ theme: 'dark', step: 0 })); } catch (_) {} }, deviceScaleFactor: 2 });
  try {
    const { page } = app;
    await openCp(page);
    // Görünüm Tümü: sütun hangi görünümde olursa olsun tabloda görünür.
    await page.evaluate(() => applyTableViewPreset('cp', 'all'));
    assert.equal(await bandOf(page, KEY), FROM);
    await openFields(page);
    // Gerçek HTML5 sürükle-bırak: Product Description → Season'ın üst yarısı (önüne).
    const source = `#_tableFieldsMenu [data-table-fields-col="${KEY}"]`;
    const target = `#_tableFieldsMenu [data-table-fields-col="${TARGET}"]`;
    assert.equal(await page.$eval(source, el => el.getAttribute('draggable')), 'true');
    await page.dragAndDrop(source, target, { targetPosition: { x: 60, y: 4 } });
    await page.waitForFunction(([key, group]) => tableViewColumnGroup('cp', key) === group, [KEY, TO], { timeout: 10000 });
    assert.equal(await page.$eval(source, el => el.dataset.group), TO, 'çekmecede yeni başlığın altında');
    assert.equal(await bandOf(page, KEY), TO, 'tablo bandı yeni başlığı gösterir');
    const stored = await page.evaluate(() => readAutoTableColumnState().cp.groups);
    assert.deepEqual(stored, { [KEY]: TO });
    const order = await page.evaluate(() => colmgr.cp.order.slice());
    assert.equal(order.indexOf(KEY) + 1, order.indexOf(TARGET), 'Season’ın hemen önünde');
    // Sürüm notu görseli: çekmece açık, sütun Order Details altında; arkada tablo bandı.
    // Demo verinin açılış uyarı bildirimi kareyi kapatmasın.
    await page.evaluate(() => document.querySelectorAll('body > *').forEach(el => {
      if (el.id === '_tableFieldsMenu' || getComputedStyle(el).position !== 'fixed' || !/4 (warnings|uyarı)/.test(el.textContent || '')) return;
      el.querySelector('button[aria-label], button')?.click();
    }));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/table-fields-cross-group.png');
    if (!process.argv.includes('--no-shot')) {
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({ path: screenshot });
    }
    // Sayfa yenilendikten sonra (hesap tercihi hidrasyonu dahil) başlık korunur.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-boot-continue]', { timeout: 180000 }); await page.click('[data-boot-continue]');
    await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 180000 });
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    await openCp(page);
    assert.equal(await page.evaluate(key => tableViewColumnGroup('cp', key), KEY), TO, 'yenilemeden sonra kalıcı');
    assert.equal(await bandOf(page, KEY), TO);
    // Alanları sıfırla: sütun tanımdaki başlığına döner.
    await clickFields(page);
    await page.waitForSelector('#_tableFieldsMenu [data-table-fields-reset]:not([disabled])');
    await page.click('#_tableFieldsMenu [data-table-fields-reset]');
    await page.waitForFunction(([key, group]) => tableViewColumnGroup('cp', key) === group, [KEY, FROM], { timeout: 10000 });
    assert.equal(await page.evaluate(() => readAutoTableColumnState().cp.groups), undefined);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ moved: KEY, from: FROM, to: TO, screenshot }, null, 1));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
