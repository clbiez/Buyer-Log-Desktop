# Faz 7 · Sunucu kalan işler / Remaining server work

Ön koşul geçti: #885 main'e merge; baz #902 `63159fb3`. Bu teslim **merge öncesi** durur. TEST/STABLE yapılmadı. Üç bağımsız P1 PR kapsamı: DS-08; INT-04/05; INT-11. `public/**` değişmedi.

[Ölçüm yöntemi / Method](phase-7-server-method.md) · [66 nihai ham kayıt ve özet / Final raw records](phase-7-server-results.json) · [Bağımsız inceleme / Independent review](phase-7-independent-review.md) · [TR/EN notlar ve gerçek PNG / Notes and actual PNGs](phase-7-release-notes.md).

| Madde | Karar | Süre medyanı, ms (before → after) | Koşu başına max-gap medyanı, ms |
| --- | --- | ---: | ---: |
| DS-08 | Uygulandı; kabul edilen worker işleri | 374.920 → 404.012 | 319.655 → 47.562 |
| DS-11 | **Atlandı: gerçek SMB/RTT ölçülemedi** | N/A | N/A |
| INT-04 | Uygulandı; 300 tamamen yerel görsel | 21.809 → 3.548 | 12.726 → 12.166 |
| INT-05 | Uygulandı; 200 × 4.100 byte, gerçek yerel pack yayını | 2851.865 → 257.209 | 13.284 → 11.177 |
| INT-07 | **Atlandı: gerçek PLM oturumu/ölçümü yok** | N/A | N/A |
| INT-10 | **Atlandı: upstream kapasite/kazanç doğrulanmadı** | Beş sahte upload: 204.993 → 204.512 | 12.110 → 10.946 |
| INT-11 | Uygulandı; beş küçük EML, 5 → 2 ayrık süreç | 681.646 → 273.170 | 18.886 → 18.077 |
| ADMIN-02 | **Atlandı: korumalarla birlikte güvenli I/O kazancı kanıtlanmadı** | %0 kontrol: 1036.409 → 1023.737 | 13.219 → 13.138 |

EN: Four items are implemented in three separate changes. DS-11/INT-07 lack required real services; INT-10 lacks upstream capacity evidence; ADMIN-02 has no demonstrated safe I/O improvement. Skipped items remain open. Unchanged controls are not speedup claims.

## DS-08 — dayanıklılık ve ölçülen ödünleşim

10.253.621 byte / 30.000 sentetik kayıt. Worker havuzu iki kolda da ölçümden önce ısıtılır. Gerçek `transaction → inspect WAL → encode → durable replace/verify/fsync → rotate WAL` yolu ölçülür. Altı snapshot'ın SHA'sı birebir: `f1501976d921231defcce266c1b0abbd09968aa16e5ec775efbf175dd8c8fed6`. Yeniden açılış kayıt eşitliği geçti.

Tam gap'ler (ms): before: 326.870, 303.084, 319.655; after: 58.499, 47.026, 47.562. Toplam süre **artıyor**; bu HTTP veya save hızlanması değildir. Süre artışı 7.76%; süreç RSS tepe medyanı 273.508 → 289.195 MiB. V8 girdisinin MAIN'de hazırlanma maliyeti hâlâ vardır. İşin pahalı JSON üretimi havuzdadır; çıktı transfer edilir, MAIN'e tekrar nesne olarak kopyalanmaz.

Yerel DB lease'i worker dönüşünü ve durable commit'i kapsar. Hatalı encoder/yanlış revision/konum değişimi WAL'ı döndürmez ve doğrulanmamış cache mutasyonunu açığa çıkarmaz. Havuz kapasite/yoğunluk/hata reddinde ve V8 encoding uyumsuzluğunda eski large-json kapasitesi korunur; fallback eski stall'ı koruyabilir. `ensure`/ilk küçük snapshot ve saf store çağıranları eski yolu korur; ortak sunucu DB'si opt-in encoder kullanır. Şema, CAS/HLC/tombstone/replay/dedup veya dosya formatı migration'ı yoktur.

RED → GREEN: `phase7-snapshot-compute` + `phase7-snapshot-durability`. Gerçek küçük pool reddi, busy/timeout/worker failure, JSON uyumlu toJSON, exact byte parity, lease, WAL, revision ve konum kontrolleri. Reviewer'ın P1 kapasite bulgusu RED çoğaltıldı, düzeltme bağımsız modelde 11/11 GREEN.

EN: The checkpoint pause improves at the cost of 7.76% total time and some peak RSS. Existing durable capacity survives pool rejection through fallback; not every size/load is offloaded. No storage migration or business merge/clock changes.

## INT-04/05 — yerel karar ve pack protokolü

Önce local/manual/role kontrolleri; yalnız unresolved kimlikler ortak metadata turuna gider. Yerel 300 kayıtta `available/lookupMany/readdir/readFile`: 1/1/1/20 → 0/0/0/0. Kaynak sıkılığı, ortak manuel önceliği ve role refresh korunur. Tam gap'ler: before: 13.282, 12.726, 12.703; after: 12.166, 10.216, 13.740.

Pack verisi aynı 16 hash-prefix shard kilidi altında gruplanır; aynı anda yalnız bir shard kilidi, ardından pack kilidi tutulur. Her pack için tam yazım ve fsync, sonra head/index; bütün baytlar hazır olduktan sonra özgün sıra ile manifest/head. Aynı hash tekrar kullanılır; 64MiB pack sınırı ve v1 locator okuma korunur. Fsync hatası yayını durdurur. Sayımlar lease/metadata işlemleri dahil: open 3417 → 289, sync 2613 → 221, read 2613 → 221, write 2613 → 405. Dosya handle'ı pack-sync sayısı 200 → en çok 16. Bütün 200 locator bayt-eşit okundu; tekrar yayım dedup testinde 200/200 reused.

Tam pack gap'leri: before: 13.284, 11.477, 20.258; after: 11.177, 11.395, 11.168. Süre kazanımı Linux overlayfs içindir; gerçek SMB round-trip veya Windows oranı değildir. SIGKILL aşamaları: pack sync, pack head, content index, manifest ve device head. Yeniden başlatma/yeniden yayım geçti. İki gerçek süreç yarışı, kısa native write, pack rollover ve mevcut manuel/source/tombstone testleri geçti. Bu süreç-çökmesi testi güç kesintisi veya gerçek SMB kalıcılık garantisi yerine geçmez.

EN: Local hits avoid shared metadata entirely. Pack publication batches by existing content shards while retaining the lock order, durable-before-visible boundary, format, dedup and size cap. Real-process kill/restart and two-process tests pass locally; SMB performance/durability remains unmeasured.

## INT-11 — öncelik ve işe özel batch

Mevcut tek aktif, kısa ömürlü process kullanılır; yeni pool veya kullanıcılar arasında sıcak parser yoktur. En çok dört küçük dosya / toplam 1MiB ve toplam expanded budget aynı iş içinde hazırlanır. Büyük dosya tekil yolda kalır. Heap 256MiB / Endeksmatik 768MiB, queue byte limiti, ZIP gerçek inflate kontrolü, timeout ve iptal korunur. Parent stage kimlikleri yeniden eşlenir. Tek process admission toplam parser eşzamanlılığını birde tutar.

Küçük beş EML: 681.646 → 273.170 ms, süreç sayısı 5 → 2; parent RSS 33.621 → 33.117 MiB. Çocuk tepe RSS ayrı ham kayıttadır; tüm süreç ağacının eşzamanlı tepe ölçümü iddia edilmez. Tam gap'ler: before: 18.886, 17.257, 24.950; after: 18.077, 17.303, 21.338.

Sentetik 5 × 100ms arka plan işinde kısa interaktif işin bekleme+dönüşü 671.358 → 152.865 ms. Tüm kuyruğun tamamlanması 675.156 → 663.202 ms; throughput kazancı denmez. Sınıf içi FIFO ve üç interaktif işten sonra bekleyen background admission korunur; aktif iş kesilmez. Gerçek dosya dağılımının kurumsal p95'i ölçülmedi.

EN: Five small reports use two job-local processes. Priority reduces the short action's wait, not overall queue throughput. Existing heap/ZIP/input/timeout/cancellation boundaries remain; no shared untrusted hot pool.

## Atlananlar — açık kalan kapsam

- **DS-11:** Ortamda CIFS/SMB mount, gerçek peer seti ve RTT girdisi yok. Yapay sleep veya yerel klasör sonucu gerçek SMB kanıtı sayılmadı. Sync metadata concurrency/uygulama sırası değiştirilmedi. RED/GREEN ve gerçek A/B N/A; madde kapanmadı.
- **INT-07:** Kullanılabilir gerçek PLM oturumu/servis ölçümü yok. BOM/client retry/concurrency/deadline kodu değişmedi. Mock 429 ile kazanç veya kurumsal kapasite iddia edilmedi. RED/GREEN ve gerçek A/B N/A; madde kapanmadı.
- **INT-10:** Aynı kod üzerinde 40ms sahte servisle 1/5 upload ve üçüncü dosya hatası kontrolü alındı. Bir dosya 44.573 → 43.307 ms; beş dosya 204.993 → 204.512 ms; hata 121.321 → 121.106 ms ve send=0. Peak concurrency iki kolda da bir. Bu yalnız mevcut seri hazırlık maliyetini gösterir; upstream iki upload'u kaldırır veya kazanç sağlar denemez. Üretim değişikliği, RED/GREEN ve gerçek upstream A/B yok; atlandı/açık.
- **ADMIN-02:** 100 × 512KiB kaynak, %0/%1/%20 değişim, her iki değişmemiş arşiv kolunda üç dönüşümlü çift. Süreler sırasıyla 1036.409 → 1023.737, 1068.531 → 1028.827, 1076.641 → 1055.389 ms. Her koşuda 157,395,997 okuma byte'ı, 104,901,662 yazma byte'ı, 104,901,662 temp byte; son arşiv 52,455,783 byte. Kaynak→snapshot→ZIP→bağımsız doğrulama geçişleri korunur. Her koşuda 100 dosya bağımsız restore edilip SHA karşılaştırıldı. A/B aynı backup kodudur; zaman farkları optimizasyon kazancı değildir. Güvenli snapshot/son doğrulamayı çıkarmadan I/O kazancı gösteren alternatif yok; artımlı kalıcı arşiv/cache formatı kanıtsız P1 kapsamına eklenmedi. Üretim değişikliği ve RED/GREEN yok; atlandı/açık.

## Doğrulama ve teslim

- Tam `npm test`: 1.294 dosya, 8.937 test; **8.872 PASS, 0 fail, 0 cancel, 65 platform/opt-in skip**, 115.4s. Skip'ler başarılı zorunlu Windows/soak doğrulaması sayılmaz. İki eski çevrim fixture-preload hatasıyla durdu: altı ve bir mevcut test; ikisi de değişmemiş bazda çoğaltıldı. Son preloader normal temp/LOCAL_DATA default politikasını korur; son tam çevrim exit 0.
- Birleşik ilgili paket: 65/65 PASS. Ayrık PR kollarının hedefli sonuçları artifact manifestinde. Bağımsız ikinci model incelemesi ve P1 kapanış testi tamamlandı.
- i18n yeni/baseline: 0/0. Değişmemiş pending release notes: 38 kayıt doğrulandı. Kullanıcı sınırı gereği yeni TR/EN notları ve PNG'ler docs altında; public ağacı aynı.
- Gerçek post-change Chromium / demo Koleksiyon: TR/açık ve EN/koyu; altı satır, owner-editable scope, 12 katalog, dil/tema assertion ve JS errors=[] kontrolleri geçti. PNG'ler agent tarafından açılıp incelendi. Runtime smoke'dur; büyük DB/SMB/PLM veya gecikme kanıtı değildir.
- Üç ayrı taslak PR, main'e merge edilmez. TEST yapılmadı. STABLE yapılmadı. CI durumunu PR üzerindeki gerçek check sonucu belirler; yerel full test CI yerine geçmez.

EN: Full npm test completes with 8,872 passes, zero failures/cancellations and 65 explicit platform/opt-in skips. Real bilingual post-change demo screenshots were inspected. Three isolated draft PRs stop before merge; no TEST/STABLE publication. Remaining skipped items are open, and local CI claims are kept separate from actual GitHub check results.
