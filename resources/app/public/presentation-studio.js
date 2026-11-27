/* ===================================================================
   Presentation Studio — Koleksiyon, CP ve Siparişler kayıtlarından görsel sunum editörü.

   Belge (BLPresentationEngine) tek doğruluk kaynağıdır; sayfa üzerinde
   sürükleme, boyutlandırma, sabitleme ve hizalama yalnız belgeyi değiştirir.
   Kaynak tablo verisi salt okunurdur: kart taşıma/grup değişimi kaynak
   kayda yazılmaz. Önizleme, PDF ve PowerPoint aynı çizim listesinden
   (BLPresentationRender) üretilir.

   Kalıcılık: kullanıcının sunumları ve şablonları hesabına bağlı
   eşitlenen tercih deposundadır (BLStorage, "bl.presentationStudio.").
   Görünüm Manifest token/bileşenlerinden gelir; modül CSS'i yalnız yerleşimdir.
   =================================================================== */
(function (root) {
  'use strict';
  const doc_ = root.document;
  if (!doc_) return;
  const E = () => root.BLPresentationEngine, R = () => root.BLPresentationRender;
  const isEn = () => String(doc_.documentElement.lang || root.appLang || 'tr').toLowerCase().startsWith('en');
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PT_PX = 4 / 3;
  const KEY = { templates: 'bl.presentationStudio.templates.v1', decks: 'bl.presentationStudio.decks.v1', deck: id => `bl.presentationStudio.deck.${id}.v1` };
  const MAX_DECKS = 20, IMAGE_MAX_PX = 1000;
  const PAPER_LABEL = () => ({ A3: 'A3', A4: 'A4', A5: 'A5', '16:9': '16:9', '4:3': '4:3', square: L('Kare', 'Square'), custom: L('Özel ölçü', 'Custom size') });
  const ICON = {
    pin: '<path d="M12 17v5"/><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3z"/>', unpin: '<path d="M12 17v5"/><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3z"/><path d="M3 3l18 18"/>',
    left: '<path d="M4 3v18"/><path d="M7 6h11v4H7zM7 14h6v4H7z"/>', hcenter: '<path d="M12 3v18"/><path d="M6 6h12v4H6zM8 14h8v4H8z"/>', right: '<path d="M20 3v18"/><path d="M6 6h11v4H6zM11 14h6v4h-6z"/>',
    top: '<path d="M3 4h18"/><path d="M6 7h4v11H6zM14 7h4v6h-4z"/>', vcenter: '<path d="M3 12h18"/><path d="M6 6h4v12H6zM14 8h4v8h-4z"/>', bottom: '<path d="M3 20h18"/><path d="M6 6h4v11H6zM14 11h4v6h-4z"/>',
    hdist: '<path d="M3 8h4v8H3zM10 8h4v8h-4zM17 8h4v8h-4z"/>', vdist: '<path d="M8 3h8v4H8zM8 10h8v4H8zM8 17h8v4H8z"/>', size: '<path d="M3 3h8v8H3zM13 13h8v8h-8z"/><path d="M11 7h4v4"/>',
    flow: '<path d="M4 6h16M4 12h10M4 18h13"/>', landscape: '<path d="M3 7h18v10H3z"/>', portrait: '<path d="M7 3h10v18H7z"/>', move: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  const svg = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" aria-hidden="true">${ICON[name]}</svg>`;
  const sprite = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const toast = (message, kind) => { if (typeof root.showToast === 'function') root.showToast(message, kind ? { kind } : undefined); };
  const storage = () => { try { return root.BLStorage || root.localStorage; } catch (_) { return null; } };
  const readJson = (key, fallback) => { try { const v = storage()?.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };
  const writeJson = (key, value) => { try { storage()?.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } };
  const removeKey = key => { try { storage()?.removeItem(key); } catch (_) {} };

  let S = null; // açık oturum
  // Yalnız içerik değişince yazar: gereksiz DOM değişimi ve genel gözlemci işi oluşmaz.
  const setHtml = (el, html) => { if (el && el.__psHtml !== html) { el.innerHTML = html; el.__psHtml = html; } };

  /* ---------------- Veri kaynağı (Koleksiyon/CP/Siparişler, salt okunur) ---------------- */
  // Kaynak tablo → canonical modül, görünen ad ve varsayılanlar. CP/Siparişler'de her kart bir sipariş satırıdır.
  const SOURCES = Object.freeze({
    koleksiyon: { module: 'collection', name: () => L('Koleksiyon', 'Collection'), title: () => L('Koleksiyon sunumu', 'Collection presentation'), fields: ['modelName', 'plmId', 'colour', 'colourCode', 'collectionQuantity', 'fob'] },
    cp: { module: 'cp', name: () => 'CP', title: () => L('CP sunumu', 'CP presentation'), fields: ['modelName', 'plmId', 'orderCode', 'colour', 'orderQuantity', 'fob'] },
    orders: { module: 'orders', name: () => L('Siparişler', 'Orders'), title: () => L('Sipariş sunumu', 'Orders presentation'), fields: ['modelName', 'plmId', 'orderCode', 'colour', 'orderQuantity', 'fob'] },
  });
  const sourceOf = tab => SOURCES[tab] || SOURCES.koleksiyon;
  const sourceName = () => sourceOf(S && S.tab).name();
  function fieldMeta(built) {
    const C = root.BLCanonicalFields, labels = {};
    for (const col of built.source.columns || []) labels[col.id] = col.label;
    const label = id => (C && C.field && C.field(id) ? C.label(id, isEn() ? 'en' : 'tr') : labels[id] || id);
    const type = id => (C && C.field && C.field(id) ? C.field(id).type : 'text');
    return { ids: built.fields.slice(), label, type };
  }
  // Biçimlendiriciler dil başına bir kez kurulur (toLocaleString her çağrıda yenisini kurar; 2000 kartta pahalı).
  const formatters = {};
  const fmt = () => { const loc = isEn() ? 'en-GB' : 'tr-TR'; return formatters[loc] || (formatters[loc] = { num: new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }), date: new Intl.DateTimeFormat(loc) }); };
  function formatValue(type, value) {
    if (value == null || value === '') return '';
    if (type === 'number' && Number.isFinite(Number(value))) return fmt().num.format(Number(value));
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) { const d = new Date(String(value).slice(0, 10) + 'T00:00:00'); if (!Number.isNaN(d.getTime())) return fmt().date.format(d); }
    return String(value);
  }
  function readSource(rows, info, scope, tab) {
    const built = root.BLOutputSource.build({ module: sourceOf(tab).module, rows, rowId: info.rowId, readRow: info.canonicalRow || (row => row), columns: info.columns || [], scope, lang: isEn() ? 'en' : 'tr' });
    const meta = fieldMeta(built), models = new Map();
    built.items.forEach((item, i) => {
      const rec = built.records[item.image];
      let identity = null; try { identity = root.BLAIScreenData.rowImage(tab, rows[i]); } catch (_) { identity = null; }
      models.set(String(rec.id), Object.freeze({ id: String(rec.id), title: item.title, values: Object.freeze({ ...rec.values }), keys: Object.freeze({ ...rec.keys }), identity, row: rows[i] }));
    });
    return { models, meta, omitted: built.source.omittedColumns || [] };
  }
  const defaultFields = (ids, tab) => sourceOf(tab).fields.filter(id => ids.includes(id)).slice(0, 5);
  const defaultLevels = ids => ['productGroup'].filter(id => ids.includes(id));

  /* ---------------- Çip görünümü (Kumaş, Artwork Detail) ----------------
     Tablodaki kart hücresinin yapısal modeli BLCellChips'ten okunur; yalnız okuma,
     kaynak satır değişmez. Değeri kartı/önbelleği olmayan hücre metin kalır. */
  const columnId = key => 'col.' + String(key).replace(/[^\w.%-]/g, '_').slice(0, 56);
  function chipKinds(tab) {
    const cols = root.BLCellChips && root.BLCellChips.columns && root.BLCellChips.columns[tab], out = new Map();
    for (const [key, kind] of Object.entries(cols || {})) out.set(columnId(key), { kind, key });
    return out;
  }
  const chipField = f => Boolean(S && S.chipKinds && S.chipKinds.has(f));
  function chipModel(id, f) {
    if (!S.doc.style.chips || !chipField(f)) return null;
    const m = S.models.get(id), spec = S.chipKinds.get(f);
    if (!m || !m.row) return null;
    const lang = isEn() ? 'en' : 'tr', raw = String(m.row[spec.key] == null ? '' : m.row[spec.key]);
    if (!raw.trim()) return null;
    // Kumaş modeli yalnız değere, artwork modeli PLM kaydına bağlıdır.
    const key = `${spec.kind}\u0001${lang}\u0001${raw}\u0001${spec.kind === 'artwork' ? id : ''}\u0001${S.doc.style.fabricCode ? 1 : 0}`;
    if (S.chipCache.has(key)) return S.chipCache.get(key);
    let model = null;
    try { model = root.BLCellChips.model(spec.kind, m.row, spec.key); } catch (_) { model = null; }
    model = Array.isArray(model) && model.length ? model : null;
    if (model && spec.kind === 'fabric' && !S.doc.style.fabricCode) model = withoutFabricCode(model);
    S.chipCache.set(key, model);
    return model;
  }
  /* Kumaş kodu gizli: her parça iki satır — üstte kumaş adı (ve sürdürülebilirlik etiketi), altta
     karışım | gramaj. Yatayda daha az yer kaplar. Ham parçalar uygulama modelinden (fabric) gelir. */
  function withoutFabricCode(model) {
    if (!model.some(l => l.fabric)) return model;
    const out = [];
    for (const line of model) {
      const f = line.fabric;
      if (!f) continue;
      const top = [...(f.type ? [{ kind: 'chip', t: f.type }] : []), ...(f.eco ? [{ kind: 'tag', t: f.eco, tone: 'eco' }] : [])];
      // Gramaj ayrı küçük çip: dar kartta kısalmak yerine alt satıra geçer.
      const bottom = [...(f.mix ? [{ kind: 'chip', t: f.mix }] : []), ...(f.weight ? [{ kind: 'meta', t: f.weight }] : [])];
      if (top.length) out.push({ label: line.label, items: top });
      if (bottom.length) out.push({ label: top.length ? '' : line.label, items: bottom });
    }
    return out.length ? out : model;
  }
  const fabricInUse = () => Boolean(S && S.chipKinds && [...S.doc.style.fields, ...S.doc.grouping.levels].some(f => S.chipKinds.get(f)?.kind === 'fabric'));
  const chipsInUse = () => Boolean(S && S.chipKinds && S.chipKinds.size && [...S.doc.style.fields, ...S.doc.grouping.levels].some(chipField));

  /* ---------------- Oturum ve belge ---------------- */
  function groupOf(id) {
    const m = S.models.get(id), lv = S.doc.grouping.levels;
    if (!m) return { key: '', vals: [] };
    // Grup anahtarı yalnız seviyelere ve dile bağlı: önbellek relayout başında doğrulanır (groupCacheCheck).
    if (!S.groupCache || S.groupCacheLevels !== lv) groupCacheCheck();
    const hit = S.groupCache.get(id);
    if (hit) return hit;
    const g = groupOfRaw(m, lv);
    S.groupCache.set(id, g);
    return g;
  }
  function groupCacheCheck() {
    const ck = S.doc.grouping.levels.join('\u0001') + (isEn() ? 'e' : 't');
    if (S.groupCacheKey !== ck || !S.groupCache) { S.groupCacheKey = ck; S.groupCache = new Map(); }
    S.groupCacheLevels = S.doc.grouping.levels;
  }
  function groupOfRaw(m, lv) {
    const keys = lv.map(f => String(m.keys[f] == null ? '' : m.keys[f]));
    return { key: keys.join(E().SEP), vals: lv.map(f => formatValue(S.meta.type(f), m.values[f])) };
  }
  /* Metin planı yalnız alanlar, yazı, kart genişliği veya başlık adları değişince yeniden ölçülür. */
  function textPlan() {
    const st = S.doc.style, cellW = E().geometry(S.doc, null).cellW;
    const vkey = [st.fields.join(','), st.labels, st.chips, st.fabricCode, S.doc.grouping.levels.join(','), S.doc.order.length, isEn()].join('|');
    const key = [vkey, st.fs, st.hfs, st.font, cellW.toFixed(2), JSON.stringify(S.doc.labels)].join('|');
    if (S.plan) S.plan.approx = Boolean(S.slider);
    if (S.plan && S.planKey === key) return S.plan;
    // Kaydırıcı sürüklenirken önceki plan kullanılır (satır sayısı anlık olarak bir satır geride kalabilir); bırakınca kesin plan hesaplanır.
    if (S.plan && S.slider && S.planValuesKey === vkey) return S.plan;
    if (S.planValuesKey !== vkey) { const t0 = performance.now(); S.planValuesKey = vkey; S.planValues = R().distinctValues(S.doc, S.doc.order, renderSource(() => null)); S.perf.values = performance.now() - t0; }
    S.planKey = key;
    S.plan = R().textPlan(S.doc, cellW, S.doc.order, renderSource(() => null), { measure: S.measure, values: S.planValues });
    return S.plan;
  }
  function relayout() {
    const t = performance.now();
    groupCacheCheck();
    const plan = textPlan(); S.perf.plan = performance.now() - t;
    S.res = E().layout(S.doc, groupOf, plan);
    S.perf.layout = performance.now() - t;
    for (const id of [...S.sel]) if (!S.res.index.has(id)) S.sel.delete(id);
    if (!S.doc.pages.some(p => p.id === S.activePage)) S.activePage = S.doc.pages[0].id;
  }
  function renderSource(imageFor) {
    return {
      lines: id => { const m = S.models.get(id); return S.doc.style.fields.map(f => { const chips = chipModel(id, f); return chips ? { label: S.meta.label(f), value: formatValue(S.meta.type(f), m && m.values[f]), chips } : { label: S.meta.label(f), value: formatValue(S.meta.type(f), m && m.values[f]) }; }); },
      image: imageFor,
      header: it => {
        const custom = S.doc.labels[it.key];
        const out = { main: custom || it.vals[0] || '—', rest: custom ? '' : it.vals.slice(1).filter(Boolean).join(' · '), count: `${it.count} ${it.count === 1 ? L('model', 'model') : L('model', 'models')}${it.cont ? L(' · devam', ' · cont.') : ''}` };
        // Başlıkta her gruplama seviyesi ayrı satırda; Kumaş/Artwork seviyesi çip (takım parçaları A/B/C ayrı satır).
        const lv = S.doc.grouping.levels, rep = !custom && S.doc.style.chips && lv.some(chipField) ? groupRow(it.key) : null;
        out.parts = custom ? [{ text: custom }] : lv.map((f, j) => { const chips = rep && chipField(f) ? chipModel(rep, f) : null; return chips ? { chips } : { text: it.vals[j] || '' }; }).filter(p => p.chips || p.text);
        if (!out.parts.length) out.parts = [{ text: out.main }];
        return out;
      },
    };
  }
  /* Grubun temsilci kartı (başlık çipleri için): anahtar başına ilk kart, yerleşim başına bir kez. */
  function groupRow(key) {
    if (!S.groupRows || S.groupRowsFor !== S.res) {
      S.groupRows = new Map(); S.groupRowsFor = S.res;
      for (const id of S.doc.order) { const k = E().effectiveKey(S.doc, id, groupOf); if (!S.groupRows.has(k)) S.groupRows.set(k, id); }
    }
    return S.groupRows.get(key) || null;
  }
  function screenImage(id) {
    const m = S.models.get(id);
    if (!m || !m.identity || !m.identity.source) return null;
    const dims = S.dims.get(m.identity.source);
    return { src: m.identity.source, w: dims ? dims.w : 0, h: dims ? dims.h : 0 };
  }
  function commit(fn, { save = true } = {}) {
    pushHistory();
    fn();
    relayout(); render();
    if (save) scheduleSave();
  }
  function pushHistory() { S.hist.push(JSON.stringify(S.doc)); if (S.hist.length > 100) S.hist.shift(); S.fut = []; }
  function undo() { if (!S.hist.length) return; S.fut.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.hist.pop()); relayout(); render(); scheduleSave(); }
  function redo() { if (!S.fut.length) return; S.hist.push(JSON.stringify(S.doc)); S.doc = JSON.parse(S.fut.pop()); relayout(); render(); scheduleSave(); }

  /* ---------------- Kalıcılık (sunumlar, şablonlar) ---------------- */
  let saveTimer = 0;
  /* Taslaklar: yeni sunum yalnız "Taslağı kaydet" ile saklanır (açıp kapatmak listeyi doldurmaz);
     kaydedilmiş taslak her değişiklikte otomatik güncellenir. Taslak, kart başına kısa bir parmak izi
     (snap) ve son görünüm (sayfa, yakınlık) taşır: yeniden açılınca tablodaki güncel bilgiler okunur,
     değişen modeller bildirilir, kullanıcı kaldığı sayfadan devam eder. */
  function scheduleSave() { if (S && !S.saved) { S.dirty = true; renderStatus(); return; } clearTimeout(saveTimer); saveTimer = setTimeout(saveDeck, 900); }
  const fingerprint = m => { let h = 0x811c9dc5; const str = JSON.stringify(m.values); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  function saveDraft() {
    if (!S) return;
    const first = !S.saved;
    S.saved = true; S.dirty = false;
    clearTimeout(saveTimer); saveDeck();
    if (S.saveState === 'saved') toast(first ? L(`“${S.doc.title || L('Adsız sunum', 'Untitled presentation')}” taslak olarak kaydedildi. Taslaklar’dan kaldığınız yerden devam edebilirsiniz.`, `“${S.doc.title || 'Untitled presentation'}” was saved as a draft. Continue where you left off from Drafts.`) : L('Taslak kaydedildi.', 'Draft saved.'));
  }
  function saveDeck() {
    if (!S || !S.saved) return;
    const index = readJson(KEY.decks, []).filter(d => d && d.id !== S.deckId);
    const entry = { id: S.deckId, title: S.doc.title || L('Adsız sunum', 'Untitled presentation'), updatedAt: new Date().toISOString(), count: S.doc.order.length, source: S.tab, draft: true };
    index.unshift(entry);
    const removed = index.splice(MAX_DECKS);
    const snap = {};
    // Modeller oturum boyunca değişmez: parmak izi bir kez hesaplanır, otomatik kayıtta yeniden kullanılır.
    if (!S.fp) S.fp = new Map();
    for (const id of S.doc.order) { const m = S.models.get(id); if (!m) continue; if (!S.fp.has(id)) S.fp.set(id, fingerprint(m)); snap[id] = S.fp.get(id); }
    if (!writeJson(KEY.deck(S.deckId), { ...S.doc, snap, view: { page: S.activePage, zoom: S.zoom } })) { S.saveState = 'error'; renderStatus(); return; }
    writeJson(KEY.decks, index);
    for (const d of removed) removeKey(KEY.deck(d.id));
    if (removed.length) toast(L(`En fazla ${MAX_DECKS} sunum saklanır; en eski “${removed[0].title}” kaldırıldı.`, `Up to ${MAX_DECKS} presentations are kept; the oldest “${removed[0].title}” was removed.`));
    S.saveState = 'saved'; renderStatus();
  }
  const loadTemplates = () => readJson(KEY.templates, []).map(t => E().normalizeTemplate(t)).filter(Boolean);
  function builtinTemplates() {
    const f = S.meta.ids, pick = list => list.filter(id => f.includes(id));
    return [
      { name: L('Katalog', 'Catalogue'), hint: L('A4 yatay · ürün grubu', 'A4 landscape · product group'), page: { preset: 'A4', orient: 'landscape' }, style: { font: 'Arial', fs: 8, img: 1.05, cardW: 112, gap: 10, margin: 26, card: 'frame', fields: pick(['modelName', 'plmId', 'colour', 'collectionQuantity', 'fob']) }, grouping: { levels: pick(['productGroup']) } },
      { name: L('Vitrin', 'Showcase'), hint: L('16:9 · büyük görsel', '16:9 · large images'), page: { preset: '16:9', orient: 'landscape' }, style: { font: 'Georgia', fs: 10, img: 1.25, cardW: 190, gap: 18, margin: 36, card: 'plain', fields: pick(['modelName', 'colour']) }, grouping: { levels: pick(['productGroup']), breakTop: true } },
      { name: L('Yoğun liste', 'Dense list'), hint: L('A4 dikey · küçük kart', 'A4 portrait · small cards'), page: { preset: 'A4', orient: 'portrait' }, style: { font: 'Verdana', fs: 6.5, img: 0.95, cardW: 76, gap: 6, margin: 18, labels: true, card: 'frame', fields: pick(['plmId', 'colour', 'collectionQuantity', 'fob']) }, grouping: { levels: pick(['productGroup', 'category']) } },
    ];
  }

  /* ---------------- Açılış ---------------- */
  async function ensureScripts() {
    if ((!root.BLOutputSource || !root.BLPresentationEngine) && root.BLPerf) await root.BLPerf.ensureFeature('presentationStudio');
  }
  /* Kaynak tablodaki (Koleksiyon/CP/Siparişler) seçili, yoksa filtrelenmiş kayıtlarla yeni sunum. */
  async function openSelection(tab = 'koleksiyon', scope) {
    if (!SOURCES[tab]) throw Error(L('Bu sayfada sunum oluşturulamaz.', 'Presentations cannot be created on this page.'));
    await ensureScripts();
    let info = root.BLAIScreenData && root.BLAIScreenData.table(tab, { all: false });
    if (!info) throw Error(L('Bu kaynakta kullanılabilir kayıt yok.', 'This source has no available records.'));
    const selected = new Set((info.selectedIds || []).map(String));
    const mode = scope || (selected.size ? 'selected' : 'filtered');
    if (mode === 'selected') info = root.BLAIScreenData.table(tab, { all: true }) || info;
    const rows = mode === 'selected' ? info.rows.filter(row => selected.has(String(info.rowId(row)))) : info.rows;
    if (!rows.length) { toast(L('Önce modelleri seçin veya filtreyi değiştirin.', 'Select models first or change the filter.'), 'warning'); return; }
    if (rows.length > E().LIMITS.cards) { toast(L(`Bir sunumda en fazla ${E().LIMITS.cards.toLocaleString('tr-TR')} model kullanılabilir. Seçimi veya filtreyi daraltın.`, `A presentation supports up to ${E().LIMITS.cards.toLocaleString('en-GB')} models. Narrow the selection or filter.`), 'warning'); return; }
    const drafts = readJson(KEY.decks, []).filter(d => d && (d.source || 'koleksiyon') === tab).slice(0, 5);
    if (drafts.length && !scope) { chooseDraft(tab, drafts, rows.length, mode); return; }
    const src = readSource(rows, info, mode, tab), ids = [...src.models.keys()];
    const fields = defaultFields(src.meta.ids, tab), title = sourceOf(tab).title();
    const docModel = E().createDoc({ ids, fields: fields.length ? fields : src.meta.ids.slice(0, 4), levels: defaultLevels(src.meta.ids), title, source: tab });
    start({ ...src, doc: docModel, deckId: 'd' + Date.now().toString(36), scope: mode, tab, saved: false });
  }
  /* Aynı kaynağın taslağı varsa: yeni sunum ya da taslağa devam. */
  function chooseDraft(tab, drafts, n, mode) {
    const when = d => new Date(d.updatedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
    const newLabel = mode === 'selected' ? L(`Seçili ${n} modelle yeni sunum`, `New presentation with ${n} selected models`) : L(`Filtrelenmiş ${n} kayıtla yeni sunum`, `New presentation with ${n} filtered records`);
    dialog(`<h3 id="psDlgTitle">${esc(L('Sunum oluştur', 'Create presentation'))}</h3><p>${esc(L('Yeni bir sunum başlatın ya da kayıtlı bir taslaktan kaldığınız yerden devam edin. Taslaklar açılırken model bilgileri tablodan güncel okunur.', 'Start a new presentation or continue a saved draft where you left off. Model details are read fresh from the table when a draft opens.'))}</p>
      <div class="psOptions"><button type="button" class="tbtn" data-m="new"><b class="psOptTitle">${esc(newLabel)}</b><span class="psSub">${esc(L('Boş bir düzenle başlar; kaydetmek için Taslağı kaydet.', 'Starts with a fresh layout; use Save draft to keep it.'))}</span></button>
      ${drafts.map(d => `<button type="button" class="tbtn" data-m="d:${esc(d.id)}"><b class="psOptTitle">${esc(L('Taslağa devam et: ', 'Continue draft: '))}${esc(d.title)}</b><span class="psSub">${esc(L(`${d.count} kayıt · ${when(d)}`, `${d.count} records · ${when(d)}`))}</span></button>`).join('')}</div>
      <div class="modalFoot"><button type="button" class="tbtn" data-m="cancel">${esc(L('Vazgeç', 'Cancel'))}</button></div>`, choice => {
      if (choice === 'new') openSelection(tab, mode).catch(err => toast(err.message, 'error'));
      else if (choice && choice.startsWith('d:')) openDeck(choice.slice(2)).catch(err => toast(err.message, 'error'));
    });
  }
  async function openDeck(deckId) {
    await ensureScripts();
    const raw = readJson(KEY.deck(deckId), null);
    if (!raw) { toast(L('Sunum bulunamadı.', 'Presentation not found.'), 'error'); return; }
    const tab = SOURCES[raw.source] ? raw.source : 'koleksiyon', name = sourceOf(tab).name();
    const info = root.BLAIScreenData && root.BLAIScreenData.table(tab, { all: true });
    if (!info) throw Error(L(`${name} verisi okunamadı.`, `${name} data could not be read.`));
    const wanted = new Set((raw.order || []).map(String));
    const rows = info.rows.filter(row => wanted.has(String(info.rowId(row))));
    if (!rows.length) { toast(L(`Bu sunumdaki kayıtlar artık ${name} tablosunda yok.`, `The records in this presentation are no longer in ${name}.`), 'warning'); return; }
    const src = readSource(rows, info, 'saved', tab), ids = [...src.models.keys()];
    const docModel = E().normalizeDoc(raw, { ids: (raw.order || []).map(String).filter(id => src.models.has(id)), fields: src.meta.ids });
    const missing = wanted.size - ids.length;
    // Taslak kaydedildiğinden beri tabloda bilgisi değişen modeller (parmak izi karşılaştırması).
    const snap = raw.snap && typeof raw.snap === 'object' ? raw.snap : null;
    const changed = snap ? ids.filter(id => snap[id] && snap[id] !== fingerprint(src.models.get(id))).length : 0;
    start({ ...src, doc: docModel, deckId, scope: 'saved', tab, saved: true, view: raw.view });
    if (changed > 0) toast(L(`${changed} modelin bilgisi ${name} tablosunda güncellenmiş; taslak güncel bilgilerle açıldı.`, `${changed} models were updated in ${name}; the draft opened with the current details.`));
    if (missing > 0) toast(L(`${missing} kayıt ${name} tablosunda bulunamadı ve sunumdan çıkarıldı.`, `${missing} records were not found in ${name} and were removed from the presentation.`), 'warning');
  }

  function start(init) {
    close();
    S = { ...init, sel: new Set(), hist: [], fut: [], zoom: 1, activePage: 'p1', dims: new Map(), chipCache: new Map(), perf: { layout: 0, render: 0 }, saveState: '', pageHtml: new Map(), act: null, measure: R().canvasMeasure(doc_) };
    S.dataHash = hashModels(); S.chipKinds = chipKinds(S.tab);
    buildShell();
    relayout(); fitZoom();
    // Kaldığı yerden: son sayfa ve yakınlık.
    const view = init.view && typeof init.view === 'object' ? init.view : null;
    if (view && S.doc.pages.some(p => p.id === view.page)) S.activePage = view.page;
    if (view && Number.isFinite(Number(view.zoom))) S.zoom = clamp(Number(view.zoom), 0.25, 3);
    render();
    if (view && S.activePage !== S.doc.pages[0].id) S.host.querySelector(`.psPageWrap[data-ps-page="${CSS.escape(S.activePage)}"]`)?.scrollIntoView({ block: 'start' });
    if (S.saved) scheduleSave();
    root.BLMotionPlus?.play?.('overlay', S.shell);
  }
  function hashModels() {
    let h = 0x811c9dc5;
    const str = JSON.stringify([...S.models.values()].map(m => [m.id, m.values]));
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  /* Kaydedilmemiş yeni sunumda değişiklik varsa çıkmadan önce sorar. */
  function confirmLeave(next) {
    if (!S || S.saved || !S.dirty) { next(); return; }
    dialog(`<h3 id="psDlgTitle">${esc(L('Sunum taslak olarak kaydedilsin mi?', 'Save the presentation as a draft?'))}</h3><p>${esc(L('Kaydederseniz Sunum Oluştur’dan kaldığınız yerden devam edebilirsiniz; model bilgileri açılışta tablodan güncel okunur.', 'If you save it, you can continue where you left off from Create Presentation; model details are read fresh from the table when it opens.'))}</p>
      <div class="modalFoot"><button type="button" class="tbtn" data-m="cancel">${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn" data-m="discard">${esc(L('Kaydetmeden çık', 'Leave without saving'))}</button><button type="button" class="tbtn primary" data-m="save">${esc(L('Taslağı kaydet', 'Save draft'))}</button></div>`, choice => {
      if (choice === 'save') { saveDraft(); next(); } else if (choice === 'discard') next();
    });
  }
  function requestClose() { confirmLeave(close); }
  function close() {
    if (!S) return;
    clearTimeout(saveTimer); saveDeck();
    closePop();
    S.unbind?.();
    const host = S.host;
    root.BLLayerSystem?.closeDialog?.(host);
    host.remove();
    S = null;
  }

  /* ---------------- Kabuk ---------------- */
  function buildShell() {
    const host = doc_.createElement('div');
    host.className = 'psStudio'; host.dataset.uiMigrated = 'presentation-studio';
    // Stüdyo kendisi diyalogdur: içindeki her çizim, tüm belgeyi tarayan bulanıklık eşitlemesini tetiklemesin.
    host.setAttribute('data-blur-skip', '');
    host.innerHTML = `<div class="psShell" role="dialog" aria-modal="true" aria-labelledby="psTitleLabel">
      <header class="psHead"><span class="psBrand" id="psTitleLabel"></span><input class="psTitle" data-ps="title" maxlength="120">
        <button type="button" class="tbtn psIcon" data-ps="undo">${sprite('arrow-back-up')}</button><button type="button" class="tbtn psIcon" data-ps="redo">${sprite('arrow-forward-up')}</button>
        <span class="psGrow"></span>
        <span class="psZoom"><button type="button" class="tbtn psIcon" data-ps="zoomOut">−</button><output class="psNum" data-ps="zoomVal"></output><button type="button" class="tbtn psIcon" data-ps="zoomIn">+</button><button type="button" class="tbtn" data-ps="zoomFit"></button></span>
        <button type="button" class="tbtn" data-ps="saveDraft"></button><button type="button" class="tbtn" data-pop="decks"></button><button type="button" class="tbtn" data-pop="templates"></button>
        <button type="button" class="tbtn primary" data-pop="export"></button><button type="button" class="tbtn psIcon" data-ps="close">${sprite('x')}</button></header>
      <div class="psBar" role="toolbar">
        <span class="psLbl" data-l="group"></span><span class="psChips" data-ps="chips"></span><label class="psToggle" data-ps="brkWrap"><input type="checkbox" data-ps="brk"><span data-l="brk"></span></label>
        <span class="psSep"></span><span class="psLbl" data-l="page"></span><select data-ps="paper"></select>
        <span class="psSeg" data-ps="orient"><button type="button" data-o="landscape">${svg('landscape')}</button><button type="button" data-o="portrait">${svg('portrait')}</button></span>
        <span class="psCustom" data-ps="custom" hidden><input type="number" data-ps="cw" min="50" max="1200" step="1">×<input type="number" data-ps="ch" min="50" max="1200" step="1"><span>mm</span></span>
        <span class="psDim" data-ps="dim"></span><span class="psSep"></span>
        <button type="button" class="tbtn" data-pop="fields"></button><button type="button" class="tbtn" data-pop="design"></button><button type="button" class="tbtn" data-pop="arrange"></button>
        <span class="psChipMode" data-ps="chipModeWrap" hidden><span class="psSep"></span><span class="psLbl" data-l="chipMode"></span><span class="psSeg" data-ps="chipMode"><button type="button" data-v="chips"></button><button type="button" data-v="text"></button></span><label class="psToggle" data-ps="fabricCodeWrap"><input type="checkbox" data-ps="fabricCode"><span data-l="fabricCode"></span></label></span>
      </div>
      <div class="psBody"><aside class="psRail"><div class="psRailHead"><span data-l="pages"></span><button type="button" class="tbtn psIcon" data-ps="addPage">${sprite('plus')}</button></div><div class="psThumbs" data-ps="thumbs" data-no-i18n></div><div class="psTray" data-ps="tray"></div></aside>
        <div class="psCanvas" data-ps="canvas"><div class="psPages" data-ps="pages" data-no-i18n></div></div></div>
      <footer class="psStatus" data-ps="status" role="status"></footer>
      <div class="psFloat" data-ps="float" hidden></div><div class="psPop" data-ps="pop" hidden></div>
      <div class="psDragLayer" data-ps="drag"></div><div class="psTip" data-ps="tip" hidden></div>
    </div>`;
    doc_.body.appendChild(host);
    S.host = host; S.shell = host.firstElementChild;
    const $ = sel => host.querySelector(sel);
    S.$ = $;
    root.BLLayerSystem?.openDialog?.(host, { onClose: requestClose });
    bindShell();
    localize();
  }
  function localize() {
    if (!S) return;
    const $ = S.$, t = (sel, text, title) => { const el = $(sel); if (!el) return; el.textContent = text; if (title) el.title = title; };
    S.shell.setAttribute('aria-label', L('Sunum stüdyosu', 'Presentation studio'));
    t('#psTitleLabel', L('Sunum stüdyosu', 'Presentation studio'));
    $('[data-ps="title"]').setAttribute('aria-label', L('Sunum başlığı', 'Presentation title'));
    const label = (sel, text) => { const el = $(sel); el.title = text; el.setAttribute('aria-label', text); };
    label('[data-ps="undo"]', L('Geri al (Ctrl+Z)', 'Undo (Ctrl+Z)')); label('[data-ps="redo"]', L('İleri al (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)'));
    label('[data-ps="zoomOut"]', L('Uzaklaştır', 'Zoom out')); label('[data-ps="zoomIn"]', L('Yakınlaştır', 'Zoom in')); label('[data-ps="close"]', L('Kapat', 'Close'));
    label('[data-ps="addPage"]', L('Serbest sayfa ekle', 'Add free page'));
    t('[data-ps="zoomFit"]', L('Sığdır', 'Fit'));
    $('[data-pop="decks"]').innerHTML = `${sprite('folder')}<span>${esc(L('Taslaklar', 'Drafts'))}</span>`;
    $('[data-ps="saveDraft"]').innerHTML = `${sprite('device-floppy')}<span>${esc(L('Taslağı kaydet', 'Save draft'))}</span>`;
    $('[data-ps="saveDraft"]').title = L('Sunumu taslak olarak kaydeder; sonra Sunum Oluştur’dan kaldığınız yerden devam edersiniz', 'Saves the presentation as a draft; later continue where you left off from Create Presentation');
    $('[data-pop="templates"]').innerHTML = `${sprite('layout-dashboard')}<span>${esc(L('Şablonlar', 'Templates'))}</span>`;
    $('[data-pop="export"]').innerHTML = `${sprite('file-export')}<span>${esc(L('Dışa aktar', 'Export'))}</span>`;
    $('[data-pop="fields"]').innerHTML = `${sprite('columns-3')}<span>${esc(L('Kart bilgileri', 'Card details'))}</span>`;
    $('[data-pop="design"]').innerHTML = `${sprite('palette')}<span>${esc(L('Tasarım', 'Design'))}</span>`;
    $('[data-pop="arrange"]').innerHTML = `${sprite('layout-align-top')}<span>${esc(L('Yeniden düzenle', 'Rearrange'))}</span>`;
    $('[data-ps="chipMode"] [data-v="chips"]').textContent = L('Çip', 'Chips'); $('[data-ps="chipMode"] [data-v="text"]').textContent = L('Metin', 'Text');
    $('[data-ps="fabricCodeWrap"]').title = L('Kapalıyken kumaş çipinde kod gösterilmez: üstte kumaş adı, altta karışım ve gramaj', 'When off, fabric chips hide the code: fabric name on top, composition and weight below');
    $('[data-ps="chipModeWrap"]').title = L('Kumaş ve Artwork Detail kartlarda ve grup başlıklarında tablodaki gibi çip ya da düz metin olarak gösterilir', 'Fabric and Artwork Detail appear on cards and group titles as chips, like in the table, or as plain text');
    for (const [key, tr, en] of [['group', 'Grupla', 'Group by'], ['brk', 'Yeni sayfa', 'New page'], ['page', 'Sayfa', 'Page'], ['pages', 'Sayfalar', 'Pages'], ['chipMode', 'Kumaş/Artwork', 'Fabric/Artwork'], ['fabricCode', 'Kumaş kodu', 'Fabric code']]) S.host.querySelectorAll(`[data-l="${key}"]`).forEach(el => { el.textContent = L(tr, en); });
    $('[data-ps="brkWrap"]').title = L('Her ana grup yeni bir sayfadan başlar', 'Each top-level group starts on a new page');
    $('[data-o="landscape"]').title = L('Yatay', 'Landscape'); $('[data-o="landscape"]').setAttribute('aria-label', L('Yatay', 'Landscape'));
    $('[data-o="portrait"]').title = L('Dikey', 'Portrait'); $('[data-o="portrait"]').setAttribute('aria-label', L('Dikey', 'Portrait'));
    $('[data-ps="cw"]').setAttribute('aria-label', L('Genişlik (mm)', 'Width (mm)')); $('[data-ps="ch"]').setAttribute('aria-label', L('Yükseklik (mm)', 'Height (mm)'));
    $('[data-ps="paper"]').setAttribute('aria-label', L('Sayfa ölçüsü', 'Page size'));
    $('[data-ps="paper"]').innerHTML = Object.entries(PAPER_LABEL()).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  }

  /* ---------------- Çizim ---------------- */
  function editorAttrs(el) {
    if (el.type === 'area') {
      const on = S.areaSel === el.key;
      return { attr: ` data-area="${esc(el.key)}" title="${esc(L('Grup alanı · tıklayın: seçin ve kenarlardan boyutlandırın · sürükleyin: taşıyın', 'Group area · click to select and resize from the edges · drag to move'))}"`, cls: (on ? ' isSel' : '') + (el.cont ? ' isCont' : ''), inner: on && !el.cont ? AREA_HANDLES.map(d => `<span class="psHandle" data-h="${d}" data-ah="${d}"></span>`).join('') : '' };
    }
    if (el.type === 'hdr') return { attr: ` data-hdr="${esc(el.key)}"${el.area ? ` data-area-hdr="${esc(el.key)}"` : ''}${!el.area && el.pins ? ` data-pins="${esc(el.pins.join('\u001f'))}"` : ''} title="${esc(el.area ? L('Tıklayın: grup alanını seçin · sürükleyin: taşıyın · çift tıklayın: yeniden adlandırın', 'Click to select the group area · drag to move · double-click to rename') : L('Tıklayın: grubu seçip kenarlardan boyutlandırın · sürükleyin: grubu taşıyın · çift tıklayın: yeniden adlandırın', 'Click to select the group and resize from the edges · drag to move the group · double-click to rename'))}"`, cls: '', inner: '' };
    const c = S.doc.cards[el.id] || {}, sel = S.sel.has(el.id), primary = sel && S.primary === el.id;
    const cls = (sel ? ' isSel' : '') + (S.res.conflicts.has(el.id) ? ' isConflict' : '') + (el.pinned ? ' isPinned' : '');
    let inner = '';
    if (el.pinned) inner += `<span class="psBadge psPin" title="${esc(L('Sabit', 'Pinned'))}">${svg('pin')}</span>`;
    if (c.vgroup != null) inner += `<span class="psBadge psMoved" title="${esc(L(`Görsel olarak başka gruba taşındı · ${sourceName()} verisi değişmedi`, `Moved to another group visually · ${sourceName()} data unchanged`))}">${svg('move')}</span>`;
    if (primary) inner += ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => `<span class="psHandle" data-h="${d}"></span>`).join('');
    const m = S.models.get(el.id);
    return { attr: ` data-id="${esc(el.id)}" tabindex="-1" role="button" aria-label="${esc((m ? m.title : el.id) + (sel ? L(' · seçili', ' · selected') : ''))}"`, cls, inner };
  }
  /* Henüz alanı olmayan grubun seçim çerçevesi (başlığa tıklanınca): kenar tutamaklarından boyutlanınca
     grup kendi alanına alınır. Çerçeve kartları örtmez (yalnız tutamaklar tıklanır). */
  const AREA_HANDLES = ['e', 's', 'se', 'w'];
  function frameHtml(f) {
    const r2 = v => Math.round(v * 100) / 100;
    return `<div class="psArea isSel isVirtual" data-area="${esc(f.key)}" data-virtual="1" style="position:absolute;left:${r2(f.x)}pt;top:${r2(f.y)}pt;width:${r2(f.w)}pt;height:${r2(f.h)}pt">${AREA_HANDLES.map(d => `<span class="psHandle" data-h="${d}" data-ah="${d}"></span>`).join('')}</div>`;
  }
  /* Akıştaki grubun (veya grubundan ayrılmış sabit kartların) bu sayfadaki kapladığı dikdörtgen. */
  function groupFrame(key, pageId, pins) {
    const parts = pageItems(pageId).filter(i => (i.kind === 'hdr' && i.key === key && !i.area && (pins ? i.pins && i.pins.some(p => pins.includes(p)) : !i.pinOf))
      || (i.kind === 'card' && !i.area && (pins ? pins.includes(i.id) : !i.pinned && E().effectiveKey(S.doc, i.id, groupOf) === key)));
    if (!parts.length) return null;
    const x = Math.min(...parts.map(i => i.x)), y = Math.min(...parts.map(i => i.y));
    return { key, page: pageId, pins: pins || null, x, y, w: Math.max(...parts.map(i => i.x + i.w)) - x, h: Math.max(...parts.map(i => i.y + i.h)) - y, n: parts.filter(i => i.kind === 'card').length };
  }
  const clearFrame = () => { S.areaSel = null; S.frame = null; };
  function render() {
    if (!S) return;
    const t = performance.now();
    renderPages();
    S.perf.render = performance.now() - t;
    // Küçük resimler her karede değil, değişiklik durduktan sonra güncellenir (slider sürüklemesi akıcı kalır).
    clearTimeout(S.thumbTimer); S.thumbTimer = setTimeout(() => { if (S) renderThumbs(); }, S.thumbHtml ? 220 : 0);
    renderTray(); renderBar(); renderStatus(); placeFloat();
    S.$('[data-ps="undo"]').disabled = !S.hist.length; S.$('[data-ps="redo"]').disabled = !S.fut.length;
    if (S.primary && S.sel.has(S.primary)) S.host.querySelector(`.psDocCard[data-id="${CSS.escape(S.primary)}"]`)?.focus({ preventScroll: true });
  }
  /* Sanallaştırma: yalnız görünür sayfalar (±1) çizilir; diğerleri doğru boyutta boş kâğıttır.
     Kaydırınca yeni görünen sayfa çizilir; yerleşim ve dışa aktarma bütün sayfaları kullanır. */
  function visibleRange(buffer = 1) {
    const g = S.res.g, canvas = S.$('[data-ps="canvas"]'), stride = g.h * S.zoom * PT_PX + 46;
    const first = Math.max(0, Math.floor((canvas.scrollTop - 8) / stride) - buffer), last = Math.ceil((canvas.scrollTop + canvas.clientHeight) / stride) - 1 + buffer;
    return [first, last];
  }
  /* Sürekli girişte (slider) yalnız görünen sayfalar çizilir; komşu tampon sayfalar sonraki boş karede
     tamamlanır. Böylece tek karedeki iş bölünür (DESIGN/PERFORMANCE: >50 ms bloklayan görev yok). */
  function renderPages() {
    const g = S.res.g, quick = Boolean(S.slider), [first, last] = visibleRange(quick ? 0 : 1), total = S.res.pages.length;
    clearTimeout(S.fillTimer);
    if (quick) S.fillTimer = setTimeout(() => { if (!S || S.act) return; const keep = S.slider; S.slider = false; renderPages(); S.slider = keep; }, 160);
    const live = S.res.pages.filter((p, i) => i >= first && i <= last);
    S.list = R().build(S.doc, { ...S.res, pages: live }, renderSource(screenImage), { measure: S.measure });
    const built = new Map(S.list.pages.map(p => [p.id, p]));
    S.range = `${first}:${last}`;
    const host = S.$('[data-ps="pages"]'), seen = new Set();
    const wrappers = new Map([...host.children].map(el => [el.dataset.psPage, el])), docPages = new Map(S.doc.pages.map(p => [p.id, p]));
    S.res.pages.forEach((rp, i) => {
      const page = built.get(rp.id) || { id: rp.id, elements: null };
      seen.add(page.id);
      // Hızlı modda (slider sürüklenirken) görünmeyen mevcut sayfalara dokunulmaz; tampon geçişi tamamlar.
      const existing = wrappers.get(page.id);
      if (quick && !page.elements && existing && host.children[i] === existing) return;
      const pg = docPages.get(page.id), toolKey = `${i}|${total}|${pg.flow}|${isEn()}`;
      const tools = S.toolsHtml && S.toolsHtml.get(page.id + '|' + toolKey) ||  `<span class="psPageNo">${esc(L(`Sayfa ${i + 1}`, `Page ${i + 1}`))}</span><button type="button" class="tbtn psFlow" data-pa="flow" aria-pressed="${pg.flow}" title="${esc(pg.flow ? L('Otomatik akış açık: boş alanlar kartlarla dolar', 'Automatic flow on: free space fills with cards') : L('Serbest sayfa: yalnız sabit kartlar', 'Free page: pinned cards only'))}">${svg('flow')}<span>${esc(pg.flow ? L('Otomatik akış', 'Automatic flow') : L('Serbest sayfa', 'Free page'))}</span></button><span class="psGrow"></span>`
        + `<button type="button" class="tbtn psIcon" data-pa="up" aria-label="${esc(L('Yukarı taşı', 'Move up'))}" title="${esc(L('Yukarı taşı', 'Move up'))}"${i === 0 ? ' disabled' : ''}>${sprite('chevron-up')}</button><button type="button" class="tbtn psIcon" data-pa="down" aria-label="${esc(L('Aşağı taşı', 'Move down'))}" title="${esc(L('Aşağı taşı', 'Move down'))}"${i === total - 1 ? ' disabled' : ''}>${sprite('chevron-down')}</button>`
        + `<button type="button" class="tbtn psIcon" data-pa="add" aria-label="${esc(L('Sonrasına serbest sayfa ekle', 'Add a free page after'))}" title="${esc(L('Sonrasına serbest sayfa ekle', 'Add a free page after'))}">${sprite('plus')}</button><button type="button" class="tbtn psIcon" data-pa="del" aria-label="${esc(L('Sayfayı sil', 'Delete page'))}" title="${esc(L('Sayfayı sil', 'Delete page'))}"${total < 2 ? ' disabled' : ''}>${sprite('trash')}</button>`;
      if (S.toolsHtml && S.toolsHtml.size > 2000) S.toolsHtml.clear();
      (S.toolsHtml || (S.toolsHtml = new Map())).set(page.id + '|' + toolKey, tools);
      const html = `<div class="psPageTools">${tools}</div><div class="psPage" style="width:${g.w}pt;height:${g.h}pt;transform:scale(${S.zoom});background:${R().DOC.paper};font-family:${esc(R().fontStack(S.doc.style.font))}">${page.elements ? R().elementsHtml(page, { attrs: editorAttrs, lite: quick }) : ''}${S.frame && S.frame.page === page.id ? frameHtml(S.frame) : ''}<div class="psGuides"></div></div>`;
      let w = wrappers.get(page.id);
      if (!w) { w = doc_.createElement('div'); w.className = 'psPageWrap'; w.dataset.psPage = page.id; }
      // Değişmeyen boyut/durum yeniden yazılmaz (her karede yüzlerce sayfada stil yeniden hesabını önler).
      const size = `${g.w * S.zoom}pt|${g.h * S.zoom}pt`;
      if (w.dataset.psSize !== size) { w.dataset.psSize = size; w.style.width = `${g.w * S.zoom}pt`; w.style.height = `${g.h * S.zoom}pt`; }
      const active = page.id === S.activePage;
      if (w.hasAttribute('data-active') !== active) w.toggleAttribute('data-active', active);
      if (S.pageHtml.get(page.id) !== html) { w.innerHTML = html; S.pageHtml.set(page.id, html); }
      if (host.children[i] !== w) host.insertBefore(w, host.children[i] || null);
    });
    for (const [id, el] of wrappers) if (!seen.has(id)) { el.remove(); S.pageHtml.delete(id); }
  }
  /* Küçük resimler sayfa başına önbelleklidir; yalnız değişen sayfanın düğmesi yeniden yazılır. */
  function renderThumbs() {
    const g = S.res.g, W = 132, H = W * g.h / g.w, pct = (v, t) => `${(v / t * 100).toFixed(2)}%`;
    const host = S.$('[data-ps="thumbs"]'), cache = S.thumbHtml || (S.thumbHtml = new Map()), seen = new Set();
    const nodes = new Map([...host.children].map(el => [el.dataset.th, el]));
    S.res.pages.forEach((p, i) => {
      const pg = S.doc.pages.find(x => x.id === p.id);
      const items = p.items.map(it => `<i class="${it.kind === 'area' ? 'psThumbArea' : it.kind === 'hdr' ? 'psThumbHdr' : it.pinned ? 'psThumbPin' : 'psThumbCard'}" style="left:${pct(it.x, g.w)};top:${pct(it.kind === 'hdr' ? it.y + it.h - 1 : it.y, g.h)};width:${pct(it.w, g.w)};height:${it.kind === 'hdr' ? '1px' : pct(it.h, g.h)}"></i>`).join('');
      const html = `<span class="psThumbPage" style="height:${H.toFixed(1)}px">${items}</span><span class="psThumbNo">${i + 1}${pg.flow ? '' : ` · ${esc(L('serbest', 'free'))}`}</span>`;
      let el = nodes.get(p.id);
      if (!el) { el = doc_.createElement('button'); el.type = 'button'; el.className = 'psThumb'; el.draggable = true; el.dataset.th = p.id; }
      el.setAttribute('aria-current', String(p.id === S.activePage)); el.setAttribute('aria-label', L(`Sayfa ${i + 1}`, `Page ${i + 1}`));
      if (cache.get(p.id) !== html) { el.innerHTML = html; cache.set(p.id, html); }
      if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
      seen.add(p.id);
    });
    for (const [id, el] of nodes) if (!seen.has(id)) { el.remove(); cache.delete(id); }
  }
  function renderTray() {
    const ex = S.doc.order.filter(id => S.doc.cards[id] && S.doc.cards[id].excluded);
    setHtml(S.$('[data-ps="tray"]'), ex.length ? `<div class="psRailHead"><span>${esc(L('Sunum dışı', 'Not in presentation'))}</span></div>${ex.map(id => `<div class="psTrayItem"><span title="${esc(S.models.get(id)?.title || id)}">${esc(S.models.get(id)?.title || id)}</span><button type="button" class="tbtn" data-back="${esc(id)}">${esc(L('Geri ekle', 'Add back'))}</button></div>`).join('')}` : '');
  }
  function renderBar() {
    const $ = S.$, d = S.doc, lv = d.grouping.levels, size = E().pageSize(d.page);
    if (doc_.activeElement !== $('[data-ps="title"]')) $('[data-ps="title"]').value = d.title;
    setHtml($('[data-ps="chips"]'), lv.map((f, i) => `<span class="psChip" draggable="true" data-lv="${i}" title="${esc(L('Sürükleyerek seviye sırasını değiştirin', 'Drag to reorder levels'))}"><b class="psChipNo">${i + 1}</b>${esc(S.meta.label(f))}<button type="button" class="psChipX" data-rmlv="${i}" aria-label="${esc(L(`${S.meta.label(f)} seviyesini kaldır`, `Remove ${S.meta.label(f)} level`))}">${sprite('x')}</button></span>`).join('')
      + (lv.length < E().LIMITS.levels ? `<button type="button" class="tbtn" data-pop="level">${sprite('plus')}<span>${esc(lv.length ? L('Seviye', 'Level') : L('Grup ekle', 'Add group'))}</span></button>` : ''));
    $('[data-ps="brk"]').checked = d.grouping.breakTop; $('[data-ps="brkWrap"]').hidden = !lv.length;
    $('[data-ps="paper"]').value = d.page.preset;
    $('[data-ps="custom"]').hidden = d.page.preset !== 'custom';
    $('[data-ps="cw"]').value = Math.round(size.mmW); $('[data-ps="ch"]').value = Math.round(size.mmH);
    const square = Math.abs(size.mmW - size.mmH) < 0.5;
    $('[data-ps="orient"]').querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', String(!square && b.dataset.o === (size.mmW >= size.mmH ? 'landscape' : 'portrait'))); b.disabled = square; });
    $('[data-ps="dim"]').textContent = `${Math.round(size.mmW)} × ${Math.round(size.mmH)} mm`;
    $('[data-ps="zoomVal"]').textContent = `${Math.round(S.zoom * 100)}%`;
    $('[data-ps="chipModeWrap"]').hidden = !chipsInUse();
    $('[data-ps="fabricCodeWrap"]').hidden = !d.style.chips || !fabricInUse();
    $('[data-ps="fabricCode"]').checked = d.style.fabricCode;
    $('[data-ps="chipMode"]').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'chips') === d.style.chips)));
  }
  function renderStatus() {
    if (!S || !S.res) return;
    const d = S.doc, cards = Object.values(d.cards), pinned = cards.filter(c => c.pinned && !c.excluded).length, moved = cards.filter(c => c.vgroup != null).length, ex = cards.filter(c => c.excluded).length;
    // Model kopyaları dondurulmuştur; özet en çok 3 sn'de bir yeniden doğrulanır (büyük seçimlerde her çizimde değil).
    if (!S.hashAt || performance.now() - S.hashAt > 3000) { S.hashSame = hashModels() === S.dataHash; S.hashAt = performance.now(); }
    const same = S.hashSame, n = S.res.index.size;
    const parts = [`<span>${esc(L(`${n} model · ${S.res.pages.length} sayfa · ${S.res.g.cols} sütun`, `${n} models · ${S.res.pages.length} pages · ${S.res.g.cols} columns`))}</span>`,
      `<span>${esc(L(`${pinned} sabit · ${moved} grup taşıma · ${ex} sunum dışı`, `${pinned} pinned · ${moved} group moves · ${ex} not in presentation`))}</span>`];
    if (S.res.conflicts.size) parts.push(`<span class="psBad">${esc(L(`${S.res.conflicts.size} kart çakışıyor`, `${S.res.conflicts.size} cards overlap`))} <button type="button" class="tbtn" data-ps="fixConf">${esc(L('Çöz', 'Resolve'))}</button></span>`);
    if (S.res.overflow) parts.push(`<span class="psBad">${esc(L('Bazı kartlar sayfaya sığmadı; kart boyutunu küçültün.', 'Some cards did not fit the page; reduce the card size.'))}</span>`);
    if (S.omitted && S.omitted.length) parts.push(`<span class="psBad" title="${esc(S.omitted.join(', '))}">${esc(L('Çok sayıda kayıt nedeniyle bazı sütunlar alınmadı', 'Some columns were skipped because of the record count'))}</span>`);
    parts.push('<span class="psGrow"></span>');
    parts.push(`<span title="${esc(L('Kart taşıma, gruplama ve sabitleme yalnız sunumu değiştirir', 'Moving, grouping and pinning cards only change the presentation'))}" class="${same ? 'psOk' : 'psBad'}">${esc(same ? L(`${sourceName()} verisi değişmedi`, `${sourceName()} data unchanged`) : L('Kaynak veri değişti', 'Source data changed'))}</span>`);
    parts.push(!S.saved ? `<span class="${S.dirty ? 'psBad' : ''}">${esc(S.dirty ? L('Taslak kaydedilmedi', 'Draft not saved') : L('Yeni sunum · kaydedilmedi', 'New presentation · not saved'))}</span>`
      : `<span>${esc(S.saveState === 'error' ? L('Kaydedilemedi', 'Not saved') : S.saveState === 'saved' ? L('Taslak hesabınıza kaydedildi', 'Draft saved to your account') : '')}</span>`);
    parts.push('<span class="psNum" data-ps="perf"></span>');
    const status = S.$('[data-ps="status"]');
    setHtml(status, parts.join(''));
    if (!S.exporting) status.querySelector('[data-ps="perf"]').textContent = L(`Yerleşim ${S.perf.layout.toFixed(0)} ms · çizim ${S.perf.render.toFixed(0)} ms`, `Layout ${S.perf.layout.toFixed(0)} ms · render ${S.perf.render.toFixed(0)} ms`);
  }
  function fitZoom() {
    const g = S.res.g, canvas = S.$('[data-ps="canvas"]');
    const w = Math.max(320, canvas.clientWidth - 64), h = Math.max(320, canvas.clientHeight - 72);
    S.zoom = clamp(Math.min(w / (g.w * PT_PX), h / (g.h * PT_PX)), 0.2, 2);
  }
  function setZoom(z) { S.zoom = clamp(z, 0.2, 3); S.pageHtml.clear(); render(); }

  /* ---------------- Seçim araç çubuğu ---------------- */
  function hideFloat() { const f = S && S.$('[data-ps="float"]'); if (f) f.hidden = true; }
  function placeFloat() {
    const f = S.$('[data-ps="float"]');
    if (!S.sel.size && S.areaSel && !S.act && placeAreaFloat(f)) return;
    if (!S.sel.size || S.act) { f.hidden = true; return; }
    const els = [...S.sel].map(id => S.host.querySelector(`.psDocCard[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
    if (!els.length) { f.hidden = true; return; }
    const ids = [...S.sel], n = ids.length, pinned = ids.map(id => S.res.index.get(id)?.pinned);
    const all = pinned.every(Boolean), any = pinned.some(Boolean);
    const btn = (k, icon, label, text) => `<button type="button" class="tbtn${text ? '' : ' psIcon'}" data-fa="${k}" title="${esc(label)}" aria-label="${esc(label)}">${icon}${text ? `<span>${esc(text)}</span>` : ''}</button>`;
    let html = n > 1 ? `<span class="psFloatInfo">${esc(L(`${n} kart`, `${n} cards`))}</span>` : '';
    html += all ? btn('unpin', svg('flow'), L('Sabitlemeyi kaldır: kart otomatik akışa döner (P)', 'Unpin: the card returns to automatic flow (P)'), L('Akışa döndür', 'Return to flow'))
      : btn('pin', svg('pin'), L('Bulunduğu yerde sabitle (P)', 'Pin in place (P)'), L('Sabitle', 'Pin'));
    if (any && !all) html += btn('unpin', svg('flow'), L('Sabitlemeyi kaldır', 'Unpin'), L('Akışa döndür', 'Return to flow'));
    if (n > 1) {
      html += '<span class="psSep"></span>' + [['left', L('Sola hizala', 'Align left')], ['hcenter', L('Yatay ortala', 'Center horizontally')], ['right', L('Sağa hizala', 'Align right')], ['top', L('Üste hizala', 'Align top')], ['vcenter', L('Dikey ortala', 'Center vertically')], ['bottom', L('Alta hizala', 'Align bottom')]].map(([k, l]) => btn(k, svg(k), l)).join('');
      if (n > 2) html += btn('hdist', svg('hdist'), L('Yatay eşit dağıt', 'Distribute horizontally')) + btn('vdist', svg('vdist'), L('Dikey eşit dağıt', 'Distribute vertically'));
      html += btn('size', svg('size'), L('İlk seçilen kartın boyutuna getir', 'Match the first selected card size'));
    }
    html += '<span class="psSep"></span>' + btn('exclude', sprite('trash'), L('Sunumdan çıkar (Delete) · veri silinmez', 'Remove from presentation (Delete) · data is not deleted'));
    if (n === 1) {
      const m = S.models.get(ids[0]), c = S.doc.cards[ids[0]] || {}, lv = S.doc.grouping.levels;
      const info = [m && m.title, ...lv.map(f => `${S.meta.label(f)}: ${formatValue(S.meta.type(f), m && m.values[f]) || '—'}`)].filter(Boolean).join(' · ');
      html += `<span class="psFloatInfo" title="${esc(info)}">${esc(info)}${c.vgroup != null ? esc(L(' · görsel grup değişti', ' · visual group changed')) : ''}</span>`;
    }
    f.innerHTML = html; f.hidden = false;
    const rs = els.map(e => e.getBoundingClientRect()), cr = S.$('[data-ps="canvas"]').getBoundingClientRect();
    const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom)), left = Math.min(...rs.map(r => r.left)), right = Math.max(...rs.map(r => r.right));
    if (bottom < cr.top || top > cr.bottom) { f.hidden = true; return; }
    const fr = f.getBoundingClientRect();
    f.style.left = `${clamp((left + right) / 2 - fr.width / 2, cr.left + 8, root.innerWidth - fr.width - 8)}px`;
    // Üstte yer yoksa seçimin altına iner; grup başlığını kapatmaz.
    const above = top - fr.height - 10, y = above >= cr.top + 6 ? above : bottom + 10;
    f.style.top = `${clamp(y, cr.top + 6, cr.bottom - fr.height - 6)}px`;
  }
  function selAction(k) {
    const ids = [...S.sel].filter(id => S.res.index.has(id));
    if (!ids.length) return;
    if (k === 'pin') return commit(() => ids.forEach(id => E().pinAt(S.doc, id, S.res.index.get(id))));
    if (k === 'unpin') return commit(() => E().unpin(S.doc, ids, S.res, groupOf));
    if (k === 'exclude') {
      commit(() => { for (const id of ids) { const c = S.doc.cards[id] || (S.doc.cards[id] = {}); c.excluded = true; c.pinned = false; } S.sel.clear(); });
      toast(L(`${ids.length} kart sunumdan çıkarıldı · ${sourceName()} verisi değişmedi.`, `${ids.length} cards removed from the presentation · ${sourceName()} data unchanged.`));
      return;
    }
    commit(() => { ids.forEach(id => { if (!S.res.index.get(id).pinned) E().pinAt(S.doc, id, S.res.index.get(id)); }); E().align(S.doc, ids, k); });
    if (S.res.conflicts.size) toast(L('Hizalama sonrası üst üste binen kartlar işaretlendi; alttaki “Çöz” ile aralayabilirsiniz.', 'Overlapping cards after alignment are marked; use “Resolve” below to separate them.'), 'warning');
  }

  /* ---------------- Sürükleme, boyutlandırma, alan seçimi ---------------- */
  const pageEl = id => S.host.querySelector(`.psPageWrap[data-ps-page="${CSS.escape(id)}"] .psPage`);
  function toPage(id, x, y) { const r = pageEl(id).getBoundingClientRect(), g = S.res.g; return { x: (x - r.left) * g.w / r.width, y: (y - r.top) * g.h / r.height, k: r.width / g.w, r }; }
  function pageAt(x, y) {
    let best = null, bd = Infinity;
    for (const w of S.host.querySelectorAll('.psPageWrap')) {
      const r = w.getBoundingClientRect();
      if (x < r.left - 60 || x > r.right + 60) continue;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bd) { bd = d; best = w.dataset.psPage; }
    }
    return bd < 48 ? best : null;
  }
  const pageItems = id => (S.res.pages.find(p => p.id === id) || { items: [] }).items;
  const pinnedRects = (id, except) => pageItems(id).filter(i => i.kind === 'card' && i.pinned && !except.has(i.id));
  function snapTargets(id, except, skip = null) {
    const g = S.res.g, xs = [g.m, g.w / 2, g.w - g.m], ys = [g.m, g.h / 2, g.h - g.m];
    for (const it of pageItems(id)) { if ((it.kind === 'card' && except.has(it.id)) || (skip && skip(it))) continue; xs.push(it.x, it.x + it.w / 2, it.x + it.w); ys.push(it.y, it.y + it.h / 2, it.y + it.h); }
    return { xs, ys };
  }
  function snap(vals, targets, th) { let best = null; for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t }; } return best; }
  function guides(id, gx, gy, ins) {
    S.host.querySelectorAll('.psGuides').forEach(e => { e.innerHTML = ''; });
    if (!id) return;
    const g = S.res.g, host = pageEl(id).querySelector('.psGuides'); let h = '';
    if (gx != null) h += `<i class="psGuide" style="left:${gx - 0.4}pt;top:0;width:0.8pt;height:${g.h}pt"></i>`;
    if (gy != null) h += `<i class="psGuide" style="top:${gy - 0.4}pt;left:0;height:0.8pt;width:${g.w}pt"></i>`;
    if (ins) h += `<i class="psInsert" style="left:${ins.x - 1.5}pt;top:${ins.y}pt;width:3pt;height:${ins.h}pt"></i>`;
    host.innerHTML = h;
  }
  function tip(e, text, bad) { const t = S.$('[data-ps="tip"]'); t.hidden = false; t.textContent = text; t.classList.toggle('isBad', Boolean(bad)); t.style.left = `${e.clientX + 14}px`; t.style.top = `${e.clientY + 18}px`; }
  const hideTip = () => { S.$('[data-ps="tip"]').hidden = true; };
  const selectOnly = id => { S.sel = new Set([id]); S.primary = id; clearFrame(); };

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const pa = e.target.closest('[data-pa]');
    if (pa) return;
    const wrap = e.target.closest('.psPageWrap');
    if (wrap && wrap.dataset.psPage !== S.activePage) { S.activePage = wrap.dataset.psPage; S.host.querySelectorAll('.psPageWrap').forEach(w => w.toggleAttribute('data-active', w === wrap)); renderThumbs(); }
    const ah = e.target.closest('.psArea .psHandle[data-ah]');
    if (ah) {
      const box = ah.closest('.psArea'), key = box.dataset.area, virtual = box.dataset.virtual === '1' && S.frame, it = virtual ? { ...S.frame } : areaItem(key);
      if (it) {
        // Grubun başka sayfaya taşan kartları varsa alan büyüyünce kartlar genel ölçüde kalıp alana katılır
        // (kartları yay); yoksa kartlar alanla orantılı büyür/küçülür (kartları sığdır).
        const all = S.res.pages.flatMap(p => p.items.map(i => ({ i, p: p.id })));
        const total = virtual ? S.doc.order.filter(id => { const c = S.doc.cards[id]; return !(c && c.excluded) && (it.pins ? it.pins.includes(id) : !(c && c.pinned) && E().effectiveKey(S.doc, id, groupOf) === key); }).length : all.filter(x => x.i.kind === 'card' && x.i.area === key).length;
        const inMain = virtual ? it.n : all.filter(x => x.p === it.page && x.i.kind === 'card' && x.i.area === key && x.i.y >= it.y && x.i.y < it.y + it.h).length;
        S.act = { type: 'areaResize', key, dir: ah.dataset.ah, start: { ...it }, page: it.page, sx: e.clientX, sy: e.clientY, last: { x: it.x, y: it.y, w: it.w, h: it.h }, overflow: total > inMain, virtual: Boolean(virtual), pins: virtual ? it.pins : null };
        e.preventDefault(); return;
      }
    }
    const h = e.target.closest('.psHandle');
    if (h) {
      const id = h.closest('.psDocCard').dataset.id, it = S.res.index.get(id);
      S.act = { type: 'resize', id, dir: h.dataset.h, start: { ...it }, page: it.page, sx: e.clientX, sy: e.clientY, last: { x: it.x, y: it.y, w: it.w, h: it.h } };
      e.preventDefault(); return;
    }
    const card = e.target.closest('.psDocCard');
    if (card) {
      const id = card.dataset.id;
      if (e.shiftKey || e.metaKey || e.ctrlKey) { if (S.sel.has(id)) { S.sel.delete(id); if (S.primary === id) S.primary = [...S.sel].pop(); } else { S.sel.add(id); S.primary = id; } }
      else if (!S.sel.has(id)) selectOnly(id);
      else S.primary = id;
      render();
      S.act = { type: 'press', id, sx: e.clientX, sy: e.clientY, mod: e.shiftKey || e.metaKey || e.ctrlKey };
      e.preventDefault(); return;
    }
    const hdr = e.target.closest('.psDocHdr');
    if (hdr) {
      // Başlığa basılı tutup sürükle: grup kendi alanına alınır / alan taşınır. Tıklama: alan seçilir.
      S.act = { type: 'hdrPress', key: hdr.dataset.hdr, area: hdr.dataset.areaHdr != null, pins: hdr.dataset.pins ? hdr.dataset.pins.split('\u001f') : null, page: hdr.closest('.psPageWrap')?.dataset.psPage, sx: e.clientX, sy: e.clientY };
      return;
    }
    // Grup alanının boş yerine tıklama: alan seçilir; sürükleme: alan taşınır.
    const areaBody = e.target.closest('.psArea:not(.isVirtual)');
    if (areaBody && !areaBody.classList.contains('isCont')) {
      S.act = { type: 'hdrPress', key: areaBody.dataset.area, area: true, pins: null, page: areaBody.closest('.psPageWrap')?.dataset.psPage, sx: e.clientX, sy: e.clientY };
      e.preventDefault(); return;
    }
    const page = e.target.closest('.psPage');
    if (page) {
      const pid = page.closest('.psPageWrap').dataset.psPage, p = toPage(pid, e.clientX, e.clientY);
      if (!e.shiftKey) S.sel.clear();
      clearFrame();
      S.act = { type: 'marquee', page: pid, x0: p.x, y0: p.y, base: new Set(S.sel) };
      render(); e.preventDefault(); return;
    }
    if (S.sel.size && e.target.closest('.psCanvas')) { S.sel.clear(); render(); }
  }
  function onPointerMove(e) {
    if (!S || !S.act) return;
    const a = S.act;
    // Sürükleme yalnız düğme basılıyken başlar (tıklamadan sonra gecikmeli gelen fare hareketi sürükleme sayılmaz).
    const held = (e.buttons & 1) === 1;
    if (a.type === 'press' && held && Math.hypot(e.clientX - a.sx, e.clientY - a.sy) > 4) startDrag();
    if (a.type === 'hdrPress' && held && Math.hypot(e.clientX - a.sx, e.clientY - a.sy) > 4) { startAreaDrag(a); if (!S.act) return; }
    if (S.act.type === 'areaDrag') return moveAreaDrag(e);
    if (S.act.type === 'areaResize') return moveAreaResize(e);
    if (S.act.type === 'drag') moveDrag(e);
    else if (S.act.type === 'resize') moveResize(e);
    else if (S.act.type === 'marquee') moveMarquee(e);
  }
  function onPointerUp(e) {
    if (!S || !S.act) return;
    const a = S.act; S.act = null;
    if (a.type === 'areaDrag') return endAreaDrag(a);
    if (a.type === 'areaResize') return endAreaResize(a);
    if (a.type === 'hdrPress') {
      // Tıklama: grup seçilir ve kenar tutamakları açılır (alanı olmayan grupta seçim çerçevesi).
      S.sel.clear(); S.frame = a.area ? null : groupFrame(a.key, a.page, a.pins); S.areaSel = a.area || S.frame ? a.key : null;
      render(); return;
    }
    if (a.type === 'drag') endDrag(a);
    else if (a.type === 'resize') endResize(a);
    else if (a.type === 'marquee') { S.host.querySelectorAll('.psMarquee').forEach(m => m.remove()); render(); }
    else if (a.type === 'press' && !a.mod && S.sel.size > 1) { selectOnly(a.id); render(); }
    else placeFloat();
  }
  function startDrag() {
    const a = S.act, layer = S.$('[data-ps="drag"]'), ids = [...S.sel].filter(id => S.res.index.has(id));
    layer.innerHTML = '';
    const items = ids.map(id => {
      const el = S.host.querySelector(`.psDocCard[data-id="${CSS.escape(id)}"]`), r = el.getBoundingClientRect(), cl = el.cloneNode(true);
      cl.querySelectorAll('.psHandle').forEach(x => x.remove()); cl.classList.remove('isSel'); cl.classList.add('psDragClone');
      cl.style.left = '0'; cl.style.top = '0'; cl.style.fontFamily = R().fontStack(S.doc.style.font);
      cl.style.transform = `translate(${r.left}px,${r.top}px) scale(${S.zoom})`;
      layer.appendChild(cl); el.classList.add('isGhost');
      return { id, el, cl, r, it: S.res.index.get(id) };
    });
    S.act = { type: 'drag', items, lead: items.find(i => i.id === a.id) || items[0], sx: a.sx, sy: a.sy, ids: new Set(ids) };
    hideFloat(); autoScroll();
  }
  function autoScroll() {
    if (!S || !S.act || S.act.type !== 'drag') return;
    const p = S.act.ptr, canvas = S.$('[data-ps="canvas"]');
    if (p) { const r = canvas.getBoundingClientRect(); if (p.y < r.top + 48) canvas.scrollTop -= 14; else if (p.y > r.bottom - 48) canvas.scrollTop += 14; }
    requestAnimationFrame(autoScroll);
  }
  function moveDrag(e) {
    const a = S.act, g = S.res.g, dx = e.clientX - a.sx, dy = e.clientY - a.sy;
    a.ptr = { x: e.clientX, y: e.clientY }; a.mode = null; a.target = null;
    const move = (i, x, y, k) => { i.cl.style.transform = `translate(${x}px,${y}px) scale(${k})`; };
    const thumb = doc_.elementFromPoint(e.clientX, e.clientY)?.closest?.('.psThumb');
    S.host.querySelectorAll('.psThumb').forEach(t => t.toggleAttribute('data-drop', t === thumb));
    if (thumb) {
      a.mode = 'thumb'; a.page = thumb.dataset.th;
      a.items.forEach(i => move(i, i.r.left + dx, i.r.top + dy, S.zoom * 0.6)); guides(null);
      tip(e, L(`Sayfa ${S.doc.pages.findIndex(p => p.id === a.page) + 1}’e taşı · boş alana sabitlenir`, `Move to page ${S.doc.pages.findIndex(p => p.id === a.page) + 1} · pinned to free space`)); return;
    }
    const pid = pageAt(e.clientX, e.clientY); a.page = pid;
    if (!pid) { a.items.forEach(i => move(i, i.r.left + dx, i.r.top + dy, S.zoom)); guides(null); tip(e, L('Bırakma alanı dışında · iptal', 'Outside the drop area · cancel')); return; }
    const P = toPage(pid, e.clientX, e.clientY);
    a.single = e.shiftKey; // Shift: yalnız bu kart (grup birleştirilmez)
    if (!e.altKey) {
      const pinnedOver = pageItems(pid).find(it => it.kind === 'card' && it.pinned && !a.ids.has(it.id) && P.x >= it.x && P.x <= it.x + it.w && P.y >= it.y && P.y <= it.y + it.h);
      if (pinnedOver) {
        a.mode = 'pinNext'; a.target = { id: pinnedOver.id, page: pid };
        a.items.forEach(i => move(i, i.r.left + dx, i.r.top + dy, S.zoom * 0.85));
        guides(pid, null, null, { x: pinnedOver.x + pinnedOver.w + g.gap / 2, y: pinnedOver.y, h: pinnedOver.h });
        tip(e, a.single ? L('Yanına koy, bu kart o gruba katılır', 'Place alongside; this card joins that group') : L('Yanına koy, gruplar birleşir (Shift: yalnız bu kart)', 'Place alongside; groups merge (Shift: this card only)'));
        return;
      }
      const over = pageItems(pid).find(it => it.kind === 'card' && !it.pinned && !a.ids.has(it.id) && P.x >= it.x && P.x <= it.x + it.w && P.y >= it.y && P.y <= it.y + it.h);
      if (over) {
        const after = P.x > over.x + over.w / 2, key = E().effectiveKey(S.doc, over.id, groupOf);
        a.mode = 'insert'; a.target = { id: over.id, after };
        a.items.forEach(i => move(i, i.r.left + dx, i.r.top + dy, S.zoom * 0.85));
        guides(pid, null, null, { x: after ? over.x + over.w + g.gap / 2 : over.x - g.gap / 2, y: over.y, h: over.h });
        const vals = S.res.pages.flatMap(p => p.items).find(it => it.kind === 'hdr' && it.key === key);
        const label = S.doc.labels[key] || (vals ? vals.vals.filter(Boolean).join(' · ') : '');
        const other = a.items.some(i => E().effectiveKey(S.doc, i.id, groupOf) !== key);
        tip(e, (other ? (a.single ? L('Yalnız bu kartı gruba taşı: ', 'Move only this card to group: ') : L('Grupları birleştir: ', 'Merge groups: ')) : L('Sıraya ekle: ', 'Insert in order: ')) + (label || L('akış', 'flow')) + (other && !a.single ? L(' (Shift: yalnız bu kart)', ' (Shift: this card only)') : ''));
        return;
      }
    }
    const L0 = a.lead.it;
    let ox = (a.lead.r.left + dx - P.r.left) / P.k - L0.x, oy = (a.lead.r.top + dy - P.r.top) / P.k - L0.y;
    const rects = a.items.map(i => ({ x: i.it.x + ox, y: i.it.y + oy, w: i.it.w, h: i.it.h }));
    const bb = { x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)) };
    bb.w = Math.max(...rects.map(r => r.x + r.w)) - bb.x; bb.h = Math.max(...rects.map(r => r.y + r.h)) - bb.y;
    const T = snapTargets(pid, a.ids), th = 7 / P.k, sx = snap([bb.x, bb.x + bb.w / 2, bb.x + bb.w], T.xs, th), sy = snap([bb.y, bb.y + bb.h / 2, bb.y + bb.h], T.ys, th);
    if (sx) ox += sx.d; if (sy) oy += sy.d;
    const nx = bb.x + (sx ? sx.d : 0), ny = bb.y + (sy ? sy.d : 0);
    // Sayfa kenar boşluğunun içinde; grup başlığına (seviye başına bir satır) üstte yer kalır.
    const top = g.m + (g.hH ? g.hH + Math.max(0, S.doc.grouping.levels.length - 1) * g.hLine + g.hGap : 0);
    ox += clamp(nx, g.m, Math.max(g.m, g.w - g.m - bb.w)) - nx; oy += clamp(ny, top, Math.max(top, g.h - g.m - bb.h)) - ny;
    a.mode = 'free'; a.off = { x: ox, y: oy };
    const obs = pinnedRects(pid, a.ids), final = a.items.map(i => ({ x: i.it.x + ox, y: i.it.y + oy, w: i.it.w, h: i.it.h }));
    a.bad = final.some(r => obs.some(o => E().overlaps(r, o)));
    a.items.forEach((i, n) => { move(i, P.r.left + final[n].x * P.k, P.r.top + final[n].y * P.k, S.zoom); i.cl.classList.toggle('isBad', a.bad); });
    guides(pid, sx ? sx.t : null, sy ? sy.t : null);
    tip(e, a.bad ? L('Çakışma · bırakınca en yakın boş alana yerleşir', 'Overlap · drops into the nearest free space') : (a.items.length > 1 ? L(`${a.items.length} kart · `, `${a.items.length} cards · `) : '') + L('Serbest yerleştir · sabitlenir', 'Place freely · pinned'), a.bad);
  }
  function endDrag(a) {
    S.$('[data-ps="drag"]').innerHTML = ''; hideTip(); guides(null);
    S.host.querySelectorAll('.psThumb[data-drop]').forEach(t => t.removeAttribute('data-drop'));
    if (!a.mode || !a.page) { render(); return; }
    const g = S.res.g;
    if (a.mode === 'insert') {
      const ids = a.items.map(i => i.id), to = E().effectiveKey(S.doc, a.target.id, groupOf);
      let merged = 0;
      commit(() => { if (!a.single) merged = mergeInto(ids, to); E().insertAt(S.doc, ids, a.target.id, a.target.after, groupOf); });
      if (merged) toast(L(`Gruplar birleştirildi: ${merged} model aynı başlık altında. ${sourceName()} verisi değişmedi (Ctrl+Z ile geri alınır).`, `Groups merged: ${merged} models under one title. ${sourceName()} data is unchanged (undo with Ctrl+Z).`));
      else if (ids.some(id => S.doc.cards[id] && S.doc.cards[id].vgroup != null)) toast(L(`Kart görsel olarak yeni gruba taşındı. ${sourceName()} verisi değişmedi.`, `The card moved to a new group visually. ${sourceName()} data is unchanged.`));
      return;
    }
    if (a.mode === 'pinNext') {
      // Ayrılmış (sabit) kartın üstüne bırakılan kart yanına sabitlenir ve aynı gruba girer: ortak başlık.
      const t = S.res.index.get(a.target.id), to = E().effectiveKey(S.doc, a.target.id, groupOf), ids = a.items.map(i => i.id);
      let merged = 0, fail = 0;
      commit(() => {
        if (!a.single) merged = mergeInto(ids, to);
        const placed = pinnedRects(t.page, new Set(ids)).map(r => ({ ...r }));
        let x = t.x + t.w + g.gap;
        for (const id of ids) {
          E().setGroup(S.doc, id, to, groupOf);
          const fr = E().findFree({ x, y: t.y, w: t.w, h: t.h }, placed.map(r => ({ x: r.x - g.gap / 2, y: r.y - g.gap / 2, w: r.w + g.gap, h: r.h + g.gap })), g);
          if (!fr) { fail++; continue; }
          E().pinAt(S.doc, id, { ...fr, page: t.page }); placed.push(fr); x = fr.x + fr.w + g.gap;
        }
      });
      if (fail) toast(L(`${fail} kart için boş alan bulunamadı.`, `No free space for ${fail} cards.`), 'warning');
      else toast(merged ? L(`Gruplar birleştirildi: ${merged} model aynı başlık altında.`, `Groups merged: ${merged} models under one title.`) : L('Kart aynı gruba alındı ve yanına yerleşti.', 'The card joined the group and was placed alongside.'));
      return;
    }
    let fail = 0, joined = 0;
    commit(() => {
      const placed = pinnedRects(a.page, a.ids).map(r => ({ ...r }));
      for (const i of a.items) {
        // Küçük resme bırakılan kart, üstünde grup başlığına (seviye başına bir satır) yer kalacak şekilde konur.
        const hdrRoom = g.hH ? g.hH + Math.max(0, S.doc.grouping.levels.length - 1) * g.hLine + g.hGap : 0;
        const r = a.mode === 'thumb' ? { x: g.m, y: g.m + hdrRoom, w: i.it.w, h: i.it.h } : { x: i.it.x + a.off.x, y: i.it.y + a.off.y, w: i.it.w, h: i.it.h };
        const fr = E().findFree(r, placed, g);
        if (!fr) { fail++; continue; }
        E().pinAt(S.doc, i.id, { ...fr, page: a.page }); placed.push(fr);
        // Grup alanının içine bırakılan kart o grubun alanında akar (sabitlenmez).
        // Hangi gruba/alana bırakıldığı fare imlecinin konumundan anlaşılır (kartın tutulduğu köşeden değil).
        const ptr = a.ptr ? toPage(a.page, a.ptr.x, a.ptr.y) : null, center = ptr && ptr.x >= 0 && ptr.y >= 0 && ptr.x <= g.w && ptr.y <= g.h ? { x: ptr.x, y: ptr.y } : { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 }, inArea = a.mode === 'thumb' ? null : pageItems(a.page).find(it => it.kind === 'area' && center.x >= it.x && center.x <= it.x + it.w && center.y >= it.y && center.y <= it.y + it.h);
        if (inArea) { if (!a.single) mergeInto([i.id], inArea.key); const last = [...S.doc.order].reverse().find(x => x !== i.id && E().effectiveKey(S.doc, x, groupOf) === inArea.key); placed.pop(); if (last) E().insertAt(S.doc, [i.id], last, true, groupOf); else { S.doc.cards[i.id].pinned = false; E().setGroup(S.doc, i.id, inArea.key, groupOf); } joined++; continue; }
        // Başka grubun alanına bırakılan kart o gruba elle katılır (kaynak veri değişmez, yeni başlık yazılmaz).
        const into = a.mode === 'thumb' ? null : E().groupAt(S.res, a.page, center);
        if (into != null && into !== E().effectiveKey(S.doc, i.id, groupOf)) { if (!a.single) mergeInto([i.id], into); E().setGroup(S.doc, i.id, into, groupOf); joined++; }
      }
    });
    if (fail) toast(L(`${fail} kart için boş alan bulunamadı; eski yerinde bırakıldı.`, `No free space for ${fail} cards; left in place.`), 'warning');
    else if (a.bad) toast(L('Çakışma önlendi: kart en yakın boş alana yerleşti.', 'Overlap prevented: the card was placed in the nearest free space.'));
    else if (joined) toast(L(`Kart bırakıldığı gruba elle katıldı. ${sourceName()} verisi değişmedi.`, `The card joined the group it was dropped into. ${sourceName()} data is unchanged.`));
  }
  /* Bırakılan kartların gruplarını hedef grupla birleştirir (Shift ile bırakılırsa çağrılmaz). Döner: taşınan model sayısı. */
  function mergeInto(ids, to) {
    let n = 0;
    for (const from of new Set(ids.map(id => E().effectiveKey(S.doc, id, groupOf)))) if (from !== to) n += E().mergeGroups(S.doc, from, to, groupOf);
    return n;
  }
  function moveResize(e) {
    const a = S.act, g = S.res.g, el = S.host.querySelector(`.psDocCard[data-id="${CSS.escape(a.id)}"]`);
    if (!el) return;
    const P = toPage(a.page, e.clientX, e.clientY), dx = (e.clientX - a.sx) / P.k, dy = (e.clientY - a.sy) / P.k, s = a.start, d = a.dir;
    let x = s.x, y = s.y, w = s.w, h = s.h;
    const minW = 50, minH = g.th + 24;
    if (d.includes('e')) w = s.w + dx; if (d.includes('s')) h = s.h + dy;
    if (d.includes('w')) { w = s.w - dx; x = s.x + dx; } if (d.includes('n')) { h = s.h - dy; y = s.y + dy; }
    const multi = S.sel.size > 1 && S.sel.has(a.id), skip = multi ? new Set(S.sel) : new Set([a.id]);
    const T = snapTargets(a.page, skip), th = 7 / P.k; let gx = null, gy = null;
    if (d.includes('e')) { const sn = snap([x + w], T.xs, th); if (sn) { w += sn.d; gx = sn.t; } }
    if (d.includes('w')) { const sn = snap([x], T.xs, th); if (sn) { x += sn.d; w -= sn.d; gx = sn.t; } }
    if (d.includes('s')) { const sn = snap([y + h], T.ys, th); if (sn) { h += sn.d; gy = sn.t; } }
    if (d.includes('n')) { const sn = snap([y], T.ys, th); if (sn) { y += sn.d; h -= sn.d; gy = sn.t; } }
    if (w < minW) { if (d.includes('w')) x -= minW - w; w = minW; }
    if (h < minH) { if (d.includes('n')) y -= minH - h; h = minH; }
    if (x < g.m) { w += x - g.m; x = g.m; } if (y < g.m) { h += y - g.m; y = g.m; }
    w = Math.min(w, g.w - g.m - x); h = Math.min(h, g.h - g.m - y);
    const r = { x, y, w, h };
    if (pinnedRects(a.page, skip).some(o => E().overlaps(r, o))) { tip(e, L('Başka bir sabit kartla çakışıyor', 'Overlaps another pinned card'), true); return; }
    a.last = r;
    Object.assign(el.style, { left: `${x}pt`, top: `${y}pt`, width: `${w}pt`, height: `${h}pt` });
    guides(a.page, gx, gy);
    tip(e, `${Math.round(w / E().MM)} × ${Math.round(h / E().MM)} mm · ${multi ? L(`${S.sel.size} kart bu ölçüye gelir`, `${S.sel.size} cards get this size`) : L('sabitlenir', 'pinned')}`);
  }
  function endResize(a) {
    hideTip(); guides(null);
    const r = a.last, s = a.start;
    if (Math.abs(r.w - s.w) < 0.5 && Math.abs(r.h - s.h) < 0.5 && Math.abs(r.x - s.x) < 0.5 && Math.abs(r.y - s.y) < 0.5) { render(); return; }
    if (S.sel.size > 1 && S.sel.has(a.id)) {
      // Çoklu seçim: hepsi aynı ölçüye gelir, seçimin sol üstünden okuma sırasıyla dizilir.
      let failed = 0;
      commit(() => { failed = E().resizeAll(S.doc, S.res, [...S.sel], r.w, r.h); });
      if (failed) toast(L(`${failed} kart sayfaya sığmadı; akışta kaldı.`, `${failed} cards did not fit on the page; they stay in the flow.`), 'warning');
      return;
    }
    commit(() => E().pinAt(S.doc, a.id, { ...r, page: a.page }));
  }
  /* ---------------- Grup alanları ----------------
     Başlık sürüklenince grup kendi alanına alınır (veya alan taşınır); alanın kenarından
     genişlik/en az yükseklik ayarlanır. Alan kartlara yetmezse aşağı büyür, sayfa bitince
     kalan kartlar sonraki sayfada aynı başlıkla sürer (motor: layout). Kaynak veri değişmez. */
  function areaItem(key, cont = false) {
    for (const p of S.res.pages) { const it = p.items.find(i => i.kind === 'area' && i.key === key && Boolean(i.cont) === cont); if (it) return { ...it, page: p.id }; }
    return null;
  }
  function startAreaDrag(a) {
    const g = S.res.g, area = areaItem(a.key), src = area || groupFrame(a.key, a.page, a.pins);
    if (!src || !a.page) { S.act = null; return; }
    const P0 = toPage(a.page, a.sx, a.sy), spec = S.doc.areas && S.doc.areas[a.key];
    // Canlı önizleme: alan sürüklenirken belge geçici olarak güncellenir, öteki gruplar biçimlerini koruyarak
    // yer değiştirir. Tek geri alma adımı; bırakma alanı dışında bırakılırsa iptal edilir.
    // Alanı olmayan grup: alan genişliği grubun kart sayısına göre (en çok çerçevesi kadar sütun); boş sütun kalmaz.
    let w = src.w;
    if (!area) {
      const n = a.pins ? a.pins.length : S.doc.order.filter(id => { const c = S.doc.cards[id]; return !(c && (c.excluded || c.pinned)) && E().effectiveKey(S.doc, id, groupOf) === a.key; }).length;
      const cols = Math.max(1, Math.min(n || 1, Math.floor((src.w + g.gap + 0.01) / (g.cellW + g.gap))));
      w = cols * g.cellW + (cols - 1) * g.gap;
    }
    pushHistory();
    S.act = { type: 'areaDrag', key: a.key, origKey: a.key, pins: area ? null : a.pins, w: clamp(w, Math.min(g.cellW, g.cw), g.cw), minH: spec ? spec.h : 0, mode: spec ? spec.mode : undefined, dx: P0.x - src.x, dy: P0.y - src.y, base: S.hist[S.hist.length - 1], page: null, x: 0, y: 0, last: '' };
    S.areaSel = a.key; S.frame = null; S.sel.clear(); hideFloat();
  }
  function previewArea(a, pid, x, y) {
    const sig = `${pid}|${x.toFixed(1)}|${y.toFixed(1)}`;
    if (sig === a.last) return;
    a.last = sig;
    if (pid == null) { S.doc = JSON.parse(a.base); a.key = a.origKey; a.split = false; }
    else {
      // Grubundan ayrılmış kartın başlığı: kartlar kendi elle grubuna (özgün başlık metniyle) ve alanına alınır.
      if (a.pins && !a.split) { a.key = E().splitGroup(S.doc, a.pins, groupOf); a.split = true; }
      E().setArea(S.doc, a.key, { page: pid, x, y, w: a.w, h: a.minH, mode: a.mode });
    }
    S.areaSel = pid == null ? null : a.key; S.slider = true;
    cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(() => { if (!S) return; relayout(); render(); });
  }
  function moveAreaDrag(e) {
    const a = S.act, g = S.res.g;
    const thumb = doc_.elementFromPoint(e.clientX, e.clientY)?.closest?.('.psThumb');
    S.host.querySelectorAll('.psThumb').forEach(t => t.toggleAttribute('data-drop', t === thumb));
    if (thumb) {
      a.page = thumb.dataset.th; a.x = g.m; a.y = g.m; guides(null); previewArea(a, a.page, g.m, g.m);
      tip(e, L(`Grubu Sayfa ${S.doc.pages.findIndex(p => p.id === a.page) + 1}’e taşı`, `Move the group to page ${S.doc.pages.findIndex(p => p.id === a.page) + 1}`)); return;
    }
    const pid = pageAt(e.clientX, e.clientY); a.page = pid;
    if (!pid) { guides(null); previewArea(a, null); tip(e, L('Bırakma alanı dışında · iptal', 'Outside the drop area · cancel')); return; }
    const P = toPage(pid, e.clientX, e.clientY), maxY = g.bottom - g.hH - g.hGap - g.th - 24;
    // Alan sayfa kenar boşluğunun içinde kalır (baskıda kesilmez).
    let x = clamp(P.x - a.dx, g.m, g.w - g.m - a.w), y = clamp(P.y - a.dy, g.m, maxY);
    const own = it => it.key === a.key || it.area === a.key, T = snapTargets(pid, new Set(), own), th = 7 / P.k, sx = snap([x, x + a.w], T.xs, th), sy = snap([y], T.ys, th);
    if (sx) x += sx.d; if (sy) y += sy.d;
    a.x = clamp(x, g.m, g.w - g.m - a.w); a.y = clamp(y, g.m, maxY);
    guides(pid, sx ? sx.t : null, sy ? sy.t : null);
    previewArea(a, pid, a.x, a.y);
    tip(e, L('Grubu taşı · öteki gruplar biçimini koruyarak yer açar', 'Move the group · other groups make room without changing shape'));
  }
  function endAreaDrag(a) {
    hideTip(); guides(null); cancelAnimationFrame(S.raf); S.slider = false;
    S.host.querySelectorAll('.psThumb[data-drop]').forEach(t => t.removeAttribute('data-drop'));
    if (!a.page || !a.last) { S.doc = JSON.parse(S.hist.pop()); S.areaSel = null; relayout(); render(); return; }
    S.fut = []; S.areaSel = a.key; S.frame = null;
    relayout(); render(); scheduleSave();
  }
  function moveAreaResize(e) {
    const a = S.act, g = S.res.g;
    const P = toPage(a.page, e.clientX, e.clientY), dx = (e.clientX - a.sx) / P.k, dy = (e.clientY - a.sy) / P.k, s = a.start, d = a.dir;
    let x = s.x, w = s.w, h = s.h;
    if (d.includes('e')) w = s.w + dx;
    if (d.includes('w')) { w = s.w - dx; x = s.x + dx; }
    if (d.includes('s')) h = s.h + dy;
    // Grup bazlı kart boyutu (motor: placeArea). Alan sayfa kenar boşluğunun içinde kalır. Canlı önizleme.
    const minW = Math.min(g.cellW, g.cw);
    if (w < minW) { if (d.includes('w')) x -= minW - w; w = minW; }
    if (x < g.m) { w -= g.m - x; x = g.m; }
    w = Math.min(w, g.w - g.m - x); h = clamp(h, g.hH + g.th + 24, g.bottom - s.y);
    a.last = { x, y: s.y, w, h };
    // Grubun başka sayfaya taşan kartı varsa: kartları yay (genel ölçü, alan büyüdükçe kartlar alana katılır);
    // yoksa kartları sığdır (kartlar alanla orantılı büyür/küçülür).
    const mode = a.overflow ? 'spread' : 'fit';
    if (!a.pushed) {
      pushHistory(); a.pushed = true; S.slider = true;
      if (a.virtual && a.pins) a.key = E().splitGroup(S.doc, a.pins, groupOf);
      S.frame = null; S.areaSel = a.key;
    }
    E().setArea(S.doc, a.key, { page: a.page, x, y: s.y, w, h, mode });
    cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(() => { if (!S) return; relayout(); render(); });
    const size = `${Math.round(w / E().MM)} × ${Math.round(h / E().MM)} mm · `;
    tip(e, size + (mode === 'spread' ? L('kart boyutu korunur · taşan kartlar alana katılır', 'card size is kept · overflowing cards join the area') : L('kartlar alana orantılı sığar', 'cards scale to fit the area')));
  }
  function endAreaResize(a) {
    hideTip(); cancelAnimationFrame(S.raf); S.slider = false;
    if (!a.pushed) { render(); return; }
    const r = a.last, s = a.start;
    if (Math.abs(r.w - s.w) < 0.5 && Math.abs(r.h - s.h) < 0.5 && Math.abs(r.x - s.x) < 0.5) { S.doc = JSON.parse(S.hist.pop()); clearFrame(); relayout(); render(); return; }
    S.fut = []; S.areaSel = a.key; relayout(); render(); scheduleSave();
  }
  function placeAreaFloat(f) {
    if (S.frame) {
      const el = S.host.querySelector('.psArea.isVirtual');
      if (!el) { clearFrame(); return false; }
      f.innerHTML = `<span class="psFloatInfo">${esc(L(`Grup · ${S.frame.n} model · kenarlardan boyutlandırın, başlıktan sürükleyip taşıyın`, `Group · ${S.frame.n} models · resize from the edges, drag the title to move`))}</span>`;
      f.hidden = false;
      const r = el.getBoundingClientRect(), fw = f.offsetWidth;
      f.style.left = `${clamp(r.left, 8, root.innerWidth - fw - 8)}px`; f.style.top = `${Math.max(8, r.top - f.offsetHeight - 8)}px`;
      return true;
    }
    const it = areaItem(S.areaSel), el = it && S.host.querySelector(`.psArea[data-area="${CSS.escape(S.areaSel)}"]`);
    if (!it || !el) { S.areaSel = null; return false; }
    const n = S.res.pages.flatMap(p => p.items).filter(i => i.kind === 'card' && i.area === S.areaSel).length;
    const label = L('Grup alanını kaldır: kartlar otomatik akışa döner', 'Remove the group area: cards return to automatic flow');
    const spec = S.doc.areas && S.doc.areas[S.areaSel], auto = L('Kart boyutunu genel tasarım ölçüsüne döndür', 'Return card size to the general design size');
    const autoBtn = spec && spec.h > 0 ? `<button type="button" class="tbtn" data-fa-area="auto" title="${esc(auto)}" aria-label="${esc(auto)}"><span>${esc(L('Otomatik kart boyutu', 'Automatic card size'))}</span></button>` : '';
    const spread = spec && spec.mode === 'spread';
    const modes = spec && spec.h > 0 ? `<span class="psSeg" role="group" aria-label="${esc(L('Kart yerleşimi', 'Card layout'))}"><button type="button" data-fa-mode="fit" aria-pressed="${!spread}" title="${esc(L('Grubun tüm kartları alana orantılı sığar', 'All cards of the group scale to fit the area'))}">${esc(L('Kartları sığdır', 'Fit cards'))}</button><button type="button" data-fa-mode="spread" aria-pressed="${spread}" title="${esc(L('Kartlar genel ölçüde alanı doldurur; sığmayanlar sonraki sayfada sürer', 'Cards keep the general size and fill the area; the rest continue on the next page'))}">${esc(L('Kartları yay', 'Spread cards'))}</button></span>` : '';
    f.innerHTML = `<span class="psFloatInfo">${esc(L(`Grup alanı · ${n} model`, `Group area · ${n} models`))}</span>${modes}${autoBtn}<button type="button" class="tbtn" data-fa-area="out" title="${esc(label)}" aria-label="${esc(label)}">${svg('flow')}<span>${esc(L('Akışa döndür', 'Return to flow'))}</span></button>`;
    f.hidden = false;
    const r = el.getBoundingClientRect(), fw = f.offsetWidth;
    f.style.left = `${clamp(r.left, 8, root.innerWidth - fw - 8)}px`; f.style.top = `${Math.max(8, r.top - f.offsetHeight - 8)}px`;
    return true;
  }
  function moveMarquee(e) {
    const a = S.act, P = toPage(a.page, e.clientX, e.clientY), r = { x: Math.min(a.x0, P.x), y: Math.min(a.y0, P.y), w: Math.abs(P.x - a.x0), h: Math.abs(P.y - a.y0) };
    let m = pageEl(a.page).querySelector('.psMarquee');
    if (!m) { m = doc_.createElement('div'); m.className = 'psMarquee'; pageEl(a.page).appendChild(m); }
    Object.assign(m.style, { left: `${r.x}pt`, top: `${r.y}pt`, width: `${r.w}pt`, height: `${r.h}pt` });
    S.sel = new Set(a.base);
    for (const it of pageItems(a.page)) if (it.kind === 'card' && E().overlaps(r, it)) { S.sel.add(it.id); S.primary = it.id; }
    pageEl(a.page).querySelectorAll('.psDocCard').forEach(c => c.classList.toggle('isSel', S.sel.has(c.dataset.id)));
  }

  /* ---------------- Sayfa işlemleri ---------------- */
  function pageAction(id, k) {
    const pages = S.doc.pages, i = pages.findIndex(p => p.id === id);
    if (i < 0) return;
    if (k === 'flow') return commit(() => { pages[i].flow = !pages[i].flow; pages[i].auto = false; });
    if (k === 'up' && i > 0) return commit(() => { const [p] = pages.splice(i, 1); p.auto = false; pages.splice(i - 1, 0, p); });
    if (k === 'down' && i < pages.length - 1) return commit(() => { const [p] = pages.splice(i, 1); p.auto = false; pages.splice(i + 1, 0, p); });
    if (k === 'add') { commit(() => { const np = { id: 'p' + S.doc.seq++, flow: false, auto: false }; pages.splice(i + 1, 0, np); S.activePage = np.id; }); toast(L('Serbest sayfa eklendi: kartları buraya sürükleyin veya otomatik akışı açın.', 'Free page added: drag cards here or turn on automatic flow.')); return; }
    if (k === 'del' && pages.length > 1) {
      let n = 0;
      commit(() => { for (const c of Object.values(S.doc.cards)) if (c.pinned && c.page === id) { c.pinned = false; n++; } pages.splice(i, 1); });
      toast(n ? L(`Sayfa silindi; ${n} sabit kart otomatik akışa döndü.`, `Page deleted; ${n} pinned cards returned to automatic flow.`) : L('Sayfa silindi; kartlar otomatik akışa döndü.', 'Page deleted; cards returned to automatic flow.'));
    }
  }

  /* ---------------- Sayfa ölçüsü ---------------- */
  function changePage(next, extra) {
    const bad = E().pageChangeConflicts(S.doc, next);
    const apply = mode => { let un = 0; commit(() => { if (extra) extra(); un = E().applyPageChange(S.doc, next, mode); }); fitZoom(); S.pageHtml.clear(); render(); if (un) toast(L(`${un} kart için yer bulunamadı; otomatik akışa bırakıldı.`, `No space for ${un} cards; returned to automatic flow.`), 'warning'); };
    if (!bad.length) { apply('keep'); return; }
    const byPage = {};
    for (const id of bad) { const n = S.doc.pages.findIndex(p => p.id === S.doc.cards[id].page) + 1; byPage[n] = (byPage[n] || 0) + 1; }
    const pins = Object.values(S.doc.cards).filter(c => c.pinned && !c.excluded).length;
    dialog(`<h3 id="psDlgTitle">${esc(L(`${bad.length} sabit kart yeni sayfaya sığmıyor`, `${bad.length} pinned cards do not fit the new page`))}</h3>
      <p>${esc(Object.entries(byPage).map(([p, n]) => L(`Sayfa ${p}: ${n} kart`, `Page ${p}: ${n} cards`)).join(' · '))}. ${esc(L(`Diğer ${pins - bad.length} sabit kart konumunu ve boyutunu koruyor; akıştaki kartlar yeni ölçüye göre yeniden yerleşecek.`, `The other ${pins - bad.length} pinned cards keep their position and size; flowing cards will rearrange for the new size.`))}</p>
      <div class="psOptions"><button type="button" class="tbtn" data-m="keep"><b class="psOptTitle">${esc(L('Koru, sayfa içine al', 'Keep, move inside the page'))}</b><span class="psSub">${esc(L('Taşan kartlar en yakın uygun konuma kayar; gerekirse orantılı küçülür.', 'Overflowing cards move to the nearest suitable position, shrinking proportionally if needed.'))}</span></button>
      <button type="button" class="tbtn" data-m="scale"><b class="psOptTitle">${esc(L('Tüm sabitleri orantılı ölçekle', 'Scale all pinned cards proportionally'))}</b><span class="psSub">${esc(L('Bütün sabit kartlar yeni sayfa ölçüsüne birlikte uyarlanır.', 'All pinned cards are adapted together to the new page size.'))}</span></button>
      <button type="button" class="tbtn" data-m="flow"><b class="psOptTitle">${esc(L('Taşanları otomatik akışa bırak', 'Return overflowing cards to automatic flow'))}</b><span class="psSub">${esc(L('Yalnız sığmayan kartların sabitlemesi kalkar.', 'Only cards that do not fit are unpinned.'))}</span></button></div>
      <div class="modalFoot"><button type="button" class="tbtn" data-m="cancel">${esc(L('Vazgeç', 'Cancel'))}</button></div>`, choice => { if (choice && choice !== 'cancel') apply(choice); else renderBar(); });
  }
  function dialog(html, done) {
    const overlay = doc_.createElement('div');
    overlay.className = 'warnOverlay psDialog'; overlay.dataset.uiMigrated = 'presentation-studio';
    overlay.innerHTML = `<div class="modalCard psDialogCard" role="dialog" aria-modal="true" aria-labelledby="psDlgTitle">${html}</div>`;
    doc_.body.appendChild(overlay);
    let finished = false;
    const finish = choice => { if (finished) return; finished = true; root.BLLayerSystem?.closeDialog?.(overlay); overlay.remove(); done(choice); };
    overlay.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) finish(b.dataset.m); else if (e.target === overlay) finish('cancel'); });
    root.BLLayerSystem?.openDialog?.(overlay, { onClose: () => finish('cancel') });
    root.BLMotionPlus?.play?.('overlay', overlay.firstElementChild);
    overlay.querySelector('[data-m]')?.focus();
  }

  /* Grup başlığını yeniden adlandırma: uygulama içi pencere (masaüstü uygulamada window.prompt yoktur). */
  function renameGroup(key) {
    const current = S.doc.labels[key] || '';
    const vals = (S.res.pages.flatMap(p => p.items).find(it => it.kind === 'hdr' && it.key === key) || { vals: [] }).vals.filter(Boolean).join(' · ');
    let value = current || vals;
    dialog(`<h3 id="psDlgTitle">${esc(L('Grup başlığı', 'Group title'))}</h3><p>${esc(L('Boş bırakılırsa veri değeri kullanılır. Kaynak veri değişmez.', 'Leave empty to use the data value. Source data is unchanged.'))}</p>
      <input type="text" class="psTitle psRename" data-ps="rename" maxlength="${E().LIMITS.label}" value="${esc(value)}" aria-label="${esc(L('Grup başlığı', 'Group title'))}">
      <div class="modalFoot"><button type="button" class="tbtn" data-m="cancel">${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="tbtn primary" data-m="ok">${esc(L('Kaydet', 'Save'))}</button></div>`, choice => {
      if (choice !== 'ok') return;
      commit(() => { const v = value.trim().slice(0, E().LIMITS.label); if (v && v !== vals) S.doc.labels[key] = v; else delete S.doc.labels[key]; });
    });
    const input = doc_.querySelector('.psDialog [data-ps="rename"]');
    if (!input) return;
    input.addEventListener('input', () => { value = input.value; });
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); input.closest('.psDialog').querySelector('[data-m="ok"]').click(); } });
    input.focus(); input.select();
  }

  /* ---------------- Açılır paneller ---------------- */
  const fold = s => String(s || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  const searchKey = f => esc(fold(`${S.meta.label(f)} ${f}`));
  const searchBox = label => `<input type="search" class="psSearch" data-ps="search" value="${esc(S.popQuery || '')}" placeholder="${esc(L('Ara…', 'Search…'))}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false">`;
  const noMatch = () => `<p class="psHint" data-ps="noMatch" hidden>${esc(L('Eşleşen alan yok.', 'No matching field.'))}</p>`;
  // Arama, panel yeniden çizildiğinde (ör. kart bilgisi işaretlenince) korunur.
  function filterPop() {
    const p = S.$('[data-ps="pop"]'), q = fold(S.popQuery).trim();
    let shown = 0;
    for (const el of p.querySelectorAll('[data-q]')) { const hit = !q || el.dataset.q.includes(q); el.hidden = !hit; if (hit) shown += 1; }
    const empty = p.querySelector('[data-ps="noMatch"]'); if (empty) empty.hidden = shown > 0;
  }
  function closePop() { if (!S) return; const p = S.$('[data-ps="pop"]'); p.hidden = true; p.dataset.kind = ''; S.popAnchor = null; }
  function openPop(kind, anchor) {
    const p = S.$('[data-ps="pop"]');
    if (!p.hidden && p.dataset.kind === kind) { closePop(); return; }
    p.dataset.kind = kind; S.popAnchor = anchor; S.popQuery = ''; fillPop(kind); p.hidden = false;
    const r = anchor.getBoundingClientRect();
    p.style.left = `${clamp(r.left, 8, root.innerWidth - p.offsetWidth - 8)}px`; p.style.top = `${Math.min(r.bottom + 6, root.innerHeight - p.offsetHeight - 8)}px`;
    root.BLMotionPlus?.play?.('overlay', p);
    p.querySelector('input,select,button')?.focus({ preventScroll: true });
  }
  function fillPop(kind) {
    const p = S.$('[data-ps="pop"]'), s = S.doc.style, h = t => `<h4 class="psPopTitle">${esc(t)}</h4>`;
    const searching = doc_.activeElement?.dataset?.ps === 'search' && p.contains(doc_.activeElement);
    if (kind === 'fields') {
      const on = s.fields, off = S.meta.ids.filter(f => !on.includes(f));
      p.innerHTML = h(L('Kartta gösterilecek bilgiler', 'Details shown on cards')) + searchBox(L('Kart bilgisi ara', 'Search card details')) + `<div class="psFieldList" data-ps="fieldList">${[...on, ...off].map((f, i) => `<label class="psField" draggable="${on.includes(f)}" data-f="${esc(f)}" data-q="${searchKey(f)}"><span class="psGrip" aria-hidden="true">${on.includes(f) ? sprite('grip') : ''}</span><input type="checkbox" data-fc="${esc(f)}"${on.includes(f) ? ' checked' : ''}><span>${esc(S.meta.label(f))}</span>${i === 0 && on.length ? `<small class="psSub">${esc(L('başlık', 'title'))}</small>` : ''}</label>`).join('')}</div>` + noMatch()
        + `<label class="psToggle"><input type="checkbox" data-ps="labels"${s.labels ? ' checked' : ''}><span>${esc(L('Alan adlarını göster', 'Show field names'))}</span></label><p class="psHint">${esc(L('Sürükleyerek sıralayın. İlk bilgi kart başlığı olur.', 'Drag to reorder. The first detail becomes the card title.'))}</p>`;
    } else if (kind === 'design') {
      const sl = (k, label, unit) => { const [min, max, , step] = E().STYLE_SPEC[k]; return `<label class="psSlider"><span>${esc(label)}</span><output class="psNum" data-out="${k}">${s[k]}${unit}</output><input type="range" data-s="${k}" data-u="${unit}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`; };
      p.innerHTML = h(L('Tasarım', 'Design')) + `<label class="psSlider"><span>${esc(L('Yazı tipi', 'Font'))}</span><select data-ps="font">${E().FONTS.map(f => `<option${f === s.font ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>`
        + sl('hfs', L('Başlık yazı boyutu', 'Title text size'), ' pt') + sl('fs', L('Kart yazı boyutu', 'Card text size'), ' pt') + sl('img', L('Görsel oranı', 'Image ratio'), '×') + sl('cardW', L('Kart boyutu', 'Card size'), ' pt') + sl('gap', L('Kart aralığı', 'Card spacing'), ' pt') + sl('margin', L('Sayfa kenarı', 'Page margin'), ' pt')
        + `<div class="psSlider"><span>${esc(L('Kart stili', 'Card style'))}</span><span class="psSeg" data-ps="cardStyle">${[['frame', L('Çerçeve', 'Frame')], ['shadow', L('Gölge', 'Shadow')], ['plain', L('Sade', 'Plain')]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${s.card === v}">${esc(l)}</button>`).join('')}</span></div>`
        + `<label class="psToggle"><input type="checkbox" data-ps="keepGroups"${s.keepGroups ? ' checked' : ''}><span>${esc(L('Grupları bütün tut (satırda bölme)', 'Keep groups together (no splitting across rows)'))}</span></label><p class="psHint">${esc(L('Değişiklikler anlık uygulanır; sabit kartların konumu ve boyutu korunur.', 'Changes apply instantly; pinned cards keep their position and size.'))}</p>`;
    } else if (kind === 'arrange') {
      p.innerHTML = h(L('Yeniden düzenle', 'Rearrange')) + `<div class="psMenu"><button type="button" class="tbtn" data-rf="keep"><b class="psOptTitle">${esc(L('Sabitleri koru, gerisini dengele', 'Keep pinned cards, rebalance the rest'))}</b><span class="psSub">${esc(L('Çakışmaları çözer, akıştaki kartları yeniden dağıtır.', 'Resolves overlaps and redistributes flowing cards.'))}</span></button>`
        + `<button type="button" class="tbtn" data-rf="order"><b class="psOptTitle">${esc(L('Veri sırasına döndür', 'Return to data order'))}</b><span class="psSub">${esc(L('Elle verilen sıra ve grup taşımaları sıfırlanır; sabitler kalır.', 'Manual order and group moves are reset; pinned cards stay.'))}</span></button>`
        + `<button type="button" class="tbtn" data-rf="all"><b class="psOptTitle">${esc(L('Tümünü sıfırla', 'Reset everything'))}</b><span class="psSub">${esc(L('Sabitleri kaldırır, sunumu baştan dizer.', 'Removes pins and lays the presentation out again.'))}</span></button></div>`;
    } else if (kind === 'level') {
      const rem = S.meta.ids.filter(f => !S.doc.grouping.levels.includes(f));
      p.innerHTML = h(L('Gruplama seviyesi ekle', 'Add grouping level')) + searchBox(L('Gruplama alanı ara', 'Search grouping fields')) + `<div class="psMenu psScroll">${rem.map(f => `<button type="button" class="tbtn" data-addlv="${esc(f)}" data-q="${searchKey(f)}">${esc(S.meta.label(f))}</button>`).join('')}</div>` + noMatch();
    } else if (kind === 'templates') {
      const saved = loadTemplates(), builtin = builtinTemplates();
      const row = (t, key, del) => `<div class="psTpl"><span><b>${esc(t.name)}</b><small class="psSub">${esc(t.hint || `${PAPER_LABEL()[t.page.preset] || t.page.preset} · ${t.grouping.levels.map(f => S.meta.label(f)).join(' › ') || L('grupsuz', 'ungrouped')}`)}</small></span><button type="button" class="tbtn" data-tpl="${key}">${esc(L('Uygula', 'Apply'))}</button>${del ? `<button type="button" class="tbtn psIcon" data-tdel="${del}" aria-label="${esc(L('Şablonu sil', 'Delete template'))}">${sprite('trash')}</button>` : ''}</div>`;
      p.innerHTML = h(L('Hazır şablonlar', 'Ready templates')) + builtin.map((t, i) => row(t, `b${i}`)).join('') + h(L('Şablonlarım', 'My templates'))
        + (saved.length ? saved.map((t, i) => row(t, `s${i}`, String(i + 1))).join('') : `<p class="psHint">${esc(L('Henüz kayıtlı şablon yok.', 'No saved templates yet.'))}</p>`)
        + `<div class="psTplSave"><input data-ps="tplName" maxlength="60" placeholder="${esc(L('Şablon adı', 'Template name'))}" aria-label="${esc(L('Şablon adı', 'Template name'))}"><button type="button" class="tbtn" data-ps="tplSave">${esc(L('Kaydet', 'Save'))}</button></div><p class="psHint">${esc(L('Şablon sayfa ölçüsünü, gruplamayı, kart bilgilerini ve tasarımı saklar; kart konumları sunuma özeldir.', 'A template stores the page size, grouping, card details and design; card positions belong to the presentation.'))}</p>`;
    } else if (kind === 'decks') {
      const decks = readJson(KEY.decks, []);
      p.innerHTML = h(L('Taslaklar', 'Drafts')) + (decks.length ? `<div class="psMenu psScroll">${decks.map(d => `<div class="psTpl"><span><b>${esc(d.title)}</b><small class="psSub">${esc(L(`${sourceOf(d.source).name()} · ${d.count} kayıt · ${new Date(d.updatedAt).toLocaleString('tr-TR')}`, `${sourceOf(d.source).name()} · ${d.count} records · ${new Date(d.updatedAt).toLocaleString('en-GB')}`))}</small></span>${d.id === S.deckId ? `<small class="psSub">${esc(L('açık', 'open'))}</small>` : `<button type="button" class="tbtn" data-deck="${esc(d.id)}">${esc(L('Aç', 'Open'))}</button><button type="button" class="tbtn psIcon" data-ddel="${esc(d.id)}" aria-label="${esc(L('Sunumu sil', 'Delete presentation'))}">${sprite('trash')}</button>`}</div>`).join('')}</div>` : `<p class="psHint">${esc(L('Henüz kayıtlı taslak yok. Taslağı kaydet ile bu sunumu saklayın.', 'No saved drafts yet. Use Save draft to keep this presentation.'))}</p>`)
        + `<p class="psHint">${esc(L(`Kaydedilen taslaklar her değişiklikte hesabınıza otomatik güncellenir (en fazla ${MAX_DECKS}). Taslak açılırken model bilgileri tablodan güncel okunur; tabloda yaptığınız düzeltmeler sunuma yansır.`, `Saved drafts update in your account with every change (up to ${MAX_DECKS}). Model details are read fresh from the table when a draft opens, so corrections you make in the table appear in the presentation.`))}</p>`;
    } else if (kind === 'export') {
      p.innerHTML = h(L('Dışa aktar', 'Export')) + `<div class="psMenu"><button type="button" class="tbtn" data-ex="pdf"><b class="psOptTitle">PDF</b><span class="psSub">${esc(L('Önizlemedeki sayfaların aynısı, seçili sayfa ölçüsünde.', 'Exactly the previewed pages, in the selected page size.'))}</span></button><button type="button" class="tbtn" data-ex="pptx"><b class="psOptTitle">PowerPoint</b><span class="psSub">${esc(L('Düzenlenebilir kartlar ve metinler; aynı konum ve ölçü.', 'Editable cards and text; same positions and size.'))}</span></button></div>`;
    }    const search = p.querySelector('[data-ps="search"]');
    if (search) { filterPop(); if (searching) { search.focus({ preventScroll: true }); search.setSelectionRange(search.value.length, search.value.length); } }
  }

  /* ---------------- Dışa aktarma ---------------- */
  async function exportImage(id) {
    const m = S.models.get(id);
    if (!m || !m.identity) return null;
    S.exportCache = S.exportCache || new Map();
    if (S.exportCache.has(m.identity.source)) return S.exportCache.get(m.identity.source);
    let out = null;
    try {
      const raw = await root.BLAIScreenData.imageDataUrl(m.identity);
      if (raw) out = await downscale(raw);
    } catch (_) { out = null; }
    S.exportCache.set(m.identity.source, out);
    return out;
  }
  function downscale(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, IMAGE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = doc_.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = R().DOC.paper; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        resolve({ src: c.toDataURL('image/jpeg', 0.86), w, h });
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
  async function exportList(onProgress) {
    const ids = [...S.res.index.keys()]; let done = 0, next = 0;
    const images = new Map();
    await Promise.all(Array.from({ length: 4 }, async () => { while (next < ids.length) { const id = ids[next++]; images.set(id, await exportImage(id)); done++; onProgress(done, ids.length); } }));
    return R().build(S.doc, S.res, renderSource(id => images.get(id) || null), { measure: S.measure });
  }
  function fileStem() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${(S.doc.title || L('Sunum', 'Presentation')).replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'Buyer_Log'}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function download(blob, name) { const url = URL.createObjectURL(blob), a = doc_.createElement('a'); a.href = url; a.download = name; doc_.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
  async function runExport(kind) {
    if (S.exporting) return;
    S.exporting = true;
    const btn = S.$('[data-pop="export"]'); btn.disabled = true;
    const progress = (d, n) => { S.$('[data-ps="status"]').querySelector('.psNum').textContent = L(`Görseller hazırlanıyor ${d}/${n}`, `Preparing images ${d}/${n}`); };
    try {
      const list = await exportList(progress), titles = Object.fromEntries([...S.models.values()].map(m => [m.id, m.title]));
      if (kind === 'pptx') {
        const JSZip = root.JSZip || await root.BLPerf.ensureLibrary('jszip');
        const zip = root.BLPresentationPptx.build(JSZip, list, { title: S.doc.title, lang: isEn() ? 'en' : 'tr', palette: R().DOC, titles, chip: R().CHIP });
        download(await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' }), `${fileStem()}.pptx`);
        toast(L('PowerPoint dosyası indirildi.', 'PowerPoint file downloaded.'));
      } else {
        const html = R().documentHtml(list, S.doc.title), desktop = root.buyerLogDesktop;
        if (desktop && typeof desktop.renderPdf === 'function') {
          const out = await desktop.renderPdf(html, { landscape: list.w >= list.h, footer: false });
          if (!out || !out.ok || !out.data) throw Error(out && out.error === 'invalid' ? L('Sunum PDF için çok büyük; sayfa veya model sayısını azaltın.', 'The presentation is too large for PDF; reduce pages or models.') : L('PDF oluşturulamadı.', 'The PDF could not be created.'));
          download(new Blob([out.data], { type: 'application/pdf' }), `${fileStem()}.pdf`);
          toast(L('PDF indirildi.', 'PDF downloaded.'));
        } else printInBrowser(html);
      }
    } catch (error) { toast(error && error.message ? error.message : L('Dışa aktarma başarısız oldu.', 'Export failed.'), 'error'); }
    finally { if (S) { S.exporting = false; btn.disabled = false; renderStatus(); } }
  }
  /* Masaüstü kabuğu yoksa: aynı belge gizli çerçevede tarayıcı yazdırmasıyla (PDF olarak kaydet). */
  function printInBrowser(html) {
    const frame = doc_.createElement('iframe');
    frame.className = 'psPrintFrame'; frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.srcdoc = html;
    frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } };
    doc_.body.appendChild(frame);
    toast(L('Yazdırma penceresinde “PDF olarak kaydet”i seçin.', 'Choose “Save as PDF” in the print dialog.'));
  }

  /* ---------------- Olay bağlama ---------------- */
  function setLevels(levels) {
    const had = Object.values(S.doc.cards).some(c => c.vgroup != null);
    commit(() => { S.doc.grouping.levels = levels; for (const c of Object.values(S.doc.cards)) delete c.vgroup; S.doc.labels = {}; });
    if (had) toast(L('Gruplama değişti: görsel grup taşımaları sıfırlandı, sabit kartlar korundu.', 'Grouping changed: visual group moves were reset, pinned cards were kept.'));
  }
  function applyTemplate(t) {
    const fields = S.meta.ids;
    const run = mode => {
      let result = null;
      commit(() => { result = E().applyTemplate(S.doc, t, { fields, mode }); });
      fitZoom(); S.pageHtml.clear(); render();
      const extra = result && result.missing.length ? L(` · bu seçimde olmayan alanlar atlandı: ${result.missing.map(f => S.meta.label(f)).join(', ')}`, ` · fields missing in this selection were skipped: ${result.missing.map(f => S.meta.label(f)).join(', ')}`) : '';
      toast(L(`“${t.name}” uygulandı; sabit kartlar korundu`, `“${t.name}” applied; pinned cards were kept`) + extra);
    };
    const bad = E().pageChangeConflicts(S.doc, E().normalizePage(t.page));
    if (!bad.length) { run('keep'); return; }
    dialog(`<h3 id="psDlgTitle">${esc(L(`${bad.length} sabit kart şablonun sayfasına sığmıyor`, `${bad.length} pinned cards do not fit the template page`))}</h3><div class="psOptions"><button type="button" class="tbtn" data-m="keep"><b class="psOptTitle">${esc(L('Koru, sayfa içine al', 'Keep, move inside the page'))}</b></button><button type="button" class="tbtn" data-m="scale"><b class="psOptTitle">${esc(L('Tüm sabitleri orantılı ölçekle', 'Scale all pinned cards proportionally'))}</b></button><button type="button" class="tbtn" data-m="flow"><b class="psOptTitle">${esc(L('Taşanları otomatik akışa bırak', 'Return overflowing cards to automatic flow'))}</b></button></div><div class="modalFoot"><button type="button" class="tbtn" data-m="cancel">${esc(L('Vazgeç', 'Cancel'))}</button></div>`, choice => { if (choice && choice !== 'cancel') run(choice); });
  }
  function bindShell() {
    const host = S.host, $ = S.$, canvas = $('[data-ps="canvas"]');
    canvas.addEventListener('pointerdown', onPointerDown);
    S.onMove = e => onPointerMove(e); S.onUp = e => onPointerUp(e);
    root.addEventListener('pointermove', S.onMove); root.addEventListener('pointerup', S.onUp);
    S.onResize = () => placeFloat(); root.addEventListener('resize', S.onResize);
    S.unbind = () => { root.removeEventListener('pointermove', S.onMove); root.removeEventListener('pointerup', S.onUp); root.removeEventListener('resize', S.onResize); };
    canvas.addEventListener('scroll', () => {
      if (!S) return;
      if (S.sel.size) placeFloat();
      cancelAnimationFrame(S.scrollRaf);
      S.scrollRaf = requestAnimationFrame(() => { if (S && !S.act && visibleRange().join(':') !== S.range) renderPages(); });
    }, { passive: true });
    canvas.addEventListener('wheel', e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    canvas.addEventListener('load', e => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.naturalWidth || S.dims.has(img.getAttribute('src'))) return;
      S.dims.set(img.getAttribute('src'), { w: img.naturalWidth, h: img.naturalHeight });
      clearTimeout(S.dimTimer); S.dimTimer = setTimeout(() => { if (S && !S.act) render(); }, 160);
    }, true);
    host.addEventListener('click', e => {
      const t = e.target;
      const pop = t.closest('[data-pop]');
      if (pop) { openPop(pop.dataset.pop, pop); return; }
      if (!t.closest('[data-ps="pop"]') && !$('[data-ps="pop"]').hidden) closePop();
      const ps = t.closest('[data-ps]')?.dataset.ps;
      if (ps === 'undo') return undo();
      if (ps === 'redo') return redo();
      if (ps === 'zoomIn') return setZoom(S.zoom * 1.15);
      if (ps === 'zoomOut') return setZoom(S.zoom / 1.15);
      if (ps === 'zoomFit') { fitZoom(); S.pageHtml.clear(); return render(); }
      if (ps === 'close') return requestClose();
      if (ps === 'saveDraft') return saveDraft();
      if (ps === 'addPage') return pageAction(S.doc.pages[S.doc.pages.length - 1].id, 'add');
      if (ps === 'fixConf') { let un = 0; commit(() => { un = E().resolvePinned(S.doc); }); toast(un ? L(`${un} kart akışa döndü.`, `${un} cards returned to flow.`) : L('Çakışmalar çözüldü.', 'Overlaps resolved.')); return; }
      if (ps === 'tplSave') {
        const name = $('[data-ps="tplName"]').value.trim();
        if (!name) { $('[data-ps="tplName"]').focus(); return; }
        const list = loadTemplates().filter(t => t.name !== name); list.unshift(E().templateOf(S.doc, name));
        writeJson(KEY.templates, list.slice(0, E().LIMITS.templates)); fillPop('templates'); toast(L(`“${name}” şablonu kaydedildi.`, `Template “${name}” saved.`)); return;
      }
      const o = t.closest('[data-ps="orient"] button'); if (o && !o.disabled) return changePage({ ...S.doc.page, orient: o.dataset.o });
      const cm = t.closest('[data-ps="chipMode"] button'); if (cm) { const on = cm.dataset.v === 'chips'; if (on !== S.doc.style.chips) commit(() => { S.doc.style.chips = on; }); return; }
      const cs = t.closest('[data-ps="cardStyle"] button'); if (cs) { commit(() => { S.doc.style.card = cs.dataset.v; }); fillPop('design'); return; }
      const pa = t.closest('[data-pa]'); if (pa) return pageAction(pa.closest('.psPageWrap').dataset.psPage, pa.dataset.pa);
      const th = t.closest('[data-th]'); if (th) { S.activePage = th.dataset.th; host.querySelector(`.psPageWrap[data-ps-page="${CSS.escape(S.activePage)}"]`)?.scrollIntoView({ block: 'start' }); render(); return; }
      const back = t.closest('[data-back]'); if (back) return commit(() => { delete S.doc.cards[back.dataset.back].excluded; });
      const fa = t.closest('[data-fa]'); if (fa) return selAction(fa.dataset.fa);
      const fm = t.closest('[data-fa-mode]'); if (fm && S.areaSel && S.doc.areas[S.areaSel]) { const key = S.areaSel, sp = S.doc.areas[key]; commit(() => E().setArea(S.doc, key, { ...sp, mode: fm.dataset.faMode === 'spread' ? 'spread' : 'fit' })); return; }
      const fa2 = t.closest('[data-fa-area="auto"]'); if (fa2 && S.areaSel) {
        // Genel kart ölçüsüne dönüş: alan genişliği tam sütun sayısına oturur (sağda boş şerit kalmaz).
        const key = S.areaSel, g = S.res.g;
        commit(() => { const sp = S.doc.areas[key]; if (!sp) return; const cols = Math.max(1, Math.floor((Math.min(sp.w, g.cw) + g.gap + 0.01) / (g.cellW + g.gap))); E().setArea(S.doc, key, { ...sp, w: cols * g.cellW + (cols - 1) * g.gap, h: 0 }); });
        return;
      }
      const fo = t.closest('[data-fa-area]'); if (fo && S.areaSel) { const key = S.areaSel; clearFrame(); commit(() => E().clearArea(S.doc, key)); toast(L('Grup alanı kaldırıldı; kartlar otomatik akışa döndü.', 'Group area removed; cards returned to automatic flow.')); return; }
      const rm = t.closest('[data-rmlv]'); if (rm) { const lv = [...S.doc.grouping.levels]; lv.splice(Number(rm.dataset.rmlv), 1); return setLevels(lv); }
      const add = t.closest('[data-addlv]'); if (add) { closePop(); return setLevels([...S.doc.grouping.levels, add.dataset.addlv]); }
      const rf = t.closest('[data-rf]');
      if (rf) {
        closePop();
        if (rf.dataset.rf === 'keep') { let un = 0; commit(() => { un = E().resolvePinned(S.doc); }); toast(un ? L(`${un} kart için yer bulunamadı; akışa döndü.`, `No space for ${un} cards; returned to flow.`) : L('Sabitler korundu, sayfalar yeniden dengelendi.', 'Pinned cards kept, pages rebalanced.')); }
        if (rf.dataset.rf === 'order') commit(() => { S.doc.order = [...S.models.keys()].filter(id => S.doc.order.includes(id)); for (const c of Object.values(S.doc.cards)) delete c.vgroup; });
        if (rf.dataset.rf === 'all') commit(() => { for (const c of Object.values(S.doc.cards)) { c.pinned = false; delete c.vgroup; } S.doc.order = [...S.models.keys()].filter(id => S.doc.order.includes(id)); S.doc.pages = S.doc.pages.filter(p => p.flow); if (!S.doc.pages.length) S.doc.pages = [{ id: 'p' + S.doc.seq++, flow: true, auto: true }]; });
        return;
      }
      const tp = t.closest('[data-tpl]');
      if (tp) { const k = tp.dataset.tpl, tpl = k[0] === 'b' ? builtinTemplates()[Number(k.slice(1))] : loadTemplates()[Number(k.slice(1))]; closePop(); if (tpl) applyTemplate(tpl); return; }
      const td = t.closest('[data-tdel]'); if (td) { const list = loadTemplates(); list.splice(Number(td.dataset.tdel) - 1, 1); writeJson(KEY.templates, list); fillPop('templates'); return; }
      const dk = t.closest('[data-deck]'); if (dk) { closePop(); const id = dk.dataset.deck; confirmLeave(() => openDeck(id).catch(err => toast(err.message, 'error'))); return; }
      const dd = t.closest('[data-ddel]');
      if (dd) { const id = dd.dataset.ddel, list = readJson(KEY.decks, []); const d = list.find(x => x.id === id); if (d && root.confirm(L(`“${d.title}” sunumu silinsin mi? Kaynak veriler etkilenmez.`, `Delete the “${d.title}” presentation? Source data is not affected.`))) { writeJson(KEY.decks, list.filter(x => x.id !== id)); removeKey(KEY.deck(id)); fillPop('decks'); } return; }
      const ex = t.closest('[data-ex]'); if (ex) { closePop(); runExport(ex.dataset.ex); }
    });
    host.addEventListener('change', e => {
      const t = e.target, ps = t.dataset.ps;
      if (t.dataset.fc) { const f = t.dataset.fc, fromSearch = doc_.activeElement?.dataset?.ps === 'search'; commit(() => { const on = S.doc.style.fields; S.doc.style.fields = t.checked ? [...on, f].slice(0, E().LIMITS.fields) : on.filter(x => x !== f); }); fillPop('fields'); if (!fromSearch) S.$(`[data-fc="${CSS.escape(f)}"]`)?.focus({ preventScroll: true }); return; }
      if (ps === 'labels') return commit(() => { S.doc.style.labels = t.checked; });
      if (ps === 'font') return commit(() => { S.doc.style.font = t.value; });
      if (ps === 'keepGroups') return commit(() => { S.doc.style.keepGroups = t.checked; });
      if (ps === 'fabricCode') return commit(() => { S.doc.style.fabricCode = t.checked; });
      if (ps === 'brk') return commit(() => { S.doc.grouping.breakTop = t.checked; });
      if (ps === 'title') return commit(() => { S.doc.title = t.value.trim().slice(0, 120); });
      if (ps === 'paper') { const size = E().pageSize(S.doc.page); return changePage({ ...S.doc.page, preset: t.value, cw: Math.round(size.mmW), ch: Math.round(size.mmH) }); }
      if (ps === 'cw' || ps === 'ch') { const w = clamp(Number($('[data-ps="cw"]').value) || 0, 50, 1200), h = clamp(Number($('[data-ps="ch"]').value) || 0, 50, 1200); return changePage({ preset: 'custom', cw: w, ch: h, orient: w >= h ? 'landscape' : 'portrait' }); }
      if (t.dataset.s) { S.slider = false; cancelAnimationFrame(S.raf); relayout(); render(); scheduleSave(); }
    });
    host.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.ps === 'search') { S.popQuery = t.value; filterPop(); return; }
      if (!t.dataset.s) return;
      if (!S.slider) { pushHistory(); S.slider = true; }
      S.doc.style[t.dataset.s] = Number(t.value);
      host.querySelector(`[data-out="${t.dataset.s}"]`).textContent = t.value + t.dataset.u;
      cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(() => { relayout(); render(); scheduleSave(); });
    });
    host.addEventListener('dblclick', e => { const h = e.target.closest('.psDocHdr'); if (h) renameGroup(h.dataset.hdr); });
    // Sürükle-bırak listeleri (gruplama seviyeleri, kart alanları, sayfa sırası)
    let dragList = null;
    host.addEventListener('dragstart', e => {
      const chip = e.target.closest?.('[data-lv]'), field = e.target.closest?.('.psField[draggable="true"]'), thumb = e.target.closest?.('[data-th]');
      dragList = chip ? { kind: 'lv', from: Number(chip.dataset.lv) } : field ? { kind: 'f', from: field.dataset.f } : thumb ? { kind: 'th', from: thumb.dataset.th } : null;
      if (dragList && e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    host.addEventListener('dragover', e => { if (dragList) e.preventDefault(); });
    host.addEventListener('drop', e => {
      if (!dragList) return; e.preventDefault();
      const d = dragList; dragList = null;
      if (d.kind === 'lv') { const to = e.target.closest('[data-lv]'); if (!to) return; const lv = [...S.doc.grouping.levels], [x] = lv.splice(d.from, 1); lv.splice(Number(to.dataset.lv), 0, x); setLevels(lv); }
      if (d.kind === 'f') { const to = e.target.closest('.psField'); if (!to || !S.doc.style.fields.includes(to.dataset.f) || to.dataset.f === d.from) return; commit(() => { const on = S.doc.style.fields.filter(x => x !== d.from); on.splice(on.indexOf(to.dataset.f), 0, d.from); S.doc.style.fields = on; }); fillPop('fields'); }
      if (d.kind === 'th') { const to = e.target.closest('[data-th]'); if (!to || to.dataset.th === d.from) return; commit(() => { const pages = S.doc.pages, i = pages.findIndex(p => p.id === d.from), [p] = pages.splice(i, 1); p.auto = false; const j = pages.findIndex(x => x.id === to.dataset.th); pages.splice(i <= j ? j + 1 : j, 0, p); }); }
    });
    host.addEventListener('dragend', () => { dragList = null; });
    S.shell.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target.dataset.ps === 'search') {
      // Enter ilk eşleşmeyi seçer: gruplama seviyesi eklenir ya da kart bilgisi açılıp kapanır.
      e.preventDefault();
      const first = S.$('[data-ps="pop"]').querySelector('[data-q]:not([hidden])');
      if (first) (first.matches('[data-addlv]') ? first : first.querySelector('input[data-fc]'))?.click();
      return;
    }
    if (e.target.matches('input,select,textarea')) { if (e.key === 'Escape' && !S.$('[data-ps="pop"]').hidden) { e.stopPropagation(); closePop(); } return; }
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (!S.$('[data-ps="pop"]').hidden) { e.stopPropagation(); closePop(); return; }
      if (S.sel.size) { e.stopPropagation(); S.sel.clear(); render(); return; }
      if (S.areaSel) { e.stopPropagation(); clearFrame(); render(); return; }
      return; // katman sistemi editörü kapatır
    }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'a') { e.preventDefault(); S.sel = new Set(pageItems(S.activePage).filter(i => i.kind === 'card').map(i => i.id)); S.primary = [...S.sel][0]; render(); return; }
    if (!S.sel.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); selAction('exclude'); return; }
    if (k === 'p' && !mod) { selAction([...S.sel].every(id => S.res.index.get(id)?.pinned) ? 'unpin' : 'pin'); return; }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1, g = S.res.g, ids = [...S.sel];
      commit(() => {
        ids.forEach(id => { if (!S.res.index.get(id)?.pinned) E().pinAt(S.doc, id, S.res.index.get(id)); });
        for (const id of ids) {
          const c = S.doc.cards[id], r = { ...c, x: clamp(c.x + dir[0] * step, g.m, g.w - g.m - c.w), y: clamp(c.y + dir[1] * step, g.m, g.h - g.m - c.h) };
          const obs = Object.entries(S.doc.cards).filter(([k2, o]) => k2 !== id && o.pinned && !o.excluded && o.page === c.page && !S.sel.has(k2)).map(([, o]) => o);
          if (!obs.some(o => E().overlaps(r, o))) { c.x = r.x; c.y = r.y; }
        }
      });
    }
  }
  function refreshLanguage() { if (!S) return; localize(); S.pageHtml.clear(); render(); const p = S.$('[data-ps="pop"]'); if (!p.hidden) fillPop(p.dataset.kind); }
  root.BLPresentationStudio = Object.freeze({ openSelection, openDeck, refreshLanguage, close, _state: () => S });
})(window);
