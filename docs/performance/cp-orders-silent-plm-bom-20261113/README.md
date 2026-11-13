# CP / Orders sessiz arka plan PLM BOM senkronu — L2 kabul

**Karar: BLOCKED** (Chromium kapıları PASS; Electron/Windows/kurumsal CoreNectum ölçülemedi).
Risk: **P1** (zamanlayıcı, PLM yükü, kurulum başına BOM deposu sıralaması).

- Taban Main: `390bff627d38cf4c8a57cf43b04e5974a2490b3d`
- Ölçülen aday kaynak: `4878669`. Ölçümden sonra tek runtime değişikliği: aç/kapa
  tercihinin `BLStorage` kullanıcı önekine alınması (`user-storage.js` önek listesine bir
  öğe, zamanlayıcıda depo seçimi). Açılış/kaydırma/yama yolunda iş değiştirmez; ölçüm
  tekrarlanmadı. Diğer sonraki commit'ler yalnız sürüm notu/PNG ve bu kanıt.
- Bütçeler uygulamadan/ölçümden önce: [budgets.json](budgets.json)
- Ortam: Linux bulut konteyneri, Node v22.23.4, Playwright Chromium headless, 1500×900,
  reduced motion. Gerçek Buyer Log sunucusu + istemcisi. Gerçek iş verisi, PLM veya LCW AI yok.
- Fixture: `scripts/benchmark-startup-orders.js` 30.000 satır sentetik kaynak, seed 7
  (xlsx SHA-256'ları [results.json](results.json) `fixture` alanında). Tüm koşular aynı kaynak
  baytlarını (`--source-fixture`) kullanır. CP: 24.982 satır, 3.150 benzersiz PLM ID.

## Sonuçlar (medyan; tüm ham değerler results.json'da)

| Kapı | Main | Aday | Karar |
| --- | ---: | ---: | --- |
| CP açılışı, uçtan uca ms (3 çift) | 10.708 | 10.634 | PASS |
| CP açılışı, uzun görev toplamı ms | 8.885 | 8.806 | PASS |
| CP açılışı, renderer RSS MB | 1.778 | 1.760 | PASS |
| Orders açılışı, uçtan uca ms (9 çift + A/A, n=12/9) | 4.395 (ilk 6) | 4.496 (ilk 6) | PASS (gürültü, aşağıda) |
| Orders açılışı, uzun görev toplamı ms (tümü) | ≈5.471 (n=12) | ≈5.426 (n=9) | PASS (gürültü, aşağıda) |
| CP 30k kaydırma, 60 adım toplam ms (3 çift) | 1.072 | 1.077 | PASS |
| CP 30k kaydırma, en uzun kare ms | 62 | 60 | PASS |
| CP 30k kaydırma, uzun görev | 0 | 0 | PASS |

**Orders gürültüsü.** İlk 3 dönüşümlü çiftte aday uzun görev toplamı Main'den yüksekti
(5.426/5.266/5.325 vs 5.220/5.225/5.097). Belge gereği 3 ek çift ve ardından Main/aday/Main
A/A turu koşuldu. Aynı Main kodunun iki kopyası 5.694 ↔ 5.842 ms medyan verdi (aralık
5.097–6.212); aynı turda aday 5.289 ms medyanla iki Main'in de altında kaldı. Tüm koşular
birleştirildiğinde fark A/A aralığı içinde ve yön tutarlı değil; tekrarlanabilir gerileme
izole edilmedi. Mekanizma olarak da açılış yolunda yeni iş yok: yeni betik yalnız bir
zamanlayıcı ve dört pasif giriş dinleyicisi kurar; CP/Orders projeksiyon yolu değişmedi.

**Kaydırma sınırı.** Tablo görünür dilimde 50 satır çizer; 60×500 px adımlar o dilimin
sonuna (1.475 px) kadar gider. Bu, aynı fixture'da Main ile aynı koşuldur; daha uzun
kaydırma (dilim genişletme) ölçülmedi.

## Yeni iş bütçeleri

- **Açılış ağı:** açılıştan sonraki gözlem penceresinde `/api/plm-sync/bom/silent/*`,
  CoreNectum veya LCW AI'a yeni istek 0 (yalnız Main'de de olan oturum koruyucu
  `status` çağrıları). İlk sessiz adım ≥4 dk sonradır (birim test). **PASS**
- **Hücre yaması (100 model → 901 değişen CP/Orders satırı):** ilk uygulamada iki uzun görev
  (69/98 ms) görüldü → **bütçe aşıldı, düzeltildi**: tarama 2.000 satırlık dilimlere,
  DOM yaması görev başına 6 satıra bölündü. Son: 3/3 koşuda **0 uzun görev**, toplam
  ~214–253 ms arka plan işi, tam yeniden çizim 0, aynı DOM düğümleri, kaydırma (400/200)
  ve satır seçimi korundu, hücre yeni değeri gösterdi. **PASS**
  (Profil: kalan büyük maliyetlerden `selection-action-bar` 700 ms yoklaması satır seçiliyken
  mevcut koddur; yamadan bağımsızdır.)
- **Sessiz koşu (birim test, sahte CoreNectum):** parti ≤100, 1 Style List + ≤100 BOM,
  BOM eşzamanlılığı 2, LCW AI 0, model başına günde ≤1 okuma, ilerleme/oturum-bekleme
  yazımı 0, iş kaydı geride kalmaz. **PASS (birim düzeyinde)**

## Ölçülemeyen kapılar (BLOCKED nedeni)

- Electron masaüstü (preload/native sekme) — bu Linux konteynerinde yok.
- Windows / SMB / kurumsal ağdaki gerçek CoreNectum yanıt süreleri ve gerçek 401/token
  yenileme davranışı — kurumsal PLM erişimi yok. Sessiz koşunun gerçek PLM yükü
  (model başına süre, toplam günlük tarama süresi) ölçülmedi.

## Komutlar

```
# Main worktree: git worktree add $SCRATCH/bl-main 390bff6 ; node_modules sembolik bağ
ab-open.sh         # CP+Orders, 3 dönüşümlü çift
ab-orders-extra.sh # Orders, 3 ek çift
ab-orders-aa.sh    # Orders, Main/aday/Main A/A
ab-scroll.sh       # CP 30k kaydırma, 3 dönüşümlü çift (ui-check.js --mode scroll)
node ui-check.js --mode patch      # hücre yaması (NOSELECT=1 zamanlama; seçimli doğruluk)
node ui-check.js --mode rowrefresh # mevcut tek satır yenileme referansı
node summarize.js
```
