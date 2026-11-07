# ADMIN-03 — Faz 7 öncesi tanı / preparation

**DUR / STOP:** Yerel ve merkezi bekleyen-istek güvenlik kapıları RED. Üretim uygulaması ve kabulü bloke. Sonuçlar: [RESULTS.md](RESULTS.md). / Both pending-request security gates are RED; implementation and acceptance are blocked.

TR: Üretim uygulaması yok. `user-access.js`, `iam-core.js`, `server.js`, `app-main.js`, ortak compute ve Claude dosyaları değiştirilmez. Ayrı dal `diag/admin-03-preparation`; baz `5a1656e98deeb573f6245f4b24a8135cc77a0d7b` (#892 dahil). #892'nin app-main kilit istisnası kullanılmadı. İnceleme SHA'ları taşınmadı; rebase/force-push yok.

EN: Diagnosis, synthetic fixtures and acceptance tests only. Production implementation waits for Phase 7. Both current measurement arms contain the same #892 code. No review SHA was moved, no rebase/force push, no merge or TEST/STABLE publication.

## Kaynak doğrulaması / source evidence

- `user-access.js:371–465`: legacy ağaç yalnız `supervisorId` kullanır; IAM ağacı `managerId || supervisorId` kullanır. Aynı indeksle koşulsuz birleştirmek eşdeğer değildir. / The two hierarchy traversals have different parent precedence.
- `user-access.js:1107–1135`: public DTO, TEAM scope + legacy permissions/areas + capabilities + descendants + canAdmin türetir. / The DTO repeatedly derives scopes, permissions and descendants.
- `iam-core.js:348–405,428`: her effective-permission hesabı hiyerarşi haritası kurar; TEAM scope her çocukta büyüyen scope dizilerini tekrar unique eder. / Each permission derivation rebuilds a hierarchy index; TEAM scopes repeatedly deduplicate growing arrays.
- `user-access.js:1533–1566,1666`: gerçek admin handler profil DTO'ları üretir; `canManageTarget` her hedefte moderatörün yetkisini yeniden hesaplar. Admin listesini `allPublicProfiles` taklidiyle ölçmedik. / The real admin handler also recalculates actor rights per target.
- `user-access.js:594–820`: `readStore` dosya imzasıyla paylaşılan salt-okuma nesnesi döndürür; sıcak yolda tüm JSON yeniden okunuyor iddiası yok. `loadStore` yazıcıya özel kopya verir. / Warm reads already share the store; writers retain an isolated copy.
- `user-access.js:1319–1333,1499–1525`: seçim middleware'i profili kopyalar; sonraki yetki kapısı `req.currentUser` varsa onu kullanır. Bekleyen istek kapısı ayrı ve zorunlu test edilir. / A selected request retains a copied profile; the resumed-request acceptance gate is separate and mandatory.

## Dosya kilitleri / coordination

Başlangıçta GitHub'da açık PR'ların tüm değişen dosya listeleri okundu: #885, #890, #891, #893. #885 `user-access.js`, `server.js`, `app-main.js` ve compute/test yollarını tutuyor; #890 INT-06, #891 Faz 6a, #893 FX tanı dosyalarını tutuyor. Bu paket yalnız yeni `admin-03` yollarını ve yeni test/fixture dosyalarını ekler. Worker oluşturulmadı; mevcut havuza iş gönderilmedi. Yeni çakışma için PR öncesi kilitler yeniden kontrol edilir.

EN: All open PR file lists were checked. The package adds only its own new diagnostic and test paths, uses no application worker and does not modify protected/shared files.

## Tekrar üretme / reproduce

Repo kökünden; bağımlılıklar mevcut `resources/app/node_modules` içindir. Kökler `mkdtemp` ile `/tmp/buyerlog-admin03-*` altındadır; auth/server aynı sentetik kökü kullanır. App/local/config/portable/temp/shared kökleri de izoledir. Gerçek kullanıcı deposu veya credential yok; bekleyen istek testinde yalnız sentetik parola kullanılır. / All data roots are isolated, with synthetic credentials only.

```sh
node docs/performance-program/admin-03/measure.cjs --trace --out docs/performance-program/admin-03/artifacts/trace.json
git worktree add --detach /workspace/admin03-baseline 5a1656e98deeb573f6245f4b24a8135cc77a0d7b
NODE_PATH="$PWD/resources/app/node_modules" node docs/performance-program/admin-03/measure.cjs --source /workspace/admin03-baseline --label before --run 1 --out docs/performance-program/admin-03/artifacts/before-1.json
node docs/performance-program/admin-03/measure.cjs --source "$PWD" --label after --run 1 --out docs/performance-program/admin-03/artifacts/after-1.json
node docs/performance-program/admin-03/summarize.cjs
node --test resources/app/tests/admin-03-preparation.test.js
node --test docs/performance-program/admin-03/pending-request.test.cjs
```

Ölçüm sırası AB/BA/AB, her kolda üç yeni süreç. 30/100/300 kullanıcı, 3/4/6 fanout ve ayrıca 100 derinliğinde zincir; moderatör sayıya ilave. Her süreç/senaryo publicProfile 5 ısınma + 60 örnek; admin 2 ısınma + 20 örnek. Public hedef `u0`: legacy manager, system buyer, açık TEAM scope. Admin aktör moderatör. Nearest-rank p50/p95'in üç koşu medyanı raporlanır. Yanıt hash'i ölçülen aralığın dışındadır. HTTP, JSON serialization, tarayıcı, network/SMB, Windows/Electron ve soğuk OS cache ölçümü değildir. GC zorlanmaz. Hiç refresh POST yapılmaz.

EN: AB/BA/AB, three fresh processes per arm; identical fixture and production source hashes. Public profile: 60 timed samples after 5 warmups. Actual admin list handler: 20 after 2 warmups. Timing excludes response hashing and serialization. This is an A/A preparation cohort, not an optimized before/after result or product speedup claim. The Phase 7 optimized comparison remains pending.

`trace.json.cpuprofile.gz` değiştirilmemiş üretim kodunun Node inspector CPU izidir. Çağrı sayaçları ayrı geçişte modül kaynaklarını yalnız süreç belleğinde instrument eder; zaman ölçümünde kullanılmaz. Inclusive CPU süreleri iç içedir, toplanmaz. Ham sonuçların hiçbiri seçilerek atılmaz.

## Entegrasyon kararı / main-chat handoff

Faz 7'de ana sohbetin ihtiyacı: salt-okuma store nesnesine bağlı, iki parent kuralını ayrı tutan indeksler; aynı senkron DTO üretiminde ortak türetim bağlamı; admin aktörünün tekrar canAdmin hesabını paylaşma. Permission sonucu yalnız revision anahtarıyla uzun ömürlü tutulmaz. `validFrom` dahil, `validUntil` hariç sınırlar korunur; her await sonrasında güncel store/profil ve gerekirse güncel grant zamanı ile tekrar yetkilendirme gerekir. İptal/pasiflik/manager veya rol değişimi eski request DTO'suyla yetkilendirilmez. Bu paket entegrasyonu uygulamaz; kilitli `server.js` veya compute dosyalarında gerekiyorsa değişiklik ana sohbete aittir.

EN: Candidate design only: store-identity hierarchy indexes, separate legacy/IAM parent rules, shared synchronous derivation context, and actor permission reuse in admin-list construction. Reauthorize against current authority after awaits. Never install a revision-only long-lived effective-permission cache. No production integration is implemented here.

Görünür ürün değişikliği yok: canonical alanlar, TR/EN, Motion+ ve reduced-motion yollarına dokunulmadı; yeni ürün release-note/PNG gerekmedi. Sonraki görünür uygulama kendi TR/EN release-note kaydı ve incelenmiş gerçek post-change PNG ister. i18n baseline boş kalır; mevcut test/validator eşikleri değişmez. Faz 6 / son program PR'ında filtresiz tam `npm test` şartı `acceptance.json` içinde zorunlu ve pending'dir; hedefli test/fast checks yerine geçmez.

## Tek bağımsız inceleme paketi / one Claude review brief

Kullanıcı üzerinden Claude'a iletilecek tek P1 turu: bu yeni tanı/test diff'i, sabit kaynak SHA'sı, `summary.json`, ham Node izi, pending-request RED kanıtı ve `acceptance.json`. Sorular: fixture/oracle tarafsız mı; iki hiyerarşi kuralı ve sıra korunuyor mu; zaman sınırları/merkezi değişim/bekleyen istekte iptal testleri gerekli güvenliği kapsıyor mu; önerilen indeks paylaşımı stale yetkiyi önlüyor mu? Bu paket otomatik dış servisle paylaşılmadı ve bağımsız incelenmiş sayılmaz. Üretim değişikliği sonraki Faz 7 kapısıdır. Merge, TEST ve STABLE yasaktır.
