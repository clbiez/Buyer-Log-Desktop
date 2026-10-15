'use strict';

/* Tasarım dili bekçisi (DESIGN_SYSTEM.md).
   Buyer Log'un görsel bütünlüğü üç ortak ölçeğe dayanır: yazı boyutu (--fs-*),
   köşe yarıçapı (--r-*) ve yazı ailesi (--sans / --head / --mono). Sabit px yazı
   boyutu "Arayüz boyutu" ayarını sessizce yok sayar; sabit yarıçap ve aile
   listesi her modülün kendi görsel dilini üretmesine yol açar. Bu test yeni
   sızıntıları engeller. Ham renk kodları için dosya başına dondurulmuş bir tavan
   vardır: sayı yalnız azalabilir, yeni dosya ham renk taşıyamaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const CSS_FILES = fs.readdirSync(PUBLIC).filter(name => name.endsWith('.css')).sort();
const COLOR_BASELINE = require('./fixtures/design-color-baseline.json');

function declarations(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let selector = '', buffer = '', fontFace = false;
  for (const ch of css) {
    if (ch === '{') { selector = buffer.trim(); buffer = ''; if (/@font-face/.test(selector)) fontFace = true; continue; }
    if (ch === ';' || ch === '}') {
      const match = buffer.match(/^\s*([\w-]+)\s*:\s*([\s\S]*)$/);
      if (match && !match[1].startsWith('--')) out.push({ prop: match[1].toLowerCase(), value: match[2].trim(), selector, fontFace });
      buffer = '';
      if (ch === '}') fontFace = false;
      continue;
    }
    buffer += ch;
  }
  return out;
}

function withoutVarFallbacks(value) {
  let previous;
  do { previous = value; value = value.replace(/var\(--[\w-]+\s*,[^()]*(?:\([^()]*\)[^()]*)*\)/g, 'var()'); } while (value !== previous);
  return value;
}

function literalColorCount(source) {
  return declarations(source).reduce((count, decl) =>
    count + (withoutVarFallbacks(decl.value).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || []).length, 0);
}

const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('Ortak ölçek token\'ları tanımlı ve kullanıcının yazı boyutu ayarına bağlı', () => {
  const app = read('app.css');
  for (const token of ['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-base', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl', '--fs-4xl']) {
    assert.match(app, new RegExp(`${token}:calc\\([0-9.]+px \\+ var\\(--ui-font-add\\)\\)`), `${token} tanımı eksik`);
  }
  assert.match(app, /--r-pill:999px; --r-round:50%;/);
  assert.match(read('giris.css'), /--fs-base:calc\(13px \+ var\(--ui-font-add\)\)/, 'giriş sayfası app.css yüklemez; ölçeği kendi tanımlamalı');
});

test('Hiçbir stil dosyası sabit px yazı boyutu kullanmaz', () => {
  const leaks = [];
  for (const file of CSS_FILES) {
    for (const decl of declarations(read(file))) {
      if (decl.prop === 'font-size' && /^\d*\.?\d+px/.test(decl.value)) leaks.push(`${file} ${decl.selector} → ${decl.value}`);
      if (decl.prop === 'font' && /(^|\s)\d*\.?\d+px(?=[\s/]|$)/.test(decl.value)) leaks.push(`${file} ${decl.selector} → font:${decl.value}`);
    }
  }
  assert.deepEqual(leaks.slice(0, 25), [], `sabit yazı boyutu --fs-* ölçeğine bağlanmalı (${leaks.length} adet)`);
});

test('Köşe yarıçapı yalnız --r-* token\'larından gelir', () => {
  const leaks = [];
  for (const file of CSS_FILES) {
    for (const decl of declarations(read(file))) {
      if (!/^border(-(top|bottom)-(left|right))?-radius$/.test(decl.prop)) continue;
      if (/\d*\.?\d+px/.test(withoutVarFallbacks(decl.value).replace(/\b0px\b/g, '0'))) leaks.push(`${file} ${decl.selector} → ${decl.value}`);
    }
  }
  assert.deepEqual(leaks.slice(0, 25), [], `sabit yarıçap görsel dili böler (${leaks.length} adet)`);
});

test('Yazı ailesi yalnız --sans, --head veya --mono token\'ından gelir', () => {
  const leaks = [];
  for (const file of CSS_FILES) {
    for (const decl of declarations(read(file))) {
      if (decl.fontFace) continue;
      let family = '';
      if (decl.prop === 'font-family') family = decl.value;
      else if (decl.prop === 'font') { const m = decl.value.match(/var\(--fs-[\w-]+\)(?:\/\S+)?\s+([\s\S]+)$/); family = m ? m[1] : ''; }
      family = family.replace(/\s*!important\s*$/, '').trim();
      if (!family || /^(inherit|initial|unset)\b/.test(family)) continue;
      if (/^var\(--(sans|head|mono|login-font|login-heading)[,)]/.test(family)) continue;
      if (/yu gothic|meiryo|cjk/i.test(family)) continue; // CJK yedek listesi bilinçli
      leaks.push(`${file} ${decl.selector} → ${family}`);
    }
  }
  assert.deepEqual(leaks, [], 'yazı ailesi listesi yerine token kullanılmalı');
});

test('Ham renk kodu sayısı dosya başına dondurulmuş tavanı aşamaz; yeni dosya ham renk taşımaz', () => {
  const over = [];
  for (const file of CSS_FILES) {
    const count = literalColorCount(read(file));
    const ceiling = Object.prototype.hasOwnProperty.call(COLOR_BASELINE, file) ? COLOR_BASELINE[file] : 0;
    if (count > ceiling) over.push(`${file}: ${count} > ${ceiling}`);
  }
  assert.deepEqual(over, [], 'yeni renk token\'dan gelmeli (DESIGN_SYSTEM.md §1); tavan yükseltilemez, yalnız düşürülebilir');
  for (const [file, ceiling] of Object.entries(COLOR_BASELINE)) {
    assert.ok(Number.isInteger(ceiling) && ceiling > 0, `${file} tavanı pozitif tam sayı olmalı; sıfıra inen dosya listeden çıkarılır`);
  }
});

test('Kullanılan her CSS değişkeni bir yerde tanımlıdır (hayalet token yok)', () => {
  /* Denetimde 21 tanımsız token bulundu (--bg 50 kez, --warn, --ok, --surface …):
     tanımsız var() geçersiz değer üretir; zemin şeffaf kalır, sabit fallback her
     temada aynı renge düşer. Değişken CSS'te tanımlanmalı ya da JS'te
     setProperty/style ile çalışma anında atanmalıdır. */
  const js = fs.readdirSync(PUBLIC).filter(name => name.endsWith('.js') && name !== 'i18n-dictionary.js').map(name => fs.readFileSync(path.join(PUBLIC, name), 'utf8')).join('\n');
  const css = CSS_FILES.map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const html = fs.readdirSync(PUBLIC).filter(name => name.endsWith('.html')).map(read).join('\n');
  const defined = new Set();
  for (const source of [css, js, html]) for (const m of source.matchAll(/(?:^|[\s;{"'`(])(--[a-zA-Z][\w-]*)\s*:/g)) defined.add(m[1]);
  for (const m of js.matchAll(/setProperty\(\s*['"`](--[a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  for (const m of js.matchAll(/['"`](--[a-zA-Z][\w-]*)['"`]\s*[,)]/g)) defined.add(m[1]);
  const used = new Set();
  for (const source of [css, js]) for (const m of source.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)/g)) used.add(m[1]);
  // Çalışma anında üretilen dinamik isimler: `--cp-row-h-${tableKey}` → '--cp-row-h-' öneki
  const dynamicPrefixes = [...js.matchAll(/`(--[a-zA-Z][\w-]*-)\$\{/g)].map(m => m[1]);
  const phantom = [...used].filter(name => !defined.has(name) && !dynamicPrefixes.some(prefix => name.startsWith(prefix))).sort();
  assert.deepEqual(phantom, [], 'tanımsız token; kanonik karşılığını kullan (DESIGN_SYSTEM.md §5)');
});
