'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('checklist evidence fields, lossless sync and supplier e-mail wiring are present', () => {
  const bridge = read('public/checklist-supplier-sync.js');
  const assistant = read('public/cp-overview-assistant.js');
  const rules = read('public/cp-rules-engine.js');
  const app = read('public/app-main.js');
  const routes = read('server/routes/checklist-supplier-routes.js');

  assert.match(rules, /evidenceFields\s*=\s*\{/);
  assert.match(assistant, /data-cpa-rule-evidence="reportNumber"/);
  assert.match(assistant, /data-cpa-rule-evidence="actualDate"/);
  assert.match(assistant, /data-cpa-rule-evidence="attachments"/);

  assert.match(bridge, /syncQueued/);
  assert.match(bridge, /syncRetryTimer/);
  assert.match(bridge, /sendBeacon\(API \+ '\/answers'/);
  assert.match(bridge, /data-cl-evidence/);
  assert.match(bridge, /data-checklist-supplier-prepare/);
  assert.match(bridge, /prepareSupplierChecklistEmail/);

  assert.match(bridge, /cpOrdersRowImageDataUrl/);
  assert.match(bridge, /editAs:\s*'twoCell'/);
  assert.match(bridge, /br:\s*\{/);

  assert.match(routes, /\/api\/checklist-supplier\/attachments/);
  assert.match(app, /MAIL_CHECKLIST_ID\s*=\s*'general-checklist'/);
  assert.match(app, /openChecklist:prepareEmailOpenChecklist/);
  assert.match(app, /Array\.isArray\(SRC\.initialFiles\)/);
  assert.match(app, /PRICING_ATTACHMENT_LIMIT_BYTES = Math\.floor\(9\.5 \* 1024 \* 1024\)/);
  assert.match(app, /pricingPrepareAttachmentPlans\(tableWorkbook,pricingFilesForManufacturer\(m\.name\),rowsFor\)/);
});

test('checklist attachment is renamed from order/model/checklist identity and evidence survives partial updates', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-checklist-evidence-'));
  try {
    const storePath = path.join(ROOT, 'server', 'lib', 'checklist-supplier-store.js');
    const script = [
      "const fs=require('fs');",
      "const store=require(" + JSON.stringify(storePath) + ");",
      "const actor={id:'buyer-1',displayName:'Buyer One'};",
      "const attachment=store.addAttachment({filename:'lab report.PDF',mimeType:'application/pdf',base64:Buffer.from('REPORT').toString('base64'),context:{orderCode:'1356389',plmId:'9001',modelName:'KB.BOY.STUMBLE-2-YD',colourCode:'001',checklistName:'Fabric Test',checklistStatus:'Reddedildi',sequence:1}},actor);",
      "const first=store.applyEntries([{orderKey:'O1',itemId:'fabric',state:'rejected',at:'2026-10-03T10:00:00.000Z',reportNumber:'RPT-42',actualDate:'2026-10-03',attachments:[attachment]}],actor,{source:'buyer_log'});",
      "const second=store.applyEntries([{orderKey:'O1',itemId:'fabric',state:'approved',at:'2026-10-03T11:00:00.000Z'}],actor,{source:'buyer_log'});",
      "const answer=store.publicPayload().answers['O1::fabric'];",
      "process.stdout.write(JSON.stringify({attachment,first,second,answer,fileExists:fs.existsSync(store.getAttachmentPath(attachment.id))}));",
    ].join('');
    const raw = childProcess.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        BUYER_LOG_SERVER_DATA_ROOT: dataRoot,
        BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataRoot, 'local'),
      },
    });
    const result = JSON.parse(raw);
    assert.equal(result.first.updated, 1);
    assert.equal(result.second.updated, 1);
    assert.equal(result.fileExists, true);
    assert.match(result.attachment.filename, /^1356389 - 9001 - KB\.BOY\.STUMBLE-2-YD - 001 - Fabric Test - Reddedildi - \d{4}-\d{2}-\d{2}\.PDF$/);
    assert.equal(result.answer.reportNumber, 'RPT-42');
    assert.equal(result.answer.actualDate, '2026-10-03');
    assert.equal(result.answer.attachments.length, 1);
    assert.equal(result.answer.attachments[0].id, result.attachment.id);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('supplier checklist Excel v2 round-trips optional report/date/attachment metadata', () => {
  const bridge = read('public/checklist-supplier-sync.js');
  assert.match(bridge, /const SCHEMA_VERSION = 2/);
  assert.match(bridge, /checklistEvidence:\s*'reportNumber'/);
  assert.match(bridge, /checklistEvidence:\s*'actualDate'/);
  assert.match(bridge, /checklistEvidence:\s*'attachments'/);
  assert.match(bridge, /reportColumn/);
  assert.match(bridge, /actualDateColumn/);
  assert.match(bridge, /attachmentsColumn/);
  assert.match(bridge, /version < 1 \|\| version > SCHEMA_VERSION/);
});


test('supplier checklist mail groups selected rows per supplier, keeps each Excel direct and adds workbook guidance', () => {
  const bridge = read('public/checklist-supplier-sync.js');
  const app = read('public/app-main.js');

  assert.match(bridge, /const groupMap = new Map\(\), missingRows = \[\]/);
  assert.match(bridge, /supplierGroups = Array\.from\(groupMap\.values\(\)\)/);
  assert.match(bridge, /preselect: supplierNames/);
  assert.match(bridge, /manufacturer: supplier[\s\S]*directAttachment: true/);
  assert.doesNotMatch(bridge, /suppliers\.length !== 1/);

  assert.match(bridge, /function renderChecklistInstructions/);
  assert.match(bridge, /READ ME \/ NASIL DOLDURULUR/);
  assert.match(bridge, /workbook\.views = \[\{ activeTab: 0/);
  assert.match(bridge, /cell\.note = T\(/);

  assert.match(app, /manufacturer:String\(entry\?\.manufacturer\|\|''\)/);
  assert.match(app, /directAttachment:entry\?\.directAttachment===true/);
  assert.match(app, /pricingFilesForManufacturer=name=>/);
  assert.match(app, /pricingPrepareAttachmentPlans\(tableWorkbook,pricingFilesForManufacturer\(m\.name\),rowsFor\)/);
  assert.match(app, /if\(fixed\[i\]\.directAttachment\) continue/);
  assert.match(app, /entries\.filter\(x=>!x\.isImage&&!x\.isPdf&&!x\.directAttachment\)/);
  assert.match(app, /else if\(!item\.isImage&&!item\.directAttachment\)/);
});
