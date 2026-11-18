/* ===================================================================
   ŞEMA AĞACI — Tablo → Görüntü klasörü → Sütun/Ölçü

   ASAS / IAS / INTAKE modellerindeki alanları Excel PivotTable alan
   listesindeki düzende gruplar. Saf modül: DOM'a dokunmaz, veri getirmez.
   "Veri Tabanından Sütun Ekle" penceresi ağacı açılır/kapanır başlıklarla,
   ortak seçici (BLDataPicker) aynı yolu düz liste içinde başlık satırı
   olarak çizer.

   Görüntü klasörü ";" ile birden çok klasör, "\" ile iç içe klasör taşıyabilir
   (SSAS sözleşmesi). Bir alan yalnız İLK klasöründe gösterilir; aynı alanın
   iki yerde görünmesi seçimi belirsizleştirirdi.
   =================================================================== */
(function (root) {
  'use strict';

  function fold(value) {
    return String(value == null ? '' : value).toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function folderPath(folder) {
    const first = String(folder == null ? '' : folder).split(';')[0] || '';
    return first.split('\\').map(part => part.trim()).filter(Boolean);
  }

  /* Bir alanın gruplama yolu: [tablo, ...klasörler]. */
  function entryPath(entry) {
    const table = String(entry && entry.table || '').trim();
    return (table ? [table] : []).concat(folderPath(entry && entry.folder));
  }

  /* Tek Collator: her karşılaştırmada localeCompare seçenek nesnesi kurmak
     binlerce alanlık şemada aramayı tuş başına onlarca ms yavaşlatıyordu. */
  const collator = typeof Intl !== 'undefined' ? new Intl.Collator('tr', { sensitivity: 'base', numeric: true }) : null;
  const compare = (a, b) => (collator ? collator.compare(String(a), String(b)) : String(a).localeCompare(String(b)));

  /* Arama: ad, tablo ve klasör birlikte aranır; tablo adıyla arama o
     tablonun bütün alanlarını getirir (Excel alan listesi davranışı). */
  /* Aranan metin ve ada göre sıralı kopya, girdi dizisi başına BİR KEZ
     hesaplanır. Arama her tuşta yeniden kurulduğu için katlama ve Collator
     sıralamasını tekrarlamak binlerce alanda belirgin gecikmeydi; ön-sıralı
     girdiyle düğüm içi sıralama neredeyse doğrusal çalışır. */
  const prepared = new WeakMap();
  function prepare(entries) {
    let hit = prepared.get(entries);
    if (!hit) {
      const list = entries.filter(entry => entry && String(entry.name || '').trim())
        .map(entry => {
          const path = entryPath(entry);
          return { entry, path, keys: path.map(part => part.toLocaleLowerCase('tr-TR')), text: fold(`${path.join(' ')} ${entry.name || ''}`) };
        });
      list.sort((a, b) => compare(a.entry.name, b.entry.name));
      hit = list;
      prepared.set(entries, hit);
    }
    return hit;
  }

  function matches(entry, query, folded) {
    const q = folded != null ? folded : fold(query);
    if (!q) return true;
    return fold(`${entryPath(entry).join(' ')} ${entry && entry.name || ''}`).includes(q);
  }

  /**
   * @param {Array} entries [{table, name, kind, folder}]
   * @param {Object} options query: arama metni
   * @returns {Array} kök düğümler. Grup: {type:'group', id, name, depth, count, children}
   *                  Yaprak: {type:'leaf', id, depth, entry}
   */
  function build(entries, options = {}) {
    const q = fold(options.query || '');
    const rootNode = { children: [], groups: new Map(), id: '', depth: -1 };
    for (const { entry, text, path, keys } of Array.isArray(entries) ? prepare(entries) : []) {
      if (q && !text.includes(q)) continue;
      let node = rootNode;
      for (let i = 0; i < path.length; i += 1) {
        const part = path[i], key = keys[i];
        let child = node.groups.get(key);
        if (!child) {
          child = { type: 'group', id: `${node.id}/${part}`, name: part, depth: node.depth + 1, count: 0, children: [], groups: new Map() };
          node.groups.set(key, child);
          node.children.push(child);
        }
        node = child;
      }
      node.children.push({ type: 'leaf', id: `${node.id}|${entry.kind || 'column'}|${entry.name}`, depth: node.depth + 1, entry });
    }
    const finish = node => {
      let count = 0;
      /* Excel düzeni: önce sütunlar, sonra ölçüler, en sonda klasörler. */
      const rank = child => (child.type === 'group' ? 2 : child.entry.kind === 'measure' ? 1 : 0);
      /* Yapraklar girdinin ad sırasıyla geldi; yalnız türe göre bölünür
         (doğrusal). Collator yalnız az sayıdaki klasör adını sıralar. */
      const buckets = [[], [], []];
      for (const child of node.children) buckets[rank(child)].push(child);
      buckets[2].sort((a, b) => compare(a.name, b.name));
      node.children = buckets[0].concat(buckets[1], buckets[2]);
      for (const child of node.children) {
        if (child.type === 'group') { finish(child); count += child.count; } else count += 1;
      }
      node.count = count;
      delete node.groups;
      return node;
    };
    return finish(rootNode).children;
  }

  /* Ağacı görünür satırlara açar. isOpen(group) false ise grubun içi atlanır. */
  function flatten(nodes, isOpen = () => true) {
    const out = [];
    const walk = list => {
      for (const node of list) {
        out.push(node);
        if (node.type === 'group' && isOpen(node)) walk(node.children);
      }
    };
    walk(Array.isArray(nodes) ? nodes : []);
    return out;
  }

  /* Bir yaprağın atalarının kimlikleri (seçili alanın grubunu açık başlatmak için). */
  function ancestorIds(entry) {
    const ids = [];
    let id = '';
    for (const part of entryPath(entry)) { id = `${id}/${part}`; ids.push(id); }
    return ids;
  }

  const api = { fold, folderPath, entryPath, matches, build, flatten, ancestorIds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLSchemaTree = api;
})(typeof window !== 'undefined' ? window : globalThis);
