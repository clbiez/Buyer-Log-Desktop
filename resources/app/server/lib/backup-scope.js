'use strict';

/*
 * Backup / restore kapsamının TEK kaynağı.
 *
 * Kapsam "allowlist" değil "denylist" mantığıyla çalışır: Buyer Log veri
 * köklerindeki (server-data, app-data, local-data) her dosya varsayılan olarak
 * yedeğe girer. Böylece yeni bir özellik yeni bir veri dosyası/klasörü
 * eklediğinde backup ve seçmeli restore kapsamı kod değişikliği gerekmeden
 * otomatik genişler. Yalnız şu sınıflar dışarıda kalır:
 *   - kimlik/sır materyali (backup-sensitivity.js),
 *   - önbellek/geçici/log klasörleri (yeniden üretilebilir),
 *   - boyutu şişiren varlıklar: model dosyaları, görseller, 3D/video/arşiv/PDF.
 *
 * Restore tarafı aynı filtreyi kullanır; yedeğe girmeyen dosyalar restore
 * sırasında silinmez/ezilmez (ör. mevcut görseller korunur).
 *
 * BACKUP_COMPONENT_CATALOG yalnız okunabilir etiket/kategori sağlar. Katalogda
 * olmayan yeni bir veri alanı yine yedeklenir ve restore listesinde
 * "Otomatik algılandı" etiketiyle seçilebilir görünür.
 */

const { isSensitiveBackupPath } = require('./backup-sensitivity');

// Her veri kökünde üst seviyede atlanan klasörler. Hepsi önbellek, geçici,
// log, cihaz-yerel kimlik veya büyük varlık deposudur.
const HEAVY_ASSET_DIRS = Object.freeze([
  'model-files', 'collection-images', 'model-snapshots', 'model-exports', 'oab-snapshots',
  'plm-image-jobs',
]);
const CACHE_DIRS = Object.freeze([
  'logs', 'email-drafts', 'auth', 'page-cache', 'oab-cache', 'intake-cache', 'agent-browser',
  'browser-profiles', 'managed-edge', 'web-agent-profiles', 'write-recovery', '.buyerlog-write-recovery',
  'restore-recovery', 'system-backups', 'auto-backups', 'auto-backup-staging',
]);
const BACKUP_EXCLUDED_TOP = Object.freeze([...CACHE_DIRS, ...HEAVY_ASSET_DIRS]);

// Görsel, model/3D, video/ses, ofis dışı ikili ve arşiv dosyaları.
// Not: .gz bilerek listede yok (endeksmatik-snapshot.json.gz iş verisidir).
const HEAVY_EXT = /\.(?:png|jpe?g|jfif|gif|webp|bmp|tiff?|heic|heif|avif|ico|svg|psd|psb|ai|eps|indd|raw|cr2|nef|dng|glb|gltf|obj|fbx|stl|3ds|3dm|blend|dae|ply|usdz?|max|c4d|zprj|zpac|avt|vsp|u3m|sbsar|mp4|m4v|mov|avi|mkv|webm|wmv|flv|mp3|wav|m4a|aac|flac|ogg|zip|7z|rar|tar|tgz|bz2|xz|iso|dmg|exe|msi|dll|pdf|blgbackup)$/i;

function normalizeRel(rel) { return String(rel || '').replace(/\\/g, '/'); }

function isHeavyBackupPath(rel) {
  const normalized = normalizeRel(rel);
  if (!normalized) return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.slice(0, -1).some(part => HEAVY_ASSET_DIRS.includes(part))) return true;
  return HEAVY_EXT.test(parts[parts.length - 1] || '');
}

/*
 * Backup ve restore yürüyüşlerinin ortak filtresi. true dönerse dosya yedeğe
 * girmez ve restore sırasında dokunulmaz.
 */
function skipBackupFile(rel, topExcludes) {
  const normalized = normalizeRel(rel), parts = normalized.split('/');
  if (!normalized || (topExcludes && topExcludes.has(parts[0]))) return true;
  if (parts.some(part => /^(?:auth|cache|caches|temp|tmp|logs?|sessions?)$/i.test(part))) return true;
  if (/\.(?:tmp|lock|write-lock)$/i.test(normalized)) return true;
  if (isSensitiveBackupPath(normalized)) return true;
  return isHeavyBackupPath(normalized);
}

const CATEGORIES = Object.freeze([
  { id: 'core', tr: 'Temel veri ve ayarlar', en: 'Core data & settings' },
  { id: 'collection', tr: 'Collection', en: 'Collection' },
  { id: 'orders', tr: 'Siparişler ve operasyon', en: 'Orders & operations' },
  { id: 'pricing', tr: 'Fiyatlama ve maliyet', en: 'Pricing & costing' },
  { id: 'plm', tr: 'PLM', en: 'PLM' },
  { id: 'users', tr: 'Kullanıcı verileri', en: 'User data' },
  { id: 'system', tr: 'Sistem ve güvenlik', en: 'System & security' },
  { id: 'assets', tr: 'Dosya varlıkları (eski yedek)', en: 'File assets (legacy backup)' },
  { id: 'other', tr: 'Otomatik algılanan yeni veriler', en: 'Auto-detected new data' },
]);

// Ad → etiket. Uzantı yok sayılır; hem "settings.json" hem "settings" eşleşir.
const BACKUP_COMPONENT_CATALOG = Object.freeze({
  'BuyerLogLocal.db': { cat: 'core', tr: 'Yerel veritabanı (siparişler, kayıtlar)', en: 'Local database (orders, records)' },
  'BuyerLogLocal.db.wal': { cat: 'core', tr: 'Yerel veritabanı günlüğü', en: 'Local database journal' },
  'BuyerLogLocal.db.bak': { cat: 'core', tr: 'Yerel veritabanı yedek kopyası', en: 'Local database safety copy' },
  'BuyerLogLocal.db.wal.bak': { cat: 'core', tr: 'Yerel veritabanı günlüğü yedek kopyası', en: 'Local database journal safety copy' },
  'settings': { cat: 'core', tr: 'Uygulama ve bağlantı ayarları', en: 'Application & connection settings' },
  'overrides': { cat: 'core', tr: 'Manuel alan düzeltmeleri', en: 'Manual field overrides' },
  'baseline': { cat: 'core', tr: 'Baseline verisi', en: 'Baseline data' },
  'views': { cat: 'core', tr: 'Görünümler', en: 'Views' },
  'filters': { cat: 'core', tr: 'Filtre profilleri', en: 'Filter profiles' },
  'source-refresh-history': { cat: 'core', tr: 'Kaynak yenileme geçmişi', en: 'Source refresh history' },
  'source-watch': { cat: 'core', tr: 'Kaynak izleme durumu', en: 'Source watch state' },
  'shared-data': { cat: 'core', tr: 'Paylaşılan veri kopyası', en: 'Shared data copy' },
  'dashboard-refresh': { cat: 'core', tr: 'Pano yenileme durumu', en: 'Dashboard refresh state' },
  'server': { cat: 'core', tr: 'Sunucu veri dosyaları', en: 'Server data files' },
  'app': { cat: 'core', tr: 'Uygulama veri dosyaları', en: 'Application data files' },
  'local': { cat: 'core', tr: 'Yerel veri dosyaları', en: 'Local data files' },
  'local-first': { cat: 'core', tr: 'Eski sürüm yerel veri klasörü', en: 'Legacy local data folder' },
  'local-first-copy': { cat: 'core', tr: 'Eski sürüm yerel veri kopyası', en: 'Legacy local data copy' },
  'local-first - Kopya': { cat: 'core', tr: 'Eski sürüm yerel veri kopyası', en: 'Legacy local data copy' },
  'data': { cat: 'core', tr: 'Eski sürüm veri klasörü', en: 'Legacy data folder' },
  'application-data': { cat: 'core', tr: 'Eski sürüm uygulama verisi', en: 'Legacy application data' },

  'collection-workspaces': { cat: 'collection', tr: 'Collection çalışma alanları', en: 'Collection workspaces' },
  'collection-master-catalog': { cat: 'collection', tr: 'Collection ana kataloğu', en: 'Collection master catalogue' },
  'collection-permissions': { cat: 'collection', tr: 'Collection yetkileri', en: 'Collection permissions' },
  'collection-recycle-bin': { cat: 'collection', tr: 'Collection geri dönüşüm kutusu', en: 'Collection recycle bin' },
  'collection-replication-state': { cat: 'collection', tr: 'Collection eşitleme durumu', en: 'Collection replication state' },
  'collection-shared-image-cache': { cat: 'collection', tr: 'Collection görsel referansları', en: 'Collection image references' },
  'collection-image-scope-migration-v1': { cat: 'collection', tr: 'Collection görsel geçiş kaydı', en: 'Collection image migration record' },

  'shipping-comparison': { cat: 'orders', tr: 'Shipping Comparison', en: 'Shipping Comparison' },
  'checklist-supplier-sync': { cat: 'orders', tr: 'Checklist tedarikçi eşitlemesi', en: 'Checklist supplier sync' },
  'checklist-attachments': { cat: 'orders', tr: 'Checklist ekleri (görseller hariç)', en: 'Checklist attachments (images excluded)' },
  'backlog-plan-actual': { cat: 'orders', tr: 'Backlog plan / gerçekleşen', en: 'Backlog plan / actual' },
  'oab-settings': { cat: 'orders', tr: 'OAB ayarları', en: 'OAB settings' },
  'oab-metadata': { cat: 'orders', tr: 'OAB meta verisi', en: 'OAB metadata' },
  'automation-recipes': { cat: 'orders', tr: 'Otomasyon tarifleri', en: 'Automation recipes' },
  'automation-mail-drafts': { cat: 'orders', tr: 'Otomasyon e-posta taslakları', en: 'Automation mail drafts' },
  'email-groups': { cat: 'orders', tr: 'E-posta grupları', en: 'Email groups' },
  'holidays': { cat: 'orders', tr: 'Tatil takvimleri', en: 'Holiday calendars' },
  'world-clock': { cat: 'orders', tr: 'Dünya saati ayarları', en: 'World clock settings' },
  'horizon-templates': { cat: 'orders', tr: 'Ufuk şablonları', en: 'Horizon templates' },
  'global-flow-earth-settings': { cat: 'orders', tr: 'Global Flow ayarları', en: 'Global Flow settings' },

  'quotations': { cat: 'pricing', tr: 'Teklifler', en: 'Quotations' },
  'quotation-visibility': { cat: 'pricing', tr: 'Teklif görünürlüğü', en: 'Quotation visibility' },
  'open-costing': { cat: 'pricing', tr: 'Open Costing', en: 'Open Costing' },
  'fx-rates': { cat: 'pricing', tr: 'Döviz kurları', en: 'FX rates' },
  'endeksmatik-snapshot.json.gz': { cat: 'pricing', tr: 'Endeksmatik verisi', en: 'Endeksmatik data' },
  'endeksmatik-sets': { cat: 'pricing', tr: 'Endeksmatik setleri', en: 'Endeksmatik sets' },
  'qtx-files': { cat: 'pricing', tr: 'QTX renk dosyaları', en: 'QTX colour files' },
  'qtx-index': { cat: 'pricing', tr: 'QTX dizini', en: 'QTX index' },

  'plm-translations': { cat: 'plm', tr: 'PLM çevirileri', en: 'PLM translations' },
  'plm-style-links': { cat: 'plm', tr: 'PLM stil bağlantıları', en: 'PLM style links' },
  'plm-sample-requests': { cat: 'plm', tr: 'PLM numune talepleri', en: 'PLM sample requests' },
  'plm-main-colours': { cat: 'plm', tr: 'PLM ana renkleri', en: 'PLM main colours' },
  'plm-image-ownership': { cat: 'plm', tr: 'PLM görsel sahipliği (referans)', en: 'PLM image ownership (references)' },
  'model-image-sync-state': { cat: 'plm', tr: 'Model görsel eşitleme durumu', en: 'Model image sync state' },
  'model-image-settings': { cat: 'plm', tr: 'Model görsel ayarları', en: 'Model image settings' },
  'asas-technical-images': { cat: 'plm', tr: 'ASAS teknik görsel referansları', en: 'ASAS technical image references' },

  'user-preferences': { cat: 'users', tr: 'Kullanıcı tercihleri', en: 'User preferences' },
  'user-profiles': { cat: 'users', tr: 'Kullanıcı profilleri', en: 'User profiles' },
  'user-source-data': { cat: 'users', tr: 'Kişisel kaynak dosyaları', en: 'Personal source files' },
  'preset-share-undo': { cat: 'users', tr: 'Paylaşım geri alma kayıtları', en: 'Share undo records' },

  'agents': { cat: 'system', tr: 'Ajan tanımları', en: 'Agent definitions' },
  'agents.json.bak': { cat: 'system', tr: 'Ajan tanımları (yedek)', en: 'Agent definitions (backup)' },
  'agent-platform': { cat: 'system', tr: 'Ajan platformu ayarları', en: 'Agent platform settings' },
  'web-scripts': { cat: 'system', tr: 'Web betikleri', en: 'Web scripts' },
  'auto-backup': { cat: 'system', tr: 'Otomatik yedek ayarları', en: 'Automatic backup settings' },
  'refresh-performance': { cat: 'system', tr: 'Yenileme performans ölçümleri', en: 'Refresh performance metrics' },
  'shared-hub-bootstrap': { cat: 'system', tr: 'Shared Hub bağlantı durumu', en: 'Shared Hub connection state' },
  'config': { cat: 'system', tr: 'Uygulama yapılandırması (config.json)', en: 'Application configuration (config.json)' },
  'security': { cat: 'system', tr: 'Kullanıcılar, roller ve yetkiler', en: 'Users, roles & permissions' },
  'sync': { cat: 'system', tr: 'Sync meta verisi', en: 'Sync metadata' },
});

const SCOPE_LABELS = Object.freeze({
  serverData: { tr: 'Sunucu verisi', en: 'Server data' },
  appData: { tr: 'Uygulama verisi', en: 'App data' },
  localData: { tr: 'Yerel veri', en: 'Local data' },
  modelFiles: { tr: 'Model dosyaları', en: 'Model files' },
  collectionImages: { tr: 'Collection görselleri', en: 'Collection images' },
  qtxFiles: { tr: 'QTX dosyaları', en: 'QTX files' },
  special: { tr: 'Sistem', en: 'System' },
});

const SPECIAL_COMPONENTS = Object.freeze({
  'system/config/config.json': 'config',
  'system/security/users-roles-permissions.json': 'security',
  'system/sync/metadata.json': 'sync',
});

function catalogEntry(name) {
  const raw = String(name || '');
  if (BACKUP_COMPONENT_CATALOG[raw]) return BACKUP_COMPONENT_CATALOG[raw];
  const stem = raw.replace(/\.(?:json|jsonl|db|txt|csv|xlsx?)$/i, '');
  return BACKUP_COMPONENT_CATALOG[stem] || null;
}
function humanize(name) {
  const stem = String(name || '').replace(/\.(?:json|jsonl|db|txt|csv)$/i, '').replace(/[-_.]+/g, ' ').trim();
  return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : String(name || '');
}

/*
 * Arşiv yolunu restore bileşenine çevirir. Bileşen = veri kökü + üst seviye
 * dosya/klasör. scopes: [{ id, prefix }] (full-restore-service scopeDefinitions).
 */
function componentIdForArchivePath(archivePath, scopes) {
  const name = String(archivePath || '');
  if (SPECIAL_COMPONENTS[name]) return SPECIAL_COMPONENTS[name];
  if (name === 'system/local/BuyerLogLocal.db') return 'localData/BuyerLogLocal.db';
  const scope = (scopes || []).find(item => name.startsWith(item.prefix));
  if (!scope) return null;
  const top = name.slice(scope.prefix.length).split('/')[0];
  return top ? `${scope.id}/${top}` : null;
}
function describeComponent(id) {
  const key = String(id || '');
  if (['config', 'security', 'sync'].includes(key)) {
    const entry = BACKUP_COMPONENT_CATALOG[key];
    return { id: key, scope: 'special', top: key, category: entry.cat, labelTr: entry.tr, labelEn: entry.en, auto: false };
  }
  const slash = key.indexOf('/'), scope = slash > 0 ? key.slice(0, slash) : '', top = slash > 0 ? key.slice(slash + 1) : key;
  const assetScope = ['modelFiles', 'collectionImages'].includes(scope);
  const entry = assetScope ? null : (scope === 'qtxFiles' ? BACKUP_COMPONENT_CATALOG['qtx-files'] : catalogEntry(top));
  const scopeLabel = SCOPE_LABELS[scope] || { tr: scope, en: scope };
  if (assetScope) return { id: key, scope, top, category: 'assets', labelTr: `${scopeLabel.tr} · ${top}`, labelEn: `${scopeLabel.en} · ${top}`, auto: false };
  if (entry) return { id: key, scope, top, category: entry.cat, labelTr: entry.tr, labelEn: entry.en, auto: false };
  const label = humanize(top);
  return { id: key, scope, top, category: 'other', labelTr: label, labelEn: label, auto: true };
}
/*
 * Manifest içerik listesinden seçilebilir restore bileşenlerini üretir.
 * Her bileşen dosya sayısı ve bayt toplamıyla döner.
 */
function componentsFromManifest(manifest, scopes) {
  const groups = new Map();
  for (const item of (manifest && Array.isArray(manifest.contents) ? manifest.contents : [])) {
    const id = componentIdForArchivePath(item && item.path, scopes);
    if (!id) continue;
    const group = groups.get(id) || { ...describeComponent(id), fileCount: 0, bytes: 0, scopeLabelTr: '', scopeLabelEn: '' };
    group.fileCount += 1; group.bytes += Number(item.size) || 0;
    const scopeLabel = SCOPE_LABELS[group.scope] || { tr: group.scope, en: group.scope };
    group.scopeLabelTr = scopeLabel.tr; group.scopeLabelEn = scopeLabel.en;
    groups.set(id, group);
  }
  const order = new Map(CATEGORIES.map((item, index) => [item.id, index]));
  return [...groups.values()].sort((a, b) => (order.get(a.category) - order.get(b.category)) || a.labelTr.localeCompare(b.labelTr, 'tr'));
}

module.exports = {
  BACKUP_EXCLUDED_TOP, HEAVY_ASSET_DIRS, CACHE_DIRS, HEAVY_EXT, CATEGORIES, BACKUP_COMPONENT_CATALOG, SPECIAL_COMPONENTS,
  isHeavyBackupPath, skipBackupFile, componentIdForArchivePath, describeComponent, componentsFromManifest, catalogEntry,
};
