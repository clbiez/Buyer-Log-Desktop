'use strict';

/*
 * PLANLI OTOMASYONLARDA GÖRELİ TARİH
 *
 * Bulunan kusur: otomasyon filtreleri statik metin tutuyor ve "geciken
 * siparişler" kuralında kurulum günündeki tarih DEĞERE GÖMÜLÜYORDU.
 *
 * Sonuç sessiz bir yanlıştı: haftalık çalışan bir hatırlatma otomasyonu,
 * kurulduğu günden sonra geciken siparişleri hiç görmez. Rapor her hafta biraz
 * daha eksilir ve kimse fark etmez — hatalı e-posta gitmez, EKSİK e-posta gider.
 *
 * Düzeltme: değer çalışma anında çözülen bir belirteç (@today) olarak saklanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

/* Çözücüyü sunucu kaynağından çıkarıp çalıştırır: kopyasını yazmak, testin
   gerçek davranışı değil kendi kopyasını doğrulaması olurdu. */
function loadResolver() {
  const start = SERVER.indexOf('const AUTOMATION_DATE_TOKEN=');
  const end = SERVER.indexOf('function automationApplyFilters');
  assert.ok(start > 0 && end > start, 'çözücü sunucuda bulunmalı');
  return new Function(`${SERVER.slice(start, end)}\nreturn { automationResolveFilterValue, automationResolveFilters };`)();
}

const { automationResolveFilterValue, automationResolveFilters } = loadResolver();

function todayISO(offsetDays = 0) {
  const at = new Date();
  at.setDate(at.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

test('@today çalışma anındaki takvim gününe çözülür', () => {
  assert.equal(automationResolveFilterValue('@today'), todayISO());
});

test('@today ± gün kaydırması desteklenir', () => {
  assert.equal(automationResolveFilterValue('@today-7d'), todayISO(-7));
  assert.equal(automationResolveFilterValue('@today + 3d'), todayISO(3));
});

test('yerel takvim günü kullanılır, UTC değil', () => {
  /* toISOString UTC'ye çevirir; UTC+3'te gece yarısından sonra günü bir geri
     kaydırırdı ve otomasyon yanlış günün siparişlerini raporlardı. */
  const resolved = automationResolveFilterValue('@today');
  const now = new Date();
  assert.equal(Number(resolved.slice(8, 10)), now.getDate());
  assert.equal(Number(resolved.slice(5, 7)), now.getMonth() + 1);
});

test('statik tarihler ve normal metinler DEĞİŞTİRİLMEZ', () => {
  // Mevcut tarifler aynen çalışmaya devam etmeli.
  for (const value of ['2026-01-15', 'ABC Tekstil', '', 'today', '@yesterday', '@todayx']) {
    assert.equal(automationResolveFilterValue(value), value, `değişmemeli: ${value}`);
  }
});

test('yalnız belirteç taşıyan kural kopyalanır; diğerleri aynı nesne kalır', () => {
  const rules = [
    { field: 'Retail Date', operator: 'lt', value: '@today' },
    { field: 'STATUS', operator: 'contains', value: 'Üretimde' },
  ];
  const resolved = automationResolveFilters(rules);
  assert.equal(resolved[0].value, todayISO());
  assert.equal(resolved[1], rules[1], 'dokunulmayan kural yeniden oluşturulmamalı');
  assert.equal(rules[0].value, '@today', 'KAYITLI değer belirteç olarak kalmalı');
});

test('çözüm uygulama anında yapılır, kayıt anında değil', () => {
  // Kayıtlı tarif belirteci korumalı; aksi hâlde ilk çalıştırmada donardı.
  const block = SERVER.slice(SERVER.indexOf('function automationApplyFilters'), SERVER.indexOf('function automationApplyFilters') + 600);
  assert.match(block, /filterRows\(Array\.isArray\(rows\)\?rows:\[\],automationResolveFilters\(normal\)\)/,
    'filtreler uygulanmadan hemen önce çözülmeli');
});
