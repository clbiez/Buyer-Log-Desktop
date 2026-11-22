/* ===================================================================
   PİVOT HESAPLANAN DEĞERLERİ — Genel Bakış › Ticari pivot widget'ları

   Kullanıcı talebi: "Bu widgetlara sütunlar arası hesaplanan yeni sütunlar
   eklemem gerek manuel olarak. Tıpkı CP'deki Hesaplanan sütun ekle mantığı
   gibi. Arayüz aynı olabilir."

   Tek ortak modül; OAB (PASS), OAB (Küp), INTAKE ve FOB Sonrası Maliyet aynı
   kodu kullanır. Formül dili, ayrıştırıcı ve editör YENİDEN YAZILMAZ:
   - değerlendirme public/formula-engine.js (BLFormulaEngine, eval yok),
   - editör public/formula-columns.js (BLFormulaColumns.open + adapter).

   İKİ HESAP MODU
   - aggregate ("Toplamlar üzerinden", varsayılan): Excel pivot hesaplanan
     alanı gibi. Formül her pivot satırında (detay, alt toplam, genel toplam)
     o satırın TOPLANMIŞ değer alanlarıyla çalışır. Onaylı / WSSI oranı,
     satır oranlarının ortalaması değil toplamların oranıdır.
   - row ("Satır bazında, sonra topla"): formül her KAYNAK satırda çalışır,
     sonuç toplanır (ör. IF([WSSI]=0,[Onaylı],0)). Yalnız kaynak satırı detay
     düzeyinde olan widget'larda açılır (INTAKE'te kapalıdır).

   Hesaplanan değer sorguya ve önbellek anahtarına girmez; yalnız istemcide
   hesaplanır. Hata sessiz değildir: sıfıra bölme, eksik alan, geçersiz
   formül ve döngü hücrede "—" ve ipucunda sebep olarak görünür; yanlış bir
   sayı gösterilmez. Kod/metin alanları sayıya çevrilmez.

   Düğüm (Node) ortamında da yüklenir: sunucu görünüm normalizasyonu aynı
   doğrulamayı (normalizeList) kullanır.
   =================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.BLPivotCalculatedValues = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const LIMITS = Object.freeze({ max: 20, formula: 2000, label: 120 });
  const MODES = Object.freeze(['aggregate', 'row']);
  const FORMATS = Object.freeze(['auto', 'number', 'integer', 'percent']);
  const KEY_PREFIX = 'calc:';
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;
  // Başvuru anahtarı formülde [anahtar] olarak durur; köşeli parantez ve
  // kontrol karakteri taşıyamaz.
  const REF_PATTERN = /^[^\[\]\u0000-\u001f]{1,200}$/;

  const clean = value => String(value == null ? '' : value).trim();
  const isEnglish = () => typeof root.appLang !== 'undefined' ? root.appLang === 'en' : (typeof appLang !== 'undefined' && appLang === 'en'); // eslint-disable-line no-undef
  const T = (tr, en) => (isEnglish() ? en : tr);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const message = (tr, en) => ({ tr, en });

  function engine() {
    if (root && root.BLFormulaEngine) return root.BLFormulaEngine;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try { return require('./formula-engine.js'); } catch (_) { return null; }
    }
    return null;
  }

  const keyOf = def => `${KEY_PREFIX}${def && def.id}`;
  const isKey = key => String(key || '').startsWith(KEY_PREFIX);
  const idOfKey = key => (isKey(key) ? String(key).slice(KEY_PREFIX.length) : '');
  const labelOf = def => clean(isEnglish() ? (def.labelEn || def.label || def.labelTr) : (def.labelTr || def.label || def.labelEn)) || clean(def && def.id);
  const modeText = mode => (mode === 'row' ? T('Satır bazında, sonra topla', 'Per row, then sum') : T('Toplamlar üzerinden', 'On totals'));
  const toSet = list => (list == null ? null : new Set((list instanceof Set ? [...list] : Array.isArray(list) ? list : []).map(String)));

  /* ---------------- tanım doğrulama (istemci + sunucu) ----------------

     options.aggregateKeys / rowKeys: bilinen alan anahtarları. Verilmezse
     yalnız biçim denetlenir. refs (anahtar → son bilinen ad) yalnız bilinen
     anahtarları tutar; formül metni korunur — pivottan çıkarılmış bir alan
     hücrede "—" ve "alan pivotta yok" olarak görünür, tanım sessizce
     silinmez. allowRow=false iken satır bazlı tanım düşer: onu toplamlar
     üzerinden hesaplamak anlamını değiştirir (yanlış sayı). */
  function normalizeList(raw, options = {}) {
    const allowRow = options.allowRow !== false;
    const aggregateKeys = toSet(options.aggregateKeys);
    const rowKeys = toSet(options.rowKeys);
    const candidates = [];
    const seen = new Set();
    for (const item of Array.isArray(raw) ? raw : []) {
      if (candidates.length >= LIMITS.max) break;
      if (!item || typeof item !== 'object') continue;
      const id = clean(item.id);
      if (!ID_PATTERN.test(id) || seen.has(id)) continue;
      const formula = typeof item.formula === 'string' ? item.formula.trim() : '';
      if (!formula || formula.length > LIMITS.formula) continue;
      const labelTr = clean(item.labelTr).slice(0, LIMITS.label);
      const labelEn = clean(item.labelEn).slice(0, LIMITS.label);
      const label = (clean(item.label) || labelTr || labelEn).slice(0, LIMITS.label);
      if (!label) continue;
      const mode = clean(item.mode) || 'aggregate';
      if (!MODES.includes(mode) || (mode === 'row' && !allowRow)) continue;
      const format = FORMATS.includes(clean(item.format)) ? clean(item.format) : 'auto';
      const rawDecimals = clean(item.decimals);
      const decimals = rawDecimals !== '' && /^\d$/.test(rawDecimals) && Number(rawDecimals) <= 6 ? rawDecimals : '';
      seen.add(id);
      candidates.push({ id, label, labelTr, labelEn, formula, mode, format, decimals, refs: item.refs });
    }
    const calcKeys = new Set(candidates.map(keyOf));
    const rowCalcKeys = new Set(candidates.filter(item => item.mode === 'row').map(keyOf));
    return candidates.map(item => {
      const known = item.mode === 'row' ? rowKeys : aggregateKeys;
      const refs = {};
      const source = item.refs && typeof item.refs === 'object' && !Array.isArray(item.refs) ? item.refs : {};
      for (const [key, name] of Object.entries(source).slice(0, 200)) {
        if (!REF_PATTERN.test(key) || key === keyOf(item)) continue;
        const calc = item.mode === 'row' ? rowCalcKeys.has(key) : calcKeys.has(key);
        if (!calc && known && !known.has(key)) continue;
        if (!calc && isKey(key)) continue;
        refs[key] = clean(name).slice(0, LIMITS.label) || key;
      }
      return { ...item, refs };
    });
  }

  /* Bağımlılık denetimi (kayıt öncesi): döngü ve satır bazlı tanımın toplam
     tanımına başvurması engellenir. */
  function columnsOf(def) {
    const E = engine();
    if (E) {
      const program = E.compile(def.formula);
      if (program.ok) return program.columns;
    }
    return Object.keys(def.refs || {});
  }
  function graphError(defs) {
    const list = Array.isArray(defs) ? defs : [];
    const byKey = new Map(list.map(def => [keyOf(def), def]));
    for (const def of list) {
      if (def.mode !== 'row') continue;
      const wrong = columnsOf(def).find(key => byKey.has(key) && byKey.get(key).mode !== 'row');
      if (wrong) return message(`“${labelOf(def)}” satır bazında hesaplanır; toplamlar üzerinden hesaplanan “${labelOf(byKey.get(wrong))}” değerini kullanamaz.`, `“${labelOf(def)}” is calculated per row; it cannot use “${labelOf(byKey.get(wrong))}”, which is calculated on totals.`);
    }
    const state = new Map();
    const visit = key => {
      if (state.get(key) === 1) return true;
      if (state.get(key) === 2) return false;
      state.set(key, 1);
      const def = byKey.get(key);
      const cyclic = columnsOf(def).some(dep => byKey.has(dep) && visit(dep));
      state.set(key, 2);
      return cyclic;
    };
    for (const def of list) {
      if (visit(keyOf(def))) return message(`“${labelOf(def)}” döngüsel başvuru içeriyor: hesaplanan değerler birbirini çevrimli kullanamaz.`, `“${labelOf(def)}” has a circular reference: calculated values cannot use each other in a loop.`);
    }
    return null;
  }

  /* Satır bazlı tanımların ihtiyaç duyduğu kaynak alanlar (sorgu için). */
  function requiredRowKeys(defs) {
    const keys = new Set();
    for (const def of Array.isArray(defs) ? defs : []) {
      if (!def || def.mode !== 'row') continue;
      columnsOf(def).forEach(key => { if (!isKey(key)) keys.add(key); });
    }
    return [...keys];
  }

  /* ---------------- değerlendirme ---------------- */

  function friendly(result, def, label) {
    const name = key => (def.refs && def.refs[key]) || (label && label(key)) || key;
    if (result.missing && result.missing.length) {
      const list = result.missing.map(name).join(', ');
      return message(`Alan bu pivotta yok: ${list}`, `Field not in this pivot: ${list}`);
    }
    if (result.code === 'DIVIDE_BY_ZERO') return message('Sıfıra bölme', 'Division by zero');
    if (result.code === 'CALC_CYCLE') return message('Döngüsel başvuru', 'Circular reference');
    if (result.code === 'CALC_TEXT_FIELD') return message(`Kod/metin alanı hesaplamada kullanılamaz: ${name(result.field)}`, `A code/text field cannot be used in a calculation: ${name(result.field)}`);
    if (result.code === 'CALC_ROW_AGGREGATE') return message('Satır bazındaki değer, toplamlar üzerinden hesaplanan değeri kullanamaz', 'A per-row value cannot use a value calculated on totals');
    const detail = clean(result.error);
    return message(`Formül hesaplanamadı: ${detail}`, `The formula could not be calculated: ${detail}`);
  }
  function fail(code, extra) { return Object.assign(new Error(code), { code, ...(extra || {}) }); }
  function numericResult(value) {
    if (value == null || value === '') return { ok: true, value: null };
    if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: message('Sonuç sonlu bir sayı değil', 'The result is not a finite number') };
    return { ok: false, error: message('Sonuç sayı değil (metin ya da tarih); pivotta toplanamaz', 'The result is not a number (text or date); it cannot be totalled in a pivot') };
  }
  function cellNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const E = engine();
    const number = E ? E.toNumber(value) : Number(value);
    return number == null || !Number.isFinite(number) ? null : number;
  }

  /* createEvaluator(defs, options)
     options.readRow(row, key) → kaynak satır değeri; undefined = alan yok.
     options.isTextKey(key)   → kod/metin alanı (hesaplamaya girmez).
     options.label(key)       → hata metninde alan adı.
     Tanım yoksa null döner: widget'ın sıcak yolu hiç değişmez. */
  function createEvaluator(defs, options = {}) {
    const list = (Array.isArray(defs) ? defs : []).filter(def => def && def.id && def.formula);
    if (!list.length) return null;
    const E = engine();
    const entries = new Map(list.map(def => [keyOf(def), { def, key: keyOf(def), program: E ? E.compile(def.formula) : null }]));
    const readRow = typeof options.readRow === 'function' ? options.readRow : (row, key) => (row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined);
    const isTextKey = typeof options.isTextKey === 'function' ? options.isTextKey : () => false;
    const rowCache = new WeakMap();
    const noEngine = message('Formül motoru yüklenmedi; sayfayı yenileyin', 'The formula engine is not loaded; reload the page');

    function evaluateRow(entry, row, active) {
      let cache = rowCache.get(row);
      if (!cache) { cache = new Map(); rowCache.set(row, cache); }
      if (cache.has(entry.key)) return cache.get(entry.key);
      if (!entry.program) return { ok: false, error: noEngine };
      if (!entry.program.ok) return { ok: false, error: message(`Geçersiz formül: ${entry.program.error.message}`, `Invalid formula: ${entry.program.error.message}`) };
      active.add(entry.key);
      let outcome;
      // Motor, lookup içinden atılan hatayı yakalayıp yalnız metnini döndürür;
      // asıl sebep (bağımlılık, kod alanı, döngü) burada saklanır.
      let signal = null;
      const stop = (code, extra) => { signal = fail(code, extra); throw signal; };
      try {
        const result = entry.program.evaluate(row, {
          numeric: true,
          lookup: key => {
            const dep = entries.get(key);
            if (dep) {
              if (dep.def.mode !== 'row') stop('CALC_ROW_AGGREGATE');
              if (active.has(dep.key)) stop('CALC_CYCLE');
              const inner = evaluateRow(dep, row, active);
              if (!inner.ok) stop('CALC_DEPENDENCY', { inner });
              return inner.value;
            }
            if (isTextKey(key)) stop('CALC_TEXT_FIELD', { field: key });
            const value = readRow(row, key);
            return value === undefined ? undefined : cellNumber(value);
          },
        });
        outcome = result.ok ? numericResult(result.value) : failure(result, signal, entry.def);
      } finally { active.delete(entry.key); }
      // Hata bağımlılıktan geliyorsa motorun "Sütun bulunamadı" metni yerine
      // asıl sebep taşınır.
      cache.set(entry.key, outcome);
      return outcome;
    }

    function failure(result, signal, def) {
      if (signal && signal.inner) return signal.inner;
      if (signal) return { ok: false, error: friendly({ code: signal.code, field: signal.field }, def, options.label) };
      return { ok: false, error: friendly(result, def, options.label) };
    }

    function rowTotal(entry, sourceRows) {
      const rows = Array.isArray(sourceRows) ? sourceRows : [];
      let sum = 0, seen = false, failed = 0, firstError = null;
      for (const row of rows) {
        const result = evaluateRow(entry, row, new Set());
        if (!result.ok) { failed += 1; if (!firstError) firstError = result.error; continue; }
        if (result.value == null) continue;
        sum += result.value; seen = true;
      }
      if (failed) {
        return { ok: false, error: message(`${failed.toLocaleString('tr-TR')} kaynak satırda hesaplanamadı: ${firstError.tr}`, `Could not be calculated on ${failed.toLocaleString('en-GB')} source row${failed === 1 ? '' : 's'}: ${firstError.en}`) };
      }
      return { ok: true, value: seen ? sum : null };
    }

    /* Bir pivot satırının hesaplanan değerleri. base: o satırın toplanmış
       değer alanları ({anahtar: sayı}); sourceRows: satırın kaynak satırları. */
    function compute(base, sourceRows) {
      const values = {}, errors = {};
      const memo = new Map();
      const metrics = base && typeof base === 'object' ? base : {};
      const resolve = (entry, active) => {
        if (memo.has(entry.key)) return memo.get(entry.key);
        let outcome;
        if (entry.def.mode === 'row') outcome = rowTotal(entry, sourceRows);
        else if (!entry.program) outcome = { ok: false, error: noEngine };
        else if (!entry.program.ok) outcome = { ok: false, error: message(`Geçersiz formül: ${entry.program.error.message}`, `Invalid formula: ${entry.program.error.message}`) };
        else if (active.has(entry.key)) outcome = { ok: false, error: friendly({ code: 'CALC_CYCLE' }, entry.def) };
        else {
          active.add(entry.key);
          let signal = null;
          const stop = (code, extra) => { signal = fail(code, extra); throw signal; };
          try {
            const result = entry.program.evaluate(metrics, {
              numeric: true,
              lookup: key => {
                const dep = entries.get(key);
                if (dep) {
                  const inner = resolve(dep, active);
                  if (!inner.ok) stop('CALC_DEPENDENCY', { inner });
                  return inner.value;
                }
                if (isTextKey(key)) stop('CALC_TEXT_FIELD', { field: key });
                if (!Object.prototype.hasOwnProperty.call(metrics, key)) return undefined;
                return cellNumber(metrics[key]);
              },
            });
            outcome = result.ok ? numericResult(result.value) : failure(result, signal, entry.def);
          } finally { active.delete(entry.key); }
        }
        memo.set(entry.key, outcome);
        return outcome;
      };
      for (const entry of entries.values()) {
        const outcome = resolve(entry, new Set());
        values[entry.key] = outcome.ok ? outcome.value : null;
        if (!outcome.ok) errors[entry.key] = outcome.error;
      }
      return { values, errors };
    }

    /* Widget'ın metrics nesnesine değerleri yazar; hatalar sayılmayan
       (enumerable olmayan) bir alanda taşınır ki toplam/sıralama döngüleri
       onları sayı sanmasın. */
    function apply(metrics, sourceRows) {
      const target = metrics && typeof metrics === 'object' ? metrics : {};
      const { values, errors } = compute(target, sourceRows);
      Object.assign(target, values);
      Object.defineProperty(target, '__calcErrors', { value: errors, enumerable: false, configurable: true, writable: true });
      return target;
    }

    /* Tek kaynak satırdaki satır bazlı değer (alt detay çekmecesi sütunu). */
    function rowValue(key, row) {
      const entry = entries.get(key);
      if (!entry || entry.def.mode !== 'row' || !row) return null;
      const result = evaluateRow(entry, row, new Set());
      return result.ok ? result.value : null;
    }

    return { defs: list, keys: [...entries.keys()], compute, apply, rowValue, hasRowMode: list.some(def => def.mode === 'row') };
  }

  function errorOf(metrics, key) {
    const errors = metrics && metrics.__calcErrors;
    return errors && errors[key] ? errors[key] : null;
  }
  const errorText = error => (error ? (isEnglish() ? error.en : error.tr) : '');

  /* Biçim: CP hesaplanan sütunuyla aynı (BLFormulaColumns.formatValue). */
  function format(value, def) {
    if (value == null || value === '') return '';
    const fc = root && root.BLFormulaColumns;
    if (fc && typeof fc.formatValue === 'function') return fc.formatValue(value, def);
    const decimals = def && def.decimals !== '' && def.decimals != null ? Number(def.decimals) : null;
    const fmt = def && def.format;
    const digits = decimals != null ? decimals : fmt === 'integer' ? 0 : fmt === 'percent' ? 1 : Number.isInteger(value) ? 0 : 2;
    const text = Number(value).toLocaleString(isEnglish() ? 'en-GB' : 'tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return fmt === 'percent' ? `${text}%` : text;
  }
  /* Hücre: { text, title, error }. Hata "—" ve sebep ipucudur. */
  function cell(metrics, def, options = {}) {
    const key = keyOf(def);
    const error = errorOf(metrics, key);
    const base = `${labelOf(def)} · ${modeText(def.mode)}`;
    if (error) return { text: '—', title: `${base} — ${errorText(error)}`, error: true };
    const value = metrics ? metrics[key] : null;
    return { text: format(value, def), title: options.title || base, error: false, value: value == null ? null : value };
  }
  /* Excel'e DEĞER olarak yazılır (formül değil); hata boş hücredir. */
  function exportValue(metrics, def) {
    const key = keyOf(def);
    if (errorOf(metrics, key)) return null;
    const value = metrics ? metrics[key] : null;
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
  }

  /* Excel başlığı: hesaplanan değerin adı bir boyut, değer ya da sabit başlıkla
     (ör. "Model", "Satır tipi") aynıysa nesne anahtarlı satırda o sütunun
     üzerine yazılır ve veri sessizce kaybolurdu. Çakışan başlık "(ƒx)", o da
     doluysa "(ƒx 2)"… alır; karşılaştırma büyük/küçük harf duyarsızdır.
     taken: Set (yerinde güncellenir). */
  const headerKey = text => String(text == null ? '' : text).trim().toLocaleLowerCase('tr-TR');
  function uniqueHeader(taken, label) {
    const used = new Set([...taken].map(headerKey));
    const base = String(label == null ? '' : label).trim() || 'ƒx';
    let candidate = base;
    for (let index = 1; used.has(headerKey(candidate)); index += 1) candidate = `${base} (ƒx${index > 1 ? ` ${index}` : ''})`;
    taken.add(candidate);
    return candidate;
  }
  // Tanım listesi için başlıklar (sırayla); existing: sabit + boyut + değer başlıkları.
  function uniqueHeaders(existing, defs) {
    const taken = new Set(existing instanceof Set ? existing : (Array.isArray(existing) ? existing : []));
    return (Array.isArray(defs) ? defs : []).map(def => uniqueHeader(taken, labelOf(def)));
  }

  /* ---------------- tembel yükleme ----------------

     Formül motoru ve editör uygulamanın ertelenmiş yüklemesindedir
     (perf-runtime deferredUi). Widget'lar onları yalnız hesaplanan değer
     tanımlıysa ya da editör açılırken ister; aynı dize tek kez yüklenir. */
  let readyPromise = null;
  function ensureEngine(withEditor) {
    const have = () => Boolean(root.BLFormulaEngine) && (!withEditor || Boolean(root.BLFormulaColumns));
    if (have()) return Promise.resolve(true);
    const loader = root.BLPerf && root.BLPerf._loadScript;
    if (typeof loader !== 'function') return Promise.resolve(have());
    const run = () => Promise.resolve(root.BLFormulaEngine || loader('formula-engine.js'))
      .then(() => (withEditor && !root.BLFormulaColumns ? loader('formula-columns.js') : null))
      .then(() => have(), () => have());
    if (withEditor) return run();
    if (!readyPromise) readyPromise = run().finally(() => { readyPromise = null; });
    return readyPromise;
  }

  /* ---------------- editör (CP "Hesaplanan sütun" penceresi) ---------------- */

  function editorIndex(columns) {
    const index = { byKey: new Map(), base: new Map(), calculated: new Map(), model: new Map(), checklist: new Map() };
    const nameKey = text => String(text).trim().toLocaleLowerCase('tr-TR');
    columns.forEach(col => {
      index.byKey.set(col.ref, { key: col.ref, name: col.label, kind: col.calculated ? 'calculated' : 'base' });
      const target = col.calculated ? index.calculated : index.base;
      if (!target.has(nameKey(col.label))) target.set(nameKey(col.label), col.ref);
      if (!index.base.has(nameKey(col.ref))) index.base.set(nameKey(col.ref), col.ref);
    });
    return index;
  }

  /* openEditor(config)
     config.widget       : görünen widget adı (TR/EN nesnesi)
     config.defs         : mevcut tanımlar (taslak)
     config.editId       : düzenlenen tanımın id'si (yoksa yeni)
     config.allowRow     : satır bazlı mod açılsın mı
     config.rowNote      : satır modu kapalıyken gösterilecek açıklama (TR/EN)
     config.fields(mode) : [{ key, label }] — formülde kullanılabilen alanlar
     config.samples(mode): [{ label, values }] — önizleme satırları
     config.onSave(def)  : kaydedilen tanım
     config.onDelete(id) */
  function openEditor(config) {
    return ensureEngine(true).then(ok => {
      const fc = root.BLFormulaColumns;
      if (!ok || !fc || typeof fc.open !== 'function') {
        if (typeof root.showToast === 'function') root.showToast(T('Formül editörü yüklenemedi; sayfayı yenileyin.', 'The formula editor could not be loaded; reload the page.'));
        return false;
      }
      const defs = Array.isArray(config.defs) ? config.defs : [];
      const existing = config.editId ? defs.find(def => def.id === config.editId) : null;
      const allowRow = config.allowRow !== false;
      const start = existing ? { ...existing } : {
        id: `pcv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label: '', labelTr: '', labelEn: '', formula: '', format: 'auto', decimals: '', refs: {}, mode: 'aggregate',
      };
      if (!allowRow) start.mode = 'aggregate';
      const widget = config.widget || { tr: 'Pivot', en: 'Pivot' };
      const adapterFor = (draft) => {
        const mode = allowRow && draft.mode === 'row' ? 'row' : 'aggregate';
        const others = defs.filter(def => def.id !== draft.id && (mode === 'aggregate' || def.mode === 'row'));
        const fields = (config.fields(mode) || []).filter(field => field && field.key && REF_PATTERN.test(field.key));
        const columns = [
          ...fields.map(field => ({ ref: field.key, key: field.key, label: clean(field.label) || field.key })),
          ...others.map(def => ({ ref: keyOf(def), key: keyOf(def), label: labelOf(def), calculated: true })),
        ];
        // Önizleme: diğer hesaplanan değerler de aynı motorla hesaplanır ki
        // bağımlı formül ilk satırlarda doğru sayıyı göstersin.
        const evaluator = createEvaluator(others, { isTextKey: config.isTextKey });
        const rows = (config.samples(mode) || []).slice(0, 6).map(sample => {
          const values = { ...(sample.values || {}) };
          if (evaluator) Object.assign(values, mode === 'row' ? evaluator.compute({}, [sample.values]).values : evaluator.compute(values, sample.rows || []).values);
          values.__label = sample.label;
          return values;
        });
        return {
          definitions: [{ ...draft, mode }],
          columns, index: editorIndex(columns), rows,
          isNew: !existing,
          modes: ['calc', 'percent', 'advanced'],
          formats: FORMATS.slice(),
          evaluateOptions: { numeric: true },
          rowLabel: row => (row && row.__label) || '',
          // Fonksiyon: dil değişiminde pencere yeniden açılınca metin de güncellenir.
          copy: () => ({
            title: existing ? T('Hesaplanan değeri düzenle', 'Edit calculated value') : T('Hesaplanan değer ekle', 'Add calculated value'),
            subtitle: T(`${widget.tr} pivotuna, diğer değer alanlarından hesaplanan yeni bir değer ekler. Yalnız sizin görünümünüzde durur; sorguyu ve kaynak veriyi değiştirmez.`, `Adds a value to the ${widget.en} pivot, calculated from other value fields. It stays in your own view and never changes the query or the source data.`),
            formatNote: T('Biçim yalnız görünümü değiştirir. Excel’e hesaplanmış DEĞER olarak yazılır.', 'The format only changes how the value looks. Excel receives the calculated VALUE.'),
            deleteLabel: T('Hesaplanan değeri sil', 'Delete calculated value'),
          }),
          extraPanel: (host, api) => renderModePicker(host, api, { mode, allowRow, rowNote: config.rowNote, adapterFor }),
          onSave: item => {
            const next = normalizeList([{ ...item, mode }], { allowRow })[0];
            if (!next) { toast(T('Hesaplanan değer kaydedilemedi: başlık ve formül gerekli.', 'The calculated value could not be saved: a heading and a formula are required.')); return false; }
            const list = defs.filter(def => def.id !== next.id).concat(next);
            const nameKey = text => clean(text).toLocaleLowerCase('tr-TR');
            const clash = defs.some(def => def.id !== next.id && nameKey(labelOf(def)) === nameKey(labelOf(next)))
              || fields.some(field => nameKey(field.label) === nameKey(labelOf(next)));
            if (clash) { toast(T('Bu pivotta aynı adda bir değer var; farklı bir ad verin.', 'This pivot already has a value with that name; pick another name.')); return false; }
            /* Boyut ve sabit başlık adları (ör. Model, Satır tipi) ayrılmıştır:
               aynı ad tabloda ve Excel'de iki sütunu karıştırırdı. */
            const reserved = typeof config.reserved === 'function' ? config.reserved() : (config.reserved || []);
            const names = [labelOf(next), next.labelTr, next.labelEn].filter(Boolean).map(nameKey);
            if (reserved.some(name => names.includes(nameKey(name)))) { toast(T('Bu ad pivotta bir alan ya da sabit başlık olarak kullanılıyor (ör. Model, Satır tipi); farklı bir ad verin.', 'This name is already used by a pivot field or a fixed heading (e.g. Model, Row type); pick another name.')); return false; }
            if (!existing && defs.length >= LIMITS.max) { toast(T(`En fazla ${LIMITS.max} hesaplanan değer eklenebilir.`, `At most ${LIMITS.max} calculated values are allowed.`)); return false; }
            const graph = graphError(list);
            if (graph) { toast(errorText(graph)); return false; }
            config.onSave(next);
            return true;
          },
          onDelete: () => {
            if (!existing) return;
            if (typeof root.confirm === 'function' && !root.confirm(T(`“${labelOf(existing)}” hesaplanan değeri silinsin mi?`, `Delete the “${labelOf(existing)}” calculated value?`))) return;
            config.onDelete(existing.id);
          },
          onClose: config.onClose || null,
        };
      };
      fc.open('pivot', start.id, null, adapterFor(start));
      return true;
    });

    /* Kip seçimi CP penceresindeki tarif kartlarıyla aynı segment bileşenidir
       (fcModes/fcMode); yeni görünüm tanımı yoktur. */
    function renderModePicker(host, api, { mode, allowRow, rowNote, adapterFor }) {
      const option = (id, title, body, disabled) => `<button type="button" role="tab" class="fcMode pcvMode${mode === id ? ' active' : ''}" data-pcv-mode="${id}" aria-selected="${mode === id}" tabindex="${mode === id ? '0' : '-1'}"${disabled ? ' disabled aria-disabled="true"' : ''}><b>${esc(title)}</b><small>${esc(body)}</small></button>`;
      host.innerHTML = `<div class="fcStep"><span class="fcStepNo">0</span>${esc(T('Nasıl hesaplansın?', 'How should it be calculated?'))}</div>
        <div class="fcModes pcvModes" data-bl-tabs="segment" role="tablist" aria-label="${esc(T('Hesap modu', 'Calculation mode'))}">
          ${option('aggregate', T('Toplamlar üzerinden (önerilen)', 'On totals (recommended)'), T('Excel pivot hesaplanan alanı gibi: formül her satırda, alt toplamda ve genel toplamda o satırın TOPLANMIŞ değerleriyle çalışır. Örn. Onaylı / WSSI oranı, satır oranlarının ortalaması değil toplamların oranıdır.', 'Like an Excel pivot calculated field: the formula runs on each row, subtotal and grand total with that row’s TOTALLED values. E.g. Approved / WSSI is the ratio of the totals, not the average of row ratios.'), false)}
          ${option('row', T('Satır bazında, sonra topla', 'Per row, then sum'), allowRow ? T('Formül her kaynak satırda (ör. option) ayrı çalışır, sonuçlar toplanır. Koşullu adetler için: IF([WSSI] = 0, [Onaylı], 0).', 'The formula runs on every source row (e.g. option) and the results are summed. For conditional quantities: IF([WSSI] = 0, [Approved], 0).') : (rowNote ? (isEnglish() ? rowNote.en : rowNote.tr) : T('Bu widget’ta kullanılamaz.', 'Not available in this widget.')), !allowRow)}
        </div>`;
      host.addEventListener('click', event => {
        const button = event.target.closest('[data-pcv-mode]');
        if (!button || button.disabled || button.dataset.pcvMode === mode) return;
        // Taslak (başlık, formül, biçim) korunur; yalnız alan listesi değişir.
        api.reopen(draft => adapterFor({ ...draft, mode: button.dataset.pcvMode }));
      });
    }
  }
  function toast(text) { if (typeof root.showToast === 'function') root.showToast(text); }

  /* ---------------- ayar penceresi bölümü ----------------

     Widget'ın kalem (pivot ayarları) penceresindeki "Pivot Değerleri"
     bölümünün altına hesaplanan değer listesi ve "ƒx Hesaplanan değer ekle"
     düğmesi. Liste bir TASLAKTIR; widget'ın kendi Kaydet'i kalıcılaştırır. */
  function sectionHtml() {
    return `<div class="oabSettingsSection pcvSection" data-pcv-section>
      <div class="oabSettingsSectionHead pcvSectionHead"><span>${esc(T('Kendi hesaplanan değerleriniz (ƒx)', 'Your calculated values (ƒx)'))}</span><button type="button" class="navActionBtn pcvAddBtn" data-pcv-add><span aria-hidden="true">ƒx</span> ${esc(T('Hesaplanan değer ekle', 'Add calculated value'))}</button></div>
      <div class="oabPivotConfigList pcvList" data-pcv-list></div>
    </div>`;
  }
  function mountSection(host, config) {
    if (!host) return null;
    let defs = (Array.isArray(config.defs) ? config.defs : []).map(def => ({ ...def, refs: { ...(def.refs || {}) } }));
    const list = host.querySelector('[data-pcv-list]');
    const displayFormula = def => {
      const E = engine();
      const names = key => {
        const calc = defs.find(item => keyOf(item) === key);
        if (calc) return labelOf(calc);
        const field = (config.fields(def.mode) || []).find(item => item.key === key);
        return field ? field.label : ((def.refs && def.refs[key]) || key);
      };
      return E ? E.rewriteColumns(def.formula, names) : def.formula;
    };
    function paint() {
      if (!list) return;
      list.innerHTML = defs.length ? defs.map((def, index) => `<div class="oabConfigRow intakeConfigRow pcvRow" data-pcv-id="${esc(def.id)}">
          <span class="pcvBadge" aria-hidden="true">ƒx</span>
          <span class="pcvName"><b>${esc(labelOf(def))}</b><small title="${esc(displayFormula(def))}">${esc(modeText(def.mode))} · ${esc(displayFormula(def))}</small></span>
          <div class="oabConfigActions">
            <button type="button" class="oabConfigIconBtn" data-pcv-move="-1" title="${esc(T('Yukarı taşı', 'Move up'))}" aria-label="${esc(T('Yukarı taşı', 'Move up'))}"${index === 0 ? ' disabled' : ''}>↑</button>
            <button type="button" class="oabConfigIconBtn" data-pcv-move="1" title="${esc(T('Aşağı taşı', 'Move down'))}" aria-label="${esc(T('Aşağı taşı', 'Move down'))}"${index === defs.length - 1 ? ' disabled' : ''}>↓</button>
            <button type="button" class="oabConfigIconBtn pcvEditBtn" data-pcv-edit title="${esc(T('Formülü düzenle', 'Edit formula'))}" aria-label="${esc(`${T('Formülü düzenle', 'Edit formula')}: ${labelOf(def)}`)}">ƒx</button>
            <button type="button" class="oabConfigIconBtn danger" data-pcv-remove title="${esc(T('Sil', 'Remove'))}" aria-label="${esc(`${T('Sil', 'Remove')}: ${labelOf(def)}`)}">×</button>
          </div>
        </div>`).join('') : `<div class="intakeConfigEmpty pcvEmpty">${esc(T('Henüz hesaplanan değer yok. Örn. Onaylı / WSSI oranı ya da koşullu bir adet ekleyin.', 'No calculated values yet. Add e.g. an Approved / WSSI ratio or a conditional quantity.'))}</div>`;
      const add = host.querySelector('[data-pcv-add]');
      if (add) add.disabled = defs.length >= LIMITS.max;
    }
    const edit = editId => openEditor({
      ...config,
      defs,
      editId,
      onSave: def => { const index = defs.findIndex(item => item.id === def.id); if (index >= 0) defs[index] = def; else defs.push(def); paint(); if (config.onChange) config.onChange(defs); },
      onDelete: id => { defs = defs.filter(item => item.id !== id); paint(); if (config.onChange) config.onChange(defs); },
    });
    host.addEventListener('click', event => {
      if (event.target.closest('[data-pcv-add]')) { event.preventDefault(); edit(null); return; }
      const row = event.target.closest('[data-pcv-id]');
      if (!row) return;
      const id = row.dataset.pcvId;
      if (event.target.closest('[data-pcv-edit]')) { edit(id); return; }
      if (event.target.closest('[data-pcv-remove]')) {
        defs = defs.filter(item => item.id !== id); paint(); if (config.onChange) config.onChange(defs); return;
      }
      const move = event.target.closest('[data-pcv-move]');
      if (move) {
        const index = defs.findIndex(item => item.id === id), next = index + Number(move.dataset.pcvMove);
        if (index < 0 || next < 0 || next >= defs.length) return;
        [defs[index], defs[next]] = [defs[next], defs[index]];
        paint();
        host.querySelector(`[data-pcv-id="${CSS && CSS.escape ? CSS.escape(id) : id}"] [data-pcv-move="${move.dataset.pcvMove}"]`)?.focus({ preventScroll: true });
      }
    });
    paint();
    if (defs.length && !engine()) ensureEngine(false).then(paint);
    return { value: () => defs.map(def => ({ ...def, refs: { ...(def.refs || {}) } })), refresh: paint };
  }

  return Object.freeze({
    LIMITS, MODES, FORMATS, KEY_PREFIX,
    keyOf, isKey, idOfKey, labelOf, modeText,
    normalizeList, graphError, requiredRowKeys,
    createEvaluator, errorOf, errorText, format, cell, exportValue, uniqueHeader, uniqueHeaders,
    ensureEngine, openEditor, editorIndex, sectionHtml, mountSection,
  });
});
