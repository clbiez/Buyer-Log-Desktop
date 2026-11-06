'use strict';
/* Test fikstürü: LCW benzeri 4-4-5 Merch Calendar (pazartesi başlayan hafta).
   Gerçek LCW takvimi DEĞİLDİR; yalnız LCW dönemlerinin miladi takvimden
   ayrıştığı durumları deterministik sınamak içindir. 2026 LCW yılı
   2025-12-29'da, 2027 LCW yılı 2026-12-28'de başlar. */
const PATTERN = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];
function iso(date) { return date.toISOString().slice(0, 10); }
function build(years = { 2026: '2025-12-29', 2027: '2026-12-28' }) {
  const weeks = [];
  for (const [year, first] of Object.entries(years)) {
    const start = new Date(`${first}T00:00:00Z`);
    let week = 1;
    PATTERN.forEach((count, index) => {
      for (let i = 1; i <= count; i++) {
        const from = new Date(start.getTime() + (week - 1) * 7 * 86400000);
        const to = new Date(from.getTime() + 6 * 86400000);
        weeks.push({ year: Number(year), week, month: index + 1, monthWeek: i, start: iso(from), end: iso(to) });
        week++;
      }
    });
  }
  return { weeks, sourceName: 'test-fixture.xlsx' };
}
module.exports = { build, PATTERN };
