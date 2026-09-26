'use strict';

/* SİPARİŞ SAHİPLİĞİ (orderAccess) — Shared Hub dağıtımı.

   Buyer'ın bir CP satırını düzenleyebilmesi, satırın sahipliğine bağlıdır ve bu
   sahiplik yalnız Moderatörün son başarılı ASAS görüntüsünden türetilir (Buyer
   klasörleri kullanıcı yönetimlidir, yetki kaynağı olamaz). Merkezi IAM kipinde
   türetilen harita yalnız Moderatör cihazındaki iam-derived.json'a yazılıyordu;
   kendi bilgisayarındaki hiçbir Buyer hiçbir satırı düzenleyemiyordu
   (ORDER_VIEW_ONLY).

   Harita IAM dizininin yanında, ayrı bir belgede taşınır: IAM revizyonlarına
   iş verisi karışmaz (bkz. central-iam snapshot sözleşmesi) ve her ASAS
   yenilemesi IAM revizyonu üretmez. Belge sha256 özetiyle doğrulanır; yarım
   ya da bozuk kopya yok sayılır ve cihaz son doğrulanmış yerel kopyayla devam
   eder. Paylaşım kökü yoksa ya da IAM başlatılmamışsa HİÇBİR ŞEY oluşturulmaz. */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function digestOf(orderAccess, scopeCatalog) {
  return crypto.createHash('sha256').update(JSON.stringify({ orderAccess, scopeCatalog })).digest('hex');
}
function sharedFile(root) { return path.join(path.resolve(root), 'iam', 'derived', 'order-access.json'); }

function validOrderAccess(value) {
  if (!isPlainObject(value)) return false;
  for (const [code, rows] of Object.entries(value)) {
    if (!/^\d+$/.test(code) || !Array.isArray(rows)) return false;
    for (const row of rows) if (!isPlainObject(row)) return false;
  }
  return true;
}

function normalizeDocument(raw) {
  if (!isPlainObject(raw) || raw.schemaVersion !== SCHEMA_VERSION) return null;
  const orderAccess = raw.orderAccess, scopeCatalog = isPlainObject(raw.scopeCatalog) ? raw.scopeCatalog : {};
  if (!validOrderAccess(orderAccess)) return null;
  if (!/^[a-f0-9]{64}$/.test(String(raw.sha256 || '')) || digestOf(orderAccess, scopeCatalog) !== raw.sha256) return null;
  if (!Number.isFinite(Date.parse(raw.generatedAt))) return null;
  return { schemaVersion: SCHEMA_VERSION, generatedAt: raw.generatedAt, generatedBy: String(raw.generatedBy || ''), sha256: raw.sha256, orderAccess, scopeCatalog };
}

async function iamInitialized(root) {
  try { return (await fsp.stat(path.join(path.resolve(root), 'iam'))).isDirectory(); }
  catch (_) { return false; }
}

async function readShared(root) {
  if (!root) return null;
  try { return normalizeDocument(JSON.parse(await fsp.readFile(sharedFile(root), 'utf8'))); }
  catch (_) { return null; }
}

async function publishShared(root, { orderAccess, scopeCatalog = {}, generatedBy = '', generatedAt = new Date().toISOString() } = {}) {
  if (!root) return { published: false, reason: 'not-configured' };
  if (!validOrderAccess(orderAccess)) return { published: false, reason: 'invalid' };
  if (!(await iamInitialized(root))) return { published: false, reason: 'iam-not-initialized' };
  const catalog = isPlainObject(scopeCatalog) ? scopeCatalog : {};
  const sha256 = digestOf(orderAccess, catalog);
  const current = await readShared(root);
  if (current && current.sha256 === sha256) return { published: false, unchanged: true, sha256 };
  const file = sharedFile(root);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const document = { schemaVersion: SCHEMA_VERSION, generatedAt, generatedBy: String(generatedBy || ''), sha256, orderAccess, scopeCatalog: catalog };
  try {
    await fsp.writeFile(tmp, JSON.stringify(document), { encoding: 'utf8', flag: 'wx' });
    await fsp.rename(tmp, file);
  } finally { try { await fsp.unlink(tmp); } catch (_) {} }
  return { published: true, sha256, generatedAt };
}

/* Yerel kopya (iam-derived.json) ile paylaşılanı karşılaştırır. Paylaşılan daha
   YENİ ve farklıysa döndürür; aksi hâlde null. Moderatör cihazının kendi yeni
   görüntüsü, henüz yayımlanamamış olsa bile eski hub kopyasıyla ezilmez. */
function newerThanLocal(shared, local) {
  if (!shared) return null;
  const localSha = local && validOrderAccess(local.orderAccess)
    ? digestOf(local.orderAccess, isPlainObject(local.scopeCatalog) ? local.scopeCatalog : {}) : '';
  if (localSha === shared.sha256) return null;
  const localAt = Date.parse(local && local.generatedAt);
  if (Number.isFinite(localAt) && localAt >= Date.parse(shared.generatedAt)) return null;
  return shared;
}

function readLocalSync(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

module.exports = { SCHEMA_VERSION, sharedFile, digestOf, readShared, publishShared, newerThanLocal, readLocalSync, normalizeDocument };
