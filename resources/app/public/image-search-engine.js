/* ===================================================================
   TABLO ARAMASI — GÖRSELDEN ARAMA (saf motor)

   CP / Siparişler / Koleksiyon arama kutusuna yapıştırılan ekran
   görüntüsünü LCW AI okur ve "kullanıcı ne arıyor?" sorusuna aday değerler
   önerir ("image-search" sözleşmesi). Bu öneri YETKİ DEĞİLDİR:
   - Her aday, tablonun gerçek arama alanlarında (ekrandaki aramayla aynı
     eşleşme kuralı) aranır; hiçbir kayda uymayan değer sorguya girmez ve
     "bulunamadı" olarak gösterilir. Okuma hatası (0/O, Z4/24) sonuca karışmaz.
   - Ürün sınıfı ön eki ("PNT,LUCAS-YD") gibi biçim farkları için
     deterministik bir ikinci deneme yapılır (son virgülden sonrası).
   - Arama dilini bozacak işaretler (", " / "; " ayırıcıları, başta ! veya /,
     parantez) değerden temizlenir; değer hep düz "içerir" ölçütüdür.
   - Sorgu arama kutusuna yalnız kullanıcı önizleyip onayladıktan sonra yazılır.

   Bu dosya DOM'a dokunmaz; public/image-search.js akışı onu çağırır.
   =================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLImageSearchEngine = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const SEARCH_INPUTS = Object.freeze({ cpSearch: 'cp', ordersSearch: 'orders', kolSearch: 'koleksiyon' });
  const MAX_VALUES = 200;
  const MAX_VALUE_CHARS = 120;
  // Tek-iki karakterlik değer ("içerir" eşleşmesiyle) tablonun çoğuna uyar.
  const MIN_VALUE_CHARS = 3;
  // Ürün sınıfı öneki: PNT, SWT, UK.TSH, KK.BDY…
  const CLASS_PREFIX = /^[A-Za-zÇĞİÖŞÜçğıöşü]{2,6}(\.[A-Za-zÇĞİÖŞÜçğıöşü]{2,6})?$/;
  const MAX_EXAMPLES = 4;
  const EXAMPLE_SCAN_ROWS = 3000;

  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const foldKey = value => clean(value).toLocaleUpperCase('tr-TR');

  function tabForInput(id) {
    return Object.prototype.hasOwnProperty.call(SEARCH_INPUTS, id) ? SEARCH_INPUTS[id] : '';
  }

  /* Tek bir aday → arama dilinde tek, düz ölçüt. */
  function cleanValue(value) {
    let text = clean(value)
      .replace(/([,;])\s+/g, '$1')
      .replace(/^[!/]+/, '')
      .replace(/^[([{]+|[)\]}]+$/g, '')
      .replace(/[,;]+$/, '');
    text = clean(text);
    return text.length >= MIN_VALUE_CHARS && text.length <= MAX_VALUE_CHARS ? text : '';
  }

  function cleanValues(list) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : (list == null ? [] : [list])) {
      const value = cleanValue(item);
      const key = foldKey(value);
      if (!value || seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= MAX_VALUES) break;
    }
    return out;
  }

  /* "PNT,LUCAS-YD" → ["PNT,LUCAS-YD", "LUCAS-YD"]. Yalnız ürün sınıfı
     önekinden sonrası denenir: "12,50" ya da "A,B" kısa parçaya düşmez. */
  function variantsFor(value) {
    const variants = [value];
    const comma = value.indexOf(',');
    if (comma > 0 && CLASS_PREFIX.test(value.slice(0, comma))) {
      const tail = clean(value.slice(comma + 1));
      if (tail.length >= MIN_VALUE_CHARS && /[A-Za-z]/.test(tail) && !tail.includes(',')) variants.push(tail);
    }
    return variants;
  }

  /* LCW AI bağlamı: tablonun gerçek arama alanları ve her alanın birkaç
     örnek değeri (biçimi tanısın diye). space: app-main searchSpace(tab). */
  function aiContext(space) {
    const fields = (space && Array.isArray(space.fields) ? space.fields : []).map(field => {
      const examples = [];
      const seen = new Set();
      const rows = Array.isArray(space.rows) ? space.rows : [];
      for (let index = 0; index < rows.length && index < EXAMPLE_SCAN_ROWS && examples.length < MAX_EXAMPLES; index++) {
        let value = '';
        try { value = clean(space.valueOf(rows[index], field.key)).slice(0, 60); } catch (_) { value = ''; }
        const key = foldKey(value);
        if (!value || seen.has(key)) continue;
        seen.add(key);
        examples.push(value);
      }
      return { label: clean(field.label || field.key), examples };
    }).filter(field => field.label);
    return { screen: space && space.tab || '', rowCount: space && Array.isArray(space.haystacks) ? space.haystacks.length : 0, searchableFields: fields };
  }

  /* data: LCW AI cevabı { values, field, explanation }.
     space: { haystacks: string[] }, matches(haystack, value) → boolean. */
  function validate(data, space, matches) {
    const haystacks = space && Array.isArray(space.haystacks) ? space.haystacks : [];
    const values = cleanValues(data && data.values);
    const found = [];
    const missing = [];
    const usedQueries = new Set();
    for (const value of values) {
      let hit = null;
      for (const variant of variantsFor(value)) {
        let count = 0;
        for (const haystack of haystacks) if (matches(haystack, variant)) count++;
        if (count) { hit = { value, query: variant, count }; break; }
      }
      if (!hit) { missing.push(value); continue; }
      const key = foldKey(hit.query);
      if (usedQueries.has(key)) continue;
      usedQueries.add(key);
      found.push(hit);
    }
    const queries = found.map(item => item.query);
    let rowCount = 0;
    if (queries.length) for (const haystack of haystacks) if (queries.some(query => matches(haystack, query))) rowCount++;
    return {
      ok: found.length > 0,
      field: clean(data && data.field).slice(0, 80),
      found,
      missing,
      query: queries.join(', '),
      rowCount,
    };
  }

  return Object.freeze({ SEARCH_INPUTS, MAX_VALUES, tabForInput, cleanValue, cleanValues, variantsFor, aiContext, validate });
}));
