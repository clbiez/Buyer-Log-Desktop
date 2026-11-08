# Gerçek yaşam döngüsü / actual lifetime

Başlangıç `ea49389836dba23f0970a974b4c0185f1b36ec0e`.
Devralınan yardımcı ve teslim `5a5b4f5e2b82d3f4584a818221b7d27a1c487d8a`.
#899 hazırlık `b2a4a579c5369f59e5cfb9181140a00176d944ef`.
Bu kaynaklar yeniden uygulanmadı; `pinned.js` Git blob'unu aynen derler.
Yardımcı üretim ağacına cherry-pick/merge edilmedi; yazma kapsamı korunur.

[Doğrulandı] `plm-image-download-queue.js` başındaki yorum `onWritten`
ile Buffer bırakıldığını söylüyor. Dosyada `onWritten` için yürütülebilir bir
çağrı yok. `httpGetImage` chunks tutar, EOF'ta `Buffer.concat` yapar;
`downloadImage` MIME sniff yapıp Buffer döndürür. `runBounded` worker sonucunu
`results[index].value` içinde tutar. Yeni diagnostic test, callback sayısının
sıfır ve bütün sonuçların hâlâ Buffer taşıdığını doğrular.

[Doğrulandı] `plm-image-sync-service.js:333` indirmeleri `runBounded` ile
bekler. Sonraki döngü aynı Buffer'ları `ready` girişlerine ekler; URL'yi
paylaşan renklerde Buffer ortaktır. `:361` bütün ready girişleri için tek
senkron `ingest.commit` yapar. İndirme concurrency tavanı toplam retained byte
tavanı değildir. Aday kopyada `results` ve `ready` yalnız stage handle/metadata
alır; ham Buffer döndürülmez.

[Doğrulandı] Kanonik zincir:

`server.js:4907 runPlmImageSync`
→ `agent-browser-connector.downloadCoreNectumAttachment`
→ `plm-image-download-queue.downloadImage / httpGetImage`
→ `plm-image-sync-service.ready`
→ `canonicalPlmImageIngest` (`server.js:4219`)
→ `plm-image-ingest.commit`
→ `saveCollectionImage` (`user-data.js:721`)
→ `patchPlmImageLinks` (`db.js:1017`)
→ sahiplik → koşullu eski dosya silme → checkpoint.

`saveCollectionImage` Buffer'ı base64 string'den tekrar decode eder. Ingest,
önce mevcut dosyayı da okuyup hash karşılaştırabilir. Bu dosya PLM'den değil
manuel yüklemeden geldiyse 50 MiB olabilir; downloader'ın 20 MiB tavanı bunu
kapsamaz. Her iki kabul tavanı korunur. Eski okuma aday adapter'da sabit fd,
stat ve en çok 50 MiB allocation ile yapılır; stat/read arasındaki büyüme
yüzünden sınırsız `readFileSync` allocation yapılmaz.

Tek patch çağrısı orders revision'ı bir artırır; hiç link yoksa artmaz.
Ingest hash→ref tablosunu commit ömründe tutar. Patch hatasında bu commit'te
oluşturulan bütün dosyaları geri alır, sahiplik henüz yazılmamıştır.
Küçük `commit` çağrıları bu revision/rollback sınırını değiştirir; bu prototip
onları eşdeğer kabul etmez.

İki iş için baseline'a farklı başlangıç ownership nesneleri vermek ikinci
commit'in ilk işin sahiplik kayıtlarını eski snapshot ile değiştirmesine yol
 açabilir. Ölçümde iki kola da **aynı başlangıç ownership nesnesi** enjekte
edilir; koşul ham JSON'da açıkça kayıtlıdır. Aday kanonik serializer altında
güncel map/store yükler. Bu harness koşulu genel çoklu kullanıcı kabulü değildir.

EN: Executable code contradicts the queue's onWritten comment. The actual
retention sites are queue results and sync ready, followed by one canonical
commit. Chunk/concat, base64/decode and up to 50 MiB of old image bytes overlap.
The staged adapter preserves one canonical patch per job; early canonical
links are deliberately not claimed.
