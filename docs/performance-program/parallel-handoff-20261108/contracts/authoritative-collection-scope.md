## CPR-02 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon tek hücre kaydını tüm workspace kopyalamadan ayır
saveKolRows tüm satırları normalize eder; normalizeRows her satırı JSON clone yapar. Ardından tüm rows JSON, ikinci workspace JSON/localStorage ve pending persistence çalışır. Grup editinde setSharedValue/setVariantOverride clone ve normalize işlemi kayıt öncesinde de tekrarlanır.
- **Öneri:** Normalizasyonu yükleme/migrasyon ve etkilenen grupla sınırla. Yerel changed-row/group patch journal'ı ve seyrek checkpoint kullan; sunucu CAS sözleşmesini koruyarak istemci serialization tekrarlarını azalt.
- **Kazanç:** Büyük koleksiyonda edit gecikmesi, kopya bellek ve GC baskısında yüksek kazanç beklenir; uygulama runtime kazancı ölçülmedi.
- **Risk:** P1: dayanıklı pending journal, acknowledgement, conflict recovery, CAS/revision ve sahip kapsamı korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: tek hücre/grup/paste için serialized byte ve clone sayısını ölç; ağ kopması/kapanış/yeniden başlatma/conflict/başka buyer görünümü senaryolarında kayıp ve yanlış sahip yazımı olmadığını doğrula.
- **Kaynak:** public/app-main.js:25790 · public/app-main.js:25800 · public/app-main.js:25014 · public/collection-model-groups.js:23 · public/collection-model-groups.js:54

## CPR-03 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Koleksiyon geri alma geçmişini tam snapshot yerine patch ile tut
kolSnapshot tüm koleksiyonu JSON clone yapar. Her edit bu snapshot'ı undo'ya ekler ve 50 geçmiş saklanır. Bulk draft ayrıca birden çok full structuredClone oluşturur. Geçmiş bellek maliyeti yaklaşık historyCount×dataset ile büyür.
- **Öneri:** Command/inverse-patch undo ve byte sınırı kullan. Grup ve toplu işlemleri tek transaction tut; seyrek tam checkpoint ile geri dönüşü destekle.
- **Kazanç:** Büyük veri ve uzun oturumda yüksek heap/GC kazancı beklenir; gerçek heap profili çalıştırılmadı.
- **Risk:** P1: remote değişiklik sonrası undo rebase, model grubu işlemleri ve atomik bulk davranışı korunmalı.
- **Kabul/ölçüm:** Önerilen kabul: 30k satırda 50 tek hücre editinden sonra retained heap/GC ve undo gecikmesini ölç; remote change+undo/redo ile aynı canonical sonuçları doğrula.
- **Kaynak:** public/app-main.js:26590 · public/app-main.js:26600 · public/app-main.js:26607

## DS-09 · Öncelik B · Efor L
_Codex kanıt düzeyi: Doğrulandı_
Collection owner paylaşımı tek hücrede tüm workspace'i taşıyor
publishOwnerCas tüm workspace'i yükleyip hash'liyor, remote envelope'ı bütünüyle okuyup doğruluyor ve tüm belgeyi yazıyor. recordBase ayrıca tam taban snapshot ve hash tutuyor. Maliyet değişen hücre yerine workspace boyutuyla büyüyor.
- **Öneri:** Owner yetkisini koruyan row/field delta protokolü, küçük revision/head manifest'i ve periyodik checkpoint. Genel ortak delta alanına taşımadan owner erişim sınırını korumak.
- **Kazanç:** Tek hücre düzenlemesinde O(workspace baytı) ağ/serialization yükünü değişiklik boyutuna yaklaştırır; büyük paylaşılan koleksiyonlarda yüksek potansiyel.
- **Risk:** Yüksek: owner yetkisi, lineage CAS, üç yönlü merge ve çatışma saklama korunmalı.
- **Kabul/ölçüm:** Offline iki cihaz, aynı/farklı alan düzenleme, silme-vs-edit, yeni satır id çakışması, read-only kullanıcı, yetki iptali, yarım publish ve ancestry CAS testleri; ağ baytları ölçümü.
- **Kaynak:** server/lib/collection-replication.js:337 · server/lib/collection-replication.js:464 · server/lib/collection-replication.js:527

## DS-07 · Öncelik A · Efor M
_Codex kanıt düzeyi: Doğrulandı_
Batch kapasitesine rağmen tekil WAL transaction/fsync tekrarları
Her append transaction lease/open/write/fsync/close ve tag kontrollerini tekrar ediyor. queuePatches mevcut; delta-store toplu removeMirrored her id'yi ayrı tombstone transaction'ıyla siliyor. İzole gerçek API testinde 200 queuePatch 2645 ms; tek 200 kayıt queuePatches 65,6 ms toplam sürdü.
- **Öneri:** Bulk import/edit/delete için tek transactional batch; yoğun ardışık düzenlemelerde sınırlı group commit. Başarı yanıtını ortak fsync tamamlandıktan sonra döndürmek.
- **Kazanç:** Sentetik testte yaklaşık 40 kat toplam throughput farkı görüldü; üretim tıklama gecikmesi için aynı katsayı vaat edilemez.
- **Risk:** Orta: her kullanıcıya dayanıklı commit tamamlanmadan başarı dönülmemeli; kayıt sırası ve CAS korunmalı.
- **Kabul/ölçüm:** Batch içinde bir işlemin hata vermesi, process crash, aynı kayda sıralı patch, eşzamanlı CAS ve fsync-before-ack; 1/10/100/1000 kayıt throughput karşılaştırması.
- **Kaynak:** server/lib/local-db.js:778 · server/lib/local-db.js:804 · server/lib/local-db.js:1084 · server/lib/delta-store.js:290

## CPR-10 · Öncelik A · Efor M · Faz 7
_Codex kanıt düzeyi: Doğrulandı_
Checklist toplu kayıt ve metin yazımındaki store/sync/render zincirini birleştir
Toplu checklist her hedefte setChecklistAnswer çağırır; her çağrı tüm answers store'unu JSON'a çevirip context event yayınlar. Olay journal/column refresh/sync tetikler; sonda tekrar recompute vardır. Evidence açıklamasında her input ve change aynı store/sync/render yoluna gider.
- **Öneri:** applyChecklistBatch transaction ile bir dayanıklı answers/journal commit, tek event ve tek delta render/sync uygula. Metinler için yerel dirty journal + 250-400ms debounce/coalescing ve blur/close flush kullan.
- **Kazanç:** K hedef×tam cevap deposu serialization yerine tek commit; büyük toplu işlemde çok yüksek aday. Metin yazarken gereksiz full hesap ve senkron azaltılır. Ağdaki mevcut 200'lük batching bu yerel tekrarları çözmez.
- **Risk:** P1: monoton timestamp, journal dayanıklılığı, option cevabı, scoped set, conflict/reject ve kapanışta son yazının korunması şart.
- **Kabul/ölçüm:** Önerilen kabul: 100/1000 hedef bulk'ta store write/event/render sayısı; ağ kopması/kapanış/conflict ile son metnin ve cevapların kaybolmaması; timestamp ve option davranış eşitliği.
- **Kaynak:** public/cp-overview-assistant.js:4053 · public/cp-overview-assistant.js:383 · public/cp-overview-assistant.js:389 · public/checklist-supplier-sync.js:2777 · public/checklist-supplier-sync.js:2537 · public/checklist-supplier-sync.js:2583
