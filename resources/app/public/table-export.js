(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLTableExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     TABLO DIŞA AKTARIM SERIALIZER'I

     Bulunan kusur: Koleksiyon'dan kopyalanan bir model Excel'de ÜÇ satıra
     yayılıyor ve komşu sütunlar dikey olarak birleşiyordu (5:7, 8:10, 11:13).

     Sebep, "üç satırlı bir tablo" üretilmesi DEĞİLDİ — üretilen tablo hep tek
     satırlıydı. Sebep, tek bir HÜCRENİN içinde satır sonu bulunmasıydı:

       · Koleksiyon'un serbest metin sütunları <textarea>'dır; içine üç satırlı
         bir not yapıştırılabilir.
       · Kopyalama bu değeri DOM'dan (textarea.value) okuyup olduğu gibi
         panoya yazıyordu.
       · TSV tarafında ham \n Excel için YENİ SATIR demektir.
       · HTML tarafında Excel, mso-data-placement:same-cell yoksa hücre içi
         satır sonunu satıra böler ve diğer sütunları o satırlar boyunca
         DİKEY BİRLEŞTİRİR. Kullanıcının gördüğü 5:7 tam olarak budur.

     Yani üç satır ve merge, tek bir normalize edilmemiş hücrenin sonucudur.

     Bu modül o normalizasyonun tek yeridir. Kural:

         1 kayıt = 1 dışa aktarım satırı = 1 Excel satırı

     Ekrandaki görsel satır yüksekliği, DOM'da kaç düğüm kullanıldığı ya da
     hücrenin bileşik çizilip çizilmediği bu kuralı DEĞİŞTİREMEZ. UI satırı
     hiçbir zaman doğrudan dışa aktarım satırı olarak kullanılmaz.
     =================================================================== */

  /* Excel'e giden hücrede satır sonu olamaz. Sekme de olamaz: TSV'de yeni
     SÜTUN demektir. Dikey sekme ve form feed'i de alıyoruz; Excel bunları da
     satır ayırıcı sayabiliyor. */
  const CELL_BREAK=/[\r\n\u000B\u000C\u0085\u2028\u2029\t]+/g;

  /* Excel'e "bu hücre içi satır sonu YENİ SATIR değildir" diyen tek şey budur.
     Her <td>'ye konur; tek bir eksik hücre bütün bloğu bölmeye yeter. */
  const SAME_CELL='mso-data-placement:same-cell;';

  function scalarText(value){
    if(value==null)return '';
    if(typeof value==='number'&&!Number.isFinite(value))return '';
    if(typeof value==='object')return '';
    const text=String(value);
    return /^(undefined|NaN|\[object Object\])$/.test(text.trim())?'':text;
  }

  function normalizeCell(value){
    return scalarText(value).replace(CELL_BREAK,' ').replace(/ {2,}/g,' ').trim();
  }

  /* TSV hücresi. Normalize edilmiş metinde ayırıcı kalmaz; yine de tırnak
     kaçışı yapılır ki metnin kendisindeki " Excel'i şaşırtmasın. */
  function tsvCell(value){
    const text=normalizeCell(value);
    return text.indexOf('"')>=0?'"'+text.replace(/"/g,'""')+'"':text;
  }

  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,ch=>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  /* Kayıtlardan düz bir matris üretir. Tek garanti burada verilir ve
     ihlal edilirse SESSİZCE geçilmez: bir modelin iki kez ya da hiç
     yazılmaması, Excel'de fark edilmesi en zor hatalardandır. */
  function buildMatrix(options){
    const records=Array.isArray(options&&options.records)?options.records:[];
    const columns=Array.isArray(options&&options.columns)?options.columns:[];
    const cellText=typeof options.cellText==='function'?options.cellText:(col,row)=>row&&row[col&&col.k];
    const columnLabel=typeof options.columnLabel==='function'
      ? options.columnLabel : col=>(col&&(col.label||col.k))||'';

    const headers=columns.map(col=>normalizeCell(columnLabel(col)));
    const rawRows=records.map((record,rowIndex)=>
      columns.map(col=>cellText(col,record,rowIndex)));
    const rows=rawRows.map(row=>row.map(normalizeCell));

    if(rows.length!==records.length){
      throw new Error(`Dışa aktarım satır sayısı kayıt sayısıyla eşleşmiyor: ${rows.length} ≠ ${records.length}`);
    }
    return {headers,rows,rawRows,recordCount:records.length,columnCount:columns.length};
  }

  /* Sütunlar TAB, satırlar CRLF. Excel'in TSV okuyucusu CRLF bekler; tek \n
     bazı sürümlerde son sütunu bir sonraki satıra taşıyor. */
  function toTSV(matrix,options){
    const includeHeaders=!options||options.includeHeaders!==false;
    const lines=[];
    if(includeHeaders)lines.push(matrix.headers.map(tsvCell).join('\t'));
    for(const row of matrix.rows)lines.push(row.map(tsvCell).join('\t'));
    return lines.join('\r\n');
  }

  /* Kayıt başına TAM BİR <tr>, sütun başına TAM BİR <td>. rowspan yok,
     dikey birleştirme yok, yardımcı satır yok. */
  function toHTML(matrix,options){
    options=options||{};
    const border=options.border||'thin solid #B4B8BD';
    const headerStyle=options.headerStyle
      ||`background-color:#E3E5E8;color:#54595F;padding:4px 8px;text-align:left;border:${border};font-weight:bold;`;
    const cell=typeof options.cell==='function'?options.cell:()=>({});
    const includeHeaders=options.includeHeaders!==false;

    let html='<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;">';
    if(includeHeaders){
      html+='<tr>'+matrix.headers.map(label=>
        `<th style="${headerStyle}">${escapeHtml(label)}</th>`).join('')+'</tr>';
    }
    matrix.rows.forEach((row,rowIndex)=>{
      html+='<tr>';
      row.forEach((text,colIndex)=>{
        const extra=cell(colIndex,rowIndex,text)||{};
        // SAME_CELL her hücrede; stil geçersiz kılsa bile en sona eklenir.
        const style=`${extra.style||`padding:3px 8px;border:${border};`}${SAME_CELL}`;
        html+=`<td style="${style}">${extra.html||escapeHtml(text)}</td>`;
      });
      html+='</tr>';
    });
    return html+'</table>';
  }

  /* Word/e-posta için bilinçli olarak küçük bir clipboard HTML'i. Bu yol
     ekrandaki DOM'u değil matrix'in kayıt kaynaklı değerlerini kullanır;
     böylece uygulama CSS'i, etkileşimli kontrolleri ve görsel binary'leri
     clipboard'a sızmaz. */
  function toSafeHTML(matrix,options){
    options=options||{};
    const includeHeaders=options.includeHeaders!==false;
    const tableStyle='border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt;';
    const headerStyle='border:1px solid #B4B8BD;padding:4px 6px;text-align:left;vertical-align:top;background-color:#F2F4F7;color:#54595F;font-weight:bold;';
    const cellStyle='border:1px solid #B4B8BD;padding:3px 6px;text-align:left;vertical-align:top;mso-data-placement:same-cell;';
    const rawRows=Array.isArray(matrix?.rawRows)?matrix.rawRows:null;
    const htmlCell=value=>{
      const text=scalarText(value).replace(/\r\n?|[\u000B\u000C\u0085\u2028\u2029]/g,'\n').replace(/\t/g,' ');
      return text.split('\n').map(escapeHtml).join('<br>');
    };
    let html=`<table style="${tableStyle}">`;
    if(includeHeaders)html+='<thead><tr>'+matrix.headers.map(label=>`<th style="${headerStyle}">${escapeHtml(label)}</th>`).join('')+'</tr></thead>';
    html+='<tbody>';
    (matrix.rows||[]).forEach((row,rowIndex)=>{
      html+='<tr>';
      row.forEach((text,colIndex)=>{
        const raw=rawRows?.[rowIndex]?.[colIndex];
        html+=`<td style="${cellStyle}">${htmlCell(raw===undefined?text:raw)}</td>`;
      });
      html+='</tr>';
    });
    return html+'</tbody></table>';
  }

  /* Üretilen HTML'in düzlüğünü mekanik olarak doğrular. Testler için değil,
     ÇAĞRI YOLU için de kullanılabilsin diye burada: bir gün biri araya
     rowspan koyarsa sessizce geçmesin. */
  function assertFlat(html,expectedRows){
    const problems=[];
    if(/rowspan/i.test(html))problems.push('HTML rowspan içeriyor'); // i18n-ignore — geliştirici düzlük doğrulaması, UI metni değil
    if(/<br\b/i.test(html)&&html.indexOf(SAME_CELL)<0){
      problems.push('Çok satırlı hücre var ama mso-data-placement:same-cell yok'); // i18n-ignore — geliştirici düzlük doğrulaması, UI metni değil
    }
    const rowCount=(html.match(/<tr>/gi)||[]).length-(/<th\b/i.test(html)?1:0);
    if(expectedRows!=null&&rowCount!==expectedRows){
      problems.push(`Satır sayısı ${rowCount}, beklenen ${expectedRows}`);
    }
    return {ok:problems.length===0,problems,rowCount};
  }

  return {CELL_BREAK,SAME_CELL,normalizeCell,tsvCell,escapeHtml,buildMatrix,toTSV,toHTML,toSafeHTML,assertFlat};
});
