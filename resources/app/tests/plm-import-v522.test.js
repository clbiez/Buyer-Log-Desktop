'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const shared=require('../public/collection-model-groups');
const DB=fs.readFileSync(path.join(ROOT,'server','db.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');

function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}

test('Collection PLM Excel parser input and change handler remain available without a duplicate toolbar button',()=>{
  assert.match(INDEX,/id="kolPlmImportFile"[^>]*accept="\.xlsx"/);
  assert.match(APP,/kolPlmImportFile[^\n]*addEventListener\('change'/);
  assert.doesNotMatch(INDEX,/id="kolPlmImportBtn"/);
});

test('PLM direct mappings use confirmed PLM→ASAS rules even when the style is absent from ASAS',()=>{
  const block=between(APP,'const KOL_PLM_TRANSLATION_RULES','function kolPlmExtractEmbeddedImages');
  assert.match(block,/license:Object\.freeze\(\{\}\)/);
  assert.match(block,/2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE[^\n]+KEY ORME BODY K\.KOL-LİSANS/);
  assert.match(block,/2642 - KEY JERSEY SET-LICENSE[^\n]+KEY ORME TAKIM-LİSANS/);
  assert.match(block,/2634 - KEY ORME PANTOLON-LICENSE[^\n]+KEY ORME PANTOLON-LİSANS/);
  assert.match(block,/2637 - KEY JERSEY SWEATSHIRT-LICENSE[^\n]+KEY ORME SWEAT-LİSANS/);
  assert.match(block,/2638 - KEY JERSEY BODY LONG SLEEVED-LICENSE[^\n]+KEY ORME BODY U\.KOL-LİSANS/);
  assert.match(block,/line:Object\.freeze\(\{\}\)/);
  assert.match(block,/Merchant Sub Group/);
  assert.match(block,/Main Fabric Information/);
  assert.match(block,/Label Fit Name/);
  assert.match(block,/function kolPlmSeason/);
  assert.match(block,/function kolPlmInferTranslationSuggestions/);
  assert.match(block,/function kolPlmApplyAsasTranslations/);
  assert.match(block,/function kolPlmAsasModelIndex/);
  assert.match(block,/const approvedTarget=kolPlmTranslate\(field,source\)/);
  assert.match(block,/mode='approved-rule'/);
});

test('PLM embedded pictures are read from xlsx drawing anchors with JSZip',()=>{
  const block=between(APP,'async function kolPlmExtractEmbeddedImages','function kolPlmParseWorkbook');
  assert.match(block,/ensureLibrary\('jszip'\)/);
  assert.match(block,/xl\\\/drawings\\\/drawing/);
  assert.match(block,/oneCellAnchor/);
  assert.match(block,/twoCellAnchor/);
  assert.match(block,/data:\$\{mime\};base64/);
});

test('PLM import treats an existing PLM ID as an existing model and never creates a second copy',()=>{
  const block=shared.kolBuildPlmImportPlan.toString();
  assert.match(block,/byPlm=new Map/);
  assert.match(block,/const existing=\[\],creates=\[\],ambiguous=\[\],inputDuplicates=\[\]/);
  assert.match(block,/if\(plmTargets\.length===1\)/);
  assert.match(block,/const only=plmTargets\[0\]/);
  assert.match(block,/PLM mevcutsa ASLA yeni kopya üretme/);
  assert.match(block,/seenInputPlm/);
});

test('PLM images are linked globally through PLM ID + Colour Code + Colour Name without fanning one colour across variants',()=>{
  assert.match(DB,/function patchPlmImageLinks/);
  assert.match(DB,/plmImageKey\(plmId\)/);
  assert.match(DB,/plmColourImageNameKey\(plmId, colourCode, colour\)/);
  assert.match(SERVER,/app\.post\('\/api\/plm-image-links'/);
  const block=between(APP,'async function kolPlmLinkImageEverywhere','async function kolPlmPersistImportedImage');
  assert.match(block,/const items=\[\{plmId,colourCode,colour,imageRef:/);
  assert.doesNotMatch(block,/kolPlmKnownColourCodes/);
  assert.match(block,/\/api\/plm-image-links/);
  assert.match(block,/cpImageRefFromOverride/);
  assert.match(block,/resolvedUrl=`\/api\/cp-images\/\$\{encodeURIComponent\(ref\)\}`/);
  assert.doesNotMatch(block,/target\._imageUrl=url/);
});

test('PLM import preview shows ASAS translations as active while conflicts stay unresolved',()=>{
  const block=between(APP,'function showKolPlmImportPreview','function kolPlmKnownColourCodes');
  assert.match(block,/ASAS-compatible translations used for import/);
  assert.match(block,/Conflict · not applied/);
  assert.match(block,/Import PLM \+ ASAS translations \+ images/);
});
