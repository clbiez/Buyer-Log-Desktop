'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseIcs,
  verifiedCatalogRows,
  createHolidayService,
} = require('../server/lib/holiday-service');
const { islamicHolidayRows, mergeIslamicHolidays } = require('../server/lib/islamic-holidays');

function jsonResponse(payload, status = 200) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async json(){ return payload; },
    async text(){ return JSON.stringify(payload); },
  };
}

function textResponse(payload, status = 200) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async json(){ return JSON.parse(payload); },
    async text(){ return payload; },
  };
}

test('ICS parser yearly public holiday rows are normalized and deduplicated', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20280126',
    'SUMMARY:Republic Day',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20281108',
    'SUMMARY:Diwali\\, Deepavali',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20271108',
    'SUMMARY:Previous year',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.deepEqual(parseIcs(ics, 2028).map(row => [row.date,row.name]), [
    ['2028-01-26','Republic Day'],
    ['2028-11-08','Diwali, Deepavali'],
  ]);
});

test('India verified catalog remains an emergency official fallback for known years', () => {
  const rows = verifiedCatalogRows('IN', 2026);
  assert.equal(rows.length, 17);
  assert.ok(rows.some(row => row.date === '2026-11-08' && /Diwali/.test(row.name)));
});

test('provider chain prefers live Nager data when available', async () => {
  const seen = [];
  const service = createHolidayService({
    fetchFn:async url => {
      seen.push(url);
      if (url.includes('/api/v4/Holidays/TR/2028')) {
        return jsonResponse([{date:'2028-10-29',name:'Republic Day',nationalHoliday:true,holidayTypes:['Public']}]);
      }
      throw new Error('unexpected provider');
    },
    now:()=>Date.UTC(2028,0,1),
  });
  const result = await service.getYear({countryCode:'TR',year:2028});
  assert.equal(result.source, 'nager-v4');
  assert.equal(result.stale, false);
  assert.deepEqual(result.rows.filter(row=>!row.estimated).map(row=>row.date), ['2028-10-29']);
  assert.equal(seen.length, 1);
});

test('India 2026 uses verified catalog when live APIs do not cover it', async () => {
  const seen = [];
  const service = createHolidayService({
    fetchFn:async url => {
      seen.push(url);
      if (url.includes('nagerholidays.com')) return jsonResponse([]);
      if (url.includes('officeholidays.com')) {
        return textResponse('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260101\r\nSUMMARY:Wrong fallback\r\nEND:VEVENT\r\nEND:VCALENDAR');
      }
      throw new Error('unexpected');
    },
    now:()=>Date.UTC(2026,9,1),
  });
  const result = await service.getYear({countryCode:'IN',year:2026});
  assert.equal(result.source, 'verified-catalog');
  assert.equal(result.rows.length, 17);
  assert.ok(!seen.some(url=>url.includes('officeholidays.com')), 'verified catalog should stop weaker fallback');
});

test('unsupported live API countries continue with a live ICS provider for future years', async () => {
  const seen = [];
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20280126',
    'SUMMARY:Republic Day',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20280815',
    'SUMMARY:Independence Day',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const service = createHolidayService({
    fetchFn:async url => {
      seen.push(url);
      if (url.includes('nagerholidays.com')) return jsonResponse([]);
      if (url === 'https://www.officeholidays.com/ics-clean/india') return textResponse(ics);
      throw new Error('unexpected');
    },
    now:()=>Date.UTC(2028,0,1),
  });
  const result = await service.getYear({countryCode:'IN',year:2028});
  assert.equal(result.source, 'officeholidays-ics');
  assert.equal(result.stale, false);
  assert.deepEqual(result.rows.filter(row=>!row.estimated).map(row=>row.date), ['2028-01-26','2028-08-15']);
  assert.ok(seen.some(url=>url.includes('/ics-clean/india')));
});

test('last-known-good cache prevents holidays disappearing during provider outages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-holidays-'));
  const cacheFile = path.join(root, 'world-clock.json');
  try {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20280126\r\nSUMMARY:Republic Day\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const online = createHolidayService({
      cacheFile,
      fetchFn:async url => url.includes('nagerholidays.com') ? jsonResponse([]) : textResponse(ics),
      now:()=>Date.UTC(2028,0,1),
    });
    const first = await online.getYear({countryCode:'IN',year:2028});
    assert.equal(first.source, 'officeholidays-ics');
    assert.equal(fs.existsSync(cacheFile), true);

    const offline = createHolidayService({
      cacheFile,
      fetchFn:async () => { throw new Error('offline'); },
      now:()=>Date.UTC(2028,0,2),
    });
    const second = await offline.getYear({countryCode:'IN',year:2028});
    assert.equal(second.source, 'officeholidays-ics');
    assert.equal(second.stale, true);
    assert.equal(second.cacheFallback, true);
    assert.equal(second.rows[0].date, '2028-01-26');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Bangladesh gets lunar Eid holidays when the live provider omits them', async () => {
  // Nager BD verisi Ramazan/Kurban Bayramını içermiyordu; dünya saatinde görünmüyordu.
  const service = createHolidayService({
    fetchFn:async url => {
      if (url.includes('/api/v4/Holidays/BD/2027')) {
        return jsonResponse([
          {date:'2027-02-21',name:'International Mother Language Day',nationalHoliday:true,holidayTypes:['Public']},
          {date:'2027-03-26',name:'Independence and National Day',nationalHoliday:true,holidayTypes:['Public']},
        ]);
      }
      throw new Error('unexpected provider');
    },
    now:()=>Date.UTC(2026,9,8),
  });
  const result = await service.getYear({countryCode:'BD',year:2027});
  assert.equal(result.source, 'nager-v4');
  const eid = result.rows.filter(row=>row.estimated).map(row=>[row.date,row.holidayKey]);
  assert.deepEqual(eid.filter(([,key])=>/^eid/.test(key)), [
    ['2027-03-10','eid_al_fitr'],
    ['2027-05-17','eid_al_adha'],
  ]);
  assert.ok(result.rows.some(row=>row.name === 'International Mother Language Day'));
});

test('lunar holidays already listed by the provider are not duplicated', () => {
  const india = verifiedCatalogRows('IN', 2026);
  assert.equal(mergeIslamicHolidays(india, 'IN', 2026).length, india.length);
  const turkey = [
    {date:'2027-03-09',name:'Ramazan Bayramı'},
    {date:'2027-05-16',name:'Kurban Bayramı'},
  ];
  assert.equal(mergeIslamicHolidays(turkey, 'TR', 2027).length, 2);
  assert.deepEqual(islamicHolidayRows('TR', 2027).map(row=>row.date), ['2027-03-09','2027-05-16']);
  assert.deepEqual(islamicHolidayRows('DE', 2027), []);
});
