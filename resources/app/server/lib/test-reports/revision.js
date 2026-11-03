'use strict';
// UI hydration updates these stores during reload. None is consumed by the
// complete CP review context, its business rules, source evidence or answers.
// Keep unknown keys strict; exclude only verified UI/unrelated-module stores.
const PRESENTATION_ONLY=new Set(['lcw.corePageFilters.auto.v1','lcw.notifications.history.v1',
 'lcw.backlog.autoState.v1','lcw.backlog.columnWidths.v1','lcw.cp.dimFilters.v1',
 'lcw.koleksiyon.pricingExcelColumns.v1','lcw.overview.bgDimFilters.v1','lcw.overview.dimFilters.v1',
 'lcw.todo.pages.v1','lcw.todo.text.v1']);
function preferenceProjection(store){return Object.fromEntries(Object.entries(store?.entries||{}).filter(([key])=>!PRESENTATION_ONLY.has(key)).map(([key,entry])=>[key,entry?.value??null]).sort(([a],[b])=>a.localeCompare(b)));}
module.exports={preferenceProjection};
