# Bounded schema metadata / Sınırlı schema metadata

8 Kasım 2026. P1 6a entegrasyon adımı; client activation kapalı.

[Doğrulandı] Schema GET artık mevcut 64 KiB DTO bütçesi için zaten hesaplanan
JSON boyutunu `X-Orders-Schema-Json-Bytes` ile bildirir. Ek row/cache/worker işi
veya yetki değişikliği yoktur. `orders-owned-json.readSchema` aynı native exact
stream reader, owned byte/hash/tek JSON parse ve source/abort kontrollerini
kullanır. Schema ve satır boyut başlıkları birbirinin yerine kullanılamaz;
metadata 64 KiB üstünde veya içine rows eklenmişse reddedilir. Bu parser receipt'i
authority değildir; actual client'ın schema/token/hash kontrolleri ayrıca kalır.

Native HTTP RED **0 PASS / 1 FAIL**: metadata boyut başlığı yoktu. Son 8 dosyalık
paket **204 PASS / 0 FAIL / 0 SKIP / 0 CANCEL**, syntax PASS, i18n **0/0**, release
notes **50 PASS**. Gerçek schema HTTP Response'u bounded reader'dan geçirildi;
metadata/hash orijinal DTO ile aynı, worker sayısı sıfır. Önceki bütün owned-json
assertion gövdeleri byte olarak aynı; dört bağımsız metadata testi eklendi.
Önceki router/test pinleri korunur ve tek handler delta'sı için exact reverse
source equality `source-pin-review.json` içinde kayıtlıdır.

Client'ın gerçek UI/controller/yükleme bağlantısı, kalan writer kapıları, tam
regresyon, tarayıcı/30k kabulü ve P1 incelemesi bekliyor. Yeni hızlanma iddiası,
PR/push/merge veya TEST/STABLE yayını yok.

EN: The schema endpoint exposes its already-budgeted exact JSON DTO length.
The same owned parser now reads schema metadata within a separate 64 KiB limit;
it never substitutes gzip Content-Length or row metadata. Actual native HTTP
baseline: 1 fail; related suite: 204 pass with no fail/skip/cancel. Existing
owned-parser assertions are unchanged. i18n is 0/0 and 50 release notes validate.
This is a transport integration step; activation and final acceptance remain
pending. No speed improvement, merge or release is claimed.
