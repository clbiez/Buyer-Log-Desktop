# Büyük yerel veride açılış — yerel DB büyümesi ve tam yeniden yazımlar (13.11.2026)

Kademe: **L2** (başlangıç + büyük veri + yerel DB yazma yolu). Karar: **PASS** (aşağıdaki sınırlarla).
Main: `fa44780` · Aday: `1b3f4e3` (ölçülen son kaynak) · Ortam: Linux, 4 vCPU, 15 GiB, Node 22.23.4,
yalnız sunucu süreci (Electron/Windows/SMB ölçülmedi).

## Teşhis — gerçek darboğazlar

Kod okumayla değil, `fs` çağrı izleme kancası + CPU profili + olay döngüsü sondasıyla bulundu.

| Bulgu | Kanıt |
| --- | --- |
| Açılışta **yalnız yerel DB** veri boyutuyla ölçekleniyor. 24 veri klasörüne 48.200 dosya konunca sunucu açılışı hiçbirini taramadı (yalnız `write-recovery` 200 girdi). Görseller/cache/log baytları açılışı etkilemiyor. | [Doğrulandı] `harness/fs-trace.js` |
| `/api/data` (ilk ekran) tüm DB'nin parse edilmesini bekliyor; parse ana iş parçacığında (309 MB → ~2,7 sn, 928 MB → ~10 sn). | [Doğrulandı] CPU profili `parseRange`/`JSON.parse` |
| `quarantineLegacyCollectionDeltas` işaret zaten varken bile `transaction()` açıyor; `transaction()` her çağrıda **tüm anlık görüntüyü** yeniden yazıyor. Sonuç: **her açılışta** DB'nin ~3 katı disk yazımı, DB kirasının onlarca saniye tutulması; 928 MB'da **61–68 sn olay döngüsü donması**. | [Doğrulandı] yığın izi `transaction → writeSnapshot`, A/B |
| Yüklenmiş **ve** onaylanmış journal olaylarının tam payload'ı yalnız elle sıkıştırmayla siliniyordu; DB geçmişle sınırsız büyüyor (kodda 295 MB gerçek DB notu var). | [Doğrulandı] kaynak; gerçek kullanıcı DB bileşimi [Bilinmiyor] |
| Sabit 1 MB WAL eşiği büyük DB'de her ~1 MB yazımda tam anlık görüntü yazımı demek. 309 MB DB'de 15.000 küçük yazım: **111 sn, 14,7 sn donma**. | [Doğrulandı] mikro ölçüm |
| 256 MB altındaki DB'de cihaz kimliği için tüm dosya **senkron** okunup parse ediliyor (sunucu dinlemeye başlamadan), sonra aynı dosya yeniden parse ediliyor. | [Doğrulandı] 110 MB'da `statusReady` ~2,1 sn → 0,7 sn |

## Değişiklik

1. Tamamlanmış karantina geçişi ve ilerlemeyen business checkpoint başlıkları artık tam yazım transaction'ı açmaz.
2. **Otomatik journal saklama:** yalnız *yüklenmiş + onaylanmış* ve ilk açık olayın sırasının **altındaki** önek budanır; en yeni 1.000 yerleşmiş kayıt tam kalır; eşik 2.000. Budama zaten yazılan anlık görüntüye eklenir (ek I/O yok); birikmiş geçmiş için arka plan bakımı bir kez çalışır. Kimlikler `syncLedger.eventIds`'te kalır (duplicate/yankı koruması), bekleyen-onay sayısı ve iş verisi hash'i değişmez.
3. WAL döndürme eşiği anlık görüntünün 1/16'sı (1 MB–32 MB, 2.000–20.000 satır). Küçük DB'de davranış aynı. 309 MB + 6,9 MB WAL oynatma: +88 ms.
4. Cihaz kimliği her boyutta önce dosya başlığından okunur.

## A/B sonucu (3 dönüşümlü tur, medyan; ham değerler `ab-*-results.json`)

Fixture: sentetik, tek seferlik geçişleri tamamlanmış uzun ömürlü DB. 1× = 309 MB (40k kayıt, 180k journal, 330k olay);
3× = 928 MB. `cand-first` = yükseltme sonrası ilk açılış (tek seferlik budama dahil), `cand-steady` = sonraki açılışlar.
Pencere: açılış + 60 sn (3×: 90 sn).

| Senaryo | İlk veri (`/api/data`) | DB hazır | Bakım bitti | En uzun donma | Toplam donma (>100 ms) | Disk yazımı | DB boyutu |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1× main | 4,33 sn | 3,86 sn | 33,4 sn | 3,11 sn | 7,09 sn | 926 MB | 309 MB |
| 1× aday ilk açılış | 4,63 sn | 4,01 sn | 8,2 sn | 3,08 sn | 5,73 sn | 528 MB | 110 MB |
| 1× aday kalıcı | **2,23 sn** | 1,76 sn | 5,9 sn | **1,25 sn** | 2,05 sn | **0 MB** | 110 MB |
| 3× main | 14,86 sn | 14,50 sn | 98,7 sn | **64,98 sn** | 81,8 sn | 2.786 MB | 928 MB |
| 3× aday ilk açılış | 13,48 sn | 13,05 sn | 17,5 sn | 11,50 sn | 18,8 sn | 1.585 MB | 328 MB |
| 3× aday kalıcı | **4,90 sn** | 4,47 sn | 9,4 sn | **3,72 sn** | 5,24 sn | **0 MB** | 328 MB |

Ham ilk veri süreleri: 1× main 4329/4077/4571, aday-ilk 4628/3803/4669, aday-kalıcı 2676/2231/1989;
3× main 13639/17703/14859, aday-ilk 13475/13193/13877, aday-kalıcı 4899/4715/5745 ms.

Yorum:
- Main'de veri 3 katına çıkınca ilk veri süresi 3,4×, donma 21× büyüyor; adayda kalıcı durumda 2,2×'e iniyor ve
  dakikalık donma tamamen kalkıyor. Açılışta DB'ye her seferinde yazılan GB'lar sıfırlandı.
- **1× aday ilk açılış ilk veri medyanı +0,3 sn** (4,63 vs 4,33). Ham değerler örtüşüyor (3,80–4,67 vs 4,08–4,57);
  gürültü ile ayırt edilemedi. Yalnız yükseltme sonrası **tek seferlik** açılıştır; kalıcı yol −%48.
- Kalan maliyet: DB hâlâ tek JSON zarfı; açılışta canlı kayıtlar ve uzak olay meta verisi tam parse edilir
  (328 MB'da ~4,5 sn). Bu artık geçmişle değil canlı veriyle ölçeklenir.

## Ek aşama — ilk ekran DB parse'ını beklemez (aday `f567903`)

Açılış sırası: DB konumu → yarım kalmış tam geri yükleme kurtarması → DB yükleme. `/api/data` yalnız ilk ikisini
bekler; DB arka planda kooperatif (≤8 ms dilimler) yüklenir, eşzamanlı yüklemeler tek parse'ı paylaşır.
Aynı protokol, yeni üretilmiş aynı boyutlu fixture (`f5/ab-*-results.json`):

| Senaryo | İlk veri | DB hazır (arka plan) | En uzun donma | Toplam donma | Disk yazımı |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1× main | 4,14 sn | 3,77 sn | 2,90 sn | 6,65 sn | 927 MB |
| 1× aday ilk açılış | **0,82 sn** | 4,97 sn | 1,04 sn | 2,32 sn | 529 MB |
| 1× aday kalıcı | **0,75 sn** | 2,68 sn | **0,54 sn** | 0,55 sn | 0 |
| 3× main | 14,23 sn | 13,87 sn | **61,21 sn** | 77,09 sn | 2.786 MB |
| 3× aday ilk açılış | **0,89 sn** | 15,94 sn | 5,03 sn | 9,49 sn | 1.585 MB |
| 3× aday kalıcı | **0,81 sn** | 7,48 sn | **0,56 sn** | 0,95 sn | 0 |

Ham ilk veri: 1× main 4158/4143/3830, ilk 945/823/799, kalıcı 790/752/655; 3× main 13554/15915/14233,
ilk 806/885/920, kalıcı 792/809/837 ms.

- İlk ekran artık veri boyutundan **bağımsız** (~0,8 sn, 1× ve 3× aynı).
- **Ödünleşim:** DB'nin arka planda tam hazır olması kooperatif parse yüzünden uzar (3× kalıcı: 4,47 → 7,48 sn
  önceki adaya göre). Bu sürede yazım/senkron isteği DB yüklenene kadar bekler; arayüz donmaz.
- Yükseltme sonrası ilk açılıştaki 3,6–5,5 sn donma, tek seferlik budama yazımının serileştirmesidir (928 MB).

## Ölçülmeyen / sınırlar

- Gerçek kullanıcı DB'sinin bileşimi (journal/olay/kayıt oranı) **[Bilinmiyor]**; kazanım oranı ona bağlıdır. Data Maintenance → yerel DB istatistiği bunu gösterir.
- Electron launcher, Windows disk/antivirüs, SMB/OneDrive ortak klasör ve gerçek Shared Hub senkronu ölçülmedi.
- 10 GB'ın DB dışındaki kısmı (görseller, cache, yedek) sunucu açılışında taranmıyor [Doğrulandı]; haftalık Data Temizliği taraması açılıştan 120 sn sonra arka planda çalışır.

## Sonraki adımlar (bu PR'da yok, gerekçeli)

1. ~~İlk ekranı DB parse'ından ayırma~~ — yukarıdaki ek aşamada yapıldı.
2. Uzak olay meta verisi (`events` + `appliedEvents`) sınırsız büyüyor; cihaz başı kesintisiz checkpoint ile sınırlanabilir —
   senkron dedupe semantiği değiştiği için ayrı P1 iş.
3. SQLite (`node:sqlite`) uzun vadeli seçenek; ancak tüm tüketiciler `localDb.read()` ile tam durumu belleğe alıyor.
   Erişim kalıpları sorguya dönmeden yalnız depolamayı değiştirmek parse maliyetini taşır, geri dönüş uyumluluğunu bozar.

## Tekrarlama

`harness/` (sentetik veri; yollar bu oturuma göre, argümanla değiştirilebilir):

```sh
node --max-old-space-size=8192 harness/gen-db.js <root>/local/BuyerLogLocal.db 1   # 3 → 928 MB
node harness/mark-done.js <root>                 # tek seferlik geçiş işaretleri
node harness/ab.js x1 <root> 3 60000             # main worktree ./main-wt + aday, dönüşümlü
```
