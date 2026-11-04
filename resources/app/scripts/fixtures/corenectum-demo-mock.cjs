'use strict';
/* Kabul testleri için CoreNectum taklidi. YALNIZ izole demo sunucusuna
   `node --require` ile yüklenir; üretim kodu bu dosyayı hiçbir zaman yüklemez.
   Gerçek CoreNectum'a istek gitmez, gerçek iş verisi kullanılmaz: her kayıt
   PLM kodundan türetilmiş anonim demo verisidir. Sayaçlar
   BL_DEMO_CORENECTUM_LOG dosyasına yazılır (iptalin yeni istek başlatmadığını
   dışarıdan doğrulamak için). */
const fs = require('fs');

const realFetch = globalThis.fetch;
const BOM_DELAY_MS = Math.max(0, Number(process.env.BL_DEMO_BOM_DELAY_MS) || 2500);
const LOG_FILE = process.env.BL_DEMO_CORENECTUM_LOG || '';
const counts = { styleList: 0, bom: 0 };

function note(kind) {
  counts[kind] += 1;
  if (LOG_FILE) { try { fs.writeFileSync(LOG_FILE, JSON.stringify(counts)); } catch (_) {} }
}
function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
function demoStyle(code) {
  const n = Number(code);
  return {
    plmCode: n, styleId: 800000 + n, styleName: `DEMO-${code}`, specialCode: `SC-${code}`, seasonName: '26 SS',
    productTypeName: 'Single Style', productMainDefinitionName: 'Tişört', mainFabricInfo: '%100 Pamuk Süprem / 100% Cotton Jersey',
    merchSubGroupName: 'T-Shirt', merchBrandAgeGroupName: 'Erkek Çocuk', buyerGroupName: 'Licence', lineName: 'Basic',
    productCategoryName: 'Tişört', labelFitName: n % 2 ? 'Regular' : 'Oversize', workflowStatusName: 'Design',
  };
}
function component(id, description, technique) {
  return {
    styleBomId: 1, styleBomComponentId: id, componentId: id, componentCode: `B${id}`, description,
    componentType: 'Trim', mainCategoryId: 1, mainCategoryName: 'Embellishment', categoryId: 21, categoryName: 'Print',
    categoryGroupId: 3, categoryGroupName: technique, quantity: 1,
  };
}
function bomPayload(styleId) {
  const n = Number(styleId) - 800000;
  const components = n % 3 === 0 ? [] : n % 3 === 1
    ? [component(n * 10 + 1, 'ÖN BEDEN / FRONT BODY', 'Pigment')]
    : [component(n * 10 + 1, 'ÖN BEDEN / FRONT BODY', 'Pigment'), component(n * 10 + 2, 'ARKA BEDEN / BACK BODY', 'Transfer')];
  return { data: { coreNectumResultData: { styleBom: { styleId: Number(styleId), styleBomId: n, createdDate: null, modifiedDate: null, styleBomComponents: components } }, success: true } };
}
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
  });
}

globalThis.fetch = async (input, init = {}) => {
  const href = String(input && input.href || input);
  if (!href.startsWith('https://mym-api.lcwaikiki.com/')) return realFetch(input, init);
  let body = {};
  try { body = init.body ? JSON.parse(init.body) : {}; } catch (_) {}
  if (href.includes('/StyleList/GetStyleList')) {
    note('styleList');
    await wait(300, init.signal);
    const codes = String(body.filterCriterias && body.filterCriterias[0] && body.filterCriterias[0].filterValue || '').split(',').filter(Boolean);
    return json({ data: { coreNectumResultData: { styleListResult: codes.map(demoStyle) } } });
  }
  if (href.includes('GetStyleBomInformation')) {
    note('bom');
    await wait(BOM_DELAY_MS, init.signal);
    return json(bomPayload(body.styleId));
  }
  return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
};
