/* Buyer Log v3.20 — OOXML validation, formatting, freeze-pane and sheet-protection helpers shared by browser and Node. */
(function attachBuyerLogExcelWorkbookGuards(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelWorkbookGuards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBuyerLogExcelWorkbookGuards() {
  'use strict';

  function xmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cleanValues(values) {
    const seen = new Set();
    const out = [];
    for (const value of Array.isArray(values) ? values : []) {
      const text = String(value == null ? '' : value).trim();
      if (!text || seen.has(text)) continue;
      seen.add(text); out.push(text);
    }
    return out;
  }

  function listFormula(values) {
    const list = cleanValues(values);
    if (!list.length) throw new Error('Excel list validation requires at least one option.');
    const formula = `"${list.join(',').replace(/"/g, '""')}"`;
    if (formula.length > 255) throw new Error('Excel inline validation list exceeds the 255 character limit.');
    return formula;
  }

  function validationXml(spec) {
    if (!spec || !String(spec.sqref || '').trim()) throw new Error('Excel validation range is required.');
    const attrs = [
      'type="list"',
      `allowBlank="${spec.allowBlank === false ? '0' : '1'}"`,
      'showInputMessage="1"',
      'showErrorMessage="1"',
      'errorStyle="stop"',
      `sqref="${xmlEscape(String(spec.sqref).trim())}"`,
    ];
    if (spec.promptTitle) attrs.push(`promptTitle="${xmlEscape(spec.promptTitle)}"`);
    if (spec.prompt) attrs.push(`prompt="${xmlEscape(spec.prompt)}"`);
    if (spec.errorTitle) attrs.push(`errorTitle="${xmlEscape(spec.errorTitle)}"`);
    if (spec.error) attrs.push(`error="${xmlEscape(spec.error)}"`);
    return `<dataValidation ${attrs.join(' ')}><formula1>${xmlEscape(listFormula(spec.values))}</formula1></dataValidation>`;
  }

  function insertWorksheetNode(source, node, preferredBefore) {
    const patterns = Array.isArray(preferredBefore) && preferredBefore.length ? preferredBefore : [
      'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup',
      'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors',
      'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
      'webPublishItems', 'tableParts', 'extLst',
    ];
    const insertion = new RegExp(`<(?:${patterns.join('|')})\\b`, 'i').exec(source);
    const index = insertion ? insertion.index : source.lastIndexOf('</worksheet>');
    if (index < 0) throw new Error('Worksheet closing tag was not found.');
    return source.slice(0, index) + node + source.slice(index);
  }

  function injectWorksheetListValidation(xml, spec) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<worksheet')) throw new Error('Invalid worksheet XML.');
    const node = validationXml(spec);
    const existing = source.match(/<dataValidations\b([^>]*)>([\s\S]*?)<\/dataValidations>/i);
    if (existing) {
      const childCount = (existing[2].match(/<dataValidation\b/g) || []).length + 1;
      let opening = `<dataValidations${existing[1]}>`;
      if (/\bcount="\d+"/i.test(opening)) opening = opening.replace(/\bcount="\d+"/i, `count="${childCount}"`);
      else opening = opening.replace(/>$/, ` count="${childCount}">`);
      const replacement = `${opening}${existing[2]}${node}</dataValidations>`;
      return source.slice(0, existing.index) + replacement + source.slice(existing.index + existing[0].length);
    }
    return insertWorksheetNode(source, `<dataValidations count="1">${node}</dataValidations>`, [
      'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
      'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing',
      'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
    ]);
  }

  function normalizeRgb(value, fallback) {
    const text = String(value == null ? '' : value).trim().replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{8}$/.test(text)) return text;
    if (/^[0-9A-F]{6}$/.test(text)) return `FF${text}`;
    return fallback || 'FF000000';
  }

  function dxfXml(style) {
    const item = style || {};
    const fontParts = [];
    if (item.bold) fontParts.push('<b/>');
    if (item.italic) fontParts.push('<i/>');
    if (item.fontColor) fontParts.push(`<color rgb="${normalizeRgb(item.fontColor, 'FF000000')}"/>`);
    const font = fontParts.length ? `<font>${fontParts.join('')}</font>` : '';
    const fillRgb = item.fillColor ? normalizeRgb(item.fillColor, 'FFFFFFFF') : '';
    // PivotTable styles can be rendered through either side of the pattern fill
    // by different Excel builds/themes. Write the same direct RGB value to both
    // fgColor and bgColor so the requested colour cannot fall back to black.
    const fill = fillRgb
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${fillRgb}"/><bgColor rgb="${fillRgb}"/></patternFill></fill>`
      : '';
    return `<dxf>${font}${fill}</dxf>`;
  }

  function injectStylesDxfs(xml, styles) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<styleSheet')) throw new Error('Invalid Excel styles XML.');
    const entries = (Array.isArray(styles) ? styles : []).map(dxfXml);
    if (!entries.length) return { xml: source, baseIndex: 0 };
    const existing = source.match(/<dxfs\b([^>]*)>([\s\S]*?)<\/dxfs>/i);
    if (existing) {
      const baseIndex = (existing[2].match(/<dxf\b/g) || []).length;
      let opening = `<dxfs${existing[1]}>`;
      const count = baseIndex + entries.length;
      if (/\bcount="\d+"/i.test(opening)) opening = opening.replace(/\bcount="\d+"/i, `count="${count}"`);
      else opening = opening.replace(/>$/, ` count="${count}">`);
      const replacement = `${opening}${existing[2]}${entries.join('')}</dxfs>`;
      return { xml: source.slice(0, existing.index) + replacement + source.slice(existing.index + existing[0].length), baseIndex };
    }
    const empty = source.match(/<dxfs\b([^>]*)\/>/i);
    if (empty) {
      const replacement = `<dxfs count="${entries.length}">${entries.join('')}</dxfs>`;
      return { xml: source.slice(0, empty.index) + replacement + source.slice(empty.index + empty[0].length), baseIndex: 0 };
    }
    const tableStyles = /<tableStyles\b/i.exec(source);
    const index = tableStyles ? tableStyles.index : source.lastIndexOf('</styleSheet>');
    if (index < 0) throw new Error('Styles closing tag was not found.');
    return {
      xml: source.slice(0, index) + `<dxfs count="${entries.length}">${entries.join('')}</dxfs>` + source.slice(index),
      baseIndex: 0,
    };
  }


  function pivotTableStyleXml(name, dxfIds) {
    const safeName = String(name || 'BuyerLogPivot').replace(/[^A-Za-z0-9_]/g, '') || 'BuyerLogPivot';
    const ids = dxfIds && typeof dxfIds === 'object'
      ? dxfIds
      : { wholeTable: Number(dxfIds) || 0, header: Number(dxfIds) || 0 };
    const wholeTableId = Number.isInteger(Number(ids.wholeTable)) ? Number(ids.wholeTable) : 0;
    const headerId = Number.isInteger(Number(ids.header)) ? Number(ids.header) : wholeTableId;

    // Define every valid PivotTable style region explicitly. Excel otherwise
    // may preserve parts of the application/theme default (frequently a black
    // medium-style header) when a new PivotTable is created in the workbook.
    const bodyTypes = [
      'wholeTable', 'firstColumn', 'firstRowStripe', 'secondRowStripe',
      'firstColumnStripe', 'secondColumnStripe', 'blankRow',
    ];
    const headerTypes = [
      'headerRow', 'totalRow', 'lastColumn', 'firstHeaderCell', 'lastHeaderCell',
      'firstTotalCell', 'lastTotalCell',
      'firstSubtotalColumn', 'secondSubtotalColumn', 'thirdSubtotalColumn',
      'firstSubtotalRow', 'secondSubtotalRow', 'thirdSubtotalRow',
      'firstColumnSubheading', 'secondColumnSubheading', 'thirdColumnSubheading',
      'firstRowSubheading', 'secondRowSubheading', 'thirdRowSubheading',
      'pageFieldLabels', 'pageFieldValues',
    ];
    const elements = [
      ...bodyTypes.map(type => [type, wholeTableId]),
      ...headerTypes.map(type => [type, headerId]),
    ];
    return `<tableStyle name="${xmlEscape(safeName)}" pivot="1" table="0" count="${elements.length}">${elements.map(([type,dxfId])=>`<tableStyleElement type="${type}" dxfId="${dxfId}"/>`).join('')}</tableStyle>`;
  }

  function injectDefaultPivotStyle(xml, spec) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<styleSheet')) throw new Error('Invalid Excel styles XML.');
    const item = spec || {};
    const name = String(item.name || 'BuyerLogPivot').replace(/[^A-Za-z0-9_]/g, '') || 'BuyerLogPivot';
    // A custom PivotTable style needs a complete whole-table definition to remain
    // deterministic in desktop Excel. Body and header fills both use direct RGB
    // values so no Office theme or application-level default can inject black.
    const injected = injectStylesDxfs(source, [
      {
        fillColor: item.bodyFillColor || 'FFFFFFFF',
        fontColor: item.bodyFontColor || 'FF101828',
      },
      {
        fillColor: item.fillColor || 'FFF2F4F7',
        fontColor: item.fontColor || 'FF475467',
        bold: item.bold !== false,
      },
    ]);
    let next = injected.xml;
    const custom = pivotTableStyleXml(name, {
      wholeTable: injected.baseIndex,
      header: injected.baseIndex + 1,
    });
    const existing = next.match(/<tableStyles\b([^>]*)>([\s\S]*?)<\/tableStyles>/i);
    const empty = next.match(/<tableStyles\b([^>]*)\/>/i);
    if (existing) {
      const body = existing[2].replace(new RegExp(`<tableStyle\\b[^>]*name="${name}"[\\s\\S]*?<\\/tableStyle>`, 'i'), '');
      const count = (body.match(/<tableStyle\b/gi) || []).length + 1;
      let opening = `<tableStyles${existing[1]}>`;
      opening = /\bcount="\d+"/i.test(opening) ? opening.replace(/\bcount="\d+"/i, `count="${count}"`) : opening.replace(/>$/, ` count="${count}">`);
      opening = /\bdefaultPivotStyle="[^"]*"/i.test(opening) ? opening.replace(/\bdefaultPivotStyle="[^"]*"/i, `defaultPivotStyle="${name}"`) : opening.replace(/>$/, ` defaultPivotStyle="${name}">`);
      const replacement = `${opening}${body}${custom}</tableStyles>`;
      next = next.slice(0, existing.index) + replacement + next.slice(existing.index + existing[0].length);
    } else if (empty) {
      let opening = `<tableStyles${empty[1]}>`;
      opening = /\bcount="\d+"/i.test(opening) ? opening.replace(/\bcount="\d+"/i, 'count="1"') : opening.replace(/>$/, ' count="1">');
      opening = /\bdefaultPivotStyle="[^"]*"/i.test(opening) ? opening.replace(/\bdefaultPivotStyle="[^"]*"/i, `defaultPivotStyle="${name}"`) : opening.replace(/>$/, ` defaultPivotStyle="${name}">`);
      const replacement = `${opening}${custom}</tableStyles>`;
      next = next.slice(0, empty.index) + replacement + next.slice(empty.index + empty[0].length);
    } else {
      const index = next.lastIndexOf('</styleSheet>');
      if (index < 0) throw new Error('Styles closing tag was not found.');
      next = next.slice(0, index) + `<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="${name}">${custom}</tableStyles>` + next.slice(index);
    }
    return next;
  }

  function worksheetFreezePaneXml(spec) {
    const item = spec || {};
    const rows = Math.max(0, Math.floor(Number(item.rows) || 0));
    const columns = Math.max(0, Math.floor(Number(item.columns) || 0));
    if (!rows && !columns) return '';
    function columnName(index) {
      let n = Math.max(0, Number(index) || 0) + 1;
      let out = '';
      while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
      return out || 'A';
    }
    const topLeftCell = String(item.topLeftCell || `${columnName(columns)}${rows + 1}`);
    const activePane = String(item.activePane || (rows && columns ? 'bottomRight' : rows ? 'bottomLeft' : 'topRight'));
    const paneAttrs = [];
    if (columns) paneAttrs.push(`xSplit="${columns}"`);
    if (rows) paneAttrs.push(`ySplit="${rows}"`);
    paneAttrs.push(`topLeftCell="${xmlEscape(topLeftCell)}"`, `activePane="${xmlEscape(activePane)}"`, 'state="frozen"');
    return `<pane ${paneAttrs.join(' ')}/><selection pane="${xmlEscape(activePane)}" activeCell="${xmlEscape(topLeftCell)}" sqref="${xmlEscape(topLeftCell)}"/>`;
  }

  function injectWorksheetFreezePane(xml, spec) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<worksheet')) throw new Error('Invalid worksheet XML.');
    const freezeXml = worksheetFreezePaneXml(spec);
    if (!freezeXml) return source;
    const sheetViews = source.match(/<sheetViews\b([^>]*)>([\s\S]*?)<\/sheetViews>/i);
    if (sheetViews) {
      let body = sheetViews[2];
      const pairedView = body.match(/<sheetView\b([^>]*)>([\s\S]*?)<\/sheetView>/i);
      const emptyView = body.match(/<sheetView\b([^>]*)\/>/i);
      if (pairedView) {
        const cleanBody = pairedView[2]
          .replace(/<pane\b[^>]*\/>|<pane\b[^>]*>[\s\S]*?<\/pane>/gi, '')
          .replace(/<selection\b[^>]*\/>|<selection\b[^>]*>[\s\S]*?<\/selection>/gi, '');
        const replacement = `<sheetView${pairedView[1]}>${freezeXml}${cleanBody}</sheetView>`;
        body = body.slice(0, pairedView.index) + replacement + body.slice(pairedView.index + pairedView[0].length);
      } else if (emptyView) {
        const replacement = `<sheetView${emptyView[1]}>${freezeXml}</sheetView>`;
        body = body.slice(0, emptyView.index) + replacement + body.slice(emptyView.index + emptyView[0].length);
      } else {
        body = `<sheetView workbookViewId="0">${freezeXml}</sheetView>${body}`;
      }
      const replacement = `<sheetViews${sheetViews[1]}>${body}</sheetViews>`;
      return source.slice(0, sheetViews.index) + replacement + source.slice(sheetViews.index + sheetViews[0].length);
    }
    const node = `<sheetViews><sheetView workbookViewId="0">${freezeXml}</sheetView></sheetViews>`;
    const dimension = /<dimension\b[^>]*\/>/i.exec(source);
    if (dimension) {
      const index = dimension.index + dimension[0].length;
      return source.slice(0, index) + node + source.slice(index);
    }
    const sheetPr = /<sheetPr\b[^>]*\/>|<sheetPr\b[^>]*>[\s\S]*?<\/sheetPr>/i.exec(source);
    if (sheetPr) {
      const index = sheetPr.index + sheetPr[0].length;
      return source.slice(0, index) + node + source.slice(index);
    }
    const worksheetOpen = /<worksheet\b[^>]*>/i.exec(source);
    if (!worksheetOpen) throw new Error('Worksheet opening tag was not found.');
    const index = worksheetOpen.index + worksheetOpen[0].length;
    return source.slice(0, index) + node + source.slice(index);
  }

  function conditionalFormattingXml(spec, baseDxfId) {
    if (!spec || !String(spec.sqref || '').trim()) throw new Error('Excel conditional-format range is required.');
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    if (!rules.length) throw new Error('Excel conditional formatting requires at least one rule.');
    const startPriority = Number(spec.priorityStart) > 0 ? Number(spec.priorityStart) : 1;
    const body = rules.map((rule, index) => {
      const formula = rule.formula != null ? String(rule.formula) : `"${String(rule.value == null ? '' : rule.value).replace(/"/g, '""')}"`;
      const dxfId = Number(baseDxfId) + index;
      const priority = startPriority + index;
      const stopIfTrue = rule.stopIfTrue === false ? '' : ' stopIfTrue="1"';
      // "expression" rules keep their logic INSIDE the workbook: Excel re-evaluates
      // them after every manual edit, so a highlight disappears as soon as the
      // underlying condition stops holding. "cellIs" stays the default for the
      // simple value comparisons the other exports use.
      if (rule.type === 'expression') {
        return `<cfRule type="expression" dxfId="${dxfId}" priority="${priority}"${stopIfTrue}><formula>${xmlEscape(formula)}</formula></cfRule>`;
      }
      const operator = rule.operator || 'equal';
      return `<cfRule type="cellIs" dxfId="${dxfId}" priority="${priority}" operator="${xmlEscape(operator)}"${stopIfTrue}><formula>${xmlEscape(formula)}</formula></cfRule>`;
    }).join('');
    return `<conditionalFormatting sqref="${xmlEscape(String(spec.sqref).trim())}">${body}</conditionalFormatting>`;
  }

  function injectWorksheetConditionalFormatting(xml, spec, baseDxfId) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<worksheet')) throw new Error('Invalid worksheet XML.');
    return insertWorksheetNode(source, conditionalFormattingXml(spec, baseDxfId), [
      'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter',
      'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags',
      'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls',
      'webPublishItems', 'tableParts', 'extLst',
    ]);
  }

  function columnIndex(label) {
    let out = 0;
    for (const ch of String(label || '').toUpperCase()) {
      if (ch < 'A' || ch > 'Z') return -1;
      out = out * 26 + ch.charCodeAt(0) - 64;
    }
    return out - 1;
  }

  function parseSqrefRanges(sqrefs) {
    const items = Array.isArray(sqrefs) ? sqrefs : [sqrefs];
    const ranges = [];
    for (const item of items) {
      for (const part of String(item == null ? '' : item).trim().split(/\s+/).filter(Boolean)) {
        const match = part.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i);
        if (!match) throw new Error(`Invalid Excel protection range: ${part}`);
        const c1 = columnIndex(match[1]), r1 = Number(match[2]) - 1;
        const c2 = columnIndex(match[3] || match[1]), r2 = Number(match[4] || match[2]) - 1;
        ranges.push({ c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) });
      }
    }
    return ranges;
  }

  function refInRanges(ref, ranges) {
    const match = String(ref || '').match(/^\$?([A-Z]+)\$?(\d+)$/i);
    if (!match) return false;
    const c = columnIndex(match[1]), r = Number(match[2]) - 1;
    return ranges.some(range => c >= range.c1 && c <= range.c2 && r >= range.r1 && r <= range.r2);
  }

  function worksheetStyleIdsForRanges(xml, sqrefs) {
    const source = String(xml == null ? '' : xml);
    const ranges = parseSqrefRanges(sqrefs);
    const ids = new Set();
    source.replace(/<c\b([^>]*)>/gi, (tag, attrs) => {
      const refMatch = attrs.match(/\br="([^"]+)"/i);
      if (!refMatch || !refInRanges(refMatch[1], ranges)) return tag;
      const styleMatch = attrs.match(/\bs="(\d+)"/i);
      ids.add(styleMatch ? Number(styleMatch[1]) : 0);
      return tag;
    });
    return ids;
  }

  function unlockedXfXml(xf) {
    const source = String(xf || '').trim();
    const selfClosing = source.match(/^<xf\b([^>]*)\/>$/i);
    if (selfClosing) {
      const attrs = selfClosing[1]
        .replace(/\sapplyProtection="[^"]*"/gi, '')
        .replace(/\s*$/, '');
      return `<xf${attrs} applyProtection="1"><protection locked="0" hidden="0"/></xf>`;
    }
    const paired = source.match(/^<xf\b([^>]*)>([\s\S]*?)<\/xf>$/i);
    if (!paired) throw new Error('Invalid Excel cell style definition.');
    const attrs = paired[1]
      .replace(/\sapplyProtection="[^"]*"/gi, '')
      .replace(/\s*$/, '');
    const body = paired[2].replace(/<protection\b[^>]*\/>|<protection\b[^>]*>[\s\S]*?<\/protection>/gi, '');
    return `<xf${attrs} applyProtection="1">${body}<protection locked="0" hidden="0"/></xf>`;
  }

  function injectUnlockedCellXfs(xml, styleIds) {
    const source = String(xml == null ? '' : xml);
    if (!source.includes('<styleSheet')) throw new Error('Invalid Excel styles XML.');
    const match = source.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/i);
    if (!match) throw new Error('Excel cellXfs collection was not found.');
    const xfs = match[2].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/gi) || [];
    if (!xfs.length) throw new Error('Excel cellXfs collection is empty.');
    const requested = [...new Set(Array.from(styleIds || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
    const mapping = new Map();
    const additions = [];
    for (const styleId of requested) {
      if (styleId < 0 || styleId >= xfs.length) throw new Error(`Excel style index is out of range: ${styleId}`);
      mapping.set(styleId, xfs.length + additions.length);
      additions.push(unlockedXfXml(xfs[styleId]));
    }
    if (!additions.length) return { xml: source, styleMap: mapping };
    let opening = `<cellXfs${match[1]}>`;
    const count = xfs.length + additions.length;
    if (/\bcount="\d+"/i.test(opening)) opening = opening.replace(/\bcount="\d+"/i, `count="${count}"`);
    else opening = opening.replace(/>$/, ` count="${count}">`);
    const replacement = `${opening}${match[2]}${additions.join('')}</cellXfs>`;
    return {
      xml: source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length),
      styleMap: mapping,
    };
  }

  function applyUnlockedStylesToWorksheet(xml, sqrefs, styleMap) {
    const source = String(xml == null ? '' : xml);
    const ranges = parseSqrefRanges(sqrefs);
    if (!ranges.length) return source;
    return source.replace(/<c\b([^>]*)>/gi, (tag, attrs) => {
      const refMatch = attrs.match(/\br="([^"]+)"/i);
      if (!refMatch || !refInRanges(refMatch[1], ranges)) return tag;
      const styleMatch = attrs.match(/\bs="(\d+)"/i);
      const oldStyle = styleMatch ? Number(styleMatch[1]) : 0;
      const nextStyle = styleMap && styleMap.get(oldStyle);
      if (!Number.isInteger(nextStyle)) throw new Error(`Unlocked Excel style was not prepared for style ${oldStyle}.`);
      if (styleMatch) return tag.replace(/\bs="\d+"/i, `s="${nextStyle}"`);
      return tag.replace(/^<c\b/i, `<c s="${nextStyle}"`);
    });
  }

  function normalizeWorksheetColumnAttributes(xml) {
    const source = String(xml == null ? '' : xml);
    return source.replace(/<col\b([^>]*)>/gi, (tag, attrs) => {
      // SheetJS writes both the standard outlineLevel attribute and a non-standard
      // duplicate level attribute. Excel tolerates it, but strict readers do not.
      const cleaned = attrs.replace(/\slevel="\d+"/gi, '');
      return `<col${cleaned}>`;
    });
  }

  function sheetProtectionXml(spec) {
    const item = spec || {};
    const attrs = [
      'sheet="1"', 'objects="1"', 'scenarios="1"',
      `formatCells="${item.allowFormatCells === true ? '0' : '1'}"`,
      `formatColumns="${item.allowFormatColumns === true ? '0' : '1'}"`,
      `formatRows="${item.allowFormatRows === true ? '0' : '1'}"`,
      'insertColumns="1"', 'insertRows="1"', 'insertHyperlinks="1"',
      'deleteColumns="1"', 'deleteRows="1"',
      'selectLockedCells="0"', 'selectUnlockedCells="0"',
      `sort="${item.allowSort === false ? '1' : '0'}"`,
      `autoFilter="${item.allowAutoFilter === false ? '1' : '0'}"`,
    ];
    return `<sheetProtection ${attrs.join(' ')}/>`;
  }

  function injectWorksheetProtection(xml, spec, styleMap) {
    let source = String(xml == null ? '' : xml);
    if (!source.includes('<worksheet')) throw new Error('Invalid worksheet XML.');
    source = source.replace(/<sheetProtection\b[^>]*\/>|<sheetProtection\b[^>]*>[\s\S]*?<\/sheetProtection>/gi, '');
    if (spec && spec.removeProtection === true) return source;
    source = applyUnlockedStylesToWorksheet(source, spec && spec.unlockedSqrefs, styleMap);
    return insertWorksheetNode(source, sheetProtectionXml(spec), [
      'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews',
      'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
      'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties',
      'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF',
      'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
    ]);
  }

  async function applyWorkbookGuards(data, config, JSZipCtor, outputType) {
    const Zip = JSZipCtor || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!Zip || typeof Zip.loadAsync !== 'function') throw new Error('JSZip is required to patch Excel workbooks.');
    const zip = await Zip.loadAsync(data);
    const settings = config || {};
    const validations = Array.isArray(settings.validations) ? settings.validations : [];
    const conditionalFormats = Array.isArray(settings.conditionalFormats) ? settings.conditionalFormats : [];
    const protections = Array.isArray(settings.protections) ? settings.protections : [];
    const freezePanes = Array.isArray(settings.freezePanes) ? settings.freezePanes : [];
    const pivotStyle = settings.pivotStyle && typeof settings.pivotStyle === 'object' ? settings.pivotStyle : null;
    const sheetXmlCache = new Map();

    async function readSheetXml(sheetPath) {
      const path = String(sheetPath || 'xl/worksheets/sheet1.xml');
      if (sheetXmlCache.has(path)) return sheetXmlCache.get(path);
      const entry = zip.file(path);
      if (!entry) throw new Error(`Worksheet XML not found: ${path}`);
      const xml = await entry.async('string');
      sheetXmlCache.set(path, xml);
      return xml;
    }

    const protectionStyleIds = new Set();
    for (const protection of protections) {
      if (protection && protection.removeProtection === true) continue;
      const xml = await readSheetXml(protection && protection.sheetPath);
      for (const styleId of worksheetStyleIdsForRanges(xml, protection && protection.unlockedSqrefs)) protectionStyleIds.add(styleId);
    }

    const dxfBaseByFormat = new Map();
    let unlockedStyleMap = new Map();
    if (conditionalFormats.length || protections.length || pivotStyle) {
      const stylesPath = 'xl/styles.xml';
      const stylesEntry = zip.file(stylesPath);
      if (!stylesEntry) throw new Error(`Excel styles XML not found: ${stylesPath}`);
      let stylesXml = await stylesEntry.async('string');
      for (const format of conditionalFormats) {
        const styles = (Array.isArray(format.rules) ? format.rules : []).map(rule => rule.style || {});
        const injected = injectStylesDxfs(stylesXml, styles);
        stylesXml = injected.xml;
        dxfBaseByFormat.set(format, injected.baseIndex);
      }
      if (protectionStyleIds.size) {
        const injected = injectUnlockedCellXfs(stylesXml, protectionStyleIds);
        stylesXml = injected.xml;
        unlockedStyleMap = injected.styleMap;
      }
      if (pivotStyle) stylesXml = injectDefaultPivotStyle(stylesXml, pivotStyle);
      zip.file(stylesPath, stylesXml);
    }

    const grouped = new Map();
    function add(sheetPath, kind, spec) {
      const path = String(sheetPath || 'xl/worksheets/sheet1.xml');
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push({ kind, spec });
    }
    validations.forEach(item => add(item && item.sheetPath, 'validation', item));
    conditionalFormats.forEach(item => add(item && item.sheetPath, 'conditional', item));
    protections.forEach(item => add(item && item.sheetPath, 'protection', item));
    freezePanes.forEach(item => add(item && item.sheetPath, 'freeze', item));

    for (const [sheetPath, operations] of grouped) {
      let xml = await readSheetXml(sheetPath);
      for (const operation of operations) {
        if (operation.kind === 'validation') xml = injectWorksheetListValidation(xml, operation.spec);
        else if (operation.kind === 'conditional') xml = injectWorksheetConditionalFormatting(xml, operation.spec, dxfBaseByFormat.get(operation.spec) || 0);
        else if (operation.kind === 'freeze') xml = injectWorksheetFreezePane(xml, operation.spec);
        else xml = injectWorksheetProtection(xml, operation.spec, unlockedStyleMap);
      }
      xml = normalizeWorksheetColumnAttributes(xml);
      zip.file(sheetPath, xml);
    }
    return zip.generateAsync({ type: outputType || 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  async function applySheetValidations(data, validations, JSZipCtor, outputType) {
    return applyWorkbookGuards(data, { validations }, JSZipCtor, outputType);
  }

  return Object.freeze({
    xmlEscape,
    cleanValues,
    listFormula,
    validationXml,
    injectWorksheetListValidation,
    normalizeRgb,
    dxfXml,
    injectStylesDxfs,
    pivotTableStyleXml,
    injectDefaultPivotStyle,
    worksheetFreezePaneXml,
    injectWorksheetFreezePane,
    conditionalFormattingXml,
    injectWorksheetConditionalFormatting,
    parseSqrefRanges,
    worksheetStyleIdsForRanges,
    injectUnlockedCellXfs,
    applyUnlockedStylesToWorksheet,
    normalizeWorksheetColumnAttributes,
    sheetProtectionXml,
    injectWorksheetProtection,
    applyWorkbookGuards,
    applySheetValidations,
  });
});
