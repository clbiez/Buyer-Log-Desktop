# DS-08 güncel entegrasyon / current integration

8 Kasım 2026. Main `6b8362ad` (#915/#913 dahil) normal merge ile alındı.
Dört üretim ve iki test dosyası, önceki tek bağımsız incelemenin kaynaklarıyla
birebir aynı. Önceki kapasite P1 düzeltmesi ve 11 dayanıklılık/havuz
regresyonu korunur; yeni genel tur veya optimizasyon eklenmedi.

Standart npm test, bütün 10 batch tek çağrıda, varsayılan concurrency4,
izole TMPDIR, NODE_OPTIONS/preload olmadan: **1297 dosya, 8907 PASS,
0 FAIL, 65 mevcut SKIP, 0 CANCEL**. İlgili paket 226 PASS, i18n0/0,
44 sürüm notu PASS. Test edilen uygulama ağacı `3a7267a1a9c7d6800c97efccc0f9efdb1450b7b5`.
Main merge makbuzunu ekleyen son commit aynı kaynak/test/CI ağacındadır.

Tarihsel üç dönüşümlü çift: sunucu gap 320→48 ms; toplam checkpoint
374,920→404,012 ms (+%7,76), RSS273,508→289,195 MiB. Kazanç yalnız
ölçülen Linux yerel disk senaryosudur. Fallback eski ana thread maliyetini
korur; yeni kapasite veya 200 ms üst sınır garantisi değildir. Kaynaklar
birebir kaldığından aynı performans kampanyası tekrarlanmadı.

Önceki server-only dosya kilidi nedeniyle dokümana bırakılan sürüm notu,
ana entegrasyonda yalnız kendi TR/EN kaydı ve incelenmiş gerçek post-change
PNG ile pending pakete eklendi. Diğer 43 Main kaydı değişmedi. Görsel
zamanlama/dayanıklılık kanıtı sayılmaz. Final head CI ve P1 merge onayı
ayrı kapıdır. TEST/STABLE yok.

## EN

Main `6b8362ad` was merged normally, retaining the frozen review history.
All four production and two test blobs exactly match the previous independent
review, including its closed capacity finding. Standard full npm test passed
all ten batches in one invocation: **1297 files / 8907 PASS /
0 FAIL / 65 existing SKIP / 0 CANCEL**, default concurrency4, private TMPDIR,
no NODE_OPTIONS/preload. Related 226 PASS; i18n0/0;44 visual notes valid.

Historical paired results remain tied to their original sources: loop gap
320→48ms, checkpoint time +7.76%, higher RSS. Fallback retains the previous
main-thread cost and durability capacity. This is not a new universal latency
bound or Windows/SMB result. Identical measured implementation did not warrant
a duplicate timing campaign. Root integration adds only its own bilingual
pending note and an inspected original actual post-change PNG; all43 Main
entries are preserved. Actual final-head CI and explicit P1 merge approval
remain required. No TEST or STABLE publication.
