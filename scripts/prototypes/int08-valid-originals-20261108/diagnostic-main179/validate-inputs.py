"""Verify source immutability, the inherited lock and actual write guards."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
from admission import require_flock
from storage import atomic_json, sha_file, verify_sources

def git(repo,*args):
    return subprocess.check_output(['git','-C',str(repo),*args])

def blob_sha(file):
    size=file.stat().st_size
    digest=hashlib.sha1(('blob '+str(size)+'\0').encode())
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',required=True)
    parser.add_argument('--work-root',required=True)
    parser.add_argument('--output-dir',required=True)
    args=parser.parse_args()
    require_flock()
    repo,work,output=map(lambda value:pathlib.Path(value).resolve(),[args.repo,args.work_root,args.output_dir])
    output.mkdir(parents=True,exist_ok=False)
    stage=next((work/'stages').iterdir())
    manifest=json.loads((stage/'fixture-manifest.json').read_text())
    revision=manifest['revision']
    assert revision=='1796193f0a57c7785e7bf9fdb3557e33c550b25e'
    assert not git(repo,'diff','--name-only',revision,'--','resources/app').strip()
    listing=git(repo,'ls-tree','-r','-z',revision,'resources/app')
    checked=0
    checkout_eol=[]
    for entry in listing.split(b'\0'):
        if not entry:
            continue
        meta,name=entry.split(b'\t',1)
        mode,kind,digest=meta.split()
        assert kind==b'blob'
        relative=name.decode()
        for root in [repo,stage/'pinned']:
            actual=blob_sha(root/relative)
            if actual!=digest.decode():
                # The repository explicitly checks Windows launchers out as
                # CRLF, including git archive output. Git blobs are LF.
                # Do not rewrite either representation.
                attrs=git(repo,'check-attr','text','eol','filter','--',relative).decode()
                assert ': text: set' in attrs and ': eol: crlf' in attrs and ': filter: unspecified' in attrs,relative
                raw=(root/relative).read_bytes().replace(b'\r\n',b'\n')
                normalized=hashlib.sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()
                assert normalized==digest.decode(),relative
                checkout_eol.append(dict(root=str(root),path=relative,rawBlobSha1=actual,normalizedBlobSha1=normalized,attributes=attrs))
            else:
                assert actual==digest.decode(),str(root/relative)
        checked+=1
    preparation=repo/'scripts/prototypes/int08-valid-originals-20261108/preparation'
    assert sha_file(preparation/'portable-manifest.json')=='529dc8c652eab19db8ac436fc3e1536d1c1e4e59c0c2d2446dda0190d016aa05'
    portable=json.loads((preparation/'portable-manifest.json').read_text())
    for name,digest in portable.items():
        assert sha_file(preparation/'v2'/name)==digest
    baseline=json.loads((repo/'resources/app/tests/fixtures/i18n-coverage-baseline.json').read_text())
    assert baseline['files']=={}
    cache=pathlib.Path(manifest['sourceCacheRoot'])
    sources=verify_sources(cache,manifest['sourceFixture'])
    assert sources==manifest['verifiedSourceWorkbooks']
    source_runs=0
    link=None
    for run in (work/'runs').glob('*/*'):
        before=run/'immutable-source-before.json'
        if not before.exists():
            continue
        assert json.loads(before.read_text())==sources
        assert json.loads((run/'immutable-source-after.json').read_text())==sources
        for item in sources:
            source=cache/'source'/item['name']
            private=run/'fixture/source'/item['name']
            assert os.path.samestat(source.stat(),private.stat())
            assert sha_file(private)==item['sha256']
            link=private
        source_runs+=1
    assert link
    canonical_checks=0
    for label in ['cp-pairs-02','orders-pairs-02']:
        cohort=json.loads((work/'runs'/label/'cohort.json').read_text())
        assert len(cohort['runs'])==6
        for case in cohort['runs']:
            assert case['status']=='captured-requires-analysis'
            if case['scenario']!='originals':
                continue
            run=work/'runs'/label/case['case']
            mappings=json.loads((run/'attached-images.json').read_text())
            image_root=run/'fixture/local/collection-images'
            index={item['id']:item for item in json.loads((image_root/'index.json').read_text())}
            assert len(mappings)==32
            for mapping in mappings:
                item=index[mapping['imageRef']]
                assert item['rowId']=='cp:'+mapping['canonicalKey']
                assert item['mimeType']==mapping['mime']
                assert item['size']==mapping['encodedBytes']
                file=image_root/item['storedName']
                assert file.stat().st_nlink==1 and sha_file(file)==mapping['sha256']
                canonical_checks+=1
    guard=pathlib.Path(__file__).parent/'local-only.cjs'
    log=output/'guard-events.log'
    env={'PATH':os.environ['PATH'],'INT08_GUARD_LOG':str(log),
         'INT08_SOURCE_READONLY_ROOTS':json.dumps([str(cache/'source'),str(link.parent)])}
    code="""const fs=require('node:fs'),assert=require('node:assert/strict');
      (async()=>{for(const file of process.argv.slice(1)){
        // r+ opens without truncation; even a broken guard cannot corrupt data.
        assert.throws(()=>{const fd=fs.openSync(file,'r+');fs.closeSync(fd);},{code:'INT08_IMMUTABLE_SOURCE_WRITE_BLOCKED'});
        await assert.rejects(fs.promises.open(file,'r+'),{code:'INT08_IMMUTABLE_SOURCE_WRITE_BLOCKED'});
        fs.closeSync(fs.openSync(file,'r'));
      }})().catch(e=>{console.error(e);process.exitCode=1;});"""
    subprocess.run(['node','--require',str(guard),'-e',code,str(cache/'source'/sources[0]['name']),str(link)],env=env,check=True)
    assert log.read_text().splitlines()==['IMMUTABLE_SOURCE_WRITE_BLOCKED']*4
    assert verify_sources(cache,manifest['sourceFixture'])==sources
    nested=subprocess.run(['flock','-n','-E','75','/tmp/buyerlog-performance-measurement.lock','true'])
    assert nested.returncode==75
    atomic_json(output/'input-and-lock-validation.json',dict(status='passed',revision=revision,
        appTree=manifest['appTree'],checkedApplicationBlobsInBothTrees=checked,
        declaredCheckoutEolNormalization=checkout_eol,
        portableV2FilesVerified=len(portable),i18nBaselineEntries=0,
        verifiedSourceWorkbooks=sources,verifiedSourceRunAudits=source_runs,
        canonicalOriginalMappingsVerified=canonical_checks,
        sourceWriteGuardNegativeChecks=4,nestedLockExitCode=nested.returncode,
        sourceWriteGuardScope='Separate validation only; no source writes, chmod or content changes; counted runs still require zero attempted writes.'))
    print(output/'input-and-lock-validation.json')

if __name__=='__main__':
    main()
