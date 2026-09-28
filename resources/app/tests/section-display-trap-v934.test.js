'use strict';

/* v9.34 — GÖRÜNMEZ <section> TUZAĞI
 *
 * PLM Operasyon Merkezi'nin gövdesi boş görünüyordu. HTML yazılıyordu, iki
 * bölüm de DOM'daydı, içerikleri doğruydu — ama ikisi de `display:none` idi.
 *
 * Sebep, uygulamanın sekme sisteminin ELEMENT seçicisiyle kurulmuş olması:
 *
 *     app.css:265   section{display:none;} section.active{display:block;}
 *
 * Kural bütün belgeye uygulanıyor. Gruplama amaçlı masum bir <section>,
 * kendisine display veren bir kural bulamazsa SESSİZCE kayboluyor: konsola
 * hata düşmüyor, HTML doğru, ekranda hiçbir şey yok.
 *
 * CANLI ÖLÇÜM (kullanıcının oturumu, panel açıkken):
 *     bölümler  none:0  →  block:73
 *     gövde     28px    →  184px      (28px = yalnız padding'di)
 *     kart      142px   →  298px
 *
 * NEDEN DEPO GENELİ BİR TARAMA YOK. Önce her <section> sınıfını tarayıp
 * display arayan bir test yazdım; 22 sınıf işaretledi ve BÜYÜK ÇOĞUNLUĞU
 * yanlış alarmdı. İki sebeple:
 *
 *   1) Bir <section> birden fazla sınıf taşıyabiliyor; display'i vermek için
 *      BİRİNİN vermesi yeterli.
 *   2) Kapsayıcı kurallar da veriyor: `.iamWizard>section{display:grid}` gibi.
 *      (Fiyat & Üretici Analizi v3 artık <section> üretmiyor; kendi
 *      kapsayıcı kuralına gerek kalmadı.)
 *
 * Bunu statik CSS'ten güvenilir çıkarmak bir yerleşim motoru istiyor. Yalan
 * söyleyen bir test, olmayan bir testten kötüdür: ya silinir ya da gerçek bir
 * hatayı "zaten kırmızıydı" diye örter. Bu yüzden test DAR ve DOĞRU tutuldu;
 * tuzağın kendisi CLAUDE.md'de yazılı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const readCss = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');
const APP_CSS = readCss('app.css');

test('v9.34 tuzağı doğuran kural hâlâ orada', () => {
  /* Kural kalkarsa bu dosyanın anlattığı hikâye de geçersizleşir; testin
     sessizce "geçer" duruma düşmemesi için önce dayanağını doğrular. */
  assert.match(APP_CSS.replace(/\/\*[\s\S]*?\*\//g, ''),
    /section\{display:none;\}\s*section\.active\{display:block;\}/);
});

test('v9.34 PLM operasyon bölümleri display’ini AÇIKÇA veriyor', () => {
  /* Asıl hata buydu: .plmOpsSection yalnız padding tanımlıyordu, display
     tanımlamıyordu ve global kural onu gizliyordu. */
  assert.match(APP_CSS, /\.plmOpsSection\{display:block;/);
});

test('v9.34 operasyon merkezi bölümleri <section> olarak üretilmeye devam ediyor', () => {
  /* Düzeltme CSS tarafında. Biri markup'ı <div>'e çevirirse CSS kuralı
     gereksizleşir ama zararsızdır; tersi olursa — <section> kalıp CSS
     silinirse — hata AYNEN geri gelir. Bu test o eşleşmeyi tutuyor. */
  const source = fs.readFileSync(path.join(PUBLIC, 'plm-operations.js'), 'utf8');
  const sections = [...source.matchAll(/<section class="([^"]+)"/g)].map(match => match[1]);
  assert.ok(sections.length >= 2, 'operasyon merkezi iki bölüm çiziyor');
  sections.forEach(cls => assert.match(cls, /\bplmOpsSection\b/,
    'display veren sınıfı taşımayan bir <section> görünmez olur'));
});

test('v9.34 <section>’a display veren kurallar biliniyor', () => {
  /* Bu liste bir kısıt değil, bir HARİTA: yeni bir bölüm eklerken hangi
     kapsayıcıların display verdiğini bilmek, aynı hatayı tekrar yapmamanın
     en kısa yolu. Liste değişirse test kırılır ve harita güncellenir. */
  const css = fs.readdirSync(PUBLIC).filter(name => name.endsWith('.css'))
    .map(readCss).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const granting = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => /(^|[\s,>+~(])section([\s.:,>+~)]|$)/.test(match[1])
      && /(^|;)\s*display\s*:/.test(match[2]))
    .map(match => match[1].trim());
  assert.deepEqual(granting.sort(), [
    '.iamWizard>section',
    'section',
    'section.active',
  ], 'section’a display veren kural kümesi değişti — CLAUDE.md’deki notu güncelleyin');
});
