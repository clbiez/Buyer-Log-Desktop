'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('startup curtain exposes explicit TR/EN language selection',()=>{
  assert.match(INDEX,/className='blBootLanguage'/);
  assert.match(INDEX,/data-boot-lang="tr"[^>]*>TR<\/button>/);
  assert.match(INDEX,/data-boot-lang="en"[^>]*>EN<\/button>/);
  assert.match(INDEX,/chooser\.setAttribute\('data-no-i18n',''\)/);
  assert.match(INDEX,/aria-pressed',String\(on\)/);
});

test('startup language selection uses the canonical app language path with a safe fallback',()=>{
  assert.match(INDEX,/document\.getElementById\('railLangBtn'\)/);
  assert.match(INDEX,/window\.BLStorage\?\.setItem\?\.\('lcw\.lang\.v1',next\)/);
  assert.match(INDEX,/window\.BLI18n\?\.setLanguage\?\.\(next\)/);
  assert.match(INDEX,/window\.BLGuide\?\.refreshLanguage\?\.\(\)/);
  assert.match(INDEX,/bl:language-changed/);
});

test('startup language control is styled for light and dark startup themes',()=>{
  const css=fs.readFileSync(path.join(__dirname,'..','public','ui-startup.css'),'utf8');
  const tokens=fs.readFileSync(path.join(__dirname,'..','public','ui-tokens.css'),'utf8');
  assert.match(css,/#blBootGuard \.blBootLanguage\{/);
  assert.match(css,/background:var\(--ui-accent\);color:var\(--ui-on-accent\)/);
  assert.match(tokens,/:root\[data-theme="dark"\]/);
  assert.match(css,/button\[aria-pressed="true"\]/);
});
