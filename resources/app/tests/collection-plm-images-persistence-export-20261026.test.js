'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createModelImageCache } = require('../public/model-image-cache.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  const next = source.indexOf('\n}', start);
  assert.ok(next > start, name + ' closing brace not found');
  const asyncStart = source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  return source.slice(asyncStart, next + 2);
}

function modelHelpers({ registry = '', server = '', img = '', ref = '' } = {}) {
  return new Function('canonicalModelImageSource', 'modelImageRefUrl', 'modelImageUrl',
    functionSource(APP, 'kolModelImageSources') + '\n' +
    functionSource(APP, 'kolModelImageSource') +
    '\nreturn { kolModelImageSources, kolModelImageSource };')(
      () => registry, value => ref || '/api/collection-images/' + value, value => String(value || ''));
}

test('PLM-only colourless registry survives hydration without leaking to coloured variants', () => {
  const cache = createModelImageCache({});
  cache.setRegistryMap({ 'plm:2086163': 'ci_willy' });
  assert.equal(cache.hasRegistryKey('2086163', ''), true);
  assert.equal(cache.resolveRegistrySource('2086163', ''), '/api/collection-images/ci_willy');
  assert.equal(cache.resolveRegistrySource('2086163', 'BLUE'), '');
  cache.setRegistryMap({ 'plm:2086163': '', 'plm:2086163|colour:BLUE': 'ci_blue' });
  assert.equal(cache.hasRegistryKey('2086163', ''), true);
  assert.equal(cache.resolveRegistrySource('2086163', ''), '');
  assert.equal(cache.resolveRegistrySource('2086163', 'BLUE'), '/api/collection-images/ci_blue');
});

test('Collection render/clipboard/Excel all prefer scoped persisted registry, then local image/ref', () => {
  const { kolModelImageSources, kolModelImageSource } = modelHelpers({registry:'/api/collection-images/ci_live'});
  const row = {plmId:'2086163',colourCode:'',_sharedCollectionImageUrl:'/api/collection-images/ci_shared',
    _serverPlmImageUrl:'/api/collection-images/ci_server',img:'/api/collection-images/ci_old',imgRef:'ci_fallback'};
  assert.deepEqual(kolModelImageSources(row), ['/api/collection-images/ci_shared','/api/collection-images/ci_live',
    '/api/collection-images/ci_server','/api/collection-images/ci_old','/api/collection-images/ci_fallback']);
  assert.equal(kolModelImageSource(row), '/api/collection-images/ci_shared');
  assert.match(APP,/const collectionImageSource=kolModelImageSource\(r\)/);
  assert.match(APP,/rows\|\|\[\]\)\.map\(record=>kolPrepareModelExcelImage\(kolCollectionProjectionSource\(record\)\)\)/);
  assert.match(APP,/rows\.map\(kolPrepareModelExcelImage\)/);
  assert.match(APP,/return kolModelImageSource\(row\);/);
});

test('Saved PLM image fallback loads valid asset after stale preferred URL', async () => {
  const sources = modelHelpers().kolModelImageSources({
    _sharedCollectionImageUrl:'/missing',_serverPlmImageUrl:'/present',imgRef:'ci_good'
  });
  const attempted = [];
  const helper = new Function('kolModelImageSources', 'kolPrepareExcelImage',
    functionSource(APP,'kolPrepareModelExcelImage') + '\nreturn kolPrepareModelExcelImage;')(
      () => sources, async value => { attempted.push(value); return value==='/present'?{dataUrl:'image'}:null; });
  const image = await helper({});
  assert.deepEqual(attempted, ['/missing','/present']);
  assert.deepEqual(image, {dataUrl:'image'});
  assert.match(APP,/async function kolRecordImageCopyCell[\s\S]*?for\(const source of kolModelImageSources\(row\)\)/);
  assert.match(APP,/html:`<img src="/);
});

test('Collection server rehydrates ONLY accessible workspace row assets and strips transient fields on save', () => {
  const indexed = new Set(['ci_visible','ci_shared']);
  const workspace = {rows:[{id:1,plmId:'2086163',colourCode:'BLUE',colour:'DENIM'}, {id:2,plmId:'unknown'}]};
  const resolve = new Function('loadWorkspace','readCollectionSharedImageCache','loadOverrides','getCollectionImage',
    'parseLib','collectionImageSyncPolicy','collectionImageCacheKey',
    functionSource(SERVER,'collectionWorkspaceWithLocalImages')+'\nreturn collectionWorkspaceWithLocalImages;')(
      () => workspace,()=>({entries:{'owner|1':{imageRef:'ci_shared'}}}),
      ()=>({imagemap:{'plm:2086163|colour:BLUE':'ci_visible','plm:999999':'ci_foreign'}}),
      ref => indexed.has(ref)?{item:{id:ref}}:null,
      {plmImageRef:(map,row)=>map['plm:'+row.plm+'|colour:'+row.ccode]},
      {rowSharedImageIdentity:row=>row.id===1?{id:row.id}:null},
      (owner,item)=>owner+'|'+item.id);
  const result = resolve('owner');
  assert.equal(result.rows[0]._serverPlmImageUrl, '/api/collection-images/ci_visible');
  assert.equal(result.rows[0]._sharedCollectionImageUrl, '/api/collection-images/ci_shared');
  assert.equal(result.rows[1]._serverPlmImageUrl, undefined);
  const persisted = new Function(functionSource(APP,'kolPersistableRow')+'\nreturn kolPersistableRow;')();
  assert.equal(persisted(result.rows[0])._serverPlmImageUrl, undefined);
  assert.equal(persisted(result.rows[0])._sharedCollectionImageUrl, undefined);
});
