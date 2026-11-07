# ADMIN-03 prerequisite: current authority at a resumed request gate

## TR

Risk **P1**. Bu düzeltme ADMIN-03 performans optimizasyonundan ayrıdır. Kaynak
tabanı Main `63159fb32ff3d5bdc5f142b4a8f16ca6a3983240`; hazırlık #897,
`40706d9b` içindeki sentetik fixture yeniden kullanıldı. Gerçek kullanıcı,
iş verisi, servis veya credential kullanılmadı.

**[Doğrulandı]** `requireSelection` sonrasında bekleyen bir isteğin
`req.currentUser` kopyası, yerel veya merkezi IAM'de `USER.GRANT` kaldırıldığında
eski yetkiyi taşıyabiliyordu. Yeni istek reddedilirken bekleyen istek kapıyı
geçiyordu. Bu middleware sıralaması gerçek modülle doğrulanmıştır; dağıtılmış
bir endpoint'in istismarı kanıtlanmış değildir. Geçmiş hazırlık kanıtları #897'de
korunur.

Altı yetki kapısı artık mevcut imzalı oturumu ve güncel dizindeki profili yeniden
doğrular. Yetki hesabı ve profil aynı store nesnesini kullanır. Profil isteğe
özel kopya olarak kalır. Doğrudan yetki veya rol değişikliği tek başına geçerli
oturumu düşürmez; silinmiş/pasif hesap ve değişmiş parola kuşağı reddedilir.
İzin kodu, hata kodu ve cevap metinleri değişmedi. Revision tabanlı uzun ömürlü
effective-permission cache eklenmedi. `server.js`, compute, istemci üretim kodu
ve ADMIN-03 performans yolları değiştirilmedi.

### Gerçek RED → GREEN

Değişmemiş standart `node --test --test-reporter=tap` ile aynı son 16 test:

- Main üretim modülü: **2 PASS / 14 FAIL / 0 SKIP**.
- Düzeltilmiş üretim modülü: **16 PASS / 0 FAIL / 0 SKIP**.
- `red-final-isolated-native.*` ve `green-final-isolated-native.*` aynı test
  SHA-256'sını, ayrı kaynak SHA-256'larını, komutu ve izole TMPDIR'ı kaydeder.
- Yerel/merkezi revoke, merkezi parola değişimi, rol düşürme, altı kapıda eski
  parola/çerezsiz profil, pasif/silinmiş hesap, değişmeyen oturum, özel kopya ve
  aynı store revizyonunda grant başlangıç/bitiş sınırları kapsanır.

İlk hazırlıktaki doğrudan `credentialRevision` artırımı gerçek parola değişimi
değildi: durable writer, kuşağı hash değişiminden türetir. Test gerçek sentetik
parola hash'ini değiştirir ve kaydedilmiş kuşağın ilerlediğini ayrıca doğrular.
Ardışık sentetik merkezi hub'lar için önceki fixture'ın `.bak`/`.meta.json`
kurtarma kopyaları temizlenir; üretim kurtarma/izin kontrolü kapatılmaz.
Önceki başarısız loglar silinmedi veya yeni GREEN diye etiketlenmedi.

Bu ortamın filesystem sandbox'ı Node alt süreçlerinin stdio aktarımını EPERM
ile bozuyordu; en küçük bağımsız Node örneğiyle ayrıştırıldı. Standart runner
değiştirilmeden, aynı sentetik köklerde sandbox dışında çalıştırıldı.
`--test-isolation=none` denemeleri yalnız teşhis olarak saklanır, kabul değildir.

İlgili ilk paket (önceki 13 test dahil): **19 dosya / 117 PASS**. Son ilgili
paket, tam standart `npm test`, i18n ve release-note sonuçları son kabul kaydında
tamamlanacaktır. Önceki sonucu son 16-test kodunun tam regresyonu sayma.

### Görsel ve entegrasyon sınırı

TR/EN gerçek Buyer Log ekranları headless Chromium'da, 1560×1000 ve
reduced-motion ile alınıp agent tarafından incelendi. Sürüm notu yalnız bu
düzeltmeye ait kaydı ekler; Main'in 38 kayıt nesnesi korunur. Ekran güncel
profilin yetki listesini gösterir; bekleyen isteğin reddini resim değil native
testler kanıtlar. `ui-verification.json` ve PNG SHA'ları kanıt dizinindedir.

Bu değişiklik, bir kapıyı geçtikten sonra bekleyen her route'a yeni commit
guard eklediği iddiasını taşımaz. Mevcut merkezi transaction/compute/import
kontrolleri korunur. #897'deki hiyerarşi/publicProfile performans işi açık
kalır. Ölçülmüş hızlanma veya genel performans kabulü iddia edilmez.

Tek bağımsız ikinci model incelemesi ve son SHA'nın gerçek CI sonucu merge
öncesinde tamamlanmalıdır. **Merge yok; TEST yok; STABLE yok.**

## EN

**P1 security prerequisite, separate from ADMIN-03 performance optimization.**
The baseline is Main `63159fb3`; the synthetic fixture from preparation #897 is
reused. Native code confirms that a request suspended after selection could
retain revoked authority in its copied profile even while fresh requests were
denied. This demonstrates a middleware ordering flaw, not a proven deployed
endpoint exploit.

All six authorization gates now revalidate the signed session against the
current directory. Permission evaluation uses the same directory object, and
the request still receives a private profile copy. Access/role changes retain
otherwise valid sessions; changed credentials and disabled/deleted accounts
fail closed. Permission codes, error responses, central transactions and
compute/import guards remain unchanged. No long-lived permission cache, server
route, client production, or performance optimization was added.

The identical final 16 tests produce **2 PASS / 14 FAIL** against Main and
**16 PASS / 0 FAIL** against the fix with the unchanged standard native runner.
The evidence records source/test SHA-256, command and isolated temporary roots.
Coverage includes local/central revocation, central credential replacement, role
downgrade, every gate's credential/cookie rejection, active sessions, private
copies, and grant time boundaries without revision changes. Invalid early
fixture attempts and sandbox-only runner failures remain explicitly historical.
Credential tests change actual synthetic hashes and verify the writer-derived
generation, rather than manually bumping a field the writer owns.

The first related package passed **117 tests** before three additional cases.
Final related/full-suite, i18n, release-note and actual CI results remain a
separate acceptance record until completed. Inspected TR/EN screenshots come
from the actual isolated demo application; pending-request rejection is proven
by tests, not the screenshot. Main's existing 38 note objects are preserved.

No real data, credentials, services, migration, deployment, or performance gain
claim. ADMIN-03 performance work remains open. One independent second-model
review and final-head CI are required before merge. **No merge, TEST or STABLE.**
