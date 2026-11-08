#!/usr/bin/python3
"""Fixed serial INT08 workload with disk admission and post-exit evidence packing."""
import argparse, collections, datetime, fcntl, gzip, hashlib, json, os, pathlib, shutil, signal, subprocess, time, zipfile
from storage import MIB, DEFAULT_BUDGET, admit, atomic_json, gzip_bound, hardlink_sources, pack_run, sha_file, tree_bytes, verify_sources

ROOT = pathlib.Path(__file__).resolve().parent
CACHE = pathlib.Path('/tmp/buyerlog-startup-shared908-main5b8-20261107')

def read_json(file):
    file = pathlib.Path(file)
    if file.exists():
        return json.loads(file.read_text())
    with gzip.open(str(file)+'.gz','rt') as stream:
        return json.load(stream)

def server_identity(pid):
    try:
        parts = pathlib.Path('/proc',str(pid),'stat').read_text().split(') ',1)[1].split()
        return {'state':parts[0],'startTicks':parts[19]}
    except FileNotFoundError:
        return None

def ensure_server_exit(run):
    lifecycle = run/'process-lifecycle.json'
    if not lifecycle.exists():
        # Unknown is not proof of exit. Preserve raw evidence and stop; never
        # infer a safe process identity or signal an unrelated process.
        return False
    state = json.loads(lifecycle.read_text())
    pid, started = state.get('serverPid'), state.get('serverStartTicks')
    if not pid:
        return True
    current = server_identity(pid)
    if current is None or current['state'] == 'Z':
        return True
    if started and current['startTicks'] != started:
        return True  # PID was reused; never signal the unrelated process.
    if not started:
        return False
    for action, seconds in [(signal.SIGTERM,10),(signal.SIGKILL,5)]:
        try:
            os.kill(pid,action)
        except ProcessLookupError:
            return True
        deadline = time.monotonic()+seconds
        while time.monotonic() < deadline:
            current = server_identity(pid)
            if current is None or current['state'] == 'Z' or current['startTicks'] != started:
                state.update(serverExitConfirmed=True,dispatcherConfirmedExit=True)
                atomic_json(lifecycle,state)
                return True
            time.sleep(.1)
    return False

def budget_from_smoke(file, fixture_digest):
    smoke = pathlib.Path(file).resolve()
    result = read_json(smoke/'result.json')
    assert result['fixtureManifestSha256'] == fixture_digest
    assert result['status'] == 'baseline-captured-requires-analysis'
    assert result['functional']['xlsxEmbeddedMediaBytesEqual'] is True
    packed = read_json(smoke/'artifact-compression-manifest.json')
    assert packed['status'] == 'packed' and packed['serverExitConfirmed']
    records = [row for row in packed['artifacts'] if pathlib.Path(row['rawPath']).name in {'chromium-trace.json','result.json'}
               or any(word in pathlib.Path(row['rawPath']).name.lower() for word in ['memory','heapsnapshot','cpuprofile'])]
    assert any(pathlib.Path(row['rawPath']).name == 'chromium-trace.json' for row in records)
    for row in records:
        assert row['roundTripVerified'] and sha_file(row['gzipPath']) == row['gzipSha256']
    budget = dict(DEFAULT_BUDGET)
    budget['rawTraceBytes'] = max(64*MIB,2*sum(row['rawBytes'] for row in records))
    budget['retainedTraceBytes'] = max(8*MIB,2*sum(row['gzipBytes'] for row in records))
    budget['smokeEvidence'] = str(smoke)
    budget['estimateRule'] = 'twice actual losslessly verified trace/memory bytes; raw64MiB/gzip8MiB floors; not an event/output cap'
    return budget

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage-root',required=True)
    parser.add_argument('--repeats',type=int,default=3)
    parser.add_argument('--label',default=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    parser.add_argument('--smoke',action='store_true')
    parser.add_argument('--budget-from-smoke',help='A successful SAME-STAGE v2 smoke; affects disk estimates only')
    options = parser.parse_args()
    assert 1 <= options.repeats <= 5
    assert options.label.replace('-','').replace('_','').isalnum()
    stage = pathlib.Path(options.stage_root).resolve()
    assert stage.is_relative_to(ROOT/'stages')
    with open('/tmp/buyerlog-performance-measurement.lock','r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        status = read_json(stage/'preparation-status.json')
        assert status['status'] == 'prepared-not-executed'
        manifest = read_json(stage/'fixture-manifest.json')
        pins = read_json(stage/'source-pins.json')
        digest = sha_file(stage/'fixture-manifest.json')
        assert digest == status['fixtureManifestSha256']
        assert sha_file(stage/'source-pins.json') == status['sourcePinsSha256']
        assert manifest['revision'] == pins['revision'] == status['selectedRevision']
        assert manifest['appTree'] == pins['appTree'] == status['appTree']
        assert pins['ancestorVerified'] and pins['requiredAncestor'] == '0c85445f1989cafbae4f104c13ddf5d8f0b84c6c'
        for name, record in {**pins['files'],**pins['preservedCpGuards']}.items():
            assert sha_file(pathlib.Path(manifest['appRoot'],name)) == record['sha256']
        assert len(manifest['images']) == manifest['count'] == 32
        for item in manifest['images']:
            file = stage/'originals'/item['file']
            assert file.stat().st_size == item['encodedBytes'] and sha_file(file) == item['sha256']
            assert 1024 < item['encodedBytes'] < manifest['uploadLimits']['rawOriginalBytes']
            assert item['jsonUploadBodyUpperBytes'] < min(manifest['uploadLimits']['globalJsonBytes'],manifest['uploadLimits']['collectionNominalJsonBytes'])
        budget = budget_from_smoke(options.budget_from_smoke,digest) if options.budget_from_smoke else dict(DEFAULT_BUDGET)
        mutable_base = sum(tree_bytes(CACHE/directory) for directory in ['app','data','local'])
        image_bytes = sum(item['encodedBytes'] for item in manifest['images'])
        representative, seen = [],set()
        for item in manifest['images']:
            key=(item['class'],item['mime'])
            if key not in seen:
                seen.add(key);representative.append(item)
        workbook_bytes = sum(item['encodedBytes'] for item in representative)+4*MIB
        plans = [('smoke-originals','originals')] if options.smoke else [
            ('%02d-%s'%(repeat+1,case),case) for repeat in range(options.repeats)
            for case in (['control','originals'] if repeat%2==0 else ['originals','control'])]
        def growth(case):
            return image_bytes+workbook_bytes if case == 'originals' else 0
        def app_start_need(case):
            return growth(case)+budget['rawTraceBytes']+gzip_bound(budget['rawTraceBytes'])+budget['runtimeTemporaryBytes']+budget['logGrowthBytes']+budget['safetyFreeBytes']+budget['mutableGrowthBytes']
        def retained(case):
            return mutable_base+growth(case)+budget['mutableGrowthBytes']+budget['retainedTraceBytes']+budget['logGrowthBytes']
        retained_so_far, required_peak = 0,0
        for _,case in plans:
            required_peak = max(required_peak,retained_so_far+mutable_base+app_start_need(case))
            retained_so_far += retained(case)
        cohort = ROOT/'runs'/options.label
        cohort.mkdir(parents=True,exist_ok=False)
        details = {'revision':pins['revision'],'appTree':pins['appTree'],'stageRoot':str(stage),'fixtureManifestSha256':digest,
                   'fixedPlans':plans,'mutableBaseCopyBytes':mutable_base,'immutableWorkbookCopyBytes':0,
                   'all32OriginalBytes':image_bytes,'sixRepresentativeWorkbookEstimateBytes':workbook_bytes,
                   'retainedEvidenceEstimateBytes':retained_so_far,'budget':budget,
                   'estimateOnly':'No trace cap, sample count, frame count, timeout, image recipe or assertion is changed.'}
        admit(ROOT,required_peak,'whole-fixed-cohort-before-any-app',details,cohort/'disk-cohort-admission.json')
        summary=[]
        for name,scenario in plans:
            run=cohort/name
            run.mkdir()
            admit(ROOT,mutable_base+app_start_need(scenario),'case-before-private-copy',details,run/'disk-copy-admission.json')
            fixture=run/'fixture'
            fixture.mkdir()
            for directory in ['app','data','local']:
                shutil.copytree(CACHE/directory,fixture/directory)  # mutable copies, never hardlinks
            sources=hardlink_sources(CACHE,fixture/'source',manifest['sourceFixture'])
            atomic_json(run/'immutable-source-before.json',sources)
            sync=fixture/'local/sync-settings.json'
            if sync.exists():
                settings=json.loads(sync.read_text())
                for key in ['sharedSyncRoot','sharedSyncFolder']:settings[key]=str(fixture/'shared-disabled')
                for key in ['enabled','autoSync','centralIamEnabled']:settings[key]=False
                atomic_json(sync,settings)
            admission=admit(ROOT,app_start_need(scenario),'last-app-start-check',details)
            admission.update(appStartRequiredFreeBytes=app_start_need(scenario),stageFixtureManifestSha256=digest)
            atomic_json(run/'app-start-admission.json',admission)
            command=['node',str(ROOT/'probe.cjs'),'--stage-root',str(stage),'--app-root',manifest['appRoot'],
                     '--run-root',str(run),'--scenario',scenario]
            item={'case':name,'scenario':scenario,'smoke':options.smoke,'revision':pins['revision'],'appTree':pins['appTree'],
                  'result':str(run/'result.json'),'status':'running'}
            summary.append(item)
            atomic_json(cohort/'cohort.json',{'schemaVersion':2,'provenance':details,'runs':summary})
            try:
                with (run/'probe.log').open('w') as output:
                    result=subprocess.run(command,stdout=output,stderr=subprocess.STDOUT)
                item['returncode']=result.returncode
                if result.returncode:
                    raise RuntimeError('Native browser/API probe failed; retain full evidence')
                if scenario == 'originals':
                    report=read_json(run/'result.json')
                    wanted=collections.Counter(report['functional']['workbookExpectedHashes'])
                    with zipfile.ZipFile(run/'original-export.xlsx') as archive:
                        actual=collections.Counter(hashlib.sha256(archive.read(part)).hexdigest() for part in archive.namelist()
                                                   if part.startswith('xl/media/') and not part.endswith('/'))
                    equal=actual == wanted
                    report['functional']['xlsxEmbeddedMediaBytesEqual']=equal
                    atomic_json(run/'result.json',report)
                    assert equal,'Actual XLSX embedded bytes differ from originals'
                    item['xlsxEmbeddedMediaBytesEqual']=True
                item['status']='captured-requires-analysis'
            except BaseException as error:
                item.update(status='failed-preserved',error=repr(error))
            finally:
                exited=ensure_server_exit(run)
                item['serverExitConfirmed']=exited
                try:
                    after=verify_sources(CACHE,manifest['sourceFixture'])
                    for expected,observed in zip(sources,after):
                        assert expected == observed,'Source bytes/mode/inode changed'
                    atomic_json(run/'immutable-source-after.json',after)
                    if not exited:
                        raise RuntimeError('Server exit not confirmed; preserve raw evidence and stop')
                    packed=pack_run(run,exited,budget['safetyFreeBytes'])
                    item['evidencePackingStatus']=packed['status']
                    if not (run/'result.json').exists() and (run/'result.json.gz').exists():item['result']=str(run/'result.json.gz')
                except BaseException as error:
                    item.update(status='failed-preserved',preservationError=repr(error))
                item['availableDiskAfterBytes']=shutil.disk_usage(ROOT).free
                atomic_json(cohort/'cohort.json',{'schemaVersion':2,'provenance':details,'runs':summary})
            if item['status'] == 'failed-preserved':
                raise SystemExit('Stopped with all evidence retained at '+str(run))
        print(cohort)

if __name__ == '__main__':
    main()
