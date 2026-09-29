'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initials } = require('../public/user-initials.js');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('Türkçe ve İngilizce adlarda ilk iki kelimenin baş harfi', () => {
  assert.equal(initials('Gökberk Çelebi'), 'GÇ');
  assert.equal(initials('gökberk çelebi'), 'GÇ');
  assert.equal(initials('ilker yılmaz'), 'İY');
  assert.equal(initials('Ömer Faruk Şahin'), 'ÖF');
  // Türkçe harf yoksa İngilizce büyük harf kuralı: i → I (İ değil).
  assert.equal(initials('ian smith'), 'IS');
  assert.equal(initials('John'), 'J');
  assert.equal(initials('gokberk.celebi'), 'GC');
});

test('Japonca ve Çince adlarda boşluktan bağımsız ilk iki karakter', () => {
  assert.equal(initials('山田太郎'), '山田');
  assert.equal(initials('山田　太郎'), '山田');
  assert.equal(initials('王小明'), '王小');
  assert.equal(initials('王 小明'), '王小');
  assert.equal(initials('やまだ たろう'), 'やま');
  assert.equal(initials('ヤマダ'), 'ヤマ');
  // Ek düzlem (vekil çiftli) Han karakteri bölünmez.
  assert.equal(initials('𠮷野 家'), '𠮷野');
});

test('boş ad güvenli yer tutucu döner', () => {
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
  assert.equal(initials(null), '?');
});

test('istemci ve sunucu aynı baş harf kuralını kullanır', () => {
  assert.match(read('public/index.html'), /<script src="user-initials\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
  assert.match(read('public/user-access-ui.js'), /window\.BLUserInitials\.initials\(name\)/);
  assert.match(read('public/user-management.js'), /window\.BLUserInitials\.initials\(clean\(name\)\)/);
  assert.match(read('server/lib/user-access.js'), /require\('\.\.\/\.\.\/public\/user-initials\.js'\)/);
  assert.match(read('server/server.js'), /const initials = userInitials\(profile\.displayName\);/);
  for (const file of ['public/user-access-ui.js', 'public/user-management.js', 'server/lib/user-access.js', 'server/server.js']) {
    assert.doesNotMatch(read(file), /\.map\((?:value|part|v) => (?:value|part|v)\[0\]\)/, file + ' eski baş harf kodunu içermemeli');
  }
});
