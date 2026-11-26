# Performans taban raporu — main @ d772bab (2026-11-26)

Yalnız ÖLÇÜM. Uygulama kodu, test ve eşik değiştirilmedi; tam `npm test` koşulmadı.
Mevcut benchmark scriptleri kullanıldı, yeni benchmark yazılmadı. Ham özetler:
`docs/performance/baseline-2026-11/`.

## 1 · Ortam ve geçerlilik sınırı

| Alan | Değer |
| --- | --- |
| Kaynak | `main` d772bab62d53838461b455bc634823d1158763bb (çalışma ağacı temiz) |
| Ortam | Linux 6.18 bulut container, 4 vCPU Intel Xeon @ 2.10 GHz, 16 GB RAM |
| Çalışma zamanı | Node v22.23.5; Playwright Chromium (headless, `--no-sandbox`) — **Electron değil** |
| Veri | Sentetik 30.000 satırlık fixture (seed 7), scriptlerin kendi üreticisi |
| Koşu düzeni | Her metrik için 3 bağımsız koşu, seri (aynı anda ağır iş yok); medyan + ham değerler |

**Bu sayılar Windows kullanıcı makinesini TEMSİL ETMEZ.** Electron sekmesi, Windows
dosya sistemi/SMB, kurumsal antivirüs ve gerçek iş verisi ölçülmedi. Mutlak değerler
yalnız bu container içinde karşılaştırma tabanıdır; hedefe uzaklık "yaklaşık"tır.
Container'da `npm install` ile yalnız bağımlılıklar kuruldu (`node_modules` git dışı).

## 2 · Metrik → script → sonuç

Hedefler henüz garanti değildir. Süreler ms.

| Metrik (hedef) | Script / senaryo | Medyan | Ham (3 koşu) | Hedefe uzaklık |
| --- | --- | --- | --- | --- |
| **İlk kullanılabilir ekran** (<1000) — açılış modülü Genel Bakış | `benchmark-startup-orders.js --rows 30000` (`primaryScreenReadyMs`) | **1512** | 1601 / 1512 / 1377 | ~1,5× |
| aynı, açılış modülü Koleksiyon | aynı | **1178** | 1178 / 1203 / 1134 | ~1,2× |
| aynı, açılış modülü CP | aynı | **4389** | 4393 / 4389 / 4219 | ~4,4× |
| aynı, açılış modülü Siparişler (soğuk) | aynı | **17085** | 17296 / 16748 / 17085 | ~17× |
| Başlangıç tamam (`startupComplete`), Genel Bakış | aynı | 1611 | 1715 / 1611 / 1483 | — |
| Başlangıç ana-iş-parçacığı uzun görev toplamı (Genel Bakış) | aynı | 4932 (maks 608) | 5474 / 4932 / 4702 | — |
| Aynı sekmede modül geçişi: Siparişler | `startup-orders` `sameTab.switches` | 767 | 832 / 767 / 720 | hedef tanımı belirsiz |
| Aynı sekmede modül geçişi: CP | aynı | 5366 | 928 / 5887 / 5366 | yüksek varyans (ısınma ile yarışıyor) |
| Aynı sekmede modül geçişi: Koleksiyon | aynı | 164 | 164 / 186 / 137 | — |
| **CP kayıt akışı: kayıt onayı** (<16) | `benchmark-cp-save-flow.js --rows 30000 --runs 3` (`ack.p50`) | **29** | 26 / 29 / 29 | ~1,8× (p50); p95 medyan 91 (54–104) |
| CP kayıt: diğer sekmede görünme | aynı (`visible.p50` — sunucu yayını, çizim hariç) | 333 | 332 / 334 / 333 | — |
| CP kayıt akışı sırasında Siparişler okuması | aynı (`ordersRead.p50`) | 1851 | 1851 / 1731 / 2138 | p95 4201 (2377–7628) |
| Son kayıttan projeksiyon yazımlarının bitişi | aynı (`lastSettledMs`) | 3534 | 3534 / 3205 / 3592 | — |
| Olay döngüsü gecikmesi (`/api/status`) | aynı | p95 19, maks 168 | maks 108 / 168 / 183 | — |
| Kayıt başına sunucu ana-iş-parçacığı CPU | aynı (`mainCpuPerSaveMs`) | 153 | 153 / 146 / 158 | — |
| Süreç toplam CPU (işçiler dahil, 16 kayıt/41 sn pencere; akıştaki Siparişler okumaları ve yeniden yazımlar birlikte) | aynı (`processCpuMs`) | 94 250 | 94 250 / 93 430 / 95 660 | ≈ 5,9 CPU-sn/kayıt (okuma+yazım ayrıştırılamadı) |
| **Bellek**: sunucu RSS boşta → kayıt akışı sonrası → tepe | aynı | 185 → 502 → 1697 MB | tepe 1715 / 1605 / 1697 | veriden bağımsız değil |
| Bellek: `benchmark-erp-readmodel` sunucu RSS / tepe | `benchmark-erp-readmodel.js --runs 3` | 2642 / 2675 MB | 2462–2665 / 2573–2687 | — |
| Modül ilk açılışı (tıkla → satır görünür): CP | aynı (`module.cp.openMs`) | 1363 | 2209 / 1363 / 799 | — |
| …Siparişler | aynı | 813 | 800 / 857 / 813 | — |
| …Koleksiyon / Backlog | aynı | 174 / 172 | 173–176 / 146–194 | — |
| Açılış sonrası pencere: uzun görev toplamı | aynı | 4519 (maks 821) | 3918 / 4519 / 5389 | — |
| Açılış sonrası pencere: olay döngüsü gecikmesi maks | aynı | 787 | 787 / 729 / 795 | — |
| `/api/page-projection/*` yük (çözülmüş) | aynı | orders 78,8 MB · cp 66,6 MB · overview 12,2 MB · toplam 154 MB | sabit | — |
| Sunucu tarafı 30k satır sıralama (her iki yön) | `benchmark-client-computation.js --case sort` | 278 | 265 / 338 / 278 | filtre değil; yalnız ilgili hesap vekili |
| Okuyucu (5000 satır × alan) | `… --case reader` | 10,9 | 10,1 / 11,9 / 10,9 | — |

Not: CP kayıt akışındaki 3 kayıt türü `notes`, `delType`, `dates.retailDate`. **Ex-F
(`exFactory`) tarihi bu akışta ölçülmedi**; Ex-F yolu aşağıda source'tan çıkarıldı.

## 3 · Ölçülemeyenler

| Metrik / script | Durum | Neden / gereken küçük script |
| --- | --- | --- |
| İndekslenmiş arama (<50) | **ÖLÇÜM ARACI YOK** | `card-search-trace.js` / `card-render-acceptance.js` yalnız lisans kartı aramasını ölçer (5000 kart); sipariş tablosu/CP indeksli arama yok. Gerekli: 30k fixture üzerinde arama kutusuna yazma → görünür satır güncellemesi (Playwright, `performance.now`) ölçen tek senaryolu script. |
| Standart tablo filtreleme (<100) | **ÖLÇÜM ARACI YOK** | `table-search-feedback-acceptance.js` kabul (assert) scriptidir, süre tabanı üretmez, sabit `/usr/bin/chromium` ve `dacd2ddb` commit'ine bağlıdır. Gerekli: CP/Siparişler tablosunda bir sütun filtresi uygula → ilk görünür satır + en uzun görev. |
| Hücre düzenleme tepkisi (<16) — **istemci** kısmı | **KISMEN** | `benchmark-cp-save-flow.js` yalnız sunucu `ack`/yayın süresini ölçer (tarayıcı yok). Hücre commit → ilk boyama süresi için script yok. Gerekli: Playwright ile CP hücresi düzenle → `requestAnimationFrame` sonrası süre. |
| Tek siparişte yeniden hesaplanan iş miktarı | **SAYAÇ YOK** | Kayıt başına satır/modül sayacı üreten çıktı yok; yalnız dolaylı CPU/RSS/sıra süresi var (bkz. §4). Gerekli: `projection-rewrite` işçisinde (kod değişikliği gerektirir) eşleşen/taranan satır ve yeniden serileştirilen bayt sayacı, ya da bir Ex-F kaydı için `cp-save-flow`'a `exFactory` türü ekleme. |
| `benchmark-server-openings.js` | **BLOCKED** | Zorunlu `--seed-report` (tamamlanmış F0 demo fixture raporu) yok; F0 koşusu ayrı bir görev. |
| `benchmark-first-transitions.js` | **BLOCKED** | Zorunlu `--measurement` (tam Faz 0 koşusunun çıktısı) yok. |
| `benchmark-client-computation.js --case catalog` | **BLOCKED** | `--fixture-root` (işaretli sentetik fixture) gerektirir; kalıcı fixture üretilmedi. |
| `client-paired-benchmark.js`, `performance-ui-acceptance.js` | **EŞLEŞME YOK** | Birincisi lisans kartı/LCW AI render A/B'si, ikincisi ekran görüntüsü yakalama aracıdır; hedef metriklerle ilgisiz. |
| Electron / Windows / SMB | **ÖLÇÜLEMEDİ** | Container Linux; Electron kabulü bu ortamda yok (PERFORMANCE_ACCEPTANCE §2). |

Ayrıca: p95 değerleri senaryo başına 16 gözlemden gelir; PERFORMANCE_ACCEPTANCE §3
gereği güvenilir p95 iddiası için ≥20 gözlem gerekir — p95 sütunları **gösterge**dir.

## 4 · Tek bir sipariş alanı (Ex-F) değişince ne yeniden hesaplanıyor / yazılıyor?

Doğrudan sayaç çıktısı yok; aşağıdakiler source okumasıdır ve §2'deki dolaylı ölçümlerle
(154 MB projeksiyon, 5,9 CPU-sn/kayıt, RSS 185 → 1697 MB) tutarlıdır. Ex-F kaydı çalıştırılmadı.

Akış (`POST /api/overrides/rows` → `server/lib/read-model/cp-row-save.js`, `server/server.js:10518`,
`server/lib/page-projection-cache.js:377`, `server/lib/projection-row-patch.js`):

1. **Paylaşılan override belgesi: [Doğrulandı — source]** `db.patchOrderOverrideRows`
   (`server/db.js:1165`) her denemede `loadOverrides()` ile TÜM belgeyi okur,
   `saveOverrides` içinde belgeyi bir kez daha okur (`loadOverrides` + `readJsonWithBackup`), `saveRevisioned` legacy yazım açıksa (`deltaWritesLegacy`) TÜM belgeyi `atomicWriteJson` ile yazar ve `mirrorToDelta` ile delta deposuna aynalar (revizyon çatışmasında 8 denemeye kadar). Okuma maliyeti belge boyutuyla orantılı; delta aynalamanın alan bazlı olup olmadığı [Bilinmiyor] (incelenmedi).
2. **Satır hesabı: [Doğrulandı — source]** `applyIncrementalProjectionPatch` yalnız
   `projectionPatchMatches` ile eşleşen (sipariş kodu + model + renk) satırlara uygulanır; `dates`
   için o satırda `applyFormulas` (+ Buying Son Onay Tarihi varsa `resolveExFactoryDate`) çalışır. Yani formül yeniden hesabı **etkilenen satırlarla sınırlıdır** (artımlı).
3. **Satır TARAMASI ve modül yazımı: [Doğrulandı — source]** `runRowRewriteBatch` bildirilen
   her projeksiyon modülünü (cp, orders, overview vb. — `MODULES`) diskten okur, işçide
   JSON'a çevirir ve her satırı her yama öğesiyle karşılaştırır (O(satır × öğe)); yalnız `changed`
   modüller yeniden gzip + yazılır. Ex-F değişiminin cp ve orders/sipariş özeti modüllerinin ikisini de `changed` işaretleyeceği [Muhtemel] (satır her iki modülde eşleşir; koşulmadı); öyleyse bu modüllerin tam yükü (cp 66,6 MB + orders 78,8 MB çözülmüş) yeniden serileştirilir. Ardışık kayıtlar `ROW_REWRITE_MAX_BATCH`'e kadar birleşir.
4. **Okuma bekler: [Doğrulandı — runtime, dolaylı]** Sonraki okuma `pendingRewritesSettled`
   bitene dek bekler; ölçülen Siparişler okuması p50 1,85 sn (p95 4,2 sn), son kayıttan
   okuma sonuna 3,5 sn.
5. **Canlı olay: [Doğrulandı — source]** `liveRowPatchesFor` yalnız değişen satırları
   yayar; ancak `dates` içinde boş/`null` değer varsa (`rowPatchIncrementalSafe`) tur
   komple yeniden yüklemeye düşer (Ex-F'i silme/temizleme yolu).
6. **İstemci: [Muhtemel]** `public/app-main.js` (≈44300. satırlar) yama ile ilgili CP satırını günceller ve `syncCpProductionLogisticSegment` çağırır; diğer sekmede tam tablo yeniden render edilip edilmediği ölçülmedi. [Bilinmiyor] nasıl çizildiği.

Özet: **hesap artımlı, I/O ve tarama değil.** Tek satırlık değişiklik için sunucu, modül başına
onlarca MB'lık JSON'u çözüp yeniden yazıyor [Muhtemel, boyutlar Doğrulandı].

## 5 · Artımlı hesaplama pilotu adayları (en pahalı 3 sıcak yol)

Sıralama ölçülen maliyete ve hedefe uzaklığa göredir.

| # | Aday | Neden | Kanıt |
| --- | --- | --- | --- |
| 1 | **Satır kaydı sonrası projeksiyon yeniden yazımı** (`runRowRewriteBatch` → işçi, tüm modüller) | Ölçülen: kayıt başına ≈5,9 CPU-sn (Siparişler okumaları dahil, ayrıştırılamadı), Siparişler okuması 1,85 sn (p50), RSS tepe 1,7 GB (boşta 185 MB), `lastSettled` 3,5 sn. Hesap zaten satır bazlı; maliyet modül boyutuyla (cp 66,6 MB, orders 78,8 MB) orantılı. Pilot: değişen satır kümesini modül dosyasını bütün çözmeden (parça/satır-segment deposu veya yalnız yama günlüğü + tembel birleştirme) uygulamak. Hedef "yalnız etkilenen" ile doğrudan örtüşür. | [Doğrulandı] ölçüm (cp-save-flow ×3), [Doğrulandı] source; kazanç büyüklüğü [Hipotez] |
| 2 | **CP / Siparişler soğuk açılış ve projeksiyon yükü** | Açılış modülü olarak CP 4,4 sn, Siparişler 17 sn (hedef <1 sn); Genel Bakış 1,5 sn bile hedefin üstünde. Uzun görev toplamı 5,5 sn (CP), tek görev maks 1,7 sn. Yük 154 MB çözülmüş JSON; ilk ekran için gerekmeyen satırların hazırlanması artımlı/sayfalı hesapla ertelenebilir. | [Doğrulandı] ölçüm (startup ×3, erp ×3). İstemci tarafı darboğaz payı (JSON parse vs. render vs. sunucu hazırlık) [Bilinmiyor] — profil gerekir; CP geçişinde 928–5887 ms varyans, ısınma yarışı [Muhtemel] |
| 3 | **Paylaşılan override belgesinin tam okuma/yazması** (`patchOrderOverrideRows`, `saveOverrides`) | Her kayıt tüm belgeyi okuyup yazıyor; kayıt başına ana-iş-parçacığı CPU 153 ms — 16 ms hedefinin ~10× üstü (ack p50 29 ms'nin büyük kısmı bu yol olabilir). Belge büyüdükçe doğrusal artar; çok kullanıcılı senkronla da çakışma yeniden denemesi doğurur. Pilot: alan/satır bazlı yazma günlüğü. | [Muhtemel] (ack ve ana CPU ölçüldü, ancak payı belge IO'suna atfeden profil yok); belge boyutu [Bilinmiyor] |

Bilerek aday yapılmayanlar: 30k satır sıralama (278 ms) ve okuyucu (10,9 ms) ölçüldü ama
hedef metrik (filtre/arama) olmadığı için pilot seçimine dayanak değil; arama/filtre için önce
§3'teki küçük ölçüm scriptleri gerekir, yoksa sıralama bu iki hedef hakkında kanıt sayılmamalı.

## 6 · Sınırlar ve riskler

- Tek makine, 3 koşu; küçük farkları gürültüden ayırma gücü düşük (örn. CP geçişi 928 / 5887 / 5366 ms).
- Startup scriptinde her modül ayrı, soğuk bir sunucu/tarayıcıyla açılır; "Siparişler 17 sn" kullanıcının tipik açılışı değil, o modül açılış modülü seçilirse soğuk durumdur.
- `erp-readmodel` ve `startup` koşuları arka plan ısınmasını (BACKGROUND_WARMUP) dahil eder; sunucu RSS 2,6 GB bu ortamda 4 vCPU ile ölçülen değerdir.
- Hedefler garanti değildir; bu rapor kabul veya FAIL kararı vermez (kademe: N/A — yalnız doküman/ham ölçüm).

## 7 · Yeniden çalıştırma

```
cd resources/app && npm install --no-save
export CHROMIUM_PATH=<chromium yolu>
node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/startup-N.json
node scripts/benchmark-cp-save-flow.js --rows 30000 --runs 3 --out /tmp/cp-save.json
node scripts/benchmark-erp-readmodel.js --runs 3 --out /tmp/erp.json
node scripts/benchmark-client-computation.js --case sort --out /tmp/cc.json
```
