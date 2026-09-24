/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — SATIR EŞLEŞTİRME

   Eşleştirme DETERMİNİSTİKTİR. Bir veya birden çok eşlenmiş alandan
   kurulan anahtar birebir karşılaştırılır. Benzerlik (fuzzy) burada
   YALNIZ öneri üretir; hiçbir koşulda "Exact" sayılmaz ve hiçbir koşulda
   otomatik yazmaya dönüşmez.

   Sınıflar:
     exact     → 1 gelen satır ↔ 1 Buyer Log satırı
     ambiguous → 1 gelen satır ↔ birden çok Buyer Log satırı (otomatik yazma YOK)
     none      → hedefte karşılığı yok
     invalid   → anahtar kurulamadı (kimlik alanı boş/geçersiz)

   Ayrıca iki ayrı çakışma yüzeye çıkarılır:
     incomingDuplicates → aynı anahtarı taşıyan birden çok Excel satırı
     reverseDuplicates  → farklı Excel satırlarının AYNI Buyer Log satırına
                          düşmesi (first-wins/last-wins sessizce UYGULANMAZ)
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelImportMatch = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SEP = '␟';
  var TR_MAP = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function token(value) {
    return text(value)
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (ch) { return TR_MAP[ch] || ch; })
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  /* KİMLİK NORMALİZASYONU.

     Kod/kimlik alanları SAYI DEĞİLDİR. "0123" ile "123" farklı kimliklerdir
     ve buradaki normalizasyon baştaki sıfırı KORUR. Excel'in bir hücreyi
     sayıya çevirmesi sonucu oluşan "123.0" gibi kuyruklar yalnız ondalık
     sıfır olduğunda temizlenir — bu bir sayı yorumu değil, Excel biçim
     artığının atılmasıdır. */
  function normalizeKeyValue(value, dataType) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      var pad = function (x) { return String(x).padStart(2, '0'); };
      return value.getFullYear() + '-' + pad(value.getMonth() + 1) + '-' + pad(value.getDate());
    }
    var raw = text(value);
    if (!raw) return '';
    if (dataType === 'code' || dataType === 'code/id') {
      if (/^[-+]?\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, '');
      return token(raw).replace(/\s+/g, '');
    }
    if (dataType === 'number' || dataType === 'decimal' || dataType === 'integer' || dataType === 'quantity' || dataType === 'currency') {
      var numeric = Number(raw.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(numeric) ? String(numeric) : token(raw);
    }
    return token(raw);
  }

  function keyOf(values, fields) {
    var parts = fields.map(function (field) { return normalizeKeyValue(values[field.id], field.dataType); });
    if (parts.every(function (part) { return part === ''; })) return '';
    // Kısmi anahtar kabul edilmez: bileşik anahtarda tek parça boşsa kimlik
    // eksiktir ve eşleştirme yapılamaz.
    if (parts.some(function (part) { return part === ''; })) return '';
    return parts.join(SEP);
  }

  function buildTargetIndex(targetRows, matchFields, readValue) {
    var index = new Map(), missing = [];
    (Array.isArray(targetRows) ? targetRows : []).forEach(function (row, position) {
      var values = {};
      matchFields.forEach(function (field) { values[field.id] = readValue(row, field.id); });
      var key = keyOf(values, matchFields);
      if (!key) { missing.push({ position: position, row: row }); return; }
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({ position: position, row: row, key: key });
    });
    return { index: index, missingKey: missing, fields: matchFields.slice() };
  }

  /* Benzer ama EŞİT OLMAYAN anahtarlar için öneri. Yalnız tek parçalı
     anahtarlarda ve yalnız çok yüksek benzerlikte üretilir; sonucu
     "exact" değil "suggestion"dır. */
  function nearestKeys(key, index, limit) {
    var mapping = root && root.BLExcelImportMapping;
    if (!mapping || typeof mapping.similarity !== 'function') return [];
    var out = [];
    index.forEach(function (entries, candidate) {
      var score = mapping.similarity(key, candidate);
      if (score >= 0.88 && score < 1) out.push({ key: candidate, score: Math.round(score * 1000) / 1000, count: entries.length });
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, limit || 3);
  }

  function classifyMatches(spec) {
    var source = spec || {};
    var incoming = Array.isArray(source.incoming) ? source.incoming : [];
    var matchFields = Array.isArray(source.matchFields) ? source.matchFields : [];
    var target = source.targetIndex || { index: new Map() };
    var results = [], byKey = new Map(), byTarget = new Map();

    incoming.forEach(function (item) {
      var key = keyOf(item.values || {}, matchFields);
      if (!key) {
        results.push({ sourceRowId: item.id, excelRow: item.excelRow, key: '', status: 'invalid', reason: 'missing-identifier', targets: [] });
        return;
      }
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item.id);
      var hits = target.index.get(key) || [];
      if (!hits.length) {
        results.push({
          sourceRowId: item.id, excelRow: item.excelRow, key: key, status: 'none', targets: [],
          suggestions: nearestKeys(key, target.index, 3),
        });
        return;
      }
      if (hits.length === 1) {
        var position = hits[0].position;
        if (!byTarget.has(position)) byTarget.set(position, []);
        byTarget.get(position).push(item.id);
        results.push({ sourceRowId: item.id, excelRow: item.excelRow, key: key, status: 'exact', targets: [{ position: position, row: hits[0].row }] });
        return;
      }
      // Belirsiz eşleşme: İLK SONUÇ ASLA otomatik seçilmez.
      results.push({
        sourceRowId: item.id, excelRow: item.excelRow, key: key, status: 'ambiguous',
        targets: hits.map(function (hit) { return { position: hit.position, row: hit.row }; }),
      });
    });

    var incomingDuplicates = [];
    byKey.forEach(function (ids, key) {
      if (ids.length > 1) incomingDuplicates.push({ key: key, sourceRowIds: ids.slice() });
    });
    var reverseDuplicates = [];
    byTarget.forEach(function (ids, position) {
      if (ids.length > 1) reverseDuplicates.push({ targetPosition: position, sourceRowIds: ids.slice() });
    });

    return {
      results: results,
      incomingDuplicates: incomingDuplicates,
      reverseDuplicates: reverseDuplicates,
      counts: results.reduce(function (acc, item) { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, { exact: 0, ambiguous: 0, none: 0, invalid: 0 }),
    };
  }

  return {
    SEPARATOR: SEP,
    normalizeKeyValue: normalizeKeyValue,
    keyOf: keyOf,
    buildTargetIndex: buildTargetIndex,
    classifyMatches: classifyMatches,
    nearestKeys: nearestKeys,
  };
}));
