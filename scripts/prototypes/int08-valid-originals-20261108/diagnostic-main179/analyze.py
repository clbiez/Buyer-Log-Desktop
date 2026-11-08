"""Recompute diagnostics from retained JSON and complete Chromium traces."""
import argparse
import collections
import gzip
import hashlib
import json
import pathlib
import statistics
import subprocess
import sys
from admission import require_flock
from storage import atomic_json, sha_file

def read_json(file):
    file = pathlib.Path(file)
    if file.exists():
        return json.loads(file.read_text())
    with gzip.open(str(file)+'.gz', 'rt') as stream:
        return json.load(stream)

def verify_packing(run, portable=False):
    manifest = read_json(run/'artifact-compression-manifest.json')
    assert manifest['status'] == 'packed' and manifest['serverExitConfirmed']
    verified=0
    for item in manifest['artifacts']:
        assert item['roundTripVerified']
        recorded_run = pathlib.Path(read_json(run/'result.json')['trace']['file']).parent if portable else run
        relative = pathlib.Path(item['gzipPath']).relative_to(recorded_run)
        path = run/relative
        if portable and not path.exists():
            # The complete portable manifest and every delivered gzip are
            # verified before analysis. Only private fixture/auth state stays
            # local; no missing top-level performance evidence is accepted.
            assert relative.parts[0]=='fixture', 'Missing performance evidence: '+str(path)
            continue
        assert sha_file(path) == item['gzipSha256']
        digest, size = hashlib.sha256(), 0
        with gzip.open(path, 'rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024), b''):
                digest.update(chunk)
                size += len(chunk)
        assert digest.hexdigest() == item['rawSha256'] and size == item['rawBytes']
        verified+=1
    return verified

def normalized_guid(value):
    try:
        return int(str(value), 16)
    except ValueError:
        return None

def scalar(attr):
    if not attr or attr.get('type') != 'scalar':
        return None
    return int(attr['value'], 16)

def analyze_run(run, portable=False):
    result = read_json(run/'result.json')
    assert result['status'] == 'baseline-captured-requires-analysis'
    assert result['immutableSourceWriteBlocks'] == 0
    assert result['inputCache']['sourceRevisionKey'] == result['measurementCache']['sourceRevisionKey']
    assert result['projectionGenerations'] and set(result['projectionGenerations']) == {result['measurementCache']['generation']}
    assert result['dataset']['revisions'] == result['measurementRevisions']
    assert len(result['scroll']) == 2 and all(len(s['framesMs']) == 180 for s in result['scroll'])
    if result['scenario'] == 'originals':
        assert result['functional']['xlsxEmbeddedMediaBytesEqual']
        assert len(result['functional']['apiByteChecks']) == 64
        assert len(result['functional']['checks']) == 32
        assert result['scroll'][0]['uniqueOriginalsVisible'] >= 8
    packed_count = verify_packing(run, portable)
    events = read_json(run/'chromium-trace.json')['traceEvents']
    decodes = [e for e in events if e.get('ph') == 'X' and
               e.get('name') == 'Decode Image']
    cpu_complete = bool(decodes) and all('tdur' in e for e in decodes)
    output = dict(run=str(run), module=result['measurementModule'], scenario=result['scenario'],
                  probeSha256=result['probeSha256'], revision=result['revision'],
                  decodeCompleteEvents=len(decodes), decodeNames=sorted(set(e['name'] for e in decodes)),
                  decodeElapsedThreadSumMs=sum(e.get('dur', 0) for e in decodes)/1000,
                  decodeThreadCpuMs=sum(e['tdur'] for e in decodes)/1000 if cpu_complete else None,
                  decodeEventsWithThreadCpu=sum('tdur' in e for e in decodes),
                  traceDecodeSample=decodes[:4], independentlyVerifiedGzipArtifacts=packed_count,
                  firstVisibleOriginal=result.get('browserObservations', {}).get('firstVisibleOriginal'),
                  firstVisibleUpperObservationMs=result.get('firstVisibleOriginalObservedAtMs'),
                  continueIntentAtMs=result.get('continueIntentAtMs'),
                  firstImageLoads=result.get('browserObservations', {}).get('imageLoads', [])[:4],
                  dataset=result['dataset'], scroll=[], memory=[])
    output['decodeWindows'] = []
    for label, start_name, end_name in [
        ('navigation-through-first-visible','int08-memory-blank-before-navigation','int08-memory-table-first-visible'),
        ('table-through-two-scrolls','int08-memory-blank-before-navigation','int08-memory-after-repeat-scroll'),
        ('hover-and-drawer','int08-memory-after-repeat-scroll','int08-memory-after-original-drawer'),
    ]:
        starts = [e['ts'] for e in events if e.get('name') == start_name]
        ends = [e['ts'] for e in events if e.get('name') == end_name]
        if not starts or not ends:
            continue
        selected = [e for e in decodes if e['ts'] >= starts[0] and e['ts']+e.get('dur',0) <= ends[0]]
        boundary = [e for e in decodes if e['ts'] < ends[0] and e['ts']+e.get('dur',0) > starts[0] and e not in selected]
        output['decodeWindows'].append(dict(label=label,completeEvents=len(selected),
            threadCpuMs=sum(e['tdur'] for e in selected)/1000 if all('tdur' in e for e in selected) else None,
            elapsedThreadSumMs=sum(e.get('dur',0) for e in selected)/1000,
            excludedBoundaryEvents=len(boundary)))
    for scroll in result['scroll']:
        start_name = 'int08-'+result['measurementModule']+'-'+scroll['label']+'-start'
        end_name = start_name[:-5]+'end'
        starts = [e['ts'] for e in events if e.get('name') == start_name]
        ends = [e['ts'] for e in events if e.get('name') == end_name]
        overlap = None
        if starts and ends:
            overlap = sum(max(0, min(ends[0], e['ts']+e.get('dur', 0))-max(starts[0], e['ts'])) for e in decodes)/1000
        tasks = result['browserObservations']['longTasks']
        long_ms = sum(max(0, min(scroll['endMs'], t['startTime']+t['duration'])-max(scroll['startMs'], t['startTime'])) for t in tasks)
        output['scroll'].append(dict(label=scroll['label'], p50Ms=scroll['p50Ms'], p95Ms=scroll['p95Ms'],
            maxMs=scroll['maxMs'], wallMs=scroll['wallMs'], over33_3Ms=scroll['over33_3Ms'],
            uniqueOriginalsVisible=scroll['uniqueOriginalsVisible'], longTaskOverlapMs=long_ms,
            longTaskWallShare=long_ms/scroll['wallMs'], decodeElapsedOverlapMs=overlap,
            traceWindowUs=[starts[0], ends[0]] if starts and ends else None))
    for phase in result['phases']:
        renderer_pids = {int(p['pid']) for p in phase['processes'] if p['type'] == 'renderer'}
        dump_guid = normalized_guid(phase.get('memoryDump', {}).get('dumpGuid'))
        allocators = []
        marks=[e['ts'] for e in events if e.get('name') == 'int08-memory-'+phase['phase']]
        after=[e for e in events if e.get('pid') in renderer_pids and e.get('args',{}).get('dumps',{}).get('allocators') and marks and e['ts'] >= marks[0]]
        first_dump=min((e['ts'] for e in after), default=None)
        selected_id=next((e.get('id') for e in after if e['ts']==first_dump), None)
        for event in after:
            if event.get('id') != selected_id:
                continue
            for name, allocator in event.get('args', {}).get('dumps', {}).get('allocators', {}).items():
                if name in ['cc/image_memory','discardable','web_cache/Image_resources','gpu/shared_images'] or (name.startswith('v8/') and any(part in name for part in ['external','backing'])):
                    allocators.append(dict(pid=event['pid'], name=name, attrs=allocator.get('attrs', {}),
                                           sizeBytes=scalar(allocator.get('attrs', {}).get('size'))))
        output['memory'].append(dict(phase=phase['phase'], dump=phase.get('memoryDump'),traceDumpId=selected_id,
            attribution='First renderer dump after phase trace marker; Chromium remaps request GUIDs in traces',
            rendererRssSumBytes=sum(p.get('rssBytes') or 0 for p in phase['processes'] if p['type'] == 'renderer'),
            jsHeapUsedBytes=phase['jsHeapUsedBytes'], heapUsage=phase.get('heapUsage'), allocatorEvidence=allocators))
    return output

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work-root', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--cohort', action='append', required=True)
    parser.add_argument('--portable',action='store_true',help='Verify and read the delivered evidence tree without private fixture/auth state')
    args = parser.parse_args()
    require_flock()
    work, output = pathlib.Path(args.work_root).resolve(), pathlib.Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if args.portable:
        subprocess.check_call([sys.executable,str(pathlib.Path(__file__).parent/'verify-portable-evidence.py'),
            '--evidence-root',str(work),'--output',str(output/'portable-input-verification.json')])
    runs = []
    for label in args.cohort:
        cohort = read_json(work/'runs'/label/'cohort.json')
        cases = cohort['runs']
        assert len(cases) == 6
        assert [c['scenario'] for c in cases] == ['control','originals','originals','control','control','originals']
        for case in cases:
            assert case['status'] == 'captured-requires-analysis'
            runs.append(analyze_run(work/'runs'/label/case['case'],args.portable))
    assert len({run['probeSha256'] for run in runs}) == 1
    atomic_json(output/'recomputed-analysis.json', dict(scope='Main179 diagnostic; not post908 acceptance', runs=runs))
    print(output/'recomputed-analysis.json')

if __name__ == '__main__':
    main()
