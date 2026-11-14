'use strict';
// Lazy modül (ör. Koleksiyon) stilleri/kodu yüklenirken bölüm visibility:hidden ile
// gizlenir. Gizli bölümden yalnız grup başlıkları sızıyor ve ekran yarım boş
// görünüyordu; bekleme süresince genel kültür kartlı yükleme kutusu gösterilir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','public');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('group follow labels inherit visibility instead of forcing it visible',()=>{
  const js=read('table-header-tracking.js');
  assert.doesNotMatch(js,/style\.visibility\s*=\s*[^;]*'visible'/);
  assert.match(js,/label\.style\.visibility=result\.visible\?'':'hidden'/);
});

test('a lazy feature view shows a trivia-eligible loading state while it is hidden',()=>{
  const js=read('perf-runtime.js'),css=read('app.css');
  assert.match(js,/function mountFeatureLoader\(view\)/);
  assert.match(js,/blFeatureLoading/);
  // Aynı özellik grubunun gizli modüllerine kutu eklenmez.
  assert.match(js,/!view\.getClientRects\?\.\(\)\.length/);
  assert.match(js,/kind:'loading'/);
  assert.match(js,/uiState uiState--loading/);
  assert.match(js,/'Ekran hazırlanıyor…'/);
  assert.match(js,/'Preparing the screen…'/);
  // Yükleme bitince ya da hata alınca kutu kaldırılır.
  assert.match(js,/finally\{\s*clearTimeout\(loaderTimer\);[^}]*removeAttribute\('data-bl-styles-loading'\)[^}]*loaders\.forEach\(box=>box\?\.remove\(\)\)/);
  // Hızlı açılış kutu/orb maliyeti ödemez.
  assert.match(js,/setTimeout\(\(\)=>\{loaders=views\.map\(mountFeatureLoader\);\},FEATURE_LOADER_DELAY_MS\)/);
  assert.match(css,/\[data-bl-styles-loading\]>\.blFeatureLoading\{[^}]*visibility:visible!important/);
});
