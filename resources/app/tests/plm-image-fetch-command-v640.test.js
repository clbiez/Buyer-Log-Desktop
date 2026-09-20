'use strict';

/* v6.40 — GÖRSELE SAĞ TIK → "GÖRSELİ PLM'DEN ÇAĞIR".
 *
 * Kullanıcı isteği: silme komutunun çıktığı pencereye tek model için PLM'den
 * görsel çağırma komutu eklensin.
 *
 * Tasarım kararı: komut, toplu "eksikleri tamamla" akışının AYNISINI tek satırla
 * kullanır. Ayrı bir yol yazmak, Edge bağlantısı / yetki / mezar taşı temizliği
 * gibi kuralların iki akışta zamanla ayrışması demekti.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'design-butunluk.css'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

test('v6.40 komut üç ekranda da sağ tık penceresine bağlı', () => {
  // CP, Siparişler ve Koleksiyon.
  const wired = APP.match(/onFetch:\(\)=>fetchPlmImageForModel\(/g) || [];
  assert.equal(wired.length, 3, 'üç ekranda da bağlı olmalı');
  // Her biri kendi tablosunu yeniden çizmeli, yoksa görsel gelir ama görünmez.
  assert.match(APP, /fetchPlmImageForModel\(\{plmId:row\['PLM ID'\],colourCode:row\['C\.Code'\],styleName:row\['Model Name'\]\}\)\.then\(\(\)=>renderCp\(\)\)/);
  assert.match(APP, /fetchPlmImageForModel\(\{plmId:row\.plmId,colourCode:row\.colourCode,colour:row\.colour,styleName:row\.modelKod\}\)\.then\(\(\)=>renderKol\(\)\)/);
});

test('v6.40 düğme yalnız onFetch verildiğinde çıkıyor', () => {
  // Koleksiyon dışı bir çağıran onFetch vermezse pencere eski davranışını
  // korumalı; koşulsuz düğme, PLM bağlantısı olmayan yerlerde ölü komut olurdu.
  assert.match(APP, /\$\{typeof onFetch==='function'\?`<button type="button" class="imageFetchPlm">/);
  const body = bodyOf(APP, 'openImageDeleteConfirm');
  assert.match(body, /pop\.querySelector\('\.imageFetchPlm'\)\?\.addEventListener/);
});

test('v6.40 çağırma sırasında düğme kilitleniyor ve hata geri alıyor', () => {
  // Çift tıklama iki ayrı PLM turu başlatırdı.
  const body = bodyOf(APP, 'openImageDeleteConfirm');
  const block = body.slice(body.indexOf(".imageFetchPlm'"));
  assert.match(block, /btn\.disabled=true/);
  assert.match(block, /btn\.disabled=false;btn\.textContent=label/, 'hata sonrası düğme geri gelmeli');
});

test('v6.40 görsel gelmezse sessiz başarı yok', () => {
  // En kritik davranış: PLM görsel döndürmediyse komut sessizce "başarılı"
  // görünmemeli. Kullanıcı pencereyi kapanmış görüp görselin geldiğini sanardı.
  const body = bodyOf(APP, 'fetchPlmImageForModel');
  assert.match(body, /if\(!hit\)\{/);
  assert.match(body, /throw new Error/);
  // Sunucunun bildirdiği gerçek sebep varsa o gösterilmeli, genel mesaj değil.
  assert.match(body, /data&&data\.imageFailedItems/);
  // PLM ID yoksa istek hiç gönderilmemeli.
  assert.match(body, /if\(!id\)throw new Error/);
  // Tek model çağrısı da toplu PLM akışıyla aynı direct API bağlantı kapısını kullanmalı.
  assert.match(body, /await ensureCoreNectumApiConnection\(\)/);
});

test('v7.12 tek model çağrısı dedicated PLM image endpointini kullanıyor', () => {
  const body = bodyOf(APP, 'fetchPlmImageForModel');
  assert.match(body, /\/api\/model-images\/import-plm/);
  assert.match(body, /mode:'all'/);
  assert.doesNotMatch(body, /applyPlmStyleLinksPayload\(data\)/);
  assert.match(body, /applySyncedPlmImages\(data\)/);
});

test('v6.40 kesme işaretli metinler dizgiyi bozmuyor', () => {
  // TUZAK: "PLM'den" metni tek tırnaklı bir dizginin içine kaçışsız konursa
  // dizgi erken kapanır ve DOSYA KOMPLE çöker (v3.55/v3.63 dersinin aynısı).
  // node --check zaten bunu yakalar; burada üretilen metnin DOĞRU olduğunu da
  // doğruluyoruz — kaçış fazlaysa ekranda ters eğik çizgi görünürdü.
  const label = new Function("const appLang='tr';return appLang==='en'?'Fetch from PLM':'PLM\\'den Çağır';")();
  assert.equal(label, "PLM'den Çağır");
  const tip = new Function("const appLang='tr';return appLang==='en'?'x':'Tek tık: yapıştırma hedefi · Çift tık: görsel seç · Sağ tık: kaldır veya PLM\\'den çağır';")();
  assert.match(tip, /Sağ tık: kaldır veya PLM'den çağır/);
  // İpucu metni artık yalnız "kaldır" demiyor.
  assert.doesNotMatch(APP, /Sağ tık: görseli kaldır'/);
});

test('v6.40 çağır düğmesi silme onayından görsel olarak ayrışıyor', () => {
  // Yapıcı eylem, yıkıcı eylemle aynı görünmemeli.
  assert.match(CSS, /\.imageDeleteConfirmPopover \.imageFetchPlm\{/);
  assert.match(CSS, /margin-right:auto/);
});
