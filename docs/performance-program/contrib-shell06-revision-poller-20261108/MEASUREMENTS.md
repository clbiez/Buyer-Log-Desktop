# SHELL-06 Chromium ölçümü

TR: Final helper + iki gerçek caller recipe bloğu. EN: Final helper and two actual caller recipe blocks.

Sabit pencere **31,5 saniye**; 1/3/5 aynı-origin sayfa; üç bağımsız çift **A/B → B/A → A/B**. Chromium 154.0.8037.57, Node v24.19.0.

| Sayfa | Başlatılan GET A→B (medyan) | Tamamlanan A→B | İptal A→B | Sayfa içi en çok overlap A→B | İlk GET A→B (s) | Rev1 gecikme A→B (s, medyan) | Rev2 gecikme A→B (s, medyan) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 5 → 5 | 5 → 5 | 0 → 0 | 2 → 1 | 2.51 → 0.01 | 12.53 → 10.01 | 3.53 → 1.04 |
| 3 | 15 → 5 | 15 → 5 | 0 → 0 | 2 → 1 | 2.51 → 0.01 | 12.52 → 10.01 | 3.52 → 1.04 |
| 5 | 25 → 5 | 25 → 5 | 0 → 0 | 2 → 1 | 2.51 → 0.02 | 13.49 → 10.01 | 3.52 → 1.04 |

Snapshot toplama sırasında 31.500ms sonrasında başlayan GET ham JSON’a girebilir; maliyet hesabı r.at <= 31.500ms ile sınırlandırılır. Bu dış örnekler summary.outsideWindowStarts alanında korunur. Pencere içindeki client/server başlangıç sayıları ayrıca birebir doğrulanır.

İlk maliyet (helper öncesi `cost-A-*`) 5/15/25 GET idi. Ortak bariyerli `verified-cost-A-*` tekrarları ve son 18 koşu ayrı JSON olarak saklanır. `verified-summary.json` bütün çiftlerin başlatılan/tamamlanan/iptal sayıları, sunucu overlap, her sayfanın gecikmeleri ve kaynak SHA-256 değerlerini içerir.

İş yükü: başlangıç revision 0; t=4s revision 1, t=20s revision 2; her sayfanın ikinci endpoint GET’i 8s gecikir; diğerleri 25ms. t=6s gerçek loopback EventSource üzerinden sentetik IAM olayı gelir. A kolu Main’in gerçek poll/SSE/consumer blokları; B aynı bloklara yalnız recipe uygulanmış halidir. Son iki entity revizyonu, tüm revision event payload’ları ve consumer çağrı sırası her sayfada birebir eşittir. 21 koşunun tamamı assertion ile kontrol edilir.

Gecikme, mutation ve revision event için aynı VM’nin Date.now saatinden ölçülür; timer süreleri ölçeklenmez. Her sayfanın arm offset’i ham JSON’da bulunur. İlk GET sütunu ortak bariyerden ilk endpoint başlangıcıdır; tam uygulamanın startup metriği değildir. Tablo medyanları üç bağımsız çiftin ham sayfa gözlemlerinden hesaplanır; rev1 uzun-yanıt senaryosu, rev2 sağlıklı akıştır. Birleşik/p95 değerle iki farklı yük gizlenmez.

Normal idle poll üst sınırı 7s kalır; değişiklikten sonra 3,5s, bir idle yanıttan sonra tekrar 7s. Dolayısıyla tek sayfada istek azalması vaat edilmez. SSE liderinde ilk GET 2,5s yerine hemen başlar; lider devri, foreground ve reconnect de hemen catch-up ister. Hatalarda 1/2/4/8/16/30s backoff gecikmesi vardır; 7s sağlıklı aralık ağ/JSON süresi için bir garanti değildir.

Headless Chromium/Playwright varsayılanları arka plan timer throttling’ini kapatır; bu yüzden gerçek frozen/background native-tab gecikmesi ölçülmüş sayılmaz. Gerçek Chromium Web Locks ve BroadcastChannel doğrulanır; mevcut lock dışında seçim yoktur. HTTP/1.1 loopback bağlantı sınırı A kolunun sunucuda gözlenen eşzamanlılığını kısıtlayabilir. Sayfa içi mantıksal GET overlap’i ayrıca tarayıcı kayıtlarından hesaplanır. Endpoint’in disk/SMB maliyeti, yetkilendirme servisi, UI/data yükleyicileri ve native activity sentetiktir; gerçek credential veya iş verisi kullanılmaz. Bu ölçüm Buyer Log’un bütün native-tab/Electron kabulü değildir.

A/B maliyet örneklerinde iptal beklenmez. İptal ve hata sayıları ayrı `chromium-lifecycle-verified-green.json` kaydındadır. Eski/başarısız denemeler `evidence/attempts.md` içinde açıklanır ve nihai medyana katılmaz. Kilit aynı dosyada `flock -n -E 75 /tmp/buyerlog-performance-measurement.lock` ile alınır; silinmez veya aşılmaz. Profil kaydı üretilmedi; JSON ve loglar korunur.

Entegre tam npm test, gerçek uygulama/Electron kabulü ve tek P1 incelemesi ana sohbete aittir. Bu sonuç Faz6b kapanışı değildir.
