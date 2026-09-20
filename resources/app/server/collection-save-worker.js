'use strict';

/* ===================================================================
   v7.21 — KOLEKSİYON KAYDETME İŞ PARÇACIĞI (KALICI)

   Saha bulgusu (kullanıcı): "Aynı anda 100 kişi programda düzenlemeler
   yaptığı senaryoda eğer darboğaz olacak ve zincirleme şekilde kullanıcılar
   birbirinin güncellemelerini bekleyecekse bu çalışılmaz bir sistem olur."

   Kaydetmeyi asenkron yapmak yetmedi. 50.000 satırlık bir sayfada ana iş
   parçacığında kalan maliyetler ölçüldü:

     mevcut dosyayı oku + ayrıştır   255 ms
     yazma için JSON.stringify        84 ms
     gelen gövdeyi ayrıştır           46 ms

   Hiçbiri G/Ç değil, CPU. Asenkron dosya çağrıları bu bloğu kaldırmaz.

   Bu worker kaydetmenin TAMAMINI üstlenir: gövdeyi ayrıştırır, mevcut
   dosyayı okur, doğrular, satır farkını çıkarır, yazar. Ana iş parçacığına
   yalnız KÜÇÜK bir sonuç döner (revizyon + en fazla 500 satırlık yama).

   KALICI: her kayıt için yeni iş parçacığı açmak ölçümde kaydetme başına
   ~100 ms başlangıç maliyeti getiriyordu. 350 ms'lik yazma aralığı ve 100
   kullanıcı düşünüldüğünde bu kabul edilemez. Worker bir kez açılır ve
   görevleri mesajla alır.

   Gövde HAM BUFFER olarak geçirilir. Ayrıştırılmış nesneyi geçirmek
   structuredClone maliyetini (ölçüm: 102 ms) ana iş parçacığına geri
   getirirdi; buffer ucuz taşınır.
   =================================================================== */

const { parentPort, workerData } = require('node:worker_threads');

// Depo kökleri ana süreçten aktarılır: worker ayrı bir ortamdır ve
// kullanıcının yapılandırdığı klasörleri kendi başına çözemez. require,
// ortam değişkenleri kurulduktan SONRA yapılır — modüller kökleri yüklenme
// anında okuyor.
for (const [key, value] of Object.entries((workerData && workerData.env) || {})) {
  if (value != null && value !== '') process.env[key] = String(value);
}
const store = require('./lib/collection-workspaces');

parentPort.on('message', async task => {
  const id = task && task.id;
  try {
    const payload = JSON.parse(Buffer.from(task.body).toString('utf8'));
    // v7.22 — iki yazma biçimi: 'rows' (satır bazlı, yeni yol) ve tam sayfa
    // (eski yol). Eski yol bilerek korunuyor: Excel/PLM içe aktarma gibi
    // sayfanın tamamını değiştiren akışlar hâlâ onu kullanıyor.
    if (task.mode === 'rows') {
      const result = await store.applyRowChangesAsync(task.ownerId, payload);
      parentPort.postMessage({
        id, ok: true,
        revision: result.saved._revision,
        updatedAt: result.saved._updatedAt,
        rowCount: result.saved.rows.length,
        rowPatches: result.rowPatches,
        // rev de döner: istemci kendi yazdığı satırın yeni revizyonunu
        // bilmezse bir sonraki kaydında onu çakışmış sanardı.
        applied: result.applied.map(item => ({ id: item.id, kind: item.kind, rev: item.row ? item.row._rev : undefined })),
        // Çakışan satırlar GÜNCEL HÂLLERİYLE döner: istemci kullanıcıya hangi
        // satırın kaydedilemediğini ve sunucudaki değerini gösterebilsin.
        conflicts: result.conflicts,
        changed: result.changed,
      });
      return;
    }
    const revision = task.expectedRevision != null ? task.expectedRevision : (payload && payload.expectedRevision);
    const { saved, rowPatches } = await store.saveWorkspaceAsync(task.ownerId, payload, revision);
    // Ana iş parçacığına 18 MB geri göndermek kazandığımızı geri verirdi.
    // İstemci yanıttan yalnız revizyonu kullanıyor.
    parentPort.postMessage({
      id, ok: true,
      revision: saved._revision,
      updatedAt: saved._updatedAt,
      rowCount: saved.rows.length,
      rowPatches,
    });
  } catch (error) {
    parentPort.postMessage({
      id, ok: false,
      error: String(error && error.message || error),
      code: String(error && error.code || 'COLLECTION_SAVE_FAILED'),
      statusCode: Number(error && error.statusCode) || 500,
      currentRevision: error && error.currentRevision,
      // Atomik içe aktarma reddedildiğinde HANGİ satırların değiştiği
      // istemciye ulaşmalı; yoksa kullanıcı neyi yenileyeceğini bilemez.
      conflicts: Array.isArray(error && error.conflicts) ? error.conflicts.slice(0, 50) : undefined,
    });
  }
});
parentPort.postMessage({ ready: true });
