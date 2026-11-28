# Birincil lojistik segment — İş 1 ölçümleri (2026-11-28)

Kural: ürün sahibi A–D (ADR-0003 §6O.c). Tek fonksiyon `BLBusinessRules.selectPrimaryLogisticSegment`
(dal `claude/primary-segment-ad`). Taban main `d43150b`, aday `aacfd86`.

Ortam: Linux container, Node 22.23.5, `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=8192"` (sandbox varsayılanı).
Electron ölçülmedi. Fixture: `node scripts/generate-demo-data.js <SRC> --rows 30000 --seed 7` (CP 24.982 satır).
Bugün = 2026-11-28 (fixture tarihleri bugüne göre üretilir).

## Betikler (`betikler/`)

`lib.js` ve `ui.js` için `../kit/` dosyalarını betiklerin yanına kopyalayın.

| Dosya | Görev |
|---|---|
| `dump.js <APP> <SRC> <out.json>` | Gerçek sunucu (kit `lib.js`): CP okuma modeli `cp/query` satırları, `cp/computed` karar demeti, ham `cp` ve `orders` projeksiyonu. `FULL=<dosya>` tam okuma modeli satırlarını yazar |
| `cmp.js` | main ↔ aday alan alan: CP okuma modeli, Siparişler projeksiyonu, aday içinde ham ↔ okuma modeli, IAS segmentleri |
| `prio.js <APP> <full.json>` | Karar etkisi: main okuma modeli satırı (R) ↔ aynı satır yeni kuralla (U), aynı `cp-readiness-engine`. İki transit kural kümesi. Adayın gerçek satırları simülasyonla 24.982/24.982 aynı (doğrulandı) |
| `bench.js <MAIN> <CAND> <full.json>` | L2 mikro A/B: `prepareCpRows` + istemci `rebuildCpLogisticCaches`, 16 dönüşümlü örnek, `--expose-gc` |
| `shapes.js` | Segment desenleri (kategori sayımı) |
| `shot.js` | Sürüm notu ekran görüntüsü (2k demo, 4100023/L02) |

## Sonuçlar (`ham/`)

`segment-desenleri.txt` — 30k kategori: yalnız üretim 17.274; üretim + depoda 2.707; miktar-0 Üretimde parsiyel + üretim
2.331; üretim + yolda 1.933; üretim + "Yüklemede" 732; kıtlık + parsiyel 5. Birden çok parsiyelli satır 0; üretimsiz
yolda + depoda 0.

`cmp-main-aday.json` — değişen satır (main → aday):

| Kategori | CP okuma modeli | Siparişler |
|---|---|---|
| yalnız üretim (17.274) | 0 | 0 |
| üretim + depoda (2.707) | STATUS 2.707, HANDOVER 2.707, Ant. Arrival 2.687, Del. Type 1.783 | 0 |
| üretim + yolda/yüklemede (2.665) | STATUS 2.665, Ant. Arrival 2.648, Del. Type 1.788 | 0 |
| miktar-0 parsiyel + üretim (2.331) | Ant. Arrival 2.316, Del. Type 1.544 | Ant. Arrival 2.280, Del. Type 2.280 |
| kıtlık + parsiyel (5) | 0 | 0 |

- Priority (`cp/computed` ve Siparişler `Priority`): 0 değişim — fixture'da kural yok, hepsi ON_TRACK.
- IAS kaynak segmentleri: 0 fark. Aday içinde ham projeksiyon = okuma modeli (yalnız önceden var olan vasıta adı
  normalizasyonu, kıtlık satırında 3: `UCAK` ↔ `Uçak`).

`priority-etki.json` — karar motoru etkisi (bugün 28.11; "kritik" = eski yerleşik Late kuralı: Ex-factory geçmiş ∧
EXPECTED/ALREADY_LATE):

| Transit kuralları | Kategori | Teslimat sonucu değişen | Kritik kayıp / kazanç |
|---|---|---|---|
| Gemi 70 / Uçak 15 / TIR 20 | üretim + depoda | 2.439 (→ EXPECTED/ALREADY_LATE) | 0 / 2.402 |
| | üretim + yolda/yüklemede | 2.519 | 0 / 2.472 |
| | miktar-0 parsiyel + üretim | 1.234 (vasıta TIR → Gemi) | 0 / 1.211 |
| tek kural `delType:''` 35 gün | üretim + parsiyel | hepsi → UNKNOWN (kural hiçbir vasıtayla eşleşmez) | 408 / 0 |

`ab-*.json`, `aa-*.json` — L2 (ms, 16 örnek medyanı, A = main, B = aday):

| | prep A | prep B | istemci A | istemci B |
|---|---|---|---|---|
| AB1 | 309,7 | 334,0 | 182,8 | 189,1 |
| AB2 | 347,0 | 357,8 | 220,6 | 198,6 |
| AB3 | 359,6 | 338,7 | 183,9 | 222,9 |
| AA1 | 330,9 | 321,2 | 180,8 | 178,1 |
| AA2 | 348,1 | 339,9 | 194,5 | 177,5 |

Blok farkları işaret değiştiriyor, A/A aralığında. Fonksiyon düzeyi (24.982 satır, 9 tekrar medyanı): eski seçim
2,9 ms, yeni 2,9 ms (statü → aşama önbelleğiyle; önbelleksiz ilk sürüm 9,4 ms ölçüldü ve düzeltildi).

## Sentetik: üretimsiz çoklu lojistik aşama (`betikler/multi.js`, `ham/sentetik-coklu-asama.json`)

14 vaka (4 aşama ikilisi × 2 tarih sırası, 3 aşama, aynı aşamada iki parsiyel), kod öneri (1) ile (tarih/vasıta/HO
STATUS'u veren segmentten). Değişen: Siparişler 4/14, CP 4/14 (main'de bu vakalarda CP = Siparişler). Hepsi geride kalan
aşamanın daha geç vardığı vakalar (Yükleme+Yol, Yükleme+Gümrük, Yol+Gümrük, Yükleme+Yol+Depoda). 30k fixture'da 0 satır.

## L2 · Electron 44.3.0 (`electron/`)

`ELECTRON_RUN_AS_NODE=1`, `NODE_OPTIONS="--use-openssl-ca --max-old-space-size=3686"`, `--expose-gc`; main `1e101ef` ↔ aday
`2d2d9ba`; 30k seed 7; her örnek taze süreç (`one.js`): kaynak ayrıştırma (ölçülmez) → CP + Siparişler projeksiyon kurulumu
(`buildSharedOrderProjectionRowsFromASAS`) → okuma modeli hazırlığı (`prepareCpRows`) → istemci `rebuildCpLogisticCaches`
(aynı V8; tarayıcı DOM'u ölçülmedi) → birincil seçim tek başına. `run.sh`: 3 ABBA blok + 2 A/A blok. `analyze.js`: blok medyanları.

- Tur 1 (`ham.jsonl`, süreç başına 1 örnek): kurulum −135 / −19 / +81 ms (A/A −15 / −9); prep +68 / +7 / +17 (A/A +24 / −10);
  istemci +15 / −9 / +52 (A/A 0 / −26). Prep yönü belirsiz → tur 2.
- Tur 2 (`ham2.jsonl`, süreç başına 7 tekrar medyanı): kurulum −17 / +51 / +34 ms (~1.800 ms; A/A −23 / +223); prep −26 / +9 / −23
  (~285 ms; A/A −11 / +4); istemci −2 / +1 / +23 (~185 ms; A/A +2 / +6); süreç CPU −404 / −1.184 / −547 ms (A/A +310 / +633);
  seçim fonksiyonu iki kolda 2,5–5,1 ms. Tekrarlanabilir gerileme yok.

## Karar/risk etkisi ayrıntı (`betikler/prio2.js`, `ham/priority-etki-ayrinti.json`)

Gemi 70 / Uçak 15 / TIR 20 transit kuralı, bugün 28.11. Değişen satır = teslimat sonucu ya da risk sebebi değişen.
Örnek satırlar JSON'da (4100023/L02, 4100044/K01, 4100025/B07, 4100027/B07, 4100014/H04, 4100026/H04).

## Risk taraması ve 2a (`betikler/scan.js`, `scan2.js`; `ham/risk-tarama-once.json`, `risk-tarama-sonra.json`)

`scan.js`: main motoru, main satırı ↔ yeni birincil (motor aynı) → STATUS seçimi yüzünden kalkan/eklenen sinyal ve sebep.
`scan2.js`: önce = main motoru + main satırı; sonra = aday motoru (`302fc58`, segment bazlı HANDOVER_PENDING / ANTREPO_DELAY)
+ yeni birincil. Kalkan: HANDOVER_PENDING 2.588 → 0, ANTREPO_DELAY 234 + 212 → 0. Etkilenmeyen 17.279 satırda fark 0.
Kalan: transit kuralı yok / vasıtayı kapsamıyorsa teslimat sonucu EXPECTED/ALREADY_LATE → UNKNOWN (414 satır) — karar bekliyor.
