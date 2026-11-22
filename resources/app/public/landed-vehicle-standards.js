(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLLandedVehicleStandards = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* VASITAYA GÖRE STANDART YURTDIŞI LANDED ÇARPANI — saf yardımcılar
   * (tarayıcı + Node: server/db.js, landed-multiplier-service, TR/YD route ve motoru).
   *
   * Yurtdışı landed çarpanı yükleme tipine göre değişir (gemi < gemi+uçak < uçak).
   * Ortak "Landed çarpanları" ayarı (landedMultipliers) genel `overseas` değerine ek
   * olarak isteğe bağlı `byVehicle: { [vasıta anahtarı]: çarpan }` taşır. Başlangıçta
   * boştur (ürün kararı: değer uydurulmaz); boş vasıta genel `overseas`a düşer.
   *
   * Vasıta anahtarı: Türkçe karakterler katlanır, büyük harfe çevrilir, "+" çevresi
   * boşluk silinir, diğer ayraçlar tek boşluk olur ("Gemi+Uçak" = "GEMI + UCAK").
   * Değer sözleşmesi genel çarpanla aynıdır: 0 < x ≤ 10.
   */
  const MIN_MULTIPLIER = 0;
  const MAX_MULTIPLIER = 10;
  const MAX_VEHICLES = 50;
  /* Öneri eşiği: bir vasıtada en az 20 YD satırı VE en az 5 farklı sipariş.
     Satırlar sipariş × renktir; aynı siparişin renkleri aynı sevkiyatla gider ve
     bağımsız örnek değildir. 20 satır / 5 sipariş, tek bir sevkiyatın (ör. tek
     acil uçak) medyanı belirlemesini önleyen en küçük makul tabandır. */
  const MIN_SAMPLE_ROWS = 20;
  const MIN_SAMPLE_ORDERS = 5;

  function fold(value) {
    return String(value == null ? '' : value).replace(/[ıİ]/g, 'I').replace(/[şŞ]/g, 'S').replace(/[ğĞ]/g, 'G')
      .replace(/[üÜ]/g, 'U').replace(/[öÖ]/g, 'O').replace(/[çÇ]/g, 'C').toUpperCase();
  }
  function normalizeVehicleKey(value) {
    return fold(value).replace(/\s*\+\s*/g, '+').replace(/[^A-Z0-9+]+/g, ' ').replace(/\s*\+\s*/g, '+').replace(/^\++|\++$/g, '').trim();
  }
  function multiplierOf(value) {
    if (value === null || value === '' || typeof value === 'boolean') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > MIN_MULTIPLIER && n <= MAX_MULTIPLIER ? n : null;
  }
  const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  /* Yumuşak normalize (okuma/migrasyon): geçersiz kayıt düşer, veri hatası atılmaz. */
  function normalizeByVehicle(raw) {
    const out = {};
    if (!plainObject(raw)) return out;
    let count = 0;
    for (const name of Object.keys(raw)) {
      const key = normalizeVehicleKey(name);
      const value = multiplierOf(raw[name]);
      if (!key || value == null || Object.prototype.hasOwnProperty.call(out, key)) continue;
      out[key] = value;
      count += 1;
      if (count >= MAX_VEHICLES) break;
    }
    return out;
  }
  /* Sıkı denetim (yeni yazım): her kayıt geçerli olmalı, eşdeğer anahtar tekrarlanamaz. */
  function validateByVehicle(raw) {
    if (!plainObject(raw)) return { ok: false, code: 'shape' };
    const names = Object.keys(raw);
    if (names.length > MAX_VEHICLES) return { ok: false, code: 'tooMany' };
    const value = {};
    for (const name of names) {
      const key = normalizeVehicleKey(name);
      const n = multiplierOf(raw[name]);
      if (!key) return { ok: false, code: 'emptyKey' };
      if (n == null) return { ok: false, code: 'range', key };
      if (Object.prototype.hasOwnProperty.call(value, key)) return { ok: false, code: 'duplicate', key };
      value[key] = n;
    }
    return { ok: true, value };
  }

  const pct = share => Math.round(share * 100);
  /* Siparişin standart çarpanı. parts: [{ key, label, qty }] (IAS parsiyelleri,
     vasıtaya göre toplanmış). Bilinen (anahtarı dolu) parsiyeller yükleme
     adediyle ağırlıklandırılır; parsiyellerden birinin adedi yoksa hepsi eşit
     ağırlık alır (adetli/adetsiz karışımı keyfi bir ağırlık üretirdi). Vasıtası
     için standart tanımlı olmayan parsiyel genel yurtdışı standardını kullanır. */
  function orderStandard(parts, byVehicle, overseas) {
    const fallback = multiplierOf(overseas);
    const base = fallback == null ? 1.11 : fallback;
    const known = (Array.isArray(parts) ? parts : []).filter(part => part && normalizeVehicleKey(part.key));
    if (!known.length) return { value: base, source: 'unknown', known: false, weighting: 'none', parts: [], label: '', labelEn: '' };
    const table = plainObject(byVehicle) ? byVehicle : {};
    const qtyWeighted = known.every(part => typeof part.qty === 'number' && Number.isFinite(part.qty) && part.qty > 0);
    const total = qtyWeighted ? known.reduce((sum, part) => sum + part.qty, 0) : known.length;
    let value = 0, configured = 0;
    const mix = known.map(part => {
      const key = normalizeVehicleKey(part.key);
      const own = Object.prototype.hasOwnProperty.call(table, key) ? multiplierOf(table[key]) : null;
      const share = (qtyWeighted ? part.qty : 1) / total;
      if (own != null) configured += 1;
      value += share * (own == null ? base : own);
      return { key, label: String(part.label || key), share, standard: own == null ? base : own, configured: own != null };
    }).sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
    const source = configured === mix.length ? 'vehicle' : (configured ? 'mixed' : 'overseas');
    const label = mix.length === 1 ? mix[0].label : mix.map(item => `${item.label} %${pct(item.share)}`).join(' · ');
    const labelEn = mix.length === 1 ? mix[0].label : mix.map(item => `${item.label} ${pct(item.share)}%`).join(' · ');
    return { value, source, known: true, weighting: qtyWeighted ? 'qty' : 'equal', parts: mix, label, labelEn };
  }

  /* Adet ağırlıklı medyan: kümülatif ağırlık yarıyı ilk geçtiği değer; tam yarıda
     sonraki değerle ortalanır. */
  function weightedMedian(items) {
    const list = items.filter(item => Number.isFinite(item.ratio) && item.weight > 0).sort((a, b) => a.ratio - b.ratio);
    const total = list.reduce((sum, item) => sum + item.weight, 0);
    if (!total) return null;
    const half = total / 2;
    let cumulative = 0;
    for (let index = 0; index < list.length; index += 1) {
      cumulative += list[index].weight;
      if (Math.abs(cumulative - half) < 1e-9 * total && index + 1 < list.length) return (list[index].ratio + list[index + 1].ratio) / 2;
      if (cumulative > half) return list[index].ratio;
    }
    return list[list.length - 1].ratio;
  }
  /* Geçmiş veriden öneri. samples: [{ key, label, order, qty, ratio, dates? }] —
     yalnız tek vasıtalı siparişlerin geçerli (landed ≥ FOB) YD satırları.
     Sonuç kaydedilmez; kullanıcı alana alıp Kaydet'e basmalıdır. */
  function suggest(samples, options = {}) {
    const minRows = Number(options.minRows) || MIN_SAMPLE_ROWS;
    const minOrders = Number(options.minOrders) || MIN_SAMPLE_ORDERS;
    const groups = new Map();
    for (const sample of Array.isArray(samples) ? samples : []) {
      const key = normalizeVehicleKey(sample && sample.key);
      const ratio = Number(sample && sample.ratio), qty = Number(sample && sample.qty);
      if (!key || !Number.isFinite(ratio) || !(qty > 0)) continue;
      let group = groups.get(key);
      if (!group) { group = { key, labels: new Map(), items: [], orders: new Set(), qty: 0, from: '', to: '' }; groups.set(key, group); }
      const label = String(sample.label || key);
      group.labels.set(label, (group.labels.get(label) || 0) + qty);
      group.items.push({ ratio, weight: qty });
      group.orders.add(String(sample.order == null ? '' : sample.order));
      group.qty += qty;
      for (const date of Array.isArray(sample.dates) ? sample.dates : []) {
        const day = String(date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        if (!group.from || day < group.from) group.from = day;
        if (!group.to || day > group.to) group.to = day;
      }
    }
    return [...groups.values()].map(group => {
      const count = group.items.length, orders = group.orders.size;
      const reason = count < minRows ? 'fewRows' : (orders < minOrders ? 'fewOrders' : '');
      const median = weightedMedian(group.items);
      const label = [...group.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return {
        key: group.key, label, count, orders, qty: group.qty, from: group.from, to: group.to,
        median, enough: !reason, reason, suggestion: reason || median == null ? null : Math.round(median * 10000) / 10000,
      };
    }).sort((a, b) => b.qty - a.qty || a.key.localeCompare(b.key));
  }

  return Object.freeze({
    MIN_MULTIPLIER, MAX_MULTIPLIER, MAX_VEHICLES, MIN_SAMPLE_ROWS, MIN_SAMPLE_ORDERS,
    normalizeVehicleKey, multiplierOf, normalizeByVehicle, validateByVehicle, orderStandard, weightedMedian, suggest,
  });
});
