'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › OAB widget'ında:
//  1) "Filtre ekle" alan listesinin arama kutusuyla süzüldüğünü,
//  2) Genel Toplam / alt toplam satırında alt detay hücresi hover'ının satırın
//     zemin/metin çiftini koruyup okunur kaldığını (iki tema) doğrular.
// PASS'li OAB servisine bu ortamdan erişilemediği için yalnız /api/oab/** uçları
// anonim demo satırlarla taklit edilir; widget, pivot ve CSS gerçektir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

const luminance = rgb => {
  const scale = /^color\(srgb/.test(rgb) ? 1 : 255; // color-mix() sonucu color(srgb 0–1) döner
  const [r, g, b] = rgb.replace(/^color\(srgb/, '').match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / scale).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const app = await start({ initScript: ([t, l]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: [theme, lang], deviceScaleFactor: 2 });
  try {
    const { page } = app;
    const extra = ['Merch Alt Grup', 'Klasman Kod', 'Line Tanımı', 'Buyer Grup Tanımı', 'Klasman Grup Tanımı', 'Option Adı', 'Renk Adı', 'Alım Bütçe Tipi', 'Plan Ömür'];
    const fields = ['Sezon', 'Plan Başlangıç Ayı', 'Klasman Tanımı', 'Wssi Sipariş Miktarı YD', 'Onaysız Sipariş Miktarı (YD)', ...extra];
    const rows = ['S7', 'W7'].flatMap((season, s) => ['Ocak', 'Şubat'].flatMap((month, m) => ['DEMO KAZAK', 'DEMO HIRKA'].map((klasman, k) => ({
      Sezon: season, 'Plan Başlangıç Ayı': month, 'Klasman Tanımı': klasman,
      'Wssi Sipariş Miktarı YD': 1000 * (s + 1) + 100 * m + 10 * k, 'Onaysız Sipariş Miktarı (YD)': 50 * (m + 1) + k,
      ...Object.fromEntries(extra.map((name, i) => [name, `DEMO ${i}-${k}`])),
    }))));
    const pivotConfig = { rows: ['Sezon', 'Plan Başlangıç Ayı', 'Klasman Tanımı'], columns: [], values: [{ field: 'Wssi Sipariş Miktarı YD', agg: 'SUM' }, { field: 'Onaysız Sipariş Miktarı (YD)', agg: 'SUM' }], grouped: true, showSubtotals: true };
    await page.route('**/api/oab/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.split('/').pop();
      const payload = {
        seasons: { seasons: [{ SeasonRef: 1, Name: 'S7' }] },
        mag: { mag: [{ MerchSubGroupRef: 1, Name: 'DEMO' }] },
        'buyer-groups': { buyerGroups: [{ BuyerGroupRef: 1, Name: 'DEMO' }] },
        settings: { settings: { pivotConfig } },
        state: { state: { selection: { seasonRef: 1, merchSubGroupRef: 1, buyerGroupRef: 1 }, snapshot: { rows, fields } } },
      }[endpoint] || {};
      await route.fulfill({ json: { ok: true, ...payload } });
    });
    await page.waitForFunction(() => window.BLOverviewHome, null, { timeout: 60000 });
    await page.evaluate(() => {
      const index = BLOverviewHome.state().pages.findIndex(p => p.items.some(item => item.key === 'oab'));
      BLOverviewHome.goToPage(index);
    });
    await page.locator('#oabSection').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('#oabTable tbody tr').length > 1, null, { timeout: 60000 }).catch(async error => { console.error(await page.evaluate(() => ({ page: BLOverviewHome.state().page, pages: BLOverviewHome.state().pages.map(p => p.items.map(i => i.key)), oab: Boolean(window.BLOAB), section: document.getElementById('oabSection')?.className, rows: document.querySelectorAll('#oabTable tbody tr').length, status: document.getElementById('oabStatus')?.textContent }))); throw error; });
    // İlgisiz açılış bildirimi görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });

    // 1) Toplam satırlarında alt detay hücresi hover'ı okunur kalır.
    const results = {};
    for (const [name, selector] of [['grand', '#oabTable tbody tr.oabPivotGrandTotalRow'], ['subtotal', '#oabTable tbody tr.oabPivotSubtotalRow, #oabTable tbody tr.oabPivotGroupRow']]) {
      const cell = page.locator(`${selector} td.oabPivotDrillCell`).last();
      await cell.scrollIntoViewIfNeeded();
      const idle = await cell.evaluate(el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
      await cell.hover();
      await page.waitForTimeout(250);
      const hover = await cell.evaluate(el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color }; });
      const ratio = contrast(hover.bg, hover.color);
      results[name] = { idle, hover, ratio: Number(ratio.toFixed(2)) };
      assert.ok(ratio >= 4.5, `${name} hover kontrastı ${ratio.toFixed(2)} (${JSON.stringify(hover)})`);
      assert.notEqual(hover.bg, idle.bg, `${name} hover görünür bir ton değişimi yapar`);
      if (name === 'grand') {
        const box = await page.$eval('#oabSection', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        const shot = path.join(__dirname, `../public/release-notes/next-assets/oab-total-cell-hover-${theme}${lang === 'en' ? '-en' : ''}.png`);
        await page.screenshot({ path: shot, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(1400, box.w + 8), height: Math.max(Math.ceil((box.w + 8) / 3.1), Math.min(620, box.h + 8)) } });
        results.screenshot = shot;
      }
    }
    await page.mouse.move(5, 5);

    // 2) "Filtre ekle" listesi aranabilir.
    await page.click('#oabFiltersBtn');
    await page.waitForFunction(() => !document.getElementById('oabFilterPanel').hidden, null, { timeout: 10000 });
    await page.click('[data-oab-local-filter-add]');
    await page.waitForSelector('#_oabLocalFilterFieldPopover .oabLocalFilterAddSearch', { timeout: 5000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('oabLocalFilterAddSearch'), null, { timeout: 5000 });
    const total = await page.$$eval('#_oabLocalFilterFieldPopover [data-oab-add-field]', els => els.length);
    await page.keyboard.type('klasman');
    const shown = await page.$$eval('#_oabLocalFilterFieldPopover [data-oab-add-field]:not([hidden])', els => els.map(el => el.dataset.oabAddField));
    assert.ok(shown.length > 0 && shown.length < total, `arama süzer: ${shown.length}/${total}`);
    assert.ok(shown.every(field => field.toLocaleLowerCase('tr').includes('klasman')), shown.join(','));
    await page.keyboard.type('zzz');
    assert.equal(await page.$eval('#_oabLocalFilterFieldPopover [data-oab-add-noresult]', el => el.hidden), false, 'Sonuç yok görünür');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('_oabLocalFilterFieldPopover'), null, { timeout: 5000 });
    const barText = await page.textContent('#oabLocalFilterBar');
    assert.ok(barText.includes(shown[0]), `Enter ilk eşleşmeyi ekler: ${shown[0]}`);
    // Escape yalnız listeyi kapatır.
    await page.click('[data-oab-local-filter-add]');
    await page.waitForSelector('#_oabLocalFilterFieldPopover', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('_oabLocalFilterFieldPopover'), null, { timeout: 5000 });
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ ...results, filterSearch: { total, shown, added: shown[0] } }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
