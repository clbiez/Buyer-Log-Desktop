'use strict';
// Gerçek Buyer Log (anonim demo veri) Genel Bakış › Ticari › OAB (Küp) widget'ının
// pivot ayar penceresinde uzun alan listesinin aranabilir seçiciyle açıldığını
// uçtan uca sürer ve sürüm notu görselini üretir. Şirket içi küpe bu ortamdan
// erişilemediği için yalnız /api/oab-cube/metadata anonim sentetik alanlarla
// taklit edilir; widget, ayar penceresi ve seçici gerçektir.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');

(async () => {
  const theme = process.argv.includes('--dark') ? 'dark' : 'light';
  const lang = process.argv.includes('--en') ? 'en' : 'tr';
  const app = await start({ initScript: ([t, l]) => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); localStorage.setItem('bl.user.moderator.lcw.lang.v1', l); } catch (_) {} }, initArg: [theme, lang], deviceScaleFactor: 2 });
  try {
    const { page } = app;
    const cubeDims = ['AB', 'Alım Dönem Onaylı Mı', 'Alım Dönem Sezon', 'Demo Kanal', 'Demo Koleksiyon', 'Hedef PSF', 'Klasman Detay'];
    await page.route('**/api/oab-cube/metadata', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true,
      dimensions: cubeDims.map(name => ({ source: `[Data].[${name}]`, table: 'Data', name, label: name, baseKey: '' })),
      measures: [{ source: '[Measures].[PO Adet Ydisi]', table: 'Measures', name: 'PO Adet Ydisi', label: 'PO Adet Ydisi', baseKey: '' }] }) }));
    await page.waitForFunction(() => window.BLOverviewHome && document.getElementById('oabCubeSection'), null, { timeout: 60000 });
    await page.evaluate(() => window.BLOverviewHome.goToPage(1));
    await page.waitForFunction(() => window.BLOabCube, null, { timeout: 60000 });
    await page.evaluate(() => document.getElementById('oabCubeSection').scrollIntoView({ block: 'start' }));
    await page.waitForFunction(() => window.BLOabCube && window.BLOabCube.state.catalog.dimensions.length > 0, null, { timeout: 60000 });
    // İlgisiz açılış bildirimi görüntüyü kapatmasın.
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter(el => /uyarı var|warnings —/.test(el.textContent || '') && !el.children.length)[0];
      let host = hit;
      while (host && !host.querySelector('button')) host = host.parentElement;
      host?.querySelector('button')?.click();
    });
    assert.equal(await page.evaluate(() => Boolean(window.BLDataPicker)), false, 'seçici başlangıçta yüklenmez');
    await page.click('#oabCubeFieldsBtn');
    await page.waitForSelector('#_oabCubeFieldsModal #oabCubeRowsList select.oabCubeAxisField', { timeout: 10000 });
    const rowSelect = '#_oabCubeFieldsModal #oabCubeRowsList .oabConfigRow:nth-child(2) select.oabCubeAxisField';
    const before = await page.$eval(rowSelect, el => el.value);

    // Kısa liste (Toplam/Ortalama) yerel kalır.
    await page.click('#_oabCubeFieldsModal #oabCubeValuesList select.oabCubeValueAgg');
    assert.equal(await page.$('#_dmPicker'), null, 'kısa liste yerel açılır');
    await page.keyboard.press('Escape');
    assert.ok(await page.$('#_oabCubeFieldsModal'), 'yerel liste Escape ile kapanır, pencere açık kalır');

    // Uzun alan listesi aranabilir seçiciyle açılır; seçili değer işaretli.
    await page.click(rowSelect);
    await page.waitForSelector('#_dmPicker .dmfPickerSearch', { timeout: 5000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.className === 'dmfPickerSearch', null, { timeout: 5000 });
    assert.equal(await page.$eval('#_dmPicker .dmfPickerItem.isSelected', el => el.dataset.value), before);
    const groups = await page.$$eval('#_dmPicker .dmfPickerGroup', els => els.map(el => el.textContent.trim()));
    assert.deepEqual(groups, lang === 'en' ? ['Built-in fields', 'Cube fields'] : ['Hazır alanlar', 'Küp alanları'], 'grup sırası korunur');
    const query = lang === 'en' ? 'class' : 'klas';
    await page.fill('#_dmPicker .dmfPickerSearch', query);
    const matches = await page.$$eval('#_dmPicker .dmfPickerItem', els => els.map(el => el.textContent.trim()));
    assert.ok(matches.length >= 2 && matches.every(label => label.toLocaleLowerCase(lang === 'en' ? 'en' : 'tr').includes(query)), `arama süzer: ${matches}`);
    assert.ok(matches.some(label => label.endsWith('Klasman Detay')), 'küp alanı da aranır');

    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const box = await page.evaluate(() => {
      const a = document.querySelector('#_oabCubeFieldsModal .oabSettingsModal').getBoundingClientRect();
      const b = document.getElementById('_dmPicker').getBoundingClientRect();
      return { x: a.x, y: a.y, w: a.width, bottom: Math.max(b.bottom, a.y + 420) };
    });
    const name = `pivot-field-search-${theme}${lang === 'en' ? '-en' : ''}.png`;
    const screenshot = path.join(__dirname, '../public/release-notes/next-assets/' + name);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    const height = Math.min(900 - box.y, Math.max(box.bottom - box.y + 16, Math.ceil(box.w / 3)));
    await page.screenshot({ path: screenshot, clip: { x: box.x, y: box.y, width: box.w, height } });

    // Klavye: ↓ ilk eşleşmeye iner, Enter seçer; <select> değeri ve change olayı güncellenir.
    const expected = await page.$eval('#_dmPicker .dmfPickerItem', el => el.dataset.value);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('_dmPicker'), null, { timeout: 5000 });
    assert.equal(await page.$eval(rowSelect, el => el.value), expected);
    assert.ok(await page.$eval(rowSelect, el => el === document.activeElement), 'odak alana döner');

    // Escape yalnız seçiciyi kapatır; ayar penceresi açık kalır.
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForSelector('#_dmPicker', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('_dmPicker'), null, { timeout: 5000 });
    assert.ok(await page.$('#_oabCubeFieldsModal'), 'ayar penceresi açık kalır');

    // Kaydet seçilen alanı görünüme yazar (modülün kendi okuma kodu).
    await page.click('#_oabCubeFieldsModal [data-oab-cube-save]');
    await page.waitForFunction(() => !document.getElementById('_oabCubeFieldsModal'), null, { timeout: 10000 });
    const rows = await page.evaluate(() => window.BLOabCube.state.view.rows.map(ref => ref.key || ref.source));
    assert.ok(rows.includes(expected) || rows.some(key => `src:${key}` === expected), `kaydedilen satırlar: ${rows}`);
    assert.deepEqual(app.errors, []);
    console.log(JSON.stringify({ screenshot, matches, saved: rows }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
