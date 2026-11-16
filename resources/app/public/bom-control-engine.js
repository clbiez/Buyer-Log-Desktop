/* Buyer Log — BOM Kontrol motoru (saf, DOM/ağ bilmez).
 *
 * CP'de seçilen kırılım (ör. Kategori → Lisans → Kumaş) her grupta modellerin
 * BOM kalemlerini karşılaştırır. Karşılaştırma birimi "slot"tur: BOM satırının
 * kategori yolu (Ana Kategori › Kategori Grubu › Kategori). Bir slotta grubun
 * çoğunluğunun kullandığı kod "baskın" koddur; baskın kodu taşımayan veya
 * azınlık kodu taşıyan model sapmadır. Örn. S6'dan kopyalanıp eski etiket
 * koduyla kalmış model ya da 30 modelden birkaçında farklı kodla açılmış
 * kumaş.
 *
 * Kullanıcı slotu "Ortak" ya da "Model bazlı" işaretler; işaret kod değil
 * kategori yoluna bağlıdır, böylece kodlar sezon sezon değişse de geçerli
 * kalır. İşaretsiz slot otomatik yorumlanır: baskın kod grubun en az
 * AUTO_COMMON_RATIO'sunda varsa olası sapma (uyarı), yoksa model bazlı sayılır.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLBomControlEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SLOT_LEVELS = Object.freeze(['main', 'group', 'category']);
  const MARKS = Object.freeze(['common', 'model']);
  const AUTO_COMMON_RATIO = 0.6;
  const MIN_AUTO_GROUP = 3;
  const EMPTY_VALUE = '\u0000';
  const MAX_MARKS = 2000;
  const collator = new Intl.Collator('tr', { numeric: true });
  const compare = (a, b) => collator.compare(String(a), String(b));

  function clean(value, max = 300) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function norm(value) {
    return clean(value, 500).toLocaleLowerCase('tr-TR');
  }
  function slotLevel(value) {
    return SLOT_LEVELS.includes(value) ? value : 'category';
  }

  /* Slot yolu: seçilen düzeye kadar dolu kategori adları. Takım (Set Style)
     parçası analiz anahtarına girer (A:Kumaş ile B:Kumaş ayrı karşılaştırılır)
     ama işaret anahtarına girmez: "Kumaş ortak" işareti tüm parçalara uyar. */
  /* Aynı bileşen her kırılım düğümünde yeniden analiz edilir; yerel ayarlı
     küçük harf dönüşümü pahalıdır. Sonuç bileşen nesnesi + düzey başına
     önbelleğe alınır (nesne değişmez kabul edilir; çağıran yeni veriyle yeni
     nesne üretir). */
  const slotCache = new WeakMap();
  const codeCache = new WeakMap();
  function slotOf(component, level) {
    const lvl = slotLevel(level);
    const cacheable = component && typeof component === 'object';
    const cached = cacheable && slotCache.get(component);
    if (cached && cached[lvl]) return cached[lvl];
    const value = computeSlot(component, lvl);
    if (cacheable) slotCache.set(component, { ...(cached || {}), [lvl]: value });
    return value;
  }
  function computeSlot(component, lvl) {
    const raw = [component && component.mainCategoryName];
    if (lvl !== 'main') raw.push(component && component.categoryGroupName);
    if (lvl === 'category') raw.push(component && component.categoryName);
    const parts = raw.map(item => clean(item, 160)).filter(Boolean);
    const label = parts.length ? parts.join(' › ') : '—';
    const markKey = lvl + ':' + (parts.length ? parts.map(norm).join('>') : '-');
    const part = clean(component && component.setPart, 20);
    return { markKey, key: (part ? part + '|' : '') + markKey, label, part };
  }
  function codeOf(component) {
    if (!component || typeof component !== 'object') return null;
    if (codeCache.has(component)) return codeCache.get(component);
    const value = computeCode(component);
    codeCache.set(component, value);
    return value;
  }
  function computeCode(component) {
    const code = clean(component && component.componentCode, 120);
    const name = clean(component && component.componentName, 300);
    const description = clean(component && component.description, 300);
    const identity = code || name || description;
    return identity ? { key: norm(identity), code: code || identity, name, description } : null;
  }

  function normalizeMarks(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [key, value] of Object.entries(raw).slice(0, MAX_MARKS)) {
      const k = clean(key, 600);
      if (k && MARKS.includes(value)) out[k] = value;
    }
    return out;
  }

  /* models: [{ plmId, label, components:[...], hasBom }]
     İki aşama: aggregate() modelleri slot/kod dağılımına toplar (pahalı; yalnız
     kapsam veya kalem düzeyi değişince); evaluate() işaretlere göre durum ve
     sapmaları çıkarır (ucuz; her işaret tıklamasında). analyze() ikisini
     birlikte çağırır. Sonuç yalnız verilen model kümesine aittir. */
  function aggregate(models, slotLevelValue) {
    const level = slotLevel(slotLevelValue);
    const list = Array.isArray(models) ? models : [];
    // Tam okunmuş boş BOM da karşılaştırmaya girer (ortak kalemleri 'absent' olur).
    const withBom = list.filter(model => model && model.hasBom && Array.isArray(model.components));
    const withSet = new Set(withBom);
    const noBom = list.filter(model => !withSet.has(model)).map(model => model && model.plmId).filter(Boolean);
    const n = withBom.length;
    const slots = new Map();

    for (const model of withBom) {
      for (const component of model.components) {
        const code = codeOf(component);
        if (!code) continue;
        const slot = slotOf(component, level);
        let entry = slots.get(slot.key);
        if (!entry) {
          entry = { key: slot.key, markKey: slot.markKey, label: slot.label, part: slot.part, models: new Set(), codes: new Map() };
          slots.set(slot.key, entry);
        }
        entry.models.add(model.plmId);
        let item = entry.codes.get(code.key);
        if (!item) {
          item = { key: code.key, code: code.code, name: code.name, description: code.description, models: new Set(), qty: new Map() };
          entry.codes.set(code.key, item);
        }
        item.models.add(model.plmId);
        if (!item.name && code.name) item.name = code.name;
        if (!item.description && code.description) item.description = code.description;
        const quantity = Number(component.quantity);
        if (component.quantity != null && Number.isFinite(quantity)) {
          // Aynı modelde aynı kod birden çok satırda geçebilir: toplanır.
          item.qty.set(model.plmId, (item.qty.get(model.plmId) || 0) + quantity);
        }
      }
    }

    const out = [];
    for (const entry of slots.values()) {
      const codes = [...entry.codes.values()].map(item => {
        const counts = new Map();
        for (const value of item.qty.values()) {
          const rounded = Math.round(value * 10000) / 10000;
          counts.set(rounded, (counts.get(rounded) || 0) + 1);
        }
        return {
          key: item.key,
          code: item.code,
          name: item.name,
          description: item.description,
          count: item.models.size,
          ratio: n ? item.models.size / n : 0,
          plmIds: [...item.models],
          majority: n > 0 && item.models.size / n > 0.5,
          quantities: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value - b.value),
        };
      }).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
      out.push({ key: entry.key, markKey: entry.markKey, label: entry.label, part: entry.part, models: entry.models, codeModels: entry.codes, codes });
    }
    out.sort((a, b) => compare(a.part, b.part) || compare(a.label, b.label));
    return { slotLevel: level, modelCount: list.length, bomPlmIds: withBom.map(model => model.plmId), noBom, slots: out };
  }

  function evaluate(agg, options = {}) {
    const marks = normalizeMarks(options.marks);
    const autoRatio = Number.isFinite(Number(options.autoRatio)) ? Number(options.autoRatio) : AUTO_COMMON_RATIO;
    const bomPlmIds = agg.bomPlmIds;
    const n = bomPlmIds.length;
    const flagged = new Map();
    const out = [];
    for (const entry of agg.slots) {
      const codes = entry.codes;
      const mark = marks[entry.markKey] || '';
      const top = codes[0] || null;
      const majorities = codes.filter(item => item.majority);
      let mode;
      if (mark === 'model') mode = 'model';
      else if (mark === 'common') mode = majorities.length ? 'common' : 'scattered';
      else mode = n >= MIN_AUTO_GROUP && top && top.ratio >= autoRatio ? 'auto-common' : 'auto-model';

      const findings = [];
      if (mode === 'common' || mode === 'auto-common') {
        const severity = mode === 'common' ? 'error' : 'warning';
        const has = (item, plmId) => entry.codeModels.get(item.key).models.has(plmId);
        const minorities = codes.filter(item => !item.majority);
        for (const plmId of bomPlmIds) {
          if (!entry.models.has(plmId)) {
            // Ortak olması beklenen kalem bu modelin BOM'unda hiç yok.
            findings.push({ plmId, kind: 'absent', missing: majorities.map(item => item.code), extra: [], severity });
            continue;
          }
          const missing = majorities.filter(item => !has(item, plmId)).map(item => item.code);
          const extra = minorities.filter(item => has(item, plmId)).map(item => item.code);
          if (missing.length || extra.length) findings.push({ plmId, kind: 'different', missing, extra, severity });
        }
      }
      for (const finding of findings) {
        const prev = flagged.get(finding.plmId) || { errors: 0, warnings: 0 };
        if (finding.severity === 'error') prev.errors += 1; else prev.warnings += 1;
        flagged.set(finding.plmId, prev);
      }
      out.push({
        key: entry.key,
        markKey: entry.markKey,
        label: entry.label,
        part: entry.part,
        mark,
        mode,
        presence: { count: entry.models.size, ratio: n ? entry.models.size / n : 0 },
        codes,
        findings,
      });
    }

    // aggregate() parça/etiket sırasını verir; sıralama kararlıdır.
    const rank = { common: 0, scattered: 1, 'auto-common': 2, 'auto-model': 3, model: 4 };
    out.sort((a, b) => (b.findings.length > 0) - (a.findings.length > 0) || rank[a.mode] - rank[b.mode]);

    let errors = 0, warnings = 0;
    for (const slot of out) for (const finding of slot.findings) {
      if (finding.severity === 'error') errors += 1; else warnings += 1;
    }
    return {
      slotLevel: agg.slotLevel,
      modelCount: agg.modelCount,
      bomModelCount: n,
      noBom: agg.noBom,
      slots: out,
      flagged,
      summary: {
        commonSlots: out.filter(slot => slot.mode === 'common' || slot.mode === 'auto-common').length,
        modelSlots: out.filter(slot => slot.mode === 'model' || slot.mode === 'auto-model').length,
        scatteredSlots: out.filter(slot => slot.mode === 'scattered').length,
        errors,
        warnings,
        flaggedModels: flagged.size,
      },
    };
  }

  function analyze(models, options = {}) {
    return evaluate(aggregate(models, options.slotLevel), options);
  }

  /* Kırılım ağacı. levels: model.dims anahtarları (sırayla). Boş değerler
     kendi düğümünde toplanır; çağıran etiketi (Boş) olarak çevirir. */
  function buildTree(models, levels) {
    const keys = (Array.isArray(levels) ? levels : []).map(item => clean(item, 120)).filter(Boolean);
    const rootNode = { id: '', depth: 0, field: '', value: '', path: [], models: [], children: [] };
    const byId = new Map([['', rootNode]]);
    for (const model of Array.isArray(models) ? models : []) {
      rootNode.models.push(model);
      let parent = rootNode;
      keys.forEach((field, index) => {
        const value = clean(model && model.dims && model.dims[field], 300) || EMPTY_VALUE;
        const path = parent.path.concat([value]);
        const id = JSON.stringify(path);
        let node = byId.get(id);
        if (!node) {
          node = { id, depth: index + 1, field, value: value === EMPTY_VALUE ? '' : value, path, models: [], children: [] };
          byId.set(id, node);
          parent.children.push(node);
        }
        node.models.push(model);
        parent = node;
      });
    }
    const sortNode = node => {
      node.children.sort((a, b) => (a.value === '') - (b.value === '') || compare(a.value, b.value));
      node.children.forEach(sortNode);
    };
    sortNode(rootNode);
    return { root: rootNode, byId };
  }

  /* CP satırları model/renk bazlıdır; BOM model (PLM ID) bazlıdır. Aynı PLM
     ID'nin satırları tek modelde birleşir; bir kırılım alanında farklı
     değerler varsa sıralı birleşik değer kullanılır. */
  function modelsFromRows(rows, options = {}) {
    const plmIdOf = typeof options.plmIdOf === 'function' ? options.plmIdOf : row => clean(row && row['PLM ID'], 40);
    const labelOf = typeof options.labelOf === 'function' ? options.labelOf : row => clean(row && row['Model Name'], 200);
    const fields = (Array.isArray(options.fields) ? options.fields : []).map(item => clean(item, 120)).filter(Boolean);
    const getValue = typeof options.getValue === 'function' ? options.getValue : (row, field) => row && row[field];
    const byId = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const plmId = plmIdOf(row);
      if (!plmId) continue;
      let model = byId.get(plmId);
      if (!model) {
        model = { plmId, label: '', rowCount: 0, values: new Map() };
        byId.set(plmId, model);
      }
      model.rowCount += 1;
      if (!model.label) model.label = labelOf(row);
      for (const field of fields) {
        const value = clean(getValue(row, field), 300);
        if (!value) continue;
        if (!model.values.has(field)) model.values.set(field, new Set());
        model.values.get(field).add(value);
      }
    }
    return [...byId.values()].map(model => {
      const dims = {};
      for (const [field, values] of model.values) dims[field] = [...values].sort((a, b) => compare(a, b)).join(' / ');
      return { plmId: model.plmId, label: model.label, rowCount: model.rowCount, dims };
    });
  }

  return { SLOT_LEVELS, MARKS, AUTO_COMMON_RATIO, MIN_AUTO_GROUP, slotOf, codeOf, normalizeMarks, aggregate, evaluate, analyze, buildTree, modelsFromRows };
});
