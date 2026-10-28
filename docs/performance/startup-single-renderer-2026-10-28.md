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
