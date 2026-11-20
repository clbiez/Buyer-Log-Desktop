/* Yalnız taşıma katmanı; bütün iş hesapları kanonik motorda kalır. */
'use strict';
importScripts('chronological-values.js', 'business-rules.js', 'order-decision-engine.js', 'backlog-delivery-engine.js');

const dataset = [], ordinals = new Map();
const dateKey = value => globalThis.BLBacklogDeliveryEngine.dateKey(value);
onmessage = ({ data }) => {
  if (data.kind === 'rows') {
    for (const row of data.rows) dataset.push(row);
    for (const [key, value] of data.ordinals) ordinals.set(key, value);
    return;
  }
  const receivedAt = performance.timeOrigin + performance.now();
  try {
    const Engine = globalThis.BLBacklogDeliveryEngine;
    const ordinal = value => ordinals.get(dateKey(value)) ?? null;
    // Dönem süzmesi + analiz motordadır; yerel arka uç okuma modeli de aynısını çağırır (#1079 WS6c).
    const { model, rowIndices, periodRowCount } = Engine.analyzeDataset(dataset, { settings: data.settings, bounds: data.bounds, today: data.today, dateOrdinal: ordinal });
    const computedAt = performance.timeOrigin + performance.now();
    const orderIndex = new Map(model.orders.map((order, index) => [order, index]));
    const topRiskIndices = model.topRiskOrders.map(order => orderIndex.get(order));
    // Tek büyük sonuç kopyası da renderer'ı bekletir; mesaj boyutu sınırlıdır.
    // Sayılamayan sourceRow, görünümde ORİJİNAL satır referansıyla geri bağlanır.
    for (let start = 0; start < model.orders.length; start += 500) {
      postMessage({ kind: 'orders', generation: data.generation,
        orders: model.orders.slice(start, start + 500), rowIndices: rowIndices.slice(start, start + 500) });
    }
    model.orders = []; model.topRiskOrders = [];
    postMessage({ kind: 'result', generation: data.generation, model, topRiskIndices,
      periodRowCount, totalRowCount: dataset.length,
      timing: { receivedAt, computedAt, sentAt: performance.timeOrigin + performance.now() } });
  } catch (error) {
    postMessage({ generation: data.generation, error: error.message || String(error) });
  }
};
