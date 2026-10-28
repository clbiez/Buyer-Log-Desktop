# Tek renderer, arka plan ön yükleme ve CP ilk çizimi — 28.10.2026

7.0.314'te açılışa eklenen gizli Koleksiyon/CP/Orders native sekmeleri kaldırıldı. Her sekme uygulamanın tamamını (118 senkron betik, ~6 MB JS) ve verisini yeniden yüklüyordu; 27.10 ölçümünde üç sekme **3 dk 55 sn** sürmüş ve Electron RSS toplamına **~1,51 GiB** eklemişti. Yerine Genel Bakış göründükten sonra aynı renderer'da, tarayıcı boştayken sırayla CP (veri + ortak öncelikler) → Orders → Koleksiyon kataloğu yüklenir.

**[Doğrulandı] Aynı sekmede modül geçişi** (30.000 sentetik sipariş, 24.982 CP satırı; Genel Bakış açıldıktan ve arka plan yüklemesi bittikten sonra `switchTab` → ilk veri satırı + iki çizim karesi, sayfa içinde ölçüldü). Önceki kodda karşılaştırma için aynı sürede (45 sn) beklenip geçildi.

| Geçiş | Önce (3 koşu) | Sonra (son kaynak, 3 koşu) |
| --- | ---: | ---: |
| Genel Bakış → CP | 25,0 / 9,4 / 8,1 sn | 7,9 / 3,8 / 8,8 sn |
| CP → Orders | 19,5 / 20,8 / 16,9 sn | 2,6 / 2,2 / 1,9 sn |

Ham çıktı: [same-tab-switch-runs.txt](startup-2026-10-28/same-tab-switch-runs.txt). Ortam Linux, 4 vCPU, headless Chromium; Windows soğuk disk/antivirüs ve Electron kabuğu dahil değildir. Varyans yüksektir; tek koşu garanti değildir.

**[Doğrulandı] CP ilk çizim profili:** `checklist-supplier-sync.js › refreshColumns`, her satır × checklist kalemi için set/parça kimliğini 4–6 kez yeniden hesaplıyordu (`canonical-fields.value` 5,3 sn öz süre; çizimin 8,9 sn'sinin 7,7 sn'si). Satır başına bir kez hesaplanınca refreshColumns ~1,3 sn'ye indi. 400 rastgele satırlık eşdeğerlik denemesinde (set, parça, bileşen ve opsiyon cevapları) çıktı bayt bayt aynıydı.

**[Doğrulandı] Kalan CP değişkenliği sunucu tarafındadır:** ön yükleme sırasında backend olay döngüsü 4,9–11,8 sn kilitlendi (`runtime-pressure-monitor` stall profili: `sendDateSafeJson` /api/data/cp ve /api/data/orders, GC, `order-importance fold`, `writeJsonGzip`). Bu sırada `/api/views` 4,8 sn bekledi ve CP ilk çizimi kullanıcı profilini beklediği için gecikti. **[Muhtemel]** Hazır projeksiyon (`/api/page-projection/*`) arka plan senkronundan sonra çalışma zamanı revizyonuyla eşleşmeyince `/api/data/*` yeniden üretim yoluna düşülüyor; ayrı doğrulanmalıdır.

**[Doğrulandı] Statik dosya katmanı:** açılış 155 sıkıştırılabilir dosya isterken gzip LRU 48 kayıttı; sıralı taramada her renderer açılışı/yenilemesi hepsini yeniden okuyup sıkıştırıyordu (bu makinede ~240 ms/açılış) ve 304 yanıtı için bile gövde üretiyordu. Kapasite 256'ya çıkarıldı, 304 dosya meta verisinden verilir.

Tekrarlama (`resources/app` içinden):

```sh
node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/startup.json
```

Doğrulama: tam depo test paketi 7.956 test geçti, 0 başarısız (65 mevcut skip). `release:notes:validate` 2 kaydı doğruladı; i18n bekçisi 0 eksik.

## İkinci tur (7.0.318): sunucu, önbellek ve donanım uyumu

**[Doğrulandı] Kök neden — hazır sayfa önbelleği hiç isabet etmiyordu.** Backlog uçları (`/api/backlog-source-columns`, `/api/backlog-export`) bellekte veri yokken model anlık görüntüsü yerine `loadFromDisk` ile Excel'i yeniden ayrıştırıyordu. Aynı içerik yeni bir `loadedAt` ile yükleniyor, sonra yazılan önbellek nesli anlık görüntüyle eşleşmiyor ve her yeniden açılışta CP/Siparişler/Genel Bakış `/api/data/*` yolunda sunucuda yeniden üretilip serileştiriliyordu. İzole çoğaltma: düzeltmeden önce soğuk Backlog isteği 13,3 sn, ardından `/api/page-projection/cp` ve `/orders` **404**; düzeltmeden sonra 2,7 sn ve ikisi de **200 (hit)**. Tarayıcı akışında açılıştaki bütün sayfa önbelleği istekleri artık isabet ediyor.

Ek düzeltmeler:
- Genel Bakış İstisna kutusu ve yerleşim kontrolü aynı kayıtlı CP verisini önce sıkıştırılmış önbellekten okur. Yalnız Siparişler'i etkileyen veri değişikliği CP kutusunu yeniden okutmaz (açılışta 61 MB'lık okuma sayısı azaldı).
- Hazır önbellek yolunda eksik olan paylaşılan alan kilidi (`_canEditShared`) `/api/cp-shared-edit` ile istek anındaki sahiplikten uygulanır (sharedAccessRows ile aynı karar; test edildi).
- Tarih serileştirmesi anahtar başına replacer yerine geçici `Date.prototype.toJSON` ile yapılır: 30.000 satırda 1.263 → 566 ms, çıktı birebir aynı.
- `tr-TR` büyük harf normalleştirmeleri (önem etiketi `fold`, yetki `norm`, iş kuralları `turkNorm`) sınırlı bellekle önbelleğe alındı. Mikro ölçüm: 1.753 → 26 ms.

**Sunucu olay döngüsü kilitlenmeleri [Doğrulandı]:** ilk turdaki benchmark oturumlarında 59 kilitlenme vardı (medyan 7,2 sn, en uzun 17,5 sn). Son tam benchmark koşusu boyunca 1 kilitlenme oldu.

**İstemci:** Motion+ tablo dalgası önce tüm aday hücreleri ölçüp sonra animasyonları başlatır; her `animate()` sonrası zorunlu yeniden yerleşim kalktı. Seçilen hücreler ve gecikmeler aynıdır. Model/opsiyon sayımı satır başına model anahtarını bir kez hesaplar.

**Statik dosyalar:** `index.html` yerel adreslere içerik özeti (`&h=`) ekler; özet güncel içerikle eşleşirse yanıt `immutable` olur. Tekrar açılışta 190 dosyanın 161'i önbellekten geldi; istek süreleri toplamı 29 sn → 2,4 sn, DOMContentLoaded 596 → 530 ms (headless, sıcak önbellek).

**Launcher:** seçili çekirdeğin bütünlük taraması aynı doğrulayıcıyla işçi iş parçacığında çalışır; ana süreç donmaz. Bütünlük hatası açılışı aynı kodla durdurur, işçi arızasında senkron tarama yapılır; tarama atlanmaz. Gerçek doğrulayıcı işçide sağlam çekirdeği geçirdi, bozulmuş dosyayı `UPDATE_CORE_INTEGRITY` ile yakaladı. **[Muhtemel]** Electron ana sürecinde ayrıca denenmedi (bu ortamda Linux Electron yok); toplam tarama süresi değişmez, yalnız yanıt verebilirlik kazanılır.

**Donanım uyumu:** açılışta GPU durumu günlüğe yazılır. Yazılım çiziminde (VDI/RDP) bulanık arka plan yerine token türevli yarı saydam katman kullanılır ve hücre dalgası kapanır; sayfa/kart hareketleri sürer. `deviceMemory` ≤ 4 GB veya JS belleği limitin %60'ını aşmışsa Orders arka plan ön yüklemesi atlanır.

**Son ölçüm (aynı sekme, 30.000 sipariş):** Genel Bakış → CP **2,4 sn**, CP → Orders **1,4 sn**, Koleksiyon **0,09 sn**. Modül bazlı izole açılış: Genel Bakış 1,5 sn, Koleksiyon 1,8 sn, CP 16,2 sn (ilk turda 64 sn), Orders 4,1 sn (18–21 sn).

**Ertelenen: sütunlu projeksiyon formatı.** Orders geçişinin ~0,36 sn'si JSON ayrıştırma; sütunlu format istemcide 30 bin satır nesnesinin yeniden kurulmasını gerektirir ve kazancın çoğunu yer. P1 sözleşme riskine değmez; ölçümle yeniden değerlendirilmeli.
