# Buyer Log Agent Capability Platform 2.0

Denetim tabanı: 7.0.271, 2026-10-11. This is a staged implementation plan, not a claim that every operation is available to agents. Source paths below are relative to `resources/app/`. HTTP verbs alone do not prove business capability: POST can be a read/preview, and DELETE can revoke a lock rather than delete a business record.


## Teslim edilen CP pilotu

Bu PR, platformun ilk uygulama paketidir. Diğer modüllerin işlem araçları aşağıdaki bağımlılık sırasıyla ayrı PR’larda bağlanacaktır. İkinci AI motoru veya yeni hesaplama motoru eklenmedi.

* Kişisel checklist/Rules oluşturma ve revizyon: doğal dil → ortak LCW AI `rules` sözleşmesi → mevcut formül/bağımlılık doğrulaması → tüm yetkili CP satırları üzerinde etki önizlemesi → kullanıcı onayı → mevcut kullanıcı tercih servisine yazma → kayıt geri okuma. Paylaşılan üretici checklist tanımları değişmez.
* Haftalık yüklemeler: yüklü Merch Calendar’ın gerçek hafta başlangıç/bitişi → canonical Ex-factory seçimi → mevcut sorumlu üretici/Non-DTR alt üretici çözümleyicisi veya kişisel genel e-posta grubu → alıcı/metin/veri önizlemesi → onay → mevcut EML motoru → dosya varlığı doğrulaması. Eksik alıcılar kısmi sonuçta açıkça belirtilir; SEND açılmaz.
* Dört yeni araç aynı `agent-tool-registry` içindedir: `cp.rule.preview`, `cp.rule.save`, `cp.weekly.preview`, `cp.weekly.draft`. `module.catalog`/`module.describe` gerçek yürütülebilir araçları kullanıcı yetkileriyle süzerek bildirir. Deklaratif modül yetenekleri yürütme izni sayılmaz.
* Araçların giriş, gerçek sonuç ve dry-run şemaları ayrı doğrulanır. Yetki yazma anında yeniden okunur; kaynak, onaylanan argümanlar, agent revizyonu ve Runtime run ID bağlanır. Yazma araçları production adapter’da ayrılmış Office görevi olmadan çalışmaz.
* Office WAL’de bekleyen/onaylı/başarısız/kısmi/kesilen görevler; mevcut Runtime’da trigger → tool → verify → result grafiği korunur. CAS tek onayı tek işlem yapar. Tamamlanmış görev tekrar onaylandığında önceki sonuç döner. Başka cihazdaki senkron görev yeni önizleme olmadan çalışmaz; yarıda kesilen etki otomatik tekrarlanmaz.
* Kural geri alması yalnız kayıt hâlâ görevin son yazdığı revizyondayken uygulanır. Runtime’ın hata ve recovery yolları önceki onay bağlamıyla aynı güvenli inverse hizmetini kullanır. Tercih ve Runtime dosya yazmaları mevcut dosya kiralarını kullanır.
* CP ayarları/cevapları zaten istemcide kullanıcıya ayrılmış sync anahtarlarıdır; sunucunun eksik `lcw.cp.assistant.` ve `lcw.cp.checklist.` whitelist kayıtları tamamlandı. Rol devri yalnız mevcut workspace kategorilerindeki kurallar için geçerlidir. PLM numune kanıtları ve sevk edilmiş sipariş çıkarımları mevcut PLM motorundan alınır.
* EML dosyaları kullanıcıya ait dizinde saklanır. İndirme görev sahibi, görev sonucu dosya listesi ve güncel CP + automations yetkisini doğrular. Global otomasyon indirme yolu bu dosyalara erişmez.

Bu pilot açıkça seçilen kural ve haftalık taslak görevlerini yürütür; serbest ve sınırsız bir görev planlayıcısı değildir. Zamanlanmış sürekli çalışan kuyruk, dağıtık etki uzlaştırması, reddedilen önerilerin/düzeltmelerin yeni hafıza sınıflarına bağlanması, otomasyon revizyonu/aktivasyonu ve Quality/Collection/Backlog/Moderator yazmaları sonraki paketlerdir. Mevcut otomasyon DSL taslağı yolu korunur. Kural değişimi istemciye mevcut `BLStorage.adoptRemote` ile alınır; CP karar motorunu yeniden yüklemek için arayüz sayfa yenilemeyi ister.

| Araç | İşlem | Güncel erişim | Risk / onay | Gerçek hizmet / doğrulama | Geri alma |
|---|---|---|---|---|---|
| `cp.rule.preview` | READ | sahibi + CP + agent CP kapsamı | okuma | CP/Rules/PLM motorları, tüm satırlarda sayım ve 5 canonical örnek | gerekmez |
| `cp.rule.save` | CREATE / UPDATE | yukarıdaki + bağlı Office/Runtime görevi | yazma, her görev için onay | kişisel tercih anahtarı, lease + beklenen entry CAS + geri okuma | exact entry receipt; sonraki yazmayı ezmez |
| `cp.weekly.preview` | READ | sahibi + CP + automations + agent CP | okuma | yüklü iş takvimi, canonical tarih, mevcut alıcı grupları | gerekmez |
| `cp.weekly.draft` | EXPORT | yukarıdaki + bağlı Office/Runtime görevi | dosya üretimi, her görev için onay | mevcut EML/CSV rapor motoru, dosya varlığı; mail gönderilmez | desteklenmez; dosya dış iletişim oluşturmaz |

Erişim matrisi: `resources/app/tests/fixtures/agent-capability-access-matrix.json` tüm 18 kayıtlı modülün deklarasyonlarını ve göç etmiş araçların operasyon/alan/risk/onay/rollback sözleşmesini sabitler. Yeni modül/yetenek/araç eklendiğinde regression testi güncelleme ister. Takvim, test ve kart gibi yardımcı servisler aşağıdaki modül/iş akışı matrisinde ayrıca yer alır.

## Findings / Bulgular

* `agent-office-service.run` calls the existing LCW AI engine once, archives proposals and marks the **analysis** complete. It does not invoke `agentToolRegistry` or `agentRuntime`. `agent-office-workflow` passes recorded analysis/review/synthesis messages, not executable tasks.
* `agent-tool-registry` has discovery, seven dataset sources, bounded canonical queries/aggregations, arithmetic/time, refresh, order override, HTTP and recorded browser tools. Inputs are descriptive strings, not validated schemas; output schemas, revision-bound approvals and idempotency are absent. `app.order.update` snapshots then writes with a null expected revision; restore also has no revision guard. These tools must not be silently exposed to Office as safe writes.
* `module-registry` records user-facing capabilities, not actual agent execution support. `agentFilter`, table keys and route coverage help, but capabilities such as PLM/import/export do not imply a callable agent tool. Merch Calendar, quality intake, fabric/license cards, OAB/INTAKE and supporting management operations need explicit contracts.
* Dataset discovery excludes INTAKE while `ai-capability-registry` includes it. Dataset fields are sampled (240 rows, 320 names); queries project at most 40 fields/500 rows; analysis allows five dimensions/eight measures. These are context/output limits, not a reason to limit deterministic source calculations. Partial schema, omitted groups and export limits must be declared.
* Client `BLStorage` already synchronizes owner-scoped CP assistant/checklist keys, but the server preference whitelist omitted them; the pilot closes this context persistence gap.
* Personal CP rules already use `cp-rules-engine`, `lcw.cp.rules.priority.v1` and `lcw.cp.rules.checklist.v1`; checklist supplier definitions/answers have their own shared store. Personal rule creation must not overwrite shared supplier definitions. LCW AI's `rules` contract already generates condition formulas and priorities.
* `automationExecute` and `automationSplitRecipients` already generate controlled EML drafts and resolve responsible manufacturers, including licensed Non-DTR sub-manufacturers. `SEND_EMAIL` in the automation language actually means draft preparation. No verified corporate sending channel exists. SEND remains unavailable.
* Office WAL/CAS, owner-encrypted sync, bounded relevant memory, expiry/conflict markers and copied/inference provenance already exist. Job persistence exists; durable execution receipts, leases and effect reconciliation do not. Interrupted jobs cannot be treated as safe to replay.

## Capability matrix / Yetenek matrisi

R/C/U/D/I/X/E/T/S/A = READ/CREATE/UPDATE/DELETE/IMPORT/EXPORT/EXECUTE/SCHEDULE/SEND/APPROVE. A means business approval, not HTTP authorization. `—` means no supported path verified. The evidence column identifies the existing path to reuse; the API appendix inventories individual routes and their middleware for follow-up verification. Client export/render operations are included below even when they have no server route.

| Module / workflow | User operations verified in code | Existing agent support | Reuse / evidence | Missing contract / package |
|---|---|---|---|---|
| Overview | R X E (dashboard/filter/analysis/views) | canonical CP/order/collection query | `module-registry`, `app-main`, `agent-office-intelligence` | view/report/OAB adapters, P3/P4 |
| CP Tracker | R U X E; personal rules/checklist C U D; PLM E | read/aggregate, limited order override | `server.js` order APIs, `cp-overview-assistant`, `cp-rules-engine`, `cp-checklist-engine`, `cp-readiness-engine` | CP pilot P1; remaining edits need record CAS/locks |
| Orders | R U X E; notes, supplier/Non-DTR/licensor edits | read/limited override | order override service, note-column routes | editable fields + revision/lock-scoped updates P4 |
| Collection | R C U D I X E; workspace/editor grants, recycle/restore | canonical read only | workspace save worker, recycle-bin/image routes | save worker receipts, workspace permission + revision P3 |
| Quotations | R C U D I; merge/restore/status A | collection dataset is not quotation execution | `quotations-store`, `/api/quotations`, `quotation-visibility` | QUOTATIONS.* IAM, quotation revision/status machine P3 |
| Pricing History | R X E | no history-specific tool | quotation history + client comparison | canonical history/LFL comparison P3 |
| Price & Supplier Analysis | R X E | generic analysis, Office decision support | existing price/supplier engines | typed metrics, currency and quantity weights P3 |
| LFL | R X E | generic lfl query (not weighted LFL motor) | `lib/lfl`, `routes/lfl-routes`, client LFL exports | same currency, MB month/classification, weighted motor P3 |
| Open Costing | R U X E | no costing execution | costing-fx-shipping routes, costing engine/client | deterministic scenario/snapshot/export P3 |
| Shipping Comparison | R U X E | CP/orders read | costing-fx-shipping + saved scenarios | scenario mutation, revision + impact P3 |
| Backlog | R X E T (automations) | bounded query/analysis + risk scan | backlog delivery/automation engines, client XLSX | natural filter/group/measures + existing export P4 |
| Manufacturers / email groups | R C U D I E (ASAS card linking) | recipient lookup only in automation | email-group records/import/link/lock APIs | business-rule permission + record lock/revision P5 |
| License cards | R C U D I E | partial operational facts | license-card routes/store, royalty rules | card/contracts/history + permission + revision P5 |
| Fabric cards / BOM | R C U D I X E | Office BOM evidence | fabric-card routes + BOM services | typed normalized component intake/update P2/P3 |
| Merch Calendar | R I U D | absent | merch-calendar store/routes + date-dimension | pilot uses loaded calendar; import stays source permission P1/P5 |
| Checklist supplier sync | R U I X; attachments C R D | Office read/evidence only | checklist-supplier store/routes, supplier XLSX client | scoped definitions/answers, stale answer/evidence checks P2 |
| Quality test reports | R C U D I E A (preview/match/apply) | authorized stored-document review only | test-report routes/store, LCW extract/review contracts | PDF/MSG/EML intake, exact option match, ambiguous approval P2 |
| PLM sync / samples / images | R I U X E | discovery only | PLM sync/request/image-package routes, job store | existing async jobs/session authorization + scoped ID lists P2/P3 |
| Source / model connections | R C U D I X E | read ASAS/IAS + refresh | ASAS/model-connection routes, model scopes, refresh | source IAM + dataset scope/revision/impact P5 |
| Transit/FX/Endeksmatik/DTR | R U I E | no mutation | pricing/transit/FX/non-DTR APIs and existing motors | manageBusinessRules, preview/CAS/revision/rollback P5 |
| OAB / INTAKE | R I X E | absent from agent dataset registry | OAB batch/intake report/job services, OAB.VIEW | no token exposure; report job/result adapters P4 |
| Holidays / Horizon | R C U D I E | no operation tools | holiday/horizon/template routes, preference layers | model-connection permission, effective scope + CAS P5 |
| Automations | R C U D I X E T; draft mail E, S— | Office creates disabled approved DSL draft | language/validator/compiler/recipe store, automationExecute | revision/idempotency for revise/activate; scheduler boundary P1/P6 |
| Agent Workflow Studio | R C U D E; manual approval gate | runtime executes registered tools | agent graph/store/runtime/policy | durable effect receipt/lease + fresh IAM P0/P6 |
| Agent Office | R C U D X E; memory/watch/archive/coordination | analysis, deterministic risk scan, disabled automation draft | office store/service/workflow/evidence/sync | registry bridge and real task plan P1/P6 |
| LCW AI / exports | R E X (HTML/PDF/XLSX etc.) | same engine, report summary only | LCW engine/prompt + `lcwai-output` | output artifact validation/sanitization/quota P3/P4 |
| Views/presets/preferences | R C U D I X E | no direct operation | view-profile/preset-share + user-preferences | owner/category-scoped changes, rollback P1/P4 |
| IAM/admin/sync/release | R C U D I X E A where authorized | must not grant agent admin | user-access, central IAM, shared-hub sync | exclude credential/grant/release writes from pilot; separate product decision |

## Unified registry contract / Ortak araç sözleşmesi

Keep `agent-tool-registry` as the single executable catalog; module declarations point to it, Office selects an allowlisted subset, and Runtime is the only workflow executor. Each migrated tool carries version, module, operation, JSON input/output schema, current IAM capability/permission and area, owner/record scope, risk, preview and deterministic validation, approval binding, audit, idempotency/retry and rollback semantics. Legacy tools remain explicitly legacy until migrated; catalog metadata is not an execution grant.

Every critical effect checks fresh actor IAM, agent scope/revision, live record revision and lock. Approval binds normalized arguments, owner, tool version, source/calendar/recipient revision and preview hash. Effects use existing service entry points rather than loopback HTTP or direct DB access. Model output cannot choose a service function, host, capability or executable code. Unsupported schema fields are rejected.

New module/operation registration must update an access matrix test. Discovery reports supported and missing operations separately; unavailable tools never masquerade as executable. Input/output schema checks are runtime checks (this CommonJS project does not obtain static TypeScript guarantees merely by naming a schema).

## Packages, dependencies and acceptance / Paketler

| Package | Scope | Dependencies | Acceptance |
|---|---|---|---|
| P0 | Gate unsafe legacy writes; characterize runtime persistence/CAS gaps | none | revoked IAM, stale revision, concurrent approval, rollback refuses newer edit |
| P1 (this pilot) | Office CP rule/checklist creation/revision using LCW `rules`; Merch weekly loads; manufacturer/general EML drafts; registry + Runtime bridge | existing CP/calendar/prefs/mail engines | TR/EN real UI; preview/approve; readback; durable Office result; no SEND; AI-off deterministic steps |
| P2 | Quality intake/match/approve/apply + Fail draft | P1 contracts | malformed PDF/MSG/EML, ambiguous/missing identities, existing test/checklist services, no inferred Pass |
| P3 | PLM/Collection/quotation + price/LFL/output adapters | P1 + existing PLM jobs/save worker | permissions/editor lock, CAS, same currency, quantity weights, validated HTML/PDF/XLSX |
| P4 | Backlog/report/INTAKE/views/export | P1 | unrestricted source calculation with bounded model context, validated measures, exporter regression/performance |
| P5 | Moderator resource changes | P1 + shared source stores | impact/preview/approval, role/permission recheck, leases/CAS, revision-safe inverse change |
| P6 | Durable task handoff, recurring limited grants, effect receipts/reconciliation | P1 tools migrated | process death at every effect boundary, two devices, expired approval/grant, no repeated effect |

Pilot boundaries: personal rules are saved in the existing owner preference keys, not shared supplier definitions. A rule task and a weekly draft task are explicit plans selected by the user; natural language specifies their content. Unsupported unrestricted planning is not enabled. New automation activation, external sending and unrelated resource writes remain later packages. Existing Office automation DSL draft path stays available.

## Durable work, memory and operations / Kalıcılık

Use Office WAL jobs for task intent/approval/history and existing Runtime runs for graph execution. Planned → waiting approval → running → completed/failed/interrupted are persisted. Completed steps have actual result IDs and readback verification. Reserve approvals with CAS. On restart, an interrupted effect must be reconciled with its existing service receipt; without such receipt it requires review, never automatic replay. Read-only steps may retry with a bounded policy. Two-device execution needs a device-bound lease and shared receipt; local CAS alone is not a distributed guarantee.

Schedules run only while Buyer Log backend/desktop runtime is running. Closed application cannot execute local tools. Persist due times, timezone and missed-run policy; show overdue work on reopen. Never promise an always-on employee without a separately authorized continuously running host. Client timestamps use the user's timezone; Merch periods use the loaded LCW business calendar, not guessed ISO weeks.

Memory categories map existing facts/preferences/instructions/tasks/inferences to source facts, user preferences, approved procedures, task outcomes and unverified inference. Record rejected proposals/corrections with task/tool/source links, supersession and expiry. Approved procedure is an explicit user decision; AI response is never promoted automatically. Retrieve recent relevant corrections and approved procedure within a bounded budget; source facts are refreshed from services and retain provenance/revision. Archive search remains separate from active context.

## Further opportunities / Ek öneriler

| Opportunity | Benefit | Fit / effort | Security / AI cost |
|---|---|---|---|
| Missing evidence reminder per option | avoids repeated tests and cross-PO mismatches | existing checklist/PLM, medium | exact identity + approval, deterministic; AI optional text |
| FX/transit change impact report before approval | prevents landed/ETA surprises | existing motors, medium | read-only scenario; zero AI calculation |
| Quotation expiry/duplicate supplier comparison | reduces dropped/duplicate offers | quotation store, medium | owner visibility; low optional summary cost |
| Source freshness and failed-ID reconciliation | catches stale exports and incomplete sync | existing refresh/PLM jobs, small | read-only first; zero AI |
| License/royalty contract inconsistency queue | prevents pricing drift | license cards/pricing rules, medium | no auto repair; deterministic detection, bounded AI explanation |

Validation for each package includes permission revocation, scope leakage, malformed arguments/output, changed preview, simultaneous approvals, source changes during await, rollback against newer edits, cancellation/restart and idempotency, significant data-volume checks, targeted regression and TR/EN. GitHub Actions are not auto-triggered, no ZIP artifact upload, merge/TEST/STABLE remain separate decisions.

## Kabul kanıtı ve sınırlar

Pilot testleri gerçek Office WAL, Runtime, kullanıcı tercihleri, CP/Rules/date/PLM motorları ve EML dosya üretimini kullanır. LCW AI yanıtı anonim test fixture’ında ortak `rules` sözleşmesi biçiminde stub edilir; kurumsal LCW AI oturumu bu ortamda bulunmadığı için gerçek upstream çağrı doğrulanmadı. Production kodu mevcut LCW AI engine’ını çağırır.

Gerçek Buyer Log + Chromium’da 1440×960 anonim demo ekranları alındı: TR doğal dil formu, doğrulanmış kalıcı kural sonucu, EN haftalık EML sonucu. HTTP kontrolü owner indirme=200, global indirme=404, oturumsuz indirme=401; istemci hata=0. Demo görevler gerçek servislerle hazırlanmıştır; görüntüler component mockup değildir.

Pilot testleri yetki iptali, agent kapsamı değişimi, stale source, await sırasında revizyon değişimi, çift onay, restart sonrası kayıt, başka cihazdaki görev, kayıt sahibinden veri sızması, doğrulanmamış araç çağrısı, PLM onayları, kişisel ayarlar, 5.001 satır kapasite reddi, 5 KB üzeri tam rollback receipt ve farklı süreçte hedef tercih dosyası kilidini kapsar. Haftalık taslak seçimi en çok 5.000 satır kabul eder; daha büyük işler yeni onaylı parçalara ayrılmalıdır. Etki/kural sayımı satır örneklemesiyle sınırlandırılmaz. Şema alanları ve örnekler bounded tutulur; hesaplama için AI kullanılmaz.

API eki literal route taramasıdır; sütunlar endpoint/servis bulmayı kolaylaştırır, HTTP yönteminden yetki veya iş mantığı çıkarılmaz. Dinamik route üreticileri ve istemci işlemleri için asıl davranış kanıtı modül tablosundaki motor/servislerdir. Legacy Runtime araçlarının global güvenlik göçü bu pilotun erişim izni değildir: Office yalnız göç etmiş CP araçlarına bağlanır. Sunucu dosyaları değiştiği için kullanımda server/Desktop yeniden başlatılmalıdır.

Son doğrulama: 15 CP pilot testi ve 128 ilgili regresyon testi başarılı; module-registry/user-storage ek kontrolleri başarılı. Tam regresyon envanteri 914 dosya/6.599 testtir: ilk batch’teki yeni CP context testi whitelist uyumsuzluğunu buldu; düzeltmeden sonra ilgili testler yeniden geçti ve yalnız henüz çalışmamış batch’ler sürdürüldü. Birleşik sonuç 6.533 pass / 66 ortam-platform skip; skip’ler başarı sayılmadı. Gerçek kurumsal LCW AI oturumu ve Windows/Edge kabulü ayrıca gereklidir. i18n: yeni eksik 0; release-notes: 69 kayıt doğrulandı. Tek reviewer’ın owner-scoped export, onaylı inverse, PLM kanıtı ve hedef preference lease bulguları düzeltildi. GitHub Actions, merge, TEST ve STABLE tetiklenmedi.

## Runtime package — implemented after the CP pilot

`feat/agent-capability-runtime` completes the shared execution bridge (P0/P6 foundation). `agent-capability-contract` registers validated v2 adapters in the existing registry. Office tasks contain at most 12 sequential steps, actual Runtime run IDs and verified receipts. Each write receives its own source-bound preview and explicit approval. Handoff bindings can read only earlier completed results; undo makes the job terminal and cancels pending dependent steps. Read failures have a three-attempt bound. Writes with uncertain receipts are never automatically replayed. The Runtime approval reservation now uses the existing file lease plus an atomic pending-node/status check, including calls through the existing platform approval endpoint.

Owner/device binding, live IAM (including data-scope changes during awaits), agent revision and existing service revision checks remain independent gates. Executors persist an instance-specific heartbeat; restart checks terminal Runtime receipts before process liveness, and an expired unrelated PID cannot retain a task forever. Schedules store timezone, interval, exact due occurrence ID and run-once/skip policy. Only explicitly selected read tools receive recurring authority. The backend must be running; reopening deduplicates missed occurrences. A host, external sending, background AI calls and recurring write grants are not silently enabled.

Memory now exposes source-fact/user-preference/business-procedure/task-history/unverified-inference categories. Verified task outcomes retain tool/job provenance; user corrections and rejection reasons receive priority within the existing bounded context. AI inference remains unapproved. Dynamic discovery exposes canonical record tools for CP, Orders, Collection, Backlog and LFL; row output is bounded to 250, while filters and counts use every authorized row. The canonical field catalog is complete, and filters use the actual operator contract without silently discarding later conditions.

The unsafe legacy order tool now requires an order revision, valid real dates and supported note fields, uses the normal editor's shared-owner guard, verifies persisted override values and returns an exact override receipt. Its inverse restores missing entries and author metadata with existing override-store CAS; it refuses newer edits. It is not yet an unrestricted Office order-edit capability.

Validation: 179 targeted tests across 24 files passed, including 12 new task/security tests with real WAL, Runtime, override and preference services. Two OS processes approving one gate produced one effect; a competing reservation was rejected. Real Chromium UI completed an AI-off canonical record task, displayed its actual verified result, and rendered the English read-schedule form with zero page errors. Three anonymized post-change PNGs accompany TR/EN release notes. Full regression is deferred until all newly requested domain packages are complete. Merge and TEST/STABLE remain separate decisions.

## Quality package — implemented on the durable task registry

- `quality.inspect`, `quality.commit`, `quality.checklist.apply`, `quality.fail.drafts` adapt the existing parser, test-report engine/store, checklist supplier store and EML channel. The normal UI import calls the same extracted test-report service. No Outlook/SEND capability is enabled. Drafts retain the same CP + Automations permissions as the existing CP draft flow and owner-bound download receipts.
- Real PDF/MSG/EML parsing works with AI disconnected. Unparsed eligible documents use common `test-report-extract` / `askWithFiles` only after explicit user selection (maximum five AI files per batch); LCW AI does not match or commit records.
- Exact order/model/color matching uses the existing engine and current editable order scope. Partial/ambiguous candidates require selected identity + explicit confirmation; no match cannot be imported. The user can leave individual reports out. Each report/checklist/draft mutation has its own actual preview and approval.
- Agent uploads use bounded local staging (30 files, 40 MB per file; existing aggregate/session/expiry limits). Normal imports remain in memory. Durable staging verifies file hashes after restart, observes updates from another live process and serializes AI updates and commits. Expired/evicted evidence requires reupload. Original file buffers are never task arguments, AI instructions or unrestricted file paths.
- The report store checks expected revision under its existing lease. Approved evidence fingerprint is rechecked inside the staging lease before report commit. Checklist writes recheck real writable orders after approval and hold report→checklist leases. Answers use `test_report` provenance, preserving later deterministic import semantics. Fail drafts bind final selected canonical rows, source fingerprint and report revision before producing the actual owner-isolated EML.
- Report inverse checks both current and previous link permissions, then holds report→checklist leases across dependency check and restore. A completed checklist referencing the report prevents undo even when created in a separate job. Checklist inverse restores exact prior answer/tombstone at the effect revision; attachment evidence remains immutable and retained.
- Targeted validation: 153 tests / 20 files passed (no skip). Quality cases include actual PDF/MSG→report→checklist→EML, ambiguous matching, live ownership revocation, AI evidence update during approval, Fail→Pass during approval, two-live-process staging and checklist inverse race, restart/expiry, schema/IAM and 50,001-order deterministic matching with bounded preview. Actual Chromium TR three-step approval + authenticated EML download and EN upload dialog passed, zero page errors; only anonymous demo data in screenshots. Full regression and platform/enterprise sessions remain final acceptance work.
