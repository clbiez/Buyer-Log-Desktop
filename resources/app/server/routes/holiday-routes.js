'use strict';

module.exports = function registerHolidayRoutes(app, deps) {
  const {
    holidayService,
    userAccess,
  } = deps;

app.get('/api/world-clock-holidays', userAccess.requireAnyArea('overview'), async (req, res) => {
    try {
      const countryCode = String(req.query.country || '').trim().toUpperCase();
      const year = Number(req.query.year);
      const result = await holidayService.getYear({ countryCode, year });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      const invalid = error && error.code === 'HOLIDAY_INPUT_INVALID';
      res.status(invalid ? 400 : 502).set('Cache-Control', 'no-store').json({
        ok:false,
        error:invalid ? 'Geçersiz ülke/yıl.' : 'Resmi tatil verisi alınamadı.',
        code:error && error.code ? error.code : 'HOLIDAY_PROVIDER_FAILED',
      });
    }
  });
};
