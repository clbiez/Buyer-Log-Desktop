# SHELL-06 adapter / üretime bağlanmamış teslim

TR: Yalnız yeni helper ve gerçek Main blokları üzerinde çalışan exact-edit recipe.
EN: Unwired helper plus an exact-edit recipe exercised against actual Main blocks.

Baz `1796193f0a57c7785e7bf9fdb3557e33c550b25e`. `recipe.cjs` yalnız bellekte iki
kesin değiştirme verir; yazma veya tam app-main kopyası üretmez. `verify()` her
anchor'ın tekliğini kontrol eder. Yeni entegrasyon bazında anchor'lar yeniden
incelenmeli; 6a/import veya CP #916 kodu burada uygulanmaz.

## Dosya/route sözleşmesi

1. Yeni `resources/app/public/shared-revision-poller.js`, mevcut public static
   middleware ile `/shared-revision-poller.js` olarak sunulabilir
   (`server.js:6617`). Yeni API veya server edit'i gerekmez.
2. Ana sohbet helper'ı **app-main'den önce** mevcut asset/version yükleme yoluna
   bağlamalı. Örnek sıra: `shared-revision-poller.js?v=__BL_ASSET_VERSION__`,
   ardından mevcut `app-main.js`. `index.html:1634` / mevcut lazy loader kararı
   ana entegrasyondadır; burada index/perf-runtime değiştirilmedi.
3. `recipe.cjs` içindeki `exactEdits()` ilk olarak gerçek
   `let sharedRevisionSnapshot=...` bloğunun timer kurulumunu değiştirir; eski
   `pollSharedRevisions` fonksiyonu helper yüklenemeyen legacy fallback olarak
   aynen kalır. İkinci edit yalnız gerçek `initLiveSync` fonksiyonudur.
   `liveSyncResyncAfterGap` ve `bl-shared-revision` consumer bloğu byte olarak
   aynen test edilir. Recipe uygulamaya yazılmaz.

```sh
node scripts/prototypes/shell06-revision-poller-20261108/recipe.cjs
```

## Yerel context portu — ana sohbetin bağlayacağı zorunlu sınır

Recipe şu portu **helper yaratılmadan önce** bekler:

```js
window.BLSharedRevisionContext = {
  read() {
    // Her okumada GÜNCEL yerel oturum/yetki/expiry doğrulaması.
    return { actor: 'opaque-local-epoch', source: 'opaque-source-epoch',
      authority: 'opaque-authority-epoch', valid: true };
  },
  subscribe(onChange) {
    // Login/logout, kullanıcı değişimi, kaynak değişimi, grant expiry/revoke,
    // oturum/authority yenilenmesi; önce yerel state'i değiştir, sonra bildir.
    return () => { /* unsubscribe */ };
  }
};
```

Bu bir **yeni sunucu API'si ya da mevcut üretim export'u değildir**. Main'de
üç alanı birlikte sağlayan kanonik API doğrulanmadı. Port wiring'i açık
blocker'dır. Geçerli port yoksa helper fail-closed bekler; bunu hazır üretim
entegrasyonu diye sunma. `actor` yalnız display name veya BL_CLIENT_ID değildir;
aynı kimliğe geri giriş de yeni yerel epoch gerektirir. `source` endpoint/store
reset ve backend/source değişimlerini ayırır. `authority` local grant/session
neslini ayırır; mesaj generation'ından türetilmez. `valid`, bekleyen revoke veya
süresi dolan grant varken false olmalı; epoch değişmese bile her read bunu
kontrol eder. Salt revision anahtarlı permission cache yoktur. Mevcut
`user-access-ui.js` 5sn `/api/current-user` denetimi, focus ve IAM kontrolü
aynen korunmalıdır; poller onların yerine geçmez. Port expiry'ı biliyorsa
olayını zamanında üretmelidir; portun bilmediği server-side revoke'u helper
keşfettiğini iddia etmez.

## SSE liderinin somut yaşam döngüsü

- Mevcut `buyerlog-live-sync` kanalı ve `buyerlog-live-sync-leader` Web Lock'u
  kullanılır. Helper bunları yaratmaz, istemez veya sahipliğini yorumlamaz.
- Mevcut lock callback'i `start({catchUp:true})` çağırır. İlk liderde de GET
  hemen başlar (eski 2500ms bekleme kısalır); tek helper'ın bağımsız cold
  `start()` çağrısı 2500ms sözleşmesini korur. Her devir catch-up yapar.
- Recipe callback'in çözücüsünü saklar; stop önce poller'ı abort eder, sonra
  mevcut SSE'yi/retry timer'ını kapatır ve mevcut lock'u bırakır. Kuyruktaki lock
  isteği AbortSignal ile iptal edilir. İkinci seçim mekanizması yoktur.
- Context değişen takipçi mevcut `status?` mesajıyla liderden yeni baseline
  ister; yeni kanal veya GET/seçim oluşturmaz. `share/receive` sırasında
  bağlam değişimi keşfedilirse mevcut liderin timer'ı catch-up için yeniden
  kurulur.
- SSE `onopen` gap sonrası `catchUp()` çağırır; orijinal resync davranışı
  korunur. Eski source handler'ları `closed/source` kontrolünden geçer.
- `pagehide`: persisted ise stop; BFCache `pageshow` aynı koordinatörü yeniden
  kurar. Son kapanışta dispose terminaldir. Explicit stop yeniden init'e izin
  verir; eski abonelikler temizlenir. Heartbeat/goodbye koduna dokunulmaz.
- Online/offline, document visibility ve mevcut desktop `onTabActivity`
  callback'i bağlanır. Aktivasyonda catch-up, offline'da abort vardır.
  Arka plan sağlıklı polling'i 7sn üstüne uzatmaz. Timer throttling/frozen page
  için gerçek native-tab kabulü hâlâ gerekir; yeni lider seçimi eklenmez.

## Helper API ve zamanlama

`create({readContext,fetch?,onRevisions,publish?,now?,setTimeout?,clearTimeout?,
newGeneration?})` → `start({catchUp?}), stop(), dispose(), catchUp(),
contextChanged(), setOnline(bool), setActive(bool), receive(message), share()`.

Bir helper'da fetch **ve JSON gövdesi** sonuçlanana kadar slot doludur. Stop,
context değişimi, offline ve 10sn timeout AbortSignal gönderir. Abort'a uymayan
custom transport/JSON promise çözülene kadar ikinci GET başlamaz. Bu durumda
catch-up gecikebilir; tek-slot garantisi korunur. Eski neslin sonucu fetch ve
JSON sonrasında, event'ten önce ve publish'ten önce reddedilir. Abort HTTP
sunucusunda başlamış disk işini geri alamaz; farklı document lider devrinde
sunucu işlerinin kısa kesişimi engellendiği iddia edilmez.

Normal başarılı idle aralık en çok 7000ms, değişiklik sonrasında 3500ms ve ilk
idle yanıtta tekrar 7000ms olur (idle backoff). Başlangıç zamanı baz alınır;
7sn'den uzun GET sonuçlanınca gecikmiş poll seri olarak hemen çalışır. Sağlıklı
akışta gizli 14/28sn gecikme yoktur. Hata beklemeleri bitişten itibaren
1/2/4/8/16/30sn; reconnect/foreground/context/leader catch-up bunları sıfırlar.
Bu hata pencereleri eski sabit 7sn'e göre daha geç gösterebilir ve başarılı
akış için 7sn sınırı ağ/JSON işleme süresini içermez. Timeout abort'u sonrası
transport'un settle olması gerekir.

## Mesaj ve receiver sözleşmesi

```js
{ type: 'shared-revisions', generation: 'opaque-polling-lease-nonce',
  sequence: 1, revisions: { schemaVersion: 1, revision: 12,
    entities: { quotation: { revision: 3 } } } }
```

Yalnız schema, global/entity revision, lease nonce ve sıra. Metadata,
updatedAt, owner, profil, permission, credential, iş payload'u ve yerel context
alanları whitelist dışında kalır. Nonce bir yetki veya liderlik kanıtı değildir.
Aynı origin'deki bir script sahte yüksek revision hint'i üretebilir; receiver
bunun yetkili sunucudan geldiğini iddia etmez. Receiver kendi güncel context'ini
tekrar okur, şekil/sınır/monotonic revision ve bounded sequence kontrolünden
geçirir. Hint yalnız mevcut `bl-shared-revision` invalidation'ını tetikler;
gerçek verinin her yüklenmesi sunucuda güncel kullanıcı ile yetkilendirilir.
Hint permission grant veya UI erişim state'i oluşturmaz. Generation geçişleri
source/authority epoch yerine geçmez. Kaynak/store reset'i yerel source epoch
bump ister; bilinmeyen eski generation düşük revision'ı geri yazamaz.

## Fallback ve kanıt sınırı

BroadcastChannel veya Web Locks yoksa mevcut SSE per-page fallback korunur;
helper da her sayfada bağımsız seri polling yapar. Bu ortamda tek lider
kanıtlanmış sayılmaz. Web Lock isteği reddedilirse recipe stop eder; ikinci
ad-hoc seçim veya gizli fallback yoktur. Helper asset'i yüklenmediyse tam eski
per-page timer davranışı kalır; bu yolda overlap/stale garantisi yoktur.
Endpoint 401/404/503 ve geçersiz JSON başarısız GET sayılır, veri veya grant
yayımlanmaz. Eski endpoint/schema'nın yerine yeni veri kaynağı icat edilmez.

VM testleri gerçek blokları çalıştırır; browser API'leri bu testlerde fake'tir.
Chromium ölçümünde gerçek Web Locks/BroadcastChannel/EventSource + loopback
HTTP vardır; sunucu revision deposu, profil portu ve UI/data consumer
bağımlılıkları sentetiktir. Bunlar bütün Buyer Log, native WebContentsView,
Electron, gerçek paylaşımlı disk veya gerçek authorization kabulü değildir.
