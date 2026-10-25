'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v7.81 filtre grupları ayrı yüzeyler olarak stillenir', () => {
  // Personal Horizon editor was removed; shared dmf filters retain their group surface.
  assert.doesNotMatch(CSS,/\.hz[A-Z]/,'retired personal editor styles must not ship');
  const DM = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','data-management.css'] );
  assert.match(DM, /\.dmfGroup\s*\{[^}]*background:\s*var\(--ui-surface\)/, 'ortak filtre: grup kendi yüzey tonunu taşımalı');
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
