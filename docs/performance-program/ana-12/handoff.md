# Ana sohbet ve kullanıcı üzerinden Claude paketi

## Kabul edilen entegrasyon sözleşmesi — uygulanmadı

Kullanıcı ana sohbetin aşağıdaki talebi kabul ettiğini bu sohbete iletti. Uygulama mevcut faz sırasını ve Faz 7'yi bekler.

1. Client sahibi bu çalışma: ortak isteğin subscriber/refcount yaşam döngüsü. İlk tüketicinin ayrılması diğerini etkilemez; son subscriber ayrılınca fetch abort edilir. Promise yaşam döngüsü kapanır; tekrar release idempotent olur. Lazy hazırlık sonrası artık tüketici kalmamışsa eski fetch başlatılmaz.
2. Backend sahibi ana sohbet: HTTP isteği ↔ mevcut ortak havuz job kimliği ve abort bağlantısı. Normal HTTP tamamlanması abort değildir. Response `finish`, erken/incomplete `close` ve aborted ayrımı doğrulanır.
3. Kuyruktaki iptal edilmiş job dispatch edilmez. Çalışan işte mevcut havuzun desteklediği gerçek iptal/supersession yolu ve gerçek durma kanıtı kullanılır. `AbortError`, promise rejection, çıktı yok sayma veya lease release tek başına CPU işinin durduğunu kanıtlamaz. Mevcut #885 active abort retire/terminate yolu cooperative cancellation diye sunulmaz.
4. Tek istek iptali ortak source generation'ını artırmaz. Diğer tüketicinin ortak hazırlığı/işi korunur. Scope, generation, query ve includeSourceDetails ayrımı korunur. Geç kalan sonuç cache'e veya ekrana yayımlanmaz. Yeni girişin Map kaydını eski finally silemez.
5. Tek/iki subscriber, ilk/son ayrılma, normal tamamlanma, queued/running abort, 10 hızlı değişim ve bütün varyantlar: [matrix.json](matrix.json). Gerçek son yanıt bağımsız uncancelled tam yanıt oracle'ıyla karşılaştırılır; probe işareti iş hesaplaması eşdeğerliği değildir.
6. Request/job ID bazında sent/admitted/started/completed/cancelRequested/cancelAcknowledged olayları; normal/queued/running sebebi; aktif/pending iş sayıları; iptal sonrası worker/process CPU ölçüm aralığı ve yükü kaydedilir. Shared HTTP okuyucularının ilk/son ayrılma senaryosu ayrıca çalışır. CPU işinin sürdüğü durum başarısız/unsupported diye raporlanır; sayaç uydurulmaz.

Hazırlık dalında `server.js`, `app-main.js`, compute ve Claude dosyaları değişmez. Yeni worker mekanizması, gerçek veri/credential, timeout artışı ve refresh POST retry yok. Backend job ölçümleri mevcut hazırlıkta `null` kalır.

## Tek bağımsız Claude turu için hazır istek

**Henüz gönderilmedi; inceleme yapılmış sayılmaz.** Kullanıcı üzerinden en fazla bir bağımsız tur. Yeni bağımsız ajan/Claude oturumu açılmadı. Üretim entegrasyonu yapılınca hazırlık incelemesi üretim P1 onayı yerine kullanılamaz.

> ANA-12 hazırlık PR'ının sabit head SHA'sını, baz `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` ile karşılaştır. Yalnız `docs/performance-program/ana-12` diff'ini ve bağlanan source SHA/anchor'larını incele. Üretim davranışı uygulanmadı. Kaynak bloklarının VM'de değişmeden çalıştığını, stub kapsamının açık olduğunu, 24 koşunun aynı fixture/kodla 3+3 A/A olduğunu, byte/parse/süre medyanlarının ham kayıttan çıktığını ve backend/job/iptal CPU iddiası yapılmadığını kontrol et. Refcount, tek/son subscriber, scope/generation/includeSourceDetails ve late-cache yarışları için test hazırlığının boşluklarını bildir. Özellikle AbortError veya generation ile sonucu yok saymanın kaynak iptali sayılmasına itiraz et. Tam regresyon şartı korunmalı; validator/test gevşetme önerme. P0/P1/P2 bulguları somut dosya/satır ve kanıtla tek turda ver. Kod yazma, rebase/force-push/merge/TEST/STABLE yapma.

EN: Backend integration was accepted by the main conversation via the user and remains unimplemented. The future client adapter owns subscriber cancellation; the main conversation owns actual HTTP-to-pool cancellation and job/CPU evidence. The quoted review request is prepared for at most one user-mediated independent Claude round; it has not been sent or completed.
