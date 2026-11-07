'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {createComputePool} = require('../server/lib/compute-pool');
const {createComputeService} = require('../server/lib/compute-service');
const {createAccessContext} = require('../server/lib/compute-access');
const serverCatalog = require('./helpers/server-collection-catalog');
const MiB = 1024 * 1024;

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-catalog-contract-'));
  const pool = createComputePool({maxWorkers:1, memoryBudgetBytes:768*MiB, maxPendingBytes:64*MiB});
  const service = createComputeService({pool, root, diskBudgetBytes:8*MiB});
  t.after(async () => { await service.close(); fs.rmSync(root, {recursive:true, force:true}); });
  const row = (ocode, manufacturer, buyer='Synthetic Buyer') => ({
    ocode, model:'Demo model', ccode:'R', colour:'Red', buyer, manufacturer,
    merch:'M', ageGroup:'A', buyerGrup:'G', category:'Demo category',
    productDescription:'Demo T-shirt', qty:10, kalan:5, fob:5,
    ex:new Date(2026,6,1), retail:new Date(2026,7,1), mb:new Date(2026,8,1),
  });
  const source = {loadedAt:'demo-r1', asasOrders:[], antrepoMap:{}, lflRows:[],
    asasOrdersByTarget:{cp:[row(1,'CP-only factory')], orders:[row(2,'Orders factory'), row(3,'Foreign factory','Other Buyer')]}};
  const descriptor = await service.seedSource({ownerId:'demo', generation:'demo-g1', source, uncompressedBytes:MiB});
  const access = createAccessContext({userId:'demo', systemRole:'buyer',
    viewScope:{buyers:['Synthetic Buyer']}, authority:{}, profiles:[]});
  return {service, descriptor, params:{overrides:{}, horizons:{}, access, cpAllowed:true, summaryAllowed:true}};
}

function decode(entry) {
  return JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)).toString('utf8'));
}

test('native catalog uses scoped ASAS Orders, reuses verified Orders gzip and preserves denied access', async t => {
  const {service, descriptor, params} = await setup(t), api = serverCatalog();
  const fresh = await service.run('projections', descriptor, {...params, modules:['orders','collection-catalog']});
  try {
    const orders = decode(fresh.value.compressed.orders), catalog = decode(fresh.value.compressed['collection-catalog']);
    assert.equal(orders.rows.length, 1, 'foreign Buyer is excluded');
    assert.equal(catalog.catalogSchemaVersion, 3);
    assert.deepEqual(catalog.catalogs, api.buildCollectionCatalogs(orders.rows));
    assert.deepEqual(catalog.catalogs.manufacturer, ['Orders factory'], 'catalog uses Orders target, not CP or foreign rows');
  } finally { fresh.release(); }

  const cachedRows = [{Manufacturer:'Cached Orders factory', productDescription:'Cached T-shirt', Category:'Cached category'}];
  const reused = await service.run('projections', descriptor, {...params, modules:['collection-catalog'],
    catalogOrdersBuffer:zlib.gzipSync(JSON.stringify({rows:cachedRows}))});
  try {
    assert.deepEqual(Object.keys(reused.value.compressed), ['collection-catalog'], 'no redundant Orders projection');
    const catalog = decode(reused.value.compressed['collection-catalog']);
    assert.equal(catalog.catalogSchemaVersion, 3);
    assert.deepEqual(catalog.catalogs, api.buildCollectionCatalogs(cachedRows));
    assert.deepEqual(catalog.catalogs.manufacturer, ['Cached Orders factory'], 'verified reused rows take precedence over raw source');
    assert.deepEqual(catalog.catalogs.productMainDefinition, ['Cached T-shirt']);
  } finally { reused.release(); }

  const denied = await service.run('projections', descriptor, {...params, cpAllowed:false, modules:['collection-catalog'],
    catalogOrdersBuffer:zlib.gzipSync(JSON.stringify({rows:cachedRows}))});
  try {
    assert.deepEqual(decode(denied.value.compressed['collection-catalog']), {catalogs:{}, catalogSchemaVersion:3});
  } finally { denied.release(); }
});

test('native cached catalog response rejects missing/old/partial schemas and returns exact complete v3 data', async t => {
  const {service, descriptor, params} = await setup(t), api = serverCatalog();
  const catalogs = api.buildCollectionCatalogs([{Manufacturer:'Demo factory', productDescription:'Demo T-shirt'}]);
  const partial = {...catalogs}; delete partial.manufacturer;
  // Cached envelopes must not hydrate source records even after a worker restart.
  fs.writeFileSync(descriptor.replicaFile, 'Synthetic unreadable source: cached envelopes must use verified gzip');
  for (const payload of [{catalogs}, {catalogSchemaVersion:1,catalogs}, {catalogSchemaVersion:2,catalogs},
    {catalogSchemaVersion:3,catalogs:partial}, {catalogSchemaVersion:4,catalogs}]) {
    const lease = await service.run('projection-envelope', descriptor, {...params, legacyModule:'collection-catalog',
      cachedModules:{'collection-catalog':zlib.gzipSync(JSON.stringify(payload))}});
    try { assert.deepEqual(lease.value, {needsRebuild:true}, 'invalid cached catalog must request a rebuild'); }
    finally { lease.release(); }
  }
  const payload = {catalogSchemaVersion:3, catalogs};
  const valid = await service.run('projection-envelope', descriptor, {...params, legacyModule:'collection-catalog',
    cachedModules:{'collection-catalog':zlib.gzipSync(JSON.stringify(payload))}});
  try { assert.deepEqual(decode(valid.value), payload, 'complete v3 catalog is returned without source fallback'); }
  finally { valid.release(); }
});
