# SYNC'i profesyonel seviyeye taşıma — uygulama paketleri

> Bu dosya başka bir agent'a verilecek **execution packet**'leri içerir.
> Her paket tek başına yapıştırılabilir. Önerilen sıra: **P0 (her pakete
> eklenir) → P1 → P3 → P2 → P4 → P5 → P6**. Her paket ayrı bir commit serisi /
> ayrı bir PR olmalıdır.
>
> Bağlam: 10 kullanıcı, test aşaması, sunucu yok; taşıma ortamı ortak ağ
> klasörü (şu an OneDrive/SharePoint ile eşitlenen bir klasör). Uygulama
> yerel öncelikli çalışır: hiçbir Buyer Log doğrudan ortak klasörden çalışmaz;
> klasörden dosya alır, kendi yerel DB'sine işler, yerelden devam eder.

---

## P0 · Bütün paketlerde geçerli ortak kurallar (her paketin başına ekleyin)

```
ORTAK KURALLAR (her paket için geçerli)

BAŞLANGIÇ DALI
- Çalışmaya `claude/jolly-hypatia-bypupp` dalının son hâlinden başla (henüz
  main'e birleşmediyse). Bu dal SYNC kapsam daraltmasını ve Moderatör
  otoritesini içerir; bu paketler onun üzerine kuruludur.
- Önce repo kökündeki CLAUDE.md'yi bir kez oku ve uygula (TR/EN zorunluluğu
  §4.1, görsel sürüm notu §4.2, final cevap biçimi §7).

KURULUM
- `cd resources/app && npm ci --ignore-scripts` çalıştır. node_modules yoksa
  auth/workbook testleri express/xlsx eksikliğinden düşer; bu gerçek bir hata
  değildir.
- Test: hedefli `node --test tests/<dosya>.test.js`; final öncesi bir kez
  `node --test tests/*.test.js` (şu anki temel: 6308 test, 0 hata).

DEĞİŞMEZ SYNC SÖZLEŞMESİ (bunları bozma)
1. Eşler arası delta kanalı izin listesiyle çalışır:
   `server/lib/shared-sync-policy.js` → `PEER_CP_FIELDS` (dates,
   subManufacturer, suppFob, suppFobMeta) ve `PEER_DOCUMENTS`
   (store:email-groups.json). Görev açıkça istemedikçe listeyi genişletme.
   Tanınmayan kayıt `LOCAL_ONLY`'dir.
2. Çalışma kuralları (settings, overrides master alanları, fx, endeksmatik)
   yalnız Moderatörün yayımladığı Master checkpoint'ten gelir
   (`payload.authority === 'moderator'`). İlgili kod: server/server.js →
   publishMasterCheckpoint, pullModeratorMasterIfNewer,
   moderatorActiveOnThisDevice, afterSharedSyncCompleted.
3. TEK YAZAR İLKESİ: ortak klasördeki her dosyayı yalnız bir cihaz yazar.
   Yeni dosya eklerken adı yazan cihaza/kullanıcıya özgü olmalı ve dosya
   mümkünse değişmez olmalı (yeni bilgi = yeni dosya adı).
4. Paket biçimi geriye uyumludur: `firstSeq/lastSeq` anlamı değişmez; yeni
   alanlar yalnız EK alan olarak eklenir (ör. `coverFromSeq`). Eski sürüm
   alıcının `validateSyncPackage` doğrulaması bozulmamalı.
5. `server/lib/sync-settings.js` alıcı döngüsü, cihaz klasöründe
   `_head.json` dışındaki her `.json`/`.ready` dosyasını v1 paketi sanar.
   Cihaz klasörüne (`BUYER_LOG_SYNC/changes/<device>/`) YENİ DOSYA KOYMA;
   yeni meta dosyaları ayrı bir klasöre koy (ör. `BUYER_LOG_SYNC/health/`).
6. Yerel kalan olaylar journal'da yazıldıkları anda kapanır
   (`localDb.setTransportFilter`, `journalItem.localOnly`). Bu davranışı koru.

KALİTE KURALLARI
- Kullanıcıya görünen her metin aynı committe TR+EN (`appLang==='en'?…:…`,
  `tx(tr,en)` veya `data-i18n-tr/en`). i18n bekçisi
  (tests/i18n-coverage-guard.test.js) yeşil kalmalı; baseline'a kayıt ekleme.
- UI: DESIGN_SYSTEM.md token/component'leri; yeni renk/component sistemi yok.
- Saf mantığı `server/lib/` altında ayrı modüle koy ve canlı unit test yaz.
  `public/app-main.js` için mevcut kaynak-sözleşme test desenini kullan.
- Bir testi gevşetmeden önce koruduğu regresyonu oku; davranış bilerek
  değiştiyse regex'i yeni kurala göre DARALT, silme.
- `server/*.js` değişirse finalde "uygulama yeniden başlatılmalı" de.

SÜRÜM NOTU (CLAUDE.md §4.2)
- Kullanıcıya görünen her değişiklik için
  `resources/app/public/release-notes/next.json` içine ayrı kayıt ekle
  (mevcut iki SYNC kaydını SİLME, yanına ekle). Görsel: değişiklikten SONRA
  çekilmiş gerçek Buyer Log ekranı, PNG, en az 900×360, oran 1.2–3.2, demo
  veri. `npm run release:notes:validate` geçmeli.
- Ekran görüntüsü için kanıtlanmış yöntem (yalıtılmış sunucu):
  * Ortam değişkenleri: BUYER_LOG_AUTH_DATA_ROOT, BUYER_LOG_SERVER_DATA_ROOT,
    BUYER_LOG_DATA_ROOT, BUYER_LOG_LOCAL_DATA_ROOT, BUYER_LOG_CONFIG_PATH,
    BUYER_LOG_TEMP_ROOT hepsi geçici bir klasörü göstersin; config.json
    içine {"port":6299,"host":"127.0.0.1"} yaz.
  * Moderatör hesabı: tests/helpers/iam-browser.js'teki gibi
    `iam.migrateStore({... moderator:{ id:'moderator', username:'admin',
    role:'moderator', enabled:true, passwordHash, pinHash } })` ile
    auth/user-access.json yaz.
  * Ortak klasör için local/sync-settings.json'a {"sharedSyncRoot": "..."} yaz.
  * Sonra `require('<app>/server/server.js')`.
  * Tarayıcı: playwright-core + executablePath
    /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
    (tam chrome "old headless" hatası verir). `#username`/`#password`
    doldur, Enter. Açılış ekranında "Buyer Log'a devam et" düğmesine bas,
    "Yenilikler" penceresini Escape ile kapat, dil için sol menüdeki
    "Dil: TR" öğesine tıkla (anahtar: lcw.lang.v1).
  * Modal 760 px genişlikte: `deviceScaleFactor: 2` ile çek, modal
    sınırlarına kırp.
  * Sunucuyu kapatırken `pkill -f` kullanma (kendi kabuğunu da öldürür);
    süreç PID'ini kaydedip `kill <pid>` kullan.
```

---

## P1 · Yakınsama kontrolü ve SYNC sağlık paneli

```
TASK
Her cihazın paylaşılan verisinin özetini ortak klasöre yazmasını ve
Moderatörün bütün cihazların aynı veride olup olmadığını tek ekranda
görmesini sağla. Bu paket YALNIZ ÖLÇER ve GÖSTERİR; otomatik onarım yapmaz.

EXPECTED BEHAVIOR
1. Her başarılı sync sonunda cihaz,
   `<shared>/BUYER_LOG_SYNC/health/<encodeURIComponent(deviceId)>.json`
   dosyasını yazar (tek yazar: o cihaz). İçerik:
   { schemaVersion:1, deviceId, userId, displayName, appVersion,
     updatedAt, lastSyncAt, latestPublishedSeq, pendingUpload,
     openConflicts, masterRevisionApplied, sharedHash, sharedRecordCount,
     recordHashes: { "<recordId>": "<16 hex>" }, settled }
   - sharedHash: paylaşılan kapsamın kanonik özeti. Kapsam =
     `sharedSyncPolicy.businessRecordsFromState(state)` içindeki cp-order
     kayıtlarının YALNIZ PEER_CP_FIELDS değerleri + store:email-groups.json
     kaydının meta (`_` ile başlayan) ve `storeRevisionMeta` dışındaki
     alanları. `_revision`, `_fieldRevisions`, `_fieldWriters` ve zaman
     damgası gibi cihaza göre değişen meta hash'e GİRMEZ.
   - Kanonik JSON: anahtarlar sıralı (shared-hub.js içindeki `stableJson`
     benzeri), sha256.
   - recordHashes: kayıt başına aynı kanonik özetin ilk 16 hex karakteri.
   - settled: pendingUpload === 0 && openConflicts === 0 && son sync başarılı.
   - masterRevisionApplied: server.js'teki `readModeratorMasterState().revision`.
2. Yazım atomik olur (tmp + rename) ve sync'i hiçbir zaman başarısız
   saymaz: hata olursa yalnız log'a yazılır.
3. Yeni uç: `GET /api/sync-health` (yalnız Moderatör,
   `userAccess.requireModerator`). `health/` klasöründeki dosyaları okur;
   recordHashes'i yanıta koymaz, yalnız özet döner.
   Ek uç: `GET /api/sync-health/diff?deviceId=...` → o cihazın
   recordHashes'ini Moderatör cihazının kendi yerel hesabıyla karşılaştırır,
   farklı / yalnız-orada / yalnız-burada kayıt kimliklerini döner (en fazla
   200).
4. UI: mevcut Sync Durumu penceresinde (public/app-main.js →
   openSyncStatusModal, ~15104) yalnız Moderatöre görünen "Cihazlar /
   Devices" bölümü. Her satır: kullanıcı, cihaz kısa kimliği, sürüm, son
   sync (göreli zaman), bekleyen, açık çakışma, Master rev, durum rozeti:
   - "Aynı / In sync": settled ve sharedHash, settled cihazların çoğunluk
     hash'ine eşit
   - "Farklı / Diverged": settled ama hash farklı → "Ayrışan kayıtlar /
     Diverged records" bağlantısı diff ucunu açar
   - "Eşitleniyor / Syncing": settled değil
   - "Kayıp / Stale": updatedAt 24 saatten eski
   Lazy kalmalı: bölüm, pencere açılınca ve kullanıcı bölümü genişletince
   yüklenir (public/perf-runtime.js ile uyumlu).
5. Eski sürüm cihazların health dosyası olmaz; panel bunları "Eski sürüm /
   Old version" diye listeler. Liste, `changes/` altındaki cihaz klasörleri
   ve `_head.json` içindeki `installation` / `updatedAt` bilgisiyle yapılır.

CURRENT FAILURE
Cihazların gerçekten aynı veride olup olmadığını ölçen hiçbir mekanizma yok.
Ayrışma ancak bir kullanıcı fark ederse ortaya çıkıyor.

INVESTIGATION SCOPE (önce bunları doğrula, repo taraması yapma)
- server/lib/sync-settings.js → runSyncOnce sonu (final `write({...current,
  online:true ...})`), writeValidatedJson, NETWORK_HEAD_FILE, alıcı döngüsü
  (v1Names filtresi; health dosyasını cihaz klasörüne KOYMA).
- server/lib/shared-sync-policy.js → businessRecordsFromState, PEER_CP_FIELDS,
  PEER_DOCUMENTS.
- server/server.js → syncSettings.onStateChange,
  afterSharedSyncCompleted, readModeratorMasterState, /api/sync-status
  (~9096), requireModerator kullanımı.
- public/app-main.js → openSyncStatusModal ve çakışma paneli (~15104–15140).

IMPLEMENTATION RULES
- Hash ve özet mantığı yeni saf modülde: server/lib/sync-health.js
  (computeSharedDigest(state), buildHealthReport(...), compareReports(...)).
  Disk/ağ I/O server.js veya sync-settings tarafında kalır.
- Yazımı sync-settings içine gömme; createSyncSettings'e opsiyonel
  `onSyncCompleted(result)` kancası ekle veya server.js'teki onStateChange
  akışına bağla. Ağ zaman aşımı mevcut `net()` / 15 sn deseniyle olsun.
- Health dosyası en fazla 1 MB; recordHashes 20.000 kaydı geçerse yalnız
  sharedHash yazılsın, diff ucu "ayrıntı yok" desin.
- `data-cleanup.js` sync temizliği `health/` klasörünü silmemeli; 90 günden
  eski health dosyaları yalnız Moderatör temizliğinde silinebilir.

VALIDATION
- Yeni test: tests/sync-health-v<YYYYMMDD>.test.js
  * Meta alanları farklı ama değerleri aynı iki state → aynı sharedHash.
  * Bir PEER_CP_FIELDS değeri farklı → farklı hash; diff yalnız o kaydı döner.
  * CP notes alanı farklı → hash DEĞİŞMEZ (yerel alan).
  * İki cihaz + ortak tmp klasörü (tests/sync-scope-moderator-authority-
    v20261009.test.js içindeki `device()` deseni): sync sonrası iki health
    dosyası var, sharedHash eşit, settled true.
  * health dosyası varken alıcı döngüsü corruptPackages üretmez.
  * Kaynak-sözleşme: /api/sync-health requireModerator ile korunur.
- i18n bekçisi ve release-notes doğrulaması yeşil.

DONE WHEN
- Moderatör, Sync Durumu penceresinde 10 cihazın durumunu ve ayrışan
  kayıtları görebiliyor; normal kullanıcı bu bölümü görmüyor.
- Testler + tam paket yeşil; next.json'a TR/EN kayıt ve gerçek ekran
  görüntüsü eklendi.
```

---

## P2 · Alan sahipliği: paylaşılan CP alanını yalnız sipariş sahibi yazar

```
TASK
Paylaşılan CP alanlarının (PEER_CP_FIELDS) tek yazarı siparişin sahibi
olsun. Böylece kullanıcılar arası çakışma yapısal olarak oluşmasın ve
"Keep mine / Accept incoming" sorusu bu alanlar için ortadan kalksın.

EXPECTED BEHAVIOR
1. Yazım tarafı: Sahibi olmayan kullanıcı Ex-Factory revizesi,
   Sub-Manufacturer, Supp. FOB alanlarını değiştiremez. Hücre salt okunur
   görünür; tooltip TR/EN: "Bu alanı siparişin sahibi değiştirebilir:
   {0}" / "Only the order owner can change this field: {0}". Sunucu da
   aynı kuralı uygular (403, kod ORDER_FIELD_OWNER_ONLY, TR/EN mesaj).
   Önce mevcut kontrolü doğrula: user-access.js → canEditOrder ve
   ORDER_VIEW_ONLY yolu bunu zaten yapıyor olabilir. Yapıyorsa yalnız
   eksik alanları tamamla, ikinci bir yetki sistemi YAZMA.
2. Alım tarafı: Gelen cp-order paketindeki PEER_CP_FIELDS yaması, olayı
   yazan kullanıcı (`delta.userId`) o siparişin sahibi değilse UYGULANMAZ
   ve sessizce düşmez: `SYNC_FOREIGN_OWNER_PATCH_DROPPED` iz olayı ve P1
   health raporunda sayaç olarak görünür.
   - Sahiplik kaynağı: Moderatörün türettiği sipariş sahipliği haritası
     (server/lib/order-authority-share.js → orderAccess; yerel doğrulanmış
     kopya). Haritanın anahtarı sipariş kodu; cp-order kayıt kimliği sipariş
     satırı kimliğidir. Eşlemeyi gerçek koddan doğrula
     (cp-shared-store.js, overrides anahtarları).
   - Sahiplik bilinmiyorsa (harita yok, sipariş haritada yok, userId yok,
     eski sürüm olayı) mevcut davranış korunur: yama uygulanır.
   - Moderatör (systemRole moderator) her siparişe yazabilir.
3. Aynı sahibin iki cihazından gelen eşzamanlı yazımlar çakışma
   üretmez: alan bazında son yazan kazanır. Sıralama ölçütü P5 gelene kadar
   olayın `at` zaman damgası + eşitlikte deviceId'dir; iki cihazda aynı
   sonucu vermesi zorunludur.
4. Bu kurallar devreye girince cp-order PEER_CP_FIELDS alanlarında açık
   kalmış çakışmalar, mevcut retireOutOfScopeSyncConflicts deseniyle
   "owner-rule" çözümüyle kapanır ve sahibin değeri kalır.

CURRENT FAILURE
İki kullanıcı aynı siparişin aynı alanını değiştirebiliyor; sonuç
kullanıcıya çakışma olarak soruluyor.

INVESTIGATION SCOPE
- server/lib/cp-shared-store.js (FIELDS, patchFromOrderPatch, mirrorPatch:
  userId = actorIdOf(actor)).
- server/lib/order-authority-share.js ve onu kullanan server.js /
  user-access.js yolları (canEditOrder, ORDER_VIEW_ONLY, orderAccess).
- server/lib/local-db.js → applyRemoteDelta / fieldMerge (alım tarafında
  sahiplik süzgecinin nereye konacağı). Tercih: süzgeç local-db'ye değil,
  server.js'teki sharedHubDeltaFilter('incoming') zincirine; sahiplik
  haritası okuyucusu enjekte edilir.
- server/lib/sync-settings.js → filterIncomingDeltas çağrısı.

IMPLEMENTATION RULES
- Sahiplik kararı saf fonksiyon: server/lib/cp-field-ownership.js
  (isOwnerWrite({ recordId, userId, systemRole }, orderAccess)).
- Gelen süzgeç yalnız PEER_CP_FIELDS alanlarını düşürür; aynı olaydaki
  başka izinli alan yoksa olay boş kalır, paket yine "uygulandı" sayılır
  (sıra makbuzu bozulmamalı).
- Yerel yazım tarafında yeni bir yetki sistemi kurma; mevcut canEditOrder
  akışını kullan/genişlet.

VALIDATION
- Unit: sahip / sahip değil / moderatör / harita yok / userId yok.
- İki cihaz testi: A sahibi, B değil. B'nin (sunucu kontrolü atlatılmış
  eski sürüm gibi) yazdığı suppFob yaması A'da uygulanmaz; A'nın yaması
  B'de uygulanır; açık çakışma 0.
- Aynı kullanıcının iki cihazı eşzamanlı yazar → iki cihazda aynı değer,
  çakışma 0.
- UI kaynak-sözleşme testi: salt okunur hücre ve TR/EN tooltip.

DONE WHEN
- PEER_CP_FIELDS için kullanıcılar arası çakışma üretilemiyor; ilgili
  testler ve tam paket yeşil; next.json kaydı ve ekran görüntüsü eklendi.
```

---

## P3 · 10 cihazlık SYNC simülasyon testi (OneDrive davranışıyla)

```
TASK
SYNC protokolünü 10 sanal cihaz ve OneDrive benzeri gecikmeli/karışık
dosya taşımayla test eden, tekrarlanabilir (tohumlu) bir simülasyon
düzeneği kur. Sonraki her SYNC değişikliği bu düzenekle güvenceye alınacak.

EXPECTED BEHAVIOR
1. Yardımcı: tests/helpers/sync-sim.js
   - N cihaz: her biri kendi createLocalDb + createSyncSettings örneği;
     server.js ile AYNI süzgeçler (sharedSyncPolicy.filterDeltas +
     filterCollectionWorkspaceDeltas) ve `db.setTransportFilter`.
   - Her cihazın KENDİ ortak klasör aynası var (OneDrive'ın yerel kopyası
     gibi). Bir "replicator" aynalar arasında dosya kopyalar:
     * tohumlu PRNG ile gecikme ve sıra karıştırma (dosya B, dosya A'dan
       önce görünebilir; head dosyası paketten önce gelebilir);
     * yinelenen teslim (aynı dosya iki kez);
     * aynı dosya adı iki kaynakta farklıysa OneDrive gibi çakışma kopyası:
       `ad-PCADI.json` (orijinal adı ezmez);
     * kopyalama sırasında yarım dosya (önce .tmp, sonra rename; bir
       senaryoda bozuk/yarım içerik).
   - İşlem üreticisi: tohumlu rastgele kullanıcı işlemleri: cp-order
     PEER_CP_FIELDS yazımı, yerel alan (notes) yazımı, settings yazımı,
     e-posta rehberi kaydı ekleme/silme.
2. Testler: tests/sync-simulation-v<YYYYMMDD>.test.js
   - Kısa senaryo (CI'da çalışır, < 15 sn): 10 cihaz, 300 işlem, 3 tohum.
   - Uzun senaryo yalnız `BUYERLOG_SYNC_SOAK=1` ile: 10 cihaz, 20.000 işlem.
3. Değişmezler (her senaryonun sonunda; "durulma" = bütün dosyalar
   kopyalandı + her cihaz iki kez sync oldu):
   a. Yakınsama: bütün cihazların paylaşılan kapsam özeti eşit (P1 bittiyse
      sync-health'in computeSharedDigest'ini kullan; bitmediyse testte
      aynı kanonik özeti hesapla).
   b. Kayıp yok: her (kayıt, alan) için durulmadan sonraki değer, o alana
      yazılmış son değerdir (P2 öncesi: yazanların gerçekten eşzamanlı
      olmadığı durumlar için).
   c. Sahte çakışma yok: yalnız gerçekten eşzamanlı aynı alan yazımları
      çakışma üretir; ayrı alan / ayrı kayıt yazımları asla.
   d. Sızıntı yok: notes, settings ve kişisel dosyalar hiçbir başka cihazda
      görünmez.
   e. Verim: durulmadan sonra ek bir sync turu 0 paket indirir ve her alıcının
      checkpoint'i her kaynağın head.latestSequence değerine eşittir.
   f. Çakışma kopyası ya da yarım dosya hiçbir cihazı durdurmaz
      (online:true kalır, corruptPackages sayılabilir ama veri kaybı olmaz).
4. Başarısız tohum, tekrar üretmek için tohum ve işlem günlüğüyle raporlanır.

CURRENT FAILURE
SYNC yalnız 2 cihazlı birim testlerle doğrulanıyor; gecikme, sıra bozulması
ve çakışma kopyası senaryoları hiç test edilmiyor.

INVESTIGATION SCOPE
- tests/sync-scope-moderator-authority-v20261009.test.js (`device()` deseni).
- tests/sync-multidevice.test.js, sync-bundle-mixed-version.test.js,
  sync-bundle-corruption.test.js (mevcut desenler; tekrar yazma).
- server/lib/sync-settings.js (dosya adları, head, ACK yolları).

IMPLEMENTATION RULES
- Üretim koduna simülasyon için kanca EKLEME. Gerekiyorsa yalnız zaman
  kaynağı (Date.now) enjeksiyonu kabul edilebilir; varsayılan davranış
  değişmez.
- Simülasyon bir değişmezi ihlal ederse bulunan hatayı bu pakette DÜZELTME;
  testi `test.todo` / ayrı failing test olarak ekle, hatayı final raporunda
  dosya:satır ve tohum ile yaz. (Düzeltme ayrı paket olur.) İstisna: hata
  tek satırlık ve açıksa düzelt, ayrıca belirt.

VALIDATION
- Kısa senaryo CI'da 3 kez art arda yeşil (flake yok).
- Uzun senaryo bir kez yerelde çalıştırıldı, sonucu raporlandı.

DONE WHEN
- Düzenek ve testler commit'li; bulunan protokol hataları listesi finalde.
- Kullanıcıya görünen değişiklik yoksa sürüm notu GEREKMEZ (finalde belirt).
```

---

## P4 · Tek yazar denetimi ve ACK sadeleştirmesi

```
TASK
Ortak klasöre yazılan her dosyanın tek yazarı olduğunu garanti et ve
paket başına ACK dosyalarını kaldır.

EXPECTED BEHAVIOR
1. Yazar envanteri: docs/ai/SHARED_FOLDER_WRITERS.md. Ortak kök altına
   yazılan her yol için: yol deseni, yazan (cihaz / Moderatör / kullanıcı
   yöneticisi), yazan kod (dosya:fonksiyon), değişmez mi / üzerine mi
   yazılıyor, kilit (withFileLeaseAsync) var mı. En az şunlar denetlenir:
   BUYER_LOG_SYNC/changes, BUYER_LOG_SYNC/acks, master/ ve business/
   checkpoint'leri (shared-hub.js), iam/ (central-iam.js,
   order-authority-share.js), collection-workspaces (collection-
   replication.js), collection-permissions-store.js, shared-image-store.js /
   model-image-distribution.js, shared-revision-store.js,
   shared-personal-backup.js, system-backups/.
2. Birden çok yazarı olan her dosya için düzeltme önerisi; küçük ve güvenli
   olanları uygula, büyük olanları raporla. Bilinen örnek: business
   checkpoint'i şu an Moderatör dışındaki cihaz da 12 saatte bir
   yayımlayabiliyor (server.js → scheduleBusinessCheckpointPublish,
   BUSINESS_CHECKPOINT_PEER_INTERVAL_MS). Bunu YALNIZ Moderatör yayımlayacak
   şekilde değiştir; Moderatör yoksa checkpoint eskir, veri kaybı olmaz
   (deltalar saklama süresi boyunca durur). Finalde bu sınırlamayı belirt.
3. ACK sadeleştirmesi (server/lib/sync-settings.js):
   - Alıcı artık paket başına ACK
     (`acks/<src>/packages/<pkgId>/<reader>.json`) YAZMAZ; yalnız
     cihaz-çifti checkpoint ACK'i (`acks/<src>/<reader>.json`,
     lastContiguousSequence) yazar ve bunu sync turu başına kaynak başına
     EN FAZLA BİR KEZ yazar (şu an paket başına yazılıyor).
   - v1 olay başına ACK yazımı yalnız legacy uyumluluk modunda kalır.
   - acknowledgeLocalUploads eski paket ACK'lerini OKUMAYA devam eder (eski
     sürüm eşler); prunePackages eski ACK klasörlerini silmeye devam eder.
4. OneDrive notu: docs/YENI_KULLANICI_KURULUMU.md'ye TR+EN kısa bölüm:
   sync klasörünü "Her zaman bu cihazda tut / Always keep on this device"
   yapın; mümkünse SMB ağ paylaşımı tercih edin.

CURRENT FAILURE
Her okuyucu her paket için ayrı ACK dosyası yazıyor (N okuyucu × paket
sayısı kadar küçük dosya); bazı ortak dosyaların birden çok yazarı var.
OneDrive'da aynı dosyanın birden çok yazarı çakışma kopyası üretir.

INVESTIGATION SCOPE
- server/lib/sync-settings.js: alıcı döngüsündeki iki writeValidatedJson
  ACK çağrısı, acknowledgeLocalUploads, prunePackages.
- tests/sync-checkpoint-ack.test.js, sync-network-file-count.test.js,
  sync-bundle-idempotency.test.js (ACK sözleşmesini koruyan testler; önce
  gerekçelerini oku).

IMPLEMENTATION RULES
- Gönderen tarafın pendingAck / markAcknowledgedThrough hesabı checkpoint
  ACK'iyle aynı kalmalı.
- P3 simülasyon düzeneği varsa bu paketin sonunda yeşil olmalı.

VALIDATION
- Bir sync turunda, 3 paket gönderen bir kaynak için alıcı en fazla 1 ACK
  dosyası yazar (dosya sayısı testi).
- Eski sürüm eşin paket ACK'i hâlâ okunur (karışık sürüm testi).
- Tam paket yeşil.

DONE WHEN
- Yazar envanteri commit'li; ACK dosya sayısı turda kaynak başına ≤ 1;
  testler yeşil. Görünür değişiklik yoksa sürüm notu gerekmez.
```

---

## P5 · Hibrit mantıksal saat (HLC) ile deterministik sıralama

```
TASK
Journal olaylarına Hybrid Logical Clock damgası ekle ve "son yazan kazanır"
kararlarında cihaz saatine/sayacına değil HLC'ye dayan. (P3 düzeneği hazır
olmadan başlama.)

EXPECTED BEHAVIOR
1. Saf modül server/lib/hlc.js: { wallMs, counter, node } biçimi; tick(),
   receive(remote), compare(a,b), serialize/parse (sıralanabilir metin).
   Yerel saat geri giderse monotonluk korunur; uzak damga yerel saatten çok
   ilerideyse (ör. > 5 dk) kabul edilir ama iz olayı yazılır.
2. local-db applyLocalPatch / applyLocalTombstone journal öğesine `hlc`
   ekler; applyRemoteDelta gelen hlc ile yerel saati ilerletir. HLC durumu
   state'te saklanır ve WAL oynatımında deterministik kalır (damga çağrı
   anında üretilip payload'a yazılır, oynatmada yeniden üretilmez — mevcut
   eventId/at deseniyle aynı).
3. P2'deki "aynı sahibin iki cihazı" ve e-posta rehberi gibi LWW
   kararlarında karşılaştırma HLC ile yapılır; hlc yoksa (eski olay) `at` +
   deviceId geri dönüşü kullanılır.
4. Nedensel çakışma algılaması (_fieldWriters + seen sürüm vektörü)
   DEĞİŞMEZ; HLC yalnız eşzamanlı olayların deterministik sıralanmasında
   kullanılır.

CURRENT FAILURE
Eşzamanlı yazımların sırası cihaz saatine ve cihaz başına sayaçlara bağlı;
saat kayması yanlış "son yazan" seçtirebilir.

INVESTIGATION SCOPE
- server/lib/local-db.js: applyLocalPatch, applyRemoteDelta, fieldMerge,
  resolvePatch, replayWal.
- server/lib/sync-package.js: coalescePendingEvents (birleşen olayda hlc =
  en büyük olanı).

IMPLEMENTATION RULES
- Paket ve journal biçimine yalnız EK alan; eski alıcı/okuyucu bozulmaz.
- WAL oynatımı aynı sonucu vermeli (mevcut local-db-wal testleri yeşil).

VALIDATION
- hlc unit testleri: monotonluk, saat geri gitmesi, alma, sıralama.
- P3 simülasyonuna saat kayması (cihaz başına ±10 dk) eklenir ve
  yakınsama değişmezi yeşil kalır.

DONE WHEN
- HLC journal'da ve paketlerde taşınıyor; LWW kararları HLC'ye dayanıyor;
  testler ve simülasyon yeşil. Görünür değişiklik yoksa sürüm notu gerekmez.
```

---

## P6 · Moderatör kural yayımlarının sürümlenmesi

```
TASK
Moderatörün çalışma kuralı yayımlarını numaralı, açıklamalı ve geri
alınabilir sürümler hâline getir; kullanıcılar hangi kural sürümünde
olduklarını görsün.

EXPECTED BEHAVIOR
1. Master checkpoint payload'ına `release` alanı eklenir:
   { version (= checkpoint revision), note, publishedBy, publishedAt,
     changedEntities: [...] } (changedEntities: server.js →
   changedMasterEntities ile önceki yayımla karşılaştırarak).
   Otomatik yayımlarda note boş olabilir.
2. Sürüm arşivi: shared-hub.js checkpoint klasöründe yalnız son 3 dosya
   tutuluyor (cleanupCheckpointFiles → names.slice(3)). Kural geçmişi için
   ayrı `master/releases/<revision>.json.gz` arşivi; son 30 sürüm. Yazanı
   yalnız Moderatör.
3. Moderatör UI (Veri Yönetimi veya Sync Durumu içinde, yalnız
   Moderatöre): sürüm listesi (no, tarih, yayımlayan, not, değişen
   alanlar), "Not ekleyerek yayımla / Publish with note" ve "Bu sürüme
   dön / Restore this version". Geri dönüş eski payload'ı YENİ bir
   revizyon olarak yayımlar (geçmiş silinmez) ve onay ister (TR/EN
   confirm).
4. Kullanıcı UI: Sync Durumu penceresinde "Kurallar v{0} · {1} · {2}" /
   "Rules v{0} · {1} · {2}" (sürüm, yayımlayan, zaman).
   pullModeratorMasterIfNewer yeni sürüm uyguladığında bir kez bilgi
   bildirimi: "Moderatör kuralları güncelledi (v{0})" / "The Moderator
   updated the rules (v{0})".

CURRENT FAILURE
Kural yayımları numarasız ve açıklamasız; hatalı bir yayımı geri almanın
yolu yok; kullanıcı hangi kural sürümünde olduğunu bilmiyor.

INVESTIGATION SCOPE
- server/server.js: publishMasterCheckpoint, pullModeratorMasterIfNewer,
  changedMasterEntities, /api/shared-hub/publish-master.
- server/lib/shared-hub.js: publishCheckpoint, cleanupCheckpointFiles,
  readCheckpoint.
- public/app-main.js: openSyncStatusModal.

IMPLEMENTATION RULES
- `authority:'moderator'` ve masterCheckpointHasModeratorAuthority
  sözleşmesi korunur; geri dönüş yayımı da authority taşır.
- payloadSha256 içerik eşitliği kontrolü: yalnız `release.note`/zaman
  farkı yüzünden boş yere yeni revizyon üretilmemeli (otomatik yayımlarda
  release alanını eşitlik hesabının dışında tut ya da içerik değişmediyse
  yayımlama).

VALIDATION
- Unit/entegrasyon: yayım → sürüm arşivde; geri dönüş yeni revizyon üretir
  ve kullanıcı cihazında pull eski değerleri uygular; açık çakışma 0.
- UI kaynak-sözleşme testi + i18n bekçisi + release-notes doğrulaması.

DONE WHEN
- Moderatör sürüm listesini görüp geri dönebiliyor; kullanıcılar kural
  sürümünü görüyor; next.json kaydı ve gerçek ekran görüntüleri eklendi.
```
