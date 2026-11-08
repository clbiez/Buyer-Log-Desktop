'use strict';
// Acceptance-only boundary: replace Style List collection and remote HTTP with
// synthetic responses. The actual BOM sync, client, job/routes, store and UI run.
const fs = require('node:fs');
const path = require('node:path');
const app = process.env.INT07_APP_ROOT;
const bom = require(path.join(app, 'server/lib/corenectum-bom-api'));
const style = require(path.join(app, 'server/lib/corenectum-style-api'));
const set = require(path.join(app, 'server/lib/corenectum-set-style-api'));
const settings = require(path.join(app, 'server/lib/corenectum-api-settings'));
settings.saveToken('moderator', 'int07-synthetic-token-not-a-real-credential');
const collector = require(path.join(app, 'server/lib/agent-browser-connector'));
collector.collectCoreNectumStyleLinks = async (_owner, items) => ({ requested: items.length, failed: [], links: items.map(({ plmId }) => ({ plmId, styleId: String(Number(plmId) + 100), styleName: `DEMO-INT07-${plmId}`, productType: 'Set Style' })) });
const metrics = { synthetic: true, active: 0, peak: 0, attempts: 0, byEndpoint: {} };
const save = () => fs.writeFileSync(process.env.INT07_METRICS, JSON.stringify(metrics, null, 2) + '\n');
const response = data => new Response(JSON.stringify({ data: { success: true, coreNectumResultData: data } }));
global.fetch = async (url, options) => {
  const parsed = new URL(url);
  const endpoint = parsed.origin + parsed.pathname;
  if (![bom.GET_STYLE_BOM_INFORMATION_URL, style.GET_STYLE_LIST_URL, set.SET_STYLE_CHILD_ASSOCIATION_URL].includes(endpoint)) throw new Error('Acceptance prohibits non-fixture outbound fetch');
  metrics.active++; metrics.attempts++; metrics.peak = Math.max(metrics.peak, metrics.active);
  metrics.byEndpoint[parsed.pathname.split('/').pop()] = (metrics.byEndpoint[parsed.pathname.split('/').pop()] || 0) + 1; save();
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (endpoint === set.SET_STYLE_CHILD_ASSOCIATION_URL) {
      const parent = Number(parsed.searchParams.get('styleId'));
      return response({ setStyleChildStyleColorAssociations: Array.from({ length: 6 }, (_, i) => ({ rowId: parent * 10 + i, relatedStyleOptions: [{ setStyleId: parent, childStyleId: parent * 10 + i, childStylePlmCode: parent * 100 + i, childStyleName: `DEMO-INT07-${String.fromCharCode(65 + i)}`, perAssemblyCount: 1 }] })) });
    }
    if (endpoint === style.GET_STYLE_LIST_URL) return response({ styleListResult: [] });
    const { styleId } = JSON.parse(options.body);
    return response({ styleBom: { styleId, styleBomId: styleId + 10000, styleBomComponents: [{ styleBomComponentId: styleId + 20000, componentCode: `DEMO-PRINT-${styleId}`, description: 'FRONT BODY', componentType: 'Trim', mainCategoryName: 'Embellishment', categoryName: 'Print', categoryGroupName: 'Pigment', quantity: 1 }] } });
  } finally { metrics.active--; save(); }
};
save();
