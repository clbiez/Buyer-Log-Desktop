'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v7.81 filtre grupları ayrı yüzeyler olarak stillenir', () => {
  /* Korunan kusur: koşul grupları düz bir listede birbirine karışıyor,
     hangi koşulun hangi gruba ait olduğu okunmuyordu. Ekran silinen
     modaldan iki yere taşındı; kural ikisinde de geçerli — bir grup
     KENDİ ÇERÇEVESİ olan bir yüzeydir, çıplak bir satır yığını değil. */
  // Kişisel ufuk düzenleyicisinin stili app.css içinde (.hz* ailesi).
  assert.match(CSS, /\.hzGroup\{[^}]*border:/, 'kişisel ufuk: grup kendi çerçevesini taşımalı');
  const DM = fs.readFileSync(path.join(ROOT, 'public', 'data-management.css'), 'utf8');
  assert.match(DM, /\.dmfGroup\s*\{[^}]*border:/, 'ortak filtre: grup kendi çerçevesini taşımalı');
});

test('v7.81 AND metni gösterilmez, VEYA gösterilir', () => {
  /* Grup İÇİNDE VE, gruplar ARASINDA VEYA. "VE"yi her satırın arasına yazmak
     gürültüydü ve kaldırıldı; "VEYA" ise gruplar arasında GÖRÜNMEK ZORUNDA —
     iki grubun VEYA ile birleştiğini bilmeyen kullanıcı kapsamı yanlış okur. */
  const FILTER = fs.readFileSync(path.join(ROOT, 'public', 'data-management-filter.js'), 'utf8');
  assert.match(FILTER, /class="dmfOr"/, 'gruplar arası VEYA görünmeli');
  const code = FILTER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /'VE'|"VE"|>VE</, 'koşullar arasına VE yazılmamalı');
});

test('Horizon filtre tip seçicisini göstermeden mevcut valueType bilgisini korur', () => {
  /* v7.81: filtre düzenleme eski bağlantı modalından iki yere taşındı —
     kişisel ufuk horizon-editor.js'e, ortak filtre data-management-filter.js'e.
     Korunan kusur İKİSİNDE DE geçerli: kullanıcıya Text/Date/Number diye bir
     tip seçtirmek, yanlış seçildiğinde sessizce boş sonuç veren bir kutuydu.
     Tip ALAN TANIMINDAN gelir, kullanıcıdan değil. */
  const ROOT = path.join(__dirname, '..');
  /* v7.81 — horizon-editor.js SİLİNDİ (kişisel ufuk kaldırıldı); filtre
     düzenleme tek yerde kaldı. Korunan kusur aynı: tip ALAN TANIMINDAN
     gelir, kullanıcıya seçtirilmez. */
  for (const rel of ['public/data-management-filter.js']) {
    const ui = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(ui, /data-cv="valueType"|<select[^>]*valueType/,
      `${rel}: Text/Date/Number seçimi filtre satırında gösterilmemeli`);
    assert.match(ui, /valueType = (meta \? meta\.type : 'text'|meta && meta\.type \? meta\.type : 'text')/,
      `${rel}: tip alan tanımından okunmalı`);
  }
});
