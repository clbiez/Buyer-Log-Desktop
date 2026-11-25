'use strict';
/* Çok kullanıcılı Koleksiyon + Fiyat Masası gerçek tarayıcı kabulü (manuel; npm test
   dışı). Tek gerçek Buyer Log sunucusu (izole demo veri), 20 sentetik hesap ve her
   hesap için ayrı Playwright BrowserContext.

   Kullanıcılar: moderatör, 3 Koleksiyon sahibi, Koleksiyon "edit"/"view" izinliler,
   Fiyat Masası düzenleyicisi (editorIds), iki sahipte farklı izinli bir kullanıcı ve
   izinsizler. Doğrulananlar:
     1. Her kullanıcının Koleksiyon listesi yalnız yetkili sahipleri içerir.
     2. Model görselleri yetkili kullanıcıda doğru satırda doğru görsel (piksel rengi)
        olarak yüklenir; kırık görsel yok; izinsizde satır/görsel yok.
     3. Fiyat hücreleri (Teklif & Onay, Landed/Supp. FOB, onaylı üretici) her yetkili
        kullanıcıda sahibin ekranıyla aynı metin/biçimdedir.
     4. Fiyat Masası listesi Koleksiyon yetkisiyle paralel; giriş yalnız sahip,
        düzenleyici ve moderatörde aktif; değerler herkeste aynı; durum sekmesi
        sayıları listeyle tutarlı.
     5. Canlı güncelleme: düzenleyicinin Fiyat Masası'nda girdiği/onayladığı fiyat
        sahibin Koleksiyonunda, view izinli kullanıcının (çoklu görünüm) Koleksiyonunda
        ve başka bir kullanıcının Fiyat Masası'nda yenilemeden görünür.
     6. TR↔EN dil değişiminde başlıklar yeniden çizilir; hiçbir sayfada pageerror yok.
   Çıktı: <root>/multiuser-report.json (veya --report <yol>); hata görüntüleri <root>.

   Kullanım (resources/app içinden):
     CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/multiuser-collection-pricing-e2e.js [--parallel 4] [--report out.json] */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { startServer, createBuyer, launchBrowser, openUser, delay } = require('./lib/multiuser-app');

const args = process.argv.slice(2), arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const SCREENSHOTS = args.includes('--screenshots');
const PARALLEL = Math.max(1, Number(arg('--parallel', 4)) || 4), LIVE_LIMIT_MS = Number(arg('--live-limit-ms', 15000));
const MFRS = ['DEMO MFR A', 'DEMO MFR B', 'DEMO MFR C'];
const PRICE_KEYS = ['targetPrice', '__priceStrip__', '__landedSummary__', '__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'fob'];
const ROWS_PER_OWNER = 4;

// Hesap planı (20 kullanıcı = moderatör + 19 buyer).
const PLAN = [
  ['O1', 'owner'], ['O2', 'owner'], ['O3', 'owner'],
  ['E1a', 'edit:O1 qedit:O1'], ['E1b', 'edit:O1'], ['V1a', 'view:O1'], ['V1b', 'view:O1'], ['V1c', 'view:O1'], ['Q1', 'view:O1 qedit:O1'],
  ['X1', 'view:O1 edit:O2'], ['E2a', 'edit:O2 qedit:O2'], ['V2a', 'view:O2'], ['V2b', 'view:O2'],
  ['E3a', 'edit:O3'], ['V3a', 'view:O3'], ['N1', ''], ['N2', ''], ['N3', ''], ['N4', ''],
];
const OWNER_KEYS = ['O1', 'O2', 'O3'];
// Her satıra tek, ayırt edilebilir renk (sahip × satır); görsel doğrulaması en yakın renge göre yapılır.
const colourOf = (ownerIndex, rowIndex) => { const h = (ownerIndex * ROWS_PER_OWNER + rowIndex) * (360 / (OWNER_KEYS.length * ROWS_PER_OWNER)); return hslToRgb(h / 360, 0.85, 0.5); };
function hslToRgb(h, s, l) {
  const f = n => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const priceOf = (ownerIndex, rowIndex, mfrIndex) => (3.2 + ownerIndex * 0.37 + rowIndex * 0.11 + mfrIndex * 0.23).toFixed(2).replace('.', ',');
const norm = text => String(text || '').replace(/\s+/g, ' ').trim();

const report = { startedAt: new Date().toISOString(), users: {}, checks: [], findings: [], live: {}, errors: [] };
function check(name, ok, detail) { report.checks.push({ name, ok: Boolean(ok), detail }); if (!ok) console.error('FAIL', name, JSON.stringify(detail).slice(0, 600)); return ok; }

(async () => {
  const server = await startServer();
  const reportPath = path.resolve(arg('--report', path.join(server.root, 'multiuser-report.json')));
  const browser = await launchBrowser();
  const accounts = { M: { id: 'moderator', key: 'M', roles: '' } };
  try {
    for (const [key, roles] of PLAN) accounts[key] = { ...(await createBuyer(server, 'Demo ' + key)), key, roles };
    // İzinler: sahibin kendi oturumuyla gerçek izin API'si (Görünüm ve Yetkiler ile aynı uç).
    for (const ownerKey of OWNER_KEYS) {
      const cookie = await server.login(accounts[ownerKey].id);
      for (const account of Object.values(accounts)) {
        const level = (account.roles.match(new RegExp('(view|edit):' + ownerKey + '\\b')) || [])[1];
        if (level) await server.api('/api/collection-permissions/' + account.id, { method: 'PUT', cookie, body: { ownerId: accounts[ownerKey].id, level }, expect: 200 });
      }
    }
    const expectedOwners = account => new Set([account.id, ...OWNER_KEYS.filter(k => new RegExp('(view|edit):' + k + '\\b').test(account.roles)).map(k => accounts[k].id)]);
    const quotationEditable = (account, ownerKey) => account.key === 'M' || account.key === ownerKey || new RegExp('qedit:' + ownerKey + '\\b').test(account.roles);
    const expectedRequests = account => OWNER_KEYS.filter(k => account.key === 'M' || account.key === k || new RegExp('(view|edit|qedit):' + k + '\\b').test(account.roles));
    for (const account of Object.values(accounts)) report.users[account.key] = { id: account.id, roles: account.roles || (account.key === 'M' ? 'moderator' : 'owner'), expectedCollectionOwners: [...expectedOwners(account)].length, expectedRequests: expectedRequests(account) };

    /* ---------- 1. Sahipler: satır + görsel + Fiyat Masası talebi + fiyat/onay (gerçek UI) ---------- */
    const golden = {}, requestOwner = {};
    for (const [ownerIndex, ownerKey] of OWNER_KEYS.entries()) {
      const owner = accounts[ownerKey], session = await openUser(browser, server, owner);
      try {
        const { page } = session;
        await page.evaluate(() => switchTab('koleksiyon'));
        await page.waitForFunction(() => typeof kolRows !== 'undefined' && kolWorkspaceOwnerId && kolWorkspaceCanEdit && !kolWorkspaceSaving, null, { timeout: 90000 });
        await page.evaluate(async ({ ownerKey, ownerIndex, rowsPer, colours }) => {
          const rows = Array.from({ length: rowsPer }, (_, i) => ({ id: i + 1, plmId: `DEMO-${ownerKey}-${i + 1}`, modelKod: `DM-${ownerKey}-${i + 1}`, colour: 'NAVY', colourCode: `C${ownerIndex}${i}`, lisans: 'DEMO LICENSE', licensor: 'DEMO LICENSOR', urunTipi: 'Sweat', season: 'SS27', quantity: String(1000 + i * 100), targetPrice: '4,50', country: 'China' }));
          kolRows = kolNormalizeModelGroups(rows); saveKolRows();
          const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96; const g = canvas.getContext('2d');
          for (const [i, row] of kolRows.entries()) { const [r, gr, b] = colours[i]; g.fillStyle = `rgb(${r},${gr},${b})`; g.fillRect(0, 0, 96, 96); await kolPersistImageData(row, canvas.toDataURL('image/png'), `demo-${ownerKey}-${row.id}.png`); }
          saveKolRows(); await kolSaveWorkspaceNow();
        }, { ownerKey, ownerIndex, rowsPer: ROWS_PER_OWNER, colours: Array.from({ length: ROWS_PER_OWNER }, (_, i) => colourOf(ownerIndex, i)) });
        const editorIds = Object.values(accounts).filter(a => new RegExp('qedit:' + ownerKey + '\\b').test(a.roles)).map(a => a.id);
        // Send to Pricing'in oluşturduğu kayıtla aynı biçim (kol:<rowId>), fiyatsız.
        const requestId = await page.evaluate(async ({ mfrs, editorIds }) => {
          // picture: Send to Pricing ile aynı kaynak (qCollectionImageSrc → desk.imageSrc).
          const picture = row => String(window.BL_QUOTATIONS?.desk?.imageSrc?.(row, null) || row.img || '');
          const items = kolRows.flatMap(row => mfrs.map((m, mi) => ({ id: `line-${row.id}-${mi}`, modelKey: 'kol:' + row.id, rowId: row.id, plmId: row.plmId, modelCode: row.modelKod, colour: row.colour, colourCode: row.colourCode, license: row.lisans, category: row.urunTipi, season: row.season, picture: picture(row), quantity: Number(row.quantity), targetPrice: row.targetPrice, manufacturer: m, price: '', approved: false, dropped: false })));
          const r = await fetch('/api/quotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'collection', status: 'active', manufacturers: mfrs.map(name => ({ name, email: '' })), items }) });
          const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify(data));
          if (editorIds.length) { const e = await fetch('/api/quotations/' + encodeURIComponent(data.request.id) + '/editors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editorIds }) }); if (!e.ok) throw new Error('editors ' + e.status); }
          return data.request.id;
        }, { mfrs: MFRS, editorIds });
        requestOwner[requestId] = ownerKey;
        // Talep açıldıktan sonra sahip bir modelin hedef fiyatını Koleksiyon'da değiştirir:
        // Fiyat Masası "Hedef/Δ Hedef" herkeste bu güncel değeri göstermelidir.
        await page.evaluate(async () => { kolApplyCollectionCellChange({ rowId: 2, key: 'targetPrice', value: '3,95' }); await kolSaveWorkspaceNow(); });
        // Fiyatlar ve onay Fiyat Masası matrisinden yazılır (gerçek giriş + Enter, onay düğmesi).
        await openDesk(page);
        await page.evaluate(() => window.BLPricingDesk.setScope({ all: true }));
        await page.click(`#quotationNav [data-quotation-id="${requestId}"]`);
        await page.waitForSelector('.pdMatrix .pdCellInput', { timeout: 60000 });
        for (let r = 0; r < ROWS_PER_OWNER; r++) for (let m = 0; m < MFRS.length; m++) {
          if (r === ROWS_PER_OWNER - 1 && m > 0) continue; // son satırda tek teklif: farklı strip biçimi
          if (r === 2) continue; // bir satır teklifsiz kalır ("Teklif yok" biçimi)
          const input = page.locator(`.pdCellInput[data-pd-input="line-${r + 1}-${m}"]`);
          await input.fill(priceOf(ownerIndex, r, m)); await input.press('Enter');
        }
        await page.waitForTimeout(800);
        // Onay düğmesi hücre üzerine gelince açılır; aynı click işleyicisi tetiklenir.
        await page.locator('[data-pd-approve="line-1-1"]').dispatchEvent('click'); // satır 1: en ucuz olmayan üretici onaylı
        await page.waitForFunction(() => document.querySelector('[data-pd-approve="line-1-1"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
        await page.waitForTimeout(1500);
        golden[ownerKey] = { requestId, desk: await readDesk(page) };
        check(`${ownerKey}: sahibin masasında güncel hedef`, golden[ownerKey].desk.rows['kol:2']?.target === '$3,95', golden[ownerKey].desk.rows);
        await page.evaluate(() => switchTab('koleksiyon'));
        await page.waitForFunction(n => document.querySelectorAll('#kolTable tbody tr td[data-key="modelKod"]').length >= n, ROWS_PER_OWNER, { timeout: 60000 });
        // Fiyat Masası girişleri sahibin Koleksiyonuna yazılana dek beklenir (onaylı satır 1, fiyatlı satır 2 ve 4).
        await page.waitForFunction(({ mfr, ownerKey }) => kolRows.find(r => r.modelKod === `DM-${ownerKey}-1`)?.confirmedManufacturer === mfr && ['2', '4'].every(i => Object.keys(kolRows.find(r => r.modelKod === `DM-${ownerKey}-${i}`)?.pricing || {}).length) && !kolWorkspaceSaving, { mfr: MFRS[1], ownerKey }, { timeout: 60000 });
        await page.evaluate(() => renderKol());
        await page.waitForTimeout(1000);
        golden[ownerKey].collection = await readCollectionRows(page, ownerKey);
        golden[ownerKey].saved = await page.evaluate(() => kolRows.map(r => ({ id: r.id, pricing: r.pricing, confirmed: r.confirmedManufacturer, img: r.img })));
        check(`${ownerKey}: sahip ekranında ${ROWS_PER_OWNER} satır`, Object.keys(golden[ownerKey].collection).length === ROWS_PER_OWNER, Object.keys(golden[ownerKey].collection));
        check(`${ownerKey}: onaylı üretici Koleksiyon'a yazıldı`, golden[ownerKey].saved[0].confirmed === MFRS[1], golden[ownerKey].saved[0]);
        check(`${ownerKey}: pageerror yok`, session.errors.length === 0, session.errors);
      } finally { await session.close(); }
    }
    report.golden = golden;

    /* ---------- 2. Her kullanıcı: Koleksiyon + görsel + fiyat + Fiyat Masası + dil ---------- */
    const keys = Object.keys(accounts);
    for (let i = 0; i < keys.length; i += PARALLEL) {
      await Promise.all(keys.slice(i, i + PARALLEL).map(key => verifyUser(accounts[key]).catch(error => { check(`${key}: doğrulama tamamlandı`, false, String(error && error.stack || error)); })));
    }

    async function verifyUser(account) {
      const started = Date.now(), session = await openUser(browser, server, account), { page } = session, u = report.users[account.key];
      try {
        // Koleksiyon listesi
        await page.evaluate(() => switchTab('koleksiyon'));
        await page.waitForFunction(() => typeof kolWorkspaceList !== 'undefined' && kolWorkspaceList.length > 0 && document.querySelector('#kolScopeFilters [data-owner-id]'), null, { timeout: 90000 });
        const list = await page.evaluate(() => kolWorkspaceList.map(item => ({ ownerId: item.ownerId, level: item.level })));
        const expected = expectedOwners(account);
        u.collectionOwners = list;
        if (account.key === 'M') {
          // Moderatörün Koleksiyon kapsamı rol/izin çözücüsünden gelir; yalnız gözlenir ve en az kendi sayfası beklenir.
          check('M: Koleksiyon listesi kendi sayfasını içerir', list.some(item => item.ownerId === account.id), list);
        } else {
          check(`${account.key}: Koleksiyon listesi yalnız yetkili sahipler`, list.length === expected.size && list.every(item => expected.has(item.ownerId)), { list, expected: [...expected] });
          for (const ownerKey of OWNER_KEYS) {
            const level = (account.roles.match(new RegExp('(view|edit):' + ownerKey + '\\b')) || [])[1] || (account.key === ownerKey ? 'edit' : null);
            if (level) check(`${account.key}: ${ownerKey} izin düzeyi ${level}`, list.find(item => item.ownerId === accounts[ownerKey].id)?.level === level, list);
          }
        }
        const visibleOwnerKeys = OWNER_KEYS.filter(k => list.some(item => item.ownerId === accounts[k].id));
        // İzinsiz sahiplerin verisi sunucudan da gelmez (yetkisiz kullanıcıya satır/görsel yok).
        for (const ownerKey of OWNER_KEYS.filter(k => !visibleOwnerKeys.includes(k))) {
          const status = await page.evaluate(async id => (await fetch('/api/collection-workspaces/' + encodeURIComponent(id))).status, accounts[ownerKey].id);
          check(`${account.key}: ${ownerKey} Koleksiyonu reddedilir`, status === 403, { status });
        }
        // Yetkili başka sahipler "Görünüm ve Yetkiler" panelinden seçilir (gerçek UI); sahip kendi sayfasını görür.
        const foreign = visibleOwnerKeys.filter(k => k !== account.key);
        if (foreign.length) {
          for (const ownerKey of foreign) await selectCollectionOwner(page, accounts[ownerKey].id);
          await page.mouse.click(900, 700);
          const ownRows = account.key in golden ? ROWS_PER_OWNER : 0;
          await page.waitForFunction(n => kolRows.length === n, ownRows + foreign.length * ROWS_PER_OWNER, { timeout: 60000 });
          u.collectionMode = await page.evaluate(() => ({ mode: kolWorkspaceMode, canEdit: kolWorkspaceCanEdit }));
          check(`${account.key}: çoklu görünüm salt okunur`, u.collectionMode.mode === 'multi' && u.collectionMode.canEdit === false, u.collectionMode);
        }
        await page.waitForTimeout(800);
        const shown = await readCollectionRows(page);
        const shownOwners = new Set(Object.keys(shown).map(model => model.split('-')[1]));
        check(`${account.key}: ekranda yalnız yetkili sahiplerin modelleri`, [...shownOwners].every(k => visibleOwnerKeys.includes(k)) && visibleOwnerKeys.every(k => shownOwners.has(k)), { shown: [...shownOwners], visibleOwnerKeys });
        for (const ownerKey of visibleOwnerKeys) {
          const ownerIndex = OWNER_KEYS.indexOf(ownerKey);
          for (let r = 0; r < ROWS_PER_OWNER; r++) {
            const model = `DM-${ownerKey}-${r + 1}`, row = shown[model], ref = golden[ownerKey].collection[model];
            if (!check(`${account.key}: ${model} satırı görünür`, Boolean(row), Object.keys(shown))) continue;
            check(`${account.key}: ${model} görseli yüklendi`, row.image && row.image.loaded, row.image);
            check(`${account.key}: ${model} doğru görsel`, row.image && row.image.nearest === ownerIndex * ROWS_PER_OWNER + r, { got: row.image, expectedIndex: ownerIndex * ROWS_PER_OWNER + r });
            for (const key of Object.keys(ref.prices)) check(`${account.key}: ${model} ${key} sahiple aynı`, row.prices[key] === ref.prices[key], { got: row.prices[key], owner: ref.prices[key] });
          }
        }
        check(`${account.key}: kırık görsel isteği yok`, session.failedImages.length === 0, session.failedImages);

        // Fiyat Masası
        await openDesk(page);
        await page.waitForTimeout(800);
        u.deskDefault = await readStatus(page);
        check(`${account.key}: durum sekmesi sayısı listeyle tutarlı (varsayılan kapsam)`, u.deskDefault.activeCount === u.deskDefault.listCount, u.deskDefault);
        await page.click('[data-pd-scope]');
        await page.check('[data-pd-scope-all]');
        await page.click('[data-pd-scope-apply]');
        await page.waitForTimeout(800);
        u.deskAll = await readStatus(page);
        check(`${account.key}: durum sekmesi sayısı listeyle tutarlı (tüm buyer'lar)`, u.deskAll.activeCount === u.deskAll.listCount, u.deskAll);
        const expectedReq = expectedRequests(account).map(k => golden[k].requestId).sort();
        check(`${account.key}: Fiyat Masası listesi Koleksiyon yetkisiyle paralel`, JSON.stringify([...u.deskAll.ids].sort()) === JSON.stringify(expectedReq), { got: u.deskAll.ids, expected: expectedReq });
        for (const requestId of u.deskAll.ids.filter(id => requestOwner[id])) {
          const ownerKey = requestOwner[requestId];
          await page.click(`#quotationNav [data-quotation-id="${requestId}"]`);
          await page.waitForSelector('.pdMatrix .pdCellInput', { timeout: 60000 });
          await page.waitForTimeout(300);
          const desk = await readDesk(page), ref = golden[ownerKey].desk, editable = quotationEditable(account, ownerKey);
          check(`${account.key}: ${ownerKey} talep değerleri sahiple aynı`, JSON.stringify(desk.values) === JSON.stringify(ref.values), { got: desk.values, owner: ref.values });
          const collectionAccess = list.some(item => item.ownerId === accounts[ownerKey].id);
          if (!collectionAccess) {
            // Koleksiyon izni olmayan (ör. yalnız rolüyle talebi gören moderatör) sahibin satırlarını okuyamaz:
            // Hedef talep anındaki kopyadır. Ürün/yetki kuralı olarak raporlanır.
            const stale = Object.entries(desk.rows).filter(([k, v]) => v.target !== ref.rows[k]?.target).map(([k, v]) => ({ line: k, shown: v.target, owner: ref.rows[k]?.target }));
            if (stale.length && !report.findings.some(f => f.id === 'quotation-target-without-collection-access')) report.findings.push({ id: 'quotation-target-without-collection-access', evidence: { user: account.key, ownerKey, stale },
              note: 'Talebi Koleksiyon izni olmadan gören kullanıcı (moderatör rolüyle tüm talepleri düzenleyebilir) sahibin Koleksiyon satırını okuyamaz (/api/collection-workspaces-batch 403); Hedef/Δ Hedef talep oluşturulurken kopyalanan değerdir ve sahip hedefi sonradan değiştirdiyse farklı görünür. Moderatörün Koleksiyon erişim kuralı A işçisinin alanı.' });
          } else check(`${account.key}: ${ownerKey} Hedef/En iyi/Δ Hedef sahiple aynı`, JSON.stringify(Object.entries(desk.rows).map(([k, v]) => [k, v.target, v.best, v.delta])) === JSON.stringify(Object.entries(ref.rows).map(([k, v]) => [k, v.target, v.best, v.delta])), { got: desk.rows, owner: ref.rows });
          check(`${account.key}: ${ownerKey} Fiyat Masası görselleri doğru`, Object.entries(desk.rows).every(([model, v]) => v.thumb === OWNER_KEYS.indexOf(ownerKey) * ROWS_PER_OWNER + Number(model.split(':')[1]) - 1), desk.rows);
          check(`${account.key}: ${ownerKey} onay/drop düğmeleri fiyatın üstünde görünmez`, desk.visibleActions === 0, { visibleActions: desk.visibleActions });
          check(`${account.key}: ${ownerKey} onay durumu sahiple aynı`, JSON.stringify(desk.approved) === JSON.stringify(ref.approved), { got: desk.approved, owner: ref.approved });
          check(`${account.key}: ${ownerKey} fiyat girişleri ${editable ? 'aktif' : 'devre dışı'}`, desk.inputs > 0 && (editable ? desk.disabled === 0 : desk.disabled === desk.inputs), { editable, desk: { inputs: desk.inputs, disabled: desk.disabled } });
          if (!editable) {
            const readonlyBadge = await page.locator(`#quotationNav [data-quotation-id="${requestId}"].quotationViewOnly`).count();
            check(`${account.key}: ${ownerKey} listede "Yalnız görüntüleme"`, readonlyBadge === 1, { readonlyBadge });
          }
        }
        // Dil: TR → EN → TR; Fiyat Masası ve Koleksiyon başlıkları aktif dilde yeniden çizilir.
        const deskTr = await page.locator('[data-pd-tab="desk"]').innerText();
        await page.evaluate(() => document.getElementById('railLangBtn').click());
        await page.waitForTimeout(500);
        const deskEn = await page.locator('[data-pd-tab="desk"]').innerText(), statusEn = await page.locator('[data-quotation-status-filter="active"] span').first().innerText();
        await page.evaluate(() => switchTab('koleksiyon'));
        await page.waitForTimeout(800);
        const kolEn = await page.evaluate(() => norm(document.querySelector('#kolTable thead')?.textContent || ''));
        await page.evaluate(() => document.getElementById('railLangBtn').click());
        await page.waitForTimeout(500);
        const kolTr = await page.evaluate(() => norm(document.querySelector('#kolTable thead')?.textContent || ''));
        u.language = { deskTr, deskEn, statusEn, kolEnHasQuotes: /Quotes & Approval/.test(kolEn), kolTrHasTeklif: /Teklif & Onay/.test(kolTr) };
        check(`${account.key}: dil değişiminde Fiyat Masası yeniden çizilir`, norm(deskTr) === 'Masa' && norm(deskEn) === 'Desk' && norm(statusEn).toLowerCase() === 'in progress', u.language);
        check(`${account.key}: dil değişiminde Koleksiyon başlıkları yeniden çizilir`, (u.language.kolEnHasQuotes && u.language.kolTrHasTeklif) || (!kolEn && !kolTr), u.language);
        check(`${account.key}: pageerror yok`, session.errors.length === 0, session.errors);
        u.consoleErrors = session.consoleErrors.slice(0, 10);
        u.ms = Date.now() - started;
      } catch (error) {
        await page.screenshot({ path: path.join(server.root, `fail-${account.key}.png`) }).catch(() => {});
        throw error;
      } finally { await session.close(); }
    }

    /* ---------- Gözlemler (ürün kuralı; başarısızlık sayılmaz) ---------- */
    {
      const editGrantees = Object.values(accounts).filter(a => /\bedit:O\d/.test(a.roles));
      report.findings.push({ id: 'collection-edit-grant-readonly-in-ui', evidence: editGrantees.map(a => ({ user: a.key, roles: a.roles, mode: report.users[a.key].collectionMode })),
        note: 'Koleksiyon "edit" izni olan kullanıcı başka sahibin Koleksiyonunu UI\'da yalnız salt okunur çoklu görünümde açabiliyor ("Kendi kayıtlarınız her zaman görünür"; kendi onay kutusu devre dışı). Tek-sahip düzenleme moduna UI yolu yok; yalnız eski localStorage kapsam tercihiyle açılıyor.' });
      report.findings.push({ id: 'quotation-edit-separate-from-collection-edit', evidence: ['E1b', 'E3a'].map(k => ({ user: k, roles: accounts[k].roles })),
        note: 'Fiyat Masası düzenleme yetkisi Koleksiyon "edit" izninden değil talebin editorIds listesinden gelir; Koleksiyon edit izinli kullanıcı talep sahibi düzenleyici eklemedikçe girişleri devre dışı görür (sunucu quotations-store.canEdit ile aynı).' });
      const probe = await server.login(accounts.N1.id), img = golden.O1.saved[0].img;
      const direct = img ? await server.api(img, { cookie: probe }) : { status: null };
      report.findings.push({ id: 'collection-image-direct-url-unauthorized', evidence: { user: 'N1', url: img, status: direct.status },
        note: direct.status === 200 ? 'İzinsiz kullanıcı, ref bilinirse sahibin Koleksiyon görselini doğrudan URL ile alabiliyor (görsel modül kaynağı; collection-image-authority yalnız "collection-shared:" replikalarını denetler). UI\'da görünmez; ref tahmin edilemez (zaman + rastgele). Sunucu erişim paritesi işçisine (A) bildirildi.' : 'İzinsiz doğrudan görsel isteği reddedildi.' });
    }

    /* ---------- 3. Canlı güncelleme: E1a (düzenleyici) O1 talebinde fiyat girer ve onaylar ---------- */
    {
      const O1 = accounts.O1, sessions = {};
      try {
        for (const key of ['O1', 'V1a', 'E1b', 'E1a']) sessions[key] = await openUser(browser, server, accounts[key]);
        const { page: ownerPage } = sessions.O1;
        await ownerPage.evaluate(() => switchTab('koleksiyon'));
        await ownerPage.waitForFunction(n => document.querySelectorAll('#kolTable tbody td[data-key="modelKod"]').length >= n, ROWS_PER_OWNER, { timeout: 90000 });
        const viewer = sessions.V1a.page;
        await viewer.evaluate(() => switchTab('koleksiyon'));
        await viewer.waitForFunction(() => document.querySelector('#kolScopeFilters [data-owner-id]'), null, { timeout: 90000 });
        await selectCollectionOwner(viewer, O1.id);
        await viewer.waitForFunction(n => kolWorkspaceMode === 'multi' && kolRows.length === n, ROWS_PER_OWNER, { timeout: 60000 });
        await viewer.mouse.click(900, 700);
        const observer = sessions.E1b.page, editor = sessions.E1a.page, requestId = golden.O1.requestId;
        for (const page of [observer, editor]) {
          await openDesk(page);
          await page.evaluate(() => window.BLPricingDesk.setScope({ all: true }));
          await page.click(`#quotationNav [data-quotation-id="${requestId}"]`);
          await page.waitForSelector('.pdMatrix .pdCellInput', { timeout: 60000 });
        }
        check('canlı: E1b (Koleksiyon edit, talep düzenleyicisi değil) girişleri devre dışı', await observer.locator('.pdCellInput:not([disabled])').count() === 0, null);
        // Satır 3 teklifsizdi: düzenleyici üretici C'ye fiyat girer ve onaylar.
        const livePrice = '2,87', line = 'line-3-2', model = 'DM-O1-3';
        const t0 = Date.now();
        const input = editor.locator(`.pdCellInput[data-pd-input="${line}"]`);
        await input.fill(livePrice); await input.press('Enter');
        await editor.waitForTimeout(300);
        await editor.locator(`[data-pd-approve="${line}"]`).dispatchEvent('click');
        const contains = (page, text) => page.waitForFunction(({ model, text }) => [...document.querySelectorAll('#kolTable tbody tr')].some(tr => tr.querySelector('td[data-key="modelKod"]')?.textContent.includes(model) && tr.querySelector('td[data-key="__priceStrip__"]')?.textContent.replace(/\s+/g, ' ').includes(text)), { model, text }, { timeout: LIVE_LIMIT_MS * 2 }).then(() => Date.now() - t0).catch(() => null);
        const deskShows = page => page.waitForFunction(({ line, price }) => { const el = document.querySelector(`.pdCellInput[data-pd-input="${line}"]`); return el && el.value === price && document.querySelector(`[data-pd-approve="${line}"]`)?.getAttribute('aria-pressed') === 'true'; }, { line, price: livePrice }, { timeout: LIVE_LIMIT_MS * 2 }).then(() => Date.now() - t0).catch(() => null);
        const [ownerMs, viewerMs, observerMs] = await Promise.all([contains(ownerPage, '$' + livePrice), contains(viewer, '$' + livePrice), deskShows(observer)]);
        report.live = { price: livePrice, model, ownerCollectionMs: ownerMs, viewerCollectionMs: viewerMs, observerDeskMs: observerMs, limitMs: LIVE_LIMIT_MS };
        check('canlı: sahibin Koleksiyonu yenilemeden günceller', ownerMs != null && ownerMs <= LIVE_LIMIT_MS, report.live);
        check('canlı: view izinli kullanıcının Koleksiyonu (çoklu görünüm) yenilemeden günceller', viewerMs != null && viewerMs <= LIVE_LIMIT_MS, report.live);
        check('canlı: diğer kullanıcının Fiyat Masası yenilemeden günceller', observerMs != null && observerMs <= LIVE_LIMIT_MS, report.live);
        const ownerSaved = await ownerPage.evaluate(m => kolRows.find(r => r.modelKod === m)?.confirmedManufacturer, model);
        check('canlı: onaylı üretici sahibin Koleksiyonuna yazıldı', ownerSaved === MFRS[2], { ownerSaved });
        // Sahip ve görüntüleyenin satır metni aynı biçimde olmalı.
        const [ownerRow, viewerRow] = [await readCollectionRows(ownerPage), await readCollectionRows(viewer)];
        check('canlı: sahip ve görüntüleyen aynı fiyat hücresini görür', ownerRow[model]?.prices.__priceStrip__ === viewerRow[model]?.prices.__priceStrip__, { owner: ownerRow[model]?.prices, viewer: viewerRow[model]?.prices });
        for (const [key, s] of Object.entries(sessions)) check(`canlı: ${key} pageerror yok`, s.errors.length === 0, s.errors);
        await Promise.all(Object.values(sessions).map(s => s.page.screenshot({ path: path.join(server.root, `live-${s.account.key}.png`) }).catch(() => {})));
        if (SCREENSHOTS) await releaseScreenshots({ viewer, observer, model });
      } finally { await Promise.all(Object.values(sessions).map(s => s.close())); }
    }
  } catch (error) {
    report.errors.push(String(error && error.stack || error));
  } finally {
    await browser.close().catch(() => {});
    await server.close();
    const failed = report.checks.filter(c => !c.ok);
    report.finishedAt = new Date().toISOString();
    report.summary = { users: Object.keys(report.users).length, checks: report.checks.length, failed: failed.length, errors: report.errors.length, root: server.root };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ report: reportPath, ...report.summary, live: report.live, failed: failed.slice(0, 20).map(c => c.name) }, null, 1));
    if (failed.length || report.errors.length) { if (report.errors.length) console.error(report.errors.join('\n')); process.exitCode = 1; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

/* ---------- Sürüm notu görselleri (--screenshots; demo veri, gerçek hesap adı yok) ---------- */
async function releaseScreenshots({ viewer, observer, model }) {
  const dir = path.join(__dirname, '../public/release-notes/next-assets');
  fs.mkdirSync(dir, { recursive: true });
  const scrub = page => page.evaluate(() => {
    document.activeElement?.blur?.(); document.querySelectorAll('[data-ui-feedback],.toast,.blToast').forEach(el => el.remove());
    // Moderatör/yönetici adı gerçek kişi adı olabilir: demo veride olmayan her ad "Demo Buyer" olur.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), names = new Set((window.kolWorkspaceList || []).map(w => w.supervisorName).filter(Boolean));
    for (let node = walker.nextNode(); node; node = walker.nextNode()) for (const name of names) if (!/^Demo /.test(name) && node.nodeValue.includes(name)) node.nodeValue = node.nodeValue.split(name).join('Demo Buyer');
  });
  // Koleksiyon: view izinli kullanıcının çoklu görünümü, canlı gelen onay ve fiyatla.
  await viewer.evaluate(() => {
    const keep = new Set(['modelKod', 'colourCode', 'colour', 'quantity', 'targetPrice', '__bestPrice__', '__confirmedName__', '__confirmedPrice__', 'durum']);
    kolHiddenCols = new Set([...kolAllOrderedCols().map(c => c.k), ...KOL_SYNTHETIC_COL_KEYS].filter(k => !keep.has(k))); renderKol();
  });
  await viewer.waitForTimeout(1200); await scrub(viewer); await viewer.mouse.move(5, 5); await viewer.waitForTimeout(300);
  // Üst başlık ("Görünüm ve Yetkiler" kapsam rozeti) dahil; en-boy oranı sürüm notu sınırında (≤3,2) kalır.
  const kol = await viewer.locator('#view-koleksiyon').boundingBox(), table = await viewer.locator('#kolTable').boundingBox();
  const kolWidth = Math.min(1600 - Math.round(kol.x), Math.round(kol.width)), kolHeight = Math.min(620, Math.max(Math.ceil(kolWidth / 3), Math.round(table.y + table.height + 14)));
  await viewer.screenshot({ path: path.join(dir, 'collection-multi-view-live-update.png'), clip: { x: Math.round(kol.x), y: 0, width: kolWidth, height: kolHeight } });
  // Fiyat Masası: başka kullanıcının girdiği fiyat ve onay açık matriste, durum sayısı listeyle aynı.
  await scrub(observer); await observer.mouse.move(5, 5); await observer.waitForTimeout(300);
  const desk = await observer.locator('#quotationWorkspacePage').boundingBox();
  await observer.screenshot({ path: path.join(dir, 'pricing-desk-live-refresh.png'), clip: { x: Math.round(desk.x), y: Math.round(desk.y), width: Math.min(1600 - Math.round(desk.x), Math.round(desk.width)), height: 520 } });
}

/* ---------- Görünüm ve Yetkiler: yetkili başka sahibi seç (gerçek onay kutusu) ---------- */
async function selectCollectionOwner(page, ownerId) {
  const box = `#kolScopeFilters [data-owner-id="${ownerId}"]`;
  for (let attempt = 0; attempt < 8; attempt++) {
    // Panel izin/yükleme sonrası yeniden çizilebilir; açık değilse yeniden açılır.
    await page.evaluate(() => { const d = document.querySelector('#kolScopeFilters .kolScopeWorkspace'); if (d) d.open = true; });
    try { await page.locator(box).check({ timeout: 4000 }); } catch (_) { await page.waitForTimeout(500); continue; }
    try { await page.waitForFunction(id => kolWorkspaceSelectedOwnerIds.has(id) && !kolWorkspaceSaving, ownerId, { timeout: 30000 }); return; } catch (_) {}
  }
  throw new Error('Koleksiyon sahibi seçilemedi: ' + ownerId);
}
async function openDesk(page) {
  await page.evaluate(() => switchTab('quotations'));
  await page.waitForFunction(() => window.BLPricingDesk && document.querySelector('#quotationNav'), null, { timeout: 90000 });
}

/* ---------- DOM okuyucular (tarayıcı içinde) ---------- */
async function readCollectionRows(page) {
  // Görseller tembel yüklenir: her satır görünür alana getirilir, görsel beklenir ve merkez pikseli okunur.
  const palette = Array.from({ length: OWNER_KEYS.length * ROWS_PER_OWNER }, (_, i) => colourOf(Math.floor(i / ROWS_PER_OWNER), i % ROWS_PER_OWNER));
  await page.evaluate(() => { window.norm = text => String(text || '').replace(/\s+/g, ' ').trim(); });
  const count = await page.locator('#kolTable tbody tr td[data-key="modelKod"]').count();
  for (let i = 0; i < count; i++) {
    const img = page.locator('#kolTable tbody tr').filter({ has: page.locator('td[data-key="modelKod"]') }).nth(i).locator('img.kolThumb');
    if (await img.count()) {
      await img.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForFunction(el => !el || el.dataset.hasImage !== '1' || (el.complete && el.naturalWidth > 0 && !/^data:image\/svg/.test(el.currentSrc || el.src)), await img.elementHandle(), { timeout: 20000 }).catch(() => {});
    }
  }
  return page.evaluate(({ keys, palette }) => {
    const out = {};
    for (const tr of document.querySelectorAll('#kolTable tbody tr')) {
      const model = norm(tr.querySelector('td[data-key="modelKod"]')?.textContent); if (!model) continue;
      const prices = {}; for (const key of keys) { const td = tr.querySelector(`td[data-key="${key}"]`); if (td) prices[key] = norm(td.textContent); }
      const img = tr.querySelector('img.kolThumb'); let image = null;
      if (img) {
        const loaded = img.complete && img.naturalWidth > 0 && !/^data:image\/svg/.test(img.currentSrc || img.src);
        image = { loaded, hasImage: img.dataset.hasImage, src: String(img.currentSrc || img.src).slice(0, 60) };
        if (loaded) {
          try {
            const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
            const [r, gr, b] = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
            let best = -1, dist = Infinity; palette.forEach(([pr, pg, pb], index) => { const d = (pr - r) ** 2 + (pg - gr) ** 2 + (pb - b) ** 2; if (d < dist) { dist = d; best = index; } });
            Object.assign(image, { rgb: [r, gr, b], nearest: best, distance: Math.round(Math.sqrt(dist)) });
          } catch (error) { image.error = String(error.message || error); }
        }
      }
      out[model] = { prices, image };
    }
    return out;
  }, { keys: PRICE_KEYS, palette });
}
async function readDesk(page) {
  const palette = Array.from({ length: OWNER_KEYS.length * ROWS_PER_OWNER }, (_, i) => colourOf(Math.floor(i / ROWS_PER_OWNER), i % ROWS_PER_OWNER));
  await page.mouse.move(2, 2);
  // Model görselleri tembel yüklenir: her satır görünür alana getirilip beklenir.
  const rowCount = await page.locator('.pdMatrix tbody tr[data-pd-model]').count();
  for (let i = 0; i < rowCount; i++) {
    const img = page.locator('.pdMatrix tbody tr[data-pd-model]').nth(i).locator('img').first();
    if (!(await img.count())) continue;
    await img.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForFunction(el => el.complete && el.naturalWidth > 0 && !/^data:image\/svg/.test(el.currentSrc || el.src), await img.elementHandle(), { timeout: 15000 }).catch(() => {});
  }
  return page.evaluate(palette => {
    const inputs = [...document.querySelectorAll('.pdMatrix .pdCellInput')];
    const n = text => String(text || '').replace(/\s+/g, ' ').trim();
    const rows = Object.fromEntries([...document.querySelectorAll('.pdMatrix tbody tr[data-pd-model]')].map(tr => {
      const img = tr.querySelector('img'); let nearest = null;
      if (img && img.complete && img.naturalWidth > 0 && !/^data:image\/svg/.test(img.currentSrc || img.src)) {
        try {
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const [r, gr, b] = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
          let dist = Infinity; palette.forEach(([pr, pg, pb], index) => { const d = (pr - r) ** 2 + (pg - gr) ** 2 + (pb - b) ** 2; if (d < dist) { dist = d; nearest = index; } });
        } catch (_) {}
      }
      return [tr.dataset.pdModel, { target: n(tr.querySelector('.pdTarget')?.textContent), best: n(tr.querySelector('.pdStickyBest')?.textContent), delta: n(tr.querySelector('.pdStickyDelta')?.textContent), thumb: nearest }];
    }));
    // Hücre üzerine gelinmeden onay/drop düğmeleri görünmez (fiyatın üstüne binmez).
    const visibleActions = [...document.querySelectorAll('.pdMatrix .pdCell .pdApprove,.pdMatrix .pdCell .pdDrop')].filter(button => getComputedStyle(button).opacity !== '0').length;
    return {
      rows, visibleActions,
      inputs: inputs.length, disabled: inputs.filter(input => input.disabled).length,
      values: Object.fromEntries(inputs.map(input => [input.dataset.pdInput, input.value]).sort()),
      approved: Object.fromEntries([...document.querySelectorAll('.pdMatrix [data-pd-approve]')].map(button => [button.dataset.pdApprove, button.getAttribute('aria-pressed')]).sort()),
    };
  }, palette);
}
async function readStatus(page) {
  return page.evaluate(() => ({
    activeCount: Number(document.querySelector('[data-quotation-status-filter="active"] [data-status-count]')?.textContent || NaN),
    listCount: document.querySelectorAll('#quotationNav .quotationNavItem').length,
    ids: [...document.querySelectorAll('#quotationNav .quotationNavItem')].map(item => item.dataset.quotationId),
    countLabel: document.getElementById('quotationCount')?.textContent || '',
  }));
}
