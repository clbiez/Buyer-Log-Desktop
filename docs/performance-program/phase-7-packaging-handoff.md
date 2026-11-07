# Faz 7 · Paketleme ve devir / Packaging and handoff

**Kapsam sabit:** yalnız paketleme ve doğrulama. Üretim/test dosyası değişikliği, yeni optimizasyon, performans koşusu veya yeni genel bağımsız review yok. / Packaging and validation only; no production/test edits, optimization, performance rerun or general review round.

## PR sahipliği / Ownership

- [#913](https://github.com/clbiez/Buyer-Log-Desktop/pull/913): eski ortak 12 doküman/artefakt/benchmark dosyasının tek sahibi; ayrıca ortak paketleme/devir kaydı ve bağımlı PR'lar için CI hedef filtresi.
- #909/#910/#911'in hedefi `perf/phase7-shared-evidence`. Ortak dala göre sırasıyla **6 / 5 / 4** dosya; yalnız kendi üretim/test deltaları. Dört PR'ın changed-files kümeleri ikili olarak ayrık.
- Ortak dal üretim dallarına normal merge ile alındı; rebase/force-push yok. Aşağıdaki eski review head'lerinin tamamı nihai üretim head'lerinin ancestor'ı. Üretim dallarının sabit ortak parent'i `ae6dd38b326780bf55125ea5f8eabb1703d9d744`.
- Sonraki ortak kapanış commit'i yalnız doküman/log kanıtı taşır. Üretim head'lerini tekrar değiştirmez. / Closing evidence advances only the common documentation branch; production heads stay fixed.

## Her nihai dalın tam regresyonu / Full regression per final production head

Her dalda kendi `resources/app` dizininde, kendi ortak preload dosyası ile **ayrı ve sırayla** `npm test` çalıştı. Tablodaki üç sonuç birleşik ağaçtan türetilmedi. / Three separate full runs on the exact heads below, not inferred from the combined run.

| PR | Nihai üretim SHA / Final production SHA | Dosya / Files | PASS | fail / cancel / skip | Gerçek GitHub checks |
| --- | --- | ---: | ---: | ---: | --- |
| [#909](https://github.com/clbiez/Buyer-Log-Desktop/pull/909) | `634ac27dcdeb0a5655e37c1c5b08f9aba5fa6ef0` | 1291 | 8855 | 0 / 0 / 65 | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42402759996) |
| [#910](https://github.com/clbiez/Buyer-Log-Desktop/pull/910) | `845f10b0bcd6cc2ea67bc2239909af960876fa8c` | 1291 | 8858 | 0 / 0 / 65 | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42402761355) |
| [#911](https://github.com/clbiez/Buyer-Log-Desktop/pull/911) | `5a2166cfc6ec54d21134d45df5dc9287aa981505` | 1290 | 8847 | 0 / 0 / 65 | [SUCCESS](https://github.com/clbiez/Buyer-Log-Desktop/actions/runs/42402759496) |

Her dalda i18n, mevcut release-note validation, dependency inventory ve diff kontrolleri exit 0. 65 platform/opt-in skip her dalda ayrı raporlanır; Windows veya soak doğrulaması yapılmış sayılmaz. GitHub fast checks gerçek son head'lere aittir; yerel tam regresyonun yerine sunulmaz.

Tarihsel **birleşik ağaç**: 1.294 dosya / 8.872 PASS / 0 fail / 0 cancel / 65 skip, üretim kaynak commit'i `ee18c4c595e1764c19ad3a31bd9aba892d5b4fe6`. Eski tam log ve SHA'ları korunur; bu sonuç bağımsız dal regresyonu diye sunulmaz.

İlk #909 tam denemesi, worktree dependency symlink'lerinin installer fixture ZIP'ine alınmaması nedeniyle iki testte durdu (`INSTALLER_DEPENDENCIES_MISSING: resedit`). Bu koşu arşivde `attempt-1-linked-deps/` altında durur. Yalnız ignored node_modules dizinleri mevcut bağımlılıkların gerçek kopyalarıyla hazırlandı; installer/test/üretim kodu ve kilit dosyaları değiştirilmedi. Aynı installer paketi 4/4 geçti; ardından yukarıdaki üç tam çevrim alındı. / The retained failed attempt was dependency setup, fixed with actual local dependency files, without changing assertions or production.

## Mevcut bağımsız incelemenin taşınması / Existing review correspondence

| PR | İncelenen üretim kaynak commit'i | Eski review head | Nihai PR head | Kontrol |
| --- | --- | --- | --- | --- |
| #909 | `109292a1f9008ffccbd48a481cdacc2a1d343f54` | `3390971d7530a6bd83b2cb4f90c0205142339649` | `634ac27dcdeb0a5655e37c1c5b08f9aba5fa6ef0` | aynı blob + diff SHA / identical |
| #910 | `384fea2cd5ba368cb07ec864723961165dd55b17` | `71c403275f6caafa6a92750b9357af246c4042fb` | `845f10b0bcd6cc2ea67bc2239909af960876fa8c` | aynı blob + diff SHA / identical |
| #911 | `ee18c4c595e1764c19ad3a31bd9aba892d5b4fe6` | `5789337dfa606123f43eb6b7572868c70b9f163f` | `5a2166cfc6ec54d21134d45df5dc9287aa981505` | aynı blob + diff SHA / identical |

İncelenmiş **9 üretim dosyası**, ayrıca **6 test/helper** dosyası Git blob ve sha256 ile birebir aynı. Her üretim kapsamının eski review kaynağına göre diff SHA256'sı yeni ortak-base diff SHA256'sıyla aynı. Dosya bazında eşleştirme ve ancestor sonucu [JSON kanıtında](phase-7-artifacts/final-branch-validation.json). Yeni genel ikinci model turu başlatılmadı.

Kapasite P1'inin önceki RED → GREEN ve gpt-6-astra **11/11** kapanış kanıtı korunur. Eski tanı arşivi SHA256 `6a42c9b638e6e12a23579da880283d196e5e17c20235e659c1885785837e5d59`; performans JSON'u, PNG'ler ve benchmark/probe/preload dosyalarının orijinal hash'leri değişmedi. / Original review closure and measurements remain intact; this is a correspondence check, not a new review.

## Kabul ve açık kalan işler / Acceptance and remaining work

- **DS-08, INT-04/05, INT-11:** uygulandı; **son kabul bekliyor** / implemented; final acceptance pending.
- **DS-11 ve INT-07:** gerekli ortam ölçülemedi; **açık** / required environment measurement unavailable; open.
- **INT-10:** upstream kapasitesi/kazanç doğrulanmadı; **açık** / upstream capacity/gain unverified; open.
- **ADMIN-02:** güvenli kazanç gösteren aday yok; **kontrol koşuları hızlanma kanıtı değil** / no candidate showing safe gain; controls are not speedup evidence.

DS-08 tarihsel toplam süre **374.920 → 404.012 ms (+%7,76)**, süreç tepe RSS **273.508 → 289.195 MiB**. Fallback eski MAIN stall'ını koruyabilir. Son kabul verilmiş sayılmaz. Gerçek SMB/PLM veya Windows kabulü iddia edilmez.

## Sonraki adım / Next step

P1 PR'ları merge öncesinde durur; #913 de taslaktır. Sonraki sohbet kullanıcı kabulünden sonra önce ortak #913'ü ele alır; üretim PR'larının hedefi daha sonra main'e çevrilebilir. Bu taşıma için rebase/force-push gerekmez. Bu SHA'lardan sonra üretim/test/runtime tabanı değişirse gerekli doğrulamalar yeni ağaç için yeniden değerlendirilir; eski test sonucu yeni kod sonucu değildir.

**Merge yapılmadı. TEST yayımlanmadı. STABLE yayımlanmadı.** `public/**` aynı. / No merge or TEST/STABLE publication; client files unchanged.

[Makinece okunur sonuç ve dosya eşleştirmesi](phase-7-artifacts/final-branch-validation.json) · [Tam loglar ve saklanan başarısız kurulum denemesi](phase-7-artifacts/final-branch-validation.tar.gz) · [Ölçüm raporu](phase-7-server-report.md).
