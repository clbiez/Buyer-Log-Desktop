'use strict';
/* Presentation Studio · "LCW AI ile grupla" — saf yardımcılar (DOM/ağ yok; Node testinde çalışır).
   Kural: modelin bilgisi ve görseli LCW AI'a EKSİKSİZ gider. Hiçbir alan kesilmez; uzun değer
   sırayla parçalara bölünür. Paket, sunucunun kesintisiz sınırlarına (metin ≤ 2000 karakter, dizi
   ≤ 400 öğe, istem ≤ 60.000 karakter) göre planlanır; sunucu yine de sığmadığını söylerse
   (LCWAI_CONTEXT_TOO_LARGE) çağıran paketi ikiye böler. Cevaptaki her model tam bir kez ve izinli
   bir kategoriyle gelmelidir; gelmeyen yeniden sorulur, yine gelmezse tahmin edilmez
   ("tamamlanamadı"). Sonuç yalnız sunumda kullanılır; kaynak tabloya yazılmaz. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPresentationAI = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const SOURCE = 'presentation-grouping';
  const UNSURE = '?';
  const LIMITS = Object.freeze({
    fieldChars: 1800,      // sunucu metin sınırı 2000; etiket ve "(devam)" payı
    fieldItems: 380,       // sunucu dizi sınırı 400
    batchModels: 30,       // paket başına model (paftada etiketli kare)
    batchChars: 42000,     // bağlam JSON'u; istem 60.000, sabit metin ~5.000
    sampleModels: 24,      // kategori planı için tüm sete yayılmış örnek
    maxCategories: 12,
    categoryChars: 60,
    questionChars: 1500,
  });

  const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const fold = v => clean(v).toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

  /* Modelin tüm dolu alanları "Etiket: değer" olarak; uzun değer kayıpsız parçalara bölünür. */
  function fieldLines(entries, cont = '(devam)') { // i18n-ignore — LCW AI'a giden veri işareti, arayüz metni değil
    const out = [];
    for (const e of entries || []) {
      const label = clean(e && e.label), value = String(e && e.value != null ? e.value : '').replace(/\s+/g, ' ').trim();
      if (!value) continue;
      const head = label ? `${label}: ` : '', more = label ? `${label} ${cont}: ` : `${cont}: `;
      let rest = value, first = true;
      while (rest.length) {
        const prefix = first ? head : more, room = Math.max(200, LIMITS.fieldChars - prefix.length);
        out.push(prefix + rest.slice(0, room));
        rest = rest.slice(room); first = false;
      }
    }
    return out;
  }
  /* Bir modelin LCW AI kaydı: anahtar, görselin bulunduğu pafta (ya da none) ve tüm alanları. */
  function modelRecord(key, sheet, lines) {
    if (lines.length > LIMITS.fieldItems) throw new Error('too-many-fields');
    return { k: key, image: sheet || 'none', fields: lines };
  }
  const recordSize = rec => JSON.stringify(rec).length + 1;

  /* Paketler: sıra korunur, model ve karakter sınırına kadar doldurulur. Tek başına sınırı aşan
     model kendi paketine konur (sunucu reddederse çağıran "tamamlanamadı" der; kısaltılmaz). */
  function planBatches(items, { maxModels = LIMITS.batchModels, maxChars = LIMITS.batchChars } = {}) {
    const out = []; let cur = [], size = 0;
    for (const it of items) {
      if (cur.length && (cur.length >= maxModels || size + it.size > maxChars)) { out.push(cur); cur = []; size = 0; }
      cur.push(it.id); size += it.size;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  /* Kategori planı için tüm sete eşit aralıklarla yayılmış örnek. */
  function sample(ids, n = LIMITS.sampleModels) {
    if (ids.length <= n) return ids.slice();
    const out = [];
    for (let i = 0; i < n; i++) out.push(ids[Math.floor(i * ids.length / n)]);
    return [...new Set(out)];
  }
  function normalizeCategories(list) {
    const out = [], seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const c = clean(raw).replace(/\|/g, '/').slice(0, LIMITS.categoryChars);
      if (!c || c === UNSURE || seen.has(fold(c))) continue;
      seen.add(fold(c)); out.push(c);
      if (out.length >= LIMITS.maxCategories) break;
    }
    return out;
  }
  function parseLine(line) {
    const out = {};
    for (const part of String(line == null ? '' : line).split('|')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      const k = clean(part.slice(0, i)).toLowerCase(), v = clean(part.slice(i + 1));
      if ((k === 'k' || k === 'key') && !out.k) out.k = v;
      else if ((k === 'c' || k === 'category') && out.c == null) out.c = v;
      else if ((k === 'r' || k === 'reason') && out.r == null) out.r = v.slice(0, 160);
    }
    return out;
  }
  /* Cevap doğrulaması: paketteki her anahtar tam bir kez, izinli kategoriyle. Döner:
     values: anahtar → { c, r }  ·  missing: cevapta olmayan / geçersiz satırlı anahtarlar
     unknown: pakette olmayan anahtarlar  ·  duplicate: iki kez yazılan anahtarlar (yeniden sorulur). */
  function parseAssignments(lines, keys, categories) {
    const want = new Set(keys), byFold = new Map(categories.map(c => [fold(c), c]));
    const seen = new Map(), dup = new Set(), unknown = [], invalid = new Set();
    for (const line of Array.isArray(lines) ? lines : []) {
      const p = parseLine(line);
      if (!p.k) continue;
      if (!want.has(p.k)) { unknown.push(p.k); continue; }
      if (seen.has(p.k)) { dup.add(p.k); continue; }
      const c = p.c == null ? null : (p.c === UNSURE || p.c === '' ? UNSURE : byFold.get(fold(p.c)) || null);
      if (c == null) { invalid.add(p.k); seen.set(p.k, null); continue; }
      seen.set(p.k, { c, r: p.r || '' });
    }
    const values = new Map();
    for (const [k, v] of seen) if (v && !dup.has(k)) values.set(k, v);
    const missing = keys.filter(k => !values.has(k));
    return { values, missing, unknown, duplicate: [...dup], invalid: [...invalid] };
  }
  /* Sunumda kayıtlı sonucu sadeleştirir (normalizeDoc): yalnız bilinen modeller, izinli kategoriler. */
  function normalizeGrouping(raw, ids) {
    if (!raw || typeof raw !== 'object') return null;
    const cats = normalizeCategories(raw.cats);
    if (!cats.length) return null;
    const allowed = new Set([...cats, UNSURE]), known = ids ? new Set(ids) : null, vals = {}, fp = {}, why = {};
    for (const [id, c] of Object.entries(raw.vals && typeof raw.vals === 'object' ? raw.vals : {})) {
      if ((known && !known.has(id)) || !allowed.has(c)) continue;
      vals[id] = c;
      if (raw.fp && typeof raw.fp[id] === 'string') fp[id] = raw.fp[id].slice(0, 24);
      if (raw.why && typeof raw.why[id] === 'string' && raw.why[id]) why[id] = clean(raw.why[id]).slice(0, 160);
    }
    return { q: clean(raw.q).slice(0, LIMITS.questionChars), cats, vals, fp, why, at: clean(raw.at).slice(0, 40) };
  }

  /* Çalıştırıcı: G/Ç dışarıdan verilir (tarayıcıda BuyerLogAI + tuval; testte sahte).
     opts: ids, question, cats (yoksa önce örnekle kategori planı), recordOf(id) → [{label, value}],
     imageOf(id) → görsel kaynağı | null, drawSheets([{id, key, src}]) → [{ name, blob, ids }],
     upload(blob, name) → ek, ask({ task, context, attachments }) → LCW AI sonucu, onProgress, signal.
     Paket sığmazsa ikiye bölünür; cevapsız/eksik model bir kez yeniden sorulur; yine gelmezse
     "failed" olur (tahmin yok). Durdurulursa (iptal, kota, ağ) o ana kadarki sonuç ve kalanlar döner. */
  async function runGrouping(opts) {
    const { ids, question, recordOf, imageOf, drawSheets, upload, ask, onProgress = () => {}, signal } = opts;
    let cats = opts.cats ? normalizeCategories(opts.cats) : null;
    const vals = {}, why = {}, failed = {}, noImage = new Set(), lines = new Map();
    for (const id of ids) lines.set(id, fieldLines(recordOf(id)));
    const sizeOf = id => recordSize(modelRecord('M00', 'BuyerLog-grouping-00.jpg', lines.get(id)));
    let requests = 0, stopped = null;
    const total = ids.length, progress = phase => onProgress({ phase, done: Object.keys(vals).length, failed: Object.keys(failed).length, total, requests });
    const aborted = () => Boolean(signal && signal.aborted);
    const abortError = () => Object.assign(new Error('cancelled'), { code: 'LCWAI_CANCELLED' });
    async function once(batch, mode) {
      if (aborted()) throw abortError();
      const keys = batch.map((_, i) => 'M' + (i + 1)), keyOf = new Map(batch.map((id, i) => [id, keys[i]]));
      const withImage = batch.filter(id => imageOf(id));
      progress('images');
      const sheets = withImage.length ? await drawSheets(withImage.map(id => ({ id, key: keyOf.get(id), src: imageOf(id) }))) : [];
      const sheetOf = new Map();
      for (const sh of sheets) for (const id of sh.ids) sheetOf.set(id, sh.name);
      for (const id of batch) if (sheetOf.has(id)) noImage.delete(id); else noImage.add(id);
      const attachments = [];
      for (const sh of sheets) { if (aborted()) throw abortError(); progress('upload'); attachments.push(await upload(sh.blob, sh.name)); }
      const models = batch.map(id => modelRecord(keyOf.get(id), sheetOf.get(id) || 'none', lines.get(id)));
      let res;
      requests++; progress('ask');
      try { res = await ask({ task: question, context: { mode, categories: cats || [], models }, attachments }); }
      catch (e) { if (e && e.code === 'LCWAI_CONTEXT_TOO_LARGE') return { split: true }; throw e; }
      if (res && res.truncated) return { split: true };
      const data = res && res.data;
      if (!data) return { bad: true };
      const use = mode === 'plan' ? normalizeCategories(data.categories) : cats;
      if (!use || !use.length) return { bad: true };
      const p = parseAssignments(data.assignments, keys, use), idOf = new Map(keys.map((k, i) => [k, batch[i]]));
      return { cats: use, values: [...p.values].map(([k, v]) => [idOf.get(k), v]), missing: p.missing.map(k => idOf.get(k)) };
    }
    const take = r => { for (const [id, v] of r.values) { vals[id] = v.c; if (v.r) why[id] = v.r; } };
    try {
      if (!cats) {
        // Kategori planı: tüm sete yayılmış örnek tek pakette (sığmazsa yarıya inilir).
        let plan = planBatches(sample(ids).map(id => ({ id, size: sizeOf(id) })))[0] || [], retried = false;
        for (;;) {
          const r = await once(plan, 'plan');
          if (r.split && plan.length > 1) { plan = plan.slice(0, Math.ceil(plan.length / 2)); continue; }
          if (r.split) throw Object.assign(new Error('too-large'), { code: 'LCWAI_CONTEXT_TOO_LARGE' });
          if (r.bad) { if (!retried) { retried = true; continue; } throw Object.assign(new Error('no-categories'), { code: 'LCWAI_SCHEMA_MISMATCH' }); }
          cats = r.cats; take(r); break;
        }
      }
      const queue = planBatches(ids.filter(id => !(id in vals)).map(id => ({ id, size: sizeOf(id) }))).map(b => ({ ids: b, retry: false, net: false }));
      while (queue.length) {
        const job = queue.shift();
        let r;
        try { r = await once(job.ids, 'classify'); }
        catch (e) {
          if (e && e.retryable && !job.net) { queue.unshift({ ...job, net: true }); continue; }
          queue.unshift(job); throw e;
        }
        if (r.split) {
          if (job.ids.length > 1) { const h = Math.ceil(job.ids.length / 2); queue.unshift({ ...job, ids: job.ids.slice(0, h) }, { ...job, ids: job.ids.slice(h) }); }
          else failed[job.ids[0]] = 'too-large';
          continue;
        }
        if (r.bad) { if (!job.retry) queue.unshift({ ...job, retry: true }); else for (const id of job.ids) failed[id] = 'no-answer'; continue; }
        take(r);
        if (r.missing.length) { if (!job.retry) queue.push({ ids: r.missing, retry: true, net: false }); else for (const id of r.missing) failed[id] = 'missing'; }
        progress('ask');
      }
    } catch (e) {
      stopped = { code: (e && e.code) || 'LCWAI_INTERNAL', message: e && e.message };
    }
    // Sonucu olmayan her model açıkça "tamamlanamadı" (durdurulduysa nedeni durma kodu).
    for (const id of ids) if (!(id in vals) && !(id in failed)) failed[id] = stopped ? stopped.code : 'missing';
    progress('done');
    return { cats: cats || [], vals, why, failed, noImage: [...noImage].filter(id => id in vals || id in failed), requests, stopped };
  }

  return Object.freeze({ SOURCE, UNSURE, LIMITS, fieldLines, modelRecord, recordSize, planBatches, sample, normalizeCategories, parseLine, parseAssignments, normalizeGrouping, runGrouping, fold });
});
