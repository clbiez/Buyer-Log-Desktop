'use strict';

// Ay takvimine bağlı dini bayramlar (Ramazan/Kurban Bayramı vb.) birçok ülke
// için canlı tatil sağlayıcısında (Nager) eksik gelir. Bu modül tarihleri
// çevrimdışı ve deterministik olarak Intl'in Hicri (Umm al-Qura) takviminden
// hesaplar; sağlayıcıda karşılığı olmayan bayramlar "tahmini" işaretiyle
// eklenir. Resmi ilan ay gözlemine göre ±1 gün kayabilir.

const HIJRI_CALENDAR = 'islamic-umalqura';
const MATCH_WINDOW_DAYS = 3;

const HOLIDAYS = Object.freeze({
  eid_al_fitr:Object.freeze({ month:10, day:1, name:'Eid al-Fitr',
    match:/fitr|fitri|ramazan|ramadan|ramzan|lebaran|şeker|seker/i }), // i18n-ignore
  eid_al_adha:Object.freeze({ month:12, day:10, name:'Eid al-Adha',
    match:/adha|azha|zuha|zoha|bakrid|bakri|kurban|qurban|sacrific/i }),
  islamic_new_year:Object.freeze({ month:1, day:1, name:'Islamic New Year',
    match:/hijri|islamic new year|muharram|ras as-sana/i }),
  ashura:Object.freeze({ month:1, day:10, name:'Ashura',
    match:/ashura|ashoura|muharram/i }),
  mawlid:Object.freeze({ month:3, day:12, name:"Prophet's Birthday (Mawlid)",
    match:/mawlid|milad|mouloud|maulid|mevlid|prophet|nabi/i }),
});

// Ülke → resmi tatil olan Hicri bayramlar ve Umm al-Qura'ya göre gün kayması.
// Güney Asya'da (BD/IN/PK) bayramlar genellikle Suudi takviminden bir gün sonra
// ilan edilir.
const COUNTRY_RULES = Object.freeze({
  TR:Object.freeze({ offset:0, keys:['eid_al_fitr','eid_al_adha'] }),
  BD:Object.freeze({ offset:1, keys:['eid_al_fitr','eid_al_adha','ashura','mawlid'] }),
  IN:Object.freeze({ offset:1, keys:['eid_al_fitr','eid_al_adha','ashura','mawlid'] }),
  PK:Object.freeze({ offset:1, keys:['eid_al_fitr','eid_al_adha','ashura','mawlid'] }),
  EG:Object.freeze({ offset:0, keys:['eid_al_fitr','eid_al_adha','islamic_new_year','mawlid'] }),
  ID:Object.freeze({ offset:0, keys:['eid_al_fitr','eid_al_adha','islamic_new_year','mawlid'] }),
  AE:Object.freeze({ offset:0, keys:['eid_al_fitr','eid_al_adha','islamic_new_year','mawlid'] }),
  SA:Object.freeze({ offset:0, keys:['eid_al_fitr','eid_al_adha'] }),
});

const hijriDateCache = new Map();

function hijriFormatter() {
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-' + HIJRI_CALENDAR, {
      timeZone:'UTC', year:'numeric', month:'numeric', day:'numeric',
    });
    return fmt.resolvedOptions().calendar === HIJRI_CALENDAR ? fmt : null;
  } catch (_) {
    return null;
  }
}

// Gregoryen yıl içindeki her günün Hicri ay/gününü bir kez hesaplar.
function hijriDaysOfYear(year) {
  if (hijriDateCache.has(year)) return hijriDateCache.get(year);
  const fmt = hijriFormatter();
  const days = [];
  if (fmt) {
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86400000) {
      const parts = {};
      for (const part of fmt.formatToParts(new Date(t))) parts[part.type] = part.value;
      days.push({ t, month:Number(parts.month), day:Number(parts.day) });
    }
  }
  hijriDateCache.set(year, days);
  return days;
}

function isoFromTime(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function islamicHolidayRows(countryCode, year) {
  const rule = COUNTRY_RULES[String(countryCode || '').toUpperCase()];
  const y = Number(year);
  if (!rule || !Number.isInteger(y)) return [];
  const rows = [];
  // Kayma yıl sınırını aşabileceği için önceki yılın son günleri de taranır.
  const days = hijriDaysOfYear(y - 1).slice(-3).concat(hijriDaysOfYear(y));
  for (const key of rule.keys) {
    const holiday = HOLIDAYS[key];
    for (const entry of days) {
      if (entry.month !== holiday.month || entry.day !== holiday.day) continue;
      const date = isoFromTime(entry.t + rule.offset * 86400000);
      if (Number(date.slice(0, 4)) !== y) continue;
      rows.push({
        date,
        name:holiday.name,
        localName:holiday.name,
        nationalHoliday:true,
        global:true,
        holidayTypes:['Public'],
        holidayKey:key,
        estimated:true,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function dayDistance(a, b) {
  return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000;
}

// Sağlayıcı satırlarına yalnız karşılığı olmayan Hicri bayramları ekler.
function mergeIslamicHolidays(rows, countryCode, year) {
  const base = Array.isArray(rows) ? rows : [];
  const extra = islamicHolidayRows(countryCode, year).filter(candidate => {
    const holiday = HOLIDAYS[candidate.holidayKey];
    return !base.some(row => row && row.date
      && dayDistance(String(row.date), candidate.date) <= MATCH_WINDOW_DAYS
      && holiday.match.test(String(row.name || '') + ' ' + String(row.localName || '')));
  });
  return extra.length ? base.concat(extra) : base;
}

module.exports = {
  HIJRI_CALENDAR,
  HOLIDAYS,
  COUNTRY_RULES,
  islamicHolidayRows,
  mergeIslamicHolidays,
};
