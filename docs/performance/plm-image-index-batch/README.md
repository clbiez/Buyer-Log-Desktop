# PLM görsel indeksi parti yazımı — L2 kabul kanıtı

**Kademe:** L2 (sıcak yol + büyük veri: PLM görsel alımı, 25.000 kayıtlı indeks).
**Karar:** PASS (bu Linux cloud konteynerinde). Windows/NTFS/Defender ölçülmedi.

## Senaryo

`bench-ingest.js`, kanonik PLM alım yolunu (`plm-image-ingest.commit`) sunucunun
gerçek görsel deposu bağlantısıyla çalıştırır:

- **main:** `saveCollectionImage` (görsel başına senkron indeks yazması).
- **aday:** `saveCollectionImageDeferred` + `flushCollectionImageIndex` bariyeri.

Sabitler: sentetik 25.000 kayıtlı `index.json` (pretty-print, 9 MB), 30 KB JPEG
başlıklı yükler, `patchLinks` bellek içi sahte (iki tarafta aynı; imagemap
yazma maliyeti ölçülmez). Her koşu yeni süreç ve sıfırdan veri dizini;
dönüşümlü sıra: main, aday, main, aday, main, aday.

Ölçülenler: toplam commit (+ son flush) süresi; en uzun olay döngüsü bloğu
(1 ms aralıklı `setInterval` sondasının en büyük boşluğu); fs çağrı sayısı
(senkron + `fs.promises` sarmalanarak).

## Sonuç (3 dönüşümlü çift, ham değerler / medyan)

| Görsel | Taraf | Toplam ms | En uzun blok ms | fs çağrısı |
|---|---|---|---|---|
| 12  | main | 2330 / 2022 / 2065 — **2065** | 2330 / 2022 / 2065 — **2065** | 785 |
| 12  | aday | 166 / 180 / 201 — **180** | 24 / 30 / 35 — **30** | 99 |
| 500 | main | 79991 / 77327 / 79380 — **79380** | 79991 / 77327 / 79380 — **79380** | 31529 |
| 500 | aday | 1027 / 945 / 1041 — **1027** | 31 / 32 / 23 — **31** | 2051 |

Veri eşdeğerliği: her koşuda diskteki indeks 25.012 / 25.500 kayıt; içerik
eşdeğerliği `tests/collection-image-index-batch-v8015.test.js` içinde eski
senkron yolla alan alan karşılaştırılır.

Önceden belirlenen bütçe (görev): tek blok ≤ 200 ms ve görsel başına ana iş
parçacığı süresinin indeks boyutundan bağımsız olması. Aday en uzun blok
≤ 35 ms; indeks commit başına bir kez yazılır (`index.json` hedefli rename
sayısı testte 40 görsel için main 40, aday 1), bu yüzden görsel başına maliyet
indeksle büyümez: adayda sabit maliyet tek indeks yazmasıdır, 500 görselde
toplam ~2 ms/görsel (main: ~159 ms/görsel).

## Komut

```
node bench-ingest.js <appRoot> <boş-veri-dizini> 25000 <12|500> <etiket>
```

Ham çıktı: `results.jsonl`.
