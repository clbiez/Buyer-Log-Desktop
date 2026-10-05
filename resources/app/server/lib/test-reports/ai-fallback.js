'use strict';
/* LCW AI yedeği — tanınmayan format, taranmış rapor ve serbest metin özeti
   için. LCW AI test raporu API sözleşmesi henüz gelmedi; arayüz soyut tutulur:
     extractWithAI({ name, buffer, kind }) → { ok, report, reason }
   `report` deterministik ayrıştırıcıyla AYNI şemadadır (test-report-engine
   emptyReport). Bağlandığında çıktı yine motorun doğrulayıcısından ve
   kullanıcı önizlemesinden geçer; eşleştirmeyi AI değil Buyer Log yapar. */

async function extractWithAI(file) {
  void file;
  return { ok: false, report: null, reason: 'not-configured' };
}

module.exports = { extractWithAI };
