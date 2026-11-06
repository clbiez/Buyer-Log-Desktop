(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./canonical-fields') : root.BLCanonicalFields);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionOrderBackfill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(fields) {
  'use strict';
  /* CP / Orders → Koleksiyon eşitleme planı (saf, DOM'suz).
   *
   * Eşleşme anahtarı: MB ayı + PLM ID + Renk Kodu. Koleksiyonda bu kimlikte bir
   * kayıt varsa yeni satır AÇILMAZ; mevcut satır yerinde güncellenir. Böylece
   * satır kimliği (id) korunur ve ona bağlı fiyatlama geçmişi, teklifler, fiyat
   * avantajları, landed kıyasları, Endeksmatik ve görsel kaybolmaz.
   *
   * Fiyat kaynağı nihai FOB değil Supp. FOB'dur; üretici Sub-Manufacturer'dır
   * (yoksa Manufacturer). Koleksiyon FOB'u bu fiyattan royalty + hologram ile
   * kendisi hesaplar; nihai FOB'u fiyat olarak yazmak masrafları iki kez ekler.
   * Mevcut satırın onaylı üretici/fiyatı farklıysa değişiklik yalnız kullanıcı
   * onayıyla uygulanır (priceChange.requiresApproval). Diğer kaynak alanları
   * (MAG, buyer, ülke, tarihler, adet, kumaş …) kaynakta doluysa taşınır; boş
   * kaynak değeri mevcut Koleksiyon değerini silmez. */
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  const clone = value => JSON.parse(JSON.stringify(value));
  function number(value) {
    let raw = text(value).replace(/\s/g, '');
    if (!raw) return null;
    if (raw.includes(',') && raw.includes('.')) {
      raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else raw = raw.replace(',', '.');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // Kaynak siparişten Koleksiyona taşınan, kullanıcıya ait olmayan alanlar.
  // pricing, confirmedManufacturer, targetPrice, previousFob, landed girdileri,
  // endeksmatikData, durum, görsel, buying sample ve özel sütunlar burada YOKTUR.
  const SOURCE_FIELDS = Object.freeze(['modelKod', 'lisans', 'licensor', 'urunTipi', 'productMainDefinition',
    'specialCode', 'line', 'colour', 'fabric', 'fabricSupplierS7', 'fabricSupplierS6', 'fit', 'assortment',
    'mag', 'mmyg', 'buyingGroup', 'buyer', 'season', 'country', 'delType']);
  const AGGREGATE_FIELDS = Object.freeze(['quantity', 'opd', 'exFactory', 'retail', 'inStore', 'inStoreWeek']);
  const defaultMonth = value => /^\d{6}$/.test(text(value)) ? text(value) : '';

  function identity(row, monthKey = defaultMonth) {
    const plm = text(fields.normalizedValue(row, 'collection', 'plmId'));
    const colour = upper(row && row.colourCode);
    const month = monthKey(row && row.inStoreMonth);
    return plm && colour && month ? JSON.stringify([plm, colour, month]) : '';
  }
  const orderLine = order => JSON.stringify([upper(order && order.orderCode), upper(order && order.colourCode)]);
  function sourceOrder(key, row) {
    return {key, orderCode:row._sourceOrderCode || '', quantity:row.quantity, opd:row.opd,
      exFactory:row.exFactory, retail:row.retail, inStore:row.inStore, inStoreWeek:row.inStoreWeek,
      colourCode:row.colourCode, colour:row.colour, notes:row.not || '', details:clone(row._sourceOrderDetails || {})};
  }
  function bound(values, latest) {
    const dates = values.map(text).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
    return dates.length ? dates[latest ? dates.length - 1 : 0] : '';
  }
  function aggregate(orders) {
    const quantities = orders.map(order => number(order.quantity)).filter(value => value != null);
    const firstStore = orders.filter(order => /^\d{4}-\d{2}-\d{2}$/.test(text(order.inStore)))
      .sort((a, b) => text(a.inStore).localeCompare(text(b.inStore)))[0];
    return {quantity:quantities.length ? String(quantities.reduce((sum, value) => sum + value, 0)) : '',
      opd:bound(orders.map(order => order.opd), false), exFactory:bound(orders.map(order => order.exFactory), true),
      retail:bound(orders.map(order => order.retail), true),
      inStore:firstStore ? text(firstStore.inStore) : '', inStoreWeek:firstStore ? text(firstStore.inStoreWeek) : ''};
  }
  // Aynı model+renk+MB ayındaki siparişlerden tek fiyat önerisi. Farklı üretici
  // veya Supp. FOB varsa tahmin yapılmaz: öneri yok, çakışma raporlanır.
  function proposal(rows) {
    const offers = new Map();
    rows.forEach(row => {
      const name = text(row.confirmedManufacturer), price = number(row.pricing && row.pricing[name]);
      if (name && price > 0) offers.set(JSON.stringify([upper(name), price]), {name, price, raw:text(row.pricing[name])});
    });
    if (offers.size === 1) return {offer:[...offers.values()][0], conflict:false};
    return {offer:null, conflict:offers.size > 1};
  }
  // Teslim tipi kaynakta boşsa eşleyici varsayılanı ('Gemi') gerçek veri değildir.
  const sourceValue = (row, key) => key === 'delType' && row._sourceOrderDetails
    && Object.prototype.hasOwnProperty.call(row._sourceOrderDetails, 'deliveryType') ? row._sourceOrderDetails.deliveryType : row[key];
  function firstFilled(rows, key) {
    for (const row of rows) if (text(sourceValue(row, key))) return sourceValue(row, key);
    return '';
  }
  function notesWith(current, orders) {
    const parts = text(current) ? text(current).split(' · ') : [];
    orders.forEach(order => text(order.notes).split(' · ').map(text).filter(Boolean).forEach(note => {
      if (!parts.includes(note)) parts.push(note);
    }));
    return parts.join(' · ');
  }
  function plan(entries, existing = [], existingKeys = [], options = {}) {
    const monthKey = typeof options.monthKey === 'function' ? options.monthKey : defaultMonth;
    const read = typeof options.read === 'function' ? options.read : (row, key) => row && row[key];
    const pricingOf = typeof options.pricing === 'function' ? options.pricing : row => (row && row.pricing) || {};
    const equal = typeof options.equal === 'function' ? options.equal : (a, b) => text(a) === text(b);
    const seen = new Set(existingKeys.filter(Boolean)), byIdentity = new Map();
    existing.forEach(row => {
      (row._sourceOrders || []).forEach(order => { if (order.key) seen.add(order.key); });
      if (row._sourceOrderIdentity) seen.add(row._sourceOrderIdentity);
      const key = identity({...row, plmId:read(row, 'plmId'), colourCode:row.colourCode, inStoreMonth:read(row, 'inStoreMonth')}, monthKey);
      if (!key) return;
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(row);
    });
    const groups = new Map(), loose = [], inputKeys = new Set();
    let duplicates = 0, unchanged = 0;
    entries.forEach((entry, index) => {
      const key = text(entry.key);
      if (key && inputKeys.has(key)) { duplicates++; return; }
      if (key) inputKeys.add(key);
      const id = identity(entry.row, monthKey);
      if (!id) {
        // Kimliği eksik kayıt (PLM/renk/MB ayı yok) eşleştirilemez; aynı sipariş
        // satırı daha önce aktarıldıysa tekrar açılmaz, aksi hâlde yeni satırdır.
        if (key && seen.has(key)) { duplicates++; return; }
        loose.push({key:key || `unkeyed-${index}`, row:entry.row});
        return;
      }
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({key, row:entry.row});
    });
    const changes = [];
    loose.forEach(({key, row}) => {
      const next = clone(row);
      next.modelGroupId = 'order-backfill:' + key; next.modelGroupRole = 'single';
      next._sourceOrders = [sourceOrder(key, row)];
      const price = proposal([row]);
      changes.push({existingId:null, identity:'', row:next, price:{current:null, proposed:price.offer, conflict:false, missing:!price.offer, changed:false, requiresApproval:false}, fieldChanges:[], matches:0});
    });
    groups.forEach((all, id) => {
      const targets = byIdentity.get(id) || [];
      // Eşleşen kayıt yoksa daha önce aktarılmış sipariş satırları (ör. eski
      // sürümün renkleri tek satırda birleştirdiği kayıtlar) tekrar açılmaz.
      const members = targets.length ? all : all.filter(member => !(member.key && seen.has(member.key)));
      duplicates += all.length - members.length;
      if (!members.length) return;
      const rows = members.map(member => member.row);
      const incoming = members.map(member => sourceOrder(member.key, member.row));
      const price = proposal(rows);
      if (!targets.length) {
        const next = clone(rows[0]);
        SOURCE_FIELDS.forEach(field => { const value = firstFilled(rows, field); if (text(value)) next[field] = value; });
        Object.assign(next, aggregate(incoming));
        next._sourceOrders = incoming;
        next.not = notesWith('', incoming);
        next.pricing = price.offer ? {[price.offer.name]:price.offer.raw} : {};
        next.confirmedManufacturer = price.offer ? price.offer.name : (price.conflict ? '' : text(next.confirmedManufacturer));
        next.buyingSampleManufacturer = price.offer ? price.offer.name : text(next.buyingSampleManufacturer);
        next.modelGroupId = 'order-backfill:' + id; next.modelGroupRole = 'single';
        changes.push({existingId:null, identity:id, row:next, price:{current:null, proposed:price.offer, conflict:price.conflict, missing:!price.offer && !price.conflict, changed:false, requiresApproval:false}, fieldChanges:[], matches:0});
        return;
      }
      // Birden fazla eşleşme (ör. önceki hatayla çoğalmış kayıtlar): en zengin
      // ticari geçmişe sahip, sonra en eski kayıt güncellenir; diğerlerine dokunulmaz.
      const ranked = targets.slice().sort((a, b) => Object.keys(pricingOf(b)).length - Object.keys(pricingOf(a)).length
        || Number(Boolean(a._sourceOrders?.length)) - Number(Boolean(b._sourceOrders?.length)) || Number(a.id) - Number(b.id));
      const target = ranked[0];
      const lines = new Set(incoming.map(orderLine));
      const orders = [...(target._sourceOrders || []).filter(order => !lines.has(orderLine(order))), ...incoming];
      const patch = {};
      SOURCE_FIELDS.forEach(field => { const value = firstFilled(rows, field); if (text(value)) patch[field] = value; });
      Object.entries(aggregate(orders)).forEach(([field, value]) => { if (text(value)) patch[field] = value; });
      const notes = notesWith(read(target, 'not'), incoming);
      if (notes) patch.not = notes;
      const fieldChanges = Object.keys(patch).filter(field => !equal(read(target, field), patch[field]))
        .map(field => ({key:field, from:read(target, field) ?? '', to:patch[field]}));
      const pricing = pricingOf(target), currentName = text(read(target, 'confirmedManufacturer'));
      const currentPrice = number(pricing[currentName]);
      const current = currentName && currentPrice > 0 ? {name:currentName, price:currentPrice, raw:text(pricing[currentName])} : null;
      const changed = Boolean(price.offer && (!current || upper(current.name) !== upper(price.offer.name) || current.price !== price.offer.price));
      const ordersChanged = JSON.stringify(orders) !== JSON.stringify(target._sourceOrders || []);
      if (!fieldChanges.length && !changed && !ordersChanged) { unchanged++; return; }
      const display = {...target, ...patch};
      changes.push({existingId:target.id, identity:id, row:display, patch, sourceOrders:orders, fieldChanges, matches:targets.length,
        price:{current, proposed:price.offer, conflict:price.conflict, missing:!price.offer && !price.conflict, changed, requiresApproval:changed}});
    });
    return {changes, duplicates, unchanged};
  }
  return {plan, identity, SOURCE_FIELDS, AGGREGATE_FIELDS};
});
