'use strict';
/* Fiyatlamaya gönderilecek modeller için avantajlı üretici önerisi.
   Fiyat & Üretici Analizi ekranının motoruyla (public/price-supplier-insights-engine)
   ürün klasmanı bazında üreticinin ortalama fiyatı klasman ortalamasıyla
   karşılaştırılır (index: % fark, negatif = ortalamanın altında). Yeterli
   fiyatlı modeli olan (eligible) ve eşiğin altında kalan üreticiler, o
   klasmandaki koleksiyon modelleriyle eşlenir. Karar deterministiktir; LCW AI
   yalnız sonucu anlatır ve e-postayı yazar. */

const Prices = require('../../public/price-supplier-insights-engine');

const MAX_SUPPLIERS = 30, MAX_MODELS = 200, MAX_UNMATCHED = 40, MAX_CLASSIFICATIONS = 30;
const round = value => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100) / 100;
const text = (value, max = 200) => String(value == null ? '' : value).trim().slice(0, max);

function match({ collectionRows, model, fields, maxIndex, perGroup }) {
  const groups = new Map((model.groups || []).map(group => [group.key, group]));
  const suppliers = new Map(), unmatched = { 'no-classification': [], 'no-price-data': [], 'not-comparable': [], 'none-below-threshold': [] };
  let assigned = 0;
  for (const row of collectionRows) {
    const values = fields.project(row, 'collection');
    const identity = { rowId: text(row.id ?? row._id ?? row.rowId, 160), plmId: text(values.plmId, 40), model: text(values.modelName, 160), colourCode: text(values.colourCode, 40), classification: text(values.category, 120) };
    const key = identity.classification ? Prices.keyOf(identity.classification) : '';
    const group = key ? groups.get(key) : null;
    const reason = !key ? 'no-classification' : !group ? 'no-price-data' : !group.comparable ? 'not-comparable' : '';
    const picked = reason ? [] : group.suppliers.filter(s => s.eligible && s.index != null && s.index <= maxIndex).sort((a, b) => a.price - b.price).slice(0, perGroup);
    if (reason || !picked.length) { unmatched[reason || 'none-below-threshold'].push(identity); continue; }
    assigned += 1;
    for (const supplier of picked) {
      if (!suppliers.has(supplier.key)) suppliers.set(supplier.key, { key: text(supplier.key, 300), name: text(supplier.name, 300), classifications: new Map(), models: [] });
      const entry = suppliers.get(supplier.key);
      if (!entry.classifications.has(group.key)) entry.classifications.set(group.key, { name: text(group.name, 300), index: round(supplier.index), price: round(supplier.price), groupPrice: round(group.price), pricedModels: Number(supplier.pricedModels) || 0 });
      entry.models.push(identity);
    }
  }
  return { suppliers, unmatched, assigned };
}

function suggestSuppliers({ collectionRows = [], priceRows = [], fields, priceType = 'finalFob', currency, currentSeason, maxIndex = 0, perGroup = 3 } = {}) {
  const dataset = Prices.prepare(priceRows.map((row, index) => Prices.orderPriceObservation(row, 'orders', priceType, index, fields)));
  const seasons = Prices.seasons(dataset), analyze = season => Prices.analyze(dataset, { currency, currentSeason: season, previousSeason: Prices.previousSeason(season, seasons), groupBy: 'classification', minSample: 2 });
  /* Sezon verilmediyse en yeni sezondan geriye, modellerle gerçekten eşleşen ilk sezon
     kullanılır: alakasız tek bir yeni sezon siparişi sonucu boşaltmaz. */
  const candidates = currentSeason ? [currentSeason] : seasons.slice().reverse().slice(0, 6);
  let model = null, result = null;
  for (const season of candidates.length ? candidates : ['']) {
    const current = analyze(season), found = match({ collectionRows, model: current, fields, maxIndex, perGroup });
    if (!model || found.assigned > 0) { model = current; result = found; }
    if (found.assigned > 0) break;
  }
  const list = [...result.suppliers.values()].sort((a, b) => b.models.length - a.models.length || a.name.localeCompare(b.name, 'tr'));
  return {
    priceType, currency: model.currency, currentSeason: model.currentSeason, seasons: seasons.slice(-20).map(season => text(season, 80)), maxIndex, perGroup, collectionModels: collectionRows.length, assignedModels: result.assigned,
    suppliers: list.slice(0, MAX_SUPPLIERS).map(entry => {
      const classifications = [...entry.classifications.values()];
      return { key: entry.key, name: entry.name, classifications: classifications.slice(0, MAX_CLASSIFICATIONS), classificationsTruncated: classifications.length > MAX_CLASSIFICATIONS,
        modelCount: entry.models.length, models: entry.models.slice(0, MAX_MODELS), modelsTruncated: entry.models.length > MAX_MODELS };
    }),
    omittedSuppliers: Math.max(0, list.length - MAX_SUPPLIERS),
    unmatched: Object.fromEntries(Object.entries(result.unmatched).map(([name, items]) => [name, { count: items.length, models: items.slice(0, MAX_UNMATCHED) }])),
  };
}

module.exports = { suggestSuppliers };
