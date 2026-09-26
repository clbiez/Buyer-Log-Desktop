'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Otomatik yamalar etiketleri "\n" kaçışıyla birleştirdiğinde tarayıcı bunu
// metin olarak çizer: her sayfanın sol üstünde ve görünüm altlarında "\n".
test('HTML sayfalarında etiketler arasında kaçışlı \\n metni kalmaz', () => {
  for (const name of fs.readdirSync(PUBLIC).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PUBLIC, name), 'utf8');
    assert.doesNotMatch(html, />\\n</, `${name} etiketler arasında kaçışlı \\n içeriyor`);
  }
});
