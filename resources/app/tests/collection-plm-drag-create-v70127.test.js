'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const resolverLib = require('../server/lib/corenectum-attachment-index');
const drag = require('../public/collection-plm-drag-import');
const apiSettings = require('../server/lib/corenectum-api-settings');

const HOT_WHEELS_URL = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/b6aa77e49e6bc3ecf0b2ee900607c7f9';

function payload(records, totalCount = records.length) {
  return { data: { coreNectumResultData: { styleListResult: records, totalCount } } };
}

function liveTemplate(overrides = {}) {
  return {
    pageNumber:1,
    pageSize:20,
    filterCriterias:[{ filterColumnName:'seasonName', filterOperator:1, filterValue:'S7-2027 YAZ' }],
    searchCriteria:{ columnNames:['styleName'], searchText:'HOT' },
    favoriteGroupId:777,
    sortModel:[{ field:'updatedAt', direction:'desc' }],
    securityScope:{ businessUnit:'LCW', tenantId:9 },
    ...overrides,
  };
}

test('gerçek Hot Wheels drag URLsi attachment kimliğine ayrılır', () => {
  assert.equal(drag.normalizeAttachmentUrl(HOT_WHEELS_URL), HOT_WHEELS_URL);
  assert.equal(drag.fileAttachment({ name:'b6aa77e49e6bc3ecf0b2ee900607c7f9.png' }), HOT_WHEELS_URL);
  const dt = {
    types:['text/uri-list','text/html','Files'],
    files: [{ name:'b6aa77e49e6bc3ecf0b2ee900607c7f9.png', type:'image/png' }],
    getData(type) {
      if (type === 'text/uri-list' || type === 'text/plain') return HOT_WHEELS_URL;
      if (type === 'text/html') return '<img src="' + HOT_WHEELS_URL + '">';
      return '';
    },
  };
  assert.equal(drag.extractDropPayload(dt).attachmentUrl, HOT_WHEELS_URL);
});

test('Chromium DownloadURL ve HTML/CSS payloadları URLyi gömülü metinden bulur', () => {
  assert.equal(
    drag.attachmentUrlFromText('image/png:hotwheels.png:' + HOT_WHEELS_URL),
    HOT_WHEELS_URL
  );
  assert.equal(
    drag.attachmentUrlFromText('<div style="background-image:url(\'' + HOT_WHEELS_URL + '?v=1\')"></div>'),
    HOT_WHEELS_URL
  );
  const dt = {
    types:['DownloadURL'],
    files:[],
    getData(type){ return type === 'DownloadURL' ? 'image/png:x.png:' + HOT_WHEELS_URL : ''; },
  };
  assert.equal(drag.extractDropPayload(dt).attachmentUrl, HOT_WHEELS_URL);
});

test('DataTransferItem.getAsString fallbackı cross-window drag payloadını çözer', async () => {
  const dt = {
    types:['text/html'],
    files:[],
    getData(){ return ''; },
    items:[{
      kind:'string',
      type:'text/html',
      getAsString(callback){ setImmediate(() => callback('<img src="' + HOT_WHEELS_URL + '">')); },
    }],
  };
  const result = await drag.extractDropPayloadAsync(dt);
  assert.equal(result.attachmentUrl, HOT_WHEELS_URL);
});

test('attachment reverse index Hot Wheels görselini PLM 2131790 ile eşler ve cache kullanır', async () => {
  let calls = 0;
  const resolver = resolverLib.createAttachmentResolver({
    ttlMs:60000,
    getTemplate:()=>apiSettings.sanitizeStyleListTemplate(liveTemplate()),
    paginateTemplate:apiSettings.paginateStyleListTemplate,
    postJson:async (_owner, _url, body) => {
      calls += 1;
      assert.equal(body.pageNumber, 1);
      assert.deepEqual(body.filterCriterias, [{ filterColumnName:'seasonName', filterOperator:1, filterValue:'S7-2027 YAZ' }]);
      assert.deepEqual(body.searchCriteria, { columnNames:['styleName'], searchText:'HOT' });
      assert.equal(body.favoriteGroupId, 777);
      assert.deepEqual(body.sortModel, [{ field:'updatedAt', direction:'desc' }]);
      assert.deepEqual(body.securityScope, { businessUnit:'LCW', tenantId:9 });
      return payload([{
        styleId:2533116,
        styleName:'HOTWHEELS-2-YI',
        plmCode:2131790,
        imageUrl:HOT_WHEELS_URL,
      }], 1);
    },
  });
  const first = await resolver.resolve('buyer-1', HOT_WHEELS_URL);
  assert.equal(first.plmId, '2131790');
  assert.equal(first.styleId, '2533116');
  assert.equal(first.styleName, 'HOTWHEELS-2-YI');
  assert.equal(first.cached, false);
  const second = await resolver.resolve('buyer-1', HOT_WHEELS_URL);
  assert.equal(second.plmId, '2131790');
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('reverse index totalCount bitmeden sonraki sayfayı tarar', async () => {
  const calls = [];
  const resolver = resolverLib.createAttachmentResolver({
    getTemplate:()=>apiSettings.sanitizeStyleListTemplate(liveTemplate()),
    paginateTemplate:apiSettings.paginateStyleListTemplate,
    postJson:async (_owner, _url, body) => {
      calls.push(body.pageNumber);
      if (body.pageNumber === 1) return payload([{
        styleId:1, styleName:'OTHER', plmCode:100,
        imageUrl:'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }], 2);
      return payload([{
        styleId:2533116, styleName:'HOTWHEELS-2-YI', plmCode:2131790, imageUrl:HOT_WHEELS_URL,
      }], 2);
    },
  });
  const found = await resolver.resolve('buyer-2', HOT_WHEELS_URL);
  assert.equal(found.plmId, '2131790');
  assert.deepEqual(calls, [1,2]);
});

test('aynı attachment iki farklı PLMye bağlıysa keyfi model seçilmez', async () => {
  const resolver = resolverLib.createAttachmentResolver({
    getTemplate:()=>apiSettings.sanitizeStyleListTemplate(liveTemplate()),
    paginateTemplate:apiSettings.paginateStyleListTemplate,
    postJson:async () => payload([
      {styleId:1,styleName:'A',plmCode:100,imageUrl:HOT_WHEELS_URL},
      {styleId:2,styleName:'B',plmCode:200,imageUrl:HOT_WHEELS_URL},
    ], 2),
  });
  await assert.rejects(() => resolver.resolve('buyer-3', HOT_WHEELS_URL), error => error && error.code === 'CORENECTUM_ATTACHMENT_AMBIGUOUS');
});


test('yakalanan canlı Style List template request semantiğini korur; yalnız sırları ve sayfalamayı değiştirir', () => {
  const sanitized=apiSettings.sanitizeStyleListTemplate(liveTemplate({
    authorization:'Bearer SHOULD_NOT_SURVIVE',
    accessToken:'SECRET',
  }));
  assert.deepEqual(sanitized.filterCriterias, [{ filterColumnName:'seasonName', filterOperator:1, filterValue:'S7-2027 YAZ' }]);
  assert.deepEqual(sanitized.searchCriteria, { columnNames:['styleName'], searchText:'HOT' });
  assert.equal(sanitized.favoriteGroupId, 777);
  assert.deepEqual(sanitized.sortModel, [{ field:'updatedAt', direction:'desc' }]);
  assert.deepEqual(sanitized.securityScope, { businessUnit:'LCW', tenantId:9 });
  assert.equal('authorization' in sanitized, false);
  assert.equal('accessToken' in sanitized, false);
  const second=apiSettings.paginateStyleListTemplate(sanitized,2);
  assert.equal(second.body.pageNumber,2);
  assert.equal(second.body.pageSize,20);
  assert.equal(second.pageSize,20);
  assert.deepEqual(second.body.filterCriterias, sanitized.filterCriterias);
  assert.deepEqual(second.body.searchCriteria, sanitized.searchCriteria);
  assert.equal(second.body.favoriteGroupId, sanitized.favoriteGroupId);
  assert.deepEqual(second.body.sortModel, sanitized.sortModel);
  assert.deepEqual(second.body.securityScope, sanitized.securityScope);
});

test('reverse index template yoksa CoreNectum 400 göndermek yerine açık preflight hatası verir', async () => {
  let calls=0;
  const resolver=resolverLib.createAttachmentResolver({
    getTemplate:()=>null,
    postJson:async()=>{calls+=1;return payload([]);},
  });
  await assert.rejects(
    ()=>resolver.resolve('buyer-template-missing',HOT_WHEELS_URL),
    error=>error&&error.code==='CORENECTUM_STYLE_TEMPLATE_REQUIRED'&&error.statusCode===409
  );
  assert.equal(calls,0);
});

test('Electron SSO gerçek GetStyleList POST body şablonunu internal bridge ile yakalar', () => {
  const source=fs.readFileSync(path.join(ROOT,'electron','main.js'),'utf8');
  assert.match(source,/webRequest\.onBeforeRequest\(\{ urls: \[CORENECTUM_STYLE_LIST_API\] \}/);
  assert.match(source,/coreNectumStyleTemplateFromRequest/);
  assert.match(source,/\/api\/internal\/desktop\/corenectum-style-template/);
  assert.match(source,/pushCoreNectumStyleTemplateToBackend/);
});

test('Collection drag preflight template hazır değilse otomatik SSO yenilemesini ister', () => {
  const dragSource=fs.readFileSync(path.join(ROOT,'public','collection-plm-drag-import.js'),'utf8');
  const appSource=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
  assert.match(dragSource,/ensureCoreNectumApiConnection\(\{ requireStyleListTemplate:true \}\)/);
  assert.match(appSource,/requireStyleListTemplate/);
  assert.match(appSource,/styleListTemplateReady/);
});

test('drag/drop document capture seviyesinde yalnız Collection için kurulur', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'collection-plm-drag-import.js'), 'utf8');
  assert.match(source, /getElementById\('view-koleksiyon'\)/);
  assert.match(source, /document\.addEventListener\('drop', drop, true\)/);
  assert.match(source, /document\.addEventListener\('dragover', over, true\)/);
  assert.match(source, /document\.body\.dataset\.activeTab === 'koleksiyon'/);
  assert.doesNotMatch(source, /getElementById\('view-(?:cp|orders)'\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('drag import CoreNectum preflight yapar ve mevcut PLMyi update etmez', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'collection-plm-drag-import.js'), 'utf8');
  assert.match(source, /ensureCoreNectumApiConnection/);
  assert.match(source, /existingRowsFor\(plmId\)\.length/);
  assert.match(source, /Sürükle-bırak mevcut modeli değiştirmez/);
  assert.match(source, /\/api\/corenectum-api\/resolve-attachment/);
  assert.match(source, /\/api\/plm-sync\/fetch/);
  assert.match(source, /kolRows = \[\.\.\.created, \.\.\.kolRows\]/);
  assert.doesNotMatch(source, /kolApplyApprovedPlmUpdate/);
});

test('server reverse lookup route yalnız Collection yetkisiyle ve direct resolver ile çalışır', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const start = source.indexOf("app.post('/api/corenectum-api/resolve-attachment'");
  assert.ok(start >= 0);
  const route = source.slice(start, source.indexOf('\n});', start) + 4);
  assert.match(route, /userAccess\.requireArea\('koleksiyon'\)/);
  assert.match(route, /coreNectumAttachmentIndex\.resolve/);
  assert.doesNotMatch(route, /browserDebugService|CDP|Edge/);
});


test('CoreNectum browser drag global Excel dropzone yerine Collection importerına yönlenir', () => {
  const browserDrag = {
    types:['text/plain','text/uri-list','text/html','chromium/x-drag-id','Files'],
    items:[
      {kind:'string',type:'text/plain'},
      {kind:'file',type:'image/png'},
    ],
  };
  assert.equal(drag.isCandidateTransfer(browserDrag), true);

  const excelDrag = {
    types:['Files'],
    items:[{kind:'file',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}],
  };
  assert.equal(drag.isCandidateTransfer(excelDrag), false, 'Explorer Excel drop davranışı korunmalı');
});

test('legacy global dropzone Collection PLM draginde geri çekilir', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  const start = source.indexOf('function isCollectionPlmImageDrag');
  assert.ok(start >= 0);
  const block = source.slice(start, start + 2200);
  assert.match(block, /BLCollectionPlmDragImport\?\.isCandidateTransfer/);
  assert.match(block, /if\(!isFileDrag\(e\)\|\|isCollectionPlmImageDrag\(e\)\) return/);
});

test('PLM drag capture target dropzone olsa bile aktif kalır ve eski overlayi kapatır', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'collection-plm-drag-import.js'), 'utf8');
  assert.match(source, /dataset\.activeTab === 'koleksiyon'[\s\S]{0,120}isCandidateTransfer/);
  assert.doesNotMatch(source, /root\.contains\(target\)/);
  assert.match(source, /getElementById\('dropzone'\)/);
  assert.match(source, /legacy\.classList\.remove\('show'\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});
