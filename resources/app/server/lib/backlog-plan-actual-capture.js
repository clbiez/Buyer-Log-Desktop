'use strict';
/*
 * Planlanan & Gerçekleşen yenileme işareti — tek hesap yolu.
 *
 * Compute işçisi (görev 'plan-actual-capture') ve ana iş parçacığı yedek yolu
 * AYNI işlevi çağırır: Backlog'un kendi hedef veri kümesi + effective override'lar
 * → Backlog şablon satırları → projectSnapshot → arşiv deltası. Satır kümesi,
 * tarih kuralları ve girdi anahtarı server.js'in önceki capture formülüyle
 * birebir aynıdır (ordersForTarget / antrepoForTarget / buildBacklogTemplateRows).
 *
 * Bu modül arşiv dosyasına YAZMAZ. Sıkıştırılmış yeni arşivi döndürür; yazma
 * ana iş parçacığında kullanıcı kilidi altında atomik yapılır. Böylece işçi
 * sonucu bayat bir kaynak sürümüne aitse (COMPUTE_STALE_GENERATION) diske
 * hiçbir şey yazılmamış olur.
 */
const parse = require('./parse');
const backlogPlanActual = require('./backlog-plan-actual');
const { inputKey } = require('./derived-input-keys');

// server.js ordersForTarget / antrepoForTarget ile aynı seçim kuralı.
function ordersForTarget(active, target, overrides) {
  const byTarget = active && active.asasOrdersByTarget;
  const rows = byTarget && Array.isArray(byTarget[target]) ? byTarget[target] : null;
  return parse.applyDateOverrides(rows || active.asasOrders || [], overrides);
}
function antrepoForTarget(active, target) {
  const byTarget = active && active.antrepoMapByTarget;
  const map = byTarget && byTarget[target] && typeof byTarget[target] === 'object' ? byTarget[target] : null;
  return map || active.antrepoMap || {};
}

async function captureFromSource(source, params = {}) {
  const active = source || {};
  const overrides = params.overrides || {};
  const capturedAt = params.capturedAt || new Date().toISOString();
  const sourceGenerationId = String(params.sourceGenerationId || '');
  const key = inputKey(active, params.contextHash, overrides, 'backlog', { version: params.appVersion || '' });
  return backlogPlanActual.prepareCapture(params.archiveFile, { capturedAt, sourceGenerationId, inputKey: key }, () => {
    const orders = ordersForTarget(active, 'backlog', overrides);
    const templateRows = parse.buildBacklogTemplateRows(orders, antrepoForTarget(active, 'backlog'), overrides, {}, [], {});
    return backlogPlanActual.projectSnapshot(orders, templateRows, { capturedAt, sourceGenerationId }).rows;
  });
}

module.exports = { captureFromSource };
