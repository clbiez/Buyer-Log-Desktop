# ADMIN-03 — güncel Main güvenlik doğrulaması / current Main security revalidation

**[Doğrulandı] RED sürüyor: 0 PASS / 2 FAIL, skip/cancel 0.** Yalnız mevcut güvenlik bulgusu yeniden doğrulandı. Yetki düzeltmesi, ADMIN-03 performans optimizasyonu, yeni benchmark veya bağımsız inceleme başlatılmadı. #897 taslak ve kabulü bloke kalır. TEST/STABLE yayını yok.

**EN:** Both existing security assertions remain RED on current Main. No authorization fix, performance optimization, new benchmark or independent review was started. #897 remains a blocked draft. No TEST/STABLE publication.

## Kaynak ve çalışma / provenance

- Main: **`63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`**, #885 sonrası #902 entegrasyonu dahil.
- Normal merge commit'i: `2d809546404e3c900f98aa8a9b61dadc45eec031`; ebeveynler `5e76c457531d9ca57556508fb45d3a6db8cfefeb` + yukarıdaki Main. Rebase/force-push yapılmadı. Üretim dosyaları Main ile byte-identical; özel üretim düzenlemesi yok.
- `pending-request.test.cjs` ve `fixture.cjs`, eski `admin-03/` paketinden **byte-identical** kopyalandı. Test SHA-256: `66c228b6e3339f611a793cdbfe6bcb2ed1668919450741d456024e24a442ed32`; fixture SHA-256: `75a6b554bc10bbd20305d517724f1874b0ff17fa5836ba4257d5a73750bf8c28`. Assertion değişmedi. Kopyalama yalnız `__dirname/artifacts` sabit çıktı yolunun eski RED kanıtlarını ezmesini önler.
- Node `v24.19.0`; tek koşu, iki mevcut test. Komut: `node --test docs/performance-program/admin-03-main-63159fb3/pending-request.test.cjs`. Gerçek test süreci exit **1**. `run.json` komut, zaman, SHA ve exit kodunu saklar.
- Eski `admin-03/` paketi ve eski test/fixture dosyaları değişmedi. Eski manifestteki bütün hash'ler yeniden doğrulandı. Yeni kanıtlar yalnız bu dizindedir; ham log kayıpsız `artifacts/pending-request.log.gz` içindedir.
- Bütün auth/server/app/local/portable/config/temp/shared kökleri mevcut fixture'ın `mkdtemp` ile oluşturduğu `/tmp/buyerlog-admin03-*` altındadır. Yalnız sentetik kullanıcılar ve sentetik credential kullanıldı; uygulama sunucusu başlatılmadı ve gerçek veri deposu kullanılmadı.

EN: Main was integrated by a normal two-parent merge. Production files match that Main exactly. Byte-identical copies of the existing test and fixture isolate their hard-coded artifact paths. Assertions, old RED evidence and the old manifest are preserved. The actual test process exited 1. All data and credentials are synthetic and isolated.

## Yeni ve askıdaki istekler / fresh and pending requests

| Mevcut senaryo | Revizyon | Güncel dizinde USER.GRANT | Aynı cookie ile yeni istek | Seçimden sonra askıya alınmış istek | Assertion |
| --- | --- | --- | --- | --- | --- |
| Yerel / local | 7 → 8 | yok / absent | 403, `CAPABILITY_REQUIRED` | `next()` çağrılır | RED: 403 bekleniyor |
| Merkezi / central | 1 → 2 | yok / absent | 403, `CAPABILITY_REQUIRED` | `next()` çağrılır | RED: 403 bekleniyor |

`pendingResult.status=200`, testin **next çağrıldı** sentinel'idir; gerçek endpoint'ten HTTP 200 alınmış demek değildir. Testte kullanılan `/api/admin03-probe`, gerçek bir route değildir. Hiç HTTP endpoint'i veya business/yetki mutasyonu bu istek üzerinden çalıştırılmadı. İptal, ayrı sentetik admin işlemi olarak gerçek `saveStore` / merkezi `commit` yoluyla yapılır.

EN: Fresh requests deny the revoked capability. The previously selected request continues with its copied profile. The recorded 200 is a test sentinel for `next()`, not a real HTTP success. `/api/admin03-probe` is not a deployed route. No endpoint exploit or successful unauthorized mutation was demonstrated.

## Doğrulanan çağrı zinciri / reproduced call chain

1. `loginHandler` gerçek sentetik login/cookie üretir; `requireSelection` → `sessionProfile` → `readStore` + cookie doğrulaması → profilin özel JSON kopyası → `req.currentUser` (`user-access.js:1309–1326,1482–1486`).
2. Mevcut test ilk `requireCapability('USER.GRANT')` kontrolünün geçtiğini sabitler, ardından kontrollü Promise ile **testin eklediği** beklemeyi başlatır.
3. Yerelde `saveStore(next, expectedRevision)`, merkezde `central.commit(next, expectedRevision, moderator)` izni kaldırır; güncel public DTO'da izin yoktur. Aynı cookie ile yeniden `requireSelection` + capability kapısı **403** verir.
4. Bekleyen istek aynı eski `req.currentUser` ile devam eder: `requireCapability` (`user-access.js:1500–1504`) → `iam.hasPermission` → `effectivePermissionSet` → `effectivePermissionDetails` → `assignedPermissionDetails` (`iam-core.js:372–402`). Yeni store kullanılır ancak kişinin doğrudan grant listesi verilen eski profil nesnesinden okunur (`377–385`); iptal edilmiş grant böylece yeniden hesaba katılır ve `next()` çağrılır.

EN: The reproducer combines current store state with a stale copied profile after a deliberately inserted await. Own grants are read from that stale profile. This is a confirmed middleware contract failure on the pinned Main SHA.

## Gerçek route sıralaması — salt okunur inceleme / read-only route tracing

| Hedefli incelenen gerçek yol | Kaynakta gözlenen sıra | Bu RED testin kanıt sınırı |
| --- | --- | --- |
| `/api/iam/permissions/copy` POST; `/api/iam/users/:id/temporary-grants` POST; aynı grant'in DELETE yolu | `server.js:2240` selection → `2241–2243` compute middleware (IAM yolu regex'e girmez, senkron `next`) → `2245–2262` senkron iki middleware → route `2395,2404–2405` capability kapısı → route-local `express.json` → handler. | İncelenen bu yollarda **selection ile ilk USER.GRANT kapısı arasına** testteki Promise beklemesi yerleştirilmemiş. Test gerçek route sıralamasını yeniden oynatmıyor. |
| Aynı IAM yazma yollarının body okuması | `express.json` capability kapısından **sonra** gelir; tamamlanmamış request body IO beklemesi burada oluşabilir. Yerel `centralMutation` kolu doğrudan handler'a geçer (`user-access.js:2339`); ör. `temporaryGrantHandler` eski `req.currentUser` kullanabilir (`2301`) ama ayrıca `canGrant` denetler (`2306`). | Bu, testtekinden farklı **kapı → body bekleme → handler** sırasıdır. Yerel handler'da olası stale-actor riski için route düzeyinde ayrı güvenlik testi gerekir. Bu koşuda böyle bir HTTP deneyi/mutasyon yapılmadı. |
| Merkezi IAM yazma wrapper'ı | `centralMutation` revizyonu kontrol eder ve aktörü güncel base dizininden ID ile yeniden bulup yetkisini denetler (`2342–2350`). Sonra handler/commit await edilir. `central-iam.js:463–472` lease altında authoritative revision ve güncel actor admin kontrolü yapar. | Kaynakta bu ek savunmalar var. İki middleware RED'i bunların aşıldığını veya merkezi yazmanın başarılı olacağını ispatlamaz. Savunmaların bütün yarışları kapattığı da bu testten çıkarılmaz. |
| #885 compute hedefleri: `/api/data`, `/api/page-projection`, `/api/backlog*`, `/api/cp-shared-edit`, `/api/model-images/registry/cp` | `createComputeAccessMiddleware` `prepare` Promise'ını bekler; ardından `profileFor(req)` ile canlı profili yeniden alır ve `req.currentUser`'ı günceller (`compute-access-middleware.js:3–10`, server wiring `2241–2243`). Ayrıca compute read guard `sessionProfile`/`profileById` ile build/response kontrolleri içerir (`compute-read-guard.js:9–16`; server kullanımları `8524–8552`). | Burada gerçek bekleme vardır, fakat bekleme sonrası profil yenilenir. Mevcut test bu middleware/guard'ları çalıştırmaz; compute endpoint'inin aynı biçimde geçildiğini göstermez. |
| IAM import parse yolu | `prepareIamImport`, parser await'inden önce ve sonra `sessionProfile` + güncel store ile `assertAuthority` çağırır (`user-access.js:2218–2225`). | Bu ayrı yeniden yetkilendirme görülür; mevcut test import route'unu çalıştırmaz. |

**[Doğrulandı]** Yukarıdaki sıra ve ek kontroller sabit Main kaynağında görüldü. **[Bilinmiyor]** Bu veya başka endpoint'lerde iptal sonrası yetkisiz HTTP/business işlem sonucunun üretilebildiği; bu görevde route exploitation/HTTP testi yapılmadı. Hedefli inceleme bütün repository'de tüm yarışların yokluğuna dair bir güvence değildir.

EN: In the inspected USER.GRANT routes, the initial gate runs synchronously after selection; body parsing follows the gate. That later IO boundary is different from the reproducer's inserted pre-gate await. Central writes, compute preparation/publication and IAM import contain additional fresh-authority checks. This static review neither proves an endpoint exploit nor establishes that every race is safe.

## Ana sunucu sahibine teslim / server-owner handoff

Sahiplik hedefi: **“Buyer Log sunucu entegrasyonunu sürdür”** sohbetinde kullanıcı tarafından tek uygulama sahibi olarak belirlenen ana sunucu/entegrasyon işi. Bu oturumda sohbetler arası mesaj gönderme aracı sunulmadığından kalıcı teslim mevcut **#885 PR konuşması** üzerinden yapılır; teslim URL'si #897 güncellemesinde paylaşılır. Teslimin yayımlanması sahibin okuyup kabul ettiği anlamına gelmez.

İki ayrı iş:

1. **Yetki güvenliği işi:** Bu iki RED testini mevcut assertion'larla referans al; gerçek route sıralamasında iptal/pasiflik/rol değişiminin mutation/response sınırlarını hedefli doğrula. Düzeltme gerekiyorsa sahibi ayrı güvenlik değişikliğiyle RED→GREEN yapmalı; merkezi güncel-actor/revision ve compute/import yeniden kontrol savunmalarını korumalı. Bu pakette düzeltme yok.
2. **ADMIN-03 performans işi:** Ayrı ve başlamadı. İndeks, request-context paylaşımı, cache veya yeni benchmark bu devam turunun kapsamı değildir. Güvenlik kapısı RED iken #897 merge'e hazır değildir.

EN: Deliver the evidence to the sole server/integration owner through the existing #885 PR discussion; acknowledgement is not assumed. Authorization remediation and ADMIN-03 optimization are separate work items. This task implements neither. The earlier full-regression obligation remains unchanged; no full suite or unrelated validator/benchmark/review was started in this narrow continuation.
