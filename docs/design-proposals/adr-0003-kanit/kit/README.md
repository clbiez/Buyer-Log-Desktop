# ADR-0003 ölçüm düzeneği (repo dışı betikler, ürün kodu değil)

503 / #1236 / güncellik oturumlarının yeniden kullanması için tek klasör. Betikler yalnız yerel
geçici sunucu ve sentetik veriyle çalışır. Parolalar sentetik test parolalarıdır.

## Önkoşullar

- Ölçülecek her commit için ayrı worktree. `node_modules` bağlantısı:
  `ln -s <ana repo>/resources/app/node_modules <worktree>/resources/app/node_modules`
- Playwright + Chromium (sandbox'ta hazır). Yalnız `fresh2.js` tarayıcı kullanır.
- **NODE_OPTIONS:** Ortamdaki `--max-old-space-size` korunmalıdır. Süreç geneli bu bayrak işçi
  `resourceLimits` değerini ezer; bayrağı kaldırmak 503'ü gizler (ADR §6K.1). Üretim politikası
  değeriyle ölçmek için: `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"`.
- **Üretim temsilî çalışma ortamı: Electron.** Üretimde sunucu `BuyerLog.exe` → `ELECTRON_RUN_AS_NODE=1` →
  `server/watchdog.js` ile Electron'un gömülü Node'unda koşar (Electron 44.3.0 = Node 24.20.0). Sandbox'taki
  Node 22.23.5 sonuçları mutlak değer olarak üretimi temsil etmez (PR #1249: Node 22'de 503 tekrarlanabilir,
  Electron 44.3.0'da aynı senaryoda 503 ve GC 0; `decisionMs` Node 22'de ~2,7 sn, Electron'da 1–3 ms).
  Önerilen koşu: `npm install electron@44.3.0` (repo dışı klasöre), ardından
  `ELECTRON_RUN_AS_NODE=1 NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686" <electron> $KIT/ab3.js …`
  (sunucu `process.execPath` ile aynı ikiliden başlatılır). Her sonuçta çalışma ortamı + NODE_OPTIONS yazılır.
- Değişkenler:
  - `KIT=<bu klasörün tam yolu>`
  - `SRC=<fixture klasörü>`
  - `OUT=<çıktı klasörü>`

## 1 · 30k fixture (seed 7, CP 24.982 satır)

```bash
cd <worktree>/resources/app
node scripts/generate-demo-data.js "$SRC" --rows 30000 --seed 7
```

`lib.js` içindeki `ensureSource(APP, 30000, SRC)` aynı komutu çalıştırır.

## 2 · Dosyalar

| Dosya | Görev |
|---|---|
| `lib.js` | Geçici sunucu (`createApp`): ayrı veri kökleri, `boot`/`login`/`refresh`, `/proc` CPU, Playwright bağlamı |
| `ui.js` | CP sekmesi açma ve kaplama temizleme (`blBootGuard`, sürüm notları penceresi) |
| `ab3.js` | Kayıt L2: koşu başına taze sunucu, 6 kayıt (3 Supp. FOB, 3 not), kayıt → `cp/computed since` → Siparişler sorgusu. `AB_INTENT=1`: Supp. FOB gövdesinde `delType` yok (#1243 istemcisi) |
| `ab8.js` | #1236 aynı-t0: modlar `seq` / `par` / `ordersOnly`, 503'te 500 ms yeniden deneme. `AB_FLAG=1` → `BUYER_LOG_CP_ROWPATCH_LEGACY=1` |
| `hook-mem.js` | `--require` kancası: işçi oluşturma/çıkış, iş sonucu `retainedBytes` + `gcRecheck`, 1 sn RSS / VmHWM / ana heap. Date veya modül yaması yok |
| `hook-t0.js` | `--require` kancası: havuz çağrısı / kira / kuyruk, işçiye gönderim ve sonuç zamanları, bellek |
| `analyze7.js` | `ab3` + `hook-mem` özeti: 503, işçi oluşturma, GC, bellek, blok farkları ve A/A |
| `analyze8.js` | `ab8` + `hook-t0` özeti: t0'dan CP / Siparişler / ikisi hazır, istek bazında sunucu aşamaları |
| `probe.js`, `probe2.js` | Heap bayrağı ↔ işçi `resourceLimits` probu (filtrelenmiş `execArgv` ile ve onsuz) |
| `fresh2.js` | Aynı sunucu iki kullanıcı güncellik aşamaları (SSE / BroadcastChannel / `loadFromServer` / istek zamanları / state / DOM). `SINGLE=1` → tek sekme |
| `hub.js` | İki yerel sunucu + ortak Shared Hub klasörü: yayım / algılama süreleri. B bootstrap bu sandbox'ta hata verdi; projeksiyon aşaması ölçülemedi |
| `primary6.js` | Birincil segment: okuma modeli (R) ↔ parse.js (P) tüm satır karşılaştırması (İ/I/Ç katlamalı) |
| `run-l2.sh` | 503 / not L2 (5 kol, 3 blok, A/A) |
| `run-t0.sh` | #1236 t0 (off / on / A/A, 3 blok) |
| `shadow4.js` | #1236 bağımsız gölge (6j/shadow3 + #1241/#1243 koruması): U2 Del. Type tam yol + U1 Supp. FOB/not sonrası korunur, Ex-factory adayı (otomatik olmayan) |
| `contention.js` | Çekişme göstergesi: PSI cpu/io/memory + steal + loadavg (5 sn JSONL); `summary` pencere özeti ve SAKİN/ÇEKİŞMELİ kararı. Her ölçümle birlikte kaydedilir |
| `final-validation.sh` | Birleşik main nihai doğrulaması (Linux + Electron), kollar 8.0.18 / birleşik / A/A: test, kapı --strict-known, shadow5 (her iki sürüm), hub, perf blokları, soak (birleşik + 8.0.18 kısa); adım başına çekişme özeti, SAKİN değilse adım tekrarı |
| `shadow5.js` | Nihai (A) gölge eşitliği: artımlı ↔ yeniden başlatma ↔ sıfırdan tam kurulum; Supp. FOB, not, toplu, POST /rows, Del. Type, Ex-factory, Kaynağa dön (PATCH + /rows), geri al zinciri, IAS parsiyelli Del. Type + Eksik Adet, kıtlık segmentli satır, çoklu renk kardeş korunumu |
| `perf3.js` + `analyze-perf3.js` | Nihai (B) kullanıcı algılı performans: soğuk/ılık açılış (Siparişler ilk satır), 6 kayıt türü → ack / kendi CP hazır / Siparişler hazır, pencere CPU, 503; kol özeti (A/A gürültü bandı) |
| `fixture-ex.js` | Windows kapısıyla aynı fixture dönüşümü (her 4. ASAS satırında yükleme onayı boş → düzenlenebilir Ex-factory) + SHA-256 kaydı |
| `run-t0-electron.sh` | `run-t0.sh` ile aynı kol düzeni, Electron (`ELECTRON_RUN_AS_NODE=1`, `EL=<ikili>`) |
| `soak.js` + `hook-soak.js` + `analyze-soak.js` | Uzun oturum bellek dayanıklılığı: tek sunucu, Supp. FOB / not + CP + Siparişler döngüsü, havuz/şerit stats, dakika serisi |

## 3 · Komutlar

```bash
# 503 / not L2. pre = b7b172d + 503 commit'i (cherry-pick), main = fdf2f758
git -C <repo> worktree add ../pregc b7b172d
git -C ../pregc cherry-pick fdf2f758   # ADR'deki c6e2f658'in eşdeğeri (uzakta yok)
KIT=$PWD SRC=/path/source OUT=/path/out PRE=/path/pregc/resources/app MAIN=/path/gc/resources/app ./run-l2.sh

# #1236 aynı-t0 (bayrak kapalı / açık + A/A)
KIT=$PWD SRC=/path/source OUT=/path/out8 APP=/path/pilot/resources/app ./run-t0.sh

# Heap bayrağı probu
node probe.js; NODE_OPTIONS= node --max-old-space-size=4096 probe.js; NODE_OPTIONS= node --max-old-space-size=4096 probe2.js

# Güncellik aşamaları (iki sekme / tek sekme)
cd /path/gc/resources/app
BUYER_LOG_COMPUTE_GC_RECHECK=1 node $KIT/fresh2.js $PWD $SRC /path/fresh.json
SINGLE=1 BUYER_LOG_COMPUTE_GC_RECHECK=1 node $KIT/fresh2.js $PWD $SRC /path/fresh-single.json

# Birincil segment karşılaştırması
node $KIT/primary6.js $PWD $SRC /path/primary.json
```

Her koşu kendi `/tmp/buyerlog-startup-o3-*` kökünü açar. Koşular arasında başka sunucu
veya tarayıcı çalıştırmayın. L2 eşzamanlı yükte geçersizdir.

## 4 · Birleşik main nihai doğrulaması (tek komut)

```bash
# Özel ölçüm slotu alınmadan başlatmayın; koşu boyunca başka yoğun süreç olmamalı.
# OUT, OS geçici dizininin altında olamaz (betik reddeder).
REPO=/home/user/Buyer-Log-Desktop BASE=12521fcac6e6eaf233cd56a82d6ea5bd931c990f CAND=<birleşik main SHA> \
EL=<electron 44.3.0>/dist/electron OUT=$HOME/final-<sha> SOAK_MIN=110 SOAK_BASE_MIN=30 BLOCKS=3 \
  docs/design-proposals/adr-0003-kanit/kit/final-validation.sh   # varsayılan: test gate shadow shadowbase hub perf soak soakbase
```

- BASE = STABLE 8.0.18 kaynak commit'i (12521fc, package.json 8.0.18; a7a92a1 yalnız sürüm notu görsellerini arşivler, JS farkı yok).
- Çıktı: `$OUT/ozet.md` (adım sonucu + adım penceresi çekişmesi, 60 sn boşta taban), `$OUT/<adım>/` ham dosyalar, `$OUT/perf/perf-ozet.md`,
  `$OUT/perf/runs.tsv` (koşu başına çekişme), `$OUT/tekrarlar.txt` (SAKİN olmayan denemeler, `<adım>.denemeN/`).
- Tahmini süre: test ~10 dk, gate ~20 dk, shadow ×2 ~20 dk, hub ~10 dk, perf 3 blok × 3 kol × (~12 + ~6) dk ≈ 2,7 sa, soak 110 + 30 dk.
- Windows yarısı (ebeveyn tetikler; ikisi de `ref=<birleşik main SHA>`):
  - `Buyer Log Tests` (`buyerlog-tests.yml`): Windows tam regresyon, `TEMP=runner.temp`.
  - `Buyer Log Windows Electron gate` (`buyerlog-electron-gate.yml`), `strict_known=true`: gerçek `BuyerLog.exe` kapısı.
- Karar: çekişme özeti SAKİN olmayan adım MAX_REPEAT kez yeniden koşar; yine SAKİN değilse süre ölçümü ön sonuçtur. Veri bütünlüğü kapıları
  çekişmeden bağımsızdır (yine de aynı kurala tabidir). PSI ölçülen işin kendi yükünü içerir (ör. paralel `npm test`): boşta taban ve steal ile okunur.
