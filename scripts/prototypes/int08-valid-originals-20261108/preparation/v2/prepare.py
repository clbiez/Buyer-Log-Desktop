#!/usr/bin/python3
"""Stage an explicitly selected, approved revision. Does not run the app/probe."""
import argparse, fcntl, hashlib, json, pathlib, re, subprocess, tarfile
from PIL import Image
from fixture_recipe import generate
from storage import MIB, admit, atomic_json, gzip_bound, sha_file, verify_sources

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = pathlib.Path('/tmp/buyerlog-startup-shared908-main5b8-20261107')
REQUIRED_ANCESTOR = '0c85445f1989cafbae4f104c13ddf5d8f0b84c6c'
PATHS = ['public/model-image-cache.js','public/app-main.js','public/detail-drawer.js','public/perf-runtime.js',
         'public/vendor/exceljs.min.js','server/user-data.js','server/server.js',
         'server/routes/cp-image-routes.js','server/routes/collection-image-routes.js']
GUARD_PATHS = ['public/checklist-components-engine.js','public/cp-overview-assistant.js',
               'public/checklist-supplier-sync.js','tests/checklist-components-row-cache.test.js']

def git(repo, *args, text=False):
    return subprocess.check_output(['git','-C',repo,*args],text=text)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True, help='Final approved Main commit/ref; frozen to full commit before staging')
    parser.add_argument('--repo', default='/workspace/buyerlog-authority-fix')
    parser.add_argument('--dependencies', default='/workspace/buyerlog-authority-fix/resources/app/node_modules')
    parser.add_argument('--stage-tag', default='original-baseline-01')
    options = parser.parse_args()
    assert options.stage_tag.replace('-','').replace('_','').isalnum()
    revision = git(options.repo,'rev-parse','--verify',options.revision+'^{commit}',text=True).strip()
    subprocess.check_call(['git','-C',options.repo,'merge-base','--is-ancestor',REQUIRED_ANCESTOR,revision])
    app_tree = git(options.repo,'rev-parse',revision+':resources/app',text=True).strip()
    stage = ROOT/'stages'/(revision+'-'+options.stage_tag)
    assert not stage.exists(), 'Preserve frozen/partial stages; select a new stage-tag for another preparation'
    stage.mkdir(parents=True)
    status = {'schemaVersion':2,'status':'preparing','selectedRevision':revision,'appTree':app_tree,
              'requiredAncestor':REQUIRED_ANCESTOR,'ancestorVerified':True,'stageRoot':str(stage)}
    atomic_json(stage/'preparation-status.json',status)
    try:
        metadata = json.loads((CACHE/'source/benchmark-fixture.json').read_text())
        source_records = verify_sources(CACHE,metadata)
        context = json.loads((ROOT/'review-context-pins.json').read_text())
        source, pins = {}, {'schemaVersion':2,'revision':revision,'appTree':app_tree,'requiredAncestor':REQUIRED_ANCESTOR,
                            'ancestorVerified':True,'files':{},'preservedCpGuards':{},'reviewContextRevision':context['revision']}
        for name in PATHS+GUARD_PATHS:
            data = git(options.repo,'show',revision+':resources/app/'+name)
            source[name] = data
            record = {'gitBlob':git(options.repo,'rev-parse',revision+':resources/app/'+name,text=True).strip(),
                      'sha256':hashlib.sha256(data).hexdigest()}
            pins['files' if name in PATHS else 'preservedCpGuards'][name] = record
        pins['guardReference916'] = {}
        for name in GUARD_PATHS:
            data = git(options.repo,'show',REQUIRED_ANCESTOR+':resources/app/'+name)
            pins['guardReference916'][name] = {'gitBlob':git(options.repo,'rev-parse',REQUIRED_ANCESTOR+':resources/app/'+name,text=True).strip(),
                                               'sha256':hashlib.sha256(data).hexdigest()}
        pins['guardPathsChangedSince916'] = [name for name in GUARD_PATHS
            if pins['preservedCpGuards'][name]['sha256'] != pins['guardReference916'][name]['sha256']]
        pins['changedSinceHistoricalReviewContext'] = [name for name in PATHS
            if pins['files'][name]['sha256'] != context['files'][name]['sha256']]
        server = source['server/server.js'].decode()
        user_data = source['server/user-data.js'].decode()
        collection = source['server/routes/collection-image-routes.js'].decode()
        # Stop if the selected source changes these assumptions; do not silently
        # carry old6b labels/limits into a newer approved application.
        assert re.search(r"RAW_COLLECTION_IMAGE_MAX_BYTES\s*=\s*50\s*\*\s*1024\s*\*\s*1024",user_data)
        global_parser = re.search(r"app\.use\(express\.json\(\{\s*limit:\s*['\"]100mb['\"]\s*\}\)\)",server)
        assert global_parser and global_parser.start() < server.index("require('./routes/cp-image-routes')")
        assert global_parser.start() < server.index("require('./routes/collection-image-routes')")
        assert re.search(r"express\.json\(\{\s*limit:\s*['\"]70mb['\"]\s*\}\)",collection)
        assert 'return desc.source;' in source['public/model-image-cache.js'].decode()
        contract_path = 'docs/performance/2026-11-05-codex-review-findings.md'
        contract = git(options.repo,'show',revision+':'+contract_path)
        pins['contract'] = {'path':contract_path,'sha256':hashlib.sha256(contract).hexdigest(),
                            'gitBlob':git(options.repo,'rev-parse',revision+':'+contract_path,text=True).strip()}
        dependencies = pathlib.Path(options.dependencies).resolve()
        assert (dependencies/'express/package.json').is_file()
        pins['dependencies'] = {}
        for name in ['express','body-parser','bytes']:
            file = dependencies/name/'package.json'
            pins['dependencies'][name] = {'version':json.loads(file.read_text())['version'],'packageSha256':sha_file(file)}
        parser_file = dependencies/'body-parser/lib/types/json.js'
        assert 'if (req._body)' in parser_file.read_text()
        pins['dependencies']['bodyParserJsonSha256'] = sha_file(parser_file)
        listing = git(options.repo,'ls-tree','-r','-l','-z',revision,'resources/app')
        entries = [entry.split(b'\t',1)[0].split() for entry in listing.split(b'\0') if entry]
        app_bytes = sum(int(entry[3]) for entry in entries if entry[1] == b'blob')
        # One image is encoded in RAM, then admitted before any file is written.
        # Original size/distribution is unchanged; no sample is dropped to fit.
        admit(ROOT,app_bytes+64*MIB+128*MIB,'stage-app-and-one-original-workspace',
              {'appLogicalBytes':app_bytes,'dependencyCopyBytes':0,'sourceWorkbookCopyBytes':0},stage/'disk-stage-admission.json')
        pinned = stage/'pinned'
        pinned.mkdir()
        archive = subprocess.Popen(['git','-C',options.repo,'archive',revision,'resources/app'],stdout=subprocess.PIPE)
        try:
            with tarfile.open(fileobj=archive.stdout,mode='r|') as stream:
                for member in stream:
                    assert (pinned/member.name).resolve().is_relative_to(pinned.resolve())
                    assert not member.issym() and not member.islnk(), 'Unexpected source archive link'
                    stream.extract(member,pinned)
        finally:
            archive.stdout.close()
        assert archive.wait() == 0
        app = pinned/'resources/app'
        (app/'node_modules').symlink_to(dependencies,target_is_directory=True)
        for name in PATHS+GUARD_PATHS:
            bucket = pins['files' if name in PATHS else 'preservedCpGuards']
            assert sha_file(app/name) == bucket[name]['sha256'],'Frozen source mismatch '+name
        atomic_json(stage/'source-pins.json',pins)
        (stage/'INT-08-authoritative-source.md').write_bytes(contract)
        originals = stage/'originals'
        originals.mkdir()
        records = generate(originals,lambda size,name:admit(stage,size+128*MIB,'write-valid-original',{'filename':name,'encodedBytes':size}),50*MIB)
        assert len(records) == 32
        limits = {'rawOriginalBytes':50*MIB,'globalJsonBytes':100*MIB,'collectionNominalJsonBytes':70*MIB,
                  'collectionEffectiveParser':'The earlier global100MiB parser has already parsed JSON; body-parser skips req._body bodies.',
                  'cpEffectiveJsonBytes':100*MIB,'identityHeaderBudgetBytes':4096}
        for item in records:
            # Largest possible base64 string for each ACTUAL generated file;
            # include a conservative4KiB identity/header allowance before start.
            body_upper = 4*((item['encodedBytes']+2)//3)+4096
            assert item['encodedBytes'] < limits['rawOriginalBytes']
            assert body_upper < min(limits['globalJsonBytes'],limits['collectionNominalJsonBytes'])
            item['jsonUploadBodyUpperBytes'] = body_upper
            if item['mime'] == 'image/png':
                raw_scanlines = (item['width']*3+1)*item['height']
                deflate = gzip_bound(raw_scanlines)
                png_upper = deflate+12*((deflate+65535)//65536)+128
                assert item['encodedBytes'] <= png_upper
                item['conservativePngUpperBytes'] = png_upper
        manifest = {'schemaVersion':2,'synthetic':True,'seed':7,'count':32,'revision':revision,'appTree':app_tree,
                    'stageRoot':str(stage),'appRoot':str(app),'sourceCacheRoot':str(CACHE),'sourceFixture':metadata,
                    'verifiedSourceWorkbooks':source_records,'uploadLimits':limits,'pillowVersion':Image.__version__,
                    'generatorSha256':sha_file(ROOT/'fixture_recipe.py'),'prepareSha256':sha_file(__file__),
                    'originalRecipe':'v1 size/codec/seed/garment/texture recipe unchanged; encode-to-RAM for disk admission',
                    'images':records}
        atomic_json(stage/'fixture-manifest.json',manifest)
        status.update(status='prepared-not-executed',appRoot=str(app),originalsEncodedBytes=sum(x['encodedBytes'] for x in records),
                      sourcePinsSha256=sha_file(stage/'source-pins.json'),fixtureManifestSha256=sha_file(stage/'fixture-manifest.json'))
        print(json.dumps({'stageRoot':str(stage),'revision':revision,'appTree':app_tree,'status':status['status']}))
    except BaseException as error:
        status.update(status='preparation-failed-preserved',error=repr(error))
        raise
    finally:
        atomic_json(stage/'preparation-status.json',status)

if __name__ == '__main__':
    with open('/tmp/buyerlog-performance-measurement.lock','r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        main()
