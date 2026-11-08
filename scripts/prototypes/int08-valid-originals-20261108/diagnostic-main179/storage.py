"""Disk accounting and lossless, verified evidence packing for INT08 v2."""
import gzip, hashlib, json, os, pathlib, shutil

MIB = 1024 * 1024
DEFAULT_BUDGET = {'rawTraceBytes':128*MIB, 'retainedTraceBytes':32*MIB,
                  'runtimeTemporaryBytes':64*MIB, 'logGrowthBytes':16*MIB,
                  'safetyFreeBytes':128*MIB, 'mutableGrowthBytes':16*MIB}

def sha_file(file):
    digest = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(MIB), b''):
            digest.update(chunk)
    return digest.hexdigest()

def atomic_json(file, data):
    file = pathlib.Path(file)
    temporary = file.with_name(file.name+'.writing')
    with temporary.open('w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)

def tree_bytes(root):
    """Logical bytes, counting an inode once and not following directory links."""
    total, seen = 0, set()
    for folder, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if not pathlib.Path(folder, name).is_symlink()]
        for name in files:
            file = pathlib.Path(folder, name)
            if file.is_symlink():
                continue
            stat = file.stat()
            identity = (stat.st_dev, stat.st_ino)
            if identity not in seen:
                seen.add(identity)
                total += stat.st_size
    return total

def gzip_bound(size):
    # zlib compressBound plus gzip framing; an admission estimate, never a cap
    # that truncates a trace or changes the benchmark workload.
    return size+(size>>12)+(size>>14)+(size>>25)+64

def admit(root, required, phase, details=None, output=None):
    usage = shutil.disk_usage(root)
    record = {'phase':phase, 'requiredFreeBytes':int(required), 'availableFreeBytes':usage.free,
              'sufficient':usage.free >= required, 'details':details or {}}
    if output:
        atomic_json(output, record)
    if not record['sufficient']:
        raise RuntimeError('Disk admission declined before app start: '+json.dumps(record))
    return record

def verify_sources(cache, metadata):
    assert metadata['synthetic'] is True and metadata['rows'] == 30000 and metadata['seed'] == 7
    output = []
    for name, wanted in metadata['hashes'].items():
        assert pathlib.Path(name).name == name and name.lower().endswith('.xlsx')
        source = pathlib.Path(cache, 'source', name)
        assert source.is_file() and not source.is_symlink()
        actual = sha_file(source)
        assert actual == wanted, 'Immutable source hash mismatch: '+name
        stat = source.stat()
        output.append({'name':name, 'sha256':actual, 'bytes':stat.st_size,
                       'device':stat.st_dev, 'inode':stat.st_ino, 'mode':stat.st_mode & 0o777})
    return output

def hardlink_sources(cache, target, metadata):
    verified = verify_sources(cache, metadata)
    target = pathlib.Path(target)
    target.mkdir()
    for item in verified:
        source, link = pathlib.Path(cache, 'source', item['name']), target/item['name']
        os.link(source, link)  # EXDEV fails; never silently copy/change the input strategy.
        assert os.path.samestat(source.stat(), link.stat())
        assert sha_file(link) == item['sha256']
    shutil.copyfile(pathlib.Path(cache,'source/benchmark-fixture.json'), target/'benchmark-fixture.json')
    # Directory metadata is private. Do not chmod/chown/touch the linked files:
    # their inode modes and bytes belong to the read-only source cache.
    target.chmod(0o500)
    return verified

def compress_artifact(file, manifest, manifest_path, safety_free):
    file = pathlib.Path(file)
    assert file.is_file() and not file.is_symlink() and file.stat().st_nlink == 1
    raw_bytes, raw_sha = file.stat().st_size, sha_file(file)
    compressed = file.with_name(file.name+'.gz')
    temporary = compressed.with_name(compressed.name+'.writing')
    assert not compressed.exists() and not temporary.exists(), 'Preserve existing evidence'
    admit(file.parent, gzip_bound(raw_bytes)+safety_free, 'post-exit-gzip', {'raw':str(file),'rawBytes':raw_bytes})
    with file.open('rb') as source, temporary.open('wb') as destination:
        with gzip.GzipFile(filename='', mode='wb', fileobj=destination, compresslevel=6, mtime=0) as output:
            shutil.copyfileobj(source, output, MIB)
        destination.flush()
        os.fsync(destination.fileno())
    compressed_sha = sha_file(temporary)
    recovered, recovered_bytes = hashlib.sha256(), 0
    with gzip.open(temporary, 'rb') as stream:
        for chunk in iter(lambda:stream.read(MIB),b''):
            recovered.update(chunk)
            recovered_bytes += len(chunk)
    assert recovered.hexdigest() == raw_sha and recovered_bytes == raw_bytes
    os.replace(temporary, compressed)
    entry = {'rawPath':str(file), 'rawBytes':raw_bytes, 'rawSha256':raw_sha,
             'gzipPath':str(compressed), 'gzipBytes':compressed.stat().st_size,
             'gzipSha256':compressed_sha, 'roundTripVerified':True, 'rawReleased':False}
    manifest['artifacts'].append(entry)
    atomic_json(manifest_path, manifest)  # proof is durable before releasing raw
    file.unlink()
    entry['rawReleased'] = True
    atomic_json(manifest_path, manifest)

def pack_run(run, server_exit_confirmed, safety_free):
    """Run only after the app server and browser/probe have exited, on success or failure."""
    assert server_exit_confirmed, 'Keep raw evidence until server exit is confirmed'
    run = pathlib.Path(run)
    output = run/'artifact-compression-manifest.json'
    assert not output.exists(), 'Preserve prior packing evidence; no automatic overwrite'
    manifest = {'schemaVersion':2, 'serverExitConfirmed':True, 'status':'packing', 'artifacts':[]}
    atomic_json(output, manifest)
    try:
        candidates = []
        for file in run.rglob('*'):
            if not file.is_file() or file.is_symlink() or file.stat().st_nlink != 1:
                continue
            # No workbook, original raster, or existing gzip is recompressed.
            # Large trace/memory/log/JSON raw files are packed losslessly,
            # including failed runs and mutable fixture JSON evidence.
            raw_kind = file.suffix.lower() in {'.json','.jsonl','.log','.txt','.cpuprofile','.heapsnapshot','.raw','.bin'}
            if file != output and raw_kind and file.stat().st_size >= MIB:
                candidates.append(file)
        for file in sorted(candidates, key=lambda item:item.stat().st_size, reverse=True):
            compress_artifact(file, manifest, output, safety_free)
        manifest['status'] = 'packed'
    except BaseException as error:
        manifest['status'] = 'packing-failed-raw-preserved'
        manifest['error'] = repr(error)
        raise
    finally:
        atomic_json(output, manifest)
    return manifest
