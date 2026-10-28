'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scopedCpImageRegistry } = require('../server/lib/cp-image-startup-registry');
const { createModelImageCache } = require('../public/model-image-cache');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('CP startup registry only returns current projection identities, including colour name keys and tombstones', () => {
  const rows = [{ 'PLM ID': '000215013.0', 'C.Code': 'C01' }, { 'PLM ID': '400', 'C.Code': 'B02' }];
  const source = {
    'plm:215013|colour:C01': 'ci_front',
    'plm:215013|colour:C01|name:BLACK': 'ci_named',
    'plm:215013|colour:C02': 'ci_other_colour',
    'plm:215013': 'ci_legacy',
    'plm:400|colour:B02': '',
    'plm:900|colour:A01': 'ci_other_user',
  };
  const { imagemap, scopeKeys } = scopedCpImageRegistry(rows, source);
  assert.deepEqual({ ...imagemap }, {
    'plm:215013|colour:C01': 'ci_front',
    'plm:215013|colour:C01|name:BLACK': 'ci_named',
    'plm:215013': 'ci_legacy',
    'plm:400|colour:B02': '',
  });
  assert.deepEqual(new Set(scopeKeys), new Set(['plm:215013|colour:C01','plm:400|colour:B02','plm:215013','plm:400']));
  assert.equal(Object.hasOwn(imagemap, 'plm:900|colour:A01'), false);
});

test('CP registry applies after projection fetch but before render, without querying PLM', () => {
  const section = APP.slice(APP.indexOf('async function ensureCpLoaded('), APP.indexOf('async function ensureCollectionCatalogLoaded('));
  // Registry (and, for page-cache rows, shared-edit access) are awaited together before any render.
  assert.match(section, /await Promise\.allSettled\(\[refreshCpStartupImageRegistry\(rows\),applyCpSharedEditAccess\(rows\)\]\)/);
  assert.ok(section.indexOf('await Promise.allSettled([refreshCpStartupImageRegistry(rows)') < section.indexOf('renderCP()'));
  assert.doesNotMatch(section, /import-plm|shared\/hydrate/);
  const route = SERVER.slice(SERVER.indexOf("app.get('/api/model-images/registry/cp'"),SERVER.indexOf("app.get('/api/data/collection-catalog'"));
  assert.match(route, /userAccess\.requireArea\('cp'\)/);
  assert.match(route, /pageProjectionCache\.readProjection\(ctx\.id, 'cp', ctx\.contextHash\)/);
  assert.match(route, /pageProjectionMatchesRuntime/);
  assert.match(route, /scopedCpImageRegistry\(cached\.data\.rows/);
  assert.doesNotMatch(route, /agentBrowserConnector|import-plm|syncAuthorized/);
});

test('reopening CP hydrates canonical refs; name-specific overrides, deletion and unrelated registry entries remain consistent', () => {
  const start = APP.indexOf('function applyCpStartupImageRegistry(');
  const end = APP.indexOf('async function refreshCpStartupImageRegistry(', start);
  assert.ok(start >= 0 && end > start);
  const source = APP.slice(start,end);
  const cache = createModelImageCache({});
  const state = { overrides: { imagemap: {
    'plm:215013|colour:C01': 'ci_stale',
    'plm:215013|colour:C01|name:BLACK': 'ci_stale',
    'plm:400|colour:B02': 'ci_old',
    'plm:999|colour:Q01': 'ci_unrelated',
  } } };
  const invalidated = [];
  const row1 = { 'PLM ID': '215013', 'C.Code': 'C01', Colour:'BLACK',_imageRef:'ci_stale',_imageUrl:'/api/cp-images/ci_stale' };
  const row2 = { 'PLM ID': '400', 'C.Code': 'B02',_imageRef:'ci_old',_imageUrl:'/api/cp-images/ci_old' };
  const named=(map,plm,colour,name)=>cache.resolveImageRef(map,plm,colour,name);
  const cacheScope=(plm,colour,name)=>cache.hasRegistryKey(plm,colour,name);
  const make = new Function(
    'state','syncModelImageRegistry','cpImageOverrideKey','cpLegacyPlmImageOverrideKey',
    'cpImageRefFromOverride','canonicalModelImageKnown','BLImageRuntime','CP_IMAGE_API',
    source + '\nreturn applyCpStartupImageRegistry;'
  );
  const apply = make(
    state,()=>cache.setRegistryMap(state.overrides.imagemap),
    (plm,colour)=>cache.canonicalImageKey(plm,colour),
    plm=>'plm:'+cache.normalizeModelId(plm),
    (overrides,plm,code,_order,_model,_ccode,colour)=>{
      const map=overrides.imagemap||{};
      return named(map,plm,code,colour)||map['plm:'+cache.normalizeModelId(plm)]||'';
    },
    cacheScope,{invalidate:urls=>invalidated.push(...urls)},'/api/cp-images'
  );
  const ok=apply({ ok:true, scopeKeys:['plm:215013|colour:C01','plm:215013','plm:400|colour:B02','plm:400'],
    imagemap:{'plm:215013|colour:C01':'ci_new','plm:215013|colour:C01|name:BLACK':'ci_named','plm:400|colour:B02':''}
  },[row1,row2]);
  assert.equal(ok,true);
  assert.equal(row1._imageRef,'ci_named');
  assert.equal(row1._imageUrl,'/api/cp-images/ci_named');
  assert.equal(row2._imageRef,'');
  assert.equal(row2._imageUrl,'');
  assert.equal(cache.resolveRegistrySource('215013','C01','/api/collection-images','BLACK'),'/api/collection-images/ci_named');
  assert.equal(cache.resolveRegistrySource('400','B02'),'');
  assert.equal(state.overrides.imagemap['plm:999|colour:Q01'],'ci_unrelated');
  assert.ok(!Object.values(state.overrides.imagemap).includes('ci_stale'));
  assert.deepEqual(new Set(invalidated),new Set(['/api/cp-images/ci_stale','/api/cp-images/ci_old']));
});
