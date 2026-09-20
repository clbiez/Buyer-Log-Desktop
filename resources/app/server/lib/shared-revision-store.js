'use strict';

const path = require('path');
const crypto = require('crypto');
const fsp = require('fs/promises');
const { withFileLeaseAsync, replaceFileWithRetry, getBuyerLogInstanceId } = require('./shared-file-transaction');

/* ===================================================================
   PAYLAŞILAN REVİZYON DEPOSU

   BULUNAN KUSUR (Windows EPERM rename döngüsü). Bu store atomicJson() adında
   KENDİ yazma yolunu kuruyordu: geçici dosyaya yaz → fsp.rename(). Sıfır
   retry, sıfır süreçler-arası kilit. Uygulamadaki DİĞER HER JSON store'u
   (local-db.js, db.js, collection-workspaces.js, email-groups-store.js,
   quotations-store.js, sync-settings.js) withFileLeaseAsync + replaceFileWithRetry
   kullanıyor — bu store mimarideki tek istisnaydı, ve rastlantı değil, EPERM'in
   sadece burada görülmesinin sebebi de buydu.

   Windows'ta rename hedefte KISA süreli bir tutamaç varken (Defender taraması,
   arama indeksleyicisi, yedekleme ajanı) EPERM/EBUSY ile başarısız olabilir;
   bu geçicidir ve retry ile geçer — replaceFileWithRetry zaten bunun için var.
   Ayrıca bu dosya "shared-data" adını taşıyor ve config.sharedDataRoot ile
   gerçek bir ağ klasörüne de yönlendirilebilir: aynı makinede iki Buyer Log
   süreci (ör. yeniden başlatma sırasında eski süreç tam kapanmadan yenisi
   açılırsa) ya da iki farklı kullanıcı aynı dosyaya YAZIYOR OLABİLİR. Eski
   this.queue yalnız TEK SÜREÇ içi sıralama sağlıyordu; withFileLeaseAsync
   AYNI KİLİT PROTOKOLÜNÜ (mkdir tabanlı kira, ölü sahip/bayatlama kurtarma)
   kullanarak hem süreç-içi hem süreçler-arası sıralamayı TEK katmanda verir,
   bu yüzden ayrı bir queue artık gereksiz karmaşıklıktır ve kaldırıldı.

   OKU-DEĞİŞTİR-YAZ artık KİRA İÇİNDE olur (önce ayrı ayrıydı): iki yazıcı
   aynı entity'yi aynı anda revize ederse revizyon sayacının biri diğerini
   ezmeden (kayıp güncelleme olmadan) artması bu sayede garanti edilir.

   BAŞARISIZLIK DAVRANIŞI. Bu store hiçbir iş kaydının kendisini TUTMAZ —
   yalnız "şu entity şu revizyona değişti" meta verisini tutar, ve her çağıran
   onu `void store.update(...).catch(logRuntimeFailure)` ile ATEŞLE-UNUT
   çağırır (server.js). Yani bu store'un başarısız olması iş mutasyonunu asla
   geri almaz, kaybetmez ya da başarılı gibi göstermez — yalnız diğer
   istemcilerin "bir şey değişti" bildirimini bir tur geç almasına yol açar.
   =================================================================== */

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

/* Windows-güvenli atomik yazma: kendi geçici dosyası, best-effort fsync,
   sınırlı-retry rename (EPERM/EACCES/EBUSY), garanti edilen geçici dosya
   temizliği. sync-settings.js'in write()'ıyla AYNI sözleşme. */
async function atomicJson(file, value, { onTempWritten, onRetry } = {}) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const handle = await fsp.open(temporary, 'wx');
    try {
      await handle.writeFile(JSON.stringify(value), 'utf8');
      try { await handle.sync(); } catch (_) { /* bazı dosya sistemi filtreleri fsync'i reddeder; veri zaten yazıldı */ }
    } finally { await handle.close(); }
    // Başarısızlığın YAZMADAN mı yoksa RENAME'den mi geldiğini ayırt etmek
    // için: buraya kadar geldiysek geçici dosya tam ve diskte.
    if (typeof onTempWritten === 'function') { try { onTempWritten(temporary); } catch (_) {} }
    await replaceFileWithRetry(temporary, file, { onRetry });
  } finally { try { await fsp.unlink(temporary); } catch (_) {} }
}

class SharedRevisionStore {
  constructor(root, options = {}) {
    this.file = path.join(path.resolve(root), 'shared-revisions.json');
    this._onTrace = typeof options.onTrace === 'function' ? options.onTrace : null;
  }
  /* delta-store.js'teki trace() ile AYNI kalıp: force=false olan olaylar
     yalnız BUYER_LOG_DEBUG_SYNC=1 iken görünür (rutin akış); force=true olanlar
     (retry, başarısızlık) her zaman görünür — iş verisi/log İÇERİĞİ değil,
     yalnız operasyonel alanlar (pid, instanceId, entity, dosya yolu, deneme
     sayısı, süre, hata kodu) taşınır. */
  _trace(event, detail = {}, force = false) {
    const logger = this._onTrace || (force || process.env.BUYER_LOG_DEBUG_SYNC === '1' ? console.log : null);
    if (!logger) return;
    const fields = { instanceId: getBuyerLogInstanceId(), pid: process.pid, ...detail };
    try { logger(`[SHARED_REVISION] ${event} ${Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`).join(' ')}`); }
    catch (_) { /* tanılama ikinci bir hata üretmemeli */ }
  }
  read() { return readJson(this.file, { schemaVersion: 1, revision: 0, entities: {} }); }
  update(entity, metadata = {}) {
    const key = String(entity || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (!key) return Promise.reject(new Error('Revision entity is required.'));
    const startedAt = Date.now();
    let renameAttempts = 1;
    this._trace('SHARED_REVISION_WRITE_START', { entity: key, target: this.file });
    return withFileLeaseAsync(this.file, async () => {
      /* Oku-değiştir-yaz KİRA İÇİNDE: başka bir süreç ya da bu sürecin başka
         bir çağrısı aynı anda aynı dosyayı yazamaz, dolayısıyla revizyon
         sayacı kayıp güncelleme olmadan artar. */
      const current = await this.read();
      const entities = { ...(current.entities || {}) }, previous = entities[key] || {};
      entities[key] = { revision: (Number(previous.revision) || 0) + 1, updatedAt: new Date().toISOString(), ...metadata };
      const next = { schemaVersion: 1, revision: (Number(current.revision) || 0) + 1, entities };
      try {
        await atomicJson(this.file, next, {
          onTempWritten: temporary => this._trace('SHARED_REVISION_TEMP_WRITTEN', {
            entity: key, target: this.file, temp: path.basename(temporary),
          }),
          onRetry: ({ attempt, delayMs, error }) => {
            renameAttempts = attempt + 1;
            this._trace('SHARED_REVISION_RENAME_RETRY', {
              entity: key, target: this.file, attempt, delayMs, error: (error && error.code) || String(error),
            }, true);
          },
        });
      } catch (error) {
        this._trace('SHARED_REVISION_WRITE_FAILED', {
          entity: key, target: this.file, attempts: renameAttempts, durationMs: Date.now() - startedAt,
          error: (error && error.code) || (error && error.message) || String(error),
        }, true);
        throw error;
      }
      this._trace('SHARED_REVISION_WRITE_OK', { entity: key, target: this.file, attempts: renameAttempts, durationMs: Date.now() - startedAt });
      return next;
    });
  }
}

module.exports = { SharedRevisionStore };
