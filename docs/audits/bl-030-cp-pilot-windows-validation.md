# BL-030 · CP satır yaması pilotu (#1236) — Windows doğrulama planı

Durum: **Geçersiz kaldı (2026-11-28).** Ürün sahibi elle / gerçek veriyle doğrulamayı kaldırdı; pilot #1250 (main `d43150b`) ile varsayılan yapıldı ve `BUYER_LOG_CP_ROWPATCH_LEGACY` bayrağı **kaldırıldı**. Aşağıdaki bayrak açma/kapama adımları artık uygulanamaz.
Yerine: senaryolar (S1–S9) sentetik veri + otomatik doğrulamayla Windows/Electron otomatik kapısına (ADR-0001 §14 güncellemesi) taşınır. Güvenli tam hesap geri dönüşü korunur; çalışma zamanı anahtarı yoktur, geri dönüş = güvenli tam hesap + sürüm geri alma.
İlgili: #1236, #1250, #1241, #1243, ADR-0003 §6P/§6R. Aşağıdaki metin tarihsel kayıttır.

## Hedef: pilot bayrağı kalıcı değildir

1. Windows doğrulaması (bu belge) PASS olur.
2. Ayrı kararla varsayılan etkinleştirilir. Aynı PR'da `next.json` kaydı eklenir (`improvement`, `visual.kind="none"`, TR/EN gerekçe).
3. Gerçek kullanıcılarda kararlılık kanıtlanır.
4. Ardından bayrak ve kapalı dalı kaldırılır.

Korunacak olanlar:
- **Güvenli tam hesap geri dönüşü:** Zincir yoksa, öğe güvenli değilse veya doğrulama uyuşmazsa okuma kira + tam kurulum yoluna düşer.
- **Tek merkez alan kuralı:** `rowPatchIncrementalSafe` → `patchTouchesLogisticSegments`.

## 0 · Ön koşul

- Doğrulama yalnız **#1236'yı içeren bir derlemede** yapılabilir: main `5440fde` veya sonrası.
- **TEST 8.0.22 #1236'yı içermez.** Bu yüzden yeni bir TEST derlemesi gerekir. Bayrak kapalı olduğu için görünür değişiklik yoktur. Bu derleme ayrı karar ister.
- En az iki Windows bilgisayar ve iki kullanıcı. Gerçek veri yalnız kendi makinelerinizde kalır.
- Her test öncesi Buyer Log'u tamamen kapatın: pencere ve sistem tepsisi.

## 1 · Bayrağı açma / kapatma (her makinede)

PowerShell'de kullanıcı düzeyinde ayarlanır; yönetici gerekmez.

| İşlem | Komut |
|---|---|
| Aç | `[Environment]::SetEnvironmentVariable('BUYER_LOG_CP_ROWPATCH_LEGACY','1','User')` |
| Kapat | `[Environment]::SetEnvironmentVariable('BUYER_LOG_CP_ROWPATCH_LEGACY',$null,'User')` |
| Kontrol | `[Environment]::GetEnvironmentVariable('BUYER_LOG_CP_ROWPATCH_LEGACY','User')` → `1` veya boş |

Sonra Buyer Log'u **Başlat menüsünden** yeniden açın. Değişiklik uygulanmazsa oturumu kapatıp açın.

**Bayrağın etkin olduğunu doğrulama**
1. CP ekranında **F12** ile Geliştirici Araçları'nı açın, **Network** sekmesine geçin.
2. Bir Supp. FOB kaydı yapın.
3. Sonraki `cp/computed` isteğinin yanıtında `timing.service` alanına bakın:
   - **Bayrak açık:** `rowPatch: { steps: N, verified: … }` ve `leaseMs: 0`.
   - **Bayrak kapalı:** `rowPatch: { miss: … }`.

## 2 · Kayıt

Her senaryo için şunları not edin:
- sürüm,
- bayrak durumu,
- sipariş / model / renk,
- eski ve yeni değer,
- ekranda görünme süresi (yaklaşık, saniye),
- sonuç (PASS / FAIL).

Ek olarak `server-error.log` içinde **`cpRowPatchMismatch`** satırı olup olmadığına bakın. Bu satır, artımlı sonucun tam kurulumla uyuşmadığını ve güvenli yola düşüldüğünü gösterir; doğrulamada FAIL sayılır. Dosya, Buyer Log `logs` klasöründedir.

## 3 · Senaryolar

Her senaryoyu önce **bayrak KAPALI**, sonra **bayrak AÇIK** uygulayın. Aynı satırlar ve aynı işlem sırası kullanılır.

| # | Adım | Beklenen |
|---|---|---|
| S1 | Gerçek veride 3 satırda **tekli Supp. FOB** düzenleyin. | Değer CP ve Siparişler'de doğru. Bayrak açıkken CP daha hızlı veya en az aynı hızda. Siparişler yavaşlamaz. |
| S2 | 3 satırda **tekli not** düzenleyin. | S1 ile aynı. |
| S3 | **Toplu** kayıt: çoklu seçimle 5+ satıra Supp. FOB yapıştırın / toplu düzenleyin. Ayrıca 5+ satıra not girin. | Tüm satırlar doğru. Hiçbir satır eski değere dönmez. |
| S4 | **Farklı kullanıcılar:** A ve B makinesinde aynı siparişin farklı satırlarına, sonra aynı satıra Supp. FOB girin. Senkronu bekleyin (her iki tarafta en fazla ~5 dk + OneDrive). | Değerler iki makinede yakınsar, sessiz ezme yok. Çakışma varsa uygulamanın mevcut çakışma davranışıyla görünür. |
| S5 | **Ex-factory düzenlenebilen** bir satır seçin (yükleme onayı / otomatik tarih yok; hücre kilitli değil). Ex-factory'yi değiştirin. Sonra F12 → `cp/computed` yanıtına bakın. | Bayrak açıkken de `rowPatch.miss` (pilot yolu değil; güvenli tam kurulum). Ant. Arrival ve STATUS yeni tarihe göre doğru. |
| S6 | **Otomatik onaylı Ex-factory** taşıyan bir satırda Ex-factory'yi düzenlemeyi deneyin. | Düzenleme reddedilir / hücre kilitli. Değer değişmez. |
| S7 | **Del. Type** koruması: Bir satırda Del. Type'ı açıkça değiştirin (ör. Uçak). Aynı satırda yalnız not ve Supp. FOB kaydedin. | Del. Type değişmez. Not / FOB kaydı Del. Type göndermez. Ant. Arrival seçilen Del. Type'a göre kalır. Del. Type ve not cihazda yereldir; diğer makineye taşınmaz (mevcut politika). |
| S8 | **Kapat-aç veri eşitliği:** S1–S7 sonrası (bayrak açık) 5 satırın Supp. FOB, Not, Del. Type, Ex-factory, STATUS, Ant. Arrival ve Priority değerlerini not edin. Uygulamayı kapatıp açın. | Tüm değerler aynı. |
| S9 | **Güvenli dönüş:** Bayrağı KAPATIN, uygulamayı yeniden açın. Bu açılış tam hesap yoludur. S8'deki 5 satırı karşılaştırın. Sonra bir Supp. FOB kaydı daha yapın. | Değerler S8 ile birebir aynı. F12'de `rowPatch.miss`. Kayıt bugünkü davranışla çalışır. |

## 4 · Karar

- **PASS:**
  - S1–S9'un tamamı beklenene uyar.
  - Hiçbir değer kaybı, geri dönüş veya `cpRowPatchMismatch` yoktur.
  - Bayrak açıkken CP / Siparişler hiçbir senaryoda belirgin biçimde yavaşlamaz.
- **FAIL:** Herhangi bir veri farkı veya mismatch. Bayrak kapatılır (S9 adımı); bulgu, sürüm ve satır bilgisiyle bildirilir.
- **Ölçüm sınırı:** Elle süre ölçümü L2 yerine geçmez. Hız kararı Electron L2'ye (ADR-0003 §6P / PR #1236) dayanır. Windows bulgusu yalnız gerilemenin olmadığını ve doğruluğu gösterir.
