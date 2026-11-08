# Buyer Log Faz6b / SHELL-06 katkı teslimi

TR: Helper hazırlığıdır; üretime bağlanmadı, Faz6b kapanışı değildir.
EN: Helper preparation only; unwired and not phase acceptance.

Baz kabul edilen Main `1796193f0a57c7785e7bf9fdb3557e33c550b25e`;
dal `contrib/shell06-revision-poller-20261108`. 6a/import ve diğer katkılar
uygulanmadı. Risk P1 senkronizasyon sınırı; üretim bağlantısı ve tek bağımsız
P1 incelemesi ana sohbette kalır. Bu katkıda ikinci agent/reviewer kullanılmadı.

## Teslim

- `resources/app/public/shared-revision-poller.js`: tek in-flight GET/JSON,
  AbortSignal, leader/context stale guard, catch-up, bounded backoff, revision
  whitelist ve yerel context doğrulaması. Lider seçimi, BroadcastChannel,
  EventSource, worker, disk cache veya permission cache yaratmaz.
- `resources/app/tests/shared-revision-poller-{lifecycle,adapter}.test.js` ve
  iki özel fixture: yeni davranış + gerçek Main poll/SSE/consumer blokları.
  Mevcut test, assertion, timeout, validator veya baseline değiştirilmedi.
- `scripts/prototypes/shell06-revision-poller-20261108/`: hedefli source
  çıkarıcı, iki blokluk exact-edit recipe, gerçek Chromium ölçüm/lifecycle
  harness'i ve tam sonuç/eşdeğerlik raporlayıcısı. Tam app-main kopyası yoktur.
- [ADAPTER.md](ADAPTER.md): route, asset yükleme sırası, kesin caller edit'leri,
  context portu ve teardown/fallback sözleşmesi.
- [MEASUREMENTS.md](MEASUREMENTS.md): yalnız `verified-*` final ölçümleri;
  [ham özet](evidence/verified-summary.json) ve tek tek JSON/loglar.
- [FILES.md](FILES.md): commit kapsamının kesin dosya listesi ve salt okunur
  üretim dosyalarının SHA-256 doğrulaması.

## Hedefli doğrulanan kaynak

- `app-main.js:15297–15306`: her renderer'da bağımsız 2500ms başlangıç,
  `setInterval(...,7000)`, in-flight/visibility guard yok. İlk snapshot baseline
  olur; yalnız entity revision artışı event üretir.
- `app-main.js:38863–38949`: mevcut `initLiveSync`, `buyerlog-live-sync`
  kanalı ve `buyerlog-live-sync-leader` Web Lock'u. API eksikse eski per-page
  SSE fallback var. Lock promise'i hiçbir zaman çözülmüyor; explicit teardown
  kancası yok. Recipe mevcut lock'un çözücüsünü tutar, başka seçim eklemez.
- `app-main.js:38950–38989`: mevcut gap resync ve `bl-shared-revision`
  consumer'ları gerçek kaynak olarak aynen çalışır. Quotation her revision'da
  refresh ister; bazı consumer'lar SSE bağlıyken redundant refresh'i atlar.
- `server.js:9404`: `/api/shared-revisions` no-store ile
  `sharedRevisionStore.read()` sonucunu döner. Store schemaVersion 1,
  global revision ve entity başına revision/updatedAt + metadata tutar;
  metadata actorId/deviceId/ownerId içerebilir (`server.js:739,3820`). Helper
  bunları kanal/event payload'una taşımaz. Wire şeması değiştirilmedi.
- `user-access-ui.js:60–96`: ayrı 5sn current-user kontrolü + focus/IAM yolu
  korunur. Revision değişmedi diye grant expiry/revoke yok sayılmaz.
- `overview-global-flow.js:2084`: mevcut native workspace `onTabActivity`;
  `electron/preload.js:45` callback cleanup fonksiyonu döner. Recipe bunları
  abonelik temizliğiyle kullanır. Heartbeat/goodbye ayrı kalır.

## Test ve RED→GREEN kanıtı

Final yeni test sonucu **28 PASS / 0 fail/skip/cancel**, `evidence/verified-targeted.tap` içindedir. İlk helper
olmayan RED, değiştirilmemiş gerçek Main'deki adapter RED'i, iki sonradan
bulunan context regresyonu ve düzeltilmiş GREEN kayıtları korunur.
[Ön koşuların açıklaması](evidence/attempts.md) başarısız/harness kaynaklı
sonuçları final sonuçlardan ayırır.

`chromium-lifecycle-verified-green.json` gerçek Web Locks/BroadcastChannel ve
EventSource ile lider kapatma, pending JSON sırasında actor/source/authority
abort'u, offline/online, 503 backoff, SSE reconnect, sentetik native activity,
grant expiry/renewal ve teardown'u kapsar. VM testleri dispose, BFCache,
unsupported-API/asset fallback, timeout, geç/abort'a uymayan JSON, mesaj
whitelist/replay ve context'in share/receive sırasında keşfini de kapsar.

Normal runner’da seçilen 6 dosya **73 PASS / 0 fail/skip/cancel** (28 yeni +
45 mevcut kontrol). Entegre tam paket değildir. Son Chromium lifecycle
**17 başlatılan / 11 başarılı tamamlanan / 5 iptal / 1 HTTP 503** GET kaydetti;
revision 1–5 ve consumer çıktıları kalan iki sayfada birebir eşit.
İlgili testler ve i18n sonuçları `evidence/existing-tests.log` ve
`evidence/i18n.log` içinde teslim edilir. i18n sonucu **0 yeni eksik / 0 baseline**; baseline boş ve Main ile aynıdır.
Görünür üretim/UI davranışı eklenmedi; release-note/PNG üretilmedi. TR/EN,
Motion+ ve reduced-motion üretim sözleşmeleri değişmedi; yeni animasyon yok.
`git diff --check` exit 2: byte olarak korunan ham RED loglarının boş
satırları ve ölçülmüş `measure.cjs:67` boş satırında whitespace uyarısı.
Ölçülen hash ve özgün hata logu baytları korunmuştur; validator ayarı veya
assertion gevşetilmedi. Ham çıktı `evidence/diff-check.raw.log.gz` ve kısa durum
`evidence/diff-check.json` içindedir. Bu mekanik kontrol GREEN diye sunulmaz.
Entegre tam npm test çalıştırılmaz; bu adım ana sohbette son entegre kod içindir.

## Yeniden üretim

Playwright ve `/usr/bin/chromium` bu VM'de önceden vardı; dependency veya lockfile
değişmedi. Repo kökünden, diğer ölçümler bittikten sonra çalıştır. Aynı VM'de
ölçüm/testleri belirtilen tek kilit altında seri tut; exit 75 meşgul demektir,
kilidi silme veya başka kilit dosyasına geçme. Yeni koşu için benzersiz etiket
kullan; var olan başarısız JSON/logları koru. Aşağıdaki yollar yalnız demo:

```sh
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock bash -c '
  set -e
  node --test --test-reporter=tap resources/app/tests/shared-revision-poller-*.test.js
  SHELL06_LIFECYCLE_TAG=rerun-01 node scripts/prototypes/shell06-revision-poller-20261108/lifecycle.cjs
  SHELL06_RUN_TAG=rerun-01 node scripts/prototypes/shell06-revision-poller-20261108/measure.cjs baseline
  SHELL06_RUN_TAG=rerun-01 node scripts/prototypes/shell06-revision-poller-20261108/measure.cjs pairs
  SHELL06_RUN_TAG=rerun-01 node scripts/prototypes/shell06-revision-poller-20261108/report.cjs
'
```

Komutlar refresh POST yapmaz veya retry etmez. Harness sadece 127.0.0.1'de
sentetik revision/SSE verisi sunar; gerçek servis/credential/iş verisi yoktur.
Chromium varsayılan headless timer davranışı gerçek arka plan/native-tab
throttling kabulü değildir. Kilit altında yapılacak mevcut testler:

```sh
cd resources/app
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock npm test -- shared-revision-poller multi-tab-live-sync live-sync-v644 shared-revision-store-eperm i18n-coverage-guard
flock -n -E 75 /tmp/buyerlog-performance-measurement.lock npm run i18n:check
```

## Ana sohbetin kalan işleri

1. Kanonik güncel actor/source/authority + expiry/revoke context portunu
   bağlamak. Üretimde bu üç alanı birlikte sunan mevcut export doğrulanmadı;
   örnek portu gerçek API diye değerlendirme. Port yoksa helper fail-closed.
2. Helper asset'ini mevcut version/loading yoluna eklemek; ardından iki
   exact-edit bloğunu entegre Main üzerinde yeniden doğrulamak. Burada hiçbir
   mevcut üretim dosyasına yazılmadı; helper uygulamaya bağlanmadı.
3. Filtresiz entegre tam npm test; gerçek Buyer Log/browser/native
   WebContentsView/Electron, gerçek yetki expiry/revoke, arka plan/freeze ve
   gerçek kaynak/store reset kabulü. Loopback harness bu kabulün yerine geçmez.
4. Son üretim diff'inde tek P1 incelemesi. Mevcut #916 motor/guard sınırları
   korunacak. Bu katkı bağımsız review, PR, merge, rebase/force-push veya
   TEST/STABLE yapmaz. Yalnız normal branch push ve uzak SHA doğrulaması.
