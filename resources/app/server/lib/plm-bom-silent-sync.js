'use strict';

/* CP / Orders sessiz arka plan PLM BOM tazelemesi.
 *
 * AMAÇ. CP ve Orders'ta elle düzenlenemeyen `Artwork Detail` ve `Fabric (PLM)`
 * (public/cp-plm-details.js, plm-bom.json kaydından türetir) kullanıcıya
 * hissettirmeden güncel kalır. Koleksiyon satırlarına hiçbir şey yazılmaz;
 * model dosyası, görsel ve QTX bu işin kapsamı değildir.
 *
 * ESKİ MİMARİ KURULMAZ. Render/modül açılışı tetiklemez; her açılışta tekrar
 * etmez; eşzamanlılık düşüktür:
 *   - Tetikleyici yalnız istemcideki zamanlayıcıdır (public/cp-plm-silent-bom.js):
 *     açılıştan birkaç dakika sonra, uygulama boştayken, küçük partilerle.
 *   - Bu modül model başına GÜNDE EN FAZLA BİR okuma kaydı tutar (scan ledger).
 *     Yarıda kalan tur, ertesi denemede yalnız okunmamış modellerle sürer.
 *   - Parti başına bir Style List çağrısı (kumaş/ürün tipi/styleId) + model
 *     başına bir BOM çağrısı, en fazla SILENT_FETCH_CONCURRENCY eşzamanlı.
 *   - LCW AI KULLANILMAZ (allowAi:false); AI gerektiren özetler "deferred"
 *     kalır ve kullanıcının sonraki elle senkronunda tamamlanır.
 *   - Önce kullanıcı (lib/plm-priority): kullanıcı işi sürerken parti
 *     PLM_BACKGROUND_DEFERRED ile ertelenir; kullanıcı işi başlayınca sessiz
 *     iş iptal edilir ve okunmayan modeller işaretlenmez.
 *   - Token yoksa iş başlamaz; oturum düşerse beklemeden durur. Asla
 *     etkileşimli giriş açılmaz.
 *   - Sessiz iş kaydı bitince iş geçmişinden kaldırılır (Operasyon Merkezi'ni
 *     ve kullanıcının iş geçmişini doldurmaz).
 *
 * ÇOK KULLANICI. plm-bom.json kurulum başına yereldir (SERVER_DATA_ROOT);
 * ortak klasör senkronuna/Shared Hub'a girmez. Her kurulum kendi CP/Orders
 * modellerini günde en fazla bir kez okur.
 */
const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteBuffer } = require('../user-data');

const SILENT_BATCH_MAX = 100;           // tek Style List çağrısı
const SILENT_FETCH_CONCURRENCY = 2;     // BOM okuma eşzamanlılığı (normal: 5)
const MAX_LEDGER_IDS = 100000;
const DEFAULT_FILE = path.join(SERVER_DATA_ROOT, 'plm-bom-silent-scan.json');
const AUTH_CODES = new Set(['CORENECTUM_API_TOKEN_INVALID', 'CORENECTUM_API_TOKEN_REQUIRED']);

function cleanId(value) {
  let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  text = text.replace(/^0+(?=\d)/, '');
  return /^\d{1,20}$/.test(text) && Number(text) > 0 ? text : '';
}
function uniqueIds(values) {
  const out = [], seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = cleanId(value);
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}
function localDay(ms) {
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function userKey(userId) { return String(userId || 'moderator').slice(0, 160); }

/* Kullanıcı başına "bugün okunan modeller" kaydı. Yalnız bugünün günü tutulur;
   gün değişince kayıt kendiliğinden boşalır. Dosya bozuksa boş sayılır (en
   kötü durumda modeller bugün bir kez daha okunur; veri kaybı yoktur). */
function createSilentScanLedger({ file = DEFAULT_FILE, now = () => Date.now() } = {}) {
  let cache = null;
  function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object' ? { users: raw.users } : { users: {} };
    } catch (_) { cache = { users: {} }; }
    return cache;
  }
  function today() { return localDay(now()); }
  function scannedSet(userId) {
    const entry = load().users[userKey(userId)];
    return entry && entry.day === today() && Array.isArray(entry.scanned) ? new Set(entry.scanned) : new Set();
  }
  function due(userId, ids) {
    const scanned = scannedSet(userId);
    return uniqueIds(ids).filter(id => !scanned.has(id));
  }
  function markScanned(userId, ids) {
    const add = uniqueIds(ids);
    if (!add.length) return;
    const scanned = scannedSet(userId);
    for (const id of add) scanned.add(id);
    const day = today();
    const users = {};
    // Yalnız bugünün kayıtları taşınır; eski günler dosyada birikmez.
    for (const [key, entry] of Object.entries(load().users)) if (entry && entry.day === day) users[key] = entry;
    users[userKey(userId)] = { day, scanned: [...scanned].slice(-MAX_LEDGER_IDS), updatedAt: new Date(now()).toISOString() };
    const next = { users };
    atomicWriteBuffer(file, Buffer.from(JSON.stringify(next), 'utf8'));
    cache = next;
  }
  return { file, today, due, markScanned };
}

function statusFromError(error) {
  const code = String(error && error.code || '');
  if (code === 'PLM_BACKGROUND_DEFERRED') return 'deferred';
  if (code === 'PLM_JOB_CANCELLED') return 'cancelled';
  if (AUTH_CODES.has(code)) return 'auth';
  return 'error';
}

function createSilentBomService({ ledger, withPlmJob, plmJobs, tokenReady, collectStyleLinks, syncPlmBoms } = {}) {
  function plan(profile, plmIds) {
    const ids = uniqueIds(plmIds);
    const due = ledger.due(profile.id, ids);
    return { ok: true, day: ledger.today(), total: ids.length, due, completedToday: due.length === 0 };
  }

  async function run(profile, plmIds, { request } = {}) {
    const ids = ledger.due(profile.id, plmIds).slice(0, SILENT_BATCH_MAX);
    const base = { ok: true, processed: 0, changedIds: [], revision: null };
    if (!ids.length) return { ...base, status: 'done' };
    // Token yoksa (bağlı değil / süresi dolmuş / reddedilmiş) iş hiç başlamaz.
    if (!tokenReady(profile.id)) return { ...base, status: 'no-token' };

    let jobId = '';
    let outcome;
    try {
      const run = await withPlmJob(request || { currentUser: profile }, {
        background: true,
        kind: 'plm-bom', scope: 'cp', total: ids.length,
        label: `PLM BOM · ${ids.length} model`,
        phase: 'PLM BOM',
      }, async job => {
        jobId = job.id;
        // Sessiz iş ilerleme/oturum bekleme fazı yazmaz: onProgress ve waitForAuth verilmez.
        const collected = await collectStyleLinks(profile.id, ids.map(plmId => ({ plmId, needImage: false })), { isCancelled: job.cancelled });
        const links = Array.isArray(collected && collected.links) ? collected.links : [];
        if (job.cancelled()) return { stopped: 'cancelled', skippedIds: ids, changedIds: [] };
        const result = await syncPlmBoms(links, {
          ownerId: profile.id,
          allowAi: false,
          fetchConcurrency: SILENT_FETCH_CONCURRENCY,
          isCancelled: job.cancelled,
        });
        return result;
      });
      jobId = jobId || (run && run.job && run.job.id) || '';
      outcome = run && run.result || {};
    } catch (error) {
      const status = statusFromError(error);
      jobId = jobId || (error && error.plmJobId) || '';
      if (jobId && plmJobs && typeof plmJobs.remove === 'function') plmJobs.remove(profile.id, jobId);
      // Ertelenen/iptal edilen/yetkisi düşen partide hiçbir model işaretlenmez.
      if (status === 'error') return { ...base, ok: false, status, code: String(error && error.code || 'PLM_SILENT_BOM_FAILED').slice(0, 80) };
      return { ...base, status };
    }
    if (jobId && plmJobs && typeof plmJobs.remove === 'function') plmJobs.remove(profile.id, jobId);

    const stopped = outcome.stopped || null;
    const skipped = new Set(uniqueIds(outcome.skippedIds));
    // Yetki bitişinde atlananlar failed listesinde yetki koduyla da raporlanır: onlar da işaretlenmez.
    for (const item of Array.isArray(outcome.failed) ? outcome.failed : []) {
      if (AUTH_CODES.has(String(item && item.code || ''))) skipped.add(cleanId(item && item.plmId));
    }
    // Style List'te bulunamayan ve BOM'u kalıcı hatalı olanlar bugün yeniden zorlanmaz.
    const processed = ids.filter(id => !skipped.has(id));
    ledger.markScanned(profile.id, processed);
    return {
      ...base,
      status: stopped === 'auth' ? 'auth' : stopped === 'cancelled' ? 'cancelled' : 'done',
      processed: processed.length,
      changedIds: uniqueIds(outcome.changedIds),
      revision: Number.isFinite(Number(outcome.revision)) ? Number(outcome.revision) : null,
    };
  }

  return { plan, run };
}

module.exports = {
  SILENT_BATCH_MAX,
  SILENT_FETCH_CONCURRENCY,
  DEFAULT_FILE,
  localDay,
  createSilentScanLedger,
  createSilentBomService,
};
