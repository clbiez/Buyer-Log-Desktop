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
- **Dokunulmaz:** `--thead-bg`, `--thead-ink` ve rozet renkleri. Excel'e Aktar / Kopyala
  hücre rengini canlı DOM'dan okur; bu değerleri değiştirmek dışa aktarılan dosyayı değiştirir.
- Yeni ham renk kodu (`#hex`, `rgb()`, `hsl()`) eklenmez. Mevcut ham renkler dosya başına
  `tests/fixtures/design-color-baseline.json` tavanıyla dondurulmuştur; tavan yalnız düşer.

## 6 · Tema

Üç tema aynı token adlarını yeniden tanımlar: açık (varsayılan), `html[data-theme="grey"]`
(Kurşun), `html[data-theme="dark"]`. Bileşen kuralı tema seçicisi içinde renk yazmaz;
yalnız token kullanır. Yeni bileşen üç temada da ekran görüntüsüyle doğrulanır.

## 7 · Bileşen sözleşmeleri

Her biri için **tek** varyant hedeflenir. Modüle özel kopya açılmaz.

| Bileşen | Sözleşme |
| --- | --- |
| Düğme | Yükseklik `--ctl-h`; ikincil = saç teli çerçeve, birincil = dolu `--acc` (ekranda tek). |
| Sekme / segment | Ekran içi görünüm değişimi tek segment kontrolüyle; alt çizgili sekme yalnız sayfa düzeyi gezinmede. |
| KPI kartı | Etiket `--fs-xs` `--ink2`, değer `--fs-xl`/`--fs-2xl` `--sans` 700, alt satır `--fs-xs`. Renkli üst çizgi yalnız durum taşıyorsa. |
| Sayfa başlığı | Başlık yalnız üst çubukta (`#pageTitle`); sayfa içinde aynı başlık tekrar yazılmaz. |
| Çip / rozet | Köşeli, `--fs-xs`, durum rengi `*-bg` zemin + `*` metin. |
| Boş durum | Tek ikon + başlık + tek cümle + en fazla bir eylem. |
| Tablo | Başlık `--thead-*`, satır yüksekliği `--table-row-h`, sayılar sağa hizalı ve `tabular-nums`. |

## 8 · Hareket ve erişilebilirlik

- Süreler `--bl-motion-fast|standard|enter`, eğri `--bl-ease`. Sayfa, açılır yüzey, diyalog ve çekmece
  ortak `blViewIn / blPopoverIn / blDialogIn / blDrawerIn` animasyonlarını kullanır.
- `prefers-reduced-motion` her yeni animasyonda desteklenir.
- Odak halkası `--focus-ring`; `outline:none` yalnız eşdeğer bir odak göstergesiyle.
- Her görünen metin TR/EN çiftidir (CLAUDE.md §4.1). Kod, ülke kodu, kimlik gibi çevrilmeyecek
  metin `data-no-i18n` taşır.

## 9 · Bilinen borç (2026-10-15 denetimi)

- Bileşen varyantları: 133 düğme sınıfı, 194 kart/panel sınıfı, 81 çip/rozet sınıfı, 37 KPI sınıfı.
  §7'ye göre tekleştirilecek.
- Sayfa başlığı tekrarı: Fiyat & Üretici Analizi, Lisans kartları, Veri Yönetimi.
- `app-main.js` içinde ~215 satır içi `style="…"` ve ham renk; JS'te üretilen renkler token'a taşınacak.
- `app.css` 212, `giris.css` 67 ham renk kullanımı (tavanlı).
