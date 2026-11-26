'use strict';
// Gerçek Buyer Log (anonim demo veri): Koleksiyon › Sunum Oluştur → Presentation Studio.
// Seçili modeller, otomatik yerleşim, serbest sürükleme/boyutlandırma, sabitleme,
// gruba taşıma, sayfa ölçüsü/yön değişimi ve şablon akışını doğrular; Koleksiyon
// verisinin değişmediğini kontrol eder; PDF ve PPTX dosyalarını üretip --out
// klasörüne yazar (görsel karşılaştırma için). Demo modeller bellekte çizilir, kaydedilmez.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { start } = require('./lib/client-performance-app');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('--out', path.join(require('node:os').tmpdir(), 'presentation-studio-acceptance')));
const THEME = process.argv.includes('--dark') ? 'dark' : 'light';
fs.mkdirSync(OUT, { recursive: true });

// Anonim, tarayıcıda çizilen triko siluetleri (PNG; gerçek ürün görseli değildir).
function demoImages() {
  const shapes = {
    sweater: 'M96 54 Q120 70 144 54 L172 62 Q194 70 201 94 L224 222 L198 232 L177 132 L178 256 L62 256 L63 132 L42 232 L16 222 L39 94 Q46 70 68 62 Z',
    cardigan: 'M96 54 L120 118 L144 54 L172 62 Q194 70 201 94 L224 222 L198 232 L177 132 L178 256 L62 256 L63 132 L42 232 L16 222 L39 94 Q46 70 68 62 Z',
    vest: 'M92 52 L120 112 L148 52 L170 58 Q170 104 186 124 L186 256 L54 256 L54 124 Q70 104 70 58 Z',
    dress: 'M98 52 Q120 66 142 52 L166 60 Q180 66 184 86 L198 150 L178 156 L172 124 L190 284 L50 284 L68 124 L62 156 L42 150 L56 86 Q60 66 74 60 Z',
  };
  const colours = [['#283c5d', 'NAVY'], ['#ece3d2', 'ECRU'], ['#7a2833', 'BORDEAUX'], ['#6d6a45', 'KHAKI'], ['#b98a5a', 'CAMEL'], ['#4a4e55', 'ANTHRACITE'], ['#93a68d', 'SAGE'], ['#c8952f', 'MUSTARD']];
  return { shapes, colours };
}

(async () => {
  const app = await start({ initScript: t => { try { localStorage.setItem('bl.user.moderator.lcw_theme', t); } catch (_) {} }, initArg: THEME });
  const { page } = app;
  try {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.click('button[data-tab="koleksiyon"]');
    await page.waitForFunction(() => typeof renderKol === 'function' && document.querySelector('#view-koleksiyon')?.offsetParent, null, { timeout: 60000 });
    await page.waitForFunction(() => kolWorkspaceCanEdit && kolIsOwnWorkspace(), null, { timeout: 60000 });
    const { shapes, colours } = demoImages();
    await page.evaluate(async ({ shapes, colours }) => {
      const raster = async (d, hex, stripe) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300"><rect width="240" height="300" fill="#f4f2ee"/><clipPath id="c"><path d="${d}"/></clipPath><g clip-path="url(#c)"><rect width="240" height="300" fill="${hex}"/>${stripe ? '<g fill="#ffffff" fill-opacity=".55">' + [90, 130, 170, 210].map(y => `<rect y="${y}" width="240" height="12"/>`).join('') + '</g>' : ''}<rect x="40" y="236" width="160" height="22" fill="#000" fill-opacity=".12"/></g><path d="${d}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/></svg>`;
        const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
        const c = document.createElement('canvas'); c.width = 480; c.height = 600; c.getContext('2d').drawImage(img, 0, 0, 480, 600); return c.toDataURL('image/png');
      };
      const groups = [['Kazak', 'sweater'], ['Hırka', 'cardigan'], ['Süveter', 'vest'], ['Triko Elbise', 'dress']];
      const fabrics = ['Merinos Yün', 'Pamuk Akrilik', 'Viskon Naylon'], arts = ['Düz', 'Çizgili'];
      const rows = [];
      for (let i = 0; i < 24; i++) {
        const [group, shape] = groups[i % 4], [hex, colour] = colours[(i * 3) % colours.length], art = arts[(i >> 2) % 2];
        rows.push({ id: i + 1, plmId: `DEMO-${100 + i}`, modelKod: `${art === 'Çizgili' ? 'Çizgili ' : ''}${group}`, colour, colourCode: `C${String(i + 1).padStart(2, '0')}`, productGroup: group, fabric: fabrics[i % 3], artworkDetail: art, quantity: String(600 + i * 50), fob: String((6.2 + i * 0.35).toFixed(2)), season: 'W26', inStoreMonth: '2027-04', durum: 'Order Placed', img: await raster(shapes[shape], hex, art === 'Çizgili') });
      }
      kolRows = kolNormalizeModelGroups(rows); kolSelected = new Set(rows.map(r => r.id)); saveKolRows(); renderKol();
    }, { shapes, colours });
    await page.waitForSelector('#kolTable tbody tr', { timeout: 30000 });
    // Önce görüntüsü sunucu kaydı (revizyon) tamamlandıktan sonra alınır; editör sonrası tüm satır birebir karşılaştırılır.
    await page.waitForFunction(() => kolRows.length === 24 && kolRows.every(r => r._rev != null), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__psBefore = JSON.stringify(kolRows); });
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 });
    await page.waitForTimeout(600);
    const state = () => page.evaluate(() => { const S = BLPresentationStudio._state(); return { cards: S.res.index.size, pages: S.res.pages.length, conflicts: S.res.conflicts.size, pinned: Object.values(S.doc.cards).filter(c => c.pinned).length, moved: Object.values(S.doc.cards).filter(c => c.vgroup != null).length, page: S.doc.page, cols: S.res.g.cols }; });
    const clean = () => page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, g = S.res.g; let bad = 0; for (const p of S.res.pages) { for (const it of p.items) if (it.x < -0.01 || it.y < -0.01 || it.x + it.w > g.w + 0.01 || it.y + it.h > g.h + 0.01) bad++; for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) if (E.overlaps(p.items[i], p.items[j])) bad++; } return bad; });
    let s = await state();
    assert.equal(s.cards, 24, 'seçili 24 model sunumda'); assert.equal(await clean(), 0);
    assert.equal(s.page.preset, 'A4'); assert.equal(s.page.orient, 'landscape');
    await page.screenshot({ path: path.join(OUT, `studio-${THEME}.png`) });

    // Grupla: Fabric seviyesi ekle (çok seviyeli).
    await page.click('.psStudio [data-pop="level"]');
    assert.ok(await page.$('.psPop [data-addlv="col.fabric"]'), 'Fabric sütunu gruplama seçeneği olarak listelenir');
    // Uzun listede satırlar sıkışıp üst üste binmez; arama kutusu odakta gelir.
    // Demo veride ~12 alan var; gerçek koleksiyonlarda 50+ sütun olur. Listeyi geçici satırlarla uzatıp ölç.
    const rows = await page.$eval('.psPop .psMenu', menu => {
      const extra = Array.from({ length: 50 }, (_, i) => { const b = menu.firstElementChild.cloneNode(true); b.removeAttribute('data-addlv'); b.removeAttribute('data-q'); b.dataset.probe = String(i); menu.append(b); return b; });
      const out = [...menu.children].map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, shrink: getComputedStyle(el).flexShrink }; });
      extra.forEach(b => b.remove());
      return out;
    });
    assert.ok(rows.length > 50, 'uzun alan listesi');
    for (let i = 0; i < rows.length; i += 1) { assert.equal(rows[i].shrink, '0', `satır ${i} küçülebilir`); assert.ok(rows[i].h >= 24, `satır ${i} yüksekliği ${rows[i].h}`); if (i) assert.ok(rows[i].top >= rows[i - 1].bottom - 0.5, `satır ${i} öncekiyle çakışıyor`); }
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.ps), 'search', 'arama kutusu odakta');
    await page.screenshot({ path: path.join(OUT, `level-list-${THEME}.png`), clip: await page.$eval('.psPop', el => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x - 330), y: Math.max(0, r.y - 110), width: 980, height: Math.min(560, r.height + 140) }; }) });
    await page.keyboard.type('zzqq'); await page.waitForTimeout(80);
    assert.equal(await page.$$eval('.psPop [data-addlv]:not([hidden])', els => els.length), 0);
    assert.equal(await page.$eval('.psPop [data-ps="noMatch"]', el => el.hidden), false, 'eşleşme yok mesajı');
    await page.fill('.psPop [data-ps="search"]', 'FABRİC'); await page.waitForTimeout(80);
    const visible = await page.$$eval('.psPop [data-addlv]:not([hidden])', els => els.map(el => el.dataset.addlv));
    assert.ok(visible.includes('col.fabric'), 'büyük harf / Türkçe İ ile arama eşleşir: ' + visible);
    await page.screenshot({ path: path.join(OUT, `level-search-${THEME}.png`), clip: await page.$eval('.psPop', el => { const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x - 330), y: Math.max(0, r.y - 110), width: 980, height: 420 }; }) });
    if (visible[0] === 'col.fabric') await page.keyboard.press('Enter'); else await page.click('.psPop [data-addlv="col.fabric"]');
    await page.waitForTimeout(200);
    assert.equal(await page.$('.psPop:not([hidden])'), null, 'seçimden sonra panel kapanır');
    assert.deepEqual(await page.evaluate(() => BLPresentationStudio._state().doc.grouping.levels), ['productGroup', 'col.fabric']);
    // Kart bilgileri: arama, Enter ile aç/kapat; arama metni ve odak yeniden çizimde korunur.
    await page.click('.psStudio [data-pop="fields"]');
    const fieldsBefore = await page.evaluate(() => [...BLPresentationStudio._state().doc.style.fields]);
    await page.keyboard.type('season'); await page.waitForTimeout(80);
    const firstField = await page.$eval('.psPop [data-q]:not([hidden])', el => el.dataset.f);
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const fieldsAfter = await page.evaluate(() => [...BLPresentationStudio._state().doc.style.fields]);
    assert.notDeepEqual(fieldsAfter, fieldsBefore, 'Enter ilk eşleşen kart bilgisini değiştirir');
    assert.equal(fieldsAfter.includes(firstField), !fieldsBefore.includes(firstField));
    assert.deepEqual(await page.evaluate(() => ({ ps: document.activeElement?.dataset?.ps, v: document.activeElement?.value })), { ps: 'search', v: 'season' });
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => [...BLPresentationStudio._state().doc.style.fields]), fieldsBefore, 'ikinci Enter geri alır');
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);

    // Serbest sürükleme (Alt) → sabit kart; diğerleri akmaya devam eder.
    const pageBox = await page.$eval('.psPageWrap .psPage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const first = await page.$eval('.psDocCard', el => { const r = el.getBoundingClientRect(); return { id: el.dataset.id, x: r.x + 20, y: r.y + 20 }; });
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.mouse.move(first.x + 30, first.y + 30, { steps: 4 });
    await page.keyboard.down('Alt'); await page.mouse.move(pageBox.x + pageBox.w * 0.82, pageBox.y + pageBox.h * 0.62, { steps: 10 });
    await page.mouse.up(); await page.keyboard.up('Alt'); await page.waitForTimeout(300);
    s = await state(); assert.equal(s.pinned, 1); assert.equal(s.cards, 24); assert.equal(await clean(), 0);
    const flowOnFirst = await page.evaluate(() => BLPresentationStudio._state().res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned).length);
    assert.ok(flowOnFirst > 0, 'tek kart sabitlenince sayfa otomatik akışa kapanmaz');

    // Kenardan boyutlandırma.
    const handle = await page.$('.psDocCard.isSel .psHandle[data-h="se"]');
    assert.ok(handle, 'seçili kartta boyut tutamağı');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + 4, hb.y + 4); await page.mouse.down(); await page.mouse.move(hb.x - 30, hb.y - 24, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    assert.equal(await clean(), 0);

    // Başka gruba taşıma (kart üstüne bırak) → yalnız belge değişir.
    const pair = await page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, flow = S.res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned); const a = flow[0]; const b = flow.find(x => E.effectiveKey(S.doc, x.id, id => ({ key: '' })) !== null && S.models.get(x.id).values.productGroup !== S.models.get(a.id).values.productGroup); return [a.id, b.id]; });
    const box = id => page.$eval(`.psDocCard[data-id="${pair[id]}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const a = await box(0), b = await box(1);
    await page.mouse.move(a.x + 15, a.y + 15); await page.mouse.down(); await page.mouse.move(a.x + 40, a.y + 40, { steps: 4 }); await page.mouse.move(b.x + b.w * 0.7, b.y + b.h / 2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
    s = await state(); assert.equal(s.moved, 1, 'kart görsel olarak başka gruba taşındı'); assert.equal(await clean(), 0);
    const diff = await page.evaluate(() => { const before = JSON.parse(window.__psBefore), out = []; kolRows.forEach((r, i) => { const b = before[i] || {}; for (const k of new Set([...Object.keys(r), ...Object.keys(b)])) if (JSON.stringify(r[k]) !== JSON.stringify(b[k])) out.push(`${r.id}.${k}: ${String(JSON.stringify(b[k])).slice(0, 60)} → ${String(JSON.stringify(r[k])).slice(0, 60)}`); }); if (kolRows.length !== before.length) out.push('length'); return out; });
    assert.deepEqual(diff, [], 'Koleksiyon verisi değişmez');
    assert.match(await page.$eval('.psStatus', el => el.textContent), /Koleksiyon verisi değişmedi|Collection data unchanged/);

    // Sayfa ölçüsü ve yön: tüm hazır ölçüler + özel ölçü.
    for (const preset of ['A3', '16:9', '4:3', 'square', 'A5', 'A4']) {
      await page.selectOption('.psStudio [data-ps="paper"]', preset); await page.waitForTimeout(150);
      if (await page.$('.psDialog [data-m="keep"]')) await page.click('.psDialog [data-m="keep"]');
      await page.waitForTimeout(150);
      s = await state(); assert.equal(s.page.preset, preset); assert.equal(s.cards, 24, preset); assert.equal(await clean(), 0, preset); assert.equal(s.conflicts, 0, preset);
    }
    await page.click('.psStudio [data-o="portrait"]'); await page.waitForTimeout(150);
    if (await page.$('.psDialog [data-m="keep"]')) await page.click('.psDialog [data-m="keep"]');
    s = await state(); assert.equal(s.page.orient, 'portrait'); assert.equal(await clean(), 0);
    await page.click('.psStudio [data-o="landscape"]'); await page.waitForTimeout(150);
    if (await page.$('.psDialog [data-m="keep"]')) await page.click('.psDialog [data-m="keep"]');

    // Şablon kaydet → başka şablon uygula → kendi şablonuna dön.
    await page.click('.psStudio [data-pop="templates"]');
    await page.fill('.psPop [data-ps="tplName"]', 'Kabul Katalog');
    await page.click('.psPop [data-ps="tplSave"]');
    assert.ok(await page.$('.psPop [data-tpl="s0"]'), 'kayıtlı şablon listede');
    await page.click('.psPop [data-tpl="b1"]'); await page.waitForTimeout(250);
    if (await page.$('.psDialog [data-m="keep"]')) await page.click('.psDialog [data-m="keep"]');
    s = await state(); assert.equal(s.page.preset, '16:9'); assert.equal(await clean(), 0);
    await page.click('.psStudio [data-pop="templates"]'); await page.click('.psPop [data-tpl="s0"]'); await page.waitForTimeout(250);
    if (await page.$('.psDialog [data-m="keep"]')) await page.click('.psDialog [data-m="keep"]');
    s = await state(); assert.equal(s.page.preset, 'A4'); assert.deepEqual(await page.evaluate(() => BLPresentationStudio._state().doc.grouping.levels), ['productGroup', 'col.fabric']);
    assert.equal(await page.evaluate(() => JSON.parse(BLStorage.getItem('bl.presentationStudio.templates.v1')).length), 1);

    // Geri al / ileri al.
    const before = await page.evaluate(() => JSON.stringify(BLPresentationStudio._state().doc));
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => JSON.stringify(BLPresentationStudio._state().doc)), before);
    await page.evaluate(() => { BLPresentationStudio._state().sel.clear(); });
    await page.mouse.click(pageBox.x - 10, pageBox.y + 40); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `studio-edited-${THEME}.png`) });
    // Sürüm notu görseli: bir kart seçili (bağlamsal araç çubuğu + tutamaçlar), bildirimler kapalı.
    const pick = await page.$eval('.psPageWrap .psDocCard:not(.isPinned)', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 3 }; });
    await page.mouse.click(pick.x, pick.y); await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback]').forEach(el => el.remove()));
    await page.mouse.move(5, 5); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `presentation-studio-${THEME}.png`) });
    // Belge sayfası (yalnız kâğıt) — PDF/PPTX karşılaştırması için.
    await page.evaluate(() => { const S = BLPresentationStudio._state(); S.zoom = 1; S.pageHtml.clear(); S.sel.clear(); });
    await page.click('.psStudio [data-ps="zoomFit"]'); await page.waitForTimeout(300);

    // PPTX: gerçek indirme.
    const [pptx] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), (async () => { await page.click('.psStudio [data-pop="export"]'); await page.click('.psPop [data-ex="pptx"]'); })()]);
    await pptx.saveAs(path.join(OUT, 'presentation.pptx'));
    // PDF: Electron printToPDF ile aynı Chromium yolu (aynı belge HTML'i, @page ölçüsü).
    const html = await page.evaluate(async () => { const S = BLPresentationStudio._state(); const list = BLPresentationRender.build(S.doc, S.res, { lines: id => S.doc.style.fields.map(f => ({ label: S.meta.label(f), value: String(S.models.get(id).values[f] ?? '') })), image: () => null, header: () => ({ main: '', rest: '', count: '' }) }, { measure: S.measure }); return list.pages.length; });
    assert.ok(html >= 1);
    const docHtml = await page.evaluate(() => new Promise(resolve => { const S = BLPresentationStudio._state(); const orig = window.buyerLogDesktop; window.buyerLogDesktop = { renderPdf: async h => { resolve(h); return { ok: false, error: 'capture' }; } }; document.querySelector('.psStudio [data-pop="export"]').click(); document.querySelector('.psPop [data-ex="pdf"]').click(); setTimeout(() => { window.buyerLogDesktop = orig; }, 5000); }));
    fs.writeFileSync(path.join(OUT, 'presentation.html'), docHtml);
    const pdfPage = await page.context().newPage();
    await pdfPage.setContent(docHtml, { waitUntil: 'load' });
    await pdfPage.pdf({ path: path.join(OUT, 'presentation.pdf'), preferCSSPageSize: true, printBackground: true });
    await pdfPage.close();
    const pageShot = await page.$('.psPageWrap .psPage');
    await pageShot.screenshot({ path: path.join(OUT, 'editor-page1.png') });
    fs.writeFileSync(path.join(OUT, 'geometry.json'), JSON.stringify(await page.evaluate(() => { const S = BLPresentationStudio._state(); return { w: S.res.g.w, h: S.res.g.h, page1: S.list.pages[0].elements.map(e => ({ type: e.type, id: e.id, x: e.x, y: e.y, w: e.w, h: e.h })) }; }), null, 1));
    // CP ve Siparişler: aynı Presentation Studio (her kart bir sipariş satırı; filtrelenmiş kapsam).
    await page.evaluate(() => BLPresentationStudio.close());
    const sources = {};
    for (const [tab, btn, menu, name] of [['cp', '#cpToolsBtn', '#cpToolsMenu', 'CP'], ['orders', '#ordersToolsBtn', '#ordersToolsMenu', 'Siparişler']]) {
      await page.click(`button[data-tab="${tab}"]`);
      await page.waitForFunction(t => document.querySelector(`#view-${t}`)?.offsetParent && document.querySelectorAll(`#view-${t} table tbody tr`).length > 0, tab, { timeout: 60000 });
      await page.waitForTimeout(400);
      const before = await page.evaluate(t => { const info = BLAIScreenData.table(t, { all: true }); return JSON.stringify(info.rows); }, tab);
      await page.click(btn); await page.click(`${menu} [data-output-studio="${tab}"]`);
      await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 }); await page.waitForTimeout(400);
      const info = await page.evaluate(t => { const S = BLPresentationStudio._state(), rows = BLAIScreenData.table(t, { all: false }).rows.length; return { cards: S.res.index.size, rows, source: S.doc.source, status: document.querySelector('.psStatus').textContent }; }, tab);
      assert.equal(info.source, tab); assert.ok(info.cards > 0 && info.cards === info.rows, JSON.stringify(info)); assert.equal(await clean(), 0);
      assert.ok(info.status.includes(`${name} verisi değişmedi`), info.status);
      assert.ok(await page.$eval('.psPageWrap .psPageTools', el => { const r = el.getBoundingClientRect(); return r.height > 0 && document.elementFromPoint(r.x + 30, r.y + r.height / 2)?.closest('.psPageTools') === el; }), 'sayfa araç çubuğu görünür ve tıklanabilir');
      await page.screenshot({ path: path.join(OUT, `studio-${tab}-${THEME}.png`) });
      await page.evaluate(() => BLPresentationStudio.close());
      assert.equal(await page.evaluate(t => JSON.stringify(BLAIScreenData.table(t, { all: true }).rows), tab), before, `${tab} verisi değişmez`);
      sources[tab] = info.cards;
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, sources, theme: THEME, out: OUT }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exit(1); });
