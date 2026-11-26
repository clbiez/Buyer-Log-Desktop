# Görsel olarak kopyala — L2 performans kabulü (2026-11-26)

Main: `ca97568` · Aday: `claude/modest-rubin-bbmqvr` · Ortam: Linux cloud container, Playwright Chromium (headless), sentetik demo veri (`generate-demo-data.js --rows 2000 --seed 7`), 1440×900. Electron/Windows ölçülmedi.

Etkilenen sıcak yollar: `renderFullTable` (tek özellik ataması `table._blBuildRow=buildRow`) ve `renderKol` (satır döngüsü gövdesi `buildKolRow` fonksiyonuna taşındı; iş aynı).
Yeni özellik yalnız kullanıcı eylemiyle çalışır; açılışta ek iş, ağ veya polling yok.

## Koleksiyon `renderKol()` — 1000 model, tek sayfa (`ab-render.js`, 3 dönüşümlü çift, koşu başına 5 örnek)

| Çift | Main medyan (ms) | Aday medyan (ms) |
| --- | --- | --- |
| 1 | 3464.2 | 3407.2 |
| 2 | 3636.9 | 3260.6 |
| 3 | 3413.6 | 3297.9 |

Karar: gerileme yok (PASS).

## CP `renderCPNow()` — 2000 satır (`ab-cp.js`, A/A + 3 dönüşümlü çift, koşu başına 20 örnek)

İlk turda (5 örnek) aday her çiftte daha yavaş göründü (106→117, 104→117, 91→98 ms); değişiklik tek bir özellik ataması olduğundan A/A ile gürültü ölçüldü.

| Koşu | Medyan (ms) |
| --- | --- |
| A/A Main A | 103.4 |
| A/A Main B | 95.6 |
| Main / Aday 1 | 98.1 / 98.3 |
| Main / Aday 2 | 92.8 / 98.5 |
| Main / Aday 3 | 97.4 / 103.0 |

Toplu medyan: Main 96.75 ms, aday 98.6 ms (+1.9 ms). A/A aralığı 7.8 ms; fark gürültü içinde. Karar: PASS.

## Yeni özellik bütçesi (ölçülen, aday)

| Senaryo | Süre |
| --- | --- |
| CP 4 satır × ~80 sütun (8150 CSS px) panoya | ~0.3 s (ilk kullanımda tam satır yüklemesiyle 1.8 s) |
| CP 17 satır | ~1.0 s |
| Koleksiyon 2 model / 3 hücre satırı | 0.5–0.8 s |
| CP 60 satır PNG dosyası (14323×4467 px, 6.2 MB) | 2.4 s |

Ham sonuçlar: `ab-render-results.jsonl`, `ab-cp-results.jsonl`. Komut: `CHROMIUM_PATH=<chrome> node ab-cp.js <appDir> <etiket>`.
