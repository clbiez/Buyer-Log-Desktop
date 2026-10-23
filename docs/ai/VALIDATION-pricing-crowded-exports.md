# Fiyatlama doğrulaması / Pricing validation — 2026-10-23

Kaynak başlangıcı / Starting source: `claude/blissful-hopper-d0x696`, `0130ebde`.
Güncel main (`563b6196`) geliştirme dalına alındı. / Current main was merged into the working branch.

## Gerçek uygulama / Real application

Gerçek `server/server.js`, ayrı demo veri kökü, `127.0.0.1:6288`, sistem Chromium ve Playwright ile çalıştırıldı. Gerçek şirket, kullanıcı veya fiyat verisi kullanılmadı. PNG'ler değişiklikler uygulandıktan sonra doğrudan Buyer Log sayfasından çekildi; görsel üretimi, mockup veya component preview kullanılmadı.

The real server ran with an isolated demo data root. Playwright drove system Chromium at 1600 × 950 with reduced motion and clipboard permissions. Captures show the actual application with synthetic data.

- Ctrl+C / Ctrl+V: TR Landed kaynağı `400 TL / 40 / 1.05` hedefe aynı girdilerle taşındı; hesaplanan `10.50 USD` TL fiyatına yazılmadı.
- Ctrl+D: ilk satırın girdileri iki hedef satıra uygulandı; önizleme ve tek geri alma akışı korundu.
- Dış değer / External value: `650` yalnız `trPrice` alanına yazıldı, kur ve çarpan korundu.
- 30 model × 20 üretici / manufacturers: 600 satırlı tek talep, üretici karneleri, `Diğer (11)`, aç/kapat ve kaydırma sırasında dört sabit özet sütunu doğrulandı.
- 6 model × 20 üretici: 120 satırlı talepte fiyatı değiştirip fareyle onaylama ve talep bazında açma tercihi doğrulandı.
- Turlar / Rounds: 30 model grubu altında üretici teklif çipleri; Analiz / Analysis: 12 ↔ 20 üretici geçişi ve rekabet sırası doğrulandı.
- TR ↔ EN dil değişimi aktif Fiyat Masası'nı yeniden çizdi; açık, Kurşun ve koyu temalar kontrol edildi.
- Koleksiyon / Collection: Maliyet girdileri düzenlenebilir ayrı sütunlarda; 20 teklif için tek dağılım bandı, ortanca, hedef ve en iyi/onaylı işaretleri doğrulandı.
- Satır kopyası / Row copy: ayrı fiyat ayrıntı başlıkları TSV/HTML kopyasında doğrulandı, hücre aralığı kopyası görünür DOM sütunlarını kullanmaya devam ediyor.
- İndirilen gerçek XLSX'ler / Downloaded real XLSX files: TR `Koleksiyon` + `Teklifler`, EN `Collection` + `Quotations`; 6 model × 20 üretici, 28 teklif sayfası sütunu, sayısal fiyatlar ve onaylı `8.25` fiyatı doğrulandı. Mevcut status doğrulama listesi `veryHidden` sayfada kaldı (iki görünür sayfa).

## Testler / Tests

- 77 hedefli test / targeted tests: geçti / passed.
- Kumaş kartı kopyası / fabric clipboard: 3/3 geçti; görünen özet ve ham PLM verisinin TR Landed işaretiyle aynı matriste korunması çalışan fonksiyonda doğrulandı.
- Yeni testler / new tests: ayrıntı çapaları ve folds, gizli çapalar, tekrar eden girdiler, para biçimi, iki aşamalı TR Landed doğrulaması, çakışan kaynak anlık görüntüsü, dış TL yapıştırma, bağlı alan kilidi, sayısal kur/çarpan doğrulaması, TR/EN teklif sayfası değer/biçimleri, rekabet sırası ve katlama.
- `release:notes:validate`: 48 kayıt / changes, geçti / passed (bu görev için 7 TR/EN kayıt eklendi).
- `i18n:check`: 0 yeni eksik / new gaps, baseline 0.
- Tam `npm test` / full suite: **7197 geçti / passed, 0 hata / failures, 65 atlandı / skipped**; 1007 dosya, 5 batch, 162.2 saniye. İlk tam koşuda kumaş kartı kaynak-sözleşme iddiası WIP satırına bağlıydı; koruduğu ham PLM veri gerekçesi korunup çalışan matris testi eklendikten sonra tam suite geçti.
- Tek bağımsız inceleme tamamlandı / one independent review completed: sayısal girdi doğrulaması ve odak kaybında erken yeniden çizim bulguları düzeltildi.

TEST/STABLE workflow'u tetiklenmedi. Sürüm/immutable dal değişmedi. / No TEST/STABLE workflow was dispatched; no version or immutable branch was changed.

## Ekran görüntüsü kanıtı / Screenshot evidence

Tüm görseller 1600 × 950 kayıpsız PNG, post-change gerçek uygulama görüntüsüdür.

| Dosya / File | SHA-256 |
| --- | --- |
| [tr-landed-input-copy.png](../../resources/app/public/release-notes/next-assets/tr-landed-input-copy.png) | `52cb21fe3322f9dd2e1a61b1382947742e11282e8707ef1d9f5d2cdb60f1727b` |
| [collection-cost-details.png](../../resources/app/public/release-notes/next-assets/collection-cost-details.png) | `c43b1a36aaded85c87b2e6ded7e36ab6df082f159b68383f409d7f18bc4c2677` |
| [pricing-crowded-desk.png](../../resources/app/public/release-notes/next-assets/pricing-crowded-desk.png) | `12717cfbbcd44827bce91702b2bb7e560e02a1a099a046be32fc307dd02e43c7` |
| [pricing-folded-other.png](../../resources/app/public/release-notes/next-assets/pricing-folded-other.png) | `50fff23d396009b59859447c7dcda70ae668719bcd204ffeec321743ac1b7742` |
| [collection-offer-band.png](../../resources/app/public/release-notes/next-assets/collection-offer-band.png) | `5802ef72c9d1e5cdc703ecbaaccbc36ab2e385e8feb9ae70615ba6461734b047` |
| [pricing-model-rounds.png](../../resources/app/public/release-notes/next-assets/pricing-model-rounds.png) | `0bb2219ba5de00358e7f8c398af41eeda759787c0e2ac1f755f9167152c325cf` |
| [pricing-competitive-analysis.png](../../resources/app/public/release-notes/next-assets/pricing-competitive-analysis.png) | `963b6911b8759a1bd02a4a2114bded17e41371083d49cc43d44ace009f36b5aa` |
| [pricing-crowded-grey.png](../../resources/app/public/release-notes/next-assets/pricing-crowded-grey.png) | `b4772aa93fcc51b0c83f0a4d3f3dcd3613324c78d2f1a268fa9ecb0aaff0e3b4` |
| [pricing-crowded-dark.png](../../resources/app/public/release-notes/next-assets/pricing-crowded-dark.png) | `14b6c6382f481d5b6a8a5640f1551b740f58d39825e2e790ddf9e1d28d0543f6` |
| [pricing-crowded-en.png](../../resources/app/public/release-notes/next-assets/pricing-crowded-en.png) | `9279105d330861198ccb63c476630070fa6ebe2d720b1d7e859115df3b297a11` |
| [pricing-six-models.png](../../resources/app/public/release-notes/next-assets/pricing-six-models.png) | `1c5c09b26410f1d2938ed2f509a02a3144be5459e67d50a08052ba0c005017d4` |
