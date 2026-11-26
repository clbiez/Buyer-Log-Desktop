/* ===================================================================
   Presentation Studio — düzenlenebilir PowerPoint yazıcısı (istemci).

   Girdi BLPresentationRender.build() çizim listesidir; konum, boyut ve
   kısaltılmış metin satırları olduğu gibi yazılır (PowerPoint satır
   kırmaz: wrap="none", tam satır aralığı). Her kart ve grup başlığı ayrı
   bir şekil grubudur; PowerPoint'te tek parça taşınır, metni düzenlenir.
   Sayfa ölçüsü belgedeki ölçüdür (A3…özel). Paket JSZip ile yerelde
   üretilir; ağ veya sunucu gerekmez.
   =================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPresentationPptx = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const EMU = 12700;
  const e = v => Math.round(v * EMU);
  const hex = c => String(c || '#000000').replace('#', '').toUpperCase();
  const xml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

  function slideBuilder(font, lang) {
    let id = 1; const rels = [];
    const next = () => ++id;
    const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${Math.max(1, e(w))}" cy="${Math.max(1, e(h))}"/></a:xfrm>`;
    const run = r => `<a:r><a:rPr lang="${lang}" sz="${Math.round(r.size * 100)}"${r.bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${hex(r.color)}"/></a:solidFill><a:latin typeface="${xml(font)}"/><a:cs typeface="${xml(font)}"/></a:rPr><a:t>${xml(r.t)}</a:t></a:r>`;
    function rect(name, x, y, w, h, { fill = null, line = null, lineW = 0.6, shadow = false } = {}) {
      const sid = next();
      const fillXml = fill ? `<a:solidFill><a:srgbClr val="${hex(fill)}"/></a:solidFill>` : '<a:noFill/>';
      const lineXml = line ? `<a:ln w="${e(lineW)}"><a:solidFill><a:srgbClr val="${hex(line)}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>';
      const fx = shadow ? '<a:effectLst><a:outerShdw blurRad="50800" dist="12700" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="101828"><a:alpha val="18000"/></a:srgbClr></a:outerShdw></a:effectLst>' : '';
      return `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${xml(name)} ${sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillXml}${lineXml}${fx}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="${lang}" dirty="0"/></a:p></p:txBody></p:sp>`;
    }
    function textBox(name, x, y, w, lines, align = 'l') {
      const sid = next(), h = lines.reduce((s, l) => s + l.lh, 0);
      const paras = lines.map(l => `<a:p><a:pPr algn="${align}"><a:lnSpc><a:spcPts val="${Math.round(l.lh * 100)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buNone/></a:pPr>${l.runs.map(run).join('') || `<a:endParaRPr lang="${lang}" dirty="0"/>`}</a:p>`).join('');
      return `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="${xml(name)} ${sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
    }
    function picture(name, x, y, w, h, target, descr) {
      let rel = rels.find(r => r.target === target);
      if (!rel) { rel = { id: `rId${rels.length + 2}`, target }; rels.push(rel); }
      const sid = next();
      return `<p:pic><p:nvPicPr><p:cNvPr id="${sid}" name="${xml(name)} ${sid}" descr="${xml(descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel.id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    }
    function group(name, box, inner) {
      const sid = next(), x = xfrm(box.x, box.y, box.w, box.h).replace('</a:xfrm>', `<a:chOff x="${e(box.x)}" y="${e(box.y)}"/><a:chExt cx="${Math.max(1, e(box.w))}" cy="${Math.max(1, e(box.h))}"/></a:xfrm>`);
      return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${sid}" name="${xml(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${x}</p:grpSpPr>${inner}</p:grpSp>`;
    }
    return { rect, textBox, picture, group, rels };
  }

  /* images: src → { name, base64, ext } (yalnız JPEG/PNG). titles: kart kimliği → erişilebilir ad. */
  function slideXml(page, images, palette, lang, titles) {
    const b = slideBuilder(page.font, lang), shapes = [];
    for (const el of page.elements) {
      if (el.type === 'hdr') {
        const cw = el.count ? el.count.w + 4 : 0;
        const inner = (el.lines.length ? b.textBox('Group title', el.x, el.lines[0].y, Math.max(1, el.w - cw), el.lines.map(l => ({ lh: el.lh, runs: l.runs }))) : '')
          + (el.count ? b.textBox('Group count', el.x + el.w - cw, el.count.y, cw, [{ lh: el.count.size * 1.3, runs: [el.count] }], 'r') : '')
          + b.rect('Group rule', el.rule.x, el.rule.y, el.rule.w, el.rule.h, { fill: palette.rule });
        shapes.push(b.group('Group', { x: el.x, y: el.y, w: el.w, h: el.h }, inner));
        continue;
      }
      let inner = b.rect('Card', el.x, el.y, el.w, el.h, { fill: palette.card, shadow: el.style === 'shadow' });
      inner += b.rect('Image area', el.imageBox.x, el.imageBox.y, el.imageBox.w, el.imageBox.h, { fill: palette.image });
      const media = el.image && images.get(el.image.src);
      if (media) inner += b.picture('Picture', el.image.x, el.image.y, el.image.w, el.image.h, media.name, titles[el.id] || el.id);
      if (el.lines.length) inner += b.textBox('Card text', el.lines[0].x, el.lines[0].y, el.lines[0].w, el.lines);
      if (el.style === 'frame') inner += b.rect('Card frame', el.x + 0.3, el.y + 0.3, el.w - 0.6, el.h - 0.6, { line: palette.line, lineW: 0.6 });
      shapes.push(b.group(`Card ${titles[el.id] || el.id}`, { x: el.x, y: el.y, w: el.w, h: el.h }, inner));
    }
    const body = `${HEAD}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex(palette.paper)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    return { body, rels: b.rels };
  }
  function themeXml(font, p) {
    const c = v => `<a:srgbClr val="${hex(v)}"/>`;
    return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Buyer Log"><a:themeElements><a:clrScheme name="Buyer Log"><a:dk1>${c(p.ink)}</a:dk1><a:lt1>${c('#FFFFFF')}</a:lt1><a:dk2>${c(p.ink2)}</a:dk2><a:lt2>${c(p.image)}</a:lt2><a:accent1>${c('#3F6488')}</a:accent1><a:accent2>${c('#2C455D')}</a:accent2><a:accent3>${c('#177A4C')}</a:accent3><a:accent4>${c('#946200')}</a:accent4><a:accent5>${c('#B42318')}</a:accent5><a:accent6>${c(p.muted)}</a:accent6><a:hlink>${c('#2C455D')}</a:hlink><a:folHlink>${c(p.ink2)}</a:folHlink></a:clrScheme><a:fontScheme name="Buyer Log"><a:majorFont><a:latin typeface="${xml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${xml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Buyer Log"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  }
  const dataUrlParts = src => { const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/i.exec(String(src || '')); return m ? { ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpeg', base64: m[2] } : null; };

  /* list: render.build() çıktısı (görsel src'leri data URL). Döner: JSZip örneği. */
  function build(JSZip, list, { title = '', lang = 'tr', palette, titles = {}, date = new Date() } = {}) {
    const zip = new JSZip(), langTag = lang === 'en' ? 'en-US' : 'tr-TR', images = new Map();
    for (const page of list.pages) for (const el of page.elements) if (el.type === 'card' && el.image && !images.has(el.image.src)) {
      const part = dataUrlParts(el.image.src);
      if (!part) continue;
      const name = `image${images.size + 1}.${part.ext}`;
      images.set(el.image.src, { name, ...part });
      zip.file(`ppt/media/${name}`, part.base64, { base64: true });
    }
    const slides = list.pages.map(p => slideXml(p, images, palette, langTag, titles));
    const W = Math.min(51206400, Math.max(914400, e(list.w))), H = Math.min(51206400, Math.max(914400, e(list.h)));
    const created = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    zip.file('docProps/core.xml', `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Buyer Log</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`);
    zip.file('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Buyer Log</Application><Slides>${slides.length}</Slides></Properties>`);
    zip.file('ppt/presentation.xml', `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="${langTag}"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${slides.length + 2}" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId${slides.length + 3}" Type="${REL}/presProps" Target="presProps.xml"/><Relationship Id="rId${slides.length + 4}" Type="${REL}/viewProps" Target="viewProps.xml"/><Relationship Id="rId${slides.length + 5}" Type="${REL}/tableStyles" Target="tableStyles.xml"/></Relationships>`);
    zip.file('ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`);
    zip.file('ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
    zip.file('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
    zip.file('ppt/theme/theme1.xml', themeXml(list.font, palette));
    zip.file('ppt/slideMasters/slideMaster1.xml', `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`);
    zip.file('ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
    slides.forEach((s, i) => {
      zip.file(`ppt/slides/slide${i + 1}.xml`, s.body);
      zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${s.rels.map(r => `<Relationship Id="${r.id}" Type="${REL}/image" Target="../media/${r.target}"/>`).join('')}</Relationships>`);
    });
    return zip;
  }
  return { EMU, build, dataUrlParts };
});
