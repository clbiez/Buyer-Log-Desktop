# Buyer Log tasarım sistemi

> Kanonik görsel dil. Yeni ekran, modül veya stil değişikliği bu dosyaya uyar.
> Uygulama koduyla çelişirse kodu esas al ve bu dosyayı aynı PR'da düzelt.
> Bekçi: `tests/design-token-guard.test.js` (`npm test` içinde koşar).

## 0 · İlke

**Refined Industry.** Açık ve sakin bir çalışma zemini, tek çelik mavisi vurgu,
saç teli çerçeveler, köşeli geometri, yoğun ama okunur veri. Görsel karar
modülde verilmez, token'da verilir. Bir modülün "kendi stili" yoktur.

## 1 · Katmanlar ve yükleme sırası

| Katman | Dosya | Görev |
| --- | --- | --- |
| Temel | `public/app.css` | Ölçek token'ları (`--fs-*`, `--r-*`, `--sp-*`, `--ctl-h`), kabuk ve ortak bileşenler |
| Modül | `public/<modül>.css` | Yalnız düzen. Renk, yazı boyutu, köşe ve aile **token'dan** gelir |
| Tema | `public/design.css` | Industry paleti, tipografi, tablo başlığı (`--thead-*`) ve rozet renkleri |
| Uyum yaması | `public/design-butunluk.css` | Eski modülleri tema diline çeken geçici eşleme; büyütülmez |
| Deneyim | `public/experience.css` | Primitive → semantic → component token'ları (`--bl-*`), hareket, odak, yüzey |

Kurallar:
- Yeni bir "katman" veya tema dosyası açılmaz. Yeni modül CSS'i token tüketir, token tanımlamaz.
- Renk paleti yalnız `design.css` / `experience.css` içinde (açık, `grey`, `dark`) tanımlanır.
- Giriş sayfası (`select-user.html` → `giris.css`) app.css'i yüklemez; ölçeği `giris.css` içinde aynı değerlerle tanımlar.

## 2 · Yazı ölçeği

Tüm boyutlar `calc(Npx + var(--ui-font-add))` biçimindedir; böylece
**Arayüz boyutu** ayarı (Kompakt / Standart / Büyük / Çok Büyük) ekrandaki her
metni aynı oranda değiştirir. Sabit `px` yazı boyutu yasaktır.

| Token | Standart | Kullanım |
| --- | --- | --- |
| `--fs-2xs` | 10.5px | Tablo başlığı, sayaç, mikro etiket |
| `--fs-xs` | 11.5px | Yardımcı metin, rozet, form etiketi |
| `--fs-sm` | 12.5px | Tablo hücresi, düğme |
| `--fs-base` | 13px | Gövde metni |
| `--fs-md` | 14.5px | Kart başlığı |
| `--fs-lg` | 16px | Bölüm başlığı |
| `--fs-xl` | 20px | Sayfa başlığı, KPI değeri |
| `--fs-2xl` | 24px | Büyük KPI |
| `--fs-3xl` | 30px | Sayfa içi kahraman başlık |
| `--fs-4xl` | 40px | Tek odak sayı (ör. halka grafiğin merkezi) |

`font:` kısayolu da token kullanır: `font:600 var(--fs-sm)/1.2 var(--sans)`.

## 3 · Köşe

Industry dili köşelidir: `--r-xs … --r-xl` ve `--r-full` değerleri **0**'dır.
Köşe kararı tek yerden değişir; modül sabit `px` yarıçap yazmaz.

Bilinçli istisnalar:
- `--r-pill` (999px): kapsül tutamak, anahtar (toggle), kaydırıcı başlığı, sürükleme tutamağı.
- `--r-round` / `50%`: avatar, durum noktası, dairesel ikon düğmesi.

Çip, rozet, düğme, sekme ve kart istisna değildir; köşelidir.

## 4 · Yazı ailesi

| Token | Kullanım |
| --- | --- |
| `--sans` (Barlow) | Tüm arayüz metni |
| `--head` | Başlıklar. Refined Industry'de `--sans` ile aynıdır (experience.css) |
| `--mono` (Cascadia Code) | Kod, sipariş/PLM kimliği, hizalı sayı sütunu |

Aile listesi (`"Barlow Condensed",…`) yalnız token tanımında ve `@font-face` içinde yazılır.
`--font` ve `--heading` eski takma adlardır; yeni kodda kullanılmaz.

## 5 · Renk

- Yüzey: `--paper` (sayfa), `--card` (kart), `--card2` (ikincil), `--pop` (açılır yüzey).
- Metin: `--ink`, `--ink2`, `--muted`. Çizgi: `--line`, `--line2`, `--hair`.
- Vurgu: `--acc`, `--acc-bg`, `--acc-ink`, `--on-acc`, `--acc-hover`.
- Durum: `--red`, `--orange`, `--yellow`, `--green` ve `*-bg` eşleri. Durum rengi vurgu değildir.
- Doygun dolgu üzerindeki yazı `--on-solid`; modal/katman perdesi `--scrim`; gölge yalnız `--shadow-1|2|3`.
- Grafik: kategorik `--chart-1 … --chart-8` (açık + karanlık değerler). Palet dataviz
  doğrulayıcısından geçmiştir (renk körlüğü ΔE ≥ 8, normal görüş ΔE ≥ 15); sıra sabittir,
  JS grafikleri değeri `getComputedStyle` ile okur. Backlog aşama renkleri ayrı ve anlamsaldır
  (`BLBacklogV3Report.STAGES`).
- **Dokunulmaz:** `--thead-bg`, `--thead-ink` ve rozet renkleri. Excel'e Aktar / Kopyala
  hücre rengini canlı DOM'dan okur; bu değerleri değiştirmek dışa aktarılan dosyayı değiştirir.
  Excel yeşili (`#217346`), baskı stilleri, e-posta HTML'i ve pano/Excel HTML'i de bilinçli
  olarak ham renk kullanır (Outlook ve Excel CSS değişkeni okumaz).
- Yeni ham renk kodu (`#hex`, `rgb()`, `hsl()`) eklenmez. Mevcut ham renkler dosya başına
  `tests/fixtures/design-color-baseline.json` tavanıyla dondurulmuştur; tavan yalnız düşer.
- Kullanılan her `var(--x)` tanımlı olmalıdır (CSS'te ya da JS `setProperty` ile). Tanımsız
  değişken geçersiz değer üretir: zemin şeffaf kalır, fallback her temada aynı renge düşer.
  `--bg`, `--surface`, `--warn`, `--ok`, `--accent` gibi takma adlar kullanılmaz.

## 6 · Tema

Üç tema aynı token adlarını yeniden tanımlar: açık (varsayılan), `html[data-theme="grey"]`
(Kurşun), `html[data-theme="dark"]`. Bileşen kuralı tema seçicisi içinde renk yazmaz;
yalnız token kullanır. Yeni bileşen üç temada da ekran görüntüsüyle doğrulanır.

## 7 · Bileşen sözleşmeleri

Eşdeğer modül bileşenleri `experience.css` sonundaki **BİLEŞEN SÖZLEŞMELERİ** bölümünde tek
kuralda toplanır (`tests/ui-component-contract-v20261015.test.js`). Modül CSS'i bu bileşenlerin
yüksekliğini, yazısını, çerçevesini ve aktif durumunu yeniden tanımlamaz; yeni bir eşdeğer
bileşen sözleşme seçicisine eklenir.

| Bileşen | Sözleşme |
| --- | --- |
| Düğme L | Ana eylem: `--ctl-h`, `--fs-xs` 600. Birincil = dolu `--acc` (ekranda tek). |
| Düğme S | Kart içi eylem: `--ctl-h-sm` (= `--ctl-h` − 8px, arayüz boyutuyla büyür). |
| Segment | Tek seçim: saç teli kap, S yükseklik, aktif seçenek dolu `--acc` / `--on-acc`. |
| Filtre çipi | Çoklu seçim / süzgeç: köşeli, S yükseklik, aktif = `--acc-bg` + `--acc` çerçeve. |
| Sayfa sekmesi | Sayfa içi gezinme: alt çizgi, zemin yok, aktif = `--acc` alt çizgi. |
| KPI kartı | Etiket `--fs-xs` 600 `--ink2`; değer `--fs-2xl` 700 `--sans` `tabular-nums`; alt satır `--fs-xs` `--muted`. Değer rengi yalnız durum taşıyorsa değişir. |
| Sayfa başlığı | Yalnız üst çubukta (`#pageTitle`); sayfa içinde tekrar yazılmaz. |
| Boş durum | Tek ikon + başlık + tek cümle + en fazla bir eylem. |
| Tablo | Başlık `--thead-*`, satır `--table-row-h`, sayılar sağa hizalı ve `tabular-nums`. |
| Gizli öğe | Sınıfı `display` tanımlıyorsa `.sınıf[hidden]{display:none}` de tanımlanır. |

## 8 · Hareket ve erişilebilirlik

- Süreler `--bl-motion-fast|standard|enter`, eğri `--bl-ease`. Kullanıcının tema
  seçimindeki dalga `--bl-motion-theme` süresini kullanır; `theme-transition.js`
  mevcut üç paleti yerel View Transitions görüntüleriyle değiştirir. Başlangıçta,
  azaltılmış harekette ve API yoksa mevcut hızlı geçiş yolu kullanılır. Sayfa, açılır yüzey, diyalog ve çekmece
  ortak `blViewIn / blPopoverIn / blDialogIn / blDrawerIn` animasyonlarını kullanır.
- `prefers-reduced-motion` her yeni animasyonda desteklenir.
- Odak halkası `--focus-ring`; `outline:none` yalnız eşdeğer bir odak göstergesiyle.
- Her görünen metin TR/EN çiftidir (CLAUDE.md §4.1). Kod, ülke kodu, kimlik gibi çevrilmeyecek
  metin `data-no-i18n` taşır.

## 9 · Uygulama düzeyi desenler

- **Komut paleti** (`command-palette.js`): Ctrl+Shift+K. Ctrl+K mevcut "CP Tracker'da ara"
  kısayoludur. Başlıkta görünür arama kutusu yoktur (v7.26 kullanıcı kararı).
- **Kompakt ray:** dar modda üzerine gelince/odaklanınca etiketler içeriği itmeden açılır
  (`--rail-full-w`); genişleyen ray üst çubuğun önündedir (`z-index:301`).
- **KPI sayacı** (`kpi-motion.js`): modül açılışında sayar, sonunda özgün metne döner.
- **Sunum raporu** (`backlog-presentation-report.js`): saf üretici; JS kapalıyken tam, katı CSP,
  dış kaynak yok. Uygulamada `allow-same-origin` olmadan iframe'de; PDF `buyerlog:render-pdf`.

## 10 · Bilinen borç (2026-10-16)

- **z-index:** 98 farklı değer. Katmanların (menü, modal, bildirim, kilit perdesi) üst üste
  açılma sırası davranış testiyle doğrulanmadan kademeye sıkıştırılmadı. Önerilen kademeler:
  içerik 1–10 · yapışkan 30 · ray 60 · üst çubuk 300 · açılır 1000 · modal 10000 · bildirim 12000+.
- **Bileşen kopyaları:** sözleşme görünümü tekleştirdi, ama modül sınıfları (133 düğme,
  81 çip/rozet sınıfı) hâlâ ayrı. Yeni ekranlar mevcut sınıfları kullanmalı.
- **Veri gösterimi:** ülke adları kaynaktaki gibi (TURKIYE / Georgia) karışık yazımda.
- **LFL Üretici Sipariş Hacimleri:** dar bölmede sütun başlıkları harf harf kırılıyor (CP tablo motoru).
- **Ham renk:** `app.css` 48, `giris.css` 68 (bağımsız giriş sayfası paleti) — tavanlı.
