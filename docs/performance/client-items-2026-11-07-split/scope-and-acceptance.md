# #906 — lisans parçası ayrımı / license scope removal

## TR

Kullanıcının tekrarlanan **+%24,42 arama p95 gerilemesi** nedeniyle reddettiği
lisans CARD-01 adayı aktif paketten çıkarıldı. Lisans uygulaması ve özgün editör
testi güncel Main `5b8c1e6f` ile byte düzeyinde aynıdır. Lisans işi **açık / aday
reddedildi** durumundadır; maliyetsiz olduğu için atlandı veya tamamlandı sayılmaz.

Üretici ve rehber CARD-01, INT-09 aktif sohbet çizimi ve CPR-11 hata derleme
önbelleği korunur. Ayrım anında bu dört üretim dosyası `f3636ba` ile birebirdi. Son gerçek UI
kontrolünün açığa çıkardığı eşit rehber okuması problemi `4277ccbb` ile
düzeltildi; yalnız email `absorb` sınırı değişti, render yolu ve diğer üç
üretim modülü değişmedi. Geçerli
önceki ölçümler kendi SHA ve sentetik renderer sınırlarıyla korunur; tüm uygulama
açılışı kazanımı değildir. Hacim 5.000 kayıt üzerinde 10 seçim/arama örneğidir.

Ayrım `261238c2`, normal Main merge `af1cb62f`. Orijinal sekiz commit,
108 tarihsel kanıt dosyası, beş PNG, RED kayıtları ve lisans test/kod/araçlarının
birebir arşivi korunur. Yerel `parked-license-card01-f363-20261107` dalı da özgün
head'i korur. Arşivdeki yeniden uygulama patch'i otomatik yeniden etkinleştirme
izni değildir.

Özgün editör assertion'ları korunur. 14 Quick FOB fonksiyonel testinin gövdeleri
ve hesap/seçim/draft assertion'ları değişmedi; fixture Main'in tam çizimini
çalıştırır. Yalnız reddedilen liste-kimliği optimizasyonuna ait beklentiler,
özgün kodlarıyla açıkça arşivlendi. Skip/only veya hata yutma eklenmedi.
42 Main sürüm notu nesnesi ve kalan üç kendi kayıt birebir korunur: toplam 45.

Aynı bağımsız inceleme turunun dar kapsam çıkarma kapanışında yeni P1/P2 yok.
Bu yeni bir genel inceleme veya performans kabulü değildir. İlk ilgili paket
14 dosya / 137 PASS. Son gerçek tarayıcı kontrolleri, geniş ilgili paket, varsayılan
runner ile tek çağrıda bütün 10 batch, i18n, release-note validator ve son SHA CI
sonuçları `validation/` altında tamamlanacaktır. Önceki yeşil koşular yeni delta
kabulü sayılmaz. Merge öncesinde durulur; TEST/STABLE yayımlanmaz.

## EN

The user rejected the repeatable **+24.42% license-search p95** regression.
License CARD-01 is removed from the active package. Its production module and
original editor test are byte-identical to current Main `5b8c1e6f`. The license
item remains **open; candidate rejected**, rather than completed or skipped for
lack of measurable cost.

Manufacturers/email CARD-01, INT-09 active chat rendering and CPR-11 compilation
error caching remain. At removal, all four production files were byte-identical to `f3636ba`.
A subsequent real UI regression exposed unchanged directory reads replacing
record references; narrow fix `4277ccbb` changes only email `absorb`, preserving
its renderer and the other three production modules.
Earlier valid measurements retain their source SHAs and synthetic renderer scope;
they do not establish application-wide startup gains. The volume was 5,000 records
with ten selection/search samples, not 5,000 selections.

Removal `261238c2` and normal Main merge `af1cb62f` preserve the original eight
commits, all 108 historical evidence files, five PNGs and RED artifacts. Exact
license source/test/tool archives, a parked branch and reapplication patch retain
the rejected candidate; the patch does not authorize reactivation. All fourteen
Quick FOB functional test bodies/assertions remain, using the existing Main full
render. Only rejected optimization identity invariants are explicitly archived.
The 42 Main note objects plus three retained own entries remain exact (45 total).

The narrow closure within the previous independent review round found no new
reportable P1/P2. Reviewer did not rerun tests/browser/benchmarks. Initial related
verification: 14 files / 137 PASS. Final browser, broad related, unchanged full
runner (all ten batches in one invocation), i18n, release notes and final-head CI
remain pending in `validation/`. Old green runs do not accept this delta.
**Stop before merge; no TEST/STABLE publication.**


## Rehber okuma kapanışı / directory-read closure

[Doğrulandı] Gerçek açılışın sonunda `reconcileLegacyDirectoryIfSparse`, aynı
rehberi yeniden okur. Eski `absorb`, hash aynı olduğunda false dönmeden önce
kayıt dizisini değiştiriyordu. Seçimde liste elemanları kayboluyordu: eski ve yeni
veri JSON'u eşit, `recordsSame=false`, `rowSame=false`. İki gerçek UI RED'i ve ilk
sözdizimi/loader hatası ayrı saklandı. Native public API testi **4/1→5/0**.

`4277ccbb` güncellemeyi önce adayda hazırlar; içerik değişmediyse mevcut liste ve
rehber referanslarını korur. Değişen lock/revision/currentUser/başlıklar ve açık
boş kayıtlar hâlâ uygulanır; yeni paralel cache veya yetki kontrolü yoktur. Aynı
gerçek Buyer Log kontrolleri düzeltmede PASS: dört kimlik/veri ölçütü true,
üretici seçimi, lisans draft/reopen/discard ve rehber save korunur. İki yeni gerçek
PNG incelendi ve yalnız kendi aktif sürüm notu görsellerine yazıldı; tarihsel
PNG'ler eski commitlerde/arşivlerde korunur. TR/EN rehber kaydı güncellendi.

Dar delta bağımsız incelemesi `af1cb62f..4277ccbb` için yeni P1/P2 bulmadı;
yeni genel tur yapılmadı. **8898 PASS** sonucu düzeltmeden önceki `af1cb62f`
ağacına aittir. Kod değiştiği için son standart tam paket yeniden çalıştırılır;
eski sonucu yeni kabul saymayız. Son kanıt `validation-after-directory-fix/`.

The actual app's final sparse-reconciliation read returned unchanged JSON but
replaced the records array before reporting no change. The next selection rebuilt
row nodes. Native public-API regression **4 PASS / 1 FAIL → 5 PASS / 0 FAIL**;
the identical real UI assertions now pass (list, row, records and data retained),
along with manufacturer selection, license draft lifecycle and directory save.
The narrowly reviewed fix stages recognized snapshot fields before the existing
signature comparison. Actual changed locks/revisions/users/headings and explicit
empty records still apply. No parallel cache or authorization change is introduced.
Inspected current-app PNGs and the bilingual own directory entry were updated.
The original 8898-pass full run belongs to the pre-fix tree; final full validation
must be repeated after the fix. No speedup is claimed for this new boundary fix.


## Son entegre kabul / final integrated acceptance

Test edilen son kaynak `4277ccbb`, uygulama ağacı
`76d3e7965f39a735913bed79454cba88d36c2f11`. Standart `npm test`, tek çağrıda
bütün 10 batch, varsayılan concurrency=4, private TMPDIR ve NODE_OPTIONS
olmadan: **1.298 dosya / 8.903 PASS / 0 FAIL / 65 mevcut SKIP / 0 CANCEL**.
Geniş ilgili paket **582 PASS**. i18n **0/0**, release-note validator **45 PASS**.
Gerçek UI kontrolleri ve native public API RED→GREEN yukarıda kayıtlıdır.
Lisans uygulaması/editör testi Main ile birebir; üç diğer modül f363 ile birebir;
email modülünün yalnız yukarıdaki okuma sınırı değişti. Render fonksiyonu ve
ölçülen kalan işlem yolları değişmediği için eski geçerli kıyaslar yenilenmedi.

The final source `4277ccbb` passed the unchanged standard full runner, all ten
batches in one invocation at default concurrency4, private TMPDIR, no NODE_OPTIONS:
**1,298 files / 8,903 PASS / 0 FAIL / 65 existing SKIP / 0 CANCEL**. Related package
**582 PASS**, i18n **0/0**, release notes **45 PASS**. The rejected license code
and original editor test remain byte-exact Main. The only post-removal production
change is the documented email snapshot boundary; render and the other three
modules are unchanged. Prior valid operation benchmarks retain their original
source provenance; no new performance gain is claimed for this boundary fix.
All five original PNGs are additionally archived byte-exact. Final-head GitHub
checks remain a separate gate. **No merge, TEST or STABLE.**
