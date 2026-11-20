'use strict';

/*
 * #1079 WS6 — checklist ve test raporu yetki çözümü paritesi. Yalnız sentetik demo verisi.
 *
 *   node scripts/parity-checklist-authority.js DIR [DIR...]
 *     DIR: scripts/generate-demo-data.js çıktısı (ASAS - Demo.xlsx, Antrepo - Demo.xlsx)
 *
 * Sunucudaki gerçek agentQualityOrderRowsNow / orderIdentityRowsFromASAS /
 * checklistAuthorizedOrdersNow kaynak metinden alınır. Gerçek parse.js oluşturucusu ve
 * fixture ASAS satırlarıyla iki yol karşılaştırılır:
 *   eski  BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS=0 → buildOrdersRowsFromASAS
 *   yeni  varsayılan                              → kimlik satırları
 * Kapsamlar: moderatör (manageAllOrders) ve kapsamlı buyer (yarı tedarikçi kümesi,
 * yazma yetkisi sipariş kodu bazında). Her kapsamda okuma ve yazma haritasının tamamı
 * (anahtar + kimlik) sıralı JSON → sha256 karşılaştırılır.
 */

const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const APP = path.resolve(__dirname, '..');
const serverPath = path.join(APP, 'server', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');
const parse = require(path.join(APP, 'server', 'lib', 'parse'));
const XLSX = require('xlsx');
const canonicalFields = require(path.join(APP, 'public', 'canonical-fields'));

function fn(name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw Error('missing ' + name);
  return source.slice(at, source.indexOf('\n}', at) + 2);
}
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mapDigest = map => sha([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

function loadFixture(dir) {
  const asas = parse.parseASASWorkbook(XLSX.readFile(path.join(dir, 'ASAS - Demo.xlsx')));
  const antrepoFile = path.join(dir, 'Antrepo - Demo.xlsx');
  const antrepo = fs.existsSync(antrepoFile) ? parse.parseAntrepoWorkbook(XLSX.readFile(antrepoFile)) : {};
  const orders = Array.isArray(asas) ? asas : asas.orders || asas.rows;
  if (!Array.isArray(orders) || !orders.length) throw Error('ASAS rows missing: ' + dir);
  return { orders, antrepo };
}

function context({ orders, antrepo }, scope) {
  const suppliers = [...new Set(orders.map(o => String(o.manufacturer || '')))].sort();
  const allowedSuppliers = new Set(suppliers.filter((_, i) => i % 2 === 0));
  const inScope = row => scope === 'moderator' || allowedSuppliers.has(String(row && row.manufacturer || ''));
  const byCode = new Map();
  orders.forEach(o => { const k = String(o.ocode); if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(o); });
  // Override'lar kimlik alanlarına dokunmadığını göstermek için not/alt üretici/görsel eşlemeleri de dolu.
  const overrides = { noteColumnDefs: [{ id: 'note_ws6', label: 'WS6' }], notesmap: {}, submap: {}, imagemap: {}, licensormap: {} };
  const profile = { id: scope, enabled: true, status: 'ACTIVE' };
  const userAccess = {
    profileById: () => profile,
    hasArea: () => true,
    hasPermission: (_p, perm) => perm === 'manageAllOrders' && scope === 'moderator',
    filterRowsByScope: (_p, rows) => rows.filter(inScope),
    authoritativeOrderRows: code => byCode.get(String(code)) || [],
  };
  const c = {
    require: createRequire(serverPath), process, Map, Set, canonicalFields, userAccess,
    cacheForUser: () => ({ asasOrders: orders }),
    effectiveOverridesForUser: () => overrides,
    ordersForTarget: cache => cache.asasOrders,
    antrepoForTarget: () => antrepo,
    filterRowsByEffectiveHorizon: (_p, _t, rows) => rows,
    buildCPRowsFromASAS: parse.buildCPRowsFromASAS,
    buildOrdersRowsFromASAS: parse.buildOrdersRowsFromASAS,
    // Yazma: kodun tüm satırları kapsamdaysa (sunucudaki "her resmi sahip izin vermeli" kuralı);
    // buyer kapsamında kodların bir kısmı salt okunur, böylece okuma ve yazma haritaları ayrışır.
    canUserEditOrderCode: (_p, code) => scope === 'moderator' || ((byCode.get(String(code)) || []).every(inScope) && Number(crypto.createHash('md5').update(String(code)).digest()[0]) % 3 !== 0),
  };
  vm.createContext(c);
  vm.runInContext(['checklistIdentityRowsEnabled', 'orderIdentityRowsFromASAS', 'agentQualityLiveProfile', 'agentQualityOrderRowsNow', 'checklistAuthorizedOrdersNow', 'agentQualityAuthorizedOrdersNow'].map(fn).join('\n'), c);
  return { c, profile };
}

function run(fixture, scope, identity) {
  const previous = process.env.BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS;
  process.env.BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS = identity ? '1' : '0';
  try {
    const { c, profile } = context(fixture, scope);
    const t0 = performance.now(), read = c.checklistAuthorizedOrdersNow(profile), t1 = performance.now();
    const write = c.checklistAuthorizedOrdersNow(profile, { write: true }), t2 = performance.now();
    // Test raporu: servis authorityHash'i Map sırasıyla hash'ler (digest([...current])); sıra da korunmalı.
    const reportRead = c.agentQualityAuthorizedOrdersNow(profile), t3 = performance.now();
    const reportWrite = c.agentQualityAuthorizedOrdersNow(profile, { write: true }), t4 = performance.now();
    return { read: mapDigest(read), write: mapDigest(write), readSize: read.size, writeSize: write.size, readMs: Math.round(t1 - t0), writeMs: Math.round(t2 - t1),
      reportRead: sha([...reportRead]), reportWrite: sha([...reportWrite]), reportReadSize: reportRead.size, reportWriteSize: reportWrite.size, reportReadMs: Math.round(t3 - t2), reportWriteMs: Math.round(t4 - t3) };
  } finally {
    if (previous === undefined) delete process.env.BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS; else process.env.BUYER_LOG_CHECKLIST_AUTH_IDENTITY_ROWS = previous;
  }
}

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('usage: node scripts/parity-checklist-authority.js DIR [DIR...]'); process.exit(2); }
let failed = false;
for (const dir of dirs) {
  const fixture = loadFixture(dir);
  for (const scope of ['moderator', 'buyer']) {
    const legacy = run(fixture, scope, false), identity = run(fixture, scope, true);
    const ok = legacy.read === identity.read && legacy.write === identity.write && legacy.readSize > 0
      && legacy.reportRead === identity.reportRead && legacy.reportWrite === identity.reportWrite && legacy.reportReadSize > 0;
    failed ||= !ok;
    console.log(JSON.stringify({ rows: fixture.orders.length, scope, ok, readSize: identity.readSize, writeSize: identity.writeSize,
      readHash: identity.read.slice(0, 16), writeHash: identity.write.slice(0, 16), legacyMs: { read: legacy.readMs, write: legacy.writeMs }, identityMs: { read: identity.readMs, write: identity.writeMs },
      report: { readSize: identity.reportReadSize, writeSize: identity.reportWriteSize, readHash: identity.reportRead.slice(0, 16), writeHash: identity.reportWrite.slice(0, 16),
        legacyMs: { read: legacy.reportReadMs, write: legacy.reportWriteMs }, identityMs: { read: identity.reportReadMs, write: identity.reportWriteMs } } }));
  }
}
process.exit(failed ? 1 : 0);
