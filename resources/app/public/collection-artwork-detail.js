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
  // Hücre bazında paylaşılan görünüm bayrağı: 'text' ise kart çizilmez (app-main KOL_CELL_VIEW_KEYS).
  const VIEW_KEY = 'artworkDetailView';
  const FRESH_MS = 20000;
  const BATCH = 500;
  const state = { cache: new Map(), meta: new Map(), fetchedAt: 0, revision: 0, inflight: null, timer: 0, patchedRender: false, bound: false, rendering: false,
    // Manuel değer + değişen PLM özeti: kullanıcı onayı bekler (rowId → {row, summary}).
    conflicts: new Map(), deferred: new Set(), prompting: false, promptTimer: 0 };

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
  /* Karışık teknikte tekniksiz bölge açık "—" ile yazılır; aksi hâlde
     "Ön: 1 • Arka: 1 | Pigment" tekniği iki bölgeye de ait okunurdu.
     legacy=true eski (belirsiz) metni üretir: yalnız PLM sahipliği tanımak için. */
  const NO_TECH = '—';
  function partText(part, en, legacy = false) {
    const T = (tr, enText) => (en ? enText : tr);
    if (!part.total) return T('Baskı yok', 'No print');
    const label = group => (en ? group.en : group.tr);
    const techOf = group => [...group.techniques].join(' + ');
    const uniform = new Set(part.groups.map(techOf)).size <= 1;
    const totalText = `${T('Toplam', 'Total')}: ${part.total}`;
    const blank = legacy ? '' : ` | ${NO_TECH}`;
    if (!uniform) return `${part.groups.map(group => `${label(group)}: ${group.count}${techOf(group) ? ` | ${techOf(group)}` : blank}`).join(' • ')} | ${totalText}`;
    const tech = part.techniques.join(' + ');
    return `${part.groups.map(group => `${label(group)}: ${group.count}`).join(' • ')}${tech ? ` | ${tech}` : ''} | ${totalText}`;
  }
  function summaryFor(entry, lang, legacy = false) {
    if (!entry) return '';
    const en = lang ? lang === 'en' : isEn();
    const model = modelFor(entry);
    if (!model) {
      // Eski Set Style kaydı: parça placement'ları yok, sunucunun A/B metni korunur.
      if (entry.isSetStyle && String(entry.artworkSummary || '').trim()) return String(entry.artworkSummary).trim();
      return entry.hasPrint ? '' : (en ? 'No print' : 'Baskı yok');
    }
    if (model.set) return model.parts.map(part => `${part.label} - ${partText(part, en, legacy)}`).join('\n');
    return partText(model.parts[0], en, legacy);
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
      out.add(summaryFor(entry, lang, true));
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
      + (tech ? `<span class="blCellTag" data-tone="${toneOf([...groups[0].techniques][0])}">${esc(tech)}</span>`
        // Başka bölgede teknik varken tekniksiz grup nötr etiket alır; yoksa teknik yanındaki gruba ait görünürdü.
        : byTech.size > 1 ? `<span class="blCellTag" title="${esc(en ? 'No technique' : 'Teknik yok')}">${NO_TECH}</span>` : '')).join('');
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
  const NO_TECH_RE = /^[—-]$/;
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
      const explicitNone = Boolean(seg[3]) && NO_TECH_RE.test(seg[3]);
      const techniques = new Set(seg[3] && !explicitNone ? seg[3].split(/\s*\+\s*/).filter(Boolean) : []);
      groups.push({ key: '', tr: seg[1], en: seg[1], count, techniques, explicit: Boolean(seg[3]) });
      total += count;
    }
    if (!groups.length || total !== declared) return null;
    // Tekdüze biçimde teknik yalnız son bölgeden sonra yazılır ama tüm bölgelere aittir.
    // Başka bölgede açık teknik (veya "—") yazılmışsa yayılım yapılmaz.
    const tagged = groups.filter(group => group.explicit);
    if (groups.length > 1 && tagged.length === 1 && tagged[0] === groups[groups.length - 1] && tagged[0].techniques.size) {
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
    if (!text.trim() || (row && row[VIEW_KEY] === 'text')) return null;
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
  /* ---- Kart editörü: metin ↔ düzenlenebilir satırlar ----
     Editör ikinci bir veri kaynağı tutmaz: hücre metnini satırlara açar,
     kaydette aynı kanonik özet metnini (partText) üretir. Bölge listesi
     server/lib/corenectum-bom-api.js PLACEMENTS ile aynıdır (All Over
     kumaşta yazıldığı için listede yok); etiket arayüz dilinde yazılır. */
  const REGIONS = [
    { key: 'front_body', tr: 'Ön', en: 'Front' }, { key: 'back_body', tr: 'Arka', en: 'Back' },
    { key: 'left_sleeve', tr: 'Sol Kol', en: 'Left Sleeve' }, { key: 'right_sleeve', tr: 'Sağ Kol', en: 'Right Sleeve' },
    { key: 'both_sleeves', tr: 'Kollar', en: 'Sleeves' }, { key: 'sleeve', tr: 'Kol', en: 'Sleeve' },
    { key: 'chest', tr: 'Göğüs', en: 'Chest' }, { key: 'pocket', tr: 'Cep', en: 'Pocket' },
    { key: 'hood', tr: 'Kapüşon', en: 'Hood' }, { key: 'left_leg', tr: 'Sol Bacak', en: 'Left Leg' },
    { key: 'right_leg', tr: 'Sağ Bacak', en: 'Right Leg' }, { key: 'both_legs', tr: 'Bacaklar', en: 'Legs' },
    { key: 'leg', tr: 'Bacak/Paça', en: 'Leg' }, { key: 'other', tr: 'Diğer', en: 'Other' },
  ];
  const BASE_TECHNIQUES = ['Pigment', 'Transfer', 'Plastisol', 'Foil Print'];
  const foldKey = text => String(text || '').trim().toLocaleLowerCase('tr');
  function regionLabel(text) {
    const key = foldKey(text);
    const hit = REGIONS.find(region => foldKey(region.tr) === key || foldKey(region.en) === key);
    return hit ? (isEn() ? hit.en : hit.tr) : String(text || '').trim();
  }
  function editorFromText(text) {
    const value = String(text == null ? '' : text);
    if (!value.trim()) return { parseable: true, parts: [{ label: '', rows: [] }] };
    const model = parseSummary(value);
    if (!model) return { parseable: false, parts: [{ label: '', rows: [] }] };
    return {
      parseable: true,
      parts: model.parts.map(part => ({
        label: part.label || '',
        rows: part.groups.map(group => ({ region: regionLabel(group.tr), technique: [...group.techniques].join(' + '), count: group.count })),
      })),
    };
  }
  const BAD_REGION = /[:|•+\n\r]/;
  const BAD_TECHNIQUE = /[:|•\n\r]/;
  function editorCompose(parts) {
    const list = Array.isArray(parts) && parts.length ? parts : [{ label: '', rows: [] }];
    const set = list.length > 1;
    const fail = (error, part, row) => ({ ok: false, error, part, row });
    const labels = new Set();
    const lines = [];
    for (let p = 0; p < list.length; p++) {
      const label = String(list[p] && list[p].label || '').trim().toLocaleUpperCase('en-US');
      if (set && (!/^[A-Z0-9]{1,3}$/.test(label) || labels.has(label))) return fail('label', p, -1);
      labels.add(label);
      const merged = new Map();
      const rows = Array.isArray(list[p] && list[p].rows) ? list[p].rows : [];
      for (let r = 0; r < rows.length; r++) {
        const region = String(rows[r].region || '').trim();
        const typed = String(rows[r].technique || '').trim();
        const technique = NO_TECH_RE.test(typed) ? '' : typed.split(/\s*\+\s*/).filter(Boolean).join(' + ');
        const count = Number(rows[r].count);
        if (!region) return fail('region', p, r);
        if (BAD_REGION.test(region) || BAD_TECHNIQUE.test(technique)) return fail('chars', p, r);
        if (!Number.isInteger(count) || count < 1 || count > 999) return fail('count', p, r);
        const id = `${foldKey(region)}\u0001${foldKey(technique)}`;
        const hit = merged.get(id);
        if (hit) hit.count += count;
        else merged.set(id, { region: regionLabel(region), technique, count, row: r });
      }
      const groups = [...merged.values()];
      const techniques = [];
      for (const group of groups) for (const tech of group.technique ? group.technique.split(' + ') : []) if (!techniques.includes(tech)) techniques.push(tech);
      const text = partText({
        groups: groups.map(group => ({ key: '', tr: group.region, en: group.region, count: group.count, techniques: new Set(group.technique ? group.technique.split(' + ') : []) })),
        techniques,
        total: groups.reduce((sum, group) => sum + group.count, 0),
      }, isEn());
      lines.push(set ? `${label} - ${text}` : text);
    }
    return { ok: true, value: lines.join('\n') };
  }
  function techniqueSuggestions() {
    const out = new Set(BASE_TECHNIQUES);
    for (const entry of state.cache.values()) {
      const placements = entry && entry.isSetStyle ? setPartsOf(entry).flatMap(part => part.placements) : (entry && entry.placements) || [];
      for (const item of placements) if (item && String(item.printType || '').trim()) out.add(String(item.printType).trim());
    }
    return [...out].sort((a, b) => a.localeCompare(b, 'tr'));
  }

  function aiStatus(entry) {
    const status = entry && entry.ai && entry.ai.status || 'not-needed';
    if (status === 'resolved') return L('LCW AI doğruladı', 'LCW AI verified');
    if (status === 'partial') return L('LCW AI kısmen çözümledi', 'LCW AI partially resolved');
    if (status === 'failed') return L('LCW AI kullanılamadı', 'LCW AI unavailable');
    if (status === 'deferred') return L('LCW AI analizi ertelendi', 'LCW AI analysis deferred');
    return L('Kural ile net', 'Resolved by rule');
  }

  /* PLM özetini satıra yazar. PLM'e ait değer (boş, son PLM özetine eşit ya
     da aynı BOM'un başka dil/eski biçim metni) güncellenir. Manuel değer HİÇBİR
     zaman onaysız ezilmez: PLM özeti son görülenden anlamca farklıysa (ya da
     satır izsizse ve değer farklıysa) çakışma kaydedilir, son PLM değeri onaya
     kadar güncellenmez ve kullanıcıya sorulur (promptConflicts). */
  function applyToRow(row, summary, entry) {
    if (!row) return false;
    const current = row[ART_KEY] == null ? '' : String(row[ART_KEY]);
    const tracked = Object.prototype.hasOwnProperty.call(row, PLM_KEY);
    const lastPlm = String(row[PLM_KEY] == null ? '' : row[PLM_KEY]);
    // Sıcak yol (her render, tüm satırlar): varyant kümesi yalnız gerektiğinde okunur.
    const variants = () => (entry ? plmVariants(entry) : null);
    const plmOwned = !current.trim() || (tracked && current === lastPlm) || Boolean(entry && variants().has(current));
    let changed = false;
    if (plmOwned && current !== summary) { row[ART_KEY] = summary; changed = true; }
    if (!plmOwned && summary && (!tracked || (lastPlm !== summary && !(entry && variants().has(lastPlm))))) {
      state.conflicts.set(String(row.id), { row, summary });
      return changed;
    }
    if (state.conflicts.size) state.conflicts.delete(String(row.id));
    if (!tracked || row[PLM_KEY] !== summary) row[PLM_KEY] = summary;
    return changed;
  }
  /* Bekleyen çakışmaları app-main'in ortak onay penceresiyle tek tek sorar.
     Manueli koru: son PLM değeri kaydedilir (PLM tekrar değişene kadar sorulmaz).
     PLM değerini al: ortak batchEdit (geri alma/kayıt). İptal: bu oturumda bir
     sonraki PLM işlemine kadar tekrar sorulmaz; değer yine korunur. */
  async function promptConflicts() {
    const b = bridge();
    if (state.prompting || !b || !b.canEdit?.() || !b.askManualConflicts) return false;
    const list = [...state.conflicts.values()].filter(item => allRows().includes(item.row) && !state.deferred.has(`${item.row.id}\u0001${item.summary}`));
    if (!list.length) return false;
    state.prompting = true;
    try {
      const label = L('Artwork Detayı', 'Artwork Detail');
      const answer = await b.askManualConflicts(list.map(({ row, summary }) => ({
        model: [row.plmId, row.modelKod, row.colourCode || row.colour].map(value => String(value == null ? '' : value).trim()).filter(Boolean).join(' · '),
        label, current: String(row[ART_KEY] == null ? '' : row[ART_KEY]), incoming: summary,
      })));
      if (!answer || answer.cancelled) {
        for (const item of list) state.deferred.add(`${item.row.id}\u0001${item.summary}`);
        return false;
      }
      const ops = [];
      list.forEach((item, index) => {
        state.conflicts.delete(String(item.row.id));
        if (answer.choices[index] === 'plm') ops.push({ rowId: item.row.id, key: ART_KEY, value: item.summary });
        else item.row[PLM_KEY] = item.summary;
      });
      // batchEdit kaydı korunan satırların yeni son-PLM değerini de yazar.
      if (ops.length) b.batchEdit(ops, { source: 'artwork-plm-conflict' });
      else b.saveRows?.();
      return true;
    } finally { state.prompting = false; }
  }
  function schedulePrompt() {
    clearTimeout(state.promptTimer);
    if (!state.conflicts.size) return;
    state.promptTimer = setTimeout(() => {
      // Başka bir pencere açıkken (ör. PLM SYNC önizlemesi) araya girilmez; sonraki çizimde denenir.
      if (document.querySelector?.('.warnOverlay')) return;
      if (document.body?.dataset?.activeTab && document.body.dataset.activeTab !== 'koleksiyon') return;
      void promptConflicts();
    }, 400);
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
    if (row[VIEW_KEY] === 'text') {
      lines.push(L('Düz metin görünümü · Sağ tık › Karta çevir', 'Plain text view · Right-click › Convert to cards'));
    } else if (current.trim() && current !== plmValue && !td.querySelector('.kolArtworkCards')) {
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

  /* Çift tık kart editörü (Kumaş seçicisiyle aynı pencere deseni). Kayıt
     ortak batchEdit yolundan gider: geri alma, kayıt, model bağı denetimi ve
     render aynı kalır. Boş kayıt hücreyi temizler (PLM değeri varsa geri gelir). */
  function openEditor(row, { trigger = null } = {}) {
    const b = bridge();
    if (!row || !b || !b.canEdit?.() || !b.batchEdit) return false;
    const current = String((b.rawValue ? b.rawValue(row, ART_KEY) : row[ART_KEY]) ?? '');
    const initial = editorFromText(current);
    let parts = initial.parts.map(part => ({ label: part.label, rows: part.rows.map(item => ({ ...item })) }));
    if (parts.length === 1 && !parts[0].rows.length && initial.parseable) parts[0].rows.push({ region: '', technique: '', count: 1 });
    document.getElementById('_kolArtworkEditor')?.remove();
    const modal = document.createElement('div');
    modal.id = '_kolArtworkEditor';
    modal.className = 'warnOverlay';
    modal.dataset.uiMigrated = 'dialog';
    const model = [row.plmId, row.modelKod].map(value => String(value == null ? '' : value).trim()).filter(Boolean).join(' · ');
    const title = L('Artwork kartları', 'Artwork cards') + (model ? ` · ${model}` : '');
    const regionOptions = REGIONS.map(region => `<option value="${esc(isEn() ? region.en : region.tr)}"></option>`).join('');
    const techOptions = techniqueSuggestions().map(tech => `<option value="${esc(tech)}"></option>`).join('');
    modal.innerHTML = `<div class="modalCard verHistCard plmImportCard kolArtworkEditor" role="dialog" aria-modal="true" aria-labelledby="_kolArtworkEditorTitle">
      <div class="verHistHead"><div><strong id="_kolArtworkEditorTitle">${esc(title)}</strong>
        <div class="muted">${esc(L('Her baskıyı bölge, teknik ve adetle bir kart olarak ekleyin. Takım modelde her parçayı (A, B…) ayrı ekleyin.', 'Add each print as a card with region, technique and count. For set styles add every piece (A, B…) separately.'))}</div></div></div>
      <div class="plmImportBody">
        <datalist id="_kolArtworkRegions">${regionOptions}</datalist>
        <datalist id="_kolArtworkTechniques">${techOptions}</datalist>
        ${initial.parseable ? '' : `<div class="kolArtworkEdNote plmExistingWarning" role="note">${esc(L('Hücredeki metin kart biçiminde değil; kaydederseniz kartlarla değiştirilir:', 'The cell text is not in card format; saving replaces it with cards:'))} <q>${esc(current)}</q></div>`}
        <div class="kolArtworkEdParts" data-art-parts></div>
        <div><button type="button" class="tbtn" data-art="add-part"><span>${esc(L('+ Set parçası ekle', '+ Add set piece'))}</span></button></div>
        <div class="kolArtworkEdPreview muted" data-art-preview aria-live="polite"></div>
        <div class="muted" data-art-status role="status"></div>
      </div>
      <div class="verHistFoot kolFabricFoot">
        <button type="button" class="tbtn" data-art="clear">${esc(L('Hücreyi temizle', 'Clear cell'))}</button>
        <span class="kolFabricFootSpacer"></span>
        <button type="button" class="tbtn" data-art="cancel">${esc(L('Vazgeç', 'Cancel'))}</button>
        <button type="button" class="tbtn primary" data-art="apply">${esc(L('Hücreye uygula', 'Apply to cell'))}</button>
      </div>
    </div>`;
    const host = modal.querySelector('[data-art-parts]');
    const status = modal.querySelector('[data-art-status]');
    const preview = modal.querySelector('[data-art-preview]');
    const rowHtml = (row, p, r) => `<div class="kolArtworkEdRow" data-art-row="${p}:${r}">
        <input type="text" list="_kolArtworkRegions" autocomplete="off" data-art-field="region" data-p="${p}" data-r="${r}" value="${esc(row.region)}" placeholder="${esc(L('Bölge', 'Region'))}" aria-label="${esc(L(`Bölge ${r + 1}`, `Region ${r + 1}`))}">
        <input type="text" list="_kolArtworkTechniques" autocomplete="off" data-art-field="technique" data-p="${p}" data-r="${r}" value="${esc(row.technique)}" placeholder="${esc(L('Teknik (bilinmiyorsa boş)', 'Technique (blank if unknown)'))}" aria-label="${esc(L(`Teknik ${r + 1}`, `Technique ${r + 1}`))}">
        <input type="number" min="1" max="999" step="1" inputmode="numeric" data-art-field="count" data-p="${p}" data-r="${r}" value="${esc(row.count)}" aria-label="${esc(L(`Adet ${r + 1}`, `Count ${r + 1}`))}">
        <button type="button" class="tbtn" data-art-remove-row="${p}:${r}" aria-label="${esc(L(`Kartı kaldır ${r + 1}`, `Remove card ${r + 1}`))}" title="${esc(L('Kaldır', 'Remove'))}">×</button>
      </div>`;
    const render = () => {
      const multi = parts.length > 1;
      host.innerHTML = parts.map((part, p) => `<section class="kolArtworkEdPart${multi ? ' isMulti' : ''}" data-art-part="${p}">
          ${multi ? `<div class="kolArtworkEdPartHead"><input type="text" class="kolArtworkEdLabel" maxlength="3" autocomplete="off" data-art-field="label" data-p="${p}" value="${esc(part.label)}" placeholder="${esc(String.fromCharCode(65 + p))}" aria-label="${esc(L(`Set parçası harfi ${p + 1}`, `Set piece letter ${p + 1}`))}">
            <button type="button" class="tbtn" data-art-remove-part="${p}">${esc(L('Parçayı kaldır', 'Remove piece'))}</button></div>` : ''}
          ${part.rows.map((row, r) => rowHtml(row, p, r)).join('') || `<div class="muted">${esc(L('Baskı yok', 'No print'))}</div>`}
          <div><button type="button" class="tbtn" data-art-add-row="${p}"><span>${esc(L('+ Kart ekle', '+ Add card'))}</span></button></div>
        </section>`).join('');
      updatePreview();
    };
    const updatePreview = () => {
      const result = editorCompose(parts);
      preview.textContent = result.ok ? `${L('Hücreye yazılacak', 'Will be written')}: ${result.value.replace(/\n/g, ' / ')}` : '';
    };
    const errorText = result => {
      const where = parts.length > 1 ? `${parts[result.part].label || String.fromCharCode(65 + result.part)} · ` : '';
      const n = result.row + 1;
      if (result.error === 'label') return L(`${result.part + 1}. set parçası: benzersiz bir harf girin (A, B…).`, `Set piece ${result.part + 1}: enter a unique letter (A, B…).`);
      if (result.error === 'region') return L(`${where}${n}. kart: bölge seçin.`, `${where}Card ${n}: choose a region.`);
      if (result.error === 'chars') return L(`${where}${n}. kart: bölge ve teknikte : | • kullanılamaz (bölgede + de).`, `${where}Card ${n}: region and technique cannot contain : | • (region also not +).`);
      return L(`${where}${n}. kart: adet 1–999 arası tam sayı olmalı.`, `${where}Card ${n}: count must be a whole number from 1 to 999.`);
    };
    const close = () => { global.BLLayerSystem?.closeDialog?.(modal, { trigger }); modal.remove(); };
    const write = value => {
      if (value === current) { close(); return; }
      const result = b.batchEdit([{ rowId: row.id, key: ART_KEY, value }], { source: 'artwork-cards' });
      if (!result || !result.ok) { status.textContent = L('Artwork bu hücreye yazılamadı (model grubuna bağlı alan olabilir).', 'Artwork could not be written to this cell (the field may be linked to the model group).'); return; }
      close();
      global.showToast?.(L('Artwork kartları güncellendi. Geri alınabilir.', 'Artwork cards updated. Undo is available.'));
    };
    modal.addEventListener('input', event => {
      const field = event.target.dataset.artField;
      if (!field) return;
      const p = Number(event.target.dataset.p), r = Number(event.target.dataset.r);
      if (field === 'label') { event.target.value = event.target.value.toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, ''); parts[p].label = event.target.value; }
      else if (field === 'count') parts[p].rows[r].count = event.target.value === '' ? NaN : Number(event.target.value);
      else parts[p].rows[r][field] = event.target.value;
      status.textContent = '';
      updatePreview();
    });
    modal.addEventListener('click', event => {
      if (event.target === modal) { close(); return; }
      const addRow = event.target.closest('[data-art-add-row]');
      if (addRow) {
        const p = Number(addRow.dataset.artAddRow);
        parts[p].rows.push({ region: '', technique: parts[p].rows.length ? parts[p].rows[parts[p].rows.length - 1].technique : '', count: 1 });
        render();
        host.querySelector(`[data-art-row="${p}:${parts[p].rows.length - 1}"] input`)?.focus();
        return;
      }
      const removeRow = event.target.closest('[data-art-remove-row]');
      if (removeRow) { const [p, r] = removeRow.dataset.artRemoveRow.split(':').map(Number); parts[p].rows.splice(r, 1); render(); status.textContent = ''; return; }
      const removePart = event.target.closest('[data-art-remove-part]');
      if (removePart) { parts.splice(Number(removePart.dataset.artRemovePart), 1); if (parts.length === 1) parts[0].label = ''; render(); status.textContent = ''; return; }
      const action = event.target.closest('[data-art]')?.dataset.art;
      if (action === 'cancel') { close(); return; }
      if (action === 'add-part') {
        if (parts.length === 1 && !parts[0].label) parts[0].label = 'A';
        const used = new Set(parts.map(part => part.label));
        let next = 0;
        while (used.has(String.fromCharCode(65 + next)) && next < 25) next++;
        parts.push({ label: String.fromCharCode(65 + next), rows: [{ region: '', technique: '', count: 1 }] });
        render();
        host.querySelector(`[data-art-part="${parts.length - 1}"] [data-art-field="region"]`)?.focus();
        return;
      }
      if (action === 'clear') { write(''); return; }
      if (action === 'apply') {
        const result = editorCompose(parts);
        if (!result.ok) {
          status.textContent = errorText(result);
          const selector = result.row >= 0 ? `[data-art-row="${result.part}:${result.row}"] [data-art-field="${result.error === 'count' ? 'count' : 'region'}"]` : `[data-art-part="${result.part}"] [data-art-field="label"]`;
          host.querySelector(selector)?.focus();
          return;
        }
        write(result.value);
      }
    });
    render();
    document.body.appendChild(modal);
    global.BLLayerSystem?.openDialog?.(modal, { trigger, onClose: close, initialFocus: '[data-art-field="region"]' });
    global.BLMotionPlus?.play?.('overlay', modal.querySelector('.modalCard'));
    return true;
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
      schedulePrompt();
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
    // Yeni PLM işlemi: ertelenen (iptal edilen) Artwork onayları tekrar sorulabilir.
    global.addEventListener('bl:plm-operation-started', () => { state.fetchedAt = 0; state.deferred.clear(); });
    // Özet metni dile bağlıdır (Toplam/Total); dil değişince önbellekten yeniden yazılır.
    // Özet metni dile bağlıdır (Toplam/Total). applyLanguage aktif Koleksiyon'u
    // renderKol ile yeniden çizer; sarmalanmış render önce project() çalıştırır.
    document.addEventListener('bl:language-changed', () => { project(); });
  }

  global.BLCollectionArtworkDetail = {
    key: ART_KEY,
    plmKey: PLM_KEY,
    viewKey: VIEW_KEY,
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
    openEditor,
    conflicts: () => [...state.conflicts.values()],
    promptConflicts,
    editor: { fromText: editorFromText, compose: editorCompose, regions: REGIONS },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})(window);
