# Agent Office — ek kabul / Additional acceptance

2026-10-10. Bu rapor önceki kabulün devamıdır; canlı şirket kabulü ile anonim yerel kontrolleri birbirine eşitlemez.

## Referans görseline devam / Reference-fidelity continuation — 2026-10-10

Son yerel devam: **49/49 Agent Office testi**, yedi dosya, sıfır fail/skip; **56 pending sürüm notu**. Aşağıdaki önceki test/maliyet sayıları tarihsel kanıttır.

- Üç aynı masa yerine planlama, koleksiyon ve kalite için ayrı çalışma yüzeyleri çizilir. Yeni saydam atlas ayrıca dikey planlama panosu, geniş tekstil ilham panosu ve bitkili kitaplık içerir. Sandalye bağımsız yeni yan görünüş sprite'ıdır. Bütün nesneler düzenlenebilir katmanlar olarak kalır; tek arka planla ofis taklidi yapılmaz.
- Karakter ölçeği referanstaki baş/gövde ve masa oranına yaklaştırıldı; ayakta 128, otururken 122 scene px kullanılır. Çalışma eli için masa ölçeği ve aynalama birlikte uygulanır. Sandalyenin tekerlek tabanı masa zeminine bağlanır, sandalye ışık cache'i ve ayna yönü doğru çalışır. İş göstergeleri gerçek Agent verisinden gelir.
- Alt karakter düzenleyicisi, aynı gerçek atanmış masa + görünüm taslağını ön izler. Ön izleme sprite, oturma ankrajı, ölçek ve aynalamayı sahneyle paylaşır; ayrı sahte işlem, timer veya AI çağrısı yoktur. Masasız profilde ön izleme gizlenir. Görünüm değişimi ve Vazgeç sonrası eski piksellere dönüş gerçek Chromium'da doğrulandı.
- Nesne görünümü menüsü yeni masa/pano/kitaplık stillerini saklar. Yeni bitkili kitaplığın 140 scene px / 3,5 hücre genişliği ortak istemci/sunucu modelinde çarpışmaya girer; sol sınırda sığmayan seçim reddedilir, select eski gerçek değeri gösterir. Owner, template, CAS, reopen ve yanlış türe verilmiş stil kontrolleri geçti. Kaydedilmiş klasik kitaplıklar yer değiştirmez veya büyümez; yeni varsayılan düzen bitkili kitaplığı kullanır.
- Tek LCW işareti korunur. Tek vizyon panosu ortadaki pano tarafından örtülmeyen dinlenme duvarına taşındı; marka metni istenen sabit Türkçe biçimindedir. Kahve tabelası ve dış UI TR/EN'dir. Yeni ön izleme ve kontroller Buyer Log tokenlarını kullanır; sahne açık/koyu/gri temada aynı pikselleri korur.

Gerçek browser kabulü: üç masanın her birinde 1×/1,3×, normal/aynalı olmak üzere **12 çalışma yüzeyi hizası**, kaynak görsel oranlarının korunması; gerçek edit/save/reopen; reddedilen kitaplık seçiminin dropdown/taslakta geri alınması; canlı ön izleme değişimi/discard; 1920×1080, 1440×900 ve 1366×768'de 16:9 ve yatay taşmasız yerleşim, bütün alt aksiyonların görünmesi. Dört anonim sahne katılımcısı gerçek üretim rotası/merdivenini izleyip dört toplantı sandalyesine ulaştı; bu fixture kurumsal AI işi değildir. Ofis JS/atlas/API hatası ve idle AI çağrısı sıfır. Mevcut anonim app başlangıcındaki ilgisiz `/api/backlog-export` 400 yanıtı bu ofis kontrollerinin başarısı diye sayılmadı.

Tek bağımsız incelemede iki P2 bulundu: reddedilen görünümün menüde kalması ve büyütülmüş masada sabit oturma konumu. İkisi de düzeltildi ve gerçek browser regresyonuyla doğrulandı; yeniden reviewer zinciri kurulmadı. Tam suite önceki mantıksal görevde çalıştırılmıştı; bu görsel devamda tekrar çalıştırılmadı. TR/EN ve pending not validator ayrıca çalıştırılır.

Güncel performans maliyeti: **10 PNG 13,64 MiB**, decode edilmiş piksel verisi yaklaşık **60,01 MiB**. PR492'ye göre ek yük **2,46 MiB dosya / 12,00 MiB piksel belleği**; yalnız ofise girişte yüklenir. 24 farklı avatar + 33 geçerli mobilya stresinde 27 nesne + 27 karakter cache girdisi, yaklaşık 2,71 MiB; 32 ek çizimde ısınmış cache miss'i yok, alfa karışımı korunur. 24,97 saniyelik headless dört karakter örneğinde 509 çizim, ortalama **0,913 ms**, cold-inclusive maksimum **109,6 ms**, JS heap **18,52 MiB**, Chromium main-thread TaskDuration oranı **%11,84** ve o sahnede ışık cache'i **2,23 MiB**. Fiziksel CPU/GPU veya kesintisiz FPS garantisi değildir; cache/FPS sınırları, azaltılmış hareket ve gizli sahnenin durması korunur.

Gerçek post-change PNG'ler: `agent-office-reference-stations-dark.png`, `agent-office-reference-stations-day.png`, `agent-office-reference-stations-night.png`, `agent-office-reference-stations-compact.png`, `agent-office-reference-stations-editor.png`, `agent-office-reference-stations-meeting.png` (`resources/app/public/release-notes/next-assets/`). Bunlar yalnız anonim fixture'da normal kişiselleştirme ile referansa yakın renk/saç seçilmiş çalışan Buyer Log ekranlarıdır; kullanıcı verisi veya online AI durumu uydurulmadı. Gerçek ekran/reference yan yana dosyası güncellendi.

**Görsel sınır:** iki kat, sabit kamera, çalışma istasyonları, sol merdiven/kahve, alt toplantı/dinlenme ve alt karakter/masa ön izlemesi artık referansa daha yakındır. Custom atlasların çizgi/pozu, küçük dekor ayrıntıları ve Buyer Log'un korunması gereken global chrome'u hâlâ birebir aynı değildir. **%100 piksel eşleşme tamamlandı olarak işaretlenmez.** Kurumsal LCW ve fiziksel Windows kabulü önceki raporda açık kalan ayrı başlıklardır; bu görsel devamda değiştirilmedi. Server/model yeniden başlatması gerekir; TEST/STABLE yayımlanmadı.

English: This reference-fidelity continuation adds distinct planning/collection/quality workstation sprites, portrait/wide boards, a validated planted library, a separate side-view office chair, closer character proportions, scale-aware mirrored seating, and a live preview at the actual assigned desk. All **49 targeted office cases** pass without skips; production-browser checks cover 12 workstation scale/mirror contacts, native edit/save/reopen/rejection behavior, live appearance/discard, three desktop viewports, four-chair routing, native theme contrast and invariant scene pixels. One independent review found two P2 issues; both are fixed with actual browser regression evidence. Ten lazy office PNGs total 13.64 MiB / 60.01 MiB decoded; this increment adds 2.46 MiB / 12 MiB. Warm caches remain bounded and stable. A 25-second headless sample averages 0.913 ms per draw with a 109.6 ms cold-inclusive maximum; it is not physical hardware acceptance. Six genuine anonymous screenshots and four new bilingual notes bring the pending total to 56. Exact bespoke sprite pixels remain different from the reference, so 100% fidelity is not claimed. Corporate/Windows acceptance and TEST/STABLE publication remain separate.

## Önceki yerel tamamlama / Earlier local completion

## Güncel yerel sonuç / Current local result — 2026-10-10

Bu bölüm son değişiklik setini bildirir. Aşağıdaki önceki ölçümler tarihsel kanıttır; güncel test sayısı **48/48**, pending sürüm notu **52**'dir. Kapsam matrisi `docs/ai/AGENT_OFFICE.md` içinde yer alır. Önceki konuşma/hafıza, koordinasyon, bağlam/parçalı geçmiş, deterministik aksiyon/kalite ve şifreli paylaşım uygulamaları korunur; bu devamda ikinci AI motoru veya iş verisi akışı kurulmadı.

### Son uygulananlar / Latest implementation

- Sol merdiven artık bağımsız saydam ayrıntılı sprite'dır. Ortak modeldeki üst/alt uçlar çizim ve gerçek yürüyüş rotası tarafından birlikte kullanılır. Kat geçişi hâlâ tek korumalı bağlantıdır; eski kişisel mobilya kayıtları taşınmaz.
- Planlama, koleksiyon ve kalite panoları, teknik çizim/tekstil çerçeveleri ve endüstriyel tavan lambası tek yeni atlasın ayrı parçalarıdır. Masa, duvar, nesne, karakter ve ışık katmanları bağımsız kalır. Minimal LCW/tek vizyon yerleşimi korunur; kahve tabelası TR/EN değişir.
- Gerçek Ofisi Düzenle modu pano ve dekor görseli seçebilir. Canlı değişim, geri al/yinele, şablon ve owner'a özel CAS kaydı desteklenir; yeniden açılış doğrulandı. Sunucu yalnız türe uygun seçenekleri kabul eder, dosya yolu veya keyfi görsel URL'si saklamaz. Orijinal stil açıkça seçilebilir. Desteklenmeyen nesnede seçim devre dışıdır.
- Otomatik yerel saat, hareket duraklatılmış/azaltılmışken de dakikalık sınırda atmosferi değiştirir. Manuel seçimde ve ofis gizliyken zamanlayıcı kapanır; gizli sahne yok edilir. Kontrol AI çağrısı yapmaz, sürekli yeniden çizim üretmez.
- Gerçek ortak iş durumu dört ayrı toplantı sandalyesi yaklaşımına yönlendirir. Karakter hedefe varınca oturur; arka/ön sıralama masa tarafından doğru örtülür. Boştaki dekoratif toplantı ziyaretçisi ayakta durur. Dört katılımcılı browser kontrolü açık anonim sahne fixture'ıdır; gerçek şirket LCW koordinasyonu olarak raporlanmaz.

### Son kabul / Latest acceptance

| Kontrol | Sonuç |
| --- | --- |
| Hedefli regresyon | Yedi Agent Office dosyası, **48/48**, sıfır fail/skip. Yeni stil/owner/reopen/CAS/şablon, merdiven ve dört sandalye rota kontrolleri dahildir. Önceki tam regresyon tekrarlanmadı. |
| Gerçek editor/reopen | Pano ve dekor stili, undo/redo, sunucu kaydı ve sayfa yeniden açılışı geçti; uygun olmayan nesnede kontrol kapalı. |
| Gerçek saat | Europe/Istanbul 10:59:40 → 11:00:10 sınırı browser saat kontrolüyle geçti: duraklatılmış ve azaltılmış harekette sabah → öğle. Manuel gece korunur; gizli modül zamanlayıcıyı temizler. |
| Toplantı | Üç gerçek demo profil + bir geçici anonim sahne profili dört farklı sandalye noktasına gerçek üretim rotasıyla ulaştı. Ön/arka sprite ayak hizaları gerçek sandalye koordinatlarıyla ±2 px içinde doğrulandı. Veritabanında sahte görev/profil oluşturulmadı; AI çağrısı yok. |
| Çözünürlük | 1920×1080, 1440×900, 1366×768: 16:9 sahne, yatay taşma yok, aksiyon satırı görünür. |
| Buyer Log teması | Gerçek `applyTheme` ile açık/koyu/gri kontroller en az 4,5:1 metin kontrastı; duraklatılmış sahnenin piksel hash'i üç temada aynıdır. |
| Ön bellek | Alfa karışımı korunur. 24 farklı avatar + 33 geçerli mobilya, 32 ek çizimde sıfır ısınmış cache miss; 23 nesne + 27 karakter girdisi, 2,49 MiB ışık ön belleği. |
| Hareket / kaynak | Görünmeyen/azaltılmış dekoratif animasyon durur; idle AI çağrısı sıfır. Ofise ait JS hatası, bozuk atlas ve endpoint hatası yok. Mevcut harici tatil servisinin ağ çağrıları ortam proxy politikasıyla engellendi; bu durum ofis hatası olarak veya başarılı ağ kabulü olarak sayılmadı. |
| Bağımsız inceleme | Yeni art/stil/saat diff'inde aksiyon gerektiren P0/P1/P2 bulunmadı. Sonraki sandalye hizası düzeltmesi gerçek dört karakter browser testi ve yeni rota unit testiyle kontrol edildi; ek inceleme zinciri kurulmadı. |

Güncel grafik maliyeti: **sekiz PNG 11,18 MiB**, çözülmüş piksel verisi yaklaşık **48,01 MiB**; bu devamın ek maliyeti 2,35 MiB indirme ve 12 MiB piksel belleğidir. Yalnız Agent Ofisi açılışında yüklenir, uygulama geneline eager yüklenmez. Saydam objeler tek ölçeği korur; yeni grafikler ek AI veya sürekli ağ çağrısı yapmaz.

25,051 saniyelik dört karakter headless Chromium örneği: 511 çizim, ortalama Canvas draw **1,081 ms**, en büyük draw **125,9 ms** (ilk/cold çizimler dahil), JS heap **17,33 MiB**, Chromium main-thread TaskDuration oranı **%11,95**, o sahnede ışık ön belleği yaklaşık **2,02 MiB**. İlk çizimin en kötü örneği ayrıca raporlanır; ortalama değerden kesintisiz FPS garantisi çıkarılmaz. Fiziksel Windows CPU/GPU kabulü yapılmadı. Sınırlı cache, 24/8 FPS politikası, ekonomik kip, gizli/azaltılmış hareket durması korunur.

Güncel gerçek PNG'ler: `resources/app/public/release-notes/next-assets/agent-office-finish-day.png`, `agent-office-finish-dark.png`, `agent-office-finish-night.png`, `agent-office-finish-art-editor.png`, `agent-office-finish-meeting.png`. Tam çalışan anonim Buyer Log ekranlarıdır; art atlası veya jeneratif mockup sürüm notu ekranı olarak kullanılmadı. Referans/gerçek ekran yan yana karşılaştırması `docs/ai/agent-office-reference-comparison.png` içinde güncellendi.

**Referansa eşleşen yapı:** sabit yandan görünüm, iki kat, üst üç ayrı çalışma istasyonu, sol merdiven/kahve, alt toplantı/dinlenme, sağ ajan sohbeti, alt canlı karakter düzenleme ve aksiyon sırası. **Farklar:** Buyer Log'un global navigasyonu ve tema kontrolleri korunur; özel sprite ayrıntıları referansın piksel piksel kopyası değildir. %100 görsel eşleşme ya da kurumsal LCW/Windows kabulü tamamlandı denmez. Bu ortamda uygulanabilen son art, editor, saat ve sandalye işleri tamamlandı; dış kabuller aşağıda açıkça listelenmiştir. Sunucu store doğrulaması değiştiği için mevcut uygulama süreci yeniden başlatılmalıdır; yalnız tarayıcı yenilemesi backend'i yenilemez.

English: The current local completion adds independent detailed stair, board/frame and pendant artwork; private editable wall styles with undo/redo, templates and CAS; automatic local-time updates during paused/reduced movement; and four properly aligned front/back meeting seats. All **48 targeted office cases** pass without skips. Production-browser checks cover persistence/reopen, clock boundaries, four-chair routing, native light/dark/grey contrast and an unchanged scene across UI themes, three desktop resolutions, stopped hidden/reduced animation, zero idle AI calls and stable warmed caches under 24-avatar/33-object stress. Eight lazy-loaded PNGs total 11.18 MiB (48.01 MiB decoded), adding 2.35 MiB/12 MiB. The 25-second headless sample averages 1.081 ms per draw, with a 125.9 ms cold-inclusive maximum; it is not a physical GPU or sustained-FPS guarantee. Office JS/assets/endpoints pass; unrelated holiday calls are denied by the environment's existing proxy policy. Five genuine anonymous post-change screenshots support four new bilingual release notes (52 pending total). The composition matches the reference hierarchy, while bespoke pixels and native Buyer Log controls differ. Corporate LCW/company-device Sync and physical Windows acceptance remain unverified, as listed below. Restart the application server to load the updated store validation; no TEST/STABLE publication is triggered.

## Önceki kabul kanıtları / Earlier acceptance evidence

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
| Agent Office hedefli regresyon | Yedi dosya, 45/45 test, sıfır fail/skip. Önceki tam regresyon bu devamda tekrar baştan çalıştırılmadı. |
| İki ayrı Node HTTP süreci | Gerçek store/sync/service/routes; karşılıklı fingerprint onayı, RSA/AES şifreli aktarım, iki taraflı mesaj/hafıza, tekrar aktarımın tekilleşmesi, güncelleme, process restart, yetki kaldırma ve kapsamlı kopya denetimleri geçti. IAM ve AI yanıtı açık anonim fixture'dır; şirket LCW/OneDrive değildir. |
| Sync dayanıklılık | 10 cihaz, 20.000 işlem, 77,47 s, başarılı. Yerel simülasyon; şirket ağının ölçümü değildir. |
| Ek Linux sözleşmeleri | Yedi kontrol geçti; Windows platformu taklit edilmedi. |
| Gerçek Chromium | 1920×1080, 1440×900, 1366×768; 16:9 sahne, yatay taşma yok, açık/koyu tema. Bütün çizilmiş mobilyaların genişlik/yüksekliği kaynak oranıyla eşleşir. |
| Ölçek düzenleyici | Gerçek UI taslağı, undo/redo, sunucu kaydı, uygulamayı yeniden açma, tekrar büyütme ve desteklenmeyen rafta kontrolün devre dışı olması geçti. |
| Hareket ve atmosfer | Gerçek sağ/sol/ön/arka rota yönleri, arkaya yürüyüş, kahve/dinlenme hedeflerine ulaşma, dört atmosfer, azaltılmış harekette çizimin durması geçti. Dekoratif harekette sıfır AI çağrısı; konsol hatası ve bozuk atlas yok. |
| Dil / görsel notlar | TR/EN bekçisi sıfır eksik; 48 pending not ve bu görsel devamda beş yeni gerçek post-change PNG doğrulandı. |

Performans: Altı PNG toplam 8,83 MiB; çözülmüş piksel verisi yaklaşık 36 MiB, buna sınırlı sprite/portre ve sahne önbellekleri eklenir. Bunlar yalnız ofise girişte yüklenir. Önceki 71,069 saniyelik headless Chromium örneğinde 1.372 çizim, ortalama Canvas draw 0,691 ms, en büyük draw 90,6 ms, JS heap yaklaşık 18,43 MiB ve Chromium main-thread TaskDuration oranı %19,27 ölçüldü. Son ölçüm işletim sistemi CPU yüzdesi, fiziksel GPU testi veya kesintisiz 24 FPS garantisi değildir. 24/8 FPS sınırı, ekonomik kip ve gizli/azaltılmış harekette durma korunur. Yeni grafikler AI veya sürekli ağ çağrısı eklemez.

## Görsel son düzenleme / Visual polish

- Referanstaki alt karakter alanı gerçek sprite galerisine dönüştürüldü. Saç, üst/alt giyim, aksesuar ve renk sekmelerinde canlı seçenekler, renklendirme ve gözlük vardır. Klavye okları/Home/End, seçili durumları ve TR/EN dil değişimi çalışır. Dokuz görünüm özelliği gerçek UI üzerinden kaydedildi ve uygulama yeniden açılarak doğrulandı.
- Alt aksiyonlar karakter panelinin altında tek satırdır. Üç desteklenen masaüstü çözünürlüğünde varsayılan karakter paneli ve bütün aksiyon satırı ekran sınırları içindedir; 1366×768'de panel açılıp daraltılabilir. Sohbet panelinin sahneyi gereksiz uzatması giderildi. Kontroller yalnız mevcut tema anahtarlarını kullanır.
- Buyer Log'un gerçek `applyTheme` geçişiyle açık/koyu/gri temada sol navigasyon, sağ panel, görünüm sekmesi ve alt butonların metin kontrastı 4,5:1 sınırını geçti. Yarı saydam metin gerçek arka planla birleştirilerek ölçüldü; hareket duraklatıldığında üç temada sahnenin bütün piksel hash'i aynı kaldı. Tema testi veya ekran yakalama için ayrı bir renk sistemi eklenmedi.
- Özgün pencere/şehir dokusu korunur; gece pencereleri ve şehir ışıkları ayrıca çizilir. Nesneler ve karakterler kendi saydam katmanlarında aydınlatılır; lambalar, karakter/nesne renkleri ve duvarlar yumuşak geçer. Dekoratif hareket duraklatılmışken de ışık değişimi tamamlanır, ardından çizim durur. Dört atmosferde gerçek pencere pikseli farklıdır; gece parlaklığı öğlenin yarısından düşüktür.
- Eski oturum isteği yeni kullanıcı görünümüne veri veya iptal uyarısı taşımaz. Geciktirilmiş gerçek browser isteği + erişim yenileme olayı ve iki üretim istemci/event-handler regresyon testiyle doğrulandı; güncel yetki hatası görünür kalır.
- Tek bağımsız diff incelemesinde iki P2 bulundu ve düzeltildi: alfa koruyan sprite karışımı, ayrı sınırlı mobilya/karakter ışık önbellekleri. Yarı saydam test pikselinin alfa değeri geçişin beş noktasında 128 olarak kaldı. 24 farklı görünümlü agent + 33 geçerli mobilya yerleşimi, 32 ek çizimde ısınmış önbellek miss'i üretmedi (19 nesne + 27 karakter girdisi; yaklaşık 2,04 MiB).

Yeni grafik dosyası veya AI çağrısı eklenmedi. Aydınlatma önbelleği en fazla 40 nesne ve 96 karakter karesini tutar; geçiş sırasında yalnız bir önceki nesil ve tek 320×256 ara canvas tutulur. Normal üç-agent tarayıcı örneğinde bu katmanlar yaklaşık 1,37 MiB, 5,023 saniyelik headless örnekte 64 yeni çizim, tüm ziyaret çizimleri üzerinden ortalama 3,157 ms (ışık geçişleri dahil), en büyük 17,2 ms, JS heap yaklaşık 14,55 MiB ve Chromium TaskDuration oranı %7,79 ölçüldü. Bu değerler fiziksel CPU/GPU veya Windows kabulü değildir. Geçiş tamamlandığında eski nesil bırakılır; görünmeyen/azaltılmış hareket durması korunur.

Gerçek son ekranlar: `resources/app/public/release-notes/next-assets/agent-office-polish-gallery.png`, `agent-office-polish-night.png`, `agent-office-polish-dark.png`, `agent-office-polish-editor.png`, `agent-office-polish-compact.png`. Yan yana referans karşılaştırması `docs/ai/agent-office-reference-comparison.png` dosyasındadır. Bunlar jeneratif mockup değil, anonim verili çalışan Buyer Log ekran görüntüleridir. Özel art ayrıntıları hâlâ referansla piksel piksel aynı değildir.

English: The visual bench now previews actual scene sprites, supports all nine appearance properties, keyboard tabs, live language switching and private save/reopen. The supported desktop viewports fit the scene, default bench and complete action dock. Native light/dark/grey theme transitions pass the 4.5:1 text-contrast threshold for the checked navigation, chat, appearance tabs and action buttons, including alpha-composited text; the entire paused scene pixel hash stays identical across themes. Skyline detail is preserved and windows, lamps, individual furniture and characters transition separately, including while decorative movement is paused. Two client ownership regression cases reject stale data/alerts while retaining genuine current permission errors. One independent review found two P2 issues, both corrected: alpha-preserving crossfade and separate bounded lighting caches. Real-browser checks verify constant partial alpha and no warmed-cache churn with 24 unique avatars and 33 valid furniture placements. All 45 targeted cases pass with no skips, and 48 pending release notes validate. No new art downloads or AI calls are added. The 5-second headless performance sample is diagnostic evidence, not physical Windows/GPU acceptance. Corporate access and exact pixel fidelity remain open as described below.

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

English: The additional changes preserve furniture proportions, add a rear-view atlas and depth-aware movement, require actual workstation arrival for seating, and add collision-aware 1×/1.3× resizing with private persistence. All 45 targeted office tests pass with no skips; real-browser checks cover all three resolutions, themes, resizing/reopen, four atmospheres, movement and zero idle AI calls. Genuine two-process protocol and 20,000-operation local soak checks pass using explicitly anonymous fixtures. Corporate LCW authentication, actual company-device Sync and physical Windows/GPU acceptance remain blocked by unavailable authorized infrastructure. Sixty-five original Windows-gated checks remain unverified. Custom sprite detail is not a pixel-perfect copy of the reference. No TEST/STABLE publication is triggered.
