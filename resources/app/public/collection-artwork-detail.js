/* Buyer Log — Koleksiyon Artwork Detayı sütunu
 *
 * PLM BOM'un kalıcı source-of-truth'u server/data/plm-bom.json'dır.
 * Sütunun kendisi KOL_COLS içinde sıradan bir Koleksiyon sütunudur
 * (k:'artworkDetail', Model Detayları, Kumaş'ın solunda): filtre, sıralama,
 * sürükleyerek taşıma, gizleme, manuel düzenleme ve LCW AI bağlamı diğer
 * sütunlarla aynı yoldan çalışır. Bu dosya yalnız PLM değerini satırlara
 * projekte eder; DOM'a ayrı hücre/başlık enjekte etmez.
 *
 * Sahiplik kuralı: satırdaki değer son PLM özetine eşitse (veya boşsa) PLM'e
 * aittir ve PLM SYNC güncellediğinde yenilenir. Kullanıcı hücreyi farklı bir
 * değerle düzenlerse değer manueldir ve korunur; hücreyi temizlemek PLM
 * değerine geri döndürür. Özet biçiminde elle yazılan değer de karta
 * dönüşür. Projeksiyon saveKolRows çağırmaz; ikinci bir kalıcı kaynak
 * oluşturmaz.
 */
(function (global) {
  'use strict';
  if (global.BLCollectionArtworkDetail) return;

  const ART_KEY = 'artworkDetail';
  const PLM_KEY = 'artworkDetailPlm';
  const FRESH_MS = 20000;
  const BATCH = 500;
  const state = { cache: new Map(), meta: new Map(), fetchedAt: 0, revision: 0, inflight: null, timer: 0, patchedRender: false, bound: false, rendering: false };

  const isEn = () => String(document.documentElement.lang || '').toLowerCase().startsWith('en')
    || (typeof global.appLang !== 'undefined' && global.appLang === 'en');
  const L = (tr, en) => (isEn() ? en : tr);
  function numericId(value) {
    let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }
  function bridge() { return global.BLCollectionSpreadsheetBridge || null; }
  function allRows() {
    try {
      const rows = bridge() && typeof bridge().rows === 'function' ? bridge().rows() : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_) { return []; }
  }
  function plmIdOfRow(row) {
    if (!row) return '';
    try {
      const canonical = global.BLCanonicalFields;
      const value = canonical && canonical.normalizedValue
        ? canonical.normalizedValue(row, 'collection', 'plmId') : '';
      const id = numericId(value);
      if (id) return id;
    } catch (_) {}
    return numericId(row.plmId || row['PLM ID'] || row._plmId); // i18n-ignore — kaynak başlığı
  }
  /* Bölge sırası server/lib/corenectum-bom-api.js PLACEMENTS ile aynıdır;
     böylece PLM'in bileşen sırası ne olursa olsun "Ön" her zaman "Arka"dan
     önce yazılır ve aynı içerik aynı metne/karta dönüşür. */
  const PLACEMENT_ORDER = ['front_body', 'back_body', 'left_sleeve', 'right_sleeve', 'both_sleeves', 'sleeve', 'chest', 'pocket', 'hood', 'left_leg', 'right_leg', 'both_legs', 'leg', 'all_over', 'other'];
  const orderOf = key => { const i = PLACEMENT_ORDER.indexOf(key); return i < 0 ? PLACEMENT_ORDER.length : i; };
  /* Placement listesinden dil bağımsız bir model: bölge grupları (sabit
     sıralı), teknikler ve toplam. All Over kumaş detayında yazdığı için
     sayılmaz. */
  function groupPlacements(placements) {
    const groups = new Map(), techniques = new Set();
    let total = 0;
    for (const item of Array.isArray(placements) ? placements : []) {
      if (!item || item.placement === 'all_over') continue;
      const key = String(item.placement || 'other');
      const tr = String(item.placementTr || item.placement || '').trim();
      const en = String(item.placementEn || item.placement || '').trim();
      if (!tr && !en) continue;
      const count = Math.max(1, Number(item.count) || 1);
      const technique = String(item.printType || '').trim();
      const id = `${key}\u0001${tr}\u0001${en}`;
      const group = groups.get(id) || { key, tr: tr || en, en: en || tr, count: 0, techniques: new Set() };
      group.count += count;
      if (technique) { group.techniques.add(technique); techniques.add(technique); }
      groups.set(id, group);
      total += count;
    }
    const list = [...groups.values()].sort((a, b) => orderOf(a.key) - orderOf(b.key));
    return { groups: list, techniques: [...techniques], total };
  }
  /* Kartların ve metin özetinin tek kaynağı. Set Style yapısal parça verisi
     (setParts) yoksa eski kayıttır: model null döner, sunucu metni kullanılır. */
  function modelFor(entry) {
    if (!entry) return null;
    if (entry.isSetStyle) {
      // Özet uçtan setParts, BOM detay penceresinden tam setComponents gelir.
      const parts = setPartsOf(entry);
      if (!parts.length) return null;
      return {
        set: true,
        parts: parts
          .map((part, index) => ({ label: String(part && part.label || '').trim() || (index < 26 ? String.fromCharCode(65 + index) : String(index + 1)), ...groupPlacements(part && part.placements) }))
          .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true })),
      };
    }
    if (!entry.hasPrint) return { set: false, parts: [{ label: '', groups: [], techniques: [], total: 0 }] };
    return { set: false, parts: [{ label: '', ...groupPlacements(entry.placements) }] };
  }
  const slimPlacement = item => ({
    placement: item.placement, placementTr: item.placementTr, placementEn: item.placementEn,
    count: item.count, printType: item.printType,
  });
  function setPartsOf(entry) {
    const raw = Array.isArray(entry && entry.setParts) && entry.setParts.length ? entry.setParts
      : (Array.isArray(entry && entry.setComponents) ? entry.setComponents : []);
    return raw.filter(Boolean).map(part => ({
      label: String(part.label || ''),
      placements: (Array.isArray(part.placements) ? part.placements : []).filter(Boolean).map(slimPlacement),
    }));
  }
  function partText(part, en) {
    const T = (tr, enText) => (en ? enText : tr);
    if (!part.total) return T('Baskı yok', 'No print');
    const label = group => (en ? group.en : group.tr);
    const techOf = group => [...group.techniques].join(' + ');
    const uniform = new Set(part.groups.map(techOf)).size <= 1;
    const totalText = `${T('Toplam', 'Total')}: ${part.total}`;
    if (!uniform) return `${part.groups.map(group => `${label(group)}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : ''}`).join(' • ')} | ${totalText}`;
    const tech = part.techniques.join(' + ');
    return `${part.groups.map(group => `${label(group)}: ${group.count}`).join(' • ')}${tech ? ` | ${tech}` : ''} | ${totalText}`;
  }
  function summaryFor(entry, lang) {
    if (!entry) return '';
    const en = lang ? lang === 'en' : isEn();
    const model = modelFor(entry);
    if (!model) {
      // Eski Set Style kaydı: parça placement'ları yok, sunucunun A/B metni korunur.
      if (entry.isSetStyle && String(entry.artworkSummary || '').trim()) return String(entry.artworkSummary).trim();
      return entry.hasPrint ? '' : (en ? 'No print' : 'Baskı yok');
    }
    if (model.set) return model.parts.map(part => `${part.label} - ${partText(part, en)}`).join('\n');
    return partText(model.parts[0], en);
  }
  /* Aynı BOM'un başka dilde ya da eski (sırasız) biçimde yazılmış metni de
     PLM'e aittir; dil değişimi veya sürüm geçişi hücreyi manuele çevirmez. */
  function legacyUnsorted(entry, en) {
    const groups = new Map(), techniques = new Set();
    let total = 0;
    for (const item of Array.isArray(entry && entry.placements) ? entry.placements : []) {
      if (!item || item.placement === 'all_over') continue;
      const label = en ? (item.placementEn || item.placement) : (item.placementTr || item.placement);
      if (!label) continue;
      const count = Math.max(1, Number(item.count) || 1);
      const technique = String(item.printType || '').trim();
      const group = groups.get(label) || { count: 0, techniques: new Set() };
      group.count += count;
      if (technique) { group.techniques.add(technique); techniques.add(technique); }
      groups.set(label, group);
      total += count;
    }
    if (!total) return '';
    const techOf = group => [...group.techniques].join(' + ');
    const totalText = `${en ? 'Total' : 'Toplam'}: ${total}`; // i18n-ignore — eski PLM özet biçimi
    if (new Set([...groups.values()].map(techOf)).size > 1) {
      return `${[...groups].map(([label, group]) => `${label}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : ''}`).join(' • ')} | ${totalText}`;
    }
    const tech = [...techniques].join(' + ');
    return `${[...groups].map(([label, group]) => `${label}: ${group.count}`).join(' • ')}${tech ? ` | ${tech}` : ''} | ${totalText}`;
  }
  const variantCache = new WeakMap();
  function plmVariants(entry) {
    if (!entry) return new Set();
    if (variantCache.has(entry)) return variantCache.get(entry);
    const out = new Set();
    variantCache.set(entry, out);
    for (const lang of ['tr', 'en']) {
      out.add(summaryFor(entry, lang));
      if (!entry.isSetStyle) out.add(legacyUnsorted(entry, lang === 'en'));
    }
    if (entry.isSetStyle && entry.artworkSummary) out.add(String(entry.artworkSummary).trim());
    out.delete('');
    return out;
  }
  /* project() her render'da tüm satırları dolaşır; özet giriş + dil başına
     bir kez hesaplanır. Giriş nesnesi yenilendiğinde (PLM SYNC) önbellek
     kendiliğinden düşer. */
  const summaryCache = new WeakMap();
  function cachedSummary(entry) {
    if (!entry) return '';
    const lang = isEn() ? 'en' : 'tr';
    let byLang = summaryCache.get(entry);
    if (!byLang) { byLang = {}; summaryCache.set(entry, byLang); }
    if (!(lang in byLang)) byLang[lang] = summaryFor(entry, lang);
    return byLang[lang];
  }
  /* ---- Bölge kartları (hücre görünümü) ----
     Hücrede yalnız görsel katman; değer, düzenleme, kopyalama ve filtre
     aynı düz metin üzerinden çalışır. Teknik rengi tasarım sistemi grafik
     tonlarından deterministik seçilir (yeni renk üretilmez). */
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const KNOWN_TONES = { pigment: 1, transfer: 2, plastisol: 3 };
  function toneOf(technique) {
    const key = String(technique || '').trim().toLocaleLowerCase('tr');
    if (KNOWN_TONES[key]) return KNOWN_TONES[key];
    let hash = 0;
    for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return (hash % 5) + 1;
  }
  function partHtml(part, en) {
    const tag = part.label ? `<span class="blCellPart">${esc(part.label)}</span>` : '';
    if (!part.total) return `<div class="blCellLine">${tag}<span class="blCellNone">— ${en ? 'No print' : 'Baskı yok'}</span></div>`;
    const techOf = group => [...group.techniques].join(' + ');
    /* Bölgeler tekniğe göre gruplanır (ilk bölgenin kanonik sırasıyla); her
       grubun kartlarını kendi teknik etiketi izler. Tek teknikte tek grup olur. */
    const byTech = new Map();
    for (const group of part.groups) {
      const tech = techOf(group);
      if (!byTech.has(tech)) byTech.set(tech, []);
      byTech.get(tech).push(group);
    }
    const body = [...byTech].map(([tech, groups]) => groups
      .map(group => `<span class="blCellChip"><b>${esc(en ? group.en : group.tr)}</b><i>${group.count}</i></span>`).join('')
      + (tech ? `<span class="blCellTag" data-tone="${toneOf([...groups[0].techniques][0])}">${esc(tech)}</span>` : '')).join('');
    return `<div class="blCellLine">${tag}<span class="blCellBody">${body}</span><span class="blCellTotal">${part.total}</span></div>`;
  }
  function cardsOf(model, en) {
    return model ? {
      cls: `kolArtworkTd${model.parts.length > 1 ? ' isMulti' : ''}`,
      inner: `<div class="kolArtworkCards" aria-hidden="true">${model.parts.map(part => partHtml(part, en)).join('')}</div>`,
    } : null;
  }
  /* ---- Elle yazılmış özet ----
     Kullanıcının hücreye PLM özetiyle aynı biçimde yazdığı metin de karta
     dönüşür (PLM ID'siz model, BOM'u henüz olmayan model veya PLM değerinin
     bilinçli olarak değiştirildiği manuel değer). Biçim: bölgeler " • " ile,
     teknik " | " ile ayrılır ve "Toplam/Total: N" ile biter; Set Style'da her
     satır "A - …" parçasıdır. Toplam zorunludur ve bölge adetleriyle tutmalıdır;
     tutmayan veya serbest metin (ör. "Termin: 12") düz metin kalır. */
  const TOTAL_RE = /\s*\|\s*(?:toplam|total)\s*:\s*(\d+)\s*$/i; // i18n-ignore — özet biçimi anahtar kelimesi
  const NO_PRINT_RE = /^(?:baskı yok|no print)$/i; // i18n-ignore — özet biçimi anahtar kelimesi
  const SEGMENT_RE = /^([^:|•]+?)\s*:\s*(\d+)\s*(?:\|\s*([^:|•]+?)\s*)?$/;
  function parsePart(text) {
    let body = String(text || '').trim();
    if (NO_PRINT_RE.test(body)) return { groups: [], techniques: [], total: 0 };
    const match = body.match(TOTAL_RE);
    if (!match) return null;
    const declared = Number(match[1]);
    body = body.slice(0, match.index).trim();
    const groups = [];
    let total = 0;
    for (const segment of body.split(/\s*•\s*/)) {
      const seg = segment.match(SEGMENT_RE);
      const count = seg ? Number(seg[2]) : 0;
      if (!seg || !count) return null;
      const techniques = new Set(seg[3] ? seg[3].split(/\s*\+\s*/).filter(Boolean) : []);
      groups.push({ key: '', tr: seg[1], en: seg[1], count, techniques });
      total += count;
    }
    if (!groups.length || total !== declared) return null;
    // Tekdüze biçimde teknik yalnız son bölgeden sonra yazılır ama tüm bölgelere aittir.
    const tagged = groups.filter(group => group.techniques.size);
    if (groups.length > 1 && tagged.length === 1 && tagged[0] === groups[groups.length - 1]) {
      for (const group of groups) group.techniques = new Set(tagged[0].techniques);
    }
    const techniques = new Set();
    for (const group of groups) for (const tech of group.techniques) techniques.add(tech);
    return { groups, techniques: [...techniques], total };
  }
  function parseSummary(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    const setLines = lines.map(line => line.match(/^([A-Za-z0-9]{1,3})\s+-\s+(.+)$/));
    if (setLines.every(Boolean)) {
      const parts = setLines.map(([, label, body]) => { const part = parsePart(body); return part && { label, ...part }; });
      return parts.every(Boolean) ? { set: true, parts } : null;
    }
    if (lines.length > 1) return null;
    const part = parsePart(lines[0]);
    return part ? { set: false, parts: [{ label: '', ...part }] } : null;
  }
  const cardCache = new WeakMap();
  /* Aynı özet metni çok satırda tekrarlar; kart HTML'i metin + dil başına bir
     kez kurulur. Serbest metin ucuz ön kontrolle (Toplam/Total ya da Baskı yok
     ile bitmeyen) önbelleğe girmeden elenir. */
  const manualCardCache = new Map();
  const MANUAL_CACHE_MAX = 5000;
  const MAYBE_SUMMARY_RE = /(?:toplam|total)\s*:\s*\d+\s*$|(?:baskı yok|no print)\s*$/im; // i18n-ignore — özet biçimi anahtar kelimesi
  function manualCards(text) {
    if (!MAYBE_SUMMARY_RE.test(text)) return null;
    const key = `${isEn() ? 'en' : 'tr'}\u0001${text}`;
    const hit = manualCardCache.get(key);
    if (hit !== undefined) return hit;
    if (manualCardCache.size >= MANUAL_CACHE_MAX) manualCardCache.clear();
    const out = cardsOf(parseSummary(text), isEn());
    manualCardCache.set(key, out);
    return out;
  }
  /* app-main renderKol çağırır. PLM'e ait değerde kart BOM modelinden, elle
     yazılmış özet biçimli değerde metinden kurulur; serbest metinde null. */
  function cellCards(row, value) {
    const text = String(value == null ? '' : value);
    if (!text.trim()) return null;
    const plmId = plmIdOfRow(row);
    const entry = plmId ? state.cache.get(plmId) : null;
    if (!entry || text !== cachedSummary(entry)) return manualCards(text);
    const lang = isEn() ? 'en' : 'tr';
    let byLang = cardCache.get(entry);
    if (!byLang) { byLang = {}; cardCache.set(entry, byLang); }
    if (lang in byLang) return byLang[lang];
    const out = cardsOf(modelFor(entry), lang === 'en') || manualCards(text);
    byLang[lang] = out;
    return out;
  }
  function aiStatus(entry) {
    const status = entry && entry.ai && entry.ai.status || 'not-needed';
    if (status === 'resolved') return L('LCW AI doğruladı', 'LCW AI verified');
    if (status === 'partial') return L('LCW AI kısmen çözümledi', 'LCW AI partially resolved');
    if (status === 'failed') return L('LCW AI kullanılamadı', 'LCW AI unavailable');
    if (status === 'deferred') return L('LCW AI analizi ertelendi', 'LCW AI analysis deferred');
    return L('Kural ile net', 'Resolved by rule');
  }

  /* PLM özetini satıra yazar. Manuel değer (son PLM özetinden farklı ve dolu)
     korunur. Henüz izlenmeyen eski satırlar (PLM_KEY yok) önceki sürümün
     salt-okunur projeksiyonundan geldiği için PLM'e ait sayılır; ancak yalnız
     yerine yazılacak bir PLM özeti varsa. PLM ID'si/BOM'u olmayan satırdaki
     izsiz değer (Excel/kopya ile gelen) elle yazılmıştır ve silinmez. */
  function applyToRow(row, summary, entry) {
    if (!row) return false;
    const current = row[ART_KEY] == null ? '' : String(row[ART_KEY]);
    const tracked = Object.prototype.hasOwnProperty.call(row, PLM_KEY);
    const plmOwned = !current.trim() || (!tracked && Boolean(summary)) || current === String(row[PLM_KEY] == null ? '' : row[PLM_KEY])
      || Boolean(entry && plmVariants(entry).has(current));
    let changed = false;
    if (plmOwned && current !== summary) { row[ART_KEY] = summary; changed = true; }
    if (!tracked || row[PLM_KEY] !== summary) row[PLM_KEY] = summary;
    return changed;
  }
  /* Önbellekteki BOM özetlerini TÜM Koleksiyon satırlarına uygular (yalnız
     görünenlere değil): filtre, sıralama ve LCW AI tüm veriyi görür. Henüz
     okunmamış PLM ID'lere dokunulmaz; okunamayan bir istek değeri silmez. */
  function project() {
    let changed = 0;
    for (const row of allRows()) {
      const plmId = plmIdOfRow(row);
      if (plmId && !state.cache.has(plmId)) continue;
      const entry = plmId ? state.cache.get(plmId) : null;
      if (applyToRow(row, cachedSummary(entry), entry)) changed++;
    }
    return changed;
  }
  // Açık BOM penceresindeki kanıtı, hücre düzenlemenin ortak save/undo yoluyla
  // uygular. Eski pencere, değişen workspace veya başka modele yazamaz.
  function canApplyBom(row, entry) {
    const b = bridge();
    return Boolean(row && entry && b && b.canEdit?.() && b.batchEdit
      && allRows().includes(row) && plmIdOfRow(row)
      && plmIdOfRow(row) === numericId(entry.plmId)
      && b.validateValue?.(row.id, ART_KEY, summaryFor(entry))?.ok);
  }
  function applyBom(row, entry) {
    if (!canApplyBom(row, entry)) return { ok: false, changed: 0 };
    const id = plmIdOfRow(row);
    // batchEdit render'ından önce cache güncellenir; projeksiyon yazılan değeri
    // son BOM özetiyle eşler ve sonraki PLM SYNC'lerde tekrar güncelleyebilir.
    // Detay penceresinin ağır component/setComponent listelerini cache'te tutma.
    const evidence = {
      plmId: id, isSetStyle: entry.isSetStyle, artworkSummary: entry.artworkSummary,
      hasPrint: entry.hasPrint, needsAi: entry.needsAi, fetchedAt: entry.fetchedAt,
      ai: { status: entry.ai?.status },
      placements: (Array.isArray(entry.placements) ? entry.placements : []).map(slimPlacement),
      setParts: entry.isSetStyle ? setPartsOf(entry) : [],
    };
    state.cache.set(id, evidence);
    state.meta.set(id, evidence);
    return bridge().batchEdit([{ rowId: row.id, key: ART_KEY, value: summaryFor(entry) }], { source: 'artwork-bom' });
  }
  function missingIds() {
    const ids = new Set();
    for (const row of allRows()) {
      const plmId = plmIdOfRow(row);
      if (plmId && !state.cache.has(plmId)) ids.add(plmId);
    }
    return ids;
  }
  async function postBatch(body) {
    const response = await fetch('/api/plm-sync/bom/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || response.statusText);
    return payload;
  }
  async function fetchEntries(ids) {
    const list = [...ids];
    const out = {};
    let revision = 0;
    for (let i = 0; i < list.length; i += BATCH) {
      const payload = await postBatch({ plmIds: list.slice(i, i + BATCH) });
      // Partiler arasında depo yazılırsa en eski revision saklanır (temkinli).
      const current = Number(payload.revision) || 0;
      revision = i === 0 ? current : Math.min(revision, current);
      Object.assign(out, payload.entries || {});
    }
    return { entries: out, revision };
  }
  /* Bayatlık süresi dolduğunda bütün ID'leri yeniden çekmeden önce depo
     revision'ı sorulur; depo yazılmadıysa elimizdeki özetler günceldir. */
  async function unchangedSince(revision) {
    if (!revision) return false;
    try { return Boolean((await postBatch({ plmIds: [], ifRevision: revision })).notModified); }
    catch (_) { return false; }
  }
  /* BOM özetlerini yerel depodan tazeler (uzak PLM/AI çağrısı yapmaz).
     Değer değiştiyse Koleksiyon yeniden çizilir. */
  function ensureFresh(options = {}) {
    /* Zorla tazeleme (PLM SYNC sonrası) devam eden eski okumayı yeniden
       kullanmaz; o istek sunucu BOM'u yazmadan önce başlamış olabilir. */
    if (state.inflight) return options.force ? state.inflight.then(() => ensureFresh(options)) : state.inflight;
    const stale = Date.now() - state.fetchedAt > FRESH_MS || options.force;
    const ids = stale ? new Set(allRows().map(plmIdOfRow).filter(Boolean)) : missingIds();
    if (!ids.size) return Promise.resolve(project());
    let gained = 0;
    state.inflight = (async () => {
      try {
        if (stale && !options.force && !missingIds().size && await unchangedSince(state.revision)) {
          state.fetchedAt = Date.now();
          return project();
        }
        const { entries, revision } = await fetchEntries(ids);
        // İlk kez gelen BOM kaydı, metin değişmese de kart katmanı için yeniden çizim ister.
        for (const id of ids) if (entries[id] && !state.cache.get(id)) gained++;
        for (const id of ids) {
          state.cache.set(id, entries[id] || null);
          state.meta.set(id, entries[id] || null);
        }
        if (stale) {
          /* revision yalnız bu turda okunan ID'leri temsil eder; kümenin
             dışında kalan eski kayıtlar atılır ki geri döndüklerinde yeniden
             okunsunlar (aksi hâlde notModified onları süresiz bayat tutardı). */
          for (const id of [...state.cache.keys()]) if (!ids.has(id)) { state.cache.delete(id); state.meta.delete(id); }
          state.fetchedAt = Date.now();
          state.revision = revision;
        }
      } catch (_) {
        return 0;
      } finally {
        state.inflight = null;
      }
      const changed = project();
      if ((changed || gained) && !options.silent && typeof global.renderKol === 'function' && document.getElementById('kolTable')) {
        try { global.renderKol(); } catch (_) {}
      }
      return changed;
    })();
    return state.inflight;
  }

  function injectStyle() {
    if (document.getElementById('blCollectionArtworkStyle')) return;
    const style = document.createElement('style');
    style.id = 'blCollectionArtworkStyle';
    style.textContent = `
      #kolTable td[data-key="${ART_KEY}"].kolArtworkNeedsReview .editCell{color:var(--ui-warning);font-weight:650}
      #kolTable td[data-key="${ART_KEY}"] .editCell{white-space:pre-line}
    `;
    document.head.appendChild(style);
  }
  /* Hücreye yalnız bilgi (ipucu + kontrol gerekli vurgusu) ekler; değer ve
     düzenleyici app-main'in ortak metin hücresinden gelir. */
  function decorateCell(td, row) {
    const entry = state.meta.get(plmIdOfRow(row)) || null;
    const plmValue = String(row[PLM_KEY] == null ? '' : row[PLM_KEY]);
    const current = String(row[ART_KEY] == null ? '' : row[ART_KEY]);
    const manual = Boolean(current.trim()) && current !== plmValue;
    td.classList.toggle('kolArtworkNeedsReview', Boolean(entry && entry.needsAi && !manual));
    // PLM kaydı olan modelde elle yazılmış değer "Manuel" rozeti alır.
    td.classList.toggle('kolArtworkManual', Boolean(entry && manual));
    if (entry && manual) td.dataset.manualLabel = L('Manuel', 'Manual');
    else delete td.dataset.manualLabel;
    const lines = [];
    if (manual && entry) {
      lines.push(L('Manuel değer · temizlerseniz PLM değeri geri gelir', 'Manual value · clear it to restore the PLM value'));
      if (plmValue) lines.push(`PLM: ${plmValue}`);
    } else if (manual) {
      lines.push(L('Manuel değer · bu model için PLM BOM kaydı yok', 'Manual value · no PLM BOM record for this style'));
    } else if (entry) {
      if (entry.needsAi) lines.push(L('⚠ Kontrol gerekli', '⚠ Review required'));
      lines.push(`CoreNectum BOM · ${aiStatus(entry)}`);
      if (entry.fetchedAt) lines.push(new Date(entry.fetchedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR'));
    } else {
      lines.push(L('Bu model için BOM kaydı yok. PLM SYNC çalıştırıldığında otomatik oluşur.', 'No BOM record exists for this style. It is created automatically by PLM SYNC.'));
    }
    if (current.trim() && current !== plmValue && !td.querySelector('.kolArtworkCards')) {
      lines.push(L('Kart için biçim: Ön: 1 • Arka: 1 | Pigment | Toplam: 2', 'Card format: Front: 1 • Back: 1 | Pigment | Total: 2'));
    }
    lines.push(L('Sağ tık › BOM Detayını Aç', 'Right-click › Open BOM Detail'));
    td.title = [current, ...lines].filter(Boolean).join('\n');
  }
  function rowOfCell(td, byId) {
    const tr = td.closest('tr');
    return byId.get(String(tr && (tr.dataset.id || tr.dataset.kolid || tr.getAttribute('data-kolid')) || ''))
      || byId.get(String(td.querySelector('[data-id]') && td.querySelector('[data-id]').dataset.id || ''));
  }
  function decorate() {
    injectStyle();
    const table = document.getElementById('kolTable');
    if (!table || !table.tBodies[0]) return;
    const byId = new Map(allRows().map(row => [String(row && row.id), row]));
    for (const td of table.tBodies[0].querySelectorAll(`td[data-key="${ART_KEY}"]`)) {
      const row = rowOfCell(td, byId);
      if (row) decorateCell(td, row);
    }
  }
  /* Tek hücre düzenlemesi tabloyu yeniden çizmez (commitKolEditor). Kart
     katmanı, sınıfları ve ipucu yalnız o satırın hücresinde yenilenir; aksi
     hâlde elle yazılan özet kart almaz, eski kartlar yeni metnin üstünde kalırdı. */
  function refreshCell(row) {
    const table = document.getElementById('kolTable');
    if (!row || !table || !table.tBodies[0]) return false;
    // Temizlenen PLM hücresi render'daki project() ile aynı kuralla PLM değerine döner.
    const id = plmIdOfRow(row);
    let restored = false;
    if (!id || state.cache.has(id)) {
      const entry = id ? state.cache.get(id) : null;
      restored = applyToRow(row, cachedSummary(entry), entry);
    }
    let found = false;
    for (const editor of table.tBodies[0].querySelectorAll(`.editCell[data-k="${ART_KEY}"]`)) {
      if (String(editor.dataset.id) !== String(row.id)) continue;
      const td = editor.closest('td');
      if (!td) continue;
      found = true;
      // Hücrenin gösterdiği değer esas alınır; yalnız PLM geri yüklemesi metni değiştirir.
      if (restored) editor.value = String(row[ART_KEY] == null ? '' : row[ART_KEY]);
      const art = cellCards(row, editor.value);
      const old = td.querySelector('.kolArtworkCards');
      if (old) old.remove();
      td.classList.remove('kolArtworkTd', 'isMulti');
      if (art) {
        td.classList.add(...art.cls.split(/\s+/).filter(Boolean));
        td.insertAdjacentHTML('afterbegin', art.inner);
      }
      decorateCell(td, row);
    }
    return found;
  }

  async function openBom(row) {
    if (!row) return false;
    try {
      if (!global.BLPlmBom && global.BLPerf && typeof global.BLPerf._loadScript === 'function') {
        await global.BLPerf._loadScript('plm-bom.js');
      }
      if (global.BLPlmBom && global.BLPlmBom.openForRow) { global.BLPlmBom.openForRow(row, 'collection'); return true; }
    } catch (_) {}
    return false;
  }
  function extendBridge() {
    const b = bridge();
    if (b && !b.openArtworkBom) b.openArtworkBom = openBom;
  }

  function wrapRender() {
    if (state.patchedRender || typeof global.renderKol !== 'function') return;
    const base = global.renderKol;
    const wrapped = function (...args) {
      // Önbellekteki PLM özetleri render'dan ÖNCE satıra yazılır; böylece
      // filtre/sıralama/hücre aynı çizimde doğru değeri görür.
      project();
      const result = base.apply(this, args);
      extendBridge();
      decorate();
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { void ensureFresh(); }, 40);
      return result;
    };
    wrapped.__artworkDetailWrapped = true;
    global.renderKol = wrapped;
    state.patchedRender = true;
  }
  function bind() {
    if (state.bound) return;
    state.bound = true;
    wrapRender();
    extendBridge();
    // PLM işlemi başlarken önbellek bayatlatılır; sonraki render'lar (ve
    // FRESH_MS süresi) PLM SYNC'in yazdığı yeni BOM özetlerini okur.
    global.addEventListener('bl:plm-operation-started', () => { state.fetchedAt = 0; });
    // Özet metni dile bağlıdır (Toplam/Total); dil değişince önbellekten yeniden yazılır.
    // Özet metni dile bağlıdır (Toplam/Total). applyLanguage aktif Koleksiyon'u
    // renderKol ile yeniden çizer; sarmalanmış render önce project() çalıştırır.
    document.addEventListener('bl:language-changed', () => { project(); });
  }

  global.BLCollectionArtworkDetail = {
    key: ART_KEY,
    plmKey: PLM_KEY,
    ensureFresh,
    project,
    applyToRow,
    canApplyBom,
    applyBom,
    refresh: () => ensureFresh({ force: true }),
    openBom,
    summaryFor,
    cellCards,
    refreshCell,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
