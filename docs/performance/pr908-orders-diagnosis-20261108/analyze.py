"""Lossless evidence analysis; inclusive samples and native trace durations are nonadditive."""
import collections, gzip, hashlib, json, pathlib, sys, tarfile

HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[2]
OLD=REPO/'docs/performance/shared-ui-post-main-20261107/post-917-20261108'
SHARED=['table-header-tracking.js','workspace-blur.js']
file=lambda frame:frame['url'].split('/')[-1].split('?')[0]

def profile_summary(profile,bounds=None):
    nodes={n['id']:n for n in profile['nodes']}
    parents={child:n['id'] for n in profile['nodes'] for child in n.get('children',[])}
    timestamp=profile['startTime'];samples=[]
    for node,delta in zip(profile['samples'],profile['timeDeltas']):
        timestamp+=delta;samples.append((timestamp,node))
    samples.sort(key=lambda sample:sample[0])
    lo,hi=bounds or (profile['startTime'],profile['endTime'])
    inclusive=collections.Counter();self_time=collections.Counter();functions=collections.Counter();total=0
    for i,(start,node) in enumerate(samples):
        end=min(profile['endTime'],samples[i+1][0] if i+1<len(samples) else profile['endTime'])
        duration=max(0,min(hi,end)-max(lo,start))/1000
        if not duration:continue
        total+=duration;frame=nodes[node]['callFrame'];self_time[file(frame) or frame['functionName']]+=duration
        seen=set();seen_functions=set()
        while node:
            frame=nodes[node]['callFrame'];name=file(frame);function=(name,frame['functionName'])
            if name not in seen and name:inclusive[name]+=duration;seen.add(name)
            if function not in seen_functions and name:functions[function]+=duration;seen_functions.add(function)
            node=parents.get(node)
    return {'boundsUs':[lo,hi],'sampledMs':round(total,3),
            'sharedInclusiveMs':{k:round(inclusive[k],3) for k in SHARED},
            'fileInclusiveTopMs':[(k,round(v,3)) for k,v in inclusive.most_common(12)],
            'selfTopMs':[(k,round(v,3)) for k,v in self_time.most_common(12)],
            'functionInclusiveTopMs':[(k,round(v,3)) for k,v in functions.most_common(15)],
            'negativeDeltas':sum(delta<0 for delta in profile['timeDeltas'])}

def union_duration(intervals):
    end=float('-inf');total=0
    for lo,hi in sorted(intervals):
        if hi>end:total+=hi-max(lo,end);end=hi
    return round(total/1000,3)

def timeline_summary(trace,bounds=None):
    lo,hi=bounds or (float('-inf'),float('inf'))
    groups=collections.defaultdict(list);counts=collections.Counter()
    for event in trace['traceEvents']:
        if event.get('ph')!='X' or not event.get('dur'):continue
        start,end=max(lo,event['ts']),min(hi,event['ts']+event['dur'])
        if end<=start:continue
        name=event['name']
        if name in ['Layout','UpdateLayoutTree']:key=name
        elif name in ['FunctionCall','EvaluateScript']:
            url=event.get('args',{}).get('data',{}).get('url','').split('/')[-1].split('?')[0]
            if url not in SHARED:continue
            key=name+':'+url
        else:continue
        groups[(event['pid'],event['tid'],key)].append((start,end));counts[key]+=1
    totals=collections.Counter()
    for (_,_,key),intervals in groups.items():totals[key]+=union_duration(intervals)
    return {'nonadditiveNativeDurationMs':dict(totals),'eventCounts':dict(counts)}

result={'method':'Signed CDP timeDeltas become absolute timestamps, then samples are sorted. Each file/function counted at most once per sample. Window bounds use CDP NavigationStart. Native event durations are unioned per thread and label. Inclusive JS and native durations are nested and must not be added.',
        'historical':{},'current':{}}
with tarfile.open(OLD/'orders-trace/diagnostic-records.tar.gz') as archive:
    for arm in ['A','B']:
        read=lambda name:archive.extractfile(arm+'/'+name).read()
        profile=json.loads(gzip.decompress(read('renderer.cpuprofile.gz')))
        trace=json.loads(gzip.decompress(read('timeline.trace.json.gz')))
        obs=json.loads(read('profile-boundary-actual-marks-and-preparation.json'))
        probe=obs['nativeFirstTransition'];intent=probe['intentAtMs'];paint=intent+probe['elapsedMs'];end=intent+probe['observationEndMs']
        loading=next(event['atMs'] for event in obs['modulePreparationEvents'] if event['snapshot']['cp']['status']=='loading')
        result['historical'][arm]={'profileSha256':hashlib.sha256(read('renderer.cpuprofile.gz')).hexdigest(),
            'profile':profile_summary(profile),'native':timeline_summary(trace),'probe':probe,
            'cpLoadingAtMs':loading,'intentToPaintOverlapWithCpLoadingMs':round(max(0,paint-max(intent,loading)),3),
            'nativeObservationEndAtMs':end,
            'supplementaryCpReadyAtMs':[e['atMs'] for e in obs['modulePreparationEvents'] if e['snapshot']['cp']['status']=='ready'],
            'warning':'Supplemental preparation events can be after profile/native completion; do not attribute them to the measured window.'}
if len(sys.argv)>1:
    root=pathlib.Path(sys.argv[1])
    for run in sorted(root.glob('pair*-*')):
        for module in ['cp','orders']:
            if not (run/(module+'.cpuprofile.gz')).exists():continue
            profile=json.loads(gzip.decompress((run/(module+'.cpuprofile.gz')).read_bytes()))
            trace=json.loads(gzip.decompress((run/(module+'.trace.json.gz')).read_bytes()))
            obs=json.loads((run/(module+'-observations.json')).read_text());probe=obs['probe']
            nav=next(m['value'] for m in json.loads((run/(module+'-cdp-metrics.json')).read_text())['metrics'] if m['name']=='NavigationStart')*1e6
            intent=nav+probe['intentAtMs']*1000;data=intent+probe['dataReadyMs']*1000;paint=intent+probe['elapsedMs']*1000;end=intent+probe['observationEndMs']*1000
            windows={'entireProfile':None,'navigationToIntent':(nav,intent),'intentToData':(intent,data),'intentToPaint':(intent,paint),'paintToObservationEnd':(paint,end)}
            result['current'][run.name+'-'+module]={'probe':probe,'observations':obs['observations'],
                'windows':{key:{'profile':profile_summary(profile,bounds),'native':timeline_summary(trace,bounds)} for key,bounds in windows.items()}}
print(json.dumps(result,indent=2))
