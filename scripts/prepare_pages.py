"""Package byte-identical runtime assets for Pages, without remeshing/resampling."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import gzip, hashlib, json, shutil
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'city-explorer/public'
OUTPUT = ROOT / 'city-explorer/.pages-public'


def pack(source):
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    compressed = source.suffix in {'.glb', '.json', '.bin'}
    data = gzip.compress(raw, compresslevel=9, mtime=0) if compressed else raw
    if compressed and gzip.decompress(data) != raw:
        raise RuntimeError(f'Lossless round-trip failed: {source}')
    url = '_data/' + digest + source.suffix + ('.gzipbin' if compressed else '')
    return source.relative_to(SOURCE).as_posix(), url, compressed, data, len(raw), digest


def main():
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    (OUTPUT / '_data').mkdir(parents=True)
    files = sorted(p for p in SOURCE.rglob('*') if p.is_file()
                   and p.name not in {'architecture.glb', 'michelle.glb', '.DS_Store'})
    if not files:
        raise SystemExit('Restore browser archives before preparing Pages.')
    manifest, written = {}, set()
    total = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        # Bounded buffers avoid retaining the entire city in CI memory.
        for start in range(0, len(files), 8):
            for path, url, compressed, data, raw_bytes, digest in pool.map(pack, files[start:start + 8]):
                if url not in written:
                    (OUTPUT / url).write_bytes(data)
                    written.add(url)
                    total += len(data)
                manifest[path] = {'url': url, 'gzip': compressed, 'bytes': raw_bytes, 'sha256': digest}
    (OUTPUT / 'asset-manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    (OUTPUT / '.nojekyll').touch()
    print(f'Verified {len(manifest)} assets; {len(written)} unique payloads; {total:,} bytes', flush=True)
    # Leave room for Vite bundles and the manifest below the 1 GiB published-site ceiling.
    if total > 1_050_000_000:
        raise SystemExit('Pages payload exceeds deployment budget; no assets have been downgraded.')


if __name__ == '__main__':
    main()
