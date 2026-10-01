'use strict';

const fs = require('fs');
const path = require('path');

const NAGER_V4 = 'https://nagerholidays.com/api/v4/Holidays';
const NAGER_V3 = 'https://nagerholidays.com/api/v3/PublicHolidays';
const OFFICE_ICS_BASE = 'https://www.officeholidays.com/ics-clean';
const INDIA_OFFICIAL_CALENDAR = 'https://www.india.gov.in/calendar';
const REQUEST_TIMEOUT_MS = 9000;
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

const OFFICE_SLUGS = Object.freeze({
  TR:'turkey',
  BD:'bangladesh',
  IN:'india',
  CN:'china',
  EG:'egypt',
  PK:'pakistan',
  VN:'vietnam',
  ID:'indonesia',
  GB:'united-kingdom',
  DE:'germany',
  IT:'italy',
  ES:'spain',
  US:'usa',
  BR:'brazil',
  MX:'mexico',
  ZA:'south-africa',
  AE:'united-arab-emirates',
  SA:'saudi-arabia',
  JP:'japan',
  KR:'south-korea',
  AU:'australia',
});

const VERIFIED_CATALOG = Object.freeze({
  'IN|2026':Object.freeze([
    ['2026-01-26','Republic Day'],['2026-03-04','Holi'],['2026-03-21','Id-ul-Fitr'],
    ['2026-03-26','Ram Navami'],['2026-03-31','Mahavir Jayanti'],['2026-04-03','Good Friday'],
    ['2026-05-01','Buddha Purnima'],['2026-05-27','Id-ul-Zuha (Bakrid)'],['2026-06-26','Muharram'],
    ['2026-08-15','Independence Day'],['2026-08-26','Milad-un-Nabi / Id-e-Milad'],
    ['2026-09-04','Janmashtami (Vaishnava)'],['2026-10-02',"Mahatma Gandhi's Birthday"],
    ['2026-10-20','Dussehra'],['2026-11-08','Diwali (Deepavali)'],
    ['2026-11-24',"Guru Nanak's Birthday"],['2026-12-25','Christmas Day'],
  ]),
  'IN|2027':Object.freeze([
    ['2027-01-26','Republic Day'],['2027-03-10','Id-ul-Fitr'],['2027-03-23','Holi'],
    ['2027-03-26','Good Friday'],['2027-04-15','Ram Navami'],['2027-04-19','Mahavir Jayanti'],
    ['2027-05-17','Id-ul-Zuha (Bakrid)'],['2027-05-20','Buddha Purnima'],['2027-06-16','Muharram'],
    ['2027-08-15','Independence Day'],['2027-08-15','Milad-un-Nabi / Id-e-Milad'],
    ['2027-08-25','Janmashtami (Vaishnava)'],['2027-10-02',"Mahatma Gandhi's Birthday"],
    ['2027-10-09','Dussehra (Vijaya Dashami)'],['2027-10-29','Diwali (Deepavali)'],
    ['2027-11-14',"Guru Nanak's Birthday"],['2027-12-25','Christmas Day'],
  ]),
});

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function normalizeYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : 0;
}

function normalizeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) continue;
    const name = String(row.name || row.englishName || row.localName || '').trim();
    if (!name) continue;
    const item = {
      date:String(row.date),
      name,
      localName:String(row.localName || '').trim(),
      nationalHoliday:typeof row.nationalHoliday === 'boolean'
        ? row.nationalHoliday
        : (typeof row.global === 'boolean' ? row.global : true),
      global:typeof row.global === 'boolean'
        ? row.global
        : (typeof row.nationalHoliday === 'boolean' ? row.nationalHoliday : true),
      subdivisionCodes:Array.isArray(row.subdivisionCodes)
        ? row.subdivisionCodes.slice()
        : (Array.isArray(row.counties) ? row.counties.slice() : null),
      holidayTypes:Array.isArray(row.holidayTypes)
        ? row.holidayTypes.slice()
        : (Array.isArray(row.types) ? row.types.slice() : ['Public']),
    };
    const key = item.date + '|' + item.name.toLocaleLowerCase('en');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
}

function verifiedCatalogRows(countryCode, year) {
  const code = normalizeCountryCode(countryCode);
  const y = normalizeYear(year);
  const rows = VERIFIED_CATALOG[code + '|' + y];
  return rows ? normalizeRows(rows.map(([date,name])=>({
    date,name,localName:name,nationalHoliday:true,global:true,holidayTypes:['Public'],
  }))) : [];
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function icsDate(value) {
  const raw = String(value || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function parseIcs(text, year) {
  const wanted = normalizeYear(year);
  if (!wanted) return [];
  const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
  const rows = [];
  for (const block of blocks) {
    const end = block.split(/END:VEVENT/i)[0] || '';
    const dt = (end.match(/^DTSTART(?:;[^:]*)?:(.+)$/mi) || [])[1];
    const summary = (end.match(/^SUMMARY(?:;[^:]*)?:(.+)$/mi) || [])[1];
    const date = icsDate(dt);
    if (!date || Number(date.slice(0,4)) !== wanted || !summary) continue;
    rows.push({
      date,
      name:unescapeIcsText(summary),
      nationalHoliday:true,
      global:true,
      holidayTypes:['Public'],
    });
  }
  return normalizeRows(rows);
}

function loadCache(cacheFile) {
  if (!cacheFile) return { schemaVersion:1, entries:{} };
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cache');
    return { schemaVersion:1, entries:parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {} };
  } catch (_) {
    return { schemaVersion:1, entries:{} };
  }
}

function saveCache(cacheFile, cache) {
  if (!cacheFile) return;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive:true });
    const tmp = cacheFile + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, cacheFile);
  } catch (_) { /* cache must never break the UI */ }
}

async function fetchWithTimeout(fetchFn, url, accept, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, { headers:{ Accept:accept }, signal:controller.signal });
    if (!response || !response.ok) throw new Error('holiday source ' + (response ? response.status : 'unavailable'));
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function createHolidayService(options = {}) {
  const fetchFn = options.fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('Holiday service requires fetch.');
  const cacheFile = String(options.cacheFile || '');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const memory = new Map();
  const inFlight = new Map();

  async function fromNager(countryCode, year) {
    const code = normalizeCountryCode(countryCode);
    const y = normalizeYear(year);
    const v4 = NAGER_V4 + '/' + encodeURIComponent(code) + '/' + y;
    const v3 = NAGER_V3 + '/' + y + '/' + encodeURIComponent(code);
    for (const pair of [['nager-v4', v4], ['nager-v3', v3]]) {
      const provider = pair[0], url = pair[1];
      try {
        const response = await fetchWithTimeout(fetchFn, url, 'application/json');
        const json = await response.json();
        const rows = normalizeRows(json);
        if (rows.length) return { rows, source:provider, sourceUrl:url };
      } catch (_) {}
    }
    return null;
  }

  async function fromOfficeIcs(countryCode, year) {
    const code = normalizeCountryCode(countryCode);
    const slug = OFFICE_SLUGS[code];
    if (!slug) return null;
    const url = OFFICE_ICS_BASE + '/' + slug;
    try {
      const response = await fetchWithTimeout(fetchFn, url, 'text/calendar,text/plain;q=0.9,*/*;q=0.1');
      const rows = parseIcs(await response.text(), year);
      return rows.length ? { rows, source:'officeholidays-ics', sourceUrl:url } : null;
    } catch (_) {
      return null;
    }
  }

  function fromVerifiedCatalog(countryCode, year) {
    const rows = verifiedCatalogRows(countryCode, year);
    if (!rows.length) return null;
    return {
      rows,
      source:'verified-catalog',
      sourceUrl:normalizeCountryCode(countryCode) === 'IN' ? INDIA_OFFICIAL_CALENDAR : '',
      verifiedAt:'2026-10-01',
    };
  }

  function fromPersistentCache(countryCode, year) {
    const key = normalizeCountryCode(countryCode) + '|' + normalizeYear(year);
    const cached = loadCache(cacheFile).entries[key];
    if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) return null;
    return {
      rows:normalizeRows(cached.rows),
      source:String(cached.source || 'last-known-good-cache'),
      sourceUrl:String(cached.sourceUrl || ''),
      fetchedAt:String(cached.fetchedAt || ''),
      verifiedAt:cached.verifiedAt || null,
      stale:true,
      cacheFallback:true,
    };
  }

  function persist(countryCode, year, result) {
    const key = normalizeCountryCode(countryCode) + '|' + normalizeYear(year);
    const cache = loadCache(cacheFile);
    cache.entries[key] = {
      rows:normalizeRows(result.rows),
      source:result.source,
      sourceUrl:result.sourceUrl || '',
      fetchedAt:result.fetchedAt || new Date(now()).toISOString(),
      verifiedAt:result.verifiedAt || null,
    };
    saveCache(cacheFile, cache);
  }

  async function resolveYear(countryCode, year) {
    const code = normalizeCountryCode(countryCode);
    const y = normalizeYear(year);
    if (!code || !y) {
      const error = new Error('Invalid holiday country/year.');
      error.code = 'HOLIDAY_INPUT_INVALID';
      throw error;
    }

    let result = await fromNager(code, y);
    if (!result) result = fromVerifiedCatalog(code, y);
    if (!result) result = await fromOfficeIcs(code, y);

    if (result && result.rows.length) {
      result = {
        ok:true,
        countryCode:code,
        year:y,
        rows:normalizeRows(result.rows),
        source:result.source,
        sourceUrl:result.sourceUrl || '',
        fetchedAt:new Date(now()).toISOString(),
        verifiedAt:result.verifiedAt || null,
        stale:false,
      };
      persist(code, y, result);
      return result;
    }

    const cached = fromPersistentCache(code, y);
    if (cached) return Object.assign({ ok:true, countryCode:code, year:y }, cached);

    return {
      ok:true,
      countryCode:code,
      year:y,
      rows:[],
      source:'unavailable',
      sourceUrl:'',
      fetchedAt:new Date(now()).toISOString(),
      verifiedAt:null,
      stale:true,
      warning:'No holiday provider returned data for this country/year.',
    };
  }

  async function getYear(input = {}) {
    const code = normalizeCountryCode(input.countryCode);
    const y = normalizeYear(input.year);
    const key = code + '|' + y;
    const hit = memory.get(key);
    if (hit && now() - hit.at < MEMORY_TTL_MS) return hit.value;
    if (inFlight.has(key)) return inFlight.get(key);
    const request = resolveYear(code, y)
      .then(value => {
        memory.set(key, { at:now(), value });
        return value;
      })
      .finally(()=>inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  }

  return { getYear, resolveYear, fromNager, fromOfficeIcs, fromVerifiedCatalog, fromPersistentCache };
}

module.exports = {
  NAGER_V4,
  NAGER_V3,
  OFFICE_ICS_BASE,
  INDIA_OFFICIAL_CALENDAR,
  OFFICE_SLUGS,
  VERIFIED_CATALOG,
  normalizeCountryCode,
  normalizeYear,
  normalizeRows,
  verifiedCatalogRows,
  unfoldIcs,
  parseIcs,
  createHolidayService,
};
