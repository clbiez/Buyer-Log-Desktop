# Sınırlı, sahip olunan JSON sınırı / Bounded owned JSON boundary

8 Kasım 2026. Faz 6a hazırlık/entegrasyon adımı. Public thin henüz kapalı;
son uygulama ve performans kabulü değildir.

[Doğrulandı] Native `/orders/ready` cache hit ve ordinary-full miss yanıtlarına
`X-Orders-View-Json-Bytes` eklendi. Değer gönderilen aynı lease'in mevcut
`uncompressedBytes` metadata'sıdır. Gzip gövdesi, cache, worker işi, kaynak okuma,
yetki ve son-response guard değiştirilmedi. Gzip `Content-Length` açılmış JSON
boyutu yerine kullanılmaz. Exact iki header eklemesi geri alınınca önceki router
byte olarak aynıdır; önceki client pinleri ve test dosyaları ayrıca korunur.

Yeni `orders-owned-json.js`, mevcut `orders-full-promotion.readDecodedBytes`
ile aynı 128 MiB sınırını kullanır; önce exact decoded length admission, sonra
tek sahip olunan byte tamponu, raw SHA, fatal UTF-8 decode ve tek `JSON.parse`
uygular. `response.json()`/`response.text()` ikinci veya sınırsız graph yolu yoktur.
Kaynak güncelliği ve abort her async sınırdan sonra doğrulanır. Async guard izin
sayılmaz; reddedilen promise drain edilir. Result ownership özel WeakSet ile
izlenir; bu sahiplik yetki veya completeness kanıtı değildir. Client'ın gerçek
server binding, schema, plan ve satır doğrulamaları ayrıca zorunludur.

RED: eski yanıtta exact boyut header'ı yok (**0 PASS / 1 FAIL**). Yeni reader'ın
ilk `res.json()` gövdesi truncation, boyut bütçesi ve önceden iptal edilmiş istek
testlerinde **0 PASS / 3 FAIL** verdi. Ortak bounded reader bağlantısı sonrası
ilk native paket **59 PASS**. Ek gerçek gzip HTTP→owned parser testiyle birlikte
son native paket **199 PASS**, fail/skip/cancel **0**. i18n **0/0**, syntax PASS,
50 release-note kaydı geçerli. Önceki bütün HTTP assertion gövdeleri korunur;
fixture yalnız aynı native fetch'in henüz okunmamış Response'unu da sunar.

Gerçek HTTP sınaması cold-full ve ready gzip stream'lerini parser'dan geçirir;
full raw SHA ve length, worker'ın ready sidecar'ındaki bağımsız full SHA/length
ile aynıdır. Unicode byte boyutu, sparse own-key, `__proto__`, `0/false/null`,
truncation, overrun, abort sırasında hash/stream, değişen kaynak, MIME/status,
bozuk JSON/UTF-8, farklı receipt sahibi ve native browser-global export sınanır.
VM export testi gerçek Buyer Log tarayıcı kabulü değildir.

Bu adımda benchmark veya hızlanma iddiası yok. Üretim UI bağlantısı ve lazy
yükleme, son 30k karşılaştırmalar, tam regresyon ve bağımsız P1 incelemesi bekliyor.
PR/push/merge, TEST veya STABLE yayını yapılmadı.

EN: The existing ready/full response lease now declares its own exact decoded
JSON length without changing payload bytes, gzip or authority guards. The new
inactive parser reuses the existing bounded stream reader and owns the sole
JSON parse result and raw-byte digest before hydration. It rechecks abort and
source currency after awaits. Ownership is not permission or completeness.
Header baseline: 1 fail; unbounded parser baseline: 3 fail; final native related
suite: 199 pass, no fail/skip/cancel. All previous HTTP assertions are unchanged.
Actual gzip HTTP tests compare the full digest/size against the worker-produced
ready parent metadata. i18n is 0/0 and 50 release notes validate. UI activation,
final full regression, measurements and independent P1 review remain pending.
No performance gain, merge, TEST or STABLE release is claimed.
