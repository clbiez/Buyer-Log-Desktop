# INT-03 bağımsız bayt bütçesi teslimi

Dal: `contrib/int03-byte-budget-20261108`.
Başlangıç: `1796193f0a57c7785e7bf9fdb3557e33c550b25e`.
Yardımcı/test/ölçüm kodu: `09975e4976d441da43967b38234d05461a966784`.
Sonraki teslim commit'i yalnız bu belge ve kanıtları ekler.

**Üretime bağlanmadı. INT-03 açık.** Mevcut üretim dosyaları, mevcut testler,
assertion/validator ve i18n baseline değişmedi. İndirme concurrency'si artmadı;
yeni worker yok. PR/merge/rebase/force-push ve TEST/STABLE yayını yok.
Bağımsız incelemeyi root koordine edecek; bu teslim inceleme onayı değildir.

## Devralınan hazırlık

[#899](https://github.com/clbiez/Buyer-Log-Desktop/pull/899) başlangıç ağacında
yoktur. Hazırlık sabit `b2a4a579c5369f59e5cfb9181140a00176d944ef` SHA'sından
salt okunur kullanıldı; dalımıza merge/cherry-pick edilmedi.

- `tests/fixtures/int03-byte-budget/plm-image-memory-fixture.js`, hazırlığın
  `scripts/lib/plm-image-memory-fixture.js` dosyasının **bayt-eşit kopyasıdır**.
  SHA-256: `926c908ce1bc7797635da39c43177105b8588a23ebb4dce9a4f456e8d5f7ef87`.
- Hazırlığın testi ve üç script'i geçici dizine aynen çıkarılıp salt okunur
  yapıldı. Mevcut başlangıç ağacının `server` dizinine bağlanarak çalıştırıldı;
  test veya hazırlık kodu değiştirilmedi. Fixture eşitliği ayrıca doğrulandı.
- Yeni tanı, ikinci kaynak envanteri veya eski bellek kampanyasının tekrarı
  yapılmadı. Tarihsel artifact, pin ve karşılaştırma kuralları değiştirilmedi.

## Yardımcının sözleşmesi

`createByteBudget({ limitBytes })` bir paylaşılabilir instance üretir.
Root aynı instance'ı bütün eşzamanlı sync işlerine enjekte etmelidir. Toplam
limitin varsayılanı yoktur; süreç genelinde konfigürasyon kararı root'a aittir.

- `acquire(bytes, { signal })`: FIFO admission; sığana kadar bekler.
  Tek başına toplamı aşan reservation anında `PLM_IMAGE_BUDGET_EXCEEDED` verir.
- `planImageReservation(options)` ve `acquireImage(options)`: bütün yaşam
  döngüsünün envelope'unu baştan ayırır. Elde Buffer tutarken permit büyütme
  yoktur; iki yarım indirme ek bayt bekleyerek birbirini kilitlemez.
- `permit.checkBodySize(cumulativeBytes)` her chunk tutulmadan önce;
  `checkBodySize(total, { complete: true })` EOF'ta çağrılır.
- `withImage(options, callback)`: callback başarı/hata/iptal ile bittikten
  sonra `finally` içinde bırakır. Callback altındaki bütün asenkron kullanıcılar
  gerçekten bitmiş ve Buffer referansları bırakılmış olmalıdır. Sonuç yalnız
  küçük metadata olmalı; dönen Buffer veya detached promise bu sözleşmeyi bozar.
- `release()` ilk sefer `true`, tekrarında `false` verir. Muhasebe immutable
  snapshot ile okunur; çift release başkasının reservation'ını düşüremez.
- Bekleyen iptal, isteği ve abort listener'ını kaldırır, sıradakini uyandırır.
  Hata `AbortError` / `PLM_IMAGE_BUDGET_CANCELLED` olur. Aktif iptal **erken
  refund yapmaz**: durmayan transport/commit hâlâ Buffer kullanabilir.
- FIFO küçük işlerin eski büyük isteği geçmesini engeller; kullanılabilir
  alan varken de baştaki isteği beklemek bilinçli throughput ödünleşimidir.
  Kuyruk job adaleti veya job önceliği sağlamaz; istek sırasını korur.

### Uzunluk politikası

| Durum | Politika |
| --- | --- |
| Bilinen pozitif Content-Length | Gövde limiti bu değerdir. Fazla byte chunk tutulmadan; eksik byte EOF'ta `PLM_IMAGE_LENGTH_MISMATCH` verir. |
| `undefined`, `null`, boş string | Bilinmeyen uzunluk: `maxImageBytes` tamamı önceden ayrılır. |
| Bozuk, birleşik, negatif, kesirli veya güvensiz sayı | `PLM_IMAGE_LENGTH_INVALID`; bilinmeyen uzunluğa sessiz geçiş yok. |
| Sıfır / boş biten bilinmeyen gövde | `PLM_IMAGE_EMPTY`. |
| Tek görsel tavanını aşan beyan/gövde | `PLM_IMAGE_TOO_LARGE`. Varsayılan tek görsel tavanı mevcut downloader ile aynı: 20 MiB. |
| Bütün reservation toplam bütçeyi aşıyor | Bekletmeden reddet; yalnız başına limitsiz admission istisnası yok. |

Bilinmeyen uzunluklu küçük bir görsel de azami envelope'u toplam bütçeye
sığmıyorsa reddedilir. Örneğin varsayılan 20 MiB cap için yalnız body+concat
40 MiB gerektirir; doğrulama/commit headroom'u ayrıca eklenir. Bu politika
streaming sırasında elde Buffer tutarak reservation büyütmeye tercih edildi.

### Bayt muhasebesi

`B = bilinen uzunluk veya bilinmeyen gövde tavanı`:

```text
reservation = B (gövde/chunks)
            + B (Buffer.concat geçici kopyası)
            + validationCopyBytes
            + commitCopyBytes
```

İndirme, doğrulama, commit kuyruğu ve commit boyunca **aynı tam reservation**
tutulur. Aşama geçişinde alan azaltılmaz. `validationCopyBytes` ve
`commitCopyBytes` sıfırı yalnız ek allocation olmayan yollara uygundur; mevcut
kanonik ingest'in base64/decode ve eski dosya okumasını otomatik kapsamaz.
Somut root gereksinimleri [integration-contract.md](integration-contract.md) içinde.

Bu bir cooperative allocation sözleşmesidir; JS/Node allocator veya RSS için
zorlayıcı tavan değildir. TLS/socket/highWaterMark, native decode, base64 string,
başka işler, fixture üretim scratch'i, GC ve allocator'da bekleyen alan ayrıca
RSS'yi etkiler. Reservation ve RSS birbirinin yerine raporlanamaz.

## Gerçek doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| İlk RED, yardımcı yokken yeni test dosyaları | `MODULE_NOT_FOUND`, exit 1; [red.txt](red.txt). Bu yeni API'nin RED'idir, üretim bütçe davranışının kanıtı değildir. |
| Yeni yardımcı birim testleri | 20/20 PASS; [unit-green.txt](unit-green.txt). |
| Yeni mock pipeline testleri | 9/9 PASS; [pipeline-green.txt](pipeline-green.txt). 2.048 PNG, iki sync, yavaş commit, kısmi hata, iptal ve yanlış uzunluk dahil. |
| İlgili native paket | **22 dosya / 185 test PASS**; yeni 29 test dahil; [native-tests.txt](native-tests.txt). |
| #899 değiştirilmemiş hazırlık testleri | **10/10 PASS**; gerçek kanonik disk yolu, manual/dedup/revision/rollback/dropOldFiles dahil; [preparation-tests.txt](preparation-tests.txt). |
| i18n:check | **0 yeni / 0 baseline**; [i18n.txt](i18n.txt). |

GREEN sonuçlarında fail/skip/cancel/todo=0. Komutlar, fixture pini ve exit
kodları [validation.json](validation.json) içinde. Yeni testlerin doğrudan
koşuları native pakete ek olarak tanı amaçlıdır; toplam sayıya ikinci kez eklenmez.
Filtresiz tam regresyon çalıştırılmadı; nihai entegrasyon kapısı root'ta kalır.

İlk sandbox koşusunda Node `spawnSync` **EPERM** döndürdü. Hazırlık testleri
boş stdout'u JSON olarak okuyup 5/10 hata verdi. Native runner'ın aynı ortamda
gösterdiği 22 dosyalık PASS özeti de güvenilir kabul edilmedi. O denemenin
logları [sandbox-attempt/](sandbox-attempt/) altında korunur. Test/assertion veya
validator gevşetilmeden aynı kontroller sandbox dışında, aynı VM ve ortak
kilit altında tekrarlandı; yukarıdaki sonuçlar bu gerçek child-process koşusudur.

## İzole yardımcı ölçümü

Kod pini `09975e4976d441da43967b38234d05461a966784`; dosya hash'leri ve üç
koşunun medyanları [measurement-summary.json](measurement-summary.json) içinde.
Üç ayrı Node süreci ardışık çalıştı. #899'un aynı 2.048 descriptor'ı,
8/32/128/512 KiB PNG'leri ve toplam 340 MiB verisi kullanıldı. İki eşzamanlı
mock sync, iş başına 4 indirme slotu (toplam 8), 1 ms mock commit gecikmesi;
1.024 gövde bilinen, 1.024 gövde bilinmeyen uzunluklu. Bilinmeyende cap 512 KiB;
validation ve commit için birer gövde boyu kopya ayrıldı.

| Ölçüt | Gerçek sonuç |
| --- | --- |
| Ortak reservation limiti | 4.0000 MiB (4.194.304 byte) |
| Peak reservation, üç koşuda da | 3.5625 MiB (3.735.552 byte) |
| Bitişte reservation / aktif permit / waiter | Üçünde de 0 / 0 / 0 |
| Başarı / byte oracle | Üçünde de 2.048 / eşit |
| Medyan OS peak RSS | 124.59 MiB (130.641.920 byte) |
| Medyan sampled external | 76.29 MiB (79.995.851 byte) |
| Medyan ilk mock tamamlama | 10.08 ms |
| Medyan mock toplam süre | 3.029,30 ms |

Ham çıktılar `helper-run-{1,2,3}.json`, stderr dosyaları da korunur (boş).
OS peak RSS süreç açılışından zamanlanan mock akış sonuna kadarki Linux
high-water'dır. 5 ms timer ve aşama sınırlarıyla örnekleme senkron geçici
zirveleri kaçırabilir. Süre fixture üretimi/CRC, kopya/hash ve mock beklemeleri
içerir; oracle tekrar üretimi zamanlanan pencerenin dışındadır. Gerçek ağ,
disk commit, kanonik link, revision, shared publish veya tarayıcı görünürlüğü
bu ölçümde yoktur. Force GC veya soğuk OS cache iddiası yoktur.

**Üretim before/after karşılaştırması veya RSS kazanımı çıkarılamaz.**
#899'un tarihsel kohortuyla kıyas yapılmadı; onun validator'ı kullanılmadı veya
gevşetilmedi. İlk mock tamamlama ilk kanonik link ya da ilk görünür görsel
değildir. Bu ölçüm INT-03 kabulü ve kapanışı değildir.

## Tekrar üretme

Repo kökünden; #899 commit'i object store'da yoksa önce normal fetch:

```sh
git fetch origin b2a4a579c5369f59e5cfb9181140a00176d944ef
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock \
  env INT03_LOCK_HELD=1 python3 docs/performance-program/contrib-int03-byte-budget-20261108/validate.py
```

Ölçüm için `measure.py` aynı flock komutuyla kullanılır. Mevcut ölçüm çıktıları
üzerine yazmayı reddeder; yeni koşu için script'i yeni kanıt dizinine kopyalayın
(repo altında aynı derinlikte), tarihsel çıktıları değiştirmeyin. Bu VM'de Node
child-process'leri sandbox engellediğinden gerçek kontroller sandbox dışında
çalıştırıldı. Kilit doluysa exit **75**; paralel koşmayın veya kilidi silmeyin.
Bütün test/ölçüm çağrıları bu kilit protokolüyle yapıldı.

Tam yeni dosya listesi: [files.txt](files.txt).

EN: Standalone shared FIFO byte reservations with explicit whole-image envelopes,
strict known-length checks, bounded unknown-length policy and leak-safe scoped
cleanup. No runtime integration, worker, concurrency increase or production
memory improvement claim. Related native tests: 185 pass; unchanged #899 tests:
10 pass; i18n 0/0. Three isolated helper runs are not INT-03 acceptance. Root owns
integration, independent review, final regression and production measurements.
