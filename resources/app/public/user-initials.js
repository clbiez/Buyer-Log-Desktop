/* Buyer Log — kullanıcı adından avatar baş harfleri (tarayıcı ve Node.js ortak).
   Türkçe, İngilizce, Japonca ve Çince adlar desteklenir:
   - Latin/Türkçe: ilk iki kelimenin ilk harfi ("Gökberk Çelebi" → "GÇ", "ilker yılmaz" → "İY").
     Türkçe büyük harf kuralı (i → İ) yalnız adda Türkçe harf varsa uygulanır; "ian smith" → "IS".
   - Japonca/Çince (Han, Hiragana, Katakana; Hangul da): boşluklar yok sayılır, ilk iki karakter
     ("山田太郎" → "山田", "王 小明" → "王小"). Vekil çiftli (ek düzlem) karakterler bölünmez. */
(function attachBuyerLogUserInitials(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLUserInitials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuyerLogUserInitials() {
  'use strict';

  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const TURKISH = /[çğıöşüÇĞİÖŞÜ]/u;
  const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
  const SEPARATORS = /[\s　·・._\-]+/u;
  const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  // Birleşik karakterleri (ör. aksanlı harf, emoji) tek parça tutar.
  function graphemes(text) {
    return segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);
  }

  function initials(name) {
    const text = String(name == null ? '' : name).normalize('NFC').trim();
    if (!text) return '?';
    const words = text.split(SEPARATORS).filter(Boolean);
    if (CJK.test(text)) {
      const chars = graphemes(words.join('')).filter(ch => LETTER_OR_DIGIT.test(ch));
      return chars.slice(0, 2).join('') || '?';
    }
    const turkish = TURKISH.test(text);
    const out = words.slice(0, 2)
      .map(word => graphemes(word).find(ch => LETTER_OR_DIGIT.test(ch)) || '')
      .filter(Boolean)
      .map(ch => (turkish ? ch.toLocaleUpperCase('tr-TR') : ch.toUpperCase()))
      .join('');
    return out || '?';
  }

  return Object.freeze({ initials });
});
