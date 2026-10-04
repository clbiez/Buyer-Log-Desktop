/* ===================================================================
   LCW AI — güvenli Markdown görüntüleyici (BLMarkdown)

   LCW AI cevapları Markdown, kod bloğu, JSON, tablo ve HTML içerebilir.
   GÜVENLİK: Kaynak metin HİÇBİR ZAMAN ham HTML olarak DOM'a verilmez. Her
   parça önce kaçışlanır (escape), ardından yalnız bilinen Markdown kalıpları
   sabit etiketlere çevrilir. <script>, olay öznitelikleri, javascript: /
   data: bağlantıları bu yüzden etkisizdir. Bağlantılar yalnız http(s) olur
   ve yeni sekmede, noopener ile açılır.

   Kod blokları dili ve "Kopyala" düğmesi için data-* taşır; HTML blokları
   ileride güvenli bir "Önizle" (sandbox iframe) eklenebilsin diye
   data-lcwai-previewable="html" ile işaretlenir — bugün önizleme yoktur.

   DOM'a dokunmaz: tarayıcıda window.BLMarkdown, testte module.exports.
   =================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLMarkdown = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  /* Satır içi biçimler. Girdi ZATEN kaçışlanmıştır; burada yalnız sabit
     etiketler eklenir. Kod parçaları önce yer tutucuya alınır ki içlerindeki
     * ve _ biçimlendirilmesin. */
  function inline(escaped) {
    const codes = [];
    let text = escaped.replace(/`([^`\n]+)`/g, (_, code) => { codes.push(code); return `\u0000${codes.length - 1}\u0000`; });
    text = text
      .replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)"'<>]{1,500})\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
  }

  const isTableSeparator = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

  function codeBlock(lang, body) {
    const language = String(lang || '').toLowerCase().replace(/[^a-z0-9+#-]/g, '').slice(0, 20);
    const previewable = language === 'html' || language === 'htm' || (!language && /^\s*<(!doctype|html|div|table|section|body)\b/i.test(body));
    return `<div class="lcwaiCode"${previewable ? ' data-lcwai-previewable="html"' : ''}><div class="lcwaiCodeHead"><span>${esc(language || (previewable ? 'html' : 'text'))}</span><button type="button" class="lcwaiCodeCopy" data-lcwai-code-copy>{{COPY}}</button></div><pre><code${language ? ` data-lang="${esc(language)}"` : ''}>${esc(body)}</code></pre></div>`;
  }

  /* Blok düzeyi: kod, başlık, tablo, liste, alıntı, ayraç, paragraf. */
  function render(source, options = {}) {
    const copyLabel = esc(options.copyLabel || 'Kopyala'); // i18n-ignore — çağıran TR/EN etiket verir
    const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let paragraph = [];
    const flush = () => { if (paragraph.length) { out.push(`<p>${inline(esc(paragraph.join('\n'))).replace(/\n/g, '<br>')}</p>`); paragraph = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = /^\s*(```|~~~)\s*([\w+#-]*)\s*$/.exec(line);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) body.push(lines[i++]);
        out.push(codeBlock(fence[2], body.join('\n')));
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { flush(); const level = Math.min(6, heading[1].length + 2); out.push(`<h${level}>${inline(esc(heading[2].trim()))}</h${level}>`); continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flush();
        const head = splitRow(line);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
        i--;
        out.push(`<div class="lcwaiTableWrap"><table><thead><tr>${head.map(cell => `<th>${inline(esc(cell))}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${head.map((_, index) => `<td>${inline(esc(row[index] || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      const listMatch = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
      if (listMatch) {
        flush();
        const ordered = /\d/.test(listMatch[1]);
        const items = [];
        while (i < lines.length) {
          const item = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]);
          if (!item || /\d/.test(item[1]) !== ordered) break;
          items.push(`<li>${inline(esc(item[2]))}</li>`);
          i++;
        }
        i--;
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        i--;
        out.push(`<blockquote>${inline(esc(quote.join('\n'))).replace(/\n/g, '<br>')}</blockquote>`);
        continue;
      }
      paragraph.push(line);
    }
    flush();
    return out.join('\n').replace(/\{\{COPY\}\}/g, copyLabel);
  }

  return { render, escapeHtml: esc };
});
