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
