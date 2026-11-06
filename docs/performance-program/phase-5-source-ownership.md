# Faz 5: kaynak sahipliği ve Faz 6c sözleşmesi

Bu not bir migrasyon değildir. Faz 5'in ortak hesaplama havuzu ile Faz 6c'de
uygulanacak kaynak sahipliği arasındaki sınırı kaydeder.

## Mevcut durum ve gerçek mesaj ölçümü

[Doğrulandı] Yenileme sonrası ham ASAS/IAS/LFL kayıtları ana süreçte kalır.
Karşılaştırma, eşleştirme, sipariş yetki dizini ve mevcut snapshot kaydı bunları
kullanır. Yalnız gzip döndürmek bu sözleşmeyi karşılamaz.

Faz 5, yayımlanmış kaynak nesne grafiğinin süreç ömrüyle sınırlı, özel bir V8
kopyasını ortak worker'da hazırlar. ISO metinler Date'e çevrilmez; Date ve alias
ilişkileri korunur. Parser'ın enumerable olmayan Antrepo metadata'sı mesajdan
önce küçük bir sidecar ile aynı grafiğe bağlanır. İş okumalarında ham kayıtlar
yeniden IPC'den geçirilmez; sahip/generation/capability doğrulanmış tanıtıcı
kullanılır. İş verisinin kalıcı JSON biçimi değişmez. Bu geçici kopya,
ham verinin tek sahibi olan servis değildir.

30.000 satır, aynı ASAS SHA'sı
`2ce763911d9e89525d9254415ca0270ba6241d065acbd9df75f4efc20bb5dc99` ile
üç taze Node sürecinde gerçek Excel worker mesajı ölçüldü:

| Ölçüm | Koşu 1 (ms) | Koşu 2 (ms) | Koşu 3 (ms) | Medyan (ms) |
| --- | ---: | ---: | ---: | ---: |
| Ana thread `receiveMessageOnPort` | 1338,884 | 1140,787 | 945,043 | 1140,787 |
| Worker `postMessage` | 1217,216 | 989,943 | 1163,376 | 1163,376 |
| Worker yürütme | 12334,144 | 8642,831 | 9706,340 | 9706,340 |
| Başlatma ile yanıt alma arası | 14973,199 | 10846,498 | 12063,464 | 12063,464 |

Sonuç her koşuda 128.708.277 V8 baytı ve aynı SHA:
`7f286d6f21b66c5ec76e0b5f4fe134e546702543956533aa8bc16d3cca829a90`.
Ortam Linux, Node 24.19.0; `availableParallelism=4`, CPU affinity 5 mantıksal
CPU ve cgroup kotası 4 CPU. Windows/Electron ölçülmedi.

Ana ölçüm gerçek worker'ın gönderdiği ham nesneyi native porttan açar; ayrı
bir süreçteki `v8.deserialize` deneyi değildir. Küçük `result-ready` mesajı
ham sonucun gönderilmesinden sonra gelir. Worker yürütme süresi sonuç
serileştirmesini içermez. Kuyruk, worker gönderimi ve ana alım ayrı alanlardır;
toplam süre GC/zamanlama ve thread başlangıcını da içerir. Ana alımın kontrollü
bir porttan yapılması önceki otomatik message callback yoluyla eş koşullu
önce/sonra karşılaştırması değildir. Önceki yaklaşık 2,1 saniyelik hipotezden
yüzde kazanç çıkarılamaz.

Tekrarlama: taze süreçte `scripts/benchmark-excel-worker-receive.js` ve Faz 0
sentetik fixture'ı. Fixture manifesti ve ASAS SHA'sı zorunlu; gerçek iş verisi
ve credential kullanılmaz. Yenilemenin gerçek `onMetrics` telemetrisi de aynı
ölçüm alanlarını taşır.

## Faz 6c için hedef sözleşme

1. **Tek sahip:** Ham kaynak grafiğini owner/generation anahtarlı servis tutar.
   Excel okuma, parser kancaları, önceki/yeni karşılaştırması ve snapshot üretimi
   bu serviste çalışır. Ana süreç ham grafiği almaz; generation handle,
   kaynak/hash/satır sayısı ve sınırlı metadata alır.
2. **Yetki ana süreçte:** Oturum, credential ve IAM deposu worker'a taşınmaz.
   Worker yalnız çözülmüş görünüm kapsamı, düzenleme kararı için gereken dört
   authority alanı ve gerekli kimlik eşleştirme alanlarını alır. Moderator
   authority, alıcının kendi kaynak satırlarından türetilmez.
3. **Okuma:** İstek, güvenilir owner handle ve canonical modül/alan seçimiyle
   gelir. Worker ince görünüm veya seçilmiş ayrıntı üretir. Gzip/Office baytları
   transfer edilir; ana süreç güncel oturum, kapsam ve generation'ı yanıt
   öncesi yeniden doğrular.
4. **Yayımlama:** Eski generation yeni kaynak hazırlanırken okunabilir kalır.
   Snapshot/WAL commit'i ve gerekli authority güncellemesi tamamlanmadan
   yayımlanmış generation değiştirilmez. Eski generation işleri iptal edilir;
   sonradan gelen sonuçlar yayımlanmaz. Commit/replay sırası crash testlidir.
5. **Yazma:** Row/field patch ve owner paylaşım delta'sı açık base revision
   taşır. Sunucu canlı owner/edit yetkisini doğrular. Kaynak sahibi aynı
   canonical anahtarlarla üç yönlü merge, inverse patch ve WAL kaydını uygular;
   eski istemcinin tam snapshot isteği de aynı doğrulama/merge sınırından geçer.
6. **Kaynak sınırı:** Havuzun tek byte admission bütçesi eski/yeni generation,
   kuyruk girdisi, worker'da tutulan grafik ve kiralanmış çıktı baytlarını kapsar.
   İptal kapasiteyi ancak gerçek thread çıkışında serbest bırakır. Kaynak
   sığmazsa ana thread fallback'i yapılmaz. Tahminler fiziksel RSS garantisi
   olarak raporlanmaz.
7. **Uyumluluk:** Mevcut JSON/WAL okuma, Date/ISO metin ayrımı, Antrepo metadata
   alias'ı, farklı sürüm istemci, owner yetkisi, crash/replay ve çıktı SHA/dual
   read eşdeğerliği kalıcı testlerdir. SQLite migrasyonu bu sözleşmenin parçası
   değildir; Faz 6d yalnız yerel prototip kıyaslamasıdır, SMB'de SQLite yoktur.

[Hipotez] Kaynak grafiğinin tek sahibi olmak ana süreçteki yaklaşık 1,14 sn
alımı ve Faz 5 geçici kopyasının maliyetini kaldırabilir. Faz 6c uygulanıp aynı
fixture ile ölçülmeden bu bir kazanım olarak sayılmaz.
