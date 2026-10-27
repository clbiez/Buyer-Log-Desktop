#!/usr/bin/env python3
"""Reconcile real drawer DOM totals with the existing independent financial checks.
Do not call a different observed source version a mathematical error.
"""
import decimal,json,pathlib,re,sys
root=pathlib.Path(sys.argv[1]);out=[]
for line in (root/'operations.jsonl').open():
 e=json.loads(line)
 if e['type']!='calculation-evidence':continue
 record={k:e.get(k) for k in ['at','user','rowId']}
 if not e.get('displayedWaterfall') or not e.get('displayedLineage'):
  out.append({**record,'status':'not-measured'});continue
 facts={x['label'].strip().casefold():x.get('value') for x in e['displayedLineage'] if x.get('label')}
 def fact(tr,en):return facts.get(tr.casefold(),facts.get(en.casefold()))
 versions={'pricing':fact('Fiyat kuralı sürümü','Pricing rules revision'),'fx':fact('Kur kaynak sürümü','FX source revision'),'row':fact('Satır sürümü','Row revision')}
 expected_versions={'pricing':e['lineage']['revisions'].get('pricingRules'),'fx':e['lineage']['fx'].get('revision'),'row':e['lineage']['revisions'].get('row')}
 if any(v is None for v in versions.values()):
  out.append({**record,'status':'source-label-not-found','displayedVersions':versions,'facts':facts});continue
 if any(str(versions[k])!=str(expected_versions[k]) for k in versions):
  out.append({**record,'status':'different-observed-source-version','displayedVersions':versions,'sampledVersions':expected_versions});continue
 checks={c['name']:c for c in e['independentChecks']};values=[]
 for index,name in enumerate(['overseas-landed','tr-landed']):
  shown=e['displayedWaterfall'][index].get('total');check=checks.get(name)
  if shown is None or not check:values.append({'name':name,'status':'not-comparable','shown':shown});continue
  raw=re.sub(r'[^\d,.\-]','',shown)
  raw=raw.replace(',','') if e.get('displayLanguage')=='en' else raw.replace('.','').replace(',','.')
  try:
   actual=decimal.Decimal(raw);expected=decimal.Decimal(str(check['expected'])).quantize(decimal.Decimal('.01'),rounding=decimal.ROUND_HALF_UP)
   values.append({'name':name,'actual':str(actual),'expected':str(expected),'ok':actual==expected})
  except decimal.InvalidOperation:values.append({'name':name,'status':'invalid-displayed-number','shown':shown})
 out.append({**record,'status':'passed' if len(values)==2 and all(v.get('ok') for v in values) else 'display-mismatch-or-unmeasured','displayedVersions':versions,'checks':values})
counts={key:sum(x['status']==key for x in out) for key in sorted({x['status'] for x in out})}
result={'root':str(root),'counts':counts,'samples':out,'scope':'Exact real DOM totals; same row/rule/FX revisions required for comparison. No global collection snapshot policy imposed. Historical unknown versions are not guessed.'}
(root/'visible-calculation-reconciliation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(counts))
