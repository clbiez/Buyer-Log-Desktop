'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

test('v4.86 program bridge links ignore pointer single-click and open on double-click', () => {
  assert.match(INDEX, /const BRIDGE_LINK_SELECTOR = 'a\.lnk\[href\]'/);
  assert.match(INDEX, /document\.addEventListener\('click',event=>\{[\s\S]*?event\.detail===0[\s\S]*?event\.preventDefault\(\)/);
  assert.match(INDEX, /document\.addEventListener\('auxclick',event=>\{[\s\S]*?event\.preventDefault\(\)/);
  assert.match(INDEX, /document\.addEventListener\('dblclick',event=>\{[\s\S]*?window\.open\(link\.href,link\.target\|\|'_blank','noopener,noreferrer'\)/);
});

test('v4.86 bridge cells explain the double-click behavior', () => {
  const links = INDEX.match(/<a class="lnk"[^>]+>/g) || [];
  assert.ok(links.length >= 4, 'all runtime order and shipment bridge links should be marked');
  // detailOrderLinkHtml (app-main.js:156-161) tooltip metnini önce ayrı bir `title`
  // değişkenine atayıp sonra interpole ediyor; bu yüzden onun <a> etiketinin KAYNAK
  // METNİNDE ifade doğrudan geçmiyor (çalışma zamanında geçiyor). Diğer tüm link
  // üreticileri metni doğrudan gömüyor — o yüzden bu tek istisna ayrıca doğrulanır.
  const indirectTitleAttr = 'title="${escapeHtml(title)}"';
  let directlyChecked = 0;
  for (const link of links) {
    if (link.includes(indirectTitleAttr)) continue;
    assert.match(link, /Double-click to open/);
    assert.match(link, /Açmak için çift tıklayın/);
    assert.match(link, /target="_blank"/);
    directlyChecked++;
  }
  assert.ok(directlyChecked >= 3, 'en az birkaç bağlantı metni doğrudan gömmelidir');
});
