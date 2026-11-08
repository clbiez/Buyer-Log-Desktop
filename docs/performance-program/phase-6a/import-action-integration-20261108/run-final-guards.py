from pathlib import Path
import json,subprocess,hashlib,shlex,re,os,sys
repo=Path('/workspace/buyerlog-post-main-acceptance');app=repo/'resources/app';out=Path('/tmp/buyerlog-import-completion-safety')
hash=lambda b:hashlib.sha256(b).hexdigest()
files=['resources/app/public/app-main.js','resources/app/public/excel-import-wizard.js','resources/app/public/override-sync.js']
before={f:hash((repo/f).read_bytes()) for f in files}
protected=['resources/app/public/checklist-components-engine.js','resources/app/public/cp-overview-assistant.js','resources/app/public/checklist-supplier-sync.js','resources/app/tests/checklist-components-row-cache.test.js','.github/workflows/buyerlog-pr-fast-checks.yml']
for f in protected:assert (repo/f).read_bytes()==subprocess.check_output(['git','show','1796193f:'+f],cwd=repo),f
workflow=(repo/protected[-1]).read_text();fast=re.search(r'name: CP checklist pass caches, single refresh and delta recalculation\n\s+run: (.+)',workflow).group(1)
receipt={'runtimeSha256':before,'protected916ByteEqualMain179':protected,'commands':[]}
for name,cmd in [('i18n',['npm','run','i18n:check']),('release',['npm','run','release:notes:validate']),('protected916',shlex.split(fast))]:
 p=out/('6a-import-final-'+name+'.log')
 with p.open('x') as log:code=subprocess.run(cmd,cwd=app,stdout=log,stderr=subprocess.STDOUT).returncode
 receipt['commands'].append({'name':name,'command':cmd,'exitCode':code,'log':str(p),'rawSha256':hash(p.read_bytes())});print(name,code,flush=True)
 (out/'6a-import-final-guards.json').write_text(json.dumps(receipt,indent=2)+'\n')
 if code:sys.exit(code)
assert before=={f:hash((repo/f).read_bytes())for f in files}
print('Runtime bytes unchanged; protected #916 exact workflow command preserved.',flush=True)
