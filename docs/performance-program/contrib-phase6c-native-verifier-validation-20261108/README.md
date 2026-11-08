# Faz 6c native verifier doğrulaması / candidate validation

**Sonuç: Linux aday doğrulaması tamamlandı; üretim entegrasyonu ve 6c aktivasyonu yapılmadı.**

Son adayla **80/80** doğrulama testi ve **101/101** mevcut hedefli native
regresyon testi geçti; skip/cancel yok. Özgün 22 test geçti, ancak ek kontrollü
testler son async lease kontrolünde üç proof açığı buldu. Yalnız prototip aday
kopyası düzeltildi. [Başarısızlık ayrımı](FINDINGS.md), [tam dosya listesi](FILES.txt),
[kaynak pinleri](SOURCE-PINS.json), [yeniden çalıştırma](../../../scripts/prototypes/phase6c-native-verifier-validation-20261108/README.md).

## Sabit girdiler ve kapsam

| Girdi | Commit / SHA-256 |
| --- | --- |
| Main bazı | `1796193f0a57c7785e7bf9fdb3557e33c550b25e` |
| Committed-source katkısı | `7652f3d294f3a530a28938eff81cbe477c5a0884` |
| Taşınan hazır paket | `82919980e3d2b4c29d05c1d2c27050448ab3e1f3` |
| Özgün aday | `9447f6fd563a6271c382bcdc817fbdcd1c986c007ef0b62943f8bffdd53f7125` |
| Düzeltilmiş prototip aday | `4223e61261329865ec6fa0c8097a1a9f10d8d34d269aa7a12440120119c9092d` |

Dal: `contrib/phase6c-native-verifier-validation-20261108`. Ayrı worktree:
`/workspace/scratch/buyerlog-phase6c-native-verifier-validation-20261108`.
`CLAUDE.md` ve `AGENTS.md` okundu; hedefli kaynak doğrulaması yapıldı.
Disk/bellek kontrol edildi; yalnız sentetik, izole temp kökleri kullanıldı.

Başlangıçtaki `/tmp` paket yolu yoktu. İlk kontrol `evidence/preflight.*` ve
`evidence/initial-input-source-pins.json` içinde tarihsel olarak korundu;
test RED'i değildir. Kullanıcının verdiği Git paketi cherry-pick edildi.
Paket **yeniden üretilmedi**. Portable manifestteki dokuz dosya doğrulandı;
tarihsel `MANIFEST.sha256` içindeki `/tmp` yolları aynen kaldı.
README'deki üç gerçek kaynak pini bazdaki baytlarla eşleşti: local DB
`0809943a…`, shared lease `c97b7595…`, durable recovery `ae283d14…`.
README'nin tarihsel HEAD farklılığı bu dosyalarda source drift oluşturmadı.
Paket hash'leri güncellenmedi.

Tüm yazmalar izinli iki dizindedir. `resources/app/` altında üretim, compute,
test, assertion, timeout, validator veya boş i18n baseline değişikliği yoktur.
Yeni worker/migrasyon kurulmadı. Hazır paket ve katkı testleri dondurulmuş
girdilerdir; uyarlamalar ayrı prototiptedir.

## Gerçek API ve düzeltme

`stage-committed-source.cjs` pinli katkının iki modülünü, üç test girişini,
üç fixture'ını ve native27'nin özgün test girdisini prototipte taşır.
`committed-source/PROVENANCE.json` özgün/staged hash'leri kaydeder. Testlerin
baytları ve assertion'ları değişmedi. Yalnız Linux fixture doğrulayıcısı gerçek
API delegasyonuyla değiştirildi:

```js
verifyDurability: ({ db, state }) => db.verifyPrivateRecordDurability(state)
```

Üç locator köprüsü gerçek baz bağımlılıklarını ve seçilen aday loader'ını kullanır.
Loader aday kaynağı gerçek native dosya konumunda derler; crash child da seçimi
miras alır. Başarılı no-op doğrulayıcı veya yutulan sync/close/lease hatası yoktur.
Mevcut olumsuz testlerin kasıtlı hatalı proof enjeksiyonları korunur.

Ek test aynı DB ve prepare state nesnesini, gerçek lease token/generation'ını
ve fence dosyasını gözler. Verifier sırasında ek lease admission yoktur;
refresh'in mevcut native transaction'ı tek lease alır. Sağlıklı duplicate
snapshot/current/previous-WAL baytlarını, global/row revision, local sequence ve
journal'ı değiştirmez. Yeni commit mevcut tek native frame'i üretir.

`candidate/final-proof.patch` yalnız son async lease kontrolünden sonra senkron
lease/member-generation/recovery-intent denetimini ekler; proof'a kadar yeni
await yoktur. Üretime veya hazır pakete uygulanmadı. Ayrıntı: [FINDINGS](FINDINGS.md).

## Gerçek test sonuçları

Her gerçek test/ölçüm dış ortamın ortak
`flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` kilidi altında
çalıştı. Kilit silinmedi. Her koşunun ayrı stdout/stderr/exit-code dosyası korundu.

| Koşu | Sonuç | Kanıt öneki (`evidence/`) |
| --- | --- | --- |
| Özgün native taslak | 22 geçer | `native-original` |
| Özgün aday + gerçek API: source 11, delta 10, native27 27 | 48 geçer | `committed-original` |
| İlk ek boundary fixture'ı | 6 geçer / 3 başarısız; fixture ayrımı FINDINGS'te | `boundaries-original` |
| Current WAL fixture düzeltmesi, ara koşu | 8 geçer / 2 başarısız; enjeksiyon henüz daraltılmamış | `boundaries-fixture-corrected-red` |
| Yalnız gerçek verifier içindeki son-await enjeksiyonu, özgün aday | **7 geçer / 3 RED** | `boundaries-scoped-red` |
| Düzeltilmiş aday, aynı 22 + 48 + 10 boundary | **80 geçer / 0 başarısız** | `candidate-final` |
| Mevcut 13 hedefli native DB/recovery/lease dosyası | **101 geçer / 0 başarısız** | `native-regressions` |

Regresyonda `load-candidate.cjs` yalnız test sürecinin module cache'ine adayı
bağlar; mevcut test kaynakları aynen çalışır. Bu son tam uygulama regresyonu
değildir. Source/membership/generation, lost ACK, append fsync EIO, cold replay,
aynı ID ile retry ve farklı intent reddi; old WAL, partial tail, gerçek recovery
intent, sync/close/lease hataları bu kanıtlarda yer alır.

## Ayrı verifier maliyeti

Linux Node `v24.19.0`, sentetik veri, 3 warmup + her hücrede 20 örnek.
Yalnız gerçek verifier çağrısı zamanlandı; lease admission/cleanup dahil süre
ayrı `nativeBoundaryMs` alanındadır. Zamanlanan örneklerde I/O wrapper'ı yoktur;
ayrı çağrı gerçek read/sync sayılarını gözler. Ham örnekler, CPU süreleri,
filesystem ve kaynak hash'i `evidence/verifier-cost.stdout.json` içindedir.

| Kayıt | WAL düzeni | Verifier medyan / p95 (ms) | Okunan bayt |
| --- | --- | --- | --- |
| 100 | current | 4.13 / 6.52 | 26,580 |
| 100 | previous + current | 4.03 / 8.24 | 52,820 |
| 1,000 | current | 12.26 / 16.54 | 262,380 |
| 1,000 | previous + current | 10.57 / 12.60 | 524,420 |
| 10,000 | current | 112.34 / 133.61 | 2,638,380 |
| 10,000 | previous + current | 122.88 / 149.40 | 5,276,420 |

Current düzeninde 2 dosya + 2 dizin, previous/current düzeninde 3 dosya +
2 dizin sync edildi. Ölçüm öncesi/sonrası native üye hash'leri ve revision
değişmedi. Tek container, sıcak cache ve sentetik dosyalardan hızlanma veya
production latency kabulü çıkarılmadı. Normal yeni append'e eklenen scope/tag
maliyeti ayrıca ölçülmedi.

## Kalan adapter gereksinimleri

- Düzeltilmiş adayın üretim entegrasyonu, son tam regresyon ve P1 incelemesi
  ana sohbette kalır.
- Windows/Electron için gerçek file/directory flush desteği veya açık native
  platform politikası doğrulanmalı. Unsupported sync hataları proof üretmez.
- Native torn-tail recovery'nin sakladığı bozuk `.wal.bak` ve native private
  conflict replay farkı için mevcut üretim davranışı kararı gerekir.
  Verifier bunları onarmaz veya eski JSON'a dönerek proof üretmez.
- Muhafazakâr schema doğrulaması ve klasörde başka DB'ye ait pending intent
  için tüm legacy/platform/workload uyumu bu Linux koşularıyla kanıtlanmadı.

SIGKILL/process-exit elektrik kesintisi dayanıklılığı kanıtlamaz.
PR, merge, rebase/force-push, bağımsız inceleme ve TEST/STABLE yayını başlatılmadı.

EN: The revised prototype passed 80 candidate/integration cases plus 101 existing
targeted native regressions on Linux. The frozen packet and assertions remain
unchanged. Three final-await generation/recovery proof gaps were fixed only in
the prototype. Fixture problems and existing native behavior are separated in
FINDINGS. Synthetic costs are reported without a speedup claim. Production,
Windows/Electron policy, full regression and P1 review remain open; 6c is inactive.
