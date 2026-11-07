# INT-01 → Faz 6c tasarım girdisi

Alıcı: ana sunucu/6c uygulama sahibi; koordinasyon sohbeti
**Buyer Log sunucu entegrasyonunu sürdür**. Teslim artefaktı: #898.
Sohbetler arası mesaj gönderme aracı bu oturumda yoktur; doğrudan mesaj
gönderildiği veya alıcının okuduğu iddia edilmez.

**Hazırlık tamamlandı; tam kopyalama adayı üretim için reddedildi.** INT-01
uygulaması Faz 7 sırasını ve 6c kaynak sahipliği sözleşmesini bekliyor.

Ölçülen **sentetik, taklit DB transport'lu refresh zincirinde** ASAS/IAS parse
sayısı 4/3 → 1/1 oldu. Bu tek başına performans kazanımı değildir:

| 3+3 koşu medyanı | Önce | Tam kopyalama adayı |
| --- | ---: | ---: |
| Toplam zincir süresi | 7,122 sn | 8,928 sn |
| Event-loop max | 7,135 sn | 8,942 sn |
| OS process peak RSS | 1009,25 MiB | 830,13 MiB |

Bu sonuçlar gerçek sunucu/DB veya kullanıcı deneyimi kabulü değildir. Eski
üretim bazı `5a1656e98deeb573f6245f4b24a8135cc77a0d7b`, paket/harness SHA'sı
`3c11c6e0cbbc260f1cc436b58f6708bcc8b4bc37`; kaynak/fixture hash'leri ve tüm
denemeler `artifacts/` altında değişmeden korunur. Main uyumluluk doğrulaması
bu ölçümleri yeni kaynakta tekrar edilmiş yapmaz.

Hedef başına tam grafik kopyalama parse tasarrufunu tüketiyor. Şu kararlar
**birlikte**, mevcut [6c sözleşmesi](../phase-5-source-ownership.md) içinde
tasarlanmalıdır:

- Immutable tabanın tek sahibi ve owner handle; hedeflere tabanın mutable
  referansını vermeyen, yalnız hedefe ait değişiklikleri tutan ince overlay'ler.
- Gerçek run kimliği, match rule ve parser/bağımlılık sürümü ile generation'ın
  ilişkilendirilmesi; farklı scope/run/rule/generation sonuçlarının karışmaması.
- Yeni generation hazırlanırken eski generation'ın okunabilmesi; snapshot/WAL
  commit'i ve gerekli authority güncellemesi bitmeden yayın yapılmaması.
- Commit başarısızlığında eski kaynakların korunması; eski generation'ın geç
  sonuçlarının yayınlanmaması; ana süreçte yetki/generation yeniden doğrulaması.
- Date/ISO ayrımı, gizli IAS metadata ve alias ilişkileri, null-LFL'nin mevcut
  kaynağı koruması ve hedefler arası mutation izolasyonunun kalıcı testleri.

**Worker'a taşıma tek başına bu kopyalama maliyetinin çözümü sayılmayacak.**
Hedef overlay, IPC/replica, eski/yeni generation ve commit sınırındaki bütün
kopyaların maliyeti owner tasarımı içinde değerlendirilmelidir. Bu not yeni
worker, üretim uygulaması veya DB migrasyonu başlatma yetkisi değildir.

Bağımsız inceleme başlatılmadı. Faz 6/son program PR'ında sabitlenmiş Main +
uygulama SHA'sında filtresiz `npm test` şartı sürer; bu hazırlığın hedefli
kontrolleri onun yerine geçmez. PR merge'i, TEST ve STABLE bu teslimde yapılmaz.

EN: Preparation is complete and the full-copy candidate is rejected for
production. In the measured synthetic mocked-DB refresh chain, parsing falls
from ASAS/IAS 4/3 to 1/1, but median wall time rises from 7.122 to 8.928 seconds
and event-loop max from 7.135 to 8.942 seconds, while peak RSS falls from
1009.25 to 830.13 MiB. This is not real-server acceptance. Design the immutable
base owner, thin target-specific mutable overlays, run/rule/parser version,
generation and pre-commit publication boundary together. Moving work to a worker
alone does not resolve copying. The historical source/evidence stays frozen;
only Main compatibility is revalidated. Implementation awaits phase 7/6c, and
independent review is not started. This PR is the delivery artifact; no direct
cross-chat delivery or recipient acknowledgement is claimed.
