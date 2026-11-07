# ADMIN-01 — tek bağımsız Claude inceleme paketi

**Hazır şablon; henüz gönderilmedi / inceleme yapılmadı.** Kullanıcı üzerinden en
fazla bir bağımsız tur. Hazırlık için bu hakkı tüketme; Faz 7 / ADMIN-02 kapıları
açılıp P1 uygulamasının gerçek, test edilmiş diff'i oluşunca son head'i dondur.
İnceleme SHA'sına rebase/force-push yapma. İkinci inceleme yapılmış gibi raporlama.

Kullanıcının Claude'a aktaracağı istek:

> Buyer Log ADMIN-01 P1 bağımsız inceleme. PR'ın aşağıdaki **tam head SHA**'sını
> salt okunur incele; kod yazma, merge/yayın veya yeni görev başlatma.
> Önce CLAUDE.md ve ADMIN-01 kaynak bulgusunu oku. Yalnız nihai diff,
> snapshot/worker sözleşmesi, ilgili testler ve ölçüm kanıtlarına bak.
> `server.js` / ortak pool entegrasyonunun ana sohbet tarafından sağlandığını,
> ADMIN-02'nin tamamlandığını ve aynı dosyalarda açık kilit olmadığını doğrula.
>
> Şunlara somut dosya:satır kanıtıyla odaklan:
> - Yetki, user/full/selective kapsamı, sanitization ve güvenli descriptor/path
>   sınırı; worker'a credential, auth state veya canlı sınırsız kök taşınması.
> - Snapshot öncesi/sırası/sonrası kaynak değişimi, buffer sahipliği ve writer
>   kilitleri; ADMIN-02 ile birlikte tutarlı restore/retention sözleşmesi.
> - CRC/SHA/manifest/inventory doğrulamalarının tamamı, bozuk CRC ve geçerli CRC /
>   yanlış SHA, eski arşivler, restore staging iptali ve rollback.
> - Kuyruk byte/sayı sınırı, tek arşiv serializationKey, timeout/abort/shutdown/
>   native worker exit; erken kapasite/temp serbest bırakma ve final publish.
> - İki kolda aynı #892 ve aynı sentetik baytlar; en az 3 önce/3 sonra, medyan,
>   gerçek uygulama health p95 ve event-loop; profiler ayrı, ölçümler çakışmasız,
>   başarısız denemeler görünür, refresh POST retry yok.
> - Her davranış için RED→GREEN; değişmeyen validator/i18n baseline; final tam
>   test ve son kodla yeniden doğrulama. Görünür değişiklikte TR/EN release-note
>   ve gerçekten incelenmiş post-change PNG.
>
> Yalnız P0/P1/P2 actionable bulgular, doğrulanan güçlü kanıt ve kalan belirsizliği
> raporla. Test çalıştırmadıysan çalıştırılmış sayma. Performans ile doğruluğu
> ayrı değerlendir. Yetki/eşdeğerlik/veri kaybı/kırmızı kontrolde merge'i durdur.

Göndermeden doldurulacak kayıt (bu alanlar henüz **bekliyor**):

| Alan | Değer |
| --- | --- |
| Son üretim PR / tam head SHA | Bekliyor |
| ADMIN-02 merged PR / Main SHA ve kilit kontrolü | Bekliyor |
| Ana sohbet pool/server entegrasyon SHA'ları | Bekliyor |
| RED/GREEN + tam test + i18n + release validator logları | Bekliyor |
| Resmî 3+3 health/event-loop/CRC/SHA/restore kanıtı | Bekliyor |
| Kullanıcı üzerinden tek tur sonucu / disposition | Kullanılmadı |

Şimdiki hazırlık kanıtları: `README.md`, `artifacts/cohort-v1/manifest.json`,
`summary.json`, altı ham JSON.gz, `trace-1.cpuprofile.gz`, `profile-attribution.json`,
`artifacts/preparation-green.txt`, `artifacts/targeted-tests.txt` (ilk kırmızı),
`artifacts/targeted-tests-corrected-environment.txt`, i18n ve release validator.

EN: Unsent template for a single user-mediated independent review of the final
P1 implementation. Preparation does not consume the review round. All production,
integration and official comparison fields remain pending.
