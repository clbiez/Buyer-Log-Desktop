# LCW AI — mimari ve güvenlik sözleşmesi

> Yalnız LCW AI, AI paneli/sohbet, AI dosya çıktısı (AI Export Engine) veya bir
> modüle AI kullanımı ekleyen işlerde oku. Üst sözleşme: `CLAUDE.md` §4.

## Tek AI yolu

- Uygulama içindeki tek AI yolu şirket içi **LCW AI** motorudur:
  `resources/app/server/lib/lcwai/` (sunucu) + `public/lcwai-assistant.js`
  (`window.BuyerLogAI`).
- Modül kendi AI entegrasyonunu, ikinci bir sağlayıcıyı veya ayrı bir
  tarayıcı/oturum sistemini yazmaz; yeni kullanım için `lcwai-prompt.js` içine
  sözleşme ekler ve ortak paneli kullanır. Başka bir AI sağlayıcısı eklemek ayrı
  ürün ve güvenlik kararıdır.
- Genel sohbet modülü (`public/lcwai-chat.js`, sol menü › LCW AI) aynı motoru
  kullanır; ekranlar veri vermek için `BuyerLogAI.registerContextProvider` ile
  sağlayıcı kaydeder.

## Bilgi ve karar akışı

- LCW AI'ın Buyer Log bilgisi `server/lib/lcwai/lcwai-knowledge.js`'tedir:
  formül/kural/otomasyon bilgisi gerçek motorlardan türetilir, elle kopyalanmaz;
  her isteğe yalnız ilgili modül bilgisi seçilir.
- AI önerisi modülün deterministik doğrulayıcısından geçer, önizlenir ve yalnız
  kullanıcı onayıyla uygulanır; iş gerçeği daima deterministic/canonical veriden
  gelir.

## Token ve oturum

- LCW AI token'ı yalnız süreç belleğinde yaşar; diske, log'a, renderer'a taşınmaz.
- Masaüstünde token PLM Sync deseniyle Electron'un gizli, kalıcı bölümünden
  (`persist:buyerlog-lcwai-auth`) masaüstü köprüsüyle sunucu belleğine gelir
  (kullanıcı tarayıcı görmez); tarayıcı kipinde Edge/CDP yolu kullanılır.

## Dosya çıktısı (AI Export Engine)

- PDF/PowerPoint/Excel/HTML için ortak yol `server/lib/lcwai-output/`'tur: LCW AI
  yalnız içerik/yapı (HTML ya da sözleşmeli JSON) üretir; Buyer Log doğrular,
  onarım ister ve dosyayı kendi temasıyla (`export-document-palette.json` sabit
  paleti) oluşturur.
- AI HTML'i temizlenir, katı CSP ile sarılır ve ana DOM'a eklenmez; PDF, JS'i
  kapalı ve ağı engelli gizli pencerede (`buyerlog:render-pdf`) basılır.

## Model görselleri

- Bağlam CSV'sinde her kaydın anahtarı (`BL Image`, ör. `KOL-3`) bulunur; sohbet
  görselleri bu anahtarla etiketli paftalar hâlinde ek olarak yükler.
- Dosya çıktısında LCW AI görsel verisi değil anahtar yazar; Buyer Log kullanılan
  görselleri yerel depodan (kanonik çözümleyici) gömer.

## Veri paylaşımı

- Şirket/iş verisi yalnız şirket içi LCW AI'a bağlam olarak gidebilir (kullanıcı
  kararı); kimlik bilgisi oraya da gönderilmez.
