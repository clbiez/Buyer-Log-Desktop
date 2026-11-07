# Ayrı takip bulgusu / Separate follow-up finding: SHARED_LEASE_LOST

**Durum / Status:** Gözlem teslim edildi; inceleme ve düzeltme başlatılmadı. /
Observation handed off; investigation and remediation have not started.

## TR

**[Doğrulandı] Gözlem:** #900 için Electron 39.0.0 / Node 22.20.0 / Linux x64
üzerinde yapılan üç 200k JSON/WAL performans koşusunun her birinde
`renew:failed` ve `error=SHARED_LEASE_LOST` loglandı. API çağrıları başarılı
döndü; koşulardaki iş verisi ve yeniden açılış assertion'ları geçti.

```text
[LEASE] renew:failed instanceId=<trial-id> pid=<worker-pid> resource=<synthetic-trial>/BuyerLogLocal.db error=SHARED_LEASE_LOST
```

Değişken kimlik/yollar yer tutucuyla gösterilmiştir. Gözlem kaydı
[validation.md](validation.md) içindedir. [raw.json](raw.json) koşu sonuçlarını,
runtime'ı ve kaynak hash'lerini saklar; uyarının stdout kaydını içermez.
Bu log gözlemi ile başarılı sonuç assertion'ları farklı kanıtlardır.

**[Bilinmiyor]** Kök neden; gerçek sahiplik devri olup olmadığı; onaylı veya
onaysız veri kaybı olup olmadığı; zararsız bir yarış olup olmadığı; eşzamanlı
yerel yazanlar altındaki etki. Başarılı assertion'lar bu soruları kapatmaz.
Veri kaybı veya zararsız yarış sonucu çıkarılmamıştır.

İleride ayrıca yetkilendirilirse inceleme, lease edinme/yenileme/bitiş sırasını,
işlem onay sınırını ve diskten yeniden okunan durumu ilişkilendirmeli; gözlemi
ve veri doğruluğunu ayrı değerlendirmelidir. Bu, şimdi başlatılmış bir iş veya
bu PR içinde üretim düzeltmesi izni değildir.

## EN

**[Doğrulandı / Verified] Observation:** Each of the three 200k JSON/WAL
performance trials for #900, running Electron 39.0.0 / Node 22.20.0 / Linux x64,
logged `renew:failed` with `error=SHARED_LEASE_LOST`. API calls returned
successfully; trial business-data and reopen assertions passed.

The log above substitutes placeholders for variable identities/paths.
[validation.md](validation.md) records the observation. [raw.json](raw.json)
preserves trial outcomes, runtime and source hashes, but not warning stdout.
The log observation and passing result assertions are distinct evidence.

**[Bilinmiyor / Unknown]** Root cause; whether ownership actually transferred;
whether acknowledged or unacknowledged data was lost; whether this is a harmless
race; impact under concurrent local writers. Passing assertions do not resolve
these questions. No conclusion of data loss or a harmless race has been made.

If separately authorized later, investigation should correlate lease
acquisition/renewal/completion, operation acknowledgment and disk-reopened state,
assessing the observation and data correctness separately. This does not start
that work or authorize a production fix within this PR.
