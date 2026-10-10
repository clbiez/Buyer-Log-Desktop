# Agent Office — ek kabul / Additional acceptance

2026-10-10. Bu rapor önceki kabulün devamıdır; canlı şirket kabulü ile anonim yerel kontrolleri birbirine eşitlemez.

## Uygulanan düzeltmeler / Implemented corrections

- Mobilya genişlik/yüksekliği atlasın gerçek oranını korur. Dikey raf ve askı için ayrı atlas kullanılır; kaynak resim zorla uzatılmaz.
- Arkadan görünüş için üç karakter × altı poz içeren ikinci atlas eklendi. Gezinti farklı derinliklerde gerçekleşir; sağ/sol/ön/arka yönler gerçek rota adımından gelir. Arkadan görünüşte gözlük ve göz kırpma yüze çizilmez.
- Masa oturma pozu gerçek istasyona ulaşmayı gerektirir; aynalı masada oturma tarafı ve karakter yönü birlikte değişir.
- Masa, toplantı masası, koltuk, kahve ünitesi ve halı 1× / 1.3× boyut seçebilir. Görsel ve engel genişliği aynı ölçeği kullanır. Desteklenen türler ortak modelden belirlenir; diğer türlere API üzerinden bu ölçek eklenmez. Taslak, geri al/yinele, şablon, CAS kaydı ve yeniden açılış desteklenir.
- Yeni varsayılan düzende alt toplantı/dinlenme mobilyaları büyütüldü, giriş rafı ve kalite askısı eklendi. Kaydedilmiş eski kişisel düzenler otomatik değiştirilmez.

Referansın iki katı, üst üç istasyonu, sol merdiven/kahve, alt toplantı/dinlenme, sağ sohbet ve alt kişiselleştirme hiyerarşisi korunur. Buyer Log tema kontrolleri kullanılır. Özel atlasların ayrıntıları hâlâ referansın piksel piksel aynısı değildir; **%100 görsel eşleşme tamamlandı olarak işaretlenmez**.

## Doğrulananlar / Verified

| Kontrol | Sonuç ve sınır |
| --- | --- |
| Agent Office hedefli regresyon | Altı dosya, 43/43 test, sıfır fail/skip. Önceki tam regresyon bu devamda tekrar baştan çalıştırılmadı. |
| İki ayrı Node HTTP süreci | Gerçek store/sync/service/routes; karşılıklı fingerprint onayı, RSA/AES şifreli aktarım, iki taraflı mesaj/hafıza, tekrar aktarımın tekilleşmesi, güncelleme, process restart, yetki kaldırma ve kapsamlı kopya denetimleri geçti. IAM ve AI yanıtı açık anonim fixture'dır; şirket LCW/OneDrive değildir. |
| Sync dayanıklılık | 10 cihaz, 20.000 işlem, 77,47 s, başarılı. Yerel simülasyon; şirket ağının ölçümü değildir. |
| Ek Linux sözleşmeleri | Yedi kontrol geçti; Windows platformu taklit edilmedi. |
| Gerçek Chromium | 1920×1080, 1440×900, 1366×768; 16:9 sahne, yatay taşma yok, açık/koyu tema. Bütün çizilmiş mobilyaların genişlik/yüksekliği kaynak oranıyla eşleşir. |
| Ölçek düzenleyici | Gerçek UI taslağı, undo/redo, sunucu kaydı, uygulamayı yeniden açma, tekrar büyütme ve desteklenmeyen rafta kontrolün devre dışı olması geçti. |
| Hareket ve atmosfer | Gerçek sağ/sol/ön/arka rota yönleri, arkaya yürüyüş, kahve/dinlenme hedeflerine ulaşma, dört atmosfer, azaltılmış harekette çizimin durması geçti. Dekoratif harekette sıfır AI çağrısı; konsol hatası ve bozuk atlas yok. |
| Dil / görsel notlar | TR/EN bekçisi sıfır eksik; 44 pending not ve üç yeni gerçek post-change PNG doğrulandı. |

Performans: Altı PNG toplam 8,83 MiB; çözülmüş piksel verisi yaklaşık 36 MiB, buna sınırlı sprite/portre ve sahne önbellekleri eklenir. Bunlar yalnız ofise girişte yüklenir. Son 71,069 saniyelik headless Chromium örneğinde 1.372 çizim, ortalama Canvas draw 0,691 ms, en büyük draw 90,6 ms, JS heap yaklaşık 18,43 MiB ve Chromium main-thread TaskDuration oranı %19,27 ölçüldü. Son ölçüm işletim sistemi CPU yüzdesi, fiziksel GPU testi veya kesintisiz 24 FPS garantisi değildir. 24/8 FPS sınırı, ekonomik kip ve gizli/azaltılmış harekette durma korunur. Yeni grafikler AI veya sürekli ağ çağrısı eklemez.

## Açık dış bağımlılıklar / Open external dependencies

Bu görev ortamı Linux'tur. Güncel cloud metadata'da kurumsal secret/runtime identity yok; VPN yapılandırılmamış; anonim Buyer Log `/api/lcwai/status` yanıtı `connected=false` durumundadır. Bu nedenle gerçek şirket LCW yüklemesi/yanıtı, Windows tepsi/bildirim/SSO ve gerçek şirket paylaşım klasörü kabulü **çalıştırılamadı**. Test fixture yanıtları bu kabullerin yerine yazılmaz.

Önceki 66 skip'in biri opt-in soak testiydi ve şimdi çalıştırıldı. Kalan 65 özgün skip şu Windows dosyalarındadır; Agent Office testinde skip yoktur:

| Dosya (`resources/app` altında) | Windows skip |
| --- | ---: |
| `tests/browser-binding-ownership-v1112.test.js` | 29 |
| `tests/browser-debug-service-v1.test.js` | 26 |
| `tests/browser-default-profile-debug-block-v1111.test.js` | 6 |
| `tests/electron-desktop-host-v1014.test.js` | 3 |
| `tests/portable-edge-discovery-v956.test.js` | 1 |

Gerçek Windows üzerinde PowerShell, `resources/app` dizininde:

```powershell
$env:BUYER_LOG_TEST_CONCURRENCY = "1"
npm test -- browser-binding-ownership-v1112.test.js browser-debug-service-v1.test.js browser-default-profile-debug-block-v1111.test.js electron-desktop-host-v1014.test.js portable-edge-discovery-v956.test.js
```

Bu dosyalarda RUN_LIVE bayrağı yoktur. Edge discovery testi `DevToolsActivePort` bulunmazsa erken dönebilir; komutun yeşil olması canlı Edge kabulü sayılmaz. Aktif profil ve gerçek endpoint ayrıca doğrulanmalıdır. Bu sözleşme testleri kurumsal SSO veya LCW yanıtını da kanıtlamaz.

Yetkili Windows/LCW ortamı bağlandığında kalan kabul sırası:

1. Gerçek mevcut kullanıcıyla bağlan; token/parola/cookie'yi rapora veya dosyaya yazma. Ortak LCW durumunu bağlı olarak doğrula.
2. Tek ajan konuşması gönder; gerçek yanıt, kaynak/güven etiketleri ve uygulama yeniden açıldıktan sonra iki taraflı geçmişi doğrula.
3. İki ajan, bir tur koordinasyonun üç çağrılı önizlemesini onayla; ayrı gerçek yanıt/handoff ve sentez kaydını doğrula. Gerekirse iki turlu beş çağrılı akışı ayrı onayla.
4. Yetkili siparişin gerçek kalite ekini seç; gerçek byte/boyut/yükleme önizlemesini onayla. Dosya yüklemesi + bir ortak LCW analizinin gerçek sonucunu kontrol et; sonucu otomatik kalite onayı sayma.
5. Gerçek büyük geçmişte <19 MiB parçaları önizle; seçili aralığın çağrı bütçesini onayla, gerçek yükleme ve birleştirme kayıtlarını kontrol et. Bir seferde en fazla 15 parça + gerektiğinde bir sentez; yükleme bütün metnin okunduğunu tek başına kanıtlamaz.
6. İki gerçek şirket cihazında owner/moderatör fingerprintlerini kendi ekranlarında karşılaştırarak sabitle; gerçek Sync paylaşım klasöründe şifreli aktarım, sıradan kullanıcı engeli, moderatör erişimi ve rol kaldırmayı doğrula.
7. Tepsiyi açık tercihle etkinleştir; Buyer Log penceresini kapat/aç, genel bildirim ve tepsiden çıkışı fiziksel Windows'ta kontrol et. Auth penceresinin gizlenmediğini ve şirkete ait bildirim içeriğinin gösterilmediğini doğrula.
8. Desteklenen masaüstünde fiziksel CPU/GPU, bellek ve kare sürelerini kontrol et. Azaltılmış hareket ve arka planda sahne durmasını doğrula.

TEST/STABLE yayımlanmadı. Bu açık kabul maddeleri tamamlanmış olarak raporlanmaz.

English: The additional changes preserve furniture proportions, add a rear-view atlas and depth-aware movement, require actual workstation arrival for seating, and add collision-aware 1×/1.3× resizing with private persistence. All 43 targeted office tests pass with no skips; real-browser checks cover all three resolutions, themes, resizing/reopen, four atmospheres, movement and zero idle AI calls. Genuine two-process protocol and 20,000-operation local soak checks pass using explicitly anonymous fixtures. Corporate LCW authentication, actual company-device Sync and physical Windows/GPU acceptance remain blocked by unavailable authorized infrastructure. Sixty-five original Windows-gated checks remain unverified. Custom sprite detail is not a pixel-perfect copy of the reference. No TEST/STABLE publication is triggered.
