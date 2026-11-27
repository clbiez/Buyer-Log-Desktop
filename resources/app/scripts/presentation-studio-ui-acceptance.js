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
    const clean = () => page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, g = S.res.g; let bad = 0; for (const p of S.res.pages) { for (const it of p.items) if (it.x < g.m - 0.01 || it.y < g.m - 0.01 || it.x + it.w > g.w - g.m + 0.01 || it.y + it.h > g.h - g.m + 0.01) bad++; const own = (a, b) => a.kind === 'area' && b.area === a.key; for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) { const a = p.items[i], b = p.items[j]; if (!own(a, b) && !own(b, a) && E.overlaps(a, b)) bad++; } } return bad; });
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
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x - 30, hb.y - 24, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
    assert.equal(await clean(), 0);

    // Başka gruba taşıma (kart üstüne bırak) → yalnız belge değişir.
    const movedBefore = (await state()).moved; // serbest bırakılan kart başka grubun alanına düştüyse zaten katılmış olabilir
    const pair = await page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, flow = S.res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned); const a = flow[0]; const b = flow.find(x => E.effectiveKey(S.doc, x.id, id => ({ key: '' })) !== null && S.models.get(x.id).values.productGroup !== S.models.get(a.id).values.productGroup); return [a.id, b.id]; });
    const box = id => page.$eval(`.psDocCard[data-id="${pair[id]}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const a = await box(0), b = await box(1);
    // Shift: yalnız bu kart başka gruba geçer (grup birleştirilmez).
    await page.mouse.move(a.x + 15, a.y + 15); await page.mouse.down(); await page.mouse.move(a.x + 40, a.y + 40, { steps: 4 }); await page.keyboard.down('Shift'); await page.mouse.move(b.x + b.w * 0.7, b.y + b.h / 2, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(300);
    s = await state(); assert.equal(s.moved, movedBefore + 1, 'kart görsel olarak başka gruba taşındı'); assert.equal(await clean(), 0);
    // Shiftsiz bırakma: iki kartın grupları birleşir (kaynak grubun tüm kartları hedef gruba geçer; kaynak başlığı kalkar).
    const mg = await page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, key = id => E.effectiveKey(S.doc, id, x => { const m = S.models.get(x); return { key: S.doc.grouping.levels.map(f => String(m.keys[f] == null ? '' : m.keys[f])).join(E.SEP) }; }); const flow = S.res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned && !i.area); const counts = new Map(); for (const c of S.doc.order) { const k = key(c); counts.set(k, (counts.get(k) || 0) + 1); } for (const x of flow) { if ((counts.get(key(x.id)) || 0) < 2) continue; const y = flow.find(o => key(o.id) !== key(x.id)); if (y) return { a: x.id, b: y.id, from: key(x.id), to: key(y.id), n: counts.get(key(x.id)) }; } return null; });
    if (mg) {
      const ma = await page.$eval(`.psDocCard[data-id="${mg.a}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 15, y: r.y + 15 }; });
      const mb2 = await page.$eval(`.psDocCard[data-id="${mg.b}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height / 2 }; });
      await page.mouse.move(ma.x, ma.y); await page.mouse.down(); await page.mouse.move(ma.x + 25, ma.y + 25, { steps: 4 }); await page.mouse.move(mb2.x, mb2.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
      const after = await page.evaluate(m => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, key = id => E.effectiveKey(S.doc, id, x => { const mm = S.models.get(x); return { key: S.doc.grouping.levels.map(f => String(mm.keys[f] == null ? '' : mm.keys[f])).join(E.SEP) }; }); return { left: S.doc.order.filter(id => key(id) === m.from).length, hdrFrom: S.res.pages.flatMap(p => p.items).filter(i => i.kind === 'hdr' && i.key === m.from).length }; }, mg);
      assert.deepEqual(after, { left: 0, hdrFrom: 0 }, 'gruplar birleşti: ' + JSON.stringify({ mg, after }));
      assert.equal(await clean(), 0);
      await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    }
    const diff = await page.evaluate(() => { const before = JSON.parse(window.__psBefore), out = []; kolRows.forEach((r, i) => { const b = before[i] || {}; for (const k of new Set([...Object.keys(r), ...Object.keys(b)])) if (JSON.stringify(r[k]) !== JSON.stringify(b[k])) out.push(`${r.id}.${k}: ${String(JSON.stringify(b[k])).slice(0, 60)} → ${String(JSON.stringify(r[k])).slice(0, 60)}`); }); if (kolRows.length !== before.length) out.push('length'); return out; });
    assert.deepEqual(diff, [], 'Koleksiyon verisi değişmez');
    assert.match(await page.$eval('.psStatus', el => el.textContent), /Koleksiyon verisi değişmedi|Collection data unchanged/);

    // Uzun grup başlığı: dar grupta tam metin birden çok satıra kırılır ("…" yok); kartlar bandın altında.
    const LONG = 'Three Thread Brushed · 30/70/14 · 260 gsm · 65% Cotton 35% Poliester';
    const narrowKey = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.res.pages[0].items.filter(i => i.kind === 'hdr').sort((a, b) => a.w - b.w)[0]; return h.key; });
    await page.dblclick(`.psPageWrap .psDocHdr[data-hdr="${narrowKey.replace(/"/g, '\\"')}"]`); await page.waitForTimeout(250);
    await page.fill('.psDialog [data-ps="rename"]', LONG); await page.click('.psDialog [data-m="ok"]'); await page.waitForTimeout(400);
    const hdrCheck = await page.evaluate(key => {
      const S = BLPresentationStudio._state(), el = S.list.pages.flatMap(p => p.elements).find(e => e.type === 'hdr' && e.key === key);
      const dom = [...document.querySelectorAll('.psPageWrap .psDocHdr')].find(h => h.dataset.hdr === key);
      return { lines: el.lines.length, text: el.lines.map(l => l.atoms.filter(a => a.type === 'text').map(a => a.t).join(' ')).join(' '), dom: dom ? dom.textContent : '', h: el.h };
    }, narrowKey);
    assert.ok(hdrCheck.lines >= 2, 'dar grupta başlık çok satırlı: ' + JSON.stringify(hdrCheck));
    assert.equal(hdrCheck.text.replace(/\s+/g, ' ').trim(), LONG, 'başlık tam metin');
    assert.ok(!hdrCheck.dom.includes('…') && hdrCheck.dom.replace(/\s+/g, ' ').includes('30/70/14'), 'DOM başlıkta kısaltma yok');
    assert.equal(await clean(), 0);
    await page.screenshot({ path: path.join(OUT, `wrap-${THEME}.png`) });

    // Tek kartlık grubu serbest bırak → kart kendi grup başlığıyla görünür.
    const lone = await page.evaluate(() => {
      const S = BLPresentationStudio._state(), E = BLPresentationEngine, flow = S.res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned);
      // Grubun tüm akan kartları (bütün sayfalar) sayılır: yalnız tek kartlık grup "yalnız" sayılır.
      const key = id => E.effectiveKey(S.doc, id, x => { const m = S.models.get(x); return { key: S.doc.grouping.levels.map(f => String(m.keys[f] == null ? '' : m.keys[f])).join(E.SEP) }; });
      const all = S.res.pages.flatMap(p => p.items).filter(i => i.kind === 'card' && !i.pinned && !i.area), count = new Map();
      for (const it of all) { const k = key(it.id); count.set(k, (count.get(k) || []).concat(it.id)); }
      const one = [...count.entries()].find(([, ids]) => ids.length === 1 && flow.some(f => f.id === ids[0]));
      return one ? { key: one[0], id: one[1][0] } : null;
    });
    if (lone) {
      // Serbest (akışsız) bir sayfa ekle ve kartı küçük resmine bırak: kart orada tek başına, kendi grup başlığıyla.
      const pagesNow = await page.evaluate(() => BLPresentationStudio._state().doc.pages.length);
      await page.click('.psStudio [data-ps="addPage"]'); await page.waitForTimeout(300);
      const freePage = await page.evaluate(n => BLPresentationStudio._state().doc.pages[n].id, pagesNow);
      const lb = await page.$eval(`.psDocCard[data-id="${lone.id}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20 }; });
      const th = await page.$eval(`.psStudio .psThumb[data-th="${freePage}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.move(lb.x, lb.y); await page.mouse.down(); await page.mouse.move(lb.x + 30, lb.y + 30, { steps: 4 });
      await page.mouse.move(th.x, th.y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300);
      assert.equal(await page.evaluate(id => BLPresentationStudio._state().res.index.get(id).page, lone.id), freePage, 'kart serbest sayfada');
      await page.click(`.psStudio .psThumb[data-th="${freePage}"]`); await page.waitForTimeout(300);
    }
    // Değişmez: grubunun akış başlığı aynı sayfada olmayan her sabit kartın üstünde kendi başlığı var.
    const orphans = () => page.evaluate(() => {
      const S = BLPresentationStudio._state(), E = BLPresentationEngine, out = [];
      const keyOf = id => { const c = S.doc.cards[id], m = S.models.get(id); return c && c.vgroup != null ? c.vgroup : S.doc.grouping.levels.map(f => String(m.keys[f] == null ? '' : m.keys[f])).join(E.SEP); };
      for (const p of S.res.pages) {
        const flowKeys = new Set(p.items.filter(h => h.kind === 'hdr' && !h.pinOf).map(h => h.key));
        for (const it of p.items.filter(i => i.kind === 'card' && i.pinned)) if (!flowKeys.has(keyOf(it.id)) && !p.items.some(h => h.kind === 'hdr' && (h.pins || []).includes(it.id))) out.push(it.id);
      }
      return out;
    });
    assert.deepEqual(await orphans(), [], 'başlıksız sabit kart');
    if (lone) {
      const own = await page.evaluate(id => { const S = BLPresentationStudio._state(); const p = S.res.pages.find(pg => pg.items.some(i => i.id === id)); const c = p.items.find(i => i.id === id), h = p.items.find(i => i.kind === 'hdr' && (i.pins || []).includes(id)); return h ? { ok: Math.abs(h.y + h.h + S.res.g.hGap - c.y) < 0.01 && c.x >= h.x - 0.01 && c.x < h.x + h.w, dom: Boolean([...document.querySelectorAll('.psDocHdr')].find(d => d.dataset.hdr === h.key)) } : { none: true, pinned: Boolean(c.pinned), card: S.doc.cards[id], hist: S.hist.length, hdrs: p.items.filter(i => i.kind === 'hdr').map(i => (i.pinOf ? 'pin:' : '') + i.key.slice(0, 24)) }; }, lone.id);
      assert.ok(own && own.ok && own.dom, 'grubundan çıkarılan tek kartın başlığı kartın üstünde: ' + JSON.stringify(own));
      await page.screenshot({ path: path.join(OUT, `pinned-header-${THEME}.png`) });
      // Ayrılmış kartın başlığını sürükle → kart kendi grup alanına alınır (özgün başlık metni), alan boyutlanabilir.
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); // seçim araç çubuğu başlığı örtmesin
      const ph = await page.$eval(`.psPageWrap .psDocHdr[data-pins*="${lone.id}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
      const lonePage = await page.evaluate(id => BLPresentationStudio._state().res.index.get(id).page, lone.id);
      const pb1 = await page.$eval(`.psPageWrap[data-ps-page="${lonePage}"] .psPage`, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await page.mouse.move(ph.x, ph.y); await page.mouse.down(); await page.mouse.move(ph.x + 20, ph.y + 20, { steps: 4 }); await page.mouse.move(pb1.x + pb1.w * 0.6, pb1.y + pb1.h * 0.5, { steps: 10 });
      const midSplit = await page.evaluate(() => { const a = BLPresentationStudio._state().act; return a ? { type: a.type, page: a.page, pins: a.pins, x: a.x, y: a.y } : null; });
      await page.mouse.up(); await page.waitForTimeout(400);
      const sp = await page.evaluate(id => { const S = BLPresentationStudio._state(); const k = S.doc.cards[id] && S.doc.cards[id].vgroup; const items = S.res.pages.flatMap(p => p.items); return { k, split: Boolean(k && S.doc.splits && S.doc.splits[k]), area: Boolean(k && S.doc.areas[k]), pinned: Boolean(S.doc.cards[id].pinned), inArea: items.some(i => i.kind === 'card' && i.id === id && i.area === k), hdr: (items.find(i => i.kind === 'hdr' && i.area === k) || {}).vals, sel: S.areaSel === k }; }, lone.id);
      assert.ok(sp.split && sp.area && !sp.pinned && sp.inArea && sp.sel, 'ayrılmış kart kendi alanında: ' + JSON.stringify({ sp, midSplit, ph, pb1 }));
      assert.ok(Array.isArray(sp.hdr) && sp.hdr.length > 0, 'özgün başlık metni');
      assert.ok(await page.$(`.psArea[data-area="${sp.k.replace(/"/g, '\\"')}"] .psHandle[data-ah="e"]`), 'alan tutamağı');
      assert.equal(await clean(), 0);
    }
    assert.equal(await clean(), 0);

    // Serbest bırakılan kart başka grubun kartının üstüne düşerse o gruba elle katılır; yeni başlık yazılmaz.
    await page.click('.psStudio .psThumb[data-th="p1"]'); await page.waitForTimeout(400); // sayfa 1'e dön (yalnız görünen sayfalar çizilir)
    const join = await page.evaluate(() => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, items = S.res.pages[0].items, flow = items.filter(i => i.kind === 'card' && !i.pinned); const key = id => E.effectiveKey(S.doc, id, x => { const m = S.models.get(x); const k = S.doc.grouping.levels.map(f => String(m.keys[f] == null ? '' : m.keys[f])).join(E.SEP); return { key: k }; }); for (const a of flow) { const b = flow.find(x => key(x.id) !== key(a.id) && Math.abs(x.y - a.y) > 1); if (b) return { a: a.id, b: b.id, bKey: key(b.id) }; } return null; });
    if (join) {
      const ja = await page.$eval(`.psDocCard[data-id="${join.a}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20 }; });
      const jb = await page.$eval(`.psDocCard[data-id="${join.b}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
      await page.mouse.move(ja.x, ja.y); await page.mouse.down(); await page.mouse.move(ja.x + 30, ja.y + 30, { steps: 4 });
      await page.keyboard.down('Alt'); await page.mouse.move(jb.x + 20, jb.y + 20, { steps: 10 });
      await page.mouse.up(); await page.keyboard.up('Alt'); await page.waitForTimeout(300);
      const jr = await page.evaluate(({ a }) => { const S = BLPresentationStudio._state(); return { vgroup: S.doc.cards[a]?.vgroup ?? null, pinned: Boolean(S.doc.cards[a]?.pinned), own: S.res.pages.flatMap(p => p.items).some(h => h.kind === 'hdr' && h.pinOf === a) }; }, join);
      assert.ok(jr.pinned, 'serbest yerleşti');
      assert.equal(jr.own, false, 'gruba katılan karta ayrı başlık yazılmaz');
      assert.equal(jr.vgroup, join.bKey, 'kart bırakıldığı gruba katıldı');
      assert.equal(await clean(), 0);
      const jdiff = await page.evaluate(() => { const before = JSON.parse(window.__psBefore); return kolRows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i])).length; });
      assert.equal(jdiff, 0, 'Koleksiyon verisi değişmez');
    }

    // Çoklu seçim + boyutlandırma: seçili kartların hepsi aynı ölçüye gelir.
    const trio = await page.evaluate(() => BLPresentationStudio._state().res.pages[0].items.filter(i => i.kind === 'card' && !i.pinned).slice(0, 3).map(i => i.id));
    await page.click(`.psDocCard[data-id="${trio[0]}"]`, { position: { x: 30, y: 30 } });
    for (const id of trio.slice(1)) await page.click(`.psDocCard[data-id="${id}"]`, { position: { x: 30, y: 30 }, modifiers: ['Shift'] });
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().sel.size), 3);
    const mh = await page.$(`.psDocCard[data-id="${trio[2]}"] .psHandle[data-h="se"]`);
    assert.ok(mh, 'çoklu seçimde birincil kartta boyut tutamağı');
    const mb = await mh.boundingBox();
    assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.psHandle')), { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 }), true, 'tutamak görünür ve tıklanabilir');
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down(); await page.mouse.move(mb.x - 26, mb.y - 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    const sizes = await page.evaluate(ids => ids.map(id => { const c = BLPresentationStudio._state().doc.cards[id]; return c && c.pinned ? `${c.w.toFixed(1)}×${c.h.toFixed(1)}` : 'flow'; }), trio);
    const dbg = await page.evaluate(ids => { const S = BLPresentationStudio._state(); return { sel: [...S.sel], primary: S.primary, ids, tip: document.querySelector('.psTip')?.textContent, idx: ids.map(id => S.res.index.get(id)) }; }, trio);
    assert.equal(new Set(sizes).size, 1, 'aynı ölçü: ' + sizes); assert.notEqual(sizes[0], 'flow', JSON.stringify(dbg).slice(0, 900));
    assert.equal((await state()).conflicts, 0); assert.equal(await clean(), 0);
    const orph = await orphans();
    const why = orph.length ? await page.evaluate(id => { const S = BLPresentationStudio._state(), E = BLPresentationEngine, g = S.res.g, p = S.res.pages.find(pg => pg.items.some(i => i.id === id)), c = p.items.find(i => i.id === id); const hh = g.hH, top = c.y - g.hGap - hh; return { c: { x: c.x, y: c.y, w: c.w, h: c.h }, card: S.doc.cards[id], top, hits: p.items.filter(o => o.id !== id && E.overlaps({ x: c.x, y: top, w: c.w, h: hh }, o)).map(o => ({ kind: o.kind, id: o.id, key: o.key, pinOf: o.pinOf, x: o.x, y: o.y, w: o.w, h: o.h })) }; }, orph[0]) : null;
    assert.deepEqual(orph, [], 'çoklu boyut sonrası başlıksız sabit kart ' + JSON.stringify(why));
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `multi-resize-${THEME}.png`) });
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = ''; }));

    // Grup alanı (seçenek d): başlığı sürükle → grup kendi alanında akar; kenarından boyutla; akışa döndür.
    const areaKey = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.res.pages[0].items.filter(i => i.kind === 'hdr' && !i.pinOf && !i.area).sort((a, b) => b.count - a.count)[0]; return h.key; });
    const groupTotal = await page.evaluate(k => { const S = BLPresentationStudio._state(), E = BLPresentationEngine; return S.doc.order.filter(id => !S.doc.cards[id]?.pinned && !S.doc.cards[id]?.excluded && E.effectiveKey(S.doc, id, x => { const m = S.models.get(x); return { key: S.doc.grouping.levels.map(f => String(m.keys[f] == null ? '' : m.keys[f])).join(E.SEP) }; }) === k).length; }, areaKey);
    const hb0 = await page.$eval(`.psPageWrap .psDocHdr[data-hdr="${areaKey.replace(/"/g, '\\"')}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
    const pb0 = await page.$eval('.psPageWrap .psPage', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.move(hb0.x, hb0.y); await page.mouse.down(); await page.mouse.move(hb0.x + 20, hb0.y + 20, { steps: 4 });
    await page.mouse.move(pb0.x + pb0.w * 0.72, pb0.y + pb0.h * 0.08, { steps: 10 }); await page.waitForTimeout(120);
    // Canlı önizleme: sürüklerken grup alanı belgede ve sayfada; öteki gruplar şimdiden yer açar.
    assert.ok(await page.evaluate(k => { const S = BLPresentationStudio._state(); return S.act?.type === 'areaDrag' && Boolean(S.doc.areas[k]) && S.res.pages.some(p => p.items.some(i => i.kind === 'area' && i.key === k)); }, areaKey), 'sürüklerken canlı önizleme');
    await page.mouse.up(); await page.waitForTimeout(400);
    let ar = await page.evaluate(k => { const S = BLPresentationStudio._state(); const items = S.res.pages.flatMap((p, i) => p.items.map(it => ({ ...it, pi: i }))); return { spec: S.doc.areas && S.doc.areas[k], areas: items.filter(i => i.kind === 'area' && i.key === k).map(i => ({ pi: i.pi, cont: i.cont, x: i.x, y: i.y, w: i.w, h: i.h })), cards: items.filter(i => i.kind === 'card' && i.area === k).length, flowHdr: items.filter(i => i.kind === 'hdr' && i.key === k && !i.area && !i.pinOf).length, dom: Boolean(document.querySelector(`.psArea[data-area="${CSS.escape(k)}"]`)), sel: S.areaSel }; }, areaKey);
    assert.ok(ar.spec && ar.areas.length >= 1 && ar.dom, 'grup alanı oluştu: ' + JSON.stringify(ar));
    assert.equal(ar.cards, groupTotal, 'grubun tüm kartları alanda');
    assert.equal(ar.flowHdr, 0, 'akışta ikinci başlık yok');
    assert.equal(ar.sel, areaKey, 'alan seçili');
    assert.equal(await clean(), 0);
    assert.ok(await page.$eval('.psFloat', el => !el.hidden && Boolean(el.querySelector('[data-fa-area="out"]'))), 'alan araç çubuğu: Akışa döndür');
    // Kenardan daralt: 1 sütun → kartlar sığmaz, sonraki sayfada aynı başlıkla devam eder.
    const handleE = await page.$(`.psArea[data-area="${areaKey.replace(/"/g, '\\"')}"] .psHandle[data-ah="e"]`);
    assert.ok(handleE, 'alan kenar tutamağı');
    const hbE = await handleE.boundingBox();
    const areaBox = await page.$eval(`.psArea[data-area="${areaKey.replace(/"/g, '\\"')}"]`, el => { const r = el.getBoundingClientRect(); return { r: r.right, cy: r.top + r.height / 2 }; });
    assert.ok(Math.abs(hbE.x + hbE.width - areaBox.r) < 2 && Math.abs(hbE.y + hbE.height / 2 - areaBox.cy) < 3, 'doğu tutamağı sağ kenarın ortasında');
    const oneCol = await page.evaluate(() => { const S = BLPresentationStudio._state(); return S.res.g.cellW * S.zoom * 96 / 72; });
    const startW = await page.evaluate(k => BLPresentationStudio._state().doc.areas[k].w, areaKey);
    const atHandle = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return el ? el.className + '|' + (el.closest('.psArea') ? 'inArea' : '') : 'none'; }, { x: hbE.x + hbE.width / 2, y: hbE.y + hbE.height / 2 });
    await page.mouse.move(hbE.x + hbE.width / 2, hbE.y + hbE.height / 2); await page.mouse.down();
    const actType = await page.evaluate(() => BLPresentationStudio._state().act?.type || 'none');
    await page.mouse.move(hbE.x - (ar.areas[0].w * 96 / 72 * await page.evaluate(() => BLPresentationStudio._state().zoom)) + oneCol, hbE.y + hbE.height / 2, { steps: 8 });
    const mid = await page.evaluate(k => { const S = BLPresentationStudio._state(); return { act: S.act && S.act.type, last: S.act && S.act.last, start: S.act && S.act.start && { x: S.act.start.x, w: S.act.start.w }, el: Boolean(S.host.querySelector(`.psArea[data-area="${CSS.escape(k)}"]`)) }; }, areaKey);
    await page.mouse.up(); await page.waitForTimeout(400);
    // Grup bazlı kart boyutu: alan daralınca kartlar alanı orantılı doldurur (boş alan yok, kesilme yok).
    ar = await page.evaluate(k => { const S = BLPresentationStudio._state(); const items = S.res.pages.flatMap((p, i) => p.items.map(it => ({ ...it, pi: i }))); const a = items.find(i => i.kind === 'area' && i.key === k && !i.cont), cards = items.filter(i => i.kind === 'card' && i.area === k); return { spec: S.doc.areas[k], fit: Boolean(a && a.fit), cards: cards.length, right: Math.max(...cards.map(c => c.x + c.w)) - (a.x + a.w), bottom: Math.max(...cards.map(c => c.y + c.h)) - (a.y + a.h), cw: cards[0] && cards[0].w, global: S.res.g.cellW, undo: S.hist.length }; }, areaKey);
    assert.ok(ar.spec.w < startW - 50 && ar.spec.h > 0 && ar.fit, 'alan daraldı, grup bazlı boyut: ' + JSON.stringify({ ...ar, startW, atHandle, actType, mid }));
    assert.equal(ar.cards, groupTotal);
    assert.ok(Math.abs(ar.right) < 0.5 && Math.abs(ar.bottom) < 0.5, 'kartlar alanı dolduruyor: ' + JSON.stringify(ar));
    assert.equal(await clean(), 0);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `group-area-${THEME}.png`) });
    // Görsel arkasında gri zemin yok.
    assert.equal(await page.evaluate(() => document.querySelector('.psPageWrap .psPage').innerHTML.includes(`background:${BLPresentationRender.DOC.image}`)), false, 'görsel zemini kart rengi');
    // Alana kart eklenince içerideki kartlar küçülür, alan yine dolu.
    const addId = await page.evaluate(k => BLPresentationStudio._state().res.pages[0].items.find(i => i.kind === 'card' && !i.area && !i.pinned)?.id, areaKey);
    if (addId) {
      const sa = await page.$eval(`.psDocCard[data-id="${addId}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 20 }; });
      const ta = await page.$eval(`.psArea[data-area="${areaKey.replace(/"/g, '\\"')}"]`, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height - 10 }; });
      await page.mouse.move(sa.x, sa.y); await page.mouse.down(); await page.mouse.move(sa.x + 25, sa.y + 25, { steps: 4 });
      await page.keyboard.down('Shift'); await page.mouse.move(ta.x, ta.y, { steps: 10 }); await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(400);
      const grown = await page.evaluate(k => { const S = BLPresentationStudio._state(); const items = S.res.pages.flatMap(p => p.items); const a = items.find(i => i.kind === 'area' && i.key === k && !i.cont), cards = items.filter(i => i.kind === 'card' && i.area === k); return { n: cards.length, cw: cards[0].w, ch: cards[0].h, right: Math.max(...cards.map(c => c.x + c.w)) - (a.x + a.w), bottom: Math.max(...cards.map(c => c.y + c.h)) - (a.y + a.h) }; }, areaKey);
      const dbgA = await page.evaluate(({ k, id }) => { const S = BLPresentationStudio._state(); const a = S.res.pages.flatMap(p => p.items).find(i => i.kind === 'area' && i.key === k && !i.cont); return { spec: S.doc.areas[k], card: S.doc.cards[id], idx: S.res.index.get(id), area: a && { x: a.x, y: a.y, w: a.w, h: a.h, fit: a.fit } }; }, { k: areaKey, id: addId });
      assert.ok(grown.n === groupTotal + 1, 'kart alana eklendi: ' + JSON.stringify({ grown, dbgA, ta, sa }));
      assert.ok(grown.cw * grown.ch <= ar.cw * 1e9 && Math.abs(grown.right) < 0.5 && Math.abs(grown.bottom) < 0.5, 'alan yine dolu: ' + JSON.stringify(grown));
      assert.equal(await clean(), 0);
    }
    // Otomatik kart boyutu: genel tasarım ölçüsüne döner.
    await page.click(`.psPageWrap .psDocHdr[data-area-hdr="${areaKey.replace(/"/g, '\\"')}"]`); await page.waitForTimeout(200);
    await page.click('.psFloat [data-fa-area="auto"]'); await page.waitForTimeout(300);
    const autoS = await page.evaluate(k => { const S = BLPresentationStudio._state(); const c = S.res.pages.flatMap(p => p.items).find(i => i.kind === 'card' && i.area === k); return { h: S.doc.areas[k].h, cw: c.w, g: S.res.g.cellW }; }, areaKey);
    assert.ok(autoS.h === 0 && Math.abs(autoS.cw - autoS.g) < 0.01, 'otomatik boyut: ' + JSON.stringify(autoS));
    assert.equal(await clean(), 0);
    // Kartları yay: alan sayfanın altına taşınınca kartlar sonraki sayfada sürer; alan sağa genişletilince
    // kart ölçüsü korunarak taşan kartlar alana katılır (sığdırma yerine).
    const areaHdrSel = `.psPageWrap .psDocHdr[data-area-hdr="${areaKey.replace(/"/g, '\\"')}"]`;
    let ah0 = await page.$eval(areaHdrSel, el => { const r = el.getBoundingClientRect(); return { x: r.x + 12, y: r.y + r.height / 2 }; });
    await page.mouse.move(ah0.x, ah0.y); await page.mouse.down(); await page.mouse.move(ah0.x + 10, ah0.y + 10, { steps: 3 });
    await page.mouse.move(pb0.x + pb0.w * 0.05, pb0.y + pb0.h * 0.6, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
    const spreadInfo = () => page.evaluate(k => { const S = BLPresentationStudio._state(), all = S.res.pages.flatMap((p, i) => p.items.map(it => ({ ...it, pi: i }))), a = all.find(i => i.kind === 'area' && i.key === k && !i.cont); const main = all.filter(i => i.kind === 'card' && i.area === k && i.pi === a.pi && i.y >= a.y && i.y < a.y + a.h); return { spec: S.doc.areas[k], main: main.length, total: all.filter(i => i.kind === 'card' && i.area === k).length, cw: main[0] && main[0].w, g: S.res.g.cellW, cont: all.some(i => i.kind === 'area' && i.key === k && i.cont), x: a.x, w: a.w }; }, areaKey);
    let sp0 = await spreadInfo();
    assert.ok(sp0.cont && sp0.main < sp0.total, 'alan sayfa sonunda devam ediyor: ' + JSON.stringify(sp0));
    const hE2 = await (await page.$(`.psArea[data-area="${areaKey.replace(/"/g, '\\"')}"]:not(.isCont) .psHandle[data-ah="e"]`)).boundingBox();
    await page.mouse.move(hE2.x + hE2.width / 2, hE2.y + hE2.height / 2); await page.mouse.down(); await page.mouse.move(hE2.x + hE2.width / 2 + oneCol * 1.15, hE2.y + hE2.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
    let sp1 = await spreadInfo();
    assert.equal(sp1.spec.mode, 'spread', 'taşan grup: kartları yay');
    assert.ok(sp1.main > sp0.main && Math.abs(sp1.cw - sp1.g) < sp1.g * 0.35 && sp1.total === sp0.total, 'kart ölçüsü korunarak taşan kartlar alana katıldı: ' + JSON.stringify({ sp0, sp1 }));
    assert.equal(await clean(), 0);
    assert.ok(await page.$eval('.psFloat', el => !el.hidden && Boolean(el.querySelector('[data-fa-mode="spread"][aria-pressed="true"]'))), 'araç çubuğu: Kartları yay seçili');
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `group-area-spread-${THEME}.png`) });
    // Başka bir grup bu alanın üstüne taşınır: bırakılan grup yerini alır, öteki alan biçimini koruyarak yer değiştirir.
    const other = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.res.pages[0].items.find(i => i.kind === 'hdr' && !i.area && !i.pinOf); return h && h.key; });
    if (other) {
      const before = await page.evaluate(k => { const S = BLPresentationStudio._state(), all = S.res.pages.flatMap((p, i) => p.items.map(it => ({ ...it, pi: i }))), a = all.find(i => i.kind === 'area' && i.key === k && !i.cont); return { w: a.w, h: a.h, n: all.filter(i => i.kind === 'card' && i.area === k && i.pi === a.pi && i.y >= a.y && i.y < a.y + a.h).length }; }, areaKey);
      const oh = await page.$eval(`.psPageWrap .psDocHdr[data-hdr="${other.replace(/"/g, '\\"')}"]:not([data-area-hdr])`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
      const tgt = await page.$eval(`.psArea[data-area="${areaKey.replace(/"/g, '\\"')}"]:not(.isCont)`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 14, y: r.y + 8 }; });
      await page.mouse.move(oh.x, oh.y); await page.mouse.down(); await page.mouse.move(oh.x + 10, oh.y + 10, { steps: 3 });
      await page.mouse.move(tgt.x, tgt.y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(400);
      const after = await page.evaluate(k => { const S = BLPresentationStudio._state(), all = S.res.pages.flatMap((p, i) => p.items.map(it => ({ ...it, pi: i }))), a = all.find(i => i.kind === 'area' && i.key === k && !i.cont); return { w: a.w, h: a.h, n: all.filter(i => i.kind === 'card' && i.area === k && i.pi === a.pi && i.y >= a.y && i.y < a.y + a.h).length }; }, areaKey);
      assert.ok(Math.abs(after.w - before.w) < 0.5 && Math.abs(after.h - before.h) < 0.5 && after.n === before.n, 'öteki alan biçimini korudu: ' + JSON.stringify({ before, after }));
      assert.ok(await page.evaluate(k => Boolean(BLPresentationStudio._state().doc.areas[k]), other), 'taşınan grup kendi alanında');
      assert.equal(await clean(), 0);
      await page.screenshot({ path: path.join(OUT, `group-area-move-${THEME}.png`) });
      await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
      assert.equal(await page.evaluate(k => Boolean(BLPresentationStudio._state().doc.areas[k]), other), false, 'tek adımda geri alınır');
    }
    // Seçili olmayan alan renklendirilmez (iş bitince gri zemin kalmaz). Esc seçimi kaldırır (editörü kapatmaz).
    await page.click(areaHdrSel); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().areaSel), areaKey);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    assert.equal(await page.$('.psDialog'), null, 'Esc yalnız seçimi kaldırır');
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().areaSel), null);
    assert.equal(await page.$eval('.psArea', el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'seçili olmayan alanın zemini yok');
    // Alanı olmayan gruba tıklama: seçim çerçevesi ve kenar tutamakları açılır; tutamaktan boyutlanınca grup alana alınır.
    const flowKey = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.res.pages[0].items.find(i => i.kind === 'hdr' && !i.area && !i.pinOf); return h && h.key; });
    if (flowKey) {
      const fh = await page.$eval(`.psPageWrap .psDocHdr[data-hdr="${flowKey.replace(/"/g, '\\"')}"]:not([data-area-hdr])`, el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
      await page.mouse.click(fh.x, fh.y); await page.waitForTimeout(250);
      assert.equal(await page.$$eval('.psArea.isVirtual .psHandle[data-ah]', els => els.length), 4, 'tıklayınca kenar tutamakları');
      assert.ok(await page.$eval('.psFloat', el => !el.hidden), 'grup bilgisi');
      const vh = await (await page.$('.psArea.isVirtual .psHandle[data-ah="s"]')).boundingBox();
      await page.mouse.move(vh.x + vh.width / 2, vh.y + vh.height / 2); await page.mouse.down(); await page.mouse.move(vh.x + vh.width / 2, vh.y + vh.height / 2 + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(400);
      assert.ok(await page.evaluate(k => { const S = BLPresentationStudio._state(); return Boolean(S.doc.areas[k] && S.doc.areas[k].h > 0) && S.areaSel === k && !S.frame; }, flowKey), 'boyutlanan grup alana alındı');
      assert.equal(await clean(), 0);
      await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    }
    // Yeniden adlandırma uygulama içi pencerede (masaüstünde window.prompt yok).
    const rh = await page.$eval('.psPageWrap .psDocHdr', el => { const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2, key: el.dataset.hdr }; });
    await page.mouse.dblclick(rh.x, rh.y); await page.waitForTimeout(250);
    assert.ok(await page.$('.psDialog [data-ps="rename"]'), 'yeniden adlandırma penceresi');
    await page.fill('.psDialog [data-ps="rename"]', 'Sunum Başlığı'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(k => BLPresentationStudio._state().doc.labels[k], rh.key), 'Sunum Başlığı');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
    await page.click(areaHdrSel); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = ''; }));
    // PDF/PPTX çerçevesiz; Koleksiyon verisi değişmez.
    assert.equal(await page.evaluate(() => { const S = BLPresentationStudio._state(); return BLPresentationRender.documentHtml(S.list, 't').includes('psArea'); }), false);
    assert.equal(await page.evaluate(() => { const before = JSON.parse(window.__psBefore); return kolRows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i])).length; }), 0, 'Koleksiyon verisi değişmez');
    // Akışa döndür.
    await page.click('.psFloat [data-fa-area="out"]'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(k => Boolean(BLPresentationStudio._state().doc.areas[k]), areaKey), false);
    assert.equal(await page.evaluate(k => BLPresentationStudio._state().res.pages.flatMap(p => p.items).filter(i => i.kind === 'area' && i.key === k).length, areaKey), 0, 'bu grubun alanı kalktı (ayrılan kartın alanı kalır)');
    assert.equal(await clean(), 0);

    // Başlıkta her gruplama seviyesi ayrı satırda; başlık yazı boyutu kart yazısından ayrı.
    const hl = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.list.pages[0].elements.find(e => e.type === 'hdr' && !e.pins && S.doc.grouping.levels.length >= 2); return h ? { n: h.lines.length, first: h.lines[0].atoms.filter(a => a.type === 'text').map(a => a.t).join(' '), lh: h.lh, size: h.size } : null; });
    assert.ok(hl && hl.n >= 2, 'iki seviye iki satır: ' + JSON.stringify(hl));
    await page.click('.psStudio [data-pop="design"]');
    await page.$eval('.psPop [data-s="hfs"]', el => { el.value = 14; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const hs = await page.evaluate(() => { const S = BLPresentationStudio._state(); const h = S.list.pages[0].elements.find(e => e.type === 'hdr'); return { hfs: S.doc.style.hfs, fs: S.doc.style.fs, size: h.size }; });
    assert.ok(hs.hfs === 14 && Math.abs(hs.size - 14) < 0.01 && hs.fs === 8, 'başlık 14 pt, kart 8 pt: ' + JSON.stringify(hs));
    // Başlık boyutu değişince satır planı yeniden ölçülür: hiçbir başlık "…" ile kesilmez.
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().list.pages.flatMap(p => p.elements).filter(e => e.type === 'hdr').some(e => e.lines.some(l => l.atoms.some(a => /…$/.test(a.t || '') || (a.segs || []).some(sg => /…$/.test(sg.t)))))), false, 'başlık boyutu değişince kesilme yok');
    assert.equal(await clean(), 0);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `header-lines-${THEME}.png`) });
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = ''; }));

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
    // Çip görünümü: Kumaş ve Artwork Detail kartta ve grup başlığında tablodaki gibi; üst çubukta Çip/Metin.
    await page.evaluate(() => BLPresentationStudio.close());
    await page.evaluate(() => {
      // Bellekte (kaydedilmez): PLM biçimli kumaş değerleri + kumaş kartları. Artwork BOM önbelleği modülün içinde
      // olduğundan yapısal model burada taklit edilir (gerçek model birim testte modülle sınanır).
      const cards = { 214233: 'Three Thread Brushed · 30/70/14 · 260 gsm · 65% Cotton 35% Poliester', 300100: 'Single Jersey · 30/1 · 150 gsm · 100% Cotton' };
      for (const [code, summary] of Object.entries(cards)) kolFabricCards.set(code, { code, summary, summaryEn: summary });
      kolFabricCardsState = 'ready'; // sunucudan eşzamansız yükleme test kartlarını sonradan değiştirmesin (CP/Orders karşılaştırması)
      // Artwork: elle girilmiş değer (PLM değerinden farklı) korunur; PLM'e ait boş değeri modül temizler.
      kolRows.forEach((r, i) => { r.fabric = i % 3 === 0 ? 'A - 214233-THREE THREAD / B - 300100-SINGLE JERSEY' : i % 3 === 1 ? '214233-THREE THREAD BRUSHED' : '300100-SINGLE JERSEY'; r.artworkDetail = 'Front: 1 | Pigment'; r.artworkDetailPlm = 'plm'; });
      window.__artModel = BLCollectionArtworkDetail.cellModel;
      BLCollectionArtworkDetail.cellModel = row => [{ label: '', items: [{ kind: 'chip', t: 'Front', sub: '1' }, { kind: 'tag', t: 'Pigment', tone: '1' }], total: '1' }];
      kolHiddenCols.delete('artworkDetail'); // Stüdyo görünür sütunları okur; demo görünümünde Artwork Detail gizli
      renderKol();
    });
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 });
    await page.click('.psStudio [data-pop="level"]'); await page.fill('.psPop [data-ps="search"]', 'fabric'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    await page.click('.psStudio [data-rmlv="0"]'); await page.waitForTimeout(200);
    await page.click('.psStudio [data-pop="fields"]');
    const ids = await page.evaluate(() => BLPresentationStudio._state().meta.ids);
    assert.ok(ids.includes('col.artworkDetail'), 'Artwork Detail alanı: ' + ids.join(','));
    for (const f of ['col.fabric', 'col.artworkDetail']) if (!(await page.$eval(`.psPop [data-fc="${f}"]`, el => el.checked))) { await page.click(`.psPop [data-fc="${f}"]`); await page.waitForTimeout(150); }
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.equal(await page.$('.psPop:not([hidden])'), null, 'kart bilgisi işaretlendikten sonra Escape paneli kapatır');
    assert.deepEqual(await page.evaluate(() => BLPresentationStudio._state().doc.grouping.levels), ['col.fabric']);
    assert.equal(await page.$eval('.psStudio [data-ps="chipModeWrap"]', el => el.hidden), false, 'Çip/Metin seçeneği görünür');
    const chipState = () => page.evaluate(() => { const S = BLPresentationStudio._state(), els = S.list.pages.flatMap(p => p.elements); const atoms = els.flatMap(e => e.lines.filter(l => l.atoms).flatMap(l => l.atoms)); return { cardChips: els.filter(e => e.type === 'card').some(e => e.lines.some(l => l.atoms && l.atoms.some(a => a.type === 'chip' && a.segs[0].t === '214233'))), hdrChips: els.filter(e => e.type === 'hdr').some(e => e.lines.some(l => l.atoms && l.atoms.some(a => a.type === 'chip'))), art: atoms.some(a => a.type === 'chip' && a.segs.some(s => s.t === 'Pigment')), parts: atoms.filter(a => a.type === 'part').map(a => a.t), dom: document.querySelector('.psPageWrap .psPage').innerHTML.includes('214233') }; });
    let cs = await chipState();
    assert.ok(cs.cardChips && cs.hdrChips && cs.art && cs.dom, 'kartta, başlıkta ve artwork alanında çip: ' + JSON.stringify(cs));
    assert.ok(cs.parts.includes('A') && cs.parts.includes('B'), 'takım kumaşında A/B parça harfi');
    assert.equal(await clean(), 0);
    // Kumaş kodu gizli: üstte kumaş adı, altta karışım | gramaj (yatayda daha az yer).
    assert.equal(await page.$eval('.psStudio [data-ps="fabricCodeWrap"]', el => el.hidden), false, 'Kumaş kodu seçeneği görünür');
    await page.click('.psStudio [data-ps="fabricCode"]'); await page.waitForTimeout(300);
    const noCode = await page.evaluate(() => { const S = BLPresentationStudio._state(); const card = S.list.pages[0].elements.find(e => e.type === 'card' && e.lines.some(l => l.atoms)); const rows = card.lines.filter(l => l.atoms).map(l => l.atoms.filter(a => a.type === 'chip').map(a => a.segs.map(s => s.t).join('|'))); return { off: S.doc.style.fabricCode === false, code: S.list.pages[0].elements.some(e => e.lines.some(l => l.atoms && l.atoms.some(a => a.type === 'chip' && /^(214233|300100)$/.test(a.segs[0].t)))), rows }; });
    assert.ok(noCode.off && !noCode.code, 'kumaş kodu gizli: ' + JSON.stringify(noCode));
    const rowOf = re => noCode.rows.findIndex(r => r.some(c => re.test(c)));
    assert.ok(rowOf(/^Three Thread Brushed$/) >= 0 && rowOf(/^65% /) > rowOf(/^Three Thread Brushed$/) && rowOf(/^260 gsm$/) >= rowOf(/^65% /), 'üstte ad, altta karışım ve gramaj (tam metin): ' + JSON.stringify(noCode.rows));
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `chips-nocode-${THEME}.png`) });
    await page.click('.psStudio [data-ps="fabricCode"]'); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().doc.style.fabricCode), true);
    // Sürüm notu görseli: kartlar biraz genişletilir (Tasarım › Kart boyutu) ki çipler okunsun.
    await page.click('.psStudio [data-pop="design"]');
    await page.$eval('.psPop [data-s="cardW"]', el => { el.value = 150; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.keyboard.press('Escape'); await page.click('.psStudio .psCanvas', { position: { x: 10, y: 10 } }); await page.waitForTimeout(400);
    assert.equal(await clean(), 0);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `chips-${THEME}.png`) });
    await page.click('.psStudio [data-ps="chipMode"] [data-v="text"]'); await page.waitForTimeout(300);
    cs = await chipState();
    assert.ok(!cs.cardChips && !cs.hdrChips && !cs.art, 'Metin seçeneğinde çip yok');
    assert.equal(await page.evaluate(() => BLPresentationStudio._state().doc.style.chips), false);
    await page.click('.psStudio [data-ps="chipMode"] [data-v="chips"]'); await page.waitForTimeout(300);
    assert.ok((await chipState()).cardChips);
    // PPTX ve PDF belgesi aynı çipleri taşır.
    const out = await page.evaluate(async () => { const S = BLPresentationStudio._state(), list = S.list; const html = BLPresentationRender.documentHtml(list, 't'); const zip = BLPresentationPptx.build(JSZip, list, { title: 't', palette: BLPresentationRender.DOC, chip: BLPresentationRender.CHIP }); const x = await zip.file('ppt/slides/slide1.xml').async('string'); return { html: html.includes('214233') && html.includes('Pigment'), pptx: x.includes('<a:t>214233</a:t>') && x.includes('Chip frame') }; });
    assert.deepEqual(out, { html: true, pptx: true });
    await page.evaluate(() => { BLCollectionArtworkDetail.cellModel = window.__artModel; });

    // Taslak: kaydet → kapat → tabloda model düzelt → Sunum Oluştur'dan taslağa devam: güncel bilgi, aynı düzen, aynı sayfa.
    await page.fill('.psStudio [data-ps="title"]', 'Demo taslak'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
    assert.match(await page.$eval('.psStatus', el => el.textContent), /kaydedilmedi|not saved/i, 'yeni sunum kaydedilmemiş görünür');
    await page.click('.psStudio [data-ps="saveDraft"]'); await page.waitForTimeout(300);
    assert.match(await page.$eval('.psStatus', el => el.textContent), /Taslak hesabınıza kaydedildi|Draft saved/);
    const pagesBefore = await page.evaluate(() => BLPresentationStudio._state().doc.pages.map(p => p.id));
    if (pagesBefore.length > 1) { await page.click(`.psStudio .psThumb[data-th="${pagesBefore[1]}"]`); await page.waitForTimeout(200); }
    await page.click('.psStudio [data-ps="zoomIn"]'); await page.waitForTimeout(1200);
    const saved = await page.evaluate(() => { const S = BLPresentationStudio._state(); return { id: S.deckId, page: S.activePage, zoom: S.zoom, levels: S.doc.grouping.levels, fields: S.doc.style.fields, chips: S.doc.style.chips, cardW: S.doc.style.cardW, order: S.doc.order.slice(0, 2) }; });
    await page.click('.psStudio [data-ps="close"]'); await page.waitForTimeout(300);
    assert.equal(await page.$('.psStudio'), null, 'kaydedilmiş taslak sorusuz kapanır');
    const edited = await page.evaluate(ids => { const out = []; for (const r of kolRows) if (ids.includes(String(r.id))) { r.colour = 'TASLAK GÜNCEL ' + r.id; out.push(r.colour); } renderKol(); return out; }, saved.order);
    assert.equal(edited.length, 2);
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psDialog [data-m^="d:"]', { timeout: 10000 });
    assert.ok(await page.$('.psDialog [data-m="new"]'), 'yeni sunum seçeneği');
    await page.click(`.psDialog [data-m="d:${saved.id}"]`);
    await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 }); await page.waitForTimeout(600);
    const back = await page.evaluate(() => { const S = BLPresentationStudio._state(); return { id: S.deckId, title: S.doc.title, page: S.activePage, zoom: S.zoom, levels: S.doc.grouping.levels, fields: S.doc.style.fields, chips: S.doc.style.chips, cardW: S.doc.style.cardW, colours: S.doc.order.slice(0, 2).map(id => S.models.get(id).values.colour), saved: S.saved, toast: [...document.querySelectorAll('[data-ui-feedback-region]')].map(e => e.textContent).join(' ') }; });
    assert.equal(back.id, saved.id); assert.equal(back.title, 'Demo taslak'); assert.equal(back.saved, true);
    assert.deepEqual([back.levels, back.fields, back.chips, back.cardW], [saved.levels, saved.fields, saved.chips, saved.cardW], 'düzen korunur');
    assert.equal(back.page, saved.page, 'kaldığı sayfa'); assert.ok(Math.abs(back.zoom - saved.zoom) < 0.001, 'kaldığı yakınlık');
    assert.deepEqual(back.colours, edited, 'tablodaki düzeltme taslağa yansır');
    assert.match(back.toast, /2 modelin bilgisi Koleksiyon tablosunda güncellenmiş|2 models were updated in Collection/, back.toast);
    await page.click('.psStudio [data-ps="close"]'); await page.waitForTimeout(300);
    // Kaydedilmemiş yeni sunumda değişiklik → kapatırken sorulur; "Kaydetmeden çık" taslak eklemez.
    const draftsBefore = await page.evaluate(() => JSON.parse(BLStorage.getItem('bl.presentationStudio.decks.v1') || '[]').length);
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psDialog [data-m="new"]', { timeout: 10000 }); await page.click('.psDialog [data-m="new"]');
    await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 }); await page.waitForTimeout(400);
    await page.click('.psStudio [data-ps="chipMode"] [data-v="text"]').catch(() => page.click('.psStudio [data-ps="zoomIn"]'));
    await page.fill('.psStudio [data-ps="title"]', 'Geçici'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
    await page.click('.psStudio [data-ps="close"]');
    await page.waitForSelector('.psDialog [data-m="discard"]', { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, `draft-confirm-${THEME}.png`) });
    await page.click('.psDialog [data-m="discard"]'); await page.waitForTimeout(300);
    assert.equal(await page.$('.psStudio'), null);
    assert.equal(await page.evaluate(() => JSON.parse(BLStorage.getItem('bl.presentationStudio.decks.v1') || '[]').length), draftsBefore, 'kaydedilmeyen sunum taslaklara eklenmez');
    // Taslak seçimi ekranı (sürüm notu görseli).
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psDialog [data-m^="d:"]', { timeout: 10000 }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: path.join(OUT, `draft-choose-${THEME}.png`) });
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = ''; }));
    await page.click('.psDialog [data-m="cancel"]'); await page.waitForTimeout(200);
    await page.click('#kolToolsBtn'); await page.click('#kolToolsMenu [data-output-studio="koleksiyon"]');
    await page.waitForSelector('.psDialog [data-m="new"]', { timeout: 10000 }); await page.click('.psDialog [data-m="new"]');
    await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 });
    await page.evaluate(() => document.querySelectorAll('[data-ui-feedback-region]').forEach(el => { el.style.visibility = ''; }));

    // CP ve Siparişler: aynı Presentation Studio (her kart bir sipariş satırı; filtrelenmiş kapsam).
    await page.evaluate(() => BLPresentationStudio.close());
    const sources = {};
    for (const [tab, btn, menu, name] of [['cp', '#cpToolsBtn', '#cpToolsMenu', 'CP'], ['orders', '#ordersToolsBtn', '#ordersToolsMenu', 'Siparişler']]) {
      await page.click(`button[data-tab="${tab}"]`);
      await page.waitForFunction(t => document.querySelector(`#view-${t}`)?.offsetParent && document.querySelectorAll(`#view-${t} table tbody tr`).length > 0, tab, { timeout: 60000 });
      await page.waitForTimeout(400);
      // Orders öncelik/izleme alanlarını eşzamansız bir iş toplu doldurur (Priority, _trackingTags…);
      // karşılaştırma için veri durulduktan sonra (art arda iki aynı anlık görüntü) alınır.
      const snap = () => page.evaluate(t => JSON.stringify(BLAIScreenData.table(t, { all: true }).rows), tab);
      let before = await snap();
      for (let k = 0; k < 40; k++) { await page.waitForTimeout(300); const next = await snap(); if (next === before) break; before = next; }
      await page.click(btn); await page.click(`${menu} [data-output-studio="${tab}"]`);
      await page.waitForSelector('.psStudio .psDocCard', { timeout: 30000 }); await page.waitForTimeout(400);
      const info = await page.evaluate(t => { const S = BLPresentationStudio._state(), rows = BLAIScreenData.table(t, { all: false }).rows.length; return { cards: S.res.index.size, rows, source: S.doc.source, status: document.querySelector('.psStatus').textContent }; }, tab);
      assert.equal(info.source, tab); assert.ok(info.cards > 0 && info.cards === info.rows, JSON.stringify(info)); assert.equal(await clean(), 0);
      assert.ok(info.status.includes(`${name} verisi değişmedi`), info.status);
      assert.ok(await page.$eval('.psPageWrap .psPageTools', el => { const r = el.getBoundingClientRect(); return r.height > 0 && document.elementFromPoint(r.x + 30, r.y + r.height / 2)?.closest('.psPageTools') === el; }), 'sayfa araç çubuğu görünür ve tıklanabilir');
      await page.screenshot({ path: path.join(OUT, `studio-${tab}-${THEME}.png`) });
      await page.evaluate(() => BLPresentationStudio.close());
      const afterRows = await page.evaluate(t => JSON.stringify(BLAIScreenData.table(t, { all: true }).rows), tab);
      if (afterRows !== before) {
        const A = JSON.parse(before), B = JSON.parse(afterRows), diff = [];
        B.forEach((r, i) => { const a0 = A[i] || {}; for (const k of new Set([...Object.keys(r), ...Object.keys(a0)])) if (JSON.stringify(r[k]) !== JSON.stringify(a0[k])) diff.push(`${i}.${k}: ${String(JSON.stringify(a0[k])).slice(0, 60)} → ${String(JSON.stringify(r[k])).slice(0, 60)}`); });
        assert.fail(`${tab} verisi değişmez: ${A.length}→${B.length} satır; ${diff.slice(0, 8).join(' | ')}`);
      }
      sources[tab] = info.cards;
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, sources, theme: THEME, out: OUT }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exit(1); });
