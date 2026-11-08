# Independent P1 action review / Bağımsız P1 işlem incelemesi

One read-only review of immutable `5e012c1cf4d77f56f975c6256943608d8273a057`. Scope: actual model/import original-action ownership, actual queue and loader receipt continuation; not final Phase6a activation approval. No second review round requested. Production thin remains OFF.

## Findings / Bulgular

- **P1 — Own model notification interrupted a two-stage move.** `writeCpModelColumn` omitted existing `X-Client-Id`. The unchanged server commits before publishing `modelConnections`; its delayed event can start an unreceipted model reload during the original command. Root native RED uses the real writer, actual callee model loader, actual SSE handler and a held real-PATCH fixture boundary: destination add completes, original remove does not. Fix carries the existing client identity on the PATCH. The unchanged handler now skips the own event. Both add/remove complete and per-source CAS remains in both requests. Foreign handler events are not suppressed globally.
- **P2 — Full CP model commands required Orders access.** The guard queried Orders unconditionally even for ordinary full CP. Root RED also proves that revoking CP while Orders stays allowed permitted a client dispatch; the existing server source/permission gate is unchanged, so this is not a demonstrated endpoint authorization bypass. Fix checks the captured current CP/Orders area. Native tests preserve CP-only and Orders-only operation plus current-area revocation denial.

## Root disposition / Kök düzeltme

Five new native cases: **2 PASS / 3 FAIL → 5 PASS**. Original 146 ownership and 19 consumer assertion bodies remain unchanged. Related default runner: **6 files / 208 PASS / 0 FAIL / 0 SKIP/CANCEL**. Guard fixes are a new delta after the immutable review SHA; no history rewrite. Source pins change only through the retained complete forward/reverse lineage. No server/SSE handler, canonical contract or #916 file changed. Full standard regression of the corrected tree is pending; the prior 9905 full pass belongs to the earlier SHA and is not carried forward.

TR: Tek bağımsız salt-okunur incelemenin iki bulgusu native RED→GREEN ile kapatıldı. Tam CP işlemi ilgisiz Orders yetkisine bağlanmıyor; kendi kaynak bildirimi taşımanın ikinci yazımını iptal etmiyor. Sunucu yetki kapıları ve kaynak bazlı CAS aynen korunur. Bu sonuç ince veri aktivasyonu veya Faz6a kapanışı değildir. TEST/STABLE yok.


## Corrected tree full result / Düzeltmeli son kod

Varsayılan `npm test` tek çağrıda bütün 10 batch'i geçti: **1.353 dosya / 9.910 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL / 240,7 sn**. Aynı son kaynakta i18n **0/0**, sürüm notları **52/52**, orijinal #916 hızlı komutu **23/23**. App SHA `373b06add9656c7614a239b2637f7554e68e83cf86dbad5a81e919244d98812a`; önceki 9905 PASS ve inceleme SHA'sı korunur. Testten sonra runtime/test değişmedi. Yeni P1 inceleme turu yapılmadı.

EN: On the corrected tree all ten standard batches pass in one invocation: 9,910 passed, zero failed/cancelled, 65 existing skips; i18n 0/0, 52 release notes, protected #916 23/23. Runtime/test code stays unchanged after the pass. No repeat review, production thin activation, merge, TEST or STABLE publication. The separate initial #918 review/foundation remains unchanged.
